/**
 * Canonical ledger-write policy shared by the Host write gate and checks.
 *
 * This module deliberately contains no filesystem access. It is a pure policy
 * face: classification only. `server/hob-write.ts` owns enforcement.
 */

export const CURRENT_ROOT_DOCS = ['CONTEXT.md', 'PROJECT.md', 'DECISIONS.md'] as const

export const HOB_WRITE_OPERATIONS = [
  'create-unit',
  'transition-unit',
  'link-unit',
  'append-evidence',
  'replace-current',
  'compact-archive',
  'write-active-change',
  'write-ledger-source',
] as const

export type HobWriteOperation = (typeof HOB_WRITE_OPERATIONS)[number]

export const ACTIVE_CHANGE_FILES = ['proposal.md', 'tasks.md', 'deltas.md'] as const

export const GENERATED_LEDGER_PREFIXES = ['ledger/gen/', 'ledger/spec/'] as const

export function isCurrentRootDoc(file: string): boolean {
  return (CURRENT_ROOT_DOCS as readonly string[]).includes(file)
}

export function isGeneratedLedgerPath(file: string): boolean {
  return GENERATED_LEDGER_PREFIXES.some((prefix) => file.startsWith(prefix))
}

/**
 * A permitted active-change file has exactly one path segment below its change
 * directory and belongs to the closed current-material set.
 */
export function isActiveChangeFile(file: string): boolean {
  const m = /^ledger\/changes\/[^/]+\/([^/]+)$/.exec(file)
  return m !== null && (ACTIVE_CHANGE_FILES as readonly string[]).includes(m[1]!)
}

export function classifyHobWritePath(file: string): HobWriteOperation | undefined {
  if (isCurrentRootDoc(file)) return 'replace-current'
  if (file.startsWith('ledger/changes/')) return 'write-active-change'
  if (file.startsWith('ledger/units/')) return 'write-ledger-source'
  if (file.startsWith('archive/')) return 'append-evidence'
  if (file.startsWith('volumes/')) return 'append-evidence'
  return undefined
}
