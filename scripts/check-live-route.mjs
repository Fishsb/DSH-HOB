#!/usr/bin/env node
/**
 * Live invalidation channel — server behaviour checks.
 *
 * These exercise the real hub and the real route installer with a fake
 * connection registry. The checks are about the contract that makes realtime
 * safe: coalesced signals, monotonic revisions, ledger isolation, stream
 * teardown, limits, and validation. They never read a real ledger.
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const root = new URL('..', import.meta.url).pathname
const hubMod = await import(pathToFileURL(join(root, 'src/server/live-hub.ts')).href)
const protocol = await import(pathToFileURL(join(root, 'src/shared/live-protocol.ts')).href)
const routeMod = await import(pathToFileURL(join(root, 'src/modules/live-route.ts')).href)
const writeMod = await import(pathToFileURL(join(root, 'src/server/hob-write.ts')).href)

let pass = 0
let fail = 0
const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail++; console.log(`  ✗ ${m}`) }
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const work = mkdtempSync(join(tmpdir(), 'hob-live-route-'))
const ledgerHome = join(work, 'ledgers')
mkdirSync(join(ledgerHome, 'alpha'), { recursive: true })
mkdirSync(join(ledgerHome, 'beta'), { recursive: true })

const sink = () => {
  const frames = []
  return {
    frames,
    write(text) { frames.push(text); return true },
    close() {},
  }
}

try {
  // L1 · two writes inside one merge window produce one frame with both sources.
  {
    const hub = new hubMod.LiveHub()
    const one = sink()
    hub.subscribe('alpha', one)
    hub.publish('alpha', ['ledger'])
    hub.publish('alpha', ['runtime'])
    await wait(protocol.LIVE_MERGE_MS + 40)
    const changes = one.frames.filter((x) => x.includes('event: change'))
    const parsed = protocol.parseLiveFrame('change', JSON.parse(changes[0]?.split('data: ')[1]?.trim() ?? 'null') && JSON.stringify(JSON.parse(changes[0].split('data: ')[1].trim())))
    if (changes.length === 1 && parsed?.data?.sources?.length === 2) {
      ok('L1 ✓ 同一合并窗口内的账本与运行态写入合成一帧，序号只加一次')
    } else bad(`L1 · frames=${changes.length} parsed=${JSON.stringify(parsed)}`)
    hub.dispose()
  }

  // L2 · revision is monotonic only for the ledger that changed.
  {
    const hub = new hubMod.LiveHub()
    const alpha = sink()
    const beta = sink()
    hub.subscribe('alpha', alpha)
    hub.subscribe('beta', beta)
    hub.publish('alpha', ['ledger'])
    await wait(protocol.LIVE_MERGE_MS + 40)
    hub.publish('beta', ['runtime'])
    await wait(protocol.LIVE_MERGE_MS + 40)
    const alphaChanges = alpha.frames.filter((x) => x.includes('event: change'))
    const betaChanges = beta.frames.filter((x) => x.includes('event: change'))
    const alphaRev = JSON.parse(alphaChanges[0].split('data: ')[1].trim()).revision
    const betaRev = JSON.parse(betaChanges[0].split('data: ')[1].trim()).revision
    if (alphaChanges.length === 1 && betaChanges.length === 1 && alphaRev === 1 && betaRev === 1) {
      ok('L2 ✓ 序号按账本独立：alpha 与 beta 各自从 1 开始，不串流')
    } else bad(`L2 · alpha=${alphaChanges.length}/${alphaRev} beta=${betaChanges.length}/${betaRev}`)
    hub.dispose()
  }

  // L3 · abort unsubscribes and leaves no timer or subscriber behind.
  {
    const hub = new hubMod.LiveHub()
    const ctl = new AbortController()
    const one = { ...sink(), signal: ctl.signal }
    const sub = hub.subscribe('alpha', one)
    const before = hub.stats()
    ctl.abort()
    const after = hub.stats()
    if (sub.ok === true && before.subscribers === 1 && after.subscribers === 0 && after.timers === 0) {
      ok('L3 ✓ 客户端中止流后订阅归零，合并定时器不残留')
    } else bad(`L3 · sub=${JSON.stringify(sub)} before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)
    hub.dispose()
  }

  // L4 · per-ledger and global limits are explicit, not silent drops.
  {
    const hub = new hubMod.LiveHub()
    const results = []
    for (let i = 0; i < protocol.LIVE_PER_LEDGER_LIMIT + 1; i++) results.push(hub.subscribe('alpha', sink()))
    const refused = results.at(-1)
    if (results.slice(0, protocol.LIVE_PER_LEDGER_LIMIT).every((x) => x.ok) && refused?.ok === false
      && refused.reason === 'subscriber-limit' && String(refused.message).includes('上限')) {
      ok('L4 ✓ 每账本订阅上限有可读拒绝，不静默丢弃连接')
    } else bad(`L4 · last=${JSON.stringify(refused)}`)
    hub.dispose()
  }

  // L5 · hello is the first frame and includes sequence, ledger and heartbeat.
  {
    const hub = new hubMod.LiveHub()
    const hello = hub.helloOf('alpha')
    if (hello.revision === 0 && hello.ledger === 'alpha'
      && hello.heartbeatMs === protocol.LIVE_HEARTBEAT_MS) {
      ok('L5 ✓ hello 首帧带账本名、当前序号与心跳周期')
    } else bad(`L5 · ${JSON.stringify(hello)}`)
    hub.dispose()
  }

  // L6 · unrelated ledger-root publishes are no-ops until a hub attaches that root.
  {
    const hub = new hubMod.LiveHub()
    const one = sink()
    hub.subscribe('alpha', one)
    hubMod.publishLiveChange(join(ledgerHome, 'beta'), ['ledger'])
    hub.registerLedgerRoot(join(ledgerHome, 'beta'), 'beta')
    hubMod.publishLiveChange(join(ledgerHome, 'beta'), ['ledger'])
    await wait(protocol.LIVE_MERGE_MS + 40)
    const changes = one.frames.filter((x) => x.includes('event: change'))
    if (changes.length === 0) ok('L6 ✓ 未挂接的账本根发布是空操作，不会误推给其它账本')
    else bad(`L6 · alpha received ${changes.length} foreign frames`)
    hub.dispose()
  }

  // L7 · route parsing and access rules with a fake host connection.
  {
    const registered = []
    const hub = new hubMod.LiveHub()
    const ctx = {
      logger: { info() {}, warn() {}, debug() {} },
      get: (name) => name === 'loader' ? { entries: () => [{ options: { config: { ledgerHome } } }] } : undefined,
      effect: (fn) => fn(),
      inject: (_deps, cb) => cb(ctx),
    }
    const connection = {
      fetch: {
        register(route) { registered.push(route); return () => {} },
      },
    }
    const routeCtx = {
      ...ctx,
      get: (name) => name === 'loader' ? { entries: () => [{ options: { config: { ledgerHome } } }] }
        : name === 'connection' ? connection : undefined,
      inject: (_deps, cb) => cb({ ...routeCtx, connection }),
    }
    routeMod.installLiveRoute(routeCtx, hub)
    const route = registered[0]
    const missing = await route.fetch(new Request('http://x/api/dsh-hob/live', { method: 'POST', body: '{}' }))
    const badLedger = await route.fetch(new Request('http://x/api/dsh-hob/live', {
      method: 'POST', body: JSON.stringify({ sessionId: 's', ledger: '../escape' }),
    }))
    if (route?.path === protocol.LIVE_ROUTE_PATH && route.methods.includes('POST')
      && missing.status === 400 && badLedger.status === 400) {
      ok('L7 ✓ 路由在认证 Fetch 注册面，缺会话与非法账本名都被明确拒绝')
    } else bad(`L7 · route=${route?.path} missing=${missing.status} badLedger=${badLedger.status}`)
    hub.dispose()
  }

  // L8 · route emits hello immediately and honours a valid ledger name.
  {
    const registered = []
    const hub = new hubMod.LiveHub()
    const connection = { fetch: { register(route) { registered.push(route); return () => {} } } }
    const ctx = {
      logger: { info() {}, warn() {}, debug() {} },
      get: (name) => name === 'loader' ? { entries: () => [{ options: { config: { ledgerHome } } }] }
        : name === 'connection' ? connection : undefined,
      effect: (fn) => fn(),
      inject: (_deps, cb) => cb(ctx),
    }
    routeMod.installLiveRoute(ctx, hub)
    const res = await registered[0].fetch(new Request('http://x/api/dsh-hob/live', {
      method: 'POST', body: JSON.stringify({ sessionId: 's', ledger: 'alpha' }),
    }))
    const reader = res.body.getReader()
    const first = await reader.read()
    const text = new TextDecoder().decode(first.value)
    await reader.cancel()
    if (res.status === 200 && String(res.headers.get('content-type')).includes('text/event-stream')
      && text.startsWith('event: hello\n') && text.includes('"ledger":"alpha"')) {
      ok('L8 ✓ 合法订阅返回 SSE，首帧是带账本名的 hello')
    } else bad(`L8 · status=${res.status} type=${res.headers.get('content-type')} first=${JSON.stringify(text.slice(0, 160))}`)
    hub.dispose()
  }

  // L9 · negative control: deleting hub publication leaves a subscriber silent.
  {
    const hub = new hubMod.LiveHub()
    const one = sink()
    hub.subscribe('alpha', one)
    await wait(protocol.LIVE_MERGE_MS + 20)
    const silent = one.frames.length === 0
    hub.publish('alpha', ['ledger'])
    await wait(protocol.LIVE_MERGE_MS + 40)
    const spoken = one.frames.some((x) => x.includes('event: change'))
    if (silent && spoken) ok('L9 ✓ 负向对照成立：不发布就静默，发布后才有 change')
    else bad(`L9 · silent=${silent} spoken=${spoken}`)
    hub.dispose()
  }

  // L10 · dispose clears live streams and heartbeat; stats proves cleanup.
  {
    const hub = new hubMod.LiveHub()
    const one = sink()
    hub.subscribe('alpha', one)
    hub.dispose()
    const stats = hub.stats()
    if (stats.subscribers === 0 && stats.timers === 0 && stats.heartbeat === false) {
      ok('L10 ✓ Hub 释放后订阅、合并定时器与心跳全部归零')
    } else bad(`L10 · ${JSON.stringify(stats)}`)
  }

  // L11 · real ledger write publishes only for pipeline-bearing paths.
  {
    const hub = new hubMod.LiveHub()
    const alphaRoot = join(ledgerHome, 'alpha')
    const detach = hub.registerLedgerRoot(alphaRoot, 'alpha')
    const one = sink()
    hub.subscribe('alpha', one)
    const opts = { hobDir: '', keepBackups: 2, shrinkGuard: 0.5, maxFileBytes: 262144 }
    mkdirSync(join(alphaRoot, 'ledger', 'units'), { recursive: true })
    mkdirSync(join(alphaRoot, 'archive', '2026-11-09-note'), { recursive: true })
    await writeMod.writeHobFile(alphaRoot, { file: 'ledger/units/unit-live-check.toml', content: '[[unit]]\nid = "R-live"\nkind = "req"\nstatus = "draft"\ntitle = "live signal"\npipeline_version = "v3"\nrevision = "1"\n', mode: 'append' }, opts)
    await wait(protocol.LIVE_MERGE_MS + 40)
    const first = one.frames.filter((x) => x.includes('event: change')).length
    await writeMod.writeHobFile(alphaRoot, { file: 'archive/2026-11-09-note/TASK.md', content: '# note\n', mode: 'overwrite' }, opts)
    await wait(protocol.LIVE_MERGE_MS + 40)
    const second = one.frames.filter((x) => x.includes('event: change')).length
    if (first === 1 && second === 1) {
      ok('L11 ✓ 真账本写入发一次信号；交接文件写入不误触发面板刷新')
    } else bad(`L11 · pipeline frames=${first} after handoff=${second}`)
    detach()
    hub.dispose()
  }

  // L12 · negative control for source classification: runtime paths are not ledger sources.
  {
    const signalMod = await import(pathToFileURL(join(root, 'src/shared/live-signal.ts')).href)
    const ledger = signalMod.liveSourcesOfLedgerWrite('ledger/units/unit-01.toml')
    const handoff = signalMod.liveSourcesOfLedgerWrite('archive/2026-11-09-x/TASK.md')
    const plan = signalMod.liveSourcesOfRuntimeWrite('runtime/work-plans/active/WP-1.json')
    const runtime = signalMod.liveSourcesOfRuntimeWrite('runtime/orch-watches.json')
    if (JSON.stringify(ledger) === '["ledger"]' && handoff.length === 0
      && JSON.stringify(plan) === '["plans"]' && JSON.stringify(runtime) === '["runtime"]') {
      ok('L12 ✓ 写入分类：账本 / 计划 / 运行态各自归类，交接文件不产生信号')
    } else bad(`L12 · ledger=${JSON.stringify(ledger)} handoff=${JSON.stringify(handoff)} plan=${JSON.stringify(plan)} runtime=${JSON.stringify(runtime)}`)
  }

  // L13 · a runtime-state write reaches the stream, not just the ledger writer.
  {
    const hub = new hubMod.LiveHub()
    const alphaRoot = join(ledgerHome, 'alpha')
    const detach = hub.registerLedgerRoot(alphaRoot, 'alpha')
    const one = sink()
    hub.subscribe('alpha', one)
    const stateFile = join(alphaRoot, 'runtime', 'orch-watches.json')
    mkdirSync(join(alphaRoot, 'runtime'), { recursive: true })
    const orch = await import(pathToFileURL(join(root, 'src/server/orch-state.ts')).href)
    const wrote = orch.writeOrchState(stateFile, {
      version: 1, updatedAt: Date.now(), pending: [], lost: [], closed: [], handoffs: [], sessions: [],
    })
    await wait(protocol.LIVE_MERGE_MS + 40)
    const changes = one.frames.filter((x) => x.includes('event: change'))
    const parsed = changes.length === 0 ? undefined : JSON.parse(changes[0].split('data: ')[1].trim())
    if (wrote === true && changes.length === 1 && parsed?.sources?.includes('runtime')) {
      ok('L13 ✓ 运行态真写成功 ⇒ 该账本收到一次 runtime change（不只账本写入有推送）')
    } else bad(`L13 · wrote=${wrote} changes=${changes.length} parsed=${JSON.stringify(parsed)}`)
    detach()
    hub.dispose()
  }

  // L14 · a plan write publishes plans, and an unknown ledger root stays silent.
  {
    const hub = new hubMod.LiveHub()
    const alphaRoot = join(ledgerHome, 'alpha')
    const detach = hub.registerLedgerRoot(alphaRoot, 'alpha')
    const one = sink()
    hub.subscribe('alpha', one)
    const plans = await import(pathToFileURL(join(root, 'src/server/work-plan-state.ts')).href)
    const plan = {
      version: 1, planId: 'WP-live-check', changeId: 'CHG-live', mode: 'multi', workspaceRoot: '/tmp/x',
      rationale: 'live check', tracks: [], joinPolicy: 'all', state: 'planned', createdAt: Date.now(),
    }
    const wrote = plans.writeWorkPlan(alphaRoot, plan)
    await wait(protocol.LIVE_MERGE_MS + 40)
    const first = one.frames.filter((x) => x.includes('event: change')).length
    hubMod.publishLiveChange(join(ledgerHome, 'does-not-exist'), ['plans'])
    await wait(protocol.LIVE_MERGE_MS + 40)
    const second = one.frames.filter((x) => x.includes('event: change')).length
    if (wrote.ok === true && first === 1 && second === 1) {
      ok('L14 ✓ 计划落盘发一次 plans 信号；未挂接的账本根仍为空操作')
    } else bad(`L14 · wrote=${JSON.stringify(wrote)} frames=${first}/${second}`)
    detach()
    hub.dispose()
  }

  // L15 · negative control: a dry-run ledger write must not announce a change.
  {
    const hub = new hubMod.LiveHub()
    const alphaRoot = join(ledgerHome, 'alpha')
    const detach = hub.registerLedgerRoot(alphaRoot, 'alpha')
    const one = sink()
    hub.subscribe('alpha', one)
    const opts = { hobDir: '', keepBackups: 2, shrinkGuard: 0.5, maxFileBytes: 262144 }
    mkdirSync(join(alphaRoot, 'ledger', 'units'), { recursive: true })
    const dry = await writeMod.writeHobFile(alphaRoot, {
      file: 'ledger/units/unit-dry-check.toml',
      content: '[[unit]]\nid = "R-dry"\nkind = "req"\nstatus = "draft"\ntitle = "dry signal"\npipeline_version = "v3"\nrevision = "1"\n',
      mode: 'append', dryRun: true,
    }, opts)
    await wait(protocol.LIVE_MERGE_MS + 40)
    const frames = one.frames.filter((x) => x.includes('event: change')).length
    if (dry.ok === true && frames === 0) {
      ok('L15 ✓ 负向对拍：dryRun 未落盘 ⇒ 不发 change（不会让面板为一次演练刷新）')
    } else bad(`L15 · dry=${JSON.stringify({ ok: dry.ok, reason: dry.reason })} frames=${frames}`)
    detach()
    hub.dispose()
  }

  // L16 · the execution snapshot route accepts a selected ledger and rejects paths.
  {
    const execRoute = await import(pathToFileURL(join(root, 'src/modules/exec-progress-route.ts')).href)
    const registered = []
    const connection = { fetch: { register(route) { registered.push(route); return () => {} } } }
    const ctx = {
      logger: { info() {}, warn() {}, debug() {} },
      get: (name) => name === 'loader' ? { entries: () => [{ options: { config: { ledgerHome } } }] }
        : name === 'connection' ? connection : undefined,
      effect: (fn) => fn(),
      inject: (_deps, cb) => cb(ctx),
    }
    execRoute.installExecProgressRoute(ctx)
    const route = registered[0]
    // beta exists but has no runtime file; alpha exists too. A valid explicit
    // name must be read there instead of falling back to the session's cwd.
    const res = await route.fetch(new Request('http://x/api/dsh-hob/exec-progress', {
      method: 'POST', body: JSON.stringify({ sessionId: 's', ledger: 'beta' }),
    }))
    const body = await res.json()
    const badRes = await route.fetch(new Request('http://x/api/dsh-hob/exec-progress', {
      method: 'POST', body: JSON.stringify({ sessionId: 's', ledger: '../escape' }),
    }))
    const badBody = await badRes.json()
    if (res.status === 400 && body.reason === 'state-missing'
      && badRes.status === 400 && badBody.reason === 'ledger-not-allowed') {
      ok('L16 ✓ 执行态路由接受白名单 ledger 并从该账本读运行态（beta ⇒ state-missing）；路径穿越被拒')
    } else bad(`L16 · valid=${res.status}/${body.reason} bad=${badRes.status}/${badBody.reason}`)
  }

  // L17 · agent/status emits the supplementary session signal only for a resolvable ledger.
  {
    const hub = new hubMod.LiveHub()
    const alphaRoot = join(ledgerHome, 'alpha')
    const detach = hub.registerLedgerRoot(alphaRoot, 'alpha')
    const one = sink()
    hub.subscribe('alpha', one)
    const published = []
    const ctx = {
      sessions: { get: () => ({ header: { cwd: alphaRoot } }) },
      agents: { get: () => undefined },
      logger: { debug() {}, info() {}, warn() {} },
      get: (k) => k === 'loader' ? { entries: () => [{ options: { config: { ledgerHome } } }] } : undefined,
      provide() {},
      effect: (fn) => fn(),
      inject: (_d, cb) => cb(ctx),
      on: (ev, fn) => { if (ev === 'agent/status') handlers.status = fn; return () => {} },
    }
    const handlers = {}
    const orch = await import(pathToFileURL(join(root, 'src/modules/orchestrator.ts')).href)
    orch.apply(ctx)
    handlers.status?.({ agent: { id: 'session-exec' }, status: 'running' })
    await wait(protocol.LIVE_MERGE_MS + 40)
    const changes = one.frames.filter((x) => x.includes('event: change'))
    const parsed = changes.length === 0 ? undefined : JSON.parse(changes[0].split('data: ')[1].trim())
    if (changes.length === 1 && parsed?.sources?.includes('session')) {
      ok('L17 ✓ agent/status 只发一次 session 失效信号（快照仍由路由决定状态）')
    } else bad(`L17 · frames=${changes.length} parsed=${JSON.stringify(parsed)}`)
    detach()
    hub.dispose()
  }

  // L18 · successful ledger initialization announces the catalog change.
  {
    const hub = new hubMod.LiveHub()
    const alphaRoot = join(ledgerHome, 'alpha')
    const detach = hub.registerLedgerRoot(alphaRoot, 'alpha')
    const one = sink()
    hub.subscribe('alpha', one)
    const toolsMod = await import(pathToFileURL(join(root, 'src/modules/tools.ts')).href)
    const toolset = toolsMod.createHobTools({
      workspaceRoot: alphaRoot,
      ledgerRoot: alphaRoot,
      ledgerHome,
    }, { levelOf: () => 'project', tierNamesOf: () => ['project'], maxWriteBytes: 262144 })
    const initCtx = {
      agent: { id: 'session-init', session: { header: { cwd: alphaRoot } } },
    }
    // hob_ledger_init is non-destructive: for a brand-new ledger the directory
    // itself may not exist yet. Exercise the same create-then-init path as the
    // tool's first-use scenario.
    const init = await toolset.ledgerInit.execute({ dryRun: false }, initCtx)
    if (process.env.LC_DEBUG) console.error('DEBUG L18B', JSON.stringify(init))
    await wait(protocol.LIVE_MERGE_MS + 40)
    const changes = one.frames.filter((x) => x.includes('event: change'))
    const parsed = changes.length === 0 ? undefined : JSON.parse(changes[0].split('data: ')[1].trim())
    if (init.ok === true && changes.length === 1 && parsed?.sources?.includes('ledger') && parsed?.sources?.includes('catalog')) {
      ok('L18 ✓ 建账成功 ⇒ 同一合并帧同时带 ledger + catalog（内容与目录都被刷新）')
    } else bad(`L18 · init=${JSON.stringify({ ok: init.ok, reason: init.reason })} frames=${changes.length} sources=${JSON.stringify(parsed?.sources)}`)
    detach()
    hub.dispose()
  }

  // L19 · a merged burst includes catalog with ledger/plans without raising revision twice.
  {
    const hub = new hubMod.LiveHub()
    const one = sink()
    hub.subscribe('alpha', one)
    hub.publish('alpha', ['ledger', 'catalog'])
    hub.publish('alpha', ['plans'])
    await wait(protocol.LIVE_MERGE_MS + 40)
    const changes = one.frames.filter((x) => x.includes('event: change'))
    const parsed = changes.length === 0 ? undefined : JSON.parse(changes[0].split('data: ')[1].trim())
    const want = ['ledger', 'plans', 'catalog']
    if (changes.length === 1 && parsed?.revision === 1 && JSON.stringify(parsed.sources) === JSON.stringify(want)) {
      ok('L19 ✓ 同一窗口的 ledger + plans + catalog 合成一帧且只推进一个序号（顺序稳定）')
    } else bad(`L19 · frames=${changes.length} revision=${parsed?.revision} sources=${JSON.stringify(parsed?.sources)}`)
    hub.dispose()
  }

  // L20 · detaching one of two streams on the same root must not mute the other.
  {
    const hub = new hubMod.LiveHub()
    const alphaRoot = join(ledgerHome, 'alpha')
    const first = hub.registerLedgerRoot(alphaRoot, 'alpha')
    const second = hub.registerLedgerRoot(alphaRoot, 'alpha')
    const one = sink()
    hub.subscribe('alpha', one)
    first()
    hubMod.publishLiveChange(alphaRoot, ['ledger'])
    await wait(protocol.LIVE_MERGE_MS + 40)
    const liveFrames = one.frames.filter((x) => x.includes('event: change')).length
    second()
    hubMod.publishLiveChange(alphaRoot, ['ledger'])
    await wait(protocol.LIVE_MERGE_MS + 40)
    const afterAllDetached = one.frames.filter((x) => x.includes('event: change')).length
    if (liveFrames === 1 && afterAllDetached === 1) {
      ok('L20 ✓ 同一账本两条连接的引用计数正确：断开一条不影响另一条，全部断开后发布为空操作')
    } else bad(`L20 · frames=${liveFrames}/${afterAllDetached}`)
    hub.dispose()
  }

  // L21 · a client abort through the real route removes the subscription and closes the stream.
  {
    const registered = []
    const hub = new hubMod.LiveHub()
    const connection = { fetch: { register(route) { registered.push(route); return () => {} } } }
    const ctx = {
      logger: { info() {}, warn() {}, debug() {} },
      get: (name) => name === 'loader' ? { entries: () => [{ options: { config: { ledgerHome } } }] }
        : name === 'connection' ? connection : undefined,
      effect: (fn) => fn(),
      inject: (_deps, cb) => cb(ctx),
    }
    routeMod.installLiveRoute(ctx, hub)
    const ctl = new AbortController()
    const res = await registered[0].fetch(new Request('http://x/api/dsh-hob/live', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 's', ledger: 'alpha' }),
      signal: ctl.signal,
    }))
    const reader = res.body.getReader()
    await reader.read()
    const during = hub.stats().subscribers
    ctl.abort()
    await reader.cancel().catch(() => {})
    await wait(20)
    const after = hub.stats()
    if (during === 1 && after.subscribers === 0 && after.timers === 0) {
      ok('L21 ✓ 真路由上 abort 后订阅归零、流结束、合并定时器不残留')
    } else bad(`L21 · during=${during} after=${JSON.stringify(after)}`)
    hub.dispose()
  }

  // L21b · a failed write releases once; a later abort must not decrement twice.
  {
    const hub = new hubMod.LiveHub()
    const ctl = new AbortController()
    const closed = { called: 0 }
    const failing = {
      signal: ctl.signal,
      write() { return false },
      close() { closed.called += 1 },
    }
    const sub = hub.subscribe('alpha', failing)
    hub.publish('alpha', ['ledger'])
    await wait(protocol.LIVE_MERGE_MS + 40)
    const afterBackpressure = hub.stats()
    ctl.abort()
    await wait(10)
    const afterAbort = hub.stats()
    /** The same sink is also safe to close again through dispose. */
    hub.dispose()
    const afterDispose = hub.stats()
    if (sub.ok === true && afterBackpressure.subscribers === 0 && afterBackpressure.heartbeat === false
      && afterAbort.subscribers === 0 && afterDispose.subscribers === 0 && closed.called === 1) {
      ok('L21b ✓ 背压写失败只注销一次；随后 abort/dispose 不会把订阅计数减成负数')
    } else {
      bad(`L21b · afterBackpressure=${JSON.stringify(afterBackpressure)} afterAbort=${JSON.stringify(afterAbort)} afterDispose=${JSON.stringify(afterDispose)} closed=${closed.called}`)
    }
  }

  // L21c · negative control: restoring direct deletion makes the counter go negative.
  {
    const hubSource = await import('node:fs').then((fs) => fs.readFileSync(join(root, 'src/server/live-hub.ts'), 'utf8'))
    const mutant = hubSource
      .replaceAll("'../shared/live-protocol.ts'", JSON.stringify(pathToFileURL(join(root, 'src/shared/live-protocol.ts')).href))
      .replaceAll("'../shared/live-signal.ts'", JSON.stringify(pathToFileURL(join(root, 'src/shared/live-signal.ts')).href))
      .replace(
        "            try { sink.close() } catch { /* already closed */ }\n            this.dropSubscriber(state, sink)\n          }\n        } catch {\n          try { sink.close() } catch { /* already closed */ }\n          this.dropSubscriber(state, sink)",
        "            sink.close()\n            state.subscribers.delete(sink)\n            this.subscriberCount -= 1\n          }\n        } catch {\n          state.subscribers.delete(sink)\n          this.subscriberCount -= 1",
      )
      /**
       * The release map is part of the same fix. Removing only the failed-write
       * call while leaving the map lets `dropSubscriber`'s fallback mask the
       * defect. The mutant must model the old bookkeeping as a whole.
       */
      .replace(
        "    state.subscribers.add(sink)\n    state.releases.set(sink, unsubscribe)\n",
        '    state.subscribers.add(sink)\n',
      )
      /**
       * The old unsubscribe decremented unconditionally. Without reverting that
       * guard too, the mutant would silently return when the set no longer holds
       * the sink, and the negative control would not reproduce the double count.
       */
      .replace(
        "      const removed = state.subscribers.delete(sink)\n      state.releases.delete(sink)\n      if (!removed) return\n      this.subscriberCount -= 1\n",
        '      state.subscribers.delete(sink)\n      this.subscriberCount -= 1\n',
      )
      .replace(
        "  private dropSubscriber(state: LedgerState, sink: LiveSink): void {\n    const release = state.releases.get(sink)\n    if (release !== undefined) {\n      release()\n      return\n    }\n    /** Defensive fallback for a partially initialized sink. */\n    if (state.subscribers.delete(sink)) this.subscriberCount = Math.max(0, this.subscriberCount - 1)\n  }",
        '  private dropSubscriber(state: LedgerState, sink: LiveSink): void {\n    if (state.subscribers.delete(sink)) this.subscriberCount -= 1\n  }',
      )
    const mutantFile = join(work, `live-hub-mutant-${Date.now()}.ts`)
    await import('node:fs').then((fs) => fs.writeFileSync(mutantFile, mutant, 'utf8'))
    const mutantMod = await import(pathToFileURL(mutantFile).href)
    const hub = new mutantMod.LiveHub()
    const ctl = new AbortController()
    const failing = {
      signal: ctl.signal,
      write() { return false },
      close() {},
    }
    hub.subscribe('alpha', failing)
    hub.publish('alpha', ['ledger'])
    await wait(protocol.LIVE_MERGE_MS + 40)
    /** The old direct-deletion path no longer removes the abort listener. */
    const afterBackpressure = hub.stats().subscribers
    ctl.abort()
    const stats = hub.stats()
    if (afterBackpressure === 0 && stats.subscribers < 0) {
      ok(`L21c ✓ 负向对拍（恢复背压时直接删订阅）⇒ 随后的 abort 把计数从 0 减到 ${stats.subscribers}，正证因此有牙`)
    } else {
      bad(`L21c · 变体没有暴露重复减计数：afterBackpressure=${afterBackpressure} stats=${JSON.stringify(stats)}`)
    }
    hub.dispose()
  }

  // L22 · non-stream routes remain JSON and do not acquire a live subscription.
  {
    const registered = []
    const hub = new hubMod.LiveHub()
    const alphaRoot = join(ledgerHome, 'l22-alpha')
    mkdirSync(join(alphaRoot, 'ledger', 'units'), { recursive: true })
    writeFileSync(join(alphaRoot, 'ledger', 'units', 'index.toml'), '# empty index\n')
    writeFileSync(join(alphaRoot, 'ledger.toml'), '# activation\nledger_id = "l22"\nschema_version = "pipeline-v3"\nstatus = "active"\nworkspace = "l22-alpha"\ngeneration = "1"\ncreated_at = "2026-11-10T00:00:00Z"\n')
    const connection = { fetch: { register(route) { registered.push(route); return () => {} } } }
    const ctx = {
      logger: { info() {}, warn() {}, debug() {} },
      get: (name) => name === 'loader' ? { entries: () => [{ options: { config: { ledgerHome } } }] }
        : name === 'connection' ? connection : name === 'sessions' ? { get: () => ({ header: { cwd: alphaRoot } }) } : undefined,
      effect: (fn) => fn(),
      inject: (_deps, cb) => cb(ctx),
    }
    const stages = await import(pathToFileURL(join(root, 'src/modules/stages-route.ts')).href)
    stages.installStagesRoute(ctx)
    const stageRes = await registered[0].fetch(new Request('http://x/api/dsh-hob/stages', {
      method: 'POST', body: JSON.stringify({ sessionId: 's' }),
    }))
    const text = await stageRes.text()
    let parsed
    try { parsed = JSON.parse(text) } catch { parsed = undefined }
    if (stageRes.status !== 200 || parsed === undefined || hub.stats().subscribers !== 0) {
      bad(`L22 · status=${stageRes.status} json=${parsed !== undefined} subs=${hub.stats().subscribers}`)
    } else {
      ok('L22 ✓ 非流式阶段路由仍返回 JSON，且不创建任何实时订阅')
    }
    hub.dispose()
  }

  // L23 · dispatch/return/acceptance facts reach the stream through real write paths.
  {
    const hub = new hubMod.LiveHub()
    const betaRoot = join(ledgerHome, 'beta')
    const detach = hub.registerLedgerRoot(betaRoot, 'beta')
    const one = sink()
    hub.subscribe('beta', one)
    mkdirSync(join(betaRoot, 'ledger', 'units'), { recursive: true })
    const { writeFileSync } = await import('node:fs')
    /**
     * ⚠⚠ **RP-3 的 digest 必须用纯函数算**（2026-11-11 · S-03 连带）：
     *   手写一个字符串必然与当前风险事实不符 ⇒ 会被判「评定已过期」。
     *   这与 `check-ledger-projection.mjs` 的 `withRisk()` 是同一手法（同源纯函数）。
     */
    const riskMod = await import(pathToFileURL(join(root, 'src/shared/risk-policy.ts')).href)
    const pipelineMod = await import(pathToFileURL(join(root, 'src/shared/pipeline.ts')).href)
    const reqUnit = {
      id: 'R-live-flow', kind: 'req', status: 'agreed', title: 'live flow',
      pipeline_version: 'v3', revision: '1',
      clarify_examples: ['EX-live | pass(出现提示) | /tmp/e.md'],
      acceptance_criteria: ['live flow 可用'], acceptance_ids: ['AC-live-1'],
    }
    const chgBase = {
      id: 'CHG-live-flow', kind: 'change', status: 'settled', title: 'live flow 方案',
      parent: 'R-live-flow', req_ids: ['R-live-flow'],
      pipeline_version: 'v3', revision: '1',
      path_options: ['A', 'B'], path_tradeoffs: ['A 快', 'B 稳'], path_decision: '选 A',
      requirement_coverage: ['R-live-flow → live flow'], addresses: ['R-live-flow'],
      risk_rule_version: riskMod.RISK_POLICY_VERSION,
      risk_dimensions: [
        'scope=local', 'severity=negligible', 'reversibility=easy', 'detectability=automatic',
        'uncertainty=known', 'changeSurface=one-point', 'dependencies=independent',
        'verificationMaturity=proven', 'recoveryTime=minutes', 'exposure=internal',
      ],
      risk_hard_triggers: [],
    }
    const assessed = riskMod.riskAssessmentOf(riskMod.riskFactsOf(chgBase))
    const chgUnit = {
      ...chgBase,
      risk_tier: assessed.tier,
      risk_inputs_digest: assessed.inputsDigest,
      risk_assessed_at: '2026-11-10T00:00:00+08:00',
      risk_assessed_by: 'session-hob',
      risk_binding_version: riskMod.RISK_POLICY_VERSION,
      risk_binding_digest: pipelineMod.riskBindingDigestOf(chgBase, [reqUnit, chgBase]),
      risk_assessment_ref: 'archive/x/RISK.md',
    }
    /**
     * ⚠ 用**同一个渲染器**把三个对象写成 TOML（⛔ 不再手抄字面量）——
     *   手抄必然与对象漂开，而漂的正是「夹具说它合规」这件事。
     */
    const renderUnit = (u) => {
      const lines = ['[[unit]]']
      for (const [k, v] of Object.entries(u)) {
        if (v === undefined || v === null) continue
        if (Array.isArray(v)) {
          if (v.length === 0) continue
          lines.push(k + ' = [' + v.map((x) => JSON.stringify(String(x))).join(', ') + ']')
        } else if (typeof v === 'boolean' || typeof v === 'number') {
          lines.push(k + ' = ' + String(v))
        } else {
          lines.push(k + ' = ' + JSON.stringify(String(v)))
        }
      }
      return lines.join('\n') + '\n'
    }
    const tskUnit = {
      id: 'TSK-live-flow', kind: 'task', status: 'todo', title: 'live flow task',
      parent: 'CHG-live-flow', pipeline_version: 'v3', revision: '1',
      task_brief: 'archive/x/L23-TASK.md',
      counterexamples: ['空输入不崩溃'],
      stop_conditions: ['与方案冲突即停'],
      return_to: 'back-to-plan',
      task_risk: 'low', risk_reasons: ['只动 live 事件流'], touched_surfaces: ['ledger/units'],
      /** ⚠ C-7 要读父任务的实现者；缺了会被判「没法判是不是自己验自己」。 */
      built_by: 'session-flow',
      acceptance_criteria_refs: ['AC-live-1'],
      test_plan: '跑 check:live-route 的 L23',
    }
    writeFileSync(
      join(betaRoot, 'ledger', 'units', 'index.toml'),
      renderUnit(reqUnit) + renderUnit(chgUnit) + renderUnit(tskUnit),
    )
    const projection = await import(pathToFileURL(join(root, 'src/server/projection-writer.ts')).href)
    const dispatched = await projection.applyProjection(betaRoot, {
      kind: 'dispatch', taskId: 'TSK-live-flow', target: 'session-flow', at: Date.now(),
    })
    await wait(protocol.LIVE_MERGE_MS + 40)
    const afterDispatch = one.frames.filter((x) => x.includes('event: change')).length
    const returned = await projection.applyProjection(betaRoot, {
      kind: 'return', taskId: 'TSK-live-flow', target: 'session-flow', at: Date.now(),
      deliveredAt: new Date().toISOString(),
      progressRefs: ['L23 passed'],
    })
    await wait(protocol.LIVE_MERGE_MS + 40)
    const afterReturn = one.frames.filter((x) => x.includes('event: change')).length
    const accepted = await projection.applyProjection(betaRoot, {
      kind: 'verdict', taskId: 'TSK-live-flow', verdict: 'pass',
      verifiedAt: new Date().toISOString(),
      basis: ['EVD-live'], actor: 'session-independent', acceptanceSession: 'session-independent',
      productConfirmation: '用户确认 live flow', verificationRefs: ['L23 passed'],
      exampleResults: ['EX-live | pass | EVD-live | live flow 通过'],
    })
    await wait(protocol.LIVE_MERGE_MS + 40)
    const afterAccept = one.frames.filter((x) => x.includes('event: change')).length
    if (dispatched.ok === true && returned.ok === true && accepted.ok === true
      && afterDispatch === 1 && afterReturn === 2 && afterAccept === 3) {
      ok('L23 ✓ 派发 / 回传 / 验收三条真实投影路径逐次触达流（每一步都有 change）')
    } else {
      bad(`L23 · projections=${JSON.stringify([dispatched.ok, returned.ok, accepted.ok])} frames=${afterDispatch}/${afterReturn}/${afterAccept} reasons=${JSON.stringify([dispatched.reason, returned.reason, accepted.reason])}`)
    }
    detach()
    hub.dispose()
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}

console.log(`\nLive route：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处${fail > 0 ? ` · 没过 ${fail} 处` : ''} · 跳过 0 处`)
process.exitCode = fail > 0 ? 1 : 0

