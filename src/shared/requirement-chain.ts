/**
 * **需求链投影**（纯函数，零 I/O）。
 *
 * 面板的主线不是“按阶段堆叠全部条目”，而是**一条需求从需求规格走到验收核对**。
 * 本模块只认账本的正式关系字段，把同一份 units 折成每条需求的链摘要：
 *
 *   需求 → change(req_ids / addresses / requirement_coverage)
 *        → task.parent / task.req_ids → run.parent / acc.parent
 *
 * ⛔ 不从标题里的编号反推关系；⛔ 不用 after 当承接；⛔ 不挂到最近条目。
 * ⛔ 不新增账本字段、不写盘、不取时间。
 */

import { effectiveAcceptanceOf, type AcceptanceVerdictLike } from './acceptance-verdict.ts'
/** R-14：`nextAction` 的 `convergence` 注入源 —— 唯一实现，⛔ 不另写判据。 */
import { convergenceOf } from './convergence.ts'
import { nextAction, type NextAction } from './next-action.ts'
import { panelSummaryOf, type PanelSummary } from './panel-summary.ts'
import { STAGE_NAMES, taskProblems, type StageControlUnit } from './stage-controls.ts'
import { type StageRow } from './stages-index.ts'
import { changeRequirementIds } from './ledger-relations.ts'
import { pipelineViewOf, type PipelineView } from './pipeline-view.ts'

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
  currentStep: 1 | 2 | 3 | 4 | 5 | 6 | 7 | null
  missing: Array<'change' | 'task' | 'run' | 'acc'>
  steps: ChainStep[]
  /** 该需求链自己的下一步；⚠ 与 `/stages` 的全局 next 不是同一个字段。 */
  next: NextAction
  /** 该需求链自己的结论；⚠ 不直接复用全局 summary。 */
  summary: PanelSummary
  itemIds: string[]
  /**
   * Pipeline v3 view: the only source for the user-facing active stage, gate and
   * next actor. The legacy `currentStep` / `next` fields remain on the wire for
   * old consumers, but they are now derived from this view.
   */
  pipeline: PipelineView
  /** Product acceptance completed; delivery closure may still be pending. */
  chainCompleted?: boolean
  /** Risk-gated delivery closure completed (or explicitly skipped). */
  deliveryClosed?: boolean
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
  clarify_legacy?: string
  task_brief?: string
  counterexamples?: string[]
  stop_conditions?: string[]
  return_to?: string
  progress_refs?: string[]
  report?: string
}

const LEGACY_STEP_DEFS = [
  { step: 1, name: '需求规格', kind: 'req' },
  { step: 2, name: '实现方案', kind: 'change' },
  { step: 3, name: '编码任务', kind: 'task' },
  { step: 4, name: '任务执行', kind: 'run' },
  { step: 5, name: '验收核对', kind: 'acc' },
] as const

/**
 * ⚠ **步名从 `STAGE_NAMES` 派生**（R-03，2026-11-10）：⛔ 不再写字面量。
 * 改前这里自带一份 7 项字面量，与 `stage-controls.ts` 是两份；两份当时恰好一致，
 * 但**没有断言强制**，任一处单边改动都会静默漂移。
 */
const STEP_DEFS = [
  { step: 1, name: STAGE_NAMES.requirements, kind: 'req' },
  { step: 2, name: STAGE_NAMES.plan, kind: 'change' },
  { step: 3, name: STAGE_NAMES.tasks, kind: 'task' },
  { step: 4, name: STAGE_NAMES.execution, kind: 'run' },
  { step: 5, name: STAGE_NAMES.verification, kind: 'verification' },
  { step: 6, name: STAGE_NAMES.acceptance, kind: 'acc' },
  { step: 7, name: STAGE_NAMES.closure, kind: 'closure' },
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
  verifications: ChainUnit[]
  accs: ChainUnit[]
  closures: ChainUnit[]
} {
  const rid = idOf(req)
  const changes = units
    .filter((u) => u.kind === 'change' && changeRequirementIds(u).includes(rid))
    .sort(byCreated)
  const changeIds = new Set(changes.map(idOf))
  /**
   * ⚠ **历史兼容**：`pre-control` 任务允许 `parent = req`（旧账本 3 条），
   *   但新任务必须 `parent = change`（与 L-2 闭环判据同一条语义）。
   *   ⛔ 不把这条兼容写成"新任务也可直挂需求" —— 那正是两套关系语法的来源。
   */
  const tasks = units
    .filter((u) => u.kind === 'task' && (changeIds.has(text(u.parent))
      || arr(u.req_ids).includes(rid)
      || (text(u.parent) === rid && text(u.clarify_legacy) === 'pre-control')))
    .sort(byCreated)
  const taskIds = new Set(tasks.map(idOf))
  const runs = units
    .filter((u) => u.kind === 'run' && taskIds.has(text(u.parent)))
    .sort(byCreated)
  const verifications = units
    .filter((u) => u.kind === 'verification' && taskIds.has(text(u.parent)))
    .sort(byCreated)
  const directAccIds = new Set(arr(req.acceptance_ids))
  const accs = units
    .filter((u) => u.kind === 'acc' && (taskIds.has(text(u.parent)) || directAccIds.has(idOf(u))))
    .sort(byCreated)
  const closures = units
    .filter((u) => u.kind === 'closure' && text(u.parent) === rid)
    .sort(byCreated)
  return { changes, tasks, runs, verifications, accs, closures }
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

/**
 * **第 3 步：任务书是否就绪**（唯一判据，与 `stage-controls.ts` 的 C-5 同一份实现）。
 *
 * ⚠ 它**不问执行**。改前第 3 步拿 `task.status = built` 当完成信号 ⇒
 *   任务书建好但没执行时第 3 步仍是 `todo`，执行期间当前步也停在「编码任务」。
 *   现在第 3 步只回答「活拆清楚了没有」。
 */
function taskBriefReady(t: ChainUnit): boolean {
  return taskProblems(t as StageControlUnit).length === 0
}

/**
 * **第 4 步：执行事实是否成立**（唯一判据）。
 *
 * ⚠ 必须**同时**满足：该任务有 `returned` 的运行记录，且任务已到 `built`。
 *   两者缺一都不是完成：
 *     · 零 RUN + built ⇒ G-1 的「跳过执行」，⛔ 不许判第 4 步完成；
 *     · 有 returned RUN + 任务仍 doing ⇒ G-7 的「没开工就收到回传」，⛔ 也不完成。
 */
function taskExecuted(t: ChainUnit, runs: readonly ChainUnit[]): boolean {
  if (statusOf(t) !== 'built') return false
  return runs.some((r) => statusOf(r) === 'returned')
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
    const ready = chain.tasks.filter(taskBriefReady).length
    const running = chain.tasks.filter((t) => statusOf(t) === 'doing').length
    if (chain.tasks.length === 1) {
      const t = chain.tasks[0]
      if (!taskBriefReady(t)) return `${idOf(t)} 任务书未齐`
      return statusOf(t) === 'doing' ? `${idOf(t)} 已派，执行中` : statusOf(t) === 'built' ? `${idOf(t)} 已回传` : `${idOf(t)} 任务书已齐，待派`
    }
    return `${countLabel(chain.tasks.length, '个任务')} · ${ready} 个任务书已齐${running > 0 ? ` · ${running} 个执行中` : ''}`
  }
  if (step === 4) {
    if (chain.tasks.length === 0) return '还没有任务'
    const executed = chain.tasks.filter((t) => taskExecuted(t, chain.runs)).length
    const running = chain.runs.filter((r) => statusOf(r) === 'running').length
    const registered = chain.runs.filter((r) => statusOf(r) === 'registered').length
    const returned = chain.runs.filter((r) => statusOf(r) === 'returned').length
    if (chain.runs.length === 0) {
      return chain.tasks.every((t) => statusOf(t) === 'built')
        ? '有任务标了 built，但没有任何执行记录 —— 执行事实判不出'
        : '还没有执行记录'
    }
    return `${executed}/${chain.tasks.length} 任务执行成立 · ${registered + running} 在跑 · ${returned} 已回传`
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
    if (chain.tasks.every(taskBriefReady)) return 'done'
    return 'doing'
  }
  if (step === 4) {
    if (chain.tasks.length === 0) return 'todo'
    /**
     * ⚠ **零 RUN 永远不是 `done`**（改前的反向判据已删）：
     *   `built` 但零 RUN 是 G-1 的「跳过执行」，不是执行完成。
     *   没有执行记录 ⇒ `waiting`（等执行事实），⛔ 不许显示成完成。
     */
    if (chain.runs.length === 0) return 'waiting'
    if (chain.runs.some((r) => ['stuck', 'refused'].includes(statusOf(r)))) return 'blocked'
    /**
     * ⚠ 投影刚建立的新 RUN 状态是 `registered`（派发已成功、执行尚未自报 running）。
     *   第 4 步若只把 `running` 认作进行中，会在“已派、正在跑”的整个最早阶段
     *   错误显示 `waiting`。两种都属执行已开始：`registered` / `running`。
     */
    if (chain.runs.some((r) => ['registered', 'running'].includes(statusOf(r)))) return 'doing'
    if (chain.tasks.every((t) => taskExecuted(t, chain.runs))) return 'done'
    return 'waiting'
  }
  if (chain.accs.length === 0) return 'todo'
  if (groups.some((g) => g.verdict.verdict === 'send-back')) return 'blocked'
  if (groups.some((g) => g.verdict.verdict === 'undecidable')) return 'waiting'
  return groups.every((g) => g.verdict.verdict === 'accepted') ? 'done' : 'waiting'
}

/** 把链步骤映射成 `StageRow` 供摘要复用；⚠ 只用于摘要，不改变全局线格式。 */
function stageRowsForChain(chain: RequirementChain): StageRow[] {
  return chain.steps.map((s) => ({ step: s.step, name: s.name })).map((d) => {
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
  const pipeline = pipelineViewOf(req as any, units as any)
  const legacy = pipeline.state === 'legacy'
  const stepDefs = legacy ? LEGACY_STEP_DEFS : STEP_DEFS
  const steps: ChainStep[] = stepDefs.map((d) => {
    /**
     * ══════════════════════════════════════════════════════════════════════════
     * **R-08：legacy 第 5 步的「状态源」与「条目源」必须是同一个集合**（2026-11-10）
     * ══════════════════════════════════════════════════════════════════════════
     *
     * ── 病（实测）──────────────────────────────────────────────────────────────
     *   `LEGACY_STEP_DEFS` 的第 5 步叫「**验收核对**」、`kind: 'acc'`（旧语义里它就是产品验收），
     *   但 `items` / `done` / `doing` 三处都取 `chain.verifications`。
     *   ⇒ 同屏出现「**已完成**（状态取自 accs）/ **0/0** / **这一步还没有条目**（条目为空）」，
     *     legacy 账本若只有 ACC 没有 VER（旧账本很常见）⇒ **条目区永远是空的**。
     *
     * ── 为什么这一档必须「同源」──────────────────────────────────────────────
     *   v3 里第 5 步 = 技术验证、第 6 步 = 产品验收，**是两件事**；
     *   legacy 只有 5 步，第 5 步「验收核对」**同时承担**两者 ⇒ 状态与条目被拆到两个集合上。
     *   ⇒ 统一取 `accs`（旧语义里「验收核对」就是产品验收；verification 是 v3 才独立出来的）。
     *
     * ⚠ **这是三处联动**：`items`（条目）+ `done`（已完成计数）+ `doing`（进行中计数）。
     *   只改 `items` 会造出**新矛盾**：「条目取自 ACC、计数取自 VER」⇒ legacy 账本 VER 通常为 0
     *   ⇒ 显示「2 条」但「0/0」。⚠ 三处用**同一个 `step5Set`**，⛔ 不各写一遍。
     * ⚠ 客户端 `STAGE_KIND_BY_STEP` 也需同批改（见 `project-panel.tsx`）。
     */
    const step5Set: readonly ChainUnit[] = legacy ? chain.accs : chain.verifications
    const items = d.step === 1 ? [req]
      : d.step === 2 ? chain.changes
        : d.step === 3 ? chain.tasks
          : d.step === 4 ? chain.runs
            : d.step === 5 ? step5Set
              : d.step === 6 ? chain.accs
                : chain.closures
    const v3Stage = legacy ? undefined : pipeline.stages.find((s) => s.id === d.kind)
    const displayState = v3Stage === undefined
      ? stateOfStep(d.step, req, chain, groups)
      : v3Stage.state === 'completed' ? 'done'
        : v3Stage.state === 'blocked' ? 'blocked'
          : v3Stage.state === 'awaiting-user' ? 'waiting'
            : v3Stage.state === 'active' ? 'doing' : 'todo'
    const done = d.step === 1
      ? (statusOf(req) === 'agreed' ? 1 : 0)
      : d.step === 2
        ? chain.changes.filter((c) => ['settled', 'superseded'].includes(statusOf(c))).length
        : d.step === 3
          ? chain.tasks.filter(taskBriefReady).length
        : d.step === 4
            ? chain.tasks.filter((t) => taskExecuted(t, chain.runs)).length
            : d.step === 5
              /**
               * ⚠ **R-08 三处联动之二**：取 `step5Set`（与 `items` 同一个集合），⛔ 不写死 `verifications`。
               * legacy 时它是 `accs` ⇒ 计数与条目一致；v3 时仍是 `verifications`（行为不变）。
               */
              ? (legacy
                ? step5Set.filter((a) => statusOf(a) === 'pass').length
                : chain.verifications.filter((v) => statusOf(v) === 'pass').length)
              : d.step === 6
                ? groups.filter((g) => g.verdict.verdict === 'accepted').length
                : chain.closures.filter((c) => ['closed', 'skipped'].includes(statusOf(c))).length
    const doing = d.step === 1
      ? (statusOf(req) === 'agreed' ? 0 : 1)
      : d.step === 2
        ? chain.changes.filter((c) => statusOf(c) === 'proposed').length
        : d.step === 3
          ? chain.tasks.filter((t) => !taskBriefReady(t)).length
        : d.step === 4
            ? chain.runs.filter((r) => ['registered', 'running'].includes(statusOf(r))).length
            : d.step === 5
              /**
               * ⚠ **R-08 三处联动之三**：同 `step5Set`。
               * ⚠ ACC 没有 `unverified` 状态（封闭集是 pass / send-back），
               *   所以 legacy 下「进行中」的判据是**待定**（`undecidable`），与第 6 步同源。
               */
              ? (legacy
                ? step5Set.filter((a) => statusOf(a) === 'undecidable').length
                : chain.verifications.filter((v) => statusOf(v) === 'unverified').length)
              : d.step === 6
                ? groups.filter((g) => g.verdict.verdict === 'undecidable').length
                : chain.closures.filter((c) => statusOf(c) === 'open').length
    const waiting = displayState === 'waiting' ? 1 : 0
    return {
      step: d.step,
      name: d.name,
      displayState,
      summary: v3Stage?.summary || stepSummaryOf(d.step, req, chain, groups),
      total: d.step === 1 ? 1 : items.length,
      done,
      doing,
      waiting,
      itemIds: v3Stage !== undefined && v3Stage.itemIds.length > 0 ? v3Stage.itemIds : items.map(idOf).filter((x) => x !== ''),
    }
  })

  const missing: RequirementChain['missing'] = []
  if (chain.changes.length === 0) missing.push('change')
  if (chain.tasks.length === 0) missing.push('task')
  if (chain.tasks.length > 0 && chain.runs.length === 0) missing.push('run')
  if (chain.accs.length === 0) missing.push('acc')

  const accepted = groups.length > 0 && groups.every((g) => g.verdict.verdict === 'accepted')
  /**
   * ⚠ 完成 = 第 1–5 步全部 `done`（与 `currentStep` 同一套口径）。
   *   改前只查 `accepted && tasks.every(built)`，漏掉第 3 步「任务书是否就绪」
   *   与第 4 步「执行事实是否成立」，于是会出现「完成链里还有未完成任务书」。
   */
  const complete = accepted && steps.every((s) => s.displayState === 'done')
  const chainCompleted = legacy ? complete : (pipeline.chainCompleted ?? complete)
  const deliveryClosed = legacy ? complete : (pipeline.deliveryClosed ?? complete)
  const retired = ['retired', 'dropped'].includes(statusOf(req))

  let currentStep: RequirementChain['currentStep'] = null
  const blockedGroup = groups.find((g) => g.verdict.verdict === 'send-back')
  if (blockedGroup !== undefined) {
    const back = text(blockedGroup.accs.find((a) => statusOf(a) === 'send-back')?.send_back_to)
    currentStep = back === 'back-to-requirement' ? 1 : back === 'back-to-plan' ? 2 : 3
  } else {
    const firstOpen = steps.find((s) => s.displayState !== 'done')
    currentStep = firstOpen === undefined ? null : firstOpen.step as 1 | 2 | 3 | 4 | 5 | 6 | 7
  }

  const chainIds = new Set(steps.flatMap((s) => s.itemIds))
  const chainUnits = units.filter((u) => chainIds.has(idOf(u)))
  let next: NextAction
  try {
    /**
     * ⚠⚠ **R-14：必须注入 `convergence`，⛔ 不许再传空对象。**
     *
     *   改前这里传的是 `{}` ⇒ `nextAction` 的第 ③ 步（`converge`）**整段不执行**
     *   ⇒ 「任务都 built 了、但方案还没收口」这个**最常见**的状态，全局算法**匹配不上**，
     *   落到 `undecidable / target=null`。
     *   ⚠ 这正是下面那段补丁存在的原因 —— 补丁治的是**症状**（"判不出"），
     *     而病因是**注入缺失**。实测（`/tmp/r14.mjs`，任务 built + 未判决 ACC）：
     *     ```
     *     不注入 convergence: {"kind":"undecidable","target":null}
     *     注入   convergence: {"kind":"converge","target":"CHG-1"}
     *     ```
     *   ⇒ 注入后「判不出」消失，补丁从**必须**降级为**优化**（把 `converge` 细化成
     *     `accept ACC-xxx`，让用户直接看到"该验收哪一条"而不是"方案没收口"）。
     *
     *   ⚠ **注入的是 `convergenceOf` 的唯一实现**（`convergence.ts`），⛔ 不在这里另写判据 ——
     *     否则就是「同一事实两份实现」，正是 `R-14` 这条本身要治的病。
     *   ⚠ `units` 传**全账本**（`convergenceOf` 要按 id 查全账，⛔ 不是只查链内）——
     *     传链内会让「父方案指向链外任务」这类情况判不出。
     */
    next = nextAction(chainUnits as any, {
      convergence: (chg) => {
        const r = convergenceOf(chg as never, units as never)
        return { converged: r.converged, blockedBy: r.blockedBy }
      },
    })
  } catch (e) {
    next = {
      kind: 'undecidable',
      target: null,
      why: `下一步算不出来：${String((e as Error)?.message ?? e)}`,
      blockedBy: [],
    }
  }
  /**
   * ⚠⚠ **链内“等验收”必须点名那条待判决的 ACC，⛔ 不许退化成“判不出”**。
   *
   * 病灶（2026-11-07 收口实测）：`TSK-080` 标 `built` 之后，全局 `nextAction()`
   *   看不到父 change 的未收口状态（`convergence` 没注入），于是六步都匹配不上 ⇒
   *   `undecidable / target=null`。面板「下一步」于是写成“判不出”，
   *   而账本事实上很明确：**第 5 步在等 `ACC-066`**。
   *   ⚠ 那是把“判得出”显示成“判不出”，比没有结论更坏。
   *
   * 口径：只在该链**确实还有未判决验收**、且全局 `nextAction()` 给不出更好的目标时补一条
   *   `accept`，目标取第一条 `unverified` 的 ACC；⛔ 不改账本、⛔ 不猜判决、⛔ 不伪造通过。
   *
   * ⚠⚠ **R-14 补记：`converge` 也必须进这个条件。**
   *   注入 `convergence` 之后（见上面的注释），这条链最可能得到的是
   *   `converge / target=CHG-…`（"方案还没收口"）—— 那**比 `undecidable` 好，但仍不是用户要的**：
   *   用户要的是"**该验收哪一条 ACC**"。
   *   ⚠ 实测（`check:requirement-chains` 的 `RC-11`）：
   *     ```
   *     ✗ RC-11 · next.kind="converge"（期望 accept）
   *     ✗ RC-11 · next.target="CHG-1"（期望 ACC-1）
   *     ```
   *   ⇒ 把 `converge` 加进条件 ⇒ 补丁从「治 `undecidable`」升级为「治 `converge`」，
   *     而 **`undecidable` 那条不再需要它兜底**（注入后不会再出现）。
   *   ⛔ 不要因为"注入后不该有 undecidable"就把 `undecidable` 从条件里删掉 ——
   *     注入函数本身可能抛错，那时仍需要这层兜底。
   */
  if ((next.kind === 'undecidable' || next.target === null
      || next.kind === 'accept' || next.kind === 'converge') && currentStep === 5) {
    const pending = chain.accs.filter((a) => statusOf(a) === 'unverified').map(idOf).filter((x) => x !== '')
    if (pending.length > 0) {
      next = {
        kind: 'accept',
        target: pending[0]!,
        why: `「${pending[0]!}」等着独立验收 —— 没判决前这条需求不算走完`,
        blockedBy: [],
      }
    }
  }
  /**
   * **当前步优先于全局下一步**（2026-11-08 收口）。
   *
   * 全局 `nextAction()` 看的是全账本：当一条链第 4 步零 RUN、但后面已有一个
   * `built` 任务时，它可能先给出 `accept`/TSK —— 那会让“下一步”跨过尚未完成的
   * 执行阶段，直接跳到后面的验收对象。`currentStep` 是本链唯一当前态，必须先判。
   *
   * ⚠ 真账本 `dsh-hob` R-002..004 与 `prompt-enhancer-release` R-001 都命过这条：
   *   前者曾显示 `undecidable`，后者曾显示 `accept:TSK-…`，两者都不是“下一步”。
   */
  if (currentStep === 4 && chain.runs.length === 0) {
    const runnable = chain.tasks.find((t) => ['todo', 'doing'].includes(statusOf(t)))
    if (runnable !== undefined && statusOf(runnable) === 'todo') {
      next = {
        kind: 'dispatch',
        target: idOf(runnable),
        why: `「${idOf(runnable)}」任务书已齐、还没派活 —— 没有执行记录，第 4 步不能算完成`,
        blockedBy: [],
      }
    } else {
      next = {
        kind: 'blocked',
        target: chain.tasks[0] === undefined ? null : idOf(chain.tasks[0]),
        why: runnable !== undefined
          ? `「${idOf(runnable)}」已标执行中，但账本里没有任何执行记录 —— 先补可核运行读数`
          : '任务已标完成，但账本里没有任何执行记录 —— 执行事实判不出；先补可核的运行读数，再谈验收',
        blockedBy: chain.tasks.map((t) => `${idOf(t)} 零 RUN`),
      }
    }
  }

  const partial: RequirementChain = {
    reqId: rid,
    title: text(req.title),
    reqStatus: statusOf(req),
    state: retired ? 'retired' : chainCompleted ? 'completed' : 'active',
    inFlight: !retired && !chainCompleted,
    complete: chainCompleted,
    currentStep,
    missing,
    steps,
    next,
    summary: panelSummaryOf({ stages: [], next }),
    itemIds: steps.flatMap((s) => s.itemIds),
    pipeline,
    chainCompleted,
    deliveryClosed,
  }

  /**
   * Pipeline v3 is the single stage authority.
   *
   * A legacy item is explicitly non-actionable. A v3 item follows G1 -> G2 ->
   * tasks -> execution -> acceptance; no downstream step may skip either user
   * gate. The old heuristics below stay only as a compatibility projector for
   * entities that are not yet enrolled, never as a way around v3.
   */
  const pipelineGoverns = !legacy
  if (pipelineGoverns) partial.currentStep = partial.pipeline.activeStage
  if (pipelineGoverns && partial.pipeline.gate === 'G1-requirement') {
    partial.next = {
      kind: 'wait-user',
      target: partial.pipeline.reqId,
      why: partial.pipeline.nextAction,
      blockedBy: partial.pipeline.blockedBy,
    }
    partial.state = 'active'
    partial.inFlight = true
    partial.complete = false
  } else if (pipelineGoverns && partial.pipeline.gate === 'G2-plan') {
    partial.next = {
      kind: 'wait-user',
      target: partial.pipeline.stages[1]?.itemIds[0] ?? null,
      why: partial.pipeline.nextAction,
      blockedBy: partial.pipeline.blockedBy,
    }
    partial.state = 'active'
    partial.inFlight = true
    partial.complete = false
  } else if (partial.pipeline.state === 'legacy') {
    /**
     * Legacy entries stay readable through the old projection, but the v3
     * pipeline view still marks them non-actionable. Dispatch and task writes
     * are rejected separately; this branch never manufactures an approval.
     */
    partial.pipeline.blockedBy = partial.pipeline.blockedBy.length > 0
      ? partial.pipeline.blockedBy
      : [`${partial.pipeline.reqId} · 旧管线条目不能进入 v3 派发`]
  } else if (pipelineGoverns && partial.next.blockedBy.length === 0
    && partial.pipeline.blockedBy.length > 0) {
    /**
     * ══════════════════════════════════════════════════════════════════════
     * **T-08：G3–G6 的阻断原因也要进 `next`**（2026-11-10）
     * ══════════════════════════════════════════════════════════════════════
     *
     * ── 病（实测）──────────────────────────────────────────────────────────
     *   上面两个分支只覆盖 `gate === 'G1-requirement'` 与 `'G2-plan'`。
     *   走到 G3–G6 时（`gate` 是 `'G3-tasks'` / `'G4-verification'` /
     *   `'G5-acceptance'` / `'G6-closure'`，或 `null`），`next` 保留的是
     *   `nextAction(...)` 的全局结论 —— 而 `pipeline.blockedBy` **一条都没进来**。
     *   ⇒ 面板对 G3–G6 印「**卡在哪：没有主阻断**」，而同一时刻派活可能被
     *     `pipelineDispatchProblems` 拒（R-05 接上 G3 之后尤其明显）。
     *   **面板说「没卡」+ 闸门说「不能派」= 两个信号相反，且都不指向原因。**
     *
     * ── 修法：只补 `blockedBy`，⛔ 不改 `kind` / `target` / `why` ─────────────
     *   ⚠ 那两个字段由 `nextAction` 的全局六态优先级决定，改它等于另造一套
     *     「下一步」判据（正是 R-02 / R-14 的形态）。
     *   ⇒ 只在 `next.blockedBy` 为空、而 pipeline 有阻断时**补进去**；
     *     `kind` / `why` 一个字不动。
     *   ⚠ 为什么条件是「`next.blockedBy` 为空」：若全局 nextAction 已经给了阻断，
     *     它比链内视图更了解「该先做哪一件」⇒ **不覆盖它**（保持既有优先级）。
     */
    partial.next = { ...partial.next, blockedBy: partial.pipeline.blockedBy }
  }
  if (pipelineGoverns) partial.steps = partial.steps.map((s) => {
    const v = partial.pipeline.stages[s.step - 1]
    if (v === undefined) return s
    return {
      ...s,
      displayState: v.state === 'completed' ? 'done'
        : v.state === 'blocked' ? 'blocked'
          : v.state === 'awaiting-user' ? 'waiting'
            : v.state === 'active' ? 'doing' : 'todo',
      summary: v.summary || s.summary,
      itemIds: v.itemIds.length > 0 ? v.itemIds : s.itemIds,
      total: v.step === 1 ? 1 : v.itemIds.length,
    }
  })
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
   * 逐链相加会把同一条重复计数。⚠ 与「202 条阶段条目」同口径：每个单元只算一次。
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

