/**
 * 看板卡的「跑完」信号面 —— 把**看板自己推的 SSE** 变成**一次叫醒**。
 *
 * ══ 它解决什么（缺口有实测出处）════════════════════════════════════════════
 *   2026-10-18 实测：长活对照卡 `t-mvdxkqhz-ebn8hu` 于 22:59:20 正常收工
 *   （`in_review` · 心跳 20/20），**Hob 没有被叫醒** —— 是**用户先看见**、
 *   Hob 才去读卡片的。对照：Hob 自己 `hob_dispatch` 派的活跑完**会**回传
 *   （`orchestrator.ts` 的 `running → idle` 跳变），**看板卡不属于那条链**：
 *   卡的执行会话是**看板服务**起的，不在 `watches` 里，所以回传通道根本不知道有这张卡。
 *
 * ══ ⚠ 先说清「信号在哪」（可行性判定的落点 · 不进代码就是猜）════════════════
 *   **结论：属于 (甲) —— 有信号、只是本仓没接。** 证据（第三方包，只读不改）：
 *   · `dsh-taskboard/lib/shared/api.js` 声明 `SSE_PATH = "/dsh-taskboard/events"`；
 *   · `lib/host/routes.js` 的 `broadcast()` 在**每次台账提交**时推
 *     `event: change` + `{ revision, kind, tasks }`（`tasks` 走 `summarize()`，
 *     带 `status` / `lastExecutionOutcome` / `blocked`）；
 *   · `lib/host/execution.js` 里执行落定全部走 `store.mutate("execution-recorded", …)`
 *     ⇒ 落定那一刻**必有**一帧。
 *   ⚠ **宿主事件总线里没有这个信号**：`grep -rn "ctx\.emit\|\.emit(" lib/index.js lib/host/*.js`
 *     在 `dsh-taskboard` 包内 **0 命中** ⇒ 只能接 HTTP/SSE，接不了 `ctx.on(...)`。
 *
 * ══ 为什么**不用轮询**（虽然技术上可行）════════════════════════════════════
 *   轮询要定周期（"多久一次"直接决定漏与延迟），且每次要读全表（实测 `/state`
 *   一次 ~365 张卡 / 全量 JSON）⇒ 代价与"漏多少"都难以说清。SSE 是**推送**，
 *   帧里**已经带着** `kind` 与 `status` ⇒ 不需要猜周期、不需要读全表。
 *
 * ══ ⚠ ⚠ 2026-10-19 降级（`TASK-2` 改判）：本类的信号面现在是**旁证通道**═════════
 *   用户原话：「看板执行完任务之后会移动到待验收区域，你不要让看板告诉你这是不可能的，
 *     你需要自己对派出去的实施会话状态变化检查去检测，而且看板是其他的插件，
 *     你需要自己直接去检测实施会话的状态变化」
 *   ⇒ **主信号源 = 实施会话的 `running → idle`**（见本文件下半的 {@link DispatchWake}）；
 *     本类（看板 SSE）**降为旁证**：卡进 `in_review` 可能**晚于**会话状态、
 *     也可能**一张卡没有对应会话** ⇒ ⛔ **不许当唯一判据**。
 *   ⚠ 保留它的理由：旁证能覆盖"看板自己起的会话没进 `agent/status`"这种情形，
 *     且读数分开报（两档互不冒充）。
 *
 * ══ 三条硬约束（作业书 §一-2 · 改判后仍成立）════════════════════════════════
 *   ① **叫醒面 = 显示面**：只有卡落在 `workspaceId === 本工作区` 时才叫
 *      （`readCards()` 用的正是这个过滤）⇒ ⛔ 不会出现"叫醒说有卡跑完、状态行里看不到它"。
 *   ② **一次跑完只叫一次**：按 **`executionId`** 去重（⚠ 不是按卡 id —— 同一张卡重跑
 *      是**另一次**需要叫的跑完）；去重表有上限，防内存无界增长。
 *   ③ **失败必须可观测**：连不上 / 流断 / 解析坏 / 判不不出工作区 / 没有订阅者
 *      ⇒ **各有一条可读话**，⛔ 不许静默当"没有卡在跑"。
 *
 * ══ ⚠ 它**不**做什么 ══════════════════════════════════════════════════════
 *   ⛔ 不改看板一个字节（第三方插件，`UD-82`）；⛔ 不新增面向模型的工具名；
 *   ⛔ 不碰 `watches` 的恢复逻辑（那是"重挂"另一笔账）；⛔ 不读 `~/.dsh/dsh-taskboard.json`
 *   （第二数据源 —— 见 `board-cards.ts` 文件头那条同款纪律）。
 */

/** 看板 SSE 的路径（= 第三方插件 `shared/api.js` 的 `SSE_PATH`，⚠ 不是本仓自造）。 */
export const BOARD_SSE_PATH = '/dsh-taskboard/events'

/** 看板在"执行记录落定"时提交台账用的 mutation kind（第三方包的既有取值）。 */
export const EXECUTION_KINDS: readonly string[] = ['execution-recorded']

/**
 * 一条「卡跑完」的信号。
 *
 * ⚠ 它**只承载从 SSE 帧里真的读到的字段** —— 读不到的**不填**（⛔ 不编造默认值）。
 */
export interface CardDoneEvent {
  /** 卡 id。 */
  taskId: string
  /** 一句话标题（截断）。 */
  title: string
  /** 那次执行的 id —— **去重键**（同一张卡重跑 ⇒ 新的 executionId ⇒ 会再叫一次）。 */
  executionId: string
  /** 执行结果（`succeeded` / `failed` / `cancelled`）。 */
  outcome: string
  /** 卡当前状态字（原样转发）。 */
  status: string
  /**
   * 这张卡**属于哪个看板项目**（= 帧里的 `workspaceId`，认卡那一刻已经校验过）。
   *
   * ⚠ ⚠ **它现在只用来"指认这张卡是哪个项目的"**（可读话点名 / 诊断），
   *   ⛔ **不再是投递的判据**（2026-10-19 收单第一轮 · `I-9` 改判）：
   *   改前投递收件人由"订阅者自己报的项目"决定 ⇒ ① 同一工作区里两个会话**都**会收到
   *   同一张卡（= 用户点名的"包括同一个工作区"那一半）；② 一条卡跑完会**扇出**给多人。
   *   ⇒ 现在投递只认 {@link CardDoneEvent.owner}，且**只投一个**。
   *   ⛔ 也⛔ 不复用 `opts.workspaceIdOf()`：那是**进程级单值**，正是 2026-10-19 越界的成因。
   */
  workspaceId: string
  /**
   * ⚠⚠ **这条"卡跑完"记录自己的 owner**（= 该卡的 `createdBy.sessionId` = **派这张卡的那个会话**）。
   *
   * ⚠ **它就是收件人**（{@link CardWake.handleFrame} 只投给它**一个**，⛔ 不扇出）：
   *   一张看板卡是**某个会话**建/派出来的（`hob_dispatch` 的调用方，或用户在某个会话里建卡）
   *   ⇒ 回执只该回到**那个会话**，⛔ 不是"本工作区所有看过卡面的会话"。
   * ⚠ **判不出 ⇒ 不填**（`undefined`）⇒ 投递侧落**独立一档**"没有 owner ⇒ 不投"，
   *   ⛔ **绝不**退化成"投给最后一个摸过状态的人"，⛔ 也不退化成"按工作区广播"。
   */
  owner?: string
  /**
   * 该 owner 所属的**工作区根**（可读话点名用；判不出 ⇒ 不填）。
   * ⚠ ⛔ 不许拿"本帧的 `workspaceId`"顶替 —— 那是**看板项目 id**，不是**会话的工作区根**。
   */
  ownerWsRoot?: string
  /** 这个信号被认出的时刻（毫秒）。 */
  at: number
}

/** 叫醒面的运行态 —— 供 `hob_orch_status` 渲染（⛔ 不许把"没连上"当成"没卡在跑"）。 */
export interface WakeState {
  /** 连接状态。 */
  conn: 'idle' | 'connecting' | 'live' | 'broken'
  /** 连的是哪个 URL（排错时要能指认）。 */
  url?: string
  /** **可读的**当前状态话（⛔ 不是状态字）。 */
  note?: string
  /** 已经叫醒过几次（累计 · 本次进程内）。 */
  wokeCount: number
  /** 最近一次叫醒的时刻（毫秒）。 */
  lastWokeAt?: number
  /** 最近一次叫醒的是哪张卡。 */
  lastWokeCard?: string
  /** 连着但**没有订阅者**时也会叫不出去 ⇒ 单独记一档。 */
  noSubscriberCount: number
  /**
   * ⚠⚠ **"没有 fallback 退回路径"的独立一档**（2026-10-19 收单第一轮 · `I-7` **改判**）。
   *
   * ── 改前是什么（这一档原叫"按旧语义投出去的次数"）──────────────────────
   *   订阅者没报项目时，退回 `opts.workspaceIdOf()`（**进程级单值**）判它该不该收
   *   ⇒ 那是一条**已知会越界**的退回路径。本项目当时的处理是"照投，但记一档、留可读话"。
   *
   * ── 现在是什么（作业书 §2 `I-7` 明令：**删掉**那条退回路径）──────────────
   *   **一条卡跑完 ⇒ 收件人只能是该卡的 `owner`，且只投一次**（`I-9`）。
   *   判不出 `owner`（或订阅者没报项目 / 报的项目不匹配 owner 的工作区）⇒ **不投**，
   *   并把这一声记进**本档** + 落一句可读话。
   *
   * ⚠ ⚠ **键名保留、语义按 `I-7` 改判**（作业书要求"既有 N 组机检里依赖它的断言
   *   改为断言『没有退回路径』"）：数值 > 0 ⇒ **有过"判不出 owner 所以没投"的卡跑完**，
   *   ⛔ **不再意味着"按全局单值投出去了一声"**。
   * ⚠ ⛔ 不许并进 `noSubscriberCount`（那是"一个订阅者都没有"或"都不是 owner 的面"）。
   */
  legacyTargetCount: number
  /**
   * ⚠⚠ **漏投的次数**（`I-10`：错投 ≡ 漏投，必须同档可观测）。
   *
   * 一条"卡跑完"信号**已经定出唯一收件人**（= 该记录的 `owner`）但**投递抛错** ⇒ 记这一档。
   * ⚠ 它**必须能被 owner 自己的读数看见**（"我有一条回执没到"），⛔ 不许静默消失。
   * ⚠ ⛔ 与 `legacyTargetCount`（判不出 owner ⇒ 不投）**是两回事，⛔ 不许合并计数**：
   *   一个说"不知道给谁"，一个说"知道给谁但没送到"。owner 也查不出前者（那不是它的记录）。
   */
  undeliveredCount: number
  /** 最近一次漏投的收件人（诊断：点名"本该给谁"）。 */
  lastUndeliveredTo?: string
  /**
   * ⚠⚠ **补投成功的次数**（2026-10-19 · 显式补投 `redeliver()` 的独立一档）。
   *
   * ── 它为什么必须单开一档（⛔ 不许并进任何既有计数）──────────────────────
   *   · 并进 `wokeCount` ⇒ 读数会把"**正常叫醒**"说多（用户会以为今晚多叫了几个人）；
   *   · 并进 `legacyTargetCount` ⇒ 那一档的语义是"**判不出 owner ⇒ 不投**"，
   *     与"投出去了"正好相反；
   *   · 并进 `undeliveredCount` ⇒ 那一档是"**知道给谁但没送到**"，
   *     与"补投成功"也是相反的两件事。
   *   ⇒ 本项目纪律：**"不许把两种原因说成同一句话"** ⇒ 新原因就新开一档。
   *
   * ⚠ 计数口径：**按"真的发出了一份额外回执"计**（不是按调用次数）——
   *   同一条补两次只有第一次算（见 {@link CardWake.redeliver} 的去重）。
   */
  redeliveredCount: number
  /** 最近一次补投的收件人（诊断：点名"补给了谁"）。 */
  lastRedeliveredTo?: string
  /** 去重表里记了多少条（诊断用，防"表悄悄涨"）。 */
  seenCount: number
}

/**
 * 一个"在看卡面"的订阅者。
 *
 * ⚠ ⚠ **订阅表不再是投递名单**（2026-10-19 收单第一轮 · `I-9`）：
 *   改前"谁该收到"由这张表决定（按每个订阅者自己报的项目筛）⇒
 *   ① 一条卡跑完会**扇出**给同一项目的所有人；② 同一工作区里两个会话**都**收得到
 *   （用户点名的"包括同一个工作区"那一半）。
 *   ⇒ 现在**收件人只由该记录自己的 `owner` 决定**（{@link CardDoneEvent.owner}），
 *     这张表的唯一用途退化为：**判断"owner 到底在不在看这个面"**（诊断 / 可读话），
 *     以及"有没有人订阅"那两档既有读数。
 */
export interface WakeTarget {
  /** 收件会话 id。 */
  sessionId: string
  /**
   * **这个订阅者自己所属的看板项目**（= 它 `hob_orch_status` 读卡面时那个 `workspaceId`）。
   *
   * ⚠ **每个订阅者各一份**（⛔ 不再复用 `opts.workspaceIdOf()` 这个进程级单值）。
   * ⚠ ⚠ **它已不是投递判据**（见本接口顶部注释）：判"该不该投给这个会话"只看
   *   该条记录的 `owner`。本字段现在只用于**可读话/诊断**（"这个订阅者属哪个项目"）。
   * ⚠ `undefined` = 该订阅**没报项目**（旧调用 / 判不出）。
   */
  workspaceId?: string
  /** 它从什么时候开始"在看这个面"（毫秒）—— 用于诊断 `noSubscriber`。 */
  since: number
}

/** {@link CardWake} 的构造参数（⚠ 显式类型：别用构造参数属性，见该类注释）。 */
export interface CardWakeOpts {
  /**
   * 看板 origin（如 `http://127.0.0.1:3080`）；判不出 ⇒ `start()` 报不可读。
   *
   * ⚠ ⚠ **可以是函数，且真环境必须给函数**（2026-10-19 重启实测）：
   *   `webServer` 可能在**本模块激活之后**才 bind（`getOrigin()` 早读会抛；
   *   宿主起 web 服务与插件激活之间没有顺序保证 —— `.hob/experience/1.md` 的 **E-01**）。
   *   ⇒ 若在这里**只给一个字符串**，那它在 `apply()` 那一刻就被**快照**了：
   *     那一刻取不到 ⇒ **永远是 undefined** ⇒ 叫醒面**永久**「接不上」，且**不会自愈**
   *     （实测：重启后 12:36 / 12:37 / 12:45 三次读数都是同一句「拿不到看板地址」）。
   *   ⇒ 给函数 ⇒ 每次 `start()` **现取**：宿主一就绪，下一次读状态就能接上。
   */
  origin: string | undefined | (() => string | undefined)
  /** 现读本工作区 id（⚠ 每次现读：工作区可能后建）。 */
  workspaceIdOf: () => string | undefined
  /** 投递实现（真环境 = `bus.deliver(id, text, 'followup')`）。 */
  deliver?: (sessionId: string, text: string) => Promise<unknown>
  /** 现取时刻（测试可固定）。 */
  now?: () => number
  /** 可读日志出口（⛔ 不许静默）。 */
  log?: (line: string) => void
  /**
   * **点火帧回调**（2026-10-19 · 补"不许依赖事先读卡面"那个缺口）。
   *
   * ⚠ 每认出一张**正在开跑的卡**就调一次（`cardFiringEventsOf`）。
   *   M5 用它去**按卡 id 现读** `executionSessionId` 并登记 ——
   *   ⇒ 登记发生在**开跑那一刻**，而不是"某人读过卡面之后"。
   * ⚠ 回调是**副作用**：不 await、抛错不外溢（失败要可读，但⛔ 不许打断 SSE 循环）。
   *
   * ⚠⚠ **第二个参数是"当前在看这个面的订阅者"快照**（`I-2`）——
   *   回调**必须**用它判归属，⛔ **不许**回头去读任何进程级单值
   *   （那正是"回执跑到别的 Hob"的成因）。给的是**快照数组**、不是"最后一个人"：
   *   ⛔ 不许把"谁最后订阅过"当成归属。
   */
  onFiring?: (e: CardFiringEvent, subscribers: WakeTarget[]) => void
}

/** 去重表的**上限**（超过就丢最旧的 —— 丢的是很久以前那次，不影响"这次"）。 */
const SEEN_LIMIT = 512

/** 重连退避的起步与上限（毫秒）。 */
const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 30000

/**
 * 把一条 SSE `change` 帧认成「卡跑完」事件。
 *
 * ⚠ **判据（刻意写死、可被机检钉住）**：
 *   ① `kind` 属于 `EXECUTION_KINDS`（= 执行记录落定那次提交）；
 *   ② 该卡的**最后一次执行**已落定（`lastExecutionOutcome` 是 `succeeded`/`failed`/`cancelled`，
 *      ⛔ 不是 `running`）；
 *   ③ 该卡属于**本工作区**（`workspaceId` 相同；本工作区判不出 ⇒ **不认**，由上层报可读话）。
 *   ⚠ 只认 ① 不认 ② 会在"开跑"那一帧就叫（`execution-recorded` 也用于点火）—— 那是**假叫醒**。
 *
 * @param frame - 已经 `JSON.parse` 过的 `data:` 负载（形状不认识 ⇒ 返回空数组）。
 * @param workspaceId - 本会话所在工作区 id（`undefined` ⇒ **不认任何卡**）。
 * @returns 认出来的事件（一帧可能带多张卡）。
 */
export function cardDoneEventsOf(frame: unknown, workspaceId: string | undefined): CardDoneEvent[] {
  if (workspaceId === undefined || workspaceId === '') return []
  if (frame === null || typeof frame !== 'object') return []
  const f = frame as { kind?: unknown; tasks?: unknown }
  if (typeof f.kind !== 'string' || !EXECUTION_KINDS.includes(f.kind)) return []
  if (!Array.isArray(f.tasks)) return []
  const out: CardDoneEvent[] = []
  for (const raw of f.tasks) {
    if (raw === null || typeof raw !== 'object') continue
    const t = raw as Record<string, unknown>
    // ③ 叫醒面 = 显示面（⚠ 严格相等；判不出/别的项目 ⇒ 不认）
    if (t.workspaceId !== workspaceId) continue
    const id = typeof t.id === 'string' && t.id !== '' ? t.id : undefined
    if (id === undefined) continue
    // ② 最后一次执行必须**已落定**
    const outcome = typeof t.lastExecutionOutcome === 'string' ? t.lastExecutionOutcome : undefined
    if (outcome === undefined || outcome === 'running') continue
    // 🔑 去重键 = 那次执行的 id。⚠ 摘要里没有 `executions` ⇒ 用 `(卡 id, outcome, version)`
    //    拼一个稳定键：同一张卡的**同一次**落定只会产生一帧相同的 (outcome, version)；
    //    重跑会 bump version ⇒ 键变了 ⇒ **会再叫一次**（那正是我们要的）。
    const version = typeof t.version === 'number' && Number.isFinite(t.version) ? t.version : undefined
    const executionId = version === undefined ? `${id}@${outcome}` : `${id}@${outcome}@v${version}`
    const title = typeof t.title === 'string' && t.title !== '' ? t.title : '(无标题)'
    const status = typeof t.status === 'string' && t.status !== '' ? t.status : '(读不到)'
    /**
     * ⚠⚠ **owner = 谁建的这张卡**（`I-1`：没有 owner 的记录不许猜）。
     *
     * 读法：帧里的 `createdBy.sessionId`（看板 `TaskRecord.createdBy` 的原样投影）。
     * ⚠ **读不到就⛔ 不填**（`undefined`）⇒ 投递侧落"判不出 owner ⇒ 不投"那一档。
     *   ⛔ 不许退回 `watch` 的订阅者、⛔ 不许退回全局工作区、⛔ 不许猜。
     */
    const createdBy = t.createdBy !== null && typeof t.createdBy === 'object'
      ? (t.createdBy as Record<string, unknown>)
      : undefined
    const owner = typeof createdBy?.sessionId === 'string' && createdBy.sessionId !== ''
      ? createdBy.sessionId
      : undefined
    /**
     * ⚠ `createdBy.workspaceRoot` 只在**看板真的记了**的时候才有意义（本项目不编造它）。
     * 读不到 ⇒ 不填；渲染层据此显示"(工作区根读不到)"，⛔ 不拿 `workspaceId` 顶替。
     */
    const ownerWsRoot = typeof createdBy?.workspaceRoot === 'string' && createdBy.workspaceRoot !== ''
      ? createdBy.workspaceRoot
      : undefined
    out.push({
      taskId: id,
      title: title.length > 60 ? `${title.slice(0, 60)}…` : title,
      executionId,
      outcome,
      status,
      // ⚠ 归属：`workspaceId` 只用于**指认这张卡属于哪个项目**（⛔ 不再是投递判据）。
      workspaceId,
      // 🔑 收件人：这条记录自己的 owner（⛔ 不读进程级单值、⛔ 不按订阅表广播）
      ...(owner === undefined ? {} : { owner }),
      ...(ownerWsRoot === undefined ? {} : { ownerWsRoot }),
      at: Date.now(),
    })
  }
  return out
}

/** 把一条事件渲染成**叫醒话**（给人/给模型读的一段，不是裸 JSON）。 */
export function wakeMessageOf(e: CardDoneEvent): string {
  return `[看板卡跑完] ${e.taskId}「${e.title}」的执行已结束（结果：${e.outcome} · 卡状态：${e.status}）。`
    + '\n这是**看板卡**，不是 `hob_dispatch` 派的活 ⇒ 它没有回传正文。'
    + `\n下一步：用 \`taskboard_get\` 读这张卡的执行报告与评论（卡 id = ${e.taskId}），`
    + '确认后由用户决定是否置 done。'
}

/**
 * 「卡跑完」叫醒面。
 *
 * ⚠ **它是纯对象、不自己起线程**：连接由 `start()` 显式拉起，`stop()` 拆掉
 *   ⇒ 便于机检用**假 SSE** 喂真逻辑（不起真网络）。
 */
export class CardWake {
  private wsId: string | undefined
  private readonly targets = new Map<string, WakeTarget>()
  private readonly seenIds = new Map<string, number>()
  /**
   * ⚠⚠ **"已投"台账**（`I-9` 的"先写后发"落点）：`executionId -> 收件人`。
   *
   * ⚠ 为什么必须单独一张表（而不是复用 `seenIds`）：`seenIds` 回答的是
   *   "**这条信号见过没有**"，本表回答的是"**这条信号投给谁了**"。
   *   ⚠ 两者在正常路径上同步增长，但**投递抛错**时会出现"见过、却没投成"——
   *   那一档必须与"投成了"分开（`undeliveredCount`），⛔ 不许合成一个计数。
   * ⚠ **先写后发**：`markDelivered()` 在**调用 `deliverFn` 之前**就落这一条
   *   ⇒ 即使投递抛错、甚至进程在此期间被重载，也不可能对同一次执行**再发一份**。
   */
  private readonly delivered = new Map<string, string>()
  /**
   * ⚠⚠ **补投台账**：键 = `` `${executionId}\u0000${to}` ``。
   *
   * ⚠ 为什么**独立一张表**、⛔ 不复用 {@link delivered}：
   *   `delivered` 回答"**这条信号正常投过没有**"，本表回答"**这条我补投过没有**"。
   *   混用会产生两个方向的错：补投把主台账写上 ⇒ 正常路径误判"已投过"而**漏投**；
   *   反之则可能**重复补**。
   * ⚠ 上限与 `seenIds` 同款（丢最旧），⛔ 不让它无限涨。
   */
  private readonly redelivered = new Map<string, true>()
  private state: WakeState = {
    conn: 'idle', wokeCount: 0, noSubscriberCount: 0, legacyTargetCount: 0, undeliveredCount: 0, redeliveredCount: 0, seenCount: 0,
  }
  private abort: AbortController | undefined
  private stopped = false
  /**
   * 重连主循环**还在不在跑**（⚠ 与 `conn` 不是一回事）。
   *
   * ⚠ 为什么必须单独记：`conn` 在**两次重试之间**就是 `'broken'`，而那时
   *   `loop()` **并没有退出**。若只看 `conn` 决定"要不要再起一条"，
   *   `hob_orch_status` 每读一次就会**再开一条 SSE 长连接**
   *   ⇒ 看板那边看到 N 条订阅、本进程这边 N 个重连循环。
   *   ⚠ 这个错在修复「地址现取」之后**更容易被踩到**（地址一就绪就会被反复 start），
   *     故一并把它关掉：**已经在循环里 ⇒ 一律不起第二条**。
   */
  private looping = false
  /** 已处理过的点火帧（按 `卡id@时刻桶` 去重 —— ⚠ 同一帧只回调一次，防登记风暴）。 */
  private readonly firedSeen = new Set<string>()
  /** 注入的"投递"函数（真环境 = `hobBus.deliver`；机检 = 假函数）。 */
  private deliverFn: ((sessionId: string, text: string) => Promise<unknown>) | undefined

  /**
   * ⚠ **不用 TS 的构造函数参数属性**（`constructor(private readonly opts: …)`）：
   *   本仓的机检用 Node 的 **strip-only 类型剥离**直接 `import` `.ts`
   *   ⇒ **参数属性是语法级特性**，strip-only 会当场抛
   *   `TypeScript parameter property is not supported in strip-only mode`
   *   （实测：加上它之后 `check:orch` 的 I/J/K/L 四组整组失去基准）。
   *   ⇒ 显式声明字段 + 在构造体里赋值。
   */
  private readonly opts: CardWakeOpts

  constructor(opts: CardWakeOpts) {
    this.opts = opts
    this.deliverFn = opts.deliver
  }

  /** 现读状态（渲染层只认这个）。 */
  snapshot(): WakeState {
    return { ...this.state, seenCount: this.seenIds.size }
  }

  /**
   * 登记"这个会话在看**它自己那个项目**的卡面"（由 `hob_orch_status` 每次调用时登记）。
   *
   * @param sessionId - 收件会话。
   * @param workspaceId - **该会话自己**的看板项目 id（⚠ 每次订阅现传，⛔ 不许用进程级单值）。
   *   传 `undefined` ⇒ 退回 `opts.workspaceIdOf()`（旧语义；判不出 ⇒ 不叫）。
   * ⚠ 已订阅过 ⇒ **刷新**它的 `workspaceId`（会话换项目 / 工作区后建都要跟上），
   *   但**不重置**叫醒计数之外的任何状态 —— 这里本来也不存状态。
   */
  subscribe(sessionId: string, workspaceId?: string): void {
    if (typeof sessionId !== 'string' || sessionId === '') return
    const have = this.targets.get(sessionId)
    const next = typeof workspaceId === 'string' && workspaceId !== '' ? workspaceId : undefined
    if (have === undefined) {
      this.targets.set(sessionId, {
        sessionId,
        ...(next === undefined ? {} : { workspaceId: next }),
        since: this.now(),
      })
      return
    }
    if (next !== undefined) have.workspaceId = next
  }

  /**
   * 按需拉起 SSE（⚠ 幂等：已在连/已连上/已在重试 ⇒ 都**不会**起第二条）。
   *
   * ⚠ **为什么"订阅时才连"而不是模块加载就 connect**：没有订阅者时连上也叫不动
   *   （见 `handleFrame` 的 `noSubscriberCount` 一档），白占一条长连接；
   *   而且本仓的 `webServer` 可能在模块激活之后才 bind（`getOrigin()` 早读会抛）。
   *
   * ⚠ ⚠ **"判不出地址"这一档必须能重试**（2026-10-19 重启实测的缺陷）：
   *   改前只看 `conn === live / connecting` 就 return ⇒ 地址取不到那一刻落 `broken`
   *   ⇒ 之后**每次都 early-return** ⇒ **永久接不上**（实测三次读数都一样）。
   *   ⇒ 现在用 `looping` 判"真的还有循环在跑吗"：没有 ⇒ 重新 `start()`
   *     （`start()` 会**现取**地址 —— 这就是重启后自愈的那一步）。
   */
  startWakeIfNeeded(fetcher: typeof fetch = fetch): void {
    if (this.stopped) return
    if (this.looping) return                              // 已经有循环在跑（连接中/重试中都算）
    if (this.state.conn === 'live') return                // 已连上（`looping` 之外的双保险）
    this.start(fetcher)
  }

  /** 摘掉一个订阅（会话结束 / 用户不要了）。 */
  unsubscribe(sessionId: string): void {
    this.targets.delete(sessionId)
  }

  /** 现看订阅者（诊断/测试用）。 */
  subscribers(): WakeTarget[] {
    return [...this.targets.values()]
  }

  /** 接上投递实现（`hobBus` 可能晚于本对象就绪 ⇒ 允许后补）。 */
  setDeliver(fn: ((sessionId: string, text: string) => Promise<unknown>) | undefined): void {
    this.deliverFn = fn
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now()
  }

  private say(line: string): void {
    this.opts.log?.(line)
  }

  /**
   * 处理**一帧**（真 SSE 与机检共用这一个入口 —— ⚠ 机检不重实现判据）。
   *
   * @param kind - SSE 的 `event:` 名（`hello` / `change`）。
   * @param data - 该帧 `data:` 的 **JSON 字符串**（解析失败要可读）。
   * @returns 本次真的叫醒了几次（0 = 没有该叫的）。
   */
  async handleFrame(kind: string, data: string): Promise<number> {
    if (kind !== 'change') return 0
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch (e) {
      this.state = { ...this.state, note: `⚠ 收到一帧但解析不了（${String((e as Error)?.message ?? e)}）⇒ 这次跳过（⛔ 不等于"没有卡跑完"）` }
      this.say(`[card-wake] ${this.state.note}`)
      return 0
    }
    // ⚠ 工作区**每次现读**：工作区可能后建 / 会话可能换
    const wsId = this.opts.workspaceIdOf()
    this.wsId = wsId
    if (wsId === undefined) {
      this.state = { ...this.state, note: '⚠ 判不出本会话的工作区 ⇒ **不叫**（⛔ 不猜一个 id 去过滤，那会叫错面）' }
      this.say(`[card-wake] ${this.state.note}`)
      return 0
    }
    /**
     * ⚠ ⚠ **先处理点火帧**（2026-10-19 · 补缺口）：
     *   点火那一帧**也带卡 id** ⇒ 从推送里认卡、回调出去让对方**按卡现读会话 id** 并登记。
     *   ⚠ 顺序有意义：点火帧在**落定帧之前**到达，先登记才可能在落定时叫得出来。
     * ⚠ 同一帧去重（`firedSeen`）—— 看板重连会补发/重发，⛔ 不许因此把登记做成风暴。
     */
    if (typeof this.opts.onFiring === 'function') {
      for (const e of cardFiringEventsOf(parsed, wsId)) {
        const key = `${e.taskId}@${Math.floor(e.at / 1000)}`
        if (this.firedSeen.has(key)) continue
        this.firedSeen.add(key)
        if (this.firedSeen.size > SEEN_LIMIT) {
          const first = this.firedSeen.values().next().value
          if (first !== undefined) this.firedSeen.delete(first)
        }
        try { this.opts.onFiring(e, [...this.targets.values()]) } catch (err) {
          this.state = { ...this.state, note: `⚠ 点火帧回调出错（${String((err as Error)?.message ?? err)}）⇒ 那张卡这次**可能没登记上**` }
          this.say(`[card-wake] ${this.state.note}`)
        }
      }
    }
    const events = cardDoneEventsOf(parsed, wsId)
    let woke = 0
    for (const e of events) {
      if (this.seenIds.has(e.executionId)) continue      // ② 同一张卡的同一次落定 ⇒ 不再叫
      this.seenIds.set(e.executionId, e.at)
      this.trimSeen()
      /**
       * ⚠⚠ **"没有订阅者"这一档的判据已改**（2026-10-19 收单第一轮 · `I-9`）：
       *   改前先判 `this.targets.size === 0` 就 `continue` ⇒ 那是在"收件人还没定"之前
       *   就用**订阅表**把这一声丢掉了。而现在的收件人**由记录自己的 owner 决定**
       *   （owner 还没读过卡面 ⇒ 订阅表可能是空的，但它**仍然是**该收的人）
       *   ⇒ 那样短路就会造出**新的漏投**（用户原话："正确的 hob 预设肯定就收不到指令了"）。
       *   ⇒ 本档挪到"**已定出 owner、且订阅表为空**"之后再判（见下面 ② 那段）。
       */
      /**
       * ⚠⚠ **收件人 = 这条记录自己的 `owner`，只投一次**（2026-10-19 收单第一轮 · `I-9`）。
       *
       * ── 改前是什么（用户实测的失败模式，本件的由头）────────────────────────
       *   旧实现按"订阅者各自报的项目"逐个过滤后**扇出**：
       *   `for (const t of [...eligible, ...legacy]) await this.deliverFn(t.sessionId, text)`。
       *   ⇒ ① **同一条信号可能投给多个人**（同一项目里所有订阅过的会话）；
       *      ② 同一工作区里两个 Hob **都**收得到（用户点名的"包括同一个工作区"）；
       *      ③ `legacy` 那条还退回**进程级单值** `opts.workspaceIdOf()` 判该不该投
       *         （已知会越界：`t-mves7vea-5qm7u9` → `customer-service-agent` 的卡落到
       *          `dsh-hob` 的 Hob；`t-mvf32tkr-21yaxt` → `dsh-plugin-roundtable` 的卡同样落到这里）。
       *   ⚠ 用户把后果说得很直白：**「你收到错误的，正确的 hob 预设肯定就收不到指令了」**
       *     ⇒ 错投与漏投是**同一件事的两面**，所以⛔ 不许"多投几个总有一个对"。
       *
       * ── 现在（四条判据，缺一条都算没做）──────────────────────────────────
       *   ① **收件人先定**：`to = e.owner`（该卡的 `createdBy.sessionId`）；判不出 ⇒ **不投**；
       *   ② **只投一次**：本函数对一条信号**至多调用一次** `deliverFn`，⛔ 无循环扇出；
       *   ③ **先写后发**：`delivered` 标记**先落**到内存再发（见 {@link markDelivered}）——
       *      发失败也**不重投**（⛔ 不许"多路都试一遍"的兜底），只落一档"漏投"给 owner 自己看；
       *   ④ **判不出 ⇒ 不投 + 独立可读一档**：记 `legacyTargetCount`（键名保留、语义按
       *      `I-7` 改判为"没有 fallback 退回路径"这一档）+ 点名卡与项目；
       *      ⛔ 绝不改投别人，⛔ 绝不用 `opts.workspaceIdOf()` 兜底。
       *
       * ⚠ **订阅表现在只用于诊断**（"还有没有人订阅" / "owner 在不在看这个面"）——
       *   它⛔ 不再是投递名单（见 {@link WakeTarget} 的接口注释）。
       */
      const rows = [...this.targets.values()]
      // ── ① 收件人**先定**（⛔ 定不出就到此为止，不进投递分支）─────────────────
      const to = e.owner
      if (to === undefined || to === '') {
        /**
         * ⚠ **判不出 owner ⇒ 不投，且必须落独立一档 + 可读话**（`I-2` / `I-7` / `I-9` 三处同款要求）。
         * ⚠ 这一档**不是**"没有卡跑完"、**也不是**"没有订阅者"：
         *   它是"**这张卡确实跑完了，但判不出该回给谁**" ⇒ 单独计数，⛔ 不许并进别的档。
         */
        this.state = {
          ...this.state,
          legacyTargetCount: this.state.legacyTargetCount + 1,
          note: `⚠ 有卡跑完（${e.taskId} · 项目 ${e.workspaceId}）但**判不出它的 owner**`
            + '（这条记录没有 `owner`：旧帧 / 看板没记 `createdBy.sessionId`）⇒ **这一声不投**；'
            + '⛔ 这不是"没有卡跑完"，⛔ 也不是"没有订阅者"，'
            + '⛔ 更**没有**退回"按工作区广播 / 投给最后一个读过状态的人"',
        }
        this.say(`[card-wake] ${this.state.note}`)
        continue
      }
      /**
       * ── ② 订阅前提（诊断用；⛔ 不再是"该不该投"的判据）──────────────────
       * 一个订阅者都没有 ⇒ 走既有 `noSubscriberCount` 那一档（**这条既有档一字不动**）：
       * ⚠ 有人订阅但**owner 本人不在**（例如 owner 还没读过卡面）时**仍然要投** ——
       *   收件人由记录决定，⛔ 不由"谁订阅过"决定；否则就是"漏投"。
       */
      if (rows.length === 0) {
        this.state = {
          ...this.state,
          noSubscriberCount: this.state.noSubscriberCount + 1,
          note: `⚠ 有卡跑完（${e.taskId}）但**没有订阅者** ⇒ 这一声没叫出去`
            + '（没人读过本工作区的卡面；⛔ 这不等于"没有卡跑完"）',
        }
        this.say(`[card-wake] ${this.state.note}`)
        continue
      }
      const text = wakeMessageOf(e)
      // ── ③ **先写后发**：把"已投"标记先落下来（同一 execution 永不再发第二份）────
      this.markDelivered(e.executionId, to)
      // ── ④ 投递：**唯一一次**，⛔ 没有循环、⛔ 没有兜底 ─────────────────────────
      if (this.deliverFn === undefined) {
        this.state = { ...this.state, note: '⚠ 有卡跑完，但**投递通道没就绪**（hobBus 未提供）⇒ 这一声没叫出去' }
        this.say(`[card-wake] ${this.state.note}`)
        continue
      }
      try {
        await this.deliverFn(to, text)
        woke++
        this.state = {
          ...this.state,
          wokeCount: this.state.wokeCount + 1,
          lastWokeAt: this.now(),
          lastWokeCard: e.taskId,
          note: `已叫醒 ${to}（${e.taskId} 跑完 · ${e.outcome}）`
            + '—— 收件人 = 该卡的 owner，**只投一次**',
        }
        this.say(`[card-wake] ${this.state.note}`)
      } catch (err) {
        /**
         * ⚠ **投失败 ⇒ 记一档"漏投"，⛔ 不重投、⛔ 不改投别人**（`I-9` 末条 / `I-10`）。
         * ⚠ 这一档必须能被 **owner 自己的读数**看见："我有一条回执没到"。
         */
        this.state = {
          ...this.state,
          undeliveredCount: this.state.undeliveredCount + 1,
          lastUndeliveredTo: to,
          note: `⚠ 叫醒 ${to} 失败：${String((err as Error)?.message ?? err)}`
            + `（卡 ${e.taskId}）⇒ 这是一条**漏投**：⛔ 不会改投别人，⛔ 也不会自动重投；`
            + '该 owner 读状态时会看到这一档',
        }
        this.say(`[card-wake] ${this.state.note}`)
      }
    }
    return woke
  }

  /**
   * **先写后发**：把"这次执行已经投给谁"落下来（`I-9` 第三条）。
   *
   * ⚠ 必须在 `deliverFn` **之前**调用 —— 这是"一条信号至多投一次"的**唯一保证点**：
   *   若放在投递成功之后，一次抛错就会让下一帧（或下一次重连补发）**再投一遍**，
   *   而那份重复正是用户说的"两份，错的那份占住了"。
   * ⚠ 台账上限与 `seenIds` 同款（丢最旧），⛔ 不让它无限涨。
   */
  private markDelivered(executionId: string, to: string): void {
    this.delivered.set(executionId, to)
    if (this.delivered.size <= SEEN_LIMIT) return
    const sorted = [...this.delivered.entries()]
    for (const [k] of sorted.slice(0, this.delivered.size - SEEN_LIMIT)) this.delivered.delete(k)
  }

  /** 现看"已投台账"（诊断/机检用：证明**同一信号只投一次**）。 */
  deliveredLedger(): Array<{ executionId: string; to: string }> {
    return [...this.delivered.entries()].map(([executionId, to]) => ({ executionId, to }))
  }

  /**
   * ⚠⚠ **显式补投一条"投错人"的回执**（2026-10-19 · 用户原话：「送错的看能不能重新派送到
   * 对应正确的 hob 预设」）。
   *
   * ── 它是"人按的命令"，⛔ 不是自动重试 ──────────────────────────────────
   *   现有投递路径明令「发失败也不重投」（见 {@link handleFrame} 的 ③ 与
   *   {@link markDelivered} 的注释）—— 本方法**不动那个口径**：
   *   它只能由调用方**显式**叫（工具/人会），⛔ 不被挂在任何失败分支上。
   *
   * ── 收件人**只能**由那条记录自己的 `owner` 决定 ────────────────────────
   *   `owner` 由调用方**现读**（该卡的 `createdBy.sessionId`）后传进来；
   *   ⛔ 本方法**不读**任何"当前是谁"的进程级值（`opts.workspaceIdOf()` 之类），
   *   ⛔ 不按订阅者列表扇出，⛔ 不按工作区广播 —— 那正是今晚要治的病。
   *
   * ── 为什么要与"实际投给了谁"对照 ──────────────────────────────────────
   *   `deliveredLedger()`（{@link delivered}）**只记"给了谁"**、⛔ 不记"本该给谁"
   *   ⇒ 光看它判不出哪条是错投的。⇒ 调用方必须把 `owner` 现读进来，
   *   本方法再与台账里的 `actualTo` 比：**相同 ⇒ 没投错，不发**（返回 `noop`）。
   *
   * ── 幂等（`(executionId, to)` 去重）──────────────────────────────────
   *   同一条、同一个人，**无论补几次只发一份**；`redeliveredCount` **只 +1**。
   *   ⚠ 去重键用**独立**一张表（{@link redelivered}），⛔ 不污染 `delivered`
   *   （后者是"正常投递已发过"的台账，混用会让正常路径误判"已投过"而漏投）。
   *
   * ── 判不出 `owner` ⇒ **不补投** + 独立可读话 ────────────────────────────
   *   ⛔ 不许猜、⛔ 不许改投别人。这一档记进 `legacyTargetCount`
   *   （既有语义 = "判不出 owner ⇒ 不投"），措辞点明这是**补投**语境。
   *
   * @param executionId - 那次执行的 id（与 {@link deliveredLedger} `/` 台账同键）。
   * @param owner - **该条记录自己的** `createdBy.sessionId`（⚠ 调用方现读后传入）。
   *   传 `undefined` / 空串 ⇒ 判不出 ⇒ 不补投。
   * @param taskId - 卡 id（只用于可读话点名；判不出可不传）。
   * @returns 结果三态：`redelivered`（真发了一份）/ `noop`（已发过或不需补）/
   *   `refused`（判不出 owner / 通道不可用 / 抛错），并带**可读原因**。
   */
  async redeliver(
    executionId: string,
    owner: string | undefined,
    taskId?: string,
  ): Promise<{ kind: 'redelivered' | 'noop' | 'refused'; reason: string }> {
    const card = taskId === undefined ? '' : `（卡 ${taskId}）`

    // ── ① 判不出 owner ⇒ 不补投 + 独立可读话（⛔ 不许猜、⛔ 不许改投别人）──────
    if (typeof owner !== 'string' || owner === '') {
      this.state = {
        ...this.state,
        legacyTargetCount: this.state.legacyTargetCount + 1,
        note: `⚠ 有一条错投回执**补投不了**${card}：**判不出它该给谁**`
          + '（该卡没有 `createdBy.sessionId`：人工建的卡 / 卡片已被清掉）⇒ **这一份不补**；'
          + '⛔ 这不是"没有卡跑完"，⛔ 也不是"已经补过了"，'
          + '⛔ 更**没有**退回"按工作区广播 / 投给最后一个读过状态的人"',
      }
      this.say(`[card-wake] ${this.state.note}`)
      return { kind: 'refused', reason: String(this.state.note ?? '') }
    }

    // ── ② 与"实际投给了谁"对照：一致 ⇒ 没投错，不发 ─────────────────────────
    const actualTo = this.delivered.get(executionId)
    if (actualTo === owner) {
      return {
        kind: 'noop',
        reason: `这条回执本来就在 ${owner} 手里${card} ⇒ 不是错投，无需补投（未发出任何东西）`,
      }
    }

    // ── ③ 幂等：`(executionId, to)` 已补过 ⇒ 不再发 ─────────────────────────
    const key = `${executionId}\u0000${owner}`
    if (this.redelivered.has(key)) {
      return {
        kind: 'noop',
        reason: `这条已经补给过 ${owner}${card} ⇒ 同一条同一个人**只补一份**（未再发出）`,
      }
    }

    // ── ④ 通道不可用 ⇒ 不假装发出 ────────────────────────────────────────────
    if (this.deliverFn === undefined) {
      return {
        kind: 'refused',
        reason: `补投通道没就绪（hobBus 未提供）⇒ ${owner} 这一份**没有发出**${card}`,
      }
    }

    // ── ⑤ **先写后发**（与正常投递同款纪律）：先落去重标记，再发 ──────────────
    //   ⚠ 这样即使下面抛错，也不会因为"再补一次"而变成两份（那正是用户说的
    //     "两份，错的那份占住了"）。
    this.redelivered.set(key, true)
    // ⚠ 补投**不改** `delivered` 台账：本方法不负责"正常投递记了谁"，
    //   它是**额外**一份；把它写进去会让后续正常路径把这条误判成"已投过"。
    try {
      const text = `[补投] 这条回执此前**投错了人**，现按它自己的 owner 补送到你这里。`
        + `\n执行 id：${executionId}`
        + (taskId === undefined ? '' : `\n卡 id：${taskId}`)
        + '\n⚠ 这是补投的一份：⛔ 不是新的执行，⛔ 也不是自动重试。'
      await this.deliverFn(owner, text)
      this.state = {
        ...this.state,
        redeliveredCount: this.state.redeliveredCount + 1,
        lastRedeliveredTo: owner,
        note: `已**补投** ${owner}${card}（此前错投给 ${actualTo ?? '（判不出/未投）'}）`
          + '—— 这一档与"正常叫醒"分开计数',
      }
      this.say(`[card-wake] ${this.state.note}`)
      return { kind: 'redelivered', reason: String(this.state.note ?? '') }
    } catch (err) {
      // ⚠ 补投本身失败 ⇒ 记"漏投"那一档（知道给谁但没送到），⛔ 不重试、⛔ 不改投别人
      this.state = {
        ...this.state,
        undeliveredCount: this.state.undeliveredCount + 1,
        lastUndeliveredTo: owner,
        note: `⚠ **补投** ${owner} 失败：${String((err as Error)?.message ?? err)}${card}`
          + ' ⇒ 这是一条漏投：⛔ 不会自动重试，⛔ 也不会改投别人',
      }
      this.say(`[card-wake] ${this.state.note}`)
      return { kind: 'refused', reason: String(this.state.note ?? '') }
    }
  }

  /** 现看"补投台账"（诊断/机检用：证明 `(executionId, to)` 只补一份）。 */
  redeliveredLedger(): Array<{ executionId: string; to: string }> {
    return [...this.redelivered.keys()].map((k) => {
      const at = k.indexOf('\u0000')
      return { executionId: k.slice(0, at), to: k.slice(at + 1) }
    })
  }

  /** 去重表上限（⚠ 丢最旧：丢的是很久以前那次，不影响"这次"）。 */
  private trimSeen(): void {
    if (this.seenIds.size <= SEEN_LIMIT) return
    const sorted = [...this.seenIds.entries()].sort((a, b) => a[1] - b[1])
    for (const [k] of sorted.slice(0, this.seenIds.size - SEEN_LIMIT)) this.seenIds.delete(k)
  }

  /**
   * 连上 SSE 并持续读（⚠ 失败要可观测 + 自动重连，⛔ 不许静默退出）。
   *
   * ⚠ ⚠ **地址在这里现取**（`origin` 可为函数）：`webServer` 可能在模块激活后才 bind。
   *   `start()` 本身会被 `startWakeIfNeeded` **反复调用**（每次读状态一行就调一次）
   *   ⇒ 宿主一就绪，下一次就接上 —— 这是"重启后能自愈"的唯一机制，⛔ 别把它改成快照。
   *
   * @param fetcher - 注入的 `fetch`（机检可换成假的；默认真 `fetch`）。
   */
  start(fetcher: typeof fetch = fetch): void {
    if (this.stopped) return
    if (this.looping) return                              // ⚠ 只允许一条循环（见 `loop()` 的 finally）
    const origin = typeof this.opts.origin === 'function' ? this.opts.origin() : this.opts.origin
    if (origin === undefined || origin === '') {
      /**
       * ⚠ **这一句必须如实说清"为什么"与"能不能自愈"**（§二-② 的可读判据）。
       *   改前只写「webServer 不可用」⇒ 读者分不出：
       *     · 宿主**还没起来**（等一下就好）· 还是**永远拿不到**（要人修）；
       *     · 也分不出「取不到地址」与「地址有但连不上」（后者在 `loop()` 的 catch 里）。
       *   ⚠ ⛔ 不许把这一档降级成静默（那正是 `423b536` 刚立起来的可读行）。
       */
      this.state = {
        ...this.state,
        conn: 'broken',
        url: undefined,
        note: '⚠ 拿不到看板地址（webServer 未就绪 / 未 bind）⇒ **叫醒面没接上**'
          + '（⛔ 不等于"没有卡跑完"）。'
          + ' ↳ **会自愈**：每次读状态都会**现取一次**地址 ⇒ 宿主 web 服务一 bind 就接上；'
          + ' ⚠ 若一直是这一句 ⇒ 宿主这轮**根本没起 web 服务**（那是宿主侧的事，不是本插件的重试没做）',
      }
      this.say(`[card-wake] ${this.state.note}`)
      return
    }
    const url = `${origin.replace(/\/+$/, '')}${BOARD_SSE_PATH}`
    this.state = {
      conn: 'connecting',
      url,
      wokeCount: this.state.wokeCount,
      noSubscriberCount: this.state.noSubscriberCount,
      legacyTargetCount: this.state.legacyTargetCount,
      // ⚠ `I-10` 那一档也要跨重连保留（它是"我有一条回执没到"的唯一在内存读数）
      undeliveredCount: this.state.undeliveredCount,
      ...(this.state.lastUndeliveredTo === undefined ? {} : { lastUndeliveredTo: this.state.lastUndeliveredTo }),
      // ⚠ 补投那一档同样跨重连保留：它是"我补过几份"的唯一读数
      redeliveredCount: this.state.redeliveredCount,
      ...(this.state.lastRedeliveredTo === undefined ? {} : { lastRedeliveredTo: this.state.lastRedeliveredTo }),
      seenCount: 0,
    }
    this.looping = true
    this.say(`[card-wake] 正在接 ${url}`)
    void this.loop(url, fetcher)
  }

  /** 断开（模块卸载 / 测试收尾）。 */
  stop(): void {
    this.stopped = true
    this.looping = false
    try { this.abort?.abort() } catch { /* 已经断了 */ }
    this.abort = undefined
  }

  /** 重连主循环（指数退避，⚠ 每次失败都有一句可读话）。 */
  private async loop(url: string, fetcher: typeof fetch): Promise<void> {
    let backoff = RECONNECT_MIN_MS
    /**
     * ⚠ ⚠ **`looping` 必须在这一个 `try/finally` 里收掉**：循环退出（`stopped` / 抛错）
     *   之后若还留着 `true`，`startWakeIfNeeded` 就会永远 early-return ⇒ **再也起不来**
     *   （那正是本件要治的"接不上且不自愈"，只是换了个位置）。
     *   ⚠ 放在最外层 finally ⇒ 无论从哪个分支退出都清掉。
     */
    try {
      while (!this.stopped) {
        const ctl = new AbortController()
        this.abort = ctl
        try {
          const res = await fetcher(url, {
            signal: ctl.signal,
            headers: { accept: 'text/event-stream' },
          } as any)
          if (!res.ok || res.body === null) {
            throw new Error(`HTTP ${res.status}${res.body === null ? ' / 无响应体' : ''}`)
          }
          this.state = { ...this.state, conn: 'live', note: undefined }
          this.say('[card-wake] 已连上')
          backoff = RECONNECT_MIN_MS
          await this.readStream(res.body)
          // 流自然结束 ⇒ 也是"断了"，要重连
          if (!this.stopped) {
            this.state = { ...this.state, conn: 'broken', note: '⚠ SSE 流被对面关掉了（看板重载？）⇒ 正在重连' }
            this.say(`[card-wake] ${this.state.note}`)
          }
        } catch (e) {
          if (this.stopped) return
          const msg = String((e as Error)?.message ?? e)
          this.state = { ...this.state, conn: 'broken', note: `⚠ 接不上看板 SSE（${msg}）⇒ 正在重试（${backoff}ms 后）—— ⛔ 这不等于"没有卡跑完"` }
          this.say(`[card-wake] ${this.state.note}`)
        } finally {
          this.abort = undefined
        }
        if (this.stopped) return
        await this.sleep(backoff)
        backoff = Math.min(backoff * 2, RECONNECT_MAX_MS)
      }
    } finally {
      // ⚠ 循环真的退出（不是"两次重试之间"）⇒ 放开闸门，允许下一次 start 重来
      this.looping = false
    }
  }

  /** 读一条 SSE 流（按 `\n\n` 切帧；⚠ 注释帧与心跳不算事件）。 */
  private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return
        buf += dec.decode(value, { stream: true })
        let idx: number
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          const ev = raw.split('\n').find((l) => l.startsWith('event:'))
          const dl = raw.split('\n').find((l) => l.startsWith('data:'))
          if (ev === undefined || dl === undefined) continue   // 心跳/注释帧
          const kind = ev.slice(6).trim()
          const data = dl.slice(5).trim()
          await this.handleFrame(kind, data)
        }
      }
    } finally {
      try { reader.releaseLock() } catch { /* 已释放 */ }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms)
      // ⚠ 让 `unref` 不阻止进程退出（宿主跑在长进程里；测试里也不该挂住）
      ;(t as any)?.unref?.()
    })
  }
}

// ══════════════════════════════════════════════════════════════════════
// 2026-10-19 · **改判（`TASK-2`）**：信号源改成「实施会话的状态变化」
// ══════════════════════════════════════════════════════════════════════
//
// ⚠ ⚠ **为什么必须改**（用户原话逐字）：
//   「看板执行完任务之后会移动到待验收区域，你不要让看板告诉你这是不可能的，
//     你需要自己对派出去的实施会话状态变化检查去检测，而且看板是其他的插件，
//     你需要自己直接去检测实施会话的状态变化」
//   ⇒ 「看板是别人的插件 ⇒ 拿不到信号 ⇒ 做不到」这条**退路已撤销**。
//
// ⚠ **改后的判据落点**：
//   · **信号源** = **实施会话**的 `running → idle` 跳变（宿主 `agent/status` 事件）；
//   · **谁算"我派出去的"** = **本会话登记的派发**（`hob_dispatch` / 卡执行会话的登记表），
//     ⛔ 不是全实例所有会话、⛔ 也不是所有看板卡；
//   · **卡进 `in_review` 只是旁证**（可能晚于会话状态、也可能一张卡没有对应会话）
//     ⇒ ⛔ 不许当唯一判据（`CardWake` 的 SSE 那条从此降为**旁证通道**）。
//
// ⚠ **它仍然不碰"重挂"**：`watches` 的恢复逻辑一行未动（那是另一笔账）。

/** 一个被登记的「我自己派出去的」实施会话。 */
export interface DispatchedSession {
  /** 实施会话 id（信号源就是它的状态变化）。 */
  sessionId: string
  /** 派它的依据（`taskboard-card` = 看板卡的执行会话；`dispatch` = `hob_dispatch` 派的）。 */
  via: 'dispatch' | 'taskboard-card'
  /** 看板卡 id（`via='taskboard-card'` 时才有）。 */
  cardId?: string
  /** 看板那次执行的 id（去重键的一半 —— 同一会话连跑两轮靠它区分）。 */
  executionId?: string
  /** 登记时刻（毫秒）。 */
  at: number
  /** 是否已见过它进入 `running`（没见过 ⇒ idle 不算"跑完"，与既有 `watches` 同口径）。 */
  sawRunning: boolean
  /** 是否已经叫过（**单次性**：一次跑完只叫一次）。 */
  reported: boolean
  /** 叫过之后它又跑起来了 ⇒ 记"第二轮"（⚠ 不许把第二轮当成第一轮的重复吞掉）。 */
  rounds: number
  /**
   * ⚠⚠ **派它的那个会话**（`I-1` / `I-2`：回执收件人**逐条绑定**）。
   *
   * ⚠ 改前这里**没有 owner**，回执收件人取自 `opts.selfSessionId`（**进程级单值**，
   *   任何会话读一次状态就把它刷成自己）⇒ A 的派发回执会投给 B 的 Hob
   *   ——这就是本件要治的那条病根的**最直接一条路**。
   * ⚠ `undefined` = **判不出归属**（旧登记 / 没给 owner）⇒ 到点后**不投** +
   *   落"判不出归属"那一档可读话，⛔ 绝不退化成"投给最后一个摸过状态的人"。
   */
  owner?: string
  /** 该 owner 的工作区根（可读话点名用；判不出 ⇒ 不填）。 */
  ownerWsRoot?: string
}

/** 一次叫醒的结局（供渲染层分开报，⛔ 不许把三档混成一个计数）。 */
export type WakeOutcome =
  /** 真叫醒了一次。 */
  | 'woke'
  /** 该叫但没人订阅（不知道叫谁）。 */
  | 'no-subscriber'
  /** 投递通道没就绪。 */
  | 'no-channel'
  /** ⚠ **判不出**：状态读不到 / 会话消失了 ⇒ ⛔ 既不是"跑完"也不是"没跑过"。 */
  | 'undecidable'

/** 卡执行会话叫醒面的运行态（供 `hob_orch_status` 渲染）。 */
export interface DispatchWakeState {
  /** 登记了多少个会话（去重后）。 */
  registered: number
  /** 其中正在跑的（见过 `running` 且还没叫）。 */
  pending: number
  /** 已叫醒次数（累计）。 */
  wokeCount: number
  /** ⚠ **判不出**的次数（状态读不到 / 会话消失）—— ⛔ 与"跑完"分开记。 */
  undecidableCount: number
  /** 最近一次的可读话。 */
  note?: string
  /** 最近一次判不出的原因（原话）。 */
  undecidableWhy?: string
  /** 最近一次叫醒的时刻与是谁。 */
  lastWokeAt?: number
  lastWokeSession?: string
  lastWokeCard?: string
  /**
   * **按推送现读登记**成功过几次（2026-10-19 · 补缺口那一路）。
   *
   * ⚠ 它回答"**叫醒面到底接上没有**"：> 0 ⇒ 点火帧能把会话登记进来
   *   ⇒ **不依赖任何人先浏览卡面**。⛔ 与"读过卡面才登记"那一档分开计。
   */
  pushedRegisterOk: number
  /**
   * 按推送现读**登记失败**的档（`no-session` / `unreadable`）次数与最近原话。
   *
   * ⚠ ⛔ 这两档都**不是**"没有卡在跑"：`no-session` = 那张卡确实没会话 id；
   *   `unreadable` = **读不到**（看板没装 / 卡没了）⇒ 必须留可读话。
   */
  pushRegisterIssues: number
  /** 最近一次按推送登记失败的可读原话（⛔ 不许静默）。 */
  pushRegisterWhy?: string
  /**
   * ⚠⚠ **「判不出归属 ⇒ 没登记」的独立一档**（`I-3` 末段）。
   *
   * ⚠ 判据：`register()` 收到的记录**没有 owner** ⇒ 不登记，记本档 + 可读话。
   * ⚠ ⛔ **不许与"没有卡在跑 / 没有会话在跑"混成一个计数**（本项目既有纪律）：
   *   那一个数说的是"确实没人在跑"，本档说的是"有人在跑，但我不知道它归谁"。
   */
  ownerUnknownCount: number
  /** 最近一次"判不出归属"的可读原话（⛔ 不许静默）。 */
  ownerUnknownWhy?: string
  /**
   * ⚠⚠ **「有会话跑完、但判不出该回给谁 / 没送到」的独立一档**（`I-10`：错投 ≡ 漏投）。
   *
   * ⚠ 它与 `undecidableCount` **不是一回事**（⛔ 不许合并）：
   *   · `undecidableCount` = **读不到那个会话的状态** ⇒ 不知道它跑没跑完；
   *   · `undeliverableCount` = **它确实跑完了**，但这条登记没 owner / 投递抛错
   *     ⇒ 回执**送不出去**（这一档才是"漏投"，必须能被 owner 自己的读数看见）。
   */
  undeliverableCount: number
  /** 最近一次"跑完却送不出去"的可读原话（⛔ 不许静默）。 */
  undeliverableWhy?: string
}

/**
 * 「我自己派出去的实施会话」叫醒面。
 *
 * ⚠ **纯对象、不自己订阅事件**：`observe()` 由 M5 的 `agent/status` 监听喂进来
 *   ⇒ 便于机检用**假状态序列**喂真逻辑（不起真会话）。
 */
export class DispatchWake {
  private readonly sessions = new Map<string, DispatchedSession>()
  private state: DispatchWakeState = {
    registered: 0, pending: 0, wokeCount: 0, undecidableCount: 0,
    pushedRegisterOk: 0, pushRegisterIssues: 0,
    ownerUnknownCount: 0, undeliverableCount: 0,
  }
  private readonly opts: DispatchWakeOpts

  constructor(opts: DispatchWakeOpts) {
    this.opts = opts
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now()
  }

  private say(line: string): void {
    this.opts.log?.(line)
  }

  setDeliver(fn: ((sessionId: string, text: string) => Promise<unknown>) | undefined): void {
    this.opts.deliver = fn
  }

  /** 现读状态（渲染层只认这个）。 */
  snapshot(): DispatchWakeState {
    const pending = [...this.sessions.values()].filter((s) => s.sawRunning && !s.reported).length
    return { ...this.state, registered: this.sessions.size, pending }
  }

  /**
   * 登记一个"**本 owner** 派出去的"会话（已在表里 ⇒ 只补卡/执行信息，**不重置**状态）。
   *
   * ⚠⚠ **准入判据（`I-3`，只有三种来源能进这张表）**：
   *   ① 本 owner 经 `hob_dispatch` 派出去的（`via='dispatch'`，owner = 调用方）；
   *   ② 本 owner 经 `hob_spawn` 建出来的（`via='taskboard-card'` + owner 由建档归属给出）；
   *   ③ 卡片/会话的**归属记录明确指向本 owner**（同一张卡的 `createdBy.sessionId === owner`）。
   *   ⛔ **不许"本工作区的卡一律算我的"** —— 改前正是这一条让同一工作区里两个 Hob 互相串收。
   *
   * ⚠ **判不出 owner ⇒ 不登记** + 记「判不出归属」**独立一档**（`I-3` 末段）：
   *   该档 ⛔ 不许与"没有卡在跑"混成一个计数。
   */
  register(entry: {
    sessionId: string
    via: DispatchedSession['via']
    cardId?: string
    executionId?: string
    /** ⚠⚠ 派它的那个会话 —— 判不出就**别登记**（见方法注释的三种准入来源）。 */
    owner?: string
    ownerWsRoot?: string
  }): void {
    const id = entry.sessionId
    if (typeof id !== 'string' || id === '') return
    // ── 准入：**判不出归属 ⇒ 不登记**，落独立一档可读话（⛔ 不许猜、⛔ 不许按工作区兜）
    if (typeof entry.owner !== 'string' || entry.owner === '') {
      this.state = {
        ...this.state,
        ownerUnknownCount: this.state.ownerUnknownCount + 1,
        ownerUnknownWhy: `会话 ${id} 的归属**判不出**（没有 owner）⇒ **不登记**：`
          + '它跑完也不会叫醒任何人（⛔ 这不等于"没有会话在跑"，也⛔ 不是"它没跑完"）',
      }
      this.say(`[dispatch-wake] ${this.state.ownerUnknownWhy}`)
      return
    }
    const have = this.sessions.get(id)
    if (have !== undefined) {
      // ⚠ **不覆盖 sawRunning / reported**：重复登记（每读一次卡面就登记一次）不许把状态清掉，
      //   否则"读一次状态行"就能让已经叫过的会话**再叫一次**（刷屏）。
      if (entry.cardId !== undefined) have.cardId = entry.cardId
      if (entry.executionId !== undefined) have.executionId = entry.executionId
      /**
       * ⚠⚠ **owner 只在第一次登记时定下来，此后不可改绑**（`I-6` 末条同款纪律）：
       *   改绑会让"已经派出去的活"把回执送到另一个会话手里 —— 那是本件最怕的错投。
       *   ⇒ 已登记且 owner 不同 ⇒ **明确报可读话，不改**。
       */
      if (have.owner !== entry.owner) {
        this.state = {
          ...this.state,
          note: `⚠ 拒绝改绑：会话 ${id} 已归属 ${String(have.owner)}，`
            + `本次登记要把它改成 ${entry.owner} ⇒ **不改**（改绑会把已派出的活的回执送给别人）`,
        }
        this.say(`[dispatch-wake] ${this.state.note}`)
      }
      return
    }
    this.sessions.set(id, {
      sessionId: id,
      via: entry.via,
      ...(entry.cardId === undefined ? {} : { cardId: entry.cardId }),
      ...(entry.executionId === undefined ? {} : { executionId: entry.executionId }),
      owner: entry.owner,
      ...(entry.ownerWsRoot === undefined ? {} : { ownerWsRoot: entry.ownerWsRoot }),
      at: this.now(),
      sawRunning: false,
      reported: false,
      rounds: 0,
    })
  }

  /**
   * 记一次「**判不出归属 ⇒ 没登记**」（`I-3` 末段的**独立一档**）。
   *
   * ⚠ ⚠ 它存在的理由与 `noteRegistryIssue` 同族、但**不是同一档**：
   *   · `pushRegisterIssues` = **读不到**那张卡（看板没装 / 卡没了）；
   *   · 本档 = 卡读到了，但**判不出它归谁**（没有 `createdBy.sessionId`，本会话也没派过）
   *     ⇒ 这不是失败、也不是"没有卡在跑"，而是"**这张卡的回执不该给我**"。
   * ⚠ ⛔ 不许与"没有卡在跑 / 没有会话在跑"合并计数（本项目既有纪律）。
   */
  noteOwnerUnknown(cardId: string, sessionId: string, why: string): void {
    this.state = {
      ...this.state,
      ownerUnknownCount: this.state.ownerUnknownCount + 1,
      ownerUnknownWhy: `卡 ${cardId}（执行会话 ${sessionId}）**归属判不出** ⇒ **不登记**：${why}`
        + ' —— ⛔ 这不等于"没有卡在跑"，也⛔ 不是"它没跑完"；'
        + '该卡的回执只该回到它自己的 owner',
    }
    this.say(`[dispatch-wake] ${this.state.ownerUnknownWhy}`)
  }

  /**
   * 记一次「按推送现读会话**成功登记**」（2026-10-19 · 补缺口那一路）。
   *
   * ⚠ 它存在的唯一理由：让 `hob_orch_status` 能**一眼看出叫醒面接没接上**
   *   （作业书 §三-6）。⛔ 不许把它与"被谁读过卡面才登记"混成一个数。
   */
  noteRegistryOk(cardId: string): void {
    this.state = {
      ...this.state,
      pushedRegisterOk: this.state.pushedRegisterOk + 1,
      note: `按推送现读登记成功（卡 ${cardId}）—— 不依赖任何人先浏览卡面`,
    }
    this.say(`[dispatch-wake] ${this.state.note}`)
  }

  /**
   * 记一次「按推送现读**登记失败**」（`no-session` / `unreadable`）。
   *
   * ⚠ ⛔ **这两种都不是"没有卡在跑"**：
   *   · `no-session` = 那张卡**确实**没有执行会话 id（旧卡 / 非看板起的会话）；
   *   · `unreadable` = **读不到**（看板没装 / 卡没了 / 工具调用失败）。
   *   ⇒ 各自留一句**可读话**，⛔ 不许静默（那正是本件要治的失败模式）。
   */
  noteRegistryIssue(cardId: string, kind: 'no-session' | 'unreadable', why: string): void {
    this.state = {
      ...this.state,
      pushRegisterIssues: this.state.pushRegisterIssues + 1,
      pushRegisterWhy: `卡 ${cardId} 按推送现读登记失败（${kind}）：${why}`
        + (kind === 'unreadable' ? ' —— ⛔ 这是"读不到"，不是"没有会话"' : ' —— ⚠ 这是"确实没有会话 id"'),
    }
    this.say(`[dispatch-wake] ${this.state.pushRegisterWhy}`)
  }

  /** 摘掉一个登记（会话结束 / 不再关心）。 */
  forget(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  /** 现看登记表（诊断/测试用）。 */
  entries(): DispatchedSession[] {
    return [...this.sessions.values()]
  }

  /**
   * 喂一次**状态变化**（由 M5 的 `agent/status` 监听调用）。
   *
   * ⚠ 三件边界就在这里**写死**：
   *   ① **只认登记过的会话**（`sessions` 里有才处理）⇒ 全实例别的会话一律不理；
   *   ② **一次跑完只叫一次**（`reported` 单次性），但**它再次进入 `running` ⇒ `rounds+1`
   *      且 `reported` 复位** ⇒ 第二轮会**再叫一次**（⛔ 不把第二轮当第一轮的重复吞掉）；
   *   ③ `status` 读不到 / 不是字符串 ⇒ 落 **`undecidable`**（⛔ 不落"跑完"）。
   *
   * @param sessionId - 变化的是哪个会话。
   * @param status - 新状态字（`running` / `idle` / 其它）；**读不到就传 undefined**。
   * @returns 本次的结局（没有结局 = 正常演进，返回 undefined）。
   */
  async observe(sessionId: string, status: string | undefined): Promise<WakeOutcome | undefined> {
    const s = this.sessions.get(sessionId)
    // ① 不是我派出去的 ⇒ 不理（⚠ 未登记的会话**连"判不出"都不记**：
    //    它不是本会话的责任面，记进来会把"判不出"的计数污染成"全实例都在判不出"）
    if (s === undefined) return undefined
    // ③ **读不到状态** ⇒ 判不出（⛔ 不许当跑完，⛔ 也不许当没跑过）
    //   ⚠ **顺序有意义**：这一支必须在"登记检查"**之后**（别人的会话不归我判），
    //     但在**任何状态判断之前**（读不到就先说读不到，⛔ 不许先猜它 idle）。
    if (typeof status !== 'string' || status === '') {
      this.state = {
        ...this.state,
        undecidableCount: this.state.undecidableCount + 1,
        undecidableWhy: `会话 ${sessionId} 的状态**读不到**（事件里没有 status 字）⇒ 这一档叫**判不出**：⛔ 既不是"跑完"，也不是"没跑过"`,
      }
      this.say(`[dispatch-wake] ${this.state.undecidableWhy}`)
      return 'undecidable'
    }
    if (status === 'running') {
      // ② 再次进入 running ⇒ 这是**新一轮**（若上一轮已叫过，则复位）
      if (s.reported) {
        s.reported = false
        s.rounds += 1
        this.say(`[dispatch-wake] ${sessionId} 又开始跑 ⇒ 这是**第 ${s.rounds + 1} 轮**（上一轮已叫过，本轮要能再叫）`)
      }
      s.sawRunning = true
      return undefined
    }
    if (status !== 'idle') return undefined                // 其它状态字不构成"跑完"
    if (!s.sawRunning) return undefined                    // 从没跑过 ⇒ 不是"跑完"（既有口径）
    if (s.reported) return undefined                       // ② 本轮已叫过
    s.reported = true
    return await this.wake(s)
  }

  /** 真叫（⛔ 只从这里叫；`observe` 已经保证单次性）。 */
  private async wake(s: DispatchedSession): Promise<WakeOutcome> {
    const what = s.cardId === undefined
      ? `会话 ${s.sessionId} 跑完了`
      : `会话 ${s.sessionId} 跑完了（对应看板卡 ${s.cardId}）`
    const roundBit = s.rounds > 0 ? `（第 ${s.rounds + 1} 轮）` : ''
    const text = `[实施会话跑完] ${what}${roundBit}。`
      + '\n信号来自**实施会话的状态变化**（`running → idle`），不是等看板通知。'
      + (s.cardId === undefined
        ? '\n下一步：用 `hob_sessions` / `hob_orch_status` 看它回来干什么。'
        : `\n下一步：用 \`taskboard_get\` 读那张卡的执行报告与评论（卡 id = ${s.cardId}）；`
          + '⚠ 卡进 `in_review` 只是**旁证**，以会话状态为准。')
    if (this.opts.deliver === undefined) {
      this.state = { ...this.state, note: '⚠ 有会话跑完，但**投递通道没就绪**（hobBus 未提供）⇒ 这一声没叫出去' }
      this.say(`[dispatch-wake] ${this.state.note}`)
      return 'no-channel'
    }
    /**
     * ⚠⚠ **收件人 = 这条记录自己的 `owner`**（`I-2` / `I-9`；⛔ 不是进程级单值）。
     *
     * 改前这里是 `const target = this.opts.selfSessionId` —— 一个**进程级单值**，
     * 任何会话读一次 `hob_orch_status` / 卡面就把它刷成自己
     * ⇒ **A 派出去的活的回执会投给 B 的 Hob**（用户报的那条缺陷最直接的一条路）。
     * ⇒ 现在只认 `s.owner`：**逐条绑定**，判不出就不投 + 落可读一档。
     */
    const target = s.owner
    if (target === undefined || target === '') {
      this.state = {
        ...this.state,
        undeliverableCount: this.state.undeliverableCount + 1,
        undeliverableWhy: `会话 ${s.sessionId} 跑完了，但**判不出该回给谁**（这条登记没有 owner）`
          + '⇒ **这一声不投**；⛔ 不会退化成"投给最后一个摸过状态的人"，'
          + '⛔ 也不是"没有会话跑完"',
      }
      this.say(`[dispatch-wake] ${this.state.undeliverableWhy}`)
      return 'no-subscriber'
    }
    /**
     * ⚠⚠ **先写后发**（`I-9` 第三条）：把"这一轮已叫过"先落下来再投。
     *   `observe()` 已经先把 `s.reported` 置 true 才调本函数 —— 那一处就是同一道保证；
     *   这里再显式留一行注释，避免以后有人把它挪到投递之后（那会让失败的一轮**再叫一次**）。
     */
    try {
      const r: any = await this.opts.deliver(target, text)
      void r
      this.state = {
        ...this.state,
        wokeCount: this.state.wokeCount + 1,
        lastWokeAt: this.now(),
        lastWokeSession: s.sessionId,
        ...(s.cardId === undefined ? {} : { lastWokeCard: s.cardId }),
        note: `已叫醒：${what}${roundBit}`,
      }
      this.say(`[dispatch-wake] ${this.state.note}`)
      return 'woke'
    } catch (e) {
      /**
       * ⚠ **投递抛错 ⇒ 记"漏投"那一档**（`I-10`），⛔ **不重投、⛔ 不改投别人**。
       * ⚠ 必须能被 **owner 自己的读数**看见（"我有一条回执没到"）。
       */
      this.state = {
        ...this.state,
        undeliverableCount: this.state.undeliverableCount + 1,
        undeliverableWhy: `回执**没送到** ${target}：${String((e as Error)?.message ?? e)}`
          + `（会话 ${s.sessionId} 那一轮）⇒ 这是一条**漏投**：⛔ 不会改投别人，⛔ 不会自动重投`,
      }
      this.say(`[dispatch-wake] ${this.state.undeliverableWhy}`)
      return 'no-channel'
    }
  }

  /**
   * ⛔ **本方法已删除**（2026-10-19 收单第一轮 · `I-2` 明令）。
   *
   * 改前它叫 `setSelfSessionId(id)`，把"回执该投给谁"写进一个**进程级单值**
   * （`opts.selfSessionId`），而全进程共用一个 `DispatchWake`
   * ⇒ **任何会话读一次状态 / 卡面就把收件人刷成它自己**
   * ⇒ A 的派发回执投给 B 的 Hob。这就是"回执跑到别的 Hob 预设"那条最直接的路。
   *
   * ⚠ `I-2` 的原话：⛔ 禁止任何"进程级单值决定异步投递收件人"的写法 ——
   *   这一类**要么删、要么只允许用于"当前调用方自己的同步返回值"，不得参与异步投递**。
   *   本类的语义**天生是异步**（等对方跑完才投）⇒ 只能**删**。
   * ⚠ 收件人现在是 {@link DispatchedSession.owner}（**逐条**绑定，见 `register`）。
   */
}

/** {@link DispatchWake} 的构造参数。 */
export interface DispatchWakeOpts {
  /**
   * ⛔ **本字段已删除**（2026-10-19 收单第一轮 · `I-2`）。
   *
   * 改前 `selfSessionId?: string` 是**进程级收件人**（全进程共用一个 `DispatchWake`），
   * 谁读一次状态就被刷成谁 ⇒ A 的回执投给 B（本件的病根 1.1）。
   * ⚠ 收件人现在是**每条登记记录自己的** `owner`（{@link DispatchedSession.owner}）。
   */
  /** 投递实现（真环境 = `bus.deliver(id, text, 'followup')`）。 */
  deliver?: (sessionId: string, text: string) => Promise<unknown>
  /** 现取时刻（测试可固定）。 */
  now?: () => number
  /** 可读日志出口（⛔ 不许静默）。 */
  log?: (line: string) => void
}

// ══════════════════════════════════════════════════════════════════════
// 2026-10-19 · **补覆盖缺口**：叫醒不许依赖「Hob 事先读过卡面」
// ══════════════════════════════════════════════════════════════════════
//
// ⚠ ⚠ **实测缺口**（本件的由头，不是推断）：
//   短活卡 `t-mvdzqp1a-80odlo`：`00:24:13` 点火 → `00:24:33` 落定 → **`00:35` 之后 Hob 才第一次读卡面**。
//   按 `523b610` 的实现，卡的执行会话**只有读卡面时才登记**
//   ⇒ 登记发生在"已经跑完之后" ⇒ `running → idle` 那一跳**在登记之前就过去了** ⇒ **一声不叫**。
//   ⚠ 而那恰恰是**最需要叫醒**的情形（派出去就没再回头看）。
//
// ⚠ **补法（⛔ 不是"定时扫看板"）**：
//   点火那一帧（`execution-recorded` + `lastExecutionOutcome==='running'`）**本来就带着卡 id**
//   ⇒ **从推送里认卡**，再去读**那一张卡**的完整记录拿 `executionSessionId`，然后登记。
//   ⛔ 不扫全表（只读**被推送点到的那一张**）；⛔ 不依赖任何人先浏览过。
//   ⚠ 读不到 `executionSessionId` ⇒ **不猜**，落 `undecidable` + 一条可读话（⛔ 不许静默）。

/** 点火帧里认出来的一张「正在开跑的卡」。 */
export interface CardFiringEvent {
  /** 卡 id（推送帧里就有）。 */
  taskId: string
  /** 那次执行的结果字（点火帧必然是 `running`）。 */
  outcome: string
  /** 该帧被认出的时刻（毫秒）。 */
  at: number
}

/**
 * 从一帧 SSE `change` 里认出「**正在开跑的卡**」（= 点火帧）。
 *
 * ⚠ 与 {@link cardDoneEventsOf} **正好互补**：那个认"落定"，这个认"开跑"。
 *   两个都从**同一个推送**里来 ⇒ 谁也不用先去浏览一遍卡面。
 *
 * @param frame - 已 `JSON.parse` 的 `data:` 负载。
 * @param workspaceId - 本工作区 id（`undefined` ⇒ 不认）。
 */
export function cardFiringEventsOf(frame: unknown, workspaceId: string | undefined): CardFiringEvent[] {
  if (workspaceId === undefined || workspaceId === '') return []
  if (frame === null || typeof frame !== 'object') return []
  const f = frame as { kind?: unknown; tasks?: unknown }
  if (typeof f.kind !== 'string' || !EXECUTION_KINDS.includes(f.kind)) return []
  if (!Array.isArray(f.tasks)) return []
  const out: CardFiringEvent[] = []
  for (const raw of f.tasks) {
    if (raw === null || typeof raw !== 'object') continue
    const t = raw as Record<string, unknown>
    if (t.workspaceId !== workspaceId) continue
    if (t.lastExecutionOutcome !== 'running') continue   // ⚠ 只认**点火**那一帧
    const id = typeof t.id === 'string' && t.id !== '' ? t.id : undefined
    if (id === undefined) continue
    out.push({ taskId: id, outcome: 'running', at: Date.now() })
  }
  return out
}

/** 一次"按卡查会话"的读取结果（⚠ 三档分开：读到 / 没有 / 读不到）。 */
export type CardSessionLookup =
  /**
   * 读到了这张卡，且它有执行会话 id。
   *
   * ⚠ `createdBySessionId` = 这张卡是**哪个会话**建的（看板 `createdBy.sessionId`）——
   *   它就是这张卡的 **owner**（`I-1` / `I-3` 的准入判据）。读不到 ⇒ **不填**
   *   （⛔ 不许猜、⛔ 不许拿"看这个面的人"顶替）。
   */
  | {
    kind: 'found'
    cardId: string
    sessionId: string
    executionId?: string
    outcome?: string
    status?: string
    createdBySessionId?: string
    createdByWsRoot?: string
  }
  /** 读到了这张卡，但它**没有**执行会话 id（旧卡 / 非看板起的会话）。 */
  | { kind: 'no-session'; cardId: string; why: string }
  /** ⚠ **读不到**这张卡（看板不可用 / 该卡不在了）——⛔ 不许当成"没有这张卡"。 */
  | { kind: 'unreadable'; cardId: string; why: string }

/**
 * **按卡 id 现读它的执行会话**（= 补缺口的核心：登记不再依赖"读过卡面"）。
 *
 * ⚠ 它**只读被点名的那一张卡**（`taskboard_get`），⛔ 不扫全表 ⇒ 代价 = 每次点火一次调用。
 * ⚠ 三档必须分开：`found` / `no-session` / `unreadable` ——
 *   ⛔ 不许把后两者合并成"没有"，那正是本件要治的失败模式。
 *
 * @param cardId - 被推送点到的那张卡。
 * @param getTool - 宿主 `tools` 注册表的按名取定义（拿不到 ⇒ `unreadable`）。
 */
export async function lookupCardSession(
  cardId: string,
  getTool: ((name: string) => any) | undefined,
): Promise<CardSessionLookup> {
  if (getTool === undefined) {
    return { kind: 'unreadable', cardId, why: '拿不到宿主的工具注册表 ⇒ 读不到那张卡（⛔ 不等于"它没有会话"）' }
  }
  let tool: any
  try { tool = getTool('taskboard_get') } catch (e) {
    return { kind: 'unreadable', cardId, why: `取 taskboard_get 抛错：${String((e as Error)?.message ?? e)}` }
  }
  if (tool === undefined || tool === null || typeof tool.execute !== 'function') {
    return { kind: 'unreadable', cardId, why: '当前工具面里没有 `taskboard_get`（看板没装 / 被收敛掉）' }
  }
  let value: any
  try { value = await tool.execute({ id: cardId }, { agent: undefined }) } catch (e) {
    return { kind: 'unreadable', cardId, why: `taskboard_get 抛错：${String((e as Error)?.message ?? e)}` }
  }
  const task = value !== null && typeof value === 'object' ? value.task : undefined
  if (task === undefined || task === null) {
    return { kind: 'unreadable', cardId, why: '`taskboard_get` 的返回值里没有 task（该卡可能已删除）' }
  }
  const executions = Array.isArray(task.executions) ? task.executions : []
  const last = executions.length > 0 ? executions[executions.length - 1] : undefined
  const sessionId = typeof last?.sessionId === 'string' && last.sessionId !== '' ? last.sessionId : undefined
  if (sessionId === undefined) {
    return {
      kind: 'no-session',
      cardId,
      why: '这张卡的最近一次执行**没有记录会话 id**（旧卡 / 非看板起的会话）',
    }
  }
  const createdBy = task.createdBy !== null && typeof task.createdBy === 'object'
    ? (task.createdBy as Record<string, unknown>)
    : undefined
  const createdBySessionId = typeof createdBy?.sessionId === 'string' && createdBy.sessionId !== ''
    ? createdBy.sessionId
    : undefined
  const createdByWsRoot = typeof createdBy?.workspaceRoot === 'string' && createdBy.workspaceRoot !== ''
    ? createdBy.workspaceRoot
    : undefined
  return {
    kind: 'found',
    cardId,
    sessionId,
    ...(typeof last?.id === 'string' && last.id !== '' ? { executionId: last.id } : {}),
    ...(typeof last?.outcome === 'string' ? { outcome: last.outcome } : {}),
    ...(typeof task.status === 'string' ? { status: task.status } : {}),
    // 🔑 归属：⛔ 读不到就不填（准入会因此判"判不出"⇒ 不登记）
    ...(createdBySessionId === undefined ? {} : { createdBySessionId }),
    ...(createdByWsRoot === undefined ? {} : { createdByWsRoot }),
  }
}
