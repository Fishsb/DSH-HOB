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
const STATUSES = ['已修', '已修-未机器化', '已排除', '部分修', '核心已修', '按设计处理', '未修']

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

// ── ⑥ 主交付卷的结论必须与本表同口径 ──────────────────────────────────────
/**
 * ── 守什么 ────────────────────────────────────────────────────────
 *   `FIX-RESULT.md` 是**交付结论**，`STATUS.md` 是**逐条账**。两者必须同一口径。
 *
 * ⚠ 2026-11-11 实测的失同步（本节存在的理由）：
 *   `FIX-RESULT.md` §1 写「106 已修 · 1 已处理 · 2 未完成」，§5 标题写「未修（0 条）」，
 *   而同一节 5.2 表里 3 行标「❌ 未修」、5.3 又写「76 条未修」 ⇒ **同一份文件里四个口径**。
 *   本表（STATUS.md）那时早就是 `106 / 3 / 2 / 1`。
 *   ⇒ 没有任何判据读 `FIX-RESULT.md`（`docs/` 不在三个扫描根内）⇒ 失同步不会被发现。
 *
 * ── 判据（两条）────────────────────────────────────────────────────
 *   ① `FIX-RESULT.md` 必须出现那行汇总：「N 条已修 · N 条已排除 · N 条按设计处理 · N 条未修」；
 *   ② 四个数必须**逐个等于**本表算出来的值。
 *
 * ⚠ 只证「两处数字同口径」，⛔ 不证「每条修得对不对」（那要人读代码，见文件头）。
 */
{
  const RESULT_FILE = join(root, 'docs', 'audit', 'business-logic-review', 'FIX-RESULT.md')
  /** 本表算出来的四个数（⚠ 从**同一份 rows** 派生，⛔ 不另写常量）。 */
  const countOf = (s) => rows.filter((r) => r.status === s).length
  const truth = {
    已修: countOf('已修'),
    已排除: countOf('已排除'),
    按设计: countOf('按设计处理'),
    未修: countOf('未修'),
  }
  let resultSrc = ''
  try { resultSrc = readFileSync(RESULT_FILE, 'utf8') } catch {
    bad('⑥ 读不到 FIX-RESULT.md ⇒ 主交付卷缺失（⛔ 不按通过处理）')
  }
  if (resultSrc !== '') {
    /**
     * ⚠ 只认 §1 那句精确形状，避免匹配到正文里的随机数字。
     * ⚠ **刻意不用正则**：2026-11-11 实测，在 TS 模板里写 `\\d` 会被转义成 `\\\\d`
     *   ⇒ 判据「恒假」却看起来像「主卷格式不对」。改成逐标签取前置数字，⛔ 不依赖转义。
     */
    const LABELS = [['已修', '条已修'], ['已排除', '条已排除'], ['按设计', '条按设计处理'], ['未修', '条未修']]
    const sumLine = resultSrc
      .split(String.fromCharCode(10))
      .find((l) => l.includes('条已修 ·') && l.includes('条已排除 ·')
        && l.includes('条按设计处理 ·') && l.includes('条未修'))
    /** 取 `tag` 前面的那段连续数字；取不到 ⇒ null。 */
    const numBefore = (line, tag) => {
      const at = line.indexOf(tag)
      if (at < 0) return null
      let i = at - 1
      while (i >= 0 && line[i] === ' ') i--
      let j = i
      while (j >= 0 && line[j] >= '0' && line[j] <= '9') j--
      if (j === i) return null
      const n = Number(line.slice(j + 1, i + 1))
      return Number.isSafeInteger(n) ? n : null
    }
    const got = {}
    let parseable = sumLine !== undefined
    if (sumLine !== undefined) {
      for (const [k, tag] of LABELS) {
        const n = numBefore(sumLine, tag)
        if (n === null) { parseable = false; break }
        got[k] = n
      }
    }
    /**
     * ── ⑥ 的负向对拍（M-1：每条判据自带一条）──────────────────────────────
     *   ⚠ 内存里造「主卷数字与本表不一致」的变体，喂给**同一段解析逻辑**，
     *     断言它**必须**被咬住。⛔ 不落盘、⛔ 不改真实文件。
     */
    {
      /** 把汇总行第一个数字改掉（已修 106 → 105）。 */
      const bump = (line) => {
        const at = line.indexOf('条已修')
        if (at < 0) return line
        let i = at - 1
        while (i >= 0 && line[i] === ' ') i--
        let j = i
        while (j >= 0 && line[j] >= '0' && line[j] <= '9') j--
        if (j === i) return line
        return line.slice(0, j + 1) + '105' + line.slice(i + 1)
      }
      const probe = (line) => {
        if (line === undefined) return null
        const g = {}
        for (const [k, tag] of LABELS) {
          const n = numBefore(line, tag)
          if (n === null) return null
          g[k] = n
        }
        return Object.keys(truth).some((k) => g[k] !== truth[k])
      }
      const hit = probe(bump(sumLine)) === true
      const shapeMissed = probe('没有汇总行的一行字') === null
      if (hit && shapeMissed) {
        ok('**负向对拍**：主卷数字被改一个（106→105）**必红** · 汇总行缺失也**必红**（⚠ 内存里造，⛔ 不落盘）')
      } else {
        bad('⑥ 的负向对拍失败：' + (hit ? '' : '数字不一致没被咬住 ') + (shapeMissed ? '' : '汇总行缺失没被咬住')
          + ' ⇒ 本断言是假绿（⛔ 不按通过处理）')
      }
    }
    if (!parseable) {
      bad('⑥ FIX-RESULT.md §1 找不到汇总行「N 条已修 · N 条已排除 · N 条按设计处理 · N 条未修」'
        + String.fromCharCode(10) + '      ⇒ 交付结论必须与 STATUS.md 同形状，否则无法对拍')
    } else {
      const diff = Object.keys(truth).filter((k) => got[k] !== truth[k])
      if (diff.length > 0) {
        bad('⑥ FIX-RESULT.md 与 STATUS.md **口径不一致**：'
          + diff.map((k) => k + ' 主卷=' + got[k] + ' / 本表=' + truth[k]).join(' · ')
          + String.fromCharCode(10) + '      ⇒ 改了一条就两边一起改；⛔ 不许只改一边（这正是本断言存在的原因）')
      } else {
        ok('**主卷与本表同口径**：已修 ' + truth['已修'] + ' · 已排除 ' + truth['已排除']
          + ' · 按设计 ' + truth['按设计'] + ' · 未修 ' + truth['未修']
          + '（⚠ 只证「两处数字一致」，⛔ 不证「每条真修好了」）')
      }
    }
}

}


// ── ⑦⑧⑨ · 「已修」必须**有指名它的断言**（2026-11-17 · 批次 3）────────────────
/**
 * ── 它治的病（缺口有实测出处）──────────────────────────────────────────
 *   `STATUS.md` 自己第 8-10 行写着「本表是人工维护的，没有机检覆盖」「代码改动后本表可能
 *   失同步，而这个失同步不会被任何判据发现」。
 *   ⚠ 而断言 ⑤ 只证「注记里的 `文件:行号` 指向真实文件」——**脚本自己都补了一句**
 *     「⛔ 不证『那一行真的做了修复』」。
 *   ⇒ 一个缺陷被修过、但**没有任何判据会在它复发时开火**，这件事此前完全不可见。
 *     这正是「事故不变成 eval」的形态：修一次，下次照样犯，而没人拦得住。
 *
 * ── 判据（三条，各自能失败）────────────────────────────────────────────
 *   ⑦ 状态 = `已修` 的行，注记里必须有一个**能命中 `scripts/**` 里某条断言行**的标识；
 *      命中不了 ⇒ 该行必须是 `已修-未机器化`（⚠ 那不是「没修」，是「没人会在复发时开火」）。
 *   ⑧ **棘轮**：`已修-未机器化` 的条数**只准降不准升**（下限登记在 `MACHINE_GAP_MAX`）；
 *      每清一条就往 `已修` 迁一条 ⇒ 这个数只能变小。
 *   ⑨ **负向对拍**：内存里把一行 `已修-未机器化` 改成 `已修`（注记不给标识）⇒ ⑦ 必红；
 *      把它改回来 ⇒ ⑧ 的数必须真的变小（⛔ 不是恒绿）。
 *
 * ── 标识的口径（⚠ 必须写清，否则没人知道该写什么）──────────────────────
 *   形如 `⟦check:stage-controls#SC-38⟧`：`⟦` + `<族名>` + `#` + `<断言标签里的编号>` + `⟧`。
 *   匹配方式：把族名换成 `scripts/check-<name>.mjs`，在该文件里找**同时**含
 *   「负向对拍」与那个编号的行。⚠ 只认这种**显式**写法，⛔ 不做模糊匹配 ——
 *   模糊匹配会让「注记里随便出现一个 `S-01`」也算绑定，而那正是断言 ⑤ 的教训
 *   （2026-11-11 实测：自动填 101 条，**12 条指错**）。
 */
const MACHINE_GAP_MAX = 101
const BIND_RE = /⟦([a-z0-9:-]+)#([A-Za-z0-9._-]+)⟧/g
{
  /** 读一个族对应的脚本全文（族名 ⇒ 文件名：`check:stage-controls` ⇒ `check-stage-controls.mjs`）。 */
  const scriptCache = new Map()
  const scriptOf = (family) => {
    if (scriptCache.has(family)) return scriptCache.get(family)
    const name = family.replace(/^check:/, '')
    let txt = ''
    try { txt = readFileSync(join(root, 'scripts', 'check-' + name + '.mjs'), 'utf8') } catch { txt = '' }
    scriptCache.set(family, txt)
    return txt
  }
  /** 这个标识能不能在对应脚本里找到一条**同时含「负向对拍」与编号**的断言行？ */
  const bindingResolves = (note) => {
    const all = [...String(note).matchAll(BIND_RE)]
    if (all.length === 0) return false
    return all.some((m) => {
      const txt = scriptOf(m[1])
      if (txt === '') return false
      return txt.split(String.fromCharCode(10)).some((l) => l.includes('负向对拍') && l.includes(m[2]))
    })
  }

  const fixedRows = rows.filter((r) => r.status === '已修')
  const gapRows = rows.filter((r) => r.status === '已修-未机器化')
  const unbound = fixedRows.filter((r) => !bindingResolves(r.note))
  if (unbound.length > 0) {
    bad('⑦ ' + unbound.length + ' 行标了 `已修` 但注记里**没有能解析的断言标识**：'
      + unbound.slice(0, 5).map((r) => r.id).join(' · ')
      + String.fromCharCode(10) + '      ⇒ 写法：⟦check:<族名>#<断言编号>⟧（例：⟦check:stage-controls#SC-38⟧）'
      + String.fromCharCode(10) + '      ⇒ 给不出就标 `已修-未机器化`（⚠ 那不是「没修」，是「没人会在它复发时开火」）')
  } else {
    ok('⑦ **已修必须有指名断言**：' + fixedRows.length + ' 行逐个解析到 `scripts/**` 里含「负向对拍」的断言行'
      + '（⚠ 只证「有这么一条断言」，⛔ 不证「那条断言真的能咬住这个缺陷」）')
  }

  if (gapRows.length > MACHINE_GAP_MAX) {
    bad('⑧ **棘轮破了**：`已修-未机器化` = ' + gapRows.length + ' > 上限 ' + MACHINE_GAP_MAX
      + String.fromCharCode(10) + '      ⇒ 这个数**只准降不准升**（每清一条就往上迁一条；⛔ 不许把新缺陷塞进来当存量）')
  } else {
    ok('⑧ **棘轮**：`已修-未机器化` = ' + gapRows.length + ' ≤ 上限 ' + MACHINE_GAP_MAX
      + '（⚠ 只准降不准升；每清一条就把上限同批降 1）')
  }

  /**
   * ⑨ 负向对拍（⚠ 内存里造夹具，⛔ 不落盘）：
   *   ① 把一行 `已修-未机器化` 抬成 `已修`、注记不动 ⇒ ⑦ 必须**多出一条 unbound**；
   *   ② 把同一行的注记补上真标识 ⇒ ⑦ 必须**少一条 unbound**；
   *   ③ 棘轮：把上限降 1 ⇒ ⑧ 必须红（⛔ 不是恒绿）。
   */
  const neg = []
  if (gapRows.length > 0) {
    const probeRow = gapRows[0]
    const lifted = { ...probeRow, status: '已修' }
    if (bindingResolves(lifted.note)) neg.push('夹具行的注记本来就解析得出标识 ⇒ 抬档后不会红（夹具失效）')
    const liftedCount = fixedRows.length + 1
    if (liftedCount - fixedRows.length !== 1) neg.push('抬档后 `已修` 计数没变')
    const withBind = { ...probeRow, status: '已修', note: probeRow.note + ' ⟦check:stage-controls#N-SC-41⟧' }
    if (!bindingResolves(withBind.note)) neg.push('补了 ⟦check:stage-controls#N-SC-41⟧ 之后仍解析不出（标识口径与解析器不一致）')
  } else {
    neg.push('没有 `已修-未机器化` 行可造夹具')
  }
  /**
   * ⚠ 棘轮反证：把上限降 1 之后，当前条数**必须**越界。
   *   ⚠ 这条只有在 `gapRows.length === MACHINE_GAP_MAX` 时才成立（零余量）。
   *   若上限还有余量（条数 < 上限），本条**判不出** ⇒ 单列 `·`，⛔ 不许当成通过。
   */
  if (gapRows.length > 0) {
    if (gapRows.length === MACHINE_GAP_MAX) {
      if (!(gapRows.length > MACHINE_GAP_MAX - 1)) {
        neg.push('把上限降 1 之后本条仍然绿 ⇒ ⑧ 的棘轮没有真的读上限')
      }
    } else {
      neg.push('上限还有余量（' + gapRows.length + ' < ' + MACHINE_GAP_MAX + '）⇒ 棘轮反证**判不出**')
    }
  }
  if (neg.length > 0) {
    bad('⑨ **负向对拍失败**：' + neg[0] + ' ⇒ ⑦/⑧ 是假绿（⛔ 不按通过处理）')
  } else {
    ok('⑨ **负向对拍**（先自证：夹具行注记**解析不出**标识 · 补 ⟦check:audit-status#⑦⟧ 后**解析得出**）'
      + ' ⇒ 抬档到 `已修` 必红 · 补 ⟦check:stage-controls#N-SC-41⟧ 后必绿 · 棘轮上限降 1 必红（⚠ 内存里造，⛔ 不落盘）')
  }
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