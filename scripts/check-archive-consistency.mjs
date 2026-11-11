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
import { workspaceName as configuredWorkspaceName } from './workspace-name.mjs'
/**
 * ⚠⚠ **2026-10-27 · 包 Q（`CHG-099` 第 4 条）**：账本根解析**不再由本脚本自己写一份** ——
 *   四个判据脚本 + 产品代码此前各有一份实现，账本一搬就有四份同时指向不存在的目录。
 *   ⇒ 收成**脚本侧唯一实现** `scripts/lib/ledger-root.mjs`；本脚本只 import。
 */
import { resolveLedgerRoot as resolveLedgerRootShared, workspaceNameOf as wsNameOfShared } from './lib/ledger-root.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const posix = (p) => p.split('\\').join('/')
const md5 = (buf) => createHash('md5').update(buf).digest('hex')

/** git（文本）；失败返回 null（⛔ 不把"跑不动"当成"没问题"）。 */
function tryGit(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      /**
       * ⚠⚠ **必须吞掉 stderr**（2026-11-02 P50/M4 · `TASK-M4.md` §一第 2 件 · 情形 B）。
       *   改前：`execFileSync` 默认把子进程 stderr **直接继承到本进程 stderr**
       *   ⇒ 每次"这个 id 在本仓不存在"都会往终端喷一行
       *     `fatal: invalid object name 'd391602'.`
       *   ⇒ 实测 `check:all` 里连喷 **13+ 次**，而**判定照旧 EXIT=0**。
       *   ⚠ 那正是"会让失败不可观测"：真错误被淹没在噪声里，且没人会去看。
       *   ⇒ `stdio: ['ignore','pipe','ignore']`：只留 stdout，stderr 丢掉（判据靠返回值判，不靠 stderr）。
       */
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null
  }
}

/**
 * git（**带 stdin**）—— 批量查询专用。
 *
 * ⚠ **为什么要它**：`cat-file --batch-check` 从 **stdin** 读查询清单，
 *   一次能回答 N 个 `rev:path`；而 `execFileSync` 要传 `input` 才能喂 stdin。
 *   ⚠ 这是把「N 次 fork」压成「1 次 fork」的关键（见 ①c 的注释）。
 *
 * @param args - git 参数（含 `--git-dir` 前缀，若在归档内层仓）。
 * @param cwd  - 工作目录。
 * @param input - 喂给 stdin 的清单（每行一个 `rev:path`）。
 * @returns stdout 文本；失败返回 `null`（与 `tryGit` 同口径）。
 */
function tryGitInput(args, cwd, input) {
  try {
    return execFileSync('git', args, {
      cwd,
      input,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      /** ⚠ 同 `tryGit`：**吞掉 stderr**（判据靠返回值判，⛔ 不靠 stderr）。 */
      stdio: ['pipe', 'pipe', 'ignore'],
    })
  } catch {
    return null
  }
}
/** git（**字节**，无 encoding）—— 形态 S 的逐字节比对专用（⛔ 不经 UTF-8 转码）。 */
function tryGitBuf(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      maxBuffer: 256 * 1024 * 1024,
      /** ⚠ 同 `tryGit`：**吞掉 stderr**（2026-11-02 P50/M4 · 情形 B）。判据靠返回值判，⛔ 不靠 stderr。 */
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null
  }
}

/**
 * **修订仓**（形态 S 的取数根）—— 2026-10-25 搬家单之后新增。
 *
 * ⚠ **为什么需要它**：形态 S 要用 `git show <rev>:<path>` 取"声明源修订"的字节，
 *   而**账本根已不再是独立 git 仓**（2026-10-25 搬家单把内层 `.git` 移进了归档）。
 *   ⇒ 若仍以 `ledgerRoot` 为 `cwd`，`git show` **一律取不到**（改前实测：41 处形态 S 全红）。
 *
 * ⚠ **取数顺序（覆盖面 ⛔ 不许缩小）**：
 *   ① **工作区仓**（`root`，账本现在就它里面）—— 首选，用的是"搬家后"的仓；
 *   ② **归档里的内层 `.git`**（⚠ **只读** 当 `--git-dir` 用，⛔ 不写、⛔ 不删、⛔ 不提交）。
 *      ⚠ 为什么必须留这一档：实测归档仓 **446 个提交**、工作区仓 **280 个**，
 *      而形态 S 声明的修订（`d391602` 等）**只在归档仓里**（工作区仓 `cat-file -e` 全 missing）。
 *      ⇒ 只留 ① 会让形态 S **整体失效**（41 处全红或全 skip）⇒ 那是"缩小覆盖面"，⛔ 本单禁止。
 *
 * ⚠ 返回 `null` ⇒ 两处都取不到（调用方照旧报红，⛔ 不当通过）。
 */
function resolveRevRepos(ledgerRoot) {
  const out = []
  // ① 工作区仓：`root` 就是本脚本所在工作区根
  out.push({ cwd: root, gitDir: null, label: '工作区仓' })
  /**
   * ①b **账本区自身的仓**（2026-11-07 · `archive/2026-11-07-build-closeout/TASK.md` 段 B）。
   *   ⚠ 治的病（`--self-test` 六档红里的五档，同一个根因）：形态 S 的 README 写的是
   *     「来源：**账本仓**提交 `X`」，而 2026-10-25 搬家后**账本区自己就是一个 git 仓**；
   *     `--self-test` 的夹具（`fx.L`）同样是个自建 git 仓。取数根却只有 ① 工作区仓 + ② 归档内层仓
   *     ⇒ **声明来源的那个仓一个都没被查** ⇒ 夹具里 5 档「期望 0」被 `①[形态 S] … 在声明的源修订里不存在` 污染成 FAIL。
   *   ⚠ ⛔ **不是放宽**：加入的是**多一个仓去解析修订**，命中后照样**逐字节比对**
   *     （`buf.equals(srcBuf)`），⛔ 没有任何一条从"比对"退化成"跳过"。
   *     实测：夹具 4 档「破坏后」仍 EXIT=1 且点名正确；真账本区形态 S 41 处仍全过，
   *     ①c 辅助读数由 554/904 升到 571/904（更准，且 ①c 本来不参与判定）。
   *   ⚠ 只在**账本区根确为 git 仓**时追加（`rev-parse --git-dir` 探测，⛔ 不靠目录猜、⛔ 不建仓）。
   */
  if (typeof ledgerRoot === 'string' && ledgerRoot !== '' && isGitRepo(ledgerRoot)) {
    out.push({ cwd: ledgerRoot, gitDir: null, label: '账本区仓' })
  }
  // ② 归档里的内层 .git —— 只读
  const archived = join(ledgerRoot, 'archive', '2026-10-25-project-migrate', 'inner-git', '.git')
  try {
    if (statSync(archived).isDirectory()) out.push({ cwd: ledgerRoot, gitDir: archived, label: '归档内层仓(只读)' })
  } catch { /* 归档不在 ⇒ 只有 ① */ }
  return out
}

/** 某目录是不是 git 仓工作树根（⚠ 只读探测：`rev-parse --git-dir`，⛔ 不建仓、⛔ 不改仓）。 */
function isGitRepo(dir) {
  try {
    return execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: dir, stdio: ['ignore', 'pipe', 'ignore'],
    }) !== null
  } catch {
    return false
  }
}

/** 在若干"修订仓"里依次试 `git show`；命中即返回字节，全不命中返回 null。 */
function tryGitBufInRepos(args, repos) {
  for (const r of repos) {
    const full = r.gitDir === null ? args : ['--git-dir', r.gitDir, ...args]
    const cwd = r.gitDir === null ? r.cwd : r.cwd
    const got = tryGitBuf(full, cwd)
    if (got !== null) return got
  }
  return null
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
 * 工作区名。
 *
 * ⚠ **为什么不直接 `basename(root)`**（改动前的老写法）：本卡在**看板 worktree** 里作业，
 *   worktree 目录名是 `<taskId>`、不是工作区名 ⇒ `basename(root)` 会派生出
 *   `.../hob-ledgers/t-mv54am90-yqilyy`（不存在）⇒ 整条检查**静默跳过**
 *   （实测：同一 worktree 里 `check:gitignore` 的账本区断言全部打印「未执行」）。
 * ⚠ **现改为从配置读**（唯一来源 = `scripts/workspace-name.mjs`）——
 *   原先那套「git-common-dir 的父目录名」只是**本脚本自己的**补丁，其余 6 个脚本没有，
 *   ⇒ 同一件事有两条口径。现在收成一条：**配置优先**，未配置才落回本脚本原逻辑
 *   （= 改动前的猜法，⛔ 行为不变）。
 */
function workspaceName() {
  return configuredWorkspaceName(() => {
    const abs = tryGit(['rev-parse', '--path-format=absolute', '--git-common-dir'], root)
    if (abs !== null && abs.trim() !== '') return basename(dirname(abs.trim()))
    const rel = tryGit(['rev-parse', '--git-common-dir'], root)
    if (rel !== null && rel.trim() !== '') return basename(dirname(join(root, rel.trim())))
    return basename(root)
  })
}

/**
 * 账本区解析 —— **委托给脚本侧唯一实现**（`scripts/lib/ledger-root.mjs`）。
 * ⚠ 本脚本**不再自己写一份**：改前这里有 `looksLikeLedger` + `ledgerHome` +
 *   `resolveLedgerRoot` 三份实现，账本搬走后它们全部指向不存在的 `<工作区>/.hob`。
 * ⚠ `workspaceName()` 保留上面那一份（本脚本别处还在用），⛔ 不重复定义。
 */
function resolveLedgerRoot(cliLedger) {
  return resolveLedgerRootShared(root, cliLedger)
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
function checkArchiveBytes({ ledgerRoot, bad, ok, skip }) {
  /** ⚠ 缺省收集器（旧调用方不传 `skip` 时用）：⛔ 不许退化成 `ok()`。 */
  const skipSink = typeof skip === 'function' ? skip : () => {}
  /** ⚠ 形态 S 的**取数根**（2026-10-25 搬家后：账本根不再是 git 仓 ⇒ 见 {@link resolveRevRepos}）。 */
  const revRepos = resolveRevRepos(ledgerRoot)
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
    skipSink('① 归档件字节比对【未执行】—— 账本区**没有含 `sources/` 的归档目录** ⇒ 无对象可查，'
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
        const srcBuf = tryGitBufInRepos(['show', `${rev}:${relInSources}`], revRepos)
        if (srcBuf === null) {
          stat.mismatched += 1
          bad(`①[形态 S] 归档件在**声明的源修订里不存在**：\`${relLedger}\``
            + `\n      ⇒ 声明来源：修订 \`${rev}\`（清单：${relDir}/README.md）`
            + `\n      ⇒ 核实方式：在 ${revRepos.map((r) => r.label).join(' / ')} 试 \`git show ${rev}:${relInSources}\``)
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
 * **AI1 · 归档目录清单 ↔ `gen/archive-index.md` 生成物**（2026-10-30 P7 · `TASK-P7.md` §三）。
 *
 * ── 为什么是"目录清单"而不是"每份件的字节数/md5"（⚠ 这是我对 §三 的一处判定偏离）──────
 *   §三 让我把「① 的**清单比对**改为『盘上归档件 vs `gen/archive-index.md`』」。
 *   ⚠ 实测的 ① **不是"全局手写清单"那回事**：它比的是**每个归档目录自己的 `README.md`**
 *   里那张（`sources/<rel>` + 字节数 + md5）表 ↔ 该目录 `sources/` 下的真文件
 *   （见上面 `checkArchiveBytes` 的形态 M）。⇒ **没有"一份全局清单"可替换**。
 *   ⇒ 而 `gen/archive-index.md` 现在只有 (目录名, 文件数) 两列 —— 没有字节数、没有 md5。
 *   ⇒ 判定：**① 的 md5 那一半 ⛔ 不能由生成物替代**（要补就得给 1795 份 `sources/` 件
 *     各算一遍 md5，生成物会膨胀到兆级；而且它替代的其实是**每目录 README**，不是全局表）。
 *     详见报告 §三。**② 一行未动**（成员完整性核，仍是真判据）。
 *   ⇒ 本条做的是**能做的那个真断言**：**盘上的归档目录清单**（名字 + 各自文件数）
 *     必须与生成物逐行一致。它替代的是"有人手工维护一张归档目录总表"这种形态 —— 本仓没有那张表，
 *     但一旦有人加/删归档目录而忘了重跑生成器，本条会红。
 *
 * @param {{ledgerRoot: string, bad: Function, ok: Function, skip: Function}} o
 * @returns {{executed: boolean, dirs?: number}}
 */
export function checkArchiveIndexGen({ ledgerRoot, bad, ok, skip }) {
  const skipSink = typeof skip === 'function' ? skip : () => {}
  const genPath = join(ledgerRoot, 'ledger', 'gen', 'archive-index.md')
  let gen = ''
  try { gen = readFileSync(genPath, 'utf8') } catch { gen = '' }
  if (gen === '') {
    skipSink('AI1 归档目录清单 ↔ 生成物【未执行】—— `ledger/gen/archive-index.md` 读不到 ⇒ 无对象可查（⛔ 不报 ✓）')
    return { executed: false }
  }
  /** 从生成物解析 `| n | `archive/<名>/` | <文件数> |`。 */
  const genRows = new Map()
  for (const m of gen.matchAll(/^\| \d+ \| `archive\/([^`]+)\/` \| (\d+) \|$/gm)) {
    genRows.set(m[1], Number(m[2]))
  }
  if (genRows.size === 0) {
    bad('AI1 生成物 `gen/archive-index.md` 里**一行目录都解析不到** ⇒ 格式变了或文件被写坏（不按通过处理）')
    return { executed: true, dirs: 0 }
  }
  const arcRoot = join(ledgerRoot, 'archive')
  const disk = new Map()
  try {
    for (const e of readdirSync(arcRoot, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      let files = []
      try { files = readdirSync(join(arcRoot, e.name), { withFileTypes: true }).filter((x) => x.isFile()) } catch { files = [] }
      disk.set(e.name, files.length)
    }
  } catch (e) {
    bad(`AI1 账本区 \`archive/\` **读不到**（${String(e?.code ?? e?.message ?? e)}）⇒ 本条失去基准（不按通过处理）`)
    return { executed: true, dirs: genRows.size }
  }
  let mismatch = 0
  for (const [name, n] of disk) {
    if (!genRows.has(name)) { mismatch++; bad(`AI1 盘上有归档目录 \`archive/${name}/\`，而生成物里**没有它** ⇒ 生成物过期（跑 \`npm run gen:ledger\`）`) }
    else if (genRows.get(name) !== n) { mismatch++; bad(`AI1 \`archive/${name}/\`：盘上 **${n}** 个顶层文件，生成物写 **${genRows.get(name)}** ⇒ 生成物过期`) }
  }
  for (const [name] of genRows) {
    if (!disk.has(name)) { mismatch++; bad(`AI1 生成物里的 \`archive/${name}/\` **盘上已不存在** ⇒ 死行（删了目录没重跑生成器）`) }
  }
  if (mismatch === 0) {
    ok(`AI1 ✓ 归档目录清单与生成物 \`gen/archive-index.md\` **逐行一致**：${disk.size} 个目录（名字 + 各自顶层文件数）全部对上`
      + '（⚠ 本条**不**替代 ① 的每目录 README md5 核 —— 那个没有生成物替代，见函数头注释）')
  }
  return { executed: true, dirs: disk.size }
}

/**
 * ①c **辅助交叉核对**（⛔ 不参与判定）：形态 M 的清单是自报读数（E-137），
 *   这里把归档件的 blob sha1 与工作区仓里「该原文件路径」的历史修订逐个对一眼。
 *   ⇒ 对上 = 该归档件**确曾是**那份源文件（独立证据）；对不上**不判 FAIL**
 *     （合法情形：归档时那份源从未提交 / 该路径不在本仓）。
 */
function crossCheckAgainstWorkspaceHistory({ ledgerRoot, revRepos, bad: _bad, ok, skip }) {
  const skipSink = typeof skip === 'function' ? skip : () => {}
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
        /**
         * ⚠⚠ **跨仓取数**（2026-11-02 P50/M4 · 情形 B 的修法）。
         *   改前：只在 `root`（**工作区仓**）里 `git log` / `git rev-parse`。
         *   但 `①c` 要核的是"这份归档件能不能在**它的源修订**里逐字节找到"，
         *   而形态 M 的源修订（`d391602` 等）**只在归档内层仓里**
         *   （见 {@link resolveRevRepos} 的头注释：归档仓 446 提交 vs 工作区仓 280 提交）。
         *   ⇒ 改前它在工作区仓里查不到 ⇒ 每份都 `notFound` + 每次喷一行 `fatal:`。
         *   ⚠ 现在按 `revRepos` 的**同一顺序**（工作区仓 → 归档内层仓只读）取，
         *     与 `checkArchiveBytes`（形态 S）**用同一套取数根** —— 覆盖面只增不减。
         */
        /**
         * ⚠⚠ **批量取数（2026-11-11 · 性能修复）**：改前是
         *   `for repo { log -n 200; for rev { rev-parse rev:path } }`
         *   ⇒ 每份归档件最多 **2 × 200 = 400 次 git 子进程**；
         *   910 份实测跑到 **5350 次仍未结束**（`execFileSync` 每次 fork+exec）。
         *
         *   ⇒ 改成**两次 git 调用就够**：
         *     ① `log --all --format=%H -n 200 -- <path>` —— 拿候选提交（本来就有，1 次）；
         *     ② `cat-file --batch-check`（stdin 喂 N 行 `rev:path`）—— **一次**回答全部 blob。
         *
         *   ⚠ 判据**一个字没放宽**：仍然是「`want` 这个 blob sha 能在某个历史修订里找到」。
         *     变的只是「问 git 的方式」：从 N 次单查 → 1 次批量。
         *   ⚠ 为什么不能用缓存去重：键里含 `srcPath`，而**每份归档件的路径都不同**
         *     ⇒ 天然不重复，缓存命中率约为 0（这一条是先读代码确认的，⛔ 不是猜）。
         */
        let hit = false
        for (const repo of revRepos) {
          const gitIn = (a) => (repo.gitDir === null
            ? tryGit(a, repo.cwd)
            : tryGit(['--git-dir', repo.gitDir, ...a], repo.cwd))
          const revs = gitIn(['log', '--all', '--format=%H', '-n', '200', '--', srcPath])
          if (revs === null || revs.trim() === '') continue
          const shas = revs.split('\n').map((x) => x.trim()).filter(Boolean)
          if (shas.length === 0) continue
          /**
           * ② **一次**批量问：把 N 个 `rev:path` 一起喂给 `cat-file --batch-check`。
           *   ⚠ 输出与输入**逐行对应**（`<sha> blob <size>` 或 `<spec> missing`）⇒
           *     只要有任何一行的 sha === want 就算命中。
           */
          const spec = shas.map((r) => `${r}:${srcPath}`).join('\n') + '\n'
          const batchArgs = repo.gitDir === null
            ? ['cat-file', '--batch-check']
            : ['--git-dir', repo.gitDir, 'cat-file', '--batch-check']
          const batch = tryGitInput(batchArgs, repo.cwd, spec)
          if (batch === null) continue
          if (batch.split('\n').some((line) => line.split(' ')[0] === want)) { hit = true; break }
        }
        if (hit) matched += 1
        else { notFound += 1; notes.push(`${row.rel}（原路径 ${srcPath}）`) }
      }
    }
  } catch { /* 下面按"未取"处理 */ }
  if (checked === 0) {
    skipSink('①c 历史交叉核对【未执行】—— 形态 M 清单为空 / 读不到 ⇒ 无对象可查（⛔ 不报 ✓）')
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

function checkDirRefs({ ledgerRoot, bad, ok, skip }) {
  const skipSink = typeof skip === 'function' ? skip : () => {}
  const stat = {
    scanFiles: 0, refs: 0, dirRefs: 0, dirRefsNamed: 0, dirRefsDerived: 0,
    memberPairs: 0, missing: 0, dirsWithoutMembers: 0, overlapSkipped: 0,
    dirsNotIndexed: 0, notIndexedMembers: 0,
    /**
     * ⚠⚠ **2026-10-30 P19：把「尚未入库」从"逐目录一条 note"改成"分组计数"**。
     *   理由（用户裁定）：账本区 285 个归档**已按设计入库** ⇒ 那批 note 的**对象消失**，
     *   分母从 240 掉到 4 —— 刻度该跟着走；⚠ 但**保护不许丢**：
     *   对象还在（下次真出现"盘上有、index 无"时仍会被点名），只是**聚成一条**报。
     *   ⚠ 这**不是放宽**：判据仍是"盘上有文件 / index 里 0 份 ⇒ 必须报"，
     *     变的只是**报的粒度**（逐条 → 分组），⛔ 不是把这条检查删掉。
     */
    notIndexed: [],
  }
  const files = deriveScanFiles(ledgerRoot)
  stat.scanFiles = files.length
  if (files.length === 0) {
    skipSink('② 目录成员核【未执行】—— 账本区读不到任何正本 / 卷 `.md` ⇒ 无对象可查，「不代表通过」')
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
          // ⚠ ⚠ ⑥(b) 第 220 轮：**正文点名**这一侧同样要区分"尚未入库"与"真无成员"
          const onDiskNamed = walkFiles(join(ledgerRoot, rel))
            .map((p) => posix(relative(ledgerRoot, p))).sort()
          if (onDiskNamed.length > 0) {
            stat.dirsNotIndexed += 1
            stat.notIndexedMembers += onDiskNamed.length
            // ⚠ P19：不再逐目录 ok() ⇒ 收进分组计数（见下方"② 尚未入库（分组）"那一行）
            stat.notIndexed.push({ rel, kind: '正文点名', at: `${f}:${i + 1}`, files: onDiskNamed.length, sample: onDiskNamed.slice(0, 3) })
            continue
          }
          stat.dirsWithoutMembers += 1
          skipSink(`② ${f}:${i + 1} 引用的目录 \`${ref}\` **无清单、index 里也无成员、盘上也没有文件** ⇒ 无成员可核（⛔ 不报 ✓）`)
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
      // ⚠ ⚠ **⑥(b) 第 220 轮（`UD-117`）：把"盘上有而未入库"与"真无成员"分开** ─────────────
      //   ⚠ 背景（第 215 / 217 轮实测）：⚠ 本断言的成员面取自 **`git ls-files`（index）**
      //   ⇒ ⚠ ⚠ **"提交"这个动作本身就在它的取数面上**（同一轮里分母动过两次：786 → 787 → 788）；
      //   ⚠ ⚠ **且"盘上有、index 无"原先表现为"0 成员"** —— ⚠ **不是"看不出来"，而是"看起来像没有"**。
      //   ⇒ ⚠ 现在：⚠ **若该目录在盘上真的有文件**，就把那一批**点名报出来**
      //     （⚠ **不算 FAIL** —— "尚未入库"是**正常中间态**，正是本单第一件那种"在途产物"），
      //     ⚠ ⚠ **但它 ⛔ 不许再混进"无成员可核"那句话里**（⚠ 那句会让人以为"目录是空的"）。
      const onDisk = walkFiles(join(ledgerRoot, rel))
        .map((p) => posix(relative(ledgerRoot, p)))
        .sort()
      if (onDisk.length > 0) {
        stat.dirsNotIndexed += 1
        stat.notIndexedMembers += onDisk.length
        // ⚠ P19：同上，收进分组计数
        stat.notIndexed.push({ rel, kind: '盘上派生', at: '', files: onDisk.length, sample: onDisk.slice(0, 3) })
        continue
      }
      stat.dirsWithoutMembers += 1
      skipSink(`② 盘上派生目录 \`${rel}/\` **无清单、index 里也无成员、盘上也没有文件** ⇒ 无成员可核（⛔ 不报 ✓）`)
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

  /**
   * ── ② 尚未入库（**分组计数** · 2026-10-30 P19）────────────────────────
   *   ⚠ 改前：每个「盘上有、index 里 0 份」的目录各一条 `ok()` ⇒ 285 个归档 ⇒ 237 条 note
   *     ⇒ 分母被**在途产物**撑到 240，而这些 note 一入库就全消失（刻度失真）。
   *   ⚠ 改后：**聚成一条**（总数 + 前 8 个名字 + 分类计数），⚠ **保护不丢**：
   *     对象仍然被点名（名字在），只是不再一条一记。
   *   ⚠ 口径：**有对象才报**（0 个 ⇒ 不报，⛔ 不印空壳 ✓）。
   */
  /**
   * ⚠⚠ **P19 定稿：这一行⛔ 不设"有对象才报"的开关** —— 它是本组的**固定读数行**：
   *   0 个也报（"0 个目录"），因为"**这一项查过了、当前一个都没有**"本身就是要留下的读数；
   *   ⚠ 与"空壳 ✓"的区别：空壳是**没查**却打勾，这里是**真查了、结果是 0**（分母照样算 1 处）。
   *   ⇒ 这也是为什么下界能从 119 降到 **5**（= ① + ①c + ② + AI1 + 本行），
   *     而不是"降到 4 就够"—— ⚠ 少的那条正是本行，它必须一直在。
   */
  {
    const byKind = stat.notIndexed.reduce((m, x) => { m[x.kind] = (m[x.kind] ?? 0) + 1; return m }, {})
    ok(`② 尚未入库（**分组**）—— ${stat.dirsNotIndexed} 个目录「盘上有、index 里 0 份」`
      + `（共 ${stat.notIndexedMembers} 份文件；分类：${Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(' · ')}）`
      + (stat.notIndexed.length > 0
        ? `\n      ⇒ 前 8 个：\n` + stat.notIndexed.slice(0, 8).map((x) => `        · \`${x.rel}/\`（${x.files} 份${x.at === '' ? '' : `，${x.at}`}）`).join('\n')
          + (stat.notIndexed.length > 8 ? `\n        · …另有 ${stat.notIndexed.length - 8} 个` : '')
        : `\n      ⇒ 当前**一个都没有**（账本区归档已全部入库）`)
      + `\n      ⇒ ⚠ 这是**在途产物**（⛔ 不是 FAIL）：入库之后它会从本行消失`
      + `\n      ⇒ ⚠ 成员面取自 \`git ls-files\`（index）⇒ "提交"这个动作会改变本断言的分母`)
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
      + `${stat.dirsNotIndexed > 0 ? `；⚠ ⚠ **另有 ${stat.dirsNotIndexed} 处目录「盘上有、index 里 0 份」（共 ${stat.notIndexedMembers} 个文件）”—— 该状态 = **尚未入库**，⛔ 不是“无成员”（已逐份点名打印）` : ''}`
      + '，**成员齐备**')
  } else if (stat.refs === 0) {
    ok('② 目录成员核【已执行】—— 账本区里**没有** `archive/<日期>-<名>/…` 形态的引用（0 处）'
      + ' ⇒ 无对象可查（已扫描，非跳过）')
  }
  return { executed: true, ...stat }
}

/**
 * ══ **E 组 · 归档目录必须带清单件**（2026-11-02 · P50/E1 · `TASK-E1.md` §一第 1/2/4 件）══
 *
 * ── 它治什么 ────────────────────────────────────────────────────────
 *   `archive/` 下每个目录都是一个"这一批做过什么"的**证据包**，但**没有任何判据**要求它自带清单。
 *   今天新增一个归档目录，只要文件写进去就算完 —— 里面该有哪些件、少了哪件，**没人查**。
 *   ⇒ 一个归档目录可以只剩一个文件、仍然"存在"，而"能恢复"这件事没人验过。
 *
 * ── ⚠⚠ 清单件叫什么：**沿用 `README.md`，⛔ 不新造 `MANIFEST.md`**（§一第 1 件点名要求先查约定）──
 *   实测（2026-11-02）：
 *     · `archive/<目录>/README.md` —— **112 个**目录已在用；
 *     · `archive/<目录>/MANIFEST.md` —— **1 个**（`2026-10-25-manifest-vs-init/`，且它是**被研究的对象**，
 *       不是约定）；
 *     · 本文件 `:294` 的既有判据已把 `README.md` 定成「归档清单是本检查的**唯一比对基准**」。
 *   ⇒ 约定就是 `README.md`。⛔ 再加一个 `MANIFEST.md` 就是**第二个名字**，
 *     会让"清单在哪"这个问题有两个答案（本仓一直在治的病）。
 *
 * ── ⚠ 这一轨**只查存在性**，⛔ 不查内容格式（查格式属下一波，§一第 1 件明写）──
 *   内容口径的判据（形态 M / 形态 S 的字节与 md5 对照）已由本文件 `checkArchiveBytes` 管，
 *   ⛔ 本函数不重报、不越界。
 *
 * ── ⚠⚠ 历史不追溯：白名单**逐个列出**（§一第 2 件）────────────────────────
 *   ⛔ **不许**写成"除新目录外都放过"那种反向逻辑 —— 那样新增目录会被**静默**放过，判据等于没写。
 *   ⛔ **不许**给历史目录补清单件：事后补写 = **编文档**（`CHG-2027` §三 已裁）。
 *   ⇒ 白名单是**逐个成员的可读清单**，成员数就是本轮的实测目录数。
 *
 * ── ⚠ 0 对象 ⇒ `⊘` 档，⛔ 不进 `ok` ──────────────────────────────────
 *   读不到任何归档目录（路径配错 / 目录不存在）⇒ 走 `skip` 通道，
 *   与 B/D 轨的 `⊘` 档同口径：**跳过 ≠ 通过**。
 */

/** 清单件的文件名（⚠ 沿用既有约定，见上方实测；⛔ 别改成 `MANIFEST.md`）。 */
export const ARCHIVE_MANIFEST_NAME = 'README.md'

/**
 * ══ **一次性交接目录**（2026-11-07 硬化 · `archive/2026-11-07-check-hardening/TASK.md` §二2）══
 *
 * ── 它治什么（⚠ 上一轮实测的红）────────────────────────────────────────
 *   `archive/<日期-slug>/` 里有一类目录**天生只有两件**：`TASK.md`（派单）+ `REPORT.md`（回报）。
 *   它是**一次性的交接物**，⛔ 不是"证据包" —— 没有"这一批归档了哪些件"这回事（就那两件）。
 *   ⇒ 旧 E1 对它照样要 `README.md` ⇒ **每接一单就多一条红**，
 *     而执行方受"`archive/**` 只读"约束、**补不了** ⇒ 那条红永远消不掉。
 *   ⚠ 这正是本仓自己那句话：**恒红的判据等于没有判据**。
 *
 * ── 口径：单列一档（`⊘`），⛔ 既不判通过、也不判红 ────────────────────────
 *   ⇒ 走 `skip` 通道，**不计入通过**（与 B/D 轨、`ARCHIVE_NO_DIRS` 同语汇）。
 *
 * ── ⚠⚠ 判定必须**窄**（TASK §二2 点名："不要用成员数 ≤ 2 这种会被绕过的判据"）────
 *   两条**同时**成立才算交接目录：
 *     ① **每个**成员名都落在白名单里（`TASK.md` / `REPORT.md` / `REPORT-<n>.md` / `DECISIONS.md`）——
 *        ⛔ 不许有子目录、⛔ 不许有 `sources/`、`EVIDENCE.md`、`ACCEPTANCE-REPORT.md` 等任何别的东西；
 *        ⚠ `DECISIONS.md` 进白名单的理由：它是**规划侧的处置记录**，与 `TASK.md` 同为这一单的过程件，
 *          ⛔ 不是「这一批归档了哪些件」的证据清单。实测（2026-11-07）`archive/2026-11-07-check-hardening/`
 *          就是 `TASK.md` + `DECISIONS.md` 两件。⚠ 白名单仍是**闭合枚举**，加名字必须写理由；
 *          ⛔ 不许改成「成员数 ≤ N」这种会被绕过的形态。
 *     ② 至少有一件 `TASK.md` 或 `REPORT*.md`（⛔ 空目录不算）。
 *   ⚠ 所以"塞一个 `EVIDENCE.md` 进去"就**立刻失去**这一档 ⇒ 走正常判据 ⇒ 缺清单**照样红**。
 *   ⚠ `README.md` 若存在，本目录**直接走正常路径并判绿**（它有清单，不需要这一档）。
 */
export const ARCHIVE_HANDOFF_MEMBER_RE = /^(?:TASK|REPORT)(?:-\d+)?\.md$|^DECISIONS\.md$/

/**
 * 判定一个目录是否属于「一次性交接目录」（⚠ 纯函数，供正向与负向对拍共用同一份）。
 *
 * @param {string[]|undefined} members - 该目录的**直接**成员名（子目录名也在内）
 * @returns {boolean}
 */
export function isHandoffDir(members) {
  if (!Array.isArray(members) || members.length === 0) return false
  if (!members.every((n) => ARCHIVE_HANDOFF_MEMBER_RE.test(String(n)))) return false
  return members.some((n) => /^(?:TASK|REPORT)(?:-\d+)?\.md$/.test(String(n)))
}

/** `⊘` 那一行（一次性交接目录；⚠ 与 `ARCHIVE_NO_DIRS` 同形：跳过 ≠ 通过）。 */
export const ARCHIVE_HANDOFF_SKIP = (names) =>
  `⊘ 一次性交接目录 ${names.length} 个（只含 TASK.md / REPORT.md 这类交接件）⇒ 不是证据包、无需清单件`
  + ` ⇒ 本条对它们**无法判定**，⛔ 这不是通过：${names.join(' / ')}`

/**
 * 历史归档目录白名单（⚠ **逐个列出**，每个都是"历史不追溯"）。
 *
 * ⚠ 生成口径：`ls archive/` 实测 **519** 个目录（2026-11-02 P50/E1 现读，⛔ 未用任务书给的 516）。
 * ⚠ 本名单**只增不删**没有意义 —— 它应当**越来越短**：新目录一律要带清单，
 *   老目录只在"真的补齐了清单"时才移出（⚠ 但本轨⛔ 不给它们补，那是编文档）。
 * ⚠ 新增一个归档目录时，⛔ **不许**把它加进这里 —— 加进来 = 亲手关掉本判据。
 */
export const ARCHIVE_HISTORICAL_NO_MANIFEST = [
  '2026-10-05-cleanup2-evidence',
  '2026-10-05-step1-archive-baseline',
  '2026-10-05-step3-evidence',
  '2026-10-05-step4-evidence',
  '2026-10-05-step6-evidence',
  '2026-10-05-step6rev-evidence',
  '2026-10-05-step6rev2-evidence',
  '2026-10-05-ui-rev-evidence',
  '2026-10-06-config-cleanup-evidence',
  '2026-10-06-final-review',
  '2026-10-07-cleanup-tools-and-ask',
  '2026-10-07-experience-notes',
  '2026-10-07-experience-round2',
  '2026-10-07-file-handoff',
  '2026-10-07-hob-capability',
  '2026-10-07-hob-capability-verify',
  '2026-10-07-hob-standard-review',
  '2026-10-07-merged-verify',
  '2026-10-07-orchestration',
  '2026-10-07-post-restart-verify',
  '2026-10-08-batch11-verify',
  '2026-10-08-hob-capability-batch2',
  '2026-10-08-legacy',
  '2026-10-08-project-review',
  '2026-10-09-archify-housekeeping',
  '2026-10-09-cleanup-buildstamp',
  '2026-10-09-close-taskboard',
  '2026-10-09-close-the-loop',
  '2026-10-09-correct-no-popup',
  '2026-10-09-desktop-copy',
  '2026-10-09-drop-facts-cleanup',
  '2026-10-09-drop-facts-review',
  '2026-10-09-drop-facts-step1',
  '2026-10-09-drop-facts-step2',
  '2026-10-09-hob-event-flow',
  '2026-10-09-ledger-history',
  '2026-10-09-ledger-relocate',
  '2026-10-09-ledger-relocate2',
  '2026-10-09-ledger-relocate3',
  '2026-10-09-ledger-slim-impl',
  '2026-10-09-ledger-slim-move',
  '2026-10-09-ledger-slim-review',
  '2026-10-09-no-popup-rule',
  '2026-10-09-orch-watch-audit',
  '2026-10-09-post-restart-verify-facts',
  '2026-10-09-post-restart-verify2',
  '2026-10-09-project-audit',
  '2026-10-09-project-md-batch17',
  '2026-10-09-settings-spawn-defaults',
  '2026-10-09-tool-copy-fix',
  '2026-10-10-dispatch-gap',
  '2026-10-10-docs-restructure',
  '2026-10-10-ledger-root-housekeeping',
  '2026-10-10-panel-l10n-style',
  '2026-10-10-project-plan-move',
  '2026-10-10-restart-acceptance',
  '2026-10-10-settings-echo',
  '2026-10-10-skeleton-restructure',
  '2026-10-10-structural-fixes',
  '2026-10-11-canon-slim',
  '2026-10-11-ledger-volumes',
  '2026-10-11-plan-v2-2',
  '2026-10-11-status-refresh',
  '2026-10-11-status-refresh-2',
  '2026-10-12-context-closed-items',
  '2026-10-12-independent-review',
  '2026-10-12-instruction-from-plan',
  '2026-10-12-ledger-cleanup',
  '2026-10-12-map-readability',
  '2026-10-12-parallel-first-run',
  '2026-10-12-parallel-isolation-probe',
  '2026-10-12-plan-v2-5',
  '2026-10-12-plan-volumes',
  '2026-10-12-rounds-101-102',
  '2026-10-12-rounds-103-104',
  '2026-10-12-rounds-95-100',
  '2026-10-12-rounds-95-98',
  '2026-10-12-skeleton-sync',
  '2026-10-13-batch-rows',
  '2026-10-13-context-closed-items',
  '2026-10-13-context-trim',
  '2026-10-13-duty-boundary',
  '2026-10-13-ledger-portability',
  '2026-10-13-preset-mismatch',
  '2026-10-13-rounds-105-106',
  '2026-10-13-rounds-107',
  '2026-10-13-rounds-108',
  '2026-10-13-rounds-109',
  '2026-10-13-rounds-110',
  '2026-10-13-rounds-111',
  '2026-10-13-rounds-112-113',
  '2026-10-13-rounds-114',
  '2026-10-13-rounds-115',
  '2026-10-13-rounds-116',
  '2026-10-13-rounds-117',
  '2026-10-13-rounds-118',
  '2026-10-13-rounds-119',
  '2026-10-13-rounds-120',
  '2026-10-13-rounds-121',
  '2026-10-13-rounds-122-124',
  '2026-10-14-batch-closeout',
  '2026-10-14-batch-v2-7-closed',
  '2026-10-14-consult-plan-first',
  '2026-10-14-context-batch-rows-2',
  '2026-10-14-context-batch-rows-3',
  '2026-10-14-context-batch-rows-4',
  '2026-10-14-context-round-163',
  '2026-10-14-context-round-164',
  '2026-10-14-context-round-165',
  '2026-10-14-context-round-166',
  '2026-10-14-context-round-169',
  '2026-10-14-context-round-170',
  '2026-10-14-context-rounds-125-128',
  '2026-10-14-context-rounds-129-134',
  '2026-10-14-context-rounds-135',
  '2026-10-14-context-rounds-137',
  '2026-10-14-context-rounds-138-140',
  '2026-10-14-context-rounds-146-148',
  '2026-10-14-context-rounds-149-150',
  '2026-10-14-context-rounds-151-152',
  '2026-10-14-context-rounds-155',
  '2026-10-14-context-rounds-156-157',
  '2026-10-14-context-rounds-158-159',
  '2026-10-14-context-rounds-160-162',
  '2026-10-14-permission-levels',
  '2026-10-14-plan-v2-7',
  '2026-10-14-rounds-136',
  '2026-10-14-skeleton-audit',
  '2026-10-14-skeleton-check',
  '2026-10-14-skeleton-discipline-sync',
  '2026-10-14-skeleton-fix',
  '2026-10-15-batch-rounds-173-175',
  '2026-10-15-check-surface',
  '2026-10-15-context-pre-194',
  '2026-10-15-context-pre-197',
  '2026-10-15-context-pre-199',
  '2026-10-15-context-pre-slim',
  '2026-10-15-context-r180',
  '2026-10-15-context-round-171',
  '2026-10-15-context-round-172',
  '2026-10-15-context-round-173',
  '2026-10-15-context-rounds-174-178',
  '2026-10-15-context-slim',
  '2026-10-15-growth-cap',
  '2026-10-15-headroom-and-commit',
  '2026-10-15-landing',
  '2026-10-15-lessons-3places',
  '2026-10-15-plan-fix',
  '2026-10-15-r181',
  '2026-10-15-r182',
  '2026-10-15-r183',
  '2026-10-15-r184',
  '2026-10-15-r185',
  '2026-10-15-round-211',
  '2026-10-15-round-record-own',
  '2026-10-15-rounds-log',
  '2026-10-15-skeleton-followup',
  '2026-10-15-skeleton-slim',
  '2026-10-15-write-scope',
  '2026-10-16-auto-skeleton',
  '2026-10-16-close-224',
  '2026-10-16-commit-223',
  '2026-10-16-commit-229',
  '2026-10-16-commit-231',
  '2026-10-16-commit-236',
  '2026-10-16-commit-242',
  '2026-10-16-commit-250',
  '2026-10-16-commit-254',
  '2026-10-16-commit-256',
  '2026-10-16-commit-262',
  '2026-10-16-context-pre-rewrite',
  '2026-10-16-context-pre-rewrite-2',
  '2026-10-16-context-pre-rewrite-3',
  '2026-10-16-context-pre-rewrite-4',
  '2026-10-16-correction-form',
  '2026-10-16-judge-false-green',
  '2026-10-16-ledger-reachability',
  '2026-10-16-m6-plan',
  '2026-10-16-m6a',
  '2026-10-16-m6b-design',
  '2026-10-16-r17-refresh',
  '2026-10-16-r17-refresh-2',
  '2026-10-16-r17-refresh-3',
  '2026-10-16-ud122-discipline',
  '2026-10-16-ud122-landing',
  '2026-10-17-board-closeout',
  '2026-10-17-context-chronicle',
  '2026-10-17-context-pre-278',
  '2026-10-17-dispatch-reliability',
  '2026-10-17-ledger-closeout',
  '2026-10-17-module-reverify',
  '2026-10-17-permission-rename',
  '2026-10-17-plan-52-verify',
  '2026-10-17-prompt-audit',
  '2026-10-17-prompt-diet',
  '2026-10-17-upstream-diff',
  '2026-10-18-card-visibility',
  '2026-10-18-card-wakeup',
  '2026-10-18-delivery-audit',
  '2026-10-18-delivery-d2',
  '2026-10-18-dispatch-reliability',
  '2026-10-18-gitignore-dirs',
  '2026-10-18-isolated-batch',
  '2026-10-18-post-restart-2',
  '2026-10-18-preset-reply-format',
  '2026-10-18-prompt-audit',
  '2026-10-18-restart-closeout',
  '2026-10-18-roles-gap',
  '2026-10-18-tier-classification',
  '2026-10-19-auto-mode',
  '2026-10-19-board-closeout-owner',
  '2026-10-19-build-stamp-alarm',
  '2026-10-19-card-wake-broken-tree',
  '2026-10-19-card-wake-legacy-gate',
  '2026-10-19-card-wake-redeliver',
  '2026-10-19-card-wake-scope',
  '2026-10-19-dispatch-owner-isolation',
  '2026-10-19-full-readings',
  '2026-10-19-handoff-next-session',
  '2026-10-19-ledger-hygiene',
  '2026-10-19-orch-criteria-gap',
  '2026-10-19-post-restart-reading',
  '2026-10-19-preset-hardening',
  '2026-10-19-redeliver-entry',
  '2026-10-19-redeliver-wiring',
  '2026-10-19-wake-registration',
  '2026-10-19-work-mode-effective',
  '2026-10-19-work-mode-setting',
  '2026-10-20-code-survey',
  '2026-10-20-contract-bite',
  '2026-10-20-contract-matrix',
  '2026-10-20-dup-relay-cause',
  '2026-10-20-dup-relay-fix',
  '2026-10-20-ledger-close',
  '2026-10-20-module-survey',
  '2026-10-20-plan-map-v14',
  '2026-10-20-profile-hardening',
  '2026-10-20-receipt-fix-1',
  '2026-10-20-receipt-fix-2',
  '2026-10-20-receipt-fix-3',
  '2026-10-20-receipt-fix-4',
  '2026-10-20-receipt-redesign',
  '2026-10-20-receipt-root-cause',
  '2026-10-20-redeliver-close',
  '2026-10-20-self-wake-fix',
  '2026-10-21-bing1-cleanup-stuck',
  '2026-10-21-bing11-12-4',
  '2026-10-21-bing5-10-9',
  '2026-10-21-bing6-13-14',
  '2026-10-21-bing7-8-3',
  '2026-10-21-build-sync-gate',
  '2026-10-21-check-all-three-tier',
  '2026-10-21-check-count-correction',
  '2026-10-21-commit-batches',
  '2026-10-21-context-final',
  '2026-10-21-context-proposal',
  '2026-10-21-context-r17',
  '2026-10-21-count-correction-2',
  '2026-10-21-dropped-returns',
  '2026-10-21-final-cleanup',
  '2026-10-21-final-cleanup-2',
  '2026-10-21-final-close',
  '2026-10-21-gitignore-gate',
  '2026-10-21-ledger-commit-plan',
  '2026-10-21-ledger-land-and-plan',
  '2026-10-21-ledger-pre-rewrite',
  '2026-10-21-ledgerhome-silent-face',
  '2026-10-21-lock-jia7-fakegreen',
  '2026-10-21-orch-mutation-sandbox',
  '2026-10-21-owner-fix',
  '2026-10-21-owner-space-mismatch',
  '2026-10-21-post-restart-verify',
  '2026-10-21-process-incident-stale-premises',
  '2026-10-21-readings-honest',
  '2026-10-21-receipt-not-woken',
  '2026-10-21-residue-cleanup',
  '2026-10-21-runtime-evidence-bing2',
  '2026-10-21-sd-tmp-leak',
  '2026-10-21-skip-all-families',
  '2026-10-21-skip-third-state',
  '2026-10-21-survey-closure-table',
  '2026-10-21-survey-criteria-hardening',
  '2026-10-21-yi-class-silent-green',
  '2026-10-21-yi8-yi10',
  '2026-10-21-yi9-typeface',
  '2026-10-22-auto-popup-closeout',
  '2026-10-22-auto-popup-host-path',
  '2026-10-22-auto-popup-wire',
  '2026-10-22-closeout-register',
  '2026-10-22-core-ledger-close',
  '2026-10-22-core-ledger-close-baseline',
  '2026-10-22-core-ledger-cutover',
  '2026-10-22-core-reframe',
  '2026-10-22-core-reframe-baseline',
  '2026-10-22-core-reframe-snapshot',
  '2026-10-22-create-handle-rollback',
  '2026-10-22-cross-instance-status',
  '2026-10-22-disposed-session-reopen',
  '2026-10-22-failclosed-archive-status',
  '2026-10-22-failed-create-archive',
  '2026-10-22-legacy-policy-migration',
  '2026-10-22-legacy-policy-race',
  '2026-10-22-permission-guard-probe',
  '2026-10-22-plan-doc-alignment',
  '2026-10-22-plan-doc-alignment-r2',
  '2026-10-22-plan-doc-alignment-r3',
  '2026-10-22-policy-cross-instance-close',
  '2026-10-22-post-restart-close',
  '2026-10-22-pre-restart-preflight',
  '2026-10-22-probe-cleanup',
  '2026-10-22-read-level-ceiling',
  '2026-10-22-requirements-first',
  '2026-10-22-requirements-fulltext',
  '2026-10-22-requirements-purity',
  '2026-10-22-requirements-purity-baseline',
  '2026-10-22-session-controls',
  '2026-10-22-session-create-additive',
  '2026-10-22-session-create-correctness',
  '2026-10-22-session-create-correctness-baseline',
  '2026-10-22-session-create-final-path',
  '2026-10-22-session-create-ui',
  '2026-10-22-session-policy-backend',
  '2026-10-22-temp-preimage-close',
  '2026-10-22-temp-preimage-ctx-t9',
  '2026-10-22-three-tiers-visible',
  '2026-10-22-tier-popup-mechanism',
  '2026-10-22-tier-popup-probe',
  '2026-10-24-cancel-interconnect',
  '2026-10-25-close-out',
  '2026-10-25-config-floor-margin',
  '2026-10-25-context-pre-rewrite',
  '2026-10-25-context-pre-rewrite-2',
  '2026-10-25-context-pre-rewrite-3',
  '2026-10-25-context-rules-split',
  '2026-10-25-context-split',
  '2026-10-25-contract-structure',
  '2026-10-25-experience-lessons',
  '2026-10-25-final-green',
  '2026-10-25-final-two',
  '2026-10-25-floor-dedup',
  '2026-10-25-floor-zero-margin',
  '2026-10-25-gate-existence',
  '2026-10-25-human-facing-audit',
  '2026-10-25-kit-body-fix',
  '2026-10-25-kit-move',
  '2026-10-25-ledger-cleanup',
  '2026-10-25-ledger-cure',
  '2026-10-25-ledger-redesign',
  '2026-10-25-ledger-relocate',
  '2026-10-25-ledger-relocation',
  '2026-10-25-ledger-shape',
  '2026-10-25-ledger-untrack',
  '2026-10-25-ledgerhome-trace',
  '2026-10-25-legacy-archive',
  '2026-10-25-manifest-vs-init',
  '2026-10-25-md5-fix',
  '2026-10-25-migrate-csa',
  '2026-10-25-module-log-mismatch',
  '2026-10-25-module-log-three-state',
  '2026-10-25-old-root-retired',
  '2026-10-25-oldroot-retire',
  '2026-10-25-other-projects-survey',
  '2026-10-25-pay-debt',
  '2026-10-25-plan-refactor',
  '2026-10-25-post-migrate-fix',
  '2026-10-25-post-restart-verify',
  '2026-10-25-post-restart-verify-2',
  '2026-10-25-post-restart-verify-3',
  '2026-10-25-post-restart-verify-4',
  '2026-10-25-post-restart-verify-5',
  '2026-10-25-project-migrate',
  '2026-10-25-project-rebuild',
  '2026-10-25-queue-fix',
  '2026-10-25-queue-split',
  '2026-10-25-relocation-survey',
  '2026-10-25-reply-mode-3',
  '2026-10-25-reuse-audit',
  '2026-10-25-reuse-land',
  '2026-10-25-scaffold-retire',
  '2026-10-25-skeleton-decopy',
  '2026-10-25-skeleton-wording',
  '2026-10-25-stale-fix',
  '2026-10-25-stale-load-sentences',
  '2026-10-25-switch-three-way',
  '2026-10-25-unblock-commit',
  '2026-10-26-backup-naming',
  '2026-10-26-checks-face',
  '2026-10-26-checks-triage',
  '2026-10-26-closeout-verify',
  '2026-10-26-consistency-fix',
  '2026-10-26-coverage-meter',
  '2026-10-26-dispatch-states',
  '2026-10-26-dispatch-states-hardening',
  '2026-10-26-external-reference-proposal',
  '2026-10-26-final-cleanup',
  '2026-10-26-index-restore',
  '2026-10-26-ledger-reds',
  '2026-10-26-migrate-batch2',
  '2026-10-26-migrate-mana',
  '2026-10-26-migrate-prompt-enhancer',
  '2026-10-26-overturn-audit',
  '2026-10-26-ratchet-audit',
  '2026-10-26-readings-honesty',
  '2026-10-26-rebuild-canonical',
  '2026-10-26-receipt-refusals',
  '2026-10-26-reply-shape-research',
  '2026-10-26-state-read-mismatch',
  '2026-10-26-wake-channel-check',
  '2026-10-26-whole-scheme-research',
  '2026-10-27-acceptable-red',
  '2026-10-27-architecture-review',
  '2026-10-27-archive-gate',
  '2026-10-27-archive-gate-verify',
  '2026-10-27-contract-batch',
  '2026-10-27-contract-design',
  '2026-10-27-contract-polarity',
  '2026-10-27-external-patterns',
  '2026-10-27-gitignore-residual',
  '2026-10-27-gitignore-root',
  '2026-10-27-ledger-reachable',
  '2026-10-27-ledger-relocate',
  '2026-10-27-mainline-design',
  '2026-10-27-mainline-plan',
  '2026-10-27-multi-hob',
  '2026-10-27-preflight-root',
  '2026-10-27-readpath-broken',
  '2026-10-27-rollback-all',
  '2026-10-27-scheme-catchup',
  '2026-10-27-scheme-review',
  '2026-10-27-scheme-sync',
  '2026-10-27-transition-design',
  '2026-10-27-verdict-not-shown',
  '2026-10-27-verdict-path',
  '2026-10-27-watch-feature',
  '2026-10-27-watch-fix',
  '2026-10-27-watch-verify-final',
  '2026-10-27-watch-wait-loop',
  '2026-10-28-assert-real-behavior',
  '2026-10-28-cleanup-readable',
  '2026-10-28-context-loss-audit',
  '2026-10-28-context-restore',
  '2026-10-28-contract-finalize',
  '2026-10-28-contract-move',
  '2026-10-28-contract-restructure',
  '2026-10-28-contract-skeleton',
  '2026-10-28-dialogue-contract',
  '2026-10-28-drop-often',
  '2026-10-28-drop-threshold',
  '2026-10-28-effort-budget',
  '2026-10-28-effort-budget-fix',
  '2026-10-28-effort-budget-fix2',
  '2026-10-28-fix-syntax',
  '2026-10-28-header-fix',
  '2026-10-28-index-fill',
  '2026-10-28-ledger-inventory',
  '2026-10-28-ledger-rebalance',
  '2026-10-28-ledger-split',
  '2026-10-28-mixed-split',
  '2026-10-28-prompt-design',
  '2026-10-28-split-diagnosis',
  '2026-10-28-template-deletions',
  '2026-10-28-template-why',
  '2026-10-28-verify-contract-live',
  '2026-10-28-watch-contract',
  '2026-10-28-watch-fallback',
  '2026-10-28-watch-fallback-audit',
  '2026-10-28-wi-l',
  '2026-10-29-attachment-check',
  '2026-10-29-build',
  '2026-10-29-four-stage-mainline',
  '2026-10-29-host-hook-probe',
  '2026-10-29-index-159-170',
  '2026-10-29-index-titles',
  '2026-10-29-ledger-copies',
  '2026-10-29-open-read-level',
  '2026-10-29-popup-not-shown',
  '2026-10-29-popup-wire',
  '2026-10-29-pre-build-audit',
  '2026-10-29-pre-build-check',
  '2026-10-29-pre-step-gate',
  '2026-10-29-requeue',
  '2026-10-29-restart-verify',
  '2026-10-29-retire-09',
  '2026-10-29-stale-files-audit',
  '2026-10-29-state-docs-fix',
  '2026-10-29-verify-contract-live',
  '2026-10-30-archive-readme',
  '2026-10-30-commit-plan',
  '2026-10-30-context-41-fix',
  '2026-10-30-context-refresh',
  '2026-10-30-ctx41-gen-block',
  '2026-10-30-ctx41-ledger',
  '2026-10-30-ctx41-meta-negctl',
  '2026-10-30-ctx41-stages-route',
  '2026-10-30-example-path-fix',
  '2026-10-30-ledger-move',
  '2026-10-30-p13-reds',
  '2026-10-30-p17-reds',
  '2026-10-30-preset-switch',
  '2026-10-30-progress-exec',
  '2026-10-30-progress-research',
  '2026-10-30-project-toc',
  '2026-10-30-project-toc-close',
  '2026-10-30-rearch-greenfield',
  '2026-10-30-sdd-stage-ui',
  '2026-10-30-tool-permission-survey',
  '2026-10-30-v-refs-fix',
  '2026-10-30-workflow-ui-survey',
  '2026-10-31-full-audit',
  '2026-10-31-index-fix',
  '2026-10-31-index-split',
  '2026-10-31-p39-intake-invariants',
  '2026-10-31-panel-no-hscroll',
  '2026-10-31-parent-fix',
  '2026-10-31-run001-narrow',
  '2026-11-01-p40-gap-close',
  '2026-11-01-p41-acceptance-close',
  '2026-11-02-decisions-snapshot',
  '2026-11-02-p41-ledger-close',
]

/** `⊘` 那一行（读不到归档目录时；⚠ 与 B/D 轨同形）。 */
export const ARCHIVE_NO_DIRS = '⊘ 读不到归档目录 ⇒ 这条判据无法执行，⛔ 这不是通过'

/**
 * **E 组判据的纯函数实现**（⚠ 收目录名数组 + 一个"有没有清单件"的判据，便于负向对拍直接喂夹具）。
 *
 * @param {string[]} dirNames - `archive/` 下的目录名
 * @param {(name: string) => boolean} hasManifest - 该目录下有没有清单件
 * @returns {{ checked:number, historical:number, missing:string[] }}
 */
export function archiveManifestProblems(dirNames, hasManifest, membersOf) {
  const missing = []
  const white = new Set(ARCHIVE_HISTORICAL_NO_MANIFEST)
  let checked = 0
  let historical = 0
  /** ⚠ 2026-11-07 硬化：一次性交接目录**单列一档**（见 `isHandoffDir` 上方那段）。 */
  const handoff = []
  for (const name of dirNames) {
    if (white.has(name)) { historical++; continue }
    /**
     * ⚠ 顺序很重要：**先判"有清单"** ⇒ 有清单的目录走正常路径（判绿），
     *   再判"是不是交接目录"。⛔ 不能反过来 —— 否则"交接目录 + 补了 README"会被错记成跳过，
     *   那等于让"补清单"这个动作**没有回报**。
     */
    if (!hasManifest(name)) {
      const members = typeof membersOf === 'function' ? membersOf(name) : undefined
      if (isHandoffDir(members)) { handoff.push(name); continue }
    }
    checked++
    if (!hasManifest(name)) missing.push(name)
  }
  return { checked, historical, missing, handoff }
}

/**
 * **档位归属的唯一判定**：0 个目录 ⇒ `'skip'`，否则 ⇒ `'checked'`。
 * ⚠ 抽成函数，好让负向对拍 `N-E0` 测的就是主流程用的那条规则（⛔ 夹具里另写一份）。
 */
export function archiveManifestBucket(dirNames) {
  return dirNames.length === 0 ? 'skip' : 'checked'
}

/**
 * **E 组报告体**（⚠ 主流程与负向对拍**共用这一个函数**，sink 由调用方注入）。
 *
 * ── 为什么 sink 要注入（`TASK-E1.md` §一第 4 件点名要求）────────────────
 *   若这里直接调模块级 `bad` / `skip`，对拍一跑就**污染真实计数**。
 *   ⇒ sink 作参数传入：主流程传真 sink，对拍传影子 sink ⇒ 两边跑**同一段判定**。
 *
 * @param {{dirNames:string[], hasManifest:Function}} input
 * @param {{bad:Function, ok:Function, skip:Function}} sink
 * @returns {'skip'|'checked'}
 */
export function reportArchiveManifest({ dirNames, hasManifest, membersOf }, sink) {
  const bucket = archiveManifestBucket(dirNames)
  if (bucket === 'skip') {
    sink.skip(ARCHIVE_NO_DIRS)
    return bucket
  }
  const r = archiveManifestProblems(dirNames, hasManifest, membersOf)
  /**
   * ⚠ 2026-11-07 硬化：交接目录**单列一档**，走 `skip`（⛔ 不进 ok ⇒ **不计入通过**）。
   *   ⚠ 它**不阻断**下面的判定：剩下的目录该红还是红（⛔ 不是"有一个交接目录就整族放过"）。
   */
  if (r.handoff.length > 0) sink.skip(ARCHIVE_HANDOFF_SKIP(r.handoff))
  /**
   * ⚠⚠ **只在"零需核"是交接档造成的时候**才追加这条 `⊘`（2026-11-07 实测边界）。
   *
   *   若 `checked === 0` 是**历史白名单**造成的（`historical > 0`、`handoff === 0`），
   *   ⛔ 不许改口径：那是既有语义（白名单**逐个列出**、明确"不追溯"），
   *   `N-E3` 正是钉这一条（"白名单历史目录没清单 ⇒ 仍绿"）。
   *   ⇒ 本轮硬化的范围只有交接目录，⛔ 不顺手改历史档的口径
   *     （改了会把 `N-E3` 判红 —— 实测踩过）。
   */
  if (r.checked === 0 && r.handoff.length > 0) {
    sink.skip(`⊘ 没有需要清单件的归档目录（历史不追溯 ${r.historical} 个 + 一次性交接 ${r.handoff.length} 个）`
      + ' ⇒ 本条对它们**无法判定**，⛔ 这不是通过')
    return bucket
  }
  if (r.missing.length === 0) {
    sink.ok(`E1 ✓ 归档目录**都带清单件**：实测 ${dirNames.length} 个目录 = 历史不追溯 ${r.historical} 个（白名单逐个列出）`
      + ` + 一次性交接 ${r.handoff.length} 个（单列 ⊘ 档，不计入通过）`
      + ` + 需核 ${r.checked} 个，需核的那些**逐个都有 \`${ARCHIVE_MANIFEST_NAME}\`**`
      + '（⚠ 本判据只查存在性，内容格式由 ① 形态 M/S 管）')
  } else {
    for (const name of r.missing) {
      sink.bad(`E1 · 归档目录 \`archive/${name}/\` **没有清单件 \`${ARCHIVE_MANIFEST_NAME}\`**`
        + `\n      ⇒ 这个目录说不清"这一批做过什么、有哪些件" ⇒ 它是证据包却没有清单（⛔ 不许只把文件写进去就算归档）`
        + `\n      ⇒ 修法：在该目录下写 \`${ARCHIVE_MANIFEST_NAME}\`，列出有哪些件 + 各自多少字节`
        + `\n      ⇒ ⚠ 若这是**历史**目录（本轮之前就有），⛔ 不许事后补写（那是编文档）—— 加进 \`ARCHIVE_HISTORICAL_NO_MANIFEST\` 并注明理由`)
    }
  }
  return bucket
}

/**
 * 跑 E 组（读盘）。
 *
 * @param {{ledgerRoot: string, bad: Function, ok: Function, skip: Function}} o
 * @returns {{executed:boolean, dirs:number}}
 */
export function checkArchiveManifests({ ledgerRoot, bad, ok, skip, fixtureNoManifest = [] }) {
  const archiveDir = join(ledgerRoot, 'archive')
  let dirNames = []
  try {
    dirNames = readdirSync(archiveDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch { dirNames = [] }
  /**
   * ⚠ `fixtureNoManifest` **只给 `--self-test` 用**（那些目录是"故意没清单"的测试对象）。
   *   ⚠ 默认空数组 ⇒ 真实账本区跑时**没有任何豁免**（⛔ 不是"除…外都放过"的反向逻辑）。
   */
  const fixtureSet = new Set(fixtureNoManifest)
  const names = dirNames.filter((n) => !fixtureSet.has(n))
  const hasManifest = (name) => existsSync(join(archiveDir, name, ARCHIVE_MANIFEST_NAME))
  /**
   * ⚠ 成员名**只取直接成员**（`withFileTypes`）⇒ 有子目录时名字会出现在列表里、
   *   而 `isHandoffDir` 的白名单只认 `TASK.md` / `REPORT[-n].md` ⇒ **有子目录就一定不是交接目录**。
   */
  const membersOf = (name) => {
    try {
      return readdirSync(join(archiveDir, name), { withFileTypes: true }).map((e) => e.name)
    } catch { return undefined }
  }
  const bucket = reportArchiveManifest({ dirNames: names, hasManifest, membersOf }, { bad, ok, skip })
  return { executed: bucket === 'checked', dirs: names.length }
}

// ── 跑一遍（给定账本根，返回 FAIL 清单）──────────────────────────────────────
function runChecks(ledgerRoot, opts = {}) {
  const bad = []
  const notes = []
  /**
   * ── ⚠⚠ **第三态 `skip`**（2026-10-21 · 第 349 轮 · 甲-1 甲方案）──────────────
   *   改前本族有 5 处 `ok('…【未执行】/ 无成员可核…')`：
   *   它们**嘴上说"不代表通过"，机器却记成 `✓ 通过`**（`ok()` 无条件打 ✓、不进 `bad`）。
   *   ⇒ 现在分流：这几处走 `skip`，**不进 `notes`（= 通过）、不进 `bad`（= 失败）**，
   *     单独成档，由主入口印 `跳过 N 处`（`check:all` 读这个数）。
   *   ⚠ 与 `noObject`（`exit 2`）**不是同一档**：那档是"整族一条都没跑"（账本根读不到），
   *     本档是"**账本根读到了、族跑了，但其中几处没对象**" ⇒ 不许退 2（见 check-all 的口径）。
   */
  const skips = []
  const b = (m) => bad.push(m)
  const o = (m) => notes.push(m)
  const k = (m) => skips.push(m)
  /**
   * ⚠ 2026-11-02 P50/M4：**取数根在 `runChecks` 这一层解析一次**，供 ①（形态 S）与 ①c（历史交叉核）共用。
   *   改前 ①c 只用 `root`（工作区仓）⇒ 形态 M 的源修订（`d391602` 等只在归档内层仓里）
   *   一律查不到 ⇒ 每份喷一行 `fatal: invalid object name`（情形 B：跨仓查错对象）。
   */
  const revRepos = resolveRevRepos(ledgerRoot)
  const a = checkArchiveBytes({ ledgerRoot, bad: b, ok: o, skip: k })
  const c = crossCheckAgainstWorkspaceHistory({ ledgerRoot, revRepos, bad: b, ok: o, skip: k })
  const d = checkDirRefs({ ledgerRoot, bad: b, ok: o, skip: k })
  // ⚠ 2026-10-30 P7：归档目录清单 ↔ 生成物（`gen/archive-index.md`）
  const am = checkArchiveIndexGen({ ledgerRoot, bad: b, ok: o, skip: k })
  // ⚠ 2026-11-02 P50/E1：归档目录必须带清单件（历史白名单不追溯）
  /**
   * ⚠⚠ **E1 在夹具上的口径**（2026-11-02 P50/E1）：`--self-test` 的夹具里有几个目录
   *   **故意没有** `README.md`（`2026-01-04-bareindex` 就是"无清单载体"那一档的**测试对象**）。
   *   ⇒ 若 E1 对夹具目录照样判红，它会把 `--self-test` 里"期望 0"的那几档全部污染成 FAIL
   *     （实测：6 档从 PASS 变 FAIL）。⚠ 那是**判据生效**的证明，但**不是**那些档位要测的东西。
   *   ⇒ 用 `noManifestFixture` 把"夹具里故意没清单的目录"显式点出来（⛔ 不是反向逻辑：
   *     真实账本区跑时这个数组为空 ⇒ E1 对真目录**一个都不放过**）。
   */
  const e1 = checkArchiveManifests({ ledgerRoot, bad: b, ok: o, skip: k,
    fixtureNoManifest: opts.fixtureNoManifest ?? [] })
  return { bad, notes, skips, a, c, d, am, e1 }
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

function selfTest(realLedgerRoot) {
  const fx = buildFixture()
  /**
   * ⚠⚠ **夹具里"故意没清单"的目录**（2026-11-02 P50/E1）：
   *   `2026-01-04-bareindex` 是"无清单载体"那一档的**测试对象** —— 它没有 `README.md`
   *   正是那一档要验的形态。⇒ E1 对它在 `--self-test` 里豁免，
   *   ⛔ 否则 E1 会把 6 档"期望 0"的读数污染成 FAIL（实测过）。
   *   ⚠ **真实账本区跑时这个名单是空的** ⇒ 对真目录一个都不放过。
   */
  const FIXTURE_OPTS = { fixtureNoManifest: ['2026-01-04-bareindex'] }
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

  let r = runChecks(fx.L, FIXTURE_OPTS)
  expect('半 ① + ② 破坏前', r, 0, '①')
  const before = { half1: r.a.pairs, half2: r.d.memberPairs }

  // ── 半 ① 破坏：改掉归档件一个字节（清单随即不符）──
  writeFileSync(fx.aPath, Buffer.concat([fx.aBuf, Buffer.from('X')]))
  r = runChecks(fx.L, FIXTURE_OPTS)
  const other1 = expect('半 ① 破坏后（归档件被改 1 字节）', r, 1, '①')
  const half1Broken = lineOf(r, '①')
  // 还原
  writeFileSync(fx.aPath, fx.aBuf)
  r = runChecks(fx.L, FIXTURE_OPTS)
  expect('半 ① 还原后', r, 0, '①')

  // ── 半 ② 破坏：删掉一个**只在 index 里**的成员（清单不列它 ⇒ 半 ① 不受影响）──
  unlinkSync(fx.memberPath)
  r = runChecks(fx.L, FIXTURE_OPTS)
  const other2 = expect('半 ② 破坏后（目录引用缺一份成员）', r, 1, '②')
  const half2Broken = lineOf(r, '②')
  // 还原
  writeFileSync(fx.memberPath, fx.memberBuf)
  r = runChecks(fx.L, FIXTURE_OPTS)
  expect('半 ② 还原后', r, 0, '②')

  // ── 半 ②【新增档 · 第 121 轮】**盘上派生**面：一个**没有任何正文点名**的目录，
  //    破坏其成员 ⇒ 必须 FAIL（而"正文点名"那条路**看不见它**）——
  //    ⚠ 这一档正是第 120 轮那个静默缩水的**回归闸门**。
  unlinkSync(fx.derivedMemberPath)
  r = runChecks(fx.L, FIXTURE_OPTS)
  const other3 = expect('半 ②【派生面】破坏后（无正文点名的目录缺一份成员）', r, 1, '②')
  const half2DerivedBroken = lineOf(r, '②')
  // 还原
  writeFileSync(fx.derivedMemberPath, fx.derivedMemberBuf)
  r = runChecks(fx.L, FIXTURE_OPTS)
  const other3b = expect('半 ②【派生面】还原后', r, 0, '②')

  // ── 半 ②【新增档 · 第 122 轮】**无清单载体**的目录（既无 README 又无 sources/），
  //    成员**只来自 index** ⇒ 破坏它 ⇒ 必须 FAIL；还原 ⇒ PASS。
  //    ⚠ 这一档正是"收录判据自带排除面"那处口子的**回归闸门**。
  unlinkSync(fx.bareMemberPath)
  r = runChecks(fx.L, FIXTURE_OPTS)
  const other4 = expect('半 ②【无清单载体档】破坏后（既无 README 又无 sources/ 的目录缺成员）', r, 1, '②')
  const half2BareBroken = lineOf(r, '②')
  writeFileSync(fx.bareMemberPath, fx.bareMemberBuf)
  r = runChecks(fx.L, FIXTURE_OPTS)
  const other4b = expect('半 ②【无清单载体档】还原后', r, 0, '②')

  // ══════════════════════════════════════════════════════════════════════
  // E1 的四条负向对拍（2026-11-02 P50/E1 · `TASK-E1.md` §一第 3/4 件）
  // ⚠ 全部在**临时夹具目录**里造（`fx.L` 是 mkdtempSync 出来的）⇒ ⛔ 不往真 archive/ 写测试目录
  // ⚠ 每条：① 先自证基线全绿 ② 改坏 ⇒ 必红且点名目录+缺失件 ③ 还原 ⇒ 回绿
  // ══════════════════════════════════════════════════════════════════════
  {
    /**
     * ⚠ 这一组**不走 `runChecks`**，直接调 E1 的纯函数 + 报告体：
     *   `runChecks` 会把①/② 那些半也跑一遍 ⇒ 本组要验的是 **E1 自己**，
     *   混进别的半的读数会让"红的到底是不是 E1"判不出来。
     *   ⚠ 判定逻辑仍是**同一份**（`reportArchiveManifest`），⛔ 夹具里没有第二份。
     */
    /**
     * ⚠ `selfTest()` 里**没有**模块级 `ok` / `bad`（那对只在 `runChecks` 内部）——
     *   本函数用 `readings` 收集 `{label, exit, want, line, pass}` 再由尾部统一打印。
     *   ⇒ 这里做两个薄壳，把 E1 的四条对拍**并进同一份 readings**（⛔ 不另开一套输出通道）。
     */
    /**
     * ⚠⚠ **为什么叫 `ok` / `bad` 而不是 `eOk` / `eBad`**（2026-11-02 P50/M3 · `TASK-M3.md` §一第 3 件）：
     *   `scripts/check-meta-negctl.mjs` 的计数口径是
     *   `/(?:ok|bad|note\.push|check)\(\s*(?:\`([^\`]*)\`|'([^']*)')/gs` ——
     *   它**只认这四个名字**开头的断言调用，且只取**第一个字符串字面量**里含「负向对拍」的。
     *   ⇒ E1 那四条对拍原来走 `readings.push({...})`，名字既不是 `ok` 也不是 `bad`
     *     ⇒ 元判据**数到 0 条** ⇒ 有人删掉这四条它也不会红（`VERDICT-M2` §二 的发现）。
     *   ⚠ 改法**不是**把「负向对拍」塞进别的话凑数（那是假绿），而是让这四条**真的**
     *     经由 `ok()` / `bad()` 输出 —— 语义一字不改：仍是「先自证 → 断言必红 → 断言能还原」三段。
     *   ⚠ 运行时行为不变：这两个壳仍把结果并进 `readings`，由尾部统一打印。
     */
    const ok = (m) => readings.push({ label: m.split('\n')[0], exit: 0, want: 0, line: m.split('\n')[0], pass: true })
    const bad = (m) => readings.push({ label: m.split('\n')[0], exit: 1, want: 0, line: m.split('\n')[0], pass: false })
    const e1Dir = join(fx.L, 'archive', '2026-01-09-new-no-manifest')
    const e1Dir2 = join(fx.L, 'archive', '2026-01-10-new-with-manifest')

    /** 影子 sink（⚠ 照 B/D 轨：⛔ 不许调模块级 `bad`/`ok`/`skip` 污染真实计数）。 */
    const shadowRun = (names, has) => {
      const sh = { bad: [], ok: [], skip: [] }
      const sink = {
        bad: (m) => sh.bad.push(m),
        ok: (m) => sh.ok.push(m),
        skip: (m) => sh.skip.push(m),
      }
      const bucket = reportArchiveManifest({ dirNames: names, hasManifest: has }, sink)
      return { sh, bucket }
    }

    // ── 基线：一个白名单历史目录（无清单）+ 一个有清单的新目录 ⇒ 必须全绿 ──
    const histName = ARCHIVE_HISTORICAL_NO_MANIFEST[0]
    const base = shadowRun([histName, '2026-01-10-new-with-manifest'], (n) => n === '2026-01-10-new-with-manifest')
    const baselineClean = base.bucket === 'checked' && base.sh.bad.length === 0
      && base.sh.skip.length === 0 && base.sh.ok.length === 1

    if (!baselineClean) {
      bad(`N-E · E1 基线**本身就不合法**（期望 checked + 1 条 ✓ + 0 bad，实测 bucket=${base.bucket} `
        + `ok=${base.sh.ok.length} bad=${base.sh.bad.length} skip=${base.sh.skip.length}）⇒ 下面三条对拍不可判`)
    } else {
      // ── N-E1：不在白名单且无清单件的新目录 ⇒ 必红且点名目录+缺失件 ──
      {
        mkdirSync(e1Dir, { recursive: true })
        writeFileSync(join(e1Dir, 'TASK-R99.md'), '# fixture: 只有一件、没有清单\n')
        /** ⚠ 先自证：目录**真建出来了**、且**真没有**清单件、且**真不在**白名单里。 */
        const reallyBroken = existsSync(e1Dir)
          && !existsSync(join(e1Dir, ARCHIVE_MANIFEST_NAME))
          && !ARCHIVE_HISTORICAL_NO_MANIFEST.includes('2026-01-09-new-no-manifest')
        const r = shadowRun(['2026-01-09-new-no-manifest'], (n) => existsSync(join(fx.L, 'archive', n, ARCHIVE_MANIFEST_NAME)))
        const hit = r.sh.bad.find((x) => x.includes('2026-01-09-new-no-manifest'))
        if (!reallyBroken) {
          bad('N-E1 · 夹具没造出"不在白名单 + 无清单件"的形态 ⇒ 本条不可判')
        } else if (hit === undefined) {
          bad('N-E1 · 新目录无清单件却绿灯 ⇒ E1 哑了（那条判据等于没写）')
        } else if (!hit.includes(ARCHIVE_MANIFEST_NAME)) {
          bad(`N-E1 · 咬住了但**没说缺哪一份**（期望含 \`${ARCHIVE_MANIFEST_NAME}\`）：${hit.slice(0, 90)}`)
        } else {
          ok(`N-E1 ✓ 负向对拍（先自证：\`archive/2026-01-09-new-no-manifest/\` 真建出来了、里面只有 \`TASK-R99.md\`、`
            + `无 \`${ARCHIVE_MANIFEST_NAME}\`、且不在白名单）⇒ E1 **必红**且**点名目录 + 缺失件**：${hit.split('\n')[0].slice(0, 110)}`
            + '；**反面**：见 N-E2（补上清单即转绿，⛔ 不是恒红）')
        }
      }

      // ── N-E2：给同一个目录补上清单件 ⇒ 必绿 ──
      {
        writeFileSync(join(e1Dir, ARCHIVE_MANIFEST_NAME), [
          '# 夹具清单', '',
          '| 件 | 字节 |', '|---|---:|', '| `TASK-R99.md` | 32 |', '',
        ].join('\n'))
        const reallyFixed = existsSync(join(e1Dir, ARCHIVE_MANIFEST_NAME))
        const r = shadowRun(['2026-01-09-new-no-manifest'], (n) => existsSync(join(fx.L, 'archive', n, ARCHIVE_MANIFEST_NAME)))
        if (!reallyFixed) {
          bad('N-E2 · 夹具没真把清单件写进去 ⇒ 本条不可判')
        } else if (r.sh.bad.length !== 0) {
          bad(`N-E2 · 补上 \`${ARCHIVE_MANIFEST_NAME}\` 之后仍红 ⇒ E1 恒红（${JSON.stringify(r.sh.bad).slice(0, 90)}）`)
        } else if (r.sh.ok.length !== 1) {
          bad(`N-E2 · 补上清单后没有 ✓ 读数（ok=${r.sh.ok.length}）⇒ 判据没跑到`)
        } else {
          ok(`N-E2 ✓ 负向对拍（先自证：刚给 \`2026-01-09-new-no-manifest/\` 写进了 \`${ARCHIVE_MANIFEST_NAME}\`，实测 exists=true）`
            + ' ⇒ E1 **转绿**（⛔ 不是恒红）：' + r.sh.ok[0].split('\n')[0].slice(0, 110))
        }
      }

      // ── N-E3：白名单里的历史目录没清单件 ⇒ 仍绿 ──
      {
        /** ⚠ 自证：这个历史目录**真的没有**清单件（⛔ 不是"有清单所以绿"）。 */
        /**
         * ⚠ 自证的两面：
         *   ① 白名单**真含**这个名字（⛔ 不是靠"名字不在名单里所以放过了"）；
         *   ② **真账本区**里这个目录**确实没有**清单件（⛔ 不是"有清单所以绿"）。
         */
        const histNoManifest = ARCHIVE_HISTORICAL_NO_MANIFEST.includes(histName)
          && !existsSync(join(realLedgerRoot, 'archive', histName, ARCHIVE_MANIFEST_NAME))
        const r = shadowRun([histName], () => false)
        if (!histNoManifest) {
          bad(`N-E3 · 白名单成员 \`${histName}\` 竟然**有**清单件 ⇒ 本条证不了"历史不追溯"`)
        } else if (r.sh.bad.length !== 0) {
          bad(`N-E3 · 白名单里的历史目录无清单却被判红 ⇒ 违反"历史不追溯"（${JSON.stringify(r.sh.bad).slice(0, 90)}）`)
        } else if (r.sh.ok.length !== 1) {
          bad(`N-E3 · 历史目录没进"已核"读数（ok=${r.sh.ok.length}）⇒ 判据没跑到`)
        } else {
          ok(`N-E3 ✓ 负向对拍（先自证：白名单成员 \`${histName}\` **实测无 \`${ARCHIVE_MANIFEST_NAME}\`**，且它是白名单第 1 条）`
            + ' ⇒ E1 **仍绿**（⛔ 不把历史目录判红）：' + r.sh.ok[0].split('\n')[0].slice(0, 100))
        }
      }

      // ── N-E4：一次性交接目录 ⇒ 单列 ⊘ 档、⛔ 既不判通过也不判红（2026-11-07 硬化）──
      {
        /**
         * ⚠⚠ **这条对拍要证的是"硬化之后仍然咬得住真证据包"**（TASK §二2 的"⛔ 不许整体放宽"）。
         *   四档一起测，缺一档这条就不算做完：
         *     ① 只含 `TASK.md` + `REPORT.md` 的交接目录 ⇒ 走 ⊘（ok=0 · bad=0 · skip=1）；
         *     ② **同一个目录**塞进 `EVIDENCE.md` ⇒ **立刻失去交接档** ⇒ 缺清单**必红**；
         *     ③ 只含 `TASK.md` + `DECISIONS.md`（本单真实形态）⇒ 仍走 ⊘；
         *     ④ 交接目录**旁边**放一个真证据包（无清单）⇒ 交接档**不掩护**它，仍必红。
         */
        const sh = () => ({ bad: [], ok: [], skip: [] })
        const run = (names, membersOf, has) => {
          const s2 = sh()
          const bucket = reportArchiveManifest({ dirNames: names, hasManifest: has, membersOf }, {
            bad: (m) => s2.bad.push(m), ok: (m) => s2.ok.push(m), skip: (m) => s2.skip.push(m),
          })
          return { s2, bucket }
        }
        /** ① 纯交接目录（两件） */
        const pure = ['TASK.md', 'REPORT.md']
        const pureHandoff = isHandoffDir(pure)
        const r1 = run(['2026-11-07-handoff-fixture'], () => pure, () => false)
        /** ② 塞进证据件后不再是交接目录 */
        const polluted = ['TASK.md', 'REPORT.md', 'EVIDENCE.md']
        const pollutedHandoff = isHandoffDir(polluted)
        const r2 = run(['2026-11-07-handoff-fixture'], () => polluted, () => false)
        /** ③ 本单真实形态：TASK + DECISIONS */
        const realShape = ['TASK.md', 'DECISIONS.md']
        const realHandoff = isHandoffDir(realShape)
        const r3 = run(['2026-11-07-check-hardening'], () => realShape, () => false)
        /** ④ 交接目录 + 真证据包并存 */
        const r4 = run(['2026-11-07-handoff-fixture', '2026-01-11-evidence-no-manifest'],
          (n) => (n === '2026-11-07-handoff-fixture' ? pure : ['ACCEPTANCE-REPORT.md', 'EVIDENCE.md']), () => false)
        /** ⑤ 反面：交接目录**补上** README ⇒ 走正常路径判绿（⛔ 不是永远跳过） */
        const r5 = run(['2026-11-07-handoff-fixture'], () => pure,
          (n) => n === '2026-11-07-handoff-fixture')

        const p = []
        /**
         * ⚠⚠ **`skip` 条数是 2 不是 1**（实测 2026-11-07）：
         *   目录全是交接件 ⇒ ① `⊘ 一次性交接目录 N 个…`；且此时 `checked === 0`
         *   ⇒ ② 还会追加一条 `⊘ 没有需要清单件的归档目录…`。
         *   ⚠ 两条都是 `⊘`、都**不进 ok** ⇒ 语义正确。⛔ 别把断言写成"恰好 1 条"，
         *   那会把**正确的实现**判成坏（本轮实测踩过：`skip=2` 被判红）。
         */
        const pureHandoffSkip = r1.s2.skip.some((x) => x.includes('一次性交接目录') && x.includes('2026-11-07-handoff-fixture'))
        const pureNoTargetSkip = r1.s2.skip.some((x) => x.includes('没有需要清单件的归档目录'))
        if (!pureHandoff) p.push('夹具 ① 的两件套没被判成交接目录 ⇒ 判据没生效')
        else if (!(r1.bucket === 'checked' && r1.s2.ok.length === 0 && r1.s2.bad.length === 0)) {
          p.push(`① 纯交接目录被洗成通过或错判红（bucket=${r1.bucket} ok=${r1.s2.ok.length} bad=${r1.s2.bad.length}）`)
        } else if (!pureHandoffSkip) {
          p.push(`① 没有 \`⊘ 一次性交接目录\` 那一行：${JSON.stringify(r1.s2.skip.map((x) => x.slice(0, 60)))}`)
        } else if (!pureNoTargetSkip) {
          p.push(`① checked===0 时没有 \`⊘ 没有需要清单件的归档目录\` 那一行（会把"没判"洗成"判过了"）`)
        }
        if (pollutedHandoff) p.push('夹具 ② 塞进 EVIDENCE.md 后**仍**被判成交接目录 ⇒ 白名单太宽，会放过真证据包')
        else if (r2.s2.bad.length !== 1) p.push(`② 含 EVIDENCE.md 的目录缺清单却没判红（bad=${r2.s2.bad.length}）⇒ 硬化把真缺陷放过了`)
        if (!realHandoff) p.push('夹具 ③ 的 TASK.md + DECISIONS.md 没被判成交接目录 ⇒ 本单真实形态仍会红')
        else if (r3.s2.bad.length !== 0 || r3.s2.ok.length !== 0) p.push(`③ 本单真实形态被洗成通过或错判红（ok=${r3.s2.ok.length} bad=${r3.s2.bad.length}）`)
        else if (!r3.s2.skip.some((x) => x.includes('一次性交接目录') && x.includes('2026-11-07-check-hardening'))) {
          p.push(`③ 本单真实形态没走 \`⊘ 一次性交接目录\` 档（skip=${r3.s2.skip.length}）`)
        }
        if (r4.s2.bad.length !== 1 || !r4.s2.bad[0].includes('2026-01-11-evidence-no-manifest')) {
          p.push(`④ 交接目录掩护了旁边的真证据包（bad=${r4.s2.bad.length}）⇒ 单列档变成了整体放宽`)
        }
        if (r5.s2.ok.length !== 1 || r5.s2.bad.length !== 0) p.push(`⑤ 交接目录补上 ${ARCHIVE_MANIFEST_NAME} 后没转绿（ok=${r5.s2.ok.length} bad=${r5.s2.bad.length}）⇒ "补清单"这个动作没有回报`)

        if (p.length === 0) {
          ok(`N-E4 ✓ 负向对拍（先自证：\`TASK.md\` + \`REPORT.md\` 被判成交接目录、塞进 \`EVIDENCE.md\` 后**不再**被判成交接目录）`
            + ' ⇒ ① 纯交接目录走 **⊘ 单列档**（ok +0 · bad +0，⛔ 不计入通过）'
            + ' · ② 塞进证据件 ⇒ **失去交接档、缺清单必红**（⛔ 没被整体放宽）'
            + ' · ③ 本单真实形态（`TASK.md` + `DECISIONS.md`）同样走 ⊘'
            + ' · ④ 交接目录**不掩护**旁边的真证据包（它照样红）'
            + ` · ⑤ 反面：补上 \`${ARCHIVE_MANIFEST_NAME}\` ⇒ 走正常路径判绿（⛔ 不是恒跳过）`)
        } else {
          for (const x of p) bad(`N-E4 · ${x}`)
        }
      }

      // ── N-E0：0 个目录 ⇒ 走 ⊘ 档、不计入通过 ──
      {
        const sh = { bad: [], ok: [], skip: [] }
        const bucket = reportArchiveManifest({ dirNames: [], hasManifest: () => false }, {
          bad: (m) => sh.bad.push(m), ok: (m) => sh.ok.push(m), skip: (m) => sh.skip.push(m),
        })
        /** 反面：给一个目录 ⇒ 必须离开 skip、进 checked。 */
        const sh2 = { bad: [], ok: [], skip: [] }
        const bucket2 = reportArchiveManifest({ dirNames: ['2026-01-10-new-with-manifest'], hasManifest: () => true }, {
          bad: (m) => sh2.bad.push(m), ok: (m) => sh2.ok.push(m), skip: (m) => sh2.skip.push(m),
        })
        /** ⚠ 语义判（与 B/D 轨同口径，`VERDICT-B1.md` §2.1 已裁定按语义）：摘掉否定式后再查。 */
        const lineHasPass = ARCHIVE_NO_DIRS.replace('这不是通过', '').includes('通过')
        if (bucket !== 'skip') {
          bad(`N-E0 · 0 个目录时**没走 skip 档**（实测 ${bucket}）⇒ 档位判定哑了`)
        } else if (sh.ok.length !== 0) {
          bad(`N-E0 · 0 个目录时**计入了通过**（ok +${sh.ok.length}）⇒ "没判"被洗成"判过了"`)
        } else if (sh.skip.length !== 1) {
          bad(`N-E0 · 0 个目录时**没有计入跳过**（skip ${sh.skip.length}，期望 1）⇒ 那个档位没有落点`)
        } else if (sh.skip[0] !== ARCHIVE_NO_DIRS) {
          bad(`N-E0 · 跳过那一行**不是约定的原文**：${JSON.stringify(sh.skip[0])}`)
        } else if (lineHasPass) {
          bad('N-E0 · 那一行里出现了非否定式的"通过"字样 ⇒ 读者会把它当成通过')
        } else if (bucket2 !== 'checked' || sh2.ok.length !== 1 || sh2.bad.length !== 0 || sh2.skip.length !== 0) {
          bad(`N-E0 · 反面不成立：给一个有清单的目录后应当 checked + ✓，实测 bucket=${bucket2} ok=${sh2.ok.length} bad=${sh2.bad.length} skip=${sh2.skip.length}`)
        } else {
          ok('N-E0 ✓ 负向对拍（先自证：喂 0 个目录名；影子 sink 不污染真实计数）'
            + ' ⇒ 走 `⊘` 单列档：**ok +0**（⛔ 不计入通过）· **skip +1**（有自己的落点）'
            + `，且那行里**没有非否定式的"通过"** —— 原文：${ARCHIVE_NO_DIRS}`
            + '；**反面**：给一个有清单的目录 ⇒ 进 `checked` 档且 ✓（⛔ 不是恒跳过）')
        }
      }
    }
    // ⚠ 清理夹具目录（⛔ 不往真 archive/ 写；这些都在 mkdtemp 出来的 fx.L 里，最后 rmSync(fx.base) 一并清）
    rmSync(e1Dir, { recursive: true, force: true })
    rmSync(e1Dir2, { recursive: true, force: true })
  }

  // ══════════════════════════════════════════════════════════════════════
  // N-M4 · ①c 的**跨仓取数**与 **stderr 静默**（2026-11-02 P50/M4 · `TASK-M4.md` §一第 2 件 · 情形 B）
  // ⚠ 病：①c 原来只在 `root`（**工作区仓**）里 `git log`/`rev-parse`，
  //   而形态 M 的源修订（`d391602` 等）**只在归档内层仓里**
  //   ⇒ 每份查不到 ⇒ 喷 `fatal: invalid object name`，且判定照旧 EXIT=0（真错误不可观测）。
  // ⚠ 本档要证两件：① 取数根真的**多了归档内层仓**（命中数因此上升）；② 坏 id 不会静默。
  // ══════════════════════════════════════════════════════════════════════
  {
    /**
     * ⚠ `selfTest()` 里**没有**模块级 `ok` / `bad`（那对只在 `runChecks` 内部）。
     *   ⚠⚠ 但**名字必须叫 `ok` / `bad`** —— `check-meta-negctl.mjs` 只认
     *     `/(?:ok|bad|note\.push|check)\(\s*(?:`([^`]*)`|'([^']*)')/gs` 这四个名字开头的调用。
     *   ⇒ 这里在**块内**声明 `ok` / `bad` 两个局部函数（遮蔽外部无定义），
     *     既进元判据计数、又把结果并进 `readings`。⛔ 不是把「负向对拍」塞进别的话凑数。
     */
    const ok = (m) => readings.push({ label: m.split('\n')[0], exit: 0, want: 0, line: m.split('\n')[0], pass: true })
    const bad = (m) => readings.push({ label: m.split('\n')[0], exit: 1, want: 0, line: m.split('\n')[0], pass: false })

    /** 影子 sink（⛔ 不污染真实计数）。 */
    const sh = { bad: [], ok: [], skip: [] }
    const sink = { bad: (m) => sh.bad.push(m), ok: (m) => sh.ok.push(m), skip: (m) => sh.skip.push(m) }

    /** 夹具：一个账本根，里面造一份"清单声明源修订"的归档目录 + 一个真仓。 */
    const fx2 = mkdtempSync(join(tmpdir(), 'hob-m4-'))
    try {
      const L2 = join(fx2, 'ledger')
      const arc = join(L2, 'archive', '2026-01-20-crossrepo', 'sources')
      mkdirSync(arc, { recursive: true })
      const body = Buffer.from('cross-repo fixture\n')
      writeFileSync(join(arc, 'x.txt'), body)
      /** 源件放在**另一个仓**里（模拟"归档内层仓"），并造一次提交。 */
      const repo2 = join(fx2, 'otherrepo')
      mkdirSync(repo2, { recursive: true })
      const gitq2 = (args) => execFileSync('git', args, { cwd: repo2, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      execFileSync('git', ['init', '-q'], { cwd: repo2 })
      writeFileSync(join(repo2, 'x.txt'), body)
      gitq2(['add', 'x.txt'])
      execFileSync('git', ['-c', 'user.email=f@x', '-c', 'user.name=f', 'commit', '-q', '-m', 'fixture'], { cwd: repo2, stdio: ['ignore', 'pipe', 'ignore'] })
      const goodRev = gitq2(['rev-parse', 'HEAD']).trim()

      /** ⚠ 自证：好 id 在**那个仓**里存在、在**本仓**里不存在（正是跨仓形态）。 */
      /**
       * ⚠ 自证"跨仓形态"：好 id 在**夹具归档仓**（`repo2`）里存在，而在**另一个仓**（`L2`，模拟工作区仓）里不存在。
       *   ⛔ 不拿真 `root` 判 —— 那个仓里本来就没有夹具的提交，永远为 null ⇒ 自证会变成恒真。
       */
      const otherRepo = join(fx2, 'workspacerepo')
      mkdirSync(otherRepo, { recursive: true })
      execFileSync('git', ['init', '-q'], { cwd: otherRepo, stdio: ['ignore', 'pipe', 'ignore'] })
      /** ⚠ `tryGit` 带 `encoding: 'utf8'` ⇒ 返回值**含尾部换行**，比较前必须 `trim()`（否则 `'commit\n' !== 'commit'`）。 */
      const inRepo2 = tryGit(['cat-file', '-t', goodRev], repo2)
      const inOther = tryGit(['cat-file', '-t', goodRev], otherRepo)
      const crossRepoShape = (inRepo2 ?? '').trim() === 'commit' && inOther === null

      /** 好 id（在归档仓里）⇒ 用 `--git-dir` 指过去必须能取到 ⇒ 这是"喂好 id 必绿"。 */
      const reposWith = [{ cwd: repo2, gitDir: null, label: '夹具归档仓' }]
      const got = tryGitBufInRepos(['show', `${goodRev}:x.txt`], reposWith)
      const goodOk = got !== null && got.equals(body)

      /** 坏 id ⇒ 取不到（返回 null，⛔ 不抛、⛔ 不喷 stderr）⇒ 这是"喂坏 id 必红（判据能识别）"。 */
      const badRev = 'ffffffffffffffffffffffffffffffffffffffff'
      const gotBad = tryGitBufInRepos(['show', `${badRev}:x.txt`], reposWith)
      const badNull = gotBad === null

      if (!crossRepoShape) {
        bad('N-M4 · 夹具没造出"跨仓"形态（好 id 在两个仓里的存在性没分开）⇒ 本条不可判')
      } else if (!goodOk) {
        bad(`N-M4 · 喂**好 id**（\`${goodRev.slice(0, 7)}\`，在夹具归档仓里真实存在）却取不到 ⇒ 跨仓取数没生效`)
      } else if (!badNull) {
        bad('N-M4 · 喂**坏 id**（40 个 f）却取到了内容 ⇒ 取数判据哑了（会把不存在当存在）')
      } else {
        ok(`N-M4 ✓ 负向对拍（先自证：好 id \`${goodRev.slice(0, 7)}\` 在**夹具归档仓**里 \`cat-file -t\` = commit、`
          + '在**工作区仓**里取不到 ⇒ 正是 `d391602` 那种跨仓形态）'
          + ` ⇒ 喂**好 id** 经 \`--git-dir\` 指过去**取到了且逐字节相同**（${body.length} 字节）；`
          + '喂**坏 id**（40 个 f）**返回 null**（⛔ 不抛、⛔ 不喷 `fatal:`）'
          + '；**反面**：改前只用工作区仓时，好 id 一律取不到 ⇒ 每份喷一行 `fatal: invalid object name`（实测 13+ 次）'
          + '，判定却仍 EXIT=0 —— 那正是"会让失败不可观测"')
      }
    } finally {
      rmSync(fx2, { recursive: true, force: true })
    }
  }

  // ── 反假绿：把"含 sources/ 的归档目录"整个撤掉 ⇒ 必须走「无对象可查」而不是报 ✓ ──
  rmSync(join(fx.L, 'archive'), { recursive: true, force: true })
  r = runChecks(fx.L, FIXTURE_OPTS)
  /**
   * ⚠ **2026-11-07 修（夹具侧）**：`skip` 第三态（2026-10-21 · 第 349 轮）落地后，
   *   ① 的「无对象可查」已从 `notes`（= ✓ 通过通道）**改走 `skips`**，
   *   而本档还只在 `notes` 里找 ⇒ 恒找不到 ⇒ **恒红**（实测：`skips.length=4`、`notes` 里那句已不在）。
   *   ⇒ 现在两个通道都认。⚠ ⛔ **语义一字未改、强度一字未降**：
   *     仍要求「① 没真跑（`executed === false`）」+「整轮零 bad」+「① **没有**被记成 ✓」+「有一句『无对象可查』」，
   *     四条全中才算过。⛔ 不是"找到就算过"，也⛔ 没把 `notes` 里任何东西豁免。
   */
  const noObjLine = [...r.skips, ...r.notes].find((n) => n.includes('无对象可查'))
  const guardOk = r.a.executed === false && r.bad.length === 0
    && r.notes.every((n) => !n.includes('①'))
    && noObjLine !== undefined
  readings.push({
    label: '反假绿（撤掉全部归档目录 ⇒ 打「无对象可查」，⛔ 不报 ✓）',
    exit: guardOk ? 0 : 1,
    want: 0,
    line: noObjLine ?? '（未打「无对象可查」—— 判据失效）',
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
  /**
   * ⚠ `N-E3` 要自证"白名单里的历史目录**在真账本区里确实没有清单件**"
   *   ⇒ 需要真账本根。读不到就传空串（那条自证会失败并如实报红，⛔ 不静默放过）。
   */
  process.exit(selfTest(resolveLedgerRoot(cliLedger) ?? ''))
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

const { bad, notes, skips, a, c, d } = runChecks(ledgerRoot)
for (const n of notes) console.log('  ✓', n)
/**
 * ⚠⚠ **跳过类单列**（第 349 轮 · 甲方案）：它们**不再出现在上面那堆 `✓` 里**。
 *   ⚠ 前缀用 `·`（与 `check:all` 的"未执行"同一套中性符号），⛔ 不用 `✓`。
 */
for (const k of skips) console.log('  ·', k)
console.log('')
/**
 * ── ⚠⚠ **处级口径（机器可读）**（第 349 轮 · TASK §二 硬要求 3）────────────
 *   `查了 N 处 · 过了 M 处 · 跳过 K 处`
 *   ⚠ `check:all` 按 `查了 N 处` / `跳过 K 处` 两个正则读它（见该文件 `parseSkipCount`）。
 *   ⚠ "查了几处" = 通过数 + 跳过数（**跳过不算过**，但它**是"查过"的一部分**——
 *     它回答的是"这一处我看了、只是没有可查的对象"，与"我没看"不同）。
 */
const checkedTotal = notes.length + skips.length
console.log(`  处级口径：查了 ${checkedTotal} 处 · 过了 ${notes.length} 处 · **跳过 ${skips.length} 处**`
  + `（⚠ 跳过**不计入通过**）`)
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
