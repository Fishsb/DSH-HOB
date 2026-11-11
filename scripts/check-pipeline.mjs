#!/usr/bin/env node
/**
 * Pipeline v3 self-check.
 *
 * This family protects the user gates rather than restating them:
 *   G1/G2 are audit facts; content completion never implies approval.
 *   Approval binds one artifact revision and digest.
 *   A changed artifact invalidates the old approval.
 *   Legacy artifacts stay readable and never become dispatchable.
 *   A task can only dispatch through approved v3 upstream requirements and plan.
 *
 * Pure functions only; no real ledger is written.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
let pass = 0
let fail = 0
const ok = (m) => { pass += 1; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail += 1; console.log(`  ✗ ${m}`) }

const pipeline = await import(pathToFileURL(join(root, 'src', 'shared', 'pipeline.ts')).href)
const view = await import(pathToFileURL(join(root, 'src', 'shared', 'pipeline-view.ts')).href)

const req = {
  id: 'R-PIPE',
  kind: 'req',
  status: 'agreed',
  title: '保存成功提示',
  pipeline_version: 'v3',
  revision: '3',
  clarify_examples: ['点击保存出现成功提示'],
  acceptance_criteria: ['AC-1 | 点击保存出现成功提示'],
  clarify_questions: [],
  clarify_assumptions: ['confirmed: 使用现有提示组件'],
}
const plan = {
  id: 'CHG-PIPE',
  kind: 'change',
  status: 'settled',
  title: '复用现有提示组件',
  pipeline_version: 'v3',
  revision: '2',
  parent: 'R-PIPE',
  req_ids: ['R-PIPE'],
  addresses: ['R-PIPE'],
  proposal: '复用现有提示组件',
  path_options: ['A', 'B'],
  path_tradeoffs: ['A 快', 'B 稳'],
  path_decision: '选 A',
  requirement_coverage: ['R-PIPE → 提示组件'],
  risk_tier: 'low',
  risk_rule_version: 'v1',
  risk_hard_triggers: [],
  risk_dimensions: [
    'scope=local', 'severity=minor', 'reversibility=easy', 'detectability=automatic',
    'uncertainty=known', 'changeSurface=few-files', 'dependencies=internal-deps',
    'verificationMaturity=proven', 'recoveryTime=minutes', 'exposure=internal',
  ],
  risk_assessed_at: '2026-11-08T00:00:00.000Z',
  risk_assessed_by: 'Hob',
  delivery_scope: 'none',
  risk_assessment_ref: 'CHG-PIPE#1',
  risk_binding_version: 'v1',
}
const task = {
  id: 'TSK-PIPE',
  kind: 'task',
  status: 'todo',
  title: '实现保存成功提示',
  pipeline_version: 'v3',
  revision: '1',
  parent: 'CHG-PIPE',
  task_brief: 'archive/pipeline/TASK.md',
  counterexamples: ['重复点击不叠加提示'],
  stop_conditions: ['现有组件无法承载时停手'],
  return_to: 'back-to-plan',
  criteria_refs: ['AC-1'],
  task_risk: 'low',
  risk_reasons: [],
  requires_isolation: 'false',
  requires_review: 'false',
  requires_serial_execution: 'false',
  touched_surfaces: [],
  irreversible_actions: [],
}
const approval = (artifact, revision, digest, decision = 'approve', extra = {}) => ({
  id: `DEC-${artifact.id.replace(/\W+/g, '-')}-${revision}-${decision}`,
  kind: 'decision',
  status: 'active',
  title: `用户决定 ${artifact.id}`,
  decision_kind: 'stage-approval',
  approval_stage: artifact.kind === 'req' ? 'requirements' : 'plan',
  artifact_id: artifact.id,
  artifact_revision: String(revision),
  artifact_digest: digest,
  decision,
  selected_option: artifact.kind === 'change' ? 'A' : '',
  decided_by: 'user',
  decided_at: `2026-11-08T00:00:0${revision}.000Z`,
  source: `确认${artifact.kind === 'req' ? '需求' : '方案'} ${artifact.id} 第 ${revision} 版${artifact.kind === 'change' ? '，选 A' : ''}`,
  ...extra,
})

console.log('')
const riskPolicy = await import(pathToFileURL(join(root, 'src', 'shared', 'risk-policy.ts')).href)
const planRisk = riskPolicy.riskAssessmentOf(riskPolicy.riskFactsOf(plan))
plan.risk_inputs_digest = planRisk.inputsDigest
plan.risk_binding_digest = pipeline.riskBindingDigestOf(plan, [req])
console.log('PIPE 组：Pipeline v3（六阶段 / 用户闸门 / 修订绑定 / 风险门 / 派发锁）')
console.log('')

// PIPE-1: content-complete v2 requirement still waits at G1.
{
  const v = view.pipelineViewOf(req, [req])
  const gate = view.pipelineDispatchProblems([req, plan], task)
  const p = []
  if (v.activeStage !== 1 || v.gate !== 'G1-requirement') p.push(`当前=${v.activeStage}/${v.gate}（期望 1/G1）`)
  if (v.requirementApproval.state !== 'missing') p.push(`审批状态=${v.requirementApproval.state}（期望 missing）`)
  if (!gate.some((x) => x.rule === 'G1')) p.push(`任务未被 G1 拦住：${JSON.stringify(gate)}`)
  if (p.length === 0) ok('PIPE-1 ✓ 负向对拍基线：内容齐全但无用户批准 ⇒ 停在 G1，任务不可派发')
  else for (const x of p) bad(`PIPE-1 · ${x}`)
}

// PIPE-2: only explicit, current-revision approval opens G1.
{
  const good = approval(req, 3, pipeline.artifactDigestOf(req))
  const v = view.pipelineViewOf(req, [req, good])
  const p = []
  if (v.requirementApproval.state !== 'approved') p.push(`审批状态=${v.requirementApproval.state}`)
  if (v.gate === 'G1-requirement') p.push('已批准仍停在 G1')
  if (!(v.activeStage === 2 && v.gate === null)) p.push(`下一步=${v.activeStage}/${v.gate}（期望进入方案起草）`)
  if (p.length === 0) ok('PIPE-2 ✓ 负向对拍：点名 R-PIPE 第 3 版的用户批准 ⇒ 放开 G1，进入方案阶段')
  else for (const x of p) bad(`PIPE-2 · ${x}`)
}

// PIPE-3: G2 needs approval of the exact plan revision and a valid selected path.
{
  const r1 = approval(req, 3, pipeline.artifactDigestOf(req))
  const vMissing = view.pipelineViewOf(req, [req, plan, r1])
  const p = []
  if (!(vMissing.activeStage === 2 && vMissing.gate === 'G2-plan')) p.push(`无 G2 时=${vMissing.activeStage}/${vMissing.gate}`)
  if (!view.pipelineDispatchProblems([req, plan, r1], task).some((x) => x.rule === 'G2')) p.push('无 G2 仍可派发')
  const badOpt = approval(plan, 2, pipeline.artifactDigestOf(plan), 'approve', { selected_option: 'Z' })
  const vBadOpt = view.pipelineViewOf(req, [req, plan, r1, badOpt])
  if (vBadOpt.planApproval.state !== 'invalid') p.push(`非法选路=${vBadOpt.planApproval.state}（期望 invalid）`)
  const good = approval(plan, 2, pipeline.artifactDigestOf(plan))
  const vGood = view.pipelineViewOf(req, [req, plan, r1, good])
  if (!(vGood.activeStage === 3 && vGood.gate === 'G3-tasks' && vGood.nextActor === 'hob') || vGood.planApproval.state !== 'approved') p.push(`合法 G2 后未进入任务图门：${vGood.activeStage}/${vGood.gate}/${vGood.nextActor}/${vGood.planApproval.state}`)
  if (p.length === 0) ok('PIPE-3 ✓ 负向对拍：G2 必须批准当前方案修订并选中合法路径；缺批准或选路非法都不能派发')
  else for (const x of p) bad(`PIPE-3 · ${x}`)
}

// PIPE-4: an approval for another revision or after a content change is stale.
{
  const stale = approval(req, 2, pipeline.artifactDigestOf(req))
  const state = pipeline.approvalStateOf(req, [req, stale])
  const changed = { ...req, title: '保存成功后显示可撤销提示' }
  /** Approve the OLD content at the same revision; changing content invalidates it. */
  const digestStale = approval(req, 3, pipeline.artifactDigestOf(req))
  const state2 = pipeline.approvalStateOf(changed, [changed, digestStale])
  const p = []
  if (state.state !== 'stale') p.push(`修订不同没判 stale：${state.state}`)
  if (state2.state !== 'stale') p.push(`内容不同没判 stale：${state2.state}`)
  if (p.length === 0) ok('PIPE-4 ✓ 负向对拍：其他修订或批准后内容变化 ⇒ 旧批准 stale，不能复用')
  else for (const x of p) bad(`PIPE-4 · ${x}`)
}

// PIPE-5: bare "continue / OK" cannot be accepted as a user receipt.
{
  const source = '继续'
  const receipt = pipeline.approvalReceiptPattern(req)
  const p = []
  if (receipt.test(source)) p.push('空泛回执被批准回执正则接受')
  if (!receipt.test('确认需求 R-PIPE 第 3 版')) p.push('完整回执没有被批准回执正则接受')
  if (p.length === 0) ok('PIPE-5 ✓ 负向对拍：只写「继续 / 可以」不构成可审计回执')
  else for (const x of p) bad(`PIPE-5 · ${x}`)
}

// PIPE-5b（R-15）: 回执判据只有一个实现；工具侧不得再内联正则。
{
  const p = []
  const art = { id: 'R-P5B', kind: 'req', revision: 3 }
  const strict = pipeline.receiptPatternOf(art)
  const loose = pipeline.receiptPatternOf(art, { acceptRevisionRequest: true })

  // ① 两份都必须拒绝空泛回执
  if (strict.test('继续')) p.push('严格版接受了「继续」')
  if (loose.test('继续')) p.push('宽松版接受了「继续」')
  if (strict.test('OK')) p.push('严格版接受了「OK」')

  // ② 完整批准回执两份都必须接受
  if (!strict.test('确认需求 R-P5B 第 3 版')) p.push('严格版拒绝了完整批准回执')
  if (!loose.test('确认需求 R-P5B 第 3 版')) p.push('宽松版拒绝了完整批准回执')

  // ③ 退回措辞只有 acceptRevisionRequest 版接受（严格版只管批准）
  if (strict.test('要求修改需求 R-P5B 第 3 版')) p.push('严格版错误地接受了「要求修改」')
  if (!loose.test('要求修改需求 R-P5B 第 3 版')) p.push('宽松版拒绝了「要求修改」（完整措辞应被接受）')
  // ⚠ 回执**必须点名版本号**：只写「要求修改需求 R-P5B」不构成可审计回执
  if (loose.test('要求修改需求 R-P5B')) p.push('未点名版本号的回执被接受')

  // ④ 版本号必须被点名，不能拿旧版本回执凑
  if (strict.test('确认需求 R-P5B 第 2 版')) p.push('错误版本号被接受（严格版）')
  if (loose.test('确认需求 R-P5B 第 2 版')) p.push('错误版本号被接受（宽松版）')

  // ⑤ ⚠ 本条的核心：工具侧**不得**再内联回执正则
  const toolsSrc = (() => {
    try { return readFileSync(join(root, 'src', 'modules', 'tools.ts'), 'utf8') } catch { return '' }
  })()
  if (toolsSrc === '') p.push('读不到 tools.ts ⇒ 失去基准')
  else if (toolsSrc.includes('new RegExp(`(?:确认|要求修改|退回修改)')) {
    p.push('tools.ts 又内联了一份回执正则 ⇒ R-15 复发（应调 receiptPatternOf）')
  } else if (!toolsSrc.includes('receiptPatternOf(')) {
    p.push('tools.ts 没有调用 receiptPatternOf ⇒ 判据可能已与纯函数版分叉')
  }

  if (p.length === 0) ok('PIPE-5b ✓ 回执判据只有一份实现（receiptPatternOf），工具侧不再内联正则')
  else for (const x of p) bad(`PIPE-5b · ${x}`)
}

// ── PIPE-24：O-38 —— 验收条件的身份必须来自内容，⛔ 不是数组下标 ─────────────
//
//  ⚠ 改前无显式 id 时用 `AC-${i+1}`（下标）当身份 ⇒ **在数组头部插一条**，
//    既有条件的 id 全部偏移 ⇒ G3 报出一条**不存在的缺口**。
//    这比漏报更坏：它会让人去修一个不存在的问题。
//
//  ⚠ 直接测 `taskGraphOf`（纯函数），⛔ 不绕 `pipelineViewOf` ——
//    后者要完整 chain（plan/tasks/runs），会把本条的靶子埋进无关夹具里。
{
  const p = []
  /** ⚠ 无 plan ⇒ 无 task ⇒ 每条条件都**未被覆盖** ⇒ 全部出现在 coverageGaps。 */
  const reqOf = (crit) => ({
    id: 'R-O38', kind: 'req', status: 'agreed', pipeline_version: 'v3', revision: '1',
    title: 't', acceptance_criteria: crit, acceptance_ids: [],
  })
  const gapsOf = (crit) => view.taskGraphOf(reqOf(crit), [reqOf(crit)]).coverageGaps
  /**
   * ⚠⚠ **关键：必须比较「同一条条件」在两个数组里的 id，⛔ 不是比较两个数组的前缀。**
   *
   *   我第一版比较 `base.every(id => inserted.includes(id))` ⇒ **负向对拍假绿**：
   *   下标方案下 base = ['AC-1','AC-2']、inserted = ['AC-1','AC-2','AC-3']
   *   ⇒ 前缀完全相同 ⇒ 断言看不出差别。
   *
   *   ⇒ 正确判法：**「条件甲」这一条**在两种数组里的 id 必须相同。
   *     下标方案：base 里是 AC-1，inserted 里是 AC-2 ⇒ **不同** ⇒ 抓得到。
   *     哈希方案：两边都是 AC-h…（内容相同 ⇒ 哈希相同）⇒ 相同。
   */
  const base = gapsOf(['条件甲', '条件乙'])
  const inserted = gapsOf(['新插入的条件', '条件甲', '条件乙'])
  if (base.length !== 2) p.push(`基线缺口数应为 2，实际 ${base.length} ⇒ 夹具不成立`)
  /**
   * ⚠ 按**顺序**取：base[0] 是「条件甲」、inserted[1] 也是「条件甲」。
   *   两者必须是**同一个 id** —— 这才是「身份不随位置变」的直接证据。
   */
  const idOfA_inBase = base[0]
  const idOfA_inInserted = inserted[1]
  if (idOfA_inBase !== idOfA_inInserted) {
    p.push('「条件甲」在两种数组里的缺口 id **不同** ⇒ 身份仍依赖下标（O-38 复发）'
      + ` base[0]=${idOfA_inBase} inserted[1]=${idOfA_inInserted}`)
  }
  /** ⚠ 反向：新插入的那条必须**也被报成缺口**（不能因为改动就整段失效）。 */
  if (inserted.length !== 3) p.push(`插入一条后缺口数应为 3，实际 ${inserted.length}`)
  if (inserted.length !== 3) p.push(`插入一条后缺口数应为 3，实际 ${inserted.length}`)
  if (p.length === 0) {
    ok('PIPE-24 ✓ **负向对拍**：无 id 前缀的验收条件，身份来自内容哈希 —— '
      + '数组头部插入一条后，既有条件的缺口 id **逐字不变**（O-38：不再按下标偏移）')
  } else for (const x of p) bad(`PIPE-24 · ${x}`)
}
// PIPE-6: Hob cannot approve itself.
{
  const self = approval(req, 3, pipeline.artifactDigestOf(req), 'approve', { decided_by: 'Hob' })
  const state = pipeline.approvalStateOf(req, [req, self])
  const p = []
  if (state.state !== 'invalid') p.push(`Hob 自批未被拒绝：${state.state}`)
  if (p.length === 0) ok('PIPE-6 ✓ 负向对拍：decided_by 不是 user ⇒ 批准无效，禁止 Hob 自批')
  else for (const x of p) bad(`PIPE-6 · ${x}`)
}

// PIPE-7: request-changes keeps the same gate and asks for a new revision.
{
  const ask = approval(req, 3, pipeline.artifactDigestOf(req), 'request-changes', { source: '要求修改需求 R-PIPE：需要撤销提示' })
  const v = view.pipelineViewOf(req, [req, ask])
  const p = []
  if (v.requirementApproval.state !== 'request-changes') p.push(`状态=${v.requirementApproval.state}`)
  if (!(v.activeStage === 1 && v.gate === 'G1-requirement')) p.push(`回流=${v.activeStage}/${v.gate}`)
  if (!v.nextAction.includes('修改')) p.push(`下一步未要求修改：${v.nextAction}`)
  if (p.length === 0) ok('PIPE-7 ✓ 负向对拍：用户要求修改 ⇒ 留在当前阶段，递增修订后重新确认')
  else for (const x of p) bad(`PIPE-7 · ${x}`)
}

// PIPE-8: write guard enforces v2 marker, positive revision and revision increments.
{
  const noV2 = pipeline.pipelineWriteProblems([], [{ ...req, pipeline_version: '' }])
  const noRev = pipeline.pipelineWriteProblems([], [{ ...req, revision: '' }])
  const old = { ...req, revision: '3' }
  const d = approval(req, 3, pipeline.artifactDigestOf(old))
  const changedSameRev = pipeline.pipelineWriteProblems([req, d], [{ ...req, title: '变化了' }, d])
  const p = []
  if (!noV2.some((x) => x.rule === 'C-23')) p.push('新条目缺 v2 未拒')
  if (!noRev.some((x) => x.rule === 'C-23')) p.push('新条目缺 revision 未拒')
  if (!changedSameRev.some((x) => x.why.includes('未递增'))) p.push('内容变化未递增 revision 未拒')
  if (p.length === 0) ok('PIPE-8 ✓ 负向对拍：新条目必须 v3 + revision；批准后改内容必须递增 revision')
  else for (const x of p) bad(`PIPE-8 · ${x}`)
}

// PIPE-9: a fully approved v2 chain is dispatchable and legacy is explicitly refused.
{
  const r1 = approval(req, 3, pipeline.artifactDigestOf(req))
  const g2 = approval(plan, 2, pipeline.artifactDigestOf(plan))
  const good = view.pipelineDispatchProblems([req, plan, r1, g2], task)
  const legacy = view.pipelineDispatchProblems([{ ...req, pipeline_version: '' }, { ...plan, pipeline_version: '' }, { ...task, pipeline_version: '' }], { ...task, pipeline_version: '' })
  const p = []
  if (good.length !== 0) p.push(`齐全 v2 链仍被拒：${JSON.stringify(good)}`)
  if (!legacy.some((x) => x.why.includes('旧管线条目只读'))) p.push(`旧任务未明确只读拒绝：${JSON.stringify(legacy)}`)
  if (p.length === 0) ok('PIPE-9 ✓ 负向对拍：旧条目只读且不能派发；G1+G2 齐全的 v3 链可派发')
  else for (const x of p) bad(`PIPE-9 · ${x}`)
}

// PIPE-10: a multi-requirement plan cannot skip any upstream requirement approval.
{
  const other = { ...req, id: 'R-PIPE-2', title: '撤销提示' }
  const multi = { ...plan, req_ids: ['R-PIPE', 'R-PIPE-2'], addresses: ['R-PIPE', 'R-PIPE-2'] }
  const r1 = approval(req, 3, pipeline.artifactDigestOf(req))
  const g2 = approval(multi, 2, pipeline.artifactDigestOf(multi))
  const p = view.pipelineDispatchProblems([req, other, multi, r1, g2], task)
  const blocked = p.some((x) => x.rule === 'G1' && x.unit === 'R-PIPE-2')
  if (blocked) ok('PIPE-10 ✓ 负向对拍：多需求方案必须逐条获批；任一上游缺失就拒绝派发')
  else bad(`PIPE-10 · 未批准 R-PIPE-2 仍可派发：${JSON.stringify(p)}`)
}

// PIPE-11: the stage route exposes Pipeline views and the panel consumes them.
{
  const stages = await import(pathToFileURL(join(root, 'src', 'shared', 'stages-index.ts')).href)
  const fs = await import('node:fs')
  const built = stages.buildStages([req], '2026-11-08T00:00:00.000Z')
  const panelSrc = fs.readFileSync(join(root, 'src', 'client', 'project-panel.tsx'), 'utf8')
  const p = []
  if (!Array.isArray(built.pipelines) || built.pipelines.length !== 1) p.push('/stages 未返回 pipelines')
  else if (built.pipelines[0].reqId !== 'R-PIPE' || built.pipelines[0].gate !== 'G1-requirement') {
    p.push(`pipeline 读数=${JSON.stringify({ reqId: built.pipelines[0].reqId, gate: built.pipelines[0].gate })}`)
  }
  if (!panelSrc.includes("'data-dsh-hob': 'stages-current-gate'")) p.push('面板没有当前闸门锚点')
  if (!panelSrc.includes('确认需求 ') || !panelSrc.includes('确认方案 ')) p.push('面板没有固定确认回执模板')
  if (p.length === 0) ok('PIPE-11 ✓ 负向对拍：/stages 暴露 pipelines；面板显示当前闸门与可复述的 G1/G2 回执模板')
  else for (const x of p) bad(`PIPE-11 · ${x}`)
}

// PIPE-12: RUN/ACC bind the task revision they actually belong to.
{
  const taskV2 = { ...task, status: 'doing', revision: '2' }
  const run = {
    id: 'RUN-PIPE', kind: 'run', status: 'returned', parent: 'TSK-PIPE',
    pipeline_version: 'v3', revision: '1', task_revision: '2',
  }
  const acc = {
    id: 'ACC-PIPE', kind: 'acc', status: 'pass', parent: 'TSK-PIPE',
    pipeline_version: 'v3', revision: '1', task_revision: '2',
  }
  const stale = pipeline.pipelineRevisionProblems([taskV2, { ...run, task_revision: '1' }, acc])
  const good = pipeline.pipelineRevisionProblems([taskV2, run, acc])
  const missing = pipeline.pipelineWriteProblems([], [taskV2, { ...run, task_revision: '' }])
  const p = []
  if (good.length !== 0) p.push(`同修订 RUN/ACC 被拒：${JSON.stringify(good)}`)
  if (!stale.some((x) => x.rule === 'C-24' && x.unit === 'RUN-PIPE')) p.push('旧修订 RUN 未失效')
  if (!missing.some((x) => x.rule === 'C-24' && x.unit === 'RUN-PIPE')) p.push('新 RUN 缺 task_revision 未被写入门禁拒绝')
  if (p.length === 0) ok('PIPE-12 ✓ 负向对拍：RUN/ACC 必须绑定当前任务修订；旧修订记录失效，新记录缺绑定被拒')
  else for (const x of p) bad(`PIPE-12 · ${x}`)
}

// PIPE-13: unapproved drafts stay writable, but remain blocked from progression.
{
  const stages = await import(pathToFileURL(join(root, 'src', 'shared', 'stage-controls.ts')).href)
  const pending = [{ ...req, status: 'draft' }, { ...plan, status: 'proposed' }]
  const fields = stages.stageFieldProblems(pending)
  const approvals = stages.stageApprovalProblems(pending)
  const p = []
  if (fields.some((x) => x.rule === 'C-18' || x.rule === 'C-19')) {
    p.push(`字段写入门禁仍混入用户闸门：${JSON.stringify(fields)}`)
  }
  if (!approvals.some((x) => x.rule === 'C-18') || !approvals.some((x) => x.rule === 'C-19')) {
    p.push(`推进门禁没有同时拦 G1/G2：${JSON.stringify(approvals)}`)
  }
  if (p.length === 0) ok('PIPE-13 ✓ 未批准草稿可保存；推进门禁仍同时拦住 G1/G2（无建账死锁）')
  else for (const x of p) bad(`PIPE-13 · ${x}`)
}

// PIPE-14: drafts are Hob's work, not a user gate waiting for a receipt.
{
  const draftReq = { ...req, status: 'draft' }
  const draftPlan = { ...plan, status: 'proposed' }
  const reqView = view.pipelineViewOf(draftReq, [draftReq])
  const approvedReq = approval(req, 3, pipeline.artifactDigestOf(req))
  const planView = view.pipelineViewOf(req, [req, draftPlan, approvedReq])
  const p = []
  if (reqView.gate !== null || reqView.nextActor !== 'hob' || reqView.stages[0]?.state !== 'draft') {
    p.push(`需求草稿被显示成用户闸门：${JSON.stringify({ gate: reqView.gate, actor: reqView.nextActor, state: reqView.stages[0]?.state })}`)
  }
  if (planView.gate !== null || planView.nextActor !== 'hob' || planView.stages[1]?.state !== 'draft') {
    p.push(`方案草稿被显示成用户闸门：${JSON.stringify({ gate: planView.gate, actor: planView.nextActor, state: planView.stages[1]?.state })}`)
  }
  if (p.length === 0) ok('PIPE-14 ✓ 负向对拍：草稿阶段的待办归 Hob，不冒充 G1/G2 用户确认')
  else for (const x of p) bad(`PIPE-14 · ${x}`)
}

// PIPE-15: v3 exposes the six lifecycle stages plus risk-gated closure.
{
  const stages = view.PIPELINE_STAGES.map((s) => `${s.step}:${s.id}`)
  const expected = ['1:requirements', '2:plan', '3:tasks', '4:execution', '5:verification', '6:acceptance', '7:closure']
  const p = []
  if (JSON.stringify(stages) !== JSON.stringify(expected)) p.push(`阶段=${JSON.stringify(stages)}`)
  if (!view.PIPELINE_STAGES.some((s) => s.id === 'verification')) p.push('缺少技术验证阶段')
  if (!view.PIPELINE_STAGES.some((s) => s.id === 'closure')) p.push('缺少交付收口阶段')
  const top = view.pipelineViewOf(req, [req])
  if (top.pipelineVersion !== 'v3') p.push(`pipelineVersion=${top.pipelineVersion}`)
  if (p.length === 0) ok('PIPE-15 ✓ v3 暴露六个正式阶段 + 风险启用的交付收口')
  else for (const x of p) bad(`PIPE-15 · ${x}`)
}

// PIPE-16: legacy v2 remains readable but cannot be dispatched as current.
{
  const v2 = { ...req, pipeline_version: 'v2' }
  const v2Task = { ...task, pipeline_version: 'v2' }
  const legacyView = view.pipelineViewOf(v2, [v2])
  const gate = view.pipelineDispatchProblems([v2, { ...plan, pipeline_version: 'v2' }, v2Task], v2Task)
  const p = []
  if (legacyView.state !== 'legacy') p.push(`v2 视图=${legacyView.state}（期望 legacy）`)
  if (!gate.some((x) => x.why.includes('旧管线条目只读'))) p.push('v2 任务未被只读拒绝')
  if (p.length === 0) ok('PIPE-16 ✓ 负向对拍：v2 旧链只读可查，不能进入 v3 派发')
  else for (const x of p) bad(`PIPE-16 · ${x}`)
}

// PIPE-16b: a legacy chain must not display a retroactive v3 risk assessment.
{
  const v2 = { ...req, pipeline_version: 'v2' }
  const v2Plan = { ...plan, pipeline_version: 'v2' }
  const legacyView = view.pipelineViewOf(v2, [v2, v2Plan])
  const p = []
  if (legacyView.risk !== undefined) p.push(`旧链带出了 v3 风险：${JSON.stringify(legacyView.risk)}`)
  if (legacyView.closureMode !== undefined) p.push(`旧链带出了 v3 收口档位：${legacyView.closureMode}`)
  if (legacyView.deliveryClosed !== undefined) p.push(`旧链带出了 v3 交付完成标志：${legacyView.deliveryClosed}`)
  if (p.length === 0) ok('PIPE-16b ✓ 负向对拍：v2 旧链不显示 v3 风险 / 收口档位 / 交付完成，⛔ 不把旧条目冒充已按新规则评定')
  else for (const x of p) bad(`PIPE-16b · ${x}`)
}

// PIPE-17: verification and acceptance are separate stages.
{
  const r1 = approval(req, 3, pipeline.artifactDigestOf(req))
  const g2 = approval(plan, 2, pipeline.artifactDigestOf(plan))
  const built = { ...task, status: 'built', built_by: 'dev', revision: '1' }
  const run = { id: 'RUN-V3', kind: 'run', status: 'returned', parent: task.id, pipeline_version: 'v3', revision: '1', task_revision: '1', progress_refs: ['EVD-1'] }
  const beforeVerify = view.pipelineViewOf(req, [req, plan, built, run, r1, g2])
  const ver = { id: 'VER-1', kind: 'verification', status: 'pass', parent: task.id, pipeline_version: 'v3', revision: '1', task_revision: '1', verifier: 'verifier', verification_session: 'session-verifier', verified_at: '2026-11-08T01:00:00Z', basis: ['EVD-1'], criteria_refs: ['AC-1'] }
  const evd = { id: 'EVD-1', kind: 'evidence', status: 'recorded', title: '读数', reading: 'exit 0', evidence_kind: 'command', command: 'npm test', exit_code: '0' }
  const afterVerify = view.pipelineViewOf(req, [req, plan, built, run, r1, g2, ver, evd])
  const p = []
  if (beforeVerify.activeStage !== 5 || beforeVerify.gate !== 'G4-verification') p.push(`未验证时=${beforeVerify.activeStage}/${beforeVerify.gate}`)
  if (afterVerify.chainCompleted !== false) p.push('只有技术验证就宣称链完成')
  if (!(afterVerify.activeStage === 6 && afterVerify.gate === 'G5-acceptance')) p.push(`验证后=${afterVerify.activeStage}/${afterVerify.gate}`)
  if (p.length === 0) ok('PIPE-17 ✓ 负向对拍：执行回传 → G4 技术验证 → G5 产品验收，验证通过不等于产品接受')
  else for (const x of p) bad(`PIPE-17 · ${x}`)
}

// PIPE-18: product acceptance with risk-derived closure remains delivery-open.
{
  const r1 = approval(req, 3, pipeline.artifactDigestOf(req))
  const g2 = approval(plan, 2, pipeline.artifactDigestOf(plan))
  const built = { ...task, status: 'built', built_by: 'dev' }
  const run = { id: 'RUN-V3', kind: 'run', status: 'returned', parent: task.id, pipeline_version: 'v3', revision: '1', task_revision: '1', progress_refs: ['EVD-1'] }
  const evd = { id: 'EVD-1', kind: 'evidence', status: 'recorded', title: '读数', reading: 'exit 0', evidence_kind: 'command', command: 'npm test', exit_code: '0' }
  const ver = { id: 'VER-1', kind: 'verification', status: 'pass', parent: task.id, pipeline_version: 'v3', revision: '1', task_revision: '1', verifier: 'verifier', verification_session: 'session-verifier', verified_at: '2026-11-08T01:00:00Z', basis: ['EVD-1'], criteria_refs: ['AC-1'] }
  const acc = { id: 'ACC-V3', kind: 'acc', status: 'pass', parent: task.id, pipeline_version: 'v3', revision: '1', task_revision: '1', actor: 'acceptor', acceptance_session: 'session-acceptor', verified_at: '2026-11-08T02:00:00Z', basis: ['EVD-1'], verification_refs: ['EVD-1'], example_results: ['EX-1 | pass | EVD-1'], product_confirmation: '用户确认结果符合目标', risk_residual_tier: 'low' }
  const externalPlan = { ...plan, delivery_scope: 'external' }
  externalPlan.risk_inputs_digest = riskPolicy.riskAssessmentOf(riskPolicy.riskFactsOf(externalPlan)).inputsDigest
  externalPlan.risk_binding_digest = pipeline.riskBindingDigestOf(externalPlan, [req])
  const g2External = approval(externalPlan, 2, pipeline.artifactDigestOf(externalPlan), 'approve', { id: 'DEC-EXTERNAL-G2' })
  const v = view.pipelineViewOf(req, [req, externalPlan, built, run, r1, g2External, ver, evd, acc])
  const p = []
  if (v.chainCompleted !== true) p.push('产品已接受但 chainCompleted 不为 true')
  if (v.deliveryClosed !== false) p.push('未做 G6 却宣称 deliveryClosed')
  /**
   * ⚠ **R-09**：⛔ 不写 `activeStage === 7` —— 业务阶段到 6 为止，
   *   收口是**门**不是步。未收口用 `closurePending` 表达。
   *   旧断言（`=== 7`）正是在钉住 R-09 那个错误行为，一并改掉。
   */
  if (v.activeStage !== 6) p.push(`业务阶段应停在 6（⛔ 不是 7 —— 收口是门不是步）：实际 ${v.activeStage}`)
  if (v.closurePending !== true) p.push(`未收口却没有 closurePending：${JSON.stringify(v.closurePending)}`)
  if (v.gate !== 'G6-closure') p.push(`G6 未出现：gate=${v.gate}`)
  if (p.length === 0) ok('PIPE-18 ✓ 负向对拍：技术验证与产品验收可完成，而交付仍需 G6 放行')
  else for (const x of p) bad(`PIPE-18 · ${x}`)
}

// PIPE-19: one task's verification cannot close another task's acceptance.
{
  const r1 = approval(req, 3, pipeline.artifactDigestOf(req))
  const g2 = approval(plan, 2, pipeline.artifactDigestOf(plan))
  const mid = { ...task, id: 'TSK-MID', status: 'built', built_by: 'dev', task_revision: '1' }
  const other = { ...task, id: 'TSK-OTHER', status: 'built', built_by: 'dev' }
  const runMid = { id: 'RUN-MID', kind: 'run', status: 'returned', parent: 'TSK-MID', pipeline_version: 'v3', revision: '1', task_revision: '1', progress_refs: ['EVD-1'] }
  const runOther = { id: 'RUN-OTHER', kind: 'run', status: 'returned', parent: 'TSK-OTHER', pipeline_version: 'v3', revision: '1', task_revision: '1', progress_refs: ['EVD-1'] }
  const verMid = { id: 'VER-MID', kind: 'verification', status: 'pass', parent: 'TSK-MID', pipeline_version: 'v3', revision: '1', task_revision: '1', verifier: 'verifier', verification_session: 'session-verifier', verified_at: '2026-11-08T01:00:00Z', basis: ['EVD-1'], criteria_refs: ['AC-1'] }
  const accMid = { id: 'ACC-MID', kind: 'acc', status: 'pass', parent: 'TSK-MID', pipeline_version: 'v3', revision: '1', task_revision: '1', actor: 'acceptor', acceptance_session: 'session-acceptor', verified_at: '2026-11-08T02:00:00Z', basis: ['EVD-1'], verification_refs: ['EVD-1'], example_results: ['EX-1 | pass | EVD-1'], product_confirmation: '用户接受', risk_residual_tier: 'low' }
  const evidence = { id: 'EVD-1', kind: 'evidence', status: 'recorded', title: '读数', reading: 'exit 0', evidence_kind: 'command', command: 'npm test', exit_code: '0' }
  const v = view.pipelineViewOf(req, [req, plan, mid, other, runMid, runOther, verMid, accMid, evidence, r1, g2])
  const p = []
  if (v.chainCompleted !== false) p.push(`只验了一个任务却判链完成：${JSON.stringify(v.chainCompleted)}`)
  if (v.activeStage !== 5) p.push(`另一任务未验证时应停在 G4：${v.activeStage}/${v.gate}`)
  if (p.length === 0) ok('PIPE-19 ✓ 负向对拍：一个任务的 VER/ACC 不能替另一任务收口；缺少的技术验证把链留在 G4')
  else for (const x of p) bad(`PIPE-19 · ${x}`)
}

// PIPE-20: a skipped mode is a recorded decision, never a missing closure.
{
  const r1 = approval(req, 3, pipeline.artifactDigestOf(req))
  const internalPlan = { ...plan, delivery_scope: 'none' }
  internalPlan.risk_inputs_digest = riskPolicy.riskAssessmentOf(riskPolicy.riskFactsOf(internalPlan)).inputsDigest
  internalPlan.risk_binding_digest = pipeline.riskBindingDigestOf(internalPlan, [req])
  const g2 = approval(internalPlan, 2, pipeline.artifactDigestOf(internalPlan), 'approve', { id: 'DEC-NO-CLOSE' })
  const built = { ...task, status: 'built', built_by: 'dev' }
  const run = { id: 'RUN-V3', kind: 'run', status: 'returned', parent: task.id, pipeline_version: 'v3', revision: '1', task_revision: '1', progress_refs: ['EVD-1'] }
  const ver = { id: 'VER-1', kind: 'verification', status: 'pass', parent: task.id, pipeline_version: 'v3', revision: '1', task_revision: '1', verifier: 'verifier', verification_session: 'session-verifier', verified_at: '2026-11-08T01:00:00Z', basis: ['EVD-1'], criteria_refs: ['AC-1'] }
  const acc = { id: 'ACC-V3', kind: 'acc', status: 'pass', parent: task.id, pipeline_version: 'v3', revision: '1', task_revision: '1', actor: 'acceptor', acceptance_session: 'session-acceptor', verified_at: '2026-11-08T02:00:00Z', basis: ['EVD-1'], verification_refs: ['EVD-1'], example_results: ['EX-1 | pass | EVD-1'], product_confirmation: '用户确认结果符合目标', risk_residual_tier: 'low' }
  const evidence = { id: 'EVD-1', kind: 'evidence', status: 'recorded', title: '读数', reading: 'exit 0', evidence_kind: 'command', command: 'npm test', exit_code: '0' }
  const v = view.pipelineViewOf(req, [req, internalPlan, built, run, ver, evidence, acc, r1, g2])
  const p = []
  if (v.chainCompleted !== true) p.push('产品已接受却没有链完成')
  if (v.deliveryClosed !== false) p.push('没有任何 CLS 却宣布交付已收口')
  if (!(v.activeStage === 6 && v.closurePending === true && v.gate === 'G6-closure')) {
    p.push(`skipped 缺记录时没有停在 G6：activeStage=${v.activeStage} · closurePending=${String(v.closurePending)} · gate=${v.gate}`)
  }
  if (p.length === 0) ok('PIPE-20 ✓ 负向对拍：风险推导为 skipped 时也必须留下 CLS 决定；缺失不能静默算已收口')
  else for (const x of p) bad(`PIPE-20 · ${x}`)
}

// PIPE-21: a verification from an older task revision cannot stand for the current task.
{
  const taskV2 = { ...task, status: 'built', revision: '2' }
  const staleVer = { id: 'VER-STALE', kind: 'verification', status: 'pass', parent: task.id,
    pipeline_version: 'v3', revision: '1', task_revision: '1', verifier: 'verifier',
    verification_session: 'session-verifier', verified_at: '2026-11-08T01:00:00Z',
    basis: ['EVD-1'], criteria_refs: ['AC-1'] }
  const currentVer = { ...staleVer, task_revision: '2' }
  const stale = pipeline.verificationRevisionProblems([taskV2, staleVer])
  const good = pipeline.verificationRevisionProblems([taskV2, currentVer])
  const p = []
  if (!stale.some((x) => x.rule === 'C-25' && x.why.includes('旧验证失效'))) p.push('旧任务修订的 VER 没有失效')
  if (good.length !== 0) p.push(`同修订 VER 被误拒：${JSON.stringify(good)}`)
  if (p.length === 0) ok('PIPE-21 ✓ 负向对拍：VER 绑定旧任务修订 ⇒ C-25 失效；同修订的验证不误伤')
  else for (const x of p) bad(`PIPE-21 · ${x}`)
}

// PIPE-22: plan content / risk problems block G3 even after the plan was approved.
{
  const r1 = approval(req, 3, pipeline.artifactDigestOf(req))
  const approvedPlan = { ...plan }
  const g2 = approval(approvedPlan, 2, pipeline.artifactDigestOf(approvedPlan), 'approve', { id: 'DEC-PIPE22' })
  const badPlan = { ...approvedPlan, risk_inputs_digest: 'stale-digest', risk_binding_digest: 'stale-binding' }
  const g2Bad = approval(badPlan, 2, pipeline.artifactDigestOf(badPlan), 'approve', { id: 'DEC-PIPE22B' })
  const v = view.pipelineViewOf(req, [req, badPlan, task, r1, g2Bad])
  const p = []
  if (v.activeStage !== 2) p.push(`方案内容缺口没有把当前阶段拉回 G2：${v.activeStage}/${v.gate}`)
  if (!v.blockedBy.some((x) => x.includes('RP-3'))) p.push('方案风险 stale 没有进入 blockedBy')
  if (v.gate !== null) p.push(`方案内容未齐时应由 Hob 补齐而不是给用户闸门：${v.gate}`)
  if (p.length === 0) ok('PIPE-22 ✓ 负向对拍：方案已批准但风险评定 stale ⇒ 回到方案阶段由 Hob 补齐，不能进 G3')
  else for (const x of p) bad(`PIPE-22 · ${x}`)
}

// PIPE-16c: dispatch sees a linked open risk instead of only the plan tier.
{
  const r1 = approval(req, 3, pipeline.artifactDigestOf(req))
  const g2 = approval(plan, 2, pipeline.artifactDigestOf(plan))
  const riskyPlan = { ...plan, risk_ids: ['RSK-PIPE'] }
  const g2Risk = approval(riskyPlan, 2, pipeline.artifactDigestOf(riskyPlan), 'approve', { id: 'DEC-RISK-G2' })
  const openRisk = { id: 'RSK-PIPE', kind: 'risk', status: 'open', risk_tier: 'high', owner: 'user', pipeline_version: 'v3' }
  const gate = view.pipelineDispatchProblems([req, riskyPlan, task, r1, g2Risk, openRisk], task)
  if (gate.some((x) => x.rule === 'RP-7' && x.unit === 'CHG-PIPE')) {
    ok('PIPE-16c ✓ 负向对拍：方案关联 open 风险 ⇒ 派发被 RP-7 拦住（⛔ 不只看 risk_tier）')
  } else bad(`PIPE-16c · 关联 open 风险仍可派发：${JSON.stringify(gate)}`)
}

// PIPE-23: acceptance facts are part of the risk binding, not a detached note.
{
  const criteriaChanged = { ...req, acceptance_criteria: ['AC-1 | 点击保存出现成功提示', 'AC-2 | 权限不足时不得提示成功'] }
  const dBefore = pipeline.riskBindingDigestOf(plan, [req])
  const dAfter = pipeline.riskBindingDigestOf(plan, [criteriaChanged])
  const approvedPlan = { ...plan, risk_binding_digest: dBefore }
  const g2 = approval(approvedPlan, 2, pipeline.artifactDigestOf(approvedPlan), 'approve', { id: 'DEC-PIPE23' })
  const staleView = view.pipelineViewOf(criteriaChanged, [criteriaChanged, approvedPlan, g2])
  const staleDispatch = view.pipelineDispatchProblems([criteriaChanged, approvedPlan, g2], task)
  const p = []
  if (dBefore === dAfter) p.push('验收条件变化后风险绑定摘要不变')
  if (!staleView.blockedBy.some((x) => x.includes('RP-3'))) p.push('视图没有把验收条件变化标成风险 stale')
  if (!staleDispatch.some((x) => x.rule === 'RP-3')) p.push('派发没有拦住验收条件变化后的旧风险评定')
  if (p.length === 0) ok('PIPE-23 ✓ 负向对拍：验收条件 / 验收对象变化 ⇒ 风险绑定摘要失效，视图与派发都拒绝沿用旧评定')
  else for (const x of p) bad(`PIPE-23 · ${x}`)
}

// ─────────────────────────────────────────────────────────────────────
// PIPE-25 · O-02：调用方文案必须说 v3（`isPipelineV2` 只是兼容别名）
// ─────────────────────────────────────────────────────────────────────
//
// ⚠ 为什么要有这一条：`isPipelineV2`（`pipeline.ts:113-116`）是
//   `isPipelineV3` 的**别名**，两个函数读的是同一个 `PIPELINE_VERSION`。
//   但调用方的注释与**用户可见文案**一直写「v2」⇒ 读代码的人会以为还有 v2 管线在跑。
//
// ⚠ 判据是**源码扫描**，⛔ 不是行为测试：这类缺陷不改变行为，只改变「说的是不是真的」。
//   ⚠ 但**必须有牙** —— 负向对拍见 PIPE-25b。
{
  const SRC = join(root, 'src')
  /** ⚠ 只扫 `.ts/.tsx`；⛔ 不扫 `node_modules` / `lib`（产物）。 */
  const walk = (dir) => {
    const out = []
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...walk(full)); continue }
      if (/\.(ts|tsx)$/.test(e.name)) out.push(full)
    }
    return out
  }
  /**
   * 要找的形态：把「v2」当成**当前管线**来说。
   * ⚠ 白名单：`LEGACY_PIPELINE_VERSIONS` 的定义处**必须**能写 v2 —— 那是历史版本枚举。
   */
  const PATTERNS = [/Pipeline v2\b/, /v2 需求/, /v2 批准/]
  const ALLOW = [/LEGACY_PIPELINE_VERSIONS/, /isPipelineV2/, /pipeline_version/]
  const hits = []
  for (const f of walk(SRC)) {
    const text = readFileSync(f, 'utf8')
    text.split('\n').forEach((line, i) => {
      if (ALLOW.some((a) => a.test(line))) return
      for (const pat of PATTERNS) {
        if (pat.test(line)) { hits.push(f.slice(SRC.length + 1) + ':' + (i + 1) + ' · ' + line.trim().slice(0, 80)); break }
      }
    })
  }
  if (hits.length === 0) {
    ok('PIPE-25 ✓ 调用方文案不再把当前管线说成 v2（isPipelineV2 仅为兼容别名，实际读的是 v3 版本号）')
  } else {
    for (const h of hits.slice(0, 5)) bad('PIPE-25 · 文案仍说 v2：' + h)
  }
}

// ── PIPE-25b 负向对拍：把一处文案改回 v2 ⇒ PIPE-25 必须变红 ──

// ── PIPE-25b 负向对拍：把一处文案改回 v2 ⇒ PIPE-25 必须变红 ──
//
// ⚠⚠ **2026-11-11 · 第 56 轮：本块曾是「判据往生产源码写盘」（与 §122 同族缺陷）**
//   ── 改前是什么 ────────────────────────────────────────────────────
//     const target = join(root, 'src', 'shared', 'stages-index.ts')
//     writeFileSync(target, orig.replace('Pipeline v3 views', 'Pipeline v2 views'))
//     ...扫全树...
//     finally { writeFileSync(target, orig) }
//   ⇒ 每跑一次 `check:pipeline`，`stages-index.ts` 的 **mtime 就被推新**
//     ⇒ 下一轮 `check:all` 的 `check:build`（`--strict-source`）**必然假红**。
//     ⇒ 且两次 `writeFileSync` 之间若 SIGKILL / 断电，**源码停在变异态**。
//
//   ── 为什么改后不需要落盘 ──────────────────────────────────────────
//     PIPE-25 的正扫是**纯函数式**的：walk(树) → readFile → patterns.test(line)。
//     本块要证的只有一件事：**含 `Pipeline v2` 的行会被 PATTERNS 咬住、
//     而被 ALLOW 放行的行不会**。那是一次**纯字符串 + 正则**的推理。
//     ⇒ 用与 PIPE-25 **同一组常量**（⚠ 下面刻意重抄一遍，两处必须同步，见下方自检）
//       在内存里跑同一个判定函数即可，⛔ 不需要改文件、⛔ 不需要扫真树。
{
  /** ⚠ 与 PIPE-25 的正扫**逐字相同**的判定：给定行文本，说它是不是「把当前管线说成 v2」。 */
  const PATTERNS = [/Pipeline v2\b/, /v2 需求/, /v2 批准/]
  const ALLOW = [/LEGACY_PIPELINE_VERSIONS/, /isPipelineV2/, /pipeline_version/]
  const flags = (line) => {
    if (ALLOW.some((a) => a.test(line))) return false
    return PATTERNS.some((pat) => pat.test(line))
  }
  /** 靶子：`stages-index.ts` 里那句真实文案（⚠ 只读，⛔ 不写）。 */
  const target = join(root, 'src', 'shared', 'stages-index.ts')
  const orig = readFileSync(target, 'utf8')
  const REAL_LINE = 'Pipeline v3 views'
  if (!orig.includes(REAL_LINE)) {
    bad('PIPE-25b · 源码里找不到 `Pipeline v3 views`（形态变了）⇒ 负向对拍不可判'
      + '（⛔ 不许当成通过）')
  } else {
    /** ① 原文（v3）必须**不被**咬住 —— 否则 PIPE-25 平时就是假红。 */
    const clean = orig.split('\n').filter(flags).length
    /** ② 变异后（v2）必须**被**咬住 —— 这就是「有牙」。 */
    const mutated = orig.replace(REAL_LINE, 'Pipeline v2 views')
    const dirty = mutated.split('\n').filter(flags).length
    /** ③ 白名单必须仍然放行 —— 否则 LEGACY_PIPELINE_VERSIONS 那行会被误报。 */
    const allowedLine = 'const LEGACY_PIPELINE_VERSIONS = [\'v2\'] // Pipeline v2 历史'
    const allowOk = flags(allowedLine) === false
    if (clean !== 0) {
      bad('PIPE-25b · 【判据脱节】**未变异**的原文里就有 ' + clean + ' 行被咬住'
        + ' ⇒ PIPE-25 平时是假红，本对拍不可判')
    } else if (!mutated.includes('Pipeline v2 views')) {
      bad('PIPE-25b · 变异没生效（replace 后串仍在）⇒ 不可判')
    } else if (dirty === 0) {
      bad('PIPE-25b · 改回 v2 后判据**仍**全绿 ⇒ 断言没有牙')
    } else if (!allowOk) {
      bad('PIPE-25b · 白名单失效：`LEGACY_PIPELINE_VERSIONS` 那行被误咬'
        + ' ⇒ 修 PIPE-25 的人会被逼去改历史枚举注释')
    } else {
      ok('PIPE-25b ✓ **负向对拍（纯内存，零落盘）**：同一行改成 v2 后 PIPE-25 的判定件'
        + '咬住 ' + dirty + ' 行；原文 0 行被咬；白名单仍放行'
        + '（⚠ 与 PIPE-25 同组常量，⛔ 本块不碰 src/ 一个字节）')
    }
  }
}

// PIPE-26 · R-09：`activeStage` 的取值域必须 ⊆ 1..6（⛔ 不含 7）
// ─────────────────────────────────────────────────────────────────────
//
// ⚠ 为什么要有这一条：`closure` 是**风险启用门**，⛔ 不是第七个业务阶段 ——
//   `pipeline.ts:44-47` 的注释自己写着「not a replacement for product acceptance」。
//   而旧码在收口未完成时设 `activeStage = 7` ⇒ 面板印「当前阶段：第 7 步 · 交付收口」
//   ⇒ 用户以为**还有第七个业务阶段**没做，而文档承诺的是「六阶段 + 一道门」。
//
// ⚠ 判据是**类型 + 运行时双重**：
//   ① 类型层：`activeStage` 的联合类型里**不许出现 7**（读源码文本）；
//   ② 运行时：跑完一整条链，`activeStage` 全程 ∈ {1..6, null}。
//
// ⚠ ② 用**真实链**跑（⛔ 不靠 mock）：`pipelineViewOf` 是纯函数，喂不同阶段的账本即可。
{
  const { readFileSync: rf } = await import('node:fs')
  const { join: pj } = await import('node:path')
  const p = []
  /** ① 类型层：源码里那行联合类型不许含 7。 */
  const srcText = rf(pj(root, 'src', 'shared', 'pipeline-view.ts'), 'utf8')
  const typeLine = srcText.split('\n').find((l) => /activeStage:\s*1\s*\|/.test(l))
  if (typeLine === undefined) p.push('读不到 activeStage 的联合类型声明（源码形态变了）')
  else if (/\|\s*7\b/.test(typeLine)) p.push(`activeStage 的类型里仍有 7：${typeLine.trim()}`)
  /** ② 运行时：走一遍各阶段，收集所有出现过的 activeStage。 */
  const seen = new Set()
  const record = (v) => { seen.add(v.activeStage) }
  /**
   * ⚠ 夹具必须**真的能走到 6** —— 我第一版只喂 `[req]` / `[req, plan]` / `[req, plan, task]`，
   *   三个都停在 1（缺审批）⇒ 运行时只收到 `[1]` ⇒ **判据空转**（实测踩过）。
   *   ⇒ 用 PIPE-18 那套「产品已接受、只差交付收口」的完整链，它必然走到 6。
   */
  record(view.pipelineViewOf(req, [req]))
  {
    const r1 = approval(req, 3, pipeline.artifactDigestOf(req))
    const built = { ...task, status: 'built', built_by: 'dev' }
    const run = { id: 'RUN-V3', kind: 'run', status: 'returned', parent: task.id, pipeline_version: 'v3', revision: '1', task_revision: '1', progress_refs: ['EVD-1'] }
    const evd = { id: 'EVD-1', kind: 'evidence', status: 'recorded', title: '读数', reading: 'exit 0', evidence_kind: 'command', command: 'npm test', exit_code: '0' }
    const ver = { id: 'VER-1', kind: 'verification', status: 'pass', parent: task.id, pipeline_version: 'v3', revision: '1', task_revision: '1', verifier: 'verifier', verification_session: 'session-verifier', verified_at: '2026-11-08T01:00:00Z', basis: ['EVD-1'], criteria_refs: ['AC-1'] }
    const acc = { id: 'ACC-V3', kind: 'acc', status: 'pass', parent: task.id, pipeline_version: 'v3', revision: '1', task_revision: '1', actor: 'acceptor', acceptance_session: 'session-acceptor', verified_at: '2026-11-08T02:00:00Z', basis: ['EVD-1'], verification_refs: ['EVD-1'], example_results: ['EX-1 | pass | EVD-1'], product_confirmation: '用户确认结果符合目标', risk_residual_tier: 'low' }
    const externalPlan = { ...plan, delivery_scope: 'external' }
    externalPlan.risk_inputs_digest = riskPolicy.riskAssessmentOf(riskPolicy.riskFactsOf(externalPlan)).inputsDigest
    externalPlan.risk_binding_digest = pipeline.riskBindingDigestOf(externalPlan, [req])
    const g2External = approval(externalPlan, 2, pipeline.artifactDigestOf(externalPlan), 'approve', { id: 'DEC-EXTERNAL-G2' })
    record(view.pipelineViewOf(req, [req, externalPlan, built, run, r1, g2External, ver, evd, acc]))
  }
  const bad2 = [...seen].filter((x) => x !== null && (typeof x !== 'number' || x < 1 || x > 6))
  if (bad2.length > 0) p.push(`运行时出现过域外的 activeStage：${JSON.stringify(bad2)}（⛔ 不许有 7）`)
  if (seen.size === 0) p.push('一个 activeStage 都没取到 ⇒ 判据空转')
  if (p.length === 0) {
    ok(`PIPE-26 ✓ \`activeStage\` 取值域 ⊆ 1..6：类型层无 7，运行时实测 ${JSON.stringify([...seen].sort())}`
      + '（R-09：收口是门不是步，未收口用 `closurePending` 表达）')
  } else for (const x of p) bad(`PIPE-26 · ${x}`)
}
console.log('')
console.log(`PIPE 组：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处${fail > 0 ? ` · 没过 ${fail} 处` : ''} · **跳过 0 处**`)
console.log('')
if (fail > 0) process.exit(1)
console.log('  ✅ PIPE 组全绿')
