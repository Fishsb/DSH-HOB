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
 *   ⑤b **两段式格式的语义断言**（UD-51 起步 → UD-55 定为两段式 → **v5/UD-57 改定围栏与排版**）：
 *      两个二级标题在位且有序、第一段（指令）必须被代码围栏包住
 *      （**恰好 4 个反引号 + 语言标记 `markdown`**，固定、无条件式）、
 *      第二段（白话说明）不得被包住、五条规则条文在位，
 *      且**旧分隔符一律不得残留**（负向断言 —— 只靠 ⑤ 的话，
 *      "两份一起改回旧分隔符"照样 PASS）。
 *      ⚠ v5 起**删去**「禁 emoji / 禁 ASCII 线 / 禁表格徽章」三条断言（装饰已放开）；
 *        也不再要求"无开场引言"（v5 允许第一段之前有一两句引言）。
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

// ── ⑤b 两段式格式的**语义**断言（UD-51 起步 → UD-55 定为两段式 → v5/UD-57 改定围栏）──
//
// 为什么需要：⑤ 只能证明"两份载体一致"，**证明不了格式规则本身还在** ——
// 两份一起被改回旧分隔符，⑤ 照样 PASS。本条把用户的**原始诉求**钉成断言。
//
// 形状沿革（**读懂这三行才不会把断言改回旧口径**）：
//   · UD-51：`<<<CMD>>>` + 条件式围栏（含代码块时才加长）
//   · UD-55：两段式标题驱动，围栏 3 反引号 + `text`，禁装饰、禁开场引言
//   · **v5/UD-57（当前）**：围栏改 **4 反引号 + `markdown`**、**固定 4 个**（无条件式）、
//     **放开装饰**（emoji / ASCII 线 / 表格均可）、**允许开场引言**；
//     两段式结构、10 种分隔符禁令、两个标题与语言无关 —— **一律不变**。
{
  const hoBody = literalBlock(hoSrc, 'prefix') ?? ''

  // ① 两个二级标题在位，且**顺序**不可颠倒
  const H1 = '## 给「开发」的指令'
  const H2 = '## 白话说明'
  const i1 = hoBody.indexOf(H1)
  const i2 = hoBody.indexOf(H2)
  if (i1 < 0) bad(`⑤b 助手：缺第一部分的二级标题 ${JSON.stringify(H1)}`)
  else if (i2 < 0) bad(`⑤b 助手：缺第二部分的二级标题 ${JSON.stringify(H2)}`)
  else if (i1 > i2) bad('⑤b 助手：两个二级标题顺序颠倒（第一部分应为「给「开发」的指令」）')
  else ok(`⑤b 助手：两段标题在位且有序（${H1} → ${H2}）`)

  // ② 第一部分的实例块：标题之后的第一行必须开围栏（**标题在围栏外**）
  //    ⚠ 取 `lastIndexOf` 而不是 `indexOf`：正文里这两个标题**当前各出现 1 次**，
  //      但 `## Rules` 的条文行里**会以不带 `## ` 前缀的形式复述标题**，
  //      将来若有人把复述写成带前缀的形态，取最后一个才能**仍然锚到实例**。
  const FENCE = /^(`{4})markdown$/   // v5：恰好 4 个反引号 + 语言标记 markdown（固定）
  const lastH1 = hoBody.lastIndexOf(H1)
  if (lastH1 >= 0) {
    const afterH1 = hoBody.slice(lastH1 + H1.length)
    const fenceLine = afterH1.split('\n').find((l) => l.trim() !== '')
    const fenceTrim = (fenceLine ?? '').trim()
    if (!FENCE.test(fenceTrim)) {
      bad(`⑤b 助手：${H1} 之后一行应为「4 个反引号 + markdown」的代码围栏，实测 ${JSON.stringify(fenceLine)}`)
    } else ok(`⑤b 助手：${H1} 后紧跟 4 反引号 + markdown 围栏（${JSON.stringify(fenceTrim)}），且标题在围栏**外**`)

    // ③ 该围栏必须闭合，且闭合发生在「白话说明」标题**之前**
    //    （否则等于把白话段也包进去了）
    const openLen = FENCE.exec(fenceTrim)?.[1].length ?? 0
    const bodyLines = afterH1.split('\n')
    let closeIdx = -1
    for (let i = 1; i < bodyLines.length; i++) {
      if (bodyLines[i].trim() === '`'.repeat(openLen)) { closeIdx = i; break }
    }
    const h2Line = bodyLines.findIndex((l) => l.trim() === H2)
    if (closeIdx < 0) bad(`⑤b 助手：指令段的围栏未闭合（找不到同长度 ${openLen} 反引号的闭合行）`)
    else if (h2Line >= 0 && closeIdx > h2Line) bad('⑤b 助手：围栏跨过了「白话说明」标题 ⇒ 白话段被包进代码块')
    else ok('⑤b 助手：指令段围栏成对闭合，且未跨过「白话说明」标题（白话段未被包住）')

    // ③b **围栏长度固定为 4**（v5 取消了"含代码块才加长"的条件式）——
    //     旧口径会写 `{3,}`；这里是**精确 4**，写成 3 或 5 都算 FAIL。
    //     ⚠ 只在围栏**格式合法**时才比对长度：否则 ② 已报"格式不对"，
    //       这里再报"实测 0 个"属于**误导性读数**（0 是没匹配上，不是真有 0 个反引号）。
    if (FENCE.test(fenceTrim)) {
      if (openLen !== 4) bad(`⑤b 助手：围栏应为固定 4 个反引号，实测 ${openLen} 个`)
      else ok('⑤b 助手：围栏长度 = 4（固定，无条件式）')
    }

    // ③c **指令正文内不得出现 4 个及以上连续反引号**（否则外层围栏提前闭合）。
    //     判据：取第一段围栏**内部**的行，扫 `{4,}` 的连续反引号。
    const openIdx = bodyLines.findIndex((l) => FENCE.test(l.trim()))
    if (openIdx >= 0) {
      const closeIdx2 = bodyLines.findIndex((l, k) => k > openIdx && l.trim() === '````')
      const innerLines = closeIdx2 > openIdx ? bodyLines.slice(openIdx + 1, closeIdx2) : bodyLines.slice(openIdx + 1)
      const longRuns = innerLines.filter((l) => /`{4,}/.test(l))
      if (longRuns.length > 0) {
        bad(`⑤b 助手：指令正文含 4 个及以上连续反引号（${longRuns.length} 行），会提前闭合外层围栏：${JSON.stringify(longRuns[0].slice(0, 60))}`)
      } else ok('⑤b 助手：指令正文内无 4 个及以上连续反引号（外层围栏不会被提前闭合）')
    }
  }

  // ④ 规则条文必须存在（防止"示例改了、规则没写"）
  //    ⚠ v5 口径（UD-57）：第三条由"内嵌代码块时才用 4 个"改为"**固定 4 个**"，
  //      故正则改钉 `exactly four backticks` + `never contain a run of four or more backticks`。
  //    ⚠ v6 口径（UD-58）：**删去「两段强制」**（`Both parts are mandatory`）——
  //      两段式改为**按需触发**，不再每轮强制。其余条文**全部保留**（v6 未放开）。
  for (const [label, needle] of [
    ['禁止包白话段', /Never fence part two/],
    ['禁止包整篇', /never wrap the whole reply in one code block/],
    ['标题为结构、不随语种变', /The two headings are structural/],
    ['固定 4 个反引号', /exactly four backticks/],
    ['指令内禁 4 个及以上反引号', /never contain a run of four or more backticks/],
  ]) {
    if (!needle.test(hoBody)) bad(`⑤b 助手：## Rules 缺「${label}」条文`)
    else ok(`⑤b 助手：## Rules 含「${label}」条文`)
  }

  // ④b **v6 新增：按需触发的两项断言**（UD-58）
  //    (a) 默认正常回复 + 不得写空壳/占位句（防止"为填格式而编任务"）
  //    (b) 触发条件存在（"仅在产生交给 开发 的活时才出两部分"）
  //    ⚠ 与 (a) 配对的是**删除**「两段强制」：若有人把强制口径改回来，
  //      (b) 的触发条件正则仍在（"produces work for 开发"），故另设 (c) 负向断言
  //      「不得出现每轮强制的措辞」，见 ④c。
  if (/ordinary Markdown by default/.test(hoBody)) ok('⑤b 助手：含「默认正常 Markdown 回复」条文')
  else bad('⑤b 助手：缺「默认正常 Markdown 回复」条文（v6 按需触发的落点）')

  if (/do not invent a task to fill the shape/.test(hoBody) && /do not emit a placeholder/.test(hoBody)) {
    ok('⑤b 助手：含「不得编造任务 / 不得输出占位句」条文')
  } else {
    bad('⑤b 助手：缺「不得编造任务 / 不得输出占位句」条文（无活时不得写空壳）')
  }

  if (/ONLY when the turn actually produces work for 开发 to carry out/.test(hoBody)) {
    ok('⑤b 助手：含「仅在该轮确产生交给 开发 的活时才用两部分」触发条件')
  } else {
    bad('⑤b 助手：缺按需触发的触发条件条文')
  }

  // ④c **v6 负向断言：每轮强制的措辞不得回归**
  //     ⚠ 这两句正是 v6 要逐字删掉的那两条；只靠 ④ 的"条文存在"抓不到它们**复活**
  //       （条文可以共存 —— 既写"按需触发"又写"每次必须两段"，那是自相矛盾）。
  for (const [label, needle] of [
    ['强制性首句（Every reply is exactly two parts）', /Every reply is exactly two parts/],
    ['强制条（Both parts are mandatory）', /Both parts are mandatory/],
  ]) {
    if (needle.test(hoBody)) bad(`⑤b 助手：正文仍含已废除的强制条文「${label}」`)
    else ok(`⑤b 助手：已废除的强制条文「${label}」为 0 残留`)
  }

  // ④d **v6 新增：「触发时结构不变」的四项仍在**（UD-58 明示：只取消强制，不改结构）
  //     四项 = ① 标题在围栏外 ② 只包第一段 ③ 固定 4 反引号 ④ 围栏不跨白话标题。
  //     ⚠ 这四项**上文各自已有独立断言**（②③③b 与 ④ 的"禁止包白话段/禁止包整篇"）；
  //       这里再**聚合复述一次**，理由是 v6 改的是"是否强制"，
  //       而"结构本身"必须**在同一处可见地未被改动** —— 分散断言在对比 v5/v6 时不易核对。
  {
    const structChecks = [
      ['标题在围栏外', lastH1 >= 0 && FENCE.test((hoBody.slice(lastH1 + H1.length).split('\n').find((l) => l.trim() !== '') ?? '').trim())],
      ['只包第一段（白话段未被包）', /Never fence part two/.test(hoBody)],
      ['固定 4 反引号', /exactly four backticks/.test(hoBody)],
      ['围栏不跨白话标题', /never run past the 白话说明 heading/.test(hoBody)],
    ]
    const missing = structChecks.filter(([, isOk]) => !isOk).map(([n]) => n)
    if (missing.length > 0) bad(`⑤b 助手：触发时的结构细则缺项：${missing.join(' / ')}`)
    else ok('⑤b 助手：触发时结构四项俱全（标题在围栏外 / 只包第一段 / 固定 4 反引号 / 围栏不跨白话标题）')
  }

  // ⑤ 负向断言：**旧分隔符一律不得残留**（UD-55「删除全部分隔符与包装」）
  //    ⚠ 这条是本条存在的核心理由：⑤ 是"两份一致"，两份一起改回旧格式它照样 PASS。
  //    ⚠ v5 未放开此禁令（用户明示"10 种旧分隔符禁令必须保留"）。
  const LEGACY = ['<<<CMD>>>', '<<<END_CMD>>>', '<<<NOTE>>>', '<<<END_NOTE>>>',
    '<<<WHAT>>>', '<<<END_WHAT>>>', '<<<JUDGE>>>', '<<<END_JUDGE>>>',
    '<<<NEXT>>>', '<<<END_NEXT>>>']
  const residue = LEGACY.filter((m) => hoBody.includes(m))
  if (residue.length > 0) {
    bad(`⑤b 助手：正文仍残留旧分隔符（${residue.length} 种）：${residue.join(' ')}`)
  } else ok('⑤b 助手：10 种旧分隔符均为 0 处残留')

  // ⑥ ⚠ **v5 已删除**原三条排版禁令断言（禁 emoji / 禁 ASCII 线 / 禁表格徽章）：
  //    用户裁定"装饰放开"（UD-57）。此处**不再断言**，也**不反向断言必须出现装饰** ——
  //    装饰是**允许**而非**要求**。
  ok('⑤b 助手：排版禁令断言已按 v5 移除（装饰放开，非强制）')

  // ⑦ 语言标记**不得**是 v4 的 `text`：与 ② 互为补充 —— ② 要求"是 4+markdown"，
  //    本条要求"不是 text"，使"把 markdown 改回 text"这一具体回退**单独可观测**。
  {
    const h1Line = hoBody.lastIndexOf(H1)
    if (h1Line >= 0) {
      const fenceLine = hoBody.slice(h1Line).split('\n').find((l) => l.trim() !== '')
      if (/^`{3,}text$/.test((fenceLine ?? '').trim())) {
        bad('⑤b 助手：围栏语言标记仍是 v4 的 `text`（v5 应为 markdown）')
      } else ok('⑤b 助手：围栏未使用 v4 的 `text` 标记')
    }
  }
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
