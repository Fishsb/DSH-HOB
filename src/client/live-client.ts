/**
 * Progress-panel live client: a fetch-based SSE reader with invalidation semantics.
 *
 * It deliberately keeps no business state. A frame says "this ledger changed";
 * the caller responds by reading the authoritative snapshot. Revision gaps and
 * reconnects force one full snapshot so a missed frame can never strand the UI.
 */
import {
  LIVE_CLIENT_DEBOUNCE_MS,
  LIVE_MAX_BUFFER_BYTES,
  LIVE_MAX_FRAME_BYTES,
  LIVE_ROUTE_PATH,
  LIVE_EVENT_HELLO,
  parseLiveFrame,
  type LiveFrame,
} from '../shared/live-protocol.ts'

export type LiveConnectionState = 'connecting' | 'live' | 'reconnecting' | 'fallback'

export interface LiveClientOptions {
  sessionId?: string
  ledger?: string
  /** Called after a coalesced change or a gap; the caller re-reads snapshots. */
  onChange: () => void
  /** Called whenever the transport moves between connecting / live / reconnecting / fallback. */
  onState?: (state: LiveConnectionState) => void
  /** Override for tests; production uses the same-origin fetch. */
  fetch?: typeof fetch
  /** Override for tests; production uses the protocol debounce. */
  debounceMs?: number
  /** Maximum reconnect backoff; tests use short values. */
  maxBackoffMs?: number
}

/** One live connection. `start()` is explicit so a React effect owns its lifetime. */
export interface LiveClient {
  start(): void
  stop(): void
  state(): LiveConnectionState
  /** Subscribe to transport transitions. Returns an unsubscribe callback. */
  onStateChange(listener: (state: LiveConnectionState) => void): () => void
}

/** Exposed only to the panel's test seam: callbacks cannot reach a jsdom fixture otherwise. */
export interface TestableLiveClient extends LiveClient {
  /** Deliver an invalidation through the production debounce path. */
  __invalidateForTest?: () => void
}

/** Split an SSE byte stream into complete frames and dispatch each one. */
async function readFrames(
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: LiveFrame) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      /**
       * A peer that never sends a delimiter must not grow the panel's memory
       * without bound. Drop the oversized buffer and end this connection; the
       * reconnect path then takes a fresh snapshot.
       */
      if (buffer.length > LIVE_MAX_BUFFER_BYTES) throw new Error('live-buffer-too-large')
      let split = buffer.indexOf('\n\n')
      while (split >= 0) {
        const block = buffer.slice(0, split)
        buffer = buffer.slice(split + 2)
        /**
         * An oversized frame is not a valid invalidation. End this stream so
         * the caller reconnects with backoff instead of silently skipping a
         * potentially compromised peer forever.
         */
        if (block.length > LIVE_MAX_FRAME_BYTES) throw new Error('live-frame-too-large')
        let event = 'message'
        const data: string[] = []
        for (const line of block.split('\n')) {
          if (line === '' || line.startsWith(':')) continue
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
        }
        if (data.length > 0) {
          const parsed = parseLiveFrame(event, data.join('\n'))
          if (parsed !== undefined) onFrame(parsed)
        }
        split = buffer.indexOf('\n\n')
      }
    }
  } finally {
    try { await reader.cancel() } catch { /* already cancelled */ }
    if (signal.aborted) return
  }
}

/**
 * Create one live client. Reconnect attempts are bounded by exponential backoff;
 * after repeated failures the client reports `fallback` so the panel can keep
 * refreshing on a slower timer instead of silently freezing.
 */
export function createLiveClient(options: LiveClientOptions): TestableLiveClient {
  const fetchImpl = options.fetch ?? fetch
  const debounceMs = options.debounceMs ?? LIVE_CLIENT_DEBOUNCE_MS
  const maxBackoff = options.maxBackoffMs ?? 30_000
  let current: LiveConnectionState = 'connecting'
  let running = false
  let controller: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let lastRevision: number | undefined
  let failures = 0
  let connectionToken = 0
  const listeners = new Set<(state: LiveConnectionState) => void>()

  const setState = (state: LiveConnectionState): void => {
    if (current === state) return
    current = state
    options.onState?.(state)
    for (const listener of [...listeners]) {
      try { listener(state) } catch { /* one observer must not stop the transport */ }
    }
  }
  const flush = (): void => {
    timer = undefined
    if (!running) return
    options.onChange()
  }
  const invalidate = (): void => {
    if (timer !== undefined) return
    timer = setTimeout(flush, debounceMs)
    try { (timer as any)?.unref?.() } catch { /* browser timers have no unref */ }
  }
  const scheduleReconnect = (): void => {
    if (!running || reconnectTimer !== undefined) return
    failures += 1
    if (failures >= 3) setState('fallback')
    else setState('reconnecting')
    const delay = Math.min(maxBackoff, 500 * 2 ** Math.max(0, failures - 1))
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      if (running) void connect()
    }, delay)
    try { (reconnectTimer as any)?.unref?.() } catch { /* browser timers have no unref */ }
  }
  const connect = async (): Promise<void> => {
    if (!running) return
    /**
     * Only the newest attempt may mutate transport state. A superseded attempt
     * can finish after stop()+start() or a ledger switch; without this token it
     * would install its old stream and report `live` for the wrong ledger.
     */
    const token = ++connectionToken
    const local = new AbortController()
    controller = local
    setState(current === 'fallback' ? 'reconnecting' : 'connecting')
    try {
      const response = await fetchImpl(LIVE_ROUTE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(options.sessionId === undefined || options.sessionId === '' ? {} : { sessionId: options.sessionId }),
          ...(options.ledger === undefined || options.ledger === '' ? {} : { ledger: options.ledger }),
        }),
        signal: local.signal,
      })
      if (!response.ok) throw new Error(`live HTTP ${response.status}`)
      if (response.body === null) throw new Error('live response has no body')
      let sawHello = false
      await readFrames(response.body, (frame) => {
        if (!running || token !== connectionToken) return
        /**
         * A frame for a different ledger is not evidence about this panel. Drop
         * it and force a full snapshot; accepting it would refresh the UI after
         * a server-side routing mistake while showing the wrong project's data.
         */
        if (options.ledger !== undefined && options.ledger !== '' && frame.data.ledger !== options.ledger) {
          invalidate()
          return
        }
        if (frame.event === LIVE_EVENT_HELLO) {
          sawHello = true
          failures = 0
          setState('live')
          /**
           * The mount snapshot and this stream are not atomic. A write between
           * them advances the server revision before hello, and no change frame
           * will ever announce it. Re-read once on every hello: the extra pull
           * is cheap, while missing that write would leave a panel showing a
           * state that never existed. Reconnects need it for the same reason
           * (frames written while disconnected cannot be replayed, and a host
           * restart can reset the sequence).
           */
          invalidate()
          lastRevision = frame.data.revision
          return
        }
        const revision = frame.data.revision
        if (!sawHello || (lastRevision !== undefined && revision !== lastRevision + 1)) invalidate()
        lastRevision = revision
        invalidate()
      }, local.signal)
      /** Normal end of a finite test/stream response is still a disconnect. */
      if (running && token === connectionToken) scheduleReconnect()
    } catch {
      if (running && token === connectionToken) scheduleReconnect()
    }
  }

  return {
    start(): void {
      if (running) return
      running = true
      failures = 0
      lastRevision = undefined
      setState('connecting')
      void connect()
    },
    stop(): void {
      running = false
      connectionToken += 1
      controller?.abort()
      controller = undefined
      if (timer !== undefined) clearTimeout(timer)
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
      timer = undefined
      reconnectTimer = undefined
    },
    state(): LiveConnectionState {
      return current
    },
    onStateChange(listener: (state: LiveConnectionState) => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    /** Test seam used by the DOM fixture; production callers never need it. */
    __invalidateForTest: invalidate,
  }
}
