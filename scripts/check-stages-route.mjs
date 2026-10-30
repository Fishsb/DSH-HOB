#!/usr/bin/env node
/**
 * **五步汇总路由 · 服务端行为判据**（2026-10-30 · P3 · `TASK-P3.md` §三2）。
 *
 * ══ 它守什么 ═══════════════════════════════════════════════════════════════════
 *   R-1 **三类 reason 互不相同**（`index-unreadable` / `index-malformed` / `row-shape-unknown`）
 *   R-2 **五步顺序固定**（①..⑤，且每步的 `name` 逐字）
 *   R-3 **`cap` 不进分母**（`total` 不含 cap；`caps` 单列）
 *   R-4 **空步给 `todo` 而不报错**（⚠ 与"判不出"是两件事）
 *   R-5 **三态算对**（done / doing / todo 逐条对照）
 *   R-6 **items 顺序原样**（⛔ 不排序、⛔ 不去重）
 *   R-7 **`lastReading` 缺 ⇒ 「判不出」**（⛔ 不填 0、⛔ 不编）
 *   R-8 **负向对拍**：把 `cap` 混进分母 ⇒ R-3 必红
 *   R-9 **与生成器交叉验证**：本文件算出的五步数字 == `gen/stages.md` 那五行（⚠ 两套解析器交叉验证）
 *
 * 用法：node scripts/check-stages-route.mjs
 * 退出码：0 = 全通过；1 = 有失败
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const ENTRY = 'src/shared/stages-index.ts'
const WORK = join(root, '.check-stages-route-work')

let pass = 0
let fail = 0
const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail++; console.log(`  ✗ ${m}`) }

rmSync(WORK, { recursive: true, force: true })
mkdirSync(WORK, { recursive: true })

console.log('')
console.log('R 组：五步汇总路由 · 服务端行为判据（真处理体 + 真夹具）')
console.log('')

try {
  const tsPath = join(root, 'node_modules', 'typescript', 'lib', 'typescript.js')
  const ts = (await import(pathToFileURL(tsPath).href)).default
  const tsMount = await import('./ts-mount.mjs')
  const graph = tsMount.mountTsGraph({ root, outDir: join(WORK, 'out'), entries: [ENTRY], ts })
  const problems = [
    ...graph.problems,
    ...tsMount.verifyMounted({ root, entries: [ENTRY], mounted: graph.mounted, entryFiles: graph.entries }),
  ]
  if (problems.length > 0) for (const p of problems) bad(`R-0 转译/自证失败：${p}`)
  else ok(`R-0 ✓ 转译图自证通过（${graph.mounted.join(' · ')}）`)
  const out = graph.entries[ENTRY]
  if (out === undefined) throw new Error('入口没有产出（见 R-0）')
  const entryFile = join(WORK, 'entry.mjs')
  writeFileSync(entryFile, `export * from ${JSON.stringify(out)}\n`)
  const mod = await import(pathToFileURL(entryFile).href)

  const FIXED_NOW = new Date('2026-10-30T00:00:00.000Z')
  const deps = (o = {}) => ({
    workRootOf: o.rootFn ?? (() => '/fix'),
    workRootWhyOf: o.whyFn ?? (() => '夹具：给了工作区根'),
    indexPathOf: () => '/fix/ledger-next/units/index.toml',
    readText: o.readText ?? (() => undefined),
    now: () => FIXED_NOW,
  })

  /** 造一份合法索引文本（⚠ 用真 TOML 子集写法，不绕解析器）。 */
  const TOML = (rows) => rows.map((r) => `[[unit]]
id = "${r.id}"
kind = "${r.kind}"
title = "${r.title ?? r.id}"
parent = "${r.parent ?? 'spec/progress'}"
status = "${r.status}"
after = []
source = "夹具"
`).join('\n')

  const ALL_KINDS = TOML([
    { id: 'R-001', kind: 'req', status: 'agreed' },
    { id: 'R-002', kind: 'req', status: 'draft' },
    { id: 'CHG-X', kind: 'change', status: 'settled' },
    { id: 'TSK-1', kind: 'task', status: 'built' },
    { id: 'TSK-2', kind: 'task', status: 'doing' },
    { id: 'RUN-001', kind: 'run', status: 'running' },
    { id: 'ACC-001', kind: 'acc', status: 'unverified' },
    { id: 'CAP-01', kind: 'cap', status: 'live' },
  ])

  // ── R-1 三类 reason 互不相同 ─────────────────────────────────────────
  {
    const unreadable = mod.handleStages(deps({ rootFn: () => undefined, whyFn: () => '夹具判不出根' }), {})
    const missing = mod.handleStages(deps({ readText: () => undefined }), {})
    const malformed = mod.handleStages(deps({ readText: () => '[[unit]\nid = "x"' }), {})
    const shape = mod.handleStages(deps({ readText: () => TOML([{ id: 'X-1', kind: 'bogus', status: 'zzz' }]) }), {})
    const probs = []
    if (unreadable.ok !== false || unreadable.reason !== mod.STAGES_REASON_INDEX_UNREADABLE) probs.push(`根判不出 ⇒ ${JSON.stringify(unreadable).slice(0, 100)}`)
    if (missing.ok !== false || missing.reason !== mod.STAGES_REASON_INDEX_UNREADABLE) probs.push(`文件不存在 ⇒ ${JSON.stringify(missing).slice(0, 100)}`)
    if (malformed.ok !== false || malformed.reason !== mod.STAGES_REASON_INDEX_MALFORMED) probs.push(`TOML 坏 ⇒ ${JSON.stringify(malformed).slice(0, 100)}`)
    if (shape.ok !== false || shape.reason !== mod.STAGES_REASON_ROW_SHAPE_UNKNOWN) probs.push(`kind 不认识 ⇒ ${JSON.stringify(shape).slice(0, 100)}`)
    const set = new Set([unreadable.reason, missing.reason, malformed.reason, shape.reason])
    if (set.size !== 3) probs.push(`四类情形只产生 ${set.size} 种 reason（期望 3 种：unreadable 两种 + malformed + shape）`)
    if (probs.length === 0) ok('R-1 ✓ 三类 reason 互不相同：index-unreadable（根判不出 / 文件不存在共用）· index-malformed · row-shape-unknown')
    else for (const x of probs) bad(`R-1 · ${x}`)
  }

  // ── R-2 五步顺序固定 + 名字逐字 ──────────────────────────────────────
  {
    const res = mod.handleStages(deps({ readText: () => ALL_KINDS }), {})
    const probs = []
    if (res.ok !== true) probs.push(`ok 不是 true：${JSON.stringify(res).slice(0, 120)}`)
    else {
      const want = [[1, '需求规格'], [2, '实现方案'], [3, '编码任务'], [4, '任务执行'], [5, '验收核对']]
      const got = res.stages.map((s) => [s.step, s.name])
      if (JSON.stringify(got) !== JSON.stringify(want)) probs.push(`五步顺序/名字不对：${JSON.stringify(got)}`)
    }
    if (probs.length === 0) ok('R-2 ✓ 五步顺序固定：① 需求规格 → ② 实现方案 → ③ 编码任务 → ④ 任务执行 → ⑤ 验收核对')
    else for (const x of probs) bad(`R-2 · ${x}`)
  }

  // ── R-3 `cap` 不进分母 ──────────────────────────────────────────────
  {
    const res = mod.handleStages(deps({ readText: () => ALL_KINDS }), {})
    const probs = []
    if (res.ok !== true) probs.push('ok 不是 true')
    else {
      const totals = res.stages.reduce((a, s) => a + s.total, 0)
      const nUnits = 8  // 见 ALL_KINDS：2 req + 1 change + 2 task + 1 run + 1 acc + 1 cap
      if (totals !== nUnits - 1) probs.push(`五步总数 ${totals}（期望 ${nUnits - 1} = 全部 8 条减去 1 条 cap）`)
      if (!Array.isArray(res.caps) || res.caps.length !== 1) probs.push(`caps 不是 1 条：${JSON.stringify(res.caps)}`)
      if (res.stages.some((s) => s.items.some((it) => String(it.id).startsWith('CAP-')))) probs.push('cap 的条目出现在了五步里')
    }
    if (probs.length === 0) ok(`R-3 ✓ cap 不进分母：五步 total 合计 ${res.stages.reduce((a, s) => a + s.total, 0)}（8 条 - 1 条 cap）· caps 单列 1 条`)
    else for (const x of probs) bad(`R-3 · ${x}`)
  }

  // ── R-4 空步给 todo 而不报错 ────────────────────────────────────────
  {
    const onlyReq = TOML([{ id: 'R-001', kind: 'req', status: 'agreed' }])
    const res = mod.handleStages(deps({ readText: () => onlyReq }), {})
    const probs = []
    if (res.ok !== true) probs.push(`只有一条 req 时 ok 不是 true：${JSON.stringify(res).slice(0, 120)}`)
    else {
      if (res.stages.length !== 5) probs.push(`步数 ${res.stages.length}（期望 5 —— 空步也要出现）`)
      for (const s of res.stages.slice(1)) {
        if (s.state !== 'todo') probs.push(`第 ${s.step} 步（零条目）state=${JSON.stringify(s.state)}（期望 todo）`)
        if (s.total !== 0 || s.done !== 0) probs.push(`第 ${s.step} 步零条目却 done/total = ${s.done}/${s.total}`)
        if (!Array.isArray(s.items) || s.items.length !== 0) probs.push(`第 ${s.step} 步 items 不是空数组`)
      }
    }
    if (probs.length === 0) ok('R-4 ✓ 空步给 `todo` 且不报错（零条目 ⇒ done/total = 0/0 · items = []）')
    else for (const x of probs) bad(`R-4 · ${x}`)
  }

  // ── R-5 三态算对 ────────────────────────────────────────────────────
  {
    const cases = [
      ['全初始态 ⇒ todo', TOML([{ id: 'R-001', kind: 'req', status: 'draft' }]), 1, 'todo'],
      ['全终态 ⇒ done', TOML([{ id: 'R-001', kind: 'req', status: 'agreed' }]), 1, 'done'],
      ['混合 ⇒ doing', TOML([{ id: 'R-001', kind: 'req', status: 'agreed' }, { id: 'R-002', kind: 'req', status: 'draft' }]), 1, 'doing'],
      ['终态+非初始非终态 ⇒ doing', TOML([{ id: 'T-1', kind: 'task', status: 'built' }, { id: 'T-2', kind: 'task', status: 'doing' }]), 3, 'doing'],
    ]
    const probs = []
    for (const [label, src, step, want] of cases) {
      const res = mod.handleStages(deps({ readText: () => src }), {})
      if (res.ok !== true) { probs.push(`${label}：ok 不是 true`); continue }
      const s = res.stages.find((x) => x.step === step)
      if (s === undefined) { probs.push(`${label}：找不到第 ${step} 步`); continue }
      if (s.state !== want) probs.push(`${label}：state=${JSON.stringify(s.state)}（期望 ${want}）`)
    }
    if (probs.length === 0) ok('R-5 ✓ 三态算对：全初始 ⇒ todo · 全终态 ⇒ done · 混合 ⇒ doing（4 组）')
    else for (const x of probs) bad(`R-5 · ${x}`)
  }

  // ── R-6 items 顺序原样（⛔ 不排序、⛔ 不去重）────────────────────────
  {
    const src = TOML([
      { id: 'TSK-9', kind: 'task', status: 'built' },
      { id: 'TSK-1', kind: 'task', status: 'todo' },
      { id: 'TSK-9', kind: 'task', status: 'built' },
    ])
    const res = mod.handleStages(deps({ readText: () => src }), {})
    const probs = []
    if (res.ok !== true) probs.push('ok 不是 true')
    else {
      const ids = res.stages.find((s) => s.step === 3).items.map((x) => x.id)
      if (JSON.stringify(ids) !== JSON.stringify(['TSK-9', 'TSK-1', 'TSK-9'])) probs.push(`items 顺序/去重不对：${JSON.stringify(ids)}（期望 ['TSK-9','TSK-1','TSK-9']）`)
    }
    if (probs.length === 0) ok('R-6 ✓ items 顺序原样、重复项保留（⛔ 没排序、⛔ 没去重）')
    else for (const x of probs) bad(`R-6 · ${x}`)
  }

  // ── R-7 `lastReading` 缺 ⇒ 「判不出」 ────────────────────────────────
  {
    const src = `[[unit]]
id = "CAP-09"
kind = "cap"
title = "没有 last_reading 的能力"
parent = "spec/progress"
status = "live"
after = []
source = "夹具"
`
    const res = mod.handleStages(deps({ readText: () => src }), {})
    const probs = []
    if (res.ok !== true) probs.push('ok 不是 true')
    else {
      const c = res.caps[0]
      if (c === undefined) probs.push('caps 里没有那条')
      else {
        if (!String(c.lastReading).includes('判不出')) probs.push(`lastReading 没写「判不出」：${JSON.stringify(c.lastReading)}`)
        if (String(c.lastReading).trim() === '0' || /^0/.test(String(c.lastReading))) probs.push(`lastReading 是 0 开头（⛔ 不许填 0）：${JSON.stringify(c.lastReading)}`)
      }
    }
    if (probs.length === 0) ok('R-7 ✓ `last_reading` 缺 ⇒ 「判不出（索引里没有 last_reading）」（⛔ 不填 0、⛔ 不编）')
    else for (const x of probs) bad(`R-7 · ${x}`)
  }

  // ── R-8 负向对拍：把 cap 混进分母 ⇒ R-3 必红 ─────────────────────────
  {
    /**
     * 造一个"把 cap 当成第 6 步塞进 stages"的变体（= 分母被污染）。
     * ⚠ 先自证：变体真的多了一步。⛔ 不许"以为改了"。
     */
    const srcFile = join(root, ENTRY)
    const orig = readFileSync(srcFile, 'utf8')
    const mutated = orig.replace(
      '  const stages: StageRow[] = STAGE_DEFS.map((d) => {',
      '  const capAsStep = { step: 6, name: \'长期能力\', state: \'todo\' as const, done: 0, total: units.filter((u) => u.kind === \'cap\').length, items: [] as StageItem[] }\n  const stages: StageRow[] = [...STAGE_DEFS.map((d) => {',
    ).replace(
      '    }\n  })\n  const caps: CapRow[] =',
      '    }\n  }), capAsStep]\n  const caps: CapRow[] =',
    )
    if (mutated === orig) {
      bad('R-8 · 负向对拍**没能改到** stages 构造（锚点失配）⇒ 这条对拍本身失效')
    } else {
      const mutDir = join(WORK, 'mut')
      const { cpSync } = await import('node:fs')
      cpSync(join(root, 'src'), join(mutDir, 'src'), { recursive: true })
      writeFileSync(join(mutDir, ENTRY), mutated)
      const g2 = tsMount.mountTsGraph({ root: mutDir, outDir: join(WORK, 'out-mut'), entries: [ENTRY], ts })
      const out2 = g2.entries[ENTRY]
      if (out2 === undefined) {
        bad(`R-8 · 副本转译失败：${g2.problems.join(' / ')}`)
      } else {
        const f2 = join(WORK, 'entry-mut.mjs')
        writeFileSync(f2, `export * from ${JSON.stringify(out2)}\n`)
        const mod2 = await import(pathToFileURL(f2).href)
        const res = mod2.handleStages(deps({ readText: () => ALL_KINDS }), {})
        const probs = []
        // ⚠ 先自证变体真的"多了一步"
        if (res.ok !== true || res.stages.length !== 6) {
          bad(`R-8 · 变体没造出第 6 步（stages=${res.ok === true ? res.stages.length : 'fail'}）⇒ 负向对拍不可判`)
        } else {
          const totals = res.stages.reduce((a, s) => a + s.total, 0)
          if (totals !== 8 - 1) probs.push(`分母被污染：五步（含 cap 步）total 合计 ${totals}（R-3 期望 ${8 - 1}）`)
          if (probs.length > 0) ok(`R-8 ✓ 负向对拍（把 cap 混进分母）⇒ R-3 的"cap 不进分母"断言**必红**：${probs[0]}`)
          else bad('R-8 · cap 混进分母后 R-3 仍通过 ⇒ 那条断言没有牙')
        }
      }
    }
  }

  // ── R-9 与生成器交叉验证（⚠ 两套解析器 + 两条渲染路径）───────────────
  {
    const ledgerDir = join(root, 'ledger-next')
    let indexPath = join(ledgerDir, 'units', 'index.toml')
    let stagesMdPath = join(ledgerDir, 'gen', 'stages.md')
    const probs = []
    let realSrc
    try { realSrc = readFileSync(indexPath, 'utf8') } catch { realSrc = undefined }
    if (realSrc === undefined) {
      bad('R-9 · 读不到真索引 ⇒ 本条失去基准（⛔ 不按通过处理）')
    } else {
      const res = mod.handleStages(deps({ rootFn: () => '/fix', readText: () => realSrc, indexPathOf: () => indexPath }), {})
      if (res.ok !== true) {
        bad(`R-9 · 真索引算不出：${JSON.stringify(res).slice(0, 140)}`)
      } else {
        let gen = ''
        try { gen = readFileSync(stagesMdPath, 'utf8') } catch { gen = '' }
        if (gen === '') bad('R-9 · 读不到 gen/stages.md ⇒ 本条失去基准')
        else {
          // 生成物里那五行：`| ① 需求规格 | ✓ 完成 | 5/5 | R-001 … |`
          const rows = gen.split('\n').filter((l) => /^\| [①②③④⑤] /.test(l))
          if (rows.length !== 5) probs.push(`gen/stages.md 里五步行 ${rows.length} 条（期望 5）`)
          else {
            for (const s of res.stages) {
              const row = rows[s.step - 1] ?? ''
              const icon = s.state === 'done' ? '✓' : s.state === 'doing' ? '▶' : '○'
              if (!row.includes(`${s.done}/${s.total}`)) probs.push(`第 ${s.step} 步：路由算 ${s.done}/${s.total}，但 gen/stages.md 那行是 ${JSON.stringify(row.slice(0, 60))}`)
              if (!row.includes(icon)) probs.push(`第 ${s.step} 步：路由 state=${s.state}（图标 ${icon}），gen 那行没有它`)
            }
            /**
             * ⚠ 关键：两套**独立实现**（`scripts/gen-ledger.mjs` 与 `src/shared/stages-index.ts`）
             *   必须给出同一组数字。数字不同 = 有一条路径算错了（`DESIGN-V2.md` §十·4 的洞）。
             */
          }
        }
      }
    }
    if (probs.length === 0) ok('R-9 ✓ 与生成器交叉验证：路由算出的五步（state + 完成数/总数）与 `gen/stages.md` 那五行逐项一致（两套独立解析器）')
    else for (const x of probs) bad(`R-9 · ${x}`)
  }
} catch (e) {
  bad(`R 组**自身异常**（⛔ 不算通过）：${String(e?.stack ?? e)}`)
} finally {
  rmSync(WORK, { recursive: true, force: true })
}

console.log('')
console.log(`R 组：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处${fail > 0 ? ` · 没过 ${fail} 处` : ''} · **跳过 0 处**（⚠ 跳过**不计入通过**）`)
console.log('')
if (fail > 0) {
  console.log('  ⛔ R 组有失败 —— 见上面逐条')
  process.exit(1)
}
console.log('  ✅ R 组全绿（真处理体 + 真夹具；真机 HTTP 链路仍需重启后人工验）')
process.exit(0)
