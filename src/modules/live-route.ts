/**
 * Progress panel live channel — authenticated streaming entry.
 *
 * The stream is registered on the host's shared `/api` Fetch channel, so it
 * inherits the existing browser cookie, Host and Origin fences. It carries only
 * invalidation frames; every panel view still reads its authoritative snapshot.
 */
import type { Context } from '@deepseek-ai/cordis'
import { existsSync } from 'node:fs'
import { resolveLedgerRoot, ledgerRootWhy } from '../server/doc-read.ts'
import { declaredLedgerHome } from './orchestrator.ts'
import { resolveLedgerByName } from '../shared/ledger-catalog.ts'
import {
  LIVE_ROUTE_PATH,
  LIVE_EVENT_HELLO,
  LIVE_HEARTBEAT_MS,
  serializeLiveFrame,
} from '../shared/live-protocol.ts'
import type { LiveHub, LiveSink } from '../server/live-hub.ts'

export const name = 'dsh-hob-live-route'
export { LIVE_ROUTE_PATH }

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** Encode one chunk for the stream controller; a closed consumer throws and is handled by cancel. */
function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/**
 * Install the live channel.
 *
 * `hub` is optional so hosts without `connection.fetch` still boot normally;
 * route registration failures are reported by the host and do not break other
 * read-only routes.
 */
export function installLiveRoute(ctx: Context, hub: LiveHub): void {
  const hostCtx = ctx as any
  ctx.inject(['connection'], (svcCtx: any) => {
    try {
      const conn = svcCtx.get?.('connection') ?? svcCtx.connection
      const routes = conn?.fetch
      if (routes === undefined || typeof routes.register !== 'function') {
        hostCtx.logger?.warn?.('[dsh-hob] 宿主 `connection.fetch` 不可用 ⇒ 实时通道未登记')
        return
      }

      const ledgerRootOf = (sessionId: string): { root?: string; reason?: string } => {
        try {
          const session = hostCtx.get?.('sessions')?.get?.(sessionId)
          const cwd = session?.header?.cwd
          const root = resolveLedgerRoot('', declaredLedgerHome(hostCtx), typeof cwd === 'string' ? cwd : undefined)
          if (root !== undefined) return { root }
          const why = ledgerRootWhy('', declaredLedgerHome(hostCtx), typeof cwd === 'string' ? cwd : undefined)
          return { reason: why.kind === 'ok' ? '账本根判不出' : why.why }
        } catch (e) {
          return { reason: `账本根读取失败：${String((e as Error)?.message ?? e)}` }
        }
      }

      const ledgerNameOf = (root: string): string => {
        const parts = root.replace(/\\/g, '/').split('/').filter((x) => x !== '')
        return parts.at(-1) ?? ''
      }

      const route = routes.register({
        path: LIVE_ROUTE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request: Request): Promise<Response> => {
          let body: any
          try {
            const text = typeof request.text === 'function' ? await request.text() : ''
            body = JSON.parse(text === '' ? '{}' : text)
          } catch {
            return json(400, { ok: false, reason: 'bad-request', message: '请求体不是 JSON' })
          }
          const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : ''
          if (sessionId === '') {
            return json(400, { ok: false, reason: 'no-session', message: '实时通道需要 sessionId' })
          }

          let ledgerRoot: string | undefined
          const wanted = body?.ledger
          if (wanted !== undefined && wanted !== null && wanted !== '') {
            ledgerRoot = resolveLedgerByName(declaredLedgerHome(hostCtx), wanted, existsSync)
            if (ledgerRoot === undefined) {
              return json(400, {
                ok: false,
                reason: 'ledger-not-allowed',
                message: `账本名不在白名单内或不存在：${JSON.stringify(String(wanted))}（⛔ 不接受路径）`,
              })
            }
          } else {
            const resolved = ledgerRootOf(sessionId)
            if (resolved.root === undefined) {
              return json(400, { ok: false, reason: 'ledger-unreadable', message: resolved.reason ?? '账本根判不出' })
            }
            ledgerRoot = resolved.root
          }
          const ledger = ledgerNameOf(ledgerRoot)
          if (ledger === '') {
            return json(400, { ok: false, reason: 'ledger-unreadable', message: '账本根没有可识别的名称' })
          }
          /**
           * The hub keeps one ledger name per root globally. A stale binding
           * from another active stream could publish this stream's writes under
           * the wrong project. Reject the conflict explicitly for diagnostics.
           */
          const bound = hub.nameOfRoot(ledgerRoot)
          if (bound !== undefined && bound !== ledger) {
            return json(409, {
              ok: false,
              reason: 'ledger-binding-conflict',
              message: `账本根已绑定为「${bound}」，与本次「${ledger}」不一致（⛔ 不串账本）`,
            })
          }
          const detach = hub.registerLedgerRoot(ledgerRoot, ledger)
          let closed = false
          let unsubscribe: (() => void) | undefined
          let stream: ReadableStream<Uint8Array> | undefined
          const teardown = (): void => {
            if (closed) return
            closed = true
            unsubscribe?.()
            detach()
          }
          stream = new ReadableStream<Uint8Array>({
            start(controller) {
              const sink: LiveSink = {
                write: (text: string): boolean => {
                  if (closed) return false
                  try {
                    controller.enqueue(encode(text))
                    return true
                  } catch {
                    teardown()
                    return false
                  }
                },
                close: (): void => {
                  if (closed) return
                  closed = true
                  try { controller.close() } catch { /* already closed */ }
                },
                signal: request.signal,
              }
              const subscribed = hub.subscribe(ledger, sink)
              if (!subscribed.ok) {
                closed = true
                detach()
                try {
                  controller.enqueue(encode(`event: error\ndata: ${JSON.stringify({
                    ok: false,
                    reason: subscribed.reason ?? 'subscriber-limit',
                    message: subscribed.message ?? '实时通道暂时不可用',
                  })}\n\n`))
                  controller.close()
                } catch { /* consumer vanished */ }
                return
              }
              unsubscribe = subscribed.unsubscribe
              const hello = serializeLiveFrame({
                event: LIVE_EVENT_HELLO,
                data: { revision: subscribed.revision ?? 0, ledger, heartbeatMs: LIVE_HEARTBEAT_MS },
              })
              try { controller.enqueue(encode(hello)) } catch { teardown() }
              if (request.signal.aborted) teardown()
            },
            cancel: () => { teardown() },
          })
          return new Response(stream, {
            status: 200,
            headers: {
              'content-type': 'text/event-stream; charset=utf-8',
              'cache-control': 'no-cache',
              connection: 'keep-alive',
            },
          })
        },
      })
      ctx.effect(() => () => {
        try { void route() } catch { /* teardown must finish */ }
      }, 'dsh-hob: live route')
      hostCtx.logger?.info?.(`[dsh-hob] 实时失效通道已登记：POST ${LIVE_ROUTE_PATH}`)
    } catch (e) {
      hostCtx.logger?.warn?.(`[dsh-hob] 实时通道登记失败：${String((e as Error)?.message ?? e)}`)
    }
  })
}

