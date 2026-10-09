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
  /** 组成该会话的预设 id（如 `Hob` / `standard`），用于区分身份。 */
  agentPreset?: string
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
  reason?: string
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
function makeControllerLookup(svcCtx: any): any {
  try {
    return typeof svcCtx.get === 'function' ? svcCtx.get('sessionController') : svcCtx.sessionController
  } catch {
    return undefined
  }
}

/** `hobBus` 服务的形状。 */
export interface HobBus {
  readonly version: number
  /** 列**可投递的活**会话（已归档的不列）。 */
  list(selfSessionId: string | undefined): SessionInfo[]
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
   */
  spawn(workspace: string | undefined, agentPreset: string | undefined, selfSessionId: string | undefined): Promise<SpawnResult>
}

/** 就绪时挂上的实现（`apply` 里构造，服务缺席时不会存在）。 */
export function apply(ctx: any): void {
  ctx.logger?.debug?.(`[${name}] 已激活，等待 sessions/agents`)

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

    const bus: HobBus = {
      version: 1,
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
            rows.push({
              id,
              ...(typeof header.cwd === 'string' ? { cwd: header.cwd } : {}),
              ...(typeof header.agentPreset === 'string' ? { agentPreset: header.agentPreset } : {}),
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
        // ② 造消息：与 `dsh-schedule` 同款（`createUserMessage` + 自定义 source kind）。
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
              return { ok: true, messageId: message?.id, mode, reason: 'delivered but persistence did not acknowledge' }
            }
          }
        } catch {
          // 落库确认失败不否定投递本身。
        }
        return { ok: true, messageId: message?.id, mode }
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
        try {
          const created = await controller.create({
            workspaceId: wsId,
            ...(typeof agentPreset === 'string' && agentPreset.trim() !== '' ? { agentPreset: agentPreset.trim() } : {}),
          })
          return {
            ok: true,
            sessionId: created?.sessionId,
            workspaceId: wsId,
            ...(wsPath === undefined || wsPath === '' ? {} : { workspacePath: wsPath }),
            ...(created?.agentPreset === undefined ? {} : { agentPreset: created.agentPreset }),
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
 * 造 M3 的两个工具定义。
 *
 * @param bus - `hobBus` 服务（由 `ctx.inject([BUS_SERVICE], …)` 交进来）。
 *   ⚠ 传**值**而不是每次 `ctx.get`：注册发生在服务就绪之后，
 *     拿到的就是本模块刚 provide 的那一个；服务消失时注册随之拆除。
 */
export function createHobBusTools(bus: HobBus): {
  sessions: ReturnType<typeof defineTool>
  send: ReturnType<typeof defineTool>
  workspaces: ReturnType<typeof defineTool>
  spawn: ReturnType<typeof defineTool>
} {
  const sessionsTool = defineTool({
    name: 'hob_sessions',
    description:
      '列出**本实例内可投递的活会话**（id / 工作目录 / 预设 / 忙闲），用于找一个把指令投递过去的目标。'
      + '只列活会话：**已归档的会话不会出现在这里**，没有运行实体的历史会话也不列'
      + '（这两类都收不到会执行的活，列出去只会让你挑到一个投了也白投的靶）。'
      + '⚠ 目标由用户/你指定，本工具**不替你挑**。',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(_args: unknown, exec: any): Promise<string> {
      const rows = bus.list(selfSessionIdOf(exec))
      // 把自己标出来：投给自己是无效动作。
      const lines = rows.map((r) => {
        const bits = [
          r.id,
          r.self ? '(本会话)' : '',
          r.live ? '' : '[无运行实体·不可投递]',
          r.status === undefined ? '' : r.status,
          r.agentPreset === undefined ? '' : `预设=${r.agentPreset}`,
          r.cwd === undefined ? '' : `cwd=${r.cwd}`,
        ].filter((x) => x !== '')
        return '- ' + bits.join(' · ')
      })
      if (lines.length === 0) return '没有可投递的活会话。'
      return ['可投递的活会话 ' + rows.length + ' 个：', ...lines].join('\n')
    },
  })

  const sendTool = defineTool({
    name: 'hob_send',
    description:
      '把一段文本作为一条消息投递给**指定会话**（同实例内）。'
      + '投递后该会话会被唤醒、把这段话当成你的指令来读，它的回复出现在**它自己的会话里**——'
      + '不会自动回到本会话。'
      + '⚠ 投递≠完成：这不是"我做了"，而是"我把它交给了那个会话"。'
      + '目标必须是 `hob_sessions` 列出的活会话；投给**已归档**的会话会被明确拒绝'
      + '（归档后执行被宿主门禁挡下，投了也不会跑）。'
      + '⚠ 有实质改动的工作，指令仍应先按交接格式写成文件（`.hob/archive/<日期>/TASK.md`），'
      + '投递的文本里给路径而不是整篇正文。',
    parameters: {
      sessionId: {
        type: 'string',
        required: true,
        description: '目标会话 id（取自 hob_sessions 的输出）。',
      },
      message: {
        type: 'string',
        required: true,
        description: '要投递的文本。落地时先读你要它读的文件再执行，勿把整篇正文塞在这里。',
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
      return JSON.stringify({
        ok: true,
        delivered: true,
        sessionId: args.sessionId,
        mode: r.mode ?? 'followup',
        ...(r.messageId === undefined ? {} : { messageId: r.messageId }),
        ...(r.reason === undefined ? {} : { note: r.reason }),
        note2: 'Delivered only: the reply lands in that session, not here. Do not claim the work itself was done.',
      })
    },
  })

  const workspacesTool = defineTool({
    name: 'hob_workspaces',
    description:
      '列出**本实例里已登记的工作区**（id / 路径 / 标题 / 会话数），用于给 `hob_spawn` 挑归属。'
      + '标 `(本会话工作区)` 的那个是**缺省目标**（`hob_spawn` 不点名时落到它）。'
      + '⚠ 只有**已登记**的工作区在这里：路径没被登记过的工作区**建不出会话**（宿主会拒）。',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(_args: unknown, exec: any): Promise<string> {
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
      + '⚠ 这是本能力的核心：新会话**必须有工作区归属** —— 不属于任何工作区的会话'
      + '不会出现在项目视图里，用户也找不到它。'
      + '`workspace` 可以是**工作区路径**或 **id**；**不填则落到本会话自己的工作区**'
      + '（那正是"给这个项目派一个新会话"的常见意图）。'
      + '目标必须是**已登记**的工作区（拿不准先调 `hob_workspaces` 看）。'
      + '⚠ 建会话 ≠ 派活：建完还要用 `hob_send` 把指令投给它；'
      + '而且**新会话不会自己开跑** —— 投递（`hob_send` / `hob_dispatch`）即唤醒，'
      + '无需用户操作；**只有不投递时**才需要用户打开它并发一句话（首轮之后预设锁定）。',
    parameters: {
      workspace: {
        type: 'string',
        description:
          '目标工作区：路径（如 `/home/lk/FF/dsh-hob`）或 id。'
          + '**不填 = 本会话自己的工作区**（最常见的选择）。',
      },
      agentPreset: {
        type: 'string',
        description: '新会话用的预设 id（如 `standard`）。不填则用宿主的默认预设。',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: { workspace?: string; agentPreset?: string }, exec: any): Promise<string> {
      const r = await bus.spawn(args?.workspace, args?.agentPreset, selfSessionIdOf(exec))
      if (!r.ok) {
        return JSON.stringify({
          ok: false,
          reason: r.reason ?? 'spawn failed',
          ...(r.available === undefined ? {} : { availableWorkspaces: r.available }),
        })
      }
      return JSON.stringify({
        ok: true,
        sessionId: r.sessionId,
        workspaceId: r.workspaceId,
        ...(r.workspacePath === undefined ? {} : { workspacePath: r.workspacePath }),
        ...(r.agentPreset === undefined ? {} : { agentPreset: r.agentPreset }),
        note2: 'Created only: the session exists but has not started yet. A directive delivered with '
          + 'hob_send or hob_dispatch wakes it — no user action is needed. Only if no directive is '
          + 'delivered does the user need to open it and send one line.',
      })
    },
  })

  return { sessions: sessionsTool, send: sendTool, workspaces: workspacesTool, spawn: spawnTool }
}
