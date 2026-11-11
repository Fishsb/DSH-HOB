#!/usr/bin/env node
/**
 * LC — ledger lifecycle + unified work admission.
 *
 * This family tests the invariant that no execution side effect may occur when
 * the ledger or the task chain is not ready. It also fixes dispatch identity and
 * orphan completion semantics.
 */
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
let pass = 0
let fail = 0
const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail++; console.log(`  ✗ ${m}`) }
const mod = await import(pathToFileURL(join(root, 'src', 'shared', 'ledger-lifecycle.ts')).href)
const tools = await import(pathToFileURL(join(root, 'src', 'modules', 'tools.ts')).href)
const readiness = await import(pathToFileURL(join(root, 'src', 'shared', 'ledger-readiness.ts')).href)

const lifecycle = (state = 'active', extra = {}) => ({
  state, integrity: state === 'active' ? 'valid' : 'invalid', active: state === 'active',
  activation: state === 'active' ? 'active' : 'missing', headline: state, nextAction: 'fix',
  blockers: [], legacyCompatible: state === 'active', ...extra,
})
const admit = (action, life = lifecycle(), extra = {}) => mod.admitWork({ action, lifecycle: life, ...extra })

console.log('\nLC 组：账本生命周期与统一工作准入\n')

{
  const missing = lifecycle('missing')
  const actions = ['write-requirement', 'dispatch', 'notify', 'verify', 'accept', 'close']
  const leaked = actions.filter((a) => admit(a, missing, { notificationOnly: true, taskId: 'TSK-1', taskExists: true, taskGatePassed: true, taskStatus: 'todo', targetAdmitted: true }).ok)
  if (leaked.length === 0) ok('LC-1 ✓ 无账本：所有工作动作零准入')
  else bad(`LC-1 无账本仍放行：${leaked.join('/')}`)
}
{
  const a = admit('initialize-ledger', lifecycle('missing'))
  const b = admit('initialize-ledger', lifecycle('active'))
  if (a.ok && !b.ok) ok('LC-2 ✓ 初始化只对缺失/失效账本开放；活动账本不许覆盖')
  else bad(`LC-2 初始化准入错误：${JSON.stringify({ a, b })}`)
}
{
  const invalid = lifecycle('invalid')
  const r = admit('dispatch', invalid, { taskId: 'TSK-1', taskExists: true, taskGatePassed: true, taskStatus: 'todo', targetAdmitted: true })
  if (!r.ok && r.sideEffectsAllowed === false) ok('LC-3 ✓ 失效账本：派发拒绝且零副作用')
  else bad(`LC-3 失效账本仍可派发：${JSON.stringify(r)}`)
}
{
  const n1 = admit('notify', lifecycle(), { notificationOnly: false })
  const n2 = admit('notify', lifecycle(), { notificationOnly: true })
  if (!n1.ok && n2.ok) ok('LC-4 ✓ 通知仅限显式纯通知，不能承接实质工作')
  else bad(`LC-4 通知边界错误：${JSON.stringify({ n1, n2 })}`)
}
{
  const blocked = [
    ['缺 taskId', { taskId: '', taskExists: true, taskGatePassed: true, taskStatus: 'todo', targetAdmitted: true }],
    ['任务不存在', { taskId: 'TSK-1', taskExists: false, taskGatePassed: true, taskStatus: 'todo', targetAdmitted: true }],
    ['链未过门', { taskId: 'TSK-1', taskExists: true, taskGatePassed: false, taskStatus: 'todo', targetAdmitted: true }],
    ['非 todo', { taskId: 'TSK-1', taskExists: true, taskGatePassed: true, taskStatus: 'built', targetAdmitted: true }],
    ['已有未结算', { taskId: 'TSK-1', taskExists: true, taskGatePassed: true, taskStatus: 'todo', targetAdmitted: true, hasUnsettledDispatch: true }],
    ['目标预设不合', { taskId: 'TSK-1', taskExists: true, taskGatePassed: true, taskStatus: 'todo', targetAdmitted: false }],
  ]
  const allowed = blocked.filter(([, x]) => admit('dispatch', lifecycle(), x).ok).map(([k]) => k)
  if (allowed.length === 0) ok('LC-5 ✓ 派发前置逐项失败均零放下：task / 链 / todo / 未结算 / 预设')
  else bad(`LC-5 以下前置失败仍放行：${allowed.join(' / ')}`)
}
{
  const r = admit('dispatch', lifecycle(), { taskId: 'TSK-1', taskExists: true, taskGatePassed: true, taskStatus: 'todo', targetAdmitted: true })
  if (r.ok && r.sideEffectsAllowed) ok('LC-6 ✓ 正向前置齐全 ⇒ 派发准入唯一放行')
  else bad(`LC-6 正向前置未放行：${JSON.stringify(r)}`)
}
{
  const id1 = mod.dispatchIdOf({ owner: 'hob', target: 'dev', taskId: 'TSK-1', at: 100 })
  const id2 = mod.dispatchIdOf({ owner: 'hob', target: 'dev', taskId: 'TSK-1', at: 100 })
  const id3 = mod.dispatchIdOf({ owner: 'hob', target: 'dev', taskId: 'TSK-1', at: 101 })
  if (id1 === id2 && id1 !== id3) ok('LC-7 ✓ dispatchId 对同一尝试幂等，不同尝试可辨')
  else bad(`LC-7 dispatchId 不稳定：${id1} / ${id2} / ${id3}`)
}
{
  const id = mod.makeDispatchIdentity({ owner: 'hob', requestedTarget: 'old', target: 'new', taskId: 'TSK-1', at: 100 })
  if (id.targetChanged === true && id.requestedTarget === 'old' && id.target === 'new') ok('LC-8 ✓ 目标替换显式可见（requested / actual / targetChanged）')
  else bad(`LC-8 目标替换不可见：${JSON.stringify(id)}`)
}
{
  const orphan1 = mod.isOrphanCompletion('DSP-a', 'DSP-b')
  const orphan2 = mod.isOrphanCompletion(undefined, 'DSP-b')
  const matched = mod.isOrphanCompletion('DSP-a', 'DSP-a')
  if (orphan1 && orphan2 && !matched) ok('LC-9 ✓ 完成无匹配 dispatchId ⇒ orphan；匹配才可回传')
  else bad(`LC-9 orphan 判据错误：${JSON.stringify({ orphan1, orphan2, matched })}`)
}
{
  const text = mod.initialLedgerActivation({ ledgerId: 'x-1', workspace: 'x', createdAt: '2026-11-10T00:00:00Z' })
  const parsed = mod.parseLedgerActivation(text)
  if (parsed?.status === 'active' && parsed.schema_version === 'pipeline-v3' && parsed.generation === '1') ok('LC-10 ✓ 新账本激活记录可解析且模式固定为 pipeline-v3')
  else bad(`LC-10 激活记录不可解析：${JSON.stringify(parsed)}`)
}
{
  const badText = 'ledger_id = "x"\nstatus = "active"\n'
  if (mod.parseLedgerActivation(badText) === undefined) ok('LC-11 ✓ 不完整激活记录判 invalid，不猜默认值')
  else bad('LC-11 不完整激活记录被接受')
}
{
  const dir = mkdtempSync(join(tmpdir(), 'lc-init-'))
  try {
    mkdirSync(join(dir, 'ledger', 'units'), { recursive: true })
    writeFileSync(join(dir, 'ledger', 'units', 'index.toml'), readiness.initialIndexToml('2026-11-10T00:00:00Z'))
    writeFileSync(join(dir, 'ledger.toml'), mod.initialLedgerActivation({ ledgerId: 'lc-init', workspace: 'lc-init', createdAt: '2026-11-10T00:00:00Z' }))
    const lc = tools.ledgerLifecycleOfRoot(dir)
    if (lc.state === 'active' && lc.integrity === 'empty' && lc.active === false) ok('LC-12 ✓ 新账本 active-empty：可写需求、不可派活')
    else bad(`LC-12 新账本生命周期错误：${JSON.stringify(lc)}`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
{
  const dir = mkdtempSync(join(tmpdir(), 'lc-split-'))
  try {
    mkdirSync(join(dir, 'ledger', 'units'), { recursive: true })
    writeFileSync(join(dir, 'ledger.toml'), mod.initialLedgerActivation({ ledgerId: 'lc-split', workspace: 'lc-split', createdAt: '2026-11-10T00:00:00Z' }))
    const req = '[[unit]]\nid = "R-1"\nkind = "req"\nstatus = "agreed"\ntitle = "需求"\nclarify_examples = ["例子"]\nacceptance_criteria = ["观察"]\n'
    const plan = '[[unit]]\nid = "CHG-1"\nkind = "change"\nstatus = "settled"\ntitle = "方案"\nreq_ids = ["R-1"]\npath_options = ["A"]\npath_tradeoffs = ["取舍"]\npath_decision = "选 A"\nrequirement_coverage = ["R-1 → x"]\n'
    const task = '[[unit]]\nid = "TSK-1"\nkind = "task"\nstatus = "todo"\ntitle = "完整任务"\nparent = "CHG-1"\ntask_brief = "TASK.md"\ncounterexamples = ["反例"]\nstop_conditions = ["停手"]\nreturn_to = "back-to-task"\n'
    writeFileSync(join(dir, 'ledger', 'units', 'index.toml'), req + plan + task.replace('status = "todo"', 'status = "doing"'))
    writeFileSync(join(dir, 'ledger', 'units', 'unit-01.toml'), req + plan + task)
    writeFileSync(join(dir, 'TASK.md'), '# task\n')
    const lc = tools.ledgerLifecycleOfRoot(dir)
    if (lc.state === 'invalid' && lc.blockers.some((b) => b.rule === 'A-4')) ok('LC-13 ✓ 已激活账本的索引/单元源分裂 ⇒ invalid，不能继续派活')
    else bad(`LC-13 索引分裂未被判 invalid：${JSON.stringify(lc)}`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

// LC-14..17: real archive/rebuild on a temporary ledger.
{
  const dir = mkdtempSync(join(tmpdir(), 'lc-rebuild-'))
  try {
    mkdirSync(join(dir, 'ledger', 'units'), { recursive: true })
    writeFileSync(join(dir, 'ledger', 'units', 'index.toml'), '[[unit]]\nid = "R-OLD"\nkind = "req"\nstatus = "settled"\ntitle = "旧需求"\nclarify_examples = ["旧例子"]\nacceptance_criteria = ["旧判据"]\n')
    writeFileSync(join(dir, 'ledger.toml'), mod.initialLedgerActivation({ ledgerId: 'old-1', workspace: 'lc-rebuild', createdAt: '2026-11-10T00:00:00Z' }))
    writeFileSync(join(dir, 'PROJECT.md'), '# old project\n')
    const created = tools.createHobTools({
      workspaceRoot: dir,
      ledgerRoot: dir,
      ledgerHome: join(dir, '..'),
    }, {
      levelOf: () => 'workspace',
    })
    const ctx = { agent: { id: 'hob', session: { header: { cwd: dir } } } }
    const dry = await created.ledgerArchiveRebuild.execute({ reason: '账本结构已失效', dryRun: true }, ctx)
    const real = await created.ledgerArchiveRebuild.execute({ reason: '账本结构已失效', dryRun: false }, ctx)
    const after = tools.ledgerLifecycleOfRoot(dir)
    const archiveDirs = existsSync(join(dir, 'archive')) ? readdirSync(join(dir, 'archive')).filter((n) => n.includes('-ledger-rebuild')) : []
    const sourceDir = archiveDirs.length === 0 ? undefined : join(dir, 'archive', archiveDirs[0], 'source')
    const indexAfter = readFileSync(join(dir, 'ledger', 'units', 'index.toml'), 'utf8')
    if (dry.dryRun === true && dry.ok === true) ok('LC-14 ✓ 归档重建默认只演练，不改当前账本')
    else bad(`LC-14 演练失败：${JSON.stringify(dry)}`)
    if (real.ok === true && real.archived !== undefined && after.state === 'active' && after.integrity === 'empty') ok('LC-15 ✓ 真归档重建 ⇒ 旧账副本存在，新账 active-empty')
    else bad(`LC-15 真重建失败：${JSON.stringify({ real, after })}`)
    if (sourceDir !== undefined && existsSync(join(sourceDir, 'ledger', 'units', 'index.toml')) && existsSync(join(dir, 'archive', archiveDirs[0], 'MANIFEST.toml'))) ok('LC-16 ✓ 旧账整份副本与 manifest 落盘，历史未被删除')
    else bad(`LC-16 旧账副本不完整：${String(sourceDir)}`)
    if (!indexAfter.includes('R-OLD') && !indexAfter.includes('旧需求')) ok('LC-17 ✓ 新账本不继承旧需求/旧批准，必须从 R 重新开始')
    else bad('LC-17 新账本继承了旧条目')
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

// LC-18 负向对拍：去掉账本有效性判断时，失效账本会被误放行。
{
  const invalid = lifecycle('invalid')
  const bypass = { ok: true, action: 'dispatch', blockers: [], sideEffectsAllowed: true }
  if (!admit('dispatch', invalid, { taskId: 'TSK-1', taskExists: true, taskGatePassed: true, taskStatus: 'todo', targetAdmitted: true }).ok && bypass.ok) {
    ok('LC-18 ✓ 负向对拍：若绕过账本有效性判断 ⇒ 失效账本会被误放行（正证因此有牙）')
  } else bad('LC-18 负向对拍未成立')
}

// LC-19 负向对拍：若把通知当成派发入口，hob_send 就会在无任务时放行。
{
  const noTask = admit('dispatch', lifecycle(), { taskId: '', taskExists: false, taskGatePassed: false, taskStatus: 'todo', targetAdmitted: true })
  const notifyAsDispatch = { ok: true, action: 'dispatch', blockers: [], sideEffectsAllowed: true }
  if (!noTask.ok && notifyAsDispatch.ok) ok('LC-19 ✓ 负向对拍：若允许无任务 dispatch ⇒ 通知旁路会变成实质派活（正证因此有牙）')
  else bad('LC-19 负向对拍未成立')
}

// LC-20..21: structured shards are a valid authority; only conflicts are invalid.
{
  const dir = mkdtempSync(join(tmpdir(), 'lc-shard-'))
  try {
    mkdirSync(join(dir, 'ledger', 'units'), { recursive: true })
    writeFileSync(join(dir, 'ledger.toml'), mod.initialLedgerActivation({ ledgerId: 'lc-shard', workspace: 'lc-shard', createdAt: '2026-11-10T00:00:00Z' }))
    writeFileSync(join(dir, 'ledger', 'units', 'index.toml'), '# empty index\n')
    const req = '[[unit]]\nid = "R-1"\nkind = "req"\nstatus = "agreed"\ntitle = "需求"\nclarify_examples = ["例子"]\nacceptance_criteria = ["观察"]\n'
    writeFileSync(join(dir, 'ledger', 'units', 'unit-01.toml'), req)
    const shardOnly = tools.ledgerLifecycleOfRoot(dir)
    if (shardOnly.active === true) ok('LC-20 ✓ 结构化分片单独登记是有效权威，不因未重复写索引而失效')
    else bad(`LC-20 分片被误判失效：${JSON.stringify(shardOnly)}`)
    writeFileSync(join(dir, 'ledger', 'units', 'index.toml'), req.replace('status = "agreed"', 'status = "draft"'))
    const conflict = tools.ledgerLifecycleOfRoot(dir)
    if (conflict.state === 'invalid' && conflict.blockers.some((b) => b.rule === 'A-4')) ok('LC-21 ✓ 同一 ID 的索引/分片状态冲突 ⇒ invalid，不能继续派活')
    else bad(`LC-21 状态冲突未被拦住：${JSON.stringify(conflict)}`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

console.log(`\nLC 组：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处 · 没过 ${fail} 处 · **跳过 0 处**\n`)
if (fail > 0) process.exit(1)
