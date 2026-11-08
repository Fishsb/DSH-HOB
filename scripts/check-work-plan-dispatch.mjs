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
    && plan?.input.tracks.length === 2 && result.tracks.length === 2) {
    ok('WPD-1 ✓ 多轨一次调用进入 dispatchPlan，未被拆成两次单目标调用')
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

// WPD-5 旧单目标参数仍工作，但必须自带真实 taskId
{
  const orch = makeOrch()
  const tools = mod.createHobOrchTools(orch, undefined, () => 'single')
  const raw = await tools.dispatch.execute({
    sessionId: 'session-a', message: 'legacy', task: '回传说明', taskId: 'TSK-a',
  }, exec)
  const result = JSON.parse(raw)
  if (result.ok && orch.state.dispatches.length === 1 && orch.state.plans.length === 0
    && orch.state.dispatches[0]?.opts?.taskId === 'TSK-a') {
    ok('WPD-5 ✓ 单目标旧入口保留（真实 taskId），且不伪造新计划')
  } else bad(`WPD-5 · ${raw} dispatches=${orch.state.dispatches.length}`)
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

console.log(`\nWorkPlan 派单层：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处`
  + (fail > 0 ? ` · 没过 ${fail} 处` : '')
  + ' · 跳过 0 处')
process.exitCode = fail > 0 ? 1 : 0
