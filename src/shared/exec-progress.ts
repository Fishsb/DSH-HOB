/**
 * **执行态（派发记录 → 执行项）的归一**（纯函数，无 I/O）—— 2026-10-30 · 第 17 轮。
 *
 * ══ 数据来源唯一（`D1`①：⛔ 不自造第二份状态）═══════════════════════════════
 *   `runtime/orch-watches.json` —— 由 `src/server/orch-state.ts` 的
 *   `readOrchStateDetailed()` **读**进来，本文件只做**归一到线格式**，⛔ 不读盘、⛔ 不写盘。
 *   ⚠ 派发记录 → 九态的映射**不在此重写**：一律走既有的
 *   `dispatchStateOf()` / `dispatchProgressOf()`（`orch-state.ts` 里 `D10` / `D11` 的唯一实现点）。
 *   ⛔ 在这里再写一遍 `if (deliveredAt) return 'returned'` 就等于开了第二份判据 —— 必然漂。
 *
 * ══ 九态**以源码为准**（⚠ 与任务书正文的转写不同）════════════════════════════
 *   任务书 §一B 列的九个词是 `registered|delivered|running|returned|accepted|returned-back|
 *   rejected|stuck|undelivered`；而 `orch-state.ts:178-188` 的 `DISPATCH_RECORD_STATES` 是
 *   `registered|delivered-unconfirmed|running|needs-clarification|returned|accepted|
 *    sent-back|refused|stuck`。
 *   ⚠ 两者**不是同一套词**（`delivered` / `returned-back` / `rejected` / `undelivered` 在源码里
 *     零命中）。任务书同时也写了「与 `D10` 同一套词，⛔ 不许自造」⇒ **以 `D10` 的唯一定义点为准**，
 *     即源码那九个。⛔ 本文件不新造词、也不做同义词翻译。
 *
 * ══ 三类失败可分辨（`R-10`）═════════════════════════════════════════════════
 *   · `ledger-unreadable`  —— 账本根判不出（与 `tasks-progress` 同一条）
 *   · `state-missing`      —— 账本根在，但 `runtime/orch-watches.json` **不存在**
 *   · `row-shape-unknown`  —— 文件在，但 JSON 坏 / 顶层不是对象 / 某条记录收窄失败
 *   ⚠ 三者的**修法完全不同**（查配置 / 从来没派过活 / 查那份文件的形态）⇒ ⛔ 不许并成一句。
 */

import { dispatchStateOf, dispatchProgressOf } from '../server/orch-state.ts'
import {
  asExecState,
  type ExecBucket,
  type ExecState,
  EXEC_STATES,
  EXEC_PROGRESS_SOURCE,
  EXEC_REASON_LEDGER_UNREADABLE,
  EXEC_REASON_STATE_MISSING,
  EXEC_REASON_ROW_SHAPE_UNKNOWN,
  type ExecProgressItem,
  type ExecProgressResponse,
} from './exec-protocol.ts'

/** 三类 reason 的再导出（调用方/机检从本文件拿也行，⚠ 值来自 protocol 那一份）。 */
export { EXEC_REASON_LEDGER_UNREADABLE, EXEC_REASON_STATE_MISSING, EXEC_REASON_ROW_SHAPE_UNKNOWN, EXEC_PROGRESS_SOURCE }
export type { ExecProgressItem, ExecProgressResponse }

/**
 * 目标会话 id → 短标签。
 *
 * ⚠ 只做**显示用的裁剪**（去掉 `session-` 前缀、取前 8 位），⛔ 不改线格式里的可核性：
 *   真 id 仍可从账本 `runtime/orch-watches.json` 原样查到。
 *
 * @param id - 目标会话 id
 * @returns 短标签；空/非字符串 ⇒ 空串
 */
export function shortTarget(id: unknown): string {
  const s = typeof id === 'string' ? id : ''
  const bare = s.startsWith('session-') ? s.slice('session-'.length) : s
  return bare.slice(0, 8)
}

/** 一条记录（`pending` / `lost` / `closed` 里的元素）。字段用法与 `PersistedWatch` 兼容。 */
export interface ExecRecordLike {
  target?: unknown
  at?: unknown
  sawRunning?: unknown
  sawRunningAt?: unknown
  recheckCount?: unknown
  lastRecheckAt?: unknown
  deliveryAttemptAt?: unknown
  deliveredAt?: unknown
  undeliveredAt?: unknown
  settleState?: unknown
  clarifyAt?: unknown
  refusedAt?: unknown
  acceptedAt?: unknown
  sentBackAt?: unknown
}

/** 一条记录**来自哪一摞**（⚠ 分档的唯一依据，⛔ 不猜、不看 state）。 */
export interface ExecRecordIn extends ExecRecordLike {
  /** 来源摞：`pending` ⇒ 现在档；`lost` / `closed` ⇒ 历史档。 */
  from?: 'pending' | 'lost' | 'closed'
}

/**
 * 把一组派发记录归一成执行项（**分两档 + 按 target 合并 + 排序**）。
 *
 * ══ 分档（`R-1`：此刻的与累计的 ⛔ 不许并排）══════════════════════════════════
 *   · `'now'`     = `pending`（未结算的记录）；
 *   · `'history'` = `lost` + `closed`（判丢的 / 已结算的）。
 *   ⚠ 分档只看**来源摞**，⛔ 不看九态 —— 因为同一个九态在两档里含义不同
 *     （`running` 在 `pending` 里 = 此刻在跑；在 `closed` 里 = 进过运行态、事后结算）。
 *
 * ══ 按 target 合并 ═════════════════════════════════════════════════════════
 *   同一 `target` **只出一行**，取**最新状态**（`at` 最大的那条），并带 `count` = 合并了几条。
 *   ⚠ "最新"取 `at`（登记时刻）的最大值 —— ⛔ 不取数组下标（数组顺序可能跨版本变动）。
 *   ⚠ 合并**只在同一档内**做：同一 target 若同时在 `pending` 与 `closed`（真实现象），
 *     会出**两行**（一行现在、一行历史）—— 这是**如实**：它确实既有一条在跑、又有历史结算。
 *
 * ══ 排序（任务书 §一3）══════════════════════════════════════════════════════
 *   ① `'now'` 档整体在 `'history'` 档之前；
 *   ② 同档内：`running` 在前，`stuck` 在后，其余居中（按 `EXEC_STATES` 声明顺序的稳定序）。
 *
 * @param records - 记录数组（⚠ 每条要带 `from`，否则按形态不认识计）
 * @param now - 现取时刻（毫秒；测试可固定）
 * @returns `{ items, dropped }` —— `dropped` = 因**形态不认识**被丢掉的条数（⛔ 不许静默）
 */
export function toExecItems(
  records: readonly ExecRecordIn[],
  now: number,
): { items: ExecProgressItem[]; dropped: number } {
  let dropped = 0
  /** 归一后的中间行（合并前）。 */
  const rows: Array<{ bucket: ExecBucket; target: string; at: number; item: ExecProgressItem }> = []
  for (const r of records) {
    const target = shortTarget(r?.target)
    if (target === '') { dropped += 1; continue }
    const at = typeof r?.at === 'number' && Number.isFinite(r.at) ? r.at : undefined
    if (at === undefined) { dropped += 1; continue }
    const from = r?.from
    if (from !== 'pending' && from !== 'lost' && from !== 'closed') { dropped += 1; continue }
    /**
     * ⚠ 九态走**既有唯一实现**：`dispatchStateOf`。
     *    它认的是 `PersistedWatch` 的字段；这里把原始记录**原样**递过去
     *    （⛔ 先在这一层"整理"字段 —— 那会把脏值洗成合法的，正好是 `row-shape-unknown` 要抓的）。
     */
    const state = (() => {
      try { return dispatchStateOf(r as any) } catch { return undefined }
    })()
    // ⚠ 收窄一次：万一 `dispatchStateOf` 返回了九态之外的东西（改坏了）⇒ 记为形态不认识
    const narrowed = asExecState(state)
    if (narrowed === undefined) { dropped += 1; continue }
    const prog = (() => {
      try { return dispatchProgressOf(r as any, now) } catch { return undefined }
    })()
    /** ⚠ 「从未进过运行态」= `dispatchProgressOf` 的 `ranMs` 判不出（⛔ 不是"跑了 0 毫秒"）。 */
    const unrun = prog?.ranMs === undefined
    const item: ExecProgressItem = {
      target,
      state: narrowed,
      bucket: from === 'pending' ? 'now' : 'history',
      count: 1,
      unrunCount: unrun ? 1 : 0,
      rechecks: typeof prog?.rechecks === 'number' ? prog.rechecks : 0,
    }
    /**
     * ⚠⚠ **`elapsedMs` 判不出就缺这个字段**（任务书 §一B 明令）。
     *   依据：`dispatchProgressOf` 的 `ranMs` 在"没有 `sawRunningAt`"时就是 `undefined`
     *   —— 那是"还没开跑 / 不知道何时开跑"，填 0 会把它说成"刚开跑"。
     */
    if (typeof prog?.ranMs === 'number' && Number.isFinite(prog.ranMs)) item.elapsedMs = prog.ranMs
    rows.push({ bucket: item.bucket, target, at, item })
  }

  /**
   * ── 按 `(bucket, target)` 合并：取 `at` 最新那条，`count` 累加 ──────────────
   * ⚠ 用 `Map` 保**首次出现顺序**，合并后再统一排序（排序见下）。
   */
  /**
   * ⚠ `unrun` 是**逐条累加**的独立计数器（`prev.item.unrunCount` 会随"换代表"被覆盖，
   *   不能直接当累加器用 —— 这是实测踩到的假绿：累加结果被最新那条的 0 冲掉了）。
   */
  const merged = new Map<string, { at: number; maxElapsed?: number; unrun: number; item: ExecProgressItem }>()
  for (const row of rows) {
    const key = `${row.bucket}\u0000${row.target}`
    const prev = merged.get(key)
    const thisElapsed = row.item.elapsedMs
    if (prev === undefined) {
      merged.set(key, { at: row.at, maxElapsed: thisElapsed, unrun: row.item.unrunCount, item: { ...row.item } })
    } else {
      prev.item.count += 1
      /**
       * ⚠⚠ **`unrunCount` 逐条累加**（任务书 §一②）：它是"这 N 条都没进过运行态"里的 N，
       *   ⛔ **不能用 `count` 顶替** —— 混合形态（2 条未开跑 + 1 条曾运行）下
       *   `count = 3` 而 `unrunCount = 2`，写 3 就是把"有一条跑过"说成"都没跑过"。
       */
      if (row.item.unrunCount === 1) prev.unrun += 1
      if (typeof thisElapsed === 'number' && (prev.maxElapsed === undefined || thisElapsed > prev.maxElapsed)) {
        prev.maxElapsed = thisElapsed
      }
      /**
       * ⚠ 取更新的那条作为代表（`at` 更大）——**状态 / 重核次数**取它的。
       *   ⚠ `rechecks` ⛔ **不相加**（相加会把"重核 3 次"变成"3+3 次"，那是编出来的读数）。
       */
      /** ⚠ 换代表时**必须把累计的 count / unrun 带回去**（否则被新那条的初值冲掉）。 */
      if (row.at >= prev.at) { prev.at = row.at; prev.item = { ...row.item, count: prev.item.count, unrunCount: prev.unrun } }
    }
  }
  /**
   * ── ⚠⚠ 合并行的 `elapsedMs` = **该 target 全部记录里最长的那次**（⛔ 不是代表那条的）──
   *
   * ── 为什么必须这么取（2026-10-30 第 20 轮 · 任务书 §一5）────────────────────
   *   用户点名要保住的两条读数里，`7c031a2d` 那条 **56 时 59 分** 是它 **7 条记录中最早的一条**。
   *   若合并行只显示"最新那条"的时长，那条 56 小时的**真读数就看不见了** ——
   *   而任务书 §一5 明令「⛔ 不许过滤、⛔ 不许截断成"很久以前"」。
   *   ⇒ 取**最长一次**，并由渲染层在合并行上注明「**已跑（最长）**」——
   *     ⚠ 这是**有明确定义的口径**（"该目标历史上最长一次跑多久"），⛔ 不是把两条记录拼成一条：
   *       状态 / 重核次数仍严格来自**最新那条**。
   */
  for (const v of merged.values()) {
    /** ⚠ 累计值**一律回写**（⛔ 不依赖"代表是否换过"这种隐式条件）。 */
    v.item.unrunCount = v.unrun
    if (v.item.count <= 1) continue
    if (v.maxElapsed === undefined) { delete v.item.elapsedMs; continue }
    v.item.elapsedMs = v.maxElapsed
  }

  /** 同档内的稳定序：`running` 最前、`stuck` 最后，其余按九态声明顺序。 */
  const rankOf = (st: ExecState): number => {
    if (st === 'running') return -1
    if (st === 'stuck') return 999
    return EXEC_STATES.indexOf(st)
  }
  const all = [...merged.values()].map((x) => x.item)
  all.sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket === 'now' ? -1 : 1
    const d = rankOf(a.state) - rankOf(b.state)
    if (d !== 0) return d
    return a.target < b.target ? -1 : a.target > b.target ? 1 : 0
  })
  return { items: all, dropped }
}

/** 处理体依赖（全部注入 ⇒ 机检可跑真源码，不碰宿主）。 */
export interface ExecProgressDeps {
  /** 会话 id → 账本根；`undefined` = 判不出 */
  ledgerRootOf: (sessionId: string) => string | undefined
  /** 判不出的可读原因 */
  ledgerRootWhyOf?: (sessionId: string) => string
  /** 给定账本根的文件路径（默认拼 `runtime/orch-watches.json`） */
  stateFileOf?: (ledgerRoot: string) => string
  /** 现读文件全文；`undefined` 表示**文件不存在**（⚠ 与"读失败"分开）；抛错 = 读失败 */
  readText?: (absPath: string) => string | undefined
  /** 时钟 */
  now?: () => Date
}

/**
 * 一条请求的处理体。
 *
 * @param deps - 依赖注入
 * @param body - 已解析请求体（`sessionId` 可选）
 * @returns 线格式响应
 */
export function handleExecProgress(deps: ExecProgressDeps, body: any): ExecProgressResponse {
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
  const nowMs = (deps.now ?? (() => new Date()))().getTime()

  // ── ① 账本根判不出 ⇒ ledger-unreadable ────────────────────────────────
  let root: string | undefined
  try { root = deps.ledgerRootOf(sessionId) } catch { root = undefined }
  if (root === undefined || root === '') {
    const why = (() => {
      try { return deps.ledgerRootWhyOf?.(sessionId) ?? '' } catch { return '' }
    })()
    return {
      ok: false,
      reason: EXEC_REASON_LEDGER_UNREADABLE,
      message: `账本根判不出 ⇒ 不知道该读哪本账（⛔ 不猜）${why === '' ? '' : `：${why}`}`,
    }
  }

  const abs = (deps.stateFileOf ?? ((r: string) => `${r}/runtime/orch-watches.json`))(root)
  /**
   * ⚠ **读盘由调用方注入**（`deps.readText`），本文件**不 `import node:fs`**。
   *   理由：`src/client/*` 也会 import 本模块的**类型与纯函数**（面板要 `state` 词与短标签），
   *   而客户端产物里不许出现 `node:fs`（宿主 `lib/client.js` 是浏览器侧单体）。
   *   ⇒ 真正读盘只在 `src/modules/exec-progress-route.ts`（宿主侧）发生。
   */
  const read = deps.readText
  if (typeof read !== 'function') {
    return {
      ok: false,
      reason: EXEC_REASON_ROW_SHAPE_UNKNOWN,
      message: '调用方没有注入 `readText` ⇒ 本函数不读盘（⛔ 不猜运行态）',
    }
  }

  let src: string | undefined
  try {
    src = read(abs)
  } catch (e) {
    // ⚠ 文件在、但读不了（权限等）⇒ 形态不认识（不是"从来没派过"）
    return {
      ok: false,
      reason: EXEC_REASON_ROW_SHAPE_UNKNOWN,
      message: `运行态文件读不到（不是"没有记录"）：${String((e as Error)?.message ?? e)}`,
    }
  }

  // ── ② 文件不存在 ⇒ state-missing（⚠ 与"空"分开：那是"从来没落盘"）──
  if (src === undefined) {
    return {
      ok: false,
      reason: EXEC_REASON_STATE_MISSING,
      message: `账本根在 \`${root}\`，但 \`${EXEC_PROGRESS_SOURCE}\` 不存在`
        + ' —— ⚠ 这通常是"这台机器还没派过活"，⛔ 不是文件坏了',
    }
  }

  // ── ③ 形态：JSON 坏 / 顶层不是对象 ⇒ row-shape-unknown ────────────────
  let parsed: unknown
  try {
    parsed = JSON.parse(src)
  } catch (e) {
    return {
      ok: false,
      reason: EXEC_REASON_ROW_SHAPE_UNKNOWN,
      message: `\`${EXEC_PROGRESS_SOURCE}\` 不是合法 JSON：${String((e as Error)?.message ?? e)}`,
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      reason: EXEC_REASON_ROW_SHAPE_UNKNOWN,
      message: `\`${EXEC_PROGRESS_SOURCE}\` 顶层不是对象 ⇒ 形态不认识`,
    }
  }
  const o = parsed as Record<string, unknown>

  /**
   * ── ④ 三类记录**各自带来源摞**（分档的唯一依据，`R-1`）────────────────────
   *   ⚠ 第 20 轮改：改前把三摞摊成一个数组、丢掉"来源" ⇒ 现在档与历史档分不开，
   *     实测表现为"几天前的残留和此刻在跑并排"（用户截图）。
   */
  const pick = (k: 'pending' | 'lost' | 'closed'): ExecRecordIn[] =>
    (Array.isArray(o[k]) ? (o[k] as ExecRecordLike[]).map((r) => ({ ...r, from: k })) : [])
  const records: ExecRecordIn[] = [...pick('pending'), ...pick('lost'), ...pick('closed')]
  const { items, dropped } = toExecItems(records, nowMs)

  /**
   * ⚠ **单条记录形态不认识 ⇒ 报 `row-shape-unknown`**（⛔ 不许静默丢）。
   *   任务书 §一B 要"三类可分辨"，而"丢了几条不说"正是 `R-10` 要防的那种静默。
   *   ⚠ 但同时**把已认出的条目一并带回**（`items`）—— 否则一次坏记录会让整张表消失，
   *     那比"少一行"更难用。
   */
  if (dropped > 0) {
    return {
      ok: false,
      reason: EXEC_REASON_ROW_SHAPE_UNKNOWN,
      message: `有 ${dropped} 条派发记录的形态不认识（缺 target 或 at，或状态不在九态里）`
        + `；已认出 ${items.length} 条`,
    }
  }

  return {
    ok: true,
    readAt: (deps.now ?? (() => new Date()))().toISOString(),
    source: EXEC_PROGRESS_SOURCE,
    items,
  }
}
