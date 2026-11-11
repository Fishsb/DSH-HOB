/**
 * **逐会话策略服务**（`hobSessionPolicy`）—— 把 {@link ./server/session-policy.ts} 的
 * 纯判定接到宿主运行时：**唯一的会话维度权威**。
 *
 * ══ 谁调它（⛔ 全都调它，不许各自再算一份）══════════════════════════════════════
 *   ① `src/preset/tools.ts` 的**模型面装配过滤**（每 step 现算工具清单）；
 *   ② 同一文件的 **`tools/pre-execute`** 拦截；
 *   ③ 同一文件的 **`ctx.tools.guard`** 单调哨兵；
 *   ④ `src/modules/tools.ts` 四个只读工具的 **`execute`**（本层兜底，封住"无 agent"路径）；
 *   ⑤ `src/preset/tools.ts` 的**工作方式口径注入**；
 *   ⑥ `src/index.ts` 的**跨实例投递准入**。
 *
 * ══ 它为什么在**入口作用域** provide（与 `hobPermission` 同一条理由）═══════════
 *   上面六处横跨**预设作用域**（①②③⑤）与**模块作用域**（④⑥）⇒ 只能由入口
 *   provide 一个闭包，两侧都调它。⚠ 与旧的两个全局服务**并列共存**（旧值不再参与
 *   判定，但服务名保留：机检 G-4/G-11 与既有调用方仍按名找它）。
 *
 * ══ 信任模型（⛔ 一律 fail-closed，绝不回退到旧全局宽档）════════════════════
 *   · 没有可信 `sessionId` ⇒ 最低档 + 安全缺省工作方式，`source='no-identity'`；
 *   · 策略文件坏 / 版本不认识 / 取不到账本 ⇒ 同上（原因写清）；
 *   · 该会话没有记录（新会话未做选择）⇒ 最低档（⛔ 不悄然给宽档）；
 *   · 旧会话（早于迁移纪元）⇒ 最低档 + **一次性固化**的迁移时工作方式；
 *   · 非 Hob 会话 ⇒ `isHob=false`，调用方保持既有行为（本服务**不参与**）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { PERMISSION_LEVELS, DEFAULT_PERMISSION_LEVEL, SESSION_POLICY_SERVICE } from './config.ts'
import { DEFAULT_WORK_MODE, WORK_MODE_VALUES } from './shared/work-mode.ts'
import { HOB_PRESET_ID } from './shared/planning-preset.ts'
import {
  POLICY_STATE_FILENAME,
  POLICY_STATE_SUBDIR,
  createdAtOf,
  ensureLegacyMigrated,
  ensureLegacyMigratedByFile,

  ensurePolicyStoreEpoch,
  policyStateFileOf,
  readPolicyStore,
  activateSessionPolicy,
  quarantineSessionPolicy,
  resolveSessionPolicy,
  type ArchiveState,
  setSessionPolicy,
  type PolicyResolution,
  type PolicyStoreOptions,
} from './server/session-policy.ts'
import { declaredLedgerHome } from './modules/orchestrator.ts'
import { resolveLedgerRoot } from './server/doc-read.ts'
import { markBlocked, policyBlockFileOf } from './server/policy-block-log.ts'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * **被闸门拦下的消息暂存**（2026-10-29 · 包 CA · `CHG-186`）
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── 为什么必须有它（否则比不做更糟）────────────────────────────────────
 *   宿主对 `{kind:'reject'}` 的语义是**丢弃**该条被 claim 的消息
 *   （`dsh-agent/lib/types/runtime-types.d.ts:267-270`：
 *    *"the claimed message ends here: it is neither discarded nor re-emitted"*
 *    —— 措辞是"不再作为 user/message 重发"，实际效果由
 *    `dsh-agent/lib/index.js:54-58` 说清：*"discarded the claimed messages"*）。
 *   ⇒ 我们拦下它却不留副本，**用户的消息就永久消失了**。
 *   ⚠ `CHG-185` §三 正是因为这一环缺失而判"功能链断在最后一环"。
 *
 * ── 存哪里 / 存多久 / 多条怎么办（本单 §三 三个问号）──────────────────
 *   · **存哪里 = 进程内存**（`Map<sessionId, PendingMessage[]>`）。
 *     理由：它是**一次交互的在途状态**，不是领域数据。落盘会引出"重启后该不该替用户
 *     发一条他可能已经忘了的消息"这个更复杂的判断 —— ⛔ 超出本单。
 *     ⇒ 代价：**进程重启即丢**（见 REPORT §七 F2，如实登记）。
 *   · **存多久 = 到"选完档重投成功"或"该会话被显式放弃"为止**；
 *     ⚠ 会话被销毁 ⇒ 该 sid 的暂存一并清掉。
 *     ⚠⚠ **2026-10-31 P37 订正**：本文件此前写的是「`session/disposed`」——
 *     **宿主根本没有这个事件**（实测：`AgentStatus` 只有 `'idle' | 'running'`，
 *     且 `runtime-types.d.ts:87` 原文 *"Disposal removes the agent from its registry;
 *     it is not a third observable status"*）。
 *     ⇒ 真实事件是 **`agent/disposed`**（`runtime-types.d.ts:240`，payload `{ agent }`），
 *     监听器已装在 {@link installSessionDisposeCleanup}，**由 `installSessionPolicy` 调用**。
 *     ⚠ 不清会永久占内存，且下次选档会把陈旧消息发出去。
 *   · **多条 = 全存、按到达顺序存、按顺序重投**（⛔ 只存最后一条 ——
 *     用户连发两条只回来一条，是**更隐蔽的丢消息**）。
 *
 * ⚠ **只存"文本 + 附件引用"，不存整个 message 对象**：
 *   整个 `UserMessage` 带 `id` 与 `source`，`createUserMessage` 不收 `id`；
 *   而且直接重发同一个 id 会与"已被丢弃"的那条**撞身份**。
 *   ⇒ 重投时用 `createUserMessage` **新建**一条（新 id），内容取自这里。
 */
interface PendingMessage {
  /**
   * ⭐ **稳定消息键**（2026-10-31 P37）。
   *
   * ── 为什么必须有一个"键"，而不能靠数组下标 ──────────────────
   *   重投是**部分可能失败**的：投完第 1 条、第 2 条抛错 ⇒ 必须**只把第 1 条
   *   从队列里摘掉**。⚠ 若用下标摘，一旦队列在重投期间被并发 append（用户又发一条），
   *   下标就指向了**另一条** ⇒ 摘错 ⇒ **要么重发、要么丢消息**。
   *   ⇒ 用**单调递增的稳定键**：摘的是"我确实投出去的那一条"，与位置无关。
   */
  readonly key: number
  /** 原消息的 `content` 块（⚠ 原样保存，⛔ 不重排、不拼接）。 */
  readonly content: readonly unknown[]
  /** 入暂存时刻（⚠ 只用于诊断排序，⛔ 不参与判定）。 */
  readonly at: number
}
/** `sessionId → 按到达顺序排队的待重投消息`。⚠ 进程内唯一一份。 */
const pendingBySession = new Map<string, PendingMessage[]>()

/**
 * ⭐ **每会话队列上限**（2026-10-31 P37 · 审计 `CHG-313` 第 2 条）。
 *
 * ── 为什么需要 ──────────────────────────────────────────────
 *   暂存在**进程内存**里，而"用户放弃会话"曾经**不会被清理**（会话销毁不留痕）
 *   ⇒ 极端情况下该 Map 会随会话数无限增长。上限是**第二道闸**（第一道是
 *   `agent/disposed` 监听，见下方 `installSessionDisposeCleanup`；⚠ 2026-10-31 P37 订正了事件名）。
 *
 * ── 具体值与时代价（⚠ 逐条说明，⛔ 不写"合理值"了事）──────
 *   · `PENDING_MAX_PER_SESSION = 32` 条：一个会话被拦下的消息通常是**个位数**
 *     （用户连发几条就选档了）；32 已远超正常使用。⚠ 32 × 几百会话 ≈ 万余条，
 *     每条只有 content 引用 + 两个数字 ⇒ 内存量级仍在 MB 内。
 *   · `PENDING_MAX_TOTAL_CHARS = 256 * 1024`（约 25 万字符 ≈ 512 KB UTF-16）：
 *     拦下的是**用户输入**，正常一条几十到几千字符；256K 相当于"一个人连发几百条长消息"。
 *     ⚠ 之所以还要**字节**上限：只看条数挡不住"32 条 × 每条 100KB"的粘贴轰炸。
 *
 * ── 超限之后怎么办 = **丢最旧**（⛔ 不是拒新）──────────────
 *   ⚠ **理由**：被拦下的消息**只有重投这一条出路**。若"拒新"，用户在被拦状态下
 *   继续输入会被**静默吞掉**（他以为发出去了）—— 那正是本服务最初要修的病症（丢消息）。
 *   丢最旧则是**可解释的**：最新的用户意图最相关，且我们在丢的时候会 **warn 日志**
 *   点名"丢了哪一条"，⛔ 不静默。
 *   ⚠ **代价（如实写）**：被丢掉的那条**永久消失**（宿主已经丢弃过它一次）。
 *     所以上限设得足够宽（32 条 / 256K 字符），正常使用永远碰不到；
 *     碰到就说明该会话已经异常，丢最旧比整队列撑爆更可接受。
 */
export const PENDING_MAX_PER_SESSION = 32
export const PENDING_MAX_TOTAL_CHARS = 256 * 1024

/** ⚠ 单调递增的稳定消息键（模块级；⛔ 不按会话重置，跨会话也不会撞）。 */
let pendingKeySeq = 0

/** content 的"字符量"估算（⚠ 只看文本块，⛔ 不去序列化整个对象）。 */
function contentChars(content: readonly unknown[]): number {
  let n = 0
  for (const blk of content) {
    const t = (blk as any)?.text
    if (typeof t === 'string') n += t.length
  }
  return n
}

/**
 * **被丢弃的暂存消息计数**（T-14 · 2026-11-10）。
 *
 * ── 病（实测）────────────────────────────────────────────────────────────────
 *   超条数 / 超字符上限时「丢最旧」，改前**只有一条 `loggerWarn`**：
 *   · 队列在**进程内存**（`pendingBySession` 是 `Map`）⇒ 重启即丢，无痕；
 *   · 丢弃**永久消失**（宿主已经丢过一次，暂存是唯一副本）；
 *   · `loggerWarn` 走 `console.warn`，而本仓自己论证过**生产日志通道会滤掉 warn** ⇒ 可能完全不可观测。
 *   ⇒ **用户输入被丢掉，而没有任何可持久读到的计数。**
 *
 * ── 修法：把计数做成**可读、可持久、按会话**的一面 ───────────────────────────
 *   · 本 `Map` 是**内存计数器**（与队列同寿命，⛔ 不假装它跨重启）；
 *   · **每次丢弃都 +1**，并在 `pendingDropStatsOf()` 里如实报出；
 *   · ⚠ 它**不替代** `loggerWarn`（warn 仍保留，便于当场排查），
 *     而是补上「事后还能不能看见」这一半 —— 那正是改前缺的。
 * ⚠ 为什么不做成落盘文件：这条计数**与队列同寿命**才有意义（队列本就是内存的），
 *   落盘会造出「文件里有 5 条、内存里 0 条」的新错配。要做持久化得连队列一起做，属另一件事。
 */
const pendingDroppedBySession = new Map<string, { count: number; lastAt: number; lastKey: number }>()

/** 记录一次丢弃（⚠ 只增不减；`lastKey` 是最后一条被丢的稳定键，便于对账）。 */
function notePendingDropped(sessionId: string, key: number): void {
  const prev = pendingDroppedBySession.get(sessionId)
  pendingDroppedBySession.set(sessionId, {
    count: (prev?.count ?? 0) + 1,
    lastAt: Date.now(),
    lastKey: key,
  })
}

/**
 * **读某会话的暂存丢弃读数**（T-14 的可观测面）。
 *
 * @returns `count` 累计丢弃条数；`undefined` = 该会话从未丢过。
 *   ⚠ **不返回 0 冒充「没丢过」**：`count === undefined` 与 `count === 0` 在这里是同一件事，
 *     但调用方拿到 `undefined` 时**不应**在界面上写「已丢弃 0 条」——
 *     那是把「没有这件事」说成一个读数（本仓反复记的形态）。
 */
export function pendingDropStatsOf(sessionId: string): { count: number; lastAt: number; lastKey: number } | undefined {
  return pendingDroppedBySession.get(sessionId)
}

/**
 * 把一条被拦下的消息按到达顺序追加（⚠ 不改动既有队列）。
 *
 * ⚠ **带上限**：超过条数或总字符量 ⇒ **丢最旧**并 warn（见上方常量说明）。
 * ⚠ **T-14**：每次丢弃同时 `notePendingDropped(...)` —— 让「丢了几条」事后可读。
 */
export function stagePendingMessage(sessionId: string, content: readonly unknown[]): void {
  if (typeof sessionId !== 'string' || sessionId === '') return
  if (!Array.isArray(content) || content.length === 0) return
  const cur = pendingBySession.get(sessionId)
  const next = cur === undefined ? [] : cur.slice()
  next.push({ key: ++pendingKeySeq, content: content.slice(), at: Date.now() })
  // ⚠ 丢最旧：条数超限
  while (next.length > PENDING_MAX_PER_SESSION) {
    const dropped = next.shift()
    /** ⚠ **T-14**：丢弃必须留下可读计数（改前只有一条 warn，可能被日志通道滤掉）。 */
    notePendingDropped(sessionId, dropped?.key ?? -1)
    loggerWarn(`⚠ 暂存超条数上限（${PENDING_MAX_PER_SESSION} 条）⇒ 丢弃最旧一条（key=${String(dropped?.key)}）`)
  }
  // ⚠ 丢最旧：总字符量超限（⚠ 至少留一条 —— 否则刚存进来的这条也会被丢）
  let total = next.reduce((acc, x) => acc + contentChars(x.content), 0)
  while (total > PENDING_MAX_TOTAL_CHARS && next.length > 1) {
    const dropped = next.shift()
    total -= contentChars(dropped?.content ?? [])
    /** ⚠ **T-14**：同上（字符量超限这一半）。 */
    notePendingDropped(sessionId, dropped?.key ?? -1)
    loggerWarn(`⚠ 暂存超总字符上限（${PENDING_MAX_TOTAL_CHARS}）⇒ 丢弃最旧一条（key=${String(dropped?.key)}）`)
  }
  pendingBySession.set(sessionId, next)
}

/**
 * ⭐ **按稳定键从队列里摘掉"确实投出去的"那一条**（2026-10-31 P37 · bug ① 的修法）。
 *
 * ⚠ 与 `clearPendingMessages` 的区别（**这是本 bug 的核心**）：
 *   · `clearPendingMessages` 是**全有或全无**（整队删）；
 *   · 本函数是**逐条确认后消费**（只摘投成功的那一条）。
 *   ⇒ 部分失败时队列里**只剩没投出去的那些**，⛔ 不会把已投的再投一遍。
 */
export function consumePendingMessage(sessionId: string, key: number): void {
  const cur = pendingBySession.get(sessionId)
  if (cur === undefined) return
  const next = cur.filter((x) => x.key !== key)
  if (next.length === 0) pendingBySession.delete(sessionId)
  else pendingBySession.set(sessionId, next)
}

/** ⚠ 供上限 warn 用的最小日志（⛔ 不引宿主 logger —— 那是可选依赖）。 */
function loggerWarn(msg: string): void {
  try { console.warn(`[dsh-hob][session-policy] ${msg}`) } catch { /* 无控制台也不影响功能 */ }
}

/**
 * ⭐⭐ **会话销毁 ⇒ 清该会话暂存**（2026-10-31 P37 · 审计 `CHG-313` 第 2 条）。
 *
 * ── 病（改前）────────────────────────────────────────────────
 *   本文件注释承诺「会话关闭时清空暂存」，但**全仓没有任何地方装销毁监听**；
 *   删队列只有两处：① 整队重投成功；② 测试显式调 `clearPendingMessages`。
 *   ⇒ 触发路径：消息被拦 → 进 `pendingBySession` → **用户放弃该会话** →
 *     **那条消息留到宿主进程重启**（一直占内存，且该会话若再被打开会把陈旧消息发出去）。
 *
 * ── 事件名（⚠ 不是我照任务书字面抄的 `session/disposed`）──────────
 *   实测宿主 `@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts`：
 *     · `AgentStatus = 'idle' | 'running'`（⛔ 没有 disposed 状态）
 *     · `:87` 原文 *"Disposal removes the agent from its registry; it is not a third
 *       observable status."*
 *     · `:240` 真正的销毁事件 = **`'agent/disposed'`**，payload `{ agent }`
 *   ⇒ ⚠ **`session/disposed` 在宿主里根本不存在**（全仓 grep 零命中）——
 *     照字面装会得到一个**永远不触发**的监听（比不装更坏：看起来装了）。
 *
 * ── 会话 id 怎么取 ─────────────────────────────────────────
 *   `payload.agent.id` —— 宿主保证 `agent.id === session.id`
 *   （本仓 `src/modules/tools.ts:694` 已按同一口径用）。
 *
 * ⚠ 监听用 `ctx.on(...)` 注册，并在 `ctx.effect(...)` 里返回 disposer
 *   —— 插件卸载时一并摘掉，⛔ 不泄漏监听器。
 */
export function installSessionDisposeCleanup(ctx: Context): void {
  const hostCtx = ctx as any
  if (typeof hostCtx?.on !== 'function') return
  const off = hostCtx.on('agent/disposed', (payload: any) => {
    const sid = payload?.agent?.id
    if (typeof sid !== 'string' || sid === '') return
    const had = pendingMessagesOf(sid).length
    if (had === 0) return
    clearPendingMessages(sid)
    loggerWarn(`会话 ${JSON.stringify(sid)} 已销毁 ⇒ 清掉其暂存 ${had} 条（⚠ P37 前会留到进程重启）`)
  })
  if (typeof hostCtx.effect === 'function') {
    hostCtx.effect(() => () => {
      try { if (typeof off === 'function') off() } catch { /* 已卸载 */ }
    }, 'dsh-hob:session-policy/dispose-cleanup')
  }
}

/** 读某会话的待重投队列（⚠ 返回副本；调用方不可改内部数组）。 */
export function pendingMessagesOf(sessionId: string): readonly PendingMessage[] {
  const cur = pendingBySession.get(sessionId)
  return cur === undefined ? [] : cur.slice()
}

/** 清某会话的整条队列（⚠ 重投成功后调；会话结束也调）。 */
export function clearPendingMessages(sessionId: string): void {
  pendingBySession.delete(sessionId)
}

/**
 * ⚠ **正在重投的会话**（⛔ 不是"已选档"的缓存，是**一道一次性绕行标记**）。
 *
 * ── 为什么必须有它（本单 §四 第 3 问 · **最要紧的一条**）──────────────
 *   重投走 `agent.followup(message)` ⇒ `send(..., 'next-turn', true)`
 *   ⇒ 一定会**再进一次 `agent/pre-step`**（`dsh-agent-loop/lib/index.js:909`
 *   的 waterfall 每次提步都跑）。⚠ 而那一刻策略**可能还没生效**
 *   （写完是 `pending-activation` 或读盘有几毫秒延迟）
 *   ⇒ 我们的闸门会**再拦一次** ⇒ 消息又被丢弃 ⇒ **永远选不完、死循环**。
 *
 * ── 怎么绕（⛔ 不是放宽判据）─────────────────────────────────────────
 *   **只对"我们自己刚投出去的那一条"放行**：重投前置位、`finally` 里立刻复位。
 *   ⚠ 判据本身（`isHob ∧ derived-default`）**一个字没改** —— 只是在它**之前**
 *   加一个"这条正在被我们重投"的短路。⛔ 这不是放宽：
 *   该标记**只在本进程、只在一个同步段内**成立，用户自己发的消息永远碰不到它。
 *   ⚠ 用 `Set` 而非布尔：并发两个会话同时重投时互不干扰。
 */
const requeueing = new Set<string>()
/** 仅供机检与诊断：当前处于"重投中"的会话 id（副本）。 */
export function requeueingSessions(): readonly string[] { return [...requeueing] }

/**
 * 服务名。
 *
 * ⚠ 与 `PERMISSION_SERVICE` / `WORK_MODE_SERVICE` **不是同一个服务**：
 *   那两个返回**实例级全局值**（旧机制），本服务返回**逐会话**结果。
 *   保留那两个是为了兼容既有调用方与机检，⛔ 不是在暗示它们仍参与判定。
 * ⚠ 常量本身定义在 `config.ts`（那里是"两侧都要用"的唯一落点）；本文件**re-export**
 *   只是让消费方可以从服务实现处一起 import，避免多跳一次。
 */
export { SESSION_POLICY_SERVICE }

/** 供 UI 与显式入站接口读的**完整**会话策略视图。 */
export interface SessionPolicyView {
  sessionId: string
  isHob: boolean
  level: string
  workMode: string
  source: string
  reason: string
  canReadWorkspace: boolean
  /** 记录是否**已存在**（`false` = 该会话还没有用户选择 ⇒ 将来弹窗该弹）。 */
  recorded: boolean
}

/** 入站接口（下一阶段弹窗 / 显式创建路径调它）。 */
export interface SessionPolicyInbound {
  /** 读一个会话的当前策略（只读；⛔ 不改任何东西）。 */
  get(session: any): SessionPolicyView
  /**
   * **显式设置**一个会话的两项选择。
   *
   * ⚠ 校验：`sessionId` 非空、两项都在枚举内，否则 `ok:false` + 可读原因。
   * ⚠ 原子写 + 回读校验（⛔ 不看 write 返回值就当成功）。
   * ⚠ 写失败 ⇒ `ok:false`（⛔ 不把失败报成成功，也⛔ 不影响已有记录）。
   */
  set(sessionId: string, level: string, workMode: string): { ok: boolean; reason: string }
  /**
   * 读**盘上原始记录**（不经过安全降档），**只给写入侧的回读确认**用。
   *
   * ⚠ `get()` 返回的是解析后的值，而解析对 `activation:'pending'` 一律降到最低档
   *   （那是"未确认不激活宽档"的安全落点）⇒ 拿它做 `pending` 阶段的回读确认
   *   **永远对不上**，创建链会必然失败并回滚（真机可复现）。
   *   ⛔ 任何判定/闸门都不许拿本方法当授权依据。
   */
  readRawPolicy(sessionId: string): { level: string; workMode: string; activation?: string; quarantined?: boolean } | undefined
  /**
   * ⚠ **持久隔离**（2026-10-22）：把该会话的策略记录标记作废并落盘 + 回读确认。
   *   用于创建链"写成功 / 回读不一致 / 空白会话撤不掉"这一格 ——
   *   ⛔ 只报 `stranded` 不算修好：那个会话仍能按高档执行。
   *   ⚠ 失败返回 `ok:false`，调用方必须停手（⛔ 不假装已隔离）。
   */
  quarantine(sessionId: string): { ok: boolean; reason: string }
  /**
   * ⚠ **确认生效**（2026-10-22）：把该会话的 pending 记录转成 active。
   *   ⚠ 创建链在"写 pending → 回读一致"**之后**才调它；在那之前一律最低档。
   */
  activate(sessionId: string): { ok: boolean; reason: string }
  /** 策略文件的落盘路径（诊断用；判不出 ⇒ `undefined`）。 */
  fileOf(session: any): string | undefined
  /** 枚举（供 UI 直接渲染三档，⛔ 不在 UI 侧再抄一份清单）。 */
  enums(): { levels: readonly string[]; modes: readonly string[]; floorLevel: string; defaultMode: string }
}

const OPTIONS: PolicyStoreOptions = {
  levels: PERMISSION_LEVELS,
  modes: WORK_MODE_VALUES,
  floorLevel: DEFAULT_PERMISSION_LEVEL,
  defaultMode: DEFAULT_WORK_MODE,
}

/**
 * 判定某个会话**是不是 Hob 预设会话**。
 *
 * ⚠ **必须读宿主投影**（`agentPreset`），⛔ 不凭 `session.header.agentPreset` 猜 ——
 *   宿主自己的定义写明 header 只是**建档那一刻**的事实，会话在 blank 期间可能换过预设
 *   （本仓 `bus.ts` 已为同一件事踩过一次，见其 `makeProjectionsLookup` 的注释）。
 * ⚠ 投影读不到 ⇒ 用 header 兜底，并**如实标注**来源（⛔ 不假装是投影读数）。
 * ⚠ 判定为"不是 Hob" ⇒ 调用方**保持既有行为**（本服务不参与）—— 这不是"放宽"，
 *   是"这条策略机制**不该管**非 Hob 会话"。
 */
function presetOfSession(hostCtx: any, session: any): { preset: string | undefined; source: 'projection' | 'none' } {
  /**
   * ⚠⚠ **只认宿主投影，⛔ 不退回 `session.header.agentPreset`。**
   *
   * ── 为什么连兜底都不许（本轮实测被机检 J4 咬住）──────────────────────
   *   本仓既有纪律：`header.agentPreset` 是**建档那一刻**的事实（宿主定义原文
   *   "a creation fact … a session may still change preset while it is blank"），
   *   ⇒ 全仓**只允许 `src/modules/bus.ts` 的降级分支**读它一处；其余任何地方读都算违规
   *   （`check:orch` 的 J4 组逐文件核）。
   *   ⚠ 本文件的第一版曾在这里加过"读建档头兜底" —— **被 J4 当场点出**
   *     （"不凭历史建档头猜"正是需求原文的要求）。⇒ 现在删掉了，连注释里也不写那个字段名，
   *     免得 J4 的逐文件扫描把它当成一处真实读取。
   *
   * ── 投影读不到时怎么办：**当作非 Hob**（保守）───────────────────────
   *   `isHob=false` ⇒ 本机制不参与 ⇒ `base()` 仍回**最低档 + 安全缺省**，
   *   `canReadWorkspace=false`（见 `resolveSessionPolicy` 的 non-hob 分支）。
   *   ⚠ 所以"认不出"的后果只会**更紧**、不会更宽 —— 但会标出来：
   *     这条会话被当作非 Hob 时，`reason` 会说明"投影不可读"，⛔ 不静默。
   *   ⚠ 实际影响面很小：本服务只在 Hob 预设作用域里被消费，
   *     "进得来却读不到投影"本身就是一个应当被告知的状态。
   */
  try {
    const projections = typeof hostCtx.get === 'function' ? hostCtx.get('sessionProjections') : undefined
    if (projections !== undefined && typeof projections?.stateOf === 'function') {
      const v = projections.stateOf(session, 'agentPreset')
      if (typeof v === 'string' && v !== '') return { preset: v, source: 'projection' }
    }
  } catch { /* 投影不可读 ⇒ 按"认不出"处理（保守） */ }
  return { preset: undefined, source: 'none' }
}

/**
 * Hob 预设的 id。
 *
 * ⚠⚠ **必须是 `shared/planning-preset.ts` 的那一个常量，⛔ 不许在这里再写一次字面值。**
 *   本仓的既定纪律（机检 `check:presets` ⑦ 组钉着）：`'Hob'` 这个字面值**全仓只有一处**，
 *   因为"新建会话默认不作候选"（client）与"派活不套用规划侧预设"（host）**两个消费方
 *   分属两个编译单元**，各写一份必然漂。
 *   ⚠ 本轮我一度在这里新写了一个字面值 —— **被 ⑦ 组当场咬出来**（不是想当然的合规）。
 *   ⇒ 现在改成 import 复用；本文件**不再持有**这个值。
 */
export { HOB_PRESET_ID } from './shared/planning-preset.ts'

/**
 * 判定本次策略文件路径：`<账本目录>/runtime/session-policy.json`。
 *
 * ⚠ 账本根解析**复用既有唯一实现**（`resolveLedgerRoot` + `declaredLedgerHome`）：
 *   ⛔ 不在这里另写一份路径推导（那必然与 `orch-watches.json` 那条漂）。
 * ⚠ 判不出 ⇒ `undefined`（⇒ 保守分支），⛔ 不猜、⛔ 不退回 cwd。
 */
function policyFileFor(hostCtx: any, session: any): string | undefined {
  try {
    const cwd = session?.header?.cwd
    const root = resolveLedgerRoot('', declaredLedgerHome(hostCtx), typeof cwd === 'string' ? cwd : undefined)
    return root === undefined ? undefined : policyStateFileOf(root)
  } catch {
    return undefined
  }
}

/**
 * 判定**「被拦记录」文件**的路径（`<账本目录>/runtime/session-policy-blocks.json`）。
 *
 * ⚠ **与 {@link policyFileFor} 同源同派生**：同一个 `resolveLedgerRoot` + 同一个
 *   `declaredLedgerHome` + 同一个会话 cwd ⇒ 两者**必然落在同一个账本**里
 *   （这是"与既有运行态同一处或相邻"的**结构**保证，⛔ 不是两个函数各写一遍路径）。
 * ⚠ 判不出 ⇒ `undefined`（⇒ 记不上；闸门会打一条可读 warn，⛔ 不静默）。
 */
function policyBlockFileFor(hostCtx: any, session: any): string | undefined {
  try {
    const cwd = session?.header?.cwd
    const root = resolveLedgerRoot('', declaredLedgerHome(hostCtx), typeof cwd === 'string' ? cwd : undefined)
    return root === undefined ? undefined : policyBlockFileOf(root)
  } catch {
    return undefined
  }
}

/**
 * 枚举**已知的策略文件**（会话已不可见时用来找"它可能写在哪个账本里"）。
 *
 * ⚠ **只用既有的派生口径**，⛔ 不另造一份路径规则：
 *   工作区注册表里的每个工作区 → 它的目录 → `resolveLedgerRoot` → `policyStateFileOf`。
 * ⚠ 注册表读不到 / 没有工作区 ⇒ 返回空数组（调用方据此**如实报"无法隔离"**，
 *   ⛔ 不许猜一个路径去写）。
 * ⚠ 去重：同一账本可能被多个工作区指到。
 */
function knownPolicyFiles(hostCtx: any): string[] {
  const out = new Set<string>()
  try {
    const ws = hostCtx.get?.('workspaceRegistry') ?? hostCtx.workspaceRegistry
    const list = typeof ws?.list === 'function' ? ws.list() : undefined
    if (!Array.isArray(list)) return []
    for (const w of list) {
      // ⚠ 工作区目录字段名可能有几种；**逐个试已知字段**，⛔ 不猜别的语义
      const dir = typeof w?.path === 'string' && w.path !== ''
        ? w.path
        : typeof w?.directory === 'string' && w.directory !== '' ? w.directory : undefined
      if (dir === undefined) continue
      const root = resolveLedgerRoot('', declaredLedgerHome(hostCtx), dir)
      if (root !== undefined) out.add(policyStateFileOf(root))
    }
  } catch { /* 读不到 ⇒ 空 */ }
  return [...out].sort()
}

/**
 * 挂载服务。
 *
 * @param ctx - **插件入口作用域**的 ctx（harness 的整体装配面）。
 * @param deps - **入口注入的现读值**（2026-10-24 · 治"装配期 strict get 恒 undefined"）。
 *
 * ══ 为什么需要 `deps.workMode`（别再只靠 `ctx.get('hobWorkMode')`）══════════
 *   `installSessionPolicy` 由插件入口 `apply` 调用，而 **apply 期 fiber.state === 1**
 *   （还没有"已装载"），而 cordis 的 `ctx.get(name, strict = true)` **只返回
 *   `impl.fiber.state === 2` 的实现**（`@deepseek-ai/cordis/lib/index.js:763-771`）。
 *   ⇒ 在 `apply` 里 `ctx.get('hobWorkMode')` **恒 undefined**（那个服务是本进程入口
 *     `provide` 的、此刻 state=1）。
 *   ⇒ 后果（实测）：迁移时抓不到旧全局值 ⇒ 用安全缺省 `auto` 落盘
 *     ⇒ 用户设的**全局 multi 被静默改写成 auto**（盘上 workMode=auto）。
 *   ⇒ 修法（裁定方案 A）：**由入口把 `workMode(config)` 现读结果传进来**，
 *     服务不再依赖"装配期能不能 get 到"这件事。
 *   ⚠ `deps.workMode` 是**闭包**（不是快照）：迁移只会在第一次抓取时调它一次，
 *     之后固化成 `legacyModeSnapshot`（见下）—— "切换那一刻的值"仍然只读一次。
 *
 * ⚠ 不传 `deps`（旧组合 / 单测）⇒ 回落到 `ctx.get('hobWorkMode', false)`（第二参 = 非 strict）：
 *   **非 strict** 只在这里当"拿不到显式注入时的兜底"，⛔ 不是主要通路。
 *   ⚠ 只改 `get(name,false)` 而**不改入口传参**是本轮明确**不接受**的半修：
 *     它能在 apply 期拿到值，但拿到的是"此刻" → 与"切换那一刻"仍是同一个时刻，
 *     真正的问题是**依赖装配期时序**；显式注入把这件事从时序里拿出来了。
 */
export function installSessionPolicy(
  ctx: Context,
  deps?: {
    /** 入口的现读闭包（`() => workMode(config)`）；⚠ 每次调都返回当前值。 */
    workMode?: () => unknown
  },
): void {
  const hostCtx = ctx as any
  /**
   * ⚠⚠ **本进程的安装时刻**（2026-10-24 · 纪元必须可信的"下界"）。
   *
   * 用途：策略文件里**没有**合法 `migrationEpoch` 时（首次运行 / 手写坏了），
   * 用它当"本插件第一次看到这个账本"的时刻——比"读的那一刻"安全：
   *   · 早于"本进程之后建的会话" ⇒ 新会话仍判新；
   *   · 晚于"本进程启动前就存在的老会话" ⇒ 旧会话仍判旧。
   * ⚠ 它**会在解析前被落盘**（`ensurePolicyStoreEpoch`），⛔ 不只是内存值。
   */
  const installEpoch = Date.now()

  /**
   * ⭐ **2026-10-31 P37**：装"会话销毁 ⇒ 清暂存"监听。
   * ⚠ 放在最前：即使后面的迁移/策略初始化抛错，**清理也不能漏装**
   *   （漏装的后果是消息留到进程重启，与初始化成不成功无关）。
   */
  installSessionDisposeCleanup(ctx)

  /**
   * 迁移触发器的一次性闸门 + 最近一次报告（⚠ 诊断与"如实说没保住"都要它）。
   * ⚠ 它**不是**缓存策略结果 —— 策略始终从磁盘现读；这里只记"枚举/迁移做过没有"。
   */
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * ⚠⚠ **切换时刻的工作方式快照 —— 本轮修复的核心**（2026-10-22 第 4 轮）
   * ══════════════════════════════════════════════════════════════════════════
   *
   * ── 上一版错在哪（真竞态，不是理论）──────────────────────────────────
   *   `ensureLegacyMigrationOnce()` 先把 `legacyScanDone=true` / `migrationState='running'`
   *   **同步**设好，然后 `void (async …)` 才开始枚举。而 `resolveFor` 紧接着**同步**
   *   调 `resolveSessionPolicy` —— 那一刻迁移**必然还没跑**，于是旧会话拿到
   *   `defaultMode`（`auto`）⇒ 第一次 prompt 就按 `auto` 派活。
   *   ⚠ `reason` 里写"迁移未完成"**撤销不了**这个行为变化 —— 值已经交出去了。
   *
   * ── 修法：**在拿到异步结果之前，就把原值固定下来** ────────────────────
   *   安装时（`installSessionPolicy`，仍在同步段里）**同步**读一次旧全局工作方式，
   *   存进下面这个 `legacyModeSnapshot`。此后它**永不重读**
   *   （⛔ 不是"每次现读全局值"—— 那会让用户改配置影响已迁/待迁会话）。
   *   ⇒ 无论迁移有没有跑完，旧会话都能拿到**原值**，只是 `persistence` 标 `snapshot`。
   *
   * ⚠ 为什么要在这里（同步段）抓，而不是等异步迁移里抓：
   *   异步迁移可能在 `await listSessions()` 之后才跑，那时用户**可能已经改过**全局设置
   *   ⇒ 抓到的就不是"切换时"的值了。**快照的定义就是"切换那一刻"**。
   *
   * ══════════════════════════════════════════════════════════════════════════
   * ⚠⚠ **2026-10-24 · 修「没抓到 / 抓到空」两个状态被同一个变量兼作**
   * ══════════════════════════════════════════════════════════════════════════
   * ── 改前错在哪（实测 multi→single 落盘）────────────────────────────
   *   上一版只有 `let legacyModeSnapshot: string | undefined`，而"抓过一次但没抓到"
   *   与"还没抓过"**都是 `undefined`** ⇒ 每次 `captureLegacyModeSnapshot()` 都会**重读全局**。
   *   ⇒ 第一次抓失败（装配期 strict get 恒 undefined，见上）、第二次（重试时）抓成功，
   *     而那时用户已经改过值 ⇒ 固化下来的**不是切换那一刻的值**，而是"后来某刻的值"
   *     （实测：旧全局从 multi 改成 single，迁移落盘 workMode=single）。
   *
   * ── 现在：两个状态分开 ─────────────────────────────────────────────
   *   · `legacySnapshotTried`  —— **是否已经尝试抓取过**（⛔ 一旦为 true 绝不再读全局）；
   *   · `legacyModeSnapshot`  —— **抓到的值**（可能仍是 `undefined` = 抓过但没抓到）。
   *   ⇒ 抓取是**严格一次性**：失败也只失败一次，之后一律用"没抓到"这条结论。
   */
  let legacySnapshotTried = false
  let legacyModeSnapshot: string | undefined

  /**
   * 一次性读取并固定快照（⚠ 严格幂等：**尝试过就不再读全局**，抓不到也不重试）。
   *
   * ⚠ 取值顺序：**入口注入的闭包** →（缺席时）`ctx.get('hobWorkMode', false)`。
   *   前者是主通路（裁定方案 A，见函数头）；后者只兜旧组合。
   */
  const captureLegacyModeSnapshot = (): void => {
    if (legacySnapshotTried) return
    legacySnapshotTried = true
    const v = (() => {
      try {
        // ① 主通路：入口注入的现读闭包（不依赖 fiber.state / 装配时序）
        if (typeof deps?.workMode === 'function') {
          const raw = deps.workMode()
          if (typeof raw === 'string' && raw !== '') return raw
        }
        /**
         * ② 兜底：非 strict get（`false` 第二参）—— 旧组合 / 单测路径。
         *    ⚠ **只在这里**允许非 strict；产品路径的取值已经由 ① 保证。
         */
        const fallback = hostCtx.get?.('hobWorkMode', false)
        const raw = typeof fallback === 'function' ? fallback() : fallback
        return typeof raw === 'string' && raw !== '' ? raw : undefined
      } catch { return undefined }
    })()
    // ⚠ 只接受合法枚举（`auto`/`single`/`multi`）；非法值 ⇒ 当"没抓到"
    legacyModeSnapshot = v !== undefined && WORK_MODE_VALUES.includes(v as any) ? v : undefined
  }

  let legacyScanDone = false
  /**
   * ⚠ 迁移尝试次数（2026-10-22 第 4 轮）：**有界重试**。
   *
   * ── 上一版的缺陷 ────────────────────────────────────────────────────
   *   失败一次就把 `legacyScanDone` 永久置 true ⇒ 若安装时 `sessionQuery` /
   *   `sessionProjections` 还没就绪（它们是**别的 fiber 并行提供**的，本仓 E-96
   *   同款教训），这一进程**再也不会重试** ⇒ 旧会话的工作方式永久停在"未保全"，
   *   而日志只有一行 warn。
   *
   * ── 现在 ────────────────────────────────────────────────────────────
   *   每次 `resolveFor` 发现"还能再试"就再踢一次（上限见 `LEGACY_MAX_ATTEMPTS`）。
   *   ⚠ **快照不变**：重试用的是**同一份** `legacyModeSnapshot`
   *     ⇒ "抓到的 workMode 仍是第一次切换时同一份快照"（任务书原文要求）。
   *   ⚠ 用**次数**而不是"每次读都试"来限：避免一次会话里几百次工具调用把枚举打爆。
   */
  const LEGACY_MAX_ATTEMPTS = 5
  let legacyAttempts = 0
  /** ⚠ 上次失败是不是"依赖还没就绪"（可重试）—— 与"真错了"（重试无益）分开。 */
  let legacyRetryable = false

  let lastMigration: MigrationReport = {
    ran: false, ok: true, migrated: [], perFile: [], failed: [], reason: '',
  }

  /** 对外可见的迁移报告（⚠ 只读快照）。 */
  interface MigrationReport {
    /** 本次进程里**真正执行过**枚举+迁移吗（⚠ false 也可能是"还没到第一次读"）。 */
    ran: boolean
    /** 失败时为 false ⇒ 调用方**必须**把 `reason` 说出来。 */
    ok: boolean
    migrated: string[]
    perFile: ReadonlyArray<{
      file: string
      migrated: string[]
      skipped: string[]
      ok: boolean
      reason: string
    }>
    failed: ReadonlyArray<{ file: string; reason: string }>
    reason: string
  }

  /**
   * ⚠⚠ **可信旧会话枚举 + 逐工作区一次性固化**（2026-10-22 第 3 轮）。
   *
   * ── 数据从哪来（每一环都是**宿主官方接口**，⛔ 不自造）──────────────────
   *   · **枚举**：`sessionQuery.listSessions()` —— 宿主原文："List the complete logical
   *     corpus with live precedence"（`dsh-session-query/lib/index.js:95` / `:1072`），
   *     **含磁盘上已存在但当前没进内存的会话**（`records.set(header.id, {live:false,persisted:true})`，`:107-115`）。
   *     ⚠ 这正是"旧会话"的来源：它们在重启后**未必**在 `sessions.list()` 里
   *     （那是**活会话**表），但一定在持久层里。
   *   · **投影**：`sessionProjections.stateOf(session, 'agentPreset')` 需要**活的 Session 对象**。
   *     对"磁盘上、未加载"的会话，宿主给的官方读法是
   *     `sessionQuery.observeSession(id, { projectionMode: 'all' })`（`:1064`）——
   *     它内部 `sessions.prepare()` 出一个**不进入活表**的 Session
   *     （`:375-390`），并 `hydrate` 出投影（`:509-513`）。⛔ 不自己扫事件流重放。
   *   · **账本落点**：`policyFileFor(hostCtx, session)` —— 与读路径**同一个函数**
   *     （⛔ 不在这里另写一份路径推导）。
   *   ⇒ 三件都是既有接口；⚠ 本函数**不新增任何消费方**、不碰跨实例。
   *
   * ── 什么才算"要迁移的旧 Hob 会话"（三重确认，缺一不迁）──────────────
   *   ① 投影确证 `agentPreset === 'Hob'`（⛔ 不读 `header.agentPreset`，那是建档事实）；
   *   ② `createdAt < migrationEpoch`（旧会话；⚠ 判不出 createdAt ⇒ **不迁**，见下）；
   *   ③ 账本落点判得出（`policyFileFor` 非空）。
   *   ⚠ 这条"缺一不迁"很重要：迁错的代价是**把非 Hob 的会话写成 Hob 策略**，
   *     或**把一个没选的会话写成选过了**。
   *
   * ── ⚠ 工作方式快照：**只读一次** ────────────────────────────────────
   *   `hobWorkMode()` 现在仍是实例级全局值（`config.workMode.mode`）。
   *   在**这次调用**里读一次、传给每一组，⛔ 不在循环里现读
   *   ⇒ 之后用户改全局设置**不会**影响任何已迁移会话（这是 `REQ-04` 明文要求）。
   *
   * ── ⚠ 失败时绝不假装成功 ────────────────────────────────────────────
   *   · 枚举取不到（没有 `sessionQuery` 服务 / 抛错）⇒ `ok:false` + 明确原因，
   *     **且不再重试**（避免每次读都去撞一个不存在的服务）；
   *   · 某工作区写失败 ⇒ 那一组 `ok:false`，其余组各自成败（逐文件报告）；
   *   · 任何失败 ⇒ **读档仍然是 `ledger`**（`resolveSessionPolicy` 本来就对无记录旧会话回最低档），
   *     但 `reason` 里会写明"工作方式**未保全**" —— ⛔ 不悄悄给 `auto` 了事。
   */
  /**
   * ── **O-13：这个函数**从来没被调用过**，已删除** ──────────────────────────
   *
   * ⚠ 改前这里有一个 `runLegacyMigration(): MigrationReport`（约 34 行），
   *   而**全仓零调用** —— 真正跑迁移的是 {@link migrateAsync}（两处调用：`:812` / `:1634`）。
   *
   * ⚠ **为什么删而不是留**：它和 `migrateAsync` **签名相似、职责重叠**，
   *   读代码的人会以为「同步那条是主路径、异步那条是补充」，而事实相反 ——
   *   **同步那条是死的**。一段指向不存在调用链的代码，消耗的是排查时间。
   *
   * ⚠ **REVIEW 说它「会假报已迁移」不准确**：那段逻辑在 `migrateAsync` 里，
   *   而 `migrateAsync` 是活的。本条只是**删死代码**，⛔ 不改迁移行为。
   *
   * ⛔ **不要「恢复」它**：真要同步迁移，先回答「`resolveFor` 是同步的，
   *   而枚举会话是异步的 —— 怎么在不 await 的前提下拿到全量旧会话」。
   *   那个问题在 `ensureLegacyMigrationOnce` 的注释里已经讨论过，结论是**用异步 + 重试**。
   */

  /** ⚠ 异步迁移的进度（同步读它的只有 `migrationStatus()`）。 */
  let migrationState: 'idle' | 'running' | 'done' | 'failed' = 'idle'
  let migrationDetail = ''

  /**
   * ⚠⚠ **"这个账本文件的纪元已经确认落盘过"**（2026-10-24 · 热路径保护）。
   *
   * ── 为什么要这个记忆 ────────────────────────────────────────────────
   *   `resolveFor` 在**每一次**策略读取时都会跑（六个闸门 + 四个读工具的 `execute`），
   *   而"确认纪元已落盘"要先**读一次文件**。若每次都做，等于把策略读取的磁盘 IO
   *   翻一倍（⚠ 那是本仓明令避免的热路径开销："不阻塞 of()"）。
   *   ⇒ 成功确认过的文件记在这里，之后**一次都不再读**。
   *
   * ⚠ **只在成功时记**：写失败 ⇒ 不记 ⇒ 下次还会再试（失败是异常态，值得重试，
   *   而且那时的 `epochNote` 会把原因带进读数，不会是静默）。
   * ⚠ 它**只是记忆**、不是权威：权威永远是盘上的 `migrationEpoch`（每次解析现读）。
   */
  const epochConfirmed = new Set<string>()

  /**
   * **确认某个策略文件的迁移纪元已落盘**（成功过就空转，⛔ 不重复读盘）。
   *
   * @param file - 策略文件路径。
   * @returns 失败时的可读原因（成功 / 已确认过 ⇒ 空串）。
   */
  const ensureEpochOnce = (file: string): string => {
    if (epochConfirmed.has(file)) return ''
    const ep = ensurePolicyStoreEpoch(file, OPTIONS, Date.now(), installEpoch)
    if (ep.ok) { epochConfirmed.add(file); return '' }
    return ep.reason
  }

  /**
   * **触发器**（同步、幂等、**有界重试**）—— 由 `resolveFor` 在**任何返回值之前**调用，
   * 也由 `installSessionPolicy` 在**安装时**先踢一次。
   *
   * ⚠⚠ **上一版在这里写了一句假保证**（2026-10-22 第 4 轮删掉）：
   *   原文说"放在 `resolveFor` 里 ⇒ **不存在"先回默认、稍后迁移"的窗口**"。
   *   ⚠ 那句**不成立**：本函数一旦 `void (async …)`，`resolveFor` 紧接着就**同步**走
   *     `resolveSessionPolicy` —— 迁移**必然还没跑**。写"不存在这个窗口"是**错的**，
   *     而错的不只是措辞：它让下一个人以为读数的值已经是最终值。
   *   ⇒ 现在的诚实说法：**窗口客观存在**，本函数只能保证"窗口期内给出的值**是原值**"
   *     （靠 `legacyModeSnapshot`），⛔ 不能保证"已经写完盘"。
   *
   * ── ⚠ 它**不阻塞**（`of()` 是同步的，六个闸门都在同步路径上）──────────────
   *   所以：窗口期内的读数标 `persistence='snapshot'`，⚠ 由调用方决定怎么用。
   *   ⚠ 但**行为上不再改写原值** —— 这才是本批要消灭的那件事。
   *
   * ── ⚠ 有界重试（治"依赖晚到就永久放弃"）──────────────────────────────
   *   每次被调时，若"上次失败且可重试"且次数没到上限 ⇒ **再踢一次**。
   *   ⚠ 重试**复用同一份 `legacyModeSnapshot`**（⛔ 不重读全局）
   *     ⇒ 即使依赖晚到很久，固化下来的仍是**切换那一刻**的工作方式。
   */
  const ensureLegacyMigrationOnce = (): void => {
    // ⚠ 快照先抓（同步段）——这是"窗口期内还能给出原值"的唯一依据。
    captureLegacyModeSnapshot()

    const retryable = legacyRetryable && legacyAttempts < LEGACY_MAX_ATTEMPTS
    if (legacyScanDone && !retryable) return

    legacyScanDone = true
    legacyAttempts += 1
    migrationState = 'running'
    legacyRetryable = false

    /** ⚠ 传给迁移的工作方式 = **快照**（⛔ 不现读全局；缺席时才退缺省并如实标注）。 */
    const legacyWorkMode = legacyModeSnapshot ?? DEFAULT_WORK_MODE
    const usedSnapshot = legacyModeSnapshot !== undefined

    void (async () => {
      try {
        const rep = await migrateAsync(legacyWorkMode)
        lastMigration = rep
        migrationState = rep.ok ? 'done' : 'failed'
        migrationDetail = rep.reason
        /**
         * ⚠ **区分"依赖没就绪"（可重试）与"真错了"（重试无益）**：
         *   前者的典型原因是 `sessionQuery` / `sessionProjections` 还没被别的 fiber 提供；
         *   后者是磁盘写失败、坏文件等 —— 再试也是同样结果，白烧 IO。
         *   ⚠ 判据用**可读原因的指纹**，不猜内部状态（迁移报告里就是这么写的）。
         */
        legacyRetryable = !rep.ok && (
          rep.reason.includes('没有 `sessionQuery`')
          || rep.reason.includes('没有 `sessionProjections`')
          || rep.reason.includes('枚举会话失败')
        )
        if (!rep.ok) {
          hostCtx.logger?.warn?.(
            `[dsh-hob] 旧会话工作方式迁移**未完成**（第 ${legacyAttempts}/${LEGACY_MAX_ATTEMPTS} 次`
            + `${legacyRetryable ? '，依赖未就绪、稍后重试' : '，不再重试'}）：${rep.reason}`,
          )
        } else if (rep.migrated.length > 0) {
          hostCtx.logger?.info?.(
            `[dsh-hob] 旧会话工作方式已一次性固化 ${rep.migrated.length} 条`
            + `（读档=最低，工作方式=${usedSnapshot ? '切换时快照' : '缺省值（⚠ 未抓到快照）'}）；`
            + `涉及 ${rep.perFile.filter((f) => f.migrated.length > 0).length} 个账本文件`,
          )
        }
        if (!usedSnapshot) {
          hostCtx.logger?.warn?.(
            '[dsh-hob] ⚠ 没抓到切换时刻的工作方式快照 ⇒ 迁移写入的是安全缺省值；'
            + '旧会话原工作方式**可能已丢失**（这是已知限制，不是"已保全"）',
          )
        }
      } catch (e) {
        migrationState = 'failed'
        migrationDetail = `迁移过程抛错：${String((e as Error)?.message ?? e)}`
        // ⚠ 抛错也当"可重试"（可能是依赖在半途就绪/销毁的瞬时态）
        legacyRetryable = legacyAttempts < LEGACY_MAX_ATTEMPTS
        hostCtx.logger?.warn?.(`[dsh-hob] 旧会话工作方式迁移**失败**：${migrationDetail}`)
      }
    })()
  }

  /**
   * 真正干活的那一半（**异步**）：枚举 → 逐会话三重确认 → 按工作区分组 → 一次性写。
   *
   * @returns 报告（⚠ 失败时 `ok:false` 且 `reason` 可读）。
   */
  const migrateAsync = async (legacyWorkMode: string): Promise<MigrationReport> => {
    const query = (() => {
      try {
        const q = hostCtx.get?.('sessionQuery') ?? hostCtx.sessionQuery
        return typeof q?.listSessions === 'function' ? q : undefined
      } catch { return undefined }
    })()
    if (query === undefined) {
      return {
        ran: true, ok: false, migrated: [], perFile: [], failed: [],
        reason: '宿主没有 `sessionQuery` 服务（或它没有 `listSessions`）⇒ 取不到"全部旧会话"的可信枚举，'
          + '本次**不做迁移**；旧会话的工作方式**未保全**（读档仍按最低档，⛔ 不冒充满意）',
      }
    }

    let records: any[]
    try {
      records = await query.listSessions()
    } catch (e) {
      return {
        ran: true, ok: false, migrated: [], perFile: [], failed: [],
        reason: `枚举会话失败（${String((e as Error)?.message ?? e)}）⇒ 本次不做迁移；`
          + '旧会话工作方式**未保全**（⛔ 不冒充已迁移）',
      }
    }
    if (!Array.isArray(records)) {
      return {
        ran: true, ok: false, migrated: [], perFile: [], failed: [],
        reason: '`listSessions()` 返回的不是数组 ⇒ 枚举不可信，本次不做迁移',
      }
    }

    const projections = (() => {
      try { return hostCtx.get?.('sessionProjections') ?? hostCtx.sessionProjections } catch { return undefined }
    })()
    if (projections === undefined || typeof projections.stateOf !== 'function') {
      return {
        ran: true, ok: false, migrated: [], perFile: [], failed: [],
        reason: '宿主没有 `sessionProjections` 服务 ⇒ **无法投影确证**哪些会话是 Hob；'
          + '本次不做迁移（⚠ 只凭 `header.agentPreset` 猜是明令禁止的）⇒ 旧会话工作方式**未保全**',
      }
    }

    /** 按账本文件分组（⚠ 每个工作区各写自己的文件）。 */
    const groups = new Map<string, Array<{ sessionId: string; createdAt: number | undefined }>>()
    /** 认不出/不是 Hob/判不出落点 ⇒ 逐条记下来（⚠ 要能说出"为什么这条没迁"）。 */
    const notMigrated: Array<{ sessionId: string; why: string }> = []
    let unprojectable = 0

    for (const rec of records) {
      const id = (() => { try { return String(rec?.header?.id ?? '') } catch { return '' } })()
      if (id === '') { notMigrated.push({ sessionId: '(空 id)', why: '枚举记录没有 header.id' }); continue }

      /**
       * ⚠ 取**活 Session 对象**来读投影：
       *   · 已在活表 ⇒ 直接用（快、且是当前真值）；
       *   · 不在活表（磁盘上的旧会话）⇒ `observeSession(id)` 借一个 prepared 租约。
       * ⚠ 租约必须 `[Symbol.dispose]()` 释放（宿主原文：它 pin 住缓存条目）。
       */
      let session: any
      let lease: any
      try {
        const live = (() => {
          try {
            const sessions = hostCtx.get?.('sessions') ?? hostCtx.sessions
            return typeof sessions?.get === 'function' ? sessions.get(id) : undefined
          } catch { return undefined }
        })()
        if (live !== undefined) session = live
        else if (typeof query.observeSession === 'function') {
          lease = await query.observeSession(id, { projectionMode: 'all' })
          /**
           * ⚠ prepared 租约里**没有** `Session` 对象本身（宿主只暴露 header/events/projections）。
           *   ⇒ 读投影时不能用 `stateOf(session, key)`；改用租约里已经 hydrate 好的
           *     `projections.values`（同一份 `sessionProjections.snapshot()` 结果，
           *     见 `dsh-session-query/lib/index.js:466-468` / `:509-513`）。
           */
          session = undefined
        }
      } catch (e) {
        unprojectable += 1
        notMigrated.push({ sessionId: id, why: `取不到该会话（${String((e as Error)?.message ?? e)}）` })
        continue
      }

      /** 读预设：活会话走 `stateOf`；prepared 走租约里的 `projections.values`。⚠ 两者同源。 */
      const preset = (() => {
        try {
          if (session !== undefined) {
            const v = projections.stateOf(session, 'agentPreset')
            return typeof v === 'string' ? v : undefined
          }
          const vals = lease?.projections?.values
          const v = vals !== undefined && vals !== null ? vals.agentPreset : undefined
          return typeof v === 'string' ? v : undefined
        } catch { return undefined }
      })()
      const createdAt = (() => {
        const v = rec?.header?.createdAt
        return typeof v === 'number' && Number.isFinite(v) ? v : undefined
      })()

      try {
        // ⚠ 三重确认之一：投影必须**明确**是 Hob（认不出 ⇒ 不迁，⛔ 不猜）
        if (preset === undefined) {
          unprojectable += 1
          notMigrated.push({ sessionId: id, why: '预设投影取不到（无法确证是 Hob）⇒ 不迁' })
          continue
        }
        if (preset !== HOB_PRESET_ID) {
          notMigrated.push({ sessionId: id, why: `预设是 ${JSON.stringify(preset)}（非 Hob）⇒ 不写 Hob 策略` })
          continue
        }
        // ⚠ 判不出创建时刻 ⇒ 不迁（⛔ 不能把"可能是新会话"写成"已迁移"）
        if (createdAt === undefined) {
          notMigrated.push({ sessionId: id, why: '创建时刻取不到 ⇒ 无法区分新旧会话，不迁' })
          continue
        }
        // ⚠ 账本落点：借一个"够用的 Session 形状"给 `policyFileFor`（它只读 `header.cwd`）
        const cwd = (() => { try { return rec?.header?.cwd } catch { return undefined } })()
        const file = policyFileFor(hostCtx, { header: { cwd } })
        if (file === undefined) {
          notMigrated.push({ sessionId: id, why: '判不出账本落点 ⇒ 不迁（⛔ 不猜路径）' })
          continue
        }
        const arr = groups.get(file) ?? []
        arr.push({ sessionId: id, createdAt })
        groups.set(file, arr)
      } finally {
        // ⚠ 释放租约（不释放会 pin 住宿主的 prepared 缓存）
        try { lease?.[Symbol.dispose]?.() } catch { /* 释放失败不影响判定 */ }
      }
    }

    if (groups.size === 0) {
      return {
        ran: true, ok: true, migrated: [], perFile: [], failed: [], reason: '',
        // ⚠ 注意：没有可迁的不是失败（可能是"已经全迁过"或"确实没有旧 Hob 会话"）
      }
    }

    /**
     * ⚠⚠ **迁移前先把纪元落盘**（2026-10-24 · 与 `resolveFor` 同一件事的"更早的入口"）。
     *
     * 为什么必须在这里也做：迁移是**第一个**写策略文件的路径（`installSessionPolicy` 里就踢）。
     * 若那时文件还没有纪元，`ensureLegacyMigratedByFile` 会把**读的那一刻**当纪元写下去
     * ⇒ 之后"安装后、该写入前"建出来的会话会被判成旧会话。
     * ⇒ 用 `installEpoch`（本进程安装时刻）当纪元：比这些会话早 ⇒ 它们仍判新。
     * ⚠ 写失败**不阻断迁移**（迁移本身仍会尽力而为），但会把原因并进报告（⛔ 不静默）。
     */
    const epochFailures: string[] = []
    for (const file of groups.keys()) {
      const why = ensureEpochOnce(file)
      if (why !== '') epochFailures.push(`${file}: ${why}`)
    }

    const byFile = ensureLegacyMigratedByFile(
      [...groups.entries()].map(([file, sessions]) => ({ file, sessions })),
      legacyWorkMode,
      OPTIONS,
      Date.now(),
      installEpoch,
    )
    return {
      ran: true,
      ok: byFile.ok && epochFailures.length === 0,
      migrated: byFile.migrated,
      perFile: byFile.perFile,
      failed: [
        ...byFile.failed.map((f) => ({ file: f.file, reason: f.reason })),
        ...epochFailures.map((x) => ({ file: x.slice(0, x.indexOf(': ')), reason: `迁移纪元未能落盘（${x}）` })),
      ],
      reason: [byFile.reason, ...(epochFailures.length > 0 ? [`迁移纪元落盘失败：${epochFailures.join('；')}`] : [])]
        .filter((s) => s !== '').join('；'),
    }
  }

  /** 内部解析（所有对外方法共用这一个，⛔ 不各写一份）。 */
  const resolveFor = (session: any): PolicyResolution => {
    const sessionId = (() => {
      try {
        const id = session?.id
        return typeof id === 'string' && id !== '' ? id : undefined
      } catch { return undefined }
    })()
    /**
     * ⚠⚠ **迁移触发器：先于任何"需要保留原工作方式"的读取**（2026-10-22 第 3 轮）。
     *
     * ── 为什么放在 `resolveFor` 里、而不是"启动时跑一次" ──────────────────
     *   ① 启动时**未必**读得到持久层（`sessionPersistence` / `sessionQuery` 由别的 fiber
     *      并行激活，谁先就绪不保证 —— 本仓 E-96 同款教训）；
     *   ② 但"旧会话第一次 `get/of`"**一定**发生在有人要用它的策略时，
     *      而且**一定早于**那个返回值被拿去决定工作方式。
     *   ⇒ 放在这里 ⇒ **不存在"先回默认、稍后迁移"的窗口**：
     *     第一次读就可能触发迁移，迁移失败的结论**随本次返回值一起给出**（见 `migration` 字段）。
     *
     * ── ⚠ 它**不能**让读取变慢到不可用 ──────────────────────────────────
     *   迁移只在**每个工作区的策略文件**上做一次（成功后有记录 ⇒ 后续全是"跳过"）；
     *   且**进程内只枚举一次**（`legacyScanDone`）。⚠ 第二次以后连枚举都不做。
     *
     * ── ⚠ 失败时**必须**显式可见 ────────────────────────────────────────
     *   "没保住原工作方式"不能静默：报告存进 `lastMigration`，
     *   读数的 `reason` 里也会带上（见下面 `resolveFor` 尾部）。
     */
    ensureLegacyMigrationOnce()

    const preset = session === undefined ? { preset: undefined, source: 'none' as const } : presetOfSession(hostCtx, session)
    const isHob = preset.preset === HOB_PRESET_ID
    /**
     * ⚠⚠ **读宿主的持久归档集合**（2026-10-22 · 本单第二核心）。
     *
     *   为什么必须在这里读：创建失败时若 `quarantine` 写失败、改用
     *   `archiveSession` 兜底，那么 policy.json 里可能**还写着 `active:workspace`**。
     *   ⇒ 只有把归档标志喂进解析，才会压到最低档；否则四个读工具照读高档。
     *
     *   ⚠ 只读**宿主权威** `workspaceRegistry.archivedSessionIds`（同步 getter），
     *     ⛔ 不自己缓存（会与宿主漂移）、⛔ 不猜。
     *
     * ── ⚠⚠ 三态（2026-10-22 第 13 轮 · 修 fail-open）──────────────────────
     *   **上一版**：读不到就 `return undefined` ⇒ 解析当成"未归档"⇒ **放行 workspace**
     *   ⇒ 服务缺席/抛错时，直接点名读工具就绕过了宿主 pre-step。⛔ 那是 fail-open。
     *   **现在**：只有**从可信服务读到有效数组**、且该 id **明确不在**里时，
     *     才给 `'not-archived'`（唯一能放宽的状态）；
     *     其余一切（缺席 / 抛错 / 非数组 / 无身份）⇒ `'unknown'` ⇒ **拒宽读**。
     *   ⚠ 只对**本会话 id** 判（`includes` 精确匹配，id 全局唯一）⇒ ⛔ 不误伤别的会话。
     */
    /**
     * ⚠ 为**诊断**记下"为什么是 unknown"（⛔ 不影响判定：判定一律 `unknown`）。
     *   ⚠ 任务书要求"显示可读原因，区分真的已归档和'宿主归档状态读不到'"。
     */
    let archiveWhy = ''
    const archiveState: ArchiveState = (() => {
      if (sessionId === undefined) { archiveWhy = '没有可信会话身份'; return 'unknown' }
      try {
        const reg = hostCtx.get?.('workspaceRegistry') ?? hostCtx.workspaceRegistry
        if (reg === undefined) { archiveWhy = '宿主 `workspaceRegistry` 服务不可用'; return 'unknown' }
        const ids = reg.archivedSessionIds
        // ⚠ **必须是数组**才算"可信读到"；其它类型一律不可信（⛔ 不当空集合）
        if (!Array.isArray(ids)) {
          archiveWhy = `\`archivedSessionIds\` 不是数组（实际 ${ids === null ? 'null' : typeof ids}）`
          return 'unknown'
        }
        return ids.includes(sessionId) ? 'archived' : 'not-archived'
      } catch (e) {
        archiveWhy = `读取 \`archivedSessionIds\` 抛错：${String((e as Error)?.message ?? e)}`
        return 'unknown'
      }
    })()
    /**
     * ⚠⚠ **先让"迁移纪元"真的落盘，再解析**（2026-10-24 · 治"纪元从不落盘"）。
     *
     * ── 为什么必须在这里、且必须在 `resolveSessionPolicy` **之前** ──────────
     *   解析要拿纪元区分"旧会话 / 新会话"。改前纪元只在内存里由 `now` 临时充当
     *   ⇒ 任何刚建的会话都 `createdAt < epoch` ⇒ 被判成旧会话并放行（实测 1 秒前建的会话即中招）。
     *   ⇒ 现在：**首次接触到某个账本的策略文件时就把纪元写进去**
     *     （文件里有合法纪元 ⇒ 本函数空转，幂等；⛔ 不会改别人的记录）。
     *
     * ⚠ **只对 Hob 且有身份时才做**：
     *   · 非 Hob 会话 ⇒ 本机制不参与 ⇒ ⛔ 不许为它凭空建出账本策略文件；
     *   · 没有 sessionId ⇒ 判不出落点 ⇒ 什么都不写。
     * ⚠ 写失败**不阻断解析**（读数仍会给出 `unknown-legacy` / 保守分支），
     *   但原因会拼进 `reason`（⛔ 不静默）。
     */
    const file = session === undefined ? undefined : policyFileFor(hostCtx, session)
    let epochNote = ''
    if (isHob && sessionId !== undefined && file !== undefined) {
      const why = ensureEpochOnce(file)
      if (why !== '') epochNote = `；⚠ 迁移纪元未能落盘（${why}）`
    }
    const resolved = resolveSessionPolicy({
      ...OPTIONS,
      file,
      sessionId,
      isHob,
      archived: archiveState,
      createdAt: session === undefined ? undefined : createdAtOf(session),
      /**
       * ⚠⚠ **纪元的下界**：盘上没有合法纪元时用它（= 本进程安装时刻）。
       *   理由见 `ResolveOptions.fallbackEpoch` 与上面 `installEpoch` 的注释。
       *   ⚠ 正常情况下这里用不上（上面 `ensurePolicyStoreEpoch` 已经把纪元落盘了），
       *     它只覆盖"落盘失败 / 文件是坏的"这类情形。
       */
      fallbackEpoch: installEpoch,
      /**
       * ⚠⚠ **把切换时刻的快照传下去**（2026-10-22 第 4 轮 · 本轮修复的落点）。
       *
       *   `ensureLegacyMigrationOnce()` 已经**同步**抓过 `legacyModeSnapshot`，
       *   所以即使异步迁移此刻还在跑（甚至失败），这里也能给出**原值**。
       *   ⛔ 上一版没有这个参数 ⇒ 旧会话只能拿到 `defaultMode`（`auto`）
       *   ⇒ 第一次 prompt 就按 `auto` 派活，`reason` 写什么都已经晚了。
       *
       * ⚠ 缺席时（比如安装时也没读到全局值）`resolveSessionPolicy` 走 `unknown-legacy`
       *   + `mayProceed=false` —— 安全停下，⛔ 不拿 `auto` 顶替。
       */
      legacyWorkModeSnapshot: legacyModeSnapshot,
    })
    /**
     * ⚠ **把"为什么归档状态不可知"补进人读原因**（2026-10-22 第 13 轮）。
     *   ⚠ 只改**诊断文本**，⛔ 不改判定（判定已在 resolver 里定死）。
     *   ⚠ 让用户能区分"真的已归档"（宿主的正常状态）与"归档状态读不到"（服务问题）。
     */
    const resolvedWithWhy = archiveState === 'unknown' && archiveWhy !== ''
      ? { ...resolved, reason: `${resolved.reason}（⚠ 归档状态读不到的原因：${archiveWhy}）` }
      : resolved
    /**
     * ⚠ 认不出预设（投影不可读 / 该会话没有 `agentPreset` 投影）⇒ 按**非 Hob** 走，
     *   并**说清"认不出"这件事**（⛔ 不静默把它当作普通非 Hob 会话）。
     *   ⚠ 读数方向仍然只会更紧：`base()` 给的是**最低档 + 安全缺省**、`canReadWorkspace=false`。
     */
    if (!isHob) {
      const why = session === undefined
        ? '没有会话对象 ⇒ 按非 Hob 处理（最低档 + 安全缺省工作方式）'
        : '认不出本会话的预设（宿主 `agentPreset` 投影不可读）⇒ 按非 Hob 处理'
      // ⚠ 非 Hob 不受归档三态影响 ⇒ 用原 `resolved`（不带归档诊断）
      return { ...resolved, reason: why }
    }
    // ⚠ **Hob 路径**：后续一律用带"归档为何不可知"诊断的版本（⚠ 只影响文案）
    const hobResolved = resolvedWithWhy
    /**
     * ⚠⚠ **"工作方式没保住"必须随读数一起说出来**（2026-10-22 第 3 轮）。
     *
     * ── 为什么这条不能省 ────────────────────────────────────────────────
     *   `resolveSessionPolicy` 对"无记录的旧会话"回的是 `ledger + defaultMode`（安全缺省）。
     *   ⚠ 如果迁移成功，这个分支**不会被走到**（记录已存在 ⇒ `source='stored'`）。
     *   ⇒ 一旦**走到这个分支且是旧会话**（`source='legacy-migrated'` 且 `createdAt < epoch`），
     *     说明**迁移没有把它救回来** —— 此时绝不能只给个 `auto` 就完事，
     *     必须让读者知道"这条会话原来的工作方式**没保住**"。
     *
     * ⚠ 三种"没保住"的原因各说各的（⛔ 不合并成一句"迁移失败"）：
     *   · 枚举/投影不可用 ⇒ 根本不知道有哪些旧会话；
     *   · 迁移正在进行 ⇒ 还来得及，但**此刻**读数不是最终值；
     *   · 某工作区写失败 ⇒ 那个工作区的记录落不下去（`lastMigration.failed` 点名）。
     */
    /**
     * ⚠⚠ **本轮修正了这一段的口径**（2026-10-22 第 4 轮）。
     *
     * ── 上一版这里写的什么、错在哪 ──────────────────────────────────────
     *   它写"此刻的工作方式是**安全缺省**、非最终值" —— 诚实，但**不够**：
     *   值已经是 `auto` 了，调用方拿它去派活，行为**已经变了**。
     *   ⚠ "如实说明"**不能替代**"行为正确"。
     *
     * ── 现在 ────────────────────────────────────────────────────────────
     *   · `persistence='snapshot'` ⇒ 值**是原值**，只差"还没写盘"
     *     ⇒ 说清"尚未持久化"，⛔ 不说"是缺省值"（那是事实错误）；
     *   · 迁移已失败且**没抓到快照** ⇒ `mayProceed=false`（`resolveSessionPolicy` 已定），
     *     `reason` 把失败原因带上；
     *   · 迁移跑过但**这条**没写进去（投影认不出 / 判不出落点）⇒ 同样 `mayProceed=false`
     *     （值不可信），并点名逐条原因。
     */
    if (hobResolved.source === 'legacy-migrated' || hobResolved.source === 'unknown-legacy') {
      const tail = (() => {
        if (hobResolved.persistence === 'snapshot' && resolved.mayProceed) {
          // ⚠ 值可信（原值快照），只是没写盘 —— 两种进行时分别说
          if (migrationState === 'running') {
            return '；⚠ 迁移正在进行，**持久化尚未完成**'
              + '（⚠ 值本身是切换时刻的原值，不会稍后被改成缺省）'
          }
          if (migrationState === 'failed') {
            return `；⚠⚠ 迁移失败（${migrationDetail || '原因未记录'}）⇒ **持久化尚未完成**，`
              + '当前用的是进程内原值快照；重启后会再次尝试迁移'
          }
          if (migrationState === 'idle') {
            return '；⚠ 迁移尚未触发 ⇒ **持久化尚未完成**（值本身是原值快照）'
          }
          return '；⚠ 本条旧会话**没有**被写成记录（迁移已跑过）⇒ **持久化尚未完成**，'
            + '当前用的是进程内原值快照；原因通常是"投影认不出它是 Hob"或"判不出账本落点"（见诊断日志）'
        }
        // ⚠ 这里 = 值不可信 ⇒ 已经/应当被 `mayProceed=false` 拦住
        if (migrationState === 'failed') {
          return `；⚠⚠ 旧会话工作方式**未保全**且**无法确定原值**（迁移失败：${migrationDetail || '原因未记录'}）`
            + ' ⇒ **本次不推进**（⛔ 不拿安全缺省冒充）'
        }
        return '；⚠⚠ **无法确定该旧会话的原工作方式** ⇒ **本次不推进**'
          + '（⛔ 不拿安全缺省 auto 当最终方式 —— 那会静默改变原工作方式）'
      })()
      return { ...hobResolved, reason: hobResolved.reason + tail + epochNote }
    }
    return epochNote === '' ? hobResolved : { ...hobResolved, reason: hobResolved.reason + epochNote }
  }

  const service: SessionPolicyInbound & {
    /** 各闸门用的快速入口（`session` 可以是 `undefined` ⇒ 保守）。 */
    of(session: any): PolicyResolution
    /**
     * 旧会话迁移的**当前状态**（只读；⚠ 供诊断/报告"保住了没有"）。
     *
     * ⚠ 上一版这里叫 `migrateLegacy(sessions)` —— 它收**调用方给的一份会话列表**，
     *   并**用第一条决定账本文件**、把全部 rows 写进去。那个签名本身就是缺陷：
     *   · 没有任何真实调用方（`src/` 里只有声明/实现）；
     *   · 一旦有人真接上全局列表，就**跨工作区串写**、**非 Hob 混入**。
     *   ⇒ 本轮**删掉那个签名**，改成"服务自己从宿主可信枚举取，按工作区分组"。
     *     ⛔ 不再保留一个"收任意列表"的入口 —— 那种入口迟早被误用。
     */
    migrationStatus(): {
      state: 'idle' | 'running' | 'done' | 'failed'
      detail: string
      ran: boolean
      ok: boolean
      migrated: string[]
      perFile: ReadonlyArray<{ file: string; migrated: string[]; skipped: string[]; ok: boolean; reason: string }>
      failed: ReadonlyArray<{ file: string; reason: string }>
      reason: string
    }
    /** 立刻（重新）触发一次迁移（⚠ 幂等；给测试与诊断用，⛔ 产品路径不必调）。 */
    migrateNow(): Promise<{ migrated: string[]; perFile: any[]; failed: any[]; ok: boolean; reason: string }>
    /**
     * ⚠ **把被闸门拦下的消息按原顺序重投**（2026-10-29 · 包 CA）。
     *   ⚠ 调用方须**先确认策略已写成功**（`set()` 回 ok）再调本函数。
     */
    requeue(sessionId: string): Promise<{ ok: boolean; replayed: number; remaining: number; reason: string }>
  } = {
    of: (session: any) => resolveFor(session),

    get(session: any): SessionPolicyView {
      const r = resolveFor(session)
      const sid = (() => { try { return typeof session?.id === 'string' ? session.id : '' } catch { return '' } })()
      const file = session === undefined ? undefined : policyFileFor(hostCtx, session)
      const reading = file === undefined ? undefined : readPolicyStore(file, OPTIONS)
      return {
        sessionId: sid,
        isHob: r.isHob,
        level: r.level,
        workMode: r.workMode,
        source: r.source,
        reason: r.reason,
        canReadWorkspace: r.canReadWorkspace,
        recorded: reading?.file.sessions[sid] !== undefined,
      }
    },

    /**
     * 读**盘上原始记录**（不经过安全降档）。
     *
     * ── 为什么必须有它（2026-11-04 实测）────────────────────────────────
     *   创建链的顺序是：写 `pending` → 回读确认 → 再 `activate()`。
     *   而 {@link of} / {@link get} 返回的是**解析后**的值，解析对 `pending`
     *   **按设计一律降到最低档**（那是"未确认不激活宽档"的安全落点）。
     *   ⇒ 用解析值做回读确认，`pending` 阶段**永远对不上**：
     *     期望 `project/multi`、回读 `ledger/auto` ⇒ 创建链必然失败并回滚
     *     （真机复现：任何一次新建 Hob 会话都返回「写入后回读不一致」）。
     *
     * ⚠ 这个出口**只给写入侧的回读确认**用，⛔ 不许任何判定/闸门拿它当授权依据
     *   （它绕过安全降档，只能用来证明"写进去了什么"）。
     */
    readRawPolicy(sessionId: string): { level: string; workMode: string; activation?: string; quarantined?: boolean } | undefined {
      try {
        const sessions = hostCtx.get?.('sessions')
        const session = typeof sessions?.get === 'function' ? sessions.get(sessionId) : undefined
        if (session === undefined) return undefined
        const file = policyFileFor(hostCtx, session)
        if (file === undefined) return undefined
        const reading = readPolicyStore(file, OPTIONS)
        const rec = reading.file.sessions[sessionId]
        if (rec === undefined) return undefined
        return {
          level: rec.level,
          workMode: rec.workMode,
          ...(rec.activation === undefined ? {} : { activation: rec.activation }),
          ...(rec.quarantined === true ? { quarantined: true } : {}),
        }
      } catch { return undefined }
    },

    set(sessionId: string, level: string, workMode: string, activation?: 'pending' | 'active') {
      // ⚠ 写入口需要**账本路径**：它由会话的 cwd 派生，所以调用方须先给出会话。
      //   这里用一个**保守的**兜底：判不出账本就拒写（⛔ 不往 cwd 里写）。
      const sessions = (() => {
        try { return hostCtx.get?.('sessions') } catch { return undefined }
      })()
      const session = (() => {
        try { return typeof sessions?.get === 'function' ? sessions.get(sessionId) : undefined } catch { return undefined }
      })()
      if (session === undefined) {
        return { ok: false, reason: `会话 ${JSON.stringify(sessionId)} 不在当前实例里 ⇒ 判不出账本落点，拒绝写入（⛔ 不回退到进程 cwd）` }
      }
      const file = policyFileFor(hostCtx, session)
      if (file === undefined) return { ok: false, reason: '判不出账本目录 ⇒ 拒绝写入策略（⛔ 不猜落点）' }
      /**
       * ⚠⚠ **写之前先把迁移纪元落盘**（2026-10-24 · 同一件事的**写路径**入口）。
       *
       * ── 为什么这条不能漏 ────────────────────────────────────────────────
       *   `setSessionPolicy` 会把读到的 `migrationEpoch` **原样转抄**进新文件；
       *   而"文件还没有纪元"时读到的是**读的那一刻**（临时值）⇒ 一旦由这里写下第一条记录，
       *   纪元就被固化成"这次写入的时刻"。
       *   ⚠ 创建链的时序恰好是：宿主先建会话（`createdAt`）→ 再调本函数写策略
       *     ⇒ 那个刚建的会话 `createdAt < epoch` **成立** ⇒ 它会被判成**旧会话**
       *       （走 `legacy-migrated` + 快照，语义错，且会让"新会话未选"分支永远走不到）。
       *   ⇒ 先 `ensurePolicyStoreEpoch(..., installEpoch)` 把纪元钉在**安装时刻**（早于任何本进程建的会话）。
       * ⚠ 失败**不阻断**写入本身（记录仍要能写进去）；原因会随 `ok:false` 之前的
       *   `setSessionPolicy` 结果一并体现（⚠ 这里只补纪元，不改变写入语义）。
       */
      ensureEpochOnce(file)
      return setSessionPolicy(
        file,
        {
          sessionId, level, workMode,
          ...(activation === undefined ? {} : { activation }),
          // ⚠ 纪元下落值：与上面 `ensurePolicyStoreEpoch` 同一份"安装时刻"
          epochFallback: installEpoch,
        },
        OPTIONS,
      )
    },

    /**
     * ════════════════════════════════════════════════════════════════════
     * **选完档之后：把被拦下的消息按原顺序重投**（2026-10-29 · 包 CA）
     * ════════════════════════════════════════════════════════════════════
     *
     * ── 顺序纪律（⚠ 三条都不能破）──────────────────────────────────────
     *   ① **先写策略成功，再重投**：`set()` 回 `ok:false` ⇒ ⛔ 不重投
     *      （否则消息会在"档位还没落盘"的状态下发出去，正是要修的那个病）。
     *   ② **按到达顺序逐条投**（`pendingMessagesOf` 是队列，⛔ 不排序、不合并）。
     *   ③ **投完才清**（`finally` 里清）：投一半失败 ⇒ 队列保留剩下的，
     *      下选定档还能接着投；⚠ 全清会丢，不 clean 会重发 —— 两害取"留着"。
     *
     * ── 重投走哪条路（本单 §四 第 3 问）────────────────────────────────
     *   `agent.followup(message)` —— 与 `src/modules/bus.ts:962` 同款
     *   （`createUserMessage` 造新消息 + 原生 `followup`）。
     *   ⚠ 它会**再进一次 `agent/pre-step`** ⇒ 靠 `requeueing` 标记短路放行
     *     （见该集合的注释；⛔ 判据本身没改）。
     *
     * ⚠ **会话已不在本进程**（`agents.get` 拿不到）⇒ 如实回 `ok:false` 并**保留队列**，
     *   ⛔ 不假装投递成功、⛔ 也不清队列（用户重开这个会话还能再选一次档）。
     */
    async requeue(sessionId: string): Promise<{ ok: boolean; replayed: number; remaining: number; reason: string }> {
      const q = pendingMessagesOf(sessionId)
      if (q.length === 0) return { ok: true, replayed: 0, remaining: 0, reason: '没有待重投的消息' }
      const agents = (() => { try { return hostCtx.get?.('agents') } catch { return undefined } })()
      const agent = (() => {
        try { return typeof agents?.get === 'function' ? agents.get(sessionId) : undefined } catch { return undefined }
      })()
      if (agent === undefined) {
        return {
          ok: false, replayed: 0, remaining: q.length,
          reason: `会话 ${JSON.stringify(sessionId)} 不在本进程 ⇒ 无法重投（⚠ 队列已保留，重开该会话后再选档仍会投）`,
        }
      }
      let replayed = 0
      requeueing.add(sessionId)
      try {
        for (const item of q) {
          /**
           * ⚠ **新建一条消息**（`createUserMessage`）：⛔ 不重用原 `id`
           *   —— 那条已被宿主丢弃，重发同一个 id 会撞身份。
           *   ⚠ `source.kind` 用 `'user'`（宿主原生用户来源）：这是我们**替用户**
           *     把他刚说的那句话放回去，⛔ 不是插件自己的通知。
           */
          /**
           * ⚠ 导入走**运行时动态 import**（与 `src/modules/bus.ts:954` 同款）：
           *   `@deepseek-ai/dsh-llm` 从插件自己的 node_modules 解析，
           *   与宿主那份同版本；用动态 import 是为了"这条路径坏了"不至于让模块装载失败。
           */
          const message: any = await (async () => {
            try {
              const llm: any = await import('@deepseek-ai/dsh-llm')
              return llm.createUserMessage({ content: item.content, source: { kind: 'user' } })
            } catch { return undefined }
          })()
          if (message === undefined) {
            return {
              ok: false, replayed, remaining: q.length - replayed,
              reason: 'message-build-failed：拿不到 createUserMessage（⚠ 队列已保留）',
            }
          }
          if (typeof agent.followup !== 'function') {
            return {
              ok: false, replayed, remaining: q.length - replayed,
              reason: 'agent 无 followup ⇒ 无法重投（⚠ 队列已保留）',
            }
          }
          agent.followup(message)
          /**
           * ⭐⭐ **投成功这一条 ⇒ 立刻从队列摘下它**（2026-10-31 P37 · bug ① 的修法）。
           *
           * ── 改前的病 ────────────────────────────────────────
           *   改前只 `replayed += 1`，**不动队列**，指望 `finally` 里
           *   `if (replayed >= q.length) clearPendingMessages(...)` 一次清整队 ——
           *   那是**全有或全无**：部分失败时分支不成立 ⇒ **整个旧队列原样留着**
           *   ⇒ 下次重投把**已经投出去的甲**再发一遍（实测：甲被投 2 次）。
           *
           * ── 改后 ──────────────────────────────────────────
           *   逐条按**稳定键**摘：投成功的立刻消失。部分失败时队列里
           *   只剩**没投出去的**那些 ⇒ 重投**不会重发**。
           *   ⚠ 用 key 而不是下标：重投期间若并发 append，下标会指错（见 `PendingMessage.key`）。
           */
          consumePendingMessage(sessionId, item.key)
          replayed += 1
        }
        return { ok: true, replayed, remaining: 0, reason: '' }
      } catch (e) {
        return {
          ok: false, replayed, remaining: Math.max(0, q.length - replayed),
          reason: `重投抛错：${String((e as Error)?.message ?? e)}（⚠ 队列已保留）`,
        }
      } finally {
        /**
         * ⭐ **2026-10-31 P37：这里⛔ 不再清整队。**
         *
         * ── 改前为什么错 ────────────────────────────────────────
         *   改前写 `if (replayed >= q.length) clearPendingMessages(sessionId)` ——
         *   它只在"全成功"时清**整队**，而"部分成功"时**什么都不清**
         *   ⇒ 队列里**已投出去的**和**没投出去的**混在一起 ⇒ 重投**重复发**。
         *
         * ── 改后 ─────────────────────────────────────────────
         *   **投一条摘一条**（见循环里的 `consumePendingMessage`）⇒
         *   部分失败时队列**天然只剩没投的**，根本不需要在这里补救。
         *   ⇒ 本 `finally` 只负责复位绕行标记。
         *   ⚠ 队列**整队清空**只发生在两处：① 队列自然被摘空；② 会话销毁（见 `session/disposed`）。
         */
        requeueing.delete(sessionId)
      }
    },

    /**
     * ⚠ **确认生效**：与 `set` 同样**必须能定位账本文件**（由会话 cwd 派生）。
     *   ⚠ 会话不在实例里 ⇒ 判不出落点 ⇒ **拒绝**（⛔ 不猜路径、⛔ 不静默成功）。
     *   ⚠ 这与 `quarantine()` 不同：隔离是"尽力作废"（可以扫多个文件），
     *     激活是"把某个会话变成可执行" ⇒ ⚠ **必须精确**，宁可不做也不能做错。
     */
    activate(sessionId: string) {
      const sessions = (() => {
        try { return hostCtx.get?.('sessions') } catch { return undefined }
      })()
      const session = (() => {
        try { return typeof sessions?.get === 'function' ? sessions.get(sessionId) : undefined } catch { return undefined }
      })()
      if (session === undefined) {
        return {
          ok: false,
          reason: `会话 ${JSON.stringify(sessionId)} 不在当前实例里 ⇒ 判不出账本落点，拒绝激活`
            + '（⚠ 它仍是 pending ⇒ 读档最低、不推进，**不可执行宽档**）',
        }
      }
      const file = policyFileFor(hostCtx, session)
      if (file === undefined) {
        return { ok: false, reason: '判不出账本目录 ⇒ 拒绝激活（⛔ 不猜落点）' }
      }
      return activateSessionPolicy(file, { sessionId, epochFallback: installEpoch }, OPTIONS)
    },

    quarantine(sessionId: string) {
      /**
       * ⚠⚠ **这里故意不要求会话还活着**（2026-10-22）：
       *   隔离的典型场景恰恰是"会话撤不掉、还可能活着"，甚至"连它还在不在都判不出"。
       *   ⇒ 与 `set()` 不同，**不**因为 `sessions.get()` 拿到 `undefined` 就放弃 ——
       *   ⚠ 但又必须知道**写哪个策略文件**（账本路径由会话 cwd 派生）。
       *   ⇒ 分两条：
       *     · 会话活着 ⇒ 用它的 cwd 派生（最准）；
       *     · 会话已不在 ⇒ **扫所有已知策略文件**，把里面**该 id 的记录**都标隔离
       *       （可能有 0..N 个；⛔ 不猜一个文件写）。
       */
      const sessions = (() => {
        try { return hostCtx.get?.('sessions') } catch { return undefined }
      })()
      const session = (() => {
        try { return typeof sessions?.get === 'function' ? sessions.get(sessionId) : undefined } catch { return undefined }
      })()

      if (session !== undefined) {
        const file = policyFileFor(hostCtx, session)
        if (file === undefined) {
          return { ok: false, reason: '判不出账本目录 ⇒ 无法隔离（⛔ 不猜落点）' }
        }
        return quarantineSessionPolicy(file, { sessionId, epochFallback: installEpoch }, OPTIONS)
      }

      /**
       * ⚠ 会话已不可见：扫候选文件。候选 = 宿主注册表里每个工作区的账本落点
       *   （本插件**只用**这条既有派生口径，⛔ 不另造一份路径规则）。
       */
      const candidates = knownPolicyFiles(hostCtx)
      if (candidates.length === 0) {
        return {
          ok: false,
          reason: '会话已不可见、且枚举不到任何已知策略文件 ⇒ **无法隔离**（⛔ 不宣称已隔离）',
        }
      }
      /**
       * ⚠⚠ **2026-10-24 · P0-4：隔离读数必须"精确到本会话的记录"**（改前是 `touched>0 ⇒ ok`）。
       *
       * ── 改前错在哪（实测：真实记录不变，却报 ok:true）─────────────────
       *   `quarantineSessionPolicy` 对**没有记录**的会话会**新建**一条地板记录并打隔离标记
       *   （它这么设计是为了覆盖"写成功但回读不一致"那种不确定态）—— 本身没错。
       *   ⚠ 但本函数把它当"隔离成功"来数：候选文件来自 `workspaceRegistry.list()`，
       *   若**该会话所属的工作区不在注册表里**，它的真实记录**根本不在候选里**，
       *   于是我们把隔离标记写进了**别人工作区的文件**（凭空造了一条幽灵记录），
       *   而**真实那条 `level:workspace` 一字未动**，本函数却返回 `ok:true`
       *   ⇒ 上层（`persistentlyDisable`）据此认定"已持久禁用" ⇒ **假安全**。
       *
       * ── 现在的判据（三条，缺一条都不算成功）──────────────────────────
       *   ① **先读再写**：候选文件里**没有该会话记录** ⇒ **跳过**（⛔ 不往里写幽灵记录）；
       *   ② 有记录 ⇒ 隔离后**回读这个文件**，必须看到 `sessions[id].quarantined === true`；
       *   ③ **全部**含该会话记录的候选文件都必须隔离成功；任何一个失败/读不出 ⇒ 失败。
       *   若**一个候选文件里都没有它的记录** ⇒ 失败并说清"判不出它的记录落在哪"
       *     （⚠ 这也意味着它可能本来就没有记录 —— 那是"最低档 + 放行"，不需要隔离，
       *      但**不能**因此报"已隔离"）。
       */
      const hadRecordIn: string[] = []
      const quarantinedIn: string[] = []
      const failures: string[] = []
      const unreadable: string[] = []
      for (const file of candidates) {
        // ① 先读：这个文件里到底有没有**本会话**的记录
        const reading = readPolicyStore(file, OPTIONS)
        if (reading.reachability === 'unreadable' || reading.reachability === 'version-unknown') {
          // ⚠ 读不出的候选**不能**当成"里面没有它的记录"——那会把"判不出"说成"已隔离"
          unreadable.push(`${file}: ${reading.reason}`)
          continue
        }
        const rec = reading.file.sessions[sessionId]
        if (rec === undefined) continue
        hadRecordIn.push(file)
        if (rec.quarantined === true) { quarantinedIn.push(file); continue }
        const r = quarantineSessionPolicy(file, { sessionId, epochFallback: installEpoch }, OPTIONS)
        if (!r.ok) { failures.push(`${file}: ${r.reason}`); continue }
        // ② 回读**这个文件**，确认本会话的记录真的带上了隔离标记
        const back = readPolicyStore(file, OPTIONS)
        if (back.file.sessions[sessionId]?.quarantined === true) quarantinedIn.push(file)
        else failures.push(`${file}: 写入报成功但回读未见该会话的隔离标记`)
      }
      if (hadRecordIn.length === 0) {
        return {
          ok: false,
          reason: `会话已不可见，扫描 ${candidates.length} 个已知策略文件**都没有它的记录**`
            + ' ⇒ **判不出这条会话的记录落在哪个账本里**（也可能它本来就没有记录）'
            + ' ⇒ **无法确认已隔离**（⛔ 不宣称已隔离；⚠ 若它确实没有记录，解析结果本来就是最低档）'
            + (unreadable.length > 0 ? `；另有 ${unreadable.length} 个文件读不出（${unreadable.slice(0, 2).join(' / ')}）` : ''),
        }
      }
      if (failures.length > 0 || unreadable.length > 0 || quarantinedIn.length < hadRecordIn.length) {
        return {
          ok: false,
          reason: `会话 ${JSON.stringify(sessionId)} 的记录在 ${hadRecordIn.length} 个账本文件里，`
            + `只成功隔离 ${quarantinedIn.length} 个 ⇒ **不能宣称已隔离**`
            + (failures.length > 0 ? `；失败：${failures.slice(0, 3).join(' / ')}` : '')
            + (unreadable.length > 0 ? `；读不出：${unreadable.slice(0, 2).join(' / ')}` : ''),
        }
      }
      return { ok: true, reason: '' }
    },

    fileOf(session: any) {
      return session === undefined ? undefined : policyFileFor(hostCtx, session)
    },

    enums() {
      return { levels: OPTIONS.levels, modes: OPTIONS.modes, floorLevel: OPTIONS.floorLevel, defaultMode: OPTIONS.defaultMode }
    },

    migrationStatus() {
      return {
        state: migrationState,
        detail: migrationDetail,
        ran: lastMigration.ran,
        ok: lastMigration.ok,
        migrated: lastMigration.migrated,
        perFile: lastMigration.perFile,
        failed: lastMigration.failed,
        reason: lastMigration.reason,
      }
    },

    async migrateNow() {
      /**
       * ⚠ **快照只读一次**（⛔ 不在迁移过程中现读全局值）—— 2026-10-24 起：
       *   先 `captureLegacyModeSnapshot()`（它自己严格幂等），再**只读**抓到的值。
       *   改前这里**又直读了一次 `hostCtx.get('hobWorkMode')`** ⇒ 那正是
       *   "首读失败后重试会重读全局"的第二个入口（实测 multi→single 落盘）。
       *   ⚠ 抓不到 ⇒ 用 `DEFAULT_WORK_MODE`（= 与"没抓到快照"同一条已知限制，
       *     调用方会看到 `usedSnapshot=false` 的 warn，⛔ 不静默当"已保全"）。
       */
      captureLegacyModeSnapshot()
      const legacyMode = legacyModeSnapshot ?? DEFAULT_WORK_MODE
      const rep = await migrateAsync(legacyMode)
      lastMigration = rep
      migrationState = rep.ok ? 'done' : 'failed'
      migrationDetail = rep.reason
      legacyScanDone = true
      return { migrated: rep.migrated, perFile: [...rep.perFile], failed: [...rep.failed], ok: rep.ok, reason: rep.reason }
    },
  }

  ctx.provide(SESSION_POLICY_SERVICE, service)

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **发送时拦截：`agent/pre-step` 闸门**（2026-10-29 · 包 BZ · `CHG-185`）
   * ══════════════════════════════════════════════════════════════════════════
   *
   * ── 它做什么 ──────────────────────────────────────────────────────────
   *   **Hob 会话 ∧ 还没选档 ⇒ `{ kind: 'reject' }`**，其余一切情形 `next()`。
   *   这就是"用户发消息时弹一次选档"的落点：拦下这一步，前端照既有只读路由
   *   `POST /api/dsh-hob/session-policy` 的 `state === 'unrecorded'` 弹窗
   *   （见 `src/client/hob-unselected-gate.tsx`）。⛔ 本文件不另造一份清单。
   *
   * ── ⚠ 为什么 reject 不会造成"消息发两遍"（本单问题 1）──────────────
   *   宿主 `dsh-agent/lib/types/runtime-types.d.ts:267-270` 原文：
   *     *"If the proposed step is rejected, the claimed message ends here:
   *      it is neither discarded nor re-emitted as a user/message, and the
   *      turn closes without a step."*
   *   又 `dsh-agent/lib/index.js:54-58`：*"the pre-step rejection that produced
   *   it discarded the claimed messages, so the work it took will never run."*
   *   ⇒ **那条消息在这里被丢弃**：⛔ 不进模型、⛔ 不回 inbox、⛔ 不留对话行。
   *   ⇒ 前端弹窗选完后**重新投递一次**，用户侧只会看到一条。
   *   ⚠ 但也正因为"被丢弃" ⇒ **必须由我们重投**，⛔ 不能指望宿主还给它。
   *
   * ── ⚠ 判据只有两条，且**判不出就放行**（fail-open，本单问题 2）──────
   *   ① `isHob`（宿主 `agentPreset` 投影 === `'Hob'`，与全仓同一取法 `presetOfSession`）；
   *   ② 该会话**还没有选择记录** ⇒ 读数 `source === 'derived-default'`。
   *   ⚠ ② 用的判据是**既有 resolver 的读数**，⛔ 不新造一套"选过没有"的判法
   *     （`derived-default` 的语义原文见 `src/server/session-policy.ts:589`：
   *      "无记录 + 会话不早于迁移纪元 ⇒ **新会话未选**"）。
   *   ⚠⚠ **除这两种以外一律 `next()`**，特别是：
   *     · 非 Hob ⇒ 放行（⛔ 误拦普通用户消息比不做更糟）；
   *     · `stored` / `pending-activation` / 任何其它 source ⇒ 已选过或状态不明 ⇒ 放行；
   *     · **`resolveFor` 抛错、`session` 取不到、判据读不出来 ⇒ 放行**（fail-open）。
   *   ⚠ 这条纪律与读档闸门的 fail-closed **方向相反**，是有意的：
   *     读档关系到"能读到什么"（判不出就往紧了收）；本闸门关系到"用户的消息发不发得出去"
   *     （判不出就**别拦**）。⛔ 两者不可互相借用判据。
   */
  try {
    const onPreStep = (ctx as any).on
    if (typeof onPreStep !== 'function') {
      ctx.logger?.warn?.('[dsh-hob] 宿主无 `agent/pre-step` ⇒ 发送时选档闸门未安装（不拦任何消息）')
    } else {
      ;(ctx as any).on('agent/pre-step', (payload: any, next: () => Promise<any>) => {
        /**
         * ⚠ **整段包在 try 里**：任何异常都必须落回 `next()`
         *   —— ⛔ 不许因为本闸门自己的 bug 把用户的消息吞掉。
         */
        try {
          const session = payload?.agent?.session
          if (session === undefined || session === null) return next()
          /**
           * ⚠ sid 必须**先算出来**：下面的"重投绕行"短路要用它。
           *   取不到 ⇒ 走到 ① 之后本来也会 `return next()`（那里再判一次）。
           */
          const sidEarly = (() => { try { return typeof session?.id === 'string' ? session.id : '' } catch { return '' } })()
          /**
           * ⚠⚠ **第 0 步：正在被我们重投的那一条 ⇒ 直接放行**（本单 §四 第 3 问）。
           *   ⛔ 这不是"放宽判据"：判据本身一个字没改（见下面 ① ②），
           *   只是在它之前短路 —— 否则重投会**再被自己拦一次**，消息又丢，
           *   用户**永远选不完**（死循环）。
           *   ⚠ 该集合只在 `requeuePending()` 的同步段里非空（`finally` 立刻删）。
           */
          if (requeueing.has(sidEarly)) return next()
          const resolved = resolveFor(session)
          /** ① 非 Hob ⇒ 放行。 */
          if (resolved?.isHob !== true) return next()
          /**
           * ⚠⚠ **② 新判据（2026-10-29 · 第 332 轮 · TASK-K）：这条会话"用户选过档没有"**
           *
           * ── 为什么换掉旧的 `source !== 'derived-default'` ─────────────────────
           *   `derived-default` 是**迁移口径**（"无记录 **且** 会话不早于迁移纪元"）。
           *   而弹窗要问的是**用户给这条会话选过档没有** —— **两件事被当成了同一件**。
           *   实测（`CHG-209` / `REPORT-J`）：`session-e6dfdf31…` 的 `createdAt` 是 2026-10-18、
           *   **早于** `migrationEpoch`（10-22）⇒ `source='legacy-migrated'` ⇒
           *   旧判据第 ② 条当场放行 ⇒ **从未 reject ⇒ markBlocked 从未被调用 ⇒ 弹窗不出现**。
           *   ⇒ 旧判据在"旧会话"这一大片数据上**恒不成立**，而它们**同样没有用户的选择记录**。
           *
           * ── 新判据是什么 ─────────────────────────────────────────────────
           *   **直接看盘上有没有这条会话的选择记录**（`readPolicyStore`），⛔ **不看 `createdAt` 与纪元的先后**。
           *   这是"用户选没选"的**唯一权威**（那条记录只由 `handlePolicyWrite` 在用户确认后写入）。
           *
           * ── 三条纪律（本单 §二）────────────────────────────────────────────
           *   ① **只看"记录在不在"** —— ⛔ 不看纪元、⛔ 不看 `source` 的归属分类；
           *   ② **判不出 ⇒ 放行**（fail-open，与改前一致）：
           *      `file === undefined`（判不出账本落点）/ `reachability !== 'ok'`（读不到 / 版本不认识）
           *      ⇒ `next()`。⛔ 不许改成"判不出就拦"（那会把用户消息吞掉）。
           *   ③ **非 Hob 放行** —— 上面第 ① 条未动。
           *   ⚠ `source` 的 13 个取值**一个字未改**（本单只改**谁触发闸门**，不改状态机）。
           *   ⚠ 允许在 warn 话术里带 `source` 以便排查，⛔ 但**不参与判定**。
           */
          const recordState = (() => {
            /** `'recorded'` = 有已落盘记录 ⇒ 放行；`'absent'` = 确定没有 ⇒ 该拦；`'undecidable'` = 判不出 ⇒ 放行。 */
            type RecordProbe = 'recorded' | 'absent' | 'undecidable'
            const probe = (sidForProbe: string, sess: any): RecordProbe => {
              if (sidForProbe === '') return 'undecidable'
              const f = (() => { try { return policyFileFor(hostCtx, sess) } catch { return undefined } })()
              if (f === undefined) return 'undecidable'
              const rd = (() => { try { return readPolicyStore(f, OPTIONS) } catch { return undefined } })()
              if (rd === undefined) return 'undecidable'
              /**
               * ⚠ **可达性不是 `ok` ⇒ 判不出**（⛔ 不能当成"没有记录"）：
               *   `absent`（文件不存在）在本仓语义里 = "还没有任何会话策略记录"，
               *   ⚠ 但**文件不存在**也可能是"账本落点算错/目录没建" —— 与"用户没选过"**是两件事**。
               *   ⇒ 一律 `undecidable` ⇒ 放行（fail-open，⛔ 不拿它当拦截依据）。
               */
              if (rd.reachability !== 'ok') return 'undecidable'
              return rd.file.sessions[sidForProbe] === undefined ? 'absent' : 'recorded'
            }
            return probe(sidEarly, session)
          })()
          /** 判不出 ⇒ 放行（fail-open）。⚠ 与旧的 `source !== 'derived-default'` 同一个方向。 */
          if (recordState === 'undecidable') {
            ctx.logger?.warn?.(
              `[dsh-hob] 发送时选档闸门：**判不出"${sidEarly}"有没有选择记录** ⇒ 本次放行（fail-open）`
              + `（策略读数 source=${JSON.stringify(resolved?.source ?? null)} 仅供排查，⛔ 不参与判定）`,
            )
            return next()
          }
          /** 已经有已落盘记录 ⇒ 用户选过了 ⇒ 放行。 */
          if (recordState === 'recorded') return next()
          const sid = (() => { try { return typeof session?.id === 'string' ? session.id : '' } catch { return '' } })()
          if (sid === '') return next()
          /**
           * ⚠ **不在这里另存一份"待弹会话"清单**：
           *   前端已有的只读路由 `POST /api/dsh-hob/session-policy`
           *   （`src/modules/session-policy-route.ts`）就回答"这个会话选过没有"
           *   ⇒ 弹窗靠那条路由判，⛔ 不再造第二份真相（会漂）。
           *   这里只记一行日志，让拦下这件事在宿主日志里可见。
           */
          /**
           * ⚠⚠ **先把内容留住，再 reject**（顺序不能反）：
           *   宿主一 reject 就把这条消息丢弃了 ⇒ 这里不存，它就永久没了。
           *   ⚠ `payload.messages` 是**本轮被 claim 的全部消息**（可能多条），
           *     逐条追加进队列 ⇒ 用户连发两条也都会回来（本单 §三 第 3 个问号）。
           */
          const claimed: readonly any[] = Array.isArray(payload?.messages) ? payload.messages : []
          let staged = 0
          for (const m of claimed) {
            const content = m?.content
            if (Array.isArray(content) && content.length > 0) {
              stagePendingMessage(sid, content)
              staged += 1
            }
          }
          const queued = pendingMessagesOf(sid).length
          /**
           * ⚠⚠ **落一条"这个会话被拦过"的可读状态**（2026-10-29 · 第 332 轮 · 包 cb）。
           *
           * ── 为什么必须落（否则这条链补不上）────────────────────────────────
           *   `agent/pre-step` 是 **waterfall**，`reject` 的宿主语义是"消息到此为止、
           *   turn 无 step 地关闭"（`dsh-agent/lib/types/runtime-types.d.ts:304 / :269-271`）
           *   ⇒ **前端拿不到任何回调** ⇒ 客户端只能**主动来问**"这个会话被拦过没有"。
           *   本行就是那个答案的**唯一写入口**。
           *
           * ── 为什么⛔ 不能拿 `source === 'derived-default'` 顶替 ────────────────
           *   `unrecorded` 只说明"这个 Hob 会话还没选过" —— **新建的空白会话一打开就是它**。
           *   拿它当"被拦过"的证据 ⇒ **一进会话就弹**（本单明令禁止的骚扰）。
           *   ⇒ "选过没有"（策略主文件）与"被拦过没有"（本文件）是**两根轴**。
           *
           * ── ⚠ 顺序：**在 `reject` 之前写** ────────────────────────────────
           *   宿主一 `reject` 就丢弃消息；若写在 `reject` 之后（例如 `finally`），
           *   那次写是否来得及**取决于宿主何时真的结束这一步** ⇒ 不可靠。
           *
           * ── ⚠ 写失败**⛔ 不许静默**（本单 §二 第 1 条明令）──────────────────
           *   `markBlocked` 返回 `{ok, reason}`；失败**必须**打成 `warn` 带原因。
           *   ⚠ 但**失败也不能改变 `reject` 的结果**：拦不拦是安全判定，
           *   落不落"被拦过"是可用性记录 —— 两件事⛔ 不能互相绑架。
           */
          {
            const blockFile = policyBlockFileFor(hostCtx, session)
            const w = markBlocked(blockFile, sid)
            if (!w.ok) {
              ctx.logger?.warn?.(
                `[dsh-hob] 发送时选档闸门：**已拦下**会话 ${sid}，但"被拦过"状态**未落盘** ⇒ `
                + `界面的选档弹窗将无法得知本次拦截（原因：${w.reason}）`,
              )
            } else if (w.reason !== '') {
              // 写成功但读旧档时有可读问题 ⇒ 如实带出来（⛔ 不当没发生）
              ctx.logger?.warn?.(`[dsh-hob] 发送时选档闸门：被拦状态已更新，但读旧档有异常：${w.reason}`)
            }
          }
          ctx.logger?.info?.(
            `[dsh-hob] 发送时选档闸门：拦下未选档的 Hob 会话 ${sid}`
            + `（本次暂存 ${staged} 条，队列共 ${queued} 条，待选档后重投）`,
          )
          return Promise.resolve({ kind: 'reject' as const })
        } catch (e) {
          /** ⚠ fail-open：判不出就放行，并把原因说出来（⛔ 不静默）。 */
          ctx.logger?.warn?.(`[dsh-hob] 发送时选档闸门判据抛错 ⇒ 本次放行：${String((e as Error)?.message ?? e)}`)
          return next()
        }
      })
      ctx.logger?.info?.('[dsh-hob] 发送时选档闸门已安装（`agent/pre-step`）：Hob ∧ 未选档 ⇒ 拦下；其余一律放行')
    }
  } catch (e) {
    ctx.logger?.warn?.(`[dsh-hob] 发送时选档闸门安装失败（⛔ 不影响其它功能）：${String((e as Error)?.message ?? e)}`)
  }

  /**
   * ⚠⚠ **在安装时先踢一次迁移**（2026-10-22 第 3 轮）。
   *
   * ── 为什么不能只靠 `resolveFor` 里的那个触发器 ────────────────────────
   *   `resolveFor` 是**第一次有人读策略**时才跑。而"有人读策略"这件事本身
   *   可能已经发生在**某个需要知道工作方式的时刻之后**（例如某条调用链先读、
   *   再决定 prompt；⚠ 虽然本仓目前是先读后判，但依赖"调用顺序"是不可靠的）。
   *   ⇒ 在**安装时**就踢一次：`installSessionPolicy` 由插件入口 `apply` 调用，
   *     那时**还没有任何会话在跑** ⇒ 迁移**必定早于**任何会话第一次 `of()`。
   *   ⚠ 这是"先于任何需要保留原模式的策略结果"的**结构性**保证，
   *     ⛔ 不是靠"记得先调用"这种约定。
   *   ⚠ 仍然幂等：`ensureLegacyMigrationOnce` 有闸门；`resolveFor` 里再调也是空转。
   */
  ensureLegacyMigrationOnce()
  ctx.logger?.info?.(
    `[dsh-hob] 逐会话策略权威已就位（${SESSION_POLICY_SERVICE}）：`
    + `文件 = <账本>/ ${POLICY_STATE_SUBDIR}/${POLICY_STATE_FILENAME}；`
    + `档 = ${OPTIONS.levels.join('/')}；方式 = ${OPTIONS.modes.join('/')}；兜底 = ${OPTIONS.floorLevel}/${OPTIONS.defaultMode}`,
  )
}
