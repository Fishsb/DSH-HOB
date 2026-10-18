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
  /** 去重表里记了多少条（诊断用，防"表悄悄涨"）。 */
  seenCount: number
}

/** 一次叫醒要投递给谁。 */
export interface WakeTarget {
  /** 收件会话 id。 */
  sessionId: string
  /** 它从什么时候开始"在看这个面"（毫秒）—— 用于诊断 `noSubscriber`。 */
  since: number
}

/** {@link CardWake} 的构造参数（⚠ 显式类型：别用构造参数属性，见该类注释）。 */
export interface CardWakeOpts {
  /** 看板 origin（如 `http://127.0.0.1:3080`）；判不出 ⇒ `start()` 报不可读。 */
  origin: string | undefined
  /** 现读本工作区 id（⚠ 每次现读：工作区可能后建）。 */
  workspaceIdOf: () => string | undefined
  /** 投递实现（真环境 = `bus.deliver(id, text, 'followup')`）。 */
  deliver?: (sessionId: string, text: string) => Promise<unknown>
  /** 现取时刻（测试可固定）。 */
  now?: () => number
  /** 可读日志出口（⛔ 不许静默）。 */
  log?: (line: string) => void
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
    out.push({
      taskId: id,
      title: title.length > 60 ? `${title.slice(0, 60)}…` : title,
      executionId,
      outcome,
      status,
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
  private state: WakeState = { conn: 'idle', wokeCount: 0, noSubscriberCount: 0, seenCount: 0 }
  private abort: AbortController | undefined
  private stopped = false
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

  /** 登记"这个会话在看本工作区的卡面"（由 `hob_orch_status` 每次调用时登记）。 */
  subscribe(sessionId: string): void {
    if (typeof sessionId !== 'string' || sessionId === '') return
    if (!this.targets.has(sessionId)) this.targets.set(sessionId, { sessionId, since: this.now() })
  }

  /**
   * 按需拉起 SSE（⚠ 幂等：已在连/已连上都**不会**起第二条）。
   *
   * ⚠ **为什么"订阅时才连"而不是模块加载就 connect**：没有订阅者时连上也叫不动
   *   （见 `handleFrame` 的 `noSubscriberCount` 一档），白占一条长连接；
   *   而且本仓的 `webServer` 可能在模块激活之后才 bind（`getOrigin()` 早读会抛）。
   */
  startWakeIfNeeded(fetcher: typeof fetch = fetch): void {
    if (this.stopped) return
    if (this.state.conn === 'live' || this.state.conn === 'connecting') return
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
    const events = cardDoneEventsOf(parsed, wsId)
    let woke = 0
    for (const e of events) {
      if (this.seenIds.has(e.executionId)) continue      // ② 同一张卡的同一次落定 ⇒ 不再叫
      this.seenIds.set(e.executionId, e.at)
      this.trimSeen()
      // 「没人订阅」是**独立一档**：它 ≠ "没有卡跑完"，⛔ 不许合并
      if (this.targets.size === 0) {
        this.state = {
          ...this.state,
          noSubscriberCount: this.state.noSubscriberCount + 1,
          note: `⚠ 有卡跑完（${e.taskId}）但**没有订阅者** ⇒ 这一声没叫出去`
            + '（没人读过本工作区的卡面 ⇒ 不知道叫谁；⛔ 这不等于"没有卡跑完"）',
        }
        this.say(`[card-wake] ${this.state.note}`)
        continue
      }
      const text = wakeMessageOf(e)
      for (const t of this.targets.values()) {
        if (this.deliverFn === undefined) {
          this.state = { ...this.state, note: '⚠ 有卡跑完，但**投递通道没就绪**（hobBus 未提供）⇒ 这一声没叫出去' }
          this.say(`[card-wake] ${this.state.note}`)
          continue
        }
        try {
          await this.deliverFn(t.sessionId, text)
          woke++
          this.state = {
            ...this.state,
            wokeCount: this.state.wokeCount + 1,
            lastWokeAt: this.now(),
            lastWokeCard: e.taskId,
            note: `已叫醒 ${t.sessionId}（${e.taskId} 跑完 · ${e.outcome}）`,
          }
          this.say(`[card-wake] ${this.state.note}`)
        } catch (err) {
          this.state = { ...this.state, note: `⚠ 叫醒 ${t.sessionId} 失败：${String((err as Error)?.message ?? err)}` }
          this.say(`[card-wake] ${this.state.note}`)
        }
      }
    }
    return woke
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
   * @param fetcher - 注入的 `fetch`（机检可换成假的；默认真 `fetch`）。
   */
  start(fetcher: typeof fetch = fetch): void {
    if (this.stopped) return
    const origin = this.opts.origin
    if (origin === undefined || origin === '') {
      this.state = { ...this.state, conn: 'broken', note: '⚠ 拿不到看板地址（webServer 不可用）⇒ **叫醒面没接上**（⛔ 不等于"没有卡跑完"）' }
      this.say(`[card-wake] ${this.state.note}`)
      return
    }
    const url = `${origin.replace(/\/+$/, '')}${BOARD_SSE_PATH}`
    this.state = { conn: 'connecting', url, wokeCount: this.state.wokeCount, noSubscriberCount: this.state.noSubscriberCount, seenCount: 0 }
    this.say(`[card-wake] 正在接 ${url}`)
    void this.loop(url, fetcher)
  }

  /** 断开（模块卸载 / 测试收尾）。 */
  stop(): void {
    this.stopped = true
    try { this.abort?.abort() } catch { /* 已经断了 */ }
    this.abort = undefined
  }

  /** 重连主循环（指数退避，⚠ 每次失败都有一句可读话）。 */
  private async loop(url: string, fetcher: typeof fetch): Promise<void> {
    let backoff = RECONNECT_MIN_MS
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
}

/**
 * 「我自己派出去的实施会话」叫醒面。
 *
 * ⚠ **纯对象、不自己订阅事件**：`observe()` 由 M5 的 `agent/status` 监听喂进来
 *   ⇒ 便于机检用**假状态序列**喂真逻辑（不起真会话）。
 */
export class DispatchWake {
  private readonly sessions = new Map<string, DispatchedSession>()
  private state: DispatchWakeState = { registered: 0, pending: 0, wokeCount: 0, undecidableCount: 0 }
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

  /** 登记一个"我派出去的"会话（已在表里 ⇒ 只补卡/执行信息，**不重置**状态）。 */
  register(entry: {
    sessionId: string
    via: DispatchedSession['via']
    cardId?: string
    executionId?: string
  }): void {
    const id = entry.sessionId
    if (typeof id !== 'string' || id === '') return
    const have = this.sessions.get(id)
    if (have !== undefined) {
      // ⚠ **不覆盖 sawRunning / reported**：重复登记（每读一次卡面就登记一次）不许把状态清掉，
      //   否则"读一次状态行"就能让已经叫过的会话**再叫一次**（刷屏）。
      if (entry.cardId !== undefined) have.cardId = entry.cardId
      if (entry.executionId !== undefined) have.executionId = entry.executionId
      return
    }
    this.sessions.set(id, {
      sessionId: id,
      via: entry.via,
      ...(entry.cardId === undefined ? {} : { cardId: entry.cardId }),
      ...(entry.executionId === undefined ? {} : { executionId: entry.executionId }),
      at: this.now(),
      sawRunning: false,
      reported: false,
      rounds: 0,
    })
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
    try {
      const target = this.opts.selfSessionId
      if (target === undefined || target === '') {
        this.state = { ...this.state, note: '⚠ 有会话跑完，但**没有收件人**（不知道回给谁）⇒ 这一声没叫出去' }
        this.say(`[dispatch-wake] ${this.state.note}`)
        return 'no-subscriber'
      }
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
      this.state = { ...this.state, note: `⚠ 叫醒失败：${String((e as Error)?.message ?? e)}` }
      this.say(`[dispatch-wake] ${this.state.note}`)
      return 'no-channel'
    }
  }

  /** 显式设收件人（M5 在订阅时刷进来 —— 谁的派发就回给谁）。 */
  setSelfSessionId(id: string | undefined): void {
    this.opts.selfSessionId = id
  }
}

/** {@link DispatchWake} 的构造参数。 */
export interface DispatchWakeOpts {
  /** 收件人（派单方自己）；⚠ 缺 ⇒ 叫不出去（落 `no-subscriber`）。 */
  selfSessionId?: string
  /** 投递实现（真环境 = `bus.deliver(id, text, 'followup')`）。 */
  deliver?: (sessionId: string, text: string) => Promise<unknown>
  /** 现取时刻（测试可固定）。 */
  now?: () => number
  /** 可读日志出口（⛔ 不许静默）。 */
  log?: (line: string) => void
}
