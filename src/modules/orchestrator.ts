/**
 * M5 · 编排模块（Host 半边）—— **闭环派活：投递 → 等对方跑完 → 回传结果 → 唤醒派活方**。
 *
 * ── 它解决什么（用户 2026-10-09 的原话）────────────────────────────────
 *   「hob 任务自动创建会话，并且会话任务完成之后会自动回传给对应的 hob 会话，
 *     hob 对回传的消息进行分析后继续推进任务然后下发下一步任务给对应的会话，
 *     新建会话还是继续已有的会话取决于 hob 自己判断」
 *
 *   批 16 之前，这套循环**断在中间**：Hob 能投递（`hob_send`）、能建会话（`hob_spawn`），
 *   但**对方跑完的结果不会自己回来** —— 必须由用户手工把结果搬回 Hob 会话。
 *   本模块补的就是这一环，把"手工搬"变成"自动回传"。
 *
 * ── 四个承重环节（全部**真机实测**过，不是推断）─────────────────────────
 *   ① **监听"对方跑完"**：`ctx.on('agent/status', …)` —— 该事件是**作用域过滤**的，
 *      但插件作用域**能收到其它会话的**状态变化（实测：拿到别的会话 `running → idle`，
 *      事件带 `agent.id` 可区分是哪个会话）。`AgentStatus` 只有 `'idle' | 'running'`
 *      （`dsh-agent/lib/types/runtime-types.d.ts:90`）。
 *   ② **读回对方产出**：`sessions.get(id).log` 里取最后一条 `assistant/message`
 *      （实测读到了它的回复原文）。
 *   ③ **回传能唤醒派活方**：同一会话**可被反复唤醒**（实测：两次投递都是
 *      `running → idle`）。
 *   ④ **建新会话**：`hob_spawn`（批 16），强制带工作区归属。
 *
 * ── 闭环怎么转（状态机）────────────────────────────────────────────────
 *   `hob_dispatch(target, msg)` ──► 登记一个 watch（谁派给谁、第几轮、派了什么）
 *          │
 *          │  target: idle → running  （wat.sawRunning = true）
 *          │  target: running → idle （对方这一轮跑完了）
 *          ▼
 *   构建回传 = 结论 + 改动文件清单  ──►  delivered 给**派活方**（唤醒它）
 *          │
 *          ▼
 *   派活方（Hob）下一轮醒来 → 分析 → **自己决定**续用(target)还是新建(spawn)
 *          └─► 再调 `hob_dispatch` ⇒ 循环继续（或者它宣布结束 / 用户手动停）
 *
 * ── ⚠ 安全设计（用户选了"不设上限、只能手动停" ⇒ 刹车是一等公民）──────────
 *   **用户明确选择不设轮数/预算上限**（2026-10-09）。这意味着**一旦转起来，
 *   它会在用户看不到的时候持续投递、建会话、烧 token**。因此：
 *   · **`stopped` 开关**：`hob_orch_control('stop')` 置位；
 *   · **闸门在【回传之前】** —— 停了就**不再唤醒派活方**，循环当场断在那一环
 *     （⚠ 不是"下次投递时才检查"：那会让循环再空转一轮）；
 *   · **闸门也在【派发之前】** —— 停了则 `hob_dispatch` 直接拒绝；
 *   · **单次性**：一个 watch 只回传**一次**（`reported` 标记先写后发），
 *     避免同一个 idle 事件把派活方刷爆。
 *
 *   ⚠ 与 `dsh-client-auto-continue` 的同类风险（实测见过它整夜循环刷"继续"）：
 *     本模块**不自动派活** —— 每次派发都由派活方**显式调用工具**发起，
 *     本模块只负责"把结果送回去"。**没有 LLM 在这里面做决定。**
 *
 * ── 可选依赖纪律（同批 15/16）──────────────────────────────────────────
 *   `sessions` / `agents` 是**必需**（写进 `inject`）；其余一律 `ctx.get` 可选读。
 *   缺席 ⇒ 相关能力**明确拒绝**，绝不静默降级成"看起来在工作"的状态。
 */
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { PLANNING_PRESET_ID } from '../shared/planning-preset.ts'
import type { PresetSource } from './bus.ts'
import { resolveLedgerRoot } from '../server/doc-read.ts'
import { readCards, renderCardLines, type CardSnapshot, type GetTool } from '../server/board-cards.ts'
import {
  CardWake, DispatchWake, lookupCardSession,
  type WakeState, type DispatchWakeState, type CardFiringEvent, type WakeTarget,
} from '../server/card-wake.ts'
import {
  ORCH_STATE_FILENAME,
  ORCH_STATE_SUBDIR,
  STUCK_AFTER_RECHECKS,
  bindSession,
  clearHandoffs,
  countLostByClass,
  ensureRuntimeIgnored,
  ORCH_STATE_IGNORE,
  countBySettleState,
  hasUnsettled,
  markLost,
  mergePendingByIdentity,
  nextRecheckDelay,
  orchStateFileOf,
  readOrchState,
  readOrchStateDetailed,
  watchKey,
  writePending,
  type LostClass,
  type PersistedHandoff,
  type PersistedWatch,
  type SettleEvidence,
  type SettleState,
  type StateReachability,
} from '../server/orch-state.ts'

/** 模块名（同时是 fiber 显示名）。 */
export const name = 'dsh-hob-orchestrator'

/** 本模块对外提供的服务名（预设行据此反应式注册工具）。 */
export const ORCH_SERVICE = 'hobOrchestrator'

/** 一个在等的派发（= 一次"我把它交出去了，等它回来"）。 */
export interface Watch {
  /** 被派发的会话（执行方）。 */
  target: string
  /** 派活方会话（回传的收件人）—— 通常是 Hob。 */
  watcher: string
  /** 第几轮（由调用方自己数，本模块只记录原样回传）。 */
  round?: number
  /** 派了什么（回传里带上，便于派活方对上号）。 */
  task?: string
  /** 登记时间（毫秒）。 */
  at: number
  /** 是否已见过它进入 `running`（没见过就 idle 不算"跑完"）。 */
  sawRunning: boolean
  /** 是否已经回传过（**单次性**：防止同一个 idle 事件重复唤醒派活方）。 */
  reported: boolean
  /**
   * ⚠⚠ **"先写后发"的投递尝试标记**（2026-10-20 · 第 4 单；跨进程幂等层）。
   *
   * ⚠ 存在的唯一理由：`reported` 只在**内存**里 ⇒ 进程一重载就归零
   *   ⇒ 一条"已经发出去过"的记录会在下一代替**再发一份**。
   *   而"投递成功 ⇒ 该条离开 pending"这两步之间有一个**窗口**
   *   （消息已进 inbox，盘上还没删）—— 在那个窗口里崩溃/被杀，就会重复送达。
   *   ⇒ 这个标记在**调用 `deliver` 之前**就落盘（同 `CardWake.markDelivered` 的同一条纪律）。
   */
  deliveryAttemptAt?: number
  /**
   * 回执**已经投递成功**的时刻（成功 ⇒ 该条应离开 `pending`；只剩"清账"这一步）。
   * ⚠ 与 {@link deliveryAttemptAt} 成对：有 attempt 没 delivered =
   *   **投递结果未知**（进程在投递中途退出）⇒ **不再自动重投**，等人工裁。
   */
  deliveredAt?: number
  /**
   * ⚠⚠ **成功投递但清账（写盘）失败**的标志（2026-10-20 · 第 4 单）。
   *
   * ⚠ 任务书要求："投递成功但写盘失败 ⇒ **必须可读地报出来**，⛔ 不许静默让下一轮重发"。
   *   ⇒ 失败时把这条**留在盘上并带上本字段**：下一轮对账**只重试清账**（⛔ 不重投），
   *     读数里单列一档。有它 = "回执已送到，账没清掉"。
   */
  cleanupFailedAt?: number
  /** 回传失败时的原因（有值 = 试过但没送回去）。 */
  error?: string
  /**
   * **目标会话的预设 id**（第 129 轮新增 · 判据 4）。
   *
   * ⚠ 它是 `status()` **现读**出来的（`targetPresetOf`），**不是**登记 watch 时存的 ——
   *   ⛔ 别把它当成 `w` 的持久字段在别处写：本字段只由 `status()` 填充，
   *   任何"存一份"的写法都会在会话被换/重载后**悄悄过期**（**E-117**）。
   * ⚠ 读不到时**不填本字段**（调用方渲染成 `(读不到)`）—— 不编造、不猜默认值。
   */
  targetPreset?: string
  /**
   * ⚠⚠ **这条派发记录自己的 owner**（= `hob_dispatch` / `write_hob(dispatchTo)` 的调用方会话 id）。
   *
   * ── 为什么它必须逐条存在（本件的核心，`I-1` / `I-2`）──────────────────────
   *   改前"回执该投给谁"只有一个来源：**进程级单值** `opts.selfSessionId`
   *   ⇒ 任何会话读一次 `hob_orch_status` / 卡面就把它刷成自己
   *   ⇒ **A 工作区派出去的活的回执会投给 B 工作区的 Hob**（用户报的那条缺陷）。
   *   ⚠ 而 `watches` 里本来就记着 `watcher`（= 派发时那个 self），
   *     ⇒ 归属信息一直**在**，只是读数与投递两条路都没用它。
   *
   * ⚠ **向后兼容**：旧运行态文件没有这个字段 ⇒ 读成 `undefined` = **"无归属"**，
   *   ⛔ 不许判坏、⛔ 不许猜一个默认 owner（`I-1` 明令）。
   */
  owner?: string
  /**
   * 该 owner 的**工作区根**（落盘分区 + 读数过滤的判据，`I-1` / `I-5`）。
   * ⚠ 判不出 ⇒ 不填；⛔ 不许拿**目标会话**的工作区根顶替（那是另一回事）。
   */
  ownerWsRoot?: string
  /**
   * ── ⚠⚠ **耐久化五件**（2026-10-20 · 本单 B1/B2；诊断出处 `FINDINGS` P2/W3/W4）──
   *
   * ⚠ 这五个字段**必须同时活在内存与盘上**（`PersistedWatch` 同名同义），否则
   *   重载后要么"判不出从 running 掉下来"(W3)、要么"结算完盘上还留着"(W4)、
   *   要么"判不出就再也醒不过来"(P2)。
   */
  lastStatus?: string
  settleState?: SettleState
  recheckCount?: number
  lastRecheckAt?: number
  evidence?: SettleEvidence
  /**
   * {@link targetPreset} 的**取自哪里**（2026-10-17 第 2 轮新增 · `CHG-058` 收口）。
   *
   * ⚠ 与 `bus.ts` 的 `presetSource`（{@link PresetSource}）**同一口径**：
   *   · `'projection'` —— 宿主 `agentPreset` 投影（**权威**）；
   *   · `'header'`     —— 投影缺位，退回建档头（⚠ **可能不是当前值** ⇒ 渲染层必须标「降级」）。
   *
   * ⚠ 为什么这一列**必须有来源标记**：本列的唯一用途是"发现派错了人"，
   *   而**降级后的 header 值恰恰会掩盖"这个人其实是规划侧"** ——
   *   不标来源，降级读数与权威读数在输出里**逐字一样**（正是 `CHG-058` 要治的形态）。
   * ⚠ 只在 {@link targetPreset} 有值时才可能带本字段。
   */
  targetPresetSource?: PresetSource
}

/** 编排状态快照（给工具与探针读）。 */
export interface OrchStatus {
  /** 是否已停（`true` = 闸门关闭，不回传也不接收新派发）。 */
  stopped: boolean
  /** 在等的派发（按登记时间）。 */
  watches: Watch[]
  /** 已完成的回传次数（累计，便于观察循环转了几次）。 */
  relaysDone: number
  /** 被闸门拦下的回传次数（停了之后对方又跑完的次数）。 */
  relaysBlocked: number
  /**
   * **本代就绪时发现的、上一代遗留的丢失派发数**（本批新增）。
   *
   * ⚠ 它**不是** `watches` 的一部分 —— 那些派发**已经不在等了**
   *   （宿主重载把 watch 抹了，而 `running → idle` 是事件、永不再来）。
   *   这个数的唯一用途是让"曾经派过、却没回传"**可观测**：
   *   没有它，重载后的读数与"从来没派过"完全一样。
   */
  lostPending: number
  /**
   * **按档位分开的累计丢失数**（2026-10-18 第 2 轮 · `UD-137` 裁定 3 新增）。
   *
   * ⚠ ⚠ 用户原话：「**两类不许混成一个 lost 计数** —— 用户要能一眼看出
   *   '这条真丢了'还是'这条其实做完了、去看看'」。
   * ⇒ `lostPending` 仍然是**总数**（既有行一字不改，见 `check:orch` 的 C 组），
   *   本字段是**它的拆解**，让状态行能分开报：
   *   · `idle`    —— 重载时目标**已空闲（跑完了）** ⇒ 真丢了，但**可追回**
   *                  （去那个会话看它最近一轮）；
   *   · `unknown` —— **判不出**目标状态 ⇒ 既有数据都落这一档
   *                  （⚠ 旧文件没有档位字段，⛔ 不许当成 `idle`）；也含"会话没了"的情形；
   *   · `running` —— 重载时目标**仍在跑**却仍进了 lost ⇒ **异常路径**（重挂失败）。
   *                  ⚠ 正常情况下它应当恒为 0（重挂成功的不会进 lost）；
   *                  非 0 就说明"先核再判"那一步出了问题 ⇒ 它必须**单独可见**，不许并进前两档。
   */
  lostByClass: Record<LostClass, number>
  /**
   * **待投递**的中间态（2026-10-10 新增）—— "写了/建了，但还没投出去"。
   *
   * ⚠ 与 `lostPending` 的区别（别混）：
   *   · `lostPending` = **派过、但回传没了**（重载抹 watch 那次）；
   *   · `handoffs`    = **还没派出去**（写了交接文件 / 建了会话，却没投）。
   *   两者是同一病的两面（"该记的事没记"），但**发生的时刻不同**：
   *   前者在"等回传"之后，后者在"投递"之前。
   *
   * ⚠ 它是**从盘上读的**（不是内存）—— 因为记账的每一处（写文件 / 建会话）
   *   与这里（读状态）不在同一个模块作用域，盘是它们唯一的共同点，
   *   而且这也让它**跨重载可见**（与 `lost` 同理）。
   */
  handoffs: PersistedHandoff[]
  /**
   * ⚠⚠ **`runtime/.gitignore` 没写成**（2026-10-21 · 第 329 轮 · **甲-9**）——
   *   只在异常档有值；**正常档 `undefined`** ⇒ 渲染层一个字都不多。
   *   ⚠ 它回答的是"**会话 id 会不会被账本 git 收进历史**"，⛔ 不是"盘能不能写"。
   */
  runtimeIgnoreNote?: string
  /**
   * ── ⚠ ⚠ **账本可达性**（2026-10-16 · 第 247 轮 · `TASK-R207` 新增）────────────
   *
   * ⚠ **它治的缺陷**（第 243 轮实测 · `REPORT-R205.md` §3.2-c）：`readOrchState` 把
   *   "**够不到账本**"与"**真的没有记录**"读成**同一个空态**
   *   ⇒ ⚠ ⚠ 读 `handoffs` / `lostPending` 的人**分不出**这两种情形。
   *
   * ⚠ ⚠ **取值**（见 `orch-state.ts` 的 `StateReachability`）：
   *   · `'ok'`                 —— 读到且解析成功；
   *   · `'no-records-yet'`     —— **账本在、只是还没有记录** ⇒ ⚠ **真实状态，⛔ 不是失败**
   *                              （⚠ 这一档**不许**加任何标记 —— 作业书 §3(a)）；
   *   · `'ledger-unreachable'` —— **账本目录不存在** ⇒ ⚠ 这才是"够不到" ⇒ **要有可读标记**；
   *   · `'unreadable'`         —— 文件在、读不了或 JSON 坏 ⇒ **要有可读标记**；
   *   · `'unresolved'`         —— **本单新增**：连"该查哪个账本"都判不出
   *                              （工作区根不可得 / 账本解析为 `undefined`）。
   *
   * ⚠ **缺省 `'ok'`** ⇒ ⛔ 不动既有调用点的行为（向后兼容）。
   */
  reachability: StateReachability | 'unresolved' | 'ledger-home-unresolved'
  /**
   * ⚠⚠ **账本根为什么解析不到**（2026-10-21 · 第 326 轮 · **甲-7**）——
   *   只在 `reachability === 'ledger-home-unresolved'` 时**有值**，⛔ 正常档一个字都不多。
   *   ⚠ 它回答的是"**成因**"，`reachability` 回答的是"**够不够得到**" —— 两者互补，⛔ 不重复。
   */
  ledgerHomeWhy?: LedgerHomeDiag
  /**
   * ⚠⚠ **他人的（不可见明细）**（`I-4` 的显式例外）。
   *
   * 作业书允许的唯一混法：「要混必须单列『他人的（不可见明细）』并明确标注」。
   * ⚠ 只给**条数**：⛔ 不许带 target / task / 轮次 / 卡号 —— 明细一出现，
   *   就等于把别人的账本又摊开了一次（那正是本件要治的形态）。
   */
  others?: { note: string; watches: number }
  /**
   * ⚠ **无归属的在等回传条数**（`I-1`：判不出归属 ≠ 归我，也 ≠ 别人的）。
   * ⚠ 它必须**单列一档**：并进"我的"会让别人以为那是自己的活；
   *   并进"他人的"又等于说"那是有主的"（两件都不是事实）。
   */
  unownedWatches?: number
  /**
   * ══════════════════════════════════════════════════════════════════════
   * ⚠⚠ **乙-10（2026-10-21 · 第 332 轮）：`unownedWatches` 只数内存**
   * ══════════════════════════════════════════════════════════════════════
   *
   * ── 改前的病灶（`PROJECT-SURVEY-3` §6.2 乙-10）────────────────────────
   *   `unownedWatches` 的取数面是 **`[...watches.values()]`（内存）**。
   *   ⚠ 而盘上的 `unresolved` / `stuck` 记录里，**内存里没有对应 `watch`** 的那一部分
   *   （重载后还没被认领 / 上一代留下的）**根本不在这摞里** ⇒ 那一档**会漏**。
   *   ⇒ 更要命的是：**"这一档真的是 0" 与 "这一档我只看了内存"印成同一句** ——
   *     读数看起来完整（`R2`「三档互斥且覆盖」在这一格不成立）。
   *
   * ── 现在：把"只看了内存"这件事**显式标出来** ──────────────────────────
   *   本字段 = **盘上存在、而本进程内存里没有对应 watch 的未结算记录条数**。
   *   ⚠ 它与 `unownedWatches` **不是同一个数、也不相加**（量纲不同）：
   *     · `unownedWatches`：**内存里**那些 `owner` 缺失的 ⇒ 已知条数；
   *     · 本字段：**内存里压根没有**的那些 ⇒ `unownedWatches` **看不见它们**。
   *   ⇒ ⚠ 只有当本字段 **> 0** 时，"无归属"那一档才是**不完整**的
   *     ⇒ 渲染层必须补一句"上面那个数**只覆盖内存**"。
   *   ⚠ 正常档（内存与盘一致）⇒ 本字段为 `0` ⇒ **一个字都不多**
   *     （与改前**逐字相同**，`TASK` 要求 3）。
   */
  unownedWatchesMemoryOnlyGap?: number
  /**
   * ── ⚠⚠ **结算态三档**（2026-10-20 · 本单 B3 / B4 新增）──────────────────
   *
   * ⚠ 存在的唯一理由：`unresolved`（判不出、**下一次还会再核**）与
   *   `stuck`（重核到顶、**不再自动重试**）是两个**必须分开报**的档 ——
   *   混在"在等回传"里，读的人会以为"这些都在正常等"（`S-d` 钉的就是这条）。
   * ⚠ 三档**互斥且覆盖全部登记**（`countBySettleState` 是唯一实现点）。
   */
  settleByState?: Record<SettleState, number>
  /**
   * **不再自动重试的条数**（`stuck`）—— 读数里必须**明说"需人工裁"**，
   * ⛔ 不许让它看起来像"还在等"。
   */
  stuckCount?: number
}

/** `hobOrchestrator` 服务的形状。 */
export interface HobOrchestrator {
  readonly version: number
  /** 登记一次派发并投递（**唯一的进入闭环入口**）。 */
  dispatch(
    target: string,
    message: string,
    opts: { self: string | undefined; round?: number; task?: string; mode?: 'followup' | 'steer' },
  ): Promise<{
    ok: boolean
    sessionId?: string
    messageId?: string
    reason?: string
    watching?: boolean
    /**
     * 目标预设预警（第 129 轮）—— **由 `bus.deliver()` 算出，这里只透传**。
     *
     * ⚠ 判据 3：`hob_dispatch` 的返回里也要看得见它。⛔ 编排器**不重写措辞**
     *   （措辞的唯一来源是服务层 ⇒ 改一处两个工具同步）。
     */
    presetNotice?: string
  }>
  /**
   * 读状态 —— ⚠⚠ **只含 `opts.self` 自己的记录**（`I-4`）。
   *
   * @param opts.wsRoot - 调用方的工作区根（用来判"本会话那份账本够不够得到"）。
   * @param opts.self - 调用方会话 id = **owner 过滤键**。⚠ 不给 ⇒ 只能报"无归属"那一部分，
   *   ⛔ 绝不退化成"全实例汇总"（那正是本件要治的形态：一条 Hob 看见 9 条别人的在等回传）。
   */
  status(opts?: { wsRoot?: string; self?: string }): OrchStatus
  /**
   * 读**卡进度**（隔离执行卡：在跑 / 待验收 / 失败·卡住）。
   *
   * ⚠ 与 `status()` 分开是**刻意的**：`status()` 是**同步**的纯内存读数
   *   （`watches` / `relaysDone` / 落盘可达性），而卡进度要**调看板工具**
   *   （异步、可能失败）⇒ 塞进 `status()` 会把一个纯读数变成会抛错的读数。
   *
   * ⚠ 读不到时**不抛错**，返回 `reachability='unavailable' | 'unreadable'` + 原话
   *   —— 由渲染层说"读不到"（⛔ 不许静默成"没有卡"）。
   *
   * ⚠ **按调用方自己的会话归属工作区过滤**（卡归属的是**项目** = 工作区 id）：
   *   归属判不出 ⇒ **不传过滤**（看全部）—— ⛔ 不许拿猜出来的 id 去过滤（那会**少报**）。
   *
   * @param opts.selfSessionId - 调用方会话 id（用来判"本会话在哪个项目"）。
   */
  cardsOf(opts?: { selfSessionId?: string }): Promise<CardSnapshot>
  /**
   * 登记「这个会话在看本工作区的卡面」—— **卡跑完时叫醒谁**就靠这张表。
   *
   * ⚠ **为什么必须由调用方登记而不是本模块自己猜收件人**：卡跑完是**推送**，
   *   那一刻**没有调用方**（不是谁在问）。凭空假设"收件人 = Hob"会把本模块
   *   与某个具体预设焊死；而"谁读过卡面"是一个**可观测的事实**。
   * ⚠ 只在**读到卡面**时登记（= 订阅语义）：`hob_orch_status` 每被调用一次就续订一次。
   */
  wakeSubscribe(sessionId: string | undefined): Promise<void>
  /** 叫醒面的**运行态读数**（⛔ "没连上"不许被读成"没有卡跑完"）。 */
  wakeState(): WakeState
  /**
   * ⚠⚠ **显式补投一条"投错人"的回执**（2026-10-19 · 用户原话「送错的看能不能重新派送到
   * 对应正确的 hob 预设」）。
   *
   * ── 为什么要有这一层（⛔ 不是重复 `CardWake.redeliver`）───────────────
   *   `CardWake.redeliver(executionId, owner, taskId?)` 要调用方**现读** `owner`
   *   （= 该卡的 `createdBy.sessionId`）。⛔ 只有 `CardWake` 自己读不到它
   *   —— 它只看帧与订阅者，不看卡面。⇒ `owner` 的现读必须在**能读卡面**的这一侧做，
   *   而读卡面（`cardsOf`）归编排器。⇒ 本方法是"**读 owner + 转交**"的唯一落点。
   *
   * ⚠ **人按才动**：⛔ 不被任何失败分支调用、⛔ 不重试；只由 `hob_orch_control` 显式触发。
   * ⚠ **判不出 owner ⇒ 不补投**（`CardWake` 侧落 `refused` + 独立可读话，⛔ 不猜、⛔ 不改投别人）。
   *
   * @param executionId - 那次执行的 id（与 `deliveredLedger()` 同键）。
   * @param taskId - 卡 id（⚠ 用来现读 `createdBy.sessionId`，也用于可读话点名）。
   */
  redeliver(executionId: string, taskId: string | undefined): Promise<{
    kind: 'redelivered' | 'noop' | 'refused'
    reason: string
    owner?: string
  }>
  /**
   * ⚠⚠ **"哪些回执投给了谁"的只读面**（2026-10-19 · `TASK-R3`）。
   *
   * ── 为什么非要有它（上一轮留的那句话就是理由）──────────────────────────
   *   `redeliver` 的入口已经通了，但用户**拿不到 `executionId`** ——
   *   台账只活在 `CardWake` 的私有 `Map` 里、`deliveredLedger()` 只有内部视角
   *   ⇒ 入口通了却按不到，等于没通。本方法把它**如实**端出来。
   *
   * ⚠ **只读、只报**：⛔ 不自动补投、⛔ 不写"建议你去补投"、⛔ 不提示"已修复"。
   * ⚠ **`owner` 要现读卡面**（`createdBy.sessionId`）—— 台账本身⛔ 不记"本该给谁"。
   *   判不出 ⇒ 那一档必须**单独**报出（⛔ 不许混进"没有错投"）。
   */
  deliveryLedger(): Promise<{
    entries: Array<{ executionId: string; to: string; taskId?: string; owner?: string; mismatch: boolean | undefined }>
    total: number
    reachability: 'ok' | 'no-cards' | 'unavailable' | 'unreadable'
    /** 现读不到卡面时的原话（⛔ 不许编造；读到了就是 undefined）。 */
    detail?: string
  }>
  /**
   * **实施会话叫醒面**的运行态读数（2026-10-19 · `TASK-2` 改判后的**主信号源**）。
   *
   * ⚠ 与 `wakeState()`（看板 SSE · **旁证通道**）**分开报** ——
   *   用户原话定的口径是"信号源 = 实施会话状态变化"，SSE 只是旁证
   *   ⇒ 两者混一个计数就等于把旁证升格成判据（`TASK-2` §二-① 明令不许）。
   */
  /**
   * @param self - **调用方会话 id**（owner 过滤键）。⚠ 不给 ⇒ 读数**只报"归属判不出"与
   *   "他人的（条数）"两档**，⛔ **不许报"我的 = 0"**（那是把"不知道我是谁"说成"我没有登记"）。
   *   ⚠⚠ 本参数是 **B4 的破坏性改签名**（`DESIGN` §七-5 采纳 A）：改前它无参、
   *   于是同一工作区两个 Hob 读到对方的登记与叫醒计数（**W6**）。
   */
  dispatchWakeState(self?: string): DispatchWakeState
  /**
   * ⚠⚠ **把盘上的账对平一次**（2026-10-20 · 本单 B5 的**唯一触发入口**）。
   *
   * ⚠ 它是**惰性对账**：不跑就没有任何后台活动；跑一次就"能判的结掉、判不出的留待下次"。
   * ⚠ **所有触发点都只调它**（T1 就绪扫描 / T2 `hob_*` / T3 `agent/status` /
   *   T4 SSE `hello` / T5 有条件复查）—— ⛔ 不许各写一份。
   * ⚠ `trigger` 只为日志可读（⛔ 不影响判据）。
   * ⚠ **不收 `self`**：对账读的是**盘上全部记录**，而"该由谁处置"由既有的 `adoptable`
   *   判据决定（`I-5`）；"回执投给谁"仍然只由每条记录自己的 `owner` / `watcher` 决定（`I-1`）。
   */
  reconcile(trigger: string): Promise<{
    settled: string[]
    unresolved: string[]
    stuck: string[]
    changed: boolean
  }>
  /** 停 / 恢复。 */
  /**
   * 停 / 恢复**调用方自己**的闭环（`I-4` 末条）。
   *
   * ⚠ 改前是一个**进程级布尔** ⇒ 一个工作区 `stop` 会把所有工作区一起停。
   * ⚠ 现在按 `opts.self`（owner）分档：只停那一侧，别人不受影响。
   */
  control(action: 'stop' | 'resume', opts?: { wsRoot?: string; self?: string }): OrchStatus
}

/** 从会话里取"最后一条 assistant 的文本"（跳过 reasoning / tool 块）。 */
function lastAssistantText(session: any): string | undefined {
  try {
    const log = session?.log
    if (!Array.isArray(log)) return undefined
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i]
      if (e?.type !== 'assistant/message') continue
      const content = e.data?.message?.content
      if (!Array.isArray(content)) continue
      const text = content
        .filter((c: any) => c && c.type === 'text' && typeof c.text === 'string')
        .map((c: any) => c.text)
        .join('\n')
        .trim()
      if (text !== '') return text
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * 从会话里取**改动过的文件**（用户指定的回传内容之一）。
 *
 * ⚠ 判据是**工具调用**而不是"读文件"：只认 `write` / `edit` / `notebook_edit` 这类
 *   会落盘的调用，并从它的 `arguments.file_path` 取路径。**这是"它动了什么"的最近似证据**
 *   —— 不是 diff、也不是 git status（那要另开进程）。实测：能从 781 条调用里准确挑出来。
 */
function changedFiles(session: any, max = 40): string[] {
  try {
    const log = session?.log
    if (!Array.isArray(log)) return []
    const seen = new Set<string>()
    for (const e of log) {
      if (e?.type !== 'tool/call') continue
      const nm = e.data?.name
      if (nm !== 'write' && nm !== 'edit' && nm !== 'notebook_edit') continue
      const raw = e.data?.arguments
      if (typeof raw !== 'string' || raw === '') continue
      try {
        const args = JSON.parse(raw)
        const p = args?.file_path ?? args?.path ?? args?.notebook_path
        if (typeof p === 'string' && p !== '') seen.add(p)
      } catch {
        /* 参数不是 JSON 就跳过 —— 不能因为一条坏记录让整份回传失败 */
      }
      if (seen.size >= max) break
    }
    return [...seen]
  } catch {
    return []
  }
}

/** 构造回传给派活方的正文。 */
function buildReceipt(w: Watch, session: any): string {
  const conclusion = lastAssistantText(session)
  const files = changedFiles(session)
  const lines: string[] = [
    '【自动回传】你派出去的那一轮有结果了。',
    '',
    `- 执行会话：${w.target}`,
    ...(w.round === undefined ? [] : [`- 轮次：第 ${w.round} 轮`]),
    ...(w.task === undefined ? [] : [`- 你派的事：${w.task}`]),
    '',
    '## 它给出的结论',
    conclusion === undefined
      ? '（没读到文本结论 —— 它这一轮可能只调了工具就结束了。必要时用 hob_sessions 看它的状态，或直接问它。）'
      : conclusion,
    '',
    '## 它改动的文件',
    files.length === 0
      ? '（没有观察到 write/edit 类调用 ⇒ 这一轮它没有落盘改动。）'
      : files.map((f) => `- ${f}`).join('\n'),
    '',
    '---',
    '⚠ 这只是**你自己的记录**：是"对方说它做了什么"，不是你已经验收过的结果。',
    '下一步由你判断：**续用这个会话**（同一个问题、上下文还干净）还是',
    '**新建一个会话**（进入新阶段、或这一轮把上下文弄脏了、偏离当前任务较大）。',
    '决定后用 hob_dispatch 下发；若判定这件事已经完了，直接宣布结束，不要再派。',
  ]
  return lines.join('\n')
}

// ══════════════════════════════════════════════════════════════════════
// 跨重载的"未结算派发"落盘（本批缺陷修复）
//
// ⚠ 病灶（对照实验已证，2026-10-09）：
//   包一被重载（`dev_reload_package` / 宿主重建），cordis 把它的 fiber **全量重建**
//   （实测 `dsh-hob#521…#525` 全消失、`#529…#533` 全出现），
//   而 `watches` 建在 `apply()` 的 inject 回调**内部** ⇒ 新回调建的是**空 Map**。
//   结果是「在等回传 0 · 已回传 0 · 被停闸拦下 0」—— **与"从来没派过"无法区分**。
//   `relaysBlocked` 为 0 说明不是被刹车吞掉：**记录本身没了**。
//
// ⇒ 修法（**只加可观测，不替派活方做决定**）：
//   · 活着的 watch 落一份盘（`<账本目录>/runtime/orch-watches.json`）；
//   · 新一代就绪时，把上一代留下的 `pending` 判为"丢失"，报给工具输出并唤醒派活方；
//   · **不自动续上 watch** —— `running → idle` 是事件不是可轮询状态，
//     目标若在重载前就跑完了，那条事件永不再来；自动续上会留一个**永不结算**的
//     watch，命中 `dispatch` 的"同目标至多一条未结算"闸门 ⇒ 该会话**永久不能再派**。
//     那是比"丢失"更坏的失败。⇒ 交回派活方：它看到"丢过"后自己决定重派或问。
// ══════════════════════════════════════════════════════════════════════

/**
 * 读出**声明的**账本父目录（`ledgerHome`）。
 *
 * ⚠ 为什么从 loader 的条目里读，而不是写死 `~/.dsh/hob-ledgers`：
 *   写死本机绝对路径撞**可移植性口径 UD-73③**（换机器/换用户就写到
 *   "上一台机器的路径"，本项目有过实测教训，见 `doc-read.ts:57-61`）。
 *   `ledgerHome` 由**预设行**（`preset/dsh-hob/preset-dsh-hob.patch.yml`）
 *   显式声明，正是"这个部署把账本放哪"的**唯一权威值** —— 这里只是把它读出来用。
 *
 * ⚠ 判据是**字符串且非空**：条目配置里可能没有这个键（别的部署）、
 *   也可能是空串（= 用 `doc-read.ts` 的兄弟目录缺省）。两种都返回 `''`，
 *   由 `resolveLedgerRoot` 决定落点。
 *
 * ⚠ **2026-10-10 起导出**：`bus.ts` 的「待投递」记账（`hob_spawn` / `hob_send`）
 *   也要解析账本落点 —— 复用**同一个**解析入口，避免出现第二个实现点
 *   （两处各写一份的话，改一处就会漂）。函数体与位置**未动**，只是加了 `export`。
 */
export function declaredLedgerHome(svcCtx: any): string {
  try {
    const loader = typeof svcCtx.get === 'function' ? svcCtx.get('loader') : undefined
    const entries = loader?.entries?.()
    if (entries === undefined) return ''
    // 深度受限的深搜：条目配置是嵌套结构（`config.plugins[i].config`），
    // 但不能无界递归（对象可能有环）。找到第一个非空 `ledgerHome` 即返回。
    const walk = (node: unknown, depth: number): string => {
      if (depth > 8 || node === null || typeof node !== 'object') return ''
      if (Array.isArray(node)) {
        for (const v of node) { const hit = walk(v, depth + 1); if (hit !== '') return hit }
        return ''
      }
      const o = node as Record<string, unknown>
      const direct = o.ledgerHome
      if (typeof direct === 'string' && direct.trim() !== '') return direct.trim()
      for (const v of Object.values(o)) {
        const hit = walk(v, depth + 1)
        if (hit !== '') return hit
      }
      return ''
    }
    for (const e of entries) {
      const hit = walk(e?.options, 0)
      if (hit !== '') return hit
    }
    return ''
  } catch {
    return ''
  }
}

/**
 * ⚠⚠ **账本根解析的**诊断面**（2026-10-21 · 第 326 轮 · **甲-7**）─────────────────
 *
 * ── 改前的病灶（`PROJECT-SURVEY-3` §6.1 甲-7，被标为"本文件最重的静默面"）──────
 *   `declaredLedgerHome()` **失败一律返回 `''`**（`catch { return '' }` + 两处 `return ''`），
 *   而**下游没有一处问过"这是空账本，还是根本没解析出来"**：
 *     · `scanStateFiles()`：`home === ''` ⇒ **直接 `return out`（空数组）**；
 *     · `armRecheck()`：扫到 0 个文件 ⇒ `hasUnsettled` 恒假 ⇒ `nextRecheckDelay(false, …)`
 *       = `undefined` ⇒ **`clearRecheckTimer()` 当场执行** ⇒ **T5 定时复查被静默关闭**；
 *     · `reachabilityFor()`：`resolveLedgerRoot('', '', wsRoot)` 在 `home===''` 时
 *       **退回缺省兄弟目录**（`doc-read.ts:108`）⇒ 读的是**另一个位置**
 *       ⇒ 读数落成 `'ledger-unreachable'`，与"账本真的不存在"**逐字相同**。
 *   ⇒ ⚠ 后果（多账本 / 深搜歧义布局）：**派发的回执永不结算，且没有任何周期性补偿**，
 *     而运行期**只有装配期一条 warn**（`logger.debug`，默认看不见）。
 *
 * ── 现在：把"解析不到"变成**可分辨的四档**（⛔ 不是三种，见下）──────────────
 *   ⚠ **为什么不复用 `declaredLedgerHome() === ''` 这一个布尔**：
 *     它们**成因不同、修法不同**，压成一个布尔就又是"两种原因说成同一句话"：
 *       · `no-loader`    ⇒ 宿主没给 `loader`（装配面问题，⛔ 改账本没用）；
 *       · `unreadable`   ⇒ `loader.entries()` **抛了**（配置面坏了 —— ⚠ 与"没配"不是一回事）；
 *       · `absent`       ⇒ 条目里**没有非空 `ledgerHome`**（配置没写 / 写空）；
 *       · `ok`           ⇒ 解析到了（`home` 非空）。
 *   ⚠ `declaredLedgerHome()` 的**签名与返回值一个字未改**（`bus.ts` 还在用它，⛔ 不破坏调用方）；
 *     本函数是**新增的第二个入口**，只在"要读数"的地方用。
 *
 * ── ⚠ ⛔ 本函数**不做任何 IO**：只读 `loader` 的内存投影 ⇒ 读状态时调它没有代价。
 */
export type LedgerHomeDiag =
  | { kind: 'ok'; home: string; reason?: undefined }
  | { kind: 'no-loader'; home: ''; reason: string }
  | { kind: 'unreadable'; home: ''; reason: string }
  | { kind: 'absent'; home: ''; reason: string }

/** 见 {@link LedgerHomeDiag}。⚠ 与 `declaredLedgerHome()` **同一段深搜口径**（⛔ 不另写一份）。 */
export function ledgerHomeDiag(svcCtx: any): LedgerHomeDiag {
  let entries: unknown
  try {
    const loader = typeof svcCtx?.get === 'function' ? svcCtx.get('loader') : undefined
    if (loader === undefined) {
      return { kind: 'no-loader', home: '',
        reason: '宿主没提供 `loader` 服务 ⇒ 读不到任何条目配置' }
    }
    entries = loader?.entries?.()
    if (entries === undefined) {
      return { kind: 'no-loader', home: '',
        reason: '`loader.entries()` 不可用 ⇒ 读不到任何条目配置' }
    }
  } catch (e) {
    /**
     * ⚠ **`entries()` 抛错 ≠ 没配置**：前者是**装配面坏了**，后者是**配置没写**。
     *   改前两者都被 `catch { return '' }` 吞成同一个空串 ⇒ ⛔ 正是本件要治的形态。
     */
    return { kind: 'unreadable', home: '',
      reason: `\`loader.entries()\` 抛错 ⇒ 配置面读不了（${String((e as Error)?.message ?? e)}）` }
  }
  // ⚠ 深搜口径与 `declaredLedgerHome()` **逐字相同**（深度 8、取第一个非空、trim）。
  const walk = (node: unknown, depth: number): string => {
    if (depth > 8 || node === null || typeof node !== 'object') return ''
    if (Array.isArray(node)) {
      for (const v of node) { const hit = walk(v, depth + 1); if (hit !== '') return hit }
      return ''
    }
    const o = node as Record<string, unknown>
    const direct = o.ledgerHome
    if (typeof direct === 'string' && direct.trim() !== '') return direct.trim()
    for (const v of Object.values(o)) {
      const hit = walk(v, depth + 1)
      if (hit !== '') return hit
    }
    return ''
  }
  for (const e of entries as any[]) {
    const hit = walk(e?.options, 0)
    if (hit !== '') return { kind: 'ok', home: hit }
  }
  return { kind: 'absent', home: '',
    reason: '条目配置里**没有非空 `ledgerHome`** ⇒ 落回缺省的兄弟目录（⛔ 那不是"账本是空的"）' }
}

/**
 * 解析**运行态文件**的路径（`<账本目录>/runtime/orch-watches.json`）。
 *
 * @param svcCtx - 本模块作用域（用来读 loader 与 sessions）。
 * @param wsRoot - 工作区根（决定账本目录；判不出 ⇒ 返回 undefined，fail-closed）。
 */
function runtimeFileOf(svcCtx: any, wsRoot: string | undefined): string | undefined {
  const ledgerRoot = resolveLedgerRoot('', declaredLedgerHome(svcCtx), wsRoot)
  if (ledgerRoot === undefined) return undefined
  return orchStateFileOf(ledgerRoot)
}

/**
 * 扫出**所有**候选运行态文件（跨工作区）。
 *
 * ⚠ 用途只有一个：**插件刚就绪、还没有任何 watch** 时（= 重载后的新代）
 *   要找出上一代留下的记录 —— 那时没有"这一轮的 workspace"可依据，
 *   只能按 `ledgerHome` 扫一层：`<ledgerHome>/<工作区名>/runtime/orch-watches.json`。
 *   （⚠ 这里**刻意不写 glob 星号形态**：星号紧跟斜杠会在**块注释**里拼出注释结束符
 *   ⇒ **提前闭合注释**，把后面的代码全变成语法垃圾。
 *   沿革：此处原先靠一个 U+200B 夹在星号与斜杠之间**碰巧**挡住了这个缺陷，
 *   2026-10-10 第 45 轮清理零宽字符时才暴露 ⇒ 改为**用文字描述路径**，不写 glob。）
 *   这一层扫描是**确定的**（不是全盘搜索），且只在重载后跑一次。
 */
function scanStateFiles(svcCtx: any): string[] {
  const out: string[] = []
  try {
    const home = declaredLedgerHome(svcCtx)
    if (home === '') return out
    for (const name of readdirSync(home)) {
      const f = join(home, name, ORCH_STATE_SUBDIR, ORCH_STATE_FILENAME)
      if (existsSync(f)) out.push(f)
    }
  } catch {
    /* 父目录不在/不可读 ⇒ 没有可扫的（不是错误：可能从未派过） */
  }
  return out
}

/**
 * 把一个内存 watch 收窄成可序列化的一条（带**它自己的**工作区归属与 owner）。
 *
 * ⚠⚠ **`wsRoot` 只许是这一条记录自己的工作区根**（`I-5`）：
 *   改前的调用点传的是"**本次派发的目标** cwd"，而写入时又 `[...watches.values()]`
 *   把**整张表**写进那一个文件 ⇒ 外来记录被**盖上了本工作区的 `wsRoot`**
 *   （跨工作区互相污染，`1.4` 那条病根）。
 *   ⇒ 现在 `wsRoot` 来自**记录自己的 `ownerWsRoot`**，判不出就不写该字段
 *     （⛔ 不许拿别人的 / 拿当前的顶替）。
 *
 * @param w - 内存里的一条 watch（**必须已经带 owner**）。
 */
function toPersisted(w: Watch): PersistedWatch {
  return {
    target: w.target,
    watcher: w.watcher,
    ...(w.round === undefined ? {} : { round: w.round }),
    ...(w.task === undefined ? {} : { task: w.task }),
    at: w.at,
    sawRunning: w.sawRunning,
    ...(w.error === undefined ? {} : { error: w.error }),
    // 🔑 归属两件：**逐条**带（⛔ 不再由调用点"统一盖一个"）
    ...(w.owner === undefined || w.owner === '' ? {} : { owner: w.owner }),
    ...(w.ownerWsRoot === undefined || w.ownerWsRoot === '' ? {} : { wsRoot: w.ownerWsRoot }),
    // ── 耐久化五件（2026-10-20 · B2）：⛔ 缺一就修不掉 W3 / W4 / P2 ──────────
    ...(w.lastStatus === undefined ? {} : { lastStatus: w.lastStatus }),
    /**
     * ⚠⚠ **投递三件必须落盘**（2026-10-20 · 第 4 单）：它们是**跨进程幂等**的唯一依据
     *   （`reported` 只在内存里，一重载就归零 ⇒ 同一份回执会再发一份）。
     *   ⚠ 三件语义各不相同，⛔ 不许合并成一个字段：
     *     · `deliveryAttemptAt` —— 投之前落的"试过了"；
     *     · `deliveredAt` —— 投**成功**（⇒ 只差清账，⛔ 绝不重发）；
     *     · `cleanupFailedAt` —— 送到了但**清账失败**（下一轮只重试清账）。
     */
    ...(w.deliveryAttemptAt === undefined ? {} : { deliveryAttemptAt: w.deliveryAttemptAt }),
    ...(w.deliveredAt === undefined ? {} : { deliveredAt: w.deliveredAt }),
    ...(w.cleanupFailedAt === undefined ? {} : { cleanupFailedAt: w.cleanupFailedAt }),
    ...(w.settleState === undefined ? {} : { settleState: w.settleState }),
    ...(w.recheckCount === undefined ? {} : { recheckCount: w.recheckCount }),
    ...(w.lastRecheckAt === undefined ? {} : { lastRecheckAt: w.lastRecheckAt }),
    ...(w.evidence === undefined ? {} : { evidence: w.evidence }),
  }
}

/**
 * 落盘"这一代还活着的 watch"（保留既有 `lost`）。
 *
 * ⚠ 写失败**必须留痕**（返回 false ⇒ 调用方记 warn）——
 *   一个"记不上账"的诊断若静默，就又回到本批要修的失败模式。
 */
function persistWatches(file: string | undefined, pending: PersistedWatch[]): boolean {
  if (file === undefined) return false
  try {
    const prev = readOrchState(file)
    return writePending(file, pending, prev.lost)
  } catch {
    return false
  }
}

/** 就绪时挂上的实现。 */
export function apply(ctx: any): void {
  ctx.logger?.debug?.(`[${name}] 已激活，等待 sessions/agents`)

  ctx.inject(['sessions', 'agents'], (svcCtx: any) => {
    const sessions = svcCtx.sessions ?? svcCtx.get?.('sessions')
    const agents = svcCtx.agents ?? svcCtx.get?.('agents')
    if (sessions === undefined || agents === undefined) {
      svcCtx.logger?.warn?.(`[${name}] sessions/agents 已就绪但不可用。`)
      return
    }

    /**
     * 现读**目标会话的预设 id**（第 129 轮 · 判据 4）。
     *
     * ── 为什么是"每次现读"而不是"登记 watch 时存一份"──────────────────────
     *   `hob_orch_status` 的那一行读数，存在的唯一理由就是**此刻**它准不准。
     *   存一份到 `w` 上 ⇒ 会话被换掉 / 插件重载 / 目标重启之后，
     *   那行会**悄悄变成旧值**，而它正是用来发现"派错了人"的**唯一可见面**
     *   ⇒ 过期值比没有更坏（**E-117**：把某一时刻的读数当成了判据）。
     *
     * ── ⚠ ⚠ 读数**不再在这里读**（2026-10-17 第 2 轮 · `CHG-058` 收口）───────────
     *   ⚠ 原文（本行原先）写的是"与 `list()` 读的是**同一个实体**
     *   （`session.header.agentPreset`，见 `bus.ts`）" —— **那句话现在是错的**：
     *   `bus.ts` 自第 292 轮起已改走宿主 **`agentPreset` 投影**
     *   （= header 起步 + 最后一条 `agent-preset/selected`），而本模块**仍在读建档头**
     *   ⇒ ⚠ 实测后果（本工作区 13 条会话）：**4 条 `header=standard / 投影=Hob`**
     *   （**含 Hob 自己**）⇒ 这一列**给错值**，且「⚠ 规划侧预设·不能施工」
     *   对这 4 条**不会触发**。
     *   ⚠ ⚠ 修法**不是**在这里再写一份 `stateOf(...)` —— 那是"守卫写两遍必然漂"
     *   （本仓纪律），而且这次事故的**成因正是**两处各自读。⇒ 唯一入口 =
     *   `hobBus.presetOf(id)`，读法与 `list()` / `deliver()` **同一个函数**。
     *
     * ⚠ **降级语义原样保留且可分辨**：投影读不到 ⇒ 总线退回建档头并给
     *   `source='header'`；本模块把来源**透传**到 `status()`，由渲染层标「降级」。
     *   ⛔ 不许把降级值当真值用（那正是 `CHG-058` 要治的形态）。
     *
     * @returns `[preset, source]`；读不到（总线缺席 / 会话没了 / 两个来源都空）⇒
     *   `[undefined, undefined]`，由调用方渲染成 `(读不到)` —— ⛔ 不编造、不猜默认值。
     */
    const targetPresetOf = (target: string): [string | undefined, PresetSource | undefined] => {
      try {
        const bus = (() => { try { return svcCtx.get?.('hobBus') } catch { return undefined } })()
        if (bus === undefined || typeof bus.presetOf !== 'function') return [undefined, undefined]
        const r = bus.presetOf(target)
        if (r === undefined || r === null) return [undefined, undefined]
        const preset = typeof r.preset === 'string' && r.preset !== '' ? r.preset : undefined
        const source = r.source === 'projection' || r.source === 'header' ? r.source : undefined
        return [preset, preset === undefined ? undefined : source]
      } catch {
        return [undefined, undefined]
      }
    }

    /**
     * 本会话属于哪个**工作区**（= 看板卡的 `workspaceId` 口径）。
     *
     * ⚠ **唯一实现，两个消费方共用**（`cardsOf` 的卡面过滤 + 卡跑完叫醒面的过滤）：
     *   叫醒面与显示面**必须是同一个**（作业书 §一-2），否则会出现
     *   "叫醒说有卡跑完、状态行里看不到那张卡" —— 那比不叫更坏。
     * ⚠ 走 `hobBus.listWorkspaces(self)` 的 `self` 那一行（`bus.ts` 已是唯一实现）。
     * ⚠ 判不出 ⇒ `undefined`（调用方各自按"不猜"处理：卡面**不过滤**、叫醒面**不叫**）。
     */
    const workspaceIdOfSession = async (selfSessionId: string | undefined): Promise<string | undefined> => {
      try {
        const bus = svcCtx.get?.('hobBus')
        if (bus === undefined || typeof bus.listWorkspaces !== 'function') return undefined
        const rows = await bus.listWorkspaces(selfSessionId)
        const own = (Array.isArray(rows) ? rows : []).find((r: any) => r?.self === true)
        if (own === undefined || typeof own.id !== 'string' || own.id === '') return undefined
        return own.id
      } catch {
        return undefined
      }
    }

    /**
     * **卡跑完 ⇒ 叫醒**（2026-10-18 · 缺口实测：长活卡 22:59:20 收工，Hob 没被叫醒）。
     *
     * ⚠ 信号面 = **看板自己推的 SSE**（不是宿主事件 —— 第三方包里 `emit` 零命中）；
     *   判据与去重全在 `server/card-wake.ts`（那里有完整出处与理由）。
     * ⚠ **它不新增工具名**：读数挂在既有的 `hob_orch_status` 里（见渲染层）。
     * ⚠ **它不碰 `watches`**：重挂是另一笔账（作业书 §三明令）。
     */

    /** 叫醒面现用的工作区 id（⚠ 由订阅时登记 —— `CardWake` 每次现读它）。 */
    let wsIdForWake: string | undefined

    /**
     * **按卡 id 现读执行会话并登记**（2026-10-19 · 补"不许依赖事先读卡面"那个缺口）。
     *
     * ⚠ ⚠ 它解决的是**实测打空**的那一次：卡 00:24:13 点火 → 00:24:33 落定 →
     *   Hob 00:35 才第一次读卡面 ⇒ 登记发生在跑完之后 ⇒ `running → idle` 那一跳早过去了。
     *   现在改成：**点火帧一到就现读这一张卡**，把 `executionSessionId` 登记进叫醒面。
     * ⚠ **只读被点名的那一张**（`taskboard_get`），⛔ 不扫全表、⛔ 不靠定时轮询。
     * ⚠ 三档分开（`found` / `no-session` / `unreadable`），后两档**必须留可读痕**
     *   （`registryIssue`），⛔ 不许静默当成"没有这张卡"。
     */
    const registerCardByPush = async (cardId: string, subscriber: string | undefined): Promise<void> => {
      /**
       * ── ⚠⚠ **"收到过帧"必须单独留痕**（2026-10-20 · 第 323 轮 · `TASK-I`）──────────
       *
       * ⚠ 这一行在本函数**最开头**、且**在准入门之前** —— 顺序是本件的全部要害：
       *   头行要说清"是被准入拦下的"，就必须**先证明帧真的到过**，
       *   再做归属判断。若记在准入之后，被拦下的那些帧就**永远**记不到
       *   ⇒ 又回到"两种原因说成同一句话"。
       * ⚠ 按 `subscriber` 落账（不是进程级合计）：头行是**按人读**的（W6 同族）。
       */
      if (typeof subscriber === 'string' && subscriber !== '') {
        dispatchWake.noteFiringSeen(cardId, subscriber)
      }
      try {
        /**
         * ⚠⚠ **"是谁在看这个面"必须显式传进来**（`I-2`：⛔ 不许用进程级单值决定归属）。
         *
         * 改前本函数只收 `cardId`，"登记进谁的表"隐含地由进程级 `selfSessionId` 决定
         * （见已删除的 `setSelfSessionId`）⇒ **后读者覆盖先读者**。
         * ⇒ 现在由 `CardWake` 的订阅者（= 正在看卡面的那个会话）显式带进来；
         *   判断它是不是这张卡的 owner，交给下面同一道准入门。
         */
        const registry: any = (() => { try { return svcCtx.get?.('tools') } catch { return undefined } })()
        const getTool = registry !== undefined && registry !== null && typeof registry.get === 'function'
          ? (n: string) => registry.get(n)
          : undefined
        const r = await lookupCardSession(cardId, getTool)
        if (r.kind === 'found') {
          /**
           * ⚠⚠ **归属证明（`I-3`）**：这张卡得是**这个订阅者自己**建的/派的，才登记。
           *   判据 = `lookupCardSession` 现读回来的 `createdBySessionId`（看板 `createdBy.sessionId`）。
           *   ⛔ 判不出（读不到 / 不是它）⇒ **不登记** + 独立一档可读话，
           *     ⛔ 不许"本工作区的卡一律算我的"（那正是同一工作区互相串收的成因）。
           */
          const cardOwner = r.createdBySessionId
          if (typeof subscriber !== 'string' || subscriber === ''
            || cardOwner === undefined || cardOwner !== subscriber) {
            dispatchWake.noteOwnerUnknown(
              r.cardId,
              r.sessionId,
              cardOwner === undefined
                ? '按卡现读回来没有建卡会话（`createdBy.sessionId` 空）'
                : `这张卡属于 ${cardOwner}，而当前看这个面的是 ${String(subscriber ?? '(判不出)')}`,
              // ⚠ 传执行 id ⇒ `noteOwnerUnknown` 才能按 (卡, 执行) 去重（修 960 的一半）
              r.executionId,
            )
            /**
             * ⚠⚠ **同时记"帧到了但被这道准入拦下"**（第 323 轮 · `TASK-I`）——————
             *   ⛔ 这两条不是重复计数（两道不同的档，各自回答不同的问题）：
             *     · `noteOwnerUnknown` 回答"**归属判不出 ⇒ 这张卡的回执不该给我**"（服务面口径）；
             *     · 本行回答"**帧到过、是被这道准入挡住的**"（头行拆档口径）。
             *   ⚠ 少了本行，头行就只能说"没登记成功"，⛔ 说不出"被哪一道拦的" ——
             *     而那句话正是本件要治的（读的人该去查准入，不是去查"为什么没帧"）。
             */
            dispatchWake.noteFiredBlocked(
              r.cardId,
              cardOwner === undefined ? 'owner-unknown' : 'not-my-card',
              cardOwner === undefined
                ? '按卡现读回来没有建卡会话（`createdBy.sessionId` 空）'
                : `这张卡属于 ${cardOwner}，而当前看这个面的是 ${String(subscriber ?? '(判不出)')}`,
              subscriber,
            )
            return
          }
          /**
           * ── ⚠⚠ **执行方 ≠ 派活方**（2026-10-20 · 第 6 单 §1.3 · Hob 追加要求）──────────
           *
           * 上面那道准入只判"这张卡**是我的**"（`createdBy === subscriber`），
           * ⛔ **没判"执行方是不是就是我自己"**。
           * 现场：卡 `t-mvfertx2-zrnyvc` 被点火 20 次，`executionSessionId` **全部 = 建卡人自己**
           * ⇒ 我既是派活方又是执行方 ⇒ 登记成"实施会话 = 我" ⇒ 我自己 turn 结束就把我自己叫醒。
           * ⇒ 在这里**明说这一句**（`register()` 里另有一道同款硬闸兜底，⛔ 两处不是重复：
           *   这里是**准入面**，那里是**服务面**；单层设防等于绕过去就没保护）。
           */
          if (r.sessionId === cardOwner) {
            dispatchWake.noteOwnerUnknown(
              r.cardId,
              r.sessionId,
              '这张卡的**执行会话就是建卡会话本身**（`executionSessionId === createdBy.sessionId`）'
                + '⇒ 它自己跑完不是"某个被派出去的活跑完了"⇒ **不登记**（⛔ 不是"没有会话在跑"）',
              r.executionId,
            )
            /** ⚠ 同上：**帧到了，被 `selfExecuted` 这道准入拦下**（第 323 轮 · `TASK-I`）。 */
            dispatchWake.noteFiredBlocked(
              r.cardId,
              'self-executed',
              '这张卡的**执行会话就是建卡会话本身**（`executionSessionId === createdBy.sessionId`）',
              subscriber,
            )
            return
          }
          dispatchWake.register({
            sessionId: r.sessionId,
            via: 'taskboard-card',
            cardId: r.cardId,
            ...(r.executionId === undefined ? {} : { executionId: r.executionId }),
            owner: cardOwner,
            ...(wsRootOfSession(cardOwner) === undefined ? {} : { ownerWsRoot: wsRootOfSession(cardOwner) }),
          })
          /**
           * ⚠⚠ **必须把订阅者（= 这个 owner）传下去**（2026-10-20 · 第 321 轮 · `TASK-G` ②）。
           *
           * ── 改前是什么（本项目头号禁忌：**让失败不可观测**）─────────────────
           *   这一处（以及下面两处）**都没传 `owner`** ⇒ `DispatchWake.bump()` 遇空
           *   **直接 return**（见 `card-wake.ts` 的 `bump`：`if (typeof owner !== 'string' || owner === '') return`）
           *   ⇒ `ownedPushedOk` 里一条都不记 ⇒ **按人读的 `pushedRegisterOk` 恒 0**
           *   ⇒ `hob_orch_status` 的头行**永远打「还没接上」**，**而它其实接上了**。
           *   ⚠ 现场读数正是这一句：点火帧已经把会话登记进来了（`registered=1`、真叫醒过），
           *     头行却写 `⚠ 还没接上（未收到过点火帧）` —— 两个读数互相打架，
           *     而读的人只能信头行。
           *
           * ── 现在 ────────────────────────────────────────────────────────
           *   传**这次登记用的那个订阅者**（`registerCardByPush(cardId, subscriber)` 的入参，
           *   就是"谁在看这个面"= 这张卡的 owner，上面那道准入已经保证它 === `cardOwner`）。
           *   ⛔ **不许改成"改读进程级的那个数"** —— 那等于退回"两个 Hob 互相看见"
           *     （另一个已登记的毛病，`I-2` / 波次 W6），本件不动它。
           */
          dispatchWake.noteRegistryOk(cardId, subscriber)
          return
        }
        /**
         * ⚠ **这两档同样要传 `owner`**（同 `noteRegistryOk` 的理由）：
         *   ⛔ 不传 ⇒ `bump` / `sayFor` 遇空直接 return ⇒ 按人读的
         *   `pushRegisterIssues` 恒 0、`pushRegisterWhy` 恒空 ⇒ **"读不到"这件事
         *   在读数里彻底消失**（本项目头号禁忌）。失败比成功更需要归属。
         */
        // ⚠ 后两档**都不是**"没有卡在跑" ⇒ 各自留一句可读话（⛔ 不许静默）
        dispatchWake.noteRegistryIssue(cardId, r.kind, r.why, subscriber)
      } catch (e) {
        dispatchWake.noteRegistryIssue(cardId, 'unreadable', `按卡现读会话时抛错：${String((e as Error)?.message ?? e)}`, subscriber)
      }
    }

    const wake = new CardWake({
      /**
       * ⚠ ⚠ **现取**（函数），⛔ **不是 apply 那一刻的快照**（2026-10-19 重启实测的缺陷）。
       *
       * 改前：这里是一个**立即求值的 IIFE** ⇒ 地址在 `apply()` 那一刻被定死。
       *   而 `webServer` 与本模块**没有激活顺序保证**（`.hob/experience/1.md` 的 **E-01**：
       *   同一坑在路由注册上已经踩过一次）⇒ 那一刻取不到（或 `getOrigin()` 抛
       *   "origin read before the listener bound a port"）⇒ `origin = undefined` **永久**。
       *   ⚠ 实测后果（重启后）：`12:36:27` / `12:37:17` / `12:45:57` **三次读数都是**
       *   「拿不到看板地址（webServer 不可用）」——**不会自愈**，因为再也没人去取第二次。
       * ⇒ 改成一个**每次调用都现读**的函数：`CardWake.start()` 每次都调它
       *   ⇒ 宿主 web 服务一 bind，下一次读状态就接上。
       * ⚠ `try/catch` 保留：取不到就返回 `undefined`（由 `CardWake` 报可读话），
       *   ⛔ 不许让"取地址失败"把整个模块带崩。
       */
      origin: () => {
        try {
          const web = svcCtx.get?.('webServer')
          return typeof web?.getOrigin === 'function' ? String(web.getOrigin()) : undefined
        } catch { return undefined }
      },
      workspaceIdOf: () => wsIdForWake,
      /**
       * ⚠ **点火帧回调**（补缺口的核心）：推送里已经带卡 id ⇒ 现读那一张并登记。
       * ⚠ **不 await**（SSE 循环不能被磁盘/工具调用拖住）；失败由 `registerCardByPush` 自己留痕。
       */
      /**
       * ⚠⚠ **把"当前订阅者快照"显式传下去**（`I-2` / `I-3`）：
       *   改前这个回调只带 `taskId`，登记目标隐含地来自进程级单值 ⇒ 后读者覆盖先读者。
       *   ⇒ 现在逐个订阅者判"它是不是这张卡的 owner"（判据在 `registerCardByPush` 里）。
       */
      onFiring: (e: CardFiringEvent, subscribers: WakeTarget[]) => {
        for (const sub of subscribers) void registerCardByPush(e.taskId, sub.sessionId)
      },
      /**
       * ── **T4：看板 SSE 的 `hello` 帧也触发一次对账**（B5；`card-wake.ts` 侧已实现）──
       *
       * ⚠ 改前 `handleFrame` 第一行就是 `if (kind !== 'change') return 0` ⇒ `hello` 被**直接丢掉**
       *   ⇒ 重连不补帧（`FINDINGS`/`DESIGN` §4.4 的 T4/T5 原文）。
       * ⚠ 现在重连那一下顺手把账对平 —— **零额外连接、零周期**，复用的就是本来就有的长连接。
       * ⚠ 它仍然**只是大概率**（只在重连时来），⛔ 不许当成保证。
       */
      onHello: () => {
        void reconcile('sse-hello').catch(() => { /* reconcile 自己已接住 */ })
      },
      /**
       * ⚠⚠ **按卡现读 owner**（2026-10-20 · 第 4 单）—— 治「自家卡叫不醒」。
       *
       * ⚠ 为什么必须有它：看板 SSE 的 `broadcast()` 推的是 `summarize()` 投影，
       *   **投影里没有 `createdBy`** ⇒ 真帧上 owner 永远读不到 ⇒ 卡跑完一声不投
       *   （现场原文 `⚠ 有卡跑完（t-mvfertx2-zrnyvc …）但**判不出它的 owner**`）。
       * ⚠ 归属证明的口径**一个字不改**（`I-3` 第 ③ 条）：读的是**这张卡自己的**
       *   `createdBy.sessionId`，⛔ 不是"本工作区的卡一律算我的"、⛔ 不是按工作区广播。
       * ⚠ 读不到（没卡 / 卡已删 / 没记字段）⇒ 返回 `undefined` ⇒ 上层仍按"判不出 ⇒ 不投"。
       */
      ownerOf: async (taskId: string): Promise<string | undefined> => {
        try {
          const registry: any = (() => { try { return svcCtx.get?.('tools') } catch { return undefined } })()
          const getTool = registry !== undefined && registry !== null && typeof registry.get === 'function'
            ? (n: string) => registry.get(n)
            : undefined
          const r = await lookupCardSession(taskId, getTool)
          return r.kind === 'found' ? r.createdBySessionId : undefined
        } catch {
          return undefined
        }
      },
      /**
       * ⚠⚠ **按卡现读"这次是谁在跑"**（2026-10-20 · 第 7 单）—— 治「自己叫醒自己」。
       *
       * ⚠ 为什么必须有它：看板 SSE 帧是 `summarize()` 投影，**既无 `createdBy`、
       *   也无 `executions[].sessionId`**（第三方包 `lib/shared/protocol.js:965-987` 原文）
       *   ⇒ "执行方是不是 owner 本人"在帧上**永远判不出** ⇒ 只能按卡 id 现读。
       * ⚠ 现场：卡 `t-mvfertx2-zrnyvc` 的 **20 条执行**，`sessionId` 全部 = 建卡会话自己
       *   ⇒ 每一轮结束都"卡跑完"一次、再通知回它自己 ⇒ 05:54:23–06:06:29 收到 25 条
       *   `[实施会话跑完]`，最密一段间隔 0.1–0.3 秒（会话档案实测）。
       * ⚠ 读不到（没卡 / 卡已删 / 最近一次执行没记会话 id）⇒ `undefined`
       *   ⇒ 上层落"这一档不生效"（照常按 owner 投，⛔ 不做成"判不出就拦"）。
       */
      execSessionOf: async (taskId: string): Promise<string | undefined> => {
        try {
          const registry: any = (() => { try { return svcCtx.get?.('tools') } catch { return undefined } })()
          const getTool = registry !== undefined && registry !== null && typeof registry.get === 'function'
            ? (n: string) => registry.get(n)
            : undefined
          const r = await lookupCardSession(taskId, getTool)
          return r.kind === 'found' ? r.sessionId : undefined
        } catch {
          return undefined
        }
      },
      /**
       * ⚠⚠ **看板卡回执走内部入口**（2026-10-20 · 第 4 单）：收件人 `= 该卡的 createdBy.sessionId`
       *   **就是派活方自己** ⇒ 走 `deliver()` 会被"拒投给自己"那一道打回（T2 作用域下恒失败）。
       *   `deliverInternal` 与它**同一份实现**，只跳过那一道；归档/活会话/预设预警全都照旧。
       */
      deliver: (sessionId: string, text: string) => {
        const bus = (() => { try { return svcCtx.get?.('hobBus') } catch { return undefined } })()
        if (bus === undefined || typeof bus.deliver !== 'function') {
          return Promise.reject(new Error('hobBus 未提供 ⇒ 投递通道不可用'))
        }
        const send = typeof bus.deliverInternal === 'function' ? bus.deliverInternal.bind(bus) : bus.deliver.bind(bus)
        return Promise.resolve(send(sessionId, text, 'followup'))
      },
      log: (line: string) => svcCtx.logger?.info?.(`[${name}] ${line}`),
    })

    /**
     * **实施会话叫醒面**（2026-10-19 · `TASK-2` 改判 · **主信号源**）。
     *
     * ⚠ ⚠ 用户原话：「看板执行完任务之后会移动到待验收区域，你不要让看板告诉你这是不可能的，
     *   你需要自己对派出去的实施会话状态变化检查去检测，而且看板是其他的插件，
     *   你需要自己直接去检测实施会话的状态变化」
     *   ⇒ 信号源 = **实施会话的 `running → idle`**；看板卡的 `in_review` **只是旁证**。
     * ⚠ `watches`（重挂那一套）**一行未动** —— 这是**另一张表**（`DispatchWake.sessions`）。
     */
    const dispatchWake = new DispatchWake({
      /** ⚠ 同上：叫醒的收件人是 `owner` = 派活方自己 ⇒ 走内部入口（只跳过"拒投给自己"那一道）。 */
      deliver: (sessionId: string, text: string) => {
        const bus = (() => { try { return svcCtx.get?.('hobBus') } catch { return undefined } })()
        if (bus === undefined || typeof bus.deliver !== 'function') {
          return Promise.reject(new Error('hobBus 未提供 ⇒ 投递通道不可用'))
        }
        const send = typeof bus.deliverInternal === 'function' ? bus.deliverInternal.bind(bus) : bus.deliver.bind(bus)
        return Promise.resolve(send(sessionId, text, 'followup'))
      },
      log: (line: string) => svcCtx.logger?.info?.(`[${name}] ${line}`),
    })
    /**
     * 在等的派发：按**执行方会话 id** 索引。
     *
     * ⚠ **不变量（2026-10-09 起由 `dispatch` 的闸门强制）**：同一 target **至多一条未结算
     *   （`!reported`）的 watch** —— 有则 `dispatch` **拒绝**新派发（见该处注释）。
     *   这条不变量是"回传不丢也不错配"的前提：`agent/status` 事件**不带轮次**，
     *   两轮同时挂着时无法判断这次 `running → idle` 属于谁。
     */
    /**
     * ⚠⚠ **最近一次「`runtime/.gitignore` 没写成」**（2026-10-21 · 第 329 轮 · **甲-9**）。
     *
     * ⚠ **为什么必须是模块级**：写入发生在 `dispatch` 的局部作用域里，而读数
     *   （`hob_orch_status`）在完全另一个函数里 —— 局部变量传不过去。
     * ⚠ **只保留最近一次**（⛔ 不累积成数组）：本字段的用途是"**此刻**这件事发生过没有"，
     *   而 `runtime/.gitignore` 一旦写成就永久存在 ⇒ 累积计数没有信息量，只会让读数越跑越长。
     * ⚠ **正常档是 `undefined`** ⇒ 状态行**一个字都不多**（TASK 要求：只在异常档出现）。
     */
    let runtimeIgnoreNote: string | undefined
    const watches = new Map<string, Watch>()
    /** 上一次见到的状态，用来识别 `running → idle` **跳变**（而不是"看到 idle"）。 */
    const lastStatus = new Map<string, string>()
    /**
     * ⚠⚠ **`stopped` 按 owner 分开**（`I-4` 末条：`stop` / `resume` 只作用于**调用方自己**）。
     *
     * 改前它是一个**进程级布尔** ⇒ 任何一个工作区的 Hob 一句 `stop`，
     * **所有工作区**的闭环一起停（用户明确要求"闭环隔离"）。
     * ⚠ 键 = owner 会话 id；无 owner 的记录**不受任何人的 stop 影响**
     *   （它本来就不属于任何闭环）—— ⚠ 也⛔ 不许因此被"顺带停掉"。
     */
    const stoppedOwners = new Set<string>()
    let relaysDone = 0
    let relaysBlocked = 0
    /**
     * 判断某个 owner 的闭环是否被停。
     * @param owner - 谁的闭环；`undefined` / 空 ⇒ **无归属 ⇒ 不归任何人停**（返回 false）。
     */
    const isStoppedFor = (owner: string | undefined): boolean => {
      if (owner === undefined || owner === '') return false
      return stoppedOwners.has(owner)
    }

    /**
     * 目标会话 → 运行态文件（登记时定下来；结算时按同一个文件改）。
     *
     * ⚠⚠ **声明位置必须在"重载后接手"那一段之前**（2026-10-20 · 修 **W4**）：
     *   重挂路径也要往这里写（`stateFileFor.set(target, file)`），
     *   否则 `flushWatches` 里 `stateFileFor.get()` 为 `undefined` ⇒ `continue`
     *   ⇒ **回传成功了盘上仍留着 pending** ⇒ 下次重载再判 lost（永久循环累积）。
     */
    const stateFileFor = new Map<string, string>()

    // ══════════════════════════════════════════════════════════════════
    // 重载后接手：**先核再判**（2026-10-18 第 2 轮 · `UD-137` 裁定 3）
    // ══════════════════════════════════════════════════════════════════
    // ⚠ 此刻 `watches` 一定是**空的**（本回调刚建它）⇒ 落盘里任何 `pending`
    //   都是**上一代**留下的（见 `markLost` 的 `known` 判据注释）。
    //
    // ── 旧口径（改前）与它为什么被撤 ────────────────────────────────────
    //   改前：`markLost(file, () => false)` ⇒ 盘上 pending **一律判死**、**不重挂**。
    //   理由原文（本文件旧注释）：「`running → idle` 是事件，目标若在重载前就跑完则
    //   永不再来，续上会留一个**永不结算**的 watch」。
    //   ⚠ ⚠ **那条理由只描述"已经跑完"这一档** —— 它把两种情况压成了同一个结果。
    //
    // ── 新口径（分两档，⛔ 不许混）────────────────────────────────────────
    //   · 目标**仍在跑** ⇒ **重新挂上**（`r.reattach` → `watches.set`），继续等它跑完；
    //     ⚠ 安全前提：它本来就在等同一件事，重挂**不制造假 watch**，
    //       且仍受 `dispatch` 的「同目标至多一条未结算」闸门约束。
    //   · 目标**已空闲** ⇒ 记 lost（档位 `'idle'`）+ 状态行给追回提示；
    //     ⚠ 机制上补不回来：那一刻的事件已经没了，只能靠人去那个会话看。
    //   · **判不出** ⇒ 记 lost（档位 `'unknown'`），⛔ 不猜"它在跑"。
    //
    // ⚠ `statusOf` 的读法 = `agents.get(target)?.status`：与本文件 `dispatch` 里
    //   读目标状态的**同一个函数**（`:742` 一带），⛔ 不另写一份。
    let lostLatch: PersistedWatch[] = []
    /** 本次**重挂**的（供日志与状态行读数）。 */
    let reattachedLatch: PersistedWatch[] = []
    /**
     * ⚠⚠ **别人的记录不进本代接手**（`I-5` 末段，本件的一道硬判据）。
     *
     * ── 改前是什么 ────────────────────────────────────────────────────
     *   `markLost(file, () => false, …)` 对**扫到的每一个文件**都跑 ⇒ 别人的 pending
     *   被**本代**判成丢失（还发丢失通知给**别人**的 watcher）——
     *   等于一条 Hob 去替别人回收账本，而它根本不知道那些活的归宿。
     *
     * ── 现在 ─────────────────────────────────────────────────────────
     *   **只有 `owner` 落在"本代可接管的集合"里的记录**才进 `markLost`。
     *   ⚠ 什么叫"本代可接管"：`owner` 是**本进程里真活着的会话**（`agents.get(owner)` 有实体）。
     *     判据来源与"重挂时读目标状态"**同一个函数**（`agents.get`），⛔ 不另写一份。
     *   ⚠ **无归属的记录**（旧文件缺 `owner`）⇒ **也算不进**：`I-1` 明令"⛔ 不许猜一个默认 owner"
     *     ⇒ 它们既不被判死、也不被重挂（⛔ 不许替一个不知道是谁的记录做决定）。
     *   ⚠ `markLost` 的**签名一个字未改**（`check:orch` 的 D4/F1/F3 锚在上面）——
     *     本函数只是把 `known` 谓词换成"**这条归我管吗**"，其余完全同款。
     */
    /**
     * ⚠⚠ **"这个 owner 是不是本代该管的"**（`I-5` 末段的唯一判据）。
     *
     * ⚠ 判据**必须落在盘上**、不能只问 `agents.get`：
     *   重载恰恰是"上一代的会话可能还没重新起来"的时刻 —— 只看 `agents.get`
     *   会把**本进程自己的**记录一律判成"别人的"（= 重挂与 lost 上报全瘫）。
     * ⇒ 两条任一成立就算"本代该管"：
     *   ① `agents.get(owner)` 有实体（它现在活着）；
     *   ② **`hob_spawn` 留下的绑定表**里出现这个 owner（`I-6`：归属跨重载可见）。
     * ⚠ 两条都**不含"猜"**：既不按工作区猜、也不按 watcher 猜。
     */
    const ownerIsLiveHere = (owner: string | undefined, file?: string): boolean => {
      if (owner === undefined || owner === '') return false
      try { if (agents.get?.(owner) !== undefined) return true } catch { /* 读不到就继续看盘 */ }
      if (file === undefined) return false
      try {
        // ② 绑定表里出现这个 owner（`I-6`：归属跨重载可见）⇒ 它是"有主的、本进程认得的"记录
        return readOrchState(file).sessions.some((b) => b.owner === owner)
      } catch { return false }
    }

    /**
     * ⚠⚠ **这条记录归不归本代管**（`I-5` 末段的判据，⚠ 三种取值都不许合并）。
     *
     * · **无归属**（`owner` 缺失：旧文件 / 旧帧）⇒ **仍归本代管**：
     *   ⚠ 必须保留这条旧路径 —— 否则**升级后第一次重启**会把盘上所有旧记录
     *     "既不重挂、也不报丢失"地静默抹掉，那正是本项目最忌讳的形态。
     *   ⚠ 但它们的回执**不会投给任何人**（`I-2`：owner 缺失 ⇒ 不投 + 可读一档）。
     * · **有 owner 且本进程认得它**（活着 / 有绑定）⇒ 归本代管。
     * · **有 owner 但本进程不认得** ⇒ **不碰**（那是别人的账，由它自己那一侧回收）。
     */
    /**
     * ⚠⚠ **本代"已经接管到的 owner 集合"**（`I-5` 的落盘口径给出的归属证明）。
     *
     * ⚠ 依据：`flushWatches` / `persistOwnerPartition` **只写属于该 `(账本, owner)` 的记录**，
     *   账本目录按工作区派生 ⇒ **出现在本账本文件里的 owner，就是本账本的 owner**。
     * ⚠ 这**不是**"按工作区猜归属"（`I-3` 禁止的那条）：
     *   本判据判的是"**这条记录该由本代处置吗**"，⚠ 它**完全没有回答"回执该投给谁"** ——
     *   投递仍只认 `w.owner`，且 owner 缺失仍然**不投**。
     * ⚠ 没有这一条会怎样（实测）：重启后 owner 会话还没起来、绑定表也还没写
     *   ⇒ 本代把它当"别人的记录"跳过 ⇒ **不重挂、不报丢失、不发通知**
     *   —— 那正是"该看到的东西静默消失"，比误判更坏。
     */
    const ownerSeenInThisLedger = new Set<string>()

    const adoptable = (w: PersistedWatch, file: string): boolean => {
      if (w.owner === undefined || w.owner === '') return true
      if (ownerIsLiveHere(w.owner, file)) return true
      // ⚠ 本账本里已经出现过这个 owner ⇒ 它是本账本的记录（不是别人的）
      if (ownerSeenInThisLedger.has(`${file}\u0000${w.owner}`)) return true
      /**
       * ⚠⚠ **本账本分区内的记录 ⇒ 本代该管**（`I-5` 的落盘口径自带归属证明）。
       *
       * ⚠ 依据：落盘**只写属于该 `(账本, owner)` 的记录**（`flushWatches` / `persistOwnerPartition`），
       *   而账本目录按**工作区名**派生 ⇒ **一条记录的 `wsRoot` 与它所在文件的账本根一致**，
       *   说明它就是**这本来账里的记录**。
       * ⚠ 这**不是**"按工作区猜 owner"（`I-3` 明令禁止的那条）：本判据判的是
       *   "**这条记录属不属于这本账**"，⚠ **完全没有回答"它归哪个会话"** ——
       *   归谁仍只由 `w.owner` 决定，缺 owner 仍然"不投"。
       * ⚠ 没有这一条会怎样（实测）：重启后 owner 会话**还没起来** / 绑定表还没写
       *   ⇒ 本代把它当"别人的记录"跳过 ⇒ **不重挂、不报丢失、也不发通知** ——
       *   那正是"该看到的东西静默消失"，比误判更坏。
       */
      if (w.wsRoot === undefined || w.wsRoot === '') return false
      return w.wsRoot === dirname(dirname(file))
    }

    /**
     * ⚠⚠ **本代接手时"哪些记录根本不归我碰"**（`I-5` 末段）——
     *   与 `markLost` 的 `known` **不是同一个概念**，⛔ 千万别混：
     *
     *   · `known(w)` 的语义是"**这一代是不是已经持有它**"（`orch-state.ts` 的原注释），
     *     接手那一刻 `watches` 必然为空 ⇒ 只能是 `() => false`（既有口径，⛔ 不许改）；
     *   · 本函数回答的是"**这条记录该不该由本代处置**"（别人的账不碰）。
     *
     * ⚠ 改前的写法把这两件事合成一个谓词 ⇒ 传 `adoptable` 当 `known`
     *   会让"无归属 / 别人的"记录被**原样留在 pending 里**，
     *   于是**既不重挂也不判丢失** —— 那正是"该看到的东西静默消失"的形态（实测踩过）。
     * ⇒ 现在：**先把不归我碰的记录摘出去**，剩下的照旧喂 `markLost(file, () => false, …)`。
     */
    const isForeign = (w: PersistedWatch, file: string): boolean => !adoptable(w, file)
    /**
     * ⚠⚠ **`known` 谓词的三种取值**（`I-5` 末段，⚠ 三条都不许合并）：
     *
     *   · `owner` **在本进程活着** ⇒ `known = false`（= "这一代要管"）
     *     ⇒ 进 `classifyPending`：仍在跑就重挂，否则按档位判 lost。
     *   · `owner` **有、但不活着** ⇒ `known = true`（= **不碰**）：
     *     ⚠ 那是**别人的**记录（别人的会话 / 别人的账本）⇒ ⛔ 不进我的 reattach、
     *       ⛔ 不进我的 lost 上报、⛔ 不发通知（它会由**它自己的**那一侧回收）。
     *   · **无归属**（旧文件缺字段）⇒ 也 `known = true`（**不碰**）：
     *     ⚠ `I-1` 明令"缺字段 ⇒ 读成无归属，⛔ 不许判坏、⛔ 不许猜一个默认 owner"
     *     ⇒ 判死它（写进 lost）等于替一个**不知道是谁**的记录做决定；重挂它又会造出
     *       一条**永远投不出去**的 watch（`I-2`：owner 缺失 ⇒ 不投）。
     *     ⇒ 只剩一条诚实的做法：**原样留在盘上**，由读数单列"无归属"那一档给人看。
     */
    /**
     * ⚠ **本代"我认得的" owner 集合**（`I-5`）：
     *   ① 落盘绑定表里出现过的 owner；
     *   ② 本进程里**真活着**的会话 id。
     * ⚠ 它**不含**"按工作区猜"那一档 —— 那正是越界成因。
     * ⚠ 无归属（`owner === undefined`）**永远不在这里** ⇒ 它的记录不判死、也不重挂。
     */
    const knownPredicate = (w: PersistedWatch, file: string): boolean => !adoptable(w, file)
    try {
      for (const file of scanStateFiles(svcCtx)) {
        /**
         * ⚠ **先把这个文件里出现过的 owner 记进"本账本认得"的集合**：
         *   判据 = **它就是住在这本账里的**（分区写法的直接推论），
         *   ⛔ 不是"按工作区猜 owner"（回执收件人始终只由 `w.owner` 决定）。
         */
        try {
          for (const b of readOrchState(file).sessions) {
            ownerSeenInThisLedger.add(`${file}\u0000${b.owner}`)
          }
          const st0 = readOrchState(file)
          for (const w of [...st0.pending, ...st0.lost]) {
            if (w.owner !== undefined && w.owner !== '') {
              ownerSeenInThisLedger.add(`${file}\u0000${w.owner}`)
            }
          }
        } catch { /* 读不到 ⇒ 只按活会话判（fail-closed） */ }
        /**
         * ⚠⚠ **`markLost` 之后只采用"归本代管"的那一部分**（`I-5` 末段）。
         *
         * ⚠ 为什么不在喂进 `markLost` 之前过滤：它只吃文件、没有"跳过某些记录"的参数，
         *   而它的**签名不许动**（`check:orch` 的 D4/F1/F3 锚在上面）。
         * ⚠ 而"先把别人的摘出去、再并回来"这种写法**实测踩过坑**：并回那一步会用旧快照
         *   盖掉 `markLost` 刚写好的 `pending`（**重挂记录被抹掉**，K-a 当场红）。
         * ⇒ 改成：**判据只作用在"我怎么采用它的结果"上** ——
         *   · 别人的记录（`isForeign`）⛔ 不进我的 `watches`（不重挂）、
         *     ⛔ 不进我的 lost 上报、⛔ 不发通知；
         *   · ⚠ 盘上它仍在 `pending`/`lost` —— 由**它自己那一侧**去回收。
         */
        const r = markLost(file, () => false, (target) => {
          try {
            const a = agents.get?.(target)
            if (a === undefined) return undefined          // 会话没了 ⇒ 判不出
            const st = a?.status
            if (st === 'running') return 'running'
            if (st === 'idle') return 'idle'
            return undefined                                // 别的状态一律判不出
          } catch {
            return undefined
          }
        })
        /**
         * ⚠⚠ **只在"怎么采用结果"上过滤**（`I-5` 末段）：
         *   `myReattach` / `myLost` 才是本代的；别人的记录⛔ 不进 `watches`、
         *   ⛔ 不进 lost 上报、⛔ 不发通知（它们在盘上原样留着，由它自己那一侧回收）。
         */
        const myReattach = r.reattach.filter((w) => !isForeign(w, file))
        const myLost = r.lost.filter((w) => !isForeign(w, file))
        const foreignCaught = (r.reattach.length - myReattach.length) + (r.lost.length - myLost.length)
        if (foreignCaught > 0) {
          /**
           * ⚠ **别人的记录也不许静默**（本项目"不静默"纪律）：留一行 info 说明
           *   "扫到了多少条、它们不归我"，便于人确认"不是丢了，是别人的"。
           */
          svcCtx.logger?.info?.(
            `[${name}] 扫到 ${foreignCaught} 条**属于别的 owner** 的派发记录（${file}）⇒`
            + ' **不重挂、不判丢失、不发通知**（由它自己那一侧回收）',
          )
        }
        // ── ① 仍在跑 ⇒ **必须重挂**（不是"可以不挂"）─────────────────────
        for (const w of myReattach) {
          /**
           * ⚠ 无归属的记录**照旧重挂**（保持升级后第一次重启的旧行为：仍在跑就继续等）：
           *   它的 owner 为空 ⇒ 到点时投不出去，会落"无归属 ⇒ 不投 + 可读一档"
           *   —— ⚠ 那比"静默不再等"诚实（`I-10`：漏投必须可见）。
           */
          watches.set(w.target, {
            target: w.target,
            watcher: w.watcher,
            ...(w.round === undefined ? {} : { round: w.round }),
            ...(w.task === undefined ? {} : { task: w.task }),
            at: w.at,
            sawRunning: w.sawRunning,
            reported: false,
            ...(w.error === undefined ? {} : { error: w.error }),
            /**
             * ⚠⚠ **重挂必须把 owner 带回来**（`I-1`）：丢了它，这一条在重载后就变成
             * "无归属" ⇒ 回执**投不出去**（`I-2`：owner 缺失 ⇒ 不投）。
             * ⚠ 若盘上那条本来就没有 owner ⇒ **保持无归属**（⛔ 不许猜一个补上）。
             */
            ...(w.owner === undefined ? {} : { owner: w.owner }),
            ...(w.wsRoot === undefined ? {} : { ownerWsRoot: w.wsRoot }),
            /**
             * ⚠⚠ **投递三件同款带回内存**（2026-10-20 · 第 4 单）：重挂的那条若上一代
             *   **已经送过回执**（`deliveredAt` 在盘上），这一代只该清账、⛔ 不该再发一份。
             */
            ...(w.deliveryAttemptAt === undefined ? {} : { deliveryAttemptAt: w.deliveryAttemptAt }),
            ...(w.deliveredAt === undefined ? {} : { deliveredAt: w.deliveredAt }),
            ...(w.cleanupFailedAt === undefined ? {} : { cleanupFailedAt: w.cleanupFailedAt }),
            /**
             * ── ⚠⚠ **修 W3**（2026-10-20 · `FINDINGS` P5 / `DESIGN` §4.2）──────────
             * 重挂时**必须**同时把"上一跳状态"记成 `running`。
             *
             * ⚠ **这不是猜**：`classifyPending` 只在 `statusOf === 'running'` 时才进
             *   `reattach`（`orch-state.ts`）—— "它**此刻**在跑"是**重挂判据的直接结论**。
             * ⚠ 不写会怎样（改前的形态）：重挂条目的 `lastStatus` 是 `undefined`
             *   ⇒ 它跑完那一次 `idle` 被 `if (before !== 'running') return` 丢掉
             *   ⇒ **重挂白挂**（回执永远不回来，`在等回传` 里永远挂着一条）。
             */
            lastStatus: 'running',
            /** 重挂的那条仍然是"在等"（⛔ 不是 `unresolved`：它此刻确实在跑）。 */
            settleState: 'waiting',
            ...(w.recheckCount === undefined ? {} : { recheckCount: w.recheckCount }),
            ...(w.lastRecheckAt === undefined ? {} : { lastRecheckAt: w.lastRecheckAt }),
          })
          /**
           * ── ⚠⚠ **修 W4**（同上）──────────────────────────────────────────────
           * 重挂时**必须**把这个条目的落点文件记下来。
           * ⚠ 不写会怎样（改前的形态）：结算成功后 `flushWatches` 因为
           *   `stateFileFor.get(target) === undefined` 而 `continue`
           *   ⇒ **盘上 pending 残留** ⇒ 下次重载又被判 lost（永久循环累积）。
           */
          stateFileFor.set(w.target, file)
          /**
           * ⚠ 重挂的那条**同时要留在内存的 lastStatus 里**（跨的是"这一代的事件"，
           *   而 `lastStatus` 是内存 Map）—— 上面写进 `Watch` 的是**落盘**那一份，
           *   两者必须一致，否则重挂之后第一跳 `idle` 仍然会被丢掉。
           */
          lastStatus.set(w.target, 'running')
          reattachedLatch = [...reattachedLatch, w]
        }
        if (myLost.length > 0) {
          lostLatch = [...lostLatch, ...myLost]
          svcCtx.logger?.warn?.(
            `[${name}] 重载后判定 ${myLost.length} 条未结算派发丢失（${file}）：`
            + myLost.map((w) => `${w.target}${w.round === undefined ? '' : `(第${w.round}轮)`}`
              + `[${w.lostClass ?? 'unknown'}]`).join(', '),
          )
        }
        /**
         * ── ⚠⚠ **"判不出"不再是终态**（2026-10-20 · B3；修 `FINDINGS` P2）────────
         *   `markLost` 现在把"判不出"的那一摞留在 `pending` 里（`settleState: 'unresolved'`），
         *   并回带 `unresolved` / `stuck` 两摞。
         *   ⚠ 这里**只上报、⛔ 不判死**：它们会由**任意一次后续触发**（T1..T5）再核一次。
         *   ⚠ ⛔ 不许在这里把它们挪进 `lost`（那正是改前的死胡同）；
         *   ⚠ ⛔ 也不许在这里"猜一个 owner"—— 重判读的是**目标状态**，不是收件人（`I-1`）。
         */
        const myUnresolved = r.unresolved.filter((w) => !isForeign(w, file))
        const myStuck = r.stuck.filter((w) => !isForeign(w, file))
        if (myUnresolved.length > 0) {
          svcCtx.logger?.info?.(
            `[${name}] 重载后 ${myUnresolved.length} 条**判不出目标状态** ⇒ 留在待办里再核（${file}）：`
            + myUnresolved.map((w) => `${w.target}@${w.at}(第${w.recheckCount ?? 1}次)`).join(', '),
          )
        }
        if (myStuck.length > 0) {
          svcCtx.logger?.warn?.(
            `[${name}] ${myStuck.length} 条重核 ${STUCK_AFTER_RECHECKS} 轮仍**判不出** ⇒ 转 stuck、`
            + `**不再自动重试**（${file}）：`
            + myStuck.map((w) => `${w.target}@${w.at}`).join(', '),
          )
        }
        if (myReattach.length > 0) {
          svcCtx.logger?.info?.(
            `[${name}] 重载后**重新挂上** ${myReattach.length} 条仍在跑的派发（${file}）：`
            + myReattach.map((w) => `${w.target}@${w.at}`).join(', '),
          )
        }
      }
    } catch (e) {
      svcCtx.logger?.warn?.(`[${name}] 读取运行态时出错：${String((e as Error)?.message ?? e)}`)
    }

    /**
     * **累计**丢失数（= 落盘 `lost` 的总量，不是"本代新发现"的条数）。
     *
     * ⚠ 为什么必须用累计值而不是 `lostLatch.length`（**实测过的一次回归**）：
     *   丢失项被挪进 `lost` 后就不在 `pending` 里了。第二、三代若没派过活，
     *   `pending` 恒空 ⇒ `markLost` 什么也发现不了 ⇒ 若报"本代新发现"，
     *   `hob_orch_status` 会在**第二次重载后**又变回"从来没派过"——
     *   正是本批要修的那个失败模式，只是晚了一代。
     *   ⇒ 报**盘上累计**（`lost`），它在 `writePending` 里被显式保留。
     *
     * ⚠ ⚠ **2026-10-18 第 2 轮**：除了总数，还要**按档位**分别统计 ——
     *   用户原话「两类**不许混成一个 lost 计数**」⇒ 状态行要分开报。
     *   分档实现点只有 `countLostByClass` 一处（⛔ 不在这里再写 filter）。
     */
    let lostCount = 0
    /** 按档位分开的累计（`running` / `idle` / `unknown`）。 */
    let lostByClass: Record<'running' | 'idle' | 'unknown', number> = { running: 0, idle: 0, unknown: 0 }
    /** 重新统计盘上累计丢失（启动时与每次落盘后各跑一次）。 */
    const refreshLostCount = (): void => {
      let total = 0
      const acc: Record<'running' | 'idle' | 'unknown', number> = { running: 0, idle: 0, unknown: 0 }
      try {
        for (const file of scanStateFiles(svcCtx)) {
          const s = readOrchState(file)
          total += s.lost.length
          const byClass = countLostByClass(s.lost)
          acc.running += byClass.running
          acc.idle += byClass.idle
          acc.unknown += byClass.unknown
        }
      } catch { /* 读不到就当 0；不因诊断用途让模块起不来 */ }
      lostCount = total
      lostByClass = acc
    }
    refreshLostCount()

    /**
     * **待投递**记录（2026-10-10 新增）—— 每次 `status()` 时**现读盘**。
     *
     * ⚠ 为什么**不缓存**而现读：记账发生在**另外两个模块**（工具层写文件、
     *   总线层建会话/投递），本模块收不到它们的事件 ⇒ 缓存必然滞后，
     *   而"滞后"的表现就是**刚写的交接文件不出现在待投递里**
     *   —— 那与本缺陷的失败**长得一样**，等于没修。
     *   读盘是几十字节的本地文件，`status()` 是低频调用，代价可忽略。
     *
     * ⚠ 读不到 ⇒ 空数组（不抛）：诊断用途不该让 status 崩掉（同 `readOrchState` 纪律）。
     */
    const readHandoffs = (): PersistedHandoff[] => {
      const out: PersistedHandoff[] = []
      try {
        for (const file of scanStateFiles(svcCtx)) out.push(...readOrchState(file).handoffs)
      } catch { /* 读不到就当空 */ }
      // 新的在前（最近的漏派最要紧）。
      return out.sort((a, b) => b.at - a.at)
    }

    /**
     * ⚠ ⚠ **本会话那一份账本的可达性**（2026-10-16 · 第 247 轮 · `TASK-R207`）。
     *
     * ⚠ **为什么不能复用 `readHandoffs()`**：它**跨工作区汇总**（扫 `ledgerHome` 下全部
     *   子目录）⇒ ⚠ ⚠ **只要有任何一个工作区的账本在，它就"读得到东西"** ——
     *   那会**掩盖**"本会话的账本够不到"这件事（⚠ 正是本单要治的形态）。
     *   ⇒ ⚠ 本函数按**调用方给的**工作区根**现算（⛔ 不从汇总结果反推）。
     *
     * ⚠ 判不出工作区根 / 账本解析为 `undefined` ⇒ `'unresolved'`
     *   （⚠ **这本身也是一种"够不到"** ⇒ 调用方**必须**把它当标记报出来，⛔ 不许静默当 `'ok'`）。
     */
    const reachabilityFor = (wsRoot: string | undefined): StateReachability | 'unresolved' | 'ledger-home-unresolved' => {
      try {
        if (typeof wsRoot !== 'string' || wsRoot === '') return 'unresolved'
        /**
         * ⚠⚠ **解析不到 `ledgerHome` 必须单独成档**（2026-10-21 · 第 326 轮 · **甲-7** 要求 1）——
         *
         * 改前这里直接把 `declaredLedgerHome()` 的空串喂给 `resolveLedgerRoot('', '', wsRoot)`
         * ⇒ 它在 `home === ''` 时**退回缺省的兄弟目录**（`doc-read.ts:108`，
         *   `resolve(dirname(ws), DEFAULT_LEDGER_DIR, base)`）⇒ 读的是**另一个位置**
         * ⇒ 落成 `'ledger-unreachable'`，与"这个工作区真的没有账本"**逐字相同**。
         * ⚠ 这正是甲-7 要求 1 点名的"三件事说成同一句"。
         * ⇒ 现在**先问诊断**：`kind !== 'ok'` ⇒ 直接落 `'ledger-home-unresolved'`
         *   （⚠ 它被渲染成**另一句话**，见 `reachabilityLines`）。
         */
        const diag = ledgerHomeDiag(svcCtx)
        if (diag.kind !== 'ok') return 'ledger-home-unresolved'
        const ledgerRoot = resolveLedgerRoot('', diag.home, wsRoot)
        if (ledgerRoot === undefined) return 'unresolved'
        return readOrchStateDetailed(orchStateFileOf(ledgerRoot)).reachability
      } catch {
        // ⚠ 判不出 ⇒ 如实报"未解析"（⛔ 不许回成 `'ok'` —— 那正是本单要治的盲区）
        return 'unresolved'
      }
    }

    // ── 尽力唤醒派活方（任务书 §2.1 第 2 条的"最好"档）──────────────────
    //   ⚠ 用 `hobBus` 投一条**说明自己丢了什么**的消息 —— 复用它的全部闸门
    //     （活会话校验、归档拒绝）。总线不在 ⇒ 不唤醒，但 `lostCount` 仍会
    //     经 `hob_orch_status` 报出（**至少不是静默**）。
    //   ⚠ 去重：同一 watcher 只唤醒一次（可能丢了多条给同一个人）；
    //     且**用 `followup`** —— 它是"叫醒一个活会话"，不是 `/steer` 打断。
    //   ⚠ 唤醒失败只记 debug：这不是主流程，别让它把模块启动搞挂。
    try {
      const bus = (() => { try { return svcCtx.get?.('hobBus') } catch { return undefined } })()
      /**
       * ⚠⚠ **丢失通知只发给"那条记录自己的 owner"**（`I-2` / `I-5` 末段）：
       *   · `owner` 缺失 ⇒ **不发**（⛔ 不许退化成"发给 watcher / 最后摸过状态的人"）；
       *   · `owner` 不是本进程里活着的会话 ⇒ 不发（那不是本代能唤醒的对象）。
       * ⚠ 改前这里按 `w.watcher` 分组 —— 而 `watcher` 与 owner 在旧数据里可能不一致，
       *   且别人的记录也会进来（见上面 `ownerIsLiveHere` 那一段）。
       */
      if (lostLatch.length > 0 && bus !== undefined && typeof bus.deliver === 'function') {
        const byWatcher = new Map<string, PersistedWatch[]>()
        for (const w of lostLatch) {
          const to = w.owner
          if (to === undefined || to === '') {
            svcCtx.logger?.warn?.(
              `[${name}] 丢失记录 ${w.target} **没有 owner** ⇒ 不发丢失通知`
              + '（I-2：⛔ 不许退化成"发给最后一个摸过状态的人"）',
            )
            continue
          }
          if (!ownerIsLiveHere(to)) continue
          const arr = byWatcher.get(to) ?? []
          arr.push(w)
          byWatcher.set(to, arr)
        }
        for (const [watcher, items] of byWatcher) {
          const body = [
            '【编排通知】宿主重载把"等回传"的记录抹掉了 —— 以下派发**已经不在等**。',
            '',
            ...items.map((w) => '- ' + [
              `目标会话：${w.target}`,
              ...(w.round === undefined ? [] : [`第 ${w.round} 轮`]),
              ...(w.task === undefined ? [] : [`你派的事：${w.task}`]),
              `派出时间：${new Date(w.at).toISOString()}`,
            ].join(' · ')),
            '',
            '⚠ 这不是回传，是**丢失通知**：对方的结果**不会**再自动送回来了',
            '（`running → idle` 是事件，重载前跑完的那次永不再来）。',
            '需要结果就**重新派一次**（`hob_dispatch`），或直接去那个会话看它的记录。',
            '`hob_orch_status` 也会报出这一条。',
          ].join('\n')
          Promise.resolve(bus.deliver(watcher, body, 'followup'))
            .then((res: any) => {
              if (!res?.ok) {
                svcCtx.logger?.debug?.(`[${name}] 丢失通知未能送达 ${watcher}：${res?.reason ?? 'unknown'}`)
              }
            })
            .catch((e: any) => {
              svcCtx.logger?.debug?.(`[${name}] 丢失通知出错 ${watcher}：${String(e?.message ?? e)}`)
            })
        }
      }
    } catch (e) {
      svcCtx.logger?.warn?.(`[${name}] 丢失通知发送失败：${String((e as Error)?.message ?? e)}`)
    }

    /**
     * 取某会话的**工作区根**（= 它的 `header.cwd`）。
     *
     * ⚠ 这就是 `modules/tools.ts` 的 `rootOf` 的同源读法
     *   （那边读 `exec.agent?.session.header.cwd`）。账本目录按**工作区名**派生
     *   （`resolveLedgerRoot`），所以必须拿到它才能判出落点。
     *   ⚠ 在**派发时**取（那时目标会话一定在），而不是在重载后取 ——
     *   重载后新代可能还没有任何目标会话可问。
     */
    const wsRootOfSession = (sessionId: string): string | undefined => {
      try {
        const s = sessions.get?.(sessionId)
        const cwd = s?.header?.cwd
        return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
      } catch {
        return undefined
      }
    }

    /**
     * 把当前活着的 watch 落盘（结算/清理后调用）。
     *
     * ⚠⚠ **只写属于该 `(账本, owner)` 的记录**（`I-5` 的核心判据）：
     *   ① **分区键** = `stateFileFor.get(target)`（该记录自己的落点）
     *      **+ `w.owner`**（该记录自己的归属）；
     *   ② ⛔ 不许把 `watches` 整个 Map 写进某一个文件（改前 `dispatch()` 里正是那么写的）；
     *   ③ ⛔ 不许给外来记录盖本工作区的 `wsRoot`（`wsRoot` 现在逐条来自 `ownerWsRoot`）。
     * ⚠ 同一文件下可能有**多个 owner** 的记录（同工作区里两个 Hob）——
     *   它们共享同一个账本文件是**既成事实**（账本按工作区名派生），
     *   但每条记录**自己带 owner**，读侧按 owner 过滤 ⇒ 读的人只看得到自己的。
     */
    const flushWatches = (): void => {
      /**
       * 按 `(文件, owner)` 分区：⚠ 键里**必须**含 owner —— 只按文件分会让同一工作区里
       * 两个 Hob 的记录互相覆盖（后写的那个把先写的抹掉）。
       */
      const groups = new Map<string, { file: string; owner: string; rows: PersistedWatch[] }>()
      for (const w of watches.values()) {
        const file = stateFileFor.get(w.target)
        if (file === undefined || file === '') continue
        const owner = w.owner ?? ''
        const key = `${file}\u0000${owner}`
        const g = groups.get(key) ?? { file, owner, rows: [] }
        g.rows.push(toPersisted(w))
        groups.set(key, g)
      }
      /**
       * ⚠ 还要处理"这个文件里已经没有我的记录了"的情形（全部结算完）——
       *   否则盘上会留着上一代的 pending，下次重载又被判成 lost（**虚报丢失**）。
       * ⇒ 对每个**曾经登记过落点**的文件，把所有它名下出现过的 owner 都覆盖一遍。
       */
      const ownersByFile = new Map<string, Set<string>>()
      for (const w of watches.values()) {
        const file = stateFileFor.get(w.target)
        if (file === undefined || file === '') continue
        if (w.owner === undefined || w.owner === '') continue
        const set = ownersByFile.get(file) ?? new Set<string>()
        set.add(w.owner)
        ownersByFile.set(file, set)
      }
      for (const [file, owners] of ownersByFile) {
        for (const owner of owners) {
          const key = `${file}\u0000${owner}`
          if (!groups.has(key)) groups.set(key, { file, owner, rows: [] })
        }
      }
      if (groups.size === 0) {
        // 一条带落点的记录都没有 ⇒ 仍要走一遍"清空自己名下"的老路径（保持既有行为）
        const files = new Set<string>()
        for (const v of stateFileFor.values()) if (v !== '') files.add(v)
        for (const file of files) {
          if (!persistWatches(file, [])) {
            svcCtx.logger?.warn?.(`[${name}] 运行态落盘失败（${file}）。`)
          }
        }
        refreshLostCount()
        return
      }
      for (const g of groups.values()) {
        /**
         * ⚠⚠ **合并而不是覆盖**：同一个文件里可能还有**别的 owner** 的 pending
         *   （同一工作区两个 Hob）—— ⛔ 不许把他们的记录写没了。
         *   判据：读回盘上现有的 pending，**只替换 owner 等于本条的那些**。
         */
        if (!persistOwnerPartition(g.file, g.owner, g.rows)) {
          svcCtx.logger?.warn?.(`[${name}] 运行态落盘失败（${g.file} · owner=${g.owner || '(无)'}）。`)
        }
      }
      refreshLostCount()
    }

    /**
     * 把**某一个 owner 名下的** pending 写回它自己的那一份（`I-5`）。
     *
     * ⚠ 与 `persistWatches` 的分工：
     *   · `persistWatches(file, pending)` —— **整文件覆盖**（既有行为，`check:orch` 的 D4 锚在上面，
     *     ⛔ 不动它的签名与它的调用点语义）；
     *   · 本函数 —— 只动"**owner 匹配的那些**"这一片，其余原样保留。
     * ⚠ 实现上**读回 → 只替换自己的 → 写回**，所以它必须自己调 `readOrchState` + `writePending`
     *   （⚠ 判据 D4 要的是"落盘前读回、且把 `prev.lost` 传下去"，本函数同款照做）。
     */
    const persistOwnerPartition = (
      file: string,
      owner: string,
      mine: PersistedWatch[],
    ): boolean => {
      try {
        const prev = readOrchState(file)
        /**
         * ⚠⚠ **按记录身份去重，⛔ 不按 owner 一刀切**（2026-10-20 · 修 **P1**）。
         *
         * ── 改前（本缺陷的现场成因，`FINDINGS` P1）──────────────────────────
         *   `const others = prev.pending.filter((w) => (w.owner ?? '') !== owner)`
         *   —— 它保留的是"**别人的**"，于是**同一个 owner 名下先前那条 pending
         *   不在 `next` 里** ⇒ **每派一条活就把上一条从盘上静默删掉**（连 `lost` 都不进）。
         *   现场：`57893e5d` 派完 `dd4c18eb` 之后从 `pending` 消失，且从未进 `lost`。
         *
         * ── 现在 ───────────────────────────────────────────────────────
         *   合并交给 `orch-state.ts` 的 `mergePendingByIdentity`（**唯一实现点**）：
         *   键 = `target@at`（与 `flushWatches` 那一侧同一个键），
         *   `mine` 里有的用 `mine`、其余的**原样留着**（不管属于谁、也不管有没有 owner）。
         *   ⚠ 无归属（`owner === undefined`）的记录当然也留着 —— 判不出归属 ≠ 归我。
         *   ⚠ **不引入"保留策略"**：两处写法不一致正是本病的成因，现在两边同构。
         */
        /** 我这一次真正"知道"的那些键（⛔ 不按 owner 一刀切，见上）。 */
        const mineKeys = new Set(mine.map((w) => watchKey(w)))
        /**
         * ⚠ **保留的两种**：
         *   ① **别人的**（`owner` 不匹配）—— 与改前同一条纪律（`I-5`：只写自己那一片）；
         *   ② **我自己名下但盘上才是权威的**（`unresolved` / `stuck`）——
         *      ⚠ 这两档是 `B3` 的**可重入态**：它们**只活在盘上**（内存里没有对应 watch），
         *      若按"我的那一片整体替换"处理，**下一次任何一次落盘都会把它们抹掉**
         *      ⇒ 「判不出」又变回终态，只是换了个位置。
         * ⚠ 而我名下那些**已经结算掉的** `waiting` 记录**必须被丢掉** ——
         *   那正是 `W4`（回传成功了盘上还留着 pending ⇒ 下次重载再判 lost）的修法。
         */
        const keepPrev = prev.pending.filter((w) => !mineKeys.has(watchKey(w))
          && ((w.owner ?? '') !== owner || w.settleState === 'unresolved' || w.settleState === 'stuck'))
        /**
         * ⚠⚠ **本代已经结算掉的键 ⇒ ⛔ 不许被 `keepPrev` 保留**（2026-10-20 · 第 6 单 · §1.2）──
         *
         * ── 这一刀治的到底是哪一格（⚠ 我第一版写错过，照实记下）────────────────
         *   第一版写的是"保留时**补上** `deliveredAt`"。⚠ **那是死代码**：
         *   `keepPrev` 上面那条 filter 已经排除了 `mineKeys`（= 本代 `mine` 里的键），
         *   而"补标记"要读的恰恰是 `mine` 里同键的那条 ⇒ **两条集合不相交**
         *   ⇒ 那个分支**一次都不可能命中**（实测：编造场景跑，改了等于没改）。
         *
         * ── 真正的缝 ──────────────────────────────────────────────────────────
         *   `finalizeDelivery()` **先把那条从 `watches` 删掉**，再落盘清账。
         *   ⇒ 等到这次 `flushWatches` 跑起来时，`mine` 里**已经没有它**了（`mineKeys` 也不含它），
         *     而盘上那条（若 `settleState` 是 `unresolved` / `stuck`）会被下面那条 filter **保留**
         *   ⇒ **结算成功了、盘上却还留着一条"从没送过"的记录** ⇒ 下一代复活 ⇒ **再发一份**。
         *
         * ── 判据（两句话）────────────────────────────────────────────────────
         *   · **本代已经投递成功过**（`deliveredAt` 有值）的那些键 ⇒ 盘上那条**必须丢掉**
         *     （它不是"判不出"，它是"已经办完了"）；
         *   · **从没结算过**的 `unresolved` / `stuck` ⇒ 照旧保留（B3 的可重入态，⛔ 不许删）。
         *   ⇒ 用一个**本代记账**的集合表达这件事：`finalizeDelivery` 成功/失败时都登记它，
         *     由 `flushWatches` 在合并前把盘上同键那条剔掉。
         *   ⚠ 为什么不用"给保留项补 `deliveredAt`"：那等于往盘上写一条**本代没投过**的记录，
         *     万一 `deliveredAt` 对不上同一次投递，就成了伪造证据。
         */
        const settledKeep = new Set<string>()
        for (const [k, v] of settledKeys) settledKeep.add(k)
        if (settledKeep.size > 0) {
          for (let i = keepPrev.length - 1; i >= 0; i--) {
            if (settledKeep.has(watchKey(keepPrev[i]))) keepPrev.splice(i, 1)
          }
        }
        /**
         * ⚠ 合并**必须**走 `mergePendingByIdentity`（`orch-state.ts` 的唯一实现点）：
         *   它与 `flushWatches` 那一侧用的是**同一个**判据（`target@at`），
         *   ⛔ 不许在这里再写一遍去重 —— 两处各写一份正是 P1 的成因。
         */
        const next = mergePendingByIdentity(keepPrev, mine)
        return writePending(file, next, prev.lost)
      } catch {
        return false
      }
    }

    /**
     * ⚠⚠ **"我的"这一份读数**（`I-4` 的唯一实现点）。
     *
     * ── 它治的缺陷（用户实测）────────────────────────────────────────────
     *   改前 `status()` 把**全实例汇总**原样返回：`watches` 是内存里全部的派发，
     *   `lostByClass` / `handoffs` 来自 `scanStateFiles()` 扫的**所有**工作区。
     *   实测：一条 Hob 会话看到 **9 条"在等回传"、watcher 分散在 6 个不同会话**
     *   （shoucang / prompt-enhancer-release / dsh-hob / customer-service-agent /
     *    project-nav / dsh-plugin-roundtable）—— 那是**别人的整本账**。
     *
     * ── 判据（⚠ 四条都按 owner 过滤，⛔ 一条都不许漏）──────────────────────
     *   ① `watches`（在等回传）；② `handoffs`（待投递）；③ `lost`（重载丢失，含按档拆开的三项）；
     *   ④ `relaysDone` / `relaysBlocked`（已回传 / 被拦下）。
     * ⚠ **行名与档位分法一个字不变**，只是**分母变成"我的"**（作业书 §2 `I-4` 末段）。
     *
     * ⚠ **无归属的记录（`owner === undefined`）不算给任何人**（`I-1`：⛔ 不许猜一个默认 owner）
     *   ⇒ 它们既不进"我的"，也不会被算成"别人的"（`othersOf` 同样排除），
     *     而是由渲染层**单列一档**"无归属"（判不出 ≠ 归我，也 ≠ 别人的）。
     */
    const mineOnly = (self: string | undefined): {
      watches: Watch[]
      handoffs: PersistedHandoff[]
      lostPending: number
      lostByClass: Record<LostClass, number>
      relaysDone: number
      relaysBlocked: number
      unownedWatches: number
      /** ⚠ **乙-10**：盘上有、内存里没有对应 watch 的未结算条数（正常档不出现）。 */
      unownedWatchesMemoryOnlyGap?: number
      settleByState: Record<SettleState, number>
    } => {
      const all = [...watches.values()]
      /**
       * ⚠⚠ **乙-10 的核心读数：盘上有、内存里没有对应 watch 的未结算记录数**。
       *   ⚠ **声明必须在 `self === undefined` 那条 return 之前** ——
       *     那一条也要带这个数（它描述"内存看不全"，与"我是谁"无关）。
       *   ⚠ **只读**：只 `readOrchState`，⛔ 不写盘；⛔ 不引入任何定时器
       *     （就在既有 `status()` 的取数里顺手算）。
       */
      let memoryOnlyGap = 0
      try {
        /** ⚠ 内存里已知的 target 集（= `watches` 的键；`D4` 保证同一 target 至多一条）。 */
        const memTargets = new Set<string>()
        for (const w of all) memTargets.add(w.target)
        for (const file of scanStateFiles(svcCtx)) {
          const st = readOrchState(file)
          /**
           * ⚠ 只看**未结算**那摞（`pending`）—— `lost` 是"已判丢失"的留档，
           *   不计入"在等回传"。
           */
          for (const pw of st.pending) {
            if (!memTargets.has(pw.target)) memoryOnlyGap++
          }
        }
      } catch { /* 盘读不到 ⇒ 缺口判不出 ⇒ 保持 0；⚠ 不许因此让 status() 抛 */ }
      if (self === undefined) {
        // ⚠ 判不出"我"是谁 ⇒ **只报无归属的那一部分**（⛔ 不许把全实例汇总当我的）
        return {
          watches: [],
          handoffs: [],
          lostPending: 0,
          lostByClass: { running: 0, idle: 0, unknown: 0 },
          relaysDone: 0,
          relaysBlocked: 0,
          unownedWatches: all.filter((w) => w.owner === undefined || w.owner === '').length,
          /** ⚠ 即使判不出"我"是谁，这条缺口读数**照样给**（它描述的是"内存看不全"，与我无关）。 */
          ...(memoryOnlyGap === 0 ? {} : { unownedWatchesMemoryOnlyGap: memoryOnlyGap }),
          /** ⚠ 判不出"我"是谁 ⇒ 三档一律 0，且渲染层**不许**把它们说成"没有"（B4 同款口径）。 */
          settleByState: { waiting: 0, unresolved: 0, stuck: 0 },
        }
      }
      const mineW = all.filter((w) => w.owner === self)
      /**
       * 盘上的两摞（handoffs / lost）**也按 owner 过滤**（`I-5` 的读侧）。
       * ⚠ 扫的还是那些文件（`scanStateFiles` 不动），但**只取属于我的记录**——
       *   别人的记录⛔ 不进我的读数（`I-4`）。
       */
      const handoffs: PersistedHandoff[] = []
      let lostTotal = 0
      const lostAcc: Record<LostClass, number> = { running: 0, idle: 0, unknown: 0 }
      /**
       * ⚠⚠ **乙-10（2026-10-21 · 第 332 轮）**：盘上有、而**内存里没有对应 watch** 的未结算记录。
       *
       * ── 为什么要数它 ──────────────────────────────────────────────────────
       *   `unownedWatches` 的取数面是 `[...watches.values()]`（**内存**）。
       *   ⇒ ⚠ 盘上那些 `unresolved` / `stuck` 的记录里，**内存里没有对应 `watch`** 的那一部分
       *     （重载后还没被认领 / 上一代留下的）**根本不在这摞里** ⇒ "无归属"那一档**会漏**。
       *   ⇒ 而读的人**看不出漏了**：`无归属：0 条` 与"我只看了内存、其实盘上还有"印成同一句。
       *
       * ── 判据：**怎么算"内存里没有对应 watch"** ────────────────────────────
       *   ⚠ 按 **`target`（目标会话 id）** 对：内存里存着 `watches`（以 target 为键）。
       *     盘上一条 pending 的 `target` **不在**那个键集里 ⇒ 它**没有**内存对应物。
       *   ⚠ 为什么不用 `(target, cardId)` 之类的更细的键：内存的 `watches` **就是按 target 建的**
       *     （`Map<string, Watch>`，`D4`「同一 target 至多一条未结算」是它的不变量）
       *     ⇒ 用 target 对**正好与那条不变量同源**，⛔ 不另立一套更细的键。
       *
       * ⚠ **只读**：这里只 `readOrchState`，⛔ 不写盘（`TASK` 要求 2：`status()` 不许改成写盘）。
       * ⚠ **不引入新定时器**：它就在既有的 `status()` 取数里算，零额外调度。
       */
      try {
        for (const file of scanStateFiles(svcCtx)) {
          const st = readOrchState(file)
          /**
           * ⚠⚠ **缺口数已经在上面算过一遍了**（`memoryOnlyGap`，在 `self === undefined`
           *   那条 return **之前**）—— ⛔ 这里**不许再数一次**，否则同一个文件被数两遍
           *   （实测：一条 pending 会印成 `2`）。
           *   ⚠ 两处必须共用**同一个** `memoryOnlyGap`（一次算、两处用，`E-160` 同族纪律）。
           */
          for (const h of st.handoffs) if (h.owner === self) handoffs.push(h)
          const mineLost = st.lost.filter((w) => w.owner === self)
          lostTotal += mineLost.length
          const byClass = countLostByClass(mineLost)
          lostAcc.running += byClass.running
          lostAcc.idle += byClass.idle
          lostAcc.unknown += byClass.unknown
        }
      } catch { /* 读不到就当 0；不因诊断用途让读数崩掉 */ }
      /**
       * ── ⚠⚠ **结算态三档（按 owner 过滤）**（B3）────────────────────────────
       *   ⚠ 它们**只活在盘上**（`unresolved` / `stuck` 在内存里没有对应 watch）
       *     ⇒ 必须从**盘**读，⛔ 不许从 `watches` 推。
       *   ⚠ `waiting` 那一档**只数盘上的**（内存里活着的那些另外有 `watches` 计数）——
       *     两处叠起来会让"在等回传"变成两个数，⛔ 不许。
       */
      let settleAcc: Record<SettleState, number> = { waiting: 0, unresolved: 0, stuck: 0 }
      try {
        for (const file of scanStateFiles(svcCtx)) {
          const owned = readOrchState(file).pending.filter((w) => w.owner === self)
          const byState = countBySettleState(owned)
          settleAcc.waiting += byState.waiting
          settleAcc.unresolved += byState.unresolved
          settleAcc.stuck += byState.stuck
        }
      } catch { /* 读不到就当 0；不因诊断用途让读数崩掉 */ }
      return {
        watches: mineW,
        handoffs: handoffs.sort((a, b) => b.at - a.at),
        lostPending: lostTotal,
        lostByClass: lostAcc,
        settleByState: settleAcc,
        /**
         * ⚠ `relaysDone` / `relaysBlocked` 是**累计计数器**（进程内），
         *   改前只有一个数 ⇒ 读的人以为"我回传了 N 次"。⇒ 现在按 owner 分档累计。
         */
        relaysDone: relaysByOwner.done.get(self) ?? 0,
        relaysBlocked: relaysByOwner.blocked.get(self) ?? 0,
        unownedWatches: all.filter((w) => w.owner === undefined || w.owner === '').length,
        /**
         * ⚠ **正常档不带这个字段**（`0` ⇒ 不出现）⇒ 渲染层一个字都不多，
         *   与改前**逐字相同**（`TASK` 要求 3）。
         */
        ...(memoryOnlyGap === 0 ? {} : { unownedWatchesMemoryOnlyGap: memoryOnlyGap }),
      }
    }

    /**
     * ⚠⚠ **别人的（只给条数、不给明细）**（`I-4` 的显式例外，作业书允许的唯一混法）。
     * ⚠ 无归属的记录**两边都不算**（既不是我的、也不是"别人的"）。
     */
    const othersOf = (self: string | undefined): { watches: Watch[] } => {
      const all = [...watches.values()]
      if (self === undefined) return { watches: [] }
      return { watches: all.filter((w) => w.owner !== undefined && w.owner !== '' && w.owner !== self) }
    }

    /**
     * **按 owner 分档的累计回传计数**（`I-4`：读数分母变成"我的"）。
     * ⚠ 与既有 `relaysDone` / `relaysBlocked` 两个数字**同源同义**，只是拆到各 owner 名下。
     */
    const relaysByOwner = {
      done: new Map<string, number>(),
      blocked: new Map<string, number>(),
    }
    const bumpRelay = (m: Map<string, number>, owner: string | undefined): void => {
      if (owner === undefined || owner === '') return
      m.set(owner, (m.get(owner) ?? 0) + 1)
    }

    const orch: HobOrchestrator = {
      version: 1,

      async dispatch(target, message, opts) {
        const self = opts?.self
        /**
         * ⚠ **闸门按调用方自己的 owner 判**（`I-4`）：
         *   改前是进程级 `stopped` ⇒ 别人一停我也停（跨工作区互相影响）。
         */
        if (isStoppedFor(typeof self === 'string' ? self : undefined)) {
          return {
            ok: false,
            reason: 'orchestration is stopped for this session; resume it first (hob_orch_control resume).'
              + ' ⚠ 只有**你自己**这一侧的闭环被停（别人的不受影响）。',
          }
        }
        if (typeof target !== 'string' || target === '') return { ok: false, reason: 'no-session-id' }
        // ⚠ 不接受"派给自己"：那既不构成闭环，也会把派活方自己刷起来。
        if (typeof self === 'string' && target === self) {
          return { ok: false, reason: 'refusing to dispatch to this session itself' }
        }
        if (typeof message !== 'string' || message.trim() === '') {
          return { ok: false, reason: 'empty message' }
        }
        // ── ⚠⚠ 同目标重复派发闸门（2026-10-09 修）──────────────────────────
        //   病灶：`watches` 以**目标会话 id** 为键（`watches.set(target, w)`）。
        //   同一会话在**上一轮尚未回传**时又被派一轮 ⇒ **后一轮直接覆盖前一轮的 watch**
        //   ⇒ 前一轮的 idle 事件结算的是**后一轮的 watch** ⇒ **回传永久丢失**
        //   （而且不是"丢一条"那么干净：产出会被贴上**后一轮的轮次/任务**，错配着送回来）。
        //
        //   为什么选「明确拒绝」而不是"键改唯一 + 逐个结算"：
        //   `agent/status` 事件只带 `{ agent: { id }, status }` —— **不带轮次**。
        //   两轮同时未结算时，一次 `running → idle` **无法区分**它是哪一轮结束；
        //   按 FIFO 逐个结算会在宿主把两轮并成一次运行时把第 1 轮的产出配到第 2 轮头上
        //   —— 把"丢失"换成"静默错配"，那是更坏的失败。
        //   拒绝则把不确定性交回派单方（它自己决定：等回传，还是换一个会话派）。
        //
        //   ⚠ 检查必须在**投递之前**：投出去了却不登记 watch ⇒ 那一轮的回传**必然丢**，
        //     比"拒绝"更糟（一个假成功 + 一个静默空洞）。
        //
        //   ⚠ 只拦**还在等**的那一份（`!reported`）。一个 `reported` 却带回传错误的 watch
        //     是**已尝试过、不会再回来**的残骸（回传时总线不可用等），把它也算作"未结算"
        //     会让该会话**永久不能再派** —— 那是另一个方向的坏掉。
        const pending = watches.get(target)
        if (pending !== undefined && !pending.reported) {
          return {
            ok: false,
            sessionId: target,
            reason: `session "${target}" already has an unsettled round (round ${pending.round ?? '?'}`
              + `${pending.task === undefined ? '' : `: ${pending.task}`}); its result has not come back yet. `
              + 'Wait for that relay (hob_orch_status shows it), or dispatch to a different live session.',
          }
        }
        if (pending !== undefined) {
          svcCtx.logger?.warn?.(
            `[${name}] 覆盖一条回传失败的残骸：${target}（${pending.error ?? 'unknown error'}）`,
          )
        }
        // 走会话总线投递（复用它的全部闸门：活会话校验、归档拒绝、落库确认）。
        // ⚠ 这里**不用 `ctx.get('hobBus')` 判空后再调** —— 总线缺席时应当**明确拒绝**，
        //   而不是"建了 watch 但永远送不出去"。
        const bus = (() => { try { return svcCtx.get?.('hobBus') } catch { return undefined } })()
        if (bus === undefined || typeof bus.deliver !== 'function') {
          return { ok: false, reason: 'session bus unavailable: cannot deliver the dispatch.' }
        }
        /**
         * ⚠⚠ **首派即绑定（甲案）**（`I-6` / 作业书 Q1）：
         *   目标是**无归属**的会话 ⇒ 这一派就把它绑给 `self`，此后**不再改绑**。
         *   已经是**别的** owner 的 ⇒ **拒绝派发**并点名占用者（`I-9`：⛔ 不许扇出、
         *   ⛔ 不许"多路都试一遍"）。
         *
         * ⚠ **判据顺序有意如此**：绑定判定**在投递之前** ——
         *   投出去却绑不上，就会出现"活派了、回执没有主人"（`I-10` 的漏投）。
         * ⚠ 无归属且**判不出 self** ⇒ 不绑（⛔ 不许猜一个 owner），但**不拦派发**
         *   （那是既有能力；只是这条活的回执将来会落"无归属 ⇒ 不投"那一档，如实可读）。
         */
        const selfId = typeof self === 'string' && self !== '' ? self : undefined
        if (selfId !== undefined) {
          const bindFile = runtimeFileOf(svcCtx, wsRootOfSession(selfId))
          if (bindFile !== undefined) {
            try {
              const b = bindSession(bindFile, {
                sessionId: target,
                owner: selfId,
                via: 'dispatch',
                ...(wsRootOfSession(selfId) === undefined ? {} : { ownerWsRoot: wsRootOfSession(selfId) as string }),
              })
              if (b.conflict !== undefined) {
                /**
                 * ⚠ **已经归别人 ⇒ 拒绝派发**（⛔ 不许改绑、⛔ 不许两边都投）。
                 * ⚠ 话术给到"会话 id + 被另一方占着"（Q2 的必须项）；
                 *   ⛔ **不给**对方派了什么 / 轮次 / task（那是别人的账）。
                 */
                return {
                  ok: false,
                  sessionId: target,
                  reason: `session "${target}" is already bound to another session (owner ${b.conflict.existing.owner}, `
                    + `bound via ${b.conflict.existing.via}) — it is occupied by another side. `
                    + 'A session belongs to exactly one dispatcher: dispatching here would send its receipts '
                    + 'to that other session, so this dispatch was NOT delivered. '
                    + 'Bind it back explicitly (it cannot be re-bound implicitly), or dispatch to a different session.',
                }
              }
            } catch (e) {
              svcCtx.logger?.warn?.(
                `[${name}] 首次派发绑定时出错：${String((e as Error)?.message ?? e)} ⇒ 本次派发照常，`
                + '但这条活的归属可能没记上（重载后会落"无归属"那一档）。',
              )
            }
          }
        }
        const r = await bus.deliver(target, message, opts?.mode === 'steer' ? 'steer' : 'followup')
        if (!r?.ok) return { ok: false, reason: r?.reason ?? 'delivery failed' }

        // 登记 watch（**投递成功之后**才登记 —— 没送出去就不该等回传）。
        const cur = (() => {
          try { const a = agents.get?.(target); return a?.status } catch { return undefined }
        })()
        /**
         * ⚠⚠ **owner = 派这一单的那个会话**（`I-1`）。它同时是一等公民：
         *   · 回执收件人（`watcher` 与它同源，但 `owner` 是**归属**、`watcher` 是**收件人**）；
         *   · 读数过滤的判据（`status()` / `control()` 只报 owner === 调用方的记录）；
         *   · 落盘分区的判据（`flushWatches` 按 `(文件, owner)` 分区）。
         * ⚠ `ownerWsRoot` = **owner 自己的工作区根**（⛔ 不是目标会话的）：
         *   它是"这条记录该落在哪本账"的依据，改前错用了**目标**的 cwd（`1.4` 病根）。
         */
        const owner = typeof self === 'string' && self !== '' ? self : undefined
        const ownerWsRoot = owner === undefined ? undefined : wsRootOfSession(owner)
        const w: Watch = {
          target,
          watcher: typeof self === 'string' ? self : '',
          ...(opts?.round === undefined ? {} : { round: opts.round }),
          ...(opts?.task === undefined ? {} : { task: opts.task }),
          at: Date.now(),
          // 投递时它若已在跑，直接算"见过 running"，否则等状态事件点亮。
          sawRunning: cur === 'running',
          reported: false,
          ...(owner === undefined ? {} : { owner }),
          ...(ownerWsRoot === undefined ? {} : { ownerWsRoot }),
        }
        watches.set(target, w)
        lastStatus.set(target, cur ?? 'unknown')
        svcCtx.logger?.debug?.(`[${name}] 已登记回传 watch：${target} → ${w.watcher}`)
        // ── 落盘（**本批新增**）：让"有未结算派发"这件事活过下一次重载 ──
        //   ⚠ 写失败必须留 warn：静默的"记不上账"正是本批要修的失败模式。
        try {
          /**
           * ⚠⚠ **落点按 owner 自己的工作区根算**（`I-5`）——
           *   改前用的是**目标**的 cwd，于是"我派的活"被记进了**对方**的账本目录。
           * ⚠ owner 判不出（没给 `self`）⇒ 退回目标的 cwd（**只为让这次派发可观测**，
           *   并照实记 warn）—— ⚠ 但那条记录的 `owner` 仍是空 ⇒ 读数侧**不会**把它算给任何人。
           */
          const ws = ownerWsRoot ?? wsRootOfSession(target)
          const file = runtimeFileOf(svcCtx, ws)
          stateFileFor.set(target, file ?? '')
          /**
           * ── ⚠⚠ **落点登记缺失 ⇒ 可读失败，⛔ 不许猜一个文件**（2026-10-20 第 2 单 · 收口①）──
           *
           * ⚠ 这是 `R1` §五-2 那条"`stateFile` 不落盘"的**行为面收口**：
           *   落点**只能**由 `stateFileFor` 现算；`stateFileFor` 里没有这一条时，
           *   `mineHere` 会算出**空**，于是 `persistOwnerPartition` 什么也不写
           *   ⇒ **这次派发静默地没有落盘**（而那正是本项目最忌的失败形态：
           *     "记不上账"与"没有账"长得一样）。
           * ⇒ 现在**先核对落点确实登记上了**，没有就**留一条 warn**（`落点登记缺失`），
           *   ⛔ 不去 `w.stateFile` 里取、⛔ 不去猜一个相邻文件。
           *   ⚠ 判据见 `check:orch` 的 **SB-1b**（摘掉落点登记 ⇒ 盘上不许出现该记录 + 必须有可读 warn）。
           */
          const located = stateFileFor.get(target)
          if (located !== file) {
            svcCtx.logger?.warn?.(
              `[${name}] 落点登记缺失（target=${target} · 算出的 file=${String(file)}`
              + ` · stateFileFor=${String(located)}）⇒ **本次派发不落盘**`
              + '（⛔ 不猜一个文件：重载后这次派发将不可观测）。',
            )
          } else if (file !== undefined) {
            /**
             * ⚠⚠ **读 `ensureRuntimeIgnored` 的返回值**（2026-10-21 · 第 329 轮 · **甲-9** 要求 1）——
             *   改前**丢了返回值**。它 `false` = `runtime/.gitignore` 没写成
             *   ⇒ ⚠ `runtime/` 会进账本 git 历史，而 `orch-watches.json` **含会话 id**。
             *   ⚠ 落点在这个分支里，是因为**只有真要写运行态时才需要忽略它**。
             * ⚠ ⛔ **不升级成拒绝落盘**（TASK 要求 3）：忽略失败不改变"这次派发能不能被观测"，
             *   只改变"它会不会被 git 收进历史" ⇒ 写照常，失败**点名**进日志与状态读数。
             */
            if (!ensureRuntimeIgnored(dirname(file))) {
              runtimeIgnoreNote = `\`${ORCH_STATE_IGNORE}\` 没写成（${dirname(file)}）`
                + ' ⇒ runtime/ 可能被账本 git 收进历史（该文件含会话 id）'
              svcCtx.logger?.warn?.(`[${name}] ${runtimeIgnoreNote}`)
            }
            /**
             * ⚠⚠ **只写属于 `(本文件, 本 owner)` 的那一片**（`I-5` 的核心）：
             *   改前是 `persistWatches(file, [...watches.values()].map(...))`
             *   —— **整张表**写进一个文件、还给每条盖上本次的 `wsRoot`
             *   ⇒ 跨工作区互相污染（`1.4` 病根）。
             *
             * ⚠⚠⚠ **这里传的不是"本次这一条"，而是"本 owner 在本文件里还活着的全部"**
             *   （2026-10-20 · 修 **P1** 的最后一处）。改前传的是 `[toPersisted(w)]`
             *   （**只含刚派出的这一条**）⇒ `persistOwnerPartition` 里"我的那一片"就只有它
             *   ⇒ **同一个 owner 先前那条被替换掉** ⇒ "每派一条活就丢上一条"。
             *   ⚠ 语义现在与 `flushWatches` **完全同构**（那一边本来就是"本 owner 全量"）——
             *     两处写法不一致正是本病的成因（`FINDINGS` P1 的原话）。
             *   ⚠ 圈定"属于本文件"用的仍是**逐条的 `stateFileFor`**（⛔ 不拿当前 ws 一刀切，
             *     否则跨工作区的记录会被错写进这一本账）。
             */
            const mineHere: PersistedWatch[] = []
            for (const mw of watches.values()) {
              if (stateFileFor.get(mw.target) !== file) continue
              if ((mw.owner ?? '') !== (owner ?? '')) continue
              mineHere.push(toPersisted(mw))
            }
            if (!persistOwnerPartition(file, owner ?? '', mineHere)) {
              svcCtx.logger?.warn?.(`[${name}] 运行态落盘失败（${file}）—— 重载后这次派发将不可观测。`)
            }
            // ── 清"待投递"（2026-10-10 新增）：这次投递成功 ⇒ 之前的欠账已还 ──
            //   ⚠ 匹配细则（见回报说明）：
            //     · `spawned-session`：**目标会话 id === ref**（它已被投过）；
            //     · `task-file`：**投递发生在其 `at` 之后**（`h.at <= w.at`）——
            //       不去猜"这条消息投的是哪个文件"（按文本匹配会误判），
            //       只问"这份文件写出之后，**有没有发生过一次投递**"。
            //   ⚠ 保守方向：宁可少清（多报一条待投递 = 多一句提示，无害），
            //     **不清错**（清错 = 把真漏派抹掉 = 本缺陷复现）。
            const cleared = clearHandoffs(file, (h) => {
              if (h.wsRoot !== undefined && ws !== undefined && h.wsRoot !== ws) return false
              if (h.kind === 'spawned-session') return h.ref === target
              return h.at <= w.at
            })
            if (cleared.cleared.length > 0) {
              svcCtx.logger?.debug?.(
                `[${name}] 已清 ${cleared.cleared.length} 条待投递记录（本次投递：${target}）`,
              )
            }
          } else {
            svcCtx.logger?.warn?.(`[${name}] 判不出运行态落点（工作区根未知）⇒ 本次派发不可观测。`)
          }
        } catch (e) {
          svcCtx.logger?.warn?.(`[${name}] 落盘时出错：${String((e as Error)?.message ?? e)}`)
        }
        return {
          ok: true,
          sessionId: target,
          ...(r.messageId === undefined ? {} : { messageId: r.messageId }),
          watching: w.watcher !== '',
          // ── 目标预设预警（第 129 轮）—— **透传服务层的判定**，⛔ 不重写措辞 ────
          //   ⚠ 编排器**自己不去读预设**：`deliver()` 已经读过了（那是服务层的活），
          //     在这里再读一次 = 同一事实两个来源 ⇒ 必然漂移（E-128 的口径）。
          ...(r.presetNotice === undefined ? {} : { presetNotice: r.presetNotice }),
        }
      },

      status(opts?: { wsRoot?: string; self?: string }) {
        const self = typeof opts?.self === 'string' && opts.self !== '' ? opts.self : undefined
        const mine = mineOnly(self)
        /**
         * ⚠ **一次算、两处用**（2026-10-21 · 第 326 轮 · **甲-7**）：
         *   `reachability` 的值与"要不要带成因"必须来自**同一个结果** ——
         *   ⛔ 不许在展开式里再调一次 `reachabilityFor`（两次各算会漂，
         *   而漂的正是"读数说的"与"读数凭的"这件事，`E-160` 同族）。
         */
        const reach = reachabilityFor(opts?.wsRoot)
        return {
          /**
           * ⚠ 停/未停**也是自己的那一份**（`I-4` 末条）：别人停了不该让我的读数显示"已停"。
           */
          stopped: isStoppedFor(self),
          // ⚠ **现读**每个在等目标的预设（不缓存、不回落到 `w` 上存一份）——
          //   见 `targetPresetOf` 的注释：这条读数的价值全在"此刻准不准"。
          // ⚠ ⚠ 2026-10-17 第 2 轮：读数改由 `hobBus.presetOf()` **单点**给出，
          //   且**来源标记一起透传**（`targetPresetSource`）—— 渲染层据此标「降级」。
          //   ⛔ 这里**不再**调 `sessions.get(...).header`：那正是本单要治的第二来源。
          watches: mine.watches
            .sort((a, b) => a.at - b.at)
            .map((w) => {
              const [preset, source] = targetPresetOf(w.target)
              return {
                ...w,
                ...(preset === undefined ? {} : { targetPreset: preset }),
                ...(preset === undefined || source === undefined ? {} : { targetPresetSource: source }),
              }
            }),
          relaysDone: mine.relaysDone,
          relaysBlocked: mine.relaysBlocked,
          lostPending: mine.lostPending,
          lostByClass: mine.lostByClass,
          // ── 结算态三档（B3）：`unresolved` 与 `stuck` **必须分开报**（⛔ 不许并进"在等"）──
          settleByState: mine.settleByState,
          stuckCount: mine.settleByState.stuck,
          // ⚠ 现读盘（不缓存）：记账在别的模块做，缓存会滞后 —— 见 `readHandoffs` 注释。
          handoffs: mine.handoffs,
          ...(runtimeIgnoreNote === undefined ? {} : { runtimeIgnoreNote }),
          // ⚠ ⚠ **可达性**（第 247 轮）：⚠ 它与 `handoffs` **同一次读**吗？
          //   ⛔ 不是 —— `handoffs` 现在按 owner 过滤（`I-4`），
          //   而可达性问的是"**本会话这一份**账本够不够得到"（那才是"够不到"的形态）。
          //   ⇒ 故它按**调用方给的工作区根**现算（⛔ 不从 `handoffs` 反推）。
          reachability: reach,
          ...(reach === 'ledger-home-unresolved' ? { ledgerHomeWhy: ledgerHomeDiag(svcCtx) } : {}),
          /**
           * ⚠⚠ **别人的条数（不可见明细）**（`I-4` 的显式例外）。
           *
           * 作业书允许"要混必须**单列**『他人的（不可见明细）』并明确标注"。
           * ⚠ 它**只给条数、不给任何明细**（不给 target / task / 轮次）——
           *   明细一旦出现，就等于把别人的账本又摊开了一次。
           * ⚠ 不给 `self` ⇒ 这个数**恒为 0**（判不出"我"是谁 ⇒ ⛔ 不许猜一个分母）。
           */
          others: {
            note: '他人的（不可见明细）—— 只给条数，不给 target / task / 轮次',
            watches: othersOf(self).watches.length,
          },
          // ⚠ 无归属**单列一档**（判不出 ≠ 归我，也 ≠ 别人的）
          unownedWatches: mine.unownedWatches,
          /**
           * ⚠ **乙-10**：正常档 `memoryOnlyGap === 0` ⇒ 字段不出现 ⇒ 渲染层**一个字都不多**
           *   （与改前逐字相同）。
           */
          ...(mine.unownedWatchesMemoryOnlyGap === undefined
            ? {}
            : { unownedWatchesMemoryOnlyGap: mine.unownedWatchesMemoryOnlyGap }),
        }
      },

      /**
       * 读卡进度（2026-10-18 · 用户报障：隔离卡跑完了、派单方还在等）。
       *
       * ⚠ **纯委派**给 `server/board-cards.ts` —— 判档、认字段、渲染的**唯一实现点**
       *   在那里；本处只负责把「宿主 `tools` 注册表」递进去。
       * ⚠ 取注册表的手法与 `svcCtx.get?.('hobBus')` 同款（**免 inject 现读**）：
       *   `tools` 是宿主平面服务，预设作用域也取得到；取不到 ⇒ 传 `undefined`
       *   ⇒ `readCards` 返回 `unavailable`（⛔ 不会静默成"没有卡"）。
       */
      async cardsOf(opts?: { selfSessionId?: string }): Promise<CardSnapshot> {
        let registry: any
        try { registry = svcCtx.get?.('tools') } catch { registry = undefined }
        // ⚠ `get(name, scope)` 的第二个参数是**观察作用域**；这里要给的是"宿主全局视角"
        //   （看板工具是插件作用域注册的，与哪个会话在看无关）⇒ 不传 scope。
        const getTool: GetTool | undefined = registry !== undefined && registry !== null
          && typeof registry.get === 'function'
          ? (name: string) => registry.get(name)
          : undefined
        // ── 本会话在哪个项目（= 卡归属的 workspaceId）──────────────────────────
        //   ⚠ 走 `hobBus.listWorkspaces(self)` 的 `self` 那一行 —— **同一事实只有一个来源**
        //     （`bus.ts` 的 `listWorkspaces` 已经是"会话 → 路径 → 工作区记录"的唯一实现）。
        //   ⚠ 判不出 ⇒ `workspaceId` 保持 undefined ⇒ **不过滤**（看全部），
        //     ⛔ 绝不猜一个 id 去过滤（那会**少报**卡，正是本轮要治的失败模式）。
        const workspaceId = await workspaceIdOfSession(opts?.selfSessionId)
        // ⚠ 读到卡面 ⇒ 顺手登记"这个会话在看本工作区的卡面"（= 订阅语义）。
        //   卡跑完时**叫醒谁**就靠这张表 —— 见 `wakeSubscribe` 的注释。
        if (typeof opts?.selfSessionId === 'string' && opts.selfSessionId !== '') {
          wsIdForWake = workspaceId
          /**
           * ⛔ **不再 `dispatchWake.setSelfSessionId(...)`**（2026-10-19 收单第一轮 · `I-2`）。
           *
           * 改前这一行把"回执该投给谁"写进一个**进程级单值**——而 `DispatchWake` 全进程共用
           * ⇒ **谁读一次状态/卡面，收件人就被刷成谁** ⇒ A 的派发回执投给 B 的 Hob
           * （本件病根 1.1，也是用户报的"回执跑到别的 Hob 预设"最直接的一条路）。
           * ⇒ 收件人现在是**每条登记记录自己的 `owner`**（见 `DispatchWake.register`）。
           */
          // ⚠⚠ **订阅表只用于诊断**（"还有没有人订阅" / "owner 在不在看这个面"）——
          //   它⛔ 不再是投递名单（`CardWake` 与 `DispatchWake` 两侧都已改判，见 `I-9`）。
          //   ⚠ 仍然要带上"这个会话自己的项目"：判不出就照原样传 undefined，
          //     ⛔ 不许拿进程级单值顶替（`wsIdForWake` 正是那个越界成因）。
          wake.subscribe(opts.selfSessionId, workspaceId)
          wake.startWakeIfNeeded()
        }
        const snap = await readCards({ workspaceId, getTool })
        /**
         * ⚠ ⚠ **把卡的执行会话登记进叫醒面**（2026-10-19 · `TASK-2` 的信号源落点）──
         *   ⚠ **谁算"我派出去的"**（作业书 §二-① 第一件，判据写死在这里）：
         *     ① 卡**在报**（`readCards` 已经按 `isReportable` 筛过）；
         *     ② 卡**属于本工作区**（与显示面同一个，`workspaceId` 相等）；
         *     ③ 卡有**执行会话 id**（`executionSessionId`）—— 读不到 ⇒ **不登记**
         *        （⇒ 那张卡永远不会因为"会话状态变化"叫醒我们，这是**判不出**，
         *          ⛔ 不是"没有卡在跑"）；
         *   ⛔ **不登记**：别的项目的卡、没有执行会话的卡、`executionSessionId` 为空的卡。
         *   ⚠ 登记是**幂等**的（`DispatchWake.register` 重复调用不重置 `sawRunning`/`reported`）
         *     ⇒ 每次读卡面都会重登一遍，但**不会**把已叫过的会话弄成"没叫过"。
         */
        /**
         * ⚠⚠ **准入只有三种来源（`I-3` 改判）** —— 旧判据(②)「卡属于本工作区」**已作废**：
         *
         *   改前：`卡属于本工作区 ⇒ 登记`。⚠ 那就是"**本工作区的卡一律算我的**"
         *   ⇒ 同一工作区里两个 Hob **互相串收**（用户点名的"包括同一个工作区"那一半），
         *   而且一条卡跑完会落到**好几个**会话手里（`I-9` 明令⛔ 禁止扇出）。
         *
         *   现在：只有下面**三种**能登记（缺一即不登记）：
         *     ① `c.createdBySessionId === self` —— 这张卡**是本调用方建的/派的**（最权威）；
         *     ② （`hob_spawn` 建的会话由 `via='dispatch'` 那条路登记，见 `dispatch()`）；
         *     ③ 本次会话**就是该卡执行会话的派发方**（`watches` 里那条 `watcher === self`）。
         *   ⛔ 判不出归属 ⇒ **不登记**，落「判不出归属」独立一档（`register()` 里那一段）。
         *   ⚠ 别的 owner 的卡⛔ 不进我的叫醒面 —— 它该由**它自己的**会话去登记。
         */
        for (const c of snap.cards) {
          if (typeof c.executionSessionId !== 'string' || c.executionSessionId === '') continue
          const self = opts?.selfSessionId
          const cardOwner = typeof c.createdBySessionId === 'string' && c.createdBySessionId !== ''
            ? c.createdBySessionId
            : undefined
          const owner = cardOwner ?? (() => {
            // 兜底②：本会话**派过**这个执行会话（watches 里 watcher === self）⇒ 归属仍是本会话
            const w = watches.get(c.executionSessionId as string)
            return w !== undefined && typeof self === 'string' && w.watcher === self ? self : undefined
          })()
          /**
           * ⚠ **准入门**：`owner` 必须存在，且**必须是本调用方** ——
           *   别人的卡⛔ 不登记（⛔ 不许"本工作区的卡一律算我的"）。
           */
          if (owner === undefined || typeof self !== 'string' || owner !== self) {
            dispatchWake.noteOwnerUnknown(
              c.id,
              c.executionSessionId,
              owner === undefined
                ? '这张卡没有记录建卡会话（`createdBy.sessionId` 读不到），本会话也没派过它的执行会话'
                : `这张卡的归属是 ${owner}（不是本会话）`,
              c.executionId,
            )
            continue
          }
          /**
           * ⚠⚠ **同款准入**（第 6 单 §1.3）：执行方就是派活方自己 ⇒ 不登记。
           *   理由与 `registerCardByPush` 那一处**逐字相同**（同一个缺陷的两条入口）。
           */
          if (c.executionSessionId === owner) {
            dispatchWake.noteOwnerUnknown(
              c.id,
              c.executionSessionId,
              '这张卡的**执行会话就是建卡会话本身**（`executionSessionId === createdBy.sessionId`）'
                + '⇒ 它自己跑完不是"某个被派出去的活跑完了"⇒ **不登记**（⛔ 不是"没有会话在跑"）',
              c.executionId,
            )
            continue
          }
          dispatchWake.register({
            sessionId: c.executionSessionId,
            via: 'taskboard-card',
            cardId: c.id,
            ...(c.executionId === undefined ? {} : { executionId: c.executionId }),
            owner,
            ...(wsRootOfSession(owner) === undefined ? {} : { ownerWsRoot: wsRootOfSession(owner) }),
          })
        }
        return snap
      },

      async wakeSubscribe(sessionId: string | undefined): Promise<void> {
        // 会话 id 是**订阅身份**；工作区在这里**现读一次**并记为叫醒面的过滤条件
        //   （⚠ 下次谁再订阅就再刷一次 ⇒ 工作区后建/搬走都能跟上）。
        if (typeof sessionId !== 'string' || sessionId === '') return
        const workspaceId = await workspaceIdOfSession(sessionId)
        wsIdForWake = workspaceId
        // ⚠⚠ **订阅时带上这个会话自己的项目**（`TASK-B6` S3-4）：
        //   投递侧按 `t.workspaceId === e.workspaceId` 逐个订阅者过滤 ⇒
        //   ⛔ 不传就等于"这个订阅者不属于任何项目" ⇒ 它一张卡都收不到（那是**静默失效**）。
        //   ⚠ 用**这次现读**的结果，⛔ 不另造进程级变量；判不出就传 `undefined`（投递侧落"不投"）。
        wake.subscribe(sessionId, workspaceId)
        wake.startWakeIfNeeded()
      },

      wakeState(): WakeState {
        return wake.snapshot()
      },

      /**
       * ⚠⚠ **显式补投**（`TASK-R2` 裁定 ③：挂 `hob_orch_control`，⛔ 不新增工具名）。
       *
       * ── 这一层只做两件事：**现读 owner** → **转交 `wake.redeliver`** ─────────
       *   `CardWake` 看的是"帧 + 订阅者"，它**读不到卡面** ⇒ 它无法自己知道
       *   "这条回执本该给谁"。`owner` = 该卡的 `createdBy.sessionId`，
       *   只能从**卡面**现读，而读卡面（`cardsOf`）归本模块。
       *
       * ⚠ ⚠ **三条语义一个字不动**（`TASK-R2` §二）：
       *   ① 收件人只由该记录自己的 `owner` 决定 ⇒ 判不出就**不投**（`refused`），
       *      ⛔ 不猜、⛔ 不改投"最后一个读过状态的人"、⛔ 不按工作区广播；
       *   ② ⛔ **不自动重投**、⛔ 不在失败路径加重试 —— 只有人能按到这里；
       *   ③ **幂等** `(executionId, to)` 与计数全在 `CardWake` 侧（本层不另记账）。
       *
       * ⚠ **判不出 owner 的两种情形必须分开说**（否则又是"两种原因一句话"）：
       *   · 读不到卡面（`unavailable` / `unreadable` / 卡没找到）⇒ **本层**给可读话并返回 `refused`；
       *   · 卡在、但没记 `createdBy.sessionId` ⇒ **转交下去**由 `CardWake` 落
       *     `legacyTargetCount` + 那句"判不出它该给谁"（那一档的语义正是"判不出 owner"）。
       */
      async redeliver(executionId: string, taskId: string | undefined) {
        const shown = taskId === undefined ? `执行 ${executionId}` : `卡 ${taskId}（执行 ${executionId}）`
        // ── ① 有 taskId 才能读卡面；没有 ⇒ 判不出 owner（⛔ 不猜）────────────────
        if (taskId === undefined || taskId === '') {
          return {
            kind: 'refused' as const,
            reason: `⚠ **补投不了**（${shown}）：**没有给卡 id** ⇒ 读不到这张卡的 \`createdBy.sessionId\` `
              + '⇒ 判不出该补给谁 ⇒ **这一份不补**（⛔ 不猜、⛔ 不改投别人）',
          }
        }
        // ── ② 现读卡面拿 owner（⚠ 读不到是"读不到"，⛔ 不是"没有 owner"）────────
        let owner: string | undefined
        try {
          const snap = await this.cardsOf({ selfSessionId: undefined })
          // ⚠ 可达性四档（`board-cards.ts:112-120`）：`ok` 有卡 / `no-cards` 读到了但确实没有卡
          //   ⇒ 只有这两档算"读到了"；`unavailable`（看板不在这里）/ `unreadable`（读了但失败）
          //   都是**读不到**，⛔ 不许当成"没有 owner"（那是两种不同的原因）。
          if (snap.reachability !== 'ok' && snap.reachability !== 'no-cards') {
            return {
              kind: 'refused' as const,
              reason: `⚠ **补投不了**（${shown}）：**读不到看板卡面**（${snap.reachability}`
                + `${typeof snap.detail === 'string' && snap.detail !== '' ? '：' + snap.detail : ''}）`
                + ' ⇒ 判不出这张卡该补给谁 ⇒ **这一份不补**；'
                + '⛔ 这是"读不到"，⛔ **不是**"这张卡没有 owner"，也⛔ 不是"已经补过了"',
            }
          }
          const row = snap.cards.find((c) => c.id === taskId)
          if (row === undefined) {
            return {
              kind: 'refused' as const,
              reason: `⚠ **补投不了**（${shown}）：看板里**找不到这张卡**`
                + '（已被清理 / 不在本工作区？）⇒ 判不出它该补给谁 ⇒ **这一份不补**；'
                + '⛔ 这是"卡没了"，⛔ **不是**"没有错投"',
            }
          }
          owner = row.createdBySessionId
        } catch (e) {
          return {
            kind: 'refused' as const,
            reason: `⚠ **补投不了**（${shown}）：现读卡面抛错 ⇒ 判不出该补给谁 ⇒ **这一份不补**；`
              + `⛔ 不是"已经补过了"（${String((e as Error)?.message ?? e)}）`,
          }
        }
        // ── ③ 转交 `CardWake`：owner 的判定、幂等、计数、可读话全在它那一侧 ──────
        //   ⚠ 传 `undefined` 它才会走"判不出 owner"那一支（⛔ 别在这里替它兜成空串逻辑）
        const r = await wake.redeliver(executionId, owner, taskId)
        return { ...r, ...(owner === undefined ? {} : { owner }) }
      },

      /**
       * ⚠⚠ **投递台账的只读面**（`TASK-R3`）：把"回执投给了谁 / 哪条可能投错"端出来。
       *
       * ⚠ **为什么要现读卡面**：`deliveredLedger()` 只记"给了谁"（`executionId → to`），
       *   ⛔ **不记"本该给谁"** ⇒ 光看它判不出哪条是错投的。
       *   "本该给谁"= 该卡的 `createdBy.sessionId`，只能从卡面现读。
       *
       * ⚠ ⚠ **三种"判不出"必须分开，⛔ 不许并进"没有错投"**：
       *   · 读不到卡面（`unavailable` / `unreadable`）⇒ 整块报"读不到"，`mismatch` 全 `undefined`；
       *   · 卡找不到 / 卡没记 `createdBy.sessionId` ⇒ 该条 `owner === undefined` ⇒ `mismatch` = `undefined`；
       *   · 读到了且 owner 有值 ⇒ 才能判 `mismatch: to !== owner`。
       *   ⇒ `mismatch === undefined` 的语义是**"判不出"**，⛔ 不是"没投错"。
       *
       * ⚠ **不泄露别人**：`wake` 是进程级单例，台账里可能有别的工作区的执行。
       *   ⇒ 只保留"能在**本工作区卡面**里找到那张卡"的条目
       *   （找不到卡 = 判不出归属 = 不属于本工作区，⛔ 不许显示）。
       */
      async deliveryLedger() {
        const ledger = wake.deliveredLedger()
        const snap = await this.cardsOf({ selfSessionId: undefined })
        /** 卡面读数 OK 才谈得上"判 mismatch"；否则整块只能是"判不出"。 */
        const readable = snap.reachability === 'ok' || snap.reachability === 'no-cards'
        const byId = new Map(snap.cards.map((c) => [c.id, c]))
        const entries: Array<{
          executionId: string
          to: string
          taskId?: string
          owner?: string
          mismatch: boolean | undefined
        }> = []
        for (const row of ledger) {
          /**
           * ⚠⚠ **键空间必须同源**（2026-10-20 · 第 321 轮 · `TASK-G` ③）。
           *
           * ── 改前是什么（本项目头号禁忌：**让失败不可观测**）─────────────────
           *   这里只比 `c.executionId === row.executionId`：
           *   · 台账键 = 叫醒面的**合成键**（帧上没有 `executions` ⇒
           *     `cardDoneEventsOf` 拼的 `<卡 id>@<outcome>@v<version>`）；
           *   · 卡面的 `executionId` = 看板**真 id**（`executions[].id`）；
           *   ⇒ **永远不相等** ⇒ `entries` 恒空 ⇒ 渲染成
           *     「目前**没有**投递记录（这一档是"确实是空的"）」
           *   ⇒ 补投（`redeliver`）**永远拿不到可用的执行 id**，入口按不到。
           *   ⚠ 那不是"没有错投"，是"**没去比**"装成"比过且为空"。
           *
           * ── 现在 ────────────────────────────────────────────────────────
           *   比 **`synthesizedExecutionId`**（卡面侧由 `card-wake.ts` 的**同一个**
           *   `synthesizedExecutionKey` 生成 ⇒ 键空间同源），并**保留**真 id 的比对作为
           *   第二条通路（历史台账里若曾按真 id 记过，仍然认得出来）。
           *   ⛔ **不许用"前缀匹配"**（`t-a` 是 `t-ab` 的前缀 ⇒ 会误配）。
           *   ⛔ 找不到就**不显示**（同改前）：那表示"不属于本工作区 / 卡已被清理"，
           *     ⛔ 不许把别人的执行显示出来，⛔ 也不许猜一张卡给它。
           */
          const card = snap.cards.find((c) => c.synthesizedExecutionId === row.executionId
            || c.executionId === row.executionId)
          if (card === undefined) continue
          const owner = card.createdBySessionId
          entries.push({
            executionId: row.executionId,
            to: row.to,
            taskId: card.id,
            ...(owner === undefined ? {} : { owner }),
            // ⚠ `undefined` = **判不出**（卡面读不到 / 卡没记 createdBy）—— ⛔ 不是"没投错"
            mismatch: readable && owner !== undefined ? row.to !== owner : undefined,
          })
        }
        return {
          entries,
          total: entries.length,
          reachability: snap.reachability,
          ...(snap.detail === undefined ? {} : { detail: snap.detail }),
        }
      },

      dispatchWakeState(self?: string): DispatchWakeState {
        /**
         * ⚠⚠ **必须把调用方身份传下去**（B4 / W6）：改前是 `dispatchWake.snapshot()`
         *   —— 无参 ⇒ 进程级合计 ⇒ 读的人看到的是**别人的**登记数与叫醒数。
         */
        const me = typeof self === 'string' && self !== '' ? self : undefined
        return dispatchWake.snapshot(me)
      },

      /**
       * ⚠⚠ **对外暴露的唯一对账入口**（B5）—— 实现就是上面那个 `reconcile()`，
       *   ⛔ 不另写一份（两处各写必然漂）。
       */
      async reconcile(trigger: string) {
        return reconcile(trigger)
      },

      control(action, opts?: { wsRoot?: string; self?: string }) {
        const self = typeof opts?.self === 'string' && opts.self !== '' ? opts.self : undefined
        if (self === undefined) {
          /**
           * ⚠ **判不出"我"是谁 ⇒ 拒绝执行 stop/resume**（`I-4`）。
           *   ⛔ 不许把它落成"停所有人" —— 那正是本件要治的形态（一个工作区 stop 停掉全部）。
           */
          svcCtx.logger?.warn?.(`[${name}] control(${action}) 的调用方身份判不出 ⇒ **未执行**（⛔ 不会停掉所有人）`)
        } else if (action === 'stop') {
          stoppedOwners.add(self)
          svcCtx.logger?.info?.(`[${name}] 已停（owner=${self}）：**只停这一侧**的回传与新派发`)
        } else if (action === 'resume') {
          stoppedOwners.delete(self)
          svcCtx.logger?.info?.(`[${name}] 已恢复（owner=${self}）：只恢复这一侧`)
        }
        const mine = mineOnly(self)
        /** ⚠ 同 `status()` 那条：一次算、两处用（甲-7）。 */
        const reach = reachabilityFor(opts?.wsRoot)
        return {
          stopped: isStoppedFor(self),
          watches: mine.watches.sort((a, b) => a.at - b.at),
          relaysDone: mine.relaysDone,
          relaysBlocked: mine.relaysBlocked,
          lostPending: mine.lostPending,
          lostByClass: mine.lostByClass,
          // ── 结算态三档（B3）：与 `status()` 同源同值 ──
          settleByState: mine.settleByState,
          stuckCount: mine.settleByState.stuck,
          // ⚠ 与 `status()` 同源同值（两处返回**同一个形状**，调用方不必分情况）。
          handoffs: mine.handoffs,
          ...(runtimeIgnoreNote === undefined ? {} : { runtimeIgnoreNote }),
          reachability: reach,
          ...(reach === 'ledger-home-unresolved' ? { ledgerHomeWhy: ledgerHomeDiag(svcCtx) } : {}),
          others: {
            note: '他人的（不可见明细）—— 只给条数，不给 target / task / 轮次',
            watches: othersOf(self).watches.length,
          },
        }
      },
    }

    // ══════════════════════════════════════════════════════════════════
    // **唯一结算点** `settle()` + 惰性对账 `reconcile()`（2026-10-20 · 本单 B1/B3/B5）
    // ══════════════════════════════════════════════════════════════════
    //
    // ⚠ ⚠ **本段是整个改造的地基**，改前有两处各写一份的结算逻辑
    //   （事件路径 `:2006-2051`、重挂路径 `:1035-1059`）⇒ 两处必然漂。
    //   现在：**事件路径 / 对账路径 / 重挂路径 / 补投路径都只调 `settle()`**。
    //
    // ⚠ ⚠ **`I-1` / `I-3` 不破（这一段必须留在代码里）**：
    //   `settle()` 与 `reconcile()` 读的是**目标此刻的状态**（`agents.get(target)?.status`
    //   / 看板卡终态 / 会话 log 末条），**⛔ 完全不是在回答"回执该投给谁"**。
    //   收件人**永远只由 `w.owner` 决定**；`owner` 缺失 ⇒ **照旧不投**，只落"无归属"那一档。
    //   ⇒ 下一个人若以为"重判 = 猜 owner"，请先读到这里：**目标状态与 owner 是两个不同字段**。

    /**
     * 一次对账的结果（⛔ 不给外部用，只供日志与自检读）。
     */
    interface ReconcileOutcome {
      /** 真的结算掉的（成功投递并落盘）。 */
      settled: string[]
      /** 判不出、留在 `pending` 里等下一轮的那一摞。 */
      unresolved: string[]
      /** 重核到顶（`stuck`）的那一摞。 */
      stuck: string[]
      /** 本次有没有真的改过账（= 有没有触发落盘）。⚠ 写放大守卫的判据。 */
      changed: boolean
    }

    /** 对账的代次（T5 的退避用它；⚠ 只增不清 —— 它是"这次武装排到第几档"）。 */
    let recheckRound = 0
    /** T5 已排的那个一次性定时器（⚠ 同一时刻**至多一个**；没有待办时这里恒为 undefined）。 */
    let recheckTimer: ReturnType<typeof setTimeout> | undefined
    /** 对账是否正在跑（防重入：结算里会落盘，落盘又会触发读状态）。 */
    let reconciling = false
    /**
     * ⚠⚠ **正在投递的那些 target**（2026-10-20 · 第 4 单）。
     *
     * ⚠ 存在的唯一理由：`settle()` 会先落 `deliveryAttemptAt`（先写后发），而
     *   "结果未知"这一档的判据是"有 attempt、没 delivered"。**本代正在投递中**的那一条
     *   也符合那个形状 ⇒ 若不加这一层，它会被自己的"结果未知"挡住（实测：回执 0 次）。
     * ⇒ 只有**不在投递中**（= attempt 是上一代留下的）才算结果未知。
     */
    const delivering = new Set<string>()
    /**
     * ⚠⚠ **本代已经结算过的键**（`watchKey` = `target@at`）—— 2026-10-20 · 第 6 单 · §1.2。
     *
     * ⚠ 存在的唯一理由：`finalizeDelivery()` **先把记录从 `watches` 删掉、再落盘清账**
     *   ⇒ 等 `flushWatches` 真正跑起来时，`mine` 里**已经没有它**了
     *   ⇒ 盘上那条若 `settleState` 是 `unresolved` / `stuck`（B3 的可重入态），
     *     会被 `keepPrev` **保留**下来 ⇒ **结算成功了、盘上却还留着一条"没送过"的记录**
     *   ⇒ 下一代复活成全新派发 ⇒ **再发一份**（`FINDINGS` §三·问 4 那条缝）。
     * ⇒ 这个集合就是那句"它办完了"的凭据：`flushWatches` 合并前把盘上同键那条剔掉。
     * ⚠ 只记**本代真的投递成功过**的那些；⛔ 从没结算过的 `unresolved` 照旧保留。
     * ⚠ 上限：它只活在这一代（进程内），⛔ 不落盘 —— 落盘的那份证据是 `deliveredAt` 本身。
     */
    const settledKeys = new Map<string, number>()

    /**
     * 取**目标此刻的状态**（⚠ 这是"判得出/判不出"的唯一判据来源，⛔ 不猜）。
     *
     * ⚠ 三档与 `TargetStatusOf` 同义：`'running'` / `'idle'` / `undefined`（判不出）。
     * ⚠ `agents.get` 在**重载后不可信**（新代可能还没装载那个会话）⇒ 它只是**旁证**；
     *   真正的判据优先级见 {@link probeTarget}。
     */
    const statusOfTarget = (target: string): 'running' | 'idle' | undefined => {
      try {
        const a = agents.get?.(target)
        if (a === undefined) return undefined
        const st = (a as any)?.status
        if (st === 'running') return 'running'
        if (st === 'idle') return 'idle'
        return undefined
      } catch {
        return undefined
      }
    }

    /**
     * 用**三条真相源**判"这个目标这一轮到底跑完了没有"（B3）。
     *
     * ⚠ ⚠ **判据顺序是有意义的**（`DESIGN` §4.1 的慢路径）：
     *   ① **看板卡终态**（最硬：跨进程、跨重载都还在）——
     *      卡进 `in_review` / `done` / `canceled` ⇒ 这一轮**确实结束了**；
     *   ② **会话 log 末条 `assistant/message`**（次硬）——
     *      有助手产出 ⇒ 它至少跑完过一轮（⚠ 与"它现在在不在跑"分开看）；
     *   ③ `agents.get(id).status`（**最弱**：重载后不可信）⇒ 只作旁证。
     *
     * @returns `'done'` = 有硬证据说明跑完了（带 `evidence`）；
     *   `'running'` = 还在跑；`undefined` = **判不出**（⛔ 不许当成"做完了"）。
     */
    const probeTarget = async (
      target: string,
      at: number,
    ): Promise<{ kind: 'done'; evidence: SettleEvidence } | { kind: 'running' } | undefined> => {
      const st = statusOfTarget(target)
      // ① 看板卡终态（**唯一一条跨重载仍然可靠的真相源**）
      try {
        const snap = await orch.cardsOf({ selfSessionId: undefined })
        if (snap.reachability === 'ok' || snap.reachability === 'no-cards') {
          const card = snap.cards.find((c) => c.executionSessionId === target)
          if (card !== undefined) {
            const ended = card.phase === 'awaiting-review'
              || card.status === 'in_review' || card.status === 'done' || card.status === 'canceled'
            /**
             * ── ⚠⚠ **`endedAt` 缺失 ⇒ 判不出，⛔ 不当成已结算**（2026-10-20 第 2 单 · 收口③）──
             *
             * ── 改前是什么（`R1` §4 未验证 4 自己标出来的退化）──────────────────
             *   `const endedAfter = card.endedAt === undefined ? true : card.endedAt >= at`
             *   —— 卡没给 `endedAt` 时**默认"就是这次结束的"** ⇒ 会把**上一轮**的结果
             *   当成本轮结果结算掉 ⇒ **把别人的产出当这次的产出回传**（错配，比丢更坏）。
             *
             * ── 现在 ─────────────────────────────────────────────────────────
             *   ① 有 `endedAt` ⇒ 仍按"**这次派发之后**结束的"判（`>= at`），判据不变；
             *   ② **没有 `endedAt`** ⇒ 这一档**判不出**：
             *      ⛔ 不返回 `done`（那是把不确定性说成结论）；
             *      ⛔ 也不返回 `running`（那会把它永远挂在"在跑"里）；
             *      ⇒ **返回 `undefined`** = 判不出 ⇒ 记录按 `unresolved` 留到下一轮再核
             *        （到顶转 `stuck`，由读数说"需人工裁"）。
             *   ⚠ 这是**保守口径**：宁可"再核一次 / 交人看"，也不"猜一个然后发错回执"。
             *     与 `classifyPending` 对 `undefined` 的处理**同一条纪律**（`I-1` 不猜）。
             */
            if (ended) {
              if (card.endedAt === undefined) {
                /**
                 * ⚠ 卡的**终态**已成立、但**结束时刻读不到** ⇒ 判不出"这是不是这一轮"。
                 *   ⇒ 落到最外层 `return undefined`（判不出），⛔ 不在这里返回 done/running。
                 *   ⚠ 但若它此刻**确实在跑**（`phase==='running'`），那仍然优先（见下）。
                 */
                if (card.phase === 'running') return { kind: 'running' }
                return undefined
              }
              if (card.endedAt >= at) return { kind: 'done', evidence: 'board' }
              /**
               * ⚠ `endedAt < at` ⇒ 这张卡是**派发之前**就结束的（上一轮的事）⇒
               *   不能当成本轮结果；但也不必判"判不出"——它此刻是否在跑由下一条判据看。
               */
            }
            if (card.phase === 'running') return { kind: 'running' }
          }
        }
      } catch { /* 读不到卡面 ⇒ 继续看下一条真相源（⛔ 不许当成"没跑完"） */ }
      // ② 会话 log 末条 `assistant/message`
      try {
        const session = sessions.get?.(target)
        if (session !== undefined && lastAssistantText(session) !== undefined) {
          /**
           * ⚠ log 有助手产出只说明"它跑完过一轮"，**不说明这一轮**就是刚派的那一轮。
           *   ⇒ 只把它当"跑完了"的**次硬**证据；⚠ 而 `status==='running'` 仍然优先
           *     （它此刻还在跑 ⇒ 这一轮没结束）。
           */
          if (st !== 'running') return { kind: 'done', evidence: 'session-log' }
        }
      } catch { /* 读不到会话 ⇒ 继续 */ }
      // ③ 最弱的一条：`agents.get(id).status`
      if (st === 'running') return { kind: 'running' }
      if (st === 'idle') {
        /**
         * ⚠ `idle` **只在"本代亲眼见过它 running"时才算数**（既有口径，⛔ 不放宽）：
         *   否则"目标一直是 idle"会被读成"它刚跑完"（那是改前的假叫醒形态）。
         *   而重挂条目**已经由重挂判据确证过"它当时在跑"**（`lastStatus: 'running'`）⇒ 算数。
         */
        const sawRun = watches.get(target)?.sawRunning === true
          || watches.get(target)?.lastStatus === 'running'
        if (sawRun) return { kind: 'done', evidence: 'agent-status' }
      }
      return undefined
    }

    /**
     * ⚠⚠ **清账（不是投递）的唯一落点**（2026-10-20 · 第 4 单）。
     *
     * ── 为什么必须与"投递"分开成两步 ─────────────────────────────────────
     *   改前"投递成功"与"该条离开 `pending`"挤在同一个 `try` 里，且**谁也没看写盘结果**：
     *   `watches.delete(id); flushWatches()` —— `flushWatches()` 的返回值是 `void`，
     *   而 `persistOwnerPartition` 写失败只落一条 warn。
     *   ⇒ 只要那一次写盘没成（ENOSPC / 被杀 / 权限），**盘上那条还在** ⇒
     *     下一轮对账再结算一次 ⇒ **同一份回执被再送一遍**（现场 4 次就是这么来的）。
     *   任务书的要求逐字是：「成功即 `reported` + 清盘上 `pending`；失败必须**当场可读**，
     *   ⛔ 不许留到下一轮重试 N 次」。⇒ 这一条就是那个"当场可读"。
     *
     * ── 三条语义（⚠ 一条都不许混）──────────────────────────────────────
     *   ① **成功 ⇒ 该条离开 `pending`（内存 + 盘上两处都查）** —— 返回 `true`；
     *   ② **写盘失败 ⇒ 留在盘上并带 `cleanupFailedAt`**，且**当场留一条 warn** ——
     *      下一轮对账看到 `deliveredAt` **只重试清账、⛔ 不重投**（见 `settle` 顶部）；
     *   ③ ⛔ 不在这里投递、⛔ 不改 `reported`（那是 `settle` 的活）。
     *
     * @param w - 已投递成功的那条（`deliveredAt` 必须已置）。
     * @param id - 目标会话 id（= `watches` 的键）。
     * @param why - 谁触发的清账（⚠ 只进日志，⛔ 不影响判据）。
     */
    const finalizeDelivery = (w: Watch, id: string, why: string): boolean => {
      /**
       * ⓪ **先记账**：这一条在本代**已经投递成功**（调用它的前提就是 `deliveredAt` 已置）
       *   ⇒ 盘上那条同键记录**不该再被"保留"**（它不是"判不出"，是"已经办完了"）。
       *   ⚠ 顺序必须在 `watches.delete` **之前**（之后就拿不到 `w.at` 了）。
       */
      settledKeys.set(watchKey(w), typeof w.deliveredAt === 'number' ? w.deliveredAt : Date.now())
      /** ① 先清内存 —— 这一步不会失败，也要先做（否则同一次事件会再走一遍 `settle`）。 */
      watches.delete(id)
      /**
       * ② 再清盘，并**核对它真的没了**。
       *   ⚠ 判据是**盘上那条记录本身**（`watchKey` = `target@at`），
       *     ⛔ 不是"写函数返回 true"就算数 —— 写成功但写的是别的内容同样等于没清。
       *   ⚠ 读不回来 ⇒ **判不出**（`unknown`），⛔ 不许当成"清掉了"。
       */
      flushWatches()
      const absent = ((): 'absent' | 'present' | 'unknown' => {
        try {
          const file = stateFileFor.get(id)
          if (file === undefined || file === '') return 'unknown'
          const rows = readOrchState(file).pending
          return rows.some((r) => watchKey(r) === watchKey(toPersisted(w))) ? 'present' : 'absent'
        } catch {
          return 'unknown'
        }
      })()
      if (absent === 'absent') {
        /** 盘上确实没有这一条 ⇒ 账清了（这是"成功"的唯一判据）。 */
        return true
      }
      /**
       * ③ **写盘失败 / 清账未确认** ⇒ 当场可读 + 留在盘上（带 `cleanupFailedAt`）。
       *   ⚠ 这条**必须**留下：下一轮对账靠它认出"已经送到过、只差清账"⇒ ⛔ 不重投。
       *   ⚠ 而"留在盘上"这一动作本身也走 `flushWatches` —— 它再失败也无所谓：
       *     盘上那条本来就在（这正是我们没清掉的那个状态）。
       */
      const stamp = Date.now()
      const retry: Watch = { ...w, target: id, reported: true, cleanupFailedAt: stamp }
      watches.set(id, retry)
      flushWatches()
      svcCtx.logger?.warn?.(
        `[${name}] **回执已投递成功，但账没清掉**（target=${id} · 触发=${why} · 盘上=${absent}）⇒`
        + ' 该条仍留在 pending（带 `cleanupFailedAt`）。'
        + ' ⚠ 下一轮对账**只重试清账、⛔ 不会重发回执**（所以不会重复送达）。'
        + ' ⛔ 这不是"没送到"：送到是真的，清账失败才是真的。',
      )
      return false
    }

    /**
     * ⚠⚠ **唯一的结算点**（B1）。事件路径 / 对账路径 / 重挂路径 / 补投路径**都只调它**。
     *
     * ── 为什么必须只有一个 ────────────────────────────────────────────────
     *   改前散在两处（事件 `:2006-2051`、重挂 `:1035-1059`）⇒ 一处改了另一处没改
     *   就是"两条路给出两个结果"，而本病的现场正是"重挂那条白挂"（W3/W4）。
     *
     * ── 四件事，缺一条就不算结算 ─────────────────────────────────────────
     *   ① **闸门在投递之前**（`stop` ⇒ `relaysBlocked++`、不投、⛔ 不删 watch）；
     *   ② **单次性**：`w.reported = true` 先写后发（同一个 `idle` 只唤醒一次）；
     *   ③ **投递**（`bus.deliver(w.watcher, receipt)`）—— 收件人**只来自 `w.watcher` / `w.owner`**；
     *   ④ **账变了才落盘**（⛔ 读了就写）—— 成功 ⇒ 该条离开 `pending`；失败 ⇒ 留 `error` 残骸。
     *
     * @param record - 要结算的那条（内存里的 watch）。
     * @param evidence - **凭哪条真相源结的账**（写进落盘记录，读数可解释）。
     * @returns `true` = 投递成功且该条已离开 `pending`。
     */
    const settle = async (record: Watch, evidence: SettleEvidence): Promise<boolean> => {
      const id = record.target
      if (record.reported) return false
      const w = watches.get(id) ?? record
      /**
       * ⚠⚠ **单次性的判据必须读"内存里那一条"**（2026-10-20 · 第 4 单）。
       *
       * ⚠ 现场机理（本单复现过）：**同一次 `running → idle`** 会先后叫到 `settle()` 两遍 ——
       *   ① 事件路径（`agent/status` 监听器，传的是内存里那个 `w`）；
       *   ② T3 对账（`reconcile()`，传的是**按盘上记录重建**的 `revived`，那是**另一个对象**）。
       *   改前只判 `record.reported` ⇒ 第 ② 条看的是 `revived.reported`（恒 `false`）
       *   ��� 绕过单次性 ⇒ **同一份回执投两次**。
       * ⚠ `w.reported` 在**任何 `await` 之前**就置上了（见下面 ② 那一步），
       *   所以这一条足以挡住"同一 tick 内的并发结算"，⛔ 不必引入锁。
       */
      if (w.reported) return false
      /**
       * ⚠⚠ **跨进程幂等：盘上已经"投过"的，⛔ 不再发第二份**（2026-10-20 · 第 4 单）。
       *
       * ⚠ 这一层为什么必须有：`reported` **只在内存**（`watches`）里 ⇒ 一重载就归零，
       *   而"投递成功"与"盘上 pending 清掉"之间有**窗口**（消息已进 inbox、盘还没写）
       *   ⇒ 在那个窗口里被杀/重载，下一代就会把**同一份回执再发一遍**。
       * ⇒ 盘上的 `deliveryAttemptAt`（投之前落）与 `deliveredAt`（投成功落）就是那一层：
       *   · 有 `deliveredAt` ⇒ **已经送到了**，只差清账 ⇒ 交给 `finalizeDelivery()` 清，
       *     ⛔ **绝不重发**；
       *   · 只有 `deliveryAttemptAt`（没 `deliveredAt`）⇒ **投递结果未知**（进程死在投递中途）
       *     ⇒ 同样⛔ **不自动重投**（那是"另一种空转"），落一条**可读**的档等人裁。
       */
      /**
       * ⚠ 判据读的是**内存里那一条**（`w`）而不是传进来的 `record`：
       *   `settle()` 会被同一份 `agent/status` 的**两个触发点**（事件 + T3 对账）
       *   在同一次状态变化里先后叫到；第一次已经把 `deliveredAt` 写在 `w` 上了，
       *   第二次如果只看 `record`（旧对象）就会**再投一份**（实测就是这么复现的）。
       */
      if (w.deliveredAt !== undefined) {
        w.reported = true
        return finalizeDelivery(w, id, 'already-delivered')
      }
      if (w.deliveryAttemptAt !== undefined) {
        /**
         * ⚠⚠ **只有盘上那一代留下的 attempt 才算"结果未知"**（2026-10-20 · 第 4 单）。
         *   本代自己刚落的 attempt 一定发生在 `await bus.deliver(...)` 的**前一刻**，
         *   若把它也当"结果未知"，同一次结算里紧接着的那一步就会被自己挡住
         *   （实测：`投递次数 = 0`，回执**永远发不出去** —— 比重复严重得多）。
         *   判据 = **本代是否正在投递**（`delivering.has(target)`）。
         */
        if (!delivering.has(id)) {
          w.reported = true
          w.error = 'delivery outcome unknown (attempt recorded before the process stopped): '
            + '**NOT re-sent automatically** — check that session, then re-dispatch if needed.'
          flushWatches()
          return false
        }
      }
      /**
       * ── ① 闸门在【回传之前】 ──
       *   用户选择了"不设上限、只能手动停" ⇒ 这里就是那个刹车的作用点。
       *   停了 ⇒ **不唤醒派活方**（循环当场断在这一环）。
       *   ⚠ **按该条记录自己的 owner 判**（`I-4`）：别人停了⛔ 不许拦下我的回传。
       */
      if (isStoppedFor(w.owner ?? (w.watcher === '' ? undefined : w.watcher))) {
        relaysBlocked++
        bumpRelay(relaysByOwner.blocked, w.owner ?? (w.watcher === '' ? undefined : w.watcher))
        return false
      }
      /** ⚠ 无收件人 ⇒ 不投（`I-2` 同款：缺 owner/watcher 时⛔ 不许猜一个）。 */
      if (w.watcher === '') {
        w.error = 'no recipient (watcher empty): receipt NOT delivered'
        flushWatches()
        return false
      }
      // ── ② 先标记再发（同一个 idle 只唤醒一次）──
      w.reported = true
      w.evidence = evidence
      /**
       * ⚠⚠ **"先写后发"的尝试标记必须落盘**（2026-10-20 · 第 4 单）：
       *   与 `CardWake.markDelivered` 同一条纪律 —— 标记**先落**、消息**后发**。
       *   ⇒ 进程死在这两步之间时，下一代替看到"有 attempt、无 delivered"
       *     ⇒ **认成"结果未知"**（⛔ 不重投），而不是当成"没投过"再发一份。
       */
      w.deliveryAttemptAt = Date.now()
      flushWatches()
      const session = (() => { try { return sessions.get?.(id) } catch { return undefined } })()
      const receipt = buildReceipt(w, session)
      const bus = (() => { try { return svcCtx.get?.('hobBus') } catch { return undefined } })()
      if (bus === undefined || typeof bus.deliver !== 'function') {
        w.error = 'session bus unavailable at relay time'
        flushWatches()
        return false
      }
      // ── ③ 投递（唯一一次，⛔ 没有循环扇出、⛔ 没有兜底改投）──
      /**
       * ⚠⚠ **回执必须走内部入口**（2026-10-20 · 第 4 单）：`deliverInternal` 与
       *   `deliver` **同一份实现**，只跳过"拒投给自己"那一道 —— 而回执的收件人
       *   `w.watcher` **本来就是派活方自己**。走 `deliver` 的后果是**T2 路径恒失败**
       *   （`callerId` 在派活方自己的作用域里恒等于 `w.watcher`）：
       *   `pending` 永远清不掉 ⇒ 同一份回执被一遍遍重发（现场 4 次）。
       *   ⚠ 模型面 `hob_send` 仍走 `deliver`（那道守卫对它照旧生效）。
       */
      const relayDeliver = typeof bus.deliverInternal === 'function'
        ? bus.deliverInternal.bind(bus)
        : bus.deliver.bind(bus)
      delivering.add(id)
      try {
        const res: any = await relayDeliver(w.watcher, receipt, 'followup')
        if (res?.ok) {
          relaysDone++
          bumpRelay(relaysByOwner.done, w.owner ?? (w.watcher === '' ? undefined : w.watcher))
          // ── ④ 成功 ⇒ 该条离开 `pending`（⛔ 不许只删内存不落盘 —— 那就是 W4）──
          /**
           * ⚠⚠ **先落 `deliveredAt` 再清账**（2026-10-20 · 第 4 单）。
           *   顺序有意义：若"清账"那一步失败（写盘错/被杀），盘上那条**带 `deliveredAt`**
           *   ⇒ 下一代对账认出"回执**已经送到过**"⇒ **只重试清账、⛔ 不重发**。
           *   反过来（先删再记）就会丢掉这个证据 ⇒ 回到"投了又投"。
           */
          w.deliveredAt = Date.now()
          flushWatches()
          if (finalizeDelivery(w, id, 'delivered')) return true
          /**
           * ⚠ 清账失败 ⇒ **当场可读**（`finalizeDelivery` 里已留 warn + `cleanupFailedAt`）。
           *   返回值仍是 `false`：**"账没清掉"就是没结算完**，⛔ 不许报成功。
           */
          return false
        }
        /**
         * ⚠⚠⚠ **`ok:false` 是"确定失败"，⛔ 不是"结果未知"**（2026-10-20 · 第 6 单 · Hob 裁定 **(A)**）──
         *
         * ── 现场（第 5 单取证，`FINDINGS` §一.3）──────────────────────────────
         *   宿主 05:35:00 启动 ⇒ **05:35:10** T1 就绪扫描先跑，那一刻 owner（Hob）的 agent
         *   **还没建** ⇒ `bus.deliver` 明确返回 `{ok:false, reason:'not a live session'}`
         *   ⇒ 但 `deliveryAttemptAt` **已经落盘**（先写后发，`:2614`）
         *   ⇒ 之后每一次对账都命中"有 attempt、无 delivered ⇒ 结果未知 ⇒ ⛔ 不重投"
         *   ⇒ **`已回传：0 次`**，而 `在等回传` 挂着那条**永不结算**。
         *   实测（`tmp/probe-poison.mjs`）：owner 变活后再触发 4 次 ⇒ **成功 0 次**。
         *
         * ── 判据（⚠ 四种状态，⛔ 不许合成一个字段）──────────────────────────────
         *   · 没试过（无 attempt）                        ⇒ 正常投
         *   · **试过、失败了（bus 明确 `ok:false`）⇒ 删掉 attempt + 留 `error`** ⇒ **允许重投**
         *   · 试过、不知道成没成（进程死在投递中途）        ⇒ 有 attempt 无 delivered ⇒ 不自动重投
         *   · 成功了（有 deliveredAt）                    ⇒ ⛔ 绝不再发，只补清账
         * ⇒ **这一支必须把 attempt 撤掉**：它撤销的是"我试过了但不知道结果"这个**错误陈述**，
         *   而 `error` 留着 —— 失败原因本身是可读事实，⛔ 不许一起删掉。
         *
         * ⚠ **同一个失败原因不重复覆盖**（2026-10-20 · 第 6 单 · Hob 裁定）：
         *   若上一轮已经因**同一原因**失败，`error` 内容不变 ⇒ 盘上那条**不该每轮都变**
         *   （变了就等于"账变了"，读的人分不清"它一直在失败"还是"它刚刚又失败了一次"）。
         *   ⇒ 只在**原因真的变了**时才改写。
         */
        delete w.deliveryAttemptAt
        const why = res?.reason ?? 'relay delivery failed'
        if (w.error !== why) w.error = why
      } catch (e: any) {
        /**
         * ⚠ **抛异常 = 结果未知**（不是"确定失败"）：投递库可能已经把消息送出去了才抛
         *   ⇒ ⛔ **不许在这里删 attempt**（删了就可能在下一轮重发一份）⇒ 保持现状、留可读 error。
         */
        w.error = String(e?.message ?? e)
      } finally {
        /** ⚠ 投递已结束（成功/失败都算）⇒ 之后那一格才叫"结果未知"。 */
        delivering.delete(id)
      }
      // ⚠ 失败 ⇒ 留 `error` 残骸，同样**如实落盘**（⛔ 不许静默丢掉）。
      flushWatches()
      return false
    }

    /**
     * ⚠⚠ **惰性对账**（B5 的唯一实现点）：把盘上 `pending` 的账对平一次。
     *
     * ── 触发点（每一处都只调本函数，⛔ 不各写一份）──────────────────────
     *   **T1** 插件就绪扫描（`apply()` 里那一次，保证型）
     *   **T2** 每次 `hob_*` 工具调用（`bus.ts` 的 `pokeReconcile`）
     *   **T3** 任意 `agent/status`（下面那个监听器）
     *   **T4** 看板 SSE 的 `hello` 帧（`CardWake` 的 `onHello`）
     *   **T5** 有条件的一次性复查（本函数末尾的 `armRecheck`）
     *
     * ── 写放大守卫 ────────────────────────────────────────────────────
     *   ⚠ **只在"账真的变了"时落盘**：结算成功 / 判不出升级 / 重核代数变化才算变。
     *   ⛔ 读了就写 —— 高频读路径（`hob_*`）会把它变成写风暴。
     *
     * @param trigger - 哪个触发点来的（⚠ 只为日志可读，⛔ 不影响判据）。
     */
    const reconcile = async (trigger: string): Promise<ReconcileOutcome> => {
      const out: ReconcileOutcome = { settled: [], unresolved: [], stuck: [], changed: false }
      if (reconciling) return out
      reconciling = true
      try {
        for (const file of scanStateFiles(svcCtx)) {
          const state = readOrchState(file)
          for (const rec of state.pending) {
            /**
             * ⚠ 只处理**本代该管**的（`I-5`：别人的账不碰）——
             *   判据复用既有 `adoptable`，⛔ 不另写一份。
             */
            if (isForeign(rec, file)) continue
            /**
             * ⚠⚠ **`stuck` 不参与自动重试**（B3 的上限）：
             *   它的语义就是"不再自动重试，需人工裁" ⇒ 对账**跳过**它
             *   （⛔ 不许"再看一眼"——那就等于无限重试，用户明确否掉的那档）。
             */
            if (rec.settleState === 'stuck') continue
            /**
             * ⚠⚠ **投递三件取"内存优先、盘上兜底"**（2026-10-20 · 第 4 单）——
             *   下面三条判据（已送到 / 结果未知 / 重建 watch）**全都用它**，⛔ 不许各读一份。
             *   ⚠ 为什么内存优先：**盘写失败正是"送到了但账没清"的那个现场** ——
             *     那一刻盘上没有 `deliveredAt`，只有内存里有 ⇒ 只看盘就会把
             *     "已经送过"读回成"没送过"⇒**再送一份**（实测：投递次数 1 → 2 → 3）。
             *   ⚠ 也不能只看内存：跨代之后内存是空的 ⇒ 盘上那份才是唯一证据。
             *   ⚠ 合并方向恒取"更保守的那一侧"：任一来源说"投过"，就按"投过"处理。
             */
            const memRec = watches.get(rec.target)
            const effAttemptAt = memRec?.deliveryAttemptAt ?? rec.deliveryAttemptAt
            const effDeliveredAt = memRec?.deliveredAt ?? rec.deliveredAt
            const effCleanupAt = memRec?.cleanupFailedAt ?? rec.cleanupFailedAt
            /**
             * ── ⚠⚠ **已经送到过 ⇒ 只清账，⛔ 绝不重发**（2026-10-20 · 第 4 单）──────
             *   判据 = 盘上的 `deliveredAt`（`settle()` 在**投递成功之后、清账之前**落的那个）。
             *   ⚠ 这一档为什么必须**排在"判目标状态"之前**：它跟目标此刻在不在跑**无关** ——
             *     回执**已经送出去了**，剩下的事只有"把盘上那条删掉"。
             *     排在后面就会因为目标仍 `running`（`probe.kind === 'running' ⇒ continue`）
             *     而永远清不掉 ⇒ 那就是"送到了、账没清"的另一种形态。
             *   ⚠ ⛔ 这里**不投递**（一条消息都不发）⇒ 同一条记录无论被触发多少次，
             *     投递次数**恒为 1**（那正是任务书要求的那条断言）。
             */
            if (typeof effDeliveredAt === 'number') {
              const pendingLive = watches.get(rec.target)
              const revivedDone: Watch = {
                ...(pendingLive ?? {
                  target: rec.target,
                  watcher: rec.watcher,
                  at: rec.at,
                  sawRunning: true,
                  reported: true,
                }),
                deliveredAt: effDeliveredAt,
                reported: true,
              }
              watches.set(rec.target, revivedDone)
              stateFileFor.set(rec.target, file)
              if (finalizeDelivery(revivedDone, rec.target, `cleanup-retry(${trigger})`)) {
                out.settled.push(rec.target)
              }
              out.changed = true
              continue
            }
            /**
             * ── ⚠⚠ **只有"试过、但不知道成没成" ⇒ 不自动重投，落一条可读档**（第 4 单）──
             *   `deliveryAttemptAt` 有、`deliveredAt` 没有 = 进程死在投递中途。
             *   ⛔ 不重投（那是另一种空转），但也⛔ 不许静默：落 `error` 让人一眼看见。
             */
            if (typeof effAttemptAt === 'number') {
              const liveTry = watches.get(rec.target)
              if (liveTry !== undefined) liveTry.reported = true
              const why = 'delivery outcome unknown (attempt recorded, no confirmation): '
                + '**NOT re-sent automatically** — check that session, then re-dispatch if needed.'
              if (rec.error !== why) {
                persistRecheck(file, { ...rec, error: why })
                out.changed = true
              }
              continue
            }
            /**
             * ⚠ 内存里还活着的 watch ⇒ 走事件路径结算（⛔ 不在这里抢着投，
             *   否则同一个 `idle` 会被投两次）。
             */
            const live = watches.get(rec.target)
            if (live !== undefined && !live.reported) {
              const p0 = await probeTarget(rec.target, rec.at)
              if (p0?.kind === 'done') {
                // ⚠ 落点文件必须记下来（修 W4）：重挂/对账两条路都要能结算得掉盘上那条。
                stateFileFor.set(rec.target, file)
                lastStatus.set(rec.target, 'running')
                live.sawRunning = true
                live.lastStatus = 'running'
                if (await settle(live, p0.evidence)) out.settled.push(rec.target)
                out.changed = true
              }
              continue
            }
            const probe = await probeTarget(rec.target, rec.at)
            if (probe?.kind === 'running') continue
            if (probe?.kind === 'done') {
              /**
               * ── 盘上有、内存没有 ⇒ **重建一条 watch 再走 settle()**（B1 的"唯一结算点"）──
               *   ⚠ ⛔ 这不是"造一个假 watch"：目标**确实跑完了**，而这条记录本来就还在等
               *     （`pending` 是唯一权威），所以它该结算。
               *   ⚠ 收件人**只来自** `rec.watcher` / `rec.owner` —— ⛔ 不猜、⛔ 不改投。
               */
              /**
               * ⚠⚠ **投递三件要取"内存优先、盘上兜底"**（2026-10-20 · 第 4 单）。
               *
               * ⚠ 为什么不能只读盘：`cleanupFailedAt` 那一条的**事实**（"回执已经送到了"）
               *   存在于**内存**里，而盘上写失败正是它留在盘上的原因
               *   ⇒ 只看盘就会把"已经送过"读回成"没送过" ⇒ **再送一份**
               *   （实测：写盘失败的那一格，投递次数从 1 变 2、再变 3）。
               * ⚠ 也不能只读内存：跨代之后内存是空的 ⇒ 盘上那份才是唯一证据。
               * ⇒ 两边取**先到的那个标记**（同一件事，取最保守的那个方向：认"已经投过"）。
               */
              const attemptAt = effAttemptAt
              const deliveredAt = effDeliveredAt
              const cleanupAt = effCleanupAt
              const revived: Watch = {
                target: rec.target,
                watcher: rec.watcher,
                ...(rec.round === undefined ? {} : { round: rec.round }),
                ...(rec.task === undefined ? {} : { task: rec.task }),
                at: rec.at,
                sawRunning: true,
                reported: false,
                ...(rec.error === undefined ? {} : { error: rec.error }),
                ...(rec.owner === undefined ? {} : { owner: rec.owner }),
                ...(rec.wsRoot === undefined ? {} : { ownerWsRoot: rec.wsRoot }),
                ...(attemptAt === undefined ? {} : { deliveryAttemptAt: attemptAt }),
                ...(deliveredAt === undefined ? {} : { deliveredAt }),
                ...(cleanupAt === undefined ? {} : { cleanupFailedAt: cleanupAt }),
                lastStatus: 'running',
                settleState: 'waiting',
              }
              watches.set(rec.target, revived)
              stateFileFor.set(rec.target, file)
              lastStatus.set(rec.target, 'running')
              if (await settle(revived, probe.evidence)) out.settled.push(rec.target)
              out.changed = true
              continue
            }
            /**
             * ── **判不出** ⇒ 记代数 + 落回盘上（可重入态，⛔ 不是终态）──────────
             *   ⚠ 代数已经由 `classifyPending`/`markLost` 那一侧维护；这里负责
             *     "**又核过一次**"这句话是真的（`lastRecheckAt` 每次更新）。
             */
            const nextCount = (rec.recheckCount ?? 0) + 1
            const atTop = nextCount >= STUCK_AFTER_RECHECKS
            const nextRec: PersistedWatch = {
              ...rec,
              settleState: atTop ? 'stuck' : 'unresolved',
              recheckCount: nextCount,
              lastRecheckAt: Date.now(),
            }
            if (atTop) out.stuck.push(rec.target)
            else out.unresolved.push(rec.target)
            // 只有**代数变化**才算"账变了"（⛔ 读了就写）
            persistRecheck(file, nextRec)
            out.changed = true
          }
        }
        if (out.changed) refreshLostCount()
        return out
      } catch (e) {
        svcCtx.logger?.warn?.(`[${name}] 对账出错（${trigger}）：${String((e as Error)?.message ?? e)}`)
        return out
      } finally {
        reconciling = false
        // ⚠ 每轮对账之后**重新评估要不要武装 T5**（清空 ⇒ 当场解除）。
        armRecheck()
      }
    }

    /**
     * 把"判不出"那一条的**代数**落回盘上（⚠ 只改这一条，⛔ 不重写整张表）。
     *
     * ⚠ 为什么要单独一个函数：`flushWatches` 写的是**内存里活着的** watch，
     *   而 `unresolved` 那几条**只在盘上** ⇒ 走不到那条路。
     * ⚠ 写失败必须留 warn（⛔ 不许静默：那会让"又核过"这句话变成假话）。
     */
    const persistRecheck = (file: string, rec: PersistedWatch): void => {
      try {
        const prev = readOrchState(file)
        const rows = prev.pending.map((w) => (watchKey(w) === watchKey(rec) ? rec : w))
        if (!writePending(file, rows, prev.lost)) {
          svcCtx.logger?.warn?.(`[${name}] 对账结果落盘失败（${file}）：${rec.target}`)
        }
      } catch (e) {
        svcCtx.logger?.warn?.(`[${name}] 对账结果落盘出错：${String((e as Error)?.message ?? e)}`)
      }
    }

    /**
     * ── ⚠⚠ **T5：有条件的一次性复查**（B5，⚠ 口径按用户裁定，逐条见下）──────
     *
     * ⚠ ⚠ **它到底是什么 / 不是什么**（用户明确否掉了"常驻定时器空转"）：
     *   · **不是周期轮询** —— **没有待办时不存在任何定时器**（武装条件见下）；
     *   · **不是无条件常转** —— 每一轮只排**一个**一次性 `setTimeout`（`unref`），跑完看账，
     *     账还没平才排下一次；
     *   · **必须有上限** —— 到 {@link STUCK_AFTER_RECHECKS} 轮记录升 `stuck`，
     *     读数里**明说"不再自动重试，需人工裁"**。
     * ⇒ **完全空闲时（没有在等回传的派发）本模块一个定时器都不存在。**
     *
     * ⚠ 解除条件 = **pending 清空 ⇒ 当场解除**（`clearRecheckTimer()`）。
     */
    const clearRecheckTimer = (): void => {
      if (recheckTimer === undefined) return
      try { clearTimeout(recheckTimer) } catch { /* 已触发/已清 */ }
      recheckTimer = undefined
      recheckRound = 0
    }

    const armRecheck = (): void => {
      /**
       * ⚠⚠ **武装判据**：只认"**盘上还有** `waiting` / `unresolved`"。
       *   ⚠ `stuck` **不算**（它已经放弃自动重试）⇒ 否则就是"为一个放弃了的记录永远转下去"。
       *   ⚠ 一个都没有 ⇒ **当场解除**（`recheckTimer` 归 undefined，`recheckRound` 归 0）。
       *
       * ══════════════════════════════════════════════════════════════════════
       * ⚠⚠⚠ **甲-7（2026-10-21 · 第 326 轮）："扫不到文件"这一个布尔里混着两件事**
       * ══════════════════════════════════════════════════════════════════════
       *
       * ── 改前的病灶（本文件最重的静默面，`PROJECT-SURVEY-3` §6.1 甲-7 原话）──────
       *   下面那个 IIFE 只看"**有没有扫到带待办的 state 文件**"。而 `scanStateFiles()`
       *   在 `declaredLedgerHome()` 返回 `''` 时**直接返回空数组** ——
       *   ⇒ 账本根**解析不到** 与 账本根**真的没有待办** 产出**同一个 `false`**
       *   ⇒ `nextRecheckDelay(false, …)` = `undefined` ⇒ `clearRecheckTimer()` **当场执行**
       *   ⇒ ⚠ **T5 定时复查被静默关闭**：派发的回执永不结算，**且没有任何周期性补偿**，
       *     运行期**一声不响**（装配期那条是 `logger.warn`，且只说一次）。
       *   ⚠ 最坏形态（多账本 / 深搜歧义布局）：`ledgerHome` 有多处、深搜取到**别的工作区**那份
       *     ⇒ 我的待办在**另一棵树**里 ⇒ 扫不到 ⇒ 定时器关掉 ⇒ 死等。
       *
       * ── 现在（TASK 要求 2：**二选一**，选「不静默关掉」，理由在下面）────────────
       *   **先诊断账本根**，再决定武装判据：
       *     · `diag.kind === 'ok'` ⇒ 照旧按"盘上还有没有待办"武装（⛔ 行为一字未改）；
       *     · `diag.kind !== 'ok'` ⇒ **强制武装**（`armed = true`）——
       *       ⚠ 语义是"**判不出该查哪里 ⇒ 按'还有待办'处理**"，即 **fail-open**。
       *
       * ── ⚠ 为什么选 fail-open（不静默关掉），而⛔ 不选"照旧关掉 + 加一行读数"────────
       *   ① **这一档的代价不对称**：关掉 ⇒ 回执**永久不结算**（用户看不到任何东西，
       *      且**没有任何机制会再来一次**）；开着 ⇒ 每轮只是**重试一次扫描**，
       *      而 `nextRecheckDelay` 是**有上限的退避表**（`RECHECK_BACKOFF_MS`，末项封顶）
       *      ⇒ **不会无界空转**，且 `unref` 保证不吊住宿主退出。
       *   ② **"加一行读数"救不了这一档**：读数是**人主动看**才生效的，
       *      而本缺陷的形态恰恰是"**没人知道要去看**" —— 用户看到的是"在等回传：0 个"，
       *      他**没有理由**去点开状态再读一行成因。⇒ 读数必须**配合**行为修正，⛔ 不能替代它。
       *   ③ ⚠ ⛔ **"空闲零定时器"纪律没有被破坏**：那条纪律的语义是
       *      「**确认没有待办时**，一个定时器都不许存在」（`check:orch` 的 SA-t 钉着它）。
       *      本档是"**判不出**有没有待办" —— ⛔ 它从来不是"确认没有"。
       *      ⚠ 判据侧已核：SA-t 的四档里，"空盘"那一档走的是 `diag.kind === 'ok'`（账本可读、
       *      pending 为空）⇒ **仍排 0 个定时器**，本条不碰它。
       *   ④ ⚠ **读数面同时补齐**（要求 1 / 3）：`hob_orch_status` 现在会印
       *      「**账本根解析不到**」+ 成因（恰好两行，见 `reachabilityLines`）——
       *      行为与读数**两侧都动**，⛔ 不是只改一边。
       */
      const homeDiag = ledgerHomeDiag(svcCtx)
      /**
       * ⚠ `armed` 的两个来源**必须各自可读**（⛔ 不许压成一个布尔后就说不出为什么）：
       *   · `armedByDisk` = 盘上真有待办（改前的唯一依据）；
       *   · `armedByDiag` = 账本根解析不到 ⇒ 判不出 ⇒ fail-open（本批新增）。
       *   ⚠ 只在**诊断异常**时才多读盘一次；正常档**多一次 `readdir` 都不做**。
       */
      let armedByDisk = false
      if (homeDiag.kind === 'ok') {
        try {
          for (const file of scanStateFiles(svcCtx)) {
            if (hasUnsettled(readOrchState(file).pending)) { armedByDisk = true; break }
          }
        } catch { /* 读不到 ⇒ 不武装（fail-closed：没有证据就不起定时器） */ }
      }
      const armedByDiag = homeDiag.kind !== 'ok'
      const armed = armedByDisk || armedByDiag
      const delay = nextRecheckDelay(armed, recheckRound)
      if (delay === undefined) { clearRecheckTimer(); return }
      if (recheckTimer !== undefined) return          // ⚠ 同一时刻至多一个
      recheckRound += 1
      const t = setTimeout(() => {
        recheckTimer = undefined
        void reconcile('t5-timer').catch(() => { /* reconcile 自己已接住 */ })
      }, delay)
      /**
       * ⚠ **`unref` 必须有**：宿主要能正常退出，⛔ 不许被本模块的复查定时器挂住。
       *   （与 `card-wake.ts` 的 `sleep` 同一条纪律。）
       */
      ;(t as any)?.unref?.()
      recheckTimer = t
    }

    void settle
    void armRecheck

    /**
     * ── ⚠⚠ **T1：插件就绪扫描（保证型）**（B5）──────────────────────────────
     *
     * ⚠ ⚠ **这是唯一"保证"型的触发点**：进程一起来就**必跑一次**（`apply()` 的 inject 回调里）。
     *   其余四个（T2 `hob_*` / T3 `agent/status` / T4 SSE `hello` / T5 复查）
     *   **都只是"大概率"** —— 用户口径与 `DESIGN` §4.4 明令：⛔ 不许把它们写成保证。
     *
     * ⚠ **不 await**：`apply()` 是同步装配路径，⛔ 不许被读盘/投递拖住。
     * ⚠ 它跑的正是**唯一**那个 `reconcile()`（⛔ 不另写一份就绪逻辑）。
     * ⚠ 就绪那一刻盘上的三种记录各有归宿（上面接手块已经处置了 `reattach` / `lost`）：
     *   · 仍在跑 ⇒ 已重挂，这里的对账会确认它还在跑（⛔ 不误结）；
     *   · 已空闲 / 判不出 ⇒ 由对账**再核一次**（判不出 ⇒ `unresolved`，不是终态）。
     */
    void reconcile('ready-scan').catch(() => { /* reconcile 自己已接住 */ })

    // ── 状态监听：识别 `running → idle` 跳变 ─────────────────────────────
    // ⚠ 用 `ctx.on` 挂在**本模块自己的 fiber** 上 ⇒ 模块卸载时监听自动拆除。
    ctx.on('agent/status', (payload: any) => {
      try {
        const id = payload?.agent?.id
        const status = payload?.status
        if (typeof id !== 'string' || typeof status !== 'string') return
        const before = lastStatus.get(id)
        lastStatus.set(id, status)
        /**
         * ⚠ ⚠ **实施会话叫醒面**（2026-10-19 · `TASK-2` · **主信号源**）──────────
         *   ⚠ 它与下面的 `watches` **是两张独立的表**：
         *     · `watches` = `hob_dispatch` 派出去的活（**含重挂恢复逻辑，一行未动**）；
         *     · `dispatchWake` = **看板卡的执行会话**（`hob_dispatch` 那条照旧走 watches）。
         *   ⚠ **为什么不能复用 `watches`**：`watches` 的语义是"我要等一个回传正文"，
         *     而卡执行会话**没有回传正文**（正文落在卡片上）—— 混进去会改变
         *     `在等回传` 的计数与重挂的行为（作业书 §三：⛔ 不碰重挂）。
         *   ⚠ `void`：叫醒是**副作用**，不应拖慢状态事件的处理。
         */
        void dispatchWake.observe(id, typeof status === 'string' ? status : undefined)
        const w = watches.get(id)
        if (w !== undefined && !w.reported) {
          if (status === 'running') {
            // 见过 running 才算"它真的开始跑了" —— 光看到 idle 不能当"跑完"。
            w.sawRunning = true
            w.lastStatus = 'running'
            return
          }
          if (status === 'idle' && w.sawRunning && before === 'running') {
            /**
             * ── ⚠⚠ **事件路径也走 `settle()`**（B1：唯一结算点）──────────────
             *   改前这里有一份**独立实现**（闸门 / reported / buildReceipt / deliver
             *   / flushWatches 各写一遍），与重挂路径那份必然漂 —— 而"重挂那条白挂"
             *   （W3）正是两处不一致的直接后果。
             *   ⇒ 现在只剩一处：`settle(w, 'event')`。
             */
            void settle(w, 'event')
          }
        }
        /**
         * ── **T3：任意 `agent/status` 顺手对账一次**（B5）──────────────
         *   ⚠ **不限目标**（用户口径逐字："任意 `agent/status`（不限目标）"）：
         *     整机任何会话的状态变化都说明"时间在走"，此时把盘上的账对平一次最便宜。
         *   ⚠ **不 await**：状态事件是热路径，⛔ 不许被读盘/投递拖住。
         *   ⚠ 它**只对账、不投递**（投递仍然只由 `settle()` 做，且只认 `w.owner/watcher`）。
         */
        void reconcile('agent-status').catch(() => { /* reconcile 自己已接住 */ })
      } catch (e) {
        svcCtx.logger?.warn?.(`[${name}] 状态监听出错：${String((e as Error)?.message ?? e)}`)
      }
    })

    // `provide` 是 effect：模块卸载/依赖消失 ⇒ 服务随之消失 ⇒ 预设行的工具自动拆除。
    svcCtx.effect?.(() => {
      svcCtx.provide?.(ORCH_SERVICE, orch)
      return () => { /* provide 自己管清理 */ }
    }, `${name}: provide ${ORCH_SERVICE}`)
    svcCtx.logger?.debug?.(`[${name}] 已提供 ${ORCH_SERVICE}`)
  })
}

// ══════════════════════════════════════════════════════════════════════
// 编排工具 —— **定义**在本模块，**注册**在 `src/preset/tools.ts`（预设作用域）。
//   同 M3 的纪律：绝不在插件作用域注册（会漏进每一个预设）。
// ══════════════════════════════════════════════════════════════════════

/**
 * ⚠ ⚠ **"够不到账本"的可读标记行**（2026-10-16 · 第 247 轮 · `TASK-R207`）。
 *
 * ⚠ **只在"够不到"时返回行**（⛔ `'ok'` 与 `'no-records-yet'` 都返回**空数组**）：
 *   · `'ok'`                 ⇒ 读到东西了，无话可说；
 *   · `'no-records-yet'`     ⇒ ⚠ **这是真实状态**（"从来没派过"）⇒ ⛔ **不许加标记**
 *                             （⚠ 作业书 §3(a)：改了它就是**把一类假信号换成另一类**）；
 *   · `'ledger-unreachable'` ⇒ **账本目录不存在** ⇒ ⚠ **这才是"够不到"** ⇒ 给标记；
 *   · `'unreadable'`         ⇒ 文件在但读不了 / JSON 坏 ⇒ 给标记；
 *   · `'unresolved'`         ⇒ 连该查哪个账本都判不出 ⇒ 给标记。
 *
 * ⚠ ⚠ **措辞里必须说清"这不等于 0"** —— 那正是本单要治的误解
 *   （读者看到 `在等回传：0 个` 会以为"没事"，而真相是"**看不到**"）。
 */
function reachabilityLines(r: OrchStatus['reachability'], homeWhy?: LedgerHomeDiag): string[] {
  if (r === 'ok' || r === 'no-records-yet') return []
  /**
   * ⚠⚠ **第 ④ 档：账本根压根没解析出来**（2026-10-21 · 第 326 轮 · **甲-7** 要求 1 / 3）——
   *
   * ⚠ **为什么必须与 `ledger-unreachable` 分开印**：改前两者印的是**同一句**
   *   （"**账本目录不存在** —— 按工作区名解析出的那个路径上没有东西"），
   *   而它们的**修法完全不同**：
   *     · `ledger-unreachable` ⇒ 这个工作区**真的没有**账本（还没派过 / 换机器了）；
   *     · `ledger-home-unresolved` ⇒ **配置面**没给出 `ledgerHome`（或 loader 读不了）
   *       ⇒ ⚠ 去查预设行 / loader，⛔ 不是去建账本目录 —— 建了也用不上。
   *   ⚠ 这两件事说成一句话，正是甲-7 点名的"三件事说成同一句"。
   *
   * ── 要求 3：**最多两行，且只在异常档出现**（正常档一个字都不多加）───────────
   *   本档固定**恰好两行**（标题行 + 成因行）。⚠ ⛔ 不许再加第三行 ——
   *   状态行是逐轮要读的，多一行就挤压上下文（TASK 明令）。
   */
  if (r === 'ledger-home-unresolved') {
    const reason = homeWhy?.reason ?? '（诊断不可用）'
    return [
      '⚠⚠ 账本可达性：**账本根解析不到** —— 连"该查哪个账本"都不知道 ⇒ ⚠ **上面那些 0 是"看不到"，不是"没有"**',
      `  ↳ 成因（${homeWhy?.kind ?? 'unknown'}）：${reason}`
      + ' ⇒ ⚠ 去查**预设行的 `ledgerHome`** / loader 装配，⛔ 不是去建账本目录（建了也用不上）',
    ]
  }
  const why = r === 'ledger-unreachable'
    ? '**账本目录不存在**（按工作区名解析出的那个路径上没有东西）'
    : r === 'unreadable'
      ? '**运行态文件在、但读不了**（读失败或内容不是合法 JSON）'
      : '**连该查哪个账本都判不出**（工作区根或账本路径解析不出来）'
  return [
    `⚠⚠ 账本可达性：**够不到** —— ${why}`,
    '  ↳ ⚠ ⚠ **上面那些 0 不是"没有"，而是"看不到"** —— '
    + '⛔ 不许把它们当作"从来没派过 / 没有待投递"来读。',
    '  ↳ ⚠ 这多半说明**当前解析到的账本位置不是本工作区的那一份**'
    + '（账本按工作区名解析到工作区之外；换机器 / 换目录名就会落到别处）。',
  ]
}

/** 取本会话 id（= 调工具的 agent 自己）。 */
function selfSessionIdOf(exec: any): string | undefined {
  const id = exec?.agent?.id ?? exec?.agent?.session?.id
  return typeof id === 'string' && id !== '' ? id : undefined
}

/**
 * ⚠ **本会话自己的工作区根**（2026-10-16 · 第 247 轮 · `TASK-R207` 新增）。
 *
 * ⚠ 取法与 `modules/tools.ts` 的 `rootOf` **同源**（`exec.agent?.session.header.cwd`）——
 *   ⛔ 不另写一份解析（同一事实两个来源必然漂移）。
 *
 * ⚠ **为什么状态读数需要它**：⚠ "够不到账本"这件事**是逐工作区的** ——
 *   ⚠ 不传它，`reachability` 就只能是 `'unresolved'`（⚠ 那也是一种"够不到"，
 *   但**说不出是哪一个账本**）。
 */
function selfWorkspaceRootOf(exec: any): string | undefined {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
}

/**
 * 造编排的三个工具。
 *
 * ⚠ 只有三个（`dispatch` / `status` / `control`）：**把 stop+resume 合成一个带 action 的工具**
 *   —— 每多一个工具名都在稀释模型的注意力，且都进白名单；两个反义动作合成一个枚举参数
 *   已经足够清楚。
 */
export function createHobOrchTools(orch: HobOrchestrator): {
  dispatch: ReturnType<typeof defineTool>
  status: ReturnType<typeof defineTool>
  control: ReturnType<typeof defineTool>
} {
  const dispatchTool = defineTool({
    name: 'hob_dispatch',
    description:
      '**派活并登记回传**：把指令投给指定会话，系统在**它这一轮跑完后自动把结果送回来**。'
      + '与 `hob_send` 的区别：`hob_send` 投完就结束（结果不回来），`hob_dispatch` 会**等它跑完再叫醒你**。'
      + '⚠ 回传是「对方说它做了什么」，**不是验收**。⚠ 停了（`hob_orch_control stop`）之后本工具直接拒绝。',
    parameters: {
      sessionId: {
        type: 'string',
        required: true,
        description: '目标会话 id（取自 hob_sessions；要用新会话就先 hob_spawn）。',
      },
      message: {
        type: 'string',
        required: true,
        description: '要派的事。给路径与要点，勿把整篇正文塞在这里。',
      },
      round: { type: 'number', description: '第几轮（回传时原样带回，便于对号）。' },
      task: { type: 'string', description: '一句话说明这一轮派什么（回传带回）。' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: { sessionId: string; message: string; round?: number; task?: string }, exec: any): Promise<string> {
      const r = await orch.dispatch(args.sessionId, args.message, {
        self: selfSessionIdOf(exec),
        ...(args.round === undefined ? {} : { round: args.round }),
        ...(args.task === undefined ? {} : { task: args.task }),
      })
      if (!r.ok) return JSON.stringify({ ok: false, reason: r.reason })
      return JSON.stringify({
        ok: true,
        dispatched: true,
        sessionId: r.sessionId,
        ...(r.messageId === undefined ? {} : { messageId: r.messageId }),
        watching: r.watching,
        // ── 目标预设预警（判据 3）—— 与 `hob_send` **同源同措辞**（都来自服务层）──
        ...(r.presetNotice === undefined ? {} : { presetNotice: r.presetNotice }),
        note2: 'Dispatched only: the work is not done. You will be woken with its result; '
          + 'until then do not claim anything was carried out.',
      })
    },
  })

  const statusTool = defineTool({
    name: 'hob_orch_status',
    description:
      '看编排状态：是否已停、在等哪些会话回传、回传过几次、被停闸拦下几次；'
      + '**以及看板卡进度**（在跑 / 待验收 / 失败·卡住）。'
      + '⚠ 前半是**你的记录**（谁派给谁），不是对方的进度。'
      + '⚠ 后半读的是看板本身 —— 卡片跑完也在这里出现「待验收」，不必去翻看板。'
      + '⚠ 看板读不到时会**明说**（⛔ 不等于「没有卡」）。',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(_args: unknown, exec: any): Promise<string> {
      /**
       * ⚠⚠ **必须把调用方身份传下去**（`I-4`）：不传 ⇒ 读数**只含无归属那一部分**
       *   （⛔ 绝不会退化成"全实例汇总"）。这是"一条 Hob 看见 9 条别人的在等回传"
       *   那条缺陷的**修法落点**。
       */
      const selfId = selfSessionIdOf(exec)
      const s = orch.status({ wsRoot: selfWorkspaceRootOf(exec), ...(selfId === undefined ? {} : { self: selfId }) })
      /**
       * ── 卡进度（2026-10-18 · 用户报障：隔离卡跑了 22 分钟，这边一行都看不见）──
       *
       * ⚠ **为什么挂在 `hob_orch_status` 里而不是新开一个工具**：作业书明令
       *   ⛔ 不新增工具名 / ⛔ 不改工具面 —— 每多一个名字都占白名单一个位置。
       * ⚠ **为什么读的是看板工具而不是看板账本文件**：见 `server/board-cards.ts` 的文件头
       *   （第二数据源必然漂，`E-128` 口径）。
       * ⚠ **读不到⛔ 不许静默成"没有卡"**：`readCards` 把三档可达性分开返回，
       *   渲染层对 `unavailable` / `unreadable` 打可读标记（判据三后半）。
       * ⚠ **按本会话自己的工作区过滤**：卡归属的是**项目**（= 工作区 id）；
       *   判不出自己的工作区 ⇒ **不传过滤**（看全部），并在话里说清这一点 ——
       *   ⛔ 不许拿一个猜出来的 workspaceId 去过滤（那会**少报**）。
       */
      const cardLines = await (async (): Promise<string[]> => {
        try {
          const snap = await orch.cardsOf({ selfSessionId: selfSessionIdOf(exec) })
          return renderCardLines(snap)
        } catch (e) {
          // ⚠ 读卡**炸了也不能把状态工具打崩**（那会把"看状态"这个动作本身变成不可用）。
          //   但⛔ 不许静默：如实报成"读不到"这一档。
          return [
            '⚠ 卡进度：**读不到**（读卡时抛错）',
            `  ↳ ${String((e as Error)?.message ?? e)}`,
            '  ↳ ⛔ **这不等于"没有卡在跑"** —— 别把这一档当作"确实没有"。',
          ]
        }
      })()
      /**
       * ── 叫醒面读数（2026-10-18 · 卡跑完不会叫醒 Hob 那条缺口）──
       *
       * ⚠ **为什么要报出来**（作业书 §一-2 硬约束③：失败要可观测）：
       *   叫醒面接不上时，**外表与"今天没有卡跑完"完全一样** —— 那正是本件要治的失败模式。
       *   ⇒ 只要**不是** `live` 且**没有过叫醒记录**，就把那件事如实说出来。
       * ⚠ `live` 且**已经叫过** ⇒ ⛔ 一行都不加（不在正常态刷屏）。
       * ⚠ ⛔ 这不等于"没有卡在跑"—— 措辞里必须写清。
       */
      /**
       * ── **实施会话叫醒面**读数（2026-10-19 · `TASK-2` · **主信号源**）──────────
       *
       * ⚠ **为什么必须出这一行**（§二-② 硬要求）：读不到会话状态 / 判定不出时
       *   外表与"没有会话在跑"**完全一样** —— 那正是本件要治的失败模式。
       * ⚠ 三档**分开报**（⛔ 不许混成一个计数）：
       *   · 叫醒过几次；· **判不出**几次（含原话）；· 登记了几个/待跑几个。
       * ⚠ 正常态（有登记、没判不出、叫过或没待跑）也**给一行短读数** ——
       *   与 `wakeLines`（旁证通道）不同，这条是**主判据面**，必须常态可见。
       */
      /**
       * ⚠⚠ **"哪些回执投给了谁"**（`TASK-R3`）—— 只读读数，⛔ 不动任何东西。
       *
       * ⚠ **上限**：一次最多列 `DELIVERY_LIST_MAX` 条；超出**明说还有 N 条未列出**
       *   （⛔ 不许静默截断 —— 本项目既有病根之一）。
       * ⚠ **空态也出一行**（"没有"≠"没显示"）：台账为空 ⇒ 明说"目前没有投递记录"。
       */
      const DELIVERY_LIST_MAX = 8
      const deliveryLines = await (async (): Promise<string[]> => {
        try {
          const led = await orch.deliveryLedger()
          const head = `回执投递台账：${led.total} 条`
            + (led.entries.filter((e) => e.mismatch === true).length > 0
              ? ` · ⚠ **其中 ${led.entries.filter((e) => e.mismatch === true).length} 条收件人 ≠ 该卡自己的 owner**`
              : '')
            + ` · 这里只显示**本工作区**那些能在卡面上对上号的`
          const lines = [head]
          if (led.reachability !== 'ok' && led.reachability !== 'no-cards') {
            // ⚠ 读不到卡面 ⇒ **判不出**哪条错投（⛔ 不是"没有错投"）
            lines.push(`  ↳ ⚠ **读不到卡面**（${led.reachability}`
              + `${led.detail === undefined ? '' : '：' + led.detail}）`
              + ' ⇒ **判不出哪一条投错了**')
            lines.push('  ↳ ⛔ 这不等于"没有错投"，也⛔ 不等于"没有回执"')
            return lines
          }
          if (led.total === 0) {
            lines.push('  ↳ 目前**没有**投递记录（这一档是"确实是空的"，⛔ 不是"没去读"）')
            return lines
          }
          const shown = led.entries.slice(0, DELIVERY_LIST_MAX)
          for (const e of shown) {
            /**
             * ⚠ 三态分开写（缺一就会把"判不出"读成"没投错"）：
             *   · `true`  ⇒ 明确标"可能投错"；· `false` ⇒ 标"一致"；
             *   · `undefined` ⇒ 明写"判不出"（卡没记 createdBy / 该条读不到 owner）。
             */
            const verdict = e.mismatch === true
              ? '⚠ 收件人 ≠ owner ⇒ **可能投错**'
              : e.mismatch === false
                ? '一致'
                : '**判不出**（该卡没记 `createdBy.sessionId`）'
            lines.push(`  · \`${e.executionId}\` → ${e.to}`
              + (e.taskId === undefined ? '' : `（卡 ${e.taskId}）`)
              + (e.owner === undefined ? '' : ` · owner=${e.owner}`)
              + ` · ${verdict}`)
          }
          if (led.total > shown.length) {
            lines.push(`  ↳ ⚠ **还有 ${led.total - shown.length} 条未列出**（本行有上限 ${DELIVERY_LIST_MAX} 条，`
              + '⛔ 不是只剩这么多）')
          }
          lines.push('  ↳ 这一块**只是读数**：⛔ 不会自动补投，⛔ 也没有"已修复"这回事')
          return lines
        } catch (e) {
          return [
            '回执投递台账：⚠ **读不到**（取台账时抛错）',
            `  ↳ ${String((e as Error)?.message ?? e)}`,
            '  ↳ ⛔ **这不等于"没有回执"** —— 别把这一档当作"确实是空的"。',
          ]
        }
      })()
      const dispatchWakeLines = ((): string[] => {
        try {
          /**
           * ⚠⚠ **必须把调用方身份传下去**（B4 / 修 **W6**）：改前 `dispatchWake.snapshot()`
           *   无参 ⇒ 进程级合计 ⇒ 同一工作区两个 Hob 读到**对方的**登记数与叫醒数。
           */
          const d = orch.dispatchWakeState(selfId)
          /**
           * ⚠ ⚠ **"接没接上，一眼能看出来"**（作业书 §三-6 的硬要求）：
           *   判据 = **有没有过"按推送现读登记成功"**（`pushedRegisterOk`）——
           *   它 > 0 即证明"**不依赖任何人先浏览卡面**"这条路真的通了。
           * ⚠ 与"读过卡面才登记"分开计：那一档是旧的、会打空的那条路。
           * ⚠⚠ **本行已拆成三档**（第 323 轮 · `TASK-I`）：`wired` 只是**第 ③ 档**的条件，
           *   ⛔ 不是"没 wired 就等于没收到过帧" —— 那个等式正是本件要修掉的假话，
           *   完整判据见下面 `headState` 那一段。
           */
          /**
           * ⚠⚠ **三档必须成对报**（B4 / `DESIGN` §4.6；缺一即假话）：
           *   `我的登记/在跑` · **`归属判不出`** · **`他人的（只给条数）`**。
           * ⚠ `selfUndecidable`（判不出"我"是谁）⇒ **只报后两档**，
           *   ⛔ **不许说"0 个"** —— 那是把"不知道我是谁"说成"我没有登记"。
           */
          /**
           * ── ⚠⚠ **这一行只放"此刻"三个数**（2026-10-20 第 3 单 · 修量纲混装）────────
           *
           * ⚠ 改前这一行是：
           *   `我的登记 1 个 · 我的在跑 0 个 · **归属判不出 960 个** · **他人的 1 个**`
           *   —— 前两个与最后一个是**当前登记数**，`960` 是**累计事件计数**
           *   （`cardsOf()` 每读一次卡面就给每张"不是我的"卡 +1）。
           *   **两种量纲并排，还宣称是分区** ⇒ 本项目明令禁止的"两种原因说成同一句话"。
           *   而且它读起来像"有 960 张别人的卡在跑"——**误导读数**（`R26` 名不副实同族）。
           *
           * ⚠ 现在：
           *   · **本行 = 分区三档（全部是"此刻"）**：我的登记 / 我的在跑 / 归属判不出 / 他人的；
           *   · **累计值单独一行**，且**明写"累计"** + 口径（`ownerUnknownBasis`）。
           * ⚠ 分区三档仍承诺"互斥且覆盖全部登记"（`SA-g` 钉的），⛔ 没有放宽。
           */
          const selfPart = d.selfUndecidable === true
            ? ' · ⚠ **我的登记：判不出（本次调用没带会话身份）**'
            : ` · 我的登记 ${d.mine?.registered ?? 0} 个 · 我的在跑 ${d.mine?.pending ?? 0} 个`
          const othersPart = ` · **归属判不出 ${d.ownerUnknownRegistered} 个**`
            + ` · **他人的 ${d.othersOnly} 个（只给条数）**`
          /**
           * ── ⚠⚠ **头行拆三档**（2026-10-20 · 第 323 轮 · `TASK-I`）────────────────────
           *
           * ⚠ ⚠ **改前是一句假话**（现场实证：第 322 轮 `AFTER-RESTART.md` §5.A）：
           *   那时只有 `pushedRegisterOk > 0 ? 已接上 : ⚠ 还没接上（未收到过点火帧）`。
           *   而"还没接上"至少三条成因，**其中两条根本没有帧**：
           *     ① 真的一帧都没收到过；
           *     ② **收到过帧，但从没走到"登记成功"**（被 `selfExecuted` / `owner ≠ subscriber`
           *        那两道准入拦下 —— 这是本机常态）；
           *     ③ 登记成功过，但按人读的那一档取不到。
           *   ⇒ 改前把 ② 说成 ①，读的人会去查"为什么没有帧"，
           *     而真正该查的是**准入那两道**。这正是本项目**头号禁忌**：
           *     **两种原因说成同一句话**。
           *
           * ⚠ 现在（判据见 `check:orch` 的 `SH` 组，三种情形各一条 + 三条反证）：
           *   · `wired`       ⇒ ③ `✅ 已接上（按推送现读）`
           *   · `firingSeen>0` ⇒ ② `⚠ 收到过点火帧、但一次都没登记成功` + **点名被哪道准入拦下**
           *   · 否则           ⇒ ① `⚠ 还没接上（一帧都没收到过）`
           * ⚠ ⛔ **不许为了档位好看去放宽那两道准入** —— 准入是**设计**（`I-3`），
           *   本件只负责**把话说清**。⛔ 也不许改 `pushedRegisterOk` 的语义。
           */
          const wired = d.pushedRegisterOk > 0
          /**
           * ⚠ `firingSeen` 缺失（旧快照 / 老调用形状）⇒ 落 `undefined`，**⛔ 不许当成 0**
           *   —— 那会把"判不出有没有帧"说成"一帧都没有"（同族的另一种假话）。
           */
          const firingSeen = typeof d.firingSeen === 'number' ? d.firingSeen : undefined
          const headState = wired
            ? '✅ **已接上（按推送现读）**'
            : firingSeen === undefined
              ? '⚠ **判不出接没接上**（这一版读数取不到"收到过几帧点火"）'
              : firingSeen > 0
                ? `⚠ **收到过点火帧 ${firingSeen} 次、但一次都没走到"登记成功"**`
                : '⚠ **还没接上（一帧都没收到过）**'
          const head = `实施会话叫醒面：${headState}`
            + selfPart + othersPart
            + ` · 已叫醒 ${d.wokeCount} 次`
            + (d.pushedRegisterOk > 0 ? ` · 按推送现读登记成功 ${d.pushedRegisterOk} 次` : '')
            + (d.undecidableCount > 0 ? ` · ⚠ **判不出 ${d.undecidableCount} 次**` : '')
          const lines = [head]
          /**
           * ── ⚠⚠ **第 ② 档必须点名"被哪一道准入拦下"**（`TASK-I` 判据的落点）──────
           *   ⚠ 只说"收到了但没登记成功"**不够**：读的人仍然不知道该去查什么。
           *   本档要回答的正是"**该查准入，不是查帧**"。
           * ⚠ `firedBlockedWhy` 缺 ⇒ 明写"没取到原话"（⛔ 不许静默当成没有这件事）。
           */
          if (!wired && firingSeen !== undefined && firingSeen > 0) {
            if (d.firedBlockedCount > 0) {
              lines.push(`  ↳ ⚠ 收到过点火帧，但**被准入拦下 ${d.firedBlockedCount} 次**`
                + ' ⇒ 这不是"没有帧"，是"**帧到了、归属证明没通过**"')
              if (d.firedBlockedWhy !== undefined) lines.push(`  ↳ ${d.firedBlockedWhy}`)
              lines.push('  ↳ ⛔ 两道准入是**设计**（`selfExecuted` / `owner ≠ subscriber`），'
                + '⛔ 不是缺陷；该查的是"这张卡该归谁"，⛔ 不是"为什么没有帧"。')
            } else {
              lines.push('  ↳ ⚠ 帧到过，但**没有一条被准入拦下的记录** ⇒ '
                + '说明它们**根本没被识别成点火帧**（⛔ 与"被准入拦下"不是同一档）')
            }
          }
          if (d.pushRegisterIssues > 0 && d.pushRegisterWhy !== undefined) {
            lines.push(`  ↳ ⚠ ${d.pushRegisterWhy}`)
            lines.push(`  ↳ 按推送现读**登记失败 ${d.pushRegisterIssues} 次** —— ⛔ 这**不是**"没有卡在跑"。`)
          }
          if (d.undecidableCount > 0 && d.undecidableWhy !== undefined) {
            lines.push(`  ↳ ⚠ ${d.undecidableWhy}`)
            lines.push('  ↳ ⛔ **判不出不是结论** —— 既不是"跑完了"，也不是"没跑过"。')
          }
          /**
           * ⚠⚠ **「判不出归属 ⇒ 没登记」与「跑完了却没送到」两档必须分开可见**（`I-3` 末段 / `I-10`）。
           *
           * ⚠ 它们都**不是**"没有会话在跑"：
           *   · 前者 = 那条记录不知道归谁 ⇒ 我**没**把它算进我的叫醒面；
           *   · 后者 = 它确实跑完了，但**回执没送到**（漏投）—— 这一档就是用户说的
           *     "正确的 hob 预设肯定就收不到指令了"里的那个"收不到"。
           * ⚠ ⛔ 两档**不许合并**成一个计数（本项目既有纪律）。
           */
          if (d.ownerUnknownCount > 0) {
            /**
             * ── ⚠⚠ **累计单独一行，且必须与上面那行"此刻"分开**（第 3 单 · 修量纲混装）──
             *   ⚠ 措辞里**必须出现"累计"二字** —— 渲染面每一行都要能回答
             *     "这个数是**此刻**的还是**累计到今天**的"。
             */
            lines.push(`  ↳ ⚠ **累计**：判不出归属 ⇒ 未登记 **${d.ownerUnknownCount} 次**`
              + `（${d.ownerUnknownBasis ?? '累计事件计数，⛔ 不是此刻的条数'}）`)
            if (d.ownerUnknownWhy !== undefined) lines.push(`  ↳ ${d.ownerUnknownWhy}`)
            lines.push('  ↳ ⛔ 这**不是**"没有卡在跑"：卡在跑，只是**判不出它归谁** ⇒ 它的回执不该给我。')
            lines.push('  ↳ ⚠ 上面那行"归属判不出 N 个"是**此刻**；本行是**累计**。两者量纲不同，⛔ 不可相加。')
          }
          if (d.undeliverableCount > 0) {
            lines.push(`  ↳ ⚠⚠ **跑完了却没送到（漏投）${d.undeliverableCount} 次**`
              + (d.undeliverableWhy === undefined ? '' : `（${d.undeliverableWhy}）`))
            lines.push('  ↳ ⛔ **错投 ≡ 漏投**：这一档说明**有回执没到**（不是"没有回执"）。'
              + '⛔ 它不会自动重投、⛔ 也不会改投别人 —— 需要重新派一次。')
          }
          if (d.lastWokeAt !== undefined) {
            lines.push(`  ↳ 最近一次叫醒：${new Date(d.lastWokeAt).toLocaleString('zh-CN', { hour12: false })}`
              + ` · 会话=${d.lastWokeSession ?? '(读不到)'}`
              + (d.lastWokeCard === undefined ? '' : ` · 卡=${d.lastWokeCard}`))
          }
          if (d.registered === 0) {
            lines.push('  ↳ ⚠ 一个实施会话都没登记 ⇒ 卡跑完也**叫不了**（⛔ 这不等于"没有卡在跑"）')
            lines.push('  ↳ 期望的接法是：**卡一点火，推送就带卡 id ⇒ 现读这一张卡的执行会话并登记**'
              + '（⛔ 不需要谁先去浏览卡面）。')
          }
          return lines
        } catch (e) {
          return [
            '⚠ 实施会话叫醒面：**读不到自身状态**（抛错）',
            `  ↳ ${String((e as Error)?.message ?? e)}`,
            '  ↳ ⛔ **这不等于"没有会话在跑"**。',
          ]
        }
      })()

      const wakeLines = ((): string[] => {
        try {
          const w = orch.wakeState()
          if (w.conn === 'live' && w.wokeCount > 0) return []
          /**
           * ⚠⚠ **"正常态才收起"的判据必须把每一个非零档都算进去**（2026-10-19 · 拆档同步）。
           *
           * ⚠ 改前这里只判 `wokeCount` 与 `noSubscriberCount` 两个数 ⇒
           *   "**判不出 owner ⇒ 没投**"（`legacyTargetCount`）与"**补投时判不出归属**"
           *   （`redeliverOwnerUnknownCount`）即便 **> 0**，也会因为这一行 early-return
           *   而被**整块吞掉** —— 那是本项目最忌讳的形态：**有读数，却读出来是空的**。
           * ⇒ 现在：只要**任何一个**"没办成"的档非零，就照实把那一档念出来。
           * ⚠ 这是**加严**（更多情形会被念出来），⛔ 不是放宽：两档都为 0 时仍然收起，
           *   且**不会**因此出现"没有卡跑完"那种错觉式说法（收起的语义就是"没发生"）。
           */
          const anyMissed = w.noSubscriberCount > 0 || w.legacyTargetCount > 0
            || w.redeliverOwnerUnknownCount > 0 || w.undeliveredCount > 0
            /**
             * ⚠⚠ **`selfExecutedCount` 必须算进这一行**（2026-10-20 · 第 7 单）：
             *   它不是"没办成"，但它是**差一点又要开一圈**的那一档 ——
             *   若不算进来，正常态下会被 early-return **整块吞掉**
             *   ⇒ 用户只能从"又被叫醒了一次"里发现它（那正是本单的现场）。
             */
            || w.selfExecutedCount > 0
          if (w.conn === 'live' && w.wokeCount === 0 && !anyMissed) {
            // 连上了、没叫过、也没有"该叫没人 / 判不出归属 / 漏投 / 执行方=owner"的情形 ⇒ **正常态**
            return []
          }
          const head = w.conn === 'live'
            ? '叫醒面：**已连上**'
            : w.conn === 'connecting'
              ? '叫醒面：**正在连**'
              : w.conn === 'idle'
                ? '叫醒面：**还没接**（没有会话读过卡面 ⇒ 不知道叫醒谁）'
                : '叫醒面：⚠ **接不上**'
          const lines = [`${head}${w.url === undefined ? '' : `（${w.url}）`}`]
          if (w.note !== undefined) lines.push(`  ↳ ${w.note}`)
          if (w.noSubscriberCount > 0) {
            lines.push(`  ↳ ⚠ 有 **${w.noSubscriberCount} 次**卡跑完但没有人订阅 ⇒ 那几声没叫出去`)
          }
          /**
           * ⚠⚠ **"判不出 owner ⇒ 不投"这一档**（`I-7` 改判后 `legacyTargetCount` 的新语义）。
           *
           * ⚠ 改前这个数是"按旧语义**投**出去的次数"（那条退回路径**已知会越界**）；
           *   现在退回路径**已删除** ⇒ 同一个键名改为记"**判不出 owner 所以没投**"。
           * ⚠ 措辞必须把三件事说清：① 有卡跑完；② **没有退回到按工作区广播**；
           *   ③ 这一档**不是**"没有卡跑完"。
           */
          if (w.legacyTargetCount > 0) {
            lines.push(`  ↳ ⚠ 有 **${w.legacyTargetCount} 次**卡跑完但**判不出它的 owner** ⇒ 那几声**没投**`
              + '（⛔ **没有**退回"按工作区广播 / 投给最后一个读过状态的人"这条旧路）')
            lines.push('  ↳ ⛔ 这不等于"没有卡跑完"：卡确实跑完了，只是**判不出该回给谁**。')
          }
          /**
           * ⚠⚠ **「补投时判不出归属 ⇒ 这一份不补」是独立一档**（2026-10-19 拆档 · `306-C83` §四）。
           *
           * ⚠ 改前它与上面那一档**共用 `legacyTargetCount`** ⇒ 一个数两件事，读者分不出：
           *   · 上面那一档 = **投递**时判不出该给谁（卡跑完、回执没发）；
           *   · 本档 = **有人按了补投**、但判不出该补给谁（操作者会以为"那条错投已经补过了"）。
           * ⇒ 现在各自具名、各自一句可读话，⛔ 不合并计数（本项目明令：两种原因不许说成同一句话）。
           */
          if (w.redeliverOwnerUnknownCount > 0) {
            lines.push(`  ↳ ⚠ 有 **${w.redeliverOwnerUnknownCount} 条**错投回执**补投不了**（判不出该补给谁）`
              + ' ⇒ 那几份**没有补发**')
            if (w.redeliverOwnerUnknownWhy !== undefined) {
              lines.push(`  ↳ ${w.redeliverOwnerUnknownWhy}`)
            }
            lines.push('  ↳ ⛔ 这**不是**"没有错投"、也⛔ **不是**"已经补过了"：'
              + '它是"**有意补投、但判不出收件人**" ⇒ 请先补上该卡的 `createdBy.sessionId` 再补投。')
          }
          if (w.undeliveredCount > 0) {
            lines.push(`  ↳ ⚠⚠ **卡跑完却没送到（漏投）${w.undeliveredCount} 次**`
              + (w.lastUndeliveredTo === undefined ? '' : `（最后一次本该给 ${w.lastUndeliveredTo}）`))
            lines.push('  ↳ ⛔ 这是"**有回执没到**"，不是"没有回执"；不会自动重投、也不会改投别人。')
          }
          /**
           * ⚠⚠ **「执行方就是 owner 本人 ⇒ 不叫醒」独立一档**（2026-10-20 · 第 7 单）。
           *
           * ⚠ 措辞必须把三件事说清（⛔ 不许让它读成"漏投"或"判不出"）：
           *   ① 那张卡**确实**跑完了一次（信号是真的）；
           *   ② 执行方**就是**收件人本人 ⇒ 通知它没有信息量；
           *   ③ 这一档非零 ⇒ 说明**卡被绑在一个自己会反复跑完的会话上**，
           *      那一侧的源头（第三方看板的执行史绑定）**不会自己消失**。
           */
          if (w.selfExecutedCount > 0) {
            lines.push(`  ↳ ⚠ **执行方就是 owner 本人、因此没叫醒 ${w.selfExecutedCount} 次**`
              + (w.lastSelfExecutedCard === undefined ? '' : `（最近：卡 ${w.lastSelfExecutedCard}）`))
            if (w.selfExecutedWhy !== undefined) lines.push(`  ↳ ${w.selfExecutedWhy}`)
            lines.push('  ↳ ⛔ 这**不是漏投**、也**不是判不出 owner**：收件人判得明明白白，'
              + '只是它自己跑完的 ⇒ 通知它没有信息量。')
            lines.push('  ↳ ⚠ 这一档 > 0 ⇒ 那张卡**绑在一个"自己每轮都会跑完一次"的会话上**'
              + '（第三方看板按执行史绑定）⇒ 源头不除，还会持续产生这种"假跑完"。')
          }
          if (w.wokeCount > 0) {
            lines.push(`  ↳ 已叫醒 ${w.wokeCount} 次（最近：${w.lastWokeCard ?? '(读不到卡号)'}）`)
          }
          lines.push('  ↳ ⛔ **这不等于"没有卡跑完"** —— 叫醒面没接上时，外表与"今天没卡跑完"一样。')
          return lines
        } catch (e) {
          return [
            '⚠ 叫醒面：**读不到自身状态**（抛错）',
            `  ↳ ${String((e as Error)?.message ?? e)}`,
            '  ↳ ⛔ **这不等于"没有卡跑完"**。',
          ]
        }
      })()
      /**
       * 把登记时刻渲染成**可指认**的一串（2026-10-18 第 2 轮 · 裁定 1 取 B）。
       *
       * ⚠ 为什么是它而不是"轮次"：裁定 1 把读数口径改成「**目标 + 登记时刻**」——
       *   因为 `write_hob` 的 `dispatchTo` 那条路**拿不到轮次**
       *   （`tools.ts` 的参数表里没有 `round`，`write-delivery.ts` 也不传），
       *   原口径在那条路上**恒假**；恒假的判据会把真漏派一起埋掉。
       * ⚠ 与 `handoffs` 那一列**同款口径**（本地时间串，人读得懂、且不依赖毫秒对齐）。
       */
      const stampOf = (at: number): string => new Date(at).toLocaleString('zh-CN', { hour12: false })
      const lines = s.watches.map((w) => '- ' + [
        `target=${w.target}`,
        // ── **登记时刻**（2026-10-18 第 2 轮新增）──────────────────────────
        //   ⚠ 这一列是「写发合一」**唯一可机检**的那半边：派发成功 ⇒ 状态行里
        //     必须有该条记录（目标 + 登记时刻）。给不出 ⇒ 视同未派。
        //   ⚠ 「**同轮**给出读数」那半边**不可机检**（回复不在文件系统里）——
        //     ⛔ 不许假装它能，那半边靠契约与自查。
        `登记=${stampOf(w.at)}`,
        `watcher=${w.watcher || '(无)'}`,
        // ── 目标预设（第 129 轮新增 · 判据 4）──────────────────────────────
        //   ⚠ 值由 `status()` **现读**填充（见 `targetPresetOf`）；这里只渲染，
        //     ⛔ **不在这里再读一次** —— 同一事实两个来源必然漂移（E-128）。
        //   ⚠ **为什么这一行是必需的**：别的项目实测那次事故里，`hob_orch_status` 只报
        //     「已开跑」⇒ 派活方读不出"目标是个不能施工的会话"，于是**一直等**一个
        //     永不会来的产出（症状「看在跑、永远没有产出」）。预设列是那个坑的**唯一可见面**。
        //   ⚠ ⚠ 2026-10-17 第 2 轮：**降级必须可见**（`targetPresetSource === 'header'`）
        //     —— 否则"退回建档头的陈旧值"与"权威投影值"在输出里**逐字一样**，
        //     而降级值恰恰会把规划侧会话**掩盖成实施侧**（`CHG-058` 要治的正是这个）。
        `预设=${w.targetPreset ?? '(读不到)'}`
          + (w.targetPreset !== undefined && w.targetPresetSource === 'header'
            ? '（降级：取自建档头，可能非当前值）' : ''),
        ...(w.targetPreset === PLANNING_PRESET_ID ? ['⚠ 规划侧预设·不能施工'] : []),
        ...(w.round === undefined ? [] : [`轮次=${w.round}`]),
        ...(w.task === undefined ? [] : [`任务=${w.task}`]),
        w.sawRunning ? '已开跑' : '尚未开跑',
        ...(w.error === undefined ? [] : [`⚠ 回传失败：${w.error}`]),
        /**
         * ⚠⚠ **"送到了但账没清掉"必须单列一档**（2026-10-20 · 第 4 单）。
         *
         * ⚠ 不许并进上面的"回传失败"：那一档的意思是**没送到**，而这一档是
         *   **已经送到了**（对方 inbox 里有），只是盘上那条没删掉。
         *   两件事混成一句话，读的人就会去重发 ⇒ 那正是"同一份报告反复送达"的下游。
         * ⚠ 措辞里明写**不要重派**（这一档不需要任何人的动作，下一轮自己会清）。
         */
        ...(w.cleanupFailedAt === undefined
          ? []
          : ['⚠⚠ 回执**已送到**、但账没清掉（`cleanupFailedAt`）⇒ ⛔ 不用重派、也不会重发；下一轮自动重试清账']),
      ].join(' · '))
      const hh = s.handoffs.map((h) => {
        const when = new Date(h.at).toLocaleString('zh-CN', { hour12: false })
        const what = h.kind === 'spawned-session'
          ? `新会话 ${h.ref}（建会话后未见投递）`
          : `${h.ref}（写于 ${when}${h.note === undefined ? '' : `，${h.note}`}）`
        return '  · ' + what
      })
      // ── 2026-10-10 第 44 轮 · 结构改造②：把"有意人工转达"与"漏投"**分开报** ──
      //   ⚠ 为什么必须分开：两者在输出里**逐字一样** ⇒ "有意转达"会持续制造**假告警**，
      //     而**假告警会训练人忽略真告警** —— 后者才是本缺陷。
      //   ⚠ **空态照旧**（`待投递：0 份`）：判据是"空态也给读数"，**不许**改成
      //     `length === 0 ? []` 那种"空就不打印"（那正是本缺陷的病根）。
      const manualCount = s.handoffs.filter((h) => h.manual === true).length
      return [
        s.stopped ? '⏸ 已停（不回传、不接受新派发）' : '▶ 在跑',
        `在等回传：${s.watches.length} 个`,
        ...lines,
        `已回传：${s.relaysDone} 次 · 被停闸拦下：${s.relaysBlocked} 次`,
        // ── ⚠ ⚠ 以下是 2026-10-16 第 247 轮（`TASK-R207`）**新增的行** ─────────
        //   ⚠ **只在"够不到"时才出现**（`'no-records-yet'` / `'ok'` ⇒ 一行都不加）。
        //   ⚠ ⚠ **为什么它必需**（第 243 轮实测 · `REPORT-R205.md` §3.2-c）：
        //     改前"够不到账本"与"真的没有记录"给出**逐字相同**的读数
        //     （在等回传 0 · 已回传 0 · 待投递 0）⇒ ⚠ **读者以为"就是 0"**。
        //   ⚠ ⚠ **为什么⛔ 不能改"真的没有记录"那一侧**（作业书 §3(a)）：
        //     那是**真实状态**；给它加标记＝把一类假信号换成另一类。
        ...reachabilityLines(s.reachability, s.ledgerHomeWhy),
        // ── ⚠ 以下是**本批新增的行**（原有行一字未改、未删）─────────────
        //   它们存在的唯一理由：宿主重载会把内存里的 watch 抹掉，
        //   没有这两行，重载后的读数与"从来没派过"**完全一样**。
        //
        //   ⚠ ⚠ **2026-10-18 第 2 轮（`UD-137` 裁定 3）**：用户原话
        //     「两类**不许混成一个 lost 计数**」⇒ 下面按 `lostByClass` **分成两行**，
        //     且各自带**它属哪一档**的说明与**怎么追回**。⛔ 不许再只报一个总数。
        //   ⚠ 三档的来源只有 `countLostByClass` 一处（分档实现点不写第二遍）。
        ...(s.lostPending === 0
          ? []
          : [
            `⚠ 重载丢失：${s.lostPending} 条派发不再在等（插件重新就绪时逐条核过目标状态）`,
            // ① **已空闲（跑完了）** —— 真丢了，但可追回。
            ...(s.lostByClass.idle === 0
              ? []
              : [
                `  ↳ ① **已跑完、回传没回来：${s.lostByClass.idle} 条**`
                  + '（重载时目标**已空闲** ⇒ 它做完了，只是那一刻的事件没了）',
                '     ✅ **可追回**：去那个会话看它最近一轮的记录，就是它的产出；'
                  + '要它继续就重新派一次（`hob_dispatch`）。',
              ]),
            // ② **判不出** —— 不是"真丢了"，也不是"做完了"。
            ...(s.lostByClass.unknown === 0
              ? []
              : [
                `  ↳ ② **判不出（目标状态读不到）：${s.lostByClass.unknown} 条**`
                  + '（会话没了 / 状态读不到 —— ⚠ 这一档**不是结论**）',
                '     ⚠ 不能当作"它还在跑"，也不能当作"它做完了"：'
                  + '去那个会话看有没有产出，没有就重新派。',
              ]),
            // ③ **异常路径** —— 仍在跑却没重挂成功。正常情况下应为 0。
            ...(s.lostByClass.running === 0
              ? []
              : [
                `  ↳ ③ ⚠⚠ **异常：${s.lostByClass.running} 条重载时仍在跑却没重挂上**`,
                '     ⛔ 这不是正常丢失 —— 说明"先核再判"那一步出了问题，'
                  + '这几条的回传**不会再来**。',
              ]),
            '  ↳ ⚠ 机制边界：若"跑完"发生在重载**之前**，那一跳事件已经没了 ⇒ '
              + '机制上补不回来，只能靠上面 ① 的"去会话里看"。',
          ]),
        /**
         * ⚠⚠ **「判不出」与「重核到顶」必须单列**（2026-10-20 · B3）。
         *
         * ⚠ 改前它们叫 `lostClass:'unknown'` 并**永远不会再被看一次**（终态）；
         *   现在 `unresolved` 是**可重入态**：每一轮触发都会再核，直到判出或到顶。
         * ⚠ 两档**分开报**（⛔ 不许并进"在等回传"）：
         *   · `unresolved` = **还在自动重试**（说清"第几次"）；
         *   · `stuck`      = **已经放弃自动重试** ⇒ 必须明说"需人工裁"
         *     （⛔ 不许让它看起来像"还在等"）。
         */
        ...(s.settleByState === undefined || (s.settleByState.unresolved === 0 && s.settleByState.stuck === 0)
          ? []
          : [
            ...(s.settleByState.unresolved === 0
              ? []
              : [
                `⚠ 判不出（目标状态读不到）：${s.settleByState.unresolved} 条 —— **仍在自动重核**`,
                '  ↳ ⚠ 这一档**不是结论**：既不是"它还在跑"，也不是"它做完了"；'
                  + `下次任何一次读写（含插件就绪）都会再核一次，最多 ${STUCK_AFTER_RECHECKS} 轮。`,
                '  ↳ ⛔ 它**不会**猜 owner：收件人始终只由该记录自己的 owner 决定（缺 owner ⇒ 不投）。',
              ]),
            ...(s.settleByState.stuck === 0
              ? []
              : [
                `⚠⚠ 重核到顶仍判不出（**stuck**）：${s.settleByState.stuck} 条 —— **不再自动重试，需人工裁**`,
                '  ↳ 去向：去那个会话 / 那张卡看有没有产出；有 ⇒ 该条应被结算（若仍挂着说明真相源读不到），'
                  + '没有 ⇒ 重新派一次（`hob_dispatch`）。',
                '  ↳ ⛔ 别再等它自己回来：**这一档没有自动重试了**（上限 = '
                  + `${STUCK_AFTER_RECHECKS} 轮，防无限重试）。`,
              ]),
          ]),
        // ── ⚠ 以下是 2026-10-10 **新增的行**（原有行一字未改、未删）──────────
        //   它们存在的唯一理由：`watches` 只在**投递成功之后**才登记 ⇒
        //   "写了交接文件却没投"在系统里**根本不存在** ⇒ 读数与"没事干"**无法区分**。
        //   ⚠ **空态也要给读数**（`待投递：0 份`）—— 让"没有漏"**也是可读的**；
        //     这正是本缺陷的病根（"0"与"没记录"必须能分开）。故**不**用
        //     `s.handoffs.length === 0 ? [] : […]` 那种"空就不打印"的写法。
        /**
         * ══════════════════════════════════════════════════════════════════
         * ⚠⚠ **甲-9 的读数行**（2026-10-21 · 第 329 轮）
         * ══════════════════════════════════════════════════════════════════
         *
         * ⚠ **只在异常档出现**：`runtimeIgnoreNote === undefined`（正常）⇒ 展开成 0 行
         *   ⇒ 正常档的状态输出**与改前逐字相同**（TASK 要求 2 的"正常档一个字都不许多"）。
         * ⚠ **恰好一行**（TASK 限"最多两行"，本字段只占一行）——
         *   状态行是逐轮要读的，多一行就挤压上下文。
         * ⚠ ⚠ **为什么必须印在这里**：改前这件事**完全不可见**（返回值被丢在
         *   `ensureRuntimeIgnored(dirname(file))` 那一行）⇒ 用户看得到"派发成功"，
         *   却不知道 `runtime/.gitignore` 缺了、`orch-watches.json`（**含会话 id**）
         *   会被账本 git 收进历史。
         */
        ...(s.runtimeIgnoreNote === undefined ? [] : [`⚠⚠ ${s.runtimeIgnoreNote}`]),
        ...(s.handoffs.length === 0
          ? ['待投递：0 份']
          : [
            manualCount > 0
              ? `⚠ 待投递：${s.handoffs.length} 份（其中 ${manualCount} 份已标注为人工转达） ——`
              : `⚠ 待投递：${s.handoffs.length} 份 ——`,
            ...hh,
            '  ↳ 这些是**已写出、但还没投出去**的（写了交接文件 / 建了会话）。',
            manualCount > 0
              ? '  ↳ 标注为**人工转达**的那些是**有意的**（不是漏投）；**其余**若本轮没打算人工带过去 ⇒ 说明漏了投递。'
              : '  ↳ **若本轮打算人工转达可忽略；否则说明漏了投递** —— '
                + '用 `hob_dispatch` / `hob_send` 投出去，或明确告知用户需手工转达。',
          ]),
        // ── ⚠ 以下是 2026-10-18 **新增的行**（原有行一字未改、未删）──────────
        //   ⚠ **它们存在的唯一理由**（用户报障原话："为什么现在你发出的实施指令会话
        //     完成之后你没有收到回传信息呢"）：隔离卡由**看板服务**起会话，
        //     不在 `watches` 里 ⇒ 上面那些行**全绿也看不见它** ——
        //     实测：卡跑了 22 分钟，这边只有「在等回传：1 个」。
        //   ⚠ ⚠ **空态⛔ 一行都不加**（`no-cards` ⇒ `[]`）——
        //     判据三：没有卡时不许凭空显示装饰性的卡状态行。
        //   ⚠ ⚠ **读不到必须说出来**：`unavailable` / `unreadable` ⇒ 可读标记 + 原话
        //     （⛔ 不许静默当成"没有卡" —— 那正是本轮要修的失败模式）。
        ...cardLines,
        // ── ⚠⚠ 以下是**主信号源**的读数（2026-10-19 · `TASK-2` 改判）────────────
        //   ⚠ 它**必须常态出现**（不像下面那条旁证通道只在异常时出）——
        //     因为"读不到会话状态"与"没有会话在跑"外表一样，只能靠这行分开。
        ...dispatchWakeLines,
        /**
         * ── ⚠⚠ **"哪些回执投给了谁"**（2026-10-19 · `TASK-R3`）──────────────────────
         *
         * 为什么必须出这几行：`redeliver` 的入口在上一轮已经通了，但**用户拿不到
         * `executionId`** ⇒ 入口通了却按不到。这一块就是"把它变成看得见的"。
         *
         * ⚠ **只读、只报**（`TASK-R3` §一 三条边界）：
         *   · ⛔ 不自动补投、⛔ 不写"建议你去补投"、⛔ 不提示"已修复"；
         *   · ⛔ 只显示**本工作区**的（反查不到卡的条目直接不显示 —— 那是别人的）；
         *   · ⚠ **有上限**，超出**明说还有多少条未列出**（⛔ 不许静默截断）。
         * ⚠ **`executionId` 必须完整、不截断** —— 否则复制不走，这个读数就没用。
         * ⚠ ⚠ **"判不出"与"没投错"是两件事**：`mismatch === undefined` ⇒ 明写"判不出"，
         *   ⛔ 不许让人读成"都投对了"。
         */
        ...deliveryLines,
        // ── ⚠ 以下是**旁证通道**的行（看板 SSE —— `TASK-2` 里已降为旁证）──────
        //   它们只在**叫醒面不正常**时出现（连不上 / 没订阅过），
        //   ⛔ 不在正常态刷屏；措辞里必须写清"这不等于没有卡跑完"。
        ...wakeLines,
        /**
         * ⚠⚠ **归属三档必须在读数里分开可见**（`I-4` 末段 / `I-10`）。
         *
         * ⚠ 为什么必须出这几行：`在等回传：N 个` 现在**只算我自己的**——
         *   于是"别的 owner 有几条在等"与"那几条根本没归属"这两件事**都会变得不可见**。
         *   而不可见正是本件要治的形态（"以为没有，其实是不归我 / 不知道归谁"）。
         * ⚠ ⛔ 只在**非零**时出（正常态不刷屏）；⛔ **不给任何明细**（别人派了什么不关我事）。
         */
        ...(s.others === undefined || s.others.watches === 0
          ? []
          : [`  ↳ ${s.others.note}：${s.others.watches} 条`]),
        /**
         * ══════════════════════════════════════════════════════════════════
         * ⚠⚠ **乙-10（2026-10-21 · 第 332 轮）：「无归属」这一档必须能分辨「真 0」与「只看了内存」**
         * ══════════════════════════════════════════════════════════════════
         *
         * ── 改前的病灶 ────────────────────────────────────────────────────
         *   `unownedWatches` 只数**内存**（`[...watches.values()]`）。而盘上
         *   **内存里没有对应 watch** 的未结算记录**不进这一摞** ⇒ 那一档会漏，
         *   ⚠ 而 `无归属：0 条`（真 0）与"我只看了内存、其实盘上还有"**印成同一句**。
         *
         * ── 现在：**两行，且只在异常档** ──────────────────────────────────
         *   · 第一行（既有行，一个字未改）：内存里那些 owner 缺失的条数；
         *   · 第二行（**新增**，只在 `unownedWatchesMemoryOnlyGap > 0` 时）：盘上还有 N 条
         *     内存里**没有对应 watch** ⇒ ⚠ 上数**只覆盖内存**。
         *   ⚠ **`TASK` 限"最多两行新增"** —— 本批**只加了一行**。
         *   ⚠ **正常档一个字都不多**：缺口为 0 ⇒ 第二行展开成 0 行 ⇒
         *     输出与改前**逐字相同**。
         *
         * ── 覆盖性：新增那一档与既有三档**互斥**（判据见下）──────────────────
         *   既有三档（`settleByState`）按**结算状态**分：`waiting` / `unresolved` / `stuck`。
         *   本条按**取数面的完备性**分：`内存看得全` / `内存看不全`。
         *   ⚠ 两者**维度不同** ⇒ 不是"新增第四档"，而是给既有读数**标注覆盖面**。
         *   互斥判据：**同一条记录要么在内存里（计入既有三档）、要么不在（计入缺口）**
         *     —— 对 `pending` 按 `target ∈ 内存键集` 二分，⛔ 不重叠、⛔ 不漏。
         */
        ...(s.unownedWatches === undefined || s.unownedWatches === 0
          ? []
          : [`  ↳ ⚠ **无归属的在等回传：${s.unownedWatches} 条** —— 那些记录没有 owner`
            + '（旧文件缺字段 / 派发时判不出调用方）⇒ 它们的回执**不会**投给任何人；'
            + '⛔ 这不是"没有在等"，也⛔ 不是"归我"']),
        /**
         * ⚠ **只有缺口 > 0 时才出**（正常档 ⇒ 0 行，与改前逐字相同）。
         *   ⚠ 它**不进 `unownedWatches` 的计数**（量纲不同、⛔ 不可相加）——
         *     只声明"上数只覆盖内存"。
         */
        ...(s.unownedWatchesMemoryOnlyGap === undefined || s.unownedWatchesMemoryOnlyGap === 0
          ? []
          : [`  ↳ ⚠⚠ **盘上另有 ${s.unownedWatchesMemoryOnlyGap} 条未结算记录，本进程内存里没有对应 watch**`
            + ' ⇒ 上面"无归属"那个数**只覆盖内存**（⛔ 别把它读成"盘上也干净"）；'
            + '⚠ 成因：重载后还没被认领 / 上一代留下的（本进程只看得见自己的 `watches`）']),
      ].join('\n')
    },
  })

  const controlTool = defineTool({
    name: 'hob_orch_control',
    description:
      '停 / 恢复编排的自动回传。`stop` 之后对方跑完**不会再叫醒你**，且 `hob_dispatch` 会被拒绝；'
      + '`resume` 重开。⚠ 用户随时可以要求你停 —— 用户的要求优先于你「还想继续推进」的判断。'
      + ' `redeliver` = **显式**补投一条"投错人"的回执：收件人只由该卡自己的 `createdBy.sessionId` 决定，'
      + '判不出就不补；同一条同一个人只补一份；⛔ 这不是自动重试。',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['stop', 'resume', 'redeliver'],
        description: 'stop=停；resume=恢复；redeliver=**显式补投**一条投错人的回执（需 executionId + taskId）。',
      },
      executionId: {
        type: 'string',
        description: 'redeliver 专用：那次执行的 id（错投的那条回执）。',
      },
      taskId: {
        type: 'string',
        description: 'redeliver 专用：卡 id（用来现读这张卡的 `createdBy.sessionId` 作为收件人）。',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: { action: 'stop' | 'resume' | 'redeliver'; executionId?: string; taskId?: string }, exec: any): Promise<string> {
      /**
       * ⚠ ⚠ **这一支原样保留、一个字没改**（`TASK-R2` §一-③ 明令）：
       *   它是"`action` 取值不合法"的既有报错分支，`TASK-R2` 只许**在它后面加一支**。
       *   ⚠ 只在文案里把新增的 `redeliver` 也列进去（否则报错话会把合法值说漏一个）。
       */
      if (args?.action !== 'stop' && args?.action !== 'resume' && args?.action !== 'redeliver') {
        return JSON.stringify({ ok: false, reason: "action must be 'stop' or 'resume' or 'redeliver'" })
      }
      // ── 新增一支：显式补投（⛔ 不新增工具名，挂在本写工具上）──────────────────
      //   ⚠ 本支**不碰** `stopped`：补投是一次"人按的补发"，与"停不停自动回传"无关
      //     ⇒ ⛔ 不要因为 stop 了就不许补投（那是两件事）。
      if (args.action === 'redeliver') {
        if (typeof args.executionId !== 'string' || args.executionId === '') {
          return JSON.stringify({
            ok: false,
            reason: 'redeliver 需要 `executionId`（那次执行的 id）—— ⛔ 不许猜一条来补',
          })
        }
        const r = await orch.redeliver(args.executionId, args.taskId)
        return JSON.stringify({
          ok: r.kind === 'redelivered',
          kind: r.kind,
          executionId: args.executionId,
          ...(args.taskId === undefined ? {} : { taskId: args.taskId }),
          ...(r.owner === undefined ? {} : { owner: r.owner }),
          reason: r.reason,
          redeliveredCount: orch.wakeState().redeliveredCount,
        })
      }
      const selfId = selfSessionIdOf(exec)
      /**
       * ⚠ `control` 也带身份：`stop` / `resume` **只作用于自己那一侧**（`I-4` 末条）。
       *   ⚠ 判不出身份 ⇒ `control()` 内部**拒绝执行**（⛔ 不许落成"停掉所有人"）。
       */
      const s = orch.control(args.action, {
        wsRoot: selfWorkspaceRootOf(exec),
        ...(selfId === undefined ? {} : { self: selfId }),
      })
      return JSON.stringify({
        ok: true,
        stopped: s.stopped,
        waiting: s.watches.length,
        relaysDone: s.relaysDone,
        relaysBlocked: s.relaysBlocked,
      })
    },
  })

  return { dispatch: dispatchTool, status: statusTool, control: controlTool }
}
