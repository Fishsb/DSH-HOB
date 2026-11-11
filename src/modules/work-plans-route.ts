/**
 * **工作计划 · 只读路由**（第五波 · 面板数据出口）。
 *
 * 用途：把编排器里已经算好的 `WorkPlanStatus` 原样交给右侧栏面板。
 *
 * ── 边界（⛔ 三条都不许破）──────────────────────────────────────────────
 *   ① **零写**：只调同步的 `status()`，⛔ 不调 `workPlans()`（那个会先推进计划、写盘）；
 *   ② **零派单**：不建会话、不投递、不改计划文件；
 *   ③ **不改形状**：面板显示什么，以编排器的摘要为准 —— 这里只做 JSON 透传。
 *
 * ⚠ 依赖缺失时**不登记**、不报错（与同族只读路由一致）：面板那一块会显示「判不出」。
 */
import type { Context } from '@deepseek-ai/cordis'
import { existsSync } from 'node:fs'
import { ORCH_SERVICE } from './orchestrator.ts'
import { declaredLedgerHome } from './orchestrator.ts'
import { SESSION_POLICY_SERVICE } from '../config.ts'
import { WORK_MODE_VALUES, type WorkMode } from '../shared/work-mode.ts'
import { resolveLedgerByName } from '../shared/ledger-catalog.ts'

export const name = 'dsh-hob-work-plans-route'
export const WORK_PLANS_ROUTE_PATH = '/api/dsh-hob/work-plans'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * 注册只读工作计划路由。
 *
 * @param ctx - 宿主上下文
 */
export function installWorkPlansRoute(ctx: Context): void {
  const hostCtx = ctx as any
  ctx.inject(['connection', ORCH_SERVICE], (svcCtx: any) => {
    try {
      const conn = svcCtx.get?.('connection') ?? svcCtx.connection
      const fetch = conn?.fetch
      if (fetch === undefined || typeof fetch.register !== 'function') {
        hostCtx.logger?.warn?.('[dsh-hob] 宿主 `connection.fetch` 不可用 ⇒ 工作计划只读路由未登记')
        return
      }
      const orch: any = svcCtx.get?.(ORCH_SERVICE) ?? svcCtx[ORCH_SERVICE]
      if (orch === undefined || typeof orch.status !== 'function') {
        hostCtx.logger?.warn?.('[dsh-hob] 编排器不可用 ⇒ 工作计划只读路由未登记')
        return
      }
      /** 现读该会话的工作方式；判不出就报 `unknown`（⛔ 不按缺省档猜）。 */
      const modeReadingOf = (sessionId: string): { mode: WorkMode | 'unknown'; source: string } => {
        try {
          const svc: any = hostCtx.get?.(SESSION_POLICY_SERVICE) ?? hostCtx[SESSION_POLICY_SERVICE]
          const session = hostCtx.get?.('sessions')?.get?.(sessionId)
          if (session === undefined || typeof svc?.of !== 'function') return { mode: 'unknown', source: 'unknown' }
          const r = svc.of(session)
          const mode = typeof r?.workMode === 'string'
            && (WORK_MODE_VALUES as readonly string[]).includes(r.workMode)
            ? r.workMode as WorkMode
            : 'unknown'
          return { mode, source: typeof r?.source === 'string' && r.source !== '' ? r.source : 'unknown' }
        } catch { return { mode: 'unknown', source: 'unknown' } }
      }
      const disposer = fetch.register({
        path: WORK_PLANS_ROUTE_PATH,
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
          if (sessionId === '') {
            return json(400, { ok: false, reason: 'no-session', message: '工作计划读数需要 sessionId' })
          }
          /**
           * ⚠ **指定账本**（2026-11-07 · `R-020`）：走白名单校验拿绝对路径，
           *   再以 `ledgerRoot` 直传给编排器（⛔ 不从账本名反推工作区路径）。
           */
          const wanted = body?.ledger
          let ledgerRootDirect: string | undefined
          if (wanted !== undefined && wanted !== null && wanted !== '') {
            ledgerRootDirect = resolveLedgerByName(declaredLedgerHome(hostCtx), wanted, existsSync)
            if (ledgerRootDirect === undefined) {
              return json(400, {
                ok: false,
                reason: 'ledger-not-allowed',
                message: `账本名不在白名单内或不存在：${JSON.stringify(String(wanted))}（⛔ 不接受路径）`,
              })
            }
          }
          try {
            /**
             * ⚠ **可选 workspaceRoot**（2026-11-06）：没有活会话时（或会话不在本实例）
             *   `wsRootOfSession(self)` 判不出 ⇒ 读数只能给空，而空会被误读成"没有计划"。
             *   ⇒ 允许调用方显式给工作区根；⛔ 不给时行为与改前完全一致。
             */
            const explicitWs = typeof body?.workspaceRoot === 'string' && body.workspaceRoot.trim() !== ''
              ? body.workspaceRoot.trim()
              : undefined
            /**
             * ⚠ **会话不在本实例时也要能读**：`wsRootOfSession(self)` 当年会读不到
             *   （历史会话已归档/已结束）⇒ 读数退化成空数组，而空会被误读成"没有计划"。
             *   ⇒ 先问显式参数，再问工作区注册表（`sessionPaths`，与 `bus.listWorkspaces` 同源）。
             */
            const wsRoot = explicitWs ?? (() => {
              try {
                const registry: any = hostCtx.get?.('workspaceRegistry')
                const p = registry?.sessionPaths?.get?.(sessionId)
                return typeof p === 'string' && p !== '' ? p : undefined
              } catch { return undefined }
            })()
            const snapshot = orch.status({
              self: sessionId,
              ...(wsRoot === undefined ? {} : { wsRoot }),
              ...(ledgerRootDirect === undefined ? {} : { ledgerRoot: ledgerRootDirect }),
            })
            const plans = snapshot?.workPlans
            if (plans === undefined) {
              return json(200, {
                ok: false,
                reason: 'no-work-plans',
                message: '编排器没有返回工作计划读数（⛔ 这不等于「没有计划」）',
              })
            }
            const modeReading = modeReadingOf(sessionId)
            return json(200, {
              ok: true,
              mode: modeReading.mode,
              modeSource: modeReading.source,
              plans: plans.plans ?? [],
              /** 过期归档：单独一档，⛔ 不并进 plans（它们不是活动计划）。 */
              abandoned: plans.abandoned ?? [],
              unreadable: plans.unreadable ?? [],
            })
          } catch (e) {
            return json(200, {
              ok: false,
              reason: 'status-error',
              message: String((e as Error)?.message ?? e),
            })
          }
        },
      })
      ctx.effect(() => () => { try { disposer?.() } catch { /* 忽略 */ } }, 'dsh-hob: work-plans read route')
      hostCtx.logger?.info?.(`[dsh-hob] 工作计划只读路由已登记：POST ${WORK_PLANS_ROUTE_PATH}`)
    } catch (e) {
      hostCtx.logger?.warn?.(`[dsh-hob] 工作计划只读路由登记失败：${String((e as Error)?.message ?? e)}`)
    }
  })
}
