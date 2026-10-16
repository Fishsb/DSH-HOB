/**
 * **改 2 · 写入即投递**（2026-10-10 第 44 轮 · 结构改造②）—— "写交接文件"与"投递"
 * 这两个原本**互相独立**的动作，在**一次工具调用里**接起来。
 *
 * ── 为什么需要它（根因，非推测）──────────────────────────────────────────
 *   `write_hob`（写 `archive/<日期>/TASK.md`）与 `hob_dispatch`（投递）是**两个独立调用**；
 *   `handoffs` 只在**事后**由 `hob_orch_status` 报出来 ⇒ **"写了却没投"**在系统里
 *   要到下一次看状态才可见。实测漏了 3 次（第 9 / 21 / 40 轮），**两次是用户发现的**。
 *   ⇒ 本模块把"投递"变成**写入这一次调用的一部分**（成熟模式：**事务性发件箱** /
 *     transactional outbox —— 把"记录"与"外发"绑在一次提交里）。
 *
 * ── 为什么单独一个文件（分层纪律）────────────────────────────────────────
 *   · `hob-write.ts`（落盘层）**刻意不 import 运行态模块** —— 那条纪律由机检
 *     `check:orch` 的 **F6** 盯着，且它是"守卫只写一份 / 落盘不碰运行态"的核心分工。
 *   · 本模块是**工具层与运行态之间的桥**：它负责"记账 + 投递 + 读回状态"，
 *     由 `modules/tools.ts`（工具层）调用。
 *   ⇒ 把它单独成文件，既守住 F6，又让这段逻辑**可被机检直接 import 真跑**
 *     （只依赖 `node:fs` 与本仓 `orch-state.ts`，**不依赖宿主包**）。
 *
 * ── ⛔ 三条硬纪律（都有出处）─────────────────────────────────────────────
 *   ① **不做硬闸门**：不给 `dispatchTo` 也**照写**（现状不变，仍附「尚未投递」提醒）；
 *   ② **目标由人指定**：本模块**不挑会话**，`dispatchTo` 缺省就不投；
 *   ③ **保守方向 = 宁可少清**（**CHG-027**）：只有**投递真的成功**才清记录。
 */
import { dirname } from 'node:path'
import {
  clearHandoffs,
  ensureRuntimeIgnored,
  orchStateFileOf,
  readOrchState,
  readOrchStateDetailed,
  recordHandoff,
  type PersistedHandoff,
  type StateReachability,
} from './orch-state.ts'

/**
 * 投递能力的**最小依赖面**（只声明本模块真正用到的两个方法）。
 *
 * ⚠ 用结构类型而不是 import `HobOrchestrator`：本模块**不依赖** orchestrator 的完整形状，
 *   也不该把 `src/modules/**` 拉进 server 层（方向反了）。⚠ 且这让机检可以传**假实现**。
 */
export interface DispatchLike {
  dispatch(
    target: string,
    message: string,
    opts: { self?: string | undefined; round?: number; task?: string; mode?: 'followup' | 'steer' },
  ): Promise<{ ok: boolean; sessionId?: string; messageId?: string; reason?: string; watching?: boolean }>
  status(): { handoffs: PersistedHandoff[] }
}

export interface HandoffDeliveryInput {
  /** 账本区根（运行态文件相对它派生）。 */
  ledgerRoot: string
  /** 交接文件的**账本区相对路径**（如 `archive/2026-10-10-x/TASK.md`）。 */
  ref: string
  /** 交接文件写出时刻（毫秒）。 */
  at: number
  /** 目标会话 id；**给了才投**（⛔ 不自动挑）。 */
  dispatchTo?: string
  /** `'manual'` = 本轮**有意人工转达**（不是忘了投）⇒ 记录带标注。 */
  delivery?: 'manual'
  /** 派活方自己的会话 id（透传给编排层，用于"不派给自己"那道闸）。 */
  self?: string
  /** 投递时随行的短指针正文（缺省时由本模块构造）。 */
  message?: string
  /** 编排服务；缺席 ⇒ **不投递，只记账**（fail-closed：不猜、不装作投了）。 */
  orch?: DispatchLike
}

export interface HandoffDeliveryResult {
  /** 是否成功落了"待投递"记录。 */
  recorded: boolean
  /** 是否标注为**有意人工转达**。 */
  manual: boolean
  /** 是否真的调用并完成了投递。 */
  dispatched: boolean
  /** 投递被**拒绝/失败**时的原因（给人/模型看）。 */
  dispatchReason?: string
  /** 投递后（或记账后）的**待投递**记录快照。 */
  handoffs: PersistedHandoff[]
  /**
   * ⚠ **这次读回的"可可达性"**（2026-10-16 第 247 轮 · `TASK-R207` 新增）。
   *
   * ⚠ 它治的是**"够不到账本"与"没有待投递"给同一个读数**这个缺陷
   *   （第 243 轮实测 · `REPORT-R205.md` §3.2-c）。
   * ⚠ ⚠ **`'no-records-yet'`（账本在、只是还没有记录）是真实状态**，
   *   ⇒ 调用方**必须**照旧渲染 `待投递：0 份`（⛔ 不加标记 —— 作业书 §3(a)）。
   */
  reachability: StateReachability
  /** 记账或投递过程中的**异常说明**（不改主结果，只如实回带）。 */
  note?: string
}

/** 投递时随行的**短指针**正文（契约口径：路径 + 一句"读该文件并执行"）。 */
export function pointerMessage(ref: string): string {
  return `请读并执行本文件：${ref}（账本区根下的相对路径）。先读它，再动手；`
    + '需要拍板的地方不要问我，把问题写进回报的「待决问题」段。'
}

/**
 * **记账 + 投递 + 读回状态**（本模块唯一的入口）。
 *
 * 顺序有意如此：**先记账、后投递** —— 即使投递崩了，"写过一份交接文件"这件事
 * 也已经在盘上（下一步的 `hob_orch_status` 会把它报出来）。反过来会让一次投递
 * 失败把记录也一起丢掉（正是本缺陷的形态）。
 *
 * ⚠ **任何一步失败都不抛**：返回 `note` 说明，由调用方贴进工具返回值。
 *   （同 `orch-state` 的纪律：诊断用途不该让主流程崩掉。）
 */
export async function deliverHandoff(
  input: HandoffDeliveryInput,
  opts: { clearOnSuccess?: boolean } = {},
): Promise<HandoffDeliveryResult> {
  const manual = input.delivery === 'manual'
  const stateFile = orchStateFileOf(input.ledgerRoot)
  let recorded = false
  let note: string | undefined

  // ── 1：记账（写一份"待投递"）────────────────────────────────────────────
  try {
    ensureRuntimeIgnored(dirname(stateFile))
    const rec = recordHandoff(stateFile, {
      kind: 'task-file',
      ref: input.ref,
      at: input.at,
      // ⚠ `manual` 是**新增字段**（旧文件没有 ⇒ 读成 false，向后兼容）；
      //   `note` 是给人读的同一件事，两份都写：机器判 `manual`、人读 `note`。
      ...(manual ? { manual: true as const, note: '人工转达（有意，非漏投）' } : {}),
    })
    recorded = rec.wrote
    if (!rec.wrote) note = '待投递记录未能落盘（写入本身已成功）⇒ 这次交接文件在状态输出里可能不可见。'
  } catch (e) {
    note = `待投递记录出错：${String((e as Error)?.message ?? e)}（写入本身已成功）`
  }

  const readHandoffsDetailed = (): { handoffs: PersistedHandoff[]; reachability: StateReachability } => {
    try {
      const r = readOrchStateDetailed(stateFile)
      return { handoffs: r.state.handoffs, reachability: r.reachability }
    } catch {
      // ⚠ 取不到 ⇒ 如实报"读不了"（⛔ 不许静默回成 `'ok'` —— 那就是本单要治的缺陷）
      return { handoffs: [], reachability: 'unreadable' }
    }
  }

  // ── 2：投递（**只有给了 dispatchTo 且编排服务在**才投）──────────────────
  let dispatched = false
  let dispatchReason: string | undefined
  if (typeof input.dispatchTo === 'string' && input.dispatchTo !== '') {
    if (input.orch === undefined) {
      dispatchReason = 'orchestration unavailable; the file was written but nothing was delivered.'
    } else {
      try {
        const r = await input.orch.dispatch(input.dispatchTo, input.message ?? pointerMessage(input.ref), {
          self: input.self,
        })
        dispatched = r.ok === true
        if (!r.ok) dispatchReason = r.reason ?? 'delivery failed'
      } catch (e) {
        dispatchReason = `投递时出错：${String((e as Error)?.message ?? e)}`
      }
    }
  }

  // ── 3：投递成功 ⇒ 清匹配的"待投递"（**保守方向：宁可少清**）──────────────
  //   ⚠ 只有**真的投成功**才清；且清的依据是"这条记录在投递发生之前写出"
  //     （与 `orchestrator.ts` / `bus.ts` 同一口径：**不按消息文本匹配**）。
  if (dispatched && opts.clearOnSuccess !== false) {
    try {
      clearHandoffs(stateFile, (h) => h.kind === 'task-file' && h.at <= input.at)
    } catch { /* 清理失败不掩盖主结果；下面的读数会如实显示"还在" */ }
  }

  const reading = readHandoffsDetailed()
  return {
    recorded,
    manual,
    dispatched,
    ...(dispatchReason === undefined ? {} : { dispatchReason }),
    handoffs: reading.handoffs,
    reachability: reading.reachability,
    ...(note === undefined ? {} : { note }),
  }
}

/**
 * 待投递读数的一句话（空态也给读数 —— **让"没有漏"也是可读的**）。
 *
 * ⚠ ⚠ **2026-10-16 第 247 轮 / `TASK-R207` 新增 `reachability`（可选）** ——
 *   治的缺陷（第 243 轮实测 · `REPORT-R205.md` §3.2-c）：**"够不到账本"与
 *   "真的没有待投递"给出逐字相同的读数**（都是 `待投递：0 份`）。
 *
 * ⚠ ⚠ **三条口径（⛔ 一条都不许松）**：
 *   **(a) 不改变"真的没派过"那一侧的输出** —— ⚠ `'no-records-yet'`（账本在、只是
 *       还没有记录）**照旧返回 `待投递：0 份`**（⛔ 不加任何标记）。
 *       理由：那是**真实状态**；给它加标记就是**把一类假信号换成另一类**（作业书 §3）。
 *   **(b) 失败路径⛔ 不静默** —— `'ledger-unreachable'` / `'unreadable'` **必须**带可读标记。
 *   **(c) 成对可验** —— 两侧都走本函数，读数**并列可比**（⛔ 不是单侧加一句）。
 *
 * @param handoffs - 读到的待投递清单。
 * @param reachability - 该次读取的可达性（⚠ **缺省 = `'ok'`** ⇒ 旧调用点行为不变）。
 */
export function renderHandoffReading(
  handoffs: PersistedHandoff[],
  reachability: StateReachability = 'ok',
): string {
  const manual = handoffs.filter((h) => h.manual === true).length
  if (handoffs.length === 0) {
    // ⚠ ⚠ **只有"够不到"与"读不了"才加标记**（⛔ `'no-records-yet'` **不加** —— 见口径 (a)）。
    if (reachability === 'ledger-unreachable') {
      return '待投递：0 份 ⚠ **但这是"够不到账本"**（账本目录不存在）—— '
        + '⚠ 本读数**不能**当作"没有待投递"：真实值可能非零。'
    }
    if (reachability === 'unreadable') {
      return '待投递：0 份 ⚠ **但这是"运行态读不了"**（文件在、读不到或 JSON 坏）—— '
        + '⚠ 本读数**不能**当作"没有待投递"：真实值未知。'
    }
    return '待投递：0 份'
  }
  const tail = reachability === 'ledger-unreachable'
    ? '（⚠ 本条来自**够不到账本**这一次读取）'
    : reachability === 'unreadable'
      ? '（⚠ 本条来自**运行态读不了**这一次读取）'
      : ''
  return (manual > 0
    ? `⚠ 待投递：${handoffs.length} 份（其中 ${manual} 份已标注为人工转达）`
    : `⚠ 待投递：${handoffs.length} 份`) + tail
}
