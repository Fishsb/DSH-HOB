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
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const EXP = join(root, '.hob', 'EXPERIENCE.md')

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
const bad = (m) => fail.push(m)

if (!existsSync(EXP)) {
  console.error(`✗ 读不到经验库：${EXP}`)
  process.exit(1)
}

const lines = readFileSync(EXP, 'utf8').split('\n')

/** 抽出所有条目的 `{ n, line, body }`（正文 = 本标题行到下一个标题行之间）。 */
const entries = []
for (let i = 0; i < lines.length; i++) {
  const m = HEADING_RE.exec(lines[i])
  if (!m) continue
  entries.push({ n: Number(m[1]), line: i + 1 })
}
for (let k = 0; k < entries.length; k++) {
  const end = k + 1 < entries.length ? entries[k + 1].line - 1 : lines.length
  entries[k].body = lines.slice(entries[k].line - 1, end).join('\n')
}

note.push(`条目标题行 ${entries.length} 条；强制起始号 = E-${String(STRICT_FROM).padStart(2, '0')}`)

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
if (fail.length === 0) {
  console.log('判定：PASS —— 编号唯一且连续，E-' + STRICT_FROM + ' 起的四要素与根因句齐备。')
  console.log('       ⚠ 提示区非空时**不算失败**（旧条目形态，见文件头 ③④ 的口径）。')
  process.exit(0)
} else {
  console.log('判定：FAIL')
  for (const f of fail) console.log('  ✗', f)
  process.exit(1)
}
