/**
 * **执行态 · 只读路由**（2026-10-30 · 第 17 轮 · 任务书 §一B）。
 *
 * ══ 它做什么 ═══════════════════════════════════════════════════════════════════
 *   把面板的 `POST /api/dsh-hob/exec-progress` 接到 {@link handleExecProgress}，
 *   读的是编排自己的运行态 `runtime/orch-watches.json`，按**封闭**线格式送出：
 *     `{ ok:true, readAt, source, items:[{ target, state, elapsedMs?, rechecks }] }`
 *
 * ══ 分工（与 `tasks-progress-route.ts` 同一条）══════════════════════════════════
 *   · **归一 + 处理体**在 `src/shared/exec-progress.ts`（纯函数、零 I/O）
 *     ⇒ 机检可**直接 import 真源码**跑三种情形，不用伪造 cordis 上下文；
 *   · 本文件只做**宿主接线**：取会话 → 账本根 → 读盘 → 交给纯函数。
 *
 * ══ 硬纪律 ═════════════════════════════════════════════════════════════════════
 *   ① **⛔ 不自造第二份运行态**（`D1`①）：只读 `orch-state.ts` 那一条路径，
 *      由 `orchStateFileOf()` **派生**（⛔ 不在此拼 `'runtime/orch-watches.json'` 字面量）；
 *   ② **账本根只走既有唯一解析入口**：`resolveLedgerRoot('', declaredLedgerHome(hostCtx), cwd)`
 *      —— 与 `tasks-progress-route.ts:66-68` / `session-policy-route.ts` **同一条**；
 *   ③ **零写操作**：本文件没有任何写入分支（只有 `readFileSync`）。
 */

import { readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { resolveLedgerRoot, ledgerRootWhy } from '../server/doc-read.ts'
import { declaredLedgerHome } from './orchestrator.ts'
import { orchStateFileOf } from '../server/orch-state.ts'
import {
  handleExecProgress,
  EXEC_PROGRESS_SOURCE,
  type ExecProgressResponse,
} from '../shared/exec-progress.ts'
import { EXEC_PROGRESS_ROUTE_PATH } from '../shared/exec-protocol.ts'

export const name = 'dsh-hob-exec-progress-route'

/** 本路由路径（⚠ **值来自** `shared/exec-protocol.ts` —— 客户端与这里同一份，⛔ 不各写一份）。 */
export { EXEC_PROGRESS_ROUTE_PATH }

/** 统一 JSON 响应（⚠ 必须返回真 `Response`，理由见 `session-policy-route.ts:87-116`）。 */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * 注册这条只读路由（照 `installTasksProgressRoute` 的既有形态）。
 *
 * @param ctx - 宿主上下文
 */
export function installExecProgressRoute(ctx: Context): void {
  const hostCtx = ctx as any

  ctx.inject(['connection'], (svcCtx: any) => {
    try {
      const conn = svcCtx.get?.('connection') ?? svcCtx.connection
      const fetch = conn?.fetch
      if (fetch === undefined || typeof fetch.register !== 'function') {
        hostCtx.logger?.warn?.('[dsh-hob] 宿主 `connection.fetch` 不可用 ⇒ 执行态**只读路由未登记**')
        return
      }

      /** 会话 id → 账本根（⚠ 与 `tasks-progress-route.ts:66-68` **同一条派生**）。 */
      const ledgerRootOf = (sessionId: string): string | undefined => {
        try {
          const session = (() => {
            try { return hostCtx.get?.('sessions')?.get?.(sessionId) } catch { return undefined }
          })()
          const cwd = session?.header?.cwd
          return resolveLedgerRoot('', declaredLedgerHome(hostCtx), typeof cwd === 'string' ? cwd : undefined)
        } catch {
          return undefined
        }
      }

      /** 判不出时的可读原因（⚠ 与上面同一个入口，⛔ 不另算一遍）。 */
      const ledgerRootWhyOf = (sessionId: string): string => {
        try {
          const session = (() => {
            try { return hostCtx.get?.('sessions')?.get?.(sessionId) } catch { return undefined }
          })()
          const cwd = session?.header?.cwd
          const why = ledgerRootWhy('', declaredLedgerHome(hostCtx), typeof cwd === 'string' ? cwd : undefined)
          return why.kind === 'ok' ? '' : why.why
        } catch {
          return ''
        }
      }

      const disposer = fetch.register({
        path: EXEC_PROGRESS_ROUTE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request: any) => {
          // ⚠ 鉴权与跨站**已在宿主栅栏里做过**（未认证 401 / 跨站 403），此处只处理业务。
          let body: any
          try {
            const text = typeof request.text === 'function' ? await request.text() : ''
            body = JSON.parse(text === '' ? '{}' : text)
          } catch {
            return json(400, { ok: false, reason: 'bad-request', message: '请求体不是 JSON' })
          }
          const out: ExecProgressResponse = handleExecProgress(
            {
              ledgerRootOf,
              ledgerRootWhyOf,
              // ⚠ 路径**派生**自 `orch-state.ts`（`D1`①：同一条解析入口）
              stateFileOf: (root: string) => orchStateFileOf(root),
              readText: (abs: string) => {
                // ⚠ 文件不存在 ⇒ `undefined`（**不抛**，那是 `state-missing`）；
                //   其它错误照抛（由 `handleExecProgress` 归到 `row-shape-unknown`）
                try { return readFileSync(abs, 'utf8') } catch (e) {
                  if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined
                  throw e
                }
              },
            },
            body,
          )
          /**
           * ⚠ 状态码**与 `tasks-progress` 逐字同口径**：`ok:false` ⇒ 400。
           *   理由：面板要把"路由层面通了、但内容判不出"与"路由根本没接上（404 纯文本）"
           *   分开（`R-10`）—— 前者能带 `reason`，后者连 JSON 都不是。
           */
          return json(out.ok ? 200 : 400, out)
        },
      })

      ctx.effect(() => () => {
        try { disposer?.() } catch { /* 忽略 */ }
      }, 'dsh-hob: exec progress read route')
      hostCtx.logger?.info?.(`[dsh-hob] 执行态只读路由已登记：POST ${EXEC_PROGRESS_ROUTE_PATH}`)
    } catch (e) {
      hostCtx.logger?.warn?.(`[dsh-hob] 执行态只读路由登记失败：${String((e as Error)?.message ?? e)}`)
    }
  })
}

/** 数据来源（再导出，便于机检锚定"客户端与服务端逐字一致"）。 */
export { EXEC_PROGRESS_SOURCE }
