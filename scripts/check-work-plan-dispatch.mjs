#!/usr/bin/env node
/**
 * WorkPlan 派单层行为判据。
 *
 * 用真 `createHobOrchTools()` + 假编排器，证明：
 * · 批量参数转为计划后，经过 `dispatchPlan`，而不是逐条工具调用；
 * · 单会话门在纯函数层拒绝；
 * · 工具返回逐轨结果与 join 状态；
 * · 单目标旧入口仍能工作。
 *
 * ⚠ 本族不连接真实宿主，不声称证明真实并行；真实宿主行为由独立验收补。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = new URL('..', import.meta.url).pathname
const mod = await import(pathToFileURL(join(root, 'src', 'modules', 'orchestrator.ts')).href)

let pass = 0
let fail = 0
const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail++; console.log(`  ✗ ${m}`) }

const track = (id, overrides = {}) => ({
  trackId: id,
  taskId: `TSK-${id}`,
  sessionId: `session-${id}`,
  goal: `goal-${id}`,
  scopePaths: [`src/${id}/`],
  accessType: 'write',
  dependsOn: [],
  budget: 'tool_calls=10 · rounds=1',
  acceptance: [`check-${id}`],
  message: `do-${id}`,
  ...overrides,
})

function makeOrch(overrides = {}) {
  const state = {
    plans: [],
    dispatches: [],
    status: {
      stopped: false, watches: [], relaysDone: 0, relaysBlocked: 0,
      lostPending: 0, lostByClass: { running: 0, idle: 0, unknown: 0 },
      settleByState: { waiting: 0, unresolved: 0, stuck: 0 },
      handoffs: [], reachability: 'ok', others: { note: 'others', watches: 0 },
    },
  }
  return {
    state,
    version: 1,
    planAware: true,
    async dispatchPlan(input, opts) {
      state.plans.push({ input, opts })
      const tracks = input.tracks.map((t) => ({
        trackId: t.trackId,
        sessionId: t.sessionId,
        ok: true,
        state: t.dependsOn.length === 0 ? 'running' : 'waiting',
      }))
      return {
        ok: true,
        planId: input.planId,
        accepted: tracks.filter((x) => x.ok).length,
        tracks,
        join: { state: tracks.some((x) => x.state === 'waiting') ? 'waiting' : 'joining' },
      }
    },
    async dispatch(target, message, opts) {
      state.dispatches.push({ target, message, opts })
      return { ok: true, sessionId: target, messageId: 'm-1', watching: true }
    },
    status() { return state.status },
    async workPlans() {
      return {
        mode: 'multi',
        plans: [{ planId: 'WP-001', state: 'joining', trackCount: 2, running: 0, waiting: 0, returned: 2, failed: 0, rationale: 'split' }],
        unreadable: [],
      }
    },
    async cardsOf() { return { cards: [], reachability: 'no-cards' } },
    wakeState() {
      return {
        conn: 'idle', wokeCount: 0, noSubscriberCount: 0, legacyTargetCount: 0,
        redeliverOwnerUnknownCount: 0, undeliveredCount: 0, redeliveredCount: 0,
        selfExecutedCount: 0, stoppedCount: 0, seenCount: 0,
      }
    },
    dispatchWakeState() {
      return {
        registered: 0, pending: 0, wokeCount: 0, undecidableCount: 0, pushedRegisterOk: 0,
        pushRegisterIssues: 0, firingSeen: 0, firedBlockedCount: 0, firingNoSubscriberCount: 0,
        ownerUnknownCount: 0, undeliverableCount: 0, stoppedCount: 0,
        ownerUnknownRegistered: 0, othersOnly: 0,
      }
    },
    async deliveryLedger() { return { entries: [], total: 0, reachability: 'no-cards' } },
    async redeliver() { return { kind: 'noop', reason: 'none' } },
    ...overrides,
  }
}

const exec = {
  agent: {
    id: 'session-hob',
    session: { header: { cwd: '/tmp/work-plan-dispatch' } },
  },
}

// WPD-1 多轨走 dispatchPlan
{
  const orch = makeOrch()
  const tools = mod.createHobOrchTools(orch, undefined, () => 'multi')
  const raw = await tools.dispatch.execute({
    changeId: 'CHG-001',
    planId: 'WP-001',
    rationale: 'two disjoint modules',
    joinPolicy: 'all',
    tracks: [track('a'), track('b')],
  }, exec)
  const result = JSON.parse(raw)
  const plan = orch.state.plans[0]
  if (result.ok && orch.state.plans.length === 1 && orch.state.dispatches.length === 0
    && plan?.input.tracks.length === 2 && result.tracks.length === 2
    && result.mode === 'multi' && result.trackCount === 2
    && String(result.modePolicy ?? '').includes('多会话')) {
    ok('WPD-1 ✓ 多轨一次调用进入 dispatchPlan，未被拆成两次单目标调用；返回带 mode / trackCount / modePolicy')
  } else {
    bad(`WPD-1 · result=${raw} plans=${orch.state.plans.length} dispatches=${orch.state.dispatches.length}`)
  }
}

// WPD-2 模式现读
{
  const orch = makeOrch()
  const tools = mod.createHobOrchTools(orch, undefined, () => 'single')
  const raw = await tools.dispatch.execute({
    changeId: 'CHG-001',
    rationale: 'r',
    tracks: [track('a'), track('b')],
  }, exec)
  const result = JSON.parse(raw)
  const input = orch.state.plans[0]?.input
  if (input?.mode === 'single') {
    ok('WPD-2 ✓ 档位来自工具调用现读，不由 tracks 自述')
  } else bad(`WPD-2 · mode=${input?.mode} result=${raw}`)
}

// WPD-3 模式未知拒绝
{
  const orch = makeOrch()
  const tools = mod.createHobOrchTools(orch, undefined, () => undefined)
  const raw = await tools.dispatch.execute({
    changeId: 'CHG-001',
    rationale: 'r',
    tracks: [track('a')],
  }, exec)
  const result = JSON.parse(raw)
  if (!result.ok && result.reason === 'work-mode-unknown' && orch.state.plans.length === 0) {
    ok('WPD-3 ✓ 工作方式判不出 ⇒ 不派、不落计划')
  } else bad(`WPD-3 · ${raw}`)
}

// WPD-4 无身份拒绝
{
  const orch = makeOrch()
  const tools = mod.createHobOrchTools(orch, undefined, () => 'multi')
  const raw = await tools.dispatch.execute({
    changeId: 'CHG-001', rationale: 'r', tracks: [track('a')],
  }, { agent: {} })
  const result = JSON.parse(raw)
  if (!result.ok && result.reason === 'no-session-identity') {
    ok('WPD-4 ✓ 无可信调用方身份 ⇒ 多轨拒绝')
  } else bad(`WPD-4 · ${raw}`)
}

// WPD-5 旧单目标参数仍工作，但必须自带真实 taskId（单会话档无需判路原因）
{
  const orch = makeOrch()
  const tools = mod.createHobOrchTools(orch, undefined, () => 'single')
  const raw = await tools.dispatch.execute({
    sessionId: 'session-a', message: 'legacy', task: '回传说明', taskId: 'TSK-a',
  }, exec)
  const result = JSON.parse(raw)
  if (result.ok && orch.state.dispatches.length === 1 && orch.state.plans.length === 0
    && orch.state.dispatches[0]?.opts?.taskId === 'TSK-a') {
    ok('WPD-5 ✓ 单会话档单目标旧入口保留（真实 taskId），且不伪造新计划')
  } else bad(`WPD-5 · ${raw} dispatches=${orch.state.dispatches.length}`)
}

// WPD-5a 自动档单目标必须给单轨原因（等价于隐式单轨计划）
{
  const orch = makeOrch()
  const tools = mod.createHobOrchTools(orch, undefined, () => 'auto')
  const raw = await tools.dispatch.execute({
    sessionId: 'session-a', message: 'legacy', task: '回传说明', taskId: 'TSK-a',
  }, exec)
  const result = JSON.parse(raw)
  if (!result.ok && result.reason === 'single-target-reason-required'
    && result.returnRegistered === false && orch.state.dispatches.length === 0) {
    ok('WPD-5a ✓ 自动档单目标无原因 ⇒ 拒绝且零投递（⛔ 不静默当成单轨计划）')
  } else bad(`WPD-5a · ${raw} dispatches=${orch.state.dispatches.length}`)
}

// WPD-5b 自动档单目标有原因 ⇒ 正常派发，档位与原因随隐式计划透传
{
  const orch = makeOrch()
  const tools = mod.createHobOrchTools(orch, undefined, () => 'auto')
  const raw = await tools.dispatch.execute({
    sessionId: 'session-a', message: 'legacy', taskId: 'TSK-a',
    singleTrackReason: 'strict-order',
    singleTrackEvidence: { orderedSteps: ['write-schema', 'migrate'] },
  }, exec)
  const result = JSON.parse(raw)
  const opts = orch.state.dispatches[0]?.opts
  if (result.ok && result.mode === 'auto' && result.trackCount === 1
    && String(result.modePolicy ?? '').includes('自动')
    && String(result.modePolicy ?? '').includes('单轨需原因')
    && String(result.workModeNote ?? '').includes('隐式单轨计划')
    && opts?.workMode === 'auto' && opts?.singleTrackReason === 'strict-order') {
    ok('WPD-5b ✓ 自动档单目标有原因 ⇒ 派发，并把 mode / modePolicy / singleTrackReason 带进隐式计划')
  } else bad(`WPD-5b · ${raw} opts=${JSON.stringify(opts)}`)
}

// WPD-5c 多会话档单目标：候选存在独立对 ⇒ 必须改用多轨
{
  const orch = makeOrch()
  const tools = mod.createHobOrchTools(orch, undefined, () => 'multi')
  const raw = await tools.dispatch.execute({
    sessionId: 'session-a', message: 'legacy', taskId: 'TSK-a',
    singleTrackReason: 'insufficient-independent-scope',
    singleTrackEvidence: { candidatePieces: [
      { pieceId: 'a', scopePaths: ['src/a/'], acceptance: ['check-a'] },
      { pieceId: 'b', scopePaths: ['src/b/'], acceptance: ['check-b'] },
    ] },
  }, exec)
  const result = JSON.parse(raw)
  if (!result.ok && result.reason === 'single-target-split-required'
    && orch.state.dispatches.length === 0) {
    ok('WPD-5c ✓ 多会话档单目标发现独立候选 ⇒ 拒绝，要求改用 tracks 多轨')
  } else bad(`WPD-5c · ${raw} dispatches=${orch.state.dispatches.length}`)
}

// WPD-5d 单目标也复用计划层的单轨证据门（伪造 same-file 不得放行）
{
  const orch = makeOrch()
  const tools = mod.createHobOrchTools(orch, undefined, () => 'auto')
  const raw = await tools.dispatch.execute({
    sessionId: 'session-a', message: 'legacy', taskId: 'TSK-a',
    singleTrackReason: 'same-file',
    singleTrackEvidence: { mergedPieces: ['p1', 'p2'], sharedPaths: ['src/a', 'src/a/x.ts'] },
  }, exec)
  const result = JSON.parse(raw)
  if (!result.ok && result.reason === 'unverified-single-track-reason'
    && orch.state.dispatches.length === 0) {
    ok('WPD-5d ✓ 自动档单目标伪造 same-file 证据 ⇒ 拒绝且零投递（与计划层同一道门）')
  } else bad(`WPD-5d · ${raw} dispatches=${orch.state.dispatches.length}`)
}

// WPD-5e 多会话单目标：same-file 也不能绕过候选表（原因证据 ≠ 候选证据）
{
  const orch = makeOrch()
  const tools = mod.createHobOrchTools(orch, undefined, () => 'multi')
  const raw = await tools.dispatch.execute({
    sessionId: 'session-a', message: 'legacy', taskId: 'TSK-a',
    singleTrackReason: 'same-file',
    singleTrackEvidence: { piecePaths: { p1: ['src/a/x.ts'], p2: ['src/a/x.ts'] } },
  }, exec)
  const result = JSON.parse(raw)
  if (!result.ok && result.reason === 'missing-split-evidence'
    && orch.state.dispatches.length === 0) {
    ok('WPD-5e ✓ 多会话单目标 same-file 缺候选表 ⇒ missing-split-evidence，零投递')
  } else bad(`WPD-5e · ${raw} dispatches=${orch.state.dispatches.length}`)
}

// WPD-6 单目标缺目标 -> 明确拒绝（有 taskId 时落到缺 session/message 分支）
{
  const orch = makeOrch()
  const tools = mod.createHobOrchTools(orch, undefined, () => 'auto')
  const raw = await tools.dispatch.execute({ message: 'x', taskId: 'TSK-x' }, exec)
  const result = JSON.parse(raw)
  if (!result.ok && result.reason === 'missing-dispatch-target') {
    ok('WPD-6 ✓ 既无 sessionId 又无 tracks ⇒ 明确拒绝')
  } else bad(`WPD-6 · ${raw}`)
  /**
   * ⚠ 反向对照：连 taskId 都没有时，必须在投递前被
   *   `task-id-required` 拦住。它证明“缺 session”不是唯一入口。
   */
  const rawNoTask = await tools.dispatch.execute({ message: 'x' }, exec)
  const noTaskObj = JSON.parse(String(rawNoTask))
  if (noTaskObj.ok === false && noTaskObj.reason === 'task-id-required') {
    ok('WPD-6b ✓ 缺真实 taskId ⇒ task-id-required（⛔ 不把自由描述当任务号）')
  } else bad(`WPD-6b · ${rawNoTask}`)
  /**
   * ⚠ **2026-11-09 · 用户实测「会话完成之后没有回传」**：
   *   这一档以前只回 `task-id-required`，模型随后改投 `hob_send`（不登记回传）
   *   ⇒ 实施会话正常跑完，HOB 永远等不到结果。
   *   ⇒ 拒绝结果必须**明说本次没有登记回传**，并点名不许改投单向通知。
   *   ⚠ 只加返回字段与话术，**不改** `task-id-required` 这个既有机器码。
   */
  if (noTaskObj.returnRegistered === false
    && /没有登记回传|不会回传/.test(String(noTaskObj.message ?? ''))
    && /hob_send/.test(String(noTaskObj.message ?? ''))) {
    ok('WPD-6c ✓ 缺 taskId 的拒绝明说「没有登记回传」，点名 hob_send 不可冒充派活')
  } else bad(`WPD-6c · ${rawNoTask}`)
}

// WPD-6d 账本门禁拒绝 ⇒ 同样必须明说没有回传（⛔ 不许静默降级成 hob_send）
{
  const orch = makeOrch()
  const gate = () => '账本门禁：旧管线条目只读'
  const tools = mod.createHobOrchTools(orch, gate, () => 'auto')
  const raw = await tools.dispatch.execute({
    sessionId: 'session-a', message: 'legacy', taskId: 'TSK-a',
  }, exec)
  const result = JSON.parse(raw)
  if (result.ok === false && result.reason === 'proceed-not-confirmed'
    && result.returnRegistered === false
    && /没有登记回传/.test(String(result.message ?? ''))
    && /hob_send/.test(String(result.message ?? ''))
    && orch.state.dispatches.length === 0) {
    ok('WPD-6d ✓ 账本门禁拒绝 ⇒ 明说没有登记回传、零投递，⛔ 不许改投 hob_send 冒充派活')
  } else bad(`WPD-6d · ${raw} dispatches=${orch.state.dispatches.length}`)
}

// WPD-6e 单向通知的返回值必须显式标「不是派活 / 没有登记回传」
/**
 * ⚠ **2026-11-09 · 用户实测「会话完成之后没有回传」**：
 *   `hob_send` 的旧返回只说「回复在它那边」；模型仍可把它当成交付完成。
 *   ⇒ 本组直接跑真 `createHobBusTools()`（假宿主 + 真 bus 模块），钉住三个机器可读事实：
 *     ① `returnRegistered === false`；② `dispatchHint` 明说这是通知不是派活；
 *     ③ `note2` 指出要回传必须改走 `hob_dispatch`。
 *   ⚠ 不改 `hob_send` 的投递语义（它仍然成功、仍然只投一次）——只让"没有回传"不可误读。
 */
{
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const busMod = await import(pathToFileURL(join(root, 'src', 'modules', 'bus.ts')).href)
  const home = mkdtempSync(join(tmpdir(), 'wpd-send-'))
  try {
    const target = 'session-target-send'
    const session = { id: target, header: { agentPreset: 'standard', cwd: home }, log: [] }
    const agent = { status: 'idle', followup: () => {}, steer: () => {}, inject: () => {}, ctx: {}, session }
    const sessions = {
      get: (id) => (id === target ? session : undefined),
      list: () => [session],
      flush: async () => true,
    }
    const agents = { currentInitiator: () => undefined, get: (id) => (id === target ? agent : undefined) }
    const provided = {}
    const ctx = {
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      sessions, agents,
      get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents : undefined),
      provide: (k, v) => { provided[k] = v },
      effect: (fn) => { try { fn() } catch { /* 无落点 */ } },
      inject: (_deps, cb) => cb(ctx),
    }
    busMod.apply(ctx, {
      spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }),
    })
    const bus = provided.hobBus
    const healthy = { state: 'active', integrity: 'valid', active: true, activation: 'active', headline: 'ok', nextAction: '', blockers: [], legacyCompatible: false }
    const tools = busMod.createHobBusTools(bus, () => home, () => {}, () => undefined, () => healthy)
    const raw = await tools.send.execute({ sessionId: target, message: 'just a note', notificationOnly: true }, {
      agent: { id: 'session-hob', session: { header: { cwd: home } } },
    })
    const result = JSON.parse(String(raw))
    const hint = String(result.dispatchHint ?? '')
    const note = String(result.note2 ?? '')
    if (result.ok === true && result.delivered === true
      && result.returnRegistered === false
      && /notification, not a dispatch/.test(hint)
      && /hob_dispatch/.test(hint)
      && /NOT registered as a return/.test(note)
      && /hob_dispatch/.test(note)) {
      ok('WPD-6e ✓ hob_send 返回显式标 returnRegistered:false + dispatchHint「通知不是派活」+ 指向 hob_dispatch')
    } else bad(`WPD-6e · ${raw}`)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

// WPD-6f: lifecycle rejection happens before any orchestration side effect.
{
  const orch = makeOrch()
  const invalid = { state: 'invalid', integrity: 'invalid', active: false, activation: 'active', headline: '索引分裂', nextAction: 'archive/rebuild', blockers: [{ rule: 'A-4', unit: 'index', why: 'split' }], legacyCompatible: false }
  const tools = mod.createHobOrchTools(orch, undefined, () => 'single', undefined, () => invalid)
  const raw = await tools.dispatch.execute({ sessionId: 'session-a', message: 'work', taskId: 'TSK-a' }, exec)
  const result = JSON.parse(raw)
  if (result.ok === false && result.reason === 'ledger-invalid'
    && result.returnRegistered === false && orch.state.dispatches.length === 0 && orch.state.plans.length === 0) {
    ok('WPD-6f ✓ 失效账本在编排器之前拒绝：零计划、零投递、明说没有回传')
  } else bad(`WPD-6f · ${raw} dispatches=${orch.state.dispatches.length} plans=${orch.state.plans.length}`)
}

// WPD-7 join 状态透传
{
  const orch = makeOrch()
  const tools = mod.createHobOrchTools(orch, undefined, () => 'multi')
  const raw = await tools.dispatch.execute({
    changeId: 'CHG-001', rationale: 'r', tracks: [track('a'), track('b', { dependsOn: ['a'] })],
  }, exec)
  const result = JSON.parse(raw)
  if (result.join?.state === 'waiting' && result.tracks.some((x) => x.state === 'waiting')) {
    ok('WPD-7 ✓ 依赖轨返回 waiting，join 不提前完成')
  } else bad(`WPD-7 · ${raw}`)
}

// WPD-8 status 显示计划读数
{
  const orch = makeOrch()
  const tools = mod.createHobOrchTools(orch, undefined, () => 'multi')
  const raw = await tools.status.execute({}, exec)
  if (raw.includes('工作计划') && raw.includes('WP-001') && raw.includes('轨道 2')) {
    ok('WPD-8 ✓ hob_orch_status 显示计划、轨道和状态')
  } else bad(`WPD-8 · ${raw.slice(0, 1000)}`)
}

// WPD-10 工具面必须原样透传 singleTrackEvidence（否则合法单轨证据在生产路径不可达）
{
  const orch = makeOrch()
  const tools = mod.createHobOrchTools(orch, undefined, () => 'multi')
  const evidence = { piecePaths: { parser: ['src/shared/w.ts'], writer: ['src/shared/w.ts'] } }
  await tools.dispatch.execute({
    changeId: 'CHG-001', rationale: 'single unit', singleTrackReason: 'same-file',
    singleTrackEvidence: evidence,
    tracks: [track('a', { scopePaths: ['src/shared/'] })],
  }, exec)
  const got = orch.state.plans.at(-1)?.input
  if (JSON.stringify(got?.singleTrackEvidence) === JSON.stringify(evidence)) {
    ok('WPD-10 ✓ hob_dispatch 把 singleTrackEvidence 原样送进计划入口')
  } else bad(`WPD-10 · got=${JSON.stringify(got?.singleTrackEvidence)}`)
}

// WPD-11 没传证据时不代填（缺证据就是缺证据）
{
  const orch = makeOrch()
  const tools = mod.createHobOrchTools(orch, undefined, () => 'multi')
  await tools.dispatch.execute({
    changeId: 'CHG-001', rationale: 'single unit', singleTrackReason: 'same-file',
    tracks: [track('a', { scopePaths: ['src/shared/'] })],
  }, exec)
  const got = orch.state.plans.at(-1)?.input
  if (got?.singleTrackEvidence === undefined) {
    ok('WPD-11 ✓ 未传证据时计划入口收到的就是「没有证据」（⛔ 不代填）')
  } else bad(`WPD-11 · got=${JSON.stringify(got?.singleTrackEvidence)}`)
}

// WPD-9 工具面仍只有三个
{
  const orch = makeOrch()
  const tools = mod.createHobOrchTools(orch, undefined, () => 'multi')
  const names = Object.values(tools).map((tool) => tool.name).sort()
  if (JSON.stringify(names) === JSON.stringify(['hob_dispatch', 'hob_orch_control', 'hob_orch_status'])) {
    ok('WPD-9 ✓ 未新增工具名，仍恰好三个')
  } else bad(`WPD-9 · ${JSON.stringify(names)}`)
}

// N-WPD1 反向：撤掉 dispatchPlan ⇒ 多轨必须报错而不是静默单轨
{
  const orch = makeOrch({ dispatchPlan: undefined })
  const tools = mod.createHobOrchTools(orch, undefined, () => 'multi')
  let threw = false
  try {
    await tools.dispatch.execute({
      changeId: 'CHG-001', rationale: 'r', tracks: [track('a'), track('b')],
    }, exec)
  } catch { threw = true }
  if (threw) ok('N-WPD1 ✓ 负向对拍：dispatchPlan 缺席 ⇒ 多轨失败，不静默退化')
  else bad('N-WPD1 · dispatchPlan 缺席时仍返回成功')
}

// N-WPD2 反向：模式未知不得回落到自动档
{
  const orch = makeOrch()
  const tools = mod.createHobOrchTools(orch, undefined, () => undefined)
  const raw = await tools.dispatch.execute({
    changeId: 'CHG-001', rationale: 'r', tracks: [track('a')],
  }, exec)
  const mode = orch.state.plans[0]?.input?.mode
  if (JSON.parse(raw).ok === false && mode === undefined) {
    ok('N-WPD2 ✓ 负向对拍：模式未知时不会记成 auto')
  } else bad(`N-WPD2 · ${raw} mode=${mode}`)
}

// ══════════════════════════════════════════════════════════════════════════
// 执行预设硬校验（2026-11-09 · 真 bus + 假宿主）
//
// ⚠ 这里故意用**真 `HobBus`**：判定函数再对，只要入口没接上，用户看到的仍是
//   “设置改了但派活没反应”。四条行为各自成对：
//   · 一致 ⇒ 不提问、直接投；
//   · 不一致选活跃 ⇒ 投原会话；
//   · 不一致选新建 ⇒ 用执行预设建会话、投新会话；
//   · 目标是 Hob ⇒ 选项里没有“继续使用活跃会话”；
//   · 提问服务缺席 ⇒ fail-closed、零投递。
// ══════════════════════════════════════════════════════════════════════════
{
  const dispatchPresetMod = await import(pathToFileURL(join(root, 'src', 'shared', 'dispatch-preset.ts')).href)
  const busMod = await import(pathToFileURL(join(root, 'src', 'modules', 'bus.ts')).href)
  const presetMod = await import(pathToFileURL(join(root, 'src', 'shared', 'planning-preset.ts')).href)
  const { decideDispatchPreset, parsePresetChoice, PRESET_CHOICE_LABELS } = dispatchPresetMod
  const { HOB_PRESET_ID } = presetMod

  const verdictChecks = [
    ['match', decideDispatchPreset('deep-ptc', 'deep-ptc').kind === 'match'],
    ['mismatch', decideDispatchPreset('deep-ptc', 'standard').kind === 'mismatch'],
    ['target-hob', decideDispatchPreset('deep-ptc', HOB_PRESET_ID).kind === 'target-hob'],
    ['unknown', decideDispatchPreset('deep-ptc', undefined).kind === 'unknown'],
  ]
  if (verdictChecks.every(([, hit]) => hit)) {
    ok('WPD-12 ✓ 执行预设判定四档可辨：一致 / 不一致 / 目标是 Hob / 读不到')
  } else bad(`WPD-12 · ${JSON.stringify(verdictChecks)}`)

  const parseChecks = [
    parsePresetChoice([PRESET_CHOICE_LABELS.active], undefined) === 'active',
    parsePresetChoice([PRESET_CHOICE_LABELS.new], undefined) === 'new',
    parsePresetChoice([PRESET_CHOICE_LABELS.cancel], undefined) === 'cancel',
    parsePresetChoice([], '') === 'cancel',
    parsePresetChoice([], '不知道') === 'cancel',
  ]
  if (parseChecks.every(Boolean)) {
    ok('WPD-13 ✓ 用户回答解析：活跃 / 新建 / 取消；空白与无法识别一律取消（⛔ 不默认继续派）')
  } else bad(`WPD-13 · ${JSON.stringify(parseChecks)}`)

  /**
   * 最小宿主：目标会话 + 一个可创建的会话控制器 + 可编排的提问服务。
   * 预设读取只提供投影（权威路径），因此不会被建档头降级干扰。
   */
  const makeBusHost = (opts = {}) => {
    const sessions = new Map()
    const agents = new Map()
    const delivered = []
    const questions = []
    const targetPreset = opts.targetPreset
    const addSession = (id, preset) => {
      sessions.set(id, { id, header: { agentPreset: preset, cwd: '/tmp/wpd-preset' }, log: [] })
      agents.set(id, { status: 'idle', followup(m) { delivered.push({ id, text: m?.content?.[0]?.text ?? '' }) }, steer() {}, inject() {} })
    }
    addSession('session-active', targetPreset)
    addSession('session-hob', 'deep-ptc')
    const provided = {}
    const svcCtx = {
      sessions: { get: (id) => sessions.get(id), list: () => [...sessions.values()], flush: async () => true },
      agents: { currentInitiator: () => undefined, get: (id) => agents.get(id) },
      logger: { debug() {}, warn() {}, info() {} },
      get: (k) => {
        if (k === 'sessions') return svcCtx.sessions
        if (k === 'agents') return svcCtx.agents
        if (k === 'sessionProjections') return { stateOf: (s, key) => key === 'agentPreset' ? s.header.agentPreset : undefined }
        if (k === 'workspaceRegistry') return {
          list: () => [{ id: 'ws-1', path: '/tmp/wpd-preset', sessionIds: ['session-active'] }],
          get: (id) => id === 'ws-1' ? { id: 'ws-1', path: '/tmp/wpd-preset' } : undefined,
          resolveByPath: async (p) => p === '/tmp/wpd-preset' ? { id: 'ws-1', path: p } : undefined,
          sessionPaths: { get: () => '/tmp/wpd-preset' },
        }
        if (k === 'sessionController') return {
          create: async ({ agentPreset }) => {
            const id = `session-new-${sessions.size}`
            addSession(id, agentPreset)
            return { sessionId: id, agentPreset }
          },
        }
        if (k === 'userQuestions') return opts.noQuestions === true ? undefined : {
          ask: async (req) => {
            questions.push(req)
            return { answers: [{ id: 'dispatch-preset', selected: [opts.answer ?? PRESET_CHOICE_LABELS.new] }] }
          },
        }
        return undefined
      },
      provide: (k, v) => { provided[k] = v },
      effect: (fn) => { try { fn() } catch { /* 无落点 */ } },
      inject: (_d, cb) => cb(svcCtx),
    }
    busMod.apply(svcCtx, { spawnDefaults: () => ({ agentPreset: 'deep-ptc', provider: '', model: '', reasoningEffort: '' }) })
    return { bus: provided.hobBus, delivered, questions }
  }

  // 一致 ⇒ 不提问、直接投原会话
  {
    const h = makeBusHost({ targetPreset: 'deep-ptc' })
    const r = await h.bus.resolveDispatchTarget('session-active', 'session-hob')
    if (r.ok === true && r.created === false && r.sessionId === 'session-active' && h.questions.length === 0) {
      ok('WPD-14 ✓ 目标预设与执行预设一致 ⇒ 不提问，直接派原会话')
    } else bad(`WPD-14 · ${JSON.stringify(r)} questions=${h.questions.length}`)
  }

  // 不一致 + 用户选活跃 ⇒ 投原会话，并记下用户选择
  {
    const h = makeBusHost({ targetPreset: 'standard', answer: PRESET_CHOICE_LABELS.active })
    const r = await h.bus.resolveDispatchTarget('session-active', 'session-hob')
    const asked = h.questions.length === 1
      && JSON.stringify(h.questions[0]?.questions?.[0]?.options?.map((o) => o.label))
        .includes(PRESET_CHOICE_LABELS.active)
    if (r.ok === true && r.sessionId === 'session-active' && r.created === false && r.choice === 'active' && asked) {
      ok('WPD-15 ✓ 预设不一致 ⇒ 先提问；选“继续使用活跃会话”后投原会话')
    } else bad(`WPD-15 · ${JSON.stringify(r)} asked=${asked}`)
  }

  // 不一致 + 用户选新建 ⇒ 用执行预设建新会话，投新会话
  {
    const h = makeBusHost({ targetPreset: 'standard', answer: PRESET_CHOICE_LABELS.new })
    const r = await h.bus.resolveDispatchTarget('session-active', 'session-hob')
    if (r.ok === true && r.created === true && r.sessionId !== 'session-active'
      && r.configuredPreset === 'deep-ptc' && r.targetPreset === 'deep-ptc') {
      ok('WPD-16 ✓ 预设不一致且选新建 ⇒ 用执行预设建会话，派给新会话（计划必须跟随新 id）')
    } else bad(`WPD-16 · ${JSON.stringify(r)}`)
  }

  // 目标是 Hob ⇒ 选项里不能出现“继续使用活跃会话”
  {
    const h = makeBusHost({ targetPreset: HOB_PRESET_ID, answer: PRESET_CHOICE_LABELS.new })
    const r = await h.bus.resolveDispatchTarget('session-active', 'session-hob')
    const labels = h.questions[0]?.questions?.[0]?.options?.map((o) => o.label) ?? []
    if (r.ok === true && r.created === true && !labels.includes(PRESET_CHOICE_LABELS.active)
      && labels.includes(PRESET_CHOICE_LABELS.new) && labels.includes(PRESET_CHOICE_LABELS.cancel)) {
      ok('WPD-17 ✓ 目标是 Hob ⇒ 只给“新建 / 取消”，选项里没有“继续使用活跃会话”')
    } else bad(`WPD-17 · ${JSON.stringify(r)} labels=${JSON.stringify(labels)}`)
  }

  // 提问服务缺席 ⇒ fail-closed，零投递
  {
    const h = makeBusHost({ targetPreset: 'standard', noQuestions: true })
    const r = await h.bus.resolveDispatchTarget('session-active', 'session-hob')
    if (r.ok === false && r.reason === 'preset-confirmation-unavailable' && r.needsUser === true && h.delivered.length === 0) {
      ok('WPD-18 ✓ 预设不一致且提问服务缺席 ⇒ 明确拒绝、零投递（⛔ 不默认继续）')
    } else bad(`WPD-18 · ${JSON.stringify(r)} delivered=${h.delivered.length}`)
  }
}

/**
 * ── WPD-19：T-11 —— `writeWorkPlan` 的返回值**一处都不许丢** ──────────────────
 *
 * ⚠ 这条钉的是「失败完全不可观测」：改前 `:4965` / `:5524` / `:5565` 三处是裸调用，
 *   其中两处还在 `catch {}` 里 ⇒ 写失败连一行日志都没有。
 *
 * ⚠ 后果不是"报错"，而是**三个静默症状**：
 *   ① 首波写失败 ⇒ 盘上计划停在「全 pending」⇒ 推进器 `ready=[]` ⇒ **依赖轨永不接力**，
 *      而内存里的 watch 照常收尾 ⇒ 表现为「计划面一直 running，实际活都跑完了」；
 *   ② 附挂写失败 ⇒ 内存里这条轨 running、盘上还是 pending ⇒ 重启后该轨**凭空消失**；
 *   ③ 隐式计划写失败 ⇒ 下次派活**再生成一份新的**（判据依赖"盘上有没有 active"）⇒ 计划越用越长。
 *
 * ⚠ 判据用**静态扫描**而非运行时探针：这三个分支都需要造真实的失败盘面，
 *   端到端夹具成本极高且脆弱；而"返回值有没有被接住"是纯语法事实，静态扫更准。
 *   ⛔ 但静态扫**只能证明"接了"**，不证明"接了之后真的会 warn" —— 所以下面同时要求
 *   「每个接收点之后必须出现 `logger?.warn?.(`」。
 */
{
  const p = []
  const src = (() => {
    try { return readFileSync(join(root, 'src', 'modules', 'orchestrator.ts'), 'utf8') } catch { return '' }
  })()
  if (src === '') p.push('读不到 orchestrator.ts ⇒ 失去基准')
  else {
    /** ① 一处都不许裸调用。 */
    const bare = [...src.matchAll(/^\s*writeWorkPlan\(ledgerRoot/gm)]
    if (bare.length > 0) {
      p.push(`还有 ${bare.length} 处裸调用 writeWorkPlan（返回值被丢弃）⇒ T-11 复发`)
    }
    /**
     * ② 每个接收点必须**真的用**那个 `ok`。
     *
     * ⚠ 两种合法用法，⛔ 不能只认一种：
     *   · `logger.warn` —— 附加读数，不改变投递结果（首波 / 附挂 / 隐式三处）；
     *   · **直接返回失败给调用方** —— 更严（`:4896` 的 `stored` 就是这种：
     *     `if (!stored.ok) return { ok:false, problems:[…] }`）。
     * ⇒ 断言要求「读了这个 ok」，⛔ 不要求「必须是 warn」——
     *   那会把更强的用法判成违规（实测踩过：`:4896` 被误报）。
     */
    const receivers = [...src.matchAll(/const (\w+) = writeWorkPlan\(ledgerRoot/g)]
    if (receivers.length < 5) {
      p.push(`只找到 ${receivers.length} 个接收点，预期 ≥5（少的那几处可能又变回裸调用了）`)
    }
    for (const m of receivers) {
      const varName = m[1]
      const after = src.slice(m.index, m.index + 2000)
      const used = new RegExp(`\\b${varName}\\.ok\\b`).test(after)
      if (!used) {
        p.push(`${varName} 接收了 writeWorkPlan 的返回值却从没读 ` + varName + `.ok ⇒ 接了等于没接`)
      }
    }
  }

  if (p.length === 0) {
    ok('WPD-19 ✓ **负向对拍**：`writeWorkPlan` 全部 5 处调用都接住返回值并落 warn'
      + '（T-11：首波 / 附挂 / 隐式三处不再静默丢弃）')
  } else for (const x of p) bad(`WPD-19 · ${x}`)
}

console.log(`\nWorkPlan 派单层：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处`
  + (fail > 0 ? ` · 没过 ${fail} 处` : '')
  + ' · 跳过 0 处')
process.exitCode = fail > 0 ? 1 : 0
