#!/usr/bin/env node
/**
 * `check:rounds` —— 轮次标识「只增不减 · 且每个标识都有记录件」对账（**第 210 轮立 · 按 `UD-114`**）。
 *
 * ⚠ ⚠ **它防的是什么**（本单的由来）：同一缺陷类已出三次 —— **第 182 轮**（第 174–176 行）·
 *   **第 204 轮**（第 190–194 行）· **第 207 轮**（第 195 / 196 行）。三次都是
 *   **「移出行 → 槽位」没落地**：行从活文档里消失，而**没有任何东西会在那一刻拦住它**。
 *   ⇒ **写入侧**的对策 = 换载体（`volumes/context/rounds/` 一轮一文件 · 写一次固定）；
 *     **读侧**的对策 = 本条（⚠ 两处共管：一条写不进去、另一条当场 FAIL）。
 *
 * ── 两条不变量 ────────────────────────────────────────────────────────────
 *   ⚠ ① **集合只增不减**（⚠ 等价形式：一个集合只在**有行被删掉**时变小）：
 *        EVER_SEEN = **全历史每个版本的载体 blob** 的 `### 5.1` 段里出现过的轮次标识（并集）
 *        AT_NOW   = **现在**（活文档 + `archive/` 改前整份）里**可查到**的轮次标识
 *        判据     = **EVER_SEEN − AT_NOW 必须为空**（⚠ 非空 ⇒ FAIL 并**点名缺了哪些标识**）
 *   ⚠ ② **每个标识都有记录件**：
 *        AT_NOW 展开成**单轮号**后，逐个到 `volumes/context/rounds/` 里找对应的记录件
 *        （⚠ 打包行 `55–178` 建 `55-178.md` 一件 ⇒ 它**覆盖**区间内每个号）
 *        判据     = **未被任何记录件覆盖的号必须为空**
 *
 *   ⚠ **为什么用"历史并集"而不是"逐相邻提交两两比"**：⚠ 见下方「覆盖面边界」——
 *     两者在**"某号曾出现、而现查不到"**这一形态上等价，⚠ 但**前者只需列对象 + 一次批量读**
 *     （实测 ~0.5s），⚠ 后者要 295 次取树（实测 ~30s）⇒ **按管路成本取前者**。
 *
 * ── 覆盖面边界（⚠ 归纳、非穷举 —— ⛔ 不许读成"全都管住了"）────────────────
 *   ⚠ **只管"轮次标识"这一类**（⚠ 且参与取数的文件限于**轮次登记的载体**：
 *     `CONTEXT*.md` 整份 + `08-round-table.md` —— ⚠ 这是为了避免把别的表里的数字当轮次号）。
 *   ⚠ **不在覆盖面内**：别的类别（章节号 · 经验库编号 · 决策编号 …）· 非 `.md` 文件 ·
 *     **"某个号还在、但它的**内容**被换掉了"** · **"记录件起好了、但指针没点到它"**。
 *
 * 用法：
 *   node scripts/check-rounds-records.mjs [--ledger <账本区绝对路径>]
 *   node scripts/check-rounds-records.mjs --self-test   # 自带负向对拍（⛔ 不碰真账本）
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

const root = process.cwd()
/** 记录件目录（账本区相对路径）。 */
const RECORDS_DIR = 'volumes/context/rounds'
/** 轮次号量级上限（⚠ 防把别的表里的数字当轮次号）。 */
const MAX_ROUND = 400
/** 范围行的跨度上限。 */
const MAX_SPAN = 500

function tryGit(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
  } catch {
    return null
  }
}

/** git（**字节**输入/输出）—— `cat-file --batch` 专用（⚠ 经 stdin 喂 blob 清单）。 */
function tryGitBuf(args, cwd, input) {
  try {
    return execFileSync('git', args, { cwd, input, maxBuffer: 512 * 1024 * 1024 })
  } catch {
    return null
  }
}

function workspaceName() {
  const abs = tryGit(['rev-parse', '--path-format=absolute', '--git-common-dir'], root)
  if (abs !== null && abs.trim() !== '') return basename(dirname(abs.trim()))
  const rel = tryGit(['rev-parse', '--git-common-dir'], root)
  if (rel !== null && rel.trim() !== '') return basename(dirname(join(root, rel.trim())))
  return basename(root)
}

function ledgerHome() {
  try {
    const preset = readFileSync(join(root, 'preset', 'dsh-hob', 'preset-dsh-hob.patch.yml'), 'utf8')
    const m = /ledgerHome:\s*(\S+)/.exec(preset)
    return m === null ? null : m[1]
  } catch {
    return null
  }
}

function resolveLedgerRoot(cliLedger) {
  if (typeof cliLedger === 'string' && cliLedger !== '') return cliLedger
  const home = ledgerHome()
  if (home === null) return undefined
  const cand = join(home, workspaceName())
  return existsSync(cand) ? cand : undefined
}

// ── 取数 ──────────────────────────────────────────────────────────────────
const DEL_ROW = /^-\|\s*(\d{1,4})\s*(?:[–-]\s*(\d{1,4}))?\s*\|/
const ROW = /^\|\s*(\d{1,4})\s*(?:[–-]\s*(\d{1,4}))?\s*\|/
const SEC51 = /^#{2,3}\s*5\.1/
const NEXT_SEC = /^#{2,3}\s/
const SEP = /^\|[\s:|-]+\|$/

/** 轮次登记载体的形状（⚠ 限面：避免别的表里的数字混进来）。 */
function isCarrier(p) {
  const b = p.split('/').pop()
  return b === 'CONTEXT.md' || (b.startsWith('CONTEXT') && b.endsWith('.md')) || b === '08-round-table.md'
}

function expand(a, b) {
  const lo = Number(a)
  const hi = b === undefined ? lo : Number(b)
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return []
  if (hi - lo > MAX_SPAN || lo > MAX_ROUND) return []
  const out = []
  for (let n = lo; n <= hi && n <= MAX_ROUND; n++) out.push(n)
  return out
}

/** ① 全历史**曾经出现**的标识（⚠ = `UD-114` 那条不变量的"曾出现过"一侧）。
 *
 *  ⚠ ⚠ **为什么用"全部历史 blob 的并集"而不是"读数 patch 流"**（⚠ 实测教训）：
 *    patch 流的删行**不带它所在的节上下文**（`-U0` 时），⚠ 于是 `CONTEXT.md` 的**教训表**
 *    与 `STEP*-REPORT.md` 里那些 `| 1 |`…`| 12 |` 会被**误当轮次号**
 *    （实测：造出第 1–12 轮这些**从未存在过**的标识 ⇒ 假 FAIL）。
 *    ⇒ ⚠ 改为：`git rev-list --all --objects` 列出**每个历史版本的载体 blob**，
 *    逐个取它 `### 5.1` 段里的标识并集 —— ⚠ **节上下文由正文本身保证**，⛔ 不靠流式跟踪。
 *    ⚠ 成本实测 ~0.5s（231 个 blob · 一次 `cat-file --batch`）。
 */
function everSeen(ledgerRoot) {
  const s = new Set()
  const objs = tryGit(['rev-list', '--all', '--objects'], ledgerRoot)
  if (objs === null) return s
  const blobs = new Set()
  for (const line of objs.split('\n')) {
    if (line === '' || !line.includes(' ')) continue
    const idx = line.indexOf(' ')
    const sha = line.slice(0, idx)
    const path = line.slice(idx + 1)
    if (!path.endsWith('.md') || !isCarrier(path)) continue
    if (path.includes('/') && !path.startsWith('volumes/') && !path.startsWith('archive/')) continue
    blobs.add(sha)
  }
  if (blobs.size === 0) return s
  const list = [...blobs]
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200)
    const out = tryGitBuf(['cat-file', '--batch'], ledgerRoot, chunk.join('\n') + '\n')
    if (out === null) continue
    // ⚠ ⚠ **必须按字节切**（`cat-file --batch` 报的 size 是**字节数**）：
    //   ⚠ 若先把整块转成 JS 字符串再按 size 切，⚠ **多字节字符会让偏移越切越歪** ——
    //   实测（本单）：231 个 blob 只解析出 **2** 个 ⇒ ⚠ 历史并集被算成 29 个标识（**静默变小**，
    //   而那正好会让本检查**变哑**：历史集太小 ⇒ 差集近乎恒空）⇒ ⚠ 一律在 Buffer 上按 byte 偏移切。
    let pos = 0
    while (pos < out.length) {
      const nl = out.indexOf(0x0a, pos)
      if (nl < 0) break
      const parts = out.subarray(pos, nl).toString('utf8').split(' ')
      if (parts.length < 3) break
      const size = Number(parts[2])
      if (!Number.isFinite(size)) break
      const body = out.subarray(nl + 1, nl + 1 + size).toString('utf8')
      for (const id of idsInSection(body)) s.add(id)
      pos = nl + 1 + size + 1
    }
  }
  return s
}

/** 从 §5.1 段里取标识（⚠ 该段是轮次登记的权威面）。 */
function idsInSection(text) {
  const out = new Set()
  let inside = false
  for (const line of text.split('\n')) {
    if (SEC51.test(line)) { inside = true; continue }
    if (inside && NEXT_SEC.test(line)) break
    if (!inside) continue
    if (SEP.test(line.trim()) || line.startsWith('| 轮')) continue
    const m = ROW.exec(line)
    if (m !== null) out.add(m[2] === undefined ? m[1] : `${m[1]}–${m[2]}`)
  }
  return out
}

/** ② 现在能查到的标识（⚠ **轮次登记的两种载体**：§5.1 段 · 记录件目录的文件名/首行标识）。 */
function atNow(ledgerRoot) {
  const s = new Set()
  const rels = tryGit(['ls-tree', '-r', '--name-only', 'HEAD'], ledgerRoot)
  if (rels === null) return s
  for (const p of rels.split('\n')) {
    if (!p.endsWith('.md')) continue
    // (a) 旧载体：CONTEXT*.md / 08-round-table.md 的 §5.1 段
    if (isCarrier(p) && (!p.includes('/') || p.startsWith('volumes/') || p.startsWith('archive/'))) {
      const txt = tryGit(['show', `HEAD:${p}`], ledgerRoot)
      if (txt !== null) for (const id of idsInSection(txt)) s.add(id)
      continue
    }
    // (b) 新载体：记录件目录里的**文件名本身就是标识**
    if (p.startsWith(`${RECORDS_DIR}/`)) {
      const id = p.slice(RECORDS_DIR.length + 1).replace(/\.md$/, '').replace(/-/, '–')
      if (idToRange(id) !== null) s.add(id)
    }
  }
  return s
}

function idToRange(id) {
  const m = /^(\d{1,4})(?:[–-](\d{1,4}))?$/.exec(id)
  if (m === null) return null
  return { a: Number(m[1]), b: m[2] === undefined ? Number(m[1]) : Number(m[2]) }
}

/** ② 记录件目录里的覆盖（⚠ 文件名 = 标识 ⇒ `55-178.md` 覆盖 55..178）。 */
function coverageFromFiles(ledgerRoot) {
  const set = new Set()
  let files = []
  try {
    files = readdirSync(join(ledgerRoot, RECORDS_DIR)).filter((f) => f.endsWith('.md'))
  } catch {
    return { set, files, missingDir: true }
  }
  for (const f of files) {
    const r = idToRange(f.replace(/\.md$/, '').replace(/-/, '–'))
    if (r === null) continue
    for (const n of expand(r.a, r.b)) set.add(n)
  }
  return { set, files, missingDir: false }
}

function countCommits(ledgerRoot) {
  const t = tryGit(['rev-list', '--count', 'HEAD'], ledgerRoot)
  return t === null ? 0 : Number(t.trim())
}

function expandAll(ids) {
  const s = new Set()
  for (const id of ids) {
    const r = idToRange(id)
    if (r !== null) for (const n of expand(r.a, r.b)) s.add(n)
  }
  return s
}

// ── 判据本体 ──────────────────────────────────────────────────────────────
function runCheck(ledgerRoot) {
  const ever = everSeen(ledgerRoot)
  const now = atNow(ledgerRoot)
  const commits = countCommits(ledgerRoot)

  const everExpanded = expandAll(ever)
  const nowExpanded = expandAll(now)
  const missing = [...everExpanded].filter((n) => !nowExpanded.has(n)).sort((a, b) => a - b)

  const cov = coverageFromFiles(ledgerRoot)
  const uncovered = [...nowExpanded].filter((n) => !cov.set.has(n)).sort((a, b) => a - b)

  const bad = []
  if (missing.length > 0) {
    bad.push('✗ **轮次标识集变小了** —— 这些号曾在载体里有过记录，而**现在再也查不到**：'
      + ` ${missing.join(' / ')}`
      + `\n      ⇒ ⚠ 这正是「移出行 → 槽位」没落地（**CHG-043**）⇒ 按新结构把**该轮的记录件**补进 \`${RECORDS_DIR}/\`。`)
  }
  if (cov.missingDir) {
    bad.push(`✗ **记录件目录不存在**：\`${RECORDS_DIR}/\` ⇒ "每个标识都有记录件"这一层无从核验（⛔ 不按通过处理）`)
  } else if (uncovered.length > 0) {
    bad.push(`✗ **这些轮次号没有任何记录件**（\`${RECORDS_DIR}/\` 里查不到覆盖它们的文件名）：`
      + ` ${uncovered.join(' / ')}`
      + '\n      ⇒ ⚠ 补该轮的记录件（⚠ 打包行建一件即可覆盖整个区间）。')
  }

  const note = `✓ 轮次标识只增不减 · 且每个标识都有记录件 —— 扫描提交 ${commits} 个 · `
    + `曾出现过的标识 ${ever.size} 个（展开 ${everExpanded.size} 个号）· 现可查到 ${now.size} 个（展开 ${nowExpanded.size} 个号）· `
    + `记录件 ${cov.files.length} 个 · 差集（曾出现过而现查不到）**${missing.length === 0 ? '空' : missing.join(' / ')}** · `
    + `未被记录件覆盖**${uncovered.length === 0 ? '空' : uncovered.join(' / ')}**`
  return { bad, note, ever, now, commits, missing, uncovered, cov }
}

// ── 自带负向对拍（⛔ 不依赖账本区内容 · ⛔ 不触碰真账本）──────────────────
function buildFixture() {
  const base = mkdtempSync(join(tmpdir(), 'hob-rounds-selftest-'))
  const L = join(base, 'ledger')
  mkdirSync(join(L, RECORDS_DIR), { recursive: true })
  const git = (args) => execFileSync('git', args, { cwd: L, encoding: 'utf8' })
  execFileSync('git', ['init', '-q'], { cwd: L })
  git(['config', 'user.email', 't@t'])
  git(['config', 'user.name', 't'])

  // 提交 1：表里有 100 / 101 / 102
  writeFileSync(join(L, 'CONTEXT.md'), [
    '### 5.1 轮次与落点', '',
    '| 轮 | 内容 | 落点 |', '|---|---|---|',
    '| 100 | 甲 | 账本 `a` |',
    '| 101 | 乙 | 账本 `b` |',
    '| 102 | 丙 | 账本 `c` |', '',
  ].join('\n'))
  git(['add', '-A']); git(['commit', '-qm', 'r100-102'])

  // 提交 2：换载体 —— 记录件齐（正确形态）
  writeFileSync(join(L, 'CONTEXT.md'), '### 5.1 轮次与落点\n\n> 记录已换载体。\n')
  writeFileSync(join(L, 'SLOT.md'), '| 101 | 乙 | 账本 `b` |\n| 102 | 丙 | 账本 `c` |\n')
  for (const n of ['100', '101', '102']) writeFileSync(join(L, RECORDS_DIR, `${n}.md`), `# 轮次记录 · ${n}\n`)
  git(['add', '-A']); git(['commit', '-qm', 'move-with-records'])
  const good = git(['rev-parse', 'HEAD']).trim()

  // 提交 3（坏·第一层）：删 102 且不留槽、不建记录件
  writeFileSync(join(L, 'SLOT.md'), '| 101 | 乙 | 账本 `b` |\n')
  rmSync(join(L, RECORDS_DIR, '102.md'), { force: true })
  git(['add', '-A']); git(['commit', '-qm', 'drop-102-no-slot'])
  const badRev = git(['rev-parse', 'HEAD']).trim()

  // 提交 4（坏·第二层）：**号回到了 §5.1 段里**（旧习惯：往表里加行），却**没建记录件**
  //   ⇒ ⚠ 第一层（只增不减）**咬不到它**（号还在），⚠ 正是第二层该抓的形态。
  writeFileSync(join(L, 'CONTEXT.md'), [
    '### 5.1 轮次与落点', '',
    '| 轮 | 内容 | 落点 |', '|---|---|---|',
    '| 101 | 乙 | 账本 `b` |', '',
  ].join('\n'))
  writeFileSync(join(L, 'SLOT.md'), '| 101 | 乙 | 账本 `b` |\n| 102 | 丙 | 账本 `c` |\n')
  rmSync(join(L, RECORDS_DIR, '101.md'), { force: true })
  git(['add', '-A']); git(['commit', '-qm', 'row-without-record-file'])
  const noFile = git(['rev-parse', 'HEAD']).trim()

  return { base, L, good, badRev, noFile }
}

function selfTest() {
  const fx = buildFixture()
  const readings = []
  let failed = 0
  const at = (rev) => execFileSync('git', ['checkout', '-q', rev], { cwd: fx.L })

  at(fx.good)
  let r = runCheck(fx.L)
  const ok1 = r.missing.length === 0 && r.uncovered.length === 0 && r.bad.length === 0
  readings.push({ label: '① 换载体且记录件齐（100/101/102）', expect: '两层都空 · 不咬',
    got: ok1 ? '两层都空' : `missing=${r.missing} uncovered=${r.uncovered}`, pass: ok1 })
  if (!ok1) failed++

  at(fx.badRev)
  r = runCheck(fx.L)
  const ok2 = r.missing.includes(102) && r.bad.length > 0
  readings.push({ label: '② 删行且不留槽（102）', expect: 'FAIL · 点名 102',
    got: r.uncovered.includes(102) || r.missing.includes(102) ? `FAIL · 点名 ${[...new Set([...r.missing, ...r.uncovered])].join(',')}` : '未咬（假绿）',
    pass: ok2 })
  if (!ok2) failed++

  at(fx.noFile)
  r = runCheck(fx.L)
  const ok3 = r.uncovered.includes(101) && r.bad.length > 0
  readings.push({ label: '③ 号在但记录件被删（101）', expect: 'FAIL · 点名 101',
    got: r.uncovered.includes(101) ? `FAIL · 点名 ${r.uncovered.join(',')}` : '未咬（假绿）', pass: ok3 })
  if (!ok3) failed++

  rmSync(fx.base, { recursive: true, force: true })

  console.log('轮次标识只增不减 · 自带负向对拍')
  for (const x of readings) console.log(`  ${x.pass ? '✓' : '✗'} ${x.label} —— 期望 ${x.expect} · 实测 ${x.got}`)
  const okAll = failed === 0
  console.log('')
  console.log(okAll
    ? `判定：PASS —— ${readings.length} 档**全部符合预期**（1 档"不该咬"未被咬 · 2 档"该咬"真被咬且**点名了号**）`
    : `判定：FAIL —— ${failed}/${readings.length} 档不符（⚠ 判据改哑了：坏状态都放过去了）`)
  return okAll ? 0 : 1
}

// ── main ─────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
if (argv.includes('--self-test')) process.exit(selfTest())

const li = argv.indexOf('--ledger')
const cliLedger = li >= 0 ? argv[li + 1] : undefined
const ledgerRoot = resolveLedgerRoot(cliLedger)

console.log('轮次标识「只增不减 · 每个标识都有记录件」机检 · dsh-hob')
if (ledgerRoot === undefined) {
  console.log(`账本区：**解析不到**（ledgerHome=${ledgerHome() ?? '读不到'} · 工作区名=${workspaceName()}）`)
  console.log('')
  console.log('判定：**未执行** —— 账本区读不到 ⇒ 本检查**不代表通过**（退出码 2，与"通过"分档）')
  process.exit(2)
}
console.log(`账本区：${ledgerRoot}`)
console.log('')

const { bad, note } = runCheck(ledgerRoot)
console.log('  ✓', note)
console.log('')
console.log('⚠ 覆盖面（归纳，⛔ 非穷举）：只管**轮次标识**这一类 · 取数面限于轮次登记的载体 '
  + '（`CONTEXT*.md` 整份 + `08-round-table.md`）· ⛔ 不管"号还在但内容被换掉" · ⛔ 不管"记录件起好了而指针没点到它"。')
console.log('')
if (bad.length === 0) {
  console.log('判定：PASS —— 轮次标识只增不减，且每个标识都有记录件。')
  process.exit(0)
}
console.log('判定：FAIL')
for (const f of bad) console.log(' ', f)
process.exit(1)
