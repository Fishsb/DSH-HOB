/**
 * **LEGACY · 五步主线进度表只读路由**（2026-10-29；2026-11-03 标为兼容面）。
 *
 * ⚠ 权威五步接口已迁移到 `POST /api/dsh-hob/stages`
 *   （数据源 `ledger/units/index.toml`）。本路由仅保留读取旧
 *   `volumes/tasks/INDEX.md` 的兼容能力，⛔ 不再新增消费者。
 *
 * ══ 它做什么 ═══════════════════════════════════════════════════════════════
 *   把账本区 `volumes/tasks/INDEX.md` 里那张 `|` 表格读出来，按**封闭**线格式送到浏览器：
 *     `{ ok:true, readAt, source, rows:[{ name, step, blockedBy }] }`
 *   面板拿它渲染五步进度。⛔ 本文件**零写操作**（无任何写入分支）。
 *
 * ══ 分工（为什么处理体不在本文件）══════════════════════════════════════════
 *   · **解析与归一** + **处理体**都在 `src/shared/tasks-progress.ts`（纯函数、零宿主依赖）
 *     ⇒ 机检可以**直接 import 真源码**跑三种情形，不需要伪造 cordis 上下文；
 *   · 本文件只做**宿主接线**：`connection.fetch.register` + `ctx.effect` 清理 + 日志。
 *   ⚠ 这样"业务判据"与"框架接线"分开，改接线不会碰判据的基准。
 *
 * ══ 硬纪律 ═════════════════════════════════════════════════════════════════
 *   ① **账本根只走既有唯一解析入口**（`D1`①）：
 *        `resolveLedgerRoot('', declaredLedgerHome(hostCtx), <会话 cwd>)`
 *      ⛔ 不新开第二条解析路径、⛔ 不自己拼 `homedir()`
 *      （与 `src/modules/session-policy-route.ts:475` 同一条派生 —— 自己拼必然与服务侧漂）。
 *   ② **三类失败必须可分辨**（`R-10`）：见 `tasks-progress.ts` 的三个 reason 常量。
 *   ③ **空表 ≠ 判不出**：表在、零行 ⇒ `{ok:true, rows:[]}`。
 *   ④ **只读**：处理体没有任何分支会写盘。
 *
 * ══ 为什么另开一个文件（⛔ 不塞进 session-policy-route）════════════════════════
 *   那条路由由别的实施会话持有，本轮任务书只把它当"照形态写"的**参照**。
 *   一条路由一个文件也与本仓 `modules/` 的既有粒度一致。
 */

import type { Context } from '@deepseek-ai/cordis'
import { resolveLedgerRoot, ledgerRootWhy } from '../server/doc-read.ts'
import { declaredLedgerHome } from './orchestrator.ts'
import {
  handleTasksProgress,
  TASKS_PROGRESS_SOURCE,
  type TasksProgressResponse,
} from '../shared/tasks-progress.ts'

export const name = 'dsh-hob-tasks-progress-route'

/** 机器可读的兼容标记；用于文档/诊断明确区分权威接口与旧接口。 */
export const TASKS_PROGRESS_ROUTE_LEGACY = true

/** 本路由路径（⚠ 与 `/api/dsh-hob/session-policy` 同族，⛔ 不撞名）。 */
export const TASKS_PROGRESS_ROUTE_PATH = '/api/dsh-hob/tasks-progress'

/** 统一 JSON 响应（⚠ 必须返回真 `Response`，理由见 `session-policy-route.ts:87-116`）。 */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * 注册这条只读路由（照 `installPolicyRoute` 的既有形态：同一套 `connection.fetch.register`
 * 与 `ctx.effect` 清理，同一套 try/catch 包裹与日志）。
 *
 * @param ctx - 宿主上下文
 */
export function installTasksProgressRoute(ctx: Context): void {
  const hostCtx = ctx as any

  ctx.inject(['connection'], (svcCtx: any) => {
    try {
      const conn = svcCtx.get?.('connection') ?? svcCtx.connection
      const fetch = conn?.fetch
      if (fetch === undefined || typeof fetch.register !== 'function') {
        hostCtx.logger?.warn?.('[dsh-hob] 宿主 `connection.fetch` 不可用 ⇒ 五步进度**只读路由未登记**')
        return
      }

      /**
       * 会话 id → 账本根。
       *
       * ⚠ 与 `session-policy-route.ts:469-478` **同一条派生**：
       *   `resolveLedgerRoot('', declaredLedgerHome(hostCtx), session.header.cwd)`。
       * ⛔ 不在这里另写一份路径规则。
       */
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
        path: TASKS_PROGRESS_ROUTE_PATH,
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
          const out: TasksProgressResponse = handleTasksProgress({ ledgerRootOf, ledgerRootWhyOf }, body)
          return json(out.ok ? 200 : 400, out)
        },
      })

      ctx.effect(() => () => {
        try { disposer?.() } catch { /* 忽略 */ }
      }, 'dsh-hob: tasks progress read route')
      hostCtx.logger?.info?.(`[dsh-hob] 五步进度只读路由已登记：POST ${TASKS_PROGRESS_ROUTE_PATH}`)
    } catch (e) {
      hostCtx.logger?.warn?.(`[dsh-hob] 五步进度只读路由登记失败：${String((e as Error)?.message ?? e)}`)
    }
  })
}

/** 数据来源（再导出，便于机检锚定"客户端与服务端逐字一致"）。 */
export { TASKS_PROGRESS_SOURCE }
