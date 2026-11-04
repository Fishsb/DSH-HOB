/**
 * Hob 工作计划（WorkPlan）的唯一形状与确定性判定。
 *
 * ── 它管什么 ──────────────────────────────────────────────────────────────
 *   把「工作方式」从一段提示词变成可检查的派单计划：
 *   · 单会话：同一计划只允许一条执行轨；
 *   · 多会话：只有范围互斥、依赖可满足、验收独立的轨道才允许并行；
 *   · 自动：计划必须留下为什么选择一条或多条轨道的依据。
 *
 * ⚠ 本文件是**纯函数**：不读文件、不读配置、不建会话、不投递。
 *   持久运行态、唤醒与派生状态仍归 `server/orch-state.ts` 与编排器所有。
 *
 * ⚠ 本文件**不扩大任何权限**。轨道只描述「派给哪个已存在的执行会话」，
 *   不改变该会话的可读范围、工具面或审批档。
 */
import type { WorkMode } from './work-mode.ts'

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
}

/**
 * 证据文本归一：全半角折叠（NFKC）、去掉不可见字符与 NUL、去掉首尾空白。
 *
 * ⚠ 为什么要去不可见字符：`"p1"` 与 `"p1\u200B"` 在 `Set` 里是两个键，
 *   于是"同一个片段写两遍"就能凑出"两个片段" —— 那是伪造证据，不是证据。
 */
/**
 * 不可见/可忽略字符：用 Unicode 的 `Default_Ignorable_Code_Point`，**不手写区间**。
 *
 * ⚠ 手写 `\u200B-\u200F` 这类区间只能盖住常见几种（实测只覆盖 4174 个
 *   `Default_Ignorable` 里的 27 个）：软连字符 U+00AD、组合用字符 U+034F、
 *   阿拉伯字母标记 U+061C、蒙古文元音分隔符 U+180E、变体选择符 U+FE0F 等
 *   都能让"同一段文字"在 `Set` 里变成两个键 ⇒ 伪造出"两个片段/两个步骤"。
 */
const EVIDENCE_INVISIBLE = /[\p{Default_Ignorable_Code_Point}\u0000-\u001F\u007F-\u009F]/gu

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

  if (input.mode === 'single' && input.tracks.length !== 1) {
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
  const oneTrackNeedsReason = (input.mode === 'multi' || input.mode === 'auto')
    && input.tracks.length === 1
  if (oneTrackNeedsReason) {
    if (input.singleTrackReason === undefined) {
      push('multi-mode-one-track-reason',
        `${input.mode === 'auto' ? '自动' : '多会话'}档只有一条轨道时必须给出封闭原因（这是判路依据，不是可选备注）`)
    } else if (!(MULTI_SINGLE_TRACK_REASONS as readonly string[]).includes(input.singleTrackReason)) {
      push('multi-mode-one-track-reason', `单轨原因不在封闭集内：${input.singleTrackReason}`)
    } else if (input.singleTrackReason === 'same-file') {
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
    } else if (input.singleTrackReason === 'strict-order') {
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
    }
  }
  if (input.mode === 'single' && input.singleTrackReason !== undefined) {
    push('multi-mode-one-track-reason', '单会话档的单轨是设定本身，不接受单轨原因字段')
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

/** 计划是否声明「同一时刻只有一条轨在跑」（单轨，或写轨串行链）。 */
export function isSerializedPlan(plan: WorkPlan): boolean {
  return plan.serialized !== undefined
}

/**
 * 用**计划自己的档位快照**复验计划（`WM-8`）。
 *
 * ⚠ 计划落盘后会话再改档位，只影响**下一份**计划；本计划按创建时的快照推进。
 *   这条判据放在纯函数里，是为了让「冻结」可以被单独证明，而不是靠"没改代码"。
 *
 * @param plan - 已落盘的计划（可带规范化后的串行化依据）。
 * @returns 按快照复验的结果；旧计划缺快照时用 `mode`。
 */
