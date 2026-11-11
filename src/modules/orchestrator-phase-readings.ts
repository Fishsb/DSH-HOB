/**
 * 编排器的**无状态读数**：从盘上读派发回执、判断某条轨是否已收口。
 *
 * ── 为什么单独成文件（2026-11-11 · 架构健康化）────────────────────────────
 *   `src/modules/orchestrator.ts` 里 `apply(ctx)` 的闭包占全文件 60%（6806 行 / 92 个声明），
 *   ⇒ 「想确认某个读数怎么来的」必须在一个 6806 行的闭包里翻。
 *
 *   这里挑出来的是**最干净的一档**：它们**不碰闭包里的任何可变状态**
 *   （`watches` / `lastStatus` / `stoppedOwners` … 一个都不用），
 *   只依赖模块级导入 ⇒ 移动是**行为等价**的，不需要先改 data flow。
 *
 *   ⚠ 这正是拆分该有的起点：先搬「零共享状态」的，再谈「解共享状态」的。
 *     后者（`watches` 被 84 处引用）是行为等价性重构，风险完全不同档。
 *
 * ⚠ 本文件**只放纯读数**：给定入参必得同一结果（唯一的"副作用"是读盘）。
 *   ⛔ 不要往这里加任何写盘 / 定时器 / 闭包状态 —— 那会把本文件的定位毁掉。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readOrchState, orchStateFileOf, clarifySectionOf, type PersistedHandoff, type PersistedWatch } from '../server/orch-state.ts'
import { planModeOf, type WorkPlan, type WorkTrackState, type WorkPlanSerialization, type WorkPlanProgress, type WorkPlanSummary } from '../shared/work-plan.ts'
import type { WorkMode } from '../shared/work-mode.ts'
import { listClosedWorkPlans } from '../server/work-plan-state.ts'

/**
 * ⚠⚠ **刻意不 import `orchestrator.ts` 的类型**（2026-11-11 · 防环）：
 *   本文件要被 `orchestrator.ts` 引用 ⇒ 反向 import 它的类型会立刻形成一个环，
 *   而 `check:architecture` 的 B 组**连 type 环也禁**（类型环同样让分层失真）。
 *
 *   ⇒ 用**结构化最小形状**：只声明本函数真正读的字段。
 *     好处是它同时说明了「这个读数到底依赖什么」，比 import 一个大 interface 更清楚。
 */
/** 本函数只读计划的 `createdAt`。 */
export interface PlanLike { createdAt: number }
/** 本函数只读轨道的 `sessionId` / `taskId`。 */
export interface TrackLike { sessionId: string; taskId?: string }

/**
 * 本机全部运行态文件里的**派发回执**，按时间倒序（最近的在前）。
 *
 * ── 为什么按时间倒序 ─────────────────────────────────────────────────
 *   最近的漏派最要紧 —— 读的人先看到的是「最该处理的那条」。
 *
 * ⚠ **读不到就当空**（不是报错）：某个运行态文件坏掉，不该让整份读数为空；
 *   但注意这与 `reachabilityFor` 的严格相反 —— 后者**必须**把「够不到」报出来，
 *   ⛔ 因为那正是它要治的形态（详见 orchestrator 里 `reachabilityFor` 的注释）。
 *
 * @param stateFiles - 运行态文件清单（调用方给，⚠ 本函数**不自己扫目录**）。
 */
export function readHandoffsAt(stateFiles: readonly string[]): PersistedHandoff[] {
  const out: PersistedHandoff[] = []
  try {
    for (const file of stateFiles) out.push(...readOrchState(file).handoffs)
  } catch { /* 读不到就当空 */ }
  /** 新的在前（最近的漏派最要紧）。 */
  return out.sort((a, b) => b.at - a.at)
}

/**
 * 某条轨**是否已被收口**：在 `closed` 记录里找一条同时满足三个条件的。
 *
 * ```
 * ① 目标会话相同
 * ② 任务相同（记录没写 task ⇒ 视为匹配任意任务）
 * ③ 收口时刻 >= 计划创建时刻（⚠ 早于计划的收口属于上一轮，不算）
 * ```
 *
 * @returns 命中的收口记录；没有 / 读盘失败 ⇒ `undefined`（⛔ 不猜"已收口"）。
 */
export function closedForTrackAt(
  ledgerRoot: string,
  plan: PlanLike,
  track: TrackLike,
): PersistedWatch | undefined {
  try {
    const closed = readOrchState(orchStateFileOf(ledgerRoot)).closed
    return closed.find((rec) => rec.target === track.sessionId
      && (rec.task === undefined || rec.task === track.taskId)
      && rec.at >= plan.createdAt)
  } catch { return undefined }
}
/**
 * **过期归档的计划摘要**（2026-11-06）：读 `<ledgerRoot>/runtime/work-plans/abandoned/`。
 *
 * ⚠ **单独一档**：⛔ 不并进活动计划，⛔ 不并进 completed ——
 *   过期归档的计划**从来没被真正推进过**，与「做完了」和「正在做」都不是一回事。
 *
 * @param self - 只返回 joinOwner 是自己的那些；`undefined` ⇒ 不过滤（看全部）。
 * @returns 读不到目录 / 单条 JSON 坏 ⇒ 空数组（⚠ 不抛、不猜）。
 */
export function abandonedPlansAt(ledgerRoot: string, self: string | undefined) {
  const dir = join(ledgerRoot, 'runtime', 'work-plans', 'abandoned')
  try {
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .flatMap((name) => {
        try {
          const parsed = JSON.parse(readFileSync(join(dir, name), 'utf8')) as {
            abandonedAt?: string
            abandonedWhy?: string
            plan?: { planId?: string; state?: string; joinOwnerSessionId?: string; tracks?: unknown[] }
          }
          const owner = parsed.plan?.joinOwnerSessionId
          if (self !== undefined && owner !== undefined && owner !== self) return []
          return [{
            planId: String(parsed.plan?.planId ?? name.replace(/\.json$/, '')),
            state: String(parsed.plan?.state ?? 'unknown'),
            abandonedAt: String(parsed.abandonedAt ?? ''),
            abandonedWhy: String(parsed.abandonedWhy ?? ''),
            trackCount: Array.isArray(parsed.plan?.tracks) ? parsed.plan.tracks.length : 0,
          }]
        } catch { return [] }
      })
  } catch { return [] }
}

/**
 * **已归档计划的摘要**（只读投影，⚠ 不改任何状态）。
 *
 * 与活动计划的区别：这里没有 running / waiting（归档意味着都不在跑了），
 * 只保留 returned / failed 两个终态计数。
 *
 * @param self - 只返回 joinOwner 是自己的那些；`undefined` ⇒ 不过滤。
 */
export function closedPlanSummariesAt(ledgerRoot: string, self: string | undefined) {
  /** ⚠ 显式标注：`listClosedWorkPlans` 的返回类型来自 `shared/work-plan.ts`，
   *  不标注会让下面每个回调参数退化成 `any`（typecheck 会报 6 处隐式 any）。 */
  const plans: WorkPlan[] = listClosedWorkPlans(ledgerRoot)
  return plans
    .filter((plan) => self === undefined || plan.joinOwnerSessionId === self)
    .map((plan) => {
      const returned = plan.tracks.filter((track) => plan.trackStates?.[track.trackId] === 'returned').length
      const failed = plan.tracks.filter((track) => plan.trackStates?.[track.trackId] === 'failed').length
      return {
        planId: plan.planId,
        state: plan.state,
        trackCount: plan.tracks.length,
        running: 0,
        waiting: 0,
        returned,
        failed,
        ...(plan.singleTrackReason === undefined ? {} : { singleTrackReason: plan.singleTrackReason }),
        rationale: plan.rationale,
        modeSnapshot: planModeOf(plan),
        ...(plan.serialized === undefined ? {} : {
          serialized: {
            reason: plan.serialized.reason,
            groups: plan.serialized.groups,
            ...(plan.serialized.sharedPaths === undefined ? {} : { sharedPaths: plan.serialized.sharedPaths }),
          },
        }),
        tracks: plan.tracks.map((track) => ({
          trackId: track.trackId,
          taskId: track.taskId,
          sessionId: track.sessionId,
          accessType: track.accessType,
          dependsOn: [...track.dependsOn],
          state: plan.trackStates?.[track.trackId] ?? 'pending',
        })),
      }
    })
}
/**
 * **目标会话当前用的是哪个预设**，以及**那个值从哪来**。
 *
 * ── 为什么必须走总线，⛔ 不许在这里自己读 ─────────────────────────────
 *   会话的预设有两个来源：**建档头**（`header.agentPreset`）和**宿主投影**
 *   （header 起步 + 最后一条 `agent-preset/selected`）。
 *   实测（本工作区 13 条会话）：**4 条 header=standard / 投影=Hob**，含 Hob 自己 ⇒
 *   只读建档头会**给错值**，而「规划侧预设·不能施工」这条守卫对这 4 条不会触发。
 *
 *   ⚠ 修法**不是**在这里再写一份 `stateOf(...)` —— 那是"守卫写两遍必然漂"
 *     （本仓纪律），而且那次事故的成因正是两处各自读。
 *     ⇒ 唯一入口 = `hobBus.presetOf(id)`，读法与 `list()` / `deliver()` **同一个函数**。
 *
 * ── 降级语义（⚠ 必须保留且可分辨）────────────────────────────────────
 *   投影读不到 ⇒ 总线退回建档头并给 `source='header'`；本函数把来源**透传**，
 *   由渲染层标「降级」。⛔ 不许把降级值当真值用（`CHG-058` 要治的就是这个）。
 *
 * @param serviceOf - 取服务的函数（`svcCtx.get`），⚠ 由调用方给，本函数不认识 `svcCtx`。
 * @returns `[preset, source]`；读不到（总线缺席 / 会话没了 / 两个来源都空）⇒
 *   `[undefined, undefined]`，由调用方渲染成 `(读不到)` —— ⛔ 不编造、不猜默认值。
 */
/**
 * **纯归约**：把 `hobBus.presetOf()` 的返回值收窄成 `[preset, source]`。
 *
 * ⚠ 三种情况都返回 `[undefined, undefined]`，但**含义不同**：
 *   · 返回 null/undefined —— 总线说「没有这条会话」；
 *   · `preset` 不是非空字符串 —— 总线给了但值不可用；
 *   · `source` 不认识 —— 来源既不是 projection 也不是 header。
 *   ⇒ 一律不猜（⛔ 不把 `source` 兜底成 'header'，那会把「不知道」伪装成「降级」）。
 */
export function presetReadingOf(
  r: { preset?: unknown; source?: unknown } | null | undefined,
): [string | undefined, 'projection' | 'header' | undefined] {
  if (r === undefined || r === null) return [undefined, undefined]
  const preset = typeof r.preset === 'string' && r.preset !== '' ? r.preset : undefined
  const source = r.source === 'projection' || r.source === 'header' ? r.source : undefined
  return [preset, preset === undefined ? undefined : source]
}

export function targetPresetAt(
  target: string,
  serviceOf: (name: string) => unknown,
): [string | undefined, 'projection' | 'header' | undefined] {
  try {
    const bus = (() => { try { return serviceOf('hobBus') } catch { return undefined } })() as
      | { presetOf?: (id: string) => { preset?: unknown; source?: unknown } }
      | undefined
    if (bus === undefined || typeof bus.presetOf !== 'function') return [undefined, undefined]
    return presetReadingOf(bus.presetOf(target))
  } catch {
    return [undefined, undefined]
  }
}

/**
 * **某会话的工作区根**（= 该会话建档头里的 `cwd`）。
 *
 * ⚠ 取法必须与 `rootOf`（`modules/tools.ts`）**同源** —— 那是本仓唯一的
 *   「会话工作区根」定义点（`exec.agent?.session.header.cwd`）。
 *   本函数读的是同一字段，只是从**会话对象**而不是 `exec` 取。
 *
 * @param sessions - 宿主 `sessions` 服务（提供 `.get(id)`）。
 * @returns 读不到（会话没了 / 没有 cwd）⇒ `undefined`（⛔ 不猜一个默认根）。
 */
export function wsRootOfSessionAt(
  sessionId: string,
  sessions: { get?: (id: string) => { header?: { cwd?: unknown } } | undefined } | undefined,
): string | undefined {
  try {
    const s = sessions?.get?.(sessionId)
    const cwd = s?.header?.cwd
    return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
  } catch {
    return undefined
  }
}
/**
 * **某个 owner 用哪一份运行态文件**（`stop` / `resume` 落盘时用）。
 *
 * ⚠ 取法是「**工作区根 → 运行态文件**」两步，两步都可能判不出：
 *   工作区根取不到（会话没了 / 没 cwd）⇒ `undefined`；
 *   账本根解析不到 ⇒ `undefined`。
 * ⇒ 判不出就**不落盘**（⛔ 不猜一个默认路径 —— 那会把记录写进别人的工作区）。
 *
 * @param runtimeFileOf - 「工作区根 ⇒ 运行态文件」的解析器（`orchestrator.ts` 模块级）。
 *   ⚠ 当作参数传入：它需要 `svcCtx`，而本函数不认识 `svcCtx`。
 * @param wsRootOf - 「会话 id ⇒ 工作区根」的解析器（本文件 `wsRootOfSessionAt` 即可）。
 */
export function stateFileForOwnerAt(
  owner: string,
  runtimeFileOf: (wsRoot: string | undefined) => string | undefined,
  wsRootOf: (sessionId: string) => string | undefined,
): string | undefined {
  try {
    return runtimeFileOf(wsRootOf(owner))
  } catch {
    return undefined
  }
}
/**
 * 会话日志里一条事件的**文本**（只认 message 事件；别的形状 ⇒ 空串）。
 *
 * ⚠ 两种事件的正文位置不同：`user/message` 在 `data.content`、
 *   `assistant/message` 在 `data.message.content` —— 都是 `[{type:'text',text}]` 数组。
 *   ⛔ 不猜第三种形状：不是这两个 ⇒ 空串（调用方据此判「没有正文」）。
 */
export function messageTextOf(event: any): string {
  if (event?.type === 'user/message') {
    const content = event?.data?.content
    return Array.isArray(content)
      ? content.filter((p: any) => p?.type === 'text' && typeof p.text === 'string')
        .map((p: any) => p.text).join('\n')
      : ''
  }
  if (event?.type === 'assistant/message') {
    const content = event?.data?.message?.content
    return Array.isArray(content)
      ? content.filter((p: any) => p?.type === 'text' && typeof p.text === 'string')
        .map((p: any) => p.text).join('\n')
      : ''
  }
  return ''
}

/**
 * 会话日志里，`index` 那条事件之后是否还有一条**真实用户消息**。
 *
 * ⚠ 「真实」= `data.source.kind === 'user'` 且正文非空 ——
 *   relay（转发）/ injected（注入）都不算用户回复（⛔ 不把系统代发当成人说话）。
 */
export function userReplyAfter(log: readonly any[], index: number): boolean {
  for (let i = index + 1; i < log.length; i++) {
    const e: any = log[i]
    if (e?.type !== 'user/message') continue
    if (e?.data?.source?.kind === 'user' && messageTextOf(e).trim() !== '') return true
  }
  return false
}

/**
 * **该 owner 是否正在等用户**（2026-11-04）。
 *
 * ⚠ 只认**当前仍未回答**的问题，⛔ 不认历史 `clarifyAt`：
 *   · 会话 `log` 里最后一条助手消息含待决问题段（`clarifySectionOf` 唯一实现）；
 *   · 且它之后**没有**真实用户回复（relay / injected 不算）；
 *   · `closed` 里带 `clarifyAt` 的记录只在**没有更新的会话消息**时才作为兼容来源，
 *     避免旧回传把看护永久锁在等待态。
 *
 * ⚠ 判不出 ⇒ `false`（不因此阻断看护；真正判不出时 `intent` 会落 `undecidable`）。
 *   ⛔ 不把「读不到」当成「在等用户」—— 那会让看护永远不叫。
 *
 * @param sessions - 宿主 `sessions` 服务（提供 `.get(id)`）；读不到会话走兼容来源。
 * @param agents - 宿主 `agents` 服务（`agents.get(id)?.session` 是兼容取法）。
 */
export function awaitingUserOfAt(
  ledgerRoot: string,
  owner: string,
  sessions: { get?: (id: string) => { log?: unknown } | undefined } | undefined,
  agents: { get?: (id: string) => { session?: { log?: unknown } } | undefined } | undefined,
): boolean {
  let sessionLastAt: number | undefined
  try {
    const session = sessions?.get?.(owner) ?? agents?.get?.(owner)?.session
    const log = (session as any)?.log
    if (Array.isArray(log)) {
      for (let i = log.length - 1; i >= 0; i--) {
        const e: any = log[i]
        if (typeof e?.time === 'number' && Number.isFinite(e.time)) { sessionLastAt = e.time; break }
      }
      for (let i = log.length - 1; i >= 0; i--) {
        const e: any = log[i]
        if (e?.type !== 'assistant/message') continue
        if (clarifySectionOf(messageTextOf(e)) === undefined) return false
        return !userReplyAfter(log, i)
      }
    }
  } catch { /* 读不到会话 ⇒ 看兼容来源 */ }
  try {
    const st = readOrchState(orchStateFileOf(ledgerRoot))
    const own = st.closed.filter((rec) => (rec.owner ?? rec.watcher) === owner)
    own.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    const latest = own[0]
    if (latest !== undefined && typeof latest.clarifyAt === 'number') {
      /** 会话里已有更新消息 ⇒ 那条旧回传不再代表"此刻仍在等"。 */
      return sessionLastAt === undefined || latest.clarifyAt >= sessionLastAt
    }
  } catch { /* 读不到 ⇒ 判不出 */ }
  return false
}
/**
 * ⚠ `PlanProgressLike` 已删：`workPlanProgress` 的返回类型 `WorkPlanProgress`
 *   本来就在 `shared/work-plan.ts:951`（不依赖 orchestrator）⇒ 直接复用，
 *   ⛔ 手写一个「最小面」反而与源类型漂移（实测 `nextState`/`rationale` 两处）。
 */

/**
 * 一个计划文件的**显示口径**（状态、轨道计数、隔离原因、是否占槽、是否过期）。
 *
 * ⚠⚠ `status()` 与 `workPlans()` **必须共用这一处**：两处各写一遍 `completed`
 *   三元式，等于同一个事实有两个来源，改一处漏一处就会让两个读数漂移。
 *
 * ── **长期机制：计划不能"看起来还在跑"**（2026-11-06）──────────────────
 *   现场：5 份计划在 `active/` 里停留 47–56 小时仍显示 `running`，
 *   而派活方早已不在 ⇒ 人读读数时无法区分「正在推进」与「没人管了」。
 *   ⇒ 三个**可核对**的读数（⛔ 不改 state、⛔ 不自动删计划）：
 *     `ageHours`（createdAt 至今）· `occupiesSlot`（是否仍占执行槽）·
 *     `stale`（非终态且超 `STALE_PLAN_HOURS`，需人工处置）。
 *
 * @param occupiesSlot - 「该计划是否仍占执行槽」由调用方判定后传入
 *   （编排侧实现：`!stoppedPlanOccupiesSlot(plan)` —— 判据在闭包里，依赖 `isStoppedFor`）。
 * @param stalePlanHours - 过期阈值（编排侧传 `STALE_PLAN_HOURS` = 24）。
 */
/**
 * `summarizePlanAt` 的返回形状（⚠ 结构化最小面，⛔ 不 import `WorkPlanStatus` ——
 *   那个类型定义在 `orchestrator.ts:976`，import 它就是环）。
 *   ⚠ 调用方（orchestrator）的 `WorkPlanStatus['plans'][number]` 与它**逐字段兼容**；
/**
 * ⚠⚠ **返回类型 = `WorkPlanSummary`（shared/work-plan.ts）**：
 *   2026-11-12 教训 —— 手写「PlanSummaryLike 最小面」连错 3 处（`rationale` 可选性 /
 *   `modeSnapshot` / `tracks.taskId`），每处都是与源类型的**真实漂移**。
 *   ⇒ 源类型已在 shared（`WorkPlanStatus.plans` 与本函数三处同源），直接复用，
     ⛔ 不要再手写同形状的字面类型。
 */
export function summarizePlanAt(
  plan: WorkPlan,
  states: Record<string, WorkTrackState>,
  progress: WorkPlanProgress,
  occupiesSlot: boolean,
  stalePlanHours: number,
): WorkPlanSummary {
  const returned = plan.tracks.filter((track) => states[track.trackId] === 'returned').length
  const failed = plan.tracks.filter((track) => states[track.trackId] === 'failed').length
  const running = plan.tracks.filter((track) => states[track.trackId] === 'running').length
  const ageHours = plan.createdAt === undefined ? null : Math.max(0, (Date.now() - plan.createdAt) / 3_600_000)
  const terminal = plan.state === 'completed' || plan.state === 'failed' || progress.terminal
  return {
    planId: plan.planId,
    state: plan.state === 'completed' ? 'completed'
      : plan.state === 'failed' || progress.failed ? 'failed'
        : progress.nextState,
    trackCount: plan.tracks.length,
    running,
    waiting: progress.waiting.length,
    returned,
    failed,
    ...(ageHours === null ? {} : { ageHours: Math.round(ageHours * 10) / 10 }),
    occupiesSlot: occupiesSlot && !terminal,
    stale: !terminal && ageHours !== null && ageHours >= stalePlanHours,
    ...(plan.singleTrackReason === undefined ? {} : { singleTrackReason: plan.singleTrackReason }),
    rationale: plan.rationale,
    modeSnapshot: planModeOf(plan),
    ...(plan.serialized === undefined ? {} : {
      serialized: {
        reason: plan.serialized.reason,
        groups: plan.serialized.groups,
        ...(plan.serialized.sharedPaths === undefined ? {} : { sharedPaths: plan.serialized.sharedPaths }),
      },
    }),
    tracks: plan.tracks.map((track) => ({
      trackId: track.trackId,
      taskId: track.taskId,
      sessionId: track.sessionId,
      accessType: track.accessType,
      dependsOn: [...track.dependsOn],
      state: states[track.trackId] ?? 'pending',
    })),
  }
}