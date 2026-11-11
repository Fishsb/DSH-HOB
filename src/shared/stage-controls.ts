/**
 * 阶段内部控制 —— 需求澄清、方案路径、任务自包含、技术验证、产品验收、交付收口与阻塞回流。
 *
 * 纯函数、零 I/O：账本检查、生成视图和运行态共用同一套判定。
 * 正式六阶段由 `pipeline-view.ts` 统一投影；G6 交付收口按风险启用。
 */

import { changeRequirementIds } from './ledger-relations.ts'
import { approvalStateOf, isPipelineV3 , currentPlanOfStrict } from './pipeline.ts'
import {
  RISK_TIERS, riskAssessmentProblems, riskFactsOf, riskAssessmentOf, riskGateRequirements,
  taskRiskProblems, taskRiskOf, taskScopeConflict, riskObjectProblems,
} from './risk-policy.ts'
import { riskBindingDigestOf } from './pipeline.ts'

export const STAGE_IDS = ['requirements', 'plan', 'tasks', 'execution', 'verification', 'acceptance', 'closure'] as const
export type StageId = (typeof STAGE_IDS)[number]

/**
 * **阶段步名的唯一权威**（R-03，2026-11-10）。
 *
 * ── 病（实测）──────────────────────────────────────────────────────────────
 *   改前「第 3 步叫什么」有 **8 份独立字面量**，且**已经漂了**：
 *
 *   | 位置 | 第 3 步 |
 *   |---|---|
 *   | `stage-controls.ts:22`（**本表**） | `编码任务` ← 唯一的旧词 |
 *   | `pipeline-view.ts:36` | `任务图` |
 *   | `stages-index.ts:33` | `任务图` |
 *   | `requirement-chain.ts:123` | `任务图` |
 *   | `project-panel.tsx:139` | `任务图` |
 *   | `gen-ledger.mjs:522` | `任务图` |
 *
 *   ⇒ 7 份写「任务图」、1 份写「编码任务」。
 *   ⚠ 而 `STAGE_NAMES` 的唯一消费方是 `gen-ledger.mjs:1267`（写进账本 `CONTEXT.md`）
 *   ⇒ **跑一次 `gen:ledger` 就会把错的步名印进账本**，而面板显示「任务图」。
 *
 * ── 为什么改这一份而不是其余 7 份 ─────────────────────────────────────────
 *   7:1 ⇒ 少数派是遗留。且「任务图」与 G3 的判据语义一致（那一步的产出物就是**任务图**，
 *   不是「编码」这个动作）。
 *
 * ── ⚠ 这张表是**唯一权威**：其余位置必须 import 或派生，⛔ 不许再写字面量。
 *   机检见 `check:workflow` 的 F15（比对 `spec/reply.md` 与 prefix 正文的步名清单
 *   必须与 `STAGE_NAMES` 一致）。
 */
export const STAGE_NAMES: Readonly<Record<StageId, string>> = {
  requirements: '需求规格',
  plan: '实现方案',
  tasks: '任务图',
  execution: '任务执行',
  verification: '技术验证',
  acceptance: '产品验收',
  closure: '交付收口',
}

/** 阻塞归因；环境问题单独一档，不误判成需求错误。 */
export const BLOCK_CAUSES = ['requirement', 'plan', 'task', 'implementation', 'verification', 'acceptance', 'closure', 'environment'] as const
export type BlockCause = (typeof BLOCK_CAUSES)[number]

export const BLOCK_CAUSE_TO_STAGE: Readonly<Record<BlockCause, StageId | null>> = {
  requirement: 'requirements',
  plan: 'plan',
  task: 'tasks',
  implementation: 'execution',
  verification: 'verification',
  acceptance: 'acceptance',
  closure: 'closure',
  environment: null,
}

export const ASSUMPTION_STATES = ['pending', 'confirmed', 'rejected'] as const
export type AssumptionState = (typeof ASSUMPTION_STATES)[number]

/** 退回目标封闭集：与账本 acc.send_back_to 的 B-1 口径同源，⛔ 不收自由文本。 */
export const STAGE_RETURN_TARGETS = ['back-to-requirement', 'back-to-plan', 'back-to-task'] as const
export type StageReturnTarget = (typeof STAGE_RETURN_TARGETS)[number]

/**
 * **阶段完成语义（唯一真源）** —— 2026-11-08 · 用户裁定「阶段语义收口」。
 *
 * ⚠⚠ 这不是又一张状态表；它是**每一步"什么算完成"的口径**。改前第 3 步与
 *   第 4 步都拿 `task.status = built` 当完成信号，于是：
 *     · 任务书刚建好、还没执行时，第 3 步仍是 `todo`；
 *     · 真正执行期间，当前步仍显示「任务图」（当时的旧称是「编码任务」，R-03 已统一）；
 *     · 回传后第 3 步完成，第 4 步通常也同时完成。
 *   ⇒ 「任务执行」很难成为独立的当前阶段。根因是**完成定义重叠**，不是面板文案。
 *
 * 现行口径（⛔ 不许再让两步共用一个完成信号）：
 *   · `tasks`     —— **任务书就绪**：至少一条 `task` 且 C-5 通过；
 *                    ⚠ 与「是否已执行完」无关。
 *   · `execution` —— **执行事实成立**：该任务有 `run.status = returned`，
 *                    且 `task.status = built`；两者必须**同时**成立。
 *                    ⚠ 零 `run` 的 `built` 不是完成，是 G-1 的「跳过执行」缺口。
 */
export const STAGE_COMPLETION: Readonly<Record<StageId, {
  /** 一句话口径（给人读）。 */
  definition: string
  /** 权威判据（机读代码的入口名 / 规则号；⛔ 不许写成另一套实现）。 */
  judgedBy: string
}>> = {
  requirements: {
    definition: '需求内容齐全，且用户批准当前修订；status=agreed 本身不算批准',
    judgedBy: 'R.status=agreed + C-1/C-2 + G1 stage-approval',
  },
  plan: {
    definition: '方案内容齐全，且用户批准当前修订并选定路径；settled 本身不算批准',
    judgedBy: 'CHG.status=settled + C-3/C-4/C-15 + G2 stage-approval',
  },
  tasks: {
    definition: '任务已拆清：至少一条任务，且任务书、反例、停手条件、回流阶段齐全',
    judgedBy: 'TSK exists + C-5',
  },
  execution: {
    definition: '执行事实成立：任务有已回传的运行记录，且任务已到 built',
    judgedBy: 'RUN.status=returned + TSK.status=built + C-6',
  },
  acceptance: {
    definition: '技术验证通过，且用户接受产品结果',
    judgedBy: 'VER.status=pass/waived + ACC.status=pass/send-back + C-7/C-12/C-13/C-14',
  },
  verification: {
    definition: '独立技术验证者按当前修订逐条核对证据，且非符合项已关闭',
    judgedBy: 'VER.status=pass/waived + C-25/C-26',
  },
  closure: {
    definition: '交付收口已按风险档位完成，或按证据正式跳过',
    judgedBy: 'CLS.status=closed/skipped + C-27/C-28',
  },
}

export interface StageControlUnit {
  id?: string
  kind?: string
  status?: string
  parent?: string
  title?: string
  /** Approval decision target; decisions have no `parent` hierarchy edge. */
  artifact_id?: string
  built_by?: string
  actor?: string
  acceptance_ids?: string[]
  addresses?: string[]
  req_ids?: string[]
  verify_refs?: string[]
  evidence_refs?: string[]
  basis?: string[]
  verified_at?: string
  clarify_examples?: string[]
  clarify_questions?: string[]
  clarify_assumptions?: string[]
  clarify_sources?: string[]
  acceptance_criteria?: string[]
  path_options?: string[]
  path_tradeoffs?: string[]
  path_decision?: string
  research_refs?: string[]
  requirement_coverage?: string[]
  stage_summary?: string
  task_brief?: string
  counterexamples?: string[]
  stop_conditions?: string[]
  return_to?: string
  stage?: string
  progress_refs?: string[]
  product_confirmation?: string
  clarify_legacy?: string
  send_back_to?: string
  created_at?: string
  // Wave 1: independent acceptance and reviewable evidence.
  acceptance_session?: string
  verification_refs?: string[]
  validation_refs?: string[]
  reading?: string
  example_results?: string[]
  nonconformance_refs?: string[]
  residual_risks?: string[]
  liens?: string[]
  release_ready?: string
  release_refs?: string[]
  risk_tier?: string
  risk_rule_version?: string
  risk_hard_triggers?: string[]
  risk_hard_trigger_facts?: string[]
  risk_dimensions?: string[]
  risk_inputs_digest?: string
  risk_assessed_at?: string
  risk_assessed_by?: string
  delivery_scope?: string
  closure_mode?: string
  risk_residual_tier?: string
  risk_accepted_by?: string
  risk_accepted_at?: string
  risk_accept_conditions?: string[]
  risk_residual_impact?: string
  risk_residual_monitoring?: string
  verifier?: string
  verification_session?: string
  criteria_refs?: string[]
  waiver_source?: string
  waived_by?: string
  skip_reason?: string
  rollback_refs?: string[]
  monitoring_refs?: string[]
  accepted_by?: string
  approval_ref?: string
  closed_at?: string
  reviewer?: string
  review_refs?: string[]
  task_risk?: string
  risk_reasons?: string[]
  requires_isolation?: string
  requires_review?: string
  requires_serial_execution?: string
  touched_surfaces?: string[]
  irreversible_actions?: string[]
  risk_binding_digest?: string
  risk_review_refs?: string[]
  new_risk_refs?: string[]
  new_risk_reason?: string
  chain_acceptance_ref?: string
  risk_assessment_ref?: string
  residual_risk_decision_ref?: string
  risk_ids?: string[]
  risk_owner?: string
  risk_residual_reason?: string
  risk_assessment?: string
  risk_binding_version?: string
  test_strategy?: string
  evidence_kind?: string
  command?: string
  exit_code?: string
  artifact_ref?: string
  covers?: string[]
  depends_on?: string[]
  scope_paths?: string[]
}

export interface StageControlProblem {
  rule: string
  unit: string
  why: string
}

/** Gate actions: forward and repair are separate. */
export const GATE_ACTIONS = ['dispatch', 'write-forward', 'write-repair', 'accept', 'send-back', 'plan-complete'] as const
export type GateAction = (typeof GATE_ACTIONS)[number]

export const GATE_SCOPE_KINDS = ['project', 'requirement', 'change', 'task', 'plan'] as const
export type GateScopeKind = (typeof GATE_SCOPE_KINDS)[number]

export interface GateScope {
  kind: GateScopeKind
  id?: string
}

export interface GateDecision {
  decision: 'go' | 'return' | 'hold'
  scope: string
  blockers: StageControlProblem[]
  allowedRepairs: string[]
  /**
   * `hold` 的**可读原因**（2026-11-08）。
   *
   * ⚠ 改前 `hold` 只有一句固定话术「账本读不到或作用域缺 id」，
   *   把三种完全不同的情形混成一句：
   *     · 账本真读不到
   *     · 派活对象在账本里不存在
   *     · 派活对象存在但**不是任务**（拿需求号 / 方案号去派活）
   *   ⇒ 用户报「新的任务没有走阶段流程」时，那句话给不出任何线索。
   * ⚠ 缺省仍按旧话术渲染（`gateMessageOf`），⛔ 不破坏既有调用方。
   */
  reason?: string
  /**
   * ── **O-01：本次判定**没有真正过门禁**的显式标记** ──────────────────────────
   *
   * ⚠ 改前 `write-repair` 直接 `return { decision: 'go', blockers: [] }` ——
   *   **不计算任何问题**就报「可以」。调用方看到 `go` 会以为「过了门禁」，
   *   而实际是「**根本没判**」。
   *
   * ⚠ 这与本仓反复记的形态完全一致：**「没判」与「判过且通过」在返回值上长得一样**。
   *   唯一的区别只有读源码才知道 —— 而调用方不会去读。
   *
   * ⚠ 为什么仍保留 `go`（⛔ 不改判成 `hold`）：修复写**本来就要能在账本不健康时进行**，
   *   否则「修坏账」这个动作永远做不了（死锁，与 O-43/T-06b 同族）。
   *   ⇒ **行为不变，但让「未判」可见**。
   *
   * ⚠ 消费者可以据此决定「要不要提示用户这次没走门禁」。
   *   ⛔ 不要把它当成"通过了"的同义词。
   */
  bypass?: 'repair'
}

const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).map((x) => x.trim()).filter((x) => x !== '') : []
const txt = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** `key:value` 形式的假设记录；键必须是封闭集里的状态。 */
export function assumptionStateOf(raw: string): AssumptionState | undefined {
  const s = txt(raw)
  const m = /^(pending|confirmed|rejected)\s*[:：]\s*(.+)$/i.exec(s)
  if (m === null) return undefined
  const body = m[2]?.trim() ?? ''
  return body === '' ? undefined : (m[1]!.toLowerCase() as AssumptionState)
}

/** 阻塞问题：未标 `resolved` / `closed` 即视为阻塞。 */
export function isBlockingQuestion(raw: string): boolean {
  const s = txt(raw)
  if (s === '') return false
  return !/^(resolved|closed)\s*[:：]/i.test(s)
}

const UNVERIFIABLE = /(?:快|稳定|好用|智能|自动|尽量|适当|合理|友好|快速|高效|灵活|充分|足够|良好|easy|fast|stable|user-friendly|appropriate|sufficient|robust)/i

/**
 * 历史豁免的**外部凭据**（S-02 地基 · 2026-11-10）。
 *
 * ── 为什么不能再只读单元自己填的字段 ─────────────────────────────────────
 *   改前 `legacy()` 只读 `clarify_legacy`，而它由写入方自己填；唯一的反制
 *   `legacyMisuse` 读的 `created_at` 同样自填。实测：一条正常 v3 需求报 4 条
 *   违规，补上 `clarify_legacy=pre-control` + 一个很早的 `created_at` 后报 0 条。
 *
 * ── 判据怎么变成他证 ─────────────────────────────────────────────────────
 *   `legacy()` 现在要求三层同时成立：
 *     ① 单元自报 `clarify_legacy=pre-control`（这只是“申请”，⛔ 不是“批准”）；
 *     ② `pipeline_version` 不是 v3（v3 条目**结构上**不豁免）；
 *     ③ 写入方注入的 provenance 判定为 `legacy-migrated`，且 `created_at`
 *        早于 {@link CONTROL_CUTOFF}（provenance 由 I/O 侧按分片给出，⛔ 不是
 *        单元自己声明的字段）。
 *
 * ⚠ **未注入 / 判不出 ⇒ 按存量字段走老逻辑**（本批 B0.1 的兼容默认）：
 *   缺省解析器返回 `unknown`，此时非 v3 单元沿用改前的“只看自报字段”，
 *   存量 177 行行为**零变化**。⚠ 这是分批上线的第一档 —— 等所有出口都注入、
 *   且存量历史分片冻结后，`unknown` 才会收紧成“不豁免”。
 */
export type UnitProvenance = 'legacy-migrated' | 'current' | 'unknown'

/** 写入方注入的 provenance 解析器：只读单元身份，⛔ 不做 I/O、⛔ 不读别的字段。 */
export type UnitProvenanceResolver = (u: StageControlUnit) => UnitProvenance

/** 当前注入的解析器；缺省（未注入）= `undefined` ⇒ {@link provenanceOf} 返回 `unknown`。 */
let provenanceResolver: UnitProvenanceResolver | undefined

/**
 * **注入点**：设置 provenance 解析器。
 * 传 `undefined` = 撤销注入（回退到“按存量字段走老逻辑”）。
 *
 * ⚠ 这是纯函数层唯一的外部事实入口，与 `stageFileProblems(units, exists)`
 *   的 `exists` 回调同构；缺省值必须比“历史”**更严格**（`unknown` 不新增豁免）。
 */
export function setProvenanceResolver(fn: UnitProvenanceResolver | undefined): void {
  provenanceResolver = fn
}

/**
 * 在指定解析器下执行一次**同步**判定，结束后恢复原来的注入。
 *
 * ⚠ I/O 侧按账本注入时走本函数（而不是裸 `setProvenanceResolver`）：
 *   长驻进程里连续判多本账时，不让上一本的分片结论污染下一本。
 */
export function withProvenanceResolver<T>(fn: UnitProvenanceResolver | undefined, run: () => T): T {
  const prev = provenanceResolver
  provenanceResolver = fn
  try { return run() } finally { provenanceResolver = prev }
}

/** 该单元的历史性；未注入 / 判不出 ⇒ `unknown`（= 老逻辑兼容档）。 */
export function provenanceOf(u: StageControlUnit): UnitProvenance {
  if (provenanceResolver === undefined) return 'unknown'
  try { return provenanceResolver(u) } catch { return 'unknown' }
}

/** 新单元不得借用历史豁免；`created_at` 缺省时按“不可证明是历史”处理。 */
const CONTROL_CUTOFF = '2026-11-06'

/** 创建时间是否可证明早于控制上线日（只比较日期部分）。 */
const createdBeforeControl = (u: StageControlUnit): boolean => {
  const created = txt(u.created_at)
  return created !== '' && created.slice(0, 10) < CONTROL_CUTOFF
}

/** 历史需求豁免：只用于控制上线前的存量，⛔ 不是新需求的放行开关。 */
const legacy = (u: StageControlUnit): boolean => {
  /** ① 自报标记只是“申请”；没有它，后面两层都不用看。 */
  if (txt(u.clarify_legacy) !== 'pre-control') return false
  /** ② v3 条目一律不豁免 —— 与 REVIEW §7.2 D-2(A) 的口径一致。 */
  if (isPipelineV3(u as any)) return false
  const provenance = provenanceOf(u)
  /**
   * ③ 未注入 / 判不出 ⇒ 本批按存量字段走老逻辑（⛔ 不改变存量结果）。
   *    ⚠ 收紧这一行（true → false）属于后续批次，必须与存量迁移同批。
   */
  if (provenance === 'unknown') return true
  /** ④ 只有“写入方证明是历史迁移 + 创建时间早于控制上线”才豁免。 */
  return provenance === 'legacy-migrated' && createdBeforeControl(u)
}

export function legacyMisuse(u: StageControlUnit): StageControlProblem[] {
  if (txt(u.clarify_legacy) !== 'pre-control') return []
  const id = txt(u.id) || '(unit)'
  /** v3 条目**结构上**不能拿历史豁免：报 C-11，且所有字段门禁照常开火。 */
  if (isPipelineV3(u as any)) {
    return [{ rule: 'C-11', unit: id, why: 'v3 条目不得使用历史豁免（clarify_legacy = pre-control 只对控制上线前的存量生效）' }]
  }
  const created = txt(u.created_at)
  // 历史豁免必须能证明创建时间早于控制上线日；没有创建时间同样不放行。
  if (created === '') {
    return [{ rule: 'C-11', unit: id, why: '历史豁免必须有 created_at 证明创建于控制上线之前；缺创建时间不得放行' }]
  }
  if (created.slice(0, 10) >= CONTROL_CUTOFF) {
    return [{ rule: 'C-11', unit: id, why: '历史豁免只能用于控制上线前的存量；新单元不得写 clarify_legacy = pre-control' }]
  }
  /**
   * 写入方注入的 provenance 说这条**不是**历史迁移 ⇒ 自报字段不生效。
   * ⚠ `unknown`（未注入 / 判不出）仍走老逻辑：本批只做地基，不改变存量结果。
   */
  if (provenanceOf(u) === 'current') {
    return [{ rule: 'C-11', unit: id, why: '历史豁免缺写入方 provenance（该单元归属 current）⇒ 不得靠自填字段获得豁免' }]
  }
  return []
}

/** 需求契约门禁：agreed 前必须澄清阻塞问题、确认假设、给出可观察验收条件。 */
export function requirementProblems(u: StageControlUnit): StageControlProblem[] {
  if (u.kind !== 'req' || txt(u.status) !== 'agreed' || legacy(u)) return []
  const out: StageControlProblem[] = []
  const id = txt(u.id) || '(req)'
  const questions = arr(u.clarify_questions).filter(isBlockingQuestion)
  if (questions.length > 0) {
    out.push({ rule: 'C-1', unit: id, why: `需求已定但仍有 ${questions.length} 条阻塞问题未解决：${questions[0]!.slice(0, 80)}` })
  }
  const assumptions = arr(u.clarify_assumptions)
  const unknown = assumptions.filter((a) => assumptionStateOf(a) === undefined)
  const pending = assumptions.filter((a) => assumptionStateOf(a) === 'pending')
  if (unknown.length > 0) out.push({ rule: 'C-2', unit: id, why: `有 ${unknown.length} 条假设没有确认状态（须写 pending/confirmed/rejected: 正文）` })
  if (pending.length > 0) out.push({ rule: 'C-2', unit: id, why: `有 ${pending.length} 条假设仍是 pending，不能进入方案阶段` })
  if (arr(u.clarify_examples).length === 0) out.push({ rule: 'C-1', unit: id, why: '没有用户确认的关键例子（clarify_examples 为空）' })
  const criteria = arr(u.acceptance_criteria)
  if (criteria.length === 0) out.push({ rule: 'C-1', unit: id, why: '没有可观察验收条件（acceptance_criteria 为空）' })
  else {
    const vague = criteria.filter((c) => UNVERIFIABLE.test(c))
    if (vague.length > 0) out.push({ rule: 'C-1', unit: id, why: `验收条件含不可验证词：${vague[0]!.slice(0, 80)}` })
  }
  return out
}

/** V2 user gate on the requirement artifact. */
export function requirementApprovalProblems(
  u: StageControlUnit,
  units: readonly StageControlUnit[],
): StageControlProblem[] {
  if (u.kind !== 'req' || !isPipelineV3(u as any)) return []
  const approval = approvalStateOf(u as any, units as any)
  if (['legacy', 'approved'].includes(approval.state)) return []
  return [{
    rule: 'C-18',
    unit: txt(u.id) || '(req)',
    why: `需求未获得用户对当前修订的批准：${approval.reason}`,
  }]
}

/** 方案门禁：settled 前必须给出路径比较、取舍、推荐、需求覆盖。 */
export function planProblems(u: StageControlUnit, units: readonly StageControlUnit[] = [u]): StageControlProblem[] {
  if (u.kind !== 'change' || txt(u.status) !== 'settled' || legacy(u)) return []
  const out: StageControlProblem[] = []
  const id = txt(u.id) || '(change)'
  if (arr(u.path_options).length === 0) out.push({ rule: 'C-4', unit: id, why: '没有候选路径（path_options 为空）' })
  if (arr(u.path_tradeoffs).length === 0) out.push({ rule: 'C-4', unit: id, why: '没有路径取舍（path_tradeoffs 为空）' })
  if (txt(u.path_decision) === '') out.push({ rule: 'C-4', unit: id, why: '没有推荐路径与理由（path_decision 为空）' })
  if (arr(u.requirement_coverage).length === 0) out.push({ rule: 'C-3', unit: id, why: '没有需求到方案的映射（requirement_coverage 为空）' })
  /**
   * **高风险变更必须有独立设计评审**（2026-11-06 · Wave 4）。
   *   ⚠ 判据是"评审者 ≠ 作者"，⛔ 不是"写了一个 reviewer 字段"。
   *   ⚠ 风险等级只认封闭三值；写别的值 ⇒ 红（不猜它想表达什么）。
   */
  const tier = txt(u.risk_tier).toLowerCase()
  if (tier !== '' && !(RISK_TIERS as readonly string[]).includes(tier)) {
    out.push({ rule: 'C-15', unit: id, why: `risk_tier 不在封闭集内：${tier}（只收 ${RISK_TIERS.join(' / ')}）` })
  }
  /**
   * Legacy plans keep their old tier readable. Requiring a current four-value
   * assessment from them would silently rewrite history; the v3 branch below
   * applies the current rules only to artifacts enrolled in v3.
   */
  if (isPipelineV3(u as any) && tier === '') {
    out.push({ rule: 'RP-9', unit: id, why: 'v3 方案缺 risk_tier（不能把缺评定读成 low）' })
  }
  if (isPipelineV3(u as any) && ['high', 'critical'].includes(tier)) {
    const reviewer = txt(u.reviewer)
    if (reviewer === '') out.push({ rule: 'C-15', unit: id, why: '高风险变更缺独立设计评审者（reviewer）' })
    else if (reviewer === txt(u.built_by)) out.push({ rule: 'C-15', unit: id, why: '设计评审者就是作者本人（reviewer == built_by）' })
    if (arr(u.review_refs).length === 0) out.push({ rule: 'C-15', unit: id, why: '高风险变更缺评审记录（review_refs 为空）' })
    if (tier === 'critical' && arr(u.review_refs).length < 2) out.push({ rule: 'C-15', unit: id, why: 'critical 变更至少需要两份独立评审证据' })
  }
  if (isPipelineV3(u as any)) {
    out.push(...riskAssessmentProblems(u as any))
    /**
     * The risk assessment is bound to the plan facts that existed when it was
     * made. A scope, dependency, delivery or acceptance change must invalidate
     * the old assessment instead of silently reusing it.
     */
    const bound = txt(u.risk_binding_digest)
    if (bound === '') {
      out.push({ rule: 'RP-3', unit: id, why: 'v3 方案缺 risk_binding_digest（无法判断风险评定是否仍对应当前方案事实）' })
    } else if (bound !== riskBindingDigestOf(u as Record<string, unknown>, units as unknown as readonly Record<string, unknown>[])) {
      out.push({ rule: 'RP-3', unit: id, why: '方案范围 / 依赖 / 交付目标或验收对象已变化 ⇒ 旧风险评定 stale，必须重评并更新绑定摘要' })
    }
    if (txt(u.risk_assessment_ref) === '') {
      out.push({ rule: 'RP-3', unit: id, why: 'v3 方案缺 risk_assessment_ref（完整评定记录引用）' })
    }
    if (txt(u.risk_binding_version) === '') {
      out.push({ rule: 'RP-3', unit: id, why: 'v3 方案缺 risk_binding_version（无法识别旧评定与新规则）' })
    }
    /**
     * G2 gate depth is tiered. Medium and above require a real path comparison
     * and a verification strategy; high and critical require independent
     * review, and critical requires dual evidence or explicit authorization.
     * Low still needs at least one reasonable path, but not two fabricated
     * alternatives.
     */
    const requirements = riskGateRequirements(txt(u.risk_tier) as any)
    const options = arr(u.path_options)
    /**
     * ⚠ **O-03：判据只有一个来源** —— `requirements.minPaths`。
     *   ⛔ 不要在这里再写 `tier === 'low' ? 1 : 2` —— 那正是改前的形态
     *     （字段说一套、调用方另算一套，两处迟早分叉）。
     */
    if (options.length < requirements.minPaths) {
      out.push({ rule: 'C-4', unit: id, why: `${tier || '未声明'} 风险至少需要 ${requirements.minPaths} 个可行路径或说明唯一可行原因` })
    }
    if (requirements.verificationStrategy) {
      const hasStrategy = txt(u.test_strategy) !== '' || arr(u.research_refs).length > 0 || arr(u.review_refs).length > 0
      if (!hasStrategy) out.push({ rule: 'RP-8', unit: id, why: `${tier} 风险必须给出验证策略（test_strategy / research_refs / review_refs 至少一项）` })
    }
    if (tier === 'critical') {
      const reviewRefs = arr(u.review_refs)
      if (reviewRefs.length < 2 && txt(u.accepted_by) === '') {
        out.push({ rule: 'RP-5', unit: id, why: 'critical 风险必须有双评审证据或用户明确授权（accepted_by）' })
      }
    }
  }
  return out
}

/** V2 user gate on the implementation plan. */
export function planApprovalProblems(
  u: StageControlUnit,
  units: readonly StageControlUnit[],
): StageControlProblem[] {
  if (u.kind !== 'change' || !isPipelineV3(u as any)) return []
  const approval = approvalStateOf(u as any, units as any)
  if (['legacy', 'approved'].includes(approval.state)) return []
  return [{
    rule: 'C-19',
    unit: txt(u.id) || '(change)',
    why: `方案未获得用户对当前修订的批准：${approval.reason}`,
  }]
}

/** 任务门禁：可开工任务必须有自包含任务书、反例、停手条件和回流阶段。 */
export function taskProblems(u: StageControlUnit): StageControlProblem[] {
  if (u.kind !== 'task' || !['todo', 'doing', 'built'].includes(txt(u.status)) || legacy(u)) return []
  const out: StageControlProblem[] = []
  const id = txt(u.id) || '(task)'
  if (txt(u.task_brief) === '') out.push({ rule: 'C-5', unit: id, why: '缺自包含任务书引用（task_brief）' })
  if (arr(u.counterexamples).length === 0) out.push({ rule: 'C-5', unit: id, why: '缺反例（counterexamples）' })
  if (arr(u.stop_conditions).length === 0) out.push({ rule: 'C-5', unit: id, why: '缺停手条件（stop_conditions）' })
  const ret = txt(u.return_to)
  if (ret === '') out.push({ rule: 'C-5', unit: id, why: '缺默认回流阶段（return_to）' })
  else if (!(STAGE_RETURN_TARGETS as readonly string[]).includes(ret)) {
    out.push({ rule: 'C-5', unit: id, why: `回流目标不在封闭集内：${ret}（只收 back-to-requirement / back-to-plan / back-to-task）` })
  }
  /**
   * Pipeline task risk rules live in `risk-policy.ts`; this function owns C-5.
   * The status gate above only covers runnable/built tasks, but a v3 task must
   * declare execution risk even while it is still a draft so G3 can judge it.
   */
  return out
}

/** C-5 plus the separate execution-risk layer for one v3 task. */
export function taskFullProblems(u: StageControlUnit): StageControlProblem[] {
  if (u.kind !== 'task' || legacy(u)) return taskProblems(u)
  return [...taskProblems(u), ...taskRiskProblems(u as Record<string, unknown>)]
}

/**
 * Task-graph execution-risk gate.
 *
 * A per-task declaration is not enough: two tasks that write the same path
 * cannot run concurrently merely because each is individually well formed.
 * The graph must serialize them, or the plan must split the contract.
 */
export function taskGraphRiskProblems(units: readonly StageControlUnit[]): StageControlProblem[] {
  const out: StageControlProblem[] = []
  const tasks = units.filter((u) => u.kind === 'task' && isPipelineV3(u as any)
    && ['todo', 'doing', 'built'].includes(txt(u.status)))
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const a = tasks[i]!
      const b = tasks[j]!
      if (txt(a.parent) !== txt(b.parent)) continue
      const overlap = taskScopeConflict(a as any, b as any)
      if (overlap === undefined) continue
      const aDeps = arr(a.depends_on)
      const bDeps = arr(b.depends_on)
      const serial = aDeps.includes(txt(b.id)) || bDeps.includes(txt(a.id))
        || taskRiskOf(a as any).requirements.serialRequired
        || taskRiskOf(b as any).requirements.serialRequired
      if (!serial) {
        out.push({
          rule: 'RP-5', unit: `${txt(a.id)} / ${txt(b.id)}`,
          why: `同一方案下的两个任务写同一路径（${overlap}）但没有串行依赖 ⇒ 要么加 depends_on，要么拆清写范围`,
        })
      }
    }
  }
  return out
}

/**
 * A parent plan's closure decision must agree with the task-level risk that
 * actually ran underneath it. A task cannot silently exceed the approved plan
 * risk tier and still be treated as ordinary delivery.
 */
export function taskRiskAgainstPlanProblems(units: readonly StageControlUnit[]): StageControlProblem[] {
  const out: StageControlProblem[] = []
  const byId = new Map(units.map((u) => [txt(u.id), u]))
  for (const task of units) {
    if (task.kind !== 'task' || !isPipelineV3(task as any)) continue
    const risk = taskRiskOf(task as any)
    const plan = byId.get(txt(task.parent))
    if (plan === undefined || plan.kind !== 'change' || !isPipelineV3(plan as any)) continue
    const planTier = riskAssessmentOf(riskFactsOf(plan as any)).tier
    if (tierAbove(risk.tier, planTier) && txt(plan.risk_assessment_ref) === '') {
      out.push({
        rule: 'RP-8', unit: txt(task.id) || '(task)',
        why: `任务风险 ${risk.tier} 高于方案风险 ${planTier}，但方案没有记录升级后的 risk_assessment_ref ⇒ 回 G2 重评`,
      })
    }
    if (risk.tier === 'critical' && txt(plan.reviewer) === '') {
      out.push({ rule: 'RP-8', unit: txt(task.id) || '(task)', why: 'critical 任务所在方案缺用户授权 / 独立评审者' })
    }
  }
  return out
}

function tierAbove(a: string, b: string): boolean {
  const rank: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 }
  return (rank[a] ?? 0) > (rank[b] ?? 0)
}

/**
 * 验收门禁：pass 前必须有产品确认、独立验收会话、技术证据和用户例子结果；
 * 退回必须有目标阶段。
 *
 * @param units - 全账本（用于按 parent / task 反查实现者与需求例子）
 */
export function acceptanceProblems(u: StageControlUnit, units: readonly StageControlUnit[] = [u]): StageControlProblem[] {
  if (u.kind !== 'acc') return []
  if (legacy(u)) return []
  const out: StageControlProblem[] = []
  const id = txt(u.id) || '(acc)'
  if (txt(u.status) === 'pass' && txt(u.product_confirmation) === '') {
    out.push({ rule: 'C-7', unit: id, why: '验收通过但缺产品确认（product_confirmation）' })
  }
  if (txt(u.status) === 'pass') {
    const byId = new Map(units.map((x) => [txt(x.id), x]))
    const parent = byId.get(txt(u.parent))
    const builder = txt(parent?.built_by)
    const acceptor = txt(u.actor)
    const session = txt(u.acceptance_session)
    if (acceptor === '') out.push({ rule: 'C-7', unit: id, why: '验收通过但缺验收者（actor）' })
    /**
     * ⚠⚠ **S-03：与 `convergence.ts:380` 的 K-6 对齐 —— 缺失时 fail-closed，⛔ 不是放行。**
     *
     *   改前写的是 `builder !== '' && acceptor === builder` ⇒ **父任务没有 `built_by` 时**
     *   这一条**根本不检查**，于是「自己验自己」被静默放过。
     *   ⚠ 缺失反而让检查更容易通过 = **fail-open**，而同一语义在 K-6 里是 fail-closed
     *   （`built_by` 缺 ⇒ 直接报「没法判是不是自己验自己」）。
     *   同一语义、两个模块、两种方向 —— 那本身就是缺陷（判定会随走哪条路而变）。
     *   ⇒ 改成：缺 `built_by` ⇒ 报「无法判定独立性」（⛔ 不按通过处理）。
     */
    if (builder === '') {
      out.push({ rule: 'C-7', unit: id, why: '父任务缺 built_by ⇒ **没法判**是不是自己验自己（⛔ 不按通过处理）' })
    } else if (acceptor === builder) {
      out.push({ rule: 'C-7', unit: id, why: '验收者与实现者是同一个会话（自己验自己）' })
    }
    if (session === '') out.push({ rule: 'C-7', unit: id, why: '验收通过但缺独立验收会话（acceptance_session）' })
    else if (session === builder) out.push({ rule: 'C-7', unit: id, why: '独立验收会话与实现者相同（acceptance_session == built_by）' })
    if (arr(u.verification_refs).length === 0) out.push({ rule: 'C-7', unit: id, why: '验收通过但缺技术验证证据（verification_refs 为空）' })
    if (arr(u.example_results).length === 0) out.push({ rule: 'C-7', unit: id, why: '验收通过但缺用户例子逐条结果（example_results 为空）' })
    else {
      /**
       * **例子结果必须能逐条回溯**（2026-11-06 · Wave 2）：
       *   ⚠ 只看"非空"会让 `["都通过了"]` 也算证据 —— 那不是读数，是一句结论。
       *   判据：每条都必须是 `EX-id | pass/fail(...) | 证据|注` 三段式，
       *   且非 `pass` 时**必须**给出证据引用（EVD- / archive/ / URL）。
       */
      const malformed = arr(u.example_results).filter((line) => {
        const parts = line.split('|').map((x) => x.trim())
        return parts.length < 2 || parts[0] === '' || parts[1] === ''
      })
      if (malformed.length > 0) {
        out.push({ rule: 'C-12', unit: id, why: `用户例子结果不是三段式（${malformed[0]!.slice(0, 60)}）` })
      }
      const noEvidence = arr(u.example_results).filter((line) => {
        const parts = line.split('|').map((x) => x.trim())
        const verdict = (parts[1] ?? '').toLowerCase()
        if (!/^pass\b/.test(verdict)) {
          return !(parts.length >= 3 && /(EVD-|archive\/|https?:\/\/)/.test(parts[2] ?? ''))
        }
        return false
      })
      if (noEvidence.length > 0) {
        out.push({ rule: 'C-12', unit: id, why: `非通过的例子缺证据引用（${noEvidence[0]!.slice(0, 60)}）` })
      }
    }
    /**
     * **有条件通过**（`release_ready=no`）必须有整改项，且整改项格式可追踪；
     * ⛔ 不许用"有条件通过"当免死金牌。
     */
    if (txt(u.release_ready).toLowerCase() === 'no' && arr(u.liens).length === 0) {
      out.push({ rule: 'C-13', unit: id, why: 'release_ready=no（有条件通过）但缺整改项（liens 为空）' })
    }
    /**
     * **发布子门禁**（2026-11-06 · Wave 4）：声明可发布（`release_ready=yes`）时，
     * 构建 / 重启 / 冒烟三类证据必须齐。⚠ 插件类交付**光有单测不算可交付**：
     * 宿主只认"重启后真加载的那份代码"。
     */
    if (txt(u.release_ready).toLowerCase() === 'yes') {
      const refs = arr(u.release_refs).join('\n').toLowerCase()
      const missing = [
        ['构建', /build|构建/],
        ['重启', /restart|重启|reload/],
        ['冒烟', /smoke|冒烟|route|路由|http\s*20\d/],
      ].filter(([, re]) => !(re as RegExp).test(refs)).map(([name]) => name)
      if (missing.length > 0) {
        out.push({ rule: 'C-14', unit: id, why: `release_ready=yes 但缺发布证据：${missing.join(' / ')}` })
      }
    }
    /**
     * Residual risk is part of the product decision, not a G6 afterthought.
     * High / critical residuals need an explicit user acceptance, impact and a
     * monitoring or rollback path even when the result itself is accepted.
     */
    const residualTier = txt(u.risk_residual_tier).toLowerCase()
    if (!['', 'low', 'medium', 'high', 'critical'].includes(residualTier)) {
      out.push({ rule: 'RP-10', unit: id, why: `risk_residual_tier 不在封闭集：${residualTier}` })
    } else if (['high', 'critical'].includes(residualTier)) {
      if (txt(u.risk_accepted_by) === '') out.push({ rule: 'RP-10', unit: id, why: `${residualTier} 残余风险必须由用户或授权人接受（risk_accepted_by）` })
      if (txt(u.risk_residual_impact) === '') out.push({ rule: 'RP-10', unit: id, why: `${residualTier} 残余风险必须记录影响范围（risk_residual_impact）` })
      if (txt(u.risk_residual_monitoring) === '') out.push({ rule: 'RP-10', unit: id, why: `${residualTier} 残余风险必须记录监控 / 回退方式（risk_residual_monitoring）` })
      if (arr(u.risk_accept_conditions).length === 0) out.push({ rule: 'RP-10', unit: id, why: `${residualTier} 残余风险必须登记接受条件（risk_accept_conditions）` })
    }
  }
  const back = txt(u.send_back_to)
  if (txt(u.status) === 'send-back' && back === '') out.push({ rule: 'C-8', unit: id, why: '退回但缺目标阶段（send_back_to）' })
  else if (back !== '' && !(STAGE_RETURN_TARGETS as readonly string[]).includes(back)) {
    out.push({ rule: 'C-8', unit: id, why: `退回目标不在封闭集内：${back}（只收 back-to-requirement / back-to-plan / back-to-task）` })
  }
  return out
}

/** 运行记录：returned 必须带小步验证读数。 */
export function runProblems(u: StageControlUnit): StageControlProblem[] {
  if (u.kind !== 'run' || txt(u.status) !== 'returned' || legacy(u)) return []
  return arr(u.progress_refs).length === 0
    ? [{ rule: 'C-6', unit: txt(u.id) || '(run)', why: '运行已回传但无小步验证读数（progress_refs 为空）' }]
    : []
}

/**
 * Independent technical verification gate.
 *
 * Verification is deliberately separate from product acceptance: it answers
 * whether the approved requirements and controls were implemented correctly,
 * not whether the user accepts the result.
 */
export function verificationProblems(
  u: StageControlUnit,
  units: readonly StageControlUnit[] = [u],
): StageControlProblem[] {
  if (u.kind !== 'verification' || legacy(u)) return []
  const out: StageControlProblem[] = []
  const id = txt(u.id) || '(verification)'
  const status = txt(u.status)
  if (!['pass', 'send-back', 'waived'].includes(status)) return out
  if (arr(u.basis).length === 0 && arr(u.evidence_refs).length === 0) {
    out.push({ rule: 'C-25', unit: id, why: '技术验证结论缺依据（basis / evidence_refs 均为空）' })
  }
  if (txt(u.verified_at) === '' || !Number.isFinite(Date.parse(txt(u.verified_at)))) {
    out.push({ rule: 'C-25', unit: id, why: '技术验证缺可解析的 verified_at' })
  }
  if (txt(u.verifier) === '') out.push({ rule: 'C-25', unit: id, why: '技术验证缺 verifier' })
  if (txt(u.verification_session) === '') out.push({ rule: 'C-25', unit: id, why: '技术验证缺独立会话 verification_session' })
  const parent = units.find((x) => txt(x.id) === txt(u.parent))
  const builder = txt(parent?.built_by)
  /**
   * ⚠ **S-03（第二处）**：同上 —— 缺 `built_by` ⇒ fail-closed，⛔ 不是跳过。
   *   （C-25 守技术验证的独立性，与 C-7 守验收独立性是同一件事的两个环节。）
   */
  if (builder === '') {
    out.push({ rule: 'C-25', unit: id, why: '父任务缺 built_by ⇒ **没法判**技术验证是否独立（⛔ 不按通过处理）' })
  } else if (txt(u.verifier) === builder || txt(u.verification_session) === builder) {
    out.push({ rule: 'C-25', unit: id, why: '技术验证者是实现者本人（违反独立性）' })
  }
  if (arr(u.criteria_refs).length === 0) out.push({ rule: 'C-25', unit: id, why: '技术验证没有对应的验收条件（criteria_refs 为空）' })
  if (arr(u.nonconformance_refs).length > 0 && status === 'pass') {
    out.push({ rule: 'C-25', unit: id, why: '技术验证已通过但仍挂着未关闭非符合项' })
  }
  if (status === 'send-back' && txt(u.send_back_to) === '') {
    out.push({ rule: 'C-26', unit: id, why: '技术验证退回但缺 send_back_to' })
  }
  if (status === 'waived' && (txt(u.waiver_source) === '' || txt(u.waived_by) === '')) {
    out.push({ rule: 'C-26', unit: id, why: '技术验证豁免必须记录 waiver_source 与 waived_by' })
  }
  /**
   * Risk-control verification. When the parent plan declares hard triggers or
   * a high/critical tier, a generic "tests pass" conclusion is not enough:
   * each control needs its own verification evidence.
   */
  const task = units.find((x) => txt(x.id) === txt(u.parent))
  const plan = task === undefined ? undefined
    : units.find((x) => txt(x.id) === txt(task.parent) && txt(x.kind) === 'change')
  if (plan !== undefined && status === 'pass' && isPipelineV3(plan as any)) {
    const assessment = riskAssessmentOf(riskFactsOf(plan as any))
    const needsControls = assessment.hardTriggers.length > 0 || ['high', 'critical'].includes(assessment.tier)
    if (needsControls) {
      const reviewRefs = arr(u.risk_review_refs)
      if (reviewRefs.length === 0) {
        out.push({ rule: 'RP-6', unit: id, why: `${assessment.tier} 方案含 ${assessment.hardTriggers.length} 条硬触发 ⇒ 技术验证必须逐项记录风险控制证据 risk_review_refs` })
      } else if (assessment.hardTriggers.length > reviewRefs.length) {
        out.push({ rule: 'RP-6', unit: id, why: `硬触发 ${assessment.hardTriggers.length} 条，但风险控制证据只有 ${reviewRefs.length} 条 ⇒ 不能证明每条控制都验过` })
      }
    }
    /**
     * If technical verification discovers a risk the approved plan did not
     * declare, a PASS is not valid: it must return to the plan stage so the
     * risk can be assessed and the plan revision re-approved.
     */
    const newRiskRefs = arr(u.new_risk_refs)
    if (newRiskRefs.length > 0) {
      const planRiskIds = new Set(arr((plan as any).risk_ids))
      const undeclared = newRiskRefs.filter((x) => !planRiskIds.has(x))
      if (undeclared.length > 0 && status === 'pass') {
        out.push({ rule: 'RP-6', unit: id, why: `技术验证发现方案未声明的新风险：${undeclared.join(' / ')} ⇒ 不能 PASS，必须回 G2 重评` })
      }
      if (txt(u.new_risk_reason) === '') {
        out.push({ rule: 'RP-6', unit: id, why: '技术验证记录新风险但缺 new_risk_reason（无法复核发现依据）' })
      }
    }
  }
  return out
}

/** Delivery closure gate, derived from the change risk assessment. */
export function closureProblems(
  u: StageControlUnit,
  units: readonly StageControlUnit[] = [u],
): StageControlProblem[] {
  if (u.kind !== 'closure' || legacy(u)) return []
  const out: StageControlProblem[] = []
  const id = txt(u.id) || '(closure)'
  const status = txt(u.status)
  if (!['closed', 'skipped', 'blocked'].includes(status)) return out
  const mode = txt(u.closure_mode)
  if (!['skipped', 'standard', 'strict'].includes(mode)) {
    out.push({ rule: 'C-27', unit: id, why: `closure_mode 不在封闭集：${mode || '(空)'}` })
  }
  const req = units.find((x) => txt(x.id) === txt(u.parent))
  /**
   * ⚠ **R-13：⛔ 不按物理顺序取**。改前是 `plans.at(-1)` ⇒ 结论随文件位置翻转，
   *   而迁移会移动位置 ⇒ 迁移前后 G6 档位可能不同（fail-open）。
   *   ⇒ 统一走 `currentPlanOfStrict`（业务状态 + revision）；判不出时返回 undefined。
   */
  const plan = req === undefined
    ? undefined
    : currentPlanOfStrict(txt(req.id), units as unknown as readonly Record<string, unknown>[])
  const assessed = plan === undefined ? undefined : riskAssessmentOf(riskFactsOf(plan as any))
  if (status === 'skipped') {
    if (txt(u.skip_reason) === '') out.push({ rule: 'C-27', unit: id, why: '跳过交付收口必须写 skip_reason' })
    if (txt(u.accepted_by) === '') out.push({ rule: 'C-27', unit: id, why: '跳过交付收口必须记录决定者 accepted_by' })
    if (assessed !== undefined && assessed.closure === 'strict') {
      out.push({ rule: 'C-27', unit: id, why: '风险要求 strict 收口，不能标记 skipped' })
    }
  }
  if (status === 'closed') {
    if (assessed !== undefined && mode !== assessed.closure) {
      out.push({ rule: 'C-27', unit: id, why: `closure_mode ${mode} 与风险推导 ${assessed.closure} 不一致` })
    }
    if (arr(u.release_refs).length === 0) out.push({ rule: 'C-27', unit: id, why: '交付收口缺发布 / 构建证据' })
    /**
     * Standard is not just "some release evidence". It needs a build, a smoke
     * reading, a rollback path and a post-release check; otherwise a deploy can
     * be called closed with only a commit hash. Strict adds independent release
     * authorization, monitoring and residual-risk acceptance.
     */
    if (mode === 'standard' || mode === 'strict') {
      const refs = arr(u.release_refs).join('\n').toLowerCase()
      const missing = [
        ['构建', /build|构建/],
        ['冒烟', /smoke|冒烟|route|路由|http\s*20\d/],
        ['发布后检查', /post[- ]?release|发布后|after release|monitor|监控/],
      ].filter(([, re]) => !(re as RegExp).test(refs)).map(([name]) => name)
      if (missing.length > 0) out.push({ rule: 'C-27', unit: id, why: `交付收口缺发布证据：${missing.join(' / ')}` })
      if (arr(u.rollback_refs).length === 0) out.push({ rule: 'C-28', unit: id, why: `${mode} 收口缺回滚 / 恢复证据` })
    }
    if (mode === 'strict') {
      if (arr(u.monitoring_refs).length === 0) out.push({ rule: 'C-28', unit: id, why: 'strict 收口缺发布后监控证据' })
      if (txt(u.accepted_by) === '') out.push({ rule: 'C-28', unit: id, why: 'strict 收口缺接受者 accepted_by' })
      if (txt(u.approval_ref) === '') out.push({ rule: 'C-28', unit: id, why: 'strict 收口缺独立发布审批 approval_ref' })
    }
    if (arr(u.liens).length > 0) out.push({ rule: 'C-28', unit: id, why: '仍有未关闭整改项，不能宣布交付收口' })
  }
  /**
   * G6 may not silently rewrite G5. A closure that claims to be finished must
   * point at the accepted chain, the risk assessment it used, and the current
   * residual-risk decision. Without those bindings, "closed" is only a label.
   */
  /**
   * ⚠⚠ **S-05：三个绑定引用必须**解析到真实单元**，⛔ 不是只查非空。**
   *
   *   改前只判 `txt(ref) === ''` ⇒ 填一个**不存在的 id** 即可满足 C-29
   *   ⇒ 上面那条注释「G6 may not silently rewrite G5」退化成「三个字符串非空」。
   *
   *   ⚠ 这与 `convergence.ts` 里 K-2/K-3/K-5 的口径**不一致**：那边是「悬空引用即红」。
   *     同一套体系里两套口径 ⇒ 用户学到的规则取决于他碰巧在看哪条判据。
   *
   *   ⚠ 每条引用还要**核对 kind**：`chain_acceptance_ref` 必须指向 `acc`，
   *     `risk_assessment_ref` 指向 `risk`，`residual_risk_decision_ref` 指向 `decision`。
   *     ⛔ 只查「存在」不够：指向一个 `task` 也能通过，那同样证明不了 G5 已接受。
   */
  if (status === 'closed' || status === 'skipped') {
    const bound: Array<{ field: string; expectKind: string; why: string }> = [
      { field: 'chain_acceptance_ref', expectKind: 'acc', why: '无法证明 G5 已接受' },
      { field: 'risk_assessment_ref', expectKind: 'risk', why: '无法证明用的是哪次风险评定' },
      { field: 'residual_risk_decision_ref', expectKind: 'decision', why: '无法证明残余风险已被接受 / 无需接受' },
    ]
    for (const b of bound) {
      const ref = txt((u as unknown as Record<string, unknown>)[b.field])
      if (ref === '') {
        out.push({ rule: 'C-29', unit: id, why: `交付收口缺 ${b.field}（${b.why}）` })
        continue
      }
      const target = units.find((x) => txt(x.id) === ref)
      if (target === undefined) {
        out.push({
          rule: 'C-29',
          unit: id,
          why: `${b.field} 指向不存在的单元 ${ref}（悬空引用 ⇒ ${b.why}；⛔ 填一个 id 不等于绑定了事实）`,
        })
      } else if (txt(target.kind) !== b.expectKind) {
        out.push({
          rule: 'C-29',
          unit: id,
          why: `${b.field} 指向 ${ref}，但它的 kind 是 ${txt(target.kind) || '(空)'}（应为 ${b.expectKind}）`
            + ` ⇒ ${b.why}`,
        })
      }
    }
  }
  return out
}

/**
 * **条目标题必须能独立理解**（2026-11-07 · 条目展示批次）。
 *
 * 历史条目（`clarify_legacy=pre-control`）只做展示投影，不因旧标题被阻断；
 * 新条目只拦三类确定性坏法，不评价文风：
 *   · 标题只有编号 / 期次 / 轮次，读者必须再查一条才知道对象；
 *   · 标题只写生命周期状态词（待验收 / 已完成 / 已回传），没有对象；
 *   · 标题引用的正式编号不是自己的关系对象（不靠标题反推关系）。
 */
export function titleProblems(u: StageControlUnit, units: readonly StageControlUnit[] = [u]): StageControlProblem[] {
  if (!['req', 'change', 'task', 'run', 'acc'].includes(txt(u.kind)) || legacy(u)) return []
  const out: StageControlProblem[] = []
  const id = txt(u.id) || '(unit)'
  const title = txt(u.title)
  /** 缺字段由索引必填检查（I1）负责；C-17 不重复开火。 */
  if (title === '') return out
  /**
   * 新条目的 `title=id` 就是“只有编号”：读者必须再查一条才知道对象。
   * 历史存量（`pre-control`）已在函数入口豁免，不在这里放宽新条目。
   */
  if (title === id) {
    out.push({ rule: 'C-17', unit: id, why: '标题就是本条目编号，未说明实际对象或动作' })
    return out
  }
  const onlyRef = /^(?:G|R|CHG|TSK|RUN|ACC|EVD|RSK|DEC|CAP)-[A-Za-z0-9-]+$/.test(title)
  const onlyPeriod = /^(?:P\d+|第\s*\d+\s*(?:期|轮))(?:[：:]\s*第\s*\d+\s*期\s*(?:[（(].*[）)])?)?$/.test(title)
  const onlyStatus = /^(?:待验收|待独立验收|还没验|已完成|完成|已通过|验收通过|已回传|执行中|进行中|未开始)$/.test(title)
  if (onlyRef || onlyPeriod || onlyStatus) {
    out.push({ rule: 'C-17', unit: id, why: '标题只有编号 / 期次 / 轮次 / 状态词，未说明实际对象或动作' })
  }
  /**
   * ⚠ 验收对象的标题里写需求编号是**历史惯例**；它不算“引用了非正式关系”，
   *   只要那条需求能沿本任务 `req_ids` 或父链到达即可。新条目仍不许把**无关编号**
   *   塞进标题（例如把 R-999 写进一条与它无关的任务标题）。
   */
  const referenced = [...title.matchAll(/\b(?:G|R|CHG|TSK|RUN|ACC|EVD|RSK|DEC|CAP)-[A-Za-z0-9-]+\b/g)].map((m) => m[0])
  const allowed = new Set<string>([id])
  for (const x of [txt(u.parent), ...arr(u.req_ids), ...arr(u.addresses), ...arr(u.acceptance_ids), ...arr(u.verify_refs)]) {
    if (x !== '') allowed.add(x)
  }
  const parent = units.find((x) => txt(x.id) === txt(u.parent))
  for (const x of [...arr(parent?.req_ids), ...arr(parent?.addresses), ...arr(parent?.acceptance_ids)]) allowed.add(x)
  for (const x of arr(parent?.req_ids)) {
    const linked = units.filter((y) => arr(y.req_ids).includes(x) || arr(y.addresses).includes(x) || txt(y.parent) === x)
    for (const y of linked) allowed.add(txt(y.id))
  }
  if (parent !== undefined) allowed.add(txt(parent.id))
  const foreign = [...new Set(referenced.filter((x) => !allowed.has(x)))]
  if (foreign.length > 0) {
    out.push({ rule: 'C-17', unit: id, why: `标题引用了非本条目正式关系的编号：${foreign.join(' / ')}（关系应写进 relation 字段或正式引用）` })
  }
  return out
}

/**
 * **证据可复核**（2026-11-06 · Wave 2）：EVD 单元必须有读数与代码态，
 * 声明了 `evidence_kind` 时，命令类证据必须同时给出 `command` 与 `exit_code`。
 *
 * ⚠ 只看 `reading` 非空会让"我看过了"也算证据；这里要求**能复跑**。
 * ⚠ 历史存量（`pre-control`）只读豁免，⛔ 不逼人给旧证据补命令。
 */
export function evidenceProblems(u: StageControlUnit): StageControlProblem[] {
  if (u.kind !== 'evidence' || legacy(u)) return []
  const out: StageControlProblem[] = []
  const id = txt(u.id) || '(evidence)'
  if (txt(u.reading) === '' && arr(u.evidence_refs).length === 0) {
    out.push({ rule: 'C-16', unit: id, why: '证据没有读数（reading 为空）也没有指向别的证据' })
  }
  const kind = txt(u.evidence_kind).toLowerCase()
  if (kind !== '' && !['command', 'artifact', 'report', 'url', 'review'].includes(kind)) {
    out.push({ rule: 'C-16', unit: id, why: `evidence_kind 不在封闭集内：${kind}` })
  }
  if (kind === 'command') {
    if (txt(u.command) === '') out.push({ rule: 'C-16', unit: id, why: '命令类证据缺 command（无法复跑）' })
    const code = txt(u.exit_code)
    if (code === '') out.push({ rule: 'C-16', unit: id, why: '命令类证据缺 exit_code（无法判断成败）' })
    else if (!/^-?\d+$/.test(code)) out.push({ rule: 'C-16', unit: id, why: `exit_code 不是整数：${code}` })
  }
  if (kind === 'artifact' && txt(u.artifact_ref) === '') {
    out.push({ rule: 'C-16', unit: id, why: '产物类证据缺 artifact_ref（不知道产物在哪）' })
  }
  return out
}

/**
 * Stage field and relationship problems.
 *
 * Missing user approval is intentionally NOT part of this function. An
 * unapproved requirement/plan is still a valid draft that must be writable so
 * the user has something concrete to approve. Approval is a progression and
 * dispatch gate, represented by `stageApprovalProblems`.
 */
export function stageFieldProblems(
  units: readonly StageControlUnit[],
  /**
   * ⚠⚠ **S-03 暴露的真缺陷（2026-11-11）**：判「一条单元有没有问题」时，
   *   有些规则要**看别的单元**才能判 —— 例如 C-7 要读**父任务**的 `built_by`
   *   才知道「验收者是不是实现者」。
   *
   *   改前这里只有 `units` 一个参数，调用方传「本次写入的单元」⇒
   *   `acceptanceProblems(acc, [acc])` **找不到父任务** ⇒ 父任务被判成"缺 built_by"。
   *
   *   ⚠ 而 S-03 把这条判据改成 fail-closed 之后，那个误判从「静默放过」变成
   *     **拒绝写入** —— 于是暴露出来：**不是 S-03 引入的缺陷，是它照出了既有缺陷。**
   *
   *   ⇒ 现在分两个参数：
   *     · `units`   —— **判谁**（只报这些单元自己的问题）；
   *     · `context` —— **查引用用**（默认同 `units`，向后兼容既有调用方）。
   *   ⚠ 两个参数分开是必须的：只传 context 会把既有单元的欠账也算进来（T-06b 死锁）。
   */
  context: readonly StageControlUnit[] = units,
): StageControlProblem[] {
  return [
    ...units.flatMap((u) => [
      ...requirementProblems(u),
      /**
       * A v3 plan's risk binding digest is computed against the requirements it
       * addresses. Passing the default `[u]` here made every correctly bound
       * plan look stale whenever the ledger also contained its requirement.
       * The full unit set is the same one `planProblems` uses on the dispatch
       * path, so both gates now reach the same verdict for the same ledger.
       */
      ...planProblems(u, context),
      ...taskFullProblems(u),
      ...runProblems(u),
      ...evidenceProblems(u),
      ...acceptanceProblems(u, context),
      ...verificationProblems(u, context),
      ...closureProblems(u, context),
      ...titleProblems(u, context),
      ...legacyMisuse(u),
    ]),
    ...taskGraphRiskProblems(context),
    ...taskRiskAgainstPlanProblems(context),
    ...riskObjectProblems(context as unknown as Array<Record<string, unknown>>),
  ]
}

/** User gates that must be satisfied before the pipeline may move forward. */
export function stageApprovalProblems(units: readonly StageControlUnit[]): StageControlProblem[] {
  return [
    ...units.map((u) => requirementApprovalProblems(u, units)),
    ...units.map((u) => planApprovalProblems(u, units)),
  ].flat()
}

/** Complete progression health: fields + user gates. */
export function stageControlProblems(units: readonly StageControlUnit[]): StageControlProblem[] {
  return [...stageFieldProblems(units), ...stageApprovalProblems(units)]
}

/**
 * **账本闭环缺口**（2026-11-08 · 用户报「没有账本或旧账本梳理不到完全健康」）。
 *
 * ══ 它治的病（实测）══════════════════════════════════════════════════════════
 *   `stageFieldProblems` 是**逐条单元**的字段门禁：它只问"这一条填全了没有"。
 *   ⇒ 一本账里**只有一条 `change`**（没有任何 req / task / run / acc）也能判成"无缺口"，
 *     于是面板与派活都说"完全健康"。实测：
 *       `prompt-enhancer-release` 只有 `CHG-344`（change）⇒ `problems = []` ⇒ ready。
 *
 *   ⚠ 这不是"字段缺失"，是**链断了**：方案没有需求托底、任务没有方案托底。
 *     用户要的是"账本梳理健康"，而"一条方案孤零零地躺着"显然不是健康。
 *
 * ══ 四条闭环判据（只查**引用指向的东西真的存在**）══════════════════════════════
 *   L-1 每条 `change` 的 `requirement_coverage` / `req_ids` 至少指到**一个真实 req**
 *   L-2 每条 `task` 的 `parent` 必须是**真实 change**
 *   L-3 每条 `run` 的 `parent` 必须是**真实 task**
 *   L-4 每条 `acc` 的 `parent` 必须是**真实 task**
 *
 * ⚠ 只查**存在性**，⛔ 不要求"必须有一条链"：一本**完全空**的账由 `empty` 档负责，
 *   不该在这里被重复判红（那是另一档的话）。
 * ⚠ 历史豁免（`clarify_legacy=pre-control`）照旧不参与。
 */
export function ledgerClosureProblems(units: readonly StageControlUnit[]): StageControlProblem[] {
  const ids = new Set(units.map((u) => txt(u.id)).filter((x) => x !== ''))
  const kindOf = new Map<string, string>()
  for (const u of units) {
    const id = txt(u.id)
    if (id !== '') kindOf.set(id, txt(u.kind))
  }
  const out: StageControlProblem[] = []
  for (const u of units) {
    if (legacy(u)) continue
    const id = txt(u.id) || '(unit)'
    const kind = txt(u.kind)
    if (kind === 'change') {
      const refs = changeRequirementIds(u)
      const real = refs.filter((x) => ids.has(x) && kindOf.get(x) === 'req')
      if (real.length === 0) {
        out.push({
          rule: 'L-1', unit: id,
          why: refs.length === 0
            ? '方案没有指向任何需求（req_ids / addresses / requirement_coverage 都空）⇒ 方案没有需求托底'
            : '方案指向的需求在账本里都不存在（' + refs.slice(0, 3).join(' / ') + '）⇒ 先落需求',
        })
      }
    }
    if (kind === 'task') {
      const parent = txt(u.parent)
      /**
       * ⚠ 历史兼容：控制上线前的 3 条任务允许直挂 `req`。
       *   与 `requirement-chain.ts` 的同一条兼容口径一致；新任务仍只许 `change`。
       */
      const historicalDirectReq = legacy(u) && kindOf.get(parent) === 'req'
      if (!historicalDirectReq && (parent === '' || kindOf.get(parent) !== 'change')) {
        out.push({
          rule: 'L-2', unit: id,
          why: parent === ''
            ? '任务没有父方案（parent 为空）⇒ 任务不知道从哪条方案来'
            : '任务的父方案 ' + parent + ' 在账本里不存在或不是 change ⇒ 先落方案',
        })
      }
    }
    if (kind === 'run') {
      const parent = txt(u.parent)
      if (parent === '' || kindOf.get(parent) !== 'task') {
        out.push({
          rule: 'L-3', unit: id,
          why: '执行记录的执行对象 ' + (parent || '(空)') + ' 在账本里不存在或不是 task',
        })
      }
    }
    if (kind === 'acc') {
      const parent = txt(u.parent)
      const parentUnit = units.find((x) => txt(x.id) === parent)
      const historicalTask = String(parentUnit?.kind ?? '') === 'task'
        && legacy(parentUnit as StageControlUnit)
      if (!historicalTask && (parent === '' || kindOf.get(parent) !== 'task')) {
        out.push({
          rule: 'L-4', unit: id,
          why: '验收对象的任务 ' + (parent || '(空)') + ' 在账本里不存在或不是 task',
        })
      }
    }
  }
  return out
}

/** Scope units: the root plus its upstream/downstream chain. */
export function gateScopeUnits(units: readonly StageControlUnit[], scope: GateScope): StageControlUnit[] {
  if (scope.kind === 'project') return []
  const id = txt(scope.id)
  if (id === '') return []
  const ids = new Set<string>([id])
  const add = (x: string | undefined): void => { if (txt(x) !== '') ids.add(txt(x)) }
  const root = units.find((u) => txt(u.id) === id)
  if (root !== undefined) {
    add(root.parent)
    /**
     * ⚠ 方案承接需求必须走**同一个关系读取函数**：
     *   只把 `addresses` 纳入作用域时，`CHG.req_ids = ["R-1"]` 的需求层
     *   不会被门禁检查 ⇒ 任务会带着没澄清的需求通过。
     */
    for (const r of [
      ...arr(root.req_ids),
      ...(root.kind === 'change'
        ? changeRequirementIds(root)
        : []),
      ...arr(root.addresses),
      ...arr(root.acceptance_ids),
      ...arr(root.verify_refs),
      ...arr(root.evidence_refs),
    ]) add(r)
    /**
     * ⚠⚠ **2026-11-08：沿 `parent` 一路向上爬到根**（用户报「新任务没走阶段流程」）。
     *
     *   ── 病（实测）────────────────────────────────────────────────────
     *     改前只把**第一层** `parent` 加进作用域。于是 `TSK-B → CHG-B → R-B` 这条链：
     *       `gateScopeUnits(units, { kind:'task', id:'TSK-B' })` ⇒ `['CHG-B','TSK-B']`
     *       **`R-B` 不在里面**。
     *     ⇒ 需求那一层的缺口（缺例子 / 缺验收条件）**根本不会被检查**，
     *       任务可以带着一个"没澄清清楚的需求"直接过闸 —— 这正是"没走阶段流程"。
     *
     *   ── 修法 ────────────────────────────────────────────────────────
     *     从根节点起沿 `parent` 逐级向上，直到没有父或父不在账本里。
     *     ⚠ 只走 `parent`（**唯一正式的层级边**）；`req_ids` 之类的横向引用
     *       仍按原来的规则加，⛔ 不在这里扩大语义。
     */
    let cursor: StageControlUnit | undefined = root
    const seen = new Set<string>([txt(root.id)])
    while (cursor !== undefined) {
      const up = txt(cursor.parent)
      if (up === '' || seen.has(up)) break
      seen.add(up)
      add(up)
      cursor = units.find((u) => txt(u.id) === up)
    }
  }
  let changed = true
  while (changed) {
    changed = false
    for (const u of units) {
      const uid = txt(u.id)
      if (uid === '') continue
      const linked = ids.has(txt(u.parent))
        || arr(u.req_ids).some((x) => ids.has(x))
        || arr(u.addresses).some((x) => ids.has(x))
        || (u.kind === 'change' && changeRequirementIds(u).some((x) => ids.has(x)))
        || arr(u.acceptance_ids).some((x) => ids.has(x))
        || arr(u.verify_refs).some((x) => ids.has(x))
      if (linked && !ids.has(uid)) { ids.add(uid); changed = true }
    }
  }
  /**
   * Approval decisions are facts about an artifact, not children of it. They
   * have `artifact_id` rather than `parent`, so the relation closure above
   * cannot discover them. Without this pass a correctly approved R/CHG pair
   * is present in the ledger but absent from the task-scoped subset; the gate
   * then reports "no user approval" and blocks every legitimate v3 dispatch.
   *
   * Pull in decisions for every artifact already in scope, then close once
   * more in case a decision's presence links another unit. Do not pull every
   * decision in the ledger: unrelated approvals must stay out of this chain.
   */
  let decisionsChanged = true
  while (decisionsChanged) {
    decisionsChanged = false
    for (const u of units) {
      const uid = txt(u.id)
      if (uid === '' || ids.has(uid) || txt(u.kind) !== 'decision') continue
      if (!ids.has(txt(u.artifact_id))) continue
      ids.add(uid)
      decisionsChanged = true
    }
    if (!decisionsChanged) break
    for (const u of units) {
      const uid = txt(u.id)
      if (uid === '' || ids.has(uid)) continue
      const linked = ids.has(txt(u.parent))
        || arr(u.req_ids).some((x) => ids.has(x))
        || arr(u.addresses).some((x) => ids.has(x))
        || (u.kind === 'change' && changeRequirementIds(u).some((x) => ids.has(x)))
        || arr(u.acceptance_ids).some((x) => ids.has(x))
        || arr(u.verify_refs).some((x) => ids.has(x))
      if (linked) { ids.add(uid); decisionsChanged = true }
    }
  }
  return units.filter((u) => ids.has(txt(u.id)))
}

/** Scoped gate: project only reports; repairs pass; forward needs a clean scope. */
export function evaluateGate(input: {
  action: GateAction
  scope: GateScope
  units: readonly StageControlUnit[]
}): GateDecision {
  const scopeText = input.scope.kind === 'project' ? 'project' : input.scope.kind + ':' + (txt(input.scope.id) || '(missing)')
  /**
   * ── **O-01：`write-repair` 不过门禁，但必须**显式说出来** ──────────────────
   *
   * ⚠ 修复写**必须能在账本不健康时进行** —— 否则「修坏账」永远做不了
   *   （死锁，与 O-43 / T-06b 同族：坏数据要靠写入来修，而写入被坏数据拦住）。
   *   ⇒ 行为保持「放行」，但**不再假装它过了门禁**：
   *     返回里带 `bypass: 'repair'`，调用方/日志能一眼看出「本次未判」。
   *
   * ⛔ 不要改成 `hold`：那会把修复通道一起堵死。
   * ⛔ 也不要删掉 `bypass`：删了就退回「没判」与「判过」长得一样。
   */
  if (input.action === 'write-repair') {
    return { decision: 'go', scope: scopeText, blockers: [], allowedRepairs: [], bypass: 'repair' }
  }
  if (input.scope.kind === 'project') {
    return { decision: 'go', scope: scopeText, blockers: stageControlProblems(input.units), allowedRepairs: [] }
  }
  /**
   * ⚠⚠ **2026-11-08：作用域门禁也要查闭环**（用户报「新任务没走阶段流程」）。
   *
   *   改前这里只跑 `stageControlProblems`（逐条字段），于是：
   *     · 一个字段齐全、但 `parent` 指向**不存在的方案**的任务 ⇒ `go`
   *       （实测：`{id:'TSK-X', parent:'CHG-MISSING', …}` ⇒ `go`）
   *   ⇒ "走没走阶段流程"这件事，字段门禁答不了：它只问"这一条填全了没有"。
   *
   *   ⚠ 闭环只判**这条作用域链内部**的引用是否闭合（`ledgerClosureProblems` 里
   *     按 id 查全账本，故这里传**全账本**、再用作用域 id 过滤），
   *     ⛔ 不把"别的需求缺字段"算到这一条头上（那正是 Wave 1 修掉的误伤）。
   */
  /**
   * ⚠⚠ **S-04：作用域根不存在 ⇒ hold，⛔ 不是 go。**
   *
   *   改前：`gateScopeUnits` 找不到 root ⇒ 返回空集 ⇒ `stageControlProblems([])` = []
   *   ⇒ `blockers=[]` ⇒ **`go`**。实测：
   *   `evaluateGate({scope:{kind:'task',id:'NOPE'}, units:[]})` ⇒ `{decision:'go'}`。
   *
   *   ⚠ 当时**已被调用方补掉**（`tools.ts` 的 `stageGateAtLedger` 先做存在性核对），
   *     所以不构成可利用漏洞；但 `evaluateGate` 本身仍是 **fail-open 的纯函数** ——
   *     **任何新调用方会直接踩中**，而且踩中时看到的是「通过」，不会去怀疑参数写错。
   *
   *   ⚠ 为什么用 `hold` 而不是 `return`：`return` 的语义是「有**可修**的阻塞」，
   *     其 `allowedRepairs` 会被拿去当可修单元；而「根不存在」**没有可修单元**，
   *     它是**调用方参数错**或**账本还没这条**，两者都不该被当成"修一修就能过"。
   *
   *   ⚠⚠ **占位号必须豁免**（2026-11-10 · 我第一版没做，真机当场 3 条红）：
   *     `hob_dispatch` 不给 `task` 时，编排器用 `taskId: 'implicit'` 占位
   *     （`orchestrator.ts` 的 `WP-implicit-…`）。它**不是真实 TSK** ——
   *     按"账本里没有 ⇒ hold"处理会把**所有没写 task 的老计划一起判死**。
   *     ⚠ 这与 `tools.ts:753-763` 记录的**是同一个坑**（那次也是真机当场红 `task:implicit`）。
   *     ⛔ 不要用"放宽成只要非空就放行"来绕 —— 那会把"说个东西直接就派活"也放过去。
   */
  const scopeIdText = txt(input.scope.id)
  const isPlaceholderScope = scopeIdText === 'implicit'
  const rootExists = isPlaceholderScope || input.units.some((u) => txt(u.id) === scopeIdText)
  if (!rootExists) {
    return {
      decision: 'hold',
      scope: scopeText,
      blockers: [{
        rule: 'S-04',
        unit: scopeIdText || '(missing)',
        why: `作用域根 ${scopeIdText || '(missing)'} 不在账本里 ⇒ 判不出可放行`
          + '（⛔ 不按"没有阻塞"放行：那是 fail-open）',
      }],
      allowedRepairs: [],
    }
  }
  const scopeUnits = gateScopeUnits(input.units, input.scope)
  const scopeIds = new Set(scopeUnits.map((u) => txt(u.id)))
  const blockers = [
    ...stageControlProblems(scopeUnits),
    ...ledgerClosureProblems(input.units).filter((p) => scopeIds.has(txt(p.unit))),
  ]
  return { decision: blockers.length === 0 ? 'go' : 'return', scope: scopeText, blockers, allowedRepairs: blockers.map((p) => p.unit) }
}

/** 按证据把阻塞归到最早失效阶段；环境问题返回 null。 */
export function returnStageOf(cause: BlockCause): StageId | null {
  return BLOCK_CAUSE_TO_STAGE[cause]
}

/** 该阶段是否允许进入下一步；空数组表示可推进。 */
export function gateProblemsAt(stage: StageId, units: readonly StageControlUnit[]): StageControlProblem[] {
  switch (stage) {
    case 'requirements': return units.flatMap(requirementProblems)
    case 'plan': return units.flatMap((u) => planProblems(u, units))
    /**
     * ⚠⚠ **R-17（2026-11-11）：这里原来用 `taskProblems`（弱判据），
     *   而 `:1064` 的 `stageFieldProblems` 用的是 `taskFullProblems`（含风险）。
     *   ⇒ **同一个账本，走两条路会得到不同结论** —— 那正是 T 组要治的「出口分裂」。
     *
     *   `taskFullProblems` = `taskProblems` + `taskRiskProblems`（见 `:582-584`），
     *   是**严格超集** ⇒ 改过来只会**多拦**、不会少拦（⛔ 不是放宽）。
     */
    case 'tasks': return units.flatMap(taskFullProblems)
    case 'execution': return units.flatMap(runProblems)
    case 'acceptance': return units.flatMap((u) => acceptanceProblems(u, units))
    case 'verification': return units.flatMap((u) => verificationProblems(u, units))
    case 'closure': return units.flatMap((u) => closureProblems(u, units))
  }
}

/** 只对账本区内的相对路径做存在性检查；外部 URL 不属于本地文件引用。 */
const isLocalRef = (ref: string): boolean =>
  !/^[a-z][a-z0-9+.-]*:\/\//i.test(ref) && !ref.startsWith('//')

/**
 * 文件型引用校验（纯函数）。
 * @param exists 由调用方注入；判不出时返回 false，并按 C-9/C-10 红。
 */
export function stageFileProblems(
  units: readonly StageControlUnit[],
  exists: (relPath: string) => boolean,
): StageControlProblem[] {
  const out: StageControlProblem[] = []
  for (const u of units) {
    const id = txt(u.id) || '(unit)'
    for (const ref of [...arr(u.clarify_sources), ...arr(u.research_refs)]) {
      if (isLocalRef(ref) && !exists(ref)) {
        out.push({ rule: 'C-10', unit: id, why: `研究引用不存在或判不出：${ref}` })
      }
    }
    const summary = txt(u.stage_summary)
    if (summary !== '' && isLocalRef(summary) && !exists(summary)) {
      out.push({ rule: 'C-9', unit: id, why: `阶段摘要引用不存在或判不出：${summary}` })
    }
    const brief = txt(u.task_brief)
    if (brief !== '' && isLocalRef(brief) && !exists(brief)) {
      out.push({ rule: 'C-9', unit: id, why: `任务书引用不存在或判不出：${brief}` })
    }
  }
  return out
}
