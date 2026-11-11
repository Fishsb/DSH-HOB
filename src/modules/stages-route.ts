/**
 * **阶段清单 · 只读路由**（2026-10-30 · P3 · `TASK-P3.md` §二①）。
 *
 * 把面板的 `POST /api/dsh-hob/stages` 接到 {@link handleStages}，数据源 = `ledger/units/` 的索引分片。
 * ⚠ **⛔ 不再读 `volumes/tasks/INDEX.md`**（那份散文账已不再是状态载体）。
 * ⚠ 分工与其它两条路由同构：归一/汇总在 `src/shared/stages-index.ts`（纯函数），本文件只做宿主接线。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { resolveLedgerRoot, ledgerRootWhy } from '../server/doc-read.ts'
import { declaredLedgerHome } from './orchestrator.ts'
import { resolveLedgerByName } from '../shared/ledger-catalog.ts'
import {
  handleStages,
  STAGES_INDEX_REL,
  type StagesResponse,
} from '../shared/stages-index.ts'

export const name = 'dsh-hob-stages-route'

/** 本路由路径（⚠ 与 `tasks-progress` / `exec-progress` 同族，⛔ 不撞名）。 */
export const STAGES_ROUTE_PATH = '/api/dsh-hob/stages'

/** 统一 JSON 响应。 */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * 注册这条只读路由（照 `installExecProgressRoute` 的既有形态）。
 *
 * @param ctx - 宿主上下文
 */
export function installStagesRoute(ctx: Context): void {
  const hostCtx = ctx as any
  ctx.inject(['connection'], (svcCtx: any) => {
    try {
      const conn = svcCtx.get?.('connection') ?? svcCtx.connection
      const fetch = conn?.fetch
      if (fetch === undefined || typeof fetch.register !== 'function') {
        hostCtx.logger?.warn?.('[dsh-hob] 宿主 `connection.fetch` 不可用 ⇒ 阶段清单**只读路由未登记**')
        return
      }
      /**
       * 会话 → **账本根**（⚠ 2026-10-30 P4：`ledger/` 已搬进账本区）。
       * ⚠ 与 `tasks-progress-route` / `exec-progress-route` **同一条派生**
       *   （`D1`①：读侧与写侧必须用同一个解析入口）。
       * ⛔ 不把工作区根当备选 —— 那会两处真相（A 处读到旧树、B 处读到新树）。
       */
      const ledgerRootOf = (sessionId: string): string | undefined => {
        try {
          const session = (() => {
            try { return hostCtx.get?.('sessions')?.get?.(sessionId) } catch { return undefined }
          })()
          const cwd = session?.header?.cwd
          return resolveLedgerRoot('', declaredLedgerHome(hostCtx), typeof cwd === 'string' ? cwd : undefined)
        } catch { return undefined }
      }
      /**
       * ⚠ **指定账本**（2026-11-07 · `R-020`）：面板切到别的账本时用。
       *   走 {@link resolveLedgerByName} 的**白名单校验** —— ⛔ 不接受路径，
       *   只接受 `ledgerHome` 下真实存在的单段目录名；`../` 与绝对路径一律拒。
       */
      const ledgerRootByName = (name: unknown): string | undefined =>
        resolveLedgerByName(declaredLedgerHome(hostCtx), name, existsSync)
      const ledgerRootWhyOf = (sessionId: string): string => {
        try {
          const session = (() => {
            try { return hostCtx.get?.('sessions')?.get?.(sessionId) } catch { return undefined }
          })()
          const cwd = session?.header?.cwd
          const why = ledgerRootWhy('', declaredLedgerHome(hostCtx), typeof cwd === 'string' ? cwd : undefined)
          return why.kind === 'ok' ? '' : why.why
        } catch { return '' }
      }
      const disposer = fetch.register({
        path: STAGES_ROUTE_PATH,
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
          /**
           * ⚠ 指定了 `ledger` ⇒ 用它；**非法名字必须拒绝**（⛔ 静默回落到 cwd 派生，
           *   那会让"切到不存在的账本"看起来像"切换成功"）。
           */
          const wanted = body?.ledger
          let byName: string | undefined
          if (wanted !== undefined && wanted !== null && wanted !== '') {
            byName = ledgerRootByName(wanted)
            if (byName === undefined) {
              return json(400, {
                ok: false,
                reason: 'ledger-not-allowed',
                message: `账本名不在白名单内或不存在：${JSON.stringify(String(wanted))}（⛔ 不接受路径）`,
              })
            }
          }
          const out: StagesResponse = handleStages(
            {
              workRootOf: byName === undefined ? ledgerRootOf : () => byName,
              workRootWhyOf: ledgerRootWhyOf,
              /** ⚠ 状态源 = `ledger/units/`；这里给出稳定入口 `index.toml`，分片另行列举。 */
              indexPathOf: (ledgerRoot: string) => `${ledgerRoot}/${STAGES_INDEX_REL}`,
              unitShardPathsOf: (unitsDir: string) => readdirSync(unitsDir)
                .filter((name) => /^unit-[^/]+\.toml$/.test(name))
                .sort()
                .map((name) => `${unitsDir}/${name}`),
              readText: (abs: string) => {
                try { return readFileSync(abs, 'utf8') } catch (e) {
                  if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined
                  throw e
                }
              },
            },
            body,
          )
          return json(out.ok ? 200 : 400, out)
        },
      })
      ctx.effect(() => () => { try { disposer?.() } catch { /* 忽略 */ } }, 'dsh-hob: stages read route')
      hostCtx.logger?.info?.(`[dsh-hob] 阶段清单只读路由已登记：POST ${STAGES_ROUTE_PATH}`)
    } catch (e) {
      hostCtx.logger?.warn?.(`[dsh-hob] 阶段清单只读路由登记失败：${String((e as Error)?.message ?? e)}`)
    }
  })
}
