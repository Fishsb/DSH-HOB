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
/** ⚠⚠ **包 Q（`CHG-099` 第 4 条）**：账本根解析收成脚本侧唯一实现，本脚本只 import。 */
import { resolveLedgerRoot as resolveLedgerRootShared, looksLikeLedger as looksLikeLedgerShared, workspaceNameOf as wsNameOfShared } from './lib/ledger-root.mjs'

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
/**
 * 「这个目录看起来像不像一份账本」（⚠ 与产品代码 `src/server/doc-read.ts` 的 `looksLikeLedger`
 * **逐条相同** —— 两侧各写一套就是新的漂移点）。
 *
 * 判据：目录在，且**至少有一件**账本特征 —— 正本之一，或**非空的** `volumes/` / `archive/` / `runtime/`。
 * ⚠ **空目录不算**：本项目 `.hob/archive/` 是空的记录层历史位，算进去会把"未迁移"误判成"已迁移"。
 */
const CANON_FILES = ['REQUIREMENTS.md', 'PROJECT.md', 'DECISIONS.md', 'CONTEXT.md']
const SIDE_DIRS = ['volumes', 'archive', 'runtime']
function looksLikeLedger(dir) {
  return looksLikeLedgerShared(dir)
}

/**
 * 账本区根 —— **委托给脚本侧唯一实现**（`scripts/lib/ledger-root.mjs`）。
 * ⚠ **包 Q（`CHG-099` 第 4 条）**：改前这里是本脚本自己写的第 N 份实现
 *   （含"`<工作区>/.hob` 看起来像账本就用它"那一档）—— 账本搬走后它指向不存在的目录。
 * ⚠ **`cliLedger` 那一档保留本脚本原有的额外判据**（必须含 `archive/` 才算数）
 *   —— 那是本脚本**自己的**语义（它要读 `archive/**` 里的报告），⛔ 不是解析漂移。
 */
export function resolveLedgerRoot (cliLedger) {
  if (typeof cliLedger === 'string' && cliLedger !== '') {
    return existsSync(join(cliLedger, 'archive')) ? cliLedger : undefined
  }
  return resolveLedgerRootShared(root, undefined)
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

/**
 * ── **S-12：(甲)(乙)(丙) 三个分支的负向对拍** ─────────────────────────────
 *
 * ⚠ 为什么要补：本族守的是**宪法第 9 条**「没有读数不能陈述为事实」——
 *   本项目最核心的不变量之一。而改前它的强度是：
 *     · **3 处**断言（`ASSERTION_FLOORS` 登记也是 3）；
 *     · **1 条**负向对拍（只验"空归档 ⇒ 退出码 2"）；
 *     · 且强制范围只从 **R208** 起（更早 108 份只统计不 FAIL）。
 *   ⇒ **三个判据分支（甲/乙/丙）一个都没被负向验证过**：
 *     谁把 `(乙)` 的 `INLINE_OUT` 改成恒真，本族照样全绿，而整条判据已经哑了。
 *
 * ⚠ 每条都成对：**该咬的必须咬**、**不该咬的必须不咬** —— 只验前者会漏掉"判据恒红"，
 *   只验后者会漏掉"判据恒绿"。
 *
 * ⚠ 这些断言直接测 `auditReadings`（纯函数），⛔ 不落盘、不依赖 archive 语料 ——
 *   否则它们会随历史报告增减而变，变成"会自己漂的判据"。
 */
export function auditBranchNegctl () {
  const out = []
  const check = (name, src, wantMiss, why) => {
    const got = auditReadings(src).miss.length
    const pass = wantMiss ? got > 0 : got === 0
    out.push({ name, pass, got, wantMiss, why })
  }

  /** ① 甲档：贴了真实输出 ⇒ 不咬。 */
  check('甲档·该放行（贴了输出）', [
    '```', '$ grep -c foo a.ts', '3', '```',
  ].join('\n'), false, '块内有非注释、非 $ 开头的正文行 ⇒ 视为输出')

  /** ② 甲档：**只有注释行** ⇒ 必须咬（这是加严过的那条，最容易被改回去）。 */
  check('甲档·该咬（只有注释行冒充输出）', [
    '```', '$ grep -c foo a.ts', '# 大概是 3 吧', '```',
  ].join('\n'), true, '纯注释行 ⛔ 不算输出 —— 否则写一行说明就能过')

  /** ③ 甲档：**空块**（有读数命令、什么也没跟） ⇒ 必须咬。 */
  check('甲档·该咬（读数命令后什么都没有）', [
    '```', '$ wc -l a.ts', '```',
  ].join('\n'), true, '无输出、无内联、无声明 ⇒ 无法指认')

  /** ④ 乙档：内联给了结果 ⇒ 不咬。 */
  check('乙档·该放行（内联结果）', [
    '```', '$ grep -c foo a.ts → 3', '```',
  ].join('\n'), false, 'INLINE_OUT 命中 ⇒ 可指认')

  /** ⑤ 乙档：内联给了 EXIT= ⇒ 不咬。 */
  check('乙档·该放行（EXIT=）', [
    '```', '$ npm run check:foo', 'EXIT=0', '```',
  ].join('\n'), false, 'EXIT= 命中 ⇒ 可指认')

  /** ⑥ 丙档：块内显式声明 ⇒ 不咬。 */
  check('丙档·该放行（块内声明）', [
    '```', '$ ls /nonexistent', '（空）', '```',
  ].join('\n'), false, 'DECLARED 命中 ⇒ 显式声明了为什么没有输出')

  /** ⑦ 丙档：**声明写在块外** ⇒ 必须咬（窗口只认块内，这是刻意收窄过的）。 */
  check('丙档·该咬（声明在块外）', [
    '下面这个块无输出（见 §3）', '```', '$ ls /nonexistent', '```',
  ].join('\n'), true, '⚠ 声明窗**仅块内** —— 块外的"见 §3"不算（放宽会洗白旧语料）')

  /** ⑧ 动作命令块（不含读数命令） ⇒ 本条不管，不咬。 */
  check('动作块·该放行（没有读数命令）', [
    '```', '$ mkdir -p /tmp/x', '```',
  ].join('\n'), false, '不含 READ_CMD ⇒ 本条不管这类块')

  return out
}

/** 收齐 `<账本根>/archive/**\/REPORT-R<n>.md`（⚠ 按轮号升序）。 */
export function collectReports (ledgerRoot) {
  const out = []
  const arcRoot = join(ledgerRoot, 'archive')
  /**
   * ⚠⚠ **`archive/` 读不到 ⇒ 必须变成可读失败，⛔ 不许让进程崩**（2026-10-21 · 第 322 轮 · **甲-5** ①）——
   *
   * ── 改前是什么──────────────────────────────────────────────────
   *   `readdirSync(arcRoot)` **没有 try/catch** ⇒ 目录不存在时抛 `ENOENT`
   *   （实测原文：`ENOENT: no such file or directory, scandir '…/archive'`）
   *   ⇒ ⚠ 整个脚本带堆栈退出（`exit 1`，但**是 node 的未捕获异常**，不是本脚本的 FAIL 判定）。
   *   ⚠ 为什么这比"红"更糟：本项目对 FAIL 的约定是**逐条可读的 ✗ 行 + 点名对象**
   *     （`E-112`：负向对拍**不只看退出码**，还要有可读的 ✗ 行）。
   *     堆栈里既没有断言名、也没有"覆盖面 = 0 份"这句话 ⇒ 读的人分不清
   *     "**目录没了**"与"**脚本自己坏了**"（后者会让人去查脚本，而 faults 在账本区）。
   *   ⚠ 而 `resolveLedgerRoot()` 只在 **CLI 档**用 `existsSync(join(cliLedger, 'archive'))` 兜了一次；
   *     它**认定"账本根存在"就等于"archive 存在"**（非 CLI 档连这个检查都没有，只 `existsSync(cand)`）。
   *     ⇒ 目录在、`archive/` 不在（或权限不足、或中途被删）就是**裸 ENOENT**。
   *   ⇒ 现在：把"读不到"落成**返回值里的可读失败**（`unreadable`），由调用方判 `exit 2`。
   *   ⚠ 语义为什么是 `exit 2`（"基准缺失"）而**不是** `exit 1`（"查了不过"）：
   *     这里**一份报告都没读到** ⇒ ⛔ "查了不过"无从谈起（一条判据都没跑）——
   *     与本文件既有的"账本区读不到 ⇒ `exit 2`"**同一档**（见下面 main 的分支）。
   *     ⚠ 全族一致：`exit 2` = **没有对象 / 没执行**，`exit 1` = **查了且不过**。
   *   ⚠ ⛔ **不许改成"读不到就返回空数组"** —— 那会与"archive 存在但里面一份报告也没有"
   *     **长得一模一样**，而这两件事的性质完全不同（一个是基准缺失、一个是真的 0 份）。
   *     实测踩过的正是这种"两种原因说成同一句话"（本项目头号禁忌）。
   */
  let ent
  try {
    ent = readdirSync(arcRoot)
  } catch (e) {
    return { reports: out, unreadable: String(e?.message ?? e), arcRoot }
  }
  for (const d of ent) {
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
  return { reports: out.sort((a, b) => a.no - b.no), unreadable: undefined, arcRoot }
}

/**
 * ── **自带负向对拍**（2026-10-21 · 第 322 轮 · **甲-5** 的"补负向对拍"那一半）──────
 *
 * ⚠ **为什么本族必须有它**（TASK 原话）：本族**目前没有任何负向对拍** ——
 *   一条判据若只验"正常路径绿"，它把"0 份 ⇒ 退 2"写成什么都不会被发现。
 *   ⚠ 实测过的形态（本批改前）：空归档 ⇒ 判定 `PASS` + 退出码 **0**，
 *   而**没有任何读数能证明这件事被改过** —— 因为旧版根本没有对这一档的断言。
 *
 * ⚠ **做法：真起子进程跑真 CLI**（⛔ 不 mock、⛔ 不内联复制判据）——
 *   本档要证的正是"**进程退出码**"，那是 `process.exit()` 的行为，
 *   ⛔ 函数级断言证明不了它（改了分支却忘了 `exit` 照样"函数返回值对"）。
 * ⚠ 夹具全部落**工作区内**的临时目录（⛔ 不写 `/tmp`），跑完即删（⛔ 不留残件）。
 * ⚠ 两档**成对**（`E-126`）：
 *   · ① 空归档 ⇒ **必须 2**（该咬的）；
 *   · ② 归档里有一份**干净**报告 ⇒ **必须 0**（不该咬的 —— 证明 ① 不是"一律退 2"）。
 */
async function selfTest () {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { execFileSync } = await import('node:child_process')
  const selfPath = fileURLToPath(import.meta.url)
  /** ⚠ 夹具根落**工作区内**（⛔ 不写 `/tmp`）—— 收工能核 0 残留。 */
  const fxRoot = mkdtempSync(join(root, '.tmp-readings-selftest-'))
  const readings = []
  let failed = 0

  /** 跑一次**真 CLI**，把退出码与 stdout 一起拿回来（⛔ 异常不吞：非预期退出码要能读出来）。 */
  const runOn = (ledger) => {
    try {
      const out = execFileSync(process.execPath, [selfPath, '--ledger', ledger],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      return { code: 0, out }
    } catch (e) {
      return { code: typeof e?.status === 'number' ? e.status : -1, out: String(e?.stdout ?? '') }
    }
  }

  try {
    // ── ① 空归档目录 ⇒ **必须退 2**（甲-5 的正面：改前这里是 PASS + 退出码 0）──
    const empty = join(fxRoot, 'empty')
    mkdirSync(join(empty, 'archive'), { recursive: true })
    const r1 = runOn(empty)
    const ok1 = r1.code === 2
    readings.push({
      label: '① 空归档目录（0 份报告）',
      expect: '退出码 2（"没有对象"，⛔ 不是 0 / 不是 1）',
      got: `退出码 ${r1.code}${ok1 ? '' : ` · 原文「${r1.out.split('\n').filter((l) => l.includes('判定')).join(' ')}」`}`,
      pass: ok1,
    })
    if (!ok1) failed++

    // ── ② 成对：归档里有一份**干净**报告 ⇒ **必须退 0**（证明 ① 不是"一律退 2"）──
    const good = join(fxRoot, 'good')
    mkdirSync(join(good, 'archive', '9999-x'), { recursive: true })
    writeFileSync(join(good, 'archive', '9999-x', 'REPORT-R999.md'),
      '# 轮次报告 999\n\n```\n$ ls\nsrc\n```\n\n结论：贴了输出 ⇒ 可指认。\n', 'utf8')
    const r2 = runOn(good)
    const ok2 = r2.code === 0
    readings.push({
      label: '② 对照：归档里有 1 份干净报告',
      expect: '退出码 0（不该咬的⛔ 不许咬）',
      got: `退出码 ${r2.code}${ok2 ? '' : ` · 原文「${r2.out.split('\n').filter((l) => l.includes('判定')).join(' ')}」`}`,
      pass: ok2,
    })
    if (!ok2) failed++

    // ── ③ 成对：归档目录**不存在** ⇒ 也必须退 2，且**不许是堆栈**（甲-5 ①）──
    const gone = join(fxRoot, 'gone')
    mkdirSync(gone, { recursive: true })
    const r3 = runOn(gone)
    /** ⚠ 判两件事：退出码 2 **且** 输出里有可读的 ✗ 行（⛔ 不是 `ENOENT` 裸堆栈）。 */
    const readable = r3.out.includes('未执行') && r3.out.includes('读不到')
    const noStack = !/^\s+at\s/m.test(r3.out)
    const ok3 = r3.code === 2 && readable && noStack
    readings.push({
      label: '③ `archive/` 不存在（改前是裸 ENOENT 堆栈）',
      expect: '退出码 2 · 有可读"未执行/读不到"行 · 无堆栈',
      got: `退出码 ${r3.code} · 可读行=${readable} · 无堆栈=${noStack}`,
      pass: ok3,
    })
    if (!ok3) failed++
  } finally {
    try { rmSync(fxRoot, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
  }

  /**
   * ⚠ **口径对齐**（B4.1 · 2026-11-10）：上面三档用的是 `readings.push({...})`，
   *   而 `check:meta-negctl` 的计数器只认 `ok/bad/check/note.push/say` 的字符串实参。
   *   ⇒ 本族的负向对拍**一直真实存在，但元规则数不到**，表现为「M-1 说 0 条」。
   *   这里补一条**同语义、符合计数口径**的断言 —— ⛔ 不是新造判据，是把已有事实说出来。
   */
  ok('读数可指认 ✓ **负向对拍**：空归档 ⇒ 退出码必须 2（⛔ 不是 0/1），'
    + '且与「干净报告 ⇒ 退出码 0」成对（证明前者不是一律退 2）')
  console.log('读数可指认自检 · 自带负向对拍')
  for (const x of readings) console.log(`  ${x.pass ? '✓' : '✗'} ${x.label} —— 期望 ${x.expect} · 实测 ${x.got}`)
  const okAll = failed === 0
  console.log('')
  console.log(okAll
    ? `判定：PASS —— ${readings.length} 档**全部符合预期**（⚠ 档数从实测数出来：`
      + `${readings.filter((x) => x.expect.includes('退出码 0')).length} 档"不该咬"未被咬 · `
      + `${readings.filter((x) => x.expect.includes('退出码 2')).length} 档"该咬"真被咬且**退出码对**）`
    : `判定：FAIL —— ${failed}/${readings.length} 档不符（⚠ 判据改哑了）`)
  return okAll ? 0 : 1
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('check-readings-citable.mjs')
  && process.argv.includes('--self-test')) {
  process.exit(await selfTest())
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
  const collected = collectReports(ledgerRoot)
  /**
   * ⚠⚠ **`archive/` 读不到 ⇒ `exit 2`（基准缺失），⛔ 不是崩、也不是 FAIL**（甲-5 ①）——
   *   与上面"账本区读不到 ⇒ `exit 2`"**同一档**，理由见 {@link collectReports} 的注释。
   *   ⚠ 必须在 `reports.length === 0` 那一步**之前**判：两者都"读到 0 份"，
   *     但前者是**没有取数面**、后者是**取数面在而内容空**。⛔ 合并即"两种原因说成一句话"。
   */
  if (collected.unreadable !== undefined) {
    console.log('读数可指认自检 · archive/**/REPORT-R*.md')
    console.log(`账本区：${ledgerRoot}`)
    console.log('')
    console.log('判定：**未执行** —— 归档目录读不到 ⇒ 本检查**不代表通过**（退出码 2 与 FAIL(1) 有意区分）。')
    console.log(`  ✗ 读不到 \`${collected.arcRoot}\` ⇒ ⛔ 不静默跳过、也不让进程崩：`)
    console.log(`      ${collected.unreadable}`)
    console.log('      ⇒ ⚠ 成因：`archive/` 不存在 · 无读权限 · 或账本区路径拼错。')
    console.log('      ⇒ ⚠ 改前这一支是**裸 ENOENT 堆栈**（既没有断言名、也没有覆盖面读数）；'
      + '现在落成可读失败并明确分档。')
    process.exit(2)
  }
  const reports = collected.reports
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
          + '      ⇒ ⚠ 依据：`kit/README.md` §5.1「读数可信」那一行（`E-144`）')
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

  /**
   * ── **S-12：三个判据分支（甲/乙/丙）的负向对拍** ─────────────────────────
   *
   * ⚠ 上面那些是**语料扫描**（报告里有没有不可指认的读数块）；
   *   ⛔ 它们**一个分支都没验到**：谁把 `INLINE_OUT` 改成恒真、
   *   或把「纯注释行不算输出」那条加严改回去，语料扫描**照样全绿**，而整条判据已经哑了。
   * ⇒ 这里逐分支正反双向验证（直接测 `auditReadings` 纯函数，⛔ 不依赖语料）。
   */
  const branch = auditBranchNegctl()
  const branchFailed = branch.filter((x) => !x.pass).length
  note.push(`判据分支负向对拍：**${branch.length - branchFailed}/${branch.length}** 个分支符合预期`
    + (branchFailed > 0 ? ` ⚠ **${branchFailed} 个不符 ⇒ 判据被改哑了**` : '（该咬的咬、该放的放）'))
  for (const n of note) console.log('  ✓', n)
  console.log('')
  /**
   * ⚠⚠ **0 份报告 ⇒ `exit 2`，⛔ 不是 `exit 0`、也⛔ 不是 `exit 1`**（2026-10-21 · 第 322 轮 · **甲-5** ②）——
   *
   * ── 改前是什么（甲-5 的正面）──────────────────────────────────────
   *   `fail.length === 0` ⇒ `PASS` + `exit 0`。而 `fail` 只由**逐份报告**的扫描填充
   *   ⇒ ⚠ **一份报告都没有 ⇒ 循环一次都不跑 ⇒ `fail` 恒空 ⇒ PASS**。
   *   实测读数（空归档夹具）：`报告 0 份 · 判定：PASS`、退出码 **0**。
   *   ⚠ 这正是本批的主题：**"没有对象"与"查过且全绿"被判成同一件事**。
   *   ⇒ 本族的强制面（`STRICT_FROM` 起）可以**整族消失而不响一声** —— 只要 archive 是空的。
   *
   * ── 为什么是 `exit 2` 而不是 `exit 1` ─────────────────────────────
   *   `exit 1` 的语义在本脚本里是"**查了，且查到违规**"（每条 `fail` 都是点名某处）。
   *   0 份报告时**一条判据都没跑** ⇒ ⛔ 说"查了不过"是**谎报**，说"全绿"更是。
   *   它属于**"没有对象 ⇒ 本检查未执行"**那一档 —— 与本文件既有的
   *   "账本区读不到 ⇒ `exit 2`"（`未执行` / `不代表通过`）**同一档**（TASK 明写：⛔ 不是 1）。
   *   ⚠ 两个 `exit 2` 的**成因分开报**（一个说"归档目录读不到"、一个说"0 份报告"），
   *     ⛔ 不合并成一句 —— 读的人据此知道去修什么。
   */
  if (reports.length === 0) {
    console.log(`判定：**未执行** —— 归档目录里**一份报告都没有**（\`${join(ledgerRoot, 'archive')}\`）`
      + ' ⇒ 本检查**一条判据都没跑**，⛔ 不代表通过。')
    console.log(`       ⚠ 退出码 **2**（不是 1）：0 份是"**没有对象**"，不是"**查了不过**"。`)
    console.log('       ⚠ 改前这一支打 `PASS` + `exit 0` —— 于是 R208 起这整族可以**静默消失**。')
    console.log(`       ⇒ 修法：确认 \`archive/**/REPORT-R<n>.md\` 确实存在；`
      + '若账本区刚重建、报告还没迁过来，那是**基准缺失**，先补齐再判。')
    process.exit(2)
  }
  /**
   * ⚠ **处级口径**（2026-10-21 · 第 350 轮 · 甲-1 收尾）：`查了 = 过了 + 跳过`。
   *   ⚠ 本族**没有**"跳过"分支（实测 0 处）⇒ `skip` 恒 0，口径行照样要印。
   *   ⚠ `note` 是查过且过；`fail` **必须进分母**（2026-10-23 · Q-2：查了 = 过了 + 没过 + 跳过。
   *     此前把 `fail` 排除在 `查了` 之外 ⇒ 注入一条 `bad()` 后 exit=1、`✗` 出现，
   *     但「查了 N · 过了 N」一个数不动 —— 失败不进分母，读数就自相矛盾）。
   */
  const skip = []
  /**
   * ⚠ **S-12：分支负向对拍也计入「没过」** —— 否则它们只是打印，不影响退出码，
   *   等于「看着在查、实际不判」（本项目反复记的那类形态）。
   */
  const branchFails = branch.filter((x) => !x.pass)
  console.log(`  处级口径：查了 ${note.length + fail.length + branchFails.length + skip.length} 处 · `
    + `过了 ${note.length} 处`
    + (fail.length + branchFails.length > 0 ? ` · 没过 ${fail.length + branchFails.length} 处` : '')
    + ` · **跳过 ${skip.length} 处**（⚠ 跳过**不计入通过**）`)
  if (fail.length === 0 && branchFails.length === 0) {
    console.log(`判定：PASS —— R${STRICT_FROM} 起的报告里，含读数命令的代码块**全部可指认**`
      + '（贴了输出 / 内联给了结果 / 或显式声明了为什么没有）。')
    console.log(`       ✓ 判据分支负向对拍 ${branch.length}/${branch.length} 通过`
      + '（甲/乙/丙 三个分支都正反双向验过）。')
    console.log('       ⚠ ⛔ 本判据**不判**读数对不对、口径写没写"时点" —— 那些要语义判断。')
    process.exit(0)
  } else {
    console.log('判定：FAIL')
    for (const f of fail) console.log('  ✗', f)
    for (const x of branchFails) {
      console.log(`  ✗ 分支「${x.name}」不符 —— 期望${x.wantMiss ? '咬' : '放行'} · 实测 miss=${x.got}`
        + `（${x.why}）`)
    }
    process.exit(1)
  }
}
