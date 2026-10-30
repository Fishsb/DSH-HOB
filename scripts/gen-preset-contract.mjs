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
  for (const f of SPEC_FILES) {
    try { specs[f] = readFileSync(join(SPEC_DIR, f), 'utf8') } catch { specs[f] = '' }
  }
  return { wf, specs }
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
export function renderPersona(wf) {
  const L = []
  L.push('# Hob · 工作流（由 `workflow.toml` + `spec/` 生成 · ⛔ 手改即红）')
  L.push('')
  L.push('> 生成器：`npm run gen:preset-contract`（`scripts/gen-preset-contract.mjs`）。')
  L.push('> ⚠ 本文件是**生成物**：改规则请改 `preset/dsh-hob/workflow.toml` 或 `preset/dsh-hob/spec/*.md`，')
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
  L.push('## 七种输入（先判是哪一种，再动手）')
  L.push('')
  for (const it of wf.intake ?? []) {
    L.push(`### \`${it.id}\``)
    L.push('')
    L.push(`**Test**：${it.test}`)
    L.push('')
    L.push(`**First move**：${it.first_move}`)
    L.push('')
  }
  L.push('## 三种回复形态')
  L.push('')
  for (const r of wf.reply ?? []) {
    L.push(`- **${r.name}**（\`${r.id}\`）—— ${r.when}`)
  }
  L.push('')
  L.push('## 三条不变量（不可协商）')
  L.push('')
  for (const v of wf.invariant ?? []) {
    L.push(`- **${v.text}**（\`${v.id}\`）`)
  }
  L.push('')
  L.push('## 纪律（每轮都要执行的）')
  L.push('')
  for (const r of wf.rule ?? []) {
    L.push(`- ${r.text}（\`${r.id}\`）`)
  }
  L.push('')
  L.push('## 细节去哪看')
  L.push('')
  L.push('| 主题 | 文件 |')
  L.push('|---|---|')
  L.push('| 输入判定 | `preset/dsh-hob/spec/intake.md` |')
  L.push('| 回复形态 | `preset/dsh-hob/spec/reply.md` |')
  L.push('| 交付 / 预算 / 边界 | `preset/dsh-hob/spec/handover.md` |')
  L.push('| 不可协商条款（带机检） | `preset/dsh-hob/CONSTITUTION.md` |')
  L.push('')
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
    'persona.md': renderPersona(wf),
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
