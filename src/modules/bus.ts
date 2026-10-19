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
import { FACTORY_DEFAULT_PRESET_ID, PLANNING_PRESET_ID } from '../shared/planning-preset.ts'
import { appendSessionModelSelection, installSessionModelSelection } from '../model-selection.ts'
// ── 待投递中间态记账（2026-10-10 · 用户报障修复）──────────────────────────
//   ⚠ 为什么在**工具层**（而不是服务实现 `spawn()` 里）：服务被别的路径调用时
//     不该产生"用户可见的欠账"；"没投出去就看不见"这件事只对**模型发起的动作**成立。
//     与 `modules/tools.ts` 的 write_hob 记账同款分工：**能力层不记账，工具层记账**。
//   ⚠ 账本根**不由本模块解析**（否则就是第二个路径解析实现点）：由挂载方
//     （`preset/tools.ts`）把 `ledgerRootOf` 闭包传进来 —— 那里已有 config 与 ctx。
import {
  bindSession, clearHandoffs, ensureRuntimeIgnored, orchStateFileOf, readOrchState, recordHandoff,
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
   * 该会话在**哪一侧**（依 {@link agentPreset} 判定，口径同源 {@link PLANNING_PRESET_ID}）。
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
   * **目标会话的预设是规划侧预设**（{@link PLANNING_PRESET_ID}）⇒ 响亮提示（第 129 轮新增）。
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
   * ⚠ **口径同源**：判定用 {@link PLANNING_PRESET_ID}，⛔ **不另写字面量**。
   */
  presetNotice?: string
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
              // ⚠ 「在哪一侧」由**同一个值**派生（口径同源 PLANNING_PRESET_ID，⛔ 不另写字面量）。
              ...(preset === undefined
                ? {}
                : { side: preset === PLANNING_PRESET_ID ? 'planning' as const : 'implementation' as const }),
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

      async deliver(sessionId: string, text: string, mode: DeliveryMode): Promise<DeliveryResult> {
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
        if (typeof callerId === 'string' && sessionId === callerId) {
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
        const agent = typeof agents.get === 'function' ? agents.get(sessionId) : undefined
        if (agent === undefined) {
          return {
            ok: false,
            reason: `session "${sessionId}" is not a live session; only live sessions can receive; `
              + 'do not wake archived history — pick another target or let the user open that session first.',
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
        const presetNotice = targetPreset === PLANNING_PRESET_ID
          ? 'WARNING: the target session ' + sessionId + ' is running the PLANNING-side preset ('
            + PLANNING_PRESET_ID + '). That preset plans work but CANNOT carry it out — it has no shell '
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
        }
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
        const configuredIsPlanning = configuredPreset === PLANNING_PRESET_ID
        let presetId = explicitPreset ?? (configuredIsPlanning ? undefined : configuredPreset)
        let presetNote = configuredIsPlanning && explicitPreset === undefined
          ? 'The configured new-session default preset is this plugin\'s planning-side preset ('
            + PLANNING_PRESET_ID + '). It was NOT applied: that preset plans work but cannot carry '
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
                + 'preset (' + PLANNING_PRESET_ID + '), so it was not applied. The session was created '
                + 'with the factory default preset (' + FACTORY_DEFAULT_PRESET_ID + ') instead. '
                + 'An explicitly passed agentPreset is unaffected.'
            }
            // 配置本来为空 ⇒ 这是**正常路径**（不是"少做了一件事"）⇒ 不留 NOTE，不打扰调用方。
          } else if (configuredIsPlanning) {
            presetNote = 'The configured new-session default preset is this plugin\'s planning-side '
              + 'preset (' + PLANNING_PRESET_ID + '), so it was not applied. The factory default '
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
   * 记一条"待投递"（**只记，不报错**）。
   * ⚠ 记账失败**不改工具结果**：调用方拿到的是"建会话/投递成功"这个事实，
   *   记账是附加可观测（同 `tools.ts` 的 write_hob 记账纪律）。
   */
  const noteHandoff = (exec: any, kind: 'spawned-session' | 'task-file', ref: string): void => {
    const file = stateFileOf(exec)
    if (file === undefined) return
    try {
      ensureRuntimeIgnored(dirname(file))
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
      recordHandoff(file, {
        kind,
        ref,
        at: Date.now(),
        ...(self === undefined ? {} : { owner: self }),
        ...(ownerWsRoot === undefined ? {} : { wsRoot: ownerWsRoot }),
      })
    } catch { /* 记账失败不掩盖主结果 */ }
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
      clearHandoffs(file, (h) => (h.kind === 'spawned-session'
        ? h.ref === targetSessionId
        : h.at <= now))
    } catch { /* 清理失败不掩盖主结果 */ }
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
        //   ⚠ 侧由 `agentPreset` 派生（同一口径 PLANNING_PRESET_ID），⛔ 不另立判据；
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
      agentPreset: {
        type: 'string',
        description:
          '新会话用的预设 id（如 `' + FACTORY_DEFAULT_PRESET_ID + '`）。'
          + '⚠ 不填时的取值顺序：本参数 > 设置里「新建会话默认」> 出厂默认 `'
          + FACTORY_DEFAULT_PRESET_ID + '`（⛔ 不问宿主默认）。'
          + '⚠ ②若恰好是规划侧预设（`' + PLANNING_PRESET_ID + '`）⇒ **不套用**（它只规划、不施工），'
          + '改走出厂默认，并在返回里带 `presetNote` 说明。'
          + '⚠ 名册读不到时退回不传给宿主（由宿主默认决定），同样在 `presetNote` 里如实说明。',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: { workspace?: string; agentPreset?: string }, exec: any): Promise<string> {
      /** ⚠ T2（B5）。⚠ 建会话也顺手对账：那是"我可能正在等回传"的又一条高频路径。 */
      pokeReconcile()
      const r = await bus.spawn(args?.workspace, args?.agentPreset, selfSessionIdOf(exec))
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
