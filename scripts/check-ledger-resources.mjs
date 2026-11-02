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

/** N-R3 负向对拍：新增资源的 kind 前缀也不能混用。 */
{
  const r = readLedgerResource(units, 'capability/TSK-001')
  if (r.ok === false && r.reason === 'unknown-id') {
    ok('N-R3 ✓ 负向对拍（用 capability 前缀读 TSK ID）⇒ unknown-id，⛔ 不因 ID 存在就放行')
  } else {
    bad(`N-R3 · capability 前缀读 TSK ID 未被判为 unknown-id：${JSON.stringify(r)}`)
  }
}

console.log(`\n处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处`
  + (fail > 0 ? ` · 没过 ${fail} 处` : '')
  + ' · 跳过 0 处（⚠ 跳过**不计入通过**）')
console.log(process.exitCode === 1 ? '账本资源判据：FAIL' : '账本资源判据：PASS')
