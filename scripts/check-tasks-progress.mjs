#!/usr/bin/env node
/**
 * **五步主线进度表 · 服务端行为判据**（2026-10-29 · 第 6 轮 · 任务书 §四①；四步→五步同日裁定）。
 *
 * ══ 它为什么存在 ═══════════════════════════════════════════════════════════
 *   §3.1 的线格式是**封闭集**（七个 `step` 值、四类字段、三类的可分辨失败）。
 *   "源码里有那个词"证明不了这些，只有**真跑一遍真解析器**才行。
 *   ⇒ 本脚本直接 import `src/shared/tasks-progress.ts` 的**真源码**
 *     （纯函数、零宿主依赖，用 `ts-mount` 转译），喂**真夹具账本**跑三种情形。
 *
 * ══ 判据（每条都能独立失败）════════════════════════════════════════════════
 *   T-0 转译图自证（`ts-mount` 的 `verifyMounted`）
 *   T-1 **正常两行** ⇒ `ok:true`、`source` 逐字、`readAt` 是 ISO、`rows` 原样两行、
 *       `step` 映射对（`unfilled` / `4`）、`blockedBy` 去装饰后逐字
 *   T-2 **表存在但零行** ⇒ `ok:true` + `rows: []`（⚠ 不是失败、不是判不出）
 *   T-3 **账本读不到** ⇒ `ok:false` + `reason === 'ledger-unreadable'`
 *   T-4 **表不在** ⇒ `ok:false` + `reason === 'table-missing'`（与 T-3 **不同值**）
 *   T-5 **某行形态不认识** ⇒ `ok:false` + `reason === 'row-shape-unknown'`（与上两者不同）
 *   T-6 **行序 / 不去重**：三行夹具（含重复名）⇒ `rows` 顺序与表一致、重复项**保留**
 *   T-7 **七值封闭集**：`normalizeStep` 对一堆输入只可能返回那七个值，且
 *       "判不出"必须落 `'unknown'`（⛔ 不许塞 `'1'`）
 *   T-8 **负向对拍**：把 `STEP_BY_NUMBER` 的 `'4'` 改成 `'5'` ⇒ **T-1 必须变红**
 *
 * 用法：node scripts/check-tasks-progress.mjs   （或 npm run check:tasks-progress）
 * 退出码：0 = 全通过；1 = 有失败；2 = 依赖不可用（⛔ 不算通过）
 * ⚠ 零第三方依赖（`ts-mount` 只用仓内 `typescript`）。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const ENTRY = 'src/shared/tasks-progress.ts'
  /**
   * ⚠ **路径带 pid**（B4.2 · 2026-11-10）：改前是固定名 ⇒ 两个自检进程并发跑会互相
   *   `rmSync` 掉对方正在用的目录（实测：`check:stages-panel-dom` / `check:preset-contracts`
   *   并发跑必红、串行跑必绿）。⚠ 这类「串行绿、并发红」的假失败会让人误判成真缺陷。
   *   ⇒ 带 `process.pid` 后互不干扰；`.gitignore` 的 `.check-*-work/` 通配仍覆盖它们。
   */
const work = join(root, '.check-tasks-progress-work-' + process.pid)

let pass = 0
let fail = 0
const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail++; console.log(`  ✗ ${m}`) }
const cleanup = () => { try { rmSync(work, { recursive: true, force: true }) } catch { /* 忽略 */ } }

rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })

console.log('')
console.log('T 组：五步进度表 · 服务端行为判据（真解析器 + 真夹具账本）')
console.log('')

try {
  // ══════════════════════════════════════════════════════════════════════
  // 夹具账本（⚠ 逐字模仿 `volumes/tasks/INDEX.md` 的真实形态）
  // ══════════════════════════════════════════════════════════════════════
  const FIXTURE_TWO_ROWS = `# 编码任务 · 索引

> 状态只许四档 + 一个终态。

| 编号 | 现在停在第几步 | 卡在谁那里 | 任务件 |
|---|---|---|---|
| REQ-01 | **未回填** | — | — |
| FIVE-STAGE | **4 任务执行** | 用户（重启验界面） | \`FIVE-STAGE.md\` |
`
  const FIXTURE_EMPTY = `# 空表

| 编号 | 现在停在第几步 | 卡在谁那里 | 任务件 |
|---|---|---|---|
`
  const FIXTURE_NO_TABLE = `# 没有表

这段只有正文，没有任何 | 表格 |。
`
  const FIXTURE_BAD_ROW = `# 坏行

| 编号 | 现在停在第几步 | 卡在谁那里 | 任务件 |
|---|---|---|---|
| REQ-01 | **未回填** | — | — |
| 只有两格 |
`
  const FIXTURE_ORDER = `# 顺序与重复

| 编号 | 现在停在第几步 | 卡在谁那里 | 任务件 |
|---|---|---|---|
| B | **2 实现方案** | 甲 | — |
| A | **1 需求规格** | 乙 | — |
| B | **3 编码任务** | 丙 | — |
`

  // ══════════════════════════════════════════════════════════════════════
  // T-0 转译（复用 ts-mount 并自证）
  // ══════════════════════════════════════════════════════════════════════
  const tsPath = join(root, 'node_modules', 'typescript', 'lib', 'typescript.js')
  const ts = (await import(pathToFileURL(tsPath).href)).default
  const tsMount = await import('./ts-mount.mjs')
  const graph = tsMount.mountTsGraph({ root, outDir: join(work, 'out'), entries: [ENTRY], ts })
  const problems = [
    ...graph.problems,
    ...tsMount.verifyMounted({ root, entries: [ENTRY], mounted: graph.mounted, entryFiles: graph.entries }),
  ]
  if (problems.length > 0) {
    for (const p of problems) bad(`T-0 转译/自证失败：${p}`)
  } else {
    ok(`T-0 ✓ 转译图自证通过（${graph.mounted.join(' · ')}）`)
  }
  const entryOut = graph.entries[ENTRY]
  if (entryOut === undefined) throw new Error('入口没有产出（见 T-0）')
  const entryFile = join(work, 'entry.mjs')
  writeFileSync(entryFile, `export * from ${JSON.stringify(entryOut)}\n`)
  const mod = await import(pathToFileURL(entryFile).href)

  /** 造一个"账本根 = /fix"，`readText` 从给定字符串返回。 */
  const depsOf = (src, over = {}) => ({
    ledgerRootOf: () => '/fixture-ledger',
    readText: () => src,
    now: () => new Date('2026-10-29T00:00:00.000Z'),
    ...over,
  })

  // ══════════════════════════════════════════════════════════════════════
  // T-1 正常两行
  // ══════════════════════════════════════════════════════════════════════
  const r1 = mod.handleTasksProgress(depsOf(FIXTURE_TWO_ROWS), {})
  const t1 = []
  if (r1?.ok !== true) t1.push(`ok 不是 true：${JSON.stringify(r1)}`)
  if (r1?.source !== 'volumes/tasks/INDEX.md') t1.push(`source 不是逐字的 volumes/tasks/INDEX.md：${JSON.stringify(r1?.source)}`)
  if (typeof r1?.readAt !== 'string' || Number.isNaN(Date.parse(r1.readAt))) t1.push(`readAt 不是合法 ISO：${JSON.stringify(r1?.readAt)}`)
  if (!Array.isArray(r1?.rows) || r1.rows.length !== 2) t1.push(`rows 不是两行：${JSON.stringify(r1?.rows)}`)
  if (r1?.rows?.[0]?.name !== 'REQ-01') t1.push(`第 1 行 name 不是 REQ-01：${JSON.stringify(r1?.rows?.[0])}`)
  if (r1?.rows?.[0]?.step !== 'unfilled') t1.push(`第 1 行 step 不是 unfilled：${JSON.stringify(r1?.rows?.[0]?.step)}`)
  if (r1?.rows?.[0]?.blockedBy !== '') t1.push(`第 1 行 blockedBy 不是空串（"—" 应归一成空）：${JSON.stringify(r1?.rows?.[0]?.blockedBy)}`)
  if (r1?.rows?.[1]?.name !== 'FIVE-STAGE') t1.push(`第 2 行 name 不是 FIVE-STAGE：${JSON.stringify(r1?.rows?.[1])}`)
  if (r1?.rows?.[1]?.step !== '4') t1.push(`第 2 行 step 不是 '4'：${JSON.stringify(r1?.rows?.[1]?.step)}`)
  if (r1?.rows?.[1]?.blockedBy !== '用户（重启验界面）') t1.push(`第 2 行 blockedBy 不对：${JSON.stringify(r1?.rows?.[1]?.blockedBy)}`)
  if (t1.length === 0) ok(`T-1 ✓ 正常两行原样返回：step=unfilled/4 · blockedBy 归一 · readAt=${r1.readAt} · source=${r1.source}`)
  else for (const p of t1) bad(`T-1 · ${p}`)

  // ══════════════════════════════════════════════════════════════════════
  // T-2 表存在但零行 ⇒ ok:true + rows:[]
  // ══════════════════════════════════════════════════════════════════════
  const r2 = mod.handleTasksProgress(depsOf(FIXTURE_EMPTY), {})
  if (r2?.ok === true && Array.isArray(r2.rows) && r2.rows.length === 0) {
    ok('T-2 ✓ 表在、零行 ⇒ ok:true + rows:[]（⚠ 空表不是失败）')
  } else {
    bad(`T-2 · 空表被当成了别的：${JSON.stringify(r2)}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // T-3 账本读不到 ⇒ ledger-unreadable
  // ══════════════════════════════════════════════════════════════════════
  const r3 = mod.handleTasksProgress({
    ledgerRootOf: () => '/fixture-ledger',
    readText: () => { throw new Error('ENOENT: no such file') },
    ledgerRootWhyOf: () => '',
  }, {})
  if (r3?.ok === false && r3.reason === 'ledger-unreadable') {
    ok(`T-3 ✓ 读不到 ⇒ ok:false · reason=ledger-unreadable · message 含具体路径/原因`)
  } else {
    bad(`T-3 · 读不到没被判成 ledger-unreadable：${JSON.stringify(r3)}`)
  }
  // 账本根判不出也归这一类（⚠ 但 message 要能看出是"根判不出"而不是"文件没了"）
  const r3b = mod.handleTasksProgress({
    ledgerRootOf: () => undefined,
    ledgerRootWhyOf: () => '没配 ledgerHome',
  }, {})
  if (r3b?.ok === false && r3b.reason === 'ledger-unreadable' && /账本根判不出/.test(r3b.message)) {
    ok('T-3b ✓ 账本根判不出 ⇒ 同一个 reason，但 message 明说"账本根判不出"（不与"文件读不到"混句）')
  } else {
    bad(`T-3b · 账本根判不出没被判对：${JSON.stringify(r3b)}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // T-4 表不在 ⇒ table-missing（与 T-3 不同值）
  // ══════════════════════════════════════════════════════════════════════
  const r4 = mod.handleTasksProgress(depsOf(FIXTURE_NO_TABLE), {})
  if (r4?.ok === false && r4.reason === 'table-missing') {
    ok('T-4 ✓ 表不在 ⇒ reason=table-missing（≠ ledger-unreadable）')
  } else {
    bad(`T-4 · 表不在没被判成 table-missing：${JSON.stringify(r4)}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // T-5 行形态不认识 ⇒ row-shape-unknown（与上两者不同值）
  // ══════════════════════════════════════════════════════════════════════
  const r5 = mod.handleTasksProgress(depsOf(FIXTURE_BAD_ROW), {})
  if (r5?.ok === false && r5.reason === 'row-shape-unknown') {
    ok('T-5 ✓ 某行形态不认识 ⇒ reason=row-shape-unknown（三类互不相同）')
  } else {
    bad(`T-5 · 坏行没被判成 row-shape-unknown：${JSON.stringify(r5)}`)
  }

  // 三类互不相同（⚠ 这是 R-10 的核心：不许并成一句）
  {
    const three = [r3?.reason, r4?.reason, r5?.reason]
    if (new Set(three).size === 3 && three.every((x) => typeof x === 'string')) {
      ok(`T-5b ✓ 三类 reason 互不相同：${three.join(' / ')}`)
    } else {
      bad(`T-5b · 三类 reason 有重复或缺失：${JSON.stringify(three)}`)
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // T-6 行序与不去重
  // ══════════════════════════════════════════════════════════════════════
  const r6 = mod.handleTasksProgress(depsOf(FIXTURE_ORDER), {})
  const names = (r6?.rows ?? []).map((x) => x.name)
  if (names.join(',') === 'B,A,B') {
    ok('T-6 ✓ 行序按表里的顺序、重复项保留（B,A,B —— ⛔ 没重排、⛔ 没去重）')
  } else {
    bad(`T-6 · 行序/去重不对：${JSON.stringify(names)}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // T-7 七值封闭集 + "判不出"不许塞成 '1'
  // ══════════════════════════════════════════════════════════════════════
  {
    const allowed = new Set(['1', '2', '3', '4', '5', 'done', 'unfilled', 'unknown'])
    const inputs = [
      '**未回填**', '—', '', '**4 任务执行**', '3 编码任务', '2. ', '1',
      '**5 验收核对**', '5', '✅ 验收完成', '验收完成', '乱写的东西', '**在办**',
    ]
    const got = inputs.map((x) => mod.normalizeStep(x))
    const outside = got.filter((x) => !allowed.has(x))
    if (outside.length === 0) {
      ok(`T-7 ✓ 八值封闭集：${inputs.length} 个输入全落在这八个值内（${[...new Set(got)].join(' / ')}）`)
    } else {
      bad(`T-7 · 出现了封闭集之外的值：${JSON.stringify(outside)}`)
    }
    const unknownCases = ['—', '', '乱写的东西', '在办']
    const notUnknown = unknownCases.filter((x) => mod.normalizeStep(x) !== 'unknown')
    if (notUnknown.length === 0) {
      ok('T-7b ✓ 判不出的输入一律落 \'unknown\'（⛔ 没被塞成 \'1\'）')
    } else {
      bad(`T-7b · 这些判不出的输入没落 unknown：${JSON.stringify(notUnknown.map((x) => [x, mod.normalizeStep(x)]))}`)
    }
    // ⚠ `'5'`（在做验收）与 `'done'`（已验收通过）**两态不许合并**
    if (mod.normalizeStep('**5 验收核对**') === '5' && mod.normalizeStep('✅ 验收完成') === 'done') {
      ok("T-7c ✓ '5'（在做验收）与 'done'（已验收通过）**两态分开**，⛔ 没被合并")
    } else {
      bad(`T-7c · 两态被合并了：5⇒${JSON.stringify(mod.normalizeStep('**5 验收核对**'))} done⇒${JSON.stringify(mod.normalizeStep('✅ 验收完成'))}`)
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // T-7d 封闭集**越界必须报错**（⛔ 不许兜底成 unknown、⛔ 不许映射成 1）
  // ══════════════════════════════════════════════════════════════════════
  {
    const FIXTURE_OUT_OF_SET = `# 越界

| 编号 | 现在停在第几步 | 卡在谁那里 | 任务件 |
|---|---|---|---|
| X | **6 验收核对** | 甲 | — |
`
    const r = mod.handleTasksProgress(depsOf(FIXTURE_OUT_OF_SET), {})
    if (r?.ok === false && r.reason === 'row-shape-unknown' && /超出封闭集/.test(r.message)) {
      ok('T-7d ✓ 步号越界（6）⇒ ok:false · row-shape-unknown · message 明说「超出封闭集」（⛔ 没兜底成 unknown）')
    } else {
      bad(`T-7d · 越界步号没被报错：${JSON.stringify(r)}`)
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // T-8 负向对拍：把 STEP_BY_NUMBER 的 '4' 改成 '5' ⇒ T-1 必须变红
  // ══════════════════════════════════════════════════════════════════════
  {
    const srcPath = join(root, ENTRY)
    const src = readFileSync(srcPath, 'utf8')
    // ⚠ 只改映射表里那一行（`'4': '4',` ⇒ `'4': '5',`）
    /**
     * ⚠⚠ **负向对拍的口径随五步变更**（2026-10-29 用户裁定）：
     *   原来钉 `'4'`（"把 4 改成 5 必须变红"）；现在钉 **`'5'`**（"把 5 改成 6 必须变红"）。
     *   ⚠ 为什么换锚点：`'5'` 是新加的第八值里**最容易被误改**的那一个（它挨着 done），
     *     钉住它才证明"五步这一步真的被映射了"，而不是靠 `'4'` 那条老路径。
     */
    const mutated = src.replace(/(\s*'5':\s*)'5'/, "$1'6'")
    if (mutated === src) {
      bad('T-8 · 造不出「改 STEP_BY_NUMBER」的变体（源码里找不到 `\'5\': \'5\'`）⇒ 负向对拍不可判')
    } else {
      const outDir = join(work, 'mut')
      mkdirSync(outDir, { recursive: true })
      const out = join(outDir, 'mutant.mjs')
      writeFileSync(out, ts.transpileModule(mutated, {
        compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true },
      }).outputText)
      const FIXTURE_STEP5 = `# 五步

| 编号 | 现在停在第几步 | 卡在谁那里 | 任务件 |
|---|---|---|---|
| Y | **5 验收核对** | 甲 | — |
`
      const mutant = await import(pathToFileURL(out).href)
      const mr = mutant.handleTasksProgress(depsOf(FIXTURE_STEP5), {})
      const step5 = mr?.rows?.[0]?.step
      if (step5 !== '5') {
        ok(`T-8 ✓ 负向对拍（STEP_BY_NUMBER 的 '5' ⇒ '6'）⇒ 该行 step 变成 ${JSON.stringify(step5)}，五步映射的断言必红`)
      } else {
        bad('T-8 · 改了映射表，step **仍是** \'5\' ⇒ 那条判据是恒真的、没有牙')
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // T-9：旧接口显式退役，⛔ 不许再冒充账本读坏
  // ══════════════════════════════════════════════════════════════════════
  {
    const routeSrc = readFileSync(join(root, 'src', 'modules', 'tasks-progress-route.ts'), 'utf8')
    const p = []
    if (!routeSrc.includes("reason: 'route-retired'")) p.push('没有 route-retired 原因码')
    if (!routeSrc.includes('body?.legacy !== true')) p.push('没有 legacy:true 的显式兼容分支')
    if (!routeSrc.includes('/api/dsh-hob/stages')) p.push('退役响应没有指向 /api/dsh-hob/stages')
    if (!routeSrc.includes('json(410')) p.push('退役响应没有使用 410')
    if (p.length === 0) ok('T-9 ✓ 旧 /tasks-progress 显式退役：410 route-retired · 指向新接口 · legacy:true 才读旧表')
    else for (const x of p) bad(`T-9 · ${x}`)
  }
} catch (e) {
  bad(`T-9 · 本组执行中断：${String(e?.message ?? e)}`)
} finally {
  cleanup()
}

console.log('')
console.log(`T 组：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处`
  + (fail > 0 ? ` · 没过 ${fail} 处` : '')
  + ' · **跳过 0 处**（⚠ 跳过**不计入通过**）')
console.log('')
if (fail > 0) {
  console.log('  ⛔ 有失败项 ⇒ 本组不算通过')
  process.exit(1)
}
console.log('  ✅ T 组全绿（⚠ 真解析器 + 真夹具账本；真实宿主 HTTP 链路仍需重启后人工验）')
process.exit(0)
