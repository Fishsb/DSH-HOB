/**
 * Pipeline v3 view.
 *
 * This is the single derivation of a requirement's active stage, user gate and
 * next responsible actor. Both the stage panel and the orchestration gate must
 * read this result instead of maintaining separate "current step" algorithms.
 */

import { effectiveAcceptanceOf, type AcceptanceVerdictLike } from './acceptance-verdict.ts'
import { changeRequirementIds } from './ledger-relations.ts'
import { provenanceOf, type StageControlUnit } from './stage-controls.ts'
import {
  approvalStateOf,
  type ApprovalReadout,
  PIPELINE_VERSION,
  isPipelineV3,
  revisionOf,
  currentPlanOfStrict,
} from './pipeline.ts'
import {
  residualRiskProblems, riskAssessmentOf, riskAssessmentProblems, riskFactsOf, riskObjectProblems,
  taskRiskOf, taskRiskProblems, type RiskAssessment,
} from './risk-policy.ts'
import {
  acceptanceProblems, closureProblems, planProblems, runProblems, STAGE_NAMES, taskFullProblems, taskGraphRiskProblems, taskProblems,
  verificationProblems,
} from './stage-controls.ts'
import { digestPair, riskBindingDigestOf } from './pipeline.ts'

export type PipelineStageId = 'requirements' | 'plan' | 'tasks' | 'execution' | 'verification' | 'acceptance' | 'closure'
export type PipelineStageState = 'draft' | 'awaiting-user' | 'active' | 'blocked' | 'completed'
export type PipelineNextActor = 'user' | 'hob' | 'developer' | 'acceptor' | 'nobody'
export type PipelineGate = 'G1-requirement' | 'G2-plan' | 'G3-tasks' | 'G4-verification' | 'G5-acceptance' | 'G6-closure' | null

/**
 * ⚠ **步名从 `STAGE_NAMES` 派生**（R-03，2026-11-10）：⛔ 不再写字面量。
 *
 * 改前这里自带一份 7 项字面量，与 `stage-controls.ts` 的 `STAGE_NAMES` 是两份。
 * 它们当时恰好一致，但**没有任何断言强制它们一致** ⇒ 任一处改名单边改动都会静默漂移
 * （第 3 步「任务图 / 编码任务」那次漂移就是这么发生的）。
 * ⇒ 现在只有 `STAGE_NAMES` 一处权威，本表只负责「步号 → id」的映射。
 */
export const PIPELINE_STAGES = [
  { step: 1, id: 'requirements', name: STAGE_NAMES.requirements },
  { step: 2, id: 'plan', name: STAGE_NAMES.plan },
  { step: 3, id: 'tasks', name: STAGE_NAMES.tasks },
  { step: 4, id: 'execution', name: STAGE_NAMES.execution },
  { step: 5, id: 'verification', name: STAGE_NAMES.verification },
  { step: 6, id: 'acceptance', name: STAGE_NAMES.acceptance },
  { step: 7, id: 'closure', name: STAGE_NAMES.closure },
] as const

export interface PipelineStageView {
  step: number
  id: PipelineStageId
  name: string
  state: PipelineStageState
  summary: string
  itemIds: string[]
}

export interface PipelineView {
  pipelineVersion: string
  reqId: string
  title: string
  /**
   * **业务阶段**（⛔ 不含交付收口）。
   *
   * ⚠⚠ **R-09**：`closure` 是**风险启用门**，⛔ 不是第七个业务阶段 ——
   *   `pipeline.ts:44-47` 的注释自己就这么写：
   *   「closure is a risk-gated delivery stage, **not a replacement for product
   *     acceptance**: a chain may be product-accepted while delivery remains closed.」
   *   而旧码在收口未完成时设 `activeStage = 7` ⇒ 面板印「当前阶段：第 7 步 · 交付收口」
   *   ⇒ 用户以为**还有第七个业务阶段**没做，而文档承诺的是「六阶段 + 一道门」。
   *
   * ⇒ 现在：业务阶段只到 6；收口未完成用 `closurePending: true` 表达，
   *   面板改印「第 6 步 · 产品验收（已过）· 待交付收口」。
   */
  activeStage: 1 | 2 | 3 | 4 | 5 | 6 | null
  /** 六阶段已走完、但交付收口（G6）尚未完成。⛔ 与 `activeStage` 互斥。 */
  closurePending?: boolean
  state: 'active' | 'completed' | 'retired' | 'legacy'
  gate: PipelineGate
  nextActor: PipelineNextActor
  nextAction: string
  blockedBy: string[]
  stages: PipelineStageView[]
  requirementRevision?: number
  planRevision?: number
  requirementApproval: ApprovalReadout
  planApproval: ApprovalReadout
  /** v3 risk and delivery-closure readout; absent on legacy v2 views. */
  risk?: RiskAssessment
  closureMode?: 'skipped' | 'standard' | 'strict'
  chainCompleted?: boolean
  deliveryClosed?: boolean
}

type Unit = Record<string, unknown>
type LatestVerdict = { id: string; status: string; unit: Unit }

const text = (v: unknown): string => typeof v === 'string' ? v.trim() : ''
const byCreated = (a: Unit, b: Unit): number => {
  const ca = text(a.created_at)
  const cb = text(b.created_at)
  if (ca !== cb) return ca < cb ? -1 : 1
  return text(a.id).localeCompare(text(b.id))
}

/** Latest declared verification verdict for one task. */
function latestVerificationOf(verifications: readonly Unit[], taskId: string): LatestVerdict | undefined {
  const own = verifications.filter((v) => text(v.parent) === taskId)
  const latest = [...own].sort(byCreated).at(-1)
  return latest === undefined ? undefined : {
    id: text(latest.id), status: text(latest.status), unit: latest,
  }
}

function missingApproval(stage: 'requirements' | 'plan', id: string): ApprovalReadout {
  return {
    state: 'missing',
    reason: `${id} 还没有用户对当前版本的批准记录（${stage === 'requirements' ? 'G1' : 'G2'}）`,
  }
}



function currentTasksOf(plan: Unit | undefined, units: readonly Unit[]): Unit[] {
  if (plan === undefined) return []
  const pid = text(plan.id)
  return units
    .filter((u) => text(u.kind) === 'task' && text(u.parent) === pid)
    .sort(byCreated)
}

function currentRunsOf(tasks: readonly Unit[], units: readonly Unit[]): Unit[] {
  const ids = new Set(tasks.map((t) => text(t.id)))
  return units
    .filter((u) => text(u.kind) === 'run' && ids.has(text(u.parent)))
    .sort(byCreated)
}

function currentAccsOf(tasks: readonly Unit[], units: readonly Unit[]): Unit[] {
  const ids = new Set(tasks.map((t) => t.id))
  return units
    .filter((u) => text(u.kind) === 'acc' && ids.has(text(u.parent)))
    .sort(byCreated)
}

const listOf = (v: unknown): string[] => Array.isArray(v)
  ? v.map(String).map((x) => x.trim()).filter((x) => x !== '')
  : []

function currentVerificationsOf(tasks: readonly Unit[], units: readonly Unit[]): Unit[] {
  const ids = new Set(tasks.map((t) => text(t.id)))
  return units
    .filter((u) => text(u.kind) === 'verification' && ids.has(text(u.parent)))
    .sort(byCreated)
}

function currentClosureOf(req: Unit, units: readonly Unit[]): Unit | undefined {
  const reqId = text(req.id)
  return units
    .filter((u) => text(u.kind) === 'closure' && text(u.parent) === reqId)
    .sort(byCreated)
    .at(-1)
}

function verificationReady(verification: Unit, units: readonly Unit[]): boolean {
  const status = text(verification.status)
  if (status === 'send-back') return true
  if (status !== 'pass') return false
  const task = units.find((u) => text(u.id) === text(verification.parent) && text(u.kind) === 'task')
  const taskRevision = task === undefined ? undefined : revisionOf(task)
  const bound = text(verification.task_revision)
  if (taskRevision !== undefined && bound !== String(taskRevision)) return false
  const refs = new Set([
    ...listOf(verification.evidence_refs),
    ...listOf(verification.verification_refs),
    ...listOf(verification.basis),
  ])
  const evidence = units.filter((u) => text(u.kind) === 'evidence' && refs.has(text(u.id)))
  if (evidence.length === 0) return false
  return evidence.every((e) => {
    const kind = text(e.evidence_kind).toLowerCase()
    if (kind === 'command') return text(e.command) !== '' && /^-?\d+$/.test(text(e.exit_code))
    if (kind === 'artifact') return text(e.artifact_ref) !== ''
    return text(e.reading) !== '' || listOf(e.evidence_refs).length > 0
  })
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * **R-01 影子模式（第 1 段 / 共 3 段 · 2026-11-10）**
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── 病（实测）──────────────────────────────────────────────────────────────
 *   `allTasksVerified` / `allTasksAccepted` 只查**弱条件**：
 *     · 验证：最新 VER `status === 'pass'` 且 `verificationReady`（有证据）；
 *     · 验收：存在 `parent` 匹配且 `verdict === 'accepted'` 的 ACC。
 *   而**强判据**（`verificationProblems` / `acceptanceProblems`：独立性、`criteria_refs`、
 *   `example_results`…）只被 push 进 `blockedBy` 文本，**不参与 `activeStage` / `chainCompleted`**。
 *   ⇒ 实测：验证者=实现者、验收者=实现者、无 criteria_refs/verification_refs/example_results 时，
 *     C-7/C-25 报 6 条违规，而阶段 5/6 仍 `completed`、`chainCompleted=true`。
 *   **「独立验收」在判定层结构性失效。**
 *
 * ── 为什么分三段上线（⛔ 不是拖延）──────────────────────────────────────────
 *   直接改强判据会让**存量账本大面积变红**：历史上「自己验自己」的项目会从 `completed`
 *   翻成 `incomplete`，而**证据补不回来**（当时就没留）。
 *   ⇒ 段 1（本段）：**算出来、报出来，但不参与判定**（影子模式）。
 *     段 2：宽限期（按 provenance 豁免历史单元）。
 *     段 3：全量（删宽限分支）。
 *
 * ── 本段做了什么（严格可验证）──────────────────────────────────────────────
 *   · 新增 {@link strongVerificationGaps} / {@link strongAcceptanceGaps}：把强判据算成**结构化清单**；
 *   · 把它们 push 进 `blockedBy`（**带「影子」前缀**，便于区分「现在就会拦」与「将来会拦」）；
 *   · ⛔ **不改** `allTasksVerified` / `allTasksAccepted` 的返回值 ⇒ `activeStage` / `chainCompleted`
 *     与改动前**逐字相同**。
 *
 * ⚠ **验收本段的方法**：拿同一份账本跑改动前后，`activeStage` / `chainCompleted` / `stages[].state`
 *   **必须完全相等**；只有 `blockedBy` 会多出「影子」行。
 */
function strongVerificationGaps(tasks: readonly Unit[], verifications: readonly Unit[], units: readonly Unit[]): string[] {
  const out: string[] = []
  for (const task of tasks) {
    const latest = latestVerificationOf(verifications, text(task.id))
    /** ⚠ 只对**已经 pass** 的验证看强判据：没有验证是「还没做」，不是「做得不对」。 */
    if (latest === undefined || latest.status !== 'pass') continue
    for (const p of verificationProblems(latest.unit as any, units as any)) {
      out.push(`${p.unit} · ${p.rule} · ${p.why}`)
    }
  }
  return out
}

function strongAcceptanceGaps(accs: readonly Unit[], units: readonly Unit[]): string[] {
  const out: string[] = []
  for (const a of accs) {
    /** ⚠ 只对**已经 pass** 的验收看强判据（同 VER 的理由）。 */
    if (text(a.status) !== 'pass') continue
    for (const p of acceptanceProblems(a as any, units as any)) {
      out.push(`${p.unit} · ${p.rule} · ${p.why}`)
    }
  }
  return out
}

/** Every task must have its own current, evidence-backed passing verification. */
function allTasksVerified(tasks: readonly Unit[], verifications: readonly Unit[], units: readonly Unit[]): boolean {
  if (tasks.length === 0) return false
  return tasks.every((task) => {
    const id = text(task.id)
    const latest = latestVerificationOf(verifications, id)
    if (latest === undefined) return false
    /** The latest verdict wins; one stale PASS cannot mask a newer send-back. */
    return latest.status === 'pass' && verificationReady(latest.unit, units)
  })
}

/** Every task must have its own accepted product decision. */
function allTasksAccepted(
  tasks: readonly Unit[],
  groups: ReadonlyArray<{ parent: string; verdict: { verdict: string } }>,
): boolean {
  if (tasks.length === 0 || groups.length === 0) return false
  return tasks.every((task) => groups.some((g) => g.parent === text(task.id) && g.verdict.verdict === 'accepted'))
}

function taskBriefReady(task: Unit): boolean {
  return taskProblems(task as any).length === 0
}

function runEvidenceReady(run: Unit): boolean {
  return runProblems(run as any).length === 0
}

/**
 * Derive one requirement's Pipeline v3 state.
 *
 * Legacy requirements are returned as `legacy` and are never promoted into a
 * user-approved stage. They remain visible for history but cannot reach the
 * dispatch gate.
 */
export function pipelineViewOf(
  req: Unit,
  units: readonly Unit[],
): PipelineView {
  const reqId = text(req.id)
  const title = text(req.title)
  /** ⚠ **R-13**：直接调 `currentPlanOfStrict`（业务状态 + revision）；旧薄包装已按规格删除。 */
  const plan = currentPlanOfStrict(text(req.id), units as unknown as readonly Record<string, unknown>[]) as Unit | undefined
  const tasks = currentTasksOf(plan, units)
  const runs = currentRunsOf(tasks, units)
  const verifications = currentVerificationsOf(tasks, units)
  const accs = currentAccsOf(tasks, units)
  const closure = currentClosureOf(req, units)
  const graph = taskGraphOf(req, units)

  const baseStages: PipelineStageView[] = PIPELINE_STAGES.map((s) => ({
    ...s, state: 'draft', summary: '', itemIds: [],
  }))
  const set = (step: number, patch: Partial<PipelineStageView>): void => {
    const i = step - 1
    baseStages[i] = { ...baseStages[i]!, ...patch, step, id: PIPELINE_STAGES[i]!.id, name: PIPELINE_STAGES[i]!.name }
  }
  set(1, {
    itemIds: [reqId],
    summary: `${text(req.status) || 'draft'}${revisionOf(req) === undefined ? '' : ` · 第 ${revisionOf(req)} 版`}`,
  })
  if (plan !== undefined) {
    set(2, {
      itemIds: [text(plan.id)],
      summary: `${text(plan.status) || 'draft'}${revisionOf(plan) === undefined ? '' : ` · 第 ${revisionOf(plan)} 版`}`,
    })
  }
  set(3, {
    itemIds: tasks.map((t) => text(t.id)),
    summary: tasks.length === 0 ? '还没有任务图' : `${tasks.filter(taskBriefReady).length}/${tasks.length} 任务书就绪`,
  })
  set(4, {
    itemIds: runs.map((r) => text(r.id)),
    summary: runs.length === 0 ? '还没有执行记录' : `${runs.filter((r) => text(r.status) === 'returned').length}/${runs.length} 已回传`,
  })
  const groups = (() => {
    const map = new Map<string, Unit[]>()
    for (const a of accs) {
      const k = text(a.parent)
      const xs = map.get(k) ?? []
      xs.push(a)
      map.set(k, xs)
    }
    return [...map.entries()].map(([parent, xs]) => ({ parent, verdict: effectiveAcceptanceOf(xs as AcceptanceVerdictLike[]) }))
  })()
  set(5, {
    itemIds: verifications.map((v) => text(v.id)),
    summary: verifications.length === 0
      ? '还没有技术验证'
      : `${verifications.filter((v) => verificationReady(v, units)).length}/${verifications.length} 已出验证结论`,
  })
  set(6, {
    itemIds: accs.map((a) => text(a.id)),
    summary: accs.length === 0 ? '还没有产品验收' : `${groups.filter((g) => g.verdict.verdict === 'accepted').length}/${groups.length} 已接受`,
  })
  set(7, {
    itemIds: closure === undefined ? [] : [text(closure.id)],
    summary: closure === undefined ? '按风险按需启用' : `${text(closure.status) || 'closure'} · ${text(closure.closure_mode) || '模式判不出'}`,
  })

  const legacy = !isPipelineV3(req)
  const reqApproval = legacy ? { state: 'legacy', reason: '需求属于旧管线，没有 v3 批准契约' } as ApprovalReadout
    : approvalStateOf(req, units)
  const planApproval = plan === undefined
    ? missingApproval('plan', '方案')
    : (!isPipelineV3(plan) ? { state: 'legacy', reason: '方案属于旧管线，没有 v3 批准契约' } as ApprovalReadout
      : approvalStateOf(plan, units))
  const risk = plan === undefined ? undefined : riskAssessmentOf(riskFactsOf(plan))

  const blockedBy: string[] = []
  if (legacy) blockedBy.push(`${reqId} · 旧管线条目不能进入 v3 派发`)
  if (reqApproval.state !== 'approved' && !legacy) {
    if (reqApproval.state === 'awaiting-user' && ['draft', 'proposed'].includes(text(req.status))) {
      blockedBy.push(`${reqId} · 需求仍在起草（${text(req.status)}）`)
    } else {
      blockedBy.push(`${reqId} · G1 需求未批准（${reqApproval.reason}）`)
    }
  }
  if (plan !== undefined && planApproval.state !== 'approved' && !(planApproval.state === 'awaiting-user' && ['draft', 'proposed'].includes(text(plan.status)))) {
    blockedBy.push(`${text(plan.id)} · G2 方案未批准（${planApproval.reason}）`)
  }
  if (plan !== undefined && ['draft', 'proposed'].includes(text(plan.status))) {
    blockedBy.push(`${text(plan.id)} · 方案仍在起草（${text(plan.status)}）`)
  }
  /** Phase content and gate checks are consumed directly, not re-derived. */
  if (plan !== undefined && planApproval.state === 'approved') {
    for (const p of planProblems(plan as any, units as any).slice(0, 5)) blockedBy.push(`${p.unit} · ${p.rule} · ${p.why}`)
  }
  const taskProblemsAll = tasks.flatMap((t) => taskFullProblems(t as any))
  for (const p of taskProblemsAll.slice(0, 5)) blockedBy.push(`${p.unit} · ${p.rule} · ${p.why}`)
  for (const p of taskGraphRiskProblems(tasks).slice(0, 5)) blockedBy.push(`${p.unit} · ${p.rule} · ${p.why}`)
  for (const c of graph.cycles) blockedBy.push(`G3 · 任务依赖成环：${c.join(' → ')}`)
  for (const d of graph.dangling.slice(0, 3)) blockedBy.push(`G3 · 任务依赖悬空：${d}`)
  for (const g of graph.coverageGaps.slice(0, 5)) blockedBy.push(`G3 · 验收条件 ${g} 没有任务覆盖`)
  for (const r of runs) {
    if (text(r.status) === 'stuck' || text(r.status) === 'refused') blockedBy.push(`${text(r.id)} · 执行未成立（${text(r.status)}）`)
    if (text(r.status) === 'returned' && !runEvidenceReady(r)) blockedBy.push(`${text(r.id)} · 回传缺小步验证读数`)
  }
  for (const v of verifications) {
    if (text(v.status) === 'send-back') blockedBy.push(`${text(v.id)} · 技术验证已退回`)
    if (text(v.status) === 'pass' && !verificationReady(v, units)) blockedBy.push(`${text(v.id)} · 技术验证缺可复核证据`)
    const task = tasks.find((t) => text(t.id) === text(v.parent))
    const taskRevision = task === undefined ? undefined : revisionOf(task)
    const bound = text(v.task_revision)
    if (taskRevision !== undefined && bound !== '' && bound !== String(taskRevision)) {
      blockedBy.push(`${text(v.id)} · 验证绑定任务第 ${bound} 版，当前第 ${taskRevision} 版 ⇒ 旧验证失效`)
    }
  }
  for (const a of accs) {
    for (const p of acceptanceProblems(a as any, units as any).slice(0, 3)) blockedBy.push(`${p.unit} · ${p.rule} · ${p.why}`)
  }
  for (const v of verifications) {
    for (const p of verificationProblems(v as any, units as any).slice(0, 3)) blockedBy.push(`${p.unit} · ${p.rule} · ${p.why}`)
  }
  if (closure !== undefined) {
    for (const p of closureProblems(closure as any, units as any).slice(0, 5)) blockedBy.push(`${p.unit} · ${p.rule} · ${p.why}`)
  }
  /** G4 completeness is separate from “a pass exists somewhere”. */
  if (tasks.length > 0 && tasks.every((t) => text(t.status) === 'built')) {
    for (const task of tasks) {
      const latest = latestVerificationOf(verifications, text(task.id))
      if (latest === undefined) {
        blockedBy.push(`${text(task.id)} · 技术验证缺失（不能由别的任务顶替）`)
        continue
      }
      if (latest.status === 'send-back') blockedBy.push(`${text(latest.id)} · 最新技术验证已退回`)
      if (latest.status === 'pass') {
        for (const p of verificationProblems(latest.unit as any, units as any).slice(0, 3)) {
          blockedBy.push(`${p.unit} · ${p.rule} · ${p.why}`)
        }
      }
    }
  }
  if (plan !== undefined && isPipelineV3(plan)) {
    const bound = text(plan.risk_binding_digest)
    if (bound !== '' && bound !== riskBindingDigestOf(plan, units)) {
      blockedBy.push(`${text(plan.id)} · RP-3 · 方案事实已变化，风险评定 stale`)
    }
  }

  let activeStage: PipelineView['activeStage'] = 1
  /**
   * ⚠ **R-09**：六阶段已走完、只差交付收口（G6）。
   *   ⛔ 不用 `activeStage = 7` 表达 —— 那会把**门**说成**步**（见类型处的长注释）。
   */
  let closurePending = false
  let gate: PipelineGate = 'G1-requirement'
  let nextActor: PipelineNextActor = 'user'
  let nextAction = '把需求澄清到可确认，并请用户确认当前版本'

  if (legacy) {
    activeStage = null
    gate = null
    nextActor = 'nobody'
    nextAction = '旧管线条目只读；如需继续，请新建 v3 需求'
  } else if (reqApproval.state !== 'approved') {
    activeStage = 1
    if (reqApproval.state === 'awaiting-user' && ['draft', 'proposed'].includes(text(req.status))) {
      gate = null
      nextActor = 'hob'
      nextAction = '把需求内容写到可确认，再请用户确认当前版本'
      set(1, { state: 'draft' })
    } else {
      gate = 'G1-requirement'
      nextActor = 'user'
      nextAction = reqApproval.state === 'request-changes'
        ? '按用户意见修改需求，递增 revision 后重新请求确认'
        : '请用户确认需求当前版本，或提出修改意见'
      set(1, { state: reqApproval.state === 'awaiting-user' || reqApproval.state === 'missing' ? 'awaiting-user' : 'blocked' })
    }
  } else {
    set(1, { state: 'completed' })
    if (plan === undefined) {
      activeStage = 2
      gate = null
      nextActor = 'hob'
      nextAction = '起草方案，写清候选路径、取舍、推荐与需求映射'
      set(2, { state: 'active', summary: '还没定方案' })
    } else if (planApproval.state !== 'approved') {
      activeStage = 2
      if (planApproval.state === 'awaiting-user' && ['draft', 'proposed'].includes(text(plan.status))) {
        gate = null
        nextActor = 'hob'
        nextAction = '把方案写到可确认，再请用户确认当前版本并选定路径'
        set(2, { state: 'draft' })
      } else {
        gate = 'G2-plan'
        nextActor = 'user'
        nextAction = planApproval.state === 'request-changes'
          ? '按用户意见修改方案，递增 revision 后重新请求确认'
          : '请用户确认方案当前版本并选定路径'
        set(2, { state: planApproval.state === 'awaiting-user' || planApproval.state === 'missing' ? 'awaiting-user' : 'blocked' })
      }
    } else {
      const planContentReady = planProblems(plan as any, units as any).length === 0
      if (!planContentReady) {
        activeStage = 2
        gate = null
        nextActor = 'hob'
        nextAction = '补齐方案内容与风险评定：路径取舍、验证策略、风险事实和评审证据'
        set(2, { state: 'blocked' })
      } else {
      set(2, { state: 'completed' })
      const graphReady = graph.nodes.length > 0
        && graph.cycles.length === 0
        && graph.dangling.length === 0
        && graph.coverageGaps.length === 0
        && graph.nodes.every((n) => taskFullProblems({ ...tasks.find((t) => text(t.id) === n.id)! } as any).length === 0)
        && taskGraphRiskProblems(tasks).length === 0
      if (!graphReady) {
        activeStage = 3
        gate = 'G3-tasks'
        nextActor = 'hob'
        nextAction = graph.cycles.length > 0 || graph.dangling.length > 0 || graph.coverageGaps.length > 0
          ? '修齐任务图：消除依赖环 / 悬空引用，并让每个验收条件都有任务覆盖'
          : '把已批准方案拆成自包含任务，补齐每个任务的任务书与证据计划'
        set(3, { state: graph.nodes.length === 0 ? 'active' : 'blocked' })
      } else {
        set(3, { state: 'completed' })
        const running = runs.filter((r) => ['registered', 'running'].includes(text(r.status)))
        const returned = runs.filter((r) => text(r.status) === 'returned' && runEvidenceReady(r))
        if (tasks.some((t) => text(t.status) !== 'built') || returned.length < tasks.length) {
          activeStage = 4
          gate = null
          nextActor = running.length > 0 ? 'developer' : 'hob'
          nextAction = running.length > 0 ? '等待开发会话回传当前任务' : '派发已就绪任务，并在回传时要求小步验证读数'
          /**
           * No running execution means Hob is ready to dispatch, not that the
           * user must act. `awaiting-user` is reserved for G1/G2 receipts.
           */
          set(4, { state: running.length > 0 ? 'active' : 'draft' })
        } else {
          set(4, { state: 'completed' })
          const verified = allTasksVerified(tasks, verifications, units)
          const accepted = allTasksAccepted(tasks, groups)
          /**
           * ── **R-01 影子模式：算出来、报出来，⛔ 不参与判定** ──────────────────
           * ⚠ 下面这些 push **不改** `verified` / `accepted` 一个比特 ⇒
           *   `activeStage` / `chainCompleted` 与改动前逐字相同（本段的验收标准）。
           * ⚠ 前缀「影子」是给读的人区分的：它表示「这条**将来**会拦，现在只报」。
           *   段 2 上线宽限期后，前缀会改成「宽限」；段 3 删前缀 ⇒ 那时它才真的拦。
           */
          /**
           * ── **R-01 段 2：宽限期（按 provenance 豁免历史单元）**（2026-11-11）──────
           *
           * 段 1 是「只报不拦」。段 2 的区别只有**前缀**：
           *   历史单元标「宽限」、新单元标「影子」，让读的人看出「这条已经开始算了，只是还没拦」。
           *
           * ⚠ **本段仍不改 `verified` / `accepted`** —— 段 3 才真的拦。
           *   直接做段 3 会让存量账本大面积变红，而证据补不回来（当时就没留）。
           *
           * ⚠ 判定口径：`provenanceOf(u) === 'legacy-migrated'` ⇒ 历史单元。
           *   它由 I/O 侧按**分片文件名**给出（⛔ 不是自填字段），与 S-02 同源。
           */
          const legacyTag = (unitId: string): string => {
            const u = units.find((x) => text(x.id) === unitId.split(' · ')[0])
            return u !== undefined && provenanceOf(u as StageControlUnit) === 'legacy-migrated'
              ? '[宽限]' : '[影子]'
          }
          for (const g of strongVerificationGaps(tasks, verifications, units).slice(0, 5)) {
            blockedBy.push(`${legacyTag(g)} 技术验证强判据 · ${g}`)
          }
          for (const g of strongAcceptanceGaps(accs, units).slice(0, 5)) {
            blockedBy.push(`${legacyTag(g)} 产品验收强判据 · ${g}`)
          }
          if (!verified) {
            activeStage = 5
            gate = 'G4-verification'
            nextActor = 'acceptor'
            nextAction = '独立技术验证：逐条核对证据、命令读数和风险控制'
            set(5, {
              state: tasks.some((t) => latestVerificationOf(verifications, text(t.id))?.status === 'send-back')
                ? 'blocked' : 'active',
            })
          } else {
            set(5, { state: 'completed' })
            if (!accepted) {
              activeStage = 6
              gate = 'G5-acceptance'
              nextActor = 'user'
              nextAction = '向用户交付已验证结果，取得产品验收决定'
              set(6, { state: 'active' })
            } else {
              set(6, { state: 'completed' })
              const mode = risk?.closure ?? 'standard'
              const residual = accs
                .filter((a) => text(a.status) === 'pass')
                .flatMap((a) => residualRiskProblems({
                  tier: (() => {
                    const t = text(a.risk_residual_tier)
                    return ['low', 'medium', 'high', 'critical'].includes(t) ? t as any : 'low'
                  })(),
                  acceptedBy: text(a.risk_accepted_by),
                  conditions: listOf(a.risk_accept_conditions),
                  impact: text(a.risk_residual_impact),
                  monitoring: text(a.risk_residual_monitoring),
                }))
              const closureReady = closure !== undefined
                && ['closed', 'skipped'].includes(text(closure.status))
                && closureProblems(closure as any, units as any).length === 0
                && residual.length === 0
              if (!closureReady) {
                /**
                 * ⚠ **R-09**：⛔ 不设 7 —— 业务阶段到 6 为止，收口是**门**不是步。
                 *   用 `closurePending` 表达「六阶段已过、只差交付收口」。
                 */
                activeStage = 6
                closurePending = true
                gate = 'G6-closure'
                nextActor = 'hob'
                nextAction = mode === 'strict'
                  ? '执行加强交付收口：回滚、发布、监控与残余风险接受'
                  : mode === 'skipped'
                    ? '记录跳过交付收口的理由与决定者（不能默默不显示）'
                    : '执行标准交付收口：构建、冒烟、回滚与发布证据'
                set(7, { state: 'active' })
              } else {
                set(7, { state: 'completed' })
                activeStage = null
                gate = null
                nextActor = 'nobody'
                nextAction = '需求已通过产品验收并完成交付收口'
              }
            }
          }
        }
      }
      }
    }
  }

  return {
    pipelineVersion: PIPELINE_VERSION,
    reqId,
    title,
    activeStage,
    ...(closurePending ? { closurePending: true } : {}),
    state: ['retired', 'dropped'].includes(text(req.status)) ? 'retired'
      : legacy ? 'legacy'
        : activeStage === null ? 'completed' : 'active',
    gate,
    nextActor,
    nextAction,
    blockedBy,
    stages: baseStages,
    ...(revisionOf(req) === undefined ? {} : { requirementRevision: revisionOf(req) }),
    ...(plan === undefined || revisionOf(plan) === undefined ? {} : { planRevision: revisionOf(plan) }),
    requirementApproval: reqApproval,
    planApproval,
    /**
     * Legacy v2 is readable history, not a retroactive v3 risk assessment.
     * Emitting a derived risk object here would show "risk low / standard
     * delivery" for a chain nobody ever assessed under the current rules.
     */
    ...(legacy || risk === undefined ? {} : { risk, closureMode: risk.closure }),
    ...(legacy ? {} : {
      chainCompleted: chainCompletedOf(tasks, verifications, groups, units),
      deliveryClosed: closure !== undefined && ['closed', 'skipped'].includes(text(closure.status))
        && closureProblems(closure as any, units as any).length === 0
        && chainCompletedOf(tasks, verifications, groups, units),
    }),
  }
}

function chainCompletedOf(
  tasks: readonly Unit[],
  verifications: readonly Unit[],
  groups: ReadonlyArray<{ parent: string; verdict: { verdict: string } }>,
  units: readonly Unit[],
): boolean {
  return allTasksVerified(tasks, verifications, units) && allTasksAccepted(tasks, groups)
}

/** All requirement Pipeline v3 views, ordered by creation time. */
export function pipelineViewsOf(units: readonly Unit[]): PipelineView[] {
  return units
    .filter((u) => text(u.kind) === 'req')
    .sort(byCreated)
    .map((r) => pipelineViewOf(r, units))
}

export interface PipelineGateProblem {
  rule: string
  unit: string
  why: string
}

/**
 * Downstream dispatch lock for one task.
 *
 * A task may be dispatched only when:
 *   - the task itself is enrolled in Pipeline v3;
 *   - its parent change is v3 and user-approved;
 *   - every requirement addressed by that change is v3 and user-approved;
 *   - the change is still active (not superseded);
 *   - the task revision is current and its brief is ready.
 */
export function pipelineDispatchProblems(
  units: readonly Unit[],
  task: Unit,
): PipelineGateProblem[] {
  const out: PipelineGateProblem[] = []
  const taskId = text(task.id) || '(task)'
  if (text(task.kind) !== 'task') {
    return [{ rule: 'C-20', unit: taskId, why: '派发对象不是 task' }]
  }
  if (!isPipelineV3(task)) {
    return [{ rule: 'C-20', unit: taskId, why: '旧管线条目只读，不能进入 v3 派发；请新建 v3 需求链' }]
  }
  const planId = text(task.parent)
  const plan = units.find((u) => text(u.id) === planId)
  if (plan === undefined || text(plan.kind) !== 'change') {
    return [{ rule: 'C-20', unit: taskId, why: `父方案 ${planId || '(空)'} 不存在或不是 change` }]
  }
  if (!isPipelineV3(plan)) {
    return [{ rule: 'C-20', unit: taskId, why: `父方案 ${planId} 属于旧管线，不能派发` }]
  }
  if (text(plan.status) === 'superseded') {
    return [{ rule: 'C-20', unit: planId, why: '父方案已被取代' }]
  }
  const planApproval = approvalStateOf(plan, units)
  if (planApproval.state !== 'approved') {
    out.push({
      rule: 'G2',
      unit: planId,
      why: `方案当前修订未获用户批准（${planApproval.reason}）`,
    })
  }
  const reqIds = changeRequirementIds(plan)
  if (reqIds.length === 0) {
    out.push({ rule: 'G1', unit: planId, why: '方案没有正式承接任何需求' })
  }
  for (const rid of reqIds) {
    const req = units.find((u) => text(u.id) === rid)
    if (req === undefined || text(req.kind) !== 'req') {
      out.push({ rule: 'G1', unit: rid, why: '方案承接的需求不存在或不是 req' })
      continue
    }
    if (!isPipelineV3(req)) {
      out.push({ rule: 'G1', unit: rid, why: '需求属于旧管线，不能进入 v3 派发' })
      continue
    }
    const approval = approvalStateOf(req, units)
    if (approval.state !== 'approved') {
      out.push({ rule: 'G1', unit: rid, why: `需求当前修订未获用户批准（${approval.reason}）` })
    }
  }
  for (const p of taskProblems(task as any)) {
    out.push({ rule: p.rule, unit: p.unit, why: p.why })
  }
  for (const p of riskAssessmentProblems(plan)) {
    out.push({ rule: p.rule, unit: p.unit, why: p.why })
  }
  /**
   * Linked risk objects are part of dispatch health. An open risk is not a
   * closed control merely because the plan's tier is low.
   */
  for (const p of riskObjectProblems(units)) {
    if (p.unit === planId || p.unit === taskId) out.push({ rule: p.rule, unit: p.unit, why: p.why })
  }
  /**
   * The same fact-binding check as the stage gate. A dispatch must not rely on
   * a risk assessment whose scope, delivery target or acceptance facts have
   * changed since it was made.
   */
  const bound = text(plan.risk_binding_digest)
  if (bound !== '' && bound !== riskBindingDigestOf(plan, units)) {
    out.push({ rule: 'RP-3', unit: planId, why: '方案事实或验收对象已变化，风险评定 stale，不能派发' })
  }
  out.push(...taskRiskProblems(task))
  /**
   * ── **G3：任务图必须无环、无悬空、验收条件全覆盖**（R-05，2026-11-10）────────
   *
   * ── 病（实测）──────────────────────────────────────────────────────────
   *   改前本函数**全文不调 `taskGraphOf`** ⇒ 依赖成环 / 悬空依赖 / 验收条件无任务覆盖
   *   都**不进任何派发闸门**，只在 `pipelineViewOf` 里被 push 成 `blockedBy` 文本。
   *   ⇒ **任务图有洞照样能派活**（实测：`criteria_refs: []` + `depends_on: ['TSK-NOT-EXIST']`
   *     时 `pipelineDispatchProblems = []`）。G3 因此只是展示门。
   *
   * ── 判据从哪来（⛔ 不另写一份）────────────────────────────────────────
   *   直接用 `taskGraphOf` 的 `cycles` / `dangling` / `coverageGaps` —— 与视图、面板同源。
   *   ⚠ 只判**本任务所属需求**的图，⛔ 不拿全账本的图当拒绝理由（那是改前 `stageGateOfLedger`
   *     的误伤形态：别的需求缺字段，把这一单也拦下）。
   *
   * ── 为什么只拦「与本任务相关」的那几条 ────────────────────────────────
   *   · **成环**：只要本任务在环上就必须拦（它永远等不到）；环在别的分支上不拦。
   *   · **悬空**：只拦 `dangling` 里点名本任务或本任务依赖的那条。
   *   · **覆盖缺口**：这是**需求级**事实（验收条件没有任务承接）⇒ 整个需求的任务都不该派；
   *     但 `coverageGaps` 不点名具体任务 ⇒ 拦**本需求下所有任务**（这正是 G3 的原意）。
   */
  const reqIdOfTask = (() => {
    /** 本任务的祖先需求：task.parent → change → 承接需求（`req_ids` / `addresses` / `requirement_coverage`）。 */
    const ids = changeRequirementIds(plan)
    return ids.length > 0 ? units.find((u) => text(u.id) === ids[0]) : undefined
  })()
  if (reqIdOfTask !== undefined) {
    /**
     * ⚠ **图必须在「含本任务」的单元集上算**。
     *
     * 真实调用方（`tools.ts` 的 `dispatchGateAtLedger`）传的 `task` 是从
     * `readLedgerUnits()` 里 `find` 出来的 ⇒ 它必然已在 `units` 里。
     * 但**判据不能依赖调用方守这个约定**：少了本任务，`taskGraphOf` 会算出
     * 「所有验收条件都没任务覆盖」—— 那是**夹具缺陷被读成业务缺口**，
     * 正是本项目反复记的「判据在错误输入上给出看似合理结论」。
     * ⇒ 这里显式补齐（幂等：已在则不重复加）。
     */
    const graphUnits = units.some((u) => text(u.id) === taskId) ? units : [...units, task]
    const graph = taskGraphOf(reqIdOfTask, graphUnits)
    for (const cycle of graph.cycles) {
      if (cycle.includes(taskId)) out.push({ rule: 'G3', unit: taskId, why: `任务依赖成环：${cycle.join(' → ')}` })
    }
    for (const d of graph.dangling) {
      /** `dangling` 的形态是 `'TSK-1 → TSK-NOT-EXIST'` ⇒ 只认源端是本任务的那条。 */
      const [from] = d.split('→').map((x) => x.trim())
      if (from === taskId) out.push({ rule: 'G3', unit: taskId, why: `任务依赖悬空：${d}` })
    }
    for (const g of graph.coverageGaps) {
      out.push({ rule: 'G3', unit: taskId, why: `验收条件 ${g} 没有任务覆盖（本需求 ${text(reqIdOfTask.id)}）` })
    }
  }
  return out
}

export interface TaskGraphNode {
  id: string
  status: string
  ready: boolean
  blockedBy: string[]
  coveredCriteria: string[]
}

export interface TaskGraphView {
  nodes: TaskGraphNode[]
  ready: string[]
  blocked: string[]
  cycles: string[][]
  dangling: string[]
  coverageGaps: string[]
}

/** Deterministic requirement task graph. `depends_on` is a task DAG edge. */
export function taskGraphOf(req: Record<string, unknown>, units: readonly Record<string, unknown>[]): TaskGraphView {
  const reqId = text(req.id)
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **O-34：任务图只认「当前方案」，⛔ 不把 `superseded` 的任务算进来**（2026-11-10）
   * ══════════════════════════════════════════════════════════════════════════
   *
   * ── 病（实测）──────────────────────────────────────────────────────────────
   *   改前 `plans` **不筛 status** ⇒ `superseded` 的方案也在内 ⇒ 它的任务被算进「本需求的图」。
   *   后果：**旧方案有 built 任务、新方案零任务时**，`graphReady` 会被旧任务满足
   *   （第 3 步 `completed`、链推进到 G4），而同一屏 `summary` 来自当前方案（「还没有任务图」）。
   *   ⇒ 这是 R-02（口径分叉）在服务端内部的**自我复制**，也是 R-13 的**反面**：
   *     R-13 是「取最后一个方案」，O-34 是「取全部方案」——**两头都错，中间才对**。
   *
   * ── 修法：与 `currentTasksOf` 同源 ────────────────────────────────────────
   *   排除 `superseded`。⚠ **只排这一个状态**：`draft` / `proposed` 仍是「在写的当前方案」，
   *   它们没有任务不是缺陷（那是「还没拆任务」）。
   *   ⚠ 「全部方案都被取代」时 `plans` 为空 ⇒ 图为空 ⇒ `graphReady` 为假。
   *     这是**有意**的：没有当前方案就不该有可派的任务图（D-O34-1 采 A「与 currentTasksOf 同源」）。
   */
  const plans = units.filter((u) => text(u.kind) === 'change'
    && changeRequirementIds(u).includes(reqId)
    && text(u.status) !== 'superseded')
  const planIds = new Set(plans.map((p) => text(p.id)))
  const tasks = units
    .filter((u) => text(u.kind) === 'task' && (planIds.has(text(u.parent)) || listOf(u.req_ids).includes(reqId)))
    .sort(byCreated)
  const byId = new Map(tasks.map((t) => [text(t.id), t]))
  const dangling = tasks.flatMap((t) => listOf(t.depends_on).filter((d) => !byId.has(d) && !units.some((u) => text(u.id) === d) && d !== text(t.parent)).map((d) => `${text(t.id)} → ${d}`))
  const cycles: string[][] = []
  const color = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  const visit = (id: string): void => {
    const c = color.get(id) ?? 0
    if (c === 1) {
      const at = stack.indexOf(id)
      cycles.push([...stack.slice(at), id])
      return
    }
    if (c === 2) return
    color.set(id, 1)
    stack.push(id)
    for (const dep of listOf(byId.get(id)?.depends_on)) if (byId.has(dep)) visit(dep)
    stack.pop()
    color.set(id, 2)
  }
  for (const t of tasks) visit(text(t.id))
  const criteria = listOf(req.acceptance_criteria)
  /**
   * ⚠ **R-10：覆盖校验必须读契约字段名 `acceptance_criteria_refs`**（2026-11-10）。
   *
   * ── 病（实测）──────────────────────────────────────────────────────────
   *   `pipeline.ts:157` 把任务的写入契约字段命名为 `acceptance_criteria_refs`，
   *   而这里只读 `criteria_refs`（那是 **verification** 单元的字段，`stage-controls.ts:738`）。
   *   ⇒ **按文档写反而永远报缺口**：任务写 `acceptance_criteria_refs: ['AC-1']`
   *     时 `coverageGaps = ['AC-1','AC-2']`；改成 `criteria_refs` 才归零。
   *   ⇒ 这是「判据读错字段」而非「覆盖真的缺」，会让人去补不存在的缺口。
   *
   * ── 为什么两个都读（而不是只改字段名）────────────────────────────────
   *   `criteria_refs` 在**历史任务**上可能已经被当成同义字段写过；
   *   只认新名会让那些任务突然报缺口（把修复变成回归）。
   *   ⇒ 读「契约名优先，旧名兜底」，⛔ 不在这里做字段迁移（那是另一件事）。
   */
  const refsOf = (t: Record<string, unknown>): string[] => {
    const canonical = listOf(t.acceptance_criteria_refs)
    return canonical.length > 0 ? canonical : listOf(t.criteria_refs)
  }
  const covered = new Set(tasks.flatMap((t) => refsOf(t)))
  /**
   * ── **O-38：无显式 id 的验收条件，身份必须来自内容，⛔ 不是数组下标** ──────
   *
   * ⚠ 改前是 `?? \`AC-${i + 1}\`` —— 用**下标**当身份。后果：
   *
   *   ```
   *   原有：["必须支持导出"]              ⇒ 缺口 id = AC-1
   *   头部插入一条：["必须支持导入", "必须支持导出"]
   *                ⇒ 原那条的下标变成 2 ⇒ 缺口 id = AC-2（**凭空多出一个缺口**）
   *   ```
   *
   *   ⇒ **在数组头部插一条，就让 G3 报出一条不存在的缺口**，而真实的覆盖关系没变。
   *   这属于「改了 A 却说 B 有问题」——比漏报更坏，因为它会让人去修一个不存在的问题。
   *
   * ⚠ 改成**内容哈希**：同一条内容无论插在哪，id 都不变。
   *   ⛔ 不要改回下标；也⛔ 不要用「数组里第几个出现」——那仍然依赖顺序。
   */
  const idOfCriteria = (c: string, i: number): string => {
    const explicit = /^([A-Za-z]+-[A-Za-z0-9-]+)\s*[:：|]/.exec(c)?.[1]
    /** 显式前缀优先（人写的编号最权威）。 */
    if (explicit !== undefined) return explicit
    /**
     * ⚠ 无前缀 ⇒ 用内容哈希。**保留 `AC-` 前缀**，因为下游按这个形状认 id
     *   （`covered.has(id)` 与面板展示都按 `AC-…` 匹配）。
     * ⚠ 哈希取前 8 位即可：验收条件在**同一个方案内**，8 位十六进制足够区分。
     *   ⛔ 不要为了"更安全"取全长 —— 那会让缺口 id 在面板上长得没法读。
     */
    return `AC-h${digestPair(c).slice(0, 8)}`
  }
  const coverageGaps = criteria
    .map((c, i) => {
      const id = idOfCriteria(c, i)
      return covered.has(id) || tasks.some((t) => refsOf(t).includes(c)) ? '' : id
    })
    .filter((x) => x !== '')
  const nodes = tasks.map((t) => {
    const blockedBy: string[] = []
    const taskRisk = taskRiskOf(t as any)
    if (taskRisk.requirements.isolationRequired && text(t.requires_isolation) !== 'true') blockedBy.push('RP-4 · 缺 requires_isolation=true')
    if (taskRisk.requirements.serialRequired && text(t.requires_serial_execution) !== 'true') blockedBy.push('RP-4 · 缺 requires_serial_execution=true')
    for (const dep of listOf(t.depends_on)) {
      const d = byId.get(dep)
      if (d === undefined) blockedBy.push(`${dep} 不存在`)
      else if (text(d.status) !== 'built') blockedBy.push(`${dep} 还不是 built`)
    }
    return {
      id: text(t.id),
      status: text(t.status),
      ready: blockedBy.length === 0 && text(t.status) === 'todo',
      blockedBy,
      coveredCriteria: refsOf(t),
    }
  })
  return {
    nodes,
    ready: nodes.filter((n) => n.ready).map((n) => n.id),
    blocked: nodes.filter((n) => n.blockedBy.length > 0).map((n) => n.id),
    cycles,
    dangling,
    coverageGaps,
  }
}
