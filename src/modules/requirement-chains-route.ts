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
import {
  parseUnitsToml,
  STAGES_INDEX_REL,
  STAGES_REASON_INDEX_LEGACY,
  STAGES_REASON_LEDGER_MISSING,
} from '../shared/stages-index.ts'
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
    /**
     * ⚠⚠ **2026-11-08 与 `stages-index.ts` 同口径**（用户报「面板全是判不出」）。
     *
     *   改前这里把"目录不存在"也说成 `index-unreadable` + 一段 `ENOENT` 原文 ——
     *   面板于是只能显示「判不出：索引目录读不到…」，读者不知道下一步该**建账**。
     *   ⇒ 与 `STAGES_REASON_LEDGER_MISSING` 同一句话：**还没开账**，去建账本。
     */
    if ((e as { code?: string } | undefined)?.code === 'ENOENT') {
      return {
        units: [],
        error: {
          reason: STAGES_REASON_LEDGER_MISSING,
          message: `这个项目还没有账本（\`${unitsDir}\` 不存在）⇒ 先建账本，再看进度。`,
        },
      }
    }
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
        /** ⚠ 入口缺 = 还没开账；分片缺 = 账本在但残了（两种不同，同 `stages-index.ts`）。 */
        if (path === abs) {
          return {
            units: [],
            error: {
              reason: STAGES_REASON_LEDGER_MISSING,
              message: `这个项目还没有账本入口（\`${path}\` 不存在）⇒ 先建账本，再看进度。`,
            },
          }
        }
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
    /**
     * ⚠ 旧格式（`[meta]` / `[units."ID"]`）≠ 写坏了：它是**已知、可迁移**的形态。
     *   与 `stages-index.ts` 判定同一份正则，⛔ 不许两处各写一套。
     */
    const msg = String((e as Error)?.message ?? e)
    if (/不支持的 TOML 表头\s*"\[(?:meta|units)/.test(msg)) {
      return {
        units: [],
        error: {
          reason: STAGES_REASON_INDEX_LEGACY,
          message: '这本账是旧格式（`[meta]` / `[units."ID"]`），现行面板读不进来 ⇒ 需要按现行 `[[unit]]` 格式迁移。',
        },
      }
    }
    return {
      units: [],
      error: {
        reason: 'index-malformed',
        message: `索引不是合法 TOML 子集：${msg}`,
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
