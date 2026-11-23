/**
 * **宿主服务「免 inject 现读」工厂**（2026-11-23 · A·拆分，自 `bus.ts` 原样搬出）。
 *
 * ⚠ 纪律（逐字保留在 `bus.ts` 各函数的文档注释里）：这些服务**不进 inject 依赖表** ——
 *   那会变成加载门禁（缺服务 ⇒ fiber 停在 PENDING ⇒ 插件整体不激活）；
 *   一律 `ctx.get('<逐字服务名>')` 运行时现读、不缓存。
 *
 * @module bus-lookups
 */

export function makeArchivedLookup(svcCtx: any): (sessionId: string) => boolean {
  // ⚠ 用 `get` 而**不是**属性访问：`ctx.workspaceRegistry` 在没有 inject 声明时
  //   会抛 `cannot get property "…" without inject`（cordis 的 Proxy handler,
  //   `lib/index.js:676`）；`get` 是明确的"免 inject"读法。
  let registry: any
  try {
    registry = typeof svcCtx.get === 'function' ? svcCtx.get('workspaceRegistry') : svcCtx.workspaceRegistry
  } catch {
    return () => false
  }
  if (registry === undefined || registry === null) return () => false

  // ⚠⚠ **必须每次现读，不能在闭包里快照**（2026-10-09 真机抓到的第二个缺陷）。
  //
  //   第一版写的是：把 `registry.archivedSessionIds` 取出来**建一次 Set**，
  //   闭包捕获那个 Set。真机症状：**在服务构建之后新归档的会话照旧出现在
  //   `hob_sessions` 里**（实测：`session-a15c0f5d` 明明已在归档集里，
  //   `list()` 仍把它列出来），而构建之前归档的那批过滤得好好的
  //   —— 于是这个 bug **极难从"归档功能不工作"的表面症状归因**。
  //
  //   根因：归档集是**活数据**（宿主原地改同一个数组对象：实测
  //   `archivedSessionIds` 前后**同一引用**、内容增长），而我在构建时**拍了个快照**。
  //   ⇒ 每次调用现取；宿主给的是**数组**（实测无 `has`，且长度会变），
  //     所以现读时再判断"有没有 `has`"，两条路都支持。
  return (sessionId: string) => {
    try {
      const ids = registry.archivedSessionIds
      if (ids === undefined || ids === null) return false
      if (typeof ids.has === 'function') return ids.has(sessionId)
      return Array.isArray(ids) ? ids.includes(sessionId) : [...ids].includes(sessionId)
    } catch {
      return false
    }
  }
}

export function makeRegistryLookup(svcCtx: any): any {
  try {
    return typeof svcCtx.get === 'function' ? svcCtx.get('workspaceRegistry') : svcCtx.workspaceRegistry
  } catch {
    return undefined
  }
}

export function makePresetRegistryLookup(svcCtx: any): any {
  try {
    return typeof svcCtx.get === 'function' ? svcCtx.get('agentPresets') : undefined
  } catch {
    return undefined
  }
}

export function makeProjectionsLookup(svcCtx: any): any {
  try {
    return typeof svcCtx.get === 'function' ? svcCtx.get('sessionProjections') : undefined
  } catch {
    return undefined
  }
}

export function makeControllerLookup(svcCtx: any): any {
  try {
    return typeof svcCtx.get === 'function' ? svcCtx.get('sessionController') : svcCtx.sessionController
  } catch {
    return undefined
  }
}
