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
  const { parseWorkflow, renderAll, readInputs } = gpc

  let wfSrc = ''
  try { wfSrc = readFileSync(WF, 'utf8') } catch { wfSrc = '' }
  let wf = null
  try { wf = parseWorkflow(wfSrc) } catch (e) {
    bad(`F1 \`workflow.toml\` **解析不了**（${String(e?.message ?? e)}）⇒ 以下三条失去基准（⛔ 不按通过处理）`)
  }
  let yml = ''
  try { yml = readFileSync(YML, 'utf8') } catch { yml = '' }
  const pre = yml === '' ? null : prefixBodyOf(yml)

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

  // ══════════════════════════════════════════════════════════════════════
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
