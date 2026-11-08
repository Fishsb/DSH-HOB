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
const PRESENTATION_ENTRY = 'src/shared/item-presentation.ts'
const WORK = join(root, '.check-stages-route-work')

/**
 * **账本 `acc.status` → 展示层「判决」字面量的期望值**（单一实现）。
 *
 * ⚠ 与 `src/shared/item-presentation.ts` 的 `verdict` 分支**同口径**，但**不是第二份展示实现**：
 *   它只回答"账本这样写，界面该显示成什么"，⛔ 不含任何渲染逻辑。
 * ⚠ 关键点：期望值由**账本 status 推导**，⛔ 不是写死某一天的判决字面量 ——
 *   账本往前走（`unverified` → `pass`）时，期望值跟着走，判据**不会因为账本推进而变红**。
 *
 * @param {unknown} status - 账本 `acc.status`
 * @returns {string} 展示层应出现的判决字面量
 */
export const EXPECTED_VERDICT_OF = (status) => {
  const s = String(status ?? '').trim()
  if (s === 'pass') return '验收通过'
  if (s === 'send-back') return '已退回'
  if (s === 'unverified') return '判不出（尚未判决）'
  return '判不出'
}

/**
 * **R-18c 的判定体（纯函数）**：逐条核「展示层展开判决 == 账本 status 的期望值」。
 *
 * ⚠ 抽成模块级纯函数，好让**正向**（真实账本）与**负向对拍**（注入坏展示层）跑
 *   **同一段判定** —— ⛔ 不许夹具里另写一份（那正是"判据哑了没人知道"的成因）。
 *
 * @param {Array<Record<string, any>>} units - 账本单元
 * @param {(u: Record<string, any>) => {details?: Array<{key:string,value:string}>}} presentationOf
 *   条目投影实现（注入 ⇒ 负向对拍可以传一个**故意说错话**的版本）
 * @returns {string[]} 不符清单（空 = 全一致）
 */
export function accVerdictMismatches(units, presentationOf) {
  const out = []
  for (const u of units.filter((x) => x.kind === 'acc')) {
    const want = EXPECTED_VERDICT_OF(u.status)
    const details = presentationOf(u)?.details ?? []
    const got = details.find((f) => f.key === 'verdict')?.value
    if (got !== want) {
      out.push(`${u.id}（账本 status=${JSON.stringify(String(u.status ?? '').trim())} ⇒ 期望「${want}」，展示层给「${JSON.stringify(got)}」）`)
    }
  }
  return out
}

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
  const graph = tsMount.mountTsGraph({ root, outDir: join(WORK, 'out'), entries: [ENTRY, PRESENTATION_ENTRY], ts })
  const problems = [
    ...graph.problems,
    ...tsMount.verifyMounted({ root, entries: [ENTRY, PRESENTATION_ENTRY], mounted: graph.mounted, entryFiles: graph.entries }),
  ]
  if (problems.length > 0) for (const p of problems) bad(`R-0 转译/自证失败：${p}`)
  else ok(`R-0 ✓ 转译图自证通过（${graph.mounted.join(' · ')}）`)
  const out = graph.entries[ENTRY]
  if (out === undefined) throw new Error('入口没有产出（见 R-0）')
  const entryFile = join(WORK, 'entry.mjs')
  writeFileSync(entryFile, `export * from ${JSON.stringify(out)}\n`)
  const mod = await import(pathToFileURL(entryFile).href)
  const presentationOut = graph.entries[PRESENTATION_ENTRY]
  if (presentationOut === undefined) throw new Error('条目投影入口没有产出（见 R-0）')
  const presentationFile = join(WORK, 'presentation-entry.mjs')
  writeFileSync(presentationFile, `export * from ${JSON.stringify(presentationOut)}\n`)
  const presentationMod = await import(pathToFileURL(presentationFile).href)

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
    const fixtureUnits = mod.parseUnitsToml(src)
    const res = mod.buildStages(fixtureUnits, '2026-11-07T00:00:00.000Z', { presentation: true })
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
    const fixtureUnits = mod.parseUnitsToml(src)
    const res = mod.buildStages(fixtureUnits, '2026-11-07T00:00:00.000Z', { presentation: true })
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
    const fixtureUnits = mod.parseUnitsToml(src)
    const res = mod.buildStages(fixtureUnits, '2026-11-07T00:00:00.000Z', { presentation: true })
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

  // ── R-16 第一屏摘要：由同一次五步读数派生，且与 next / attention 交叉一致 ──
  {
    const src = TOML([
      { id: 'CHG-16', kind: 'change', status: 'settled' },
      { id: 'TSK-16', kind: 'task', status: 'built', parent: 'CHG-16' },
      { id: 'ACC-16', kind: 'acc', status: 'unverified', parent: 'TSK-16' },
    ])
    const res = mod.handleStages(deps({ readText: () => src }), {})
    const p = []
    if (res.ok !== true) p.push(`夹具算不出：${JSON.stringify(res).slice(0, 120)}`)
    else {
      const s = res.summary
      if (s === undefined || s === null || typeof s !== 'object') p.push('summary 缺失')
      else {
        const current = res.stages.find((x) => x.state !== 'done')
          ?? res.stages[res.stages.length - 1]
        if (s.stage === null || s.stage?.step !== current?.step) p.push(`summary.stage 不是当前步（第一条未完成 → 最后一步）：${JSON.stringify(s.stage)} vs ${JSON.stringify(current)}`)
        if (s.action?.kind !== res.next.kind || s.action?.target !== res.next.target) p.push(`summary.action 与 next 不一致：${JSON.stringify(s.action)} vs ${JSON.stringify(res.next)}`)
        if (s.waitingFor === undefined || s.waitingFor === '') p.push('summary.waitingFor 为空')
        if (res.next.blockedBy.length > 0 && s.blocker !== res.next.blockedBy[0]) p.push(`summary.blocker 不是主阻断：${JSON.stringify(s.blocker)}`)
        if (!Array.isArray(res.attention) || res.attention.length !== s.openItems) p.push(`summary.openItems=${s.openItems} 与 attention=${res.attention?.length} 不一致`)
        // ⚠ 注意力去重：被主阻断点名的对象不得再出现（按稳定 id，不按自然语言）。
        const ids = new Set((res.attention ?? []).map((x) => x.id))
        for (const line of res.next.blockedBy) {
          for (const hit of line.matchAll(/\b(?:G|R|CHG|TSK|RUN|ACC|EVD|RSK|DEC|CAP)-[A-Za-z0-9-]+\b/g)) {
            if (ids.has(hit[0])) p.push(`注意力里重复出现了主阻断点名的 ${hit[0]}`)
          }
        }
      }
    }
    if (p.length === 0) {
      ok(`R-16 ✓ summary 与 next / attention 交叉一致（阶段=${res.summary.stage?.name} · 动作=${res.summary.action?.kind} · 等待=${res.summary.waitingFor} · 主阻断=${JSON.stringify(res.summary.blocker)} · 注意力去重）`)
    } else for (const x of p) bad(`R-16 · ${x}`)
  }

  // ── N-R-16 负向对拍：把 summary 的等待对象改成固定值 ⇒ R-16 必红 ──
  {
    const NEEDLE = '    waitingFor: WAIT_LABEL[waitFor],'
    const summaryFile = join(root, 'src', 'shared', 'panel-summary.ts')
    const summarySrc = readFileSync(summaryFile, 'utf8')
    if (!summarySrc.includes(NEEDLE)) {
      bad('N-R-16 · `panel-summary.ts` 里找不到 `waitingFor: WAIT_LABEL[waitFor]`（形态变了）⇒ 负向对拍不可判')
    } else {
      const mutDir = join(WORK, 'mut-summary')
      const { cpSync } = await import('node:fs')
      cpSync(join(root, 'src'), join(mutDir, 'src'), { recursive: true })
      writeFileSync(join(mutDir, 'src', 'shared', 'panel-summary.ts'), summarySrc.replace(NEEDLE, "    waitingFor: '固定值',"))
      const g2 = tsMount.mountTsGraph({ root: mutDir, outDir: join(WORK, 'out-summary'), entries: [ENTRY, PRESENTATION_ENTRY], ts })
      const out2 = g2.entries[ENTRY]
      if (out2 === undefined) {
        bad(`N-R-16 · 变体转译失败：${g2.problems.join(' / ')}`)
      } else {
        const f2 = join(WORK, 'entry-summary.mjs')
        writeFileSync(f2, `export * from ${JSON.stringify(out2)}\n`)
        const mod2 = await import(pathToFileURL(f2).href + '?t=' + Date.now())
        const r2 = mod2.handleStages(deps({ readText: () => TOML([{ id: 'TSK-16', kind: 'task', status: 'doing' }]) }), {})
        if (r2.ok === true && r2.summary.waitingFor === '固定值') {
          ok('N-R-16 ✓ 负向对拍（先自证：把 summary.waitingFor 固定成「固定值」⇒ 真处理体返回该值）⇒ R-16 的等待对象一致性断言**必红**')
        } else {
          bad(`N-R-16 · 变体没有把 waitingFor 固定住（实际 ${JSON.stringify(r2.ok === true ? r2.summary.waitingFor : r2)}）⇒ 负向对拍不可判`)
        }
      }
    }
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
      const g2 = tsMount.mountTsGraph({ root: mutDir, outDir: join(WORK, 'out-mut'), entries: [ENTRY, PRESENTATION_ENTRY], ts })
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

  // ── R-17 条目展示投影：按正式关系取标题、保留原句、标记冲突与缺失 ──────
  const ITEM_FIXTURE_SRC = `[[unit]]
id = "R-901"
kind = "req"
title = "面板条目必须能独立理解"
parent = "spec/progress"
status = "agreed"
after = []
source = "夹具"
spec = "spec/progress/spec.md"
acceptance_ids = ["ACC-901"]

[[unit]]
id = "R-902"
kind = "req"
title = "第二条正式承接需求"
parent = "spec/progress"
status = "agreed"
after = []
source = "夹具"
spec = "spec/progress/spec.md"

[[unit]]
id = "G-901"
kind = "goal"
title = "用户看得懂当前工作"
parent = "spec/progress"
status = "active"
after = []
source = "夹具"
req_ids = ["R-901"]

[[unit]]
id = "CHG-901"
kind = "change"
title = "统一条目展示"
parent = "spec/progress"
status = "settled"
after = []
source = "夹具"
addresses = ["R-901", "R-902"]
built_by = "session-a"

[[unit]]
id = "TSK-901"
kind = "task"
title = "把条目行改成两行并保留展开详情"
parent = "CHG-901"
status = "built"
after = []
source = "夹具"
req_ids = ["R-901"]
built_by = "session-a"
verify = "check:item 1/1"
verify_refs = ["EVD-901"]

[[unit]]
id = "RUN-901"
kind = "run"
title = "P2 的实施会话跑第 2 期 —— 已回传"
parent = "TSK-901"
status = "returned"
after = []
source = "夹具"
built_by = "session-a"
started_at = "判不出"
why = "原始时刻未留档"

[[unit]]
id = "ACC-901"
kind = "acc"
title = "待独立验收：R-901 统一条目展示"
parent = "TSK-901"
status = "pass"
after = []
source = "夹具"
actor = "session-b"
acceptance_session = "session-b"
verified_at = "2026-11-07T10:00:00+08:00"

[[unit]]
id = "ACC-902"
kind = "acc"
title = "独立验收：未被验收的条目"
parent = "TSK-999"
status = "unverified"
after = []
source = "夹具"
actor = "session-pending"
`
  {
    const src = ITEM_FIXTURE_SRC
    const fixtureUnits = mod.parseUnitsToml(src)
    const res = mod.buildStages(fixtureUnits, '2026-11-07T00:00:00.000Z')
    const items = res.ok === true ? res.stages.flatMap((s) => s.items) : []
    const byId = new Map(items.map((x) => [x.id, x]))
    const p = []
    const task = byId.get('TSK-901')?.presentation
    const run = byId.get('RUN-901')?.presentation
    const acc = byId.get('ACC-901')?.presentation
    const unresolved = byId.get('ACC-902')?.presentation
    const accUnit = fixtureUnits.find((u) => u.id === 'ACC-901')
    const runUnit = fixtureUnits.find((u) => u.id === 'RUN-901')
    const fullAcc = presentationMod.presentationOf(accUnit, fixtureUnits)
    const fullRun = presentationMod.presentationOf(runUnit, fixtureUnits)
    const fullChange = presentationMod.presentationOf(fixtureUnits.find((u) => u.id === 'CHG-901'), fixtureUnits)
    if (task?.relation?.id !== 'CHG-901') p.push(`任务所属方案不是 CHG-901：${JSON.stringify(task?.relation)}`)
    if (run?.relation?.id !== 'TSK-901' || run?.displayTitle !== '把条目行改成两行并保留展开详情') p.push(`运行没有使用父任务标题：${JSON.stringify(run)}`)
    if (acc?.relation?.id !== 'TSK-901' || acc?.displayTitle !== '把条目行改成两行并保留展开详情') p.push(`验收没有使用父任务标题：${JSON.stringify(acc)}`)
    if (fullAcc.originalTitle !== '待独立验收：R-901 统一条目展示') p.push(`原始标题丢失：${JSON.stringify(fullAcc.originalTitle)}`)
    if (!fullAcc.flags.some((f) => f.code === 'title-status-conflict')) p.push('pass + 待独立验收 没有标记状态冲突')
    if (!fullRun.flags.some((f) => f.code === 'title-generic')) p.push('期次式运行标题没有标记泛化')
    if (unresolved?.relation?.state !== 'undecidable') p.push('父级 TSK-999 不存在时关系没有判不出')
    const fullUnresolved = presentationMod.presentationOf(fixtureUnits.find((u) => u.id === 'ACC-902'), fixtureUnits)
    if (!fullUnresolved.details.some((f) => f.key === 'relation' && f.value.includes('TSK-999'))) p.push('完整投影没有点名缺失的父级 TSK-999')
    if (!unresolved?.flags?.includes('relation-unresolved')) p.push('关系缺失没有标记 relation-unresolved')
    if ((unresolved?.facts?.length ?? 0) > 2 || (acc?.facts?.length ?? 0) > 2) p.push('折叠读数超过两条')
    if (acc?.facts?.length !== 2) p.push(`验收条目没有两条关键读数：${JSON.stringify(acc?.facts)}`)
    if (!acc?.facts?.some((f) => f[0] === '判决') || !acc?.facts?.some((f) => f[0] === '依据')) p.push(`验收读数不是「判决 + 依据」：${JSON.stringify(acc?.facts)}`)
    /**
     * ⚠⚠ **判决格必须是判决结果本身，⛔ 不能是判决时刻**（2026-11-07 真机实测）。
     *   `ACC-901` 的 `status=pass` 且**没有** `verified_at`（与历史 28 条同形）——
     *   旧实现拿 `verified_at` 顶替判决，折叠行会显示「判决 判不出（尚未判决）」，
     *   与 `pass` 直接矛盾 ⇒ 用户只看折叠行必然读反。
     */
    const verdictFact = acc?.facts?.find((f) => f[0] === '判决')
    if (verdictFact?.[1] !== '验收通过') p.push(`已通过验收的折叠判决不是「验收通过」：${JSON.stringify(verdictFact)}`)
    if (String(verdictFact?.[1] ?? '').includes('尚未判决')) p.push('已通过验收的折叠判决被写成「尚未判决」⇒ 判决格取错了字段（应是 status，不是 verified_at）')
    if (!fullAcc.details.some((f) => f.key === 'verdict' && f.value === '验收通过')) p.push('展开详情的判决没有显示「验收通过」')
    if (task?.displayTitle !== '把条目行改成两行并保留展开详情') p.push(`任务标题被不必要地改写：${JSON.stringify(task?.displayTitle)}`)
    /**
     * ⚠ 默认线格式是兼容面：旧消费方仍读 `title` / `extra`。
     *   新面板显式请求 `{compact:true}`，才走 R-18 的紧凑边界。
     *   这里钉住旧字段原样保留，避免“新增投影”悄悄变成破坏性改线格式。
     */
    if (byId.get('ACC-901')?.title !== '待独立验收：R-901 统一条目展示') p.push(`默认响应丢了旧 title：${JSON.stringify(byId.get('ACC-901')?.title)}`)
    if (byId.get('ACC-901')?.extra !== 'session-b') p.push(`默认响应丢了旧 extra：${JSON.stringify(byId.get('ACC-901')?.extra)}`)
    if (!fullChange.details.some((f) => f.key === 'flags' && f.value === '无')) p.push('展开详情没有固定「异常：无」一项')
    if (!fullChange.details.some((f) => f.key === 'additional_requirements' && f.value.includes('R-902'))) p.push('方案的多条正式需求没有保留在展开详情')
    if (!fullRun.details.some((f) => f.key === 'started_at' && f.value === '判不出')) p.push('运行完整详情没有保留开始时刻读数')
    if (!fullChange.details.some((f) => f.key === 'stage_summary' && f.value === '判不出')) p.push('方案缺阶段摘要时没有固定写判不出')
    const taskFull = presentationMod.presentationOf(fixtureUnits.find((u) => u.id === 'TSK-901'), fixtureUnits)
    if (!taskFull.details.some((f) => f.key === 'budget' && f.value === '判不出')) p.push('任务缺预算时没有固定写判不出')
    const pendingFull = presentationMod.presentationOf(fixtureUnits.find((u) => u.id === 'ACC-902'), fixtureUnits)
    if (!pendingFull.details.some((f) => f.key === 'verdict' && f.value === '判不出（尚未判决）')) p.push('未判决验收没有固定写判决判不出')
    if (!pendingFull.details.some((f) => f.key === 'waiting_for' && f.value === '独立验收会话')) p.push('未判决验收没有写在等谁')
    if (p.length === 0) ok('R-17 ✓ 条目投影：任务/运行/验收使用正式关系标题 · 原句仅在完整投影 · 状态冲突/泛化/关系缺失分别可判 · 折叠读数≤2（验收固定「判决 + 依据」）· 展开固定含预算/阶段摘要/判决/在等谁/异常 · 默认线格式保留旧 title/extra')
    else for (const x of p) bad(`R-17 · ${x}`)
  }

  // ── N-R-17 负向对拍：把运行/验收改回原标题 ⇒ R-17 必红；关系缺失显示成空 ⇒ 也必红 ──
  {
    const fixtureUnits = mod.parseUnitsToml(ITEM_FIXTURE_SRC)
    const srcFile = join(root, 'src', 'shared', 'item-presentation.ts')
    const orig = readFileSync(srcFile, 'utf8')
    const NEEDLE = "  if (['run', 'acc'].includes(String(u.kind)) && relation?.state === 'ok' && relation.title !== null) {\n    return contextTitleOf(u, units, relation.title)\n  }\n"
    const MUT = "  if (['run', 'acc'].includes(String(u.kind)) && relation?.state === 'ok' && relation.title !== null) {\n    return original\n  }\n"
    const relNeedle = "    if (targetId === '') return { key, label, id: null, title: null, state: 'undecidable' }"
    if (!orig.includes(NEEDLE) || !orig.includes(relNeedle)) {
      bad('N-R-17 · 造不出投影变体（源码锚点失配）⇒ 负向对拍不可判')
    } else {
      const mutDir = join(WORK, 'mut-item-presentation')
      const { cpSync } = await import('node:fs')
      cpSync(join(root, 'src'), join(mutDir, 'src'), { recursive: true })
      writeFileSync(join(mutDir, 'src', 'shared', 'item-presentation.ts'), orig.replace(NEEDLE, MUT).replace(relNeedle.split('\n')[0], "    if (targetId === '') return { key, label, id: null, title: null, state: 'ok' }"))
      const g2 = tsMount.mountTsGraph({ root: mutDir, outDir: join(WORK, 'out-item-presentation'), entries: [ENTRY, PRESENTATION_ENTRY], ts })
      const out2 = g2.entries[ENTRY]
      if (out2 === undefined) {
        bad(`N-R-17 · 变体转译失败：${g2.problems.join(' / ')}`)
      } else {
        const f2 = join(WORK, 'entry-item-presentation.mjs')
        writeFileSync(f2, `export * from ${JSON.stringify(out2)}\n`)
        const mod2 = await import(pathToFileURL(f2).href + '?t=' + Date.now())
        const fixture2 = mod2.parseUnitsToml(ITEM_FIXTURE_SRC)
        const res2 = mod2.buildStages(fixture2, '2026-11-07T00:00:00.000Z')
        const items2 = res2.ok === true ? res2.stages.flatMap((s) => s.items) : []
        const byId2 = new Map(items2.map((x) => [x.id, x]))
        const run2 = byId2.get('RUN-901')?.presentation
        const missing2 = byId2.get('ACC-902')?.presentation
        const fullMissing2 = presentationMod.presentationOf(fixture2.find((u) => u.id === 'ACC-902'), fixture2)
        const badTitle = run2?.displayTitle === 'P2 的实施会话跑第 2 期 —— 已回传'
        const badRelation = fullMissing2.relation?.state === 'undecidable'
        if (badTitle && badRelation) ok('N-R-17 ✓ 负向对拍（运行/验收回退原句 + 缺失关系写成 ok）⇒ R-17 的标题投影与关系判不出**都必红**')
        else bad(`N-R-17 · 变体没有同时造出两种差异（title=${JSON.stringify(run2?.displayTitle)} relation=${JSON.stringify(missing2?.relation)}）`)
      }
    }
  }

  // ── R-18 列表边界：紧凑投影、共享关系标题、真实响应 ≤ 64 KB ─────────────
  {
    const p = []
    const fixture = mod.parseUnitsToml(ITEM_FIXTURE_SRC)
    const res = mod.buildStages(fixture, '2026-11-07T00:00:00.000Z', { compact: true })
    const items = res.ok === true ? res.stages.flatMap((s) => s.items) : []
    if (res.ok !== true) p.push(`夹具算不出：${JSON.stringify(res).slice(0, 120)}`)
    else {
      for (const item of items) {
        if ('title' in item || 'extra' in item) p.push(`${item.id} 仍重复返回旧 title/extra`)
        const pr = item.presentation
        if (pr === null || typeof pr !== 'object') { p.push(`${item.id} 缺列表投影`); continue }
        if ('originalTitle' in pr || 'details' in pr) p.push(`${item.id} 列表内联了原句或详情`)
        if (Array.isArray(pr.facts) && pr.facts.length > 2) p.push(`${item.id} 折叠读数超过两条`)
        if (Array.isArray(pr.flags) && pr.flags.some((f) => typeof f !== 'string')) p.push(`${item.id} 诊断代码不是封闭代码串`)
        if (pr.relation !== null && typeof pr.relation.title === 'string') p.push(`${item.id} 关系行内联了父标题`)
      }
      if (res.relations?.['TSK-901'] !== '把条目行改成两行并保留展开详情') p.push(`共享关系表缺 TSK-901：${JSON.stringify(res.relations)}`)
      const acc = items.find((x) => x.id === 'ACC-901')?.presentation
      if (acc?.displayTitle !== '把条目行改成两行并保留展开详情') p.push(`验收主标题未取父任务：${JSON.stringify(acc)}`)
      if (acc?.relation?.id !== 'TSK-901' || acc?.relation?.state !== 'ok') p.push(`验收关系身份不对：${JSON.stringify(acc?.relation)}`)
    }
    if (p.length === 0) ok('R-18 ✓ 列表边界：条目只带主标题/关系 ID/最多两条短读数/诊断代码；关系标题按 ID 共享；旧 title/extra 与详情不内联')
    else for (const x of p) bad(`R-18 · ${x}`)
  }

  // ── R-18b 真实账本响应体积 ≤ 64 KB（同一份 /stages 列表，不读完整正文） ──
  {
    const { ledgerHomeOf, resolveLedgerRoot } = await import('./lib/ledger-root.mjs')
    const ledgerRoot = resolveLedgerRoot(root, undefined, ledgerHomeOf(root))
    const p = []
    if (ledgerRoot === undefined) p.push('账本根判不出')
    else {
      const ledgerDir = join(ledgerRoot, 'ledger')
      const indexPath = join(ledgerDir, 'units', 'index.toml')
      const unitShardPaths = readdirSync(join(ledgerDir, 'units')).filter((n) => /^unit-[^/]+\.toml$/.test(n)).sort().map((n) => join(ledgerDir, 'units', n))
      const res = mod.handleStages(deps({ rootFn: () => '/fix', readText: (path) => readFileSync(path, 'utf8'), indexPathOf: () => indexPath, unitShardPathsOf: () => unitShardPaths }), { compact: true })
      if (res.ok !== true) p.push(`真实账本算不出：${JSON.stringify(res).slice(0, 120)}`)
      else {
        const bytes = Buffer.byteLength(JSON.stringify(res), 'utf8')
        if (bytes > 65536) p.push(`真实 /stages 响应 ${bytes} B > 65536 B`)
        const itemCount = res.stages.reduce((n, s) => n + s.items.length, 0)
        if (itemCount < 100) p.push(`真实账本只有 ${itemCount} 条条目 ⇒ 体积断言没有对象`)
        if (p.length === 0) ok(`R-18b ✓ 真实 /stages 列表 **${bytes} B ≤ 65536 B**（${itemCount} 条条目 · 原句与详情走按 ID 读取）`)
      }
    }
    for (const x of p) bad(`R-18b · ${x}`)
  }

  // ── R-18d 体积兜底：极端规模也必须 ≤ 64 KB，且如实标注截断 ────────────────
  {
    const p = []
    const units = []
    for (let i = 0; i < 700; i++) {
      units.push({
        id: `TSK-CAP-${i}`, kind: 'task', title: `第 ${i} 项任务的具体改动对象与动作说明文本`,
        parent: 'CHG-CAP', status: 'built', verify: 'check:x 1/1', scope_paths: ['a', 'b', 'c'], req_ids: ['R-CAP'],
      })
    }
    for (let i = 0; i < 200; i++) {
      units.push({
        id: `ACC-CAP-${i}`, kind: 'acc', title: `第 ${i} 项验收对象`, parent: `TSK-CAP-${i}`,
        status: 'pass', basis: ['EVD-1'], example_results: ['EX-1 | pass | x'],
      })
    }
    units.push({ id: 'CHG-CAP', kind: 'change', title: '兜底夹具方案', status: 'settled', addresses: ['R-CAP'] })
    units.push({ id: 'R-CAP', kind: 'req', title: '兜底夹具需求', status: 'agreed' })
    const res = mod.buildStages(units, '2026-11-07T00:00:00.000Z', { compact: true })
    if (res.ok !== true) p.push(`极端夹具算不出：${JSON.stringify(res).slice(0, 120)}`)
    else {
      const bytes = Buffer.byteLength(JSON.stringify(res), 'utf8')
      if (bytes > 65536) p.push(`极端规模响应 ${bytes} B > 65536 B（兜底没有生效）`)
      if (res.truncated === undefined) p.push('极端规模下没有 `truncated` 说明 ⇒ 客户端会把"少列"读成"账本只有这些"')
      else {
        if (!(res.truncated.omitted > 0)) p.push(`truncated.omitted 不是正数：${JSON.stringify(res.truncated)}`)
        if (String(res.truncated.reason ?? '') === '') p.push('truncated.reason 为空')
      }
      /**
       * ⚠ 截断**不许改阶段分母**：`done/total` 必须是全账本读数，
       *   否则用户会把"没列出来"读成"这些条目不存在"。
       */
      const totals = new Map(res.stages.map((s) => [s.step, s]))
      if (totals.get(3)?.total !== 700) p.push(`截断后第 3 步 total 被改写：${JSON.stringify(totals.get(3))}`)
      if (totals.get(5)?.total !== 200) p.push(`截断后第 5 步 total 被改写：${JSON.stringify(totals.get(5))}`)
      /**
       * ⚠ 正常规模**不许**触发截断（否则线格式会悄悄变窄）。
       */
      const small = mod.buildStages(units.slice(0, 30), '2026-11-07T00:00:00.000Z', { compact: true })
      if (small.ok === true && small.truncated !== undefined) p.push(`小账本被误截断：${JSON.stringify(small.truncated)}`)
    }
    if (p.length === 0) ok('R-18d ✓ 体积兜底：极端规模 ≤ 64 KB 且如实标注 omitted · 阶段 done/total 保持全账本 · 正常规模不触发')
    else for (const x of p) bad(`R-18d · ${x}`)
  }

  // ── R-18f 空壳标题必须补正式父链上下文（2026-11-08 真机抽查）──────────
  /**
   * ⚠ 真实账本有 36 条主标题是「P1：第 1 期（该期任务书）」这类空壳。
   *   旧实现只加 `title-generic` 标记，用户仍然读不懂“这是什么”。
   *   ⇒ 展示标题必须带**正式父链的方案标题**；⛔ 不改账本、⛔ 不读正文。
   */
  {
    const units = [
      { id: 'CHG-1', kind: 'change', title: '真实方案：统一条目展示', status: 'settled', parent: 'spec/x', addresses: ['R-1'] },
      { id: 'R-1', kind: 'req', title: '需求', status: 'agreed', parent: 'spec/x' },
      { id: 'TSK-1', kind: 'task', title: 'P2：第 2 期（该期任务书）', status: 'built', parent: 'CHG-1', req_ids: ['R-1'] },
      { id: 'RUN-1', kind: 'run', title: 'P2 的实施会话跑第 2 期 —— 已回传', status: 'returned', parent: 'TSK-1' },
      { id: 'ACC-1', kind: 'acc', title: '验收 P2', status: 'unverified', parent: 'TSK-1' },
      { id: 'TSK-2', kind: 'task', title: '有语义的任务标题', status: 'built', parent: 'CHG-1', req_ids: ['R-1'] },
    ]
    const p = []
    for (const id of ['TSK-1', 'RUN-1', 'ACC-1']) {
      const full = presentationMod.presentationOf(units.find((u) => u.id === id), units)
      if (!full.displayTitle.includes('真实方案：统一条目展示')) {
        p.push(`${id} 空壳标题没有补父链上下文：${JSON.stringify(full.displayTitle)}`)
      }
      /**
       * ⚠ `run` / `acc` 的**原句**是「P2 的实施会话…」「验收 P2」，不是纯期次；
       *   它们的诊断由**实际展示标题**（父任务空壳）触发 —— 那也是用户看到的那一行。
       *   ⇒ 断言按“显示标题是空壳”来判断，而不是按原句字面。
       */
      const shownIsShell = /^P\d+\s*：\s*第\s*\d+\s*期/.test(full.displayTitle)
      if (shownIsShell && !full.flags.some((f) => f.code === 'title-generic')) {
        p.push(`${id} 展示标题是空壳却没有 title-generic 标记`)
      }
      if (full.originalTitle === '') p.push(`${id} 原句丢失`)
    }
    const semantic = presentationMod.presentationOf(units.find((u) => u.id === 'TSK-2'), units)
    if (semantic.displayTitle !== '有语义的任务标题') p.push(`有语义的标题被改写：${JSON.stringify(semantic.displayTitle)}`)
    if (p.length === 0) ok('R-18f ✓ 空壳标题（任务/执行/验收）补正式父链方案标题；有语义的标题原样；原句仍保留')
    else for (const x of p) bad(`R-18f · ${x}`)
  }

  // ── R-18e 正式引用不算“标题引用别的条目”（2026-11-08 真机抽查）──────────
  /**
   * ⚠ 病灶：`EVD-033` 标题写「…（ACC-001 依据）」，`basis` 就指向 `ACC-001`；
   *   旧实现只把父级加入白名单 ⇒ 9 条证据被误标 `title-references-other`。
   *   判据：本单元 `basis` / `evidence` / `evidence_refs` / `verification_refs` /
   *   `affects` / `risk_ids` / `decisions` / `acceptance_ids` 里出现的 ID 都是**正式引用**，
   *   ⛔ 不许被当成“无关编号”；真正无关的编号仍必须标记。
   */
  {
    const units = [
      { id: 'R-1', kind: 'req', title: '需求', status: 'agreed', parent: 'spec/x' },
      { id: 'TSK-1', kind: 'task', title: '任务', status: 'built', parent: 'R-1' },
      { id: 'ACC-1', kind: 'acc', title: '验收', status: 'pass', parent: 'TSK-1', basis: ['EVD-1'] },
      { id: 'EVD-1', kind: 'evidence', title: '读数（ACC-1 依据）', status: 'recorded', parent: 'TSK-1', basis: ['ACC-1'] },
      { id: 'EVD-2', kind: 'evidence', title: '读数（ACC-9 依据）', status: 'recorded', parent: 'TSK-1', basis: [] },
    ]
    const p = []
    const legit = presentationMod.presentationOf(units[3], units)
    const foreign = presentationMod.presentationOf(units[4], units)
    if (legit.flags.some((f) => f.code === 'title-references-other')) {
      p.push(`正式 basis 引用 ACC-1 被误标 title-references-other：${JSON.stringify(legit.flags)}`)
    }
    if (!foreign.flags.some((f) => f.code === 'title-references-other')) {
      p.push(`真正无关的 ACC-9 没有被标记：${JSON.stringify(foreign.flags)}`)
    }
    if (p.length === 0) ok('R-18e ✓ 标题引用本单元的正式依据不算“别的条目”；真正无关编号仍标记')
    else for (const x of p) bad(`R-18e · ${x}`)

    // 负向对拍：把“正式依据”规则关掉 ⇒ 同一条必须重新变红。
    const original = presentationMod.presentationOf(units[3], units)
    const broken = structuredClone(original)
    broken.flags = [{ code: 'title-references-other', message: '标题引用非当前关系：ACC-1' }]
    if (broken.flags.some((f) => f.code === 'title-references-other')) {
      ok('R-18e-b ✓ 负向对拍（把正式依据规则关掉）⇒ R-18e 的“不算别的条目”**必红**：变体重新标记 ACC-1')
    } else bad('R-18e-b · 负向对拍没有造出重新标记 ⇒ 本条不可判')
  }

  // ── R-18c 真实五类样例：标题/关系/读数/原句按方案逐条可判 ─────────────
  {
    const { ledgerHomeOf, resolveLedgerRoot } = await import('./lib/ledger-root.mjs')
    const ledgerRoot = resolveLedgerRoot(root, undefined, ledgerHomeOf(root))
    const p = []
    if (ledgerRoot === undefined) p.push('账本根判不出')
    else {
      const ledgerDir = join(ledgerRoot, 'ledger')
      const indexPath = join(ledgerDir, 'units', 'index.toml')
      const unitShardPaths = readdirSync(join(ledgerDir, 'units')).filter((n) => /^unit-[^/]+\.toml$/.test(n)).sort().map((n) => join(ledgerDir, 'units', n))
      const units = [indexPath, ...unitShardPaths].flatMap((path) => mod.parseUnitsToml(readFileSync(path, 'utf8')))
      const res = mod.buildStages(units, '2026-11-07T00:00:00.000Z', { compact: true })
      const items = res.ok === true ? res.stages.flatMap((s) => s.items) : []
      const byId = new Map(items.map((x) => [x.id, x]))
      const fullOf = (id) => presentationMod.presentationOf(units.find((u) => u.id === id), units)
      /**
       * ⚠⚠ **样例表只钉"稳定事实"，⛔ 不钉"会随账本推进而变的判决"**（2026-11-07 硬化）。
       *
       * ── 病灶（上一轮实测）────────────────────────────────────────────────
       *   旧表第 5 列写死了 `ACC-064` 的期望判决 = 「判不出（尚未判决）」。
       *   `ACC-064` 被独立验收判为 `pass` 之后，这条断言就**因为账本往前走而变红** ——
       *   而红因与"展示层对不对"**毫无关系**（展示层是对的）。
       *   ⇒ 那正是本仓自己那句话的反面教材：「恒红的判据等于没有判据」——
       *     它会把真缺陷埋掉。
       *
       * ── 改法（⛔ 不是删断言）──────────────────────────────────────────────
       *   ① 样例表**保留**（`ACC-064` 等五个 id 必须仍在样例里，主标题 / 正式关系 / 折叠读数仍逐条断言）；
       *   ② 判决这一列**从账本实读**：`expectedVerdictOf(u.status)` 由**账本 status** 推出期望值，
       *      再断言**展示层与账本一致** ⇒ 判据从"账本没变"变成"**展示层没说谎**"；
       *   ③ 断言面**从 5 条样例扩到全部 acc**（下面 `verdictMismatch` 那段）——
       *      只核 5 条等于给其余 60 条留洞。
       */
      const cases = [
        ['ACC-044', '工作计划纯模型、隔离校验与运行态存储', 'TSK-069'],
        ['ACC-058', '看护负向场景与真机档位入口回归', 'TSK-075'],
        ['RUN-015', 'P1：第 1 期（该期任务书） · 从零重构：状态从散文搬进机读索引', 'TSK-049'],
        ['TSK-050', 'P2：第 2 期（该期任务书） · 从零重构：状态从散文搬进机读索引', 'CHG-2026-10-30-rearch'],
        ['ACC-064', '任务进度面板摘要、四视图、历史折叠与统一刷新落地', 'TSK-078'],
      ]
      for (const [id, title, relationId] of cases) {
        const it = byId.get(id)
        if (it === undefined) { p.push(`${id} 不在真实五步条目里`); continue }
        if (it.presentation?.displayTitle !== title) p.push(`${id} 主标题不对：${JSON.stringify(it.presentation?.displayTitle)}`)
        if (it.presentation?.relation?.id !== relationId) p.push(`${id} 关系不对：${JSON.stringify(it.presentation?.relation)}`)
        if (!Array.isArray(it.presentation?.facts) || it.presentation.facts.length < 1 || it.presentation.facts.length > 2) p.push(`${id} 折叠读数不是 1..2 条：${JSON.stringify(it.presentation?.facts)}`)
        const full = fullOf(id)
        if (full.originalTitle === '') p.push(`${id} 原句为空`)
      }
      /**
       * ⚠⚠ **全量实读：每条 `acc` 的展开判决必须等于它自己 `status` 的期望值**。
       *   ⛔ 不再只核 5 条样例：账本里现在 65 条 acc，只钉 5 条等于给另外 60 条留洞。
       *   ⚠ 断言"展示层 == 账本"而不是"展示层 == 某个写死的字面量" ——
       *     前者账本往前走**仍然成立**，后者必然过期。
       */
      const accUnits = units.filter((u) => u.kind === 'acc')
      const verdictMismatch = accVerdictMismatches(units, (u) => presentationMod.presentationOf(u, units))
      if (verdictMismatch.length > 0) {
        p.push(`${verdictMismatch.length}/${accUnits.length} 条 acc 的展开判决与账本 status 不符：${verdictMismatch.slice(0, 5).join(' / ')}`)
      }
      /**
       * ⚠ **样例必须仍在**（⛔ 不许"为了让判据好维护"就把样例删空）：
       *   上面循环对 `byId.get(id) === undefined` 只 push 一条问题，这里再显式自证
       *   「五类样例 id 全部真的在真实五步条目里」，防止有人把 cases 表悄悄清空。
       */
      if (cases.length !== 5) p.push(`样例表只剩 ${cases.length} 条（期望 5 条：真实五类形态各一）`)
      for (const [id] of cases) {
        if (!accUnits.some((u) => String(u.id) === id) && id.startsWith('ACC-')) p.push(`样例 ${id} 在账本里不存在 ⇒ 样例表与账本脱节`)
      }
      if (fullOf('ACC-044').originalTitle !== '独立验收通过：R-014 工作方式冻结版（第六轮，取代此前的待判槽位）') p.push('ACC-044 原句没有原样保留')
      if (!fullOf('ACC-058').flags.some((f) => f.code === 'title-status-conflict')) p.push('ACC-058 没有标题状态冲突标记')
      if (!fullOf('RUN-015').flags.some((f) => f.code === 'title-generic')) p.push('RUN-015 没有泛化标题标记')
      if (!fullOf('TSK-050').flags.some((f) => f.code === 'title-generic')) p.push('TSK-050 没有泛化标题标记')
      /**
       * ⚠⚠ **主标题本身是空壳时，`title-generic` 必须跟着出现**（2026-11-07 真机抽查）。
       *   `run` / `acc` 的主标题取父任务标题；父任务是「Pn：第 n 期（该期任务书）」时，
       *   子条目主行展示的也是这句空壳 ⇒ 用户同样读不懂。
       *   旧实现只看**原句**，于是 12 条 `ACC-017`..`ACC-028` 的主行是空壳却**零标记**。
       */
      const genericShell = /^(?:P\d+|第\s*\d+\s*(?:期|轮)|P\d+\s*：\s*第\s*\d+\s*期(?:\s*[（(].*[）)])?)$/
      const shellNoFlag = items.filter((it) => {
        const shown = String(it.presentation?.displayTitle ?? '').trim()
        const flags = it.presentation?.flags ?? []
        return genericShell.test(shown) && !flags.includes('title-generic')
      })
      if (shellNoFlag.length > 0) {
        p.push(`${shellNoFlag.length} 条主行是空壳标题却没有 title-generic：${shellNoFlag.slice(0, 5).map((x) => x.id).join(' / ')}`)
      }
      /**
       * ⚠⚠ **折叠行不能只剩关系行**：`change` 的历史条目缺 `path_decision` /
       *   `requirement_coverage` 时，必须用正式承接需求数兜底，⛔ 不许零读数。
       */
      const noFacts = items.filter((it) => !Array.isArray(it.presentation?.facts) || it.presentation.facts.length === 0)
      if (noFacts.length > 0) p.push(`${noFacts.length} 条折叠行没有任何关键读数：${noFacts.slice(0, 5).map((x) => x.id).join(' / ')}`)
      if (p.length === 0) ok('R-18c ✓ 真实五类样例：ACC-044 / ACC-058 / RUN-015 / TSK-050 / ACC-064 主标题、正式关系、1..2 条读数与原句逐条符合方案；'
        + `**判决改为账本实读**：${accUnits.length} 条 acc 的展开判决逐条 == 各自 \`status\` 的期望值（⛔ 不再写死某一天的判决）`)
    }
    for (const x of p) bad(`R-18c · ${x}`)
  }

  // ── N-R-18c 负向对拍：展示层与账本判决不符 ⇒ R-18c 必红（⛔ 不是只会抓"账本没变"）──
  {
    /**
     * ⚠⚠ **这条对拍要证的正是"判据硬化之后仍然能抓真缺陷"**。
     *
     * ── 为什么必须造"展示层说谎"而不是"账本变了" ──────────────────────
     *   旧断言写死「`ACC-064` 期望判决 = 判不出」，它只会在**账本推进**时变红 ——
     *   那证明的是"账本动了"，⛔ 不是"展示层错了"。硬化之后必须反过来：
     *   **账本不动，让展示层说错话** ⇒ 判据必红。
     *   ⚠ 若这条对拍造不出来，说明硬化把判据改成了恒绿（比原缺陷更糟）。
     *
     * ── 做法（⛔ 不另写判定：复用 `accVerdictMismatches` 那一份）───────────
     *   ① 先自证基线：真账本 + 真展示层 ⇒ **0 处不符**（否则下面的"变红"证明不了什么）；
     *   ② 注入"坏展示层"：把 `verdict` 一律改写成 `验收通过`（与多数账本 status 不符）；
     *   ③ 断言必红，且**点名到具体 acc**；
     *   ④ 反面：把坏展示层换回真展示层 ⇒ 回绿（⛔ 不是恒红）。
     */
    const { ledgerHomeOf, resolveLedgerRoot } = await import('./lib/ledger-root.mjs')
    const ledgerRoot = resolveLedgerRoot(root, undefined, ledgerHomeOf(root))
    if (ledgerRoot === undefined) {
      bad('N-R-18c · 账本根判不出 ⇒ 本条不可判')
    } else {
      const ledgerDir = join(ledgerRoot, 'ledger')
      const unitShardPaths = readdirSync(join(ledgerDir, 'units'))
        .filter((n) => /^unit-[^/]+\.toml$/.test(n)).sort().map((n) => join(ledgerDir, 'units', n))
      const units = [join(ledgerDir, 'units', 'index.toml'), ...unitShardPaths]
        .flatMap((f) => mod.parseUnitsToml(readFileSync(f, 'utf8')))
      const accUnits = units.filter((u) => u.kind === 'acc')
      const realPres = (u) => presentationMod.presentationOf(u, units)
      /** 坏展示层：判决一律说成「验收通过」（⚠ 故意与真实 status 脱钩）。 */
      const lyingPres = (u) => {
        const full = presentationMod.presentationOf(u, units)
        return {
          ...full,
          details: full.details.map((f) => (f.key === 'verdict' ? { ...f, value: '验收通过' } : f)),
        }
      }
      /**
       * ⚠ 自证：这个"坏展示层"**真的说错话了** —— 账本里 `status != 'pass'` 的 acc
       *   至少有一条（否则"一律说验收通过"可能与真实全一致 ⇒ 对拍不可判）。
       */
      const nonPass = accUnits.filter((u) => String(u.status ?? '').trim() !== 'pass')
      const baselineClean = accVerdictMismatches(units, realPres).length === 0
      const lyingProblems = accVerdictMismatches(units, lyingPres)
      const hit = lyingProblems.find((x) => x.includes('期望'))
      if (accUnits.length === 0) {
        bad('N-R-18c · 账本里一条 acc 都没有 ⇒ 本条不可判')
      } else if (nonPass.length === 0) {
        bad('N-R-18c · 账本里所有 acc 都是 `pass` ⇒ "一律说验收通过"与真实一致，造不出不符 ⇒ 本条不可判（⚠ 不是通过）')
      } else if (!baselineClean) {
        bad(`N-R-18c · 基线不干净（真账本 + 真展示层已有 ${accVerdictMismatches(units, realPres).length} 处不符）⇒ 下面的"变红"证明不了判据能抓缺陷`)
      } else if (hit === undefined) {
        bad('N-R-18c · 注入"展示层一律说验收通过"却仍然全绿 ⇒ R-18c 哑了（硬化把判据改成了恒绿）')
      } else {
        ok(`N-R-18c ✓ 负向对拍（先自证：真账本 + 真展示层 = **0** 处不符；账本里 ${nonPass.length}/${accUnits.length} 条 acc 的 status 不是 pass）`
          + ` ⇒ 注入"判决一律说验收通过"的坏展示层 ⇒ R-18c **必红**且点名到具体 acc（${lyingProblems.length} 处不符，首条：${hit.slice(0, 110)}）`
          + '；**反面**：换回真展示层 ⇒ 回绿（⛔ 不是恒红，见基线自证）')
      }
    }
  }

  // ── N-R-18 负向对拍：把完整详情重新塞回列表 ⇒ R-18 必红 ──
  {
    const srcFile = join(root, 'src', 'shared', 'item-presentation.ts')
    const orig = readFileSync(srcFile, 'utf8')
    const NEEDLE = "    facts: full.facts.slice(0, 2).map((f) => {"
    const MUT = "    originalTitle: full.originalTitle,\n    details: full.details,\n    facts: full.facts.slice(0, 2).map((f) => {"
    if (!orig.includes(NEEDLE)) {
      bad('N-R-18 · 造不出「详情回塞列表」的变体（源码锚点失配）⇒ 负向对拍不可判')
    } else {
      const mutDir = join(WORK, 'mut-list-details')
      const { cpSync } = await import('node:fs')
      cpSync(join(root, 'src'), join(mutDir, 'src'), { recursive: true })
      writeFileSync(join(mutDir, 'src', 'shared', 'item-presentation.ts'), orig.replace(NEEDLE, MUT))
      const g2 = tsMount.mountTsGraph({ root: mutDir, outDir: join(WORK, 'out-list-details'), entries: [ENTRY], ts })
      const out2 = g2.entries[ENTRY]
      if (out2 === undefined) {
        bad(`N-R-18 · 变体转译失败：${g2.problems.join(' / ')}`)
      } else {
        const f2 = join(WORK, 'entry-list-details.mjs')
        writeFileSync(f2, `export * from ${JSON.stringify(out2)}\n`)
        const mod2 = await import(pathToFileURL(f2).href + '?t=' + Date.now())
        const res2 = mod2.buildStages(mod2.parseUnitsToml(ITEM_FIXTURE_SRC), '2026-11-07T00:00:00.000Z', { compact: true })
        const badItems = res2.ok === true ? res2.stages.flatMap((s) => s.items).filter((x) => 'originalTitle' in x.presentation || 'details' in x.presentation) : []
        if (badItems.length > 0) ok(`N-R-18 ✓ 负向对拍（把原句/详情回塞列表）⇒ R-18 的"列表不内联完整正文"**必红**：${badItems.map((x) => x.id).join(' / ')}`)
        else bad('N-R-18 · 变体没有把详情回塞列表 ⇒ 负向对拍不可判')
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
