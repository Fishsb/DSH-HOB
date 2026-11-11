/**
 * Hob 工作计划（WorkPlan）的唯一形状与确定性判定。
 *
 * ── 它管什么 ──────────────────────────────────────────────────────────────
 *   把「工作方式」从一段提示词变成可检查的派单计划：
 *   · 单会话：同一计划只允许一条执行轨；
 *   · 多会话：存在独立候选时必须拆轨；单轨必须给候选证据；
 *   · 自动：可以少拆，但单轨必须留下封闭原因；
 *   · 三档的写轨都串行（当前没有 worktree 隔离，⛔ 不承诺并行写）。
 *
 * ⚠ 本文件是**纯函数**：不读文件、不读配置、不建会话、不投递。
 *   持久运行态、唤醒与派生状态仍归 `server/orch-state.ts` 与编排器所有。
 *
 * ⚠ 本文件**不扩大任何权限**。轨道只描述「派给哪个已存在的执行会话」，
 *   不改变该会话的可读范围、工具面或审批档。
 */
import { workModePolicy, type WorkMode } from './work-mode.ts'

export const WORK_PLAN_VERSION = 1
export const WORK_PLAN_STATE_VALUES = ['planned', 'running', 'joining', 'completed', 'failed'] as const
export type WorkPlanState = (typeof WORK_PLAN_STATE_VALUES)[number]

export const WORK_PLAN_REFUSALS = [
  'empty-plan',
  'duplicate-track',
  'duplicate-session',
  'duplicate-task',
  'missing-scope',
  'missing-acceptance',
  'missing-budget',
  'scope-conflict',
  'dependency-unknown',
  'dependency-cycle',
  'single-mode-one-track',
  'multi-mode-one-track-reason',
  'multiple-write-tracks',
  'duplicate-plan',
  'invalid-join',
  'invalid-rationale',
  'unverified-single-track-reason',
  'missing-split-evidence',
  'invalid-split-candidate',
  'multi-mode-split-required',
  'single-target-reason-required',
  'single-target-split-required',
] as const

export type WorkPlanRefusal = (typeof WORK_PLAN_REFUSALS)[number]

/** 多会话档降成单轨时允许的封闭原因。 */
export const MULTI_SINGLE_TRACK_REASONS = [
  'same-file',
  'shared-contract',
  'strict-order',
  'single-acceptance-unit',
  'insufficient-independent-scope',
] as const

export type MultiSingleTrackReason = (typeof MULTI_SINGLE_TRACK_REASONS)[number]

/**
 * 候选工作单元（`WM-30`）。
 *
 * ⚠ 多会话档不能只写一句“独立范围不足”就把可拆的工作压成单轨：
 *   必须列出候选片段，由校验器判断**是否真的存在独立对**。
 * ⚠ 候选只用于**证据核对**，⛔ 不替代真实轨道，也不改变派发对象。
 */
export interface SplitCandidate {
  /** 候选片段的稳定标识（归一后必须唯一）。 */
  pieceId: string
  /** 该候选打算覆盖的路径。 */
  scopePaths: string[]
  /** 该候选的独立验收。 */
  acceptance: string[]
  /** 该候选依赖的其它候选（可选）。 */
  dependsOn?: string[]
  /** 与其它候选共享的契约（`shared-contract` 的证据）。 */
  sharedContracts?: string[]
  /** 所属验收单元（`single-acceptance-unit` 的证据）。 */
  acceptanceUnit?: string
}

export interface WorkTrack {
  /** 计划内唯一；用于回传对号与状态展示。 */
  trackId: string
  /** 稳定 task id，如 `TSK-066`。 */
  taskId: string
  /** 已存在的执行会话 id。 */
  sessionId: string
  goal: string
  /** 该轨允许的范围。写轨必须给出；只读轨也必须给出可独立判断的范围。 */
  scopePaths: string[]
  accessType: 'read' | 'write'
  dependsOn: string[]
  /** 非空预算说明（现有任务书口径：tool_calls / rounds）。 */
  budget: string
  /** 至少一条可独立判断的验收。 */
  acceptance: string[]
  /** 派给该会话的原始指令。 */
  message: string
}

export interface SingleTrackEvidence {
  /**
   * `same-file` 的**可核对**依据：片段名 → 该片段打算写的路径。
   *
   * ⚠ 校验要求 ≥2 个（归一后）不同的片段，每个至少一条非空路径，且至少一对
   *   片段之间存在**真实重叠**。这样"同一段文字换个写法"就无法凑数。
   */
  piecePaths?: Record<string, string[]>
  /** 兼容旧写法；⚠ 单独出现**不足以**证明 same-file（见上）。 */
  mergedPieces?: string[]
  /** 兼容旧写法；⚠ 与 `mergedPieces` 一样，只作展示，不作通过依据。 */
  sharedPaths?: string[]
  /** `strict-order` 的有序子步骤（≥2，归一后不同）。 */
  orderedSteps?: string[]
  /**
   * 候选工作单元（多会话档单轨时必须给）。
   *
   * ⚠ 校验规则：候选之间若存在“路径不重叠、无依赖、各有独立验收”的对，
   *   就说明本可拆轨 ⇒ 多会话档拒绝单轨；只有不存在独立对时才允许合并。
   */
  candidatePieces?: SplitCandidate[]
}

/**
 * 不可见/可忽略字符：用 Unicode 的 `Default_Ignorable_Code_Point`，**不手写区间**。
 *
 * ⚠ 手写 `\u200B-\u200F` 这类区间只能盖住常见几种（实测只覆盖 4174 个
 *   `Default_Ignorable` 里的 27 个）：软连字符 U+00AD、组合用字符 U+034F、
 *   阿拉伯字母标记 U+061C、蒙古文元音分隔符 U+180E、变体选择符 U+FE0F 等
 *   都能让"同一段文字"在 `Set` 里变成两个键 ⇒ 伪造出"两个片段/两个步骤"。
 */
const EVIDENCE_INVISIBLE = /[\p{Default_Ignorable_Code_Point}\u0000-\u001F\u007F-\u009F]/gu

/**
 * 证据文本归一：全半角折叠（NFKC）、去掉不可见字符与 NUL、去掉首尾空白。
 *
 * ⚠ 为什么要去不可见字符：`"p1"` 与 `"p1\u200B"` 在 `Set` 里是两个键，
 *   于是"同一个片段写两遍"就能凑出"两个片段" —— 那是伪造证据，不是证据。
 *
 * ⚠ **R-21 顺带修的**：这段注释原来**悬空**在 {@link EVIDENCE_INVISIBLE} 上方，
 *   而它描述的其实是本函数 —— 于是 `grep 'export function'` 在它下面找不到东西。
 *   ⇒ 移到它真正描述的函数上。⛔ 不是删信息，是**把注释挂回它的对象**。
 */
export function normalizeEvidenceText(raw: unknown): string {
  return String(raw ?? '').normalize('NFKC').replace(EVIDENCE_INVISIBLE, '').trim()
}

/**
 * 证据条目的**区分键**：在 {@link normalizeEvidenceText} 之上再折叠大小写。
 *
 * ⚠ 为什么大小写也要折叠：`p` 与 `P` 是同一个片段的两种写法，不是两个片段。
 *   若不折叠，"同一个片段改个大小写"就能凑出第二个 —— 那和空白/零宽字符是同一类伪造。
 *   ⚠ 这是**区分键**，不是显示名：展示仍用原样文本。
 */
export function evidenceKey(raw: unknown): string {
  const text = normalizeEvidenceText(raw)
  /** ⚠ 独立的 `.` / `..` 不是片段名，是「没有名字」。 */
  if (/^\.+$/.test(text)) return ''
  /**
   * ⚠ **片段名是标识符，不是路径**：允许的字符只有字母、数字、下划线与连字符。
   *   其余（点、空白、不可见字符）一律剔除后再折叠大小写 —— 这样
   *   `p` / `p.` / `p /` / `Ｐ` 都归到同一个键，⛔ 不会因为换个写法就变成"两个片段"。
   *   ⚠ 名字里只剩这些字符的情形极罕见；宁可把它并进同名片段，也不留给伪造。
   */
  return text.replace(/[^\p{L}\p{N}_-]/gu, '').toLowerCase()
}

/**
 * 路径归一（**先折叠再剥通配**）：反斜杠转正斜杠、去掉 `.` 段、折叠 `..`、
 * 合并重复斜杠，**最后**反复剥掉尾部整段的 `*` / `**`。
 *
 * ⚠ 顺序很关键：若**先剥通配再折叠**，`src/a` 后跟两层通配的写法会漏成
 *   尾部多出来的通配段 —— 归一后就又成了"两条路径"。⇒ 必须先折叠、再剥。
 */
export function canonicalScopePath(raw: unknown): string {
  const text = String(raw ?? '').replace(/\\/g, '/')
  const parts: string[] = []
  for (const rawSeg of text.split('/')) {
    const seg = normalizeEvidenceText(rawSeg)
    if (seg === '' || seg === '.') continue
    if (seg === '..') { parts.pop(); continue }
    parts.push(seg)
  }
  const starSegment = new RegExp('^' + '\\*' + '+$')
  while (parts.length > 0 && starSegment.test(parts[parts.length - 1]!)) parts.pop()
  return parts.join('/')
}

export interface WorkPlanInput {
  planId: string
  changeId: string
  mode: WorkMode
  /** 计划所属工作区；由运行时写入，旧计划可缺省。 */
  workspaceRoot?: string
  rationale: string
  tracks: WorkTrack[]
  joinPolicy: 'all' | 'dependency-gated'
  joinOwnerSessionId: string
  /**
   * 「同一时刻只有一条轨在跑」的封闭原因。
   *
   * ⚠ 单轨计划必填；多轨计划只有在写轨被串行化时才由系统自动填写，
   *   并由 {@link WorkPlan.serialized} 留下可核对依据。
   */
  singleTrackReason?: MultiSingleTrackReason
  /**
   * 单轨原因的**结构化依据**。
   *
   * ⚠ `same-file` 必须用 {@link SingleTrackEvidence.piecePaths}：逐个片段列出它
   *   打算写的路径，由校验器判断**两个不同片段之间**是否真的重叠。
   *   `mergedPieces` + `sharedPaths` 是早期形态 —— 它只能证明"调用方这么写"，
   *   无法证明"两个片段真的会写同一处"，⛔ 已不再单独作为通过依据。
   */
  singleTrackEvidence?: SingleTrackEvidence
  /** 写轨被迫串行的依据；由校验器按真实范围算出，⛔ 不接受调用方自述。 */
  serialized?: WorkPlanSerialization
}

/**
 * 写轨被串行化时留下的依据（⛔ 不是自由文本）。
 *
 * ⚠ 第一版没有 worktree 隔离 ⇒ 同一工作区同一时刻只能有一条写轨。
 *   遇到多条写轨时**不拒绝**，而是串成一条链并在这里记下为什么。
 */
export interface WorkPlanSerialization {
  reason: MultiSingleTrackReason
  /** 每条串行链上的 trackId（按执行顺序）。 */
  groups: string[][]
  /** `same-file` 时，真实重叠的路径（交叉验证用）。 */
  sharedPaths?: string[]
}

export interface WorkPlan extends WorkPlanInput {
  version: typeof WORK_PLAN_VERSION
  /**
   * 计划**创建时**的工作方式快照（`WM-8`）。
   *
   * ⚠ 计划落盘后，会话再改档位只影响**下一份**计划；本计划按快照推进。
   *   旧计划文件缺该字段时，读取侧回落到 `mode`。
   */
  modeSnapshot: WorkMode
  state: WorkPlanState
  createdAt: number
  /** 旧单目标派单自动生成的隐式计划（单轨、无独立汇合动作）。 */
  implicit?: boolean
  /** 每条轨道的最近状态；实现只派生/写入运行态，不另造账本状态。 */
  trackStates?: Record<string, WorkTrackState>
}

export const WORK_TRACK_STATE_VALUES = [
  'pending',
  'running',
  'returned',
  'failed',
  'cancelled',
] as const

export type WorkTrackState = (typeof WORK_TRACK_STATE_VALUES)[number]

export interface WorkPlanProblem {
  code: WorkPlanRefusal
  message: string
  trackId?: string
}

export interface WorkPlanVerdict {
  ok: boolean
  problems: WorkPlanProblem[]
  /**
   * 校验通过后的**规范化**计划（写轨可能已被串行化）。
   *
   * ⚠ 调用方必须用这一份去落盘/派发：直接用手写入参会绕过串行化，
   *   等于把「同一工作区只有一条写轨」这条隔离规则丢掉。
   */
  normalized?: WorkPlanInput
}

export interface ValidateWorkPlanOptions {
  /**
   * 是否自动把多条写轨串成链（默认 `true`）。
   *
   * ⚠ 只有负向对拍会传 `false`：用来证明「去掉串行化 ⇒ 校验必须拒绝」，
   *   即 `multiple-write-tracks` 仍是兜底网。
   */
  serializeWrites?: boolean
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== ''

const unique = (values: readonly string[]): boolean =>
  new Set(values).size === values.length

/**
 * 路径是否重叠。
 *
 * 采用保守的规范化：
 * · 去掉多余的 `/`；
 * · `a/**` 与 `a` 视为同一范围；
 * · 前缀路径（`src/a` 与 `src/a/b`）视为重叠。
 *
 * ⚠ 这不是 glob 的完整实现，而是**冲突判定**：宁可保守拒绝并行，也不漏掉
 *   两条会写同一片文件的轨道。
 */
export function scopePathsOverlap(a: string, b: string): boolean {
  /**
   * ⚠ 这里**复用** {@link canonicalScopePath} 的同一套归一（折叠 `.` / `..`、
   *   合并斜杠、最后剥尾部通配）。
   *   两处各写一套 = 同一片文件在"冲突判定"与"证据核对"里得到不同答案，
   *   于是路径尾部的通配写法在证据门被当成两条、在冲突门被当成一条。
   */
  const left = canonicalScopePath(a)
  const right = canonicalScopePath(b)
  if (left === '' || right === '' || left === '.' || right === '.') return true
  return left === right
    || left.startsWith(right + "/")
    || right.startsWith(left + "/")
}

/** 归一后的候选列表：坏形状一律返回 `undefined`（调用方据此拒绝，⛔ 不猜）。 */
function normalizeSplitCandidates(raw: unknown): SplitCandidate[] | undefined {
  if (!Array.isArray(raw)) return undefined
  /** ⚠ 上限 8：候选表是证据，不是把整张任务图搬进工具参数。 */
  if (raw.length > 8) return undefined
  const out: SplitCandidate[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return undefined
    const row = item as Record<string, unknown>
    const pieceId = evidenceKey(row.pieceId)
    if (pieceId === '' || seen.has(pieceId)) return undefined
    seen.add(pieceId)
    if (!Array.isArray(row.scopePaths) || row.scopePaths.length === 0
      || !row.scopePaths.every((x) => typeof x === 'string')) return undefined
    const scopePaths = [...new Set((row.scopePaths as string[])
      .map((x) => canonicalScopePath(x))
      .filter((x) => x !== ''))]
    if (scopePaths.length === 0) return undefined
    if (!Array.isArray(row.acceptance) || row.acceptance.length === 0
      || !row.acceptance.every((x) => typeof x === 'string')) return undefined
    const acceptance = [...new Set((row.acceptance as string[])
      .map((x) => normalizeEvidenceText(x))
      .filter((x) => x !== ''))]
    if (acceptance.length === 0) return undefined
    const dependsOn = row.dependsOn === undefined ? [] : row.dependsOn
    if (!Array.isArray(dependsOn) || !dependsOn.every((x) => typeof x === 'string')) return undefined
    const deps = [...new Set((dependsOn as string[]).map((x) => evidenceKey(x)).filter((x) => x !== ''))]
    const sharedContracts = row.sharedContracts === undefined ? [] : row.sharedContracts
    if (!Array.isArray(sharedContracts) || !sharedContracts.every((x) => typeof x === 'string')) return undefined
    const contracts = [...new Set((sharedContracts as string[])
      .map((x) => normalizeEvidenceText(x))
      .filter((x) => x !== ''))]
    const acceptanceUnit = row.acceptanceUnit === undefined ? undefined : row.acceptanceUnit
    if (acceptanceUnit !== undefined && typeof acceptanceUnit !== 'string') return undefined
    out.push({
      pieceId,
      scopePaths,
      acceptance,
      ...(deps.length === 0 ? {} : { dependsOn: deps }),
      ...(contracts.length === 0 ? {} : { sharedContracts: contracts }),
      ...(typeof acceptanceUnit === 'string' && acceptanceUnit.trim() !== ''
        ? { acceptanceUnit: normalizeEvidenceText(acceptanceUnit) }
        : {}),
    })
  }
  return out
}

/**
 * 单目标派活的档位校验（`hob_dispatch` 不带 `tracks` 时使用）。
 *
 * ⚠ 单目标不是“没有计划所以不受档位约束”：它等价于一条隐式单轨计划。
 *   · 单会话：设定本身，不接受单轨原因；
 *   · 自动：必须有封闭原因（判路依据）；
 *   · 多会话：必须有封闭原因 + 候选证据；候选里存在独立对 ⇒ 必须改用多轨。
 */
export function validateSingleTargetDispatch(input: {
  mode: WorkMode
  singleTrackReason?: MultiSingleTrackReason
  singleTrackEvidence?: SingleTrackEvidence
}): { ok: boolean; problems: WorkPlanProblem[] } {
  const problems: WorkPlanProblem[] = []
  const policy = workModePolicy(input.mode)
  const push = (code: WorkPlanRefusal, message: string): void => {
    problems.push({ code, message })
  }
  if (!policy.acceptsSingleTrackReason) {
    if (input.singleTrackReason !== undefined) {
      push('multi-mode-one-track-reason', '单会话档的单轨是设定本身，不接受单轨原因字段')
    }
    return { ok: problems.length === 0, problems }
  }
  if (input.singleTrackReason === undefined) {
    push('single-target-reason-required',
      `${input.mode === 'auto' ? '自动' : '多会话'}档单目标派活必须给 singleTrackReason`
      + '（单目标等价于一条隐式单轨计划，不能省略判路依据）')
    return { ok: false, problems }
  }
  /** ⚠ 与计划层共用同一份原因/证据校验：单目标不是“免检通道”。 */
  problems.push(...singleTrackReasonProblems(
    input.mode,
    input.singleTrackReason,
    input.singleTrackEvidence,
    'single-target',
  ))
  return { ok: problems.length === 0, problems }
}

/**
 * 两个候选是否**真正独立**（可拆成两条轨）。
 *
 * 三条同时成立才算独立：
 *   ① 范围不重叠；
 *   ② 没有直接或间接依赖；
 *   ③ 各自有至少一条**不同的**验收。
 */
export function candidatesAreIndependent(a: SplitCandidate, b: SplitCandidate): boolean {
  if (a.scopePaths.some((x) => b.scopePaths.some((y) => scopePathsOverlap(x, y)))) return false
  const aDeps = new Set(a.dependsOn ?? [])
  const bDeps = new Set(b.dependsOn ?? [])
  if (aDeps.has(b.pieceId) || bDeps.has(a.pieceId)) return false
  /** 共享契约 ⇒ 两侧要一起改同一份接口，不能算独立。 */
  if ((a.sharedContracts ?? []).some((x) => (b.sharedContracts ?? []).includes(x))) return false
  /** 同一个验收单元 ⇒ 结果只能一起判，不能算独立。 */
  if (a.acceptanceUnit !== undefined && a.acceptanceUnit === b.acceptanceUnit) return false
  return !a.acceptance.some((x) => b.acceptance.includes(x))
}

/** 候选表里是否存在至少一对独立候选。 */
export function hasIndependentCandidatePair(candidates: readonly SplitCandidate[]): boolean {
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (candidatesAreIndependent(candidates[i]!, candidates[j]!)) return true
    }
  }
  return false
}

/** 找依赖环。返回环上的 trackIds；无环返回空数组。 */
export function dependencyCycles(tracks: readonly WorkTrack[]): string[][] {
  const byId = new Map(tracks.map((t) => [t.trackId, t]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []
  const cycles: string[][] = []
  const seen = new Set<string>()

  const walk = (id: string): void => {
    if (visiting.has(id)) {
      const start = stack.indexOf(id)
      const cycle = start >= 0 ? [...stack.slice(start), id] : [id, id]
      const key = [...new Set(cycle)].sort().join(',')
      if (!seen.has(key)) {
        seen.add(key)
        cycles.push(cycle)
      }
      return
    }
    if (visited.has(id)) return
    visiting.add(id)
    stack.push(id)
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (byId.has(dep)) walk(dep)
    }
    stack.pop()
    visiting.delete(id)
    visited.add(id)
  }

  for (const track of tracks) walk(track.trackId)
  return cycles
}

/**
 * 校验计划本身。只判结构、隔离与档位语义，不做 I/O。
 *
 * `mode` 取自调用方（逐会话策略的现读结果），⛔ 不从计划入参自述里取。
 */
export function validateWorkPlan(
  input: WorkPlanInput,
  options: ValidateWorkPlanOptions = {},
): WorkPlanVerdict {
  const problems: WorkPlanProblem[] = []
  /** ⚠ 三档语义只从策略表读，⛔ 不在本函数里另写一套档位分支。 */
  const policy = workModePolicy(input.mode)
  const push = (code: WorkPlanRefusal, message: string, trackId?: string): void => {
    problems.push({ code, message, ...(trackId === undefined ? {} : { trackId }) })
  }

  if (!nonEmpty(input.planId) || !nonEmpty(input.changeId)) {
    push('empty-plan', '计划缺 planId 或 changeId')
  }
  if (!nonEmpty(input.joinOwnerSessionId)) {
    push('invalid-join', '计划缺汇合责任人')
  }
  if (input.joinPolicy !== 'all' && input.joinPolicy !== 'dependency-gated') {
    push('invalid-join', `不认识的汇合策略：${String(input.joinPolicy)}`)
  }
  if (!nonEmpty(input.rationale)) {
    push('invalid-rationale', '计划必须写清为什么这样拆分')
  }
  if (!Array.isArray(input.tracks) || input.tracks.length === 0) {
    push('empty-plan', '计划至少需要一条轨道')
    return { ok: false, problems }
  }

  if (policy.maxActiveTracks === 1 && input.tracks.length !== 1) {
    push('single-mode-one-track', `单会话档只允许一条轨道，实际 ${input.tracks.length} 条`)
  }

  const trackIds = input.tracks.map((t) => t.trackId)
  const taskIds = input.tracks.map((t) => t.taskId)
  const sessionIds = input.tracks.map((t) => t.sessionId)
  if (!unique(trackIds)) push('duplicate-track', 'trackId 必须唯一')
  if (!unique(taskIds)) push('duplicate-task', '同一计划不能把同一 task 派给两条轨')
  if (!unique(sessionIds)) push('duplicate-session', '同一执行会话不能在两条独立轨上同时跑')

  for (const track of input.tracks) {
    if (!nonEmpty(track.trackId) || !nonEmpty(track.taskId) || !nonEmpty(track.sessionId)
      || !nonEmpty(track.goal) || !nonEmpty(track.message)) {
      push('empty-plan', '轨道缺少 trackId / taskId / sessionId / goal / message', track.trackId)
    }
    if (!Array.isArray(track.scopePaths) || track.scopePaths.length === 0
      || !track.scopePaths.every(nonEmpty)) {
      push('missing-scope', '轨道必须给出非空 scopePaths', track.trackId)
    }
    if (!Array.isArray(track.acceptance) || track.acceptance.length === 0
      || !track.acceptance.every(nonEmpty)) {
      push('missing-acceptance', '轨道必须给出至少一条独立验收', track.trackId)
    }
    if (!nonEmpty(track.budget)) {
      push('missing-budget', '轨道必须给出非空预算', track.trackId)
    }
    if (track.accessType !== 'read' && track.accessType !== 'write') {
      push('missing-scope', `轨道 accessType 非法：${String(track.accessType)}`, track.trackId)
    }
    if (!Array.isArray(track.dependsOn) || !track.dependsOn.every(nonEmpty)) {
      push('dependency-unknown', 'dependsOn 必须是字符串数组', track.trackId)
    }
  }

  const known = new Set(trackIds)
  for (const track of input.tracks) {
    for (const dep of track.dependsOn) {
      if (!known.has(dep)) {
        push('dependency-unknown', `依赖 ${dep} 不在本计划中`, track.trackId)
      }
    }
  }
  for (const cycle of dependencyCycles(input.tracks)) {
    push('dependency-cycle', `依赖环：${cycle.join(' -> ')}`)
  }

  /**
   * ── 单轨原因必须能被字段交叉验证（`WM-3`）──────────────────────────────
   * `same-file` 不能只是一句自述：它必须点名被折在一起的片段，并给出**真实
   * 重叠**的路径；`strict-order` 必须给出 >=2 个有序子步骤。
   * ⚠ 反例：写 `same-file` 却没有任何共享路径 ⇒ 拒绝（那是用理由掩盖可并行）。
   */
  const evidence = input.singleTrackEvidence
  /**
   * `multi` 与 `auto` 都要求单轨时有**封闭原因**：
   * · `multi` 的默认行为是「尽可能拆」，单轨是例外 ⇒ 必须说明为什么不能拆；
   * · `auto` 由系统自行判路数，单路同样是判决结果 ⇒ 依据不能只是一句自由文本。
   * ⚠ `single` 档的单轨是**设定本身**，不需要理由（它就是要一路）。
   */
  if (policy.acceptsSingleTrackReason && input.tracks.length === 1) {
    problems.push(...singleTrackReasonProblems(input.mode, input.singleTrackReason, evidence))
  }
  if (!policy.acceptsSingleTrackReason && input.singleTrackReason !== undefined) {
    push('multi-mode-one-track-reason', '单会话档的单轨是设定本身，不接受单轨原因字段')
  }

  /**
   * ── 多会话档：存在独立候选就必须拆轨（`WM-30`）────────────────────────
   *
   * ⚠ 这是“多会话”与“自动”在运行时最关键的差别：
   *   自动档可以判成单轨；多会话档若候选表证明存在独立对，单轨就是**少拆**，必须拒绝。
   * ⚠ 候选表缺失本身由上面的 `missing-split-evidence` 报；这里只判“有证据却仍单轨”。
   */
  if (policy.mustSplitIndependentCandidates && input.tracks.length === 1) {
    const candidates = normalizeSplitCandidates(
      (evidence as { candidatePieces?: unknown } | undefined)?.candidatePieces,
    )
    if (candidates !== undefined && hasIndependentCandidatePair(candidates)) {
      const pair = (() => {
        for (let i = 0; i < candidates.length; i++) {
          for (let j = i + 1; j < candidates.length; j++) {
            if (candidatesAreIndependent(candidates[i]!, candidates[j]!)) {
              return [candidates[i]!.pieceId, candidates[j]!.pieceId] as const
            }
          }
        }
        return undefined
      })()
      push('multi-mode-split-required',
        `多会话档发现独立候选 ${pair?.[0] ?? '?'} / ${pair?.[1] ?? '?'}（范围不重叠、无依赖、验收不同）`
        + ' ⇒ 必须拆成多轨；⛔ 不许用单轨原因合并')
    }
  }

  /**
   * ── 写轨隔离（`WM-3` / `WM-12`）──────────────────────────────────────────
   * 第一版没有 worktree 自动隔离 ⇒ 同一工作区同一时刻只能有一条写轨。
   * 遇到多条写轨时**不伪并行**：把会写同一片文件的轨串成链（后者依赖前者），
   * 并把 `same-file` 与真实重叠路径写进计划。调用方显式关闭串行化（负向对拍）
   * 时才回到硬拒绝 `multiple-write-tracks`。
   */
  const writeTracks = input.tracks.filter((t) => t.accessType === 'write')
  const overlapPairs: Array<{ a: WorkTrack; b: WorkTrack; paths: string[] }> = []
  for (let i = 0; i < writeTracks.length; i++) {
    for (let j = i + 1; j < writeTracks.length; j++) {
      const a = writeTracks[i]!
      const b = writeTracks[j]!
      const paths = a.scopePaths.filter((x) => b.scopePaths.some((y) => scopePathsOverlap(x, y)))
      if (paths.length > 0) overlapPairs.push({ a, b, paths })
    }
  }

  let normalized: WorkPlanInput = input
  if (writeTracks.length > 1) {
    if (options.serializeWrites === false) {
      push('multiple-write-tracks',
        `同一工作区最多一条写轨，实际 ${writeTracks.length} 条：${writeTracks.map((t) => t.trackId).join(', ')}`)
    } else {
      /**
       * ── 多条写轨必须串成**一条无环的链**（同一工作树只有一个写者）──────────
       *
       * ⚠⚠ 这里不能按"入参顺序"硬串：若调用方已经写了 `a dependsOn b`，
       *   再按 a→b 顺序补一条 `b dependsOn a`，就**造出一个环** ——
       *   而环上的轨道永远不会 ready ⇒ `firstWave` 为空 ⇒ 计划永远 running、
       *   永不 failed、也永不 joining（真机可复现的静默死锁）。
       * ⇒ 先对**写轨之间**的既有依赖做拓扑排序，再按拓扑序补相邻边；
       *   拓扑序保证「补边不会回指」，因此补完必然无环。
       *   写轨之间若本来就有环，前面 `dependencyCycles` 已经拒绝，这里不会走到。
       */
      const writeIds = new Set(writeTracks.map((t) => t.trackId))
      const byId = new Map(input.tracks.map((t) => [t.trackId, t]))
      /**
       * ⚠⚠ 排序必须看**全图**，不能只看写轨之间的直接边。
       *   反例（真机复刻）：`b(write) dependsOn r(read) dependsOn a(write)`，
       *   入参顺序 `[b, a, r]`。若只对写轨之间的直接边排序 ⇒ a 与 b 互不相干
       *   ⇒ 按入参顺序补 `a dependsOn b` ⇒ 得到 `b→r→a→b` 的环，首波为空。
       * ⇒ 先把每条写轨的**全部（含传递）前置**算出来，再只对这些前置关系做拓扑。
       */
      const ancestorsOf = (id: string): Set<string> => {
        const seen = new Set<string>()
        const stack = [...(byId.get(id)?.dependsOn ?? [])]
        while (stack.length > 0) {
          const cur = stack.pop()!
          if (seen.has(cur)) continue
          seen.add(cur)
          for (const dep of byId.get(cur)?.dependsOn ?? []) stack.push(dep)
        }
        return seen
      }
      /**
       * 每条写轨的「写轨前置集合」= 它**全图**前置里落在写轨集合中的那些。
       * ⚠ 若 a 是 b 的传递前置、b 又是 a 的前置，集合里会互相包含 —— 排序时自然
       *   挑不出可放者（`next === undefined`）⇒ 走下面的拒绝分支。那才是真环；
       *   ⛔ 不要在这里额外判"互为前置"，那会把**合法的**传递边也算成环。
       */
      const predecessors = new Map<string, Set<string>>()
      for (const id of writeIds) {
        predecessors.set(id, new Set([...ancestorsOf(id)].filter((x) => writeIds.has(x))))
      }
      const order = new Map(trackIds.map((id, index) => [id, index]))
      const remaining = new Set(writeIds)
      const topo: string[] = []
      while (remaining.size > 0) {
        const next = [...remaining]
          .filter((id) => ![...(predecessors.get(id) ?? [])].some((p) => remaining.has(p)))
          .sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0))[0]
        if (next === undefined) break
        topo.push(next)
        remaining.delete(next)
      }
      if (topo.length !== writeIds.size) {
        /** 全图里存在互相前置（含经只读轨的传递环）⇒ 明确拒绝，⛔ 不产出"看起来能跑"的计划。 */
        push('dependency-cycle', '多条写轨的全图前置关系形成环 ⇒ 无法串成一条可执行的链')
      } else {
        const tracks = [...input.tracks]
        for (let k = 1; k < topo.length; k++) {
          const prev = topo[k - 1]!
          const cur = topo[k]!
          const index = tracks.findIndex((t) => t.trackId === cur)
          const track = tracks[index]!
          if (!track.dependsOn.includes(prev)) {
            tracks[index] = { ...track, dependsOn: [...track.dependsOn, prev] }
          }
        }
        const sharedPaths = [...new Set(overlapPairs.flatMap((pair) => pair.paths))]
        const serialized: WorkPlanSerialization = {
          reason: sharedPaths.length > 0 ? 'same-file' : 'strict-order',
          groups: [topo],
          ...(sharedPaths.length === 0 ? {} : { sharedPaths }),
        }
        normalized = {
          ...input,
          tracks,
          singleTrackReason: input.singleTrackReason ?? serialized.reason,
          serialized,
        }
      }
    }
  }

  /**
   * ⚠⚠ **最后一道网**：规范化（补边）之后必须再查一次环。
   *   如果这里查出环，说明串行化本身有缺陷 —— 那就**拒绝**，⛔ 绝不返回
   *   「ok=true 但首波为空、计划永远 running」的规范化计划。
   *   这条检查与上面的排序互为冗余：排序是修法，这里是兜底。
   */
  if (problems.length === 0 && normalized !== input) {
    for (const cycle of dependencyCycles(normalized.tracks)) {
      push('dependency-cycle', `串行化后出现依赖环：${cycle.join(' -> ')}（拒绝而非静默空转）`)
    }
  }

  return { ok: problems.length === 0, problems, ...(problems.length === 0 ? { normalized } : {}) }
}

/**
 * 单轨原因 + 证据的共用校验（计划层与单目标派活层都调用）。
 *
 * ⚠ 这是“同一条规则只有一个实现点”：单目标派活不能因为不走 `tracks`
 *   就跳过 `same-file` / `strict-order` 的证据门。
 */
function singleTrackReasonProblems(
  mode: WorkMode,
  reason: MultiSingleTrackReason | undefined,
  evidence: SingleTrackEvidence | undefined,
  scope: 'plan' | 'single-target' = 'plan',
): WorkPlanProblem[] {
  const problems: WorkPlanProblem[] = []
  const policy = workModePolicy(mode)
  const push = (code: WorkPlanRefusal, message: string): void => {
    problems.push({ code, message })
  }
  if (!policy.acceptsSingleTrackReason) return problems
  if (reason === undefined) {
    push('multi-mode-one-track-reason',
      `${mode === 'auto' ? '自动' : '多会话'}档只有一条轨道时必须给出封闭原因（这是判路依据，不是可选备注）`)
    return problems
  }
  if (!(MULTI_SINGLE_TRACK_REASONS as readonly string[]).includes(reason)) {
    push('multi-mode-one-track-reason', `单轨原因不在封闭集内：${reason}`)
    return problems
  }
  /**
   * ── 多会话档：候选表是**一切单轨原因的共同前提**（`WM-30`）─────────────
   * ⚠ 不能因为理由写成 `same-file` / `strict-order` 就绕过候选表：
   *   那两种理由只证明“这两段不能并行”，不证明“没有别的独立候选”。
   * ⇒ 先要求候选表存在且形态合法，再叠加该原因自己的证据门。
   */
  if (policy.singleTrackEvidence === 'candidates') {
    const rawCandidates = evidence?.candidatePieces
    if (rawCandidates === undefined) {
      push('missing-split-evidence',
        `多会话档${scope === 'single-target' ? '单目标派活' : '单轨计划'}必须给 candidatePieces`
        + `（用 ${reason} 解释合并时也一样：要证明没有别的独立候选）`)
      return problems
    }
    const candidates = normalizeSplitCandidates(rawCandidates)
    if (candidates === undefined || candidates.length === 0) {
      push('invalid-split-candidate',
        'candidatePieces 形态不合法（最多 8 个；每个需 pieceId / scopePaths / acceptance）')
      return problems
    }
    if (hasIndependentCandidatePair(candidates)) {
      const pair = (() => {
        for (let i = 0; i < candidates.length; i++) {
          for (let j = i + 1; j < candidates.length; j++) {
            if (candidatesAreIndependent(candidates[i]!, candidates[j]!)) {
              return [candidates[i]!.pieceId, candidates[j]!.pieceId] as const
            }
          }
        }
        return undefined
      })()
      push(scope === 'single-target' ? 'single-target-split-required' : 'multi-mode-split-required',
        `多会话档发现独立候选 ${pair?.[0] ?? '?'} / ${pair?.[1] ?? '?'}（范围不重叠、无依赖、验收不同）`
        + ` ⇒ 必须拆成多轨；⛔ 不许用单轨原因合并`)
      return problems
    }
  }
  if (reason === 'same-file') {
      /**
       * ⚠⚠ `same-file` 的唯一通过依据是 {@link SingleTrackEvidence.piecePaths}：
       *
       *   ```ts
       *   piecePaths: {
       *     parser: ['src/shared/work-plan.ts'],
       *     writer: ['src/shared/work-plan.ts', 'src/shared/state.ts'],
       *   }
       *   ```
       *
       * 判据（三条，缺一不看）：
       *   ① 归一后 ≥2 个**不同**片段；
       *   ② 每个片段至少一条非空路径；
       *   ③ 至少一对片段之间**真的有路径重叠**（同一片段内部的重叠不算）。
       *
       * ⚠ 为什么不再接受 `mergedPieces + sharedPaths`：那两个字段只证明"调用方
       *   写了两个名字、两条路径"，无法证明这两个片段会写同一处 ——
       *   它只能被伪造（同一路径换写法、空白、不可见字符都能凑）。
       */
      const piecePaths = (evidence as { piecePaths?: unknown } | undefined)?.piecePaths
      const byPiece = new Map<string, string[]>()
      let shapeProblem = false
      if (piecePaths !== undefined && piecePaths !== null) {
        /**
         * ⚠ 形态必须先判，再取值：`piecePaths` 传成数组或字符串时，直接
         *   `Object.entries()` 会得到 `['0','a']` 这种伪片段 —— 那会让垃圾输入
         *   通过（或在内层抛错）。⇒ 非纯对象一律判失败。
         */
        if (typeof piecePaths !== 'object' || Array.isArray(piecePaths)) {
          shapeProblem = true
        } else {
          for (const [rawName, rawPaths] of Object.entries(piecePaths as Record<string, unknown>)) {
            /** ⚠ 用区分键（大小写不敏感）合并，避免 `p` 与 `P` 被当成两个片段。 */
            const name = evidenceKey(rawName)
            if (name === '') continue
            if (!Array.isArray(rawPaths)) { shapeProblem = true; continue }
            if (!rawPaths.every((x) => typeof x === 'string')) { shapeProblem = true; continue }
            const paths = [...new Set((rawPaths as string[])
              .map((x) => canonicalScopePath(x))
              .filter((x) => x !== ''))]
            if (paths.length === 0) continue
            byPiece.set(name, [...(byPiece.get(name) ?? []), ...paths])
          }
        }
      }
      const names = [...byPiece.keys()]
      let overlappingPair: [string, string] | undefined
      for (let i = 0; i < names.length && overlappingPair === undefined; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const a = byPiece.get(names[i]!)!
          const b = byPiece.get(names[j]!)!
          if (a.some((x) => b.some((y) => scopePathsOverlap(x, y)))) {
            overlappingPair = [names[i]!, names[j]!]
            break
          }
        }
      }
      if (shapeProblem || names.length < 2 || overlappingPair === undefined) {
        push('unverified-single-track-reason',
          'same-file 必须用 piecePaths 给出 ≥2 个不同片段，每个带非空路径，且至少一对片段'
          + '之间真的写着重叠路径（只写 mergedPieces/sharedPaths 不算证据；'
          + 'piecePaths 必须是对象、每个值必须是字符串数组）')
      }
  } else if (reason === 'strict-order') {
      /**
       * ⚠ 非数组（字符串 / 对象 / undefined 混进来）必须**拒绝**，⛔ 不许抛。
       *   `'a,b'.map(...)` 会直接 TypeError，那会让校验器本身崩掉 ——
       *   调用方看到的就不是"证据不合格"，而是"工具坏了"。
       */
      const rawSteps: unknown = (evidence as { orderedSteps?: unknown } | undefined)?.orderedSteps
      const shapeOk = rawSteps === undefined
        || (Array.isArray(rawSteps) && rawSteps.every((x) => typeof x === 'string'))
      const steps = [...new Set((Array.isArray(rawSteps) ? rawSteps as string[] : [])
        .map((x) => evidenceKey(x))
        .filter((x) => x !== ''))]
      if (!shapeOk || steps.length < 2) {
        push('unverified-single-track-reason',
          'strict-order 必须给出 >=2 个非空且互不相同的有序子步骤（必须是字符串数组；空白项不算一步）')
      }
  } else if (policy.singleTrackEvidence === 'candidates') {
      /**
       * ── 多会话档的其余三种单轨原因（`WM-30`）──────────────────────────
       * ⚠ `shared-contract` / `single-acceptance-unit` / `insufficient-independent-scope`
       *   以前只检查值在封闭集内 ⇒ 一句自述就能把本可拆的工作压成单轨。
       * ⇒ 现在必须给候选表，并由**真实路径 / 依赖 / 验收**判断是否可拆。
       * ⚠ `same-file` / `strict-order` 已有各自的强证据（上面两支），
       *   不要求重复给候选表；但只要给了候选表，独立对仍会被下面的统一检查拒绝。
       */
      const candidates = normalizeSplitCandidates(
        (evidence as { candidatePieces?: unknown } | undefined)?.candidatePieces,
      )
      if (candidates === undefined || candidates.length === 0) return problems
      if (reason === 'shared-contract') {
        const sharedPair = candidates.some((a, i) => candidates.some((b, j) => i < j
          && (a.sharedContracts ?? []).some((x) => (b.sharedContracts ?? []).includes(x))))
        if (candidates.length < 2 || !sharedPair) {
          push('unverified-single-track-reason',
            'shared-contract 必须列出 ≥2 个候选，且至少一对候选共享同一契约（sharedContracts 有交集）')
        }
      } else if (reason === 'single-acceptance-unit') {
        const unit = candidates[0]?.acceptanceUnit
        if (candidates.length < 2 || unit === undefined
          || !candidates.every((x) => x.acceptanceUnit === unit)) {
          push('unverified-single-track-reason',
            'single-acceptance-unit 必须列出 ≥2 个候选，且每个候选的 acceptanceUnit 相同且非空')
        }
      }
    }
  return problems
}

/**
 * 计算首次可立即派发的轨道。
 *
 * `all`：没有前置依赖的可立即运行；
 * `dependency-gated`：与 `all` 相同，但保留语义给后续汇合层区分。
 *
 * ⚠ 本函数只决定首波；后续是否启动依赖轨由运行态回调决定。
 */
export function initiallyDispatchable(plan: WorkPlanInput): WorkTrack[] {
  return plan.tracks.filter((track) => track.dependsOn.length === 0)
}

/** 轨道是否已到终态（不再占用执行槽）。 */
export function isTerminalTrackState(state: WorkTrackState): boolean {
  return state === 'returned' || state === 'failed' || state === 'cancelled'
}

/**
 * **收口前判据**（2026-11-06 · Wave 1）。
 *
 * `closePlan` 原先只看 `plan.state === 'joining'`；而 `joining` 可以从
 * 「轨道都返回」派生 —— 返回 ≠ 验收，且失败/取消轨道也不该被当成可收口。
 * ⇒ 收口前必须同时满足：
 *   ① 每条轨道都在终态（`returned` / `failed` / `cancelled`）；
 *   ② 没有 `failed` 轨道（失败计划只允许标记失败，不允许收成 completed）；
 *   ③ `plan.state === 'joining'`（保持既有入口语义，不绕过推进器）。
 *
 * @returns 不允许收口的原因；空数组 = 可以收口。
 */
export function closePlanProblems(
  plan: WorkPlan,
  states: Record<string, WorkTrackState> = plan.trackStates ?? {},
): string[] {
  const out: string[] = []
  const stateOf = (track: WorkTrack): WorkTrackState => states[track.trackId] ?? 'pending'
  const unsettled = plan.tracks.filter((track) => !isTerminalTrackState(stateOf(track)))
  if (unsettled.length > 0) {
    out.push(`仍有 ${unsettled.length} 条轨道未到终态：${unsettled.map((t) => `${t.trackId}=${stateOf(t)}`).join(' / ')}`)
  }
  const failed = plan.tracks.filter((track) => stateOf(track) === 'failed')
  if (failed.length > 0) {
    out.push(`有 ${failed.length} 条轨道失败：${failed.map((t) => t.trackId).join(' / ')} ⇒ 失败计划不能收成 completed`)
  }
  if (plan.state !== 'joining') {
    out.push(`计划当前是 ${plan.state}，只有 joining 才能收成 completed`)
  }
  return out
}

/** 计划进度：由轨道状态派生，不另存第二份状态。 */
export interface WorkPlanProgress {
  ready: WorkTrack[]
  waiting: WorkTrack[]
  terminal: boolean
  failed: boolean
  nextState: WorkPlanState
}

/**
 * 计算当前可派发轨道与计划下一状态。
 *
 * - 依赖轨只在全部前置 `returned` 后进入 ready；
 * - 前置失败/取消 ⇒ 该轨取消，计划失败；
 * - 只有全部轨道进入终态后才允许 `joining`，不能因为首波已派出就提前汇合。
 */
export function workPlanProgress(
  plan: WorkPlan,
  states: Record<string, WorkTrackState> = plan.trackStates ?? {},
): WorkPlanProgress {
  const stateOf = (track: WorkTrack): WorkTrackState => states[track.trackId] ?? 'pending'
  const failed = plan.tracks.some((track) => stateOf(track) === 'failed')
  const ready: WorkTrack[] = []
  const waiting: WorkTrack[] = []
  for (const track of plan.tracks) {
    const state = stateOf(track)
    if (state !== 'pending') continue
    const deps = track.dependsOn.map((dep) => states[dep] ?? 'pending')
    if (deps.some((dep) => dep === 'failed' || dep === 'cancelled')) {
      waiting.push(track)
      continue
    }
    if (deps.every((dep) => dep === 'returned')) ready.push(track)
    else waiting.push(track)
  }
  const terminal = plan.tracks.every((track) => isTerminalTrackState(stateOf(track)))
  const nextState: WorkPlanState = failed ? 'failed' : terminal ? 'joining' : 'running'
  return { ready, waiting, terminal, failed, nextState }
}


/**
 * 计划的有效档位：新计划用创建时快照，旧计划回落到 `mode`。
 *
 * ⚠ 这个函数是 `WM-8` 的唯一读法；⛔ 不许在别处再写一遍 `modeSnapshot ?? mode`
 *   （两处各写一遍，迟早一处改了另一处没改）。
 */
export function planModeOf(plan: WorkPlan): WorkMode {
  return plan.modeSnapshot ?? plan.mode
}

/**
 * ⚠⚠ **R-21 更正：这里原有一个「按快照复验计划」的函数，但它从来没有函数体。**
 *
 *   改前：这段注释 + `@param` / `@returns` 都在，**下面直接接下一个定义** ——
 *   也就是说，注释描述了一个**不存在**的函数，而 `grep 'export function'` 找不到它。
 *
 *   ⚠ **为什么必须删掉这段注释**（⛔ 不是「补上实现」）：
 *     它宣称「本计划按创建时的快照**推进**」，而**推进侧根本不读快照**：
 *     `advanceWorkPlans()` 调 `orch.dispatch(...)` 时**不传 `workMode`**
 *     （`orchestrator.ts:4534`），于是 `dispatch` 落到 `workModeOf(exec)` **现读当前档位**。
 *     ⇒ 注释说的是「冻结驱动推进」，实际是「冻结只影响显示与 `modeSnapshot` 字段」。
 *
 *   ⚠ **实际的 `modeSnapshot` 语义**（照实说，⛔ 不粉饰）：
 *     · **写**：计划落盘时记下创建时的档位（`orchestrator.ts:4107` / `:4661` 用 {@link planModeOf}）；
 *     · **读**：{@link planModeOf} 是唯一读法（`WM-8f` 守着它）；
 *     · **不驱动**：**推进与派发一律用当前档位**，快照不参与闸门判定。
 *     ⇒ 用户建计划后改档，旧计划的依赖轨接力**会被新档位拦** —— 这是当前的真实行为。
 *
 *   ⛔ **要让它驱动推进，得先回答三个问题**（缺一个都不许动）：
 *     ① 旧计划用旧档位推进时，**新档位的限制还算不算**（比如从多会话降成单会话）？
 *     ② 计划跑到一半改档，**已派出的轨怎么办**（按旧档继续？还是按新档收回）？
 *     ③ 面板该显示哪个档位（当前档？计划档？两个都显示？）
 *   ⚠ 在这些问题有答案之前，「补一个复验函数」只会造出一个**没人调用的死函数** ——
 *     那正是本条要修的形态。
 *
 * @deprecated **不存在这个函数** —— 这段注释保留只为记录「它曾经宣称过什么」。
 *   真要用计划档位，用 {@link planModeOf}。
 */

/**
 * 看护意图（⚠ 与 `PersistedWatchEntry.state` 的 `waiting|awake` 正交）。
 *
 * 只有 {@link GUARD_INTENTS_WAKEABLE} 里的意图允许唤醒；其余一律不叫。
 * 这是把「会话停了就叫」收窄成「任务未完成、没人等用户、也没人在推进」的唯一判据。
 */
export const GUARD_INTENTS = [
  'working',
  'expecting-return',
  'waiting-user',
  'joining',
  'completed',
  'failed',
  'stopped',
  'stale',
  'undecidable',
] as const

export type GuardIntent = (typeof GUARD_INTENTS)[number]

/** 唯一允许唤醒的意图。⚠ 增删这一行等于改产品语义，必须同时改判据与验收。 */
export const GUARD_INTENTS_WAKEABLE: readonly GuardIntent[] = ['expecting-return']

/** 计划层面的看护事实（由计划文件派生，⛔ 不从模型自述里取）。 */
export interface PlanGuardFacts {
  /** 计划是否仍活动（`planned|running|joining|failed`）。 */
  active: boolean
  /** 计划状态原值。 */
  state: string
  /** 未结算轨道数（`pending|running`）。 */
  unsettled: number
  /** 全部轨道是否已终态。 */
  terminal: boolean
  /** 是否有轨道失败。 */
  failed: boolean
}

/**
 * 从一份计划派生看护事实。
 *
 * ⚠ `joining` 也算「全部返回」：进入汇合后不再需要看护去催执行。
 */
export function planGuardFactsOf(plan: WorkPlan, states: Record<string, WorkTrackState> = plan.trackStates ?? {}): PlanGuardFacts {
  const stateOf = (track: WorkTrack): WorkTrackState => states[track.trackId] ?? 'pending'
  const unsettled = plan.tracks.filter((track) => !isTerminalTrackState(stateOf(track))).length
  const terminal = plan.tracks.every((track) => isTerminalTrackState(stateOf(track)))
  const failed = plan.tracks.some((track) => stateOf(track) === 'failed')
  return {
    active: plan.state === 'planned' || plan.state === 'running' || plan.state === 'joining' || plan.state === 'failed',
    state: plan.state,
    unsettled,
    terminal,
    failed,
  }
}

/**
 * 由「计划事实 + 用户是否停止 + 是否有待决问题」派生看护意图。
 *
 * ⚠ 顺序即优先级（改顺序 = 改安全语义）：
 *   ① 用户停止 ⇒ `stopped`（最强，跨重启也生效）；
 *   ② 无活动计划 ⇒ `stale`；
 *   ③ 有待决问题 ⇒ `waiting-user`；
 *   ④ 全部终态 / 汇合 / 完成 ⇒ `joining|completed|failed`；
 *   ⑤ 仍有未结算轨道 ⇒ `expecting-return`；
 *   ⑥ 其余 ⇒ `undecidable`（⛔ 不猜成「可以叫」）。
 */
export function guardIntentOf(input: {
  stopped: boolean
  plan?: PlanGuardFacts | undefined
  awaitingUser?: boolean
  working?: boolean
}): GuardIntent {
  if (input.stopped) return 'stopped'
  const plan = input.plan
  /**
   * ⚠ 只有**没有计划**才是 `stale`。
   *   `completed` / `failed` 的计划仍然存在，必须分别落 `completed` / `failed`，
   *   ⛔ 不能因为"它不再活动"就笼统归成 `stale` —— 那会让读数面说不出真实结局。
   */
  if (plan === undefined) return 'stale'
  if (input.awaitingUser === true) return 'waiting-user'
  if (input.working === true) return 'working'
  if (plan.state === 'completed') return 'completed'
  if (plan.state === 'failed' || plan.failed) return 'failed'
  if (plan.state === 'joining' || plan.terminal) return 'joining'
  if (plan.unsettled > 0) return 'expecting-return'
  return 'undecidable'
}

/** 意图是否允许唤醒。 */
export function guardIntentAllowsWake(intent: GuardIntent): boolean {
  return GUARD_INTENTS_WAKEABLE.includes(intent)
}

/**
 * **由计划派生看护意图**（供编排器与读数面共用，⛔ 不各写一份）。
 *
 * @param plans - 该 owner 的活动计划（通常只有一份；多份时取「最需要推进」的那份）
 * @param stopped - 用户是否已 `stop`
 * @param awaitingUser - 是否正在等用户（active 用户问题 / `clarifyAt`）
 */
export function guardIntentForOwner(input: {
  plans: readonly WorkPlan[]
  stopped: boolean
  awaitingUser?: boolean
  working?: boolean
}): { intent: GuardIntent; plan?: WorkPlan; facts?: PlanGuardFacts } {
  if (input.stopped) return { intent: 'stopped' }
  if (input.plans.length === 0) return { intent: 'stale' }
  /**
   * ⚠ 多份计划时的优先级：先看有没有仍在等回传的（最需要推进），
   *   再看有没有汇合/失败的，最后才是全部完成。
   *   ⚠ 不按 planId 排序挑：那会让"哪份被催"取决于命名。
   */
  const ranked = input.plans.map((plan) => {
    const facts = planGuardFactsOf(plan)
    return {
      plan,
      facts,
      intent: guardIntentOf({
        stopped: false,
        plan: facts,
        awaitingUser: input.awaitingUser,
        working: input.working,
      }),
    }
  })
  const order: readonly GuardIntent[] = ['working', 'expecting-return', 'joining', 'failed', 'completed', 'undecidable']
  for (const wanted of order) {
    const hit = ranked.find((row) => row.intent === wanted)
    if (hit !== undefined) {
      return {
        intent: guardIntentOf({
          stopped: false,
          plan: hit.facts,
          awaitingUser: input.awaitingUser,
          working: input.working,
        }),
        plan: hit.plan,
        facts: hit.facts,
      }
    }
  }
  const first = ranked[0]!
  return { intent: first.intent, plan: first.plan, facts: first.facts }
}
