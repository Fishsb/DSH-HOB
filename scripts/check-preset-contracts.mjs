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
 *   ① 显示名：两个预设的 `config.name` = `Hob` / `Hob-Execute`
 *   ② id：`config.id` = `Hob` / `Hob-Execute`（与显示名**同字面值**，2026-10-07 批 2 起）
 *      ⚠ 包名（`dsh-hob`）、目录名、patch 文件名、loader 行 id、
 *        工具行模块名、设置分区标题**一律未跟改**。
 *   ② 见 ① 的期望值（名与 id 同字面值）。
 *   ③ **正文里不出现内部标识**：把 persona 正文逐行扫一遍，断言没有把
 *      **包名（`dsh-hob`）/ 模块子路径**打印给用户（只允许出现在**禁令句**里 ——
 *      那句本身就是"不许打印内部标识"的规则，是"允许的例外"）。
 *      ⚠ 2026-10-07 批 2 换扫描对象：名与 id 同字面值后，旧口径
 *        「不拿 id 指代对方」已失效（正文里 `Hob` 就是名字，不是 id 指代）。
 *        判据**未放宽** —— 见 ③ 的负向对拍。
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
 *   ⑤c **职责句短钉**（2026-10-07 批 3 职责重定义）：Hob / Hob-Execute 的职责句各钉若干
 *      稳定短语，缺失即 FAIL（⑤ 只能证明"两份一致"，两份一起删照样 PASS）。
 *   ⑤d **文件交接条文短钉**（2026-10-07 批 5 · UD-63 / CHG-011）：交接改为"指令与回报
 *      落成文件、用户只转达路径"⇒ 两侧各钉若干稳定短语（TASK.md 落点 / 围栏内只放短指针 /
 *      用户点名要全文时以用户为准 / 仍无自动投递；先读文件再执行 / 回报落同目录 REPORT.md /
 *      路径一行告知 / 只在该目录内写回报 / 四本账本归 Hob / 该目录 git 忽略），缺失即 FAIL。
 *      ⚠ 条文按任务书 §2.1/§2.2 追加在**既有段落正文内**（不新起 `##` 小节），
 *        故本组不钉任何新标题行 —— 钉标题会把"就地追加"这一形态本身变成要求。
 *   ⑥ `complete: true` 与工具面声明未变（规划 = 1 行工具模块；实施 = 照抄创造模式行数）
 *
 *   ⑤f **批 9 · Hob 能力扩展：白名单目标名 + 禁止项 + 失实句清除**。
 *      ⚠ **批 11 就地改动一处（本批唯一允许的断言改动，须写明理由）：**
 *        **把 `ask_user_question` 从"禁止项"清单里移除**，并**新增两条正向断言**
 *        （白名单必须含该名 · 声明面必须有 `tool-ask-user` 行）。
 *        · **理由**：用户裁定 **UD-68 / CHG-015** —— 「**允许 Hob 提问**，但**尽量不问**；
 *          按项目方案主线决策推进，除非只能由用户决策才可以提问」，**只限 Hob 预设**。
 *          批 9 列入禁项的前提是「S7 未定 ⇒ 不碰」；**S7 已由用户裁定为"允许"**，
 *          前提消失。若不移除，则**契约（允许提问）与机检（禁止该工具）互相矛盾**。
 *        · **不是放宽**：同组另 7 项一条未动；移除只发生在这**一处**，且配**负向对拍**
 *          （把 `ask_user_question` 从白名单删掉 ⇒ 新增的正向断言 FAIL）。
 *          本批另增 **⑤g** 组（Hob 契约"决策自主"两条语义的短钉）。
 *   ⑤g **批 11 · Hob「决策自主」条文短钉（UD-68 / CHG-015）**：契约正文须含
 *      「默认自行推进」与「只在只有用户能定时才问」**两条语义**（钉稳定短语），
 *      并**负向断言**"尽量少问 / 不为能自己判断的事停下"的措辞在位。
 *      ⚠ 与前几组同款纪律：这是**新增断言，不是放宽**（缺失即 FAIL）；
 *        且**不钉标题行** —— 任务书要求**就地追加在既有段落内**，钉标题会把
 *        "就地追加"这一形态本身变成要求（与批 5/批 6 同款）。
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

// 两个预设的**名称与 id**唯一来源。
// ⚠ 2026-10-07 批 2 起 `config.name` 与 `config.id` **同字面值**（Hob / Hob-Execute）。
//   包名仍为 `dsh-hob`；目录名、patch 文件名、loader 行 id、工具行模块名、
//   设置分区标题**均未跟改** —— 断言里凡出现它们，指的都是包名面，不是预设 id。
const NAME_HO = 'Hob'
const NAME_WORK = 'Hob-Execute'

/** 包名（= 模块名前缀 = 分区标题；本批未跟改）。 */
const HO_PKG = 'dsh-hob'
/** 工具行模块子路径（按包名解析；本批未跟改）。 */
const MODULE_PATH = 'dsh-hob/preset/tools'
/** 允许的例外行：禁令句本身（它就是在教模型不许打印内部标识）。 */
const ALLOWED_INTERNAL_SENTENCE = /Never print an internal identifier/

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
    ['Hob', 'Hob', hoSrc, HO],
    ['Hob-Execute', 'Hob-Execute', workSrc, WORK],
  ]
  for (const [wantName, wantId, src, path] of cases) {
    const gotName = scalar(src, 'name')
    const gotId = scalar(src, 'id')
    if (gotName !== wantName) bad(`① ${path}: 显示名应为「${wantName}」，实测「${gotName}」`)
    if (gotId !== wantId) bad(`② ${path}: id 应为「${wantId}」，实测「${gotId}」`)
    if (gotName === wantName && gotId === wantId) ok(`①② ${wantName}（id ${wantId}）：显示名与 id 均为既定字面值`)
  }
}

// ── ③ 正文不出现内部标识（2026-10-07 批 2 换扫描对象）──────────────────
// 允许的例外：禁令句本身（`Never print an internal identifier ...`）——
// 它举例说明了包名，那是**规则条文**，不是把内部标识当称呼用。
{
  for (const [label, src, path] of [[NAME_HO, hoSrc, HO], [NAME_WORK, workSrc, WORK]]) {
    const body = literalBlock(src, 'prefix')
    if (body === undefined) { bad(`③ ${path}: 找不到 prefix: |- 块`); continue }
    const offenders = body
      .split('\n')
      .filter((l) => l.includes(HO_PKG) || l.includes(MODULE_PATH))
      .filter((l) => !ALLOWED_INTERNAL_SENTENCE.test(l))
    if (offenders.length > 0) {
      bad(`③ ${label} 正文出现内部标识（包名 / 模块子路径）（${offenders.length} 行）：`)
      for (const o of offenders) bad(`     ${o.trim()}`)
    } else {
      const banned = body.split('\n').filter((l) => ALLOWED_INTERNAL_SENTENCE.test(l)).length
      if (banned === 0) bad(`③ ${label} 正文缺「不许打印内部标识」的禁令句`)
      else ok(`③ ${label} 正文不出现内部标识（禁令句 ${banned} 行，为允许的例外）`)
    }
    // 正向：必须用名称提到对方
    const other = label === NAME_HO ? NAME_WORK : NAME_HO
    if (!body.includes(other)) bad(`③ ${label} 正文从未用名称提到「${other}」`)
    else ok(`③ ${label} 正文用名称提到「${other}」`)
  }
}

// ── ③b 称呼一致：正文里不许再出现旧称呼 ────────────────────────────────
//
// ⚠ **本条取代了原先"与旧契约逐字相同"的假设**（UD-18，2026-10-05）：
//   用户要求把 3 处 `the development session` 统一改成实施侧名称。
//   改动之后，规划侧契约的 A 段**不再是"逐字照搬"** —— 因此判据必须从
//   "与归档契约逐字相同" 换成 "**称呼一致**"（不许再残留旧称呼）。
//   代价已记 UD-18：可核验性下降（不能再声称照搬）。
const STALE_APPELLATIONS = [
  'the development session',   // 旧称呼（A 段遗留）
  'the PLANNING side',         // 上一版的英文侧名
  'the WORKING side',          // 上一版的英文侧名
]
{
  for (const [label, src, path] of [[NAME_HO, hoSrc, HO], [NAME_WORK, workSrc, WORK]]) {
    const body = literalBlock(src, 'prefix') ?? ''
    const stale = STALE_APPELLATIONS.filter((s) => body.includes(s))
    if (stale.length > 0) {
      bad(`③b ${label} 正文残留旧称呼：${stale.map((s) => JSON.stringify(s)).join(', ')}`)
    } else {
      ok(`③b ${label} 正文无旧称呼残留（称呼已统一为 ${NAME_HO} / ${NAME_WORK}）`)
    }
  }
  // Hob：A 段的 3 处旧称呼必须已换成名称
  const hoBody = literalBlock(hoSrc, 'prefix') ?? ''
  const workMentions = (hoBody.split(NAME_WORK).length - 1)
  if (workMentions < 3) bad(`③b ${NAME_HO} 正文提到「${NAME_WORK}」仅 ${workMentions} 次（A 段 3 处 + B 段若干，应 ≥3）`)
  else ok(`③b ${NAME_HO} 正文提到「${NAME_WORK}」${workMentions} 次`)
}

// ── ④ 两份正文都含语言规则 ─────────────────────────────────────────────
{
  for (const [label, src] of [[NAME_HO, hoSrc], [NAME_WORK, workSrc]]) {
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
  // 人读版：block0 = Hob A+B+C 段（全文）；block1 = Hob-Execute 正文
  const d0 = draftBlock(0)
  const d1 = draftBlock(1)
  if (d0 === undefined || d1 === undefined) {
    bad('⑤ 人读版（.md）里没找到两个引文块（期望 ````text / ```text 各一）')
  } else {
    // Hob：人读版 == 预设正文（全文，逐字）
    if (hoBody.trimEnd() !== d0.trimEnd()) {
      bad(`⑤ ${NAME_HO}：人读版引文块与预设正文不一致（应全文逐字相同）`)
      const a = hoBody.split('\n'), b = d0.split('\n')
      const n = Math.max(a.length, b.length)
      for (let i = 0; i < n; i++) {
        if (a[i] !== b[i]) { bad(`     首个差异在第 ${i + 1} 行：\n       预设: ${JSON.stringify(a[i])}\n       人读: ${JSON.stringify(b[i])}`); break }
      }
      if (a.length !== b.length) bad(`     行数不同：预设 ${a.length} 行，人读 ${b.length} 行`)
    } else ok(`⑤ ${NAME_HO}：人读版引文块 == 预设正文（全文逐字）`)

    if (workBody.trimEnd() !== d1.trimEnd()) {
      bad(`⑤ ${NAME_WORK}：人读版引文块与预设正文不一致（应逐字相同）`)
      const a = workBody.split('\n'), b = d1.split('\n')
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) { bad(`     首个差异在第 ${i + 1} 行：\n       预设: ${JSON.stringify(a[i])}\n       人读: ${JSON.stringify(b[i])}`); break }
      }
    } else ok(`⑤ ${NAME_WORK}：人读版引文块 == 预设正文（逐字）`)
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
  const H1 = `## 给「${NAME_WORK}」的指令`
  const H2 = '## 白话说明'
  const i1 = hoBody.indexOf(H1)
  const i2 = hoBody.indexOf(H2)
  if (i1 < 0) bad(`⑤b ${NAME_HO}：缺第一部分的二级标题 ${JSON.stringify(H1)}`)
  else if (i2 < 0) bad(`⑤b ${NAME_HO}：缺第二部分的二级标题 ${JSON.stringify(H2)}`)
  else if (i1 > i2) bad(`⑤b ${NAME_HO}：两个二级标题顺序颠倒（第一部分应为 ${JSON.stringify(H1)}）`)
  else ok(`⑤b ${NAME_HO}：两段标题在位且有序（${H1} → ${H2}）`)

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
      bad(`⑤b ${NAME_HO}：${H1} 之后一行应为「4 个反引号 + markdown」的代码围栏，实测 ${JSON.stringify(fenceLine)}`)
    } else ok(`⑤b ${NAME_HO}：${H1} 后紧跟 4 反引号 + markdown 围栏（${JSON.stringify(fenceTrim)}），且标题在围栏**外**`)

    // ③ 该围栏必须闭合，且闭合发生在「白话说明」标题**之前**
    //    （否则等于把白话段也包进去了）
    const openLen = FENCE.exec(fenceTrim)?.[1].length ?? 0
    const bodyLines = afterH1.split('\n')
    let closeIdx = -1
    for (let i = 1; i < bodyLines.length; i++) {
      if (bodyLines[i].trim() === '`'.repeat(openLen)) { closeIdx = i; break }
    }
    const h2Line = bodyLines.findIndex((l) => l.trim() === H2)
    if (closeIdx < 0) bad(`⑤b ${NAME_HO}：指令段的围栏未闭合（找不到同长度 ${openLen} 反引号的闭合行）`)
    else if (h2Line >= 0 && closeIdx > h2Line) bad(`⑤b ${NAME_HO}：围栏跨过了「白话说明」标题 ⇒ 白话段被包进代码块`)
    else ok(`⑤b ${NAME_HO}：指令段围栏成对闭合，且未跨过「白话说明」标题（白话段未被包住）`)

    // ③b **围栏长度固定为 4**（v5 取消了"含代码块才加长"的条件式）——
    //     旧口径会写 `{3,}`；这里是**精确 4**，写成 3 或 5 都算 FAIL。
    //     ⚠ 只在围栏**格式合法**时才比对长度：否则 ② 已报"格式不对"，
    //       这里再报"实测 0 个"属于**误导性读数**（0 是没匹配上，不是真有 0 个反引号）。
    if (FENCE.test(fenceTrim)) {
      if (openLen !== 4) bad(`⑤b ${NAME_HO}：围栏应为固定 4 个反引号，实测 ${openLen} 个`)
      else ok(`⑤b ${NAME_HO}：围栏长度 = 4（固定，无条件式）`)
    }

    // ③c **指令正文内不得出现 4 个及以上连续反引号**（否则外层围栏提前闭合）。
    //     判据：取第一段围栏**内部**的行，扫 `{4,}` 的连续反引号。
    const openIdx = bodyLines.findIndex((l) => FENCE.test(l.trim()))
    if (openIdx >= 0) {
      const closeIdx2 = bodyLines.findIndex((l, k) => k > openIdx && l.trim() === '````')
      const innerLines = closeIdx2 > openIdx ? bodyLines.slice(openIdx + 1, closeIdx2) : bodyLines.slice(openIdx + 1)
      const longRuns = innerLines.filter((l) => /`{4,}/.test(l))
      if (longRuns.length > 0) {
        bad(`⑤b ${NAME_HO}：指令正文含 4 个及以上连续反引号（${longRuns.length} 行），会提前闭合外层围栏：${JSON.stringify(longRuns[0].slice(0, 60))}`)
      } else ok(`⑤b ${NAME_HO}：指令正文内无 4 个及以上连续反引号（外层围栏不会被提前闭合）`)
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
    if (!needle.test(hoBody)) bad(`⑤b ${NAME_HO}：## Rules 缺「${label}」条文`)
    else ok(`⑤b ${NAME_HO}：## Rules 含「${label}」条文`)
  }

  // ④b **v6 新增：按需触发的两项断言**（UD-58）
  //    (a) 默认正常回复 + 不得写空壳/占位句（防止"为填格式而编任务"）
  //    (b) 触发条件存在（"仅在产生交给实施侧预设的活时才出两部分"）
  //    ⚠ 与 (a) 配对的是**删除**「两段强制」：若有人把强制口径改回来，
  //      (b) 的触发条件判定仍在（"produces work for <实施侧>"），故另设 (c) 负向断言
  //      「不得出现每轮强制的措辞」，见 ④c。
  if (/ordinary Markdown by default/.test(hoBody)) ok(`⑤b ${NAME_HO}：含「默认正常 Markdown 回复」条文`)
  else bad(`⑤b ${NAME_HO}：缺「默认正常 Markdown 回复」条文（v6 按需触发的落点）`)

  if (/do not invent a task to fill the shape/.test(hoBody) && /do not emit a placeholder/.test(hoBody)) {
    ok(`⑤b ${NAME_HO}：含「不得编造任务 / 不得输出占位句」条文`)
  } else {
    bad(`⑤b ${NAME_HO}：缺「不得编造任务 / 不得输出占位句」条文（无活时不得写空壳）`)
  }

  if (hoBody.includes(`ONLY when the turn actually produces work for ${NAME_WORK} to carry out`)) {
    ok(`⑤b ${NAME_HO}：含「仅在该轮确产生交给 ${NAME_WORK} 的活时才用两部分」触发条件`)
  } else {
    bad(`⑤b ${NAME_HO}：缺按需触发的触发条件条文`)
  }

  // ④c **v6 负向断言：每轮强制的措辞不得回归**
  //     ⚠ 这两句正是 v6 要逐字删掉的那两条；只靠 ④ 的"条文存在"抓不到它们**复活**
  //       （条文可以共存 —— 既写"按需触发"又写"每次必须两段"，那是自相矛盾）。
  for (const [label, needle] of [
    ['强制性首句（Every reply is exactly two parts）', /Every reply is exactly two parts/],
    ['强制条（Both parts are mandatory）', /Both parts are mandatory/],
  ]) {
    if (needle.test(hoBody)) bad(`⑤b ${NAME_HO}：正文仍含已废除的强制条文「${label}」`)
    else ok(`⑤b ${NAME_HO}：已废除的强制条文「${label}」为 0 残留`)
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
    if (missing.length > 0) bad(`⑤b ${NAME_HO}：触发时的结构细则缺项：${missing.join(' / ')}`)
    else ok(`⑤b ${NAME_HO}：触发时结构四项俱全（标题在围栏外 / 只包第一段 / 固定 4 反引号 / 围栏不跨白话标题）`)
  }

  // ⑤ 负向断言：**旧分隔符一律不得残留**（UD-55「删除全部分隔符与包装」）
  //    ⚠ 这条是本条存在的核心理由：⑤ 是"两份一致"，两份一起改回旧格式它照样 PASS。
  //    ⚠ v5 未放开此禁令（用户明示"10 种旧分隔符禁令必须保留"）。
  const LEGACY = ['<<<CMD>>>', '<<<END_CMD>>>', '<<<NOTE>>>', '<<<END_NOTE>>>',
    '<<<WHAT>>>', '<<<END_WHAT>>>', '<<<JUDGE>>>', '<<<END_JUDGE>>>',
    '<<<NEXT>>>', '<<<END_NEXT>>>']
  const residue = LEGACY.filter((m) => hoBody.includes(m))
  if (residue.length > 0) {
    bad(`⑤b ${NAME_HO}：正文仍残留旧分隔符（${residue.length} 种）：${residue.join(' ')}`)
  } else ok(`⑤b ${NAME_HO}：10 种旧分隔符均为 0 处残留`)

  // ⑥ ⚠ **v5 已删除**原三条排版禁令断言（禁 emoji / 禁 ASCII 线 / 禁表格徽章）：
  //    用户裁定"装饰放开"（UD-57）。此处**不再断言**，也**不反向断言必须出现装饰** ——
  //    装饰是**允许**而非**要求**。
  ok(`⑤b ${NAME_HO}：排版禁令断言已按 v5 移除（装饰放开，非强制）`)

  // ⑦ 语言标记**不得**是 v4 的 `text`：与 ② 互为补充 —— ② 要求"是 4+markdown"，
  //    本条要求"不是 text"，使"把 markdown 改回 text"这一具体回退**单独可观测**。
  {
    const h1Line = hoBody.lastIndexOf(H1)
    if (h1Line >= 0) {
      const fenceLine = hoBody.slice(h1Line).split('\n').find((l) => l.trim() !== '')
      if (/^`{3,}text$/.test((fenceLine ?? '').trim())) {
        bad('⑤b ' + NAME_HO + '：围栏语言标记仍是 v4 的 \`text\`（v5 应为 markdown）')
      } else ok(`⑤b ${NAME_HO}：围栏未使用 v4 的 \`text\` 标记`)
    }
  }
}

// ── ⑤c 职责句短钉（2026-10-07 批 3 职责重定义）─────────────────────────
//
// 为什么需要：批 3 重写了职责段，而 ⑤ 只能证明"两份载体一致"、⑤b 只管格式结构 ——
// 职责条文本身**没有任何断言覆盖**（两份一起被删照样 PASS）。本条把用户诉求
// （Hob = 沟通/理解需求/拆分/编排/分发/监督验收；Hob-Execute = 面向 Hob 执行落实）
// 各钉 1 条**稳定短语**，断言"该句仍在"。
//
// ⚠ 口径说明（防误读）：钉的是**稳定短语**而不是整段逐字 —— 措辞可随文调整，
//   但只要该职责还在，句子就还在。**这是新增断言，不是放宽**：任何一条缺失即 FAIL。
{
  const hoBody2 = literalBlock(hoSrc, 'prefix') ?? ''
  const workBody2 = literalBlock(workSrc, 'prefix') ?? ''
  const DUTY_PINS = [
    // [标签, 正文, 稳定短语]
    [NAME_HO, hoBody2, [
      ['职责标题在位', '## Your duties'],
      ['与用户沟通 + 理解需求', 'Talk with the user and understand what they actually need'],
      ['拆分任务', 'Break that need into tasks'],
      ['编排任务', 'Arrange the tasks'],
      ['分发任务（产出给 Hob-Execute 的指令）', 'Turn the work into directives for ' + NAME_WORK],
      ['监督验收落实情况', 'Follow up on what was actually carried out'],
      ['不实施', 'You do not implement'],
      ['无自动投递（如实声明）', 'There is NO automatic delivery'],
      ['不得声称已自动投递', 'never claim you sent, dispatched'],
      ['验收步骤在位', 'that is the acceptance step'],
    ]],
    [NAME_WORK, workBody2, [
      ['职责标题在位', '## Your duties'],
      ['面向 Hob（不是面向用户）', 'You answer to ' + NAME_HO + ', not to the user'],
      ['承担执行落实', 'them out in the workspace: read and write files'],
      ['执行 = 真做并报告', 'Carrying out means actually doing the work and reporting what happened'],
      ['砍不到的部分交回 Hob', 'must go back to ' + NAME_HO],
      ['报告纪律保留', 'Never claim a result you did not verify'],
      ['语言规则保留', 'language the user is currently using'],
    ]],
  ]
  for (const [label, body, pins] of DUTY_PINS) {
    for (const [what, phrase] of pins) {
      if (body.includes(phrase)) ok(`⑤c ${label}：职责句在位（${what}）`)
      else bad(`⑤c ${label}：职责句缺失（${what}）—— 期望短语 ${JSON.stringify(phrase)}`)
    }
  }
}

// ── ⑤d 文件交接条文短钉（2026-10-07 批 5 · UD-63 / CHG-011）───────────
//
// 为什么需要：批 5 把「整段正文」的交接改成「文件承载 + 用户转达路径」，
// 而 ⑤ 只能证明"两份载体一致"、⑤b 只管两段式格式结构、⑤c 只管职责句 ——
// **交接方式本身没有任何断言覆盖**（两份一起被删照样 PASS）。
// 本条把用户诉求（UD-63）各钉一条**稳定短语**：
//   · Hob 侧：有活时把完整指令写进 `.hob/archive/<YYYY-MM-DD-slug>/TASK.md`；
//     围栏内只放**短指针**（路径 + 一句"读该文件并执行"）；用户点名要全文时以用户为准；
//     **仍然没有自动投递**（不得因"文件化"而声称自动）。
//   · Hob-Execute 侧：指令可能**以路径形式**给出 ⇒ 先读文件；
//     回报写进**同目录** `REPORT.md`（过长拆 `REPORT-2.md` …）并把路径**一行**告诉用户；
//     只在该交接目录内写回报，四本账本归 Hob；该目录被 `.gitignore` 覆盖、不进版本库。
//
// ⚠ 口径说明（防误读）：钉的是**稳定短语**而不是整段逐字 —— 措辞可随文调整，
//   但只要该做法还在，句子就还在。**这是新增断言，不是放宽**：任何一条缺失即 FAIL。
// ⚠ 编号说明：任务书写的是「⑤b 新增」，实际落在 **⑤d**（⑤c 已于批 3 占用，且语义上
//   "交接条文"与 ⑤b 的"格式结构"不同类）。语义与任务书一致，区别只在编号，如实记于回报。
{
  const hoBody3 = literalBlock(hoSrc, 'prefix') ?? ''
  const workBody3 = literalBlock(workSrc, 'prefix') ?? ''
  const HANDOFF_PINS = [
    // [标签, 正文, 稳定短语]
    [NAME_HO, hoBody3, [
      ['完整指令落 TASK.md（含目录名形状）', '.hob/archive/<YYYY-MM-DD-slug>/TASK.md'],
      ['落文件在前（write ... first）', 'write the full\ndirective into `.hob/archive/<YYYY-MM-DD-slug>/TASK.md` first'],
      ['围栏内只放短指针', 'part one holds only the short pointer'],
      ['短指针 = 路径 + 一句"读该文件并执行"', 'plus one line telling Hob-Execute to read that file and carry'],
      ['不再同时贴全文', 'Do not\npaste the full directive into the reply as well'],
      ['用户点名要全文时以用户为准', "asks for the full\ntext in the reply, the user's request wins"],
      ['文件化不改投递机制（仍无自动投递）', 'This changes only what the user carries, not how it gets there'],
      ['不得声称已自动投递', 'Never describe the hand-off as automatic for this reason either'],
      ['围栏口径同步为"短指针（或全文）"', 'the block holds the pointer alone (or the full text when the user asked for it)'],
      ['工作区文件路径可给用户看', 'A workspace file path (such as `.hob/archive/.../TASK.md`) is NOT an internal'],
    ]],
    [NAME_WORK, workBody3, [
      ['指令可能以路径形式给出 ⇒ 先读文件', 'A directive may arrive as a file path instead of as full text'],
      ['先读后做（不得要求用户重贴）', 'read that\nfile first and then carry out what it says'],
      ['回报落同目录 REPORT.md', 'write it into `REPORT.md` in the SAME\ndirectory as the directive file you were given'],
      ['过长拆 REPORT-2.md 等', '`REPORT-2.md`, `REPORT-3.md` and so on'],
      ['把路径一行告诉用户', 'Then tell\nthe user the path, in one line'],
      ['只在该交接目录内写回报', 'Write report files only inside that hand-off directory'],
      ['四本账本归 Hob、不得写', "are Hob's ledgers, and they are not yours to write"],
      ['该目录被 .gitignore 覆盖、不进版本库', 'covered by `.gitignore`, so it does not enter the\nrepository'],
      ['工作区文件路径可给用户看', 'A workspace file path (such as `.hob/archive/.../REPORT.md`) is NOT an internal'],
    ]],
  ]
  for (const [label, body, pins] of HANDOFF_PINS) {
    for (const [what, phrase] of pins) {
      if (body.includes(phrase)) ok(`⑤d ${label}：文件交接条文在位（${what}）`)
      else bad(`⑤d ${label}：文件交接条文缺失（${what}）—— 期望短语 ${JSON.stringify(phrase)}`)
    }
  }
}

// ── ⑤e 编排规则 / 回报格式 / 禁弹窗条文短钉（2026-10-07 批 6 · UD-64 / UD-65 · CHG-012）─
//
// 为什么需要：批 6 在两侧各**就地追加**一段正文（Hob 侧 = 委派门槛 / 指令自足 / 攒批 /
// 验收只认读数 / 接住问题；Hob-Execute 侧 = 禁交互提问 + 回报固定六段），
// 而 ⑤ 只能证明"两份载体一致"、⑤b 只管两段式格式、⑤c 只管职责句、⑤d 只管文件交接 ——
// **编排规则与回报格式本身没有任何断言覆盖**（两份一起被删照样 PASS）。
// 本条把用户诉求（UD-64 / UD-65）各钉若干**稳定短语**，断言"该条文仍在"。
//
// ⚠ 口径说明（防误读）：
//   · 钉的是**稳定短语**而不是整段逐字 —— 措辞可随文调整，只要该规则还在，句子就还在。
//     **这是新增断言，不是放宽**：任何一条缺失即 FAIL。
//   · 编号：任务书只写「新增语义断言」、未指定编号。现最大为 ⑤d ⇒ 顺延为 **⑤e**
//     （与批 5 的「任务书写 ⑤b、实际落 ⑤d」同款：语义一致，区别只在编号；如实记于回报）。
//   · **不钉标题行**：任务书 §2.1/§2.2 要求**就地追加在既有段落正文内**、**不新起 `##` 小节**，
//     钉标题会把"就地追加"这一形态本身变成要求。
//   · **禁弹窗组的短语里不出现内部标识**（工具名）—— 那正是契约条文自己的要求
//     （"以那类工具为代表，不列举内部标识"）。故断言用「弹出问题、等真人」这类描述性短语，
//     而不是把工具名钉进机检。
{
  const hoBody4 = literalBlock(hoSrc, 'prefix') ?? ''
  const workBody4 = literalBlock(workSrc, 'prefix') ?? ''
  const ORCH_PINS = [
    // [标签, 正文, 稳定短语]
    [NAME_HO, hoBody4, [
      ['委派门槛：只把"必须动手"的活交出去', 'delegate only work that MUST be done by hand'],
      ['委派成本（交接 + 复核）', 'the hand-over itself, plus the review when it comes back'],
      ['能自己问清/查清的先做掉', 'settle it first'],
      ['不为转手而转手', 'Do not hand work over just to pass it along'],
      ['指令自足（目标/边界/判据/前情）', 'Every directive must stand on its own'],
      ['不得把产品决策留给下游猜', 'Never leave a\nproduct decision for the other side to guess'],
      ['攒批（一条指令 + 一次重启）', 'Batch what can ride together'],
      ['验收只认原始读数', 'Accept on readings only'],
      ['读数 = 退出码/文件字节/日志字段', "a\ncommand's exit code, the bytes of a file, a log field"],
      ['不认"声称完成"', 'never by the claim that it is'],
      ['核不到就说"未验证"', 'say plainly which part is'],
      ['接住回报里的待决问题', 'Catch the questions'],
      ['逐条处理（能定的定、只有用户能定的转选项）', 'ones only the user can settle, turn into options'],
      // ⚠ 负向口径：**逐字保留**的投递禁令（不得写成已具备自动投递能力）
      ['投递禁令逐字保留（仍无自动投递）', 'There is still NO automatic delivery for the directive'],
      ['不得声称自动投递（同段重申）', 'Never describe the hand-off as automatic for this reason either'],
    ]],
    [NAME_WORK, workBody4, [
      ['禁交互提问（用描述、不列举内部标识）', 'no tool that pops up a question and waits for a live human to answer it'],
      ['为什么禁：对接 Hob 不是用户 ⇒ 会堵塞', 'You answer to Hob, not to the user, so a question that waits for someone to type would stall the work'],
      ['不含糊的部分照做', 'the part that is unambiguous, do it'],
      ['问题记下来', 'the question, write it down'],
      ['随完成回报一并交回（不中断/不阻塞）', 'hand both back together when you finish -- no interruption and no blocking'],
      ['卡住 ⇒ 停在安全状态', 'stop in a safe state'],
      ['不留半成品 / 不做不可逆动作', 'leave no half-finished work behind and take no irreversible action'],
      ['卡点写进回报的待决问题段', 'the open-questions section of the report'],
      ['问题写成可直接回答、一条一行', 'Write each question so it can be answered directly, one per line'],
      ['回报六段：固定形状与顺序', 'in six sections, in this order'],
      ['第1段 结论先行（成/不成/部分成）', 'Verdict first -- done / not done / partly done'],
      ['第2段 前置读数（时间戳类判据）', 'Baseline readings -- the timestamp-style facts'],
      ['第3段 做了什么（附原始证据）', 'with the raw evidence'],
      ['第4段 未做到·未验证·与指令不符（不得埋）', 'never bury this; write "none" when there is none'],
      ['第5段 待决问题（含建议默认取值）', 'with your suggested default where you have one'],
      ['第6段 建议（可省）', 'Suggestions -- what to do next; may be omitted'],
      ['会话里只有一行（结论 + 路径）', 'give only one line: the verdict plus the path of `REPORT.md`'],
    ]],
  ]
  for (const [label, body, pins] of ORCH_PINS) {
    for (const [what, phrase] of pins) {
      if (body.includes(phrase)) ok(`⑤e ${label}：编排/回报条文在位（${what}）`)
      else bad(`⑤e ${label}：编排/回报条文缺失（${what}）—— 期望短语 ${JSON.stringify(phrase)}`)
    }
  }

  // ⚠ **形态负向断言**：批 6 条文**必须就地追加在既有段落正文内**，**不得新起 `##` 小节**。
  //   本组不钉标题行（见上），但必须确认**没有人为这两段新起标题** ——
  //   否则"就地追加"这一形态要求会被静默破坏（与批 5 同款纪律）。
  for (const [label, body, forbidden] of [
    [NAME_HO, hoBody4, ['## Delegation', '## How you delegate', '## Delegating']],
    [NAME_WORK, workBody4, ['## Reporting', '## Report format', '## Open questions', '## Asking']],
  ]) {
    const extra = forbidden.filter((h) => body.includes(h))
    if (extra.length > 0) bad(`⑤e ${label}：批 6 条文新起了小节标题（${extra.join(', ')}）—— 应为就地追加`)
    else ok(`⑤e ${label}：批 6 条文未新起小节标题（就地追加在既有段落内）`)
  }
}

// ── ⑤f 批 9 · Hob 能力扩展：白名单目标名 + 禁止项 + 失实句清除 ──────────────
//
// 为什么需要：批 9（范围 S1+S2+S3）给 Hob 加了 9 类只读能力，机制落点是
//   **声明面 与 白名单 的「与门」**（见 EXPERIENCE E-86）：
//   · 白名单 = `src/preset/tools.ts` 的 `MODEL_TOOL_ALLOWLIST`（模型面 + 执行前拦截共用那一份）；
//   · 声明面 = `preset/dsh-hob/preset-dsh-hob.patch.yml` 的 `plugins` 行。
// ⑤/⑤b/⑤c/⑤d/⑤e 都只管**契约正文**（人读/机器读一致、格式、职责句、交接、编排），
// **一条都不覆盖"白名单里到底有哪几个名字"** —— 有人把新增的 9 名删掉，上面全组照样 PASS。
// 本条把它钉住；同时用**负向断言**钉住"禁止项不得混进来"与"失实句不得回归"。
//
// ⚠ 口径说明（防误读）：
//   · 钉的是**工具名集合**（这是机检能判定的那一层），不是"工具真能跑通" ——
//     后者须隔离实例活体读数（本批已在报告第 3 段给出原始输出）。
//   · **这是新增断言，不是放宽**：任何一条缺失即 FAIL；⑥ 的两条既有断言**一条未动**。
//   · 编号：任务书写「新增 ⑤f 组」；⑤e 已占 ⇒ 顺延落 **⑤f**，与任务书一致。
{
  const hoBody5 = literalBlock(hoSrc, 'prefix') ?? ''

  // 从源码读白名单：只做**行级**抽取（本仓零第三方依赖纪律），不 eval 那个 TS 文件。
  const toolsSrc = (() => {
    try { return readFileSync(join(root, 'src', 'preset', 'tools.ts'), 'utf8') } catch { return undefined }
  })()

  if (toolsSrc === undefined) {
    bad('⑤f 读不到 src/preset/tools.ts（白名单的唯一来源）')
  } else {
    // 抽取 `export const MODEL_TOOL_ALLOWLIST: readonly string[] = [ ... ]` 间的字符串字面量。
    const m = /export const MODEL_TOOL_ALLOWLIST[^=]*=\s*\[([\s\S]*?)\n\]/.exec(toolsSrc)
    if (m === null) {
      bad('⑤f 在 src/preset/tools.ts 里找不到 MODEL_TOOL_ALLOWLIST 的字面量数组')
    } else {
      const allow = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
      const allowSet = new Set(allow)

      // ── 正向：S1/S2/S3 的 9 个目标名**必须**在白名单里 ────────────────
      // ⚠ 这 9 名分三类，各自的能力落点不同（见 E-86）：
      //   · S1（4）声明面**零增量** —— 已在插件平面被继承；
      //   · S2（1）/ S3（4）**必须**在声明面指名增行，否则执行时报 `unknown tool`。
      //     声明面那一侧由下面「声明面增行」子断言覆盖。
      const NEEDED = [
        ['S1 编排只读查询', 'taskboard_list'],
        ['S1 编排只读查询', 'taskboard_get'],
        ['S1 编排只读查询', 'taskboard_comments'],
        ['S1 编排只读查询', 'roundtable_status'],
        ['S2 打开网页取正文', 'web_fetch'],
        ['S3 只读看工作区文件', 'read'],
        ['S3 只读看工作区文件', 'glob'],
        ['S3 只读看工作区文件', 'grep'],
        ['S3 只读看工作区文件', 'read_image'],
      ]
      const missing = NEEDED.filter(([, n]) => !allowSet.has(n))
      if (missing.length > 0) {
        bad(`⑤f ${NAME_HO} 白名单缺目标名（${missing.length} 个）：${missing.map(([g, n]) => `${n}(${g})`).join(', ')}`)
      } else ok(`⑤f ${NAME_HO}：白名单含 S1/S2/S3 全部 9 个目标名（${NEEDED.map(([, n]) => n).join(', ')}）`)

      // ── 负向：禁止项**一律不得**在白名单里 ──────────────────────────
      // ⚠ 这份清单不是拍脑袋：S4（写工作区）/ S5（跑命令）/ S6（派活/改共享状态）/
      //   S8（委派）**本批明确不做**（任务书 §1.1 第 20 行 + §4 末行），
      //   加上 UD-13 / UD-56 早已排除的交互提问与代码开发类。
      //   `write`/`edit` 属 S4（**本批不做**）；它们会随 `tool-fs` 落到**注册面**，
      //   但**不得**进白名单 —— 这是 §1.3「不把 write/edit 放进声明面之外的第二道闸」的落点。
      const FORBIDDEN = [
        ['S5 跑命令', 'bash'],
        ['S4 写工作区文件', 'write'],
        ['S4 写工作区文件', 'edit'],
        ['S6/S8 派活与委派', 'spawn_teammate'],
        ['S6/S8 派活与委派', 'send_message'],
        ['S6 改共享状态', 'taskboard_move'],
        ['S8 委派', 'subagent'],
      ]
      // ⚠⚠ **批 11 移除一项：`ask_user_question`（本批唯一允许的断言改动）** ──────
      // **理由（用户裁定）**：UD-68 / CHG-015 —— 「**允许 Hob 提问**，但**尽量不问**；
      //   按项目方案主线决策推进，除非只能由用户决策才可以提问」，且**只限 Hob 预设**。
      //   批 9 时该项因「S7 未定 ⇒ 不碰」被列入禁项；**S7 现已由用户裁定为"允许"**
      //   ⇒ 该禁项的前提消失，**必须**移除，否则机检会与既定契约**互相矛盾**
      //   （契约写着"只有用户能定时才问"，机检却断言"不许有这个工具"）。
      // ⚠ **这不是放宽**：同组另 7 项**一条未动**；且本条移除有**负向对拍**兜底 ——
      //   把 `ask_user_question` 从白名单删掉 ⇒ 下面「正向必需」断言**立即 FAIL**
      //   （见本函数上方 NEEDED 组与本批报告 §3 的原始读数）。
      // ⚠ 同步落点（三处必须一致，已同批改）：`src/preset/tools.ts` 的白名单、
      //   `preset/dsh-hob/preset-dsh-hob.patch.yml` 的 `tool-ask-user` 声明行、
      //   以及 `.hob/drafts/preset-contracts.md` 的引文块与 §五 断言清单。
      const present = FORBIDDEN.filter(([, n]) => allowSet.has(n))
      if (present.length > 0) {
        bad(`⑤f ${NAME_HO} 白名单**含禁止项**（${present.length} 个）：${present.map(([g, n]) => `${n}(${g})`).join(', ')}`)
      } else ok(`⑤f ${NAME_HO}：白名单不含 ${FORBIDDEN.length} 个禁止项（${FORBIDDEN.map(([, n]) => n).join(', ')}）`)
      // ⚠ 与上面成对的**正向**断言（批 11 新增，D2 的"有牙"证明）：
      //   移出禁项**不等于**可以没有它 —— 白名单**必须**含 `ask_user_question`，
      //   否则契约里"允许提问"这条**没有实现载体**（与 E-86 的「与门」同款：
      //   契约说了能力、白名单没放行 ⇒ 能力不存在，而机检看不出来）。
      if (!allowSet.has('ask_user_question')) {
        bad(`⑤f ${NAME_HO} 白名单**缺** \`ask_user_question\`（批 11 / D2：UD-68 裁定允许 Hob 提问）`
          + ' —— 契约里的「决策自主 + 只在只有用户能定时才问」将没有实现载体')
      } else ok(`⑤f ${NAME_HO}：白名单含 \`ask_user_question\`（批 11 / D2 正向项，与"禁止项不含它"成对）`)
      // ⚠ 配对的正向断言：声明面必须有 `tool-ask-user` 行（与门另一半，见 E-86）
      // ⚠⚠ **必须先把 YAML 注释行剔掉再判**（本批实测的**假通过**，负向对拍 D-2 抓出）：
      //   本文件里的注释块**逐字引用了宿主那两行**（`# 131/132: … name: '…tool-ask-user'`），
      //   若不剔注释，则"声明行被删掉"时该断言**照样 PASS**（注释里那份还在）
      //   ⇒ 断言退化成恒真，正是 E-67「判据不能区分成功与恰好看起来像成功」那一族。
      //   判据：去掉**行首（允许缩进）为 `#`** 的行 ⇒ 只剩真正的声明行。
      const stripYamlComments = (s) => s.split('\n')
        .filter((l) => !/^\s*#/.test(l)).join('\n')
      const hoDeclsOnly = stripYamlComments(hoSrc).replace(/'([^']*)'/g, '$1')
      if (!hoDeclsOnly.includes('name: @deepseek-ai/dsh-tool-ask-user')) {
        bad(`⑤f ${NAME_HO} 声明面缺指名增行 \`tool-ask-user\`（批 11 / D2）`
          + ' —— 白名单放行了名字但作用域内没有该工具 ⇒ 执行期 `unknown tool`'
          + '（⚠ 判据已剔除 YAML 注释行：注释里逐字引用的那一份不算声明）')
      } else ok(`⑤f ${NAME_HO}：声明面 \`tool-ask-user\` 指名增行在位（与白名单成对，见 E-86；判据已剔注释）`)

      // ── 负向：失实句不得回归（契约自己说谎）──────────────────────────
      // 批 9 之前正文写「no file reads or writes, no commands」——
      // **本批之后该句不成立**（只读读文件已可用）。它若回来，就是契约失实。
      const LIES = [
        ['失实句①「你不执行任何工作」（读文件已可用）', 'You never execute the work yourself'],
        ['失实句②「没有文件读写、没有命令」', 'no file reads or writes'],
        ['失实句③「你手上只有读 .md 与写账本」', 'reading project documents (.md) and writing your own'],
      ]
      const back = LIES.filter(([, s]) => hoBody5.includes(s))
      if (back.length > 0) {
        bad(`⑤f ${NAME_HO} 契约正文**失实句回归**（${back.length} 处）：${back.map(([l]) => l).join('; ')}`)
      } else ok(`⑤f ${NAME_HO}：契约正文 0 处失实句残留（三处均已就地改对）`)

      // ── 正向：改动后的**新表述**在位（否则"删掉旧句"就能骗过上面那条）──
      // ⚠ 这是负向断言的**配对项**：只删不写会让契约变成"什么也没说"，
      //   比原来更糟（读者无法判断 Hob 到底能做什么）。
      const NEW_WORDING = [
        ['只读的事直接做 / 改动的活不做', 'What is read-only, you do directly'],
        ['没有任何「改动」能力（四条并列）', 'you cannot edit code'],
        ['只读检索与浏览（文档+工作区+网页+看板/圆桌只读查询）', 'read-only queries against the board and'],
        ['只写自己的账本与交接文件', 'plus writing your own ledger and hand-off files'],
      ]
      const gone = NEW_WORDING.filter(([, s]) => !hoBody5.includes(s))
      if (gone.length > 0) {
        bad(`⑤f ${NAME_HO} 契约正文缺新表述（${gone.length} 处）：${gone.map(([l]) => l).join('; ')}`)
      } else ok(`⑤f ${NAME_HO}：契约正文新表述四项俱全（只读直接做 / 无改动能力 / 只读检索浏览 / 只写账本）`)

      // ── 声明面：S2/S3 指名增行在位，且**未整段照抄 standard** ──────────
      // 判据（可机检的两条）：
      //   ① 三个指名行的 `name` 都在（`tool-web` / `tool-fs` / `tool-fs-search`）；
      //   ② 撞边界的行**不在**（`tool-bash` / `tool-pwsh` / `tool-ask-user` / `delegation`）。
      // ⚠ ② 是"不许整段照抄"的**可机检落点**：字面照抄 standard 会把它们一并带进来。
      const DECL_ROWS = [
        ['S2 tool-web', '@deepseek-ai/dsh-tool-web'],
        ['S3 tool-fs', '@deepseek-ai/dsh-tool-fs'],
        ['S3 tool-fs-search', '@deepseek-ai/dsh-tool-fs-search'],
      ]
      // ⚠ 归一化后匹配（容忍 `name: 'X'` / `name: X` 两种 YAML 写法），理由同下面的禁令组。
      const hoSrcNorm = hoSrc.replace(/'([^']*)'/g, '$1')
      const decMissing = DECL_ROWS.filter(([, pk]) => !hoSrcNorm.includes(`name: ${pk}`))
      if (decMissing.length > 0) {
        bad(`⑤f ${NAME_HO} 声明面缺指名增行（${decMissing.length} 个）：${decMissing.map(([l, p]) => `${l}=${p}`).join(', ')} —— 白名单放行了名字但作用域内没有该工具 ⇒ 执行期 `+'`unknown tool`')
      } else ok(`⑤f ${NAME_HO}：声明面三个指名增行在位（tool-web / tool-fs / tool-fs-search）`)

      const DECL_BANNED = [
        ['跑命令', '@deepseek-ai/dsh-tool-bash'],
        ['跑命令', '@deepseek-ai/dsh-tool-pwsh'],
        ['委派组（S8 不做）', 'cordis:group'],
      ]
      // ⚠⚠ **批 11 移除一项：`@deepseek-ai/dsh-tool-ask-user`（同一处断言改动的另一面）** ──
      // 与上面「白名单禁项」同步：该行的排除前提是「S7 未定 ⇒ 不碰」，
      // 用户裁定 **UD-68 / CHG-015** 后 S7 = **允许**（**只限 Hob 预设**）⇒
      // 该声明行**必须**在，否则白名单放行了名字而作用域内没有该工具
      // ⇒ 执行期 `unknown tool`（E-86 的「与门」另一半）。
      // ⚠ 同组另 3 项**一条未动**；且新增正向断言（见上）保证"它有牙"。
      // ⚠ `cordis:group` 那条仍**必须**留着：它同时钉"没有整段照抄来的分组行"。
      // ⚠ `cordis:group` 单独判：Hob 侧**不得**出现任何分组行（standard 的 delegation 组
      //   就是 `cordis:group`）。本预设至今零分组 ⇒ 这条同时钉住"没有整段照抄来的组"。
      // ⚠⚠ **匹配必须容忍带引号与不带引号两种写法**（实测教训，负向对拍 F 首轮漏过）：
      //   YAML 里 `name: cordis:group` 与 `name: 'cordis:group'` **都合法**，
      //   只钉带引号的形态 ⇒ 不带引号的写法会**静默通过**。
      //   同理不许用"精确字符串 includes"来判"某一行**不存在**"—— 归一化后再比。
      const normalizeName = (s) => s.replace(/'([^']*)'/g, '$1')
      const hoSrcN = normalizeName(hoSrc)
      const decBanned = DECL_BANNED.filter(([, pk]) => hoSrcN.includes(`name: ${pk}`))
      if (decBanned.length > 0) {
        bad(`⑤f ${NAME_HO} 声明面出现**撞边界/照抄残留**的行（${decBanned.length} 处）：${decBanned.map(([l, p]) => `${p}(${l})`).join(', ')}`)
      } else ok(`⑤f ${NAME_HO}：声明面无撞边界行、无照抄来的分组行（未整段照抄 standard）`)

      // ── 附：分组行形态的**独立**断言（不依赖上面那份 name 清单）──────────
      // 判据取 YAML 结构事实而不是名字：出现 `group: true` 即说明多了一个分组容器。
      const groupRows = (hoSrc.match(/^\s+group:\s*true\s*$/gm) ?? []).length
      if (groupRows !== 0) {
        bad(`⑤f ${NAME_HO} 声明面出现 ${groupRows} 个分组容器行（\`group: true\`）—— 本预设不含任何组，应就地单行声明`)
      } else ok(`⑤f ${NAME_HO}：声明面 0 个分组容器行（\`group: true\`），全部为就地单行声明`)
    }
  }

  // ── ⑥ 的两条既有断言**复跑确认未被破坏**（任务书 §3 第 4 条）────────────
  // ⚠ 这里**不重复实现** ⑥，只**再断言一次**它依赖的两个事实，使 ⑤f 单独读也能确认；
  //   ⑥ 本体的断言仍在下面原样保留（**未删、未放宽**）。
  const hoToolF = (hoSrc.split("name: '" + MODULE_PATH + "'").length - 1)
  if (hoToolF !== 1) bad(`⑤f 复跑：${NAME_HO} 的工具模块行应恰好 1 行，实测 ${hoToolF}（⑥ 被破坏）`)
  else ok(`⑤f 复跑：${NAME_HO} 的 ${JSON.stringify(MODULE_PATH)} 仍恰好 1 行（⑥ 未破坏）`)
}

// ── ⑤g 批 11 · Hob「决策自主」条文短钉（UD-68 / CHG-015）────────────────
//
// 为什么需要：批 11 给 Hob 契约**就地追加**一段（默认自行推进 / 只在只有用户能定时才问 /
// 问的方式要克制），而 ⑤ 只能证明"两份载体一致"——**两条一起被删照样 PASS**。
// 本条把用户诉求（UD-68）的**两条语义**各钉稳定短语，断言"该条文仍在"。
//
// ⚠ 口径说明（防误读）：
//   · 钉的是**稳定短语**而不是整段逐字 —— 措辞可随文调整，只要该规则还在，句子就还在。
//     **这是新增断言，不是放宽**：任何一条缺失即 FAIL。
//   · **不钉标题行**：任务书要求**就地追加在既有段落正文内**、**不新起 `##` 小节**；
//     钉标题会把"就地追加"这一形态本身变成要求（与批 5 / 批 6 同款纪律）。
//     故下面另设**形态负向断言**：不得出现新起的小节标题。
//   · 编号：任务书未指定编号；现有最大为 ⑤f ⇒ 顺延为 **⑤g**
//     （与批 5「任务书写 ⑤b、实际落 ⑤d」同款：语义一致，区别只在编号；如实记于回报）。
{
  const hoBody6 = literalBlock(hoSrc, 'prefix') ?? ''

  const AUTONOMY_PINS = [
    ['默认自行推进（按项目主线自行决策）', 'Decide on your own.'],
    ['判据来源 = PROJECT.md 与账本', "read PROJECT.md and the ledgers"],
    ['不要拿自己能定的事去问用户', 'Never carry such a question to the user as though only they could answer it'],
    ['"能自己定却去问"是消耗用户注意力（不是勤勉）', "spends the user's attention"],
    ['只在"只有用户能定"时才问', 'Ask only what genuinely belongs to the user and to no one else'],
    ['"只有用户能定"的四类（方向 / 取舍 / 范围 / 代价接受度）', 'the\nproduct direction, a choice between two acceptable paths'],
    ['判不出属于哪一类 ⇒ 就该自己定', 'If you cannot name which\nof those it is, it is yours to decide'],
    ['问的方式要克制（摆在正常回复里）', 'put the options and their\ncosts into your ordinary reply'],
    ['摆成一行人话（一条一行）', 'one per line in plain words'],
    ['不为能自己判断的事停下', 'Never stop for what you can judge yourself'],
  ]
  for (const [what, phrase] of AUTONOMY_PINS) {
    if (hoBody6.includes(phrase)) ok(`⑤g ${NAME_HO}：决策自主条文在位（${what}）`)
    else bad(`⑤g ${NAME_HO}：决策自主条文缺失（${what}）—— 期望短语 ${JSON.stringify(phrase)}`)
  }

  // 形态负向断言：批 11 条文必须**就地追加**，不得新起 `##` 小节
  const newSections = ['## Deciding', '## Autonomy', '## Asking the user', '## When to ask']
  const extra = newSections.filter((h) => hoBody6.includes(h))
  if (extra.length > 0) bad(`⑤g ${NAME_HO}：批 11 条文新起了小节标题（${extra.join(', ')}）—— 应为就地追加`)
  else ok(`⑤g ${NAME_HO}：批 11 条文未新起小节标题（就地追加在既有段落内）`)

  // ⚠ **不得与既有条文冲突**（任务书 §D1 明令：文件交接四条 / 委派门槛 / 指令自足 /
  //   攒批 / 验收只认读数 / 接住问题 / 投递禁令句 **逐字保留**）。
  //   判据：这几条的稳定短语在**批复后**必须仍然在位（它们各自的专属断言在上文各组，
  //   这里只把"决策自主追加**未把它们挤掉**"这一个事实**单独可见地复述一次**）。
  const KEPT = [
    ['文件交接（TASK.md 落点）', '.hob/archive/<YYYY-MM-DD-slug>/TASK.md'],
    ['委派门槛', 'delegate only work that MUST be done by hand'],
    ['指令自足', 'Every directive must stand on its own'],
    ['攒批', 'Batch what can ride together'],
    ['验收只认读数', 'Accept on readings only'],
    ['接住问题', 'Catch the questions'],
    ['投递禁令句（逐字保留）', 'There is still NO automatic delivery for the directive'],
  ]
  const broken = KEPT.filter(([, s]) => !hoBody6.includes(s))
  if (broken.length > 0) {
    bad(`⑤g ${NAME_HO}：批 11 追加**挤掉了既有条文**（${broken.length} 处）：${broken.map(([l]) => l).join(' / ')}`
      + ' —— 任务书 §D1 要求既有条文**逐字保留**')
  } else ok(`⑤g ${NAME_HO}：既有 7 条编排条文逐字保留（追加未挤掉任何一条）`)
}

// ── ⑥ complete / 工具面声明未变 ────────────────────────────────────────
{
  // 规划侧：complete: true + 恰好 1 行工具模块
  if (!/^\s+complete: true\s*$/m.test(hoSrc)) bad(`⑥ ${NAME_HO}：缺 complete: true`)
  else ok(`⑥ ${NAME_HO}：complete: true 在位`)
  const hoTool = (hoSrc.split("name: '" + MODULE_PATH + "'").length - 1)
  if (hoTool !== 1) bad(`⑥ ${NAME_HO}：工具模块行应恰好 1 行，实测 ${hoTool}`)
  else ok(`⑥ ${NAME_HO}：工具模块行恰好 1 行（read_contracts + write_hob）`)

  // 实施侧：行数与宿主创造模式一致（工具行零裁剪）
  const rowsOf = (s) => (s.match(/^\s+- id: /gm) ?? []).length
  const host = readFileSync(
    '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app/presets/cordis.patch.yml',
    'utf8',
  )
  const wr = rowsOf(workSrc), hr = rowsOf(host)
  if (wr !== hr) bad(`⑥ ${NAME_WORK}：声明行数应等于宿主创造模式 ${hr}，实测 ${wr}（工具被裁了？）`)
  else ok(`⑥ ${NAME_WORK}：声明行数 ${wr} == 宿主创造模式 ${hr}（工具零裁剪）`)
}

// ── 输出 ────────────────────────────────────────────────────────────────
console.log(`预设契约一致性核对 · 预设 ${NAME_HO} / ${NAME_WORK}（包名 ${HO_PKG}，本批未跟改）`)
console.log('预设（机器读版）:', HO, '+', WORK)
console.log('草案（人读版）  :', DRAFT)
console.log('')
for (const n of note) console.log('  ✓', n)
console.log('')
if (fail.length === 0) {
  console.log('判定：PASS —— 显示名、id、正文措辞、职责句、语言规则、人读/机器读一致、工具面声明 全部通过。')
  process.exit(0)
} else {
  console.log('判定：FAIL')
  for (const f of fail) console.log('  ✗', f)
  process.exit(1)
}
