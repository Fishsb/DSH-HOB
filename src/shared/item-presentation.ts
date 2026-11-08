/**
 * **条目展示投影**（纯函数，零 I/O）。
 *
 * 账本单元同时承担身份、生命周期、关系和证据。面板的折叠行不能把这些字段
 * 都塞进标题里；本模块只从既有单元派生**可读投影**，不新增状态、不写盘、
 * 不读时间，也不猜测缺失关系。
 *
 * 线格式分两层：
 *   · `listPresentationOf` —— `/stages` 的紧凑列表投影，只带主标题、关系 ID、
 *     最多两条短读数和诊断代码；关系标题由顶层 `relations` 按稳定 ID 共享一份。
 *   · `presentationOf` —— 完整投影，供按 ID 读取与判据使用；原句、详情与
 *     诊断文案都在这里。
 * 旧字段 `title` / `extra` 由 `/stages` 的兼容线格式原样保留；新面板请求紧凑模式，
 * 只拿列表投影，完整原文由 `/ledger-resource` 按 ID 读取。
 */

export type ItemFlagCode =
  | 'title-generic'
  | 'title-status-conflict'
  | 'title-references-other'
  | 'relation-unresolved'
  | 'legacy-title'

export type ItemRelationKey = 'goal' | 'requirement' | 'change' | 'task'

/**
 * 关系 `key` → 关系行**固定中文标签**（唯一事实源）。
 * ⚠ 客户端与服务端都从这里取，⛔ 不许各写一份按 `kind` 的映射
 *   （两套事实源会让"服务端改了标签、界面看不出来" —— 2026-11-07 负向对拍实测）。
 * ⚠ 不随列表逐条下发（197 条重复约 1.2 KB 会把紧凑线顶过 64 KB）；
 *   它是**封闭常量表**，两端 import 同一份即可。
 */
export const RELATION_LABELS: Readonly<Record<ItemRelationKey, string>> = {
  goal: '所属目标',
  requirement: '承接需求',
  change: '所属方案',
  task: '执行对象',
}

/**
 * 关系行标签的**唯一派生入口**（服务端与面板共用）。
 *
 * ⚠ `run` 与 `acc` 的关系 `key` 都是 `task`，但标签不同（执行对象 / 验收对象）⇒
 *   只看 `key` 分不开，必须再带上条目 `kind`。
 * ⚠ 面板 ⛔ 不许自己再写一份按 `kind` 的映射：那会让"服务端改了标签、界面看不出来"。
 */
export function relationLabelOf(relation: { key: ItemRelationKey } | null | undefined, kind: string): string {
  if (relation === null || relation === undefined) return '关系'
  if (relation.key === 'task') return kind === 'acc' ? '验收对象' : '执行对象'
  return RELATION_LABELS[relation.key]
}

export interface ItemRelation {
  key: ItemRelationKey
  label: string
  id: string | null
  /** 关系对象完整标题；列表投影不内联，改由顶层 `relations` 共享。 */
  title: string | null
  state: 'ok' | 'undecidable'
}

/** `/stages` 列表里的关系：只带稳定身份与可判性。 */
export interface ItemListRelation {
  key: ItemRelationKey
  id: string | null
  state: 'ok' | 'undecidable'
}

export interface ItemFact {
  key: string
  label: string
  value: string
  state: 'ok' | 'undecidable'
}

/** `/stages` 列表里的短读数：`[标签, 值]`；完整值走按 ID 读取。 */
export type ItemListFact = [string, string]

export interface ItemPresentation {
  kind: string
  displayTitle: string
  originalTitle: string
  relation: ItemRelation | null
  /** 折叠行最多显示两条；完整读数在 `details`。 */
  facts: ItemFact[]
  details: ItemFact[]
  flags: Array<{ code: ItemFlagCode; message: string }>
}

/** `/stages` 的紧凑条目投影（⛔ 不含原文、详情和重复的父标题）。 */
export interface ItemListPresentation {
  displayTitle: string
  relation: ItemListRelation | null
  facts: ItemListFact[]
  flags: ItemFlagCode[]
}

/** 投影只需要账本单元的稳定字段；其余字段按 `unknown` 读取。 */
export interface PresentationUnit {
  id: string
  kind: string
  title?: string
  status?: string
  parent?: string
  clarify_legacy?: string
  [key: string]: unknown
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).map((x) => x.trim()).filter((x) => x !== '') : []
const unitOf = (units: readonly PresentationUnit[], id: string): PresentationUnit | undefined =>
  units.find((u) => String(u.id) === id)

/** 把长读数压成折叠行可读的一段；完整值始终另存进 details 或按 ID 资源读取。 */
export function compactItemText(value: unknown, max = 72): string {
  const s = text(value).replace(/\s+/g, ' ')
  if (s === '') return ''
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`
}

const fact = (key: string, label: string, value: unknown, state: 'ok' | 'undecidable' = 'ok'): ItemFact => ({
  key,
  label,
  value: text(value) === '' ? '判不出' : text(value),
  state: text(value) === '' ? 'undecidable' : state,
})

const relationOf = (u: PresentationUnit, units: readonly PresentationUnit[]): ItemRelation | null => {
  const id = String(u.id)
  const parentId = text(u.parent)
  const fromId = (key: ItemRelationKey, label: string, targetId: string): ItemRelation => {
    if (targetId === '') return { key, label, id: null, title: null, state: 'undecidable' }
    const target = unitOf(units, targetId)
    return target === undefined
      ? { key, label, id: targetId, title: null, state: 'undecidable' }
      : { key, label, id: targetId, title: text(target.title) === '' ? null : text(target.title), state: 'ok' }
  }
  if (u.kind === 'req') {
    const goal = units.find((x) => x.kind === 'goal' && arr(x.req_ids).includes(id))
    return goal === undefined
      ? { key: 'goal', label: '所属目标', id: null, title: null, state: 'undecidable' }
      : { key: 'goal', label: '所属目标', id: String(goal.id), title: text(goal.title) === '' ? null : text(goal.title), state: 'ok' }
  }
  if (u.kind === 'change') return fromId('requirement', '承接需求', arr(u.addresses)[0] ?? '')
  if (u.kind === 'task') return fromId('change', '所属方案', parentId)
  if (u.kind === 'run') return fromId('task', '执行对象', parentId)
  if (u.kind === 'acc') return fromId('task', '验收对象', parentId)
  return null
}

const GENERIC_TITLE_RE = /^(?:P\d+|第\s*\d+\s*(?:期|轮)|P\d+\s*：\s*第\s*\d+\s*期(?:\s*[（(].*[）)])?)$/
const isGenericTitle = (t: string): boolean =>
  GENERIC_TITLE_RE.test(t)
  || /^P\d+\s*的实施会话/.test(t)
  || /^第\s*\d+\s*轮/.test(t)
  /**
   * ⚠ 补了父链上下文后是「P2：第 2 期（该期任务书） · 真实方案」——
   *   仍以空壳开头 ⇒ 诊断必须看**开头**，否则漏标（2026-11-08 实测）。
   */
  || /^P\d+\s*：\s*第\s*\d+\s*期/.test(t)

/**
 * **空壳标题补正式父链上下文**（2026-11-08）。
 *
 * ⚠ 真实账本里有 36 条主标题是「P1：第 1 期（该期任务书）」这类空壳；
 *   它们单独看读不懂，正是用户报的“条目说明是别的条目”。
 *   ⇒ 用**正式父链**里最近的方案标题补上下文（⛔ 不读正文、⛔ 不猜、⛔ 不改账本）：
 *     · task：父 change 的标题；
 *     · run/acc：父 task → 父 change 的标题；
 *     · req/change：原样（需求/方案标题本身就是语义）。
 *   组合后形如「P1：第 1 期 · 从零重构：状态从散文搬进机读索引」。
 */
const contextTitleOf = (u: PresentationUnit, units: readonly PresentationUnit[], base: string): string => {
  if (!isGenericTitle(base)) return base
  const kind = String(u.kind)
  let node: PresentationUnit | undefined
  if (kind === 'task') node = unitOf(units, text(u.parent))
  else if (kind === 'run' || kind === 'acc') {
    const task = unitOf(units, text(u.parent))
    node = task === undefined ? undefined : unitOf(units, text(task.parent))
  }
  const context = node === undefined ? '' : text(node.title)
  if (context === '' || isGenericTitle(context)) return base
  return `${base} · ${compactItemText(context, 28)}`
}

const displayTitleOf = (u: PresentationUnit, relation: ItemRelation | null, units: readonly PresentationUnit[]): string => {
  const original = text(u.title)
  if (['run', 'acc'].includes(String(u.kind)) && relation?.state === 'ok' && relation.title !== null) {
    return contextTitleOf(u, units, relation.title)
  }
  return contextTitleOf(u, units, original)
}

const detailFactsOf = (u: PresentationUnit, relation: ItemRelation | null): ItemFact[] => {
  const out: ItemFact[] = []
  if (relation !== null && (relation.state !== 'ok' || relation.id === null)) {
    out.push({
      key: 'relation',
      label: relation.label,
      value: relation.id === null ? '判不出（没有正式关系）' : `判不出（父级 ${relation.id} 不存在）`,
      state: 'undecidable',
    })
  }
  const add = (key: string, label: string, value: unknown): void => {
    const v = text(value)
    if (v !== '') out.push(fact(key, label, v))
  }
  const addList = (key: string, label: string, value: unknown): void => {
    const values = arr(value)
    if (values.length > 0) out.push(fact(key, label, values.join(' · ')))
  }
  if (u.kind === 'req') {
    addList('acceptance_criteria', '验收条件', u.acceptance_criteria)
    addList('clarify_examples', '关键例子', u.clarify_examples)
    add('spec', '需求正文', u.spec)
  } else if (u.kind === 'change') {
    addList('path_options', '候选路径', u.path_options)
    addList('path_tradeoffs', '路径取舍', u.path_tradeoffs)
    add('path_decision', '方案决策', u.path_decision)
    addList('requirement_coverage', '需求映射', u.requirement_coverage)
    /**
     * 主关系只显示 `addresses[0]`；其余正式承接需求必须在展开详情里逐条保留，
     * ⛔ 不许因为主行只放一个关系而把它们丢掉。
     */
    const rest = arr(u.addresses).slice(1)
    if (rest.length > 0) add('additional_requirements', '其余需求', rest.join(' · '))
    add('stage_summary', '阶段摘要', u.stage_summary)
    if (text(u.stage_summary) === '') out.push(fact('stage_summary', '阶段摘要', '判不出', 'undecidable'))
  } else if (u.kind === 'task') {
    add('budget', '预算', u.budget)
    if (text(u.budget) === '') out.push(fact('budget', '预算', '判不出', 'undecidable'))
    add('verify', '完整验证', u.verify)
    add('task_brief', '任务书', u.task_brief)
    addList('counterexamples', '反例', u.counterexamples)
    addList('stop_conditions', '停手条件', u.stop_conditions)
    addList('scope_paths', '允许路径', u.scope_paths)
  } else if (u.kind === 'run') {
    add('started_at', '开始时刻', u.started_at)
    add('why', '时刻说明', u.why)
    add('delivered_at', '回传时刻', u.delivered_at)
    add('report', '回传件', u.report)
    addList('progress_refs', '小步验证', u.progress_refs)
  } else if (u.kind === 'acc') {
    add('actor', '验收者', u.actor)
    add('acceptance_session', '验收会话', u.acceptance_session)
    /**
     * 判决与等待对象是验收条目的固定事实：未判决时明写「在等独立验收会话」，
     * ⛔ 不把缺 `verified_at` 当成空项省略，也不猜判决结果。
     */
    if (text(u.status) === 'unverified') {
      out.push(fact('verdict', '判决', '判不出（尚未判决）', 'undecidable'))
      out.push(fact('waiting_for', '在等谁', '独立验收会话'))
    } else {
      out.push(fact('verdict', '判决', text(u.status) === 'pass' ? '验收通过' : text(u.status) === 'send-back' ? '已退回' : '判不出', text(u.status) === 'pass' || text(u.status) === 'send-back' ? 'ok' : 'undecidable'))
    }
    add('verified_at', '判决时刻', u.verified_at)
    addList('basis', '判决依据', u.basis)
    addList('evidence', '证据', u.evidence)
    addList('example_results', '例子结果', u.example_results)
    add('product_confirmation', '产品确认', u.product_confirmation)
  }
  add('source', '来源', u.source)
  return out
}

const foldedFactsOf = (u: PresentationUnit): ItemFact[] => {
  const out: ItemFact[] = []
  if (u.kind === 'task') {
    const verify = text(u.verify)
    if (verify !== '') out.push(fact('verify_summary', '验证', compactItemText(verify.split(/\s*·\s*/)[0], 64)))
    const scopes = arr(u.scope_paths)
    if (scopes.length > 0) out.push(fact('scope_count', '允许路径', `${scopes.length} 条`))
  } else if (u.kind === 'run') {
    const started = text(u.started_at)
    out.push(fact('started_at', '开始', compactItemText(started, 48), started === '' || started.includes('判不出') ? 'undecidable' : 'ok'))
    const progress = arr(u.progress_refs)
    if (progress.length > 0) out.push(fact('progress_count', '小步验证', `${progress.length} 条`))
  } else if (u.kind === 'acc') {
    /**
     * ⚠⚠ **折叠读数固定是「判决 + 依据」**（方案 §3.1 / §四）——
     *   ⛔ 不能拿「判决时刻」顶替「判决」：已通过的验收若没有 `verified_at`
     *   （历史 28 条同形），折叠行会显示「判决 判不出（尚未判决）」，
     *   而条目实际是 `pass` ⇒ 用户只看折叠行必然读反（2026-11-07 真机实测）。
     *   ⚠ 判决时刻仍保留在**展开详情**里（`presentationOf` 的 `verified_at`）。
     */
    const verdict = text(u.status) === 'pass'
      ? '验收通过'
      : text(u.status) === 'send-back'
        ? '已退回'
        : text(u.status) === 'unverified'
          ? '判不出（尚未判决）'
          : '判不出'
    out.push(fact('verdict', '判决', verdict, verdict === '判不出' || verdict === '判不出（尚未判决）' ? 'undecidable' : 'ok'))
    const basis = arr(u.basis)
    if (basis.length > 0) out.push(fact('basis_count', '依据', `${basis.length} 条`))
    else out.push(fact('basis_count', '依据', '判不出', 'undecidable'))
  } else if (u.kind === 'req') {
    const criteria = arr(u.acceptance_criteria)
    if (criteria.length > 0) out.push(fact('acceptance_count', '验收条件', `${criteria.length} 条`))
    else out.push(fact('acceptance_count', '验收条件', '判不出', 'undecidable'))
    const examples = arr(u.clarify_examples)
    if (examples.length > 0) out.push(fact('example_count', '关键例子', `${examples.length} 条`))
  } else if (u.kind === 'change') {
    const decision = text(u.path_decision)
    if (decision !== '') out.push(fact('path_decision', '方案决策', compactItemText(decision, 64)))
    const coverage = arr(u.requirement_coverage)
    if (coverage.length > 0) out.push(fact('coverage', '需求映射', `${coverage.length} 条`))
    /**
     * ⚠ **折叠行不能只剩关系行**（2026-11-07 真机抽查）：
     *   历史 `change`（`pre-control` 豁免）普遍没有 `path_decision` / `requirement_coverage`，
     *   若只认这两个字段，8 条方案在首屏就只有一行标题 + 一行关系，
     *   用户看不出“这个方案做了什么、覆盖了几条需求”。
     *   ⇒ 用**正式承接需求数**兜底：那是账本已有的 `addresses`，⛔ 不新造状态、不猜内容。
     */
    if (out.length === 0) {
      const addresses = arr(u.addresses)
      out.push(addresses.length > 0
        ? fact('addresses_count', '承接需求', `${addresses.length} 条`)
        : fact('addresses_count', '承接需求', '判不出', 'undecidable'))
    }
  }
  return out.slice(0, 2)
}

const flagsOf = (
  u: PresentationUnit,
  units: readonly PresentationUnit[],
  originalTitle: string,
  relation: ItemRelation | null,
  /**
   * ⚠ **实际展示的标题**（`run` / `acc` 取的是父任务标题）。
   *   泛化标题判定必须看它：父任务标题是「P1：第 1 期（该期任务书）」时，
   *   子条目主行展示的也是这句空壳 ⇒ 用户同样读不懂，
   *   ⛔ 不能因为“原句不是空壳”就不标记（2026-11-07 真机抽查发现 12 条）。
   */
  displayTitle: string,
): ItemPresentation['flags'] => {
  const out: ItemPresentation['flags'] = []
  const title = originalTitle
  const status = text(u.status)
  const id = String(u.id)
  const genericRe = /^(?:P\d+|第\s*\d+\s*(?:期|轮)|P\d+\s*：\s*第\s*\d+\s*期(?:\s*[（(].*[）)])?)$/
  /**
   * ⚠ 展示标题补了父链上下文后**不再等于**空壳原句，但仍以空壳开头
   *   （「P2：第 2 期（该期任务书） · 真实方案」）。判定必须看**开头**，
   *   ⛔ 不能用 `genericRe.test(displayTitle)`（带上下文后整串不匹配 ⇒ 漏标）。
   */
  if (genericRe.test(title)
    || /^P\d+\s*的实施会话/.test(title)
    || /^第\s*\d+\s*轮/.test(title)
    || (displayTitle !== '' && isGenericTitle(displayTitle))) {
    out.push({ code: 'title-generic', message: '标题只写了期次或轮次' })
  }
  if ((status === 'pass' && /待独立验收|待验收|还没验/.test(title))
    || (status === 'send-back' && /验收通过|已通过/.test(title))
    || (status === 'built' && /待开工|未开工/.test(title))
    || (status === 'returned' && /执行中/.test(title))) {
    out.push({ code: 'title-status-conflict', message: '标题状态与账本状态不一致' })
  }
  if (relation !== null && relation.state !== 'ok') {
    out.push({ code: 'relation-unresolved', message: `${relation.label}判不出` })
  }
  const ids = [...title.matchAll(/\b(?:G|R|CHG|TSK|RUN|ACC|EVD|RSK|DEC|CAP)-[A-Za-z0-9-]+\b/g)].map((m) => m[0])
  const allowed = new Set<string>([id])
  if (relation?.id !== null && relation?.id !== undefined) allowed.add(relation.id)
  if (u.kind === 'change') for (const x of arr(u.addresses)) allowed.add(x)
  if (u.kind === 'task') for (const x of arr(u.req_ids)) allowed.add(x)
  /**
   * ⚠ **`evidence` / `risk` / `decision` 的标题引用证据或风险是正式关系，不是“别的条目”**
   *   （2026-11-08 真机抽查）：`EVD-033` 标题写「…（ACC-001 依据）」，
   *   它自己的 `parent` 是 `TSK-031`、`basis` 就指向 `ACC-001`；
   *   旧判定只把父级加入白名单 ⇒ 9 条证据被误标 `title-references-other`。
   *   ⇒ 把本单元**正式引用的 ID** 全部加入白名单：`basis` / `evidence` / `evidence_refs` /
   *     `verification_refs` / `affects` / `risk_ids` / `decisions` / `acceptance_ids`。
   *   ⛔ 仍不放宽成“任意编号都合法”：只有账本字段里真的引用到的才算。
   */
  for (const key of ['basis', 'evidence', 'evidence_refs', 'verification_refs', 'affects', 'risk_ids', 'decisions', 'acceptance_ids']) {
    for (const x of arr((u as Record<string, unknown>)[key])) allowed.add(x)
  }
  /**
   * `run` / `acc` 的标题常引用父任务或父任务的需求；那是正式关系链，不是“别的条目”。
   * 与 `stage-controls.ts` 的 C-17 同口径，避免把合法关系误标成 foreign。
   */
  const parent = unitOf(units, text(u.parent))
  if (parent !== undefined) {
    allowed.add(String(parent.id))
    for (const x of [...arr(parent.req_ids), ...arr(parent.addresses), ...arr(parent.acceptance_ids)]) allowed.add(x)
    /**
     * ⚠⚠ **证据的标题常引用同一父任务下的验收/执行兄弟条目**（2026-11-08 真机抽查）：
     *   `EVD-033` 标题写「…（ACC-001 依据）」，它自己的 `parent = TSK-031`，
     *   而 `ACC-001` 也是 `TSK-031` 的子项 ⇒ 这是**正式兄弟关系**，不是“别的条目”。
     *   旧实现只把父级与父级字段加入白名单 ⇒ 9 条证据被误标。
     *   ⇒ 同一父级下的兄弟条目也算正式引用；父级是 change 时，其下 task 同样算。
     *   ⛔ 仍不放宽成任意编号：只认 `parent` 相同或 `parent.parent` 相同的条目。
     */
    for (const sibling of units) {
      if (sibling === u) continue
      if (text(sibling.parent) === String(parent.id)) {
        allowed.add(String(sibling.id))
        /** 兄弟条目自己的正式承接需求也在同一条关系链上。 */
        for (const x of [...arr(sibling.req_ids), ...arr(sibling.addresses), ...arr(sibling.acceptance_ids)]) allowed.add(x)
        /**
         * ⚠ **兄弟的 `after` 是正式前置链**（`TSK-036.after = ["TSK-035"]`）：
         *   沿它向上能看到需求（`TSK-035 → CHG-2026-10-30-rearch → R-001`）。
         *   ⛔ 不当作“无关编号”；只加入本层兄弟的 `after`，不无限递归。
         */
        for (const x of arr(sibling.after)) allowed.add(x)
      }
    }
    /**
     * ⚠ 父任务本身可能直接挂在需求下（历史任务 `TSK-033.parent = R-004`）：
     *   这时标题里的 `R-004` 是**父级自己的需求**，属于正式关系链。
     *   ⇒ 把父级的 `parent` 也加入白名单（仅一层，⛔ 不递归整棵树）。
     */
    if (text(parent.parent) !== '') allowed.add(text(parent.parent))
    /**
     * ⚠ 父任务自己挂在需求下（`TSK-033.parent = R-004`）时，需求就是父级本身；
     *   父任务挂在 change 下时，需求来自该 change 的 `addresses`。
     */
    const parentTarget = unitOf(units, text(parent.parent))
    if (parentTarget !== undefined) {
      for (const x of [...arr(parentTarget.addresses), ...arr(parentTarget.acceptance_ids)]) allowed.add(x)
      if (parentTarget.kind === 'req') allowed.add(String(parentTarget.id))
    }
    /**
     * ⚠ **历史任务直接挂在 `change` 下，而需求来自兄弟任务**（2026-11-08 真机抽查）：
     *   `EVD-037` 的父任务 `TSK-035.parent = CHG-2026-10-30-rearch`，
     *   标题里的 `R-001` 是**同父兄弟任务** `TSK-063` 的 `req_ids`。
     *   ⇒ 沿父级再向上一层：父级的兄弟条目所承接的需求也算正式关系链（仅两层）。
     *   ⛔ 不递归整棵树、不放宽成任意编号。
     */
    const grand = unitOf(units, text(parent.parent))
    if (grand !== undefined) {
      for (const sibling of units) {
        if (text(sibling.parent) !== String(grand.id)) continue
        allowed.add(String(sibling.id))
        for (const x of [...arr(sibling.req_ids), ...arr(sibling.addresses), ...arr(sibling.acceptance_ids), ...arr(sibling.after)]) allowed.add(x)
        /**
         * ⚠ 兄弟的**子条目**（同父的验收/执行/证据）也在这条关系链上：
         *   `EVD-038` 标题引用 `R-005`，而 `R-005` 是兄弟任务 `TSK-063` 的需求；
         *   有些历史条目则通过兄弟的子验收/证据再引用需求。
         *   ⇒ 把兄弟的直接子条目也纳入（仅一层，⛔ 不无限递归）。
         */
        for (const child of units) {
          if (text(child.parent) !== String(sibling.id)) continue
          allowed.add(String(child.id))
          for (const x of [...arr(child.req_ids), ...arr(child.addresses), ...arr(child.acceptance_ids)]) allowed.add(x)
        }
      }
      /**
       * ⚠ **`after` 里的需求编号是正式前置/承接线索**（历史写法 `after = ["R-005"]`）。
       *   `EVD-038` 的父任务 `TSK-036` 没有 `req_ids`，需求只出现在 `after`；
       *   只认 `req_ids` 会把它误标成“标题引用别的条目”。
       *   ⇒ 本单元与同一父级链上的 `after` 里 `R-` 编号都纳入白名单（⛔ 不扩大为任意编号）。
       */
      for (const x of arr(u.after)) if (/^R-/.test(x)) allowed.add(x)
      for (const sibling of units) {
        if (text(sibling.parent) !== String(grand.id)) continue
        for (const x of arr(sibling.after)) if (/^R-/.test(x)) allowed.add(x)
      }
      /**
       * ⚠ **兄弟任务自己的需求可能挂在其 `parent` 链上**（2026-11-08 真机抽查）：
       *   `TSK-035` 的兄弟 `TSK-063.req_ids = [R-001, R-005]`，但另一些历史任务没有
       *   `req_ids`，其需求来自**兄弟任务的父 change** 的 `addresses`。
       *   ⇒ 对父级的每个兄弟条目，也把它的 `parent` 及其 `addresses` / `acceptance_ids` 纳入。
       */
      for (const sibling of units) {
        if (text(sibling.parent) !== String(grand.id)) continue
        const p2 = unitOf(units, text(sibling.parent))
        if (p2 !== undefined) {
          allowed.add(String(p2.id))
          for (const x of [...arr(p2.addresses), ...arr(p2.acceptance_ids)]) allowed.add(x)
        }
      }
    }
  }
  /**
   * ⚠ **历史证据条目的标题里写“（ACC-xxx / R-xxx 依据）”是它自己的证明链**：
   *   这些 ID 不一定在本单元字段里，而是出现在 `reading` 原文或同父验收的说明里。
   *   若标题同时含 `依据` / `读数` / `实跑` / `验收` 等证据词，且引用的对象**真实存在**，
   *   就视为正式证据引用，⛔ 不标成“标题引用非当前关系”。
   *   ⚠ 只对 `kind=evidence` 生效；⛔ 不改变 `acc` / `task` 的无关编号判定。
   */
  const evidenceish = String(u.kind) === 'evidence' && /依据|读数|实跑|验收|证据/.test(title)
  const other = [...new Set(ids.filter((x) => !allowed.has(x) && !(evidenceish && unitOf(units, x) !== undefined)))]
  if (other.length > 0) {
    out.push({ code: 'title-references-other', message: `标题引用非当前关系：${other.join(' / ')}` })
  }
  if (text(u.clarify_legacy) === 'pre-control' && out.length > 0) {
    out.push({ code: 'legacy-title', message: '历史标题：只做展示投影' })
  }
  return out
}

/** 从一条账本单元派生完整展示投影（原句、关系标题与详情都在）。 */
export function presentationOf(unit: PresentationUnit, units: readonly PresentationUnit[]): ItemPresentation {
  const originalTitle = text(unit.title)
  const relation = relationOf(unit, units)
  const displayTitle = displayTitleOf(unit, relation, units) || originalTitle || '判不出标题'
  const flags = flagsOf(unit, units, originalTitle, relation, displayTitle)
  return {
    kind: String(unit.kind ?? ''),
    displayTitle,
    originalTitle,
    relation,
    facts: foldedFactsOf(unit),
    details: [
      ...detailFactsOf(unit, relation),
      /**
       * 展开详情固定有「异常」一项：诊断为空时明写“无”，有诊断时逐条保留。
       * ⚠ 这一项由同一份 `flags` 派生，⛔ 不是客户端另猜的第二状态源。
       */
      fact('flags', '异常', flags.map((f) => f.message).join('；') || '无'),
    ],
    flags,
  }
}

/**
 * 从一条账本单元派生 `/stages` 的紧凑列表投影。
 *
 * ⚠ 主标题保持完整；关系只带稳定 ID 与状态，标题由 `relations` 共享表提供。
 *   读数最多两条短值（按阶段固定字段）；完整正文和原句由 `/ledger-resource` 按 ID 读取。
 */
export function listPresentationOf(unit: PresentationUnit, units: readonly PresentationUnit[]): ItemListPresentation {
  const full = presentationOf(unit, units)
  return {
    displayTitle: full.displayTitle,
    relation: full.relation === null
      ? null
      : { key: full.relation.key, id: full.relation.id, state: full.relation.state },
    facts: full.facts.slice(0, 2).map((f) => {
      const label = f.key === 'verified_at' ? '判决' : f.key === 'scope_count' ? '路径' : f.key === 'example_count' ? '例子' : f.key === 'path_decision' ? '决策' : f.key === 'coverage' ? '映射' : f.key === 'progress_count' ? '小步' : f.label
      const max = f.key === 'verified_at' ? 16 : 20
      return [label, compactItemText(f.value, max)] as ItemListFact
    }),
    flags: full.flags.map((f) => f.code),
  }
}


/** 关系标题共享表：同一次 `/stages` 读数里每个稳定 ID 只存一份。 */
export function relationTitlesOf(units: readonly PresentationUnit[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const unit of units) {
    const relation = relationOf(unit, units)
    if (relation?.id !== null && relation?.id !== undefined && relation.title !== null && out[relation.id] === undefined) {
      out[relation.id] = compactItemText(relation.title, 48)
    }
  }
  return out
}

/** 诊断代码 → 人读文案（客户端与完整投影共用，⛔ 不各写一套）。 */
export const ITEM_FLAG_MESSAGES: Readonly<Record<ItemFlagCode, string>> = {
  'title-generic': '标题只写了期次或轮次',
  'title-status-conflict': '标题状态与账本状态不一致',
  'title-references-other': '标题引用非当前关系',
  'relation-unresolved': '正式关系判不出',
  'legacy-title': '历史标题：只做展示投影',
}
