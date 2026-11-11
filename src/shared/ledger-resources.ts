/**
 * 账本资源图：稳定 ID → 摘要 → 子资源。
 *
 * ⚠ 零 I/O 的纯函数层：调用方把已解析的 `units` 交进来。
 * ⛔ 不在这里读文件、不取当前时间、不写状态。
 * 目标与 `orchestrator_read` 的 Inline/Spill 一致：列表只回摘要与读取指针。
 */

import { presentationOf, type ItemPresentation } from './item-presentation.ts'

export type LedgerKind =
  | 'goal' | 'req' | 'change' | 'task' | 'run'
  | 'acc' | 'verification' | 'closure' | 'evidence' | 'risk' | 'decision' | 'cap'

export interface LedgerUnitLike {
  id: string
  kind: string
  title?: string
  status?: string
  parent?: string
  [key: string]: unknown
}

export interface LedgerCard {
  id: string
  kind: string
  title: string
  status: string
  parent?: string
  read: string
  children?: string[]
  /**
   * 完整账本单元（仅按 ID 读取时返回）。
   * ⚠ 列表与资源图只回摘要；只有展开某一条时才需要正文。
   */
  unit?: LedgerUnitLike
  /**
   * 完整展示投影（仅按 ID 读取时返回）。
   * ⚠ 与列表投影同源；客户端展开时按中文事实名显示，⛔ 不自行另写一套状态。
   */
  presentation?: ItemPresentation
}

export type ResourceRead =
  | { ok: true; resource: string; card: LedgerCard; children: LedgerCard[] }
  | { ok: false; resource: string; reason: 'unknown-resource' | 'unknown-id' | 'not-found'; message: string }

const READ_PREFIX: Readonly<Record<LedgerKind, string>> = {
  goal: 'goal',
  req: 'requirement',
  change: 'change',
  task: 'task',
  run: 'run',
  acc: 'acceptance',
  verification: 'verification',
  closure: 'closure',
  evidence: 'evidence',
  risk: 'risk',
  decision: 'decision',
  cap: 'capability',
}

const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).filter((x) => x !== '') : []

/** 由 ID 前缀判 kind；未知 ⇒ undefined（⛔ 不靠 title 猜）。 */
export function kindOfId(id: string): LedgerKind | undefined {
  const x = String(id)
  if (/^G-\d+$/.test(x)) return 'goal'
  if (/^R-\d+$/.test(x)) return 'req'
  if (x.startsWith('CHG-')) return 'change'
  if (/^TSK-\d+$/.test(x)) return 'task'
  if (/^RUN-\d+$/.test(x)) return 'run'
  if (/^ACC-\d+$/.test(x)) return 'acc'
  if (/^VER-\d+$/.test(x)) return 'verification'
  if (/^CLS-\d+$/.test(x)) return 'closure'
  if (/^EVD-\d+$/.test(x)) return 'evidence'
  if (/^RSK-\d+$/.test(x)) return 'risk'
  if (/^DEC-\d+$/.test(x)) return 'decision'
  if (/^CAP-\d+$/.test(x)) return 'cap'
  return undefined
}

/** 写一条单元的资源读取路径。 */
export function readPathOf(unit: Pick<LedgerUnitLike, 'id' | 'kind'>): string {
  const kind = kindOfId(String(unit.id))
  return kind === undefined ? `${String(unit.kind)}/${String(unit.id)}` : `${READ_PREFIX[kind]}/${String(unit.id)}`
}

/** 构建单条资源卡片；⛔ 不内联正文。 */
export function cardOf(unit: LedgerUnitLike, children: readonly LedgerUnitLike[] = []): LedgerCard {
  const card: LedgerCard = {
    id: String(unit.id),
    kind: String(unit.kind),
    title: String(unit.title ?? ''),
    status: String(unit.status ?? ''),
    read: readPathOf(unit),
  }
  if (typeof unit.parent === 'string' && unit.parent !== '') card.parent = unit.parent
  if (children.length > 0) card.children = children.map((x) => readPathOf(x))
  return card
}

/** 直接子项：只按 `parent` 归属，⛔ 不用 `after`。 */
export function childrenOf(units: readonly LedgerUnitLike[], id: string): LedgerUnitLike[] {
  return units.filter((u) => String(u.parent ?? '') === String(id))
}

/** 一条需求沿正式边串出的资源图。 */
function requirementChildren(units: readonly LedgerUnitLike[], rid: string): LedgerUnitLike[] {
  const out: LedgerUnitLike[] = []
  const seen = new Set<string>()
  const add = (u: LedgerUnitLike | undefined) => {
    if (u === undefined || seen.has(String(u.id))) return
    seen.add(String(u.id)); out.push(u)
  }
  for (const u of units) {
    if (u.kind === 'goal' && arr(u.req_ids).includes(rid)) add(u)
    if (u.kind === 'change' && arr(u.addresses).includes(rid)) add(u)
    if (u.kind === 'task' && (String(u.parent ?? '') === rid || arr(u.req_ids).includes(rid))) add(u)
  }
  const anchors = new Set([rid, ...out.map((u) => String(u.id))])
  const relationUnits = units.filter((u) => anchors.has(String(u.id)))
  const namedRisks = new Set(relationUnits.flatMap((u) => arr(u.risk_ids)))
  const namedDecisions = new Set(relationUnits.flatMap((u) => arr(u.decisions)))
  for (const u of units) {
    if (u.kind === 'risk' && (arr(u.affects).some((x) => anchors.has(x)) || namedRisks.has(String(u.id)))) add(u)
    if (u.kind === 'decision' && namedDecisions.has(String(u.id))) add(u)
  }
  return out
}

/**
 * 读一个稳定资源。
 *
 * 支持：
 * - `requirement/<R-id>`：需求 + 目标 / 方案 / 任务索引；
 * - `goal/<G-id>`、`change/<CHG-id>`、`task/<TSK-id>`、`run/<RUN-id>`、
 *   `acceptance/<ACC-id>`、`evidence/<EVD-id>`、`risk/<RSK-id>`、
 *   `decision/<DEC-id>`、`capability/<CAP-id>`；
 * - `<kind>/<id>/children`：仅返回直属子项卡片；
 * - 列表：`goals`、`requirements`、`changes`、`tasks`、`runs`、`acceptances`、
 *   `evidences`、`risks`、`decisions`、`capabilities`（兼容别名 `caps`）。
 */
export function readLedgerResource(units: readonly LedgerUnitLike[], resource: string): ResourceRead {
  const name = String(resource ?? '').trim().replace(/^\/+|\/+$/g, '')
  const LIST: Readonly<Record<string, string>> = {
    goals: 'goal',
    requirements: 'req',
    changes: 'change',
    tasks: 'task',
    runs: 'run',
    acceptances: 'acc',
    verifications: 'verification',
    closures: 'closure',
    evidences: 'evidence',
    risks: 'risk',
    decisions: 'decision',
    capabilities: 'cap',
    caps: 'cap',
  }
  const listKind = LIST[name]
  if (listKind !== undefined) {
    const found = units.filter((u) => u.kind === listKind)
    return {
      ok: true,
      resource: name,
      card: { id: name, kind: 'list', title: name, status: '', read: name, children: found.map((u) => readPathOf(u)) },
      children: found.map((u) => cardOf(u)),
    }
  }
  const m = /^(goal|requirement|change|task|run|acceptance|verification|closure|evidence|risk|decision|capability)\/([^/]+)(?:\/(children))?$/.exec(name)
  if (m === null) {
    return { ok: false, resource: name, reason: 'unknown-resource', message: `不认识的资源：${name}` }
  }
  const kind = m[1]
  const id = m[2]!
  const unit = units.find((u) => String(u.id) === id)
  if (unit === undefined) {
    return { ok: false, resource: name, reason: 'not-found', message: `账本里没有 ${id}` }
  }
  const expected = kindOfId(id)
  const prefixKind = kind === 'requirement'
    ? 'req'
    : kind === 'acceptance'
      ? 'acc'
      : kind === 'capability'
        ? 'cap'
        : kind
  if (expected !== prefixKind) {
    return { ok: false, resource: name, reason: 'unknown-id', message: `${id} 的 kind 不是 ${prefixKind}` }
  }
  const children = id.startsWith('R-')
    ? requirementChildren(units, id)
    : childrenOf(units, id)
  if (m[3] === 'children') {
    const direct = childrenOf(units, id)
    return { ok: true, resource: name, card: cardOf(unit, direct), children: direct.map((u) => cardOf(u)) }
  }
  return {
    ok: true,
    resource: name,
    card: { ...cardOf(unit, children), unit, presentation: presentationOf(unit, units) },
    children: children.map((u) => cardOf(u)),
  }
}
