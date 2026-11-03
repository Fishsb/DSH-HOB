#!/usr/bin/env node
/**
 * **骨架 ↔ 实例结构漂移检查**（generic · 只查结构，不查项目内容）。
 *
 * ── 它守什么 ──────────────────────────────────────────────────────────
 *   `kit/templates/**` 是可复用骨架；账本根上的同名正本是当前实例。
 *   两份长期各自维护时，最容易静默漂移的是：
 *     · 文档标题被改；
 *     · **同名标题节里仍在使用的表**，其列定义被改。
 *
 *   本脚本把这些变成可判读数：
 *     ① 从模板首行标题自动发现“根上文档”，⛔ 不手抄 `CONTEXT.md` 等文件名单；
 *     ② 实例根从共享账本解析器取，⛔ 不按目录名另猜一套；
 *     ③ 标题按 Markdown 强调符归一后比较；
 *     ④ 模板表头只在**实例同名节仍有表**时作为契约比较 ——
 *        实例多出来的项目专有表不提、整节已移入卷而不再有表也不提。
 *
 * ── 明确边界（⛔ 不假装覆盖）──────────────────────────────────────────
 *   · 不比较正文、条目数、行内容；那些是项目数据，不是结构契约。
 *   · 不要求实例拥有模板里的全部节；缺节 / 缺表可能是有意移入卷。
 *   · 模板节里若只剩另一张表，本脚本会要求该节模板表头仍存在；
 *     完全不承载表的同名节不纳入比较。
 *   · 模板有、实例根本没有的同名根文档只登记为“未实例化”，不判红。
 *
 * ── 用法 ───────────────────────────────────────────────────────────────
 *   node scripts/check-hob-skeleton.mjs
 *   node scripts/check-hob-skeleton.mjs --verbose
 *   node scripts/check-hob-skeleton.mjs --template-root <dir> --instance-root <dir>
 *   node scripts/check-hob-skeleton.mjs --no-selftest   # 仅供夹具子进程使用
 *
 * 退出码：0 = 已执行且通过 · 1 = 结构漂移 · 2 = 基准缺失 / 未执行 ·
 *         3 = 检查器自身异常（含负向对拍失效）。
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveLedgerRoot } from './lib/ledger-root.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')
const TEMPLATE_ROOT = join(REPO_ROOT, 'kit', 'templates')
const MAX_CHILD_OUTPUT = 4 * 1024 * 1024

/** 标题 / 表头的轻量归一：只去掉 Markdown 强调，不动文字。 */
export function normalizeInline(value) {
  return String(value)
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 首个一级标题；没有则 `null`。 */
export function documentTitle(text) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^#\s+(.+?)\s*$/.exec(line)
    if (m !== null) return normalizeInline(m[1])
  }
  return null
}

function headingPath(headings) {
  return [...headings.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, value]) => value.key)
    .join(' / ')
}

function headingLabel(headings) {
  return [...headings.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, value]) => value.raw)
    .join(' / ') || '(文件根)'
}

/**
 * 提取表头（围栏代码内不扫）。
 *
 * 每条带 nearest `##`–`####` 路径。路径是节的身份，表头是节内结构契约；
 * 这样同名节里加项目专有表不影响模板表，节被移入卷后也不会误咬。
 */
export function tableHeaders(text) {
  const lines = String(text).split(/\r?\n/)
  const out = []
  const headings = new Map()
  let inFence = false

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (/^(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const h = /^(#{2,4})\s+(.+?)\s*$/.exec(line)
    if (h !== null) {
      const level = h[1].length
      for (const key of [...headings.keys()]) if (key >= level) headings.delete(key)
      headings.set(level, { raw: h[2].trim(), key: normalizeInline(h[2]) })
      continue
    }

    const next = (lines[i + 1] ?? '').trim()
    if (!line.startsWith('|') || !line.endsWith('|')) continue
    if (!/^\|[\s:|-]+\|$/.test(next) || !next.includes('-')) continue

    const columns = line.slice(1, -1).split('|').map((cell) => normalizeInline(cell))
    out.push({
      path: headingPath(headings),
      section: headingLabel(headings),
      raw: columns.join(' | '),
      key: columns.join('\0'),
    })
  }
  return out
}

function uniqueTables(tables) {
  const seen = new Set()
  return tables.filter((table) => {
    const key = `${table.path}\0${table.key}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * 比较一份模板与一份实例文档。
 *
 * 返回所有问题与覆盖读数；纯函数，负向夹具直接调用同一条比较路径。
 */
export function compareDocument(templateText, instanceText) {
  const issues = []
  const templateTitle = documentTitle(templateText)
  const instanceTitle = documentTitle(instanceText)
  if (templateTitle === null) issues.push('模板缺一级标题')
  if (instanceTitle === null) issues.push('实例缺一级标题')
  if (templateTitle !== null && instanceTitle !== null && templateTitle !== instanceTitle) {
    issues.push(`标题漂移：模板「${templateTitle}」≠ 实例「${instanceTitle}」`)
  }

  const templateTables = uniqueTables(tableHeaders(templateText))
  const instanceTables = uniqueTables(tableHeaders(instanceText))
  const byPath = new Map()
  for (const table of instanceTables) {
    if (!byPath.has(table.path)) byPath.set(table.path, new Map())
    byPath.get(table.path).set(table.key, table.raw)
  }

  let compared = 0
  let skipped = 0
  for (const table of templateTables) {
    const headers = byPath.get(table.path)
    if (headers === undefined || headers.size === 0) {
      skipped += 1
      continue
    }
    compared += 1
    if (!headers.has(table.key)) {
      issues.push(`表头漂移：节「${table.section}」模板表头「${table.raw}」在实例同名节中不存在`
        + `（该节实例表头：${[...headers.values()].join('；')}）`)
    }
  }

  return { issues, templateTitle, instanceTitle, compared, skipped, templateTables: templateTables.length, instanceTables: instanceTables.length }
}

function templateDocumentNames(templateRoot) {
  const names = []
  for (const name of readdirSync(templateRoot).filter((n) => n.endsWith('.md')).sort()) {
    const file = join(templateRoot, name)
    if (!statSync(file).isFile()) continue
    const title = documentTitle(readFileSync(file, 'utf8'))
    if (title !== null && title.startsWith(name)) names.push(name)
  }
  return names
}

/**
 * 配对派生：模板首行自述文件名 ⇒ 根上文档；实例只认同名的现存文件。
 * ⛔ 不手抄文档名单，因此换项目 / 增模板不需要改脚本常量。
 */
export function discoverPairs(templateRoot, instanceRoot) {
  const rootDocuments = templateDocumentNames(templateRoot)
  const instanceFiles = new Set(readdirSync(instanceRoot).filter((n) => n.endsWith('.md')))
  const pairs = []
  const notInstantiated = []
  for (const name of rootDocuments) {
    if (instanceFiles.has(name)) pairs.push({ name, template: join(templateRoot, name), instance: join(instanceRoot, name) })
    else notInstantiated.push(name)
  }
  return { rootDocuments, pairs, notInstantiated }
}

function usage() {
  console.log('用法：node scripts/check-hob-skeleton.mjs [--verbose] [--template-root <dir>] [--instance-root <dir>]')
  console.log('       node scripts/check-hob-skeleton.mjs --no-selftest   # 仅夹具子进程使用')
}

function parseArgs(argv) {
  const opts = { verbose: false, selftest: true, templateRoot: null, instanceRoot: null, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--verbose') opts.verbose = true
    else if (arg === '--no-selftest') opts.selftest = false
    else if (arg === '--help' || arg === '-h') opts.help = true
    else if (arg === '--template-root' || arg === '--instance-root') {
      const value = argv[i + 1]
      if (value === undefined || value === '' || value.startsWith('--')) throw new Error(`${arg} 缺路径`)
      if (arg === '--template-root') opts.templateRoot = resolve(process.cwd(), value)
      else opts.instanceRoot = resolve(process.cwd(), value)
      i += 1
    } else {
      throw new Error(`未知参数：${arg}`)
    }
  }
  return opts
}

function fixtureText({ title, header, extraTable = false, optionalSection = true }) {
  return [
    `# CONTEXT.md —— ${title}`,
    '',
    '## 5. 本批登记',
    '',
    '### 5.1 轮次与落点',
    '',
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    `|${header.map(() => '样例').join('|')}|`,
    '',
    ...(extraTable ? ['| 项目专有 | 内容 |', '|---|---|', '| 只属于当前项目 | 不计入模板契约 |', ''] : []),
    ...(optionalSection ? [
      '## 9. 可选区',
      '',
      '| 项 | 值 |',
      '|---|---|',
      '| 可选 | 模板可声明、实例可不实例化 |',
      '',
    ] : []),
  ].join('\n')
}

function runFixture(base, { instanceTitle, instanceHeader, extraTable = false }) {
  const templateRoot = join(base, 'templates-' + String(Math.random()).slice(2))
  const instanceRoot = join(base, 'instance-' + String(Math.random()).slice(2))
  mkdirSync(templateRoot, { recursive: true })
  mkdirSync(instanceRoot, { recursive: true })
  const canonicalHeader = ['轮', '内容', '落点']
  writeFileSync(join(templateRoot, 'CONTEXT.md'), fixtureText({ title: '当前工作上下文', header: canonicalHeader }), 'utf8')
  writeFileSync(join(instanceRoot, 'CONTEXT.md'), fixtureText({
    title: instanceTitle,
    header: instanceHeader,
    extraTable,
    optionalSection: false,
  }), 'utf8')
  return spawnSync(process.execPath, [
    fileURLToPath(import.meta.url),
    '--template-root', templateRoot,
    '--instance-root', instanceRoot,
    '--no-selftest',
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: MAX_CHILD_OUTPUT,
  })
}

/** 自证：正例不误咬、标题漂移必红、表头漂移必红。 */
function runSelfTests(ok, crash, verbose) {
  const base = mkdtempSync(join(REPO_ROOT, '.check-hob-skeleton-'))
  const relativeBase = relative(REPO_ROOT, base)
  if (relativeBase.startsWith('..') || resolve(base) === resolve(REPO_ROOT)) {
    crash(`临时目录越出工作区：${base}`)
    return false
  }

  try {
    const positive = runFixture(base, {
      instanceTitle: '当前工作上下文',
      instanceHeader: ['轮', '内容', '落点'],
      extraTable: true,
    })
    if (positive.status === 0 && String(positive.stdout).includes('判定：PASS')) {
      ok('✓ 先自证 · 反向对照（不该咬）：同构标题 + 实例专有表 + 可选节未实例化 ⇒ exit 0')
    } else {
      crash('检查器自证失败：正向夹具没有 exit 0'
        + `（status=${String(positive.status)} / stderr=${String(positive.stderr).trim()}）`)
      return false
    }

    const titleDrift = runFixture(base, {
      instanceTitle: '陈旧工作上下文',
      instanceHeader: ['轮', '内容', '落点'],
    })
    if (titleDrift.status === 1 && String(titleDrift.stdout).includes('标题漂移')) {
      ok('✓ 先自证 · 负向对拍（标题）：只改实例标题 ⇒ exit 1 且点名「标题漂移」')
    } else {
      crash('检查器自证失败：标题漂移夹具没有产生预期红'
        + `（status=${String(titleDrift.status)} / stdout=${String(titleDrift.stdout).trim()}）`)
      return false
    }

    const headerDrift = runFixture(base, {
      instanceTitle: '当前工作上下文',
      instanceHeader: ['轮次', '内容', '落点'],
    })
    if (headerDrift.status === 1 && String(headerDrift.stdout).includes('表头漂移')) {
      ok('✓ 先自证 · 负向对拍（表头）：同名节里只改一列 ⇒ exit 1 且点名「表头漂移」')
    } else {
      crash('检查器自证失败：表头漂移夹具没有产生预期红'
        + `（status=${String(headerDrift.status)} / stdout=${String(headerDrift.stdout).trim()}）`)
      return false
    }

    if (verbose) console.log(`      夹具目录：${base}`)
    return true
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    usage()
    return 0
  }

  let passed = 0
  let failed = 0
  const ok = (msg) => { passed += 1; console.log(msg) }
  const bad = (msg) => { failed += 1; console.log(`✗ ${msg}`) }
  let crashed = false
  const crash = (msg) => {
    crashed = true
    failed += 1
    console.log(`✗ ${msg}`)
  }

  console.log('=== Hob 骨架 ↔ 实例结构漂移检查 ===\n')

  if (opts.selftest && !runSelfTests(ok, crash, opts.verbose)) {
    console.log('\n判定：检查器自身异常（exit 3）—— 自证未通过，结论不可信。')
    console.log(`处级口径：查了 ${passed + failed} 处 · 过了 ${passed} 处 · 跳过 0 处（⛔ 跳过不计入通过）`)
    return 3
  }

  const templateRoot = opts.templateRoot ?? TEMPLATE_ROOT
  const instanceRoot = opts.instanceRoot ?? resolveLedgerRoot(REPO_ROOT)

  if (!existsSync(templateRoot) || !statSync(templateRoot).isDirectory()) {
    console.log(`判定：未执行（exit 2）—— 模板根不存在或不是目录：${templateRoot}`)
    console.log(`处级口径：查了 ${passed + failed} 处 · 过了 ${passed} 处 · 跳过 0 处（⛔ 跳过不计入通过）`)
    return 2
  }
  if (typeof instanceRoot !== 'string' || instanceRoot === '' || !existsSync(instanceRoot) || !statSync(instanceRoot).isDirectory()) {
    console.log(`判定：未执行（exit 2）—— 实例账本根解析不到或不是目录：${String(instanceRoot)}`)
    console.log('⇒ 这不是通过；检查先看 `ledgerHome` / `dsh-hob.workspace.json`，或用 `--instance-root` 明示夹具。')
    console.log(`处级口径：查了 ${passed + failed} 处 · 过了 ${passed} 处 · 跳过 0 处（⛔ 跳过不计入通过）`)
    return 2
  }

  const { rootDocuments, pairs, notInstantiated } = discoverPairs(templateRoot, instanceRoot)
  if (rootDocuments.length === 0 || pairs.length === 0) {
    console.log(`判定：未执行（exit 2）—— 自动发现 ${rootDocuments.length} 份根模板、${pairs.length} 对同名实例；`
      + '没有可比结构，不能按通过处理。')
    console.log(`处级口径：查了 ${passed + failed} 处 · 过了 ${passed} 处 · 跳过 0 处（⛔ 跳过不计入通过）`)
    return 2
  }

  ok(`✓ 基准：模板根 \`${templateRoot}\` · 实例根 \`${instanceRoot}\` · `
    + `根模板 ${rootDocuments.length} 份 / 可比实例 ${pairs.length} 对`
    + (notInstantiated.length > 0 ? ` · 未实例化 ${notInstantiated.length} 份（${notInstantiated.join(' · ')}）` : ''))

  const comparisons = pairs.map((pair) => ({
    ...pair,
    result: compareDocument(readFileSync(pair.template, 'utf8'), readFileSync(pair.instance, 'utf8')),
  }))

  const titleIssues = comparisons.flatMap(({ name, result }) => result.issues
    .filter((issue) => issue.startsWith('模板缺一级标题') || issue.startsWith('实例缺一级标题') || issue.startsWith('标题漂移'))
    .map((issue) => `${name}：${issue}`))
  if (titleIssues.length === 0) {
    ok(`✓ 标题：${comparisons.length} 对根文档全部一致（归一 Markdown 强调后比较）`)
  } else {
    bad(`标题漂移（${titleIssues.length} 处）：\n      · ${titleIssues.join('\n      · ')}`)
  }

  const tableIssues = comparisons.flatMap(({ name, result }) => result.issues
    .filter((issue) => issue.startsWith('表头漂移'))
    .map((issue) => `${name}：${issue}`))
  const comparedTables = comparisons.reduce((n, { result }) => n + result.compared, 0)
  const skippedTables = comparisons.reduce((n, { result }) => n + result.skipped, 0)
  if (tableIssues.length === 0) {
    ok(`✓ 表结构：同名节内核了 ${comparedTables} 条模板表头，全部在实例中存在；`
      + `另有 ${skippedTables} 条模板表所属节在实例中已无表（不纳入比较；⛔ 不等于已通过）`)
  } else {
    bad(`表头漂移（${tableIssues.length} 处）：\n      · ${tableIssues.join('\n      · ')}`)
  }

  if (opts.verbose) {
    for (const { name, result } of comparisons) {
      console.log(`      ${name}：实例表头 ${result.instanceTables} 条 · 模板表头 ${result.templateTables} 条 · `
        + `同节比较 ${result.compared} 条 · 节无表跳过 ${result.skipped} 条`)
    }
  }

  console.log('')
  console.log(`处级口径：查了 ${passed + failed} 处 · 过了 ${passed} 处 · 跳过 0 处（⛔ 跳过不计入通过）`)
  if (crashed || failed > 0) {
    console.log(`判定：${crashed ? '检查器自身异常（exit 3）' : 'FAIL（exit 1）'} —— 结构漂移见上方点名。`)
    return crashed ? 3 : 1
  }
  console.log('判定：PASS —— 根文档标题与同名节内模板表头均未漂移。')
  console.log('⚠ 边界：不比较正文 / 条目数 / 项目专有表；节已整体移出实例时不要求原节结构。')
  return 0
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main()
  } catch (error) {
    console.error(`✗ 检查器自身异常：${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    process.exitCode = 3
  }
}
