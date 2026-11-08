/**
 * **需求链投影**（纯函数，零 I/O）。
 *
 * 面板的主线不是“按阶段堆叠全部条目”，而是**一条需求从需求规格走到验收核对**。
 * 本模块只认账本的正式关系字段，把同一份 units 折成每条需求的链摘要：
 *
 *   需求 → change.addresses → task.parent / task.req_ids → run.parent / acc.parent
 *
 * ⛔ 不从标题里的编号反推关系；⛔ 不用 after 当承接；⛔ 不挂到最近条目。
 * ⛔ 不新增账本字段、不写盘、不取时间。
 */

import { effectiveAcceptanceOf, type AcceptanceVerdictLike } from './acceptance-verdict.ts'
import { nextAction, type NextAction } from './next-action.ts'
import { panelSummaryOf, type PanelSummary } from './panel-summary.ts'
import type { StageRow } from './stages-index.ts'

export type ChainDisplayState = 'done' | 'doing' | 'waiting' | 'blocked' | 'todo'

export interface ChainStep {
  step: number
  name: string
  displayState: ChainDisplayState
  summary: string
  total: number
  done: number
  doing: number
  waiting: number
  itemIds: string[]
}

export interface RequirementChain {
  reqId: string
  title: string
  reqStatus: string
  state: 'active' | 'completed' | 'retired'
  inFlight: boolean
  complete: boolean
  currentStep: 1 | 2 | 3 | 4 | 5 | null
  missing: Array<'change' | 'task' | 'run' | 'acc'>
  steps: ChainStep[]
  /** 该需求链自己的下一步；⚠ 与 `/stages` 的全局 next 不是同一个字段。 */
  next: NextAction
  /** 该需求链自己的结论；⚠ 不直接复用全局 summary。 */
  summary: PanelSummary
  itemIds: string[]
}

export interface RequirementChainsOk {
  ok: true
  readAt: string
  activeCount: number
  completedCount: number
  retiredCount: number
  historyItemCount: number
  /** 活跃／已完成需求链；⚠ 退役需求不在这里（RC-7 钉住）。 */
  chains: RequirementChain[]
  /**
   * 退役需求链；只供底部历史展示，⛔ 不进在途列表、⛔ 不参与活跃计数。
   * ⚠ 与 `chains` 分开是刻意的：旧判据要求退役需求不得混入活跃链。
   */
  retiredChains: RequirementChain[]
  unattached: string[]
}

export interface RequirementChainsFail {
  ok: false
  reason: string
  message: string
}

export type RequirementChainsResponse = RequirementChainsOk | RequirementChainsFail

type Unit = Record<string, unknown>
type ChainUnit = Record<string, unknown> & {
  id?: string
  kind?: string
  status?: string
  title?: string
  parent?: string
  created_at?: string
  addresses?: string[]
  req_ids?: string[]
  acceptance_ids?: string[]
  send_back_to?: string
  path_decision?: string
  acceptance_criteria?: string[]
  clarify_examples?: string[]
}

const STEP_DEFS = [
  { step: 1, name: '需求规格', kind: 'req' },
  { step: 2, name: '实现方案', kind: 'change' },
  { step: 3, name: '编码任务', kind: 'task' },
  { step: 4, name: '任务执行', kind: 'run' },
  { step: 5, name: '验收核对', kind: 'acc' },
] as const

const arr = (v: unknown): string[] => Array.isArray(v) ? v.map(String).filter((x) => x !== '') : []
const text = (v: unknown): string => typeof v === 'string' ? v.trim() : ''
const statusOf = (u: ChainUnit): string => String(u.status ?? '')
const idOf = (u: ChainUnit): string => String(u.id ?? '')

const byCreated = (a: ChainUnit, b: ChainUnit): number => {
  const ca = text(a.created_at)
  const cb = text(b.created_at)
  if (ca !== cb) return ca < cb ? -1 : 1
  return idOf(a).localeCompare(idOf(b))
}

/** 方案 / 任务 / 执行 / 验收沿正式边归到一条需求。 */
function chainUnitsOf(req: ChainUnit, units: readonly ChainUnit[]): {
  changes: ChainUnit[]
  tasks: ChainUnit[]
  runs: ChainUnit[]
  accs: ChainUnit[]
} {
  const rid = idOf(req)
  const changes = units
    .filter((u) => u.kind === 'change' && arr(u.addresses).includes(rid))
    .sort(byCreated)
  const changeIds = new Set(changes.map(idOf))
  const tasks = units
    .filter((u) => u.kind === 'task' && (changeIds.has(text(u.parent)) || arr(u.req_ids).includes(rid) || text(u.parent) === rid))
    .sort(byCreated)
  const taskIds = new Set(tasks.map(idOf))
  const runs = units
    .filter((u) => u.kind === 'run' && taskIds.has(text(u.parent)))
    .sort(byCreated)
  const directAccIds = new Set(arr(req.acceptance_ids))
  const accs = units
    .filter((u) => u.kind === 'acc' && (taskIds.has(text(u.parent)) || directAccIds.has(idOf(u))))
    .sort(byCreated)
  return { changes, tasks, runs, accs }
}

/** 同一父任务下的多条 ACC 用 `effectiveAcceptanceOf()` 取有效判决。 */
function verdictGroups(accs: readonly ChainUnit[]): Array<{
  parent: string
  accs: ChainUnit[]
  verdict: ReturnType<typeof effectiveAcceptanceOf>
}> {
  const groups = new Map<string, ChainUnit[]>()
  for (const a of accs) {
    const key = text(a.parent)
    const list = groups.get(key) ?? []
    list.push(a)
    groups.set(key, list)
  }
  return [...groups.entries()].map(([parent, list]) => ({
    parent,
    accs: list,
    verdict: effectiveAcceptanceOf(list as AcceptanceVerdictLike[]),
  }))
}

function countLabel(n: number, unit: string): string {
  return `${n} ${unit}`
}

function stepSummaryOf(step: number, req: ChainUnit, chain: ReturnType<typeof chainUnitsOf>, groups: ReturnType<typeof verdictGroups>): string {
  if (step === 1) {
    const criteria = arr(req.acceptance_criteria)
    if (criteria.length === 0) return '验收条件判不出'
    const examples = arr(req.clarify_examples)
    return `验收条件 ${countLabel(criteria.length, '条')}${examples.length > 0 ? ` · 例子 ${countLabel(examples.length, '条')}` : ''}`
  }
  if (step === 2) {
    if (chain.changes.length === 0) return '还没定方案'
    if (chain.changes.length > 1) {
      const settled = chain.changes.filter((c) => ['settled', 'superseded'].includes(statusOf(c))).length
      return `${countLabel(chain.changes.length, '个方案')} · ${settled} 个已定`
    }
    const decision = text(chain.changes[0].path_decision)
    return decision === '' ? '已定（决策判不出）' : `已定：${decision.length > 32 ? `${decision.slice(0, 31)}…` : decision}`
  }
  if (step === 3) {
    if (chain.tasks.length === 0) return '还没建任务'
    const built = chain.tasks.filter((t) => statusOf(t) === 'built').length
    const doing = chain.tasks.filter((t) => statusOf(t) === 'doing').length
    if (chain.tasks.length === 1) {
      const t = chain.tasks[0]
      return statusOf(t) === 'doing' ? `${idOf(t)} 在做` : statusOf(t) === 'built' ? `${idOf(t)} 已做完` : `${idOf(t)} 待开工`
    }
    return `${countLabel(chain.tasks.length, '个任务')} · ${built} 个已做完${doing > 0 ? ` · ${doing} 个在做` : ''}`
  }
  if (step === 4) {
    if (chain.tasks.length === 0) return '还没有任务'
    if (chain.runs.length === 0) return '无独立执行记录'
    const running = chain.runs.filter((r) => statusOf(r) === 'running').length
    const returned = chain.runs.filter((r) => statusOf(r) === 'returned').length
    return `${running} 在跑 · ${returned} 已回传`
  }
  if (chain.accs.length === 0) return '还没有验收'
  const accepted = groups.filter((g) => g.verdict.verdict === 'accepted').length
  const pending = groups.filter((g) => g.verdict.verdict === 'undecidable').flatMap((g) => g.accs.filter((a) => statusOf(a) === 'unverified').map(idOf))
  return `${accepted}/${groups.length} 已判决${pending.length > 0 ? ` · 待处理 ${pending.join(' · ')}` : ''}`
}

function stateOfStep(step: number, req: ChainUnit, chain: ReturnType<typeof chainUnitsOf>, groups: ReturnType<typeof verdictGroups>): ChainDisplayState {
  if (step === 1) return statusOf(req) === 'agreed' ? 'done' : 'doing'
  if (step === 2) {
    if (chain.changes.length === 0) return 'todo'
    if (chain.changes.some((c) => statusOf(c) === 'proposed')) return 'doing'
    if (chain.changes.every((c) => ['settled', 'superseded'].includes(statusOf(c)))) return 'done'
    return 'todo'
  }
  if (step === 3) {
    if (chain.tasks.length === 0) return 'todo'
    if (chain.tasks.every((t) => statusOf(t) === 'built')) return 'done'
    if (chain.tasks.some((t) => statusOf(t) === 'doing')) return 'doing'
    return 'todo'
  }
  if (step === 4) {
    if (chain.tasks.length === 0) return 'todo'
    if (chain.runs.length === 0) return chain.tasks.every((t) => statusOf(t) === 'built') ? 'done' : 'waiting'
    if (chain.runs.some((r) => ['stuck', 'refused'].includes(statusOf(r)))) return 'blocked'
    if (chain.runs.some((r) => statusOf(r) === 'running')) return 'doing'
    if (chain.tasks.every((t) => statusOf(t) === 'built')) return 'done'
    return 'waiting'
  }
  if (chain.accs.length === 0) return 'todo'
  if (groups.some((g) => g.verdict.verdict === 'send-back')) return 'blocked'
  if (groups.some((g) => g.verdict.verdict === 'undecidable')) return 'waiting'
  return groups.every((g) => g.verdict.verdict === 'accepted') ? 'done' : 'waiting'
}

/** 把链步骤映射成 `StageRow` 供摘要复用；⚠ 只用于摘要，不改变全局线格式。 */
function stageRowsForChain(chain: RequirementChain): StageRow[] {
  return STEP_DEFS.map((d) => {
    const s = chain.steps.find((x) => x.step === d.step)!
    const state: 'done' | 'doing' | 'todo' = s.displayState === 'done' ? 'done' : s.displayState === 'todo' ? 'todo' : 'doing'
    return {
      step: d.step,
      name: d.name,
      state,
      done: s.done,
      total: s.total,
      items: [],
    }
  })
}

/**
 * 算出一条需求的链。
 *
 * @param req - 需求单元
 * @param units - 全账本单元
 * @returns 需求链摘要（不含正文）
 */
export function buildRequirementChain(req: ChainUnit, units: readonly ChainUnit[]): RequirementChain {
  const chain = chainUnitsOf(req, units)
  const groups = verdictGroups(chain.accs)
  const rid = idOf(req)
  const steps: ChainStep[] = STEP_DEFS.map((d) => {
    const items = d.step === 1 ? [req] : d.step === 2 ? chain.changes : d.step === 3 ? chain.tasks : d.step === 4 ? chain.runs : chain.accs
    const displayState = stateOfStep(d.step, req, chain, groups)
    const done = d.step === 1
      ? (statusOf(req) === 'agreed' ? 1 : 0)
      : d.step === 2
        ? chain.changes.filter((c) => ['settled', 'superseded'].includes(statusOf(c))).length
        : d.step === 3
          ? chain.tasks.filter((t) => statusOf(t) === 'built').length
          : d.step === 4
            ? chain.runs.filter((r) => ['returned', 'refused', 'stuck'].includes(statusOf(r))).length
            : groups.filter((g) => g.verdict.verdict === 'accepted').length
    const doing = d.step === 1
      ? (statusOf(req) === 'agreed' ? 0 : 1)
      : d.step === 2
        ? chain.changes.filter((c) => statusOf(c) === 'proposed').length
        : d.step === 3
          ? chain.tasks.filter((t) => statusOf(t) === 'doing').length
          : d.step === 4
            ? chain.runs.filter((r) => statusOf(r) === 'running').length
            : groups.filter((g) => g.verdict.verdict === 'undecidable').length
    const waiting = displayState === 'waiting' ? 1 : 0
    return {
      step: d.step,
      name: d.name,
      displayState,
      summary: stepSummaryOf(d.step, req, chain, groups),
      total: d.step === 1 ? 1 : items.length,
      done,
      doing,
      waiting,
      itemIds: items.map(idOf).filter((x) => x !== ''),
    }
  })

  const missing: RequirementChain['missing'] = []
  if (chain.changes.length === 0) missing.push('change')
  if (chain.tasks.length === 0) missing.push('task')
  if (chain.tasks.length > 0 && chain.runs.length === 0) missing.push('run')
  if (chain.accs.length === 0) missing.push('acc')

  const accepted = groups.length > 0 && groups.every((g) => g.verdict.verdict === 'accepted')
  const tasksDone = chain.tasks.every((t) => statusOf(t) === 'built')
  const complete = accepted && tasksDone
  const retired = ['retired', 'dropped'].includes(statusOf(req))

  let currentStep: RequirementChain['currentStep'] = null
  const blockedGroup = groups.find((g) => g.verdict.verdict === 'send-back')
  if (blockedGroup !== undefined) {
    const back = text(blockedGroup.accs.find((a) => statusOf(a) === 'send-back')?.send_back_to)
    currentStep = back === 'back-to-requirement' ? 1 : back === 'back-to-plan' ? 2 : 3
  } else {
    const firstOpen = steps.find((s) => s.displayState !== 'done')
    currentStep = firstOpen === undefined ? null : firstOpen.step as 1 | 2 | 3 | 4 | 5
  }

  const chainIds = new Set(steps.flatMap((s) => s.itemIds))
  const chainUnits = units.filter((u) => chainIds.has(idOf(u)))
  let next: NextAction
  try {
    next = nextAction(chainUnits as any, {})
  } catch (e) {
    next = {
      kind: 'undecidable',
      target: null,
      why: `下一步算不出来：${String((e as Error)?.message ?? e)}`,
      blockedBy: [],
    }
  }

  const partial: RequirementChain = {
    reqId: rid,
    title: text(req.title),
    reqStatus: statusOf(req),
    state: retired ? 'retired' : complete ? 'completed' : 'active',
    inFlight: !retired && !complete,
    complete,
    currentStep,
    missing,
    steps,
    next,
    summary: panelSummaryOf({ stages: [], next }),
    itemIds: steps.flatMap((s) => s.itemIds),
  }
  partial.summary = panelSummaryOf({ stages: stageRowsForChain(partial), next })
  return partial
}

/**
 * 从账本单元生成所有需求的链摘要。
 *
 * @param units - 账本单元
 * @param readAt - ISO 时刻
 * @returns 线格式响应（只含链摘要，不含条目正文）
 */
export function buildRequirementChains(units: readonly Unit[], readAt: string): RequirementChainsOk {
  const typed = units as ChainUnit[]
  const reqs = typed.filter((u) => u.kind === 'req').sort(byCreated)
  const activeReqs = reqs.filter((r) => !['retired', 'dropped'].includes(statusOf(r)))
  const retiredReqs = reqs.filter((r) => ['retired', 'dropped'].includes(statusOf(r)))
  const chains = activeReqs.map((r) => buildRequirementChain(r, typed))
  const retiredChains = retiredReqs.map((r) => buildRequirementChain(r, typed))
  const activeCount = chains.filter((c) => c.inFlight).length
  const completedCount = chains.filter((c) => c.state === 'completed').length
  /**
   * 历史条目数按**条目去重**后统计：一条 change / task / acc 可能同时服务多条需求
   * （真实账本 `R-006/R-007/R-008` 共享 `TSK-036..038/066/067/068`），
   * 逐链相加会把同一条重复计数。⚠ 与「202 条五步条目」同口径：每个单元只算一次。
   */
  const completedItems = new Set(chains.filter((c) => c.state === 'completed').flatMap((c) => c.itemIds))
  const historyItemCount = completedItems.size
  const reached = new Set(chains.flatMap((c) => c.itemIds))
  const unattached = typed
    .filter((u) => ['change', 'task', 'run', 'acc'].includes(String(u.kind)))
    .map(idOf)
    .filter((id) => id !== '' && !reached.has(id))
  return {
    ok: true,
    readAt,
    activeCount,
    completedCount,
    retiredCount: retiredReqs.length,
    historyItemCount,
    chains: [...chains.filter((c) => c.inFlight), ...chains.filter((c) => !c.inFlight)],
    retiredChains,
    unattached,
  }
}

