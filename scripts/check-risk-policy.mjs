#!/usr/bin/env node
/**
 * Risk policy self-check for Pipeline v3.
 *
 * Guards the facts that must not be averaged away:
 *   - hard triggers raise the floor;
 *   - a severe single dimension raises the floor;
 *   - declared tier cannot be below the derived tier;
 *   - high/critical require independent design review;
 *   - critical requires dual review and residual-risk acceptance;
 *   - closure mode is derived from risk and delivery scope.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
let pass = 0
let fail = 0
const ok = (m) => { pass += 1; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail += 1; console.log(`  ✗ ${m}`) }

const rp = await import(pathToFileURL(join(root, 'src', 'shared', 'risk-policy.ts')).href)
/** ⚠ **R-23**：本族要对照 `stage-controls` 的 C-15（同一件事的另一处实现）。 */
const sc = await import(pathToFileURL(join(root, 'src', 'shared', 'stage-controls.ts')).href)

const base = {
  scope: 'local', severity: 'minor', reversibility: 'easy', detectability: 'automatic',
  uncertainty: 'known', changeSurface: 'one-point', dependencies: 'independent',
  verificationMaturity: 'proven', recoveryTime: 'minutes', exposure: 'internal',
}
const change = (extra = {}) => ({
  id: 'CHG-RISK', kind: 'change', status: 'settled', title: '风险夹具',
  pipeline_version: 'v3', revision: '1', built_by: 'session-author',
  risk_tier: 'low', risk_rule_version: 'v1', risk_assessed_by: 'Hob',
  risk_assessed_at: '2026-11-08T00:00:00+08:00',
  risk_hard_triggers: [], risk_dimensions: Object.entries(base).map(([k, v]) => `${k}=${v}`),
  risk_hard_trigger_facts: [],
  delivery_scope: 'none', reviewer: '', review_refs: [], ...extra,
})

const hardFact = (trigger) => `${trigger} | 夹具事实 | 夹具影响对象 | EVD-FACT | 夹具控制措施 | 残余风险已登记`

console.log('')
console.log('RP 组：风险策略（硬触发 / 单维下限 / 残余风险 / 收口档位）')
console.log('')

// RP-1 hard trigger raises the floor.
{
  const facts = { dimensions: base, hardTriggers: ['irreversible-data-change'], delivery: 'none' }
  const a = rp.riskAssessmentOf(facts)
  const p = []
  if (a.tier !== 'critical') p.push(`推导=${a.tier}（期望 critical）`)
  if (a.closure !== 'strict') p.push(`收口=${a.closure}（期望 strict）`)
  if (p.length === 0) ok('RP-1 ✓ 负向对拍：低分其余维度不能抵消不可逆数据变更 ⇒ critical + strict')
  else for (const x of p) bad(`RP-1 · ${x}`)
}

// RP-2 one severe dimension cannot be averaged away.
{
  const dims = { ...base, severity: 'critical' }
  const a = rp.riskAssessmentOf({ dimensions: dims, delivery: 'none' })
  if (a.tier === 'high' || a.tier === 'critical') ok(`RP-2 ✓ 负向对拍：单维 severity=critical 即使总分低也至少 high（实测 ${a.tier}）`)
  else bad(`RP-2 · severity=critical 被平均成 ${a.tier}`)
}

// RP-3 declared tier below derivation is rejected.
{
  const unit = change({ risk_hard_triggers: ['permission-boundary-change'], risk_hard_trigger_facts: [hardFact('permission-boundary-change')], risk_tier: 'low',
    risk_inputs_digest: rp.riskAssessmentOf({ dimensions: base, hardTriggers: ['permission-boundary-change'], delivery: 'none' }).inputsDigest })
  const probs = rp.riskAssessmentProblems(unit)
  if (probs.some((x) => x.rule === 'RP-2')) ok(`RP-3 ✓ 负向对拍：声明 low 低于硬触发推导 ${rp.riskAssessmentOf({ dimensions: base, hardTriggers: ['permission-boundary-change'], delivery: 'none' }).tier} ⇒ RP-2`)
  else bad('RP-3 · 声明低档未击穿硬触发')
}

// RP-4 high/critical review requirements.
{
  const dims = { ...base, severity: 'major', scope: 'external' }
  const a = rp.riskAssessmentOf({ dimensions: dims, delivery: 'external' })
  const unit = change({ risk_dimensions: Object.entries(dims).map(([k, v]) => `${k}=${v}`), risk_tier: a.tier,
    risk_inputs_digest: a.inputsDigest, risk_hard_triggers: [], delivery_scope: 'external' })
  const probs = rp.riskAssessmentProblems(unit)
  if (probs.some((x) => x.rule === 'RP-4')) ok('RP-4 ✓ 高风险缺独立评审 / 评审证据 ⇒ RP-4 必红')
  else bad(`RP-4 · 高风险缺评审未红：${JSON.stringify(probs)}`)
}

// RP-5 critical needs dual review.
{
  const dims = { ...base, severity: 'critical', reversibility: 'irreversible' }
  const a = rp.riskAssessmentOf({ dimensions: dims, delivery: 'external' })
  const unit = change({ risk_dimensions: Object.entries(dims).map(([k, v]) => `${k}=${v}`), risk_tier: a.tier,
    risk_inputs_digest: a.inputsDigest, delivery_scope: 'external', reviewer: 'reviewer-A', review_refs: ['archive/a.md'] })
  const probs = rp.riskAssessmentProblems(unit)
  if (probs.some((x) => x.rule === 'RP-5')) ok('RP-5 ✓ critical 只有一份评审证据 ⇒ RP-5 必红')
  else bad(`RP-5 · critical 单评审未红：${JSON.stringify(probs)}`)
}

// RP-6 closure mode cannot be under-declared.
{
  const unit = change({ risk_hard_triggers: ['unrecoverable-publish'], risk_hard_trigger_facts: [hardFact('unrecoverable-publish')], closure_mode: 'standard',
    risk_inputs_digest: rp.riskAssessmentOf({ dimensions: base, hardTriggers: ['unrecoverable-publish'], delivery: 'external' }).inputsDigest })
  const probs = rp.riskAssessmentProblems(unit)
  if (probs.some((x) => x.rule === 'RP-6')) ok('RP-6 ✓ 不可撤回发布声明 standard ⇒ RP-6 必红（应为 strict）')
  else bad('RP-6 · 收口档位降级未被拒绝')
}

// RP-7 residual risk needs acceptance.
{
  const probs = rp.residualRiskProblems({ tier: 'high' })
  const good = rp.residualRiskProblems({ tier: 'high', acceptedBy: 'user', conditions: ['监控一周'],
    impact: '仅影响内部试用户', monitoring: '发布后监控一周，异常可回滚' })
  if (probs.length > 0 && good.length === 0) ok('RP-7 ✓ 负向对拍：high 残余风险无接受者 ⇒ 红；有接受者与条件 ⇒ 绿')
  else bad(`RP-7 · 残余风险接受口径不对：${JSON.stringify({ probs, good })}`)
}

// RP-8 delivery scope derivation.
{
  const skipped = rp.riskAssessmentOf({ dimensions: base, delivery: 'none' })
  const standard = rp.riskAssessmentOf({ dimensions: base, delivery: 'external' })
  if (skipped.closure === 'skipped' && standard.closure === 'standard') ok('RP-8 ✓ 无外部交付 ⇒ skipped；外部交付 ⇒ standard')
  else bad(`RP-8 · 收口派生不对：${skipped.closure}/${standard.closure}`)
}

// RP-9 missing assessment cannot look low.
{
  const bare = { id: 'CHG-BARE', kind: 'change', status: 'settled', pipeline_version: 'v3', revision: '1' }
  const probs = rp.riskAssessmentProblems(bare)
  if (probs.some((x) => x.rule === 'RP-9')) ok('RP-9 ✓ 负向对拍：缺风险评定不能显示成 low ⇒ RP-9')
  else bad('RP-9 · 缺评定未红')
}

// RP-11: every hard trigger needs its own six-field fact; a trigger name alone is not evidence.
{
  const a = rp.riskAssessmentOf({ hardTriggers: ['permission-boundary-change'], dimensions: base, delivery: 'none' })
  const unit = change({ risk_hard_triggers: ['permission-boundary-change'], risk_tier: a.tier,
    risk_inputs_digest: a.inputsDigest })
  const probs = rp.riskAssessmentProblems(unit)
  const withFact = change({ risk_hard_triggers: ['permission-boundary-change'],
    risk_hard_trigger_facts: [hardFact('permission-boundary-change')], risk_tier: a.tier,
    risk_inputs_digest: rp.riskAssessmentOf({ hardTriggers: ['permission-boundary-change'],
      hardTriggerFacts: [hardFact('permission-boundary-change')], dimensions: base, delivery: 'none' }).inputsDigest })
  const good = rp.riskAssessmentProblems(withFact)
  if (probs.some((x) => x.rule === 'RP-1' && x.why.includes('逐项事实')) && !good.some((x) => x.rule === 'RP-1')) {
    ok('RP-11 ✓ 硬触发只有标签 ⇒ RP-1 红；补齐 fact / affected / evidence / mitigation / residual 六段式 ⇒ 放行')
  } else bad(`RP-11 · 硬触发事实门禁不对：${JSON.stringify({ probs, good })}`)
}

// RP-12: a declared tier may raise risk but never lower the derivation.
{
  const dims = { ...base, severity: 'critical' }
  const unit = change({ risk_dimensions: Object.entries(dims).map(([k, v]) => `${k}=${v}`), risk_tier: 'medium',
    risk_inputs_digest: rp.riskAssessmentOf({ dimensions: dims, delivery: 'none' }).inputsDigest })
  const probs = rp.riskAssessmentProblems(unit)
  if (probs.some((x) => x.rule === 'RP-2' && x.why.includes('低于事实推导'))) {
    ok('RP-12 ✓ 负向对拍：把 severity=critical 声明成 medium ⇒ RP-2 必红（声明档位不能覆盖事实）')
  } else bad(`RP-12 · 声明低档没有击穿单维下限：${JSON.stringify(probs)}`)
}

// RP-13: task risk is a separate layer with executable controls.
{
  const baseTask = { id: 'TSK-RP', kind: 'task', status: 'todo', title: '任务风险夹具', parent: 'CHG-RP',
    pipeline_version: 'v3', revision: '1' }
  const missing = rp.taskRiskProblems(baseTask)
  const high = rp.taskRiskProblems({ ...baseTask, task_risk: 'critical', risk_reasons: ['写权限边界'],
    touched_surfaces: ['src/auth'], irreversible_actions: [], requires_isolation: 'false', requires_serial_execution: 'false', reviewer: '', review_refs: [] })
  const good = rp.taskRiskProblems({ ...baseTask, task_risk: 'high', risk_reasons: ['改权限边界'],
    touched_surfaces: ['src/auth'], irreversible_actions: ['revoke-token'], requires_isolation: 'true',
    requires_review: 'true', requires_serial_execution: 'true', reviewer: 'reviewer-A', review_refs: ['archive/review.md'], rollback_refs: ['EVD-RB'] })
  if (missing.some((x) => x.rule === 'RP-4') && high.length > 0 && good.length === 0) {
    ok('RP-13 ✓ 负向对拍：v3 任务缺 task_risk ⇒ RP-4；critical 缺隔离 / 串行 / 评审 ⇒ 红；控制齐全 ⇒ 放行')
  } else bad(`RP-13 · 任务执行风险口径不对：${JSON.stringify({ missing, high, good })}`)
}

// RP-14: overlapping task write scopes require explicit serialization.
{
  const a = { id: 'TSK-A', kind: 'task', status: 'todo', parent: 'CHG-X', scope_paths: ['src/auth'] }
  const b = { id: 'TSK-B', kind: 'task', status: 'todo', parent: 'CHG-X', scope_paths: ['src/auth/session.ts'] }
  const overlap = rp.taskScopeConflict(a, b)
  if (typeof overlap === 'string' && overlap.includes('src/auth')) {
    ok(`RP-14 ✓ 负向对拍：两任务写同一 / 嵌套路径 ⇒ 判出冲突（${overlap}），G3 必须串行或拆契约`)
  } else bad(`RP-14 · 写范围冲突没有判出：${JSON.stringify(overlap)}`)
}

// RP-10 residual cannot replace intrinsic.
{
  const lowResidual = rp.residualRiskProblems({ tier: 'low' })
  const hard = rp.riskAssessmentOf({ dimensions: base, hardTriggers: ['permission-boundary-change'], delivery: 'none' })
  if (lowResidual.length === 0 && hard.tier === 'high') ok('RP-10 ✓ 残余 low 不能把固有硬触发 high 降成 low')
  else bad('RP-10 · 固有风险被残余风险抵消')
}

// RP-15: plan facts changing make the old assessment stale.
{
  const pipeline = await import(pathToFileURL(join(root, 'src', 'shared', 'pipeline.ts')).href)
  const before = { id: 'CHG-STALE', kind: 'change', title: '方案', req_ids: ['R-1'],
    path_options: ['A'], path_tradeoffs: ['A 快'], path_decision: 'A',
    requirement_coverage: ['R-1 → A'], delivery_scope: 'none' }
  const after = { ...before, requirement_coverage: ['R-1 → A', 'R-1 → B'], delivery_scope: 'external' }
  const d1 = pipeline.riskBindingDigestOf(before)
  const d2 = pipeline.riskBindingDigestOf(after)
  if (d1 !== d2) ok('RP-15 ✓ 负向对拍：方案交付范围 / 需求映射变化 ⇒ 风险绑定摘要变化（旧评定 stale，必须重评）')
  else bad('RP-15 · 方案事实变化后绑定摘要不变 ⇒ 旧风险评定可被静默复用')
}

// RP-15b: the acceptance object and its criteria are bound risk inputs.
{
  const pipeline = await import(pathToFileURL(join(root, 'src', 'shared', 'pipeline.ts')).href)
  const plan = { id: 'CHG-ACC-BIND', kind: 'change', title: '方案', req_ids: ['R-1'],
    path_options: ['A'], path_tradeoffs: ['A 快'], path_decision: 'A',
    requirement_coverage: ['R-1 → A'], delivery_scope: 'external' }
  const reqA = { id: 'R-1', kind: 'req', revision: '2', acceptance_criteria: ['保存后出现提示'], clarify_examples: ['点保存'] }
  const reqB = { ...reqA, acceptance_criteria: ['保存后出现提示且权限不足时不得提示成功'] }
  const reqC = { ...reqA, revision: '3' }
  const p = []
  if (pipeline.riskBindingDigestOf(plan, [reqA]) === pipeline.riskBindingDigestOf(plan, [reqB])) {
    p.push('验收条件变化后绑定摘要不变')
  }
  if (pipeline.riskBindingDigestOf(plan, [reqA]) === pipeline.riskBindingDigestOf(plan, [reqC])) {
    p.push('验收对象修订变化后绑定摘要不变')
  }
  if (p.length === 0) ok('RP-15b ✓ 负向对拍：验收条件或验收对象修订变化 ⇒ 风险绑定摘要失效，旧评定不能复用')
  else for (const x of p) bad(`RP-15b · ${x}`)
}

// RP-16: a hard trigger whose six-field fact is malformed is rejected.
{
  const a = rp.riskAssessmentOf({ hardTriggers: ['permission-boundary-change'],
    hardTriggerFacts: [hardFact('permission-boundary-change')], dimensions: base, delivery: 'none' })
  const unit = change({ risk_hard_triggers: ['permission-boundary-change'], risk_tier: a.tier,
    risk_hard_trigger_facts: ['permission-boundary-change | 只有两段'], risk_inputs_digest: a.inputsDigest })
  const probs = rp.riskAssessmentProblems(unit)
  if (probs.some((x) => x.rule === 'RP-1' && x.why.includes('六段式'))) {
    ok('RP-16 ✓ 负向对拍：硬触发事实只有两段 ⇒ RP-1 红（不接受残缺事实）')
  } else bad(`RP-16 · 残缺硬触发事实没有被拒：${JSON.stringify(probs)}`)
}

// RP-17: a hard trigger without the trigger list is an orphan fact.
{
  const unit = change({ risk_hard_triggers: [], risk_hard_trigger_facts: [hardFact('permission-boundary-change')] })
  const probs = rp.riskAssessmentProblems(unit)
  if (probs.some((x) => x.rule === 'RP-1' && x.why.includes('没有出现在'))) {
    ok('RP-17 ✓ 负向对拍：有事实但没有列入 risk_hard_triggers ⇒ RP-1 红（单边声明）')
  } else bad(`RP-17 · 孤儿硬触发事实没有被拒：${JSON.stringify(probs)}`)
}

// RP-18: a single maximum dimension cannot be averaged away.
{
  const dims = { ...base, detectability: 'latent' }
  const a = rp.riskAssessmentOf({ dimensions: dims, delivery: 'none' })
  const p = []
  if (!['high', 'critical'].includes(a.tier)) p.push(`detectability=latent 被平均成 ${a.tier}`)
  const two = { ...base, severity: 'major', uncertainty: 'unknown' }
  const b = rp.riskAssessmentOf({ dimensions: two, delivery: 'none' })
  if (!['medium', 'high', 'critical'].includes(b.tier)) p.push(`两个高风险维度被平均成 ${b.tier}`)
  if (p.length === 0) ok('RP-18 ✓ 负向对拍：单维 4 与两个高风险维度都不能被平均成低档')
  else for (const x of p) bad(`RP-18 · ${x}`)
}

// RP-19: boundary hard triggers cannot be under-declared as standard.
{
  const a = rp.riskAssessmentOf({ dimensions: base, hardTriggers: ['permission-boundary-change'], delivery: 'none' })
  if (a.closure === 'strict') ok('RP-19 ✓ 权限边界硬触发即使无外部交付也派生 strict 收口')
  else bad(`RP-19 · 权限边界收口=${a.closure}（期望 strict）`)
}

// RP-20: the current rule version is accepted (the version check is not a blanket rejection).
{
  const a = rp.riskAssessmentOf({ dimensions: base, delivery: 'none' })
  const unit = change({ risk_binding_version: 'v1', risk_tier: a.tier, risk_inputs_digest: a.inputsDigest })
  const probs = rp.riskAssessmentProblems(unit)
  if (probs.length === 0) ok('RP-20 ✓ 当前规则版本 v1 的评定被接受（版本比较不是恒拒）')
  else bad(`RP-20 · 当前规则版本仍被拒：${JSON.stringify(probs)}`)
}

// RP-21: linked open / handling risks cannot be treated as closed by the plan or G6.
{
  const openRisk = { id: 'RSK-OPEN', kind: 'risk', status: 'open', risk_tier: 'high', owner: 'user' }
  const handlingRisk = { id: 'RSK-HANDLING', kind: 'risk', status: 'handling', risk_tier: 'high', owner: 'user', disposition: '正在处置' }
  const closedRisk = { id: 'RSK-CLOSED', kind: 'risk', status: 'closed', risk_tier: 'low', owner: 'user', disposition: '已关闭', verification_refs: ['EVD-1'] }
  const plan = change({ risk_ids: ['RSK-OPEN'] })
  const closure = { id: 'CLS-RISK', kind: 'closure', status: 'closed', pipeline_version: 'v3', risk_ids: ['RSK-HANDLING'] }
  const p = []
  if (!rp.riskObjectProblems([plan, openRisk]).some((x) => x.rule === 'RP-7' && x.why.includes('open'))) {
    p.push('方案关联 open 风险却没有 RP-7')
  }
  if (!rp.riskObjectProblems([closure, handlingRisk]).some((x) => x.rule === 'RP-7' && x.why.includes('handling'))) {
    p.push('G6 关联 handling 风险却没有 RP-7')
  }
  if (rp.riskObjectProblems([change({ risk_ids: ['RSK-CLOSED'] }), closedRisk]).length !== 0) {
    p.push('已关闭且有证据的风险被误拒')
  }
  if (p.length === 0) ok('RP-21 ✓ 负向对拍：关联 open 风险不能推进、G6 不能带 handling 风险收口；已关闭且有证据的风险放行')
  else for (const x of p) bad(`RP-21 · ${x}`)
}

// RP-22: medium G2 requires a real path comparison and verification strategy.
{
  const stage = await import(pathToFileURL(join(root, 'src', 'shared', 'stage-controls.ts')).href)
  const basePlan = {
    id: 'CHG-G2', kind: 'change', status: 'settled', pipeline_version: 'v3', revision: '1',
    path_options: ['A', 'B'], path_tradeoffs: ['A 快'], path_decision: '选 A', requirement_coverage: ['R-1 → A'],
    risk_tier: 'medium', risk_rule_version: 'v1', risk_assessed_by: 'Hob', risk_assessed_at: '2026-11-08T00:00:00Z',
    risk_hard_triggers: [], risk_hard_trigger_facts: [], risk_dimensions: Object.entries(base).map(([k, v]) => `${k}=${v}`),
    delivery_scope: 'none', risk_assessment_ref: 'CHG-G2#1', risk_binding_version: 'v1',
    risk_inputs_digest: rp.riskAssessmentOf({ dimensions: base, delivery: 'none' }).inputsDigest,
  }
  const pipeline = await import(pathToFileURL(join(root, 'src', 'shared', 'pipeline.ts')).href)
  const req = { id: 'R-1', kind: 'req', status: 'agreed', pipeline_version: 'v3', revision: '1' }
  const missingPlan = { ...basePlan, path_options: ['A'], path_tradeoffs: ['A 快'], test_strategy: '单元 + 回归' }
  missingPlan.risk_binding_digest = pipeline.riskBindingDigestOf(missingPlan, [req])
  const noStrategyPlan = { ...basePlan, path_options: ['A', 'B'], path_tradeoffs: ['A 快', 'B 稳'], test_strategy: '' }
  noStrategyPlan.risk_binding_digest = pipeline.riskBindingDigestOf(noStrategyPlan, [req])
  const goodPlan = { ...basePlan, path_tradeoffs: ['A 快', 'B 稳'], test_strategy: '单元 + 回归' }
  goodPlan.risk_binding_digest = pipeline.riskBindingDigestOf(goodPlan, [req])
  const missing = stage.planProblems(missingPlan, [req])
  const noStrategy = stage.planProblems(noStrategyPlan, [req])
  const good = stage.planProblems(goodPlan, [req])
  const p = []
  if (!missing.some((x) => x.rule === 'C-4')) p.push('medium 缺路径比较未红')
  if (!noStrategy.some((x) => x.rule === 'RP-8')) p.push('medium 缺验证策略未红')
  if (good.length !== 0) p.push(`medium 齐全仍被拒：${good.map((x) => x.rule + ':' + x.why).join(' / ')}`)
  if (p.length === 0) ok('RP-22 ✓ 负向对拍：medium 必须有路径比较与验证策略；补齐后放行（⛔ 不是恒拒）')
  else for (const x of p) bad(`RP-22 · ${x}`)
}

// RP-20b: risk object fields have their own closed vocabulary and closure evidence.
{
  const risk = { id: 'RSK-OBJ', kind: 'risk', status: 'closed', pipeline_version: 'v3', title: '风险', risk_tier: 'high',
    category: 'data', owner: 'user', disposition: '已处置', verification_refs: ['EVD-1'], mitigation: ['备份'],
    likelihood: 'possible', impact: 'major', detectability: 'monitored', reversibility: 'costly', residual_tier: 'medium' }
  const bad = rp.riskObjectProblems([{ ...risk, category: 'unknown-category', likelihood: 'sometimes' }])
  const good = rp.riskObjectProblems([risk])
  const p = []
  if (bad.length < 2) p.push(`非法风险对象字段未逐项点名：${JSON.stringify(bad)}`)
  if (good.length !== 0) p.push(`合法风险对象被误拒：${JSON.stringify(good)}`)
  if (p.length === 0) ok('RP-20b ✓ 负向对拍：风险对象类别 / 可能性等字段走封闭集；完整且有证据的对象放行')
  else for (const x of p) bad(`RP-20b · ${x}`)
}

// RP-23: a technical verification that discovers an undeclared risk cannot PASS.
{
  const stage = await import(pathToFileURL(join(root, 'src', 'shared', 'stage-controls.ts')).href)
  const plan = change({ risk_ids: ['RSK-KNOWN'] })
  const task = { id: 'TSK-NEW', kind: 'task', status: 'built', parent: plan.id, pipeline_version: 'v3', built_by: 'dev' }
  const ver = { id: 'VER-NEW', kind: 'verification', status: 'pass', parent: task.id, pipeline_version: 'v3', verifier: 'verifier',
    verification_session: 'verifier', verified_at: '2026-11-08T00:00:00Z', basis: ['EVD-1'], evidence_refs: ['EVD-1'], criteria_refs: ['AC-1'],
    new_risk_refs: ['RSK-NEW'], new_risk_reason: '跨实例恢复时发现新的权限残留' }
  const p = stage.verificationProblems(ver, [plan, task, ver])
  if (p.some((x) => x.rule === 'RP-6' && x.why.includes('新风险'))) {
    ok('RP-23 ✓ 负向对拍：技术验证发现方案未声明的风险 ⇒ 不能 PASS，必须回 G2 重评')
  } else bad(`RP-23 · 未声明的新风险仍可 PASS：${JSON.stringify(p)}`)
}

// ── RP-24：R-23 —— 评审要求必须按「有效档位」判，⛔ 不是按「纯推导档位」 ──────────
//
//  ⚠ 这条钉的是**同一件事两处结论相反**（实测，声明 high / 事实推导 low）：
//
//  | 判据 | 用哪个 tier | 结果 |
//  |---|---|---|
//  | `stage-controls` C-15 | **声明值** `u.risk_tier` | 2 条（缺评审者 / 缺证据） |
//  | `risk-policy` RP-4/RP-5 | **推导值** `derived.tier`（改前） | 0 条 |
//
//  ⇒ 松的那一处正好是**用户自己声明高风险**的情形 ——
//    「我声明这是 high」却按 low 要求评审，等于把用户的保守声明当成噪音。
//
//  ⚠ 修法不是「把 derived 换成含 declared 的」：
//    RP-2 的「声明不得低于推导」必须继续用**纯推导值**（否则声明 low 时会拿 low 跟 low 比 ⇒ 恒真）。
//    ⇒ 两个值各有用途，分开命名（`derived.tier` vs `effectiveTier`）。
{
  const p = []
  const dims = ['scope=local', 'severity=negligible', 'reversibility=easy', 'detectability=automatic',
    'uncertainty=known', 'changeSurface=one-point', 'dependencies=independent',
    'verificationMaturity=proven', 'recoveryTime=minutes', 'exposure=internal']
  const base = {
    id: 'CHG-RP24', kind: 'change', status: 'settled', pipeline_version: 'v3', revision: '1',
    title: 't', path_options: ['A', 'B'], path_tradeoffs: ['a', 'b'], path_decision: 'A',
    requirement_coverage: ['R-1 → x'], risk_rule_version: 'v1',
    risk_dimensions: dims, risk_hard_triggers: [], reviewer: '', review_refs: [], built_by: 'dev',
  }
  for (const declared of ['low', 'medium', 'high', 'critical']) {
    const u = { ...base, risk_tier: declared }
    const c15 = sc.planProblems(u, [u]).filter((x) => x.rule === 'C-15').length
    const rp45 = rp.riskAssessmentProblems(u, [u]).filter((x) => x.rule === 'RP-4' || x.rule === 'RP-5').length
    /** ⚠ 判据：两处**要么都说要评审、要么都说不用**（⛔ 不许一处要一处不要）。 */
    if ((c15 > 0) !== (rp45 > 0)) {
      p.push('声明 ' + declared + ' 时两处结论相反：C-15=' + c15 + ' 条、RP-4/5=' + rp45 + ' 条')
    }
  }
  /** ⚠ 反向对照：声明 high 时**两处都必须非零**（证明不是「两边都恒 0」也算一致）。 */
  const highU = { ...base, risk_tier: 'high' }
  const highC15 = sc.planProblems(highU, [highU]).filter((x) => x.rule === 'C-15').length
  const highRp = rp.riskAssessmentProblems(highU, [highU]).filter((x) => x.rule === 'RP-4' || x.rule === 'RP-5').length
  if (highC15 === 0 || highRp === 0) {
    p.push('声明 high 且无评审者/无证据时，两处都必须报（C-15=' + highC15 + ' RP-4/5=' + highRp + '）⇒ 有一处恒不报')
  }
  if (p.length === 0) {
    ok('RP-24 ✓ **负向对拍**：评审要求按「有效档位」判 —— 声明 high 时 C-15 与 RP-4/5 **同时报**'
      + '（R-23：同一件事不再一处要评审、一处不要）')
  } else for (const x of p) bad('RP-24 · ' + x)
}
// ── RP-25：O-03 —— 档位差异必须收在 riskGateRequirements 里 ──────────────────
//
//  ⚠ 改前 `pathComparison: true` 是**六项里唯一恒真的一个**，而真正的档位差异
//    藏在调用方的 `tier === 'low' ? 1 : 2` 里 ⇒ 字段说一套、调用方另算一套。
//  ⇒ 改成 `minPaths` 后，调用方只判 `options.length < requirements.minPaths`。
{
  const p = []
  const low = rp.riskGateRequirements('low')
  const med = rp.riskGateRequirements('medium')
  const high = rp.riskGateRequirements('high')
  const crit = rp.riskGateRequirements('critical')
  if (typeof low.minPaths !== 'number') p.push('`minPaths` 不是数字 ⇒ 可能又退回布尔字段')
  if (low.minPaths !== 1) p.push('low 应要 1 条路径，实际 ' + low.minPaths)
  for (const pair of [['medium', med], ['high', high], ['critical', crit]]) {
    if (pair[1].minPaths !== 2) p.push(pair[0] + ' 应要 2 条路径，实际 ' + pair[1].minPaths)
  }
  const strip = (x) => x.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
  const sc = strip(readFileSync(join(root, 'src', 'shared', 'stage-controls.ts'), 'utf8'))
  if (sc.includes("tier === 'low' ? 1 : 2")) {
    p.push('`stage-controls.ts` 的**代码**里又出现了 tier 判路径数 ⇒ 档位差异又散回调用方（O-03 复发）')
  }
  if (!sc.includes('requirements.minPaths')) p.push('调用方没有用 `requirements.minPaths` ⇒ 判据可能已分叉')
  if (p.length === 0) {
    ok('RP-25 ✓ **负向对拍**：`riskGateRequirements` 返回 `minPaths`（low=1 / 其余=2），'
      + '调用方只读它（⛔ 不再自己判档位）—— O-03：同一事实只有一个来源')
  } else for (const x of p) bad('RP-25 · ' + x)
}
// ── RP-26：O-04 —— 四维只计分，必须在注释里写明 ────────────────────────────
//
//  ⚠ 十维里只有六维有 floor 规则；uncertainty / changeSurface / dependencies /
//    verificationMaturity **零命中**（只通过 score 参与总分）。
//  ⚠ 不写明的话，读的人会以为每一维都能单独抬高档位。
{
  const p = []
  const src = readFileSync(join(root, 'src', 'shared', 'risk-policy.ts'), 'utf8')
  /** ① 必须写明「只有六维有 floor 规则」这件事。 */
  if (!src.includes('只有六维有 floor 规则')) {
    p.push('`dimensionFloorOf` 附近没有写明「只有六维有 floor 规则」⇒ 读的人会以为十维都能抬档')
  }
  /** ② 四个只计分的维度必须逐个点名（⛔ 不许含糊说「其余」）。 */
  for (const d of ['uncertainty', 'changeSurface', 'dependencies', 'verificationMaturity']) {
    if (!src.includes('**' + d + '**')) p.push('没有点名 ' + d + ' 是「只计分」的那一维')
  }
  /** ③ 反向：四维**确实**没有 floor 规则（若将来补了，本条应提醒同批更新注释）。 */
  const fnBody = src.slice(src.indexOf('function dimensionFloorOf'), src.indexOf('function hardContextFloorOf'))
  for (const d of ['uncertainty', 'changeSurface', 'dependencies', 'verificationMaturity']) {
    if (fnBody.includes("'" + d + "'")) {
      p.push('`dimensionFloorOf` 里出现了 ' + d + ' ⇒ 它现在有 floor 规则了，请同批更新注释与本条断言')
    }
  }
  if (p.length === 0) {
    ok('RP-26 ✓ **负向对拍**：`dimensionFloorOf` 明写「十维里只有六维有 floor 规则」，'
      + '并逐个点名 uncertainty / changeSurface / dependencies / verificationMaturity 只计分（O-04）')
  } else for (const x of p) bad('RP-26 · ' + x)
}
console.log('')
console.log(`RP 组：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处${fail > 0 ? ` · 没过 ${fail} 处` : ''} · 跳过 0 处`)
console.log('')
if (fail > 0) process.exit(1)
console.log('  ✅ RP 组全绿')

