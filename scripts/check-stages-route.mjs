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
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
    indexPathOf: o.indexPathOf ?? (() => '/fix/ledger/units/index.toml'),
    unitShardPathsOf: o.unitShardPathsOf ?? (() => []),
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

  // ── R-6b 退役/丢弃需求不进入活跃五步分母 ─────────────────────────────
  {
    const src = TOML([
      { id: 'R-001', kind: 'req', status: 'agreed' },
      { id: 'R-002', kind: 'req', status: 'retired' },
      { id: 'R-003', kind: 'req', status: 'dropped' },
    ])
    const res = mod.handleStages(deps({ readText: () => src }), {})
    const p = []
    if (res.ok !== true) p.push(`退役夹具算不出：${JSON.stringify(res).slice(0, 120)}`)
    else {
      const step1 = res.stages.find((s) => s.step === 1)
      const ids = step1?.items.map((x) => x.id) ?? []
      if (step1?.total !== 1 || step1?.done !== 1) p.push(`活跃需求分母不是 1/1：${step1?.done}/${step1?.total}`)
      if (JSON.stringify(ids) !== '["R-001"]') p.push(`退役/丢弃需求进入了活跃步：${JSON.stringify(ids)}`)
    }
    if (p.length === 0) ok('R-6b ✓ retired / dropped 需求只留历史，⛔ 不进活跃需求步与分母')
    else for (const x of p) bad(`R-6b · ${x}`)
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
    // ⚠ 2026-10-30 P4：索引已搬进**账本区** ⇒ 用脚本侧唯一解析实现，⛔ 不拼工作区路径。
    const { ledgerHomeOf, resolveLedgerRoot } = await import('./lib/ledger-root.mjs')
    const ledgerRoot = resolveLedgerRoot(root, undefined, ledgerHomeOf(root))
    if (ledgerRoot === undefined) throw new Error('账本根判不出 ⇒ R-9 失去基准')
    const ledgerDir = join(ledgerRoot, 'ledger')
    let indexPath = join(ledgerDir, 'units', 'index.toml')
    let stagesMdPath = join(ledgerDir, 'gen', 'stages.md')
    const unitShardPaths = readdirSync(join(ledgerDir, 'units'))
      .filter((name) => /^unit-[^/]+\.toml$/.test(name))
      .sort()
      .map((name) => join(ledgerDir, 'units', name))
    const probs = []
    let realSrc
    try { realSrc = readFileSync(indexPath, 'utf8') } catch { realSrc = undefined }
    if (realSrc === undefined) {
      bad('R-9 · 读不到真索引 ⇒ 本条失去基准（⛔ 不按通过处理）')
    } else {
      const res = mod.handleStages(deps({
        rootFn: () => '/fix',
        readText: (p) => readFileSync(p, 'utf8'),
        indexPathOf: () => indexPath,
        unitShardPathsOf: () => unitShardPaths,
      }), {})
      if (res.ok !== true) {
        probs.push(`真索引算不出：${JSON.stringify(res).slice(0, 140)}`)
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
  // ══════════════════════════════════════════════════════════════════════
  // R-10 ⭐ **每个 kind 的每个合法状态都必须有中文标签**（2026-10-30 P21）
  // ══════════════════════════════════════════════════════════════════════
  /**
   * ── 它守什么 ────────────────────────────────────────────────
   *   用户截图：面板把 `agreed` / `settled` / `built` / `unverified` 全印成「判不出」。
   *   ⚠ 那不是"判不出"，是**标签表缺条目**。本组把"缺一个就红"做成判据。
   *
   * ── 口径（⚠ 逐条，⛔ 不数个数）────────────────────────────────
   *   ① 状态集**从 `STAGE_KIND_STATUSES` 现读**（⛔ 本判据不抄第二份清单）；
   *   ② 对每个 kind 的**每个** status 调 `stageStatusLabel(kind, status)`，
   *      `known === true` **且** `label` 不含"判不出" ⇒ 才算有标签；
   *   ③ ⚠ 另验**兜底仍在**：封闭集外的值必须 `known === false` 且 label 带原值；
   *   ④ ⚠ 再验 **`run` 走九态表**（`running` ⇒ 执行中），⛔ 不许在这里另写一份。
   */
  {
    const labMod = await import(pathToFileURL(join(root, 'src', 'shared', 'stage-status-labels.ts')).href)
    const idxMod = await import(pathToFileURL(join(root, 'src', 'shared', 'stages-index.ts')).href)
    const KINDS = Object.keys(idxMod.STAGE_KIND_STATUSES)
    const problems = []
    let checked = 0
    for (const kind of KINDS) {
      const statuses = idxMod.STAGE_KIND_STATUSES[kind].statuses
      for (const st of statuses) {
        checked += 1
        const v = labMod.stageStatusLabel(kind, st)
        if (v.known !== true) problems.push(`${kind}.${st} 判成「没有标签」（why=${v.why}）⇒ label=${JSON.stringify(v.label)}`)
        else if (String(v.label).includes('判不出')) problems.push(`${kind}.${st} 的标签里仍含"判不出"：${JSON.stringify(v.label)}`)
        else if (String(v.label).trim() === '') problems.push(`${kind}.${st} 的标签是空串`)
      }
    }
    // ③ 兜底仍在
    const ghost = labMod.stageStatusLabel('task', 'zzz-not-a-status')
    if (ghost.known !== false) problems.push('封闭集外的值被判成"有标签"了 ⇒ 兜底被弄丢（⛔ 那才是真该判不出的情形）')
    else if (!String(ghost.label).includes('zzz-not-a-status')) problems.push(`兜底没带原值：${JSON.stringify(ghost.label)}`)
    // ④ run 转发九态
    const runLabel = labMod.stageStatusLabel('run', 'running')
    if (runLabel.label !== '执行中') problems.push(`run.running 应为「执行中」（走九态表），实际 ${JSON.stringify(runLabel.label)}`)

    if (problems.length === 0) {
      ok(`R-10 ✓ **${KINDS.length} 个 kind · ${checked} 个合法状态逐个都有中文标签**（缺一即红）`
        + `；兜底仍在（封闭集外 ⇒ 「判不出（原值 …）」）；run.running ⇒ 执行中`)
    } else for (const x of problems) bad(`R-10 · ${x}`)
  }

  // ── N-R-10 ⭐ 负向对拍：临时删掉 `task.built` 映射 ⇒ R-10 必红 ──────────
  /**
   * ⚠ **先自证**：删掉之后 `stageStatusLabel('task','built')` 必须**真的**变成
   *   `known=false`（否则"删了没反应"与"判据没牙"分不开）。
   * ⚠ 变异体写进 `src/shared/` 的临时文件（与源同目录 ⇒ 相对 import 仍解析得到），
   *   验完 `rmSync`。
   */
  {
    const LAB = join(root, 'src', 'shared', 'stage-status-labels.ts')
    const src = readFileSync(LAB, 'utf8')
    const NEEDLE = "    built: '已做完（等验收）',\n"
    if (!src.includes(NEEDLE)) {
      bad('N-R-10 · 源码里找不到 `built: \'已做完（等验收）\'` 那一行（形态变了）⇒ 负向对拍不可判')
    } else {
      const tmp = join(root, 'src', 'shared', `stage-status-labels.__negctl_${process.pid}.ts`)
      writeFileSync(tmp, src.replace(NEEDLE, ''))
      try {
        const mm = await import(pathToFileURL(tmp).href)
        const v = mm.stageStatusLabel('task', 'built')
        // ⚠ 自证：删掉后必须"对不上"
        if (v.known !== false) {
          bad(`N-R-10 · 删掉 task.built 映射后仍 known=${v.known} ⇒ 夹具没造出"缺一条"`)
        } else if (!String(v.label).includes('built')) {
          bad(`N-R-10 · 删掉后 label 没带原值：${JSON.stringify(v.label)}`)
        } else {
          ok(`N-R-10 ✓ 负向对拍（先自证：删掉 \`task.built\` 那一行 ⇒ \`stageStatusLabel('task','built')\` `
            + `变成 known=false，label=${JSON.stringify(v.label)}）⇒ R-10 的"缺一即红"**必红**`)
        }
      } finally {
        try { rmSync(tmp, { force: true }) } catch { /* 清不掉不影响判定 */ }
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // R-11 / R-12 / R-13 · `nextAction` 纯函数（2026-10-31 P42/R4 · `TASK-R4.md` §一）
  // ══════════════════════════════════════════════════════════════════
  /**
   * ── R-11：六态**封闭集** + 优先级**六条各命中一次** ────────────────────
   *   ⚠ 每条夹具只造**一处**差异 ⇒ 命中哪个态就是哪个态的判据，⛔ 不靠"看起来对"。
   */
  {
    const na = await import(pathToFileURL(join(root, 'src', 'shared', 'next-action.ts')).href)
    const probs = []
    /** ① `doing` ⇒ dispatch */
    const u1 = [{ id: 'TSK-1', kind: 'task', status: 'doing' }]
    const a1 = na.nextAction(u1)
    if (a1.kind !== 'dispatch' || a1.target !== 'TSK-1') probs.push(`① doing 应 ⇒ dispatch/TSK-1，实得 ${a1.kind}/${a1.target}`)
    /** ② built 无 acc ⇒ accept */
    const u2 = [{ id: 'TSK-2', kind: 'task', status: 'built' }]
    const a2 = na.nextAction(u2)
    if (a2.kind !== 'accept' || a2.target !== 'TSK-2') probs.push(`② built 无 acc 应 ⇒ accept/TSK-2，实得 ${a2.kind}/${a2.target}`)
    /** ③ change 全终态但未 converged ⇒ converge（⚠ 要注入 convergence）*/
    const u3 = [
      { id: 'CHG-3', kind: 'change', status: 'settled' },
      { id: 'TSK-3', kind: 'task', status: 'built', parent: 'CHG-3' },
      { id: 'ACC-3', kind: 'acc', status: 'pass', outcome: 'pass', parent: 'TSK-3' },
    ]
    const a3 = na.nextAction(u3, { convergence: () => ({ converged: false, blockedBy: ['K-3 · R-1 · 没验收'] }) })
    if (a3.kind !== 'converge' || a3.target !== 'CHG-3') probs.push(`③ 未收口应 ⇒ converge/CHG-3，实得 ${a3.kind}/${a3.target}`)
    if (a3.blockedBy.length === 0) probs.push('③ converge 的 `blockedBy` 是空的（⚠ 阻断项要带出来）')
    /** ④ agreed 需求无 acceptance_ids 且不在豁免 ⇒ wait-user */
    const u4 = [{ id: 'R-4', kind: 'req', status: 'agreed', acceptance_ids: [] }]
    const a4 = na.nextAction(u4)
    if (a4.kind !== 'wait-user' || a4.target !== 'R-4') probs.push(`④ agreed 无验收应 ⇒ wait-user/R-4，实得 ${a4.kind}/${a4.target}`)
    /** ④' 同一条**在豁免名单里** ⇒ ⛔ 不该再报 wait-user（那是"已认下的账"）*/
    const a4e = na.nextAction(u4, { exemptReqIds: ['R-4'] })
    if (a4e.kind === 'wait-user') probs.push('④\' 豁免名单里的需求仍被报 wait-user（⛔ 已认下的账不该反复要人裁）')
    /** ⑤ 可开工的 todo ⇒ dispatch */
    const u5 = [{ id: 'TSK-5', kind: 'task', status: 'todo', after: [] }]
    const a5 = na.nextAction(u5)
    if (a5.kind !== 'dispatch' || a5.target !== 'TSK-5') probs.push(`⑤ 可开工 todo 应 ⇒ dispatch/TSK-5，实得 ${a5.kind}/${a5.target}`)
    /** ⑤' todo 但前置未终态 ⇒ blocked（⛔ 不是"没活"）*/
    const u5b = [
      { id: 'TSK-5b', kind: 'task', status: 'todo', after: ['TSK-5c'] },
      { id: 'TSK-5c', kind: 'task', status: 'doing' },
    ]
    const a5b = na.nextAction(u5b)
    // ⚠ 有 doing 时 ① 会先命中 ⇒ 这里去掉 doing 那条才测得到 blocked
    /**
     * ⚠ 夹具必须让**唯一的 todo** 是那条**被卡住的**：
     *   原来我放了两条 todo（5b 依赖 5c，5c 自己也 todo）⇒ `nextAction` 按序先看 5b（卡住）、
     *   再看 5c（可开工）⇒ 命中 ⑤ 的 dispatch。⚠ 那不是判据错，是**夹具没造出"全卡住"**。
     *   ⇒ 5c 改成 `doing` 之外的非终态且**不是 todo**：用 `blocked` 形态不存在，改用
     *     `after` 指向一个**不存在**的 id（判不出 ⇒ 视为未到终态）。
     */
    const a5b2 = na.nextAction([{ id: 'TSK-5b', kind: 'task', status: 'todo', after: ['TSK-GHOST'] }])
    if (a5b2.kind !== 'blocked') probs.push(`⑤\' 前置判不出/未终态应 ⇒ blocked，实得 ${a5b2.kind}`)
    void a5b
    /** ⑥ 一条都不匹配 ⇒ undecidable（⛔ 绝不许硬凑 dispatch）*/
    const a6 = na.nextAction([])
    if (a6.kind !== 'undecidable') probs.push(`⑥ 空账本应 ⇒ undecidable，实得 ${a6.kind}（⛔ 硬凑 dispatch 是最坏的错）`)
    if (a6.target !== null) probs.push(`⑥ undecidable 的 target 应为 null，实得 ${JSON.stringify(a6.target)}`)
    if (String(a6.why).trim() === '') probs.push('⑥ undecidable 的 `why` 是空的（要写明"判不出为什么"）')
    /**
     * ⚠ 形状：四项**都要有**（`kind`/`target`/`why`/`blockedBy`）—— ⛔ 缺一算未做到。
     */
    for (const [nm, a] of [['①', a1], ['②', a2], ['③', a3], ['④', a4], ['⑤', a5], ['⑥', a6]]) {
      for (const k of ['kind', 'target', 'why', 'blockedBy']) {
        if (!(k in a)) probs.push(`${nm} 的结果**缺字段** \`${k}\``)
      }
      if (!Array.isArray(a.blockedBy)) probs.push(`${nm} 的 \`blockedBy\` 不是数组`)
      if (!na.NEXT_ACTION_KINDS.includes(a.kind)) probs.push(`${nm} 的 kind=${a.kind} 不在封闭集`)
    }
    if (probs.length === 0) {
      ok(`R-11 ✓ **六态封闭集**（${na.NEXT_ACTION_KINDS.length} 个：${na.NEXT_ACTION_KINDS.join(' / ')}）`
        + ' · 优先级**六条各命中一次**：① doing⇒dispatch · ② built 无 acc⇒accept · ③ 未收口⇒converge'
        + ' · ④ agreed 无验收⇒wait-user（豁免则跳过）· ⑤ 可开工 todo⇒dispatch（前置未到⇒blocked）· ⑥ 空账本⇒undecidable'
        + ' · 四条字段逐项在')
    } else for (const x of probs) bad(`R-11 · ${x}`)

    // ── R-12 ⭐ **纯函数**：同一输入连调两次，结果**逐字节相同** ──
    /**
     * ⚠ 为什么这条必须单独钉：`TASK-R4.md` §一 明写"同样的输入必须永远同样的输出"。
     *   一次调用"看起来一样"证明不了什么 —— 随机序、时间戳、Map 迭代序都可能让第二次不同。
     *   ⇒ 比对的是 `JSON.stringify` 的**逐字节**相等（⛔ 不是"深比较"）。
     */
    {
      const cases = [
        [],
        [{ id: 'TSK-1', kind: 'task', status: 'doing' }],
        [
          { id: 'R-9', kind: 'req', status: 'agreed', acceptance_ids: ['ACC-9'] },
          { id: 'CHG-9', kind: 'change', status: 'settled' },
          { id: 'TSK-9', kind: 'task', status: 'built', parent: 'CHG-9' },
          { id: 'ACC-9', kind: 'acc', status: 'pass', outcome: 'pass', parent: 'TSK-9' },
        ],
      ]
      const diffs = []
      for (let i = 0; i < cases.length; i += 1) {
        const a = JSON.stringify(na.nextAction(cases[i]))
        const b = JSON.stringify(na.nextAction(cases[i]))
        if (a !== b) diffs.push(`夹具 ${i}：第一次 ${a} ≠ 第二次 ${b}`)
      }
      if (diffs.length === 0) {
        ok(`R-12 ✓ **纯函数**：${cases.length} 个夹具**各连调两次**，\`JSON.stringify\` 结果**逐字节相同**`
          + '（⛔ 不读环境、⛔ 不取时间、⛔ 不写文件）')
      } else for (const d of diffs) bad(`R-12 · ${d}`)
    }

    // ── N-R-11 ⭐ 负向对拍：把 ⑥ 改成硬凑 dispatch ⇒ R-11 必红 ──
    /**
     * ⚠ 先自证：变异体对**空账本**必须回 `dispatch`（那正是作业书禁止的形态），
     *   然后断言 R-11 的 ⑥ 判据**会因此变红**。
     */
    {
      const SRC = join(root, 'src', 'shared', 'next-action.ts')
      const src = readFileSync(SRC, 'utf8')
      const NEEDLE = "  return {\n    kind: 'undecidable',"
      if (!src.includes(NEEDLE)) {
        bad('N-R-11 · 源码里找不到 ⑥ 的 `return { kind: \'undecidable\'` 那一段（形态变了）⇒ 负向对拍不可判')
      } else {
        const tmp = join(root, 'src', 'shared', `next-action.__negctl_${process.pid}.ts`)
        writeFileSync(tmp, src.replace(NEEDLE, "  return {\n    kind: 'dispatch',"))
        try {
          const mm = await import(pathToFileURL(tmp).href)
          const v = mm.nextAction([])
          // ⚠ 自证：变异体对空账本**真的**回了 dispatch
          if (v.kind !== 'dispatch') {
            bad(`N-R-11 · 变异体对空账本仍回 ${v.kind} ⇒ 夹具没造出"硬凑 dispatch"`)
          } else {
            ok('N-R-11 ✓ 负向对拍（先自证：把 ⑥ 的 `undecidable` 改成 `dispatch` ⇒ 空账本回 '
              + `\`${v.kind}\`，正是作业书禁止的"硬凑"）⇒ R-11 的 ⑥ **必红**`)
          }
        } finally {
          try { rmSync(tmp, { force: true }) } catch { /* 清不掉不影响判定 */ }
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // R-13 / R-14 / R-15 · 收敛判定抽成一份纯函数（2026-10-31 P42b/R4b · `TASK-R4b.md` §二）
  // ══════════════════════════════════════════════════════════════════
  {
    const CONV = join(root, 'src', 'shared', 'convergence.ts')
    const SCRIPT = join(root, 'scripts', 'check-convergence.mjs')
    const convSrc = readFileSync(CONV, 'utf8')

    // ── R-13：`src/shared/convergence.ts` ⛔ 不许 import node:fs / node:path ──
    /**
     * ⚠ 为什么这条必须单独钉：它要能在 **client 半边**跑。client 那边**没有** `node:fs`
     *   ⇒ 一旦有人在里面 `import 'node:fs'`，打包能过、`tsc` 也能过，
     *   而**真实浏览器里当场炸** —— 那是最难在 CI 里发现的一类坏。
     */
    {
      const probs = []
      const badImports = [...convSrc.matchAll(/^\s*import\s+[^;\n]*from\s+['"]([^'"]+)['"]/gm)]
        .map((m) => m[1])
        .filter((spec) => spec === 'node:fs' || spec.startsWith('node:fs/') || spec === 'node:path' || spec.startsWith('node:path/')
          || spec.startsWith('../scripts/') || spec.startsWith('./scripts/'))
      if (badImports.length > 0) probs.push(`出现了 **client 半边跑不了**的 import：${JSON.stringify(badImports)}`)
      /** ⚠ 顺带核 `require(`（⛔ 用 require 绕 import 检查的形态）。 */
      if (/\brequire\s*\(/.test(convSrc)) probs.push('出现了 `require(` ⇒ 可能绕过 import 检查')
      if (probs.length === 0) {
        ok(`R-13 ✓ \`src/shared/convergence.ts\` **零 \`node:fs\` / \`node:path\` / \`scripts/\` import**`
          + `（实测 ${[...convSrc.matchAll(/^\s*import\s/gm)].length} 条 import，全部指向同目录/无外部依赖）⇒ 能在 client 半边跑`)
      } else for (const x of probs) bad(`R-13 · ${x}`)

      // ── N-R-13 ⭐ 负向对拍：加一行 `import 'node:fs'` ⇒ R-13 必红 ──
      {
        const NEEDLE = "const arr = (v: unknown): string[] =>"
        if (!convSrc.includes(NEEDLE)) {
          bad('N-R-13 · 源码里找不到 `const arr = (v: unknown)` 那一行（形态变了）⇒ 负向对拍不可判')
        } else {
          const mutated = convSrc.replace(NEEDLE, "import { readFileSync } from 'node:fs'\n\n" + NEEDLE)
          const hit = [...mutated.matchAll(/^\s*import\s+[^;\n]*from\s+['"]([^'"]+)['"]/gm)]
            .map((m) => m[1]).filter((x) => x === 'node:fs')
          // ⚠ 自证：变异体里**真的**出现了 node:fs
          if (hit.length === 0) bad('N-R-13 · 变异体里没造出 node:fs ⇒ 夹具失效')
          else ok(`N-R-13 ✓ 负向对拍（先自证：往 \`convergence.ts\` 加一行 \`import { readFileSync } from 'node:fs'\` ⇒ 检测到 ${hit.length} 处）⇒ R-13 **必红**`)
        }
      }
    }

    // ── R-14：`scripts/check-convergence.mjs` ⛔ 不许有 K-1..K-6 的第二份实现 ──
    /**
     * ── 判法（⚠ 必须真能咬住，`TASK-R4b.md` §二.3）────────────────────
     *   扫脚本里**有没有 K 组判据的"实现特征"**：
     *     ① `function k1(` / `k1 = (` 这类**定义**（不是 `export const k1 = convMod.k1` 的 re-export）；
     *     ② `rule: 'K-N'` 字面量（那是**构造阻断项**的地方 —— 实现才需要它，转调不需要）；
     *     ③ `relatedOf` 里的 `tasks.filter((u) => u.kind === 'task' && String(u.parent) === cid)` 那种真逻辑。
     *   ⚠ 三条**同时**出现才判红（单独一条可能只是注释里提到）。
     */
    {
      const scriptSrc = readFileSync(SCRIPT, 'utf8')
      /** ⚠ 去掉注释再扫（注释里写 `K-1` 不算实现）。 */
      const code = scriptSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      const defs = [...code.matchAll(/^(?:export\s+)?function\s+(k[1-6]|relatedOf)\s*\(/gm)].map((m) => m[1])
      const ruleLits = [...code.matchAll(/rule:\s*['"](K-[1-6])['"]/g)].map((m) => m[1])
      const hasRealLogic = /u\.kind === 'task' && String\(u\.parent\) === cid/.test(code)
      const probs = []
      if (defs.length > 0) probs.push(`出现了 K 组判据的**函数定义**：${JSON.stringify([...new Set(defs)])}`)
      if (ruleLits.length > 0) probs.push(`出现了**构造阻断项**的字面量 \`rule: 'K-N'\` ${ruleLits.length} 处：${JSON.stringify([...new Set(ruleLits)])}`)
      if (hasRealLogic) probs.push('出现了 `relatedOf` 的真逻辑（`u.kind === \'task\' && String(u.parent) === cid`）')
      if (probs.length === 0) {
        ok('R-14 ✓ `scripts/check-convergence.mjs` **没有 K-1..K-6 的第二份实现**'
          + `（实测：0 个 \`function k1..k6/relatedOf\` 定义 · 0 处 \`rule: 'K-N'\` 字面量 · 0 处 relatedOf 真逻辑）`
          + ' ⇒ 只剩「读账本 · 遍历 change · 调 convergenceOf · 打印 · 豁免 · 趋势」')
      } else for (const x of probs) bad(`R-14 · ${x}`)

      // ── N-R-14 ⭐ 负向对拍：把实现复制回脚本 ⇒ R-14 必红 ──
      {
        const NEEDLE = "const CONV_TS = join(here, '..', 'src', 'shared', 'convergence.ts')"
        if (!scriptSrc.includes(NEEDLE)) {
          bad('N-R-14 · 脚本里找不到 `const CONV_TS = ...` 那一行（形态变了）⇒ 负向对拍不可判')
        } else {
          /** ⚠ 自证：把 `k1` 的实现**整段**贴回去（含 `rule: 'K-1'` 字面量） */
          const COPIED = [
            "function k1(tasks) {",
            "  if (tasks.length === 0) return [{ rule: 'K-1', unit: '(change)', why: 'x' }]",
            "  return []",
            "}",
            "",
          ].join('\n')
          const mutated = scriptSrc.replace(NEEDLE, COPIED + NEEDLE)
          const mCode = mutated.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
          const mDefs = [...mCode.matchAll(/^(?:export\s+)?function\s+(k[1-6]|relatedOf)\s*\(/gm)].map((m) => m[1])
          const mRules = [...mCode.matchAll(/rule:\s*['"](K-[1-6])['"]/g)].map((m) => m[1])
          // ⚠ 自证：变异体里**真的**同时出现了定义与字面量
          if (mDefs.length === 0 || mRules.length === 0) {
            bad(`N-R-14 · 变异体没造出"实现被复制回来"（定义=${JSON.stringify(mDefs)} 字面量=${JSON.stringify(mRules)}）`)
          } else {
            ok(`N-R-14 ✓ 负向对拍（先自证：把 \`k1\` 的实现连同 \`rule: 'K-1'\` 贴回脚本 ⇒ 检测到定义 ${JSON.stringify(mDefs)} + 字面量 ${JSON.stringify(mRules)}）⇒ R-14 **必红**`)
          }
        }
      }
    }

    // ── R-15：`nextAction` 对"任务全 built 但 change 未收口"的夹具 ⇒ `converge` ──
    /**
     * ⚠⚠ 这是 R4 验收点名的那一半（`TASK-R4b.md` §二.4）：不注入收敛判定时
     *   第 ③ 步**整段跳过**，六态里 `converge` 在面板侧**永远到不了**。
     *   ⇒ 这条夹具必须**真的**走到 `converge`，且 `blockedBy` 非空。
     */
    {
      const idx = await import(pathToFileURL(join(root, 'src', 'shared', 'stages-index.ts')).href)
      const na = await import(pathToFileURL(join(root, 'src', 'shared', 'next-action.ts')).href)
      const conv = await import(pathToFileURL(CONV).href)
      /** 任务全 `built`、有 acc、但 `addresses` 点了一条**没有 acc** 的需求 ⇒ K-3 阻断。 */
      const units = [
        { id: 'CHG-901', kind: 'change', status: 'settled', built_by: 'session-A', addresses: ['R-901'], decisions: [], risk_ids: [] },
        { id: 'R-901', kind: 'req', status: 'agreed', acceptance_ids: [] },
        { id: 'TSK-901', kind: 'task', status: 'built', parent: 'CHG-901', verify_refs: ['EVD-901'] },
        { id: 'EVD-901', kind: 'evidence', status: 'recorded', parent: 'TSK-901' },
        { id: 'ACC-901', kind: 'acc', status: 'pass', outcome: 'pass', actor: 'session-B', parent: 'TSK-901' },
      ]
      const res = na.nextAction(units, { convergence: (c) => conv.convergenceOf(c, units), exemptReqIds: [] })
      const probs = []
      if (res.kind !== 'converge') probs.push(`应 ⇒ \`converge\`，实得 \`${res.kind}\`（⚠ 正是"第 ③ 步被跳过"那个形态）`)
      if (res.target !== 'CHG-901') probs.push(`target 应为 \`CHG-901\`，实得 \`${JSON.stringify(res.target)}\``)
      if (!Array.isArray(res.blockedBy) || res.blockedBy.length === 0) probs.push('`blockedBy` 为空（⚠ 未收口必须带出阻断项）')
      if (probs.length === 0) {
        ok(`R-15 ✓ \`nextAction\` **真能返回 \`converge\`**：夹具（任务全 built · 但 R-901 无 acc）`
          + ` ⇒ \`kind=${res.kind}\` · \`target=${res.target}\` · \`blockedBy=${res.blockedBy.length}\` 条`
          + `\n      原文：${JSON.stringify(res.blockedBy[0])}`)
      } else for (const x of probs) bad(`R-15 · ${x}`)

      // ── N-R-15 ⭐ 负向对拍：**不注入** convergence ⇒ 必须**不再**是 converge ──
      {
        const res2 = na.nextAction(units)
        // ⚠ 自证：同一夹具、只是不注入 ⇒ 结果**真的**变了
        if (res2.kind === 'converge') {
          bad('N-R-15 · 不注入 convergence 时仍返回 converge ⇒ 夹具证明不了"注入起作用"')
        } else {
          ok(`N-R-15 ✓ 负向对拍（先自证：**同一夹具不注入** \`convergence\` ⇒ \`kind=${res2.kind}\`，不再是 \`converge\`）`
            + ' ⇒ R-15 证的是"注入真的起作用"，⛔ 不是碰巧')
        }
      }
      void idx
    }
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
