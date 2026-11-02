/**
 * **「待确认工具」只读路由**（2026-10-31 P28 · `TSK-048` / `R-008`）。
 *
 * ══ 它是什么 ═══════════════════════════════════════════
 *   `POST /api/dsh-hob/unseen-tools` ⇒ `{ ok, count, names, summary, items }`
 *   数据源 = `src/preset/tools.ts` 的 `UNSEEN_SEEN`（**装配期 `reportUnseen` 写、本路由只读**）。
 *
 * ══ 凭什么给它开一条路由（三条，缺一条就不该有）══════════════════
 *   ① **只读**：本文件**零写操作**。`__unseenToolsOf()` 只回快照，
 *      ⛔ 不清空、不重置、不写 `DEGRADED_CAPABILITIES`。
 *   ② **0 条也说出来**：`describeUnseen([]).summary` = 「0 条 —— …（⚠ 这是**查过的读数**）」
 *      ⛔ 不是 `{}` / 空白 —— "空"与"没有"必须分得开（`E-172`）。
 *   ③ **逐名列出**：有名字时 `names` 是数组、`summary` 里也逐个点出。
 *
 * ══ 分工（与 `stages-route` / `session-policy-route` 同构）══════════
 *   归一/整理在 `src/shared/unseen-tools.ts`（纯函数，判据可直接喂），
 *   本文件只做宿主接线（⛔ 不含任何业务判定）。
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  UNSEEN_TOOLS_ROUTE_PATH,
  describeUnseen,
  type UnseenReport,
} from '../shared/unseen-tools.ts'
import { __unseenToolsOf } from '../preset/tools.ts'

export const name = 'dsh-hob-unseen-tools-route'

/** 本路由路径（⚠ 真值在纯共享层；这里重新导出以保留既有服务端 API）。 */
export { UNSEEN_TOOLS_ROUTE_PATH }

/** 统一 JSON 响应。 */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * 读一次（⚠ **纯读**：不接收参数、不认 sessionId —— 这是**进程级**读数，不是会话级）。
 *
 * ⚠ 为什么不吃 `sessionId`：`UNSEEN_SEEN` 是**进程级**的（`tools.ts` 模块层单例），
 *   按会话过滤会是**假装精确**（同一条记录其实属于整个进程）。
 *   ⇒ 路由**明确回进程级读数**，⛔ 不编一个"按会话"的假维度。
 */
export function readUnseenReport(): UnseenReport {
  let names: readonly string[] = []
  try {
    names = __unseenToolsOf()
  } catch {
    /** ⚠ 取不到（模块还没起来）⇒ 仍是**合法读数**：确实 0 条被记下过。 */
    names = []
  }
  /**
   * ⚠ 原因（`why`）这里统一给一句**通用**说明：
   *   真实的长原因在 `DEGRADED_CAPABILITIES` 里，本路由**只回名字 + 这句通用说明**，
   *   ⛔ 不把那份长文搬过来（那会让响应体随日志增长而膨胀）。
   */
  return describeUnseen(names.map((n) => ({
    name: n,
    why: '装入时不在白名单、也不在 deny 清单 ⇒ 已按"默认放开"放行（⚠ 待确认，⛔ 不等于确认安全）',
  })))
}

/**
 * 注册这条只读路由（照 `installStagesRoute` 的既有形态）。
 *
 * @param ctx - 宿主上下文
 */
export function installUnseenToolsRoute(ctx: Context): void {
  const hostCtx = ctx as any
  ctx.inject(['connection'], (svcCtx: any) => {
    try {
      const conn = svcCtx.get?.('connection') ?? svcCtx.connection
      const fetch = conn?.fetch
      if (fetch === undefined || typeof fetch.register !== 'function') {
        hostCtx.logger?.warn?.('[dsh-hob] 宿主 `connection.fetch` 不可用 ⇒ 待确认工具**只读路由未登记**')
        return
      }
      const disposer = fetch.register({
        path: UNSEEN_TOOLS_ROUTE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async () => json(200, readUnseenReport()),
      })
      hostCtx.logger?.info?.(`[dsh-hob] 待确认工具只读路由已登记：${UNSEEN_TOOLS_ROUTE_PATH}`)
      return disposer
    } catch (e) {
      hostCtx.logger?.warn?.(`[dsh-hob] 待确认工具只读路由登记失败：${String((e as Error)?.message ?? e)}`)
    }
  })
}
