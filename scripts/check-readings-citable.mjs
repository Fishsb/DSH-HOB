/**
 * 读数可指认自检 · dsh-hob —— **报告里的读数必须指认得出"哪条命令的哪一行输出"**。
 *
 * ── 为什么需要（⚠ 缺口有实测出处）─────────────────────────────────────
 *   `README.md` §5.1「读数可信」那一行自 `E-144` 起就是**口头纪律**：
 *     「凡写读数**必须能指认**『哪条命令的哪一行输出』；指认不出写『未取』，⛔ 不许编排」
 *   —— ⚠ 而它第 3 列长期写着 `未机器化`（⚠ 自述"没人管"）。
 *   ⚠ ⚠ 代价有四处实测：第 115 轮（预写号）· 第 123 / 124 / 128 轮（**读数未跑命令就写下**）
 *   ⇒ **四次都靠自查拦下、⛔ 无机检报红**。
 *   项目自己在 `volumes/plan/11-pending-drafts.md` 第 7 条判过它「**可机检**」：
 *     原话：⚠ **可机检：扫报告里读数与命令对拍**（⚠ 同句也判了"自指那一笔本身不可判" ⇒ ⛔ 本条不管自指）。
 *   ⇒ 本脚本把那一半**真做出来**。
 *
 * ── 判据（⚠ 只判"可判的那一半"，⛔ 不假装能判语义）──────────────────
 *   **可判的那一半** = ⚠ **"一个产出读数的代码块，要么给出输出，要么显式声明为什么没有"**。
 *   逐份报告、逐 fenced code block 判：
 *     ① 该块里**有没有"读数命令"**（`grep` / `wc` / `ls` / `stat` / `git show|diff|log|status` /
 *        `npm run` / `node` / `cat` / `head` / `tail` / `find` / `cmp` / `sed` / `awk`…）——
 *        ⛔ **动作命令**（`mkdir` / `cp` / `rm` / `git add` / `git commit`）**不算读数命令**
 *        （⚠ 它们本就不产出读数 ⇒ 无输出不是缺陷）；
 *     ② 若有，则该块的**合格形态**至少满足其一：
 *        (甲) 块里有**非 `$` 起头的非空行**（= 真贴了输出）；
 *        (乙) 某条 `$` 行**内联带输出**（`→` / `←` / `⇒` / `=` / `#` / `（…）` / `EXIT=` / `:` 后接值）；
 *        (丙) 块内**显式声明**了为什么没有输出（`无输出` / `（空）` / `N/A` / `未取` / `占位` / `见下` / `见 §`）。
 *   ⛔ **不判**：读数**对不对**、口径写没写"时点"、结论对不对 —— ⚠ 那些要**语义判断**，⚠ 本脚本不冒充能判
 *     （⚠ 与 `E-165` 同族：⚠ **"产物里有它" ≠ "实例在真调用里按它服务"**）。
 *
 * ── 强制范围（⚠ 照 `check-experience.mjs` 的先例：**强制起始轮**）────────────
 *   ⚠ 本判据**对 `R208` 及以后**的报告**强制执行**；对更早的**只统计并报告**（⛔ 不 FAIL）。
 *   理由（⚠ 两条，都实测过）：
 *     · ⚠ **历史报告是记录**（"写一次固定"，⚠ `E-152`/判据面禁改）⇒ 追改它们是**伪造历史**；
 *     · ⚠ 本判据的**规范形态是逐轮演化出来的**，⚠ 早期报告用的是"命令块 + 正文里给结论"的写法
 *       （⚠ 实测：`R120`–`R207` 共 `12` 处，⚠ 而 `R208` 起**全绿**）⇒
 *       把早期那 12 处计为 FAIL ⇒ ⚠ ⚠ **这条判据会**恒红**，而恒红的判据等于没有判据**
 *       （⚠ 这正是 `check-repo-rules.mjs` 断言 A 的注释里点过的坑）。
 *
 * ── 覆盖面**自己报**（⚠ 照 `README §5.1` 那条"排除面 / 收录面须自己报"，`E-160` 同族）────
 *   ⚠ 判定行必须报出：**扫了几份报告 / 强制几份 / 豁免几份 / 遇到几个命令块 / 命中几处** ——
 *   防"覆盖面静默缩水而判据照旧绿"。
 *
 * ⚠ **⛔ 不放宽分辨力**：本脚本是**新增**判据（⚠ `UD-130` 的放行边界：只许新增或加严）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { workspaceName as configuredWorkspaceName } from './workspace-name.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

// ⚠ **报告在账本区**（`<ledgerHome>/<工作区名>/archive/**`），⛔ 不在工作区 ——
//   本函数与 `check-archive-consistency.mjs` **同口径**（从预设行读 `ledgerHome`）。
//   ⚠ 读不到 / 不存在 ⇒ 返回 undefined ⇒ **退 2 档**（⛔ 不静默通过）。
function ledgerHome () {
  try {
    const preset = readFileSync(join(root, 'preset', 'dsh-hob', 'preset-dsh-hob.patch.yml'), 'utf8')
    const m = /ledgerHome:\s*(\S+)/.exec(preset)
    return m === null ? null : m[1]
  } catch {
    return null
  }
}

/**
 * 工作区名：⚠ **从配置读**（唯一来源 = `scripts/workspace-name.mjs`）；
 *   未配置 ⇒ 落回**改动前那套**（`DSH_WORKSPACE` 优先，否则取工作区目录名）——
 *   ⛔ 不是新逻辑，也不是放宽：未配置时与改前逐字一致。
 */
function workspaceName () {
  return configuredWorkspaceName(() => {
    const env = process.env.DSH_WORKSPACE
    if (typeof env === 'string' && env.trim() !== '') return basename(env.trim())
    return basename(root)
  })
}

/** 账本区根；⚠ `undefined` ⇒ 读不到（调用方**退 2**，⛔ 不静默）。 */
export function resolveLedgerRoot (cliLedger) {
  if (typeof cliLedger === 'string' && cliLedger !== '') {
    return existsSync(join(cliLedger, 'archive')) ? cliLedger : undefined
  }
  const home = ledgerHome()
  if (home === null) return undefined
  const cand = join(home, workspaceName())
  return existsSync(cand) ? cand : undefined
}

/** 强制起始轮（⚠ 见文件头「强制范围」；⚠ 更早只统计、⛔ 不 FAIL）。 */
export const STRICT_FROM = 208

/** 产出读数的命令（⚠ 动作命令**不在内** —— 它们无输出不是缺陷）。 */
const READ_CMD = /^\s*\$\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:grep|wc|ls|stat|cat|head|tail|find|cmp|diff|sed|awk|sort|uniq|cut|tr|md5sum|sha256sum|du|file|readlink|realpath|basename|dirname|jq|npm run|node|npx|git (?:show|diff|log|status|ls-files|cat-file|rev-parse|ls-tree|grep|describe)|python3?)\b/

/** `$` 行内联带输出的形态（⚠ 用户例：`$ wc -c X → 123`）。 */
const INLINE_OUT = /→|←|⇒|EXIT=|(?<![=!<>])=(?!=)|\s#\s|\s：\s|\s:\s|（|\s\(\s*\d/

/** 块内显式声明"为什么没有输出"。 */
const DECLARED = /无输出|（空）|\(空\)|N\/A|未取|占位|仅示例|见下|见\s*§|此块不|同上|同前|负向样本|故意不给输出/

/**
 * 逐块判一份报告。
 * @returns {{ blocks:number, readBlocks:number, miss:number[] }}
 */
export function auditReadings (src) {
  const lines = src.split('\n')
  /** ⚠ (丙) 的取数面 = ⚠ **仅块内**（⛔ 不搜块外的相邻行）。
   *  ⚠ ⚠ **为什么最终定在"仅块内"**（⚠ 一次实测往返，⛔ 不是拍脑袋）：
   *    ⚠ 我先试过"块内 + 紧邻前后各 1–2 行"的**声明窗** —— ⚠ ⚠ **而它当场把旧语料里的
   *    3 处命中洗白了**（旧报告形态 9 份/15 处 ⇒ 7 份/12 处）⇒ ⚠ ⚠ **那是**放宽分辨力**，
   *    而 `UD-130` 的边界明写"⛔ 不许放宽"** ⇒ ⚠ **撤回窗口，改回仅块内**。
   *  ⚠ 代价（⚠ 照实记）：⚠ 想标注"这个块是负向样本"时，⚠ **声明必须写在块内**
   *    （⚠ 本单的报告就按这条改的 —— ⚠ 见 `REPORT-R225.md` §3.1-f）。 */
  const declWindow = (start, end) => lines.slice(start + 1, end).join('\n')
  let inFence = false
  let cur = []
  let start = 0
  let end = 0
  let blocks = 0
  let readBlocks = 0
  const miss = []
  const flush = () => {
    if (cur.length === 0) return
    blocks++
    const read = cur.filter((l) => READ_CMD.test(l))
    if (read.length === 0) return // ⚠ 动作命令块 ⇒ 本条不管
    readBlocks++
    // ⚠ ⚠ **(甲) 加严**：纯注释行⛔ **不算输出** —— 否则任何块写一行 `# 说明` 就能过。
    //   （⚠ 这是**加严**、⛔ 不是放宽：⚠ 本单最初版把注释行当输出。）
    const body = cur.filter((l) => !/^\s*\$\s/.test(l) && l.trim() !== ''
      && !/^\s*(?:#|\/\/|<!--)/.test(l))
    if (body.length > 0) return                                     // (甲) 贴了输出
    if (read.some((l) => INLINE_OUT.test(l.replace(/^\s*\$\s/, '')))) return // (乙) 内联输出
    if (DECLARED.test(declWindow(start, end))) return               // (丙) 显式声明（⚠ 块内或紧邻窗口）
    miss.push(start + 1)                                            // ⚠ 行号（1-based）
  }
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) {
      if (inFence) { end = i; flush() }
      cur = []
      start = i
      inFence = !inFence
      return
    }
    if (inFence) cur.push(l)
  })
  return { blocks, readBlocks, miss }
}

/** 收齐 `<账本根>/archive/**\/REPORT-R<n>.md`（⚠ 按轮号升序）。 */
export function collectReports (ledgerRoot) {
  const out = []
  const arcRoot = join(ledgerRoot, 'archive')
  for (const d of readdirSync(arcRoot)) {
    const p = join(arcRoot, d)
    let st
    try { st = statSync(p) } catch { continue }
    if (!st.isDirectory()) continue
    for (const f of readdirSync(p)) {
      const m = /^REPORT-R(\d+)\.md$/.exec(f)
      if (m === null) continue
      out.push({ no: Number(m[1]), path: join(p, f), rel: `archive/${d}/${f}` })
    }
  }
  return out.sort((a, b) => a.no - b.no)
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('check-readings-citable.mjs')) {
  const cliIdx = process.argv.indexOf('--ledger')
  const ledgerRoot = resolveLedgerRoot(cliIdx >= 0 ? process.argv[cliIdx + 1] : undefined)
  if (ledgerRoot === undefined) {
    console.log('读数可指认自检 · archive/**/REPORT-R*.md')
    console.log('判定：**未执行** —— 账本区读不到 ⇒ 本检查**不代表通过**（退出码 2 与 FAIL(1) 有意区分）。')
    console.log('       ⚠ 修法：确认预设行的 `ledgerHome` 可读、且 `<ledgerHome>/<工作区名>/` 存在；'
      + '或用 `--ledger <路径>` 显式给。')
    process.exit(2)
  }
  const reports = collectReports(ledgerRoot)
  const fail = []
  const note = []
  let forced = 0
  let exposed = 0
  let allBlocks = 0
  let allReadBlocks = 0
  const legacy = []

  for (const r of reports) {
    let src
    try {
      src = readFileSync(r.path, 'utf8')
    } catch (e) {
      fail.push(`读不到 \`${r.rel}\` ⇒ ⛔ 不静默跳过：${String(e?.message ?? e)}`)
      continue
    }
    const a = auditReadings(src)
    allBlocks += a.blocks
    allReadBlocks += a.readBlocks
    if (r.no >= STRICT_FROM) {
      forced++
      for (const ln of a.miss) {
        fail.push(`${r.rel}:${ln} —— 这个块里有**读数命令**，⚠ 而既没贴输出、`
          + '也没内联给出结果、也没声明"为什么没有"\n'
          + '      ⇒ ⚠ 修法：贴输出 / 写成 `$ 命令 → 结果` / 或显式写「无输出」「未取」\n'
          + '      ⇒ ⚠ 依据：`.hob/README.md` §5.1「读数可信」那一行（`E-144`）')
      }
    } else if (a.miss.length > 0) {
      legacy.push(`${r.rel}（${a.miss.length} 处）`)
    }
  }
  exposed = reports.length - forced

  console.log('读数可指认自检 · archive/**/REPORT-R*.md')
  console.log(`  强制起始轮 = R${STRICT_FROM}（⚠ 更早只统计、⛔ 不 FAIL —— 见文件头「强制范围」）`)
  console.log('')
  note.push(`覆盖面：报告 **${reports.length} 份** · **强制 ${forced} 份**（R${STRICT_FROM} 起）· `
    + `**豁免 ${exposed} 份**（更早）`)
  note.push(`扫描读数：命令块 **${allBlocks} 个**（其中含读数命令的 **${allReadBlocks} 个**）`)
  if (legacy.length > 0) {
    note.push(`⚠ 早期报告里的同类形态 **${legacy.length} 份 / 共 `
      + `${legacy.reduce((s, x) => s + Number(/（(\d+) 处）/.exec(x)[1]), 0)} 处**`
      + `（⛔ 不计入失败 —— 记录层"写一次固定"，追改是伪造历史）`)
  }
  for (const n of note) console.log('  ✓', n)
  console.log('')
  if (fail.length === 0) {
    console.log(`判定：PASS —— R${STRICT_FROM} 起的报告里，含读数命令的代码块**全部可指认**`
      + '（贴了输出 / 内联给了结果 / 或显式声明了为什么没有）。')
    console.log('       ⚠ ⛔ 本判据**不判**读数对不对、口径写没写"时点" —— 那些要语义判断。')
    process.exit(0)
  } else {
    console.log('判定：FAIL')
    for (const f of fail) console.log('  ✗', f)
    process.exit(1)
  }
}
