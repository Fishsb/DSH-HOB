/**
 * Progress panel live channel — the only wire definition shared by Host and client.
 *
 * This channel carries invalidation signals, never business state. A frame says
 * "something under this ledger changed, at this sequence"; the panel still reads
 * the authoritative snapshot routes. Keeping frames small is what prevents the
 * event stream from becoming a fourth source of project truth.
 */

/** Exact authenticated Fetch route below the host `/api` channel. */
export const LIVE_ROUTE_PATH = '/api/dsh-hob/live' as const

/** SSE event names. A closed set: business data does not belong on this wire. */
export const LIVE_EVENT_HELLO = 'hello' as const
export const LIVE_EVENT_CHANGE = 'change' as const

/** Change sources. They select which snapshot views a client should re-read. */
export const LIVE_SOURCES = ['ledger', 'runtime', 'plans', 'session', 'catalog'] as const
export type LiveSource = (typeof LIVE_SOURCES)[number]

/** Stable server tuning values, exported so tests and the client UI can report them. */
export const LIVE_HEARTBEAT_MS = 20_000
export const LIVE_MERGE_MS = 100
export const LIVE_CLIENT_DEBOUNCE_MS = 80
export const LIVE_SAFETY_POLL_MS = 60_000
export const LIVE_RECONNECTING_POLL_MS = 30_000
export const LIVE_PER_LEDGER_LIMIT = 8
export const LIVE_GLOBAL_LIMIT = 32
/** Maximum SSE frame size accepted by either half; prevents unbounded buffers. */
export const LIVE_MAX_FRAME_BYTES = 8 * 1024
/** Maximum bytes retained while waiting for the next frame delimiter. */
export const LIVE_MAX_BUFFER_BYTES = 16 * 1024
/** Maximum number of follow-up snapshot pulls after a refresh was already in flight. */
export const LIVE_MAX_FOLLOW_UP_PULLS = 3

/** First frame after a stream opens. */
export interface LiveHelloFrame {
  revision: number
  ledger: string
  heartbeatMs: number
}

/** One coalesced invalidation. `revision` is per-ledger and only detects gaps. */
export interface LiveChangeFrame {
  revision: number
  ledger: string
  sources: LiveSource[]
  at: number
}

export type LiveFrame =
  | { event: typeof LIVE_EVENT_HELLO; data: LiveHelloFrame }
  | { event: typeof LIVE_EVENT_CHANGE; data: LiveChangeFrame }

/** A parsed SSE frame; comment lines (heartbeats) return `undefined`. */
export function parseLiveFrame(event: string, data: string): LiveFrame | undefined {
  if (typeof data !== 'string' || data.length > LIVE_MAX_FRAME_BYTES) return undefined
  if (event !== LIVE_EVENT_HELLO && event !== LIVE_EVENT_CHANGE) return undefined
  let parsed: unknown
  try { parsed = JSON.parse(data) } catch { return undefined }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const row = parsed as Record<string, unknown>
  if (!Number.isSafeInteger(row.revision) || (row.revision as number) < 0) return undefined
  if (typeof row.ledger !== 'string' || row.ledger === '') return undefined
  if (event === LIVE_EVENT_HELLO) {
    if (!Number.isSafeInteger(row.heartbeatMs) || (row.heartbeatMs as number) <= 0) return undefined
    return { event, data: { revision: row.revision as number, ledger: row.ledger, heartbeatMs: row.heartbeatMs as number } }
  }
  if (!Number.isSafeInteger(row.at) || (row.at as number) < 0) return undefined
  const sources = Array.isArray(row.sources)
    ? [...new Set(row.sources.filter((x): x is LiveSource => typeof x === 'string'
      && (LIVE_SOURCES as readonly string[]).includes(x)))]
    : []
  if (sources.length === 0) return undefined
  return { event, data: { revision: row.revision as number, ledger: row.ledger, sources, at: row.at as number } }
}

/** Serialize one frame to SSE text. `data` is compact JSON on a single line. */
export function serializeLiveFrame(frame: LiveFrame): string {
  const text = `event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`
  if (text.length > LIVE_MAX_FRAME_BYTES) throw new Error('live-frame-too-large')
  return text
}

/** A comment heartbeat keeps proxies from closing an otherwise idle stream. */
export const LIVE_HEARTBEAT_FRAME = ': ping\n\n' as const

