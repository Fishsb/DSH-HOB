/**
 * M3 · 会话总线模块（同实例内会话之间传话）—— **本轮只搭壳，不实现投递**。
 *
 * 依赖声明：`sessions` + `agents`。
 * 接口已核实（见本轮报告 §M3，含位置）：
 *   · `ctx.sessions.list()` / `.get(id)`  → `dsh-session/lib/index.js:1861,1868`
 *   · `ctx.agents.get(sessionId)`         → `dsh-agent/lib/index.js:594`
 *   · `agent.followup/steer/inject(msg)`  → `dsh-agent-loop/lib/index.js:806-812`
 *
 * ⚠ 二者都是**可选依赖的合理候选**，故用 `ctx.inject(...)` 反应式订阅而不是
 *   模块级 `inject` —— 理由：总线在缺 `agents` 的部署里仍可能只做「列会话」，
 *   不该整块不激活。**但骨架期两者都只做能力探测，不投递。**
 *
 * ⚠ `inject` 的两种写法是**不同层级**，不可互相替代（见 .hob/EXPERIENCE.md E-02）。
 */
export const name = 'dsh-hob-bus'

export function apply(ctx: any): void {
  ctx.logger?.info?.(`[${name}] 已激活（骨架期不实现投递）`)

  // ── 能力探测：只读，确认宿主服务在不在（不投递、不改状态）──────────────
  // 用反应式订阅：服务就绪后回调才跑；不在就**不跑**，且**不报错**。
  ctx.inject(['sessions', 'agents'], (svcCtx: any) => {
    const sessions = svcCtx.sessions ?? svcCtx.get?.('sessions')
    const agents = svcCtx.agents ?? svcCtx.get?.('agents')
    if (sessions === undefined || agents === undefined) {
      svcCtx.logger?.warn?.(`[${name}] sessions/agents 已就绪但不可用。`)
      return
    }
    // 资源挂 ctx.effect —— 解除订阅/清理随 fiber 卸载。
    svcCtx.effect(() => {
      const live = typeof sessions.list === 'function' ? sessions.list() : []
      ctx.logger?.info?.(`[${name}] 能力探测：sessions=${live.length} 个（只读，未投递）`)
      return () => { /* 骨架期无监听需要解除 */ }
    }, `${name}: capability probe`)
  })
}
