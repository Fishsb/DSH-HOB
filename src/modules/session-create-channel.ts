/**
 * **新建 Hob 会话的受信创建通道**（2026-10-22 · `REQ-04` 的 UI 源码阶段）。
 *
 * ══ 它存在的唯一理由 ═══════════════════════════════════════════════════════
 *   用户要在**新建 Hob 会话时**分别选「可读档」与「推进工作方式」。
 *   ⇒ 必须有这样一条链路：**先建空白会话 → 再写两项策略 → 才允许第一轮**。
 *   ⚠ 顺序不可换：`hobSessionPolicy.set()` 要求 `sessions.get(sessionId)` 已经存在
 *     （它要按该会话的 cwd 判账本落点）⇒ **不能**在建会话之前"先写策略"。
 *
 * ══ 为什么是"本插件自己的 HTTP 路由"，而不是复用宿主的 `session/create` 远程方法 ══
 *   ⚠ **这条是实测结论，不是偏好**：
 *   · 宿主的 `session/create` 是 Typert Remote，**只建会话、不知道两轴策略**；
 *     ⇒ 用它建完之后，**写策略这一步仍然要有一条通道**，否则弹窗的选择无处落地；
 *   · 而且它**没法**把"建会话 + 写策略"做成**一个原子的、可回滚的**操作。
 *   ⇒ 所以本模块提供一条**自己的**路由，把两件事合在一处，并自己承担回滚。
 *
 * ══ 安全模型（⛔ 每一条都必须成立，缺一条就不该有这个接口）════════════════
 *   ① **鉴权与跨站**：`ctx.connection.fetch.register` 自带宿主级的
 *      Host/Origin 同源栅栏 + Peer 认证（未认证 401、跨站 403）——
 *      证据：`dsh-client-connection/lib/index.js` 的 `admit()`（`:742-750`）
 *      与 `isTrustedApiRequest()`（`:240-254`，其中 `sec-fetch-site === "cross-site"` 直接 false）。
 *      ⇒ **本模块不自己发明鉴权**，只登记路由；栅栏在宿主那一层。
 *   ② **不接受"任意 sessionId 改别人策略"**：请求**必须**带我方签发的一次性票据
 *      （`ticket`），票据里绑的内容是：
 *        · 用户**本次**选的两值；
 *        · 预分配的 **sessionId**（客户端生成，⚠ 只为定位，**不构成授权**）；
 *        · **过期时刻**（`expiresAt`）+ **一次性**（用过即作废）。
 *      ⇒ 没有票据 / 票据过期 / 票据已用过 / 票据里的 sessionId 与请求不符 ⇒ **拒**。
 *      ⚠ 这就是"不能信任请求自报 sessionId 作为唯一授权"的落点。
 *   ③ **只能作用于"本次新建的空白 Hob 会话"**：
 *      · 该 sessionId **必须不存在**（`sessions.get()` 为 undefined）——已在跑的会话一律拒；
 *      · 建出来之后立刻核 `isBlank`（没有 turn/start 事件）——有就拒并回收；
 *      · 预设必须是 Hob（`agentPreset` 由本模块指定，不由请求方给）。
 *   ④ **重放防护**：票据一次性（消费即删）+ sessionId 唯一性（建过就不能再建）
 *      ⇒ 同一张票据重放第二次必然落到"票据已用过"或"会话已存在"，两种都拒。
 *
 * ══ 回滚（任务书要求"失败不能开首轮或留可执行宽档孤儿"）══════════════════
 *   建会话成功但写策略失败 ⇒ 本模块**主动销毁**该空白会话（`session.dispose()` /
 *   宿主等价接口），并返回 `rolledBack: true`。
 *   ⚠ 若销毁不可用 ⇒ **不隐瞒**：返回 `stranded: { sessionId, level: <实测值或 unknown>, executable: true }` 说明
 *     "这个空白会话留下了，但它**没有策略记录** ⇒ 按最低档读、且 `mayProceed` 视情况"
 *     —— 关键点：**没有策略记录的会话不会拿到宽档**（`resolveSessionPolicy` 的
 *     无记录分支恒 `floor`）。⇒ 孤儿**不可能是"可执行宽档"**，最多是"空白 + 最低档"。
 *
 * ══ 边界（必须如实说）════════════════════════════════════════════════════
 *   · **弹窗只覆盖"从本插件 UI 选 Hob 新建"这一条路**。
 *     宿主**直接**建 Hob 会话（`session/create`、CLI、别的插件）**拦不住** ⇒
 *     那种会话没有记录 ⇒ 走无记录分支：
 *       - **新会话（晚于迁移纪元）** ⇒ 最低档 + **允许推进**（2026-10-24 用户裁定 1(a)，
 *         见 `session-policy.ts` 的 `derived-default` 支）；
 *       - 旧会话 / 判不出新旧 ⇒ 快照原值或**不推进**（⚠ 那几条一个都没放宽）。
 *     ⛔ 不许说"所有 API 都有弹窗"。
 *   · ⚠ 本模块的 `action:'write'` 由 `session-policy-route.ts` 承接，**不在本文件**；
 *     那条写入面本轮补了"开放面 + 非 Hob 拒绝"两道闸（见该文件 `handlePolicyWrite`）。
 */
import { createRequire } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'
import { PERMISSION_LEVELS, DEFAULT_PERMISSION_LEVEL, SESSION_POLICY_SERVICE } from '../config.ts'
import { DEFAULT_WORK_MODE, WORK_MODE_VALUES } from '../shared/work-mode.ts'
import { PLANNING_PRESET_ID } from '../shared/planning-preset.ts'
import {
  OPEN_READ_LEVELS, OPEN_READ_LEVELS_NOTE, isOpenReadLevel, readLevelNotOpenReason,
} from '../shared/read-level-policy.ts'

export const name = 'dsh-hob-create-channel'

/** 本插件自己的路由（⚠ 不与宿主 `/api/*` 撞名）。 */
export const CREATE_CHANNEL_PATH = '/api/dsh-hob/session-create'

/** 票据有效期（ms）。⚠ 短：它只覆盖"用户在弹窗里选完 → 点确认"这一小段。 */
export const TICKET_TTL_MS = 2 * 60 * 1000

/** 一张一次性票据。 */
export interface CreateTicket {
  sessionId: string
  level: string
  workMode: string
  /**
   * ⚠ **工作区归属**（2026-10-22 修正）：创建时的目标工作区 id。
   *   ⚠ **必须绑进票据** —— 否则客户端可以在"签票时给 A 工作区、创建时换 B"，
   *   而服务端没有独立依据判断它属于哪里。
   *   ⚠ `undefined` **不允许**：没有归属就不签（见 `issue` 的拒绝分支），
   *   因为"没有工作区归属的会话"账本落点不确定（任务书③）。
   */
  workspaceId: string
  expiresAt: number
}

/** 票据签发结果（⚠ 永远给可读原因，⛔ 不静默）。 */
export interface TicketIssueResult {
  ok: boolean
  ticket?: string
  expiresAt?: number
  reason?: string
}

/** 创建结果。 */
export interface CreateResult {
  ok: boolean
  sessionId?: string
  /** 两项是否**真的**写进去了（回读确认过）。 */
  policyPersisted?: boolean
  /** 建了但策略写失败 ⇒ 是否已回收。 */
  rolledBack?: boolean
  /**
   * ⚠ **回收失败后仍存在、且可能按某档执行的会话**（2026-10-22 修正）。
   *   ⛔ 不再叫 `orphan`（那暗示"无害的空白会话"）：
   *   本字段出现在**回读不一致**这一支 —— 盘上**可能已是高档**。
   *   ⚠ `executable: true` 恒定：我们**证明不了**它不能执行 ⇒ 安全侧按"能"报。
   */
  stranded?: { sessionId: string; level: string; workMode: string; executable: boolean }
  /**
   * ⚠ 对 `stranded` 会话做的**持久隔离结果**（2026-10-22）。
   *   · `ok: true` ⇒ 记录已作废并落盘、回读确认过 ⇒ 重载后仍是最低档、不推进；
   *   · `ok: false` ⇒ **隔离失败** ⇒ 本结果必须被当作"无法安全交付"（见 `unsafe`）。
   */
  quarantine?: { ok: boolean; reason: string }
  /**
   * ⚠⚠ **回滚的精确含义**（2026-10-22）：`rolledBack: true` **不等于**"磁盘上没这条会话"。
   *
   *   · `live: false` —— 活表里没有它 ⇒ **不能 openSession、不能发首轮**（这是真的撤了）；
   *   · `onDisk: true` —— ⚠ **磁盘会话文件仍在**（`SessionPersistence` 无 delete/remove、
   *     `agent-loop` 的 `teardown` 只 `handle.close()`）⇒ 重载后 `list()` 仍能读到它。
   *
   *   ⛔ 上一版据此写"已回收"，把两件不同的事合成一句 ⇒ 那是**不实**的。
   *   ⇒ 现在把它们**分开**给：报告与上层都只能用 `live` 说"撤掉了"，
   *     不许用 `rolledBack` 说"磁盘上没有了"。
   */
  rollbackResidual?: { live: boolean; onDisk: boolean }
  /**
   * ⚠⚠ **无法安全交付**：`true` 当且仅当"存在可能按高档执行的残留会话，且我们
   *   **无法证明**它已被隔离"。⚠ 调用方/上层看到它必须**停手**，
   *   ⛔ 不许把它当作"已处理好"。
   */
  unsafe?: boolean
  reason?: string
}

/**
 * 票据仓库（进程内、一次性、带过期）。
 *
 * ⚠ 为什么在内存里而不是落盘：票据是**一次浏览器交互**的凭据，
 *   跨重启没有意义（重启后用户在弹窗里重新选一次即可）。
 *   ⚠ 同理**不能**做成长效 token —— 那会把一次性授权变成长期后门。
 */
interface TicketStore {
  issue(input: { sessionId: string; level: string; workMode: string; workspaceId: string }): TicketIssueResult
  /** ⚠ 消费即删（一次性）。失败也删（⛔ 不给重试留口子 —— 但会返回原因）。 */
  consume(ticket: string): { ok: true; value: CreateTicket } | { ok: false; reason: string }
  /** 当前有效票据数（诊断用）。 */
  size(): number
}

/** 造一个票据仓库（⚠ 独立函数便于机检直接注入时钟与随机源）。 */
export function createTicketStore(
  opts: { now?: () => number; random?: () => number } = {},
): TicketStore {
  const now = opts.now ?? (() => Date.now())
  const random = opts.random ?? (() => Math.random())
  const tickets = new Map<string, CreateTicket>()

  /**
   * 生成**不可猜**的票据串 —— ⚠ **取不到强随机就拒签，⛔ 不退化**。
   *
   * ── 上一版为什么错（2026-10-22 实测，不是推断）──────────────────────────
   *   上一版写的是 `require('node:crypto').randomUUID()`，`catch` 后退到
   *   `Math.random()`。⛔ 但本仓 `package.json` 是 `type: "module"` ⇒
   *   **ESM 里没有 `require`**（实测 `typeof require === 'undefined'`，
   *   调用直接 `ReferenceError: require is not defined`）⇒ 这个 `try` **必然**崩，
   *   于是**每一次**签票都静默走 `Math.random()`。
   *   ⚠ 实测证据：真实产物 `lib/modules/session-create-channel.js` 签出的票据是
   *   `t-mvj0jhfa-i10cwwrq52-g22f2lro76m` 这种形态（不是 UUID）。
   *   ⇒ 「有 crypto 就用 crypto」在这个仓里**从未成立过**，那句话是**假承诺**。
   *
   * ── 修法（两条，缺一不可）────────────────────────────────────────────
   *   ① **换支持的入口**：用 `createRequire(import.meta.url)` 拿到**本模块作用域**的
   *      `require`（这才是 ESM 下的官方写法），它一定能解析 `node:crypto`；
   *   ② **仍取不到 ⇒ 抛错 / 拒签**：⛔ 绝不用 `Math.random()` 顶替。
   *      —— 安全票据的强度是**前提**不是**偏好**：弱随机的票据可被猜中，
   *      等于把"一次性授权"变成"可伪造授权"。
   *
   * ⚠ 注入的 `opts.random` **仍然只用于非安全用途**（诊断/测试确定性）；
   *   ⛔ 一旦它被用来生成真票据，就等于把弱随机重新引回来 —— 故本函数**不看**它。
   */
  const mint = (): { ok: true; ticket: string } | { ok: false; reason: string } => {
    try {
      // ⚠ ESM 下的官方 require：createRequire 绑到**本模块**，不受宿主加载方式影响
      const nodeCrypto = createRequire(import.meta.url)('node:crypto') as typeof import('node:crypto')
      const id = nodeCrypto.randomUUID()
      if (typeof id !== 'string' || id.length < 32) {
        return { ok: false, reason: '强随机返回值不可用（randomUUID 未给出合法串）⇒ 拒签（⛔ 不退化到 Math.random）' }
      }
      return { ok: true, ticket: id }
    } catch (e) {
      return {
        ok: false,
        reason: `取不到强随机（${String((e as Error)?.message ?? e)}）⇒ 拒签`
          + '：⛔ 不再以 Math.random 退化（那会让票据可猜、把一次性授权变成可伪造授权）',
      }
    }
  }

  return {
    issue(input) {
      // ⚠ 校验：枚举外的值直接拒（⛔ 不就近归一 —— 与 `setSessionPolicy` 同口径）
      if (typeof input.sessionId !== 'string' || input.sessionId === '') {
        return { ok: false, reason: 'sessionId 为空 ⇒ 签发票据无意义' }
      }
      if (!(PERMISSION_LEVELS as readonly string[]).includes(input.level)) {
        return { ok: false, reason: `可读档 ${JSON.stringify(input.level)} 不在合法枚举里` }
      }
      /**
       * ⚠⚠ **服务端硬限制**（2026-10-22 · 用户裁定「安全优先」）——
       *   合法枚举里的 `project` / `workspace` **当前不开放**：
       *   宿主没有持久删除能力，创建失败时宽档记录可能在重启后与磁盘会话重新配对执行。
       *   ⇒ ⛔ **不在这里拒，就等于让请求方自报宽档绕过界面**（本批要修的就是这个洞）。
       *   ⚠ 判据用**开放面**（`shared/read-level-policy.ts` 一处常量），⛔ 不在这里另抄白名单。
       */
      if (!isOpenReadLevel(input.level)) {
        return { ok: false, reason: readLevelNotOpenReason('签发一次性票据') }
      }
      if (!(WORK_MODE_VALUES as readonly string[]).includes(input.workMode)) {
        return { ok: false, reason: `工作方式 ${JSON.stringify(input.workMode)} 不在合法枚举里` }
      }
      /**
       * ⚠ **工作区归属必须由请求方显式给出、且非空**（2026-10-22 修正任务书③）。
       *   ⛔ 不再"取 `workspaceRegistry.list()[0]` 当当前" —— 那个"第一项"与用户
       *   此刻在哪个工作区里**没有关系**（宿主自己的 `startSession` 用的是
       *   `workspaceId ?? 当前会话所属 ?? 最近用过`，见 `dsh-client-ui-workspace`
       *   的 `UiWorkspaceService.startSession`）⇒ 我们再抄一条"取第一项"就是**第二条口径**。
       *   ⇒ 本接口只接受**明确指定的已登记工作区 id**；为空则**拒签**（零孤儿）。
       */
      if (typeof input.workspaceId !== 'string' || input.workspaceId === '') {
        return {
          ok: false,
          reason: '没有可信的工作区归属 ⇒ 拒签（⛔ 不拿"注册表第一项"冒充当前工作区，'
            + '⛔ 也不建无归属会话：那种会话账本落点不确定）',
        }
      }
      // ⚠ 顺手清掉过期票据（避免 map 无限长）
      const t = now()
      for (const [k, v] of tickets) if (v.expiresAt <= t) tickets.delete(k)
      const minted = mint()
      if (!minted.ok) return { ok: false, reason: minted.reason }
      const ticket = minted.ticket
      const expiresAt = t + TICKET_TTL_MS
      tickets.set(ticket, {
        sessionId: input.sessionId,
        level: input.level,
        workMode: input.workMode,
        workspaceId: input.workspaceId,
        expiresAt,
      })
      return { ok: true, ticket, expiresAt }
    },

    consume(ticket) {
      if (typeof ticket !== 'string' || ticket === '') return { ok: false, reason: '没有票据 ⇒ 拒（⛔ 不接受无授权的建会话请求）' }
      const v = tickets.get(ticket)
      if (v === undefined) {
        return { ok: false, reason: '票据不存在或**已用过**（一次性票据，重放会被拒）' }
      }
      // ⚠ **先删再判**：无论下面成功与否，这张票都不能再用第二次。
      tickets.delete(ticket)
      if (v.expiresAt <= now()) {
        return { ok: false, reason: `票据**已过期**（有效期 ${TICKET_TTL_MS} ms）⇒ 请重新选择` }
      }
      return { ok: true, value: v }
    },

    size() { return tickets.size },
  }
}

/**
 * 把「建空白 Hob 会话 + 写两值」做成一个**有回滚的**操作。
 *
 * ⚠ 依赖注入（`deps`）而不是直接摸 ctx：这样机检可以用假宿主跑**真源码**，
 *   覆盖"建失败 / 写失败 / 回收失败"三条路径（真机上很难造）。
 */
export interface CreateDeps {
  /** 宿主 `sessions` 服务（`get` / `prepare` 或 controller）。 */
  sessionsOf: () => any
  /**
   * ⚠ **已弃用**（2026-10-22）：`sessionController.create` **不返回 handle**
   *   ⇒ 失败时无法回收，这正是本轮回滚必失败的根因。
   *   ⚠ 保留为**可选**仅用于将来诊断，**创建链不再读它**。
   */
  controllerOf?: () => any
  /**
   * ⚠ **宿主 `ctx.agents`**（`AgentRegistry`）—— 2026-10-22 新增。
   *
   * ── 为什么必须换成它（上一版回滚为什么必失败）──────────────────────────
   *   上一版回滚写成：`sessions.get(id)` 取到 Session，再 `live.dispose()`。
   *   ⛔ 但宿主 **`Session` 类型根本没有 `dispose`/`destroy`/`remove`**
   *   （`@deepseek-ai/dsh-session` 的 `Session` 面只有 sessionId/projections/
   *     beginSubmission/prompt/readAttachment/updateQueue/cancel/rename/
   *     loadOlder/loadThrough/command）⇒ 那个分支**永远 return false**。
   *
   *   ✅ 官方**有**可回收句柄：`AgentHandle.dispose(): Promise<void>`，
   *   `ctx.agents.create(options): Promise<AgentHandle>`（`@deepseek-ai/dsh-agent`
   *   的 `types/index.d.ts` 声明）。其 JSDoc 原文：
   *   "`dispose()` stops the loop, awaits its exit, unregisters the agent,
   *    **removes its session from the store**, and finally unwinds its scoped world."
   *
   *   ⚠⚠ **但那句 "store" 是内存 registry，不是磁盘** —— 2026-10-22 实测：
   *     ① `SessionPersistence`（`@deepseek-ai/dsh-session-persistence`）**接口没有
   *        `delete`/`remove`**（只有 create/open/stat/list + 句柄 close/flush）；
   *     ② `agent-loop` 的 `teardown()` 只 `handle?.close()`（释放写所有权）；
   *     ③ jsonl 后端里所有 `rm(` 调用**只清 staging/tmp**，**没有一处删会话日志**。
   *     ⇒ **`dispose()` 之后磁盘上的会话文件仍在**，重载后仍会被 `list()` 读到。
   *     ⚠ 这一点直接决定本模块能承诺什么：**能撤"活会话"，不能撤"磁盘文件"**。
   */
  agentsOf: () => any
  /**
   * ⚠ **宿主持久归档**（`workspaceRegistry.archiveSession`，2026-10-22 新增）。
   *
   * ── 为什么必须有它（上一版为什么仍可能留"可执行宽档"）──────────────────
   *   `AgentHandle.dispose()` 只撤**内存活表**；磁盘 JSONL 仍在（上一轮两层实测）。
   *   ⇒ 若 `active:workspace` 已落盘、而 `quarantine` 又写失败，那么**dispose 之后**
   *     重启仍会把这个会话从磁盘读回来、并配上那条高档记录 ⇒ 仍可执行宽档。
   *
   *   ✅ 官方原语：`workspaceRegistry.archiveSession(sessionId, { stopActivity: true })`
   *   （`@deepseek-ai/dsh-workspace/lib/types/index.d.ts:214`）。其 JSDoc 原文：
   *   "Archive one session **durably**. ... the durable archive set is what a
   *    provider's `agent/pre-step` gate reads, so every wake the stops induce is
   *    already blocked."
   *   ⚠ 关键：它**不要求会话还活着**（"live or in session persistence"）⇒
   *     即使 dispose 已发生，归档仍然能写。
   *   ⚠ 读回面：`workspaceRegistry.archivedSessionIds`（`:196`，同步 getter）。
   */
  archiveOf: () => any
  /** 宿主工作区注册表（给会话归属）。 */
  workspacesOf: () => any
  /** 本插件策略服务的 `set`（⚠ 返回 `{ok, reason}`）。 */
  /**
   * 写策略。⚠ `activation='pending'` 时**先不生效**（解析期最低档 + 不推进），
   *   由 `activatePolicy()` 确认后才生效 —— 这是"未确认绝不激活宽档"的落点。
   */
  setPolicy: (
    sessionId: string, level: string, workMode: string,
    activation?: 'pending' | 'active',
  ) => { ok: boolean; reason: string }
  /**
   * ⚠ **确认生效**（2026-10-22）：把 pending 记录转成 active。
   *   缺省（`undefined`）⇒ 创建链**不会**把策略留在 active，
   *   ⇒ 那一格必须走"未确认 ⇒ 只可能是最低档"的安全结论。
   */
  activatePolicy?: (sessionId: string) => { ok: boolean; reason: string }
  /**
   * 读回策略（回读确认）。
   *
   * ⚠ 2026-10-24：多带 `mayProceed`（可选）—— `persistentlyDisable` 的读回确认
   *   现在要断言"隔离后**不能推进**"（`quarantined` 分支恒为 false）。
   *   ⚠ 标成可选是为了**向后兼容**：旧组合/测试夹具不给它也不会炸，
   *     只是那一层断言退化为"不满足 ⇒ 继续走归档兜底"（安全侧，⛔ 不放宽）。
   */
  readPolicy: (sessionId: string) => { level: string; workMode: string; source: string; mayProceed?: boolean } | undefined
  /**
   * ⚠ **持久隔离**（2026-10-22 · 治 `stranded`）：把该会话的策略记录标记作废并落盘。
   *   缺省（`undefined`）⇒ 创建链在需要隔离时会**如实报"无法隔离"并失败**，
   *   ⛔ 绝不假装已隔离。
   */
  quarantinePolicy?: (sessionId: string) => { ok: boolean; reason: string }
  log?: (m: string) => void
}

/**
 * 执行创建链。
 *
 * ⚠ 顺序**严格**是：核票据 → 核 sessionId 空闲 → 建空白 → 写策略 → **回读确认** →
 *   才算成功。任一步失败 ⇒ 见 `CreateResult`。
 */
export async function createHobSession(
  deps: CreateDeps,
  store: TicketStore,
  input: { ticket: string; sessionId: string },
): Promise<CreateResult> {
  const log = deps.log ?? (() => {})

  // ── ① 票据（身份 + 本次授权 + 重放防护）────────────────────────────────
  const consumed = store.consume(input.ticket)
  if (!consumed.ok) {
    log(`[create-channel] 拒绝：${consumed.reason}`)
    return { ok: false, reason: consumed.reason }
  }
  const t = consumed.value
  // ⚠ **票据里的 sessionId 必须与请求一致** —— 防止"拿 A 的票据去建 B 的会话"。
  if (t.sessionId !== input.sessionId) {
    log('[create-channel] 拒绝：票据与会话不一致（试图用 A 的授权操作 B）')
    return { ok: false, reason: '票据绑定的会话与请求不一致 ⇒ 拒绝（⛔ 不接受跨会话改策略）' }
  }

  /**
   * ⚠⚠ **建会话前的第二道档位校验**（2026-10-22 · 用户裁定「安全优先」）——
   *   为什么 `issue()` 已经拒了还要再拒一次（⛔ 不是重复劳动）：
   *     ① **票据可能是在本限制生效之前签发的**（进程内票据表活 2 分钟）；
   *     ② 将来任何一条**别的签票路径**（或机检直接调 `issue` 的旧夹具）都会在这里被兜住；
   *     ③ 本链的第一条纪律是"**建会话之前**拒掉一切不该建的" —— 判断点在副作用之前。
   *   ⚠ 判据用**开放面**（与 `issue()` 同一个常量），⛔ 不在这里另抄白名单。
   *   ⚠ 位置在**任何副作用之前**（此时还没建会话、没写策略、没挂工作区）⇒ 零残留。
   */
  if (!isOpenReadLevel(t.level)) {
    log(`[create-channel] 拒绝建会话：可读档 ${JSON.stringify(t.level)} 不在当前开放范围`)
    return { ok: false, reason: readLevelNotOpenReason('创建会话') }
  }

  // ── ② sessionId 必须**当前不存在**（只能建新的，不能改已在跑的）──────────
  const sessions = deps.sessionsOf()
  if (typeof sessions?.get !== 'function') {
    return { ok: false, reason: '宿主 `sessions` 服务不可用 ⇒ 无法核实会话是否已存在，拒绝创建' }
  }
  if (sessions.get(input.sessionId) !== undefined) {
    return { ok: false, reason: `会话 ${JSON.stringify(input.sessionId)} **已存在** ⇒ 本接口只建新空白会话，⛔ 不改已有会话的策略` }
  }

  /**
   * ⚠ **前置探测改成 `agents`**（2026-10-22）：本链现在只用 `agents.create`
   *   （唯一能拿到 `AgentHandle` 的官方入口）。⚠ 探测放在**建会话之前**，
   *   ⛔ 不许"建出来才发现拿不到 handle"（那会留下撤不掉的活会话）。
   */
  const agentsProbe = deps.agentsOf()
  if (agentsProbe === undefined || typeof agentsProbe.create !== 'function') {
    return {
      ok: false,
      reason: '宿主 `ctx.agents.create` 不可用 ⇒ 拿不到可回收句柄，拒绝创建'
        + '（⛔ 不退回"建了但撤不掉"的旧路径）',
    }
  }

  // ── ③ 建**空白** Hob 会话（工作区归属来自**票据**，且必须是已登记的）────
  /**
   * ⚠⚠ **归属来源唯一** = 票据里的 `workspaceId`（签票时由请求方显式给出）。
   *   ⛔ 不再 `workspaceRegistry.list()[0]` —— 理由见 `issue()` 里那段注释：
   *   "第一项"与"用户此刻所在的工作区"没有关系，那是**第二条口径**。
   *   ⚠ 这里还要**独立校验它确实已登记**：票据只能证明"用户选过什么"，
   *   ⛔ 不能证明"这个 id 现在还有效"（可能已被删/改）。校验不到 ⇒ 拒建。
   *   ⚠ 无归属 ⇒ **拒建**（⛔ 绝不省掉 workspaceId 建一个孤儿会话）。
   */
  const ws = deps.workspacesOf()
  if (typeof ws?.list !== 'function') {
    return {
      ok: false,
      reason: '宿主 `workspaceRegistry` 不可用 ⇒ 无法核实工作区归属，拒绝创建'
        + '（⛔ 不建"归属未核"的会话）',
    }
  }
  let registered: Array<{ id?: unknown }> = []
  try {
    const list = ws.list()
    registered = Array.isArray(list) ? list : []
  } catch (e) {
    return { ok: false, reason: `读取工作区注册表失败：${String((e as Error)?.message ?? e)} ⇒ 拒绝创建` }
  }
  const workspaceId = t.workspaceId
  const isRegistered = registered.some((w) => typeof w?.id === 'string' && w.id === workspaceId)
  if (!isRegistered) {
    return {
      ok: false,
      reason: `工作区 ${JSON.stringify(workspaceId)} **不在已登记列表里** ⇒ 拒绝创建`
        + '（票据里的归属已失效：可能被删掉或改名。⛔ 不拿别的 id 顶替，⛔ 不建无归属会话）',
    }
  }

  /**
   * ── ③ **建空白会话，并保住可回收的 AgentHandle**（2026-10-22 重写）─────────
   *
   * ⚠ 为什么不再用 `controller.create({workspaceId})`：
   *   它内部走 `agents.createSession` ⇒ **只返回 `agent`，没有 handle**
   *   （`ApiSessionCreated = { agent, agentPreset }`）⇒ 失败时**没有能力回收**，
   *   这正是上一版"回滚必失败"的根因。
   *
   * ⚠ 为什么 `agents.create` 能等价保住那四条语义（逐条核对官方声明）：
   *   ① **空白**：`CreateAgentOptions` 不带 `seed` ⇒ 会话从 0 事件起（下面还会再核一次）。
   *   ② **工作区归属**：`sessionController.create` 的实际做法是
   *      `cwd = workspace.path` 然后 `workspace.attachSession(sessionId)`；
   *      ⇒ 我们用 `meta.cwd = workspace.path`（同一个落点），并在成功后再 attach。
   *      ⚠ `CreateAgentOptions.meta` **没有 workspaceId 字段**（只有 cwd / parentSession /
   *        isSeeded / origin / delegationDepth / agentPreset）—— 已逐字核对 `types.d.ts`。
   *   ③ **可 openSession**：会话在 registry 里正常发布（`agents.create` 的 publish 阶段
   *      会 `sessions.enter` + `announce`）⇒ 它在活表里，`uiWorkspace.openSession(id)` 可用。
   *   ④ **可发首轮**：我们**不**消费它的 inbox、**不**开第一轮。
   *   ⚠ 另：`reusable`（`createSession` 里那个放置规则）在 `agents.create` 这一层**不存在**
   *     —— 它属于 `ApiSessionCreateRequest`。⇒ 我们自己核"该 id 是否已被占用"，
   *     已在上面 ②（票据/sessionId 空闲检查）做过。
   */
  const agents = deps.agentsOf()
  if (agents === undefined || typeof agents?.create !== 'function') {
    return {
      ok: false,
      reason: '宿主 `ctx.agents.create` 不可用 ⇒ **拿不到可回收句柄**，拒绝创建'
        + '（⛔ 不退回"建了但撤不掉"的旧路径：那会让失败必然留下活会话）',
    }
  }
  const wsPath = (() => {
    try {
      const list = ws.list()
      const hit = Array.isArray(list) ? list.find((w: any) => w?.id === workspaceId) : undefined
      return typeof hit?.path === 'string' && hit.path !== '' ? hit.path : undefined
    } catch { return undefined }
  })()
  if (wsPath === undefined) {
    return {
      ok: false,
      reason: `工作区 ${JSON.stringify(workspaceId)} 的目录路径读不到 ⇒ 无法给会话定 cwd，拒绝创建`
        + '（⛔ 不拿进程 cwd 顶替，那会把会话落到错误目录）',
    }
  }

  /**
   * ⚠⚠ **成功路径必须保活**（2026-10-22）：
   *   `AgentRegistry.create()` 的 owner 是 **registry 自己的 ctx**
   *   （源码：`const ownerCtx = this.ctx; ... target.createAgent(ownerCtx, options)`），
   *   ⛔ **不是**本次 HTTP 请求的 ctx ⇒ 会话生命周期绑在**插件 fiber**上，
   *   不会因为"请求处理完/响应结束"而自动 dispose。
   *   ⇒ 我们**只在失败分支**显式 `await handle.dispose()`；成功分支
   *     **既不 dispose、也不把 handle 挂到任何会被请求结束清理的 effect 上**。
   */
  let handle: any
  try {
    handle = await agents.create({
      sessionId: input.sessionId,
      meta: { cwd: wsPath, agentPreset: PLANNING_PRESET_ID },
    })
  } catch (e) {
    return { ok: false, reason: `建会话失败：${String((e as Error)?.message ?? e)}（⛔ 没有开第一轮）` }
  }
  if (handle === undefined || typeof handle.dispose !== 'function') {
    /**
     * ⚠ 建出来了却**没有 dispose** ⇒ 无法回收 ⇒ 必须立刻说清并尽量收拾。
     *   ⚠ 此时**不能**继续写策略（那会制造"失败但已配策略"的会话）。
     */
    return {
      ok: false,
      reason: '建会话返回了，但**没有 `dispose()`** ⇒ 无法保证失败可回收 ⇒ 拒绝继续写策略'
        + '（⚠ 该空白会话可能仍存在，需人工处理）',
      unsafe: true,
    }
  }
  /** ⚠ **本次创建的凭据**：id + **活句柄**（回滚只认它，⛔ 不再从 sessions.get 找 dispose）。 */
  const createdRef = { sessionId: String(handle?.agent?.id ?? input.sessionId), handle }
  const createdId = createdRef.sessionId

  /**
   * ── ③b **把会话挂到用户选的工作区**（2026-10-22 · 等价于宿主 `controller.create` 的那一步）
   *
   * ⚠ 宿主源码（`dsh-api-session-controller/lib/index.js`）里 `workspaceId` 的完整语义是两步：
   *   ① `cwd = workspace.path`（我们已通过 `meta.cwd` 做到）；
   *   ② `await workspace.attachSession(sessionId)`。
   *   ⚠ 而且**它 attach 失败时只抛错、不回收会话**（源码里是 `throw new RemoteError(...)`
   *     在 `agents.createSession` 之后）⇒ 若我们照抄，会留下"建了但没归属"的活会话。
   *   ⇒ 本模块：attach 失败 ⇒ **立即 dispose 回收**（因为我们持有 handle，做得到）。
   */
  const workspace = (() => {
    try {
      const list = ws.list()
      return Array.isArray(list) ? list.find((w: any) => w?.id === workspaceId) : undefined
    } catch { return undefined }
  })()
  if (workspace !== undefined && typeof workspace.attachSession === 'function') {
    try {
      await workspace.attachSession(createdId)
    } catch (e) {
      const back = await rollback(deps, createdRef, log)
      return {
        ok: false,
        rolledBack: back,
        ...(back ? { rollbackResidual: rollbackResidual(deps, createdRef.sessionId) } : {}),
        reason: `会话已建出但**挂到工作区失败**：${String((e as Error)?.message ?? e)}`
          + (back ? '⇒ 已撤销该会话（⛔ 不留无归属活会话）' : '；⚠ 撤销失败，该会话可能仍在'),
        ...(back ? {} : { unsafe: true }),
      }
    }
  } else if (workspace !== undefined) {
    /**
     * ⚠ 工作区对象**没有** `attachSession` ⇒ 我们无法建立归属。
     *   ⛔ 不假装成功（那会建出"用户看不到、也不属于所选工作区"的会话）⇒ 回收并拒。
     */
    const back = await rollback(deps, createdRef, log)
    return {
      ok: false,
      rolledBack: back,
        ...(back ? { rollbackResidual: rollbackResidual(deps, createdRef.sessionId) } : {}),
      reason: '宿主工作区对象**没有 `attachSession`** ⇒ 无法建立归属，拒绝创建'
        + (back ? '，已撤销该会话' : '；⚠ 撤销失败，该会话可能仍在'),
      ...(back ? {} : { unsafe: true }),
    }
  }

  // ── ④ 立刻核"空白"（有 turn/start 就不是空白 ⇒ 拒并回收）───────────────
  const isBlank = (() => {
    try {
      const live = deps.sessionsOf()?.get(createdId)
      if (live === undefined) return false
      if (typeof live.snapshotEvents === 'function') {
        const evs = live.snapshotEvents()
        if (Array.isArray(evs)) return !evs.some((x: any) => x?.type === 'turn/start')
      }
      // ⚠ 判不出 ⇒ 按"不空白"处理（安全侧：不让一个可能已经开跑的会话拿策略）
      return false
    } catch { return false }
  })()
  if (!isBlank) {
    await rollback(deps, createdRef, log)
    return {
      ok: false, rolledBack: true,
      reason: '建出来的会话**不是空白的**（已有 turn/start 事件）⇒ 拒绝为它写策略并已回收'
        + '（⚠ 我们的接口只处理新建空白会话）',
    }
  }

  // ── ⑤ 写两值（⚠ **先写 pending**：未确认状态不生效，见 ⑥）──────────────
  /**
   * ⚠⚠ **为什么这里写 `pending` 而不是直接写用户的档位**（2026-10-22 关键改动）
   *
   *   上一版直接写 `t.level`（可能 `workspace` 高档）⇒ 在"写报成功但回读不符"
   *   那一格，盘上**可能已经是高档且可执行**。仅靠"事后隔离"治不了：隔离本身也会失败。
   *
   *   ⇒ 现在盘上先落 `activation:'pending'` ⇒ **解析期一律最低档 + 不推进**
   *     （`resolveSessionPolicy` 的 pending 分支）⇒ **写坏了也不可执行宽档**。
   *     只有 `activatePolicy()` **回读确认成功**之后，才变成 `active`。
   */
  const w = deps.setPolicy(createdId, t.level, t.workMode, 'pending')
  if (!w.ok) {
    const back = await rollback(deps, createdRef, log)
    const base = {
      ok: false, rolledBack: back,
        ...(back ? { rollbackResidual: rollbackResidual(deps, createdRef.sessionId) } : {}),
      reason: `策略写入失败（${w.reason}）⇒ 已尝试回收该空白会话`,
    }
    if (back) return base
    /**
     * ⚠ **"写返回失败"不等于"盘上没写"**（2026-10-22 修正）：
     *   写盘可能已经落了一半 / 落了但返回值丢了 ⇒ ⛔ 不许凭返回值断言"没有记录 ⇒ 恒最低档"。
     *   ⇒ 与第⑥支同款处理：**再读一次**，读到什么报什么；读不到写 `unknown`。
     */
    return { ...base, ...(await quarantineStranded(deps, createdId, log)) }
  }

  // ── ⑥ **回读确认**（⛔ 不拿 write 的返回值当成功）──────────────────────
  /**
   * ⚠⚠ **回读不一致 + 回收失败 = 最危险的那一格**（2026-10-22 修正任务书⑥）。
   *
   * ── 上一版在这里说错了什么 ──────────────────────────────────────────
   *   它无条件写 `orphan: { level: DEFAULT_PERMISSION_LEVEL }`，
   *   理由借的是"**没有策略记录**的会话恒按最低档"。⛔ 但这一支恰恰是
   *   **写进去了、只是回读对不上** —— 盘上**可能已经是高档**（写成功但读回不来，
   *   或写了一半）。⇒ 此时宣称"孤儿恒最低档"是**虚假安全结论**。
   *
   * ── 修法：按"我们到底能不能证明它是低档"分三档，⛔ 不许压成一句 ────────
   *   · **能撤销**（回收成功）⇒ `rolledBack: true`，会话没了，结论干净；
   *   · **撤不掉，但能读到它当前值** ⇒ 如实回 **`stranded`**：把**实际读到的值**
   *     报出去（可能是高档），并**明确标"该会话仍可执行"** ⇒ 让上层/用户知道要处理；
   *   · **撤不掉、也读不到** ⇒ 同样 `stranded`，但值写 `'unknown'`，
   *     ⛔ **不许**填 `DEFAULT_PERMISSION_LEVEL` 冒充"最低档"。
   *
   * ⚠ 三种都**不**返回 `ok: true`；⚠ 也**不**用 `orphan` 这个名字（它暗示"无害"）。
   */
  const readBack = deps.readPolicy(createdId)
  if (readBack === undefined || readBack.level !== t.level || readBack.workMode !== t.workMode) {
    const back = await rollback(deps, createdRef, log)
    const base = {
      ok: false,
      rolledBack: back,
        ...(back ? { rollbackResidual: rollbackResidual(deps, createdRef.sessionId) } : {}),
      reason: '写入后**回读不一致** ⇒ 视为失败（⛔ 不报成功）'
        + `（期望 ${t.level}/${t.workMode}，回读 ${readBack === undefined ? '无记录' : `${readBack.level}/${readBack.workMode}`}）`,
    }
    if (back) return base
    return { ...base, ...(await quarantineStranded(deps, createdId, log)) }
  }

  /**
   * ── ⑦ **确认生效**（⚠ 最后一道，也是唯一能把宽档变可执行的一步）───────────
   *
   * ⚠⚠ **为什么必须单独一步、并且在回读一致之后**（2026-10-22）
   *   ① 在它之前的任何失败都停在 `pending` ⇒ 解析期最低档 + 不推进
   *      ⇒ **不可执行宽档**（这才是"失败不留可执行宽档"的真落点，⛔ 不是报警）。
   *   ② 它自己也**回读确认**（`activateSessionPolicy` 内）：报成功但盘上仍 pending
   *      ⇒ 视为失败 ⇒ 走隔离/`unsafe`。
   *
   * ⚠ **最坏格的残余**（如实写在代码里，⛔ 不粉饰）：
   *   `activate()` 报成功但盘上其实已经 active 宽档、而回读又读成 pending
   *   ⇒ 我们以为失败、实际已生效。这一格只能靠 `quarantineSessionPolicy` 兜底；
   *   隔离也失败 ⇒ `unsafe: true` 并**明说无法证明**（见 `quarantineStranded`）。
   *   ⚠ 宿主**没有**会话销毁 API（`sessionController` 的方法表里无 delete/destroy，
   *     只有 cancel/rename/fork —— 2026-10-22 实测），⇒ "可靠撤销"这条路**不存在**，
   *     这就是为什么必须靠"顺序"而不是"撤销"。
   */
  if (typeof deps.activatePolicy !== 'function') {
    /**
     * ⚠ 没有激活能力 ⇒ 记录**永远停在 pending** ⇒ 该会话**不可用**（最低档且不推进）。
     *   ⚠ 这不是"成功"，但**也不是"留了可执行宽档"** ⇒ 回收它；
     *     回收失败也仍然安全（pending）。如实报"不可用"。
     */
    const back = await rollback(deps, createdRef, log)
    log('[create-channel] 无 activatePolicy ⇒ 策略停在 pending（不可执行宽档）')
    return {
      ok: false,
      rolledBack: back,
        ...(back ? { rollbackResidual: rollbackResidual(deps, createdRef.sessionId) } : {}),
      stranded: back ? undefined : { sessionId: createdId, level: t.level, workMode: t.workMode, executable: false },
      reason: '缺少"确认生效"能力 ⇒ 策略停在未确认状态（**读档恒最低、不推进**，'
        + '⛔ 不会按你选的档位执行）'
        + (back ? '，已回收空白会话' : `；会话 ${createdId} 仍存在但**不可执行**`),
      ...(back ? {} : { unsafe: false }),
    }
  }

  const act = (() => {
    try { return deps.activatePolicy!(createdId) } catch (e) {
      return { ok: false, reason: `激活抛错：${String((e as Error)?.message ?? e)}` }
    }
  })()
  if (!act.ok) {
    /**
     * ⚠ 激活失败 ⇒ 盘上**此刻仍应是 pending**（⇒ 安全）；但**不能假设**
     *   "它一定还是 pending"（写可能其实生效了）。⇒ 先回收，回收不掉就隔离，
     *   隔离结果如实报；并且**明确**：pending 语义本身已使它不可执行宽档。
     */
    const back = await rollback(deps, createdRef, log)
    const base = {
      ok: false,
      rolledBack: back,
        ...(back ? { rollbackResidual: rollbackResidual(deps, createdRef.sessionId) } : {}),
      reason: `策略**确认生效失败**（${act.reason}）`
        + (back ? '⇒ 已回收空白会话' : '⇒ 会话仍在，但其策略未被确认生效（读档恒最低、不推进）'),
    }
    if (back) return base
    // ⚠ 再确认一次盘上到底是不是 pending（决定我们敢不敢说"安全"）
    const now = deps.readPolicy(createdId)
    const stillPending = now === undefined || now.source === 'pending-activation' || now.source === 'no-identity'
    if (stillPending) {
      log(`[create-channel] 激活失败但记录仍在 pending（不可执行宽档）⇒ 安全侧成立`)
      return { ...base, unsafe: false }
    }
    return { ...base, ...(await quarantineStranded(deps, createdId, log)) }
  }

  log(`[create-channel] 已建空白 Hob 会话 ${createdId} 并**确认生效**策略 ${t.level}/${t.workMode}（两次回读确认）`)
  return { ok: true, sessionId: createdId, policyPersisted: true }
}

/**
 * ── **残留会话的持久隔离**（2026-10-22 · 治 `stranded` 只报不修）──────────────────
 *
 * **背景**：回收失败时盘上可能已经是**高档**记录。上一版只报
 *   `stranded{level:'workspace', executable:true}` —— ⚠ 报告不是修复，那个会话
 *   仍然能按高档读、按 auto 派活，**重载后也照样**。
 *
 * **本函数做三件事**：
 *   ① 调 `deps.quarantinePolicy` 把记录**标记作废并落盘**；
 *   ② **回读确认**（由 `quarantinePolicy` 自己回读 `quarantined===true`）；
 *   ③ 按结果给 `quarantine` / `unsafe` / 可读原因。
 *
 * ⚠ **隔离失败 = 无法安全交付** ⇒ `unsafe: true`，⛔ 不许降级成"已处理"。
 * ⚠ `deps.quarantinePolicy` 缺席也算失败（⛔ 不假装隔离）。
 */
async function quarantineStranded(
  deps: CreateDeps, createdId: string, log: (m: string) => void,
): Promise<Pick<CreateResult, 'stranded' | 'quarantine' | 'unsafe' | 'reason'>> {
  // 先读一次盘上现值（用于如实报 stranded 的 level/workMode）
  const before = deps.readPolicy(createdId)
  const level = before !== undefined && before.level !== '' ? before.level : 'unknown'
  const workMode = before !== undefined && before.workMode !== '' ? before.workMode : 'unknown'

  if (typeof deps.quarantinePolicy !== 'function') {
    log('[create-channel] 无法隔离残留会话：deps.quarantinePolicy 缺席')
    return {
      stranded: { sessionId: createdId, level, workMode, executable: true },
      quarantine: { ok: false, reason: '隔离能力缺席（`deps.quarantinePolicy` 未提供）' },
      unsafe: true,
      reason: `；⚠ **回收失败且无法隔离**：该会话可能按 ${level} 档执行，`
        + '重载后仍可能如此 ⇒ **无法安全交付**（⛔ 不宣称已隔离）',
    }
  }

  const q = (() => {
    try { return deps.quarantinePolicy!(createdId) } catch (e) {
      return { ok: false, reason: `隔离抛错：${String((e as Error)?.message ?? e)}` }
    }
  })()

  if (!q.ok) {
    log(`[create-channel] 隔离失败：${q.reason}`)
    /**
     * ⚠⚠ **隔离失败 ≠ 一定可执行**（2026-10-22 修正）：
     *   本版创建链**先写 `pending`** ⇒ 只要记录还没被 `activate`，
     *   解析期就是**最低档 + 不推进** ⇒ 即使隔离失败也**不可执行宽档**。
     *   ⛔ 上一版无条件写 `executable:true` 是**与事实不符**（实测：重载后解析为 ledger），
     *   而"多报风险"同样是有害的：它会让上层以为必须人工删会话。
     *   ⇒ 现在**读一次解析读数**（`source`）来判断：
     *     · `pending-activation` / `quarantined` / `no-identity` ⇒ **不可执行**（安全侧成立）；
     *     · 其它（`stored` 且档位不是最低）⇒ **可执行**（老实说 true）。
     *   ⚠ 判不出来（`readPolicy` 返回 undefined）⇒ **按可执行算**（安全侧默认从严）。
     */
    const now = deps.readPolicy(createdId)
    const pendingish = now !== undefined
      && (now.source === 'pending-activation' || now.source === 'quarantined' || now.source === 'no-identity')
    const pendingLevel = pendingish && now !== undefined ? now.level : level
    if (pendingish) {
      return {
        stranded: { sessionId: createdId, level: pendingLevel, workMode, executable: false },
        quarantine: q,
        unsafe: false,
        reason: `；⚠ 回收失败、隔离也失败（${q.reason}），但该会话策略**仍是未确认状态**`
          + '⇒ 读档恒最低、**不推进**，⛔ 不可按宽档执行（隔离失败不致危险）',
      }
    }
    return {
      stranded: { sessionId: createdId, level, workMode, executable: true },
      quarantine: q,
      unsafe: true,
      reason: `；⚠ **回收失败且隔离也失败**（${q.reason}）`
        + ` —— 该会话的策略**已不是未确认状态**，可能按 ${level} 档执行、重载后仍可能如此`
        + ' ⇒ **无法安全交付**（⛔ 不许称"残留已隔离"）',
    }
  }

  /**
   * ⚠ 隔离成功 ⇒ 该会话**在解析层**恒为最低档 + `mayProceed=false`，
   *   且标记**已落盘**（`quarantinePolicy` 回读确认过）⇒ 重载后仍然生效。
   *   此时 `stranded.executable` 可以如实写 **false** ——
   *   这不是"我们乐观"，而是"持久标记 + 解析期硬降"共同保证的。
   */
  log(`[create-channel] 残留会话 ${createdId} 已持久隔离（重载后仍为最低档、不推进）`)
  return {
    stranded: { sessionId: createdId, level, workMode, executable: false },
    quarantine: { ok: true, reason: '' },
    unsafe: false,
    reason: `；⚠ 回收失败，但该会话的策略**已持久隔离**（原档位 ${level} 已作废）`
      + '⇒ 读档恒最低、且**不推进**；标记随记录落盘，重启/重载后仍生效。',
  }
}

/** 回收一个空白会话（⚠ 失败返回 false，由调用方如实报 `stranded` —— ⛔ 不是"orphan 恒最低档"）。 */
async function rollback(
  deps: CreateDeps,
  created: { sessionId: string; handle?: any },
  log: (m: string) => void,
): Promise<boolean> {
  const sessionId = created.sessionId
  const handle = created.handle
  /**
   * ⚠⚠ **两层回收**（2026-10-22 重写：上一版必失败）
   *
   * ── 第一层：`AgentHandle.dispose()`（官方、唯一受支持的"撤活会话"）────────
   *   必须先 `await`（它是 async：停 loop → 等退出 → 反注册 → 解作用域）。
   *   ⛔ **不再**去 `sessions.get(id).dispose` —— 宿主 `Session` 类型没有那个方法
   *   （上一版就是这样"永远 return false"，本轮修的就是它）。
   *
   * ── 第二层：核**活表**真的没它了 ─────────────────────────────────────
   *   ⚠ `dispose()` 返回不代表已消失：还要 `sessions.get(id) === undefined`。
   *   ⛔ 单看这一条**不算证明**（磁盘文件可能复活）⇒ 见 `rollbackResidual`。
   */
  /**
   * ⚠⚠ **顺序不可换：先持久禁用，再撤活会话**（2026-10-22 · 本单核心）
   *
   *   ① **持久禁用**（`persistentlyDisable`）：让这个 id 在**磁盘层面**不可执行 ——
   *      · 首选 `policy quarantine`（写策略文件，`quarantined:true`）；
   *      · 失败则 `workspaceRegistry.archiveSession(id, { stopActivity: true })`
   *        并**读回** `archivedSessionIds` 确认它在里面。
   *   ② **确认其中一个真的成立**（读回，⛔ 不信返回值）。
   *   ③ **然后**才 `await handle.dispose()`。
   *
   *   ⚠ 为什么不能反：先 dispose 再禁 ⇒ 中间那一小段里"磁盘会话 + 高档记录"是**可执行的**
   *     （恰好是本单要消灭的那一格）。先禁用则任何时刻都不存在"可执行的高档磁盘会话"。
   *   ⚠ `dispose()` 成功**也不能**跳过 ①：JSONL 仍在磁盘（上一轮实测验明）。
   */
  const disable = await persistentlyDisable(deps, sessionId, log)

  /**
   * ⚠⚠ **双失败时仍然要撤活会话**（2026-10-22 第 13 轮 · 修上一轮留下的缺口）
   *
   * ── 上一轮错在哪 ────────────────────────────────────────────────────
   *   持久禁用两种都失败时**提前 `return false`** ⇒ ⛔ **根本没调 `handle.dispose()`**
   *   ⇒ 那个 `active:workspace` 的新会话**在**当前**进程的活表里继续存在**
   *   （能收消息、能发首轮、能跑 step —— 因为 pre-step 拦的是 archived，它没被归档）。
   *   ⚠ "磁盘重载后可能复活"与"**现在**就能执行"是**两件事**，上一轮只防了前者。
   *
   * ── 现在 ──────────────────────────────────────────────────────────
   *   **无论禁用成没成**，都尽力 `await handle.dispose()` 并核活表：
   *     · 撤下了 ⇒ 当下**进程内**不可执行（但仍 `unsafe`，因为磁盘重载风险未消）；
   *     · 撤不下 ⇒ 更要 `unsafe`，并**另报**"活表仍可执行"。
   *   ⛔ **不许**因为"当下撤了"就报 `rolledBack=true` / `safe`：
   *     磁盘上那条 active 记录重启后仍可能复活。
   */
  const disposeOutcome = await disposeHandle(deps, handle, sessionId, log)

  if (!disable.ok) {
    /**
     * ⚠ 双失败 ⇒ **一定** `false`（调用方据此 `unsafe:true` / `rolledBack:false`）。
     *   ⚠ 但我们已经**尽力撤了活会话** —— 这两件事要分开说。
     */
    log(
      `[create-channel] ⚠ 持久禁用**两种都失败**（${disable.detail}）；`
      + `已尽力撤活会话：${disposeOutcome.detail}`,
    )
    return false
  }

  if (handle === undefined) {
    log(`[create-channel] 无 handle ⇒ 已持久禁用（${disable.kind}），活会话无从撤起`)
    return true
  }
  if (disposeOutcome.ok) return true
  /**
   * ⚠ 禁用**已成立**、但 dispose 没成 ⇒ 磁盘层面仍不可执行宽档
   *   ⇒ 回收算"部分成功"（⛔ 不标 unsafe，因为那不是"可执行高档残留"），但日志说清。
   */
  log(`[create-channel] handle.dispose() 未完成（⚠ 持久禁用已成立 ⇒ 仍不可执行宽档）：`
    + disposeOutcome.detail)
  return true
  /**
   * ⚠⚠ **必须如实告知的残余**（2026-10-22 实测，⛔ 不粉饰）：
   *   `dispose()` **不删除磁盘会话文件** ——
   *     · `SessionPersistence` 接口**没有** delete/remove；
   *     · `agent-loop` 的 `teardown()` 只 `handle?.close()`（释放写所有权）；
   *     · jsonl 后端的每个 `rm(` 都只清 staging/tmp。
   *   ⇒ 重载后该会话**仍会被 `list()` 读到**（`workspace.sessionIds` 按 canonical-cwd
   *     header 索引过滤，而 header 在磁盘上）。
   *   ⇒ 我们能保证的只有：**它不再是活会话、不能发首轮、不在活表**；
   *     ⚠ **不能**保证"磁盘上从此没有它"。⇒ 这一点在返回值与报告里都要写明。
   */
  /**
   * ⚠ 把**两层事实**都记进日志（⛔ 不合成一句"已回收"）：
   *   ① 活会话已撤（活表无它、不能发首轮）；
   *   ② 磁盘会话文件仍在（宿主无删除 API；重载后 `list()` 仍能读到）。
   */
  log(
    `[create-channel] 已撤**活会话** ${sessionId}（活表无它）；`
    + '⚠ 磁盘会话文件**仍存在**（`SessionPersistence` 无 delete/remove、'
    + '`teardown` 只 close 句柄）⇒ 重载后它仍会被 `list()` 读到',
  )
  return true
}



/**
 * ── **尽力撤活会话**（2026-10-22 第 13 轮）：`await handle.dispose()` + 核活表 ─────────
 *
 * ⚠ 为什么单独一个函数：**"持久禁用"（磁盘）与"撤活会话"（当前进程）是两件事**，
 *   上一轮把它们混成一个 `if (!disable.ok) return false` ⇒ 双失败时**根本没撤活会话**
 *   ⇒ 那个会话在当前进程里仍然能收消息、发首轮、跑 step。
 *
 * ⚠ 本函数**只动传入的 handle**（就是本次创建持有的那一个）⇒ ⛔ 不碰别人的会话。
 * ⚠ 它**不判断安全性**：`ok:true` 只表示"活表里已经没有它"，
 *   ⚠ **不代表**磁盘上没有（`SessionPersistence` 无 delete/remove）。
 *
 * @returns `{ ok, live, detail }`：
 *   · `ok` —— dispose 未抛错且活表已无该 id；
 *   · `live` —— 活表里现在**是否还有**它（判不出 ⇒ 按 `true`，安全侧从严）；
 *   · `detail` —— 可读结果（写进日志/诊断）。
 */
async function disposeHandle(
  deps: CreateDeps, handle: any, sessionId: string, log: (m: string) => void,
): Promise<{ ok: boolean; live: boolean; detail: string }> {
  if (handle === undefined || typeof handle.dispose !== 'function') {
    let live = true
    try { live = deps.sessionsOf()?.get(sessionId) !== undefined } catch { live = true }
    return {
      ok: false, live,
      detail: '没有可用 handle ⇒ **未能撤活会话**'
        + (live ? '（活表里仍有它）' : '（⚠ 但活表里已无它）'),
    }
  }
  let disposeThrew: string | undefined
  try {
    await handle.dispose()
  } catch (e) {
    disposeThrew = String((e as Error)?.message ?? e)
  }
  // ⚠ 无论 dispose 抛没抛，都**核活表**（抛错不代表没撤成；成功也不代表撤下了）
  let live = true
  try { live = deps.sessionsOf()?.get(sessionId) !== undefined } catch { live = true }
  if (!live) {
    log(`[create-channel] 已撤**活会话** ${sessionId}`
      + (disposeThrew === undefined ? '' : `（⚠ dispose 报错但活表已清：${disposeThrew}）`))
    return {
      ok: true, live: false,
      detail: disposeThrew === undefined
        ? '活表已无它'
        : `活表已无它（dispose 报错：${disposeThrew}）`,
    }
  }
  log(`[create-channel] ⚠ **活表里仍有** ${sessionId}`
    + (disposeThrew === undefined ? '（dispose 未抛错却没撤下）' : `（dispose 报错：${disposeThrew}）`))
  return {
    ok: false, live: true,
    detail: disposeThrew === undefined
      ? 'dispose 返回了但**活表仍有它** ⇒ 当前进程内**仍可执行**'
      : `dispose 抛错（${disposeThrew}）且**活表仍有它** ⇒ 当前进程内**仍可执行**`,
  }
}

/**
 * ── **持久禁用**：让一个会话 id 在**磁盘层面**不可执行（2026-10-22 · 本单核心）──────
 *
 * **两层，按可靠性递减，且都必须"读回确认"**（⛔ 不信返回值）：
 *   ① `policy quarantine` —— 策略文件里 `quarantined:true` ⇒ 解析期最低档 + 不推进；
 *   ② `workspaceRegistry.archiveSession(id, {stopActivity:true})` ⇒ 持久归档集合 ⇒
 *      解析期（本插件）最低档，且宿主 `agent/pre-step` 直接 reject（第二层）。
 *
 * ⚠ **为什么两层都要**：
 *   · ① 只挡**本插件**的策略解析；若宿主别处直接读 policy.json，仍可能看到原档位。
 *   · ② 挡**宿主的 step**（`ArchivedSessionGate`），但若本插件策略解析不看归档，
 *     四个读工具仍会按 policy.json 给高档 ⇒ 所以**本插件必须也读归档**（见策略服务）。
 *   ⇒ 两层合起来才既挡"读"又挡"跑"。
 *
 * ⚠ **顺序**：quarantine 先（更精准、只影响这一会话的策略），
 *   失败才 archive（更粗、但宿主官方保证持久 + pre-step 拒）。
 *
 * @returns `{ ok, kind, detail }`：
 *   · `kind:'quarantine'` / `'archive'` ⇒ 已读回确认的**那一种**；
 *   · `ok:false` ⇒ **两种都失败** ⇒ 调用方必须 `unsafe`（⛔ 不许说安全）。
 */
async function persistentlyDisable(
  deps: CreateDeps, sessionId: string, log: (m: string) => void,
): Promise<{ ok: boolean; kind: 'quarantine' | 'archive' | 'none'; detail: string }> {
  // ── ① policy quarantine ────────────────────────────────────────────────
  if (typeof deps.quarantinePolicy === 'function') {
    let q: { ok: boolean; reason: string }
    try { q = deps.quarantinePolicy(sessionId) } catch (e) {
      q = { ok: false, reason: `quarantine 抛错：${String((e as Error)?.message ?? e)}` }
    }
    if (q.ok) {
      /**
       * ⚠⚠ **读回确认必须是"它真的被隔离了"**（2026-10-24 收紧 · 原判据太宽）。
       *
       * ── 改前写的是什么、为什么会把假成功当真 ──────────────────────────
       *   `back.source === 'quarantined' || back.level === 'ledger'`
       *   ⚠ 后半句意味着：**任何**读档为 `ledger` 的记录都算"已确认隔离"。
       *   而"没有记录 / 新会话未选档 / 旧会话迁移 / 归档 / 无身份 / 坏文件"这些分支
       *   **全都**返回 `level === 'ledger'` ⇒ 只要 `quarantinePolicy` 报了 ok（哪怕它
       *   实际什么都没写成、或写到了别的工作区文件里），这里就会认定"已持久禁用"
       *   ⇒ 上层不再尝试归档兜底 ⇒ **假安全**（真正那条记录可能还是 workspace 档）。
       *
       * ── 现在 ──────────────────────────────────────────────────────────
       *   只认 `source === 'quarantined'` —— 那是 `resolveSessionPolicy` 里
       *   **唯一**表示"这条记录存在但已作废"的读数（`quarantined:true` 命中）。
       *   ⚠ 另外把"不能推进"（`mayProceed === false`）也一并要求：
       *     `quarantined` 分支本来就恒 `mayProceed=false`，这是**防读数被替换**的第二层，
       *     ⛔ 不是新语义。⚠ `readPolicy` 的返回类型只声明了 level/workMode/source，
       *     所以这里按 `any` 取可选字段（缺字段 ⇒ 该条不满足，仍会走归档兜底，安全侧）。
       */
      const back = deps.readPolicy(sessionId) as
        | { level: string; workMode: string; source: string; mayProceed?: boolean }
        | undefined
      const confirmed = back !== undefined
        && back.source === 'quarantined'
        && back.level === 'ledger'
        && back.mayProceed !== true
      if (confirmed) {
        log(`[create-channel] 持久禁用 = 策略隔离（读回确认 source=${back?.source}）`)
        return { ok: true, kind: 'quarantine', detail: '' }
      }
      /**
       * ⚠ 读回**不是** `quarantined` ⇒ 如实说明它是哪种读数，然后**继续尝试归档兜底**
       *   （⛔ 不要在这里返回成功；归档是更强、宿主级的那一层）。
       */
      log(`[create-channel] quarantine 报成功但**读回未确认隔离**`
        + `（source=${back?.source ?? '(读不到)'} · level=${back?.level ?? '(读不到)'}`
        + ` · mayProceed=${String(back?.mayProceed)}）⇒ 继续尝试归档`)
    } else {
      log(`[create-channel] 策略隔离失败（${q.reason}），改试宿主归档`)
    }
  }

  // ── ② 宿主持久归档 ────────────────────────────────────────────────────
  const reg = deps.archiveOf()
  if (reg === undefined || typeof reg.archiveSession !== 'function') {
    return {
      ok: false, kind: 'none',
      detail: '策略隔离失败，且 `workspaceRegistry.archiveSession` 不可用 ⇒ **无法持久禁用**',
    }
  }
  try {
    /**
     * ⚠ `stopActivity: true` 是官方语义：**先写归档集合、再请求停活**
     *   （"the durable archive set is what a provider's `agent/pre-step` gate reads,
     *     so every wake the stops induce is already blocked"）
     *   ⇒ 不会出现"停在写之前"的窗口。
     */
    await reg.archiveSession(sessionId, { stopActivity: true })
  } catch (e) {
    return {
      ok: false, kind: 'none',
      detail: `策略隔离失败，且归档抛错：${String((e as Error)?.message ?? e)}`,
    }
  }
  // ⚠ **读回确认归档集合里真的有它**（⛔ 不信 await 返回）
  let archived = false
  try {
    const ids = reg.archivedSessionIds
    archived = Array.isArray(ids) && ids.includes(sessionId)
  } catch { archived = false }
  if (!archived) {
    return {
      ok: false, kind: 'none',
      detail: '归档调用返回了，但 **`archivedSessionIds` 里读不到该 id** ⇒ 视为失败（⛔ 不宣称已归档）',
    }
  }
  log('[create-channel] 持久禁用 = 宿主归档（已读回 `archivedSessionIds` 确认）')
  return { ok: true, kind: 'archive', detail: '' }
}

/**
 * ⚠ **回收后的磁盘残余**（2026-10-22）：`dispose()` 撤不掉的那部分。
 *
 * 为什么单独一个函数：**"撤活会话"与"删磁盘文件"是两件不同的事**，
 * 上一版把两者混成一句"回滚"⇒ 报告里就变成了不实的"已回收"。
 * ⚠ 本函数**只读**，不删任何文件（⛔ 宿主没有受支持的删除 API，本插件不手工改 store）。
 *
 * @returns `{ live, onDisk }` —— 两个独立事实，调用方**必须分开报**。
 */
function rollbackResidual(deps: CreateDeps, sessionId: string): { live: boolean; onDisk: boolean } {
  let live = true
  try { live = deps.sessionsOf()?.get(sessionId) !== undefined } catch { live = true }
  return { live, onDisk: true }
}

/**
 * 安装：登记本插件自己的创建路由。
 *
 * ⚠ **只在 `connection` 服务存在时登记**（反应式 inject）——
 *   缺它 ⇒ 不登记、不报错，插件其余部分照常（与 `bus.ts` 的纪律一致）。
 *   ⚠ 鉴权/跨站**由宿主 `connection.fetch.register` 的栅栏保证**，
 *     本模块**不做**第二套（重复实现 = 另一份会漂的东西）。
 */
export function installCreateChannel(ctx: Context): void {
  const hostCtx = ctx as any
  const store = createTicketStore()

  const deps: CreateDeps = {
    sessionsOf: () => {
      try { return hostCtx.get?.('sessions') ?? hostCtx.sessions } catch { return undefined }
    },
    controllerOf: () => {
      try { return hostCtx.get?.('sessionController') ?? hostCtx.sessionController } catch { return undefined }
    },
    /**
     * ⚠ **宿主 `ctx.agents`**：本模块建会话**只用它**（因为只有它能给 handle）。
     *   ⚠ 取不到 ⇒ 创建链拒绝创建（⛔ 不退回"建了撤不掉"的旧路径）。
     */
    agentsOf: () => {
      try { return hostCtx.get?.('agents') ?? hostCtx.agents } catch { return undefined }
    },
    /**
     * ⚠ **宿主持久归档**：`workspaceRegistry`（同一服务，`archiveSession` 在它上面）。
     *   ⚠ 取不到 ⇒ `persistentlyDisable` 只剩 quarantine 一层 ⇒ 双失败时会 `unsafe`。
     */
    archiveOf: () => {
      try { return hostCtx.get?.('workspaceRegistry') ?? hostCtx.workspaceRegistry } catch { return undefined }
    },
    workspacesOf: () => {
      try { return hostCtx.get?.('workspaceRegistry') ?? hostCtx.workspaceRegistry } catch { return undefined }
    },
    setPolicy: (sessionId, level, workMode, activation) => {
      try {
        const svc = hostCtx.get?.(SESSION_POLICY_SERVICE) ?? hostCtx[SESSION_POLICY_SERVICE]
        if (typeof svc?.set !== 'function') return { ok: false, reason: '逐会话策略服务缺席 ⇒ 无法写入（⛔ 不降级）' }
        return svc.set(sessionId, level, workMode, activation)
      } catch (e) {
        return { ok: false, reason: `策略写入抛错：${String((e as Error)?.message ?? e)}` }
      }
    },
    /** ⚠ **确认生效**：走策略服务的 `activate`（缺方法 ⇒ 失败，⛔ 不假装生效）。 */
    activatePolicy: (sessionId) => {
      try {
        const svc = hostCtx.get?.(SESSION_POLICY_SERVICE) ?? hostCtx[SESSION_POLICY_SERVICE]
        if (typeof svc?.activate !== 'function') {
          return { ok: false, reason: '逐会话策略服务未提供 activate() ⇒ 无法确认生效（⛔ 不降级）' }
        }
        return svc.activate(sessionId)
      } catch (e) {
        return { ok: false, reason: `激活抛错：${String((e as Error)?.message ?? e)}` }
      }
    },
    readPolicy: (sessionId) => {
      try {
        const svc = hostCtx.get?.(SESSION_POLICY_SERVICE) ?? hostCtx[SESSION_POLICY_SERVICE]
        if (typeof svc?.get !== 'function') return undefined
        const live = hostCtx.get?.('sessions')?.get?.(sessionId)
        if (live === undefined) return undefined
        const v = svc.get(live)
        /**
         * ⚠ 2026-10-24：一并带出 `mayProceed`（隔离读回确认要用它）。
         *   ⚠ 只在**确实是布尔**时才带 —— ⛔ 不用 `Boolean(...)`（缺字段会被当成 false，
         *     那会让"读数没有这个字段"看起来像"确定不能推进"）。
         */
        return {
          level: String(v?.level ?? ''),
          workMode: String(v?.workMode ?? ''),
          source: String(v?.source ?? ''),
          ...(typeof v?.mayProceed === 'boolean' ? { mayProceed: v.mayProceed } : {}),
        }
      } catch { return undefined }
    },
    /**
     * ⚠ **持久隔离**：走策略服务的 `quarantine`。
     *   ⚠ 服务缺席 / 方法缺席 ⇒ 返回失败（⛔ 不假装隔离成功）。
     */
    quarantinePolicy: (sessionId) => {
      try {
        const svc = hostCtx.get?.(SESSION_POLICY_SERVICE) ?? hostCtx[SESSION_POLICY_SERVICE]
        if (typeof svc?.quarantine !== 'function') {
          return { ok: false, reason: '逐会话策略服务未提供 quarantine() ⇒ 无法持久隔离（⛔ 不降级）' }
        }
        return svc.quarantine(sessionId)
      } catch (e) {
        return { ok: false, reason: `隔离抛错：${String((e as Error)?.message ?? e)}` }
      }
    },
    log: (m) => { try { hostCtx.logger?.debug?.(m) } catch { /* 忽略 */ } },
  }

  ctx.inject(['connection', 'sessions'], (svcCtx: any) => {
    try {
      const conn = svcCtx.get?.('connection') ?? svcCtx.connection
      const fetch = conn?.fetch
      if (fetch === undefined || typeof fetch.register !== 'function') {
        hostCtx.logger?.warn?.('[dsh-hob] 宿主 `connection.fetch` 不可用 ⇒ 新建弹窗的建会话通道**未登记**')
        return
      }
      const disposer = fetch.register({
        path: CREATE_CHANNEL_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request: any) => {
          // ⚠ 鉴权与跨站**已在宿主栅栏里做过**（未认证 401 / 跨站 403），此处只处理业务。
          let body: any
          try {
            const text = typeof request.text === 'function' ? await request.text() : ''
            body = JSON.parse(text === '' ? '{}' : text)
          } catch {
            return json(400, { ok: false, reason: '请求体不是 JSON' })
          }
          const action = String(body?.action ?? '')
          if (action === 'issue') {
            // ⚠ 签发票据：⚠ 这里**不**建会话，只把"用户本次选择 + 预分配 id"钉进一次性票据
            const r = store.issue({
              sessionId: String(body?.sessionId ?? ''),
              level: String(body?.level ?? ''),
              workMode: String(body?.workMode ?? ''),
              // ⚠ 工作区归属由请求方**显式**给出（UI 取用户当前/显式选中的已登记工作区）；
              //   ⛔ 服务端**不**用注册表第一项替它猜（见 issue() 的拒绝分支）
              workspaceId: String(body?.workspaceId ?? ''),
            })
            return r.ok ? json(200, { ok: true, ticket: r.ticket, expiresAt: r.expiresAt }) : json(400, { ok: false, reason: r.reason })
          }
          if (action === 'create') {
            const r = await createHobSession(deps, store, {
              ticket: String(body?.ticket ?? ''),
              sessionId: String(body?.sessionId ?? ''),
            })
            return json(r.ok ? 200 : 409, r)
          }
          if (action === 'enums') {
            /**
             * ⚠ 枚举**同源**下发（⛔ 不让 UI 侧再抄一份清单）。
             * ⚠ 2026-10-22 增补：**同时下发已登记工作区清单** ——
             *   宿主**没有**可信的"当前工作区"读取服务（`uiWorkspace` 的
             *   `mainReference` 不对外），⇒ 弹窗让用户**显式选一个已登记的**。
             *   ⚠ 这里只给"有哪些可选"，⛔ 不给"推荐哪个/第一个就是当前"。
             */
            let workspaces: Array<{ id: string; label: string }> = []
            let workspacesUnavailable = ''
            try {
              const ws = deps.workspacesOf()
              const list = typeof ws?.list === 'function' ? ws.list() : undefined
              if (Array.isArray(list)) {
                workspaces = list
                  .filter((w: any) => typeof w?.id === 'string' && w.id !== '')
                  .map((w: any) => ({
                    id: w.id,
                    // ⚠ 只**显示**用；派不上就退回 id（⛔ 不编名字）
                    label: typeof w?.title === 'string' && w.title !== '' ? w.title : String(w.id),
                  }))
              } else {
                workspacesUnavailable = '宿主工作区注册表不可用'
              }
            } catch (e) {
              workspacesUnavailable = `读取工作区注册表失败：${String((e as Error)?.message ?? e)}`
            }
            return json(200, {
              ok: true,
              /**
               * ⚠⚠ **两件事分开下发**（2026-10-22 · 用户裁定「安全优先」+ 就地纠正）：
               *   · `levels`     = **可读范围要呈现的三项**（全枚举）—— 用户要看见另两档**存在**；
               *   · `openLevels` = 其中**当前真正可选**的档（= 开放面，只含账本权限）。
               *   ⇒ 界面按 `levels` 渲染三项、按 `openLevels` 把未开放的**置灰 + 标注「暂未开放」**。
               *
               * ── 为什么不是"干脆只下发一档"（纠正后改回三档呈现的理由）────────────────
               *   只画一项时用户**看不到另两档存在**，会以为功能丢了；而"看得见但点不了 +
               *   写明暂未开放"既诚实又不误导。⚠ **但置灰绝不是校验** ——
               *   宽档一律由 `issue()` / `createHobSession()` / `hob_spawn` 三处服务端拒
               *   （见 `shared/read-level-policy.ts`）。
               *   ⚠ 开放面只在**一处**声明，本处只转发，⛔ 不另写白名单。
               */
              levels: PERMISSION_LEVELS,
              openLevels: OPEN_READ_LEVELS,
              modes: WORK_MODE_VALUES,
              floorLevel: DEFAULT_PERMISSION_LEVEL,
              defaultMode: DEFAULT_WORK_MODE,
              /** ⚠ 用户可见的原因说明（中文、无 markdown 标记、⛔ 不出现内部配置值）。 */
              levelsNote: OPEN_READ_LEVELS_NOTE,
              preset: PLANNING_PRESET_ID,
              workspaces,
              ...(workspacesUnavailable === '' ? {} : { workspacesUnavailable }),
            })
          }
          return json(400, { ok: false, reason: `未知 action ${JSON.stringify(action)}` })
        },
      })
      ctx.effect(() => () => { try { disposer?.() } catch { /* 忽略 */ } }, 'dsh-hob: create channel')
      hostCtx.logger?.info?.(`[dsh-hob] 新建 Hob 会话通道已登记：POST ${CREATE_CHANNEL_PATH}（鉴权/跨站由宿主栅栏保证）`)
    } catch (e) {
      hostCtx.logger?.warn?.(`[dsh-hob] 创建通道登记失败：${String((e as Error)?.message ?? e)}`)
    }
  })
}

/**
 * 小工具：统一 JSON 响应（⚠ 不引宿主私有类型，保持可离线机检）。
 *
 * ⚠⚠ **必须返回真 `Response`**（2026-10-29 · 第 332 轮 · 包 N · `CHG-212`）。
 *   改前返回普通对象（`{ status, headers: {…}, body: string }`），而宿主契约是
 *   `dsh-client-connection/lib/types/rpc.d.ts:131`
 *   `readonly fetch: (request: Request) => Promise<Response>;`
 *   且宿主直接 `response.headers.entries()`（同包 `lib/index.js:88-90`）
 *   ⇒ 普通对象没有 `.headers.entries` ⇒ `TypeError` ⇒ `dsh-host-webserver/lib/index.js:397-405`
 *     兜成 **400 空包** ⇒ `action:'enums'`（新建弹窗的选项枚举）**整条死**。
 *   ⚠ 实测（改前）：真机 `POST /api/dsh-hob/session-create` `{"action":"enums"}` 带 cookie
 *     ⇒ **400 / 0 字节 / 无 content-type**。
 *   ⚠ 状态码语义与字段名**一个都没动**（`issue`/`create`/`enums` 的出参形状不变）。
 *   ⚠ 显式写 `content-type` 带 `charset=utf-8`（与改前逐字一致；`Response.json` 的缺省不带）。
 *   ⚠ 不设 CORS 头：跨站栅栏由宿主 `connection` 的 trust/origin fence 负责。
 */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
