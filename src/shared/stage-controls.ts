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

/**
 * **五步的完成语义（唯一真源）** —— 2026-11-08 · 用户裁定「阶段语义收口」。
 *
 * ⚠⚠ 这不是又一张状态表；它是**每一步"什么算完成"的口径**。改前第 3 步与
 *   第 4 步都拿 `task.status = built` 当完成信号，于是：
 *     · 任务书刚建好、还没执行时，第 3 步仍是 `todo`；
 *     · 真正执行期间，当前步仍显示「编码任务」；
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
    definition: '需求已定稿，且澄清问题、假设、关键例子、可观察验收条件齐全',
    judgedBy: 'R.status=agreed + C-1/C-2',
  },
  plan: {
    definition: '方案已定，且候选路径、取舍、推荐、需求映射齐全；高风险有独立评审',
    judgedBy: 'CHG.status=settled + C-3/C-4/C-15',
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
    definition: '独立验收已判决：有有效 ACC，且独立会话、产品确认、技术证据、例子结果齐全',
    judgedBy: 'ACC.status=pass/send-back + C-7/C-12/C-13/C-14',
  },
}

export interface StageControlUnit {
  id?: string
  kind?: string
  status?: string
  parent?: string
  title?: string
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
  reviewer?: string
  review_refs?: string[]
  evidence_kind?: string
  command?: string
  exit_code?: string
  artifact_ref?: string
  covers?: string[]
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
  // 历史豁免必须能证明创建时间早于控制上线日；没有创建时间同样不放行。
  if (created === '') {
    return [{ rule: 'C-11', unit: txt(u.id) || '(unit)', why: '历史豁免必须有 created_at 证明创建于控制上线之前；缺创建时间不得放行' }]
  }
  if (created.slice(0, 10) >= CONTROL_CUTOFF) {
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
  /**
   * **高风险变更必须有独立设计评审**（2026-11-06 · Wave 4）。
   *   ⚠ 判据是"评审者 ≠ 作者"，⛔ 不是"写了一个 reviewer 字段"。
   *   ⚠ 风险等级只认封闭三值；写别的值 ⇒ 红（不猜它想表达什么）。
   */
  const tier = txt(u.risk_tier).toLowerCase()
  if (tier !== '' && !['low', 'medium', 'high'].includes(tier)) {
    out.push({ rule: 'C-15', unit: id, why: `risk_tier 不在封闭集内：${tier}（只收 low / medium / high）` })
  }
  if (tier === 'high') {
    const reviewer = txt(u.reviewer)
    if (reviewer === '') out.push({ rule: 'C-15', unit: id, why: '高风险变更缺独立设计评审者（reviewer）' })
    else if (reviewer === txt(u.built_by)) out.push({ rule: 'C-15', unit: id, why: '设计评审者就是作者本人（reviewer == built_by）' })
    if (arr(u.review_refs).length === 0) out.push({ rule: 'C-15', unit: id, why: '高风险变更缺评审记录（review_refs 为空）' })
  }
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
    if (builder !== '' && acceptor === builder) out.push({ rule: 'C-7', unit: id, why: '验收者与实现者是同一个会话（自己验自己）' })
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

/** 全部阶段控制问题。 */
export function stageControlProblems(units: readonly StageControlUnit[]): StageControlProblem[] {
  return units.flatMap((u) => [
    ...requirementProblems(u),
    ...planProblems(u),
    ...taskProblems(u),
    ...runProblems(u),
    ...evidenceProblems(u),
    ...acceptanceProblems(u, units),
    ...titleProblems(u, units),
    ...legacyMisuse(u),
  ])
}

/**
 * **账本闭环缺口**（2026-11-08 · 用户报「没有账本或旧账本梳理不到完全健康」）。
 *
 * ══ 它治的病（实测）══════════════════════════════════════════════════════════
 *   `stageControlProblems` 是**逐条单元**的字段门禁：它只问"这一条填全了没有"。
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
      const refs = [...arr(u.req_ids), ...arr(u.requirement_coverage)
        .map((x) => (/^([A-Z]+-[A-Za-z0-9-]+)/.exec(x)?.[1] ?? ''))]
        .map((x) => txt(x)).filter((x) => x !== '')
      const real = refs.filter((x) => ids.has(x) && kindOf.get(x) === 'req')
      if (real.length === 0) {
        out.push({
          rule: 'L-1', unit: id,
          why: refs.length === 0
            ? '方案没有指向任何需求（req_ids / requirement_coverage 都空）⇒ 方案没有需求托底'
            : '方案指向的需求在账本里都不存在（' + refs.slice(0, 3).join(' / ') + '）⇒ 先落需求',
        })
      }
    }
    if (kind === 'task') {
      const parent = txt(u.parent)
      if (parent === '' || kindOf.get(parent) !== 'change') {
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
      if (parent === '' || kindOf.get(parent) !== 'task') {
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
    for (const r of [...arr(root.req_ids), ...arr(root.addresses), ...arr(root.acceptance_ids), ...arr(root.verify_refs), ...arr(root.evidence_refs)]) add(r)
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
        || arr(u.acceptance_ids).some((x) => ids.has(x))
        || arr(u.verify_refs).some((x) => ids.has(x))
      if (linked && !ids.has(uid)) { ids.add(uid); changed = true }
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
  if (input.action === 'write-repair') {
    return { decision: 'go', scope: scopeText, blockers: [], allowedRepairs: [] }
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
    case 'plan': return units.flatMap(planProblems)
    case 'tasks': return units.flatMap(taskProblems)
    case 'execution': return units.flatMap(runProblems)
    case 'acceptance': return units.flatMap((u) => acceptanceProblems(u, units))
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
