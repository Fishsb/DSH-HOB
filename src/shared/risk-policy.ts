/**
 * Risk policy for Pipeline v3.
 *
 * This module is the single, pure source for:
 *   - closed risk tiers and hard triggers;
 *   - the ten non-hard-trigger dimensions;
 *   - intrinsic risk tier derivation;
 *   - required gate depth and delivery-closure mode;
 *   - residual-risk acceptance checks.
 *
 * The policy deliberately does not average away a severe dimension. Hard
 * triggers, dimension floors and the weighted score are combined with `max`.
 * A model may describe facts, but it cannot silently lower the resulting tier.
 */

export const RISK_POLICY_VERSION = 'v1'

export const RISK_TIERS = ['low', 'medium', 'high', 'critical'] as const
export type RiskTier = (typeof RISK_TIERS)[number]

export const RISK_HARD_TRIGGERS = [
  'irreversible-data-change',
  'permission-boundary-change',
  'identity-or-secret-boundary',
  'external-side-effect',
  'cross-project-or-instance-effect',
  'unrecoverable-publish',
  'business-sequence-change',
  'high-value-operation',
  'regulatory-or-compliance',
  'security-boundary',
  'history-destruction',
] as const
export type RiskHardTrigger = (typeof RISK_HARD_TRIGGERS)[number]

/**
 * Every hard trigger must be explained by the same six fields. A bare trigger
 * name is not evidence that the fact was examined; it is only a label.
 */
export const RISK_HARD_TRIGGER_FACT_FIELDS = [
  'trigger', 'fact', 'affected', 'evidence', 'mitigation', 'residual',
] as const

export interface RiskHardTriggerFact {
  trigger: RiskHardTrigger
  fact: string
  affected: string
  evidence: string
  mitigation: string
  residual: string
  raw: string
}

export const CLOSURE_MODES = ['skipped', 'standard', 'strict'] as const
export type ClosureMode = (typeof CLOSURE_MODES)[number]

export const DELIVERY_SCOPES = ['none', 'internal', 'external'] as const
export type DeliveryScope = (typeof DELIVERY_SCOPES)[number]

export const RISK_OBJECT_CATEGORIES = ['data', 'permission', 'security', 'compatibility', 'delivery', 'operational', 'product'] as const
export const RISK_LIKELIHOODS = ['rare', 'unlikely', 'possible', 'likely', 'almost-certain'] as const
export const RISK_IMPACTS = ['minor', 'moderate', 'major', 'critical'] as const
export const RISK_DETECTABILITY = ['automatic', 'monitored', 'manual', 'latent'] as const
export const RISK_REVERSIBILITY = ['easy', 'costly', 'hard', 'irreversible'] as const
export const RISK_OBJECT_STATUSES = ['open', 'handling', 'closed'] as const

export const RISK_DIMENSIONS = {
  scope: ['local', 'module', 'system', 'external'],
  severity: ['negligible', 'minor', 'major', 'critical'],
  reversibility: ['easy', 'costly', 'hard', 'irreversible'],
  detectability: ['automatic', 'monitored', 'manual', 'latent'],
  uncertainty: ['known', 'bounded', 'unknown'],
  changeSurface: ['one-point', 'few-files', 'cross-component', 'cross-system'],
  dependencies: ['independent', 'internal-deps', 'external-deps'],
  verificationMaturity: ['proven', 'established', 'experimental'],
  recoveryTime: ['minutes', 'hours', 'days', 'unknown'],
  exposure: ['internal', 'limited', 'public'],
} as const

export type RiskDimensionKey = keyof typeof RISK_DIMENSIONS
export type RiskDimensions = Partial<Record<RiskDimensionKey, string>>

export interface RiskFacts {
  hardTriggers?: readonly string[]
  hardTriggerFacts?: readonly string[]
  dimensions?: RiskDimensions
  delivery?: DeliveryScope
  /** Optional declared value; it is checked, never trusted over derivation. */
  declaredTier?: string
  /** Optional declared delivery mode; it is checked against derivation. */
  declaredClosure?: string
  riskBindingVersion?: string
  riskAssessmentRef?: string
  residualTier?: string
  residualAcceptedBy?: string
  residualAcceptedAt?: string
  residualConditions?: readonly string[]
}

export interface RiskAssessment {
  ruleVersion: string
  tier: RiskTier
  nonHardTier: RiskTier
  score: number
  hardTriggers: RiskHardTrigger[]
  hardTriggerFacts: RiskHardTriggerFact[]
  dimensionScores: Record<string, number>
  dimensionValues: RiskDimensions
  dimensionFloor: RiskTier
  hardFloor: RiskTier
  hardContextFloor: RiskTier
  delivery: DeliveryScope
  closure: ClosureMode
  needsIndependentReview: boolean
  needsDualReview: boolean
  needsUserAcceptance: boolean
  needsResidualAcceptance: boolean
  reasons: string[]
  inputsDigest: string
}

export interface RiskPolicyProblem {
  rule: string
  unit: string
  why: string
}

const TIER_RANK: Readonly<Record<RiskTier, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
}

const text = (v: unknown): string => typeof v === 'string' ? v.trim() : ''
const list = (v: unknown): string[] => Array.isArray(v)
  ? v.map(String).map((x) => x.trim()).filter((x) => x !== '')
  : []

export function isRiskTier(v: unknown): v is RiskTier {
  return (RISK_TIERS as readonly string[]).includes(text(v))
}

export function isHardTrigger(v: unknown): v is RiskHardTrigger {
  return (RISK_HARD_TRIGGERS as readonly string[]).includes(text(v))
}

/** Parse one `trigger | fact | affected | evidence | mitigation | residual` line. */
export function parseHardTriggerFact(raw: unknown): RiskHardTriggerFact | undefined {
  const line = text(raw)
  if (line === '') return undefined
  const parts = line.split('|').map((x) => x.trim())
  if (parts.length !== RISK_HARD_TRIGGER_FACT_FIELDS.length) return undefined
  const [trigger, fact, affected, evidence, mitigation, residual] = parts
  if (!isHardTrigger(trigger)) return undefined
  if ([fact, affected, evidence, mitigation, residual].some((x) => x === '')) return undefined
  return { trigger, fact, affected, evidence, mitigation, residual, raw: line }
}

export function hardTriggerFactsOf(unit: Record<string, unknown>): RiskHardTriggerFact[] {
  return list(unit.risk_hard_trigger_facts)
    .map(parseHardTriggerFact)
    .filter((x): x is RiskHardTriggerFact => x !== undefined)
}

export function maxTier(...tiers: readonly RiskTier[]): RiskTier {
  return [...tiers].sort((a, b) => TIER_RANK[b] - TIER_RANK[a])[0] ?? 'low'
}

export function tierAtLeast(actual: RiskTier, minimum: RiskTier): boolean {
  return TIER_RANK[actual] >= TIER_RANK[minimum]
}

function tierOfScore(score: number): RiskTier {
  if (score >= 30) return 'critical'
  if (score >= 23) return 'high'
  if (score >= 15) return 'medium'
  return 'low'
}

function hardFloorOf(trigger: RiskHardTrigger): RiskTier {
  switch (trigger) {
    case 'irreversible-data-change':
    case 'unrecoverable-publish':
    case 'history-destruction':
      return 'critical'
    case 'permission-boundary-change':
    case 'identity-or-secret-boundary':
    case 'external-side-effect':
    case 'cross-project-or-instance-effect':
    case 'business-sequence-change':
    case 'high-value-operation':
    case 'regulatory-or-compliance':
    case 'security-boundary':
      return 'high'
    default:
      return 'high'
  }
}

function dimensionEntries(dimensions: RiskDimensions = {}): Array<[RiskDimensionKey, string, number]> {
  const out: Array<[RiskDimensionKey, string, number]> = []
  for (const key of Object.keys(RISK_DIMENSIONS) as RiskDimensionKey[]) {
    const value = text(dimensions[key])
    if (value === '') continue
    const values = RISK_DIMENSIONS[key] as readonly string[]
    const index = values.indexOf(value)
    if (index >= 0) out.push([key, value, index + 1])
  }
  return out
}

function dimensionFloorOf(entries: Array<[RiskDimensionKey, string, number]>): RiskTier {
  /**
   * ── **O-04：十维里只有六维有 floor 规则，另外四维只计分** ─────────────────
   *
   * ⚠ 实测（本文件 grep 该维度名）：
   *
   * | 维度 | 显式 floor 规则 |
   * |---|---|
   * | severity | ✅ 4 ⇒ high |
   * | reversibility | ✅ irreversible ⇒ high（+ hard 与高分组合 ⇒ high） |
   * | scope | ✅ external ⇒ high |
   * | exposure | ✅ public ⇒ high |
   * | detectability | ✅ latent 且 severity≥3 ⇒ high |
   * | recoveryTime | ✅ unknown 且 severity≥3 ⇒ high |
   * | **uncertainty** | ❌ 零命中 |
   * | **changeSurface** | ❌ 零命中 |
   * | **dependencies** | ❌ 零命中 |
   * | **verificationMaturity** | ❌ 零命中 |
   *
   * ⚠ 这**不是缺陷**（四维通过 score 参与总分，总分再经 tierOfScore 换算）——
   *   但**必须写明**：读的人看到「十维风险评定」，会以为每一维都能单独抬高档位。
   *   而实际只有六维能。⇒ 一个 verificationMaturity=experimental 的方案，
   *   **单靠这一维不会变 high**，必须靠总分或其他维度的组合。
   *
   * ⛔ **不要为了「对称」给这四维补 floor 规则** —— 那会改变所有既有账本的风险档位，
   *   是一次**语义变更**，不是修 bug。真要补，先回答：experimental 应该抬到哪一档？
   *   （本仓没有这个答案，⛔ 不猜。）
   */
  const valueOf = (key: RiskDimensionKey): string =>
    entries.find(([k]) => k === key)?.[1] ?? ''
  const scoreOf = (key: RiskDimensionKey): number =>
    entries.find(([k]) => k === key)?.[2] ?? 0

  let floor: RiskTier = 'low'
  if (scoreOf('severity') === 4) floor = maxTier(floor, 'high')
  /** Plan rule: a single dimension at 4 cannot be averaged into a lower tier. */
  if (entries.some(([, , value]) => value === 4)) floor = maxTier(floor, 'high')
  if (valueOf('reversibility') === 'irreversible') floor = maxTier(floor, 'high')
  if (valueOf('scope') === 'external') floor = maxTier(floor, 'high')
  if (valueOf('exposure') === 'public') floor = maxTier(floor, 'high')
  /** Two or more dimensions at 3 cannot remain low. */
  if (entries.filter(([, , value]) => value >= 3).length >= 2) floor = maxTier(floor, 'medium')
  /** A high dimension combined with hard / irreversible recovery cannot remain medium. */
  if (entries.some(([, , value]) => value >= 3)
    && ['hard', 'irreversible'].includes(valueOf('reversibility'))) floor = maxTier(floor, 'high')
  if (valueOf('detectability') === 'latent' && scoreOf('severity') >= 3) floor = maxTier(floor, 'high')
  if (valueOf('recoveryTime') === 'unknown' && scoreOf('severity') >= 3) floor = maxTier(floor, 'high')
  if (scoreOf('severity') === 4 && valueOf('reversibility') === 'irreversible') floor = maxTier(floor, 'critical')
  return floor
}

/**
 * Contextual hard-trigger floor: permission, identity and security boundary
 * changes are high by default, and critical when the boundary cannot be
 * reversed.
 */
function hardContextFloorOf(triggers: readonly RiskHardTrigger[], dimensions: RiskDimensions = {}): RiskTier {
  const boundary = triggers.some((x) => [
    'permission-boundary-change', 'identity-or-secret-boundary', 'security-boundary',
  ].includes(x))
  return boundary && text(dimensions.reversibility) === 'irreversible' ? 'critical' : 'low'
}

function digestOf(v: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(v))
  let h1 = 0x811c9dc5
  let h2 = 0x9e3779b9
  for (const b of bytes) {
    h1 ^= b
    h1 = Math.imul(h1, 0x01000193) >>> 0
    h2 ^= (b + 0x9d) & 0xff
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0
    h2 = (h2 ^ (h2 >>> 13)) >>> 0
  }
  return `riskfnv:${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`
}

export function closureModeOf(tier: RiskTier, facts: RiskFacts = {}): ClosureMode {
  const delivery = DELIVERY_SCOPES.includes(text(facts.delivery) as DeliveryScope)
    ? text(facts.delivery) as DeliveryScope
    : 'external'
  const triggers = list(facts.hardTriggers)
  if (tier === 'critical'
    || triggers.includes('unrecoverable-publish')
    || triggers.includes('irreversible-data-change')
    || triggers.includes('cross-project-or-instance-effect')
    || triggers.includes('history-destruction')
    || triggers.includes('permission-boundary-change')
    || triggers.includes('identity-or-secret-boundary')
    || triggers.includes('security-boundary')
    || triggers.includes('regulatory-or-compliance')) return 'strict'
  if (tier === 'high' || delivery === 'external') return 'standard'
  return 'skipped'
}

/**
 * Derive intrinsic risk from facts. Missing dimensions score as zero, but a
 * completed v3 assessment is additionally checked for completeness below.
 */
export function riskAssessmentOf(facts: RiskFacts = {}): RiskAssessment {
  const hardTriggers = list(facts.hardTriggers)
    .filter(isHardTrigger)
  const hardTriggerFacts = list(facts.hardTriggerFacts)
    .map(parseHardTriggerFact)
    .filter((x): x is RiskHardTriggerFact => x !== undefined)
    .sort((a, b) => a.raw.localeCompare(b.raw))
  const entries = dimensionEntries(facts.dimensions ?? {})
  const score = entries.reduce((n, [, , value]) => n + value, 0)
  const nonHardTier = tierOfScore(score)
  const hardFloor = hardTriggers.reduce<RiskTier>((tier, trigger) => maxTier(tier, hardFloorOf(trigger)), 'low')
  const dimensionFloor = dimensionFloorOf(entries)
  const hardContextFloor = hardContextFloorOf(hardTriggers, facts.dimensions)
  const declaredTier = isRiskTier(facts.declaredTier) ? facts.declaredTier : undefined
  const derivedTier = maxTier(nonHardTier, hardFloor, dimensionFloor, hardContextFloor)
  /** A declared tier may be more conservative, never less. */
  const tier = declaredTier === undefined ? derivedTier : maxTier(derivedTier, declaredTier)
  const delivery = DELIVERY_SCOPES.includes(text(facts.delivery) as DeliveryScope)
    ? text(facts.delivery) as DeliveryScope
    : 'external'
  const closure = closureModeOf(tier, { ...facts, delivery })
  const reasons = [
    ...hardTriggers.map((x) => `hard-trigger:${x}`),
    ...entries.filter(([, , v]) => v >= 3).map(([k, v]) => `${k}:${v}`),
  ]
  return {
    ruleVersion: RISK_POLICY_VERSION,
    tier,
    nonHardTier,
    score,
    hardTriggers,
    hardTriggerFacts,
    hardContextFloor,
    dimensionScores: Object.fromEntries(entries.map(([k, , v]) => [k, v])),
    dimensionValues: facts.dimensions ?? {},
    dimensionFloor,
    hardFloor,
    delivery,
    closure,
    needsIndependentReview: TIER_RANK[tier] >= TIER_RANK.high,
    needsDualReview: tier === 'critical',
    needsUserAcceptance: TIER_RANK[tier] >= TIER_RANK.high,
    needsResidualAcceptance: tier === 'critical',
    reasons,
    inputsDigest: digestOf({
      hardTriggers: [...hardTriggers].sort(),
      hardTriggerFacts: hardTriggerFacts.map((x) => x.raw).sort(),
      dimensions: Object.fromEntries(Object.entries(facts.dimensions ?? {}).sort(([a], [b]) => a.localeCompare(b))),
      delivery,
    }),
  }
}

export function riskFactsOf(unit: Record<string, unknown>): RiskFacts {
  const dimensions: RiskDimensions = {}
  for (const raw of list(unit.risk_dimensions)) {
    const m = /^([A-Za-z][A-Za-z0-9]*)=([^=\s]+)$/.exec(raw)
    if (m === null) continue
    const key = m[1] as RiskDimensionKey
    if ((Object.keys(RISK_DIMENSIONS) as string[]).includes(key)) dimensions[key] = m[2]!
  }
  return {
    hardTriggers: list(unit.risk_hard_triggers),
    hardTriggerFacts: list(unit.risk_hard_trigger_facts),
    dimensions,
    delivery: DELIVERY_SCOPES.includes(text(unit.delivery_scope) as DeliveryScope)
      ? text(unit.delivery_scope) as DeliveryScope
      : undefined,
    declaredTier: text(unit.risk_tier),
    declaredClosure: text(unit.closure_mode),
    riskBindingVersion: text(unit.risk_binding_version),
    riskAssessmentRef: text(unit.risk_assessment_ref),
    residualTier: text(unit.risk_residual_tier),
    residualAcceptedBy: text(unit.risk_accepted_by),
    residualAcceptedAt: text(unit.risk_accepted_at),
    residualConditions: list(unit.risk_accept_conditions),
  }
}

export function riskAssessmentProblems(unit: Record<string, unknown>): RiskPolicyProblem[] {
  if (text(unit.kind) !== 'change') return []
  if (text(unit.pipeline_version) !== 'v3') return []
  if (!['settled', 'superseded'].includes(text(unit.status))) return []
  const id = text(unit.id) || '(change)'
  const out: RiskPolicyProblem[] = []
  const facts = riskFactsOf(unit)
  const hard = list(unit.risk_hard_triggers)
  const unknownHard = hard.filter((x) => !isHardTrigger(x))
  if (unknownHard.length > 0) out.push({ rule: 'RP-1', unit: id, why: `未知硬触发：${unknownHard.join(' / ')}` })
  /**
   * Hard triggers are facts, not labels. Each one needs fact / affected /
   * evidence / mitigation / residual; a missing field is undecidable, not low.
   */
  const rawFacts = list(unit.risk_hard_trigger_facts)
  const malformedFacts = rawFacts.filter((x) => parseHardTriggerFact(x) === undefined)
  if (malformedFacts.length > 0) {
    out.push({ rule: 'RP-1', unit: id, why: `硬触发事实不是六段式（trigger | fact | affected | evidence | mitigation | residual）：${malformedFacts[0]}` })
  }
  const parsedFacts = hardTriggerFactsOf(unit)
  const factTriggers = new Set(parsedFacts.map((x) => x.trigger))
  const missingFacts = hard.filter(isHardTrigger).filter((x) => !factTriggers.has(x))
  if (missingFacts.length > 0) {
    out.push({ rule: 'RP-1', unit: id, why: `硬触发缺逐项事实：${missingFacts.join(' / ')}（每条必须写 trigger / fact / affected / evidence / mitigation / residual）` })
  }
  const orphanFacts = parsedFacts.filter((x) => !hard.includes(x.trigger))
  if (orphanFacts.length > 0) {
    out.push({ rule: 'RP-1', unit: id, why: `硬触发事实 ${orphanFacts[0]!.trigger} 没有出现在 risk_hard_triggers 中` })
  }
  const duplicateFacts = parsedFacts
    .map((x) => x.trigger)
    .filter((x, i, all) => all.indexOf(x) !== i)
  if (duplicateFacts.length > 0) {
    out.push({ rule: 'RP-1', unit: id, why: `同一硬触发有多条事实：${[...new Set(duplicateFacts)].join(' / ')}` })
  }
  /**
   * Structured RSK records are the tracking object. The plan's tier is only a
   * derived summary, so every linked risk must exist, carry the same closed
   * tier vocabulary, and be resolvable in the same ledger.
   */
  const rawDimensions = list(unit.risk_dimensions)
  if (rawDimensions.length === 0) out.push({ rule: 'RP-9', unit: id, why: 'v3 方案缺风险维度评定（risk_dimensions 为空）' })
  const malformed = rawDimensions.filter((x) => !/^([A-Za-z][A-Za-z0-9]*)=([^=\s]+)$/.test(x))
  if (malformed.length > 0) out.push({ rule: 'RP-9', unit: id, why: `风险维度格式错误：${malformed[0]}` })
  const unknownDimensions = Object.entries(facts.dimensions ?? {}).filter(([key, value]) => {
    const allowed = RISK_DIMENSIONS[key as RiskDimensionKey] as readonly string[] | undefined
    return allowed === undefined || !allowed.includes(String(value))
  })
  if (unknownDimensions.length > 0) out.push({ rule: 'RP-9', unit: id, why: `未知风险维度或值：${unknownDimensions[0]![0]}=${String(unknownDimensions[0]![1])}` })
  const missingDimensions = (Object.keys(RISK_DIMENSIONS) as RiskDimensionKey[]).filter((key) => facts.dimensions?.[key] === undefined)
  if (missingDimensions.length > 0) out.push({ rule: 'RP-9', unit: id, why: `风险评定缺维度：${missingDimensions.join(' / ')}` })
  /** Validation compares against facts only; the declared tier may only raise. */
  const derived = riskAssessmentOf({ ...facts, declaredTier: undefined })
  const declared = text(unit.risk_tier)
  if (!isRiskTier(declared)) out.push({ rule: 'RP-2', unit: id, why: `risk_tier 不在封闭集：${declared || '(空)'}` })
  else if (!tierAtLeast(declared, derived.tier)) {
    out.push({ rule: 'RP-2', unit: id, why: `声明风险 ${declared} 低于事实推导 ${derived.tier}（分数 ${derived.score}；硬触发最低 ${derived.hardFloor}；单维最低 ${derived.dimensionFloor}）` })
  }
  if (text(unit.risk_rule_version) !== RISK_POLICY_VERSION) {
    out.push({ rule: 'RP-3', unit: id, why: `risk_rule_version 必须是 ${RISK_POLICY_VERSION}` })
  }
  if (text(unit.risk_inputs_digest) !== derived.inputsDigest) {
    out.push({ rule: 'RP-3', unit: id, why: 'risk_inputs_digest 与当前风险事实不一致（评定已过期或未经当前规则计算）' })
  }
  if (text(unit.risk_assessed_at) === '' || !Number.isFinite(Date.parse(text(unit.risk_assessed_at)))) {
    out.push({ rule: 'RP-3', unit: id, why: '缺可解析的 risk_assessed_at' })
  }
  if (text(unit.risk_assessed_by) === '') out.push({ rule: 'RP-3', unit: id, why: '缺 risk_assessed_by' })
  if (text(unit.risk_binding_version) !== '') {
    const v = Number(text(unit.risk_binding_version).replace(/^v/i, ''))
    const current = Number(RISK_POLICY_VERSION.replace(/^v/i, ''))
    if (!Number.isSafeInteger(v) || v <= 0) {
      out.push({ rule: 'RP-3', unit: id, why: `risk_binding_version 不是正整数版本：${text(unit.risk_binding_version)}` })
    } else if (v < current) {
      out.push({ rule: 'RP-3', unit: id, why: `风险评定按旧规则 v${v} 评定；当前规则 v${current} 要求重评，不能静默沿用` })
    }
  }
  /**
   * ⚠⚠ **R-23：评审要求必须按「有效档位」判，⛔ 不是按「纯推导档位」。**
   *
   *   改前：`riskGateRequirements(derived.tier)` —— 而 `derived` 是
   *   `riskAssessmentOf({ ...facts, declaredTier: undefined })` ⇒ **纯推导值**。
   *
   *   ⚠ 但 `riskAssessmentOf` 自己的 `tier` 是 `maxTier(derivedTier, declaredTier)`
   *     ——「**声明的档位只能更保守，不能更松**」（`:300-301`）。
   *   ⇒ 于是出现这个分叉（**实测**，声明 `high` / 事实推导 `low`）：
   *
   *   | 判据 | 用哪个 tier | 结果 |
   *   |---|---|---|
   *   | `stage-controls` C-15 | **声明值** `u.risk_tier` | **2 条**（缺评审者 / 缺证据） |
   *   | `risk-policy` RP-4/RP-5 | **推导值** `derived.tier` | **0 条** |
   *
   *   ⇒ 同一件事（「高风险必须有独立评审者，且不能是作者」）**两处结论相反**，
   *     而且**松的那一处正好是用户自己声明高风险的情形** ——
   *     「我声明这是 high」却按 low 要求评审，这是把用户的保守声明当成噪音。
   *
   *   ⚠ **为什么用 `effectiveTier` 而不是直接把 `derived` 换成含 declared 的**：
   *     RP-2 的「声明不得低于推导」必须继续用**纯推导值**（否则声明 low 时会拿 low 跟 low 比 ⇒ 恒真）。
   *     ⇒ 两个值各有各的用途，**分开命名**，⛔ 不要合并成一个。
   */
  const effectiveTier = isRiskTier(declared) && tierAtLeast(declared, derived.tier) ? declared : derived.tier
  const needsIndependentReview = riskGateRequirements(effectiveTier).independentReview
  const needsDualReview = riskGateRequirements(effectiveTier).dualReview
  if (needsIndependentReview) {
    const reviewer = text(unit.reviewer)
    if (reviewer === '') out.push({ rule: 'RP-4', unit: id, why: `${effectiveTier} 风险必须有独立设计评审者` })
    else if (reviewer === text(unit.built_by)) out.push({ rule: 'RP-4', unit: id, why: '设计评审者就是方案作者本人' })
    if (list(unit.review_refs).length === 0) out.push({ rule: 'RP-4', unit: id, why: `${effectiveTier} 风险必须有设计评审证据` })
  }
  if (needsDualReview && list(unit.review_refs).length < 2) {
    out.push({ rule: 'RP-5', unit: id, why: `${effectiveTier} 风险至少需要两份独立评审证据` })
  }
  const declaredClosure = text(unit.closure_mode)
  if (declaredClosure !== '' && !(CLOSURE_MODES as readonly string[]).includes(declaredClosure)) {
    out.push({ rule: 'RP-6', unit: id, why: `closure_mode 不在封闭集：${declaredClosure}` })
  } else if (declaredClosure !== '' && declaredClosure !== derived.closure) {
    out.push({ rule: 'RP-6', unit: id, why: `closure_mode 声明 ${declaredClosure}，按风险应作 ${derived.closure}` })
  }
  return out
}

/** Risk-unit validation used by stage controls, where the whole ledger is available. */
export function riskObjectProblems(units: readonly Record<string, unknown>[]): RiskPolicyProblem[] {
  const out: RiskPolicyProblem[] = []
  /** A risk is in scope when enrolled in v3 or named by a v3 plan/task. */
  const v3Anchors = new Set(
    units
      .filter((u) => ['change', 'task'].includes(text(u.kind)) && text(u.pipeline_version) === 'v3')
      .flatMap((u) => list(u.risk_ids)),
  )
  const risks = units.filter((u) => text(u.kind) === 'risk')
  for (const r of risks) {
    if (text(r.pipeline_version) !== 'v3' && !v3Anchors.has(text(r.id))) continue
    const id = text(r.id) || '(risk)'
    if (!isRiskTier(text(r.risk_tier))) out.push({ rule: 'RP-7', unit: id, why: `风险对象 risk_tier 不在封闭集：${text(r.risk_tier) || '(空)'}` })
    const category = text(r.category)
    if (category !== '' && !(RISK_OBJECT_CATEGORIES as readonly string[]).includes(category)) {
      out.push({ rule: 'RP-7', unit: id, why: `风险类别不在封闭集：${category}` })
    }
    const status = text(r.status)
    if (status !== '' && !(RISK_OBJECT_STATUSES as readonly string[]).includes(status)) {
      out.push({ rule: 'RP-7', unit: id, why: `风险对象 status 不在封闭集：${status}` })
    }
    const hardTrigger = text(r.hard_trigger)
    if (hardTrigger !== '' && !isHardTrigger(hardTrigger)) {
      out.push({ rule: 'RP-7', unit: id, why: `风险对象 hard_trigger 不在封闭集：${hardTrigger}` })
    }
    const likelihood = text(r.likelihood)
    if (likelihood !== '' && !(RISK_LIKELIHOODS as readonly string[]).includes(likelihood)) {
      out.push({ rule: 'RP-7', unit: id, why: `风险 likelihood 不在封闭集：${likelihood}` })
    }
    const impact = text(r.impact)
    if (impact !== '' && !(RISK_IMPACTS as readonly string[]).includes(impact)) {
      out.push({ rule: 'RP-7', unit: id, why: `风险 impact 不在封闭集：${impact}` })
    }
    const detectability = text(r.detectability)
    if (detectability !== '' && !(RISK_DETECTABILITY as readonly string[]).includes(detectability)) {
      out.push({ rule: 'RP-7', unit: id, why: `风险 detectability 不在封闭集：${detectability}` })
    }
    const reversibility = text(r.reversibility)
    if (reversibility !== '' && !(RISK_REVERSIBILITY as readonly string[]).includes(reversibility)) {
      out.push({ rule: 'RP-7', unit: id, why: `风险 reversibility 不在封闭集：${reversibility}` })
    }
    if (text(r.owner) === '') out.push({ rule: 'RP-7', unit: id, why: '风险对象缺负责人 owner' })
    const mitigation = list(r.mitigation)
    if (status === 'open' && mitigation.length === 0) out.push({ rule: 'RP-7', unit: id, why: 'open 风险缺处置措施 mitigation' })
    if (status === 'handling' && text(r.disposition) === '') out.push({ rule: 'RP-7', unit: id, why: 'handling 风险缺处置说明 disposition' })
    if (status === 'closed') {
      if (text(r.disposition) === '') out.push({ rule: 'RP-7', unit: id, why: 'closed 风险缺关闭理由 disposition' })
      if (list(r.verification_refs).length === 0) out.push({ rule: 'RP-7', unit: id, why: 'closed 风险缺关闭证据 verification_refs' })
    }
    const residualTier = text(r.residual_tier)
    if (residualTier !== '' && !isRiskTier(residualTier)) {
      out.push({ rule: 'RP-7', unit: id, why: `风险残余等级 residual_tier 不在封闭集：${residualTier}` })
    }
    if (residualTier === 'high' || residualTier === 'critical') {
      if (text(r.acceptance_ref) === '') out.push({ rule: 'RP-7', unit: id, why: `${residualTier} 风险对象缺残余接受引用 acceptance_ref` })
    }
  }
  const byId = new Map(units.map((u) => [text(u.id), u]))
  for (const u of units) {
    if (!['change', 'task'].includes(text(u.kind))) continue
    for (const rid of list(u.risk_ids)) {
      const risk = byId.get(rid)
      if (risk === undefined || text(risk.kind) !== 'risk') {
        out.push({ rule: 'RP-7', unit: text(u.id) || '(unit)', why: `risk_ids 指向的 ${rid} 不存在或不是 risk 单元` })
      }
    }
  }
  /**
   * A linked risk that is still open or being handled cannot be treated as
   * closed by a plan or a delivery decision. The plan must not dispatch on an
   * unowned risk, and G6 must not close with unresolved risks.
   */
  for (const u of units) {
    const kind = text(u.kind)
    if (kind !== 'change' && kind !== 'closure') continue
    if (text(u.pipeline_version) !== 'v3' && kind === 'change') continue
    for (const rid of list(u.risk_ids)) {
      const risk = byId.get(rid)
      if (risk === undefined || text(risk.kind) !== 'risk') continue
      const status = text(risk.status)
      if (status === 'open') {
        out.push({ rule: 'RP-7', unit: text(u.id) || '(unit)', why: `关联风险 ${rid} 仍是 open ⇒ 不能按已处置推进 / 收口` })
      } else if (status === 'handling' && kind === 'closure') {
        out.push({ rule: 'RP-7', unit: text(u.id) || '(unit)', why: `关联风险 ${rid} 仍在 handling ⇒ 交付收口前必须处置或登记接受` })
      }
    }
  }
  return out
}

/**
 * Task-level execution risk. This is not a copy of the plan risk: it decides
 * whether one concrete task must be split, serialized, independently reviewed,
 * isolated, or backed by extra evidence before it may run.
 */
export const TASK_RISK_FLAGS = [
  'requires_isolation', 'requires_review', 'requires_serial_execution',
] as const

export interface TaskRiskRequirements {
  splitRequired: boolean
  isolationRequired: boolean
  reviewRequired: boolean
  serialRequired: boolean
  evidenceRequired: boolean
  reasons: string[]
}

export function taskRiskOf(task: Record<string, unknown>): {
  tier: RiskTier
  reasons: string[]
  touchedSurfaces: string[]
  irreversibleActions: string[]
  requirements: TaskRiskRequirements
} {
  const declared = text(task.task_risk)
  const tier = isRiskTier(declared) ? declared : 'low'
  const reasons = list(task.risk_reasons)
  const touchedSurfaces = list(task.touched_surfaces)
  const irreversibleActions = list(task.irreversible_actions)
  const bool = (v: unknown): boolean => text(v) === 'true' || v === true
  const reasonsOut: string[] = []
  const splitRequired = ['high', 'critical'].includes(tier) || irreversibleActions.length > 0
  if (splitRequired) reasonsOut.push(`task_risk=${tier}${irreversibleActions.length === 0 ? '' : '，含不可逆动作'}`)
  if (touchedSurfaces.length > 0) reasonsOut.push(`触及 ${touchedSurfaces.length} 个执行面`)
  const evidenceRequired = reasons.length > 0 || tier !== 'low'
  return {
    tier,
    reasons,
    touchedSurfaces,
    irreversibleActions,
    requirements: {
      splitRequired,
      isolationRequired: bool(task.requires_isolation) || tier === 'critical' || irreversibleActions.length > 0,
      reviewRequired: bool(task.requires_review) || ['high', 'critical'].includes(tier) || irreversibleActions.length > 0,
      serialRequired: bool(task.requires_serial_execution) || tier === 'critical' || irreversibleActions.length > 0,
      evidenceRequired,
      reasons: reasonsOut,
    },
  }
}

/** Validate one task's risk declaration against the execution gate. */
export function taskRiskProblems(task: Record<string, unknown>): RiskPolicyProblem[] {
  if (text(task.kind) !== 'task') return []
  if (text(task.pipeline_version) !== 'v3') return []
  if (!['todo', 'doing', 'built'].includes(text(task.status))) return []
  const id = text(task.id) || '(task)'
  const out: RiskPolicyProblem[] = []
  const declared = text(task.task_risk)
  if (declared === '') {
    out.push({ rule: 'RP-4', unit: id, why: 'v3 任务缺 task_risk（未声明执行风险，不能判断是否需拆小 / 串行 / 复核）' })
    return out
  }
  if (!isRiskTier(declared)) {
    out.push({ rule: 'RP-4', unit: id, why: `task_risk 不在封闭集：${declared}` })
    return out
  }
  const risk = taskRiskOf(task)
  if (risk.tier !== 'low' && risk.reasons.length === 0) {
    out.push({ rule: 'RP-4', unit: id, why: `${risk.tier} 任务缺 risk_reasons` })
  }
  if (risk.requirements.reviewRequired) {
    const reviewer = text(task.reviewer)
    if (reviewer === '') out.push({ rule: 'RP-4', unit: id, why: `${risk.tier} 任务缺独立评审者` })
    else if (reviewer === text(task.built_by)) out.push({ rule: 'RP-4', unit: id, why: '任务评审者就是实现者本人' })
    if (list(task.review_refs).length === 0) {
      out.push({ rule: 'RP-4', unit: id, why: `${risk.tier} 任务缺评审证据 review_refs` })
    }
  }
  if (risk.requirements.isolationRequired && !(text(task.requires_isolation) === 'true' || task.requires_isolation === true)) {
    out.push({ rule: 'RP-4', unit: id, why: `${risk.tier} 任务必须显式标记 requires_isolation=true` })
  }
  if (risk.requirements.serialRequired && !(text(task.requires_serial_execution) === 'true' || task.requires_serial_execution === true)) {
    out.push({ rule: 'RP-4', unit: id, why: `${risk.tier} 任务必须显式标记 requires_serial_execution=true` })
  }
  if (risk.irreversibleActions.length > 0 && list(task.rollback_refs).length === 0) {
    out.push({ rule: 'RP-4', unit: id, why: '任务含不可逆动作但缺 rollback_refs（恢复 / 回滚方案）' })
  }
  return out
}

/** Whether two task scopes overlap, in a deterministic textual form. */
export function taskScopeConflict(a: Record<string, unknown>, b: Record<string, unknown>): string | undefined {
  const pathsOf = (t: Record<string, unknown>): string[] => list(t.scope_paths).map((x) => x.replace(/\\/g, '/').replace(/\/+$/, ''))
  const pa = pathsOf(a)
  const pb = pathsOf(b)
  for (const x of pa) for (const y of pb) {
    if (x === '' || y === '') continue
    if (x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)) return `${x} ↔ ${y}`
  }
  return undefined
}

export interface ResidualRiskDecision {
  tier: RiskTier
  acceptedBy?: string
  conditions?: readonly string[]
  /** What may happen if the residual risk is triggered. */
  impact?: string
  /** Monitoring or rollback that makes the residual acceptable. */
  monitoring?: string
  acceptanceRequired?: boolean
}

export function residualRiskProblems(decision: ResidualRiskDecision): RiskPolicyProblem[] {
  const out: RiskPolicyProblem[] = []
  const tier = decision.tier
  if (!['low', 'medium', 'high', 'critical'].includes(String(tier))) {
    out.push({ rule: 'RP-10', unit: '(residual)', why: `残余风险等级不在封闭集：${String(tier)}` })
    return out
  }
  if ((decision.acceptanceRequired ?? TIER_RANK[tier] >= TIER_RANK.high) && text(decision.acceptedBy) === '') {
    out.push({ rule: 'RP-10', unit: '(residual)', why: `${tier} 残余风险必须记录接受者` })
  }
  if (tier === 'critical' && list(decision.conditions).length === 0) {
    out.push({ rule: 'RP-10', unit: '(residual)', why: 'critical 残余风险必须登记接受条件 / 影响范围' })
  }
  if (TIER_RANK[tier] >= TIER_RANK.high) {
    if (text(decision.impact) === '') out.push({ rule: 'RP-10', unit: '(residual)', why: `${tier} 残余风险必须记录影响范围 impact` })
    if (text(decision.monitoring) === '') out.push({ rule: 'RP-10', unit: '(residual)', why: `${tier} 残余风险必须记录监控 / 回退方式 monitoring` })
  }
  return out
}

export function riskGateRequirements(tier: RiskTier): {
  /**
   * ── **O-03：改成「最小路径数」，⛔ 不再是恒 `true` 的布尔** ────────────────
   *
   * ⚠ 改前这里是 `pathComparison: true` —— **六项里唯一恒真的一个**，
   *   而真正的档位差异藏在**调用方**的三元表达式里：
   *   `if (requirements.pathComparison && options.length < (tier === 'low' ? 1 : 2))`
   *   ⇒ **字段名说「是否需要路径比较」，实际它从不区分档位**；
   *     真正的判据在调用方，而那个判据**又自己读了一遍 tier**。
   *
   * ⚠ 后果不只是「不好看」：任何**新调用方**照字段名理解，会写成
   *   `if (requirements.pathComparison) requireTwoPaths()` ⇒ **low 也被要求两条路径**，
   *   与现有调用方行为**不一致**，而且**看不出哪里不一致**。
   *
   * ⚠ 改成 `minPaths: number`：**把档位差异收进这个函数**，
   *   调用方只判 `options.length < requirements.minPaths`，⛔ 不再自己读 tier。
   *   ⇒ 同一事实（「这个档位要几条路径」）只有**一个来源**。
   */
  minPaths: number
  verificationStrategy: boolean
  independentReview: boolean
  dualReview: boolean
  userAcceptance: boolean
  strictClosure: boolean
} {
  const rank = TIER_RANK[tier]
  return {
    /**
     * ⚠ low 要 **1** 条（「至少一条可行路径」），medium 及以上要 **2** 条（要做比较）。
     *   ⛔ 不要改成 0 —— 那会让 low 完全不需要路径。
     */
    minPaths: tier === 'low' ? 1 : 2,
    verificationStrategy: rank >= TIER_RANK.medium,
    independentReview: rank >= TIER_RANK.high,
    dualReview: rank >= TIER_RANK.critical,
    userAcceptance: rank >= TIER_RANK.high,
    strictClosure: rank >= TIER_RANK.medium,
  }
}

