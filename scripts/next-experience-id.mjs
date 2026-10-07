#!/usr/bin/env node
/**
 * 取号：输出 `.hob/EXPERIENCE.md` 的**下一个可用编号**（如 `E-92`）。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────
 * 经验库每加一条都要"看当前最大号 +1"。人工做这件事**已实测出错两次**
 * （批 7 / 批 10 记录），根因都是**数号用的正则太窄**：
 *   · 条目标题形如 `### E-03 · …`，但也存在 `### 🔴 E-01 · …`（带状态标记前缀）；
 *   · 窄正则（如 `^### E-(\d+)`）**匹配不到带前缀的那些** ⇒
 *     逐条扫描时**漏掉**它们 ⇒ 算出的"最大号"**偏小** ⇒ **撞号**。
 *   · ⚠ 更阴的一点：`E-03` 这类**不带前缀**的条目**也能匹配窄正则**，
 *     所以窄正则**不是恒错**，它只在"最大号那条恰好带前缀"时才错 ——
 *     于是**本地手测很容易过**，错的是真正要用的那一次（E-91 同族：
 *     "引用/判据没跟着被引用物变"）。
 * ⇒ 本脚本用**宽正则**（见 {@link ENTRY_RE}），并把"漏匹配"这件事
 *   做成**可对账**的（见 `--json` 与 `git` 对账输出），不靠"我看着对"。
 *
 * ── ⚠ 宽正则的口径（判据必须写清，否则无从复验）────────────────────────
 * 匹配**行内任意位置**的 `E-<数字>`，且要求其后紧跟**单词边界**。
 * 这样：
 *   · `### E-03 · …`            ✅ 命中
 *   · `### 🔴 E-01 · …`          ✅ 命中（前缀不影响）
 *   · `#### E-100 · …`           ✅ 命中（不假设标题层级）
 *   · 正文里的互指 `见 E-85`      ✅ 命中 —— **故意的**：见下方"口径"一节
 *   · `EXPERIENCE.md`            ❌ 不命中（`E-` 后必须紧跟数字）
 *
 * ── ⚠ 为什么"正文里的互指"也计入 ──────────────────────────────────────
 * 本脚本的目的是**取一个绝不会撞的号**，不是"数一数有几条条目"。
 * 若正文互指提到一个**比所有条目都大**的号（例如预留/被删除的条目），
 * 那么**采用那个号仍然安全**（不会撞上任何既有内容），而**忽略它则可能撞号**。
 * ⇒ 取"**全文所有 `E-n` 的最大值 + 1**"是**更保守**的判据。
 * ⇒ 因此脚本同时报出两个读数（见输出）：`最大号(全文)` 与 `条目数(标题行)`，
 *   让"保守取号"与"实际条目数"**各自可见**，而不是用一个数糊过去。
 *
 * ── 纯只读（判据）───────────────────────────────────────────────────────
 * 本脚本**只读文件、只写 stdout**：
 *   · 不调用任何写文件的 API（`fs.write*` / `rename` / `mkdir` 全无）；
 *   · 不对 `git` 做任何写操作（只 `git show`）；
 *   · ⇒ **判据**：运行前后
 *       ① `git status --porcelain` 输出不变；
 *       ② `stat -c '%Y'`（mtime）与 `sha256sum` 不变。
 *     三条读数都在报告里给了原始输出（批 11 报告 §3）。
 *
 * ── `git` 对账（本批新增）──────────────────────────────────────────────
 * 只算工作区文件是不够的：工作区可能**领先**于 HEAD（有未提交的新条目），
 * 也可能**落后**（改动被回滚）。⇒ 脚本另取 `git show HEAD:.hob/EXPERIENCE.md`，
 * 算出**那一份**的最大号，与工作区**对账**：
 *   · 一致 ⇒ 打印 `一致`；
 *   · 不一致 ⇒ 打印 `不一致` 并**列出两边的最大号**。
 * ⚠ 对账**不改变**取号结果（取号一律以**工作区**为准 —— 那是你正要写入的文件）；
 *   它只是把"工作区与 HEAD 不同步"这件事**显式暴露**出来。
 *
 * 用法：
 *   node scripts/next-experience-id.mjs             # 人读输出（默认）
 *   node scripts/next-experience-id.mjs --json      # 机读输出（单个 JSON 对象）
 *   npm run exp:next-id
 * 退出码：0 = 正常（即使工作区与 HEAD 不一致也**是 0** —— 那是**读数**不是**错误**）；
 *         1 = 读不到经验库（文件不存在 / 未在 git 仓里）
 * ⚠ 零第三方依赖（本仓纪律）：正则与字符串处理，不引库。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const EXP = join(root, '.hob', 'EXPERIENCE.md')

/**
 * **宽正则**：全文任意位置的 `E-<数字>`（数字后须为词边界）。
 *
 * ⚠ 这是本脚本的**核心判据**，见文件头「宽正则的口径」一节。
 *   窄正则（例如 `^###\s+(?:\S+\s+)?E-(\d+)`）会漏掉**正文互指**，
 *   而正文互指里可能出现更大的号 ⇒ 取号偏小 ⇒ 撞号。
 *   本仓**已两次踩坑**（批 7 / 批 10）：不许改窄。
 */
const ENTRY_RE = /E-(\d+)\b/g

/**
 * **条目标题行**正则（用于**只统计**"有多少条真条目"，**不参与**取号）。
 *
 * ⚠ 与 {@link ENTRY_RE} 是**两个不同用途**的判据，别合并：
 *   · 取号 = 宽正则（保守，宁可大）；
 *   · 计数 = 标题行（严格，只数真条目）。
 * 把两者混用正是"口径不清导致读数不可复验"的来源。
 */
const HEADING_RE = /^###\s+.*?E-\d+\b/gm

/** 从文本里取出所有 `E-n` 的编号。 */
function numbersIn(text) {
  return [...text.matchAll(ENTRY_RE)].map((m) => Number(m[1]))
}

/** 算最大号与条目数；空册时返回 `undefined`（调用方决定怎么报）。 */
function summarize(text) {
  const nums = numbersIn(text)
  const headings = (text.match(HEADING_RE) ?? []).length
  return {
    max: nums.length > 0 ? Math.max(...nums) : undefined,
    total: headings,
    occurrences: nums.length,
  }
}

/** `E-<max+1>`；空册时从 `E-01` 起。 */
function nextId(max) {
  return 'E-' + String((max ?? 0) + 1).padStart(2, '0')
}

/** 取 `git show HEAD:<relpath>`；取不到（非 git 仓 / 未入库）返回 undefined。 */
function headText() {
  try {
    return execFileSync('git', ['show', 'HEAD:.hob/EXPERIENCE.md'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return undefined
  }
}

if (!existsSync(EXP)) {
  console.error(`✗ 读不到经验库：${EXP}`)
  console.error('  （本脚本只读它取号；文件不在 ⇒ 无法判定，退出码 1）')
  process.exit(1)
}

const workText = readFileSync(EXP, 'utf8')
const work = summarize(workText)

const head = headText()
const headSum = head === undefined ? undefined : summarize(head)

// 对账：**只在两边都算得出最大号时**才有意义（空册/无 HEAD 时如实报"无法对账"）
let reconcile
if (headSum === undefined) reconcile = { result: '无法对账', why: '取不到 HEAD 版本（非 git 仓或该文件未入库）' }
else if (headSum.max === undefined) reconcile = { result: '无法对账', why: 'HEAD 版本里没有任何 E-n 编号' }
else if (headSum.max === work.max) reconcile = { result: '一致', headMax: headSum.max, workMax: work.max }
else reconcile = { result: '不一致', headMax: headSum.max, workMax: work.max }

const id = nextId(work.max)

const payload = {
  file: EXP,
  nextId: id,
  workMax: work.max,
  workEntries: work.total,
  workOccurrences: work.occurrences,
  headMax: headSum?.max,
  headEntries: headSum?.total,
  reconcile: reconcile.result,
  reconcileWhy: reconcile.why,
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(payload, null, 2))
} else {
  console.log(`经验库：${EXP}`)
  console.log(`下一个可用编号：${id}`)
  console.log(`当前最大号：${work.max === undefined ? '（无）' : 'E-' + work.max}`)
  console.log(`条目总数（标题行）：${work.total}`)
  console.log(`E-n 出现次数（全文，含正文互指）：${work.occurrences}`)
  console.log(`与 git show HEAD:.hob/EXPERIENCE.md 的对账：${reconcile.result}`
    + (reconcile.why ? `（${reconcile.why}）` : '')
    + (reconcile.result === '不一致' ? ` —— HEAD 最大号 E-${reconcile.headMax}，工作区最大号 E-${reconcile.workMax}` : ''))
  console.log('（只读：本脚本不写任何文件）')
}

// 判据用：把 mtime 一并打给调用方做"运行前后不变"的对照（stderr，不污染 stdout）
console.error(`[readonly-check] mtime=${statSync(EXP).mtimeMs} bytes=${statSync(EXP).size}`)

process.exit(0)
