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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

const units = gen.readUnits()
const tasks = units.filter((u) => u.kind === 'task')
const T = tasks.find((u) => String(u.status) === 'built')
const todoTask = { id: 'TSK-PROJ', kind: 'task', title: '投影夹具任务', parent: 'CHG-PROJ', status: 'todo',
  task_brief: 'archive/x/TASK.md', counterexamples: ['空输入不崩溃'], stop_conditions: ['冲突即停'], return_to: 'back-to-plan' }
const chain = [
  { id: 'R-PROJ', kind: 'req', title: '投影夹具需求', status: 'agreed', clarify_examples: ['例子'], acceptance_criteria: ['点保存后出现成功提示'] },
  { id: 'CHG-PROJ', kind: 'change', title: '投影夹具方案', parent: 'R-PROJ', req_ids: ['R-PROJ'], status: 'settled',
    path_options: ['A', 'B'], path_tradeoffs: ['A 快', 'B 稳'], path_decision: '选 A', requirement_coverage: ['R-PROJ → x'], addresses: ['R-PROJ'] },
  todoTask,
]

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
    writeFileSync(join(target, 'unit-01.toml'),
      '[[unit]]\nid = "R-PROJ"\nkind = "req"\nstatus = "agreed"\ntitle = "t"\n'
      + '[[unit]]\nid = "CHG-PROJ"\nkind = "change"\nstatus = "settled"\ntitle = "c"\naddresses = ["R-PROJ"]\n'
      + '[[unit]]\nid = "TSK-PROJ"\nkind = "task"\nstatus = "todo"\ntitle = "t"\nparent = "CHG-PROJ"\n',
      'utf8')
    const applied = await writer.applyProjection(tmp, {
      kind: 'dispatch', taskId: 'TSK-PROJ', target: 'session-dev', owner: 'session-hob', at: 1_700_000_000_000,
    })
    const p = []
    if (!applied.ok) p.push(`落盘失败：${applied.reason}`)
    if (applied.applied !== 3) p.push(`落盘操作数=${applied.applied}（期望 3）`)
    const after = writer.readProjectionUnits(tmp)
    if (!after.some((u) => u.kind === 'run' && u.parent === 'TSK-PROJ' && u.status === 'registered')) p.push('盘上没有 RUN registered')
    const task = after.find((u) => u.id === 'TSK-PROJ')
    if (task?.status !== 'doing') p.push(`盘上 TSK 状态=${JSON.stringify(task?.status)}（期望 doing）`)
    if (!Array.isArray(task?.run_ids) || task.run_ids.length !== 1) p.push('盘上 TSK 未关联 run_ids')
    if (p.length === 0) ok(`LP-7 ✓ 真写入器落盘：RUN registered + TSK doing + run_ids 关联（${applied.files.join(' + ')}）`)
    else for (const x of p) bad(`LP-7 · ${x}`)
  } finally { cleanup(tmp) }
}

// ── LP-8：回传落盘（真写入器）⇒ RUN returned + TSK built ────────────────
{
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-hob-proj2-'))
  try {
    const target = join(tmp, 'ledger', 'units')
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'unit-01.toml'),
      '[[unit]]\nid = "R-PROJ"\nkind = "req"\nstatus = "agreed"\ntitle = "t"\n'
      + '[[unit]]\nid = "CHG-PROJ"\nkind = "change"\nstatus = "settled"\ntitle = "c"\naddresses = ["R-PROJ"]\n'
      + '[[unit]]\nid = "TSK-PROJ"\nkind = "task"\nstatus = "doing"\ntitle = "t"\nparent = "CHG-PROJ"\nrun_ids = ["RUN-001"]\n'
      + '[[unit]]\nid = "RUN-001"\nkind = "run"\nstatus = "running"\ntitle = "r"\nparent = "TSK-PROJ"\nbuilt_by = "session-dev"\nprojection_key = "dispatch:TSK-PROJ:session-dev:1700000000000"\n',
      'utf8')
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
    writeFileSync(join(target, 'unit-01.toml'),
      '[[unit]]\nid = "TSK-PROJ"\nkind = "task"\nstatus = "built"\ntitle = "t"\nparent = "CHG-PROJ"\nbuilt_by = "session-dev"\n',
      'utf8')
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
    writeFileSync(join(target, 'unit-01.toml'), [
      '[[unit]]',
      'id = "TSK-PASS"',
      'kind = "task"',
      'status = "built"',
      'title = "验收投影夹具"',
      'parent = "CHG-PASS"',
      'built_by = "session-dev"',
      'verify_refs = ["EVD-PASS"]',
      '',
    ].join('\n'), 'utf8')
    const fact = {
      kind: 'verdict', taskId: 'TSK-PASS', verdict: 'pass', verifiedAt: '2026-11-08T12:00:00+08:00',
      basis: ['EVD-PASS'], actor: 'session-acceptor', acceptanceSession: 'session-acceptor',
      productConfirmation: '用户接受结果符合目标',
      verificationRefs: ['EVD-PASS'],
      exampleResults: ['EX-1 | pass | EVD-PASS | 保存后出现成功提示'],
    }
    const applied = await writer.applyProjection(tmp, fact)
    const after = writer.readProjectionUnits(tmp)
    const acc = after.find((u) => u.kind === 'acc' && u.parent === 'TSK-PASS')
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
    { id: 'TSK-BACK', kind: 'task', status: 'built', title: '退回夹具', parent: 'CHG-BACK', built_by: 'session-dev' },
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
    { id: 'TSK-SELF', kind: 'task', status: 'built', title: '自退夹具', parent: 'CHG-BACK', built_by: 'session-dev' },
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
  const task = (id) => [
    '[[unit]]',
    `id = "${id}"`,
    'kind = "task"',
    'status = "todo"',
    `title = "并发夹具 ${id}"`,
    'parent = "CHG-CONCURRENT"',
    'task_brief = "archive/x/TASK.md"',
    'counterexamples = ["c"]',
    'stop_conditions = ["s"]',
    'return_to = "back-to-plan"',
    '',
  ].join('\n')
  writeFileSync(join(unitsDir, 'unit-01.toml'), task('TSK-CONCURRENT-A') + '\n' + task('TSK-CONCURRENT-B'))
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
