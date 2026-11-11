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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const mod = await import(pathToFileURL(join(root, 'src', 'modules', 'orchestrator.ts')).href)
const riskMod = await import(pathToFileURL(join(root, 'src', 'shared', 'risk-policy.ts')).href)
const pipeMod = await import(pathToFileURL(join(root, 'src', 'shared', 'pipeline.ts')).href)
const stagesMod = await import(pathToFileURL(join(root, 'src', 'shared', 'stages-index.ts')).href)

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
/** 多会话单轨的合法候选表：两候选范围重叠、验收相同 ⇒ 无独立对。 */
const mergedCandidates = [
  { pieceId: 'left', scopePaths: ['src/shared/'], acceptance: ['one-result'] },
  { pieceId: 'right', scopePaths: ['src/shared/x.ts'], acceptance: ['one-result'] },
]

const flush = async () => {
  for (let i = 0; i < 80; i++) await new Promise((r) => setImmediate(r))
}

/** 只数真实派单；回执（`receipt`）不算。 */
const sent = (h) => h.delivered.filter((x) => x.receipt !== true)

/** Wait for an observable async outcome; bounded, no sleep-based guessing. */
/**
 * 等一个**同步谓词**变真（⚠ 只接受同步函数，见 §102 的坑）。
 *
 * ⚠⚠ **为什么轮数从 400 提到 2000**（2026-11-11 · 偶发失败）：
 *   `advanceWorkPlans` 是 **fire-and-forget**（`orchestrator.ts:4685` 的 `void`），
 *   它内部有**盘 I/O**。`setImmediate` 只推进事件循环，⛔ 不保证 I/O 完成。
 *   ⇒ 单跑时 400 轮够；但 `check:all` 里 47 族串行、磁盘繁忙时**偶尔等不到**。
 *   实测：单跑 8/8 通过，`check:all` 里偶发 1 次失败（WPR-4）。
 *   ⚠ 提高轮数是**加重等待**，⛔ 不是放宽判据 —— 判据本身（B 必须被派）一个字没动。
 *   ⚠ 仍**不用 sleep** 猜时长：每轮都是 `setImmediate`，I/O 一完成立刻返回。
 */
const waitFor = async (fn, rounds = 2000) => {
  for (let i = 0; i < rounds; i++) {
    if (fn()) return true
    await new Promise((r) => setImmediate(r))
  }
  return fn()
}

function makeHost(mode = 'multi') {
  const sessions = new Map()
  const agents = new Map()
  const pending = []
  const services = {}
  /** 每个宿主实例独立账本，避免前一个用例的计划污染后一个。 */
  const caseRoot = mkdtempSync(join(tmpdir(), 'hob-plan-case-'))
  /**
   * Real dispatches now require a RUN intent before delivery. Give every
   * runtime fixture a valid active ledger and real task rows; this keeps the
   * strict transaction path under test instead of bypassing it.
   */
  const caseLedger = join(caseRoot, basename(wsRoot))
  mkdirSync(join(caseLedger, 'ledger', 'units'), { recursive: true })
  writeFileSync(join(caseLedger, 'ledger.toml'), '# activation\nledger_id = "runtime-fixture"\nschema_version = "pipeline-v3"\nstatus = "active"\nworkspace = "work-plan-runtime"\ngeneration = "1"\ncreated_at = "2026-11-10T00:00:00Z"\n')
  /**
   * ⚠⚠ **夹具必须是现行 v3 契约形态**（B1.4 连带修复 · 2026-11-10）。
   *
   * ── 病 ────────────────────────────────────────────────────────────────────
   *   改前这里只写 6 条 task，**没有父方案 CHG-runtime，也没有需求** ⇒
   *     · L-2「任务的父方案不存在或不是 change」
   *     · RP-4「v3 任务缺 task_risk」
   *     · C-5「缺 test_plan / acceptance_criteria_refs」
   *   以前靠 projection-writer 的 `validateLedgerStructure:false` 豁免才跑通；
   *   B1.4 删掉豁免后，RUN 预登记一律失败 ⇒ `run-intent-failed` ⇒ 33 条 WPR 全红。
   *
   * ── 修的是哪一边 ─────────────────────────────────────────────────────────
   *   夹具是**测试替身**，必须像一条真实的 v3 单元（与 check-ledger-projection 同一处置）。
   *   ⛔ 不是把豁免加回来 —— 豁免的存在理由本来就不成立。
   */
  const riskDims = "risk_dimensions = ["
    + '"scope=local", "severity=negligible", "reversibility=easy", "detectability=automatic", '
    + '"uncertainty=known", "changeSurface=one-point", "dependencies=independent", '
    + '"verificationMaturity=proven", "recoveryTime=minutes", "exposure=internal"'
    + ']'
  /**
   * ⚠ 风险字段必须**由纯函数算**（RP-3）：`risk_inputs_digest` / `risk_binding_digest`
   *   是事实的函数，手写常量必然与当前事实不符 ⇒ 报「评定已过期」。
   *   这里与生产路径同源（`riskFactsOf` → `riskAssessmentOf` → `riskBindingDigestOf`）。
   */
  /** 本方案承接的需求（`riskBindingDigestOf` 要用它的验收事实）。 */
  const riskReqBase = {
    id: 'R-runtime', kind: 'req', revision: '1',
    acceptance_ids: ['AC-1'],
    acceptance_criteria: ['AC-1 | 夹具验收条件'],
    clarify_examples: ['EX-1 | pass(ok) | /tmp/e.md'],
  }
  const riskPlanBase = {
    id: 'CHG-runtime', kind: 'change', title: 'runtime 夹具方案',
    parent: 'R-runtime', req_ids: ['R-runtime'], addresses: ['R-runtime'],
    path_options: ['A'], path_tradeoffs: ['A 直接做'], path_decision: 'A',
    requirement_coverage: ['R-runtime → 夹具'],
    risk_dimensions: [
      'scope=local', 'severity=negligible', 'reversibility=easy', 'detectability=automatic',
      'uncertainty=known', 'changeSurface=one-point', 'dependencies=independent',
      'verificationMaturity=proven', 'recoveryTime=minutes', 'exposure=internal',
    ],
    risk_hard_triggers: [],
  }
  const riskAssessed = riskMod.riskAssessmentOf(riskMod.riskFactsOf(riskPlanBase))
  const riskFields = [
    'risk_rule_version = ' + JSON.stringify(riskMod.RISK_POLICY_VERSION),
    'risk_tier = ' + JSON.stringify(riskAssessed.tier),
    'risk_inputs_digest = ' + JSON.stringify(riskAssessed.inputsDigest),
    'risk_assessed_at = "2026-11-10T00:00:00+08:00"',
    'risk_assessed_by = "session-hob"',
    'risk_binding_version = ' + JSON.stringify(riskMod.RISK_POLICY_VERSION),
    /**
     * ⚠ 第二个参数必须含**本方案承接的需求**：
     *   `riskBindingDigestOf` 把需求的验收条件 / 例子一起绑进摘要，
     *   传空数组算出的摘要与生产侧（有需求时）必然不同 ⇒ RP-3 报「已变化」。
     */
    'risk_binding_digest = ' + JSON.stringify(pipeMod.riskBindingDigestOf(riskPlanBase, [riskReqBase])),
    'risk_assessment_ref = "archive/x/RISK.md"',
    riskDims,
    'risk_hard_triggers = []',
  ].join('\n')
  const reqUnit = [
    '[[unit]]', 'id = "R-runtime"', 'kind = "req"', 'status = "agreed"', 'title = "runtime 夹具需求"',
    'pipeline_version = "v3"', 'revision = "1"',
    'clarify_examples = ["EX-1 | pass(ok) | /tmp/e.md"]',
    'clarify_questions = []', 'clarify_assumptions = []',
    'acceptance_criteria = ["AC-1 | 夹具验收条件"]',
    'acceptance_ids = ["AC-1"]',
  ].join('\n') + '\n'
  const planUnit = [
    '[[unit]]', 'id = "CHG-runtime"', 'kind = "change"', 'status = "settled"', 'title = "runtime 夹具方案"',
    'parent = "R-runtime"', 'pipeline_version = "v3"', 'revision = "1"',
    'req_ids = ["R-runtime"]', 'addresses = ["R-runtime"]',
    'path_options = ["A"]', 'path_tradeoffs = ["A 直接做"]', 'path_decision = "A"',
    'requirement_coverage = ["R-runtime → 夹具"]',
    riskFields,
  ].join('\n') + '\n'
  const taskUnit = (id) => [
    '[[unit]]', `id = "TSK-${id}"`, 'kind = "task"', 'status = "todo"', `title = "fixture ${id}"`,
    'parent = "CHG-runtime"', 'pipeline_version = "v3"', 'revision = "1"',
    'task_brief = "TASK.md"', 'counterexamples = ["反例"]', 'stop_conditions = ["停手"]',
    'return_to = "back-to-task"', 'test_plan = "跑 check:work-plan-runtime"',
    'acceptance_criteria_refs = ["AC-1"]', 'task_risk = "low"',
    'risk_reasons = ["夹具"]', 'touched_surfaces = ["fixture"]',
  ].join('\n') + '\n'
  /**
   * ⚠⚠ **R-28 生效后，多轨派发要过 G1/G2 批准门**（2026-11-10）。
   *
   * ── 为什么必须补 ────────────────────────────────────────────────────────
   *   改前多轨门禁从盘上找计划，首次派发时找不到 ⇒ 落到「只报健康」⇒ 一路放行。
   *   R-28 把判据前移到写盘之前后，pipelineDispatchProblems 真的跑了
   *   ⇒ 没有批准单元的夹具会被 G1/G2 拦下（**这正是修复生效的证据**）。
   *   ⚠ 夹具必须像一条**真实已批准**的 v3 链，否则测的不再是计划推进，
   *     而是「批准门禁在不在」——那是 PIPE 组的职责。
   */
  const digestOf = (u) => pipeMod.artifactDigestOf(u)
  const approvalUnit = (artifact, revision, stage) => [
    '[[unit]]',
    'id = "DEC-' + artifact.id + '-' + revision + '"',
    'kind = "decision"',
    'status = "active"',
    'title = "用户决定 ' + artifact.id + '"',
    'decision_kind = "stage-approval"',
    'approval_stage = "' + stage + '"',
    'artifact_id = "' + artifact.id + '"',
    'artifact_revision = "' + revision + '"',
    'artifact_digest = "' + digestOf(artifact) + '"',
    'decision = "approve"',
    stage === 'plan' ? 'selected_option = "A"' : 'selected_option = ""',
    'decided_by = "user"',
    'decided_at = "2026-11-0' + revision + 'T00:00:00.000Z"',
    'source = "确认' + (stage === 'requirements' ? '需求' : '方案') + ' ' + artifact.id + ' 第 ' + revision + ' 版"',
  ].join('\n') + '\n'
  /**
   * ⚠ digest 必须由**盘上会解析出来的那个对象**算 ——
   *   直接用 JS 对象算会漏掉渲染时丢掉的字段（空数组 / 空串不写），
   *   导致 `artifactDigestOf` 与生产侧不一致 ⇒ G2 报「批准后内容发生了变化」。
   *   ⇒ 先渲染成 TOML，再用 `parseUnitsToml` 解回来，用它算 digest。
   */
  const parsedUnit = (toml) => stagesMod.parseUnitsToml(toml)[0]
  const reqObj = parsedUnit(reqUnit)
  const planObj = parsedUnit(planUnit)
  const approvalUnits = approvalUnit(reqObj, 1, 'requirements') + approvalUnit(planObj, 1, 'plan')
  const fixtureUnits = reqUnit + planUnit + approvalUnits
    + ['a', 'b', 'c', 'r', 'legacy', 'legacy-single'].map(taskUnit).join('')
  writeFileSync(join(caseLedger, 'ledger', 'units', 'index.toml'), fixtureUnits)
  writeFileSync(join(caseLedger, 'TASK.md'), '# task\n')
  const delivered = []
  const addSession = (id) => {
    sessions.set(id, { header: { cwd: wsRoot }, log: [] })
    /** ⚠ 真实宿主形状：`turnStateOfSession` 还要读 `inbox.nextTurn / nextStep`。 */
    agents.set(id, { status: 'idle', inbox: { nextTurn: [], nextStep: [] } })
  }
  /**
   * ⚠ **O-39：夹具的会话表必须覆盖所有 `track('x')` 会用到的 id**。
   *
   *   改前这里只有 `session-hob/a/b/c`，而 WPR-21 用了 `track('r', …)`
   *   ⇒ `session-r` **不在表里**。当时不校验会话存在，所以照跑；
   *   O-39 加上校验后当场红：`session-not-found: session-r`。
   *
   *   ⇒ 这**不是**「实现太严」，是**夹具原本就少了一个会话**。
   *     ⛔ 不要为了让它过而放宽校验 —— 那正好把 O-39 的靶子拆了。
   */
  for (const id of ['session-hob', 'session-a', 'session-b', 'session-c', 'session-r']) addSession(id)
  const bus = {
    /**
     * The orchestrator now always asks the bus to resolve the execution preset
     * before delivery. This fixture tests plan mechanics, so the gate is a
     * pass-through; preset-gate behaviour has its own real-bus assertions.
     */
    async resolveDispatchTarget(sessionId) {
      return {
        ok: true,
        sessionId,
        created: false,
        configuredPreset: 'standard',
        targetPreset: 'standard',
      }
    },
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
      ok('WPR-2 ✓ **负向对拍**：单会话 + 两轨 ⇒ 没有任何投递（多轨被单会话档拒绝）')
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

  // WPR-3d 过期计划归档：只收超时 + 责任人；不改业务状态；原件可还原（2026-11-06）
  {
    const h = makeHost('multi')
    await h.orch.dispatchPlan(planInput({ planId: 'WP-abandon' }), { self: 'session-hob', wsRoot, mode: 'multi' })
    const fs = await import('node:fs')
    const ledgerRoot = join(h.caseRoot, basename(wsRoot))
    const planFile = join(ledgerRoot, 'runtime', 'work-plans', 'active', 'WP-abandon.json')
    /** 把 createdAt 改成 30 小时前 = 已超时。 */
    const body = JSON.parse(fs.readFileSync(planFile, 'utf8'))
    body.plan.createdAt = Date.now() - 30 * 3_600_000
    fs.writeFileSync(planFile, JSON.stringify(body, null, 2) + '\n')
    /** 负向①：别人不能替它清。 */
    const foreign = await h.orch.archiveStalePlan('WP-abandon', '测试', 'session-other')
    /** 负向②：没有原因不能清。 */
    const noWhy = await h.orch.archiveStalePlan('WP-abandon', '   ', 'session-hob')
    /** 正向：责任人 + 原因 ⇒ 移到 abandoned/，且 state 不被改写。 */
    const okRes = await h.orch.archiveStalePlan('WP-abandon', '会话已离开 30h', 'session-hob')
    const abandoned = join(ledgerRoot, 'runtime', 'work-plans', 'abandoned', 'WP-abandon.json')
    const saved = fs.existsSync(abandoned) ? JSON.parse(fs.readFileSync(abandoned, 'utf8')) : undefined
    const activeGone = !fs.existsSync(planFile)
    const stateKept = saved?.plan?.state === 'running'
    const whySaved = typeof saved?.abandonedWhy === 'string' && saved.abandonedWhy !== ''
    if (!foreign.ok && !noWhy.ok && okRes.ok && activeGone && stateKept && whySaved) {
      ok('WPR-3d ✓ 过期计划归档：只收超时 + 责任人 + 原因；plan.state 原样保留（⛔ 不冒充 completed/failed）')
    } else {
      bad(`WPR-3d · foreign=${JSON.stringify(foreign)} noWhy=${JSON.stringify(noWhy)} ok=${JSON.stringify(okRes)}`
        + ` activeGone=${activeGone} stateKept=${stateKept} whySaved=${whySaved}`)
    }
  }

  // WPR-3c 计划台账必须能区分"正在跑"与"没人管了"（2026-11-06）
  {
    const h = makeHost('multi')
    await h.orch.dispatchPlan(planInput({ planId: 'WP-ledger-age' }), { self: 'session-hob', wsRoot, mode: 'multi' })
    const snap = await h.orch.workPlans({ self: 'session-hob', wsRoot, mode: 'multi' })
    const shown = snap.plans.find((p) => p.planId === 'WP-ledger-age')
    const hasAge = typeof shown?.ageHours === 'number' && shown.ageHours >= 0
    const occupies = shown?.occupiesSlot === true
    const notStale = shown?.stale === false
    if (hasAge && occupies && notStale) {
      ok('WPR-3c ✓ 计划台账给出 ageHours / occupiesSlot / stale 三项读数（刚建的计划不标 stale）')
    } else {
      bad(`WPR-3c · shown=${JSON.stringify(shown)}（ageHours=${shown?.ageHours} occupiesSlot=${shown?.occupiesSlot} stale=${shown?.stale}）`)
    }
  }

  // WPR-3b 用户 stop 后，历史残留计划不再占执行槽；resume 后恢复占用（2026-11-06）
  {
    const h = makeHost('single')
    const first = await h.orch.dispatchPlan(planInput({
      planId: 'WP-stop-slot-1', mode: 'single', tracks: [track('a')],
    }), { self: 'session-hob', wsRoot, mode: 'single' })
    /** 停在"计划已落盘、轨道 running"的现场，模拟用户 50 小时前 stop 后留下的残留。 */
    h.orch.control('stop', { self: 'session-hob', wsRoot })
    const blockedWhileStopped = await h.orch.dispatchPlan(planInput({
      planId: 'WP-stop-slot-2', mode: 'single', tracks: [track('c')],
    }), { self: 'session-hob', wsRoot, mode: 'single' })
    /**
     * ⚠ stop 期间 `dispatch` 本身会被拒（那是"别再派了"），所以这里只看
     * **冲突判据**是否仍把它算作占槽：如果还占，错误码会是 `single-mode-one-track`；
     * 不占则说明它已经不再挡路（后续被 stop 闸拦下属于另一条语义）。
     */
    const stillOccupies = blockedWhileStopped.problems?.some((p) => p.code === 'single-mode-one-track') === true
    h.orch.control('resume', { self: 'session-hob', wsRoot })
    const afterResume = await h.orch.dispatchPlan(planInput({
      planId: 'WP-stop-slot-3', mode: 'single', tracks: [track('d')],
    }), { self: 'session-hob', wsRoot, mode: 'single' })
    const blocksAfterResume = afterResume.problems?.some((p) => p.code === 'single-mode-one-track') === true
    if (first.ok && !stillOccupies && blocksAfterResume) {
      ok('WPR-3b ✓ 用户 stop ⇒ 残留计划不再占执行槽；resume ⇒ 恢复占用（两侧都咬住）')
    } else {
      bad(`WPR-3b · first=${first.ok} stillOccupiesWhileStopped=${stillOccupies}`
        + ` blocksAfterResume=${blocksAfterResume} problems=${JSON.stringify(afterResume.problems)}`)
    }
  }

  // WPR-4 依赖轨首波不派，回传后由推进器自动派
  {
    const h = makeHost('multi')
    const r = await h.orch.dispatchPlan(planInput({
      planId: 'WP-dep',
      tracks: [track('a'), track('b', { dependsOn: ['a'] })],
    }), { self: 'session-hob', wsRoot, mode: 'multi' })
    const firstDelivered = sent(h).length
    // 模拟 A 跑完：宿主状态 idle，走真实 settle 路径由 reconcile 读取。
    h.sessions.get('session-a').log.push({ type: 'turn/end', time: Date.now(), data: { reason: { kind: 'completed' } } })
    h.agents.get('session-a').status = 'idle'
    await h.orch.reconcile('test-relay')
    await waitFor(() => h.delivered.some((x) => x.target === 'session-b'))
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
      h.sessions.get(id).log.push({ type: 'turn/end', time: Date.now(), data: { reason: { kind: 'completed' } } })
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
      singleTrackEvidence: { candidatePieces: [
        { pieceId: 'a', scopePaths: ['src/a/'], acceptance: ['check-a'], acceptanceUnit: 'write-chain-1' },
        { pieceId: 'b', scopePaths: ['src/a/'], acceptance: ['check-a'], acceptanceUnit: 'write-chain-1' },
      ] },
      tracks: [track('a', { accessType: 'write' })],
    }), { self: 'session-hob', wsRoot, mode: 'multi' })
    const second = await h.orch.dispatchPlan(planInput({
      planId: 'WP-write-2', singleTrackReason: 'single-acceptance-unit',
      singleTrackEvidence: { candidatePieces: [
        { pieceId: 'c', scopePaths: ['src/c/'], acceptance: ['check-c'], acceptanceUnit: 'write-chain-2' },
        { pieceId: 'd', scopePaths: ['src/c/'], acceptance: ['check-c'], acceptanceUnit: 'write-chain-2' },
      ] },
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
      h.sessions.get(id).log.push({ type: 'turn/end', time: Date.now(), data: { reason: { kind: 'completed' } } })
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
      h.sessions.get(id).log.push({ type: 'turn/end', time: Date.now(), data: { reason: { kind: 'completed' } } })
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
    h.sessions.get('session-a').log.push({ type: 'turn/end', time: Date.now(), data: { reason: { kind: 'completed' } } })
    h.agents.get('session-a').status = 'idle'
    await h.orch.reconcile('relay-overlap-a')
    /** B is ready only after A's async advance writes b=running; wait on that fact. */
    await waitFor(() => {
      try {
        const file = join(h.caseRoot, basename(wsRoot), 'runtime', 'work-plans', 'active', 'WP-overlap-e2e.json')
        return JSON.parse(readFileSync(file, 'utf8')).plan?.trackStates?.b === 'running'
      } catch { return false }
    })
    const afterSecond = sent(h).map((x) => x.target)
    const snap = await h.orch.workPlans({ self: 'session-hob', wsRoot, mode: 'multi' })
    const shown = snap.plans.find((p) => p.planId === 'WP-overlap-e2e')
    if (r.ok && r.accepted === 1 && JSON.stringify(afterFirst) === '["session-a"]'
      && JSON.stringify(afterSecond) === '["session-a","session-b"]'
      && shown?.singleTrackReason === 'same-file' && shown?.returned === 1) {
      ok('WPR-20 ✓ 重叠写轨端到端：首波只投 a，a 回传后才投 b，计划记为 same-file')
    } else bad(`WPR-20 · r=${JSON.stringify(r)} first=${JSON.stringify(afterFirst)} second=${JSON.stringify(afterSecond)} shown=${JSON.stringify(shown)}`)
  }

  // WPR-38 O-39：多轨的 sessionId 必须真实存在（⛔ 不只判非空）
  {
    const h = makeHost('multi')
    const r = await h.orch.dispatchPlan(planInput({
      planId: 'WP-ghost-session',
      tracks: [
        track('a'),
        /** ⚠ 刻意用一个**不在会话表里**的 id —— 这正是 O-39 要拦的形态。 */
        track('b', { sessionId: 'session-ghost' }),
      ],
    }), { self: 'session-hob', wsRoot, mode: 'multi' })
    const delivered = sent(h).map((x) => x.target)
    const p = []
    if (r.ok !== false) p.push('不存在的 sessionId 竟然派成功了')
    if (!(r.problems ?? []).some((x) => x.code === 'session-not-found')) {
      p.push('拒绝原因没有点名 session-not-found ⇒ 分不清「没派」与「派了没人跑」')
    }
    if (!(r.problems ?? []).some((x) => String(x.message ?? '').includes('session-ghost'))) {
      p.push('拒绝原因没有点名是哪个 sessionId')
    }
    if (delivered.length !== 0) p.push(`整份被拒却仍投递了 ${delivered.length} 条 ⇒ 拒绝不是原子的`)
    if (p.length === 0) {
      ok('WPR-38 ✓ **负向对拍**：多轨里有一个不存在的 sessionId ⇒ **整份拒绝 + 零投递 + 点名那个 id**'
        + '（O-39：⛔ 不把不存在的会话写进计划 —— 那会让计划面显示 running 而实际没人跑）')
    } else for (const x of p) bad(`WPR-38 · ${x}`)
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
      h.sessions.get(id).log.push({ type: 'turn/end', time: Date.now(), data: { reason: { kind: 'completed' } } })
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
        candidatePieces: mergedCandidates,
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
      singleTrackEvidence: {
        candidatePieces: mergedCandidates,
        mergedPieces: ['p1', 'p2'],
        sharedPaths: ['src/shared', 'src/shared/x.ts'],
      },
    }), { self: 'session-hob', wsRoot, mode: 'multi' })
    if (!r.ok && sent(h).length === 0
      && r.problems?.some((p) => p.code === 'unverified-single-track-reason')) {
      ok('WPR-23 ✓ 只写 mergedPieces/sharedPaths 的 same-file ⇒ 零投递（不是恒放行）')
    } else bad(`WPR-23 · r=${JSON.stringify(r)} delivered=${sent(h).length}`)
  }

  // WPR-14 旧单目标派单 ⇒ 自动生成隐式单轨计划，旧调用不中断
  {
    const h = makeHost('auto')
    const r = await h.orch.dispatch('session-a', 'legacy one target', { self: 'session-hob', task: '回传说明', taskId: 'TSK-legacy' })
    await flush()
    const snap = await h.orch.workPlans({ self: 'session-hob', wsRoot, mode: 'auto' })
    const implicit = snap.plans.find((p) => p.planId.startsWith('WP-implicit-'))
    if (r.ok && implicit !== undefined && implicit.trackCount === 1
      && implicit.tracks?.[0]?.sessionId === 'session-a'
      && implicit.tracks?.[0]?.taskId === 'TSK-legacy') {
      ok('WPR-14 ✓ 旧单目标派单仍成功，并自动落成一条隐式单轨计划')
    } else bad(`WPR-14 · r=${JSON.stringify(r)} plans=${JSON.stringify(snap.plans)}`)
  }

  // WPR-14b 隐式计划必须记录本次真实档位（⛔ 不再写死 auto）
  {
    const h = makeHost('single')
    const r = await h.orch.dispatch('session-a', 'single mode one target', {
      self: 'session-hob', task: '回传说明', taskId: 'TSK-legacy-single', workMode: 'single',
    })
    await flush()
    const snap = await h.orch.workPlans({ self: 'session-hob', wsRoot, mode: 'single' })
    const implicit = snap.plans.find((p) => p.planId.startsWith('WP-implicit-'))
    if (r.ok && implicit?.modeSnapshot === 'single') {
      ok('WPR-14b ✓ 单会话档的隐式计划记录 modeSnapshot=single（⛔ 不再显示成自动）')
    } else bad(`WPR-14b · r=${JSON.stringify(r)} plans=${JSON.stringify(snap.plans)}`)
  }

  // WPR-14c 隐式计划的轨道任务号只认真实 taskId（⛔ 不用自由描述顶替）
  {
    const h = makeHost('single')
    const r = await h.orch.dispatch('session-a', 'legacy description only', {
      self: 'session-hob', task: '把面板修一下', workMode: 'single',
    })
    await flush()
    const snap = await h.orch.workPlans({ self: 'session-hob', wsRoot, mode: 'single' })
    const implicit = snap.plans.find((p) => p.planId.startsWith('WP-implicit-'))
    if (r.ok && implicit?.tracks?.[0]?.taskId === 'implicit') {
      ok('WPR-14c ✓ 无真实 taskId 时隐式轨用 implicit 占位，⛔ 不把自由描述当任务号')
    } else bad(`WPR-14c · r=${JSON.stringify(r)} plans=${JSON.stringify(snap.plans)}`)
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
      h.sessions.get(id).log.push({ type: 'turn/end', time: Date.now(), data: { reason: { kind: 'completed' } } })
      h.agents.get(id).status = 'idle'
      await h.orch.reconcile(`relay-${id}`)
    }
    /**
     * ⚠⚠ **必须真的等到轨道进终态**（2026-11-11 · 复核既有失败时实测发现）。
     *
     *   病：`reconcile()` 内部用 `void advanceWorkPlans(...)` **fire-and-forget**
     *   （`orchestrator.ts:4685`，因为 `advanceWorkPlansForWatch` 是同步签名
     *   `(w, trigger): void` —— 那是有意不阻塞 watch 结算）。
     *   而旧的 `flush()` 只推进 **80 次微任务**，⛔ 等不到那次推进里的**盘 I/O**。
     *   ⇒ 收口时读到 `a=running / b=running` ⇒ `closePlan` 被拒 ⇒ WPR-16 假红。
     *
     *   ⚠ 修的是**测试的等待方式**，⛔ 不是把产品改成 `await`（那会改掉既有设计）。
     *   ⚠ 判据仍是「等**可观测结果**」（`waitFor`），⛔ 不是 sleep 猜时长。
     */
    await flush()
    /**
     * ⚠⚠ **`waitFor` 只接受同步谓词**（它 `if (fn())` 直接判真假）。
     *   传 async 函数会得到一个**恒 truthy 的 Promise** ⇒ 等于什么都没等（实测踩过）。
     *   ⇒ 自己写一个**真的 await 结果**的轮询，⛔ 仍然不 sleep 猜时长。
     */
    for (let i = 0; i < 200; i++) {
      const now = await h.orch.workPlans({ self: 'session-hob', wsRoot, mode: 'multi' })
      const t = now.plans?.[0]?.tracks ?? []
      if (t.length === 2 && t.every((x) => x.state !== 'running')) break
      await new Promise((r) => setImmediate(r))
    }
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

  // WPR-26 计划完成/汇合 ⇒ 自动切等待，看护不再武装（WG-1/2/7）
  {
    const h = makeHost('multi')
    await h.orch.dispatchPlan(planInput({ planId: 'WP-guard-done' }), { self: 'session-hob', wsRoot, mode: 'multi' })
    for (const id of ['session-a', 'session-b']) {
      h.sessions.get(id).log.push({ type: 'turn/end', time: Date.now(), data: { reason: { kind: 'completed' } } })
      h.agents.get(id).status = 'idle'
      await h.orch.reconcile(`relay-${id}`)
    }
    await flush()
    const snap = await h.orch.workPlans({ self: 'session-hob', wsRoot, mode: 'multi' })
    const shown = snap.plans.find((p) => p.planId === 'WP-guard-done')
    const review = await h.orch.reviewWatchGuards()
    if (shown?.state === 'joining' && review.woke === 0 && review.delivered === 0) {
      ok('WPR-26 ✓ 全部轨道返回 ⇒ 计划 joining，看护 0 唤醒（完成/汇合不再叫）')
    } else bad(`WPR-26 · plan=${JSON.stringify(shown)} review=${JSON.stringify(review)}`)
  }

  // WPR-27 用户 stop ⇒ 即使计划仍有未结算轨道，看护也不唤醒（WG-3）
  {
    const h = makeHost('multi')
    await h.orch.dispatchPlan(planInput({ planId: 'WP-guard-stop' }), { self: 'session-hob', wsRoot, mode: 'multi' })
    h.orch.control('stop', { self: 'session-hob', wsRoot })
    for (const id of ['session-a', 'session-b']) {
      h.agents.get(id).status = 'idle'
    }
    h.sessions.get('session-hob').log.push({ type: 'turn/end', time: Date.now(), seq: 2, data: { reason: { kind: 'completed' } } })
    h.sessions.get('session-hob').log.push({ type: 'turn/start', time: Date.now() - 1000, seq: 1 })
    const review = await h.orch.reviewWatchGuards()
    if (review.woke === 0 && review.delivered === 0) {
      ok('WPR-27 ✓ 用户 stop ⇒ 未结算计划也不唤醒（停止闸生效）')
    } else bad(`WPR-27 · review=${JSON.stringify(review)}`)
  }

  // WPR-28 没有活动计划但旧 watch 还在 ⇒ 看护不唤醒（WG-9）
  {
    const h = makeHost('multi')
    h.agents.get('session-a').status = 'idle'
    h.sessions.get('session-hob').log.push({ type: 'turn/start', time: Date.now() - 1000, seq: 1 })
    h.sessions.get('session-hob').log.push({ type: 'turn/end', time: Date.now(), seq: 2, data: { reason: { kind: 'completed' } } })
    /** 手工造一条旧式看护登记（没有对应 WorkPlan）。 */
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const dir = join(h.caseRoot, basename(wsRoot), 'runtime')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'orch-watches.json'), JSON.stringify({
      version: 1, updatedAt: Date.now(), pending: [], lost: [], handoffs: [], sessions: [], closed: [],
      watchEntries: [{ owner: 'session-hob', targets: ['session-a'], state: 'awake', stateAt: Date.now() - 60_000 }],
    }, null, 2) + '\n')
    const review = await h.orch.reviewWatchGuards()
    if (review.woke === 0 && review.delivered === 0) {
      ok('WPR-28 ✓ 无活动计划 + 旧 watch ⇒ 看护 0 唤醒（stale 不叫）')
    } else bad(`WPR-28 · review=${JSON.stringify(review)}`)
  }

  // WPR-29 重启对账：stopped / completed 的旧 awake 被切回等待（WG-4 / WG-10）
  {
    const h = makeHost('multi')
    const { mkdirSync, writeFileSync, readFileSync } = await import('node:fs')
    const dir = join(h.caseRoot, basename(wsRoot), 'runtime')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'orch-watches.json')
    writeFileSync(file, JSON.stringify({
      version: 1, updatedAt: Date.now(), pending: [], lost: [], handoffs: [], sessions: [], closed: [],
      watchEntries: [{ owner: 'session-hob', targets: ['session-a'], state: 'awake', stateAt: Date.now() - 60_000 }],
    }, null, 2) + '\n')
    h.orch.control('stop', { self: 'session-hob', wsRoot })
    /** 与真实就绪扫描同一条实现。 */
    await h.orch.reconcileWatchIntents('test-restart')
    const after = JSON.parse(readFileSync(file, 'utf8')).watchEntries[0]
    if (after?.state === 'waiting') {
      ok('WPR-29 ✓ 用户 stop 后，旧 awake 登记被对账切回 waiting（重启不复活）')
    } else bad(`WPR-29 · entry=${JSON.stringify(after)}`)
  }

  // WPR-35 重启对账：completed 计划对应的旧 awake 不复活（WG-10）
  {
    const h = makeHost('multi')
    const planId = 'WP-restart-completed'
    await h.orch.dispatchPlan(planInput({ planId }), { self: 'session-hob', wsRoot, mode: 'multi' })
    const fs = await import('node:fs')
    const ledgerRoot = join(h.caseRoot, basename(wsRoot))
    const planFile = join(ledgerRoot, 'runtime', 'work-plans', 'active', `${planId}.json`)
    const body = JSON.parse(fs.readFileSync(planFile, 'utf8'))
    body.plan.state = 'completed'
    fs.writeFileSync(planFile, JSON.stringify(body, null, 2) + '\n')
    const watchFile = join(ledgerRoot, 'runtime', 'orch-watches.json')
    const before = JSON.parse(fs.readFileSync(watchFile, 'utf8')).watchEntries[0]
    const switched = await h.orch.reconcileWatchIntents('test-restart-completed')
    const after = JSON.parse(fs.readFileSync(watchFile, 'utf8')).watchEntries[0]
    if (before?.state === 'awake' && switched >= 1 && after?.state === 'waiting') {
      ok('WPR-35 ✓ 重启后 completed 计划对应的旧 awake 被切回 waiting（不复活）')
    } else {
      bad(`WPR-35 · switched=${switched} before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)
    }
  }

  // WPR-36 重启对账：waiting-user 的旧 awake 不复活（WG-10）
  {
    const h = makeHost('multi')
    await h.orch.dispatchPlan(planInput({ planId: 'WP-restart-waiting-user' }), { self: 'session-hob', wsRoot, mode: 'multi' })
    h.sessions.get('session-hob').log.push({
      type: 'assistant/message', time: Date.now(),
      data: { message: { content: [{ type: 'text', text: '## 待决问题\n请选择目标模型。' }] } },
    })
    const fs = await import('node:fs')
    const ledgerRoot = join(h.caseRoot, basename(wsRoot))
    const watchFile = join(ledgerRoot, 'runtime', 'orch-watches.json')
    const before = JSON.parse(fs.readFileSync(watchFile, 'utf8')).watchEntries[0]
    const switched = await h.orch.reconcileWatchIntents('test-restart-waiting-user')
    const after = JSON.parse(fs.readFileSync(watchFile, 'utf8')).watchEntries[0]
    if (before?.state === 'awake' && switched >= 1 && after?.state === 'waiting') {
      ok('WPR-36 ✓ 重启后 waiting-user 的旧 awake 被切回 waiting（不复活）')
    } else {
      bad(`WPR-36 · switched=${switched} before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)
    }
  }

  // WPR-30 界面直接停止 HOB（日志里的 user aborted）⇒ 即使没有工具层 stop，也不唤醒（WG-3b）
  {
    const h = makeHost('multi')
    await h.orch.dispatchPlan(planInput({ planId: 'WP-guard-user-abort' }), { self: 'session-hob', wsRoot, mode: 'multi' })
    for (const id of ['session-a', 'session-b']) h.agents.get(id).status = 'idle'
    h.sessions.get('session-hob').log.push(
      { type: 'turn/start', time: Date.now() - 2000, seq: 1 },
      { type: 'turn/end', time: Date.now() - 1000, seq: 2, data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } },
    )
    const review = await h.orch.reviewWatchGuards()
    const board = h.orch.status({ self: 'session-hob', wsRoot })
    if (review.woke === 0 && review.delivered === 0 && board.watchBoard?.mine?.intent === 'stopped') {
      ok('WPR-30 ✓ 界面直接停止 HOB（user aborted）⇒ 看护 0 唤醒，状态面读成 stopped')
    } else bad(`WPR-30 · review=${JSON.stringify(review)} board=${JSON.stringify(board.watchBoard)}`)
  }

  // WPR-31 待决问题只在“尚未回答”时算等待用户；用户回复后回到推进（WG-5b）
  {
    const h = makeHost('multi')
    await h.orch.dispatchPlan(planInput({ planId: 'WP-guard-question' }), { self: 'session-hob', wsRoot, mode: 'multi' })
    for (const id of ['session-a', 'session-b']) h.agents.get(id).status = 'idle'
    const hob = h.sessions.get('session-hob')
    hob.log.push(
      { type: 'turn/start', time: Date.now() - 3000, seq: 1 },
      {
        type: 'assistant/message', time: Date.now() - 2000, seq: 2,
        data: { message: { content: [{ type: 'text', text: '## 待决问题\n用哪个模型配置？' }] } },
      },
      { type: 'turn/end', time: Date.now() - 1000, seq: 3, data: { reason: { kind: 'completed' } } },
    )
    const pending = await h.orch.reviewWatchGuards()
    const pendingBoard = h.orch.status({ self: 'session-hob', wsRoot })
    hob.log.push({
      type: 'user/message', time: Date.now(), seq: 4,
      data: { role: 'user', content: [{ type: 'text', text: '用 v4.1-flash' }], source: { kind: 'user' } },
    })
    const answeredBoard = h.orch.status({ self: 'session-hob', wsRoot })
    if (pending.woke === 0 && pendingBoard.watchBoard?.mine?.intent === 'waiting-user'
      && answeredBoard.watchBoard?.mine?.intent === 'expecting-return') {
      ok('WPR-31 ✓ 待决问题 ⇒ waiting-user；用户回复后回到 expecting-return（不被历史问题锁死）')
    } else bad(`WPR-31 · pending=${JSON.stringify(pending)} pendingBoard=${JSON.stringify(pendingBoard.watchBoard)} answered=${JSON.stringify(answeredBoard.watchBoard)}`)
  }

  // WPR-37 clarifyAt 兼容来源：没有助手消息时，盘上“要澄清”仍算 waiting-user（WG-6）
  {
    const h = makeHost('multi')
    await h.orch.dispatchPlan(planInput({ planId: 'WP-clarify-at' }), { self: 'session-hob', wsRoot, mode: 'multi' })
    const fs = await import('node:fs')
    const ledgerRoot = join(h.caseRoot, basename(wsRoot))
    const watchFile = join(ledgerRoot, 'runtime', 'orch-watches.json')
    const state = JSON.parse(fs.readFileSync(watchFile, 'utf8'))
    state.closed = [{
      target: 'session-a', watcher: 'session-hob', at: Date.now(), sawRunning: true,
      owner: 'session-hob', clarifyAt: Date.now() + 1000,
    }]
    fs.writeFileSync(watchFile, JSON.stringify(state, null, 2) + '\n')
    const review = await h.orch.reviewWatchGuards()
    const board = h.orch.status({ self: 'session-hob', wsRoot })
    if (review.woke === 0 && review.delivered === 0 && board.watchBoard?.mine?.intent === 'waiting-user') {
      ok('WPR-37 ✓ clarifyAt 兼容来源 ⇒ waiting-user，看护 0 唤醒（WG-6）')
    } else {
      bad(`WPR-37 · review=${JSON.stringify(review)} board=${JSON.stringify(board.watchBoard)}`)
    }
  }

  // WPR-32 有活动计划、目标仍在跑 ⇒ 状态面读成 working，看护 0 唤醒（WG-8a）
  {
    const h = makeHost('multi')
    await h.orch.dispatchPlan(planInput({ planId: 'WP-guard-working' }), { self: 'session-hob', wsRoot, mode: 'multi' })
    h.sessions.get('session-hob').log.push(
      { type: 'turn/start', time: Date.now() - 2000, seq: 1 },
      { type: 'turn/end', time: Date.now() - 1000, seq: 2, data: { reason: { kind: 'completed' } } },
    )
    const review = await h.orch.reviewWatchGuards()
    const board = h.orch.status({ self: 'session-hob', wsRoot })
    if (review.woke === 0 && review.delivered === 0 && board.watchBoard?.mine?.intent === 'working') {
      ok('WPR-32 ✓ 计划仍有轨在跑 ⇒ 状态面读成 working，看护 0 唤醒')
    } else bad(`WPR-32 · review=${JSON.stringify(review)} board=${JSON.stringify(board.watchBoard)}`)
  }

  // WPR-33 该唤醒的现场 ⇒ 恰好唤醒 1 次（WG-8b / WG-11）
  {
    const h = makeHost('multi')
    await h.orch.dispatchPlan(planInput({ planId: 'WP-guard-wake' }), { self: 'session-hob', wsRoot, mode: 'multi' })
    for (const id of ['session-a', 'session-b']) h.agents.get(id).status = 'idle'
    h.sessions.get('session-hob').log.push(
      { type: 'turn/start', time: Date.now() - 2000, seq: 1 },
      { type: 'turn/end', time: Date.now() - 1000, seq: 2, data: { reason: { kind: 'completed' } } },
    )
    const first = await h.orch.reviewWatchGuards()
    const second = await h.orch.reviewWatchGuards()
    const wakeMessages = h.delivered.filter((x) => x.receipt === true
      && String(x.message ?? '').includes('推进看护'))
    if (first.woke === 1 && first.delivered === 1 && second.woke === 0
      && second.delivered === 0 && wakeMessages.length === 1) {
      ok('WPR-33 ✓ 未完成 + 无人等用户 + 无人推进 ⇒ 恰好唤醒 1 次；紧接着复查不重复叫')
    } else bad(`WPR-33 · first=${JSON.stringify(first)} second=${JSON.stringify(second)} wake=${wakeMessages.length}`)
  }

  // WPR-34 任一关键读数判不出 ⇒ 不唤醒（WG-12）
  {
    const h = makeHost('multi')
    await h.orch.dispatchPlan(planInput({ planId: 'WP-guard-undecidable' }), { self: 'session-hob', wsRoot, mode: 'multi' })
    h.agents.get('session-a').status = 'paused'
    h.agents.get('session-b').status = 'idle'
    h.sessions.get('session-hob').log.push(
      { type: 'turn/start', time: Date.now() - 2000, seq: 1 },
      { type: 'turn/end', time: Date.now() - 1000, seq: 2, data: { reason: { kind: 'completed' } } },
    )
    const review = await h.orch.reviewWatchGuards()
    const board = h.orch.status({ self: 'session-hob', wsRoot })
    if (review.woke === 0 && review.delivered === 0 && review.undecidable > 0
      && board.watchBoard?.mine?.reason === 'undecidable') {
      ok('WPR-34 ✓ 目标运行态判不出 ⇒ 看护 0 唤醒，读数面单列 undecidable')
    } else bad(`WPR-34 · review=${JSON.stringify(review)} board=${JSON.stringify(board.watchBoard)}`)
  }

  // ── 临时诊断 4（跑完删除）─────────────────────────────
  {
    const h = makeHost('multi')
    const pw = await import(pathToFileURL(join(root, 'src', 'server', 'projection-writer.ts')).href)
    const dr = await import(pathToFileURL(join(root, 'src', 'server', 'doc-read.ts')).href)
    const lr = dr.resolveLedgerRoot('', h.caseRoot, wsRoot)
    const at = Date.now()
    const r = await pw.applyProjection(lr, { kind: 'dispatch', taskId: 'TSK-a', target: 'session-a', owner: 'session-hob', at, task: 'TSK-a' })
    console.log('DIAG4 withTask ok=', r.ok, 'reason=', String(r.reason ?? '').slice(0, 300))
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
