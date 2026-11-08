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

// RC-1 单需求完整链：第 4 步等待、第 5 步等待，当前只落在第 3 步。
{
  const units = [
    U('R-1', 'req', 'agreed', { acceptance_criteria: ['a', 'b'], clarify_examples: ['x'] }),
    U('CHG-1', 'change', 'settled', { addresses: ['R-1'], path_decision: '选 B' }),
    U('TSK-1', 'task', 'doing', { parent: 'CHG-1', req_ids: ['R-1'] }),
    U('RUN-1', 'run', 'returned', { parent: 'TSK-1' }),
    U('ACC-1', 'acc', 'unverified', { parent: 'TSK-1' }),
  ]
  const out = mod.buildRequirementChains(units, '2026-11-07T00:00:00.000Z')
  const c = out.chains[0]
  const p = []
  if (out.activeCount !== 1 || out.completedCount !== 0) p.push(`计数不对：${out.activeCount}/${out.completedCount}`)
  if (c?.reqId !== 'R-1' || c.currentStep !== 3) p.push(`当前步不对：${JSON.stringify(c?.currentStep)}`)
  if (c?.steps[3]?.displayState !== 'waiting') p.push(`第 4 步不是等待：${JSON.stringify(c?.steps[3]?.displayState)}`)
  if (c?.steps[4]?.displayState !== 'waiting') p.push(`第 5 步不是等待：${JSON.stringify(c?.steps[4]?.displayState)}`)
  if (c?.next?.target !== 'TSK-1') p.push(`下一步不是 TSK-1：${JSON.stringify(c?.next)}`)
  if (c?.steps[0]?.summary !== '验收条件 2 条 · 例子 1 条') p.push(`需求概要不对：${JSON.stringify(c?.steps[0]?.summary)}`)
  if (c?.steps[2]?.summary !== 'TSK-1 在做') p.push(`任务概要不对：${JSON.stringify(c?.steps[2]?.summary)}`)
  if (p.length === 0) ok('RC-1 ✓ 单需求五步：当前=3 · 4/5 等待 · next=TSK-1 · 概要来自账本字段')
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
    U('TSK-1', 'task', 'built', { parent: 'CHG-1', req_ids: ['R-1'] }),
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

// RC-4 有效验收取最新；同刻冲突判不出。
{
  const base = [
    U('R-1', 'req', 'agreed'),
    U('CHG-1', 'change', 'settled', { addresses: ['R-1'] }),
    U('TSK-1', 'task', 'built', { parent: 'CHG-1' }),
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
    U('TSK-1', 'task', 'built', { parent: 'CHG-1' }),
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
    U('TSK-A', 'task', 'built', { parent: 'CHG-A', req_ids: ['R-1'] }),
    U('TSK-B', 'task', 'built', { parent: 'CHG-B', req_ids: ['R-1'] }),
  ], 'x')
  const c = out.chains[0]
  const p = []
  if (c?.steps[1]?.total !== 2) p.push(`多方案保留 ${c?.steps[1]?.total} 个（期望 2）`)
  if (c?.steps[2]?.total !== 2) p.push(`多任务保留 ${c?.steps[2]?.total} 个（期望 2）`)
  if (!c?.steps[1]?.itemIds.includes('CHG-A') || !c?.steps[1]?.itemIds.includes('CHG-B')) p.push('方案 ID 丢失')
  if (p.length === 0) ok('RC-9 ✓ 多方案 / 多任务全部保留（2 / 2），⛔ 不按“第一条”丢其余')
  else for (const x of p) bad(`RC-9 · ${x}`)
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
if (fail > 0) process.exitCode = 1
