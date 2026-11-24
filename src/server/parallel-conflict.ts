/**
 * **并行冲突检测 + 推进焦点组合闸（C + B 的落点）**（2026-11-24）。
 *
 * ══ C：跨会话并行冲突 ═══════════════════════════════════════════════════
 *   两条链同时进执行步时，**路径相交就该拦**（同文件/同目录/一方是另一方的 glob 前缀）。
 *   ⛔ 不比正文、⛔ 不比标题：只比任务声明的 scope_paths（可核对、可复跑）。
 *
 * ══ B：一个会话只推进一条在途需求 ═══════════════════════════════════════
 *   派活前先取/续焦点租约；已有别的 active ⇒ 拒绝并把该需求登记为 queued（可观测）。
 *   ⚠ 拒绝话必须给出**切换办法**（control 的 focus 动作），⛔ 不给「你自己想办法」这种话。
 *
 * @module parallel-conflict
 */
import { acquireFocus, pauseFocus, readFocus, type FocusRow } from './focus-lease.ts'

/** 任务的写范围（字符串数组；缺省空 = 未声明范围）。 */
export function scopePathsOf(task: Record<string, unknown>): string[] {
  const raw = task.scope_paths
  return Array.isArray(raw) ? raw.map(String).map((s) => s.trim()).filter((s) => s !== '') : []
}

/** 两条路径是否相撞：相等 / 目录前缀 / 一方 glob 前缀覆盖另一方。 */
export function pathsCollide(a: string, b: string): boolean {
  const norm = (s: string): string => s.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  const x = norm(a)
  const y = norm(b)
  if (x === '' || y === '') return false
  if (x === y) return true
  const globBase = (s: string): string | undefined => {
    const i = s.indexOf('*')
    return i < 0 ? undefined : s.slice(0, i).replace(/\/+$/, '')
  }
  const gx = globBase(x)
  const gy = globBase(y)
  if (gx !== undefined && (y === gx || y.startsWith(gx + '/'))) return true
  if (gy !== undefined && (x === gy || x.startsWith(gy + '/'))) return true
  return x.startsWith(y + '/') || y.startsWith(x + '/')
}

export interface ConflictFinding { withSession: string; withReqId: string; withTaskId: string; path: string }

/** 候选任务与其他会话执行中任务做路径比对（未开工的不构成冲突）。 */
export function conflictsOf(
  candidate: { session: string; taskId: string; paths: readonly string[] },
  others: ReadonlyArray<{ session: string; reqId: string; tasks: ReadonlyArray<{ id: string; paths: readonly string[] }> }>,
): ConflictFinding[] {
  const out: ConflictFinding[] = []
  for (const o of others) {
    if (o.session === candidate.session) continue
    for (const t of o.tasks) {
      if (t.id === candidate.taskId) continue
      for (const a of candidate.paths) {
        for (const b of t.paths) {
          if (pathsCollide(a, b)) out.push({ withSession: o.session, withReqId: o.reqId, withTaskId: t.id, path: a + ' ∩ ' + b })
        }
      }
    }
  }
  return out
}

/** 组合闸结果：ok=true 时 note 可带回接管旧租约这类事实。 */
export type FocusGuardResult = { ok: true; note?: string } | { ok: false; message: string }

/** 派活前的焦点 + 冲突闸（唯一落点）。 */
export function dispatchFocusGuard(input: {
  ledgerRoot: string
  session: string
  taskId: string
  units: ReadonlyArray<Record<string, unknown>>
  nowMs?: number
}): FocusGuardResult {
  const now = input.nowMs ?? Date.now()
  const task = input.units.find((u) => String(u.id ?? '') === input.taskId)
  if (task === undefined) return { ok: false, message: '拒绝：账本里没有任务 ' + input.taskId + '。' }
  const rawReq = task.requirement ?? task.req_ids ?? ''
  const reqId = typeof rawReq === 'string' ? rawReq.trim() : (Array.isArray(rawReq) ? String(rawReq[0] ?? '').trim() : '')
  if (reqId === '') return { ok: false, message: '拒绝：任务 ' + input.taskId + ' 没有可归属的需求号 ⇒ 无法判定推进焦点。' }
  /** ⚠ 2026-11-25（P0）：身份判不出 ⇒ **不领租约**（WIP 无从归属），但仍做 C 的冲突检测。 */
  const hasIdentity = String(input.session ?? '').trim() !== ''
  const acquired = hasIdentity ? acquireFocus(input.ledgerRoot, { session: input.session, reqId, nowMs: now }) : undefined
  if (acquired !== undefined && acquired.ok !== true) {
    if (acquired.kind === 'no-identity') return { ok: false, message: '拒绝：会话身份判不出 ⇒ 无法登记推进焦点（⛔ 不许用空身份占租约）。' }
    if (acquired.kind === 'undecided') return { ok: false, message: '拒绝：该需求的推进焦点由 ' + acquired.session + ' 持有，但其租约到期时刻**判不出** ⇒ ⛔ 不自动接管（先修复/清理那条焦点行，或让它显式释放）。' }
    /** ⚠ 两种 busy 必须分开说：本会话已有别的 active（WIP=1）/ 该需求已被另一会话占着（租约）。 */
    const mine = acquired.activeSession === input.session
    const head = mine
      ? '本会话正在推进 ' + acquired.activeReqId + '（一个会话一次只推进一条在途需求）。'
      : '需求 ' + acquired.activeReqId + ' 已由另一会话 ' + acquired.activeSession + ' 推进中（租约未到期）。'
    return {
      ok: false,
      message: head
        + (mine ? '要改推 ' + reqId + '：先用 control 的 focus 动作暂停当前那条，再领取 ' + reqId + ' 的焦点；' : '可等它释放/租约过期后再领，或与对方协商串行。')
        + '⛔ 本工具不会替你切换（切换是产品决定）。',
    }
  }
  const rows = readFocus(input.ledgerRoot, now).filter((r) => r.state === 'active' && !r.expired && r.session !== input.session)
  const reqOfUnit = (u: Record<string, unknown>): string => {
    const v = u.requirement ?? u.req_ids ?? ''
    return typeof v === 'string' ? v.trim() : (Array.isArray(v) ? String(v[0] ?? '').trim() : '')
  }
  const others = rows.map((r: FocusRow) => ({
    session: r.session,
    reqId: r.reqId,
    tasks: input.units
      .filter((u) => String(u.kind ?? '') === 'task' && reqOfUnit(u) === r.reqId
        && String(u.status ?? '') === 'doing')
      .map((u) => ({ id: String(u.id ?? ''), paths: scopePathsOf(u) })),
  }))
  const findings = conflictsOf({ session: input.session, taskId: input.taskId, paths: scopePathsOf(task) }, others)
  if (findings.length > 0) {
    const f = findings[0]!
    pauseFocus(input.ledgerRoot, {
      session: input.session, reqId, kind: 'paused-conflict',
      reason: '与 ' + f.withSession + ' 推进的 ' + f.withReqId + '（' + f.withTaskId + '）路径冲突：' + f.path,
    })
    return {
      ok: false,
      message: '并行冲突：本任务与另一会话正在推进的需求路径相交（' + findings.slice(0, 3).map((x) => x.withTaskId + ' · ' + x.path).join('；') + '）'
        + ' ⇒ 已把本需求登记为 paused-conflict。要并行，需要任务声明不同的写范围，或显式加串行依赖。',
    }
  }
  if (!hasIdentity) return { ok: true, note: '会话身份判不出 ⇒ 未领取推进焦点（WIP=1 未生效），仅做冲突检测。' }
  return acquired !== undefined && acquired.kind === 'reclaimed'
    ? { ok: true, note: '接管了 ' + acquired.fromSession + ' 的过期焦点（租约到期）。' }
    : { ok: true }
}
