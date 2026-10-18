/**
 * 「卡进度」读数面 —— 让 `hob_orch_status` 能看见**隔离执行卡**在干什么。
 *
 * ══ 它解决什么（用户 2026-10-18 报障，**实测**而不是推断）══════════════════
 *   卡 `t-mvddkn0y-msn95a` 05:20Z 点火、05:42Z 完成，**跑了 22 分钟**。
 *   同期 `hob_orch_status` 只有一行 `在等回传：1 个`（那是派出去的**建卡会话**），
 *   **卡的任何信息都没有** —— 没在跑、没跑到哪、没完成。
 *   ⇒ 结果是：**卡早就跑完了，派单方还在等**；只能靠人主动去读看板才发现。
 *
 *   为什么会这样：隔离卡的执行会话是**看板服务**起的，不是 `hob_dispatch` 派的
 *   ⇒ 它**不在** `watches` 里 ⇒ 回传通道（`orchestrator.ts` 的 `running → idle` 跳变）
 *   **根本不知道有这张卡**。⚠ 这不是回传本身的缺陷 —— 那套语义（谁派给谁、
 *   跳变、失败分档）**本模块一个字都没动**，这里只是**多读一个面**。
 *
 * ══ 数据从哪来（⚠ **只用现成接口，⛔ 不自造第二数据源**）════════════════════
 *   **唯一来源 = 看板自己注册的 `taskboard_list` / `taskboard_get`**，经宿主 `tools`
 *   注册表按名取定义再 `execute()` —— 与模型调用的是**同一个定义、同一份实现**
 *   （`dsh-tools` 的 `ToolRuntime.get(name, scope)` → `definition.execute`）。
 *
 *   ⚠ ⚠ **为什么⛔ 不去读 `~/.dsh/dsh-taskboard.json`**：那是**第二数据源** ——
 *     看板自己的 `StorageCoordinator` 才是账本的写者，直读文件会拿到
 *     "还没落盘的那一版"，且存储根可由用户改（`STORAGE_CONFIG_FILE`）
 *     ⇒ 迟早与看板自己给出的读数不一致（本仓 E-128 的口径：同一事实两个来源必然漂）。
 *   ⚠ ⚠ **为什么不新增工具名 / 不加看板子依赖**：⛔ 不新增工具名、⛔ 不改工具面；
 *     看板是**可选**插件（没装时本条只是"读不到"，⛔ 不是故障）。
 *     故这里只做「**按名取已注册的工具**」，读不到就**如实说读不到**。
 *
 *   ⚠ **为什么要两个工具**：`taskboard_list` 给的是**摘要**
 *     （`summarize()` 只带 id/status/version/title/blocked/lastExecutionOutcome…），
 *     **没有** `executions` ⇒ 拿不到**点火时刻 / 分支 / 提交 / 改动文件数**；
 *     那些只在 `taskboard_get` 的完整记录里。⇒ 先 list 定候选，再逐个 get 取细节。
 *     ⚠ 两个都取不到 ⇒ `unavailable`（⛔ 不许拿半个读数冒充齐字段）。
 *
 * ══ 三档（缺一档就等于没修）════════════════════════════════════════════
 *   · **在跑**   ：`in_progress`，或有 `outcome='running'` 的执行
 *                 ⇒ 卡 id · 尝试次数 · 点火时刻 · 已跑多久
 *   · **待验收** ：`in_review`（或 `done`）⇒ 卡 id · 完成时刻 · 分支/提交 ·
 *                 改动文件数 · **"去验收"一句**
 *   · **失败/卡住**：最后一次执行 `failed`/`cancelled`，或**非终态**的 `blocked`，
 *                 或在跑但**长时间无进展** ⇒ 卡 id · 时间 · **可读原因**
 *                 （⛔ 不许只给一个状态字）
 *
 *   ⚠ ⚠ **终态优先于受阻（2026-10-18 · 口径纠偏，实测出处见下）**：
 *     `blocked` 是**过程标记**（"要人处理才能继续"），`done`/`canceled`/`archived`
 *     是**结果**。两者同时存在（标记没被清掉）时，**先判受阻**会把**已经做完的卡**
 *     报成「失败/受阻」—— 派单方于是以为活没干完，会去重派/重做。
 *     实测：`t-mvczoqia-ntd9r3`（`status=done` v11 + `blocked=true`）在改前读数里
 *     落 `phase=failed`，而它最后一次执行是 `succeeded`。
 *     ⇒ 判档顺序里**终态一律不因受阻改判**（继续走 ③ 的既有口径），
 *       但**非终态 + 受阻仍然必须落「失败/受阻」**（分辨力不许被这一改削掉）。
 *     ⛔ 这不是"取消失败档"、⛔ 不是"过滤受阻卡"、⛔ 不是"把某张卡从结果里剔除"。
 *
 *   ⚠ ⚠ **反向（判据三）**：**没有该报的卡时⛔ 一行都不加**（不是"打印一句没有"）——
 *     `snap.cards.length === 0` ⇒ 渲染层返回**空数组**。
 *   ⚠ ⚠ **读不到也必须说出来（判据三后半）**：看板没装 / 工具被收敛掉 / 调用抛错
 *     ⇒ `reachability` = `'unavailable'` 或 `'unreadable'`，渲染层给**可读标记 + 原话**。
 *     ⛔ **绝不把"读不到"静默成"没有卡"** —— 那正是本轮要修的失败模式
 *     （"0" 与 "没记录" 必须能分开，见 `check-orch-state.mjs` 的 C 组口径）。
 */

/** 卡读数面的相位（**四档**，逐档独立，⛔ 不许合成一个"进行中"）。 */
export type CardPhase = 'running' | 'awaiting-review' | 'failed' | 'stalled'

/** 一条卡读数（渲染层只认这个形状）。 */
export interface CardReading {
  /** 卡 id。 */
  id: string
  /** 一句话标题（截断，防把整段描述塞进状态行）。 */
  title: string
  phase: CardPhase
  /** 卡当前状态字（原样转发看板给的值 —— ⛔ 不在这里翻译成自己的措辞）。 */
  status: string
  /** 卡版本号（这张卡被改过多少次 —— 可指认的读数，不是尝试次数）。 */
  version: number
  /** **尝试次数** = 这张卡下有几条执行记录（作业书里"轮次/尝试次数"的可指认读数）。 */
  attempts: number
  /** 点火时刻（最近一次执行的开跑时刻；读不到 ⇒ undefined）。 */
  startedAt?: number
  /** 完成时刻（`endedAt`；尚未结束 ⇒ undefined）。 */
  endedAt?: number
  /** 分支（worktree 运行时才有）。 */
  branch?: string
  /** 提交短号（`headCommit` 前 7 位）。 */
  headCommit?: string
  /** 改动文件数（`changedFiles`）。 */
  changedFiles?: number
  /** **可读原因**（只在该档需要时给：失败原因 / 卡住判据 / 受阻说明）。 */
  reason?: string
}

/** 卡读数面的可达性 —— ⚠ 与 `StateReachability` **同款纪律**：读不到必须说出来。 */
export type CardReachability =
  /** 读到了，且**确实有该报的卡**（cards 非空）。 */
  | 'ok'
  /** 读到了，**确实没有该报的卡** ⇒ 渲染层⛔ 不加行（真实状态，不是失败）。 */
  | 'no-cards'
  /** **看板不在这里**（没装 / 被工具收敛掉 / 拿不到注册表）⇒ 有可读标记。 */
  | 'unavailable'
  /** 看板在，但**这次调用失败了**（抛错 / 返回不可解析）⇒ 有可读标记。 */
  | 'unreadable'

/** 卡读数面的完整结果。 */
export interface CardSnapshot {
  cards: CardReading[]
  reachability: CardReachability
  /** 读不到时的**原话**（⛔ 不许编造；读到了就是 undefined）。 */
  detail?: string
}

/**
 * 从看板工具的返回值里认出「任务数组」。
 *
 * ⚠ 判据**刻意宽松**（只认形状不认字段名细节）：看板工具的 `execute` 返回的是
 *   JSON 化的 `{ revision, tasks }`；`render` 是另一条路（给人看的文本），⛔ 不解析它
 *   —— 解析渲染文本＝**把人类可读串当协议**（一改措辞就静默失效）。
 *
 * @returns 任务数组；形状不认识 ⇒ undefined（调用方按 `unreadable` 处理）。
 */
function tasksOf(value: unknown): any[] | undefined {
  if (Array.isArray(value)) return value
  if (value !== null && typeof value === 'object') {
    const tasks = (value as { tasks?: unknown }).tasks
    if (Array.isArray(tasks)) return tasks
  }
  return undefined
}

/** 取数字字段（⛔ 不做隐式转换：不是有限数就当没有）。 */
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** 取字符串字段（空串当没有）。 */
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}

/**
 * 这个状态字是不是**终态**（结果已定，⛔ 不会再自己往前走）。
 *
 * ⚠ **为什么需要它**（2026-10-18 口径纠偏）：`blocked` 是**过程标记**（"要人处理才能继续"），
 *   而终态是**结果**。二者同时出现在同一张卡上（标记没被清掉）时，判档必须**先认结果** ——
 *   否则 `done` 卡会被报成「失败/受阻」，派单方以为活没干完（实测见文件头 §三档）。
 * ⚠ **它是纯判定、不看执行记录**：只认 `status` 这一个字段（与 `isReportable` 同源同口径）。
 *
 * @param status - 看板给的原始状态字（⛔ 不在这里翻译措辞）。
 */
function isTerminalStatus(status: string): boolean {
  return status === 'done' || status === 'canceled' || status === 'archived'
}

/**
 * 这条任务记录是不是"该报的卡"（`todo` / `canceled` / `archived` 不报）。
 *
 * ⚠ ⚠ **`done` 必须报、且不许因为受阻被剔除**（2026-10-18 口径纠偏）：
 *   `done + blocked` 这张卡要**继续出现在读数里**（它是"要人收活"的那一档），
 *   只是档位由 `phaseOf` 判成「待验收」—— ⛔ 这里若把它滤掉，就是作业书点名的
 *   「把这一张卡从结果里剔除」，那是**掩盖**不是**纠偏**。
 *   `canceled` / `archived` 仍不报（既有口径，本批未动）。
 */
function isReportable(task: any): boolean {
  const status = str(task?.status) ?? ''
  if (status === 'in_progress' || status === 'in_review') return true
  // ⚠ 终态里**只有 `done` 会因受阻被"翻出来"报**；`canceled`/`archived` 不报（既有口径）。
  if (task?.blocked === true && status !== 'canceled' && status !== 'archived') return true
  const executions = Array.isArray(task?.executions) ? task.executions : []
  const last = executions.length > 0 ? executions[executions.length - 1] : undefined
  const lastOutcome = str(last?.outcome)
  if (lastOutcome === 'failed' || lastOutcome === 'cancelled') return true
  return false
}

/**
 * 判这张卡该进哪一档，并给**可读理由**。
 *
 * ⚠ 顺序有意义：**失败判据优先于"在跑"** —— 一张卡可能同时有 `in_progress`
 *   和一条 `outcome='failed'` 的执行（失败后状态还没被移走），那时报"在跑"就是**骗人**。
 *
 * @param task - 看板任务（完整记录，含 `executions`）。
 * @param now - 当前时刻（毫秒），用来判"卡住"。
 * @param stallMs - 多久没动静算卡住。
 */
function phaseOf(task: any, now: number, stallMs: number): { phase: CardPhase; reason?: string } {
  const status = str(task?.status) ?? ''
  const executions = Array.isArray(task?.executions) ? task.executions : []
  /** 最近一次执行（看板按时间追加 ⇒ 最后一条就是最近）。 */
  const last = executions.length > 0 ? executions[executions.length - 1] : undefined
  const lastOutcome = str(last?.outcome)
  const lastError = str(last?.error)

  // ── ① 失败 / 取消：最后一次执行明确失败 ⇒ **不能报"在跑"** ────────────────
  if (lastOutcome === 'failed' || lastOutcome === 'cancelled') {
    const when = num(last?.endedAt) ?? num(last?.startedAt)
    const head = lastOutcome === 'cancelled' ? '这次执行被取消' : '这次执行失败'
    // ⚠ **可读原因**：看板记下来就原样带出；它没记 ⇒ **说出来它没记**
    //   （⛔ 不许用"失败"两个字冒充原因 —— 那正是作业书点名的"只给状态字"）。
    const tail = lastError === undefined ? '（看板没有记录原因）' : lastError
    return {
      phase: 'failed',
      reason: `${head}${when === undefined ? '' : ` @ ${stampOf(when)}`}：${tail}`,
    }
  }

  // ── ② 受阻：卡上明确的 `blocked` 标记 —— ⚠ **只对非终态生效** ───────────────
  //   ⚠ ⚠ **为什么终态要排除**（2026-10-18 口径纠偏）：`blocked` 是**过程标记**，
  //     `done`/`canceled`/`archived` 是**结果**；标记没被清掉是看板侧的事，
  //     **不该把"已经做完的卡"翻译成"失败/受阻"**（实测 `t-mvczoqia-ntd9r3`：
  //     `status=done` + `blocked=true` + 最后一次执行 `succeeded` ⇒ 改前落 failed）。
  //   ⚠ **分辨力未削**：**非终态 + 受阻** 仍然**必须**落「失败/受阻」（见 `isTerminalStatus`
  //     的成对判据 · `check-orch-state.mjs` L-f/L-g）。
  if (task?.blocked === true && !isTerminalStatus(status)) {
    return { phase: 'failed', reason: '卡上标了**受阻**（blocked）—— 要人处理才能继续' }
  }

  // ── ③ 待验收：`in_review` / `done` ────────────────────────────────────────
  //   ⚠ ⚠ **终态优先**：走到这里说明卡不是"最后一次执行失败/取消"，也已过了受阻那一支
  //     （终态不进那一支）⇒ `done` 一律按**结果**报「待验收」。
  //   ⚠ **但标记不静默抹掉**：`done` 卡上仍挂着 `blocked` 时，把这件事**如实带出来**——
  //     档位按结果算（⛔ 不进失败档），可"看板上这张卡还标着受阻"这个事实**不许消失**，
  //     否则等于用"改档"换来"看不见"（实测那张卡的受阻标记确实还在，见回报 §待决问题）。
  if (status === 'in_review' || status === 'done') {
    return task?.blocked === true
      ? { phase: 'awaiting-review', reason: '卡上仍挂着**受阻**（blocked）标记 —— 已按结果归入本档，标记本身**仍在看板上**（要清得去看板改它）' }
      : { phase: 'awaiting-review' }
  }

  // ── ④ 在跑：`in_progress`，或有 `outcome='running'` 的执行 ────────────────
  const runningExec = executions.find((x: any) => str(x?.outcome) === 'running')
  if (status === 'in_progress' || runningExec !== undefined) {
    const focus = runningExec ?? last
    const startedAt = num(focus?.startedAt)
    const lastActivity = num(focus?.lastActivityAt) ?? startedAt
    // ⚠ **卡住**这一档：在跑、但**很久没动静** ⇒ 报「卡住」+ 说清判据
    //   （⛔ 不许报成"在跑"就完事 —— 用户要能分辨"真在跑"与"僵住了"）。
    if (lastActivity !== undefined && now - lastActivity > stallMs) {
      const mins = Math.round((now - lastActivity) / 60000)
      return {
        phase: 'stalled',
        // ⚠ 判据写进话里：`stallMs` 是可查的常量，不是拍脑袋。
        reason: `**已 ${mins} 分钟没有任何进展**（判据：超过 ${Math.round(stallMs / 60000)} 分钟无活动）`
          + ' —— 可能在等审批 / 在重试 / 已僵死，需要去看那个会话',
      }
    }
    return { phase: 'running' }
  }

  // ── 其余（不会被 `isReportable` 放进来）⇒ 按"在跑"兜底，由调用方过滤 ──────
  return { phase: 'running' }
}

/**
 * 把一条看板任务记录收成一条 {@link CardReading}。
 *
 * @param task - 看板任务（完整记录，含 `executions`）。
 * @param now - 当前时刻（毫秒）。
 * @param stallMs - 多久没动静算卡住。
 * @returns 读数；该卡不在该报的档里 ⇒ undefined（由调用方跳过）。
 */
function toReading(task: any, now: number, stallMs: number): CardReading | undefined {
  const id = str(task?.id)
  if (id === undefined || !isReportable(task)) return undefined
  const executions = Array.isArray(task?.executions) ? task.executions : []
  const last = executions.length > 0 ? executions[executions.length - 1] : undefined
  const { phase, reason } = phaseOf(task, now, stallMs)
  const rawTitle = str(task?.title) ?? '(无标题)'
  const title = rawTitle.length > 60 ? `${rawTitle.slice(0, 60)}…` : rawTitle
  const startedAt = num(last?.startedAt)
  const endedAt = num(last?.endedAt)
  const branch = str(last?.branch)
  const headCommit = str(last?.headCommit)
  const changedFiles = num(last?.changedFiles)
  return {
    id,
    title,
    phase,
    status: str(task?.status) ?? '(读不到)',
    version: num(task?.version) ?? 0,
    attempts: executions.length,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(endedAt === undefined ? {} : { endedAt }),
    ...(branch === undefined ? {} : { branch }),
    ...(headCommit === undefined ? {} : { headCommit: headCommit.slice(0, 7) }),
    ...(changedFiles === undefined ? {} : { changedFiles }),
    ...(reason === undefined ? {} : { reason }),
  }
}

/** 默认「卡住」阈值：20 分钟没任何活动就报卡住（可被调用方覆盖）。 */
export const DEFAULT_CARD_STALL_MS = 20 * 60 * 1000

/** 按名取工具定义的形状（`dsh-tools` 的 `get(name, scope)`）。 */
export type GetTool = (name: string) => any

/** 调一次看板工具并认任务数组；失败时给出**原话**。 */
async function callBoard(
  tool: any,
  args: Record<string, unknown>,
): Promise<{ ok: true; value: unknown } | { ok: false; detail: string }> {
  if (tool === undefined || tool === null) return { ok: false, detail: '工具不存在' }
  if (typeof tool.execute !== 'function') return { ok: false, detail: '工具没有可执行的 `execute`' }
  try {
    return { ok: true, value: await tool.execute(args, { agent: undefined }) }
  } catch (e) {
    return { ok: false, detail: `调用抛错：${String((e as Error)?.message ?? e)}` }
  }
}

/**
 * 读一遍「卡进度」。
 *
 * ⚠ **只调用看板自己注册的工具**（同一实现、同一份账本读法）。
 * ⚠ 任何一步拿不到 ⇒ **如实返回 `unavailable` / `unreadable` + 原话**，
 *   ⛔ 不返回空数组冒充"没有卡"。
 *
 * @param opts.workspaceId - 只看这个项目（= 工作区 id）的卡。
 * @param opts.getTool - **宿主 `tools` 注册表的按名取定义**；拿不到 ⇒ 传 undefined。
 * @param opts.now - 现取时刻（测试用）。
 * @param opts.stallMs - 卡住阈值（测试用）。
 */
export async function readCards(opts: {
  workspaceId: string | undefined
  getTool: GetTool | undefined
  now?: number
  stallMs?: number
}): Promise<CardSnapshot> {
  const now = opts.now ?? Date.now()
  const stallMs = opts.stallMs ?? DEFAULT_CARD_STALL_MS

  // ── ① 拿不到注册表 ⇒ `unavailable`（⛔ 不是"没有卡"）────────────────────────
  if (opts.getTool === undefined) {
    return {
      cards: [],
      reachability: 'unavailable',
      detail: '拿不到宿主的工具注册表（`tools` 服务缺席）⇒ 无法问看板要卡状态',
    }
  }
  const getTool = opts.getTool
  /** 按名取一次，抛错也收成 undefined（调用方只关心"有没有"）。 */
  const pick = (name: string): any => {
    try { return getTool(name) } catch { return undefined }
  }

  const listTool = pick('taskboard_list')
  const getOneTool = pick('taskboard_get')
  // ⚠ 两个都必需：`list` 给候选与状态，`get` 给点火时刻/分支/提交/改动数。
  //   缺一个 ⇒ 报出的行会**缺字段**（⛔ 作业书要"字段齐"，不许拿半个读数冒充）。
  const missing: string[] = []
  if (listTool === undefined || listTool === null) missing.push('`taskboard_list`')
  if (getOneTool === undefined || getOneTool === null) missing.push('`taskboard_get`')
  if (missing.length > 0) {
    return {
      cards: [],
      reachability: 'unavailable',
      detail: `当前工具面里没有 ${missing.join(' / ')}`
        + '（看板插件没装，或被工具收敛掉了）⇒ 卡进度**读不到**（⛔ 这不等于"没有卡"）',
    }
  }

  // ── ② 先 list 定候选（与模型调用的是同一个定义）────────────────────────────
  //   ⚠ 只按 `workspaceId` 过滤；**不传 status** —— 三档横跨多个状态，
  //     分多次调用会让"同一时刻的读数"变成"几个时刻的拼接"。
  const listArgs: Record<string, unknown> = {}
  if (opts.workspaceId !== undefined && opts.workspaceId !== '') listArgs.workspaceId = opts.workspaceId
  const listed = await callBoard(listTool, listArgs)
  if (!listed.ok) {
    return {
      cards: [],
      reachability: 'unreadable',
      detail: `\`taskboard_list\` 读不到：${listed.detail}`,
    }
  }
  const summaries = tasksOf(listed.value)
  if (summaries === undefined) {
    return {
      cards: [],
      reachability: 'unreadable',
      detail: '`taskboard_list` 的返回值里认不出任务数组（形状不认识）⇒ 卡进度**读不到**',
    }
  }

  // ── ③ 逐个 get 取细节（只对**可能该报**的卡，避免为每张历史卡都读一次）──────
  const candidates = summaries.filter((t: any) => isReportable(t))
  const cards: CardReading[] = []
  const getFailures: string[] = []
  for (const summary of candidates) {
    const id = str(summary?.id)
    if (id === undefined) continue
    const got = await callBoard(getOneTool, { id })
    if (!got.ok) { getFailures.push(`${id}（${got.detail}）`); continue }
    const record = (got.value !== null && typeof got.value === 'object')
      ? (got.value as { task?: unknown }).task
      : undefined
    if (record === undefined || record === null) { getFailures.push(`${id}（返回值里没有 task）`); continue }
    const r = toReading(record, now, stallMs)
    if (r !== undefined) cards.push(r)
  }

  // ⚠ 候选全读失败 ⇒ `unreadable`（⛔ 不能变成"没有卡"）。
  if (cards.length === 0 && getFailures.length > 0) {
    return {
      cards: [],
      reachability: 'unreadable',
      detail: `\`taskboard_get\` 逐个读卡失败：${getFailures.join(' · ')}`,
    }
  }

  // ── ④ 读到了但确实没有该报的卡 ⇒ `no-cards`（真实状态，⛔ 不是失败）──────────
  if (cards.length === 0) {
    return { cards, reachability: 'no-cards' }
  }

  // ⚠ 排序：**待验收 → 失败 → 卡住 → 在跑**，同档按 id 稳定排。
  //   理由：派单方最需要先看到"能收活的"和"要我处理的"，最后才是"还在等"。
  const rank: Record<CardPhase, number> = { 'awaiting-review': 0, failed: 1, stalled: 2, running: 3 }
  cards.sort((a, b) => (rank[a.phase] - rank[b.phase]) || a.id.localeCompare(b.id))
  return {
    cards,
    reachability: 'ok',
    // ⚠ 部分 get 失败要留痕（⛔ 不许静默少报一张卡）。
    ...(getFailures.length === 0 ? {} : { detail: `另有 ${getFailures.length} 张卡细节读不到：${getFailures.join(' · ')}` }),
  }
}

/** 把毫秒差渲染成「12 分 34 秒」那种人读得懂的串（⛔ 不贴裸毫秒）。 */
export function humanDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '(判不出)'
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h} 时 ${m} 分`
  if (m > 0) return `${m} 分 ${s} 秒`
  return `${s} 秒`
}

/** 本地时刻串（与 `orchestrator.ts` 的 `登记=` 同款口径，人读得懂）。 */
export function stampOf(at: number): string {
  return new Date(at).toLocaleString('zh-CN', { hour12: false })
}

/** 相位 → 给人看的那一档名字（**四档**，逐档独立，⛔ 不许合成一个"进行中"）。 */
export function mapPhase(p: CardPhase): string {
  switch (p) {
    case 'running': return '在跑'
    case 'awaiting-review': return '**待验收**'
    case 'failed': return '⚠ **失败/受阻**'
    case 'stalled': return '⚠ **卡住**'
    /* v8 ignore next -- 闭合联集的穷尽守卫 */
    default: return '(未知档)'
  }
}

/**
 * 把卡读数渲染成 `hob_orch_status` 的若干行。
 *
 * ⚠ ⚠ **空态与读不到态的区别就是本函数的全部要点**：
 *   · `'no-cards'` ⇒ 返回 **空数组**（⛔ 一行都不加）。
 *     作业书判据三要求"没有卡时⛔ 不许凭空显示装饰性的卡状态行"。
 *   · `'unavailable'` / `'unreadable'` ⇒ **可读标记 + 原话**（⛔ 不许静默成"没有卡"）。
 *   · `'ok'` ⇒ 每张卡一行（字段按档位给），`awaiting-review` 额外给**"去验收"**一句。
 *
 * @param snap - {@link readCards} 的返回值。
 * @param now - 现取时刻（用来算"已跑多久"；测试可固定）。
 */
export function renderCardLines(snap: CardSnapshot, now: number = Date.now()): string[] {
  if (snap.reachability === 'unavailable' || snap.reachability === 'unreadable') {
    return [
      `⚠ 卡进度：**读不到**（${snap.reachability === 'unavailable' ? '看板不可用' : '看板调用失败'}）`,
      `  ↳ ${snap.detail ?? '(没有更多信息)'}`,
      '  ↳ ⛔ **这不等于"没有卡在跑"** —— 别把这一档当作"确实没有"。',
    ]
  }
  if (snap.cards.length === 0) return []
  /**
   * ⚠ ⚠ **为什么要上限**（实测，不是偏好）：本机看板一次就有 **16 张**卡停在
   *   `in_review`（历史积压），全部展开会把 `hob_orch_status` 撑到 30+ 行，
   *   把「在等回传 / 已回传 / 待投递」这些**原有读数挤出视野** ——
   *   那等于用"看得更多"换掉"看得见"，与本单的目的相反。
   *
   * ⚠ **但⛔ 不许静默截断**：超出上限的**如实说还有几张**（⛔ 不是悄悄少报），
   *   并点明去哪个工具看全。
   *
   * ⚠ 优先级（谁先占行）：**在跑 / 失败 / 卡住**（要人现在处理）> 待验收（要人收活）。
   */
  const MAX_RUNNING = 5
  const MAX_REVIEW = 5
  const counts = {
    'awaiting-review': 0, running: 0, failed: 0, stalled: 0,
  } as Record<CardPhase, number>
  for (const c of snap.cards) counts[c.phase]++

  const lines: string[] = []
  const summary: string[] = []
  if (counts['awaiting-review'] > 0) summary.push(`待验收 ${counts['awaiting-review']}`)
  if (counts.running > 0) summary.push(`在跑 ${counts.running}`)
  if (counts.failed > 0) summary.push(`失败/受阻 ${counts.failed}`)
  if (counts.stalled > 0) summary.push(`卡住 ${counts.stalled}`)
  lines.push(`卡：${snap.cards.length} 张（${summary.join(' · ')}）`)

  /** 一排"在跑 / 失败 / 卡住"的卡头（字段：id · 档 · 状态 · 尝试 · 点火 · 已跑 · 完成 · 分支 · 提交 · 改动数）。 */
  const headOf = (c: CardReading, withAttempts: boolean): string[] => {
    const head = [`- ${c.id}`, mapPhase(c.phase), `状态=${c.status}`, `v${c.version}`, `「${c.title}」`]
    if (withAttempts) head.push(`尝试=${c.attempts} 次`)
    if (c.startedAt !== undefined) {
      head.push(`点火=${stampOf(c.startedAt)}`)
      // ⚠ 「已跑多久」：已结束 ⇒ 相对 `endedAt`（"跑了多久"）；还在跑 ⇒ 相对**现在**。
      head.push(`已跑=${humanDuration((c.endedAt ?? now) - c.startedAt)}`)
    }
    if (c.endedAt !== undefined) head.push(`完成=${stampOf(c.endedAt)}`)
    if (c.branch !== undefined) head.push(`分支=${c.branch}`)
    if (c.headCommit !== undefined) head.push(`提交=${c.headCommit}`)
    if (c.changedFiles !== undefined) head.push(`改动=${c.changedFiles} 个文件`)
    return head
  }

  // ── ① 在跑 / 失败 / 卡住（**先占行**：这些是要人现在处理的）──────────────────
  const active = snap.cards.filter((c) => c.phase !== 'awaiting-review')
  let shownActive = 0
  for (const c of active) {
    if (shownActive >= MAX_RUNNING) break
    shownActive++
    lines.push(headOf(c, true).join(' · '))
    if (c.reason !== undefined) lines.push(`  ↳ ${c.reason}`)
  }
  if (active.length > shownActive) {
    lines.push(`  ↳ 另有 ${active.length - shownActive} 张在跑/失败/卡住的卡未展开`
      + `（最多展开 ${MAX_RUNNING} 张）—— 用 \`taskboard_list\` 看全。`)
  }

  // ── ② 待验收（要人收活）──────────────────────────────────────────────────
  const review = snap.cards.filter((c) => c.phase === 'awaiting-review')
  let shownReview = 0
  for (const c of review) {
    if (shownReview >= MAX_REVIEW) break
    shownReview++
    // ⚠ 待验收不重复"尝试"（那是过程量），但**必须先给完成时刻 + 分支/提交/改动数**。
    const head = [`- ${c.id}`, '**待验收**', `状态=${c.status}`, `v${c.version}`, `「${c.title}」`]
    if (c.endedAt !== undefined) head.push(`完成=${stampOf(c.endedAt)}`)
    if (c.branch !== undefined) head.push(`分支=${c.branch}`)
    if (c.headCommit !== undefined) head.push(`提交=${c.headCommit}`)
    if (c.changedFiles !== undefined) head.push(`改动=${c.changedFiles} 个文件`)
    lines.push(head.join(' · '))
    // ⚠ **终态卡仍挂受阻标记**时要带出这一句（⛔ 不许因为"改了档"就把标记静默抹掉）。
    if (c.reason !== undefined) lines.push(`  ↳ ${c.reason}`)
  }
  if (review.length > shownReview) {
    lines.push(`  ↳ 另有 ${review.length - shownReview} 张待验收未展开`
      + `（最多列 ${MAX_REVIEW} 张）—— 用 \`taskboard_list status=in_review\` 看全。`)
  }
  // ⚠ **"去验收"一句**：只给**一次**（待验收那一档全部适用），不逐张重复。
  if (review.length > 0) {
    lines.push('  ↳ ✅ **去验收**：上面标 `待验收` 的卡已跑完；读它的执行报告与改动，'
      + '确认后由你（用户）决定是否置 done。')
  }
  // ⚠ 部分卡细节读不到（get 失败）⇒ 留痕，⛔ 不许静默少报。
  if (snap.detail !== undefined) lines.push(`  ↳ ⚠ ${snap.detail}`)
  return lines
}
