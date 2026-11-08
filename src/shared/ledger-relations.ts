/**
 * **账本正式关系的唯一读取函数**（纯函数、零 I/O、零账本状态表依赖）。
 *
 * ⚠ 放在独立模块而不是 `stages-index.ts`：`stage-controls.ts` 需要同一个关系口径，
 *   而 `stages-index.ts` 已经依赖 `stage-controls.ts`。若把关系函数留在那里，
 *   闭环判据只能再写一份，正是本次要治的「两套关系语法」。
 */

const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).map((x) => x.trim()).filter((x) => x !== '') : []

/**
 * 一个方案正式承接的需求。
 *
 * 现行账本同时存在三种承载方式：
 *   · `req_ids` —— 新方案直接列出需求号；
 *   · `addresses` —— 历史与收敛判据使用的承接边；
 *   · `requirement_coverage` —— 映射正文，每行必须以需求号开头。
 *
 * ⚠ 读取方只认其中一种时，账本里明明有方案，需求链却会说「还没定方案」。
 *   本函数按出现顺序去重；⛔ 不读标题，⛔ 不猜自由文本里的第二个编号。
 */
export function changeRequirementIds(change: Record<string, unknown> | object): string[] {
  const source = change as Record<string, unknown>
  const coverageIds = arr(source.requirement_coverage)
    .map((x) => /^([A-Z]+-[A-Za-z0-9-]+)/.exec(x)?.[1] ?? '')
    .filter((x) => x !== '')
  return [...new Set([
    ...arr(source.req_ids),
    ...arr(source.addresses),
    ...coverageIds,
  ])]
}
