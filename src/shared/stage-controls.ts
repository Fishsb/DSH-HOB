/**
 * 五阶段内部控制 —— 需求澄清、方案路径、任务自包含、阻塞回流。
 *
 * 纯函数、零 I/O：账本检查、生成视图和运行态共用同一套判定。
 * 不新增第六阶段；五步仍是唯一生命周期。
 */

export const STAGE_IDS = ['requirements', 'plan', 'tasks', 'execution', 'acceptance'] as const
export type StageId = (typeof STAGE_IDS)[number]

export const STAGE_NAMES: Readonly<Record<StageId, string>> = {
  requirements: '需求规格',
  plan: '实现方案',
  tasks: '编码任务',
  execution: '任务执行',
  acceptance: '验收核对',
}

/** 阻塞归因；环境问题单独一档，不误判成需求错误。 */
export const BLOCK_CAUSES = ['requirement', 'plan', 'task', 'implementation', 'environment'] as const
export type BlockCause = (typeof BLOCK_CAUSES)[number]

export const BLOCK_CAUSE_TO_STAGE: Readonly<Record<BlockCause, StageId | null>> = {
  requirement: 'requirements',
  plan: 'plan',
  task: 'tasks',
  implementation: 'execution',
  environment: null,
}

export const ASSUMPTION_STATES = ['pending', 'confirmed', 'rejected'] as const
export type AssumptionState = (typeof ASSUMPTION_STATES)[number]

/** 退回目标封闭集：与账本 acc.send_back_to 的 B-1 口径同源，⛔ 不收自由文本。 */
export const STAGE_RETURN_TARGETS = ['back-to-requirement', 'back-to-plan', 'back-to-task'] as const
export type StageReturnTarget = (typeof STAGE_RETURN_TARGETS)[number]

export interface StageControlUnit {
  id?: string
  kind?: string
  status?: string
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
}

export interface StageControlProblem {
  rule: string
  unit: string
  why: string
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

/** 历史需求豁免：只用于控制上线前的存量，⛔ 不是新需求的放行开关。 */
const legacy = (u: StageControlUnit): boolean => txt(u.clarify_legacy) === 'pre-control'

/** 新单元不得借用历史豁免；`created_at` 缺省时按“不可证明是历史”处理。 */
const CONTROL_CUTOFF = '2026-11-06'
export function legacyMisuse(u: StageControlUnit): StageControlProblem[] {
  if (txt(u.clarify_legacy) !== 'pre-control') return []
  const created = txt(u.created_at)
  // 历史存量通常没有 created_at；只有显式写了控制上线日或之后的创建时间才算滥用。
  if (created !== '' && created.slice(0, 10) >= CONTROL_CUTOFF) {
    return [{ rule: 'C-11', unit: txt(u.id) || '(unit)', why: '历史豁免只能用于控制上线前的存量；新单元不得写 clarify_legacy = pre-control' }]
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

/** 方案门禁：settled 前必须给出路径比较、取舍、推荐、需求覆盖。 */
export function planProblems(u: StageControlUnit): StageControlProblem[] {
  if (u.kind !== 'change' || txt(u.status) !== 'settled' || legacy(u)) return []
  const out: StageControlProblem[] = []
  const id = txt(u.id) || '(change)'
  if (arr(u.path_options).length === 0) out.push({ rule: 'C-4', unit: id, why: '没有候选路径（path_options 为空）' })
  if (arr(u.path_tradeoffs).length === 0) out.push({ rule: 'C-4', unit: id, why: '没有路径取舍（path_tradeoffs 为空）' })
  if (txt(u.path_decision) === '') out.push({ rule: 'C-4', unit: id, why: '没有推荐路径与理由（path_decision 为空）' })
  if (arr(u.requirement_coverage).length === 0) out.push({ rule: 'C-3', unit: id, why: '没有需求到方案的映射（requirement_coverage 为空）' })
  return out
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
  return out
}

/** 验收门禁：pass 前必须有产品确认字段；退回必须有目标阶段。 */
export function acceptanceProblems(u: StageControlUnit): StageControlProblem[] {
  if (u.kind !== 'acc') return []
  if (legacy(u)) return []
  const out: StageControlProblem[] = []
  const id = txt(u.id) || '(acc)'
  if (txt(u.status) === 'pass' && txt(u.product_confirmation) === '') {
    out.push({ rule: 'C-7', unit: id, why: '验收通过但缺产品确认（product_confirmation）' })
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

/** 全部阶段控制问题。 */
export function stageControlProblems(units: readonly StageControlUnit[]): StageControlProblem[] {
  return units.flatMap((u) => [
    ...requirementProblems(u),
    ...planProblems(u),
    ...taskProblems(u),
    ...runProblems(u),
    ...acceptanceProblems(u),
    ...legacyMisuse(u),
  ])
}

/** 按证据把阻塞归到最早失效阶段；环境问题返回 null。 */
export function returnStageOf(cause: BlockCause): StageId | null {
  return BLOCK_CAUSE_TO_STAGE[cause]
}

/** 该阶段是否允许进入下一步；空数组表示可推进。 */
export function gateProblemsAt(stage: StageId, units: readonly StageControlUnit[]): StageControlProblem[] {
  switch (stage) {
    case 'requirements': return units.flatMap(requirementProblems)
    case 'plan': return units.flatMap(planProblems)
    case 'tasks': return units.flatMap(taskProblems)
    case 'execution': return units.flatMap(runProblems)
    case 'acceptance': return units.flatMap(acceptanceProblems)
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
