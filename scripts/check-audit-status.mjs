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
/**
 * ── 负向对拍（M-1 元规则：每条判据必须自带一条）────────────────────────
 *
 * ⚠ **不能用「删掉文件」来对拍** —— 那会让 readFileSync 抛错走进「读不到」分支，
 *   而那条分支测的是「文件缺失」，⛔ 不是「表格形态坏了」。
 *
 * ⇒ 方式：拿**当前文件内容**在内存里造三份「必错」变体，
 *   逐一喂给同一个解析函数，断言它们**必须**被同一个判据咬住。⛔ 不落盘。
 */
const parseRows = (text) => {
  const out = []
  for (const line of text.split(String.fromCharCode(10))) {
    const m = line.match(/^\| ([RSTO]-\d{2}) \| ([^|]+) \| ([^|]*) \|$/)
    if (m !== null) out.push({ id: m[1], status: m[2].trim(), note: m[3].trim() })
  }
  return out
}
{
  const dropRow = src.replace(/^\| [RSTO]-\d{2} \| [^|]+ \| [^|]* \|\n/m, "")
  const badStatusV = src.replace(/^(\| [RSTO]-\d{2} \| )[^|]+( \|)/m, "$1乱写的状态$2")
  const emptyNoteV = src.replace(/^(\| [RSTO]-\d{2} \| [^|]+ \| )[^|]+( \|)$/m, "$1$2")
  const hits = {
    "少一行": parseRows(dropRow).length !== EXPECTED_ROWS,
    "状态越界": parseRows(badStatusV).some((x) => !STATUSES.includes(x.status)),
    "注记清空": parseRows(emptyNoteV).some((x) => x.note === ""),
  }
  const missed = Object.entries(hits).filter(([, hit]) => hit !== true).map(([k]) => k)
  if (missed.length > 0) {
    bad(`负向对拍失败：${missed[0]} 的变体**没有被咬住**`
      + " ⇒ 本族的判据是假绿（⛔ 不按通过处理）")
  } else {
    ok("**负向对拍**：少一行 / 状态越界 / 注记清空 三种必错变体**逐个被咬住**（⚠ 内存里造，⛔ 不落盘）")
  }
}

// ── ⑤ 证据位置必须指向真实文件，且行号不越界 ──────────────────────────────
/**
 * ── 守什么 ────────────────────────────────────────────────────────
 *   STATUS.md 的「注记」列大量写 `文件:行号`。它是**人读证据**，也是唯一能
 *   反查「改在哪」的东西 —— 如果它指向不存在的文件，这张表就失去可核性。
 *
 * ⚠ 2026-11-11 实测：100 处可验证引用，0 处缺失、0 处行号越界。
 *   （⚠ 首次检查用错了正则 —— `ts|tsx` 顺序导致 `.tsx` 被截成 `.ts`，
 *     报出 23 处假缺失。修正为 `tsx|ts` 后才得到真实结果。）
 *
 * ── 判据 ──────────────────────────────────────────────────────────
 *   ① 引用的文件必须存在（⚠ 允许省略目录的简写，用 basename 兜底查找）；
 *   ② 若带行号，该行号不得超出文件总行数。
 *
 * ⚠ 只证「位置指向真实文件」，⛔ 不证「那一行真的做了修复」。
 */
{
  const { readFileSync: rfA, existsSync: exA } = await import('node:fs')
  const { join: pjA } = await import('node:path')
  const { execSync: exA2 } = await import('node:child_process')
  /** ⚠ 正则顺序必须是 tsx 在 ts 前（否则 `.tsx` 被截成 `.ts`）。 */
  const REF_RE = /`?([a-zA-Z0-9_./-]+\.(?:tsx|ts|mjs|json|md))(?::(\d+))?`?/g
  /** 全仓文件索引（按 basename 兜底简写）。 */
  const allFiles = (() => {
    try {
      return exA2('git ls-files', { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
    } catch { return [] }
  })()
  const byBase = new Map()
  for (const f of allFiles) {
    const b = f.split('/').pop()
    if (!byBase.has(b)) byBase.set(b, [])
    byBase.get(b).push(f)
  }
  const p = []
  let verified = 0
  for (const row of parseRows(src)) {
    if (row.note === '') continue
    REF_RE.lastIndex = 0
    const seen = new Set()
    let m
    while ((m = REF_RE.exec(row.note)) !== null) {
      const raw = m[1]
      const ln = m[2]
      if (seen.has(raw)) continue
      seen.add(raw)
      /** ① 先按字面路径找，再按 basename 兜底（允许 `stage-controls.ts` 这种简写）。 */
      let rel = raw
      if (!exA(pjA(root, rel))) {
        const cands = byBase.get(raw.split('/').pop()) ?? []
        if (cands.length === 0) { p.push(`${row.id} · 引用的文件不存在：${raw}`); continue }
        rel = cands[0]
      }
      /** ② 行号不越界。 */
      if (ln !== undefined) {
        const total = rfA(pjA(root, rel), 'utf8').split('\n').length
        if (Number(ln) > total) { p.push(`${row.id} · 行号越界：${raw}:${ln}（文件仅 ${total} 行）`); continue }
      }
      verified++
    }
  }
  if (p.length === 0) {
    ok(`**证据位置可核**：${verified} 处引用全部指向真实文件，行号无越界`
      + '（⚠ 只证「位置存在」，⛔ 不证「那一行真做了修复」）')
  } else for (const x of p.slice(0, 5)) bad('⑤ ' + x)
}

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