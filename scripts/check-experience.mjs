#!/usr/bin/env node
/**
 * 经验库自检 —— 把「编号唯一 / 编号连续 / 四要素齐备 / 每条有根因」从**人工看**变成**机检**。
 *
 * ══ 断言口径（**不许静默放宽** —— 改本文件前先读完这一节）══════════════════════
 *
 * **① 编号唯一**（全册无重号）—— **全册强制**。
 *    两个条目共用 `E-n` ⇒ 引用（"见 E-85"）**指向不明**，且下一个号会撞。
 *
 * **② 编号连续**（无跳号、无重复）—— **全册强制**。
 *    跳号通常意味着"删条目时没留下墓碑"，也可能意味着"漏写了一条"。
 *    注意 ② 与 ① 是**两条独立判据**：重号会让"连续"检查的区间恰好补齐，
 *    所以**不能**用 ② 代替 ①（判据必须能各自证伪）。
 *
 * **③ 四要素齐备**（`**现象**` / `**根因**` / `**正确做法**` / `**出处**`）
 *    —— 对 **`E-84` 及以后**的条目**强制**；对更早条目**只统计并报告**
 *    （计入下方「提示」区，**不计入失败**）。
 *    ⚠ **不得为凑通过去批量改写旧条目**（本任务书明令）——
 *      旧条目缺标记是**历史形态**（早期若干条把根因写在**现象**段里，未单列标记），
 *      判定"它写没写根因"属于**语义判断**，机检做不到，故**只提示**。
 *
 * **④ 每条必须有「根因」句**（本册既定纪律：不许丢根因）。
 *    ⚠ **口径（必须显式写清，否则就是静默放宽）**：
 *    本判据的**强制范围与 ③ 的强制范围对齐**（`E-84` 及以后），理由是 ③ 已把
 *    `根因` 列为四要素之一，若另立一条"全册强制"的同义判据，则：
 *      · 与 ③ 的"更早条目只提示"**自相矛盾**；
 *      · 会让**既有账本立刻 FAIL**，从而逼迫"为凑通过批改旧条目"——
 *        正是本任务书**明令禁止**的那件事。
 *    ⇒ 但"对齐"**不等于"放宽"**：脚本对**全册**另行统计"缺根因"并**逐条列名**
 *      （见「提示」区的 `缺根因` 一行），只是**旧条目**那份**不计入失败**。
 *      信息**不被隐藏**，只是分级处置 —— 这是本节的**唯一**让步，且写在明处。
 *
 * **⑤ 失败时逐条打印原因与条目编号，`exit 1`；全过 `exit 0`。**
 *
 * ══ 为什么需要它（本项目实测教训）══════════════════════════════════════════
 *   · **E-91**：引用（行号）会随被引用文件漂移 ⇒ 编号本身也需要**机检**兜着；
 *   · 批 7 / 批 10：**数号用窄正则** ⇒ 最大号偏小 ⇒ 撞号（见 `scripts/next-experience-id.mjs`）；
 *   · **E-34 / E-27**：新写的检查**必须做负向对拍**，否则"永远 PASS 的检查"比没有更危险。
 *     ⇒ 本脚本交付时已做 **≥3 组负向对拍**（重号 / 删根因段 / 跳号 ⇒ FAIL；还原 ⇒ PASS），
 *       原始读数见批 11 报告 §3。
 *
 * ══ 与既有脚本的关系（**不得互相影响**）════════════════════════════════════
 * 本脚本**只读** `.hob/EXPERIENCE.md`，**不触碰**以下两处的既有语义：
 *   · `check:presets`（`scripts/check-preset-contracts.mjs`）—— 预设契约；
 *   · `check:gitignore`（`scripts/check-gitignore.mjs`）—— 入库规则。
 * 也**不写**任何文件（含"自动修好"）—— 机检只报，改归人。
 *
 * 用法：
 *   node scripts/check-experience.mjs      （或 npm run check:experience）
 * 退出码：0 = 全通过（提示项允许非空）；1 = 有强制项失败（逐条打印）
 * ⚠ 零第三方依赖（本仓纪律）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const HOB = join(root, '.hob')
const EXP = join(HOB, 'EXPERIENCE.md')

/**
 * ── 扫描面 = 索引 + 条目目录（2026-10-11 第 78 轮 · UD-95 / CHG-032）─────────────
 *
 * **目标形态**：`EXPERIENCE.md` 今后是**索引**（小、每轮必读），条目落
 *   `.hob/experience/<编号>.md`（**一事一文件**，写一次固定）。
 *
 * ⚠ **本轮（机制轮）不建 `.hob/experience/`、不动 `EXPERIENCE.md` 正文** ——
 *   所以这里必须**两种形态都能查**：
 *   · 条目目录**存在** ⇒ 扫描面 = `EXPERIENCE.md` + 目录里每个 `*.md`；
 *   · 条目目录**不存在** ⇒ 扫描面 = `EXPERIENCE.md`（**= 现行为，一字不改**），
 *     并**打印"未执行（条目目录尚未建立），不代表通过"**。
 *
 * ⚠ **为什么不"派生为空即 FAIL"**（区别于 `check-doc-shape.mjs` 的正本清单）：
 *   条目目录缺席是**迁移期的正常态**（本轮明确不建），而索引 `EXPERIENCE.md`
 *   **任何时候都必须存在且非空** —— 后者为空仍然判 FAIL（见下面的前置）。
 *   ⇒ "未执行"只针对**条目目录**那一条（两向完整），**不是**整份自检跳过。
 */
const EXPERIENCE_DIR = join(HOB, 'experience')
const ENTRIES_DIR_EXISTS = existsSync(EXPERIENCE_DIR)
/**
 * ⚠⚠ **乙-2**：条目目录缺席时置 `true`，文件末尾据此走 `exit 2`。
 *   ⚠ 用**独立的那个变量**而不是复用 `!ENTRIES_DIR_EXISTS`：后者描述"盘上事实"，
 *     本变量描述"本次运行判定落哪一档"—— 两者现在一致，但**语义不同**，
 *     将来加别的豁免时不该被这个绑定住。
 */
let ENTRIES_DIR_MISSING = false

/** 扫出条目目录里的 `*.md`（**一层、非递归、只认普通文件、排序稳定**）。 */
function deriveEntryFiles() {
  if (!ENTRIES_DIR_EXISTS) return { files: [], exists: false, reason: `条目目录尚未建立（${EXPERIENCE_DIR}）` }
  let entries = []
  try {
    entries = readdirSync(EXPERIENCE_DIR, { withFileTypes: true })
  } catch (e) {
    return { files: [], exists: true, reason: `条目目录**不可读**：\`${String(e?.message ?? e)}\`` }
  }
  const files = entries
    .filter((d) => d.isFile() && d.name.endsWith('.md'))
    .map((d) => d.name)
    .sort()
  return { files, exists: true, reason: '' }
}

const ENTRY_FILES_RESULT = deriveEntryFiles()

/** **条目标题行**的判据（宽：允许 `### 🔴 E-01`、`#### E-100` 等前缀/层级差异）。 */
const HEADING_RE = /^#{3,4}\s+.*?E-(\d+)\b/

/** 四要素标记。⚠ 用**加粗标记**判定（机检能做的那一层）。 */
const ELEMENTS = [
  ['现象', /\*\*现象/],
  ['根因', /\*\*根因/],
  ['正确做法', /\*\*正确做法/],
  ['出处', /\*\*出处/],
]

/** 四要素与「不许丢根因」的**强制起始号**（更早的只提示）。 */
const STRICT_FROM = 84

const fail = []
const hint = []
const note = []
/**
 * ── ⚠⚠ **第三态 `skip`**（2026-10-21 · 第 350 轮 · 甲-1 收尾）──────────────
 *   本族的三档本来就分离得很清楚，只是**没报同一个口径**：
 *     · `note`  = 查过且过（打 `✓`）        → "过了"
 *     · `fail`  = 查过且不过（打 `✗`）      → **不计入**"查了"（它不是"过"也不是"跳过"）
 *     · `hint`  = 提示区（旧条目形态，⛔ 不算失败）→ ⚠ 也**不算跳过**（它查了、也有对象）
 *   ⚠ 跳过类在本族 = "某一组**没有对象可查**"（如条目目录尚未建立那档走 `exit 2`，
 *     属 `noObject`；组内个别分支没对象时才落这里）。实测本族**没有**这种调用点
 *     ⇒ `skip` 恒空，但口径行必须印（"没有跳过"是读数）。
 */
const skip = []
const noteSkip = (m) => skip.push(m)
const bad = (m) => fail.push(m)

if (!existsSync(EXP)) {
  console.error(`✗ 读不到经验库：${EXP}`)
  process.exit(1)
}

const lines = readFileSync(EXP, 'utf8').split('\n')

/**
 * 抽出所有条目的 `{ n, line, body, from }`（正文 = 本标题行到下一个标题行之间）。
 *
 * ⚠ **第 78 轮（UD-95 / CHG-032）**：扫描面扩为「**索引 + 条目目录**」——
 *   · **索引**（`EXPERIENCE.md`）：照旧按标题行抽条目（现行为，一字不改）；
 *   · **条目目录**（`.hob/experience/*.md`）：**每个文件算一条**（文件名即编号，
 *     `name = <编号>.md`；编号也从正文标题行里抽，两处**都要对得上**）。
 *
 * ⚠ **编号来源的分工**：条目文件的**编号以文件名为准**（那是"一事一文件"的键），
 *   正文标题行里的 `E-<n>` 用于 ③④ 的**四要素**判定与"文件名 ↔ 标题号不一致"的报错。
 *   ⚠ 文件名与标题号不一致 ⇒ **FAIL**（否则"文件叫 E-200、里面写 E-199"会静默）。
 */
const entries = []
for (let i = 0; i < lines.length; i++) {
  const m = HEADING_RE.exec(lines[i])
  if (!m) continue
  entries.push({ n: Number(m[1]), line: i + 1, from: 'EXPERIENCE.md' })
}
for (let k = 0; k < entries.length; k++) {
  const end = k + 1 < entries.length ? entries[k + 1].line - 1 : lines.length
  entries[k].body = lines.slice(entries[k].line - 1, end).join('\n')
}

// 条目目录：一层 *.md，每个文件一条（文件名 = `<编号>.md`）
const entryFileNums = []   // [{ file, num, titleNum, body }]
for (const file of ENTRY_FILES_RESULT.files) {
  const src = readFileSync(join(EXPERIENCE_DIR, file), 'utf8')
  const fm = /^(\d+)\.md$/.exec(file)
  const tm = HEADING_RE.exec(src.split('\n').find((l) => HEADING_RE.test(l)) ?? '')
  entryFileNums.push({
    file,
    num: fm === null ? NaN : Number(fm[1]),
    titleNum: tm === null ? NaN : Number(tm[1]),
    body: src,
  })
}
// ⚠ 文件名不合规 ⇒ FAIL（不是静默忽略）
for (const e of entryFileNums) {
  if (!Number.isFinite(e.num)) {
    bad(`条目目录里的文件名 \`${e.file}\` **不合规** —— 期望 \`<编号>.md\`（如 \`200.md\`）`)
  } else if (!Number.isFinite(e.titleNum)) {
    bad(`条目文件 \`${e.file}\` 正文里**找不到条目标题行**（如 \`### E-200 · …\`）`)
  } else if (e.num !== e.titleNum) {
    bad(`条目文件 \`${e.file}\` 的**文件名与正文编号不一致**：文件名 E-${e.num} · 正文 E-${e.titleNum}`)
  } else {
    entries.push({ n: e.num, line: 1, body: e.body, from: `experience/${e.file}` })
  }
}

note.push(`条目标题行 ${entries.length} 条（索引 ${entries.filter((e) => e.from === 'EXPERIENCE.md').length}`
  + ` · 条目目录 ${entries.filter((e) => e.from !== 'EXPERIENCE.md').length}）`
  + `；强制起始号 = E-${String(STRICT_FROM).padStart(2, '0')}`)

// ── ① 编号唯一 ──────────────────────────────────────────────────────────
{
  const seen = new Map()
  for (const e of entries) {
    if (!seen.has(e.n)) seen.set(e.n, [])
    seen.get(e.n).push(e.line)
  }
  const dups = [...seen.entries()].filter(([, ls]) => ls.length > 1)
  if (dups.length > 0) {
    bad(`① 编号**重号** ${dups.length} 处：`)
    for (const [n, ls] of dups.sort((a, b) => a[0] - b[0])) {
      bad(`     E-${String(n).padStart(2, '0')} 出现在第 ${ls.join(' / ')} 行`)
    }
  } else {
    note.push(`① 编号唯一：${entries.length} 个编号无重号 ✓`)
  }
}

// ── ② 编号连续 ──────────────────────────────────────────────────────────
{
  const nums = [...new Set(entries.map((e) => e.n))].sort((a, b) => a - b)
  if (nums.length === 0) {
    bad('② 经验库里一条条目都没有（标题行 0 条）')
  } else {
    const gaps = []
    for (let n = nums[0]; n <= nums[nums.length - 1]; n++) {
      if (!nums.includes(n)) gaps.push(n)
    }
    if (gaps.length > 0) {
      bad(`② 编号**跳号** ${gaps.length} 处（区间 E-${nums[0]} … E-${nums[nums.length - 1]}）：`
        + ` ${gaps.map((n) => `E-${n}`).join(', ')}`)
    } else {
      note.push(`② 编号连续：E-${nums[0]} … E-${nums[nums.length - 1]} 无跳号 ✓`)
    }
  }
}

// ── ③ 四要素齐备（E-84 起强制）＋ ④ 每条有根因（强制范围与 ③ 对齐，全册另行统计）──
const missingElem = []   // [{n, lack}] —— E-84 起缺任一要素
const noRootStrict = []  // [{n}]        —— E-84 起缺根因（是 missingElem 的子集，单列以便逐条可读）
const noRootAll = []     // [{n}]        —— 全册缺根因（含旧条目，旧条目只提示）
{
  for (const e of entries) {
    const lack = ELEMENTS.filter(([, re]) => !re.test(e.body)).map(([name]) => name)
    const missRoot = lack.includes('根因')
    if (missRoot) noRootAll.push(e.n)
    if (e.n < STRICT_FROM) continue
    if (lack.length > 0) missingElem.push({ n: e.n, lack })
    if (missRoot) noRootStrict.push(e.n)
  }

  if (missingElem.length > 0) {
    bad(`③ 四要素不齐（E-${STRICT_FROM} 起为**强制**）${missingElem.length} 条：`)
    for (const { n, lack } of missingElem.sort((a, b) => a.n - b.n)) {
      bad(`     E-${String(n).padStart(2, '0')} 缺：${lack.join(' / ')}`)
    }
  } else {
    const strictCount = entries.filter((e) => e.n >= STRICT_FROM).length
    note.push(`③ 四要素齐备：E-${STRICT_FROM} 起 ${strictCount} 条全过 ✓`)
  }

  // ④ 与 ③ 的强制范围对齐；但**全册**另行统计，信息不隐藏（见文件头 ④ 的口径）
  if (noRootStrict.length > 0) {
    bad(`④ 缺「根因」（E-${STRICT_FROM} 起为**强制**）${noRootStrict.length} 条：`
      + ` ${noRootStrict.map((n) => `E-${n}`).join(', ')}`)
  } else {
    note.push(`④ 根因句：E-${STRICT_FROM} 起全部在位 ✓`)
  }

  // 提示区：更早条目的四要素缺失（逐条列名，但**不计入失败**）
  const oldLack = entries.filter((e) => e.n < STRICT_FROM)
    .map((e) => ({ n: e.n, lack: ELEMENTS.filter(([, re]) => !re.test(e.body)).map(([nm]) => nm) }))
    .filter((x) => x.lack.length > 0)
  if (oldLack.length > 0) {
    hint.push(`以下 ${oldLack.length} 条**早于 E-${STRICT_FROM}**：四要素不全，**只提示不计失败**`
      + `（本批不得为凑通过去批量改写旧条目）`)
    for (const { n, lack } of oldLack.sort((a, b) => a.n - b.n)) {
      hint.push(`     E-${String(n).padStart(2, '0')} 缺：${lack.join(' / ')}`)
    }
  }
  if (noRootAll.length > oldLack.length) {
    hint.push(`全册「缺根因」共 ${noRootAll.length} 条：${noRootAll.map((n) => `E-${n}`).join(', ')}`
      + `（其中 E-${STRICT_FROM} 起的已在 ④ 计为失败）`)
  }
}

// ── ⑤ 索引与条目目录的**两向完整**（2026-10-11 第 78 轮 · UD-95 / CHG-032）──────
/**
 * **两向**：① 索引里点名（表格「文件」列）的条目**必须真的有对应文件**；
 *   ② 条目目录里每一份 `*.md` **必须在索引里被点名**。
 *
 * ⚠ **条目目录缺席 ⇒ 打印「未执行（条目目录尚未建立），不代表通过」**（迁移期正常态）。
 *   ⚠ 它与 `check-doc-shape.mjs` 的正本清单**口径不同**：那里"派生为空"判 FAIL
 *   （因为正本清单**任何时候都不该为空**）；这里"目录不存在"只表示**还没搬家**。
 *
 * ── 点名面**只认表格「文件」列**（2026-10-11 · 第 83 轮收紧 · R82 复核 D3/D4）──────
 * **改前**：`matchAll(/\bE-(\d+)\b/g)` **通扫整份索引** ⇒ 两类假绿：
 *   · **漏行**：表里删掉某行，只要该编号**在别处出现过**（如头部示例 `` `E-01` → `1.md` ``），
 *     仍算"被点名" ⇒ **PASS**（实测：删 `E-88` 行 ⇒ PASS）；
 *   · **指错行**：某行「文件」列指向**另一条真实存在**的文件（`E-02` → `21.md`）⇒ **PASS**。
 *   ⇒ 通扫 = 判据面**比意图宽**，于是**整类真缺陷被静默放过**。
 * **改后**：只认**表格行最后一格**里反引号包裹的 `*.md`（取 basename）——
 *   与 `check-doc-shape.mjs` 的 L 断言**口径一致**（同类判据在两个脚本里不再分叉）。
 *   ⚠ **加一条正向对账**：行内「编号」列必须与文件名主干一致（`E-02` ↔ `2.md`）——
 *   这一条专治"指错行"（两处都存在、只是对不上号）。
 *   ⚠ 非表格区的 `E-nn` / `<号>.md` 提及**改为提示**（**不是 FAIL**，**0 处也打印**）——
 *   收紧采样面**不许把信息一起收掉**。
 */
/**
 * ══════════════════════════════════════════════════════════════════════
 * ⚠⚠ **乙-2（2026-10-21 · 第 330 轮）：`entryDir` 缺席原先把退出码放过去了**
 * ══════════════════════════════════════════════════════════════════════
 *
 * ── 改前的病灶（`PROJECT-SURVEY-3` §6.2 乙-2）──────────────────────────
 *   这一档只 `note.push(...)`。⚠ 而 `note` **不参与 `fail`** ⇒ 文件末尾那句
 *   `if (fail.length === 0) process.exit(0)` **照样退 0**。
 *   ⇒ ⚠ 于是出现这种自相矛盾：**文字上写着「不代表通过」，退出码却说"通过"**
 *     —— 「读数说的」与「读数凭的」互相打架，而**机器只信退出码**。
 *
 * ── 现在：`exit 2`（⚠ 理由是"**没有对象**"，⛔ 不是"查了不过"）────────────
 *   条目目录不存在 ⇒ **两向完整性对账根本没有对象可对**
 *   （一头是索引表、另一头是目录里的文件；目录没了，这一头为空 ⇒ 无从谈起）。
 *   ⚠ 这与 `0` = "查过且过"、`1` = "查了不过" 都不同：
 *     这里**一条都没查** ⇒ 落在 `2` = "没有对象 / 没执行"。
 *   ⚠ ⛔ 为什么**不**用 `bad`（`exit 1`）：`1` 的语义是"我查了，发现了违规"，
 *     而此刻**没有任何违规被查到** —— 用 `1` 是**谎报**（会让人去查条目内容，
 *     而真正该做的是**把目录建起来**）。⛔ 两种修法完全不同，不许压成同一个码。
 *   ⚠ 与本文件既有的 `--json`/`--fix` 等模式**不冲突**：它们在各分支内早退。
 *   ⚠ 保留 `note` 那两行**照旧打印**（人能看见"为什么跳过"），只是**退出码兑现**。
 */
if (!ENTRIES_DIR_EXISTS) {
  note.push('⑤ 索引两向完整【未执行】—— **条目目录尚未建立**（`.hob/experience/`），'
    + '**不代表通过**')
  note.push(`     原因：${ENTRY_FILES_RESULT.reason}`)
  note.push('     ⚠ 本档**退出码 2**（没有对象 ⇒ 两向对账无从谈起）—— ⛔ 不是 0、也不是 1')
  ENTRIES_DIR_MISSING = true
} else {
  const idxSrc = readFileSync(EXP, 'utf8')
  const namedInIndex = new Set()
  let vBad = 0                   // 正向对账（编号 ↔ 文件名主干）失败数
  const outsiders = []          // 非表格区的提及（提示用）
  let idxTableRows = 0
  idxSrc.split('\n').forEach((ln, li) => {
    const lineNo = li + 1
    const isTable = ln.trimStart().startsWith('|') && ln.trim().endsWith('|')
    if (!isTable) {
      for (const m of ln.matchAll(/\bE-(\d+)\b/g)) outsiders.push({ lineNo, kind: 'E-nn', text: m[0] })
      for (const m of ln.matchAll(/\b(\d+)\.md\b/g)) outsiders.push({ lineNo, kind: '<n>.md', text: m[0] })
      return
    }
    const cells = ln.trim().slice(1, -1).split('|').map((c) => c.trim())
    const isSep = cells.every((c) => /^:?-{2,}:?$/.test(c))
    const isHeader = cells[0] === '编号'
    const last = cells[cells.length - 1] ?? ''
    const inFileCell = [...last.matchAll(/`([A-Za-z0-9._/-]+\.md)`/g)]
      .map((m) => m[1].split('/').pop())
      .filter((nm) => /^\d+\.md$/.test(nm))   // ⚠ 只认 `<数字>.md`（本索引条目文件名口径）
    if (!isSep && !isHeader && inFileCell.length > 0) {
      idxTableRows++
      for (const nm of inFileCell) {
        const stem = Number(nm.replace(/\.md$/, ''))
        namedInIndex.add(stem)
        // 正向对账：编号列 ↔ 文件名主干
        const numCell = (cells[0] ?? '').replace(/`/g, '').replace(/^E-/, '').trim()
        if (numCell !== '' && Number(numCell) !== stem) {
          vBad++
          bad(`⑤ 索引第 ${lineNo} 行**编号与文件名主干不一致**：`
            + `编号列 \`${cells[0]}\` ↔ 文件列 \`${nm}\``
            + '\n      ⇒ 两列必须对得上（`E-02` ↔ `2.md`）—— 否则索引指着一份对不上号的记录')
        }
      }
    } else if (!isSep && !isHeader) {
      // 表格里有内容但文件格没给反引号文件名 ⇒ 记提示
      for (const m of ln.matchAll(/\bE-(\d+)\b/g)) outsiders.push({ lineNo, kind: 'E-nn', text: m[0] })
      for (const m of ln.matchAll(/\b(\d+)\.md\b/g)) outsiders.push({ lineNo, kind: '<n>.md', text: m[0] })
    }
  })
  const onDisk = new Set(entryFileNums.filter((e) => Number.isFinite(e.num)).map((e) => e.num))
  let vBadCount = 0
  // ① 索引点名 ⇒ 文件必须存在
  for (const n of [...namedInIndex].sort((a, b) => a - b)) {
    if (!onDisk.has(n)) {
      vBadCount++
      bad(`⑤ 索引点名了 \`.hob/experience/${n}.md\`，但该文件**不存在**`)
    }
  }
  // ② 文件存在 ⇒ 必须被索引点名
  for (const n of [...onDisk].sort((a, b) => a - b)) {
    if (!namedInIndex.has(n)) {
      vBadCount++
      bad(`⑤ 条目文件 \`.hob/experience/${n}.md\` **没有被索引点名**`
        + `（EXPERIENCE.md 的主题分节表里找不到 \`${n}.md\`）`)
    }
  }
  if (vBad === 0 && vBadCount === 0) {
    note.push(`⑤ 索引两向完整：索引点名 ${namedInIndex.size} 个编号（表格行 ${idxTableRows} 行）`
      + ` · 条目目录 ${onDisk.size} 份，**两向都齐** ✓`)
  }
  // ⚠ 提示（不是 FAIL）：非表格区的提及 —— **0 处也打印**（"没有"与"没查"可区分）
  if (outsiders.length === 0) {
    note.push('⑤ 提示：非表格区（主题分节表之外）的 `E-nn` / `<号>.md` 提及 **0 处**'
      + '（已逐行扫描；点名面 = 表格最后一格的反引号 `<数字>.md`）')
  } else {
    note.push(`⑤ 提示：非表格区的 \`E-nn\` / \`<号>.md\` 提及 **${outsiders.length} 处**`
      + '（**不计入失败**，仅供人工核对是否该改成表格行）：'
      + outsiders.map((o) => `\n        · 第 ${o.lineNo} 行 → ${o.text}`).join(''))
  }
}

// ── ⑥ 并入形态（2026-10-15 · 第 220 轮新增 · `UD-117` 第 ④ 组）───────────────────
/**
 * **背景（第 215 轮实测）**：⚠ 该轮把一条新纪律**并入既有条目 `E-24`**（⛔ 未开新号）⇒
 *   ⚠ ⚠ **上面的「两向完整」（⑤）对账按"文件名 = 编号"做** ⇒ ⚠ **并入段天然不在它的取数面里**，
 *   ⚠ **而本检查照样绿** ⇒ ⚠ 一个"真发生了的落点"**没有任何断言收得住它**。
 *
 * ── 判据（⚠ 只判可判的形态，⛔ 不判"这段写得对不对"）──────────────────────
 *   ⚠ 取数面 = **条目目录里每一份 `.md` 的正文**（⚠ 派生：就是 `entryFileNums` 那一批，
 *   ⛔ 不手抄清单 —— 与 ⑤ 同一个来源，⛔ 不另造一张表）。
 *   ⚠ 识别「并入段头」= ⚠ 行里含 **`并入`** 且含下列之一：
 *     `实测追加` / `并入（` / `并入本条`（⚠ 这三个形态是既有件里**实际在用的**）。
 *   ⚠ **每个段头必须带一个"可检索落点"** = ⚠ 该行（或紧随其后的 3 行）里出现
 *     **`第 <数字> 轮`** 或 **`E-<数字>`**。
 *     ⚠ 理由：⚠ "并入"这个动作**必须能回溯到"哪一轮 / 哪一条"** ——
 *     ⚠ 否则它就是一个**无出处的落点**（⚠ 与 `E-144`"读数须能指认出处"同源）。
 *
 * ── ⚠ 为什么选这个形状（而不是"索引里加一句"）─────────────────────────────
 *   ⚠ 作业书 §2④ 给了两个可选形状，⚠ **本单选 (ii) 其它**，理由**据实**：
 *   ⚠ ⚠ **本单的边界 ⛔ 不许动 `.hob/**`** ⇒ ⚠ **形状 (i)（在索引行里加一句）需要改
 *   `.hob/EXPERIENCE.md`** ⇒ **本单 ⛔ 做不到**。
 *   ⚠ 而 (ii) **只动 `scripts/**`** ⇒ ⚠ **能落地，且判据面覆盖同一件事**：
 *     ⚠ (i) 管的是"索引点到的并入段确实存在"；(ii) 管的是"**每个并入段都有可检索落点**" ——
 *     ⚠ 后者**更靠近**第 ④ 组要防的那个形态（"并入段不在取数面里而检查照样绿"）。
 *   ⚠ ⚠ **残留照实写**：⚠ (ii) **管不到"索引有没有点名它"** ——
 *     ⚠ 那一半要改 `.hob/EXPERIENCE.md`（本单边界外）⇒ ⚠ **见报告 §4 的登记**。
 */
{
  const MERGE_FORMS = ['实测追加', '并入（', '并入本条']
  // ⚠ ⚠ **锚点口径**（第 220 轮当场修正）：⚠ 既有件里的轮次**可能是斜杠/顿号并列的** ——
  //   ⚠ 实测两处：`第 204 / 206 轮` · `第 184 / 185 轮` ⇒ ⚠ 只认"单个号"会造出**两处假红**。
  //   ⚠ 故锚点 = `第 <n>（[/、] <n>）* 轮` 或 `E-<n>`。
  const ANCHOR = /第\s*\d{1,4}(?:\s*[/、]\s*\d{1,4})*\s*轮|\bE-\d{1,3}\b/
  let mergeHeads = 0
  let mergeBad = 0
  const mergeFiles = []
  for (const e of entryFileNums) {
    if (!/^\d+\.md$/.test(e.file)) continue
    const lines = String(e.body).split('\n')
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      if (!l.includes('并入')) continue
      if (!MERGE_FORMS.some((f) => l.includes(f))) continue
      mergeHeads++
      mergeFiles.push(e.file)
      // ⚠ 落点面 = 本行 + 紧随其后的 3 行（既有件里 `凭什么并入` / `出处` 常在同段内换行）
      const win = [l, lines[i + 1] ?? '', lines[i + 2] ?? '', lines[i + 3] ?? ''].join('\n')
      if (!ANCHOR.test(win)) {
        mergeBad++
        bad(`⑥ 并入段**没有可检索的落点**：\`experience/${e.file}\` 第 ${i + 1} 行 ——`
          + `\n        ${l.trim().slice(0, 140)}`
          + '\n      ⇒ ⚠ 形态：行里含「并入」+（`实测追加` / `并入（` / `并入本条`），'
          + '却**这四行内找不到 `第 <数字> 轮` 或 `E-<数字>` 的出处**'
          + '\n      ⇒ ⚠ 并入⛔ 不是"把内容塞进既有条目就完事" —— 它必须能回溯到**哪一轮 / 哪一条**'
          + '（⚠ 与 `E-144`「读数须能指认出处」同源）'
          + '\n      ⇒ 修法：⚠ **在段头那一行或它的「凭什么并入」/「出处」行里写明轮次号**'
          + '（⚠ 例：`**⚠ 同族形态 · 第 216 轮实测追加（并入本条 · ⛔ 未新开条目）**：`）'
          + '\n      ⇒ ⚠ 本组是第 ④ 组「并入形态漏点名时会红」的落地：'
          + '⚠ **原先并入段⛔ 完全不在取数面内**（对账按"文件名 = 编号"做），⚠ 故它漏了也没人报')
      }
    }
  }
  note.push(`⑥ 并入形态（第 220 轮新增）：条目目录 **${entryFileNums.length} 份**里`
    + ` 检出**并入段头 ${mergeHeads} 处**（涉及 ${new Set(mergeFiles).size} 件：`
    + `${[...new Set(mergeFiles)].sort().join(' / ') || '（无）'}）· **无落点的 ${mergeBad} 处**`
    + `\n      ⇒ 识别口径：行含 \`并入\` **且**含 ${MERGE_FORMS.map((f) => `\`${f}\``).join(' / ')}`
    + `；⚠ 落点面 = 该行 + 紧随 3 行，须含 \`第 <数字> 轮\` 或 \`E-<数字>\``
    + `\n      ⇒ ⚠ 这一组补的是：⚠ **并入段原先不在「两向完整」(⑤) 的取数面里**（它按"文件名 = 编号"对账）`
    + `⇒ ⚠ 第 215 轮实测：一条新纪律并入 \`E-24\`（⛔ 未开新号），⚠ **而本检查照样绿**`)
}

// ── 输出 ────────────────────────────────────────────────────────────────
console.log('经验库自检 · .hob/EXPERIENCE.md')
console.log('  强制项：① 编号唯一 · ② 编号连续 · ③ 四要素齐备（E-'
  + STRICT_FROM + ' 起）· ④ 根因句（E-' + STRICT_FROM + ' 起）')
console.log('')
for (const n of note) console.log('  ✓', n)
if (hint.length > 0) {
  console.log('')
  console.log('  ── 提示（**不计入失败**）──')
  for (const h of hint) console.log('     ·', h)
}
console.log('')
/**
 * ⚠⚠ **乙-2 的出口**（2026-10-21 · 第 330 轮）：条目目录缺席 ⇒ `exit 2`。
 *   ⚠ 位置在 `fail.length === 0` **之前**：两者可以同时成立（"必查的那几项都过，
 *     但 ⑤ 那一组没对象"）—— ⛔ 那种情形**不许**判成 `0`（那正是改前的假绿）。
 *   ⚠ `fail.length > 0` 时仍然优先报 FAIL（`exit 1`）：**真的查到违规**比"某组没对象"
 *     更该被先看见（两者都是红，但 `1` 的修法更明确）。
 */
if (fail.length === 0 && ENTRIES_DIR_MISSING) {
  console.log('判定：**未执行** —— 条目目录尚未建立 ⇒ 「索引两向完整」一条都没查'
    + '（退出码 **2**：没有对象，⛔ 不是 0、也不是 1）。')
  console.log('       ⚠ 修法：建 `.hob/experience/` 并放入条目文件（一条一个 `<编号数字>.md`）。')
  console.log('       ⚠ 改前这一档退 **0** —— 文字写着「不代表通过」，退出码却兑现成"通过"。')
  process.exit(2)
}
/**
 * ⚠ **处级口径**（第 350 轮）：`查了 = 过了 + 跳过`。
 *   ⚠ "查了"只算 `note`（真查过且过）+ `skip`（查过但这处没对象）；
 *     `fail` **不进等式**（它是"查了且不过"，由判定行负责）——
 *     ⛔ 不许把它塞进"过了"或"跳过"任一边来凑等式（那正是甲-1 的病）。
 */
console.log(`  处级口径：查了 ${note.length + skip.length} 处 · 过了 ${note.length} 处`
  + ` · **跳过 ${skip.length} 处**（⚠ 跳过**不计入通过**）`)
if (fail.length === 0) {
  console.log('判定：PASS —— 编号唯一且连续，E-' + STRICT_FROM + ' 起的四要素与根因句齐备。')
  console.log('       ⚠ 提示区非空时**不算失败**（旧条目形态，见文件头 ③④ 的口径）。')
  process.exit(0)
} else {
  console.log('判定：FAIL')
  for (const f of fail) console.log('  ✗', f)
  process.exit(1)
}
