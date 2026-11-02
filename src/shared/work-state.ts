/**
 * 单元级“现在在等谁”派生状态。
 *
 * ⚠ 这不是第六步，也与五步生命周期正交：
 *   · 五步回答“处于哪个生命周期阶段”；
 *   · 本模块回答“当前为什么没往前走、该谁行动”。
 * ⚠ 只读输入，不读环境、不写状态、不猜缺失字段。
 */

import { effectiveAcceptanceOf, type AcceptanceVerdictLike } from './acceptance-verdict.ts'

export const WORK_STATES = [
  'awaiting-user',
  'awaiting-acceptance',
  'delivery-failed',
  'blocked',
  'queued',
  'working',
  'idle',
  'ended',
  'undecidable',
] as const

export type WorkState = typeof WORK_STATES[number]

export interface WorkStateUnitLike {
  id: string
  kind: string
  status?: string
  title?: string
  accepted_by?: string
  sent_back_to?: string
  acceptance_ids?: string[]
  verify_refs?: string[]
  report?: string
  delivered_at?: string
  delivered_why?: string
}

export interface WorkStateOptions {
  /**
   * 需求正式关联的验收 id → ACC 单元。
   * ⚠ 需求不能从「挂在任务下的任意 acc」推断收口：任务 ACC 归任务，
   *   需求只认 `req.acceptance_ids` 指向的验收。
   */
  acceptanceById?: ReadonlyMap<string, AttentionUnitLike>
}

export interface AttentionUnitLike extends AcceptanceVerdictLike {
  id: string
  kind: string
  status?: string
  parent?: string
  delivery?:
    | { error?: string }
    | string
  attention?: unknown
  accepted_at?: number
  sent_back_at?: number
  undelivered_at?: number
  refusal?: string
  blocked?: boolean
  event_id?: string
  thread_id?: string
}

export interface WorkStateReading {
  id: string
  state: WorkState
  label: string
  why: string
  /** 同一问题跨事件 / 跨线程合并后的成员（⚠ 排序去重，缺省不出现）。 */
  merged?: string[]
  /** 最早可指认事件 id（⚠ 不从内容猜；缺省不出现）。 */
  event_id?: string
  /** 稳定线程 id（⚠ 由账本字段给出；缺省不出现）。 */
  thread_id?: string
}

const LABEL: Readonly<Record<WorkState, string>> = {
  'awaiting-user': '等你决定',
  'awaiting-acceptance': '等验收',
  'delivery-failed': '投递失败',
  blocked: '阻塞',
  queued: '排队',
  working: '执行中',
  idle: '空闲',
  ended: '已结束',
  undecidable: '判不出',
}

const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).filter((x) => x !== '') : []

/**
 * 计算账本单元的工作状态。
 *
 * @param unit - 需求 / 任务 / 运行等单元
 * @param related - 与它相关的验收或运行
 * @returns 封闭九态中的一态
 */
export function workStateOf(
  unit: WorkStateUnitLike,
  related: readonly AttentionUnitLike[] = [],
  options: WorkStateOptions = {},
): WorkStateReading {
  const status = String(unit.status ?? '')
  const fail = related.find((x) => x.delivery !== undefined || x.undelivered_at !== undefined || x.refusal !== undefined)
  if (fail !== undefined) {
    return { id: unit.id, state: 'delivery-failed', label: LABEL['delivery-failed'], why: fail.id }
  }
  if (related.some((x) => x.attention !== undefined)) {
    return { id: unit.id, state: 'awaiting-user', label: LABEL['awaiting-user'], why: '有需要人回答的问题' }
  }
  if (unit.kind === 'req') {
    if (status !== 'agreed') return { id: unit.id, state: 'ended', label: LABEL.ended, why: `需求状态 ${status || '判不出'}` }
    if (arr(unit.acceptance_ids).length === 0) {
      return { id: unit.id, state: 'awaiting-user', label: LABEL['awaiting-user'], why: '没有验收路径' }
    }
    if (options.acceptanceById === undefined) {
      return { id: unit.id, state: 'undecidable', label: LABEL.undecidable, why: '调用方没有提供验收单元' }
    }
    const accepted = arr(unit.acceptance_ids)
      .map((id) => options.acceptanceById?.get(id))
      .filter((x): x is AttentionUnitLike => x !== undefined)
    const missing = arr(unit.acceptance_ids).filter((id) => options.acceptanceById?.get(id) === undefined)
    if (missing.length > 0) {
      return {
        id: unit.id,
        state: 'undecidable',
        label: LABEL.undecidable,
        why: `引用的 ${missing.join(' / ')} 不存在或不可读`,
      }
    }
    /**
     * ⚠ 需求上的多个 ACC 必须**按 parent 分组**：
     *   · 同一 task / change 的旧退回 + 新通过 ⇒ 只看最新；
     *   · 不同 task / change 各自有判决 ⇒ 每组都必须通过。
     * ⛔ 不能把同组历史退回当成第二道独立验收，否则旧的 SEND-BACK 会永久压住复验 PASS。
     */
    const groups = new Map<string, AttentionUnitLike[]>()
    for (const a of accepted) {
      const parent = String(a.parent ?? '')
      const key = parent === '' ? `self:${a.id}` : parent
      const list = groups.get(key)
      if (list === undefined) groups.set(key, [a])
      else list.push(a)
    }
    const grouped = [...groups.values()]
    const pending = grouped.some((g) => g.some((x) => ['', 'unverified'].includes(String(x.status ?? ''))))
    const verdicts = grouped
      .filter((g) => !g.some((x) => ['', 'unverified'].includes(String(x.status ?? ''))))
      .map((g) => effectiveAcceptanceOf(g))
    const verdict = pending
      ? { verdict: 'awaiting' as const }
      : verdicts.some((x) => x.verdict === 'undecidable')
        ? { verdict: 'undecidable' as const, reason: verdicts.find((x) => x.verdict === 'undecidable')?.reason }
        : verdicts.every((x) => x.verdict === 'accepted')
          ? { verdict: 'accepted' as const }
          : { verdict: 'send-back' as const }
    if (verdict.verdict === 'accepted') {
      return { id: unit.id, state: 'ended', label: LABEL.ended, why: '验收已通过' }
    }
    if (verdict.verdict === 'undecidable') {
      return {
        id: unit.id,
        state: 'undecidable',
        label: LABEL.undecidable,
        why: `验收判决判不出：${verdict.reason ?? '缺可比较的判决时刻'}`,
      }
    }
    return { id: unit.id, state: 'awaiting-acceptance', label: LABEL['awaiting-acceptance'], why: '验收尚未通过' }
  }
  if (unit.kind === 'task') {
    if (status === 'built') {
      if (arr(unit.verify_refs).length === 0) {
        return { id: unit.id, state: 'blocked', label: LABEL.blocked, why: '已交付但没有证据' }
      }
      const hasAcc = related.some((x) => x.kind === 'acc')
      if (!hasAcc) return { id: unit.id, state: 'awaiting-acceptance', label: LABEL['awaiting-acceptance'], why: '没有验收单元' }
      /**
       * ⚠ 同一任务的直属 ACC 按最新 `verified_at` 取有效判决：
       *   旧 SEND-BACK 后追加的新 PASS 能收口；旧 PASS 后的新 SEND-BACK 会重新打开；
       *   缺时刻或同刻冲突 ⇒ 判不出，⛔ 不猜。
       */
      const verdict = effectiveAcceptanceOf(related.filter((x) => x.kind === 'acc'))
      if (verdict.verdict === 'undecidable') {
        return {
          id: unit.id,
          state: 'undecidable',
          label: LABEL.undecidable,
          why: `验收判决判不出：${verdict.reason ?? '缺可比较的判决时刻'}`,
        }
      }
      if (verdict.verdict !== 'accepted') {
        return { id: unit.id, state: 'awaiting-acceptance', label: LABEL['awaiting-acceptance'], why: '验收尚未通过' }
      }
      return { id: unit.id, state: 'ended', label: LABEL.ended, why: '任务与验收均已到终态' }
    }
    if (status === 'doing') return { id: unit.id, state: 'working', label: LABEL.working, why: '任务执行中' }
    if (status === 'todo') return { id: unit.id, state: 'queued', label: LABEL.queued, why: '任务尚未开工' }
    return { id: unit.id, state: 'undecidable', label: LABEL.undecidable, why: `未知任务状态 ${status || '空'}` }
  }
  if (unit.kind === 'run') {
    if (status === 'running') return { id: unit.id, state: 'working', label: LABEL.working, why: '运行中' }
    if (status === 'registered') return { id: unit.id, state: 'queued', label: LABEL.queued, why: '已登记未开跑' }
    if (status === 'stuck') return { id: unit.id, state: 'blocked', label: LABEL.blocked, why: '卡住' }
    if (['returned', 'refused'].includes(status)) return { id: unit.id, state: 'ended', label: LABEL.ended, why: status }
    return { id: unit.id, state: 'undecidable', label: LABEL.undecidable, why: `未知运行状态 ${status || '空'}` }
  }
  if (unit.kind === 'acc') {
    if (status === 'pass' || status === 'send-back') return { id: unit.id, state: 'ended', label: LABEL.ended, why: status }
    if (status === 'unverified') return { id: unit.id, state: 'awaiting-acceptance', label: LABEL['awaiting-acceptance'], why: '待验收' }
  }
  return { id: unit.id, state: 'undecidable', label: LABEL.undecidable, why: `kind=${unit.kind} status=${status || '空'}` }
}

/**
 * 把单元列表折叠成“需要人注意”的列表。
 * ⚠ 健康 / 已结束状态不进入注意力列表。
 */
export function attentionOf(
  units: readonly (WorkStateUnitLike & AttentionUnitLike)[],
  relatedByParent?: ReadonlyMap<string, readonly AttentionUnitLike[]>,
): WorkStateReading[] {
  const acceptanceById = new Map(
    units
      .filter((u) => u.kind === 'acc')
      .map((u) => [String(u.id), u as AttentionUnitLike]),
  )
  /**
   * ⚠ 事件去重与线程合并**只按稳定标识**：
   *   · 同一 `event_id` ⇒ 同一条事实，保留首见，其余并入 `merged`；
   *   · 同一 `thread_id` 且同一工作态 ⇒ 同一问题的连续事件，合并成一行；
   *   · ⛔ 不按 `why` / 标题相似度合并 —— 自然语言相似不是身份。
   */
  const byEvent = new Map<string, AttentionUnitLike>()
  const byThread = new Map<string, AttentionUnitLike>()
  const deduped: Array<WorkStateUnitLike & AttentionUnitLike> = []
  for (const u of units) {
    if (typeof u.event_id === 'string' && u.event_id !== '') {
      const hit = byEvent.get(u.event_id)
      if (hit !== undefined) continue
      byEvent.set(u.event_id, u)
    }
    if (typeof u.thread_id === 'string' && u.thread_id !== '') {
      byThread.set(u.thread_id, u)
    }
    deduped.push(u)
  }
  const rows0: Array<{ r: WorkStateReading; unit: WorkStateUnitLike & AttentionUnitLike }> = []
  for (const u of deduped) {
    const r = workStateOf(u, relatedByParent?.get(String(u.id)) ?? [], { acceptanceById })
    if (r.state === 'awaiting-user' || r.state === 'awaiting-acceptance'
      || r.state === 'delivery-failed' || r.state === 'blocked') {
      const out: WorkStateReading = { ...r }
      if (typeof u.event_id === 'string' && u.event_id !== '') out.event_id = u.event_id
      if (typeof u.thread_id === 'string' && u.thread_id !== '') out.thread_id = u.thread_id
      rows0.push({ r: out, unit: u })
    }
  }
  const merged = new Map<string, { row: WorkStateReading; members: Set<string> }>()
  for (const { r, unit } of rows0) {
    const key = typeof unit.thread_id === 'string' && unit.thread_id !== ''
      ? `thread:${unit.thread_id}:${r.state}`
      : `unit:${r.id}:${r.state}`
    const hit = merged.get(key)
    if (hit === undefined) {
      merged.set(key, { row: r, members: new Set([r.id]) })
    } else {
      hit.members.add(r.id)
      if (hit.row.event_id === undefined && r.event_id !== undefined) hit.row.event_id = r.event_id
      /** 最早出现的 why 保留；⚠ 不把多条自由文本拼接成新的“事实”。 */
    }
  }
  return [...merged.values()].map(({ row, members }) => {
    if (members.size <= 1) return row
    return { ...row, merged: [...members].sort() }
  })
}
