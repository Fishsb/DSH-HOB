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
  type WakeState, type DispatchWakeState, type CardFiringEvent,
} from '../server/card-wake.ts'
import {
  ORCH_STATE_FILENAME,
  ORCH_STATE_SUBDIR,
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
  /** 读状态。⚠ `opts.wsRoot` = 调用方的工作区根（用来判"本会话那份账本够不够得到"）。 */
  status(opts?: { wsRoot?: string }): OrchStatus
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
  control(action: 'stop' | 'resume', opts?: { wsRoot?: string }): OrchStatus
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

/** 把一个内存 watch 收窄成可序列化的一条（带工作区归属）。 */
function toPersisted(w: Watch, wsRoot: string | undefined): PersistedWatch {
  return {
    target: w.target,
    watcher: w.watcher,
    ...(w.round === undefined ? {} : { round: w.round }),
    ...(w.task === undefined ? {} : { task: w.task }),
    at: w.at,
    sawRunning: w.sawRunning,
    ...(w.error === undefined ? {} : { error: w.error }),
    ...(wsRoot === undefined || wsRoot === '' ? {} : { wsRoot }),
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
    const registerCardByPush = async (cardId: string): Promise<void> => {
      try {
        const registry: any = (() => { try { return svcCtx.get?.('tools') } catch { return undefined } })()
        const getTool = registry !== undefined && registry !== null && typeof registry.get === 'function'
          ? (n: string) => registry.get(n)
          : undefined
        const r = await lookupCardSession(cardId, getTool)
        if (r.kind === 'found') {
          dispatchWake.register({
            sessionId: r.sessionId,
            via: 'taskboard-card',
            cardId: r.cardId,
            ...(r.executionId === undefined ? {} : { executionId: r.executionId }),
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
      onFiring: (e: CardFiringEvent) => { void registerCardByPush(e.taskId) },
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
    let stopped = false
    let relaysDone = 0
    let relaysBlocked = 0

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
    try {
      for (const file of scanStateFiles(svcCtx)) {
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
        // ── ① 仍在跑 ⇒ **必须重挂**（不是"可以不挂"）─────────────────────
        for (const w of r.reattach) {
          watches.set(w.target, {
            target: w.target,
            watcher: w.watcher,
            ...(w.round === undefined ? {} : { round: w.round }),
            ...(w.task === undefined ? {} : { task: w.task }),
            at: w.at,
            sawRunning: w.sawRunning,
            reported: false,
            ...(w.error === undefined ? {} : { error: w.error }),
          })
          reattachedLatch = [...reattachedLatch, w]
        }
        if (r.lost.length > 0) {
          lostLatch = [...lostLatch, ...r.lost]
          svcCtx.logger?.warn?.(
            `[${name}] 重载后判定 ${r.lost.length} 条未结算派发丢失（${file}）：`
            + r.lost.map((w) => `${w.target}${w.round === undefined ? '' : `(第${w.round}轮)`}`
              + `[${w.lostClass ?? 'unknown'}]`).join(', '),
          )
        }
        if (r.reattach.length > 0) {
          svcCtx.logger?.info?.(
            `[${name}] 重载后**重新挂上** ${r.reattach.length} 条仍在跑的派发（${file}）：`
            + r.reattach.map((w) => `${w.target}@${w.at}`).join(', '),
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
      if (lostLatch.length > 0 && bus !== undefined && typeof bus.deliver === 'function') {
        const byWatcher = new Map<string, PersistedWatch[]>()
        for (const w of lostLatch) {
          if (w.watcher === '') continue
          const arr = byWatcher.get(w.watcher) ?? []
          arr.push(w)
          byWatcher.set(w.watcher, arr)
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
     * ⚠ 只对**已经登记过落点**的 target 写（`stateFileFor`）——
     *   否则会拿着"判不出的空路径"去写，或在错误的工作区目录里建文件。
     */
    const flushWatches = (): void => {
      const files = new Set<string>()
      for (const v of stateFileFor.values()) if (v !== '') files.add(v)
      for (const file of files) {
        const ws = (() => {
          try {
            // 用该文件对应的任一会话反推工作区根（同一工作区的账本是同一个）。
            for (const [t, f] of stateFileFor) if (f === file) { const r = wsRootOfSession(t); if (r !== undefined) return r }
            return undefined
          } catch { return undefined }
        })()
        const alive = [...watches.values()].filter((x) => stateFileFor.get(x.target) === file)
        if (!persistWatches(file, alive.map((x) => toPersisted(x, ws)))) {
          svcCtx.logger?.warn?.(`[${name}] 运行态落盘失败（${file}）。`)
        }
      }
      refreshLostCount()
    }

    const orch: HobOrchestrator = {
      version: 1,

      async dispatch(target, message, opts) {
        if (stopped) {
          return { ok: false, reason: 'orchestration is stopped; resume it first (hob_orch_control resume).' }
        }
        if (typeof target !== 'string' || target === '') return { ok: false, reason: 'no-session-id' }
        const self = opts?.self
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
        const r = await bus.deliver(target, message, opts?.mode === 'steer' ? 'steer' : 'followup')
        if (!r?.ok) return { ok: false, reason: r?.reason ?? 'delivery failed' }

        // 登记 watch（**投递成功之后**才登记 —— 没送出去就不该等回传）。
        const cur = (() => {
          try { const a = agents.get?.(target); return a?.status } catch { return undefined }
        })()
        const w: Watch = {
          target,
          watcher: typeof self === 'string' ? self : '',
          ...(opts?.round === undefined ? {} : { round: opts.round }),
          ...(opts?.task === undefined ? {} : { task: opts.task }),
          at: Date.now(),
          // 投递时它若已在跑，直接算"见过 running"，否则等状态事件点亮。
          sawRunning: cur === 'running',
          reported: false,
        }
        watches.set(target, w)
        lastStatus.set(target, cur ?? 'unknown')
        svcCtx.logger?.debug?.(`[${name}] 已登记回传 watch：${target} → ${w.watcher}`)
        // ── 落盘（**本批新增**）：让"有未结算派发"这件事活过下一次重载 ──
        //   ⚠ 写失败必须留 warn：静默的"记不上账"正是本批要修的失败模式。
        try {
          const ws = wsRootOfSession(target)
          const file = runtimeFileOf(svcCtx, ws)
          stateFileFor.set(target, file ?? '')
          if (file !== undefined) {
            ensureRuntimeIgnored(dirname(file))
            if (!persistWatches(file, [...watches.values()].map((x) => toPersisted(x, ws)))) {
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

      status(opts?: { wsRoot?: string }) {
        return {
          stopped,
          // ⚠ **现读**每个在等目标的预设（不缓存、不回落到 `w` 上存一份）——
          //   见 `targetPresetOf` 的注释：这条读数的价值全在"此刻准不准"。
          // ⚠ ⚠ 2026-10-17 第 2 轮：读数改由 `hobBus.presetOf()` **单点**给出，
          //   且**来源标记一起透传**（`targetPresetSource`）—— 渲染层据此标「降级」。
          //   ⛔ 这里**不再**调 `sessions.get(...).header`：那正是本单要治的第二来源。
          watches: [...watches.values()]
            .sort((a, b) => a.at - b.at)
            .map((w) => {
              const [preset, source] = targetPresetOf(w.target)
              return {
                ...w,
                ...(preset === undefined ? {} : { targetPreset: preset }),
                ...(preset === undefined || source === undefined ? {} : { targetPresetSource: source }),
              }
            }),
          relaysDone,
          relaysBlocked,
          lostPending: lostCount,
          lostByClass: lostByClass,
          // ⚠ 现读盘（不缓存）：记账在别的模块做，缓存会滞后 —— 见 `readHandoffs` 注释。
          handoffs: readHandoffs(),
          // ⚠ ⚠ **可达性**（第 247 轮）：⚠ 它与 `handoffs` **同一次读**吗？
          //   ⛔ 不是 —— `readHandoffs()` 扫**所有**工作区（跨工作区汇总），
          //   而可达性问的是"**本会话这一份**账本够不够得到"（那才是"够不到"的形态）。
          //   ⇒ 故它按**调用方给的工作区根**现算（⛔ 不从 `readHandoffs` 反推）。
          reachability: reachabilityFor(opts?.wsRoot),
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
          // ⚠ 收件人 = **读卡面的人自己**（谁在看这个面，就叫醒谁 —— ⛔ 不凭空假设"Hob"）
          dispatchWake.setSelfSessionId(opts.selfSessionId)
          // ⚠⚠ **订阅时要带上"这个会话自己的项目"**（`TASK-B6` S3-4）：
          //   `CardWake` 是**进程级单实例、被所有会话共用**，订阅表 `targets` 里装的是
          //   所有会话的登记 ⇒ 投递侧必须能**逐个订阅者**核对归属
          //   （`card-wake.ts` 的 `eligible` 过滤）。⚠ 用上面**这次现读**的 `workspaceId`，
          //   ⛔ 不另造进程级变量（`wsIdForWake` 是旧的进程级单值，正是越界成因）。
          //   ⚠ 判不出（`undefined`）⇒ **照原样传 undefined** ⇒ 投递侧落"不投"，
          //     而不是退化成"全投"。
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
        for (const c of snap.cards) {
          if (typeof c.executionSessionId !== 'string' || c.executionSessionId === '') continue
          dispatchWake.register({
            sessionId: c.executionSessionId,
            via: 'taskboard-card',
            cardId: c.id,
            ...(c.executionId === undefined ? {} : { executionId: c.executionId }),
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

      control(action, opts?: { wsRoot?: string }) {
        if (action === 'stop') {
          stopped = true
          svcCtx.logger?.info?.(`[${name}] 已停：不再回传、不再接收新派发`)
        } else if (action === 'resume') {
          stopped = false
          svcCtx.logger?.info?.(`[${name}] 已恢复`)
        }
        return {
          stopped,
          watches: [...watches.values()].sort((a, b) => a.at - b.at),
          relaysDone,
          relaysBlocked,
          lostPending: lostCount,
          lostByClass: lostByClass,
          // ⚠ 与 `status()` 同源同值（两处返回**同一个形状**，调用方不必分情况）。
          handoffs: readHandoffs(),
          reachability: reachabilityFor(opts?.wsRoot),
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
        if (stopped) {
          relaysBlocked++
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
            if (res?.ok) { relaysDone++; watches.delete(id) }
            else { w.error = res?.reason ?? 'relay delivery failed' }
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
      const s = orch.status({ wsRoot: selfWorkspaceRootOf(exec) })
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
      const s = orch.control(args.action, { wsRoot: selfWorkspaceRootOf(exec) })
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
