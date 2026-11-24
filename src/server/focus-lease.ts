/**
 * **推进焦点与租约（B+C 的底座）**（2026-11-24）。
 *
 * ══ 它解决什么 ═══════════════════════════════════════════════════════════
 *   本仓此前**没有「一个会话一次只推进一条在途需求」的约束**，也没有跨会话的
 *   并行冲突检测 ⇒ 两条链可以同时占同一个会话、同时改同一批文件。
 *
 * ══ 状态机（照 Ratchet 的 job lifecycle 收敛后的六态）═════════════════════
 *   · active        —— 本会话正在推进（**同一会话至多一条**，WIP=1）
 *   · queued        —— 排队（本会话已有 active；轮到它需显式切换）
 *   · paused-user   —— 用户显式暂停（保留 pausedFrom，resume 回到原态）
 *   · paused-conflict —— 因**跨会话路径冲突**被暂停（同保留 pausedFrom）
 *   · blocked       —— 结构性阻塞（缺批准 / 缺验证等；由门禁给出原因）
 *   · released/done —— 本会话已释放该需求（不占 WIP 名额）
 *   ⚠ **不给 hidden/隐藏态**：Ratchet 的 WAITING 是等外部信号；本仓对应的是
 *     blocked（等用户/等验证），而隐藏会让状态不可观测——与本项目纪律相反。
 *
 * ══ 租约（照 Retasc「领取即租约」）════════════════════════════════════════
 *   · 领取原子（同一会话同一条，重复领取幂等）；租约带 expiresAt；
 *   · 心跳（每次派活/读状态）续租；
 *   · 过期 ⇒ 允许别的会话接管（stale reclaim），回包如实说接管了谁的旧租约；
 *   · ⛔ 不自动删除他人未过期的焦点 —— 那等于把别人的工作悄悄弄没。
 *
 * @module focus-lease
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const FOCUS_VERSION = 1 as const
/** 租约默认时长（毫秒）。心跳 = 每次派活 / 读状态。 */
export const FOCUS_LEASE_MS = 30 * 60 * 1000

export const FOCUS_STATES = ['active', 'queued', 'paused-user', 'paused-conflict', 'blocked'] as const
export type FocusState = (typeof FOCUS_STATES)[number]

export interface FocusRow {
  /** ⚠ 仅读数侧出现：到期时刻判不出（⛔ 不等于未过期）。 */
  expiryUndecided?: boolean
  session: string
  reqId: string
  state: FocusState
  pausedFrom?: FocusState
  reason?: string
  acquiredAt: string
  heartbeatAt: string
  expiresAt: string
}

interface FocusStateFile { version: 1; rows: FocusRow[] }

const EMPTY: FocusStateFile = { version: FOCUS_VERSION, rows: [] }

export function focusFilePath(ledgerRoot: string): string {
  return join(ledgerRoot, 'runtime', 'focus-lease.json')
}

function load(file: string): FocusStateFile {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<FocusStateFile>
    if (parsed.version !== 1 || !Array.isArray(parsed.rows)) return { ...EMPTY }
    return { version: 1, rows: parsed.rows as FocusRow[] }
  } catch { return { ...EMPTY } }
}

function save(file: string, state: FocusStateFile): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(state, null, 2))
  renameSync(tmp, file)
}

const iso = (ms: number): string => new Date(ms).toISOString()

/**
 * ⚠ 2026-11-25（第 1 波 · P0）：**到期时刻只解析一次、只有一种结论**。
 *   改前 readFocus 用 `<=` 判 expired（坏值 ⇒ NaN ⇒ false ⇒ 显示未过期），
 *   acquireFocus 用 `>` 判可接管（坏值 ⇒ false ⇒ 认为不 live ⇒ **可接管**）——
 *   同一个坏 time 给出相反结论。现在：**解析不出 ⇒ undecided**（⛔ 不当过期、⛔ 不当可接管）。
 */
export type ExpiryReading = { kind: 'ok'; at: number } | { kind: 'undecided' }
export function parseExpiry(raw: string | undefined): ExpiryReading {
  const at = Date.parse(String(raw ?? ''))
  return Number.isFinite(at) ? { kind: 'ok', at } : { kind: 'undecided' }
}
/** 过期判定（唯一入口）：只有**能解析且已到期**才算过期；判不出 ⇒ 不算过期。 */
export function isExpired(raw: string | undefined, nowMs: number): boolean {
  const e = parseExpiry(raw)
  return e.kind === 'ok' && e.at <= nowMs
}
/** ⚠ 可接管 = 可解析且已过期（由 isExpired + parseExpiry 组合判定，⛔ 不再另开一个导出）。 */

/** 纯函数：某会话当前的 active 焦点（只有未过期的算数）。 */
export function activeOf(state: FocusStateFile, session: string, nowMs: number): FocusRow | undefined {
  return state.rows.find((r) => r.session === session && r.state === 'active'
    && !isExpired(r.expiresAt, nowMs) && parseExpiry(r.expiresAt).kind === 'ok')
}

/**
 * **领取推进焦点**（WIP=1 的执行点）。
 *   · acquired —— 本会话拿到该需求 active（重复领取幂等续租）；
 *   · busy     —— 本会话已有别的 active ⇒ 调用方必须登记 queued 并如实告知；
 *   · reclaimed —— 该需求被别会话的过期焦点占着 ⇒ 接管，带回原会话 id。
 */
export type AcquireResult =
  | { ok: true; kind: 'acquired' | 'renewed' }
  | { ok: true; kind: 'reclaimed'; fromSession: string }
  | { ok: false; kind: 'busy'; activeReqId: string; activeSession: string }
  | { ok: false; kind: 'no-identity' }
  | { ok: false; kind: 'undecided'; session: string }

export function acquireFocus(
  ledgerRoot: string,
  input: { session: string; reqId: string; nowMs?: number; leaseMs?: number },
): AcquireResult {
  const now = input.nowMs ?? Date.now()
  /** ⚠ 2026-11-25（P0）：**会话身份为空 ⇒ 不领租约**（否则空串会话会占住需求，把别的无身份会话挡在外面）。 */
  if (String(input.session ?? '').trim() === '') return { ok: false, kind: 'no-identity' } as unknown as AcquireResult
  const lease = input.leaseMs ?? FOCUS_LEASE_MS
  const file = focusFilePath(ledgerRoot)
  const state = load(file)
  const mine = state.rows.find((r) => r.session === input.session && r.reqId === input.reqId)
  const current = activeOf(state, input.session, now)
  if (mine !== undefined && current !== undefined && current.reqId === input.reqId) {
    mine.heartbeatAt = iso(now)
    mine.expiresAt = iso(now + lease)
    save(file, state)
    return { ok: true, kind: 'renewed' }
  }
  if (current !== undefined && current.reqId !== input.reqId) {
    return { ok: false, kind: 'busy', activeReqId: current.reqId, activeSession: input.session }
  }
  const others = state.rows.filter((r) => r.reqId === input.reqId && r.session !== input.session && r.state === 'active')
  /** ⚠ 只有**能解析且未到期**才算 live；判不出 ⇒ 不算 live ⇒ 允许接管（坏档不能永久锁死）。 */
  const live = others.find((r) => { const e = parseExpiry(r.expiresAt); return e.kind === 'ok' && e.at > now })
  if (live !== undefined) {
    return { ok: false, kind: 'busy', activeReqId: live.reqId, activeSession: live.session }
  }
  /**
   * ⚠ 2026-11-25（P0）：**到期时刻判不出的焦点行不自动接管**（fail-closed）。
   *   理由：坏值既不等于过期也不等于未过期；自动接管等于「靠一个损坏的读数把别人的工作抢走」。
   *   ⇒ 明确返回 undecided + 可读处理办法（修复/清理该行），由人/工具显式处理。
   */
  const undecided = others.find((r) => parseExpiry(r.expiresAt).kind === 'undecided')
  if (undecided !== undefined) return { ok: false, kind: 'undecided', session: undecided.session }
  const reclaimedFrom = others.length > 0 ? others[0]!.session : undefined
  for (const r of others) r.state = 'queued'
  const row: FocusRow = {
    session: input.session, reqId: input.reqId, state: 'active',
    acquiredAt: iso(now), heartbeatAt: iso(now), expiresAt: iso(now + lease),
  }
  const idx = state.rows.findIndex((r) => r.session === input.session && r.reqId === input.reqId)
  if (idx >= 0) state.rows[idx] = row; else state.rows.push(row)
  save(file, state)
  return reclaimedFrom === undefined ? { ok: true, kind: 'acquired' } : { ok: true, kind: 'reclaimed', fromSession: reclaimedFrom }
}

/** 暂停（显式状态；保留 pausedFrom）。⛔ kind 只认 paused-user / paused-conflict。 */
export function pauseFocus(ledgerRoot: string, input: { session: string; reqId: string; kind: 'paused-user' | 'paused-conflict'; reason: string }): boolean {
  const file = focusFilePath(ledgerRoot)
  const state = load(file)
  const row = state.rows.find((r) => r.session === input.session && r.reqId === input.reqId)
  if (row === undefined) return false
  row.pausedFrom = row.state
  row.state = input.kind
  row.reason = input.reason
  save(file, state)
  return true
}

/** 恢复：回到 pausedFrom（⛔ 缺 pausedFrom 就回 queued，不猜 active）。 */
export function resumeFocus(ledgerRoot: string, input: { session: string; reqId: string; nowMs?: number }): FocusState | undefined {
  const now = input.nowMs ?? Date.now()
  const file = focusFilePath(ledgerRoot)
  const state = load(file)
  const row = state.rows.find((r) => r.session === input.session && r.reqId === input.reqId)
  if (row === undefined) return undefined
  const back = row.pausedFrom ?? 'queued'
  row.state = back === 'active' && activeOf(state, input.session, now) !== undefined ? 'queued' : back
  row.pausedFrom = undefined
  row.reason = undefined
  row.heartbeatAt = iso(now)
  if (row.state === 'active') row.expiresAt = iso(now + FOCUS_LEASE_MS)
  save(file, state)
  return row.state
}

/** 只读视图（面板/状态用）：全部行 + 过期标记。 */
export function readFocus(ledgerRoot: string, nowMs = Date.now()): Array<FocusRow & { expired: boolean }> {
  const file = focusFilePath(ledgerRoot)
  if (!existsSync(file)) return []
  return load(file).rows.map((r) => parseExpiry(r.expiresAt).kind === 'ok'
    ? { ...r, expired: isExpired(r.expiresAt, nowMs) }
    /** ⚠ 坏时刻：显示为**判不出**（expired:false 但带 expiryUndecided），⛔ 不假装未过期。 */
    : { ...r, expired: false, expiryUndecided: true })
}

/** **焦点控制面**（control 的 focus 动作）：list / acquire / pause / resume。⛔ 不做切换（切换是产品决定）。 */
export function focusControlOf(root: string, session: string, args: Record<string, unknown>): Record<string, unknown> {
  const action = String(args.focusAction ?? 'list')
  if (action === 'list') return { ok: true, rows: readFocus(root) }
  const reqId = String(args.focusReqId ?? '').trim()
  if (reqId === '') return { ok: false, reason: 'focus-req-required', message: '拒绝：focus 需要 focusReqId（R-…）。' }
  if (action === 'acquire') return { ok: true, result: acquireFocus(root, { session, reqId }) }
  if (action === 'pause') {
    const why = String(args.focusReason ?? '').trim()
    if (why === '') return { ok: false, reason: 'focus-reason-required', message: '拒绝：暂停必须给 focusReason（人读）。' }
    const done = pauseFocus(root, { session, reqId, kind: 'paused-user', reason: why })
    return done ? { ok: true, state: 'paused-user' } : { ok: false, reason: 'focus-not-found', message: '拒绝：本会话没有这条焦点。' }
  }
  if (action === 'resume') {
    const st = resumeFocus(root, { session, reqId })
    return st === undefined ? { ok: false, reason: 'focus-not-found', message: '拒绝：本会话没有这条焦点。' } : { ok: true, state: st }
  }
  return { ok: false, reason: 'focus-action-invalid', message: '拒绝：focusAction 只收 list / acquire / pause / resume。' }
}
