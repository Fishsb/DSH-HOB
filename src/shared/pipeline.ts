/**
 * Pipeline v3 contract and user-approval rules.
 *
 * Five stages stay unchanged:
 * requirements -> plan -> tasks -> execution -> acceptance.
 *
 * v3 separates three facts that the old ledger mixed together:
 *   - content exists;
 *   - content is complete;
 *   - the user approved this exact revision.
 *
 * Only a `decision` unit with `decision_kind=stage-approval` can prove the
 * third fact. Merely writing `req.status=agreed` or `change.status=settled`
 * is not an approval.
 *
 * This module is pure, synchronous and dependency-free so it can be used by
 * the host routes, write guard, orchestrator gate and client-side projections.
 */

export const PIPELINE_VERSION = 'v3'
/** Older enrolled pipelines remain readable, but cannot satisfy v3 gates. */
export const LEGACY_PIPELINE_VERSIONS = ['v2'] as const
export const APPROVAL_DECISION_KIND = 'stage-approval'

export const PIPELINE_ARTIFACT_KINDS = ['req', 'change', 'task', 'run', 'acc'] as const
export type PipelineArtifactKind = (typeof PIPELINE_ARTIFACT_KINDS)[number]

export const APPROVAL_STAGES = ['requirements', 'plan', 'acceptance', 'closure'] as const
export type ApprovalStage = (typeof APPROVAL_STAGES)[number]

export const APPROVAL_DECISIONS = ['approve', 'request-changes'] as const
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number]

export type ApprovalState =
  | 'legacy'
  | 'missing'
  | 'awaiting-user'
  | 'approved'
  | 'request-changes'
  | 'stale'
  | 'invalid'

/**
 * Pipeline v3 lifecycle. `closure` is a risk-gated delivery stage, not a
 * replacement for product acceptance: a chain may be product-accepted while
 * delivery remains closed.
 */
export const PIPELINE_STAGE_IDS = [
  'requirements', 'plan', 'tasks', 'execution', 'verification', 'acceptance', 'closure',
] as const
export type PipelineStageId = (typeof PIPELINE_STAGE_IDS)[number]

export interface PipelineUnit {
  id?: string
  kind?: string
  status?: string
  title?: string
  parent?: string
  pipeline_version?: string
  revision?: string
  task_revision?: string
  decisions?: string[]
  req_ids?: string[]
  addresses?: string[]
  requirement_coverage?: string[]
  path_options?: string[]
  decision_kind?: string
  approval_stage?: string
  artifact_id?: string
  artifact_revision?: string
  artifact_digest?: string
  decision?: string
  selected_option?: string
  decided_by?: string
  decided_at?: string
  source?: string
  [key: string]: unknown
}

export interface ApprovalReadout {
  state: ApprovalState
  /** Latest matching approval decision, if one exists. */
  approvalId?: string
  revision?: number
  selectedOption?: string
  decidedAt?: string
  reason: string
}

export interface PipelineWriteInput {
  id: string
  kind: string
  status: string
  pipeline_version?: string
  revision?: string
}

export interface PipelineWriteProblem {
  rule: string
  unit: string
  why: string
}

const text = (v: unknown): string => typeof v === 'string' ? v.trim() : ''
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).map((x) => x.trim()).filter((x) => x !== '') : []

/** True only for units explicitly enrolled in the current Pipeline version. */
export function isPipelineV3(unit: Record<string, unknown>): boolean {
  return text(unit.pipeline_version) === PIPELINE_VERSION
}

/**
 * ── **R-13：当前方案必须按「业务状态 + revision」选，⛔ 不按物理顺序** ────────────
 *
 * 改前两处各写一套：
 *   · `stage-controls.ts` 的 `closureProblems`：`plans.at(-1)` ⇒ 结论随**文件里的位置**翻转
 *   · `pipeline-view.ts` 的 `currentPlanOf`：先过滤 superseded 再 `at(-1)`
 * ⇒ 同一份账本，两种物理顺序 ⇒ G6 档位可能不同。⚠ 方向是 **fail-open**（该拦的没拦），
 *   而迁移会移动单元位置 ⇒ **迁移前后结论翻转**。
 *
 * 判据（REVIEW R-13 规格逐条）：
 *   ① `status ∈ {agreed, settled}` 优先（那是「已定」的两个状态）；
 *   ② 同级按 `revision` 最大；
 *   ③ 再按 `created_at`（`revision` 缺失时兜底）；
 *   ④ **全无则返回 `undefined`** —— ⛔ 不回落 `at(-1)`，那正是本条要消灭的行为。
 *
 * ⚠ 纯函数、零 import server 侧 ⇒ 客户端与服务端可用同一份。
 */
export const CLOSED_PLAN_STATUSES = ['agreed', 'settled'] as const

/** 从同一条需求下的全部 change 里选出「当前方案」；判不出时返回 undefined（⛔ 不猜）。 */
export function currentPlanOfStrict(
  reqId: string,
  units: readonly Record<string, unknown>[],
): Record<string, unknown> | undefined {
  const rid = text(reqId)
  if (rid === '') return undefined
  const candidates = units.filter((u) => text(u.kind) === 'change'
    && (Array.isArray(u.req_ids) ? u.req_ids.map(String) : []).includes(rid))
  if (candidates.length === 0) return undefined
  /**
   * ① 已定的优先；若一个都没有 ⇒ 退到「未定但仍是当前候选」的状态。
   *
   * ⚠ **为什么不能直接返回 undefined**（2026-11-11 实测踩过）：
   *   草稿阶段的方案 `status = 'proposed'`，面板要显示「归 Hob」而不是「等用户确认」
   *   （`PIPE-14` 钉着这条）。若这里判不出 ⇒ `currentPlanOf` 返回 undefined ⇒
   *   面板把草稿显示成用户闸门 ⇒ 行为回退。
   *   ⇒ 已定（agreed/settled）**优先**，没有时用其余非 superseded 的候选。
   *   ⛔ 但仍然**不按物理顺序** —— 排序键是 revision/created_at。
   */
  const closed = candidates.filter((u) => (CLOSED_PLAN_STATUSES as readonly string[]).includes(text(u.status)))
  const pool = closed.length > 0
    ? closed
    : candidates.filter((u) => !['superseded'].includes(text(u.status)))
  if (pool.length === 0) return undefined
  /** ② revision 最大；③ 再按 created_at。⚠ 排序键都缺失时保持稳定（不依赖输入顺序）。 */
  const sorted = [...pool].sort((a, b) => {
    const ra = revisionOf(a) ?? -1
    const rb = revisionOf(b) ?? -1
    if (ra !== rb) return rb - ra
    return text(b.created_at).localeCompare(text(a.created_at))
  })
  return sorted[0]
}

/** Compatibility name retained for existing call sites. */
export function isPipelineV2(unit: Record<string, unknown>): boolean {
  return isPipelineV3(unit)
}

export function isLegacyPipeline(unit: Record<string, unknown>): boolean {
  const version = text(unit.pipeline_version)
  return version === '' || (LEGACY_PIPELINE_VERSIONS as readonly string[]).includes(version)
}

/** Positive integer revision, or undefined when absent/invalid. */
export function revisionOf(unit: Record<string, unknown>): number | undefined {
  const raw = text(unit.revision)
  if (!/^\d+$/.test(raw)) return undefined
  const n = Number(raw)
  return Number.isSafeInteger(n) && n > 0 ? n : undefined
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') return value
  return undefined
}

/**
 * Fields that define the approved artifact revision.
 *
 * Relations are included deliberately: moving a plan to another requirement or
 * a task to another plan changes the meaning of the approval.
 */
const ARTIFACT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  req: [
    'title', 'spec', 'acceptance_criteria', 'clarify_examples', 'clarify_questions',
    'clarify_assumptions', 'clarify_sources',
  ],
  change: [
    'title', 'proposal', 'path_options', 'path_tradeoffs', 'path_decision',
    'requirement_coverage', 'req_ids', 'addresses', 'risk_tier', 'risk_rule_version',
    'risk_hard_triggers', 'risk_hard_trigger_facts', 'risk_dimensions', 'risk_inputs_digest', 'risk_assessed_at',
    'risk_assessed_by', 'risk_assessment_ref', 'risk_binding_digest', 'risk_binding_version',
    'delivery_scope', 'closure_mode', 'reviewer', 'review_refs', 'risk_ids',
  ],
  task: [
    'title', 'parent', 'task_brief', 'counterexamples', 'stop_conditions', 'return_to', 'scope_paths',
    'depends_on', 'test_plan', 'acceptance_criteria_refs', 'reviewer', 'review_refs',
    'task_risk', 'risk_reasons', 'requires_isolation', 'requires_review',
    'requires_serial_execution', 'touched_surfaces', 'irreversible_actions', 'rollback_refs',
  ],
  run: ['title', 'parent', 'progress_refs', 'delivered_at', 'report'],
  acc: [
    'title', 'parent', 'product_confirmation', 'verification_refs', 'example_results',
    'send_back_to', 'release_ready', 'liens', 'release_refs', 'validation_refs',
    'residual_risks', 'risk_residual_tier', 'risk_accepted_by', 'risk_accepted_at',
    'risk_accept_conditions', 'verification_id', 'risk_review_refs', 'verification_session',
    'risk_residual_impact', 'risk_residual_monitoring',
    /**
     * Acceptance binds the task revision it judged. A later task revision makes
     * the old acceptance visibly stale instead of silently closing it.
     */
    'task_revision',
  ],
}

/**
 * Canonical text for one artifact revision.
 *
 * Keys are sorted so JSON insertion order cannot change the digest.
 */
export function artifactCanonicalText(unit: Record<string, unknown>): string {
  const kind = text(unit.kind)
  const fields = ARTIFACT_FIELDS[kind] ?? []
  const body: Record<string, unknown> = {
    id: text(unit.id),
    kind,
    revision: revisionOf(unit) ?? text(unit.revision),
  }
  for (const key of [...fields].sort()) {
    const value = canonicalValue(unit[key])
    if (value === undefined) continue
    if (Array.isArray(value) && value.length === 0) continue
    if (typeof value === 'string' && value === '') continue
    body[key] = value
  }
  return JSON.stringify(body)
}

/**
 * Compact deterministic digest for approval binding.
 *
 * This is an integrity fingerprint, not a password hash. The approval writer
 * can additionally store a SHA-256 in the source evidence; gate correctness
 * only relies on this deterministic comparison.
 */
/**
 * ⚠ **O-38：导出供「无显式 id 的验收条件」生成内容身份。**
 *   ⛔ 不要在别处另写一份哈希 —— 同一份内容必须得到同一个 id，两处各写一份迟早不同。
 */
export function digestPair(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let h1 = 0x811c9dc5
  let h2 = 0x9e3779b9
  for (const b of bytes) {
    h1 ^= b
    h1 = Math.imul(h1, 0x01000193) >>> 0
    h2 ^= (b + 0x9d) & 0xff
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0
    h2 = (h2 ^ (h2 >>> 13)) >>> 0
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`
}

export function artifactDigestOf(unit: Record<string, unknown>): string {
  return `fnv64:${digestPair(artifactCanonicalText(unit))}`
}

/**
 * Digest of the plan facts that determine risk, excluding the risk assessment
 * itself. A risk assessment is stale when any of these facts changes, even if
 * the author forgot to update `risk_inputs_digest`.
 */
export function riskBindingDigestOf(
  unit: Record<string, unknown>,
  relatedRequirements: readonly Record<string, unknown>[] = [],
): string {
  const fields = [
    'title', 'proposal', 'path_options', 'path_tradeoffs', 'path_decision',
    'requirement_coverage', 'req_ids', 'addresses', 'delivery_scope',
  ]
  const body: Record<string, unknown> = { id: text(unit.id), kind: text(unit.kind) }
  for (const key of fields) {
    const value = canonicalValue(unit[key])
    if (value === undefined) continue
    if (Array.isArray(value) && value.length === 0) continue
    if (typeof value === 'string' && value === '') continue
    body[key] = value
  }
  /**
   * Acceptance facts live on the requirements this plan addresses, not on the
   * plan itself. Binding them here means a changed criterion or a different
   * acceptance object invalidates the old risk assessment instead of letting
   * it describe a target that no longer exists.
   */
  const requirementIds = new Set(list(body.req_ids).concat(list(body.addresses)))
  for (const line of list(body.requirement_coverage)) {
    const id = /^([A-Z]+-[A-Za-z0-9-]+)/.exec(line)?.[1]
    if (id !== undefined) requirementIds.add(id)
  }
  const acceptance = relatedRequirements
    .filter((r) => text(r.kind) === 'req' && requirementIds.has(text(r.id)))
    .map((r) => ({
      id: text(r.id),
      revision: text(r.revision),
      acceptance_ids: list(r.acceptance_ids),
      acceptance_criteria: list(r.acceptance_criteria),
      clarify_examples: list(r.clarify_examples),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
  if (acceptance.length > 0) body.related_requirements = acceptance
  return `fnv64:${digestPair(JSON.stringify(body))}`
}

/** Approval decisions that name one artifact, oldest first. */
export function approvalDecisionsOf(
  units: readonly Record<string, unknown>[],
  artifactId: string,
): Record<string, unknown>[] {
  const id = text(artifactId)
  if (id === '') return []
  return units
    .filter((u) => text(u.kind) === 'decision'
      && text(u.decision_kind) === APPROVAL_DECISION_KIND
      && text(u.artifact_id) === id)
    .sort((a, b) => {
      const ta = text(a.decided_at)
      const tb = text(b.decided_at)
      if (ta !== tb) return ta < tb ? -1 : 1
      return text(a.id).localeCompare(text(b.id))
    })
}

/** Latest approval decision for one artifact. */
export function latestApprovalOf(
  units: readonly Record<string, unknown>[],
  artifactId: string,
): Record<string, unknown> | undefined {
  return approvalDecisionsOf(units, artifactId).at(-1)
}

/** Whether a selected plan option is one of the current candidate paths. */
export function selectedOptionValid(artifact: Record<string, unknown>, option: string): boolean {
  return text(artifact.kind) !== 'change' || (
    text(option) !== '' && list(artifact.path_options).includes(text(option))
  )
}

/**
 * Evaluate one artifact's user approval against its current revision.
 */
export function approvalStateOf(
  artifact: Record<string, unknown>,
  units: readonly Record<string, unknown>[],
): ApprovalReadout {
  if (!isPipelineV3(artifact)) {
    return { state: 'legacy', reason: '条目属于旧管线，没有 v3 用户批准记录' }
  }
  const revision = revisionOf(artifact)
  if (revision === undefined) {
    return { state: 'invalid', reason: 'v3 条目缺正整数 revision，无法绑定批准版本' }
  }
  /**
   * `draft` / `proposed` means the author is still writing the artifact.
   * Approval would be premature; it is neither "waiting for user" nor an
   * invalid approval record.
   */
  if (['draft', 'proposed'].includes(text(artifact.status))) {
    return {
      state: 'awaiting-user',
      revision,
      reason: `内容还在起草（${text(artifact.status)}），应先写完当前版本再请求用户确认`,
    }
  }
  const latest = latestApprovalOf(units, text(artifact.id))
  if (latest === undefined) {
    return { state: 'missing', revision, reason: '还没有用户批准记录' }
  }
  const approvalId = text(latest.id) || undefined
  if (text(latest.status) !== 'active') {
    return { state: 'invalid', approvalId, revision, reason: '最新批准记录不是 active' }
  }
  const decision = text(latest.decision)
  if (!(APPROVAL_DECISIONS as readonly string[]).includes(decision)) {
    return { state: 'invalid', approvalId, revision, reason: `最新批准决定不在封闭集：${decision || '(空)'}` }
  }
  if (decision === 'request-changes') {
    return {
      state: 'request-changes',
      approvalId,
      revision,
      decidedAt: text(latest.decided_at) || undefined,
      reason: '用户要求修改当前版本',
    }
  }
  if (text(latest.decided_by) !== 'user') {
    return { state: 'invalid', approvalId, revision, reason: '批准者不是 user，禁止 Hob 自批' }
  }
  const approvedRevision = Number(text(latest.artifact_revision))
  if (!Number.isSafeInteger(approvedRevision) || approvedRevision !== revision) {
    return {
      state: 'stale',
      approvalId,
      revision,
      decidedAt: text(latest.decided_at) || undefined,
      reason: `批准绑定第 ${text(latest.artifact_revision) || '?'} 版，当前是第 ${revision} 版`,
    }
  }
  const digest = artifactDigestOf(artifact)
  if (text(latest.artifact_digest) !== digest) {
    return {
      state: 'stale',
      approvalId,
      revision,
      decidedAt: text(latest.decided_at) || undefined,
      reason: '批准后内容发生了变化，旧批准已失效',
    }
  }
  const selected = text(latest.selected_option)
  if (!selectedOptionValid(artifact, selected)) {
    return {
      state: 'invalid',
      approvalId,
      revision,
      decidedAt: text(latest.decided_at) || undefined,
      reason: text(artifact.kind) === 'change'
        ? `批准选中的路径 ${selected || '(空)'} 不在当前 path_options 中`
        : '方案批准的选中路径无效',
    }
  }
  return {
    state: 'approved',
    approvalId,
    revision,
    ...(selected === '' ? {} : { selectedOption: selected }),
    decidedAt: text(latest.decided_at) || undefined,
    reason: '用户已批准当前修订',
  }
}

/** Expected user receipt for approving one artifact revision. */
export function approvalReceiptPattern(artifact: Record<string, unknown>): RegExp {
  const id = text(artifact.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const revision = revisionOf(artifact) ?? 0
  const label = text(artifact.kind) === 'req' ? '需求' : '方案'
  return new RegExp(`确认${label}\\s+${id}\\s+第\\s*${revision}\\s*版`)
}

/** Expected user receipt for requesting a revision. */
export function requestChangesReceiptPattern(artifact: Record<string, unknown>): RegExp {
  const id = text(artifact.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const label = text(artifact.kind) === 'req' ? '需求' : '方案'
  return new RegExp(`(?:要求修改|退回修改)${label}\\s+${id}`)
}

/**
 * **R-15：用户回执判据的唯一实现。**
 *
 * ⚠ 历史上本仓有**两份**回执正则：
 *   - 本文件的 {@link approvalReceiptPattern} / {@link requestChangesReceiptPattern}（纯函数，`\s+` 严格）；
 *   - `src/modules/tools.ts` 里内联的一份（`\s*` 全宽松，且把「确认 / 要求修改 / 退回修改」合成一条）。
 * 两份**不等价**：宽松版会接受「确认需求R-1第3版」（无空格），严格版不会。
 *
 * ⇒ 现在合并成一处：工具侧调本函数，自检侧也调本函数。
 * ⛔ 不要再在调用点内联写回执正则——那正是这次分叉的成因。
 *
 * @param opts.acceptRevisionRequest 为 true 时同时接受「要求修改 / 退回修改」的措辞
 *   （用于 `hob_ledger_approve`：它在同一入口处理批准与退回）。
 */
export function receiptPatternOf(
  artifact: Record<string, unknown>,
  opts: { acceptRevisionRequest?: boolean } = {},
): RegExp {
  const id = text(artifact.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  /**
   * ⚠ 不用 `revisionOf(artifact)`：那个函数只认 **字符串** `revision`（账本 TOML 的原始形态），
   * 传数字会静默返回 `undefined` ⇒ `?? 0` ⇒ 回执正则要求「第 0 版」⇒ **永远匹配不到**。
   * 这里显式接受 string | number，⛔ 不要改回 `revisionOf`。
   */
  const rawRevision = typeof artifact.revision === 'number'
    ? artifact.revision
    : Number(text(artifact.revision))
  const revision = Number.isSafeInteger(rawRevision) && rawRevision > 0 ? rawRevision : 0
  /**
   * ⚠ 宽松模式（`acceptRevisionRequest`）的 label 用 `(?:需求|方案)?`，
   * 但浏览器正则的回溯会**优先匹配空串**，于是「要求修改需求 R-P5B」里的「需求」留在原地、`\s*` 匹配不到
   * ⇒ 必须让 label **优先匹配非空**：`(?:(?:需求|方案)\s*)?`。⛔ 不要把 `\s*` 挪到外边。
   */
  /**
   * ⚠ 宽松模式下 label 必须**优先非空**：写成 `(?:需求|方案)?` 时，
   * 正则回溯会先试空串，于是「要求修改需求 R-P5B」中的「需求」留在原地、后面的 `\s*` 也匹配不到
   * ⇒ **永远不匹配**。这里用两条并列分支（带 label / 不带 label）替代一个可选分组。
   */
  const verb = opts.acceptRevisionRequest === true
    ? '(?:确认|要求修改|退回修改)'
    : '确认'
  if (opts.acceptRevisionRequest === true) {
    return new RegExp(
      `${verb}\\s*(?:需求|方案)\\s*${id}\\s*第\\s*${revision}\\s*版`
      + `|${verb}\\s*${id}\\s*第\\s*${revision}\\s*版`,
    )
  }
  const label = text(artifact.kind) === 'req' ? '需求' : '方案'
  /**
   * ⚠ 这里用 `\s*` 而非纯函数版的 `\s+`：**是为了保持现网行为不变**。
   * 收严会让已经能通过的回执突然被拒——那是行为回归，不是本条的修复目标。
   * 若将来要收严，**必须先量**：`grep -c '确认需求' <真实账本>` 看有多少存量回执依赖宽松匹配。
   */
  return new RegExp(`${verb}\\s*${label}\\s*${id}\\s*第\\s*${revision}\\s*版`)
}

/**
 * Validate the shape of one approval decision unit.
 */
export function approvalDecisionProblems(unit: Record<string, unknown>): Array<{ rule: string; unit: string; why: string }> {
  if (text(unit.kind) !== 'decision' || text(unit.decision_kind) !== APPROVAL_DECISION_KIND) return []
  const id = text(unit.id) || '(decision)'
  const out: Array<{ rule: string; unit: string; why: string }> = []
  const artifact = text(unit.artifact_id)
  const stage = text(unit.approval_stage)
  const revision = text(unit.artifact_revision)
  const decision = text(unit.decision)
  const by = text(unit.decided_by)
  const at = text(unit.decided_at)
  if (artifact === '') out.push({ rule: 'C-22', unit: id, why: '阶段批准缺 artifact_id' })
  if (!(APPROVAL_STAGES as readonly string[]).includes(stage)) {
    out.push({ rule: 'C-22', unit: id, why: `approval_stage 不在封闭集：${stage || '(空)'}` })
  }
  if (!/^\d+$/.test(revision) || Number(revision) <= 0) {
    out.push({ rule: 'C-22', unit: id, why: 'artifact_revision 必须是正整数' })
  }
  if (text(unit.artifact_digest) === '') out.push({ rule: 'C-22', unit: id, why: '缺 artifact_digest' })
  if (!(APPROVAL_DECISIONS as readonly string[]).includes(decision)) {
    out.push({ rule: 'C-22', unit: id, why: `decision 不在封闭集：${decision || '(空)'}` })
  }
  if (by !== 'user') out.push({ rule: 'C-22', unit: id, why: 'decided_by 必须是 user（Hob 不能自批）' })
  if (at === '' || !Number.isFinite(Date.parse(at))) {
    out.push({ rule: 'C-22', unit: id, why: 'decided_at 必须是可解析时刻' })
  }
  if (text(unit.source) === '') out.push({ rule: 'C-22', unit: id, why: '缺用户回执原文 source' })
  if (decision === 'approve' && stage === 'plan' && text(unit.selected_option) === '') {
    out.push({ rule: 'C-22', unit: id, why: '方案批准必须记录 selected_option' })
  }
  return out
}

/**
 * Downstream revision binding.
 *
 * A RUN belongs to one task revision; an ACC belongs to the task revision it
 * judged. When the lineage has moved, the old fact remains historical evidence
 * but must not satisfy the current pipeline.
 */
export function pipelineRevisionProblems(
  units: readonly Record<string, unknown>[],
): PipelineGateProblem[] {
  const out: PipelineGateProblem[] = []
  const byId = new Map(units.map((u) => [text(u.id), u]))
  for (const u of units) {
    const kind = text(u.kind)
    const parent = byId.get(text(u.parent))
    if ((kind !== 'run' && kind !== 'acc') || parent === undefined || text(parent.kind) !== 'task') continue
    if (!isPipelineV3(u) && !isPipelineV3(parent)) continue
    const taskRevision = revisionOf(parent)
    const bound = text(u.task_revision)
    if (taskRevision === undefined) {
      out.push({ rule: 'C-24', unit: text(u.id) || `(${kind})`, why: `父任务 ${text(parent.id)} 缺正整数 revision，无法判断${kind === 'run' ? '执行' : '验收'}是否对应当前版本` })
      continue
    }
    if (bound === '') {
      out.push({ rule: 'C-24', unit: text(u.id) || `(${kind})`, why: `缺 task_revision，无法证明它对应 ${text(parent.id)} 第 ${taskRevision} 版` })
    } else if (!/^\d+$/.test(bound) || Number(bound) <= 0) {
      out.push({ rule: 'C-24', unit: text(u.id) || `(${kind})`, why: `task_revision 必须是正整数：${bound}` })
    } else if (Number(bound) !== taskRevision) {
      out.push({ rule: 'C-24', unit: text(u.id) || `(${kind})`, why: `绑定任务第 ${bound} 版，当前任务已是第 ${taskRevision} 版 ⇒ 旧记录失效` })
    }
  }
  return out
}

/**
 * Verification binds the implementation revision it judged, just as RUN/ACC
 * bind their task revision. A later task revision invalidates an old VER.
 */
export function verificationRevisionProblems(
  units: readonly Record<string, unknown>[],
): PipelineGateProblem[] {
  const out: PipelineGateProblem[] = []
  const byId = new Map(units.map((u) => [text(u.id), u]))
  for (const v of units) {
    if (text(v.kind) !== 'verification') continue
    const task = byId.get(text(v.parent))
    if (task === undefined || text(task.kind) !== 'task') continue
    if (!isPipelineV3(v) && !isPipelineV3(task)) continue
    const taskRevision = revisionOf(task)
    const bound = text(v.task_revision)
    if (taskRevision === undefined) {
      out.push({ rule: 'C-25', unit: text(v.id) || '(verification)', why: `父任务 ${text(task.id)} 缺正整数 revision，无法判断验证是否对应当前版本` })
    } else if (bound === '') {
      out.push({ rule: 'C-25', unit: text(v.id) || '(verification)', why: `缺 task_revision，无法证明它对应 ${text(task.id)} 第 ${taskRevision} 版` })
    } else if (!/^\d+$/.test(bound) || Number(bound) <= 0) {
      out.push({ rule: 'C-25', unit: text(v.id) || '(verification)', why: `task_revision 必须是正整数：${bound}` })
    } else if (Number(bound) !== taskRevision) {
      out.push({ rule: 'C-25', unit: text(v.id) || '(verification)', why: `绑定任务第 ${bound} 版，当前任务已是第 ${taskRevision} 版 ⇒ 旧验证失效` })
    }
  }
  return out
}

export interface PipelineGateProblem {
  rule: string
  unit: string
  why: string
}

/**
 * Validate Pipeline v3 writes before they reach the ledger.
 *
 * New artifacts must carry a v3 marker and a positive revision. Once an
 * artifact has approval decisions, changing its approved fields requires a new
 * revision. This makes stale approvals visible instead of silently reusing them.
 */
export function pipelineWriteProblems(
  before: readonly Record<string, unknown>[],
  after: readonly Record<string, unknown>[],
): PipelineWriteProblem[] {
  const beforeById = new Map(before.map((u) => [text(u.id), u]))
  const out: PipelineWriteProblem[] = []
  for (const unit of after) {
    const id = text(unit.id)
    const kind = text(unit.kind)
    if (!(PIPELINE_ARTIFACT_KINDS as readonly string[]).includes(kind)) continue
    const old = beforeById.get(id)
    if (old === undefined && !isPipelineV3(unit)) {
      out.push({ rule: 'C-23', unit: id, why: `新 ${kind} 必须登记 pipeline_version="${PIPELINE_VERSION}"` })
      continue
    }
    if (old === undefined && revisionOf(unit) === undefined) {
      out.push({ rule: 'C-23', unit: id, why: `新 ${kind} 必须有正整数 revision` })
      continue
    }
    if (!isPipelineV3(unit)) continue
    const revision = revisionOf(unit)
    if (revision === undefined) {
      out.push({ rule: 'C-23', unit: id, why: 'v3 条目必须有正整数 revision' })
      continue
    }
    const oldRevision = old === undefined ? undefined : revisionOf(old)
    if (oldRevision !== undefined && revision < oldRevision) {
      out.push({ rule: 'C-23', unit: id, why: `revision 不能倒退：${oldRevision} → ${revision}` })
    }
    if (old !== undefined && artifactDigestOf(old) !== artifactDigestOf(unit)) {
      const decisions = approvalDecisionsOf(after, id)
      const maxApprovedRevision = decisions.reduce((max, d) => {
        const n = Number(text(d.artifact_revision))
        return Number.isSafeInteger(n) && n > max ? n : max
      }, 0)
      /**
       * ── **R-12：与「是否有 decision」解耦** ──────────────────────────────
       * 改前条件是 `decisions.length > 0 && revision <= maxApprovedRevision`：
       * 把强制范围限定在「**已经有过批准**」的条目上 ⇒ **首次批准前**的每一次内容改写
       * 都不需要递增 revision，digest 随之漂移，而账本里没有任何记录能证明
       * 「用户当时批准的是哪一版内容」。
       *
       * ⇒ 现在的判据：**内容（digest）变了 ⇒ revision 必须递增**，与 decision 无关。
       *   ⚠ 有 decision 时额外要求「不低于已批准的最高版」（保留原语义）。
       */
      /**
       * ⚠ **只约束「需要用户批准的产物」**：`req` / `change`。
       *
       *   实测教训（2026-11-11）：第一版把它套到**全部** artifact kind 上，
       *   于是投影层给 RUN 写 `progress_refs`（正常运行时进度）也被判 C-23，
       *   `check:ledger-projection` 的 LP-8 当场红。
       *
       *   ⚠ 改前的 `decisions.length > 0` 其实**无意中**挡掉了这些 ——
       *     RUN/ACC 没有 decision，所以从来不会被拦。R-12 要解耦的是
       *     「首次批准前的 req/change 内容改写」，⛔ 不是运行时投影。
       */
      const needsApproval = APPROVAL_STAGES.length > 0 && (kind === 'req' || kind === 'change')
      const mustBump = !needsApproval
        ? false
        : decisions.length > 0
          ? revision <= maxApprovedRevision
          : revision <= (oldRevision ?? 0)
      if (mustBump) {
        out.push({
          rule: 'C-23',
          unit: id,
          why: decisions.length > 0
            ? `内容已变但 revision 未递增（已有决定最高第 ${maxApprovedRevision} 版，当前第 ${revision} 版）`
            : `内容已变但 revision 未递增（原文第 ${oldRevision ?? '?'} 版，当前第 ${revision} 版；⚠ 首次批准前也不许原地改内容）`,
        })
      }
    }
  }
  for (const unit of after) out.push(...approvalDecisionProblems(unit))
  /**
   * New RUN/ACC must name the task revision they belong to; freshly-created
   * runtime projections receive this from the projection layer.
   */
  for (const unit of after) {
    const kind = text(unit.kind)
    if (kind !== 'run' && kind !== 'acc') continue
    const id = text(unit.id)
    if (beforeById.has(id)) continue
    if (text(unit.task_revision) === '') {
      out.push({ rule: 'C-24', unit: id, why: `新 ${kind} 必须写 task_revision，绑定所执行/验收的任务修订` })
    }
  }
  return out
}
