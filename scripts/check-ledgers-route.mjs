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
const makeLedger = (home, name, units, pipelineVersion = 'v2') => {
  const dir = join(home, name)
  mkdirSync(join(dir, 'ledger', 'units'), { recursive: true })
  const body = Array.from({ length: units }, (_, i) => `[[unit]]\nid = "X-${i}"\nkind = "req"\nstatus = "agreed"\ntitle = "t"\npipeline_version = "${pipelineVersion}"\n`).join('\n')
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
    else if (broken.state !== 'empty') p.push(`有目录无 units 应为 empty：${JSON.stringify(broken)}`)
    if (good?.readable !== true) p.push(`okledger.readable 应为 true：${JSON.stringify(good)}`)
    if (cat.items[0]?.name !== 'okledger') p.push(`可读的应排在前面：${JSON.stringify(cat.items.map((x) => x.name))}`)
    if (p.length === 0) ok('L2 ✓ 有目录无 units ⇒ state=empty；有数据 ⇒ state=data；⛔ 不把空骨架说成读不了')
    else for (const x of p) bad(`L2 · ${x}`)
  }

  // ── L2b 分片读失败 ⇒ unreadable（与 empty 分开）───────────────────────
  {
    const home = join(work, 'home2b')
    mkdirSync(home, { recursive: true })
    const dir = join(home, 'broken-shard')
    mkdirSync(join(dir, 'ledger', 'units'), { recursive: true })
    // 用一个目录冒充 .toml 文件 ⇒ readFileSync 抛 EISDIR
    mkdirSync(join(dir, 'ledger', 'units', 'unit-01.toml'), { recursive: true })
    makeLedger(home, 'okledger', 1)
    const cat = route.listLedgers(home, undefined)
    const broken = cat.items.find((x) => x.name === 'broken-shard')
    const p = []
    if (broken?.state !== 'unreadable') p.push(`分片读失败应为 unreadable：${JSON.stringify(broken)}`)
    if (broken?.readable !== false) p.push(`unreadable 兼容字段 readable 应为 false：${JSON.stringify(broken)}`)
    if (cat.items[0]?.name !== 'okledger') p.push(`data 应排在 unreadable 前：${JSON.stringify(cat.items.map((x) => [x.name, x.state]))}`)
    if (p.length === 0) ok('L2b ✓ 分片读失败 ⇒ state=unreadable，且排在 data / empty 之后')
    else for (const x of p) bad(`L2b · ${x}`)
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
    const bads = ['../etc', '..', '.', '/etc', 'a/b', 'a\\b', '', '  ', 'good/../bad', '.hidden', 'a\0b']
    for (const b of bads) {
      if (mod.resolveLedgerByName(home, b, exists) !== undefined) p.push(`危险名字未被拒：${JSON.stringify(b)}`)
    }
    if (mod.resolveLedgerByName(home, 'good', exists) === undefined) p.push('合法名字被误拒')
    if (mod.resolveLedgerByName(home, '中文项目', () => true) === undefined) p.push('Unicode 单段名被误拒')
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
    const e = (name, units, state = units > 0 ? 'data' : 'empty', current = false) => ({ name, units, state, readable: state !== 'unreadable', current })
    const p = []
    if (mod.defaultLedgerOf(mk([e('a', 0), e('b', 5, true, true)])) !== 'b') p.push('有 current 时应选 current')
    if (mod.defaultLedgerOf(mk([e('a', 0), e('b', 5)])) !== 'b') p.push('无 current 时应选第一个有数据的')
    if (mod.defaultLedgerOf(mk([e('a', 0), e('b', 0)])) !== 'a') p.push('全空时应选第一个')
    if (mod.defaultLedgerOf(mk([])) !== undefined) p.push('空列表应返回 undefined')
    if (mod.defaultLedgerOf(mk([{ name: 'bad', units: 0, state: 'unreadable', readable: false, current: false }, e('empty', 0)])) !== 'empty') p.push('全不可读时应选中第一个 empty，而不是 unreadable')
    if (p.length === 0) ok('L5 ✓ 默认选中：current → 第一个有数据的 → 第一个空骨架 → undefined')
    else for (const x of p) bad(`L5 · ${x}`)
  }
  // ── L6 目录回显的 home 是诊断字段；条目里不得带绝对路径 ──────────────────
  {
    const home = join(work, 'home6')
    mkdirSync(home, { recursive: true })
    makeLedger(home, 'alpha', 2)
    makeLedger(home, '中文项目', 1)
    makeUnreadable(home, 'broken')
    const cat = route.listLedgers(home, 'alpha')
    const p = []
    if (cat.home !== home) p.push(`home 回显不对：${JSON.stringify(cat.home)}`)
    for (const it of cat.items) {
      if (JSON.stringify(it).includes(home)) p.push(`条目 ${it.name} 带出了绝对路径：${JSON.stringify(it)}`)
    }
    if (cat.items.find((x) => x.name === '中文项目')?.state !== 'data') p.push('Unicode 账本没有被列出或状态不对')
    if (cat.items.find((x) => x.name === 'broken')?.state !== 'empty') p.push('有目录无 units 应为 empty')
    if (p.length === 0) ok(`L6 ✓ 目录 ${cat.items.length} 项：home 只在顶层回显，条目零绝对路径；Unicode 名字保留`)
    else for (const x of p) bad(`L6 · ${x}`)
  }
  // ── L7 项目梳理：旧版 / 最新 / 备份 / 空账必须分开 ─────────────────────
  {
    const home = join(work, 'home7')
    mkdirSync(home, { recursive: true })
    makeLedger(home, 'old-project', 2, 'v2')
    makeLedger(home, 'current-project', 1, 'v3')
    makeLedger(home, 'old-project.backup-20261108', 2, 'v2')
    mkdirSync(join(home, 'empty-project'), { recursive: true })
    const cat = route.listLedgers(home, 'current-project')
    const by = (n) => cat.items.find((x) => x.name === n)
    const p = []
    if (by('old-project')?.health !== 'outdated') p.push(`v2 活跃账本应标 outdated：${JSON.stringify(by('old-project'))}`)
    if (by('current-project')?.health !== 'current') p.push(`v3 账本应标 current：${JSON.stringify(by('current-project'))}`)
    if (by('old-project.backup-20261108')?.health !== 'backup') p.push(`备份账本应标 backup：${JSON.stringify(by('old-project.backup-20261108'))}`)
    if (by('empty-project')?.health !== 'empty') p.push(`空账本应标 empty：${JSON.stringify(by('empty-project'))}`)
    if (cat.summary === undefined || cat.summary.current !== 1 || cat.summary.outdated !== 1 || cat.summary.backup !== 1 || cat.summary.empty !== 1) {
      p.push(`项目梳理汇总不对：${JSON.stringify(cat.summary)}`)
    }
    if (p.length === 0) ok('L7 ✓ 项目梳理：v2 → outdated、v3 → current、备份 → backup、空账 → empty；汇总逐档计数')
    else for (const x of p) bad(`L7 · ${x}`)

    /** 新格式的单元写在 index.toml 本身，也必须计数（真账本实测漏过这一档）。 */
    const inline = join(home, 'inline-project')
    mkdirSync(join(inline, 'ledger', 'units'), { recursive: true })
    writeFileSync(join(inline, 'ledger', 'units', 'index.toml'), '[[unit]]\nid = "R-1"\nkind = "req"\nstatus = "agreed"\ntitle = "t"\npipeline_version = "v3"\n')
    const c2 = route.listLedgers(home, undefined)
    const inlineEntry = c2.items.find((x) => x.name === 'inline-project')
    if (inlineEntry?.units !== 1 || inlineEntry?.health !== 'current') {
      bad(`L7b · index.toml 内联单元没被计数：${JSON.stringify(inlineEntry)}`)
    } else ok('L7b ✓ index.toml 内联单元也计入（⛔ 不把 16 单元真账本说成空账）')
    /**
     * ── L8：R-20 —— 单元数与 v3 数必须来自**同一次逐单元解析** ──────────────
     *
     * ⚠ 这条钉的是「把整本 v2 报成 v3」：
     *   改前 `units` 数 `[[unit]]` **行**，`v3Units` 数**任意位置**的
     *   `pipeline_version = "v3"` **行**（可多于单元头），再 `Math.max(0, units - v3Units)` 夹到 0。
     *   ⇒ 只要有一行 v3 标记，整本 v2 就报 `current` —— **该迁移的说不用迁移**。
     *
     * ⚠ 夹具：3 条单元、其中只有 R-M1 带 v3 ⇒ 行计数与逐单元判定会给出不同答案。
     */
    {
      const mixed = join(home, 'mixed-project')
      mkdirSync(join(mixed, 'ledger', 'units'), { recursive: true })
      writeFileSync(join(mixed, 'ledger', 'units', 'unit-01.toml'), [
        '[[unit]]', 'id = "R-M1"', 'kind = "req"', 'status = "agreed"', 'title = "v3 需求"',
        'pipeline_version = "v3"', 'revision = "1"', '',
        '[[unit]]', 'id = "R-M2"', 'kind = "req"', 'status = "agreed"', 'title = "v2 需求"', '',
      ].join('\n'))
      writeFileSync(join(mixed, 'ledger', 'units', 'unit-02.toml'), [
        '# 下面这一行是**注释**：行计数会把它当成一条 v3 单元，逐单元判定不会',
        '# pipeline_version = "v3"',
        '[[unit]]', 'id = "R-M3"', 'kind = "req"', 'status = "agreed"', 'title = "v2 需求二"', '',
      ].join('\n'))
      const e3 = route.listLedgers(home, undefined).items.find((x) => x.name === 'mixed-project')
      const p = []
      if (e3 === undefined) p.push('混合账本没被列出')
      else {
        if (e3.units !== 3) p.push('单元数应为 3（逐单元解析），实际 ' + e3.units)
        if (e3.v3Units !== 1) p.push('v3 单元数应为 1（只有 R-M1 带 v3），实际 ' + e3.v3Units)
        if (e3.legacyUnits !== 2) p.push('v2 单元数应为 2，实际 ' + e3.legacyUnits)
        if (e3.units !== e3.v3Units + e3.legacyUnits) {
          p.push('units != v3Units + legacyUnits ⇒ 三者不是同一层级（R-20 复发）')
        }
      }
      if (p.length === 0) {
        ok('L8 ✓ **负向对拍**：3 条单元里只有 1 条 v3 ⇒ units=3 / v3Units=1 / legacyUnits=2'
          + '（R-20：不再按行计数把整本 v2 报成 v3）')
      } else for (const x of p) bad('L8 · ' + x)
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}

console.log('')
console.log(`LD 组：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处`
  + (fail > 0 ? ` · 没过 ${fail} 处` : '')
  + ' · 跳过 0 处')
if (fail > 0) process.exitCode = 1
