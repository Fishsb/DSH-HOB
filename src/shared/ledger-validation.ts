/**
 * **账本单元的结构校验唯一实现**（纯函数、零 I/O）。
 *
 * 分工：
 *   · 本模块只回答“一条单元的 kind/status 是否符合封闭契约”；
 *   · `stage-controls.ts` 继续回答字段、关系与生命周期缺口；
 *   · `stages-index.ts` / `ledger-readiness.ts` / `hob-write.ts` 三处都调用这里。
 *
 * ⚠ 之所以独立成模块：`stage-controls` 和 `stages-index` 互相依赖，
 *   写入层若从其中一侧取校验，会影响另一侧的循环依赖。
 */

/** kind → 合法 status 的封闭表（⚠ 这是结构验证唯一读取的状态表）。 */
export const UNIT_STATUSES: Readonly<Record<string, readonly string[]>> = {
  req: ['draft', 'agreed', 'dropped', 'retired'],
  change: ['proposed', 'settled', 'superseded'],
  task: ['todo', 'doing', 'built'],
  run: ['registered', 'running', 'returned', 'refused', 'stuck'],
  acc: ['pass', 'send-back', 'unverified'],
  verification: ['unverified', 'pass', 'send-back', 'waived'],
  closure: ['open', 'closed', 'skipped', 'blocked'],
  cap: ['live', 'degraded', 'down'],
  risk: ['open', 'handling', 'closed'],
  decision: ['active', 'superseded'],
  evidence: ['recorded'],
  goal: ['active', 'done', 'retired'],
}

/**
 * 一条单元的结构问题（`kind` / `status` / 重复 ID）。
 *
 * @param unit - 至少含 id/kind/status
 * @param seenIds - 合并账本的已见 ID 集合；省略 = 不查重复
 * @returns 空数组 = 结构合法
 */
export function unitShapeProblems(
  unit: Record<string, unknown>,
  seenIds?: Set<string>,
): string[] {
  const id = typeof unit.id === 'string' && unit.id.trim() !== '' ? unit.id.trim() : '(无 id)'
  const kind = typeof unit.kind === 'string' ? unit.kind.trim() : ''
  const status = typeof unit.status === 'string' ? unit.status.trim() : ''
  if (seenIds !== undefined) {
    if (id === '(无 id)') return [`${id}: 缺稳定 id`]
    if (seenIds.has(id)) return [`${id}: 合并后的账本出现重复 ID`]
    seenIds.add(id)
  }
  const legal = UNIT_STATUSES[kind]
  if (legal === undefined) return [`${id}: kind=${JSON.stringify(kind)} 不在封闭集`]
  if (!legal.includes(status)) {
    return [`${id}: status=${JSON.stringify(status)} 不属于 kind=${kind}（合法：${legal.join(' / ')}）`]
  }
  return []
}
