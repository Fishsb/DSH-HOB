#!/usr/bin/env node
/**
 * **账本目录只读路由判据族**（2026-11-07 · `R-020`）。
 *
 * 守五件事（每条都带负向对拍）：
 *   L1 `/ledgers` 列举正确：有数据的在前、空项目在后、单元数准确
 *   L2 `readable: false` 与「空账本」必须分开（⛔ 不许把读不了说成 0）
 *   L3 `current` 标记来自会话 cwd，且 `currentResolved` 能区分"没找到"
 *   L4 **安全边界**：`../`、绝对路径、含 `/` `\` 的名字一律拒绝
 *   L5 默认选中：当前账本 → 第一个有数据的 → 第一个
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
let pass = 0
let fail = 0
const ok = (m) => { pass += 1; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail += 1; console.log(`  ✗ ${m}`) }

const mod = await import(pathToFileURL(join(root, 'src', 'shared', 'ledger-catalog.ts')).href)
const route = await import(pathToFileURL(join(root, 'src', 'modules', 'ledgers-route.ts')).href)

console.log('')
console.log('LD 组：账本目录（列举 / 安全 / 默认选中）')
console.log('')

const work = mkdtempSync(join(tmpdir(), 'ledgers-check-'))
/** 造一个账本：`units` 个单元。 */
const makeLedger = (home, name, units) => {
  const dir = join(home, name)
  mkdirSync(join(dir, 'ledger', 'units'), { recursive: true })
  const body = Array.from({ length: units }, (_, i) => `[[unit]]\nid = "X-${i}"\n`).join('\n')
  writeFileSync(join(dir, 'ledger', 'units', 'unit-01.toml'), body)
}
/** 造一个"读不了"的账本：有目录但没有 ledger/units。 */
const makeUnreadable = (home, name) => {
  mkdirSync(join(home, name), { recursive: true })
}

try {
  // ── L1 列举正确 ─────────────────────────────────────────────────────
  {
    const home = join(work, 'home1')
    mkdirSync(home, { recursive: true })
    makeLedger(home, 'big', 5)
    makeLedger(home, 'small', 2)
    makeLedger(home, 'empty', 0)
    const cat = route.listLedgers(home, 'big')
    const names = cat.items.map((x) => x.name)
    const p = []
    if (names.join(',') !== 'big,small,empty') p.push(`排序不对：${JSON.stringify(names)}`)
    if (cat.items.find((x) => x.name === 'big')?.units !== 5) p.push('big 单元数不对')
    if (cat.items.find((x) => x.name === 'small')?.units !== 2) p.push('small 单元数不对')
    if (cat.items.find((x) => x.name === 'empty')?.units !== 0) p.push('empty 单元数不对')
    if (cat.items.find((x) => x.name === 'big')?.current !== true) p.push('current 标记不对')
    if (cat.currentResolved !== true) p.push('currentResolved 应为 true')
    if (p.length === 0) ok(`L1 ✓ 列举 ${names.length} 个账本，有数据的在前（${names.join(' · ')}）`)
    else for (const x of p) bad(`L1 · ${x}`)
  }

  // ── L2 读不了 ≠ 空 ──────────────────────────────────────────────────
  {
    const home = join(work, 'home2')
    mkdirSync(home, { recursive: true })
    makeUnreadable(home, 'broken')
    makeLedger(home, 'okledger', 1)
    const cat = route.listLedgers(home, undefined)
    const broken = cat.items.find((x) => x.name === 'broken')
    const good = cat.items.find((x) => x.name === 'okledger')
    const p = []
    if (broken === undefined) p.push('broken 不在列表里')
    else if (broken.readable !== false) p.push(`broken.readable 应为 false：${JSON.stringify(broken)}`)
    if (good?.readable !== true) p.push(`okledger.readable 应为 true：${JSON.stringify(good)}`)
    if (cat.items[0]?.name !== 'okledger') p.push(`可读的应排在前面：${JSON.stringify(cat.items.map((x) => x.name))}`)
    if (p.length === 0) ok('L2 ✓ 「读不了」标 readable=false 且排在可读之后，⛔ 不混成 0 单元')
    else for (const x of p) bad(`L2 · ${x}`)
  }

  // ── L3 current 标记 ─────────────────────────────────────────────────
  {
    const home = join(work, 'home3')
    mkdirSync(home, { recursive: true })
    makeLedger(home, 'a', 1)
    makeLedger(home, 'b', 1)
    const hit = route.listLedgers(home, 'b')
    const miss = route.listLedgers(home, 'not-exist')
    const p = []
    if (hit.items.find((x) => x.name === 'b')?.current !== true) p.push('current=b 没标上')
    if (hit.currentResolved !== true) p.push('currentResolved 应为 true')
    if (miss.items.some((x) => x.current)) p.push('不存在的 current 却标了某个账本')
    if (miss.currentResolved !== false) p.push('currentResolved 应为 false')
    if (p.length === 0) ok('L3 ✓ current 只标真实存在的那本；判不出时 currentResolved=false')
    else for (const x of p) bad(`L3 · ${x}`)
  }

  // ── L4 安全边界 ─────────────────────────────────────────────────────
  {
    const home = join(work, 'home4')
    mkdirSync(home, { recursive: true })
    makeLedger(home, 'good', 1)
    const exists = (p) => { try { return p.startsWith(home) && p !== home } catch { return false } }
    const p = []
    const bads = ['../etc', '..', '.', '/etc', 'a/b', 'a\\b', '', '  ', 'good/../bad']
    for (const b of bads) {
      if (mod.resolveLedgerByName(home, b, exists) !== undefined) p.push(`危险名字未被拒：${JSON.stringify(b)}`)
    }
    if (mod.resolveLedgerByName(home, 'good', exists) === undefined) p.push('合法名字被误拒')
    if (mod.resolveLedgerByName('', 'good', exists) !== undefined) p.push('空 home 却解析成功')
    if (p.length === 0) ok(`L4 ✓ 安全边界：${bads.length} 个危险名字全被拒，合法名字放行`)
    else for (const x of p) bad(`L4 · ${x}`)
  }

  // ── L4b 负向对拍：去掉校验 ⇒ 必须能穿出去 ────────────────────────────
  {
    const home = join(work, 'home5')
    mkdirSync(home, { recursive: true })
    const exists = () => true
    const unsafe = (name) => typeof name === 'string' && name !== '' ? join(home, name) : undefined
    const withGuard = mod.resolveLedgerByName(home, '../escape', exists)
    const withoutGuard = unsafe('../escape')
    const p = []
    if (withGuard !== undefined) p.push('带校验却放行了 ../escape')
    if (withoutGuard === undefined) p.push('负向对拍不可判：去掉校验也解析不出')
    else if (!withoutGuard.includes('escape')) p.push(`负向对拍不可判：${withoutGuard}`)
    if (p.length === 0) ok(`L4b ✓ 负向对拍：带校验拒绝 \`../escape\`；去掉校验会拼出 \`${withoutGuard}\` ⇒ 这条判据有牙`)
    else for (const x of p) bad(`L4b · ${x}`)
  }

  // ── L5 默认选中 ─────────────────────────────────────────────────────
  {
    const mk = (items, currentResolved = false) => ({ home: '/h', items, currentResolved })
    const e = (name, units, readable = true, current = false) => ({ name, units, readable, current })
    const p = []
    if (mod.defaultLedgerOf(mk([e('a', 0), e('b', 5, true, true)])) !== 'b') p.push('有 current 时应选 current')
    if (mod.defaultLedgerOf(mk([e('a', 0), e('b', 5)])) !== 'b') p.push('无 current 时应选第一个有数据的')
    if (mod.defaultLedgerOf(mk([e('a', 0), e('b', 0)])) !== 'a') p.push('全空时应选第一个')
    if (mod.defaultLedgerOf(mk([])) !== undefined) p.push('空列表应返回 undefined')
    if (p.length === 0) ok('L5 ✓ 默认选中：current → 第一个有数据的 → 第一个 → undefined')
    else for (const x of p) bad(`L5 · ${x}`)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}

console.log('')
console.log(`LD 组：通过 ${pass} · 失败 ${fail}`)
if (fail > 0) process.exitCode = 1
