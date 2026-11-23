/**
 * **通知账本（notify 档）**（2026-11-23 · 业界三档补齐）。
 *
 * ══ 它补的是哪一档 ═══════════════════════════════════════════════════════
 *   AWS Agentic AI Lens 把动作分三档：autonomous（低风险可逆，自动）/
 *   notify（中风险，**放行 + 让操作者知情**）/ approve（高风险或不可逆，需显式批准）。
 *   本仓此前只有 autonomous（机器事务）与 approve（G1/G2/G5/…），**缺中间那一档** ——
 *   于是"中等风险的自动动作"要么无声发生（不可观测），要么被塞进批准链（审批疲劳）。
 *
 * ══ 纪律 ═════════════════════════════════════════════════════════════════
 *   · **只追加**、按时间倒序读；⛔ 不删历史（保留条数有上限，超出只裁**最旧**的）；
 *   · 每条带 kind / subject / detail / actor / at，**可审计**；
 *   · 幂等键 key：同一动作重复触发只累加 count（⛔ 不刷屏）；
 *   · ⛔ 不参与任何门禁判定 —— 它只是"知情"，**不是批准凭证**（AWS 明写 notify ≠ approve）。
 *
 * @module notify-ledger
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const NOTIFY_LEDGER_VERSION = 1 as const
/** 保留条数上限（超出裁最旧；⚠ 只为不无限长，⛔ 不是"过了就当没发生"）。 */
export const NOTIFY_MAX_ROWS = 200

export interface NotifyRow {
  id: number
  at: string
  /** 动作类别（approval-rebind / retry-abandoned / unlock-bootstrap / dispatch-mismatch）。 */
  kind: string
  /** 幂等键：同键只累加 count。 */
  key: string
  subject: string
  detail?: string
  actor?: string
  count?: number
}

interface NotifyState { version: 1; nextId: number; rows: NotifyRow[] }

const EMPTY: NotifyState = { version: NOTIFY_LEDGER_VERSION, nextId: 1, rows: [] }

export function notifyLedgerPath(ledgerRoot: string): string {
  return join(ledgerRoot, 'runtime', 'notifications.json')
}

function load(file: string): NotifyState {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<NotifyState>
    if (parsed.version !== 1 || !Array.isArray(parsed.rows) || typeof parsed.nextId !== 'number') return { ...EMPTY }
    return { version: 1, nextId: parsed.nextId, rows: parsed.rows as NotifyRow[] }
  } catch { return { ...EMPTY } }
}

/**
 * **记一条 notify**（幂等）。
 * ⚠ 出错**不抛**：通知是旁路观测，⛔ 不许因为它写失败而阻断真正的业务动作
 *   （返回值里 ok:false 与原因如实带回）。
 */
export function recordNotify(
  ledgerRoot: string,
  entry: { kind: string; key: string; subject: string; detail?: string; actor?: string; now?: Date },
): { ok: boolean; id?: number; deduped?: boolean; reason?: string } {
  try {
    const file = notifyLedgerPath(ledgerRoot)
    const state = load(file)
    const at = (entry.now ?? new Date()).toISOString()
    const found = state.rows.find((r) => r.key === entry.key)
    if (found !== undefined) {
      found.count = (found.count ?? 1) + 1
      found.at = at
      if (entry.detail !== undefined) found.detail = entry.detail
    } else {
      const row: NotifyRow = {
        id: state.nextId++,
        at,
        kind: entry.kind,
        key: entry.key,
        subject: entry.subject,
        ...(entry.detail === undefined ? {} : { detail: entry.detail }),
        ...(entry.actor === undefined ? {} : { actor: entry.actor }),
        count: 1,
      }
      state.rows.push(row)
      if (state.rows.length > NOTIFY_MAX_ROWS) state.rows = state.rows.slice(state.rows.length - NOTIFY_MAX_ROWS)
    }
    mkdirSync(dirname(file), { recursive: true })
    const tmp = file + '.tmp'
    writeFileSync(tmp, JSON.stringify(state, null, 2))
    renameSync(tmp, file)
    return { ok: true, id: found === undefined ? state.rows[state.rows.length - 1]?.id : found.id, deduped: found !== undefined }
  } catch (e) {
    return { ok: false, reason: String((e as Error)?.message ?? e) }
  }
}

/** **通知面**（供工具层注入用）：record 写、read 只读。⛔ 不参与门禁判定。 */
export function notifyFaceOf(ledgerRoot: string): {
  record: (entry: { kind: string; key: string; subject: string; detail?: string; actor?: string }) => void
  read: (limit?: number) => { readable: boolean; rows: NotifyRow[]; total: number; reason?: string }
} {
  return {
    record: (entry) => { recordNotify(ledgerRoot, entry) },
    read: (limit) => {
      const r = readNotifications(ledgerRoot, limit ?? 20)
      return r.readable === true ? { readable: true, rows: r.rows, total: r.total } : { readable: false, rows: [], total: 0, reason: r.reason }
    },
  }
}

/** **只读**读数：新的在前。⚠ 文件不存在 = 空（⛔ 不是"读不到"）。 */
export function readNotifications(
  ledgerRoot: string,
  limit = 20,
): { readonly: true; readable: true; rows: NotifyRow[]; total: number } | { readonly: true; readable: false; reason: string } {
  try {
    const file = notifyLedgerPath(ledgerRoot)
    if (!existsSync(file)) return { readonly: true, readable: true, rows: [], total: 0 }
    const state = load(file)
    const rows = [...state.rows].reverse().slice(0, Math.max(0, limit))
    return { readonly: true, readable: true, rows, total: state.rows.length }
  } catch (e) {
    return { readonly: true, readable: false, reason: String((e as Error)?.message ?? e) }
  }
}
