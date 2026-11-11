#!/usr/bin/env node
/**
 * 审计记录状态表（`docs/audit/business-logic-review/STATUS.md`）的形态机检。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────
 *   `STATUS.md` 是**唯一能直接查「第 N 条修没修」的来源**（112 条一行一编号）。
 *   但它在 `docs/audit/`，**不在** `check-repo-rules` 的三个扫描根内
 *   ⇒ 没有任何判据读它 ⇒ **代码改动后它与实现失同步，而失同步不会被发现**。
 *
 * ── 本判据只查**形态**，⛔ 不查「修得对不对」 ────────────────────────
 *   ① 行数 == 112（与 REVIEW 总表一致）；
 *   ② 每行状态 ∈ 封闭集；
 *   ③ 每行都有非空注记（证据位置或明确说明）；
 *   ④ 编号无重复。
 *
 *   ⚠ 「某条到底修没修」判不了 —— 那需要人读代码。本判据守的是
 *     「这张表**还能被机读**」以及「**没有谁被静默漏掉**」。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const FILE = join(root, 'docs', 'audit', 'business-logic-review', 'STATUS.md')
/** ⚠ 与 `REVIEW.md` 总表一致；改这个数必须同时改总表。 */
const EXPECTED_ROWS = 112
/** ⚠ 状态封闭集：新增状态必须同时改这里**并**在 STATUS.md 里写明含义。 */
const STATUSES = ['已修', '已排除', '部分修', '核心已修', '按设计处理', '未修']

const fail = []
const note = []
const bad = (m) => { fail.push(m); console.log(`  ✗ ${m}`) }
const ok = (m) => { note.push(m); console.log(`  ✓ ${m}`) }

let src = ''
try { src = readFileSync(FILE, 'utf8') } catch {
  bad(`读不到 STATUS.md ⇒ 审计状态表缺失（⛔ 不按通过处理）`)
  console.log('')
  console.log(`处级口径：查了 ${fail.length} 处 · 过了 0 处 · **跳过 0 处**`)
  process.exit(fail.length > 0 ? 1 : 2)
}

const rows = []
for (const line of src.split('\n')) {
  const m = line.match(/^\| ([RSTO]-\d{2}) \| ([^|]+) \| ([^|]*) \|$/);
  if (m !== null) rows.push({ id: m[1], status: m[2].trim(), note: m[3].trim() })
}

/** ① 行数 */
if (rows.length !== EXPECTED_ROWS) {
  bad(`STATUS.md 可解析行数 = ${rows.length}，应为 ${EXPECTED_ROWS}`
    + '\n      ⇒ 可能是格式不规范（缺列 / 少竖线 / 多空格），也可能是漏了条目')
} else ok(`STATUS.md 可解析 **${rows.length}** 行（与 REVIEW 总表一致）`)

/** ④ 重复 */
const seen = new Map()
for (const r of rows) seen.set(r.id, (seen.get(r.id) ?? 0) + 1)
const dup = [...seen.entries()].filter(([, n]) => n > 1).map(([x]) => x)
if (dup.length > 0) bad(`编号重复：${dup.join(' · ')}`)
else ok(`编号无重复（${seen.size} 个）`)

/** ② 状态封闭集 */
const badStatus = rows.filter((r) => !STATUSES.includes(r.status))
if (badStatus.length > 0) {
  bad(`状态不在封闭集：${badStatus.map((r) => `${r.id}=${r.status}`).join(' · ')}`
    + `\n      ⇒ 封闭集 = ${STATUSES.join(' / ')}`)
} else ok(`状态全部在封闭集内（${[...new Set(rows.map((r) => r.status))].join(' / ')}）`)

/** ③ 每行有注记 */
const noNote = rows.filter((r) => r.note === '')
if (noNote.length > 0) {
  bad(`${noNote.length} 行没有注记：${noNote.slice(0, 8).map((r) => r.id).join(' · ')}`
    + '\n      ⇒ 每行必须写证据位置或明确说明（⛔ 不许只有结论）')
} else ok(`**${rows.length}** 行全部有注记（证据位置或明确说明）`)

console.log('')
console.log(`处级口径：查了 ${note.length + fail.length} 处 · 过了 ${note.length} 处`
  + (fail.length > 0 ? ` · 没过 ${fail.length} 处` : '')
  + ' · **跳过 0 处**（⚠ 跳过**不计入通过**）')
console.log('')
if (fail.length > 0) {
  console.log('  ⛔ 有失败项 ⇒ 本族不算通过')
  process.exit(1)
}
console.log('  ✅ 审计状态表形态全绿（⚠ 只证「表可机读且无人被漏掉」，⛔ 不证「每条真修好了」）')
process.exit(0)