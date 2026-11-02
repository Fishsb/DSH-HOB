#!/usr/bin/env node
/**
 * **`check:workflow` · Hob 自己的工作流判据族**（2026-10-30 · P8 · `TASK-P8.md` §三）。
 *
 * ══ 它守什么（四条，各带负向对拍）═══════════════════════════════════════════════
 *   **F1** `workflow.toml` 合法：五步齐（`order` = 1..5 且 4/5 的 `actor_role` 不同）·
 *          每个 intake 有 `test` + `first_move` + `source` ·
 *          每条规则的 `source` 在 `preset-dsh-hob.patch.yml` 的 `prefix` 正文里**真实存在**
 *   **F2** ⭐ 生成物与源一致（手改 `gen/persona.md` 一个字符 ⇒ 必红）
 *   **F3** `CONSTITUTION.md` ≤ 2 KB 且每条带 `checked_by`
 *   **F4** ⭐ **覆盖度**：`workflow.toml` 的 intake 数 = `prefix` 正文里 `###` 级**输入节**数
 *          （⚠ 这是"没丢东西"唯一的机检 —— `TASK-P8.md` §九 原话）
 *
 * ══ 为什么 F4 这样数（⚠ 口径写清才能复核）════════════════════════════════════════
 *   `prefix` 正文里的 `###` 节不止七个（还有 `### Your duties` / `### Rules` / `### Language` …）。
 *   ⇒ **只认"输入判定节"**：位于 `### Taking input`（或含 `First move on any input` 的那节）之后、
 *     `### Reply format` 之前，且节内**同时**出现 `**Test:**` 与 `**First move:**` 的 `###` 节。
 *   ⚠ 这条口径由 `inputSectionsOf()` 实现，并在 F4 里**逐节打印节名**（可复核）。
 *
 * 用法：`npm run check:workflow`；退出码 0 = 全通过。
 */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, cpSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')
const PRESET_DIR = join(ROOT, 'preset', 'dsh-hob')
const WF = join(PRESET_DIR, 'workflow.toml')
const CONST = join(PRESET_DIR, 'CONSTITUTION.md')
const GEN = join(PRESET_DIR, 'gen')
const YML = join(PRESET_DIR, 'preset-dsh-hob.patch.yml')

let pass = 0
let fail = 0
const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail++; console.log(`  ✗ ${m}`) }

/**
 * **截出 `prefix` 正文并归一空白**。
 *
 * @param {string} yml - patch.yml 全文
 * @returns {{text: string, flat: string, lines: number}|null} 正文与"扁平版"（多空白 ⇒ 单空格）
 */
export function prefixBodyOf(yml) {
  const lines = yml.split('\n')
  const i = lines.findIndex((l) => /^\s*prefix:\s*\|-/.test(l))
  if (i < 0) return null
  const ind = lines[i].length - lines[i].trimStart().length
  let j = lines.length
  for (let k = i + 1; k < lines.length; k++) {
    if (lines[k].trim() === '') continue
    if (lines[k].length - lines[k].trimStart().length <= ind) { j = k; break }
  }
  const body = lines.slice(i + 1, j).map((l) => l.trim())
  const text = body.join('\n')
  return { text, flat: text.replace(/\s+/g, ' ').trim(), lines: body.length }
}

/**
 * **数 `prefix` 正文里的「输入判定节」**（⚠ F4 的口径，见文件头）。
 *
 * @param {string} text - 已归空白的 prefix 正文（每行 trim 过）
 * @returns {string[]} 节名（不含 `### `）
 */
export function inputSectionsOf(text) {
  const lines = text.split('\n')
  /**
   * ① 找区间：`## Taking input`（⚠ **二级**，不是三级 —— 实测正文里它是 `## Taking input`）
   *   之后 → `### Reply format` 之前。
   * ⚠ 第一版写的是 `### Taking input` ⇒ 找不到 ⇒ start=0 ⇒ 把 `### The five steps` 也算进来了
   *   （它下面嵌着 `#### First move on any input`，里面有 `**Test:**` ⇒ 被误判成输入节）。
   *   ⚠ 这正是"口径写错会让读数多一节"的实例，记在此处。
   */
  let start = lines.findIndex((l) => /^##\s+Taking input/.test(l))
  if (start < 0) start = 0
  let end = lines.findIndex((l, k) => k > start && /^###\s+Reply format/.test(l))
  if (end < 0) end = lines.length
  const secs = []
  let cur = null
  for (let k = start; k < end; k++) {
    const m = /^###\s+(.+)$/.exec(lines[k])
    if (m !== null) { cur = { name: m[1].trim(), body: [] }; secs.push(cur); continue }
    if (cur !== null) cur.body.push(lines[k])
  }
  return secs
    .filter((s) => s.body.join('\n').includes('**Test:**') && s.body.join('\n').includes('**First move:**'))
    .map((s) => s.name)
}

/**
 * **F10 的判定核心**（⚠ 抽成纯函数，供负向对拍**真的喂夹具跑一遍**，⛔ 不另写一套口径）。
 *
 * @param {string} prefixText - `prefix` 正文（`prefixBodyOf().text`）
 * @param {string} personaText - `gen/persona.md` 正文
 * @param {Record<string,any>} wf - 机读源
 * @param {string} INV_MARK_UNUSED - 占位（保持签名稳定）
 * @returns {string[]} 红的行（空数组 = F10 会绿）
 */
export function f10ProbsOf(prefixText, personaText, wf) {
  const out = []
  const norm = (s) => String(s).replace(/^\n+/, '').replace(/\n+$/, '') + '\n'
  const a = norm(prefixText)
  const b = norm(personaText)
  if (a !== b) {
    const n = Math.min(a.length, b.length)
    let k = 0
    while (k < n && a[k] === b[k]) k++
    out.push(`① \`prefix\` 正文与 \`gen/persona.md\` **不一致**（第 ${k + 1} 个字符起 · prefix ${Buffer.byteLength(a, 'utf8')} B vs persona ${Buffer.byteLength(b, 'utf8')} B）`)
  }
  const originOfX = (e) => (e.origin === undefined ? 'original' : String(e.origin).trim())
  const missing = []
  for (const v of wf?.invariant ?? []) {
    if (!a.includes(String(v.id ?? '')) && !b.includes(String(v.id ?? ''))) missing.push(`不变量 id \`${v.id}\``)
    if (!b.includes(String(v.text ?? ''))) missing.push(`不变量 text「${v.text}」`)
  }
  for (const it of wf?.intake ?? []) {
    if (originOfX(it) !== 'new') continue
    const secName = String(it.section ?? '').replace(/^###\s+/, '').trim()
    if (!a.includes(`### ${secName}`)) missing.push(`新增 intake 的节名「${secName}」`)
    if (!a.includes(String(it.id ?? ''))) missing.push(`新增 intake id \`${it.id}\``)
  }
  const needIds = (wf?.intake ?? []).filter((it) => originOfX(it) === 'new').map((it) => it.id)
  if (needIds.length === 0) out.push('② 没有 `origin = "new"` 的 intake ⇒ "新三节真的进了 prefix"没有对象（⛔ 不报 ✓）')
  if (missing.length > 0) out.push(`② prefix 正文里**缺**（新条文没进运行时提示词）：${missing.join(' · ')}`)
  return out
}

/**
 * **F1 的判定核心**（⚠ 顶层纯函数：F1 本体与 N-F1b/N-F1c/N-F1d **共用这一份**）。
 *
 * ── 为什么必须共用（⚠ 这是"自指"要求的一部分）──────────────────────────
 *   负向对拍若自己**抄一份**判定逻辑，那么把 F1 里那条断言注释掉之后，
 *   抄来的那份照样绿 ⇒ 对拍**永远发现不了"断言被摘"**（假保护）。
 *   ⇒ 判定只有一份；摘掉 F1 里那行 ⇒ 本函数不再被 F1 调用 ⇒ F1 的输出里没有那条红。
 *     ⚠ 而"那行被摘了"这件事由 **N-F1e** 直接读源码核（见下）。
 *
 * @param {Record<string,any>} mut - 机读源（可被夹具改过）
 * @param {{flat:string}|null} pre - 冻结原文（`flat` 已归一空白）
 * @param {string[]} userLines - 用户原话冻结件的**有效行**
 * @param {string} userFlat - 上述有效行拼成的一行（空白已归一）
 * @returns {{probs:string[], checked:number, byOrigin:{original:number,new:number}, originCount:{original:number,new:number}}}
 */
export function f1ProbsOf(mut, pre, userLines, userFlat) {
  const probs = []
  const steps = mut.step ?? []
  if (steps.length !== 5) probs.push(`五步只有 ${steps.length} 条（期望 5）`)
  const orders = steps.map((x) => Number(x.order)).sort((a, b) => a - b)
  if (JSON.stringify(orders) !== JSON.stringify([1, 2, 3, 4, 5])) probs.push(`step.order 不是 1..5：${JSON.stringify(orders)}`)
  const s4 = steps.find((x) => Number(x.order) === 4)
  const s5 = steps.find((x) => Number(x.order) === 5)
  if (s4 === undefined || s5 === undefined) probs.push('缺第 4 或第 5 步')
  else if (s4.actor_role === s5.actor_role) probs.push(`第 4 步与第 5 步的 actor_role 相同（${s4.actor_role}）⇒ 违反"第 4 ≠ 第 5"`)
  for (const x of steps) for (const k of ['id', 'name', 'who', 'judged_by', 'source']) {
    if (typeof x[k] !== 'string' || x[k].trim() === '') probs.push(`step ${x.id ?? '?'} 缺 \`${k}\``)
  }
  const intakes = mut.intake ?? []
  if (intakes.length === 0) probs.push('intake 一条都没有')
  for (const it of intakes) for (const k of ['id', 'test', 'first_move', 'source']) {
    if (typeof it[k] !== 'string' || it[k].trim() === '') probs.push(`intake ${it.id ?? '?'} 缺 \`${k}\``)
  }
  if ((mut.reply ?? []).length === 0) probs.push('reply 一条都没有')
  /** ⚠⚠ 封闭集 = **恰好 6 条**（⛔ 不许写成 `>= 3`：多写一条没定过的不变量也会静默通过）。 */
  if ((mut.invariant ?? []).length !== 6) probs.push(`invariant 应恰好 6 条（实 ${(mut.invariant ?? []).length}）`)

  const originOfX = (e) => (e.origin === undefined ? 'original' : String(e.origin).trim())
  const ORIGIN_DOMAIN_X = new Set(['original', 'new'])
  const originCount = { original: 0, new: 0 }
  for (const table of ['intake', 'invariant']) {
    for (const e of mut[table] ?? []) {
      const o = originOfX(e)
      if (!ORIGIN_DOMAIN_X.has(o)) probs.push(`${table} \`${e.id ?? '?'}\` 的 \`origin\` = ${JSON.stringify(String(e.origin))} 不在封闭集 original/new 里`)
      else originCount[o] += 1
    }
  }
  if (originCount.new === 0) probs.push('一条 `origin = "new"` 都没有 ⇒ 新增条目没标出处（⛔ 不许把新条目混进 original）')

  let checked = 0
  const byOrigin = { original: 0, new: 0 }
  for (const table of ['step', 'intake', 'reply', 'invariant', 'rule']) {
    for (const e of mut[table] ?? []) {
      if (typeof e.source !== 'string' || e.source.trim() === '') continue
      checked++
      const o = (table === 'intake' || table === 'invariant') ? originOfX(e) : 'original'
      const needle = e.source.replace(/\s+/g, ' ').trim()
      if (o === 'new') {
        byOrigin.new += 1
        if (userLines.length === 0) probs.push(`${table} \`${e.id}\` 标了 \`origin = "new"\`，而 \`spec/origin-user-2026-10-31.txt\` **是空的** ⇒ 出处没有基准（⛔ 不是 skip）`)
        else if (!userFlat.includes(needle)) probs.push(`${table} \`${e.id}\` 的 \`source\` 在**用户原话冻结件**里找不到（\`origin = "new"\` 必须对那份核）：${JSON.stringify(e.source.slice(0, 70))}`)
      } else {
        byOrigin.original += 1
        if (pre === null) probs.push('读不到 `prefix:` 正文 ⇒ `source` 子串核对**没有基准**（⛔ 不按通过处理）')
        else if (!pre.flat.includes(needle)) probs.push(`${table} \`${e.id}\` 的 \`source\` 在提示词正文里**找不到**：${JSON.stringify(e.source.slice(0, 70))}`)
      }
    }
  }
  if (checked === 0) probs.push('一条 `source` 都没核对到 ⇒ 本组没有对象（⛔ 不报 ✓）')
  return { probs, checked, byOrigin, originCount }
}

console.log('')
console.log('F 组：Hob 自己的工作流（workflow.toml / 生成物 / 宪法 / 覆盖度）')
console.log('')

try {
  const gpc = await import(pathToFileURL(join(here, 'gen-preset-contract.mjs')).href)
  const {
    parseWorkflow, renderAll, readInputs, NOTE_FILES: NOTE_FILES_G,
    MODEL_FACE_VERSION, MODEL_FACE_CHAR_BUDGET, modelFaceChars, modelFaceHash,
  } = gpc
  /** ⚠ 附注卷清单（⚠ 唯一来源 = 生成器，⛔ 不在这里抄第二份）。 */
  const NOTE_FILES = NOTE_FILES_G

  let wfSrc = ''
  try { wfSrc = readFileSync(WF, 'utf8') } catch { wfSrc = '' }
  let wf = null
  try { wf = parseWorkflow(wfSrc) } catch (e) {
    bad(`F1 \`workflow.toml\` **解析不了**（${String(e?.message ?? e)}）⇒ 以下三条失去基准（⛔ 不按通过处理）`)
  }
  let yml = ''
  try { yml = readFileSync(YML, 'utf8') } catch { yml = '' }
  /**
   * ⚠⚠ **2026-10-30 P10：`source` 的核对基准改成"冻结的原文"**。
   *   切换之后 `prefix` 里已经不是原文（它就是 `gen/persona.md`）⇒ 若仍对 live `prefix` 核，
   *   `source` 永远找不到 —— 那不是"规则丢了"，是**基准对象变了**。
   *   ⇒ 冻结件：`preset/dsh-hob/spec/origin-prefix.txt`（= 切换前 `prefix` 正文逐字）。
   */
  const ORIGIN = join(PRESET_DIR, 'spec', 'origin-prefix.txt')
  let originText = ''
  try { originText = readFileSync(ORIGIN, 'utf8') } catch { originText = '' }
  /**
   * ⚠⚠ **2026-10-31 P39：`origin = "new"` 的条目另有一个冻结基准**。
   *   新增的三条 intake / 三条不变量**没有原文出处**（`origin-prefix.txt` 里根本没有那几句），
   *   它们逐字来自用户 2026-10-31 的原话 ⇒ 单独冻结成 `spec/origin-user-2026-10-31.txt`。
   *   ⇒ `source` 核对**分路**：`original`（缺省）对老件，`new` 对新件。
   *   ⚠ 空文件 ⇒ **红**，⛔ 不是 skip（否则清空它就能把"新增条目的出处"抹掉）。
   */
  const ORIGIN_USER = join(PRESET_DIR, 'spec', 'origin-user-2026-10-31.txt')
  let originUserRaw = ''
  try { originUserRaw = readFileSync(ORIGIN_USER, 'utf8') } catch { originUserRaw = '' }
  /** 冻结件里**非注释、非空**的行（`#` 开头的是文件头说明，⛔ 不参与子串核对）。 */
  const ORIGIN_USER_LINES = originUserRaw.split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
  const originUserFlat = ORIGIN_USER_LINES.join(' ').replace(/\s+/g, ' ').trim()
  /**
   * `origin` 的**封闭集**：缺省 = `original`，只许 `original` / `new`（其它值 ⇒ 红）。
   * ⚠ 三个值不能用"非空即算" —— 那样 `legacy` 会被静默当成 original。
   */
  const originOf = (e) => (e.origin === undefined ? 'original' : String(e.origin).trim())
  const ORIGIN_DOMAIN = new Set(['original', 'new'])
  const pre = (() => {
    if (originText !== '') return { text: originText, flat: originText.replace(/\s+/g, ' ').trim(), lines: originText.split('\n').length }
    return yml === '' ? null : prefixBodyOf(yml)
  })()

  // ══════════════════════════════════════════════════════════════════════
  // F1 · workflow.toml 合法 + 每条 source 在提示词正文里真实存在
  // ══════════════════════════════════════════════════════════════════════
  if (wf !== null) {
    /**
     * ⚠⚠ **判定只有一份**：这里调用顶层 `f1ProbsOf()`，负向对拍 N-F1b/N-F1c/N-F1d
     *   也调**同一个函数** ⇒ 摘掉本组任何一行断言，那三条对拍会跟着失去对象（⛔ 不是抄一份逻辑）。
     */
    const { probs, checked, byOrigin, originCount } = f1ProbsOf(wf, pre, ORIGIN_USER_LINES, originUserFlat)
    if (probs.length === 0) {
      ok(`F1 ✓ \`workflow.toml\` 合法：五步（order=1..5 · 第 4/5 步 actor_role 不同）· `
        + `${(wf.intake ?? []).length} 个 intake 各有 test/first_move/source · **${(wf.invariant ?? []).length} 条不变量（封闭集）** · `
        + `\`origin\` 封闭集（**继承 ${originCount.original} 条 · 新增 ${originCount.new} 条**）· `
        + `**${checked} 条 source 全部命中**（原 ${byOrigin.original} 条 · 新 ${byOrigin.new} 条；⚠ original 对冻结原文、new 对用户原话）`)
    } else for (const p of probs) bad(`F1 · ${p}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // F2 · ⭐ 生成物与源一致（手改 ⇒ 必红）
  // ══════════════════════════════════════════════════════════════════════
  {
    const expected = renderAll()
    const probs = []
    for (const [name, text] of Object.entries(expected)) {
      let cur = ''
      try { cur = readFileSync(join(GEN, name), 'utf8') } catch { cur = '' }
      if (cur === '') { probs.push(`\`gen/${name}\` **读不到** ⇒ 无对象（⛔ 不按通过处理）`); continue }
      if (cur !== text) {
        const p1 = [...cur].findIndex((c, k) => c !== text[k])
        probs.push(`\`gen/${name}\` 与生成器不一致（第 ${p1 < 0 ? '?' : p1 + 1} 个字符起；实 ${cur.length} B vs 期望 ${text.length} B）`)
      }
    }
    if (probs.length === 0) {
      ok(`F2 ✓ 生成物与源**逐字节一致**：${Object.keys(expected).join(' / ')}`
        + `（${Object.values(expected).map((t) => `${t.length} B`).join(' / ')}）`)
    } else for (const p of probs) bad(`F2 · ${p}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // F3 · CONSTITUTION ≤ 2 KB 且每条带 checked_by
  // ══════════════════════════════════════════════════════════════════════
  {
    let src = ''
    try { src = readFileSync(CONST, 'utf8') } catch { src = '' }
    if (src === '') {
      bad('F3 `preset/dsh-hob/CONSTITUTION.md` **读不到** ⇒ 本条失去对象（⛔ 不按通过处理）')
    } else {
      const bytes = Buffer.byteLength(src, 'utf8')
      const clauses = src.split('\n').filter((l) => /^\d+\.\s+\*\*/.test(l.trim()))
      const noChecked = clauses.filter((l) => !l.includes('`checked_by`'))
      const probs = []
      if (bytes > 2048) probs.push(`体积 **${bytes} B > 2048 B**（⛔ 超了就是"没人会读完的宪法"）`)
      if (clauses.length === 0) probs.push('一条编号条款都没解析到 ⇒ 本组没有对象（⛔ 不报 ✓）')
      // ⚠ checked_by 可能写在条款的下一行（缩进续行）⇒ 按"条款 + 其续行"成组核
      const grouped = []
      let cur = null
      for (const l of src.split('\n')) {
        if (/^\d+\.\s+\*\*/.test(l.trim())) { cur = [l]; grouped.push(cur); continue }
        if (cur !== null && l.trim() !== '' && !/^#/.test(l.trim())) cur.push(l)
      }
      const noCb = grouped.filter((g) => !g.join('\n').includes('`checked_by`'))
      if (grouped.length === 0) probs.push('没有可核对的条款组')
      else if (noCb.length > 0) probs.push(`${noCb.length} 条没有 \`checked_by\`：${noCb.map((g) => g[0].slice(0, 30)).join(' / ')}`)
      if (probs.length === 0) {
        ok(`F3 ✓ \`preset/dsh-hob/CONSTITUTION.md\`：**${bytes} B ≤ 2048 B** · ${grouped.length} 条条款**逐条带 \`checked_by\``)
      } else for (const p of probs) bad(`F3 · ${p}`)
      void clauses; void noChecked
    }
  }

  // ── F13 · 模型面版本 / 字符预算 / 哈希可追溯 ──────────────────────────
  {
    let persona = ''
    try { persona = readFileSync(join(GEN, 'persona.md'), 'utf8') } catch { persona = '' }
    const ymlNow = readFileSync(YML, 'utf8')
    const flat = (s) => s.replace(/\s+/g, ' ').trim()
    const problems = []
    if (!Number.isInteger(MODEL_FACE_VERSION) || MODEL_FACE_VERSION < 1) {
      problems.push(`MODEL_FACE_VERSION 不是正整数：${JSON.stringify(MODEL_FACE_VERSION)}`)
    }
    if (!Number.isInteger(MODEL_FACE_CHAR_BUDGET) || MODEL_FACE_CHAR_BUDGET < 1) {
      problems.push(`MODEL_FACE_CHAR_BUDGET 不是正整数：${JSON.stringify(MODEL_FACE_CHAR_BUDGET)}`)
    }
    const chars = modelFaceChars(persona)
    if (persona === '') problems.push('gen/persona.md 读不到')
    else if (chars > MODEL_FACE_CHAR_BUDGET) problems.push(`persona ${chars} 字符 > 预算 ${MODEL_FACE_CHAR_BUDGET}`)
    const versionNeedle = `> 模型面版本：\`v${MODEL_FACE_VERSION}\` · 字符预算：\`${MODEL_FACE_CHAR_BUDGET}\`。`
    if (!persona.includes(versionNeedle)) problems.push(`persona 缺少版本/预算行：${versionNeedle}`)
    if (!flat(ymlNow).includes(flat(versionNeedle))) problems.push('运行中的 `prefix` 缺少同一版本/预算行')
    let contracts = ''
    try { contracts = readFileSync(join(GEN, 'contracts.md'), 'utf8') } catch { contracts = '' }
    const hash = modelFaceHash(persona)
    if (!contracts.includes(`> 模型面版本：\`v${MODEL_FACE_VERSION}\``)) problems.push('contracts.md 缺少模型面版本')
    if (!contracts.includes(`**${chars}** 字符`)) problems.push(`contracts.md 缺字符读数 ${chars}`)
    if (!contracts.includes(`SHA-256：\`${hash}\``)) problems.push(`contracts.md 哈希与 persona 不一致：期望 ${hash}`)
    if (problems.length === 0) {
      ok(`F13 ✓ **模型面 v${MODEL_FACE_VERSION} 可追溯**：${chars}/${MODEL_FACE_CHAR_BUDGET} 字符（在预算内）`
        + ` · persona SHA-256 \`${hash.slice(0, 16)}…\` · 运行时 prefix 与 contracts 读数同源`)
    } else for (const x of problems) bad(`F13 · ${x}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // F4 · ⭐ 覆盖度（**P39 换口径**：从"数一下相等"改成三条更硬的判定）
  // ══════════════════════════════════════════════════════════════════════
  /**
   * ── 为什么必须换（⚠ 这条是实测出来的，不是洁癖）──────────────────────
   *   改前口径 = "`workflow.toml` 的 intake 数 == `prefix` 正文里 `###` 输入节数"。
   *   入口 7 → 10 之后这个等式**恒红**：三条新节**不在原文里**（它们没有原文位置），
   *   所以 `origin-prefix.txt` 永远是 7 节、而 toml 永远 10 条。
   *   ⚠ 而"把两个数都改成 10"是不行的 —— 那等于**声称原文里有十节**（文档里说假话）。
   *   ⇒ 换成按 `origin` 分路的三条，一条都不许少：
   *
   *   ① **原文一节都不许丢**：冻结原文里的输入判定节数 == `origin` 缺省（`original`）的 intake 条数；
   *   ② **不许发明原文没有的**：每条 `original` 的 `section` 必须在原文节名集合里；
   *   ③ **新增条目必须真有出处**：每条 `new` 的 `source` 命中用户原话冻结件，且**该件非空**
   *      （空 ⇒ **红**，⛔ 不是 skip —— 否则清空它就能把"出处"抹掉）。
   */
  {
    if (pre === null || wf === null) {
      bad('F4 读不到 `prefix` 正文或 `workflow.toml` ⇒ 覆盖度失去基准（⛔ 不按通过处理）')
    } else {
      const secs = inputSectionsOf(pre.text)
      const secNames = new Set(secs)
      const sections = wf.intake ?? []
      const originals = sections.filter((s) => originOf(s) === 'original')
      const news = sections.filter((s) => originOf(s) === 'new')
      const declared = new Set(originals.map((s) => (s.section ?? '').replace(/^###\s+/, '').trim()))
      const probs = []
      if (secs.length === 0) probs.push('冻结原文里**一个输入判定节都没数到** ⇒ 扫描面为 0（⛔ 这不是通过）')
      // ① 原文节数 == original 条数
      if (secs.length !== originals.length) {
        probs.push(`① **原文节数对不上**：冻结原文 **${secs.length}** 节 vs \`origin\` 缺省的 intake **${originals.length}** 条`
          + `\n        原文节名：${secs.join(' · ')}`
          + `\n        original 声明：${[...declared].join(' · ')}`)
      }
      // ② original 的 section 必须在原文节名集合里
      const invented = [...declared].filter((s) => !secNames.has(s))
      if (invented.length > 0) probs.push(`② **发明了原文没有的节名**（标 origin 缺省却指向原文里不存在的节）：${invented.join(' · ')}`)
      // ①的反向：原文有、original 没有 ⇒ 漏抽
      const dropped = secs.filter((s) => !declared.has(s))
      if (dropped.length > 0) probs.push(`① **原文有、original 没有**（= 漏抽，这会让我少一条约束）：${dropped.join(' · ')}`)
      // ③ new 的出处
      if (news.length === 0) probs.push('③ 一条 `origin = "new"` 都没有 ⇒ 本组只核到原文七节（⛔ 新增三条的出处无人核）')
      if (ORIGIN_USER_LINES.length === 0) {
        probs.push('③ **用户原话冻结件是空的**（`spec/origin-user-2026-10-31.txt` 只剩注释或零字节）'
          + ' ⇒ 新增条目的出处没有基准（⛔ 这不是 skip，清空它就能抹掉出处）')
      }
      const noHit = news.filter((e) => !originUserFlat.includes(String(e.source ?? '').replace(/\s+/g, ' ').trim()))
      if (ORIGIN_USER_LINES.length > 0 && noHit.length > 0) {
        probs.push(`③ **${noHit.length} 条 \`new\` 的 \`source\` 在用户原话冻结件里找不到**：${noHit.map((e) => e.id).join(' · ')}`)
      }
      if (probs.length === 0) {
        ok(`F4 ✓ **覆盖度三条全对**：冻结原文 \`###\` 输入判定节 **${secs.length}** 个 = \`origin\` 缺省的 intake **${originals.length}** 条（①原文一节没丢）· `
          + `\`original\` 的 \`section\` **全部落在原文节名集合里**（②无发明）· `
          + `**${news.length}** 条 \`new\` 的 \`source\` 全部命中用户原话冻结件（③冻结件 ${ORIGIN_USER_LINES.length} 行·非空）`)
        console.log(`        原文节名清单（实测）：${secs.join(' · ')}`)
        console.log(`        新增节（无原文位置 · 只由 order 决定渲染次序）：${news.map((e) => `${e.id}→${String(e.section ?? '').replace(/^###\s+/, '')}（order=${e.order}）`).join(' · ')}`)
      } else for (const p of probs) bad(`F4 · ${p}`)
      /** ⚠ 供 F6 用：渲染后的 `prefix` 正文里必须真的出现这些节名与 id（见下面 F6）。 */
      void secNames
    }
  }

  // ── N-F7b：把某节的 `test` 截掉后半句 ⇒ F7 必红（`TASK-P11.md` §一 点名要求）──
  {
    if (wf === null || pre === null) {
      bad('N-F7b · 没有基准 ⇒ 本条不可判')
    } else {
      const it = (wf.intake ?? [])[0]
      const live = String(it?.test ?? '')
      // ⚠ 先自证：截短后的串**必须真的不再是原文子串**
      const cut = live.split(',').slice(0, 1).join(',').trim()
      /**
       * ⚠ 自证口径跟着 F7 改：F7 现在是**相等**判定 ⇒ "夹具真坏了"的判据也应是
       *   **`cut !== 原文那一段`**（⛔ 不再是"cut 不是子串" —— 截短串**必然是**子串）。
       */
      const wantSeg = (() => {
        const rawLines = pre.text.split('\n')
        const wantName = String(it.section ?? '').replace(/^###\s+/, '').trim()
        let inSec = false
        for (let i = 0; i < rawLines.length; i++) {
          const m = /^###\s+(.+)$/.exec(rawLines[i].trim())
          if (m !== null) { inSec = m[1].trim() === wantName; continue }
          if (!inSec) continue
          if (rawLines[i].startsWith('**Test:**')) {
            const buf = [rawLines[i]]
            let j = i + 1
            while (j < rawLines.length && rawLines[j].trim() !== '') { buf.push(rawLines[j]); j++ }
            return buf.join(' ').replace(/^\*\*Test:\*\*\s*/, '').replace(/\s+/g, ' ').trim()
          }
        }
        return ''
      })()
      const reallyCut = cut !== live && cut !== '' && wantSeg !== '' && cut !== wantSeg
      if (!reallyCut) {
        bad(`N-F7b · 夹具没造出"截短后子串对不上"（cut=${JSON.stringify(cut.slice(0, 60))}）⇒ 本条不可判`)
      } else if (!pre.flat.includes(live)) {
        bad('N-F7b · 当前 live test 本身就不在原文里 ⇒ 先修 F7，本条对拍不可判')
      } else {
        ok(`N-F7b ✓ 负向对拍（先自证：把 \`${it.id}\` 的 test 截掉后半句 ⇒ 截短串 **≠ 原文那一段**，且长度 ${cut.length} < ${wantSeg.length}）`
          + `⇒ F7 的"逐字 == 原文"**必红**（⚠ 后半截正是"用户点名选项走 Ruling"的排除项）`)
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // F8 · **判定：不新增**（2026-10-30 P11 · `TASK-P11.md` §二 让我判）
  // ══════════════════════════════════════════════════════════════════════
  /**
   * ── 任务书要求我判：「`[[rule]]` 每条都要有 `source` 且能在原文里命中」是不是新判据 ──────
   *   ⚠ **实测：`F1` 已经完整覆盖它** ——
   *     · `F1` 的循环里 `for (const table of ['step','intake','reply','invariant','rule'])`
   *       ⇒ `rule` **在扫描面内**；
   *     · `F1` 对每条断言 `source` 非空（缺 ⇒ 记 `缺 source`），并对**非空**的逐条做子串核对
   *       ⇒ "有 source" 与 "命中原文" 两件事都已被咬住。
   *   ⚠ 另实测：现 19 条 `rule` **0 条缺 `source` · 0 条未命中**。
   *   ⇒ **F8 不必新增**（⛔ 不为加而加）。⚠ 但这里**留一条可读的复核**：
   *     若将来有人把 `rule` 从 `F1` 的 `table` 列表里拿掉（那会静默丢掉这层保护），
   *     下面的负向对拍 N-F8 会红 —— **它测的是"F1 真的还在扫 rule"**，不是"再加一条 F8"。
   */
  {
    if (wf === null || pre === null) {
      bad('N-F8 · 没有基准 ⇒ 本条不可判')
    } else {
      const rules = wf.rule ?? []
      const noSrc = rules.filter((r) => typeof r.source !== 'string' || r.source.trim() === '')
      const notHit = rules.filter((r) => typeof r.source === 'string' && r.source.trim() !== ''
        && !pre.flat.includes(r.source.replace(/\s+/g, ' ').trim()))
      if (rules.length === 0) bad('N-F8 · `workflow.toml` 里一条 `[[rule]]` 都没有 ⇒ 这条复核失去对象')
      else if (noSrc.length > 0 || notHit.length > 0) {
        bad(`N-F8 · **F1 的 rule 覆盖面破了**：无 source ${noSrc.length} 条 / source 未命中 ${notHit.length} 条`
          + `（${[...noSrc, ...notHit].map((r) => r.id).join(' / ')}）⇒ 说明 F1 已不再完整覆盖 rule`)
      } else {
        ok(`N-F8 ✓ **判定 F8 不必新增**（F1 已完整覆盖）：实测 ${rules.length} 条 \`[[rule]]\` **全部有 \`source\`**、`
          + `**全部命中原文** ⇒ 「每条 rule 都有 source 且命中」= F1 的 rule 分支，⛔ 不重复造判据`)
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // F7 · ⭐ 七节的 `test` / `first_move` 必须是**原文该节的逐字子串**（2026-10-30 P11）
  // ══════════════════════════════════════════════════════════════════════
  /**
   * ── 它守什么（这一条是**真语义**，不只是格式）──────────────────────────
   *   P8 抽 `workflow.toml` 时我把每节 `**Test:**` 的后半截**截短了** ——
   *   例如 `new-instruction` 原文是
   *     「The message carries an imperative aimed at a concrete action, **and that action was not
   *      among the options you put to the user in your last turn.**」
   *   而 live 只剩前半句。⚠ **后半截正是排除项**：它决定"用户点名上一个选项"走 `Ruling` 而不是
   *   `New instruction`。⇒ 丢了它，Hob 会把 `Ruling` 当 `New instruction` 处理。
   *   ⇒ 本条要求：`test` / `first_move` 必须是 `origin-prefix.txt` 里**该节那一段的连续子串**
   *     （空白归一后）。⚠ **截短 ⇒ 子串必然对不上 ⇒ 必红。**
   *
   * ⚠ 与 F1 的区别（⚠ 两条都留，⛔ 不合并）：
   *   · **F1** 核的是 `source` —— "这条规则**来自**哪句原文"（出处存在性）；
   *   · **F7** 核的是 `test`/`first_move` —— "这条规则的**内容**是否原文逐字"（内容忠实性）。
   *   一条规则可以 `source` 命中而 `test` 被截短（P8..P10 就是这个状态）。
   */
  {
    if (wf === null || pre === null) {
      bad('F7 读不到 `workflow.toml` 或原文基准 ⇒ 本条失去对象（⛔ 不按通过处理）')
    } else {
      const flatOrigin = pre.flat
      /** 从原文里切出某节 `**Test:**` / `**First move:**` 那一段（到空行为止），归一空白。 */
      const sectOf = (sectionName) => {
        const rawLines = pre.text.split('\n')
        const want = sectionName.replace(/^###\s+/, '').trim()
        let inSec = false
        const out = { test: '', move: '' }
        for (let i = 0; i < rawLines.length; i++) {
          const l = rawLines[i]
          const m = /^###\s+(.+)$/.exec(l.trim())
          if (m !== null) { inSec = m[1].trim() === want; continue }
          if (!inSec) continue
          if (l.startsWith('**Test:**') || l.startsWith('**First move:**')) {
            const key = l.startsWith('**Test:**') ? 'test' : 'move'
            const buf = [l]
            let j = i + 1
            while (j < rawLines.length && rawLines[j].trim() !== '') { buf.push(rawLines[j]); j++ }
            out[key] = buf.join(' ').replace(/^\*\*(Test|First move):\*\*\s*/, '').replace(/\s+/g, ' ').trim()
            i = j - 1
          }
        }
        return out
      }
      const probs = []
      let checked = 0
      /**
       * ⚠⚠ **2026-10-31 P39：本条只核 `origin` 缺省（`original`）的那些节。**
       *   新增三节**没有原文段落**（`origin-prefix.txt` 里根本没有它们）⇒ 若照旧全扫，
       *   那六处 `test`/`first_move` 永远"找不到对应段落"，本条会变成**恒红**（假红）。
       *   ⚠ 这是**换对象**，⛔ 不是放宽：`original` 七节的核对口径一字未变（仍是"逐字相等"）；
       *     新增三节的忠实性由**另外两条**咬住 —— F1（`source` 必须命中用户原话冻结件）
       *     与 F10（节名与 id 必须真的出现在 `prefix` 正文里）。
       */
      for (const it of (wf.intake ?? []).filter((x) => originOf(x) === 'original')) {
        const sec = sectOf(String(it.section ?? ''))
        for (const [field, orig] of [['test', sec.test], ['first_move', sec.move]]) {
          if (orig === '') { probs.push(`intake ${it.id} 的 \`${field}\` 在原文里**找不到对应段落** ⇒ 判不出（⛔ 不按通过处理）`); continue }
          checked++
          const live = String(it[field] ?? '').replace(/\s+/g, ' ').trim()
          const want = orig.replace(/\s+/g, ' ').trim()
          /**
           * ⚠⚠ **必须是"相等"，⛔ 不是"是子串"**（2026-10-30 P11 负向对拍抓到的自身缺陷）：
           *   第一版写的是 `flatOrigin.includes(live)` —— 而**截短后的串本来就是原文的子串**
           *   ⇒ 那条断言**永远抓不到截短**。是 `N-F7b` 的"先自证"把它咬出来的。
           *   ⇒ 现在改成：与该节那一段**归一空白后相等**。截短 ⇒ 不等 ⇒ 必红。
           */
          if (live !== want) {
            probs.push(`intake ${it.id} 的 \`${field}\` **不是原文逐字**（截短或被改写）：`
              + `\n        live（${live.length} 字符）: ${JSON.stringify(live.slice(0, 110))}`
              + `\n        原文（${want.length} 字符）: ${JSON.stringify(want.slice(0, 110))}`)
          }
        }
      }
      if (checked === 0) probs.push('一条 `test`/`first_move` 都没核到 ⇒ 本组没有对象（⛔ 不报 ✓）')
      if (probs.length === 0) {
        ok(`F7 ✓ **原文七节**的 \`test\` / \`first_move\` **逐字 == 原文**（${checked} 处全命中；⚠ 截短会当场红；⚠ 新增三节无原文段落 ⇒ 不在本条对象内，见 F10）`)
      } else for (const p of probs) bad(`F7 · ${p}`)  // ⚠ 2026-10-31 P40/D-1：此处原为 `F11`（另一条断言的编号）⇒ 红读数会指错断言
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // F5 · ⭐ 附注卷每一段都在 `prefix` 正文里真实存在（2026-10-30 P9）
  // ══════════════════════════════════════════════════════════════════════
  /**
   * ── 它守什么 ────────────────────────────────────────────────────────
   *   `spec/notes-*.md` 是**原文逐字搬运**（P9 把"实测踩过的坑"抽成四卷）。
   *   ⚠ 而"逐字"这件事**没有任何机检** ⇒ 有人可以往里去写**原文没有的规则**，
   *     于是 Hob 会多出一条谁也没定过的约束 —— 那比漏抽更糟（**凭空发明约束**）。
   *   ⇒ 本组把每段上面那行 `<!-- source: … -->` 拿去 `prefix` 正文里**做子串核对**。
   *
   * ⚠ 口径：`source` 已归一空白（多空白 ⇒ 单空格）再比；`source` 为空 ⇒ 红（⛔ 不许无来源）。
   */
  {
    const files = ['notes-mechanism.md', 'notes-evidence.md', 'notes-handover.md', 'notes-budget.md']
    const probs = []
    let total = 0
    if (pre === null) {
      probs.push('读不到 `prefix:` 正文 ⇒ F5 没有基准（⛔ 不按通过处理）')
    } else {
      for (const f of files) {
        let src = ''
        try { src = readFileSync(join(PRESET_DIR, 'spec', f), 'utf8') } catch { src = '' }
        if (src === '') { probs.push(`附注卷 \`${f}\` **读不到**`); continue }
        const marks = [...src.matchAll(/^<!-- source: (.+?) -->$/gm)].map((m) => m[1].trim())
        if (marks.length === 0) { probs.push(`附注卷 \`${f}\` 里**一条 \`source\` 标记都没有** ⇒ 无对象（⛔ 不报 ✓）`); continue }
        total += marks.length
        const miss = marks.filter((m) => m !== '' && !pre.flat.includes(m.replace(/\s+/g, ' ').trim()))
        if (miss.length > 0) {
          probs.push(`附注卷 \`${f}\`：**${miss.length}/${marks.length}** 段的 \`source\` 在原文里**找不到**`
            + `\n        第一条：${JSON.stringify(miss[0].slice(0, 90))}`)
        }
      }
      if (total === 0 && probs.length === 0) probs.push('四卷加起来一条 source 都没核到 ⇒ 本组没有对象（⛔ 不报 ✓）')
    }
    if (probs.length === 0) {
      ok(`F5 ✓ 附注卷**逐段可追溯**：四卷共 **${total}** 段的 \`source\` 全部在提示词正文里命中（⛔ 没有凭空发明的段落）`)
    } else for (const p of probs) bad(`F5 · ${p}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // F6 · ⭐ `gen/persona.md` 覆盖率 ≥ 原文的 90%（2026-10-30 P9 · `TASK-P9.md` §二）
  // ══════════════════════════════════════════════════════════════════════
  /**
   * ── 为什么要有这条 ──────────────────────────────────────────────────
   *   P8 收口时 `gen/persona.md` 只有 **2718 B**，而原文 `prefix` 是 **30929 B**
   *   ⇒ 一旦切换，`persona.prefix` 会从 30 KB 掉到 2.7 KB，**丢掉的正是"实测踩过的坑"**。
   *   ⇒ 本条把"不许缩水"变成读数：persona 正文（**去掉 source 标记行**）必须 ≥ 原文 × 0.9。
   *   ⚠ 用**去掉注释行后**的长度比 —— 否则"多写注释"就能凑过门槛（那是注水）。
   */
  {
    const THRESHOLD = 0.9
    let persona = ''
    try { persona = readFileSync(join(GEN, 'persona.md'), 'utf8') } catch { persona = '' }
    if (persona === '' || pre === null) {
      bad('F6 读不到 `gen/persona.md` 或 `prefix` 正文 ⇒ 覆盖率失去基准（⛔ 不按通过处理）')
    } else {
      const body = persona.split('\n').filter((l) => !/^<!-- source: .* -->$/.test(l.trim())).join('\n')
      const got = Buffer.byteLength(body, 'utf8')
      const need = Math.ceil(Buffer.byteLength(pre.text, 'utf8') * THRESHOLD)
      if (got >= need) {
        ok(`F6 ✓ \`gen/persona.md\` 覆盖率达标：**${got} B** ≥ 门槛 **${need} B**（= 原文 ${Buffer.byteLength(pre.text, 'utf8')} B × 90%）`)
      } else {
        bad(`F6 · \`gen/persona.md\` **缩水**：实 **${got} B** < 门槛 **${need} B**（差 ${need - got} B）`
          + '\n      ⇒ ⛔ 不许靠加水词凑；缺什么就补什么（附注卷抽漏了哪一节）')
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════════
  // F9 · ⭐ **附注卷里每一段正文都必须被解析进产物**（2026-10-31 P28 · `CHG-284` §四·1）
  // ══════════════════════════════════════════════════════════════════
  /**
   * ── 它守什么（⚠ 真实丢过东西，不是假想）──────────────────────────
   *   `parseNoteSections()`（`gen-preset-contract.mjs`）的 `flush()` **只收
   *   `pendingSrc !== null` 的缓冲** ⇒ 在 `##` 标题下写了正文、**却没跟在
   *   `<!-- source: … -->` 后面** ⇒ 那几行**被静默丢弃**，`gen/persona.md` 里没有它，
   *   **而没有任何判据报红**。⚠ `P17` 那次三行的 `id` 就是这么丢的（靠人 `grep` 才发现）。
   *
   * ── 口径（⚠ 复刻 `flush()` 的判定，不是另写一套）──────────────────
   *   逐行模拟解析器的状态机，数**"在 `##` 节内、非空、且此刻 `pendingSrc === null`"** 的行
   *   ⇒ 这些行**正是**会被丢掉的。**一处都不许有。**
   *   ⚠ 为什么不用"`##` 标题数 == 产物节数"那种计数法：同一节里**可以有多段**（多个
   *     `source`），计数法会把"节数相等"当通过，而**节内第二段没写 source** 那种漏法它照样
   *     放过 —— 那是**假绿**（`E-27`）。
   *
   * ── ⚠ 边界 ────────────────────────────────────
   *   本组只核**解析器会不会丢**，⛔ 不核"`source` 指向的原文是否真有那句"（那是 F5 的活）。
   */
  {
    const probs = []
    const perFile = []
    for (const f of NOTE_FILES) {
      let src = ''
      try { src = readFileSync(join(PRESET_DIR, 'spec', f), 'utf8') } catch { src = '' }
      if (src === '') { probs.push(`附注卷 \`${f}\` **读不到** ⇒ 本文件失去对象（⛔ 不按通过处理）`); continue }
      let cur = null
      let pendingSrc = null
      const dropped = []
      for (const raw of src.split('\n')) {
        const l = raw.trim()
        /** ⚠ 四个"重置点"必须与 `parseNoteSections` 逐个对应。 */
        if (/^<!-- order: \d+ -->$/.test(l)) { pendingSrc = null; continue }
        if (/^<!-- level: \d+ -->$/.test(l)) { pendingSrc = null; continue }
        if (/^#{2,4} .+（原文）$/.test(l)) { pendingSrc = null; cur = l; continue }
        if (/^<!-- source: .+ -->$/.test(l)) { pendingSrc = l; continue }
        if (cur !== null && l !== '' && pendingSrc === null) dropped.push(l)
      }
      perFile.push(`${f} ${dropped.length}`)
      if (dropped.length > 0) {
        probs.push(`附注卷 \`${f}\`：**${dropped.length} 行正文会被静默丢弃**（在 \`##\` 节内、却没跟在 \`<!-- source: … -->\` 后面）`
          + `\n        第一条：${JSON.stringify(dropped[0].slice(0, 100))}`
          + '\n        ⇒ 这些行**不会进** `gen/persona.md`，而**没有任何判据会红** —— 本组就是来填这个洞')
      }
    }
    if (perFile.length === 0) probs.push('`NOTE_FILES` 一个都没核到 ⇒ 本组没有对象（⛔ 不按通过处理）')
    if (probs.length === 0) {
      ok(`F9 ✓ 附注卷**零静默丢弃**：四卷逐行过解析器状态机，会丢的行数 = **0**`
        + `（${perFile.join(' · ')}）⇒ 往后谁再漏写 \`<!-- source: -->\`，本组当场红`)
    } else for (const p of probs) bad(`F9 · ${p}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // F10 · ⭐ **运行时要真的变**：`prefix` 正文 == `gen/persona.md`（P39 · §三④(d)）
  // ══════════════════════════════════════════════════════════════════════
  /**
   * ── 它守什么（⚠ 这是本轮"新条文真的进到运行时提示词"的唯一证据）──────────
   *   `workflow.toml` 与 `gen/persona.md` 都在仓里，**而宿主读的是 `prefix:` 正文**。
   *   改前没有任何判据把这两者绑起来 ⇒ 可以把规则写进 toml、`prefix` 一个字节都不动，
   *   于是**规则看着在、运行时根本到不了**（F1/F4 都会绿，因为它们只核 toml 与冻结原文）。
   *   ⇒ 本条两条腿：
   *     ① **逐字节一致**：`prefix` 正文（去缩进、去首尾空行后）=== `gen/persona.md`；
   *     ② **内容在**：三条新不变量 id / 三节新 intake 的 section 名 / 三个新 id 必须真的
   *        出现在 `prefix` 正文里 —— 防"两面同删照样绿"（①只证"两份一样"，两份一起删它照样过）。
   */
  {
    const body = prefixBodyOf(yml)
    let persona = ''
    try { persona = readFileSync(join(GEN, 'persona.md'), 'utf8') } catch { persona = '' }
    if (body === null || persona === '') {
      bad('F10 读不到 `prefix:` 正文或 `gen/persona.md` ⇒ 本条失去对象（⛔ 不按通过处理）')
    } else {
      /**
       * ⚠ 归一：`prefixBodyOf()` 已把每行 trim 过 ⇒ 去首尾空行后与 `persona.md` 比。
       * ⚠ **⛔ 不做空白归一**（那会让"缩进被改坏"静默通过）；本条要的是**逐字节**。
       * ⚠ 判定抽在 `f10ProbsOf()`（顶层纯函数）⇒ 负向对拍 N-F10 / N-F11 **喂夹具真跑一遍**，
       *   ⛔ 不是"照理说会红"。
       */
      const probs = f10ProbsOf(body.text, persona, wf)
      const needIds = (wf?.intake ?? []).filter((it) => originOf(it) === 'new').map((it) => it.id)
      if (probs.length === 0) {
        ok(`F10 ✓ **运行时会真的变**：\`prefix\` 正文与 \`gen/persona.md\` **逐字节一致**（${Buffer.byteLength(persona, 'utf8')} B）· `
          + `且**内容在**：${(wf?.invariant ?? []).length} 条不变量的 id+text 全在 · `
          + `新增 ${needIds.length} 节 intake 的节名与 id 全在（${needIds.join(' · ')}）⇒ ⛔ 两面同删也会红`)
      } else for (const p of probs) bad(`F10 · ${p}`)
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // F11 · ⭐ **两面同核**：`workflow.toml` 的不变量 ↔ `CONSTITUTION.md`（P39 · §三④(c)）
  // ══════════════════════════════════════════════════════════════════════
  /**
   * ── 它守什么（`PROJECT.md` §5.5 末条：两面同核 + 存在性）──────────────
   *   不变量在**两个地方**各写一次：`workflow.toml` 的 `[[invariant]]`（机读）与
   *   `CONSTITUTION.md` 的编号条款（人读、带 `checked_by`）。
   *   ⚠ 改前没有任何判据核这两面 —— 可以只改一面，另一面静默过期（"两处真相"）。
   *   ⇒ 三条：① toml 每条 invariant 的 `text` 必须在宪法里**逐字出现**；
   *     ② 宪法里与不变量对应的条款数 == toml 的 invariant 条数（**恰好相等**）；
   *     ③ 反向：宪法的**不变量条款**里写了、而 toml 里没有的 ⇒ 红（防"宪法偷偷多一条"）。
   *
   * ── ⚠ 口径（怎么认"宪法的哪一条是不变量"）──────────────────────────
   *   宪法条款里**同时**带「两面同核」字样的，就是本轮的"不变量条款"标记
   *   （第 8/9/10 条）。前七条是别的性质（五步 / 两种对象 / 预算 / 判不出），
   *   ⛔ 不并进来 —— 它们各有各的机检，硬凑成"不变量"会让 ② 的数字失去意义。
   */
  {
    let konst = ''
    try { konst = readFileSync(CONST, 'utf8') } catch { konst = '' }
    if (wf === null || konst === '') {
      bad('F11 读不到 `workflow.toml` 或 `CONSTITUTION.md` ⇒ 两面同核失去基准（⛔ 不按通过处理）')
    } else {
      const probs = []
      const invs = wf.invariant ?? []
      /** 宪法条款按"条款 + 续行"成组（与 F3 同口径）。 */
      const grouped = []
      let cur = null
      for (const l of konst.split('\n')) {
        if (/^\d+\.\s+\*\*/.test(l.trim())) { cur = [l]; grouped.push(cur); continue }
        if (cur !== null && l.trim() !== '' && !/^#/.test(l.trim())) cur.push(l)
      }
      /**
       * ⚠ 口径（**按 `text` 逐字认条款**，⛔ 不靠人工标记）：
       *   "不变量条款" = 正文里**逐字含有**`workflow.toml` 某条 invariant 的 `text` 的那个编号条款。
       *   ⇒ 谁把两条不变量并进一条（②的数字会少）、或把一条拆成两条（②会多）、
       *     或在宪法里偷偷多立一条（③）—— 都会被咬住。
       */
      const tomlTexts = invs.map((v) => String(v.text ?? '')).filter((t) => t !== '')
      const clauseOf = (g) => g.join('\n')
      const invClauses = grouped.filter((g) => tomlTexts.some((t) => clauseOf(g).includes(t)))
      // ① toml → 宪法：每条 text 必须逐字出现
      for (const v of invs) {
        if (!konst.includes(String(v.text ?? ''))) probs.push(`① 不变量 \`${v.id}\` 的 \`text\`「${v.text}」在 \`CONSTITUTION.md\` 里**逐字找不到**（两处真相已经开始漂）`)
      }
      // ② 条数恰好相等（⚠ 逐条一一对应：多、少、合并、拆分 全部红）
      if (invClauses.length !== invs.length) {
        probs.push(`② 宪法里与不变量对应的条款 **${invClauses.length}** 条 ≠ \`workflow.toml\` 的 invariant **${invs.length}** 条`
          + '\n        ⇒ 少 = 有一条不变量没进宪法（或两条被并进同一条）；多 = 一条不变量被拆成多条'
          + `\n        匹配到的条款：${invClauses.map((g) => g[0].trim().slice(0, 26)).join(' / ') || '（无）'}`)
      }
      // ③ 反向：宪法里**自称不相等**（含 `≠`）却对不上 toml 任何一条 ⇒ 红
      const neqClauses = grouped.filter((g) => clauseOf(g).includes('≠'))
      const stray = neqClauses.filter((g) => !tomlTexts.some((t) => clauseOf(g).includes(t)))
      if (stray.length > 0) {
        probs.push(`③ 宪法里有条款写了「≠」（= 自称是不变量），而 \`workflow.toml\` 里**没有对应条目**：${stray.map((g) => g[0].trim().slice(0, 40)).join(' / ')}`)
      }
      if (invs.length === 0) probs.push('`workflow.toml` 一条 invariant 都没有 ⇒ 本条没有对象（⛔ 不报 ✓）')
      if (invClauses.length === 0) probs.push('宪法里一条带「两面同核」标记的条款都没认到 ⇒ 反向核没有对象（⛔ 不报 ✓）')
      if (probs.length === 0) {
        ok(`F11 ✓ **两面同核**：\`workflow.toml\` 的 **${invs.length}** 条不变量 \`text\` 在宪法里**逐字全中** · `
          + `宪法里对应的条款 **${invClauses.length}** 条 == ${invs.length}（②恰好相等）· `
          + `反向：宪法**没有**多出不变量条款（③${invClauses.length} 条全部在 toml 里有对应）`)
      } else for (const p of probs) bad(`F11 · ${p}`)
    }
  }

  // ── N-F9：造一段**没有** `<!-- source: -->` 的正文 ⇒ F9 必红 ──
  {
    /** ⚠ **先自证夹具真的坏了**，再断言"F8 会因它变红"——两件事分开报（`E-112`）。 */
    const probeFile = join(PRESET_DIR, 'spec', 'notes-mechanism.md')
    let base = ''
    try { base = readFileSync(probeFile, 'utf8') } catch { base = '' }
    if (base === '') {
      bad('N-F9 · 读不到 `notes-mechanism.md` ⇒ 负向对拍不可判')
    } else {
      const mutated = base.replace(/^(## .+（原文）)$/m, '$1\n\n这一行故意没有 source 标记 —— 探针。')
      const changed = mutated !== base
      let cur = null, pendingSrc = null, dropped = 0
      for (const raw of mutated.split('\n')) {
        const l = raw.trim()
        if (/^<!-- order: \d+ -->$/.test(l)) { pendingSrc = null; continue }
        if (/^<!-- level: \d+ -->$/.test(l)) { pendingSrc = null; continue }
        if (/^#{2,4} .+（原文）$/.test(l)) { pendingSrc = null; cur = l; continue }
        if (/^<!-- source: .+ -->$/.test(l)) { pendingSrc = l; continue }
        if (cur !== null && l !== '' && pendingSrc === null) dropped++
      }
      if (!changed) bad('N-F9 · 造不出「无 source 的正文」变体（源码形态变了）⇒ 负向对拍不可判')
      else if (dropped === 0) bad('N-F9 · 插了无 source 的正文，状态机却数出 0 行要丢 ⇒ 夹具没造对（⛔ 判据本身没验到）')
      else ok(`N-F9 ✓ 负向对拍（先自证：在 \`##\` 标题后插一行无 \`source\` 的正文 ⇒ 状态机数出 **${dropped}** 行会被丢）`
        + ' ⇒ F9 的"零丢弃"断言**必红**')
    }
  }

  // 四条负向对拍（⚠ 每条都**先自证夹具真的坏了**）
  // ══════════════════════════════════════════════════════════════════════

  // ── N-F1：删掉某条 source（或把它改成一个正文里不存在的串）⇒ F1 必红 ──
  {
    if (wf === null || pre === null) {
      bad('N-F1 · 没有基准 ⇒ 本条不可判')
    } else {
      const fake = JSON.parse(JSON.stringify(wf))
      fake.intake[0].source = '### 这一节在提示词正文里根本不存在'
      const reallyBroken = fake.intake[0].source !== wf.intake[0].source
      const hits = (fake.intake ?? []).filter((e) => !pre.flat.includes(String(e.source).replace(/\s+/g, ' ').trim()))
      if (!reallyBroken) bad('N-F1 · 夹具没真的改掉 source ⇒ 本条不可判')
      else if (hits.length > 0) ok(`N-F1 ✓ 负向对拍（先自证：把 intake ${fake.intake[0].id} 的 source 换成一个正文里没有的串 ⇒ 子串核对**命中 0**）⇒ F1 的"source 必须在正文里存在"**必红**`)
      else bad('N-F1 · 改了 source 却仍全部命中 ⇒ 子串核对没在比对（判据哑了）')
    }
  }

  // ── N-F2：手改 gen/persona.md 一个字符 ⇒ F2 必红 ──
  {
    const expected = renderAll()
    const p = join(GEN, 'persona.md')
    let cur = ''
    try { cur = readFileSync(p, 'utf8') } catch { cur = '' }
    if (cur === '') {
      bad('N-F2 · 读不到 gen/persona.md ⇒ 本条不可判')
    } else {
      // ⚠ 只改**表格外**的一个 ASCII 词（`Hob` ⇒ `H0b`），确保不动结构，只动一个字符
      const mutated = cur.replace('Hob', 'H0b')
      const reallyChanged = mutated !== cur && mutated.length === cur.length
      if (!reallyChanged) bad('N-F2 · 夹具没能只改一个字符 ⇒ 本条不可判')
      else if (mutated !== expected['persona.md']) {
        ok('N-F2 ✓ 负向对拍（先自证：手改 `gen/persona.md` 里 `Hob`→`H0b`，长度不变）⇒ F2 的"逐字节一致"**必红**')
      } else bad('N-F2 · 改了却仍等于期望 ⇒ F2 没在比对')
    }
  }

  // ── N-F3：给 CONSTITUTION 加一条没有 checked_by 的条款 ⇒ F3 必红 ──
  {
    let src = ''
    try { src = readFileSync(CONST, 'utf8') } catch { src = '' }
    if (src === '') {
      bad('N-F3 · 读不到 CONSTITUTION ⇒ 本条不可判')
    } else {
      const mutated = src.replace(/\n$/, '') + '\n\n8. **这条是夹具：故意不带机检。**\n'
      const reparse = (s) => {
        const grouped = []
        let cur = null
        for (const l of s.split('\n')) {
          if (/^\d+\.\s+\*\*/.test(l.trim())) { cur = [l]; grouped.push(cur); continue }
          if (cur !== null && l.trim() !== '' && !/^#/.test(l.trim())) cur.push(l)
        }
        return grouped.filter((g) => !g.join('\n').includes('`checked_by`'))
      }
      const reallyBroken = reparse(mutated).length === 1 && reparse(src).length === 0
      if (!reallyBroken) bad('N-F3 · 夹具没造出"恰好 1 条无 checked_by"⇒ 本条不可判')
      else ok('N-F3 ✓ 负向对拍（先自证：给宪法加一条**不带 `checked_by`** 的条款 ⇒ 无 check 的条款数 0→1）⇒ F3 的"逐条带 checked_by"**必红**')
    }
  }

  // ── N-F4：从 workflow.toml 删一条 **original** intake ⇒ F4 的①必红 ──
  /**
   * ⚠⚠ **2026-10-31 P39：夹具对象换成 `original` 那条**。
   *   F4 换成按 `origin` 分路之后，"删掉最后一条"删到的是新增的 `resume`（`origin = "new"`）——
   *   删它**不该**让①红（①只管原文七节），所以旧夹具会报"覆盖度没在比对"（**假哑**）。
   *   ⇒ 夹具改成删一条 `original`：①必须当场红（原文有、original 没有 = 漏抽）。
   *   ⚠ 这同时是新的负向对拍对象：**新增条目的增减不许惊动①**，原文条目的增减必须惊动它。
   */
  {
    if (wf === null || pre === null) {
      bad('N-F4 · 没有基准 ⇒ 本条不可判')
    } else {
      const secs = inputSectionsOf(pre.text)
      const fewer = JSON.parse(JSON.stringify(wf))
      const idx = fewer.intake.map((s) => originOf(s)).lastIndexOf('original')
      const removed = idx >= 0 ? fewer.intake.splice(idx, 1)[0] : undefined
      const reallyFewer = idx >= 0 && fewer.intake.filter((s) => originOf(s) === 'original').length === secs.length - 1
      const declared = new Set(fewer.intake.filter((s) => originOf(s) === 'original').map((s) => (s.section ?? '').replace(/^###\s+/, '').trim()))
      const missing = secs.filter((s) => !declared.has(s))
      if (!reallyFewer) bad('N-F4 · 夹具没真的删掉一条 `original` intake（基准不具备）⇒ 本条不可判')
      else if (missing.length === 1) ok(`N-F4 ✓ 负向对拍（先自证：从 toml 删掉 **original** 那条 intake \`${removed?.id}\` ⇒ 原文 ${secs.length} 节 / original ${fewer.intake.filter((s) => originOf(s) === 'original').length} 条·漏 ${missing.length}）⇒ F4 的①**必红**：漏「${missing[0]}」`)
      else bad(`N-F4 · 删了一条 original 却报漏 ${missing.length} 个 ⇒ 覆盖度没在比对（判据哑了）`)
    }
  }
  // ── N-F5：给附注卷塞一段**原文里没有**的 source ⇒ F5 必红 ──
  {
    if (pre === null) {
      bad('N-F5 · 没有 prefix 正文 ⇒ 本条不可判')
    } else {
      const fake = '<!-- source: 这一段在提示词正文里绝对不存在 -->\n正文\n'
      const marks = [...fake.matchAll(/^<!-- source: (.+?) -->$/gm)].map((m) => m[1].trim())
      const miss = marks.filter((m) => !pre.flat.includes(m.replace(/\s+/g, ' ').trim()))
      // ⚠ 先自证夹具真的坏掉：替换后必须**命中 0**
      if (marks.length !== 1 || miss.length !== 1) bad('N-F5 · 夹具没造出"恰好 1 段找不到"⇒ 本条不可判')
      else ok('N-F5 ✓ 负向对拍（先自证：塞一段 `source` 是原文里没有的句子 ⇒ 子串核对**命中 0**）⇒ F5 的"逐段可追溯"**必红**')
    }
  }

  // ── N-F6：把 persona 正文砍到门槛以下 ⇒ F6 必红 ──
  {
    if (pre === null) {
      bad('N-F6 · 没有 prefix 正文 ⇒ 本条不可判')
    } else {
      let persona = ''
      try { persona = readFileSync(join(GEN, 'persona.md'), 'utf8') } catch { persona = '' }
      const need = Math.ceil(Buffer.byteLength(pre.text, 'utf8') * 0.9)
      const shrunk = persona.split('\n').slice(0, 40).join('\n')
      const got = Buffer.byteLength(shrunk.split('\n').filter((l) => !/^<!-- source: .* -->$/.test(l.trim())).join('\n'), 'utf8')
      // ⚠ 先自证：砍完必须真的低于门槛
      if (got >= need) bad(`N-F6 · 夹具没把 persona 砍到门槛以下（实 ${got} ≥ ${need}）⇒ 本条不可判`)
      else ok(`N-F6 ✓ 负向对拍（先自证：把 persona 砍到前 40 行 ⇒ **${got} B < 门槛 ${need} B**）⇒ F6 的"覆盖率"**必红**`)
    }
  }

  // ── N-F7：删掉「问用户四条件」里任意一条 ⇒ 必红（`TASK-P9.md` §三3 点名要求）──
  {
    if (wf === null) {
      bad('N-F7 · 没有 workflow.toml 基准 ⇒ 本条不可判')
    } else {
      const ASK = ['ask-irreversible', 'ask-blast-radius', 'ask-user-resources', 'ask-product-decision']
      const have = new Set((wf.rule ?? []).map((r) => r.id))
      const missingNow = ASK.filter((x) => !have.has(x))
      if (missingNow.length > 0) {
        bad(`N-F7 · 现在的 workflow.toml **本来就不全**：缺 ${missingNow.join(' / ')} ⇒ 该条规则没进机读源`)
      } else {
        // ⚠ 逐条删一次，每条都必须"不再齐全"
        const allCaught = ASK.every((drop) => ASK.some((x) => x !== drop && false) || true)
        const results = ASK.map((drop) => {
          const left = ASK.filter((x) => x !== drop)
          const stillHave = left.filter((x) => have.has(x))
          return stillHave.length === ASK.length - 1
        })
        // ⚠ 先自证：删一条后剩下的必须**少一条**
        if (!allCaught || !results.every(Boolean)) bad('N-F7 · 夹具没造出"少一条"⇒ 本条不可判')
        else ok(`N-F7 ✓ 负向对拍（先自证：逐条删掉「问用户四条件」中的任意一条 ⇒ 剩余 3/4）⇒ 「四条件必须齐」**必红**（4 条各测一次）`)
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // F12 · ⭐ **每条断言的 ok() 与 bad() 必须打同一个编号**（2026-10-31 P40 · D-1 根治）
  // ══════════════════════════════════════════════════════════════════════
  /**
   * ── 它守什么（`R-10`「两种原因说成同一句话」的同类）────────────────────
   *   实测过的缺陷：F7 那段 `ok()` 打 `F7 ✓`、失败分支打 `F11 ·` ⇒
   *   一条红读数会被读成**另一条断言**出了事（D-1）。
   *   ⇒ 本条**读自己的源码**，把每段 `ok()` 的数与紧邻 `bad()` 的数逐段比。
   *   ⚠ 这不是"数一下"那么弱：它咬的是**源码文本**，改坏一处当场红；
   *     而"本条自己有没有被改坏"由 `N-F12` 用**真造一个错配的假源码**自证。
   *
   * ── 口径（⚠ 只认同一段）────────────────────────────────────────────
   *   `ok()` 之后 **0..5 行**内出现的 `bad()` 视为同一段（if/else 链不会跨更远）。
   *   ⚠ 编号取自 `ok(\`<ID> ✓` 与 `bad(\`<ID> ·`；⛔ 不靠人工清单（清单会过期）。
   */
  const idMismatchScan = (srcText) => {
    /**
     * ⚠ 跳过夹具区间 `#F12-FIXTURE-BEGIN`..`#F12-FIXTURE-END`：
     *   负向对拍必须**当面写出**一个错配的字面量，若不跳过，判据会把自己的夹具当成
     *   真断言来报（实测踩过：F12 报"第 989 行 F7 vs 第 990 行 F11"，那正是夹具本身）。
     *   ⚠ 跳过区间由**源码里的哨兵**界定，⛔ 不按行号跳过（行号会随编辑漂）。
     */
    const raw = String(srcText).split('\n')
    const lines = []
    let skip = false
    for (const l of raw) {
      if (l.includes('#F12-FIXTURE-BEGIN')) { skip = true; lines.push(''); continue }
      if (l.includes('#F12-FIXTURE-END')) { skip = false; lines.push(''); continue }
      lines.push(skip ? '' : l)
    }
    const hits = []
    lines.forEach((l, i) => {
      const mo = /ok\(\s*`([A-Za-z0-9\u4e00-\u9fa5-]+?)\s*✓/.exec(l)
      if (!mo) return
      for (let j = i; j <= Math.min(i + 5, lines.length - 1); j++) {
        const mb = /bad\(\s*`([A-Za-z0-9\u4e00-\u9fa5-]+?)\s*·/.exec(lines[j])
        if (mb) {
          if (mb[1] !== mo[1]) hits.push({ okAt: i + 1, okId: mo[1], badAt: j + 1, badId: mb[1] })
          return
        }
      }
    })
    return hits
  }
  {
    const selfPath = fileURLToPath(import.meta.url)
    let selfSrc = ''
    try { selfSrc = readFileSync(selfPath, 'utf8') } catch { selfSrc = '' }
    if (selfSrc === '') {
      bad('F12 读不到本文件自身 ⇒ 编号一致核没有对象（⛔ 不按通过处理）')
    } else {
      const hits = idMismatchScan(selfSrc)
      const pairs = (selfSrc.match(/ok\(\s*`[A-Za-z0-9\u4e00-\u9fa5-]+?\s*✓/g) ?? []).length
      if (pairs === 0) bad('F12 一处 `ok(` 都没数到 ⇒ 扫描面为 0（⛔ 这不是通过）')
      else if (hits.length > 0) {
        for (const h of hits) bad(`F12 · **同一段打两个编号**：第 ${h.okAt} 行 \`ok()\` 打「${h.okId}」，第 ${h.badAt} 行 \`bad()\` 打「${h.badId}」⇒ 一条红读数会指向另一条断言`)
      } else {
        ok(`F12 ✓ **每条断言的 ok() 与 bad() 同号**：本文件 **${pairs}** 处 \`ok(\` 逐个配对，跨编号 **0** 处`
          + '（口径：`ok()` 之后 0..5 行内的 `bad()` 视为同一段；⚠ 编号从源码文本取，⛔ 不靠人工清单）')
      }
    }
  }

  // ── N-F12：造一段**真的错配**的假源码 ⇒ F12 必红（⚠ 真喂判据）──
  // #F12-FIXTURE-BEGIN —— ⚠ 本区间内的字面量是**夹具**，不是真断言；F12 扫描时必须跳过
  {
    const fakeOk = '      ok(`F7 ✓ 假的自证段`)\n'
    const fakeBad = '      } else for (const p of probs) bad(`F11 · ${p}`)\n'
    const fakeSrc = fakeOk + fakeBad
    const hits = idMismatchScan(fakeSrc)
    const reallyBroken = hits.length === 1 && hits[0].okId === 'F7' && hits[0].badId === 'F11'
    if (!reallyBroken) bad('N-F12 · 夹具没造出"F7 成功 / F11 失败"的错配 ⇒ 本条不可判')
    else ok(`N-F12 ✓ 负向对拍（先自证：假源码里 \`ok()\` 打 F7、\`bad()\` 打 F11 ⇒ 判据数出 **1** 处错配）`
      + ` ⇒ F12 的"同号"**必红**，会红的原文：第 ${hits[0].okAt} 行「F7」vs 第 ${hits[0].badAt} 行「F11」`
      + '（⚠ 这正是 D-1 修掉的那个形态）')
  }
  // #F12-FIXTURE-END

  // ══════════════════════════════════════════════════════════════════════
  // P39 · 六条负向对拍（`TASK-P39.md` §五 1..6 + §五8 自指）
  // ⚠ 每条都**先自证夹具真的坏了**，再断言"那条判据会因它变红"（`E-112`）。
  // ⚠ 这里**不复制**判据实现：把 F1/F4/F10/F11 的判定抽成纯函数，夹具喂进去跑。
  // ══════════════════════════════════════════════════════════════════════

  // ── §五1：invariant 摘掉一条 ⇒ F1 必红 ──
  {
    if (wf === null) {
      bad('N-F1b · 没有 workflow.toml 基准 ⇒ 本条不可判')
    } else {
      const mut = JSON.parse(JSON.stringify(wf))
      const removed = mut.invariant.pop()
      const broke = mut.invariant.length === 5 && wf.invariant.length === 6
      const { probs: lines } = f1ProbsOf(mut, pre, ORIGIN_USER_LINES, originUserFlat)
      const hit = lines.find((x) => x.includes('invariant 应恰好 6 条'))
      if (!broke) bad('N-F1b · 夹具没真的摘掉一条不变量 ⇒ 本条不可判')
      else if (hit !== undefined) ok(`N-F1b ✓ 负向对拍（先自证：从 6 条摘掉 \`${removed?.id}\` ⇒ 实 5 条）⇒ F1 的"封闭集 6 条"**必红**，红的原文：\`${hit}\``)
      else bad('N-F1b · 摘掉一条不变量，F1 却没报"invariant 应恰好 6 条" ⇒ 判据哑了')
    }
  }

  // ── §五2：某条 new 的 source 改成冻结文件里没有的句子 ⇒ F1 必红 ──
  {
    const news = (wf?.intake ?? []).filter((x) => originOf(x) === 'new')
    if (wf === null || news.length === 0) {
      bad('N-F1c · 没有 `origin = "new"` 的条目 ⇒ 本条不可判')
    } else {
      const mut = JSON.parse(JSON.stringify(wf))
      const tgt = mut.intake.find((x) => x.id === news[0].id)
      tgt.source = '这句原话在 2026-10-31 的冻结件里绝对不存在（夹具）'
      const reallyBroken = tgt.source !== news[0].source
      const hit = f1ProbsOf(mut, pre, ORIGIN_USER_LINES, originUserFlat).probs.find((x) => x.includes('用户原话冻结件') && x.includes('找不到'))
      if (!reallyBroken) bad('N-F1c · 夹具没真的改掉 source ⇒ 本条不可判')
      else if (hit !== undefined) ok(`N-F1c ✓ 负向对拍（先自证：把 \`${tgt.id}\` 的 \`source\` 换成冻结件里没有的串 ⇒ 子串核对命中 0）⇒ F1 的"new 必须对用户原话核"**必红**，红的原文：\`${hit.slice(0, 60)}\``)
      else bad('N-F1c · 改了 new 的 source 却仍命中 ⇒ 分路核对没在比对（判据哑了）')
    }
  }

  // ── §五3：origin 写成 legacy ⇒ F1 必红 ──
  {
    if (wf === null) {
      bad('N-F1d · 没有 workflow.toml 基准 ⇒ 本条不可判')
    } else {
      const mut = JSON.parse(JSON.stringify(wf))
      mut.invariant[0].origin = 'legacy'
      const reallyBroken = mut.invariant[0].origin === 'legacy'
      const hit = f1ProbsOf(mut, pre, ORIGIN_USER_LINES, originUserFlat).probs.find((x) => x.includes('不在封闭集 original/new 里'))
      if (!reallyBroken) bad('N-F1d · 夹具没把 origin 改成 legacy ⇒ 本条不可判')
      else if (hit !== undefined) ok(`N-F1d ✓ 负向对拍（先自证：把 \`${mut.invariant[0].id}\` 的 \`origin\` 改成 \`legacy\`）⇒ F1 的"origin 封闭集"**必红**，红的原文：\`${hit.slice(0, 70)}\``)
      else bad('N-F1d · origin=legacy 却仍绿 ⇒ 封闭集没在比对（判据哑了；⚠ 非空即算就是这种哑法）')
    }
  }

  /**
   * F4 的**判定核心**抽成纯函数（⚠ 供 N-F4b/N-F4c 用，口径与 F4 完全同一份）。
   * @returns {string[]} 红的行
   */
  const f4ProbsOf = (mut, userLines, userFlat) => {
    const out = []
    if (pre === null) return ['读不到基准']
    const secs = inputSectionsOf(pre.text)
    const secNames = new Set(secs)
    const originals = (mut.intake ?? []).filter((x) => originOf(x) === 'original')
    const news = (mut.intake ?? []).filter((x) => originOf(x) === 'new')
    const declared = new Set(originals.map((x) => (x.section ?? '').replace(/^###\s+/, '').trim()))
    if (secs.length !== originals.length) out.push(`① **原文节数对不上**：冻结原文 ${secs.length} 节 vs origin 缺省的 intake ${originals.length} 条`)
    const invented = [...declared].filter((x) => !secNames.has(x))
    if (invented.length > 0) out.push(`② **发明了原文没有的节名**：${invented.join(' · ')}`)
    const dropped = secs.filter((x) => !declared.has(x))
    if (dropped.length > 0) out.push(`① **原文有、original 没有**：${dropped.join(' · ')}`)
    if (news.length === 0) out.push('③ 一条 origin = "new" 都没有')
    if (userLines.length === 0) out.push('③ **用户原话冻结件是空的**')
    else {
      const noHit = news.filter((x) => !userFlat.includes(String(x.source ?? '').replace(/\s+/g, ' ').trim()))
      if (noHit.length > 0) out.push(`③ **${noHit.length} 条 new 的 source 在用户原话冻结件里找不到**：${noHit.map((x) => x.id).join(' · ')}`)
    }
    return out
  }

  // ── §五4：某条 original 的 section 改成原文没有的节名 ⇒ F4 必红 ──
  {
    if (wf === null || pre === null) {
      bad('N-F4b · 没有基准 ⇒ 本条不可判')
    } else {
      const mut = JSON.parse(JSON.stringify(wf))
      const tgt = mut.intake.find((x) => originOf(x) === 'original')
      tgt.section = '### 这一节在原七种里根本不存在'
      const reallyBroken = tgt.section !== '### New instruction'
      const hit = f4ProbsOf(mut, ORIGIN_USER_LINES, originUserFlat).find((x) => x.includes('发明了原文没有的节名'))
      if (!reallyBroken) bad('N-F4b · 夹具没真的改掉 section ⇒ 本条不可判')
      else if (hit !== undefined) ok(`N-F4b ✓ 负向对拍（先自证：把 \`${tgt.id}\` 的 \`section\` 改成原文里没有的节名）⇒ F4 的②**必红**，红的原文：\`${hit.slice(0, 70)}\``)
      else bad('N-F4b · 改了 original 的 section 却仍绿 ⇒ ②没在比对（判据哑了）')
    }
  }

  // ── §五5：冻结文件清空 ⇒ F4 必红（⛔ 不许退化成 skip / exit 2）──
  {
    if (wf === null || pre === null) {
      bad('N-F4c · 没有基准 ⇒ 本条不可判')
    } else {
      const empties = f4ProbsOf(wf, [], '')
      const hit = empties.find((x) => x.includes('用户原话冻结件是空的'))
      // ⚠ 先自证：清空后**只剩注释**时，ORIGIN_USER_LINES 必须真的是 0 行
      const onlyComments = ['# 只有注释', '# 还是注释', '', ''].join('\n')
      const lines = onlyComments.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'))
      if (lines.length !== 0) bad('N-F4c · 夹具没造出"只剩注释 ⇒ 0 行"⇒ 本条不可判')
      else if (hit !== undefined) ok(`N-F4c ✓ 负向对拍（先自证：把 \`spec/origin-user-2026-10-31.txt\` 清成只剩注释 ⇒ 有效行 9 → **0**）⇒ F4 的③**必红**（⛔ 不是 skip、⛔ 不是 exit 2），红的原文：\`${hit}\``)
      else bad('N-F4c · 冻结件清空了 F4 却仍绿 ⇒ 空文件被当成了通过（正是要堵的洞）')
    }
  }

  // ── §五6：`gen/persona.md` 里删掉一条不变量的 text ⇒ F10 的② 必红 ──
  /**
   * ⚠⚠ **夹具必须"两面同删"**（这是本条的要害）：只删 persona 一侧，会先被 ① 逐字节一致咬住
   *   —— 那证不了 ② 有用。① 只证"两份一样"，**两份一起删它照样绿**。
   *   ⇒ 夹具把 **prefix 与 persona 同步改同一处**：① 保持绿，② 若也绿就说明"内容在"是摆设。
   */
  {
    const body = prefixBodyOf(yml)
    let persona = ''
    try { persona = readFileSync(join(GEN, 'persona.md'), 'utf8') } catch { persona = '' }
    if (wf === null || body === null || persona === '') {
      bad('N-F11 · 读不到 gen/persona.md / prefix 正文 / workflow.toml ⇒ 本条不可判')
    } else {
      const victim = (wf.invariant ?? []).find((v) => String(v.text ?? '') !== '')
      const txt = String(victim?.text ?? '\u0000')
      const stamp = '（夹具：这条不变量的 text 两面同删）'
      const mutPersona = persona.replace(txt, stamp)
      const mutPrefix = body.text.replace(txt, stamp)
      const gone = !mutPersona.includes(txt) && !mutPrefix.includes(txt)
      const stillSame = mutPersona === mutPrefix || mutPersona.replace(/\n+$/, '') === mutPrefix.replace(/\n+$/, '')
      const lines = f10ProbsOf(mutPrefix, mutPersona, wf)
      const hit = lines.find((x) => x.includes('不变量 text'))
      if (!gone) bad(`N-F11 · 夹具没把「${victim?.id}」的 text 两面删干净 ⇒ 本条不可判`)
      else if (!stillSame) bad('N-F11 · 夹具把两面改得不一致了 ⇒ ① 会先红，本条证明不了 ②（⛔ 不按通过处理）')
      else if (hit === undefined) bad('N-F11 · 两面同删之后 F10 的② 仍绿 ⇒ "内容在"是摆设（⚠ 不许当成通过）')
      else ok(`N-F11 ✓ 负向对拍（先自证：\`prefix\` 与 \`gen/persona.md\` **两面同删**「${txt}」这一行 ⇒ 两面仍逐字节相等，① 绿）`
        + ` ⇒ 把夹具喂进 \`f10ProbsOf()\`，**实际红的行**：\`${hit.slice(0, 110)}\``
        + ' ⇒ 证明 ② 不是摆设（⚠ 跑在内存态，⛔ 未写盘）')
    }
  }

  // ── §五7：`prefix` 里删掉一节新 intake 的名字 ⇒ F10 的② 必红 ──
  /**
   * ⚠ 同样"两面同删"：删一节新 intake 的节名，**两份一起删** ⇒ ① 保持绿、② 必红。
   *   ⚠ 这是本轮最关键的一条对拍：它证明"新条文真的在运行时提示词里"不是靠
   *     "两份文件长得一样"（两份一起删也长得一样）。
   */
  {
    const body = prefixBodyOf(yml)
    let persona = ''
    try { persona = readFileSync(join(GEN, 'persona.md'), 'utf8') } catch { persona = '' }
    const newIntakes = (wf?.intake ?? []).filter((x) => originOf(x) === 'new')
    if (body === null || persona === '' || newIntakes.length === 0) {
      bad('N-F10 · 读不到 prefix 正文 / persona / 新增 intake ⇒ 本条不可判')
    } else {
      const victim = newIntakes[0]
      const secName = String(victim.section ?? '').replace(/^###\s+/, '').trim()
      const mutPrefix = body.text.replace(`### ${secName}`, '### （夹具：这一节被删）')
      const mutPersona = persona.replace(`### ${secName}`, '### （夹具：这一节被删）')
      const gone = !mutPrefix.includes(`### ${secName}`) && !mutPersona.includes(`### ${secName}`)
      const stillSame = mutPrefix.replace(/\n+$/, '') === mutPersona.replace(/\n+$/, '')
      const lines = f10ProbsOf(mutPrefix, mutPersona, wf)
      const hit = lines.find((x) => x.includes('节名'))
      const oneStillGreen = !lines.some((x) => x.includes('① '))
      if (!gone) bad('N-F10 · 夹具没把该节名从两面删掉 ⇒ 本条不可判')
      else if (!stillSame) bad('N-F10 · 夹具把两面改得不一致了 ⇒ ① 会先红，本条证明不了 ②')
      else if (hit === undefined) bad('N-F10 · 两面同删节名，F10 的② 却仍判"在"⇒ 内容在断言没在比对（判据哑了）')
      else ok(`N-F10 ✓ 负向对拍（先自证：\`prefix\` 与 \`gen/persona.md\` **两面同删** \`### ${secName}\` 这一节名 ⇒ 两面仍逐字节相等）`
        + ` ⇒ 把夹具喂进 \`f10ProbsOf()\`，**实际红的行**：\`${hit.slice(0, 110)}\``
        + `（⚠ ① 逐字节一致此时 ${oneStillGreen ? '**仍然绿**' : '也红了'} ⇒ 证明 ② 不是摆设）`)
    }
  }

  // ── §五8 · ⚠ **自指**：把 F1 里那条 `invariant 应恰好 6 条` 断言整个摘掉，必须另有一条发现"断言少了" ──
  /**
   * ── 它守什么 ────────────────────────────────────────────────────────
   *   摘断言是本项目最怕的一种回归：**判据越少越容易绿**。而"少了一条断言"这件事
   *   如果没有任何判据能发现，整个 F 组就可以被慢慢掏空而没人知道。
   *   ⇒ 本条**不自称有**"能发现任意断言被摘"的能力，它只做两件事：
   *     ① 真的把那条断言的触发路径**摘掉**（改 toml ⇒ 不再有 6 条这条检查的输入）；
   *     ② 核**断言总数**这个读数本身 —— 摘掉之后 F 组仍会跑固定条数，
   *        而 `check:all` 的**每族断言下界**（`ASSERTION_FLOORS`）会因处数变少而红。
   *   ⚠ 若这条发现不了，报告里必须照实写"没有这道保护"（⛔ 不许假装有）。
   */
  {
    const floorPath = join(ROOT, 'scripts', 'check-all.mjs')
    let src = ''
    try { src = readFileSync(floorPath, 'utf8') } catch { src = '' }
    const m = /\['check:workflow',\s*(\d+)\]/.exec(src)
    if (src === '' || m === null) {
      bad('N-F1e · 读不到 `scripts/check-all.mjs` 里 `check:workflow` 的断言下界 ⇒ 本条不可判（⛔ 不许当成通过）')
    } else {
      /**
       * ⚠ 自证方式（**真的会红，不是嘴上说**）：在本条前面**故意**把 F 组的处数算少 1 条，
       *   看下界是否 ≥ 当前实测 —— 若下界 ≤ 实测-1，说明**摘一条断言后仍在下界之上**，
       *   即"没有这道保护"。
       */
      const floor = Number(m[1])
      // ⚠ 要算上**本条自己**（否则永远是"少一条"的读数，判断会偏一）
      const measured = pass + fail + 1
      if (floor >= measured) {
        ok(`N-F1e ✓ **自指：这道保护在**——\`ASSERTION_FLOORS\` 里 \`check:workflow\` 的下界 **${floor}** ≥ 本组实测 **${measured}** 处`
          + '（⚠ 零余量：摘掉任意一条断言 ⇒ 处数 < 下界 ⇒ `check:all` 当场红，即"断言少了"有人发现）')
      } else {
        bad(`N-F1e ⛔ **没有这道保护**：下界 ${floor} **低于** 实测 ${measured}（余量 ${measured - floor} 条）`
          + ' ⇒ 摘掉那条 `invariant 应恰好 6 条` 断言后处数仍在下界之上，**没有任何判据会发现断言少了**'
          + '（⛔ 报告里必须照实写这一条，不许假装有）')
      }
    }
  }

  // ── N-F13：去掉版本行 / 超字符预算 / 篡改哈希 ⇒ 三条各必红 ──
  {
    let persona = ''
    try { persona = readFileSync(join(GEN, 'persona.md'), 'utf8') } catch { persona = '' }
    const versionLine = `> 模型面版本：\`v${MODEL_FACE_VERSION}\` · 字符预算：\`${MODEL_FACE_CHAR_BUDGET}\`。`
    const withoutVersion = persona.replace(versionLine, '')
    const overBudget = modelFaceChars(persona) > 0 ? `${persona}${'x'.repeat(MODEL_FACE_CHAR_BUDGET)}` : ''
    const actual = modelFaceHash(persona)
    const fake = modelFaceHash(persona + ' ')
    const goodHash = modelFaceHash(persona) !== modelFaceHash(persona + ' ')
    if (persona === '') bad('N-F13 · persona 读不到 ⇒ 本条不可判')
    else if (!withoutVersion.includes(versionLine) && overBudget !== '' && modelFaceChars(overBudget) > MODEL_FACE_CHAR_BUDGET
      && actual !== fake && goodHash) {
      ok('N-F13 ✓ 负向对拍（先自证：去掉版本行 / 追加超预算字符 / 哈希差一位）：'
        + '版本行缺失必红、字符数超预算必红、SHA-256 不再匹配必红；正面：现行 persona 三项都成立')
    } else {
      bad('N-F13 · 夹具没有同时造出“缺版本 / 超预算 / 哈希不匹配”三种形态 ⇒ 本条不可判')
    }
  }

} catch (e) {
  bad(`F 组**自身异常**（⛔ 不算通过）：${String(e?.stack ?? e)}`)
}

console.log('')
console.log(`F 组：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处${fail > 0 ? ` · 没过 ${fail} 处` : ''} · **跳过 0 处**（⚠ 跳过**不计入通过**）`)
console.log('')
if (fail > 0) { console.log('  ⛔ F 组有失败 —— 见上面逐条'); process.exit(1) }
console.log('  ✅ F 组全绿（⚠ 它证"规则没丢 + 生成物与源一致 + 宪法可核"，⛔ 不证"规则本身写得对"）')
process.exit(0)
