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
  bindSession,
  clearHandoffs,
  countLostByClass,
  ensureRuntimeIgnored,
  markLost,
  orchStateFileOf,
  readOrchState,
  readOrchStateDetailed,
  writePending,
  type LostClass,
  type PersistedHandoff,
  type PersistedWatch,
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
  reachability: StateReachability | 'unresolved'
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
   * **实施会话叫醒面**的运行态读数（2026-10-19 · `TASK-2` 改判后的**主信号源**）。
   *
   * ⚠ 与 `wakeState()`（看板 SSE · **旁证通道**）**分开报** ——
   *   用户原话定的口径是"信号源 = 实施会话状态变化"，SSE 只是旁证
   *   ⇒ 两者混一个计数就等于把旁证升格成判据（`TASK-2` §二-① 明令不许）。
   */
  dispatchWakeState(): DispatchWakeState
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
          dispatchWake.noteRegistryOk(cardId)
          return
        }
        // ⚠ 后两档**都不是**"没有卡在跑" ⇒ 各自留一句可读话（⛔ 不许静默）
        dispatchWake.noteRegistryIssue(cardId, r.kind, r.why)
      } catch (e) {
        dispatchWake.noteRegistryIssue(cardId, 'unreadable', `按卡现读会话时抛错：${String((e as Error)?.message ?? e)}`)
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
      deliver: (sessionId: string, text: string) => {
        const bus = (() => { try { return svcCtx.get?.('hobBus') } catch { return undefined } })()
        if (bus === undefined || typeof bus.deliver !== 'function') {
          return Promise.reject(new Error('hobBus 未提供 ⇒ 投递通道不可用'))
        }
        return Promise.resolve(bus.deliver(sessionId, text, 'followup'))
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
      deliver: (sessionId: string, text: string) => {
        const bus = (() => { try { return svcCtx.get?.('hobBus') } catch { return undefined } })()
        if (bus === undefined || typeof bus.deliver !== 'function') {
          return Promise.reject(new Error('hobBus 未提供 ⇒ 投递通道不可用'))
        }
        return Promise.resolve(bus.deliver(sessionId, text, 'followup'))
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
          })
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
    const reachabilityFor = (wsRoot: string | undefined): StateReachability | 'unresolved' => {
      try {
        if (typeof wsRoot !== 'string' || wsRoot === '') return 'unresolved'
        const ledgerRoot = resolveLedgerRoot('', declaredLedgerHome(svcCtx), wsRoot)
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

    /** 目标会话 → 运行态文件（登记时定下来；结算时按同一个文件改）。 */
    const stateFileFor = new Map<string, string>()

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
         * ⚠ **保留别人的**：`owner` 不匹配的那些**原样留着**。
         *   无归属（`owner === undefined`）的记录算**别人**的 —— ⛔ 不许被我覆盖掉：
         *   判不出归属 ≠ 归我（`I-1`：⛔ 不许猜一个默认 owner）。
         */
        const others = prev.pending.filter((w) => (w.owner ?? '') !== owner)
        const next = [...mine, ...others]
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
    } => {
      const all = [...watches.values()]
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
      try {
        for (const file of scanStateFiles(svcCtx)) {
          const st = readOrchState(file)
          for (const h of st.handoffs) if (h.owner === self) handoffs.push(h)
          const mineLost = st.lost.filter((w) => w.owner === self)
          lostTotal += mineLost.length
          const byClass = countLostByClass(mineLost)
          lostAcc.running += byClass.running
          lostAcc.idle += byClass.idle
          lostAcc.unknown += byClass.unknown
        }
      } catch { /* 读不到就当 0；不因诊断用途让读数崩掉 */ }
      return {
        watches: mineW,
        handoffs: handoffs.sort((a, b) => b.at - a.at),
        lostPending: lostTotal,
        lostByClass: lostAcc,
        /**
         * ⚠ `relaysDone` / `relaysBlocked` 是**累计计数器**（进程内），
         *   改前只有一个数 ⇒ 读的人以为"我回传了 N 次"。⇒ 现在按 owner 分档累计。
         */
        relaysDone: relaysByOwner.done.get(self) ?? 0,
        relaysBlocked: relaysByOwner.blocked.get(self) ?? 0,
        unownedWatches: all.filter((w) => w.owner === undefined || w.owner === '').length,
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
          if (file !== undefined) {
            ensureRuntimeIgnored(dirname(file))
            /**
             * ⚠⚠ **只写属于 `(本文件, 本 owner)` 的那一片**（`I-5` 的核心）：
             *   改前是 `persistWatches(file, [...watches.values()].map(...))`
             *   —— **整张表**写进一个文件、还给每条盖上本次的 `wsRoot`
             *   ⇒ 跨工作区互相污染（`1.4` 病根）。
             *   ⇒ 现在走 `persistOwnerPartition`：只替换 owner 等于本条的记录，别人的原样留着。
             */
            if (!persistOwnerPartition(file, owner ?? '', [toPersisted(w)])) {
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
          // ⚠ 现读盘（不缓存）：记账在别的模块做，缓存会滞后 —— 见 `readHandoffs` 注释。
          handoffs: mine.handoffs,
          // ⚠ ⚠ **可达性**（第 247 轮）：⚠ 它与 `handoffs` **同一次读**吗？
          //   ⛔ 不是 —— `handoffs` 现在按 owner 过滤（`I-4`），
          //   而可达性问的是"**本会话这一份**账本够不够得到"（那才是"够不到"的形态）。
          //   ⇒ 故它按**调用方给的工作区根**现算（⛔ 不从 `handoffs` 反推）。
          reachability: reachabilityFor(opts?.wsRoot),
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

      dispatchWakeState(): DispatchWakeState {
        return dispatchWake.snapshot()
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
        return {
          stopped: isStoppedFor(self),
          watches: mine.watches.sort((a, b) => a.at - b.at),
          relaysDone: mine.relaysDone,
          relaysBlocked: mine.relaysBlocked,
          lostPending: mine.lostPending,
          lostByClass: mine.lostByClass,
          // ⚠ 与 `status()` 同源同值（两处返回**同一个形状**，调用方不必分情况）。
          handoffs: mine.handoffs,
          reachability: reachabilityFor(opts?.wsRoot),
          others: {
            note: '他人的（不可见明细）—— 只给条数，不给 target / task / 轮次',
            watches: othersOf(self).watches.length,
          },
        }
      },
    }

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
        if (w === undefined || w.reported) return
        if (status === 'running') {
          // 见过 running 才算"它真的开始跑了" —— 光看到 idle 不能当"跑完"。
          w.sawRunning = true
          return
        }
        if (status !== 'idle') return
        if (!w.sawRunning) return      // 从没跑过 ⇒ 不是"跑完"
        if (before !== 'running') return // 不是从 running 掉下来的 ⇒ 不是这一次的结束
        if (w.watcher === '') return

        // ── ⚠⚠ 闸门在【回传之前】 ──
        //   用户选择了"不设上限、只能手动停" ⇒ 这里就是那个刹车的作用点。
        //   停了 ⇒ **不唤醒派活方**（循环当场断在这一环）。
        //   ⚠ **按该条记录自己的 owner 判**（`I-4`）：别人停了⛔ 不许拦下我的回传。
        if (isStoppedFor(w.owner ?? (w.watcher === '' ? undefined : w.watcher))) {
          relaysBlocked++
          bumpRelay(relaysByOwner.blocked, w.owner ?? (w.watcher === '' ? undefined : w.watcher))
          return
        }

        // **先标记再发**：同一个 idle 事件只该唤醒一次（防"刷爆派活方"）。
        w.reported = true

        const session = (() => { try { return sessions.get?.(id) } catch { return undefined } })()
        const receipt = buildReceipt(w, session)
        const bus = (() => { try { return svcCtx.get?.('hobBus') } catch { return undefined } })()
        if (bus === undefined || typeof bus.deliver !== 'function') {
          w.error = 'session bus unavailable at relay time'
          flushWatches()
          return
        }
        Promise.resolve(bus.deliver(w.watcher, receipt, 'followup'))
          .then((res: any) => {
            if (res?.ok) {
              relaysDone++
              // ⚠ 分档累计（`I-4`：读数分母 = 我的）—— 与上面的总数同源同义，只拆到各 owner 名下
              bumpRelay(relaysByOwner.done, w.owner ?? (w.watcher === '' ? undefined : w.watcher))
              watches.delete(id)
            } else { w.error = res?.reason ?? 'relay delivery failed' }
          })
          .catch((e: any) => { w.error = String(e?.message ?? e) })
          // ⚠ 无论成败都要同步落盘（本批新增）：成功 ⇒ 该条从 pending 消失
          //   （下次重载不该再报它"丢失"）；失败 ⇒ 留 error 残骸，同样如实落盘。
          .finally(() => { flushWatches() })
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
function reachabilityLines(r: OrchStatus['reachability']): string[] {  if (r === 'ok' || r === 'no-records-yet') return []
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
      const dispatchWakeLines = ((): string[] => {
        try {
          const d = orch.dispatchWakeState()
          /**
           * ⚠ ⚠ **"接没接上，一眼能看出来"**（作业书 §三-6 的硬要求）：
           *   判据 = **有没有过"按推送现读登记成功"**（`pushedRegisterOk`）——
           *   它 > 0 即证明"**不依赖任何人先浏览卡面**"这条路真的通了；
           *   = 0 且登记也是 0 ⇒ 明写"**还没接上**"（⛔ 不许让人以为是"没有卡在跑"）。
           * ⚠ 与"读过卡面才登记"分开计：那一档是旧的、会打空的那条路。
           */
          const wired = d.pushedRegisterOk > 0
          const head = `实施会话叫醒面：${wired ? '✅ **已接上（按推送现读）**' : '⚠ **还没接上（未收到过点火帧）**'}`
            + ` · 登记 ${d.registered} 个 · 待跑 ${d.pending} 个`
            + ` · 已叫醒 ${d.wokeCount} 次`
            + (d.pushedRegisterOk > 0 ? ` · 按推送现读登记成功 ${d.pushedRegisterOk} 次` : '')
            + (d.undecidableCount > 0 ? ` · ⚠ **判不出 ${d.undecidableCount} 次**` : '')
          const lines = [head]
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
            lines.push(`  ↳ ⚠ **判不出归属 ⇒ 未登记 ${d.ownerUnknownCount} 次**`
              + (d.ownerUnknownWhy === undefined ? '' : `（${d.ownerUnknownWhy}）`))
            lines.push('  ↳ ⛔ 这**不是**"没有卡在跑"：卡在跑，只是**判不出它归谁** ⇒ 它的回执不该给我。')
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
          if (w.conn === 'live' && w.wokeCount === 0 && w.noSubscriberCount === 0) {
            // 连上了、没叫过、也没有"该叫没人"的情形 ⇒ 这是**正常态**（就是没卡跑完过）
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
          if (w.undeliveredCount > 0) {
            lines.push(`  ↳ ⚠⚠ **卡跑完却没送到（漏投）${w.undeliveredCount} 次**`
              + (w.lastUndeliveredTo === undefined ? '' : `（最后一次本该给 ${w.lastUndeliveredTo}）`))
            lines.push('  ↳ ⛔ 这是"**有回执没到**"，不是"没有回执"；不会自动重投、也不会改投别人。')
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
        ...reachabilityLines(s.reachability),
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
        // ── ⚠ 以下是 2026-10-10 **新增的行**（原有行一字未改、未删）──────────
        //   它们存在的唯一理由：`watches` 只在**投递成功之后**才登记 ⇒
        //   "写了交接文件却没投"在系统里**根本不存在** ⇒ 读数与"没事干"**无法区分**。
        //   ⚠ **空态也要给读数**（`待投递：0 份`）—— 让"没有漏"**也是可读的**；
        //     这正是本缺陷的病根（"0"与"没记录"必须能分开）。故**不**用
        //     `s.handoffs.length === 0 ? [] : […]` 那种"空就不打印"的写法。
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
        ...(s.unownedWatches === undefined || s.unownedWatches === 0
          ? []
          : [`  ↳ ⚠ **无归属的在等回传：${s.unownedWatches} 条** —— 那些记录没有 owner`
            + '（旧文件缺字段 / 派发时判不出调用方）⇒ 它们的回执**不会**投给任何人；'
            + '⛔ 这不是"没有在等"，也⛔ 不是"归我"']),
      ].join('\n')
    },
  })

  const controlTool = defineTool({
    name: 'hob_orch_control',
    description:
      '停 / 恢复编排的自动回传。`stop` 之后对方跑完**不会再叫醒你**，且 `hob_dispatch` 会被拒绝；'
      + '`resume` 重开。⚠ 用户随时可以要求你停 —— 用户的要求优先于你「还想继续推进」的判断。',
    parameters: {
      action: { type: 'string', required: true, enum: ['stop', 'resume'], description: 'stop=停；resume=恢复。' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: { action: 'stop' | 'resume' }, exec: any): Promise<string> {
      if (args?.action !== 'stop' && args?.action !== 'resume') {
        return JSON.stringify({ ok: false, reason: "action must be 'stop' or 'resume'" })
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
