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
const DRAFT = join(root, '.hob', 'drafts', 'preset-contracts.md')

// 预设的**名称与 id**唯一来源。
// ⚠ 2026-10-07 批 2 起 `config.name` 与 `config.id` **同字面值**（Hob）。
//   包名仍为 `dsh-hob`；目录名、patch 文件名、loader 行 id、工具行模块名、
//   设置分区标题**均未跟改** —— 断言里凡出现它们，指的都是包名面，不是预设 id。
const NAME_HO = 'Hob'
const NAME_WORK = 'Hob-Execute'

/**
 * ⚠ **2026-10-08 v4：`Hob-Execute` 预设已整案删除**
 *   （用户决策 D1「删掉 Hob-Execute」+ D2「执行交给任意会话」）。
 *
 * 随之**删除**的断言组（原先专门钉住该预设）：
 *   ① ② 显示名/id · ③ 内部标识 · ③b 称呼一致 · ⑤ 人读版引文块逐字一致 ·
 *   ⑤b/⑤c/⑤d/⑤e 该预设侧的条文短钉 · ⑥ 声明行数 == 宿主创造模式 34
 *
 * **为什么删而不是改**：那些断言的**对象**（那份 patch 文件）已不存在，
 *   保留任何形式都会变成"钉一个不存在的文件"的假断言。
 *   ⚠ **删断言 ≠ 放宽判据**：本脚本对 **Hob 预设**的全部断言**一条未动、一条未放宽**
 *     （见每次运行的 `ok` 计数与 `EXPERIENCE` 的"判据不放宽"纪律）。
 *
 * ⚠ **契约里"Hob 提到 Hob-Execute"的断言亦一并删除**（原 ③b 的 ≥3 次提及、
 *   ⑤b 的 `produces work for <NAME_WORK> to carry out`）—— v4 后 Hob 的契约
 *   改为"把指令写进 TASK.md 交给**任意会话**"，不再指向某个预设名。
 *   ⇒ 同属**范围收缩**（对象消失），不是判据放宽。
 */
const WORK_DELETED = true


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
// ⚠ v4：`workSrc` 已随预设删除（见文件头说明）。此处不再读取该文件。

// ── ① 显示名 + ② id ───────────────────────────────────────────────────
{
  const cases = [
    ['Hob', 'Hob', hoSrc, HO],
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
  for (const [label, src, path] of [[NAME_HO, hoSrc, HO]]) {
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
    // ⚠ v4：原先此处断言"必须用名称提到对方"（Hob ↔ Hob-Execute 互相提及）。
    //   对象预设已删 ⇒ **不再要求 Hob 提到 Hob-Execute**（Hob 改为对"任意会话"发指令）。
    //   ⇒ 这是**对象消失导致的范围收缩**，不是判据放宽。
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
  for (const [label, src, path] of [[NAME_HO, hoSrc, HO]]) {
    const body = literalBlock(src, 'prefix') ?? ''
    const stale = STALE_APPELLATIONS.filter((s) => body.includes(s))
    if (stale.length > 0) {
      bad(`③b ${label} 正文残留旧称呼：${stale.map((s) => JSON.stringify(s)).join(', ')}`)
    } else {
      ok(`③b ${label} 正文无旧称呼残留`)
    }
  }
  // ⚠ v4：原「Hob 正文提到 Hob-Execute ≥3 次」的断言已删 —— 对象预设不存在，
  //   且 v4 契约改为"交给任意会话"（不再指向预设名）。属范围收缩。
}

// ── ④ 两份正文都含语言规则 ─────────────────────────────────────────────
{
  for (const [label, src] of [[NAME_HO, hoSrc]]) {
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
  // 人读版：block0 = Hob A+B+C 段（全文）
  // ⚠ v4：原先 block1 是 Hob-Execute 正文的镜像；该预设已删 ⇒ 只校验 block0。
  const d0 = draftBlock(0)
  if (d0 === undefined) {
    bad('⑤ 人读版（.md）里没找到引文块（期望 ````text 块）')
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
  const H1 = "## 给「实施会话」的指令"
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

  if (hoBody.includes(`ONLY when the turn actually produces work for the developer session to carry out`)) {
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
  const DUTY_PINS = [
    // [标签, 正文, 稳定短语]
    [NAME_HO, hoBody2, [
      ['职责标题在位', '## Your duties'],
      ['与用户沟通 + 理解需求', 'Talk with the user and understand what they actually need'],
      ['拆分任务', 'Break that need into tasks'],
      ['编排任务', 'Arrange the tasks'],
      ['分发任务（产出给实施侧的指令）', 'Turn the work into directives for the developer session'],
      ['监督验收落实情况', 'Follow up on what was actually carried out'],
      ['不实施', 'You do not implement'],
      // ⚠ 批 14 / M3（UD-77）：原两条钉的是"**没有**投递能力"（`There is NO automatic
      //   delivery` / `never claim you sent, dispatched`）。M3 落地后**该事实反了** ——
      //   现在**能**投递。⇒ 钉点随事实换成"**投递 ≠ 执行**"这条**更强**的不变量。
      //   ⚠ 这是**替换**、不是删除：旧断言原样留着会永远 FAIL（它钉的事实已不存在）；
      //     新断言钉的比旧的多一层（不只"没投递"，而是"投了也不算做完"）。条数 10 → 11。
      ['投递不等于执行（如实声明能力）', 'Delivering is not doing'],
      ['不得把投递说成执行', 'never describe delivery as if it were execution'],
      ['真正判据来自对方会话的读数', 'The reading that settles whether the work was'],
      ['验收步骤在位', 'that is the acceptance step'],
    ]],
    // ⚠ v4：`Hob-Execute` 侧的职责句断言已随预设删除（对象不存在）。
    //   删断言 ≠ 放宽判据 —— Hob 侧 10 条**一条未动**（批 14 起 11 条）。
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
  const HANDOFF_PINS = [
    // [标签, 正文, 稳定短语]
    [NAME_HO, hoBody3, [
      ['完整指令落自己的交接区（含目录名形状）', "a dated directory whose name is the day's\ndate plus a short lowercase English slug, holding a TASK.md with the complete directive"],
      ['落文件在前（write ... first）', 'write the\nfull directive into your own hand-off area first'],
      // ⚠ 批 18（UD-81）：**原四条钉的是"文件是执行载体、消息只带指针"** —— 实测该口径
      //   **会落空**：交接区在**工作区之外**（v4「账本外置」的派生位置），执行方未必读得到
      //   （2026-10-09 真机：Hob 写的 TASK.md 落在 `.hob-ledgers/<工作区名>/archive/…`，
      //   而执行方探的是工作区内的 `.hob/archive/…`，**该目录不存在**）。
      //   ⇒ 换成"**消息必须自带可独立执行的要点、路径只作补充**"这条新不变量。
      //   **替换而非删除**：旧句已被现实推翻，留着会永远 FAIL；新句钉得更多且更准。
      ['派单消息必须自带可独立执行的要点', 'the message you deliver must stand on its own'],
      ['要点 = 做什么/在哪/不许动什么', 'what to do, where,\nand what must NOT be touched -- in the delivered text itself'],
      ['路径只是补充、不是被执行的东西', 'treat the file path as a\nsupplement rather than the thing being executed'],
      ['给路径的原因写明（工作区外、对方可能看不到）', 'the hand-off area lives with your own\nrecords, outside the workspace the other session works in, so a path alone can land nowhere'],
      ['读不到的指令不算指令', 'a directive it cannot read is not a\ndirective'],
      ['长指令：要点进消息、长文进文件', 'put the parts that must be\nacted on in the message and let the file carry the long form'],
      ['用户点名要全文时以用户为准', "asks for the full\ntext in the reply, the user's request wins"],
      ['投递不是执行、也不是完成报告', 'Sending the message is not executing the directive, and it is not a report that anything was\ndone'],
      ['围栏口径同步为"短指针（或全文）"', 'the block holds the pointer alone (or the full text when the user asked for it)'],
      ['工作区文件路径可给用户看', 'A workspace file path (such as `.hob/archive/.../TASK.md`) is NOT an internal'],
    ]],
    // ⚠ v4：`Hob-Execute` 侧的文件交接条文断言已随预设删除（对象不存在）。
    //   ⚠ **但其中两条纪律必须继续生效**，故 v4 把它们**移到 Hob 侧的契约文本里**
    //     （见 §5.2：禁弹窗改由指令文本承担；"回报落同目录 REPORT.md"写进 TASK.md 要求）。
    //     机检不再断言"某个预设里有没有这句"，因为承载者已不是预设。
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
      // ⚠ 批 14 / M3（UD-77）：原两条钉"编排改动不改变工作如何travel（仍无自动投递）"。
      //   M3 之后投递存在 ⇒ 换成本批要守的新不变量："投递不会把指令变成已完成"。
      //   替换而非删除（旧句已失实）；同时**保留**"验收只认读数"一族不受影响。
      ['投递不把指令变成执行', 'it does not turn delivery into execution'],
      ['判据来自对方会话的读数、不是自己说了算', 'comes\nback as a reading from the other session, never as your own word'],
      // ⚠ 批 16（UD-79）：用户要求"Hob 新建会话时注意工作区归属"。三条新不变量：
      //   · 新会话**必须有工作区**（没有工作区的会话用户找不到）—— 这是本批的**核心约束**；
      //   · 解析不出就**拒**，不许"照建不误"（防的是"降级成造孤儿"）；
      //   · **建会话 ≠ 委派**（与 M3 的"投递 ≠ 执行"同族，防把"建好了"说成"活干上了"）。
      ['新会话必须有工作区', 'MUST belong to a workspace'],
      ['解析不出工作区就拒绝、不得照建', 'refuse and say why -- do not create it anyway'],
      ['建会话不等于委派', 'Creating a\nsession is not delegation either'],
      // ⚠ 批 17（UD-80）：闭环编排的三条新不变量。用户要求"自动回传 + Hob 自己判断
      //   续用还是新建"。这三条分别钉住：**(a)** 回传不等于验收；
      //   **(b)** 判据是"上下文脏了/阶段变了"而不是"图省事"；**(c)** 用户的话能停下循环。
      ['回传不等于验收', 'A returned result is not acceptance'],
      ['该续用还是新建由上下文是否被污染决定', 'Start a\nnew session when continuing would drag the old context into unrelated work'],
      ['用户叫停优先于自己想继续推进', 'outranks your own judgement that more should be done'],
    ]],
    // ⚠ v4：`Hob-Execute` 侧的编排/回报条文断言已随预设删除（对象不存在）。
    //   ⚠ **但"禁弹窗"与"六段回报"两条纪律必须继续生效** ⇒ v4 改为由
    //     **Hob 写 TASK.md 时的明确要求**承担（见方案 §3.2）；承载者不再是预设，
    //     故机检不再断言"某预设里有这句"。
    //     下一步：在 Hob 契约的交接段落补写这两条要求（§9 第 6 步的失实句改正一并做）。
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
    // ⚠ v4：`Hob-Execute` 侧的形态负向断言已随预设删除。
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
  //   攒批 / 验收只认读数 / 接住问题 / **投递口径** **逐字保留**）。
  //   判据：这几条的稳定短语在**批复后**必须仍然在位（它们各自的专属断言在上文各组，
  //   这里只把"决策自主追加**未把它们挤掉**"这一个事实**单独可见地复述一次**）。
  //   ⚠ 批 14 / M3（UD-77）：末项由"投递禁令句"换成"**投递不等于执行句**"——
  //     前者钉的事实已被 UD-77 推翻（M3 就是要能投递），后者是本批新立的更强口径。
  const KEPT = [
    ['文件交接（TASK.md 落点 = 自己的交接区）', 'holding a TASK.md with the complete directive'],
    ['委派门槛', 'delegate only work that MUST be done by hand'],
    ['指令自足', 'Every directive must stand on its own'],
    ['攒批', 'Batch what can ride together'],
    ['验收只认读数', 'Accept on readings only'],
    ['接住问题', 'Catch the questions'],
    ['投递口径（投递≠执行）', 'Delivering is not doing'],
  ]
  const broken = KEPT.filter(([, s]) => !hoBody6.includes(s))
  if (broken.length > 0) {
    bad(`⑤g ${NAME_HO}：批 11 追加**挤掉了既有条文**（${broken.length} 处）：${broken.map(([l]) => l).join(' / ')}`
      + ' —— 任务书 §D1 要求既有条文**逐字保留**')
  } else ok(`⑤g ${NAME_HO}：既有 7 条编排条文逐字保留（追加未挤掉任何一条）`)
}

// ── ⑤h 批 13 · Hob 能力补足第二批：白名单 +2 名 + 声明面 6 行 + 禁项 + 文字面 ──
//
// 为什么需要：批 13（O4 / O3 / O2 / O5 取 present）给 Hob 加了四类能力，落点同样是
//   **声明面 与 白名单 的「与门」**（E-86）。⑤f 只管**批 9 那 9 名 + 批 11 那 1 名** ——
//   有人把批 13 的 2 名删掉、或把 6 行声明面全删，⑤f 与前各组**照样 PASS**。
//   本条把它钉住，并**同时**钉住"本批硬禁项一个都没混进来"。
//
// ⚠ 口径说明（防误读）：
//   · 钉的是**名字集合与声明行**（机检能判定的那一层），**不是**"工具真能跑通" ——
//     后者须隔离实例活体读数（见批 13 报告第 3 段）。
//   · **这是新增断言，不是放宽**：任何一条缺失即 FAIL；**⑤f 与 ⑥ 一条未动**。
//   · `agent-instructions` / `command-compact`（+`compaction-basic`）**不产生工具名** ——
//     它们**只**由下面的声明面断言覆盖；白名单那两条与此无关（免得后来人"补名字"）。
{
  const toolsSrc13 = (() => {
    try { return readFileSync(join(root, 'src', 'preset', 'tools.ts'), 'utf8') } catch { return undefined }
  })()
  if (toolsSrc13 === undefined) {
    bad('⑤h 读不到 src/preset/tools.ts（白名单的唯一来源）')
  } else {
    const m13 = /export const MODEL_TOOL_ALLOWLIST[^=]*=\s*\[([\s\S]*?)\n\]/.exec(toolsSrc13)
    if (m13 === null) {
      bad('⑤h 在 src/preset/tools.ts 里找不到 MODEL_TOOL_ALLOWLIST 的字面量数组')
    } else {
      const allow13 = [...m13[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
      const set13 = new Set(allow13)

      // ── 正向：批 13/14/16 的目标名**必须**在白名单里 ────────────────────
      const NEEDED13 = [
        ['O3 按需加载技能指引', 'skill'],
        ['O5 把产出挂成交付卡', 'present'],
        // ⚠ 批 14 / M3（UD-77）：投递两件也**必须**在。
        ['M3 列活会话', 'hob_sessions'],
        ['M3 投递指令', 'hob_send'],
        // ⚠ 批 16（UD-79）：建会话两件也**必须**在 —— 用户要求"Hob 新建会话须注意工作区归属"。
        ['批16 列工作区', 'hob_workspaces'],
        ['批16 建会话（强制带工作区）', 'hob_spawn'],
        // ⚠ 批 17（UD-80）：闭环编排三件也**必须**在 —— 用户要求"会话完成后自动回传、
        //   Hob 分析后继续推进、续用还是新建由 Hob 自己判断"。
        ['批17 派活并登记回传', 'hob_dispatch'],
        ['批17 看编排状态', 'hob_orch_status'],
        ['批17 停/恢复（刹车）', 'hob_orch_control'],
      ]
      const miss13 = NEEDED13.filter(([, n]) => !set13.has(n))
      if (miss13.length > 0) {
        bad(`⑤h ${NAME_HO} 白名单缺目标名（${miss13.length} 个）：${miss13.map(([g, n]) => `${n}(${g})`).join(', ')}`)
      } else ok(`⑤h ${NAME_HO}：白名单含批 13 的 2 个 + 批 14 的 2 个 + 批 16 的 2 个目标名（${NEEDED13.map(([, n]) => n).join(', ')}）`)

      // ── 正向：白名单**恰好 30**（防止悄悄多放一个而无人察觉）──────────
      // 30 = 既有 11 + 批 9 的 9 + 批 11 的 1 + 批 13 的 2 + 批 14 的 2（M3 投递）
      //      + 批 16 的 2（建会话）+ **批 17 的 3**（闭环编排）。
      if (allow13.length !== 30) {
        bad(`⑤h ${NAME_HO} 白名单应恰好 30 名，实测 ${allow13.length}`
          + `（多出：${allow13.filter((n) => !['read_contracts','write_hob','advanced_search','multi_search','platform_search','video_search','free_search_test','schedule_create','schedule_list','schedule_update','schedule_delete','taskboard_list','taskboard_get','taskboard_comments','roundtable_status','web_fetch','read','glob','grep','read_image','ask_user_question','skill','present','hob_sessions','hob_send','hob_workspaces','hob_spawn','hob_dispatch','hob_orch_status','hob_orch_control'].includes(n)).join(', ') || '无'}）`)
      } else ok(`⑤h ${NAME_HO}：白名单恰好 30 名（11 + 9 + 1 + 2 + 2 + 2 + 3）`)

      // ── 负向：**本批硬禁项一律不得**在白名单里（任务书 §0 / §3）────────────
      // ⚠ 与 ⑤f 的禁项清单**部分重叠是刻意的**：⑤f 钉的是"批 9 起就不许有的"，
      //   本条钉的是"批 13 明确点名不许有的"（含 O1/O6/O5 其余那几类的具体工具名）。
      const FORBIDDEN13 = [
        ['S5 跑命令', 'bash'],
        ['S5 跑命令', 'pwsh'],
        ['S4 写工作区文件', 'write'],
        ['S4 写工作区文件', 'edit'],
        ['S2 宿主检索（未放行）', 'web_search'],
        ['O5 其余（用户只选 present）', 'todo_write'],
        ['O5 其余（用户只选 present）', 'job_list'],
        ['O5 其余（用户只选 present）', 'job_output'],
        ['O5 其余（用户只选 present）', 'job_kill'],
        ['O1 目标类（用户裁定不做）', 'create_goal'],
        ['O1 目标类（用户裁定不做）', 'get_goal'],
        ['O1 目标类（用户裁定不做）', 'update_goal'],
        ['O6 计划模式（用户裁定不做）', 'exit_plan_mode'],
        ['S6/S8 派活与委派', 'subagent'],
        ['S6/S8 派活与委派', 'subagent_fork'],
        ['S6/S8 派活与委派', 'spawn_teammate'],
        ['S6/S8 派活与委派', 'send_message'],
        ['S6/S8 派活与委派', 'workflow'],
      ]
      const present13 = FORBIDDEN13.filter(([, n]) => set13.has(n))
      if (present13.length > 0) {
        bad(`⑤h ${NAME_HO} 白名单**含本批硬禁项**（${present13.length} 个）：${present13.map(([g, n]) => `${n}(${g})`).join(', ')}`)
      } else ok(`⑤h ${NAME_HO}：白名单不含 ${FORBIDDEN13.length} 个本批硬禁项（${FORBIDDEN13.map(([, n]) => n).join(', ')}）`)

      // ── 正向：声明面 6 行**必须**在位（判据**先剔 YAML 注释行**）────────
      // ⚠⚠ 与 ⑤f 那处**假通过**同款纪律（E-67 族）：本文件与 patch 的注释块里
      //   **逐字引用了宿主那几行**；若不剔注释，"声明行被删掉"时断言**照样 PASS**。
      const strip13 = (s) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
      const hoDecl13 = strip13(hoSrc).replace(/'([^']*)'/g, '$1')
      const DECL13 = [
        ['O4 工作区 AGENTS.md', 'agent-instructions', '@deepseek-ai/dsh-agent-instructions'],
        ['O3 skill 提供者', 'skill-filesystem', '@deepseek-ai/dsh-skill-filesystem'],
        ['O3 skill 工具', 'tool-skill', '@deepseek-ai/dsh-tool-skill'],
        ['O2 压缩服务', 'compaction-basic', '@deepseek-ai/dsh-compaction-basic'],
        ['O2 /compact 命令', 'command-compact', '@deepseek-ai/dsh-command-compact'],
        ['O5 present 工具', 'present', '@deepseek-ai/dsh-tool-present'],
      ]
      const missDecl = DECL13.filter(([, , pkg]) => !hoDecl13.includes(`name: ${pkg}`))
      if (missDecl.length > 0) {
        bad(`⑤h ${NAME_HO} 声明面缺指名增行（${missDecl.length} 行）：${missDecl.map(([g, id, pkg]) => `${id}(${g})`).join(', ')}`
          + ' —— 白名单放行了名字但作用域内没有该工具 ⇒ 执行期 `unknown tool`（判据已剔注释）')
      } else ok(`⑤h ${NAME_HO}：声明面 6 行指名增行全在位（${DECL13.map(([, id]) => id).join(', ')}；判据已剔注释）`)

      // ── 正向：本批硬禁的声明行**一律不得**出现（与白名单那条成对）────────
      const DECL_FORBID = ['@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-pwsh',
        '@deepseek-ai/dsh-tool-subagent', '@deepseek-ai/dsh-tool-workflow',
        '@deepseek-ai/dsh-tool-ralph', '@deepseek-ai/dsh-plugin-manager/tools',
        '@deepseek-ai/dsh-command-goal', '@deepseek-ai/dsh-tool-goal',
        '@deepseek-ai/dsh-plan-mode', '@deepseek-ai/dsh-tool-todo',
        '@deepseek-ai/dsh-tool-jobs']
      const declBad = DECL_FORBID.filter((p) => hoDecl13.includes(`name: ${p}`))
      if (declBad.length > 0) {
        bad(`⑤h ${NAME_HO} 声明面含本批硬禁行（${declBad.length} 个）：${declBad.join(', ')}`
          + ' —— 任务书 §0 明列为硬禁（撞 UD-13 / UD-56 / 用户裁定不做）')
      } else ok(`⑤h ${NAME_HO}：声明面无本批 ${DECL_FORBID.length} 个硬禁行`)

      // ── 正向：压缩两行**必须**带 isolate（否则预设挂不上 —— 实测硬约束）────
      // 判据取 YAML 结构事实：`compaction-basic` / `command-compact` 两块里
      //   必须各自出现 `isolate:` 与 `compaction:`，且**标签串相同**（同一 realm）。
      // ⚠ 为什么钉它：裸声明 ⇒ `Preset services require isolate realms: compaction`
      //   ⇒ 预设标 broken ⇒ 选择器里静默消失（E-21 形态）。这条把"能挂载"这一事实固化，
      //   免得后来人"简化"掉 isolate 而毫无察觉（机检是唯一会喊的地方）。
      const blk = (id) => strip13(hoSrc).split(/\n(?=\s+- id: )/).find((b) => new RegExp('- id: ' + id + '\\b').test(b)) ?? ''
      const cB = blk('compaction-basic'), cC = blk('command-compact')
      if (cB === '' || cC === '') {
        bad('⑤h ' + NAME_HO + '：找不到 compaction-basic / command-compact 声明块')
      } else {
        const realmOf = (b) => (/isolate:\s*\n\s+compaction:\s*(\S+)/.exec(b) ?? [])[1]
        const rb = realmOf(cB), rc = realmOf(cC)
        if (rb === undefined || rc === undefined) {
          bad(`⑤h ${NAME_HO}：压缩两行缺 \`isolate: compaction:\` —— 裸声明会让预设**挂不上**`
            + '（`Preset services require isolate realms: compaction` ⇒ broken ⇒ 选择器静默消失）')
        } else if (rb !== rc) {
          bad(`⑤h ${NAME_HO}：压缩两行的 isolate realm 标签**不一致**（${rb} vs ${rc}）`
            + ' —— 不同 realm ⇒ `command-compact` 读不到 `compaction`（waiting for compaction）')
        } else ok(`⑤h ${NAME_HO}：压缩两行共享 isolate realm \`${rb}\`（可挂载；裸声明会 broken）`)
      }
      // 配对负向：**不得**为此引入分组容器行（那会撞 ⑤f，且任务书禁止放宽断言）。
      if (/^\s+- id: compaction\s*$/m.test(strip13(hoSrc))) {
        bad(`⑤h ${NAME_HO}：出现了额外的 \`- id: compaction\` 容器行 —— 与 ⑤f 的零分组断言冲突（应改用共享 realm 标签）`)
      } else ok(`⑤h ${NAME_HO}：未引入 compaction 分组容器行（用共享 realm 标签，未撞 ⑤f）`)

      // ── 正向：skill 目录**必须**处于"收窄态"（UD-72② 的落点，非故障）──────
      // 判据：`skill-filesystem` 行里必须同时有 `includeDefaultRoots: false`
      //   与 `customSkillDirs: []`。理由：不这样写 ⇒ 默认根会把 ~/.dsh/skills 下
      //   **全部 5 个**技能一并给 Hob，其中 3 个撞 UD-56（见任务书 §2）。
      const skillRow = strip13(hoSrc).split(/\n(?=\s+- id: )/).find((b) => /- id: skill-filesystem\b/.test(b)) ?? ''
      if (!/includeDefaultRoots:\s*false/.test(skillRow)) {
        bad(`⑤h ${NAME_HO}：\`skill-filesystem\` 行未写 \`includeDefaultRoots: false\``
          + ' —— UD-72② 要求收窄技能发现范围（否则 ~/.dsh/skills 的 5 个技能全进 Hob，3 个撞 UD-56）')
      } else ok(`⑤h ${NAME_HO}：\`skill-filesystem\` 行已写 \`includeDefaultRoots: false\`（收窄生效）`)
      if (!/customSkillDirs:\s*\[\s*\]/.test(skillRow)) {
        bad(`⑤h ${NAME_HO}：\`skill-filesystem\` 行未写 \`customSkillDirs: []\``
          + ' —— 与本批"清单留空"的口径不符（若已挑选目录，请一并更新本断言与报告第 4 段）')
      } else ok(`⑤h ${NAME_HO}：\`skill-filesystem\` 行已写 \`customSkillDirs: []\`（收窄态：~/.dsh/skills 的 5 个全挡；插件自带的 dsh-interconnect 仍见）`)

      // ── 正向：**JSDoc 与实现一致**（批 13 文字修正①，按函数名定位）────────
      // ⚠ 判据按**函数名**而非行号（行号会因批 13 的增行而移位 —— E-91 那一族）：
      //   取 `filterModelToolList` / `enforceToolAllowlist` 各自的 JSDoc 块，
      //   里面**不得**再出现 `@param gateCtx` 与"门禁…关闭时本函数不会被调用"。
      //   这是**负向**断言：旧措辞回归 ⇒ FAIL。
      const jsdocOf = (fn) => {
        const at = toolsSrc13.indexOf(`function ${fn}(`)
        if (at < 0) return undefined
        const start = toolsSrc13.lastIndexOf('/**', at)
        return start < 0 ? undefined : toolsSrc13.slice(start, at)
      }
      const STALE = [
        ['两处 JSDoc 的旧参数名', '@param gateCtx'],
        ['两处 JSDoc 的失实说明', '门禁就绪后的子 ctx'],
      ]
      for (const fn of ['filterModelToolList', 'enforceToolAllowlist']) {
        const doc = jsdocOf(fn)
        if (doc === undefined) { bad(`⑤h 找不到函数 ${fn} 的 JSDoc（判据按函数名定位）`); continue }
        const stale = STALE.filter(([, s]) => doc.includes(s))
        if (stale.length > 0) {
          bad(`⑤h ${NAME_HO}：\`${fn}\` 的 JSDoc 仍含失实措辞（${stale.map(([l]) => l).join(' / ')}）`
            + ' —— 调用点已改为外层 ctx，且门禁关闭时该函数**照常执行**（批 13 文字修正①）')
        } else ok(`⑤h ${NAME_HO}：\`${fn}\` 的 JSDoc 已不含失实措辞（参数名与"门禁关闭"说法均已改对）`)
      }
      // 配对正向：改对后的新措辞**必须**在位（只删不写会让人无法判断参数到底是什么）。
      for (const fn of ['filterModelToolList', 'enforceToolAllowlist']) {
        const doc = jsdocOf(fn) ?? ''
        if (!doc.includes('@param ctx - ')) {
          bad(`⑤h ${NAME_HO}：\`${fn}\` 的 JSDoc 缺 \`@param ctx\`（批 13 修正后的参数名）`)
        } else ok(`⑤h ${NAME_HO}：\`${fn}\` 的 JSDoc 已改用具名 \`@param ctx\``)
      }
    }
  }
}

// ── ⑤i 2026-10-09（第 2 轮 · 用户报障驱动）· Hob「原始读数」纪律条文短钉 ────────
//
// 为什么需要：用户报障——**Hob 把工具提示（`note1` / `note2` 之类的通用说明）
//   当成了当前状态**，据此向用户提了一个**无效要求**（"请去打开那个会话"）。
//   契约据此**就地追加**了两段纪律（落点：`## Your side and the other side` 段内，
//   `## Language` 之前，**不新起小节**）：
//     ① `State nothing to the user without a reading behind it.` —— 陈述事实**或**要求用户
//        做事之前，必须有一个可执行的原始读数支撑；无读数则两者都不许。
//     ② `Tool hints are not status.` —— 工具返回的说明文字**不等于现在的状态**，转述前先核状态。
//   ⚠ 与前几组同款纪律：这是**新增断言，不是放宽**（缺失即 FAIL）。
//   ⚠ **不钉标题行** —— 任务书要求**就地追加在既有段落内**，钉标题会把
//     "就地追加"这一形态本身变成要求（与批 5/6/11 同款）。
//   ⚠ 编号：任务书未指定编号；现有最大为 ⑤h ⇒ 顺延为 **⑤i**
//     （与批 5「任务书写 ⑤b、实际落 ⑤d」同款：语义一致，区别只在编号；如实记于回报）。
{
  const hoBody7 = literalBlock(hoSrc, 'prefix') ?? ''

  const READING_PINS = [
    ['陈述前须有读数（总句）', 'State nothing to the user without a reading behind it'],
    ['读数 = 工具自己的回执 / 文件字节 / 检索输出', "a tool's own\nreturn, a session or orchestration listing, the bytes of a file you actually read, the\noutput of a search"],
    ['无读数 ⇒ 既不得陈述为事实', 'with no reading you may neither state\nit as a fact'],
    ['无读数 ⇒ 也不得转成对用户的要求', 'nor turn it into something the user must do'],
    ['"描述悄悄变成要求"仍是无支撑的要求', 'A sentence that starts as a\ndescription and quietly becomes an instruction is still an unsupported instruction'],
    ['工具提示不等于现状（总句）', 'Tool hints are not status'],
    ['提示描述的是能力本身、不是此刻为真的事', 'describes the capability in general,\nnot what is true right now'],
    ['转述前先核实际状态', 'check the actual state before you pass any of it on'],
    ['把提示当现状转述 = 假话变事实的路径', 'is how a statement that was never true reaches the user as though it\nwere one'],
  ]
  for (const [what, phrase] of READING_PINS) {
    if (hoBody7.includes(phrase)) ok(`⑤i ${NAME_HO}：原始读数纪律条文在位（${what}）`)
    else bad(`⑤i ${NAME_HO}：原始读数纪律条文缺失（${what}）—— 期望短语 ${JSON.stringify(phrase)}`)
  }

  // 形态负向断言：该纪律必须**就地追加**，不得新起 `##` 小节
  const readingSections = ['## Readings', '## Evidence', '## Tool hints', '## State before you speak']
  const extraReading = readingSections.filter((h) => hoBody7.includes(h))
  if (extraReading.length > 0) {
    bad(`⑤i ${NAME_HO}：原始读数纪律新起了小节标题（${extraReading.join(', ')}）—— 应为就地追加`)
  } else ok(`⑤i ${NAME_HO}：原始读数纪律未新起小节标题（就地追加在既有段落内）`)

  // ⚠ **不得与既有条文冲突**：本批追加**不得挤掉**既有编排条文（同 ⑤g 的 KEPT 口径）。
  //   判据：这几条的稳定短语在**追加后**必须仍然在位。
  const KEPT_READING = [
    ['文件交接（TASK.md 落点 = 自己的交接区）', 'holding a TASK.md with the complete directive'],
    ['委派门槛', 'delegate only work that MUST be done by hand'],
    ['指令自足', 'Every directive must stand on its own'],
    ['攒批', 'Batch what can ride together'],
    ['验收只认读数', 'Accept on readings only'],
    ['接住问题', 'Catch the questions'],
    ['投递口径（投递≠执行）', 'Delivering is not doing'],
    ['决策自主', 'Decide on your own.'],
  ]
  const brokenReading = KEPT_READING.filter(([, s]) => !hoBody7.includes(s))
  if (brokenReading.length > 0) {
    bad(`⑤i ${NAME_HO}：本批追加**挤掉了既有条文**（${brokenReading.length} 处）：`
      + `${brokenReading.map(([l]) => l).join(' / ')} —— 追加不得挤掉既有条文`)
  } else ok(`⑤i ${NAME_HO}：既有 8 条条文逐字保留（原始读数纪律的追加未挤掉任何一条）`)
}

// ── ⑤j 2026-10-10（第 5 轮 · 用户实测报障驱动）· `hob_spawn` 的「归属 ≠ 可见」文本 ──
//
// 为什么需要（**这是本条存在的唯一理由，别删**）：用户实测撞上过 ——
//   本插件建出的会话**在收到第一条消息之前，用户在界面里看不到它**
//   （宿主**有意**过滤空白会话），而 `hob_spawn` 的说明把
//   「有工作区归属」与「用户此刻看得见」**混成了一句因果**
//   （原文：「不属于任何工作区的会话不会出现在项目视图里，用户也找不到它」），
//   成功返回里也**没有**任何提醒 ⇒ 派活方以为建完就在项目里了，对用户说"刷新就能看到"
//   —— **而用户看不到**，白找一趟（2026-10-10 真机发生过一次）。
//
// ⚠ 为什么它以前**不可能**被任何机检抓到（读这段注释的人请记住）：
//   ① `check:presets` 的镜像断言读的是 `DRAFT`（`.hob/drafts/preset-contracts.md`）与
//      `HO`（`preset/dsh-hob/preset-dsh-hob.patch.yml`）**这两个文件**，
//      **不读 `src/modules/bus.ts` 的工具 description** ⇒ 那句自然语言**零断言覆盖**。
//   ② 那句错话**不是全错**（"必须有工作区归属"半句是对的），且**只在
//      "建完 → 投递"那段窗口里错**，窗口一过就自证清白 ⇒ 人工复查也容易放过。
//   本条把这个缺口补上 —— 这是**新增断言，不是放宽**。
//
// ⚠ **口径（为什么不去钉整句）**：文本断言天然脆。本条**不钉完整句子**，只钉**三件可判的事**：
//   ① **窗口条件在位**：说明里必须交代"空白会话 / 收到第一条消息之前"这个**条件**；
//   ② **操作规则两分支在位**：立刻投递 / 或告诉用户"看不见"（只描述不给动作，读的人照样做错）；
//   ③ **旧失实句 0 残留**（**负向断言**）—— 只靠①②的话，"新旧并存"照样 PASS。
//   ⚠ 与 ⑤f/⑤h/⑤i 同款：**不钉标题行、不钉排版**，钉的是语义要点。
{
  const busPath = join(root, 'src', 'modules', 'bus.ts')
  const busSrc14 = (() => {
    try { return readFileSync(busPath, 'utf8') } catch { return undefined }
  })()

  if (busSrc14 === undefined) {
    bad('⑤j 读不到 src/modules/bus.ts（`hob_spawn` 说明与返回字段的唯一来源）')
  } else {
    // 只截取 `hob_spawn` 那个工具定义块，避免把文档里别处的词当成证据。
    const spawnIdx = busSrc14.indexOf("name: 'hob_spawn'")
    if (spawnIdx < 0) {
      bad("⑤j 在 src/modules/bus.ts 里找不到 `name: 'hob_spawn'`（工具被改名或删了）")
    } else {
      // ⚠⚠ **必须把「说明」与「返回值」切成两块**（本组前两版都栽在这里，如实记下）：
      //   `hob_spawn` 是本文件**最后一个**工具 ⇒ "到下一个 `defineTool({`" 取不到右界。
      //   · 首版取到**文件末** ⇒ 一路吃进 `execute` 里的返回字段文案；
      //   · 第二版切在尾部 `return { sessions: … }` 之前 ⇒ **仍然**包含 `execute` 的返回体
      //     （`visibilityNote` 就在 `execute` 里，它的英文文案含 `blank session` /
      //      `host deliberately hides`）。
      //   两次的后果一样：**把说明里的窗口条件删掉，断言照样 PASS** ——
      //   它匹配到的是**返回值里的同义英文**，不是说明里的中文。负向对拍当场抓到。
      //   ⇒ 现在以 **`parameters:`** 为界：之前 = 说明（本组①②③只认这块），之后 = 参数与返回（④⑤用）。
      const rest = busSrc14.slice(spawnIdx)
      const paramIdx = rest.indexOf('parameters: {')
      const descBlock = paramIdx < 0 ? rest : rest.slice(0, paramIdx)
      const spawnBlock = rest // 供 ④⑤（返回字段 / 入参）用；它们不关心说明

      // ── ① 窗口条件在位（说明里必须交代"空白会话/首条消息之前"这个条件）────
      //   判据用**宽正则**：只要交代了"空白"/"第一条消息之前"这一层即可，
      //   不绑定我在本轮选的具体措辞（否则下次改字就得改断言，那是脆的来源）。
      const WINDOW_PINS = [
        ['说明点出"空白会话"这个概念', /空白会话/],
        ['说明点出时间窗口（收到第一条消息之前 / 未收到消息 / 开口前）', /(?:收到|发|投)[^。]{0,6}消息之前|未(?:收到|投递)消息|开口前/],
        ['说明点出"看不见/不可见"这个后果', /看不见|不可见|看不到|不出现/],
        ['说明点出这是**宿主有意**过滤（不是故障）', /宿主[^。]{0,10}(?:有意|刻意)|有意[^。]{0,6}过滤|刻意[^。]{0,6}过滤/],
      ]
      const windowMissing = WINDOW_PINS.filter(([, re]) => !re.test(descBlock))
      if (windowMissing.length > 0) {
        bad(`⑤j \`hob_spawn\` 说明缺「可见性窗口」要件（${windowMissing.length} 处）：`
          + `${windowMissing.map(([l]) => l).join(' / ')} —— `
          + '缺它就会重演"建完不投递 ⇒ 用户看不见却没人说"那次报障')
      } else ok(`⑤j \`hob_spawn\` 说明交代了可见性窗口（${WINDOW_PINS.map(([l]) => l).join(' · ')}）`)

      // ── ② 操作规则两分支在位 ──────────────────────────────────────────
      const hasDeliverBranch = /立刻投递/.test(descBlock)
      const hasTellBranch = /明确告诉用户|告诉用户[^。]{0,10}看不见/.test(descBlock)
      if (!hasDeliverBranch) {
        bad('⑤j `hob_spawn` 说明缺操作规则分支①「建完立刻投递」'
          + '—— 只描述现象不给动作，读的人仍会在错误时机对用户说错话')
      } else ok('⑤j `hob_spawn` 说明有操作规则分支①（建完立刻投递）')
      if (!hasTellBranch) {
        bad('⑤j `hob_spawn` 说明缺操作规则分支②「不投递时明确告诉用户它看不见」')
      } else ok('⑤j `hob_spawn` 说明有操作规则分支②（不投递时明确告诉用户看不见）')

      // ── ③ 旧失实句 0 残留（**负向断言**）────────────────────────────────
      //   ⚠ 为什么必须有这一条：只靠①②的话，若有人**把旧句加回来**（新旧并存），
      //     ①② 照样 PASS —— 那正是"失实句回归"。同 ⑤f 的"三处均已就地改对"口径。
      //
      //   ⚠⚠ **判据的精确边界（本组首版在这里判错过，如实记下）**：
      //     旧句是**两半**，只有**后半是假的**：
      //       · 前半「**不属于任何工作区的会话**」= **真的**（它确实挂不进项目），
      //         改后的正确文本**合法地保留了这半句** ⇒ **不得把它当失实句钉掉**。
      //         ⚠ 首版正是把它列进了 STALE 列表 ⇒ **误报自己的正确文本**为回归
      //         （跑出来"改对了却 FAIL"）。判据得**精确到假的那半句**。
      //       · 后半「**不会出现在项目视图里，用户也找不到它**」= **假的** ——
      //         它把"没有归属"说成"用户看不见"，而后者实际由**空白会话**决定。**这才是失实句。**
      //     ⇒ 判据 = ①后半字面 0 残留；**且** ②前半之后 ~40 字内**不得**紧跟可见性措辞
      //        （= 同一条假因果换个词重写）。这样既钉住真缺陷，又不钉掉那半句真话。
      const staleLiteral = '不会出现在项目视图里'
      const FALSE_CAUSAL = /不属于任何工作区的会话[^。]{0,40}?(?:看不见|看不到|不可见|不会出现|找不到)/
      const staleHits = []
      if (descBlock.includes(staleLiteral)) staleHits.push('旧句后半字面残留（"不会出现在项目视图里"）')
      if (FALSE_CAUSAL.test(descBlock)) staleHits.push('把"无归属"重新绑成"用户看不见"的因果句（换词形态）')
      if (staleHits.length > 0) {
        bad(`⑤j \`hob_spawn\` 说明**失实句回归**（${staleHits.length} 处）：`
          + `${staleHits.join('; ')} —— `
          + '「有归属」不等于「用户看得见」；可见性由宿主的空白会话过滤决定，与归属无关')
      } else ok('⑤j `hob_spawn` 说明 0 处失实句残留（假因果的字面与换词两种形态都已清除）')

      // ── ④ 成功返回新增 `visibilityNote` 字段（且**既有字段一个未动**）──
      const RETURNED = [
        ['ok', /^\s+ok: true,/m],
        ['sessionId', /^\s+sessionId: r\.sessionId,/m],
        ['workspaceId', /^\s+workspaceId: r\.workspaceId,/m],
        ['workspacePath', /r\.workspacePath === undefined \? \{\} : \{ workspacePath: r\.workspacePath \}/],
        ['agentPreset', /r\.agentPreset === undefined \? \{\} : \{ agentPreset: r\.agentPreset \}/],
        ['modelNote', /r\.modelNote === undefined \? \{\} : \{ modelNote: r\.modelNote \}/],
        ['note2', /note2: 'Created only:/],
      ]
      const brokenFields = RETURNED.filter(([, re]) => !re.test(spawnBlock))
      if (brokenFields.length > 0) {
        bad(`⑤j \`hob_spawn\` 成功返回**动了既有字段**（${brokenFields.length} 个）：`
          + `${brokenFields.map(([l]) => l).join(' / ')} —— 本批只许**新增**字段，不许改既有的名字与语义`)
      } else ok(`⑤j \`hob_spawn\` 成功返回既有 ${RETURNED.length} 个字段（ok/sessionId/workspaceId/workspacePath/agentPreset/modelNote/note2）一个未动`)

      if (!/visibilityNote:/.test(spawnBlock)) {
        bad('⑤j `hob_spawn` 成功返回缺「未投递前不可见」提示字段（visibilityNote）'
          + '—— 说明是给读文档的人，返回值才是给**此刻正在调用**的那个 agent 的，两者都要有')
      } else ok('⑤j `hob_spawn` 成功返回含可见性提示字段 `visibilityNote`')

      // ── ⑤ 入参不得变（本批明确禁止改 hob_spawn 的入参）────────────────
      const PARAMS = [['workspace', /^\s+workspace: \{$/m], ['agentPreset', /^\s+agentPreset: \{$/m]]
      const paramMissing = PARAMS.filter(([, re]) => !re.test(spawnBlock))
      if (paramMissing.length > 0) {
        bad(`⑤j \`hob_spawn\` 入参缺（${paramMissing.map(([l]) => l).join(' / ')}）—— 本批禁止改入参`)
      } else ok(`⑤j \`hob_spawn\` 入参两个（${PARAMS.map(([l]) => l).join(' / ')}）仍在`)
    }
  }
}

// ── ⑥ complete / 工具面声明未变 ────────────────────────────────────────
{
  // 规划侧：complete: true + 恰好 1 行工具模块
  if (!/^\s+complete: true\s*$/m.test(hoSrc)) bad(`⑥ ${NAME_HO}：缺 complete: true`)
  else ok(`⑥ ${NAME_HO}：complete: true 在位`)
  const hoTool = (hoSrc.split("name: '" + MODULE_PATH + "'").length - 1)
  if (hoTool !== 1) bad(`⑥ ${NAME_HO}：工具模块行应恰好 1 行，实测 ${hoTool}`)
  else ok(`⑥ ${NAME_HO}：工具模块行恰好 1 行（read_contracts + write_hob）`)

  // ⚠ v4：原先此处断言「Hob-Execute 声明行数 == 宿主创造模式 34（工具零裁剪）」。
  //   该预设已删 ⇒ 断言对象不存在，**整组删除**。
  //   ⚠ 这不影响"Hob 侧是否需要零裁剪"这个判据 —— Hob 侧的 ⑥ 断言（上面两条）
  //     一条未动：`complete: true` + 工具模块行恰好 1 行，**仍然全程生效**。
}

// ── 输出 ────────────────────────────────────────────────────────────────
console.log(`预设契约一致性核对 · 预设 ${NAME_HO}（包名 ${HO_PKG}，本批未跟改）`)
console.log('⚠ v4：Hob-Execute 预设已删除（用户决策 D1/D2），其专属断言组随之移除；')
console.log('       对 Hob 预设的全部断言**一条未动、一条未放宽**。')
console.log('预设（机器读版）:', HO)
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
