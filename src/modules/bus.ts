/**
 * M3 · 会话总线模块 —— **同实例内，把一条消息投递到另一个会话**。
 *
 * ── 它解决什么 ────────────────────────────────────────────────────────
 *   v1–v4 时期，Hob 与实施会话之间**没有投递机制**：Hob 把指令写进
 *   `.hob/archive/<日期>/TASK.md`，**由用户手工把路径搬过去**。本模块把这一步
 *   变成宿主内的直接投递：列会话 → 定向投递一条 user 消息。
 *
 * ── 宿主能力（全部原生，零自研协议）──────────────────────────────────
 *   · `sessions.list()` / `sessions.get(id)`  → `dsh-session/lib/index.js:1832,1861,1868`
 *   · `agents.get(sessionId)`                 → `dsh-agent/lib/index.js:343`
 *   · `agent.followup / steer / inject(msg)`  → `dsh-agent-loop/lib/index.js:806-812`
 *   · `sessions.flush(session)`（落库确认）    → `dsh-session/lib/index.js:1832`
 *
 *   ⚠ **对标实体**：宿主自带的 `dsh-schedule` 插件做的**就是这件事** ——
 *     解析目标会话 → `createUserMessage` → `followup` → `sessions.flush`
 *     （`dsh-schedule/lib/index.js:1580-1600`）。本模块与它同构，不新造机制。
 *
 * ── 目标会话怎么选：**显式点名**，不自动挑 ─────────────────────────────
 *   按 UD-12（用户原话：「我不懂这个目标会话干嘛，现在还没有做对接会话」），
 *   "替用户选目标会话"这条设计**已被废止**。因此本模块**只提供"
 *   把候选列出来 + 对指定 id 投递"两件事**，选择权在调用方（Hob 列给用户看）。
 *
 * ── 依赖声明用【反应式】而不是模块级 `inject` ─────────────────────────
 *   模块级 `inject` 是**加载门禁**：`sessions` / `agents` 缺席会让整个模块的
 *   fiber 停在 PENDING。而两者在本部署里都是"稍后就绪"的服务（宿主 fiber 并行激活），
 *   写死成门禁有"插件因时序而不激活"的风险。
 *   ⇒ 用 `ctx.inject([...], cb)`：服务就绪后 `cb` 才跑，**就绪时才 `provide`** 本模块
 *     的服务；服务缺席时只是不提供，宿主零告警（EXPERIENCE E-02 的两种 inject 之别）。
 *
 *   ⚠ 这个"就绪才 provide"的落法有**第二个好处**：预设行按 `hobBus` 反应式注册工具
 *     ⇒ 服务没就绪/`modules.bus` 关掉时，**那两个工具根本不出现**（不是出现了再报错）。
 *     与"关掉一个模块只影响它自己"这条架构性质一致（PROJECT.md §3.3）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { type SpawnDefaults } from '../config.ts'
import { FACTORY_DEFAULT_PRESET_ID, HOB_PRESET_ID } from '../shared/planning-preset.ts'
// ⚠ 新建 Hob 会话的**可读档开放面**（唯一声明点；本模块只消费，⛔ 不另抄白名单）
import { isOpenReadLevel, readLevelNotOpenReason } from '../shared/read-level-policy.ts'
import { appendSessionModelSelection, installSessionModelSelection } from '../model-selection.ts'
// ── 待投递中间态记账（2026-10-10 · 用户报障修复）──────────────────────────
//   ⚠ 为什么在**工具层**（而不是服务实现 `spawn()` 里）：服务被别的路径调用时
//     不该产生"用户可见的欠账"；"没投出去就看不见"这件事只对**模型发起的动作**成立。
//     与 `modules/tools.ts` 的 write_hob 记账同款分工：**能力层不记账，工具层记账**。
//   ⚠ 账本根**不由本模块解析**（否则就是第二个路径解析实现点）：由挂载方
//     （`preset/tools.ts`）把 `ledgerRootOf` 闭包传进来 —— 那里已有 config 与 ctx。
import {
  bindSession, clearHandoffs, ensureRuntimeIgnored, ORCH_STATE_IGNORE, orchStateFileOf, readOrchState,
  recordHandoff,
} from '../server/orch-state.ts'
import type { PersistedSessionBinding } from '../server/orch-state.ts'
import { dirname } from 'node:path'

/** 模块名。 */
export const name = 'dsh-hob-bus'

/**
 * 本模块对外提供的**服务名**。
 *
 * ⚠ 用服务而不是全局单例/文件：它是 cordis 原生的依赖表达，能跨作用域
 *   （插件平面 → 预设作用域）被看到，且天然有生命周期
 *   （模块卸载 ⇒ 服务消失 ⇒ 预设行的注册随之拆除）。同 `hobTools` 门禁的做法。
 */
export const BUS_SERVICE = 'hobBus'

/** 投递语义（三种都是宿主 `agent` 的原生方法，见文件头）。 */
export type DeliveryMode = 'followup' | 'steer' | 'inject'

/** 一个可投递的目标会话（给模型看的最小集）。 */
export interface SessionInfo {
  /** 会话 id（投递时的目标）。 */
  id: string
  /** 会话的工作目录（判断"这是哪个项目的会话"的主要依据）。 */
  cwd?: string
  /**
   * 会话**当前实际运行**的预设 id（如 `Hob` / `standard`），用于区分身份。
   *
   * ⚠ ⚠ **第 292 轮改**：原先这里取的是 `session.header.agentPreset` —— 而宿主明写那只是
   *   **建档那一刻**的事实（改过预设的会话，header **不会再变**）。现在改取**宿主的
   *   `agentPreset` 投影**（= header 起步 + 最后一条 `agent-preset/selected`）——
   *   ⚠ **这正是宿主自己的读法**（`dsh-api-session-controller` 的 `presetForSession()`）。
   *   ⚠ 投影不可用时**退回 header 值**，并置 {@link presetSource} 如实标明来源。
   */
  agentPreset?: string
  /**
   * {@link agentPreset} 的**取自哪里**（⚠ 让"降级"可见，⛔ 不静默）。
   *   · `'projection'` —— 取自宿主 `agentPreset` 投影（**权威**）；
   *   · `'header'` —— 投影缺位，退回建档头（⚠ **可能不是当前值**）。
   *
   * ⚠ 类型是 {@link PresetSource}（与 {@link HobBus.presetOf} 的 `source` **同一个**）：
   *   ⛔ 别在这里另写一遍 `'projection' | 'header'` —— 两个出口各自写一份必然漂。
   */
  presetSource?: PresetSource
  /**
   * 该会话在**哪一侧**（依 {@link agentPreset} 判定，口径同源 {@link HOB_PRESET_ID}）。
   *   · `'planning'` —— 规划侧（**不能施工**：无 shell、无 write/edit）；
   *   · `'implementation'` —— 实施侧；
   *   · ⛔ **不给值**（预设读不到）—— 如实留空，⛔ 不猜。
   */
  side?: 'planning' | 'implementation'
  /** `idle` / `running`；`running` 的会话仍可投递（排队到下一轮/下一 step）。 */
  status?: string
  /** 是否有活着的 agent（false = 只有历史、没有运行实体 ⇒ 不可投递）。 */
  live: boolean
  /** 是发起调用的这个会话自己吗（投给自己无意义，工具层会拒）。 */
  self: boolean
}

/** 投递结果。`ok=false` 时 `reason` 给出可读原因，**绝不静默失败**。 */
export interface DeliveryResult {
  ok: boolean
  /** 投递成功时的消息 id（可用于事后核对）。 */
  messageId?: string
  /** 实际使用的语义。 */
  mode?: DeliveryMode
  reason?: string
  /**
   * **目标会话的预设是规划侧预设**（{@link HOB_PRESET_ID}）⇒ 响亮提示（第 129 轮新增）。
   *
   * ⚠ **只提示、不拦**：投递**照常成功**（`ok` 不受影响）—— 给规划侧会话发消息**本身可能合法**
   *   （问它状态、让它规划、传个读数）。本字段是"你这一步大概率不会得到实施产出"的**预警**，
   *   不是拒绝。
   *
   * ── 为什么必须是"预警"而不是"拒绝"（2026-10-13 第 129 轮 · 实测出处）────────
   *   别的项目（`prompt-enhancer-release`）实测：轮次 21 被派给一个**预设 = `Hob`** 的会话，
   *   `hob_orch_status` 显示"已开跑"、`hob_sessions` 显示 `running` —— **但永远没有产出**。
   *   症状原文：「**看在跑、永远没有产出**」（该区 `ROUND-NOTE.md` §一）。
   *   ⇒ 真因不是"投错了"（投递成功），而是**投递方不知道**目标不能施工 ⇒ **静默失败**。
   *     本字段把那个静默变成**响亮**。
   *
   * ⚠ **口径同源**：判定用 {@link HOB_PRESET_ID}，⛔ **不另写字面量**。
   */
  presetNotice?: string
  /**
   * 本次投递**为把冷目标叫活而做过的尝试**（2026-10-21 · 第 330 轮新增）。
   *
   * ⚠ **只在真的尝试过唤醒时**才出现 —— 目标本来就是活的（常见路径）⇒ ⛔ 不出现，
   *   免得给每一次正常投递都背一条噪音字段（判据 #4：活的靶不许因此多走一步）。
   * ⚠ 唤醒**成功**时也带着它：调用方据此知道"这条投递顺手把目标叫起来了"
   *   （那是有代价的动作，⛔ 不该静默）。
   */
  wake?: WakeOutcome
  /**
   * 唤醒**失败**的档位（见 {@link WakeFailureKind}）。
   *
   * ⚠ 与 `reason` 分开：`reason` 是**投递**的结论，`wakeFailure` 是**唤醒**的档位。
   *   两者同非空 = "投递失败，原因是唤醒失败"；⛔ 不许把两者合成一个字符串
   *   （那样调用方没法判别"是靶不存在还是叫不醒"）。
   */
  wakeFailure?: WakeFailureKind
}

/**
 * 一次「叫活尝试」的如实读数（{@link DeliveryResult.wake}）。
 *
 * ⚠ 只记**这次投递真的做了什么**，不记"打算做什么"。⛔ 不许用它描述没发生的事。
 */
export interface WakeOutcome {
  /** 尝试的结果。`ok=true` ⇒ 目标在此之后确实在 `agents` 表里。 */
  ok: boolean
  /** 失败的档位（`ok=true` 时无）。 */
  failure?: WakeFailureKind
  /** 从发起唤醒到得出结论的耗时（毫秒）—— 用于判断"是不是慢到该看日志了"。 */
  elapsedMs?: number
  /** 失败时的可读原因（宿主原话 / 超时说明）—— ⛔ 不加工、不吞。 */
  detail?: string
}

/** 建会话结果（批 16）。`ok=false` 时 `reason` 给出可读原因。 */
export interface SpawnResult {
  ok: boolean
  /** 新会话 id（建成功才有）。 */
  sessionId?: string
  /** 它被放进的工作区 id（**必填项**，本能力的设计核心）。 */
  workspaceId?: string
  /** 该工作区的路径（回执里带上，便于核对）。 */
  workspacePath?: string
  agentPreset?: string
  /**
   * 模型默认值的**如实标注**（批 18）。
   *
   * ⚠ 只在"配了模型默认值、但**没能装上**"时出现 —— 会话已建成功，
   *   失败的是那一步增强。**不静默**（E-29 同族：失败必须可见）。
   */
  modelNote?: string
  /**
   * 预设默认值的**如实标注**（第 9 轮新增）。
   *
   * ⚠ 只在"配置里的默认预设是**规划侧预设**、因而**没被套用**"时出现 ——
   *   会话已建成功（退回了宿主默认预设），**不静默**（与 `modelNote` 同款纪律：
   *   少做了一件事就必须说出来）。
   * ⚠ 与"显式传 `agentPreset`"无关：显式传参时**不会**产生本条（那是调用方的明确选择）。
   */
  presetNote?: string
  reason?: string
  /**
   * ⚠⚠ **建这个会话的调用方会话 id**（`I-6`：建会话即绑定）。
   *
   * ⚠ 服务层只**如实回带身份**，绑定由**工具层**写（那里才有账本根闭包）。
   * ⚠ 拿不到调用方身份 ⇒ **不填**（⛔ 不猜）⇒ 那条会话就是"无归属"，
   *   工具层会**如实报**"绑定没记上"（⛔ 不静默）。
   */
  owner?: string
  /** 可选：给错 `workspace` 时回带的可选清单，便于改对而不是乱猜。 */
  available?: string[]
}

/** 一个可选的建会话目标工作区（给模型看的最小集）。 */
export interface WorkspaceInfo {
  id: string
  path: string
  title?: string
  /** 该工作区当前有多少会话（0 不代表不能用）。 */
  sessions: number
  /** 是发起调用的会话自己所在的工作区吗（默认目标，省得每次点名）。 */
  self: boolean
}

/** 会话忙闲：投递给 `running` 的会话会排到它下一轮/下一 step。 */
const BUSY = 'running'

/**
 * 「投递前把冷目标叫活」的超时上限（毫秒 · 2026-10-21 · 第 330 轮）。
 *
 * ⚠ **为什么必须有上限**：`sessionController.resolveAgent` 内部要**读盘**（打开
 *   会话持久化文件）、**装配 agent**（挂预设、装工具、解析默认模型）⇒ 它可能是
 *   几百毫秒，也可能在某些部署下**根本回不来**（后端卡住 / 写锁被人握着）。
 *   而投递是**同步链路上的一步**：调用方（`hob_send` / 回执对账）在等这个返回值。
 *   ⇒ 没有上限就等于"投递可能无限等"，那是比"投递被拒"更糟的形态（无读数、
 *     无话术、调用方挂死）。
 *   ⇒ 到点**如实报失败**（message 里写 `timed out`），⛔ 不许把等待静默变成挂死。
 *
 * ⚠ 取值口径：8 秒 = 冷会话读盘 + 装配的常见量级再留余量。它**不是**性能指标，
 *   只是"不许无限等"这道闸的门槛值 —— ⛔ 不许据此做任何性能断言。
 */
const WAKE_TIMEOUT_MS = 8000

/**
 * 把目标会话「叫活」的失败原因分类（⚠ 与「目标不存在」**分开**报，⛔ 不许混成一句）。
 *
 * ⚠ 为什么要分档：调用方（Hob / 回执对账）要能分辨"这个靶本来就投不进去"和
 *   "我试过叫它起来、但没起来"。两者的**下一步动作完全不同**：
 *   前者只能换靶 / 让用户打开；后者说明**能力或后端**出了问题，值得看日志。
 */
export type WakeFailureKind =
  /** 唤醒能力缺席（宿主没提供 `sessionController`）⇒ 退化成"直接拒"。 */
  | 'unavailable'
  /** 调用了唤醒，但它**抛错**了（后端异常 / 装配失败）。 */
  | 'threw'
  /** 调用了唤醒，但它**超时**了（`WAKE_TIMEOUT_MS` 内没回来）。 */
  | 'timeout'
  /** 唤醒返回了，但**`agents.get` 仍然空**（resume 没产出活 agent）。 */
  | 'still-not-live'

/**
 * 取"已归档会话"集合（只读）。
 *
 * ── 它为什么必须存在（2026-10-09 实测暴露的问题）─────────────────────────
 *   `archiveSession()` **只往归档集里写一个 id**，它**不会 dispose 已在跑的
 *   agent**（`dsh-workspace` 的语义注释明写：归档写的是"durable archive set"，
 *   供 provider 的 `agent/pre-step` 门禁读取）。后果是**归档会话仍然出现在
 *   `sessions.list()` 里、`agents.get(id)` 也仍然返回实体** ⇒ 只按
 *   "`agents.get` 有值"过滤的 `list()` 会把它们**照样列给 Hob 看**。
 *
 *   更危险的是 `deliver()`：往归档会话投递会 `ok: true` 回来（消息真进了 inbox、
 *   `followup` 也真唤醒了它），但**执行被 `agent/pre-step` 门禁挡下**
 *   （实测转写：有 `turn/start`、`step/start` 计数为 **0**）⇒ 调用方拿到"成功"
 *   却**永远等不到活**。这是一个**静默失败**：投递回执与实际效果不一致。
 *
 *   ⇒ 本模块两头都要认这个集合：`list()` 不再列它、`deliver()` 直接拒它。
 *
 * ── 为什么用**可选**服务而不是写进 `inject` 门禁（⚠ 这里踩过一次）─────────
 *   `workspaceRegistry` 是宿主另一个插件提供的服务，与本模块**没有硬依赖**。
 *
 *   ⚠ **`ctx.inject([...], cb)` 的依赖表里没有"可选"这一档** ——
 *   读过 cordis 源码确认：`Fiber._refresh()`（`cordis/lib/index.js:1320-1327`）对
 *   `inject` 里的**每一个**名字做检查，**缺任何一个就把 epoch 置为 INACTIVE、整个
 *   fiber 不激活**。所以把 `workspaceRegistry` 写进那张表，等于宣布
 *   "没有它本模块就不工作" —— 那是拿一个**收纳功能**去换**核心功能**（会话总线）。
 *
 *   ⇒ 正确做法是**根本不声明它**，改用 `ctx.get(name)` 读：
 *     cordis 对该方法的文档明写 *"Read a service from the store **without the
 *     inject requirement**"*（`cordis/lib/index.js:756-763`）。
 *     服务缺席 ⇒ 拿到 `undefined` ⇒ 降级成"没有归档概念"，本模块**照常激活**。
 *
 *   ⚠ 本注释的存在理由：我第一版**正是把它写进了 inject 依赖表**，并据此写了
 *     "缺席时降级"的说明 —— 而那个写法**根本进不了降级分支**（fiber 直接不激活）。
 *     假 ctx 的探针测不出这一点（假 `inject` 无条件调回调），**只有读 cordis 源码
 *     或跑真 fiber 才能发现**。教训记在 EXPERIENCE **E-95**。
 */
function makeArchivedLookup(svcCtx: any): (sessionId: string) => boolean {
  // ⚠ 用 `get` 而**不是**属性访问：`ctx.workspaceRegistry` 在没有 inject 声明时
  //   会抛 `cannot get property "…" without inject`（cordis 的 Proxy handler,
  //   `lib/index.js:676`）；`get` 是明确的"免 inject"读法。
  let registry: any
  try {
    registry = typeof svcCtx.get === 'function' ? svcCtx.get('workspaceRegistry') : svcCtx.workspaceRegistry
  } catch {
    return () => false
  }
  if (registry === undefined || registry === null) return () => false

  // ⚠⚠ **必须每次现读，不能在闭包里快照**（2026-10-09 真机抓到的第二个缺陷）。
  //
  //   第一版写的是：把 `registry.archivedSessionIds` 取出来**建一次 Set**，
  //   闭包捕获那个 Set。真机症状：**在服务构建之后新归档的会话照旧出现在
  //   `hob_sessions` 里**（实测：`session-a15c0f5d` 明明已在归档集里，
  //   `list()` 仍把它列出来），而构建之前归档的那批过滤得好好的
  //   —— 于是这个 bug **极难从"归档功能不工作"的表面症状归因**。
  //
  //   根因：归档集是**活数据**（宿主原地改同一个数组对象：实测
  //   `archivedSessionIds` 前后**同一引用**、内容增长），而我在构建时**拍了个快照**。
  //   ⇒ 每次调用现取；宿主给的是**数组**（实测无 `has`，且长度会变），
  //     所以现读时再判断"有没有 `has`"，两条路都支持。
  return (sessionId: string) => {
    try {
      const ids = registry.archivedSessionIds
      if (ids === undefined || ids === null) return false
      if (typeof ids.has === 'function') return ids.has(sessionId)
      return Array.isArray(ids) ? ids.includes(sessionId) : [...ids].includes(sessionId)
    } catch {
      return false
    }
  }
}

/**
 * 可选读 `workspaceRegistry`（批 16）。
 *
 * ⚠ 与 {@link makeArchivedLookup} 同一条纪律：**不进 `inject` 依赖表**，用 `ctx.get`
 *   免 inject 读。它是**建会话归属**这个能力的依赖 —— 拿不到时 `spawn` 会**明确拒绝**
 *   （而不是建出孤儿会话），但 `list()` / `deliver()` 照常工作。
 */
function makeRegistryLookup(svcCtx: any): any {
  try {
    return typeof svcCtx.get === 'function' ? svcCtx.get('workspaceRegistry') : svcCtx.workspaceRegistry
  } catch {
    return undefined
  }
}

/**
 * 可选读 `sessionController`（批 16）—— 建会话的**唯一**入口。
 *
 * ⚠ 文档明写它是 *"Owns every operation that may create, resume, or configure a Web Agent"*
 *   （`dsh-api-session-controller/lib/types/agent.d.ts:65`）。本模块**不自己拼**建会话
 *   的底层调用（那会绕过归档门禁、默认模型解析、preset 挂载等一串宿主不变量）。
 *   拿不到它 ⇒ `spawn` 明确拒绝。
 */
/**
 * 可选读 `agentPresets`（宿主预设注册表 · 第 10 轮新增）。
 *
 * ⚠ 与 {@link makeRegistryLookup} / {@link makeControllerLookup} **同一条纪律**：
 *   **不进 `inject` 依赖表**、也不进模块级 `export const inject` —— 那两种都是
 *   **加载门禁**（缺依赖 ⇒ 本模块 fiber 停在 PENDING ⇒ 插件整体不激活）。
 *   用 `ctx.get('<逐字服务名>')` **免 inject 现读**（E-100：免 inject 的只有"读服务"
 *   这一步，读到之后**不要**再对它做属性访问之外的花样）。
 *
 * 服务名逐字来源（**读出来的，不是猜的**）：
 *   `dsh-agent-preset-registry/lib/index.js:481` 的 `super(ctx, "agentPresets")`
 *   ⇒ 注册名就是 `agentPresets`（该文件 `:492-495` 的 `defaultId` getter 与
 *     `:598-604` 的 `remoteExportList()` / `resolve()` 是它的判据入口）。
 *
 * ⚠ **运行时现读、不缓存**（与 `registryOf` 同款实测理由）：它是并行激活的别的 fiber
 *   提供的服务，可能晚于本模块就绪；缓存一次会让"后来才就绪"永久读不到。
 *   ⚠ 实测补充（第 10 轮 · 真 cordis 4.0.4）：`Service` 子类的注册挂在 `ctx.provide`
 *     的 effect 上 ⇒ **apply 里同步读拿到 `undefined`、下一个 tick 才可见**。
 *     `spawn` 是**运行时**调用（早过了 boot），故这里不受影响；但探针若在 apply 里
 *     同步读会看到 `undefined`（本轮踩过，见 EXPERIENCE E-106）。
 */
function makePresetRegistryLookup(svcCtx: any): any {
  try {
    return typeof svcCtx.get === 'function' ? svcCtx.get('agentPresets') : undefined
  } catch {
    return undefined
  }
}

/**
 * 可选读 `sessionProjections`（宿主投影表）—— 用来读**会话当前实际运行的预设**。
 *
 * ── ⚠ ⚠ 为什么需要它（实测 · 第 292 轮那单的洞）─────────────────────────
 *   原先 `list()` 报的"预设"取自 **`session.header.agentPreset`** —— 而**宿主自己的定义**
 *   明写那只是**建档那一刻**的事实（`dsh-agent-preset-registry/lib/types/session.js`）：
 *     *"The creation header names the preset a session STARTED with, and it is deep-frozen
 *      because that is a creation fact. A session may still change preset while it is blank …
 *      Reconstruction reads the `agentPreset` Session projection, never the header alone."*
 *   ⇒ ⚠ ⚠ **实测后果**（本项目账本区 8 条会话逐条量过）：`header.agentPreset` **全部 = `standard`**，
 *     而其中 `session-0757b4c6-…`（**Hob 自己那条 · 规划侧**）在 **seq 3** 有一条
 *     `agent-preset/selected = Hob` ⇒ ⚠ ⚠ **它被报成实施侧**，⚠ **正是本单要修的那个缺陷**。
 *   ⚠ 宿主读法是**唯一权威**（`dsh-headless/lib/index.js` 的 `currentPreset(header, events, id)`）：
 *     **header 起步、由最后一条 `agent-preset/selected` 事件推进** ——
 *     与投影表 `agentPreset` 的定义（`init: header.agentPreset ?? null` +
 *     `apply: 只在 agent-preset/selected 上改写`）**逐字同义**。
 *
 * ── ⚠ 为什么走投影表而不是自己重放事件 ─────────────────────────────────
 *   宿主已把这个归约**注册成投影单元**（`dsh-api-session-controller/lib/index.js:340` 的
 *   `presetForSession()` 就是 `ctx.sessionProjections.stateOf(session, "agentPreset") ?? void 0`）。
 *   本模块**照抄宿主的读法**：⛔ 不自己扫事件流（那是第二条归约实现 ⇒ 必然漂），
 *   ⛔ 不读注册表的 `defaultId`（那是**部署默认** ⇒ 本单明禁用它顶替）。
 *
 * ── ⚠ 与 `makePresetRegistryLookup` 同一条纪律 ─────────────────────────
 *   **不进 `inject` 依赖表**、**运行时现读、不缓存**（理由见上一条注释）。
 *   缺席 ⇒ 返回 `undefined` ⇒ 该列退回 header 值（并如实标明来源），⛔ 不编造。
 */
function makeProjectionsLookup(svcCtx: any): any {
  try {
    return typeof svcCtx.get === 'function' ? svcCtx.get('sessionProjections') : undefined
  } catch {
    return undefined
  }
}

/**
 * ⚠ **第 11 轮删除**：原先这里有一个 `readHostDefaultPresetId()`，
 *   用来读宿主的**有效默认预设**（`remoteExportList()` 里 `isDefault` 那条，
 *   或注册表的 `defaultId` getter）。
 *
 *   **为什么删**（用户裁定 · 2026-10-10）：那个函数只为服务「（用宿主默认预设）」
 *   这个选项的兜底而存在 —— 而该选项**本身已被删除**（面板不再提供它，
 *   空值直接按 {link FACTORY_DEFAULT_PRESET_ID} 走）。
 *   ⇒ 留着一个"读宿主默认"的函数，等于留一条**没人该走的路**：
 *     它读到的值（本机 = `Hob`）恰恰是我们要绕开的东西。
 *   ⚠ "删干净"是判据的一部分：`check:presets` 的 ⑨ 组会钉住这个函数**不得回来**
 *     （除非连带把选项语义一起重新设计 —— 那要走用户决策，不是在代码里悄悄补）。
 */

/**
 * 该 id 是否**确实在**宿主当前名册里（第 10 轮新增）。
 *
 * ⚠ 用途：退回 {@link FACTORY_DEFAULT_PRESET_ID} 之后要**确认它真的存在** ——
 *   若宿主里没有这个预设，显式传它会让 `controller.create` 抛
 *   `Unknown agent preset`（宿主 `resolve()` 的行为，见
 *   `dsh-agent-preset-registry/lib/index.js:604-608`）⇒ **那是 spawn 失败**，
 *   而本轮硬约束是"**绝不让 spawn 失败**"。
 *
 * @param registry - `agentPresets` 服务。
 * @param id - 待确认的预设 id。
 * @returns `true` = 名册里有它（可以安全显式传）。
 */
async function presetExists(registry: any, id: string): Promise<boolean> {
  if (registry === undefined || registry === null) return false
  try {
    if (typeof registry.remoteExportList === 'function') {
      const roster = await registry.remoteExportList()
      const rows = Array.isArray(roster?.presets) ? roster.presets : []
      return rows.some((r: any) => r?.id === id)
    }
  } catch {
    // 读不到 ⇒ 当作"不确定 ⇒ 不显式传"（宁可退回不指定，也不冒 spawn 失败的风险）。
  }
  return false
}

function makeControllerLookup(svcCtx: any): any {
  try {
    return typeof svcCtx.get === 'function' ? svcCtx.get('sessionController') : svcCtx.sessionController
  } catch {
    return undefined
  }
}

/**
 * 预设读数的**来源标记**（⚠ 让"降级"可见，⛔ 不静默）。
 *
 * · `'projection'` —— 取自宿主 `agentPreset` 投影（**权威**）；
 * · `'header'`     —— 投影缺位，退回建档头（⚠ **可能不是当前值**）。
 *
 * ⚠ 与 {@link SessionInfo.presetSource} 是**同一个口径的两个出口**：
 *   那个给列表行、这个给"按会话 id 现读"的调用方（`hob_orch_status`）。
 *   ⛔ 两处各立一套来源名词必然漂 —— 故共用本类型。
 */
export type PresetSource = 'projection' | 'header'

/** 一次**按会话 id** 的预设读数（{@link HobBus.presetOf} 的返回）。 */
export interface PresetReading {
  /** 预设 id；投影与建档头都读不到 ⇒ 缺失。 */
  preset?: string
  /** 取自哪里（见 {@link PresetSource}）；两者都读不到 ⇒ 缺失。 */
  source?: PresetSource
}

/** `hobBus` 服务的形状。 */
export interface HobBus {
  readonly version: number
  /** 列**可投递的活**会话（已归档的不列）。 */
  list(selfSessionId: string | undefined): SessionInfo[]
  /**
   * 现读**指定会话当前运行的预设**（⚠ **全仓唯一实现点**，2026-10-17 第 2 轮）。
   *
   * ── 为什么必须从总线暴露，而不是各模块自读（**这是本方法存在的唯一理由**）──
   *   ⚠ 宿主明写建档头只是"建档那一刻"的事实（见本文件 `:300-317`），当前值在
   *   **`agentPreset` 投影**里。`list()` / `deliver()` 早已改走投影，而
   *   `hob_orch_status` 的「预设=」列**仍在读建档头** ⇒ 同一事实两个来源，
   *   **必然漂**（实测：本工作区 13 条会话里 4 条 `header=standard / 投影=Hob`，
   *   含 Hob 自己 ⇒ 那一列给错值，且「⚠ 规划侧预设·不能施工」不触发）。
   *   ⚠ 若让 `orchestrator` 也写一份 `stateOf(...)`，就是"守卫写两遍"的翻版
   *   —— 故**读数只在这里**，那边的唯一入口是**本方法**。
   *
   * ⚠ **降级语义原样保留**：投影读不到 ⇒ 退回建档头，且 `source='header'`
   *   —— 调用方**必须**能据此把"这是降级"渲染出来（⛔ 不许静默当真值用）。
   *
   * @param sessionId - 目标会话 id。
   * @returns 见 {@link PresetReading}；会话不存在 / 两个来源都读不到 ⇒ `{}`（⛔ 不猜默认值）。
   */
  presetOf(sessionId: string): PresetReading
  /** 向指定会话投递一条 user 消息。 */
  deliver(sessionId: string, text: string, mode: DeliveryMode): Promise<DeliveryResult>
  /**
   * ⚠⚠ **插件内部的投递入口**（2026-10-20 · 第 4 单）—— 与 {@link deliver} **同一份实现**，
   * 只**跳过"拒投给自己"那一道**。
   *
   * ── 为什么必须分开（现场读数定性，不是偏好）─────────────────────────────
   *   `deliver()` 那道 `callerId === sessionId ⇒ 拒绝` 的自检，本意是
   *   **"agent 不许给自己发消息"**（防自唤醒死循环）。
   *   而**回执是插件内部投递**、收件人 `w.watcher` **就是派活方自己** —— 两件事撞在一起：
   *   `reconcile()` 的 **T2**（每次 `hob_*` 调用）是在**派活方自己的执行作用域**里跑的
   *   ⇒ 那一刻 `currentInitiator()` 恒等于 `w.watcher` ⇒ **回执被自家守卫拒掉**
   *   （现场原文：`⚠ 回传失败：refusing to deliver to this session itself`，
   *    而 `已回传` 计数照涨 —— 另一类触发 T3/T5 的 `callerId` 是 `undefined`，投成功了）。
   *   ⇒ 「同一份回执一半尝试被打回、一半成功」，`pending` 里那条永远清不掉 ⇒ **反复重发**。
   *
   * ── 口径（⚠ 两条都不许破）──────────────────────────────────────────────
   *   · 本入口**只跳过那一道自检**；归档拒绝 / 活会话校验 / 预设预警 / 落库确认**全部照旧**
   *     （同一份实现，⛔ 不复制投递逻辑）；
   *   · **模型面 `hob_send` 仍走 `deliver()`**（那道守卫对它照旧生效，⛔ 不许放宽）。
   *   ⚠ 所以这不是"把守卫拆掉"，而是**把它限定回本来的作用面**：
   *     「模型发起的投递」而不是「插件内部回执的投递」。
   */
  deliverInternal(sessionId: string, text: string, mode: DeliveryMode): Promise<DeliveryResult>
  /**
   * 列可选的工作区（批 16）。给 `spawn` 挑目标用。
   *
   * @param selfSessionId - 调用方自己的会话 id；用来标出"本会话所在工作区"
   *   （那是 `spawn` 的默认归属，省得每次点名）。
   */
  listWorkspaces(selfSessionId: string | undefined): Promise<WorkspaceInfo[]>
  /**
   * 新建一个会话并**强制归属到某个工作区**（批 16）。
   *
   * @param workspace - 目标工作区：**id 或路径**。缺省 = 调用方自己的工作区。
   * ⚠ 这是本能力的**设计核心**：宿主 `sessionController.create` 的
   *   `workspaceId` 是**可选**字段，不传就建出"不属于任何工作区"的孤儿会话
   *   （2026-10-09 实测：只传 `cwd` 建出的会话在 `workspace.json` 里查无归属）。
   *   本方法**不接受"不指定"**：要么显式给，要么落到调用方自己的工作区；
   *   拿不准就拒，**绝不造孤儿**。
   *
   * ⚠ **批 18（2026-10-09）起本方法还套用「新建会话默认值」**（{@link HobBusConfig.spawn}）：
   *   · **预设**：工具显式给了 `agentPreset` ⇒ **以它为准**（原语义不变）；
   *     没给 ⇒ 用配置里的 `spawn.agentPreset`；配置也为空 ⇒ 保持现状（交宿主默认）。
   *   · **模型**：配置里 `spawn.provider` / `spawn.model` 齐备 ⇒ 建会话后给**该会话**
   *     装一个**会话级**模型选择（见 `src/model-selection.ts` 的文件头：
   *     判定两条判据、为什么不能调 `controller.selectModel`）。
   *     **一次也不碰宿主的全局默认模型**。
   */
  spawn(workspace: string | undefined, agentPreset: string | undefined, selfSessionId: string | undefined): Promise<SpawnResult>
}

/**
 * `hobBus` 模块收到的配置（由 `src/index.ts` 交进来）。
 *
 * ⚠ **刻意传"现读函数"而不是解好的值**（实测依据）：设置页写配置**不会重启插件**
 *   （宿主 volatile 的定义就是 "editable without remounting"；实测写入前后
 *   `dsh-hob-bus` 的 fiber uid 未变），而 volatile ref 是**原地更新**的
 *   ⇒ 若在 `apply` 那一刻快照一次，之后设置页再改就**永远读不到**，
 *   且**静默不报错**（症状：设置页改了、建会话仍用旧默认）。
 *   ⇒ 每次 `spawn()` 调一次 `spawnDefaults()` 现读。
 *
 * ⚠ 模块内**不得**直接读 `config.spawn.x`（那是 volatile ref，直读恒为 ref）。
 */
export interface HobBusConfig {
  /** 现读「新建会话默认值」（`config.ts` 的 `spawnDefaults()` 收口）。 */
  spawnDefaults?: () => SpawnDefaults
}

/** 就绪时挂上的实现（`apply` 里构造，服务缺席时不会存在）。 */
export function apply(ctx: any, config: HobBusConfig = {}): void {
  ctx.logger?.debug?.(`[${name}] 已激活，等待 sessions/agents`)

  /**
   * ══════════════════════════════════════════════════════════════════════
   * ⚠⚠ **两处「丢弃返回值 ⇒ 失败不可见」的读数出口**（2026-10-21 · 第 329 轮）
   * ══════════════════════════════════════════════════════════════════════
   *
   * 这两个变量**必须声明在 `bus` 字面量之前**（`bus.handoffWriteIssues()` 要读它们），
   *   而写入点（`noteHandoff` / `clearAfterDelivery`）在文件后段 —— 同一函数作用域，能共享。
   *
   * ── **甲-8**：`recordHandoff` / `clearHandoffs` 的返回值被丢 ⇒ 记账失败无痕 ────────
   *   · `handoffWriteNote` ⇒ **这条账没记上 / 没清掉**。后果：重载后这次派发在读数里
   *     **与"从来没派过"逐字相同**（本项目最忌的"两种原因说成同一句话"）。
   *   · ⚠ 判"清账失败"时**⛔ 不许一律看 `wrote === false`**：`clearHandoffs` 在
   *     "没有匹配项"时**本来就不写盘**（那是正常路径）⇒ 判据是
   *     **`cleared.length > 0 && wrote !== true`**。
   *
   * ── **甲-9**：`ensureRuntimeIgnored` 的返回值被丢 ⇒ `runtime/` 可能进 git 历史 ──────
   *   · `handoffIgnoreNote` ⇒ **`runtime/.gitignore` 没写成**。后果不是"少一个文件"，
   *     而是 `orch-watches.json` 里的**会话 id 被提交进账本仓库**。
   *
   * ⚠ **两个字段分开、⛔ 不合并**：成因不同、修法不同（一个去查盘能不能写、
   *   一个去查 `runtime/.gitignore`）。⚠ 两者**可以同时成立**。
   * ⚠ **正常档一律 `undefined`** ⇒ `handoffWriteIssues()` 回空对象 ⇒ 状态行**一个字都不多**。
   */

  // ⚠ 配置**每次现读**（不是装载时快照）：设置页写入不会重启插件，
  //   而 `spawn` 的四个子字段是**原地更新**的 volatile ref（实测 fiber uid 未变）。
  //   快照一次的后果是"设置页改了、spawn 仍用旧默认"，且**静默**。
  //   收口点仍是 `config.ts` 的 `spawnDefaults()`；模块内不直接读 `config.spawn.x`。
  const readSpawn = (): SpawnDefaults =>
    config?.spawnDefaults?.() ?? { agentPreset: '', provider: '', model: '', reasoningEffort: '' }

  // ⚠ 依赖表里**只有这两个**。`workspaceRegistry` **绝不能加进来**：
  //   cordis 的 `inject` 是"全部必需"（`_refresh` 缺一即 INACTIVE）⇒ 加进来就等于
  //   宣布"没有它本模块不激活"。它由 `makeArchivedLookup` 用 `ctx.get` **可选**读取。
  ctx.inject(['sessions', 'agents'], (svcCtx: any) => {
    const sessions = svcCtx.sessions ?? svcCtx.get?.('sessions')
    const agents = svcCtx.agents ?? svcCtx.get?.('agents')
    if (sessions === undefined || agents === undefined) {
      svcCtx.logger?.warn?.(`[${name}] sessions/agents 已就绪但不可用。`)
      return
    }
    // 可选读：拿不到归档集就退化成"没有归档概念"，本模块照常工作。详见该函数注释。
    const isArchived = makeArchivedLookup(svcCtx)
    // 可选读：`workspaceRegistry`（批 16 建会话要它）。同样的纪律 —— 不进 inject 表。
    //
    // ⚠⚠ **必须惰性读、不能在这里取一次存起来**（2026-10-09 真机抓到的缺陷）。
    //   原先写的是 `const registry = makeRegistryLookup(svcCtx)` —— 在**本模块构建那一刻**
    //   读一次。而 `workspaceRegistry` 由**另一个插件的 fiber** 提供，与本模块**并行激活**，
    //   谁先就绪不保证 ⇒ 若本模块先到，这里取到的就是 `undefined`，**从此永远 `undefined`**。
    //   真机症状（重启后必现）：`hob_spawn` 一律返回
    //   `workspace registry unavailable: cannot resolve a workspace…`，
    //   而**同一个服务在 probe 里 `ctx.get('workspaceRegistry')` 明明读得到** ⇒
    //   服务在、只是本模块**记错了它不在**。
    //   ⇒ 与 `makeArchivedLookup` 同一条纪律（E-96）：**外部活状态一律每次现读**。
    const registryOf = () => makeRegistryLookup(svcCtx)
    // 可选读：`sessionController`（建会话的真正入口）。缺席 ⇒ `spawn` 明确拒绝。
    // ⚠ 同样惰性：理由与上一行完全相同（它也是并行激活的别的 fiber 提供的）。
    const controllerOf = () => makeControllerLookup(svcCtx)
    // 可选读：`agentPresets`（宿主预设注册表 · 第 10 轮）。**只在"不指定预设"那条路上用**，
    //   用来解析"宿主的有效默认预设是谁"。缺席 ⇒ **不拒绝 spawn**，退回不指定 + 如实报告
    //   （见 spawn 里的兜底分支）—— 它只是一个**增强判据**，不是建会话的必需品。
    const presetRegistryOf = () => makePresetRegistryLookup(svcCtx)
    // 可选读：`sessionProjections`（宿主投影表 · 第 292 轮）。用来读**会话当前运行的预设**。
    //   见 `makeProjectionsLookup` 的注释：宿主明写 header 只是建档事实，当前值在投影里。
    //   缺席 ⇒ 退回 header 值并如实标明（⛔ 不静默、⛔ 不编造）。
    const projectionsOf = () => makeProjectionsLookup(svcCtx)

    /**
     * 读一个会话的**当前**预设（⚠ 权威 = 宿主投影；缺席 ⇒ 退回 header 并标来源）。
     * @returns `[preset, source]`；两者都读不到 ⇒ `[undefined, undefined]`。
     */
    const currentPresetOf = (session: any): [string | undefined, 'projection' | 'header' | undefined] => {
      // ① 权威来源：宿主 `agentPreset` 投影（= header + 最后一条 agent-preset/selected）。
      try {
        const projections = projectionsOf()
        if (projections !== undefined && typeof projections.stateOf === 'function') {
          const v = projections.stateOf(session, 'agentPreset')
          if (typeof v === 'string' && v !== '') return [v, 'projection']
        }
      } catch {
        // 投影读失败 ⇒ 走下面的降级，⛔ 不让单个会话把整张表带崩。
      }
      // ② 降级：建档头（⚠ 只是"它建的时候是什么"，可能不是当前值）。
      const h = session?.header?.agentPreset
      if (typeof h === 'string' && h !== '') return [h, 'header']
      return [undefined, undefined]
    }

    /**
     * 把**一个**冷目标会话叫活（{@link deliverImpl} 的 ① 分支唯一调用点）。
     *
     * ── 为什么单独成函数（⛔ 不内联进 deliverImpl）──────────────────────────
     *   唤醒是**有代价、可能慢、可能失败**的一步，而投递本身是另一件事。
     *   把"叫人起来"与"投一条消息"分开写，才能各自被单测/判据钉住
     *   （本轮六条判据里有三条只针对唤醒，两条只针对唤醒失败话术）。
     *
     * ── 叫醒用什么（⚠ 只许用宿主原生入口）────────────────────────────────
     *   `sessionController.resolveAgent(sessionId)` —— 宿主自己的
     *   「Resolve or resume one ordinary Session」入口
     *   （`dsh-api-session-controller/lib/index.js:3037`，其实现 `:221` 的 `resolve()`：
     *   **先查 live、再 resume**，并对并发 resume 去重 ⇒ **天然幂等**）。
     *   ⛔ **不自己拼 resume**：那会绕过归档门禁、默认模型解析、预设挂载等一串宿主不变量
     *   （与 `spawn` 用 `controller.create` 而不是自己建会话是**同一条纪律**）。
     *
     * ── 三条硬边界（作业书 §二 明列）──────────────────────────────────────
     *   1. **只叫这一次**：⛔ 不重试、⛔ 不轮询、⛔ 不广播；
     *   2. **只叫这一个 id**：⛔ 不遍历、⛔ 不顺手把同工作区的也拉起来；
     *   3. **有上限**：{@link WAKE_TIMEOUT_MS} 到点报 `timeout`，⛔ 不许无限等。
     *
     * @param sessionId - 本次**真要投递**的那个目标（⛔ 不接收 id 列表）。
     * @returns 如实读数；**不抛错**（失败一律变成 `{ok:false, failure, detail}`）。
     */
    const wakeTarget = async (sessionId: string): Promise<WakeOutcome> => {
      const startedAt = Date.now()
      const elapsed = () => Date.now() - startedAt
      const controller = controllerOf()
      /**
       * ③ 唤醒能力缺席 ⇒ **退化成"直接拒"**（话术点明能力不可用），⛔ 不假装成功。
       *    ⚠ 为什么按"缺失"处理而不是"就当目标真不存在"：两者对调用方的含义不同 ——
       *      "这个部署没有唤醒能力"是**环境事实**，值得报出来；
       *      而"这个 id 从没存在过"是**调用方的输入错误**。⛔ 混成一句会让后者被掩盖。
       */
      if (controller === undefined || typeof controller.resolveAgent !== 'function') {
        return {
          ok: false,
          failure: 'unavailable',
          elapsedMs: elapsed(),
          detail: 'sessionController.resolveAgent is not available in this host composition',
        }
      }
      // ⚠ 超时与"宿主自己拒绝"要能区分 ⇒ 用一个可辨识的哨兵，⛔ 不靠 message 文本匹配。
      const TIMEOUT = Symbol('wake-timeout')
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const resolved = await Promise.race([
          // ⚠ 用 `Promise.resolve().then(...)` 包一层：`resolveAgent` 在参数校验阶段
          //   可能**同步抛**，那样 `Promise.race` 接不住（会直接冲出 try 之外，
          //   与"超时"混在一个 catch 里就分不清是哪种失败）。
          Promise.resolve().then(() => controller.resolveAgent(sessionId)),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(TIMEOUT), WAKE_TIMEOUT_MS)
            // ⚠ `unref`：定时器不许把宿主进程吊住（投递失败不该影响进程退出）。
            ;(timer as any)?.unref?.()
          }),
        ]) as any
        /**
         * ⚠ 宿主的返回形状**不是**"agent 或 throw"，而是 `{agent}` / `{error}` 判别式
         *   （`ApiSessionAgentResult`）。⚠ **两种都要认**：
         *   · `{error}` ⇒ 唤醒**明确失败**（如 `session/not-found`、后端坏）；
         *   · 直接给了一个对象、没有 `error` 字段 ⇒ 当作成功（宽松但如实：
         *     真正的判据是下面"再查一次 `agents.get`"，那个骗不了人）。
         */
        if (resolved !== undefined && resolved !== null && typeof resolved === 'object' && 'error' in resolved) {
          const err: any = (resolved as any).error
          return {
            ok: false,
            failure: 'threw',
            elapsedMs: elapsed(),
            detail: String(err?.message ?? err ?? 'resolveAgent reported an error'),
          }
        }
        return { ok: true, elapsedMs: elapsed() }
      } catch (e: any) {
        if (e === TIMEOUT) {
          return {
            ok: false,
            failure: 'timeout',
            elapsedMs: elapsed(),
            detail: `wake did not finish within ${WAKE_TIMEOUT_MS}ms`,
          }
        }
        return {
          ok: false,
          failure: 'threw',
          elapsedMs: elapsed(),
          detail: String(e?.message ?? e),
        }
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    }

    /**
     * 唤醒失败时的**可读话术**（⚠ 与"目标不存在"分成两句，⛔ 不混）。
     *
     * ⚠ 三档各说各的（作业书 §§二-3 / 三-2 / 三-3）：
     *   · `unavailable` ⇒ 点明"唤醒能力不可用，所以没法叫它起来"；
     *   · `timeout`     ⇒ 点明"叫了但超时"（并给出毫秒数）；
     *   · `threw`       ⇒ 带上宿主原话（⛔ 不加工、不吞）；
     *   · `still-not-live` ⇒ 点明"叫了、调用回来了，但它仍然不在活会话表里"。
     * 四者**都**保留原 `is not a live session` 前缀 —— 那是既有调用方（对账/工具面）
     * 已经在读的字样，⛔ 不许因为改话术把既有读数打断。
     */
    const wakeReasonOf = (sessionId: string, wake: WakeOutcome): string => {
      const base = `session "${sessionId}" is not a live session; only live sessions can receive; `
      const tail = 'do not wake archived history — pick another target or let the user open that session first.'
      switch (wake.failure) {
        case 'unavailable':
          return base + 'the wake capability is unavailable in this host composition '
            + '(no sessionController.resolveAgent), so the target could not be brought up. '
            + 'Pick another target, or let the user open that session first.'
        case 'timeout':
          return base + `wake was attempted but timed out after ${WAKE_TIMEOUT_MS}ms `
            + `(elapsed ${String(wake.elapsedMs ?? WAKE_TIMEOUT_MS)}ms); retry later or let the user open `
            + 'that session first.'
        case 'threw':
          return base + 'wake was attempted but the host refused it: '
            + `${String(wake.detail ?? '(no detail)')}`
        default:
          return base + 'wake was attempted and returned, but the target is STILL not a live agent; '
            + tail
      }
    }

    /**
     * ⚠⚠ **投递的唯一实现**（2026-10-20 · 第 4 单；`deliver` 与 `deliverInternal` 共用）──
     *
     * ⚠ 放在 `bus` 字面量**之前**，是为了让两个入口**共用同一份实现**：
     *   复制一份投递逻辑出去，它迟早与主路径漂（"两处各写一份"正是本项目反复踩过的成因）。
     * @param skipSelfGuard - **只有 `deliverInternal` 传 `true`**：跳过"拒投给自己"那一道。
     *   那道自检本意是"agent 不许给自己发消息"（防自唤醒死循环），而**插件内部回执**的
     *   收件人 `w.watcher` 本来**就是派活方自己** ⇒ 两件事不该共用一道守卫。
     *   详见 {@link HobBus.deliverInternal} 的注释（现场原文 + 三条触发路径）。
     */
    const deliverImpl = async (
      sessionId: string,
      text: string,
      mode: DeliveryMode,
      skipSelfGuard: boolean,
    ): Promise<DeliveryResult> => {
        if (typeof sessionId !== 'string' || sessionId === '') {
          return { ok: false, reason: 'no-session-id' }
        }
        // ⓪-1 **拒投给自己** —— 这道自检原先**只在工具层**（`hob_send` 的 execute）有，
        //   服务层没有 ⇒ **任何绕过工具的调用方**都能重犯。2026-10-09 实测踩过：
        //   一个探针用 `bus.list(undefined).filter(r => !r.self)` 挑"别的会话"，
        //   而 `self` 是 **list 入参的派生字段**（传 undefined 时所有行都是 false）
        //   ⇒ 过滤等于没写 ⇒ 投给了本会话，一条探针消息混进了用户的对话（F-J141 / E-97）。
        //   ⇒ 把保护下沉到服务层：**单层设防等于绕过去就没保护**。
        //
        //   ⚠ 调用者身份**不靠传参**（传参就会被绕过，且探针/未来模块未必知道自己的 id）：
        //     用宿主的 `agents.currentInitiator()` —— 它由 `AsyncLocalStorage` 实现
        //     （`dsh-agent/lib/index.js:325,368`），在工具执行的作用域内**天然可用**，
        //     与 `selfSessionIdOf(exec)` 读的是同一个实体，但**不需要调用方配合**。
        const callerId = (() => {
          try {
            const a = agents.currentInitiator?.()
            return a?.id ?? a?.session?.id
          } catch {
            return undefined
          }
        })()
        /**
         * ⚠⚠ **这道守卫只该管"模型发起的投递"**（2026-10-20 · 第 4 单）。
         *
         * 现场原文（`hob_orch_status` 的等待记录）：
         *   `⚠ 回传失败：refusing to deliver to this session itself`
         * 而 `已回传` 计数照涨 —— 因为**触发点不同**：
         *   · **T2**（每次 `hob_*` 调用）在**派活方自己的执行作用域**里跑 ⇒ `callerId` 恒等于
         *     `w.watcher` ⇒ **这一路永远投不出去**；
         *   · **T3/T5**（`agent/status` / 一次性复查）不在那个作用域里 ⇒ `callerId === undefined`
         *     ⇒ 投得出去。
         * ⇒ 「一半打回、一半成功」= 同一份回执反复送达的**直接机理**。
         * ⚠ 而**回执的收件人本来就是派活方自己**（`w.watcher`），那是**插件内部投递**，
         *   不是"agent 给自己发消息"（后者才是这道守卫要防的自唤醒死循环）。
         * ⇒ 内部入口（{@link HobBus.deliverInternal}）传 `skipSelfGuard=true` 跳过它；
         *   **模型面 `hob_send` 走 `deliver()`，这道守卫照旧生效**（⛔ 不许放宽）。
         */
        if (skipSelfGuard !== true && typeof callerId === 'string' && sessionId === callerId) {
          return { ok: false, reason: 'refusing to deliver to this session itself' }
        }
        // ⓪ 归档会话**明确拒绝**（不能只是"列表里不显示"）。
        //    ⚠ 这一步是**静默失败的收口**：往归档会话投递在技术上会成功
        //      （消息进 inbox、`followup` 唤醒），但执行会被宿主
        //      `agent/pre-step` 门禁挡下 —— 投递回执说 ok、活却永远不发生。
        //      宁可在这里**明确说不**，也不要让调用方拿一个假成功。
        if (isArchived(sessionId)) {
          return {
            ok: false,
            reason: `session "${sessionId}" is archived; an archived session is woken by a delivery `
              + 'but its execution is gated off (agent/pre-step), so the work would never run. '
              + 'Pick another live target, or unarchive it first.',
          }
        }
        // ① 目标必须在**活**会话里 —— `agents.get` 的语义就是"活 agent"。
        let agent = typeof agents.get === 'function' ? agents.get(sessionId) : undefined
        let wake: WakeOutcome | undefined
        if (agent === undefined) {
          /**
           * ⚠⚠ **冷目标：投之前先叫一次活**（2026-10-21 · 第 330 轮 · 根因修复）。
           *
           * ── 为什么必须在这里叫（不是"建议用户去点开"）──────────────────────
           *   根因已在 `ANSWER.md` 定死：`agents.get` 只是查**进程内内存 Map**
           *   （`dsh-agent/lib/index.js:596`），而这张表**只有 `agents.enter` 一个插入口**
           *   （同文件 `:512`），其唯一调用者是 agent loop 的发布路径
           *   （`dsh-agent-loop/lib/index.js:1791`）。冷会话（只在磁盘上、没被任何入口
           *   resolve 过）**不在表里** ⇒ 返回 `undefined` ⇒ 本函数原先**直接拒绝**。
           *   后果：**执行会话跑完时，派活方（Hob）通常没被打开** ⇒ 回执投不进去
           *   ⇒ 整个闭环派活的核心承诺在最常见的情形下断掉（用户实测：
           *   「回执只有点了 Hob 会话，随后 Hob 才会收到」）。
           *
           * ── 改法只做三件事（⛔ 不扩）──────────────────────────────────
           *   ① 经宿主 `sessionController.resolveAgent(id)` 叫**这一个**目标起来
           *      （它内部先查 live、再 resume ⇒ 天然幂等）；
           *   ② 叫完**再查一次** `agents.get`：查到 ⇒ 继续走**原有投递路径，一个字不改**；
           *      还空 ⇒ 仍然拒绝，但话术**明说"已尝试唤醒但没起来"**（与"不存在"分开）；
           *   ③ 唤醒能力缺席（宿主没给 `sessionController`）⇒ **退化成原来的直接拒**，
           *      话术点明"唤醒能力不可用"，⛔ 不许假装成功。
           *
           * ── 四条不改的边界（越一条即错）──────────────────────────────
           *   · **只对本次真要投递的那一个目标**做**一次** resolve ⇒ ⛔ 不广播、⛔ 不遍历、
           *     ⛔ 不重试到死（失败**一次就报**）。
           *   · 唤醒**有代价**（装配 agent、可能烧 token）⇒ 只在"确实要投"时做。
           *     ⛔ **不许**在 `list()` / 状态查询 / 对账扫描里顺手 resolve（那会把
           *     "看一眼"变成"叫一片起来"）。
           *   · 唤醒**可能慢** ⇒ {@link WAKE_TIMEOUT_MS} 到点**如实报超时**，
           *     ⛔ 不许让调用方无限等。
           *   · 归档会话在上一步（⓪）已**明确拒绝**，走不到这里 ⇒ 唤醒**永远无法绕过归档门禁**。
           */
          wake = await wakeTarget(sessionId)
          agent = typeof agents.get === 'function' ? agents.get(sessionId) : undefined
          if (agent === undefined) {
            return {
              ok: false,
              reason: wakeReasonOf(sessionId, wake),
              wake,
              wakeFailure: wake.failure ?? 'still-not-live',
            }
          }
        }
        // ② **目标预设预警**（第 129 轮新增）—— 只提示、不拦、不改投递成败。
        //
        //   ⚠ **为什么下沉到服务层**（而不是只在 `hob_send` / `hob_dispatch` 的工具层）：
        //     与本文件 ⓪-1 那条自检**同一条纪律**（见上方 `:449-454` 的既有注释）：
        //     **单层设防等于绕过去就没保护**。`deliver()` 有**三个调用点**
        //     （`hob_send` · `hob_dispatch` · 编排器内部的回传/丢失通知），
        //     只在工具层写 ⇒ 另外两条路照旧静默。
        //   ⚠ **为什么"提示"而不是"拦截"**：给规划侧会话发消息**本身可能合法**
        //     （问它状态 / 让它规划 / 传个读数）⇒ 拦投递会**误伤**合法用法，
        //     且会把"投递成功与否"这个既有语义改掉（那是**零放宽**的反面：改宽/改严都不行）。
        //     ⇒ 如实**预警**，把决定权留给调用方。
        //   ⚠ **读法（第 292 轮改）**：目标预设取自**宿主 `agentPreset` 投影**
        //     （= header 起步 + 最后一条 `agent-preset/selected`），⚠ 与 `list()` 用的是
        //     **同一个读数函数**（见上方 `currentPresetOf`）—— ⛔ 不缓存、不猜。
        //     ⚠ ⚠ **原实现只读 `session.header.agentPreset`** ⇒ ⚠ 对"建后改过预设"的会话
        //     （实测：Hob 那条正是）会**读到陈旧值** ⇒ 该预警会**对真正的规划侧会话不报**
        //     （那正是这条预警存在的理由），也会**对已改成实施侧的会话误报**。
        const targetPreset = (() => {
          try {
            const session = typeof sessions.get === 'function' ? sessions.get(sessionId) : undefined
            return currentPresetOf(session)[0]
          } catch {
            return undefined
          }
        })()
        const presetNotice = targetPreset === HOB_PRESET_ID
          ? 'WARNING: the target session ' + sessionId + ' is running the PLANNING-side preset ('
            + HOB_PRESET_ID + '). That preset plans work but CANNOT carry it out — it has no shell '
            + 'and no write/edit tool, and its charter says so. A directive that asks it to implement, '
            + 'run, or verify something by doing the work will look like it is running (hob_orch_status '
            + 'shows "started", hob_sessions shows "running") but will NEVER produce the implementation — '
            + 'you will get planning text at best, and often no deliverable at all. '
            + 'NEXT STEP: if this message is meant to get work DONE, send it to a session whose preset '
            + 'can implement (check the preset column in hob_sessions), or hob_spawn one with an explicit '
            + 'agentPreset; do not wait for a deliverable from this target. '
            + 'This delivery itself succeeded — the notice does not block it, because messaging a '
            + 'planning session can still be legitimate.'
          : undefined
        // ③ 造消息：与 `dsh-schedule` 同款（`createUserMessage` + 自定义 source kind）。
        //    ⚠ 导入走**运行时动态 import**：本模块在宿主进程里跑，`@deepseek-ai/dsh-llm`
        //      从插件自己的 node_modules 解析（与宿主那份同版本、逐字节相同）。
        //      用动态导入是为了让"这一条路径坏了"不至于让整个模块装载失败。
        let message: any
        try {
          const llm: any = await import('@deepseek-ai/dsh-llm')
          message = llm.createUserMessage({
            content: [{ type: 'text', text }],
            source: { kind: 'hob' },
          })
        } catch (e) {
          return { ok: false, reason: 'message-build-failed: ' + String((e as Error)?.message ?? e) }
        }
        // ③ 投递（三种语义都是原生方法）。
        try {
          if (mode === 'steer') agent.steer(message)
          else if (mode === 'inject') agent.inject(message)
          else agent.followup(message)
        } catch (e) {
          return { ok: false, reason: 'delivery-failed: ' + String((e as Error)?.message ?? e) }
        }
        // ④ 落库确认 —— 对标 schedule：`flush` 返回 false 表示持久化没确认。
        //    ⚠ 这一步**不改变投递是否成功**（消息已经进 inbox 了），只是如实标注。
        try {
          const session = typeof sessions.get === 'function' ? sessions.get(sessionId) : undefined
          if (session !== undefined && typeof sessions.flush === 'function') {
            const durable = await sessions.flush(session)
            if (durable === false) {
              return {
                ok: true,
                messageId: message?.id,
                mode,
                reason: 'delivered but persistence did not acknowledge',
                ...(presetNotice === undefined ? {} : { presetNotice }),
                ...(wake === undefined ? {} : { wake }),
              }
            }
          }
        } catch {
          // 落库确认失败不否定投递本身。
        }
        return {
          ok: true,
          messageId: message?.id,
          mode,
          ...(presetNotice === undefined ? {} : { presetNotice }),
          ...(wake === undefined ? {} : { wake }),
        }
    }

    const bus: HobBus = {
      version: 1,
      /**
       * ⚠ **全仓唯一**的"按会话 id 现读预设"入口（本方法体本身也只有这一份实现）。
       *
       * 读法与 {@link SessionInfo.agentPreset} **完全同源**（都走 `currentPresetOf`）：
       *   ⛔ 这里如果再写一遍 `stateOf(...)` / `header?.agentPreset`，就是第二份归约
       *   ⇒ 必然漂（本方法的由来正是"两处读法已经漂了一次"）。
       */
      presetOf(sessionId: string): PresetReading {
        if (typeof sessionId !== 'string' || sessionId === '') return {}
        try {
          const session = typeof sessions.get === 'function' ? sessions.get(sessionId) : undefined
          if (session === undefined || session === null) return {}
          const [preset, source] = currentPresetOf(session)
          return {
            ...(preset === undefined ? {} : { preset }),
            ...(source === undefined ? {} : { source }),
          }
        } catch {
          // 单个会话读不出来 ⇒ 空读数（调用方渲染成 `(读不到)`，⛔ 不编造、不猜默认值）。
          return {}
        }
      },
      list(selfSessionId: string | undefined): SessionInfo[] {
        const rows: SessionInfo[] = []
        // `list()` 返回的是**活会话**（创建顺序）；失败一律当作"列不出来"，
        // 由调用方看到空列表 —— 不编造、不抛给模型。
        let live: any[] = []
        try {
          const all = typeof sessions.list === 'function' ? sessions.list() : []
          live = Array.isArray(all) ? all : []
        } catch {
          return []
        }
        for (const s of live) {
          try {
            const id = String(s?.id ?? s?.header?.id ?? '')
            if (id === '') continue
            // ⚠ 归档会话**不列**：归档只写归档集、不 dispose agent，所以它们此刻
            //   仍会出现在 `sessions.list()` 里。列出去 = 让 Hob 挑一个投了也没人
            //   执行的靶（`agent/pre-step` 门禁会挡下）。判据见 `makeArchivedLookup`。
            if (isArchived(id)) continue
            const header = s?.header ?? {}
            const agent = typeof agents.get === 'function' ? agents.get(id) : undefined
            // ⚠ ⚠ 预设取**当前运行值**（宿主投影），⛔ 不是建档头 —— 见 `currentPresetOf`。
            const [preset, presetSource] = currentPresetOf(s)
            rows.push({
              id,
              ...(typeof header.cwd === 'string' ? { cwd: header.cwd } : {}),
              ...(preset === undefined ? {} : { agentPreset: preset, presetSource }),
              // ⚠ 「在哪一侧」由**同一个值**派生（口径同源 HOB_PRESET_ID，⛔ 不另写字面量）。
              ...(preset === undefined
                ? {}
                : { side: preset === HOB_PRESET_ID ? 'planning' as const : 'implementation' as const }),
              ...(agent?.status === undefined ? {} : { status: String(agent.status) }),
              live: agent !== undefined,
              self: selfSessionId !== undefined && id === selfSessionId,
            })
          } catch {
            // 单个会话读不出来不该让整张表失败。
          }
        }
        // 活的和 running 的排前面，便于调用方挑target。
        return rows.sort((a, b) => {
          if (a.live !== b.live) return a.live ? -1 : 1
          if ((a.status === 'running') !== (b.status === 'running')) return a.status === 'running' ? -1 : 1
          return a.id.localeCompare(b.id)
        })
      },

      /** 投递（**模型面入口**：那道"拒投给自己"的守卫照旧生效）。 */
      deliver(sessionId: string, text: string, mode: DeliveryMode): Promise<DeliveryResult> {
        return deliverImpl(sessionId, text, mode, false)
      },

      /**
       * ⚠⚠ **插件内部回执的投递入口**（2026-10-20 · 第 4 单）。
       *
       * ⚠ 与 `deliver()` **共用同一份实现**，唯一差别是跳过"拒投给自己"那一道 ——
       *   理由见 {@link HobBus.deliverInternal}（现场原文 + 三条触发路径）。
       * ⚠ **⛔ 不许把 `hob_send` 改到这条路上**：模型给自己发消息仍然必须被拒。
       */
      async deliverInternal(
        sessionId: string,
        text: string,
        mode: DeliveryMode,
      ): Promise<DeliveryResult> {
        /**
         * ⚠ 走的就是 `deliverImpl`（**同一个函数对象**，`skipSelfGuard = true`）：
         *   ⛔ 不复制一份投递逻辑 —— 复制出来的那份迟早与主路径漂。
         */
        return deliverImpl(sessionId, text, mode, true)
      },

      // ── 批 16：建会话（强制归属工作区）────────────────────────────────
      async listWorkspaces(selfSessionId: string | undefined): Promise<WorkspaceInfo[]> {
        // ⚠ 每次现读（不缓存）—— 服务可能在本模块构建之后才就绪，见 `registryOf` 注释。
        const registry = registryOf()
        if (registry === undefined || registry === null) return []
        let raw: any[] = []
        try {
          const l = registry.list()
          raw = Array.isArray(l) ? l : l === undefined || l === null ? [] : [...l]
        } catch {
          return []
        }
        // 本会话所在的工作区：会话 → 路径（`sessionPaths` 索引）→ 工作区记录。
        // ⚠ 走 sessionPaths 而不是 header.workspaceId —— 后者实测恒为 null
        //   （归属由注册表按 canonical-cwd 登记，不在会话 header 里）。
        let selfPath: string | undefined
        if (selfSessionId !== undefined) {
          try {
            const p = registry.sessionPaths?.get?.(selfSessionId)
            if (typeof p === 'string') selfPath = p
          } catch { /* 读不到就不标 self */ }
        }
        const rows: WorkspaceInfo[] = []
        for (const w of raw as any[]) {
          try {
            const id = String(w?.id ?? '')
            const path = String((w?.path ?? w?.record?.path) ?? '')
            if (id === '' || path === '') continue
            rows.push({
              id,
              path,
              ...(typeof (w?.title ?? w?.record?.title) === 'string' ? { title: String(w.title ?? w.record.title) } : {}),
              sessions: Array.isArray(w?.sessionIds ?? w?.record?.sessionIds) ? (w.sessionIds ?? w.record.sessionIds).length : 0,
              self: selfPath !== undefined && path === selfPath,
            })
          } catch { /* 单条坏掉不影响整表 */ }
        }
        return rows.sort((a, b) => (a.self !== b.self ? (a.self ? -1 : 1) : a.path.localeCompare(b.path)))
      },

      async spawn(
        workspace: string | undefined,
        agentPreset: string | undefined,
        selfSessionId: string | undefined,
      ): Promise<SpawnResult> {
        // ① 服务齐不齐 —— 缺一个都**明确拒绝**，绝不降级成"建个孤儿"。
        // ⚠ 两者都**每次现读**（不缓存）：它们是并行激活的别的 fiber 提供的，
        //   可能在本模块构建之后才就绪（见 `registryOf` 注释）。
        const registry = registryOf()
        const controller = controllerOf()
        if (registry === undefined || registry === null) {
          return { ok: false, reason: 'workspace registry unavailable: cannot resolve a workspace, and creating a session without one is refused.' }
        }
        if (controller === undefined || controller === null || typeof controller.create !== 'function') {
          return { ok: false, reason: 'session controller unavailable: the host owns session creation; this module does not create sessions by itself.' }
        }

        /** 读回可选清单（给错目标时回带，便于改对）。 */
        const available = async (): Promise<string[] | undefined> => {
          try {
            const ws = await (bus as any).listWorkspaces(selfSessionId)
            return (ws as WorkspaceInfo[]).map((w) => `${w.path}${w.self ? ' (this session\'s workspace)' : ''}`)
          } catch { return undefined }
        }

        // ② 解析目标工作区：**显式给的**（id 或路径）→ 否则**本会话自己的**。
        //    ⚠ 两条路都必须落到一个**真实存在**的工作区上。
        let wsId: string | undefined
        let wsPath: string | undefined
        if (typeof workspace === 'string' && workspace.trim() !== '') {
          const want = workspace.trim()
          // 先当 id 试（宿主会校验存在性）；拿不到就走路径。
          try {
            const byId = registry.get?.(want)
            if (byId !== undefined && byId !== null) {
              wsId = String(byId.id ?? want)
              wsPath = String(byId.path ?? byId.record?.path ?? '')
            }
          } catch { /* 不是 id，继续按路径试 */ }
          if (wsId === undefined) {
            try {
              // ⚠ `resolveByPath` 是**异步**的，且**未命中抛 ENOENT**（实测），
              //   不是返回空 —— 必须 try/catch，否则一个错路径会把工具打崩。
              const byPath = await registry.resolveByPath?.(want)
              if (byPath !== undefined && byPath !== null) {
                wsId = String(byPath.id)
                wsPath = String(byPath.path ?? byPath.record?.path ?? want)
              }
            } catch (e) {
              return {
                ok: false,
                reason: `no workspace matches "${want}" (not an id and not an existing registered path): `
                  + String((e as Error)?.message ?? e),
                available: await available(),
              }
            }
          }
          if (wsId === undefined) {
            return { ok: false, reason: `no workspace matches "${want}".`, available: await available() }
          }
        } else {
          // 缺省 = 本会话自己的工作区。判据同 listWorkspaces：sessionPaths → 路径 → 记录。
          const rows = await (bus as any).listWorkspaces(selfSessionId)
          const own = rows.find((r: WorkspaceInfo) => r.self)
          if (own === undefined) {
            return {
              ok: false,
              reason: 'no workspace given and this session has no resolvable workspace; '
                + 'name a target workspace explicitly (see hob_workspaces).',
              available: rows.map((r: WorkspaceInfo) => r.path),
            }
          }
          wsId = own.id
          wsPath = own.path
        }

        // ③ 建会话 —— 只走宿主 controller（它管归档门禁/默认模型/preset 挂载等不变量）。
        //
        // ⚠ **批 18：预设默认值**（任务书 §4）——
        //   工具**显式**给了 `agentPreset` ⇒ **以它为准**（原语义一字不动）；
        //   没给 ⇒ 用配置里的 `spawn.agentPreset`；配置也为空 ⇒ **不传该字段**
        //   （保持现状：交宿主默认预设）。三者是**优先级链**，不是"合并"。
        const spawnCfg = readSpawn()
        const explicitPreset =
          typeof agentPreset === 'string' && agentPreset.trim() !== '' ? agentPreset.trim() : undefined
        // ── 第 11 轮（2026-10-10 · 用户裁定）：**空值 == 出厂默认（标准模式）** ──────
        //   ⚠ 用户原话：「说了出厂默认设置成标准模式 …… 不要宿主默认预设」。
        //   ⚠ **上一轮那套"读宿主有效默认 + 命中规划侧就改口"整块撤销** —— 那是一段
        //     **给不该存在的选项打的补丁**。用户裁定删除那个选项（面板侧同时删）后，
        //     这里就只剩一条**直路**：
        //       显式传参 ⇒ 以它为准（**一字不动**，那是调用方的明确选择）；
        //       否则有配置值 ⇒ 用它；
        //       **否则（未指定 / 配置为空）⇒ 直接出厂默认**（{@link FACTORY_DEFAULT_PRESET_ID}）。
        //   ⚠ 为什么不再读宿主有效默认：宿主 `defaultId` 是
        //     `selectedDefault.get() ?? default`（`dsh-agent-preset-registry/lib/index.js:492-495`），
        //     `selectedDefault` 是**可被改的 volatile 项** ⇒ 它**可能是规划侧预设**
        //     （本机 profile 就是 `selectedDefault: Hob`）。既然用户要求"默认就是标准模式"，
        //     我们就**不问宿主**、直接显式传标准模式 —— 语义确定，且没有"宿主改一次就变"的不确定性。
        //   ⚠ 两条硬约束：
        //     ① **显式传参那半边一字不动**；
        //     ② **绝不加重 spawn 失败面**：显式传一个**不存在**的预设会被宿主
        //        `resolve()` 抛 `Unknown agent preset`（同文件 `:603-608`）
        //        ⇒ 落地前**必须**确认出厂默认在名册里；不在 ⇒ **退回不指定**（= 交宿主默认，
        //        即本模块第 11 轮之前的行为）并**如实报告**，**绝不静默、绝不让 spawn 失败**。
        const configuredPreset = spawnCfg.agentPreset !== '' ? spawnCfg.agentPreset : undefined
        const configuredIsPlanning = configuredPreset === HOB_PRESET_ID
        let presetId = explicitPreset ?? (configuredIsPlanning ? undefined : configuredPreset)
        let presetNote = configuredIsPlanning && explicitPreset === undefined
          ? 'The configured new-session default preset is this plugin\'s planning-side preset ('
            + HOB_PRESET_ID + '). It was NOT applied: that preset plans work but cannot carry '
            + 'it out, so a session started with it would only plan again. An explicitly passed '
            + 'agentPreset is unaffected.'
          : undefined
        if (explicitPreset === undefined && presetId === undefined) {
          // 未指定（无显式传参；配置为空 **或** 配置值是被拦下的规划侧预设）
          //   ⇒ **一律按出厂默认**（用户口径：默认就是标准模式）。
          const presetRegistry = presetRegistryOf()
          // ⚠ 在册校验：出厂默认**必须真的存在**才显式传（否则会让宿主抛 ⇒ spawn 失败）。
          //   服务读不到 ⇒ 同样退不指定（不冒失败风险），但也**如实说出来**。
          const factoryOk = presetRegistry === undefined || presetRegistry === null
            ? false
            : await presetExists(presetRegistry, FACTORY_DEFAULT_PRESET_ID)
          if (factoryOk) {
            presetId = FACTORY_DEFAULT_PRESET_ID
            if (configuredIsPlanning) {
              presetNote = 'The configured new-session default preset is this plugin\'s planning-side '
                + 'preset (' + HOB_PRESET_ID + '), so it was not applied. The session was created '
                + 'with the factory default preset (' + FACTORY_DEFAULT_PRESET_ID + ') instead. '
                + 'An explicitly passed agentPreset is unaffected.'
            }
            // 配置本来为空 ⇒ 这是**正常路径**（不是"少做了一件事"）⇒ 不留 NOTE，不打扰调用方。
          } else if (configuredIsPlanning) {
            presetNote = 'The configured new-session default preset is this plugin\'s planning-side '
              + 'preset (' + HOB_PRESET_ID + '), so it was not applied. The factory default '
              + 'preset (' + FACTORY_DEFAULT_PRESET_ID + ') is not in the current preset roster, so '
              + 'no preset was passed and the host default applies. An explicitly passed agentPreset '
              + 'is unaffected.'
          } else {
            // 配置为空、但出厂默认不在名册（或缺注册表服务）⇒ 退回不指定 + **响亮如实**说明。
            presetNote = 'No preset was specified. The factory default preset ('
              + FACTORY_DEFAULT_PRESET_ID + ') is not visible in the host preset roster, so no preset '
              + 'was passed and the host default applies. An explicitly passed agentPreset is '
              + 'unaffected.'
          }
        }

        // ⚠ **批 18：模型默认值**（任务书 §4 / §1 判定分支）——
        //   只有 provider/model **都**非空时才实施（缺一无法组装一条有效选择；
        //   宿主 `llm.resolveCallConfig` 要两者同时在场）。
        //   装的是**会话级**选择（`src/model-selection.ts`），**不改全局默认**。
        //   档位为空 ⇒ 不传 `reasoningEffort`（= 用该模型自身默认档）。
        const wantModel =
          spawnCfg.provider !== '' && spawnCfg.model !== ''
            ? {
                provider: spawnCfg.provider,
                model: spawnCfg.model,
                ...(spawnCfg.reasoningEffort === '' ? {} : { reasoningEffort: spawnCfg.reasoningEffort }),
              }
            : undefined

        try {
          const created = await controller.create({
            workspaceId: wsId,
            ...(presetId === undefined ? {} : { agentPreset: presetId }),
          })
          const sessionId: string | undefined = created?.sessionId

          // 模型默认值：**建完才装**（`create` 的入参没有模型字段）。
          // ⚠ 装不上**不该**让建会话失败 —— 会话已真实存在，
          //   把失败如实带回（`modelNote`）比"建到一半丢了会话"好得多。
          let modelNote: string | undefined
          if (wantModel !== undefined && typeof sessionId === 'string' && sessionId !== '') {
            try {
              const agent = typeof agents.get === 'function' ? agents.get(sessionId) : undefined
              if (agent === undefined) {
                modelNote = 'session created but its agent was not found; the model default was not applied'
              } else {
                installSessionModelSelection(agent.ctx, agent.session, wantModel)
                appendSessionModelSelection(agent, wantModel)
              }
            } catch (e) {
              modelNote = 'model default not applied: ' + String((e as Error)?.message ?? e)
            }
          }

          /**
           * ⚠⚠ **建会话即绑定**（`I-6`）：把"这个会话归 `selfSessionId`"写进运行态
           *   ⇒ **跨重载可见**（改前它只活在内存里，重载后全丢 ⇒ 回执找不到主人）。
           * ⚠ 写的是**本工作区**那份运行态（`stateFileOf` 按调用方 cwd 派生）。
           * ⚠ `bindSession` 失败 / 判不出 self ⇒ **不改 spawn 的成功语义**
           *   （只是那条会话变成"无归属"，且下面 `bindNote` 会**如实带回去**，⛔ 不静默）。
           */
          const bindNote = ((): string | undefined => {
            if (typeof sessionId !== 'string' || sessionId === '') {
              return 'session created but its id was not returned; the owner binding was NOT recorded'
            }
            if (typeof selfSessionId !== 'string' || selfSessionId === '') {
              return 'session created but the caller identity was unavailable; the owner binding was NOT '
                + 'recorded, so this session is "unowned" (its receipts will not come back to anyone).'
            }
            /**
           * ⚠ 绑定**不在服务层写**：`I-6` 要求落进**调用方那一本运行态**，
           *   而账本根解析闭包（`ledgerRootOf`）只由预设层传给**工具层**。
           *   ⇒ 服务层只把 **owner 是谁**如实回带，由 `hob_spawn` 工具写绑定
           *     （见 `spawnTool` 里 `bindSession` 那一段）。
           */
          return undefined
          })()
          return {
            ok: true,
            sessionId,
            workspaceId: wsId,
            ...(wsPath === undefined || wsPath === '' ? {} : { workspacePath: wsPath }),
            ...(created?.agentPreset === undefined ? {} : { agentPreset: created.agentPreset }),
            ...(presetNote === undefined ? {} : { presetNote }),
            ...(modelNote === undefined ? {} : { modelNote }),
            ...(bindNote === undefined ? {} : { bindNote }),
            // ⚠ 把调用方身份如实回带（工具层据此写绑定；⛔ 服务层不猜）
            ...(typeof selfSessionId === 'string' && selfSessionId !== '' ? { owner: selfSessionId } : {}),
          }
        } catch (e) {
          // ⚠ 宿主对**不存在的 workspaceId 会直接抛**（实测："workspace \"…\" not found"）
          //   ⇒ 原样带回，不吞。
          return {
            ok: false,
            reason: 'session create failed: ' + String((e as Error)?.message ?? e),
            available: await available(),
          }
        }
      },
    }

    // ⚠ `provide` 是 effect：模块卸载/依赖消失 ⇒ 服务随之消失 ⇒ 预设行那两个工具自动拆除。
    svcCtx.effect?.(() => {
      svcCtx.provide?.(BUS_SERVICE, bus)
      return () => { /* provide 自己管清理 */ }
    }, `${name}: provide ${BUS_SERVICE}`)
    svcCtx.logger?.debug?.(`[${name}] 已提供 ${BUS_SERVICE}`)
  })
}

// ══════════════════════════════════════════════════════════════════════
// M3 的四个工具 —— **定义**在本模块（能力在那，工具跟着走），
//   **注册**在 `src/preset/tools.ts`（预设作用域，只对 Hob 可见）。
//   ⚠ 与 `modules/tools.ts` 的 read_contracts/write_hob 同款纪律：
//     绝不在插件作用域注册（会漏进每一个预设，见 tools.ts 文件头的实测表）。
//   ⚠ 批 16 起由 2 个变 4 个（+ `hob_workspaces` / `hob_spawn`）。
// ══════════════════════════════════════════════════════════════════════

/**
 * 取**本会话**的 id（= 调用工具的 agent 自己的会话）。
 *
 * ⚠ 为什么需要：给自己投递毫无意义（消息会在同一会话里排队），工具层要拒掉。
 *   取法与既有代码同源（`modules/tools.ts` 的 `rootOf` 就读 `exec.agent?.session.header.cwd`）。
 */
function selfSessionIdOf(exec: any): string | undefined {
  const id = exec?.agent?.id ?? exec?.agent?.session?.id
  return typeof id === 'string' && id !== '' ? id : undefined
}

/**
 * 造 M3 的四个工具定义。
 *
 * @param bus - `hobBus` 服务（由 `ctx.inject([BUS_SERVICE], …)` 交进来）。
 *   ⚠ 传**值**而不是每次 `ctx.get`：注册发生在服务就绪之后，
 *     拿到的就是本模块刚 provide 的那一个；服务消失时注册随之拆除。
 * @param ledgerRootOf - **现读**本工作区账本根的闭包（2026-10-10 新增，可缺省）。
 *   ⚠ 由挂载方（`preset/tools.ts`）传入：账本路径解析（`resolveLedgerRoot`）
 *     与 config 都在**那一层**，本模块不该再持有第二份解析逻辑。
 *   ⚠ 是**函数**不是值：账本落点随会话 cwd 变，快照会拿错工作区。
 *   ⚠ 缺省（`undefined`）= 不记账 —— 但**功能照常**（记账是附加可观测，
 *     不该因为拿不到账本根而让 `hob_spawn` / `hob_send` 失效）。
 */
export function createHobBusTools(
  bus: HobBus,
  ledgerRootOf?: (exec: any) => string | undefined,
  /**
   * ⚠⚠ **T2 的唯一挂点**（2026-10-20 · B5）：**每次 `hob_*` 工具被调用时顺手对账一次**。
   *
   * ⚠ 为什么挂在这里而不是各工具的 `execute` 里各写一行：本函数是那四个工具的
   *   **唯一造点** ⇒ 一处挂上，四个工具（`hob_sessions` / `hob_send` /
   *   `hob_workspaces` / `hob_spawn`）全部覆盖，⛔ 不会漏一个、⛔ 不会写四遍。
   * ⚠ ⛔ 不许 await（对账是背景对平，投递语义不变）；⛔ 不许让它抛（对账坏了不能把投递带崩）。
   * ⚠ 缺省不传 ⇒ 不对账（机检与旧调用形状照旧）。
   */
  onRead?: () => void,
  /**
   * ⚠⚠ **执行层"能不能推进"闸门**（2026-10-22 第 5 轮 · 任务书第 12 条）。
   *
   * 只作用在**会改变项目 / 建新会话**的两个动作：`hob_spawn`（建会话）与
   * `hob_send`（投递 = 让对方真开跑）。
   * ⚠ **`hob_sessions` / `hob_workspaces` 是只读诊断，必须放行**（任务书原文
   *   "允许只读诊断"）—— 否则用户连"我有哪些会话"都查不到，只会更糟。
   * ⚠ 返回字符串 ⇒ 拒绝理由；`undefined` ⇒ 放行。⛔ 非 Hob 由注入方放行。
   */
  proceedGateOf?: (exec: any) => string | undefined,
  /**
   * ⚠⚠ **写入两轴策略**（2026-10-22 第 5 轮 · 任务书第 4 条无界面路径）。
   *
   * `hob_spawn` 显式给了两值 ⇒ **必须真的写进去**，否则"要求了却没落地"=
   * 用户以为按选择建了、实际按最低档跑（比不要求更糟：它假装成功了）。
   * ⚠ 返回 `{ok, reason}`；失败 ⇒ spawn 的返回值里**如实回带**（⛔ 不静默）。
   * ⚠ 缺席（老组合）⇒ 不写，但返回值里说明"两轴未落地"。
   */
  setPolicyOf?: (sessionId: string, level: string, workMode: string) => { ok: boolean; reason: string }
): {
  sessions: ReturnType<typeof defineTool>
  send: ReturnType<typeof defineTool>
  workspaces: ReturnType<typeof defineTool>
  spawn: ReturnType<typeof defineTool>
} {
  /**
   * 取本工作区的运行态文件路径（拿不到 ⇒ undefined，调用方跳过记账）。
   * ⚠ 全程 try：记账是**附加可观测**，绝不该让工具本体失败。
   */
  const stateFileOf = (exec: any): string | undefined => {
    try {
      const root = ledgerRootOf?.(exec)
      if (typeof root !== 'string' || root === '') return undefined
      return orchStateFileOf(root)
    } catch {
      return undefined
    }
  }

  /**
   * **T2：本次工具调用顺手对一次账**（⛔ 不 await、⛔ 不抛、⛔ 不改任何工具结果）。
   *
   * ⚠ 它工作的前提是调用方能从 `exec` 判出"我是谁"（= owner）：
   *   **判不出 ⇒ 照样触发**（对账读的是盘，不依赖"我是谁"），
   *   而**投递与读数**仍然只认逐条的 `owner`（`I-1` / `I-2`）—— 两件事分开。
   */
  const pokeReconcile = (): void => {
    try { onRead?.() } catch { /* 对账是附加观测，失败不影响工具本体 */ }
  }

  /**
   * ══════════════════════════════════════════════════════════════════════
   * ⚠⚠ **甲-8 / 甲-9 的读数出口**（2026-10-21 · 第 329 轮）
   * ══════════════════════════════════════════════════════════════════════
   *
   * ⚠ **为什么声明在这里而不是 `apply()`**：写入点（`noteHandoff` /
   *   `clearAfterDelivery`）在**本函数**里，而 `apply()` 早已结束（`:1401`）
   *   —— 声明在外层作用域会把"谁写谁读"拆散，且 `apply()` 里根本没有写入点。
   *
   * ── **甲-8**：`recordHandoff` / `clearHandoffs` 的返回值被丢 ⇒ 记账失败无痕 ─────
   *   · `write` ⇒ **这条账没记上 / 没清掉** ⇒ 重载后这次派发在读数里
   *     **与"从来没派过"逐字相同**（本项目最忌的"两种原因说成同一句话"）。
   *   · ⚠ 判"清账失败"⛔ 不许一律看 `wrote === false`：`clearHandoffs` 在
   *     "没有匹配项"时**本来就不写盘**（正常路径）⇒ 判据是
   *     **`cleared.length > 0 && wrote !== true`**。
   *
   * ── **甲-9**：`ensureRuntimeIgnored` 的返回值被丢 ⇒ `runtime/` 可能进 git 历史 ──
   *   · `ignore` ⇒ **`runtime/.gitignore` 没写成** ⇒ `orch-watches.json` 里的
   *     **会话 id 会被提交进账本仓库**。
   *
   * ⚠ **两个字段分开、⛔ 不合并**（成因与修法都不同，且可同时成立）。
   * ⚠ **正常档一律 `undefined`** ⇒ 调用方什么都不多印。
   */
  let handoffWriteNote: string | undefined
  let handoffIgnoreNote: string | undefined

  /**
   * 记一条"待投递"（**只记，不报错**）。
   * ⚠ 记账失败**不改工具结果**：调用方拿到的是"建会话/投递成功"这个事实，
   *   记账是附加可观测（同 `tools.ts` 的 write_hob 记账纪律）。
   */
  const noteHandoff = (exec: any, kind: 'spawned-session' | 'task-file', ref: string): void => {
    const file = stateFileOf(exec)
    if (file === undefined) return
    try {
      /**
       * ⚠⚠ **读 `ensureRuntimeIgnored` 的返回值**（2026-10-21 · 第 329 轮 · **甲-9** 要求 1）——
       *   改前**丢了返回值**：它失败 = `runtime/.gitignore` 没写成
       *   ⇒ ⚠ `runtime/` 会进账本 git 历史，而那里的 `orch-watches.json` **含会话 id**
       *   （`sessionId` / `owner` / `target`）。⛔ 这不止是"少一个文件"，是**标识被提交进仓库**。
       *
       * ⚠ ⛔ **不升级成拒绝记账**（TASK 要求 3）：忽略失败只影响"会不会被 git 收进去"，
       *   不影响这次记账本身 ⇒ 记账照常，只把失败**记进 `handoffIgnoreNote` 让状态行能看见**。
       */
      if (!ensureRuntimeIgnored(dirname(file))) {
        handoffIgnoreNote = `\`${ORCH_STATE_IGNORE}\` 没写成（${dirname(file)}）`
          + ' ⇒ runtime/ 可能被账本 git 收进历史（该文件含会话 id）'
      }
      /**
       * ⚠⚠ **记录必须带 owner**（`I-1` / `I-6`）：改前只记 `kind`/`ref`/`at`，
       * 于是同一工作区里两个 Hob 各建一个会话时，两边的"待投递"读数**无法分辨哪条是自己的**
       * （`status()` 现在按 owner 过滤，没有 owner 的记录谁都看不到 —— 那条账就悬空了）。
       * ⚠ 判不出 owner（`exec` 里拿不到 self）⇒ **不填**（⛔ 不猜、⛔ 不拿工作区顶替）。
       */
      const self = selfSessionIdOf(exec)
      /**
       * ⚠ owner 的**工作区根** = 调用方自己的 cwd（与 `tools.ts` 的 `rootOf` 同源读法）。
       *   ⛔ 不拿账本目录顶替（那是派生值，不是工作区根）。
       */
      const ownerWsRoot = ((): string | undefined => {
        try {
          const cwd = exec?.agent?.session?.header?.cwd
          return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
        } catch { return undefined }
      })()
      /**
       * ⚠⚠ **读 `recordHandoff` 的返回值**（2026-10-21 · 第 329 轮 · **甲-8** 要求 1）——
       *
       * ── 改前是什么（`PROJECT-SURVEY-3` §6.1 甲-8）────────────────────────
       *   这一行**整条丢了返回值**，而 `recordHandoff` **专门**返回 `{ wrote, state }`。
       *   ⇒ `wrote === false`（写盘失败）时**没有任何痕迹**：
       *     `hob_dispatch` 报"派活成功"，而盘上**那条待投递根本不存在** ⇒
       *     重载后这条派发在读数里**与"从来没派过"逐字相同**。
       *
       * ⚠ **判据公式（⛔ 不许把两种成因压成一句话）**：
       *   · `wrote === false` ⇒ **写盘失败**（盘上没这条）⇒ 重载后不可见；
       *   · 正常（`wrote === true`）⇒ 无需记账；
       *   ⚠ `recordHandoff` **没有** `conflict` 字段（那是 `bindSession` 的）——
       *     本文件的正确参照写法见 `bindSession` 那一处，但**字段集不同**，⛔ 不许照抄字段名。
       */
      const rec = recordHandoff(file, {
        kind,
        ref,
        at: Date.now(),
        ...(self === undefined ? {} : { owner: self }),
        ...(ownerWsRoot === undefined ? {} : { wsRoot: ownerWsRoot }),
      })
      if (rec.wrote !== true) {
        handoffWriteNote = `待投递**没记上**（\`${kind}\` ref=${ref}）：写盘失败 ⇒ `
          + '重载后这次派发在状态里**与"从来没派过"逐字相同**（⛔ 不是"没有待投递"）'
      }
    } catch (e) { handoffWriteNote = `待投递**没记上**（\`${kind}\` ref=${ref}）：${String((e as Error)?.message ?? e)}` }
  }

  /**
   * 投递成功后清匹配的"待投递"（**只清，不报错**）。
   * ⚠ 匹配细则（见回报说明，与 orchestrator 侧**同一口径**）：
   *   · `spawned-session`：目标会话 id === `ref`（那个会话已被投过）；
   *   · `task-file`：投递发生在它 `at` **之后**（`h.at <= at`）——
   *     **不按消息文本匹配**（脆、会误判）。
   */
  const clearAfterDelivery = (exec: any, targetSessionId: string): void => {
    const file = stateFileOf(exec)
    if (file === undefined) return
    try {
      const now = Date.now()
      /**
       * ⚠⚠ **读 `clearHandoffs` 的返回值**（甲-8 要求 1）——
       *
       * ── 改前丢了返回值 ⇒ 两种完全不同的情形**在读数里长得一样** ────────────
       *   · `cleared.length === 0` ⇒ **没有可清的**（正常：这条派发本来就没记过待投递）；
       *   · `wrote === false` **且** `cleared.length > 0` ⇒ **该清却没落盘**（异常）：
       *     账清了但盘上还留着 ⇒ 读数显示"还有待投递"，而它其实已经投过了
       *     ⇒ 下一个人会去**重投**（那正是"同一份报告反复送达"的成因之一）。
       *
       * ⚠ **⛔ 不许把 `wrote === false` 一律当失败**：`clearHandoffs` 在"没有匹配项"时
       *   **本来就不写盘**（`wrote: false`）—— 那是**正常路径**，不是缺陷。
       *   ⇒ 判据 = **`cleared.length > 0 && wrote === false`** 才算异常。
       */
      const cleared = clearHandoffs(file, (h) => (h.kind === 'spawned-session'
        ? h.ref === targetSessionId
        : h.at <= now))
      if (cleared.cleared.length > 0 && cleared.wrote !== true) {
        handoffWriteNote = `待投递**没清掉**（${cleared.cleared.length} 条匹配但写盘失败）⇒ `
          + '盘上还留着"已经投过"的记录 ⇒ ⛔ 别据此重投（它会自己再清一次，但读数此刻是假的）'
      }
    } catch (e) { handoffWriteNote = `待投递**没清掉**：${String((e as Error)?.message ?? e)}` }
  }

  const sessionsTool = defineTool({
    name: 'hob_sessions',
    description:
      '列出**本实例内的会话**（id / cwd / 预设 / 忙闲 / 侧），用于挑投递目标。'
      + '⚠ 每行带「侧」：规划侧预设**不能施工**（无 shell、无 write/edit），派它会「看在跑、永远没有产出」。'
      + '**已归档的会话不列**；但**没有运行实体的会话会列出来**，并标 `[无运行实体·不可投递]` —— '
      + '那一档投了也不会执行。'
      + '⚠ 目标由用户/你指定，本工具**不替你挑**。',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(_args: unknown, exec: any): Promise<string> {
      /** ⚠ T2（B5）：每次 `hob_*` 读写顺手对账一次（⛔ 不 await、⛔ 不改本工具结果）。 */
      pokeReconcile()
      const rows = bus.list(selfSessionIdOf(exec))
      // 把自己标出来：投给自己是无效动作。
      // ⚠ ⚠ **投影缺位时置顶声明**（⚠ 否则读的人会把降级值当权威值用 —— 那正是本单要修的形态）。
      //   判据：`bus.list()` 的行是不是**全都**来自保留头（⚠ 有一条来自投影就不算降级）。
      const degraded = rows.length > 0 && rows.every((r) => r.presetSource === 'header')
      /**
       * ⚠⚠ **归属列**（`I-6`：`hob_sessions` 每行必须能看出归属 —— 哪个会话的 / 未绑定）。
       *
       * ⚠ 读法 = 运行态文件里的**绑定表**（`bindSession` 写的那些），
       *   ⛔ 不猜、⛔ 不从 cwd 反推（同一工作区里多个 owner 恰恰要靠这一列分辨）。
       * ⚠ 绑定表读不到 ⇒ 该列显示"（归属表读不到）"—— ⛔ 不许静默成"未绑定"
       *   （那是把"读不到"说成"确实没有"，本项目最忌讳的形态）。
       */
      const bindFile = stateFileOf(exec)
      let bindings: PersistedSessionBinding[] | undefined
      if (bindFile !== undefined) {
        try { bindings = readOrchState(bindFile).sessions } catch { bindings = undefined }
      }
      const lines = rows.map((r) => {
        // ⚠ ⚠ 第 292 轮：**侧** 与 **预设** 都要能分辨（依据 CHG-058）——
        //   ⚠ 侧由 `agentPreset` 派生（同一口径 HOB_PRESET_ID），⛔ 不另立判据；
        //   ⚠ 预设读不到 ⇒ 该列**留空并说明**，⛔ 不拿部署默认顶替、⛔ 不猜。
        const side = r.side === 'planning' ? '规划侧'
          : r.side === 'implementation' ? '实施侧'
            : undefined
        const bits = [
          r.id,
          r.self ? '(本会话)' : '',
          r.live ? '' : '[无运行实体·不可投递]',
          r.status === undefined ? '' : r.status,
          side === undefined ? '' : `侧=${side}`,
          // ⚠ 依据必须可核：降级到建档头时**当场标明**（否则会把陈旧值当真值用）。
          r.agentPreset === undefined
            ? '预设=（读不到：投影与建档头都为空）'
            : `预设=${r.agentPreset}${r.presetSource === 'header' ? '（降级：取自建档头，可能非当前值）' : ''}`,
          r.cwd === undefined ? '' : `cwd=${r.cwd}`,
          // ⚠ 归属：`归属=<owner>` / `归属=（未绑定）` / `归属=（表读不到）`
          (() => {
            if (bindFile === undefined) return '归属=（本会话账本根判不出·读不到归属表）'
            if (bindings === undefined) return '归属=（归属表读不到）'
            const hit = bindings.find((b) => b.sessionId === r.id)
            if (hit === undefined) return '归属=（未绑定）'
            return `归属=${hit.owner}`
          })(),
        ].filter((x) => x !== '')
        return '- ' + bits.join(' · ')
      })
      if (lines.length === 0) return '没有可投递的活会话。'
      return [
        ...(degraded
          ? ['⚠ ⚠ **本列表的「侧」与「预设」取自建档头（降级）** —— 宿主的 `agentPreset` 投影读不到，'
            + '而建档头只是"该会话建档时是什么"，**建后改过预设的会话它不会再变** ⇒ '
            + '⚠ **这些读数可能不是当前值**，⛔ 不要据此断定某一侧。']
          : []),
        '可投递的活会话 ' + rows.length + ' 个：',
        ...lines,
      ].join('\n')
    },
  })

  const sendTool = defineTool({
    name: 'hob_send',
    description:
      '把一段文本作为一条消息投递给**指定会话**（同实例内）。它会被唤醒并把这当成指令来读，'
      + '回复出现在**它自己的会话里**，不会回到本会话。'
      + '⚠ 投递≠完成：这是「我交给了那个会话」，不是「我做了」。'
      + '⚠ 目标必须是 `hob_sessions` 列出的活会话；投给**已归档**的会话会被拒绝。'
      + '⚠ 有实质改动的工作，指令仍应先按交接格式写成文件（账本区 `archive/<YYYY-MM-DD-slug>/TASK.md`，'
      + '用 `write_hob` 写，**不是**工作区的 `.hob/`），投递的文本里给路径而不是整篇正文。',
    parameters: {
      sessionId: {
        type: 'string',
        required: true,
        description: '目标会话 id（取自 hob_sessions 的输出）。',
      },
      message: {
        type: 'string',
        required: true,
        description: '要投递的文本。给路径与要点，勿把整篇正文塞在这里。',
      },
      mode: {
        type: 'string',
        enum: ['followup', 'steer'],
        description: 'followup=排到它当前轮之后（默认）；steer=插进它正在跑那一轮的最近边界。',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(
      args: { sessionId: string; message: string; mode?: 'followup' | 'steer' },
      exec: any,
    ): Promise<string> {
      /**
       * ⚠⚠ **投递 = 让对方真开跑** ⇒ 也属于"推进项目"的动作，必须过闸门
       * （2026-10-22 第 5 轮 · 任务书第 12 条点名"真实派活"）。
       *   ⚠ 拒绝返回**结构化 JSON**（与 `hob_dispatch` 的既有写回形一致），
       *     ⛔ 不抛异常（抛出去会变成 tool error，模型读不到可读理由）。
       */
      try {
        const blocked = proceedGateOf?.(exec)
        if (blocked !== undefined) return JSON.stringify({ ok: false, reason: 'proceed-not-confirmed', message: blocked })
      } catch (e) {
        return JSON.stringify({
          ok: false, reason: 'proceed-gate-error',
          message: `拒绝：无法确认本会话的原「推进工作方式」（闸门抛错：${String((e as Error)?.message ?? e)}）`,
        })
      }
      /** ⚠ T2（B5）：同上 —— 投递路径也顺手对账（对账读盘，⛔ 不改投递语义）。 */
      pokeReconcile()
      const self = selfSessionIdOf(exec)
      if (self !== undefined && args.sessionId === self) {
        return JSON.stringify({ ok: false, reason: 'refusing to deliver to this session itself' })
      }
      const text = typeof args.message === 'string' ? args.message : ''
      if (text.trim() === '') {
        return JSON.stringify({ ok: false, reason: 'empty message' })
      }
      const r = await bus.deliver(args.sessionId, text, args.mode === 'steer' ? 'steer' : 'followup')
      if (!r.ok) return JSON.stringify({ ok: false, reason: r.reason ?? 'delivery failed' })
      // ── 投递成功 ⇒ 清匹配的"待投递"（2026-10-10 新增）────────────────────
      //   ⚠ 只清**本工作区**那份运行态（`stateFileOf` 按 exec 的 cwd 解析）。
      //   ⚠ 失败不影响结果：投递本身已经成功（附加可观测，不是主流程）。
      clearAfterDelivery(exec, args.sessionId)
      return JSON.stringify({
        ok: true,
        delivered: true,
        sessionId: args.sessionId,
        mode: r.mode ?? 'followup',
        ...(r.messageId === undefined ? {} : { messageId: r.messageId }),
        ...(r.reason === undefined ? {} : { note: r.reason }),
        // ── 目标预设预警（第 129 轮新增）—— **服务层算出来的，这里只透传** ──────
        //   ⚠ 判据 3 要求 `hob_send` **与** `hob_dispatch` 的返回里都看得见它。
        //   ⚠ 字段名与服务层一致（`presetNotice`），⛔ 不在这里重写措辞 ——
        //     措辞是**服务层单点**（含后果与下一步），改一处即可两工具同步。
        ...(r.presetNotice === undefined ? {} : { presetNotice: r.presetNotice }),
        /**
         * ⚠⚠ **甲-8 的「清账失败」读数**（2026-10-21 · 第 329 轮）——
         *   ⚠ 投递本身已成功（`ok: true` 不改），但**盘上那条"待投递"没清掉**：
         *     读数会显示"还有待投递"，而它其实已经投过了 ⇒ 下一个人会去**重投**。
         *   ⚠ 正常档（没有匹配项 / 清成功）这里是 `undefined` ⇒ 返回体**一个字都不多**。
         */
        ...(handoffWriteNote === undefined ? {} : { handoffWriteNote }),
        note2: 'Delivered only: the reply lands in that session, not here. Do not claim the work itself was done.',
      })
    },
  })

  const workspacesTool = defineTool({
    name: 'hob_workspaces',
    description:
      '列出**已登记的工作区**（id / 路径 / 标题 / 会话数），用于给 `hob_spawn` 挑归属。'
      + '标 `(本会话工作区)` 的是缺省目标。⚠ 未登记的工作区建不出会话。',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(_args: unknown, exec: any): Promise<string> {
      /** ⚠ T2（B5）。 */
      pokeReconcile()
      const rows = await bus.listWorkspaces(selfSessionIdOf(exec))
      if (rows.length === 0) return '没有可用的工作区（或工作区服务不可用）。'
      const lines = rows.map((w) => '- ' + [
        w.id,
        w.self ? '(本会话工作区·缺省目标)' : '',
        `title=${w.title ?? '(无)'}`,
        `cwd=${w.path}`,
        `会话=${w.sessions}`,
      ].filter((x) => x !== '').join(' · '))
      return ['工作区 ' + rows.length + ' 个：', ...lines].join('\n')
    },
  })

  const spawnTool = defineTool({
    name: 'hob_spawn',
    description:
      '**新建一个会话**（交给实施方用），并**强制归属到某个工作区**。'
      + '`workspace` 可为工作区路径或 id，**不填 = 本会话自己的工作区**；'
      + '目标必须是**已登记**的工作区（拿不准先调 `hob_workspaces`）。'
      + '⚠ **有归属 ≠ 用户看得见**：会话**在收到第一条消息之前是「空白会话」**，'
      + '宿主**有意**把它从会话列表里过滤掉（项目视图同样按归属分区，无归属的只落「未分组」桶）。'
      + '⇒ 建完**不投递就看不见**它 —— 不是建失败、不是归属没生效，投递一条消息后才会出现。'
      + '⚠ 建完只有两种走法，别含糊：① **立刻投递**（`hob_send` / `hob_dispatch` 即唤醒，'
      + '无需用户操作）；② **故意不投递**时，就**明确告诉用户它现在看不见**（并说明投一条消息后会出现）。'
      + '⚠ 建会话 ≠ 派活：新会话不会自己开跑，还得把指令投给它（首轮之后预设锁定）。',
    parameters: {
      workspace: {
        type: 'string',
        description:
          '目标工作区：路径或 id。**不填 = 本会话自己的工作区**。',
      },
      /**
       * ⚠⚠ **两轴显式值**（2026-10-22 第 5 轮 · 任务书第 4 条）。
       *
       * ── 为什么无界面路径也必须给这两项 ────────────────────────────────────
       *   弹窗那条路给了用户选择；但 `hob_spawn` 是**无界面**建 Hob 会话的路径。
       *   ⚠ 若它不要求两值，就等于"绕过弹窗悄悄建一个用缺省方式的 Hob 会话"
       *     —— 那正是 `REQ-04` 要消灭的"一次影响所有 / 不知不觉用了缺省"。
       *   ⇒ 只要本次建的是 **Hob** 预设，`level` 与 `workMode` **必须同时给**，
       *     缺任一 ⇒ **拒并说明**；⛔ 不用缺省顶替（顶替会静默决定用户没选的东西）。
       *   ⚠ **非 Hob 预设不受此限**：标准会话不看这两个字段（它们只对 Hob 有意义）。
       */
      level: {
        type: 'string',
        enum: ['ledger', 'project', 'workspace'],
        description: '（**新建 Hob 会话时必填**）可读档：ledger / project / workspace。非 Hob 预判可省略。'
          + '⚠ **当前只有 ledger 开放**：其余两档会被服务端拒签/拒建并给可读原因'
          + '（待宿主具备可靠的持久清理能力后开放）。',
      },
      workMode: {
        type: 'string',
        enum: ['auto', 'single', 'multi'],
        description: '（**新建 Hob 会话时必填**）推进工作方式：auto / single / multi。非 Hob 预判可省略。',
      },
      agentPreset: {
        type: 'string',
        description:
          '新会话用的预设 id（如 `' + FACTORY_DEFAULT_PRESET_ID + '`）。'
          + '⚠ 不填时的取值顺序：本参数 > 设置里「新建会话默认」> 出厂默认 `'
          + FACTORY_DEFAULT_PRESET_ID + '`（⛔ 不问宿主默认）。'
          + '⚠ ②若恰好是规划侧预设（`' + HOB_PRESET_ID + '`）⇒ **不套用**（它只规划、不施工），'
          + '改走出厂默认，并在返回里带 `presetNote` 说明。'
          + '⚠ 名册读不到时退回不传给宿主（由宿主默认决定），同样在 `presetNote` 里如实说明。',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(
      args: { workspace?: string; agentPreset?: string; level?: string; workMode?: string },
      exec: any,
    ): Promise<string> {
      /**
       * ⚠⚠ **建会话之前先过"能不能推进"闸门**（2026-10-22 第 5 轮）。
       *   ⚠ 这条在 `pokeReconcile()` **之前**：被拒的调用不该产生任何副作用
       *     （连"顺手对账"这种附加观测也不做 —— 让拒绝是**纯粹**的）。
       */
      try {
        const blocked = proceedGateOf?.(exec)
        if (blocked !== undefined) return JSON.stringify({ ok: false, reason: 'proceed-not-confirmed', message: blocked })
      } catch (e) {
        return JSON.stringify({
          ok: false, reason: 'proceed-gate-error',
          message: `拒绝：无法确认本会话的原「推进工作方式」（闸门抛错：${String((e as Error)?.message ?? e)}）`,
        })
      }
      /**
       * ⚠⚠ **Hob 预设必须显式给两轴**（2026-10-22 第 5 轮 · 任务书第 4 条）。
       *
       * ── 判据 ────────────────────────────────────────────────────────────
       *   "本次建的是不是 Hob" —— 由**请求的预设**决定（`args.agentPreset`）：
       *   · 明确给了 `Hob` ⇒ 两轴必须齐（缺任一 ⇒ 拒，⛔ 不用缺省顶替）；
       *   · 明确给了别的预设 ⇒ 不看两轴（标准会话与它们无关）；
       *   · **没给预设** ⇒ ⚠ **不知道会落到哪个预设**（宿主会解析"有效默认"，
       *     本机实测默认可能是 `Hob`）⇒ 这时候**若给了任一轴**就按"想建 Hob"处理并要求补齐；
       *     若**两轴都没给**，不拦（那是"用宿主默认建普通会话"的老路径，
       *     ⛔ 拦它会把标准用法打死）。
       *   ⚠ 第三档是**有意的取舍**：我拦不了"宿主默认恰好是 Hob"这一种，
       *     但会**如实报边界**（见返回值与 CONTEXT），⛔ 不说"所有路径都有弹窗"。
       */
      {
        const wantsHob = args?.agentPreset === HOB_PRESET_ID
          || (args?.agentPreset === undefined || args?.agentPreset === '')
            && (args?.level !== undefined || args?.workMode !== undefined)
        if (wantsHob) {
          const missing: string[] = []
          if (args?.level === undefined) missing.push('level（可读档）')
          if (args?.workMode === undefined) missing.push('workMode（推进工作方式）')
          if (missing.length > 0) {
            return JSON.stringify({
              ok: false,
              reason: 'hob-needs-explicit-policy',
              message: `新建 **Hob** 会话必须**同时**给出两项选择，缺：${missing.join(' / ')}。`
                + '\n  ⚠ 这是有意的：不给就不建 —— ⛔ 不用缺省值替用户决定'
                + '（那正是"不知不觉用了缺省方式"的来源）。'
                + '\n  ⚠ 可读档：ledger（只看账本）/ project（另可读 .md）/ workspace（另可读任意文件，仍不能写/执行命令/组队）。',
            })
          }
          const badLevel = !['ledger', 'project', 'workspace'].includes(String(args.level))
          const badMode = !['auto', 'single', 'multi'].includes(String(args.workMode))
          if (badLevel || badMode) {
            return JSON.stringify({
              ok: false,
              reason: 'hob-policy-invalid',
              message: `两轴取值不在合法枚举里（level=${JSON.stringify(args.level)} · workMode=${JSON.stringify(args.workMode)}）⇒ 拒绝建会话`,
            })
          }
          /**
           * ⚠⚠ **当前开放面硬限制**（2026-10-22 · 用户裁定「安全优先」）。
           *
           * ── 为什么无界面路径也必须由**服务端动作**拒，而不是只靠枚举 ────────────
           *   `project` / `workspace` 仍在**合法枚举**里（已建会话要用它们解析），
           *   ⇒ 枚举校验**不会**拦住 `hob_spawn(level:'workspace')`。
           *   而这条路**绕过弹窗** ⇒ 若这里不拒，用户"界面上看不见宽档"就只是假象。
           *
           * ── 位置 ──────────────────────────────────────────────────────────────
           *   在 `spawn()` **之前**（此时零副作用：没建会话、没写绑定、没记待投递）。
           *   ⚠ 判据与票据链**同一个常量**（`shared/read-level-policy.ts`），⛔ 不另抄白名单。
           *   ⚠ **只作用于 Hob**（`wantsHob` 分支内）⇒ 非 Hob 建会话一行代码都没变。
           */
          if (!isOpenReadLevel(args.level)) {
            return JSON.stringify({
              ok: false,
              reason: 'hob-read-level-not-open',
              message: readLevelNotOpenReason('建会话') + '\n  ⚠ 非 Hob 会话不受此限（本限制只针对新建 Hob 会话的可读范围）。',
            })
          }
        }
      }
      /** ⚠ T2（B5）。⚠ 建会话也顺手对账：那是"我可能正在等回传"的又一条高频路径。 */
      pokeReconcile()
      const r = await bus.spawn(args?.workspace, args?.agentPreset, selfSessionIdOf(exec))
      /**
       * ⚠ **spawn 成功后立刻写两轴**（只有在调用方显式给了两值时）。
       *   ⚠ 顺序：先建会话（拿到 sessionId）→ 再写（`set` 要求会话已存在）。
       *   ⚠ 写失败**不改"建会话成功"这个事实**，但必须回带 `policyNote`，且
       *     该会话**没有策略记录** ⇒ 恒最低档（⛔ 不会是宽档）。
       */
      let policyNote: string | undefined
      if (r.ok && args?.level !== undefined && args?.workMode !== undefined) {
        if (typeof setPolicyOf !== 'function') {
          policyNote = '两轴**未落地**：本组合没有提供策略写入接口 ⇒ 该会话按最低档读'
        } else {
          const w = setPolicyOf(String(r.sessionId ?? ''), String(args.level), String(args.workMode))
          if (!w.ok) {
            policyNote = `两轴**写入失败**（${w.reason}）⇒ 该会话没有策略记录，按最低档读；`
              + `⚠ 用户选择的 ${args.level}/${args.workMode} **未生效**`
          }
        }
      }
      if (!r.ok) {
        return JSON.stringify({
          ok: false,
          reason: r.reason ?? 'spawn failed',
          ...(r.available === undefined ? {} : { availableWorkspaces: r.available }),
        })
      }
      /**
       * ⚠⚠ **建会话即绑定**（`I-6` 的写入点，落在这里的理由见服务层那段注释：
       *   账本根闭包 `ledgerRootOf` 只在工具层）。
       *
       * ⚠ 绑定失败 / 判不出 ⇒ **不改"建会话成功"这个事实**，但必须**如实回带**
       *   （`bindNote`）—— ⛔ 不许静默，否则那条会话重载后变"无归属"、回执无处可去。
       * ⚠ 已有别的 owner ⇒ `bindSession` 返回 `conflict` ⇒ **拒绝改绑并报出来**。
       */
      const bindNote = ((): string | undefined => {
        const file = stateFileOf(exec)
        if (file === undefined) {
          return 'session created but the ledger root of this call is unresolvable; the owner binding '
            + 'was NOT recorded (this session is unowned).'
        }
        if (typeof r.owner !== 'string' || r.owner === '') {
          return 'session created but the caller identity was unavailable; the owner binding was NOT '
            + 'recorded (this session is unowned).'
        }
        const cwd = exec?.agent?.session?.header?.cwd
        const b = bindSession(file, {
          sessionId: r.sessionId ?? '',
          owner: r.owner,
          via: 'spawn',
          ...(typeof cwd === 'string' && cwd !== '' ? { ownerWsRoot: cwd } : {}),
        })
        if (b.conflict !== undefined) {
          return `session created but it is ALREADY bound to ${b.conflict.existing.owner} `
            + `(via ${b.conflict.existing.via}); it was NOT rebound to ${b.conflict.wantedOwner}.`
        }
        if (!b.wrote) {
          return 'session created but the owner binding could not be persisted; after a restart this '
            + 'session may look unowned.'
        }
        return undefined
      })()
      // ── 建会话成功 ⇒ 记一条"待投递"（2026-10-10 新增）────────────────────
      //   ⚠ 为什么必须记：**建完不投递，用户看不见它**（空白会话被宿主有意过滤，
      //     见下面的 `visibilityNote`）。若派活方只建不投，那就既看不见、也收不到，
      //     而系统里**没有任何记录**——正是第 9 / 21 轮漏派的形态。
      //   ⚠ 与下面的 `visibilityNote` **互补、不重复**：那条说的是"它现在看不见"，
      //     本条说的是"你已经欠了一次投递"。两件事都真。
      noteHandoff(exec, 'spawned-session', r.sessionId ?? '')
      return JSON.stringify({
        ok: true,
        sessionId: r.sessionId,
        workspaceId: r.workspaceId,
        ...(r.workspacePath === undefined ? {} : { workspacePath: r.workspacePath }),
        ...(r.agentPreset === undefined ? {} : { agentPreset: r.agentPreset }),
        // ── 预设默认值未套用的如实标注（第 9 轮新增）────────────────────────
        //   ⚠ 只在"配置里的默认预设是规划侧预设、因而被跳过"时出现。
        //   ⚠ 既有 7 个字段（ok/sessionId/workspaceId/workspacePath/agentPreset/
        //     modelNote/note2）**一个未动**；本条是**新增**，与 `visibilityNote` 同款纪律。
        ...(r.presetNote === undefined ? {} : { presetNote: r.presetNote }),
        // ⚠ 模型默认值装不上时**如实回带**（不静默）：会话已建成，
        //   只是那一步增强失败了，调用方与用户都该看得见。
        ...(r.modelNote === undefined ? {} : { modelNote: r.modelNote }),
        // ⚠ 归属绑定：成功时不加噪音，失败/冲突时**必须**带回去（⛔ 不静默）
        ...(bindNote === undefined ? {} : { bindNote }),
        // ⚠ 2026-10-22 第 5 轮：两轴是否真的落地（无界面路径要求显式给值 ⇒ 必须回报落地结果）
        ...(policyNote === undefined ? {} : { policyNote }),
        /**
         * ⚠⚠ **甲-8 / 甲-9 的失败读数**（2026-10-21 · 第 329 轮）——
         *   ⚠ 与 `bindNote` **同款纪律**：成功时不加噪音、⛔ 一字不多；
         *     失败时必须**带回去**，且**两条成因分开**（⛔ 不许压成一句）。
         *   · `handoffWriteNote` ⇒ 待投递账没记上 ⇒ 重载后与"从来没派过"逐字相同；
         *   · `handoffIgnoreNote` ⇒ `runtime/.gitignore` 没写成 ⇒ 会话 id 可能进 git。
         */
        ...(handoffWriteNote === undefined ? {} : { handoffWriteNote }),
        ...(handoffIgnoreNote === undefined ? {} : { handoffIgnoreNote }),
        ...(r.owner === undefined ? {} : { owner: r.owner }),
        note2: 'Created only: the session exists but has not started yet. A directive delivered with '
          + 'hob_send or hob_dispatch wakes it — no user action is needed. Only if no directive is '
          + 'delivered does the user need to open it and send one line.',
        // ── 可见性提示（2026-10-10 · 第 5 轮新增）──────────────────────────
        //   ⚠ 为什么必须有：这是**用户实测撞上过**的坑 —— 派活方读 `hob_spawn` 的说明
        //     以为"有归属 ⇒ 用户看得见"，于是对用户说"刷新就能看到"，而用户**看不到**
        //     （空白会话被宿主有意过滤，见该工具 description 与 E-102）。
        //   ⚠ 与上面的 `note2` **语义不同、不重叠**：`note2` 说的是"它还没开跑"，
        //     本条说的是"它现在还看不见"。两件事都真，各说各的，**不是重复**。
        //   ⚠ 这是**新增**字段：既有的 `ok` / `sessionId` / `workspaceId` / `workspacePath` /
        //     `agentPreset` / `modelNote` / `note2` **一个未动**（名字与语义都不变）。
        visibilityNote: 'Not visible to the user yet: a session that has received no message is a '
          + '"blank" session, and the host deliberately hides blank sessions from the session list '
          + '(only the current one is exempt; search is filtered the same way). So right after '
          + 'creation the user CANNOT see it — this is not a failed creation and not a missing '
          + 'workspace link. It appears as soon as one message is delivered. Either deliver now '
          + '(hob_send / hob_dispatch) or tell the user plainly that it is not visible yet.',
      })
    },
  })

  return { sessions: sessionsTool, send: sendTool, workspaces: workspacesTool, spawn: spawnTool }
}
