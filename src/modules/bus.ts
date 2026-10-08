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

/** 会话忙闲：投递给 `running` 的会话会排到它下一轮/下一 step。 */
const BUSY = 'running'

/** `hobBus` 服务的形状。 */
export interface HobBus {
  readonly version: number
  /** 列**活**会话（按最近更新排序）。 */
  list(selfSessionId: string | undefined): SessionInfo[]
  /** 向指定会话投递一条 user 消息。 */
  deliver(sessionId: string, text: string, mode: DeliveryMode): Promise<DeliveryResult>
}

/** 就绪时挂上的实现（`apply` 里构造，服务缺席时不会存在）。 */
export function apply(ctx: any): void {
  ctx.logger?.debug?.(`[${name}] 已激活，等待 sessions/agents`)

  ctx.inject(['sessions', 'agents'], (svcCtx: any) => {
    const sessions = svcCtx.sessions ?? svcCtx.get?.('sessions')
    const agents = svcCtx.agents ?? svcCtx.get?.('agents')
    if (sessions === undefined || agents === undefined) {
      svcCtx.logger?.warn?.(`[${name}] sessions/agents 已就绪但不可用。`)
      return
    }

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
// M3 的两个工具 —— **定义**在本模块（能力在那，工具跟着走），
//   **注册**在 `src/preset/tools.ts`（预设作用域，只对 Hob 可见）。
//   ⚠ 与 `modules/tools.ts` 的 read_contracts/write_hob 同款纪律：
//     绝不在插件作用域注册（会漏进每一个预设，见 tools.ts 文件头的实测表）。
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
} {
  const sessionsTool = defineTool({
    name: 'hob_sessions',
    description:
      '列出**本实例内活着的会话**（id / 工作目录 / 预设 / 忙闲），用于找一个把指令投递过去的目标。'
      + '只列活会话：已归档或没有运行实体的历史会话收不到消息。'
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
      return ['活会话 ' + rows.length + ' 个：', ...lines].join('\n')
    },
  })

  const sendTool = defineTool({
    name: 'hob_send',
    description:
      '把一段文本作为一条消息投递给**指定会话**（同实例内）。'
      + '投递后该会话会被唤醒、把这段话当成你的指令来读，它的回复出现在**它自己的会话里**——'
      + '不会自动回到本会话。'
      + '⚠ 投递≠完成：这不是"我做了"，而是"我把它交给了那个会话"。'
      + '目标必须是 `hob_sessions` 列出的活会话；投给已归档的历史会被明确拒绝。'
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

  return { sessions: sessionsTool, send: sendTool }
}
