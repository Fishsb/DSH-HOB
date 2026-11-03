/**
 * **LEGACY · 五步主线进度表的解析与归一**（纯函数，无 I/O）。
 *
 * ⚠ 权威五步汇总使用 `POST /api/dsh-hob/stages` 与
 *   `ledger/units/`（`index.toml` 导航 + `unit-*.toml` 分片）。本模块只服务旧 `tasks-progress`
 *   兼容路由，⛔ 不新增消费者。
 *
 * ══ 数据来源唯一 ═══════════════════════════════════════════════════════════
 *   账本区 `volumes/tasks/INDEX.md` 里那张 `|` 表格。⛔ 不读别处、⛔ 不猜。
 *   ⚠ 步数 = **五步**（`需求规格` / `实现方案` / `编码任务` / `任务执行` / `验收核对`）。
 *
 * ══ 为什么单独成文件（`R-10`：三类失败必须可分辨）════════════════════════════
 *   "读不到账本" / "表不存在或形态不认识" / "某一行形态不认识" 是**三种不同的病**，
 *   修法完全不同（查配置 / 查账本结构 / 查那一行）。⛔ 不许并成一句"读取失败"。
 *   ⇒ 本文件把它们分成三个 reason 常量，调用方（路由）原样透出。
 *
 * ══ `step` 只许七个值（封闭集，⛔ 不许加第八个）═════════════════════════════
 *   `'1' | '2' | '3' | '4' | '5' | 'done' | 'unfilled' | 'unknown'`
 *   ⚠ `'unknown'` 是**合法结果**（判不出就是判不出），⛔ 不许把判不出的塞成 `'1'`。
 *   ⚠ 越界（账本里写了第 6 步这种）⇒ **报错**，⛔ 不许兜底成 `'unknown'`。
 *
 * ══ 边界 ═════════════════════════════════════════════════════════════════
 *   · 只解析**第一张**表头首格为 `编号` 的表；找不到 ⇒ `table-missing`。
 *   · `rows` **保持表里的行序**，⛔ 不重排、⛔ 不去重（任务书 §3.1 明令）。
 *   · ⛔ 本文件不算任何"完成度/百分比" —— 那是被用户明确否掉的东西。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * **八值封闭集**（2026-10-29 用户裁定：四步 → 五步，`CHG-223` / `CHG-224`）。
 *
 *   `'1' | '2' | '3' | '4' | '5' | 'done' | 'unfilled' | 'unknown'`
 *
 * ⚠⚠ 两条口径（用户裁定，⛔ 不许合并）：
 *   · **`'5'` = 在做验收**（第 5 步「验收核对」正在进行）；
 *   · **`'done'` = 已验收通过**（终态）。
 *   两者**不是一回事**：把 `'5'` 显示成"完成"就是把"在验"说成"验过了"。
 * ⚠ 第 5 步的状态**只能由规划侧按原始读数判**；⛔ 实施方自报"完成了"不算数
 *   —— 那正是 `'5'` 与 `'done'` 必须分开、且不许由被验方自己填的原因。
 * ⚠ 服务端只会输出这八个值；读到**这八个以外**的值 ⇒ **报错**（见
 *   {@link TASKS_REASON_ROW_SHAPE_UNKNOWN}），⛔ 不许兜底成 `'unknown'`、
 *   ⛔ 更不许映射成 `'1'`。
 */
export type TasksProgressStep = '1' | '2' | '3' | '4' | '5' | 'done' | 'unfilled' | 'unknown'

/** 三类的可分辨失败原因（`R-10`）。 */
export const TASKS_REASON_LEDGER_UNREADABLE = 'ledger-unreadable'
export const TASKS_REASON_TABLE_MISSING = 'table-missing'
export const TASKS_REASON_ROW_SHAPE_UNKNOWN = 'row-shape-unknown'
export type TasksProgressReason =
  | typeof TASKS_REASON_LEDGER_UNREADABLE
  | typeof TASKS_REASON_TABLE_MISSING
  | typeof TASKS_REASON_ROW_SHAPE_UNKNOWN

/** 一行进度（字段名与线格式逐字一致）。 */
export interface TasksProgressRow {
  /** 第一列原文（去掉包裹用的 `**` 与反引号后的人读名）。 */
  name: string
  step: TasksProgressStep
  /** 第三列原文（`—` / `-` / 空 ⇒ 空串）。 */
  blockedBy: string
}

/** 五步名（图例用；⛔ 不从网络/配置取 —— 定死的常量；顺序定死为 1→5）。 */
export const TASKS_STEP_NAMES = ['需求规格', '实现方案', '编码任务', '任务执行', '验收核对'] as const

/**
 * 把一格状态文本归一成七值之一。
 *
 * ⚠ **只认账本 `volumes/tasks/INDEX.md` 头部声明的那套写法**
 *   （该文件 `:5` 原文：`1 需求规格` / `2 实现方案` / `3 编码任务` / `4 任务执行` / `✅ 验收完成`；
 *    `:6` 约定"没回填的写`未回填`"）。
 *
 * @param cell - 表格第二列原文
 * @returns 八值之一；判不出 ⇒ `'unknown'`（⛔ 不猜 `'1'`）
 */
/**
 * **步号 → step 值**的唯一映射表。
 *
 * ⚠ 单独抽成常量（而不是散在正则里）有两个理由：
 *   ① 判据要对它做**负向对拍**（改 `'4'` 的映射 ⇒ 测试必须变红）——
 *      散在正则里就没法被"改一处"击中；
 *   ② 七值封闭集的来源只有这一处，⛔ 不许别处再写第二份。
 */
export const STEP_BY_NUMBER: Readonly<Record<string, TasksProgressStep>> = {
  '1': '1',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
}

export function normalizeStep(cell: string): TasksProgressStep {
  const s = cell.replace(/\*\*/g, '').replace(/`/g, '').trim()
  if (s === '') return 'unknown'
  if (s.includes('未回填')) return 'unfilled'
  if (s.includes('验收完成') || s.includes('✅')) return 'done'
  // 形如 `5 验收核对` / `4 任务执行`（⚠ 用**五步名**锚定，避免把无关数字当步号）
  // ⚠⚠ 这里**不许**只认 1–4：2026-10-29 用户裁定加第 5 步「验收核对」，
  //   漏掉它会让 `'5'` 静默落成 `'unknown'` —— 那正是"两态被合并"的前一步。
  const named = /([1-5])\s*(需求规格|实现方案|编码任务|任务执行|验收核对)/.exec(s)
  if (named !== null) return STEP_BY_NUMBER[named[1]] ?? 'unknown'
  // 形如 `2` / `2.`（只有数字）
  const bare = /^([1-5])(?:[.、)]|\s|$)/.exec(s)
  if (bare !== null) return STEP_BY_NUMBER[bare[1]] ?? 'unknown'
  return 'unknown'
}

/** 一格 → 人读文本：去装饰、空白归一；`—`/`-`/`—` 之类占位 ⇒ 空串。 */
function cellText(cell: string): string {
  const s = (cell ?? '').replace(/\*\*/g, '').replace(/`/g, '').trim()
  if (s === '' || s === '—' || s === '-' || s === '–' || s === '无') return ''
  return s
}

/** 解析结果：要么一组行，要么一个**可分辨**的失败原因。 */
export type TasksProgressParse =
  | { ok: true; rows: TasksProgressRow[] }
  | { ok: false; reason: TasksProgressReason; message: string }

/**
 * 解析 `volumes/tasks/INDEX.md` 的正文。
 *
 * @param src - 该文件的全文（⚠ 读不到请由调用方给 `ledger-unreadable`，⛔ 不要传空串来充数）
 * @returns `{ok:true, rows}` 或 `{ok:false, reason, message}`
 */
export function parseTasksIndex(src: string): TasksProgressParse {
  const lines = src.split('\n')
  /** 表头行下标 */
  let headerAt = -1
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim()
    if (!ln.startsWith('|') || !ln.endsWith('|')) continue
    const cells = ln.slice(1, -1).split('|').map((c) => c.trim())
    if (cells[0] === '编号') { headerAt = i; break }
  }
  if (headerAt < 0) {
    return {
      ok: false,
      reason: TASKS_REASON_TABLE_MISSING,
      message: '没找到表头首格为 `编号` 的表格（⛔ 不是"表里没有行"，是**表本身不在**）',
    }
  }
  // 分隔行（`|---|---|`）必须紧跟表头
  const sepAt = headerAt + 1
  const sepLine = (lines[sepAt] ?? '').trim()
  if (!sepLine.startsWith('|') || !/^\|[\s:|-]+\|$/.test(sepLine)) {
    return {
      ok: false,
      reason: TASKS_REASON_TABLE_MISSING,
      message: `表头在第 ${headerAt + 1} 行，但下一行不是分隔行（\`|---|---|\`）⇒ 表形态不认识`,
    }
  }

  const rows: TasksProgressRow[] = []
  for (let i = sepAt + 1; i < lines.length; i++) {
    const ln = lines[i].trim()
    if (!ln.startsWith('|') || !ln.endsWith('|')) break   // 表到空行/正文为止
    const cells = ln.slice(1, -1).split('|').map((c) => c.trim())
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue
    if (cells.length < 3) {
      return {
        ok: false,
        reason: TASKS_REASON_ROW_SHAPE_UNKNOWN,
        message: `第 ${i + 1} 行只有 ${cells.length} 格（至少要 3 格：编号 / 步 / 卡在谁那里）`,
      }
    }
    const name = cellText(cells[0])
    if (name === '') {
      return {
        ok: false,
        reason: TASKS_REASON_ROW_SHAPE_UNKNOWN,
        message: `第 ${i + 1} 行第一格（编号）是空的 ⇒ 这一行认不出是哪件事`,
      }
    }
    /**
     * ⚠⚠ **封闭集越界必须报错**（2026-10-29 用户裁定，`CHG-223`）。
     *
     * ── 它治什么 ────────────────────────────────────────────────────────
     *   八值封闭集 `1|2|3|4|5|done|unfilled|unknown` 是**线格式契约**。
     *   账本里若出现 `6 验收核对` 这种**明确写着第 6 步**的读数，那是数据与契约
     *   **不一致**，不是"判不出" ⇒ ⛔ 不许兜底成 `'unknown'`（会把"契约坏了"
     *   伪装成"这一行读不出来"）、⛔ 更不许映射成 `'1'`（那是伪造读数）。
     *   ⇒ 直接报 `row-shape-unknown`，并把那一格原文印出来。
     *
     * ⚠ 与"判不出"的分界（两者**不是一类**，⛔ 不许合并）：
     *   · 这一格**明确标了步号但越界**（`6` / `9 验收核对`）⇒ **报错**；
     *   · 这一格**根本没有步号信息**（`—` / 空 / `乱写`）⇒ `'unknown'`（合法值）。
     */
    const stepCell = cells[1] ?? ''
    const stepRaw = stepCell.replace(/\*\*/g, '').replace(/`/g, '').trim()
    const numbered = /^([0-9]+)(?:[.、)]|\s|$)/.exec(stepRaw)
      ?? /([0-9]+)\s*(?:需求规格|实现方案|编码任务|任务执行|验收核对)/.exec(stepRaw)
    if (numbered !== null && STEP_BY_NUMBER[numbered[1]] === undefined) {
      return {
        ok: false,
        reason: TASKS_REASON_ROW_SHAPE_UNKNOWN,
        message: `第 ${i + 1} 行的步号 \`${numbered[1]}\` 超出封闭集`
          + `（只许 1|2|3|4|5|done|unfilled|unknown）—— ⛔ 不兜底成 unknown、⛔ 不映射成 1`,
      }
    }

    rows.push({
      name,
      step: normalizeStep(stepCell),
      blockedBy: cellText(cells[2] ?? ''),
    })
  }
  return { ok: true, rows }
}

// ══════════════════════════════════════════════════════════════════════════
// 请求处理体（**纯依赖注入**，无宿主依赖 ⇒ 机检可直接跑真源码）
// ══════════════════════════════════════════════════════════════════════════

/** 数据来源（线格式 `source` 字段，逐字与任务书一致）。 */
export const TASKS_PROGRESS_SOURCE = 'volumes/tasks/INDEX.md'

/** 线格式：成功。 */
export interface TasksProgressOk {
  ok: true
  readAt: string
  source: string
  rows: TasksProgressRow[]
}

/** 线格式：失败（`reason` 三类之一，⛔ 不合并）。 */
export interface TasksProgressFail {
  ok: false
  reason: string
  message: string
}

export type TasksProgressResponse = TasksProgressOk | TasksProgressFail

/** 处理体依赖（全部注入，便于机检用真夹具账本跑真源码）。 */
export interface TasksProgressDeps {
  /** 会话 id → 账本根；`undefined` = 判不出（⛔ 不许回退到猜一个） */
  ledgerRootOf: (sessionId: string) => string | undefined
  /** 判不出的可读原因（`R-10` 的第三层信息，⛔ 不省略） */
  ledgerRootWhyOf?: (sessionId: string) => string
  /** 现读文件全文；默认 `fs.readFileSync`（机检可注入假实现） */
  readText?: (absPath: string) => string
  /** 时钟（机检要可断言 `readAt` 是 ISO）；默认 `new Date()` */
  now?: () => Date
}

/**
 * 一条请求的处理体。
 *
 * ⚠ 三类的分界（`R-10`，⛔ 不许并成一句）：
 *   · 账本根判不出 / 文件读不到 ⇒ `ledger-unreadable`
 *   · 表不在 / 表形态不认识      ⇒ `table-missing`
 *   · 某一行形态不认识            ⇒ `row-shape-unknown`
 * ⚠ 表在、零行 ⇒ `{ok:true, rows:[]}` —— 那是**事实**，不是失败。
 *
 * @param deps - 依赖注入
 * @param body - 已解析的请求体（`sessionId` 可选）
 * @returns 线格式响应
 */
export function handleTasksProgress(deps: TasksProgressDeps, body: any): TasksProgressResponse {
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''

  let root: string | undefined
  try {
    root = deps.ledgerRootOf(sessionId)
  } catch {
    root = undefined
  }
  if (root === undefined || root === '') {
    const why = (() => {
      try { return deps.ledgerRootWhyOf?.(sessionId) ?? '' } catch { return '' }
    })()
    return {
      ok: false,
      reason: TASKS_REASON_LEDGER_UNREADABLE,
      message: `账本根判不出 ⇒ 不知道该读哪本账（⛔ 不猜）${why === '' ? '' : `：${why}`}`,
    }
  }

  const abs = join(root, TASKS_PROGRESS_SOURCE)
  const read = deps.readText ?? ((p: string) => readFileSync(p, 'utf8'))
  let src: string
  try {
    src = read(abs)
  } catch (e) {
    return {
      ok: false,
      reason: TASKS_REASON_LEDGER_UNREADABLE,
      message: `账本根在 \`${root}\`，但 \`${TASKS_PROGRESS_SOURCE}\` 读不到：${String((e as Error)?.message ?? e)}`,
    }
  }

  const parsed = parseTasksIndex(src)
  if (!parsed.ok) return { ok: false, reason: parsed.reason, message: parsed.message }

  const now = deps.now ?? (() => new Date())
  return { ok: true, readAt: now().toISOString(), source: TASKS_PROGRESS_SOURCE, rows: parsed.rows }
}
