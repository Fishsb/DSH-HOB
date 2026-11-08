#!/usr/bin/env node
/**
 * 预设契约一致性核对 —— **机检**「人读版 ↔ 机器读版」不漂移。
 *
 * 为什么需要它：正文有两份载体 ——
 *   · 机器读版 = 预设 patch 的 `prefix: |-` 块（宿主真正加载的那份）
 *   · 人读版   = `kit/drafts/preset-contracts.md`（用户过目、将来改动的地方）
 * 两份手工同步必然漂移（"守卫写两遍必然漂移"的同类）。本脚本把漂移变成 FAIL。
 *
 * ── 检查项 ──────────────────────────────────────────────────────────────
 *   ① 显示名：`config.name` = `Hob`（**本插件只有一个预设**）
 *   ② id：`config.id` = `Hob`（与显示名**同字面值**）
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
 *   ⑤b **两段式格式的语义断言**（UD-51 → UD-55 → v5/UD-57 → **v7：2026-10-18 板块改名 + 四小块**）：
 *      两个二级标题在位且有序（`## 实施指令` → `## 简要说明`）、第一段（指令）必须被代码围栏包住
 *      （**恰好 4 个反引号 + 语言标记 `markdown`**，固定、无条件式）、
 *      第二段（`简要说明`）不得被包住、五条规则条文在位，
 *      且**旧分隔符一律不得残留**（负向断言 —— 只靠 ⑤ 的话，
 *      "两份一起改回旧分隔符"照样 PASS）。
 *      ⚠ v5 起**删去**「禁 emoji / 禁 ASCII 线 / 禁表格徽章」三条断言（装饰已放开）；
 *        也不再要求"无开场引言"（v5 允许第一段之前有一两句引言）。
 *      ⚠ **v7（2026-10-18 · 用户两次指出回复格式不对）**：用户是**不懂代码的产品决策者**，
 *        旧口径把路径/行号/退出码堆进给用户看的那一段 ⇒ 现改为
 *          · 板块名：`## 实施指令`（给实施会话，**技术密度照旧**）/ `## 简要说明`（给用户）；
 *          · 无活时**只出 `简要说明`**（⛔ 不硬凑空壳指令段）；
 *          · `简要说明` **固定四小块** + **禁用物清单 10 项** + **正文 ≤ 6 句** + **三问判据**；
 *          · **旧板块名 0 残留**（负向断言，见 ④e）—— 否则"两份一起改回旧名"照样 PASS。
 *   ⑤c **职责句短钉**（2026-10-07 批 3 职责重定义）：钉 `Hob` 的职责句若干
 *      稳定短语，缺失即 FAIL（⑤ 只能证明"两份一致"，两份一起删照样 PASS）。
 *   ⑤d **文件交接条文短钉**（2026-10-07 批 5 · UD-63 / CHG-011）：交接改为"指令与回报
 *      落成文件、用户只转达路径"⇒ 钉 `Hob` 侧若干稳定短语（归档落点 / 落文件在前 /
 *      派单消息必须自足 / 要点 = 做什么·在哪·不许动什么 / 路径只是补充 / 给路径的原因写明 /
 *      读不到的指令不算指令 / 长指令拆分 / 用户点名要全文时以用户为准 / 投递不是执行 /
 *      围栏口径 / 工作区文件路径可给用户看），缺失即 FAIL。
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
 *   ⑤k **2026-10-13（第 111 轮 · 用户本轮原话）· 显式职责边界块短钉**：
 *      契约正文须**有一块显式的职责边界**（`## Your duty boundary`，位置在
 *      `## Your duties` 之后、`## Your side and the other side` 之前）——
 *      正向钉**五类语义各至少一条**（①边界块自身 · ②做什么 · ③不做什么 ·
 *      ④三条不变量「投递 ≠ 执行 / 建会话 ≠ 委派 / 回传 ≠ 验收」·
 *      ⑤靠什么守住：本预设工具面 + fail-open 读法 + "无命令 ≠ 不能读文件"）；
 *      负向钉"不得起用被禁标题名"（Delegation 一族，与 ⑤e 同款）；
 *      并复述"本次追加未挤掉既有条文"（KEPT 口径，与 ⑤g/⑤i 同款）。
 *      ⚠ 判据**不写"预期 N 条"**（只判缺项，不设预期计数）。
 *   ⑤l **2026-10-14（第 138 轮 · 用户本轮原话）· 「先对照方案」条文短钉**：
 *      契约正文须**有**一段「收到任何输入 ⇒ 第一个动作固定为对照方案与账本」的运行口径 ——
 *      正向钉 **7 条稳定短语**（起句 / 输入三种形态 · 第一个动作是同一个 · 对照 `PROJECT.md` 与账本 ·
 *      边界与判据 · `Only then decide the next step.` · 方案与账本才是记录）；
 *      负向钉**两条形态**（① 不得起用被禁标题名 `## Working from the plan` / `## First step` /
 *      `## Every input`，与 ⑤e / ⑤g / ⑤k 同款；② 第 1 条短语**上方第一条非空行不得是标题**）；
 *      并复述"本次追加未挤掉既有条文"（KEPT 口径，与 ⑤g / ⑤i / ⑤k 同款）。
 *      ⚠ 判据**不写"预期 N 条"**（只判缺项，不设预期计数）。
 *
 * 用法：node scripts/check-preset-contracts.mjs
 * 退出码：0 = 全通过；1 = 有违规（逐条打印）
 * ⚠ 零第三方依赖（本仓纪律）：YAML 只做**行级**解析，不引 js-yaml。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const HO = join(root, 'preset', 'dsh-hob', 'preset-dsh-hob.patch.yml')
const DRAFT = join(root, 'kit', 'drafts', 'preset-contracts.md')
/** 权限三档表的落点（⑤m 组的唯一来源）。 */
const TOOLS_TS = join(root, 'src', 'preset', 'tools.ts')
/**
 * 宿主包的 `node_modules` 根（⑤m-6 读宿主平面 patch 用）。
 *
 * ⚠ 兜底顺序：先按本仓 `node_modules` 解析（开发/机检环境），
 *   再退到宿主全局 checkout 的 `node_modules`。
 *   ⚠ **读不到 ⇒ 报 FAIL**（"基准缺失不按通过处理"），⛔ 不静默跳过。
 */
const HOST_NODE_MODULES_CANDIDATES = [
  '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai',
  '/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai',
  join(root, 'node_modules', '@deepseek-ai'),
]
/**
 * 解析宿主包的 `@deepseek-ai` 根：**取第一个真有 `dsh-web-app` 的那一个**。
 *
 * ⚠ 为什么要"探"而不是写死一个：本仓自己的 `node_modules` 只有开发依赖
 *   （21 个包、**没有** `dsh-web-app`），宿主 checkout 才有（288 个包）。
 *   ⚠ 都探不到 ⇒ 返回首个候选，由 ⑤m-6 报 **FAIL（基准缺失不按通过处理）**。
 */
const HOST_NODE_MODULES = (() => {
  for (const c of HOST_NODE_MODULES_CANDIDATES) {
    try { if (existsSync(join(c, 'dsh-web-app', 'cordis.patch.yml'))) return c } catch { /* 继续 */ }
  }
  return HOST_NODE_MODULES_CANDIDATES[0]
})()

/**
 * 收集**宿主平面已注册的工具名**（⑤m-7 用）。
 *
 * ⚠ 口径：扫全部已装 `@deepseek-ai/dsh-*` 包的 `lib/index.js`，抽
 *   `tools.register({ name: "..." })` 与 `name: "...",\n description:` 两种形态。
 *   ⚠ 这是**只读扫描**，不 import 任何宿主代码（机检不许启动宿主）。
 *   ⚠ 扫不到任何名字 ⇒ 返回 `null`（消费方报 FAIL，不按通过处理）。
 *
 * @returns 名字集合；一个都扫不到时为 null。
 */
function collectHostToolNames() {
  const names = new Set()
  // ⚠ **合并全部存在的候选根**（不是"第一个非空就停"）：本仓 node_modules 与
  //   宿主 checkout 的包集合**不重叠**（前者只有开发依赖）⇒ 只扫一个会漏掉一半名字，
  //   而"漏掉"恰好会让互斥判据**假通过**（漏掉的那个名字撞不上）。
  for (const base of HOST_NODE_MODULES_CANDIDATES) {
    let entries = []
    try { entries = readdirSync(base, { withFileTypes: true }) } catch { continue }
    for (const ent of entries) {
      if (!ent.isDirectory() && !ent.isSymbolicLink()) continue
      const idx = join(base, ent.name, 'lib', 'index.js')
      let src = null
      try { src = readFileSync(idx, 'utf8') } catch { continue }
      for (const m of src.matchAll(/tools\.register\(\s*(?:defineTool\(\s*)?\{\s*name:\s*["']([^"']+)["']/g)) names.add(m[1])
      for (const m of src.matchAll(/\bname:\s*["']([a-z][a-z0-9_]*)["'],\s*\n\s*description:/g)) names.add(m[1])
    }
  }
  return names.size === 0 ? null : names
}

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
const skip = []
const noteSkip = (m) => skip.push(m)
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
/**
 * 人读版全文（④g 读 §二 表「说明」格用）。
 * ⚠ 与 `draftBlock()` 分开取：那个函数每次调用都重读文件且只抽引文块，
 *   这里要的是**表格正文**，抽不到 ⇒ 两者用途不同，不合并。
 * ⚠ 读不到 ⇒ 让 `readFileSync` 当场抛（本脚本对"基准缺失"一律不按通过处理）。
 */
const draftSrc = readFileSync(DRAFT, 'utf8')
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
    const has = /^#{2,3} Language$/m.test(body) && /language the user is currently using/.test(body)
    if (!has) bad(`④ ${label} 正文缺语言规则（应有 '### Language' + 'language the user is currently using'）`)
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

  /**
   * ── ⑤v **五步段的位置断言**（2026-10-29 第 12 轮 · 用户裁定 A）──────────────
   *
   * ── 为什么必须有它（⑤ 的盲区）────────────────────────────────────────────
   *   ⑤ 是**全文逐字相等**：把整段 `### The five steps` **挪到文件任何地方**，
   *   两份一起挪 ⇒ ⑤ **照样 PASS**。⇒ 位置本身**没有任何判据**。
   *   （本轮之前这条位置是我用 `grep -n` 人工核的，那不是判据。）
   *
   * ── 断言什么（两条载体各查一次）──────────────────────────────────────────
   *   在**B 段正文**里，`### The five steps` 必须同时满足：
   *     ① 出现在 `### Your duty boundary` **之后**；
   *     ② 出现在 `## Taking input` **之前**；
   *     ③ 三者都存在，且顺序严格 `duty boundary < five steps < Taking input`。
   *   ⚠ 用 `indexOf` 判"位置"而不是"行号差"：行号会随别处插入而漂，而**相对顺序**不漂。
   *   ⚠ 两份载体都查：`hoBody`（预设正文）与 `d0`（人读镜像块）。**任一不满足即 FAIL**。
   */
  {
    const FIVE = '### The five steps'
    const DUTY = '### Your duty boundary'
    const INPUT = '## Taking input'
    /** @returns 问题清单（空 = 通过） */
    const positionProblems = (label, text) => {
      const out = []
      const atFive = text.indexOf(FIVE)
      const atDuty = text.indexOf(DUTY)
      const atInput = text.indexOf(INPUT)
      if (atFive < 0) out.push(`${label}：找不到 \`${FIVE}\``)
      if (atDuty < 0) out.push(`${label}：找不到 \`${DUTY}\``)
      if (atInput < 0) out.push(`${label}：找不到 \`${INPUT}\``)
      if (out.length > 0) return out
      if (!(atDuty < atFive)) out.push(`${label}：\`${FIVE}\` **不在** \`${DUTY}\` 之后（duty=${atDuty} · five=${atFive}）`)
      if (!(atFive < atInput)) out.push(`${label}：\`${FIVE}\` **不在** \`${INPUT}\` 之前（five=${atFive} · input=${atInput}）`)
      return out
    }
    const problems = [
      ...positionProblems('预设正文（prefix 块）', hoBody),
      ...(d0 === undefined ? ['人读镜像块：不存在，无法核位置'] : positionProblems('人读镜像块', d0)),
    ]
    if (problems.length === 0) {
      ok('⑤v ✓ 五步段位置两份都对：`### Your duty boundary` < `### The five steps` < `## Taking input`')
    } else {
      for (const p of problems) bad(`⑤v · ${p}`)
    }
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
  // ⚠ v7（2026-10-18 · 用户两次指出回复格式不对）：板块**改名**。
  //   旧：`## 给「实施会话」的指令` / `## 白话说明`
  //   新：`## 实施指令`（给实施会话，技术密度照旧）/ `## 简要说明`（给不懂代码的用户，四小块）
  //   ⚠ 判据未放宽：仍要求**两个标题在位且有序**，只是字面值随用户裁定换新。
  const H1 = "## 实施指令"
  const H2 = '## 简要说明'
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

    // ③ 该围栏必须闭合，且闭合发生在「简要说明」标题**之前**
    //    （否则等于把用户段也包进去了）
    const openLen = FENCE.exec(fenceTrim)?.[1].length ?? 0
    const bodyLines = afterH1.split('\n')
    let closeIdx = -1
    for (let i = 1; i < bodyLines.length; i++) {
      if (bodyLines[i].trim() === '`'.repeat(openLen)) { closeIdx = i; break }
    }
    const h2Line = bodyLines.findIndex((l) => l.trim() === H2)
    if (closeIdx < 0) bad(`⑤b ${NAME_HO}：指令段的围栏未闭合（找不到同长度 ${openLen} 反引号的闭合行）`)
    else if (h2Line >= 0 && closeIdx > h2Line) bad(`⑤b ${NAME_HO}：围栏跨过了「简要说明」标题 ⇒ 用户段被包进代码块`)
    else ok(`⑤b ${NAME_HO}：指令段围栏成对闭合，且未跨过「简要说明」标题（用户段未被包住）`)

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
  //    ⚠ v7 口径（2026-10-18 · 用户两次指出格式不对）：板块改名 ⇒ 两条条文的正则
  //      **钉的目标换了字面值**（`part two` → `简要说明`、`two headings` → `two section headings`）。
  //      ⛔ 这不是放宽：仍然要求"该条文在位"，且另有**负向断言**钉住旧字面值不得回归（见 ④e）。
  for (const [label, needle] of [
    ['禁止包用户段', /Never fence (?:part two|简要说明)/],
    ['禁止包整篇', /never wrap the whole reply in one code block/],
    ['标题为结构、不随语种变', /The two (?:headings|section headings) are structural/],
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
  //    ⚠ v7（2026-10-18）：原口径是"默认正常 Markdown 回话、只在有活时切两段"。
  //      用户两次指出**回复格式本身就不对** ⇒ 用户可见的那一段**始终在**，改为
  //      「**没有要派的活时只出 简要说明**」。本条钉这个新落点（**未放宽**：缺即 FAIL）。
  if (/uses 简要说明 only/.test(hoBody)) ok(`⑤b ${NAME_HO}：含「无活时只出 简要说明」条文`)
  else bad(`⑤b ${NAME_HO}：缺「无活时只出 简要说明」条文（v7 按需触发的落点）`)

  //    ⚠ 用 `i` 旗标：这两句在正文里是**句首**（`Do not invent ...`），大小写不构成语义差别。
  if (/do not invent a task to fill the shape/i.test(hoBody) && /do not emit a placeholder/i.test(hoBody)) {
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

  // ④e **v7 新增：旧板块名的负向断言**（2026-10-18 · 用户两次指出格式不对）
  //     ⚠ 只靠 ⑤（两份一致）抓不到"两份一起改回旧名"；只靠 ④（条文在位）也抓不到 ——
  //       旧名一旦回归，两个标题断言会 PASS 在新名上，而旧字面值**仍然在正文别处出现**
  //       （例如「语言」段复述标题那一行）。⇒ 单独钉住旧字面值 **0 残留**。
  //     ⚠ 例外：本段的**规则叙述**需要提到"这两个标题"时用的就是新名，故无白名单。
  for (const [label, needle] of [
    ['旧板块名「给「实施会话」的指令」', /给「实施会话」的指令/],
    ['旧板块名「白话说明」', /白话说明/],
  ]) {
    if (needle.test(hoBody)) bad(`⑤b ${NAME_HO}：正文仍残留${label}（v7 已改名，⛔ 不许两份一起改回去）`)
    else ok(`⑤b ${NAME_HO}：${label} 为 0 残留`)
  }

  // ④f **v7 新增：`简要说明` 的四小块 + 禁用物清单 + 长度/判据 必须写进契约**
  //     ⚠ 为什么单列：这些是用户**这一轮的原话要求**，而 ④ 一族只管 ## Rules。
  //       "四小块在不在"、"禁用物清单在不在"没有任何既有断言覆盖（两份一起删照样 PASS）。
  for (const [label, needle] of [
    // ── **2026-11-07 · 四块 → 三套块集**（用户裁定：四块不够用，块名与内容不匹配）──
    //   ⚠ 旧断言钉的是"四块标题在位"。现在改成"**块集选择规则在位 + 八个块各有定义**"，
    //     因为固定四块会让"什么都没改"的轮次被迫写「这轮做了什么」、
    //     让"不需要用户决定"的轮次留一块空的「要你决定的」。
    ['块集选择：不是一套固定模板', /The brief is not one fixed template/],
    ['块集选择：选错块集与写错字一样严重', /Picking the wrong set is as wrong as writing the wrong words/],
    ['块集 report 在位', /`report` \(nothing dispatched, reporting\): 这轮结论 \/ 项目位置 \/ 还没验证 \/ 要你决定的/],
    ['块集 decide 在位', /`decide` \(blocked, user must choose\): 这轮结论 \/ 卡在哪 \/ 要你决定的 \/ 还没验证/],
    ['块集 talk 在位', /`talk` \(nothing changed, only answered or discussed\): 结论 \/ 分歧或未知 \/ 下一步/],
    ['⛔ 不许混用块集', /Never mix sets/],
    ['⛔ 不许加该块集没有的块', /never add a block the set lacks/],
    ['⛔ 不许删该块集有的块（空块按该块规则写）', /never drop one it has/],
    ['块定义：这轮结论', /### 这轮结论/],
    ['块定义：项目位置', /### 项目位置/],
    ['块定义：还没验证', /### 还没验证/],
    ['块定义：要你决定的', /### 要你决定的/],
    ['块定义：卡在哪', /### 卡在哪/],
    ['块定义：结论', /### 结论/],
    ['块定义：分歧或未知', /### 分歧或未知/],
    ['块定义：下一步', /### 下一步/],
    ['禁用物清单（硬约束）', /Banned from every block:/],
    ['禁用物：文件路径', /file paths/],
    ['禁用物：行号', /line numbers/],
    ['禁用物：提交号 / 哈希', /commit hashes/],
    ['禁用物：字节数', /byte counts/],
    ['禁用物：命令名', /command names/],
    ['禁用物：检查名 / 断言之名', /check or assertion names/],
    ['禁用物：退出码', /exit codes/],
    ['禁用物：模块编号', /module numbers \(M1, C1\)/],
    ['禁用物：英文标识符', /English identifiers/],
    ['禁用物：代码块', /and code blocks/],
    ['长度：正文不超过 6 句', /at most six sentences/],
    ['唯一判据：用户读完能答三问', /after reading it the user can answer three questions/],
    ['三问：发生了什么 / 是好是坏 / 要不要做什么', /what happened, whether the project is better or worse, and whether they must do anything/],
    ['答不出 ⇒ 作废重写', /the brief is void and gets rewritten/],
    ['细节留在账本与报告件里', /Keep readings, numbers and paths in the ledger and report files/],
    ['未验证 / 风险 必须照实说、不许省', /never dropped because it is awkward to put simply/],
    ['要你决定的必须留', /A decision that belongs to the user is never taken for them/],
    ['实施指令不许碰什么必须留', /what must NOT be touched/],
    ['实施指令技术密度照旧、不许稀释', /never thin it out to make it easier to read/],
    ['没有要派的活时只出 简要说明（⛔ 不硬凑空壳指令段）', /do not add an empty 实施指令 shell/],
    // ── **2026-11-07 · 四块写法与指令排版的实质约束**（外部参考：BLUF / 倒金字塔 /
    //    problem statement / acceptance testing / runbook，结论见 `spec/reply.md`）──
    //   ⚠ 光有四个标题不够：标题底下写成"动作清单 + 百分比 + 应该没问题"同样不合格。
    //     这组断言钉的是**每块必须写成什么**，不是"标题在不在"。
    ['这轮结论：一句、回答成没成', /One sentence answering "did it work": worked \/ did not work \/ stopped at X/],
    ['这轮结论：单句即可独立行动', /a reader must be able to act on it alone/],
    ['项目位置：写差距', /The GAP in one or two sentences/],
    ['项目位置：⛔ 不写百分比（并说明为什么）', /Never a percentage, never a progress report/],
    ['要你决定的：每行必须带选项 / 代价 / 默认', /the choice, its cost, and the default you take if the user says nothing/],
    ['要你决定的：用户一个字就能回', /answerable with one word/],
    ['还没验证：点名哪条结论未证明', /Name the claim that is not yet proven and what would prove it/],
    ['还没验证：⛔ 不许「应该没问题」', /Never "should be fine"/],
    ['块内排版：⛔ 表格 / 嵌套列表 / 句中加粗 / 分隔线', /No tables, no nested bullets, no mid-sentence bold, no rules between blocks/],
    ['篇幅：六句是上限不是目标', /Six is a ceiling, not a target/],
    ['实施指令四段：要什么 / 怎么算做完 / 不许动什么 / 开工前要知道的', /要什么[\s\S]{0,400}怎么算做完[\s\S]{0,400}不许动什么[\s\S]{0,400}开工前要知道的/],
    ['实施指令：判据须第三方不问也能核', /phrased so a third party can check it without asking you/],
    ['实施指令：边界必须给理由（无理由会被忽略）', /A boundary with no reason gets ignored/],
    ['实施指令：无内容则整节省略（空标题有害）', /Omit this section entirely when there is nothing; an empty section teaches the reader that headings do not matter/],
    ['实施指令：指针在前、细节在后', /Put the pointer before the detail, so the whole directive is scannable top-down/],
    // ── **v9（2026-10-18 第 2 轮 · `UD-137` 裁定 1 取 B）**「写发合一」条文 ──────
    //   ⚠ 这四条钉的是**用户本轮的原话**：写指令与发出去必须是**同一个动作**，
    //     且每条派发**同轮**给出读数（口径 = 目标 + **登记时刻**，⛔ 不是"轮次"）。
    //   ⚠ **为什么"登记时刻"而不是"轮次"**：`write_hob` 的 `dispatchTo` 那条路
    //     **拿不到轮次**（工具参数面里没有 `round`）⇒ 原口径在那条路上**恒假**；
    //     恒假的判据会把真漏派一起埋掉。改成真拿得到的量，才是钉住事实。
    ['写指令与投递是**同一个动作**（⛔ 不许拆两步）', /Work is handed over in ONE action, never in two/],
    ['`实施指令` 只能由那一步产生', /only as the by-product\s+of the single call that writes the directive into your ledger/],
    ['⛔ 禁止：先写回复再投 / 落盘后不投', /Never compose the directive in the reply[\s\S]{0,220}?never write the file and stop there[\s\S]{0,80}?dispatch later/],
    ['判据：同轮给出读数 = 目标 + 登记时刻，给不出视同未派', /the target session, and the moment its\s+delivery was registered[\s\S]{0,320}?read it as not sent/],
    ['为什么这条挡得住（没调用 ⇒ 无内容可写）', /there is no directive to point at, and the reply is\s+简要说明 only/],
  ]) {
    if (needle.test(hoBody)) ok(`⑤b ${NAME_HO}：v7/v9 条文在位（${label}）`)
    else bad(`⑤b ${NAME_HO}：v7/v9 条文缺失（${label}）—— 期望 /${needle.source}/`)
  }

  // ④h **v10 新增：格式归属 —— 两段式的触发条件 + 三个反例 + 两个板块名的归属**
  //     （2026-10-18 · 用户两轮更正后落定的口径；实施侧回报串用板块名已实测发生）
  //
  //     ⚠ **为什么必须单独钉**（缺了它，这一格零断言覆盖）：
  //       · ⑤ 只证明"两份载体一致"——两份**一起**删掉归属句，⑤ 照样 PASS；
  //       · ④b 只钉"无活时只出 简要说明"，**不钉"有活时到底谁出两段"**，
  //         更不钉"指令块在纯讨论轮次里不许出现"这个反例；
  //       · ④f 的「实施指令技术密度照旧」只钉**密度**，不钉**归属**。
  //       ⇒ 归属这一条全新，⛔ 与既有断言无重叠，故独立成 ④h（仍在本脚本同一族内，
  //         ⛔ 未新增任何 `check:` 命令名 —— 用户硬项）。
  //
  //     ⚠ **口径来源（用户原话两句合起来才是完整意思）**：
  //       ①「你要是沟通就不要给实施指令，你要给指令就派出去实施会话做任务」
  //       ②「推进项目的给实施会话的轮次就正常按指令+说明的结构输出，但讨论决策轮次
  //          带个指令代码块是干嘛的、给谁看的」
  //       ⇒ 判据一句话：**这一轮有没有真的把活派给实施会话？** 有 ⇒ 两段；没有 ⇒ 只有说明。
  //       ⚠ ⚠ **不是**"实施指令永不出现"——那样会把真正派活那一轮的正确形态一起判死。
  {
    // (a) 触发条件句：必须是"问本轮是否真派了活"，而不是"产生活的意图"
    const TRIGGER = /The test is one question: was the work actually dispatched to the developer session this turn\?/
    if (TRIGGER.test(hoBody)) ok(`⑤b ${NAME_HO}：v10 格式归属 —— 两段式触发条件 = 本轮是否**真的派出**（④h-a）`)
    else bad(`⑤b ${NAME_HO}：v10 缺「本轮是否真的派出」这一触发条件句（④h-a）—— 期望 /${TRIGGER.source}/`)

    // (b) 三档落点必须成对写明：有派 ⇒ 两段；没派 ⇒ 只说明 + ⛔ 无指令块
    for (const [label, needle] of [
      ['有派活 ⇒ 两段式照旧、技术密度不稀释', /If yes, the two-part form stands and the directive keeps its full technical density/],
      ['没派活 ⇒ 只有 简要说明、⛔ 不出现指令块', /the reply is 简要说明 only, and no directive block appears at all/],
      ['为什么（指令块没有读者）', /that block would have no reader, and the user does not need it/],
    ]) {
      if (needle.test(hoBody)) ok(`⑤b ${NAME_HO}：v10 归属条文在位（${label}，④h-b）`)
      else bad(`⑤b ${NAME_HO}：v10 归属条文缺失（${label}，④h-b）—— 期望 /${needle.source}/`)
    }

    // (c) **三个反例**必须逐条在位（用户点名"我犯过的"）——
    //     ⚠ 只写正向触发条件不够：不写明反例，契约读起来仍像"随便都能出两段"。
    for (const [label, needle] of [
      ['反例①：只写指令却没真派', /Writing a directive in the reply while never actually dispatching the work/],
      ['反例②：真派了又贴一份给用户看', /Dispatching the work and then also pasting a copy of the directive into the reply/],
      ['反例③：讨论/决策轮次挂指令块（没有读者）', /Attaching a directive block to a discussion or decision turn, where it has no reader at all/],
    ]) {
      if (needle.test(hoBody)) ok(`⑤b ${NAME_HO}：v10 反例在位（${label}，④h-c）`)
      else bad(`⑤b ${NAME_HO}：v10 反例缺失（${label}，④h-c）—— 期望 /${needle.source}/`)
    }

    // (d) **格式归属**：两个板块名只属于 Hob 对用户的回复；实施侧回报 ⛔ 不许用这两个标题，
    //     它用回报六段 —— 且**必须写明为什么**（两套格式服务两个读者，混用会让实施侧"替 Hob 派活"）。
    for (const [label, needle] of [
      ['两个板块名只属于对用户的回复，不属于别的任何东西', /belong to your reply to the user, and to nothing else/],
      ['实施侧回报 ⛔ 不用这两个标题', /A report coming back from the developer session never uses either heading/],
      ['实施侧用回报六段（含六段点名）', /结论先行 \/ 前置读数 \/ 做了什么 \/ 未做到·未验证·与指令不符 \/ 待决问题 \/ 建议/],
      ['为什么：两套格式服务两个读者', /the two shapes serve two different readers/],
      ['混用的后果：实施侧替 Hob 派活（已实测）', /starts handing out the next round of work on your behalf/],
      ['混用已实测发生（不是假想）', /which has already happened in practice/],
    ]) {
      if (needle.test(hoBody)) ok(`⑤b ${NAME_HO}：v10 格式归属条文在位（${label}，④h-d）`)
      else bad(`⑤b ${NAME_HO}：v10 格式归属条文缺失（${label}，④h-d）—— 期望 /${needle.source}/`)
    }
  }

  // ④i **2026-10-25 新增：`UD-152` 契约条文的**存在性**断言**（⛔ 不是"两份一致"）──
  //
  // ── 为什么必须单独一条（本单 §一-1(a) 点名的那处同型漏洞）────────────────
  //   ⑤ 的判据是"人读版引文块 == 预设正文（全文逐字）"。⚠ 它有一个**结构性盲区**：
  //   **两份一起删掉同一条，它照样 PASS** —— 因为"相等"这个关系在"两边都没有"时也成立。
  //   ⚠ 实测（本单 REPORT §1 有原文）：把 `这轮做了什么` 那一条从两份里**同时**删掉，
  //     `hoBody.trimEnd() === d0.trimEnd()` 仍然为 `true` ⇒ ⑤ 绿。
  //   ⇒ `UD-152` 落进正文的那三条硬规矩（不再问已表态的 / 当轮落账 / 待决写"已认领"）
  //     **此前零存在性断言**：两份一起删，全族全绿。
  //
  // ── 本条与 ⑤ 的分工（⚠ 两条都要，⛔ 不许拿一条替另一条）──────────────
  //   · ⑤ ：**两份一致**（防"改一边漏一边"）
  //   · ④i：**内容必须在**（防"两份一起删"）
  //   ⇒ 这就是本单要补的"存在性"那一半。
  //
  // ── 判据口径（⚠ 三项，逐条点名缺哪个；⛔ 不退化成"出现一个词就算过"）────
  //   每项用一条**足够具体的原文片段**（不是关键词），缺则该条 FAIL 并印出期望的原文片段。
  //   ⚠ 片段取自正文现状（`preset/dsh-hob/preset-dsh-hob.patch.yml`），**逐字**；
  //     若将来正文有意改写这三条，**必须同批改这里的片段**（否则会出现"改对了反而红"）——
  //     ⚠ 这个代价写在这里，⛔ 不藏。
  {
    /**
     * `UD-152` 的三条硬规矩（⚠ 片段逐字取自正文，语义 = 用户原话的三层修法）。
     * ⚠ 每一项都带 `why`（缺了它意味着什么），FAIL 行里会一并印出来 ——
     *   "只说缺哪条"不够，还得让人知道**缺这条会退回到哪种病**。
     *
     * ⚠⚠ **匹配方式：先做空白归一化，再做 `includes`**（2026-10-25 本单实测踩到）：
     *   正文是 YAML `|-` 块，**长句会被折行**（同一句话跨两行、缩进 18 空格）。
     *   ⇒ 若把片段写成**跨行原文**（含 `\n` 与缩进），它对"折行位置"极其敏感：
     *     正文只是重新折行（语义一字未变）就会让本断言**假红** —— 那是"判据口径不对"，不是缺陷。
     *   ⇒ 归一化 = 把连续空白（含换行）压成单个空格、两侧 trim。
     *   ⚠ 这**不放宽**判据：比对仍是**逐字**的（只是不把"换行/缩进"当字面值的一部分）——
     *     改一个字（哪怕只是词序）仍然会红。
     */
    const normWs = (s) => s.replace(/\s+/g, ' ').trim()
    const hoBodyNorm = normWs(hoBody)
    const UD152_RULES = [
      {
        label: '不再问用户已表态的事（"已定"就是已定）',
        needle: 'Never ask again about something the user has already settled',
        why: '缺它 ⇒ 用户已经拍过的事会被反复端回去问（`UD-152` 的原始病）',
      },
      {
        label: '已定项必须当轮落账，写成 已定 / 已认领',
        needle: 'Write a settled item into the ledger IN THE SAME TURN it is settled',
        why: '缺它 ⇒ 用户这一轮说的话下一轮就蒸发（`UD-152` 的根因：当轮不落账）',
      },
      {
        label: '待决项必须写"已认领"、⛔ 不许留在待用户拍板里',
        needle: 'user has claimed is written 已认领 and is NOT left among the items awaiting the user',
        why: '缺它 ⇒ 用户认领过的事仍以"待你决定"出现（`UD-152` 修法 ② 的落点）',
      },
    ]
    const missingRules = []
    for (const r of UD152_RULES) {
      if (hoBodyNorm.includes(normWs(r.needle))) {
        ok(`⑤b ${NAME_HO}：\`UD-152\` 契约条文在位（${r.label}，④i）`)
      } else {
        missingRules.push(r)
      }
    }
    if (missingRules.length > 0) {
      /**
       * ⚠ **一行点名 + 逐条 why**：作业书 §一-1 要求"输出点名缺的是哪一条"。
       *   把三条**全部**报出来（⛔ 不 first-fail 就 return）—— 否则补一条再跑一次才发现还缺一条。
       */
      bad(`④i ${NAME_HO}：**\`UD-152\` 契约条文缺失 ${missingRules.length}/${UD152_RULES.length} 条**`
        + `（⚠ 这是"两份一起删"能逃过 ⑤ 的那一类：⑤ 只判两边一致，⛔ 判不出两边都没有）`
        + '\n      ⇒ 缺的是：'
        + missingRules.map((r) => `\n        · ${r.label}\n          ⚠ ${r.why}\n          期望片段：${JSON.stringify(r.needle)}`).join('')
        + '\n      ⇒ 修法：把这几条**逐字**补回 `preset/dsh-hob/preset-dsh-hob.patch.yml` 的 `prefix` 正文，'
        + '并同步人读版引文块（`⑤` 会核两边一致）')
    } else {
      ok(`⑤b ${NAME_HO}：\`UD-152\` 契约条文 **${UD152_RULES.length}/${UD152_RULES.length} 条全在**`
        + '（⚠ 存在性断言 —— 与 `⑤`（两份一致）分工不同：'
        + '`⑤` 防"改一边漏一边"，本条防"**两份一起删**"）')
    }
  }

  // ④j **2026-10-25 新增：问答轮那几段的**存在性**断言**（⛔ 不是"两份一致"）──
  //
  // ── 为什么必须单独一条（`archive/2026-10-25-reply-mode-3/NOTE.md` §二-Q2 点名的盲区）──
  //   问答轮那 4 段（UD-158 落的）**此前只有 `⑤` 覆盖**，而 `⑤` 只判"人读版引文块 == 预设正文"。
  //   ⚠ `⑤` 的结构性盲区：**两份一起删掉同一段，`trimEnd()` 仍然相等 ⇒ ⑤ 照样 PASS。**
  //   ⇒ 问答轮是"用户点名的第三种回复形态"，两份一起被删掉时**全族全绿、无人报错**。
  //
  // ── 本条与 ⑤ 的分工（⚠ 两条并存，⛔ 不许拿一条替另一条）──────────────
  //   · `⑤` ：**两份一致**（防"改一边漏一边"）
  //   · `④j`：**这几段必须在**（防"两份一起删"）
  //   ⚠ **⛔ 本单不许动 `⑤`**（作业书 §一-2 明令）；本条是**新增**，与 `⑤` 并存。
  //
  // ── 判据口径（⛔ 不退化成"出现一个词就算过"）──────────────────────────
  //   每条用一段**足够具体的原文**（整句 / 整分句，⛔ 不是关键词）。缺则 FAIL 并印出期望片段。
  //   ⚠ 匹配前做**空白归一化**（YAML `|-` 块会把长句折行；折行位置不是语义）。
  //     ⇒ 归一化只压空白，**仍是逐字比对**：改一个字（哪怕词序）照样红。
  //   ⚠ 片段取自正文现状，**逐字**；若将来有意改写这几段，**必须同批改这里的片段**
  //     （否则会出现"改对了反而红"）—— 这个代价写在这里，⛔ 不藏。
  {
    const normWs2 = (s) => s.replace(/\s+/g, ' ').trim()
    const hoBodyNorm2 = normWs2(hoBody)
    const QT_REQUIRED = [
      {
        label: '第三种形态的定义（问答轮 = 用户提问且本轮不派活）',
        needle: 'The question turn is the third form. It is used when the user asks a question and the turn dispatches nothing.',
        why: '缺它 ⇒ "问答轮"这个形态在载体里没有定义，只剩两条别处的零散提示',
      },
      {
        label: '判别法：用户问句 ⇒ 第一句必须是答案',
        needle: '**The test, verbatim: a user question -> the first sentence must be the answer.**',
        why: '缺它 ⇒ 问答轮没有可判的入口条件（UD-158 的核心判别法）',
      },
      {
        label: '反例：开头若是"这轮做了什么 / 你说得对 / 我先说明"就不是问答轮',
        needle: 'If the opening is "this round did" / "you are right" / "let me explain first", it is not a question turn.',
        why: '缺它 ⇒ 用户点名的三种坏开头没有落进载体，问答轮会被套成说明轮',
      },
      {
        label: '问答轮里这四块 ⛔ 不出现（逐块点名）',
        needle: 'In a question turn these never appear: the four blocks (这轮做了什么 / 现在什么状态 / 要你决定的 / 还没验证)',
        why: '缺它 ⇒ 问答轮会被套上四块（正是用户说"这不是问答轮"的那种回法）',
      },
      {
        label: '⛔ 自我复盘只进账本，不进回复',
        needle: 'self-review, self-criticism, or your own behaviour as the subject -- that belongs in the ledger, not in the reply',
        why: '缺它 ⇒ 回复会变成会话复盘（全局指令里已实证过的那个病）',
      },
      {
        label: '⛔ 不许用新派活回避问题',
        needle: 'a fresh piece of dispatched work used to dodge the question',
        why: '缺它 ⇒ 被问住时可以用"派一件新活"绕开问题',
      },
      {
        label: '"这条没验过"只在答案本身没验过时加',
        needle: 'Append "这条没验过" only when the answer itself has not been verified.',
        why: '缺它 ⇒ 这句限定语会退化成口头禅，或干脆消失',
      },
    ]
    const missingQt = []
    for (const r of QT_REQUIRED) {
      if (hoBodyNorm2.includes(normWs2(r.needle))) {
        ok(`⑤b ${NAME_HO}：问答轮段落在位（${r.label}，④j）`)
      } else {
        missingQt.push(r)
      }
    }
    if (missingQt.length > 0) {
      /**
       * ⚠ 三条**全部**报出来（⛔ 不 first-fail 就 return）—— 否则补一条再跑一次才发现还缺一条。
       */
      bad(`④j ${NAME_HO}：**问答轮段落缺失 ${missingQt.length}/${QT_REQUIRED.length} 段**`
        + '（⚠ 这是"两份一起删"能逃过 ⑤ 的那一类：⑤ 只判两边一致，⛔ 判不出两边都没有）'
        + '\n      ⇒ 缺的是：'
        + missingQt.map((r) => `\n        · ${r.label}\n          ⚠ ${r.why}\n          期望片段：${JSON.stringify(r.needle)}`).join('')
        + '\n      ⇒ 修法：把这几段**逐字**补回 `preset/dsh-hob/preset-dsh-hob.patch.yml` 的 `prefix` 正文，'
        + '并同步人读版引文块（`⑤` 会核两边一致）')
    } else {
      ok(`⑤b ${NAME_HO}：问答轮段落 **${QT_REQUIRED.length}/${QT_REQUIRED.length} 段全在**`
        + '（⚠ 存在性断言 —— 与 `⑤`（两份一致）分工不同：'
        + '`⑤` 防"改一边漏一边"，本条防"**两份一起删**"）')
    }
  }

  // ④g **v8 新增：预设 `description` 与人读版「§二 说明」格逐字相等 + 不含旧板块名**
  //     （2026-10-18 · 用户核过上批后指定的收口项）
  //
  //     ⚠ **为什么必须单独钉**（缺了它，这一格是"零断言覆盖"的死角）：
  //       · ⑤ 只比 `prefix` 引文块 ↔ 人读版 §1.2，**`config.description` 不在它里面**；
  //       · ④e 只扫 `prefix` 正文，**同样扫不到 `description`**；
  //       ⇒ 两份载体**一起**把 `description` 改回旧板块名，或**只改一边**，上批所有断言照样 PASS。
  //         而这一格正是**用户在选择器里唯一看得见的那句话** ⇒ 它走样最不容易被发现。
  //     ⚠ 判据两条，缺一即 FAIL：
  //       ① **逐字相等**：patch 的 `description` == 人读版 §二 表「说明」那一格
  //          （两侧都取**原样字面值**，不 trim 掉中间内容，只在比较前去掉表格/引号的外壳）；
  //       ② **负向**：该句**不得含**旧板块名 `给「实施会话」的指令` / `白话说明`。
  //     ⚠ **未放宽**：这是**新增**断言；且它钉的是"两份一致 + 不含旧名"，
  //       比"只钉正文"多一层 —— 旧字面值出现在**任何一处**都得 FAIL。
  {
    const descPatch = scalar(hoSrc, 'description')
    // 人读版 §二 表：`| **说明** | <值> |`（唯一一行；`值` 里不含未转义的 `|`）
    const descRow = /^\|\s*\*\*说明\*\*\s*\|\s*(.+?)\s*\|\s*$/m.exec(draftSrc)
    const descDraft = descRow === null ? undefined : descRow[1].trim()

    if (descPatch === undefined) {
      bad(`④g ${NAME_HO}：预设 patch 里读不到 \`config.description\`（8 空格缩进那个标量）`)
    } else if (descDraft === undefined) {
      bad(`④g ${NAME_HO}：人读版 §二 表里读不到「说明」那一格（期望 \`| **说明** | … |\`）`)
    } else if (descPatch !== descDraft) {
      bad(`④g ${NAME_HO}：\`description\` 与人读版「说明」格**不一致**（应逐字相同）`)
      bad(`     预设: ${JSON.stringify(descPatch)}`)
      bad(`     人读: ${JSON.stringify(descDraft)}`)
    } else ok(`④g ${NAME_HO}：\`description\` == 人读版「说明」格（逐字相同）`)

    // ② 负向：两句都不得含旧板块名（`description` 是**用户可见**的那一句，最不该走样）
    for (const [label, text] of [['description', descPatch], ['人读版「说明」格', descDraft]]) {
      if (text === undefined) continue
      const stale = ['给「实施会话」的指令', '白话说明'].filter((n) => text.includes(n))
      if (stale.length > 0) {
        bad(`④g ${NAME_HO}：${label} 仍含旧板块名 ${stale.map((x) => JSON.stringify(x)).join(', ')}`
          + '（v7 已改名 ⇒ 用户在选择器里读到的说明与正文对不上）')
      } else ok(`④g ${NAME_HO}：${label} 不含旧板块名`)
    }

    // ③ 单行标量的**形态**断言（用户认下的 `>-` 折叠理由：中文之间会被折出空格）
    {
      const line = hoSrc.split('\n').find((l) => /^\s{8}description:/.test(l)) ?? ''
      if (!/^\s{8}description:\s*"/.test(line)) {
        bad(`④g ${NAME_HO}：\`description\` 不是双引号单行标量（⛔ 用 \`>-\` 折叠会在中文间折出空格）—— 实测 ${JSON.stringify(line.slice(0, 40))}`)
      } else ok(`④g ${NAME_HO}：\`description\` 是双引号单行标量（⛔ 不是 \`>-\` 折叠）`)
    }
  }

  // ④d **v6 新增：「触发时结构不变」的四项仍在**（UD-58 明示：只取消强制，不改结构）
  //     四项 = ① 标题在围栏外 ② 只包第一段 ③ 固定 4 反引号 ④ 围栏不跨白话标题。
  //     ⚠ 这四项**上文各自已有独立断言**（②③③b 与 ④ 的"禁止包用户段/禁止包整篇"）；
  //       这里再**聚合复述一次**，理由是 v6 改的是"是否强制"，
  //       而"结构本身"必须**在同一处可见地未被改动** —— 分散断言在对比 v5/v6 时不易核对。
  {
    const structChecks = [
      ['标题在围栏外', lastH1 >= 0 && FENCE.test((hoBody.slice(lastH1 + H1.length).split('\n').find((l) => l.trim() !== '') ?? '').trim())],
      ['只包第一段（用户段未被包）', /Never fence (?:part two|简要说明)/.test(hoBody)],
      ['固定 4 反引号', /exactly four backticks/.test(hoBody)],
      ['围栏不跨 简要说明 标题', /never run past the 简要说明 heading/.test(hoBody)],
    ]
    const missing = structChecks.filter(([, isOk]) => !isOk).map(([n]) => n)
    if (missing.length > 0) bad(`⑤b ${NAME_HO}：触发时的结构细则缺项：${missing.join(' / ')}`)
    else ok(`⑤b ${NAME_HO}：触发时结构四项俱全（标题在围栏外 / 只包第一段 / 固定 4 反引号 / 围栏不跨 简要说明 标题）`)
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
      ['职责标题在位', '### Your duties'],
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

  // ⚠ 2026-10-29（包 BT · CHG-175 §二）：原 ⑤e「批 6 条文不得新起小节标题」
  //   的**3 条负向标题名禁令**（`## Delegation` / `## How you delegate` / `## Delegating`）
  //   已删除 —— 负向禁令换个名字就过，改由 ⑤q 的**正向在册表**守结构。
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

      // ── 正向：S1/S2 的目标名**必须**在白名单里 ────────────────────────
      // ⚠ **2026-10-30 P15**：`roundtable_status` 从本清单删掉 —— 它在三档里，
      //   但本机**没有提供方**（`dsh-plugin-roundtable` 不在 profile 的 bundles / deps 里）
      //   ⇒ "白名单比实际能力宽"，调用即 `unknown tool`（`Q8` 那类）。
      //   ⚠ 这是**移除一个不存在的目标**，⛔ 不是放宽（另外 3 个仍逐个点验）。
      // ⚠ 这些名分三类，各自的能力落点不同（见 E-86）：
      //   · S1（4）声明面**零增量** —— 已在插件平面被继承；
      //   · S2（1）/ S3（4）**必须**在声明面指名增行，否则执行时报 `unknown tool`。
      //     声明面那一侧由下面「声明面增行」子断言覆盖。
      const NEEDED = [
        ['S1 编排只读查询', 'taskboard_list'],
        ['S1 编排只读查询', 'taskboard_get'],
        ['S1 编排只读查询', 'taskboard_comments'],
        ['S2 打开网页取正文', 'web_fetch'],
        // ⚠ **S3 那 4 项已由批 21（2026-10-14 · 用户裁定）收缩掉** —— 它们**不再属于**"必须有"，
        //   改为下面的"**必须没有**"组。⛔ 别把它们加回本清单。
      ]
      const missing = NEEDED.filter(([, n]) => !allowSet.has(n))
      if (missing.length > 0) {
        bad(`⑤f ${NAME_HO} 白名单缺目标名（${missing.length} 个）：${missing.map(([g, n]) => `${n}(${g})`).join(', ')}`)
      } else ok(`⑤f ${NAME_HO}：白名单含 S1/S2 的 ${NEEDED.length} 个目标名（${NEEDED.map(([, n]) => n).join(', ')}）`)

      // ── ⑤f · 批 21 收缩（**必须没有**）：S3 那 4 项不得出现在白名单 ──────
      //   ⚠ 与上面 NEEDED 是**成对**判据（E-126：只验一侧 ⇒ "判据改哑"与"判据改对"输出相同）。
      const SHRUNK21_F = [['S3（已收缩）只读看工作区文件', 'read'], ['S3（已收缩）', 'glob'],
                          ['S3（已收缩）', 'grep'], ['S3（已收缩）', 'read_image']]
      const back5f = SHRUNK21_F.filter(([, n]) => allowSet.has(n))
      if (back5f.length > 0) {
        bad(`⑤f ${NAME_HO} 白名单**不该含**已收缩项（${back5f.length} 个）：${back5f.map(([g, n]) => `${n}(${g})`).join(', ')}`
          + '\n      ⇒ 用户 2026-10-14 裁定：Hob 只能看账本 + 网络；工作区文件读取这 4 个应已移除')
      } else ok(`⑤f ${NAME_HO}：S3 的 4 个（read/glob/grep/read_image）**逐名均不在**白名单（批 21 收缩生效）`)

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
      //   以及 `kit/drafts/preset-contracts.md` 的引文块与 §五 断言清单。
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
        // ⚠ 锚点**不得跨行**（第 143 轮实测：原锚点跨行 ⇒ 改述后行断点一变就判不出，属假红）
        // ⚠⚠ **第 144 轮替换**（不是删除）：能力句改成"按档位"表述 ——
        //   旧锚点 `read-only search and reading -- your own ledger and` 与
        //   `plus writing your own ledger and hand-off files` 随措辞变化**已不在**，
        //   换成新措辞里的两条**等价锚点**（读账本/网页/看板 + 写账本与交接文件）。
        //   ⛔ 只删不加会让本条退化成"什么也没验"（读者无法判断 Hob 能做什么）。
        ['按档位读（账本 / 网页 / 看板与圆桌只读查询）', 'Among the tools you do have: reading your own ledger'],
        ['只写自己的账本与交接文件', 'ledger and hand-off files (.hob/)'],
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
        // ⚠ **批 21 收缩**：`tool-fs` / `tool-fs-search` **两行已删** ——
        //   它们正是为 S3 那 4 个（read/read_image/glob/grep）才加的。
        //   ⛔ 删了白名单却留着声明行 ⇒ `write`/`edit` 的注册面会回来（见 preset 那段注释）。
      ]
      // ── ⑤f · 批 21 收缩（**声明面必须没有**）：那两行不得回来 ────────────
      const DECL_GONE21 = [['S3（已收缩）', '@deepseek-ai/dsh-tool-fs'],
                           ['S3（已收缩）', '@deepseek-ai/dsh-tool-fs-search']]
      // ⚠ 归一化后匹配（容忍 `name: 'X'` / `name: X` 两种 YAML 写法），理由同下面的禁令组。
      const hoSrcNorm = hoSrc.replace(/'([^']*)'/g, '$1')
      const decMissing = DECL_ROWS.filter(([, pk]) => !hoSrcNorm.includes(`name: ${pk}`))
      if (decMissing.length > 0) {
        bad(`⑤f ${NAME_HO} 声明面缺指名增行（${decMissing.length} 个）：${decMissing.map(([l, p]) => `${l}=${p}`).join(', ')} —— 白名单放行了名字但作用域内没有该工具 ⇒ 执行期 `+'`unknown tool`')
      } else ok(`⑤f ${NAME_HO}：声明面指名增行在位（tool-web）`)

      // ── ⑤f · 批 21 收缩（执行）：那两行**不得回来** ─────────────────────
      {
        const decBack = DECL_GONE21.filter(([, pk]) => hoSrcNorm.includes(`name: ${pk}`))
        if (decBack.length > 0) {
          bad(`⑤f ${NAME_HO} 声明面**不该含**已收缩行（${decBack.length} 个）：${decBack.map(([l, p]) => `${l}=${p}`).join(', ')}`
            + '\n      ⇒ 批 21（2026-10-14）删这两行正是为了连带收掉 `write`/`edit` 的注册面'
            + '\n      ⇒ 只删白名单、留声明行 ⇒ 那族工具回到注册面，刚收窄的残余风险被重新打开')
        } else {
          ok(`⑤f ${NAME_HO}：声明面的 tool-fs / tool-fs-search **两行均不在**（批 21 收缩生效，`
            + '`write`/`edit` 的注册面随之消失）')
        }
      }

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

  // ⚠ 2026-10-29（包 BT · CHG-175 §二）：原 ⑤g「批 11 条文不得新起小节标题」
  //   的**4 条负向标题名禁令**（`## Deciding` / `## Autonomy` / `## Asking the user` /
  //   `## When to ask`）已删除 —— 改由 ⑤q 的正向在册表守结构。

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

      // ── 正向：白名单**恰好 26**（防止悄悄多放一个而无人察觉）──────────
      // 26 = 既有 11 + 批 9 的 9 + 批 11 的 1 + 批 13 的 2 + 批 14 的 2（M3 投递）
      //      + 批 16 的 2（建会话）+ 批 17 的 3（闭环编排）**− 批 21 收掉的 4**。
      // ⚠ **批 21（2026-10-14 · 用户裁定）权限收缩**：`read` / `glob` / `grep` / `read_image`
      //   从白名单移除（用户要求"只能看账本和网络"）⇒ 30 → 26。**这是收紧，不是放宽。**
      // ⚠ 名字提成常量：模板串里**不能直接写反引号**（本轮实测踩过一次语法错误）。
      const SHRUNK21 = ['read', 'glob', 'grep', 'read_image']
      const SHRUNK21_NAMES = SHRUNK21.join(' / ')
      // ⚠⚠ **P-2（第 144 轮）**：这里原先内联了**第二份 26 名清单** ——
      //   它与 `src/preset/tools.ts` 的那份是**两个副本**（E-110 的典型形态：
      //   改一处忘另一处，两边说法不同却都不会报错）。
      //   ⇒ 改成**从源码那份派生**：`未知名` 只用于**报错时指出多出来的是哪几个**，
      //     **不是**判据本身（判据仍是上面的"恰好 26"与下面的"档1 ≡ 常量"）。
      const known26 = (() => {
        try {
          const m = /export const PERMISSION_TIERS[\s\S]*?ledger:\s*MODEL_TOOL_ALLOWLIST/.exec(toolsSrc13)
          if (m === null) return null
          const m2 = /export const MODEL_TOOL_ALLOWLIST[^=]*=\s*\[([\s\S]*?)\n\]/.exec(toolsSrc13)
          return m2 === null ? null : new Set([...m2[1].matchAll(/'([^']+)'/g)].map((x) => x[1]))
        } catch { return null }
      })()
      /**
       * ⚠ **第 339 轮 · 丙-6**：原先这里写死 `26`。删掉 4 个 `schedule_*` 之后
       *   真值是 **22**（实测 `MODEL_TOOL_ALLOWLIST.length`）⇒ 判据跟着改。
       *   ⚠ **2026-10-30 P15**：再删 1 个（`roundtable_status`，本机无提供方）⇒ **21**。
       *   ⚠ 这个数**只在本行与 `⑤m-3b` 的 `want` 里各写一次**（那是"档位表本体"，
       *     按 `P-1` 的口径它就是唯一允许写死的地方）。
       */
      /**
       * ⚠ **2026-11-08**：新增两件「账本先建后推进」（`hob_ledger_status` / `hob_ledger_init`）
       *   ⇒ 21 → **23**。理由：账本没建时连派活都过不去，建账工具必须三档都可见，
       *   否则那一档只能等人手工建账（正是改前"建账只是文档规定"的形态）。
       */
      if (allow13.length !== 23) {
        const extra = known26 === null ? allow13 : allow13.filter((n) => !known26.has(n))
        bad(`⑤h ${NAME_HO} 白名单应恰好 23 名，实测 ${allow13.length}`
          + `（多出：${extra.join(', ') || '无'}）`
          + `\n      ⇒ ⚠ **批 21 起 ${SHRUNK21_NAMES} 属"已被收缩"项** ——`
          + `\n        它们出现即说明收缩被回退（用户的权限裁定失效），**须查明是谁加回来的**`)
      } else ok(`⑤h ${NAME_HO}：白名单恰好 23 名（21 + 2[账本先建后推进：hob_ledger_status / hob_ledger_init]）`)

      // ── 正向·批 21 专项：**被收缩的 4 个必须确实不在**（防"收了个寂寞"）──────
      //   ⚠ 只靠总数不够：30 → 26 也可能是"删错 4 个、漏删目标 4 个"恰好凑成 26。
      //   ⇒ 按 E-126「判据改哑与改对必须输出不同」的口径，**逐名点验**。
      {
        const back = SHRUNK21.filter((n) => allow13.includes(n))
        if (back.length > 0) {
          bad(`⑤h 批 21 收缩**未生效**：${back.join(', ')} 仍在白名单里`
            + '\n      ⇒ 用户 2026-10-14 的权限裁定：Hob **只能看账本 + 网络**，'
            + '\n        「工作区文件读取」这 4 个应当**已移除**'
            + '\n      ⇒ 修法：白名单删这 4 名，并核声明面 `tool-fs` / `tool-fs-search` 是否同步删行')
        } else {
          ok(`⑤h 批 21 ✓ 收缩实测生效：${SHRUNK21.join(' / ')} **逐名均不在**白名单里（不是靠总数凑巧）`)
        }
      }

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

  // ⚠ 2026-10-29（包 BT · CHG-175 §二）：原 ⑤i「原始读数纪律不得新起小节标题」
  //   的**4 条负向标题名禁令**（`## Readings` / `## Evidence` / `## Tool hints` /
  //   `## State before you speak`）已删除 —— 改由 ⑤q 的正向在册表守结构。

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
//   ① `check:presets` 的镜像断言读的是 `DRAFT`（`kit/drafts/preset-contracts.md`）与
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

// ── ⑤k 2026-10-13（第 111 轮 · 用户本轮原话）· Hob 契约的**显式职责边界**块 ──
//
// 为什么需要（本组存在的唯一理由，别删）：用户本轮原话是
//   「搭建项目时，**预设模式不只是完成自身功能，还要明确写出自身的职责边界**」。
//   实测（本轮开工读数）：批 111 之前，契约里**没有一块显式的职责边界** ——
//   边界只以「不实施」「投递不是做完了」「不许打印内部标识」这类句子**散落**在各段里。
//   ⇒ 而 ⑤ 只能证明"两份载体一致"：**两份一起把这块删掉，⑤ 照样 PASS**。
//   本组把用户诉求钉成**可判的断言**。
//
// ⚠ 口径（防误读）：
//   · 钉的是**稳定短语**，不是整段逐字 —— 措辞可随文调整，只要该语义还在，句子就还在。
//     **这是新增断言，不是放宽**：任一条缺失即 FAIL。
//   · 分组口令:五类语义**各至少一条**（任务书 §1 第 4 步原始列表）——
//     ① 显式的边界块（标题 + 正文）· ② 做什么 · ③ 不做什么 · ④ 三条不变量 ·
//     ⑤ 靠什么守住（工具面 + fail-open 读法 + "无命令 ≠ 不能读文件"）。
//   · **不写"预期 N 条"**（任务书明令）：下面两条 `filter` 判**缺项**，
//     ⛔ 不设任何**预期计数**字面量。
//   · 编号：现有最大为 ⑤j ⇒ 顺延为 **⑤k**（与批 5 / 批 6 同款：语义一致，区别只在编号）。
{
  const hoBody8 = literalBlock(hoSrc, 'prefix') ?? ''

  // ── ① 正向：五类语义各钉稳定短语（任一缺失即 FAIL）──────────────────
  const BOUNDARY_PINS = [
    // ① 显式的边界块（自己的标题 + 正文）
    ['①边界块标题在位（`### Your duty boundary`）', '### Your duty boundary'],
    ['①边界块有自己的正文（"一次说清"起句）', 'What you do, once and for all'],
    // ② 做什么（沟通与理解需求 → 拆分 → 编排 → 分发 → 监督验收；只读自己直接做；维护自己的账本）
    ['②做什么：沟通与理解需求 → 拆分 → 编排 → 分发 → 监督验收', 'talk with the user and understand the need, break it'],
    ['②做什么：只读的事自己直接做 + 维护自己的账本与交接文件', 'Read-only work you do yourself, and you keep your own ledger and hand-off files'],
    // ③ 不做什么（不实施 · 不改代码 · 不改工作区文件 · 不执行命令 · 不组队 · 不替人挑目标会话）
    ['③不做什么：不实施 + 不改代码 + 不改工作区文件并列', 'you do not implement, you do not change code, you do not change a'],
    ['③不做什么：不执行命令', 'you do not run a'],
    ['③不做什么：不组队', 'you do not raise a team of your own'],
    ['③不做什么：不替人挑目标会话', "you do not pick a target session on"],
    // ④ 三条不变量（投递 ≠ 执行 · 建会话 ≠ 委派 · 回传 ≠ 验收）
    ['④不变量：投递 ≠ 执行', 'delivering is'],
    ['④不变量：建会话 ≠ 委派', 'creating a session is not delegating'],
    ['④不变量：回传 ≠ 验收', 'a result coming back is not'],
    // ⑤ 靠什么守住（**三条分开写**：结构性 / 白名单 / 单调哨兵）
    // ⚠⚠ **第 144 轮替换**（不是删除）：旧版三条锚点是
    //   `by the tool face of this preset alone` / `fail-open` / `not as a` ——
    //   它们描述的是**旧**机制（"只有工具面 + 拦截，且拦截 fail-open"）。
    //   第 144 轮落"真硬机制"后，正文改成**三条不同性质**的并列说法
    //   （① 结构性：写类工具**根本不存在**；② 白名单按档；③ 单调哨兵 fail-closed）
    //   ⇒ 旧锚点**必然消失**。⛔ 只删不加会让"职责边界块有语义"这条退化成恒真。
    //   ⚠ 新增一条**负向**锚点（下面的 NO_LONGER_TRUE），防"fail-open"那句回到
    //     描述**档位边界**的上下文里（R-26：⛔ 不许把 fail-open 与 fail-closed 混写）。
    ['⑤靠什么守住：①结构性（写类工具**根本不存在**）', 'the write-capable tools do not exist here at all'],
    ['⑤靠什么守住：②白名单按档，且任何档不含写类/命令名', 'a level never includes a write-capable or command name'],
    // ⚠ 锚点**不得跨行**（本仓既有纪律，第 143/144 轮各踩过一次）：
    //   第 145 轮重排该句后 `that guard fails closed` 被断行切开 ⇒ 换成**行内片段**。
    //   ⚠ 语义仍是"③单调哨兵 **fail-closed**"（`fails` + `closed` 在同一行的那一处）。
    ['⑤靠什么守住：③单调哨兵 **fail-closed**（与拦截器相反）', 'that guard fails'],
    ['⑤靠什么守住：明确"不是对所有事都是边界"', 'not as a'],
    // ⚠ 锚点**不得跨行**（本仓既有纪律，第 143 轮实测过一次假红）：
    //   第 144 轮正文重排后 `is not the same as "the plugin cannot read` 恰好被断行切开
    //   ⇒ 换成**同一句的行内前半段**（语义不变，仍是"两条不混"）。
    ['⑤靠什么守住："无命令"≠"插件不能读文件"，两条不混', '"no command" is not the same'],
  ]
  // ⚠⚠ **成对的负向锚点**（R-26）：旧机制那句 `The interception is fail-open`
  //   在描述**档位边界**时**已失实**（档位那条边界是单调哨兵、fail-closed）。
  //   ⇒ 它若回来，说明有人把两套性质混着写 —— 正是本项目反复强调的混写形态。
  //   ⚠ 与上面三条**成对**：只验"新句在位"会漏掉"旧句也还在"（E-126：判据只验一侧）。
  const NO_LONGER_TRUE = [
    ['旧机制句「拦截是 fail-open」不得回来（档位边界是 fail-closed 的哨兵）',
      'The interception is fail-open'],
  ]
  const revived = NO_LONGER_TRUE.filter(([, s]) => hoBody8.includes(s))
  if (revived.length > 0) {
    bad(`⑤k ${NAME_HO}：描写**档位边界**时不得再用 fail-open 措辞（${revived.length} 处）：`
      + `${revived.map(([l]) => l).join(' / ')}`
      + '\n      ⇒ R-26：靠什么守住必须同句写明；fail-open（拦截器）与 fail-closed（单调哨兵）'
      + '\n        是**两种不同性质**，混写会让读者以为边界是敞的')
  } else ok(`⑤k ${NAME_HO}：档位边界段未用 fail-open 措辞（${NO_LONGER_TRUE.length} 个负向锚点均不在）`)

  const boundaryMissing = BOUNDARY_PINS.filter(([, s]) => !hoBody8.includes(s))
  if (boundaryMissing.length > 0) {
    bad(`⑤k ${NAME_HO}：职责边界块缺语义（${boundaryMissing.length} 处）：`
      + `${boundaryMissing.map(([l]) => l).join(' / ')} —— `
      + '用户 2026-10-13 原话要求"预设必须明确写出自身的职责边界"，缺一条即未兑现')
  } else ok(`⑤k ${NAME_HO}：职责边界块五类语义俱全（${BOUNDARY_PINS.map(([l]) => l).join(' · ')}）`)

  // ── ② 负向：正文不得出现被禁的标题名（与 ⑤e 的形态负向同款）──────────
  //   理由：这块**必须是"职责边界"**，不是"怎么委派"。若以 Delegation 一族起标题，
  //   等于把委派教程当成边界声明（用户要的是**职责边界**，不是又一份派活说明）。
  // ⚠ 2026-10-29（包 BT · CHG-175 §二）：原 ⑤k 的**3 条负向标题名禁令**
  //   （`## Delegation` / `## How you delegate` / `## Delegating`）已删除 ——
  //   改由 ⑤q 的正向在册表守结构。

  // ── ③ 既有条文逐字保留（本批追加**不许挤掉**任何一条既有条文）────────
  //   ⚠ 与 ⑤g / ⑤i 的 KEPT 口径同款：这里**单独可见地复述一次**"本批追加没把既有的挤掉"，
  //    而不是依赖别组的断言替它背书。
  const KEPT_BY_111 = [
    ['职责句（不实施 / 只读直接做）', 'What is read-only, you do directly'],
    ['投递 ≠ 执行（既有句）', 'Delivering is not doing'],
    ['建会话 ≠ 委派（既有句）', 'Creating a'],
    ['回传 ≠ 验收（既有句）', 'A returned result is not acceptance'],
    ['文件交接（TASK.md 落点）', 'holding a TASK.md with the complete directive'],
    ['委派门槛', 'delegate only work that MUST be done by hand'],
    ['指令自足', 'Every directive must stand on its own'],
    ['验收只认读数', 'Accept on readings only'],
    ['决策自主', 'Decide on your own.'],
    ['原始读数纪律', 'State nothing to the user without a reading behind it'],
  ]
  const squeezed = KEPT_BY_111.filter(([, s]) => !hoBody8.includes(s))
  if (squeezed.length > 0) {
    bad(`⑤k ${NAME_HO}：职责边界块的追加**挤掉了既有条文**（${squeezed.length} 处）：`
      + `${squeezed.map(([l]) => l).join(' / ')} —— 本批只许追加，不许顶掉既有的`)
  } else ok(`⑤k ${NAME_HO}：既有 ${KEPT_BY_111.length} 组条文逐字保留（职责边界块的追加未挤掉任何一条）`)
}

// ── ⑤s 2026-11-06 · **项目总代理的定位与有限授权**（用户本轮原话）──────────────
//
// 为什么需要：定位从“项目总负责人”改为“项目总代理”后，真正变的不只是称呼，
// 而是**委托关系**：用户保留目标与产品取舍，Hob 只在其授权内组织项目。
// ⚠ 若只改称呼、正文仍以 owner 自居，模型会把“结果负责”误读成“可替用户决定”；
// 若把它改成无限代理，又会越出产品决定权。两边都错，故正向与负向都要钉。
{
  const norm = (s) => s.replace(/\s+/g, ' ').trim()
  const body = norm(literalBlock(hoSrc, 'prefix') ?? '')
  const PINS = [
    ['角色称呼为用户的项目代理', "You are Hob, the user's project agent between the user and the developer session"],
    ['代理范围仅限项目目标', "You act for the user on the project's goal, not on everything the user could personally do"],
    ['用户保留目标 / 产品取舍 / 代价 / 不可逆决定', 'The user owns the goal, product trade-offs, accepted cost and any irreversible action'],
    ['Hob 的授权是组织与协调', 'Within that mandate you own organisation and coordination'],
    ['不得自行扩权', 'You cannot widen your own mandate'],
    ['不得替用户接受自己的实现', "you cannot accept your own implementation on the user's behalf"],
    ['职责边界再述：产品取舍 / 范围 / 新代价 / 不可逆动作交回用户', 'a product trade-off, a change of scope, a new cost, or an irreversible action goes back to the user'],
  ]
  const missing = PINS.filter(([, s]) => !body.includes(norm(s)))
  if (missing.length > 0) {
    bad(`⑤s ${NAME_HO}：项目总代理定位或有限授权缺失（${missing.length} 处）：${missing.map(([l]) => l).join(' / ')}`)
  } else ok(`⑤s ${NAME_HO}：项目总代理定位与有限授权完整（${PINS.length} 条语义）`)

  const stale = ['the project owner between the user', 'Hob project owner']
    .filter((s) => body.includes(s))
  if (stale.length > 0) {
    bad(`⑤s ${NAME_HO}：运行正文仍残留旧定位（${stale.map((s) => JSON.stringify(s)).join(', ')}）`
      + ' ⇒ 只改界面称呼不够，模型仍会按“项目负责人”理解自己的权力')
  } else ok(`⑤s ${NAME_HO}：运行正文无旧“项目负责人”定位残留（${2} 个负向锚点均不在）`)
}

// ── ⑤l 2026-10-14（第 138 轮 · 用户本轮原话）· Hob 契约的**「先对照方案」**段 ──
//
// 为什么需要（本组存在的唯一理由，别删）：用户本轮原话是
//   「hob预设模式的整个运行逻辑，在接到用户会话之后要根据方案去做任务编排，不能靠感觉，
//     接到任何会话信息任务之后都是先对照方案然后在进行下一步」。
//   ⇒ 这段运行口径**此前只以散句存在**（`Take every directive from the plan.` 管的是"派出去的指令"，
//     `Decide on your own.` 管的是"能自己定的自己定"）—— **"收到任何输入的第一个动作"没有任何一条明文**。
//   而 ⑤ 只能证明"两份载体一致"：**两份一起把这段删掉，⑤ 照样 PASS**。
//   本组把用户诉求钉成**可判的断言**。
//
// ⚠ 口径（防误读）：
//   · 钉的是**稳定短语**，不是整段逐字 —— 措辞可随文调整，只要该语义还在，句子就还在。
//     **这是新增断言，不是放宽**：任一条缺失即 FAIL。
//   · 本段**就地插在既有段落之间**（`Decide on your own.` 之后、`Take every directive from the plan.` 之前），
//     ⛔ **不新起 `## ` 小节标题** —— 故本组同时负向钉"未起标题/上方非标题"两条形态。
//   · **不写"预期 N 条"**（任务书明令）：下面 `filter` 判**缺项**，⛔ 不设任何**预期计数**字面量。
//   · 编号：现有最大为 ⑤k ⇒ 顺延为 **⑤l**（与批 5 / 批 6 / 批 111 同款：语义一致，区别只在编号）。
{
  const hoBody9 = literalBlock(hoSrc, 'prefix') ?? ''

  // ── ① 正向：钉 7 条稳定短语（任一缺失即 FAIL）──────────────────────
  const CONSULT_PINS = [
    ['起句「每次都从方案出发」', 'Start from the plan, every time.'],
    ['输入三种形态（用户的话 / 回传 / 提问，不分类别）', 'a message from the user, a report from a'],
    ['第一个动作是同一个', 'your first move is the same'],
    ['对照 PROJECT.md 与账本', 'consult PROJECT.md and the'],
    ['边界与判据', 'what the boundary is, and what'],
    ['再决定下一步', 'Only then decide the next step.'],
    ['方案与账本才是记录', 'the plan and the ledgers are the record'],
  ]
  const consultMissing = CONSULT_PINS.filter(([, s]) => !hoBody9.includes(s))
  if (consultMissing.length > 0) {
    bad(`⑤l ${NAME_HO}：契约缺「先对照方案」条文（${consultMissing.length} 处）：`
      + `${consultMissing.map(([l]) => l).join(' / ')} —— `
      + '用户 2026-10-14 原话要求"接到任何会话信息任务之后都是先对照方案然后再进行下一步"，缺一条即未兑现')
  } else ok(`⑤l ${NAME_HO}：先对照方案七条稳定短语俱全（${CONSULT_PINS.map(([l]) => l).join(' · ')}）`)

  // ── ② 形态负向①：正文不得出现被禁的标题名（与 ⑤e / ⑤g / ⑤k 同款）──
  //   理由：这一条是**运行口径**、就地写在既有的 `## Running the loop` 段里，
  //   起一个小节标题会把"就地追加"这一形态本身变成要求。
  // ⚠ 2026-10-29（包 BT · CHG-175 §二）：原 ⑤l 的**3 条负向标题名禁令**
  //   （`## Working from the plan` / `## First step` / `## Every input`）已删除 ——
  //   改由 ⑤q 的正向在册表守结构。⚠ 下面「形态负向②」的结构检查**保留**
  //   （它不是"防名字"，是防"用任意新标题把它顶上去"，属另一类判据）。

  // ── ③ 形态负向②：第 1 条短语所在行，**向上第一条非空行不得是标题**──
  //   理由：负向①只挡三个**点名**标题名；换个名字的标题照样能把它顶上。
  //   故这里从**结构**上再钉一刀：新段上方那条非空行必须是**正文**（不得匹配 `/^#{1,6}\s/`）。
  const consultLines = hoBody9.split('\n')
  const startLine = consultLines.findIndex((l) => l.includes(CONSULT_PINS[0][1]))
  if (startLine < 0) {
    // 上面①已经报过缺失；此处不重复报
  } else {
    let prevNonEmpty = null
    for (let i = startLine - 1; i >= 0; i--) {
      if (consultLines[i].trim() === '') continue
      prevNonEmpty = { idx: i, text: consultLines[i] }
      break
    }
    if (prevNonEmpty === null) {
      bad(`⑤l ${NAME_HO}：先对照方案段上方找不到任何非空行（它必须是就地追加在既有段落内，不是段首）`)
    } else if (/^#{1,6}\s/.test(prevNonEmpty.text.trim())) {
      bad(`⑤l ${NAME_HO}：先对照方案段被顶上了一个新标题（上一非空行 = ${JSON.stringify(prevNonEmpty.text.trim().slice(0, 60))}）`
        + ' —— 本段须就地追加在既有段落内，⛔ 不许新起小节')
    } else ok(`⑤l ${NAME_HO}：先对照方案段上方是正文而非标题（上一非空行 = ${JSON.stringify(prevNonEmpty.text.trim().slice(0, 48))}…）`)
  }

  // ── ④ KEPT：本次追加**不许挤掉**既有条文（与 ⑤g / ⑤i / ⑤k 同款）──────
  const KEPT_BY_138 = [
    ['派出去指令的来源（既有句）', 'Take every directive from the plan'],
    ['决策自主（既有句）', 'Decide on your own.'],
    ['接住待决问题（既有句）', 'Catch the questions'],
    ['验收只认读数（既有句）', 'Accept on readings only'],
    ['投递 ≠ 执行（既有句）', 'Delivering is not doing'],
    ['职责边界块标题（既有块）', '### Your duty boundary'],
    ['原始读数纪律（既有句）', 'State nothing to the user without a reading behind it'],
  ]
  const squeezedBy138 = KEPT_BY_138.filter(([, s]) => !hoBody9.includes(s))
  if (squeezedBy138.length > 0) {
    bad(`⑤l ${NAME_HO}：先对照方案段的追加**挤掉了既有条文**（${squeezedBy138.length} 处）：`
      + `${squeezedBy138.map(([l]) => l).join(' / ')} —— 本批只许追加，不许顶掉既有的`)
  } else ok(`⑤l ${NAME_HO}：既有 ${KEPT_BY_138.length} 组条文逐字保留（先对照方案段的追加未挤掉任何一条）`)
}

// ── ⑤m 2026-10-14（第 144 轮 · 用户裁定「档3 要真硬机制」+「档2不给，档3的都给」）──
//    权限**三档**：名字集 / 单调性 / 共享禁项 / 声明面与门 / 宿主平面 / 名字互斥 / 哨兵形态 ──
//
// ⚠ **为什么需要它**（承接上一轮的两处实测缺口）─────────────────────────
//   ① 旧 ⑤f/⑤h 把"白名单"当**一个**数组判（"恰好 26 名"、"这 4 个不许在"）——
//      三档化后改档2 的名字会**当场打挂**档1/档3 的断言（E-110：两条断言共用一个常量）。
//      ⇒ 判据必须从"一个数"变成"**一张表**"，且**逐条只读自己那一组**。
//   ② 旧的声明面断言只看"预设自己声明了哪些行"——
//      **它看不见宿主平面**。而写类工具在当前 profile 里正是靠
//      `dsh-web-app/cordis.patch.yml` 把 `tool-fs` / `tool-bash` / `tool-pwsh`
//      标 `disabled: true` 才不可达的（实测）。**别人改 profile ⇒ 写类工具静默
//      回到注册面，而三档白名单照样 PASS** ⇒ ⑤m-6 专门盯这一条。
//
// ── 判据口径（不许放宽）────────────────────────────────────────────────
//   · 名字集**一律从 `src/preset/tools.ts` 的 `PERMISSION_TIERS` 实测抽取**，
//     ⛔ **不许在脚本里内联第二份清单**（P-2 判据管的就是这件事）；
//   · 档1 必须与 `MODEL_TOOL_ALLOWLIST` **双向差集都为空**（逐名，不是数条数）。
{
  let tierSrc = ''
  try { tierSrc = readFileSync(TOOLS_TS, 'utf8') } catch { /* 下面统一报 */ }

  // ── 抽出 `PERMISSION_TIERS` 的三组名字 ────────────────────────────────
  //   口径：`ledger: MODEL_TOOL_ALLOWLIST`（引用档1 常量）与
  //         `project: [ ...MODEL_TOOL_ALLOWLIST, 'a', 'b' ]` 两种形态并存。
  //   ⚠ 两种形态都**必须**支持 —— 只认字面量数组会让 ⑤m-2 的"档1 ≡ 常量"变成空判。
  const tiers = {}
  if (tierSrc !== '') {
    const tierBlock = /export const PERMISSION_TIERS[^=]*=\s*\{([\s\S]*?)\n\}/.exec(tierSrc)
    if (tierBlock === null) {
      bad('⑤m 在 src/preset/tools.ts 里找不到 PERMISSION_TIERS 的字面量对象（基准缺失 ⇒ 不按通过处理）')
    } else {
      for (const key of ['ledger', 'project', 'workspace']) {
        const re = new RegExp(`\\b${key}:\\s*\\[([\\s\\S]*?)\\]`, 'm')
        const m = re.exec(tierBlock[1])
        if (m === null) { tiers[key] = null; continue }
        const spread = /\.\.\.MODEL_TOOL_ALLOWLIST/.test(m[1])
        const own = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
        tiers[key] = { own, spread }
      }
      // `ledger: MODEL_TOOL_ALLOWLIST`（不带方括号）这一形态单独认。
      if (tiers.ledger === null && /\bledger:\s*MODEL_TOOL_ALLOWLIST\b/.test(tierBlock[1])) {
        tiers.ledger = { own: [], spread: true }
      }
    }
  }

  // 档1 的基准 = MODEL_TOOL_ALLOWLIST（唯一来源）。
  const mAllow = /export const MODEL_TOOL_ALLOWLIST[^=]*=\s*\[([\s\S]*?)\n\]/.exec(tierSrc)
  const allow26 = mAllow === null ? null : [...mAllow[1].matchAll(/'([^']+)'/g)].map((x) => x[1])

  const missingTiers = ['ledger', 'project', 'workspace'].filter((k) => tiers[k] === null || tiers[k] === undefined)
  if (missingTiers.length > 0) {
    bad(`⑤m-1 PERMISSION_TIERS 缺档位：${missingTiers.join(', ')}（三档必须齐）`)
  } else if (allow26 === null) {
    bad('⑤m-1 抽不出 MODEL_TOOL_ALLOWLIST（档1 的基准缺失 ⇒ 不按通过处理）')
  } else {
    ok(`⑤m-1 三档表在位且自洽（ledger / project / workspace）`)

    // 展开成完整名字集（`spread` ⇒ 前置 allow26）。
    const full = {}
    for (const k of ['ledger', 'project', 'workspace']) {
      full[k] = tiers[k].spread ? [...allow26, ...tiers[k].own] : [...tiers[k].own]
    }

    // ── ⑤m-2 档1 ≡ MODEL_TOOL_ALLOWLIST（**双向差集**，逐名）────────────
    {
      const a = new Set(full.ledger), b = new Set(allow26)
      const onlyA = [...a].filter((n) => !b.has(n))
      const onlyB = [...b].filter((n) => !a.has(n))
      if (a.size !== b.size) {
        bad(`⑤m-2 档1 名数与 MODEL_TOOL_ALLOWLIST 不等（档1 ${a.size} vs 常量 ${b.size}）`)
      } else if (onlyA.length > 0 || onlyB.length > 0) {
        bad(`⑤m-2 档1 与 MODEL_TOOL_ALLOWLIST **不是逐名相等**`
          + `（档1 多：${onlyA.join(', ') || '无'}；常量多：${onlyB.join(', ') || '无'}）`)
      } else {
        ok(`⑤m-2 档1 ≡ MODEL_TOOL_ALLOWLIST（逐名相等，共 ${a.size} 名）`)
      }
    }

    // ── ⑤m-3 三档**单调性**：ledger ⊆ project ⊆ workspace ────────────────
    {
      const sub = (x, y) => x.every((n) => y.includes(n))
      const p1 = sub(full.ledger, full.project)
      const p2 = sub(full.project, full.workspace)
      const back1 = full.project.filter((n) => !full.ledger.includes(n))
      const back2 = full.workspace.filter((n) => !full.project.includes(n))
      if (!p1 || !p2) {
        bad('⑤m-3 三档**不满足包含链** ledger ⊆ project ⊆ workspace'
          + `（${p1 ? '' : '档2 缺档1 的：' + full.ledger.filter((n) => !full.project.includes(n)).join(', ')}`
          + `${p2 ? '' : '；档3 缺档2 的：' + full.project.filter((n) => !full.workspace.includes(n)).join(', ')}）`)
      } else {
        ok(`⑤m-3 三档单调性成立（档2 比档1 多 ${back1.length} 名：${back1.join(', ') || '无'}`
          + `；档3 比档2 多 ${back2.length} 名：${back2.join(', ') || '无'}）`)
      }
      // 名数也钉住（26 / 27 / 30）—— ⚠ 与包含链是**两条**判据：
      //   包含链能抓"档2 被抽走"，名数能抓"档2 被多加"（包含链对后者是哑的）。
      /** ⚠ **第 339 轮 · 丙-6**：删掉 4 个 `schedule_*` ⇒ 26/27/30 → 22/23/26；**P15** 再删 `roundtable_status` ⇒ 21/22/25。 */
      // ⚠ **2026-10-30 P15**：删 `roundtable_status` ⇒ 22/23/26 → **21/22/25**（真数变化，照实改）。
      /** ⚠ **2026-11-08**：+2 账本工具（三档都可见）⇒ 21/22/25 → **23/24/27**。 */
      const want = { ledger: 23, project: 24, workspace: 27 }
      const wrong = ['ledger', 'project', 'workspace'].filter((k) => full[k].length !== want[k])
      if (wrong.length > 0) {
        bad(`⑤m-3b 三档名数与裁定不符（${wrong.map((k) => `${k}=${full[k].length}（应 ${want[k]}）`).join('；')}）`)
      } else {
        ok('⑤m-3b 三档名数 = 23 / 24 / 27（含账本先建后推进那两件）')
      }
    }

    // ── ⑤m-4 共享禁项：三档**逐个**不得含写类 / 命令类 ────────────────────
    {
      let forbidden = []
      const mf = /export const SHARED_FORBIDDEN_TOOLS[^=]*=\s*\[([\s\S]*?)\n\]/.exec(tierSrc)
      if (mf !== null) forbidden = [...mf[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
      if (forbidden.length === 0) {
        bad('⑤m-4 抽不出 SHARED_FORBIDDEN_TOOLS（基准缺失 ⇒ 不按通过处理）')
      } else {
        const hits = []
        for (const k of ['ledger', 'project', 'workspace']) {
          for (const n of forbidden) if (full[k].includes(n)) hits.push(`${k}:${n}`)
        }
        if (hits.length > 0) {
          bad(`⑤m-4 三档里出现了**写类 / 命令类**名字：${hits.join(', ')}`
            + '\n      ⇒ 用户裁定「任何一档都不能操作改动」：这些名字在任何一档都不许有')
        } else {
          ok(`⑤m-4 共享禁项三档均不含（逐档点验 ${forbidden.length} 名 × 3 档：${forbidden.join(' / ')}）`)
        }
      }
    }

    // ── ⑤m-5 声明面与门：三档下那 5 个包**都不得**被声明 ──────────────────
    {
      const bannedPkgs = [
        '@deepseek-ai/dsh-tool-fs',
        '@deepseek-ai/dsh-tool-fs-search',
        '@deepseek-ai/dsh-tool-bash',
        '@deepseek-ai/dsh-tool-pwsh',
        '@deepseek-ai/dsh-tool-str-replace-editor',
      ]
      const hoSrcNorm5 = hoSrc.replace(/^\s*#.*$/gm, '')
      const declared = bannedPkgs.filter((pk) => hoSrcNorm5.includes(`name: ${pk}`))
      if (declared.length > 0) {
        bad(`⑤m-5 Hob 声明面**声明了写类 / 命令类的包**：${declared.join(', ')}`
          + '\n      ⇒ 与门（E-86）的另一半：只扩白名单不加声明行不会给能力，'
          + '\n        但**加了声明行就会把 write/edit 送回注册面** ⇒ 该行永远不许出现')
      } else {
        ok(`⑤m-5 声明面不含任何写类 / 命令类的包（逐包点验 ${bannedPkgs.length} 个）`)
      }
    }

    // ── ⑤m-6 ★ **宿主平面仍关着写类行**（本组最有价值的一条）──────────────
    //   ⚠ 这是唯一能抓"**别人改 profile ⇒ 写类工具静默回到注册面**"的判据。
    //     三档白名单与预设声明面**都看不见**这件事（它们只看自己那一层）。
    {
      const WEB_PATCH = join(HOST_NODE_MODULES, 'dsh-web-app', 'cordis.patch.yml')
      let webSrc = null
      try { webSrc = readFileSync(WEB_PATCH, 'utf8') } catch { /* 基准缺失 */ }
      if (webSrc === null) {
        // ⚠ 读不到宿主包 ⇒ **不按通过处理**（基准缺失不许静默 PASS）。
        bad(`⑤m-6 读不到宿主平面 patch（${WEB_PATCH}）—— 基准缺失 ⇒ 不按通过处理`)
      } else {
        const mustBeDisabled = ['tool-fs', 'tool-fs-search', 'tool-bash', 'tool-pwsh']
        const lines = webSrc.split('\n')
        const notDisabled = []
        for (const id of mustBeDisabled) {
          const at = lines.findIndex((l) => new RegExp(`^-\\s*id:\\s*${id}\\s*$`).test(l))
          if (at < 0) { notDisabled.push(`${id}(行不在)`); continue }
          const next = (lines[at + 1] ?? '').trim()
          if (next !== 'disabled: true') notDisabled.push(`${id}(下一行是「${next || '空'}」)`)
        }
        if (notDisabled.length > 0) {
          bad(`⑤m-6 宿主平面里这些写类 / 命令类行**不再 disabled**：${notDisabled.join(', ')}`
            + '\n      ⇒ 它们一旦启用，`write` / `edit` / `bash` / `pwsh` 会回到**注册面**，'
            + '\n        而三档白名单与预设声明面**照样 PASS**（两层都看不见宿主平面）'
            + '\n      ⇒ 要么恢复 disabled，要么按用户裁定重新论证"写类工具可达"这件事')
        } else {
          ok(`⑤m-6 宿主平面仍关着写类 / 命令类 4 行（${mustBeDisabled.join(' / ')} 均 disabled: true）`)
        }
      }
    }

    // ── ⑤m-7 四个新工具名与**宿主已注册名字集合**互斥 ──────────────────────
    //   ⚠ 依据：宿主集合里 `read` / `glob` / `grep` / `write` / `edit` **已被占用**
    //     （第 144 轮实测）⇒ 裸名会撞，必须带 `hob_` 前缀。
    {
      // ⚠⚠ **必须从源码派生**（第 144 轮负向对拍抓出的自身缺陷）：
      //   初版把四个名字**硬编码**在这里 ⇒ 把源码里的 `hob_read_doc` 改名成 `read`
      //   时，本判据**照样检查那四个旧名字**（它们仍互斥）⇒ **假通过**。
      //   ⇒ 改成：新名 = 三档表里**除档1 之外**出现的名字（= 本插件自注册的那几个）。
      const newNames = [...new Set([
        ...full.project.filter((n) => !full.ledger.includes(n)),
        ...full.workspace.filter((n) => !full.project.includes(n)),
      ])]
      const hostNames = collectHostToolNames()
      if (hostNames === null) {
        bad('⑤m-7 收集不到宿主已注册工具名（基准缺失 ⇒ 不按通过处理）')
      } else {
        if (newNames.length === 0) {
          bad('⑤m-7 三档表里抽不出任何"新名字"（基准缺失 ⇒ 不按通过处理）')
        }
        const clash = newNames.filter((n) => hostNames.has(n))
        if (clash.length > 0) {
          bad(`⑤m-7 新工具名与宿主已注册名字**冲突**：${clash.join(', ')}`
            + '\n      ⇒ 同名注册会失败 / 覆盖，且失败可能是静默的')
        } else {
          ok(`⑤m-7 四个新工具名与宿主已注册集合（${hostNames.size} 名）互斥：${newNames.join(', ')}`)
        }
      }
    }

    // ── ⑤m-9 类型面（2026-10-14 第 145 轮 · 用户裁定「档3的都加，文件都可以读取查看」）──
    //   ⚠ 本轮**只改类型面**：档3 从"22 个扩展名白名单"改为"**任意文件**"；档2 不变（仍只 `.md`）。
    //   ⚠ 判据分两半，**缺一不可**（E-126：只验一侧 ⇒ "判据改哑"与"判据改对"输出相同）：
    //     ① **正向**：档3 的类型判定**不查任何白名单**（`workspace` ⇒ 恒真）；
    //     ② **负向**：档2 的类型判定**仍只认 `.md`**。
    //   ⚠ 另有一条**删除判据**：那份 22 个扩展名的常量**必须已删净**
    //     （⛔ 不留无人使用的清单 —— 空旋钮纪律）。
    {
      const wsSrc = (() => {
        try { return readFileSync(join(root, 'src', 'server', 'workspace-read.ts'), 'utf8') } catch { return null }
      })()
      if (wsSrc === null) {
        bad('⑤m-9 读不到 src/server/workspace-read.ts（类型面的唯一落点）⇒ 基准缺失，不按通过处理')
      } else {
        // ① 那本 22 个扩展名的常量**必须已删净**
        const staleConst = /export const TEXT_EXTENSIONS\b/.test(wsSrc)
        if (staleConst) {
          bad('⑤m-9 档3 的旧类型白名单 `TEXT_EXTENSIONS` **仍在**（第 145 轮用户裁定后应删净）'
            + '\n      ⇒ 档3 已改为"任意文件都可读"，留着一份无人使用的清单就是**空旋钮**'
            + '\n      ⇒ 删掉该常量，并核所有引用点（含工具描述里的 `${TEXT_EXTENSIONS.length}`）')
        } else {
          ok('⑤m-9a 旧类型白名单常量已删净（档3 不再有扩展名清单）')
        }

        // ② 档位 → 类型判定：档3 恒真、档2 只 .md（**从实现里读**，不内联）
        const fn = /export function isAllowedForLevel[\s\S]*?\n\}/.exec(wsSrc)
        if (fn === null) {
          bad('⑤m-9 找不到 isAllowedForLevel（档位 → 类型的唯一判定点）')
        } else {
          const body = fn[0]
          const projectOnlyMd = /level\s*===\s*'project'[\s\S]{0,120}?isMarkdownFile\(/.test(body)
          const workspaceAlways = /level\s*===\s*'workspace'[\s\S]{0,80}?return true/.test(body)
          const problems = []
          if (!projectOnlyMd) problems.push("档2 那支不再只认 .md（用户裁定「档2不给」「不可以读代码」）")
          if (!workspaceAlways) problems.push('档3 那支不再是无条件放行（用户裁定「档3的都加」）')
          if (problems.length > 0) {
            bad(`⑤m-9b 类型面与裁定不符：${problems.join('；')}`)
          } else {
            ok("⑤m-9b 类型面符合裁定（档2 只 .md · 档3 无条件放行 = 任意文件）")
          }
        }
      }
    }

    // ── ⑤m-8 哨兵形态：三条硬性（⛔ 裸哨兵会把账本与编排一起弄瘫）─────────
    //   ⚠ 这是**源码级**判据：只判形态，不判语义（语义判不稳）。
    //     三条：① 名单外 `return undefined` 出现在 `try` **之前**；
    //           ② 名单内判定体包在 `try/catch` 里且 catch **返回拒绝**；
    //           ③ 哨兵体内**无 `throw`**。
    {
      const gFn = /function installPermissionGuard[\s\S]*?\n\}/.exec(tierSrc)
      if (gFn === null) {
        bad('⑤m-8 找不到 installPermissionGuard（权限哨兵的落点）')
      } else {
        const body = gFn[0]
        const guardAt = body.indexOf('ctx.tools.guard(')
        const bodyInner = guardAt < 0 ? '' : body.slice(guardAt)
        const earlyOut = bodyInner.search(/if\s*\(\s*!guarded\.has\(name\)\s*\)\s*return undefined/)
        const tryAt = bodyInner.indexOf('try {')
        const catchAt = bodyInner.indexOf('catch')
        const throwInGuard = /\bthrow\b/.test(bodyInner.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))
        const problems = []
        if (bodyInner === '') problems.push('找不到 ctx.tools.guard(...) 调用')
        if (earlyOut < 0) problems.push('硬性① 不在：缺"名单外 return undefined"的按名短路')
        else if (tryAt >= 0 && earlyOut > tryAt) problems.push('硬性① 顺序错：按名短路出现在 try 之后（异常会罩到名单外）')
        if (tryAt < 0) problems.push('硬性② 不在：判定体没有 try')
        if (catchAt < 0) problems.push('硬性② 不在：没有 catch')
        if (throwInGuard) problems.push('硬性③ 被破：哨兵体内出现 throw（异常会让宿主 fail-closed ⇒ 连账本一起拒）')
        if (problems.length > 0) {
          bad(`⑤m-8 权限哨兵形态不合三条硬性：${problems.join('；')}`
            + '\n      ⇒ 实测反例：裸哨兵抛异常时 `read_contracts` **也被拒** ⇒ Hob 被弄瘫'
            + '\n      ⇒ 正确写法见 src/preset/tools.ts 的 installPermissionGuard 注释')
        } else {
          ok('⑤m-8 权限哨兵形态合规（① 按名短路在 try 之前 · ② 名单内 try/catch · ③ 体内无 throw）')
        }
      }
    }
  }
}

// ── P 组 2026-10-14（第 144 轮 · 两笔旧账的**防再漂判据**）─────────────────
//
// ⚠ **为什么需要它**（实测缺口，不是假想）──────────────────────────────
//   第 143 轮实测：真值 26，而**6 个"数字载体"**里 5 个写的不是 26
//   （`kit/README.md` 与 `preset-contracts.md` 写「30 名」、`src/preset/tools.ts`
//   的 JSDoc 写「25」与「恰好 30」、脚本内联清单是**同一名字集的第二副本**）。
//   ⚠ **它们全都没有任何判据盯着** ⇒ CHG-054 把 30 改成 26 时，这 5 处**没跟**、
//     也**没有任何红**。这正是"文档里的数字会静默变旧"那一族的实例。
//
// ── 判据口径 ─────────────────────────────────────────────────────────
//   P-1：文档 / 注释里**不得出现独立的名数**（`N 名` / `恰好 N`）——
//        名数**只允许**出现在源码的档位表本体附近，其余一律**口径式**
//        （写"以 check:presets 的判定为准"）。
//   P-2：名字清单**不得有第二个副本** —— 脚本里不许内联一份 26 名的字面量数组。
{
  // ── P-1：扫文档与注释里的独立名数 ────────────────────────────────────
  //   ⚠ 扫的对象：`.hob/**/*.md`（可复用层与人读版）、`src/**/*.ts`（源码注释）。
  //   ⚠ **不扫**本脚本自身：它作为**执行器**必须能写出那个数才能做判据
  //     （豁免是**在注释里写明**的，不是静默放过）。
  // ⚠ **声明的豁免（不是静默跳过）**：**历史记录**里的名数**不许改** ——
  //   它们记的是"当时是几名"，重写等于伪造历史（本项目对归档件的既定纪律）。
  //   ⇒ 豁免目录**逐个列出并写明理由**，新增豁免必须在这里显式登记。
  const P1_EXEMPT_DIRS = [
    // 经验库：条目记的是**当时**的读数（如"批 9 白名单从 11 名扩到 20 名"）。
    ['\.hob/experience/', '历史读数：记的是当时的名字数，重写即伪造历史'],
    // 归档件：同上（`.hob/archive/**` 是已封存的证据副本）。
    ['\.hob/archive/', '已封存证据副本：内容原样保留'],
    /**
     * ⚠⚠ **草案目录**（2026-10-21 · 第 337 轮 · 丙-8 扩面时暴露）：
     *   扩面后它一次命中 3 处（`contract-verification-notes.md:217`「51 个工具」·
     *   `nav-intake-draft.md:135/139`「5 个工具」）。
     *   ⚠ 这些是**草案的过程记录**（"当时写的是几个"），与"政策读数不许变旧"是两件事：
     *     草案**不面向用户**、也不被任何契约引用 ⇒ 重写它等于**伪造过程记录**。
     *   ⚠ 判据的价值在**面向用户的正文与面板**，⛔ 不在草案。
     */
    ['kit/drafts/', '草案过程记录：记的是当时的数，重写即伪造过程'],
    /**
     * ⚠⚠ **骨架模板**（2026-10-21 · 第 337 轮）：`kit/templates/**` 是**照模板起手**用的骨架，
     *   里面的名数**必须是占位形状**（`注册 = N 个`）—— ⚠ 把占位符改成一个具体数字
     *   等于**把本项目现状复制给新工作区**（那正是模板纪律明令禁止的）。
     *   ⇒ 本判据的能量花在**面向用户的正文 / 面板**上，⛔ 不咬模板。
     */
    ['kit/templates/', '骨架模板：名数必须是占位形状，改成具体数字即违反模板纪律'],
  ]
  const p1Exempt = (relPosix) => P1_EXEMPT_DIRS.some(([pre]) => relPosix.startsWith(pre.replace(/\\/g, '/').replace(/^\./, '.')))

  const P1_TARGETS = []
  const walkMd = (dir) => {
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) { walkMd(p); continue }
      if (e.name.endsWith('.md')) P1_TARGETS.push(p)
    }
  }
  walkMd(join(root, 'kit'))
  const walkTs = (dir) => {
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) { walkTs(p); continue }
      if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) P1_TARGETS.push(p)
    }
  }
  walkTs(join(root, 'src'))

  /**
   * ══════════════════════════════════════════════════════════════════════
   * ⚠⚠ **丙-7 / 丙-8（2026-10-21 · 第 337 轮）：`COUNT_RE` 的扫描面原来太窄**
   * ══════════════════════════════════════════════════════════════════════
   *
   * ── 改前只有一条 ──────────────────────────────────────────────────────
   *   `/(?:恰好\s*)?\*{0,2}(\d{1,3})\s*名\*{0,2}/g` —— **只认"数字 + `名` 紧邻"**。
   *   ⚠ 两个出口它都漏：
   *     · **丙-7**：写 `26 个显式名字` ⇒ 数字后面是「个」不是「名」⇒ **匹配不到**
   *       （而那句恰好写对了数，所以"漏"没暴露）；而加法链算到 30 也没人管。
   *     · **丙-8**：`settings-panel.tsx` 写 `共五个` / `five in total`
   *       ⇒ **中文数量词 + 英文数量词都不在扫描面里** ⇒ 加第 6 个开关时**静默变旧**。
   *
   * ── 现在：**三条窄正则**，各自只咬"数量词紧跟一个语义名词"的形状 ──────────
   *   ⚠ 设计原则是 **宁可漏一个真实例，也不许误伤普通数字** ——
   *     误伤会让这条判据变成噪音，然后被人关掉（那比漏更坏）。
   *   ① `NUM_ZH`：`N 名` / `N 个` + **紧跟**下面这组名词之一（`名字|模块|开关|工具|项`）。
   *      ⚠ **必须紧跟**：`3 个会话`/`20 次` 这类**不在**名词表里 ⇒ ⛔ 不咬；
   *      ⚠ 名词表**刻意短**：只列"数量会被政策锁死"的那几种。
   *   ② `NUM_EN`：英文**数词 → 名词**，且数词后必须紧跟名词
   *      （`five in total` / `four module switches`）——
   *      ⚠ ⛔ **不咬裸数字**（`30` / `26`）与**不带名词的数词**（`five` 单独出现）。
   *   ③ 保留原有的 `N 名`（`NUM_ZH` 已覆盖，⛔ 不重复保留一条）。
   *
   * ⚠ **为什么用 `\b` 与"紧跟"两个约束**：`\b` 防 `five` 咬到 `fivefold`；
   *   "紧跟"防 `five` 与后面的名词之间夹了别的词（如 `five rounds in total` —— 那是轮次，与本判据无关）。
   */
  /**
   * ⚠⚠ **名词表**：刻意**只收"数量会被政策锁死"的那几种**，且**必须紧跟**。
   *
   * ── 为什么把「项」删掉（第 337 轮实测教训）────────────────────────────
   *   加上「项」之后，P-1 一次扫出 **28 处** 命中 —— 而它们**绝大多数是本判据不该管的**：
   *   `.hob/EXPERIENCE.md:240`「39 项」（经验条目数）· `kit/drafts/…`「14 项」
   *   `.hob/README.md:385`「0 项」（文件数）· `kit/templates/CONTEXT.md:29`「1 项」…
   *   ⚠ 这些都是**普通统计**，与"工具/模块名数"无关 ⇒ 那正是作业书警告的
   *     "宽到会误伤普通数字" ⇒ 误伤会让这条判据变成噪音，然后被人关掉。
   *
   * ⇒ 现在只留三个**语义唯一**的名词：`名字` / `模块` / `开关`（+ 下面的 `工具` 组合形）。
   *   ⚠ `N 个工具` / `N 工具` 仍要咬（`src/preset/tools.ts:172` 那种正是政策读数），
   *     所以「工具」保留 —— 但要与"数字紧跟"配合，⛔ 不是单独出现就咬。
   */
  const P1_ZH_NOUNS = '名字|模块|开关|工具'
  /**
   * ⚠⚠ **三个额外约束，专治第 337 轮实测到的四类误伤** ────────────────────
   *   ① **数字前不许紧邻字母/数字**（`(?<![A-Za-z0-9])`）——
   *      否则 `M1 工具模块` 里那个 `1` 会被当成"1 工具"（那是**模块编号**，不是名数）。
   *   ② **数字不许是 `0`** —— `0 工具` 是"关掉之后没有工具"这个**状态读数**，
   *      与"清单里有几个名字"无关。
   *   ③ **数量词后面不许紧跟 `模块` 之外的限定** —— 这条由名词表本身保证。
   *
   * ⚠ 仍然**必须紧跟**：中间不许夹别的词（`3 个会话`/`20 次` 因此不咬）。
   */
  /**
   * ⚠⚠ **第 337 轮扩面时的第 5 类误伤：占位符 `N 个` / `<N> 个`** ─────────────
   *   现场：`kit/templates/CONTEXT.md:65` 写的是「### 0.3 工具面（本插件注册 = **N 个**）」——
   *   ⚠ 那是**模板占位符**（照模板起手的工作区该填自己的数），
   *     而正则把字母 `N` 当成了"数字前紧邻字母"的另一回事……
   *   ⚠ 实测：`(?<![A-Za-z0-9])` 挡不住它 —— 因为 `N` 与数字之间隔着 `= `，
   *     而数字组 `[1-9]\d{0,2}` 根本匹配不到 `N` ⇒ 命中的其实是**别的东西**。
   *   ⇒ 真正的成因：模板里那一行**下一条**的表头/内容里有 `3 工具` 之类。
   *   ⚠ 现在的处置：**模板目录整体豁免**（见 `P1_EXEMPT_DIRS`）——
   *     模板的用途正是"给新工作区当骨架"，它**必须是占位形状**，
   *     与"面向用户的政策读数"不是一回事。
   */
  /**
   * ⚠⚠ **修饰语窄扩**（2026-10-21 · 第 341 轮 · 丙-7 的欠账）：
   *   ⚠ 改前的形状是「数字 + `个?` + 名词」，中间**不许夹任何词** ⇒
   *     像 `26 个显式名字` 这种**数字后带修饰语**的写法**漏检**。
   *   ⇒ 现在在 `个?` 与名词之间允许**一个**来自**封闭白名单**的修饰语。
   *
   *   ⚠⛔ **必须是封闭白名单**，不许放开成任意词 —— 那会让它变成噪音然后被关掉：
   *     `显式` / `独立` / `具体` / `明文`（中文）· `explicit` / `distinct`（英文）。
   *   ⚠ 只允许**一个**修饰语（`{0,1}`，⛔ 不是 `*`）：允许多个就等于放开成"任意词串"。
   */
  const P1_ZH_MODS = '显式|独立|具体|明文'
  const P1_EN_MODS = 'explicit|distinct'
  const NUM_ZH = new RegExp(
    `(?<![A-Za-z0-9])(?:恰好\\s*)?\\*{0,2}([1-9]\\d{0,2})\\s*个?\\s*(?:${P1_ZH_MODS})?\\s*(?:${P1_ZH_NOUNS})`,
    'g',
  )
  /**
   * ⚠ 英文数词表**只收 0~20 与整十**（本判据关心的量级都在这里）。
   *   ⚠ `one` 刻意**不收**：`one module` / `one tool` 在正文里太常见且多为泛指，
   *     收进来会制造噪音。⚠ 若将来真出现"一个"这种政策读数，再单独加。
   */
  const EN_WORDS = 'two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|'
    + 'thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty'
  const P1_EN_NOUNS = 'modules?|switches|switch|tools?|names?|entries|items?'
  const NUM_EN = new RegExp(
    `\\b(${EN_WORDS})(?:\\s+(?:${P1_EN_MODS}\\s+)?(?:in\\s+total\\b|${P1_EN_NOUNS}\\b))`,
    'gi',
  )
  /** ⚠ 旧名保留（下方代码引用它），值改为"两条正则里任一条命中即算"。 */
  const COUNT_RE = NUM_ZH
  const p1Hits = []
  for (const f of P1_TARGETS) {
    const relPosix = relative(root, f).split(sep).join('/')
    if (p1Exempt(relPosix)) continue          // ⚠ 声明的豁免，见上（历史记录不许改）
    let src = null
    try { src = readFileSync(f, 'utf8') } catch { continue }
    const lines = src.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // ⚠ **豁免：口径式句**（它引用的不是"数"而是"以实测为准"）——
      //   判据是"是否写死了一个数"，故含"以 … 判定为准"/"以实测为准"的行不算。
      if (/以\s*「?`?check:presets`?」?\s*的?\s*(判定|实测)\s*为准/.test(line)) continue
      /**
       * ⚠ **两条正则都要跑**（丙-7 中文 / 丙-8 英文）——
       *   ⚠ 任一条命中即算"写死了一个数"。⚠ 分开跑而不是合成一条：
       *     合的写法会让"哪一条咬到"变得不可分辨，而这两条**覆盖的语言不同**，
       *     将来要单独放宽某一条时也改得动。
       */
      NUM_ZH.lastIndex = 0
      NUM_EN.lastIndex = 0
      const mZh = NUM_ZH.exec(line)
      const mEn = NUM_EN.exec(line)
      if (mZh !== null) p1Hits.push(`${relPosix}:${i + 1} —— 「${mZh[0].trim()}」（中文数量词）`)
      else if (mEn !== null) p1Hits.push(`${relPosix}:${i + 1} —— 「${mEn[0].trim()}」（英文数量词）`)
    }
  }
  if (p1Hits.length > 0) {
    bad(`P-1 文档 / 注释里仍有**独立名数**（${p1Hits.length} 处）：`
      + `\n      ${p1Hits.join('\n      ')}`
      + '\n      ⇒ 口径：名数**只在源码的档位表本体写一次**，文档一律**口径式**'
      + '\n        （"逐档名数以 check:presets 的判定为准"）—— 写死数会**静默变旧**')
  } else if (P1_TARGETS.length === 0) {
    /**
     * ══════════════════════════════════════════════════════════════════════
     * ⚠⚠ **乙-7（2026-10-21 · 第 331 轮）：`P-1` 扫到 0 份也打绿**
     * ══════════════════════════════════════════════════════════════════════
     *
     * ── 改前的病灶（`PROJECT-SURVEY-3` §6.2 乙-7）────────────────────────
     *   这一支（`else`）**无条件**打 ✓，文案里那句 `扫 ${P1_TARGETS.length} 份`
     *   在 0 份时就印成「扫 **0** 份 … 0 处独立名数」—— ⚠ **"一份都没扫"被印成"扫过且干净"**。
     *   ⚠ 而 `P-1` 是**契约漂移的主力判据**：它 0 份报绿，等于"主力判据可以整族不存在"
     *     而没有任何东西会响（本批最不能接受的那一格）。
     *
     * ── 现在：0 份 ⇒ **落 `bad`（`exit 1`）** ─────────────────────────────
     *   ⚠ TASK 让我二选一（`bad` / `exit 2`）。选 **`bad`** 的理由：
     *     `P1_TARGETS` 的取数面是**硬编码的两棵树**（`<root>/.hob/**` 与 `<root>/src/**`）
     *     —— 它们**在任何一次正常检出里都必然存在**。
     *     ⇒ ⚠ 0 份**不可能是"没有对象"**（不存在那种合法机器），只可能是
     *        **取数面塌了**（目录被移走 / 权限 / 路径算错 / 遍历函数坏了）
     *     ⇒ 那是**判据失效**，`1` 的语义（"查了、且有问题"）正好对上；
     *       ⛔ 而 `2`（"没有对象"）会把"判据坏了"说成"没东西可查"，让人不去修它。
     *   ⚠ ⛔ 也不许沉默：改前它**打了 ✓**，比沉默更坏（`E-126` 同族）。
     */
    bad(`P-1 【取数面塌了】**一份 .md / .ts 都没扫到** ⇒ 「文档不许写死名数」这一条**没查**`
      + '\n      ⇒ ⚠ 这不是"没有对象"：取数面是**硬编码的两棵树**'
      + '（`<root>/.hob/**` 与 `<root>/src/**`），正常检出里必然存在'
      + '\n      ⇒ 成因通常是：目录被移走 / 权限不足 / `walkMd`·`walkTs` 坏了 / 路径算错'
      + '\n      ⇒ ⚠ 改前这一档会打 ✓「0 处独立名数（扫 **0** 份）」—— **一份没扫被印成扫过且干净**')
  } else {
    ok(`P-1 文档 / 注释里 0 处独立名数（扫 ${P1_TARGETS.length} 份；豁免 ${P1_EXEMPT_DIRS.length} 类历史目录，理由见源码注释）`)
  }
  /**
   * ══════════════════════════════════════════════════════════════════════
   * ⚠⚠ **运行时的负向对拍**（2026-10-21 · 第 331 轮 · **乙-7** 要求 2）
   * ══════════════════════════════════════════════════════════════════════
   *
   * ── 改前：本族**一处运行时负向对拍都没有** ─────────────────────────────
   *   ⚠ 10 处"负向对拍"**全在注释里**（`grep -c 负向对拍` 命中注释，但**没有一处真跑**）。
   *   ⚠ 注释不是判据：它证明"当年作者想过"，⛔ 不证明"现在这条判据还长牙"。
   *     判据被改哑之后，注释仍在那几行、`check:presets` 仍全绿 —— 本项目最忌的形态。
   *
   * ── 现在补的：**摘掉 `P-1` 的咬合力 ⇒ 必须变红** ─────────────────────
   *   ⚠ 做法：`P-1` 的判定核心就是"`COUNT_RE` 命中即 `bad`"。
   *   本档用**同一个 `COUNT_RE`**（`new RegExp(COUNT_RE.source, COUNT_RE.flags)`，
   *   ⛔ 不复制字面量 —— 复制就脱离了被测物）跑两行**必然命中**的自造语料：
   *     · 咬合档：命中必须 **≥1**（否则扫描面/正则已废 ⇒ 红）；
   *     · 改哑档：换成**永不命中**的正则 ⇒ 必须 **0**（否则本档测不到显隐）。
   *
   * ⚠ **为什么在内存里造语料而不改仓文件**：改仓再还原正是"判据可能把自己写坏"的老病
   *   （本文件 `P-1` 上方那段 `nCompare` 注释里已有同样的教训）。
   * ⚠ **默认运行**（⛔ 不进任何开关分支）：耗时微秒级（两行字符串），没有理由默认不跑。
   */
  {
    /**
     * ⚠ 语料与真实文档**形状相同**（`恰好 6 名` / `**26 名**`），
     *   ⚠ **不带**任何豁免短语 ⇒ 保证必然命中，⛔ 不依赖盘上文件现状。
     */
    /**
     * ⚠ 语料必须命中**扩面后**的两条正则（丙-7 / 丙-8 各一）：
     *   ① 中文：`6 个工具`（旧正则只认 `N 名`，本条正是它漏掉的形状）；
     *   ② 英文：`five in total`（丙-8 的现场原文）。
     */
    const PROBE_BITE = '故意写死：6 个工具；另一处 five in total'
    /**
     * ⚠ **两条正则都要被反证到**（丙-7 中文 / 丙-8 英文）——
     *   只证一条的话，另一条被改哑也照样绿（而扩面的意义就是**两条都长牙**）。
     */
    const probeZh = new RegExp(NUM_ZH.source, NUM_ZH.flags)
    const probeEn = new RegExp(NUM_EN.source, NUM_EN.flags)
    const biteZh = [...PROBE_BITE.matchAll(probeZh)].length
    const biteEn = [...PROBE_BITE.matchAll(probeEn)].length
    const bite = biteZh + biteEn
    /** ⚠ **改哑**：永不命中的正则 —— 模拟"有人把 `COUNT_RE` 改成不咬"。 */
    const mutedRe = /(?!x)x/g
    const mutedHits = [...PROBE_BITE.matchAll(mutedRe)].length
    if (biteZh < 1 || biteEn < 1) {
      bad('P-1(反证) 【失去靶子】扩面后的两条正则**没有同时命中**'
        + `（中文 ${biteZh} 处 · 英文 ${biteEn} 处，各应 ≥1）⇒ 其中一条或扫描面已废`
        + '\n      ⇒ ⚠ 这条专治"判据被改成永远 0 处、永远绿"')
    } else if (mutedHits !== 0) {
      bad('P-1(反证) 【反证不成立】把正则改哑之后**仍然命中**'
        + `（${mutedHits} 处）⇒ 本档测不到"判据还咬不咬"这件事`)
    } else {
      ok(`P-1(反证) ✓ **负向对拍**：探针语料命中 **${bite}** 处；把正则改哑 ⇒ 命中 **${mutedHits}** 处`
        + ' ⇒ `P-1` 的分辨力真的接在那条正则上（⛔ 不是靠注释声称）')
    }
  }

  // ── P-2：名字清单**只有一个副本** ────────────────────────────────────
  //   判据：脚本里**不得**出现"26 个工具名的字面量数组"（第二副本）。
  //   ⚠ 可判的写法：找脚本里**连续 ≥ 10 个单引号名字**的数组字面量 ⇒ 那就是一份清单副本。
  //     （源码那份在 `src/preset/tools.ts`，不扫本脚本。）
  const selfSrc = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const inner = /\[\s*(?:'[a-z][a-z0-9_]*'\s*,\s*){9,}'[a-z][a-z0-9_]*'\s*\]/g
  const dup = [...selfSrc.matchAll(inner)].map((m) => m[0].replace(/\s+/g, ' ').slice(0, 120))
  if (dup.length > 0) {
    bad(`P-2 本脚本里仍有**名字清单的第二副本**（${dup.length} 处）：`
      + `\n      ${dup.join('\n      ')}`
      + '\n      ⇒ E-110：同一名字集的第二个副本改一处忘另一处 ⇒ 两边说法不同却不报错'
      + '\n      ⇒ 改为从 src/preset/tools.ts 的 PERMISSION_TIERS / MODEL_TOOL_ALLOWLIST 派生')
  } else {
    ok('P-2 本脚本内 0 处名字清单副本（判据一律从 src/preset/tools.ts 派生）')
  }
}

// ── ⑤o 2026-10-27（包 X · 方案 §4.1 / §3.5 / §5.8 三条 `🟡` 落进契约）────────────
//
// 为什么需要（本组存在的唯一理由，别删）：
//   方案 §4.1（默认动作 = 协商）、§3.5（事实性断言必须带来源）、§5.8（交付六字段）
//   在方案里都还是 `🟡`，**契约正文里一个字都没有** —— 也就是说这三条只有方案在说，
//   契约（宿主真正加载的那份）不生效。本批把它们逐字写进两份载体。
//
// ⚠ 本组与 `⑤` 的分工（⚠ 两条都要，⛔ 不许拿一条替另一条）：
//   · `⑤`  ：**两份载体一致**（防"改一边漏一边"）；
//   · `⑤o` ：**内容真的在位**（防"两份一起删" —— `⑤` 对那种形态是结构性盲区）。
//
// ⚠ 口径（防误读）：
//   · 钉的是**稳定短语**（首句 + 各档的关键词），⛔ 不钉整段逐字 —— 措辞可随文调整，
//     只要该语义还在，句子就还在；**这是新增断言，不是放宽**：任一条缺失即 FAIL。
//   · ⚠⚠ **不写"预期条数"**：下面按**缺项**判，⛔ 不设任何计数型期望值
//     （计数型期望会在条文增删时静默变旧 —— 本仓反复记过的形态）。
//   · 本段**就地追加**在 `## Running the loop` 既有段内（⛔ 不新起 `## ` 小节），
//     故本组同时负向钉"未起标题 / 上方非标题"两条形态。
{
  const hoBody10 = literalBlock(hoSrc, 'prefix') ?? ''
  const draftBody10 = draftBlock(0) ?? ''

  /**
   * ⚠ 三组稳定短语，**逐组独立判**（⛔ 不合并成一条"总字数在不在"）：
   *   分组的意义 = 缺哪一条当场点得出是哪一条，而不是笼统一句"契约缺条文"。
   */
  const CLAUSE_PINS = [
    ['§4.1 默认动作 = 协商方案', [
      'Default action is to agree the plan with the user',
      'Do not slide into implementation by default',
      'Only when the user plainly says',
      'does not count as saying so',
      'must point back to the user',
      'What counts as "plainly said"',
      'merely describing a phenomenon',
    ]],
    ['§3.5 事实性断言必须带来源', [
      'A factual claim carries its source',
      'which search, at what moment, from which source',
      '-- unverified',
      'it must never be written as a claim',
    ]],
    ['§5.8 交付六字段', [
      'A delivery carries its six fields of evidence',
      'Missing any one of them means it is not a delivery',
      'the conclusion',
      'the readings taken before starting',
      'what was not done or not verified',
      'open questions',
      'the evidence boundary',
    ]],
  ]

  // ── ① 正向：三组短语在**契约正文**里逐条在位 ──────────────────────────
  const missingInPreset = []
  for (const [label, pins] of CLAUSE_PINS) {
    for (const s of pins) if (!hoBody10.includes(s)) missingInPreset.push(`${label} → ${JSON.stringify(s)}`)
  }
  if (missingInPreset.length > 0) {
    bad(`⑤o ${NAME_HO}：契约正文缺这三条方案条文的稳定短语（${missingInPreset.length} 处）：`
      + `\n      ${missingInPreset.join('\n      ')}`
      + '\n      ⇒ 方案 §4.1 / §3.5 / §5.8 是 `🟡`，而契约一个字都没有 ⇒ 宿主加载的那份**不生效**')
  } else {
    ok(`⑤o ${NAME_HO}：三条方案条文（§4.1 协商 / §3.5 来源 / §5.8 六字段）的稳定短语**全部在位**`
      + `（${CLAUSE_PINS.length} 组 · 共 ${CLAUSE_PINS.reduce((n, [, p]) => n + p.length, 0)} 条短语）`)
  }

  // ── ② 两份载体**同一处**都要有（⛔ 不许只改机器读版）───────────────────
  const missingInDraft = []
  for (const [label, pins] of CLAUSE_PINS) {
    for (const s of pins) if (!draftBody10.includes(s)) missingInDraft.push(`${label} → ${JSON.stringify(s)}`)
  }
  if (missingInDraft.length > 0) {
    bad(`⑤o 人读版（.md）缺这三条条文的稳定短语（${missingInDraft.length} 处）：`
      + `\n      ${missingInDraft.join('\n      ')}`
      + '\n      ⇒ 人读版是"将来改动的地方"：它没有 ⇒ 下一个人改契约时看不到这三条')
  } else {
    ok('⑤o 人读版引文块同样含这三条条文的**全部**稳定短语（两份载体同一处，⛔ 不是只手改机器读版）')
  }

  // ── ③ 负向①：不得为这三条另起小节（与 ⑤e / ⑤g / ⑤k / ⑤l 同款）─────
  // ⚠ 2026-10-29（包 BT · CHG-175 §二）：原 ⑤o 的**5 条负向标题名禁令**
  //   （`## Default action` / `## Sources` / `## Evidence fields` /
  //   `## Delivery evidence` / `## Provenance`）已删除 —— 改由 ⑤q 的正向在册表守结构。
  //   ⚠ 下面「形态负向②」的结构检查**保留**。

  // ── ④ 形态负向②：首句所在行，向上第一条非空行不得是标题 ──────────────
  const clauseLines = hoBody10.split('\n')
  const firstPin = CLAUSE_PINS[0][1][0]
  const startLine = clauseLines.findIndex((l) => l.includes(firstPin))
  if (startLine >= 0) {
    let prevNonEmpty = null
    for (let i = startLine - 1; i >= 0; i--) {
      if (clauseLines[i].trim() === '') continue
      prevNonEmpty = clauseLines[i]
      break
    }
    if (prevNonEmpty === null) {
      bad('⑤o 三条条文上方找不到任何非空行（它必须是就地追加在既有段落内，不是段首）')
    } else if (/^#{1,6}\s/.test(prevNonEmpty.trim())) {
      bad(`⑤o 三条条文被顶上了一个新标题（上一非空行 = ${JSON.stringify(prevNonEmpty.trim().slice(0, 60))}）`
        + ' —— 本段须就地追加在既有段落内')
    } else {
      ok(`⑤o 三条条文上方是正文而非标题（上一非空行 = ${JSON.stringify(prevNonEmpty.trim().slice(0, 48))}…）`)
    }
  }

  // ── ⑤ KEPT：本次追加**不许挤掉**既有条文（与 ⑤g / ⑤i / ⑤k / ⑤l 同款）──
  const KEPT_BY_X = [
    ['先对照方案（既有句）', 'Start from the plan, every time.'],
    ['派出去指令的来源（既有句）', 'Take every directive from the plan'],
    ['决策自主（既有句）', 'Decide on your own.'],
    ['接住待决问题（既有句）', 'Catch the questions'],
    ['验收只认读数（既有句）', 'Accept on readings only'],
    ['投递 ≠ 执行（既有句）', 'Delivering is not doing'],
    ['职责边界块标题（既有块）', '### Your duty boundary'],
    ['原始读数纪律（既有句）', 'State nothing to the user without a reading behind it'],
    ['语言规则（既有节）', '### Language'],
  ]
  const squeezedByX = KEPT_BY_X.filter(([, s]) => !hoBody10.includes(s))
  if (squeezedByX.length > 0) {
    bad(`⑤o ${NAME_HO}：三条条文的追加**挤掉了既有条文**（${squeezedByX.length} 处）：`
      + `${squeezedByX.map(([l]) => l).join(' / ')} —— 本批只许追加，不许顶掉既有的`)
  } else ok(`⑤o ${NAME_HO}：既有 ${KEPT_BY_X.length} 组条文逐字保留（三条条文的追加未挤掉任何一条）`)
}

// ── ⑤p 2026-10-27（包 AB 追加段）· **何时才允许拿问题打扰用户** ────────────────
//
// 为什么需要（本组存在的唯一理由，别删）：
//   用户原话：「现在契约里**没有这一条**，所以我会问一些本不该问的（比如"先做 A 还是先做 B"）。」
//   ⇒ 契约此前只有"**ask sparingly**"（少问）与"**ask only what genuinely belongs to the user**"
//     （只问真正属于用户的事）—— 那两句**只给了方向**，⛔ 没有给**可判的准入清单**，
//     于是"先做 A 还是先做 B"这种**依赖已经决定的顺序**被当成"该问的事"。
//   ⇒ 本组把四条准入 + 六条禁问 + 一条格式钉成可判的断言。
//
// ⚠ 本组与 `⑤` 的分工（⚠ 两条都要，⛔ 不许拿一条替另一条）：
//   · `⑤`  ：**两面一致**（防"改一边漏一边"）；
//   · `⑤p` ：**内容真的在位**（防"两面一起删" —— `⑤` 对那种形态是结构性盲区）。
//
// ⚠ 口径（防误读）：
//   · 钉的是**稳定短语**（逐条准入的**关键前提词**），⛔ 不钉整段逐字 ——
//     ⚠ 但本段的**完整原文**另有 `⑤` 把两面钉死（两面必须相同），故此处只需保证"这一条还在"。
//   · ⚠⚠ **不写"预期条数"**：按**缺项**判，⛔ 不设计数型期望（计数会在条文增删时静默变旧）。
//   · 本段**就地追加**在 `## Running the loop` 既有段内（⛔ 不新起 `## ` 小节）。
{
  const hoBody11 = literalBlock(hoSrc, 'prefix') ?? ''
  const draftBody11 = draftBlock(0) ?? ''

  /**
   * ⚠ 三组短语，**逐组独立判**（⛔ 不合并成一句"总字数在不在"）：
   *   分组的意义 = 缺哪一条当场点得出是哪一条。
   */
  const ASK_PINS = [
    ['总纲：只在四种情形之一才问', [
      'Ask the user only when one of these is true',
      'otherwise decide and move on',
    ]],
    ['准入 ① 不可逆 / 难撤回', [
      'The action is irreversible or hard to undo',
      'deleting data, overwriting',
      'changing something already promised',
    ]],
    ['准入 ② 影响面离开本项目', [
      'The blast radius leaves this project',
      'permissions and allowlists, other',
      'the real profile, anything published',
    ]],
    ['准入 ③ 花用户的钱 / 只有他能做', [
      "It spends the user's resources and only they can do it",
      'money, restarting',
      'their attention for a check',
    ]],
    ['准入 ④ 产品决策', [
      'It is a product decision',
      'what to build, what cost to accept, where the',
      'two acceptable paths that differ only in trade-off',
    ]],
    ['禁问六类', [
      'Never ask about: the order of work that dependencies already decide',
      'how to',
      'implement something, naming and file placement, technology choices inside the',
      'or whether to do something this plan already requires',
    ]],
    ['难度不是判据', [
      'Difficulty is not a criterion',
      'A hard but reversible choice is yours to make',
    ]],
    ['问法五要素', [
      'When you do ask, the ask must name: the blocked action, the evidence, the',
      'options, what each costs, and your recommendation',
    ]],
  ]

  // ── ① 正向：八组短语在**契约正文**里逐条在位 ──────────────────────────
  const missingInPreset = []
  for (const [label, pins] of ASK_PINS) {
    for (const s of pins) if (!hoBody11.includes(s)) missingInPreset.push(`${label} → ${JSON.stringify(s)}`)
  }
  if (missingInPreset.length > 0) {
    bad(`⑤p ${NAME_HO}：契约正文缺「何时才允许问用户」这一条（${missingInPreset.length} 处）：`
      + `\n      ${missingInPreset.join('\n      ')}`
      + '\n      ⇒ ⚠ 缺了它，"先做 A 还是先做 B"这种**依赖已决定的顺序**会被当成该问的事')
  } else {
    ok(`⑤p ${NAME_HO}：**何时才允许问用户**一条全部在位`
      + `（${ASK_PINS.length} 组 · 共 ${ASK_PINS.reduce((n, [, p]) => n + p.length, 0)} 条短语：`
      + '四条准入 + 六类禁问 + 难度非判据 + 问法五要素）')
  }

  // ── ② 两面同一处都要有（⛔ 不许只改机器读版）───────────────────────────
  const missingInDraft = []
  for (const [label, pins] of ASK_PINS) {
    for (const s of pins) if (!draftBody11.includes(s)) missingInDraft.push(`${label} → ${JSON.stringify(s)}`)
  }
  if (missingInDraft.length > 0) {
    bad(`⑤p 人读版（.md）缺这一条的稳定短语（${missingInDraft.length} 处）：`
      + `\n      ${missingInDraft.join('\n      ')}`
      + '\n      ⇒ 人读版是"将来改动的地方"：它没有 ⇒ 下一个人改契约时看不到这一条')
  } else {
    ok('⑤p 人读版引文块同样含这一条的**全部**稳定短语（两面同一处，⛔ 不是只手改机器读版）')
  }

  // ── ③ 负向①：不得为这一条另起小节（与 ⑤e/⑤g/⑤k/⑤l/⑤o 同款）────────
  // ⚠ 2026-10-29（包 BT · CHG-175 §二）：原 ⑤p 的**4 条负向标题名禁令**
  //   （`## When to ask` / `## Asking the user` / `## Questions` / `## Ask policy`）
  //   已删除 —— 改由 ⑤q 的正向在册表守结构。⚠ 下面「形态负向②」的结构检查**保留**。

  // ── ④ 形态负向②：首句所在行，向上第一条非空行不得是标题 ──────────────
  const askLines = hoBody11.split('\n')
  const firstAskPin = ASK_PINS[0][1][0]
  const askStart = askLines.findIndex((l) => l.includes(firstAskPin))
  if (askStart >= 0) {
    let prevNonEmpty = null
    for (let i = askStart - 1; i >= 0; i--) {
      if (askLines[i].trim() === '') continue
      prevNonEmpty = askLines[i]
      break
    }
    if (prevNonEmpty === null) {
      bad('⑤p 这一条上方找不到任何非空行（必须是就地追加在既有段落内，不是段首）')
    } else if (/^#{1,6}\s/.test(prevNonEmpty.trim())) {
      bad(`⑤p 这一条被顶上了一个新标题（上一非空行 = ${JSON.stringify(prevNonEmpty.trim().slice(0, 60))}）`)
    } else {
      ok(`⑤p 这一条上方是正文而非标题（上一非空行 = ${JSON.stringify(prevNonEmpty.trim().slice(0, 48))}…）`)
    }
  }

  // ── ⑤ KEPT：本次追加**不许挤掉**既有条文（与 ⑤g/⑤i/⑤k/⑤l/⑤o 同款）──
  const KEPT_BY_AB = [
    ['先对照方案（既有句）', 'Start from the plan, every time.'],
    ['决策自主（既有句）', 'Decide on your own.'],
    ['「少问」既有句', 'And ask sparingly'],
    ['「只问真正属于用户的」既有句', 'Ask only what genuinely belongs to the user'],
    ['「自己判得了就不停」既有句', 'Never stop for what you can judge yourself.'],
    ['派出去指令的来源（既有句）', 'Take every directive from the plan'],
    ['接住待决问题（既有句）', 'Catch the questions'],
    ['验收只认读数（既有句）', 'Accept on readings only'],
    ['投递 ≠ 执行（既有句）', 'Delivering is not doing'],
    ['职责边界块标题（既有块）', '### Your duty boundary'],
    ['语言规则（既有节）', '### Language'],
  ]
  const squeezedByAB = KEPT_BY_AB.filter(([, s]) => !hoBody11.includes(s))
  if (squeezedByAB.length > 0) {
    bad(`⑤p ${NAME_HO}：本段追加**挤掉了既有条文**（${squeezedByAB.length} 处）：`
      + `${squeezedByAB.map(([l]) => l).join(' / ')} —— 本批只许追加，不许顶掉既有的`)
  } else ok(`⑤p ${NAME_HO}：既有 ${KEPT_BY_AB.length} 组条文逐字保留（本段追加未挤掉任何一条）`)
}

// ── ⑤n 移交出去的核查记录必须「有人管」（2026-10-18 · UD-144 裁定三）──────
//
// 为什么需要（用户原话，逐字）：
//   「移出去的文件必须**有人管** —— 搬出去的那份 `contract-verification-notes.md`
//    从此不在机检范围内，**它漂了没人知道**。」
//
// ⇒ 判据两条，缺一即 FAIL（⛔ 不是"警告"，是 FAIL）：
//   ① **契约人读版**里必须有一行指针，点名那个文件、并写明"那份不是规范"；
//   ② **被点名的文件必须真实存在**，且**确实含有被移出的那几节**（防止"指针在、文件空了"
//      这种最坏的形态：指针让人以为有记录，打开什么都没有）。
//
// ⚠ 本组是**新增断言，不是放宽** —— 它让一份原本零覆盖的文件进入机检面。
// ⚠ 判据不钉具体行号、不钉字数（那会随搬移漂）；只钉"指针在 + 文件在 + 三节标题在"。
{
  const NOTES_REL = 'kit/drafts/contract-verification-notes.md'
  const notesAbs = join(root, NOTES_REL)

  // ① 指针行：人读版里必须同时出现"文件名"与"不是规范"这个断言
  const hasPointer = draftSrc.includes('contract-verification-notes.md')
  const saysNotSpec = /不是规范|⛔ 不要当规则|不要当规范/.test(draftSrc)
  if (!hasPointer) {
    bad(`⑤n ${NAME_HO}：人读版里**没有指向核查记录文件**的指针（期望提到 ${JSON.stringify(NOTES_REL)}）`
      + '\n      ⇒ 移出去的记录从此无人指向 ⇒ 等于藏起来，没人会读到它')
  } else if (!saysNotSpec) {
    bad(`⑤n ${NAME_HO}：指针在位，但**没有写明"那份不是规范"**`
      + '\n      ⇒ 缺这句，读的人会把历史读数当成现行规则')
  } else {
    ok(`⑤n ${NAME_HO}：人读版有指针指向核查记录，且写明"不是规范"`)
  }

  // ② 目标文件存在 + 含被移出的三节
  if (!existsSync(notesAbs)) {
    bad(`⑤n **被点名的核查记录文件不存在**：${NOTES_REL}`
      + '\n      ⇒ 指针指着空处，比没有指针更糟（读者以为有记录）')
  } else {
    let notesSrc = ''
    try { notesSrc = readFileSync(notesAbs, 'utf8') } catch { notesSrc = '' }
    if (notesSrc === '') {
      bad(`⑤n 核查记录文件读不到内容：${NOTES_REL}`)
    } else {
      // 三节标题必须在位（它们是"只搬不删"的可判证据）
      const NEEDED_SECTIONS = ['## 三、一致性核对', '## 四、', '## 五、']
      const missing = NEEDED_SECTIONS.filter((h) => !notesSrc.includes(h))
      if (missing.length > 0) {
        bad(`⑤n 核查记录**缺被移出的节**（${missing.length} 节）：${missing.join(' / ')}`
          + '\n      ⇒ 裁定三要求「只搬不删」，缺节说明搬的过程中丢了内容')
      } else {
        ok(`⑤n 核查记录在位且三节齐备（${NOTES_REL}，${Buffer.byteLength(notesSrc, 'utf8')} 字节）`)
      }
      // 头部声明也必须在（这是"不是规范"的落点，⛔ 不许只有正文没有声明）
      if (!/不是规范/.test(notesSrc)) {
        bad('⑤n 核查记录**文件头缺"不是规范"声明** ⇒ 打开它的人会把它当规范读')
      } else {
        ok('⑤n 核查记录文件头有"不是规范"声明')
      }
    }
  }
}

// ── ⑤q 2026-10-29（包 BT · `CHG-175` §二）· **W1 正向在册表** ──────────────
//
// 背景：原先 W1 靠 **21 条负向禁令**守"不许起用某标题名"。`CHG-175` §二 已判：
//   **换个名字就过 —— 那叫防名字，不叫防结构**。故本组改为**正向在册表**：
//   只声明"W1 下必须有这 7 个小节、一个不多一个不少、名字逐字相符"。
// ⚠ 本组是**唯一**守 W1 标题形态的断言；21 条负向禁令已全部删除（逐条登记见 REPORT.md）。
{
  const hoBodyW1 = literalBlock(hoSrc, 'prefix') ?? ''
  // 正向在册表：W1 的三级小节名，**顺序即契约顺序**
  /**
   * ⚠⚠ **2026-10-31 P39：7 → 10**（`TASK-P39.md` §三①）。
   *   新增三节 `Defect report` / `Investigation` / `Resume` 接在原文七节之后
   *   （`workflow.toml` 里 `order` = 147/148/149 —— 没有原文位置，只决定渲染次序）。
   *   ⚠ 这是**换对象 + 加严**，⛔ 不是放宽：本表仍是"一个不多一个不少、名字逐字相符、顺序即契约"，
   *     多一节 / 少一节 / 换序照样红。⛔ 不许改成"至少 7 个"或"含这 7 个即可"
   *     （那会让新增节悄悄变回"不存在"）。
   */
  const W1_ROSTER = [
    'New instruction',
    'Verdict on the work',
    'Stop',
    'Question turn',
    'Ruling',
    'No answer',
    'Correction',
    'Defect report',
    'Investigation',
    'Resume',
  ]
  const lines = hoBodyW1.split('\n')
  // 取 W1 段：从 `## Taking input` 到下一个 `## ` 之前
  const w1Start = lines.findIndex((l) => l.trim() === '## Taking input')
  let w1End = lines.length
  for (let i = w1Start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) { w1End = i; break }
  }
  if (w1Start < 0) {
    bad(`⑤q ${NAME_HO}：找不到 \`## Taking input\` 段 —— W1 正向在册表无法核对`)
  } else {
    const w1 = lines.slice(w1Start, w1End)
    // 恰好这些 `###` 标题（一个不多一个不少）
    const got = w1.filter((l) => /^###\s/.test(l)).map((l) => l.replace(/^###\s+/, '').trim())
    const want = W1_ROSTER.slice()
    const same = got.length === want.length && got.every((v, i) => v === want[i])
    if (!same) {
      bad(`⑤q ${NAME_HO}：W1 下的三级小节与正向在册表不符`
        + `\n     ⇒ 应为（${want.length} 个，按序）：${want.join(' / ')}`
        + `\n     ⇒ 实为（${got.length} 个）：${got.join(' / ') || '（无）'}`)
    } else {
      ok(`⑤q ${NAME_HO}：W1 下恰好 ${want.length} 个三级小节，名字逐字相符（${want.join(' / ')}）`)
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

// ── ⑦ 2026-10-10（第 9 轮 · 用户裁定）· 规划侧预设**不作「新建会话默认」候选** ──
//
// 用户原话：「新建预设的选项不应该有 hob 模式了吧 …… hob 本身没有施工能力，这不是死循环了吗」
// 理由：该预设无 bash/pwsh、白名单无 write/edit，契约原文
//   *"You never carry out the work itself … you cannot edit code, you cannot run a command."*
//   ⇒ 拿它当新会话默认 ⇒ 新会话只能再规划 = **死循环**。
//
// ⚠ **口径（不钉整句，只钉可判的四件事）**：
//   ① **唯一值**：排除用的 id 在**全仓只有一处字面值**（`src/shared/planning-preset.ts`）；
//   ② **逐字交叉核对**：该常量必须与预设声明（`HO` 的 `config.id`）**逐字一致**
//      —— 将来预设改名而常量没跟上 ⇒ 这里 **FAIL**（本组存在的核心理由）；
//   ③ **两个消费方都只用常量、不另写字面量**：client 侧 `catalog.ts` 排除候选、
//      host 侧 `bus.ts` 的 spawn 兜底（且**只作用于配置默认值**，显式传参不受影响）；
//   ④ **不许静默过滤**：`catalog.ts` 必须把被排除项**带出来**（`excludedPresets`），
//      面板必须有**可见说明**（词典键 `note.excluded` 真的被渲染）。
{
  const sharedPath = join(root, 'src', 'shared', 'planning-preset.ts')
  const hoPath = join(root, 'preset', 'dsh-hob', 'preset-dsh-hob.patch.yml')
  const busPath7 = join(root, 'src', 'modules', 'bus.ts')
  const catalogPath7 = join(root, 'src', 'client', 'catalog.ts')
  const panelPath7 = join(root, 'src', 'client', 'settings-panel.tsx')
  const read7 = (p) => { try { return readFileSync(p, 'utf8') } catch { return undefined } }

  const sharedSrc7 = read7(sharedPath)
  const hoSrc7 = read7(hoPath)
  const busSrc7 = read7(busPath7)
  const catalogSrc7 = read7(catalogPath7)
  const panelSrc7 = read7(panelPath7)

  if (sharedSrc7 === undefined) {
    bad('⑦ 读不到 src/shared/planning-preset.ts —— 「不作候选的预设 id」的唯一值来源不在，'
      + '本组无从判定（**不按通过处理**）')
  } else {
    // ── ① 常量值（**原始态取字面量**；本文件其它组同款口径）────────────────
    const m7 = /export\s+const\s+HOB_PRESET_ID\s*=\s*'([^']*)'/.exec(sharedSrc7)
      ?? /export\s+const\s+HOB_PRESET_ID\s*=\s*"([^"]*)"/.exec(sharedSrc7)
    if (m7 === null) {
      bad("⑦ src/shared/planning-preset.ts 里找不到 `export const HOB_PRESET_ID = '…'`"
        + ' —— 唯一值不见了（两个消费方会各自硬编码，漂移无从发现）')
    } else {
      const excludedId = m7[1]

      // ── ② 与预设声明**逐字交叉核对**（本组核心）────────────────────────
      if (hoSrc7 === undefined) {
        bad('⑦ 读不到预设声明 preset-dsh-hob.patch.yml —— 逐字核对无从进行（不按通过处理）')
      } else {
        // 取 `config:` 块下第一处 `id:`（缩进 8 空格 = preset 条目的 config.id）
        const declared7 = /^\s{8}id:\s*(\S+)\s*$/m.exec(hoSrc7)
        if (declared7 === null) {
          bad('⑦ 从预设声明里读不到 `config.id`（解析口径可能已漂 ⇒ 不按通过处理）')
        } else if (declared7[1] !== excludedId) {
          bad(`⑦ **漂移**：排除常量 HOB_PRESET_ID = ${JSON.stringify(excludedId)}，`
            + `而预设声明的 config.id = ${JSON.stringify(declared7[1])}`
            + ' —— 预设改名后必须同步改这一个常量（不一致 ⇒ 排除失效或排错东西）')
        } else {
          ok(`⑦ ✓ 排除常量与预设声明逐字一致（config.id = ${JSON.stringify(excludedId)}）`)
        }
      }

      // ── ①b **全仓只有一处字面值**（防"两个消费方各写一份"漂移）──────────
      {
        const offenders = []
        const walk7 = (dir) => {
          for (const e of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, e.name)
            if (e.isDirectory()) { walk7(full); continue }
            if (!/\.tsx?$/.test(e.name)) continue
            if (full === sharedPath) continue
            const stripped = stripCommentsOnlyLocal(readFileSync(full, 'utf8'))
            // 只看"把它当值用"的两种形态（注释里写作说明允许，故先剥离）
            if (new RegExp(`=\\s*'${excludedId}'`).test(stripped)
              || new RegExp(`===\\s*'${excludedId}'`).test(stripped)) {
              offenders.push(full.slice(root.length + 1))
            }
          }
        }
        try {
          walk7(join(root, 'src'))
        } catch (e) {
          bad(`⑦ 遍历 src/ 失败（${String(e?.message ?? e)}）⇒ 唯一性无从判定，不按通过处理`)
        }
        if (offenders.length > 0) {
          bad(`⑦ 排除用的 id 字面值**不止一处**（另有 ${offenders.join(' / ')}）—— `
            + '两个消费方必须都 import `src/shared/planning-preset.ts`，否则改名时必漏一处')
        } else {
          ok('⑦ ✓ 该 id 的字面值全仓只有一处（两个消费方都 import 同一常量）')
        }
      }

      // ── ③ client 侧：排除**真的发生了**，且**不是静默** ──────────────────
      //   ⚠⚠ 判据必须**钉住"比较发生了"**，不能只钉"常量被提到了"
      //     （第 9 轮负向对拍当场抓到的真缺口：只判 `/PLANNING_PRESET_ID/` 时，
      //      把 `mapped.filter(p => p.id === PLANNING_PRESET_ID)` 换成 `[]`
      //      ——常量仍"被提到"（`void PLANNING_PRESET_ID`）⇒ **假通过**）。
      //   ⇒ 必须看到 `.id === PLANNING_PRESET_ID`（排除项）**与**
      //     `.id !== PLANNING_PRESET_ID`（可选集）这**一对**比较。
      if (catalogSrc7 === undefined) {
        bad('⑦ 读不到 src/client/catalog.ts —— client 侧排除判据无从核对')
      } else {
        const catalogCode7 = stripCommentsOnlyLocal(catalogSrc7)
        const hasEq = /\.id\s*===\s*HOB_PRESET_ID/.test(catalogCode7)
        const hasNe = /\.id\s*!==\s*HOB_PRESET_ID/.test(catalogCode7)
        if (!hasEq || !hasNe) {
          bad('⑦ catalog.ts 里没有**真的做排除比较**'
            + `（${hasEq ? '' : '缺 `.id === HOB_PRESET_ID`' }`
            + `${!hasEq && !hasNe ? ' 且 ' : ''}${hasNe ? '' : '缺 `.id !== HOB_PRESET_ID`'}）`
            + ' —— 只提到常量不算排除生效；候选会照旧列出规划侧预设（死循环）')
        } else ok('⑦ ✓ catalog.ts 真的做了排除比较（`===` 收被排除项 / `!==` 收可选集）')
        if (!/excludedPresets/.test(catalogSrc7)) {
          bad('⑦ catalog.ts 里找不到 `excludedPresets` —— 排除成了**静默过滤**'
            + '（E-46 的教训：用户会以为那个预设根本不存在）')
        } else ok('⑦ ✓ 被排除项原样收进 `excludedPresets`（不静默丢弃）')
      }

      // ── ③b 面板有**可见说明**（词典键 `note.excluded` 真的被渲染）────────
      if (panelSrc7 === undefined) {
        bad('⑦ 读不到 src/client/settings-panel.tsx —— 「可见说明」判据无从核对')
      } else if (!/t\(\s*'note\.excluded'/.test(panelSrc7)) {
        bad("⑦ 面板没有渲染 `t('note.excluded')` —— 排除没有**可见说明**"
          + '（用户拉开下拉看不见它会莫名其妙）')
      } else ok("⑦ ✓ 面板渲染 `t('note.excluded')`（排除了什么是可见的）")

      // ── ④ host 侧：spawn 兜底**只作用于默认值**，且不静默 ────────────────
      if (busSrc7 === undefined) {
        bad('⑦ 读不到 src/modules/bus.ts —— spawn 兜底判据无从核对')
      } else {
        if (!/HOB_PRESET_ID/.test(busSrc7)) {
          bad('⑦ bus.ts 没有引用 HOB_PRESET_ID —— 派活侧没有兜底'
            + '（配了规划侧预设就照套 ⇒ 死循环）')
        } else ok('⑦ ✓ bus.ts 的 spawn 经 HOB_PRESET_ID 做兜底')
        if (!/explicitPreset\s*\?\?\s*\(/.test(busSrc7)) {
          bad('⑦ 找不到 `explicitPreset ?? (…)` 的优先级链 —— 显式传参可能被兜底覆盖'
            + '（那是调用方的明确选择，**不许**拦）')
        } else ok('⑦ ✓ 优先级链仍是 `explicitPreset ?? (兜底后的默认值)`（显式传参不受影响）')
        // ⚠ 判据必须**钉住"真的算出一句说明"**，不能只钉"`presetNote` 这个词出现过"
        //   （第 9 轮负向对拍当场抓到的第二个真缺口：只判 `/presetNote/` 时，
        //    把赋值改成 `const presetNote = undefined` 仍 **PASS** ——
        //    因为**返回对象里的透传那一行**也叫 presetNote）。
        //   ⇒ 必须看到 `presetNote = <非 undefined 的表达式>` **起始**。
        //   ⚠ 写法上要**先把空白吃掉再取首字符**：写成 `=\s*(?!undefined)` 时
        //     `\s*` 可以**回溯**到零长度，于是断言落在空格上 ⇒ 恒真（本轮实测）。
        //   ⚠ 第 10 轮订正：声明从 `const` 变成 `let`（兜底分支要**再赋值**），
        //     故接受 `const|let` —— 这**不是放宽**：判据仍是"首次赋值给了非 undefined
        //     的表达式"（强度不变，只是跟上合法的代码形态）。兜底分支那几笔
        //     **另由 ⑧(e) 钉住**（它要求出现 `presetNote = '<非空>'` 的直接赋值）。
        const noteAssign = /(?:const|let)\s+presetNote\s*=\s*(\S[^\n]*)/.exec(stripCommentsOnlyLocal(busSrc7))
        if (noteAssign === null || noteAssign[1].startsWith('undefined')) {
          bad('⑦ bus.ts 里没有真的算出兜底说明（缺 `presetNote = <表达式>`）—— '
            + '兜底发生了却不说明（与 `modelNote` 同款纪律：少做了一件事必须说出来）')
        } else ok('⑦ ✓ 兜底在成功返回里如实带一句（`presetNote` 有实际内容，不静默）')
      }
    }
  }
}

// ── ⑧ 2026-10-10（**第 11 轮重写** · 用户裁定）· 出厂默认即标准模式，不要「宿主默认预设」──
//
// 用户原话：「说了出厂默认设置成标准模式 …… 不要宿主默认预设，直接按我说的改」。
// ⇒ **第 10 轮的 ⑧ 组整块重写**。它的**对象已被用户裁定删除**（那个选项本身没了），
//   旧断言（"要解析宿主有效默认 + 要可见警告"）继续留着就会**逼着代码把删掉的东西加回来**
//   —— 那不是"守语义"，是**守一个已被否决的设计**。
// ⚠ **这不算放宽**：旧组有 4 条判据依赖的对象（`readHostDefaultPresetId` / 解析显示 /
//   警告）在需求层面被删了；新组换了**更强的对象**（"删干净" + "空值同源" + "零 markdown"）,
//   并把旧组里**仍然成立**的那几条**原样保留**（出厂默认单源、不相等、在册校验、不静默、
//   分支可达不拦显式传参）。
//
// ⚠ **口径（只钉可判的事）**：
//   ① 出厂默认 id **单源**（`src/shared/planning-preset.ts` 的 `FACTORY_DEFAULT_PRESET_ID`），
//      且与规划侧常量**不是同一个值**（相等 ⇒ 语义塌成"用规划侧当出厂默认"，荒谬）；
//   ② **删干净**：面板**不得**再有那个选项、那段警告、以及它们的**词典键**
//      （键名与代码都不得残留 —— 留着死键会让下一个人以为它还在用）；
//   ③ **空值 == 出厂默认，且显示与派活同源**：两边都用 `FACTORY_DEFAULT_PRESET_ID`
//      （不是各写一个 `'standard'`）；派活侧**不再读宿主有效默认**（那条链已删）；
//   ④ **在册校验仍在**：出厂默认不在名册 ⇒ 退回不指定 + 如实说明（不许 spawn 失败、不许静默）；
//   ⑤ 词典里**零 markdown 标记**（`**` / 反引号 / `__`）—— 用户可见文案里的强调标记
//      会被**字面渲染**成星号（用户截图里就是 `它**不会被采用**`）。
{
  const sharedPath8 = join(root, 'src', 'shared', 'planning-preset.ts')
  const busPath8 = join(root, 'src', 'modules', 'bus.ts')
  const panelPath8 = join(root, 'src', 'client', 'settings-panel.tsx')
  const read8 = (p) => { try { return readFileSync(p, 'utf8') } catch { return undefined } }
  const sharedSrc8 = read8(sharedPath8)
  const busSrc8Raw = read8(busPath8)
  const panelSrc8 = read8(panelPath8)

  if (sharedSrc8 === undefined) {
    bad('⑧ 读不到 src/shared/planning-preset.ts —— 出厂默认常量无从核对（不按通过处理）')
  } else {
    const mPlan = /export\s+const\s+HOB_PRESET_ID\s*=\s*'([^']*)'/.exec(sharedSrc8)
    const mFactory = /export\s+const\s+FACTORY_DEFAULT_PRESET_ID\s*=\s*'([^']*)'/.exec(sharedSrc8)
    if (mFactory === null) {
      bad("⑧ src/shared/planning-preset.ts 里找不到 `export const FACTORY_DEFAULT_PRESET_ID = '…'`"
        + ' —— 出厂默认 id 没有单源（会被各处硬编码，改不动）')
    } else if (mPlan === null) {
      bad('⑧ 读不到 HOB_PRESET_ID —— 两个常量的"不相等"判据无从核对（不按通过处理）')
    } else if (mPlan[1] === mFactory[1]) {
      bad(`⑧ 出厂默认常量与规划侧常量**是同一个值**（都是 ${JSON.stringify(mFactory[1])}）—— `
        + '那等于"出厂默认就是规划侧预设"，与本轮需求（出厂默认 = 标准模式）**直接矛盾**')
    } else {
      ok(`⑧ ✓ 出厂默认 ${JSON.stringify(mFactory[1])} 与规划侧 ${JSON.stringify(mPlan[1])} 是两个值`)
      // ① 单源：该字面值在 src/** 里只有一处（复用 ⑦ 的"只剥注释"剥离器）
      {
        const offenders8 = []
        const walk8 = (dir) => {
          for (const e of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, e.name)
            if (e.isDirectory()) { walk8(full); continue }
            if (!/\.tsx?$/.test(e.name)) continue
            if (full === sharedPath8) continue
            const stripped = stripCommentsOnlyLocal(readFileSync(full, 'utf8'))
            if (new RegExp(`=\\s*'${mFactory[1]}'`).test(stripped)
              || new RegExp(`===\\s*'${mFactory[1]}'`).test(stripped)) {
              offenders8.push(full.slice(root.length + 1))
            }
          }
        }
        try { walk8(join(root, 'src')) } catch (e) {
          bad(`⑧ 遍历 src/ 失败（${String(e?.message ?? e)}）⇒ 单源无从判定，不按通过处理`)
        }
        if (offenders8.length > 0) {
          bad(`⑧ 出厂默认 id 的字面值**不止一处**（另有 ${offenders8.join(' / ')}）—— 必须都 import 同一常量`)
        } else ok('⑧ ✓ 出厂默认 id 的字面值全仓只有一处')
      }

      // ② + ③ 面板：旧选项/警告/词典键**不得残留**；空值解析到出厂默认；与派活**同源**
      if (panelSrc8 === undefined) {
        bad('⑧ 读不到 src/client/settings-panel.tsx —— 面板判据无从核对')
      } else {
        const leftovers8 = [
          ["t('opt.hostDefaultResolved'", '第一项"解析结果"的调用'],
          ["t('warn.hostDefaultIsPlanning'", '"宿主默认是规划侧预设"那条警告'],
          ["'opt.hostDefaultResolved'", '词典键 opt.hostDefaultResolved'],
          ["'warn.hostDefaultIsPlanning'", '词典键 warn.hostDefaultIsPlanning'],
          ['readHostDefaultPresetId', '读宿主有效默认的函数'],
          ['hostDefaultIsPlanning', '判定宿主默认是否规划侧的变量'],
        ].filter(([needle]) => panelSrc8.includes(needle))
        if (leftovers8.length > 0) {
          bad(`⑧ 面板里仍有**已删除**的残留：${leftovers8.map(([, l]) => l).join(' / ')}`
            + ' —— 用户已裁定删掉「（用宿主默认预设）」这个选项及其解析/警告，'
            + '留着会让下一个人以为它还在用（死代码 + 死键）')
        } else ok('⑧ ✓ 面板里零残留（旧选项的调用、警告、词典键、判定变量都不在了）')
        // ② 空值 ⇒ 出厂默认（**显示口径**）
        if (!/preset\s*===\s*''\s*\?\s*FACTORY_DEFAULT_PRESET_ID\s*:\s*preset/.test(panelSrc8)) {
          bad("⑧ 面板没有把空值解析为 `FACTORY_DEFAULT_PRESET_ID` "
            + "（缺 `preset === '' ? FACTORY_DEFAULT_PRESET_ID : preset`）—— "
            + '空值仍会被当成"不指定"显示，用户看到与实际不符')
        } else ok('⑧ ✓ 面板把空值解析为出厂默认（显示口径到位）')
        // ③ 同源：面板必须 **import** 那个常量，而不是自己写 'standard'
        if (!/import\s*\{[^}]*FACTORY_DEFAULT_PRESET_ID[^}]*\}\s*from\s*'\.\.\/shared\/planning-preset\.ts'/.test(panelSrc8)) {
          bad('⑧ 面板没有 import `../shared/planning-preset.ts` 的 `FACTORY_DEFAULT_PRESET_ID`'
            + ' —— 显示与派活就不是同一个来源（同源是硬要求）')
        } else ok('⑧ ✓ 面板与派活**同源**（都 import 同一个常量）')
        // ③ 旧选项的 `id: ''` 那一项不得回来
        //   ⚠⚠ 判据必须**只看预设候选块**（第 11 轮负向对拍当场抓到的假失败）：
        //     模型行**合法地**有一条 `id: ''`（「（用宿主默认模型）」）——
        //     而任务书明令**模型行不动**。扫全文件会把它误判成"选项加回来了"。
        const presetBlockM = /const\s+presetItems[\s\S]*?=([\s\S]*?)\n\s*\/\/\s*⚠\s*已存值/.exec(panelSrc8)
        if (presetBlockM === null) {
          bad('⑧ 找不到 `presetItems` 的构造块 —— "旧选项有没有回来"无从判定（不按通过处理）')
        } else if (/id:\s*''/.test(presetBlockM[1])) {
          bad("⑧ 预设候选里又出现了 `id: ''` 的项 —— 「（用宿主默认预设）」被加回来了"
            + '（用户已明确不要它）')
        } else ok("⑧ ✓ 预设候选块里没有 `id: ''`（模型行那条不受影响）")
      }

      // ③ 派活侧：**不再读宿主有效默认**；空值 ⇒ 出厂默认；在册校验仍在；不静默；分支可达
      if (busSrc8Raw === undefined) {
        bad('⑧ 读不到 src/modules/bus.ts —— 派活侧判据无从核对')
      } else {
        const busCode8 = stripCommentsOnlyLocal(busSrc8Raw)
        //   (a) 那条"读宿主有效默认"的链**必须已删**（连函数定义都不许留）
        if (/readHostDefaultPresetId/.test(busCode8)) {
          bad('⑧ bus.ts 里仍有 `readHostDefaultPresetId` —— 那条链应当**整块删除**'
            + '（它只为已删除的选项服务；留着就是一条没人该走的路）')
        } else ok('⑧ ✓ 派活侧不再读宿主有效默认（`readHostDefaultPresetId` 已删）')
        //   (b) 也不许再拿"宿主默认"与规划侧常量比较（那是上一轮的判据形态）
        if (/hostDefault\s*===/.test(busCode8)) {
          bad('⑧ bus.ts 里仍有 `hostDefault === …` 的比较 —— 上一轮那套"探宿主默认再判"没删干净')
        } else ok('⑧ ✓ 不再比较"宿主默认"（上一轮那套已撤销）')
        //   (c) 空值 ⇒ 显式传出厂默认
        if (!/presetId\s*=\s*FACTORY_DEFAULT_PRESET_ID/.test(busCode8)) {
          bad('⑧ bus.ts 里没有 `presetId = FACTORY_DEFAULT_PRESET_ID` —— '
            + '未指定预设时不会落到标准模式（本轮的核心口径没落地）')
        } else ok('⑧ ✓ 未指定预设时显式传出厂默认（`presetId = FACTORY_DEFAULT_PRESET_ID`）')
        //   (d) 在册校验仍在（沿用第 10 轮；否则显式传不存在的预设会让 spawn 失败）
        if (!/await\s+presetExists\s*\(/.test(busCode8)) {
          bad('⑧ bus.ts 丢了"确认出厂默认在名册里"这一步（缺 `await presetExists(...)`）—— '
            + '显式传一个不存在的预设会让宿主 `resolve()` 抛 `Unknown agent preset` ⇒ '
            + '**spawn 失败**（硬禁）')
        } else ok('⑧ ✓ 在册校验仍在（`await presetExists(...)`，不让 spawn 失败）')
        //   (e) 不静默：退回不指定那条路要有说明
        if (!/presetNote\s*=/.test(busCode8)) {
          bad('⑧ bus.ts 的"出厂默认不在名册 ⇒ 退回不指定"这条路**静默**（没写 `presetNote`）')
        } else ok('⑧ ✓ 退回不指定时如实说明（`presetNote`，不静默）')
        //   (f) 分支**真的可达**且**不拦显式传参**
        const branchRe = /if\s*\(\s*([^)]*explicitPreset\s*===\s*undefined[^)]*)\)\s*\{/.exec(busCode8)
        if (branchRe === null) {
          bad('⑧ 兜底分支没有挂在"`explicitPreset === undefined`"条件上 —— '
            + '可能拦到了显式传参（那是调用方的明确选择，**不许**改）')
        } else if (/^\s*(false|0|null|undefined)\s*(&&|\|\||\))/.test(branchRe[1])) {
          bad('⑧ 兜底分支的条件以**死条件**开头（如 `false && …`）—— 分支永远不执行，等于没落地')
        } else ok('⑧ ✓ 兜底只作用于"本次未指定预设"，且分支**真的可达**（条件不是死条件）')
      }

      // ⑤ 词典里**零 markdown 标记**（用户可见文案会被字面渲染）
      if (panelSrc8 === undefined) {
        // 上面已报"读不到面板"，此处不重复；仅避免二次判据失真。
      } else {
        const dictOf = (name) => {
          const m = new RegExp(`const\\s+${name}\\s*:\\s*Record<string,\\s*string>\\s*=\\s*\\{([\\s\\S]*?)\\n\\}`).exec(panelSrc8)
          return m === null ? undefined : m[1]
        }
        const blocks = [['PANEL_EN', dictOf('PANEL_EN')], ['PANEL_ZH', dictOf('PANEL_ZH')]]
        const missingDict = blocks.filter(([, b]) => b === undefined)
        if (missingDict.length > 0) {
          bad(`⑧ 读不到词典字面量（${missingDict.map(([n]) => n).join(' / ')}）⇒ markdown 判据无从核对（不按通过处理）`)
        } else {
          // ⚠ 判据：**只查字符串字面量内部**（注释里写 markdown 是允许的、也是本仓的书写习惯）。
          //   值里出现 `**` / 反引号 / `__` 都会被渲染成**字面字符**（用户截图实证）。
          const offenders9 = []
          for (const [name, block] of blocks) {
            for (const m of block.matchAll(/'((?:[^'\\]|\\.)*)'/g)) {
              const lit = m[1]
              // 词典是 `'键': '值'` 成对出现 ⇒ 跳过形如键的那些（含 `.` 或纯标识符且无空格）
              if (/^[A-Za-z][\w.]*$/.test(lit)) continue
              if (lit.includes('**') || lit.includes('`') || lit.includes('__')) {
                offenders9.push(`${name}: ${JSON.stringify(lit.slice(0, 60))}`)
              }
            }
          }
          if (offenders9.length > 0) {
            bad(`⑧ 词典里出现 **markdown 标记**（会被字面渲染成字符）：${offenders9.join(' ; ')}`
              + ' —— 用户截图里就是 `它**不会被采用**` 直接把星号显示了出来')
          } else ok('⑧ ✓ 两份词典的用户可见字符串里零 markdown 标记（`**` / 反引号 / `__`）')
        }
      }
    }
  }
}

/**
 * 本组专用的**注释剥离器** —— 只服务"这个 id 是不是被当值写了"这一条判据。
 *
 * ⚠ **它只剥注释、不剥字符串**（第 9 轮实测教训，别照抄别的脚本）：
 *   本判据要找的正是"**被当值写的字面量**"（`= 'Hob'` / `=== 'Hob'`）。
 *   若照 `check-client-deps.mjs` 那份"注释+字符串一起抹"的写法，
 *   待查的 `'Hob'` **也被抹成空格** ⇒ 断言恒 PASS（**假通过**）。
 *   首版本函数就是这么写的，**负向对拍当场抓出来**。
 *   ⇒ 字符串/模板串**原样保留**，只把注释覆盖成等长空格（保留换行）。
 *
 * ⚠ 与 `check-client-deps.mjs` 里那份**有意分开**：那份自带双向自证、
 *   且与它自己的断言组绑在一起；跨脚本 import 会让两条机检互相牵制。
 *
 * @param src - 源码全文。
 * @returns 等长、**只把注释**抹空的串。
 */
function stripCommentsOnlyLocal(src) {
  const out = Array.from(src)
  const n = src.length
  const blank = (from, to) => { for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' ' }
  let i = 0
  while (i < n) {
    const c = src[i]
    const c2 = src[i + 1]
    // 行注释
    if (c === '/' && c2 === '/') { let j = i + 2; while (j < n && src[j] !== '\n') j++; blank(i, j); i = j; continue }
    // 块注释
    if (c === '/' && c2 === '*') {
      let j = i + 2
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++
      j = Math.min(j + 2, n); blank(i, j); i = j; continue
    }
    // 字符串/模板串：**跳过但保留**（本判据要找的正是"被当值写的字面量"，
    //   把它抹掉就等于把要抓的东西删了 —— 这是本函数与 check-client-deps 那份
    //   剥离器的**关键差别**，别照抄那边）。
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === c) { j++; break }
        if (src[j] === '\n') break
        j++
      }
      i = j; continue
    }
    i++
  }
  return out.join('')
}

// ── 输出 ────────────────────────────────────────────────────────────────
console.log(`预设契约一致性核对 · 预设 ${NAME_HO}（包名 ${HO_PKG}，本批未跟改）`)
console.log('⚠ v4：Hob-Execute 预设已删除（用户决策 D1/D2），其专属断言组随之移除；')
console.log('       对 Hob 预设的全部断言**一条未动、一条未放宽**。')
console.log('预设（机器读版）:', HO)
/**
 * ══════════════════════════════════════════════════════════════════════════
 * ⚠⚠ **Q8 · 白名单里的每个名字都必须有提供处**（2026-10-21 · 第 339 轮 · **丙-6**）
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── 本组守的是哪一格（`PROJECT-SURVEY-3` §6.3 丙-6 的**真正根**）──────────
 *   改前 `schedule_*` 四个名字在**白名单里**、而**声明面零命中**、`grep scripts/` **零命中**
 *   —— ⚠ **没有任何机检盯着"白名单里的名字到底有没有人提供"**。
 *   ⇒ 白名单可以**比实际能力宽**，而**没有任何东西会响**；调用的结果是 `unknown tool`。
 *   ⚠ 这与 `E-86` 的"与门"是同一条纪律的另一半：白名单放行 **且** 作用域里注册
 *     才真能用。本组钉的是**后一半**。
 *
 * ── 判据（**不硬编码名字**，全部从源码实测）──────────────────────────────
 *   ① 取 `src/preset/tools.ts` 的 `MODEL_TOOL_ALLOWLIST`（实测字面量）；
 *   ② 取本预设声明面 `preset/dsh-hob/preset-dsh-hob.patch.yml` 的**全文**；
 *   ③ 取**宿主内置**那几份预设（`dsh-web-app/presets/*.patch.yml`）里声明过的工具 id；
 *   ④ ⚠ 本预设地基 = `minimal.patch.yml`（宿主**不支持 `extends`**，
 *      `PROJECT.md` §4.3 / F-C3）⇒ **只认"本预设声明面 ∪ minimal 声明面"**
 *      这一并集里出现过的工具包 id。
 *   ⇒ 白名单里每个名字，必须在下面**至少一处**找得到：
 *      · 本插件自己注册（`read_contracts` / `write_hob` 这类，白名单注释里已点名）；
 *      · 本预设 / minimal 声明面里出现的**工具包 id 所对应的工具名**。
 *
 * ⚠ **怎么判"工具名属于哪个包"而不硬编码**：本组用一份**从宿主包里实测出来的
 *   「包 id → 该包注册的工具名」映射**（读 `@deepseek-ai/dsh-tool-*` 的 `lib/index.js`
 *   里的 `name:` 字面量）。⚠ 读不到某个包 ⇒ **该包视为"不存在"**，
 *   ⛔ 不许静默当成"提供了"（那会让本组恒绿）。
 *
 * ⚠ **已知局限（如实登记）**：宿主包里工具名若由**运行时拼接**得来（不是字面量），
 *   本组会读不到 ⇒ 那个名字会被判"无提供处"。⚠ 本批实测：当前 22 名里
 *   除本插件 2 个外，其余全部能在这份映射里找到 ⇒ **没有误报**。
 */
{
  const HOST_NM = join('node_modules', '@deepseek-ai')
  /** ⚠ 本插件自己注册的名字（白名单注释点名，⛔ 不是"豁免"，是"提供处在 src/"）。 */
  const SELF_PROVIDED = new Set(['read_contracts', 'write_hob'])
  const readOr = (p) => { try { return readFileSync(p, 'utf8') } catch { return null } }

  /** ① 白名单实测 */
  const allowSrc = readOr(join(root, 'src', 'preset', 'tools.ts'))
  const allow = (() => {
    if (allowSrc === null) return null
    const m = /export const MODEL_TOOL_ALLOWLIST[^=]*=\s*\[([\s\S]*?)\n\]/.exec(allowSrc)
    return m === null ? null : [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  })()

  /** ② 本预设声明面 + ③ minimal 声明面 ⇒ 并集里出现过的工具包 id */
  const selfPatch = readOr(join(root, 'preset', 'dsh-hob', 'preset-dsh-hob.patch.yml'))
  const minimalPatch = readOr(join(
    '/usr/local/lib/node_modules/@deepseek-ai/dsh',
    'node_modules', '@deepseek-ai', 'dsh-web-app', 'presets', 'minimal.patch.yml',
  ))
  /**
   * ⚠ **本预设是"照抄 minimal + 指名增行"**（宿主不支持 `extends`）⇒ 两份都要读。
   *   minimal 读不到 ⇒ **本组失去基准**（⛔ 不许当成"没有声明面" ⇒ 那会全红）。
   */
  const patchText = (selfPatch ?? '') + '\n' + (minimalPatch ?? '')

  /** ④ 从宿主包里实测「工具名 → 提供包」 */
  const hostToolNames = new Map()   // toolName → packageId
  const pkgDir = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
  /**
   * ⚠ **只扫"声明面里出现过 id 的那些包"**：包名到 id 的对应关系来自
   *   `cordis.patch.yml` 的 `- id: <id>` + `name: '<包名>'` 相邻两行。
   *   ⚠ 这样本组**不硬编码任何映射**：id 与包名的对应关系也是实测来的。
   */
  const idToPkg = new Map()
  const cordisPatch = readOr('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app/presets/cordis.patch.yml')
  if (cordisPatch !== null) {
    const re = /- id:\s*([A-Za-z0-9_-]+)\s*\n\s*name:\s*'(@deepseek-ai\/[A-Za-z0-9_-]+)'/g
    let m
    while ((m = re.exec(cordisPatch)) !== null) idToPkg.set(m[1], m[2])
  }
  /** ⚠ 本预设 + minimal 里出现的 `- id: <x>` ⇒ 那些包**被装配**了（用于打印覆盖面）。 */
  const declaredIds = new Set([...patchText.matchAll(/-\s*id:\s*([A-Za-z0-9_-]+)/g)].map((m) => m[1]))
  /**
   * ⚠⚠ **必须扫宿主【所有】`dsh-tool-*` 包，而不只是"已装配"的那些**（第 339 轮实测订正）：
   *   第一版只扫"本预设 + minimal 声明过的 id" ⇒ `tool-schedule` **没被装配**
   *   ⇒ 它的工具名**根本不在映射里** ⇒ 把 `schedule_create` 加回白名单时
   *   会被归进"第三方、不判" ⇒ **Q8 抓不住丙-6 的回归**（负向对拍当场暴露）。
   *   ⇒ 现在：**枚举宿主 `@deepseek-ai/dsh-tool-*` 全部包**，把它们的工具名都收进映射。
   *     ⚠ 这样"名字属于宿主但没被装配"就变成了**可判的缺口**。
   */
  const hostPkgs = (() => {
    try {
      return readdirSync(join('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'))
        .filter((n) => n.startsWith('dsh-tool-'))
    } catch { return [] }
  })()
  for (const short of hostPkgs) {
    const js = readOr(join(pkgDir, short, 'lib', 'index.js'))
    if (js === null) continue
    const pkg = '@deepseek-ai/' + short
    /**
     * ⚠ 从产物里抓 `name: "xxx"` 形式的工具名 —— ⚠⚠ **宿主产物用的是双引号**
     *   （实测：`dsh-tool-schedule/lib/index.js` 里是 `name: "schedule_create"`）。
     *   ⚠ 本组第一版只认单引号 ⇒ 实测抓到 **0 个名字** ⇒ **Q8 等于没在判**
     *     （它会把一切都归进"第三方，不判"）—— 那正是"判据假装在干活"。
     *   ⇒ 现在**双引号与单引号都认**。
     */
    for (const m of js.matchAll(/name:\s*['"]([a-z][a-z0-9_]{2,})['"]/g)) {
      if (!hostToolNames.has(m[1])) hostToolNames.set(m[1], pkg)
    }
  }

  /**
   * ⚠⚠ **判据的**可判边界**（第 339 轮实测后收紧，⛔ 不是放宽）**：
   *
   *   白名单里只有两类名字是**本组能判**的：
   *     ① 本插件自注册的（`SELF_PROVIDED`）；
   *     ② 由**本预设声明面里出现过的宿主工具包**提供的（`hostToolNames`）。
   *   ⚠ 其余名字（检索 5 个 · 看板 3 个 · 圆桌 1 个 · `skill` / `present` /
   *     `ask_user_question` …）来自**第三方插件包**（`free-search` / `taskboard` /
   *     `roundtable` / …），它们的提供处**不在本仓、也不在宿主 `dsh-tool-*` 里**
   *     ⇒ 本组**读不到**它们 ⇒ ⛔ **不许因此判红**（那会变成恒红），
   *       但也 ⛔ **不许静默算通过** ⇒ 单列一份"**未覆盖**"清单，**每次运行都印出来**。
   *
   *   ⚠ 这正是本组的**诚实边界**：它钉得住"宿主工具包那一半"（丙-6 正是这一半），
   *     ⛔ 钉不住"第三方插件那一半"。后者若有同类问题，需要读那个插件的装配产物
   *     （属另一个决定，本批不做）。
   */
  const covered = []
  const uncovered = []
  const missing = []
  if (allow === null) {
    bad('Q8 【失去基准】读不到 `MODEL_TOOL_ALLOWLIST` ⇒ 白名单-提供处对账无法进行（不按通过处理）')
  } else if (minimalPatch === null) {
    bad('Q8 【失去基准】读不到宿主的 `minimal.patch.yml`'
      + '（本预设地基；⚠ 它读不到就不能判"哪些工具包被装配"）⇒ 不按通过处理')
  } else {
    /**
     * ⚠ **怎么把"第三方插件的名字"识别出来**（⛔ 不硬编码名字）：本预设声明面里
     *   `- id: <x>` 的取值就是**装配了哪些包**；若某个 id 在 `idToPkg` 里查得到，
     *   它就是宿主包（可判）；查不到 ⇒ 是第三方/本插件自己的行（不可判）。
     *   ⚠ 于是本组只对"**宿主包提供的名字 ∪ 本插件自注册**"判红，其余进 `uncovered`。
     */
    /**
     * ⚠⚠ **关键：光"名字属于某个宿主包"不够 —— 那个包还必须【被本预设装配】**。
     *   第一版只判 `hostToolNames.has(name)`（= 名字存在于某个宿主包里）⇒
     *   `schedule_create` 加回白名单时**仍然通过**（负向对拍当场暴露）。
     *   ⇒ 现在要求：名字所属的包，其 id 必须在 `declaredIds`（本预设 ∪ minimal）里。
     *     ⚠ 包名 → id 用 `pkgToIds`（从 `cordis.patch.yml` 实测来的反向表）。
     */
    const pkgToIds = new Map()
    for (const [id, pkg] of idToPkg) {
      const arr = pkgToIds.get(pkg) ?? []
      arr.push(id)
      pkgToIds.set(pkg, arr)
    }
    const isDeclaredPkg = (pkg) => (pkgToIds.get(pkg) ?? []).some((id) => declaredIds.has(id))
    const judgeable = new Set([...SELF_PROVIDED, ...hostToolNames.keys()])
    for (const name of allow) {
      if (SELF_PROVIDED.has(name)) { covered.push(name); continue }
      const pkg = hostToolNames.get(name)
      if (pkg === undefined) { uncovered.push(name); continue }
      covered.push(name)
      if (!isDeclaredPkg(pkg)) missing.push(`${name}（属 ${pkg}，本预设未装配）`)
    }
    /**
     * ⚠ **丙-6 的回归判据**：`schedule_*` 那类"宿主包提供、而本预设没装配"的名字，
     *   会在删掉后**不在白名单里**；若有人把它们加回来 ⇒ `judgeable` 里有
     *   （`dsh-tool-schedule` 是宿主包，名字在 `hostToolNames` 里）
     *   ⇒ **会进 `missing` ⇒ 当场红**。这正是本组要的长牙点。
     */
    if (missing.length === 0) {
      ok(`Q8 ✓ **白名单里 ${allow.length} 个名字**：可判 ${covered.length} 个（本插件自注册 `
        + `${SELF_PROVIDED.size} + 宿主工具包实测 ${hostToolNames.size}）**全部有提供处**；`
        + `⚠ 另有 ${uncovered.length} 个来自**第三方插件**（本组读不到其装配产物，**单列不判**）`
        + ` ⇒ ⛔ 不再有"宿主包放行了但没装配"的那种名字（丙-6 的根）`
        + (uncovered.length > 0 ? `\n       ⚠ 未覆盖（第三方插件提供，本组不判）：${uncovered.join(' / ')}` : ''))
    } else {
      bad(`Q8 **白名单里有 ${missing.length} 个名字的提供方是宿主包、但本预设没装配**：${missing.join(' / ')}`
        + '\n      ⇒ ⚠ 这就是丙-6：白名单**比实际能力宽**，调用会得到 `unknown tool`'
        + '\n      ⇒ 修法（二选一，取决于定性）：'
        + '\n         · 若它**本来该有** ⇒ 在本预设声明面补 `- id: <工具包 id>` 那一行；'
        + '\n         · 若它**本来就用不了** ⇒ 从 `MODEL_TOOL_ALLOWLIST` 删掉这个名字'
        + '\n        ⛔ 两种修法方向相反，⛔ 不许两边都动')
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
// ⑤o · 工具面与档位**解耦**（2026-10-30 P14 · 用户裁定）
// ══════════════════════════════════════════════════════════════════════
/**
 * ── 它守的是什么（三条，各自可被单独弄坏）────────────────────────────
 *   ① **读范围是"指名"的**：`READ_SCOPED_TOOLS` 必须**双向等于** `档3 − 档1`
 *      —— 少了 ⇒ 某档白拿读能力；多了 ⇒ 把一个非读工具误判成"低档看不见"。
 *   ② **档位只管读范围**：非读工具在**任何档**都要留（`web_search` 类"默认放开"），
 *      而读范围名字必须**按档**判（`hob_glob` 档1 摘、档3 留）。
 *   ③ ⭐ **没见过的工具不静默放行**：`unseen === true` 且 `keep === true`
 *      （⚠ 语义 = 主流 `ask` 去掉交互形态：**放行 + 留待确认**，⛔ 不是拦下）。
 *   ⚠ 负向对拍（⑤o-4）把 deny 分支改成恒假 ⇒ ②必须变红，用来证明这三条有牙。
 */
{
  const MOD_TS = join(root, 'src', 'preset', 'tools.ts')
  let m = null
  try { m = await import(pathToFileURL(MOD_TS).href + '?p14=' + Date.now()) } catch (e) {
    bad(`⑤o 无法直载 src/preset/tools.ts（${String(e?.message ?? e)}）⇒ 基准缺失，不按通过处理`)
  }
  if (m !== null) {
    // ── ⑤o-1 读范围表 ≡ 档3 − 档1（双向）────────────────────────────
    {
      const readScoped = Array.isArray(m.READ_SCOPED_TOOLS) ? m.READ_SCOPED_TOOLS : null
      const t1 = new Set(m.PERMISSION_TIERS.ledger)
      const t3 = new Set(m.PERMISSION_TIERS.workspace)
      const derived = [...t3].filter((n) => !t1.has(n))
      if (readScoped === null || readScoped.length === 0) {
        bad('⑤o-1 抽不出 READ_SCOPED_TOOLS（"档位只管读范围"的唯一来源缺失）')
      } else {
        const onlyTable = readScoped.filter((n) => !derived.includes(n))
        const onlyDerived = derived.filter((n) => !readScoped.includes(n))
        if (onlyTable.length > 0 || onlyDerived.length > 0) {
          bad(`⑤o-1 READ_SCOPED_TOOLS 与「档3 − 档1」**不是逐名相等**`
            + `（表里多：${onlyTable.join(', ') || '无'}；派生多：${onlyDerived.join(', ') || '无'}）`)
        } else {
          ok(`⑤o-1 读范围表逐名 == 档3 − 档1（${readScoped.length} 名：${readScoped.join(', ')}）`)
        }
      }
    }

    /** ⚠ deny 清单的**唯一来源**是 `src/modules/tools.ts`（`preset/tools.ts` 只是转口）。 */
    let DENY = []
    try {
      const dm = await import(pathToFileURL(join(root, 'src', 'modules', 'tools.ts')).href + '?p14=' + Date.now())
      DENY = dm.DEFAULT_DENY ?? []
    } catch { DENY = [] }
    if (DENY.length === 0) bad('⑤o 抽不出 DEFAULT_DENY（基准缺失 ⇒ 不按通过处理）')
    const KNOWN = [...m.MODEL_TOOL_ALLOWLIST, ...DENY]
    const decide = (n, lv) => m.decideToolFace(n, lv, DENY, KNOWN)

    // ── ⑤o-2 档位只管读范围 / 其余默认放开 ────────────────────────────
    {
      const cases = [
        ['hob_glob', 'ledger', false, '读范围名·档1 没有 ⇒ 摘'],
        ['hob_glob', 'workspace', true, '读范围名·档3 有 ⇒ 留'],
        ['hob_read_doc', 'project', true, '读范围名·档2 有 ⇒ 留'],
        ['web_search', 'ledger', true, '**非读工具**（不在任何档）⇒ 档1 也留（默认放开）'],
        ['hob_sessions', 'ledger', true, '编排名·非读 ⇒ 与档位无关，留'],
        ['bash', 'workspace', false, 'deny 清单内 ⇒ 最高档也摘'],
        ['write', 'workspace', false, 'deny 清单内 ⇒ 摘'],
        ['run_code', 'ledger', true, '保留传输名 ⇒ 留'],
      ]
      const wrong = []
      for (const [n, lv, want, why] of cases) {
        const v = decide(n, lv)
        if (v.keep !== want) wrong.push(`${n}@${lv}=${v.keep}（应 ${want}；${why}，实际 why=${v.why}）`)
      }
      if (wrong.length > 0) bad(`⑤o-2 工具面判决与"档位只管读范围"不符：${wrong.join(' / ')}`)
      else ok(`⑤o-2 档位只决定读范围（${cases.length} 例全对）：读范围名按档判 · 非读名任何档都留 · deny 最高档也摘`)
    }

    // ── ⑤o-3 ⭐ 没见过的工具：放行 + 待确认（= ask 去掉交互形态）────────
    {
      const v = decide('brand_new_plugin_tool', 'ledger')
      const vKnown = decide('read_contracts', 'ledger')
      if (v.keep !== true) {
        bad('⑤o-3 没见过的工具被**拦下**了 ⇒ 那是退回白名单，与用户裁定"默认放开"相反')
      } else if (v.unseen !== true) {
        bad('⑤o-3 没见过的工具被**静默放行**（unseen=false）⇒ 这正是本轮要治的"不吭声"')
      } else if (vKnown.unseen !== false) {
        bad('⑤o-3 认识的名字（`read_contracts`）被误判成"没见过" ⇒ unseen 口径错')
      } else {
        ok('⑤o-3 ⭐ 没见过的工具：`keep=true` + `unseen=true`（**放行且留待确认**，⛔ 不静默、⛔ 不拦下）')
      }
    }

    /**
     * ── ⑤r ⭐ **`unseen` 的可读出口：两种读数 + 负向对拍**（2026-10-31 P28 · `TSK-048` / `R-008`）──
     *   治的病（`CHG-281` §六·1）：`UNSEEN_SEEN` 只活内存 + 宿主 warn（`debugLog` 默认关）
     *   ⇒ **重启即丢、用户永远看不到"系统抓到了什么"**。
     *   ⇒ 本组验 `src/shared/unseen-tools.ts` 的 `describeUnseen()`（纯函数，⛔ 不需要真宿主）：
     *     ① **0 条**时 `summary` 必须**明说 0 条**（⛔ 不是空串 —— "空"与"没有"要分得开）；
     *     ② **有名字**时逐个点出（⛔ 只给个数）；
     *     ③ **负向对拍**：拿"有名字"的输入 ⇒ 若它返回 0 条（= 出口坏了）⇒ 本条必红。
     */
    /**
     * ⭐ **⑤r 的六项断言 —— 抽成纯函数，正向与负向对拍共用同一份判据**
     *   （2026-11-01 P40/R15 · `TASK-R15.md` §1.2）
     *
     * ── ⚠⚠ 为什么必须抽出来（这是本轮修的那个缺陷）──────────────────────
     *   修前：⑤r 的六项断言内联在正向分支里，**负向对拍自己只断言"变体 count===0"**
     *   ⇒ 那句「⑤r 必红」**只活在 `ok(...)` 的字符串里**。
     *   ⇒ 把六项断言整段删掉，N-⑤r **照样绿** —— 一条会自己关掉的判据。
     *
     *   修后：负向对拍调**同一个函数**，断言它的返回**必须非空**。
     *   ⇒ 若有人删掉某几项，负向对拍当场发现"变体坏了但六项仍全过"。
     *   ⚠ 若负向对拍自己另写一份判断，它验的是"另一份判据"，⛔ 不是这一份（会漂）。
     *
     * @param {{describeUnseen: (raw: readonly {name:string,why:string}[]) => {count:number,names:string[],summary:string}}} mod
     * @returns {string[]} 未通过的项（**空数组 = 六项全过**）
     */
    function unseenContractViolations(mod) {
      const out = []
      const empty = mod.describeUnseen([])
      if (empty?.count !== 0) out.push(`空输入 count=${JSON.stringify(empty?.count)}（应为 0）`)
      if (!String(empty?.summary ?? '').includes('0 条')) {
        out.push(`空输入 summary 没写「0 条」：${JSON.stringify(String(empty?.summary ?? '').slice(0, 60))}`)
      }
      const filled = mod.describeUnseen([{ name: 'zzz-alpha', why: 'x' }, { name: 'zzz-beta', why: 'y' }])
      if (filled?.count !== 2) out.push(`两条输入 count=${JSON.stringify(filled?.count)}（应为 2）`)
      if ((filled?.names ?? []).length !== 2) out.push(`两条输入 names 长度=${(filled?.names ?? []).length}（应为 2）`)
      for (const n of ['zzz-alpha', 'zzz-beta']) {
        if (!String(filled?.summary ?? '').includes(n)) out.push(`summary 没逐个点出 ${n}`)
      }
      const dup = mod.describeUnseen([{ name: 'zzz-b', why: '1' }, { name: 'zzz-a', why: '2' }, { name: 'zzz-b', why: '3' }])
      if (JSON.stringify(dup?.names) !== JSON.stringify(['zzz-a', 'zzz-b'])) {
        out.push(`去重/字典序不对：${JSON.stringify(dup?.names)}`)
      }
      return out
    }

    {
      const UNSEEN = join(root, 'src', 'shared', 'unseen-tools.ts')
      let um = null
      try { um = await import(pathToFileURL(UNSEEN).href + '?t=' + Date.now()) } catch { um = null }
      if (um === null || typeof um.describeUnseen !== 'function') {
        bad('⑤r 读不到 `src/shared/unseen-tools.ts` 的 `describeUnseen` ⇒ 本组失去对象（⛔ 不按通过处理）')
      } else {
        /**
         * ⚠ 六项断言**只在 `unseenContractViolations` 里**（⛔ 不在这里再写一遍）：
         *   正向调它、负向对拍也调它 ⇒ 两处验的是**同一份判据**，删一项两处一起变。
         */
        const p2 = unseenContractViolations(um)
        if (p2.length === 0) {
          ok('⑤r ✓ `unseen` 只读出口两种读数都对：**0 条**时明说「0 条」（⛔ 非空白）· 有名字时**逐名点出** + 去重按字典序')
        } else for (const x of p2) bad(`⑤r · ${x}`)

        /**
         * ── N-⑤r **负向对拍**：把 `describeUnseen` 改成"永远回 0 条"（= 出口坏了）⇒ ⑤p 必红 ──
         *   ⚠ **先自证夹具真的坏了**（变体对两条输入必须回 0），再断言"⑤p 会因此变红"。
         */
        const src = readFileSync(UNSEEN, 'utf8')
        const NEEDLE = "  const names = [...byName.keys()].sort()"
        if (!src.includes(NEEDLE)) {
          bad('N-⑤r · 源码里找不到 `const names = [...byName.keys()].sort()` 那一行（形态变了）⇒ 负向对拍不可判')
        } else {
          const tmp = join(root, 'src', 'shared', `unseen-tools.__negctl_${process.pid}.ts`)
          writeFileSync(tmp, src.replace(NEEDLE, '  const names = []'))
          try {
            const mm = await import(pathToFileURL(tmp).href + '?t=' + Date.now())
            // 自证：变体必须真的"回 0 条"
            const broken = mm.describeUnseen([{ name: 'zzz-alpha', why: 'x' }])
            /**
             * ⚠⚠ **本轮修的正是这一段**（2026-11-01 P40/R15 · `TASK-R15.md` §1.2）。
             *   修前：这里只断言"变体 count===0"，然后**直接** `ok('… 必红 …')`
             *   ⇒ 那句「必红」**只活在字符串里**，删掉 ⑤r 六项断言它照样绿。
             *   修后：**调同一个 `unseenContractViolations`**，断言它**必须非空**。
             *   ⇒ 谁删了哪几项，这里当场点名。
             */
            const variantViolations = unseenContractViolations(mm)
            if (broken?.count !== 0) {
              bad(`N-⑤r · 变体仍返回 count=${JSON.stringify(broken?.count)} ⇒ 夹具没造出"出口坏了"`)
            } else if (variantViolations.length === 0) {
              bad('N-⑤r · 变体已坏（count=0）但**六项断言仍全过** ⇒ ⑤r 的判据没有咬住'
                + '（⚠ 这正是修前那条判据的形态：只自证夹具坏了，没断言"必红"）')
            } else {
              ok('N-⑤r ✓ 负向对拍（先自证：把 `names` 改成 `[]` ⇒ 有输入也回 **0 条**）'
                + ` ⇒ ⑤r 的六项断言**真的开火了**，点名红在 **${variantViolations.length}** 项：`
                + `${variantViolations.map((x) => `「${x}」`).join(' · ')}`
                + '（⚠ 这是**同一个** `unseenContractViolations` 的返回，⛔ 不是另写一份判断）')
            }
          } finally {
            try { rmSync(tmp, { force: true }) } catch { /* 清不掉不影响判定 */ }
          }
        }

        /**
         * ── **N-⑤r-b：假模块夹具**（`TASK-R15.md` §1.3 · 本轮核心）────────────────
         *   造一个**永远回 `{count:0, names:[], summary:'0 条'}`** 的假模块，
         *   模拟"实现坏透了"的最坏形态。
         *
         *   ⚠⚠ **改前的 N-⑤r 在这个夹具上是绿的** —— 这是它放过的形态：
         *     旧判据只自证"变体 count===0"，假模块当然 count===0 ⇒ 直接 `ok(...必红...)`。
         *     ⇒ 也就是说：**旧判据对一个完全坏掉的实现会报「已咬住」**。
         *   修后：`unseenContractViolations(假模块)` 必须**非空**（它确实会非空，
         *     因为 `count`/`names`/`summary 逐名` 三项都不满足）⇒ 有牙。
         */
        const fakeModule = {
          describeUnseen: () => ({ ok: true, count: 0, names: [], summary: '0 条', items: [] }),
        }
        const fakeViolations = unseenContractViolations(fakeModule)
        /** ⚠ 先自证：假模块确实"永远回 0 条、names 空、summary 只有「0 条」"。 */
        const fakeSelfProven = fakeModule.describeUnseen([{ name: 'zzz-alpha', why: 'x' }]).count === 0
          && fakeModule.describeUnseen([{ name: 'zzz-alpha', why: 'x' }]).names.length === 0
          && fakeModule.describeUnseen([{ name: 'zzz-alpha', why: 'x' }]).summary === '0 条'
        if (!fakeSelfProven) {
          bad('N-⑤r-b · 假模块没造出"永远回 0 条 / names 空 / summary 只「0 条」" ⇒ 本条不可判')
        } else if (fakeViolations.length === 0) {
          bad('N-⑤r-b · 完全坏掉的假模块**六项断言仍全过** ⇒ ⑤r 判据没有牙（⛔ 这条修之前就会绿）')
        } else {
          ok('N-⑤r-b ✓ **假模块夹具**（先自证：它永远回 `count:0 / names:[] / summary:"0 条"`，即有输入也回 0 条）'
            + ` ⇒ 六项断言对它**必红**，点名 **${fakeViolations.length}** 项：`
            + `${fakeViolations.map((x) => `「${x}」`).join(' · ')}`
            + ' ⚠⚠ **改前的 N-⑤r 在这个夹具上是绿的**（它只自证"变体 count===0"，假模块当然满足 ⇒ 直接报「已咬住」）'
            + ' ⇒ 本条就是"修好之后真的会咬"的证明')
        }
      }
    }

    // ── ⑤o-4 负向对拍：把 deny 分支改成恒假 ⇒ ⑤o-2 必红 ────────────────
    {
      let src = null
      try { src = readFileSync(MOD_TS, 'utf8') } catch { src = null }
      const NEEDLE = "if (deny.includes(name)) return { keep: false, unseen: false, why: 'deny' }"
      // ⚠ 先自证：源码里**确实**有那句（否则"改不动"与"改了没用"无法区分）
      const present = src !== null && src.includes(NEEDLE)
      const mutated = present ? src.replace(NEEDLE, "if (false) return { keep: false, unseen: false, why: 'deny' }") : null
      const changed = mutated !== null && mutated !== src
      if (!present || !changed) {
        bad('⑤o-4 造不出「deny 恒假」的变体（源码形态变了）⇒ 负向对拍不可判')
      } else {
        const tmp = join(root, 'src', 'preset', `tools.__negctl_p14_${process.pid}.ts`)
        writeFileSync(tmp, mutated)
        try {
          const mm = await import(pathToFileURL(tmp).href + '?t=' + Date.now())
          const leak = mm.decideToolFace('bash', 'workspace', mm.DEFAULT_DENY, KNOWN)
          if (leak.keep === true) {
            ok(`⑤o-4 ✓ 负向对拍（deny 分支改成恒假）⇒ ⑤o-2 **必红**：\`bash\`@workspace 变成 keep=${leak.keep}`)
          } else {
            bad(`⑤o-4 变体仍把 \`bash\` 摘掉了（keep=${leak.keep}）⇒ 那条断言没有牙`)
          }
        } finally {
          try { rmSync(tmp, { force: true }) } catch { /* 清不掉不影响判定 */ }
        }
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
// ⑤o-5 · ⭐「没见过的工具要被看见」的**专属**负向对拍
// ══════════════════════════════════════════════════════════════════════
/**
 * ⚠ ⑤o-4 打的是 deny 分支，**证明不了** `unseen` 这一侧有牙 ⇒ 单列一条。
 * 手段：把 `unseen: !known.includes(name)` 改成 `unseen: false`（= **静默放行**，正是要治的病）
 * ⇒ ⑤o-3 必红。⚠ 先自证源码里**确实**有那句（否则"改不动"与"改了没用"分不开）。
 */
{
  const MOD_TS = join(root, 'src', 'preset', 'tools.ts')
  let src = null
  try { src = readFileSync(MOD_TS, 'utf8') } catch { src = null }
  const NEEDLE = "return { keep: true, unseen: !known.includes(name), why: 'default-open' }"
  const present = src !== null && src.includes(NEEDLE)
  const mutated = present ? src.replace(NEEDLE, "return { keep: true, unseen: false, why: 'default-open' }") : null
  if (!present || mutated === src) {
    bad('⑤o-5 造不出「unseen 恒假」的变体（源码形态变了）⇒ 负向对拍不可判')
  } else {
    const tmp = join(root, 'src', 'preset', `tools.__negctl_p14u_${process.pid}.ts`)
    writeFileSync(tmp, mutated)
    try {
      const mm = await import(pathToFileURL(tmp).href + '?t=' + Date.now())
      const v = mm.decideToolFace('brand_new_plugin_tool', 'ledger', [], [])
      if (v.keep === true && v.unseen === false) {
        ok('⑤o-5 ✓ 负向对拍（`unseen` 改成恒假 = 静默放行）⇒ ⑤o-3 **必红**：'
          + '没见过的工具变成 `keep=true, unseen=false`（正是"不吭声"那种形态）')
      } else {
        bad(`⑤o-5 变体仍报 unseen=${v.unseen}（keep=${v.keep}）⇒ 那条断言没有牙`)
      }
    } finally {
      try { rmSync(tmp, { force: true }) } catch { /* 清不掉不影响判定 */ }
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
// ⑤o-6 · ⭐⭐ **同一批工具名下，只改档位 ⇒ 可用工具集不变、能否派活不变，只有可读范围变**
// ══════════════════════════════════════════════════════════════════════
/**
 * ⚠⚠ **本组治的是 `R-007` 的标题**（`TASK-R21.md` §二1 · `ACC-007` 走 (a) 路补断言）：
 *   「档位只管可读范围，与「能不能派活」无关」。
 *
 * ── 为什么 ⑤o-2 不够（⚠ 这是本轮实测出来的缺口，⛔ 不是补充说明）──────────────
 *   `⑤o-2` 是 **8 个手挑的抽样用例**，只验"每个名字在**某个**档位下的判决对不对"。
 *   它证明不了**跨档不变性**：真要有人把 `decideToolFace` 改成"档位越低放行越少"
 *   （例如给非读名也加上档位判断），8 个抽样**可能仍然全过** —— 抽样不是全量。
 *   ⇒ 本组改成**全量**：拿**同一批工具名**，在三个档位下各算一遍**可用集合**，
 *     逐名比对"档位有没有改变它能不能用"。
 *
 * ── 口径（三条，⛔ 缺一条就算没验到）──────────────────────────────────
 *   ① **可用工具集不变**：`keep===true` 的名字集合，三档必须**逐个相等**。
 *      ⚠ 唯一的合法差异是**读范围名**（它们本来就该按档变）—— 本组把两类分开算：
 *        · **非读范围名**（= 全量名字 − `READ_SCOPED_TOOLS`）：三档的可用集合必须**完全相同**；
 *        · **读范围名**：三档的可用集合必须**随档单调不减**（档越高，可读越多），且至少变一次
 *          （⛔ 若三档完全一样 ⇒ 档位根本没起作用，也要红）。
 *   ② **能否派活不变**：`keep` 是"这个工具**能不能用**"的唯一落点（派活 = 能不能用这些工具）。
 *      ⇒ 非读范围名的 `keep` 三档必须一致 ⇒ 就是①。⚠ 本组另外钉一句：
 *      **判决函数里档位只出现在读范围那一支**（源码层面：`PERMISSION_TIERS` 只在
 *      `READ_SCOPED_TOOLS` 分支内被读）—— 那是"档位与派活无关"的**结构证据**，
 *      ① 是它的**行为证据**，两条都要。
 *   ③ **只有可读范围变**：见①的后半（读范围名随档变，且单调）。
 *
 * ⚠ 名字全集**从 `PERMISSION_TIERS` 与 deny 清单实测抽**（⛔ 不手抄一份名单）：
 *   手抄的名单会和源码漂，漂了之后本组验的就不是源码了。
 */
{
  const MOD_TS = join(root, 'src', 'preset', 'tools.ts')
  let m = null
  try { m = await import(pathToFileURL(MOD_TS).href + '?t=' + Date.now()) } catch { m = null }
  let dm = null
  try {
    dm = await import(pathToFileURL(join(root, 'src', 'modules', 'tools.ts')).href + '?t=' + Date.now())
  } catch { dm = null }
  const DENY2 = Array.isArray(dm?.DEFAULT_DENY) ? dm.DEFAULT_DENY : []
  if (m === null || typeof m.decideToolFace !== 'function' || typeof m.PERMISSION_TIERS !== 'object') {
    bad('⑤o-6 读不到 `decideToolFace` / `PERMISSION_TIERS` ⇒ 本组失去对象（⛔ 不按通过处理）')
  } else if (DENY2.length === 0) {
    bad('⑤o-6 抽不出 `DEFAULT_DENY`（基准缺失 ⇒ 不按通过处理）')
  } else {
    const TIERS3 = ['ledger', 'project', 'workspace']
    const READ_SCOPED = Array.isArray(m.READ_SCOPED_TOOLS) ? m.READ_SCOPED_TOOLS : null
    /**
     * 全量名字 = 三档名字的并集 ∪ deny 清单 ∪ 一个"从没见过的名字"（钉默认放开那一支）。
     * ⚠ 并集而不是只取档3：档1 独有、档3 独有的名字都要在样本里。
     */
    const allNames = new Set([...DENY2, 'brand_new_plugin_tool'])
    for (const lv of TIERS3) {
      const arr = m.PERMISSION_TIERS[lv]
      if (Array.isArray(arr)) for (const n of arr) allNames.add(n)
    }
    const NAMES = [...allNames].sort()
    const KNOWN2 = [...NAMES].filter((n) => !n.startsWith('brand_new'))
    const keepAt = (lv) => new Set(NAMES.filter((n) => m.decideToolFace(n, lv, DENY2, KNOWN2).keep === true))
    const sets = Object.fromEntries(TIERS3.map((lv) => [lv, keepAt(lv)]))
    /**
     * ⚠ `READ_SCOPED` 读不到 ⇒ **判不可判**（⛔ 不许退化成"把全部名字都当非读范围"）：
     *   那会让本组变成一条只会报绿的空断言。
     */
    if (READ_SCOPED === null || READ_SCOPED.length === 0) {
      bad('⑤o-6 读不到 `READ_SCOPED_TOOLS` ⇒ 分不开"读范围名"与"非读名"（⛔ 不按通过处理）')
    } else {
      const readSet = new Set(READ_SCOPED)
      const nonRead = NAMES.filter((n) => !readSet.has(n))
      const readNames = NAMES.filter((n) => readSet.has(n))
      const probs = []

      // ── ① 非读范围名：三档可用集合必须**完全相同**（= 档位不碰"能不能用"）──
      for (const n of nonRead) {
        const ks = TIERS3.map((lv) => sets[lv].has(n))
        if (!(ks[0] === ks[1] && ks[1] === ks[2])) {
          probs.push(`非读名 \`${n}\` 的可用性随档位变了（${TIERS3.map((lv, i) => `${lv}=${ks[i]}`).join(' / ')}）`
            + ' ⇒ 档位越界到"能不能派活"了')
        }
      }

      // ── ③ 读范围名：随档**单调不减**，且至少变一次 ──
      for (const n of readNames) {
        const ks = TIERS3.map((lv) => sets[lv].has(n))
        if (ks[0] === true && ks[1] === false) probs.push(`读范围名 \`${n}\`：档1 有、档2 没有 ⇒ 不单调`)
        if (ks[1] === true && ks[2] === false) probs.push(`读范围名 \`${n}\`：档2 有、档3 没有 ⇒ 不单调`)
      }
      const readCounts = TIERS3.map((lv) => readNames.filter((n) => sets[lv].has(n)).length)
      const readChanged = !(readCounts[0] === readCounts[1] && readCounts[1] === readCounts[2])

      // ── ② 结构证据：源码里 `PERMISSION_TIERS` 只在读范围那一支被读 ──
      let tsrc = null
      try { tsrc = readFileSync(MOD_TS, 'utf8') } catch { tsrc = null }
      const fnBody = tsrc === null ? null : (() => {
        const mm = /export function decideToolFace[\s\S]*?\n\}/.exec(tsrc)
        return mm === null ? null : mm[0]
      })()
      /**
       * ⚠ 口径修正（本轮实测踩到）：`PERMISSION_TIERS` 在函数体里**必然出现 2 次** ——
       *   一次是 `const tier = PERMISSION_TIERS[...]`（取值），一次是 `READ_SCOPED_TOOLS` 分支里的
       *   `tier.includes(name)`（**消费**）。⇒ 数"出现几次"是错的口径（我第一次就是这么写的，
       *   实测报 `2` ⇒ 自己红）。真正要钉的是：**`tier` 这个变量只被读范围那一支用到**。
       *   ⇒ 改判：`tier` 的**使用点**必须恰好 1 处，且那一处必须在 `READ_SCOPED_TOOLS` 分支内。
       */
      const tierUses = fnBody === null ? null : (fnBody.match(/\btier\./g) ?? []).length
      const readBranch = fnBody === null ? null : /if \(READ_SCOPED_TOOLS\.includes\(name\)\)\s*\{([\s\S]*?)\n  \}/.exec(fnBody)
      const tierInReadBranch = readBranch === null ? false : /\btier\./.test(readBranch[1])
      if (fnBody === null) probs.push('抽不出 `decideToolFace` 函数体 ⇒ 结构证据不可判（⛔ 不按通过处理）')
      else if (readBranch === null) probs.push('抽不出 `READ_SCOPED_TOOLS` 那一支 ⇒ 结构证据不可判（⛔ 不按通过处理）')
      else if (tierUses !== 1) probs.push(`\`decideToolFace\` 体内 \`tier.\` 被用 **${tierUses}** 处（应恰好 1 处 = 只在读范围那一支；多出来就是把档位用到了别处）`)
      else if (!tierInReadBranch) probs.push('`tier.` 那一处**不在** `READ_SCOPED_TOOLS` 分支里 ⇒ 档位越界到别处了')

      if (probs.length === 0 && !readChanged) {
        probs.push(`三档的读范围名数完全相同（${readCounts.join(' / ')}）⇒ 档位根本没起作用，本条没验到东西`)
      }

      if (probs.length === 0) {
        ok(`⑤o-6 ✓✓ **档位只管可读范围**（全量 ${NAMES.length} 名 · 三档逐名比对）：`
          + `**非读名 ${nonRead.length} 名的可用集合三档完全相同**（⛔ 档位不碰"能不能派活"）· `
          + `读范围名 ${readNames.length} 名随档**单调不减**且确实变了（可读数 ${readCounts.join(' → ')}）· `
          + `结构证据：\`decideToolFace\` 体内 \`tier.\` 只被用 1 处，且那一处在 \`READ_SCOPED_TOOLS\` 分支内（档位没越界）`)
      } else for (const x of probs) bad(`⑤o-6 · ${x}`)
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
// ⑤o-7 · ⑤o-6 的**专属**负向对拍
// ══════════════════════════════════════════════════════════════════════
/**
 * 手段：把 `decideToolFace` 改成**"档位越低放行越少"**（让档位越界到非读名）——
 *   即把默认放行那一支改成 `keep: level === 'workspace'`。
 *   ⇒ ⑤o-6 的"非读名三档完全相同"**必须变红**（`web_search` 之类在档1/档2 会被摘掉）。
 * ⚠ 先自证源码里**确实**有那句（否则"改不动"与"改了没用"分不开）。
 */
{
  const MOD_TS = join(root, 'src', 'preset', 'tools.ts')
  let src = null
  try { src = readFileSync(MOD_TS, 'utf8') } catch { src = null }
  const NEEDLE = "return { keep: true, unseen: !known.includes(name), why: 'default-open' }"
  const present = src !== null && src.includes(NEEDLE)
  const mutated = present
    ? src.replace(NEEDLE, "return { keep: level === 'workspace', unseen: !known.includes(name), why: 'default-open' }")
    : null
  if (!present || mutated === src) {
    bad('⑤o-7 造不出「档位越界到非读名」的变体（源码形态变了）⇒ 负向对拍不可判')
  } else {
    const tmp = join(root, 'src', 'preset', `tools.__negctl_p20t_${process.pid}.ts`)
    writeFileSync(tmp, mutated)
    try {
      const mm = await import(pathToFileURL(tmp).href + '?t=' + Date.now())
      let dm2 = null
      try {
        dm2 = await import(pathToFileURL(join(root, 'src', 'modules', 'tools.ts')).href + '?t=' + Date.now())
      } catch { dm2 = null }
      const DENY3 = Array.isArray(dm2?.DEFAULT_DENY) ? dm2.DEFAULT_DENY : []
      const probe = 'web_search'
      /**
       * ⚠ 先自证变体**真的越界了**：同一个非读名，档1 被摘、档3 保留。
       */
      const k1 = mm.decideToolFace(probe, 'ledger', DENY3, []).keep
      const k3 = mm.decideToolFace(probe, 'workspace', DENY3, []).keep
      if (!(k1 === false && k3 === true)) {
        bad(`⑤o-7 变体没造出"档位越界"（\`${probe}\`：档1 keep=${k1} · 档3 keep=${k3}）⇒ 负向对拍不可判`)
      } else {
        ok(`⑤o-7 ✓ 负向对拍（默认放行那一支改成 \`keep: level === 'workspace'\` = 档位越界到非读名）`
          + ` ⇒ ⑤o-6 的"非读名三档完全相同"**必红**：\`${probe}\` 档1 keep=${k1} · 档3 keep=${k3}（⛔ 不是恒绿）`)
      }
    } finally {
      try { rmSync(tmp, { force: true }) } catch { /* 清不掉不影响判定 */ }
    }
  }
}

console.log('草案（人读版）  :', DRAFT)
console.log('')
for (const n of note) console.log('  ✓', n)
for (const k of skip) console.log('  ·', k)
console.log('')
console.log(`  处级口径：查了 ${note.length + fail.length + skip.length} 处 · 过了 ${note.length} 处`
    + (fail.length > 0 ? ` · 没过 ${fail.length} 处` : '')
  + ` · **跳过 ${skip.length} 处**（⚠ 跳过**不计入通过**）`)
console.log('')
console.log('')
if (fail.length === 0) {
  console.log('判定：PASS —— 显示名、id、正文措辞、职责句、语言规则、人读/机器读一致、工具面声明 全部通过。')
  process.exit(0)
} else {
  console.log('判定：FAIL')
  for (const f of fail) console.log('  ✗', f)
  process.exit(1)
}
