/**
 * **`ledger-next/units/index.toml` → 五步汇总 + cap 单列**（纯函数，零 I/O）—— 2026-10-30 · P3。
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
  req: { statuses: ['draft', 'agreed', 'dropped'], init: 'draft', finals: ['agreed', 'dropped'] },
  change: { statuses: ['proposed', 'settled', 'superseded'], init: 'proposed', finals: ['settled', 'superseded'] },
  task: { statuses: ['todo', 'doing', 'built'], init: 'todo', finals: ['built'] },
  run: { statuses: ['registered', 'running', 'returned', 'refused', 'stuck'], init: 'registered', finals: ['returned', 'refused', 'stuck'] },
  acc: { statuses: ['pass', 'send-back', 'unverified'], init: 'unverified', finals: ['pass', 'send-back'] },
  cap: { statuses: ['live', 'degraded', 'down'], init: 'live', finals: [] },
}

/** 三类可分辨失败（`R-10`：⛔ 不许并成一句）。 */
export const STAGES_REASON_INDEX_UNREADABLE = 'index-unreadable'
export const STAGES_REASON_INDEX_MALFORMED = 'index-malformed'
export const STAGES_REASON_ROW_SHAPE_UNKNOWN = 'row-shape-unknown'

/** 一条步内条目（字段**封闭**）。 */
export interface StageItem {
  id: string
  title: string
  status: string
  /** 附加读数（`task` 的 `verify` / `run` 的 `started_at` / `acc` 的 `actor` …）。判不出 ⇒ 空串。 */
  extra: string
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

/** 取一条单元里"给人看的那点附加读数"（每个 kind 一条，判不出 ⇒ 空串）。 */
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
export function buildStages(units: Array<Record<string, unknown>>, readAt: string): StagesOk {
  const stages: StageRow[] = STAGE_DEFS.map((d) => {
    const ofKind = units.filter((u) => u.kind === d.kind)
    const { state, done, total } = summarizeStage(ofKind.map((u) => String(u.status)), d.kind)
    return {
      step: d.step,
      name: d.name,
      state,
      done,
      total,
      items: ofKind.map((u) => ({
        id: String(u.id ?? ''),
        title: String(u.title ?? ''),
        status: String(u.status ?? ''),
        extra: extraOf(u),
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
  return { ok: true, readAt, stages, caps }
}

/** 处理体依赖（全部注入 ⇒ 机检可跑真源码）。 */
export interface StagesDeps {
  /**
   * **账本根**（P4 起索引住这里；字段名保留 `workRootOf` 只为不破既有调用，
   * ⚠ 语义已改为「路径基准根」，见 {@link STAGES_INDEX_REL}）。缺 ⇒ `index-unreadable`。
   */
  workRootOf: (sessionId: string) => string | undefined
  workRootWhyOf?: (sessionId: string) => string
  /** 索引文件绝对路径（默认 `<workRoot>/ledger-next/units/index.toml`） */
  indexPathOf?: (workRoot: string) => string
  /** 读文本；`undefined` = 文件不存在；抛错 = 读失败 */
  readText?: (absPath: string) => string | undefined
  now?: () => Date
}

/**
 * 索引的**相对落点**（⚠ 单一真源，服务端与机检都从这里取）。
 *
 * ⚠⚠ **2026-10-30 P4：它相对的是「账本根」**（改前是工作区根）。
 *   P3 时 `ledger-next/` 是源仓内目录 ⇒ 只有实施侧能维护它 ⇒ **Hob 改不动新账本**。
 *   P4 把它整树搬进账本区（`<ledgerHome>/<工作区名>/ledger-next/`）⇒ 索引与写面同源。
 *   ⛔ **不再把工作区根当备选** —— 两处真相必然漂。
 */
export const STAGES_INDEX_REL = 'ledger-next/units/index.toml'

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
  let src: string | undefined
  try { src = read(abs) } catch (e) {
    return {
      ok: false,
      reason: STAGES_REASON_INDEX_UNREADABLE,
      message: `索引读不到：${String((e as Error)?.message ?? e)}`,
    }
  }
  if (src === undefined) {
    return {
      ok: false,
      reason: STAGES_REASON_INDEX_UNREADABLE,
      message: `索引文件不存在：\`${abs}\` —— ⚠ 这通常意味着这个工作区还没建 \`ledger-next/\`，⛔ 不是文件坏了`,
    }
  }
  let units: Array<Record<string, unknown>>
  try {
    units = parseUnitsToml(src) as Array<Record<string, unknown>>
  } catch (e) {
    return {
      ok: false,
      reason: STAGES_REASON_INDEX_MALFORMED,
      message: `索引不是合法 TOML 子集：${String((e as Error)?.message ?? e)}`,
    }
  }
  /**
   * ⚠ 形态核：`kind` 必须在封闭集里、`status` 必须属于该 kind。
   *   ⇒ 任一条不认识 = `row-shape-unknown`（⛔ 不许静默跳过那一条，否则面板会"看起来少一条"）。
   */
  const badRows: string[] = []
  for (const u of units) {
    const id = String(u.id ?? '(无 id)')
    const kind = String(u.kind ?? '')
    const spec = STAGE_KIND_STATUSES[kind]
    if (spec === undefined) { badRows.push(`${id}: kind=${JSON.stringify(kind)} 不在封闭集`); continue }
    if (!spec.statuses.includes(String(u.status))) {
      badRows.push(`${id}: status=${JSON.stringify(u.status)} 不属于 kind=${kind}`)
    }
  }
  if (badRows.length > 0) {
    return {
      ok: false,
      reason: STAGES_REASON_ROW_SHAPE_UNKNOWN,
      message: `有 ${badRows.length} 条单元的形态不认识：${badRows.slice(0, 5).join(' / ')}`
        + (badRows.length > 5 ? ` …另有 ${badRows.length - 5} 条` : ''),
    }
  }
  return buildStages(units, nowFn().toISOString())
}
