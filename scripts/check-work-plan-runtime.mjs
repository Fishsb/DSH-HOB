#!/usr/bin/env node
/**
 * WorkPlan 运行态行为判据（真编排器 + 假宿主）。
 *
 * 与 check-work-plan-dispatch 的区别：本族直载 `apply()`，用真实 `watches`、
 * 真实计划落盘和真实 `settle()` 路径，证明：
 * · 单会话档不能靠第二个计划绕过一轨上限；
 * · 多会话首波两轨都派出，未回传前不进入 joining；
 * · 回传后依赖轨自动起步；
 * · 全部轨道返回后才收口到 joining；
 * · 单写轨约束跨计划生效。
 *
 * ⚠ 本族仍不替代真实 DSH 宿主验收；它证明的是代码行为，不是宿主装得起来。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const mod = await import(pathToFileURL(join(root, 'src', 'modules', 'orchestrator.ts')).href)

let pass = 0
let fail = 0
const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail++; console.log(`  ✗ ${m}`) }

const wsRoot = mkdtempSync(join(tmpdir(), 'hob-plan-ws-'))
const ledgerHome = mkdtempSync(join(tmpdir(), 'hob-plan-ledgers-'))
const ledgerRoot = join(ledgerHome, 'work-plan-runtime')
const hosts = []

const track = (id, overrides = {}) => ({
  trackId: id,
  taskId: `TSK-${id}`,
  sessionId: `session-${id}`,
  goal: `goal-${id}`,
  scopePaths: [`src/${id}/`],
  accessType: 'read',
  dependsOn: [],
  budget: 'tool_calls=10 · rounds=1',
  acceptance: [`check-${id}`],
  message: `do-${id}`,
  ...overrides,
})

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r))
}

/** 只数真实派单；回执（`receipt`）不算。 */
const sent = (h) => h.delivered.filter((x) => x.receipt !== true)

function makeHost(mode = 'multi') {
  const sessions = new Map()
  const agents = new Map()
  const pending = []
  const services = {}
  /** 每个宿主实例独立账本，避免前一个用例的计划污染后一个。 */
  const caseRoot = mkdtempSync(join(tmpdir(), 'hob-plan-case-'))
  const delivered = []
  const addSession = (id) => {
    sessions.set(id, { header: { cwd: wsRoot }, log: [] })
    agents.set(id, { status: 'idle' })
  }
  for (const id of ['session-hob', 'session-a', 'session-b', 'session-c']) addSession(id)
  const bus = {
    async deliver(target, message) {
      delivered.push({ target, message })
      agents.get(target).status = 'running'
      return { ok: true, messageId: `m-${delivered.length}` }
    },
    async deliverInternal(target, message) {
      delivered.push({ target, message, receipt: true })
      return { ok: true }
    },
    presetOf() { return { preset: 'hob', source: 'projection' } },
  }
  Object.assign(services, {
    sessions: { get: (id) => sessions.get(id) },
    agents: { get: (id) => agents.get(id) },
    hobBus: bus,
    hobSessionPolicy: { of: () => ({ workMode: mode }) },
    loader: { entries: () => [{ options: { ledgerHome: caseRoot } }] },
    webServer: { get: () => undefined, route: () => undefined },
    tools: { get: () => undefined },
  })
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    sessions: services.sessions,
    agents: services.agents,
    get: (n) => services[n],
    /** 与 cordis 的 effect 语义一致：回调立即执行，返回的清理函数登记起来。 */
    effect: (fn) => {
      const cleanup = fn()
      if (typeof cleanup === 'function') pending.push(cleanup)
    },
    inject: (_names, cb) => cb(ctx),
    provide: (name, value) => { services[name] = value },
    on: () => { /* 不接宿主事件 */ },
  }
  mod.apply(ctx)
  const h = {
    ctx, services, agents, sessions, delivered, caseRoot, pending,
    ledgerRoot: join(caseRoot, 'ws'), orch: services.hobOrchestrator,
  }
  hosts.push(h)
  return h
}

const planInput = (overrides = {}) => ({
  planId: 'WP-runtime-1',
  changeId: 'CHG-runtime',
  mode: 'multi',
  rationale: 'two disjoint read-only tracks',
  tracks: [track('a'), track('b')],
  joinPolicy: 'all',
  joinOwnerSessionId: 'session-hob',
  ...overrides,
})

try {
  // WPR-1 多会话首波两轨都派，join 仍 waiting
  {
    const h = makeHost('multi')
    const r = await h.orch.dispatchPlan(planInput(), { self: 'session-hob', wsRoot, mode: 'multi' })
    if (r.ok && r.accepted === 2 && r.join?.state === 'waiting'
      && h.delivered.length === 2) {
      ok('WPR-1 ✓ 多会话首波真派两条执行轨，未回传前 join=waiting')
    } else bad(`WPR-1 · ${JSON.stringify(r)} delivered=${JSON.stringify(h.delivered.map((x) => [x.target, x.receipt === true]))}`)
  }

  // WPR-2 单会话第二轨被工具层纯函数拒绝
  {
    const h = makeHost('single')
    const r = await h.orch.dispatchPlan(planInput({ mode: 'single' }), { self: 'session-hob', wsRoot, mode: 'single' })
    if (!r.ok && r.problems?.some((p) => p.code === 'single-mode-one-track')
      && h.delivered.length === 0) {
      ok('WPR-2 ✓ 单会话 + 两轨 ⇒ 没有任何投递')
    } else bad(`WPR-2 · ${JSON.stringify(r)} delivered=${h.delivered.length}`)
  }

  // WPR-3 单会话已经有一条活动轨 ⇒ 第二份计划也不能派
  {
    const h = makeHost('single')
    const first = await h.orch.dispatchPlan(planInput({
      planId: 'WP-single-1', mode: 'single', tracks: [track('a')],
    }), { self: 'session-hob', wsRoot, mode: 'single' })
    const second = await h.orch.dispatchPlan(planInput({
      planId: 'WP-single-2', mode: 'single', tracks: [track('c')],
    }), { self: 'session-hob', wsRoot, mode: 'single' })
    if (first.ok && !second.ok && second.problems?.some((p) => p.code === 'single-mode-one-track')
      && h.delivered.length === 1) {
      ok('WPR-3 ✓ 单会话跨计划仍只有一个执行轨')
    } else bad(`WPR-3 · first=${JSON.stringify(first)} second=${JSON.stringify(second)} delivered=${JSON.stringify(h.delivered.map((x) => [x.target, x.receipt === true]))}`)
  }

  // WPR-4 依赖轨首波不派，回传后由推进器自动派
  {
    const h = makeHost('multi')
    const r = await h.orch.dispatchPlan(planInput({
      planId: 'WP-dep',
      tracks: [track('a'), track('b', { dependsOn: ['a'] })],
    }), { self: 'session-hob', wsRoot, mode: 'multi' })
    const firstDelivered = h.delivered.length
    // 模拟 A 跑完：宿主状态 idle，走真实 settle 路径由 reconcile 读取。
    h.sessions.get('session-a').log.push({ type: 'assistant/message', time: Date.now(), text: 'done a' })
    h.agents.get('session-a').status = 'idle'
    await h.orch.reconcile('test-relay')
    await flush()
    const after = await h.orch.workPlans({ self: 'session-hob', wsRoot, mode: 'multi' })
    const deliveredB = h.delivered.some((x) => x.target === 'session-b')
    if (r.ok && firstDelivered === 1 && deliveredB
      && after.plans[0]?.state !== 'joining') {
      ok('WPR-4 ✓ A 回传后依赖轨 B 自动起步，且计划还没提前 joining')
    } else bad(`WPR-4 · first=${JSON.stringify(r)} delivered=${JSON.stringify(h.delivered.map((x) => x.target))} plans=${JSON.stringify(after)}`)
  }

  // WPR-5 两轨都回传后才 joining
  {
    const h = makeHost('multi')
    await h.orch.dispatchPlan(planInput({ planId: 'WP-join' }), { self: 'session-hob', wsRoot, mode: 'multi' })
    for (const id of ['session-a', 'session-b']) {
      h.sessions.get(id).log.push({ type: 'assistant/message', time: Date.now(), text: `done ${id}` })
      h.agents.get(id).status = 'idle'
      await h.orch.reconcile(`relay-${id}`)
    }
    await flush()
    const after = await h.orch.workPlans({ self: 'session-hob', wsRoot, mode: 'multi' })
    if (after.plans.some((p) => p.planId === 'WP-join' && p.state === 'joining' && p.returned === 2)) {
      ok('WPR-5 ✓ 全部轨道返回后计划才进入 joining')
    } else bad(`WPR-5 · ${JSON.stringify(after)}`)
  }

  // WPR-6 两个写轨跨计划被拒
  {
    const h = makeHost('multi')
    const first = await h.orch.dispatchPlan(planInput({
      planId: 'WP-write-1', singleTrackReason: 'single-acceptance-unit',
      tracks: [track('a', { accessType: 'write' })],
    }), { self: 'session-hob', wsRoot, mode: 'multi' })
    const second = await h.orch.dispatchPlan(planInput({
      planId: 'WP-write-2', singleTrackReason: 'single-acceptance-unit',
      tracks: [track('c', { accessType: 'write' })],
    }), { self: 'session-hob', wsRoot, mode: 'multi' })
    if (first.ok && !second.ok && second.problems?.some((p) => p.code === 'multiple-write-tracks')) {
      ok('WPR-6 ✓ 同一工作区不能跨计划开第二条写轨')
    } else bad(`WPR-6 · first=${JSON.stringify(first)} second=${JSON.stringify(second)}`)
  }

  // WPR-8 全部返回只到 joining；收口必须由汇合责任人显式完成
  {
    const h = makeHost('multi')
    await h.orch.dispatchPlan(planInput({ planId: 'WP-close' }), { self: 'session-hob', wsRoot, mode: 'multi' })
    for (const id of ['session-a', 'session-b']) {
      h.sessions.get(id).log.push({ type: 'assistant/message', time: Date.now(), text: `done ${id}` })
      h.agents.get(id).status = 'idle'
      await h.orch.reconcile(`relay-${id}`)
    }
    await flush()
    const before = await h.orch.workPlans({ self: 'session-hob', wsRoot, mode: 'multi' })
    const outsider = await h.orch.closePlan('WP-close', 'session-a')
    const owner = await h.orch.closePlan('WP-close', 'session-hob')
    const after = await h.orch.workPlans({ self: 'session-hob', wsRoot, mode: 'multi' })
    const done = after.plans.find((p) => p.planId === 'WP-close')
    if (before.plans.find((p) => p.planId === 'WP-close')?.state === 'joining'
      && outsider.ok === false && String(outsider.reason).includes('汇合责任人')
      && owner.ok === true && done?.state === 'completed') {
      ok('WPR-8 ✓ 全部返回只到 joining；非汇合责任人拒收口，汇合责任人显式收成 completed')
    } else bad(`WPR-8 · before=${JSON.stringify(before)} outsider=${JSON.stringify(outsider)} owner=${JSON.stringify(owner)} after=${JSON.stringify(after)}`)
  }

  // WPR-9 失败计划仍占着单会话槽，不能借“失败”再开第二轨
  {
    const h = makeHost('single')
    const first = await h.orch.dispatchPlan(planInput({
      planId: 'WP-failed-1', mode: 'single', tracks: [track('a')],
    }), { self: 'session-hob', wsRoot, mode: 'single' })
    // 让第一份计划落成 failed：直接改盘上的计划文件，模拟首波失败后的真实状态
    const { readFileSync, writeFileSync, readdirSync } = await import('node:fs')
    const { join } = await import('node:path')
    const scan = (dir) => readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) => entry.isDirectory()
        ? scan(join(dir, entry.name))
        : (entry.name.endsWith('.json') ? [join(dir, entry.name)] : []))
    const file = scan(h.caseRoot).find((name) => name.includes('WP-failed-1'))
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    saved.plan.state = 'failed'
    writeFileSync(file, JSON.stringify(saved, null, 2) + '\n')
    const second = await h.orch.dispatchPlan(planInput({
      planId: 'WP-failed-2', mode: 'single', tracks: [track('c')],
    }), { self: 'session-hob', wsRoot, mode: 'single' })
    if (first.ok && !second.ok && second.problems?.some((p) => p.code === 'single-mode-one-track')) {
      ok('WPR-9 ✓ 失败计划仍占单会话执行槽，第二轨不能借失败绕过')
    } else bad(`WPR-9 · first=${JSON.stringify(first)} second=${JSON.stringify(second)}`)
  }

  // WPR-10 回传写回必须能从盘上读回，不只是在内存里看见
  {
    const h = makeHost('multi')
    await h.orch.dispatchPlan(planInput({ planId: 'WP-disk' }), { self: 'session-hob', wsRoot, mode: 'multi' })
    for (const id of ['session-a', 'session-b']) {
      h.sessions.get(id).log.push({ type: 'assistant/message', time: Date.now(), text: `done ${id}` })
      h.agents.get(id).status = 'idle'
      await h.orch.reconcile(`relay-${id}`)
    }
    await h.orch.workPlans({ self: 'session-hob', wsRoot, mode: 'multi' })
    const { readFileSync, readdirSync } = await import('node:fs')
    const { join } = await import('node:path')
    const scan = (dir) => readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) => entry.isDirectory()
        ? scan(join(dir, entry.name))
        : (entry.name.endsWith('.json') ? [join(dir, entry.name)] : []))
    const file = scan(h.caseRoot).find((name) => name.includes('WP-disk'))
    const onDisk = file === undefined ? undefined : JSON.parse(readFileSync(file, 'utf8')).plan
    const states = onDisk?.trackStates ?? {}
    if (onDisk?.planId === 'WP-disk' && states.a === 'returned' && states.b === 'returned'
      && onDisk.state === 'joining') {
      ok('WPR-10 ✓ 回传终态真写回盘上的 trackStates，计划为 joining')
    } else bad(`WPR-10 · file=${file ?? '(none)'} plan=${JSON.stringify(onDisk)}`)
  }

  // WPR-11 真 status() 显示真实计划，不是只有假编排器夹具
  {
    const h = makeHost('multi')
    await h.orch.dispatchPlan(planInput({ planId: 'WP-status' }), { self: 'session-hob', wsRoot, mode: 'multi' })
    const snap = h.orch.status({ wsRoot, self: 'session-hob' })
    const plan = snap.workPlans?.plans.find((p) => p.planId === 'WP-status')
    if (plan?.state === 'running' && plan.trackCount === 2 && plan.running === 2) {
      ok('WPR-11 ✓ 真 status() 的 workPlans 显示真实计划与两条运行轨')
    } else bad(`WPR-11 · ${JSON.stringify(snap.workPlans)}`)
  }

  // WPR-12 重启后读到“失败且全轨终态”的计划 ⇒ 自动归档，不永久占槽
  {
    const h = makeHost('single')
    const first = await h.orch.dispatchPlan(planInput({
      planId: 'WP-failed-archive', mode: 'single', tracks: [track('a')],
    }), { self: 'session-hob', wsRoot, mode: 'single' })
    // 造出重启后可能出现的现场：盘上已经是 failed，且唯一轨道已是 failed。
    const { readFileSync, writeFileSync, readdirSync, existsSync } = await import('node:fs')
    const scan = (dir) => readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) => entry.isDirectory()
        ? scan(join(dir, entry.name))
        : (entry.name.endsWith('.json') ? [join(dir, entry.name)] : []))
    const file = scan(h.caseRoot).find((name) => name.includes('WP-failed-archive'))
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    saved.plan.state = 'failed'
    saved.plan.trackStates = { a: 'failed' }
    writeFileSync(file, JSON.stringify(saved, null, 2) + '\n')
    // 触发唯一推进器（workPlans 读前推进）；这里不改内存 watch，模拟重载后内存为空。
    const after = await h.orch.workPlans({ self: 'session-hob', wsRoot, mode: 'single' })
    const stillActive = existsSync(file)
    const closedFile = scan(h.caseRoot).find((name) => name.includes('completed')
      && name.includes('WP-failed-archive'))
    const closed = existsSync(closedFile)
      ? JSON.parse(readFileSync(closedFile, 'utf8')).plan : undefined
    // 槽位释放：同一会话现在可以再派一条单会话轨。
    const second = await h.orch.dispatchPlan(planInput({
      planId: 'WP-after-failed', mode: 'single', tracks: [track('c')],
    }), { self: 'session-hob', wsRoot, mode: 'single' })
    const shown = after.plans.find((p) => p.planId === 'WP-failed-archive')
    if (first.ok && !stillActive && closed?.state === 'failed' && second.ok
      && shown?.state === 'failed') {
      ok('WPR-12 ✓ 失败且全轨终态的计划自动归档到 completed，活动文件消失并释放单会话槽')
    } else bad(`WPR-12 · active=${stillActive} closed=${JSON.stringify(closed)} second=${JSON.stringify(second)} shown=${JSON.stringify(shown)}`)
  }

  // WPR-13 重启恢复：盘上已有 returned、内存没有 watch ⇒ 仍能推进到 joining
  {
    const h = makeHost('multi')
    await h.orch.dispatchPlan(planInput({ planId: 'WP-restart-returned' }), { self: 'session-hob', wsRoot, mode: 'multi' })
    const { readFileSync, writeFileSync, readdirSync } = await import('node:fs')
    const scan = (dir) => readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) => entry.isDirectory()
        ? scan(join(dir, entry.name))
        : (entry.name.endsWith('.json') ? [join(dir, entry.name)] : []))
    const file = scan(h.caseRoot).find((name) => name.includes('WP-restart-returned'))
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    // 模拟重启：盘上已有终态，进程内 watch 不可用（不向 sessions/agents 注入 running）
    saved.plan.trackStates = { a: 'returned', b: 'returned' }
    saved.plan.state = 'running'
    writeFileSync(file, JSON.stringify(saved, null, 2) + '\n')
    const after = await h.orch.workPlans({ self: 'session-hob', wsRoot, mode: 'multi' })
    const shown = after.plans.find((p) => p.planId === 'WP-restart-returned')
    if (shown?.state === 'joining' && shown.returned === 2) {
      ok('WPR-13 ✓ 盘上已有 returned、内存无 watch ⇒ 重启恢复后仍推进到 joining')
    } else bad(`WPR-13 · ${JSON.stringify(shown)}`)
  }

  // WPR-20 重叠写轨端到端：只投首条，第二条等第一条回传后才投
  {
    const h = makeHost('multi')
    const r = await h.orch.dispatchPlan(planInput({
      planId: 'WP-overlap-e2e',
      tracks: [
        track('a', { accessType: 'write', scopePaths: ['src/shared/'] }),
        track('b', { accessType: 'write', scopePaths: ['src/shared/work-plan.ts'] }),
      ],
    }), { self: 'session-hob', wsRoot, mode: 'multi' })
    /** ⚠ 只数真派单；`session-hob` 那条是回执（receipt），不是投给执行会话的活。 */
    const afterFirst = sent(h).map((x) => x.target)
    h.sessions.get('session-a').log.push({ type: 'assistant/message', time: Date.now(), text: 'done a' })
    h.agents.get('session-a').status = 'idle'
    await h.orch.reconcile('relay-overlap-a')
    await flush()
    const afterSecond = sent(h).map((x) => x.target)
    const snap = await h.orch.workPlans({ self: 'session-hob', wsRoot, mode: 'multi' })
    const shown = snap.plans.find((p) => p.planId === 'WP-overlap-e2e')
    if (r.ok && r.accepted === 1 && JSON.stringify(afterFirst) === '["session-a"]'
      && JSON.stringify(afterSecond) === '["session-a","session-b"]'
      && shown?.singleTrackReason === 'same-file' && shown?.returned === 1) {
      ok('WPR-20 ✓ 重叠写轨端到端：首波只投 a，a 回传后才投 b，计划记为 same-file')
    } else bad(`WPR-20 · r=${JSON.stringify(r)} first=${JSON.stringify(afterFirst)} second=${JSON.stringify(afterSecond)} shown=${JSON.stringify(shown)}`)
  }

  // WPR-21 经只读轨的传递依赖不得端到端死锁（第二轮独立验收发现的残留）
  {
    const h = makeHost('multi')
    const r = await h.orch.dispatchPlan(planInput({
      planId: 'WP-cross-access',
      tracks: [
        track('b', { accessType: 'write', dependsOn: ['r'] }),
        track('a', { accessType: 'write' }),
        track('r', { accessType: 'read', dependsOn: ['a'] }),
      ],
    }), { self: 'session-hob', wsRoot, mode: 'multi' })
    const delivered = sent(h).map((x) => x.target)
    const snap = await h.orch.workPlans({ self: 'session-hob', wsRoot, mode: 'multi' })
    const shown = snap.plans.find((p) => p.planId === 'WP-cross-access')
    if (r.ok && r.accepted === 1 && JSON.stringify(delivered) === '["session-a"]'
      && shown?.state === 'running' && shown?.running === 1) {
      ok('WPR-21 ✓ 跨访问类型传递依赖：首波真投 a，b 与 r 等待，计划不空转')
    } else bad(`WPR-21 · r=${JSON.stringify(r)} delivered=${JSON.stringify(delivered)} shown=${JSON.stringify(shown)}`)
  }

  // WPR-18 逆序依赖的多写轨：串行化后不得死锁，首波真的派出一条
  {
    const h = makeHost('multi')
    const r = await h.orch.dispatchPlan(planInput({
      planId: 'WP-reverse-writes',
      tracks: [
        track('a', { accessType: 'write', dependsOn: ['b'] }),
        track('b', { accessType: 'write' }),
      ],
    }), { self: 'session-hob', wsRoot, mode: 'multi' })
    const delivered = h.delivered.map((x) => x.target)
    const snap = await h.orch.workPlans({ self: 'session-hob', wsRoot, mode: 'multi' })
    const shown = snap.plans.find((p) => p.planId === 'WP-reverse-writes')
    if (r.ok && r.accepted === 1 && JSON.stringify(delivered) === '["session-b"]'
      && shown?.state === 'running' && shown?.running === 1 && shown?.waiting === 1) {
      ok('WPR-18 ✓ 逆序依赖的多写轨不死锁：首波真投 b，a 等待，计划 running 而非空转')
    } else bad(`WPR-18 · r=${JSON.stringify(r)} delivered=${JSON.stringify(delivered)} shown=${JSON.stringify(shown)}`)
  }

  // WPR-19 空首波不得被判成"派成功"：环/全等待的计划必须明确失败
  {
    const h = makeHost('multi')
    const r = await h.orch.dispatchPlan(planInput({
      planId: 'WP-all-waiting',
      tracks: [
        track('a', { dependsOn: ['b'] }),
        track('b', { dependsOn: ['a'] }),
      ],
    }), { self: 'session-hob', wsRoot, mode: 'multi' })
    if (!r.ok && r.accepted === 0 && h.delivered.length === 0
      && r.problems?.some((p) => p.code === 'dependency-cycle')) {
      ok('WPR-19 ✓ 依赖成环 ⇒ 计划被拒、零投递（⛔ 不产出永远 running 的空计划）')
    } else bad(`WPR-19 · r=${JSON.stringify(r)} delivered=${h.delivered.length}`)
  }

  // WPR-24 用轨道 taskId 判决：judge 先解析到执行会话再落账
  {
    const h = makeHost('multi')
    await h.orch.dispatchPlan(planInput({ planId: 'WP-judge-track' }), { self: 'session-hob', wsRoot, mode: 'multi' })
    for (const id of ['session-a', 'session-b']) {
      h.sessions.get(id).log.push({ type: 'assistant/message', time: Date.now(), text: `done ${id}` })
      h.agents.get(id).status = 'idle'
      await h.orch.reconcile(`relay-${id}`)
    }
    await flush()
    /** ⚠ 传的是 track 的 taskId（TSK-a），不是执行会话 id。 */
    const r = h.orch.judge({
      self: 'session-hob',
      target: 'TSK-a',
      verdict: 'accepted',
      basis: ['track output'],
      verifiedAt: new Date().toISOString(),
    })
    if (r.ok && r.state === 'accepted') {
      ok('WPR-24 ✓ 判决可直接传轨道的 taskId：先解析到执行会话，再落 accepted')
    } else bad(`WPR-24 · ${JSON.stringify(r)}`)
  }

  // WPR-22 合法 same-file 单轨能在派单层走通（证据必须真的被接受，不是门恒拒）
  {
    const h = makeHost('multi')
    const r = await h.orch.dispatchPlan(planInput({
      planId: 'WP-same-file-ok',
      tracks: [track('a', { accessType: 'write', scopePaths: ['src/shared/'] })],
      singleTrackReason: 'same-file',
      singleTrackEvidence: {
        piecePaths: {
          parser: ['src/shared/work-plan.ts'],
          writer: ['src/shared/work-plan.ts', 'src/shared/state.ts'],
        },
      },
    }), { self: 'session-hob', wsRoot, mode: 'multi' })
    if (r.ok && r.accepted === 1 && sent(h).length === 1) {
      ok('WPR-22 ✓ 合法 same-file 证据（两个片段真写同一文件）⇒ 单轨真的派出去')
    } else bad(`WPR-22 · r=${JSON.stringify(r)} delivered=${sent(h).length}`)
  }

  // WPR-23 自述式证据不能被派单层接受（门不是恒放行）
  {
    const h = makeHost('multi')
    const r = await h.orch.dispatchPlan(planInput({
      planId: 'WP-same-file-spoof',
      tracks: [track('a', { accessType: 'write', scopePaths: ['src/shared/'] })],
      singleTrackReason: 'same-file',
      singleTrackEvidence: { mergedPieces: ['p1', 'p2'], sharedPaths: ['src/shared', 'src/shared/x.ts'] },
    }), { self: 'session-hob', wsRoot, mode: 'multi' })
    if (!r.ok && sent(h).length === 0
      && r.problems?.some((p) => p.code === 'unverified-single-track-reason')) {
      ok('WPR-23 ✓ 只写 mergedPieces/sharedPaths 的 same-file ⇒ 零投递（不是恒放行）')
    } else bad(`WPR-23 · r=${JSON.stringify(r)} delivered=${sent(h).length}`)
  }

  // WPR-14 旧单目标派单 ⇒ 自动生成隐式单轨计划，旧调用不中断
  {
    const h = makeHost('auto')
    const r = await h.orch.dispatch('session-a', 'legacy one target', { self: 'session-hob', task: 'TSK-legacy' })
    await flush()
    const snap = await h.orch.workPlans({ self: 'session-hob', wsRoot, mode: 'auto' })
    const implicit = snap.plans.find((p) => p.planId.startsWith('WP-implicit-'))
    if (r.ok && implicit !== undefined && implicit.trackCount === 1
      && implicit.tracks?.[0]?.sessionId === 'session-a'
      && implicit.tracks?.[0]?.taskId === 'TSK-legacy') {
      ok('WPR-14 ✓ 旧单目标派单仍成功，并自动落成一条隐式单轨计划')
    } else bad(`WPR-14 · r=${JSON.stringify(r)} plans=${JSON.stringify(snap.plans)}`)
  }

  // WPR-15 模式冻结：计划落盘时带 modeSnapshot，之后会话改档不改本计划
  {
    const h = makeHost('multi')
    const r = await h.orch.dispatchPlan(planInput({ planId: 'WP-freeze' }), { self: 'session-hob', wsRoot, mode: 'multi' })
    const { readFileSync, readdirSync } = await import('node:fs')
    const scan = (dir) => readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) => entry.isDirectory()
        ? scan(join(dir, entry.name))
        : (entry.name.endsWith('.json') ? [join(dir, entry.name)] : []))
    const file = scan(h.caseRoot).find((name) => name.includes('WP-freeze'))
    const onDisk = file === undefined ? undefined : JSON.parse(readFileSync(file, 'utf8')).plan
    /** 会话此刻已改成单会话档；计划仍按快照显示多会话。 */
    h.services.hobSessionPolicy = { of: () => ({ workMode: 'single' }) }
    const snap = await h.orch.workPlans({ self: 'session-hob', wsRoot, mode: 'single' })
    const shown = snap.plans.find((p) => p.planId === 'WP-freeze')
    if (r.ok && onDisk?.modeSnapshot === 'multi' && shown?.modeSnapshot === 'multi') {
      ok('WPR-15 ✓ 计划落盘带 modeSnapshot；会话改档后本计划仍显示创建时的档位')
    } else bad(`WPR-15 · disk=${JSON.stringify(onDisk?.modeSnapshot)} shown=${JSON.stringify(shown?.modeSnapshot)} r=${JSON.stringify(r)}`)
  }

  // WPR-16 收口不等于验收：plan-complete 不产生验收单元
  {
    const h = makeHost('multi')
    await h.orch.dispatchPlan(planInput({ planId: 'WP-no-acc' }), { self: 'session-hob', wsRoot, mode: 'multi' })
    for (const id of ['session-a', 'session-b']) {
      h.sessions.get(id).log.push({ type: 'assistant/message', time: Date.now(), text: `done ${id}` })
      h.agents.get(id).status = 'idle'
      await h.orch.reconcile(`relay-${id}`)
    }
    await flush()
    const { readdirSync } = await import('node:fs')
    /** 账本区里除了运行态之外，收口前后文件清单必须完全一致。 */
    const snapshotUnits = () => {
      try {
        const out = []
        const walk = (dir) => {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === 'runtime') continue
            const full = join(dir, entry.name)
            if (entry.isDirectory()) walk(full)
            else out.push(full)
          }
        }
        walk(h.caseRoot)
        return out.sort()
      } catch { return [] }
    }
    const before = snapshotUnits()
    const closed = await h.orch.closePlan('WP-no-acc', 'session-hob')
    const after = snapshotUnits()
    const text = JSON.stringify(closed)
    if (closed.ok && JSON.stringify(before) === JSON.stringify(after)
      && !/acceptance|verified|ACC-/i.test(text)) {
      ok('WPR-16 ✓ 汇合收口只把计划置 completed，不写任何验收单元（回传 ≠ 通过）')
    } else bad(`WPR-16 · closed=${text} changed=${JSON.stringify(after.filter((x) => !before.includes(x)))}`)
  }

  // WPR-17 收口前必须是 joining：早收口被拒（不能把"派出去了"当完成）
  {
    const h = makeHost('multi')
    await h.orch.dispatchPlan(planInput({ planId: 'WP-early-close' }), { self: 'session-hob', wsRoot, mode: 'multi' })
    const early = await h.orch.closePlan('WP-early-close', 'session-hob')
    if (!early.ok && String(early.reason).includes('joining')) {
      ok('WPR-17 ✓ 未汇合就收口被拒：只有 joining 才能 completed')
    } else bad(`WPR-17 · ${JSON.stringify(early)}`)
  }

  // WPR-25 重启后 watch 丢失：目标日志已 completed ⇒ 计划轨道必须结算为 returned
  {
    const h = makeHost('multi')
    const plan = {
      version: 1, planId: 'WP-log-fallback', changeId: 'CHG-runtime', mode: 'multi',
      modeSnapshot: 'multi', workspaceRoot: wsRoot, rationale: 'restart fallback',
      tracks: [track('a'), track('b')], joinPolicy: 'all', joinOwnerSessionId: 'session-hob',
      state: 'running', createdAt: 1, trackStates: { a: 'running', b: 'running' },
    }
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const dir = join(h.caseRoot, basename(wsRoot), 'runtime', 'work-plans', 'active')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'WP-log-fallback.json'), JSON.stringify({ storeVersion: 1, plan }, null, 2) + '\n')
    for (const id of ['session-a', 'session-b']) {
      h.sessions.get(id).log.push({ type: 'turn/end', time: 10, data: { reason: { kind: 'completed' } } })
      h.agents.get(id).status = 'idle'
    }
    const after = await h.orch.workPlans({ self: 'session-hob', wsRoot, mode: 'multi' })
    const shown = after.plans.find((p) => p.planId === 'WP-log-fallback')
    if (shown?.state === 'joining' && shown.returned === 2) {
      ok('WPR-25 ✓ 重启后 watch 缺失但目标日志已 completed ⇒ 两条轨都结算为 returned')
    } else bad(`WPR-25 · ${JSON.stringify(shown)}`)
  }

  // WPR-7 计划内两条写轨 ⇒ 串行成链，首波只派一条（不伪并行）
  {
    const h = makeHost('multi')
    const r = await h.orch.dispatchPlan(planInput({
      planId: 'WP-two-writes',
      tracks: [track('a', { accessType: 'write' }), track('b', { accessType: 'write' })],
    }), { self: 'session-hob', wsRoot, mode: 'multi' })
    const { readFileSync, readdirSync } = await import('node:fs')
    const scan = (dir) => readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) => entry.isDirectory()
        ? scan(join(dir, entry.name))
        : (entry.name.endsWith('.json') ? [join(dir, entry.name)] : []))
    const file = scan(h.caseRoot).find((name) => name.includes('WP-two-writes'))
    const onDisk = file === undefined ? undefined : JSON.parse(readFileSync(file, 'utf8')).plan
    const b = onDisk?.tracks?.find((x) => x.trackId === 'b')
    if (r.ok && r.accepted === 1 && h.delivered.length === 1
      && h.delivered[0]?.target === 'session-a'
      && onDisk?.singleTrackReason === 'strict-order'
      && JSON.stringify(b?.dependsOn) === '["a"]') {
      ok('WPR-7 ✓ 计划内两条写轨串成 a -> b，首波只投一条，并落盘串行原因')
    } else bad(`WPR-7 · ${JSON.stringify(r)} delivered=${JSON.stringify(h.delivered.map((x) => x.target))} plan=${JSON.stringify(onDisk)}`)
  }
} finally {
  for (const h of hosts) rmSync(h.caseRoot, { recursive: true, force: true })
  rmSync(wsRoot, { recursive: true, force: true })
  rmSync(ledgerHome, { recursive: true, force: true })
}

console.log(`\nWorkPlan 运行态：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处`
  + (fail > 0 ? ` · 没过 ${fail} 处` : '')
  + ' · 跳过 0 处')
process.exitCode = fail > 0 ? 1 : 0
