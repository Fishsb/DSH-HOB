/**
 * **账本资源只读路由**（P1/P2）。
 *
 * 用途：给面板和开发会话一个稳定的按 ID 读取入口，
 * ⛔ 不再要求调用方读取整份 `units/` 索引。
 *
 * ⚠ 零写：只读账本索引，交 {@link readLedgerResource} 做纯变换。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveLedgerRoot, ledgerRootWhy } from '../server/doc-read.ts'
import { declaredLedgerHome } from './orchestrator.ts'
import { readLedgerResource } from '../shared/ledger-resources.ts'
import { LedgerUnitsReadError, readLedgerUnits } from './tools.ts'
import { resolveLedgerByName } from '../shared/ledger-catalog.ts'
// ── reason 词表**复用**阶段接口的共用常量（⛔ 不复制字面量）───────────────────
//   ⚠ 同一份词表的另两处出口：`/stages`（`stages-index.ts`）、需求链
//     （`requirement-chains-route.ts`）。复制字面量的失败形态是"改一处、另两处静默漂"。
import {
  STAGES_REASON_INDEX_LEGACY,
  STAGES_REASON_INDEX_MALFORMED,
  STAGES_REASON_INDEX_UNREADABLE,
  STAGES_REASON_LEDGER_MISSING,
} from '../shared/stages-index.ts'

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
      /** ⚠ 指定账本（白名单校验，⛔ 不接受路径）—— 同 `stages-route` 口径。 */
      const ledgerRootByName = (name: unknown): string | undefined =>
        resolveLedgerByName(declaredLedgerHome(hostCtx), name, existsSync)
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
          const wanted = body?.ledger
          let root: string | undefined
          if (wanted !== undefined && wanted !== null && wanted !== '') {
            root = ledgerRootByName(wanted)
            if (root === undefined) {
              return json(400, {
                ok: false,
                reason: 'ledger-not-allowed',
                message: `账本名不在白名单内或不存在：${JSON.stringify(String(wanted))}（⛔ 不接受路径）`,
              })
            }
          } else {
            root = ledgerRootOf(sessionId)
          }
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
            /**
             * ⚠ **四族成因⛔ 不许压成一句**：下一步动作完全不同 ——
             *   `ledger-missing`（去建账）/ `index-legacy`（去迁移）/
             *   `index-malformed`（去修那一行）/ `index-unreadable`（去查权限 / 磁盘）。
             * ⚠ `reason` 复用 `stages-index.ts` 的 `STAGES_REASON_*` 共用词表，⛔ 不复制字面量。
             * ⚠ 兜底也**不冒充"这条不存在"**：旧行为把解析失败压成 `index-unreadable`、
             *   再让纯函数回 `not-found` ⇒ 「账本读不进来」与「这条单元不存在」不可分辨。
             */
            const err = e as { reason?: unknown; message?: unknown } | null
            const reason = e instanceof LedgerUnitsReadError
              ? e.reason
              : (typeof err?.reason === 'string' ? err.reason : '')
            const detail = String(err?.message ?? e)
            if (reason === STAGES_REASON_LEDGER_MISSING) {
              return json(400, {
                ok: false, resource, reason: STAGES_REASON_LEDGER_MISSING,
                message: `账本里没有 \`ledger/units/\`（或没有入口 \`index.toml\`）⇒ 先建账，再看资源（${detail}）`,
              })
            }
            if (reason === STAGES_REASON_INDEX_LEGACY) {
              return json(400, {
                ok: false, resource, reason: STAGES_REASON_INDEX_LEGACY,
                message: `这本账是旧格式（\`[meta]\` / \`[units."ID"]\`），现行读取器读不进来 ⇒ 先按现行 \`[[unit]]\` 格式迁移（${detail}）`,
              })
            }
            if (reason === STAGES_REASON_INDEX_MALFORMED) {
              return json(400, {
                ok: false, resource, reason: STAGES_REASON_INDEX_MALFORMED,
                message: `账本单元不是合法 TOML 子集 ⇒ 先按 \`[[unit]]\` 格式修那一行（${detail}）`,
              })
            }
            return json(400, {
              ok: false, resource, reason: STAGES_REASON_INDEX_UNREADABLE,
              message: `账本单元读不出来（权限 / 磁盘 / 路径上挡了东西）⇒ 先查那个原因（${detail}）`,
            })
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
