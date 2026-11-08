/**
 * **`ledger/units/`（index 导航 + unit-*.toml 分片）→ 五步汇总 + cap 单列**（纯函数，零 I/O）—— 2026-10-30 · P3。
 *
 * ══ 它是什么 ═══════════════════════════════════════════════════════════════════
 *   面板新数据源的服务端处理体。读的是**机读索引**（⛔ 不再读 `volumes/tasks/INDEX.md` 那份散文账），
 *   按 `DESIGN-V2.md` §四 把五步**算出来**，`cap` 单列（⛔ 不进分母）。
 *
 * ══ ⚠ 与生成器的一致性（重要）═══════════════════════════════════════════════════
 *   `scripts/gen-ledger.mjs` 也解析同一份索引。两处**都用"受限 TOML 子集"**，
 *   但**实现是两份**（脚本侧要零 `node:*` 之外的依赖、服务端侧要能被 `ts-mount` 转译）。
 *   ⇒ 一致性不靠自觉：`check:stages-route` 的 **R-9** 断言**本文件算出的五步数字与
 *     `gen/stages.md` 里那五行逐字对上**（两套解析器 + 两条渲染路径交叉验证）。
 *   ⚠ 这是在补 `DESIGN-V2.md` §十·4 自己点出的洞：「I5 只证生成物与生成器一致，不证生成器算对了」。
 */

import { nextAction, type NextAction, type LedgerUnitLike } from './next-action.ts'
import { portfolioOf, type Portfolio, type PortfolioUnit } from './portfolio.ts'
import { attentionOf, type WorkStateReading } from './work-state.ts'
import { convergenceOf } from './convergence.ts'
import { attentionAfterMainAction, panelSummaryOf, type PanelSummary } from './panel-summary.ts'
import { listPresentationOf, relationTitlesOf, type ItemListPresentation } from './item-presentation.ts'
import { ledgerClosureProblems, stageControlProblems, type StageControlUnit } from './stage-controls.ts'
export { changeRequirementIds } from './ledger-relations.ts'
export { UNIT_STATUSES, unitShapeProblems } from './ledger-validation.ts'
import { unitShapeProblems as shapeProblemsOf } from './ledger-validation.ts'

/** 五步的名字与 kind（⚠ 唯一真源，顺序 = 渲染顺序）。 */
export const STAGE_DEFS = [
  { step: 1, kind: 'req', name: '需求规格' },
  { step: 2, kind: 'change', name: '实现方案' },
  { step: 3, kind: 'task', name: '编码任务' },
  { step: 4, kind: 'run', name: '任务执行' },
  { step: 5, kind: 'acc', name: '验收核对' },
] as const

/** 封闭状态集（与 `DESIGN-V2.md` §3.3 一致；⚠ 与生成器那份必须同值，由 R-9 交叉验证）。 */
export const STAGE_KIND_STATUSES: Readonly<Record<string, { statuses: string[]; init: string; finals: string[] }>> = {
  /**
   * `retired` 是**可追踪的退役态**，不是第六步：
   * 退役需求保留原编号与六项元数据，但退出活跃覆盖与后续派工。
   */
  req: { statuses: ['draft', 'agreed', 'dropped', 'retired'], init: 'draft', finals: ['agreed', 'dropped', 'retired'] },
  change: { statuses: ['proposed', 'settled', 'superseded'], init: 'proposed', finals: ['settled', 'superseded'] },
  task: { statuses: ['todo', 'doing', 'built'], init: 'todo', finals: ['built'] },
  run: { statuses: ['registered', 'running', 'returned', 'refused', 'stuck'], init: 'registered', finals: ['returned', 'refused', 'stuck'] },
  acc: { statuses: ['pass', 'send-back', 'unverified'], init: 'unverified', finals: ['pass', 'send-back'] },
  cap: { statuses: ['live', 'degraded', 'down'], init: 'live', finals: [] },
  /**
   * ⚠⚠ **2026-10-31 P40/R2：三个受控对象**（`TASK-R2.md` §二）——————————————
   *   加这三行**不是顺手重构**，而是 §八「条件式可以改 `src/**`」那一条的**唯一触发点**：
   *   当时 `check:stages-route` 的 R-9 拿这份表去核 `ledger/units/index.toml`，
   *   账本里一有 `EVD-` 就报 `row-shape-unknown`（实测原文：`EVD-001: kind="evidence" 不在封闭集`）。
   *   ⇒ 这处**正是在读 `ledger/gen` 的判定路径上**，且改动是**逐值追加**，
   *     ⛔ 没动任何既有 kind、⛔ 没动面板样式、⛔ 没动渲染分支。
   *
   *   ⚠ 三者 `finals: []` = **无终态**，且它们在 `STAGE_DEFS` 里**没有对应的步**
   *     ⇒ 不进任何一步的分母（与 `cap` 同一处置，`KIND_SPEC` 那边是 `step: null`）。
   *   ⚠⚠ **这两份表必须同值**（本文件自己第 25 行的注释就写着"由 R-9 交叉验证"）：
   *     本次同步的是 `scripts/gen-ledger.mjs` 的 `KIND_SPEC` —— 改一处不改另一处，R-9 当场红。
   */
  risk: { statuses: ['open', 'handling', 'closed'], init: 'open', finals: [] },
  decision: { statuses: ['active', 'superseded'], init: 'active', finals: [] },
  evidence: { statuses: ['recorded'], init: 'recorded', finals: [] },
  /**
   * ⚠⚠ **2026-11-02 P50/M10：补 B 轨（`TASK-B1.md`）的收尾漏项**——————————————
   *   B 轨加 `goal` 时只改了 `scripts/gen-ledger.mjs` 的 `KIND_SPEC`（那里现在是第 10 个 kind），
   *   **没同步本表** ⇒ 当时 `check:stages-route` 的 R-9 拿本表去核 `ledger/units/index.toml`，
   *   遇到 `G-01` / `G-02` 就报（实测原文）：
   *     `R-9 · 真索引算不出：{"ok":false,"reason":"row-shape-unknown",… G-01: kind="goal" 不在封闭集 …}`
   *
   *   ⚠⚠ **它当时必然发现不了**：账本里一个 `goal` 单元都没有 ⇒ R-9 扫过的行全是旧 kind。
   *     等 Hob 真落了 `goal` 数据，它**立刻**响了 —— 这正是本仓那条经验的反面实证：
   *     **有的判据只有等真数据到位才可能红，「当时 check:all 是绿的」≠「这条路验过」。**
   *
   *   ⚠ 值**逐值照抄** `gen-ledger.mjs:218`（⛔ 不是自己设计）：
   *     `goal: { step: null, statuses: ['active','done','retired'], init: 'active',
   *              finals: ['done','retired'], prefix: 'G-' }`
   *   ⇒ 本表只取 `statuses` / `init` / `finals` 三项（`step` / `prefix` 不在本表形状里）。
   *   ⚠ 与 `risk` / `decision` / `evidence` 不同：**`goal` 有终态**（`done` / `retired`），
   *     ⛔ 不许照抄那三行的 `finals: []`。
   */
  goal: { statuses: ['active', 'done', 'retired'], init: 'active', finals: ['done', 'retired'] },
}


/** 三类可分辨失败（`R-10`：⛔ 不许并成一句）。 */
export const STAGES_REASON_INDEX_UNREADABLE = 'index-unreadable'
export const STAGES_REASON_INDEX_MALFORMED = 'index-malformed'
/**
 * ⚠ **2026-11-08 两类新原因**（用户报「面板进度全是判不出」）。
 *
 *   改前这两种情形都落 `index-unreadable`，面板只能说「判不出 + 一段 ENOENT」：
 *     · `ledger/units/` 整个不在 ⇒ 这个项目**还没开账**（该去建）
 *     · 索引是 `[units."ID"]` 旧格式 ⇒ 账本**在，但格式旧**（该去迁移）
 *
 *   ⚠ 它们与"真读坏了"**下一步动作完全不同**，混成一个原因就只能让人猜。
 *   ⚠ 这与 `R-4`（空 ≠ 判不出）是同一条纪律的延伸。
 */
export const STAGES_REASON_LEDGER_MISSING = 'ledger-missing'
export const STAGES_REASON_INDEX_LEGACY = 'index-legacy'
export const STAGES_REASON_ROW_SHAPE_UNKNOWN = 'row-shape-unknown'

/** 一条步内条目（字段**封闭**）。 */
export interface StageItem {
  id: string
  /** 旧客户端兼容字段：默认线格式原样返回；紧凑模式省略。 */
  title?: string
  /** 旧客户端兼容字段：默认线格式原样返回；紧凑模式省略。 */
  extra?: string
  status: string
  kind: string
  /**
   * 紧凑列表投影：自包含主标题、正式关系 ID、最多一条短读数、诊断代码。
   * ⚠ 不含原句、详情或重复的父标题；完整字段由 `/ledger-resource` 按 ID 读取。
   */
  presentation: ItemListPresentation
}

/** 一步。 */
export interface StageRow {
  step: number
  name: string
  state: 'done' | 'doing' | 'todo'
  done: number
  total: number
  items: StageItem[]
}

/** 长期能力（⚠ 无终态、不进分母、无百分比）。 */
export interface CapRow {
  id: string
  title: string
  status: string
  lastReading: string
}

export interface StagesOk {
  ok: true
  readAt: string
  stages: StageRow[]
  caps: CapRow[]
  /**
   * **账本健康**（2026-11-08 · 用户报「旧账本梳理不到完全健康」）。
   *
   * ⚠ 它把"派活为什么被拒"直接搬到面板上：服务端用与门禁**同一个**
   *   `stageControlProblems` + `ledgerClosureProblems` 算出缺口清单，
   *   面板只负责展示（⛔ 不在客户端另算一份，那会两处漂开）。
   * ⚠ 缺口为空**不等于**账本可推进：空账本由 `ledger-missing` / `empty` 那几档说。
   */
  stageHealth?: {
    ok: boolean
    /** 缺口总数（⚠ 紧凑模式下也一定给）。 */
    count: number
    /** 缺口全文（紧凑模式最多 40 条；超出时 `truncated=true` 且 `count` 仍给全量）。 */
    problems?: Array<{ rule: string; unit: string; why: string }>
    /** 缺口是否被截断（⚠ 为 true 时面板必须写"另有 N 条"）。 */
    truncated?: boolean
  }
  /** 「下一步」一条（⚠ 只读呈现，⛔ 不带任何可交互控件）。 */
  next: NextAction
  /**
   * ⚠⚠ **已退役的全局摘要**（2026-11-08 · 当前阶段唯一出口收口）。
   *
   * 改前这里按**全账本**取"第一条未完成步"当当前阶段，而面板主视图按**单条需求链**
   * 取 `currentStep` ⇒ 同一本账有两个"当前阶段"，且算法不同。
   * ⇒ 现在只保留**项目级**的动作 / 等待 / 阻断；`stage` 恒为 `null`。
   *   单条需求的当前阶段**只**由 `/requirement-chains` 的 `currentStep` 提供。
   * ⚠ 字段保留是为了不破坏旧消费者；⛔ 不许再把它渲染成"当前阶段"。
   */
  summary: PanelSummary
  /** 关系标题共享表：每个稳定 ID 只存一份，条目行只引用 ID。 */
  relations: Record<string, string>
  /**
   * **项目组合层**（2026-11-01 P40/R6 · `TASK-R6.md` §三）。
   * ⚠ 只回答"哪条已定需求没人接"；⛔ 不含百分比 / 完成度 / 趋势。
   * ⚠ 算不出来时是 `undefined` ⇒ 面板显示「判不出」，⛔ 不许显示 0、⛔ 不许空白。
   */
  portfolio?: Portfolio
  /**
   * **注意力视图**：只汇总需要人或验收方行动的事项。
   * ⚠ 由 `work-state.ts` 从账本派生，⛔ 不是第六步、⛔ 不等于五步完成度。
   */
  attention?: WorkStateReading[]
  /**
   * **紧凑线截断说明**（2026-11-07 · 只在极端规模触发）。
   * ⚠ 出现它 = 本次响应**没有**列出全部条目；`omitted` 是未随本次返回的条数。
   * ⛔ 不许把它当成"账本只有这些条目" —— 面板必须原样显示这段说明。
   * 缺省 = 全部条目都在（正常情况，线格式与以前逐字节一致）。
   */
  truncated?: { omitted: number; reason: string }
}
export interface StagesFail {
  ok: false
  reason: string
  message: string
}
export type StagesResponse = StagesOk | StagesFail

/**
 * **受限 TOML 子集解析器**（服务端这份；⚠ 与 `scripts/gen-ledger.mjs` 同口径，见文件头）。
 *
 * 只认 `[[unit]]` / `key = "str"` / `key = ["a","b"]`（可跨行）/ 注释 / 空行。
 * ⚠ 不认识的写法 ⇒ **抛错**（⛔ 静默忽略 —— 那会让"写错了"表现为"少一条"）。
 *
 * @param src - 文件全文
 * @returns 单元数组
 */
export function parseUnitsToml(src: string): Array<Record<string, string | string[]>> {
  const out: Array<Record<string, string | string[]>> = []
  let cur: Record<string, string | string[]> | null = null
  let pendingKey: string | null = null
  let pendingBuf = ''
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '' || line.startsWith('#')) continue
    if (line === '[[unit]]') { cur = {}; out.push(cur); continue }
    if (line.startsWith('[')) throw new Error(`第 ${i + 1} 行：不支持的 TOML 表头 ${JSON.stringify(line)}`)
    if (cur === null) throw new Error(`第 ${i + 1} 行：键出现在 [[unit]] 之前`)
    if (pendingKey !== null) {
      pendingBuf += ' ' + line
      if (line.includes(']')) { cur[pendingKey] = parseArr(pendingBuf, i + 1); pendingKey = null; pendingBuf = '' }
      continue
    }
    const eq = line.indexOf('=')
    if (eq < 0) throw new Error(`第 ${i + 1} 行：不是 key = value：${JSON.stringify(line)}`)
    const key = line.slice(0, eq).trim()
    const val = line.slice(eq + 1).trim()
    if (val.startsWith('[') && !val.includes(']')) { pendingKey = key; pendingBuf = val; continue }
    if (val.startsWith('"')) cur[key] = parseStr(val, i + 1)
    else if (val.startsWith('[')) cur[key] = parseArr(val, i + 1)
    else throw new Error(`第 ${i + 1} 行：只支持 "字符串" 与 ["数组"]：${JSON.stringify(val)}`)
  }
  if (pendingKey !== null) throw new Error(`文件末尾有多行数组没有闭合：${pendingKey}`)
  return out
}

function parseStr(v: string, lineNo: number): string {
  const m = /^"((?:[^"\\]|\\.)*)"\s*$/.exec(v)
  if (m === null) throw new Error(`第 ${lineNo} 行：字符串格式不对：${JSON.stringify(v)}`)
  return m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

function parseArr(v: string, lineNo: number): string[] {
  const m = /^\[(.*)\]\s*$/s.exec(v)
  if (m === null) throw new Error(`第 ${lineNo} 行：数组格式不对：${JSON.stringify(v)}`)
  const body = m[1].trim()
  if (body === '') return []
  const items: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"\s*(?:,|$)/g
  let hit: RegExpExecArray | null
  let consumed = 0
  while ((hit = re.exec(body)) !== null) {
    items.push(hit[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'))
    consumed = re.lastIndex
  }
  if (body.slice(consumed).replace(/[,\s]/g, '') !== '') {
    throw new Error(`第 ${lineNo} 行：数组里有解析不了的内容：${JSON.stringify(body.slice(consumed))}`)
  }
  return items
}

/**
 * 汇总一步的三态（⚠ 与 `DESIGN-V2.md` §四 逐条一致）。
 *
 * @param statuses - 该步所有条目的状态
 * @param kind - kind（取 init / finals）
 * @returns `{ state, done, total }`
 */
export function summarizeStage(statuses: string[], kind: string): { state: 'done' | 'doing' | 'todo'; done: number; total: number } {
  const spec = STAGE_KIND_STATUSES[kind]
  const total = statuses.length
  const done = statuses.filter((s) => spec.finals.includes(s)).length
  if (total === 0) return { state: 'todo', done: 0, total: 0 }
  const nonInit = statuses.filter((s) => s !== spec.init).length
  if (nonInit === 0) return { state: 'todo', done, total }
  if (done === total) return { state: 'done', done, total }
  return { state: 'doing', done, total }
}

/** 取一条单元里“旧客户端看的那点附加读数”（紧凑模式不返回）。 */
function extraOf(u: Record<string, unknown>): string {
  const pick = (k: string): string => (typeof u[k] === 'string' ? String(u[k]) : '')
  switch (u.kind) {
    case 'req': return pick('spec')
    case 'change': return pick('proposal')
    case 'task': return pick('verify') !== '' ? pick('verify') : pick('built_by')
    case 'run': return pick('started_at') !== '' ? pick('started_at') : pick('why')
    case 'acc': return pick('actor')
    case 'cap': return pick('last_reading')
    default: return ''
  }
}

/**
 * 把单元数组渲染成线格式（⚠ 五步**顺序固定**，空步也要出现且给 `todo`）。
 *
 * @param units - 单元数组
 * @param readAt - ISO 时刻
 * @returns 线格式响应
 */
export function buildStages(
  units: Array<Record<string, unknown>>,
  readAt: string,
  opts: { compact?: boolean } = {},
): StagesOk {
  const stages: StageRow[] = STAGE_DEFS.map((d) => {
    /**
     * ⚠ `retired` / `dropped` 只保留为生命周期历史，⛔ 不再进入活跃需求步；
     * 否则面板会把“已退役”计入需求完成数，并把它当当前工作继续提示。
     */
    const ofKind = units.filter((u) => u.kind === d.kind
      && !(d.kind === 'req' && ['retired', 'dropped'].includes(String(u.status))))
    const { state, done, total } = summarizeStage(ofKind.map((u) => String(u.status)), d.kind)
    return {
      step: d.step,
      name: d.name,
      state,
      done,
      total,
      items: ofKind.map((u) => ({
        id: String(u.id ?? ''),
        ...(opts.compact === true ? {} : { title: String(u.title ?? ''), extra: extraOf(u) }),
        status: String(u.status ?? ''),
        kind: d.kind,
        presentation: listPresentationOf(u as any, units as any),
      })),
    }
  })
  const caps: CapRow[] = units.filter((u) => u.kind === 'cap').map((u) => ({
    id: String(u.id ?? ''),
    title: String(u.title ?? ''),
    status: String(u.status ?? ''),
    // ⚠ 缺 last_reading ⇒ 「判不出」，⛔ 不填 0、⛔ 不编
    lastReading: typeof u.last_reading === 'string' && u.last_reading.trim() !== ''
      ? String(u.last_reading)
      : '判不出（索引里没有 last_reading）',
  }))
  /**
   * ── **下一步**（2026-10-31 P42/R4 · `TASK-R4.md` §四）────────────────────
   * ⚠ 纯函数 `nextAction`（`./next-action.ts`）算出**一条**建议；面板只**只读地**显示它。
   * ⚠ 收敛判定这里**不注入**：`convergenceOf` 活在判据脚本里，import 它会把
   *   `scripts/**` 拖进 client 半边（⛔ 那边跑不了 `node:fs`）。
   *   ⇒ 第 ③ 步（`converge`）在本进程里**跳过**，其余五态照常。
   *   ⚠ 这是**已知覆盖缺口**，不是"没有这个态"—— `NEXT_ACTION_KINDS` 六态全在。
   */
  let next: NextAction
  try {
    /**
     * ⚠⚠ **注入收敛判定**（2026-10-31 P42b/R4b · `TASK-R4b.md` §一.3）：
     *   不注入 ⇒ `nextAction` 的第 ③ 步（`converge`）**整段跳过** ⇒ 六态里有一态
     *   在面板侧永远不出现（这正是 R4 验收指出的"六件里 A 只算一半"）。
     *
     * ⚠ `exemptReqIds` **传空**（⚠ `TASK-R4b.md` §一.3 明写这一条）：
     *   `STORED_NO_NEW_FIELD` 那份豁免名单住在 `scripts/check-ledger.mjs`（判据侧），
     *   ⛔ **不许把它搬进 `src/`** —— 那是判据的账，不是面板的账。
     *   ⇒ 后果：**面板侧不豁免 ⇒ 第 ④ 步可能比判据侧多报一条** `wait-user`。
     *     ⚠ 这是**已知差异**，不是 bug：面板说的是"按账本原样看该干什么"，
     *       判据说的是"按已认下的豁免看还欠什么"。
     */
    next = nextAction(units as unknown as LedgerUnitLike[], {
      convergence: (chg: any) => convergenceOf(chg, units as any),
      exemptReqIds: [],
    })
  } catch (e) {
    /**
     * ⚠ 算不出来 ⇒ **判不出**（⛔ 不许静默回 dispatch、⛔ 不许显示成空）。
     *   这符合 `TASK-R4.md` §一 ⑥ 与 §四「undecidable 时明写判不出」。
     */
    next = {
      kind: 'undecidable',
      target: null,
      why: `下一步算不出来：${String((e as Error)?.message ?? e)}`,
      blockedBy: [],
    }
  }
  /**
   * ── **项目组合层**（2026-11-01 P40/R6 · `TASK-R6.md` §三）──────────────────
   * ⚠ 纯函数 `portfolioOf`（`./portfolio.ts`）算出跨 change 的覆盖读数；面板只**只读地**显示。
   * ⚠ 它**零 import**（同 `convergence.ts` 的硬约束）⇒ 不会把 `scripts/**` 拖进 client 半边。
   * ⚠ 算不出来 ⇒ `undefined`（面板显示「判不出」），⛔ **不许兜底成 0 条** ——
   *   0 条孤儿是一条**读数**，算不出来是**没有读数**，两者不是一回事（`CONSTITUTION` §7）。
   */
  let portfolio: Portfolio | undefined
  try {
    portfolio = portfolioOf(units as unknown as PortfolioUnit[])
  } catch { portfolio = undefined }
  let attention: WorkStateReading[] | undefined
  try {
    const byParent = new Map<string, Array<Record<string, unknown>>>()
    for (const u of units) {
      const parent = String(u.parent ?? '')
      if (parent === '') continue
      const list = byParent.get(parent) ?? []
      list.push(u)
      byParent.set(parent, list)
    }
    attention = attentionOf(
      units.filter((u) => ['req', 'task', 'run', 'acc'].includes(String(u.kind))) as any,
      byParent as any,
    )
  } catch {
    /** 算不出 ⇒ 缺字段（面板明写判不出），⛔ 不兜底为空数组冒充“没事”。 */
    attention = undefined
  }
  const visibleAttention = attention === undefined
    ? undefined
    : attentionAfterMainAction(attention, next, units)
  const out: StagesOk = {
    ok: true, readAt, stages, caps, next,
    /**
     * ⚠ `stages: []` ⇒ `summary.stage === null`：项目级摘要不再回答"当前在第几步"。
     *   动作 / 等待 / 主阻断仍从同一个 `next` 派生（与面板一致）。
     */
    summary: panelSummaryOf({ stages: [], next, attention: visibleAttention }),
    relations: relationTitlesOf(units as any),
    portfolio,
    ...(visibleAttention === undefined ? {} : { attention: visibleAttention }),
    /**
     * ⚠ **健康清单**（2026-11-08）：字段门禁 + 闭环判据，与派活门禁**同一份函数**。
     *
     * ⚠⚠ **只在非紧凑模式给**：真机实测，极端规模（数千单元）时把每条缺口全文塞进
     *   主响应会让整包从 65 KB 涨到 **347 KB**（`R-18d` 当场红）。
     *   ⇒ 紧凑模式（列表本身已截断）只给**计数**；全文由面板按需另取
     *     （`stageHealth.problems` 缺省 = 本次没随响应返回，⛔ 不是"没有缺口"）。
     *   ⚠ 算不出来（异常）⇒ 整个字段缺席 ⇒ 面板不显示这一块，
     *     ⛔ 不许兜底成"健康"（那是把判不出读成没事）。
     */
    ...(() => {
      try {
        const cast = units as unknown as StageControlUnit[]
        const all = [...stageControlProblems(cast), ...ledgerClosureProblems(cast)]
          .map((p) => ({ rule: String(p.rule), unit: String(p.unit), why: String(p.why) }))
        /**
         * ⚠ 紧凑模式也带**前 40 条**全文（缺口通常只有几条，代价可忽略）；
         *   超出部分只给计数 —— 实测极端规模下全文塞进主响应会把整包顶到 347 KB。
         *   ⚠ `truncated=true` 时面板必须说"另有 N 条"，⛔ 不许看起来只有这些。
         */
        const cap = opts.compact === true ? 40 : all.length
        return {
          stageHealth: {
            ok: all.length === 0,
            count: all.length,
            ...(all.length > cap ? { truncated: true } : {}),
            problems: all.slice(0, cap),
          },
        }
      } catch { return {} }
    })(),
  }
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **紧凑线体积兜底**（2026-11-07 · 方案 §七「响应体变大」的落点）
   * ══════════════════════════════════════════════════════════════════════════
   * 病灶：`compact` 只去掉旧 `title` / `extra`，条目数一多仍会顶破 64 KB。
   * 出口判据（`check:tasks-route-http` H-6）是硬上限，越界即红；
   * 但账本条目只会增加 ⇒ 不兜底就是"迟早会红"。
   *
   * 处置（**只减可从展开详情复得的计数读数，⛔ 不删主行/关系/判决**）：
   *   ① 先删「依据 N 条」「需求映射 N 条」「承接需求 N 条」这类**纯计数**；
   *     它们的实际内容本来就在 `/ledger-resource` 的展开详情里。
   *   ② 仍超 ⇒ 把每个条目的读数压到最多 1 条（主行仍保留"判决"这类结论）。
   *   ⚠ 判决格**永不删**：验收条目没有判决就等于没给结论。
   *   ⚠ 这是**确定性**降级（同一输入同输出），且只在超预算时触发；
   *     不超预算时线格式与以前逐字节一致。
   */
  if (opts.compact === true) {
    const LIMIT = 65536
    /**
     * ⚠ 本模块是**两端共用**的纯函数（client 半边也 import）⇒ ⛔ 不能用 `Buffer`。
     *   UTF-8 字节数按码点手算：ASCII 1、两字节 2、其余 3（代理对按 4）。
     *   ⚠ 这是**保守估算**（可能略大于真实值 ⇒ 更早触发降级，⛔ 不会放过越界）。
     */
    const utf8Bytes = (s: string): number => {
      let n = 0
      for (const ch of s) {
        const cp = ch.codePointAt(0) ?? 0
        n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
      }
      return n
    }
    const bytesOf = (v: unknown): number => utf8Bytes(JSON.stringify(v))
    /**
     * ⚠⚠ **降级顺序在 2026-11-07 R-020 收口时改过一次**，原因有实测：
     *   旧顺序先删「依据」⇒ 紧凑响应里 66 条验收只剩「判决」一格，
     *   用户只看折叠行就少了"这个判决有没有依据"这一维；而实测体积 **63618 B**，
     *   离 65536 B 只有 1918 B，**根本不需要**动验收的两条固定读数。
     *
     * 现行顺序（确定性，且尽量保住"结论型读数"）：
     *   ① 先压**关系标题共享表**（`relations` 是纯展示标题，完整标题可按 ID 读回）；
     *   ② 再删普通条目的纯计数第二格（映射 N 条 / 验收条件 N 条 …）；
     *   ③ 仍超才把**非验收**条目压到一格；验收固定保留「判决 + 依据」；
     *   ④ 最后才截断条目。
     *
     * ⚠⚠ **验收的「依据」也是受保护格**（2026-11-08 独立验收实测）：
     *   旧实现把 `basis_count` 当纯计数删掉 ⇒ 真实紧凑响应里 66 条验收只剩「判决」，
     *   用户只看折叠行就不知道判决有没有依据（H-6 实测红）。
     *   依据条数本身是**结论的一部分**，不是可丢弃的装饰；完整依据内容仍在展开详情。
     *   ⚠ 验收条目在 202 条真实账本里占 66 条 ⇒ 保两格约多 1.5 KB；
     *     这 1.5 KB 从普通条目的第二格腾出来，⛔ 不许因此把条目截掉。
     */
    if (bytesOf(out) > LIMIT) {
      for (const [id, title] of Object.entries(out.relations ?? {})) {
        if (typeof title === 'string' && title.length > 24) out.relations[id] = `${title.slice(0, 23)}…`
      }
    }
    if (bytesOf(out) > LIMIT) {
      /**
       * ⚠ `basis_count` **不在此列**：它是验收条目的固定第二格（判决 + 依据）。
       *   其余计数都可在展开详情按 ID 复得，删掉只损失折叠行的密度。
       */
      const countOnly = new Set(['coverage', 'addresses_count', 'acceptance_count', 'example_count', 'progress_count', 'scope_count'])
      for (const row of out.stages) {
        for (const it of row.items) {
          const facts = (it.presentation as any)?.facts
          if (!Array.isArray(facts)) continue
          /** ⚠ 验收的「判决 + 依据」是固定两格，⛔ 不在这一档删。 */
          if (String(it?.kind ?? '') === 'acc') continue
          const kept = facts.filter((f: any) => !countOnly.has(String(f?.[0] ?? '')))
          if (kept.length !== facts.length) (it.presentation as any).facts = kept
        }
      }
    }
    if (bytesOf(out) > LIMIT) {
      for (const row of out.stages) {
        for (const it of row.items) {
          const facts = (it.presentation as any)?.facts
          if (!Array.isArray(facts) || facts.length <= 1) continue
          /** ⚠ 验收固定两格；其余条目才压到一格。 */
          if (String(it?.kind ?? '') === 'acc') continue
          /**
           * ⚠ 非验收条目压到一格：保留第一条（各 kind 的首条都是结论型读数）。
           *   验收条目在上面已跳过，仍固定「判决 + 依据」。
           */
          ;(it.presentation as any).facts = facts.slice(0, 1)
        }
      }
    }
    /**
     * ③ 仍超 ⇒ 只压**关系标题共享表**里的展示标题（⛔ 不动条目主标题，避免读不懂）。
     *   ⚠ 关系行同时显示 `ID · 标题`，ID 已能定位对象；标题过长时截断仍可读，
     *     完整标题在展开详情里由 `/ledger-resource` 给出。
     */
    if (bytesOf(out) > LIMIT) {
      const relIds = Object.keys(out.relations)
      for (const id of relIds) {
        const t = String(out.relations[id] ?? '')
        if (t.length > 24) out.relations[id] = `${t.slice(0, 23)}…`
        if (bytesOf(out) <= LIMIT) break
      }
    }
    /**
     * ③b **仍超 ⇒ 把共享关系标题压到 16 字**（⛔ 不截条目、⛔ 不压主标题、⛔ 不碰验收两格）。
     *
     * ⚠⚠ 病灶（2026-11-08 独立验收实测）：保验收「依据」后 202 条真实账本约
     *   66.9 KB；若直接进 ④ 截断，会丢掉最后 4 条（含 ACC-064）。
     *   `relations` 共 80 项、约 5.4 KB；它只是**父对象的展示标题**，
     *   关系 ID 已在每条主行上，完整标题仍可按 ID 读取。
     *   ⇒ 压这一层既保住全部条目，也不改用户看到的主标题（R-18c 要求完整）。
     *   ⚠ 从长到短压（最长的先让位），确定性排序，同一输入同输出。
     */
    if (bytesOf(out) > LIMIT) {
      const rels = Object.entries(out.relations ?? {})
        .filter(([, t]) => typeof t === 'string' && t.length > 16)
        .sort((a, b) => b[1].length - a[1].length)
      for (const [id, t] of rels) {
        out.relations[id] = `${String(t).slice(0, 15)}…`
        if (bytesOf(out) <= LIMIT) break
      }
    }
    /**
     * ④ 仍超 ⇒ **按阶段末尾截断**，并**如实标注**未返回条数。
     *   ⚠ 极端规模（数百条以上）下，条目本身约 270 B/条 ⇒ 单次 64 KB 装不下；
     *     此时宁可少列并说清楚，⛔ 不许超预算静默返回（那会让客户端拿到被截断的 JSON）。
     *   ⚠ 截断**从最后一阶段末尾往前收**，前面的阶段保持完整；`total` / `done` 仍是**全账本**读数，
     *     所以阶段计数不会被截断影响（⛔ 不能把"没列出来"读成"不存在"）。
     */
    if (bytesOf(out) > LIMIT) {
      /**
       * ③b 先收**注意力清单**（它是"需要人行动的事项"汇总，可随条目重算）：
       *   ⚠ 只留前若干条，并保持顺序；⛔ 不把空数组当成"没有事项"（那要由 `attention` 缺省表达）。
       */
      if (Array.isArray(out.attention) && out.attention.length > 0) {
        while (out.attention.length > 1 && bytesOf(out) > LIMIT) out.attention.pop()
      }
    }
    if (bytesOf(out) > LIMIT) {
      /**
       * ⚠ 逐条从**最后一个阶段末尾**往前收；收完仍超就继续收前一个阶段。
       *   ⚠ 收空的行**整行去掉**（⛔ 不留 `items: []` 的空壳：那既不省字节，
       *     又会让面板显示一个"这个阶段什么都没有"的假象）。
       *   ⚠ 阶段 `done/total` 保持**全账本**读数，⛔ 不因截断改写。
       */
      let omitted = 0
      /**
       * ⚠ `truncated` 说明本身也占字节 ⇒ **先占位再收紧**，否则会差几十字节仍然越界
       *   （实测：不加占位时收到最后一条仍 65637 B > 65536 B）。
       *   ⚠ 文案保持**短**：面板只需要知道"少了多少、去哪拿完整内容"。
       */
      const markTruncated = (n: number): void => {
        ;(out as any).truncated = { omitted: n, reason: '超 64 KB 已截断；完整内容按 ID 读取' }
      }
      markTruncated(0)
      for (let s = out.stages.length - 1; s >= 0 && bytesOf(out) > LIMIT; s--) {
        const row = out.stages[s]!
        while (row.items.length > 0 && bytesOf(out) > LIMIT) {
          row.items.pop()
          omitted += 1
          markTruncated(omitted)
        }
        /**
         * ⚠ **阶段行必须留下**：`done/total` 是全账本读数，删掉整行会让
         *   "这个阶段有 200 条"变成"没有这个阶段"（R-18d 实测抓到）。
         *   ⇒ 只清空 `items`，阶段名 / 分母原样保留。
         */
      }
      markTruncated(omitted)
    }
  }
  return out
}

/** 处理体依赖（全部注入 ⇒ 机检可跑真源码）。 */
export interface StagesDeps {
  /**
   * **账本根**（P4 起索引住这里；字段名保留 `workRootOf` 只为不破既有调用，
   * ⚠ 语义已改为「路径基准根」，见 {@link STAGES_INDEX_REL}）。缺 ⇒ `index-unreadable`。
   */
  workRootOf: (sessionId: string) => string | undefined
  workRootWhyOf?: (sessionId: string) => string
  /** 索引稳定入口绝对路径（默认 `<workRoot>/ledger/units/index.toml`） */
  indexPathOf?: (workRoot: string) => string
  /**
   * 同目录固定分片路径（`unit-*.toml`，已排序）。
   * ⚠ 缺省 ⇒ 只读 `index.toml`，保持夹具与旧账本兼容。
   */
  unitShardPathsOf?: (unitsDir: string) => string[]
  /** 读文本；`undefined` = 文件不存在；抛错 = 读失败 */
  readText?: (absPath: string) => string | undefined
  now?: () => Date
}

/**
 * 索引稳定入口的**相对落点**（⚠ 单一真源，服务端与机检都从这里取）。
 *
 * ⚠⚠ **2026-10-30 P4：它相对的是「账本根」**（改前是工作区根）。
 *   P3 时 `ledger/` 是源仓内目录 ⇒ 只有实施侧能维护它 ⇒ **Hob 改不动新账本**。
 *   P4 把它整树搬进账本区（`<ledgerHome>/<工作区名>/ledger/`）⇒ 索引与写面同源。
 *   ⛔ **不再把工作区根当备选** —— 两处真相必然漂。
 */
export const STAGES_INDEX_REL = 'ledger/units/index.toml'

/**
 * 一条请求的处理体。
 *
 * @param deps - 依赖
 * @param body - 已解析请求体
 * @returns 线格式响应
 */
export function handleStages(deps: StagesDeps, body: any): StagesResponse {
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
  const nowFn = deps.now ?? (() => new Date())
  let root: string | undefined
  try { root = deps.workRootOf(sessionId) } catch { root = undefined }
  if (root === undefined || root === '') {
    const why = (() => { try { return deps.workRootWhyOf?.(sessionId) ?? '' } catch { return '' } })()
    return {
      ok: false,
      reason: STAGES_REASON_INDEX_UNREADABLE,
      message: `账本根判不出 ⇒ 不知道该读哪份索引（⛔ 不猜）${why === '' ? '' : `：${why}`}`,
    }
  }
  const abs = (deps.indexPathOf ?? ((r: string) => `${r}/${STAGES_INDEX_REL}`))(root)
  const read = deps.readText
  if (typeof read !== 'function') {
    return { ok: false, reason: STAGES_REASON_INDEX_UNREADABLE, message: '调用方没有注入 `readText`（⛔ 不猜索引内容）' }
  }
  const unitsDir = abs.replace(/[\\/]index\.toml$/, '')
  let extraPaths: string[] = []
  try {
    extraPaths = deps.unitShardPathsOf?.(unitsDir) ?? []
  } catch (e) {
    /**
     * ⚠ `ENOENT` = **`ledger/units/` 根本不在** ⇒ 「还没开账」，⛔ 不是"索引坏了"。
     *   两者给同一句话，读的人只能猜（这正是用户报「全是判不出」的来源之一）。
     */
    if ((e as { code?: string } | undefined)?.code === 'ENOENT') {
      return {
        ok: false,
        reason: STAGES_REASON_LEDGER_MISSING,
        message: `这个项目还没有账本（\`${unitsDir}\` 不存在）⇒ 先建账本，再看进度。`,
      }
    }
    return {
      ok: false,
      reason: STAGES_REASON_INDEX_UNREADABLE,
      message: `索引分片列不出（${unitsDir}）：${String((e as Error)?.message ?? e)}`,
    }
  }
  const sourcePaths = [abs, ...extraPaths]
  const sources: string[] = []
  for (const path of sourcePaths) {
    let text: string | undefined
    try { text = read(path) } catch (e) {
      return {
        ok: false,
        reason: STAGES_REASON_INDEX_UNREADABLE,
        message: `索引读不到（${path}）：${String((e as Error)?.message ?? e)}`,
      }
    }
    if (text === undefined) {
      /** ⚠ 入口 `index.toml` 缺 = 还没开账；分片缺 = 账本在但残了（两种不同）。 */
      if (path === abs) {
        return {
          ok: false,
          reason: STAGES_REASON_LEDGER_MISSING,
          message: `这个项目还没有账本入口（\`${path}\` 不存在）⇒ 先建账本，再看进度。`,
        }
      }
      return {
        ok: false,
        reason: STAGES_REASON_INDEX_UNREADABLE,
        message: `索引文件不存在：\`${path}\` —— ⚠ 这通常意味着这个工作区还没建 \`ledger/\`，⛔ 不是文件坏了`,
      }
    }
    sources.push(text)
  }
  const src = sources.join('\n')
  let units: Array<Record<string, unknown>>
  try {
    units = parseUnitsToml(src) as Array<Record<string, unknown>>
  } catch (e) {
    /**
     * ⚠ **旧格式**（`[meta]` / `[units."ID"]`）与"真写坏了"必须分开：
     *   旧格式是**已知的、可迁移的**形态 ⇒ 说清"迁移"，⛔ 不要让人以为账本坏了。
     */
    const msg = String((e as Error)?.message ?? e)
    const legacy = /不支持的 TOML 表头\s*"\[(?:meta|units)/.test(msg)
    if (legacy) {
      return {
        ok: false,
        reason: STAGES_REASON_INDEX_LEGACY,
        message: '这本账是旧格式（`[meta]` / `[units."ID"]`），现行面板读不进来 ⇒ 需要按现行 `[[unit]]` 格式迁移。',
      }
    }
    return {
      ok: false,
      reason: STAGES_REASON_INDEX_MALFORMED,
      message: `索引不是合法 TOML 子集：${msg}`,
    }
  }
  /**
   * ⚠ 形态核：`kind` 必须在封闭集里、`status` 必须属于该 kind。
   *   ⇒ 任一条不认识 = `row-shape-unknown`（⛔ 不许静默跳过那一条，否则面板会"看起来少一条"）。
   */
  const badRows = units.flatMap((u) => shapeProblemsOf(u))
  if (badRows.length > 0) {
    return {
      ok: false,
      reason: STAGES_REASON_ROW_SHAPE_UNKNOWN,
      message: `有 ${badRows.length} 条单元的形态不认识：${badRows.slice(0, 5).join(' / ')}`
        + (badRows.length > 5 ? ` …另有 ${badRows.length - 5} 条` : ''),
    }
  }
  return buildStages(units, nowFn().toISOString(), { compact: body?.compact === true })
}
