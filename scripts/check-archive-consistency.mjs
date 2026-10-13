#!/usr/bin/env node
/**
 * 归档一致性机检 · dsh-hob —— 把「归档核验」从**人守**搬到**机器守**（2026-10-12 · 第 108 轮）。
 *
 * ══ 两半（互补，缺一不可）══════════════════════════════════════════════════
 *
 * **① 归档件字节 == 源修订字节** —— 账本区 `archive/<日期>-<名>/sources/**` 的既有做法实测有
 *   **两种形态**（先实测再定，⛔ 不猜、⛔ 不写死预期份数 / 预期字节数）：
 *
 *   · **形态 M（清单表）** —— 范例 `archive/2026-10-10-skeleton-restructure/README.md`：
 *     表列「`sources/<rel>` · 目标路径 · 字节数 · md5」（实测 6 行）。
 *     ⇒ 判据 = 逐份**实测**归档件的**字节数与 md5**，与清单**逐字对照**；不一致即点名
 *       「文件 + 期望（清单）+ 实测（当场 fs）」。
 *     ⚠ **已知边界（照实登记，不消灭）**：清单是**自报读数** —— 它自己**没有独立执行器**
 *       （**E-137**：表格里的提交号 / 字节数 / 行数，没有任何东西复算它）。
 *       故本脚本另跑一条**辅助交叉核对（⛔ 不参与判定）**：把归档件的 blob sha1 与
 *       **工作区仓里该「原文件路径」的历史修订**逐个对一眼 —— 对上 ⇒ 该归档件确曾是那份源文件
 *       （这是对 E-137 的部分补位）；对不上**不判 FAIL**（合法情形：归档时那份源**从未提交**）。
 *
 *   · **形态 S（声明源修订）** —— 范例 `archive/2026-10-12-plan-v2-5/README.md` 的
 *     `> 来源：账本仓提交 **`d391602`**（第 102 轮那笔）时的**改动前整份**。`（实测 13 文件）
 *     ⇒ 判据 = 对 `sources/**` 下**每一个**文件，用
 *       `git -C <账本根> show <rev>:<相对 sources/ 的路径>` 取源内容，与归档件**逐字节**比对
 *       （Buffer 直比 + 打印两侧字节数与 md5）。
 *     ⚠ **只比对归档里真有的那份**：README 明说本形态只收「**本次改动**的那些卷」
 *       ⇒ 缺失的卷**不判**（那是归档范围，不是缺失）。⛔ 不许把它变成"清单必须列全"。
 *
 * **② 目录形态的引用，也核其内文件** —— 第 106 轮实证：现有机检（**断言 D**）只
 *   `existsSync(目录)` ⇒ **只认目录存在、不认里面缺哪一份**。
 *   ⇒ 本半扫账本区正本（根上 `*.md`，派生）+ `volumes/` 下的 `*.md`（递归派生）里
 *     `archive/<YYYY-MM-DD-slug>/…` 形式的引用；**当引用指向目录时**，
 *     按该归档目录 README 的清单（+ 账本仓 index 里该目录下的成员）核成员是否**齐备**，
 *     **逐条点名「缺了哪一份」**。
 *   ⚠ **与断言 D 互补、且不重复它的活**：文件形态引用 / 路径不存在 ⇒ 归 D，本脚本不掺和。
 *   ⛔ **不改** `check-doc-shape.mjs`（那是**另一张并行卡**的面）。
 *
 * ══ ⛔ 不许「扫 0 份报 ✓」（E-126 口径）══════════════════════════════════
 *   账本区**存在**含 `sources/` 的归档目录 ⇒ ① 的**比较对数必须 > 0**，否则 **FAIL**
 *   并如实打印「无对象可查」；② 同理：有目录形态引用 ⇒ 成员比对对数必须 > 0，否则 **FAIL**。
 *
 * ══ 退出码（三档，与 `check:host` 同族：**"没测到"与"通过"必须分得开**）══════
 *   0 = 已执行且全过 · 1 = 有 FAIL（逐条打印**可读断言行**）· 2 = **未执行 / 基准缺失**（不代表通过）
 *
 * ══ 自带负向对拍（硬要求 · E-112 / E-126）════════════════════════════════
 *   `--self-test` 在**临时夹具**上把**两半各咬一次**（破坏 ⇒ FAIL 且输出有可读断言行；
 *   还原 ⇒ PASS），**六档读数**当场打印 —— 夹具写死在脚本里、**不依赖账本区内容**，
 *   且**不触碰账本区一个字节**（账本区只读，⛔ 不许为对拍去改它）。
 *
 * ══ 用法 ══════════════════════════════════════════════════════════════
 *   node scripts/check-archive-consistency.mjs                 （或 npm run check:archive）
 *   node scripts/check-archive-consistency.mjs --self-test     （自带负向对拍）
 *   node scripts/check-archive-consistency.mjs --ledger <目录>  （指定账本区；默认按账本根派生）
 *
 * ⚠ **零第三方依赖**（本仓纪律）。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const posix = (p) => p.split('\\').join('/')
const md5 = (buf) => createHash('md5').update(buf).digest('hex')

/** git（文本）；失败返回 null（⛔ 不把"跑不动"当成"没问题"）。 */
function tryGit(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  } catch {
    return null
  }
}

/** git（**字节**，无 encoding）—— 形态 S 的逐字节比对专用（⛔ 不经 UTF-8 转码）。 */
function tryGitBuf(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, maxBuffer: 256 * 1024 * 1024 })
  } catch {
    return null
  }
}

/** 递归列出目录下的**普通文件**（账本区是数据目录，规模可控）。 */
function walkFiles(dir, acc = []) {
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, acc)
    else if (e.isFile()) acc.push(p)
  }
  return acc
}

// ── 账本根派生（⛔ 不硬编码本机绝对路径：`ledgerHome` 从预设行读，见 UD-73③）──────────
/**
 * 工作区目录名。
 *
 * ⚠ **为什么不直接 `basename(root)`**（既有脚本的写法）：本卡在**看板 worktree** 里作业，
 *   worktree 目录名是 `<taskId>`、不是工作区名 ⇒ `basename(root)` 会派生出
 *   `.../hob-ledgers/t-mv54am90-yqilyy`（不存在）⇒ 整条检查**静默跳过**
 *   （实测：同一 worktree 里 `check:gitignore` 的账本区断言全部打印「未执行」）。
 *   ⇒ 改用 **git-common-dir 的父目录名** = **主工作区目录名**，worktree 里也派得对
 *   （实测本卡：`/home/lk/FF/dsh-hob/.git` ⇒ `dsh-hob` ⇒ 账本区**真的查起来了**）。
 */
function workspaceName() {
  const abs = tryGit(['rev-parse', '--path-format=absolute', '--git-common-dir'], root)
  if (abs !== null && abs.trim() !== '') return basename(dirname(abs.trim()))
  const rel = tryGit(['rev-parse', '--git-common-dir'], root)
  if (rel !== null && rel.trim() !== '') return basename(dirname(join(root, rel.trim())))
  return basename(root)
}

/** 从预设行读 `ledgerHome`（与既有脚本同口径）。 */
function ledgerHome() {
  try {
    const preset = readFileSync(join(root, 'preset', 'dsh-hob', 'preset-dsh-hob.patch.yml'), 'utf8')
    const m = /ledgerHome:\s*(\S+)/.exec(preset)
    return m === null ? null : m[1]
  } catch {
    return null
  }
}

/** 账本区 = `<ledgerHome>/<工作区名>/`；读不到 / 不存在 ⇒ undefined（⇒ 退 2 档，⛔ 不静默通过）。 */
function resolveLedgerRoot(cliLedger) {
  if (typeof cliLedger === 'string' && cliLedger !== '') return cliLedger
  const home = ledgerHome()
  if (home === null) return undefined
  const cand = join(home, workspaceName())
  return existsSync(cand) ? cand : undefined
}

// ── 解析：READM E 里的两种形态 ────────────────────────────────────────────────
/**
 * 声明的源修订（形态 S）：在含「来源：」的那一行里取**反引号包裹的 hex 号**。
 * ⚠ 只认**那一行**（⛔ 不通扫全文：正文里的 `E-109` / md5 之类都不该被当成修订号）。
 */
function parseDeclaredRev(src) {
  const line = src.split('\n').find((l) => /来源[：:]/.test(l))
  if (line === undefined) return null
  const m = /`([0-9a-fA-F]{7,40})`/.exec(line)
  return m === null ? null : m[1]
}

/**
 * 清单表（形态 M）：取每行里「`sources/<rel>` + 纯数字字节数 + 32 位 md5」三件齐备的行。
 * ⚠ **一行三件不齐 ⇒ 不贡献比对对象**（那是别的表：如「路径 | 是什么」表）——
 *   这样形态 M 与形态 S 可以**同处共存**而不互相污染（实测两范例分属两形态）。
 */
function parseManifest(src) {
  const rows = []
  for (const line of src.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
    if (cells.length === 0 || cells.every((c) => /^:?-{2,}:?$/.test(c))) continue
    const arcCell = cells.find((c) => /`sources\/[^`]+`/.test(c))
    if (arcCell === undefined) continue
    const rel = /`(sources\/[^`]+)`/.exec(arcCell)[1]
    const hashIdx = cells.findIndex((c) => /\b[0-9a-f]{32}\b/.test(c))
    // ⚠ 字节数取**md5 之前**最后一个纯数字格 —— ⛔ 不能"随便找一个纯数字格"：
    //   表格首格是**行号**（实测吃过的亏：把 `1` 当成了字节数 ⇒ 明明一致的件被判不一致，
    //   而且**破坏前后读数相同** ⇒ 差一步就变成"永远红"的假报障。本脚本的 --self-test
    //   第一版就是当场被这一条咬住，故此处留档）。
    const bytesIdx = hashIdx < 0 ? -1 : cells.slice(0, hashIdx).reduce((acc, c, i) => (/^\d+$/.test(c) ? i : acc), -1)
    if (hashIdx < 0 || bytesIdx < 0) continue
    rows.push({ rel, bytes: Number(cells[bytesIdx]), md5: /([0-9a-f]{32})/.exec(cells[hashIdx])[1] })
  }
  return rows
}

/**
 * README 里「算作归档成员」的**具名路径 token**（表格首格里的反引号串）。
 *
 * 收录口径（**保守**，宁可少收也不误报 —— E-114：判据过宽会反过来塑造内容）：
 *   token 须是**相对路径形态**，且满足其一：
 *     · 以 `sources/` 开头（归档目录里就有这一份）；或
 *     · 在**该归档目录根下**真有这个条目（如 `TASK-R103.md`）；或
 *     · 在**该归档目录的 `sources/` 下**真有这个条目（如骨架那份 README 里
 *       裸写的 `README.md` / `preset-contracts.md`，它们指的是 `sources/<名>`）。
 * ⛔ 因此 `.hob/…` / `scripts/…` / `volumes/…` 这类**源侧路径**与**指向账本别处**的路径
 *   **天然落选**（它们确实不是该归档目录的成员），不需要另写排除表。
 */
function readmePathTokens(readme, arcAbs) {
  const out = new Set()
  for (const line of readme.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue
    const first = line.trim().replace(/^\|/, '').split('|')[0] ?? ''
    for (const m of first.matchAll(/`([^`]+)`/g)) {
      const t = m[1].trim()
      if (t === '' || t.includes('*')) continue // 通配另走 glob 组
      if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._/-]+)?$/.test(t)) continue
      if (t.startsWith('sources/')) { out.add(t); continue }
      if (existsSync(join(arcAbs, t))) { out.add(t); continue }
      if (existsSync(join(arcAbs, 'sources', t))) { out.add(`sources/${t}`); continue }
    }
  }
  return out
}

/** 单星通配（`sources/volumes/plan/*.md` 形态）在该归档目录下的匹配数。 */
function globCount(arcAbs, token) {
  const star = token.indexOf('*')
  if (star < 0) return 0
  const prefix = token.slice(0, star)
  const suffix = token.slice(star + 1)
  return walkFiles(arcAbs).filter((f) => {
    const rel = posix(relative(arcAbs, f))
    return rel.startsWith(prefix) && rel.endsWith(suffix)
  }).length
}

// ── 半 ①：归档件字节 == 源修订字节 ────────────────────────────────────────────
function checkArchiveBytes({ ledgerRoot, bad, ok }) {
  const stat = { sourceDirs: 0, pairs: 0, formS: 0, formM: 0, mismatched: 0, globGroups: 0 }
  const arcRoot = join(ledgerRoot, 'archive')
  const dirs = []
  try {
    for (const e of readdirSync(arcRoot, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const sdir = join(arcRoot, e.name, 'sources')
      if (existsSync(sdir) && statSync(sdir).isDirectory()) dirs.push({ name: e.name, dir: join(arcRoot, e.name), sources: sdir })
    }
  } catch { /* 下面按"无对象"处理 */ }
  dirs.sort((a, b) => a.name.localeCompare(b.name))
  stat.sourceDirs = dirs.length

  if (dirs.length === 0) {
    ok('① 归档件字节比对【未执行】—— 账本区**没有含 `sources/` 的归档目录** ⇒ 无对象可查，'
      + '「不代表通过」（⛔ 不报 ✓）')
    return { executed: false, ...stat }
  }

  for (const d of dirs) {
    const relDir = posix(relative(ledgerRoot, d.dir))
    const readmePath = join(d.dir, 'README.md')
    let readme = ''
    try { readme = readFileSync(readmePath, 'utf8') } catch { readme = '' }
    if (readme === '') {
      bad(`① 含 sources/ 的归档目录**缺 README.md**（或读不到）：\`${relDir}\``
        + '\n      ⇒ 归档清单是本检查的**唯一比对基准**；基准读不到必须 FAIL，⛔ 不许静默（E-126 同族）')
      continue
    }
    const rev = parseDeclaredRev(readme)
    const manifest = parseManifest(readme)
    const seen = new Set()

    // 形态 S：sources/** 下每一个文件都要与声明的源修订逐字节一致
    for (const f of walkFiles(d.sources)) {
      const relInSources = posix(relative(d.sources, f))
      const relFromArchive = `sources/${relInSources}`
      const relLedger = posix(relative(ledgerRoot, f))
      const buf = readFileSync(f)

      if (rev !== null) {
        stat.pairs += 1
        stat.formS += 1
        const srcBuf = tryGitBuf(['show', `${rev}:${relInSources}`], ledgerRoot)
        if (srcBuf === null) {
          stat.mismatched += 1
          bad(`①[形态 S] 归档件在**声明的源修订里不存在**：\`${relLedger}\``
            + `\n      ⇒ 声明来源：修订 \`${rev}\`（清单：${relDir}/README.md）`
            + `\n      ⇒ 核实方式：在 ${ledgerRoot} 跑 \`git show ${rev}:${relInSources}\``)
        } else if (!buf.equals(srcBuf)) {
          stat.mismatched += 1
          bad(`①[形态 S] 归档件与**声明的源修订**逐字节不一致：\`${relLedger}\``
            + `\n      ⇒ 期望（修订 \`${rev}:${relInSources}\`）：${srcBuf.length} 字节 · md5 ${md5(srcBuf)}`
            + `\n      ⇒ 实测（当场 fs）                        ：${buf.length} 字节 · md5 ${md5(buf)}`)
        }
      }

      const m = manifest.find((r) => r.rel === relFromArchive)
      if (m !== undefined) {
        seen.add(m.rel)
        stat.pairs += 1
        stat.formM += 1
        const actualBytes = buf.length
        const actualMd5 = md5(buf)
        if (actualBytes !== m.bytes || actualMd5 !== m.md5) {
          stat.mismatched += 1
          bad(`①[形态 M] 归档件与**README 清单**逐字节不一致：\`${relLedger}\``
            + `\n      ⇒ 期望（清单：${relDir}/README.md）：${m.bytes} 字节 · md5 ${m.md5}`
            + `\n      ⇒ 实测（当场 fs）                 ：${actualBytes} 字节 · md5 ${actualMd5}`)
        }
      }
    }

    // 清单列了、归档里却没有的
    for (const m of manifest) {
      if (seen.has(m.rel)) continue
      stat.pairs += 1
      stat.formM += 1
      stat.mismatched += 1
      bad(`①[形态 M] README 清单列了**归档里没有的**文件：\`${relDir}/${m.rel}\``
        + `\n      ⇒ 清单（${relDir}/README.md）声明它应在：${m.bytes} 字节 · md5 ${m.md5}`
        + `\n      ⇒ 实测：该路径**不存在**`)
    }

    // 通配行（如 `sources/volumes/plan/*.md`）：≥1 命中才算有对象（⛔ 不许 0 命中报 ✓）
    for (const token of new Set([...readme.matchAll(/`(sources\/[^`]*\*[^`]*)`/g)].map((x) => x[1]))) {
      stat.pairs += 1
      stat.globGroups += 1
      const n = globCount(d.dir, token)
      if (n === 0) {
        stat.mismatched += 1
        bad(`①[形态 M] README 的通配行**零命中**：\`${relDir}\` 里的 \`${token}\``
          + '\n      ⇒ 通配行至少要有 1 份命中，否则该行等于"声明了一组不存在的归档件"')
      }
    }
  }

  if (stat.pairs === 0) {
    bad('① 账本区**存在**含 `sources/` 的归档目录，但**比较对数 = 0** ⇒ **无对象可查**'
      + '\n      ⇒ ⛔ 不许报 ✓（E-126：那正是"扫 0 份报绿"的假绿形态）')
    return { executed: true, ...stat }
  }
  if (stat.mismatched === 0) {
    ok(`① 归档件字节比对【已执行】—— ${stat.sourceDirs} 个含 \`sources/\` 的归档目录；`
      + `比较对数 ${stat.pairs}（形态 S ${stat.formS} · 形态 M ${stat.formM}${stat.globGroups > 0 ? ` · 通配组 ${stat.globGroups}` : ''}）`
      + '，**全部逐字节一致**')
  }
  return { executed: true, ...stat }
}

/**
 * ①c **辅助交叉核对**（⛔ 不参与判定）：形态 M 的清单是自报读数（E-137），
 *   这里把归档件的 blob sha1 与工作区仓里「该原文件路径」的历史修订逐个对一眼。
 *   ⇒ 对上 = 该归档件**确曾是**那份源文件（独立证据）；对不上**不判 FAIL**
 *     （合法情形：归档时那份源从未提交 / 该路径不在本仓）。
 */
function crossCheckAgainstWorkspaceHistory({ ledgerRoot, bad: _bad, ok }) {
  const arcRoot = join(ledgerRoot, 'archive')
  let matched = 0
  let checked = 0
  let notFound = 0
  const notes = []
  try {
    for (const e of readdirSync(arcRoot, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const dir = join(arcRoot, e.name)
      const readmePath = join(dir, 'README.md')
      if (!existsSync(join(dir, 'sources'))) continue
      let readme = ''
      try { readme = readFileSync(readmePath, 'utf8') } catch { continue }
      for (const row of parseManifest(readme)) {
        const srcPath = (() => {
          for (const line of readme.split('\n')) {
            if (!line.includes(row.rel)) continue
            const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
            for (const c of cells) {
              const t = /`([^`]+)`/.exec(c)
              if (t !== null && t[1] !== row.rel && /^[A-Za-z0-9._/-]+$/.test(t[1])) return t[1]
            }
          }
          return null
        })()
        if (srcPath === null) continue
        const f = join(dir, row.rel)
        if (!existsSync(f)) continue
        checked += 1
        const want = createHash('sha1')
          .update(`blob ${statSync(f).size}\0`)
          .update(readFileSync(f))
          .digest('hex')
        const revs = tryGit(['log', '--all', '--format=%H', '-n', '200', '--', srcPath], root)
        if (revs === null || revs.trim() === '') { notFound += 1; continue }
        let hit = false
        for (const r of revs.split('\n').map((x) => x.trim()).filter(Boolean)) {
          const sha = tryGit(['rev-parse', `${r}:${srcPath}`], root)
          if (sha !== null && sha.trim() === want) { hit = true; break }
        }
        if (hit) matched += 1
        else { notFound += 1; notes.push(`${row.rel}（原路径 ${srcPath}）`) }
      }
    }
  } catch { /* 下面按"未取"处理 */ }
  if (checked === 0) {
    ok('①c 历史交叉核对【未执行】—— 形态 M 清单为空 / 读不到 ⇒ 无对象可查（⛔ 不报 ✓）')
    return { checked, matched, notFound }
  }
  ok(`①c 历史交叉核对（**辅助读数，⛔ 不参与判定**）—— ${checked} 份里 ${matched} 份能在`
    + `**工作区仓的历史修订**中逐字节对上（原路径 blobs）；${notFound} 份对不上`
    + `${notes.length > 0 ? `（${notes.join(' · ')}）` : ''}`
    + '。⚠ 对不上**不判 FAIL**：归档时那份源可能从未提交 ⇒ 这是 E-137 的**部分**补位，非判据')
  return { checked, matched, notFound }
}

// ── 半 ②：目录形态的引用，核其内文件 ──────────────────────────────────────────
// ⚠ 与 `src/server/hob-write.ts` 的 `REF_PATH_RE` / `check-doc-shape.mjs` 的 `D_REF_RE`
//   **同形**（日期命名的归档目录）。⛔ 本脚本**不改**那两处；⚠ **已知边界**：本处是**第三份**
//   字面量，**断言 K 不覆盖它**（K 只覆盖"两侧都在的文件"，其注释已自陈此边界）。
const REF_PATH_RE = /archive\/\d{4}-\d{2}-\d{2}-[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]*/g

/** 扫描面 = 账本区根上 `*.md` + `volumes/` 下的 `*.md`（递归；**派生**，⛔ 不手抄清单 —— E-133）。 */
function deriveScanFiles(ledgerRoot) {
  const out = []
  try {
    for (const e of readdirSync(ledgerRoot, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.md')) out.push(e.name)
    }
  } catch { /* 无对象 */ }
  for (const f of walkFiles(join(ledgerRoot, 'volumes'))) {
    if (f.endsWith('.md')) out.push(posix(relative(ledgerRoot, f)))
  }
  return out.sort()
}

/**
 * 某归档目录（或其子目录）的**成员清单**（账本根相对路径）。
 * 两个来源**并集**（各自的盲区互补）：
 *   (a) **该归档目录 README 的清单** —— 具名 token（含 `sources/**` 通配组）；
 *   (b) **账本仓 index 里该目录下的成员** —— 覆盖"README 没列、但已入库"的那批，
 *       ⛔ 这也正是**断言 D 的盲区**（D 连"目录里少一份"都不看）。
 */
function archiveMembers(ledgerRoot, relDir) {
  const set = new Set()
  // ⚠ **必须用 `-z`（NUL 分隔）**：`git ls-files` 默认 `core.quotePath=true` ⇒ **非 ASCII 路径**
  //   会被 C 式引号化（`"…\350\264\237…"`）⇒ 拿去做 `existsSync` **恒 false** ⇒ 把**存在**的成员
  //   报成"缺成员"（**第 122 轮实测 105/554 全是假报**）。`-z` 关闭引号化，逐字节给出真实路径。
  const tracked = tryGit(['ls-files', '-z', '--', relDir], ledgerRoot)
  if (tracked !== null) for (const t of tracked.split('\0').filter(Boolean)) set.add(t)
  const m = /^(archive\/[^/]+)/.exec(relDir)
  if (m !== null) {
    const arcRel = m[1]
    const arcAbs = join(ledgerRoot, arcRel)
    let readme = ''
    try { readme = readFileSync(join(arcAbs, 'README.md'), 'utf8') } catch { readme = '' }
    for (const row of parseManifest(readme)) set.add(`${arcRel}/${row.rel}`)
    for (const t of readmePathTokens(readme, arcAbs)) set.add(`${arcRel}/${t}`)
    for (const g of new Set([...readme.matchAll(/`(sources\/[^`]*\*[^`]*)`/g)].map((x) => x[1]))) {
      const star = g.indexOf('*')
      const prefix = g.slice(0, star)
      const suffix = g.slice(star + 1)
      for (const f of walkFiles(arcAbs)) {
        const rel = posix(relative(arcAbs, f))
        if (rel.startsWith(prefix) && rel.endsWith(suffix)) set.add(`${arcRel}/${rel}`)
      }
    }
  }
  return set
}

/**
 * 从盘上**派生**要核的归档目录（⛔ 不依赖"某处正文正好点名了它" —— E-133 / E-142 同族）。
 * 收录判据 = **`archive/` 下的每一个子目录**（⛔ **不再**按 `README.md` / `sources/` 过滤）。
 *
 * ⚠ **为什么"不过滤"**（第 122 轮实测）：凡"收录判据"都自带一个**被排除面** ——
 *   第 121 轮的判据是"有 `README.md` **或** 含 `sources/`"⇒ **两者都不具备的目录**（`rounds-*` 系列 9 个）
 *   **整个不被核**，而**收尾命令逐条仍全绿**。⇒ 口径 = 「说"**谁在盘上就核谁**"，就要真的覆盖盘上**全部**」；
 *   ⚠ **立任何"收录判据"之前，先问一句"谁被它排除在外"**。
 * ⚠ **代价（照实）**：那批目录**无清单载体** ⇒ 成员只来自**账本仓 index**（`git ls-files`）；
 *   ⚠ **若某目录既无 README 又未入库 ⇒ 成员为 0** ⇒ 按既有口径打印"**无成员可核**"（⛔ **不报 ✓**，**E-126**）。
 *   ⚠ 这**不是放宽** —— 覆盖面**只增不减**。
 */
function deriveArchiveDirs(ledgerRoot) {
  const out = []
  const arcRoot = join(ledgerRoot, 'archive')
  try {
    for (const e of readdirSync(arcRoot, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      out.push(`archive/${e.name}`)
    }
  } catch { /* 无 archive/ ⇒ 派生面为空 */ }
  return out.sort()
}

function checkDirRefs({ ledgerRoot, bad, ok }) {
  const stat = {
    scanFiles: 0, refs: 0, dirRefs: 0, dirRefsNamed: 0, dirRefsDerived: 0,
    memberPairs: 0, missing: 0, dirsWithoutMembers: 0, overlapSkipped: 0,
  }
  const files = deriveScanFiles(ledgerRoot)
  stat.scanFiles = files.length
  if (files.length === 0) {
    ok('② 目录成员核【未执行】—— 账本区读不到任何正本 / 卷 `.md` ⇒ 无对象可查，「不代表通过」')
    return { executed: false, ...stat }
  }

  // (a) **正文点名**的目录 —— 保留原路；顺带记下它已覆盖的成员（供 (b) 去重）
  const namedDirs = new Set()
  const namedCovered = new Set()
  for (const f of files) {
    let src = ''
    try { src = readFileSync(join(ledgerRoot, f), 'utf8') } catch { continue }
    src.split('\n').forEach((line, i) => {
      for (const mm of line.matchAll(REF_PATH_RE)) {
        const ref = mm[0]
        if (ref.includes('*')) continue
        stat.refs += 1
        const rel = ref.replace(/\/+$/, '')
        const abs = join(ledgerRoot, rel)
        // 文件形态 / 不存在 ⇒ 归**断言 D**（本脚本不重复它的活，也不打折它）
        if (!existsSync(abs) || !statSync(abs).isDirectory()) continue
        stat.dirRefs += 1
        stat.dirRefsNamed += 1
        namedDirs.add(rel)
        const members = archiveMembers(ledgerRoot, rel)
        for (const memRel of members) namedCovered.add(memRel)
        if (members.size === 0) {
          stat.dirsWithoutMembers += 1
          ok(`② ${f}:${i + 1} 引用的目录 \`${ref}\` **无清单、index 里也无成员** ⇒ 无成员可核（⛔ 不报 ✓）`)
          continue
        }
        for (const memRel of [...members].sort()) {
          stat.memberPairs += 1
          if (!existsSync(join(ledgerRoot, memRel))) {
            stat.missing += 1
            bad(`② 目录形态引用**缺成员**：\`${ref}\`（${f}:${i + 1}）里缺 \`${memRel}\``
              + `\n      ⇒ 引用原文：${line.trim().slice(0, 200)}`
              + `\n      ⇒ 实测：\`${memRel}\` **不存在**（成员清单来自该归档 README 的清单 / 账本仓 index）`
              + '\n      ⇒ 这正是断言 D 的盲区：D 只 `existsSync(目录)`，**只认目录存在、不认里面缺哪一份**'
              + `\n      ⇒ 核实方式：在 ${ledgerRoot} 跑 \`ls ${memRel}\``)
          }
        }
      }
    })
  }

  // (b) **盘上派生**的目录 —— 谁在盘上就核谁（⚠ 与 (a) **同路径去重**；⚠ 另按**成员**去重，
  //     免得 (a) 点名 `…/sources` 而 (b) 派生其父目录时同一个成员被计两遍 ⇒ 读数虚高）。
  const derived = []
  for (const rel of deriveArchiveDirs(ledgerRoot)) {
    if (namedDirs.has(rel)) continue          // (a) 已按同一路径覆盖 ⇒ 只计一次
    stat.dirRefs += 1
    stat.dirRefsDerived += 1
    derived.push(rel)
    const members = archiveMembers(ledgerRoot, rel)
    if (members.size === 0) {
      stat.dirsWithoutMembers += 1
      ok(`② 盘上派生目录 \`${rel}/\` **无清单、index 里也无成员** ⇒ 无成员可核（⛔ 不报 ✓）`)
      continue
    }
    const fresh = [...members].filter((m) => !namedCovered.has(m))
    stat.overlapSkipped += members.size - fresh.length
    for (const memRel of fresh.sort()) {
      stat.memberPairs += 1
      if (!existsSync(join(ledgerRoot, memRel))) {
        stat.missing += 1
        bad(`② 目录形态引用**缺成员**（**盘上派生、无正文点名**）：\`${rel}/\` 里缺 \`${memRel}\``
          + '\n      ⇒ 实测：\`' + memRel + '\` **不存在**（成员清单来自该归档 README 的清单 / 账本仓 index）'
          + '\n      ⇒ 该目录**没有任何正文点名它** ⇒ 只靠这条**派生**覆盖；⛔ 不许因为"没人引用"就跳过'
          + `\n      ⇒ 核实方式：在 ${ledgerRoot} 跑 \`ls ${memRel}\``)
      }
    }
  }

  if (stat.dirRefs > 0 && stat.memberPairs === 0) {
    bad('② 账本区**有目录形态的引用**，但**成员比对对数 = 0** ⇒ **无对象可查**'
      + '\n      ⇒ ⛔ 不许报 ✓（E-126 口径）')
  } else if (stat.memberPairs > 0 && stat.missing === 0) {
    ok(`② 目录成员核【已执行】—— ${stat.scanFiles} 份正本/卷里 ${stat.refs} 处**正文**归档引用；`
      + `**目录形态** ${stat.dirRefs} 处 = **正文点名 ${stat.dirRefsNamed}** + **盘上派生 ${stat.dirRefsDerived}**`
      + `${namedDirs.size > 0 ? `（正文点名去重后 ${namedDirs.size} 个目录）` : ''}`
      + `${stat.overlapSkipped > 0 ? ` ⇒ ⚠ 派生面与点名面重叠、已按成员去重 ${stat.overlapSkipped} 个` : ''}`
      + ` ⇒ 逐目录核成员，共比对 ${stat.memberPairs} 个成员`
      + `${stat.dirsWithoutMembers > 0 ? `；⚠ 另有 ${stat.dirsWithoutMembers} 处引用目录无清单无成员 ⇒ 无成员可核（已如实打印）` : ''}`
      + '，**成员齐备**')
  } else if (stat.refs === 0) {
    ok('② 目录成员核【已执行】—— 账本区里**没有** `archive/<日期>-<名>/…` 形态的引用（0 处）'
      + ' ⇒ 无对象可查（已扫描，非跳过）')
  }
  return { executed: true, ...stat }
}

// ── 跑一遍（给定账本根，返回 FAIL 清单）──────────────────────────────────────
function runChecks(ledgerRoot) {
  const bad = []
  const notes = []
  const b = (m) => bad.push(m)
  const o = (m) => notes.push(m)
  const a = checkArchiveBytes({ ledgerRoot, bad: b, ok: o })
  const c = crossCheckAgainstWorkspaceHistory({ ledgerRoot, bad: b, ok: o })
  const d = checkDirRefs({ ledgerRoot, bad: b, ok: o })
  return { bad, notes, a, c, d }
}

// ── 自带负向对拍夹具（⛔ 不依赖账本区内容、⛔ 不触碰账本区）────────────────────
function buildFixture() {
  const base = mkdtempSync(join(tmpdir(), 'hob-archive-selftest-'))
  const L = join(base, 'ledger')
  mkdirSync(join(L, 'archive', '2026-01-01-fixture', 'sources'), { recursive: true })
  mkdirSync(join(L, 'archive', '2026-01-02-revfix', 'sources'), { recursive: true })

  // 形态 M：清单表（字节数 + md5 当场算，⛔ 不写死）
  const aBuf = Buffer.from('alpha\n')
  writeFileSync(join(L, 'archive', '2026-01-01-fixture', 'sources', 'a.txt'), aBuf)
  writeFileSync(join(L, 'archive', '2026-01-01-fixture', 'README.md'), [
    '# fixture（形态 M）', '',
    '| # | 归档文件 | 原文件路径 | 字节数 | md5 |',
    '|---|---|---|---|---|',
    `| 1 | \`sources/a.txt\` | \`tmp/a.txt\` | ${aBuf.length} | \`${md5(aBuf)}\` |`,
    '',
  ].join('\n'))
  // 一个**只在 index 里**的成员（清单不列它）⇒ 供半 ② 做**隔离**对拍
  writeFileSync(join(L, 'archive', '2026-01-01-fixture', 'TASK-R1.md'), '# fixture task\n')

  // 形态 S：先提交源文件，再把内容归档、并在 README 里声明该修订
  writeFileSync(join(L, 'b.txt'), 'bravo\n')
  const gitq = (args) => execFileSync('git', args, { cwd: L, encoding: 'utf8' })
  execFileSync('git', ['init', '-q'], { cwd: L })
  execFileSync('git', ['add', 'b.txt'], { cwd: L })
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'b'], { cwd: L })
  const rev = gitq(['rev-parse', 'HEAD']).trim()
  writeFileSync(join(L, 'archive', '2026-01-02-revfix', 'sources', 'b.txt'), 'bravo\n')
  writeFileSync(join(L, 'archive', '2026-01-02-revfix', 'README.md'), [
    '# fixture（形态 S）', '',
    `> 来源：账本仓提交 **\`${rev}\`** 时的改动前整份。`, '',
  ].join('\n'))

  // ⚠ 第 121 轮新增：一个**没有任何正文点名**、但有 `README.md` 的目录
  //   ⇒ 只能靠**盘上派生**覆盖它（正文点名那条路看不见它）。⛔ 它不出现在任何 `.md` 正文里。
  mkdirSync(join(L, 'archive', '2026-01-03-nonameref'), { recursive: true })
  writeFileSync(join(L, 'archive', '2026-01-03-nonameref', 'TASK-R9.md'), '# fixture task (no named ref)\n')
  writeFileSync(join(L, 'archive', '2026-01-03-nonameref', 'README.md'), [
    '# fixture（无正文点名 ⇒ 盘上派生）', '',
    '| # | 件 | 是什么 |',
    '|---|---|---|',
    '| 1 | `TASK-R9.md` | 只在盘上、没人点名 |',
    '',
  ].join('\n'))

  // ⚠ 第 122 轮新增：一个**既无 `README.md`、又无 `sources/`** 的子目录
  //   ⇒ 只能靠**盘上派生（全子目录口径）**覆盖；成员**只来自 index**（⛔ 无清单载体）。
  mkdirSync(join(L, 'archive', '2026-01-04-bareindex'), { recursive: true })
  writeFileSync(join(L, 'archive', '2026-01-04-bareindex', 'TASK-R10.md'), '# fixture task (bare index only)\n')

  // 半 ② 的引用面：正本里指向那个目录
  writeFileSync(join(L, 'PROJECT.md'), [
    '# fixture project', '',
    '> 旧整份见 `archive/2026-01-01-fixture/`。', '',
  ].join('\n'))
  execFileSync('git', ['add', '-A'], { cwd: L })
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'archive'], { cwd: L })

  return {
    base,
    L,
    aPath: join(L, 'archive', '2026-01-01-fixture', 'sources', 'a.txt'),
    aBuf,
    memberPath: join(L, 'archive', '2026-01-01-fixture', 'TASK-R1.md'),
    memberBuf: Buffer.from('# fixture task\n'),
    derivedMemberPath: join(L, 'archive', '2026-01-03-nonameref', 'TASK-R9.md'),
    derivedMemberBuf: Buffer.from('# fixture task (no named ref)\n'),
    bareMemberPath: join(L, 'archive', '2026-01-04-bareindex', 'TASK-R10.md'),
    bareMemberBuf: Buffer.from('# fixture task (bare index only)\n'),
  }
}

function selfTest() {
  const fx = buildFixture()
  /** 取**本半**的第一条断言行（⛔ 不拿另一半的 —— 否则"某一半从没咬过"会被掩盖）。 */
  const lineOf = (r, prefix) => {
    const hit = r.bad.find((l) => l.startsWith(prefix))
    if (hit !== undefined) return hit.split('\n')[0]
    return (r.notes.find((n) => n.startsWith(prefix)) ?? '（无读数）').split('\n')[0]
  }
  const readings = []
  /** ⚠ 每档只看**被咬的那一半**（另一半点名不影响本档期望 —— 但会被单独记入「其它断言行」）。 */
  const expect = (label, r, wantExit, prefix) => {
    const relevant = r.bad.filter((l) => l.startsWith(prefix))
    const other = r.bad.filter((l) => !l.startsWith(prefix))
    const exit = relevant.length > 0 ? 1 : 0
    readings.push({
      label, exit, want: wantExit, line: lineOf(r, prefix),
      // ⚠ 期望 0 的那几档：**整轮**都必须干净（不许另一半偷偷红着）
      pass: exit === wantExit && (wantExit === 1 || other.length === 0),
    })
    return other
  }

  let r = runChecks(fx.L)
  expect('半 ① + ② 破坏前', r, 0, '①')
  const before = { half1: r.a.pairs, half2: r.d.memberPairs }

  // ── 半 ① 破坏：改掉归档件一个字节（清单随即不符）──
  writeFileSync(fx.aPath, Buffer.concat([fx.aBuf, Buffer.from('X')]))
  r = runChecks(fx.L)
  const other1 = expect('半 ① 破坏后（归档件被改 1 字节）', r, 1, '①')
  const half1Broken = lineOf(r, '①')
  // 还原
  writeFileSync(fx.aPath, fx.aBuf)
  r = runChecks(fx.L)
  expect('半 ① 还原后', r, 0, '①')

  // ── 半 ② 破坏：删掉一个**只在 index 里**的成员（清单不列它 ⇒ 半 ① 不受影响）──
  unlinkSync(fx.memberPath)
  r = runChecks(fx.L)
  const other2 = expect('半 ② 破坏后（目录引用缺一份成员）', r, 1, '②')
  const half2Broken = lineOf(r, '②')
  // 还原
  writeFileSync(fx.memberPath, fx.memberBuf)
  r = runChecks(fx.L)
  expect('半 ② 还原后', r, 0, '②')

  // ── 半 ②【新增档 · 第 121 轮】**盘上派生**面：一个**没有任何正文点名**的目录，
  //    破坏其成员 ⇒ 必须 FAIL（而"正文点名"那条路**看不见它**）——
  //    ⚠ 这一档正是第 120 轮那个静默缩水的**回归闸门**。
  unlinkSync(fx.derivedMemberPath)
  r = runChecks(fx.L)
  const other3 = expect('半 ②【派生面】破坏后（无正文点名的目录缺一份成员）', r, 1, '②')
  const half2DerivedBroken = lineOf(r, '②')
  // 还原
  writeFileSync(fx.derivedMemberPath, fx.derivedMemberBuf)
  r = runChecks(fx.L)
  const other3b = expect('半 ②【派生面】还原后', r, 0, '②')

  // ── 半 ②【新增档 · 第 122 轮】**无清单载体**的目录（既无 README 又无 sources/），
  //    成员**只来自 index** ⇒ 破坏它 ⇒ 必须 FAIL；还原 ⇒ PASS。
  //    ⚠ 这一档正是"收录判据自带排除面"那处口子的**回归闸门**。
  unlinkSync(fx.bareMemberPath)
  r = runChecks(fx.L)
  const other4 = expect('半 ②【无清单载体档】破坏后（既无 README 又无 sources/ 的目录缺成员）', r, 1, '②')
  const half2BareBroken = lineOf(r, '②')
  writeFileSync(fx.bareMemberPath, fx.bareMemberBuf)
  r = runChecks(fx.L)
  const other4b = expect('半 ②【无清单载体档】还原后', r, 0, '②')

  // ── 反假绿：把"含 sources/ 的归档目录"整个撤掉 ⇒ 必须走「无对象可查」而不是报 ✓ ──
  rmSync(join(fx.L, 'archive'), { recursive: true, force: true })
  r = runChecks(fx.L)
  const guardOk = r.a.executed === false && r.bad.length === 0
    && r.notes.some((n) => n.includes('无对象可查'))
  readings.push({
    label: '反假绿（撤掉全部归档目录 ⇒ 打「无对象可查」，⛔ 不报 ✓）',
    exit: guardOk ? 0 : 1,
    want: 0,
    line: r.notes.find((n) => n.includes('无对象可查')) ?? '（未打「无对象可查」—— 判据失效）',
    pass: guardOk,
  })

  console.log('归档一致性机检 · 自带负向对拍（--self-test）')
  console.log(`夹具：${fx.L}`)
  console.log(`破坏前读数：半 ① 比较对数 ${before.half1} · 半 ② 成员比对 ${before.half2}`)
  console.log('')
  for (const x of readings) {
    console.log(`  ${x.pass ? '✓' : '✗'} ${x.label} —— EXIT=${x.exit}（期望 ${x.want}）`)
    console.log(`      判定行：${x.line}`)
  }
  console.log('')
  console.log(`  半 ① 破坏时点名的断言行：${half1Broken}`)
  console.log(`  半 ② 破坏时点名的断言行：${half2Broken}`)
  console.log(`  半 ②【派生面】破坏时点名的断言行：${half2DerivedBroken}`)
  console.log(`  半 ②【无清单载体档】破坏时点名的断言行：${half2BareBroken}`)
  for (const [tag, other] of [['半 ① 破坏档', other1], ['半 ② 破坏档', other2], ['半 ② 派生面破坏档', other3], ['半 ② 派生面还原档', other3b], ['半 ② 无清单载体破坏档', other4], ['半 ② 无清单载体还原档', other4b]]) {
    if (other.length > 0) console.log(`  ⚠ ${tag}里**另一半也红了**（对本档是噪音，须查）：${other[0].split('\n')[0]}`)
  }

  rmSync(fx.base, { recursive: true, force: true })
  const allPass = readings.every((x) => x.pass)
  console.log('')
  console.log(allPass
    ? `判定：PASS —— ${readings.length} 档读数**全部符合期望**（两半各"破坏⇒FAIL 且有可读断言行 / 还原⇒PASS"）`
    : '判定：FAIL —— 有档位与期望不符（判据失效或夹具坏了，逐条见上）')
  return allPass ? 0 : 1
}

// ── main ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const selfTestFlag = argv.includes('--self-test')
const ledgerFlagIdx = argv.indexOf('--ledger')
const cliLedger = ledgerFlagIdx >= 0 ? argv[ledgerFlagIdx + 1] : undefined

if (selfTestFlag) {
  process.exit(selfTest())
}

const ledgerRoot = resolveLedgerRoot(cliLedger)
console.log('归档一致性机检 · dsh-hob')
if (ledgerRoot === undefined) {
  console.log(`账本区：**解析不到**（ledgerHome=${ledgerHome() ?? '读不到'} · 工作区名=${workspaceName()}）`)
  console.log('')
  console.log('判定：**未执行** —— 账本区读不到 ⇒ 本检查**不代表通过**（退出码 2，与"通过"分档）')
  process.exit(2)
}
console.log(`账本区：${ledgerRoot}`)
console.log('')

const { bad, notes, a, c, d } = runChecks(ledgerRoot)
for (const n of notes) console.log('  ✓', n)
console.log('')
if (bad.length === 0) {
  console.log(`判定：PASS —— ① 比较对数 ${a.pairs}（形态 S ${a.formS} · 形态 M ${a.formM}`
    + `${a.globGroups > 0 ? ` · 通配组 ${a.globGroups}` : ''}），①c 历史对上 ${c.matched}/${c.checked}；`
    + `② 目录形态引用 ${d.dirRefs} 处（正文点名 ${d.dirRefsNamed} · 盘上派生 ${d.dirRefsDerived}）`
    + ` / 成员比对 ${d.memberPairs} 对，全部齐备。`)
  process.exit(0)
}
console.log('判定：FAIL')
for (const f of bad) console.log('  ✗', f)
process.exit(1)
