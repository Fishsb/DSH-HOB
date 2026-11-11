/**
 * 派发记录的**读数**：结算态 / 记录态 / 进度三项 —— 全部是**纯函数**，零 I/O。
 *
 * ── 为什么它们在这里，而不是 `server/orch-state.ts` ──────────────────────
 *   2026-11-11（架构健康化）：`shared/exec-progress.ts` 需要 `dispatchStateOf` /
 *   `dispatchProgressOf` 来归一读数，于是写了
 *   `import { … } from '../server/orch-state.ts'` ——
 *   而 `orch-state.ts` 有 **17 处 I/O**（`node:fs` / 读写盘），
 *   ⇒ **shared 层反向依赖 server 层**，`shared` 不再是纯函数层。
 *
 *   ⚠ 这不是"风格问题"：`check:architecture` 的 A 组会把这条边判成违规，
 *     而且它正是本项目最大的缺陷来源（同一事实两处实现）的典型温床 ——
 *     一个纯判定函数被放在有 I/O 的文件里，任何人想复用都只能跨层 import。
 *
 *   ⇒ 把**纯的部分**搬到这里（`shared/`），`orch-state.ts` 改为从这里 import 并**再导出**，
 *     这样 182 个既有引用点一个字都不用改。
 *
 * ⚠ 本文件**不许**引入任何 I/O、任何 `server/` 依赖 —— 那会让本搬迁白做。
 */
/**
 * **一条未结算派发的结算态**（2026-10-20 · 本单 B2/B3 新增）。
 *
 * ⚠ ⚠ 存在的唯一理由：**「判不出」过去是终态**（判不出 ⇒ 挪进 `lost` ⇒ 再也没人看它，
 *   见 `markLost` 的旧注释与 `FINDINGS` 的 P2）。用户要的是"回执得回来"，
 *   而终态等于"这条永远不会有回执了"。
 *
 * 三档语义（⛔ 不许合并成一档、⛔ 不许把 `unresolved` 当结论）：
 * · `waiting`     —— 还在等目标跑完（正常态；重挂成功的那条也是它）；
 * · `unresolved`  —— **判不出**（目标状态读不到 / 会话没了）⇒ **留在 `pending` 里，
 *                    每一轮任意触发都会再核一次**（可重入态，⛔ 不是终态）；
 * · `stuck`       —— 重核了 K 轮（{@link STUCK_AFTER_RECHECKS}）**仍然判不出**
 *                    ⇒ **停止自动重试**，读数里单列一档并明说"需人工裁"。
 *
 * ⚠ ⚠ **`unresolved` 不是"猜 owner"**（`I-1` / `I-3` 不破）：重判读的是**目标此刻的状态**
 *   （`agents.get(target)?.status` / 看板卡终态 / 会话 log 末条），
 *   **收件人仍然只由 `w.owner` 决定**；`owner` 缺失 ⇒ **照旧不投**，只落"无归属"那一档。
 *   ⚠ 目标状态与 owner 是**两个不同字段** —— `I-1`/`I-3` 禁的是**猜 owner**，
 *   ⛔ 不是"读目标状态"。⇒ 这一段必须留在代码里，否则下一个人会以为"重判 = 猜"。
 */
export type SettleState = 'waiting' | 'unresolved' | 'stuck'

/**
 * **凭哪条真相源结的账**（2026-10-20 · 本单 B2 新增）。
 *
 * ⚠ 它的唯一用途是**读数可解释**：结算发生时，读的人必须能说出
 * "这条是**凭着什么**判成跑完的"，⛔ 不是又一个内部计数器。
 * ⚠ 四档与三真相源 + 事件路径一一对应（⛔ 不许再添第五个含义）：
 * · `'event'`        —— 宿主 `agent/status` 的 `running → idle` 那一跳（快路径）；
 * · `'board'`        —— **看板卡终态**（`in_review` / `done` / `canceled`）；
 * · `'session-log'`  —— **会话 log 最后一条 `assistant/message`**；
 * · `'agent-status'` —— `agents.get(id).status`（⚠ **最弱**：重载后不可信 ⇒ 只作旁证）。
 */
export type SettleEvidence = 'event' | 'board' | 'session-log' | 'agent-status'

/** 结算态的**运行时集合**（{@link SettleState} 的同源副本，供收窄时逐值判）。 */
/** ⚠ 导出：`orch-state.ts` 要用它做收窄（与 {@link SettleState} 同源）。 */
export const SETTLE_STATES = ['waiting', 'unresolved', 'stuck'] as const

/** 结算证据的**运行时集合**（{@link SettleEvidence} 的同源副本）。 */
/** ⚠ 导出：`orch-state.ts` 要用它做收窄（与 {@link SettleEvidence} 同源）。 */
export const SETTLE_EVIDENCES = ['event', 'board', 'session-log', 'agent-status'] as const

/**
 * ══════════════════════════════════════════════════════════════════════
 * **派发记录态 = 封闭九态**（`D10`；2026-10-26 · 包 A 第 4 件）
 * ══════════════════════════════════════════════════════════════════════
 *
 * ── 为什么必须是一个**封闭枚举**（而不是散在各处的字符串）──────────────
 *   `D10` 要求「记录态必须是封闭集」，且**任何两态不许合并成一行读数**。
 *   改前这套态**根本不存在**：读数只有「在等回传 / 已回传 / 被停闸拦下」三个聚合数，
 *   于是两对**成因完全不同**的情形在输出里逐字一样：
 *     · **拒收**（目标明确说做不了）与 **在跑只是没回音**；
 *     · **要澄清**（跑到一半要补充信息）与 **已回传**。
 *   ⇒ 读的人只能猜，而猜错的代价是"再等一个永远不会来的东西"或"重派一次已经做过的活"。
 *
 * ── 判据（每条都写在这个类型上，⛔ 不许在别处另写一套字符串）──────────────
 *   · **封闭**：{@link DISPATCH_RECORD_STATES} 是唯一清单，渲染层**按它逐档出行**；
 *   · **不合并**：渲染层**一态一行**，⛔ 不许把两态加起来印在同一行；
 *   · **可分辨**：`拒收 ≠ 执行中`、`要澄清 ≠ 已回传`（见 {@link dispatchStateOf} 的优先级）。
 */
export type DispatchRecordState =
  /** 已登记：记录刚落账，还没见到"投递已尝试"。 */
  | 'registered'
  /** 已投递未确认执行：投递动作已尝试，但**没见过目标进入运行态**。 */
  | 'delivered-unconfirmed'
  /** 执行中：见过目标 `running`（`sawRunning`）且还没回传。 */
  | 'running'
  /** 要澄清：对方跑到一半**要补充信息**（记录上带 `clarifyAt`）。 */
  | 'needs-clarification'
  /** 已回传：回执**已经送到**派活方（`deliveredAt` 在）。 */
  | 'returned'
  /** 已验收：派活方已判定这份产出可用（记录上带 `acceptedAt`）。 */
  | 'accepted'
  /** 已退回：派活方已判定这份产出不合格、退回重做（记录上带 `sentBackAt`）。 */
  | 'sent-back'
  /** 拒收：目标**明确说做不了**（记录上带 `refusedAt`）—— ⛔ 不是"在跑没回音"。 */
  | 'refused'
  /** 卡住：判不出/清账到顶，**不再自动重试，需人工裁**。 */
  | 'stuck'

/**
 * 九态的**唯一清单**（顺序 = 渲染顺序；⚠ 一态一行，⛔ 不许合并）。
 * ⚠ 运行期也用它做收窄（`asDispatchRecordState`），⛔ 不许在别处再列一遍。
 */
export const DISPATCH_RECORD_STATES: readonly DispatchRecordState[] = [
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

/**
 * 九态给人看的名字（`D10` 原文用词，逐字对齐方案 §5.3）。
 * ⚠ 渲染层只许从这里取措辞（同一事实两个来源必然漂，`E-128`）。
 */
export const DISPATCH_STATE_LABELS: Readonly<Record<DispatchRecordState, string>> = {
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

/**
 * 收窄一个字符串是不是九态之一（判不出 ⇒ `undefined`，⛔ 不猜一档）。
 * ⚠ 与 `SETTLE_STATES` / `LOST_CLASSES` **同一条宽容纪律**：脏值不许漂进读数。
 */
export function asDispatchRecordState(v: unknown): DispatchRecordState | undefined {
  return typeof v === 'string' && (DISPATCH_RECORD_STATES as readonly string[]).includes(v)
    ? (v as DispatchRecordState)
    : undefined
}

/**
 * 一条派发记录**此刻**落在哪一态（`D10` 的**唯一判定点**）。
 *
 * ── 优先级（顺序本身就是要害，⛔ 不许改）──────────────────────────────
 *   1. `stuck`                  —— 已放弃自动重试（终态里最该先说的一句）；
 *   2. `refused`                —— 明确拒收（⛔ 不许被"在跑没回音"吞掉）；
 *   3. `needs-clarification`    —— 要澄清（⛔ 与"已回传"分开）；
 *   4. `sent-back`              —— 已退回；
 *   5. `accepted`               —— 已验收；
 *   6. `returned`               —— 回执已送到（`deliveredAt`）；
 *   7. `running`                —— 见过 `running`；
 *   8. `delivered-unconfirmed`  —— 投递尝试过、但没见过运行态；
 *   9. `registered`             —— 兜底（记录刚落账）。
 *   ⚠ 前五档由**显式标记**决定（记录上有那一刻才有）；后四档由**既有字段**派生 ——
 *     这样"没记过"就落回"已登记/已投递"，⛔ 不许替旧记录编一个它没有的结论。
 *
 * ── ⚠⚠ **包 H（2026-10-26）：前五档现在**真的**有写入入口了** ────────────
 *   包 A 只落了枚举与判定点 ⇒ 那四态**恒为 0**。包 H 给每一态接了一条**已经发生的事**
 *   （⛔ 不是"让模型自己标"的通用入口），各自的判据在写入口那一侧（`orchestrator.ts`）：
 *     · `refused`  ← **投递实现明确说"目标不能接"**（归档 / 非活会话 / 权限拒绝）；
 *     · `needs-clarification` ← **回传正文里的"待决问题"段非空**（原文一并存进 `clarifyWhy`）；
 *     · `accepted` / `sent-back` ← **判决**，且**必须带 `basis`（依据哪几条读数）**。
 *   ⚠ 四态**没有**"模型随口标一个"的路径：`refused`/`clarify` 由**投递/回传的实际内容**驱动，
 *     `accepted`/`sent-back` 由**只读判决工具**驱动且 `basis` 空数组一律拒绝落账。
 *   ⚠ ⛔ **判不出的情形一律不动**：本函数只看"记录上有没有那个标记"，
 *     读不出/算不出 ⇒ 保持原档（⛔ 不许把"判不出"编成任何一态）。
 */
export function dispatchStateOf(w: {
  deliveredAt?: number
  sawRunning?: boolean
  deliveryAttemptAt?: number
  undeliveredAt?: number
  settleState?: SettleState
  clarifyAt?: number
  refusedAt?: number
  acceptedAt?: number
  sentBackAt?: number
  /** 退回目标阶段（back-to-requirement / back-to-plan / back-to-task）；旧记录缺省。 */
  returnTo?: string
  /** ⚠ 包 H：判决依据（本函数**只判"有没有那个时刻"**，⛔ 不拿依据决定档位）。 */
  basis?: string[]
}): DispatchRecordState {
  if (w.settleState === 'stuck') return 'stuck'
  if (typeof w.refusedAt === 'number') return 'refused'
  if (typeof w.clarifyAt === 'number') return 'needs-clarification'
  if (typeof w.sentBackAt === 'number') return 'sent-back'
  if (typeof w.acceptedAt === 'number') return 'accepted'
  if (typeof w.deliveredAt === 'number') return 'returned'
  if (w.sawRunning === true) return 'running'
  /**
   * ⚠⚠ **「投递尝试过」有两个来源**（`D4`）：`deliveryAttemptAt`（先写后发那一笔）与
   *   `undeliveredAt`（明确没送到那一笔）。
   *   ⚠ 后者必须也算 —— 总线缺席那一支会**删掉** `deliveryAttemptAt`（撤销"结果未知"
   *     这个错误陈述），若这里只认前者，那条记录会**退回"已登记"**
   *     ⇒ 「投过、没送到」与「还没派出去」印成同一态，正是 `D4` 要治的假话。
   *   ⚠ 两档**仍然是同一态**（都=已投递**未确认执行**）：九态里没有第十档，
   *     "未送达"是 `D4` 的**另一条配对读数**（见 `undeliveredAt` 字段），⛔ 不占记录态。
   */
  if (typeof w.deliveryAttemptAt === 'number' || typeof w.undeliveredAt === 'number') {
    return 'delivered-unconfirmed'
  }
  return 'registered'
}

/**
 * 「停滞」阈值：**上次有动静**到**现在**超过这么久 ⇒ 报「停滞」。
 *
 * ── 为什么是 **20 分钟**（依据，不是随手取）────────────────────────────
 *   · 与卡读数面既有的 `DEFAULT_CARD_STALL_MS`（`board-cards.ts`）**同值** ——
 *     同一件事（卡/会话长时间没动静）⛔ 不许有两套相差很大的口径；
 *   · 下界：一次正常的长活（写码 + 跑测试 + 自验）常见 5–15 分钟 ⇒ 阈值低于它
 *     会把**正常在干**报成停滞（假告警会训练人忽略真告警，本仓明写的那条）；
 *   · 上界：真停滞（死锁 / 会话丢了）在一小时内一定看得出来，20 分钟够早。
 *   ⚠ 这不是"超时就重派"——`D11` 明令停滞**只报**。
 */
export const DISPATCH_STALL_MS = 20 * 60 * 1000

/** {@link dispatchProgressOf} 的结果（渲染层只认这个形状）。 */
export interface DispatchProgressReading {
  /** 是否**进过**运行态（`sawRunning`）。 */
  everRan: boolean
  /** 已跑多久（毫秒）；**判不出** ⇒ `undefined`（⛔ 不许读成 0）。 */
  ranMs?: number
  /** 重核了几次（`recheckCount`；缺字段 ⇒ `0`，那是"没重核过"，如实）。 */
  rechecks: number
  /**
   * `'progressed'` = 有进展（近 `DISPATCH_STALL_MS` 内有动静）；
   * `'stalled'`    = 停滞（超过阈值没有任何动静）；
   * `'not-running'`= 还没进过运行态 ⇒ **这条不谈停滞**（⛔ 不许把"还没开跑"说成"停滞"）。
   */
  verdict: 'progressed' | 'stalled' | 'not-running'
  /** 最后一次"有动静"的时刻（诊断用；判不出 ⇒ 不填）。 */
  lastActivityAt?: number
}

/**
 * 算一条派发记录的**进度三项 + 停滞判读**（`D11` 的唯一实现点）。
 *
 * @param w - 记录（内存 `Watch` 或盘上 `PersistedWatch` 都满足这个形状）。
 * @param now - 现取时刻（测试可固定）。
 */
export function dispatchProgressOf(
  w: {
    at: number
    sawRunning?: boolean
    sawRunningAt?: number
    recheckCount?: number
    lastRecheckAt?: number
    deliveryAttemptAt?: number
    deliveredAt?: number
  },
  now: number,
): DispatchProgressReading {
  const everRan = w.sawRunning === true
  /**
   * ⚠ **「已跑多久」的起点**：优先 `sawRunningAt`（它真的开跑那一刻）。
   *   ⛔ **不许拿 `at` 顶替** —— `at` 是"交出去"的时刻，把它当开跑时刻会把排队等待
   *   算成已跑时间（读数偏大，而偏大的"已跑多久"会让人误判"它卡住了"）。
   *   两个都没有 ⇒ `undefined`（判不出）。
   */
  const startedAt = w.sawRunningAt
  const ranMs = typeof startedAt === 'number' && Number.isFinite(startedAt)
    ? Math.max(0, now - startedAt)
    : undefined
  const rechecks = typeof w.recheckCount === 'number' && Number.isFinite(w.recheckCount) ? w.recheckCount : 0
  /**
   * ⚠ **"最近一次有动静"取所有时刻的**最大值**（不是只取一个字段）——
   *   重核 / 投递尝试 / 回执送达 / 开跑 都是"动静"，只认其中一个会把
   *   "刚重核过"的活误报成停滞（假告警）。
   */
  const stamps = [w.sawRunningAt, w.lastRecheckAt, w.deliveryAttemptAt, w.deliveredAt]
    .filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
  const lastActivityAt = stamps.length === 0 ? undefined : Math.max(...stamps)
  const verdict: DispatchProgressReading['verdict'] = everRan === false
    ? 'not-running'
    : lastActivityAt === undefined
      /** 进过运行态、但一个时刻都没记下来 ⇒ 判不出 ⇒ 按"有进展"报（⛔ 不拿判不出当停滞）。 */
      ? 'progressed'
      : (now - lastActivityAt >= DISPATCH_STALL_MS ? 'stalled' : 'progressed')
  return {
    everRan,
    ...(ranMs === undefined ? {} : { ranMs }),
    rechecks,
    verdict,
    ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
  }
}
