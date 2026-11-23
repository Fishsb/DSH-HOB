/**
 * **read_contracts 的七类只读出口**（2026-11-23 · A·拆分，自 `modules/tools.ts` 原样搬出）。
 *
 * ══ 为什么单独一个模块 ═══════════════════════════════════════════════════
 *   · 规模纪律：`tools.ts` 有「只准降不准升」的登记上限，出口越加越胖；
 *   · 职责边界：这些出口都是**纯只读投影**（机器值/规范/诊断），与账本写入无关。
 *
 * ══ 纪律（搬出时逐字保留）════════════════════════════════════════════════
 *   · 需要账本根的出口走 `deps.resolveRoot()`，判不出 ⇒ 原样 fail-closed 拒绝；
 *   · 不依赖账本的三个出口（digest 纯入参 / spec / constitution）**先于**根解析；
 *   · ⛔ 不新增写面：本模块只读文件与账本单元。
 *
 * @module read-contract-endpoints
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { procProcessAlive } from '../server/effects-queue.ts'
import {
  riskAssessmentOf, riskFactsOf, RISK_DIMENSIONS, RISK_HARD_TRIGGERS, RISK_HARD_TRIGGER_FACT_FIELDS,
  DELIVERY_SCOPES, RISK_TIERS, RISK_POLICY_VERSION, type RiskDimensions, type RiskHardTrigger, type DeliveryScope,
} from '../shared/risk-policy.ts'
import { riskBindingDigestOf, artifactDigestOf, selectedOptionValid } from '../shared/pipeline.ts'
import { acceptanceCriteriaIdsOf } from '../shared/pipeline-view.ts'
import { readNotifications } from '../server/notify-ledger.ts'

/** 出口需要的注入面（由 `tools.ts` 提供；⛔ 不在本模块自己拼账本落点）。 */
export interface ReadContractDeps {
  resolveRoot: () => string | undefined
  readUnits: (root: string) => Array<Record<string, unknown>>
  readMd: (root: string, rel: string, maxBytes: number) => Promise<{ ok: boolean; text: string; truncated?: boolean; bytes?: number; reason?: string }>
  maxFileBytes: number
}

export function governanceSpecRootOf(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'preset', 'dsh-hob', 'spec')
}

function parseStringList(raw: string | undefined): { ok: true; list: string[] } | { ok: false; why: string } {
  const s = String(raw ?? '').trim()
  if (s === '') return { ok: true, list: [] }
  if (s.startsWith('[')) {
    try {
      const v: unknown = JSON.parse(s)
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) return { ok: false, why: '不是字符串数组' }
      return { ok: true, list: v.map((x) => String(x).trim()).filter((x) => x !== '') }
    } catch {
      return { ok: false, why: 'JSON 解析失败' }
    }
  }
  return { ok: true, list: s.split(',').map((x) => x.trim()).filter((x) => x !== '') }
}

type RiskDigestArgs = { riskDimensions?: string; riskHardTriggers?: string; riskDelivery?: string; riskDeclaredTier?: string }

function riskDigestOfArgs(args: RiskDigestArgs): JsonValue {
  let dims: Record<string, string> = {}
  const rawDims = String(args.riskDimensions ?? '').trim()
  if (rawDims !== '') {
    try {
      const v: unknown = JSON.parse(rawDims)
      if (v === null || typeof v !== 'object' || Array.isArray(v)) {
        return { ok: false, reason: 'risk-dimensions-invalid', message: '拒绝：riskDimensions 必须是 JSON 对象（维度名 → 值），如 {"operational-scale":"project"}。' }
      }
      dims = v as Record<string, string>
    } catch {
      return { ok: false, reason: 'risk-dimensions-invalid', message: '拒绝：riskDimensions 不是合法 JSON。' }
    }
  }
  const hard = parseStringList(args.riskHardTriggers)
  if (!hard.ok) return { ok: false, reason: 'risk-hard-triggers-invalid', message: '拒绝：riskHardTriggers ' + hard.why + '（给 JSON 字符串数组或逗号分隔）。' }
  const delivery = String(args.riskDelivery ?? '').trim()
  if (delivery !== '' && !(DELIVERY_SCOPES as readonly string[]).includes(delivery)) {
    return { ok: false, reason: 'risk-delivery-invalid', message: '拒绝：riskDelivery 必须是 ' + DELIVERY_SCOPES.join(' / ') + ' 之一。' }
  }
  const declaredTier = String(args.riskDeclaredTier ?? '').trim()
  if (declaredTier !== '' && !(RISK_TIERS as readonly string[]).includes(declaredTier)) {
    return { ok: false, reason: 'risk-declared-tier-invalid', message: '拒绝：riskDeclaredTier 必须是 ' + RISK_TIERS.join(' / ') + ' 之一。' }
  }
  for (const [k, v] of Object.entries(dims)) {
    const legal = (RISK_DIMENSIONS as unknown as Record<string, readonly string[]>)[k]
    if (!Array.isArray(legal)) {
      return { ok: false, reason: 'risk-dimension-key-invalid', message: '拒绝：维度「' + k + '」不在词表；合法维度：' + Object.keys(RISK_DIMENSIONS).join(' / ') + '。' }
    }
    if (!legal.includes(String(v))) {
      return { ok: false, reason: 'risk-dimension-value-invalid', message: '拒绝：维度「' + k + '」的值必须是 ' + legal.join(' / ') + ' 之一。' }
    }
  }
  for (const t of hard.list) {
    if (!(RISK_HARD_TRIGGERS as readonly string[]).includes(t)) {
      return { ok: false, reason: 'risk-hard-trigger-invalid', message: '拒绝：硬触发「' + t + '」不在词表；合法值：' + RISK_HARD_TRIGGERS.join(' / ') + '。' }
    }
  }
  const a = riskAssessmentOf({
    dimensions: dims as RiskDimensions,
    hardTriggers: hard.list as RiskHardTrigger[],
    delivery: (delivery === '' ? undefined : delivery) as DeliveryScope | undefined,
    declaredTier: declaredTier === '' ? undefined : declaredTier,
  })
  return {
    ok: true,
    text: JSON.stringify({
      ok: true,
      path: 'risk/digest',
      policyVersion: RISK_POLICY_VERSION,
      digest: a.inputsDigest,
      tier: a.tier,
      closure: a.closure,
      delivery: a.delivery,
      assessment: a,
      vocabulary: {
        dimensions: RISK_DIMENSIONS,
        hardTriggers: RISK_HARD_TRIGGERS,
        hardTriggerFactFields: RISK_HARD_TRIGGER_FACT_FIELDS,
        deliveryScopes: DELIVERY_SCOPES,
        tiers: RISK_TIERS,
      },
    }, null, 2),
    truncated: false,
    bytes: 0,
  }
}

export async function runReadContractEndpoint(
  args: Record<string, unknown>,
  deps: ReadContractDeps,
): Promise<JsonValue | undefined> {
      /**
       * ⚠ 2026-11-20 · B/C：两个**不依赖账本**的只读出口先于账本根解析 ——
       *   digest 与规范读取不需要账本存在，也绝不能因账本判不出而被挡
       *   （那正是「账本读不到 ⇒ 规范也读不到 ⇒ 谁都解不了」自举死结的入口）。
       *   ⛔ 两者仍是纯只读，不触碰任何写面与账本文件。
       */
      if (String(args.path ?? '').trim() === 'risk/digest' && String(args.riskDigestUnitId ?? '').trim() === '') {
        return riskDigestOfArgs(args)
      }
      const specRoot = governanceSpecRootOf()
      const specRel = String(args.path ?? '').trim().replace(/^\/+/, '')
      if (specRel === 'spec' || specRel === 'spec/') {
        try {
          const names = readdirSync(specRoot).filter((n) => n.endsWith('.md')).sort()
          return { ok: true, text: JSON.stringify({ ok: true, path: 'spec', files: names }, null, 2), truncated: false, bytes: 0 } as unknown as JsonValue
        } catch (e) {
          return { ok: false, reason: 'spec-dir-unreadable', message: '拒绝：治理规范目录读不到（' + String((e as Error)?.message ?? e) + '）。' }
        }
      }
      if (specRel.startsWith('spec/')) {
        const file = specRel.slice('spec/'.length)
        if (file === '' || file.includes('/') || file.includes('..') || !file.endsWith('.md')) {
          return { ok: false, reason: 'spec-path-invalid', message: '拒绝：spec/ 只放行本目录内的一层 .md 文件名（如 spec/risk-policy.md），不许子目录、不许 ..、不放行 .txt。' }
        }
        const r = await deps.readMd(specRoot, file, deps.maxFileBytes)
        if (r.ok) return { ok: true, text: r.text, truncated: r.truncated, bytes: r.bytes } as unknown as JsonValue
        return { ok: false, reason: r.reason ?? 'spec-read-error', message: r.text }
      }
      if (String(args.path ?? '').trim() === 'constitution') {
        /**
         * ⚠ 批5（2026-11-21 · 方案5-A 用户拍板 A）：**双层宪法**的上层出口 ——
         *   插件版宪法随包只读分发（sha256 入回包防两处真相）；项目增量走提案
         *   单元落账（既有 decision 写面）。⛔ 项目内 ledger/CONSTITUTION.md 的
         *   写面红线（人工编辑+commit）原样保留——本出口纯只读、不依赖账本存在。
         */
        const cPath = join(dirname(governanceSpecRootOf()), 'CONSTITUTION.md')
        let text: string
        try {
          text = readFileSync(cPath, 'utf8')
        } catch (e) {
          return { ok: false, reason: 'constitution-unreadable', message: '拒绝：插件宪法读不到（' + String((e as Error)?.message ?? e) + '）。' }
        }
        const digest = 'sha256:' + createHash('sha256').update(text, 'utf8').digest('hex')
        return {
          ok: true,
          text: JSON.stringify({
            ok: true,
            path: 'constitution',
            digest,
            bytes: Buffer.byteLength(text, 'utf8'),
            note: '以上为**插件版宪法**（随包分发，本摘要即其指纹）。项目级宪法增量走提案单元落账；ledger/CONSTITUTION.md 的写面红线（人工编辑+commit）不变。',
            text,
          }, null, 2),
          truncated: false,
          bytes: 0,
        }
      }
      // v4：边界改为**账本目录**（D7）—— 只读自己的账本，不读工作区内的项目文档（D6）。
      const root = deps.resolveRoot()
      if (root === undefined) {
        return { ok: false, reason: 'no-ledger-root', message: '拒绝：无法确定账本目录。' }
      }
      if (String(args.path ?? '').trim() === 'notifications') {
        /**
         * ⚠ 2026-11-23 · notify 档读数（只读）：中等风险动作**放行 + 留痕**，这里把它们端出来。
         *   ⛔ 不是批准凭证、⛔ 不改任何门禁；文件不存在 = 空（不是读不到）。
         */
        const root = deps.resolveRoot()
        if (root === undefined) return { ok: false, reason: 'no-ledger-root', message: '拒绝：无法确定账本目录。' }
        const limit = Number(args.notifyLimit ?? 20)
        const r = readNotifications(root, Number.isFinite(limit) && limit > 0 ? limit : 20)
        if (r.readable !== true) return { ok: false, reason: 'notify-unreadable', message: '通知账本读不到：' + r.reason }
        return {
          ok: true,
          text: JSON.stringify({ ok: true, path: 'notifications', readonly: true, total: r.total, rows: r.rows }, null, 2),
          truncated: false,
          bytes: 0,
        } as unknown as JsonValue
      }
      if (String(args.path ?? '').trim() === 'diagnostics') {
        /**
         * ⚠ 批6（2026-11-21 · 方案6）：写入异常的**只读诊断出口** ——
         *   fail-closed 拒绝本身不动（账本约束），把「请人工检查」降为「人只看结论」：
         *   盘面清点（units / 生成物在场性 / runtime 文件 / effects 摘要（只计数不带内容）/
         *   归档副本 / 锁判读）一次给全。纯只读：不开队列锁、不写任何文件。
         */
        const diag: Record<string, unknown> = { ledgerRoot: root }
        try {
          const files = readdirSync(join(root, 'ledger', 'units'))
          diag.units = { toml: files.filter((f) => f.endsWith('.toml')).length, files: files.slice(0, 60) }
        } catch (e) {
          diag.units = { error: String((e as Error)?.message ?? e) }
        }
        const pages: Record<string, boolean> = {}
        for (const rel of ['ledger/gen/stages.md', 'ledger/gen/index.md', 'ledger/spec/current.md', 'ledger/spec/checkpoint.md']) {
          pages[rel] = existsSync(join(root, rel))
        }
        diag.generated_pages = pages
        try {
          const rt = join(root, 'runtime')
          const files = existsSync(rt) ? readdirSync(rt) : []
          diag.runtime = files.map((f) => {
            let bytes = -1
            try { bytes = statSync(join(rt, f)).size } catch { /* 判不出就算了 */ }
            return { file: f, bytes }
          })
        } catch (e) {
          diag.runtime = { error: String((e as Error)?.message ?? e) }
        }
        try {
          const fx = join(root, 'runtime', 'effects.json')
          if (existsSync(fx)) {
            const st = JSON.parse(readFileSync(fx, 'utf8')) as { rows?: Array<{ abandonedAt?: number }> }
            const rows = Array.isArray(st.rows) ? st.rows : []
            diag.effects = { rows: rows.length, abandoned: rows.filter((r) => r.abandonedAt !== undefined).length, active: rows.filter((r) => r.abandonedAt === undefined).length }
            const lockPath = fx + '.lock'
            if (existsSync(lockPath)) {
              let pid: number | undefined
              try { pid = (JSON.parse(readFileSync(lockPath, 'utf8')) as { pid?: number }).pid } catch { pid = undefined }
              diag.effects_lock = { exists: true, pid, alive: pid === undefined ? undefined : procProcessAlive(pid) }
            } else diag.effects_lock = { exists: false }
          } else diag.effects = { rows: 0, note: '无 effects 文件（尚无补投负载）' }
        } catch (e) {
          diag.effects = { error: String((e as Error)?.message ?? e) }
        }
        try {
          const ar = join(root, 'archive')
          diag.archive = existsSync(ar)
            ? readdirSync(ar, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
            : []
        } catch (e) {
          diag.archive = { error: String((e as Error)?.message ?? e) }
        }
        return {
          ok: true,
          text: JSON.stringify({ ok: true, path: 'diagnostics', diagnosis: diag, note: '只读盘面清点；处置动作各有其出口（hob_ledger_rebuild / hob_orch_control retry-abandoned / hob_ledger_status）。' }, null, 2),
          truncated: false,
          bytes: 0,
        }
      }
      if (String(args.path ?? '').trim() === 'risk/binding-digest') {
        /**
         * ⚠ 2026-11-21 · C 扩展：绑定摘要的服务端出口（riskBindingDigestOf）。
         *   从**账本盘面**取单元实算 —— ⛔ 不接受调用方传方案事实（防注入、防两处真相）：
         *   digest 绑定的是盘上方案字段与需求验收事实；算出的值由会话经自己的写面落账。
         *   顺带给出每条需求验收条件的机器 id（acceptanceCriteriaIdsOf，G3 覆盖用）。
         *   纯只读：不落账、不改文件。
         */
        const wanted = String(args.riskBindingPlanId ?? '').trim()
        let units: Array<Record<string, unknown>>
        try {
          units = deps.readUnits(root) as Array<Record<string, unknown>>
        } catch (e) {
          return { ok: false, reason: 'ledger-unreadable', message: '拒绝：账本读不到（' + String((e as Error)?.message ?? e) + '）。' }
        }
        const plans = units.filter((u) => String(u.kind ?? '') === 'change' || String(u.kind ?? '') === 'plan')
        if (wanted !== '') {
          const hit = plans.find((p) => String(p.id ?? '') === wanted)
          if (hit === undefined) {
            return { ok: false, reason: 'binding-plan-not-found', message: '拒绝：找不到方案单元 ' + wanted + '；盘上的方案/计划单元：' + (plans.map((p) => String(p.id ?? '')).join(', ') || '(无)') + '。' }
          }
        }
        const selected = wanted === '' ? plans : plans.filter((p) => String(p.id ?? '') === wanted)
        const bindings = selected.map((p) => ({
          id: String(p.id ?? ''),
          kind: String(p.kind ?? ''),
          digest: riskBindingDigestOf(p, units),
          current: p.risk_binding_digest === undefined ? undefined : String(p.risk_binding_digest),
        }))
        const requirementCriteria = units
          .filter((u) => String(u.kind ?? '') === 'req')
          .map((r) => ({ id: String(r.id ?? ''), revision: String(r.revision ?? ''), criteria: acceptanceCriteriaIdsOf(r) }))
        return {
          ok: true,
          text: JSON.stringify({ ok: true, path: 'risk/binding-digest', bindings, requirement_criteria: requirementCriteria }, null, 2),
          truncated: false,
          bytes: 0,
        }
      }
      if (String(args.path ?? '').trim() === 'risk/digest' && String(args.riskDigestUnitId ?? '').trim() !== '') {
        /**
         * ⚠ 2026-11-22 · 单元实算模式：**从账本单元自身的风险字段**推导（riskFactsOf，
         *   与门禁同一份纯函数），⛔ 不采信调用方复述的维度/触发/交付域 ——
         *   那正是 2026-11-22 实测的死结形态：调用方传 delivery=internal，而单元里
         *   没有 delivery_scope 字段 ⇒ 门禁按 none 重算 ⇒ 永远配不平。
         *   回包给出**应写入的字段**与**剩余缺口**，会话据此一次配平、⛔ 不再盲试。
         */
        const uid = String(args.riskDigestUnitId ?? '').trim()
        let units: Array<Record<string, unknown>>
        try {
          units = deps.readUnits(root) as Array<Record<string, unknown>>
        } catch (e) {
          return { ok: false, reason: 'ledger-unreadable', message: '拒绝：账本读不到（' + String((e as Error)?.message ?? e) + '）。' }
        }
        const unit = units.find((u) => String(u.id ?? '') === uid)
        if (unit === undefined) {
          return { ok: false, reason: 'risk-unit-not-found', message: '拒绝：账本里没有 ' + uid + '。' }
        }
        const facts = riskFactsOf(unit)
        const derived = riskAssessmentOf({ ...facts, declaredTier: undefined })
        const onDisk = String(unit.risk_inputs_digest ?? '')
        const tier = String(unit.risk_tier ?? '')
        const ruleVersion = String(unit.risk_rule_version ?? '')
        const dims = Object.entries(facts.dimensions ?? {}).map(([k, v]) => k + '=' + String(v))
        const hasStrategy = String(unit.test_strategy ?? '').trim() !== ''
          || (Array.isArray(unit.research_refs) && (unit.research_refs as unknown[]).length > 0)
          || (Array.isArray(unit.review_refs) && (unit.review_refs as unknown[]).length > 0)
        const tierRank = (t: string): number => ({ low: 0, medium: 1, high: 2, critical: 3 } as Record<string, number>)[t] ?? -1
        const needsStrategy = tierRank(derived.tier) >= 1 || tierRank(tier) >= 1
        const problems: string[] = []
        if (onDisk !== derived.inputsDigest) problems.push('RP-3 · risk_inputs_digest 与单元事实不一致（应为 ' + derived.inputsDigest + '，盘上是 ' + (onDisk || '(空)') + '）')
        if (ruleVersion !== RISK_POLICY_VERSION) problems.push('RP-3 · risk_rule_version 应为 ' + RISK_POLICY_VERSION)
        if (tierRank(tier) < tierRank(derived.tier) || tierRank(tier) < 0) problems.push('RP-2 · risk_tier 必须不低于事实推导 ' + derived.tier + (tier === '' ? '（盘上为空）' : '（盘上 ' + tier + '）'))
        if (needsStrategy && !hasStrategy) problems.push('RP-8 · ' + (tier || derived.tier) + ' 档必须有验证策略：test_strategy **必须是字符串**（写成数组会被判空）或 research_refs / review_refs 为非空数组')
        if (String(unit.risk_assessed_at ?? '').trim() === '') problems.push('RP-3 · 缺 risk_assessed_at（可解析的 ISO 时刻）')
        if (String(unit.risk_assessed_by ?? '').trim() === '') problems.push('RP-3 · 缺 risk_assessed_by')
        return {
          ok: true,
          text: JSON.stringify({
            ok: true,
            path: 'risk/digest',
            mode: 'unit',
            unit: { id: uid, kind: String(unit.kind ?? ''), revision: unit.revision, status: String(unit.status ?? '') },
            digest: derived.inputsDigest,
            digest_on_disk: onDisk,
            matches: onDisk === derived.inputsDigest,
            tier_derived: derived.tier,
            closure: derived.closure,
            delivery_used: derived.delivery,
            unit_facts: { dimensions: dims, hardTriggers: facts.hardTriggers ?? [], hardTriggerFacts: facts.hardTriggerFacts ?? [], delivery_scope: (unit.delivery_scope === undefined ? undefined : String(unit.delivery_scope)) },
            write_fields: {
              risk_inputs_digest: derived.inputsDigest,
              risk_rule_version: RISK_POLICY_VERSION,
              risk_dimensions: dims,
              risk_tier: (tierRank(tier) > tierRank(derived.tier) ? tier : derived.tier),
              closure_mode: derived.closure,
              ...(unit.delivery_scope === undefined ? {} : { delivery_scope: String(unit.delivery_scope) }),
              ...(needsStrategy && !hasStrategy ? { test_strategy: '<字符串：写清验证方式（单元/集成/端到端/手工 + 判据）>' } : {}),
            },
            problems,
            note: 'digest 与门禁同一份纯函数（riskFactsOf + riskAssessmentOf）按**单元现值**算；写回 write_fields 后门禁重算即一致。⚠ 若你要改 delivery_scope / 维度 / 硬触发，先改它们再重新取一次本接口——digest 会随之变化。',
          }, null, 2),
          truncated: false,
          bytes: 0,
        }
      }
      if (String(args.path ?? '').trim() === 'approval-form') {
        /**
         * ⚠ 2026-11-21 · A′ 后续：用户批准记录的**形态出口**（只读）。
         *   门禁认的形态 = decision 单元（decision_kind=stage-approval）绑定
         *   artifact_id / artifact_revision / artifact_digest / selected_option。
         *   其中 artifact_digest 是实现内哈希（artifactDigestOf）—— 会话侧算不出，
         *   这里按盘面现值实算并给出完整单元模板；校验（修订一致 / 路径在列 /
         *   决定在封闭集）在此预检，权威判定仍在门禁。落账走会话自己的写面，
         *   ⛔ 本出口不写任何文件。
         */
        const aid = String(args.approvalArtifactId ?? '').trim()
        if (aid === '') {
          return { ok: false, reason: 'approval-artifact-required', message: '拒绝：approval-form 必须给 approvalArtifactId（R-… 或 CHG-…）。' }
        }
        const decision = String(args.approvalDecision ?? 'approve').trim() || 'approve'
        if (decision !== 'approve' && decision !== 'request-changes') {
          return { ok: false, reason: 'decision-invalid', message: '拒绝：approvalDecision 只收 approve / request-changes。' }
        }
        let units: Array<Record<string, unknown>>
        try {
          units = deps.readUnits(root) as Array<Record<string, unknown>>
        } catch (e) {
          return { ok: false, reason: 'ledger-unreadable', message: '拒绝：账本读不到（' + String((e as Error)?.message ?? e) + '）。' }
        }
        const artifact = units.find((u) => String(u.id ?? '') === aid)
        if (artifact === undefined) {
          return { ok: false, reason: 'approval-artifact-not-found', message: '拒绝：账本里没有 ' + aid + '。' }
        }
        const kind = String(artifact.kind ?? '')
        if (kind !== 'req' && kind !== 'change') {
          return { ok: false, reason: 'approval-artifact-not-approvable', message: '拒绝：' + aid + ' 是 ' + kind + '，只有需求和方案需要用户阶段批准。' }
        }
        const revision = Number(artifact.revision)
        if (!Number.isSafeInteger(revision) || revision <= 0) {
          return { ok: false, reason: 'revision-missing', message: '拒绝：' + aid + ' 缺正整数 revision，无法绑定批准版本。' }
        }
        const selected = String(args.approvalSelectedOption ?? '').trim()
        if (kind === 'change' && decision === 'approve' && !selectedOptionValid(artifact, selected)) {
          const options = Array.isArray(artifact.path_options) ? (artifact.path_options as unknown[]).map(String) : []
          return { ok: false, reason: 'selected-option-invalid', message: '拒绝：方案批准必须给 selected_option 且在当前 path_options 中（当前：' + (options.join(' / ') || '(无可选路径)') + '）。' }
        }
        const form = {
          kind: 'decision',
          decision_kind: 'stage-approval',
          status: 'active',
          artifact_id: aid,
          artifact_revision: revision,
          artifact_digest: artifactDigestOf(artifact),
          decision,
          ...(selected === '' ? {} : { selected_option: selected }),
          decided_by: 'user',
        }
        return {
          ok: true,
          text: JSON.stringify({
            ok: true,
            path: 'approval-form',
            note: 'id 与 decided_at 由写入方按账本编号规则与真实回执时间补齐；source 建议附用户回执原文。以下字段为门禁认的形态，写入后由阶段门禁复核。',
            unit_fields: form,
          }, null, 2),
          truncated: false,
          bytes: 0,
        }
      }
  return undefined
}
