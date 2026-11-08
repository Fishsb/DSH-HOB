/**
 * **账本目录 · 只读路由**（2026-11-07 · `R-020`）。
 *
 * 用途：把 `ledgerHome` 下所有账本（= 面板里的"项目"）交给右侧栏，
 * 供项目切换使用。⛔ 不读账本内容，只数单元行数。
 *
 * ── 边界 ────────────────────────────────────────────────────────────────
 *   ① **零写**：只 `readdirSync` + 读 `ledger/units/*.toml` 数 `[[unit]]`；
 *   ② **不建索引**：⛔ 不解析 TOML，只按行计数（9 个账本也只要毫秒级）；
 *   ③ **不聚合**：⛔ 不返回"全部项目合计"；
 *   ④ **读不了就说读不了**：`readable: false`，⛔ 不当 0。
 *
 * ⚠ 与 `stages-route` 同一套会话 → 工作区解析（`declaredLedgerHome` +
 *   `session.header.cwd`），保证"当前是哪个账本"与"面板读哪个账本"同源。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveLedgerRoot } from '../server/doc-read.ts'
import { declaredLedgerHome } from './orchestrator.ts'
import { buildLedgerCatalog, isSafeLedgerName, type LedgerEntry } from '../shared/ledger-catalog.ts'

export const name = 'dsh-hob-ledgers-route'
export const LEDGERS_ROUTE_PATH = '/api/dsh-hob/ledgers'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * 数一个账本的单元行数。
 *
 * ⚠ 只数 `[[unit]]` 行 —— ⛔ 不解析 TOML、⛔ 不建索引。
 * ⚠ 读不到 `ledger/units/` ⇒ `readable: false`（⛔ 不是 0 单元）。
 */
export function countUnitsOf(ledgerDir: string): { units: number; readable: boolean } {
  const unitsDir = join(ledgerDir, 'ledger', 'units')
  let names: string[]
  try {
    names = readdirSync(unitsDir)
  } catch {
    return { units: 0, readable: false }
  }
  let units = 0
  let readAny = false
  for (const n of names) {
    if (!/^unit-[^/]+\.toml$/.test(n)) continue
    try {
      const text = readFileSync(join(unitsDir, n), 'utf8')
      readAny = true
      for (const line of text.split('\n')) {
        if (line.trim() === '[[unit]]') units += 1
      }
    } catch {
      // ⚠ 单个分片读失败 ⇒ 该账本整体标不可读（⛔ 静默少算）
      return { units: 0, readable: false }
    }
  }
  return { units, readable: readAny }
}

/**
 * 列举 `ledgerHome` 下的账本。
 *
 * @param home - 账本父目录
 * @param currentName - 本会话对应的账本名（判不出则 `undefined`）
 */
export function listLedgers(home: string, currentName: string | undefined): ReturnType<typeof buildLedgerCatalog> {
  let names: string[] = []
  try {
    names = readdirSync(home).filter((n) => isSafeLedgerName(n))
  } catch {
    names = []
  }
  const raw: Array<{ name: string; units: number; readable: boolean }> = []
  for (const n of names) {
    const dir = join(home, n)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    raw.push({ name: n, ...countUnitsOf(dir) })
  }
  return buildLedgerCatalog(home, raw, currentName)
}

/**
 * 注册只读账本目录路由。
 *
 * @param ctx - 宿主上下文
 */
export function installLedgersRoute(ctx: Context): void {
  const hostCtx = ctx as any
  ctx.inject(['connection'], (svcCtx: any) => {
    try {
      const conn = svcCtx.get?.('connection') ?? svcCtx.connection
      const fetch = conn?.fetch
      if (fetch === undefined || typeof fetch.register !== 'function') {
        hostCtx.logger?.warn?.('[dsh-hob] 宿主 `connection.fetch` 不可用 ⇒ 账本目录只读路由未登记')
        return
      }
      /** 本会话对应的账本名（⚠ 与 `stages-route` 同一条解析）。 */
      const currentNameOf = (sessionId: string): string | undefined => {
        try {
          const session = hostCtx.get?.('sessions')?.get?.(sessionId)
          const cwd = session?.header?.cwd
          const root = resolveLedgerRoot('', declaredLedgerHome(hostCtx), typeof cwd === 'string' ? cwd : undefined)
          if (root === undefined) return undefined
          const parts = root.split(/[\\/]/).filter((x: string) => x !== '')
          return parts[parts.length - 1]
        } catch { return undefined }
      }
      const disposer = fetch.register({
        path: LEDGERS_ROUTE_PATH,
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
          const home = declaredLedgerHome(hostCtx)
          if (home === '') {
            return json(400, {
              ok: false,
              reason: 'ledger-home-unreadable',
              message: '账本父目录判不出（`ledgerHome` 未配置）⇒ 不知道该列举哪里（⛔ 不猜）',
            })
          }
          const catalog = listLedgers(home, sessionId === '' ? undefined : currentNameOf(sessionId))
          return json(200, { ok: true, ...catalog })
        },
      })
      ctx.effect(() => () => { try { disposer?.() } catch { /* 忽略 */ } }, 'dsh-hob: ledgers read route')
      hostCtx.logger?.info?.(`[dsh-hob] 账本目录只读路由已登记：POST ${LEDGERS_ROUTE_PATH}`)
    } catch (e) {
      hostCtx.logger?.warn?.(`[dsh-hob] 账本目录只读路由登记失败：${String((e as Error)?.message ?? e)}`)
    }
  })
}
