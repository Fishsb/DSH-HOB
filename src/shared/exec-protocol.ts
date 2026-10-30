/**
 * **执行态的线协议 + 九态词表**（⚠ **客户端可安全 import**：零 `node:*`、零宿主依赖）。
 *
 * ══ 为什么单独一层（2026-10-30 第 17 轮）════════════════════════════════════════
 *   `src/client/*` 会 import 本模块的**类型与词表**（面板要渲染 `state` 的中文名）；
 *   而宿主客户端产物 `lib/client.js` 是**浏览器侧单体**，里面出现 `node:fs` 会直接编译失败
 *   （实测：让 client 侧 type-only import `src/server/orch-state.ts` ⇒
 *    `error TS2307: Cannot find module 'node:fs'`）。
 *   ⇒ 拆成两层：
 *     · **本文件** = 先验不依赖任何宿主物的**线协议**（九态值域、字段名、路径、文案）；
 *     · `src/shared/exec-progress.ts` = 服务端处理体（**只有宿主侧 import**，它才碰
 *       `dispatchStateOf` / `dispatchProgressOf` 与读盘）。
 *
 * ══ ⚠ 九态的**唯一真源**仍是 `src/server/orch-state.ts` 的 `DISPATCH_RECORD_STATES` ══
 *   本文件持一份**逐字副本**，漂移由 `check:exec-progress` 的 **E-9** 断言当场咬住
 *   （⛔ 不靠自觉：两份不同 ⇒ 红）。⚠ 同一条纪律也管 {@link EXEC_STATE_LABELS} 与
 *   `DISPATCH_STATE_LABELS`。
 */

/**
 * 九态（`D10` 的词，⛔ 不许自造）。
 * ⚠ 顺序 = 渲染顺序 = `DISPATCH_RECORD_STATES` 的顺序。
 */
export const EXEC_STATES = [
  'registered',
  'delivered-unconfirmed',
  'running',
  'needs-clarification',
  'returned',
  'accepted',
  'sent-back',
  'refused',
  'stuck',
] as const

/** 九态之一。 */
export type ExecState = (typeof EXEC_STATES)[number]

/** 九态的**给人看的名字**（⚠ 逐字对齐 `DISPATCH_STATE_LABELS`，由 E-9 钉住）。 */
export const EXEC_STATE_LABELS: Readonly<Record<ExecState, string>> = {
  'registered': '已登记',
  'delivered-unconfirmed': '已投递未确认执行',
  'running': '执行中',
  'needs-clarification': '要澄清',
  'returned': '已回传',
  'accepted': '已验收',
  'sent-back': '已退回',
  'refused': '拒收',
  'stuck': '卡住',
} as const

/** 收窄：是不是九态之一（判不出 ⇒ `undefined`，⛔ 不猜一档）。 */
export function asExecState(v: unknown): ExecState | undefined {
  return typeof v === 'string' && (EXEC_STATES as readonly string[]).includes(v)
    ? (v as ExecState)
    : undefined
}

/** 路由路径（⚠ **客户端与服务端都从这里取** —— ⛔ 各写一份必然漂）。 */
export const EXEC_PROGRESS_ROUTE_PATH = '/api/dsh-hob/exec-progress'

/** 数据来源（线格式 `source` 字段，逐字）。 */
export const EXEC_PROGRESS_SOURCE = 'runtime/orch-watches.json'

/** 三类可分辨失败（`R-10`：⛔ 不许并成一句）。 */
export const EXEC_REASON_LEDGER_UNREADABLE = 'ledger-unreadable'
export const EXEC_REASON_STATE_MISSING = 'state-missing'
export const EXEC_REASON_ROW_SHAPE_UNKNOWN = 'row-shape-unknown'

/**
 * **两档**（2026-10-30 第 20 轮 · 用户裁定 `R-1`）。
 *
 * ⚠⚠ `R-1`：**"此刻的"与"累计的"⛔ 不许并排**。
 *   改前（第 17 轮）把 `pending` / `lost` / `closed` **全摊在一个列表里** ——
 *   于是几天前的残留（实测两条已跑 **56 时 57 分 / 67 时 15 分**）与"此刻在跑"并排，
 *   用户读到的就不是"现在的过程"，而是一张**历史堆积表**。
 *   ⇒ 分档：`'now'` = `pending`（未结算）；`'history'` = `lost` + `closed`。
 */
export type ExecBucket = 'now' | 'history'

/** 两档的标题用词（⚠ 渲染层只许从这里取，⛔ 各写一份必然漂）。 */
export const EXEC_BUCKET_LABELS: Readonly<Record<ExecBucket, string>> = {
  'now': '现在',
  'history': '历史',
} as const

/** 一行执行项（字段**封闭**，⛔ 不加别的）。 */
export interface ExecProgressItem {
  /** 目标会话的短标签（去 `session-` 前缀、取前 8 位）。 */
  target: string
  /** 九态之一。 */
  state: ExecState
  /** 这一行属于哪一档（`R-1`）。 */
  bucket: ExecBucket
  /** **同一 target 合并了几条记录**（≥1；>1 时渲染成「共 N 条」）。 */
  count: number
  /** 已跑多久（毫秒）。⚠ **判不出 ⇒ 这个字段不存在**，⛔ 不许填 0。 */
  elapsedMs?: number
  /** 重核次数（缺字段 ⇒ 0，那是"没重核过"，如实）。 */
  rechecks: number
  /**
   * 这一行（合并前）**从未进过运行态**的记录条数（`elapsedMs` 判不出的那些）。
   *
   * ⚠ 2026-10-30 第 21 轮新增（任务书 §一②）：`stuck + 未开跑 + 共 N 条` 那行读作
   *   「卡住 · 未开跑 · 共 2 条」时**看起来矛盾** ⇒ 要补一句「（这 N 条都没进过运行态）」。
   *   ⚠⚠ **`N` 必须是真实的未开跑条数，⛔ 不是总条数** —— 两者在混合形态下不相等
   *     （实测夹具：2 条未开跑 + 1 条曾运行 ⇒ `count=3` 但 `unrunCount=2`）。
   *   ⚠ 所以它**不能**由渲染层从 `count` 推出来，必须服务端如实数出来。
   */
  unrunCount: number
}

/** 「未开跑」——**从未进过运行态**（历史档里 `elapsedMs` 判不出的那些）。 */
export const EXEC_LABEL_NOT_STARTED = '未开跑'
/** 「曾运行」——**历史某一刻在跑过、但现在不在跑**（历史档里带 `elapsedMs` 的那些）。 */
export const EXEC_LABEL_RAN_BEFORE = '曾运行'

/**
 * 执行项**给人看的状态词** —— ⚠ **三条互斥、按 `bucket` 优先**。
 *
 * ══ 2026-10-30 第 21 轮（任务书 §一①，**收紧**第 20 轮的口径）══════════════════
 *   第 20 轮只处理了「无 `ranMs` 的 running」；**漏网形态** = `lost`/`closed` 里
 *   **有** `elapsedMs` 的 `running`（真机 13 条）—— 它们仍在显示「执行中」。
 *   ⚠ 那同样是**拿历史冒充此刻**：`lost`/`closed` 里的 `running` 只说明"历史某一刻在跑"。
 *
 *   现在三条分支（互斥、穷尽）：
 *     · `bucket === 'now'`     && `state === 'running'` ⇒ 「**执行中**」（真的在跑）
 *     · `bucket === 'history'` && 无 `elapsedMs`      ⇒ 「**未开跑**」（从未进过运行态）
 *     · `bucket === 'history'` && 有 `elapsedMs`      ⇒ 「**曾运行**」（跑过，现在不在跑）
 *     · 其余（非 running 的九态）⇒ 走 {@link EXEC_STATE_LABELS}（九态原词）
 *
 * @param item - 一行执行项
 * @returns 展示用中文
 */
export function execDisplayLabel(item: {
  state: ExecState
  bucket: ExecBucket
  elapsedMs?: number
}): string {
  if (item.state === 'running') {
    if (item.bucket === 'now') return EXEC_STATE_LABELS.running
    return typeof item.elapsedMs === 'number' ? EXEC_LABEL_RAN_BEFORE : EXEC_LABEL_NOT_STARTED
  }
  return EXEC_STATE_LABELS[item.state]
}

/**
 * 合并行的**消歧句**：`（这 N 条都没进过运行态）`。
 *
 * ⚠ 只在**合并行**（`count > 1`）且**确有未开跑记录**（`unrunCount > 0`）时才给 ——
 *   单条记录说"这 1 条都没进过运行态"读起来别扭，而且单条本来就不存在"卡住但共 N 条"的混淆。
 * ⚠⚠ `N` 用 `unrunCount`，⛔ **不是 `count`**（混合形态两者不等，见 {@link ExecProgressItem.unrunCount}）。
 *
 * @param item - 一行执行项
 * @returns 消歧句；不需要时返回空串
 */
export function execMergeNote(item: { count: number; unrunCount: number }): string {
  const count = typeof item.count === 'number' ? item.count : 0
  const unrun = typeof item.unrunCount === 'number' ? item.unrunCount : 0
  if (count <= 1 || unrun <= 0) return ''
  return `（这 ${unrun} 条都没进过运行态）`
}

/** 线格式：成功。 */
export interface ExecProgressOk {
  ok: true
  readAt: string
  source: string
  items: ExecProgressItem[]
}

/** 线格式：失败（`reason` 三类之一，⛔ 不合并）。 */
export interface ExecProgressFail {
  ok: false
  reason: string
  message: string
}

/** 线格式：二选一。 */
export type ExecProgressResponse = ExecProgressOk | ExecProgressFail
