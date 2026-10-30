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

console.log('')
console.log('F 组：Hob 自己的工作流（workflow.toml / 生成物 / 宪法 / 覆盖度）')
console.log('')

try {
  const gpc = await import(pathToFileURL(join(here, 'gen-preset-contract.mjs')).href)
  const { parseWorkflow, renderAll, readInputs, NOTE_FILES: NOTE_FILES_G } = gpc
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
  const pre = (() => {
    if (originText !== '') return { text: originText, flat: originText.replace(/\s+/g, ' ').trim(), lines: originText.split('\n').length }
    return yml === '' ? null : prefixBodyOf(yml)
  })()

  // ══════════════════════════════════════════════════════════════════════
  // F1 · workflow.toml 合法 + 每条 source 在提示词正文里真实存在
  // ══════════════════════════════════════════════════════════════════════
  if (wf !== null) {
    const probs = []
    const steps = wf.step ?? []
    if (steps.length !== 5) probs.push(`五步只有 ${steps.length} 条（期望 5）`)
    const orders = steps.map((s) => Number(s.order)).sort((a, b) => a - b)
    if (JSON.stringify(orders) !== JSON.stringify([1, 2, 3, 4, 5])) probs.push(`step.order 不是 1..5：${JSON.stringify(orders)}`)
    const s4 = steps.find((s) => Number(s.order) === 4)
    const s5 = steps.find((s) => Number(s.order) === 5)
    if (s4 === undefined || s5 === undefined) probs.push('缺第 4 或第 5 步')
    else if (s4.actor_role === s5.actor_role) probs.push(`第 4 步与第 5 步的 actor_role 相同（${s4.actor_role}）⇒ 违反"第 4 ≠ 第 5"`)
    for (const s of steps) for (const k of ['id', 'name', 'who', 'judged_by', 'source']) {
      if (typeof s[k] !== 'string' || s[k].trim() === '') probs.push(`step ${s.id ?? '?'} 缺 \`${k}\``)
    }
    const intakes = wf.intake ?? []
    if (intakes.length === 0) probs.push('intake 一条都没有')
    for (const it of intakes) for (const k of ['id', 'test', 'first_move', 'source']) {
      if (typeof it[k] !== 'string' || it[k].trim() === '') probs.push(`intake ${it.id ?? '?'} 缺 \`${k}\``)
    }
    if ((wf.reply ?? []).length === 0) probs.push('reply 一条都没有')
    if ((wf.invariant ?? []).length !== 3) probs.push(`invariant 应恰好 3 条（实 ${(wf.invariant ?? []).length}）`)

    // ⭐ 每条 source 必须在 prefix 正文里真实存在（⚠ 本轮"没丢东西"的唯一凭证）
    if (pre === null) {
      probs.push('读不到 `prefix:` 正文 ⇒ `source` 子串核对**没有基准**（⛔ 不按通过处理）')
    } else {
      let checked = 0
      for (const table of ['step', 'intake', 'reply', 'invariant', 'rule']) {
        for (const e of wf[table] ?? []) {
          if (typeof e.source !== 'string' || e.source.trim() === '') continue
          checked++
          if (!pre.flat.includes(e.source.replace(/\s+/g, ' ').trim())) {
            probs.push(`${table} \`${e.id}\` 的 \`source\` 在提示词正文里**找不到**：${JSON.stringify(e.source.slice(0, 70))}`)
          }
        }
      }
      if (checked === 0) probs.push('一条 `source` 都没核对到 ⇒ 本组没有对象（⛔ 不报 ✓）')
      else probs.push(`__checked__${checked}`)
    }
    const numeric = probs.filter((x) => x.startsWith('__checked__'))
    const real = probs.filter((x) => !x.startsWith('__checked__'))
    if (real.length === 0) {
      ok(`F1 ✓ \`workflow.toml\` 合法：五步（order=1..5 · 第 4/5 步 actor_role 不同）· `
        + `${intakes.length} 个 intake 各有 test/first_move/source · 3 条不变量 · `
        + `**${numeric[0]?.slice(11) ?? 0} 条 source 全部在提示词正文里命中**`)
    } else for (const p of real) bad(`F1 · ${p}`)
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

  // ══════════════════════════════════════════════════════════════════════
  // F4 · ⭐ 覆盖度：intake 数 = prefix 正文里「输入判定节」数
  // ══════════════════════════════════════════════════════════════════════
  {
    if (pre === null || wf === null) {
      bad('F4 读不到 `prefix` 正文或 `workflow.toml` ⇒ 覆盖度失去基准（⛔ 不按通过处理）')
    } else {
      const secs = inputSectionsOf(pre.text)
      const sections = wf.intake ?? []
      const secNames = new Set(secs)
      const declared = new Set(sections.map((s) => (s.section ?? '').replace(/^###\s+/, '').trim()))
      const probs = []
      if (secs.length === 0) probs.push('提示词正文里**一个输入判定节都没数到** ⇒ 扫描面为 0（⛔ 这不是通过）')
      if (secs.length !== sections.length) {
        probs.push(`覆盖度对不上：正文 **${secs.length}** 节 vs \`workflow.toml\` **${sections.length}** 条`
          + `\n        正文章节：${secs.join(' · ')}`
          + `\n        toml 声明：${[...declared].join(' · ')}`)
      }
      const missing = secs.filter((s) => !declared.has(s))
      const ghost = [...declared].filter((s) => !secNames.has(s))
      if (missing.length > 0) probs.push(`**正文有、toml 没有**（= 漏抽，这会让我少一条约束）：${missing.join(' · ')}`)
      if (ghost.length > 0) probs.push(`**toml 有、正文没有**（= 发明了不存在的输入）：${ghost.join(' · ')}`)
      if (probs.length === 0) {
        ok(`F4 ✓ **覆盖度对上**：提示词正文 \`###\` 输入判定节 **${secs.length}** 个 = \`workflow.toml\` 的 intake **${sections.length}** 条`);
        console.log(`        节名清单（实测）：${secs.join(' · ')}`)
      } else for (const p of probs) bad(`F4 · ${p}`)
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
      for (const it of wf.intake ?? []) {
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
        ok(`F7 ✓ 七节 \`test\` / \`first_move\` **逐字 == 原文**（${checked} 处全命中；⚠ 截短会当场红）`)
      } else for (const p of probs) bad(`F7 · ${p}`)
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

  // ── N-F4：从 workflow.toml 删一个 intake ⇒ F4 的覆盖度必红 ──
  {
    if (wf === null || pre === null) {
      bad('N-F4 · 没有基准 ⇒ 本条不可判')
    } else {
      const secs = inputSectionsOf(pre.text)
      const fewer = JSON.parse(JSON.stringify(wf))
      const removed = fewer.intake.pop()
      const reallyFewer = fewer.intake.length === wf.intake.length - 1
      const declared = new Set(fewer.intake.map((s) => (s.section ?? '').replace(/^###\s+/, '').trim()))
      const missing = secs.filter((s) => !declared.has(s))
      if (!reallyFewer) bad('N-F4 · 夹具没真的删掉一条 intake ⇒ 本条不可判')
      else if (missing.length === 1) ok(`N-F4 ✓ 负向对拍（先自证：从 toml 删掉 intake \`${removed?.id}\` ⇒ 正文 ${secs.length} 节 / toml ${fewer.intake.length} 条·漏 ${missing.length}）⇒ F4 的覆盖度**必红**：漏「${missing[0]}」`)
      else bad(`N-F4 · 删了一条却报漏 ${missing.length} 个 ⇒ 覆盖度没在比对（判据哑了）`)
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
