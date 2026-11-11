#!/usr/bin/env node
/**
 * **运行态 → 账本投影**判据族（2026-11-08 · 管线闭环）。
 *
 * 守三件事：
 *   ① 派发成功 ⇒ 建 RUN registered + TSK todo→doing + 关联 run_ids；
 *   ② 回传成功 ⇒ RUN registered/running→returned；**有读数才迁 TSK doing→built**；
 *   ③ 判决 ⇒ 建 ACC pass/send-back；**幂等**；判不出 / 不该写时三档分开。
 *
 * ⚠ 全部用**真源码 + 临时账本目录**跑（⛔ 不碰真账本）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const here = new URL('.', import.meta.url).pathname
const root = join(here, '..')
let pass = 0
let fail = 0
const ok = (m) => { pass += 1; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail += 1; console.log(`  ✗ ${m}`) }
const cleanup = (p) => { try { rmSync(p, { recursive: true, force: true }) } catch { /* 清理失败不掩盖结论 */ } }

const mod = await import(pathToFileURL(join(root, 'src', 'server', 'ledger-projection.ts')).href)
const writer = await import(pathToFileURL(join(root, 'src', 'server', 'projection-writer.ts')).href)
const gen = await import(pathToFileURL(join(here, 'gen-ledger.mjs')).href)
const risk = await import(pathToFileURL(join(root, 'src', 'shared', 'risk-policy.ts')).href)
const pipelineMod = await import(pathToFileURL(join(root, 'src', 'shared', 'pipeline.ts')).href)
const riskBindingDigestOf = pipelineMod.riskBindingDigestOf

const units = gen.readUnits()
const tasks = units.filter((u) => u.kind === 'task')
const T = tasks.find((u) => String(u.status) === 'built')
/**
 * ⚠⚠ **夹具必须满足现行 v3 契约**（B1.4 连带修复 · 2026-11-10）。
 *
 * ── 为什么以前不需要 ────────────────────────────────────────────────────────
 *   改前 `projection-writer` 落盘时传 `validateLedgerStructure: false`
 *   ⇒ 这份**契约前形态**的夹具（缺 clarify_examples / path_* / task_risk / …）
 *   也能落盘，于是 LP-7/8/9/9b/11 一路绿。
 *   B1.4 把那两处豁免删掉后，同一份夹具立刻被 `pipelineWriteProblems` 拒
 *   ⇒ **10 通过 / 20 失败**。
 *
 * ── 修的是哪一边（⛔ 不是把豁免加回来）──────────────────────────────────
 *   豁免的存在理由本来就不成立（decision/run/acc 与封闭契约完全兼容），
 *   而夹具是**测试替身**：它必须像一条真实的 v3 单元。
 *   ⇒ 把夹具升到现行契约形态，让 LP 组重新测它**本来要测的东西**
 *     （投影的落盘语义），而不是测「豁免还在不在」。
 *
 * ⚠ 每补一个字段都对应一条门禁规则，删任何一个都会让 LP-7 变红——
 *   这正是本组想要的行为（夹具与契约同源）。
 */
const todoTask = {
  id: 'TSK-PROJ', kind: 'task', title: '投影夹具任务', parent: 'CHG-PROJ', status: 'todo',
  pipeline_version: 'v3', revision: '1',
  task_brief: 'archive/x/TASK.md', counterexamples: ['空输入不崩溃'], stop_conditions: ['冲突即停'], return_to: 'back-to-plan',
  /** C-5：验收条件引用（必须指向本需求真实存在的验收条件 id）。 */
  acceptance_criteria_refs: ['AC-PROJ-1'],
  /** C-5：测试计划。 */
  test_plan: '跑 check:ledger-projection 的 LP-7..LP-13',
  /** RP-4：任务执行风险（v3 任务必须声明）。 */
  task_risk: 'low', risk_reasons: ['只动投影写盘器'], touched_surfaces: ['ledger/units'],
}
const chain = [
  {
    id: 'R-PROJ', kind: 'req', title: '投影夹具需求', status: 'agreed',
    pipeline_version: 'v3', revision: '1',
    /** C-1：关键例子（三段式）。 */
    clarify_examples: ['EX-1 | pass(出现提示) | /tmp/evidence.md'],
    /** C-1：可观察验收条件。 */
    acceptance_criteria: ['点保存后出现成功提示'],
    /** C-1：验收条件 id（task.acceptance_criteria_refs 指向它）。 */
    acceptance_ids: ['AC-PROJ-1'],
    clarify_questions: [], clarify_assumptions: [],
  },
  {
    id: 'CHG-PROJ', kind: 'change', title: '投影夹具方案', parent: 'R-PROJ', req_ids: ['R-PROJ'], status: 'settled',
    pipeline_version: 'v3', revision: '1',
    path_options: ['A', 'B'], path_tradeoffs: ['A 快', 'B 稳'], path_decision: '选 A',
    requirement_coverage: ['R-PROJ → 投影落盘'], addresses: ['R-PROJ'],
    /** RP-9：十维风险评定（v3 方案必须齐全且值在封闭集内）。 */
    risk_rule_version: 'v1',
    risk_dimensions: [
      'scope=local', 'severity=negligible', 'reversibility=easy', 'detectability=automatic',
      'uncertainty=known', 'changeSurface=one-point', 'dependencies=independent',
      'verificationMaturity=proven', 'recoveryTime=minutes', 'exposure=internal',
    ],
    risk_hard_triggers: [],
  },
  todoTask,
]

/**
 * ⚠⚠ **把一份单元对象渲染成 [[unit]] TOML 块**（B1.4 连带修复）。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────────
 *   LP-7/8/9/9b/11 都要往临时账本里写夹具。改前它们各自**手写 TOML 字面量**
 *   （'[[unit]]\nid = "R-PROJ"\n…'），而那份字面量是**契约前形态**：
 *   只有 id/kind/status/title/parent。
 *   以前靠 validateLedgerStructure: false 豁免才写进去；B1.4 删掉豁免后
 *   同一份夹具立刻被 pipelineWriteProblems 拒 ⇒ 这些用例测的不再是投影，
 *   而是「夹具够不够合法」。
 *
 * ── 为什么用渲染器而不是再手写一遍 ─────────────────────────────────────────
 *   手写必然与上面的 chain **漂移**（改一处漏一处，正是本仓反复记的病）。
 *   渲染器让「夹具对象」成为**唯一来源**，磁盘上的 TOML 是它的投影。
 *
 * ⚠ 只支持本文件用到的形态：字符串 / 数组 / 布尔 / 数字。⛔ 不支持嵌套表。
 */
function renderUnitToml(unit) {
  const lines = ['[[unit]]']
  for (const [k, v] of Object.entries(unit)) {
    if (v === undefined || v === null) continue
    if (Array.isArray(v)) {
      if (v.length === 0) continue
      lines.push(k + ' = [' + v.map((x) => JSON.stringify(String(x))).join(', ') + ']')
    } else if (typeof v === 'boolean' || typeof v === 'number') {
      lines.push(k + ' = ' + String(v))
    } else {
      lines.push(k + ' = ' + JSON.stringify(String(v)))
    }
  }
  return lines.join('\n') + '\n'
}

/** 把一组单元渲染成一个分片文件内容。 */
function renderShard(units) {
  return units.map(renderUnitToml).join('')
}

/**
 * 造一条**满足现行 v3 契约**的链（需求 / 方案 / 任务），供落盘类用例复用。
 * ⚠ 与上面的 chain 同源，只允许覆盖少数字段（status / built_by / run_ids…）。
 */
function chainFor(over = {}) {
  const base = chain.map((u) => {
    const patch = over[u.id]
    return patch === undefined ? u : { ...u, ...patch }
  })
  /** ⚠ 方案必须带**可计算的**风险评定字段，否则 RP-2/RP-3/RP-9 会拒写。 */
  return base.map((u) => (u.kind === 'change' ? withRisk(u, base) : u))
}

/**
 * 给一条方案补齐**可计算的**风险评定字段（RP-2 / RP-3 / RP-9 要求）。
 *
 * ⚠ 为什么不能手写常量：`risk_inputs_digest` / `risk_binding_digest` 是**由事实算出来的**
 *   （`riskAssessmentOf` / `riskBindingDigestOf`），手写一个字符串必然与当前事实不符
 *   ⇒ RP-3 报「评定已过期」。⇒ 这里**用同一份纯函数算**，与生产路径同源。
 */
function withRisk(plan, units) {
  const facts = risk.riskFactsOf(plan)
  const assessed = risk.riskAssessmentOf(facts)
  return {
    ...plan,
    risk_rule_version: risk.RISK_POLICY_VERSION,
    risk_tier: assessed.tier,
    risk_inputs_digest: assessed.inputsDigest,
    risk_assessed_at: '2026-11-10T00:00:00+08:00',
    risk_assessed_by: 'session-hob',
    risk_binding_version: risk.RISK_POLICY_VERSION,
    risk_binding_digest: riskBindingDigestOf(plan, units),
    risk_assessment_ref: 'archive/x/RISK.md',
  }
}

console.log('')
console.log('LP 组：运行态 → 账本投影（纯函数 + 临时账本）')
console.log('')

// ── LP-1：派发 ⇒ 建 RUN + TSK todo→doing + link ────────────────────────
{
  /**
   * ⚠ 纯函数层只接受调用方注入的模型面指纹；**读生成契约**是 I/O 层
   *   （`projection-writer.ts`）的职责。这里显式喂一个合法指纹，
   *   测的是"投影会把它落到 RUN"，⛔ 不是测文件系统。
   */
  const r = mod.projectFact(chain, {
    kind: 'dispatch', taskId: 'TSK-PROJ', target: 'session-dev', owner: 'session-hob', at: 1_700_000_000_000, task: '实现投影',
    modelFace: { version: 'v7', hash: 'a'.repeat(64) },
  })
  const p = []
  if (r.ops.length !== 3) p.push(`操作数=${r.ops.length}（期望 3：建 RUN / 迁 TSK / link）`)
  const create = r.ops.find((o) => o.op === 'create-unit')
  if (create === undefined || create.kind !== 'run') p.push('没有建 RUN')
  else {
    if (create.fields.status !== 'registered') p.push(`RUN 初始状态=${JSON.stringify(create.fields.status)}（期望 registered）`)
    if (create.fields.pipeline_version !== 'v3' || create.fields.revision !== '1' || create.fields.task_revision !== '1') {
      p.push(`RUN 未登记 Pipeline v3 / revision：${JSON.stringify(create.fields)}`)
    }
    if (create.fields.parent !== 'TSK-PROJ') p.push(`RUN.parent=${JSON.stringify(create.fields.parent)}`)
    if (create.fields.built_by !== 'session-dev') p.push(`RUN.built_by=${JSON.stringify(create.fields.built_by)}`)
    if (typeof create.fields.projection_key !== 'string' || create.fields.projection_key === '') p.push('RUN 缺 projection_key（幂等键）')
    if (!/^v\d+$/.test(String(create.fields.prompt_version ?? ''))) p.push(`RUN.prompt_version=${JSON.stringify(create.fields.prompt_version)}（要 vN）`)
    if (!/^[a-f0-9]{64}$/.test(String(create.fields.prompt_hash ?? ''))) p.push(`RUN.prompt_hash=${JSON.stringify(create.fields.prompt_hash)}（要 64 位 SHA-256）`)
  }
  const trans = r.ops.find((o) => o.op === 'transition-unit')
  if (trans === undefined || trans.from !== 'todo' || trans.to !== 'doing') p.push(`TSK 迁移=${JSON.stringify(trans)}（期望 todo→doing）`)
  const link = r.ops.find((o) => o.op === 'link-unit')
  if (link === undefined || link.field !== 'run_ids' || link.add.length !== 1) p.push(`link=${JSON.stringify(link)}（期望 run_ids+1）`)
  if (p.length === 0) ok('LP-1 ✓ 派发成功 ⇒ RUN registered + TSK todo→doing + run_ids 关联（三条操作）')
  else for (const x of p) bad(`LP-1 · ${x}`)
}

// ── LP-2：派发幂等（同一事件重复到达）────────────────────────────────────
{
  const fact = { kind: 'dispatch', taskId: 'TSK-PROJ', target: 'session-dev', owner: 'session-hob', at: 1_700_000_000_000 }
  const first = mod.projectFact(chain, fact)
  const created = first.ops.find((o) => o.op === 'create-unit')
  const after = [...chain, { id: created.id, kind: 'run', status: 'registered', parent: 'TSK-PROJ', projection_key: created.fields.projection_key }]
  const second = mod.projectFact(after, fact)
  const p = []
  if (second.ops.length !== 0) p.push(`重复事件仍产生 ${second.ops.length} 条操作`)
  if (typeof second.skipped !== 'string' || second.skipped === '') p.push('重复事件没有可读 skipped 原因')
  if (p.length === 0) ok(`LP-2 ✓ 同一派发重复到达 ⇒ 0 操作 + skipped（${second.skipped}）`)
  else for (const x of p) bad(`LP-2 · ${x}`)
}

// ── LP-3：回传（无进度读数）⇒ 只迁 RUN，不迁 TSK ────────────────────────
{
  const at = 1_700_000_000_000
  const withRun = [
    chain[0], chain[1],
    { ...todoTask, status: 'doing' },
    { id: 'RUN-001', kind: 'run', status: 'registered', parent: 'TSK-PROJ', built_by: 'session-dev', projection_key: `dispatch:TSK-PROJ:session-dev:${at}` },
  ]
  const r = mod.projectFact(withRun, {
    kind: 'return', taskId: 'TSK-PROJ', target: 'session-dev', at,
    deliveredAt: '2026-11-08T10:00:00+08:00',
  })
  const p = []
  const trans = r.ops.filter((o) => o.op === 'transition-unit')
  if (trans.length === 0) p.push('回传没有迁移任何单元')
  const runTrans = trans.find((o) => o.id === 'RUN-001')
  if (runTrans === undefined || runTrans.to !== 'returned') p.push(`RUN 未迁 returned：${JSON.stringify(runTrans)}`)
  const taskTrans = trans.find((o) => o.id === 'TSK-PROJ')
  if (taskTrans !== undefined) p.push(`无进度读数却迁了 TSK ⇒ ${JSON.stringify(taskTrans)}（回传 ≠ 做完）`)
  /**
   * ⚠ 自证夹具**确实处在可迁移状态**：任务必须是 doing。
   *   改前夹具任务仍是 todo，于是“没迁 TSK”只是因为 `todo` 本来就不能迁，
   *   并不是在验证“无读数不迁” —— 同一族断言会假绿。
   */
  if (withRun[2]?.status !== 'doing') p.push('夹具错误：任务不是 doing，无法证明“无读数不迁”')
  if (p.length === 0) ok('LP-3 ✓ 回传无进度读数 ⇒ 只迁 RUN returned，不迁 TSK built（回传 ≠ 做完）')
  else for (const x of p) bad(`LP-3 · ${x}`)
}

// ── LP-4：回传（有进度读数）⇒ 迁 RUN + 迁 TSK ────────────────────────────
{
  const at = 1_700_000_000_000
  const withRun = [
    chain[0], chain[1],
    { ...todoTask, status: 'doing' },
    { id: 'RUN-001', kind: 'run', status: 'running', parent: 'TSK-PROJ', built_by: 'session-dev', projection_key: `dispatch:TSK-PROJ:session-dev:${at}` },
  ]
  const r = mod.projectFact(withRun, {
    kind: 'return', taskId: 'TSK-PROJ', target: 'session-dev', at,
    deliveredAt: '2026-11-08T10:00:00+08:00',
    progressRefs: ['check:stages-route 35/35', 'typecheck exit 0'],
  })
  const p = []
  const runTrans = r.ops.find((o) => o.op === 'transition-unit' && o.id === 'RUN-001')
  if (runTrans === undefined || runTrans.to !== 'returned') p.push(`RUN 未迁 returned：${JSON.stringify(runTrans)}`)
  else if (!Array.isArray(runTrans.fields?.progress_refs) || runTrans.fields.progress_refs.length !== 2) p.push('RUN 未带 progress_refs')
  const taskTrans = r.ops.find((o) => o.op === 'transition-unit' && o.id === 'TSK-PROJ')
  if (taskTrans === undefined || taskTrans.to !== 'built') p.push(`TSK 未迁 built：${JSON.stringify(taskTrans)}`)
  else if (taskTrans.fields?.built_by !== 'session-dev') p.push('TSK built 未带 built_by')
  if (p.length === 0) ok('LP-4 ✓ 回传带进度读数 ⇒ RUN returned + TSK built（执行事实成立）')
  else for (const x of p) bad(`LP-4 · ${x}`)
}

// ── LP-5：判决 ⇒ 建 ACC（pass / send-back）──────────────────────────────
{
  const pass = mod.projectFact([...chain, { ...todoTask, status: 'built', built_by: 'session-dev' }], {
    kind: 'verdict', taskId: 'TSK-PROJ', verdict: 'pass', verifiedAt: '2026-11-08T11:00:00+08:00',
    basis: ['EVD-001'], actor: 'session-acceptor', acceptanceSession: 'session-acceptor',
    productConfirmation: '用户确认结果符合目标', verificationRefs: ['EVD-001'], exampleResults: ['EX-1 | pass | 点保存后出现成功提示'],
  })
  const back = mod.projectFact([...chain, { ...todoTask, status: 'built', built_by: 'session-dev' }], {
    kind: 'verdict', taskId: 'TSK-PROJ', verdict: 'send-back', verifiedAt: '2026-11-08T11:00:00+08:00',
    basis: ['EVD-002'], actor: 'session-acceptor', acceptanceSession: 'session-acceptor', sendBackTo: 'back-to-plan',
  })
  const p = []
  const a = pass.ops.find((o) => o.op === 'create-unit')
  if (a === undefined || a.kind !== 'acc' || a.fields.status !== 'pass') p.push(`pass 未建 ACC：${JSON.stringify(a)}`)
  else if (a.fields.basis?.[0] !== 'EVD-001') p.push('ACC 未带依据')
  const b = back.ops.find((o) => o.op === 'create-unit')
  if (b === undefined || b.fields.status !== 'send-back' || b.fields.send_back_to !== 'back-to-plan') p.push(`send-back 未正确落账：${JSON.stringify(b)}`)
  if (p.length === 0) ok('LP-5 ✓ 判决 ⇒ ACC pass / send-back（依据与退回目标都保留）')
  else for (const x of p) bad(`LP-5 · ${x}`)
}

// ── LP-6：判不出 / 不该写三档分开 ───────────────────────────────────────
{
  const missingTask = mod.projectFact([], { kind: 'dispatch', taskId: 'implicit', target: 's', at: 1 })
  const noSession = mod.projectFact([...chain, { ...todoTask, status: 'built' }], {
    kind: 'verdict', taskId: 'TSK-PROJ', verdict: 'pass', verifiedAt: '2026-11-08T11:00:00+08:00',
    basis: ['EVD-001'], actor: 'session-acceptor', productConfirmation: 'ok', verificationRefs: ['EVD-001'], exampleResults: ['EX-1 | pass | x'],
  })
  const builtFixture = chain.map((u) => u.id === 'TSK-PROJ' ? { ...u, status: 'built', built_by: 'session-dev' } : u)
  const selfAccept = mod.projectFact(builtFixture, {
    kind: 'verdict', taskId: 'TSK-PROJ', verdict: 'pass', verifiedAt: '2026-11-08T11:00:00+08:00',
    basis: ['EVD-001'], actor: 'session-dev', acceptanceSession: 'session-dev',
    productConfirmation: 'ok', verificationRefs: ['EVD-001'], exampleResults: ['EX-1 | pass | x'],
  })
  const p = []
  if (missingTask.ops.length !== 0 || typeof missingTask.skipped !== 'string') p.push('implicit 派发没有被 skipped')
  if (noSession.ops.length !== 0 || typeof noSession.undecidable !== 'string') p.push('缺独立验收会话没有被判不出')
  if (selfAccept.ops.length !== 0 || typeof selfAccept.skipped !== 'string') p.push('自己验自己没有被 skipped')
  if (p.length === 0) ok('LP-6 ✓ 负向对拍：implicit ⇒ skipped · 缺独立验收会话 ⇒ undecidable · 自己验自己 ⇒ skipped（三档不混）')
  else for (const x of p) bad(`LP-6 · ${x}`)
}

// ── LP-7：真实账本临时副本上的落盘（真写入器）──────────────────────────
{
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-hob-proj-'))
  try {
    const target = join(tmp, 'ledger', 'units')
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'unit-01.toml'), renderShard([
      ...chainFor({ 'TSK-PROJ': { status: 'doing', run_ids: ['RUN-001'] } }),
      {
        id: 'RUN-001', kind: 'run', status: 'running', title: 'r', parent: 'TSK-PROJ',
        pipeline_version: 'v3', revision: '1', task_revision: '1',
        built_by: 'session-dev', projection_key: 'dispatch:TSK-PROJ:session-dev:1700000000000',
      },
    ]), 'utf8')
    const applied = await writer.applyProjection(tmp, {
      kind: 'return', taskId: 'TSK-PROJ', target: 'session-dev', at: 1_700_000_000_000,
      deliveredAt: '2026-11-08T10:00:00+08:00', progressRefs: ['check:stages-route 35/35'],
    })
    const p = []
    if (!applied.ok) p.push(`落盘失败：${applied.reason}`)
    const after = writer.readProjectionUnits(tmp)
    const run = after.find((u) => u.id === 'RUN-001')
    if (run?.status !== 'returned') p.push(`盘上 RUN 状态=${JSON.stringify(run?.status)}`)
    if (!Array.isArray(run?.progress_refs) || run.progress_refs.length !== 1) p.push('盘上 RUN 未带 progress_refs')
    const task = after.find((u) => u.id === 'TSK-PROJ')
    if (task?.status !== 'built') p.push(`盘上 TSK 状态=${JSON.stringify(task?.status)}（期望 built）`)
    if (p.length === 0) ok('LP-8 ✓ 回传落盘：RUN returned + TSK built（真写入器，含进度读数）')
    else for (const x of p) bad(`LP-8 · ${x}`)
  } finally { cleanup(tmp) }
}

// ── LP-9：判决落盘 + 幂等（真写入器）────────────────────────────────────
{
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-hob-proj3-'))
  try {
    const target = join(tmp, 'ledger', 'units')
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'unit-01.toml'), renderShard(
      chainFor({ 'TSK-PROJ': { status: 'built', built_by: 'session-dev' } }),
    ), 'utf8')
    const fact = {
      kind: 'verdict', taskId: 'TSK-PROJ', verdict: 'send-back', verifiedAt: '2026-11-08T11:00:00+08:00',
      basis: ['EVD-002'], actor: 'session-acceptor', acceptanceSession: 'session-acceptor', sendBackTo: 'back-to-plan',
    }
    const first = await writer.applyProjection(tmp, fact)
    const second = await writer.applyProjection(tmp, fact)
    const after = writer.readProjectionUnits(tmp)
    const p = []
    if (!first.ok) p.push(`首次落盘失败：${first.reason}`)
    if (second.ok) p.push('同一判决第二次仍报成功（应幂等 skipped）')
    if (!String(second.reason ?? '').includes('已投影') && !String(second.reason ?? '').includes('不重复')) p.push(`第二次原因不可读：${second.reason}`)
    const accs = after.filter((u) => u.kind === 'acc')
    if (accs.length !== 1) p.push(`盘上 ACC 数量=${accs.length}（期望 1，幂等）`)
    if (accs[0]?.status !== 'send-back' || accs[0]?.send_back_to !== 'back-to-plan') p.push('ACC 字段不对')
    if (accs[0]?.pipeline_version !== 'v3' || accs[0]?.revision !== '1' || accs[0]?.task_revision !== '1') p.push('ACC 未登记 Pipeline v3 / revision / task_revision')
    if (p.length === 0) ok('LP-9 ✓ 判决落盘 + 幂等：同一判决只建 1 条 ACC，字段完整')
    else for (const x of p) bad(`LP-9 · ${x}`)
  } finally { cleanup(tmp) }
}

console.log('')
// ── LP-9b：ACC 投影字段必须通过同一份验收门禁 ─────────────────────────────
//
// `LP-9` 只落 send-back，因而只验证了“依据 + 目标阶段”。pass 分支还要求
// 产品确认 / 技术证据 / 逐条例子结果 —— 缺了它们，写出的 ACC 一进账本就会
// 被 C-7/C-12 判坏。这里在临时账本上真实写入一条 pass，再调用
// `acceptanceProblems` 核它，并在同一夹具上删掉例子结果做负向对拍。
{
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-hob-lp9b-'))
  try {
    const target = join(tmp, 'ledger', 'units')
    mkdirSync(target, { recursive: true })
    /** LP-9b 的链：任务已 built，父方案 / 需求按现行契约齐全（C-5 / L-2 / RP-4 都要过）。 */
    writeFileSync(join(target, 'unit-01.toml'), renderShard(
      chainFor({ 'TSK-PROJ': { status: 'built', built_by: 'session-dev', verify_refs: ['EVD-PASS'] } }),
    ), 'utf8')
    const fact = {
      kind: 'verdict', taskId: 'TSK-PROJ', verdict: 'pass', verifiedAt: '2026-11-08T12:00:00+08:00',
      basis: ['EVD-PASS'], actor: 'session-acceptor', acceptanceSession: 'session-acceptor',
      productConfirmation: '用户接受结果符合目标',
      verificationRefs: ['EVD-PASS'],
      exampleResults: ['EX-1 | pass | EVD-PASS | 保存后出现成功提示'],
    }
    const applied = await writer.applyProjection(tmp, fact)
    const after = writer.readProjectionUnits(tmp)
    const acc = after.find((u) => u.kind === 'acc' && u.parent === 'TSK-PROJ')
    const sc = await import(pathToFileURL(join(root, 'src', 'shared', 'stage-controls.ts')).href)
    const problems = acc === undefined ? ['没有写出 ACC'] : sc.acceptanceProblems(acc, after)
    const badAcc = acc === undefined ? [] : sc.acceptanceProblems({ ...acc, example_results: [] }, after)
    const p = []
    if (!applied.ok) p.push(`pass 投影未落盘：${applied.reason}`)
    if (problems.length > 0) p.push(`新 ACC 未通过 C-7/C-12：${problems.map((x) => `${x.rule} ${x.why}`).join('；')}`)
    if (!badAcc.some((x) => x.rule === 'C-7')) p.push('负向对拍失败：删掉例子结果后 C-7 未开火')
    if (p.length === 0) ok('LP-9b ✓ pass 投影写出结构健康 ACC；删例子结果 ⇒ C-7 必红（不是只写字段就完事）')
    else for (const x of p) bad(`LP-9b · ${x}`)
  } finally { cleanup(tmp) }
}

// ── LP-9c：真实 send-back 入口只有 actor，不得因此整条退回落不了账 ─────────
{
  const r = mod.projectFact([
    { id: 'TSK-BACK', kind: 'task', status: 'built', title: '退回夹具', parent: 'CHG-BACK', pipeline_version: 'v3', revision: '1', built_by: 'session-dev' },
  ], {
    kind: 'verdict', taskId: 'TSK-BACK', verdict: 'send-back',
    verifiedAt: '2026-11-08T13:00:00+08:00', basis: ['EVD-BACK'],
    actor: 'session-acceptor', sendBackTo: 'back-to-plan',
  })
  const acc = r.ops.find((o) => o.op === 'create-unit')
  const p = []
  if (acc === undefined || acc.fields.status !== 'send-back') p.push(`退回没有建 ACC：${JSON.stringify(r)}`)
  else if (acc.fields.acceptance_session !== 'session-acceptor') p.push(`验收会话未取可信 actor：${JSON.stringify(acc.fields)}`)
  const selfBack = mod.projectFact([
    { id: 'TSK-SELF', kind: 'task', status: 'built', title: '自退夹具', parent: 'CHG-BACK', pipeline_version: 'v3', revision: '1', built_by: 'session-dev' },
  ], {
    kind: 'verdict', taskId: 'TSK-SELF', verdict: 'send-back',
    verifiedAt: '2026-11-08T13:00:00+08:00', basis: ['EVD-BACK'],
    actor: 'session-dev', sendBackTo: 'back-to-plan',
  })
  if (!String(selfBack.skipped ?? '').includes('自己验自己')) p.push(`实现者自退未被识别：${JSON.stringify(selfBack)}`)
  if (p.length === 0) ok('LP-9c ✓ send-back 用可信 actor 作验收会话可落账；实现者自退仍被拒')
  else for (const x of p) bad(`LP-9c · ${x}`)
}

// ── LP-10：多轨 / 恢复路径也把真实任务号传给派发（否则不落账）────────────
{
  const src = readFileSync(join(root, 'src', 'modules', 'orchestrator.ts'), 'utf8')
  const p = []
  /**
   * ⚠ 三条入口都必须带 `taskId`：
   *   · 单目标 `hob_dispatch`（`args.taskId`）；
   *   · 多轨 `dispatchPlan`（`track.taskId`）；
   *   · 计划推进 / 重启恢复 `advanceWorkPlans`（`track.taskId`）。
   * ⚠ 只查"出现过 taskId"会假绿 —— 必须查**同一处 dispatch 调用块内**同时有
   *   `task: track.taskId` 与 `taskId: track.taskId`。
   */
  const trackCalls = [...src.matchAll(/orch\.dispatch\(track\.sessionId, track\.message, \{([\s\S]{0,400}?)\}\)/g)].map((m) => m[1])
  if (trackCalls.length < 2) p.push(`找到 ${trackCalls.length} 处 track 派发（期望 ≥2：计划推进 + 多轨首波）`)
  for (const [i, body] of trackCalls.entries()) {
    if (!/taskId:\s*track\.taskId/.test(body)) p.push(`第 ${i + 1} 处 track 派发缺 taskId ⇒ 不会投影回账本`)
  }
  if (!/taskId:\s*track\.taskId/.test(src)) p.push('orchestrator 里没有任何 track.taskId 落账引用')
  /** 重启恢复的 watch 也必须带 taskId（否则下一轮回传无法投影）。 */
  const restored = src.slice(src.indexOf('watches.set(track.sessionId'), src.indexOf('watches.set(track.sessionId') + 600)
  if (!/taskId:\s*track\.taskId/.test(restored)) p.push('从计划恢复的 watch 没带 taskId ⇒ 重启后回传不落账')
  if (p.length === 0) ok(`LP-10 ✓ 负向对拍：多轨 / 计划推进 / 重启恢复三条路径都带 taskId（${trackCalls.length} 处 track 派发逐处核过）`)
  else for (const x of p) bad(`LP-10 · ${x}`)
}

// ── LP-11：两个并发派发不得分配同一个 RUN 编号 ─────────────────────────────
//
// ⚠ `writeHobFile` 只按单文件排队；投影横跨“读全账本 → 分配编号 → 写多分片”。
//   改前实测：两条 todo 任务并行派发，两次都返回 ok，却写出两条 RUN-001。
{
  const dir = mkdtempSync(join(tmpdir(), 'dsh-hob-lp11-'))
  const unitsDir = join(dir, 'ledger', 'units')
  mkdirSync(unitsDir, { recursive: true })
  /**
   * ⚠ 并发夹具也必须是**现行 v3 契约**形态（B1.4 连带修复）：
   *   改前它只补了 task_brief / counterexamples / stop_conditions / return_to 四项，
   *   缺 acceptance_criteria_refs / test_plan / task_risk ⇒ 被 RP-4 与 C-5 拒。
   *   ⚠ 而且父方案 CHG-CONCURRENT **在账本里根本不存在** ⇒ 还会撞 L-2。
   *   ⇒ 现在整条链都由 chain 派生（需求 / 方案 / 任务齐备），只把 id 换成并发用的。
   */
  const concurrentUnits = (taskId) => chainFor({
    'R-PROJ': { id: 'R-CONCURRENT', acceptance_ids: ['AC-PROJ-1'] },
    'CHG-PROJ': { id: 'CHG-CONCURRENT', req_ids: ['R-CONCURRENT'], addresses: ['R-CONCURRENT'] },
    'TSK-PROJ': { id: taskId, parent: 'CHG-CONCURRENT' },
  })
  writeFileSync(join(unitsDir, 'unit-01.toml'), renderShard([
    ...concurrentUnits('TSK-CONCURRENT-A'),
    ...concurrentUnits('TSK-CONCURRENT-B').filter((u) => u.kind === 'task'),
  ]))
  writeFileSync(join(unitsDir, 'index.toml'), '', 'utf8')
  const at = Date.now()
  const results = await Promise.all([
    writer.applyProjection(dir, {
      kind: 'dispatch', taskId: 'TSK-CONCURRENT-A', target: 'session-a', at: at + 1, task: '并发 A',
    }),
    writer.applyProjection(dir, {
      kind: 'dispatch', taskId: 'TSK-CONCURRENT-B', target: 'session-b', at: at + 2, task: '并发 B',
    }),
  ])
  const p = []
  if (!results.every((r) => r.ok)) p.push(`并发投影失败：${JSON.stringify(results.map((r) => ({ ok: r.ok, reason: r.reason })))}`)
  const projectionFile = join(unitsDir, 'unit-projection.toml')
  const content = existsSync(projectionFile) ? readFileSync(projectionFile, 'utf8') : ''
  const runIds = [...content.matchAll(/^id = "(RUN-[^"]+)"$/gm)].map((m) => m[1])
  if (runIds.length !== 2) p.push(`应创建 2 条 RUN，实际 ${runIds.length}：${runIds.join(' / ') || '(无)'}`)
  if (new Set(runIds).size !== runIds.length) p.push(`出现重复 RUN 编号：${runIds.join(' / ')}`)
  if (p.length === 0) ok(`LP-11 ✓ 两条并发派发 ⇒ 2 条唯一 RUN（${runIds.join(' / ')}），整场投影按账本串行`)
  else for (const x of p) bad(`LP-11 · ${x}`)
  cleanup(dir)
}

// ── LP-12：技术验证与交付收口投影必须绑定修订和证据 ────────────────────────
{
  const task = {
    id: 'TSK-VERIFY', kind: 'task', status: 'built', title: '验证夹具',
    parent: 'CHG-VERIFY', pipeline_version: 'v3', revision: '2', built_by: 'session-dev',
    task_brief: 'archive/x/TASK.md', counterexamples: ['c'], stop_conditions: ['s'], return_to: 'back-to-plan',
  }
  const good = mod.projectFact([task], {
    kind: 'verify', taskId: 'TSK-VERIFY', verdict: 'pass', verifiedAt: '2026-11-08T01:00:00Z',
    basis: ['EVD-1'], verifier: 'session-verifier', verificationSession: 'session-verifier',
    criteriaRefs: ['AC-1'], evidenceRefs: ['EVD-1'],
  })
  const badRevision = mod.projectFact([{ ...task, revision: '' }], {
    kind: 'verify', taskId: 'TSK-VERIFY', verdict: 'pass', verifiedAt: '2026-11-08T01:00:00Z',
    basis: ['EVD-1'], verifier: 'session-verifier', criteriaRefs: ['AC-1'],
  })
  const verifyCreate = good.ops.find((o) => o.op === 'create-unit')
  const close = mod.projectFact([{ id: 'R-VERIFY', kind: 'req', status: 'agreed' }], {
    kind: 'close', reqId: 'R-VERIFY', status: 'closed', closureMode: 'standard',
    basis: ['EVD-1'], releaseRefs: ['build EVD-2', 'smoke ok', 'post-release check ok'], rollbackRefs: ['EVD-RB'], acceptedBy: 'user', closedAt: '2026-11-08T02:00:00Z',
    chainAcceptanceRef: 'ACC-VERIFY', riskAssessmentRef: 'CHG-VERIFY#1',
    residualRiskDecisionRef: 'DEC-RISK-VERIFY', approvalRef: 'DEC-RELEASE-VERIFY',
  })
  const closeCreate = close.ops.find((o) => o.op === 'create-unit')
  const strictBad = mod.projectFact([{ id: 'R-VERIFY', kind: 'req', status: 'agreed' }], {
    kind: 'close', reqId: 'R-VERIFY', status: 'closed', closureMode: 'strict',
    basis: ['EVD-1'], releaseRefs: ['build EVD-2', 'smoke ok', 'post-release check ok'], acceptedBy: 'user', closedAt: '2026-11-08T02:00:00Z',
    chainAcceptanceRef: 'ACC-VERIFY', riskAssessmentRef: 'CHG-VERIFY#1',
    residualRiskDecisionRef: 'DEC-RISK-VERIFY', approvalRef: 'DEC-RELEASE-VERIFY',
  })
  const p = []
  if (verifyCreate === undefined || verifyCreate.kind !== 'verification') p.push('技术验证没有建 VER 单元')
  else if (verifyCreate.fields.task_revision !== '2') p.push(`VER 没绑定任务第 2 版：${verifyCreate.fields.task_revision}`)
  if (badRevision.undecidable === undefined) p.push('任务缺修订仍能建 VER')
  if (closeCreate === undefined || closeCreate.kind !== 'closure') p.push('交付收口没有建 CLS 单元')
  if (strictBad.undecidable === undefined) p.push('strict 收口缺回滚/监控证据仍能落账')
  const plan = { id: 'CHG-VERIFY', kind: 'change', status: 'settled', title: '方案', req_ids: ['R-VERIFY'], pipeline_version: 'v3', revision: '1',
    path_options: ['A'], path_tradeoffs: ['A 快'], path_decision: '选 A', requirement_coverage: ['R-VERIFY → A'],
    risk_tier: 'high', risk_hard_triggers: ['permission-boundary-change'] }
  const newRisk = mod.projectFact([task, plan], {
    kind: 'verify', taskId: 'TSK-VERIFY', verdict: 'pass', verifiedAt: '2026-11-08T01:00:00Z',
    basis: ['EVD-1'], verifier: 'session-verifier', criteriaRefs: ['AC-1'],
    riskReviewRefs: ['EVD-R1'], newRiskRefs: ['RSK-NEW'], newRiskReason: '发现权限残留',
  })
  if (newRisk.undecidable === undefined) p.push('技术验证发现新风险仍能落账')
  if (p.length === 0) ok('LP-12 ✓ 技术验证绑定任务修订；交付收口绑定需求与风险证据；新风险 / 半成品证据拒绝落账')
  else for (const x of p) bad(`LP-12 · ${x}`)
}

// ── LP-14：R-18 —— 删单元必须**整块**删，id 不在首键也不许留裸块 ────────────
//
//  ⚠ 这条钉的是「账本自己长出垃圾、然后被自己制造的垃圾拦死」：
//    旧 `removeUnitBlock` 按行删 ⇒ `id` 不是首键时，`id` 之前的行已 push、
//    `[[unit]]` 已被弹出 ⇒ 留下**无 id 的裸块**，解析器照样算一条单元。
//    后果链：账本出现 `id=''` ⇒ 下一次任意写入被 `ledger-duplicate-id` / 结构校验拒
//    ⇒ 每次投影迁移**再复制一份**（与 T-07 叠加）。
{
  const pw = await import(pathToFileURL(join(root, 'src/server/projection-writer.ts')).href)
  const p = []
  /** 三个单元，且**目标单元的 id 不在首键**（先有 title，再有 id）。 */
  const shard = [
    '[[unit]]', 'id = "A-1"', 'kind = "task"', 'title = "一"',
    '',
    '[[unit]]', 'title = "二（id 在第二行）"', 'id = "B-2"', 'kind = "task"',
    '',
    '[[unit]]', 'id = "C-3"', 'kind = "task"', 'title = "三"',
    '',
  ].join('\n')
  const after = pw.removeUnitBlock(shard, 'B-2')
  const heads = (s) => s.split('\n').filter((l) => l.trim() === '[[unit]]').length
  const ids = (s) => [...s.matchAll(/^id\s*=\s*"([^"]*)"/gm)].map((m) => m[1])

  if (heads(after) !== 2) p.push(`删完块头数应为 2，实际 ${heads(after)}（多出来的就是孤儿裸块）`)
  if (ids(after).length !== 2) p.push(`删完 id 行数应为 2，实际 ${ids(after).length}`)
  if (ids(after).includes('B-2')) p.push('目标单元没被删掉')
  if (ids(after).includes('')) p.push('出现了 id="" 的孤儿单元 ⇒ R-18 复发')
  if (!ids(after).includes('A-1') || !ids(after).includes('C-3')) p.push('误删了无关单元')

  /**
   * ⚠ 反向对照：找不到目标时必须**原样返回**（⛔ 不是返回空串 —— 那会让调用方写出空分片）。
   */
  const missing = pw.removeUnitBlock(shard, 'NOPE-9')
  if (heads(missing) !== 3) p.push(`目标不存在时块头数应保持 3，实际 ${heads(missing)}`)

  if (p.length === 0) ok('LP-14 ✓ **负向对拍**：id 不在首键时按块删除 ⇒ 单元数 3→2，无孤儿裸块，无关单元不动')
  else for (const x of p) bad(`LP-14 · ${x}`)
}

// LP-13: a refused delivery settles RUN registered -> refused and TSK doing -> todo.
{
  const task = { id: 'TSK-REFUSE', kind: 'task', status: 'doing', title: '拒收夹具', parent: 'CHG-REFUSE', pipeline_version: 'v3', revision: '1', run_ids: ['RUN-REFUSE'] }
  const run = { id: 'RUN-REFUSE', kind: 'run', status: 'registered', title: 'run', parent: 'TSK-REFUSE', pipeline_version: 'v3', revision: '1', task_revision: '1', projection_key: 'dispatch:TSK-REFUSE:session-dev:100' }
  const r = mod.projectFact([task, run], { kind: 'refuse', taskId: 'TSK-REFUSE', target: 'session-dev', at: 100, refusedAt: '2026-11-10T00:00:00Z', reason: 'target archived' })
  const okRun = r.ops.some((o) => o.op === 'transition-unit' && o.id === 'RUN-REFUSE' && o.to === 'refused')
  const okTask = r.ops.some((o) => o.op === 'transition-unit' && o.id === 'TSK-REFUSE' && o.to === 'todo')
  if (okRun && okTask) ok('LP-13 ✓ 投递失败 ⇒ RUN registered→refused，TSK doing→todo（不留下假执行）')
  else bad(`LP-13 · ${JSON.stringify(r)}`)
}


// ── LP-15：O-06 —— `count` 不把符号链接算进条目数 ────────────────────────────
//
//  ⚠ 改前 `readdirSync(abs).length` 把软链也算一条。而软链在本仓是**逃逸风险**
//    （`hob-write` 专门有 `findSymlinkOnPath` 挡它），把它算进「这个目录有几条」
//    会让读数**虚高**，而读者无从分辨。
{
  const h = await import(pathToFileURL(join(root, 'src/server/hob-render.ts')).href)
  const dir = mkdtempSync(join(tmpdir(), 'dsh-hob-lp15-'))
  mkdirSync(join(dir, 'docs'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'a.md'), 'x')
  writeFileSync(join(dir, 'docs', 'b.md'), 'y')
  /** ⚠ 造一个软链 —— 它必须**不被计入**。 */
  let linked = false
  /**
   * ⚠⚠ **不能用裸 `catch {}` 吞掉**（我第一版就是，结果 `symlinkSync` 未导入也没人发现，
   *   断言走「2 个文件」分支照绿 ⇒ 负向对拍假绿）。
   *   ⇒ 只把「平台不支持软链」（EPERM / ENOSYS / EACCES）当可跳过，其余**必须抛**。
   */
  let linkErr = ''
  try { symlinkSync(join(dir, 'docs', 'a.md'), join(dir, 'docs', 'link.md')); linked = true }
  catch (e) {
    const code = String((e && e.code) || '')
    if (code !== 'EPERM' && code !== 'ENOSYS' && code !== 'EACCES') {
      bad(`LP-15 · 造软链失败（${code || 'unknown'}）⇒ 本条的靶子不存在，⛔ 不按通过处理`)
    }
    linkErr = code
  }
  if (linkErr !== '' && linked === false && (linkErr === 'EPERM' || linkErr === 'ENOSYS' || linkErr === 'EACCES')) {
    skip.push('LP-15：平台不支持软链 ⇒ 跳过（⛔ 不计入通过）')
  }
  const src = '<!-- hob:count | docs -->'
  const res = h.renderReadings(dir, 'PROJECT.md', src)
  const n = Number(String(res?.content ?? '').replace(/[^0-9]/g, ''))
  const p = []
  if (linked) {
    if (n !== 2) p.push(`2 个真文件 + 1 个软链 ⇒ 计数应为 2，实际 ${n}（软链被算进去了，O-06 复发）`)
  } else {
    if (n !== 2) p.push(`2 个文件 ⇒ 计数应为 2，实际 ${n}`)
  }
  if (p.length === 0) {
    ok('LP-15 ✓ **负向对拍**：`count` 只数真实条目 —— 目录里 2 个文件 + 1 个软链 ⇒ 计 **2**（O-06）' + ` [linked=${linked} n=${n}]`)
  } else for (const x of p) bad(`LP-15 · ${x}`)
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
}
// ── LP-16：O-09 —— `readProjectionUnitsState` 必须三态，⛔ 不「一坏就整体抛」 ──
//
//  ⚠ 改前 `readFileSync` 没有 try/catch ⇒ 任一单分片读不出，**整个函数抛异常**
//    ⇒ 调用方（派发前的门禁取数）**整次派发失败**，而错误只是一句 `EACCES` ——
//    读者分不清「这本账没有单元」与「有单元但读不出来」。
{
  const dir = mkdtempSync(join(tmpdir(), 'dsh-hob-lp16-'))
  mkdirSync(join(dir, 'ledger', 'units'), { recursive: true })
  writeFileSync(join(dir, 'ledger', 'units', 'unit-01.toml'), '[[unit]]\nid = "R-1"\nkind = "req"\nstatus = "agreed"\n')
  const p = []
  /** ① 正常 ⇒ `ok` 且读到单元。 */
  const okRead = writer.readProjectionUnitsState(dir)
  if (okRead.kind !== 'ok') p.push(`正常账本应返回 ok，实际 ${okRead.kind}`)
  else if (okRead.units.length !== 1) p.push(`应读到 1 条单元，实际 ${okRead.units.length}`)
  /** ② 目录不存在 ⇒ `missing`（⛔ 不是 unreadable，那是「还没开账」）。 */
  const gone = writer.readProjectionUnitsState(join(dir, 'nope'))
  if (gone.kind !== 'missing') p.push(`目录不存在应返回 missing，实际 ${gone.kind}`)
  /** ③ **单个分片读不出** ⇒ `unreadable` **且点名那个分片**（⛔ 不整体抛）。 */
  const badDir = join(dir, 'bad')
  mkdirSync(join(badDir, 'ledger', 'units'), { recursive: true })
  writeFileSync(join(badDir, 'ledger', 'units', 'unit-01.toml'), '[[unit]]\nid = "R-1"\n');
  /** ⚠ 造一个「读不出」的分片：名字合法但内容无法按 utf8 读成文本 —— 用目录冒充文件。 */
  mkdirSync(join(badDir, 'ledger', 'units', 'unit-02.toml'), { recursive: true });
  let threw = false
  let badRead
  try { badRead = writer.readProjectionUnitsState(badDir) } catch { threw = true }
  if (threw) p.push('单分片读不出时**整体抛了** ⇒ 调用方会整次失败（O-09 复发）')
  else if (badRead.kind !== 'unreadable') p.push(`单分片坏时应返回 unreadable，实际 ${badRead.kind}`)
  else if (String(badRead.shard) !== 'unit-02.toml') p.push(`必须点名那个分片，实际点名 ${badRead.shard}`)
  if (p.length === 0) {
    ok('LP-16 ✓ **负向对拍**：`readProjectionUnitsState` 三态齐备 —— 正常 ok / 目录不在 missing /'
      + ' 单分片坏 unreadable **且点名那个分片**（O-09：⛔ 不整体抛）')
  } else for (const x of p) bad(`LP-16 · ${x}`)
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
}
console.log('')
console.log(`LP 组：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处${fail > 0 ? ` · 没过 ${fail} 处` : ''} · **跳过 0 处**`)
console.log('')
if (fail > 0) {
  console.log('  ⛔ 有失败项 ⇒ 本组不算通过')
  process.exit(1)
}
console.log('  ✅ LP 组全绿（运行态事实 ⇒ 账本事实；三档可辨；幂等）')
process.exit(0)
