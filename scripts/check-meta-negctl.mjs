#!/usr/bin/env node
/**
 * **M-1 · 元规则机检**：每条判据都必须自带一条**负向对拍**（造必错夹具 ⇒ 它必须当场红）。
 *
 * ══ 它治的病（`TASK-P6.md` §二 · P5 实测）══════════════════════════════════════
 *   P5 清点时发现：**24 个脚本提到「负向对拍」，但没有一条断言在数「到底配没配」**。
 *   ⇒ 那条元规则是**纯纪律** —— 删族时最容易被连带丢掉，而且**丢了不会红**。
 *   ⇒ 本模块把它变成可数、可比的读数。
 *
 * ══ 口径（⚠ 必须先说清，否则数字没法复核）══════════════════════════════════════
 *   ① **数的是"打出来的标签"**，不是注释里的字：
 *      只扫 `ok(...)` / `bad(...)` 的第一个字符串字面量里含 `负向对拍` 的那些 ——
 *      ⚠ 注释里写"要有负向对拍"**不算**（那正是假的来源）。
 *      ⚠ 2026-11-10 · S-16：本模块此前**没做到**这一条（注释 / 字符串里的"假调用"照样被数）。
 *        现在先做**词法安全的剥注释**（行注释 / 块注释 / JSDoc / 正则 / 引号串 / 模板串），
 *        并且只数"代码位置"的调用 ⇒ 字符串字面量里的假调用计 **0**（判据见 N-M1c / N-M1d）。
 *   ② **沿 import 闭包数**（`from './x.mjs'` 递归）：
 *      一个族可能把判据拆在多个文件里（`check:gitignore` 就 import 了 4 个模块）。
 *   ③ 与**登记表**（`scripts/meta-negative-floor.json`）比：
 *      **实测 < 登记下限 ⇒ 红**（⛔ 不许为了绿而下调下限）。
 *
 * ══ 自指（⚠ 这一条是本模块的"牙"）═════════════════════════════════════════════
 *   `runNegativeCoverage` 接一个 `overrideCounts` —— 负向对拍**把某族的计数压到 0**，
 *   若 M-1 不红，就说明它数的是"登记表"而不是"实测"。
 *
 * @module check-meta-negctl
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')
export const FLOOR_PATH = join(here, 'meta-negative-floor.json')
/** 「先自证」标记的登记表（M-1b 用；⚠ 与 M-1 的下限表分开，两者口径不同）。 */
export const SELFPROOF_PATH = join(here, 'meta-selfproof-floor.json')

/**
 * 匹配**一条断言调用**的第一个字符串字面量（模板串或普通串）。
 *
 * ⚠ 覆盖五种既有写法（2026-10-30 P7 从 2 种扩到 4 种 · 2026-11-10 B4.1 扩到 5 种）：
 *   `ok(` / `bad(` —— 主流两族（`check:gitignore` 等）；
 *   `note.push(` —— `check:experience` 的"查过且过"通道；
 *   `check(` —— `module-independence-probe` / `check-orch-state` 的通道；
 *   **`say(` —— `check:build-sync` / `check-profile-assembly` / `probe-selfwake-e2e` 的通道**。
 * ⚠ **为什么要扩**：P7 给 `check:experience` 与 `check:modules` 各补了一条负向对拍，
 *   但它们用的不是 `ok(...)` ⇒ 旧口径**数不到**，表现为"补了但 M-1 还说 0 条"。
 *   ⚠ 那是**口径漏了写法**，不是"补的对拍不存在"—— 扩口径（⛔ 不是把对拍改写成 `ok()` 去迎合）。
 *   ⚠ 代价：历史上这几族的读数会一起变高（口径更宽）⇒ 登记表同批抬，符合"只准升"。
 *
 * ⚠⚠ **`say(` 的形参位置不同**（2026-11-10 B4.1 实测）：
 *   三族的 `say` 签名都是 `say(pass, line, why)` ⇒ **标签在第二个实参**，
 *   而 `ok/bad/note.push/check` 的标签在**第一个**。
 *   ⚠ 若只把 `say` 加进上面的备选分支，会数到**第一个实参**（通常是布尔变量 `ok`）⇒ 仍然 0 条。
 *   ⇒ 单独一条正则：`say(` 后跳过第一个实参（到逗号为止），再取第二个字符串字面量。
 */
const CALL_LIT_RE = /(?:ok|bad|note\.push|check)\(\s*(?:`([^`]*)`|'([^']*)')/gs

/**
 * `say(pass, line, why)` 通道：标签在**第二个**实参。
 *
 * ⚠ 第一个实参可能是 `ok` / `stillUndecidable && positive.verdict === 'lagging'` 这类表达式，
 *   里面**可能含逗号**（如 `f(a, b)`）⇒ 简单 `[^,]*` 会截断。
 *   本仓实测三族的第一个实参**都没有嵌套逗号**（只有 `&&` / `===` / 标识符），
 *   但为稳妥仍允许一层括号：先尝试"到第一个顶层逗号"，匹配不到再退回宽松写法。
 */
const SAY_LIT_RE = /\bsay\(\s*[^,()]*(?:\([^()]*\))?[^,()]*,\s*(?:`([^`]*)`|'([^']*)')/gs

// ── 词法安全的注释剥离（S-16 · 2026-11-10）──────────────────────────────────────
// 旧实现直接对**原文**跑 CALL_LIT_RE ⇒ 下面五种写法全被数成 1 条：
//   ① 真标签                 bad('负向对拍：改坏实现 ⇒ 必须红')            → 应为 1
//   ② 行注释                 // bad('负向对拍：…')                          → 应为 0
//   ③ 块注释 / JSDoc         /* ok('负向对拍：…') */                        → 应为 0
//   ④ 字符串字面量里的假调用 const s = "bad('负向对拍：…')"                 → 应为 0
//   ⑤ 模板串里的假调用       const t = `x bad('负向对拍：…')`         → 应为 0
// ⇒ 于是"把一条会红的对拍注释掉（加两个斜杠）"照旧全绿：M-1 可以被绕过（S-16）。
//
// 修法：先做一遍**只标记、不改语义**的词法扫描，再只在"代码位置"认调用：
//   · 注释整段换成**等量空格**（换行原样保留 ⇒ 行号 / 偏移不变），mask = 0；
//   · 单引号串 / 双引号串 / 模板串（含 ${} 插值里的注释，递归处理）/ 正则字面量整段 mask = 0；
//   · 其余位置 mask = 1。
// 三条边界（缺一不可）：
//   (a) 字符串里的 `//`、`/*` 不能被当注释（含 URL 'https://e.com//x'、正则 /[/*]/）；
//   (b) 模板串必须**整段**跳过：多行模板里的 `//` 不是注释；不能"遇换行就 break"；
//   (c) JSDoc 与块注释同语法，整块剥离。
// ⚠ 正则识别是**启发式**（看 `/` 前一个有效字符 / 关键字）；本仓实测：
//   "加正则识别"与"不加"逐族读数完全一致 ⇒ 不会吃掉真标签；唯一差异族是本族自身（4 → 3）。
const BACKTICK = '\u0060'
/** `/` 的前一个有效字符属于这些 ⇒ 它是正则字面量（而不是除号）。 */
const REGEX_PREV_CHARS = new Set(['(', '[', '{', ',', ';', '=', ':', '!', '&', '|', '?', '+', '-', '*', '%', '<', '>', '~', '^'])
/** 同上，但前一个 token 是关键字（`return /re/` / `typeof /re/` …）。 */
const REGEX_PREV_WORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'case', 'yield', 'await', 'do', 'else'])

/**
 * 剥注释（**保留行号与偏移**），并给出"该位置是不是代码"的掩码。
 *
 * @param {string} src - 源文本
 * @returns {{code: string, mask: Uint8Array}} `code` 与入参**等长**（注释换成空格、换行保留）；`mask[k] === 1` ⇒ 原文第 k 个字符在代码位置（不在注释 / 字符串 / 模板串 / 正则里）
 */
export function stripCommentsKeepLines(src) {
  const text = String(src ?? '')
  const n = text.length
  const out = Array.from(text)
  const mask = new Uint8Array(n)
  mask.fill(1)
  const blankRange = (a, b) => { for (let k = a; k < b && k < n; k++) { if (out[k] !== '\n') out[k] = ' '; mask[k] = 0 } }
  const hideRange = (a, b) => { for (let k = a; k < b && k < n; k++) mask[k] = 0 }
  const prevSignificant = (i) => { let b = i - 1; while (b >= 0 && /\s/.test(out[b])) b--; return b }
  const regexAllowed = (i) => {
    const b = prevSignificant(i)
    if (b < 0) return true
    const ch = out[b]
    if (REGEX_PREV_CHARS.has(ch)) return true
    if (!/[A-Za-z0-9_$]/.test(ch)) return false
    let s = b
    while (s >= 0 && /[A-Za-z0-9_$]/.test(out[s])) s--
    return REGEX_PREV_WORDS.has(out.slice(s + 1, b + 1).join(''))
  }
  const scanQuoted = (start) => {
    const q = out[start]
    let j = start + 1
    while (j < n) {
      const c = out[j]
      if (c === '\\') { j += 2; continue }
      if (c === q) { j++; break }
      if (c === '\n') break
      j++
    }
    hideRange(start, j)
    return j
  }
  const scanTemplate = (start) => {
    mask[start] = 0
    let j = start + 1
    while (j < n) {
      const c = out[j]
      if (c === '\\') { mask[j] = 0; if (j + 1 < n) mask[j + 1] = 0; j += 2; continue }
      if (c === BACKTICK) { mask[j] = 0; return j + 1 }
      if (c === '$' && out[j + 1] === '{') { mask[j] = 0; mask[j + 1] = 0; j = scanBraced(j + 2); continue }
      mask[j] = 0
      j++
    }
    return n
  }
  const scanRegex = (start) => {
    let j = start + 1
    let inClass = false
    while (j < n) {
      const c = out[j]
      if (c === '\\') { j += 2; continue }
      if (c === '\n') break
      if (c === '[') { inClass = true; j++; continue }
      if (c === ']') { inClass = false; j++; continue }
      if (!inClass && c === '/') { j++; break }
      j++
    }
    while (j < n && /[a-z]/i.test(out[j])) j++
    hideRange(start, j)
    return j
  }
  /** 扫描 ${...} 里的代码，直到与开头配对的 }（返回其后的位置）。 */
  function scanBraced(start) {
    let depth = 1
    let j = start
    while (j < n) {
      const c = out[j]
      if (c === '/' && out[j + 1] === '/') { let e = j + 2; while (e < n && out[e] !== '\n') e++; blankRange(j, e); j = e; continue }
      if (c === '/' && out[j + 1] === '*') { let e = j + 2; while (e < n && !(out[e] === '*' && out[e + 1] === '/')) e++; e = Math.min(e + 2, n); blankRange(j, e); j = e; continue }
      if (c === '"' || c === "'") { j = scanQuoted(j); continue }
      if (c === BACKTICK) { j = scanTemplate(j); continue }
      if (c === '/' && regexAllowed(j)) { j = scanRegex(j); continue }
      if (c === '{') { depth++; j++; continue }
      if (c === '}') { depth--; j++; if (depth === 0) return j; continue }
      j++
    }
    return n
  }
  let i = 0
  while (i < n) {
    const c = out[i]
    if (c === '/' && out[i + 1] === '/') { let e = i + 2; while (e < n && out[e] !== '\n') e++; blankRange(i, e); i = e; continue }
    if (c === '/' && out[i + 1] === '*') { let e = i + 2; while (e < n && !(out[e] === '*' && out[e + 1] === '/')) e++; e = Math.min(e + 2, n); blankRange(i, e); i = e; continue }
    if (c === '"' || c === "'") { i = scanQuoted(i); continue }
    if (c === BACKTICK) { i = scanTemplate(i); continue }
    if (c === '/' && regexAllowed(i)) { i = scanRegex(i); continue }
    i++
  }
  return { code: out.join(''), mask }
}

/**
 * 从一个源文本里数「负向对拍」标签数（⚠ 只数 `ok` / `bad` / `note.push` / `check` 的**第一个实参**）。
 *
 * @param {string} src - 源文本
 * @returns {number} 命中数
 */
export function countLabels(src) {
  const { code, mask } = stripCommentsKeepLines(String(src ?? ''))
  return countLabelsOnCode(code, mask)
}

/**
 * 在**已剥注释**的文本上数标签：只认"代码位置"的调用。
 * ⚠ 字符串字面量里的假调用（`const s = "bad('负向对拍…')"`）**不算**：
 *   它的 `bad(` 落在 mask = 0 的位置 ⇒ 那只是字符串内容，不是调用。
 *
 * @param {string} code - `stripCommentsKeepLines` 产出的代码文本
 * @param {Uint8Array} [mask] - 同一套扫描产出的掩码（缺省 ⇒ 视作全是代码，仅供单测）
 * @returns {number} 命中数
 */
export function countLabelsOnCode(code, mask) {
  let n = 0
  /**
   * ⚠ **两条正则都跑**（2026-11-10 B4.1）：`say(` 的标签在第二个实参，
   * 与 `ok/bad/note.push/check`（第一个实参）不能共用一条正则。
   * ⚠ 不去重：一条调用只可能命中其中一条（`say(` 与那四个名字不重叠）。
   */
  for (const re of [CALL_LIT_RE, SAY_LIT_RE]) {
    for (const m of code.matchAll(re)) {
      if (mask !== undefined && (m.index === undefined || mask[m.index] !== 1)) continue
      const s = m[1] ?? m[2] ?? ''
      if (s.includes('负向对拍')) n += 1
    }
  }
  return n
}

/**
 * 解析某入口脚本的 import 闭包（只跟 `./x.mjs`）。
 *
 * @param {string} entry - 相对 `scripts/` 的文件名
 * @returns {string[]} 闭包内文件（含入口），相对 `scripts/`
 */
export function importClosure(entry) {
  const seen = []
  const stack = [entry]
  while (stack.length > 0) {
    const f = stack.pop()
    if (f === undefined || seen.includes(f)) continue
    seen.push(f)
    const abs = join(here, f)
    if (!existsSync(abs)) continue
    let src = ''
    try { src = readFileSync(abs, 'utf8') } catch { continue }
    for (const m of src.matchAll(/from\s+'(\.\/[\w.-]+\.mjs)'/g)) {
      stack.push(m[1].slice(2))
    }
  }
  return seen
}

/**
 * 数每族的负向对拍标签数（⚠ 纯函数式：读盘但可被 `overrideSrc` 替换，便于负向对拍）。
 *
 * @param {Record<string,string>} families - `check:xxx` → 入口脚本（`scripts/xxx.mjs` 形态）
 * @param {Record<string,string>} [overrideSrc] - 文件名 → 替换后的源文本（负向对拍用）
 * @returns {Record<string, {count: number, files: number}>} 每族读数
 */
export function measureFamilies(families, overrideSrc = {}) {
  const out = {}
  for (const [fam, scriptPath] of Object.entries(families)) {
    const entry = scriptPath.replace(/^scripts\//, '')
    const files = importClosure(entry)
    let n = 0
    for (const f of files) {
      const src = overrideSrc[f] !== undefined
        ? overrideSrc[f]
        : (() => { try { return readFileSync(join(here, f), 'utf8') } catch { return '' } })()
      n += countLabels(src)
    }
    out[fam] = { count: n, files: files.length }
  }
  return out
}

/**
 * 读登记表（每族**下限**）。
 *
 * @returns {{floor: Record<string, number>, note?: string}}
 */
export function readFloor() {
  try {
    const o = JSON.parse(readFileSync(FLOOR_PATH, 'utf8'))
    return { floor: o.floor ?? {}, note: o.note }
  } catch {
    return { floor: {}, note: undefined }
  }
}

/**
 * **纯判定**：实测 vs 下限 ⇒ 问题清单（空 = 绿）。
 *
 * @param {Record<string, {count: number}>} measured - 实测
 * @param {Record<string, number>} floor - 下限
 * @returns {string[]} 问题清单
 */
export function compareFloors(measured, floor) {
  const problems = []
  for (const fam of Object.keys(measured).sort()) {
    const got = measured[fam].count
    if (floor[fam] === undefined) {
      problems.push(`${fam}：**没有登记下限** ⇒ 它的负向对拍被删光也无人发现（修法：在 \`scripts/meta-negative-floor.json\` 里按实测值补一行）`)
      continue
    }
    if (got < floor[fam]) {
      problems.push(`${fam}：负向对拍 **实测 ${got} 条 < 登记下限 ${floor[fam]} 条** ⇒ 有对拍被删/被注释掉了`)
    }
  }
  return problems
}

/** 从 `package.json` 取 check:* 族 → 入口脚本（⚠ 取第一个 `node scripts/x.mjs`；`&&` 串联取首条）。 */
export function familiesFromPkg() {
  let pkg
  try { pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) } catch { return {} }
  const out = {}
  for (const [k, v] of Object.entries(pkg.scripts ?? {})) {
    if (!k.startsWith('check:')) continue
    const m = /node\s+(scripts\/[\w.-]+\.mjs)/.exec(String(v))
    if (m !== null) out[k] = m[1]
  }
  return out
}

/**
 * 断言入口（给 `check:gitignore` 调用）。
 *
 * @param {{bad: Function, ok: Function, overrideSrc?: Record<string,string>, floorOverride?: Record<string,number>}} o
 * @returns {{measured: Record<string,{count:number}>, floor: Record<string,number>}} 读数（供调用方印表）
 */
export function runNegativeCoverage({ bad, ok, overrideSrc = {}, floorOverride }) {
  const families = familiesFromPkg()
  const famCount = Object.keys(families).length
  if (famCount === 0) {
    bad('M-1 从 `package.json` 读不到任何 `check:*` 族 ⇒ 本组失去基准（不按通过处理）')
    return { measured: {}, floor: {} }
  }
  const measured = measureFamilies(families, overrideSrc)
  const floor = floorOverride ?? readFloor().floor
  const problems = compareFloors(measured, floor)
  const total = Object.values(measured).reduce((a, x) => a + x.count, 0)
  const unregistered = Object.keys(measured).filter((f) => floor[f] === undefined).length

  if (problems.length === 0) {
    ok(`M-1 ✓ **元规则有牙**：${famCount} 族的「负向对拍」逐个 ≥ 登记下限`
      + `（实测合计 **${total}** 条 · 下限合计 ${Object.values(floor).reduce((a, b) => a + b, 0)} 条 · 未登记 ${unregistered} 族）`)
  } else {
    for (const p of problems) bad(`M-1 · ${p}`)
  }
  return { measured, floor }
}

/**
 * **M-1b 的断言入口**（给 `check:gitignore` / `check:meta-negctl` 调用）。
 *
 * ⚠⚠ **关于"每族至少一条"这个目标，我必须如实说清**（2026-10-30 P7 实测）：
 *   本仓现状是 **18 族有负向对拍，其中只有 3 族写了「先自证」**（其余 15 族是 0）。
 *   ⇒ 若现在就把"每族 ≥ 1"写成硬判据，**当场 15 条红**，而修法需要逐族真的去
 *     构造"先证明夹具坏了"的代码（不是加一行注释就能算数的）。
 *   ⇒ 本轮采用**下限表 + 零余量**：登记每族**当前实测值**，M-1b 只把"退步"判红；
 *     ⚠ 并且**另有一条全局下界**（`totalFloor`）只准升 —— 以后补一族就必须同批抬它。
 *   ⚠ 那 15 族的缺口**写在报告「待决问题」里**，⛔ 不假装它们已经满足。
 *
 * @param {{bad:Function, ok:Function, measured:Record<string,{count:number}>}} o
 * @returns {{counts: Record<string,number>, floor: Record<string,number>}}
 */
export function runSelfProof({ bad, ok, measured }) {
  const families = familiesFromPkg()
  const closureOf = (fam) => {
    const sp = families[fam]
    return sp === undefined ? [] : importClosure(sp.replace(/^scripts\//, ''))
  }
  const readOf = (f) => { try { return readFileSync(join(here, f), 'utf8') } catch { return '' } }
  const { counts, problems } = measureSelfProof(measured, closureOf, readOf)

  let reg = { floor: {}, totalFloor: 0 }
  try { reg = JSON.parse(readFileSync(SELFPROOF_PATH, 'utf8')) } catch { /* 缺表 ⇒ 下面按"全缺"处理 */ }
  const floor = reg.floor ?? {}
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const withMarker = Object.values(counts).filter((n) => n > 0).length
  const problems2 = [...problems].map((x) => `${x}（⚠ 登记下限 ${floor[x.split('：')[0]] ?? '缺'} ⇒ 尚未达标）`)

  // 只把"退步"判红（登记了却掉下来）
  const regressions = Object.keys(floor).filter((f) => (counts[f] ?? 0) < floor[f])
  for (const f of regressions) {
    bad(`M-1b **${f} 的「先自证」标记掉了**：实测 ${counts[f] ?? 0} < 登记 ${floor[f]}`)
  }
  if (total < (reg.totalFloor ?? 0)) {
    bad(`M-1b **「先自证」标记总数掉了**：实测 ${total} < 登记下界 ${reg.totalFloor}`)
  }
  if (regressions.length === 0 && total >= (reg.totalFloor ?? 0)) {
    ok(`M-1b ✓ **「先自证」标记无退步**：${withMarker}/${Object.keys(counts).length} 族有标记`
      + `（合计 ${total} 处 · 下界 ${reg.totalFloor ?? 0}）`
      + `；⚠ **尚缺 ${Object.keys(counts).length - withMarker} 族**（已登记在案，⛔ 不当作已满足）`)
  }
  void problems2
  return { counts, floor }
}

// ── 直接执行时的最小入口（供 `npm run check:meta-negctl`）────────────────────────
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  let pass = 0
  let fail = 0
  const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
  const bad = (m) => { fail++; console.log(`  ✗ ${m}`) }
  console.log('')
  console.log('M 组：元规则 · 每条判据自带负向对拍（实测 vs 登记下限）')
  console.log('')
  const { measured, floor } = runNegativeCoverage({ bad, ok })
  runSelfProof({ bad, ok, measured })

  /**
   * ⚠ **本族自己的负向对拍**（自指）：把 `check:ledger` 的对拍标签清空 ⇒ 必须红。
   *   ⚠ 与 `check:gitignore` 里的 `N-M1` 同款；这里再跑一次是为了让
   *     `npm run check:meta-negctl` **单跑也有牙**（⛔ 不能只在别处被验）。
   */
  {
    const fams0 = familiesFromPkg()
    const target = 'check:ledger'
    if (fams0[target] === undefined) {
      bad('N-M1 · 找不到 `check:ledger` ⇒ 本族负向对拍失去对象')
    } else {
      const entryFile = fams0[target].replace(/^scripts\//, '')
      const m2 = measureFamilies({ [target]: fams0[target] }, { [entryFile]: '// 夹具\nok(`x`)\n' })
      const reallyZero = m2[target] !== undefined && m2[target].count === 0
      const probs0 = compareFloors({ [target]: m2[target] }, floor)
      if (!reallyZero) bad(`N-M1 · 夹具没把计数压到 0（实测 ${m2[target]?.count}）⇒ 自指对拍不可判`)
      else if (probs0.length > 0) ok(`N-M1 ✓ 负向对拍（清空 ${target} 的对拍标签 ⇒ 0 < 下限 ${floor[target]}）⇒ M-1 必红`)
      else bad('N-M1 · 清空后仍通过 ⇒ 数的是登记表不是实测')
    }
  }

  /**
   * **N-M1c · 剥注释自证**（S-16）：十三个用例逐个对齐口径。
   * ⚠ `stringLiteral` / `templateBody` / `callInsideStringArg` 期望 **0**：
   *   它们是字符串内容，不是调用（A 方案：先定位**代码位置**的调用，再取第一个实参）。
   *   旧口径会把它们数成 1 ⇒ "把标签塞进任意字符串"仍能凑数（同一个漏洞换个壳）。
   * ⚠ 额外钉住三条真实边界：多行模板串里的 `//`、模板插值里的 `//`、正则里的斜杠星号。
   */
  {
    const TAG = '负向对拍'
    const NL = '\n'
    const CASES = [
      ['plain', 'ok(\'' + TAG + '\')', 1],
      ['lineComment', '// bad(\'' + TAG + '\')' + NL + 'const x = 1', 0],
      ['blockComment', '/* ok(\'' + TAG + '\') */' + NL + 'const y = 2', 0],
      ['jsdoc', '/**' + NL + ' * bad(\'' + TAG + '\')' + NL + ' */' + NL + 'const z = 3', 0],
      ['stringLiteral', 'const s = "bad(\'' + TAG + '\')"', 0],
      ['templateBody', 'const t = ' + BACKTICK + 'x bad(\'' + TAG + '\') y' + BACKTICK, 0],
      ['urlInString', 'const u = "https://e.com//x"; ok(\'' + TAG + '\')', 1],
      ['regexClass', 'const r = /[/*]/; ok(\'' + TAG + '\')', 1],
      ['multilineTemplate', 'const t = ' + BACKTICK + 'a' + NL + '// b bad(\'' + TAG + '\')' + NL + 'c' + BACKTICK + '; ok(\'' + TAG + '\')', 1],
      ['templateInterpolation', 'ok(' + BACKTICK + '$' + '{x + "//"} ' + TAG + BACKTICK + ')', 1],
      ['divisionNotRegex', 'const q = a / b; ok(\'' + TAG + '\')', 1],
      ['regexWithSlashes', 'const r2 = /https?:\\/\\//; ok(\'' + TAG + '\')', 1],
      ['callInsideStringArg', 'bad("ok(\'' + TAG + '\')")', 0],
    ]
    const wrong = CASES
      .map(([label, src, want]) => ({ label, want, got: countLabels(src) }))
      .filter((x) => x.got !== x.want)
    if (wrong.length === 0) {
      ok('N-M1c 剥注释自证：' + CASES.length + ' 个用例逐个符合（行/块/JSDoc 注释 · 字符串里的双斜杠 · 多行模板串 · 正则里的斜杠星号 都覆盖）')
    } else {
      for (const w of wrong) bad('N-M1c · ' + w.label + ' 实 ' + w.got + ' 期望 ' + w.want + ' ⇒ 计数器仍被非代码文本干扰')
    }
  }

  /**
   * **N-M1d · 注释掉一条真对拍 ⇒ 计数必降 / M-1 必红**（S-16 的核心负向对拍，纯内存、不落盘）。
   *   选一个**零余量**的族（实测 == 下限 > 0），在它的入口或闭包里定位一条
   *   **代码位置**的真对拍，把那一处注释掉 ⇒ 计数必须下降，且 compareFloors 必须报红。
   * ⚠ 旧实现下本条会失败：被注释的标签仍在原文里 ⇒ 计数不变（M-1 照旧绿），
   *   那正是 S-16 的病灶（"加两个斜杠就能绕过 M-1"）。
   */
  {
    const famsAll = familiesFromPkg()
    const zeroMargin = Object.keys(measured)
      .filter((f) => floor[f] !== undefined && measured[f].count === floor[f] && measured[f].count > 0)
      .sort()
    const candidates = zeroMargin.length > 0
      ? zeroMargin
      : Object.keys(measured).filter((f) => measured[f].count > 0).sort()
    let demo = null
    for (const fam of candidates) {
      const entry = famsAll[fam].replace(/^scripts\//, '')
      for (const file of importClosure(entry)) {
        let src = ''
        try { src = readFileSync(join(here, file), 'utf8') } catch { src = '' }
        if (src === '') continue
        const scan = stripCommentsKeepLines(src)
        const hits = []
        /** ⚠ 两条正则都跑（`say(` 的标签在第二个实参，见 `SAY_LIT_RE` 的注释）。 */
        for (const re of [CALL_LIT_RE, SAY_LIT_RE]) for (const m of scan.code.matchAll(re)) {
          if (m.index === undefined || scan.mask[m.index] !== 1) continue
          const s = m[1] ?? m[2] ?? ''
          if (s.includes('负向对拍')) hits.push(m.index)
        }
        if (hits.length > 0) {
          const at = hits[0]
          demo = { fam, file, at, line: scan.code.slice(0, at).split('\n').length, src }
          break
        }
      }
      if (demo !== null) break
    }
    if (demo === null) {
      bad('N-M1d · 找不到可注释的真实对拍处 ⇒ 本条不可判（不按通过处理）')
    } else {
      const beforeFile = countLabels(demo.src)
      const commented = demo.src.slice(0, demo.at) + '// ' + demo.src.slice(demo.at)
      const afterFile = countLabels(commented)
      const m2 = measureFamilies({ [demo.fam]: famsAll[demo.fam] }, { [demo.file]: commented })
      const beforeFam = measured[demo.fam].count
      const afterFam = m2[demo.fam] !== undefined ? m2[demo.fam].count : 0
      const probs = compareFloors({ [demo.fam]: m2[demo.fam] }, floor)
      const canProveRed = floor[demo.fam] !== undefined && beforeFam === floor[demo.fam]
      if (afterFile >= beforeFile) {
        bad('N-M1d · 注释掉一条真对拍后计数 ' + beforeFile + ' -> ' + afterFile + '（没下降）⇒ 计数器仍在读注释')
      } else if (afterFam !== beforeFam - (beforeFile - afterFile)) {
        bad('N-M1d · 族读数没跟着降（' + beforeFam + ' -> ' + afterFam + '，本文件降了 ' + (beforeFile - afterFile) + '）⇒ 计数口径不一致')
      } else if (canProveRed && probs.length === 0) {
        bad('N-M1d · 注释掉一条真对拍后 M-1 仍通过 ⇒ 它数的是登记表、不是实测')
      } else if (canProveRed) {
        ok('N-M1d 注释掉真对拍 ⇒ 计数必降：把 ' + demo.fam + ' 的 ' + demo.file + ':' + demo.line + ' 那条真对拍注释掉，计数 ' + beforeFam + ' -> ' + afterFam + '（实测 ' + afterFam + ' < 下限 ' + floor[demo.fam] + '）⇒ **M-1 必红**')
      } else {
        ok('N-M1d 注释掉真对拍 ⇒ 计数 ' + beforeFam + ' -> ' + afterFam + '（下降；⚠ 当前无零余量族，本条只证计数下降，未演示 M-1 红）')
      }
    }
  }

  const fams = Object.keys(measured).sort()
  for (const f of fams) {
    console.log(`    ${f.padEnd(28)} ${String(measured[f].count).padStart(4)} 条（${measured[f].files} 文件）`)
  }
  console.log('')
  console.log(`M 组：通过 ${pass} · 失败 ${fail}`)
  console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处${fail > 0 ? ` · 没过 ${fail} 处` : ''} · **跳过 0 处**（⚠ 跳过**不计入通过**）`)
  console.log('')
  if (fail > 0) { console.log('  ⛔ M 组有失败'); process.exit(1) }
  console.log('  ✅ M 组全绿（元规则有牙；⚠ 它只证"条数不低于下限"，不证"每条对拍真的会红"）')
  process.exit(0)
}

/**
 * **M-1b · 弱版：每族至少一条负向对拍写了「先自证」**（2026-10-30 P7 · `CHG-265` §四1）。
 *
 * ── 它补 M-1 的什么洞 ────────────────────────────────────────────────
 *   M-1 只数**条数** ⇒ 有人可以写 `ok('N-xx ✓ 负向对拍…')` 而**根本没造坏夹具**，M-1 照样绿。
 *   ⚠ 本项目已实测踩过两次（P1 的 N-I2 没冻结、P2 的 N-I1c 到不了断言）
 *     —— 两次都是"看起来有对拍、其实咬的是空气"。
 *   ⇒ M-1b 要求：**有负向对拍的族**，至少有一条在**注释或文案**里写明
 *     「先自证」（即：先证明夹具真的坏了，再断言它红）。⚠ 措辞按实测能稳定扫到的取：
 *     标记串 = `先自证`。
 *
 * ── 口径（⚠ 写清才能复核）──────────────────────────────────────────
 *   ① 只对**已有负向对拍**的族生效（M-1 读数 > 0）—— 0 条的族由 M-1 的 0 下限管，
 *      此处不重复报（⛔ 否则"没有对拍"会被报成两条一样的红）。
 *   ② 扫的是**该族 import 闭包里**出现 `先自证` 的次数（注释与文案都算 ——
 *      注释正是"为什么这条对拍可信"该待的地方）。
 *
 * @param {Record<string,{count:number}>} measured - M-1 的实测（决定哪些族要求标记）
 * @param {(entry:string)=>string[]} closureOf - 取闭包
 * @param {(file:string)=>string} readOf - 读文本
 * @param {Record<string,string>} [overrideSrc]
 * @returns {{counts: Record<string,number>, problems: string[]}}
 */
export function measureSelfProof(measured, closureOf, readOf, overrideSrc = {}) {
  const counts = {}
  const problems = []
  for (const fam of Object.keys(measured).sort()) {
    if (measured[fam].count === 0) continue
    let n = 0
    for (const f of closureOf(fam)) {
      const src = overrideSrc[f] !== undefined ? overrideSrc[f] : readOf(f)
      n += (src.match(/先自证/g) ?? []).length
    }
    counts[fam] = n
    if (n === 0) {
      problems.push(`${fam}：有 ${measured[fam].count} 条负向对拍，但**没有一条**写明「先自证」`
        + ' ⇒ 无法判断那些对拍是不是"咬空气"（⚠ M-1 只数条数，这条管可信度）')
    }
  }
  return { counts, problems }
}

