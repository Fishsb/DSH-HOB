/**
 * 编排运行态的**落盘**（跨插件重载仍可观测的那一份记录）。
 *
 * ══ 为什么需要它（本批实测暴露，对照实验已证）══════════════════════════
 *   `modules/orchestrator.ts` 的 `watches` 是**纯内存**的 `Map`，且建在
 *   `apply()` 的 `ctx.inject(['sessions','agents'], cb)` 回调**内部**。
 *
 *   实测（2026-10-09，本机实例**未重启**，只调 `dev_reload_package dsh-hob`）：
 *     · 重载前：`dsh-hob#521 / tools#522 / bus#523 / orchestrator#524 / settings#525`，
 *               `hobOrchestrator.status().watches.length = 1`
 *     · 重载后：`dsh-hob#529 / tools#530 / bus#531 / orchestrator#532 / settings#533`，
 *               `watches.length = 0`
 *   —— cordis 把该包的 6 个 fiber **全量重建**（旧 uid 全消失、新 uid 全出现），
 *   回调里的 `watches` 是**新建的空 Map**，而**没有任何东西**记下"曾经派过"。
 *
 *   派活方于是读到「在等回传 0 · 已回传 0 · 被停闸拦下 0」——
 *   **与"从来没派过"完全无法区分**。这正是用户报障的那个现象，
 *   也是 `relaysBlocked` 为 0 的原因（不是被刹车吞掉，是记录本身没了）。
 *
 * ⇒ 本模块把「未结算的派发」落一份盘：重载后被读回，
 *   交给 `hob_orch_status` 报出「曾经丢过 N 条」，并（尽力）唤醒派活方。
 *
 * ══ 落点（用户决策 UD-86 授权范围内）══════════════════════════════════
 *   `<账本目录>/runtime/orch-watches.json` —— 在账本目录**之内**，
 *   但**不是**三本账本（`DECISIONS.md` / `USER-DECISIONS.md` / `CONTEXT.md`）之一，
 *   是一个名字明确的**运行态**子目录。
 *
 *   ⚠ 账本目录由调用方（预设行的 `ledgerHome`）给出，本模块**不硬编码任何
 *     本机绝对路径**（可移植性口径 UD-73③）。
 *   ⚠ `runtime/` 自带 `.gitignore`（内容 `*`）⇒ 不会被账本仓跟踪 ——
 *     运行态**不进账本历史**（任务书 §2.1 第 4 条要求同批处理忽略）。
 *
 * ══ 重载后怎么处置：**先核再判**（2026-10-18 第 2 轮 · `UD-137` 裁定 3）══════
 *
 *   ⚠ 旧口径（2026-10-09 起）是**一律判死**：盘上任何 `pending` ⇒ 当上一代残留 ⇒
 *     记 `lost`、不重挂。§理由原文：`running → idle` 是**事件**、不是可轮询的状态，
 *     目标若在重载**之前**就跑完，那条跳变**永远不会再来** ⇒ 重挂会留一个**永不结算**的
 *     watch ⇒ 命中 `dispatch` 的「同目标至多一条未结算」闸门 ⇒ 该会话**永久不能再派**。
 *
 *   ⚠ ⚠ **那条理由只在"不区分目标状态"时才成立**：它描述的全是"已经跑完"这一档。
 *     ⇒ 新版**按目标此刻的状态分两档**（判据由调用方给，见 `markLost` 的 `classify`）：
 *       · **仍在跑**   ⇒ `'running'`      ⇒ **重新挂上**、继续等它跑完，回传照常送到；
 *       · **已空闲**   ⇒ `'idle'`         ⇒ 记 `lost`，**但必须说清属于这一档** + 给追回提示；
 *       · **判不出**   ⇒ `'unknown'`      ⇒ **按旧的保守方向处理**（记 lost、不重挂）——
 *                        ⚠ 拿不到状态时不许猜"它在跑"，猜错就是上面那个"永久不能再派"。
 *
 *   ⚠ **两类⛔ 不许混成一个 `lost` 计数**（用户 2026-10-18 原话）：档位**逐条**记在
 *     `lost[].lostClass` 上（本文件是它的**唯一存处**，⛔ 不许另写 sidecar、⛔ 不许借 `error`）。
 *     见 {@link LostClass} / {@link LostEntry}。
 *
 *   ⚠ **重挂不是"续上就完事"**：重新挂上的那条必须**接着等同一件事**（`reported=false`），
 *     且它仍受 `dispatch` 的同目标闸门约束 —— 这正是"仍在跑"这一档可以安全重挂的原因：
 *     它不是"补一个假 watch"，而是"那条记录本来就还在等"。
 *
 * ══ 写入纪律（镜像 `server/hob-write.ts`）═════════════════════════════
 *   · **原子写**（同目录 tmp → rename），避免半截 JSON；
 *   · **读侧宽容**：文件不存在 / 坏了 / 结构不对 ⇒ 返回空态，**不抛** ——
 *     一个诊断用途的账不该让编排模块起不来；
 *   · **写失败不掩盖**：返回 `false`，由调用方记日志（绝不静默）。
 *
 * ⚠ 本模块**不 import `config.ts`**（同 `hob-write.ts` 的纪律）：
 *   配置由调用方以参数传入，便于独立测试、也避免模块间反向依赖。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 运行态子目录名（账本目录**之内**、非账本）。 */
export const ORCH_STATE_SUBDIR = 'runtime'

/** 运行态文件名（名字明确：编排的"在等回传"记录）。 */
export const ORCH_STATE_FILENAME = 'orch-watches.json'

/** 结构版本（将来改结构时用它判新旧，而不是猜字段）。 */
export const ORCH_STATE_VERSION = 1

/**
 * **丢失档位**（2026-10-18 第 2 轮 · `UD-137` 裁定 3 新增）。
 *
 * ⚠ ⚠ **用户原话**：「两类**不许混成一个 lost 计数** —— 用户要能一眼看出
 *   '这条真丢了'还是'这条其实做完了、去看看'」。
 * ⇒ 所以在**落盘记录上逐条**带一个档位，⛔ 不是只加一个总数。
 *
 * 三档（第三档是**判不出**，⛔ 不许并进前两档）：
 * · `'running'`  —— 重载时目标**仍在跑** ⇒ **必须重新挂上**（不该走到 lost 里）；
 *                   ⚠ 它出现在 `lost` 里只说明一处**异常路径**（重挂失败），
 *                   故它也有自己的档位，⛔ 不与 `'idle'` 合并。
 * · `'idle'`     —— 重载时目标**已空闲（跑完了）** ⇒ 真 lost，**但可追回**
 *                   （去那个会话看它最近一轮）。⚠ 机制补不回来：那一刻的事件已经没了。
 * · `'unknown'`  —— **判不出**目标状态 ⇒ 按旧的保守方向处理（记 lost、不重挂）。
 *                   ⚠ 这一档**不是**"真丢了"，也**不是**"做完了" —— 它是**看不清**，
 *                   混进任何一档都是把不确定性说成结论。
 */
export type LostClass = 'running' | 'idle' | 'unknown'

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
const SETTLE_STATES = ['waiting', 'unresolved', 'stuck'] as const

/** 结算证据的**运行时集合**（{@link SettleEvidence} 的同源副本）。 */
const SETTLE_EVIDENCES = ['event', 'board', 'session-log', 'agent-status'] as const

/**
 * **重核多少轮仍判不出 ⇒ 升 `stuck`**（`K = 3`，本单 B3）。
 *
 * ⚠ ⚠ 为什么必须有它：`unresolved` 是**可重入态**，若没有上限，一个永远读不到的目标
 *   会让对账**每轮都白撞一次**（那是"无限重试"，⛔ 与本单要治的"永久丢"正好是两个极端）。
 * ⚠ 到顶后的行为：**停止自动重试** + 读数里单列 `stuck` 一档 + **明说"需人工裁"**。
 */
export const STUCK_AFTER_RECHECKS = 3

/**
 * ══════════════════════════════════════════════════════════════════════
 * ⚠⚠ **清账重试多少次仍失败 ⇒ 放弃重试、转 `stuck`**（2026-10-21 · 第 334 轮 · **丙-1**）
 * ══════════════════════════════════════════════════════════════════════
 *
 * ── 为什么必须有它（`PROJECT-SURVEY-3` §6.3 丙-1，**唯一有盘上活证据的一条**）─────
 *   改前：`finalizeDelivery` 失败后**没有上限、没有转 `stuck` 的分支**，每轮对账重试、
 *   每次把 `cleanupFailedAt` 刷成新时间戳 ⇒ **永不收敛**。
 *   ⚠ 现场实证：`runtime/orch-watches.json` 里一条记录**同时带 `deliveredAt` 与
 *   `cleanupFailedAt`**，后者比前者晚约 **4035 秒**（≈ 67 分钟）**仍在**。
 *   ⚠ 后果不是"性能差"，而是**读数被污染**：用户每天看的那一行「在等回传」里
 *   挂着一条**其实早就送到**的记录 ⇒ 那一档的可信度整体下降。
 *
 * ── 为什么是 **20**（⚠ 依据，不是随手取的数）──────────────────────────
 *   · **下界**：清账失败的实际成因是**写盘瞬时故障**（ENOSPC 一时腾出来了 / 被信号打断 /
 *     权限临时不可用）。这类故障**一次对账就是一次机会**，而本插件的对账节拍是
 *     **按事件 + 重核退避**（秒级到分钟级）⇒ 20 次 ≈ **十几分钟到一小时**的跨度，
 *     足以跨过"临时"这个窗口。
 *   · **上界**：现场那条挂了 **67 分钟**仍无归宿 ⇒ 需要一个**明显短于它的上限**
 *     才能证明"这套逻辑真的收得掉"；20 次落在那之内。
 *   · ⚠ **不取更大**（如 100）：那会让"永不收敛"在用户视角上**与 20 无差别**
 *     —— 反正都要等到烦。⚠ **也不取更小**（如 3）：写盘瞬时故障在 3 次内全中**并非罕见**
 *     （磁盘满是最常见的成因，而"腾出空间"往往要人动手）⇒ 太小会把**能自愈的**判死。
 *
 * ⚠ ⚠ **到顶之后不是"丢掉"**：转 `stuck` 并**保留 `cleanupFailedAt` 与失败原因**
 *   （⛔ 不许清证据）。`stuck` 的既有语义正好是"**停止自动重试 + 需人工裁**"。
 * ⚠ ⛔ **不新增第 4 个状态**：`R2` 的三档定义（`waiting` / `unresolved` / `stuck`）**不动**。
 */
export const CLEANUP_RETRY_LIMIT = 20

/**
 * ══════════════════════════════════════════════════════════════════════
 * ⚠⚠ **`hob_orch_status` 单次输出的展开上限**（2026-10-21 · 第 339 轮 · **丙-13**）
 * ══════════════════════════════════════════════════════════════════════
 *
 * ── 为什么需要 ────────────────────────────────────────────────────────
 *   改前只有投递台账有上限（`DELIVERY_LIST_MAX = 8`），而 `watches` 行 / `handoffs` 行 /
 *   卡行**逐条展开、没有总量上限** ⇒ 账本增长后单次读数会**挤压上下文**。
 *   ⚠ 而 `hob_orch_status` 是**高频工具**（T2 每次 `hob_*` 都会触发对账），两者叠加。
 *
 * ── 为什么是 **10**（依据）──────────────────────────────────────────────
 *   · 与既有的 `DELIVERY_LIST_MAX = 8` **同量级** —— 那一条是同类读数（逐条展开）的
 *     既有裁定，⛔ 不另立一套相差很大的口径；
 *   · `10` 行 × 三处 ≈ 30 行，加上其余固定行仍在一个**可读**的规模内；
 *   · ⚠ 取更小（如 3）会让"正常账本"也频繁触发裁剪 ⇒ 读数变得难以判断；
 *   · ⚠ 取更大（如 50）就等于**没加**（账本真长起来照样爆）。
 *
 * ⚠ ⚠ **超出部分必须印一行"还有 N 条未展开"** —— ⛔ 不许静默截断：
 *   那会把"账本很长"说成"只有这么多"（本项目最忌讳的那一格）。
 * ⚠ **"未展开"的数与"已展开"的数必须分开印、⛔ 不许相加**（量纲不同）。
 */
export const STATUS_LIST_MAX = 10

/**
 * ══════════════════════════════════════════════════════════════════════
 * ⚠⚠ **回执送不出去、总线连续缺席多少次 ⇒ 停止重试**（2026-10-21 · 第 335 轮 · **丙-11**）
 * ══════════════════════════════════════════════════════════════════════
 *
 * ── 这个数管什么 ──────────────────────────────────────────────────────
 *   `settle()` 在 `bus` 缺席时**只落 `error`**、且（改前）**不复位 `reported`**
 *   ⇒ 那一代的事件路径**永久泄气**。修复要复位 `reported`，但复位会带来一个新风险：
 *   若 `bus` **长期**缺席，每一轮都会复位一次 ⇒ **每轮空转**。
 *   ⇒ 本上限就是那道闸：撞满 `RELAY_BUS_MISS_LIMIT` 次就**停止复位**
 *     （让 `reported` 停在 `true`，该条变成"试够了"的残骸，`hob_dispatch` 据此可重派）。
 *
 * ⚠ ⚠ **⛔ 不与 `CLEANUP_RETRY_LIMIT` 共用计数器**（两者的成因完全不同）：
 *   · `CLEANUP_RETRY_LIMIT` —— "**已经送到**、只是盘没写进去"（修法是查磁盘/权限）；
 *   · 本常量               —— "**一次都没送出去**（总线不在）"（修法是查总线/重启）。
 *   压成同一个数，就等于把"送到了但没记账"与"根本没送到"说成同一句话。
 *
 * ── 为什么是 **3**（⚠ 依据）──────────────────────────────────────────
 *   · 总线缺席**不是瞬时抖动**：`hobBus` 是本插件自己的服务，它"不在"通常意味着
 *     **`bus` 模块关着 / 装载失败 / 服务被卸载** —— 那是**结构性**的，⛔ 不是一两次的运气。
 *   · ⇒ 给它 3 次机会足够把"装载竞态"那种**极短窗口**跨过去（插件刚激活时
 *     `tools` 可能先于 `bus` 就绪），而**不会**让"结构性缺席"白白空转一整晚。
 *   · ⚠ 取更大（如 20）会把"每轮空转"拖得很长；取 1 则会**误判装载竞态**。
 *
 * ⚠ 计数**只在内存**（`relayBusMiss`），进程重载即清零 —— 与 `reported` 同款纪律
 *   （它本来就是"本代"的事）。⛔ 不落盘：落盘正是丙-1 那个"写不进去还硬要写"的坑。
 */
export const RELAY_BUS_MISS_LIMIT = 3

/**
 * 落盘的一条"未结算派发"（是 `Watch` 的可序列化子集 + 工作区归属）。
 *
 * ⚠ `lostClass` 只在**进入 `lost`** 时被写（`pending` 里的记录**没有**这个字段）——
 *   它是"**为什么被判丢失**"的档位，只有被判丢失时才存在。
 */
export interface PersistedWatch {
  /** 被派发的会话（执行方）。 */
  target: string
  /** 派活方会话（回传的收件人）。 */
  watcher: string
  /** 第几轮（调用方自己数）。 */
  round?: number
  /** 派了什么。 */
  task?: string
  /** 登记时间（毫秒）。 */
  at: number
  /** 是否已见它进入 `running`。 */
  sawRunning: boolean
  /** 回传失败原因（有值 = 试过没送回去的残骸）。 */
  error?: string
  /** 这条记录属于哪个**工作区根**（决定了它落在哪个账本目录下）。 */
  wsRoot?: string
  /**
   * ⚠⚠ **这条派发记录自己的 owner**（= 派活方会话 id；`I-1`）。
   *
   * ⚠ **它就是回执的唯一收件人** —— 改前收件人只存在于一个**进程级单值**里
   * （`DispatchWake` 的 `opts.selfSessionId`）⇒ 任何会话读一次状态就把它刷成自己
   * ⇒ A 派出去的活的回执投给了 B 的 Hob。
   *
   * ⚠ **向后兼容（`I-1` 明令）**：旧文件没有这个字段 ⇒ 读成 `undefined` = **"无归属"**，
   *   ⛔ **不许判坏**、⛔ **不许猜一个默认 owner**。无归属的记录到点后
   *   **不投** + 落一条可读话（⛔ 不许退化成"投给最后一个摸过状态的人"）。
   */
  owner?: string
  /**
   * **被判丢失的档位**（2026-10-18 第 2 轮 · `UD-137` 裁定 3）。
   *
   * ⚠ 只有**进了 `lost`** 的记录才带它；`pending` 里带它没有意义（还没判）。
   * ⚠ 向后兼容：旧文件没有这个字段 ⇒ 读成 `'unknown'`
   *   （⚠ 旧记录**当时确实没判过状态**，读成 `'unknown'` 是**如实**的，
   *     ⛔ 不许读成 `'idle'` —— 那等于替旧数据编一个它没有的结论）。
   */
  lostClass?: LostClass
  /**
   * ── ⚠⚠ **耐久化四件**（2026-10-20 · 本单 B2；诊断出处见 `FINDINGS` P2/W3/W4 与 `DESIGN` §4.3）──
   *
   * ⚠ ⚠ 为什么要落盘这四件：`pending` 现在是**唯一权威**，而重载后要接着办三件事 ——
   *   ① 判"从 running 掉下来了吗"（`lastStatus`）· ② 结算完知道该写回哪个文件（`stateFile`）
   *   · ③ 判不出时能证明"**真的又核过**"而不是干等着（`recheckCount` / `lastRecheckAt`）。
   *   改前这四件只有 `lastStatus` 在内存里（{@link PersistedWatch} 无此字段），
   *   `stateFileFor` 是内存 `Map` 且**重挂路径从不写它** ⇒ 重挂等于白挂（W3/W4）。
   *
   * ⚠ **全部向后兼容**：旧文件没有这些字段 ⇒ 读成 `undefined`，⛔ 不判坏、⛔ 不猜默认值。
   *   （`settleState` 缺字段 ⇒ 调用方按 `'waiting'` 读：旧记录本来就在等，这是如实，不是猜。）
   */
  lastStatus?: string
  /** 这条记录**该写回哪个运行态文件**（修 W4：重挂时也写，否则结算后盘上残留）。 */
  stateFile?: string
  /** 结算态三档（{@link SettleState}）；缺字段 ⇒ 调用方读成 `'waiting'`。 */
  settleState?: SettleState
  /** **又核了几轮**（`unresolved` 每被判一次 +1；到 {@link STUCK_AFTER_RECHECKS} ⇒ `stuck`）。 */
  recheckCount?: number
  /** 最近一次重核的时刻（毫秒）。 */
  lastRecheckAt?: number
  /** **凭哪条真相源结的账**（{@link SettleEvidence}）—— 结算时写，⛔ 只在真结算时写。 */
  evidence?: SettleEvidence
  /**
   * ── ⚠⚠ **投递三件**（2026-10-20 · 第 4 单；`Watch` 同名同义）──────────────────
   *
   * ⚠ 它们存在的唯一理由：**`reported` 只在内存里**。进程一重载，内存那张表清零 ⇒
   *   一条"已经发出去过"的记录会被下一代**当成没发过，再发一份**
   *   （现场：同一份第 3 轮报告送到派活方眼前 4 次）。
   *   任务书明写"幂等必须是**双层的**：进程内（`reported`）**和**跨进程/跨代（盘上状态）"，
   *   这三个字段就是**跨代那一层**。
   *
   * ⚠ 三者语义**各不相同**，⛔ 不许合并成一个"已投"布尔：
   *   · `deliveryAttemptAt` —— **投之前**落的"试过了"（先写后发，同 `CardWake.markDelivered`）；
   *   · `deliveredAt`      —— 投**成功**的时刻 ⇒ 该条只差清账，**⛔ 绝不再发**；
   *   · `cleanupFailedAt`  —— 送到了、但**清账（写盘）失败** ⇒ 下一轮**只重试清账**。
   * ⚠ 全部向后兼容：旧文件没有 ⇒ 读成 `undefined`，⛔ 不判坏、⛔ 不猜默认值
   *   （"没记过"就是"不知道投过没有"，按老口径重试 —— 但那一条已经是既成事实）。
   */
  deliveryAttemptAt?: number
  deliveredAt?: number
  cleanupFailedAt?: number
  /**
   * ══════════════════════════════════════════════════════════════════════
   * ⚠⚠ **清账重试次数**（2026-10-21 · 第 334 轮 · **丙-1**）
   * ══════════════════════════════════════════════════════════════════════
   *
   * ── 为什么必须有这个数（丙-1 的根因）──────────────────────────────────
   *   只靠 `cleanupFailedAt`（一个**时间戳**）**判不出试了几次** ——
   *   每轮重试都把它刷成新时间 ⇒ ⚠ **永远看起来"刚刚失败过一次"**
   *   ⇒ 没有上限、没有收敛、没有归宿（现场：一条记录挂了约 **67 分钟**仍在）。
   *   ⇒ 现在**单独记次数**：它单调递增、**⛔ 不因重试而被刷新成 1**。
   *
   * ⚠ 与 `recheckCount` **不是一回事**（⛔ 不许合并）：
   *   · `recheckCount` —— "**判不出**（`unresolved`）时又核过几次"（`STUCK_AFTER_RECHECKS` 管它）；
   *   · 本字段       —— "**已经送到、但清账一直失败**时重试了几次"（`CLEANUP_RETRY_LIMIT` 管它）。
   *   ⚠ 两者成因完全不同：前者是"不知道对方跑完没有"，后者是"知道送到了、只是盘没写进去"。
   *     压成一个数就会让"哪件事在耗着"重新变得不可分辨。
   *
   * ⚠ 向后兼容：旧文件没有 ⇒ `undefined`（读成 0 次），⛔ 不判坏。
   */
  cleanupRetryCount?: number
}

/**
 * 落盘的一条**待投递**中间态（2026-10-10 · 用户报障修复）。
 *
 * ── 为什么需要它（与上面的"重载抹 watch"是**同一个病的两面**）──────────
 *   `write_hob`（写 `archive/<日期>/TASK.md`）与 `hob_dispatch`（投递）是
 *   **两个独立工具调用**，中间没有耦合；而 `watches` **只在投递成功之后**才登记
 *   （见 `orchestrator.ts` 的 `dispatch`）⇒ **"写了文件但没投"这件事，
 *   系统里根本不存在** ⇒ 状态输出无法把它与"无事可做"区分开。
 *   实测：第 9 轮与第 21 轮各发生一次，**两次都是用户发现的**，
 *   现场读数逐字相同（`在等回传：0 个`）。
 *   ⇒ 本结构把**第一步做完、第二步没做**这件事**落一份记录**。
 */
export interface PersistedHandoff {
  /** 待投递的是什么：交接文件 / 新建但尚未派指令的会话。 */
  kind: 'task-file' | 'spawned-session'
  /** 交接文件的账本区相对路径，或新会话 id。 */
  ref: string
  /** 记录产生时刻（毫秒）。 */
  at: number
  /** 可选备注（如"第 21 轮"，由调用方给）。 */
  note?: string
  /** 这条记录属于哪个**工作区根**（决定它落在哪个账本目录下）。 */
  wsRoot?: string
  /**
   * ⚠⚠ **这条待投递记录属于哪个会话**（`I-6`：`hob_spawn` 建出的会话必须记下 owner）。
   *
   * ⚠ 它让"**建了会话却没投**"这条账能回答"**是谁欠的这一投**" —— 改前只有 `wsRoot`，
   *   同一工作区里两个 Hob 各建一个会话时，两边的读数**无法分辨**哪条是自己的。
   * ⚠ 向后兼容：旧文件没有 ⇒ `undefined` = 无归属（⛔ 不判坏、⛔ 不猜）。
   */
  owner?: string
  /**
   * **有意人工转达**（2026-10-10 第 44 轮 · 结构改造②）—— `true` = 这是**有意**
   * 交给用户手工带过去的，**不是忘了投**。
   *
   * ⚠ 它存在的唯一理由：让"**有意转达**"与"**漏投**"**可区分** ——
   *   后者才是缺陷。没有它，两种情形在状态输出里长得**逐字一样**
   *   （都是"待投递：N 份"），于是"有意转达"会持续制造**假告警**，
   *   而**假告警会训练人忽略真告警**（这才是它真正的代价）。
   *
   * ⚠ **向后兼容**：旧文件没有这个字段 ⇒ 读成 `false`（不抛、不判坏）。
   */
  manual?: true
}

/** 落盘文件的整体结构。 */
export interface OrchStateFile {
  version: number
  /** 最后一次写入时刻（毫秒）。 */
  updatedAt: number
  /** **未结算**的派发（插件活着时写的；重载后会被挪进 `lost`）。 */
  pending: PersistedWatch[]
  /** **已确认丢失**的派发（重载那次挪过来的；供 `hob_orch_status` 报"丢过"）。 */
  lost: PersistedWatch[]
  /** 最近一次"发现丢失"的时刻（毫秒）。 */
  lostAt?: number
  /**
   * **待投递**的中间态（2026-10-10 新增）—— "写了/建了，但还没投出去"。
   *
   * ⚠ **向后兼容**：旧文件没有这个字段 ⇒ 读成**空数组**（不抛、不判坏）。
   *   理由同 `lost`：一份**诊断用途**的运行态不该因缺字段而读不进来。
   */
  handoffs: PersistedHandoff[]
  /**
   * ⚠⚠ **会话 → owner 的绑定表**（`I-6`：`hob_spawn` 建出的会话必须记下 owner，跨重载可见）。
   *
   * ── 它治的缺陷 ────────────────────────────────────────────────────
   *   改前"这个会话是谁建的"**只活在内存里**（`watches` / `DispatchWake.sessions`），
   *   重载后全丢 ⇒ 建出的会话变成"无归属"，回执再找不到主人。
   *   ⚠ 而用户的要求是"**Hob 预设和它创建的会话必须绑定**"（结构性，不是少错一次）。
   *
   * ⚠ **向后兼容**（`I-1`）：旧文件没有这个字段 ⇒ 读成**空数组**，
   *   ⛔ 不判坏、⛔ **不猜一个默认 owner**（空表 = 谁都还没绑定）。
   */
  sessions: PersistedSessionBinding[]
}

/**
 * **一条"会话归谁"的绑定**（`I-6`）。
 *
 * ⚠ 一旦写下来就**不可改绑**：改绑会让已经派出去的活的回执送到别人手里
 *   ⇒ 改绑必须**显式报错**（调用方在 `dispatch` / `hob_spawn` 那一侧拦）。
 */
export interface PersistedSessionBinding {
  /** 被绑定的会话 id。 */
  sessionId: string
  /** 它的 owner（= 建它 / 第一次派它的那个会话）。 */
  owner: string
  /** owner 的工作区根（诊断与分区用；判不出 ⇒ 不填）。 */
  ownerWsRoot?: string
  /** 绑定时刻（毫秒）。 */
  at: number
  /** 怎么绑上的：`spawn` = 本 owner 建的；`dispatch` = 第一次派发时绑定（甲案）。 */
  via: 'spawn' | 'dispatch'
}

/** 空态（文件不存在/坏了时的返回值）。 */
export function emptyOrchState(): OrchStateFile {
  return { version: ORCH_STATE_VERSION, updatedAt: 0, pending: [], lost: [], handoffs: [], sessions: [] }
}

/**
 * ── ⚠ ⚠ **可达性**（2026-10-16 · 第 247 轮 / `TASK-R207`）────────────────────
 *
 * ⚠ **它治的缺陷**（第 243 轮实测 · `REPORT-R205.md` §3.2-c）：`readOrchState` 把
 *   **"文件不存在 / 读不了 / JSON 坏"** 三种情形**一律** `catch ⇒ emptyOrchState()` ——
 *   ⚠ ⚠ 于是"**够不到账本**"与"**这个工作区真的从来没派过**"给出**逐字相同**的读数
 *   （`pending: 0 · lost: 0 · handoffs: 0`）。⚠ 读者以为"就是 0"。
 *
 * ⚠ ⚠ **为什么不能只看"文件在不在"**（本单实测的关键）：⚠ 改前实测三态 ——
 *   ① **真派过**（账本在 + 运行态文件在）· ② **真的没派过**（账本在 + 运行态文件**不在**）·
 *   ③ **够不到**（**账本根都不在**）⇒ ⚠ ② 与 ③ 的**运行态文件都不存在** ⇒
 *   ⚠ ⚠ **只看文件存在性区分不了 ② 与 ③**。
 *   ⇒ ⚠ **判别量必须是"账本根在不在"** —— 它正是"够不到"这件事本身
 *     （⚠ 而账本根**按本机路径解析**、⛔ 不核存在性，见 `doc-read.ts:72-91`）。
 *
 * ⚠ ⚠ **四条取值（⛔ 不许合并）**：
 *   · `ok`                 —— 文件读到且解析成功（**有过记录**）；
 *   · `no-records-yet`     —— **账本根在**、但运行态文件**还不存在** ⇒ ⚠ **这是真实状态**
 *                            （"从来没派过"），⛔ **不是失败** ⇒ ⛔ 不改它的输出（作业书 §3(a)）；
 *   · `ledger-unreachable` —— **账本根不存在** ⇒ ⚠ ⚠ **这才是"够不到"** ⇒ **要给可读标记**；
 *   · `unreadable`         —— 账本根在、文件也在，但**读不了 / JSON 坏** ⇒ **要给可读标记**。
 */
export type StateReachability = 'ok' | 'no-records-yet' | 'ledger-unreachable' | 'unreadable'

/** 带可达性的读数结果（{@link readOrchStateDetailed} 的返回）。 */
export interface OrchStateReading {
  state: OrchStateFile
  /** ⚠ **"够不到"与"空"就是靠它分开的**（⛔ 不要把它丢掉只留 `state`）。 */
  reachability: StateReachability
  /**
   * ── ⚠⚠ **落盘文件里的原始 `version`**（2026-10-24 · 本单必修 7 新增）────────
   *
   * ⚠ **为什么必须单独带出来**：{@link narrowOrchState} 的宽容口径会把"版本不认识"
   *   **静默读成当前版本**（缺字段 / 数字不对 ⇒ 用 {@link ORCH_STATE_VERSION} 填）。
   *   读侧这么写是对的（旧文件必须读得进），但**写侧不能**顺着它重写：
   *   ⚠ 那等于把一份"未来/未知结构"的文件**降级成我这一代的结构**并落盘
   *   ⇒ 丢掉旧版本里我不认识的字段（`P3-①` 点名的形态）。
   *
   * ⇒ 本字段只在**真的读到文件**（`reachability === 'ok'`）时给出：
   *   · `known === true`  —— 文件里的 version 与 {@link ORCH_STATE_VERSION} 一致；
   *   · `known === false` —— 不认识（`found` 是原值，可能是 `undefined` / 字符串 / 别的数）。
   * ⚠ **它不参与渲染**（状态行照旧按 `reachability` 四档；⛔ 不给正常档加任何标记）——
   *   它只服务**写入前的守卫**（{@link readOrchStateForWrite}）。
   */
  version?: { found: unknown; known: boolean }
}

/**
 * 由运行态**文件路径**反推它所属的**账本根**。
 *
 * ⚠ 依据 {@link orchStateFileOf}：`file = join(ledgerRoot, 'runtime', 'orch-watches.json')`
 *   ⇒ **倒推两级**即账本根。⚠ 本函数是**唯一**的倒推实现点 ——
 *   若将来 {@link ORCH_STATE_SUBDIR} 改深度，这里必须同批改（否则判别量失效）。
 */
export function ledgerRootOfStateFile(file: string): string {
  return dirname(dirname(file))
}

/**
 * 读落盘状态 **并如实报出可达性**（⚠ 这是本单新增的**唯一**取数入口）。
 *
 * ⚠ 与 {@link readOrchState} 的关系：后者**原样保留**（= 本函数 `.state`），
 *   ⚠ 因为既有调用点与既有判据（`check:orch` 的 F1/F3）都按它的形状取值 ⇒
 *   ⛔ **不动它的签名与返回形状**，只**新增**一个更详细的入口。
 *
 * ⚠ `readOrchState` 的**宽容口径一条不放松**：本函数同样**绝不抛**
 *   （一个坏文件不该让 `status()` 崩掉）；⚠ 它只是**把"为什么是空"如实带上**。
 */
export function readOrchStateDetailed(file: string): OrchStateReading {
  // ── 判别量：**账本根在不在**（⚠ 不是"文件在不在" —— 见 `StateReachability` 注释）──
  if (!existsSync(ledgerRootOfStateFile(file))) {
    return { state: emptyOrchState(), reachability: 'ledger-unreachable' }
  }
  if (!existsSync(file)) {
    // ⚠ **账本在、只是还没有记录** ⇒ 真实状态（"从来没派过"），⛔ 不是失败。
    return { state: emptyOrchState(), reachability: 'no-records-yet' }
  }
  try {
    const raw = readFileSync(file, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { state: emptyOrchState(), reachability: 'unreadable' }
    }
    const o = parsed as Record<string, unknown>
    return {
      state: narrowOrchState(o),
      reachability: 'ok',
      // ⚠ 原始 version 如实带出（⛔ 不用 `narrowOrchState` 补过默认值的那一份 —— 那就看不出来了）
      version: { found: o.version, known: o.version === ORCH_STATE_VERSION },
    }
  } catch {
    // ⚠ 文件在却读不了 / JSON 坏 ⇒ **可读地报出来**（⛔ 不与"没有记录"混）
    return { state: emptyOrchState(), reachability: 'unreadable' }
  }
}

/** `<账本目录>` ⇒ 本模块的落盘文件路径。 */
export function orchStateFileOf(ledgerRoot: string): string {
  return join(ledgerRoot, ORCH_STATE_SUBDIR, ORCH_STATE_FILENAME)
}

/**
 * 宽容地把一条 JSON 记录**收窄**成 {@link PersistedWatch}。
 *
 * ⚠ 为什么要收窄而不是 `as`：文件是**跨版本、跨进程**读的 ——
 *   直接 `as` 会让一个坏字段（比如 `round: "2"`）一路漂到 `hob_orch_status`
 *   的输出里，表现为"回传信息看起来对但其实是垃圾"。
 *   这里**逐字段判类型**，判不出就丢那一条（丢一条 ≠ 让整次读取失败）。
 */
function asWatch(v: unknown): PersistedWatch | undefined {
  if (v === null || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (typeof o.target !== 'string' || o.target === '') return undefined
  if (typeof o.watcher !== 'string') return undefined
  if (typeof o.at !== 'number' || !Number.isFinite(o.at)) return undefined
  const out: PersistedWatch = {
    target: o.target,
    watcher: o.watcher,
    at: o.at,
    sawRunning: o.sawRunning === true,
  }
  if (typeof o.round === 'number' && Number.isFinite(o.round)) out.round = o.round
  if (typeof o.task === 'string') out.task = o.task
  if (typeof o.error === 'string') out.error = o.error
  if (typeof o.wsRoot === 'string' && o.wsRoot !== '') out.wsRoot = o.wsRoot
  /**
   * ⚠ **owner 的宽容读法**（`I-1`）：与 `wsRoot` 同一纪律 —— 是字符串且非空才收。
   *   ⚠ 缺字段 / 类型不对 ⇒ **不填**（= 无归属），⛔ **不判坏整条记录**。
   *   ⛔ 绝不在这里"补一个默认 owner" —— 那会把别人的回执投给猜出来的会话。
   */
  if (typeof o.owner === 'string' && o.owner !== '') out.owner = o.owner
  // ── **丢失档位**（2026-10-18 第 2 轮 · `UD-137` 裁定 3 / D1）────────────
  //   ⚠ 这就是 D1 的"单一来源"落点：档位**只**从这里进内存，⛔ 不另写 sidecar。
  //   ⚠ 判据必须是**集合内**（同 `asHandoff` 的 `kind` 纪律）：一个拼错的档位
  //     （如 `'runnning'`）若放行，会漂到状态行里，表现为"说了一档、其实是脏值"。
  //   ⚠ 不在集合内 ⇒ **不填**（= 调用方读成 `'unknown'`），⛔ 不许猜成某一档。
  if (typeof o.lostClass === 'string' && (LOST_CLASSES as readonly string[]).includes(o.lostClass)) {
    out.lostClass = o.lostClass as LostClass
  }
  // ── **耐久化四件**（2026-10-20 · B2）：与 `lostClass` 同一条宽容纪律 ──────────
  //   ⚠ 逐字段判类型/判集合，判不出 ⇒ **不填**（⛔ 不许猜一个默认值）：
  //     一个拼错的 `settleState`（如 `'unresovled'`）若放行，会漂到读数里，
  //     表现为"说它还在重核、其实是个脏值" —— 那是把不确定性说成结论。
  if (typeof o.lastStatus === 'string' && o.lastStatus !== '') out.lastStatus = o.lastStatus
  if (typeof o.stateFile === 'string' && o.stateFile !== '') out.stateFile = o.stateFile
  if (typeof o.settleState === 'string' && (SETTLE_STATES as readonly string[]).includes(o.settleState)) {
    out.settleState = o.settleState as SettleState
  }
  if (typeof o.recheckCount === 'number' && Number.isFinite(o.recheckCount) && o.recheckCount >= 0) {
    out.recheckCount = o.recheckCount
  }
  if (typeof o.lastRecheckAt === 'number' && Number.isFinite(o.lastRecheckAt)) out.lastRecheckAt = o.lastRecheckAt
  if (typeof o.evidence === 'string' && (SETTLE_EVIDENCES as readonly string[]).includes(o.evidence)) {
    out.evidence = o.evidence as SettleEvidence
  }
  /**
   * ── **投递三件**（2026-10-20 · 第 4 单）：与上面同一条宽容纪律 ──────────────
   *   ⚠ 判据是"有限数字"；类型不对 ⇒ **不填**（⛔ 不许读成 0 —— 0 是一个合法的"很旧的时刻"，
   *     而这里"没记过"与"记了个坏值"是两件事，都只能落成"不知道"）。
   */
  for (const k of ['deliveryAttemptAt', 'deliveredAt', 'cleanupFailedAt', 'cleanupRetryCount'] as const) {
    const v = (o as Record<string, unknown>)[k]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v
  }
  return out
}

/** 丢失档位的**运行时集合**（{@link LostClass} 的同源副本，供收窄时逐值判）。 */
const LOST_CLASSES = ['running', 'idle', 'unknown'] as const

/** 把数组字段读成 `PersistedWatch[]`（逐条收窄，坏的丢掉）。 */
function asWatchList(v: unknown): PersistedWatch[] {
  if (!Array.isArray(v)) return []
  const out: PersistedWatch[] = []
  for (const item of v) {
    const w = asWatch(item)
    if (w !== undefined) out.push(w)
  }
  return out
}

/** 待投递记录的两种 kind（与 {@link PersistedHandoff.kind} 同源，运行时也要判）。 */
const HANDOFF_KINDS = ['task-file', 'spawned-session'] as const

/**
 * 宽容地把一条 JSON 记录**收窄**成 {@link PersistedHandoff}（纪律同 {@link asWatch}）。
 *
 * ⚠ `kind` 必须**在集合内**：一个拼错的 `kind`（如 `'taskfile'`）若放行，
 *   就会漂到状态输出里，表现为"有一条待投递，但看不出是什么"。
 */
function asHandoff(v: unknown): PersistedHandoff | undefined {
  if (v === null || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (typeof o.kind !== 'string') return undefined
  if (!(HANDOFF_KINDS as readonly string[]).includes(o.kind)) return undefined
  if (typeof o.ref !== 'string' || o.ref === '') return undefined
  if (typeof o.at !== 'number' || !Number.isFinite(o.at)) return undefined
  const out: PersistedHandoff = {
    kind: o.kind as PersistedHandoff['kind'],
    ref: o.ref,
    at: o.at,
  }
  if (typeof o.note === 'string' && o.note !== '') out.note = o.note
  if (typeof o.wsRoot === 'string' && o.wsRoot !== '') out.wsRoot = o.wsRoot
  // ⚠ `owner` 的宽容读法（`I-6`）：与 `wsRoot` 同纪律，缺字段 ⇒ 无归属（⛔ 不判坏、⛔ 不猜）
  if (typeof o.owner === 'string' && o.owner !== '') out.owner = o.owner
  // ⚠ **严格只认 `true`**（`o.manual === true`）：`"true"` / `1` 这类宽松值**不收**
  //   —— 判宽了会让"漏投"被误标成"有意转达"，那比缺字段更坏（把缺陷说成设计）。
  if (o.manual === true) out.manual = true
  return out
}

/** 把数组字段读成 `PersistedHandoff[]`（逐条收窄，坏的丢掉）。 */
function asHandoffList(v: unknown): PersistedHandoff[] {
  if (!Array.isArray(v)) return []
  const out: PersistedHandoff[] = []
  for (const item of v) {
    const h = asHandoff(item)
    if (h !== undefined) out.push(h)
  }
  return out
}

/**
 * 宽容地把一条 JSON 记录收窄成 {@link PersistedSessionBinding}（纪律同 {@link asWatch}）。
 *
 * ⚠ 逐字段判类型：判不出就**丢那一条**（丢一条 ≠ 让整次读取失败）。
 * ⚠ ⛔ 绝不在这里"补一个默认 owner" —— 那会把别人的回执投给猜出来的会话。
 */
function asBinding(v: unknown): PersistedSessionBinding | undefined {
  if (v === null || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (typeof o.sessionId !== 'string' || o.sessionId === '') return undefined
  if (typeof o.owner !== 'string' || o.owner === '') return undefined
  if (typeof o.at !== 'number' || !Number.isFinite(o.at)) return undefined
  if (o.via !== 'spawn' && o.via !== 'dispatch') return undefined
  const out: PersistedSessionBinding = {
    sessionId: o.sessionId,
    owner: o.owner,
    at: o.at,
    via: o.via,
  }
  if (typeof o.ownerWsRoot === 'string' && o.ownerWsRoot !== '') out.ownerWsRoot = o.ownerWsRoot
  return out
}

/** 把数组字段读成 `PersistedSessionBinding[]`（逐条收窄，坏的丢掉）。 */
function asBindingList(v: unknown): PersistedSessionBinding[] {
  if (!Array.isArray(v)) return []
  const out: PersistedSessionBinding[] = []
  for (const item of v) {
    const b = asBinding(item)
    if (b !== undefined) out.push(b)
  }
  return out
}

/**
 * 把一个**已解析的普通对象**收窄成 {@link OrchStateFile}（⚠ 缺字段一律按宽容口径读）。
 *
 * ⚠ 抽出来是为了让 {@link readOrchState} 与 {@link readOrchStateDetailed}
 *   **共用同一份收窄实现** —— 否则"两处各写一份"必然漂移（本仓分层纪律）。
 */
function narrowOrchState(o: Record<string, unknown>): OrchStateFile {
  const out: OrchStateFile = {
    version: typeof o.version === 'number' ? o.version : ORCH_STATE_VERSION,
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : 0,
    pending: asWatchList(o.pending),
    lost: asWatchList(o.lost),
    // ⚠ **向后兼容**（本轮核心要求之一）：旧文件没有 `handoffs` 字段 ⇒
    //   `asHandoffList(undefined)` = `[]` ⇒ 读成**空数组**，**不抛、不判坏**。
    //   这正与 `lost` 同款纪律：缺字段 ≠ 文件坏了（运行态是诊断用途）。
    handoffs: asHandoffList(o.handoffs),
    // ⚠ **向后兼容**（`I-6`）：旧文件没有 `sessions` ⇒ 空数组（⛔ 不判坏、⛔ 不猜归属）
    sessions: asBindingList(o.sessions),
  }
  if (typeof o.lostAt === 'number' && Number.isFinite(o.lostAt)) out.lostAt = o.lostAt
  return out
}

/**
 * 读落盘状态（**宽容**：文件不在/坏了/结构不对 ⇒ 空态，绝不抛）。
 *
 * ⚠ 判据是"能不能用"，不是"文件在不在"：`readFileSync` 成功但内容不是 JSON
 *   必须与"文件不存在"走同一条路 —— 否则一个被写坏的文件会让编排模块
 *   在每次 `status()` 时抛异常。
 *
 * ⚠ ⚠ **本函数的分辨力已知不足**（2026-10-16 第 247 轮 · `TASK-R207`）：
 *   它把"**够不到账本**"与"**真的没有记录**"读成**同一个空态**。
 *   ⚠ **要分辨 ⇒ 用 {@link readOrchStateDetailed}**（⚠ 本函数**原样保留**：
 *   既有调用点与 `check:orch` 的 F1/F3 都按它的形状取值，⛔ 不改签名）。
 */
export function readOrchState(file: string): OrchStateFile {
  try {
    const raw = readFileSync(file, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return emptyOrchState()
    return narrowOrchState(parsed as Record<string, unknown>)
  } catch {
    return emptyOrchState()
  }
}

/**
 * 原子写落盘状态（同目录 tmp → rename）。
 *
 * @returns 是否写成功。**失败不抛** —— 由调用方记日志（一个记不上账的
 *   诊断不该让编排的主流程崩掉；但也绝不静默：返回值必须被消费）。
 */
/**
 * ══════════════════════════════════════════════════════════════════════
 * ⚠⚠ **进程内单写者队列**（2026-10-21 · 第 338 轮 · **丙-5**）
 * ══════════════════════════════════════════════════════════════════════
 *
 * ── 为什么需要它（`PROJECT-SURVEY-3` §6.3 丙-5）────────────────────────
 *   全仓 `grep -rnE "O_EXCL|flock|lockfile|withLock|mutex|\.lock'"` 在 `src/` + `scripts/`
 *   = **0 命中** ⇒ 五个写函数全是**无锁的「读 → 改 → 写」**。
 *   ⚠ `writeOrchState` 的 `tmp → rename` 只防**半截文件**，⛔ **不防丢更新**：
 *     A 读到旧盘 → B 读旧盘 → B 写 → A 写 ⇒ **B 的改动被 A 的旧快照覆盖掉**。
 *   ⚠ 而 `orchestrator.persistOwnerPartition` 与 `bus.noteHandoff` 写**同一个文件**、
 *     两个模块各自持有一份快照 ⇒ 这正是"必然丢更新"的形态。
 *
 * ── 做法：Q8 选项 ① · 进程内单写者队列 ────────────────────────────────
 *   ⚠ 为什么不用锁文件：那会引入**新的失败面**（死锁 / 残留锁 / 崩溃后无人清理），
 *     而本进程内的写者本来就都在同一个 Node 进程里。
 *   ⛔ 不引入定时器（`T5`「空闲零定时器」）；⛔ 不改任何调用方的返回值语义与异步性 ——
 *     五个写函数仍**同步返回**，队列在**当前调用栈内**跑完。
 */
export interface OrchWriteQueueStats {
  /** 当前**正在跑**的写事务数（0 = 空闲；>1 = 发生过重入）。 */
  depth: number
  /** 自进程启动以来**累计**入队过多少次。 */
  total: number
  /** 是否**曾经发生过重入**（= 有写事务在自己的读改写中间又调了写函数）。 */
  waited: boolean
}

const queueStats: OrchWriteQueueStats = { depth: 0, total: 0, waited: false }
let inWrite = false

/** 读队列读数（**只读快照**）。⚠ 正常档（`waited === false`）调用方**不许印任何行**。 */
export function orchWriteQueueStats(): OrchWriteQueueStats {
  return { depth: queueStats.depth, total: queueStats.total, waited: queueStats.waited }
}

/**
 * 在**单写者**保护下跑一段写事务（同步）。
 *
 * ⚠ **同步执行**：回调在当前调用栈内跑完，返回值原样返回（⛔ 不排队、不延后）。
 * ⚠ **重入如实记账**：进入时若已在写 ⇒ `waited = true`（这说明调用链里有写事务嵌套，
 *   也就是丢更新的形成机制）。⛔ 不在这里抛 —— 那会把记账缺陷变成主流程崩溃。
 */
export function runSerialized<T>(fn: () => T): T {
  queueStats.total++
  if (inWrite) queueStats.waited = true
  queueStats.depth++
  const prev = inWrite
  inWrite = true
  try {
    return fn()
  } finally {
    queueStats.depth--
    inWrite = prev
  }
}

export function writeOrchState(file: string, state: OrchStateFile): boolean {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
    renameSync(tmp, file)
    return true
  } catch {
    try { rmSync(tmp, { force: true }) } catch { /* 清理失败不掩盖主错误 */ }
    return false
  }
}

// ══════════════════════════════════════════════════════════════════════
// 写入前的**读盘守卫**：坏文件 / 版本不认识 ⇒ **拒写 + 留证**
// ══════════════════════════════════════════════════════════════════════

/**
 * ══════════════════════════════════════════════════════════════════════
 * ⚠⚠ **五个写路径的统一入口**（2026-10-24 · 本单必修 7 · `P3-①`）
 * ══════════════════════════════════════════════════════════════════════
 *
 * ── 治的缺陷 ──────────────────────────────────────────────────────────
 *   五个写函数（{@link recordHandoff} / {@link clearHandoffs} / {@link bindSession} /
 *   {@link writePending} / {@link markLostInner}）都是"**读 → 改 → 写**"，
 *   而"读"用的是 {@link readOrchState} —— 它的**宽容口径**把三件事读成同一个空态：
 *     · 文件真的还不存在（`ENOENT`）         —— 正常，"首次"；
 *     · 文件在、**读不了 / JSON 坏**         —— **危险**；
 *     · 文件在、**version 不认识**            —— **危险**。
 *   ⇒ 改前后果（`P3-①`）：
 *     后两种**照旧被当成空态**，然后 `writeOrchState` 把空态 + 本次改动**整份落盘**
 *     ⇒ ⚠ **一场坏 JSON / 一次版本漂移，就把盘上所有 pending / lost / handoffs / sessions
 *       一次性清空**，而五个函数都只是回 `wrote: true`。这就是"坏 JSON 清空"与
 *     "未知 version 静默降级重写"两条缺陷的同一处病根。
 *
 * ── 现在的判据（三档，⛔ 不许合并）───────────────────────────────────────
 *   · `ok`            —— 照旧走（读到的就是盘上那份）；
 *   · `no-records-yet` / `ledger-unreachable`（文件不存在）—— 照旧走（**首次创建**是正当路径）；
 *   · `unreadable` / `version-unknown` —— **拒写**，并把坏文件**另存一份留证**
 *     （`<file>.corrupt-<ts>`）。
 *
 * ⚠ ⚠ **为什么"留证"是必须的，不是锦上添花**：拒写之后，下一次写入仍会拒
 *   （文件还是坏的）⇒ 若不在第一次就把**原字节**留一份，运维想修就只能靠猜，
 *   而"拒写"会表现为"这个功能永远不记账"。留证让"盘上到底写坏了什么"可复核。
 * ⚠ **另存用复制而非改名**（`copyFileSync`）：⛔ 不动原文件 —— 原文件保持可读，
 *   `hob_orch_status` 的 `unreadable` 那一档**照旧报得出来**（改名会让它变成
 *   "没有记录"，那是把一种假信号换成另一种）。
 *
 * ⚠ **同一份坏文件只留证一次**（按"已留过"判：`<file>.corrupt-*` 里已经有一份与它
 *   字节相同的就不再复制）—— 否则每轮对账都会堆一份，把运行态目录撑爆。
 */
export type OrchWriteGuard =
  | { ok: true; reading: OrchStateReading }
  | { ok: false; reason: 'store-unreadable' | 'version-unknown'; message: string; evidence?: string }

/** 一次写入前守卫的**判据**（见 {@link readOrchStateForWrite} 的注释）。 */
export function readOrchStateForWrite(file: string): OrchWriteGuard {
  const reading = readOrchStateDetailed(file)
  if (reading.reachability === 'unreadable') {
    const evidence = preserveCorruptCopy(file)
    return {
      ok: false,
      reason: 'store-unreadable',
      message: `拒绝写入：运行态文件 \`${file}\` **读不了 / 不是合法 JSON**`
        + '（账本根在、文件也在）。'
        + '\n      ⚠ 此时按空态重写会**把这个文件里原有的 pending / lost / handoffs / sessions 全部清空**，'
        + '而调用方只会看到"写成功" ⇒ 本函数**拒写**。'
        + (evidence === undefined
          ? '\n      ⚠ 留证副本没能生成（见上一条原因）—— 请人工备份后修 / 删该文件。'
          : `\n      ↳ 原字节已另存一份留证：\`${evidence}\`（⛔ 原文件一个字节都没动）`)
        + '\n      ⇒ 处置：人工检查该 JSON（或删掉它让运行态从空重建），然后再重试。',
      ...(evidence === undefined ? {} : { evidence }),
    }
  }
  if (reading.version !== undefined && !reading.version.known) {
    const evidence = preserveCorruptCopy(file)
    /**
     * ⚠ **"没有 version 字段"与"version 是别的值"要分开说**（两种成因，修法不同）：
     *   · 没有 ⇒ 这份文件**不是本模块写的**（本模块从第一天起就写 version）⇒ 先查是谁写的；
     *   · 是别的值 ⇒ **跨版本**（升级 / 降级 / 手工改）⇒ 先查版本再决定迁移。
     *   ⚠ 两者都**拒写**（都不许"当自己这一代"重写），但话术不许合成一句。
     */
    const shown = reading.version.found === undefined
      ? '文件里**没有** `version` 字段（不是本模块写的？）'
      : `文件里是 ${JSON.stringify(reading.version.found)}`
    return {
      ok: false,
      reason: 'version-unknown',
      message: `拒绝写入：运行态文件 \`${file}\` 的**结构版本不认识**`
        + `（${shown}；本插件只认 ${ORCH_STATE_VERSION}）。`
        + '\n      ⚠ 按"不认识就当我这一代"重写 = **静默降级**：旧/新版本里本代不认识的字段会被丢掉，'
        + '而盘上那份数据再也回不来（`P3-①` 点名的形态）⇒ 本函数**拒写**。'
        + (evidence === undefined ? '' : `\n      ↳ 原字节已另存一份留证：\`${evidence}\``)
        + '\n      ⇒ 处置：确认该版本由谁写（升级 / 降级 / 手工改），再决定迁移，⛔ 不要靠重写"修好"它。',
      ...(evidence === undefined ? {} : { evidence }),
    }
  }
  return { ok: true, reading }
}

/**
 * 把"读不了 / 版本不认识"的运行态文件**原字节另存一份**留证。
 *
 * @returns 留证文件的路径；**没能留证**时 `undefined`（⚠ 调用方必须把这件事说出来 —— 见下）。
 *
 * ⚠ **为什么不抛**：留证失败不该把"拒写"变成"崩溃"（拒写本身已经是安全的方向）。
 *   ⚠ 但⛔ 不许静默：{@link readOrchStateForWrite} 会把"没能留证"写进 message。
 * ⚠ **去重**：同目录下已有的 `*.corrupt-*` 里若有一份与当前字节相同 ⇒ **不再复制**
 *   （否则每轮对账都堆一份；留证是给"这一次写坏"用的，不是审计流水）。
 */
function preserveCorruptCopy(file: string): string | undefined {
  try {
    const dir = dirname(file)
    const base = file.slice(dir.length + 1)
    const prefix = `${base}.corrupt-`
    let bytes: Buffer
    try {
      bytes = readFileSync(file)
    } catch {
      /** ⚠ 连原字节都读不出来（EACCES）⇒ 留证做不到；由调用方在 message 里说清。 */
      return undefined
    }
    try {
      for (const n of readdirSync(dir)) {
        if (!n.startsWith(prefix)) continue
        try {
          if (readFileSync(join(dir, n)).equals(bytes)) return join(dir, n)
        } catch { /* 那份读不到 ⇒ 继续找 */ }
      }
    } catch { /* 目录列不出来 ⇒ 直接新建一份（下面会失败并如实返回 undefined） */ }
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const dest = join(dir, `${prefix}${ts}`)
    copyFileSync(file, dest)
    return dest
  } catch {
    return undefined
  }
}

/**
 * ── **拒写原因**的登记处（2026-10-24 · 本单必修 7 的"回可读原因"那一半）──────────
 *
 * ⚠ ⚠ **为什么需要它**：五个写函数的返回形状是**既有契约**（`boolean` 或
 *   `{ wrote, state }`…），而调用方全都在 `src/modules/**`（本单**不许改**）。
 *   ⇒ 拒写原因**不能塞进返回值的新字段里让调用方去读**（没人读 = 又是静默）；
 *   也不能为了回一句原因就把 `boolean` 改成对象（`if (!writePending(…))` 会
 *   把"真值对象"读成成功 —— 那是**更坏**的缺陷）。
 *   ⇒ 用一张**按文件 keyed 的登记表**：拒写时登记"为什么 / 证据在哪 / 什么时候"，
 *     由**读数面**（`hob_orch_status` 那一侧 / 机检）按文件查。
 *
 * ⚠ **它不是运行态数据**：只在**本进程内存**里（进程重载即清零）——
 *   拒写这件事本来就该在**下一次读数**里被看见；落盘会引入"写不进去还要写"的坑（同丙-1）。
 * ⚠ **成功写入会清掉该文件的登记**（"上一次拒了、这一次成了"不许一直挂着旧原因）。
 */
export interface OrchWriteRefusal {
  /** `store-unreadable` = 读不了 / 坏 JSON；`version-unknown` = 结构版本不认识。 */
  reason: 'store-unreadable' | 'version-unknown'
  /** 给人读的一整段（含处置建议）。 */
  message: string
  /** 另存的留证副本路径（没能留证 ⇒ 缺省，message 里会说明）。 */
  evidence?: string
  /** 拒写时刻（毫秒）。 */
  at: number
}

const writeRefusals = new Map<string, OrchWriteRefusal>()

/** 读**某个文件最近一次拒写**的原因（没有 ⇒ `undefined`）。 */
export function orchWriteRefusalOf(file: string): OrchWriteRefusal | undefined {
  return writeRefusals.get(file)
}

/** 全部登记（供读数面 / 机检一次性取；⚠ 返回副本，外部改不到内部表）。 */
export function orchWriteRefusals(): Array<{ file: string } & OrchWriteRefusal> {
  return [...writeRefusals.entries()].map(([file, r]) => ({ file, ...r }))
}

/**
 * 登记 / 清掉一次拒写（写入成功时清 —— 见 {@link OrchWriteRefusal} 的末条）。
 *
 * @returns 登记的那条**拒写原因**（成功 ⇒ `undefined`）。⚠ 有返回值的意义：那几个
 *   "返回对象"的写函数把它**同时**放进自己的返回值（`refusal` 字段）——
 *   既有的 `wrote` / `state` / `binding` 一个不动，读的人不必再去查登记表。
 */
function noteWriteOutcome(file: string, g: OrchWriteGuard): OrchWriteRefusal | undefined {
  if (g.ok) {
    writeRefusals.delete(file)
    return undefined
  }
  const rec: OrchWriteRefusal = {
    reason: g.reason,
    message: g.message,
    ...(g.evidence === undefined ? {} : { evidence: g.evidence }),
    at: Date.now(),
  }
  writeRefusals.set(file, rec)
  return rec
}

// ══════════════════════════════════════════════════════════════════════
// 运行态目录的**自忽略**（运行态不进账本历史）
// ══════════════════════════════════════════════════════════════════════

/** `runtime/` 自带的忽略文件（内容是 `*` ⇒ 该目录整体不参与 git）。 */
export const ORCH_STATE_IGNORE = '.gitignore'

/**
 * 保证 `runtime/` 目录被 git 忽略。
 *
 * ⚠ 为什么由插件自己写：账本目录**是一个 git 仓**（用户决策 D3/D4 —— 账本随仓留痕）。
 *   运行态文件（"在等回传"的中间记录）**不该进账本历史** —— 它每派一次就变，
 *   混进提交会让账本仓的 diff 充满噪声。
 *   任务书 §2.1 第 4 条要求"若会被跟踪就同批处理忽略"，这里就地处掉。
 *
 * ⚠ 内容是 `*`：该目录下**所有**文件（含本 `.gitignore` 自己）都不被跟踪 ⇒
 *   `git status` 干净，不需要人工 `git add` 任何东西。
 */
export function ensureRuntimeIgnored(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, ORCH_STATE_IGNORE),
      '# dsh-hob 编排运行态（插件自管；不进账本历史）\n*\n',
      'utf8',
    )
    return true
  } catch {
    return false
  }
}

// ══════════════════════════════════════════════════════════════════════
// 丢失判定（**本批的核心**：重载前未结算的那些派发）
// ══════════════════════════════════════════════════════════════════════

/** 保留的"已丢失"记录上限（防止文件无限增长 —— 它是运行态、不是审计日志）。 */
export const MAX_LOST = 50

/** 一条 watch 的身份：目标 + 登记时刻（两者合起来在本机内唯一）。 */
export function watchKey(w: Pick<PersistedWatch, 'target' | 'at'>): string {
  return `${w.target}@${w.at}`
}

/** {@link markLost} 的结果。 */
export interface MarkLostResult {
  /** 本次**判为丢失**的（已空闲 / 判不出 / 无 statusOf 时全部）。⚠ 逐条带 `lostClass`。 */
  lost: PersistedWatch[]
  /**
   * 本次**必须重新挂上**的（2026-10-18 第 2 轮新增）——
   * 目标在重载时**仍在跑** ⇒ 它本来还在等，⛔ 不该判死。
   * ⚠ 这些**不进 `lost`**、也**不进 `pending`**：调用方要把它们登记回内存的 watches，
   *   再由 `writePending` 落成 `pending`（否则盘上会出现"既不在等也丢了"的悬空记录）。
   */
  reattach: PersistedWatch[]
  /**
   * ⚠⚠ **本次判不出、必须留在 `pending` 里再核的**（2026-10-20 · B3 新增）。
   *
   * ⚠ 它们是**可重入态**（`settleState: 'unresolved'`），⛔ **不是终态**：
   *   每一轮任意触发都会再判一次，直到判出（⇒ 结算）或到顶（⇒ `stuck`）。
   * ⚠ 改前这一档直接挪进 `lost` 就再也没有第二次机会（`FINDINGS` 的 P2）。
   */
  unresolved: PersistedWatch[]
  /** 重核到顶（`recheckCount >= STUCK_AFTER_RECHECKS`）⇒ **不再自动重试**的那一档。 */
  stuck: PersistedWatch[]
  /** 落盘后的完整状态（即使没新丢失也返回，便于调用方读计数）。 */
  state: OrchStateFile
  /** 是否真的写盘了。 */
  wrote: boolean
  /**
   * ⚠ **拒写原因**（2026-10-24 · 本单必修 7 新增；可选）：坏 JSON / 版本不认识 ⇒
   *   `wrote: false` 且**一条都没挪、一条都没删**。⚠ 此时 `state` 是**空态** ——
   *   ⛔ 不许当成"盘上真的空"来读（这正是空态与"读不出来"必须分开的地方）。
   */
  refusal?: OrchWriteRefusal
}

/**
 * 目标状态的**判定入口**（由调用方给，本模块**不碰宿主**）。
 *
 * @returns `'running'` = 仍在跑（⇒ 重挂）· `'idle'` = 已空闲（⇒ 记 lost）
 *   · `undefined` = **判不出**（会话没了 / 读不到状态）⇒ 记 lost 且档位 `'unknown'`。
 *
 * ⚠ 为什么由调用方给而不是本模块自己查：本模块**刻意不 import 任何宿主包**
 *   （文件头纪律：只依赖 `node:fs`/`node:path`，这样机检能直接 import 它真跑）。
 */
export type TargetStatusOf = (target: string) => 'running' | 'idle' | undefined

/**
 * 把**这一代不认识**的 pending 分成两摞（⛔ 不许合成一摞）。
 *
 * 判据（用户 2026-10-18 裁定 3）：
 * · 目标**仍在跑**   ⇒ `reattach`（**必须重挂**、继续等）；
 * · 目标**已空闲**   ⇒ `lost` + `lostClass:'idle'`；
 * · **判不出**       ⇒ `lost` + `lostClass:'unknown'`（⚠ 保守方向：不许猜"它在跑"）。
 *
 * ⚠ 这是**纯函数**（无 IO、无宿主）⇒ 机检可以拿假状态直接真跑两条路径。
 *
 * ── ⚠⚠ **2026-10-20 改动（本单 B3）：判不出不再判死** ────────────────────
 *   改前三档是 `running ⇒ reattach` / `idle ⇒ lost(idle)` / **判不出 ⇒ lost(unknown)**，
 *   而 `lost` 是**终态**（挪进去就再没人看它）⇒ 「判不出」= **这条永远不会有回执了**
 *   （`FINDINGS` P2 / `DESIGN` §3.3 逐条证明"没有第二次机会"）。
 *   ⇒ 现在第三档改判成 {@link classifyOutcome} 里的 `unresolved`：**留在 `pending` 里，
 *     下一轮再核**；⛔ 不是终态、⛔ 不无限重试（到 {@link STUCK_AFTER_RECHECKS} 轮 ⇒ `stuck`）。
 *   ⚠ ⛔ **这一改不允许"猜 owner"**：重判读的是**目标此刻的状态**，
 *     收件人仍然只由 `w.owner` 决定（`I-1` / `I-3` 不破；详见 `SettleState` 的注释）。
 */
export function classifyPending(
  pending: PersistedWatch[],
  statusOf?: TargetStatusOf,
): { reattach: PersistedWatch[]; lost: PersistedWatch[]; unresolved: PersistedWatch[]; stuck: PersistedWatch[] } {
  const reattach: PersistedWatch[] = []
  const lost: PersistedWatch[] = []
  const unresolved: PersistedWatch[] = []
  const stuck: PersistedWatch[] = []
  for (const w of pending) {
    const st = statusOf === undefined ? undefined : statusOf(w.target)
    if (st === 'running') {
      reattach.push(w)
      continue
    }
    if (st === 'idle') {
      /**
       * ⚠ ⚠ **"已空闲"不再当场判死 —— 先给一次结算机会**（2026-10-20 · 修 SA-a 暴露的缺口）。
       *
       * ── 为什么 ──────────────────────────────────────────────────────
       *   目标 `idle` 的语义是"**它跑完了**"（`running → idle` 那一跳的终点）。
       *   改前这里直接 `lost`（= 终态）+ 通知"结果不会再回来了" —— 而它**其实有结果**，
       *   只是那一跳事件发生在重载之前。⇒ 用户看到的是"回执从来没回来"，
       *   而**真相源上明明写着"跑完了"**（`FINDINGS` §3.3 列出 `idle` 那一档"永久"）。
       *   ⇒ 现在把它**留在 `pending`** 并标 `settleState: 'unresolved'`：
       *     对账（T1..T5）会拿**三条真相源**再核一次，**能结就结**（真投递回执）；
       *     核不出证据才继续留到下一轮 ⇒ 到顶转 `stuck`。
       *
       * ⚠ ⛔ **这不是猜**：判据是**目标此刻的状态**（`idle` = 跑完了），
       *   **收件人仍然只由 `w.owner` 决定**（`I-1`）；`owner` 缺失 ⇒ 照旧不投。
       * ⚠ 保留 `lostClass: 'idle'` 的**语义**：真正被结算失败而落在 `lost` 的那条
       *   仍然带这一档（`lost` 的写入路径一个字没动）。
       */
      unresolved.push({ ...w, lostClass: 'idle', settleState: 'unresolved', recheckCount: (w.recheckCount ?? 0) + 1, lastRecheckAt: Date.now() })
      continue
    }
    /**
     * ── **判不出** ⇒ 可重入态（B3），⛔ 不是终态 ────────────────────────
     *   ⚠ 代数（`recheckCount`）是**这里**加的：每被判一次 +1。
     *   ⚠ 到顶 ⇒ `stuck`（**停止自动重试**），读数里单列一档并明说"需人工裁"。
     *   ⚠ `settleState` 只在这两条分支里写，⛔ 结算成功那条路径不写（它离开 `pending` 了）。
     */
    const nextCount = (w.recheckCount ?? 0) + 1
    const atTop = nextCount >= STUCK_AFTER_RECHECKS
    const rec: PersistedWatch = {
      ...w,
      settleState: atTop ? 'stuck' : 'unresolved',
      recheckCount: nextCount,
      lastRecheckAt: Date.now(),
    }
    if (atTop) {
      /**
       * ⚠ ⚠ **到顶 ⇒ 转 `stuck` 并进 `lost`**（2026-10-20 · B3 的上限落点）。
       *
       * 为什么是"进 `lost`"而不是"永远留在 `pending` 里标 stuck"：
       *   · 用户口径：到顶后 **⛔ 不再自动重试**、读数里**明说"需人工裁"**；
       *     留在 `pending` 里就得每轮再判"它是不是该跳过" —— 那是**另一种空转**。
       *   · 而 `lost` 的语义正好是"**放弃等它了**"⇒ 语义对得上，
       *     且它仍然是**可读的一档**（读数按 `settleState==='stuck'` 单列）。
       * ⚠ ⛔ 这不是回到 P2 的死胡同：进 `lost` 的**前提是已经真核过 K 轮**
       *   （`recheckCount` 逐轮留在记录上，⛔ 不是第一次就判死）。
       * ⚠ `lostClass` 仍写 `'unknown'`（如实：它是"判不出"到顶的产物，⛔ 不许冒充 `idle`）。
       */
      lost.push({ ...rec, lostClass: 'unknown' })
      stuck.push(rec)
    } else unresolved.push(rec)
  }
  return { reattach, lost, unresolved, stuck }
}

/**
 * 把落盘里**这一代不认识**的 `pending` 处置掉：仍在跑的挑出来重挂，其余的判丢失并落盘。
 *
 * ── 判据 ──────────────────────────────────────────────────────────────
 *   `known(w)` 为真 = 这一代的编排器**正持有**这条 watch（还在等）
 *   ⇒ 它不是丢失的。为假 ⇒ 这条是**上一代**留下的 ⇒ 丢失。
 *
 *   ⚠ 为什么要传 `known` 而不是"文件里还有 pending ⇒ 全算丢"：
 *     预设作用域与编排模块的 fiber **可以各自重建**。若预设那一侧先重建、
 *     编排模块那一侧的 watch 还活着，则"文件里有 pending"并不意味着丢失 ——
 *     按 `known` 判能把这种情况排除掉（**不冤枉活着的 watch**）。
 *
 *   ⚠ 幂等：丢失项一旦挪进 `lost` 就不再出现在 `pending` 里 ⇒
 *     第二次调用不会重复报告、也不会重复唤醒派活方。
 *
 * ── ⚠ ⚠ **2026-10-18 第 2 轮改动（`UD-137` 裁定 3）：先核再判** ──────────
 *   旧签名是 `markLost(file, known)`，调用点固定传 `() => false`
 *   ⇒ 盘上任何 pending **一律判死**。新签名多一个**可选**的 `statusOf`：
 *   · 给了它 ⇒ 目标**仍在跑**的记录进 `reattach`（重挂），不进 `lost`；
 *   · 不给 ⇒ 行为与改前**逐字相同**（全判丢失、档位 `'unknown'`）
 *     ⇒ ⚠ 既有调用点与既有断言 F/G 的老用法**不需要改**（向后兼容）。
 *   ⚠ `unknown`（判不出）**不许**当成 `running` —— 猜错的代价是"该会话永久不能再派"。
 */
/**
 * ⚠⚠ **丙-5（2026-10-21 · 第 338 轮）**：`markLost` 的「读 → 改 → 写」必须**单写者**执行。
 *   ⚠ 实现方式：原函数体**一字未改**地搬进 `markLostInner`，外面套一层 `runSerialized`。
 *   ⚠ 为什么不直接把整段包进箭头函数：原体里有 `return` 早退（`unknown.length === 0` 那条）
 *     与 `for` 循环里的 `continue` ⇒ 直接包会撞"跳转跨函数边界"（本批实测踩到）。
 *   ⚠ 套一层之后：**返回值、早退时机、异步性全部不变**（仍然同步返回 `MarkLostResult`）。
 */
export function markLost(
  file: string,
  known: (w: PersistedWatch) => boolean,
  statusOf?: TargetStatusOf,
): MarkLostResult {
  return runSerialized(() => markLostInner(file, known, statusOf))
}

function markLostInner(
  file: string,
  known: (w: PersistedWatch) => boolean,
  statusOf?: TargetStatusOf,
): MarkLostResult {
  /**
   * ⚠⚠ **读盘守卫（本单必修 7）**：坏 JSON / 版本不认识 ⇒ **拒写**（`wrote: false`）+ 留证。
   *
   * 改前：坏文件读成空态 ⇒ `state.pending` 为空 ⇒ `unknown.length === 0` ⇒ 直接早退，
   *   看起来"什么都没发生"（还算安全）；⚠ 但这个函数的调用方是**对账**，
   *   它同时会用空态去判"盘上还有什么" ⇒ **读数与写盘都建立在空态上**。
   *   ⇒ 现在明确拒写：**一条都不挪、一条都不删**，并且原因可查（`orchWriteRefusalOf`）。
   * ⚠ 返回 `state` 仍是空态（既有形状不变）——⛔ 不许当成"盘上真的空"来读；
   *   辨认方法是 `wrote: false` + `orchWriteRefusalOf(file) !== undefined`。
   */
  const guard = readOrchStateForWrite(file)
  if (!guard.ok) {
    const refusal = noteWriteOutcome(file, guard)
    return {
      lost: [], reattach: [], unresolved: [], stuck: [], state: emptyOrchState(), wrote: false,
      ...(refusal === undefined ? {} : { refusal }),
    }
  }
  noteWriteOutcome(file, guard)
  const state = guard.reading.state
  const unknown = state.pending.filter((w) => !known(w))
  if (unknown.length === 0) return { lost: [], reattach: [], unresolved: [], stuck: [], state, wrote: false }

  const { reattach, lost, unresolved, stuck } = classifyPending(unknown, statusOf)

  /**
   * ⚠ 仍留在 `pending` 的 = 这一代认识的 + **必须重挂**的 + **判不出待重核的**（B3）。
   *   ⚠ 最后那一摞是关键：改前它进 `lost`（终态）就再也没有第二次机会；
   *     现在它**留在盘上**，下一轮任意触发都会再核一次（`unresolved` / `stuck` 逐条带代数）。
   *   ⚠ 重挂的也要留在盘上：否则重挂成功后一次落盘就会把它当"既不在等也没丢"抹掉。
   */
  const keep = new Set([
    ...state.pending.filter(known).map(watchKey),
    ...reattach.map(watchKey),
    ...unresolved.map(watchKey),
    /**
     * ⚠ **到顶的那几摞不留在 `pending`**（它们已经进了 `lost` —— 见 `classifyPending`）。
     *   ⚠ 留着会让它既在 `pending` 又在 `lost`（同一件事两个来源，读数两面都报一次）。
     */
  ])
  /**
   * ⚠⚠ **保留的那几摞必须带上**新代数/结算态（B3）—— 否则 `recheckCount` 每次重核
   *   都被旧记录盖回 0 ⇒ 永远到不了顶（= 无限重试），而 `settleState` 也永远念不出来。
   *   ⇒ 用"有更新版本就用更新版本"合并，⛔ 不是简单 `filter`（那会把刚写的代数丢掉）。
   */
  const refreshed = new Map<string, PersistedWatch>()
  for (const w of [...reattach, ...unresolved]) refreshed.set(watchKey(w), w)
  state.pending = state.pending
    .filter((w) => keep.has(watchKey(w)))
    .map((w) => refreshed.get(watchKey(w)) ?? w)
  /**
   * ⚠⚠ **`lost` 写入按键去重**（2026-10-20 · 修 **W9**）。
   *
   * 改前是 `[...lost, ...state.lost]`，**没有去重** ⇒ 同一条记录被判丢两次时
   * 盘上出现**逐字段完全相同**的两条（现场实证：`lost=26` 里有 2 条是同一条，
   * 见 `FINDINGS` §2.1 / `DESIGN` §3.5）⇒ 读数虚高 + `MAX_LOST` 提前截断**真**记录。
   *
   * ⚠ 去重键 = {@link watchKey}（`target@at`）—— 与 `pending` 那一侧**同一个键**，
   *   ⛔ 不另立"保留策略"（两处键不一致正是本病的成因）。
   * ⚠ 新的在前；超过上限就丢掉最老的（运行态，不是审计留档）。
   */
  const seenLost = new Set<string>()
  const mergedLost: PersistedWatch[] = []
  for (const w of [...lost, ...state.lost]) {
    const k = watchKey(w)
    if (seenLost.has(k)) continue
    seenLost.add(k)
    mergedLost.push(w)
  }
  state.lost = mergedLost.slice(0, MAX_LOST)
  if (lost.length > 0) state.lostAt = Date.now()
  state.updatedAt = Date.now()
  return { lost, reattach, unresolved, stuck, state, wrote: writeOrchState(file, state) }
}

/**
 * 把 `lost` 按**档位**分组计数（2026-10-18 第 2 轮新增）。
 *
 * ⚠ ⚠ 存在的唯一理由：用户原话「**两类不许混成一个 lost 计数**」⇒ 状态行必须能
 *   **分开报**。⚠ 旧数据没有 `lostClass` ⇒ 归入 `'unknown'`（如实：当时没判过），
 *   ⛔ 不许归入 `'idle'`。
 *
 * ⚠ 这里是**唯一**的分档实现点：⛔ 不许在渲染层再写一份 `filter`（两处各写必然漂）。
 */
export function countLostByClass(lost: readonly PersistedWatch[]): Record<LostClass, number> {
  const out: Record<LostClass, number> = { running: 0, idle: 0, unknown: 0 }
  for (const w of lost) {
    const c: LostClass = w.lostClass === 'running' || w.lostClass === 'idle' ? w.lostClass : 'unknown'
    out[c] += 1
  }
  return out
}

/**
 * **T5 · 有条件的一次性复查的退避梯度**（2026-10-20 · 本单 B5 新增）。
 *
 * ⚠ ⚠ **口径必须说清，因为用户明确否掉了"常驻定时器空转"**：
 *   · 它**不是周期轮询** —— **没有待办时不存在任何定时器**（武装条件 = 盘上还有
 *     `waiting` / `unresolved` 记录；解除条件 = **pending 清空当场解除**）；
 *   · 它**不是无条件常转** —— 每一轮只排**一个**一次性 `setTimeout`（`unref`），
 *     跑完看账，账还没平才排下一次；
 *   · 它**必须有上限** —— 到 {@link STUCK_AFTER_RECHECKS} 后记录升 `stuck`，
 *     读数里**明说"不再自动重试，需人工裁"**。
 * ⇒ 完全空闲时（没有在等回传的派发）本模块**一个定时器都不存在**。
 */
export const RECHECK_BACKOFF_MS = [15_000, 60_000, 300_000] as const

/**
 * 选**这一次**一次性复查该等多久（纯函数，⛔ 无 IO、⛔ 无定时器 —— 便于机检真跑）。
 *
 * @param armed - 这次要不要武装（= 盘上还有 `waiting` / `unresolved`）。
 * @param round - 已经排过第几次（0 起）。超出梯度长度 ⇒ 用最后一档（**封顶**，⛔ 不无限拉长）。
 * @returns 毫秒；`undefined` = **不武装**（本次一个定时器都不排）。
 *   ⚠ `armed === false` ⇒ 必须返回 `undefined`：**"没有待办 ⇒ 没有定时器"** 这一条
 *     是用户口径的硬要求，⛔ 不许退化成"定个很长的周期"。
 */
export function nextRecheckDelay(armed: boolean, round: number): number | undefined {
  if (!armed) return undefined
  const i = Number.isFinite(round) && round > 0 ? Math.floor(round) : 0
  return RECHECK_BACKOFF_MS[Math.min(i, RECHECK_BACKOFF_MS.length - 1)]
}

/**
 * 判断"**盘上还有没有未结算的**"（T5 的武装判据，纯函数）。
 *
 * ⚠ ⚠ 为什么`stuck` **不算**待办：`stuck` 的语义就是"不再自动重试，等人工裁"
 *   ⇒ 若把它算成待办，定时器就会**为一个已经放弃的记录永远转下去**（= 空转，用户否掉的那档）。
 * ⇒ 只认 `waiting`（含缺字段的旧记录：它本来就在等）与 `unresolved`（可重入态）。
 */
export function hasUnsettled(pending: readonly PersistedWatch[]): boolean {
  return pending.some((w) => {
    const st = w.settleState ?? 'waiting'
    return st === 'waiting' || st === 'unresolved'
  })
}

/**
 * 把 `pending` 按**结算态**分档计数（B3 / B4 的读数面，纯函数）。
 *
 * ⚠ ⚠ 它是**唯一**的分档实现点：⛔ 不许在渲染层再写一份 `filter`（两处各写必然漂）。
 */
export function countBySettleState(
  pending: readonly PersistedWatch[],
): Record<SettleState, number> {
  const out: Record<SettleState, number> = { waiting: 0, unresolved: 0, stuck: 0 }
  for (const w of pending) {
    const st: SettleState = w.settleState === 'unresolved' || w.settleState === 'stuck'
      ? w.settleState
      : 'waiting'
    out[st] += 1
  }
  return out
}

/**
 * 把**同一个账本文件里的** `pending` 与"我这一片"合并（2026-10-20 · 修 **P1**）。
 *
 * ── 它治的缺陷（`FINDINGS` 的 P1，本单最贵的一条）──────────────────────────
 *   改前 `persistOwnerPartition` 的 `others` 过滤条件是
 *   `prev.pending.filter(w => (w.owner ?? '') !== owner)` —— 它保留的是"**别人的**"，
 *   而 **同一个 owner 名下先前那条 pending 被排除在外** ⇒
 *   **每派一条活，就把同 owner 先前那条从盘上静默删掉**（连 `lost` 都不进）。
 *   现场实证：`57893e5d` 派完下一条之后从 `pending` 消失，且从未出现在 `lost` 里。
 *
 * ── 判据（⚠ 一处实现，两个写入路径共用 —— ⛔ 不许各写一份）──────────────
 *   **按记录身份**（{@link watchKey} = `target@at`）去重，⛔ **不按 owner 一刀切**：
 *   · `mine` 里出现的键 ⇒ 用 `mine` 的那一条（它是最新的写法）；
 *   · 其余（`prev` 里有、`mine` 里没有）⇒ **原样保留**（不管它属于谁）。
 *   ⇒ 语义与 `flushWatches` 的"全量写"**同构**：两边都只是"把我知道的那些放上去"，
 *     差别只在"我知道哪些"，⛔ 不在"要不要保留同一个人的其它记录"。
 *   ⚠ ⛔ 不引入"保留策略"这类需要长期维护的额外规则 —— 两处写法不一致正是本病的成因。
 *
 * @param prev - 盘上现有的 `pending`（**写之前读回**的那一份）。
 * @param mine - 本次要写上去的那一片（按 `watchKey` 去重）。
 */
export function mergePendingByIdentity(
  prev: readonly PersistedWatch[],
  mine: readonly PersistedWatch[],
): PersistedWatch[] {
  const mineKeys = new Set(mine.map(watchKey))
  const out: PersistedWatch[] = [...mine]
  for (const w of prev) {
    if (mineKeys.has(watchKey(w))) continue
    out.push(w)
  }
  return out
}

/**
 * 把这一代**活着的** watch 落成 `pending`（保留既有 `lost` 与 `handoffs`）。
 *
 * ⚠ 必须保留 `lost`：它是"曾经丢过"的唯一在盘记录 ——
 *   覆盖掉它，重启后就又变成"从来没派过"，正是第 19 轮要修的失败。
 *
 * ⚠ **同样必须保留 `handoffs`**（2026-10-10 新增）：它是"写了但还没投"的
 *   唯一在盘记录。⚠ 覆盖掉它，就等于**又变成"从来没写过"** ——
 *   那正是本轮要修的那个失败本身（见 `PersistedHandoff` 的注释）。
 *   这与 `lost` 是**同一条纪律**，不是顺手加的一行。
 *
 * ⚠ 实现上**在函数内读回既有文件**取 `handoffs`（而不是加第 4 个参数）：
 *   ① 既有调用点（`orchestrator.ts` 的 `persistWatches`）传的是
 *      `(file, pending, prev.lost)`，签名一变就得同批改调用点；
 *   ② `check-orch-state.mjs` 的 **D4** 断言锚在**调用点的实参形状**
 *      （`writePending(…, …, prev.lost)`）—— 加参数会让它 FAIL，
 *      而"为了让新代码过得去而改既有断言"是红线。
 *   ⇒ 在函数内读回，既有调用点与既有断言**一字不动**。
 */
export function writePending(
  file: string,
  pending: PersistedWatch[],
  lost: PersistedWatch[],
): boolean {
  /** ⚠ **丙-5**：整段「读回既有 → 组装 → 写」进单写者队列。 */
  return runSerialized(() => {
  /**
   * ⚠⚠ **读盘守卫（本单必修 7）**：坏 JSON / 版本不认识 ⇒ **拒写**，⛔ 不按空态重写。
   *
   * 改前这里用 {@link readOrchState}：坏文件被读成空态 ⇒ 下面组装出来的 `state`
   *   里 `handoffs` / `sessions` **全是空数组** ⇒ 一落盘就把盘上那两摞清空，
   *   而本函数只回 `true`（调用方以为记上了）。⇒ 现在先过 {@link readOrchStateForWrite}。
   * ⚠ **"文件还不存在"照旧放行**（首次创建是正当路径）：守卫只拦 `unreadable` /
   *   `version-unknown` 两档 —— 这两档的共同点是"**盘上有东西、但我读不懂它**"。
   */
  const guard = readOrchStateForWrite(file)
  if (!guard.ok) {
    noteWriteOutcome(file, guard)
    return false
  }
  noteWriteOutcome(file, guard)
  const prev = guard.reading.state
  const state: OrchStateFile = {
    version: ORCH_STATE_VERSION,
    updatedAt: Date.now(),
    pending,
    lost: lost.slice(0, MAX_LOST),
    handoffs: prev.handoffs.slice(0, MAX_HANDOFFS),
    /**
     * ⚠ **同样必须保留 `sessions`（绑定表）**（`I-6`）：它是"谁建的会话"的唯一在盘记录。
     *   覆盖掉它 ⇒ 重载后建出的会话全变成"无归属" ⇒ 回执再找不到主人
     *   （与 `lost` / `handoffs` **同一条纪律**，不是顺手加的一行）。
     */
    sessions: prev.sessions.slice(0, MAX_BINDINGS),
  }
  return writeOrchState(file, state)
  })
}

// ══════════════════════════════════════════════════════════════════════
// 待投递中间态：记 / 清 / 读（2026-10-10 新增 · 用户报障修复）
// ══════════════════════════════════════════════════════════════════════

/** 保留的"待投递"记录上限（同 `MAX_LOST` 的理由：运行态，不是审计日志）。 */
export const MAX_HANDOFFS = 50

/**
 * 保留的**会话绑定**记录上限（`I-6`）。
 *
 * ⚠ 比 `MAX_LOST` 宽：绑定表回答"这个会话归谁"，是**长期**有效的事实
 *   （一个 Hob 建过的会话可能活很久），丢一条就意味着那个会话重载后变成"无归属"。
 * ⚠ 但仍然有上限：它是**运行态**（不是审计留档），且每建一个会话才涨一条。
 */
export const MAX_BINDINGS = 200

/** {@link recordHandoff} / {@link clearHandoffs} 的结果。 */
export interface HandoffWriteResult {
  /** 是否真的写盘了。 */
  wrote: boolean
  /** 落盘后的完整状态。 */
  state: OrchStateFile
  /**
   * ── ⚠ **拒写原因**（2026-10-24 · 本单必修 7 新增；**可选**）───────────────────
   *
   * ⚠ 只有"盘上有东西、但读不懂它"（坏 JSON / 版本不认识）时才有值 —— 此时
   *   `wrote: false`，而**为什么**必须能读到（⛔ 不许让调用方自己去猜"是没匹配还是读坏了"）。
   * ⚠ **向后兼容**：既有字段（`wrote` / `state`）名字与语义一个字未改，
   *   旧调用方读 `wrote` 照旧；新增的只是这一个**可选**字段。
   */
  refusal?: OrchWriteRefusal
}

/**
 * 记一条**待投递**（"写了/建了，但还没投出去"）。
 *
 * ⚠ **幂等去重**：同一 `(kind, ref)` 只保留**最新一条** ——
 *   否则"写了同一个 TASK 两次"会在状态输出里变成两条待投递（虚报）。
 *   ⚠ 去重键**不含 `at`**（与 `watchKey` 相反）：`watch` 要区分"同一会话的第几轮"，
 *   而待投递问的是"这个文件/会话**现在**还没投出去吗" ⇒ 是**布尔状态**，不是流水。
 *
 * ⚠ **失败不抛**：返回 `wrote: false`，由调用方记日志（同 `writeOrchState` 纪律）。
 */
export function recordHandoff(file: string, h: PersistedHandoff): HandoffWriteResult {
  /** ⚠ **丙-5**：整段「读 → 改 → 写」进单写者队列（队列内**重新读盘** ⇒ 不用过期快照写）。 */
  return runSerialized(() => {
    /**
     * ⚠⚠ **读盘守卫（本单必修 7）**：坏 JSON / 版本不认识 ⇒ 拒写 + 留证。
     *   改前坏文件被读成空态 ⇒ `rest` 为空 ⇒ 本次落盘把**盘上那 50 条待投递清成这 1 条**。
     *   ⚠ 拒写时 `wrote: false` + `state` 给**空态**（既有形状不变：调用方只看 `wrote`；
     *     ⛔ 不许把空态冒充成"读到的现状" —— 原因在 `orchWriteRefusalOf(file)` 里）。
     */
    const guard = readOrchStateForWrite(file)
    if (!guard.ok) {
      const refusal = noteWriteOutcome(file, guard)
      return { wrote: false, state: emptyOrchState(), ...(refusal === undefined ? {} : { refusal }) }
    }
    noteWriteOutcome(file, guard)
    // ⚠ `sessions`（绑定表）由 `writeOrchState` 原样带着 —— 本函数只动 `handoffs`。
    const state = guard.reading.state
    const rest = state.handoffs.filter((x) => !(x.kind === h.kind && x.ref === h.ref))
    // 新的在前；超过上限丢最老的（运行态，不是审计留档）。
    state.handoffs = [h, ...rest].slice(0, MAX_HANDOFFS)
    state.updatedAt = Date.now()
    return { wrote: writeOrchState(file, state), state }
  })
}

/**
 * 清掉**匹配**的待投递记录（投递成功之后调）。
 *
 * @param match - 判"这条记录是否已被投出"。
 *   ⚠ 匹配细则由**调用方**给（投递路径各自知道自己能证明什么）：
 *   `task-file` 用"投递发生在其 `at` 之后"，`spawned-session` 用"目标会话 id === ref"。
 *   ⚠ **绝不按"消息文本里含路径"匹配** —— 脆、会误判（把别的话题里提到路径当成投递）。
 *
 * @returns 清掉了哪几条（供调用方记日志）与是否写盘。
 *   ⚠ **没有匹配项时不写盘**（`wrote: false`）：避免每次投递都无谓改文件。
 */
export function clearHandoffs(
  file: string,
  match: (h: PersistedHandoff) => boolean,
): {
  cleared: PersistedHandoff[]
  wrote: boolean
  state: OrchStateFile
  /** ⚠ 拒写原因（坏 JSON / 版本不认识时才有；见 {@link HandoffWriteResult.refusal}）。 */
  refusal?: OrchWriteRefusal
} {
  /** ⚠ **丙-5**：整段「读 → 改 → 写」进单写者队列（同 `recordHandoff` 的理由）。 */
  return runSerialized(() => {
    /**
     * ⚠⚠ **读盘守卫（本单必修 7）**：坏 JSON / 版本不认识 ⇒ 拒写 + 留证。
     *   改前坏文件读成空态 ⇒ `cleared` 为空 ⇒ 回 `{ cleared: [], wrote: false }`，
     *   读的人会把它当成"没有匹配项（= 早就投出去了）"—— 而真相是**读不出来**。
     *   ⇒ 现在同样回 `wrote: false`（既有形状不变），但**原因登记在
     *     `orchWriteRefusalOf(file)`**，读数面能说清是哪一种。
     */
    const guard = readOrchStateForWrite(file)
    if (!guard.ok) {
      const refusal = noteWriteOutcome(file, guard)
      return { cleared: [], wrote: false, state: emptyOrchState(), ...(refusal === undefined ? {} : { refusal }) }
    }
    noteWriteOutcome(file, guard)
    // ⚠ `sessions`（绑定表）同理原样保留 —— 清待投递⛔ 不许把归属也清掉。
    const state = guard.reading.state
    const cleared = state.handoffs.filter(match)
    if (cleared.length === 0) return { cleared: [], wrote: false, state }
    state.handoffs = state.handoffs.filter((h) => !match(h))
    state.updatedAt = Date.now()
    return { cleared, wrote: writeOrchState(file, state), state }
  })
}

// ══════════════════════════════════════════════════════════════════════
// 会话归属绑定（`I-6`：Hob 预设与它建的会话是**一个闭环**，必须绑定）
// ══════════════════════════════════════════════════════════════════════

/** {@link bindSession} 的结果。 */
export interface BindSessionResult {
  /** 写盘了没有（已经是同一 owner ⇒ `false`，那是幂等命中、不是失败）。 */
  wrote: boolean
  /** 绑定之后的归属（无论写没写盘，都给出**结果态**）。 */
  binding?: PersistedSessionBinding
  /**
   * ⚠ **改绑被拒绝**（已有别的 owner）—— 调用方**必须**把这条报出去（⛔ 不许静默）。
   * ⚠ `I-6`：`hob_dispatch` 的目标若**无归属** ⇒ 第一次派发即绑定，此后**不可改绑**；
   *   改绑必须显式报错并说明理由。
   */
  conflict?: { existing: PersistedSessionBinding; wantedOwner: string }
  /**
   * ⚠ **拒写原因**（2026-10-24 · 本单必修 7 新增；可选）：坏 JSON / 版本不认识 ⇒ `wrote: false`。
   *   ⚠ 此时**没有** `binding`（读不出来就没有"结果态"——⛔ 不替盘上那份编一个归属）、
   *   **也没有** `conflict`（我看不到任何东西，"别人绑着"这句话此刻无从说起）。
   */
  refusal?: OrchWriteRefusal
}

/**
 * **把一个会话绑给某个 owner**（`I-6` 的写入点）。
 *
 * ── 三条语义（缺一条都算没做）────────────────────────────────────────
 *   ① **幂等**：已经是同一 owner ⇒ 不写盘、返回现有绑定；
 *   ② **不改绑**：已有**别的** owner ⇒ **拒绝**并回带 `conflict`（⛔ 不许悄悄覆盖）；
 *   ③ **落盘**：绑定是"跨重载可见"的事实（`I-6` 明写），必须进运行态文件。
 *
 * ⚠ **失败不抛**：`wrote=false` 由调用方决定怎么报（同 `writeOrchState` 纪律）。
 * ⚠ ⛔ 本函数**不猜**默认 owner：`owner` 为空 ⇒ 直接返回、什么都不做。
 */
export function bindSession(
  file: string,
  b: { sessionId: string; owner: string; ownerWsRoot?: string; via: 'spawn' | 'dispatch' },
): BindSessionResult {
  if (typeof b.sessionId !== 'string' || b.sessionId === '') return { wrote: false }
  if (typeof b.owner !== 'string' || b.owner === '') return { wrote: false }
  /** ⚠ **丙-5**：入参校验在队列之外（不碰盘），「读 → 改 → 写」在队列之内。 */
  return runSerialized(() => {
    /**
     * ⚠⚠ **读盘守卫（本单必修 7）**：坏 JSON / 版本不认识 ⇒ 拒写 + 留证。
     *   改前坏文件读成空态 ⇒ "这个会话还没有归属"⇒ **重新绑一次**（而盘上可能早就绑给
     *   别人了）⇒ 回执投错人；且本次落盘会把**整张绑定表**清成这一条。
     *   ⚠ 现在回 `{ wrote: false }`（⛔ **不带 `binding`**：读不出来就**没有**"结果态"，
     *     给一个等于替盘上那份编一个归属 —— `I-6` 明令 ⛔ 不猜 owner）。
     *   ⚠ 也⛔ **不报 `conflict`**：那是"我看到别人绑着"，此刻我看不到任何东西。
     */
    const guard = readOrchStateForWrite(file)
    if (!guard.ok) {
      const refusal = noteWriteOutcome(file, guard)
      return { wrote: false, ...(refusal === undefined ? {} : { refusal }) }
    }
    noteWriteOutcome(file, guard)
    const state = guard.reading.state
    const existing = state.sessions.find((x) => x.sessionId === b.sessionId)
    if (existing !== undefined) {
      if (existing.owner === b.owner) return { wrote: false, binding: existing }
      return { wrote: false, binding: existing, conflict: { existing, wantedOwner: b.owner } }
    }
    const binding: PersistedSessionBinding = {
      sessionId: b.sessionId,
      owner: b.owner,
      at: Date.now(),
      via: b.via,
      ...(b.ownerWsRoot === undefined || b.ownerWsRoot === '' ? {} : { ownerWsRoot: b.ownerWsRoot }),
    }
    state.sessions = [binding, ...state.sessions].slice(0, MAX_BINDINGS)
    state.updatedAt = Date.now()
    return { wrote: writeOrchState(file, state), binding }
  })
}

/**
 * **查一个会话归谁**（`I-6` 的读取点）。
 *
 * @returns 绑定（没有 ⇒ `undefined` = **无归属**，⛔ 不许猜一个默认 owner）。
 */
export function ownerOfSession(file: string, sessionId: string): PersistedSessionBinding | undefined {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  return readOrchState(file).sessions.find((x) => x.sessionId === sessionId)
}
