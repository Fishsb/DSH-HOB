/**
 * 持久副作用队列（Effects/Outbox 的最小可用核心）。
 *
 * 目标：把“业务记录已落盘”和“外部动作已执行”分开，并让后者可重试、可恢复。
 * ⚠ 本文件只负责队列状态与执行；具体派发、投递、唤醒由调用方注册 handler。
 * ⚠ 生产落点仍在账本区 `runtime/`（不进 git）；本模块不自行选择账本根。
 */
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'

export type EffectKind = string

export interface EffectRow {
  kind: EffectKind
  key: string
  payload: unknown
  seq: number
  generation: number
  attempts: number
  dueAt: number
  lastError?: string
}

export interface EffectState {
  version: 1
  nextSeq: number
  rows: EffectRow[]
}

export interface EffectHandler {
  run: (payload: unknown, key: string) => Promise<void>
  /** 初始与最大退避毫秒。 */
  retry: readonly [number, number]
  /** 同 kind 一次执行多少条。 */
  limit?: number
  /** 是否严格按 seq 顺序执行。 */
  ordered?: boolean
}

export interface EffectQueueOptions {
  now?: () => number
  onError?: (kind: string, error: unknown) => void
  /** 锁文件路径；仅测试需要，生产固定为 `<queue>.lock`。 */
  lockPath?: string
  /**
   * 是否持有本队列文件的**独占 writer 锁**。
   *
   * ⚠ 默认开启。同一个 Node 进程里应通过 {@link openEffectsQueue} 共享实例；
   * 独立构造第二个实例会因拿不到锁而拒绝启动，⛔ 不许两个 read-modify-write
   * 循环同时写同一文件（那会静默丢更新）。
   */
  exclusive?: boolean
  /**
   * 判断锁里记的 pid 是否**仍活着**。
   *
   * ⚠ 只用于处理"进程异常退出留下的陈旧锁"：返回 `false` 才允许原子接管；
   *   返回 `undefined`（宿主不支持 / 判不出）时**保持 fail-closed**。
   *   默认用 `process.kill(pid, 0)` 判活（Linux/WSL）；测试可注入。
   */
  isProcessAlive?: (pid: number) => boolean | undefined
}

const EMPTY: EffectState = { version: 1, nextSeq: 1, rows: [] }
const LIVE = new Map<string, EffectsQueue>()

interface LockRecord {
  pid?: unknown
  identity?: unknown
  at?: unknown
}

/** 本机判活；无权限发信号仍说明进程存在，异常则判不出。 */
export function procProcessAlive(pid: number): boolean | undefined {
  try {
    process.kill(pid, 0)
    return true
  } catch (e: any) {
    /** `EPERM` = 进程在，只是当前用户无权发信号。 */
    if (e?.code === 'EPERM') return true
    if (e?.code === 'ESRCH') return false
    return undefined
  }
}

function load(path: string): EffectState {
  try {
    const text = readFileSync(path, 'utf8')
    const parsed = JSON.parse(text) as Partial<EffectState>
    if (parsed.version !== 1 || !Array.isArray(parsed.rows) || typeof parsed.nextSeq !== 'number') return { ...EMPTY, rows: [] }
    return { version: 1, nextSeq: parsed.nextSeq, rows: parsed.rows as EffectRow[] }
  } catch {
    return { ...EMPTY, rows: [] }
  }
}

/**
 * 持久效果队列。
 *
 * ⚠ `enqueue` 同 `(kind,key)` 会原地更新 payload 并递增 generation；
 *   一次正在跑的旧 generation 成功时不得删除新 generation 的行。
 */
export class EffectsQueue {
  private state: EffectState
  private readonly handlers = new Map<string, EffectHandler>()
  private readonly tasks = new Map<string, Promise<void>>()
  private readonly path: string
  private readonly now: () => number
  private readonly onError: (kind: string, error: unknown) => void
  private readonly isProcessAlive: (pid: number) => boolean | undefined
  private readonly replaced = new Set<string>()
  private started = false
  private stopped = false
  private readonly lockPath: string | undefined
  private readonly lockIdentity: string
  private lockHeld = false

  constructor(path: string, opts: EffectQueueOptions = {}) {
    this.path = path
    this.lockIdentity = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`
    this.lockPath = opts.exclusive === false ? undefined : (opts.lockPath ?? `${path}.lock`)
    this.isProcessAlive = opts.isProcessAlive ?? procProcessAlive
    if (this.lockPath !== undefined) this.acquireLock()
    this.state = load(path)
    this.now = opts.now ?? (() => Date.now())
    this.onError = opts.onError ?? (() => {})
  }

  /**
   * 跨进程的**单写者锁**：`open(..., 'wx')` 原子占位。
   *
   * ⚠ 不等待、不抢锁：拿不到就抛 `effect-queue-locked`。调用方必须把
   * 「判不出 / 已有 writer」如实报出去，⛔ 不许退回共享写。
   * 锁文件记录 pid 与 identity，便于诊断；进程正常关闭时由 {@link drain} 清理。
   *
   * ⚠⚠ **异常退出恢复**：`open(...,'wx')` 只提供原子占位，进程崩溃时内核不会
   *   替我们删这个文件。若永远只看 `EEXIST`，一条陈旧锁会让队列**永久拒绝投递**。
   *   ⇒ 读锁里的 pid，并由调用方可注入的判活器确认：
   *     · **确认已死** ⇒ 把旧锁原子改名到唯一 quarantine 路径，再重试 `wx`；
   *     · **仍活着 / 判不出 / 锁内容坏** ⇒ 原样 fail-closed（⛔ 不按年龄猜）。
   */
  private acquireLock(): void {
    mkdirSync(dirname(this.lockPath!), { recursive: true })
    let fd: number
    try {
      fd = openSync(this.lockPath!, 'wx')
    } catch (e: any) {
      if (e?.code === 'EEXIST') {
        const recovered = this.recoverAbandonedLock()
        if (!recovered) {
          throw new Error(`effect-queue-locked: ${this.path} 已有独占 writer（锁：${this.lockPath}）`)
        }
        try {
          fd = openSync(this.lockPath!, 'wx')
        } catch (retry: any) {
          if (retry?.code === 'EEXIST') {
            throw new Error(`effect-queue-locked: ${this.path} 锁接管竞争失败，另一 writer 已占位（锁：${this.lockPath}）`)
          }
          throw retry
        }
      } else {
        throw e
      }
    }
    try {
      writeFileSync(fd, JSON.stringify({ pid: process.pid, identity: this.lockIdentity, at: Date.now() }))
    } finally {
      closeSync(fd)
    }
    this.lockHeld = true
  }

  /**
   * 只在**确认锁主已死**时隔离陈旧锁。
   *
   * ⚠ 用 `rename` 而不是直接 `unlink`：即便判活与死亡之间存在极小竞争窗口，
   *   也只会把别人刚写的新锁挪到 quarantine，不会让两个 writer 同时持有原路径。
   * ⚠ quarantine 文件名唯一；若同目录残留，`readdirSync` 不参与判断，不会误接管。
   */
  private recoverAbandonedLock(): boolean {
    let rec: LockRecord
    try {
      rec = JSON.parse(readFileSync(this.lockPath!, 'utf8')) as LockRecord
    } catch {
      return false
    }
    const pid = typeof rec.pid === 'number' && Number.isSafeInteger(rec.pid) && rec.pid > 0 ? rec.pid : undefined
    if (pid === undefined) return false
    /** ⚠ 本进程内已有同路径实例时，那一定是活锁；判活器不参与这种特例。 */
    if (pid === process.pid) return false
    let alive: boolean | undefined
    try { alive = this.isProcessAlive(pid) } catch { alive = undefined }
    if (alive !== false) return false
    const quarantine = `${this.lockPath}.stale-${pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    try {
      renameSync(this.lockPath!, quarantine)
      return true
    } catch {
      return false
    }
  }

  private releaseLock(): void {
    if (!this.lockHeld || this.lockPath === undefined) return
    this.lockHeld = false
    try {
      const raw = JSON.parse(readFileSync(this.lockPath, 'utf8')) as { identity?: string }
      if (raw.identity === this.lockIdentity) rmSync(this.lockPath, { force: true })
    } catch {
      /** 锁文件读不了不冒险删别人的锁；保留给人工/下一进程判断。 */
    }
  }

  /** 注册一种效果；同 kind 重复注册直接报错（避免两个执行者抢同一条队列）。 */
  handle(kind: string, handler: EffectHandler): void {
    if (this.handlers.has(kind)) throw new Error(`effect handler already registered: ${kind}`)
    this.handlers.set(kind, handler)
  }

  /** 事务/记录后的入队入口；同键合并但不改变原队列位置。 */
  enqueue(kind: string, key: string, payload: unknown): void {
    const current = this.state.rows.find((r) => r.kind === kind && r.key === key)
    if (current !== undefined) {
      current.payload = payload
      current.generation += 1
      current.attempts = 0
      current.dueAt = this.now()
      delete current.lastError
      if (this.tasks.has(`${kind}:${key}`)) this.replaced.add(`${kind}:${key}`)
    } else {
      this.state.rows.push({
        kind, key, payload, seq: this.state.nextSeq++, generation: 1,
        attempts: 0, dueAt: this.now(),
      })
    }
    this.persist()
    this.kick()
  }

  pending(kind?: string, key?: string): EffectRow[] {
    return this.state.rows.filter((r) => (kind === undefined || r.kind === kind)
      && (key === undefined || r.key === key))
  }

  /** 撤掉尚未开始的同键效果；已在运行的 attempt 会自行按代际结束。 */
  cancel(kind: string, key: string): boolean {
    const before = this.state.rows.length
    this.state.rows = this.state.rows.filter((r) => !(r.kind === kind && r.key === key))
    if (this.state.rows.length === before) return false
    this.persist()
    this.kick()
    return true
  }

  start(): void {
    this.started = true
    this.kick()
  }

  /** 等当前队列空闲；用于测试和关闭前收口。 */
  async idle(kind?: string): Promise<void> {
    for (;;) {
      this.kick()
      const running = [...this.tasks.entries()]
        .filter(([k]) => kind === undefined || k.startsWith(`${kind}:`))
        .map(([, p]) => p)
      const now = this.now()
      const ready = this.state.rows.some((r) => (kind === undefined || r.kind === kind) && r.dueAt <= now)
      if (running.length === 0 && !ready) return
      if (running.length === 0) {
        await this.dispatch()
        await new Promise((r) => setTimeout(r, 0))
        continue
      }
      await Promise.allSettled(running)
    }
  }

  /** 停止新执行，保留未完成行供下次启动恢复。 */
  async drain(): Promise<void> {
    this.stopped = true
    await Promise.allSettled([...this.tasks.values()])
    this.releaseLock()
    if (LIVE.get(this.path) === this) LIVE.delete(this.path)
  }

  private kick(): void {
    if (!this.started || this.stopped) return
    queueMicrotask(() => { void this.dispatch() })
  }

  private async dispatch(): Promise<void> {
    if (!this.started || this.stopped) return
    let launched = false
    for (const [kind, handler] of this.handlers) {
      const running = [...this.tasks.entries()]
        .filter(([k]) => k.startsWith(`${kind}:`))
        .map(([k]) => k.slice(kind.length + 1))
      /**
       * ordered 队列必须看**整个 kind 的最早一行**：它退避时，后续行也不得越队。
       * 非 ordered 才只挑已到期行。
       */
      const allOfKind = this.state.rows
        .filter((r) => r.kind === kind)
        .sort((a, b) => a.seq - b.seq)
      let ready = handler.ordered === true
        ? (running.length > 0 || allOfKind.length === 0 || allOfKind[0]!.dueAt > this.now()
            ? []
            : [allOfKind[0]!])
        : allOfKind.filter((r) => r.dueAt <= this.now() && !running.includes(r.key))
      const limit = Math.max(1, handler.limit ?? 1) - running.length
      for (const row of ready.slice(0, Math.max(0, limit))) {
        this.run(kind, handler, row)
        launched = true
      }
    }
    if (launched) await new Promise((r) => setTimeout(r, 0))
  }

  private run(kind: string, handler: EffectHandler, row: EffectRow): void {
    const mapKey = `${kind}:${row.key}`
    const gen = row.generation
    let resolveTask!: () => void
    const done = new Promise<void>((r) => { resolveTask = r })
    this.tasks.set(mapKey, done)
    void (async () => {
      try {
        await handler.run(row.payload, row.key)
        const i = this.state.rows.findIndex((r) => r.kind === kind && r.key === row.key)
        const wasReplaced = this.replaced.delete(`${kind}:${row.key}`)
        if (!wasReplaced && i >= 0 && this.state.rows[i]!.generation === gen) this.state.rows.splice(i, 1)
        this.persist()
      } catch (error) {
        if (this.stopped) return
        const current = this.state.rows.find((r) => r.kind === kind && r.key === row.key)
        if (current === undefined || current.generation !== gen) return
        current.attempts += 1
        current.lastError = String(error)
        const [initial, max] = handler.retry
        current.dueAt = this.now() + Math.min(max, initial * 2 ** Math.min(current.attempts - 1, 16))
        this.persist()
        this.onError(kind, error)
      } finally {
        this.tasks.delete(mapKey)
        resolveTask()
        this.kick()
      }
    })()
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      /** 同进程只有一个 writer，但不同账本可能落在同名临时文件名上，故带进程号。 */
      const tmp = `${this.path}.tmp-${process.pid}`
      writeFileSync(tmp, JSON.stringify(this.state, null, 2))
      renameSync(tmp, this.path)
    } catch (error) {
      this.onError('persist', error)
    }
  }
}

/**
 * 同进程内按队列文件复用唯一实例。
 *
 * ⚠ 多个 Hob 会话共享同一个账本根时必须走这里；直接 `new EffectsQueue`
 * 会尝试再次获取独占锁并按失败处理。`factory` 只在首次打开时执行，
 * 后一次调用复用同一实例 —— 这与「一个账本根一个 writer」是同一件事。
 */
export function openEffectsQueue(
  path: string,
  factory: () => EffectsQueue = () => new EffectsQueue(path),
): EffectsQueue {
  const found = LIVE.get(path)
  if (found !== undefined) return found
  const q = factory()
  LIVE.set(path, q)
  return q
}
