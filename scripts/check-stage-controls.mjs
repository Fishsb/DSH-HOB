#!/usr/bin/env node
/**
 * **阶段内部控制**检查族。
 *
 * 守三件事：
 *   ① 需求阶段：目标、例子、阻塞问题、假设状态、可观察验收条件齐全；
 *   ② 方案 / 任务 / 执行 / 验收：路径比较、自包含任务书、小步验证、产品确认、回流目标；
 *   ③ 回流归因：需求 / 方案 / 任务 / 实现 / 环境五类互不混淆。
 *
 * ⚠ 历史单元可用 `clarify_legacy = "pre-control"` 豁免；新单元不得新增该豁免。
 * ⚠ 本族不改五步、不新增 kind，也不把控制字段混进五步分母。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
let pass = 0
let fail = 0
const ok = (m) => { pass += 1; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail += 1; console.log(`  ✗ ${m}`) }

const mod = await import(pathToFileURL(join(root, 'src', 'shared', 'stage-controls.ts')).href)
const gen = await import(pathToFileURL(join(here, 'gen-ledger.mjs')).href)

const units = gen.readUnits()
const problems = mod.stageControlProblems(units)
const ledgerRoot = gen.LEDGER_DIR
const fileProblems = mod.stageFileProblems(units, (rel) => existsSync(join(ledgerRoot, '..', rel)))

console.log('')
console.log('SC 组：五阶段内部控制（需求澄清 / 方案路径 / 任务自包含 / 回流）')
console.log('')

{
  if (units.length === 0) bad('SC-0 账本读不到单元 ⇒ 本组没有对象（⛔ 不按通过处理）')
  else ok(`SC-0 真实账本读入 **${units.length}** 条单元（${[...new Set(units.map((u) => u.kind))].sort().join(' / ')}）`)
}

{
  if (problems.length === 0 && fileProblems.length === 0) {
    ok('SC-1 ✓ 当前账本 **0 条**阶段控制缺口（需求 / 方案 / 任务 / 执行 / 验收五层都满足）')
  } else {
    const all = [...problems, ...fileProblems]
    for (const p of all.slice(0, 12)) bad(`SC-1 ${p.rule} · ${p.unit} · ${p.why}`)
    if (all.length > 12) bad(`SC-1 另有 ${all.length - 12} 条未逐条打印`)
  }
}

// ── SC-2：需求门禁逐条 ─────────────────────────────────────────────────
{
  const base = { id: 'R-SC', kind: 'req', status: 'agreed', clarify_examples: ['例子'], acceptance_criteria: ['点保存后出现成功提示'] }
  const good = mod.requirementProblems(base)
  const badQuestion = mod.requirementProblems({ ...base, clarify_questions: ['用户是否要离线模式？'] })
  const resolvedQuestion = mod.requirementProblems({ ...base, clarify_questions: ['resolved: 首版不做离线'] })
  const badAssumption = mod.requirementProblems({ ...base, clarify_assumptions: ['pending: 默认使用现有账号'] })
  const goodAssumption = mod.requirementProblems({ ...base, clarify_assumptions: ['confirmed: 默认使用现有账号'] })
  const vague = mod.requirementProblems({ ...base, acceptance_criteria: ['搜索要快'] })
  if (good.length === 0) ok('SC-2 ✓ 需求门禁正向：目标 / 例子 / 验收条件齐全 ⇒ 放行')
  else bad(`SC-2 正向应放行，实得 ${good.length} 条问题`)
  if (badQuestion.some((p) => p.rule === 'C-1')) ok('SC-2 ✓ 需求门禁：未答阻塞问题 ⇒ C-1 红')
  else bad('SC-2 未答阻塞问题没有触发 C-1')
  if (resolvedQuestion.length === 0) ok('SC-2 ✓ 需求门禁：resolved 问题不再阻塞')
  else bad('SC-2 resolved 问题仍被当成阻塞')
  if (badAssumption.some((p) => p.rule === 'C-2')) ok('SC-2 ✓ 需求门禁：pending 假设 ⇒ C-2 红')
  else bad('SC-2 pending 假设没有触发 C-2')
  if (goodAssumption.length === 0) ok('SC-2 ✓ 需求门禁：confirmed 假设放行')
  else bad('SC-2 confirmed 假设仍被阻塞')
  if (vague.some((p) => p.rule === 'C-1' && p.why.includes('不可验证'))) ok('SC-2 ✓ 需求门禁：不可验证词 ⇒ C-1 红')
  else bad('SC-2 不可验证词没有触发 C-1')
}

// ── SC-3：方案门禁逐条 ─────────────────────────────────────────────────
{
  const base = { id: 'CHG-SC', kind: 'change', status: 'settled', path_options: ['A', 'B'], path_tradeoffs: ['A 快', 'B 稳'], path_decision: '选 A', requirement_coverage: ['R-1'] }
  const good = mod.planProblems(base)
  const noPaths = mod.planProblems({ ...base, path_options: [] })
  const noCoverage = mod.planProblems({ ...base, requirement_coverage: [] })
  if (good.length === 0) ok('SC-3 ✓ 方案门禁正向：路径 / 取舍 / 推荐 / 需求映射齐全 ⇒ 放行')
  else bad(`SC-3 正向应放行，实得 ${good.length} 条问题`)
  if (noPaths.some((p) => p.rule === 'C-4')) ok('SC-3 ✓ 方案门禁：无候选路径 ⇒ C-4 红')
  else bad('SC-3 无候选路径没有触发 C-4')
  if (noCoverage.some((p) => p.rule === 'C-3')) ok('SC-3 ✓ 方案门禁：无需求映射 ⇒ C-3 红')
  else bad('SC-3 无需求映射没有触发 C-3')
}

// ── SC-4：任务门禁逐条 ─────────────────────────────────────────────────
{
  const base = { id: 'TSK-SC', kind: 'task', status: 'todo', task_brief: 'archive/x/TASK.md', counterexamples: ['空输入不崩溃'], stop_conditions: ['与方案冲突即停'], return_to: 'back-to-plan' }
  const good = mod.taskProblems(base)
  const noBrief = mod.taskProblems({ ...base, task_brief: '' })
  const noCounter = mod.taskProblems({ ...base, counterexamples: [] })
  const noStop = mod.taskProblems({ ...base, stop_conditions: [] })
  const noReturn = mod.taskProblems({ ...base, return_to: '' })
  const badReturn = mod.taskProblems({ ...base, return_to: 'stage-6' })
  if (good.length === 0) ok('SC-4 ✓ 任务门禁正向：任务书 / 反例 / 停手 / 回流齐全 ⇒ 放行')
  else bad(`SC-4 正向应放行，实得 ${good.length} 条问题`)
  for (const [name, p] of [['任务书', noBrief], ['反例', noCounter], ['停手条件', noStop], ['回流阶段', noReturn]]) {
    if (p.some((x) => x.rule === 'C-5')) ok(`SC-4 ✓ 任务门禁：缺${name} ⇒ C-5 红`)
    else bad(`SC-4 缺${name}没有触发 C-5`)
  }
  if (badReturn.some((x) => x.rule === 'C-5' && x.why.includes('封闭集'))) ok('SC-4 ✓ 任务门禁：回流目标写第六阶段 ⇒ C-5 红')
  else bad('SC-4 回流目标写成第六阶段仍被放行')
}

// ── SC-5：执行与验收门禁 ───────────────────────────────────────────────
{
  const run = mod.runProblems({ id: 'RUN-SC', kind: 'run', status: 'returned', progress_refs: [] })
  const runGood = mod.runProblems({ id: 'RUN-SC', kind: 'run', status: 'returned', progress_refs: ['检查 1 通过'] })
  const acc = mod.acceptanceProblems({ id: 'ACC-SC', kind: 'acc', status: 'pass' })
  const accGood = mod.acceptanceProblems({ id: 'ACC-SC', kind: 'acc', status: 'pass', product_confirmation: '用户确认结果符合目标' })
  const sendBack = mod.acceptanceProblems({ id: 'ACC-SC2', kind: 'acc', status: 'send-back' })
  const freeBack = mod.acceptanceProblems({ id: 'ACC-SC3', kind: 'acc', status: 'send-back', send_back_to: '重做一下' })
  if (run.some((p) => p.rule === 'C-6')) ok('SC-5 ✓ 执行门禁：已回传但无小步验证 ⇒ C-6 红')
  else bad('SC-5 已回传但无小步验证没有触发 C-6')
  if (runGood.length === 0) ok('SC-5 ✓ 执行门禁：有小步验证 ⇒ 放行')
  else bad('SC-5 有小步验证仍被阻塞')
  if (acc.some((p) => p.rule === 'C-7')) ok('SC-5 ✓ 验收门禁：通过但无产品确认 ⇒ C-7 红')
  else bad('SC-5 通过但无产品确认没有触发 C-7')
  if (accGood.length === 0) ok('SC-5 ✓ 验收门禁：技术 + 产品确认 ⇒ 放行')
  else bad('SC-5 有产品确认仍被阻塞')
  if (sendBack.some((p) => p.rule === 'C-8')) ok('SC-5 ✓ 验收门禁：退回但无目标阶段 ⇒ C-8 红')
  else bad('SC-5 退回但无目标阶段没有触发 C-8')
  if (freeBack.some((p) => p.rule === 'C-8' && p.why.includes('封闭集'))) ok('SC-5 ✓ 验收门禁：退回目标用自由文本 ⇒ C-8 红')
  else bad('SC-5 退回目标用自由文本仍被放行')
}

// ── SC-6：回流归因五类互斥 ─────────────────────────────────────────────
{
  const want = { requirement: 'requirements', plan: 'plan', task: 'tasks', implementation: 'execution', environment: null }
  const got = Object.fromEntries(mod.BLOCK_CAUSES.map((c) => [c, mod.returnStageOf(c)]))
  if (JSON.stringify(got) === JSON.stringify(want)) ok('SC-6 ✓ 回流归因：需求→1 / 方案→2 / 任务→3 / 实现→4 / 环境→单独记录')
  else bad(`SC-6 回流归因不符：${JSON.stringify(got)}`)
  const onlyFive = mod.BLOCK_CAUSES.every((c) => mod.STAGE_IDS.includes(mod.BLOCK_CAUSE_TO_STAGE[c] ?? '') || mod.BLOCK_CAUSE_TO_STAGE[c] === null)
  if (onlyFive) ok('SC-6 ✓ 回流目标只落在五阶段或环境单列档，没有第六阶段')
  else bad('SC-6 回流目标出现了五阶段之外的值')
}

// ── SC-7：负向对拍（自证夹具真的坏）────────────────────────────────────
{
  const base = { id: 'R-NEG', kind: 'req', status: 'agreed', clarify_examples: ['例子'], acceptance_criteria: ['点保存后出现成功提示'] }
  const mutated = { ...base, clarify_questions: ['用户是否要离线模式？'], clarify_assumptions: ['pending: 默认使用现有账号'] }
  const p = mod.requirementProblems(mutated)
  const hit1 = p.some((x) => x.rule === 'C-1')
  const hit2 = p.some((x) => x.rule === 'C-2')
  if (hit1 && hit2) ok('SC-7 ✓ 负向对拍（先自证：夹具同时有未答问题与 pending 假设）⇒ C-1 与 C-2 都必红')
  else bad(`SC-7 负向对拍没红：C-1=${hit1} C-2=${hit2}`)
}

// ── SC-8：历史豁免不掩盖新数据 ─────────────────────────────────────────
{
  const legacyReq = mod.requirementProblems({ id: 'R-OLD', kind: 'req', status: 'agreed', clarify_legacy: 'pre-control' })
  const freshReq = mod.requirementProblems({ id: 'R-NEW', kind: 'req', status: 'agreed' })
  if (legacyReq.length === 0) ok('SC-8 ✓ 历史存量（pre-control）不阻塞')
  else bad('SC-8 历史存量仍被阻塞')
  if (freshReq.length > 0) ok('SC-8 ✓ 新需求不得借用历史豁免 ⇒ 缺字段必红')
  else bad('SC-8 新需求缺字段却没有红（豁免泄漏）')
  const newLegacy = mod.legacyMisuse({ id: 'R-NEW-LEGACY', kind: 'req', clarify_legacy: 'pre-control', created_at: '2026-11-07' })
  if (newLegacy.some((p) => p.rule === 'C-11')) ok('SC-8 ✓ 新单元写 pre-control 豁免 ⇒ C-11 红')
  else bad('SC-8 新单元写 pre-control 豁免未被拦截')
}

// ── SC-9：文件型引用（阶段摘要 / 研究依据）────────────────────────────
{
  const good = mod.stageFileProblems(
    [{ id: 'CHG-SC', kind: 'change', stage_summary: 'archive/2026-11-06-stage-controls/proposal.md', research_refs: ['archive/2026-11-06-stage-controls/proposal.md'] }],
    () => true,
  )
  const badSummary = mod.stageFileProblems([{ id: 'CHG-SC', kind: 'change', stage_summary: 'archive/nope/STAGE-2.md' }], () => false)
  const badResearch = mod.stageFileProblems([{ id: 'CHG-SC', kind: 'change', research_refs: ['archive/nope/RESEARCH.md'] }], () => false)
  const badBrief = mod.stageFileProblems([{ id: 'TSK-SC', kind: 'task', task_brief: 'archive/nope/TASK.md' }], () => false)
  const remoteRef = mod.stageFileProblems(
    [{ id: 'CHG-SC', kind: 'change', research_refs: ['https://example.com/spec'] }],
    () => false,
  )
  if (good.length === 0) ok('SC-9 ✓ 文件引用正向：摘要与研究依据都存在 ⇒ 放行')
  else bad(`SC-9 正向应放行，实得 ${good.length} 条问题`)
  if (badSummary.some((p) => p.rule === 'C-9')) ok('SC-9 ✓ 阶段摘要引用不存在 ⇒ C-9 红')
  else bad('SC-9 阶段摘要引用不存在没有触发 C-9')
  if (badResearch.some((p) => p.rule === 'C-10')) ok('SC-9 ✓ 研究引用不存在 ⇒ C-10 红')
  else bad('SC-9 研究引用不存在没有触发 C-10')
  if (badBrief.some((p) => p.rule === 'C-9' && p.why.includes('任务书'))) ok('SC-9 ✓ 任务书引用不存在 ⇒ C-9 红')
  else bad('SC-9 任务书引用不存在没有触发 C-9')
  if (remoteRef.length === 0) ok('SC-9 ✓ 外部 URL 只作来源，不要求本地文件存在')
  else bad('SC-9 外部 URL 被误判成本地文件缺失')
}

// ── SC-10：运行时派单 / 写入门禁真的读账本 ───────────────────────────────
{
  const toolsMod = await import(pathToFileURL(join(root, 'src', 'modules', 'tools.ts')).href)
  const gate = typeof toolsMod.stageGateOfLedger === 'function'
    ? toolsMod.stageGateOfLedger(join(ledgerRoot, '..'))
    : undefined
  if (typeof toolsMod.stageGateOfLedger === 'function') ok('SC-10 ✓ 运行时门禁入口存在（stageGateOfLedger）')
  else bad('SC-10 运行时门禁入口不存在 ⇒ 派单 / 写入路径无法读取阶段控制')
  if (gate === undefined) ok('SC-10 ✓ 真实账本过运行时门禁 ⇒ 放行')
  else bad(`SC-10 真实账本应放行，实得拒绝：${gate}`)
  const wiring = [
    ['src/modules/tools.ts', 'stageGateOfLedger(root)'],
    ['src/preset/tools.ts', 'stageGateOf(root)'],
  ]
  for (const [file, needle] of wiring) {
    const text = readFileSync(join(root, file), 'utf8')
    if (text.includes(needle)) ok(`SC-10 ✓ 运行时接线在位：${file} 调用了阶段门禁`)
    else bad(`SC-10 运行时接线缺失：${file} 没有调用阶段门禁（判据只停在报表）`)
  }
}

console.log('')
console.log(`SC 组：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处${fail > 0 ? ` · 没过 ${fail} 处` : ''} · **跳过 0 处**`)
console.log('')
if (fail > 0) {
  console.log('  ⛔ 有失败项 ⇒ 本组不算通过')
  process.exit(1)
}
console.log('  ✅ SC 组全绿（⚠ 历史存量按 pre-control 只读豁免；新数据必须过门禁）')
process.exit(0)
