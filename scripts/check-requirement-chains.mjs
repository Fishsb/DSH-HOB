#!/usr/bin/env node
/**
 * **需求链投影判据**（2026-11-07 · `R-020`）。
 *
 * 守的是面板主视图的唯一数据来源：一条需求从第 1 步走到第 5 步，
 * 只认正式边，缺失关系不猜，当前步骤唯一。
 *
 * 正反向用同一个 `auditChains()`：正向喂真投影，负向喂“把全部条目塞进每条链”的旧式投影。
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

const mod = await import(pathToFileURL(join(root, 'src', 'shared', 'requirement-chain.ts')).href)
const pipeMod = await import(pathToFileURL(join(root, 'src', 'shared', 'pipeline.ts')).href)

console.log('')
console.log('RC 组：需求链（单需求阶段 / 正式关系 / 当前步骤 / 历史收口）')
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
  if (p.length === 0) ok('RC-1 ✓ 单需求阶段：任务书已齐 ⇒ 当前=4（执行中）· 5 等待 · next=TSK-1 · 概要来自账本字段')
  else for (const x of p) bad(`RC-1 · ${x}`)
  const audit = auditChains(out)
  if (audit.length === 0) ok('RC-2 ✓ 链的 currentStep/complete/inFlight/total 互相一致')
  else for (const x of audit) bad(`RC-2 · ${x}`)
}

// RC-3 已完成链：built + pass ⇒ completed，historyItemCount 去重。
{
  /**
   * ⚠⚠ **期望值从 4 改为 5**（R-08 · 2026-11-10）。
   *
   * ── 为什么变 ────────────────────────────────────────────────────────────────
   *   这个夹具**没有 `pipeline_version`** ⇒ `state === 'legacy'` ⇒ 走 5 步旧链。
   *   R-08 之前：legacy 第 5 步「验收核对」取 `verifications`（本夹具没有 VER）
   *   ⇒ 第 5 步条目为空 ⇒ 历史条目去重后 = **4**（req / CHG / TSK / RUN）。
   *   R-08 之后：legacy 第 5 步取 `accs`（本夹具有 `ACC-1`）
   *   ⇒ 历史条目 = **5**（req / CHG / TSK / RUN / ACC）。
   *
   *   ⚠ **这不是回归，是修复的正确后果**：旧行为下 `ACC-1` **根本没有出现在链里**
   *     （尽管它 `pass` 且链判 `completed`）—— 那正是 R-08 要治的「条目不可见」。
   *   ⛔ 不许为了让这个数回到 4 而去改 R-08 的实现。
   */
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
  if (out.historyItemCount !== 5) p.push(`historyItemCount=${out.historyItemCount}（期望去重后的 5：需求 / 方案 / 任务 / 执行 / 验收 —— R-08 后 legacy 第 5 步含 acc）`)
  if (p.length === 0) ok('RC-3 ✓ built + pass ⇒ completed；历史条目按单元去重（5 条，含 legacy 第 5 步的 acc）')
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
    U('TSK-2', 'task', 'built', { parent: 'CHG-1', ...BRIEF }),
    U('ACC-1', 'acc', 'pass', { parent: 'TSK-1', verified_at: '2026-11-07T01:00:00+08:00' }),
    U('ACC-2', 'acc', 'unverified', { parent: 'TSK-2' }),
  ], '2026-11-07T00:00:00.000Z')
  const c = out.chains[0]
  const p = []
  if (c?.currentStep !== 4) p.push(`当前步=${c?.currentStep}（期望 4）`)
  if (c?.next?.kind !== 'blocked') p.push(`next=${c?.next?.kind}（built 但零 RUN 应 blocked，⛔ 不许跳过执行先去 accept）`)
  if (c?.next?.kind === 'accept') p.push(`next 跨过当前第 4 步去验收：${JSON.stringify(c?.next)}`)
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

// RC-12 v3 chain exposes the six lifecycle stages plus closure.
{
  const v3 = (u) => ({ ...u, pipeline_version: 'v3', revision: '1' })
  const units = [
    v3(U('R-1', 'req', 'agreed', { acceptance_criteria: ['AC-1 | 保存后出现成功提示'], clarify_examples: ['点击保存'] })),
    v3(U('CHG-1', 'change', 'settled', {
      req_ids: ['R-1'], addresses: ['R-1'], path_options: ['A'], path_tradeoffs: ['A 可直接复用'],
      path_decision: 'A', requirement_coverage: ['R-1 → 保存提示'],
      risk_tier: 'low', risk_rule_version: 'v1', risk_hard_triggers: [],
      risk_dimensions: ['scope=local','severity=minor','reversibility=easy','detectability=automatic','uncertainty=known','changeSurface=few-files','dependencies=internal-deps','verificationMaturity=proven','recoveryTime=minutes','exposure=internal'],
      risk_assessed_at: '2026-11-08T00:00:00Z', risk_assessed_by: 'Hob', delivery_scope: 'none',
      risk_assessment_ref: 'CHG-1#1', risk_binding_version: 'v1',
    })),
    v3(U('TSK-1', 'task', 'built', {
      parent: 'CHG-1', req_ids: ['R-1'], ...BRIEF, criteria_refs: ['AC-1'], built_by: 'dev',
      task_risk: 'low', risk_reasons: [], requires_isolation: 'false', requires_review: 'false',
      requires_serial_execution: 'false', touched_surfaces: [], irreversible_actions: [],
    })),
    v3(U('RUN-1', 'run', 'returned', { parent: 'TSK-1', task_revision: '1', progress_refs: ['EVD-1'] })),
    v3(U('VER-1', 'verification', 'pass', { parent: 'TSK-1', task_revision: '1', verifier: 'verifier', verification_session: 'verifier', verified_at: '2026-11-08T01:00:00Z', basis: ['EVD-1'], evidence_refs: ['EVD-1'], criteria_refs: ['AC-1'] })),
    v3(U('EVD-1', 'evidence', 'recorded', { parent: 'TSK-1', reading: 'exit 0', evidence_kind: 'command', command: 'npm test', exit_code: '0' })),
  ]
  const pipelineMod = await import(new URL('../src/shared/pipeline.ts', import.meta.url))
  const riskMod = await import(new URL('../src/shared/risk-policy.ts', import.meta.url))
  const reqUnit = units[0]
  const planUnit = units[1]
  planUnit.risk_inputs_digest = riskMod.riskAssessmentOf(riskMod.riskFactsOf(planUnit)).inputsDigest
  planUnit.risk_binding_digest = pipelineMod.riskBindingDigestOf(planUnit, units)
  units.push(
    { id: 'DEC-R1', kind: 'decision', status: 'active', title: '用户批准需求', decision_kind: 'stage-approval',
      approval_stage: 'requirements', artifact_id: 'R-1', artifact_revision: '1', artifact_digest: pipelineMod.artifactDigestOf(reqUnit),
      decision: 'approve', decided_by: 'user', decided_at: '2026-11-08T00:00:00Z', source: '确认需求 R-1 第 1 版' },
    { id: 'DEC-C1', kind: 'decision', status: 'active', title: '用户批准方案', decision_kind: 'stage-approval',
      approval_stage: 'plan', artifact_id: 'CHG-1', artifact_revision: '1', artifact_digest: pipelineMod.artifactDigestOf(planUnit),
      decision: 'approve', selected_option: 'A', decided_by: 'user', decided_at: '2026-11-08T00:10:00Z', source: '确认方案 CHG-1 第 1 版，选 A' },
  )
  const c = mod.buildRequirementChains(units, 'x').chains[0]
  const p = []
  if (c?.steps.length !== 7) p.push(`v3 链步骤数=${c?.steps.length}（期望 7）`)
  if (c?.steps[4]?.name !== '技术验证' || c?.steps[5]?.name !== '产品验收' || c?.steps[6]?.name !== '交付收口') {
    p.push(`阶段名=${JSON.stringify(c?.steps.slice(4).map((s) => s.name))}`)
  }
  if (c?.currentStep !== 6) p.push(`技术验证通过后当前步=${c?.currentStep}（期望 6）`)
  if (c?.pipeline?.gate !== 'G5-acceptance') p.push(`当前门=${c?.pipeline?.gate}`)
  if (p.length === 0) ok('RC-12 ✓ v3 链按七列投影：技术验证与产品验收独立，当前门为 G5')
  else for (const x of p) bad(`RC-12 · ${x}`)
}

// RC-13 v3 product acceptance is chain completion; delivery closure stays separate.
{
  const v3 = (u) => ({ ...u, pipeline_version: 'v3', revision: '1' })
  const req = v3(U('R-13', 'req', 'agreed', { acceptance_criteria: ['AC-1 | 可观察'], clarify_examples: ['例子'] }))
  const plan = v3(U('CHG-13', 'change', 'settled', {
    req_ids: ['R-13'], addresses: ['R-13'], path_options: ['A'], path_tradeoffs: ['A 可回滚'],
    path_decision: 'A', requirement_coverage: ['R-13 → A'],
    risk_tier: 'low', risk_rule_version: 'v1', risk_hard_triggers: [],
    risk_dimensions: ['scope=local','severity=minor','reversibility=easy','detectability=automatic','uncertainty=known','changeSurface=few-files','dependencies=internal-deps','verificationMaturity=proven','recoveryTime=minutes','exposure=internal'],
    risk_assessed_at: '2026-11-08T00:00:00Z', risk_assessed_by: 'Hob', delivery_scope: 'external',
    risk_assessment_ref: 'CHG-13#1', risk_binding_version: 'v1',
  }))
  const pipelineMod = await import(new URL('../src/shared/pipeline.ts', import.meta.url))
  const riskMod = await import(new URL('../src/shared/risk-policy.ts', import.meta.url))
  plan.risk_inputs_digest = riskMod.riskAssessmentOf(riskMod.riskFactsOf(plan)).inputsDigest
  plan.risk_binding_digest = pipelineMod.riskBindingDigestOf(plan, [req])
  const units = [req, plan,
    v3(U('TSK-13', 'task', 'built', {
      parent: 'CHG-13', req_ids: ['R-13'], ...BRIEF, criteria_refs: ['AC-1'], built_by: 'dev',
      task_risk: 'low', risk_reasons: [], requires_isolation: 'false', requires_review: 'false',
      requires_serial_execution: 'false', touched_surfaces: [], irreversible_actions: [],
    })),
    v3(U('RUN-13', 'run', 'returned', { parent: 'TSK-13', task_revision: '1', progress_refs: ['EVD-13'] })),
    v3(U('EVD-13', 'evidence', 'recorded', { parent: 'TSK-13', reading: 'exit 0', evidence_kind: 'command', command: 'npm test', exit_code: '0' })),
    v3(U('VER-13', 'verification', 'pass', { parent: 'TSK-13', task_revision: '1', verifier: 'verifier', verification_session: 'verifier', verified_at: '2026-11-08T01:00:00Z', basis: ['EVD-13'], evidence_refs: ['EVD-13'], criteria_refs: ['AC-1'] })),
    v3(U('ACC-13', 'acc', 'pass', { parent: 'TSK-13', task_revision: '1', actor: 'acceptor', acceptance_session: 'acceptor', verified_at: '2026-11-08T02:00:00Z', basis: ['EVD-13'], verification_refs: ['EVD-13'], example_results: ['EX-1 | pass | EVD-13'], product_confirmation: '用户接受', risk_residual_tier: 'low' })),
  ]
  units.push(
    { id: 'DEC-R13', kind: 'decision', status: 'active', title: '用户批准需求', decision_kind: 'stage-approval', approval_stage: 'requirements', artifact_id: 'R-13', artifact_revision: '1', artifact_digest: pipelineMod.artifactDigestOf(req), decision: 'approve', decided_by: 'user', decided_at: '2026-11-08T00:00:00Z', source: '确认需求 R-13 第 1 版' },
    { id: 'DEC-C13', kind: 'decision', status: 'active', title: '用户批准方案', decision_kind: 'stage-approval', approval_stage: 'plan', artifact_id: 'CHG-13', artifact_revision: '1', artifact_digest: pipelineMod.artifactDigestOf(plan), decision: 'approve', selected_option: 'A', decided_by: 'user', decided_at: '2026-11-08T00:10:00Z', source: '确认方案 CHG-13 第 1 版，选 A' },
  )
  const c = mod.buildRequirementChains(units, 'x').chains[0]
  const p = []
  if (c?.chainCompleted !== true) p.push(`产品已接受但 chainCompleted=${JSON.stringify(c?.chainCompleted)}`)
  if (c?.deliveryClosed !== false) p.push(`未做 G6 却 deliveryClosed=${JSON.stringify(c?.deliveryClosed)}`)
  if (c?.complete !== true) p.push('产品已接受却不计入链完成')
  if (c?.inFlight !== false) p.push('产品已接受却仍在途')
  if (p.length === 0) ok('RC-13 ✓ v3 产品验收完成即链完成；交付未收口只影响 deliveryClosed，不把需求误报为在途')
  else for (const x of p) bad(`RC-13 · ${x}`)
}


/**
 * ── RC-14：**T-08** —— G3–G6 的阻断原因必须进 `next.blockedBy`（2026-11-10）──────
 *
 * ⚠ 病（实测）：`requirement-chain` 只在 `gate === 'G1-requirement'` / `'G2-plan'` 时
 *   把 `pipeline.blockedBy` 注入 `next`。走到 G3–G6 时 `next` 保留的是全局 `nextAction`
 *   的结论 ⇒ 面板印「卡在哪：没有主阻断」，而同一时刻派活可能被 `pipelineDispatchProblems` 拒。
 *   **面板说「没卡」+ 闸门说「不能派」= 两个信号相反，且都不指向原因。**
 *
 * ⚠ 本断言钉两件事（缺一不可）：
 *   ① G3 的阻断原因**出现在** `next.blockedBy`；
 *   ② `next.kind` **不被改写**（⛔ 不许另造一套「下一步」判据 —— 那是 R-02/R-14 的形态）。
 */
{
  const req = { id: 'R-T8', kind: 'req', status: 'agreed', pipeline_version: 'v3', revision: '1',
    clarify_examples: ['EX-1 | pass(ok) | /tmp/e.md'], clarify_questions: [], clarify_assumptions: [],
    acceptance_criteria: ['AC-1 | | 保存成功'], acceptance_ids: ['AC-1'] }
  const plan = { id: 'CHG-T8', kind: 'change', status: 'agreed', pipeline_version: 'v3', revision: '1',
    req_ids: ['R-T8'], addresses: ['R-T8'], path_options: ['A'], path_tradeoffs: ['a'], path_decision: 'A',
    requirement_coverage: ['R-T8 → x'], risk_rule_version: 'v1', risk_tier: 'low', risk_hard_triggers: [],
    risk_dimensions: ['scope=local', 'severity=negligible', 'reversibility=easy', 'detectability=automatic',
      'uncertainty=known', 'changeSurface=one-point', 'dependencies=independent',
      'verificationMaturity=proven', 'recoveryTime=minutes', 'exposure=internal'] }
  const dec = (art, stage) => ({ id: 'DEC-' + art.id, kind: 'decision', status: 'active',
    decision_kind: 'stage-approval', approval_stage: stage, artifact_id: art.id, artifact_revision: '1',
    artifact_digest: pipeMod.artifactDigestOf(art), decision: 'approve',
    selected_option: stage === 'plan' ? 'A' : '', decided_by: 'user',
    decided_at: '2026-11-10T00:00:00Z', source: '确认' + art.id + ' 第 1 版' })
  /** 依赖悬空 ⇒ G3 有阻断（R-05 接上 G3 之后这条会同时挡住派发）。 */
  const task = { id: 'TSK-T8', kind: 'task', status: 'todo', pipeline_version: 'v3', revision: '1',
    parent: 'CHG-T8', task_brief: 'archive/x/TASK.md', counterexamples: ['c'], stop_conditions: ['s'],
    return_to: 'back-to-plan', test_plan: 'p', task_risk: 'low', risk_reasons: ['r'],
    touched_surfaces: ['s'], acceptance_criteria_refs: ['AC-1'], depends_on: ['TSK-NOT-EXIST'] }
  const units = [req, plan, dec(req, 'requirements'), dec(plan, 'plan'), task]
  const chain = mod.buildRequirementChain(req, units, '2026-11-10T00:00:00Z')
  const p = []
  const pipelineBlocked = (chain?.pipeline?.blockedBy ?? [])
  const nextBlocked = (chain?.next?.blockedBy ?? [])
  if (chain?.pipeline?.gate !== 'G3-tasks') p.push(`gate=${JSON.stringify(chain?.pipeline?.gate)}（期望 G3-tasks）`)
  if (!pipelineBlocked.some((x) => String(x).includes('悬空'))) p.push('夹具没造出 G3 阻断（前置失效）')
  if (!nextBlocked.some((x) => String(x).includes('悬空'))) {
    p.push(`G3 阻断原因没进 next.blockedBy（next.blockedBy=${JSON.stringify(nextBlocked.slice(0, 2))}）`)
  }
  if (chain?.next?.kind !== 'dispatch') p.push(`next.kind=${JSON.stringify(chain?.next?.kind)}（⛔ 不许被改写）`)
  if (p.length === 0) ok('RC-14 ✓ **负向对拍**：G3 的阻断原因进 `next.blockedBy`，且 `next.kind` 不被改写'
    + '（⛔ 面板说「没卡」而闸门说「不能派」这种相反信号已消除）')
  else for (const x of p) bad(`RC-14 · ${x}`)
}


/**
 * ── RC-15：**R-08** —— legacy 第 5 步的「状态源」与「条目源」必须同源（2026-11-10）──
 *
 * ⚠ 病（实测）：`LEGACY_STEP_DEFS` 第 5 步叫「验收核对」、`kind: 'acc'`，
 *   但 `items` / `done` / `doing` 三处都取 `chain.verifications`。
 *   ⇒ legacy 账本若只有 ACC 没有 VER（旧账本常见）⇒ 同屏「已完成 / 0/0 / 这一步还没有条目」。
 *
 * ⚠ 本断言钉三件事：
 *   ① 第 5 步条目必须来自 **acc**（⛔ 不是 verification）；
 *   ② `total === itemIds.length`（计数与条目一致）；
 *   ③ `done` 必须等于 pass 的 acc 条数（状态源与条目源同一个集合）。
 */
{
  const req = { id: 'R-L8', kind: 'req', status: 'agreed', acceptance_criteria: ['AC-1 | | x'] }
  const chg = { id: 'CHG-L8', kind: 'change', status: 'settled', parent: 'R-L8',
    req_ids: ['R-L8'], addresses: ['R-L8'] }
  const tsk = { id: 'TSK-L8', kind: 'task', status: 'built', parent: 'CHG-L8',
    task_brief: 'x', counterexamples: ['c'], stop_conditions: ['s'], return_to: 'back-to-plan' }
  const acc1 = { id: 'ACC-L8-1', kind: 'acc', status: 'pass', parent: 'TSK-L8' }
  const acc2 = { id: 'ACC-L8-2', kind: 'acc', status: 'undecidable', parent: 'TSK-L8' }
  /** 故意造一条 VER：legacy 第 5 步**不许**取它。 */
  const ver = { id: 'VER-L8', kind: 'verification', status: 'pass', parent: 'TSK-L8' }
  const c = mod.buildRequirementChain(req, [req, chg, tsk, acc1, acc2, ver], '2026-11-10T00:00:00Z')
  const s5 = c?.steps?.find((s) => s.step === 5)
  const p = []
  if (c?.pipeline?.state !== 'legacy') p.push(`夹具不是 legacy 链（state=${JSON.stringify(c?.pipeline?.state)}）`)
  if (s5 === undefined) p.push('没有第 5 步')
  else {
    const ids = s5.itemIds ?? []
    if (!ids.every((id) => String(id).startsWith('ACC-'))) {
      p.push(`第 5 步条目不是 acc：${JSON.stringify(ids)}（⛔ legacy 第 5 步 = 验收核对 = acc）`)
    }
    if (ids.some((id) => String(id).startsWith('VER-'))) p.push('第 5 步仍取了 verification 条目')
    if (s5.total !== ids.length) p.push(`total=${s5.total} 与 itemIds.length=${ids.length} 不一致`)
    if (s5.done !== 1) p.push(`done=${s5.done}（期望 1：ACC-L8-1 是 pass）`)
  }
  if (p.length === 0) ok('RC-15 ✓ **负向对拍**：legacy 第 5 步的状态源与条目源**同源**（都是 acc）'
    + '，且 total 与条目数一致（⛔ 不再是「已完成 / 0/0 / 没有条目」）')
  else for (const x of p) bad(`RC-15 · ${x}`)
}

// ── RC-16：R-14 —— `nextAction` 必须注入 `convergence`，⛔ 不许传空对象 ────────────
//
//  ⚠ 这条钉的是**病因**而不是症状：
//    改前 `requirement-chain.ts` 调 `nextAction(chainUnits, {})` ⇒ 第③步 `converge` 整段不执行
//    ⇒「任务都 built 了、但方案还没收口」这个**最常见**状态，全局算法匹配不上 ⇒ `undecidable`。
//  ⚠ 实测（任务 built + 未判决 ACC）：
//      不注入: {kind:'undecidable', target:null}
//      注入  : {kind:'converge',   target:'CHG-1'}
//  ⚠ 补丁（`currentStep===5` 那段）仍然需要 —— 它把 `converge` 细化成 `accept ACC-xxx`。
//    ⇒ 本条**只验注入存在且来自唯一实现**，⛔ 不复述补丁行为（那是 RC-11 的事）。
{
  const src = readFileSync(join(root, 'src/shared/requirement-chain.ts'), 'utf8')
  const p = []
  /** ① 调用点不许再传空对象。 */
  if (/nextAction\(\s*chainUnits\s+as\s+any\s*,\s*\{\s*\}\s*\)/.test(src)) {
    p.push('`nextAction(chainUnits, {})` 又出现了 ⇒ 第③步 `converge` 不执行，R-14 复发')
  }
  /** ② 必须真的传了 convergence 回调。 */
  if (!/convergence:\s*\(chg\)\s*=>/.test(src)) p.push('调用点没有传 `convergence` 回调')
  /** ③ 必须调唯一实现 `convergenceOf`（⛔ 不许在这里另写判据）。 */
  if (!src.includes('convergenceOf(')) p.push('没有调用 `convergenceOf` ⇒ 可能在本地另写了一套收口判据（同一事实两份实现）')
  if (!src.includes("from './convergence.ts'")) p.push('没有从 `convergence.ts` 导入 ⇒ 判据来源不明')
  if (p.length === 0) {
    ok('RC-16 ✓ **负向对拍**：`nextAction` 注入了 `convergence`（来自唯一实现 `convergenceOf`），'
      + '⛔ 不再传空对象（R-14：病因是注入缺失，不是补丁不够）')
  } else for (const x of p) bad('RC-16 · ' + x)
}

console.log('')
console.log(`RC 组：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处`
  + (fail > 0 ? ` · 没过 ${fail} 处` : '')
  + ' · 跳过 0 处')
if (fail > 0) process.exitCode = 1
