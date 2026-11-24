/**
 * **待决清单载体**（2026-11-25 · P1）：把散落在对话里的「要用户拍板的事」落成可读、可关的条目。
 *
 * 病（实测）：门禁最后一环怎么办、五件待办是否立项 —— 都只活在对话与 archive 里，
 *   下一轮再问一遍。⇒ 需要一个**只追加、可关闭**的最小载体。
 *
 * ⚠ 不放进账本 kind：那要改 KIND_SPEC 与全量校验；这里先落在 runtime（⚠ 不是「账本事实」，
 *   所以 ⛔ 不参与任何门禁判定），出口只读、写入只经工具动作。
 *
 * @module pending-decisions
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface PendingRow {
  id: string
  /** 幂等键：同一件事重复登记只累加次数。 */
  key: string
  question: string
  options: string[]
  recommended?: string
  askedBy: string
  at: string
  status: 'open' | 'closed'
  answer?: string
  closedAt?: string
}

interface State { version: 1; nextSeq: number; rows: PendingRow[] }
const EMPTY: State = { version: 1, nextSeq: 1, rows: [] }

export function pendingPath(ledgerRoot: string): string {
  return join(ledgerRoot, 'runtime', 'pending-decisions.json')
}

function load(file: string): State {
  if (!existsSync(file)) return { ...EMPTY, rows: [] }
  try {
    const p = JSON.parse(readFileSync(file, 'utf8')) as Partial<State>
    if (p.version !== 1 || !Array.isArray(p.rows) || typeof p.nextSeq !== 'number') return { ...EMPTY, rows: [] }
    return { version: 1, nextSeq: p.nextSeq, rows: p.rows as PendingRow[] }
  } catch { return { ...EMPTY, rows: [] } }
}

function save(file: string, s: State): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(s, null, 2))
  renameSync(tmp, file)
}

/** 登记一条待决（幂等：同 key 只累加，不新建）。 */
export function recordPending(ledgerRoot: string, input: { key: string; question: string; options?: string[]; recommended?: string; askedBy: string; now?: Date }): { ok: boolean; id?: string; deduped?: boolean } {
  const file = pendingPath(ledgerRoot)
  const s = load(file)
  const at = (input.now ?? new Date()).toISOString()
  /** 幂等：同 key 已登记（无论开闭）⇒ 直接回原 id，⛔ 不重复堆条目。 */
  const found = s.rows.find((r) => r.key === input.key)
  if (found !== undefined) return { ok: true, id: found.id, deduped: true }
  const id = 'PEND-' + String(s.nextSeq).padStart(3, '0')
  s.nextSeq += 1
  s.rows.push({ id, key: input.key, question: input.question, options: input.options ?? [], ...(input.recommended === undefined ? {} : { recommended: input.recommended }), askedBy: input.askedBy, at, status: 'open' })
  save(file, s)
  return { ok: true, id }
}

/** 关闭一条（answer 必填；⛔ 不许无答案关闭）。 */
export function closePending(ledgerRoot: string, input: { id: string; answer: string; now?: Date }): { ok: boolean; reason?: string } {
  const file = pendingPath(ledgerRoot)
  const s = load(file)
  const row = s.rows.find((r) => r.id === input.id)
  if (row === undefined) return { ok: false, reason: 'not-found' }
  if (String(input.answer).trim() === '') return { ok: false, reason: 'answer-required' }
  row.status = 'closed'
  row.answer = input.answer
  row.closedAt = (input.now ?? new Date()).toISOString()
  save(file, s)
  return { ok: true }
}

export function readPending(ledgerRoot: string): PendingRow[] {
  return load(pendingPath(ledgerRoot)).rows
}

/** **待决清单控制面**（control 的 pending 动作）：list / record / close。 */
export function pendingControlOf(root: string, session: string, args: Record<string, unknown>): Record<string, unknown> {
  const action = String(args.pendingAction ?? 'list')
  if (action === 'list') { const rows = readPending(root); return { ok: true, rows, open: rows.filter((r) => r.status === 'open').length } }
  if (action === 'record') {
    const question = String(args.pendingQuestion ?? '').trim()
    if (question === '') return { ok: false, reason: 'question-required', message: '拒绝：登记待决必须给 pendingQuestion。' }
    const key = String(args.pendingKey ?? '').trim() || question.slice(0, 40)
    const options = Array.isArray(args.pendingOptions) ? (args.pendingOptions as unknown[]).map(String) : []
    return { ok: true, result: recordPending(root, { key, question, options, ...(typeof args.pendingRecommended === 'string' ? { recommended: args.pendingRecommended } : {}), askedBy: session }) }
  }
  if (action === 'close') {
    const id = String(args.pendingId ?? '').trim()
    const answer = String(args.pendingAnswer ?? '').trim()
    return closePending(root, { id, answer })
  }
  return { ok: false, reason: 'pending-action-invalid', message: '拒绝：pendingAction 只收 list / record / close。' }
}
