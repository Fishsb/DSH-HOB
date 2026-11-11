#!/usr/bin/env node
/**
 * 账本资源图判据（P2）。
 *
 * 直接 import `src/shared/ledger-resources.ts` 真源码：
 *   · 列表只返回卡片与读取指针；
 *   · 需求沿 goal / change / task 的正式边展开；
 *   · 子项下钻不混入正文；
 *   · 未知资源、未知 ID、错误 kind 三种失败可分辨；
 *   · 资源解析不产生任何写入。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = new URL('..', import.meta.url).pathname
const mod = await import(pathToFileURL(join(root, 'src', 'shared', 'ledger-resources.ts')).href)
const { readLedgerResource, readPathOf, cardOf, kindOfId } = mod

let pass = 0
let fail = 0
const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail++; console.log(`  ✗ ${m}`); process.exitCode = 1 }
const REQUIRE = (cond, message) => { if (cond) ok(message); else bad(message) }

const units = [
  { id: 'R-001', kind: 'req', status: 'agreed', title: '需求一', parent: 'spec/progress', acceptance_ids: ['ACC-001'] },
  { id: 'G-001', kind: 'goal', status: 'active', title: '目标一', req_ids: ['R-001'] },
  { id: 'CHG-001', kind: 'change', status: 'settled', title: '方案一', addresses: ['R-001'], decisions: ['DEC-001'], parent: 'spec/progress' },
  { id: 'TSK-001', kind: 'task', status: 'built', title: '任务一', parent: 'CHG-001', req_ids: ['R-001'], risk_ids: ['RSK-001'] },
  { id: 'RUN-001', kind: 'run', status: 'returned', title: '执行一', parent: 'TSK-001' },
  { id: 'ACC-001', kind: 'acc', status: 'pass', title: '验收一', parent: 'TSK-001', basis: ['EVD-001'] },
  { id: 'EVD-001', kind: 'evidence', status: 'recorded', title: '证据一', parent: 'TSK-001', reading: '原始读数正文不应出现在卡片中' },
  { id: 'RSK-001', kind: 'risk', status: 'handling', title: '风险一', affects: ['CHG-001'] },
  { id: 'DEC-001', kind: 'decision', status: 'active', title: '决策一' },
  { id: 'CAP-001', kind: 'cap', status: 'live', title: '能力一' },
]

// Pipeline v3 resources must expose verification and closure with their own relation/readout.
{
  const gen = await import(pathToFileURL(join(root, 'src', 'shared', 'ledger-resources.ts')).href)
  const items = [
    { id: 'R-V3', kind: 'req', title: '需求', status: 'agreed' },
    { id: 'TSK-V3', kind: 'task', title: '任务', status: 'built', parent: 'R-V3' },
    { id: 'VER-001', kind: 'verification', title: '技术验证', status: 'pass', parent: 'TSK-V3' },
  ]
  const v = gen.readLedgerResource(items, 'verification/VER-001')
  const p = []
  if (!v.ok || v.card.presentation?.relation?.key !== 'task' || v.card.presentation?.relation?.label !== '验证对象') {
    p.push(`技术验证资源关系不对：${JSON.stringify(v)}`)
  }
  if (!Array.isArray(v.card.presentation?.facts) || v.card.presentation.facts.length === 0) p.push('技术验证资源没有关键读数')
  const list = gen.readLedgerResource(items, 'verifications')
  if (!list.ok || !Array.isArray(list.children) || list.children.length !== 1) p.push('verifications 列表读不到')
  if (p.length === 0) ok('LR-V3 ✓ 技术验证资源可按 ID / 列表读取，关系为「验证对象」并带关键读数')
  else for (const x of p) bad(`LR-V3 · ${x}`)
}

/** R-1 稳定前缀到 kind 的映射。 */
REQUIRE(kindOfId('R-001') === 'req' && kindOfId('CHG-001') === 'change'
  && kindOfId('TSK-001') === 'task' && kindOfId('ACC-001') === 'acc'
  && kindOfId('EVD-001') === 'evidence' && kindOfId('RUN-001') === 'run'
  && kindOfId('G-001') === 'goal' && kindOfId('RSK-001') === 'risk'
  && kindOfId('DEC-001') === 'decision' && kindOfId('CAP-001') === 'cap',
  'R-1 ✓ 10 类稳定 ID 前缀 → kind 一一对应')

/** R-2 列表只给卡片，不内联正文。 */
{
  const r = readLedgerResource(units, 'requirements')
  const hydrated = JSON.stringify(r).includes('原始读数正文不应出现在卡片中')
  REQUIRE(r.ok === true && r.children.length === 1 && r.children[0].read === 'requirement/R-001' && !hydrated,
    'R-2 ✓ 列表只回摘要卡与读取指针，⛔ 不内联证据正文')
}

/** R-3 需求沿正式边展开。 */
{
  const r = readLedgerResource(units, 'requirement/R-001')
  const ids = r.ok ? r.children.map((x) => x.id).sort() : []
  REQUIRE(r.ok === true && ['G-001', 'CHG-001', 'TSK-001', 'RSK-001', 'DEC-001'].every((x) => ids.includes(x)),
    'R-3 ✓ 需求沿 goal.req_ids / change.addresses / task.req_ids / risk_ids / decisions 展开')
}

/** R-4 子项下钻与摘要一致。 */
{
  const r = readLedgerResource(units, 'task/TSK-001/children')
  const ids = r.ok ? r.children.map((x) => x.id).sort() : []
  REQUIRE(r.ok === true && ids.length === 3 && ids.includes('ACC-001') && ids.includes('RUN-001')
    && ids.includes('EVD-001') && !ids.includes('R-001') && !ids.includes('CHG-001'),
    `R-4 ✓ task/<id>/children 只按 parent 归属返回直属子项（实测 ids=${JSON.stringify(ids)}）`)
}

/** R-5 三类失败必须分开。 */
{
  const a = readLedgerResource(units, 'bogus/thing')
  const b = readLedgerResource(units, 'task/TSK-999')
  const c = readLedgerResource(units, 'task/R-001')
  REQUIRE(a.ok === false && a.reason === 'unknown-resource'
    && b.ok === false && b.reason === 'not-found'
    && c.ok === false && c.reason === 'unknown-id',
    'R-5 ✓ 未知资源 / 未知 ID / 错误 kind 三种原因可分辨')
}

/** R-6 纯函数：同输入逐字节相同。 */
{
  const a = JSON.stringify(readLedgerResource(units, 'requirement/R-001'))
  const b = JSON.stringify(readLedgerResource(units, 'requirement/R-001'))
  REQUIRE(a === b, 'R-6 ✓ 资源解析为纯函数：同输入逐字节相同')
}

/** N-R1 负向对拍：漏掉正式边 ⇒ 需求子项减少。 */
{
  const broken = units.filter((u) => u.id !== 'CHG-001')
  const r = readLedgerResource(broken, 'requirement/R-001')
  const ids = r.ok ? r.children.map((x) => x.id) : []
  if (!ids.includes('CHG-001')) ok('N-R1 ✓ 负向对拍（摘掉承接方案）⇒ 需求子项中方案消失')
  else bad('N-R1 · 摘掉承接方案后，需求子项仍含方案')
}

/** N-R2 负向对拍：错误 kind ⇒ 不可当合法资源。 */
{
  const r = readLedgerResource(units, 'acceptance/TSK-001')
  if (r.ok === false && r.reason === 'unknown-id') ok('N-R2 ✓ 负向对拍（用 ACC 前缀读 task ID）⇒ unknown-id，⛔ 不按存在性放行')
  else bad('N-R2 · 用 ACC 前缀读 task ID 未被判为 unknown-id')
}

/** R-7 输出不含文件系统路径。 */
{
  const text = JSON.stringify(readLedgerResource(units, 'requirement/R-001'))
  REQUIRE(!text.includes(root) && !/\/home\/|\\\\wsl/.test(text),
    'R-7 ✓ 卡片不泄露本机绝对路径')
}

/** R-8 新增四类都有一等列表资源。 */
{
  const names = ['goals', 'risks', 'decisions', 'capabilities']
  const got = names.map((x) => readLedgerResource(units, x))
  REQUIRE(got.every((x) => x.ok === true && x.children.length === 1)
    && got[0].children[0].read === 'goal/G-001'
    && got[1].children[0].read === 'risk/RSK-001'
    && got[2].children[0].read === 'decision/DEC-001'
    && got[3].children[0].read === 'capability/CAP-001',
  'R-8 ✓ goals / risks / decisions / capabilities 四类列表资源均可读')
}

/** R-9 新增四类都支持按稳定 ID 读取。 */
{
  const refs = ['goal/G-001', 'risk/RSK-001', 'decision/DEC-001', 'capability/CAP-001']
  const got = refs.map((x) => readLedgerResource(units, x))
  REQUIRE(got.every((x) => x.ok === true)
    && got[0].card.kind === 'goal' && got[1].card.kind === 'risk'
    && got[2].card.kind === 'decision' && got[3].card.kind === 'cap',
  'R-9 ✓ goal / risk / decision / capability 四类按 ID 读取均成立')
}

/** R-10 资源卡里的每一个 read 指针都必须能被同一入口继续解析。 */
{
  const rootReq = readLedgerResource(units, 'requirement/R-001')
  const refs = rootReq.ok ? [rootReq.card.read, ...rootReq.children.map((x) => x.read)] : []
  const unresolved = refs.filter((x) => readLedgerResource(units, x).ok !== true)
  REQUIRE(refs.length > 0 && unresolved.length === 0,
    `R-10 ✓ 需求关联图的每个 read 指针都可继续解析（实测 ${refs.length} 个，未解析 ${unresolved.length} 个）`)
}

/** R-11 按 ID 读取返回完整展示投影；列表仍只回摘要。 */
{
  const detail = readLedgerResource(units, 'acceptance/ACC-001')
  const list = readLedgerResource(units, 'acceptances')
  const pres = detail.ok ? detail.card.presentation : undefined
  const listText = JSON.stringify(list)
  REQUIRE(detail.ok === true && pres !== undefined
    && pres.originalTitle === '验收一'
    && pres.details.some((f) => f.key === 'basis' && f.value === 'EVD-001')
    && pres.details.some((f) => f.key === 'flags' && f.value === '无')
    && pres.details.some((f) => f.key === 'verdict' && f.value === '验收通过')
    && !listText.includes('originalTitle') && !listText.includes('"details"'),
  'R-11 ✓ 按 ID 读取附带完整展示投影（原句 / 判决 / 依据 / 固定异常），列表仍不含原句与详情')
}

/** R-12 残余风险随验收详情可读，不能只在首屏摘要里出现。 */
{
  const acc = { id: 'ACC-901', kind: 'acc', status: 'pass', title: '残余风险验收', parent: 'TSK-001',
    risk_residual_tier: 'high', risk_accepted_by: 'user', risk_residual_impact: '发布后权限残留',
    risk_residual_monitoring: '24h 监控 + 回滚命令' }
  const r = readLedgerResource([...units, acc], 'acceptance/ACC-901')
  const d = r.ok ? r.card.presentation.details : []
  const keys = new Set(d.map((f) => f.key))
  const p = []
  for (const k of ['risk_residual_tier', 'risk_accepted_by', 'risk_residual_impact', 'risk_residual_monitoring']) {
    if (!keys.has(k)) p.push(`详情缺 ${k}`)
  }
  if (p.length === 0) ok('R-12 ✓ 验收详情可读残余风险等级 / 接受人 / 影响 / 监控，⛔ 不只在首屏摘要')
  else for (const x of p) bad(`R-12 · ${x}`)
}

/** N-R4 负向对拍：完整投影缺失依据 ⇒ R-11 必红。 */
{
  const noBasis = units.map((u) => u.id === 'ACC-001' ? { ...u, basis: [] } : u)
  const r = readLedgerResource(noBasis, 'acceptance/ACC-001')
  const pres = r.ok ? r.card.presentation : undefined
  const hasBasis = pres?.details.some((f) => f.key === 'basis') === true
  if (!hasBasis) ok('N-R4 ✓ 负向对拍（摘掉验收依据）⇒ R-11 的"展开依据"断言**必红**')
  else bad('N-R4 · 摘掉验收依据后完整投影仍带依据 ⇒ R-11 没有牙')
}

/** N-R3 负向对拍：新增资源的 kind 前缀也不能混用。 */
{
  const r = readLedgerResource(units, 'capability/TSK-001')
  if (r.ok === false && r.reason === 'unknown-id') {
    ok('N-R3 ✓ 负向对拍（用 capability 前缀读 TSK ID）⇒ unknown-id，⛔ 不因 ID 存在就放行')
  } else {
    bad(`N-R3 · capability 前缀读 TSK ID 未被判为 unknown-id：${JSON.stringify(r)}`)
  }
}

/**
 * ── T-23：TERMINOLOGY 的 kind 表必须与代码的 kind 封闭集**双向差集为空** ────────
 *
 * ⚠ 这条钉的是「术语表自己内部矛盾」：原文 kind 表只有 10 行，缺 `verification` / `closure`，
 *   而**紧接的下一节**又要求 `req/change/task/run/verification/acc/closure` 带 v3 字段；
 *   ID 前缀表也缺 `VER-` / `CLS-`，而 `ledger-resources.ts:75-76` 明确支持它们。
 *   ⇒ 一个人照术语表写单元，会漏掉两个 kind；照下一节写，又会找不到前缀。
 *
 * ⚠ 判据用**代码侧的封闭集**做基准（`UNIT_STATUSES` 的键集），⛔ 不在断言里另抄一份清单 ——
 *   那会变成「同一事实两个来源」，正是本项目明令要防的形态。
 */
{
  const p = []
  const statuses = await import(pathToFileURL(join(root, 'src/shared/ledger-validation.ts')).href)
  const codeKinds = new Set(Object.keys(statuses.UNIT_STATUSES))

  const term = (() => {
    try { return readFileSync(join(root, 'TERMINOLOGY.md'), 'utf8') } catch { return '' }
  })()
  if (term === '') p.push('读不到 TERMINOLOGY.md ⇒ 失去基准')

  /**
   * 抽「三、账本术语」那张表里的 kind（第一列反引号包裹的技术名）。
   * ⚠ 只认该节内的表格，⛔ 不全文扫 —— 全文里有别的表也用反引号（如状态名）。
   */
  const section = term.split(/\n## /).find((s) => s.startsWith('三、账本术语')) ?? ''
  const docKinds = new Set(
    [...section.matchAll(/^\|\s*`([a-z]+)`\s*\|/gm)].map((m) => m[1]),
  )
  if (docKinds.size === 0) p.push('TERMINOLOGY「三、账本术语」里一个 kind 都没抽到（表格形态变了？）')

  const missingInDoc = [...codeKinds].filter((k) => !docKinds.has(k))
  const strayInDoc = [...docKinds].filter((k) => !codeKinds.has(k))
  if (missingInDoc.length > 0) p.push(`TERMINOLOGY 的 kind 表漏了：${missingInDoc.join(' / ')}`)
  if (strayInDoc.length > 0) p.push(`TERMINOLOGY 的 kind 表多出代码里没有的：${strayInDoc.join(' / ')}`)

  /** 同一张表的 ID 前缀列必须覆盖 `ledger-resources.ts` 认识的每一个前缀。 */
  const prefixRows = [...section.matchAll(/^\|\s*`[a-z]+`\s*\|[^|]*\|\s*`([A-Z]+)-`/gm)].map((m) => m[1])
  for (const must of ['VER', 'CLS', 'ACC', 'TSK']) {
    if (!prefixRows.includes(must)) p.push('TERMINOLOGY 的 ID 前缀表缺 ' + must + '- 前缀')
  }

  if (p.length === 0) {
    ok(`T-23 ✓ TERMINOLOGY 的 kind 表与代码封闭集双向差集为空（${codeKinds.size} 种），`
      + 'ID 前缀齐备（VER- / CLS- 不再缺）')
  } else for (const x of p) bad(`T-23 · ${x}`)
}

console.log(`\n处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处`
  + (fail > 0 ? ` · 没过 ${fail} 处` : '')
  + ' · 跳过 0 处（⚠ 跳过**不计入通过**）')
console.log(process.exitCode === 1 ? '账本资源判据：FAIL' : '账本资源判据：PASS')
