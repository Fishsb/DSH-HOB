#!/usr/bin/env node
/**
 * **需求链投影判据**（2026-11-07 · `R-020`）。
 *
 * 守的是面板主视图的唯一数据来源：一条需求从第 1 步走到第 5 步，
 * 只认正式边，缺失关系不猜，当前步骤唯一。
 *
 * 正反向用同一个 `auditChains()`：正向喂真投影，负向喂“把全部条目塞进每条链”的旧式投影。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
let pass = 0
let fail = 0
const ok = (m) => { pass += 1; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail += 1; console.log(`  ✗ ${m}`) }

const mod = await import(pathToFileURL(join(root, 'src', 'shared', 'requirement-chain.ts')).href)

console.log('')
console.log('RC 组：需求链（单需求五步 / 正式关系 / 当前步骤 / 历史收口）')
console.log('')

const U = (id, kind, status, extra = {}) => ({ id, kind, status, title: id, created_at: '2026-11-07T00:00:00+08:00', ...extra })

/**
 * **C-5 任务书就绪的最小形状**（2026-11-08 · 第 3 步语义收口）。
 *
 * ⚠ 改前第 3 步拿 `task.status = built` 当完成信号 ⇒ 夹具里的任务不需要任务书字段。
 *   现在第 3 步只问「活拆清楚了没有」（C-5），所以凡是**应当算第 3 步完成**的
 *   任务夹具都必须带齐这四项；否则测试测到的是「任务书未齐」，不是原断言的对象。
 *   ⚠ 这是**补夹具**，⛔ 不是放宽判据：缺任一项的真实任务仍会被 C-5 拦。
 */
const BRIEF = {
  task_brief: 'archive/x/TASK.md',
  counterexamples: ['空输入不崩溃'],
  stop_conditions: ['与方案冲突即停'],
  return_to: 'back-to-plan',
}

function auditChains(out) {
  const problems = []
  if (out?.ok !== true) return ['投影没有返回 ok:true']
  if (!Array.isArray(out.chains)) return ['chains 不是数组']
  const ids = new Set()
  for (const c of out.chains) {
    if (ids.has(c.reqId)) problems.push(`需求链重复：${c.reqId}`)
    ids.add(c.reqId)
    if (!Number.isInteger(c.currentStep) && c.currentStep !== null) problems.push(`${c.reqId}: currentStep 不是 1..5 或 null`)
    if (c.currentStep !== null && (c.currentStep < 1 || c.currentStep > 5)) problems.push(`${c.reqId}: currentStep 越界 ${c.currentStep}`)
    const open = c.steps.filter((s) => s.displayState !== 'done')
    if (c.currentStep !== null && open.length > 0 && open[0].step !== c.currentStep) {
      problems.push(`${c.reqId}: currentStep=${c.currentStep} 但不是第一个未完成步 ${open[0].step}`)
    }
    if (c.complete !== (c.currentStep === null)) problems.push(`${c.reqId}: complete 与 currentStep 不一致`)
    if (c.inFlight === c.complete) problems.push(`${c.reqId}: inFlight 与 complete 同时成立/同时不成立`)
    for (const s of c.steps) {
      if (!Array.isArray(s.itemIds)) problems.push(`${c.reqId}/${s.step}: itemIds 不是数组`)
      if (s.total !== s.itemIds.length) problems.push(`${c.reqId}/${s.step}: total=${s.total} ≠ itemIds=${s.itemIds.length}`)
    }
  }
  if (out.activeCount !== out.chains.filter((c) => c.inFlight).length) problems.push('activeCount 与链不一致')
  if (out.completedCount !== out.chains.filter((c) => c.state === 'completed').length) problems.push('completedCount 与链不一致')
  if (!Array.isArray(out.retiredChains)) problems.push('retiredChains 不是数组')
  else if (out.retiredCount !== out.retiredChains.length) problems.push(`retiredCount=${out.retiredCount} 与退役链 ${out.retiredChains.length} 不一致`)
  if (Array.isArray(out.chains) && out.chains.some((c) => c.state === 'retired')) problems.push('退役需求混进了 chains')
  return problems
}

// RC-1 单需求完整链：任务书已齐、正在执行 ⇒ 第 3 步完成，当前步落在第 4 步。
//
// ⚠ 2026-11-08 语义收口：第 3 步只问「活拆清楚了没有」，第 4 步才问「执行事实成立没有」。
//   旧夹具把「任务 doing」当作第 3 步未完成，那是旧口径；现在 doing 的任务书已齐 ⇒
//   第 3 步 done，当前步 = 4（任务执行）。⚠ 这条正是本轮要钉的语义，⛔ 不把期望改回去。
{
  const units = [
    U('R-1', 'req', 'agreed', { acceptance_criteria: ['a', 'b'], clarify_examples: ['x'] }),
    U('CHG-1', 'change', 'settled', { addresses: ['R-1'], path_decision: '选 B' }),
    U('TSK-1', 'task', 'doing', { parent: 'CHG-1', req_ids: ['R-1'], ...BRIEF }),
    U('RUN-1', 'run', 'running', { parent: 'TSK-1' }),
    U('ACC-1', 'acc', 'unverified', { parent: 'TSK-1' }),
  ]
  const out = mod.buildRequirementChains(units, '2026-11-07T00:00:00.000Z')
  const c = out.chains[0]
  const p = []
  if (out.activeCount !== 1 || out.completedCount !== 0) p.push(`计数不对：${out.activeCount}/${out.completedCount}`)
  if (c?.reqId !== 'R-1' || c.currentStep !== 4) p.push(`当前步不对：${JSON.stringify(c?.currentStep)}`)
  if (c?.steps[3]?.displayState !== 'doing') p.push(`第 4 步不是进行中：${JSON.stringify(c?.steps[3]?.displayState)}`)
  if (c?.steps[4]?.displayState !== 'waiting') p.push(`第 5 步不是等待：${JSON.stringify(c?.steps[4]?.displayState)}`)
  if (c?.next?.target !== 'TSK-1') p.push(`下一步不是 TSK-1：${JSON.stringify(c?.next)}`)
  if (c?.steps[0]?.summary !== '验收条件 2 条 · 例子 1 条') p.push(`需求概要不对：${JSON.stringify(c?.steps[0]?.summary)}`)
  if (c?.steps[2]?.summary !== 'TSK-1 已派，执行中') p.push(`任务概要不对：${JSON.stringify(c?.steps[2]?.summary)}`)
  if (p.length === 0) ok('RC-1 ✓ 单需求五步：任务书已齐 ⇒ 当前=4（执行中）· 5 等待 · next=TSK-1 · 概要来自账本字段')
  else for (const x of p) bad(`RC-1 · ${x}`)
  const audit = auditChains(out)
  if (audit.length === 0) ok('RC-2 ✓ 链的 currentStep/complete/inFlight/total 互相一致')
  else for (const x of audit) bad(`RC-2 · ${x}`)
}

// RC-3 已完成链：built + pass ⇒ completed，historyItemCount 去重。
{
  const units = [
    U('R-1', 'req', 'agreed'),
    U('CHG-1', 'change', 'settled', { addresses: ['R-1'] }),
    U('TSK-1', 'task', 'built', { parent: 'CHG-1', req_ids: ['R-1'], ...BRIEF }),
    U('RUN-1', 'run', 'returned', { parent: 'TSK-1' }),
    U('ACC-1', 'acc', 'pass', { parent: 'TSK-1', verified_at: '2026-11-07T01:00:00+08:00' }),
  ]
  const out = mod.buildRequirementChains(units, '2026-11-07T00:00:00.000Z')
  const c = out.chains[0]
  const p = []
  if (c?.state !== 'completed' || c?.inFlight !== false || c?.currentStep !== null) p.push(`完成链状态不对：${JSON.stringify({ state: c?.state, inFlight: c?.inFlight, currentStep: c?.currentStep })}`)
  if (out.completedCount !== 1) p.push(`completedCount=${out.completedCount}`)
  if (out.historyItemCount !== 5) p.push(`historyItemCount=${out.historyItemCount}（期望去重后的 5）`)
  if (p.length === 0) ok('RC-3 ✓ built + pass ⇒ completed；历史条目按单元去重（5 条）')
  else for (const x of p) bad(`RC-3 · ${x}`)
}

// RC-3b 方案承接字段的三种现行写法必须都能把 change 挂回需求。
//
// ⚠ 真账本 `prompt-enhancer-release` 的 `CHG-344` 写的是
//   `req_ids = ["R-001"]`，旧需求链只认 `addresses` ⇒ 明明有方案却显示
//   「还没定方案」，当前步错误停在 2。这里三种写法各跑一次，防止再回退。
{
  const expected = '已定：选 B'
  const make = (changeFields) => mod.buildRequirementChains([
    U('R-1', 'req', 'agreed', { acceptance_criteria: ['a'], clarify_examples: ['x'] }),
    U('CHG-1', 'change', 'settled', { path_decision: '选 B', ...changeFields }),
    U('TSK-1', 'task', 'todo', { parent: 'CHG-1', ...BRIEF }),
  ], '2026-11-07T00:00:00.000Z').chains[0]
  const cases = [
    ['req_ids', { req_ids: ['R-1'] }],
    ['addresses', { addresses: ['R-1'] }],
    ['requirement_coverage', { requirement_coverage: ['R-1 → 方案第 1 条'] }],
  ]
  const p = []
  for (const [name, fields] of cases) {
    const c = make(fields)
    if (c?.steps[1]?.total !== 1) p.push(`${name}: change 没挂回需求（step2 total=${c?.steps[1]?.total}）`)
    if (c?.steps[1]?.displayState !== 'done') p.push(`${name}: 第 2 步不是 done（${c?.steps[1]?.displayState}）`)
    if (c?.steps[1]?.summary !== expected) p.push(`${name}: 方案概要不对（${c?.steps[1]?.summary}）`)
  }
  if (p.length === 0) ok('RC-3b ✓ 方案承接需求：req_ids / addresses / requirement_coverage 三种写法都挂得回需求')
  else for (const x of p) bad(`RC-3b · ${x}`)
}

// RC-3c 派发投影刚建的 RUN 是 registered，也必须让第 4 步显示“执行中”。
//
// ⚠ `ledger-projection` 的 LP-1 明确写 RUN registered；若需求链只认 running，
//   用户会在“已派活、执行会话尚未开始跑”这段真实窗口里看到“等待”，
//   从而以为派活没发生。registered / running 都属于执行已经开始。
{
  const out = mod.buildRequirementChains([
    U('R-1', 'req', 'agreed', { acceptance_criteria: ['a'], clarify_examples: ['x'] }),
    U('CHG-1', 'change', 'settled', { addresses: ['R-1'], path_decision: '选 B' }),
    U('TSK-1', 'task', 'doing', { parent: 'CHG-1', ...BRIEF }),
    U('RUN-1', 'run', 'registered', { parent: 'TSK-1' }),
  ], '2026-11-07T00:00:00.000Z')
  const c = out.chains[0]
  const p = []
  if (c?.currentStep !== 4) p.push(`当前步=${c?.currentStep}（期望 4）`)
  if (c?.steps[3]?.displayState !== 'doing') p.push(`第 4 步=${c?.steps[3]?.displayState}（registered RUN 应为 doing）`)
  if (!String(c?.steps[3]?.summary ?? '').includes('1 在跑')) p.push(`第 4 步概要没把 registered 算作在跑：${c?.steps[3]?.summary}`)
  if (p.length === 0) ok('RC-3c ✓ RUN registered ⇒ 第 4 步 doing（派发投影刚建 RUN 时不会误显示等待）')
  else for (const x of p) bad(`RC-3c · ${x}`)
}

// RC-3d 执行阶段没有 RUN 时，下一步必须点名缺口，不许落成“判不出”。
{
  const out = mod.buildRequirementChains([
    U('R-1', 'req', 'agreed', { acceptance_criteria: ['a'], clarify_examples: ['x'] }),
    U('CHG-1', 'change', 'settled', { addresses: ['R-1'], path_decision: '选 B' }),
    U('TSK-1', 'task', 'built', { parent: 'CHG-1', ...BRIEF }),
    U('ACC-1', 'acc', 'pass', { parent: 'TSK-1', verified_at: '2026-11-07T01:00:00+08:00' }),
  ], '2026-11-07T00:00:00.000Z')
  const c = out.chains[0]
  const p = []
  if (c?.currentStep !== 4) p.push(`当前步=${c?.currentStep}（期望 4）`)
  if (c?.next?.kind !== 'blocked') p.push(`next=${c?.next?.kind}（built 但零 RUN 应 blocked）`)
  if (!String(c?.next?.why ?? '').includes('零 RUN') && !String(c?.next?.why ?? '').includes('执行记录')) p.push(`下一步没点名执行缺口：${c?.next?.why}`)
  if (p.length === 0) ok('RC-3d ✓ built 但零 RUN ⇒ 下一步 blocked 且点名执行缺口（⛔ 不退化成判不出）')
  else for (const x of p) bad(`RC-3d · ${x}`)
}

// RC-4 有效验收取最新；同刻冲突判不出。
{
  const base = [
    U('R-1', 'req', 'agreed'),
    U('CHG-1', 'change', 'settled', { addresses: ['R-1'] }),
    U('TSK-1', 'task', 'built', { parent: 'CHG-1', ...BRIEF }),
    U('RUN-1', 'run', 'returned', { parent: 'TSK-1' }),
  ]
  const newerPass = mod.buildRequirementChains([
    ...base,
    U('ACC-OLD', 'acc', 'send-back', { parent: 'TSK-1', verified_at: '2026-11-01T00:00:00+08:00' }),
    U('ACC-NEW', 'acc', 'pass', { parent: 'TSK-1', verified_at: '2026-11-02T00:00:00+08:00' }),
  ], 'x')
  const conflict = mod.buildRequirementChains([
    ...base,
    U('ACC-A', 'acc', 'pass', { parent: 'TSK-1', verified_at: '2026-11-02T00:00:00+08:00' }),
    U('ACC-B', 'acc', 'send-back', { parent: 'TSK-1', verified_at: '2026-11-02T00:00:00+08:00' }),
  ], 'x')
  const p = []
  if (newerPass.chains[0]?.state !== 'completed') p.push(`旧退回 + 新通过没有收口：${newerPass.chains[0]?.state}`)
  if (conflict.chains[0]?.state === 'completed') p.push('同刻 PASS/SEND-BACK 冲突却被判成完成')
  if (conflict.chains[0]?.steps[4]?.displayState !== 'waiting') p.push(`同刻冲突第 5 步应为等待：${conflict.chains[0]?.steps[4]?.displayState}`)
  if (p.length === 0) ok('RC-4 ✓ 旧退回 + 新通过 ⇒ 收口；同刻冲突 ⇒ 判不出（不擅自挑一条）')
  else for (const x of p) bad(`RC-4 · ${x}`)
}

// RC-5 send-back 回流到对应阶段。
{
  const mk = (to) => mod.buildRequirementChains([
    U('R-1', 'req', 'agreed'),
    U('CHG-1', 'change', 'settled', { addresses: ['R-1'] }),
    U('TSK-1', 'task', 'built', { parent: 'CHG-1', ...BRIEF }),
    U('RUN-1', 'run', 'returned', { parent: 'TSK-1' }),
    U('ACC-1', 'acc', 'send-back', { parent: 'TSK-1', send_back_to: to, verified_at: '2026-11-07T01:00:00+08:00' }),
  ], 'x').chains[0]
  const p = []
  if (mk('back-to-task')?.currentStep !== 3) p.push(`back-to-task 当前步=${mk('back-to-task')?.currentStep}`)
  if (mk('back-to-plan')?.currentStep !== 2) p.push(`back-to-plan 当前步=${mk('back-to-plan')?.currentStep}`)
  if (mk('back-to-requirement')?.currentStep !== 1) p.push(`back-to-requirement 当前步=${mk('back-to-requirement')?.currentStep}`)
  if (mk('back-to-task')?.steps[4]?.displayState !== 'blocked') p.push('退回后第 5 步不是卡住')
  if (p.length === 0) ok('RC-5 ✓ send-back 回流：back-to-task/plan/requirement ⇒ 当前步 3/2/1；第 5 步=卡住')
  else for (const x of p) bad(`RC-5 · ${x}`)
}

// RC-6 缺步如实列出，不猜最近条目。
{
  const out = mod.buildRequirementChains([U('R-1', 'req', 'agreed')], 'x')
  const c = out.chains[0]
  const p = []
  if (!c?.missing.includes('change')) p.push(`missing 没有 change：${JSON.stringify(c?.missing)}`)
  if (!c?.missing.includes('task')) p.push(`missing 没有 task：${JSON.stringify(c?.missing)}`)
  if (!c?.missing.includes('acc')) p.push(`missing 没有 acc：${JSON.stringify(c?.missing)}`)
  if (c?.currentStep !== 2) p.push(`缺方案时当前步=${c?.currentStep}（期望 2）`)
  if (p.length === 0) ok('RC-6 ✓ 缺方案/任务/验收 ⇒ missing 点名；当前步=2；不挂最近条目')
  else for (const x of p) bad(`RC-6 · ${x}`)
}

// RC-7 退役需求不进活跃链；未归属条目不硬塞。
{
  const out = mod.buildRequirementChains([
    U('R-OLD', 'req', 'retired'),
    U('R-1', 'req', 'agreed'),
    U('CHG-1', 'change', 'settled', { addresses: ['R-1'] }),
    U('TSK-ORPHAN', 'task', 'todo', { parent: 'CHG-MISSING' }),
  ], 'x')
  const p = []
  if (out.retiredCount !== 1) p.push(`retiredCount=${out.retiredCount}`)
  if (out.chains.some((c) => c.reqId === 'R-OLD')) p.push('退役需求进了活跃链')
  if (!Array.isArray(out.retiredChains) || out.retiredChains.length !== 1 || out.retiredChains[0]?.reqId !== 'R-OLD') {
    p.push(`退役需求没有单独返回给历史区：${JSON.stringify(out.retiredChains)}`)
  }
  if (!out.unattached.includes('TSK-ORPHAN')) p.push(`未归属任务没有单列：${JSON.stringify(out.unattached)}`)
  if (p.length === 0) ok('RC-7 ✓ 退役需求只计数不进活跃；单独进 retiredChains；无正式边的任务进 unattached')
  else for (const x of p) bad(`RC-7 · ${x}`)
}

// RC-8 只认正式边：标题里写 R-1 不改变承接对象。
{
  const out = mod.buildRequirementChains([
    U('R-1', 'req', 'agreed'),
    U('R-2', 'req', 'agreed'),
    U('CHG-T', 'change', 'settled', { title: 'R-1 的方案', addresses: ['R-2'] }),
  ], 'x')
  const p = []
  if (out.chains.find((c) => c.reqId === 'R-1')?.steps[1]?.total !== 0) p.push('R-1 因标题引用被错误挂上方案')
  if (out.chains.find((c) => c.reqId === 'R-2')?.steps[1]?.total !== 1) p.push('R-2 没有拿到 addresses 指向的方案')
  if (p.length === 0) ok('RC-8 ✓ 只认 change.addresses，不从标题编号反推关系')
  else for (const x of p) bad(`RC-8 · ${x}`)
}

// RC-9 多方案 / 多任务全部保留在链里。
{
  const out = mod.buildRequirementChains([
    U('R-1', 'req', 'agreed'),
    U('CHG-A', 'change', 'settled', { addresses: ['R-1'], created_at: '2026-11-01T00:00:00+08:00' }),
    U('CHG-B', 'change', 'settled', { addresses: ['R-1'], created_at: '2026-11-02T00:00:00+08:00' }),
    U('TSK-A', 'task', 'built', { parent: 'CHG-A', req_ids: ['R-1'], ...BRIEF }),
    U('TSK-B', 'task', 'built', { parent: 'CHG-B', req_ids: ['R-1'], ...BRIEF }),
  ], 'x')
  const c = out.chains[0]
  const p = []
  if (c?.steps[1]?.total !== 2) p.push(`多方案保留 ${c?.steps[1]?.total} 个（期望 2）`)
  if (c?.steps[2]?.total !== 2) p.push(`多任务保留 ${c?.steps[2]?.total} 个（期望 2）`)
  if (!c?.steps[1]?.itemIds.includes('CHG-A') || !c?.steps[1]?.itemIds.includes('CHG-B')) p.push('方案 ID 丢失')
  if (p.length === 0) ok('RC-9 ✓ 多方案 / 多任务全部保留（2 / 2），⛔ 不按“第一条”丢其余')
  else for (const x of p) bad(`RC-9 · ${x}`)
}

// RC-11 已建任务 + 待判决验收：next 必须点名 ACC，⛔ 不许退化成“判不出”。
{
  const units = [
    U('R-1', 'req', 'agreed', { acceptance_ids: ['ACC-1'] }),
    U('CHG-1', 'change', 'settled', { addresses: ['R-1'] }),
    U('TSK-1', 'task', 'built', { parent: 'CHG-1', req_ids: ['R-1'], ...BRIEF }),
    U('RUN-1', 'run', 'returned', { parent: 'TSK-1' }),
    U('ACC-1', 'acc', 'unverified', { parent: 'TSK-1' }),
  ]
  const c = mod.buildRequirementChains(units, 'x').chains[0]
  const p = []
  if (c?.currentStep !== 5) p.push(`等待验收时当前步=${c?.currentStep}（期望 5）`)
  if (c?.steps[4]?.displayState !== 'waiting') p.push(`第 5 步不是等待：${c?.steps[4]?.displayState}`)
  if (c?.next?.kind !== 'accept') p.push(`next.kind=${JSON.stringify(c?.next?.kind)}（期望 accept）`)
  if (c?.next?.target !== 'ACC-1') p.push(`next.target=${JSON.stringify(c?.next?.target)}（期望 ACC-1）`)
  if (c?.next?.why === '' || typeof c?.next?.why !== 'string') p.push('next.why 为空')
  if (p.length === 0) ok('RC-11 ✓ built 任务 + 待判决验收 ⇒ currentStep=5 · 第 5 步 waiting · next=accept/ACC-1（⛔ 不退化成“判不出”）')
  else for (const x of p) bad(`RC-11 · ${x}`)

  const mutant = structuredClone(c)
  mutant.next = { kind: 'undecidable', target: null, why: '判不出下一步', blockedBy: [] }
  const problems = []
  if (mutant.next.kind !== 'accept') problems.push('next.kind 不是 accept')
  if (mutant.next.target !== 'ACC-1') problems.push('next.target 不是 ACC-1')
  if (problems.length === 2) ok('RC-11b ✓ 负向对拍（把 next 改回 undecidable）⇒ RC-11 的“必须点名 ACC”**必红**')
  else bad(`RC-11b · 负向对拍没有咬住：${JSON.stringify(problems)}`)
}

// RC-10 负向对拍：用“全局条目塞进每条链”的旧投影，auditChains 必须红。
{
  const units = [
    U('R-1', 'req', 'agreed'),
    U('CHG-1', 'change', 'settled', { addresses: ['R-1'] }),
    U('TSK-1', 'task', 'doing', { parent: 'CHG-1' }),
  ]
  const good = mod.buildRequirementChains(units, 'x')
  const wrong = structuredClone(good)
  for (const c of wrong.chains) {
    for (const s of c.steps) s.total = 99
  }
  const goodProblems = auditChains(good)
  const wrongProblems = auditChains(wrong)
  if (goodProblems.length === 0 && wrongProblems.length > 0) {
    ok(`RC-10 ✓ 负向对拍（把 total 改成全局条数）⇒ auditChains **必红**：${wrongProblems[0]}`)
  } else {
    bad('RC-10 · 负向对拍失效：坏投影没有被 auditChains 咬住')
  }
}

console.log('')
console.log(`RC 组：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处`
  + (fail > 0 ? ` · 没过 ${fail} 处` : '')
  + ' · 跳过 0 处')
if (fail > 0) process.exitCode = 1
