#!/usr/bin/env node
/**
 * **`check:regression`** —— 缺陷回归点：让「这条缺陷真的不会再犯吗」成为可复核的断言。
 *
 * ══ 它治的病（缺口有实测出处）══════════════════════════════════════════════
 *   本仓有 112 条历史缺陷，其中 106 条代码确实改过。但「改过」与「再犯时有人拦得住」
 *   是两件事：`docs/audit/business-logic-review/STATUS.md` 自己写着
 *   「本表是人工维护的，没有机检覆盖」「代码改动后本表可能失同步，而这个失同步不会被发现」。
 *   ⇒ `check:audit-status` 的 ⑦ 要求「已修」必须绑到一条**指名它**的断言；
 *     本族就是那类断言的一个**统一落点**：一条缺陷 → 一条可复核的回归点。
 *
 * ══ ⚠ 它证什么、⛔ 不证什么（必须分清，否则就是假绿）════════════════════════
 *   ✅ **contains**：那段修复的**源码形态**还在（`needle` 出现在 `file` 里）。
 *      ⇒ 若有人把它删了/改了，本条当场红，**逼人重核**这条缺陷是否又回来了。
 *   ✅ **count-max**：某种「豁免 / 绕过」形态的出现次数**不超过上限**。
 *      ⇒ 例如 `validateLedgerStructure: false` 只该留 1 处；多长出一处就是新的绕过口。
 *   ⛔ **不证行为正确**：源码形态在 ≠ 逻辑对。行为回归需要另造夹具；
 *      本族的数据里 `kind` 只允许 `contains` / `count-max` 两档（⛔ 不许写「behavior」蒙混）。
 *   ⚠ 这条边界**写在数据文件里**（`scripts/regression-points.json` 的 `note`），
 *     并在这里再说一次 —— 两处都是"读的人第一眼要看的东西"。
 *
 * ══ 为什么每条都要 `guards`（⛔ 不许省）══════════════════════════════════════
 *   一个 `needle` 可以是任意字符串（甚至一个 `const`），那会让本族退化成"有字就算过"。
 *   ⇒ 强制每条写一句**「它消失/变多时，坏在哪」**。这句话不能机检，但它把"能审的东西"
 *     留在数据文件里：reviewer 一眼能看出这条回归点是不是凑数的。
 *   ⚠ 另加两条机检兜底：`needle` 长度 ≥ 12（太短必是凑数）、`defect` 必须在 STATUS.md 里真实存在。
 *
 * 用法：`npm run check:regression`；退出码 0 = 全绿。
 * ⚠ 零第三方依赖（本仓纪律）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const POINTS = join(here, 'regression-points.json')
const STATUS = join(root, 'docs', 'audit', 'business-logic-review', 'STATUS.md')

let pass = 0
let fail = 0
const ok = (m) => { pass++; console.log('  ✓ ' + m) }
const bad = (m) => { fail++; console.log('  ✗ ' + m) }

/** 递归列目录下的文本文件（⚠ 只认源码/脚本后缀，⛔ 不扫 node_modules）。 */
export function walkText(dir, acc = []) {
  let es = []
  try { es = readdirSync(dir, { withFileTypes: true }) } catch { return acc }
  for (const e of es) {
    if (e.name === 'node_modules' || e.name === '.git') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walkText(p, acc)
    else if (e.isFile() && /\.(ts|tsx|mjs|js|json)$/.test(e.name)) acc.push(p)
  }
  return acc
}


/**
 * **剥注释**（⚠ 只用于"数形态出现次数"，⛔ 不改被测文件）。
 *
 * ── 为什么必须有它（实测踩过）────────────────────────────────────────────
 *   本族第一天就踩了：count-max 数 validateLedgerStructure: false，实测 3 处，
 *   而上限是 1 —— 多出来的两处**全在注释里**（一处写着"不再传"，一处写着"T-06：…"）。
 *   ⚠ 把"注释里提到"当成"代码里在用" ⇒ 判据会**逼人删掉解释**，
 *     而解释恰恰是后来人看懂这个豁免为什么只剩一处的唯一线索 ⇒ 那是把判据用反了。
 *
 * ── 口径（⚠ 词法安全，⛔ 不用正则硬剥）────────────────────────────────────
 *   状态机走一遍：单引号 / 双引号 / 模板串（含 `${…}` 里的一层嵌套）里**不剥**，
 *   其余位置的行注释与块注释一律剥成空格（⚠ 换成空格而非删掉：
 *   保留偏移量，「includes()」的语义不变）。
 *
 * @param {string} src - 源码原文
 * @returns {string} 剥掉注释后的文本（长度与原文相同）
 */
/**
 * **只留代码行**（⚠ 用于「数形态出现次数」与「找修复是否还在」，⛔ 不改被测文件）。
 *
 * ── 为什么必须有它（实测踩过 · 2026-11-17）────────────────────────────────
 *   本族第一天就踩了：count-max 数 validateLedgerStructure: false，实测 3 处，而上限是 1 ——
 *   多出来的两处**全在注释里**（一处写「不再传」、一处写「T-06：…」）。
 *   ⚠ 把「注释里提到」当成「代码里在用」⇒ 判据会**逼人删掉解释**，
 *     而解释恰恰是后来人看懂「这个豁免为什么只剩一处」的唯一线索 ⇒ 那是把判据用反了。
 *
 * ── 口径（⚠ 逐行判，⛔ 不做词法级别的注释剥离）────────────────────────
 *   一行**去掉缩进后**以 // 或 * 或 /* 开头 ⇒ 整行按注释剔除。
 *   ⚠ 为什么不做状态机：实测它会被**正则字面量里的引号**带偏（本项目已经踩过一次：
 *     projection-writer.ts 的块注释因此没被剥掉）。逐行判口径简单、可复核、不会静默失效。
 *   ⚠ 代价：行尾注释（`foo() // 提到 xxx`）仍会被算进去 —— 那是**保守方向**（宁可多数，
 *     不愿漏数），且这种写法在本仓几乎没有。
 *
 * @param {string} src - 源码原文
 * @returns {string} 剔除注释行后的文本（行数不变）
 */
export function codeOnly(src) {
  return String(src)
    .split(String.fromCharCode(10))
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join(String.fromCharCode(10))
}

/**
 * 逐点判定（**纯函数**，`read` 可注入以便内存负向对拍）。
 *
 * @param {Array<object>} points - 回归点
 * @param {(abs: string) => string} read - 读文件（读不到返回空串）
 * @param {(abs: string) => string[]} listFiles - 列某目录下的文本文件
 * @returns {{problems: string[], checked: number}} 问题清单与已核条数
 */
export function regressionProblems(points, read, listFiles) {
  const problems = []
  let checked = 0
  for (const p of points) {
    const id = String(p.defect ?? '(no-id)')
    const kind = String(p.kind ?? '')
    if (String(p.guards ?? '').trim() === '') {
      problems.push(`${id}：缺 \`guards\`（「它消失/变多时坏在哪」）⇒ 这条回归点不可审`)
      continue
    }
    if (kind === 'contains') {
      const needle = String(p.needle ?? '')
      if (needle.length < 12) {
        problems.push(`${id}：\`needle\` 太短（${needle.length} 字符）⇒ 必然凑数`)
        continue
      }
      const src = codeOnly(read(join(root, String(p.file ?? ''))))
      if (src === '') { problems.push(`${id}：读不到 \`${p.file}\` ⇒ 判不出（⛔ 不按通过处理）`); continue }
      checked++
      if (!src.includes(needle)) {
        problems.push(`${id}：\`${p.file}\` 里**已找不到**那段修复 ⇒ 这条缺陷可能又回来了`
          + `（应含：${needle.slice(0, 60)}…）`)
      }
    } else if (kind === 'count-max') {
      const needle = String(p.needle ?? '')
      const max = Number(p.max)
      if (!Number.isSafeInteger(max) || max < 0) { problems.push(`${id}：\`max\` 不是非负整数`); continue }
      let n = 0
      const where = []
      for (const d of (Array.isArray(p.dirs) ? p.dirs : [])) {
        for (const f of listFiles(join(root, String(d)))) {
          const src = codeOnly(read(f))
          const hits = src.split(needle).length - 1
          if (hits > 0) { n += hits; where.push(relative(root, f) + '×' + hits) }
        }
      }
      checked++
      if (n > max) {
        problems.push(`${id}：\`${needle}\` 出现 **${n}** 处，上限 ${max} ⇒ 多出来的那几处是新的绕过口`
          + `（${where.join(' · ')}）`)
      }
    } else {
      problems.push(`${id}：\`kind=${kind}\` 不在封闭集（只收 contains / count-max）`)
    }
  }
  return { problems, checked }
}

const txt = (v) => (typeof v === 'string' ? v : '')
const readOr = (abs) => { try { return readFileSync(abs, 'utf8') } catch { return '' } }
const listOr = (dir) => walkText(dir)

let data = { points: [] }
try { data = JSON.parse(readFileSync(POINTS, 'utf8')) } catch {
  bad('读不到 / 解析不了 scripts/regression-points.json ⇒ 本族失去基准（⛔ 不按通过处理）')
}
const points = Array.isArray(data.points) ? data.points : []
if (points.length === 0) bad('regression-points.json 里一条回归点都没有 ⇒ 本族等于不存在（⛔ 不按通过处理）')

// ── R-1 · 每条都指向真实文件（contains 档） ────────────────────────────────
{
  const missing = points
    .filter((p) => p.kind === 'contains')
    .filter((p) => !existsSync(join(root, String(p.file ?? ''))))
  if (missing.length === 0) ok(`R-1 ✓ 每条 \`contains\` 回归点的目标文件都存在（${points.filter((p) => p.kind === 'contains').length} 条）`)
  else for (const p of missing) bad(`R-1 · ${p.defect}：文件不存在 \`${p.file}\` ⇒ 判不出（⛔ 不按通过处理）`)
}

// ── R-2 / R-3 · 逐点判定（contains / count-max） ──────────────────────────
const verdict = regressionProblems(points, readOr, listOr)
if (verdict.problems.length === 0) {
  ok(`R-2/R-3 ✓ **回归点全在位**：${points.length} 条逐条核过 —— `
    + `contains 档的修复形态都在 · count-max 档的次数都没超上限`)
} else for (const x of verdict.problems) bad('R-2/R-3 · ' + x)

// ── R-4 · 回归点必须指向 STATUS.md 里真实存在的缺陷（⛔ 不许幽灵点） ─────────
{
  const statusSrc = readOr(STATUS)
  const ids = new Set([...statusSrc.matchAll(/^\| ([RSTO]-\d{2}) \|/gm)].map((m) => m[1]))
  if (ids.size === 0) bad('R-4 读不到 STATUS.md 的缺陷编号 ⇒ 本判据失去基准（⛔ 不按通过处理）')
  else {
    const ghosts = points.map((p) => String(p.defect ?? '')).filter((d) => !ids.has(d))
    if (ghosts.length === 0) ok(`R-4 ✓ 每条回归点都指向 STATUS.md 里真实存在的缺陷编号（${ids.size} 个编号里查）`)
    else for (const g of ghosts) bad(`R-4 · 回归点 \`${g}\` 在 STATUS.md 里不存在 ⇒ 幽灵点（⛔ 不许给不存在的缺陷编回归点）`)
  }
}

// ── N-R · 负向对拍（⚠ 内存里造夹具，⛔ 不落盘） ────────────────────────────
{
  const first = points.find((p) => p.kind === 'contains')
  const cnt = points.find((p) => p.kind === 'count-max')
  const missed = []
  if (first === undefined) {
    missed.push('没有 contains 档的点可造夹具')
  } else {
    const abs = join(root, String(first.file))
    const src = readOr(abs)
    const needle = String(first.needle)
    /** ① 把 needle 从内容里删掉 ⇒ 必须报红。 */
    const mutated = src.replace(needle, '')
    if (mutated === src) missed.push('夹具没造出「删掉 needle」的形态（内容里根本找不到它）')
    const v1 = regressionProblems([first], (f) => (f === abs ? mutated : readOr(f)), listOr)
    if (v1.problems.length === 0) missed.push('删掉 needle 之后**没有**报红 ⇒ R-2 是恒绿')
    /** ② 反向：原文必须绿（⛔ 不是恒红）。 */
    const v2 = regressionProblems([first], (f) => (f === abs ? src : readOr(f)), listOr)
    if (v2.problems.length !== 0) missed.push('原文**本该绿**却报了红 ⇒ 夹具/判据口径不一致')
    /** ③ guards 清空 ⇒ 必须报红。 */
    const v3 = regressionProblems([{ ...first, guards: '   ' }], readOr, listOr)
    if (v3.problems.length === 0) missed.push('guards 清空之后**没有**报红 ⇒ 「必须写清坏在哪」是空话')
  }
  if (cnt !== undefined) {
    const over = [{ ...cnt, max: -1 }]
    if (regressionProblems(over, readOr, listOr).problems.length === 0) {
      missed.push('把 count-max 的上限压到 -1 之后**没有**报红 ⇒ R-3 不读上限')
    }
  }
  if (missed.length > 0) {
    bad('N-R **负向对拍失败**：' + missed[0] + ' ⇒ 本族是假绿（⛔ 不按通过处理）')
  } else {
    ok('N-R ✓ **负向对拍**（内存里造，⛔ 不落盘）：删掉 needle ⇒ 必红 · 原文 ⇒ 必绿 ·'
      + ' guards 清空 ⇒ 必红 · count-max 上限压到 -1 ⇒ 必红')
  }
}

console.log('')
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处`
  + (fail > 0 ? ` · 没过 ${fail} 处` : '') + ' · **跳过 0 处**（⚠ 跳过**不计入通过**）')
console.log('')
if (fail > 0) {
  console.log('  ⛔ 有失败项 ⇒ 本族不算通过')
  process.exitCode = 1
} else {
  console.log(`  ✅ 回归点全绿（${points.length} 条；⚠ 只证「那段修复的形态还在」，⛔ 不证「行为正确」）`)
  process.exitCode = 0
}
