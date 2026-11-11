/**
 * Ledger lifecycle and work admission — the single pure decision face.
 *
 * This module answers three questions in one place:
 *   1. Is there an active, internally consistent ledger?
 *   2. May this action advance the current pipeline?
 *   3. Can a dispatch be bound to a task, a RUN and a persistent watch?
 *
 * It deliberately performs no I/O. Callers provide a probe, and the same result
 * is consumed by tools, the orchestrator, panels and checks.
 */

export const LEDGER_LIFECYCLE_VERSION = 'v1'
export const LEDGER_SCHEMA_VERSION = 'pipeline-v3'
export const LEDGER_INSTANCE_STATUSES = ['provisioning', 'active', 'invalid', 'archived'] as const
export type LedgerInstanceStatus = (typeof LEDGER_INSTANCE_STATUSES)[number]

export type LedgerInstanceState =
  /** No ledger directory / index at all. Initialisation is the only work action. */
  | 'missing'
  | 'provisioning'
  | 'active'
  | 'invalid'
  | 'archived'
  | 'unresolved'

export interface LedgerActivation {
  ledger_id: string
  schema_version: string
  status: LedgerInstanceStatus
  workspace: string
  generation: string
  predecessor?: string
  created_at: string
}

export interface LedgerLifecycleProbe {
  /** Absolute ledger root; undefined when it cannot be resolved. */
  ledgerRoot?: string
  rootWhy?: string
  unitsDirExists: boolean
  indexText?: string
  shardTexts?: readonly string[]
  readError?: string
  /** `ledger.toml` text; undefined means absent. */
  activationText?: string
  activationReadError?: string
}

export interface LedgerLifecycle {
  state: LedgerInstanceState
  /** Structural validity of the ledger content. */
  integrity: 'valid' | 'invalid' | 'empty' | 'undecidable'
  /** Whether the ledger can be used as the current ledger for work. */
  active: boolean
  /** New-format ledgers carry an activation record; legacy ones do not. */
  activation: 'active' | 'provisioning' | 'missing' | 'invalid' | 'archived'
  headline: string
  nextAction: string
  blockers: Array<{ rule: string; unit: string; why: string }>
  detail?: string
  /** True only for pre-activation ledgers accepted through the compatibility path. */
  legacyCompatible: boolean
  ledgerId?: string
  generation?: string
}

const text = (v: unknown): string => typeof v === 'string' ? v.trim() : ''
/** Small parser for ledger.toml: key = "value" at top level, no nested tables. */
export function parseLedgerActivation(src: string): LedgerActivation | undefined {
  const out: Record<string, string> = {}
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    if (line.startsWith('[')) return undefined
    const m = /^([A-Za-z0-9_.-]+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(line)
    if (m === null) return undefined
    out[m[1]!] = m[2]!.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  if (text(out.ledger_id) === '' || text(out.schema_version) === '' || text(out.status) === ''
    || text(out.workspace) === '' || text(out.generation) === '' || text(out.created_at) === '') return undefined
  if (!(LEDGER_INSTANCE_STATUSES as readonly string[]).includes(text(out.status))) return undefined
  if (!/^\d+$/.test(text(out.generation)) || Number(out.generation) <= 0) return undefined
  if (!Number.isFinite(Date.parse(text(out.created_at)))) return undefined
  return {
    ledger_id: text(out.ledger_id),
    schema_version: text(out.schema_version),
    status: text(out.status) as LedgerInstanceStatus,
    workspace: text(out.workspace),
    generation: text(out.generation),
    ...(text(out.predecessor) === '' ? {} : { predecessor: text(out.predecessor) }),
    created_at: text(out.created_at),
  }
}

/**
 * Build the single lifecycle verdict from a probe and the existing ledger
 * validity assessment. The caller supplies `readiness` so this module does not
 * duplicate the v3 stage semantics.
 */
export function assessLedgerLifecycle(
  probe: LedgerLifecycleProbe,
  readiness: { state: string; canProceed: boolean; headline: string; gaps?: Array<{ rule: string; unit: string; why: string }>; detail?: string },
): LedgerLifecycle {
  const root = text(probe.ledgerRoot)
  if (root === '') {
    return {
      state: 'unresolved', integrity: 'undecidable', active: false, activation: 'missing',
      headline: '账本落点判不出 ⇒ 不知道该用哪一本', nextAction: '先确认会话工作区根，再重试。',
      blockers: [], legacyCompatible: false, ...(probe.rootWhy === undefined ? {} : { detail: probe.rootWhy }),
    }
  }
  if (probe.activationReadError !== undefined) {
    return {
      state: 'invalid', integrity: 'invalid', active: false, activation: 'invalid',
      headline: '账本激活记录读不出来', nextAction: '先恢复 ledger.toml；无法恢复则归档旧账并重新建账。',
      blockers: [{ rule: 'A-1', unit: 'ledger.toml', why: probe.activationReadError }], legacyCompatible: false,
    }
  }
  const hasActivation = probe.activationText !== undefined
  const activation = hasActivation ? parseLedgerActivation(probe.activationText!) : undefined
  if (hasActivation && activation === undefined) {
    return {
      state: 'invalid', integrity: 'invalid', active: false, activation: 'invalid',
      headline: '账本激活记录格式不合法', nextAction: '修复或替换 ledger.toml；旧账本只能作为历史证据。',
      blockers: [{ rule: 'A-1', unit: 'ledger.toml', why: '必须包含 ledger_id / schema_version / status / workspace / generation / created_at' }],
      legacyCompatible: false,
    }
  }
  if (activation !== undefined && activation.status === 'archived') {
    return {
      state: 'archived', integrity: 'undecidable', active: false, activation: 'archived',
      headline: '这本账已归档，不是当前账本', nextAction: '只读历史；推进请启用或新建当前账本。',
      blockers: [], legacyCompatible: false, ledgerId: activation.ledger_id, generation: activation.generation,
    }
  }
  if (activation !== undefined && activation.schema_version !== LEDGER_SCHEMA_VERSION) {
    return {
      state: 'invalid', integrity: 'invalid', active: false, activation: 'invalid',
      headline: `账本模式版本不是 ${LEDGER_SCHEMA_VERSION}`, nextAction: '归档旧账并在模板起手的新账本上重走需求。',
      blockers: [{ rule: 'A-2', unit: 'ledger.toml', why: `schema_version=${activation.schema_version}` }],
      legacyCompatible: false, ledgerId: activation.ledger_id, generation: activation.generation,
    }
  }
  if (activation !== undefined && activation.status !== 'active') {
    return {
      state: activation.status === 'invalid' ? 'invalid' : 'provisioning',
      integrity: activation.status === 'invalid' ? 'invalid' : 'undecidable',
      active: false, activation: activation.status as 'provisioning' | 'invalid' | 'active',
      headline: activation.status === 'invalid' ? '账本被标记为失效' : '账本尚未完成启用',
      nextAction: activation.status === 'invalid' ? '归档旧账并重新建账。' : '完成模板落盘与激活记录。',
      blockers: [], legacyCompatible: false, ledgerId: activation.ledger_id, generation: activation.generation,
    }
  }
  if (!probe.unitsDirExists) {
    return {
      state: 'missing', integrity: 'empty', active: false, activation: hasActivation ? 'invalid' : 'missing',
      headline: '这个项目还没有账本', nextAction: '先按模板建账本（hob_ledger_init），再落需求。',
      blockers: [], legacyCompatible: false,
    }
  }
  if (probe.readError !== undefined) {
    return {
      state: 'invalid', integrity: 'undecidable', active: false, activation: activation?.status ?? 'missing',
      headline: '账本读不出来', nextAction: '先修复读取权限或损坏文件；不要用绕过门禁的方式继续派活。',
      blockers: [{ rule: 'A-3', unit: 'ledger', why: probe.readError }],
      legacyCompatible: false, ...(activation === undefined ? {} : { ledgerId: activation.ledger_id, generation: activation.generation }),
    }
  }
  const readinessState = text(readiness.state)
  if (readinessState === 'empty') {
    return {
      state: activation === undefined ? 'missing' : 'active', integrity: 'empty', active: false,
      activation: activation === undefined ? 'missing' : 'active',
      headline: '账本已建，但还没有需求', nextAction: '先落第一条需求（R-xxx），再请求 G1 确认。',
      blockers: [], legacyCompatible: activation === undefined,
      ...(activation === undefined ? {} : { ledgerId: activation.ledger_id, generation: activation.generation }),
    }
  }
  /** An existing empty units dir with no index is initialisable, not corrupt. */
  if (readinessState === 'unhealthy' && (readiness as { reason?: string }).reason === 'index-missing') {
    return {
      state: 'missing', integrity: 'empty', active: false,
      activation: activation === undefined ? 'missing' : 'active',
      headline: '账本目录在，但缺入口索引', nextAction: '按模板补齐入口索引与 PROJECT.md，再落第一条需求。',
      blockers: [], legacyCompatible: activation === undefined,
      ...(activation === undefined ? {} : { ledgerId: activation.ledger_id, generation: activation.generation }),
    }
  }
  if (readinessState !== 'ready' || readiness.canProceed !== true) {
    return {
      state: 'invalid', integrity: readinessState === 'legacy' ? 'invalid' : 'invalid', active: false,
      activation: activation === undefined ? 'missing' : 'active',
      headline: readiness.headline, nextAction: '这本账不能作为当前账本继续推进；归档旧账并重新建账，或恢复到一个可验证的快照。',
      blockers: readiness.gaps ?? [],
      legacyCompatible: false,
      ...(readiness.detail === undefined ? {} : { detail: readiness.detail }),
      ...(activation === undefined ? {} : { ledgerId: activation.ledger_id, generation: activation.generation }),
    }
  }
  return {
    state: 'active', integrity: 'valid', active: true,
    activation: activation === undefined ? 'missing' : 'active',
    headline: activation === undefined ? '账本就绪（兼容模式：尚无 ledger.toml）' : '账本已激活且结构有效',
    nextAction: '', blockers: [], legacyCompatible: activation === undefined,
    ...(activation === undefined ? {} : { ledgerId: activation.ledger_id, generation: activation.generation }),
  }
}

/**
 * Probe the ledger root without changing it. This is the only adapter used by
 * tools and the orchestrator; callers then pass the result to the pure
 * `assessLedgerLifecycle` below.
 */
export interface LedgerLifecycleMeter {
  listUnitsDir: () => string[]
  readText: (abs: string) => string | undefined
  join: (root: string, rel: string) => string
}

export function probeLedgerLifecycle(
  ledgerRoot: string | undefined,
  meter: LedgerLifecycleMeter,
  opts: { rootWhy?: string } = {},
): LedgerLifecycleProbe {
  if (ledgerRoot === undefined || ledgerRoot.trim() === '') {
    return { unitsDirExists: false, ...(opts.rootWhy === undefined ? {} : { rootWhy: opts.rootWhy }) }
  }
  const root = ledgerRoot.trim()
  const activationPath = meter.join(root, 'ledger.toml')
  let activationText: string | undefined
  let activationReadError: string | undefined
  try { activationText = meter.readText(activationPath) } catch (e) { activationReadError = String((e as Error)?.message ?? e) }
  const unitsDir = meter.join(root, 'ledger/units')
  let names: string[]
  try { names = meter.listUnitsDir() } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') return { ledgerRoot: root, unitsDirExists: false, ...(activationText === undefined ? {} : { activationText }), ...(activationReadError === undefined ? {} : { activationReadError }) }
    return { ledgerRoot: root, unitsDirExists: true, readError: `${unitsDir}: ${String((e as Error)?.message ?? e)}`, ...(activationText === undefined ? {} : { activationText }), ...(activationReadError === undefined ? {} : { activationReadError }) }
  }
  const shardNames = names.filter((n) => /^unit-[^/]+\.toml$/.test(n)).sort()
  let indexText: string | undefined
  try { indexText = meter.readText(meter.join(root, 'ledger/units/index.toml')) } catch (e) {
    return { ledgerRoot: root, unitsDirExists: true, readError: String((e as Error)?.message ?? e), ...(activationText === undefined ? {} : { activationText }), ...(activationReadError === undefined ? {} : { activationReadError }) }
  }
  const shardTexts: string[] = []
  for (const n of shardNames) {
    try {
      const t = meter.readText(meter.join(root, `ledger/units/${n}`))
      if (t === undefined) return { ledgerRoot: root, unitsDirExists: true, indexText, readError: `分片不存在：${n}`, ...(activationText === undefined ? {} : { activationText }), ...(activationReadError === undefined ? {} : { activationReadError }) }
      shardTexts.push(t)
    } catch (e) {
      return { ledgerRoot: root, unitsDirExists: true, indexText, readError: String((e as Error)?.message ?? e), ...(activationText === undefined ? {} : { activationText }), ...(activationReadError === undefined ? {} : { activationReadError }) }
    }
  }
  return {
    ledgerRoot: root, unitsDirExists: true,
    ...(indexText === undefined ? {} : { indexText }), ...(shardTexts.length === 0 ? {} : { shardTexts }),
    ...(activationText === undefined ? {} : { activationText }), ...(activationReadError === undefined ? {} : { activationReadError }),
  }
}

/**
 * Detect conflicting structured authority. `index.toml` and `unit-*.toml`
 * together form one structured set; a body-only unit is valid. Only the same
 * ID appearing in both sources with different state is a split-authority error.
 */
export interface StructuredUnitLike { id?: string; kind?: string; status?: string; parent?: string; title?: string }
export function indexIntegrityProblems(
  indexUnits: ReadonlyArray<StructuredUnitLike>,
  shardUnits: ReadonlyArray<StructuredUnitLike>,
): Array<{ rule: string; unit: string; why: string }> {
  const out: Array<{ rule: string; unit: string; why: string }> = []
  const indexById = new Map<string, StructuredUnitLike>()
  for (const u of indexUnits) {
    const id = text(u.id)
    if (id === '') continue
    if (indexById.has(id)) out.push({ rule: 'A-4', unit: id, why: '入口索引内出现重复 ID' })
    indexById.set(id, u)
  }
  const seenShard = new Set<string>()
  for (const u of shardUnits) {
    const id = text(u.id)
    if (id === '') continue
    if (seenShard.has(id)) out.push({ rule: 'A-4', unit: id, why: '结构化分片内出现重复 ID' })
    seenShard.add(id)
    const idx = indexById.get(id)
    if (idx === undefined) continue
    for (const key of ['kind', 'status', 'parent', 'title'] as const) {
      if (text(idx[key]) !== text(u[key])) {
        out.push({ rule: 'A-4', unit: id, why: `索引与分片对 ${key} 不一致：${text(idx[key]) || '(空)'} / ${text(u[key]) || '(空)'}` })
        break
      }
    }
  }
  return out
}

/** A freshly initialised v3 ledger must have an explicit activation record. */
export function initialLedgerActivation(input: {
  ledgerId: string
  workspace: string
  generation?: string
  predecessor?: string
  createdAt: string
}): string {
  return [
    '# Ledger activation record. Only one active ledger per workspace.',
    `ledger_id = ${JSON.stringify(input.ledgerId)}`,
    `schema_version = ${JSON.stringify(LEDGER_SCHEMA_VERSION)}`,
    'status = "active"',
    `workspace = ${JSON.stringify(input.workspace)}`,
    `generation = ${JSON.stringify(input.generation ?? '1')}`,
    ...(input.predecessor === undefined || input.predecessor === '' ? [] : [`predecessor = ${JSON.stringify(input.predecessor)}`]),
    `created_at = ${JSON.stringify(input.createdAt)}`,
    '',
  ].join('\n')
}

/**
 * The one work-admission table. `action` is intentionally closed; adding a new
 * work primitive requires adding a row here, not a second gate elsewhere.
 */
export const WORK_ACTIONS = [
  'initialize-ledger',
  'write-requirement',
  'write-plan',
  'write-task',
  'dispatch',
  'notify',
  'verify',
  'accept',
  'close',
] as const
export type WorkAction = (typeof WORK_ACTIONS)[number]

export interface WorkAdmissionInput {
  action: WorkAction
  lifecycle: LedgerLifecycle
  /** A real task id is mandatory for dispatch. */
  taskId?: string
  /** Task status from the active ledger, when the caller has it. */
  taskStatus?: string
  /** Whether a current task chain exists. */
  taskExists?: boolean
  /** Whether the task chain passed the existing stage gate. */
  taskGatePassed?: boolean
  /** Existing unresolved watch/RUN for the same target. */
  hasUnsettledDispatch?: boolean
  /** Target preset gate result. */
  targetAdmitted?: boolean
  /** For notify: whether the target is an implementation session that could run work. */
  notificationOnly?: boolean
}

export interface WorkAdmission {
  ok: boolean
  action: WorkAction
  reason?: string
  blockers: string[]
  /** Callers must not create sessions, deliver messages or write RUNs when false. */
  sideEffectsAllowed: boolean
}

const reject = (action: WorkAction, reason: string, blockers: string[] = []): WorkAdmission => ({
  ok: false, action, reason, blockers, sideEffectsAllowed: false,
})

/**
 * Pure admission decision. No caller may bypass it with a prompt-level rule.
 */
export function admitWork(input: WorkAdmissionInput): WorkAdmission {
  const { action, lifecycle } = input
  if (action === 'initialize-ledger') {
    return lifecycle.state === 'missing' || lifecycle.state === 'invalid'
      ? { ok: true, action, blockers: [], sideEffectsAllowed: true }
      : reject(action, '当前已有可用或已激活的账本 ⇒ 不允许用初始化覆盖；请先归档旧账或选择恢复。')
  }
  if (lifecycle.state === 'missing') return reject(action, '没有当前账本 ⇒ 先按模板初始化，不能推进任何工作。')
  if (lifecycle.state === 'unresolved') return reject(action, '账本落点判不出 ⇒ 不能推进任何工作。')
  if (lifecycle.state === 'archived') return reject(action, '这本账已归档，不是当前账本 ⇒ 只能只读追溯。')
  if (lifecycle.state === 'provisioning') return reject(action, '账本尚未完成启用 ⇒ 先完成模板落盘与激活，再推进。')
  if (lifecycle.state === 'invalid' || !lifecycle.active) {
    return reject(action, `账本不是当前可用账本：${lifecycle.headline} ⇒ ${lifecycle.nextAction}`,
      lifecycle.blockers.map((b) => `${b.rule} · ${b.unit} · ${b.why}`))
  }
  if (action === 'notify') {
    if (input.notificationOnly !== true) {
      return reject(action, '通知通道不能承载实质工作；要产出并回传必须走 hob_dispatch 并绑定真实任务。')
    }
    return { ok: true, action, blockers: [], sideEffectsAllowed: true }
  }
  if (action === 'dispatch') {
    const blockers: string[] = []
    if (text(input.taskId) === '' || input.taskId === 'implicit') blockers.push('派发必须给真实 taskId（形如 TSK-…）')
    if (input.taskExists !== true) blockers.push('taskId 不是当前账本里的真实任务')
    if (input.taskGatePassed !== true) blockers.push('任务链未通过阶段门禁 / 需求或方案未获用户批准')
    if (text(input.taskStatus) !== 'todo') blockers.push(`任务当前状态是 ${text(input.taskStatus) || '(空)'}，只有 todo 可以派发`)
    if (input.hasUnsettledDispatch === true) blockers.push('同一目标已有未结算派发')
    if (input.targetAdmitted === false) blockers.push('目标会话预设未通过校验')
    if (blockers.length > 0) return reject(action, blockers[0]!, blockers)
    return { ok: true, action, blockers: [], sideEffectsAllowed: true }
  }
  if (action === 'write-requirement') return { ok: true, action, blockers: [], sideEffectsAllowed: true }
  if (action === 'write-plan' || action === 'write-task') {
    return input.taskGatePassed === true
      ? { ok: true, action, blockers: [], sideEffectsAllowed: true }
      : reject(action, '上游阶段未成立 ⇒ 先完成并确认需求/方案，再写下一阶段。')
  }
  if (action === 'verify' || action === 'accept' || action === 'close') {
    return input.taskGatePassed === true
      ? { ok: true, action, blockers: [], sideEffectsAllowed: true }
      : reject(action, '上游执行事实或验证前置未成立 ⇒ 不能跳到该阶段。')
  }
  return reject(action, '未知工作动作')
}

/** Stable identity of one dispatch. `at` is explicit so retries are idempotent. */
export interface DispatchIdentity {
  dispatchId: string
  runId?: string
  taskId: string
  owner: string
  target: string
  requestedTarget: string
  targetChanged: boolean
  at: number
}

export function dispatchIdOf(input: { owner: string; target: string; taskId: string; at: number }): string {
  const safe = (v: string): string => v.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80)
  return `DSP-${safe(input.taskId)}-${safe(input.target)}-${input.at}`
}

export function makeDispatchIdentity(input: {
  owner: string
  requestedTarget: string
  target: string
  taskId: string
  at: number
  runId?: string
}): DispatchIdentity {
  return {
    dispatchId: dispatchIdOf(input),
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    taskId: input.taskId,
    owner: input.owner,
    target: input.target,
    requestedTarget: input.requestedTarget,
    targetChanged: input.requestedTarget !== input.target,
    at: input.at,
  }
}

/** A completion without a matching dispatch is an orphan, never a receipt. */
export function isOrphanCompletion(knownDispatchId: string | undefined, completionDispatchId: string | undefined): boolean {
  return text(completionDispatchId) === '' || knownDispatchId === undefined || text(knownDispatchId) !== text(completionDispatchId)
}

/** Manifest describing an archived ledger generation. */
export interface LedgerArchiveManifest {
  ledger_id: string
  workspace: string
  generation: string
  archived_at: string
  reason: string
  source_digest: string
  source_bytes: number
  source_files: number
  next_generation: string
}

export function nextGenerationOf(raw: string | undefined): string {
  const n = Number(text(raw))
  return String(Number.isSafeInteger(n) && n > 0 ? n + 1 : 1)
}

export function renderLedgerArchiveManifest(m: LedgerArchiveManifest): string {
  return [
    '# Ledger archive manifest',
    `ledger_id = ${JSON.stringify(m.ledger_id)}`,
    `workspace = ${JSON.stringify(m.workspace)}`,
    `generation = ${JSON.stringify(m.generation)}`,
    `archived_at = ${JSON.stringify(m.archived_at)}`,
    `reason = ${JSON.stringify(m.reason)}`,
    `source_digest = ${JSON.stringify(m.source_digest)}`,
    `source_bytes = ${JSON.stringify(String(m.source_bytes))}`,
    `source_files = ${JSON.stringify(String(m.source_files))}`,
    `next_generation = ${JSON.stringify(m.next_generation)}`,
    '',
  ].join('\n')
}

/** Minimal, non-fabricated starter documents for a newly provisioned ledger. */
export function initialContextMd(workspaceName: string): string {
  return [
    `# ${workspaceName} · 当前工作上下文`,
    '',
    '> 本文件由 `hob_ledger_init` 起手，**尚未填写项目内容**。',
    '',
    '## 一、当前阶段',
    '',
    '（待填：当前在推进什么、下一步等谁）',
    '',
    '## 二、仍欠事项',
    '',
    '（待填：还没有完成或验证的事项）',
    '',
  ].join('\n')
}

export function initialDecisionsMd(workspaceName: string): string {
  return [
    `# ${workspaceName} · 方案变更记录`,
    '',
    '> 本文件由 `hob_ledger_init` 起手，**尚未填写项目内容**。',
    '> ⚠ 只有用户能批准变更，Hob 只提议。',
    '',
    '## 当前方案',
    '',
    '（待填：方案编号、状态与正文位置）',
    '',
  ].join('\n')
}

export function initialTemplateManifest(input: { createdAt: string; workspace: string }): string {
  return [
    '# Ledger provisioning manifest',
    `template_version = ${JSON.stringify(LEDGER_LIFECYCLE_VERSION)}`,
    `schema_version = ${JSON.stringify(LEDGER_SCHEMA_VERSION)}`,
    `workspace = ${JSON.stringify(input.workspace)}`,
    `created_at = ${JSON.stringify(input.createdAt)}`,
    'source = "built-in empty starters; kit/templates is the human editing reference"',
    'required = ["ledger.toml", "ledger/units/index.toml", "PROJECT.md"]',
    'optional = ["REQUIREMENTS.md", "CONTEXT.md", "DECISIONS.md"]',
    '',
  ].join('\n')
}
