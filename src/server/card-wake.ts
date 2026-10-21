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
   *
   * ⚠⚠ **2026-10-19 · 拆"一档两义"（`306-C83` §四）**：本档**只留投递那一半**
   *   （{@link CardWake.handleFrame}：一条卡跑完、**判不出它的 owner** ⇒ 这一声不投）。
   *   另一半（{@link CardWake.redeliver}：有人补一条错投回执、**判不出该补给谁**
   *   ⇒ 这一份不补）**已挪到** {@link WakeState.redeliverOwnerUnknownCount}。
   *   ⇒ 读本数的人**不会再**把"投递时判不出归属"与"补投时判不出归属"看成同一件事
   *   （本项目明令：⛔ 不许把两种原因说成同一句话）。
   */
  legacyTargetCount: number
  /**
   * ⚠⚠ **「补投时判不出该补给谁 ⇒ 这一份不补」的独立一档**（2026-10-19 拆档 · `306-C83` §四）。
   *
   * ── 拆掉的是哪一半（⚠ 必须写清，否则下一个人又会合并回去）────────────────
   *   改前 `legacyTargetCount` 一个数被**两条路径**共用：
   *     ① **投递**（{@link CardWake.handleFrame}）：一条卡跑完、**判不出它的 owner**
   *        ⇒ 这一声不投；
   *     ② **补投**（{@link CardWake.redeliver}）：有人补一条错投回执、**判不出该补给谁**
   *        ⇒ 这一份不补。
   *   ⇒ 读那个数的人**分不出是哪一件**：前者是"这声回执我压根不知道该给谁"，
   *     后者是"**有人按了补投**、但补不了"—— 后果完全不同
   *     （后者会让人以为"错投那条已经补过了"）。
   *   ⇒ 挪走的是 **②**；`legacyTargetCount` 里**留着的仍是 ①**（语义一个字没改）。
   *
   * ⚠ ⛔ **不许并进任何既有计数**：
   *   · 并进 `wokeCount` ⇒ 把"没补成"说成"叫醒了"；
   *   · 并进 `undeliveredCount` ⇒ 那一档是"**知道给谁但没送到**"，本档是"**不知道该给谁**"；
   *   · 并进 `legacyTargetCount` ⇒ 就是本档要拆掉的"一档两义"本身。
   */
  redeliverOwnerUnknownCount: number
  /** 最近一次"补投时判不出该补给谁"的可读原话（⛔ 不许静默）。 */
  redeliverOwnerUnknownWhy?: string
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
  /**
   * ⚠⚠ **「执行方就是 owner 本人 ⇒ 不叫醒」的独立一档**（2026-10-20 · 第 7 单）。
   *
   * ── 现场（`session-77d33ea8` 会话档案，已实测）──────────────────────────
   *   05:54:23 → 06:06:29 之间，Hob 收到 **25 条** `[实施会话跑完]`
   *   （另在 spliced 通道共 76 条记录），内容全部是「会话 `session-77d33ea8` 跑完了」
   *   —— **报的就是它自己**；06:01:39–06:01:52 一段间隔 **0.1–0.3 秒**，轮次号涨到 `第 42 轮`。
   *
   * ── 机理（⚠ 两段叠成的正反馈，⛔ 不是"某处重发"）────────────────────
   *   ① 第三方看板（`syncExternalSessions: true`）找任务的谓词是
   *      `claimedBy === sessionId || executions.some(e => e.sessionId === sessionId)`
   *      （`dsh-taskboard/lib/host/session-sync.js:269 / 321 / 412`）——
   *      **只要这张卡曾经由该会话执行过**，之后该会话**每一轮 `turn/start`**
   *      都会给那张卡**追加一条新 execution**（`:326` / `:352`），`turn/end` 再结算成 `succeeded`；
   *   ② 本模块把"卡跑完"的通知**回给该卡的 owner**（= 建卡会话 = 同一个会话）
   *      ⇒ 它自己**每一轮结束都被叫醒一次** ⇒ 又开新的一轮 ⇒ 回到 ①。
   *
   * ── 判据（⚠ 一句话）──────────────────────────────────────────────────
   *   **"通知 owner"这件事的前提是 owner 不知道**。若那张卡的**执行方就是 owner 本人**，
   *   它当然知道自己这一轮跑完了 ⇒ 这一声**不投**（⛔ 不是漏投，⛔ 不是判不出）。
   *
   * ⚠ ⛔ **不许并进任何既有计数**（本项目明令：两种原因不许说成同一句话）：
   *   · 并进 `legacyTargetCount` ⇒ 那是"**判不出 owner**"，而这里 owner **判得明明白白**；
   *   · 并进 `undeliveredCount` ⇒ 那是"**知道给谁但没送到**"，而这里是"**有意不送**"；
   *   · 并进 `noSubscriberCount` ⇒ 那是"没人订阅"，与"执行方是谁"无关；
   *   · 并进 `wokeCount` ⇒ 把"没叫"说成"叫了"。
   */
  selfExecutedCount: number
  /** 最近一次"执行方就是 owner 本人 ⇒ 不叫醒"的可读原话（⛔ 不许静默）。 */
  selfExecutedWhy?: string
  /** 最近一次被这一档拦下的卡（诊断：点名是哪张卡在自产自收）。 */
  lastSelfExecutedCard?: string
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
  /**
   * ⚠⚠ **`hello` 帧回调**（2026-10-20 · 本单 B5 的 **T4**）。
   *
   * ── 改前它被直接丢掉（`FINDINGS`/`DESIGN` §4.4 T4/T5 的原话）──────────────
   *   `handleFrame` 的第一行是 `if (kind !== 'change') return 0` ⇒ **`hello` 帧不处理**
   *   ⇒ 重连之后**不补帧**，而 `seenIds` / `firedSeen` 又都是**内存去重表**（重载即清零）
   *   ⇒ 「重载 + 看板无新提交」这一格里，SSE 这条通道**永不触发**。
   *
   * ── 现在它算什么 ────────────────────────────────────────────────────
   *   **只当一次"对账的触发点"**（⛔ 不当信号源、⛔ 不投递任何回执）：
   *   重连成功 ⇒ 让上层**顺手把盘上的账对平一次**。
   *   ⚠ 零额外连接、零周期 —— 复用的就是**本来就有的**那条长连接。
   *   ⚠ 它仍然**只是"大概率"**（只在重连时来），⛔ 不许当成保证（见 B5 的交底表）。
   */
  onHello?: () => void
  /**
   * ⚠⚠ **按卡现读 owner**（2026-10-20 · 第 4 单；治「自家卡叫不醒」）──────────────
   *
   * ── 现场（Hob 原文，已 4 次）──────────────────────────────────────────
   *   `⚠ 有卡跑完（t-mvfertx2-zrnyvc · 项目 …）但**判不出它的 owner**`
   *   `（这条记录没有 owner：旧帧 / 看板没记 createdBy.sessionId）⇒ **这一声不投**`
   *
   * ── 机理（**已核实，不是猜**）────────────────────────────────────────
   *   **不是**"看板不给这个字段" —— 卡面上它**有值**（实测读数为
   *   `createdBy: {kind:'agent', sessionId:'session-77d33ea8-…'}`）。
   *   是 **SSE 帧里没有**：看板 `broadcast()` 用 `summarize()` 投影每张卡
   *   （第三方包 `lib/shared/protocol.js:966-986` 原文），那个投影**只有**
   *   `id/title/workspaceId/urgency/status/blocked/version/lastExecutionOutcome/…`
   *   —— **没有 `createdBy`**。而本模块的 owner 只从**帧**里读
   *   ⇒ 真帧上**永远**判不出 ⇒ 落 `legacyTargetCount` 那一档、一声不投。
   *
   * ── 修法（⚠ 口径不变：⛔ 不猜、⛔ 不按工作区广播）──────────────────────
   *   帧里读不到 owner ⇒ 让上层**按卡 id 现读**（`taskboard_get` 的
   *   `createdBy.sessionId`，那正是 `I-3` 的第 ③ 条准入来源）。
   *   现读**读不到** ⇒ 仍然"判不出 ⇒ 不投"（⛔ 不许退化成广播）。
   * ⚠ 返回 `Promise<string|undefined>`：判不出/读不到都返回 `undefined`
   *   （调用方按"判不出"处理，⛔ 不许据此编一个收件人）。
   * ⚠ 缺省不传 ⇒ 行为与改前**逐字相同**（机检与旧调用形状照旧）。
   */
  ownerOf?: (taskId: string) => Promise<string | undefined>
  /**
   * ⚠⚠ **按卡现读"这张卡最近一次执行是谁在跑"**（2026-10-20 · 第 7 单；治「自己叫醒自己」）。
   *
   * ── 它补的是哪一格（⚠ 与 `ownerOf` 成对，⛔ 不可互相替代）──────────────
   *   `ownerOf` 回答"**该叫谁**"；本函数回答"**这次是谁跑的**"。
   *   两者**相等** ⇒ 那张卡的执行方就是收件人本人 ⇒ 它当然知道自己跑完了
   *   ⇒ **这一声不投**（见 {@link WakeState.selfExecutedCount} 的现场与机理）。
   *
   * ── 为什么必须**现读**，⛔ 不能从帧里拿 ────────────────────────────────
   *   帧是看板 `summarize()` 投影（`dsh-taskboard/lib/shared/protocol.js:965-987`）：
   *   里面**既没有 `createdBy`，也没有 `executions[].sessionId`**
   *   ⇒ 真帧上**永远**判不出执行方 ⇒ 只能按卡 id 现读（`taskboard_get` 的
   *   `executions[last].sessionId`，那正是 `lookupCardSession` 已经在读的字段）。
   *
   * ⚠ 返回 `Promise<string|undefined>`：读不到 ⇒ `undefined` ⇒ **这一道闸不生效**
   *   （退回既有行为：照常按 `owner` 投）—— ⚠ 这是**有意**的：
   *   本闸判的是"**能证明是我自己**"，⛔ 不是"判不出就拦"（那会把真正的回执也拦掉）。
   * ⚠ 缺省不传 ⇒ 行为与改前**逐字相同**（机检与旧调用形状照旧）。
   */
  execSessionOf?: (taskId: string) => Promise<string | undefined>
}

/** 去重表的**上限**（超过就丢最旧的 —— 丢的是很久以前那次，不影响"这次"）。 */
const SEEN_LIMIT = 512

/**
 * ══════════════════════════════════════════════════════════════════════
 * ⚠⚠ **`redelivered` 去重表的上限**（2026-10-21 · 第 340 轮 · **丙-14**）
 * ══════════════════════════════════════════════════════════════════════
 *
 * ── 为什么需要 ────────────────────────────────────────────────────────
 *   这张表记的是"这一条回执**已经补投过**"（去重键 `executionId@owner`）。
 *   ⚠ 改前**没有上限** ⇒ 每次补投都往里塞一条 ⇒ 长跑进程里**只增不减**。
 *   ⚠ 而 `delivered` / `firedSeen` 两张表都已有 `SEEN_LIMIT = 512` 的裁剪
 *     —— **这张表被漏掉了**（丙-14 的现场就是"台账无裁剪"）。
 *
 * ── 为什么也是 **512**（依据）────────────────────────────────────────────
 *   ⚠ 与 {@link SEEN_LIMIT} **同一个数**，理由也相同：这是**去重表**、
 *     不是审计台账 —— 它的用途只是"别把同一条补两次"。
 *     ⚠ 取更小（如 64）会让长会话里**较早的补投记录被裁掉** ⇒ 极端情况下
 *       同一条会被再补一次（重复送达）；取更大就等于**没加**。
 *   ⚠ 512 与另外两张表对齐 ⇒ **三张去重表同一口径**，⛔ 不另立一套。
 *
 * ⚠ ⚠ **按最旧优先裁，⛔ 不许整表清空**（整表清空会让去重**当场失效**）。
 * ⚠ **裁剪必须可读**（一行"已裁 N 条"）—— ⛔ 不许静默。
 */
const REDELIVERED_LIMIT = 512

/** 重连退避的起步与上限（毫秒）。 */
const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 30000

/**
 * ⚠⚠ **"合成执行键"的唯一生成点**（2026-10-20 · 第 321 轮 · `TASK-G` ③）。
 *
 * ── 它为什么必须导出（本件要治的那条缺陷）─────────────────────────────
 *   看板 SSE 推的是 `summarize()` 投影，**投影里没有 `executions`** ⇒ 帧上拿不到
 *   真正的 `execution.id` ⇒ 本模块**只能拼一个合成键**当去重键
 *   （`<卡 id>@<outcome>@v<version>`）。
 *   而 `CardReading`（`board-cards.ts` 的卡面读数）那边给的是**看板真 id**
 *   （`executions[].id`）。两处**各自生成、语义不同** ⇒
 *   `orchestrator.deliveryLedger()` 拿台账键（合成键）去 `snap.cards.find(c => c.executionId === row.executionId)`
 *   **永远不相等** ⇒ 台账**恒空**，并且渲染成「目前**没有**投递记录（这一档是"确实是空的"）」
 *   ⇒ 补投（`redeliver`）**永远拿不到可用的执行 id**，入口按不到。
 *   ⚠ 那不是"没有错投"，是"**没去比**"伪装成"比过且为空"—— 本项目头号禁忌。
 *
 * ── 修法（候选**甲**：一处生成、两处共用）──────────────────────────────
 *   `CardReading` 侧**补一个"合成键"字段**（`synthesizedExecutionId`），
 *   与本函数**用同一个实现**生成 ⇒ 比对时键空间**同源**。
 *   ⛔ 候选乙（`delivered` 台账改存真 id）被否：帧的 `summarize()` 没有 `executions`，
 *     拿真 id 只能"每次落定多读一次卡面" ⇒ 多一条读路径、成本高，且与本模块"不看卡面"的
 *     分工冲突。⛔ 也不许用"前缀匹配"（`t-a` 是 `t-ab` 的前缀 ⇒ 会误配）。
 *
 * @param cardId - 卡 id（帧里 `tasks[].id`）。
 * @param outcome - 执行结果字（`succeeded` / `failed` / `cancelled`）。
 * @param version - 卡的版本号（读到非有限数 ⇒ 当没有）。
 * @returns 稳定的合成键（同一张卡的同一次落定恒等；重跑 bump version ⇒ 键变）。
 */
export function synthesizedExecutionKey(cardId: string, outcome: string, version: unknown): string {
  const v = typeof version === 'number' && Number.isFinite(version) ? version : undefined
  return v === undefined ? `${cardId}@${outcome}` : `${cardId}@${outcome}@v${v}`
}

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
    //    ⚠⚠ 生成**只在这里**（{@link synthesizedExecutionKey}），⛔ 不许在别处再拼一遍
    //    —— `deliveryLedger()` 要拿它去卡面上比对，两处各拼一份必然漂。
    const executionId = synthesizedExecutionKey(id, outcome, t.version)
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
 * ⚠⚠ **从投递实现的返回值里读出"到底成没成"**（2026-10-20 · 第 321 轮 · `TASK-G` ①）。
 *
 * ── 改前是什么（本项目头号禁忌的形态：**让失败不可观测**）───────────────
 *   两处投递点**都丢掉了返回值**：
 *     · `CardWake.handleFrame` —— `await this.deliverFn(ownerResolved, text)`（不接）；
 *     · `DispatchWake.wake`   —— `const r: any = await this.opts.deliver(...)` 之后 `void r`。
 *   而 `hobBus.deliver` / `deliverInternal` 的契约是：**明确失败走 `{ok:false, reason}`**
 *   （`modules/bus.ts` 的 `DeliveryResult`：归档会话 / 非活会话 / 建消息失败 / 投递抛错
 *   全是 `ok:false`；**只有真异常才 reject**）。
 *   ⇒ 改前那些"明确失败"被当成成功：`wokeCount+1`、写"已叫醒"那句、
 *     覆盖"最近一次叫醒"字段，而 `reason` **连日志都没有**。
 *   ⚠ 同一份 bus 返回值，回传那条路径是**看 `ok`** 的（`orchestrator.ts` 的 `dispatch`）
 *     —— 一处看、一处不看，读出来就是"成了"，实际没成。
 *
 * ── 现在 ─────────────────────────────────────────────────────────────
 *   返回 `{ok:false}` ⇒ 交回**失败原话**；调用方据此落"没送到"那一档
 *   （`undeliveredCount`）并把原话**逐字**写进那句可读话（⛔ 不许只写"失败"两个字）。
 *
 * ⚠ 判据**刻意收窄**：只有 `ok === false` 才算失败。
 *   ⛔ **不**把"没有 `ok` 字段 / 不是对象"当失败 —— 老测试桩与第三方实现可能只 `resolve()`，
 *   把它们全打成失败就是拿"未知"冒充"失败"（本项目另一条禁忌）。
 *
 * ⚠ ⛔ **它只影响"记账"，⛔ 不影响"能不能重投"**（`D4`「至多投一次」**一个字不改**）：
 *   `markDelivered` / `s.reported` 仍然在投递**之前**落，失败**仍然不重投**。
 *
 * @param r - 投递实现的返回值（`DeliveryResult` 形状）。
 * @returns 失败原话；成功 / 判不出 ⇒ `undefined`。
 */
export function deliveryFailureOf(r: unknown): string | undefined {
  if (r === null || typeof r !== 'object') return undefined
  const o = r as { ok?: unknown; reason?: unknown }
  if (o.ok !== false) return undefined
  return typeof o.reason === 'string' && o.reason !== ''
    ? o.reason
    : '（投递实现返回 `ok:false`，但没有给 `reason`）'
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
    conn: 'idle', wokeCount: 0, noSubscriberCount: 0, legacyTargetCount: 0, redeliverOwnerUnknownCount: 0,
    undeliveredCount: 0, redeliveredCount: 0, selfExecutedCount: 0, seenCount: 0,
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
    /**
     * ── ⚠⚠ **`hello` 帧：只触发一次对账，⛔ 不当信号源**（2026-10-20 · B5 的 T4）──
     *
     * 改前这里是 `if (kind !== 'change') return 0` ⇒ 把 `hello` **直接丢掉**。
     * 后果：重连不补帧，而 `seenIds` / `firedSeen` 是内存去重表（重载即清零）
     * ⇒ 「重载 + 看板无新提交」= 这条通道**永不触发**（`DESIGN` §4.4 的 T4/T5 原文）。
     *
     * ⚠ 现在它**只做一件事**：把"该对账了"这件事告诉上层（`onHello`）。
     *   ⛔ **不投递任何回执**（回执的唯一发出点是**编排层的结算函数** `settle()`，
     *      在 `modules/orchestrator.ts` —— ⚠ **不在本文件**）；
     *      ⚠ **订正说明**（2026-10-21 第 333 轮 · **丁-8**）：原句只写「见 `settle()`」，
     *      读的人会以为它在本文件里 ⇒ 而本类**没有**这个方法（实测本文件 `settle(` 零命中）。
     *      `settle` 是编排层的局部函数（`orchestrator.ts` 里 `const settle = async (record, evidence)`）。
     *   ⛔ **不改变 `conn` / 计数**（它只是一次触发，不是一次"叫醒"）；
     *   ⚠ 返回值仍是 `0` —— 语义是"**这次没有叫醒任何人**"，⛔ 不许改成"叫了一次"。
     */
    if (kind === 'hello') {
      try { this.opts.onHello?.() } catch (e) {
        this.state = { ...this.state, note: `⚠ 收到 hello 帧但触发对账时出错（${String((e as Error)?.message ?? e)}）` }
        this.say(`[card-wake] ${this.state.note}`)
      }
      return 0
    }
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
      /**
       * ⚠⚠ **帧里没有 owner ⇒ 按卡 id 现读一次**（2026-10-20 · 第 4 单）。
       *
       * ⚠ 为什么必须有这一步：看板 `broadcast()` 推的是 `summarize()` 投影，
       *   **投影里没有 `createdBy`**（第三方包原文，见 `CardWakeOpts.ownerOf` 的注释）
       *   ⇒ 真帧上 `e.owner` **永远**是 `undefined` ⇒ 卡跑完**一声都叫不出去**
       *   （现场原文：`⚠ 有卡跑完（t-mvfertx2-zrnyvc …）但**判不出它的 owner**`）。
       * ⚠ 口径不变：现读**读不到** ⇒ 仍然"判不出 ⇒ 不投"（⛔ 不许改投、⛔ 不许广播）；
       *   读到了 ⇒ 它就是**该卡自己的** owner（`I-3` 第 ③ 条准入来源），⛔ 不是猜的。
       */
      /**
       * ⚠⚠ **收件人只来自这条记录自己的 owner**（`I-9` 的铁律，⛔ 一个字不改）：
       *   这一行是三条负向对拍的靶点（`R-f` / `S-D` / `SB-2b`）——
       *   ⛔ 不许改名、⛔ 不许改成 `let`（改了就等于让"按订阅表扇出"的变异体失去靶子）。
       *   ⚠ 帧里没有 owner 时的**按卡现读**另写一个变量（`ownerResolved`），
       *     由它决定"最终收件人"，但**起始值仍然只有 `e.owner` 这一个来源**。
       */
      const to = e.owner
      let ownerResolved = to
      if ((to === undefined || to === '') && typeof this.opts.ownerOf === 'function') {
        try {
          const read = await this.opts.ownerOf(e.taskId)
          if (typeof read === 'string' && read !== '') {
            ownerResolved = read
            /**
             * ⚠ 把现读到的 owner **回填到事件上**：同一帧里若还有别的卡，
             *   各自现读各自的；而"这条记录的 owner"在下面 `markDelivered` 之前必须已经定了。
             */
            e.owner = read
          }
        } catch (err) {
          this.say(`[card-wake] 按卡现读 owner 出错（${e.taskId}）：${String((err as Error)?.message ?? err)}`)
        }
      }
      if (ownerResolved === undefined || ownerResolved === '') {
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
       * ── ①b ⚠⚠ **执行方就是 owner 本人 ⇒ 这一声不投**（2026-10-20 · 第 7 单）──────────
       *
       * ⚠⚠ **位置必须在"定出 owner"之后、"订阅前提 / markDelivered / 投递"之前**：
       *   · 在"定出 owner"之前 ⇒ 判不了"是不是同一个人"；
       *   · 在 `markDelivered` 之后 ⇒ 这一声会被记成"已投"，往后真该投的那次反而被去重掉。
       *
       * ⚠ **为什么这是"自己叫醒自己"的正解，而不是再加一层去重**：
       *   这种"卡跑完"的**信号是真的**（看板确实给那张卡追加并结算了一次执行），
       *   错的只是**要不要通知**。⇒ 判据放在"通知"这一步，⛔ 不去改看板（第三方，`UD-82`），
       *   ⛔ 也不去改 `seenIds`（那会把真信号当成重复吞掉，下一张卡的同类问题就查不出来）。
       *
       * ⚠ **判据的两条边界（⛔ 都不许放宽）**：
       *   · `execSessionOf` **没给** 或 **读不到** ⇒ 本闸**不生效**，退回既有行为
       *     （退回"按 owner 投"）—— 本闸只拦"**能证明是我自己**"，
       *     ⛔ 不许做成"判不出就拦"（那会把真正的回执也一起拦掉）；
       *   · 判"是不是同一个人"用**严格相等**（会话 id 是宿主发的稳定字面量，
       *     ⛔ 不做前缀 / 模糊匹配 —— 那会把 `session-abc` 与 `session-abc-2` 判成同一个）。
       *
       * ⚠ **读数落独立一档**（{@link WakeState.selfExecutedCount}）：
       *   ⛔ 不并进 `legacyTargetCount`（判不出 owner）、⛔ 不并进 `undeliveredCount`（知道给谁但没送到）、
       *   ⛔ 不并进 `noSubscriberCount`、⛔ 更不许并进 `wokeCount`。
       */
      if (typeof this.opts.execSessionOf === 'function') {
        let execSid: string | undefined
        try {
          const read = await this.opts.execSessionOf(e.taskId)
          if (typeof read === 'string' && read !== '') execSid = read
        } catch (err) {
          /**
           * ⚠ 读执行方**抛错** ⇒ 本闸**不生效**（退回既有行为）+ 一句可读话。
           *   ⛔ 不许因为"读不到"就把这一声丢掉 —— 那是漏投，比自唤醒更坏。
           */
          this.say(`[card-wake] 按卡现读执行方出错（${e.taskId}）：${String((err as Error)?.message ?? err)}`
            + ' ⇒ 这一声按既有口径照常投（本闸只拦"能证明是我自己"的情形）')
        }
        if (execSid !== undefined && execSid === ownerResolved) {
          this.state = {
            ...this.state,
            selfExecutedCount: this.state.selfExecutedCount + 1,
            lastSelfExecutedCard: e.taskId,
            selfExecutedWhy: `⚠ 卡 ${e.taskId} 跑完了，但**执行方就是它的 owner 本人**`
              + `（${execSid}）⇒ 这一声**不投**`,
            note: `⚠ 卡 ${e.taskId}：执行方 = owner（${execSid}）⇒ **不叫醒**`
              + '（它自己跑完的，通知它没有信息量；⛔ 这不是漏投，也⛔ 不是判不出 owner）',
          }
          this.say(`[card-wake] ${this.state.note}`)
          continue
        }
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
      this.markDelivered(e.executionId, ownerResolved)
      // ── ④ 投递：**唯一一次**，⛔ 没有循环、⛔ 没有兜底 ─────────────────────────
      if (this.deliverFn === undefined) {
        this.state = { ...this.state, note: '⚠ 有卡跑完，但**投递通道没就绪**（hobBus 未提供）⇒ 这一声没叫出去' }
        this.say(`[card-wake] ${this.state.note}`)
        continue
      }
      try {
        /**
         * ⚠⚠ **接住返回值**（2026-10-20 · 第 321 轮 · `TASK-G` ①）：改前这一行是
         *   `await this.deliverFn(ownerResolved, text)` —— 返回值**直接丢掉**，
         *   于是 `hobBus` 返回 `{ok:false, reason}`（归档会话 / 非活会话 / 建消息失败）
         *   时照旧 `wokeCount+1`、照旧写"已叫醒"、照旧覆盖"最近一次叫醒"，
         *   而 `reason` **连日志都没有** ⇒ **"已叫醒"是假的**。
         */
        const r = await this.deliverFn(ownerResolved, text)
        const failure = deliveryFailureOf(r)
        if (failure !== undefined) {
          /**
           * ⚠ **`{ok:false}` 与"抛错"落同一档**（"知道给谁但没送到"）：对读的人来说
           *   这是同一件事；⛔ 但**不改重投语义**（`markDelivered` 已在上面落过，
           *   这一条**不会被再投一次** —— `D4` 一个字不改）。
           */
          this.state = {
            ...this.state,
            undeliveredCount: this.state.undeliveredCount + 1,
            lastUndeliveredTo: ownerResolved,
            note: `⚠ 叫醒 ${ownerResolved} 失败：${failure}`
              + `（卡 ${e.taskId}）⇒ 这是一条**漏投**：⛔ 不会改投别人，⛔ 也不会自动重投；`
              + '该 owner 读状态时会看到这一档',
          }
          this.say(`[card-wake] ${this.state.note}`)
          continue
        }
        woke++
        this.state = {
          ...this.state,
          wokeCount: this.state.wokeCount + 1,
          lastWokeAt: this.now(),
          lastWokeCard: e.taskId,
          note: `已叫醒 ${ownerResolved}（${e.taskId} 跑完 · ${e.outcome}）`
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
          lastUndeliveredTo: ownerResolved,
          note: `⚠ 叫醒 ${ownerResolved} 失败：${String((err as Error)?.message ?? err)}`
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
   *   ⛔ 不许猜、⛔ 不许改投别人。这一档记进**本支专有的**
   *   {@link WakeState.redeliverOwnerUnknownCount}（2026-10-19 拆档，`306-C83` §四）：
   *   ⚠ 它⛔ **不再**记进 `legacyTargetCount` —— 那个数只留"投递时判不出 owner"那一半，
   *     把"**有人按了补投**但补不了"混进去，就是本项目明令禁止的"两种原因说成同一句话"。
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
    //
    //   ⚠⚠ **2026-10-19 拆档（`306-C83` §四）**：这一支原来记的是
    //     `legacyTargetCount`（= 投递那一半的档）⇒ 一个数被两条路径共用，
    //     读的人分不出"投递时判不出归属"与"**有人按了补投**、但判不出归属"。
    //   ⇒ 现在挪进**本支专有**的 `redeliverOwnerUnknownCount`；
    //     `legacyTargetCount` 只留 `handleFrame` 里那一半（语义一字未改）。
    if (typeof owner !== 'string' || owner === '') {
      const why = `⚠ 有一条错投回执**补投不了**${card}：**判不出它该给谁**`
        + '（该卡没有 `createdBy.sessionId`：人工建的卡 / 卡片已被清掉）⇒ **这一份不补**；'
        + '⛔ 这不是"没有卡跑完"，⛔ 也不是"已经补过了"，'
        + '⛔ 更**没有**退回"按工作区广播 / 投给最后一个读过状态的人"'
      this.state = {
        ...this.state,
        redeliverOwnerUnknownCount: this.state.redeliverOwnerUnknownCount + 1,
        redeliverOwnerUnknownWhy: why,
        note: why,
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
    /**
     * ⚠⚠ **丙-14（2026-10-21 · 第 340 轮）：写入后就地裁剪，按最旧优先**。
     *   ⚠ 用 `Map` 的**插入顺序**当"年龄"（JS `Map` 保证迭代顺序 = 插入顺序）
     *     ⇒ 最早 `set` 的就在最前面 ⇒ 直接从头部删。
     *   ⚠ ⛔ **不许整表清空**：那会让去重当场失效（同一条会被再补一次）。
     *   ⚠ **必须可读**：裁剪发生时留一行"已裁 N 条"（⛔ 不许静默）。
     */
    if (this.redelivered.size > REDELIVERED_LIMIT) {
      const over = this.redelivered.size - REDELIVERED_LIMIT
      const olds = [...this.redelivered.keys()].slice(0, over)
      for (const k of olds) this.redelivered.delete(k)
      this.say(`[card-wake] **已裁 ${over} 条**旧的补投去重记录`
        + `（上限 ${REDELIVERED_LIMIT}；⚠ 只裁最旧的，⛔ 没有整表清空）`)
    }
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
      // ⚠ 拆档后的两档（2026-10-19 · `306-C83` §四）同样**跨重连保留** ——
      //   否则"重连一次就把'补投补不了'读成 0"，那正是本项目最忌讳的"没去读"伪装成"确实是空的"。
      redeliverOwnerUnknownCount: this.state.redeliverOwnerUnknownCount,
      ...(this.state.redeliverOwnerUnknownWhy === undefined
        ? {} : { redeliverOwnerUnknownWhy: this.state.redeliverOwnerUnknownWhy }),
      // ⚠ `I-10` 那一档也要跨重连保留（它是"我有一条回执没到"的唯一在内存读数）
      undeliveredCount: this.state.undeliveredCount,
      ...(this.state.lastUndeliveredTo === undefined ? {} : { lastUndeliveredTo: this.state.lastUndeliveredTo }),
      // ⚠ 补投那一档同样跨重连保留：它是"我补过几份"的唯一读数
      redeliveredCount: this.state.redeliveredCount,
      ...(this.state.lastRedeliveredTo === undefined ? {} : { lastRedeliveredTo: this.state.lastRedeliveredTo }),
      /**
       * ⚠⚠ **"执行方 = owner ⇒ 不叫醒"这一档也必须跨重连保留**（2026-10-20 · 第 7 单）。
       *   否则**一次重连就把这一档读成 0** —— 那正是本项目最忌讳的
       *   "没去读"伪装成"确实是空的"（同款纪律见上面那两档）。
       */
      selfExecutedCount: this.state.selfExecutedCount,
      ...(this.state.selfExecutedWhy === undefined ? {} : { selfExecutedWhy: this.state.selfExecutedWhy }),
      ...(this.state.lastSelfExecutedCard === undefined ? {} : { lastSelfExecutedCard: this.state.lastSelfExecutedCard }),
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
  /**
   * ⚠⚠ **投了，但投递实现明确回报"没送到"**（2026-10-20 · 第 321 轮 · `TASK-G` ①）。
   *
   * ⚠ 为什么必须与 `no-channel` 分开（本项目纪律：⛔ 两种原因不许说成同一句话）：
   *   · `no-channel` = **通道没就绪**（`hobBus` 未提供）⇒ 根本**没试着投**；
   *   · `undelivered` = **真投了**，对方的投递实现回 `{ok:false, reason}`
   *     ⇒ 知道给谁、也发了，但**没送到**。
   * ⚠ 改前这一档**不存在**：`{ok:false}` 被当成成功，返回 `'woke'` ⇒ 读数说"成了"。
   * ⛔ 它**不改变重投语义**（`D4`）：`s.reported` 早已置 true，这一轮**不会重投**。
   */
  | 'undelivered'
  /** ⚠ **判不出**：状态读不到 / 会话消失了 ⇒ ⛔ 既不是"跑完"也不是"没跑过"。 */
  | 'undecidable'

/**
 * 卡执行会话叫醒面的运行态（供 `hob_orch_status` 渲染）。
 *
 * ⚠ ⚠ **2026-10-20 · 本单 B4：这个读数面按 owner 分区了**（修 **W6**）。
 *   改前 `snapshot()` **无参**、所有计数都是**进程级合计** ⇒
 *   同一工作区里两个 Hob 会读到对方的登记 / 叫醒 / 判不出原话
 *   （`watches` 那一侧早已按 owner 分区，两处口径不一致正是 W6）。
 *   ⇒ 现在 {@link DispatchWake.snapshot} **必须带 owner**（**破坏性改签名**，
 *     DESIGN §七-5 采纳 A；⛔ 不做"无参版 + snapshotOf"两套并存 —— 两套必然漂，`E-128`）。
 *
 * ⚠ **三档必须成对报**（缺一即假话；DESIGN §4.6）：
 *   · 我的（`mine`）—— 本次调用方 owner 名下的登记 / 在跑；
 *   · **归属判不出**（`ownerUnknown`）—— 那些记录**没有 owner**，
 *     ⇒ 既不归我、也不归别人（⛔ 不许并进任何一边）；
 *   · **他人的（`othersOnly`）—— 只给条数**（⛔ 不许带卡号 / 会话 id / 明细）。
 *   ⚠ `owner === undefined` ⇒ **只报后两档**，⛔ **不许说"0 个"**（判不出"我"是谁时，
 *     "0" 是一句假话：它把"不知道"说成了"没有"）。
 */
export interface DispatchWakeState {
  /** 登记了多少个会话（去重后）。⚠ 带 owner 调 ⇒ **只算该 owner 的**。 */
  registered: number
  /** 其中正在跑的（见过 `running` 且还没叫）。⚠ 同上，只算该 owner 的。 */
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
   * ── ⚠⚠ **「点火帧到过几次」**（2026-10-20 · 第 323 轮 · `TASK-I`）──────────────
   *
   * ⚠ **为什么必须单独一个数**（本项目头号禁忌：两种原因说成同一句话）：
   *   头行改前只有 `pushedRegisterOk > 0 ? 已接上 : 还没接上（未收到过点火帧）`。
   *   而"还没接上"至少有三条成因，其中**两条根本没有帧**：
   *     · 真的一帧都没收到过；
   *     · **收到过帧，但从没走到"登记成功"**（被 `selfExecuted` / `owner ≠ subscriber`
   *       那两道准入拦下 —— 这是本机常态）；
   *     · 登记成功过，但按人读的那一档取不到。
   *   ⇒ 改前把第 2 种说成第 1 种，读的人会去查"为什么没有帧"，而该查的是准入那两道。
   *   现场实证（第 322 轮 `AFTER-RESTART.md`）：卡 `t-mvgb2v48-j6tx4o` 22:36:15 真点过火、
   *   `归属判不出` 11→12，而头行照样打"未收到过点火帧" ⇒ **那半句是假的**。
   *
   * ⚠ 语义：**收到过几帧点火**（按 owner 分区累计）。⛔ 它**不是**"登记成功数"
   *   （那是 `pushedRegisterOk`），也⛔ 不是"投递成功数"。
   */
  firingSeen: number
  /**
   * ── ⚠⚠ **「收到过点火帧、但一次都没走到登记成功」的次数 + 被哪道准入拦下的点名** ──
   *
   * ⚠ 这是上面 `firingSeen > 0 而 pushedRegisterOk === 0` 那个格子的**具体成因**：
   *   帧到了，但卡在中途被准入挡回。⛔ 两道准入是**设计**（`selfExecuted` / `owner ≠ subscriber`），
   *   ⛔ 不许为了让档位好看而放宽它们 —— 本档只是**把话说清**，不是放宽。
   *
   * ⚠ 语义：**累计**"帧到了但没登记成功"的条数（按 owner 分区）。
   * ⚠ 与 `pushRegisterIssues` **不是一档**（⛔ 不许合并）：
   *   · `pushRegisterIssues` = **读不到那张卡**（看板没装 / 卡没了 / `no-session`）；
   *   · 本档 = **卡读到了**，是**准入**把它挡回的（归属证明没通过）。
   */
  firedBlockedCount: number
  /**
   * 最近一次「帧到了但被准入拦下」的可读原话（⛔ 不许静默）：
   * 必须点名**是哪一道准入**（`selfExecuted` / `owner≠subscriber` / `owner 判不出`）。
   */
  firedBlockedWhy?: string
  /**
   * ⚠⚠ **「判不出归属 ⇒ 没登记」的独立一档**（`I-3` 末段）—— **累计事件计数**。
   *
   * ⚠ 判据：`register()` 收到的记录**没有 owner** ⇒ 不登记，记本档 + 可读话。
   * ⚠ ⛔ **不许与"没有卡在跑 / 没有会话在跑"混成一个计数**（本项目既有纪律）：
   *   那一个数说的是"确实没人在跑"，本档说的是"有人在跑，但我不知道它归谁"。
   *
   * ── ⚠⚠ **量纲：这是"累计到今天"，⛔ 不是"此刻有几条"**（2026-10-20 第 3 单修正）──
   *   ⚠ 它曾经被当成"归属判不出的**登记数**"塞进分区三档那一行（`我的 / 判不出 / 他人`），
   *     **而它其实是累计** ⇒ 那一行混装了两种量纲（现场读到 `归属判不出 960 个`）。
   *   ⇒ 现在**分区那一路只认 `ownerUnknownRegistered`（当前登记数）**；
   *     本字段只出现在"累计"那一行，并**在字段名与措辞上双双标"累计"**。
   *   ⚠ ⛔ 谁再把本字段塞进"覆盖全部登记"的判据，`SB-4` 会当场红。
   */
  ownerUnknownCount: number
  /** 最近一次"判不出归属"的可读原话（⛔ 不许静默）。 */
  ownerUnknownWhy?: string
  /**
   * ── ⚠⚠ **上面那个累计值的"去重键集"**（2026-10-20 第 3 单 · 修 960 重复计数）──
   *
   * ⚠ **960 是怎么来的**（实证见报告 §3）：
   *   `cardsOf()` 每被调用**一次**，就会对看板上**每一张"不是我建的"卡**各调一次
   *   `noteOwnerUnknown` ⇒ 累计数 = **卡数 × 读卡次数**。
   *   实测：12 张卡读 4 次 ⇒ `48`（12/24/36/48 每轮 +12）。
   *   ⇒ 那不是"有 960 张判不出归属的卡"，而是**同一批卡被反复计数 80 遍**。
   *
   * ⚠ 但**不能简单去掉**：它回答的是"I-3 这条准入门拦下过多少次"（有诊断价值）。
   *   ⇒ 现在改成**按 (cardId, executionId) 去重**累计：同一张卡的**同一次执行**
   *     只计一次；重新点火（`executionId` 变了）才再计一次。
   *   ⇒ 语义从"读卡次数 × 卡数"变成"**真正被判不出归属的(卡,执行)组合数**"。
   */
  /**
   * ⚠ **`ownerUnknownCount` 的口径说明**（随读数一起渲染，⛔ 不许只写在注释里）：
   * 它是"累计，按 (卡, 执行) 去重"—— 读的人必须能当场知道这件事。
   */
  ownerUnknownBasis?: string
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
  /**
   * ── ⚠⚠ **分区三档**（2026-10-20 · B4；修 **W6**）─────────────────────────
   *
   * ⚠ 三档**必须互斥且覆盖全部登记**（`check:orch` 的 `S-g` 钉的就是这一条）：
   *   `mine.registered + ownerUnknownCount + othersOnly === 全部登记数`，
   *   且**两两无交集**。缺一条就不是"分区"，而是"换个地方混着报"。
   */
  mine?: {
    /** 本次调用方 owner 自己名下的登记数。 */
    registered: number
    /** 其中在跑的（见过 `running` 且还没叫）。 */
    pending: number
  }
  /**
   * **归属判不出的登记数**（记录没有 `owner`）——
   * ⚠ 它**既不归我、也不归别人**（`I-1`：判不出 ≠ 归我），所以必须**单列一档**。
   */
  ownerUnknownRegistered: number
  /**
   * **他人的登记数（⚠ 只给条数）**—— ⛔ 不带卡号 / 会话 id / 执行 id。
   * ⚠ 明细一出现就等于把别人的账本又摊开了一次（`I-4` 的显式例外只允许条数）。
   */
  othersOnly: number
  /**
   * ⚠ **"我"判不出**（调用方没给 owner）⇒ 本读数**只报后两档**，
   * ⛔ **不许报"我的 = 0"** —— 那是把"不知道我是谁"说成"我没有登记"。
   */
  selfUndecidable?: true
}

/**
 * 「我自己派出去的实施会话」叫醒面。
 *
 * ⚠ **纯对象、不自己订阅事件**：`observe()` 由 M5 的 `agent/status` 监听喂进来
 *   ⇒ 便于机检用**假状态序列**喂真逻辑（不起真会话）。
 */
export class DispatchWake {
  private readonly sessions = new Map<string, DispatchedSession>()
  /**
   * ⚠ 进程级那一份（**跨 owner 的合计**）—— 它**仍然是给日志/自检用的原始计数**，
   *   而 `snapshot(owner)` 端出去的是**分区之后**的那一份（B4）。
   *   ⚠ 两者都留着是**有意**的：合计不能让读的人看见（那正是 W6），
   *     但"这个进程一共叫醒过几次"对排错有用 ⇒ 它只出现在日志里。
   */
  private state: DispatchWakeState = {
    registered: 0, pending: 0, wokeCount: 0, undecidableCount: 0,
    pushedRegisterOk: 0, pushRegisterIssues: 0,
    firingSeen: 0, firedBlockedCount: 0,
    ownerUnknownCount: 0, undeliverableCount: 0,
    ownerUnknownRegistered: 0, othersOnly: 0,
  }
  /**
   * ── ⚠⚠ **按 owner 分档的累计计数**（2026-10-20 · B4；修 **W6**）──────────────
   *   ⚠ 形态与既有 `relaysByOwner`（orchestrator 侧）**同款**（`Map<owner, number>`）——
   *     ⛔ 不另造一种写法（同一事实两个来源必然漂，`E-128`）。
   *   ⚠ 这些是**累计**（跨轮）：`snapshot(owner)` 只把该 owner 那一份端出来，
   *     ⛔ 不把它压回一个进程级合计（那正是 W6 的成因）。
   */
  private readonly ownedWoke = new Map<string, number>()
  private readonly ownedUndecidable = new Map<string, number>()
  private readonly ownedPushedOk = new Map<string, number>()
  private readonly ownedPushIssues = new Map<string, number>()
  private readonly ownedUndeliverable = new Map<string, number>()
  /**
   * ── ⚠⚠ **点火帧的两档，同样按 owner 分区**（2026-10-20 · 第 323 轮 · `TASK-I`）──
   *
   * ⚠ 形态与上面几条**逐字同款**（`bump()` + `Map<owner, number>`）——
   *   ⛔ 不另造一种写法（同一事实两个来源必然漂，`E-128`）。
   * ⚠ 为什么必须分区：头行是**按人读**的（`dispatchWakeState(selfId)`），
   *   若这两档取进程级合计，同一工作区两个 Hob 会读到对方的帧数（= W6 同族）。
   */
  private readonly ownedFiringSeen = new Map<string, number>()
  private readonly ownedFiredBlocked = new Map<string, number>()
  /**
   * ⚠⚠ **判不出归属的累计去重键集**（2026-10-20 第 3 单 · 修 **960**）。
   *
   * 键 = `` `${cardId}\u0000${executionId ?? '(无执行id)'}` ``。
   * ⚠ 与 `wake.delivered` 的 `executionId` 去重**同族纪律**：同一张卡的同一次执行只计一次；
   *   重新点火（`executionId` 变了）⇒ 应当再计一次（那确实是一次新的"判不出"）。
   * ⚠ 上限与 `SEEN_LIMIT` 同款（丢最旧），⛔ 不让它无限涨。
   */
  private readonly ownerUnknownSeen = new Set<string>()
  /**
   * ── ⚠⚠ **"判不出归属"的*当前*集合**（2026-10-20 第 3 单 · 修量纲混装）──────────
   *
   * ⚠ **为什么需要它**：分区三档承诺"互斥且覆盖全部登记"，而这一档的另外两个
   *   （`mine.registered` / `othersOnly`）都是**当前条数**。
   *   改前这一档直接拿 `ownerUnknownCount`（**累计**）来填 ⇒ 量纲混装
   *   （现场：`归属判不出 960 个`，而我的登记只有 1 个）。
   *
   * ⚠ 语义：**此刻仍处于"判不出归属"的 (卡, 执行) 组合**。
   *   · 加：`noteOwnerUnknown` 首次见到某个键；
   *   · 减：`register()` 成功登记了同一个 `sessionId`（说明归属后来判出来了）。
   * ⚠ ⛔ 不许把它当成"累计"用（累计是 `ownerUnknownCount` / `ownerUnknownSeen`）。
   */
  private readonly ownerUnknownLive = new Map<string, string>()
  /** 逐 owner 的"最近一次可读原话"（⛔ 不许把别人的原话串给读的人）。 */
  /**
   * ⚠ 逐 owner 的"最近一次可读原话"。
   *   ⚠ `firedBlocked` 是第 323 轮（`TASK-I`）新增的一档：**帧到了但被准入拦下**。
   *     ⛔ 不许并进 `push`（那是"读不到卡"），也不许并进 `undecidable`（那是"读不到会话状态"）。
   *   ⚠⚠ `ownerUnknown` 是第 345 轮新增的一档：**「归属判不出」那句原话也要按 owner 取**。
   *     ── 改前（=`this.state.ownerUnknownWhy`，进程级单值）的病 ────────────────
   *     A 读一次卡面，A 的读数里就会出现**B 的卡**（实证：`A.ownerUnknownWhy` 含 `t-b`，
   *     而 `t-b` 归 B）—— 与 `W6` 同族的"把别人的原话串给读的人"。
   *     ⚠ `sayFor` 本来就有这道防线（`whyByOwner` 的第一个用途就是它），
   *     只是 `ownerUnknown` 这一档当初**没走它**。
   */
  private readonly whyByOwner = new Map<string, {
    undecidable?: string; push?: string; undeliverable?: string; firedBlocked?: string
    ownerUnknown?: string
  }>()
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

  /** 记一次"某 owner 名下的某档 +1"（⛔ 无 owner ⇒ 不记给任何人，见各调用点的判据）。 */
  private bump(m: Map<string, number>, owner: string | undefined): void {
    if (typeof owner !== 'string' || owner === '') return
    m.set(owner, (m.get(owner) ?? 0) + 1)
  }

  /** 记一句"某 owner 名下的可读原话"（按字段分档，⛔ 不许互相顶替）。 */
  private sayFor(
    owner: string | undefined,
    field: 'undecidable' | 'push' | 'undeliverable' | 'firedBlocked' | 'ownerUnknown',
    why: string,
  ): void {
    if (typeof owner !== 'string' || owner === '') return
    const cur = this.whyByOwner.get(owner) ?? {}
    cur[field] = why
    this.whyByOwner.set(owner, cur)
  }

  setDeliver(fn: ((sessionId: string, text: string) => Promise<unknown>) | undefined): void {
    this.opts.deliver = fn
  }

  /**
   * 现读状态（渲染层只认这个）—— ⚠⚠ **必须带 owner**（2026-10-20 · B4，修 **W6**）。
   *
   * ── 改前（本缺陷的证据，`FINDINGS` W6 / `DESIGN` §4.6）──────────────
   *   `snapshot()` **无参**，`registered` / `pending` 与全部累计计数都是**进程级合计**
   *   ⇒ 同一工作区里两个 Hob 读到**对方的**登记数、叫醒数与"判不出"原话；
   *   而 `watches` 那一侧（`mineOnly`）**早就按 owner 分区** ⇒ 两处口径不一致。
   *
   * ── 现在 ──────────────────────────────────────────────────────────
   *   · `registered` / `pending` ⇒ **只算 `owner` 名下的**；
   *   · 其余累计计数（`wokeCount` / `undecidableCount` / …）⇒ 取**该 owner 名下**那一份
   *     （`Map<owner, number>`，与既有 `relaysByOwner` 同款形态）；
   *   · **三档成对报**：`mine` · `ownerUnknownRegistered`（判不出归属）· `othersOnly`（他人只给条数）；
   *   · `owner === undefined` ⇒ **只报后两档** + `selfUndecidable: true`，
   *     ⛔ **不许报"我的 = 0"**（那会把"不知道我是谁"说成"我没有登记"）。
   *
   * ⚠ ⚠ **这是破坏性改签名**（DESIGN §七-5 采纳 A）：⛔ 不许再加一个无参版并存
   *   —— 两套口径必然漂（`E-128`），而那正是 W6 的成因。
   */
  snapshot(owner?: string): DispatchWakeState {
    const all = [...this.sessions.values()]
    const self = typeof owner === 'string' && owner !== '' ? owner : undefined
    const owned = self === undefined ? [] : all.filter((s) => s.owner === self)
    const pendingOf = (rows: DispatchedSession[]): number =>
      rows.filter((s) => s.sawRunning && !s.reported).length
    /**
     * ── ⚠⚠ **"判不出归属"这一档要扣掉"后来判出来了的"**（2026-10-21 · 第 345 轮）──
     *
     * ── 改前是什么（分区三档的"互斥"当场被破）────────────────────────────
     *   `const ownerUnknownRegistered = this.ownerUnknownLive.size` —— **整个集合**的大小，
     *   ⛔ 不扣任何东西。而这个集合是**全进程共用**的：
     *   A 读一次卡面，凡"A 判不出归属"的卡都会进集合 —— 其中包含
     *   **已经明确归属给别人的**（A 视角"不是我的"，但 B 视角"就是我的"），
     *   以及**已经被 B 登记成功的**。
     *   ⇒ B 读数里同一张卡**同时出现**在 `我的登记` 与 `归属判不出` 里，
     *     三档**不再互斥**（`SA-g` 钉的正是"互斥"，但它直接喂 `register()`、
     *     ⛔ 绕过了 `cardsOf` 这个真实入口，所以它一直绿 —— 这正是本批要补的缺口）。
     *   ⚠ 第 344 轮现场形态：`我的登记 1 个 · 归属判不出 3 个`，而其中一条
     *     就是**已登记成功的那张自家卡**（被一次无身份读顺手记进了这一档）。
     *
     * ── 现在 ────────────────────────────────────────────────────────
     *   逐条判：**这个执行会话的归属，后来是不是已经判出来了**（在 `sessions` 里就是）。
     *   · 已判出 ⇒ **不算"判不出归属"**，从这一档扣掉（它已在 `mine` 或 `othersOnly` 里被数过）；
     *   · 仍判不出 ⇒ 留着。
     *   ⚠ 于是三档**真正互斥**：`sessions` 里的按 owner 分成 `mine` / `othersOnly`，
     *     `unknownLive` 里剩下的才是"谁都不算"的那一档。
     *   ⚠ 这一档**只给条数**（与 `othersOnly` 同款口径），⛔ 不许改成逐条展开。
     *   ⚠ `self === undefined` ⇒ 仍然照报这一档（它是"没有主人的记录数"，
     *     与"我是谁"无关）——⛔ 不许压成 0（那会把"有一堆判不出归属的记录"
     *     说成"一条都没有"，同族的假话）。
     */
    const ownerUnknownRegistered = [...this.ownerUnknownLive.values()]
      .filter((sid) => this.sessions.get(sid) === undefined).length
    /** 他人的：有 owner、但不是我的 ⇒ **只给条数**。 */
    const othersOnly = self === undefined
      ? all.filter((s) => typeof s.owner === 'string' && s.owner !== '').length
      : all.filter((s) => s.owner !== self && typeof s.owner === 'string' && s.owner !== '').length
    /**
     * ⚠ 累计计数按 owner 取：**没有该 owner 的条目 ⇒ 0，但只有 `self` 存在时才谈得上"0"**。
     *   ⚠ `self === undefined` 时这些计数**一律给 0 且带 `selfUndecidable`** ——
     *     渲染层据 `selfUndecidable` 报"判不出我是谁"，⛔ 不报"0 次"。
     */
    const countOf = (m: Map<string, number>): number => (self === undefined ? 0 : m.get(self) ?? 0)
    return {
      ...this.state,
      registered: owned.length,
      pending: pendingOf(owned),
      // ⚠ 累计计数**逐档按 owner 取**（改前是 `this.state` 里的进程级合计）
      wokeCount: this.ownedWoke.get(self ?? '') ?? 0,
      undecidableCount: this.ownedUndecidable.get(self ?? '') ?? 0,
      pushedRegisterOk: countOf(this.ownedPushedOk),
      pushRegisterIssues: this.ownedPushIssues.get(self ?? '') ?? 0,
      /**
       * ⚠⚠ **点火帧两档，按 owner 取**（`TASK-I`）：⛔ 不许落回进程级合计（= W6）。
       *   ⚠ `self === undefined` ⇒ 一律 0 + `selfUndecidable`，渲染层据此报"判不出我是谁"。
       */
      firingSeen: countOf(this.ownedFiringSeen),
      firedBlockedCount: countOf(this.ownedFiredBlocked),
      firedBlockedWhy: this.whyByOwner.get(self ?? '')?.firedBlocked,
      /**
       * ── ⚠⚠ **这里必须给"累计"，⛔ 不许给"此刻"**（2026-10-20 第 3 单 · 量纲分离）──
       *
       * ⚠ 改前这一行是 `ownerUnknownCount: ownerUnknownRegistered` ——
       *   把**分区字段（此刻）**的值喂给了**累计字段** ⇒ 两个字段恒等
       *   ⇒ 渲染层无论怎么改，读到的"累计"都只是"此刻"，
       *   而"此刻"早些时候又被喂成了累计 ⇒ **两者永远相等，量纲彻底糊在一起**。
       *   ⚠ 这也是我这次先改渲染、再改字段时 **SC-a 一直红**的直接原因
       *     （实证：`此刻=7 · 累计=7 · 两者相等=true`）。
       *
       * ⚠ 现在：累计 = `this.state.ownerUnknownCount`（**只增不减**的事件计数，
       *   按 `(卡, 执行)` 去重）；此刻 = `ownerUnknownRegistered`（分区字段）。
       */
      ownerUnknownCount: this.state.ownerUnknownCount,
      /**
       * ── ⚠⚠ **这句原话必须按 owner 取**（2026-10-21 · 第 345 轮）────────────────
       *
       * ⚠ 改前它来自上面那个 `...this.state` 展开 —— 即**进程级单值**，
       *   谁最后写就归谁读。实证：A 读一次卡面，**A 的读数里出现 B 的卡 `t-b`**
       *   （`t-b` 的 `createdBy` 是 B）；B 再读一次，A 也看见 B 那句。
       *   ⇒ 与 `W6` 完全同族：「把别人的原话串给读的人」。
       * ⚠ 现在照 `firedBlockedWhy`（紧邻上面那一行）的既有写法按 owner 取。
       * ⚠ `self === undefined` ⇒ `undefined`（⛔ 不许落回进程级单值 —— 那正是改前的形态）。
       **/
      ownerUnknownWhy: this.whyByOwner.get(self ?? '')?.ownerUnknown,
      undeliverableCount: countOf(this.ownedUndeliverable),
      mine: self === undefined
        ? undefined
        : { registered: owned.length, pending: pendingOf(owned) },
      ownerUnknownRegistered,
      othersOnly,
      ...(self === undefined ? { selfUndecidable: true as const } : {}),
    }
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
    /**
     * ── ⚠⚠ **执行方 ≠ owner**（2026-10-20 · 第 6 单 · Hob 裁定 §1.3）──────────────
     *
     * ── 现场（第 5 单取证，`FINDINGS` §一.2 / §六）──────────────────────────────
     *   卡 `t-mvfertx2-zrnyvc` 被反复点火 **20 次**，而这 20 次执行的 `sessionId`
     *   **全部 = `session-77d33ea8`（Hob 自己）**，卡的 `createdBy.sessionId` **也是**它。
     *   ⇒ 两处 `register()` 的准入（`createdBySessionId === subscriber` / `owner === self`）
     *     **都判"是我的卡"就登记**，而**没有一句查"执行方是不是就是我自己"**
     *   ⇒ 登记成"实施会话 = Hob" ⇒ `observe(Hob, idle)` ⇒ **Hob 自己 turn 结束就把它自己叫醒一次**
     *   ⇒ 用户连续收到 `[实施会话跑完] 会话 session-77d33ea8-… （第 1/2/3 轮）`。
     *
     * ── 判据（⚠ 一句话）──────────────────────────────────────────────────────
     *   **派活方（owner）不是它自己派出去的"实施会话"** —— owner 的 `running→idle`
     *   是**它自己在干活**，⛔ 不是"某个被派出去的活跑完了"。
     *   ⇒ `sessionId === owner` ⇒ **拒绝登记**，落一条可读话（⛔ 不许静默丢）。
     * ⚠ 这一道闸**只挡"自己登记自己"**，⛔ 不影响任何"别人派给我 / 我派给别人"的合法登记。
     */
    if (typeof entry.owner === 'string' && entry.owner !== '' && entry.owner === id) {
      this.state = {
        ...this.state,
        note: `⚠ **拒绝把 "${id}" 登记成"实施会话"**：它就是派活方自己（owner === sessionId）。`
          + '派活方的 `running → idle` 是**它自己在干活**，⛔ 不是"某个被派出去的活跑完了"；'
          + '登记它 ⇒ 每次它自己一轮跑完就把它自己叫醒一次（实测：连续 3 条「实施会话跑完」'
          + '报的都是派活方自己）。⇒ 这一声**不登记**（⛔ 这不是"没有会话在跑"）',
      }
      this.say(`[dispatch-wake] ${this.state.note}`)
      return
    }
    // ── 准入：**判不出归属 ⇒ 不登记**，落独立一档可读话（⛔ 不许猜、⛔ 不许按工作区兜）
    if (typeof entry.owner !== 'string' || entry.owner === '') {
      /**
       * ⚠ 判不出归属 ⇒ **不归任何人**（`I-1`）⇒ 只记进**进程级**那一档
       *   （`ownerUnknownCount` 是**跨 owner 的**"判不出归属"总数 —— 它不是"某个人的数"，
       *    因为这条记录**根本不属于任何人**；读数侧据它报"归属判不出"那一档）。
       */
      /**
       * ⚠ 与 `noteOwnerUnknown` 同一口径（第 3 单）：**累计按 (会话, ·) 去重**、
       *   **当前集合 `ownerUnknownLive` 单独维护**（分区那一档要用此刻的条数）。
       */
      const rkey = `${'\u0000register\u0000'}${id}`
      const firstTime = !this.ownerUnknownSeen.has(rkey)
      if (firstTime) this.ownerUnknownSeen.add(rkey)
      this.ownerUnknownLive.set(rkey, id)
      /**
       * ⚠ **这句同样要逐 owner 存**（第 345 轮）：`register()` 是**服务面**那道同款准入，
       *   它的可读话与 `noteOwnerUnknown`（准入面）走同一档 `ownerUnknown`。
       *   ⚠ 本档**本来就是"判不出归属"**，所以 owner 参数通常为空 ⇒ `sayFor` 不记给任何人
       *   （⛔ 不许落回进程级）。真出现 `entry.owner` 缺失但有调用方时，调用方无从得知，
       *   故这一档只保证"⛔ 不串给别人"，不保证"一定有人能看到"——
       *   那正是 `ownerUnknownCount`（进程级累计）留在那里的理由。
       */
      this.sayFor(entry.owner, 'ownerUnknown', `会话 ${id} 的归属**判不出**（没有 owner）⇒ **不登记**：`
        + '它跑完也不会叫醒任何人（⛔ 这不等于"没有会话在跑"，也⛔ 不是"它没跑完"）')
      this.state = {
        ...this.state,
        ...(firstTime ? { ownerUnknownCount: this.state.ownerUnknownCount + 1 } : {}),
        ownerUnknownBasis: '累计，按 (卡 id, 执行 id) 去重 —— ⛔ 不是"此刻有几张判不出归属的卡"',
        ownerUnknownWhy: `会话 ${id} 的归属**判不出**（没有 owner）⇒ **不登记**：`
          + '它跑完也不会叫醒任何人（⛔ 这不等于"没有会话在跑"，也⛔ 不是"它没跑完"）',
      }
      this.say(`[dispatch-wake] ${this.state.ownerUnknownWhy}`)
      return
    }
    /**
     * ⚠ **归属后来判出来了 ⇒ 从"当前判不出"集合里移出**（分区那一档必须跟着降）。
     *   ⚠ 按 `sessionId` 扫它（键是 (卡, 执行)，与 id 不同构，⛔ 不许硬套键）。
     */
    for (const [k, sid] of this.ownerUnknownLive) {
      if (sid === id) this.ownerUnknownLive.delete(k)
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
  noteOwnerUnknown(cardId: string, sessionId: string, why: string, executionId?: string,
    owner?: string,
    /**
     * ── ⚠⚠ **三种成因必须分开记**（2026-10-21 · 第 345 轮）────────────────────────
     *
     * ⚠ 改前它们**全挤进同一个 `ownerUnknownLive`** ⇒ 那个集合的大小既不是
     *   "判不出归属的条数"，也不是"我该管的条数"，而是**三种东西的和**：
     *     · `unknown`   = 真的判不出（`createdBy` 空）        ⇒ 谁的都不是
     *     · `other`     = 归属判出来了、是**别人**的          ⇒ 是**他人**那一档，⛔ 不是"判不出"
     *     · `selfExec`  = 归属判出来了、是**我**的，但执行方就是我 ⇒ 我**拒绝**登记，⛔ 也不是"判不出"
     *   ⇒ 读数里因此长成 `我的登记 1 个 · 归属判不出 3 个 · 他人的 0 个`，
     *     三档之和与"全部登记"对不上 —— 分区三档"互斥且覆盖全部登记"当场被破。
     *   ⚠ 更荒诞的是 `selfExec` 那一档：那张卡**明明是我的**（`createdBy === self`），
     *     却被印成"判不出归属"。
     * ⚠ 缺省 `'unknown'` ⇒ 旧调用形状**行为逐字相同**（机检里的既有调用不用改）。
     */
    reason: 'unknown' | 'other' | 'selfExec' = 'unknown'): void {
    /**
     * ── ⚠⚠ **这句原话要归到"读这个面的人"名下**（2026-10-21 · 第 345 轮）──────────
     *
     * ⚠ 改前它只写进 `this.state.ownerUnknownWhy`（**进程级单值**）⇒ **谁最后写谁读**：
     *   A 读一次卡面，A 的读数里就出现 **B 的卡**那句（实证见 `REPORT` §二-1）。
     * ⚠ 现在照同族既有写法走 `sayFor(owner, 'ownerUnknown', …)`（逐 owner 存）。
     *   ⚠ 与 `firedBlocked` **分开两个字段**（⛔ 不许互相顶替）：一个回答"回执不该给我"，
     *     另一个回答"帧到过、被准入挡了"，是两道不同的档。
     *   ⚠ `owner` 判不出（调用方没给）⇒ `sayFor` 自己会**不记给任何人**
     *     （⛔ 不许落回进程级 —— 那正是改前的形态）。
     * ⚠ 累计 `ownerUnknownCount` / `ownerUnknownBasis` **仍然进程级**（那是"跨 owner 的
     *   判不出归属总数"，本来就不属于任何人；口径一个字未改）。
     */
    /**
     * ⚠⚠ **措辞按成因分开**（第 345 轮）：改前三种成因**共用一句"归属判不出"**
     *   ⇒ `selfExec` 那张"明明是我的卡"被印成"判不出归属"（本项目头号禁忌的又一变种）。
     *   ⚠ 现在 `other` / `selfExec` 两档**不再自称"判不出"** ——
     *     它们的归属**判得明明白白**，只是"回执不该给我"。
     */
    const line = reason === 'selfExec'
      ? `卡 ${cardId}（执行会话 ${sessionId}）**归属是你自己的**，但**执行方就是你自己**`
        + ` ⇒ **不登记**：${why}`
        + ' —— ⛔ 这不等于"没有卡在跑"，也⛔ 不是"判不出它归谁"；'
        + '它自己跑完不是"某个被派出去的活跑完了"'
      : reason === 'other'
        ? `卡 ${cardId}（执行会话 ${sessionId}）**归属判出来了、是别人的** ⇒ **不登记**：${why}`
          + ' —— ⛔ 这不是"判不出归属"，是"**这张卡不该算给我**"；'
          + '该卡的回执只该回到它自己的 owner'
        : `卡 ${cardId}（执行会话 ${sessionId}）**归属判不出** ⇒ **不登记**：${why}`
          + ' —— ⛔ 这不等于"没有卡在跑"，也⛔ 不是"它没跑完"；'
          + '该卡的回执只该回到它自己的 owner'
    /**
     * ⚠⚠ **只有 `other` 那一档不许进"我这句原话"**（第 345 轮）——————
     *
     * ⚠ 判据是"**这句话是不是读者自己的事**"，不是"它严不严重"：
     *   · `unknown`（谁都判不出归谁）⇒ **是**读者的事：他该知道"有卡在跑但不该给我"；
     *   · `selfExec`（归属是**我自己**、只是执行方也是我）⇒ **是**读者的事：
     *     这正是"我拒绝登记我自己那张卡"的解释，§一 的反向对照要求它**话术必须点名**；
     *   · `other`（归属判出来了、**是别人**）⇒ **不是**读者的事 ——
     *     它已经在 `othersOnly` 里按"只给条数"的既有口径报过（⛔ 不许逐条展开别人的卡）。
     *
     * ⚠ 改前这一档**三种全收** ⇒ A 读一次卡面，A 的读数里就出现 **B 的卡**
     *   （实证：`A.ownerUnknownWhy` 含 `t-b`，而 `t-b` 归 B；B 根本没读过也照样拿到）。
     *   ⛔ 现在 `other` 一律不进 —— 这就是"⛔ 不许把别人的原话串给读的人"（`W6` 同族）。
     */
    if (reason !== 'other') this.sayFor(owner, 'ownerUnknown', line)
    /**
     * ── ⚠⚠ **按 `(cardId, executionId)` 去重**（2026-10-20 第 3 单 · 修 **960**）──────
     *
     * ⚠ 改前：每调一次就 `ownerUnknownCount + 1`，而 `cardsOf()` **每读一次卡面**
     *   就对**每一张别人的卡**调一次 ⇒ 累计 = **卡数 × 读卡次数**。
     *   现场实证（`tmp/probe-960.mjs`，12 张卡）：
     *     `第2次→12 · 第3次→24 · 第4次→36 · 第5次→48`  ← 每读一次 +12，纯重复计数。
     *   ⇒ 读数 `归属判不出 960 个` 让人以为"有 960 张别人的卡在跑"，**那是误导读数**。
     *
     * ⚠ 现在：同一张卡的**同一次执行**只计一次；`executionId` 变了（重新点火）再计。
     *   ⇒ 语义 = "**真正被判不出归属的 (卡, 执行) 组合数**"（累计），⛔ 不是"读卡次数"。
     * ⚠ 去重**只影响计数**，不影响可读话（逐 owner 那句每次仍然更新 —— 那句是诊断）。
     */
    const key = `${cardId}\u0000${executionId ?? '(无执行id)'}`
    if (this.ownerUnknownSeen.has(key)) {
      /**
       * ⚠ 重复计数 ⇒ 只刷新可读话，⛔ 不加数（这就是"同一次点火只计一次"）。
       *   ⚠ 刷新的是**逐 owner** 那一份（见上面 `sayFor`），⛔ 不再碰 `this.state` 那句。
       */
      this.say(`[dispatch-wake] ${line}`)
      return
    }
    this.ownerUnknownSeen.add(key)
    /**
     * ⚠⚠ **"此刻"按卡去重，⛔ 不按 (卡, 执行)** —— 这是"当前"与"累计"的**关键区别**：
     *   · **累计**（`ownerUnknownCount`）按 `(卡, 执行)` 去重：重新点火是一次**新的**判不出事件；
     *   · **当前**（`ownerUnknownLive`）按**卡**去重：同一张卡哪怕点过 5 次火，
     *     **此刻**它在等归属这件事仍然只是 **1 条**。
     *   ⚠ 若这里也按 `(卡,执行)` 记，重新点火就把"此刻"越刷越大 ——
     *     那等于把累计值换个名字塞回分区字段（正是本单要修的量纲混装）。
     */
    /**
     * ⚠⚠ **只有"真判不出"才进这个集合**（第 345 轮）：
     *   `other` / `selfExec` 两档的归属**已经判出来了**（分别是别人 / 我自己），
     *   它们⛔ 不是"判不出归属"⇒ 不许占这一档的名额。
     *   ⚠ 改前它们**三条都往这里塞** ⇒ 集合大小 = 三种成因之和
     *     ⇒ 分区三档之和与"全部登记"对不上（现场 `1+3+0=4 ≠ 1`）。
     *   ⚠ 顺手把这条会话先移出（改前就在做）：它若早先是"真判不出"、
     *     后来判出来了，这一档必须跟着降。
     */
    for (const [k, sid] of this.ownerUnknownLive) {
      if (sid === sessionId) this.ownerUnknownLive.delete(k)
    }
    if (reason === 'unknown') this.ownerUnknownLive.set(`card\u0000${cardId}`, sessionId)
    if (this.ownerUnknownSeen.size > SEEN_LIMIT) {
      const drop = this.ownerUnknownSeen.size - SEEN_LIMIT
      let i = 0
      for (const k of this.ownerUnknownSeen) {
        if (i++ >= drop) break
        this.ownerUnknownSeen.delete(k)
      }
    }
    this.state = {
      ...this.state,
      ownerUnknownCount: this.state.ownerUnknownCount + 1,
      ownerUnknownBasis: '累计，按 (卡 id, 执行 id) 去重 —— ⛔ 不是"此刻有几张判不出归属的卡"',
      /**
       * ⚠ **这个字段保留原义**：它现在是**进程级的"最近一次"**，只在日志/自检里用；
       *   ⛔ **渲染层不再读它**（`snapshot(owner)` 改读 `whyByOwner[...].ownerUnknown`，
       *   见 {@link snapshot}）—— 留着它是为了 `say()` 那条日志与原口径逐字相同，
       *   ⛔ 不是为了再当读数出口（那正是本批要修的"把别人的原话串给读的人"）。
       */
      ownerUnknownWhy: line,
    }
    this.say(`[dispatch-wake] ${this.state.ownerUnknownWhy}`)
  }

  /**
   * 记一次「**点火帧到了**」（2026-10-20 · 第 323 轮 · `TASK-I`）。
   *
   * ⚠ **为什么单独记"帧到了"**：改前头行只有"已接上 / 还没接上（未收到过点火帧）"两档，
   *   而"还没接上"至少三条成因，其中两条**根本没帧**。把"收到过帧但没登记成功"
   *   说成"未收到过点火帧"就是**两种原因说成同一句话**（本项目头号禁忌）。
   *   ⇒ 本方法是那一档的**唯一前提**：`firingSeen > 0 && pushedRegisterOk === 0`
   *     才谈得上"收到了但没成功"。
   *
   * ⚠ 它**不**代表登记成功（那是 {@link noteRegistryOk}），
   *   也**不**代表投递（那是 `delivered` 台账）。
   * ⚠ 每次**帧**记一次（不是每张卡、不是每次重连）：去重由调用方按 `firedSeen` 做。
   */
  noteFiringSeen(cardId: string, owner?: string): void {
    this.bump(this.ownedFiringSeen, owner)
    this.state = { ...this.state, firingSeen: this.state.firingSeen + 1 }
    this.say(`[dispatch-wake] 收到点火帧（卡 ${cardId}）⇒ 接下来按卡现读会话并登记`)
  }

  /**
   * 记一次「**收到过点火帧，但被准入拦下、没登记成功**」（`TASK-I` 的核心）。
   *
   * ⚠ **与 `noteRegistryIssue` 不是一档**（⛔ 不许合并）：
   *   · `noteRegistryIssue` = **读不到那张卡**（看板没装 / 卡没了 / `no-session`）；
   *   · 本方法 = **卡读到了**，是**归属准入**把它挡回的
   *     ⇒ 那不是失败，也不是"没有卡在跑"，而是"**这张卡的回执不该给我**"。
   * ⚠ ⛔ **不许因为本档存在就去放宽那两道准入** —— 准入是**设计**（`I-3`），
   *   本档只负责**把"被哪一道挡的"说出来**，⛔ 不是放宽的理由。
   *
   * @param gate - **哪一道准入**拦下的（渲染层要逐字点名，⛔ 不许笼统写"没登记成功"）：
   *   `self-executed`（执行方 = 建卡人自己）· `not-my-card`（`owner ≠ subscriber`）·
   *   `owner-unknown`（判不出归属）。
   */
  noteFiredBlocked(cardId: string, gate: 'self-executed' | 'not-my-card' | 'owner-unknown',
    why: string, owner?: string): void {
    this.bump(this.ownedFiredBlocked, owner)
    const gateText = gate === 'self-executed'
      ? '执行会话就是建卡会话本身（`selfExecuted`）'
      : gate === 'not-my-card'
        ? '这张卡不是本会话建的（`owner ≠ subscriber`）'
        : '判不出这张卡归谁（`owner` 读不到）'
    this.sayFor(owner, 'firedBlocked', `卡 ${cardId} 收到过点火帧，但被准入拦下（${gateText}）：${why}`)
    this.state = {
      ...this.state,
      firedBlockedCount: this.state.firedBlockedCount + 1,
      firedBlockedWhy: `卡 ${cardId} 收到过点火帧，但被准入拦下（${gateText}）：${why}`
        + ' —— ⛔ 这不等于"没收到过帧"，也⛔ 不是"没有卡在跑"',
    }
    this.say(`[dispatch-wake] ${this.state.firedBlockedWhy}`)
  }

  /**
   * 记一次「按推送现读会话**成功登记**」（2026-10-19 · 补缺口那一路）。
   *
   * ⚠ 它存在的唯一理由：让 `hob_orch_status` 能**一眼看出叫醒面接没接上**
   *   （作业书 §三-6）。⛔ 不许把它与"被谁读过卡面才登记"混成一个数。
   */
  noteRegistryOk(cardId: string, owner?: string): void {
    /**
     * ⚠ **按 owner 记**（B4）：这条计数的语义是"**我的**某个登记是靠推送现读成功的"
     *   ⇒ 它必须落到那个 owner 名下，否则同一工作区两个 Hob 会读到对方的数（W6）。
     */
    this.bump(this.ownedPushedOk, owner)
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
  noteRegistryIssue(cardId: string, kind: 'no-session' | 'unreadable', why: string, owner?: string): void {
    /**
     * ⚠ 单条"读不到"必须能分别归属（B4）：`registry` 是**谁在看卡面**触发的动作，
     *   其原话只该出现在**那个人**的读数里（⛔ 不许串台）。
     */
    this.bump(this.ownedPushIssues, owner)
    this.sayFor(owner, 'push', `${cardId} 按推送现读登记失败（${kind}）：${why}`)
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
      this.bump(this.ownedUndecidable, s.owner)
      this.sayFor(s.owner, 'undecidable', `会话 ${sessionId} 的状态**读不到**（事件里没有 status 字）`)
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
      this.bump(this.ownedUndeliverable, s.owner)
      this.sayFor(s.owner, 'undeliverable', `投递通道没就绪（hobBus 未提供）⇒ 会话 ${s.sessionId} 那一轮没叫出去`)
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
      /**
       * ⚠ **这里没有 owner 可记**（它正是"判不出该回给谁"那一档）⇒
       *   只进进程级那一档，⛔ 不**猜**一个 owner 去记（那正是 `I-1` 禁的）。
       */
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
      /**
       * ⚠⚠ **接住返回值**（2026-10-20 · 第 321 轮 · `TASK-G` ①）：
       *   改前这里是 `const r: any = await this.opts.deliver(target, text)` + `void r`
       *   —— 返回值被**显式丢掉**。而 `hobBus.deliver` 的契约是**失败走 `{ok:false, reason}`**
       *   ⇒ `{ok:false}` 时照旧 `bump(ownedWoke)` + `wokeCount+1` + 写"已叫醒"，
       *   而"没送到"的那个 `reason` **一个字都没留下** ⇒ 读数说"成了"、实际没成。
       *
       * ⚠ 两处改法**必须一致**（`CardWake.handleFrame` 用的是同一个
       *   {@link deliveryFailureOf}），⛔ 不许两处各写一份判据（两份必然漂）。
       * ⚠ **`{ok:false}` 与"抛错"落同一档**（"知道给谁但没送到"，`undeliverableCount`）；
       *   ⛔ **不改重投语义**：`observe()` 已先把 `s.reported` 置 true ⇒ 这一轮**不会重投**
       *   （`D4`「至多投一次」一个字不改）。
       */
      const r: unknown = await this.opts.deliver(target, text)
      const failure = deliveryFailureOf(r)
      if (failure !== undefined) {
        this.bump(this.ownedUndeliverable, target)
        this.sayFor(target, 'undeliverable', `回执**没送到**：${failure}`)
        this.state = {
          ...this.state,
          undeliverableCount: this.state.undeliverableCount + 1,
          undeliverableWhy: `回执**没送到** ${target}：${failure}`
            + `（会话 ${s.sessionId} 那一轮）⇒ 这是一条**漏投**：⛔ 不会改投别人，⛔ 不会自动重投`,
          note: `⚠ 叫醒 ${target} 失败：${failure}（会话 ${s.sessionId}）`
            + '⇒ 这是一条**漏投**：⛔ 不会改投别人，⛔ 也不会自动重投；该 owner 读状态时会看到这一档',
        }
        this.say(`[dispatch-wake] ${this.state.undeliverableWhy}`)
        return 'undelivered'
      }
      this.bump(this.ownedWoke, target)
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
      this.bump(this.ownedUndeliverable, target)
      this.sayFor(target, 'undeliverable', `回执**没送到**：${String((e as Error)?.message ?? e)}`)
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
