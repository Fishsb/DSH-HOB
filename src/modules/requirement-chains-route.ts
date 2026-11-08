/**
 * **需求链 · 只读路由**（2026-11-07 · `R-020`）。
 *
 * 把面板的 `POST /api/dsh-hob/requirement-chains` 接到
 * {@link buildRequirementChains}，数据源与 `/stages` 完全相同：
 * `ledger/units/index.toml` + 同目录 `unit-*.toml` 分片。
 *
 * ── 边界 ────────────────────────────────────────────────────────────────
 *   ① 零写：只读文本并做纯函数投影；
 *   ② 不重复下发正文：只返回链摘要；
 *   ③ `ledger` 参数走同一白名单 `resolveLedgerByName()`；
 *   ④ 非法名字返回 400 `ledger-not-allowed`，⛔ 不静默回落。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { resolveLedgerRoot, ledgerRootWhy } from '../server/doc-read.ts'
import { declaredLedgerHome } from './orchestrator.ts'
import { resolveLedgerByName } from '../shared/ledger-catalog.ts'
import { parseUnitsToml, STAGES_INDEX_REL } from '../shared/stages-index.ts'
import {
  buildRequirementChains,
  type RequirementChainsResponse,
} from '../shared/requirement-chain.ts'

export const name = 'dsh-hob-requirement-chains-route'
export const REQUIREMENT_CHAINS_ROUTE_PATH = '/api/dsh-hob/requirement-chains'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/** 从账本根读取全部单元；返回可分辨失败，⛔ 不把读不到伪装成空账本。 */
export function readUnitsOfLedger(root: string): {
  units: Array<Record<string, unknown>>
  error?: { reason: string; message: string }
} {
  const abs = `${root}/${STAGES_INDEX_REL}`
  const unitsDir = abs.replace(/[\\/]index\.toml$/, '')
  let shardNames: string[]
  try {
    shardNames = readdirSync(unitsDir).filter((n) => /^unit-[^/]+\.toml$/.test(n)).sort()
  } catch (e) {
    return {
      units: [],
      error: {
        reason: 'index-unreadable',
        message: `索引目录读不到（${unitsDir}）：${String((e as Error)?.message ?? e)}`,
      },
    }
  }
  const sources: string[] = []
  for (const path of [abs, ...shardNames.map((n) => `${unitsDir}/${n}`)]) {
    let text: string | undefined
    try {
      text = readFileSync(path, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return {
          units: [],
          error: {
            reason: 'index-unreadable',
            message: `索引文件不存在：\`${path}\` —— ⚠ 这通常意味着这个工作区还没建 \`ledger/\`，⛔ 不是文件坏了`,
          },
        }
      }
      return {
        units: [],
        error: {
          reason: 'index-unreadable',
          message: `索引读不到（${path}）：${String((e as Error)?.message ?? e)}`,
        },
      }
    }
    sources.push(text)
  }
  try {
    return { units: parseUnitsToml(sources.join('\n')) as Array<Record<string, unknown>> }
  } catch (e) {
    return {
      units: [],
      error: {
        reason: 'index-malformed',
        message: `索引不是合法 TOML 子集：${String((e as Error)?.message ?? e)}`,
      },
    }
  }
}

/** 注册只读需求链路由。 */
export function installRequirementChainsRoute(ctx: Context): void {
  const hostCtx = ctx as any
  ctx.inject(['connection'], (svcCtx: any) => {
    try {
      const conn = svcCtx.get?.('connection') ?? svcCtx.connection
      const fetch = conn?.fetch
      if (fetch === undefined || typeof fetch.register !== 'function') {
        hostCtx.logger?.warn?.('[dsh-hob] 宿主 `connection.fetch` 不可用 ⇒ 需求链只读路由未登记')
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
      const ledgerRootByName = (name: unknown): string | undefined =>
        resolveLedgerByName(declaredLedgerHome(hostCtx), name, existsSync)

      const disposer = fetch.register({
        path: REQUIREMENT_CHAINS_ROUTE_PATH,
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
            if (root === undefined || root === '') {
              const why = ledgerRootWhyOf(sessionId)
              return json(400, {
                ok: false,
                reason: 'index-unreadable',
                message: `账本根判不出 ⇒ 不知道该读哪份索引（⛔ 不猜）${why === '' ? '' : `：${why}`}`,
              })
            }
          }
          const read = readUnitsOfLedger(root)
          if (read.error !== undefined) return json(400, { ok: false, ...read.error })
          const out: RequirementChainsResponse = buildRequirementChains(read.units, new Date().toISOString())
          return json(200, out)
        },
      })
      ctx.effect(() => () => { try { disposer?.() } catch { /* 忽略 */ } }, 'dsh-hob: requirement chains read route')
      hostCtx.logger?.info?.(`[dsh-hob] 需求链只读路由已登记：POST ${REQUIREMENT_CHAINS_ROUTE_PATH}`)
    } catch (e) {
      hostCtx.logger?.warn?.(`[dsh-hob] 需求链只读路由登记失败：${String((e as Error)?.message ?? e)}`)
    }
  })
}
