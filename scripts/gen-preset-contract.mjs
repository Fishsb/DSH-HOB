#!/usr/bin/env node
/**
 * **Hob 工作流 · 契约生成器**（2026-10-30 · P8 · `TASK-P8.md` §二）。
 *
 * ══ 它做什么 ═══════════════════════════════════════════════════════════════════
 *   `preset/dsh-hob/workflow.toml` + `preset/dsh-hob/spec/*.md`
 *     ⇒ `preset/dsh-hob/gen/persona.md` · `preset/dsh-hob/gen/contracts.md`
 *
 * ══ ⛔ 它**不**做什么（这一期只做加法）════════════════════════════════════════════
 *   ⛔ **不写进 `preset-dsh-hob.patch.yml`** —— 切换 `persona.prefix` 是下一期的事，
 *     且必须一次切成、可回退（`TASK-P8.md` §二 / §六）。
 *   ⛔ **不碰 `kit/drafts/preset-contracts.md`**（那是 ⑤ 的另一半）。
 *
 * ══ 确定性 ════════════════════════════════════════════════════════════════════════
 *   纯函数：输入只有 `workflow.toml` 与 `spec/*.md` 的**文本内容**；
 *   ⛔ 不取当前时间、⛔ 不读 mtime、⛔ 不读环境变量 ⇒ 同输入两次跑**逐字节相同**。
 *
 * ══ 用法 ════════════════════════════════════════════════════════════════════════
 *   `npm run gen:preset-contract`        写盘
 *   `npm run gen:preset-contract -- --check`   只比对不写（供判据用）
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const ROOT = join(here, '..')
export const PRESET_DIR = join(ROOT, 'preset', 'dsh-hob')
export const WORKFLOW_PATH = join(PRESET_DIR, 'workflow.toml')
export const SPEC_DIR = join(PRESET_DIR, 'spec')
export const GEN_DIR = join(PRESET_DIR, 'gen')
export const CONSTITUTION_PATH = join(PRESET_DIR, 'CONSTITUTION.md')
export const PRESET_YML = join(PRESET_DIR, 'preset-dsh-hob.patch.yml')

/** 三类 spec 文件（⚠ 顺序固定 = 渲染顺序）。 */
export const SPEC_FILES = ['intake.md', 'reply.md', 'handover.md']

/**
 * **附注卷**（2026-10-30 P9）：把 `prefix` 里"实测踩过的坑"按主题抽成四卷，
 * 拼进 `gen/persona.md` 的「附注」段。
 * ⚠ 顺序固定（渲染确定性）；⚠ 每卷内部是**原文逐字搬运**，由 `check:workflow` 的 **F5** 咬住。
 */
export const NOTE_FILES = ['notes-mechanism.md', 'notes-evidence.md', 'notes-handover.md', 'notes-budget.md']

/**
 * **受限 TOML 子集解析器**（⚠ 与 `scripts/gen-ledger.mjs` 同口径：只认 `[[表]]` / `key = "str"` / 注释）。
 * ⚠ 不认识的写法 ⇒ **抛错**（⛔ 静默忽略 —— 那会让"写错了"表现成"少一条"）。
 *
 * @param {string} src - 全文
 * @returns {Record<string, Array<Record<string,string>>>} 表名 → 条目数组
 */
export function parseWorkflow(src) {
  const out = {}
  let cur = null
  let curTable = null
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '' || line.startsWith('#')) continue
    const h = /^\[\[([A-Za-z0-9_-]+)\]\]$/.exec(line)
    if (h !== null) {
      curTable = h[1]
      cur = {}
      if (out[curTable] === undefined) out[curTable] = []
      out[curTable].push(cur)
      continue
    }
    if (line.startsWith('[')) throw new Error(`第 ${i + 1} 行：不支持的 TOML 表头 ${JSON.stringify(line)}`)
    if (cur === null) throw new Error(`第 ${i + 1} 行：键出现在 [[表]] 之前`)
    const eq = line.indexOf('=')
    if (eq < 0) throw new Error(`第 ${i + 1} 行：不是 key = value：${JSON.stringify(line)}`)
    const key = line.slice(0, eq).trim()
    const val = line.slice(eq + 1).trim()
    // ⚠ 也认**整数**（`order = 1` 这类）：⚠ 但只认纯数字，其它形状一律抛错（⛔ 静默忽略）
    if (/^\d+$/.test(val)) { cur[key] = val; continue }
    if (!val.startsWith('"')) throw new Error(`第 ${i + 1} 行：只支持 "字符串" 或整数 值：${JSON.stringify(val)}`)
    const m = /^"((?:[^"\\]|\\.)*)"\s*$/.exec(val)
    if (m === null) throw new Error(`第 ${i + 1} 行：字符串格式不对：${JSON.stringify(val)}`)
    cur[key] = m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  return out
}

/**
 * 读输入（⚠ 纯：只读文件内容，不取时间）。
 *
 * @returns {{wf: Record<string, Array<Record<string,string>>>, specs: Record<string,string>}}
 */
export function readInputs() {
  const wf = parseWorkflow(readFileSync(WORKFLOW_PATH, 'utf8'))
  const specs = {}
  for (const f of [...SPEC_FILES, ...NOTE_FILES]) {
    try { specs[f] = readFileSync(join(SPEC_DIR, f), 'utf8') } catch { specs[f] = '' }
  }
  return { wf, specs }
}

/** 去掉 `<!-- source: … -->` 与 `<!-- order: N -->` 标记行（⚠ 给判据看的，⛔ 不进 persona 正文）。 */
export function stripSourceMarks(md) {
  return md.split('\n').filter((l) => !/^<!-- (source: .*|order: \d+) -->$/.test(l.trim())).join('\n')
}

/**
 * **解析附注卷 → 按节归并的数据结构**（2026-10-30 P10）。
 *
 * ── 它解决什么 ──────────────────────────────────────────────────────
 *   P9 的 `persona.md` 是"骨架 + 四卷附注"两段，而**骨架里的 test/first_move**
 *   与**附注卷里的例子**被 20 KB 隔开 ⇒ 读的人对不上。
 *   ⚠ 但反过来（把 test/first_move 也写进附注卷）会**制造两处真相**（用户 P10 §一 明令不采纳）。
 *   ⇒ 本函数把四卷拆成「节 → 段落数组」，`renderPersona` 再与 `workflow.toml` 的
 *     test/first_move **就地拼一次** ⇒ **每节只出现一次**。
 *
 * @param {Record<string,string>} specs - 卷名 → 全文
 * @returns {Map<string, {order:number, blocks:string[]}>} 节名 → `{order, blocks}`（blocks 已去 source 标记）
 */
export function parseNoteSections(specs) {
  const out = new Map()
  for (const f of NOTE_FILES) {
    const src = specs[f] ?? ''
    if (src === '') continue
    let cur = null
    let order = null
    let pendingSrc = null
    let parent = ''
    let level = 3
    let buf = []
    const flush = () => {
      if (cur !== null && pendingSrc !== null) {
        const t = buf.join('\n').trim()
        if (t !== '') cur.blocks.push(t)
      }
      buf = []
      pendingSrc = null
    }
    for (const raw of src.split('\n')) {
      const l = raw.trim()
      const mo = /^<!-- order: (\d+) -->$/.exec(l)
      if (mo !== null) { flush(); order = Number(mo[1]); continue }
      const ml = /^<!-- level: (\d+) -->$/.exec(l)
      if (ml !== null) { flush(); level = Number(ml[1]); continue }
      const mh = /^#{2,4} (.+?)（原文）$/.exec(l)
      if (mh !== null) {
        flush()
        const name = mh[1].trim()
        if (!out.has(name)) out.set(name, { order: order ?? 9999, blocks: [], level })
        cur = out.get(name)
        continue
      }
      const ms = /^<!-- source: (.+) -->$/.exec(l)
      if (ms !== null) { flush(); pendingSrc = ms[1]; continue }
      if (cur !== null) buf.push(raw)
    }
    flush()
  }
  return out
}

/**
 * 渲染 `gen/persona.md`（⭐ 将来注入 `persona.prefix` 的候选物）。
 *
 * ⚠ 它必须是**自足的**：只读它 + `spec/` 就该知道怎么干活。
 * ⚠ 但它⛔ 不是"把散文再抄一遍" —— 它是**骨架 + 指针**（散文在 `spec/`，用 id 对应）。
 *
 * @param {Record<string, Array<Record<string,string>>>} wf - 机读源
 * @returns {string} markdown 全文
 */
export function renderPersona(wf, specs = {}) {
  const L = []
  L.push('# Hob · 工作流（由 `workflow.toml` + `spec/` 生成 · ⛔ 手改即红）')
  L.push('')
  /**
   * ⚠⚠ **P10：persona 正文 ⛔ 不许出现内部标识**（`check:presets` 的 ③）——
   *   它会把**包名 / 模块子路径**当成"称呼"扫出来。
   *   ⚠ 而本段原来写的是 `preset/dsh-hob/workflow.toml` —— 那**含包名** ⇒ ③ 当场红。
   *   ⇒ 改成**不带包名**的相对说法（读者是模型，它只需要知道"改哪个文件"，不需要包路径）。
   *   ⚠ 这不是放宽判据：③ 守的是"别把内部标识当称呼印给用户"，本段是**注释性说明**，
   *     本来就不该带包名。
   */
  L.push('> 生成器：`npm run gen:preset-contract`。')
  L.push('> ⚠ 本文件是**生成物**：改规则请改同目录的 `workflow.toml` 或 `spec/*.md`，')
  L.push('> 然后重跑生成器。⚠ 手改本文件由 `check:workflow` 的 **F2** 咬住。')
  L.push('')
  L.push('## 五步（顺序固定，⛔ 不许增删改序）')
  L.push('')
  L.push('| # | 步 | 谁定 | 判据 | 角色 |')
  L.push('|---|---|---|---|---|')
  const steps = [...(wf.step ?? [])].sort((a, b) => Number(a.order) - Number(b.order))
  for (const s of steps) {
    L.push(`| ${s.order} | ${s.name}（\`${s.id}\`） | ${s.who} | ${s.judged_by} | ${s.actor_role} |`)
  }
  L.push('')
  L.push('⚠ **第 4 步与第 5 步不是同一个人**（`actor_role` 一为 `executor`、一为 `acceptor`）。')
  L.push('')
  /**
   * ⚠⚠ **2026-10-30 P10：七种输入不再单独成节** —— 它们**并回下面「附注」里各自的原文节**
   *   （`**Test**` / `**First move**` 来自 `workflow.toml`，例子与坑来自附注卷），
   *   于是**每节只出现一次**，⛔ 不再有"骨架一份、附录一份"（`TASK-P10.md` §一）。
   *   ⚠ 这一段保留一句**索引**（⛔ 不复写 test），让读者知道七种在哪。
   */
  L.push('## 十种输入（先判是哪一种，再动手）')
  L.push('')
  L.push('> ⚠ 十种输入各自的 `Test` / `First move` 与例子，**就在下面「附注」里各自的原文节内**'
    + '（⛔ 本节不再复写一遍 —— 那样会变成两处真相）。索引：'
    + (wf.intake ?? []).map((it) => `\`${it.id}\`→「${String(it.section ?? '').replace(/^###\s+/, '')}」`).join(' · ')
    + '。')
  L.push('')
  /**
   * ⚠⚠ **P17（`CHG-271` §三-3）：本节整段删除**（标题 + 三行 `—— 措辞`，省 339 B）。
   *   三行 `id` **没有丢** —— 它们搬进 `### Reply format` 节首（见 `spec/notes-handover.md`）。
   *   ⚠ 判据不受影响：`F1` 的 `[[reply]]` 核的是 `workflow.toml` 的 `source`（对冻结原文），
   *     ⛔ 不是"persona 里有没有这行字"。
   */
  L.push('## 六条不变量（不可协商）')
  L.push('')
  for (const v of wf.invariant ?? []) {
    L.push(`- **${v.text}**（\`${v.id}\`）`)
  }
  L.push('')
  /**
   * ⚠⚠ **2026-10-31 P39：新增的三条不变量「没有原文出处」必须自己说清**。
   *   前三条抽自切换前原文（`source` 在 `spec/origin-prefix.txt` 里）；
   *   后三条逐字来自用户 2026-10-31 的原话（`spec/origin-user-2026-10-31.txt`）。
   *   ⇒ 这一行是**读者（模型）**唯一能看到"这条是新立的、不是原文里就有的"的地方。
   *   ⛔ 不许省：省了就是让新规则冒充原文规则（F1 核机读面，这一行核人读面）。
   */
  const newInvs = (wf.invariant ?? []).filter((v) => String(v.origin ?? 'original').trim() === 'new')
  if (newInvs.length > 0) {
    L.push(`> ⚠ 其中 **${newInvs.length} 条是 2026-10-31 新立的**（`
      + newInvs.map((v) => `\`${v.id}\``).join(' · ')
      + '）：出处是**用户当天的原话**，⛔ 不是这份提示词早有的句子。')
    L.push('')
  }
  L.push('## 纪律（每轮都要执行的）')
  L.push('')
  /**
   * ⚠⚠ **P17（`CHG-271` §三-1/2）：12 行中文摘要 + `six-fields` 那一行不再展开**，
   *   改成**两行指针**（省 1195+57，加 2 行要算进净值）。
   *   ⚠ **机读源一条没删**：那 13 条 `[[rule]]` 仍带 `text` + `source`，
   *     `N-F7`（四条件必须齐）/ `N-F8`（rule 非空且 source 命中原文）/ `F1`（扫 rule 表）**全部照旧**。
   *     ⇒ 渲染变薄 ≠ 规则消失：这是**一处真相（机读）+ 一处摘要（人读指针）**，不是两处真相。
   */
  L.push('> 问用户的规则（四条件 · 五不问 · 难不是理由 · 真问必须写全 · 默认对齐方案）见 `### New instruction`。')
  L.push('> 每次交付的六字段证据见 `### Running the loop`。')
  L.push('')
  for (const r of wf.rule ?? []) {
    if (r.render === 'pointer-only') continue
    L.push(`- ${r.text}（\`${r.id}\`）`)
  }
  L.push('')
  L.push('## 细节去哪看')
  L.push('')
  L.push('| 主题 | 文件 |')
  L.push('|---|---|')
  L.push('| 输入判定 | `spec/intake.md` |')
  L.push('| 回复形态 | `spec/reply.md` |')
  L.push('| 交付 / 预算 / 边界 | `spec/handover.md` |')
  L.push('| 不可协商条款（带机检） | `CONSTITUTION.md` |')
  L.push('')
  L.push('## 附注（原文逐节归并 · 判据 F5 咬住来源）')
  L.push('')
  L.push('> ⚠ 下面**每一节只出现一次**：`**Test**` / `**First move**` 取自 `workflow.toml`，')
  L.push('> 例子与坑取自附注卷（**逐字**，⛔ 未改写）。⚠ 按**原文出现次序**排列（`<!-- order -->`）。')
  L.push('')
  const noteSecs = parseNoteSections(specs)
  if (noteSecs.size === 0) {
    L.push('> ⚠ 四卷附注**一节都没解析到**（生成物里保留占位，⛔ 不静默省掉）')
    L.push('')
    return L.join('\n')
  }
  /** intake 的 section 名 → toml 条目（⚠ 用它把 Test / First move 就地拼回去）。 */
  const inBySection = new Map()
  for (const it of wf.intake ?? []) {
    inBySection.set(String(it.section ?? '').replace(/^###\s+/, '').trim(), it)
  }
  /**
   * ⚠⚠ **P10 修正**：附注卷里只收"例子与坑"，有五种 intake（Verdict / Stop / Ruling /
   *   No answer / Correction）**原文里没有例子** ⇒ 它们在卷里**一块都没有** ⇒ 上一版**整节消失**了。
   *   ⚠ 那是**丢节**（读者再也看不到那五种输入的 Test），⛔ 不是"归并没内容"。
   *   ⇒ 现在把 **intake 的节名与附注卷的节名做并集**（用各自 `order` 排序），
   *     卷里没有块的节**照样出现**，只有 Test / First move。
   */
  /**
   * ⚠⚠ **P10 归并的第三条修正：`##` 父级标题必须还原**。
   *   原文里 `## Taking input` / `## Your side` / `## Replying` … 是**父级**，
   *   而 `check:presets` 的 **⑤v / ⑤q** 要求 `## Taking input` 在场。
   *   ⇒ 附注卷带 `<!-- parent: X -->` 与 `<!-- level: N -->`，这里按 order 排、遇新 parent 就补一行 `##`。
   */
  const merged = new Map()
  for (const [name, sec] of noteSecs.entries()) {
    merged.set(name, { order: sec.order, blocks: sec.blocks, level: sec.level ?? 3 })
  }
  for (const it of wf.intake ?? []) {
    const name = String(it.section ?? '').replace(/^###\s+/, '').trim()
    if (name === '') continue
    if (!merged.has(name)) merged.set(name, { order: Number(it.order ?? 9999), blocks: [], level: 3 })
  }
  const ordered = [...merged.entries()].sort((a, b) => a[1].order - b[1].order)
  for (const [name, sec] of ordered) {
    L.push(`${'#'.repeat(Math.max(2, sec.level))} ${name}`)
    L.push('')
    /**
     * ⚠⚠ **P17（`CHG-271` §三-3）：三行 `id` 搬到这里**（`## 三种回复形态` 整节已删）。
     *   ⚠ 为什么写在生成器里而不是附注卷里：附注卷的块**必须挂在一行 `<!-- source: … -->` 之下**
     *     （`parseNoteSections` 的 `flush()` 只收 `pendingSrc !== null` 的缓冲）——
     *     直接写在该节标题下会被**静默丢弃**（我第一版就是这样，`grep two-part` 0 命中）。
     *   ⚠ 这三行是**索引**，不是又一份措辞：精确 `when` 仍只存于 `workflow.toml`。
     */
    if (name === 'Reply format') {
      /**
       * ⚠ 只留 `id` + 一句指针（⛔ 不复制 `name`/`when` —— 那些正是本轮砍掉的"重复措辞"）。
       *   省字节与"id 不能丢"两个要求在这里同时满足。
       */
      L.push('> 三种回复形态的机读 `id`（`[[reply]]` 与之对应，措辞见 `workflow.toml`）：'
        + (wf.reply ?? []).map((r) => `\`${r.id}\``).join(' · ') + '。')
      L.push('')
    }
    const it = inBySection.get(name)
    if (it !== undefined) {
      L.push(`**Test**：${it.test}`)
      L.push('')
      L.push(`**First move**：${it.first_move}`)
      L.push('')
    }
    for (const b of sec.blocks) {
      L.push(b)
      L.push('')
    }
  }
  return L.join('\n')
}

/**
 * 渲染 `gen/contracts.md`（人读版；将来替掉 `kit/drafts/preset-contracts.md`）。
 *
 * @param {Record<string, Array<Record<string,string>>>} wf - 机读源
 * @param {Record<string,string>} specs - `spec/*.md` 原文
 * @returns {string} markdown 全文
 */
export function renderContracts(wf, specs) {
  const L = []
  L.push('# Hob 预设契约 · 人读版（由 `workflow.toml` + `spec/` 生成 · ⛔ 手改即红）')
  L.push('')
  L.push('> 生成器：`npm run gen:preset-contract`。⚠ 本文件是**生成物**。')
  L.push('> 机器读的骨架在 `preset/dsh-hob/workflow.toml`；本体说明由下面的 `spec/` 原文拼接。')
  L.push('')
  L.push(`共 **${(wf.step ?? []).length}** 步 · **${(wf.intake ?? []).length}** 种输入 · `
    + `**${(wf.reply ?? []).length}** 种回复形态 · **${(wf.invariant ?? []).length}** 条不变量 · `
    + `**${(wf.rule ?? []).length}** 条纪律。`)
  L.push('')
  for (const f of SPEC_FILES) {
    if (specs[f] === undefined || specs[f] === '') {
      L.push(`> ⚠ 缺 spec：\`${f}\`（生成物里保留占位，⛔ 不静默省掉）`)
      L.push('')
      continue
    }
    L.push('---')
    L.push('')
    L.push(specs[f].trimEnd())
    L.push('')
  }
  return L.join('\n')
}

/**
 * 渲染全部（不写盘）。
 *
 * @param {{wf?: object, specs?: object}} [inputs]
 * @returns {Record<string,string>} 文件名 → 全文
 */
export function renderAll(inputs) {
  const { wf, specs } = inputs ?? readInputs()
  return {
    'persona.md': renderPersona(wf, specs),
    'contracts.md': renderContracts(wf, specs),
  }
}

/** 主入口。 */
function main() {
  const checkMode = process.argv.includes('--check')
  const out = renderAll()
  if (checkMode) {
    let bad = 0
    for (const [name, text] of Object.entries(out)) {
      const p = join(GEN_DIR, name)
      let cur = ''
      try { cur = readFileSync(p, 'utf8') } catch { cur = '' }
      if (cur !== text) { bad++; console.log(`✗ ${name} 与生成器不一致（${cur.length} B vs ${text.length} B）`) }
      else console.log(`✓ ${name} 一致（${text.length} B）`)
    }
    process.exit(bad > 0 ? 1 : 0)
  }
  mkdirSync(GEN_DIR, { recursive: true })
  for (const [name, text] of Object.entries(out)) {
    writeFileSync(join(GEN_DIR, name), text)
    console.log(`  写出 gen/${name}（${text.length} 字节）`)
  }
  console.log('')
  console.log(`  ✅ 已生成 ${Object.keys(out).length} 份（来源：workflow.toml + spec/）`)
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main()
