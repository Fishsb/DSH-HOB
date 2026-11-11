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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
/**
 * ⚠ 临时目录只在本脚本自己的 `.tmp-*` 名下（⛔ 不碰账本、⛔ 不碰用户工作区）。
 *   用完即删；`force: true` 让"本来就不存在"也不报错。
 */
const cleanup = (p) => { try { rmSync(p, { recursive: true, force: true }) } catch { /* 清理失败不掩盖结论 */ } }
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
const legacyUnits = units.filter((u) => String(u.clarify_legacy ?? '').trim() === 'pre-control')
const legacyNoStamp = legacyUnits.filter((u) => String(u.created_at ?? '').trim() === '')

console.log('')
console.log('SC 组：阶段内部控制（需求澄清 / 方案路径 / 任务自包含 / 技术验证 / 产品验收 / 交付收口 / 回流）')
console.log('')

{
  if (units.length === 0) bad('SC-0 账本读不到单元 ⇒ 本组没有对象（⛔ 不按通过处理）')
  else ok(`SC-0 真实账本读入 **${units.length}** 条单元（${[...new Set(units.map((u) => u.kind))].sort().join(' / ')}）`)
  if (legacyUnits.length === 0) bad('SC-0 历史豁免单元为 0 ⇒ 豁免覆盖面无法核对（⛔ 不按通过处理）')
  else if (legacyNoStamp.length === 0) ok(`SC-0 ✓ ${legacyUnits.length} 条历史豁免单元都有 created_at（早于控制上线日）`)
  else bad(`SC-0 ${legacyNoStamp.length}/${legacyUnits.length} 条历史豁免缺 created_at：${legacyNoStamp.slice(0, 5).map((u) => u.id).join(' / ')}`)
}

// ── SC-0b：就绪度必须同时报“结构非法”和“字段缺口” ─────────────────────────
//
// 真实故障：`prompt-enhancer-release` 的 `TSK-345.status=settled` 让阶段接口整本
// `row-shape-unknown`，而就绪度只跑字段门禁 ⇒ 两边对同一本账给出相反结论。
{
  const readinessMod = await import(pathToFileURL(join(root, 'src', 'shared', 'ledger-readiness.ts')).href)
  const shape = readinessMod.assessLedgerReadiness({
    ledgerRoot: '/fixture',
    unitsDirExists: true,
    indexText: [
      '[[unit]]',
      'id = "TSK-BAD"',
      'kind = "task"',
      'status = "settled"',
      'title = "非法状态"',
      '',
    ].join('\n'),
    shardTexts: [],
  })
  const p = []
  if (shape.state !== 'unhealthy') p.push(`非法状态没有判 unhealthy：${shape.state}`)
  if (!shape.gaps.some((g) => g.rule === 'S-0' && g.unit === 'TSK-BAD')) {
    p.push(`缺口未点名 S-0 / TSK-BAD：${JSON.stringify(shape.gaps)}`)
  }
  if (!shape.headline.includes('缺口')) p.push(`结论没有说缺口：${shape.headline}`)
  if (p.length === 0) ok('SC-0b ✓ 非法 kind/status 在就绪度里被 S-0 点名，与阶段接口同口径')
  else for (const x of p) bad(`SC-0b · ${x}`)
}

// ── SC-0c：旧 kind/status 词迁移必须只预演、可真落盘且不碰无关值 ───────────
{
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const toolsMod = await import(pathToFileURL(join(root, 'src', 'modules', 'tools.ts')).href)
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-hob-migrate-'))
  try {
    mkdirSync(join(tmp, 'ledger', 'units'), { recursive: true })
    writeFileSync(join(tmp, 'ledger', 'units', 'index.toml'), [
      '[[unit]]',
      'id = "TSK-OLD"',
      'kind = "task"',
      'status = "settled"',
      'title = "old task"',
      '',
      '[[unit]]',
      'id = "EVD-OLD"',
      'kind = "evd"',
      'status = "settled"',
      'title = "old evidence"',
      '',
      '[[unit]]',
      'id = "DEC-OLD"',
      'kind = "decision"',
      'status = "settled"',
      'title = "old decision"',
      '',
    ].join('\n'), 'utf8')
    const toolset = toolsMod.createHobTools({
      workspaceRoot: tmp,
      ledgerRoot: tmp,
      ledgerHome: tmp,
      enableWrite: true,
      maxFileBytes: 65536,
      maxWriteBytes: 262144,
    }, {})
    const exec = { agent: { session: { header: { cwd: tmp } } } }
    const dryRaw = await toolset.ledgerMigrate.execute({}, exec)
    const dry = typeof dryRaw === 'string' ? JSON.parse(dryRaw) : dryRaw
    const srcAfterDry = readFileSync(join(tmp, 'ledger', 'units', 'index.toml'), 'utf8')
    const wetRaw = await toolset.ledgerMigrate.execute({ dryRun: false }, exec)
    const wet = typeof wetRaw === 'string' ? JSON.parse(wetRaw) : wetRaw
    const after = readFileSync(join(tmp, 'ledger', 'units', 'index.toml'), 'utf8')
    const p = []
    if (dry.dryRun !== true || dry.changes?.length !== 4) p.push(`预演不完整：${JSON.stringify(dry)}`)
    if (!srcAfterDry.includes('status = "settled"')) p.push('预演竟然写盘了')
    if (wet.changes?.length !== 4) p.push(`真迁移失败：${JSON.stringify(wet)}`)
    /**
     * ⚠ 迁移只负责把旧**词**换成现行词；它不伪造任务书或父方案。
     *   夹具因此保留真实缺口，期望 `ok:false + state:unhealthy`，并明确回报缺口。
     */
    if (wet.ok !== false || wet.state !== 'unhealthy' || !(wet.gapCount > 0)) p.push(`迁移后未如实报告剩余缺口：${JSON.stringify(wet)}`)
    if (!/id = "TSK-OLD"[\s\S]*?status = "built"/.test(after)) p.push('task settled 未迁 built')
    if (!/id = "EVD-OLD"\nkind = "evidence"\nstatus = "recorded"/.test(after)) p.push('evd/settled 未迁 evidence/recorded')
    if (!/id = "DEC-OLD"[\s\S]*?status = "active"/.test(after)) p.push('decision settled 未迁 active')
    if (p.length === 0) ok('SC-0c ✓ 旧词迁移：预演零写盘 / 3 类映射真落盘 / 无关字段保留')
    else for (const x of p) bad(`SC-0c · ${x}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
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
  const accFixture = {
    id: 'ACC-SC',
    kind: 'acc',
    status: 'pass',
    parent: 'TSK-SC',
    actor: 'session-acceptor',
    acceptance_session: 'session-acceptor',
    product_confirmation: '用户确认结果符合目标',
    verification_refs: ['EVD-SC'],
    example_results: ['EX-1 | pass | 点保存后出现成功提示'],
  }
  const accUnits = [{ id: 'TSK-SC', kind: 'task', built_by: 'session-builder' }, accFixture]
  const accGood = mod.acceptanceProblems(accFixture, accUnits)
  const accNoSession = mod.acceptanceProblems({ ...accFixture, acceptance_session: '' }, accUnits)
  const accSelf = mod.acceptanceProblems({ ...accFixture, actor: 'session-builder', acceptance_session: 'session-builder' }, accUnits)
  const accNoVerification = mod.acceptanceProblems({ ...accFixture, verification_refs: [] }, accUnits)
  const accNoExamples = mod.acceptanceProblems({ ...accFixture, example_results: [] }, accUnits)
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
  if (accNoSession.some((p) => p.rule === 'C-7' && p.why.includes('acceptance_session'))) ok('SC-5 ✓ 验收门禁：缺独立验收会话 ⇒ C-7 红')
  else bad('SC-5 缺独立验收会话仍被放行')
  if (accSelf.some((p) => p.rule === 'C-7' && p.why.includes('同一个会话'))) ok('SC-5 ✓ 验收门禁：验收者就是实现者 ⇒ C-7 红')
  else bad('SC-5 自己验自己仍被放行')
  if (accNoVerification.some((p) => p.rule === 'C-7' && p.why.includes('verification_refs'))) ok('SC-5 ✓ 验收门禁：缺技术验证证据 ⇒ C-7 红')
  else bad('SC-5 缺技术验证证据仍被放行')
  if (accNoExamples.some((p) => p.rule === 'C-7' && p.why.includes('example_results'))) ok('SC-5 ✓ 验收门禁：缺用户例子结果 ⇒ C-7 红')
  else bad('SC-5 缺用户例子结果仍被放行')
  // ── SC-34 · S-03：`built_by` 缺失必须 **fail-closed**（⛔ 不是静默放行）──────
  /**
   * ⚠⚠ **它守什么**：改前写的是 `builder !== '' && acceptor === builder` ⇒
   *   **父任务没有 `built_by` 时这条根本不检查**，于是「自己验自己」被静默放过。
   *   缺失反而让检查更容易通过 = **fail-open**。
   *
   * ⚠ **为什么必须对齐 K-6**：`convergence.ts:380` 对同一语义是 fail-closed
   *   （`built_by` 缺 ⇒ 直接报「没法判」）。同一语义、两个模块、两种方向 ⇒
   *   **判定会随走哪条路而变** —— 那本身就是缺陷。
   *
   * ⚠ 判据：**父任务无 `built_by` + 验收者 = 实现者** ⇒ `acceptanceProblems` **必须非空**。
   *   ⚠ 反证（正例）：父任务**有** `built_by` 且验收者不同 ⇒ 必须**空**（⛔ 否则判据恒红）。
   */
  {
    const noBuiltBy = [{ id: 'TSK-SC', kind: 'task' }, accFixture]
    const p1 = mod.acceptanceProblems({ ...accFixture, actor: 'session-x' }, noBuiltBy)
    const hasBuiltBy = mod.acceptanceProblems(accFixture, accUnits)
    const probs = []
    if (!p1.some((x) => x.rule === 'C-7')) {
      probs.push('父任务缺 built_by ⇒ 没有报 C-7（fail-open：缺失反而放行）')
    } else if (!p1.some((x) => String(x.why).includes('built_by') || String(x.why).includes('没法判'))) {
      probs.push(`报是报了，但没说清是「缺 built_by」：${JSON.stringify(p1.find((x) => x.rule === 'C-7')?.why)}`)
    }
    if (hasBuiltBy.length !== 0) {
      probs.push(`正例（有 built_by + 验收者不同）**仍被阻塞** ${hasBuiltBy.length} 条 ⇒ 判据会恒红`)
    }
    if (probs.length === 0) {
      ok('SC-34 ✓ 父任务缺 `built_by` ⇒ C-7 红且明说「没法判」（S-03：与 K-6 同为 fail-closed）'
        + '；⚠ 反证：有 `built_by` 且验收者不同 ⇒ 放行')
    } else for (const x of probs) bad(`SC-34 · ${x}`)
  }
  if (sendBack.some((p) => p.rule === 'C-8')) ok('SC-5 ✓ 验收门禁：退回但无目标阶段 ⇒ C-8 红')
  else bad('SC-5 退回但无目标阶段没有触发 C-8')
  if (freeBack.some((p) => p.rule === 'C-8' && p.why.includes('封闭集'))) ok('SC-5 ✓ 验收门禁：退回目标用自由文本 ⇒ C-8 红')
  else bad('SC-5 退回目标用自由文本仍被放行')
}

// ── SC-6：回流归因五类互斥 ─────────────────────────────────────────────
{
  const want = {
    requirement: 'requirements', plan: 'plan', task: 'tasks', implementation: 'execution',
    verification: 'verification', acceptance: 'acceptance', closure: 'closure', environment: null,
  }
  const got = Object.fromEntries(mod.BLOCK_CAUSES.map((c) => [c, mod.returnStageOf(c)]))
  if (JSON.stringify(got) === JSON.stringify(want)) ok('SC-6 ✓ 回流归因：需求 / 方案 / 任务 / 实现 / 验证 / 验收 / 收口各回本阶段，环境单独记录')
  else bad(`SC-6 回流归因不符：${JSON.stringify(got)}`)
  const onlyFive = mod.BLOCK_CAUSES.every((c) => mod.STAGE_IDS.includes(mod.BLOCK_CAUSE_TO_STAGE[c] ?? '') || mod.BLOCK_CAUSE_TO_STAGE[c] === null)
  if (onlyFive) ok('SC-6 ✓ 回流目标只落在已登记阶段或环境单列档')
  else bad('SC-6 回流目标出现了未登记阶段')
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
  const noStampLegacy = mod.legacyMisuse({ id: 'R-NO-STAMP', kind: 'req', clarify_legacy: 'pre-control' })
  if (newLegacy.some((p) => p.rule === 'C-11')) ok('SC-8 ✓ 新单元写 pre-control 豁免 ⇒ C-11 红')
  else bad('SC-8 新单元写 pre-control 豁免未被拦截')
  if (noStampLegacy.some((p) => p.rule === 'C-11' && p.why.includes('created_at'))) ok('SC-8 ✓ 历史豁免缺创建时间 ⇒ C-11 红')
  else bad('SC-8 历史豁免缺创建时间仍被放行')
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

// ── SC-18：条目标题必须能独立理解（2026-11-07 · 条目展示批次）─────────
{
  const good = mod.titleProblems({ id: 'TSK-100', kind: 'task', title: '把条目行改成两行并保留展开详情', parent: 'CHG-100' })
  const empty = mod.titleProblems({ id: 'TSK-101', kind: 'task', title: '', parent: 'CHG-100' })
  const onlyId = mod.titleProblems({ id: 'TSK-102', kind: 'task', title: 'TSK-102', parent: 'CHG-100' })
  const legacyOnlyId = mod.titleProblems({ id: 'TSK-108', kind: 'task', title: 'TSK-108', parent: 'CHG-100', clarify_legacy: 'pre-control', created_at: '2026-11-05' })
  const period = mod.titleProblems({ id: 'TSK-103', kind: 'task', title: 'P2：第 2 期（该期任务书）', parent: 'CHG-100' })
  const status = mod.titleProblems({ id: 'ACC-104', kind: 'acc', title: '待独立验收', parent: 'TSK-103' })
  const foreign = mod.titleProblems({ id: 'ACC-105', kind: 'acc', title: '验收 R-999 的某个能力', parent: 'TSK-103' })
  const parentReq = mod.titleProblems(
    { id: 'ACC-106', kind: 'acc', title: '验收 R-106 能力', parent: 'TSK-106' },
    [{ id: 'TSK-106', kind: 'task', title: '任务', parent: 'CHG-106', req_ids: ['R-106'], status: 'built' }],
  )
  const legacy = mod.titleProblems({ id: 'ACC-107', kind: 'acc', title: '待独立验收', parent: 'TSK-107', clarify_legacy: 'pre-control', created_at: '2026-11-05' })
  if (good.length === 0) ok('SC-18 ✓ 正常自包含标题 ⇒ 放行')
  else bad(`SC-18 正常标题被误伤：${JSON.stringify(good)}`)
  if (empty.length === 0) ok('SC-18 ✓ 缺 title 字段不在这里重复开火（I1 必填负责）')
  else bad('SC-18 缺 title 字段被 C-17 重复报红')
  if (onlyId.some((p) => p.rule === 'C-17' && p.why.includes('编号'))) ok('SC-18 ✓ 新条目 title=id ⇒ C-17 红')
  else bad('SC-18 新条目 title=id 没有被 C-17 拦截')
  if (legacyOnlyId.length === 0) ok('SC-18 ✓ 历史条目 title=id 只做展示投影，不误伤')
  else bad(`SC-18 历史 title=id 被误伤：${JSON.stringify(legacyOnlyId)}`)
  if (period.some((p) => p.rule === 'C-17')) ok('SC-18 ✓ 只有期次/轮次的标题 ⇒ C-17 红')
  else bad('SC-18 期次式空壳标题没有触发 C-17')
  if (status.some((p) => p.rule === 'C-17')) ok('SC-18 ✓ 只有状态词的标题 ⇒ C-17 红')
  else bad('SC-18 只有状态词的标题没有触发 C-17')
  if (foreign.some((p) => p.rule === 'C-17' && p.why.includes('R-999'))) ok('SC-18 ✓ 标题引用无关编号 ⇒ C-17 红')
  else bad('SC-18 标题引用无关编号没有触发 C-17')
  if (parentReq.length === 0) ok('SC-18 ✓ 验收标题引用父任务的正式需求 ⇒ 不误伤')
  else bad(`SC-18 正式需求引用被误伤：${JSON.stringify(parentReq)}`)
  if (legacy.length === 0) ok('SC-18 ✓ 历史条目只做展示投影，不因旧标题被 C-17 阻断')
  else bad('SC-18 历史条目被 C-17 误伤')
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
    ['src/modules/bus.ts', 'proceedGateOf?.(exec)'],
    ['src/preset/tools.ts', 'dispatchGateAt(root, {})'],
    ['src/preset/tools.ts', 'dispatchGateAt(root, scope)'],
  ]
  for (const [file, needle] of wiring) {
    const text = readFileSync(join(root, file), 'utf8')
    if (text.includes(needle)) ok(`SC-10 ✓ 运行时接线在位：${file} 调用了阶段门禁`)
    else bad(`SC-10 运行时接线缺失：${file} 没有调用阶段门禁（判据只停在报表）`)
  }

  // ── SC-11：作用域门禁（无关缺口不阻塞当前任务；修复写可区分）────────────
  if (typeof toolsMod.stageGateAtLedger === 'function'
    && typeof toolsMod.stageGateOfTask === 'function'
    && typeof toolsMod.stageHealthOfLedger === 'function') {
    ok('SC-11 ✓ 作用域门禁入口存在（stageGateAtLedger / stageGateOfTask / stageHealthOfLedger）')
  } else {
    bad('SC-11 作用域门禁入口缺失 ⇒ 运行时仍只能全局阻塞')
  }

  /**
   * 用一个**合成作用域**验证纯函数：A 链干净、B 链有缺口 ⇒ A 放行、B 回流。
   *
   * ⚠⚠ **2026-11-08 修夹具**：改前这里把 `TSK-A.parent` 直接指向 `R-A`（需求），
   *   即**跳过了方案那一步**。加了闭环判据（L-2：任务的 parent 必须是 change）之后
   *   它当场变红 —— 而这恰恰是**夹具本身错了**，不是判据错了：
   *   「任务直接挂在需求下」正是用户报的「新任务没走阶段流程」那种形态。
   *   ⇒ 补一条真实方案 `CHG-A`，让 A 链成为一条**完整**的链：
   *     需求 → 方案（settled，四件齐全）→ 任务（字段齐全）。
   */
  const scopeUnits = [
    { id: 'R-A', kind: 'req', status: 'agreed', clarify_examples: ['例子'], acceptance_criteria: ['点保存后出现成功提示'] },
    {
      id: 'CHG-A', kind: 'change', status: 'settled', parent: 'R-A', req_ids: ['R-A'],
      path_options: ['A 直接改', 'B 抽公共层'], path_tradeoffs: ['A 快但耦合', 'B 慢但可复用'],
      path_decision: '选 A：改动面小', requirement_coverage: ['R-A → 保存按钮'],
    },
    { id: 'TSK-A', kind: 'task', status: 'todo', parent: 'CHG-A', task_brief: 'archive/x/TASK-A.md', counterexamples: ['空输入'], stop_conditions: ['冲突即停'], return_to: 'back-to-plan' },
    /**
     * ⚠ B 链只留**一处**缺口：需求 `R-B` 缺例子与验收条件（C-1）。
     *   方案与任务的字段都写全 —— 否则缺口会同时落在 CHG-B / TSK-B 上，
     *   就测不到"回流指到**最早失效阶段**"这条语义了。
     */
    { id: 'R-B', kind: 'req', status: 'agreed' },
    {
      id: 'CHG-B', kind: 'change', status: 'settled', parent: 'R-B', req_ids: ['R-B'],
      path_options: ['A', 'B'], path_tradeoffs: ['A 快', 'B 稳'],
      path_decision: '选 A', requirement_coverage: ['R-B → 某处'],
    },
    {
      id: 'TSK-B', kind: 'task', status: 'todo', parent: 'CHG-B',
      task_brief: 'archive/x/TASK-B.md', counterexamples: ['空输入'],
      stop_conditions: ['冲突即停'], return_to: 'back-to-requirement',
    },
  ]
  const cleanA = mod.evaluateGate({ action: 'write-forward', scope: { kind: 'task', id: 'TSK-A' }, units: scopeUnits })
  const dirtyB = mod.evaluateGate({ action: 'write-forward', scope: { kind: 'task', id: 'TSK-B' }, units: scopeUnits })
  if (cleanA.decision === 'go') ok('SC-11 ✓ 作用域门禁：A 链干净 ⇒ 放行（B 链缺口不在 A 的作用域内）')
  else bad(`SC-11 A 链应放行，实得 ${cleanA.decision}：${cleanA.blockers.map((p) => p.rule + '·' + p.unit).join(' / ')}`)
  /**
   * ⚠ 2026-11-08：B 链现在有**两处**缺口（需求缺例子/验收条件 + 方案缺路径比较），
   *   而断言原来只认 `R-B` 那一条。⚠ 判据该问的是"缺口是否落在**B 这条链自己**身上"，
   *   ⛔ 不是"缺口必须恰好是 R-B"（那会把"多报了一条真缺口"也判成错）。
   */
  const bOwned = new Set(['R-B', 'CHG-B', 'TSK-B'])
  if (dirtyB.decision === 'return' && dirtyB.blockers.length > 0
    && dirtyB.blockers.every((p) => bOwned.has(p.unit))
    && dirtyB.blockers.some((p) => p.unit === 'R-B')) {
    ok('SC-11 ✓ 作用域门禁：B 链自身有缺口 ⇒ 回流（缺口全落在 B 链内，且包含最早失效的需求）')
  } else bad(`SC-11 B 链应回流且缺口只在 B 链内，实得 ${dirtyB.decision}：${dirtyB.blockers.map((p) => p.rule + '·' + p.unit).join(' / ')}`)
  const repairAny = mod.evaluateGate({ action: 'write-repair', scope: { kind: 'task', id: 'TSK-B' }, units: scopeUnits })
  if (repairAny.decision === 'go') ok('SC-11 ✓ 修复写：允许补 blocker（不会被同一 blocker 死锁）')
  else bad('SC-11 修复写仍被 blocker 拦住 ⇒ 账本缺陷永远修不掉')

  // 写入工具的 repair 逃闸必须被拒：用一个无关 id 冒充修复目标。
  const srcTools = readFileSync(join(root, 'src', 'modules', 'tools.ts'), 'utf8')
  if (srcTools.includes('repair-target-not-a-blocker') && srcTools.includes("gateIntent === 'repair'")) {
    ok('SC-11 ✓ 修复写有真实目标校验（repair-target-not-a-blocker）')
  } else bad('SC-11 写入工具没有校验 repairOf 是否命中真实 blocker ⇒ repair 可被拿来逃闸')

  // ── SC-12：验收判决真的读账本（不是只看 taskId + basis）──────────────
  const srcOrch = readFileSync(join(root, 'src', 'modules', 'orchestrator.ts'), 'utf8')
  if (typeof toolsMod.acceptanceGateOfLedger === 'function') {
    ok('SC-12 ✓ 验收门禁入口存在（acceptanceGateOfLedger）')
  } else bad('SC-12 验收门禁入口缺失 ⇒ accept 仍只看参数')
  if (srcOrch.includes('acceptanceGateOf') && srcOrch.includes("args.action === 'accept'")) {
    ok('SC-12 ✓ accept 分支调用验收门禁（send-back 不受影响）')
  } else bad('SC-12 accept 没有接验收门禁')
  if (srcOrch.includes('验收门禁未接入（acceptanceGateOf 缺席）')) {
    ok('SC-12 ✓ 门禁缺席时 fail-closed（⛔ 不退回只看参数）')
  } else bad('SC-12 accept 在门禁缺席时会静默放行')
  const realGate = toolsMod.acceptanceGateOfLedger(join(ledgerRoot, '..'), 'TSK-076')
  if (realGate.ok) ok('SC-12 ✓ 真实账本 TSK-076 的 ACC-062 通过验收门禁（证据齐全）')
  else bad(`SC-12 真实 ACC-062 未通过验收门禁：${realGate.reason}`)
  const missing = toolsMod.acceptanceGateOfLedger(join(ledgerRoot, '..'), 'TSK-NOT-EXIST')
  if (!missing.ok && String(missing.reason ?? '').includes('没有挂在')) {
    ok('SC-12 ✓ 无验收单元的 task ⇒ 拒绝（回传 ≠ 验收）')
  } else bad('SC-12 无验收单元的 task 仍被放行')

  // ── SC-12b：预设层必须把**执行上下文**交给 ledgerRootOf ──────────────
  //   ⚠ 病灶（2026-11-07 真机）：`acceptanceGateFor` 写成
  //     `ledgerRootOf(config, exec?.agent ?? exec)` ⇒ 传的是 Agent，
  //     而 `ledgerRootOf` 读 `exec.agent.session.header.cwd` ⇒ **恒定判不出**
  //     ⇒ `hob_orch_control accept` 永远回「无法确定账本目录」。
  //   ⚠ 判据用**真源码行为**，⛔ 不只 grep 字符串：同一份 config 下，
  //     执行上下文能解析出账本根、Agent 形态必须解析不出。
  const cfgForRoot = { workspaceRoot: '', ledgerHome: join(ledgerRoot, '..', '..') }
  const sessionForRoot = { header: { cwd: root } }
  const ctxShape = { agent: { session: sessionForRoot } }
  if (typeof toolsMod.ledgerRootOf === 'function') {
    const fromCtx = toolsMod.ledgerRootOf(cfgForRoot, ctxShape)
    const fromAgent = toolsMod.ledgerRootOf(cfgForRoot, ctxShape.agent)
    if (typeof fromCtx === 'string' && fromCtx !== '') {
      ok('SC-12b ✓ 传执行上下文能解析账本根（ledgerRootOf 的唯一正确入参形态）')
    } else bad('SC-12b 传执行上下文解析不出账本根 ⇒ accept / dispatch 门禁无法落账')
    if (fromAgent === undefined) {
      ok('SC-12b ✓ 传 Agent（少了 .agent.session）解析不出账本根 ⇒ 该形态必被拒，不是可接受的等价写法')
    } else bad('SC-12b 传 Agent 也能解析出账本根 ⇒ 本判据的负向对拍失效，需重核入参口径')
    const presetSrc = readFileSync(join(root, 'src', 'preset', 'tools.ts'), 'utf8')
    const badCalls = [...presetSrc.matchAll(/ledgerRootOf\(config,\s*exec\?\.agent\s*\?\?\s*exec\)/g)]
    if (badCalls.length === 0) {
      ok('SC-12b ✓ 预设层没有 `ledgerRootOf(config, exec?.agent ?? exec)` 这种恒判不出的写法')
    } else bad(`SC-12b 预设层仍有 ${badCalls.length} 处 \`ledgerRootOf(config, exec?.agent ?? exec)\` ⇒ accept / dispatch 会恒判不出`)
  } else bad('SC-12b ledgerRootOf 入口缺失 ⇒ 无法核对入参形态')

  // ── SC-13：派单 / 投递门禁按作用域（⛔ 不再扫全账本）─────────────────────
  if (typeof toolsMod.dispatchGateAtLedger === 'function') {
    ok('SC-13 ✓ 作用域派单门禁入口存在（dispatchGateAtLedger）')
  } else {
    bad('SC-13 作用域派单门禁入口缺失 ⇒ hob_send / hob_spawn 仍会被无关缺口阻塞')
  }
  const realDispatch = toolsMod.dispatchGateAtLedger(join(ledgerRoot, '..'), {})
  if (realDispatch.blocked === undefined) {
    ok('SC-13 ✓ 真实账本无任务 / 无活动计划 ⇒ 不硬拦（项目作用域只报健康）')
  } else {
    bad(`SC-13 真实账本被派单门禁拦下：${realDispatch.blocked}`)
  }
  /**
   * V2 is a clean cut: field completeness on a legacy task is not enough to
   * dispatch it. Keep the scope-gate entry point covered while requiring the
   * explicit legacy refusal at the Pipeline boundary.
   */
  const taskGate = toolsMod.dispatchGateAtLedger(join(ledgerRoot, '..'), { taskId: 'TSK-076' })
  if (taskGate.blocked !== undefined && String(taskGate.blocked).includes('旧管线条目只读')) {
    ok('SC-13 ✓ 旧任务 TSK-076 即使字段完整也不能进入 v2 派单；拒绝原因明确')
  } else bad(`SC-13 旧任务 TSK-076 没有在 v2 边界被明确拒绝：${taskGate.blocked}`)
  const presetSrc = readFileSync(join(root, 'src', 'preset', 'tools.ts'), 'utf8')
  if (presetSrc.includes('dispatchGateAt(root, {})')) {
    ok('SC-13 ✓ hob_send / hob_spawn 走作用域门禁（不是 stageGateOfLedger 全局）')
  } else bad('SC-13 hob_send / hob_spawn 仍接全局门禁')
  if (srcOrch.includes('proceedGateOf?.(exec, {') && srcOrch.includes('planId: args.planId.trim()')) {
    ok('SC-13 ✓ hob_dispatch 把 task / planId 交给门禁（单目标与多轨都按作用域）')
  } else bad('SC-13 hob_dispatch 没有把作用域参数传给门禁')

  // ── SC-14：证据可逐条回溯 · 有条件通过必须有整改项 ────────────────────
  const accFixture = {
    id: 'ACC-SC14',
    kind: 'acc',
    status: 'pass',
    parent: 'TSK-SC14',
    actor: 'session-acceptor',
    acceptance_session: 'session-acceptor',
    product_confirmation: '用户确认结果符合目标',
    verification_refs: ['EVD-071'],
    example_results: ['EX-1 | pass | EVD-071 | 点保存后出现提示'],
  }
  const accUnits = [{ id: 'TSK-SC14', kind: 'task', built_by: 'session-builder' }, accFixture]
  const c12Good = mod.acceptanceProblems({ ...accFixture, example_results: ['EX-1 | pass | EVD-071 | 点保存后出现提示'] }, accUnits)
  if (c12Good.length === 0) ok('SC-14 ✓ 三段式例子结果 + 证据 ⇒ 放行')
  else bad(`SC-14 合法例子结果被阻塞：${c12Good.map((p) => p.rule).join('/')}`)
  const c12Bare = mod.acceptanceProblems({ ...accFixture, example_results: ['都通过了'] }, accUnits)
  if (c12Bare.some((p) => p.rule === 'C-12')) ok('SC-14 ✓ 例子结果写成一句结论（无逐条结构）⇒ C-12 红')
  else bad('SC-14 "都通过了" 仍被当成证据')
  const c12FailNoEv = mod.acceptanceProblems({ ...accFixture, example_results: ['EX-1 | fail |  | 保存后没有提示'] }, accUnits)
  if (c12FailNoEv.some((p) => p.rule === 'C-12' && p.why.includes('证据'))) ok('SC-14 ✓ 非通过例子缺证据引用 ⇒ C-12 红')
  else bad('SC-14 非通过例子没有证据引用仍被放行')
  const c13 = mod.acceptanceProblems({ ...accFixture, release_ready: 'no' }, accUnits)
  if (c13.some((p) => p.rule === 'C-13')) ok('SC-14 ✓ 有条件通过但无整改项 ⇒ C-13 红')
  else bad('SC-14 有条件通过可以没有整改项')
  const c13Good = mod.acceptanceProblems({
    ...accFixture,
    release_ready: 'no',
    liens: ['Hob | 2026-11-10 | 仅影响文档 | EVD-071'],
  }, accUnits)
  if (c13Good.length === 0) ok('N-SC14 ✓ 负向对拍：有条件通过 + 整改项 ⇒ 放行（判据不是恒拒）')
  else bad(`N-SC14 有条件通过带整改项仍被阻塞：${c13Good.map((p) => p.rule).join('/')}`)

  // ── SC-15：发布子门禁（构建 / 重启 / 冒烟）────────────────────────────
  const relMissing = mod.acceptanceProblems({ ...accFixture, release_ready: 'yes' }, accUnits)
  if (relMissing.some((p) => p.rule === 'C-14')) ok('SC-15 ✓ 声明可发布但无发布证据 ⇒ C-14 红')
  else bad('SC-15 声明可发布却没有构建/重启/冒烟证据仍被放行')
  const relGood = mod.acceptanceProblems({
    ...accFixture,
    release_ready: 'yes',
    release_refs: ['npm run build exit 0', 'restart WSL 3080', 'smoke: root 200 / work-plans ok'],
  }, accUnits)
  if (relGood.length === 0) ok('N-SC15 ✓ 负向对拍：三类发布证据齐全 ⇒ 放行')
  else bad(`N-SC15 发布证据齐全仍被阻塞：${relGood.map((p) => p.rule).join('/')}`)

  // ── SC-16：独立验收交接件模板（包 / 报告）── 关键字段不得丢 ──────────────
  const packet = readFileSync(join(root, 'kit', 'templates', 'ACCEPTANCE-PACKET.md'), 'utf8')
  const report = readFileSync(join(root, 'kit', 'templates', 'ACCEPTANCE-REPORT.md'), 'utf8')
  const packetNeeds = ['用户目标', '关键例子', '验收判据', '方案决策', '任务范围与非范围', '证据引用', '复跑命令', '已知限制']
  const packetMissing = packetNeeds.filter((x) => !packet.includes(x))
  if (packetMissing.length === 0) ok('SC-16 ✓ 验收包模板八段齐全（目标 / 例子 / 判据 / 方案 / 范围 / 证据 / 复跑 / 限制）')
  else bad(`SC-16 验收包模板缺段：${packetMissing.join(' / ')}`)
  const reportNeeds = ['判决', '用户例子逐条结果', '非符合项', '残余风险', '整改项', '退回目标']
  const reportMissing = reportNeeds.filter((x) => !report.includes(x))
  if (reportMissing.length === 0) ok('SC-16 ✓ 验收报告模板六段齐全（判决 / 例子 / 非符合 / 残余风险 / 整改 / 退回目标）')
  else bad(`SC-16 验收报告模板缺段：${reportMissing.join(' / ')}`)
  if (/EX-\d+\s*\|\s*pass\s*\/\s*fail\s*\|/.test(report)) ok('SC-16 ✓ 报告模板写死逐条例子形态（EX-id | pass/fail | 证据）')
  else bad('SC-16 报告模板没有逐条例子形态 ⇒ C-12 无法落地')
  if (/back-to-requirement/.test(report) && /back-to-plan/.test(report) && /back-to-task/.test(report)) {
    ok('SC-16 ✓ 报告模板的退回目标只收封闭三值')
  } else bad('SC-16 报告模板没有封闭三值退回目标')
  const initSrc = readFileSync(join(root, 'kit', 'INIT.md'), 'utf8')
  if (initSrc.includes('ACCEPTANCE-PACKET.md') && initSrc.includes('ACCEPTANCE-REPORT.md')) {
    ok('SC-16 ✓ INIT 说明了两个独立验收交接件')
  } else bad('SC-16 INIT 没有说明独立验收交接件 ⇒ 新工作区不知道它们存在')

  // ── SC-17：高风险独立评审 · 证据可复跑（Wave 2 / 4）────────────────────
  const chgBase = {
    id: 'CHG-SC17', kind: 'change', status: 'settled',
    path_options: ['A', 'B'], path_tradeoffs: ['A 快', 'B 稳'], path_decision: '选 A',
    requirement_coverage: ['R-1'], built_by: 'session-author', pipeline_version: 'v3', revision: '1',
  }
  const chgHighBad = mod.planProblems({ ...chgBase, risk_tier: 'high' })
  if (chgHighBad.some((p) => p.rule === 'C-15')) ok('SC-17 ✓ 高风险变更无独立评审 ⇒ C-15 红')
  else bad('SC-17 高风险变更没有评审仍被放行')
  const chgHighSelf = mod.planProblems({ ...chgBase, risk_tier: 'high', reviewer: 'session-author', review_refs: ['archive/x/REVIEW.md'] })
  if (chgHighSelf.some((p) => p.rule === 'C-15' && p.why.includes('作者本人'))) ok('SC-17 ✓ 高风险变更自己评审自己 ⇒ C-15 红')
  else bad('SC-17 高风险变更自评仍被放行')
  /**
   * The positive control is about the C-15 review gate only. A complete v3
   * risk assessment is exercised in the risk-policy family; here the fixture
   * stays legacy so unrelated RP-3/RP-9 completeness checks cannot mask C-15.
   */
  const legacyChgBase = { ...chgBase }
  delete legacyChgBase.pipeline_version
  delete legacyChgBase.revision
  const chgHighGood = mod.planProblems({ ...legacyChgBase, risk_tier: 'high', reviewer: 'session-reviewer', review_refs: ['archive/x/REVIEW.md'] })
  if (chgHighGood.length === 0) ok('N-SC17 ✓ 负向对拍：高风险 + 独立评审 + 评审记录 ⇒ 放行')
  else bad(`N-SC17 高风险带独立评审仍被阻塞：${chgHighGood.map((p) => p.rule).join('/')}`)
  const chgBadTier = mod.planProblems({ ...chgBase, risk_tier: 'urgent' })
  if (chgBadTier.some((p) => p.rule === 'C-15' && p.why.includes('封闭集'))) ok('SC-17 ✓ 风险等级不在封闭集 ⇒ C-15 红')
  else bad('SC-17 任意风险等级都被接受')
  const cmdEvidence = { id: 'EVD-SC17', kind: 'evidence', evidence_kind: 'command', reading: '42 tests pass' }
  const cmdBad = mod.evidenceProblems(cmdEvidence)
  if (cmdBad.some((p) => p.rule === 'C-16' && p.why.includes('command'))) ok('SC-17 ✓ 命令类证据缺 command ⇒ C-16 红（无法复跑）')
  else bad('SC-17 命令类证据没有命令也通过')
  const cmdGood = mod.evidenceProblems({ ...cmdEvidence, command: 'npm run check:all', exit_code: '0' })
  if (cmdGood.length === 0) ok('N-SC17 ✓ 负向对拍：命令 + 退出码齐全 ⇒ 放行')
  else bad(`N-SC17 命令证据齐全仍被阻塞：${cmdGood.map((p) => p.rule).join('/')}`)
  const badCode = mod.evidenceProblems({ ...cmdEvidence, command: 'x', exit_code: 'passed' })
  if (badCode.some((p) => p.rule === 'C-16' && p.why.includes('整数'))) ok('SC-17 ✓ exit_code 不是整数 ⇒ C-16 红')
  else bad('SC-17 exit_code 写"passed" 也被接受')
}

/**
 * ══ SC-21 ~ SC-23：**账本先建后推进**（2026-11-08 · 用户裁定）════════════════
 *
 *   用户原话：
 *     「没有账本的项目必须先建立账本才能推进任务」
 *     「不管是旧的还是空的 hob 会话在工作之前必须把账本建立梳理健康才能推进任务」
 *     「需要 hob 预设本身具备这个能力」
 *
 *   ⚠ 这三条钉的是**机制**，不是文档：账本不健康时**派活必须被拒**，
 *     而且这件事要有**预设自带的工具**能解（⛔ 不能只靠人照文档手做）。
 */
{
  const readinessMod = await import(pathToFileURL(join(root, 'src', 'shared', 'ledger-readiness.ts')).href)
  const toolsMod = await import(pathToFileURL(join(root, 'src', 'modules', 'tools.ts')).href)

  // ── SC-21：五档判定必须**互不冒充** ────────────────────────────────────
  {
    const p = []
    const cases = [
      ['missing', readinessMod.assessLedgerReadiness({ ledgerRoot: '/x', unitsDirExists: false })],
      ['legacy', readinessMod.assessLedgerReadiness({
        ledgerRoot: '/x', unitsDirExists: true,
        indexText: '[meta]\nschema = 1\n[units."CHG-1"]\nkind = "change"\n',
      })],
      ['empty', readinessMod.assessLedgerReadiness({ ledgerRoot: '/x', unitsDirExists: true, indexText: '# 空索引\n' })],
      ['unresolved', readinessMod.assessLedgerReadiness({ unitsDirExists: false })],
      ['unhealthy', readinessMod.assessLedgerReadiness({
        ledgerRoot: '/x', unitsDirExists: true,
        indexText: '[[unit]]\nid = "R-1"\nkind = "req"\nstatus = "agreed"\ntitle = "t"\n',
      })],
    ]
    for (const [want, got] of cases) {
      if (got.state !== want) p.push(`${want} 被判定成 ${got.state}`)
    }
    if (cases[3][1].canInitialize !== false) p.push('落点判不出时仍说"可以建"（会在错误位置建账）')
    if (cases[0][1].canInitialize !== true || cases[1][1].canInitialize !== true) p.push('未建账 / 旧格式却说不能建')
    if (cases[0][1].canProceed !== false || cases[1][1].canProceed !== false) p.push('未建账 / 旧格式仍说可以推进')
    if (p.length === 0) ok('SC-21 ✓ 就绪度五档互不冒充：missing / legacy / empty / unresolved / unhealthy 各自可辨，且只有"未建/旧格式"标可建')
    else for (const x of p) bad(`SC-21 · ${x}`)
  }

  // ── SC-22：账本不健康 ⇒ **派活被拒**（真跑门禁，⛔ 不 grep 源码）────────
  {
    const p = []
    const missingRoot = join(root, '.tmp-sc19-missing')
    const legacyRoot = join(root, '.tmp-sc19-legacy')
    mkdirSync(join(legacyRoot, 'ledger', 'units'), { recursive: true })
    writeFileSync(join(legacyRoot, 'ledger', 'units', 'index.toml'), '[meta]\nschema = 1\n[units."CHG-1"]\nkind = "change"\nstatus = "settled"\ntitle = "t"\nfile = "ledger/units/CHG-1.md"\n')
    mkdirSync(join(missingRoot, 'ledger', 'units'), { recursive: true })
    // ⚠ missing 用"建了空目录但无 index.toml" ⇒ 走 empty 之前的 index-missing 档
    for (const [label, r] of [['未建账', missingRoot], ['旧格式', legacyRoot]]) {
      const gate = toolsMod.dispatchGateAtLedger(r, {})
      if (gate.blocked === undefined) p.push(`${label}仍然被放行（这正是用户报的"说个东西就直接派活"）`)
    }
    const realGate = toolsMod.dispatchGateAtLedger(join(ledgerRoot, '..'), {})
    if (realGate.blocked !== undefined) p.push(`真实账本被误拦：${realGate.blocked}`)
    cleanup(join(root, '.tmp-sc19-missing'))
    cleanup(join(root, '.tmp-sc19-legacy'))
    if (p.length === 0) ok('SC-22 ✓ 账本不健康（未建 / 旧格式）⇒ 派活被拒；真实健康账本照常放行')
    else for (const x of p) bad(`SC-22 · ${x}`)
  }

  // ── SC-23：不存在的任务号 ⇒ **hold**（改前是 go，真缺陷）─────────────────
  {
    const p = []
    const realRoot = join(ledgerRoot, '..')
    const ghost = toolsMod.dispatchGateAtLedger(realRoot, { taskId: '随便一句话' })
    if (ghost.blocked === undefined) p.push('拿一句自由文本当 task 仍被放行 ⇒ 门禁形同不存在')
    const notExist = toolsMod.dispatchGateAtLedger(realRoot, { taskId: 'TSK-NOT-EXIST' })
    if (notExist.blocked === undefined) p.push('不存在的 TSK 编号仍被放行')
    /**
     * ⚠ **反向对拍**：`implicit` 是编排器自己写的占位号，⛔ 必须放行 ——
     *   否则所有"没写 task 的老计划"会一起被判死（改这条时就当场踩到过）。
     */
    const implicit = toolsMod.dispatchGateAtLedger(realRoot, { taskId: 'implicit' })
    if (implicit.blocked !== undefined) p.push(`占位号 implicit 被误拦：${implicit.blocked}`)
    /**
     * V2 is a clean cut: legacy tasks stay readable but are not dispatchable.
     * The assertion therefore requires an explicit v2 refusal, not a free pass.
     */
    const legacyTask = toolsMod.dispatchGateAtLedger(realRoot, { taskId: 'TSK-076' })
    if (legacyTask.blocked === undefined || !String(legacyTask.blocked).includes('旧管线条目只读')) {
      p.push(`旧管线条目 TSK-076 没有被 v2 明确拒绝：${legacyTask.blocked}`)
    }
    if (p.length === 0) ok('SC-23 ✓ 不存在的任务号 ⇒ hold；implicit 不比真实任务更宽；旧任务只读且 v2 派发被拒')
    else for (const x of p) bad(`SC-23 · ${x}`)
  }
}

/**
 * ══ SC-24 ~ SC-27：**账本闭环 + 派活只落在任务上**（2026-11-08 用户报障）══════
 *
 *   用户原话：「没有账单的或者旧账单梳理不到完全健康，并且新的任务没有走阶段流程」。
 *
 *   ⚠ 三条实测缺陷（改前）：
 *     ① 一本账只有一条 `change` ⇒ `stageControlProblems = []` ⇒ **判成"完全健康"**
 *        （`prompt-enhancer-release` 就是这样：只有 `CHG-344`，没有需求、没有任务）
 *     ② `R-020` / `CHG-…` / `RUN-056` / `ACC-066` **都能当任务号派活并放行**
 *     ③ 任务 → 方案 → 需求，作用域**只爬到方案一层**，需求层的缺口不检查
 */
{
  const toolsMod = await import(pathToFileURL(join(root, 'src', 'modules', 'tools.ts')).href)
  const readinessMod = await import(pathToFileURL(join(root, 'src', 'shared', 'ledger-readiness.ts')).href)

  // ── SC-24：孤立的 change（没有需求托底）⇒ 不健康 ─────────────────────
  {
    const p = []
    const onlyChange = { id: 'CHG-ONLY', kind: 'change', status: 'settled', path_options: ['a'], path_tradeoffs: ['b'], path_decision: 'c', requirement_coverage: ['R-NOT-EXIST'] }
    const closure = mod.ledgerClosureProblems([onlyChange])
    if (!closure.some((x) => x.rule === 'L-1' && x.unit === 'CHG-ONLY')) p.push('方案指向不存在的需求 ⇒ 没有报 L-1')
    const bad = readinessMod.assessLedgerReadiness({
      ledgerRoot: '/x', unitsDirExists: true,
      indexText: '[[unit]]\nid = "CHG-ONLY"\nkind = "change"\nstatus = "settled"\ntitle = "t"\npath_options = ["a"]\npath_tradeoffs = ["b"]\npath_decision = "c"\nrequirement_coverage = ["R-NOT-EXIST"]\n',
    })
    if (bad.state === 'ready') p.push('只有一条孤立方案也判成 ready（这正是"旧账本梳理不到完全健康"）')
    if (bad.canProceed === true) p.push('只有一条孤立方案也说可以推进')
    /** ⚠ 反向对拍：补上真实需求后必须变回 ready（⛔ 不是恒红）。 */
    const good = readinessMod.assessLedgerReadiness({
      ledgerRoot: '/x', unitsDirExists: true,
      indexText: '[[unit]]\nid = "R-1"\nkind = "req"\nstatus = "agreed"\ntitle = "t"\nclarify_examples = ["例子"]\nacceptance_criteria = ["点保存后出现提示"]\n'
        + '[[unit]]\nid = "CHG-1"\nkind = "change"\nstatus = "settled"\ntitle = "t"\nparent = "R-1"\nreq_ids = ["R-1"]\npath_options = ["a"]\npath_tradeoffs = ["b"]\npath_decision = "c"\nrequirement_coverage = ["R-1 → 某处"]\n',
    })
    if (good.state !== 'ready') p.push(`补齐需求托底后仍不是 ready：${good.state}（${good.headline}）`)
    if (p.length === 0) ok('SC-24 ✓ 孤立方案（需求托底不存在）⇒ L-1 缺口、判不健康；补上真实需求后恢复 ready')
    else for (const x of p) bad(`SC-24 · ${x}`)
  }

  // ── SC-25：派活只能落在 task 上（需求号 / 方案号 / 执行号 / 验收号都不行）──
  {
    const p = []
    const realRoot = join(ledgerRoot, '..')
    for (const [id, want] of [['R-020', 'req'], ['CHG-2026-11-07-progress-multiproject', 'change'], ['RUN-056', 'run'], ['ACC-066', 'acc']]) {
      const r = toolsMod.dispatchGateAtLedger(realRoot, { taskId: id })
      if (r.blocked === undefined) p.push(`拿 ${want} 号 ${id} 派活仍被放行（这就是"新任务没走阶段流程"）`)
      else if (!String(r.blocked).includes('不是 task')) p.push(`${id} 被拒了，但没说清"不是任务"：${String(r.blocked).slice(0, 60)}`)
    }
    const legacyTask = toolsMod.dispatchGateAtLedger(realRoot, { taskId: 'TSK-080' })
    if (legacyTask.blocked === undefined || !String(legacyTask.blocked).includes('旧管线条目只读')) {
      p.push(`旧任务 TSK-080 没有被 v2 明确拒绝：${legacyTask.blocked}`)
    }
    if (p.length === 0) ok('SC-25 ✓ 派活只认 task；需求 / 方案 / 执行 / 验收号全拒；旧任务只读且不能进入 v2 派发')
    else for (const x of p) bad(`SC-25 · ${x}`)
  }

  // ── SC-26：作用域必须爬到需求层（否则需求缺口被漏检）────────────────────
  {
    const p = []
    const chain = [
      { id: 'R-C', kind: 'req', status: 'agreed' },                      // ⚠ 缺例子 / 缺验收条件
      { id: 'CHG-C', kind: 'change', status: 'settled', parent: 'R-C', req_ids: ['R-C'], path_options: ['a'], path_tradeoffs: ['b'], path_decision: 'c', requirement_coverage: ['R-C → x'] },
      { id: 'TSK-C', kind: 'task', status: 'todo', parent: 'CHG-C', task_brief: 'x/TASK.md', counterexamples: ['e'], stop_conditions: ['s'], return_to: 'back-to-requirement' },
    ]
    const scope = mod.gateScopeUnits(chain, { kind: 'task', id: 'TSK-C' }).map((u) => u.id)
    if (!scope.includes('R-C')) p.push(`作用域没有爬到需求层：${JSON.stringify(scope)}（需求缺口会被漏检）`)
    const gate = mod.evaluateGate({ action: 'dispatch', scope: { kind: 'task', id: 'TSK-C' }, units: chain })
    if (gate.decision !== 'return') p.push(`需求缺例子/验收条件，任务却仍 ${gate.decision}`)
    if (!gate.blockers.some((x) => x.unit === 'R-C')) p.push('缺口没有指到需求 R-C（回流到最早失效阶段失效）')
    if (p.length === 0) ok('SC-26 ✓ 作用域沿 parent 爬到需求层：需求缺例子/验收条件 ⇒ 任务被回流，且缺口指到 R-C')
    else for (const x of p) bad(`SC-26 · ${x}`)
  }

  // ── SC-27：孤立任务（父方案不存在）⇒ 不放行 ────────────────────────────
  {
    const p = []
    const orphan = { id: 'TSK-ORPHAN', kind: 'task', status: 'todo', parent: 'CHG-MISSING', task_brief: 'x/T.md', counterexamples: ['e'], stop_conditions: ['s'], return_to: 'back-to-plan' }
    const closure = mod.ledgerClosureProblems([orphan])
    if (!closure.some((x) => x.rule === 'L-2')) p.push('任务父方案不存在 ⇒ 没有报 L-2')
    const gate = mod.evaluateGate({ action: 'dispatch', scope: { kind: 'task', id: 'TSK-ORPHAN' }, units: [orphan] })
    if (gate.decision === 'go') p.push('孤立任务（父方案不存在）仍被放行')
    if (p.length === 0) ok('SC-27 ✓ 孤立任务（父方案在账本里不存在）⇒ L-2 缺口且不放行')
    else for (const x of p) bad(`SC-27 · ${x}`)
  }

  // ── SC-28：技术验证独立性与 strict 收口证据 ────────────────────────────
  {
    const p = []
    const units = [
      { id: 'TSK-V', kind: 'task', status: 'built', parent: 'CHG-V', built_by: 'session-builder', task_brief: 'x/T.md', counterexamples: ['e'], stop_conditions: ['s'], return_to: 'back-to-plan' },
    ]
    const baseVer = {
      id: 'VER-SC', kind: 'verification', status: 'pass', parent: 'TSK-V', verifier: 'session-verifier',
      verification_session: 'session-verifier', verified_at: '2026-11-08T00:00:00Z',
      basis: ['EVD-1'], evidence_refs: ['EVD-1'], criteria_refs: ['AC-1'],
    }
    const good = mod.verificationProblems(baseVer, units)
    const self = mod.verificationProblems({ ...baseVer, verifier: 'session-builder', verification_session: 'session-builder' }, units)
    if (good.length !== 0) p.push(`合法技术验证被拒：${JSON.stringify(good)}`)
    if (!self.some((x) => x.rule === 'C-25' && x.why.includes('实现者'))) p.push('技术验证者等于实现者却未红')
    const closure = {
      id: 'CLS-SC', kind: 'closure', status: 'closed', parent: 'R-V', closure_mode: 'strict',
      basis: ['EVD-1'], release_refs: ['build EVD-2', 'smoke ok', 'post-release check ok'], rollback_refs: ['EVD-3'], monitoring_refs: ['EVD-4'], accepted_by: 'user',
      chain_acceptance_ref: 'ACC-1', risk_assessment_ref: 'RSK-ASSESS-1', residual_risk_decision_ref: 'DEC-RISK-1',
      approval_ref: 'DEC-RELEASE-1',
    }
    /**
     * ⚠⚠ **S-05：三个绑定引用必须有真实目标单元。**
     *   改前这里只有 `{ ...closure }` 与 `{ id: 'R-V', kind: 'req' }` ——
     *   `ACC-1` / `RSK-ASSESS-1` / `DEC-RISK-1` **一个都不在**，
     *   而当时 C-29 只查非空 ⇒ 照样通过 ⇒ **这条断言从未真正验过引用**。
     *   ⇒ 现在补上三个真实单元；缺它们 SC-28 会当场红（已实测）。
     */
    const closureTargets = [
      { ...closure },
      { id: 'R-V', kind: 'req' },
      { id: 'ACC-1', kind: 'acc', status: 'pass' },
      { id: 'RSK-ASSESS-1', kind: 'risk', status: 'open' },
      { id: 'DEC-RISK-1', kind: 'decision', status: 'active' },
    ]
    const goodClosure = mod.closureProblems(closure, closureTargets)
    const noRollback = mod.closureProblems({ ...closure, rollback_refs: [] }, closureTargets)
    const standard = { ...closure, closure_mode: 'standard', monitoring_refs: [], approval_ref: '',
      release_refs: ['build ok', 'smoke ok', 'post-release check ok'] }
    const standardTargets = [{ ...standard }, ...closureTargets.slice(1)]
    const goodStandard = mod.closureProblems(standard, standardTargets)
    const noSmoke = mod.closureProblems({ ...standard, release_refs: ['build ok'] }, standardTargets)
    if (goodClosure.length !== 0) p.push(`合法 strict 收口被拒：${JSON.stringify(goodClosure)}`)
    if (goodStandard.length !== 0) p.push(`合法 standard 收口被拒：${JSON.stringify(goodStandard)}`)
    if (!noSmoke.some((x) => x.rule === 'C-27' && x.why.includes('冒烟'))) p.push('standard 缺冒烟证据未红')
    if (!noRollback.some((x) => x.rule === 'C-28' && x.why.includes('回滚'))) p.push('strict 收口缺回滚证据却未红')
    const noApproval = mod.closureProblems({ ...closure, approval_ref: '' }, closureTargets)
    if (!noApproval.some((x) => x.why.includes('发布审批'))) p.push('strict 收口缺独立发布审批未红')
    if (p.length === 0) ok('SC-28 ✓ 负向对拍：技术验证者不能是实现者；standard / strict 缺构建、冒烟、回滚、监控或发布审批不得通过')
    else for (const x of p) bad(`SC-28 · ${x}`)
  }

  // ── SC-29：任务级执行风险与并行写范围 ────────────────────────────────
  {
    const p = []
    const risk = await import(pathToFileURL(join(root, 'src', 'shared', 'risk-policy.ts')).href)
    const base = { id: 'TSK-RISK', kind: 'task', status: 'todo', title: '风险任务', parent: 'CHG-RISK',
      pipeline_version: 'v3', revision: '1',
      task_brief: 'archive/x/TASK.md', counterexamples: ['c'], stop_conditions: ['s'], return_to: 'back-to-plan' }
    const missing = mod.taskProblems(base)
    const high = mod.taskFullProblems({ ...base, task_risk: 'high', risk_reasons: ['跨权限边界'], touched_surfaces: ['src/auth'],
      requires_isolation: 'false', requires_serial_execution: 'false', reviewer: 'reviewer-A', review_refs: [] })
    const good = mod.taskFullProblems({ ...base, task_risk: 'high', risk_reasons: ['跨权限边界'], touched_surfaces: ['src/auth'],
      requires_isolation: 'true', requires_review: 'true', requires_serial_execution: 'true',
      reviewer: 'reviewer-A', review_refs: ['archive/review.md'], irreversible_actions: [], rollback_refs: [] })
    if (missing.some((x) => x.rule === 'RP-4')) p.push('缺 task_risk 没有触发 RP-4')
    if (high.length === 0) p.push('high 任务缺隔离 / 串行 / 独立复核却放行')
    if (good.length !== 0) p.push(`任务控制齐全仍被拒：${JSON.stringify(good)}`)
    const overlapping = [
      { ...base, id: 'TSK-A', scope_paths: ['src/auth'] },
      { ...base, id: 'TSK-B', scope_paths: ['src/auth/session.ts'] },
    ]
    const graph = mod.taskGraphRiskProblems(overlapping)
    if (!graph.some((x) => x.rule === 'RP-5')) p.push('同路径并行任务没有报 RP-5')
    const serial = mod.taskGraphRiskProblems([
      { ...overlapping[0], depends_on: ['TSK-B'] },
      overlapping[1],
    ])
    if (serial.some((x) => x.rule === 'RP-5')) p.push('已声明串行的同路径任务仍被报冲突')
    if (p.length === 0) ok('SC-29 ✓ 负向对拍：任务缺 risk / high 缺独立复核证据 ⇒ 红；同路径未串行 ⇒ RP-5；串行后放行')
    else for (const x of p) bad(`SC-29 · ${x}`)
    void risk
  }

  // ── SC-30：任务作用域必须带上批准事实，且风险摘要按全链重算 ─────────────
  {
    const p = []
    const pipeline = await import(pathToFileURL(join(root, 'src', 'shared', 'pipeline.ts')).href)
    const riskPolicy = await import(pathToFileURL(join(root, 'src', 'shared', 'risk-policy.ts')).href)
    const at = '2026-11-10T00:00:00Z'
    const req = {
      id: 'R-SC30', kind: 'req', status: 'agreed', title: '保存后显示成功提示', pipeline_version: 'v3', revision: '1',
      clarify_examples: ['点击保存出现成功提示'], acceptance_criteria: ['点击保存出现成功提示'],
      clarify_questions: [], clarify_assumptions: ['confirmed: 复用现有提示组件'],
    }
    const plan = {
      id: 'CHG-SC30', kind: 'change', status: 'settled', title: '复用现有提示组件', pipeline_version: 'v3', revision: '1',
      parent: 'R-SC30', req_ids: ['R-SC30'], addresses: ['R-SC30'], proposal: '复用现有提示组件',
      path_options: ['A'], path_tradeoffs: ['A 改动最小'], path_decision: '选 A', requirement_coverage: ['R-SC30 → 提示组件'],
      risk_tier: 'low', risk_rule_version: 'v1', risk_hard_triggers: [],
      risk_dimensions: ['scope=local', 'severity=minor', 'reversibility=easy', 'detectability=automatic', 'uncertainty=known', 'changeSurface=few-files', 'dependencies=internal-deps', 'verificationMaturity=proven', 'recoveryTime=minutes', 'exposure=internal'],
      risk_assessed_at: at, risk_assessed_by: 'Hob', delivery_scope: 'none', risk_assessment_ref: 'CHG-SC30#1', risk_binding_version: 'v1',
    }
    plan.risk_inputs_digest = riskPolicy.riskAssessmentOf(riskPolicy.riskFactsOf(plan)).inputsDigest
    plan.risk_binding_digest = pipeline.riskBindingDigestOf(plan, [req])
    const task = {
      id: 'TSK-SC30', kind: 'task', status: 'todo', title: '实现保存成功提示', pipeline_version: 'v3', revision: '1',
      parent: 'CHG-SC30', task_brief: 'archive/x/TASK.md', counterexamples: ['重复点击不叠加'], stop_conditions: ['现有组件无法承载时停手'],
      return_to: 'back-to-plan', task_risk: 'low', risk_reasons: [], requires_isolation: 'false', requires_review: 'false',
      requires_serial_execution: 'false', touched_surfaces: [], irreversible_actions: [],
    }
    const decision = (artifact, extra = {}) => ({
      id: `DEC-${artifact.id}`, kind: 'decision', status: 'active', title: `用户批准 ${artifact.id}`,
      decision_kind: 'stage-approval', approval_stage: artifact.kind === 'req' ? 'requirements' : 'plan',
      artifact_id: artifact.id, artifact_revision: '1', artifact_digest: pipeline.artifactDigestOf(artifact),
      decision: 'approve', selected_option: artifact.kind === 'change' ? 'A' : '', decided_by: 'user', decided_at: at,
      source: `确认${artifact.kind === 'req' ? '需求' : '方案'} ${artifact.id} 第 1 版`, ...extra,
    })
    const rDec = decision(req)
    const pDec = decision(plan)
    const full = [req, plan, task, rDec, pDec]
    const scope = mod.gateScopeUnits(full, { kind: 'task', id: 'TSK-SC30' }).map((u) => u.id)
    if (!scope.includes(rDec.id) || !scope.includes(pDec.id)) p.push(`任务作用域漏掉批准单元：${JSON.stringify(scope)}`)
    if (scope.some((id) => id === 'DEC-UNRELATED')) p.push('任务作用域带入了无关批准')
    const good = mod.evaluateGate({ action: 'dispatch', scope: { kind: 'task', id: 'TSK-SC30' }, units: full })
    if (good.decision !== 'go') p.push(`完整 v3 链仍被拒：${good.blockers.map((x) => `${x.rule}·${x.unit}·${x.why}`).join('；')}`)
    const noReqApproval = mod.evaluateGate({
      action: 'dispatch', scope: { kind: 'task', id: 'TSK-SC30' }, units: [req, plan, task, pDec],
    })
    if (!noReqApproval.blockers.some((x) => x.rule === 'C-18' && x.unit === 'R-SC30')) p.push('缺需求批准仍被放行')
    const noPlanApproval = mod.evaluateGate({
      action: 'dispatch', scope: { kind: 'task', id: 'TSK-SC30' }, units: [req, plan, task, rDec],
    })
    if (!noPlanApproval.blockers.some((x) => x.rule === 'C-19' && x.unit === 'CHG-SC30')) p.push('缺方案批准仍被放行')
    const changedReq = { ...req, acceptance_criteria: ['点击保存后成功提示必须保留 3 秒'] }
    const stale = mod.evaluateGate({
      action: 'dispatch', scope: { kind: 'task', id: 'TSK-SC30' }, units: [changedReq, plan, task, rDec, pDec],
    })
    if (!stale.blockers.some((x) => x.unit === 'R-SC30')) p.push('批准后改需求内容仍被放行')
    if (!stale.blockers.some((x) => x.rule === 'RP-3' && x.unit === 'CHG-SC30')) p.push('验收对象变化后旧风险评定仍被当成有效')
    if (p.length === 0) {
      ok('SC-30 ✓ 任务作用域带入 R/CHG 的批准事实；完整 v3 链放行；缺任一批准 / 批准后改需求内容 ⇒ 仍被拦')
    } else for (const x of p) bad(`SC-30 · ${x}`)
  }
}

// ── SC-31：S-04 —— 作用域根不存在必须 hold，⛔ 不是 go ──────────────────────
//
//  ⚠ 这条钉的是 **fail-open 的纯函数**：
//    `evaluateGate` 对"账本里没有这个 id"的作用域，改前走的是
//    「gateScopeUnits 找不到 root ⇒ 空集 ⇒ stageControlProblems([]) = [] ⇒ blockers=[] ⇒ go」。
//    ⚠ 当时**已被调用方补掉**（`tools.ts` 先做存在性核对），所以不构成可利用漏洞；
//      但任何**新调用方**会直接踩中，而且踩中时看到的是「通过」，不会去怀疑参数写错。
{
  const p = []
  const sc = mod

  /** ① 不存在的 id ⇒ 必须 hold（改前是 go）。 */
  const ghost = sc.evaluateGate({ action: 'dispatch', scope: { kind: 'task', id: 'TSK-NOT-EXIST' }, units: [] })
  if (ghost.decision !== 'hold') p.push('不存在的作用域根 ⇒ 判成 ' + ghost.decision + '（应为 hold）')
  if (!ghost.blockers.some((b) => b.rule === 'S-04')) p.push('hold 时没有点名 S-04 规则')

  /** ② ⚠ 占位号 implicit 必须**豁免** —— 它是编排器的占位，不是真实 TSK。 */
  const implicit = sc.evaluateGate({ action: 'dispatch', scope: { kind: 'task', id: 'implicit' }, units: [] })
  if (implicit.decision === 'hold' && implicit.blockers.some((b) => b.rule === 'S-04')) {
    p.push('占位号 implicit 被 S-04 拦下 ⇒ 会把所有"没写 task 的老计划"一起判死（真机踩过）')
  }

  /** ③ 反向对照：根**存在**时不许被 S-04 误拦（证明不是恒 hold）。 */
  const real = { id: 'TSK-SC31', kind: 'task', status: 'todo', pipeline_version: 'v3', revision: '1' }
  const hit = sc.evaluateGate({ action: 'dispatch', scope: { kind: 'task', id: 'TSK-SC31' }, units: [real] })
  if (hit.blockers.some((b) => b.rule === 'S-04')) p.push('真实存在的根被 S-04 误拦 ⇒ 判据恒 hold')

  if (p.length === 0) {
    ok('SC-31 ✓ **负向对拍**：作用域根不存在 ⇒ hold（S-04 点名）；占位号 implicit 豁免；真实根不误拦'
      + '（S-04：fail-open 的纯函数不再对新调用方静默放行）')
  } else for (const x of p) bad('SC-31 · ' + x)
}

// ── SC-32：S-05 —— C-29 的三个绑定引用必须**解析到真实单元** ──────────────
//
//  ⚠ 这条钉的是「填一个 id 不等于绑定了事实」：
//    改前 C-29 只判 `txt(ref) === ''` ⇒ 填 `ACC-NOT-EXIST` 也能通过
//    ⇒ 上面那条注释「G6 may not silently rewrite G5」退化成「三个字符串非空」。
//  ⚠ 与 `convergence.ts` 的 K-2/K-3/K-5（悬空引用即红）口径不一致 —— 本条把两边拉齐。
{
  const p = []
  const closure = {
    id: 'CLS-SC32', kind: 'closure', status: 'closed', parent: 'R-SC32', closure_mode: 'standard',
    basis: ['EVD-1'], release_refs: ['build ok', 'smoke ok', 'post-release check ok'],
    chain_acceptance_ref: 'ACC-SC32', risk_assessment_ref: 'RSK-SC32', residual_risk_decision_ref: 'DEC-SC32',
  }
  const targets = [
    { id: 'R-SC32', kind: 'req' },
    { id: 'ACC-SC32', kind: 'acc', status: 'pass' },
    { id: 'RSK-SC32', kind: 'risk', status: 'open' },
    { id: 'DEC-SC32', kind: 'decision', status: 'active' },
  ]
  /** ① 三个引用都指向真实且 kind 正确的单元 ⇒ 不许报 C-29。 */
  const okAll = mod.closureProblems(closure, [...targets, { ...closure }])
  if (okAll.some((x) => x.rule === 'C-29')) {
    p.push('引用全部合法却仍报 C-29：' + JSON.stringify(okAll.filter((x) => x.rule === 'C-29')))
  }
  /** ② 悬空引用 ⇒ 必须红（改前是绿的）。 */
  for (const [field, ghost] of [
    ['chain_acceptance_ref', 'ACC-NOT-EXIST'],
    ['risk_assessment_ref', 'RSK-NOT-EXIST'],
    ['residual_risk_decision_ref', 'DEC-NOT-EXIST'],
  ]) {
    const r = mod.closureProblems({ ...closure, [field]: ghost }, [...targets, { ...closure }])
    if (!r.some((x) => x.rule === 'C-29' && x.why.includes('不存在'))) {
      p.push(field + ' 指向不存在的 ' + ghost + ' 却未红 ⇒ 填个 id 就能过 C-29')
    }
  }
  /** ③ kind 不对 ⇒ 也必须红（指向一个 task 证明不了 G5 已接受）。 */
  const wrongKind = mod.closureProblems(closure, [
    ...targets.filter((x) => x.id !== 'ACC-SC32'),
    { id: 'ACC-SC32', kind: 'task' },
    { ...closure },
  ])
  if (!wrongKind.some((x) => x.rule === 'C-29' && x.why.includes('kind'))) {
    p.push('chain_acceptance_ref 指向 task 却未红 ⇒ 只查存在、不查 kind')
  }
  if (p.length === 0) {
    ok('SC-32 ✓ **负向对拍**：C-29 三个绑定引用悬空 ⇒ 红；kind 不对 ⇒ 红；全部合法 ⇒ 不误报'
      + '（S-05：填一个 id 不等于绑定了事实）')
  } else for (const x of p) bad('SC-32 · ' + x)
}

// ── SC-33：O-01 —— `write-repair` 不过门禁，但必须**显式说出来** ─────────────
//
//  ⚠ 改前它直接 `return { decision: 'go', blockers: [] }` —— **不计算任何问题**就报「可以」。
//    调用方看到 `go` 会以为「过了门禁」，而实际是「**根本没判**」。
//  ⇒ 行为保持放行（修复写必须能在账本不健康时进行），但返回里带 `bypass: 'repair'`。
{
  const p = []
  const r = mod.evaluateGate({ action: 'write-repair', scope: { kind: 'task', id: 'TSK-NOPE' }, units: [] })
  /** ① 仍必须放行（⛔ 改成 hold 会把修复通道一起堵死）。 */
  if (r.decision !== 'go') p.push(`write-repair 判成 ${r.decision} ⇒ 修复通道被堵死`)
  /** ② 但必须带显式标记，让「未判」可见。 */
  if (r.bypass !== 'repair') p.push('write-repair 没有带 `bypass: \'repair\'` ⇒ 「没判」与「判过」在返回值上长得一样')
  /** ③ 反向：其它动作**不许**带这个标记（⛔ 不是所有 go 都算未判）。 */
  const real = { id: 'TSK-SC33', kind: 'task', status: 'todo', pipeline_version: 'v3', revision: '1' }
  const normal = mod.evaluateGate({ action: 'dispatch', scope: { kind: 'task', id: 'TSK-SC33' }, units: [real] })
  if (normal.bypass !== undefined) p.push('普通 dispatch 也带了 bypass 标记 ⇒ 标记失去区分力')
  if (p.length === 0) {
    ok('SC-33 ✓ **负向对拍**：`write-repair` 放行但带 `bypass:\'repair\'`（「未判」可见）；'
      + '普通 dispatch 不带（⛔ 标记不是所有 go 都有）—— O-01')
  } else for (const x of p) bad(`SC-33 · ${x}`)
}
// ══════════════════════════════════════════════════════════════════════
// SC-35 · R-17：`gateProblemsAt('tasks')` 与 `stageFieldProblems` 必须**同一判据**
// ══════════════════════════════════════════════════════════════════════
/**
 * ⚠⚠ 守什么：同一份账本，走两条路**不能得到不同结论**。
 *
 *   改前：`gateProblemsAt('tasks')` 用 `taskProblems`（弱），
 *        而 `stageFieldProblems`（`:1064`）用 `taskFullProblems`（含风险）。
 *   ⇒ 一条带「风险未评定」的任务：
 *      · 走 `stageFieldProblems` ⇒ **红**；
 *      · 走 `gateProblemsAt('tasks')` ⇒ **绿**。
 *
 * ⚠ 判据：造一条 `taskRiskProblems` 会命中的任务，两处**都必须**报出它。
 *   ⚠ 反证：造一条两处都该放行的任务 ⇒ 两处都**空**（⛔ 防「恒红也算过」）。
 */
{
  /** ① 造一条「任务本体齐全、但风险未评定」的任务 —— 只有 `taskFullProblems` 会抓。 */
  /** ⚠ 任务本体**必须齐全**（C-5 那四项），否则夹具本身就是红的、测不到风险那一条。 */
  const taskOk = {
    id: 'TSK-SC35', kind: 'task', status: 'todo', pipeline_version: 'v3', revision: '1',
    task_brief: 'archive/x/TASK.md', counterexamples: ['空输入不崩溃'],
    stop_conditions: ['与方案冲突即停'], return_to: 'back-to-plan',
  }
  /** ⚠ 刻意给高风险档但**不填**风险评定字段 ⇒ `taskRiskProblems` 必命中。 */
  const risky = { ...taskOk, risk_tier: 'high' }
  const gateP = mod.gateProblemsAt('tasks', [risky])
  const fieldP = mod.stageFieldProblems([risky])
  const p = []
  const gateHasRisk = gateP.some((x) => String(x.rule).startsWith('RP-') || /风险/.test(String(x.why)))
  const fieldHasRisk = fieldP.some((x) => String(x.rule).startsWith('RP-') || /风险/.test(String(x.why)))
  if (!fieldHasRisk) p.push('夹具不成立：`stageFieldProblems` 都没报风险 ⇒ 这条断言测不到东西')
  else if (!gateHasRisk) {
    p.push('`gateProblemsAt(\'tasks\')` **没有**报出风险缺口 ⇒ 与 `stageFieldProblems` 结论不一致（R-17 复发）')
  }
  /** ② 反证：干净任务 ⇒ 两处都空。 */
  /** ⚠ 干净任务必须**带 `task_risk`** —— 否则 `taskFullProblems` 会报 RP-4（v3 任务缺 task_risk）。 */
  const clean = { ...taskOk, id: 'TSK-SC35b', task_risk: 'low' }
  const gateClean = mod.gateProblemsAt('tasks', [clean])
  const fieldClean = mod.stageFieldProblems([clean])
  if (gateClean.length !== 0) p.push(`干净任务在 gateProblemsAt 里仍有 ${gateClean.length} 条：${JSON.stringify(gateClean)} ⇒ 判据恒红，没有区分力`)
  if (fieldClean.length !== 0) p.push(`干净任务在 stageFieldProblems 里仍有 ${fieldClean.length} 条 ⇒ 夹具不干净`)
  if (p.length === 0) {
    ok('SC-35 ✓ `gateProblemsAt(\'tasks\')` 与 `stageFieldProblems` **同一判据**：风险缺口两处都报、干净任务两处都空（R-17：⛔ 不许一个弱一个强）')
  } else for (const x of p) bad(`SC-35 · ${x}`)
}
// ══════════════════════════════════════════════════════════════════════
// SC-36 · R-17（后半）：`STAGE_COMPLETION` 的 `judgedBy` 必须指向**真存在的**规则
// ══════════════════════════════════════════════════════════════════════
/**
 * ⚠⚠ 守什么：`STAGE_COMPLETION` 是本仓唯一一份「每阶段完成口径」的**自描述**，
 *   每个阶段写着 `judgedBy: 'R.status=agreed + C-1/C-2 + G1 stage-approval'`。
 *
 *   改前它**零调用**（REVIEW 的 R-17 前半）—— 一份没人读的自描述，
 *   写着什么都不重要，于是必然漂。
 *
 *   ⇒ 本轮**不删它**（那是把口径文档一起删掉），改成**让机检读它**：
 *     ① 每个 StageId 都必须有条目（⛔ 不许漏一个阶段）；
 *     ② `judgedBy` 里点到的每个 `C-NN` / `RP-N` 规则号，
 *        必须**真的**在该模块的产出里出现过（⛔ 不许写一个不存在的规则）。
 *   ⚠ 这样它从「零调用的文档」变成「**被判据钉住的口径表**」。
 */
{
  const p = []
  const STAGES = ['requirements', 'plan', 'tasks', 'execution', 'verification', 'acceptance', 'closure']
  const missing = STAGES.filter((s2) => mod.STAGE_COMPLETION[s2] === undefined)
  if (missing.length > 0) p.push(`STAGE_COMPLETION 缺阶段：${missing.join(', ')}`)
  /**
   * ② 收集本模块**实际会产出**的规则号（扫源码里的 `rule: 'X-NN'` 字面量）。
   *   ⚠ 用源码文本而不是运行时：有些规则只有特定夹具才触发。
   */
  const { readFileSync: rf } = await import('node:fs')
  const { join: pj } = await import('node:path')
  const { fileURLToPath: f2u } = await import('node:url')
  const here2 = pj(f2u(import.meta.url), '..')
  const srcText = rf(pj(here2, '..', 'src', 'shared', 'stage-controls.ts'), 'utf8')
  const realRules = new Set()
  for (const m of srcText.matchAll(/rule: '([A-Z]+-\d+)'/g)) realRules.add(m[1])
  for (const m of srcText.matchAll(/'(C-\d+)'/g)) realRules.add(m[1])
  /** ⚠ 也收其它模块里出现过的（有些规则在 pipeline-view / convergence 里判）。 */
  const extraText = rf(pj(here2, '..', 'src', 'shared', 'pipeline-view.ts'), 'utf8')
  for (const m of extraText.matchAll(/rule: '([A-Z]+-\d+)'/g)) realRules.add(m[1])
  if (realRules.size === 0) p.push('扫不到任何规则号 ⇒ 本条失去基准（⛔ 不按通过处理）')
  else {
    let checked = 0
    for (const st of STAGES) {
      const jb = mod.STAGE_COMPLETION[st]?.judgedBy
      if (typeof jb !== 'string') continue
      for (const m of jb.matchAll(/\b([A-Z]+-\d+)\b/g)) {
        checked += 1
        if (!realRules.has(m[1])) {
          p.push(`${st}.judgedBy 点到的规则 \`${m[1]}\` **在代码里不存在** ⇒ 自描述已经漂了`)
        }
      }
    }
    if (checked === 0) p.push('`judgedBy` 里一个规则号都没点到 ⇒ 自描述没有可核内容')
    if (p.length === 0) {
      ok(`SC-36 ✓ \`STAGE_COMPLETION\` 七个阶段齐全，且 \`judgedBy\` 点到的 **${checked}** 个规则号**全部真实存在**（R-17：⛔ 不许写一个不存在的规则）`)
    } else for (const x of p) bad(`SC-36 · ${x}`)
  }
}

// ── SC-37 · R-13：当前方案必须按「业务状态 + revision」选，⛔ 不按物理顺序 ──────
/**
 * ── 它守什么 ────────────────────────────────────────────────────────
 *   改前两处各写一套取法：
 *     · `closureProblems`：`plans.at(-1)` ⇒ 结论随**文件里的位置**翻转
 *     · `currentPlanOf`：先过滤 superseded 再 `at(-1)` ⇒ 同样依赖物理顺序
 *   ⇒ 同一份账本，两种物理顺序 ⇒ G6 档位可能不同（**fail-open**）。
 *   而迁移会移动单元位置 ⇒ **迁移前后结论翻转**。
 *
 * ── 判据（REVIEW R-13 规格 ③④⑤）──────────────────────────────────
 *   ③ 同一份账本**两种物理顺序** ⇒ `currentPlanOfStrict` 结论必须相同；
 *   ④ 负向对拍：取法改回「按位置」⇒ ③ 必须红；
 *   ⑤ 负向对拍：`status` 判据改回「不是 superseded」⇒ 用 `draft` 夹具必须红。
 */
{
  const pipe = await import(pathToFileURL(join(root, 'src', 'shared', 'pipeline.ts')).href)
  const p = []
  /** 三个方案：A 已定第 3 版、B 已定第 1 版、C 草稿。⚠ id 故意不按字典序。 */
  const mk = (id, status, revision, createdAt) => ({
    id, kind: 'change', req_ids: ['R-1'], status, revision: String(revision), created_at: createdAt,
  })
  const A = mk('CHG-z', 'agreed', 3, '2026-01-03')
  const B = mk('CHG-a', 'agreed', 1, '2026-01-01')
  const C = mk('CHG-m', 'draft', 9, '2026-01-09')
  /** ③ 物理顺序翻转 ⇒ 结论必须相同 */
  const order1 = [A, B, C]
  const order2 = [C, B, A]
  const pick1 = pipe.currentPlanOfStrict('R-1', order1)
  const pick2 = pipe.currentPlanOfStrict('R-1', order2)
  if (pick1?.id !== 'CHG-z') p.push(`顺序 1 选错了：${JSON.stringify(pick1?.id)}（应 CHG-z：agreed + revision 3 最大）`)
  if (pick2?.id !== 'CHG-z') p.push(`顺序 2 选错了：${JSON.stringify(pick2?.id)}（⚠ 结论随顺序翻转 ⇒ R-13 复发）`)
  if (pick1?.id !== pick2?.id) p.push(`两种物理顺序结论不同：${pick1?.id} vs ${pick2?.id} ⇒ R-13 复发`)
  /** ⑤ 已定优先：草稿 revision 更大也不该被选 */
  if (pick1?.id === 'CHG-m') p.push('选了草稿（revision 9）而不是已定方案 ⇒ ⑤ 失效')
  /** 全无已定时退到非 superseded 候选（PIPE-14 要求草稿仍算「当前方案」） */
  const onlyDraft = pipe.currentPlanOfStrict('R-1', [C])
  if (onlyDraft?.id !== 'CHG-m') p.push(`只有草稿时该返回它（面板要显示「归 Hob」）：${JSON.stringify(onlyDraft?.id)}`)
  /** superseded 一律排除 */
  const sup = { ...A, id: 'CHG-s', status: 'superseded' }
  const withSup = pipe.currentPlanOfStrict('R-1', [sup])
  if (withSup !== undefined) p.push(`superseded 不该被选：${JSON.stringify(withSup?.id)}`)
  /** ④ 负向对拍：模拟「按物理顺序」⇒ 必须与 ③ 的结论不同（证明 ③ 有牙） */
  const byPosition = order1.at(-1)?.id
  if (byPosition === pick1?.id) {
    p.push('夹具失效：按位置取和按业务状态取碰巧相同 ⇒ 本条证明不了 ③（⛔ 不按通过处理）')
  }
  if (p.length === 0) {
    ok('SC-37 ✓ **R-13**：`currentPlanOfStrict` 按「已定优先 → revision → created_at」选，'
      + `两种物理顺序结论相同（${pick1?.id}）；草稿不会被选成已定方案；superseded 一律排除`
      + '（⚠ 负向对拍：按位置取会得 ' + JSON.stringify(byPosition) + '，与业务选法不同 ⇒ 本条有牙）')
  } else for (const x of p) bad(`SC-37 · ${x}`)
}


// ── SC-38 · R-01 段 3：强判据必须能区分「自己验自己」与「他人验」 ───────────
/**
 * ── 守什么 ────────────────────────────────────────────────────────
 *   R-01 段 3 让 `allTasksVerified` / `allTasksAccepted` 调
 *   `verificationProblems` / `acceptanceProblems`。
 *   ⚠ 段 3 的判定链太深（7 步门禁，造不出夹具），
 *   但**这两个函数本身**是可直调的 —— 本条钉的就是它们的分辨力。
 *   ⇒ 若有人把 `verificationProblems` 改成永远返回 `[]`（或漏掉独立性那条），
 *     段 3 的整条链就失效了，而 `check:all` 不会红。本条挡住这个。
 *
 * ⚠ 这**不等于**「段 3 的判定链已验证」：它只证「强判据有分辨力」。
 */
{
  const V = gen.PIPELINE_VERSION ?? 'v3'
  const b = { pipeline_version: V, revision: '1' }
  const task = { ...b, id: 'TSK-R', kind: 'task', status: 'built', parent: 'CHG-R', title: 'T', built_by: 'dev-A' }
  const mk = (who) => ({ ...b, id: 'VER-R', kind: 'verification', status: 'pass', parent: 'TSK-R', verifier: who, task_revision: '1', title: 'v', basis: 'x', evidence_refs: 'y', verified_at: '2026-01-01', verification_session: 'sess-1', criteria_refs: 'AC-1' })
  const p = []
  const self = mod.verificationProblems(mk('dev-A'), [task, mk('dev-A')])
  const other = mod.verificationProblems(mk('dev-B'), [task, mk('dev-B')])
  if (!self.some((x) => /独立|verifier|实现者/.test(String(x.why)))) {
    p.push('验证者=实现者时没有「独立性」相关的问题 ⇒ 强判据失去分辨力（R-01 段 3 失效）')
  }
  if (self.length <= other.length) {
    p.push('「自己验自己」的问题数（' + self.length + '）<= 「他人验」（' + other.length + '）⇒ 判据不区分这两种情形')
  }
  if (p.length === 0) {
    ok('SC-38 ✓ **R-01 段 3 的判据有分辨力**：验证者=实现者 ⇒ 报 ' + self.length + ' 条；'
      + '他人验 ⇒ ' + other.length + ' 条（⚠ 只证「强判据能区分」，⛔ 不证「判定链已接通」）')
  } else for (const x of p) bad('SC-38 · ' + x)
}


// ── SC-39 · R-01 段 3：判定链**必须真的调用**强判据（源码层）─────────────
/**
 * ── 它补 SC-38 覆盖不到的那一半 ────────────────────────────────────
 *   SC-38 只证「`verificationProblems` 有分辨力」；
 *   ⛔ 它证不了「`allTasksVerified` 有没有把那个判据接进去」。
 *   ⇒ 若有人在 `allTasksVerified` 里删掉那一行，SC-38 **仍然绿**。
 *
 * ⚠ 本条是**源码层**检查（照 `:1156` 的先例）：
 *   断言 `allTasksVerified` 的函数体里出现 `verificationProblems(`，
 *   `allTasksAccepted` 里出现 `acceptanceProblems(`。
 *   ⛔ 它不证「运行时真的生效」—— 那需要走完 7 步门禁，夹具造不出（见 §202）。
 */
{
  const { readFileSync: rfX } = await import('node:fs')
  const { join: pjX, dirname: dnX } = await import('node:path')
  const { fileURLToPath: f2uX } = await import('node:url')
  const src = rfX(pjX(dnX(f2uX(import.meta.url)), '..', 'src', 'shared', 'pipeline-view.ts'), 'utf8')
  const bodyOf = (name) => {
    const at = src.indexOf(`function ${name}(`)
    if (at < 0) return undefined
    /** 从函数起点找到下一处顶格 '}'（本文件的函数都是顶格结束）。 */
    const end = src.indexOf('\n}', at)
    return end < 0 ? src.slice(at) : src.slice(at, end)
  }
  const p = []
  const vBody = bodyOf('allTasksVerified')
  const aBody = bodyOf('allTasksAccepted')
  if (vBody === undefined) p.push('读不到 `allTasksVerified` 的函数体（形态变了）')
  else if (!/verificationProblems\s*\(/.test(vBody)) {
    p.push('`allTasksVerified` 没有调用 `verificationProblems` ⇒ R-01 段 3 的判定链断了（SC-38 测不到这个）')
  }
  if (aBody === undefined) p.push('读不到 `allTasksAccepted` 的函数体（形态变了）')
  else if (!/acceptanceProblems\s*\(/.test(aBody)) {
    p.push('`allTasksAccepted` 没有调用 `acceptanceProblems` ⇒ R-01 段 3 的验收侧链路断了')
  }
  if (p.length === 0) {
    ok('SC-39 ✓ **R-01 段 3 的判定链已接通**（源码层）：'
      + '`allTasksVerified` 调 `verificationProblems`、`allTasksAccepted` 调 `acceptanceProblems`'
      + '（⚠ 只证「调了」，⛔ 不证「运行时生效」—— 后者需走完 7 步门禁）')
  } else for (const x of p) bad('SC-39 · ' + x)
}


// ── SC-40 · R-01 段 3 的宽限豁免必须在**判据函数内部** ─────────────────────
/**
 * ── 守什么 ────────────────────────────────────────────────────────
 *   R-01 的「宽限分支」到底在哪？
 *   ⛔ 不在 `pipeline-view.ts` 的 `legacyTag`（那只是给问题文字加 `[宽限]` 前缀）；
 *   ✅ 在 `stage-controls.ts` 的判据函数**第一行**：
 *        `verificationProblems`: `if (u.kind !== 'verification' || legacy(u)) return []`
 *        `acceptanceProblems`  : `if (legacy(u)) return []`
 *
 *   ⇒ 删掉这个 `legacy(u)` 判定，历史单元就会被强判据拦死，
 *     而 `SC-38` 测的是「有没有判据」、`SC-39` 测的是「有没有调」，**都测不到这个**。
 *
 * ── 判据（源码层）──────────────────────────────────────────────────
 *   ① 两个函数体里都要出现 `legacy(` 的**豁免式**调用（`legacy(u)) return`）；
 *   ② 且该调用必须出现在函数体**前半段**（是提前返回，⛔ 不是末尾兜底）。
 *
 * ⚠ 只证「代码写了提前返回」，⛔ 不证「历史单元真的被判成 legacy」（那要注入 provenance）。
 */
{
  const { readFileSync: rfW } = await import('node:fs')
  const { join: pjW, dirname: dnW } = await import('node:path')
  const { fileURLToPath: f2uW } = await import('node:url')
  const src = rfW(pjW(dnW(f2uW(import.meta.url)), '..', 'src', 'shared', 'stage-controls.ts'), 'utf8')
  const bodyOf = (name) => {
    const at = src.indexOf('function ' + name + '(')
    if (at < 0) return undefined
    const end = src.indexOf('\n}', at)
    return end < 0 ? undefined : src.slice(at, end + 2)
  }
  const p = []
  for (const [name, label] of [['verificationProblems', '技术验证'], ['acceptanceProblems', '产品验收']]) {
    const b = bodyOf(name)
    if (b === undefined) { p.push('读不到 `' + name + '` 的函数体（形态变了）'); continue }
    const m = /legacy\(u\)\)\s*return/.exec(b)
    if (m === null) {
      p.push('`' + name + '` 里没有 `legacy(u)) return` 的提前返回 ⇒ ' + label + '侧的历史单元豁免没了（R-01 段 3 会拦死存量）')
    } else {
      /**
       * ⚠ 位置判据：豁免必须早于**任何** `out.push`。
       *   用「函数体前半段」判是**错的**（2026-11-11 实测：把豁免挪到 pos 356 / 3931，
       *   仍在「前半段」⇒ 判据放行，但它已经在一条 `out.push` 之后了）。
       */
      const firstPush = b.indexOf('out.push')
      if (firstPush >= 0 && m.index > firstPush) {
        p.push('`' + name + '` 的豁免式在首个 `out.push` 之后（豁免 ' + m.index + ' > push ' + firstPush + '）⇒ 末尾兜底挡不住已 push 的问题')
      }
    }
  }
  if (p.length === 0) {
    ok('SC-40 ✓ **R-01 段 3 的宽限豁免在判据函数内部**（源码层）：'
      + '`verificationProblems` / `acceptanceProblems` 都在函数体前部以 `legacy(u)) return` 提前返回'
      + '（⚠ 只证「写了提前返回」，⛔ 不证「历史单元真被判成 legacy」）')
  } else for (const x of p) bad('SC-40 · ' + x)
}
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处${fail > 0 ? ` · 没过 ${fail} 处` : ''} · **跳过 0 处**`)
console.log('')
console.log(`SC 组：通过 ${pass} · 失败 ${fail}`)
console.log('')
if (fail > 0) {
  console.log('  ⛔ 有失败项 ⇒ 本组不算通过')
  process.exit(1)
}
console.log('  ✅ SC 组全绿（⚠ 历史存量按 pre-control 只读豁免；新数据必须过门禁）')
process.exit(0)
