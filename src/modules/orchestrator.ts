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
import { resolveLedgerRoot } from '../server/doc-read.ts'
import {
  ORCH_STATE_FILENAME,
  ORCH_STATE_SUBDIR,
  clearHandoffs,
  ensureRuntimeIgnored,
  markLost,
  orchStateFileOf,
  readOrchState,
  writePending,
  type PersistedHandoff,
  type PersistedWatch,
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
}

/** `hobOrchestrator` 服务的形状。 */
export interface HobOrchestrator {
  readonly version: number
  /** 登记一次派发并投递（**唯一的进入闭环入口**）。 */
  dispatch(
    target: string,
    message: string,
    opts: { self: string | undefined; round?: number; task?: string; mode?: 'followup' | 'steer' },
  ): Promise<{ ok: boolean; sessionId?: string; messageId?: string; reason?: string; watching?: boolean }>
  /** 读状态。 */
  status(): OrchStatus
  /** 停 / 恢复。 */
  control(action: 'stop' | 'resume'): OrchStatus
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
 *   只能按 `ledgerHome` 扫一层 `<ledgerHome>/*​/runtime/orch-watches.json`。
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
    // 重载后接手：把**上一代**留下的未结算派发判为"丢失"
    // ══════════════════════════════════════════════════════════════════
    // ⚠ 此刻 `watches` 一定是**空的**（本回调刚建它）⇒ 落盘里任何 `pending`
    //   都是**上一代**留下的（见 `markLost` 的 `known` 判据注释）。
    // ⚠ 这一段**不写 watches**：只记账 + 报告。理由（为什么"不自动续上"）
    //   写在本文件顶部的修复段注释里 —— 简言之，`running → idle` 是事件，
    //   目标若在重载前就跑完则永不再来，续上会留一个**永不结算**的 watch。
    let lostLatch: PersistedWatch[] = []
    try {
      for (const file of scanStateFiles(svcCtx)) {
        const r = markLost(file, () => false)
        if (r.lost.length > 0) {
          lostLatch = [...lostLatch, ...r.lost]
          svcCtx.logger?.warn?.(
            `[${name}] 重载后发现 ${r.lost.length} 条未结算派发丢失（${file}）：`
            + r.lost.map((w) => `${w.target}${w.round === undefined ? '' : `(第${w.round}轮)`}`).join(', '),
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
     */
    let lostCount = 0
    /** 重新统计盘上累计丢失（启动时与每次落盘后各跑一次）。 */
    const refreshLostCount = (): void => {
      let total = 0
      try {
        for (const file of scanStateFiles(svcCtx)) total += readOrchState(file).lost.length
      } catch { /* 读不到就当 0；不因诊断用途让模块起不来 */ }
      lostCount = total
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
        }
      },

      status() {
        return {
          stopped,
          watches: [...watches.values()].sort((a, b) => a.at - b.at),
          relaysDone,
          relaysBlocked,
          lostPending: lostCount,
          // ⚠ 现读盘（不缓存）：记账在别的模块做，缓存会滞后 —— 见 `readHandoffs` 注释。
          handoffs: readHandoffs(),
        }
      },

      control(action) {
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
          // ⚠ 与 `status()` 同源同值（两处返回**同一个形状**，调用方不必分情况）。
          handoffs: readHandoffs(),
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

/** 取本会话 id（= 调工具的 agent 自己）。 */
function selfSessionIdOf(exec: any): string | undefined {
  const id = exec?.agent?.id ?? exec?.agent?.session?.id
  return typeof id === 'string' && id !== '' ? id : undefined
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
      '**派活并登记回传**：把指令投递给指定会话，并让系统在**它这一轮跑完后自动把结果送回来给你**。'
      + '这是闭环的入口 —— 与 `hob_send` 的区别是：`hob_send` 投完就完了（结果不会回来），'
      + '`hob_dispatch` 会**等它跑完再叫醒你**，把「它的结论 + 它改动的文件」回传给你。'
      + '⚠ 回传只是"对方说它做了什么"，**不是验收**；下一步续用还是新建，由你自己判断。'
      + '⚠ 停了（hob_orch_control stop）之后本工具直接拒绝。',
    parameters: {
      sessionId: {
        type: 'string',
        required: true,
        description: '目标会话 id（取自 hob_sessions；要用新会话就先 hob_spawn）。',
      },
      message: {
        type: 'string',
        required: true,
        description: '要派的事。落地时先读你要它读的文件再执行，勿把整篇正文塞在这里。',
      },
      round: { type: 'number', description: '这是第几轮（你自己数，回传时会带回来便于对号）。' },
      task: { type: 'string', description: '一句话说明这一轮派的是什么（回传时会带回来）。' },
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
        note2: 'Dispatched only: the work is not done. You will be woken with its result; '
          + 'until then do not claim anything was carried out.',
      })
    },
  })

  const statusTool = defineTool({
    name: 'hob_orch_status',
    description:
      '看编排状态：是否已停、正在等哪些会话回传、已经回传过几次、被停闸拦下几次。'
      + '⚠ 这些是**你的记录**（谁派给谁），不是对方会话的进度；对方的具体进展要看它的会话。',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(): Promise<string> {
      const s = orch.status()
      const lines = s.watches.map((w) => '- ' + [
        `target=${w.target}`,
        `watcher=${w.watcher || '(无)'}`,
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
      return [
        s.stopped ? '⏸ 已停（不回传、不接受新派发）' : '▶ 在跑',
        `在等回传：${s.watches.length} 个`,
        ...lines,
        `已回传：${s.relaysDone} 次 · 被停闸拦下：${s.relaysBlocked} 次`,
        // ── ⚠ 以下是**本批新增的行**（原有行一字未改、未删）─────────────
        //   它们存在的唯一理由：宿主重载会把内存里的 watch 抹掉，
        //   没有这两行，重载后的读数与"从来没派过"**完全一样**。
        ...(s.lostPending === 0
          ? []
          : [
            `⚠ 重载丢失：${s.lostPending} 条派发因宿主重载而丢失（插件重新就绪时判出）`,
            '  ↳ 它们**已经不在等**：`running → idle` 是事件而非可轮询状态，'
            + '目标若在重载前就跑完，那条事件永不再来。',
            '  ↳ 需要结果就**重新派一次**（`hob_dispatch`），或直接去那个会话问/看它的记录。',
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
            `⚠ 待投递：${s.handoffs.length} 份 ——`,
            ...hh,
            '  ↳ 这些是**已写出、但还没投出去**的（写了交接文件 / 建了会话）。',
            '  ↳ **若本轮打算人工转达可忽略；否则说明漏了投递** —— '
            + '用 `hob_dispatch` / `hob_send` 投出去，或明确告知用户需手工转达。',
          ]),
      ].join('\n')
    },
  })

  const controlTool = defineTool({
    name: 'hob_orch_control',
    description:
      '停 / 恢复编排的自动回传。**这是刹车**：`stop` 之后对方跑完**不会再叫醒你**，'
      + '且 `hob_dispatch` 会被拒绝；`resume` 重新打开。'
      + '⚠ 用户随时可以要求你停 —— 用户的要求优先于你"还想继续推进"的判断。',
    parameters: {
      action: { type: 'string', required: true, enum: ['stop', 'resume'], description: 'stop=停；resume=恢复。' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: { action: 'stop' | 'resume' }): Promise<string> {
      if (args?.action !== 'stop' && args?.action !== 'resume') {
        return JSON.stringify({ ok: false, reason: "action must be 'stop' or 'resume'" })
      }
      const s = orch.control(args.action)
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
