/**
 * **账本资源只读路由**（P1/P2）。
 *
 * 用途：给面板和开发会话一个稳定的按 ID 读取入口，
 * ⛔ 不再要求调用方读取整份 `units/` 索引。
 *
 * ⚠ 零写：只读账本索引，交 {@link readLedgerResource} 做纯变换。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveLedgerRoot, ledgerRootWhy } from '../server/doc-read.ts'
import { declaredLedgerHome } from './orchestrator.ts'
import { readLedgerResource } from '../shared/ledger-resources.ts'
import { readLedgerUnits } from './tools.ts'

export const name = 'dsh-hob-ledger-resource-route'
export const LEDGER_RESOURCE_ROUTE_PATH = '/api/dsh-hob/ledger-resource'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * 注册只读资源路由。
 *
 * @param ctx - 宿主上下文
 */
export function installLedgerResourceRoute(ctx: Context): void {
  const hostCtx = ctx as any
  ctx.inject(['connection'], (svcCtx: any) => {
    try {
      const conn = svcCtx.get?.('connection') ?? svcCtx.connection
      const fetch = conn?.fetch
      if (fetch === undefined || typeof fetch.register !== 'function') {
        hostCtx.logger?.warn?.('[dsh-hob] 宿主 `connection.fetch` 不可用 ⇒ 账本资源只读路由未登记')
        return
      }
      const ledgerRootOf = (sessionId: string): string | undefined => {
        try {
          const session = hostCtx.get?.('sessions')?.get?.(sessionId)
          const cwd = session?.header?.cwd
          return resolveLedgerRoot('', declaredLedgerHome(hostCtx), typeof cwd === 'string' ? cwd : undefined)
        } catch { return undefined }
      }
      const ledgerRootWhyOf = (sessionId: string): string => {
        try {
          const session = hostCtx.get?.('sessions')?.get?.(sessionId)
          const cwd = session?.header?.cwd
          const why = ledgerRootWhy('', declaredLedgerHome(hostCtx), typeof cwd === 'string' ? cwd : undefined)
          return why.kind === 'ok' ? '' : why.why
        } catch { return '' }
      }
      const disposer = fetch.register({
        path: LEDGER_RESOURCE_ROUTE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request: any) => {
          let body: any
          try {
            const text = typeof request.text === 'function' ? await request.text() : ''
            body = JSON.parse(text === '' ? '{}' : text)
          } catch {
            return json(400, { ok: false, reason: 'bad-request', message: '请求体不是 JSON' })
          }
          const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
          const root = ledgerRootOf(sessionId)
          if (root === undefined) {
            return json(400, { ok: false, reason: 'no-ledger-root', message: ledgerRootWhyOf(sessionId) || '无法确定账本目录' })
          }
          const resource = typeof body?.resource === 'string' ? body.resource : 'current'
          if (resource === 'current') {
            try {
              const text = readFileSync(join(root, 'ledger', 'spec', 'current.md'), 'utf8')
              return json(200, { ok: true, resource: 'current', text, bytes: Buffer.byteLength(text, 'utf8') })
            } catch {
              return json(400, { ok: false, resource: 'current', reason: 'not-found', message: 'Current 页不存在；先运行 npm run gen:ledger' })
            }
          }
          try {
            const units = readLedgerUnits(root)
            return json(200, readLedgerResource(units, resource))
          } catch (e) {
            return json(400, { ok: false, resource, reason: 'index-unreadable', message: String((e as Error)?.message ?? e) })
          }
        },
      })
      ctx.effect(() => () => { try { disposer?.() } catch { /* ignore */ } }, 'dsh-hob: ledger resource read route')
      hostCtx.logger?.info?.(`[dsh-hob] 账本资源只读路由已登记：POST ${LEDGER_RESOURCE_ROUTE_PATH}`)
    } catch (e) {
      hostCtx.logger?.warn?.(`[dsh-hob] 账本资源只读路由登记失败：${String((e as Error)?.message ?? e)}`)
    }
  })
}
