/**
 * Classifies a ledger-relative write path into the progress views it invalidates.
 *
 * The point is deliberately narrow: a handoff note does not change the project
 * pipeline, so it must not make every open panel refetch. Bookkeeping and
 * runtime changes do. This function is pure so the route tests and hub tests use
 * exactly the same rule as production writes.
 */
import type { LiveSource } from './live-protocol.ts'

/** Normalize a relative write path; returns '' for paths outside the ledger. */
export function normalizeSignalPath(file: unknown): string {
  if (typeof file !== 'string') return ''
  const parts: string[] = []
  for (const raw of file.replace(/\\/g, '/').split('/')) {
    const seg = raw.trim()
    if (seg === '' || seg === '.') continue
    if (seg === '..') { parts.pop(); continue }
    parts.push(seg)
  }
  return parts.join('/')
}

/** True when a write belongs to the durable project ledger rather than history. */
export function liveSourcesOfLedgerWrite(file: unknown): LiveSource[] {
  const path = normalizeSignalPath(file)
  if (path === '') return []
  if (path.startsWith('ledger/units/')) return ['ledger']
  if (path.startsWith('ledger/spec/')) return ['ledger']
  return []
}

/** Runtime state files under `runtime/` invalidate runtime-derived views. */
export function liveSourcesOfRuntimeWrite(file: unknown): LiveSource[] {
  const path = normalizeSignalPath(file)
  if (path === '') return []
  if (path.startsWith('runtime/work-plans/')) return ['plans']
  if (path.startsWith('runtime/')) return ['runtime']
  return []
}

/** Merge sources without duplicates, preserving the protocol's stable order. */
export function mergeLiveSources(...groups: ReadonlyArray<readonly LiveSource[]>): LiveSource[] {
  const order: LiveSource[] = ['ledger', 'runtime', 'plans', 'session', 'catalog']
  const seen = new Set(groups.flat())
  return order.filter((source) => seen.has(source))
}

