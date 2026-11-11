/**
 * **运行态 → 账本投影**（纯函数，零 I/O）—— 2026-11-08 · 用户裁定「按方案落地」。
 *
 * ══ 它治什么（这是当前管线最关键的断点）════════════════════════════════════
 *   运行态（`runtime/orch-watches.json`）知道「这次派发送没送到、跑没跑完」；
 *   账本（`ledger/units/`）知道「这条需求走到哪一步」。两者此前是**两套并行状态机**：
 *     · `hob_dispatch` 只登记运行态 watch，不创建 `RUN`；
 *     · 回传成功只把运行态记成 `returned`，不更新 `TSK built` / `RUN returned`；
 *     · 验收判决又要求账本里**已经存在** `pass` 的 `ACC`，才允许盖 `acceptedAt`。
 *   ⇒ 派发成功 ≠ 账本有 RUN；回传成功 ≠ 账本有 returned RUN；
 *     验收成功 ≠ 账本有 pass ACC。阶段反馈弱的根因在这里，不在回复模板。
 *
 * ══ 它只做什么 ═══════════════════════════════════════════════════════════════
 *   输入：一条**已经发生**的运行态事实（派发成功 / 回传成功 / 判决）。
 *   输出：**确定性的账本操作清单**（create-unit / transition-unit / link-unit）。
 *   ⛔ 不投递、⛔ 不改运行态、⛔ 不取时间、⛔ 不读环境 —— 同一输入逐字节同输出。
 *
 * ══ 三条硬约束 ═══════════════════════════════════════════════════════════════
 *   ① **只投影真实 task**：`taskId` 必须是账本里真实存在的 `task`；
 *      `implicit` 占位号（旧单目标派发）**不落账** —— 它不是任务。
 *   ② **幂等**：同一事件重复到达不得重复建 RUN/ACC。判据是稳定事件键：
 *      派发 → `dispatch:<task>:<target>:<at>`；回传 → 同一条 watch 的 `at`；
 *      判决 → `verdict:<task>:<verifiedAt>`。
 *   ③ **判不出就不写**：找不到 task / task 不在可迁移状态 / 缺必要读数 ⇒ 返回
 *      `skipped` + 可读原因，⛔ 不猜一条来标。
 *
 * ⚠ 本模块**零 import**（与 `convergence.ts` / `portfolio.ts` 同一条纪律）：
 *   它要被判据脚本、server 投影器、将来可能的 client 侧同时调用。
 */

/** 账本单元的**最小形状**（⚠ 只要这几个字段，⛔ 不要整个 `any`）。 */
export interface ProjectionUnitLike {
  id: string
  kind: string
  status?: string
  /** Pipeline v3 enrollment for runtime-created projection units. */
  pipeline_version?: string
  /** Positive integer revision string for the unit. */
  revision?: string
  title?: string
  parent?: string
  built_by?: string
  run_ids?: string[]
  verify_refs?: string[]
  delivered_at?: string
  started_at?: string
  report?: string
  progress_refs?: string[]
  /** Risk inputs used by the parent plan and task (read-only lookups). */
  risk_tier?: string
  risk_hard_triggers?: string[]
  /** 投影幂等键（只由本模块写入；⚠ 不替代任何账本状态）。 */
  projection_key?: string
}

/** 一条运行态事实：派发成功。 */
export interface DispatchFact {
  kind: 'dispatch'
  /** 真实 task id；`implicit` 或空 ⇒ 不落账。 */
  taskId: string
  /** 执行会话 id（落到 `RUN.built_by`）。 */
  target: string
  /** 派活方会话 id（落到 `RUN.owner`；可选）。 */
  owner?: string
  /** 派发登记时刻（毫秒）；用作稳定事件键。 */
  at: number
  /** 这一轮派了什么（落到 `RUN.title` / `RUN.why`）。 */
  task?: string
  /** 预算说明（落到 `RUN.budget`；可选）。 */
  budget?: string
  /**
   * 本次实际使用的模型面指纹（⚠ 由 I/O 层从生成契约现读后注入）。
   * 落到 `RUN.prompt_version` / `RUN.prompt_hash`；缺 ⇒ 不写（由 F-9 如实报缺）。
   */
  modelFace?: { version: string; hash: string }
}

/** A dispatch whose delivery was refused/failed after RUN intent was created. */
export interface RefuseFact {
  kind: 'refuse'
  taskId: string
  target: string
  at: number
  refusedAt: string
  reason: string
}

/** 一条运行态事实：回传成功。 */
export interface ReturnFact {
  kind: 'return'
  /** 真实 task id。 */
  taskId: string
  /** 执行会话 id。 */
  target: string
  /** 派发登记时刻（毫秒）；与 DispatchFact.at 同一个键。 */
  at: number
  /** 回传时刻（ISO8601）；落到 `RUN.delivered_at`。 */
  deliveredAt: string
  /** 回传件路径（账本区相对路径）；落到 `RUN.report`。 */
  report?: string
  /** 小步验证读数；落到 `RUN.progress_refs`。 */
  progressRefs?: string[]
  /** 回传结论摘要（落到 `RUN.title` 的补充，⚠ 不替代标题）。 */
  conclusion?: string
}

/** 一条运行态事实：验收判决。 */
export interface VerdictFact {
  kind: 'verdict'
  /** 真实 task id。 */
  taskId: string
  /** `pass` / `send-back`。 */
  verdict: 'pass' | 'send-back'
  /** 判决时刻（ISO8601）；稳定事件键 + `ACC.verified_at`。 */
  verifiedAt: string
  /** 判决依据（⚠ 非空；空 ⇒ 不落账）。 */
  basis: string[]
  /** 验收者会话 id。 */
  actor: string
  /**
   * 独立验收会话 id。
   * ⚠ `accept` 时账本里已经有一条通过门禁的 ACC ⇒ 调用方**不传**，由投影器取那条的
   *   `acceptance_session`（⛔ 不让"调用判决的派活方"冒充独立验收会话）。
   * ⚠ `send-back` 没有前置 ACC ⇒ 必须由调用方给（否则判不出独立性，不落账）。
   */
  acceptanceSession?: string
  /** 产品确认（`pass` 时必填）。 */
  productConfirmation?: string
  /** 技术验证证据（`pass` 时必填）。 */
  verificationRefs?: string[]
  /** 用户例子逐条结果（`pass` 时必填）。 */
  exampleResults?: string[]
  /** 退回目标阶段（`send-back` 时必填）。 */
  sendBackTo?: 'back-to-requirement' | 'back-to-plan' | 'back-to-task'
  /**
   * `accept` 专用：账本里已过门禁的 ACC 的独立验收会话（由调用方从账本现读）。
   * ⚠ 不从调用方 `self` 取：`self` 是派活方，⛔ 不能冒充独立验收会话。
   */
  existingAcceptanceSession?: string
}

export interface VerifyFact {
  kind: 'verify'
  taskId: string
  verdict: 'pass' | 'send-back' | 'waived'
  verifiedAt: string
  basis: string[]
  verifier: string
  verificationSession?: string
  criteriaRefs?: string[]
  evidenceRefs?: string[]
  nonconformanceRefs?: string[]
  sendBackTo?: 'back-to-requirement' | 'back-to-plan' | 'back-to-task'
  waiverSource?: string
  waivedBy?: string
  /** Per-control evidence: at least one entry for every declared hard trigger. */
  riskReviewRefs?: string[]
  /** Risks discovered during verification that the approved plan did not declare. */
  newRiskRefs?: string[]
  newRiskReason?: string
}

export interface CloseFact {
  kind: 'close'
  reqId: string
  status: 'closed' | 'skipped' | 'blocked'
  closureMode: 'skipped' | 'standard' | 'strict'
  basis: string[]
  releaseRefs?: string[]
  rollbackRefs?: string[]
  monitoringRefs?: string[]
  liens?: string[]
  acceptedBy?: string
  approvalRef?: string
  closedAt: string
  skipReason?: string
  /** G5 acceptance this closure is based on (ACC id or chain reference). */
  chainAcceptanceRef?: string
  /** Risk assessment revision / digest this closure used. */
  riskAssessmentRef?: string
  /** Decision unit that accepted residual risk, or an explicit no-risk ref. */
  residualRiskDecisionRef?: string
}

export type ProjectionFact = DispatchFact | RefuseFact | ReturnFact | VerdictFact | VerifyFact | CloseFact

/** 一条账本操作（⚠ 封闭集：只允许这三种，⛔ 不许新增"万能写"）。 */
export type ProjectionOp =
  | {
    op: 'create-unit'
    /** 新单元 id（由调用方给的稳定序列，本模块不自己编全局号）。 */
    id: string
    kind: 'run' | 'acc' | 'verification' | 'closure'
    /** 字段（⚠ 只放稳定事实，⛔ 不放推断）。 */
    fields: Record<string, string | string[]>
  }
  | {
    op: 'transition-unit'
    id: string
    from: string
    to: string
    /** 迁移时同时写入的字段（如 `TSK built` 的 `verify_refs`）。 */
    fields?: Record<string, string | string[]>
  }
  | {
    op: 'link-unit'
    id: string
    field: 'run_ids' | 'acceptance_ids' | 'verify_refs'
    add: string[]
  }

/** 投影结果（⚠ 三档：applied / skipped / undecidable，⛔ 不许压成布尔）。 */
export interface ProjectionResult {
  /** 这次事实的稳定键（用于幂等去重）。 */
  key: string
  /** RUN created by this dispatch projection, when one was allocated. */
  createdRunId?: string
  /** 实际要执行的账本操作（顺序有意义：先建 RUN，再迁 TSK）。 */
  ops: ProjectionOp[]
  /** 跳过的原因（⚠ 有值 = 没有落账，必须能读出来）。 */
  skipped?: string
  /** 判不出的原因（⚠ 与 skipped 不同：skipped 是"确定不该写"，undecidable 是"看不清"）。 */
  undecidable?: string
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).map((x) => x.trim()).filter((x) => x !== '') : []

/** 该 kind 的现有最大数字序号；没有 ⇒ 0。 */
function maxSeqOf(units: readonly ProjectionUnitLike[], prefix: 'RUN' | 'ACC' | 'VER' | 'CLS'): number {
  const re = new RegExp(`^${prefix}-(\\d+)$`)
  let max = 0
  for (const u of units) {
    const m = re.exec(text(u.id))
    if (m !== null) max = Math.max(max, Number(m[1]))
  }
  return max
}

/** 分配下一个账本编号（⚠ 只在纯函数内部用；同一输入同输出）。 */
function nextIdOf(units: readonly ProjectionUnitLike[], prefix: 'RUN' | 'ACC' | 'VER' | 'CLS'): string {
  return `${prefix}-${String(maxSeqOf(units, prefix) + 1).padStart(3, '0')}`
}

/** 已有同键投影 ⇒ 返回那条单元（幂等判据）。 */
function projectedUnitOf(units: readonly ProjectionUnitLike[], key: string): ProjectionUnitLike | undefined {
  return units.find((u) => text(u.projection_key) === key)
}

/** 从 units 里找一条真实 task；`implicit` / 空 / 非 task ⇒ undefined。 */
function realTaskOf(units: readonly ProjectionUnitLike[], taskId: string): ProjectionUnitLike | undefined {
  const id = text(taskId)
  if (id === '' || id === 'implicit') return undefined
  return units.find((u) => text(u.id) === id && u.kind === 'task')
}

/** The parent change of a real task, if present. */
function planOfTask(units: readonly ProjectionUnitLike[], task: ProjectionUnitLike): ProjectionUnitLike | undefined {
  const parent = text(task.parent)
  return parent === '' ? undefined : units.find((u) => text(u.id) === parent && u.kind === 'change')
}

/** 稳定事件键（幂等去重的唯一依据）。 */
export function projectionKeyOf(fact: ProjectionFact): string {
  if (fact.kind === 'dispatch') return `dispatch:${text(fact.taskId)}:${text(fact.target)}:${fact.at}`
  if (fact.kind === 'refuse') return `refuse:${text(fact.taskId)}:${text(fact.target)}:${fact.at}`
  if (fact.kind === 'return') return `return:${text(fact.taskId)}:${text(fact.target)}:${fact.at}`
  if (fact.kind === 'verdict') return `verdict:${text(fact.taskId)}:${text(fact.verdict)}:${text(fact.verifiedAt)}`
  if (fact.kind === 'verify') return `verify:${text(fact.taskId)}:${text(fact.verdict)}:${text(fact.verifiedAt)}`
  return `close:${text(fact.reqId)}:${text(fact.status)}:${text(fact.closedAt)}`
}

/**
 * **派发成功 ⇒ 建 RUN registered + TSK todo→doing + 关联 run_ids**。
 *
 * ⚠ 为什么派发时就要建 RUN：运行态只知道"投给了哪个会话"，账本要知道
 *   "这条任务的第几次执行开始了"。没有这一步，回传时就没有可迁移的 RUN，
 *   面板第 4 步永远是"无独立执行记录"。
 */
function dispatchOps(units: readonly ProjectionUnitLike[], fact: DispatchFact): ProjectionResult {
  const key = projectionKeyOf(fact)
  const already = projectedUnitOf(units, key)
  if (already !== undefined) return { key, ops: [], skipped: `同一派发已投影为 ${already.id} ⇒ 不重复建` }
  const task = realTaskOf(units, fact.taskId)
  if (task === undefined) {
    return {
      key, ops: [],
      skipped: text(fact.taskId) === 'implicit'
        ? '派发对象是 implicit 占位号（旧单目标派发）⇒ 不落账'
        : `派发对象 ${JSON.stringify(text(fact.taskId))} 不是账本里真实存在的 task ⇒ 不落账`,
    }
  }
  const status = text(task.status)
  if (!/^\d+$/.test(text(task.revision)) || Number(task.revision) <= 0) {
    return { key, ops: [], undecidable: `task ${task.id} 缺正整数 revision ⇒ 无法把 RUN 绑定到具体任务修订，不落账` }
  }
  if (!['todo', 'doing'].includes(status)) {
    return { key, ops: [], skipped: `task ${task.id} 当前是 ${status || '空'}，不在 todo/doing ⇒ 不再建 RUN` }
  }
  /**
   * ⚠ 幂等：同一 task 已有 `run_ids` 指向一条未回传的 RUN ⇒ 不重复建。
   *   判据只看**真实存在的 run 单元**；`run_ids` 指向空气 ⇒ 当作没有（由闭环判据 L-3 报）。
   */
  const existingRuns = arr(task.run_ids)
    .map((id) => units.find((u) => text(u.id) === id && u.kind === 'run'))
    .filter((u): u is ProjectionUnitLike => u !== undefined)
  if (existingRuns.some((r) => ['registered', 'running'].includes(text(r.status)))) {
    return { key, ops: [], skipped: `task ${task.id} 已有未回传的 RUN ⇒ 不重复建` }
  }
  const runId = nextIdOf(units, 'RUN')
  const ops: ProjectionOp[] = [
    {
      op: 'create-unit', id: runId, kind: 'run',
      fields: {
        title: text(fact.task) === '' ? `${task.title ?? task.id} 的执行轮` : text(fact.task),
        parent: task.id,
        status: 'registered',
        pipeline_version: 'v3',
        revision: '1',
        task_revision: text(task.revision) || '1',
        built_by: text(fact.target),
        started_at: new Date(fact.at).toISOString(),
        source: '运行态投影：hob_dispatch 登记成功',
        ...(text(fact.owner) === '' ? {} : { owner: text(fact.owner) }),
        ...(text(fact.budget) === '' ? {} : { budget: text(fact.budget) }),
        ...(fact.modelFace === undefined
          ? {}
          : { prompt_version: fact.modelFace.version, prompt_hash: fact.modelFace.hash }),
        projection_key: key,
      },
    },
  ]
  if (status === 'todo') {
    ops.push({ op: 'transition-unit', id: task.id, from: 'todo', to: 'doing' })
  }
  ops.push({ op: 'link-unit', id: task.id, field: 'run_ids', add: [runId] })
  return { key, createdRunId: runId, ops }
}

/**
 * **投递失败 ⇒ RUN registered→refused + TSK doing→todo**（失败不留下假执行）。
 */
function refuseOps(units: readonly ProjectionUnitLike[], fact: RefuseFact): ProjectionResult {
  const key = projectionKeyOf(fact)
  const already = projectedUnitOf(units, key)
  if (already !== undefined) return { key, ops: [], skipped: `同一拒收已投影为 ${already.id} ⇒ 不重复写` }
  const task = realTaskOf(units, fact.taskId)
  if (task === undefined) return { key, ops: [], skipped: `拒收对象 ${JSON.stringify(text(fact.taskId))} 不是账本里真实存在的 task ⇒ 不落账` }
  const declared = arr(task.run_ids).map((id) => units.find((u) => text(u.id) === id && u.kind === 'run')).filter((u): u is ProjectionUnitLike => u !== undefined)
  const adopted = units.filter((u) => u.kind === 'run' && text(u.parent) === task.id)
  const runs = [...new Map([...declared, ...adopted].map((u) => [text(u.id), u])).values()]
  const byKey = runs.find((r) => text(r.projection_key) === `dispatch:${task.id}:${text(fact.target)}:${fact.at}`)
  const openRun = byKey ?? runs.filter((r) => ['registered', 'running'].includes(text(r.status))).sort((a, b) => text(a.id).localeCompare(text(b.id)))[0]
  if (openRun === undefined) return { key, ops: [], undecidable: `task ${task.id} 下找不到对应的 RUN ⇒ 判不出这次失败属于哪次执行` }
  const ops: ProjectionOp[] = [{
    op: 'transition-unit', id: openRun.id, from: text(openRun.status), to: 'refused',
    fields: { refused_at: fact.refusedAt, refused_why: fact.reason, projection_key: key },
  }]
  if (text(task.status) === 'doing') ops.push({ op: 'transition-unit', id: task.id, from: 'doing', to: 'todo' })
  return { key, ops }
}

/**
 * **回传成功 ⇒ RUN registered/running→returned + TSK doing→built + 关联证据**。
 *
 * ⚠ 回传不是验收：这里只把"执行事实"落到账本，⛔ 不建 ACC、⛔ 不写 pass。
 */
function returnOps(units: readonly ProjectionUnitLike[], fact: ReturnFact): ProjectionResult {
  const key = projectionKeyOf(fact)
  const already = projectedUnitOf(units, key)
  if (already !== undefined) return { key, ops: [], skipped: `同一回传已投影为 ${already.id} ⇒ 不重复写` }
  const task = realTaskOf(units, fact.taskId)
  if (task === undefined) {
    return {
      key, ops: [],
      skipped: text(fact.taskId) === 'implicit'
        ? '回传对象是 implicit 占位号（旧单目标派发）⇒ 不落账'
        : `回传对象 ${JSON.stringify(text(fact.taskId))} 不是账本里真实存在的 task ⇒ 不落账`,
    }
  }
  if (text(fact.deliveredAt) === '' || !Number.isFinite(Date.parse(fact.deliveredAt))) {
    return { key, ops: [], undecidable: '回传缺可解析的 deliveredAt ⇒ 判不出执行事实，不落账' }
  }
  if (!/^\d+$/.test(text(task.revision)) || Number(task.revision) <= 0) {
    return { key, ops: [], undecidable: `task ${task.id} 缺正整数 revision ⇒ 无法判断这次回传属于哪个任务修订` }
  }
  /**
   * ⚠ 先按 `run_ids` 找；找不到再按 `parent = task` 反查（兼容手工建的 RUN 还没回填 `run_ids`）。
   *   两者都只认**本 task 的子项**，⛔ 不跨任务猜。
   */
  const declared = arr(task.run_ids)
    .map((id) => units.find((u) => text(u.id) === id && u.kind === 'run'))
    .filter((u): u is ProjectionUnitLike => u !== undefined)
  const adopted = units.filter((u) => u.kind === 'run' && text(u.parent) === task.id)
  const runs = [...new Map([...declared, ...adopted].map((u) => [text(u.id), u])).values()]
  /**
   * 找这次派发对应的 RUN：优先带同一 `projection_key` 的 RUN；
   * 找不到时取该 task 下**最近一条未回传**的 RUN（兼容旧数据手工建的 RUN）。
   * ⚠ 两者都没有 ⇒ 判不出，⛔ 不凭空建一条 returned RUN（那会伪造执行记录）。
   */
  const byKey = runs.find((r) => text(r.projection_key) === `dispatch:${task.id}:${text(fact.target)}:${fact.at}`)
  const openRun = byKey ?? runs.filter((r) => ['registered', 'running'].includes(text(r.status))).sort((a, b) => text(a.id).localeCompare(text(b.id)))[0]
  if (openRun === undefined) {
    return { key, ops: [], undecidable: `task ${task.id} 下找不到对应的未回传 RUN ⇒ 判不出这次回传属于哪次执行` }
  }
  const ops: ProjectionOp[] = []
  const from = text(openRun.status)
  if (['registered', 'running'].includes(from)) {
    ops.push({
      op: 'transition-unit', id: openRun.id, from, to: 'returned',
      fields: {
        delivered_at: fact.deliveredAt,
        ...(text(fact.report) === '' ? {} : { report: text(fact.report) }),
        ...(arr(fact.progressRefs).length === 0 ? {} : { progress_refs: arr(fact.progressRefs) }),
        projection_key: key,
      },
    })
  }
  /**
   * ⚠ **回传 ≠ 做完**：没有小步验证读数时，只能证明执行会话答复了，
   *   不能证明任务已到交付态。此时只迁 RUN，TSK 保持 doing；
   *   C-6 会把这条 returned RUN 作为缺口点名，要求补 `progress_refs`。
   *
   *   ⚠ 改前这里无条件迁移，和 `check-ledger-projection` 的 LP-3 直接冲突：
   *     自检说「无读数只迁 RUN」，实现却迁了 TSK ⇒ 真集成路径重新产生
   *     「回传即完成」。本条件把纯函数、判据与正式阶段口径重新对齐。
   */
  if (text(task.status) === 'doing' && arr(fact.progressRefs).length > 0) {
    ops.push({
      op: 'transition-unit', id: task.id, from: 'doing', to: 'built',
      fields: {
        built_by: text(fact.target),
        ...(arr(fact.progressRefs).length === 0 ? {} : { verify: arr(fact.progressRefs).join(' · ') }),
      },
    })
  }
  return { key, ops }
}

/**
 * **验收判决 ⇒ 建 ACC pass/send-back**（⚠ 不迁 TSK：判决不改变任务状态）。
 *
 * ⚠ 这是 `hob_orch_control accept/send-back` 的账本落点。改前它只改运行态
 *   `acceptedAt` / `sentBackAt`，账本里的 ACC 要模型手工写 ⇒ 面板永远看不到判决。
 */
function verdictOps(units: readonly ProjectionUnitLike[], fact: VerdictFact): ProjectionResult {
  const key = projectionKeyOf(fact)
  const already = projectedUnitOf(units, key)
  if (already !== undefined) return { key, ops: [], skipped: `同一判决已投影为 ${already.id} ⇒ 不重复建` }
  const task = realTaskOf(units, fact.taskId)
  if (task === undefined) {
    return {
      key, ops: [],
      skipped: text(fact.taskId) === 'implicit'
        ? '判决对象是 implicit 占位号（旧单目标派发）⇒ 不落账'
        : `判决对象 ${JSON.stringify(text(fact.taskId))} 不是账本里真实存在的 task ⇒ 不落账`,
    }
  }
  if (text(fact.verifiedAt) === '' || !Number.isFinite(Date.parse(fact.verifiedAt))) {
    return { key, ops: [], undecidable: '判决缺可解析的 verifiedAt ⇒ 判不出，不落账' }
  }
  if (!/^\d+$/.test(text(task.revision)) || Number(task.revision) <= 0) {
    return { key, ops: [], undecidable: `task ${task.id} 缺正整数 revision ⇒ 无法建立与任务修订绑定的验收` }
  }
  if (arr(fact.basis).length === 0) {
    return { key, ops: [], undecidable: '判决缺依据（basis 为空）⇒ 不落账（无依据的判决不可复核）' }
  }
  if (text(fact.actor) === '') {
    return { key, ops: [], undecidable: '判决缺验收者 ⇒ 判不出独立性，不落账' }
  }
  /**
   * ⚠ `pass` 时账本里**已经有**通过门禁的 ACC ⇒ 取它的独立验收会话。
   *   这是唯一允许"不传 acceptanceSession"的情形；⛔ 不拿调用方 `self` 顶替。
   * `send-back` 没有前置 ACC ⇒ 必须显式给，否则判不出独立性。
   */
  const preexistingAcc = fact.verdict === 'pass'
    ? units.find((u) => u.kind === 'acc' && text(u.parent) === task.id && text(u.status) === 'pass'
      && arr((u as unknown as { basis?: unknown }).basis as unknown).length > 0)
    : undefined
  const acceptanceSession = text(fact.acceptanceSession)
    || text(fact.existingAcceptanceSession)
    || text((preexistingAcc as unknown as { acceptance_session?: unknown } | undefined)?.acceptance_session)
  /**
   * ⚠⚠ **`send-back` 的验收会话不能靠 `actor` 猜**（2026-11-08 真机入口核对）。
   *
   * 运行态 `hob_orch_control send-back` 没有单独的 `acceptanceSession` 参数。
   * 它目前把调用判决的会话 id 放在 `actor` 字段里传下来；若这里要求另一个
   * 不存在的字段，所有真实的 send-back 都会落成「判不出独立验收会话」，
   * 于是退回永远不落账，账本只能在运行态里看见。
   *
   * 口径：
   *   · `pass`：仍优先使用账本里**已有合格 ACC** 的独立会话，⛔ 不许拿派活方顶替；
   *   · `send-back`：没有前置 ACC；此时判决者就是提出退回的一方，
   *     `actor` 是唯一可信的验收者读数 —— 但必须明确不是执行者（下方独立性检查）。
   */
  const verdictSession = fact.verdict === 'send-back' && acceptanceSession === ''
    ? text(fact.actor)
    : acceptanceSession
  if (verdictSession === '') {
    return { key, ops: [], undecidable: '判决缺独立验收会话 ⇒ 判不出独立性，不落账' }
  }
  /**
   * ⚠ `pass` 且账本已有同判决 ⇒ 幂等跳过（不重复建 ACC）。
   *   判据 = 同 task 下已有 `pass` ACC，且 `verified_at` 与本次判决时刻相同。
   */
  if (fact.verdict === 'pass') {
    const same = units.find((u) => u.kind === 'acc' && text(u.parent) === task.id
      && text(u.status) === 'pass' && text((u as unknown as { verified_at?: unknown }).verified_at) === fact.verifiedAt)
    if (same !== undefined) return { key, ops: [], skipped: `账本已有同一判决 ${same.id} ⇒ 不重复建` }
  }
  const builder = text(task.built_by)
  if (builder !== '' && (text(fact.actor) === builder || verdictSession === builder)) {
    return { key, ops: [], skipped: `验收者/验收会话与实现者 ${builder} 相同 ⇒ 自己验自己，不落账` }
  }
  if (fact.verdict === 'pass') {
    if (text(fact.productConfirmation) === '' || arr(fact.verificationRefs).length === 0 || arr(fact.exampleResults).length === 0) {
      return { key, ops: [], undecidable: '验收通过缺产品确认 / 技术证据 / 例子结果 ⇒ 判不出，不落账' }
    }
  } else if (text(fact.sendBackTo) === '') {
    return { key, ops: [], undecidable: '退回缺目标阶段（sendBackTo）⇒ 不落账' }
  }
  const accId = nextIdOf(units, 'ACC')
  return {
    key,
    ops: [{
      op: 'create-unit', id: accId, kind: 'acc',
      fields: {
        title: fact.verdict === 'pass' ? `独立验收 ${task.id} 通过` : `独立验收 ${task.id} 退回`,
        parent: task.id,
        status: fact.verdict,
        pipeline_version: 'v3',
        revision: '1',
        task_revision: text(task.revision),
        actor: text(fact.actor),
        acceptance_session: verdictSession,
        verified_at: fact.verifiedAt,
        basis: arr(fact.basis),
        ...(fact.verdict === 'pass'
          ? {
            product_confirmation: text(fact.productConfirmation),
            verification_refs: arr(fact.verificationRefs),
            example_results: arr(fact.exampleResults),
          }
          : { send_back_to: text(fact.sendBackTo) }),
        source: '运行态投影：hob_orch_control 判决成功',
        projection_key: key,
      },
    }],
  }
}

function verifyOps(units: readonly ProjectionUnitLike[], fact: VerifyFact): ProjectionResult {
  const key = projectionKeyOf(fact)
  const already = projectedUnitOf(units, key)
  if (already !== undefined) return { key, ops: [], skipped: `同一技术验证已投影为 ${already.id} ⇒ 不重复建` }
  const task = realTaskOf(units, fact.taskId)
  if (task === undefined) {
    return { key, ops: [], skipped: `技术验证对象 ${JSON.stringify(text(fact.taskId))} 不是账本里真实存在的 task ⇒ 不落账` }
  }
  if (text(fact.verifiedAt) === '' || !Number.isFinite(Date.parse(fact.verifiedAt))) {
    return { key, ops: [], undecidable: '技术验证缺可解析的 verifiedAt ⇒ 不落账' }
  }
  if (!/^\d+$/.test(text(task.revision)) || Number(task.revision) <= 0) {
    return { key, ops: [], undecidable: `task ${task.id} 缺正整数 revision ⇒ 无法绑定技术验证` }
  }
  if (text(fact.verifier) === '') return { key, ops: [], undecidable: '技术验证缺 verifier ⇒ 不落账' }
  if (arr(fact.basis).length === 0) return { key, ops: [], undecidable: '技术验证缺依据 ⇒ 不落账' }
  if (fact.verdict === 'waived' && (text(fact.waiverSource) === '' || text(fact.waivedBy) === '')) {
    return { key, ops: [], undecidable: '技术验证豁免缺来源或批准人 ⇒ 不落账' }
  }
  if (fact.verdict === 'send-back' && text(fact.sendBackTo) === '') {
    return { key, ops: [], undecidable: '技术验证退回缺目标阶段 ⇒ 不落账' }
  }
  const plan = planOfTask(units, task)
  const triggers = plan === undefined ? [] : arr(plan.risk_hard_triggers)
  const highRisk = plan !== undefined && ['high', 'critical'].includes(text(plan.risk_tier))
  const newRisks = arr(fact.newRiskRefs ?? [])
  if (fact.verdict === 'pass' && newRisks.length > 0) {
    return { key, ops: [], undecidable: `技术验证发现方案未声明的新风险：${newRisks.join(' / ')} ⇒ 必须回 G2 重评，不能落 PASS` }
  }
  if (fact.verdict === 'pass' && (triggers.length > 0 || highRisk)) {
    const refs = arr(fact.riskReviewRefs ?? [])
    if (refs.length === 0) {
      return { key, ops: [], undecidable: '技术验证通过但未逐项记录风险控制证据（riskReviewRefs）⇒ 不落账' }
    }
    if (triggers.length > refs.length) {
      return { key, ops: [], undecidable: `硬触发 ${triggers.length} 条，但风险控制证据只有 ${refs.length} 条 ⇒ 不落账` }
    }
  }
  const verId = nextIdOf(units, 'VER')
  return {
    key,
    ops: [{
      op: 'create-unit', id: verId, kind: 'verification',
      fields: {
        title: `技术验证 ${task.id} ${fact.verdict}`,
        parent: task.id,
        status: fact.verdict,
        pipeline_version: 'v3',
        revision: '1',
        task_revision: text(task.revision),
        verifier: text(fact.verifier),
        verification_session: text(fact.verificationSession) || text(fact.verifier),
        verified_at: fact.verifiedAt,
        basis: arr(fact.basis),
        criteria_refs: arr(fact.criteriaRefs ?? []),
        evidence_refs: arr(fact.evidenceRefs ?? fact.basis),
        ...(arr(fact.nonconformanceRefs ?? []).length === 0 ? {} : { nonconformance_refs: arr(fact.nonconformanceRefs ?? []) }),
        ...(arr(fact.riskReviewRefs ?? []).length === 0 ? {} : { risk_review_refs: arr(fact.riskReviewRefs ?? []) }),
        ...(arr(fact.newRiskRefs ?? []).length === 0 ? {} : { new_risk_refs: arr(fact.newRiskRefs ?? []) }),
        ...(text(fact.newRiskReason) === '' ? {} : { new_risk_reason: text(fact.newRiskReason) }),
        ...(fact.verdict === 'send-back' ? { send_back_to: text(fact.sendBackTo) } : {}),
        ...(fact.verdict === 'waived' ? {
          waiver_source: text(fact.waiverSource), waived_by: text(fact.waivedBy),
        } : {}),
        source: '运行态投影：独立技术验证',
        projection_key: key,
      },
    }],
  }
}

function closeOps(units: readonly ProjectionUnitLike[], fact: CloseFact): ProjectionResult {
  const key = projectionKeyOf(fact)
  const already = projectedUnitOf(units, key)
  if (already !== undefined) return { key, ops: [], skipped: `同一交付收口已投影为 ${already.id} ⇒ 不重复建` }
  const req = units.find((u) => text(u.id) === text(fact.reqId) && u.kind === 'req')
  if (req === undefined) return { key, ops: [], skipped: `交付收口对象 ${text(fact.reqId)} 不是真实需求 ⇒ 不落账` }
  if (!['skipped', 'standard', 'strict'].includes(fact.closureMode)) {
    return { key, ops: [], undecidable: `closureMode 非法：${String(fact.closureMode)}` }
  }
  if (text(fact.closedAt) === '' || !Number.isFinite(Date.parse(fact.closedAt))) {
    return { key, ops: [], undecidable: '交付收口缺可解析的 closedAt' }
  }
  if (arr(fact.basis).length === 0) return { key, ops: [], undecidable: '交付收口缺依据 ⇒ 不落账' }
  if (fact.status === 'skipped' && (text(fact.skipReason) === '' || text(fact.acceptedBy) === '')) {
    return { key, ops: [], undecidable: '跳过交付收口缺 skipReason / acceptedBy ⇒ 不落账' }
  }
  if (fact.status === 'closed') {
    if (arr(fact.releaseRefs ?? []).length === 0) return { key, ops: [], undecidable: '交付收口缺发布 / 构建证据 ⇒ 不落账' }
    if (fact.closureMode === 'standard' || fact.closureMode === 'strict') {
      const refs = arr(fact.releaseRefs ?? []).join('\n').toLowerCase()
      const missing = [
        ['构建', /build|构建/],
        ['冒烟', /smoke|冒烟|route|路由|http\s*20\d/],
        ['发布后检查', /post[- ]?release|发布后|after release|monitor|监控/],
      ].filter(([, re]) => !(re as RegExp).test(refs)).map(([name]) => name)
      if (missing.length > 0) return { key, ops: [], undecidable: `交付收口缺发布证据：${missing.join(' / ')} ⇒ 不落账` }
      if (arr(fact.rollbackRefs ?? []).length === 0) return { key, ops: [], undecidable: `${fact.closureMode} 收口缺回滚证据 ⇒ 不落账` }
    }
    if (fact.closureMode === 'strict') {
      if (arr(fact.monitoringRefs ?? []).length === 0) return { key, ops: [], undecidable: 'strict 收口缺监控证据 ⇒ 不落账' }
      if (text(fact.acceptedBy) === '') return { key, ops: [], undecidable: 'strict 收口缺接受者 ⇒ 不落账' }
      if (text(fact.approvalRef) === '') return { key, ops: [], undecidable: 'strict 收口缺独立发布审批 ⇒ 不落账' }
    }
    if (arr(fact.liens ?? []).length > 0) return { key, ops: [], undecidable: '仍有未关闭整改项 ⇒ 不能交付收口' }
  }
  /**
   * G6 must bind the accepted chain and the exact risk facts it used. A bare
   * "closed" would let a later plan revision or risk change pass unnoticed.
   */
  if (fact.status === 'closed' || fact.status === 'skipped') {
    if (text(fact.chainAcceptanceRef) === '' || text(fact.riskAssessmentRef) === '' || text(fact.residualRiskDecisionRef) === '') {
      return { key, ops: [], undecidable: '交付收口缺 G5 接受 / 风险评定 / 残余风险决定的绑定 ⇒ 不落账' }
    }
  }
  const clsId = nextIdOf(units, 'CLS')
  return {
    key,
    ops: [{
      op: 'create-unit', id: clsId, kind: 'closure',
      fields: {
        title: `交付收口 ${fact.reqId} ${fact.status}`,
        parent: fact.reqId,
        status: fact.status,
        pipeline_version: 'v3',
        revision: '1',
        closure_mode: fact.closureMode,
        basis: arr(fact.basis),
        release_refs: arr(fact.releaseRefs ?? []),
        rollback_refs: arr(fact.rollbackRefs ?? []),
        monitoring_refs: arr(fact.monitoringRefs ?? []),
        liens: arr(fact.liens ?? []),
        ...(text(fact.acceptedBy) === '' ? {} : { accepted_by: text(fact.acceptedBy) }),
        ...(text(fact.approvalRef) === '' ? {} : { approval_ref: text(fact.approvalRef) }),
        ...(text(fact.skipReason) === '' ? {} : { skip_reason: text(fact.skipReason) }),
        ...(text(fact.chainAcceptanceRef) === '' ? {} : { chain_acceptance_ref: text(fact.chainAcceptanceRef) }),
        ...(text(fact.riskAssessmentRef) === '' ? {} : { risk_assessment_ref: text(fact.riskAssessmentRef) }),
        ...(text(fact.residualRiskDecisionRef) === '' ? {} : { residual_risk_decision_ref: text(fact.residualRiskDecisionRef) }),
        closed_at: fact.closedAt,
        source: '运行态投影：交付收口',
        projection_key: key,
      },
    }],
  }
}

/**
 * **唯一入口**：把一条运行态事实投影成账本操作。
 *
 * @param units - 当前账本单元（⚠ 只读快照）
 * @param fact - 已发生的运行态事实
 * @returns 三档结果（applied ops / skipped / undecidable）
 */
export function projectFact(units: readonly ProjectionUnitLike[], fact: ProjectionFact): ProjectionResult {
  if (fact.kind === 'dispatch') return dispatchOps(units, fact)
  if (fact.kind === 'refuse') return refuseOps(units, fact)
  if (fact.kind === 'return') return returnOps(units, fact)
  if (fact.kind === 'verdict') return verdictOps(units, fact)
  if (fact.kind === 'verify') return verifyOps(units, fact)
  return closeOps(units, fact)
}

/** 把一条操作渲染成**可读拒绝原因**（⛔ 不静默跳过）。 */
export function describeProjection(r: ProjectionResult): string {
  if (r.undecidable !== undefined) return `判不出：${r.undecidable}`
  if (r.skipped !== undefined) return `未落账：${r.skipped}`
  if (r.ops.length === 0) return '未落账：没有可执行的账本操作'
  return `将执行 ${r.ops.length} 条账本操作（${r.ops.map((o) => o.op).join(' / ')}）`
}
