/**
 * Progress-panel live invalidation hub.
 *
 * Writers report a ledger + affected views; the hub coalesces bursts into one
 * monotonic change frame and broadcasts it only to streams watching that ledger.
 * It owns no project state and never reads a ledger — the snapshot routes remain
 * authoritative. All lifecycle cleanup is synchronous and tied to subscriptions.
 */
import {
  LIVE_GLOBAL_LIMIT,
  LIVE_HEARTBEAT_MS,
  LIVE_MERGE_MS,
  LIVE_PER_LEDGER_LIMIT,
  LIVE_HEARTBEAT_FRAME,
  serializeLiveFrame,
  type LiveChangeFrame,
  type LiveHelloFrame,
  type LiveSource,
} from '../shared/live-protocol.ts'
import { mergeLiveSources } from '../shared/live-signal.ts'
import { dirname, resolve } from 'node:path'

/** One open event stream. `write` returns false when the consumer applied backpressure. */
export interface LiveSink {
  write(text: string): boolean
  close(): void
  readonly signal?: AbortSignal
}

interface LedgerState {
  revision: number
  pending: Set<LiveSource>
  timer?: ReturnType<typeof setTimeout>
  subscribers: Set<LiveSink>
  /** Per-subscription teardown; keeps abort listeners and counters symmetric. */
  releases: Map<LiveSink, () => void>
}

export interface LiveSubscribeResult {
  ok: boolean
  reason?: 'subscriber-limit'
  message?: string
  unsubscribe?: () => void
  revision?: number
}

/**
 * In-process hub. One instance belongs to the plugin module; disposing it closes
 * every stream and timer without touching ledgers on disk.
 */
export class LiveHub {
  private readonly ledgers = new Map<string, LedgerState>()
  /** Roots this exact hub registered; disposal detaches only these bindings. */
  private readonly boundRoots = new Set<string>()
  private heartbeat?: ReturnType<typeof setInterval>
  private subscriberCount = 0
  private disposed = false

  /** Attach this hub to one canonical ledger root; the returned callback detaches it. */
  registerLedgerRoot(ledgerRoot: string, ledger: string): () => void {
    const key = normalizeLedgerRoot(ledgerRoot)
    if (key === '') return () => {}
    if (ledger === '') return () => {}
    /**
     * Multiple streams can legitimately watch one ledger. Keep the binding
     * until the last stream detaches; deleting it on the first detach would
     * mute every still-open consumer.
     */
    const previous = LIVE_HUB_BY_ROOT.get(key)
    const binding = previous !== undefined && previous.hub === this && previous.ledger === ledger
      ? previous
      : { hub: this, ledger, refs: 0 }
    binding.refs += 1
    this.boundRoots.add(key)
    LIVE_HUB_BY_ROOT.set(key, binding)
    let detached = false
    return () => {
      if (detached) return
      detached = true
      binding.refs -= 1
      if (binding.refs > 0) return
      const current = LIVE_HUB_BY_ROOT.get(key)
      if (current === binding) LIVE_HUB_BY_ROOT.delete(key)
      this.boundRoots.delete(key)
    }
  }

  private stateOf(ledger: string): LedgerState {
    let state = this.ledgers.get(ledger)
    if (state === undefined) {
      state = { revision: 0, pending: new Set(), subscribers: new Set(), releases: new Map() }
      this.ledgers.set(ledger, state)
    }
    return state
  }

  /** Current sequence for a ledger, without allocating a subscription. */
  revisionOf(ledger: string): number {
    return this.ledgers.get(ledger)?.revision ?? 0
  }

  /** The ledger name currently bound to a root, used to reject conflicting streams. */
  nameOfRoot(ledgerRoot: string): string | undefined {
    const key = normalizeLedgerRoot(ledgerRoot)
    return key === '' ? undefined : LIVE_HUB_BY_ROOT.get(key)?.ledger
  }

  /** Open counters used by diagnostics and tests. */
  stats(): { ledgers: number; subscribers: number; timers: number; heartbeat: boolean } {
    let timers = 0
    for (const state of this.ledgers.values()) if (state.timer !== undefined) timers += 1
    return {
      ledgers: this.ledgers.size,
      subscribers: this.subscriberCount,
      timers,
      heartbeat: this.heartbeat !== undefined,
    }
  }

  /**
   * Subscribe one stream to one ledger.
   *
   * The caller writes `hello` itself after this succeeds (it needs the return
   * value in the same response start), then calls `unsubscribe` from abort/close.
   */
  subscribe(ledger: string, sink: LiveSink): LiveSubscribeResult {
    if (this.disposed) return { ok: false, reason: 'subscriber-limit', message: '实时通道正在关闭' }
    const state = this.stateOf(ledger)
    if (state.subscribers.size >= LIVE_PER_LEDGER_LIMIT || this.subscriberCount >= LIVE_GLOBAL_LIMIT) {
      return {
        ok: false,
        reason: 'subscriber-limit',
        message: `实时连接数已达上限（每账本 ${LIVE_PER_LEDGER_LIMIT} 条、全进程 ${LIVE_GLOBAL_LIMIT} 条）⇒ 本次不订阅，请改用定时刷新`,
      }
    }
    let closed = false
    let onAbort: (() => void) | undefined
    const unsubscribe = (): void => {
      if (closed) return
      closed = true
      const removed = state.subscribers.delete(sink)
      state.releases.delete(sink)
      if (!removed) return
      this.subscriberCount -= 1
      if (onAbort !== undefined) {
        try { sink.signal?.removeEventListener('abort', onAbort) } catch { /* signal is optional */ }
      }
      if (state.subscribers.size === 0 && state.timer !== undefined) {
        clearTimeout(state.timer)
        state.timer = undefined
      }
      this.armHeartbeat()
    }
    state.subscribers.add(sink)
    state.releases.set(sink, unsubscribe)
    this.subscriberCount += 1
    if (sink.signal !== undefined) {
      onAbort = unsubscribe
      try { sink.signal.addEventListener('abort', onAbort, { once: true }) } catch { /* optional */ }
      if (sink.signal.aborted) unsubscribe()
    }
    this.armHeartbeat()
    return { ok: true, unsubscribe, revision: state.revision }
  }

  /**
   * Drop one sink through the same idempotent path as an explicit abort. A
   * failed write is not a second kind of unsubscription: if it decremented the
   * counter directly, the later abort listener would decrement it again.
   */
  private dropSubscriber(state: LedgerState, sink: LiveSink): void {
    const release = state.releases.get(sink)
    if (release !== undefined) {
      release()
      return
    }
    /** Defensive fallback for a partially initialized sink. */
    if (state.subscribers.delete(sink)) this.subscriberCount = Math.max(0, this.subscriberCount - 1)
  }

  /**
   * Report a committed change. Repeated reports inside the merge window collapse
   * into one change frame; writes outside it get their own revision.
   */
  publish(ledger: string, sources: readonly LiveSource[]): void {
    if (this.disposed || ledger === '') return
    const state = this.stateOf(ledger)
    for (const source of sources) state.pending.add(source)
    if (state.pending.size === 0) return
    if (state.timer !== undefined) return
    state.timer = setTimeout(() => {
      state.timer = undefined
      if (this.disposed || state.pending.size === 0) return
      const merged = mergeLiveSources([...state.pending])
      state.pending.clear()
      state.revision += 1
      const frame: LiveChangeFrame = { revision: state.revision, ledger, sources: merged, at: Date.now() }
      const text = serializeLiveFrame({ event: 'change', data: frame })
      for (const sink of [...state.subscribers]) {
        try {
          if (!sink.write(text)) {
            /** Backpressure or a dead socket: drop the subscriber, never queue unbounded. */
            try { sink.close() } catch { /* already closed */ }
            this.dropSubscriber(state, sink)
          }
        } catch {
          try { sink.close() } catch { /* already closed */ }
          this.dropSubscriber(state, sink)
        }
      }
      this.armHeartbeat()
    }, LIVE_MERGE_MS)
    /** Timer must not keep the host process alive just to emit a ping. */
    try { (state.timer as any)?.unref?.() } catch { /* optional */ }
  }

  private armHeartbeat(): void {
    if (this.disposed || this.subscriberCount === 0) {
      if (this.heartbeat !== undefined) clearInterval(this.heartbeat)
      this.heartbeat = undefined
      return
    }
    if (this.heartbeat !== undefined) return
    this.heartbeat = setInterval(() => {
      for (const state of this.ledgers.values()) {
        for (const sink of [...state.subscribers]) {
          try {
            if (!sink.write(LIVE_HEARTBEAT_FRAME)) {
              try { sink.close() } catch { /* already closed */ }
              this.dropSubscriber(state, sink)
            }
          } catch {
            try { sink.close() } catch { /* already closed */ }
            this.dropSubscriber(state, sink)
          }
        }
      }
      this.armHeartbeat()
    }, LIVE_HEARTBEAT_MS)
    try { (this.heartbeat as any)?.unref?.() } catch { /* optional */ }
  }

  /** Build the opening frame for a just-opened stream. */
  helloOf(ledger: string): LiveHelloFrame {
    return { revision: this.revisionOf(ledger), ledger, heartbeatMs: LIVE_HEARTBEAT_MS }
  }

  /** Close everything. Called from the plugin effect teardown. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat)
    this.heartbeat = undefined
    for (const state of this.ledgers.values()) {
      if (state.timer !== undefined) clearTimeout(state.timer)
      for (const sink of [...state.subscribers]) {
        try { sink.close() } catch { /* teardown must finish */ }
        this.dropSubscriber(state, sink)
      }
      state.subscribers.clear()
      state.releases.clear()
      state.timer = undefined
      state.pending.clear()
    }
    this.subscriberCount = 0
    for (const key of this.boundRoots) {
      const binding = LIVE_HUB_BY_ROOT.get(key)
      if (binding?.hub === this) LIVE_HUB_BY_ROOT.delete(key)
    }
    this.boundRoots.clear()
    this.ledgers.clear()
  }
}

const LIVE_HUB_BY_ROOT = new Map<string, { hub: LiveHub; ledger: string; refs: number }>()

/**
 * Emit a committed change for a ledger root. A no-op when no progress panel has
 * attached this root; a write must never fail merely because nobody is watching.
 */
export function publishLiveChange(ledgerRoot: string, sources: readonly LiveSource[]): void {
  const key = normalizeLedgerRoot(ledgerRoot)
  if (key === '') return
  const binding = LIVE_HUB_BY_ROOT.get(key)
  if (binding === undefined) return
  binding.hub.publish(binding.ledger, sources)
}

/**
 * Publish a change for an absolute file inside a ledger. Writers often only
 * know the file path, and deriving the root in every writer invites mistakes
 * (`runtime/x.json` is one level below the root, `runtime/work-plans/x.json`
 * two). This helper centralizes that derivation and leaves unknown shapes as
 * a no-op, never throwing from a write path.
 */
export function publishLiveChangeForFile(file: string, sources: readonly LiveSource[]): void {
  if (typeof file !== 'string' || file.trim() === '') return
  let current = resolve(file.trim())
  for (;;) {
    const parent = dirname(current)
    if (parent === current) return
    const binding = LIVE_HUB_BY_ROOT.get(current)
    if (binding !== undefined) {
      binding.hub.publish(binding.ledger, sources)
      return
    }
    current = parent
  }
}

/** Publish when a ledger directory itself appears or disappears (catalog-view change). */
export function publishLiveChangeForLedger(ledgerRoot: string, sources: readonly LiveSource[] = ['catalog']): void {
  publishLiveChange(ledgerRoot, sources)
}

function normalizeLedgerRoot(root: unknown): string {
  if (typeof root !== 'string' || root.trim() === '') return ''
  try { return resolve(root.trim()) } catch { return '' }
}


