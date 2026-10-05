#!/usr/bin/env node
/**
 * 预设契约一致性核对 —— **机检**「人读版 ↔ 机器读版」不漂移。
 *
 * 为什么需要它：正文有两份载体 ——
 *   · 机器读版 = 预设 patch 的 `prefix: |-` 块（宿主真正加载的那份）
 *   · 人读版   = `.hob/drafts/preset-contracts.md`（用户过目、将来改动的地方）
 * 两份手工同步必然漂移（"守卫写两遍必然漂移"的同类）。本脚本把漂移变成 FAIL。
 *
 * ── 检查项 ──────────────────────────────────────────────────────────────
 *   ① 显示名：两个预设的 `config.name` = `助手` / `开发`（id 必须未变）
 *   ② id 不变：`dsh-hob` / `dsh-hob-work`
 *   ③ **正文里不拿预设 id 指代对方**：把 persona 正文按"提到对方"的句子扫一遍，
 *      断言没有把 `dsh-hob` / `dsh-hob-work` 当称呼用（只允许出现在
 *      `Never print a preset id (...)` 这条**禁令句**里，那是"允许的例外"）
 *   ④ 两份正文都含语言规则（跟随用户语言）
 *   ⑤ 人读版引文块与预设正文**全文**逐字一致（把 .md 里的引文块抽出来比对；
 *      ⚠ v3/UD-51 起含 A 段 —— 旧版只比 B+C 段，对 A 段是"缺席的 PASS"）
 *   ⑤b **UD-51 语义断言**：`<<<CMD>>>…<<<END_CMD>>>` 必须被代码围栏包住、
 *      规则条文在位、且未误包 `<<<NOTE>>>` / 未把整篇包住
 *   ⑥ `complete: true` 与工具面声明未变（规划 = 1 行工具模块；开发 = 照抄创造模式行数）
 *
 * 用法：node scripts/check-preset-contracts.mjs
 * 退出码：0 = 全通过；1 = 有违规（逐条打印）
 * ⚠ 零第三方依赖（本仓纪律）：YAML 只做**行级**解析，不引 js-yaml。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const HO = join(root, 'preset', 'dsh-hob', 'preset-dsh-hob.patch.yml')
const WORK = join(root, 'preset', 'dsh-hob', 'preset-dsh-hob-work.patch.yml')
const DRAFT = join(root, '.hob', 'drafts', 'preset-contracts.md')

const fail = []
const note = []
const ok = (m) => note.push(m)
const bad = (m) => fail.push(m)

/** 取 `prefix: |-` 块（literal block）：从该行起，收集缩进更深且非空的行。 */
function literalBlock(src, key) {
  const lines = src.split('\n')
  const start = lines.findIndex((l) => new RegExp(`^\\s*${key}: \\|-\\s*$`).test(l))
  if (start < 0) return undefined
  const baseIndent = lines[start].match(/^\s*/)[0].length
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]
    if (l.trim() === '') { out.push(''); continue }
    const ind = l.match(/^\s*/)[0].length
    if (ind <= baseIndent) break
    out.push(l)
  }
  // 去掉块首尾空行，统一缩进
  while (out.length && out[0].trim() === '') out.shift()
  while (out.length && out[out.length - 1].trim() === '') out.pop()
  const cut = Math.min(...out.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length))
  return out.map((l) => l.slice(cut)).join('\n')
}

/** 取 `config:`（8 空格缩进）下的标量字段（行级，够用）。
 * ⚠ 必须锚定到 **8 空格**：本文件的 6 空格层是 `- id: preset-…` / `name: '@deepseek-ai/dsh-agent-preset'`
 *   （宿主 preset 行的字段），拿错了会把行名当成显示名（本脚本第一版就这么错过）。 */
function scalar(src, key) {
  const m = new RegExp(`^\\s{8}${key}:\\s*(.+)$`, 'm').exec(src)
  if (!m) return undefined
  return m[1].trim().replace(/^["']|["']$/g, '')
}

/** 从人读版抽第 n 个 ```text 引文块。
 * ⚠ 支持"外围栏比内围栏长"的嵌套（UD-51）：块内可以出现 ``` 示例围栏
 *   （INSTRUCTION shape 的代码块示例），因此**开启围栏允许 3 个及以上的反引号**，
 *   并**只由同长度的围栏闭合**（CommonMark 的围栏规则）。
 *   取到的是"该次匹配里最短的那个" —— 这里靠的是**懒惰匹配 + 反向引用同长度**。 */
function draftBlock(which) {
  const src = readFileSync(DRAFT, 'utf8')
  const re = /^(`{3,})text\n([\s\S]*?)^\1[ \t]*$/gm
  const blocks = [...src.matchAll(re)].map((m) => m[2].replace(/\n$/, ''))
  return blocks[which]
}

const hoSrc = readFileSync(HO, 'utf8')
const workSrc = readFileSync(WORK, 'utf8')

// ── ① 显示名 + ② id ───────────────────────────────────────────────────
{
  const cases = [
    ['助手', 'dsh-hob', hoSrc, HO],
    ['开发', 'dsh-hob-work', workSrc, WORK],
  ]
  for (const [wantName, wantId, src, path] of cases) {
    const gotName = scalar(src, 'name')
    const gotId = scalar(src, 'id')
    if (gotName !== wantName) bad(`① ${path}: 显示名应为「${wantName}」，实测「${gotName}」`)
    if (gotId !== wantId) bad(`② ${path}: id 应保持「${wantId}」，实测「${gotId}」`)
    if (gotName === wantName && gotId === wantId) ok(`①② ${wantName}（id ${wantId}）：显示名与 id 均正确`)
  }
}

// ── ③ 正文不拿 id 指代对方 ─────────────────────────────────────────────
// 允许的例外：禁令句本身「Never print a preset id (such as `dsh-hob` or `dsh-hob-work`)」
const ALLOWED_ID_SENTENCE = /Never print a preset id/
{
  for (const [label, src, path] of [['助手', hoSrc, HO], ['开发', workSrc, WORK]]) {
    const body = literalBlock(src, 'prefix')
    if (body === undefined) { bad(`③ ${path}: 找不到 prefix: |- 块`); continue }
    const offenders = body
      .split('\n')
      .filter((l) => /dsh-hob(-work)?/.test(l))
      .filter((l) => !ALLOWED_ID_SENTENCE.test(l))
    if (offenders.length > 0) {
      bad(`③ ${label} 正文仍拿预设 id 指代对方（${offenders.length} 行）：`)
      for (const o of offenders) bad(`     ${o.trim()}`)
    } else {
      const banned = body.split('\n').filter((l) => ALLOWED_ID_SENTENCE.test(l)).length
      ok(`③ ${label} 正文不提 preset id 指代对方（禁令句 ${banned} 行，为允许的例外）`)
    }
    // 正向：必须用名称提到对方
    const other = label === '助手' ? '开发' : '助手'
    if (!body.includes(other)) bad(`③ ${label} 正文从未用名称提到「${other}」`)
    else ok(`③ ${label} 正文用名称提到「${other}」`)
  }
}

// ── ③b 称呼一致：正文里不许再出现旧称呼 ────────────────────────────────
//
// ⚠ **本条取代了原先"与旧契约逐字相同"的假设**（UD-18，2026-10-05）：
//   用户要求把 3 处 `the development session` 统一改成「开发」。
//   改动之后，助手契约的 A 段**不再是"逐字照搬"** —— 因此判据必须从
//   "与归档契约逐字相同" 换成 "**称呼一致**"（不许再残留旧称呼）。
//   代价已记 UD-18：可核验性下降（不能再声称照搬）。
const STALE_APPELLATIONS = [
  'the development session',   // 旧称呼（A 段遗留）
  'the PLANNING side',         // 上一版的英文侧名
  'the WORKING side',          // 上一版的英文侧名
]
{
  for (const [label, src, path] of [['助手', hoSrc, HO], ['开发', workSrc, WORK]]) {
    const body = literalBlock(src, 'prefix') ?? ''
    const stale = STALE_APPELLATIONS.filter((s) => body.includes(s))
    if (stale.length > 0) {
      bad(`③b ${label} 正文残留旧称呼：${stale.map((s) => JSON.stringify(s)).join(', ')}`)
    } else {
      ok(`③b ${label} 正文无旧称呼残留（称呼已统一为 助手 / 开发）`)
    }
  }
  // 助手：A 段的 3 处旧称呼必须已换成名称
  const hoBody = literalBlock(hoSrc, 'prefix') ?? ''
  const devMentions = (hoBody.match(/开发/g) ?? []).length
  if (devMentions < 3) bad(`③b 助手正文提到「开发」仅 ${devMentions} 次（A 段 3 处 + B 段若干，应 ≥3）`)
  else ok(`③b 助手正文提到「开发」${devMentions} 次`)
}

// ── ④ 两份正文都含语言规则 ─────────────────────────────────────────────
{
  for (const [label, src] of [['助手', hoSrc], ['开发', workSrc]]) {
    const body = literalBlock(src, 'prefix') ?? ''
    const has = /^## Language$/m.test(body) && /language the user is currently using/.test(body)
    if (!has) bad(`④ ${label} 正文缺语言规则（应有 '## Language' + 'language the user is currently using'）`)
    else ok(`④ ${label} 正文含语言规则`)
  }
}

// ── ⑤ 人读版引文块与预设正文逐字一致 ───────────────────────────────────
//
// ⚠ **v3（UD-51）起改为"全文逐字相等"**：v2 只贴了 B+C 段，
//   断言写成"人读版是预设正文的**尾部**"。实测（对照实验）把 A 段改一句、
//   人读版不动 ⇒ **仍然 PASS** —— 即 A 段的改动**没有任何机检覆盖**
//   （用户 2026-10-06 实测反馈的正是 A 段："指令没有完全在代码块内"）。
//   ⇒ 人读版 1.2 块已扩为 A+B+C 全量镜像，这里同步改成全文比对。
{
  const hoBody = literalBlock(hoSrc, 'prefix') ?? ''
  const workBody = literalBlock(workSrc, 'prefix') ?? ''
  // 人读版：block0 = 助手 A+B+C 段（全文）；block1 = 开发正文
  const d0 = draftBlock(0)
  const d1 = draftBlock(1)
  if (d0 === undefined || d1 === undefined) {
    bad('⑤ 人读版（.md）里没找到两个引文块（期望 ````text / ```text 各一）')
  } else {
    // 助手：人读版 == 预设正文（全文，逐字）
    if (hoBody.trimEnd() !== d0.trimEnd()) {
      bad('⑤ 助手：人读版引文块与预设正文不一致（应全文逐字相同）')
      const a = hoBody.split('\n'), b = d0.split('\n')
      const n = Math.max(a.length, b.length)
      for (let i = 0; i < n; i++) {
        if (a[i] !== b[i]) { bad(`     首个差异在第 ${i + 1} 行：\n       预设: ${JSON.stringify(a[i])}\n       人读: ${JSON.stringify(b[i])}`); break }
      }
      if (a.length !== b.length) bad(`     行数不同：预设 ${a.length} 行，人读 ${b.length} 行`)
    } else ok('⑤ 助手：人读版引文块 == 预设正文（全文逐字）')

    if (workBody.trimEnd() !== d1.trimEnd()) {
      bad('⑤ 开发：人读版引文块与预设正文不一致（应逐字相同）')
      const a = workBody.split('\n'), b = d1.split('\n')
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) { bad(`     首个差异在第 ${i + 1} 行：\n       预设: ${JSON.stringify(a[i])}\n       人读: ${JSON.stringify(b[i])}`); break }
      }
    } else ok('⑤ 开发：人读版引文块 == 预设正文（逐字）')
  }
}

// ── ⑤b UD-51：指令段必须包在代码块内（A 段的**语义**断言） ─────────────
//
// 为什么需要：⑤ 只能证明"两份载体一致"，**证明不了规则本身还在** ——
// 两份一起被改回裸分隔符，⑤ 照样 PASS。本条把用户的**原始诉求**钉成断言：
// `<<<CMD>>>` 之前必须有一个代码围栏，`<<<END_CMD>>>` 之后必须闭合它；
// 且**不许**把整个回复包住（外围栏不得出现在 `<<<CMD>>>` 之外的第一行）
// 与**不许**包 `<<<NOTE>>>` 段。
{
  const hoBody = literalBlock(hoSrc, 'prefix') ?? ''
  // ① INSTRUCTION shape 的示例里，<<<CMD>>> 必须紧跟在一个围栏之后
  const cmdOpen = hoBody.indexOf('<<<CMD>>>')
  const beforeCmd = hoBody.slice(0, cmdOpen)
  const lastFenceLine = beforeCmd.split('\n').reverse().find((l) => l.trim() !== '')
  if (!/^`{3,}$/.test((lastFenceLine ?? '').trim())) {
    bad(`⑤b 助手：<<<CMD>>> 之前一行应为代码围栏，实测 ${JSON.stringify(lastFenceLine)}`)
  } else ok(`⑤b 助手：<<<CMD>>> 前有围栏（${JSON.stringify((lastFenceLine ?? '').trim())}）`)

  // ② <<<END_CMD>>> 之后必须有关闭围栏
  const endCmd = hoBody.indexOf('<<<END_CMD>>>')
  const afterCmd = hoBody.slice(endCmd + '<<<END_CMD>>>'.length)
  const nextFenceLine = afterCmd.split('\n').find((l) => l.trim() !== '')
  if (!/^`{3,}$/.test((nextFenceLine ?? '').trim())) {
    bad(`⑤b 助手：<<<END_CMD>>> 之后一行应为关闭围栏，实测 ${JSON.stringify(nextFenceLine)}`)
  } else ok('⑤b 助手：<<<END_CMD>>> 后有闭合围栏')

  // ③ 规则条文必须存在（防止"示例改了、规则没写"）
  for (const [label, needle] of [
    ['围栏规则', /wrap the whole directive section in ONE Markdown code fence/],
    ['禁止包整篇', /Never wrap the whole reply in one code block/],
    ['禁止包白话段', /never fence the <<<NOTE>>> section/],
  ]) {
    if (!needle.test(hoBody)) bad(`⑤b 助手：## Rules 缺「${label}」条文`)
    else ok(`⑤b 助手：## Rules 含「${label}」条文`)
  }

  // ④ 负向对拍：示例里 <<<NOTE>>> 段**不得**被包进任何一个围栏
  const noteIdx = hoBody.indexOf('<<<NOTE>>>')
  // 统计 <<<NOTE>>> 之前的围栏数：INSTRUCTION 示例的那一对已开已闭 ⇒ 应为偶数
  const fencesBeforeNote = hoBody.slice(0, noteIdx).split('\n').filter((l) => /^`{3,}$/.test(l.trim())).length
  if (fencesBeforeNote % 2 !== 0) {
    bad(`⑤b 助手：<<<NOTE>>> 被包在未闭合的围栏里（之前有 ${fencesBeforeNote} 条围栏，应为偶数）`)
  } else ok(`⑤b 助手：<<<NOTE>>> 未被围栏包住（之前 ${fencesBeforeNote} 条围栏 = 成对）`)
}

// ── ⑥ complete / 工具面声明未变 ────────────────────────────────────────
{
  // 助手：complete: true + 恰好 1 行工具模块
  if (!/^\s+complete: true\s*$/m.test(hoSrc)) bad('⑥ 助手：缺 complete: true')
  else ok('⑥ 助手：complete: true 在位')
  const hoTool = (hoSrc.match(/name: 'dsh-hob\/preset\/tools'/g) ?? []).length
  if (hoTool !== 1) bad(`⑥ 助手：工具模块行应恰好 1 行，实测 ${hoTool}`)
  else ok('⑥ 助手：工具模块行恰好 1 行（read_contracts + write_hob）')

  // 开发：行数与宿主创造模式一致（工具行零裁剪）
  const rowsOf = (s) => (s.match(/^\s+- id: /gm) ?? []).length
  const host = readFileSync(
    '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app/presets/cordis.patch.yml',
    'utf8',
  )
  const wr = rowsOf(workSrc), hr = rowsOf(host)
  if (wr !== hr) bad(`⑥ 开发：声明行数应等于宿主创造模式 ${hr}，实测 ${wr}（工具被裁了？）`)
  else ok(`⑥ 开发：声明行数 ${wr} == 宿主创造模式 ${hr}（工具零裁剪）`)
}

// ── 输出 ────────────────────────────────────────────────────────────────
console.log('预设契约一致性核对 · dsh-hob')
console.log('预设（机器读版）:', HO, '+', WORK)
console.log('草案（人读版）  :', DRAFT)
console.log('')
for (const n of note) console.log('  ✓', n)
console.log('')
if (fail.length === 0) {
  console.log('判定：PASS —— 显示名、id、正文措辞、语言规则、人读/机器读一致、工具面声明 全部通过。')
  process.exit(0)
} else {
  console.log('判定：FAIL')
  for (const f of fail) console.log('  ✗', f)
  process.exit(1)
}
