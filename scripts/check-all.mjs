#!/usr/bin/env node
/**
 * `check:all` —— **一条命令跑完全部判据族**，并**汇总退出码**。
 *
 * ── 它解决什么（缺口有实测出处）──────────────────────────────────────────
 *   本仓原有 **12 条 `check:*`**，⛔ **没有任何聚合入口**（`package.json` 的 `scripts` 里
 *   只有 `build` / `typecheck` 与 12 条判据，没有 `check` / `test` / `verify`）。
 *   ⇒ 外部人拿到这个项目，**不知道"判据该跑哪条"**；跑了一半就以为全过了。
 *   这正是对外标准里「判据入口能**一条命令**跑」那一条不成立的直接原因。
 *
 * ── 判据（⚠ 三条，缺一条就等于没有汇总）──────────────────────────────────
 *   ① **逐族真跑**，每族**原样转发**它自己的输出（⚠ 不吞、不改写、不摘要）——
 *      "逐族打印"是被允许的，⛔ 但**必须**在末尾给汇总；
 *   ② **汇总退出码**：任一族非 0 ⇒ 整体非 0（⚠ 详见下面三档口径）；
 *   ③ ⚠ **"未执行"不许当"通过"**：某族退出码 2（基准缺失）必须**单独记一档**，
 *      并且在汇总里**点名是哪族** —— ⛔ 不允许把它并进"全绿"。
 *
 * ── 退出码（三档，与各族自己的口径对齐）──────────────────────────────────
 *   `0` = **全部族都真跑过且都通过**（⚠ 有族打 `未执行` 就不是 0）；
 *   `1` = **至少一族实际失败**（退出码 1）—— ⚠ **含"某族的检查器自己崩了"（exit 3）**，
 *         见下面「第四档」；
 *   `2` = **没有失败、但有族没能执行**（退出码 2）—— ⚠ `2` **不代表通过**。
 *   ⚠ 优先级：`1` 高于 `2`（既有真红又有未执行 ⇒ 报 1，因为失败更需要先看）。
 *
 * ── ⚠⚠ **第四档：检查器自身异常 `exit 3`（2026-10-24 · B 席 · 修归类与提示）**────────
 *   ⚠ 改前是什么（这就是本单要治的）:
 *     `verdict()` 把"非 0 且非 1"一律算 `notRun`，于是 **`exit 3`（检查器崩溃）与
 *     `exit 2`（基准缺失）落进同一个桶**，汇总行只写「· 未执行」，`:529` 的修法还写着
 *     「跑 `npm run check:preflight` 看缺什么」—— ⚠ **那是错的指路**：
 *     崩溃的修法不是"补基准"，而是"看那一族的栈"。照 preflight 走**永远修不好**。
 *   ⇒ 现在**单列一档**：
 *     · `exit 3` ⇒ `crashed`（**检查器自身异常**）—— 它**既不是**"查了不过"（1），
 *       **也不是**"没基准可查"（2），而是"**判据坏了，结论不可信**"；
 *     · 汇总行打 `✗ 检查器崩溃`（与 `✗ 失败` 同属红，但**文案不同**）；
 *     · 修法提示**分开写**：`2` ⇒ 看 preflight；`3` ⇒ 看那一族的栈（⛔ 不是 preflight）；
 *     · 聚合退出码记 **1**（⚠ 这是**有意的**：检查器坏了必须挡住入库，而 `2` 在 CI 里
 *       常被当成"环境缺东西、先放着"⇒ 会漏过去）。
 *   ⚠ 契约面：**四个族**目前用 `exit 3` 表示"检查器自身异常"
 *     （`check:hob-create-dom` / `check:policy` / `check:policy-cross` / `check:hob-create`
 *     的文件尾 `main().catch(...)` 都是 `process.exit(3)`）。
 *     ⚠ 这条契约**本文件不替它们强制**（各族自己定码），但**读法必须分清**。
 *
 * ── ⛔ 它不做什么 ───────────────────────────────────────────────────────
 *   ⛔ 不"放宽"任何一族的判据（它只是调度，判据字节未动）。
 *   ⛔ **不预设某族该是什么结果** —— 每族的期望值仍由那族自己决定。
 *   ⛔ 不写任何文件（各族的临时件仍由各族自己管，且都在系统临时目录里）。
 *
 * ── 判据模的传参（2026-10-19 新增 · `TASK-C`；⚠ 2026-10-24 订正**这条注释曾与实现不符**）──
 *   ⚠ `check:build` 的**面 ③**（运行实例 vs 产物）有**两档跑法**：
 *     · 单独跑 `npm run check:build` ⇒ **报警模**（落后只打印，⛔ 不 FAIL）；
 *     · 加 `--strict-instance` ⇒ **判据模**（落后 exit 1 · 判不出 exit 2）。
 *   ⚠ ⚠ **订正（B 席 · 2026-10-24）**：本条注释此前写成"由**本聚合入口**跑 ⇒ 判据模
 *     （`--strict-instance`）"，而实现里 `STRICT_FAMILIES` 只传 `--strict-source`
 *     （下一段 `:56` 明写「⚠ **不加**」）—— **注释与实现直接矛盾**，
 *     读的人会以为 `npm run check` 已经让面 ③ 长牙。⇒ 现在按实现改写：
 *     **本入口不传 `--strict-instance`**，面 ③ 在 `npm run check` 里**仍然只报警**。
 *     ⚠ 这不是"放宽"，是把话说对：真正可能恒红的那一档（刚 build 完还没重启）
 *     刻意不进总门，理由见 `STRICT_FAMILIES`。
 *   ⚠ ⛔ 本入口**不改**那族判据的任何一个字节：它只多传开关（`STRICT_FAMILIES`）。
 *     ⚠ 同理**不改** `verdict()` —— 那三档口径（1 失败 / 2 未执行）本来就够了。
 *
 * ── 用法 ───────────────────────────────────────────────────────────────
 *   `npm run check`（= `npm run check:all`）· 或 `node scripts/check-all.mjs`
 *   想看"哪几族现在跑不了、怎么补" ⇒ `npm run check:preflight`（⚠ 那一条只体检，不跑判据）。
 */

/**
 * ⚠ 检查器自身异常的退出码（与上面「第四档」同源）。
 *   ⚠ 它是**约定**，不是本文件造出来的：四个族的 `main().catch` 都 `process.exit(3)`
 *     （`check-hob-create-dom.mjs:1223` / `check-session-policy.mjs:1651` /
 *       `check-policy-cross-instance.mjs:444` / `check-hob-create-ui.mjs:2005`）。
 */
export const CHECKER_CRASH_CODE = 3

/**
 * **判据模**才传的族 → 额外参数。
 *
 * ⚠ 只有 `check:build`：它的面 ③ 需要「运行实例」这个**外部**读数，而在日常开发中间态
 *   落后是**必然**的（刚 build 完还没重启）⇒ 缺省只报警，⛔ 不能让它把 `npm run check` 搞成恒红。
 * ⚠ 加族时**必须**同时想清"它恒不恒红"—— ⛔ 别把新的恒红引入本入口。
 */
const STRICT_FAMILIES = new Map([
  /**
   * ⚠⚠ **第 325 轮 · 甲-6**：本族现在收**两个**开关，各管一面、⛔ 不合并 ——
   *
   *   · `--strict-instance` 管**面 ③**（运行实例 vs 产物）：⚠ **不加**。它恒红的风险
   *     来自"刚 build 完还没重启"，而本入口是在**用户没重启**的情况下跑的 ⇒ 加了会把
   *     `npm run check` 搞成**恒红**（正是本文件上面那段注释警告的那件事，红线第 5 条也禁）。
   *   · `--strict-source` 管**面 ①②**（产物 vs 源）：⚠ **加**。它恒红的风险来自
   *     "刚改完源码还没 build" —— 那是**可以立刻消掉的中间态**（跑一次 `npm run build`），
   *     而它漏过去的代价正是本项目最痛的那类故障：**「改了 `src` 却不生效」**
   *     （第 321 轮活例：三处修复改完、`BUILD-STAMP` 已更新，实例仍跑旧逻辑，
   *      而 `check:all` 当时**并不因这件事变红**）。
   *
   * ⚠ **判据**：面 ①② 落后 ⇒ `exit 1`（"查了、且有问题"）；面 ①② **基准缺失**
   *   （戳读不到 / 无 `lib/`）仍走 `exit 2`（"没有基准可判"）—— 两者 ⛔ 不压成同一个码。
   * ⚠ 面 ③ 的语义**一个字未动**（红线第 4 条）：它仍由 `--strict-instance` 单独控制。
   */
  ['check:build', ['--strict-source']],
])
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { preflight, printPreflight } from './preflight.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

/**
 * 判据族清单 —— ⚠ **派生自 `package.json` 的 `scripts`**（⛔ 不手抄一张会漂的期望表）。
 *
 * 判据口径与 `check-repo-rules.mjs` 的「脚本落点」同源：
 * **`scripts` 里 `check:*` 那批就是判据族**，除此之外的不是（`build` / `typecheck` / `exp:*` / `gen:*`）。
 * ⚠ 显式排除本脚本与预检自身（否则自己调自己）。
 */
const SELF = new Set(['check:all', 'check:preflight'])

/**
 * ── ⚠⚠ **族数下界（2026-10-24 · B 席 · 治"删一族也不红"）**──────────────────────
 *
 * ── 改前是什么（这就是本单要治的）──────────────────────────────────────────
 *   `listFamilies()` **纯派生**自 `package.json` 的 `scripts`：`check:*` 有几条就算几族。
 *   ⇒ ⚠ **没有下界**：把 `check:policy-cross` 整条从 `scripts` 里删掉（连带脚本文件），
 *     族数 **20 → 19**，而 `check:all` **照样全绿 exit 0**。
 *   ⚠ 这是"派生式清单"的**固有盲区**：派生解决了"清单会漂"，但**解决不了"派生源自己少了"**
 *     （`E-160` 同族：覆盖面静默缩水而判据照旧绿）。
 *
 * ── 现在 ──────────────────────────────────────────────────────────────
 *   给一个**显式下界**：族数 `< FAMILY_FLOOR` ⇒ **`exit 1`**（"查了、且有问题"）。
 *   ⚠ 下界**只准升不准降**：真要有意删一族，必须**同一批**改这个常量并写明理由
 *     （那是"有意识的收缩"，与"悄悄少一族"必须可区分）。
 *   ⚠ 为什么是 20：本仓当前实测 = 20 族（`npm run check:all` 的汇总行）。
 */
export const FAMILY_FLOOR = 20

/**
 * ── ⚠⚠ **断言数下界（同一批）——"九组断言全摘仍 PASS"**────────────────────────
 *
 * ── 改前是什么 ─────────────────────────────────────────────────────────
 *   汇总行只**加总**各族自报的"查了"处数，**没有任何下界**：
 *   ⚠ 把某族里一整组断言（含它的 `ok()` 调用）摘掉，只是让那个数**变小**，
 *     判定行**照样 PASS** —— "查了 1244 处"变成"查了 498 处"，而读数**没有人核**。
 *
 * ── 判据（两条，各自能失败）────────────────────────────────────────────
 *   ① **每族一条下界**（`ASSERTION_FLOORS`）：该族自报的"查了"**不得低于**登记值；
 *   ② ⚠ **不设"总数下界"**（首版设过，实测口径错误 —— 见下面那段"为什么只有每族一档"）。
 *   ⚠ 登记值 = **本轮实测**（见各行的注释）；⚠ 只准升不准降，理由同族数下界。
 *   ⚠ 只对**真的报了口径**的族判：某族若因基准缺失落 `exit 2`，它本来就不在
 *     `reported` 里（⚠ 那时整体已经非 0，⛔ 不需要这条再补一刀）。
 *   ⚠ 这一条**不猜**：读不到 `查了 N 处` ⇒ 该族不进比较，但**必须**在汇总里点名
 *     （已有的"N 族结构上没能报这个口径"那段就是它）。
 */
export const ASSERTION_FLOORS = new Map([
  ['check:archive', 119],
  ['check:client', 49],
  ['check:config', 58],   // ⚠ 本族处数随 src 分支状态在 58–60 间浮动 ⇒ 取下界 58（绿态最小值）
  ['check:experience', 8],
  ['check:gitignore', 529],  // t11 新增 H8/H9/H10/H11（并发队列 / mode 保留 / 偏移消费 / §7 主读守卫）
  ['check:hob-create', 53],
  ['check:hob-create-dom', 30],  // t10 新增 D-18b（真 DOM 两次渲染的开放面对照）
  ['check:hob-gate', 27],  // t10 的 G-21 系列；t11 只改实现（不再加条数），标签数不变
  ['check:host', 9],
  ['check:modules', 11],
  ['check:orch', 230],  // t11 新增 O-f0 / SM-c1 / SM-c2 / WW / Z0 / SB-4（六条，SQ-a 只加判据不加条数）
  ['check:policy', 46],  // t10 新增 SP-10b（visibleNamesFor 的 st !== 'absent'）
  ['check:policy-cross', 13],
  ['check:presets', 224],
  ['check:profile', 3],
  ['check:readings', 3],
  ['check:redeliver', 10],
  ['check:rounds', 4],
  ['check:selfwake', 3],
  // ⚠ `check:build` 不在此表：它的"处"是**读数行**、分母不同（`per-reading-line`），
  //   与逐条断言不可比 —— 把它塞进这张表就是本仓明令禁止的"混量纲"。
])
/**
 * ── ⚠⚠ **为什么只有"每族一档"、没有"总数下界"**（2026-10-24 · B 席 · 自证后的订正）──
 *   首版还加了一条 `ASSERTION_TOTAL_FLOOR = 1458`（= 全绿那一跑的 19 族之和）。
 *   ⚠ 实跑立刻暴露它是**错的口径**：**某一族变红时它的"查了"会合法变小**
 *     （`bad()` 之后那些组按设计**提前收手**、不再逐条跑）⇒ 总数下降**并不等于**
 *     "有人摘了断言"。把这两件事混成一个判据 = 造一条**会误报的恒红**（本仓最忌）。
 *   ⇒ 现在只有**每族一条**下界，且**只对"跑绿了的族"生效**（见下面的 `greenReported`）：
 *     一族跑绿、却报了比登记更少的处数 ⇒ **没有合法解释** ⇒ 那才是"断言被摘掉"。
 *   ⚠ 合计数仍有**派生**上界意义：每族都 ≥ 自己的下界 ⇒ 合计自动 ≥ 各自下界之和。
 *     所以"总数下界"是**被蕴含**的，不需要也不应该另立一条会更漂的口径。
 */

export function listFamilies() {
  let scripts = {}
  try {
    scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {}
  } catch { scripts = {} }
  return Object.keys(scripts)
    .filter((k) => k.startsWith('check:'))
    .filter((k) => !SELF.has(k))
    .sort()
}

/**
 * 每族的 `package.json` 命令（⚠ 给"族数下界"的报错指名用）。
 * ⚠ 读不到 ⇒ 空表（⛔ 不猜命令内容）。
 */
export function familyCommands() {
  let scripts = {}
  try { scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {} } catch { return {} }
  return scripts
}

/**
 * 从一族自己的输出里读它报的**跳过数**（第 349 轮 · 甲-1 甲方案）。
 *
 * ── 为什么要读输出 ────────────────────────────────────────────────────
 *   各族把"跳过 / 未执行"的明细打在自己的正文里，**退出码表达不了"这一族查了、
 *   但有几处没查"**（退出码只有 0/1/2 三档，且 `2` 已被"整族没对象"占用）。
 *   ⇒ 甲方案让各族在自己的汇总里印一行**机器可读的口径**：
 *     `` `跳过 N 处（⛔ 不计入通过）` ``
 *   本函数只认这一个形状，⛔ 不猜、⛔ 不拿"未执行"三个字去模糊匹配。
 *
 * ⚠ **读不到 ⇒ 0**（不是错）：没印这一行 = 这一族没有跳过，或还没接入甲方案。
 *   ⚠ 这**不会**把"跳过"洗成"没跳过" —— 因为接入了甲方案的族**必然**印那行
 *   （由 `skip()` 负责，见各族实现）；没接入的族本来就在旧口径上，本单不假装它们已接入。
 *
 * @param out - 该族 stdout（已解码）。
 * @returns 跳过处数（读不到 ⇒ 0）。
 */
export function parseSkipCount(out) {
  if (typeof out !== 'string' || out === '') return 0
  /** ⚠ 只认 `跳过 N 处` 这一种形状（取**最后一条**：一族若印了多次，以最后一次汇总为准）。 */
  /**
   * ⚠ 单位是 `处` **或** `组`（2026-10-23 · Q-3）：`check:hob-create-dom` / `check:hob-gate`
   *   两族按"组"跳过（`跳过 1 组（⛔ 不计入通过）`），旧正则只认 `处` ⇒ 这两族的跳过
   *   被读成 0，汇总行印「跳过 0 处」而族内明明跳了 1 组 —— "没跑"与"都跑了"变成同一个数。
   *   ⚠ 两种单位**不混量纲**：只取最后一次命中，且值原样进汇总（不乘组大小）。
   */
  const all = [...out.matchAll(/跳过\s*(\d+)\s*[处组]/g)]
  if (all.length === 0) return 0
  const n = Number(all[all.length - 1][1])
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/**
 * 从一族输出里读**它报的断言总数**（"查了几处"）。
 *
 * ⚠ 与 `parseSkipCount` **必须同源同形**：两者都来自那一行
 *   ``处级口径：查了 N 处 · 过了 M 处 · 跳过 K 处``
 *   ⇒ 读不到整行就两个都不认（`undefined`），⛔ 不许一个认、一个猜。
 *
 * @returns 断言总数；读不到 ⇒ `undefined`（**不是 0** —— 0 会冒充"查了 0 处"）。
 */
export function parseAssertionCount(out) {
  if (typeof out !== 'string' || out === '') return undefined
  const all = [...out.matchAll(/查了\s*(\d+)\s*处/g)]
  if (all.length === 0) return undefined
  const n = Number(all[all.length - 1][1])
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/**
 * 从一族输出里读**它自己报的「过了几处」**。
 *
 * ── ⚠⚠ 为什么必须读它，而不是在汇总层重算（2026-10-22 · SRE · 修「负数被改写成正数」）──
 *   改前汇总层从不用这一项：`过了 = assertions - skipped` **自己重算**。
 *   ⇒ 一族自报 `过了 -1 处`（实测 `check:build` 真会出现）时，汇总层印的是
 *     `过了 <assertions> 处` —— **把一个不存在的数改写成好看的正数**，
 *     而唯一能发现它的 `:344` 恒假自检又永远不红。三层叠加 = 负数**不可观测**。
 *   ⇒ 现在：**族自报值优先**；汇总层只在族没报时才对 `查了 - 跳过` 兜底，
 *     并在同一次输出里**点名"这几族是自算的"**（⛔ 不许静默）。
 *
 * ⚠ **负数必须原样读出来**（`-?\d+`）：允许负数不是为了让它合法，而是为了让它**可见**。
 *   `Number.isFinite` 放行负数；⛔ **不 clamp 成 0** —— clamp 就是重新把它洗白。
 *
 * @returns 该族自报的"过了"处数；读不到 ⇒ `undefined`（**不是 0**）。
 */
export function parsePassedCount(out) {
  if (typeof out !== 'string' || out === '') return undefined
  const all = [...out.matchAll(/过了\s*(-?\d+)\s*处/g)]
  if (all.length === 0) return undefined
  const n = Number(all[all.length - 1][1])
  return Number.isFinite(n) ? n : undefined
}

/**
 * 从一族输出里读**它自报的「没过几处」**（★ 只有少数族会报这一项）。
 *
 * ── 为什么需要它（2026-10-23）──────────────────────────────────────────
 *   `check:build` 的"查了"= ✓ 读数 + ✗ 读数，而"过了"只数 ✓ ⇒ 它的等式是
 *   ``查了 = 过了 + 没过 + 跳过``。汇总层若只核 `查了 = 过了 + 跳过`，
 *   就会把这一族**误判成"族内等式不成立"**（假红）。
 *   ⇒ 报了这一项的族按三项核；**没报的族仍按两项核**（⛔ 不硬编码族名）。
 *
 * @returns 该族自报的"没过"处数；读不到 ⇒ `undefined`（**不是 0** —— 0 与"没这一项"不同）。
 */
export function parseFailedCount(out) {
  if (typeof out !== 'string' || out === '') return undefined
  const all = [...out.matchAll(/没过\s*(-?\d+)\s*处/g)]
  if (all.length === 0) return undefined
  const n = Number(all[all.length - 1][1])
  return Number.isFinite(n) ? n : undefined
}

/**
 * ── ⚠⚠ **读这一族的"处"是什么分母**（2026-10-21 · 第 351 轮）────────────────
 *
 * ── 为什么必须读它（汇总行的混量纲）──────────────────────────────────────
 *   第 350 轮的汇总行把当时 15 族的"处"**直接相加**得到 `1178`。但至少有一族
 *   （`check:build`）的"处"是**读数行数**、不是**逐条断言数** ——
 *   ⇒ 那个 `1178` 是**混了量纲的数**，而本仓纪律明写"不同量纲 ⛔ 不可相加"。
 *
 * ── 怎么判（⛔ 不硬编码族名）──────────────────────────────────────────────
 *   判据 = **这一族自己的口径行里有没有那个显式标注**
 *   （`check:build` 印的是「本族口径按**读数行**、非逐条断言」）。
 *   ⇒ 「显式声明了分母」的族进**单列**组；没声明的按**逐条断言**（缺省口径）。
 *   ⚠ 这样判的**好处**：将来任何一族只要自己在输出里声明分母不同，就**自动**被单列，
 *     ⛔ 不需要在 `check-all.mjs` 里维护一张会漂的族名表（`E-128`：同一事实两个来源必然漂）。
 *   ⚠ 这一族"声明了分母"这件事本身要能被看见 —— 见 `printSummary` 的单列输出。
 */
export function parseDenominatorKind(out) {
  if (typeof out !== 'string' || out === '') return 'per-assertion'
  /**
   * ⚠ 只认**口径行里**那句显式标注（⛔ 不通扫全文：正文里讲"分母"的段落很多，
   *   通扫会把本来同分母的族误判成异分母）。
   */
  const line = out.split('\n').find((l) => l.includes('处级口径')) ?? ''
  if (line.includes('按') && line.includes('读数行')) return 'per-reading-line'
  return 'per-assertion'
}

/** 逐族真跑，收集 `{name, code, ms, skipped}`。 */
export function runFamilies(names) {
  const results = []
  for (const name of names) {
    const started = Date.now()
    console.log('')
    console.log('═'.repeat(72))
    console.log(`▶ ${name}`)
    console.log('═'.repeat(72))
    const extra = STRICT_FAMILIES.get(name) ?? []
    /**
     * ⚠⚠ **`stdio` 从 `inherit` 改成 `pipe`**（2026-10-21 · 第 349 轮 · 甲方案）：
     *   要读各族自己报的"跳过 N 处"就必须**拿到它的 stdout**；`inherit` 直接透传到
     *   终端、父进程读不到。
     * ⚠ **但输出一个字都不能少**：拿到之后**原样转发**到 `process.stdout/stderr`
     *   （见下），所以人看到的仍是逐族全量输出 —— ⛔ 不许因为要解析就把日志吞掉。
     * ⚠ 两族之间本来就是**串行**（`for` 循环 + `spawnSync`）⇒ 转发**不会乱序**。
     */
    const r = spawnSync('npm', ['run', '--silent', name, ...(extra.length > 0 ? ['--', ...extra] : [])], {
      cwd: root,
      stdio: ['inherit', 'pipe', 'pipe'],
      encoding: 'utf8',
      // ⚠ 不设 timeout：有一族要跑 60+ 秒（真跑组）；超时会把它误报成失败。
      shell: process.platform === 'win32',
      // ⚠ 输出可能较大（`check:orch` 单族几百行）⇒ 给足缓冲，⛔ 不让它被截断成"读不到"。
      maxBuffer: 64 * 1024 * 1024,
    })
    const stdout = typeof r.stdout === 'string' ? r.stdout : ''
    const stderr = typeof r.stderr === 'string' ? r.stderr : ''
    /** ⚠ **原样转发**（人看到的与 `inherit` 时一致）。 */
    if (stdout !== '') process.stdout.write(stdout)
    if (stderr !== '') process.stderr.write(stderr)
    const code = typeof r.status === 'number' ? r.status : 1
    results.push({
      name, code, ms: Date.now() - started,
      skipped: parseSkipCount(stdout),
      ...(parseAssertionCount(stdout) === undefined ? {} : { assertions: parseAssertionCount(stdout) }),
      /**
       * ⚠ **族自报的「过了」**（2026-10-22 · SRE）：⚠ 与 `assertions` **同源同形**，
       *   读不到两者都不认 —— 见 `parsePassedCount` 头注（负数原样读、⛔ 不 clamp）。
       */
      ...(parsePassedCount(stdout) === undefined ? {} : { passed: parsePassedCount(stdout) }),
      /**
       * ⚠ **族自报的「没过」**（★ 可选；只有 `check:build` 这类"✗ 读数进分母"的族会报）：
       *   报了的族按 `查了 = 过了 + 没过 + 跳过` 核等式，⛔ 不许因此把它判成假红。
       */
      ...(parseFailedCount(stdout) === undefined ? {} : { notPassed: parseFailedCount(stdout) }),
      /**
       * ⚠ **这一族的"处"是哪种分母**（第 351 轮）：决定它进总数还是进单列。
       */
      denominator: parseDenominatorKind(stdout),
    })
  }
  return results
}

/**
 * 汇总判定：**三档**（2026-10-21 · 第 331 轮 · 本批主目标）。
 *
 * ── 三档的定义（⛔ 不许混）──────────────────────────────────────────────
 *   · `exit 0` 的族 ⇒ **通过**（`passed`）     —— 真跑过、且通过；
 *   · `exit 1` 的族 ⇒ **失败**（`failed`）     —— 真跑过、但查出违规；
 *   · **其余**（`2` 及其它非 0/1）⇒ **未执行**（`notRun`）—— 没有对象 / 基准缺失，
 *     ⚠ 它**没有替你检查任何东西**，⛔ 既不是通过、也不是失败。
 *
 * ── 退出码怎么排（要求 3），以及为什么 ────────────────────────────────
 *   全 `0` ⇒ **0**；有 `1` ⇒ **1**；无 `1` 但有 `2` ⇒ **2**；两者同时 ⇒ **1**。
 *
 *   ⚠ **为什么"失败优先于未执行"**（这是本批要说明的那个排法）：
 *     ① **可操作性**：`1` 的修法是"去看那族的原文、修判据或被测对象"，动作明确、**当轮就能做**；
 *        `2` 的修法常常是"这台机器上没有那个对象"（如没有 `.hob/experience/`），
 *        可能**压根不是缺陷**。⚠ 把"确定有问题"压在"可能只是缺对象"后面，会让人先去补环境、
 *        而真缺陷继续挂着。
 *     ② **信息量**：`1` 意味着**某条判据被真的违反了**；`2` 只意味着**某条判据没跑**。
 *        ⚠ 前者是"已知的坏"，后者是"未知"——已知优先于未知。
 *     ③ **不许两头洗**（红线 2）：把 `1` 洗成 `2` = 把"查到违规"降级成"没查"；
 *        把 `2` 洗成 `0` = 把"没查"冒领成"通过"。⚠ 本函数两个方向都没洗：
 *        `2` 只在**没有任何 `1`** 时才成为退出码，且 `notRun` **一次都没被丢弃**
 *        （它始终随返回值回带，汇总行始终打印它）。
 *
 * ⚠ **`notRun` 这个名字不许消失**（要求 4）：它是别人已在用的读数
 *   （`check-*.mjs` 与本文件的汇总行都按它计数）。本批**保持原名**、语义不变。
 */
export function verdict(results) {
  const passed = results.filter((r) => r.code === 0)
  /**
   * ⚠⚠ **`failed` 现在**含 `exit 3`（检查器自身异常）**（2026-10-24 · B 席 · 第四档）**——
   *   改前 `failed` 只认 `code === 1`，`3` 落进 `notRun` ⇒ 汇总行打「· 未执行」
   *   并给"跑 preflight"这个**错的修法**。⚠ 检查器崩了意味着**它的结论根本不可信**，
   *   与"查出违规"同属"必须挡住入库"那一类 ⇒ 归入 `failed`，同时**保留 `crashed` 单列**
   *   （⛔ 不让它被 `exit=1` 那一档吞掉，因为两者的修法完全不同）。
   */
  const crashed = results.filter((r) => r.code === CHECKER_CRASH_CODE)
  const failed = results.filter((r) => r.code === 1 || r.code === CHECKER_CRASH_CODE)
  /**
   * ⚠ **"未执行"只剩 `2`（与其它任何非 0/1/3 的异常码）** ——
   *   语义 = "没有基准 / 没跑起来"，**修法是补基准**（与 `crashed` 分开）。
   */
  const notRun = results.filter((r) => r.code !== 0 && r.code !== 1 && r.code !== CHECKER_CRASH_CODE)
  if (failed.length > 0) return { exit: 1, passed, failed, crashed, notRun }
  if (notRun.length > 0) return { exit: 2, passed, failed, crashed, notRun }
  return { exit: 0, passed, failed, crashed, notRun }
}

export function printSummary(results) {
  const v = verdict(results)
  console.log('')
  console.log('═'.repeat(72))
  console.log('汇总 · dsh-hob 判据全族')
  console.log('═'.repeat(72))
  for (const r of results) {
    /**
     * ⚠⚠ **三档标签**（2026-10-21 · 第 331 轮）：`✓ 通过` / `✗ 失败` / **`· 未执行`**。
     *
     * ⚠ 改前第三档打的是 `⚠ 未执行` —— 那个 `⚠` 与"失败"的 `✗` 在视觉上**同属告警色**，
     *   而两者的语义**完全不同**：一个要人去修判据，一个要人去补基准。
     *   ⇒ 现在用 `·`（中性分隔号）：它**不参与判定**，与"通过"的 `✓`、"失败"的 `✗` 都不撞色。
     *   ⚠ 这是纯**显示层**改动，⛔ 不影响任何退出码（三档口径仍是 `verdict()` 那一处）。
     */
    /**
     * ⚠ **第四档的标签**（2026-10-24 · B 席）：`exit 3` 打 `✗ 崩溃` —— ⛔ 不许并进
     *   `· 未执行`（那会把"检查器坏了、结论不可信"说成"没基准可查"，修法指向 preflight
     *   就永远修不好）。
     */
    const tag = r.code === 0 ? '✓ 通过'
      : r.code === 1 ? '✗ 失败'
        : r.code === CHECKER_CRASH_CODE ? '✗ 崩溃'
          : '· 未执行'
    /**
     * ⚠ **第四列只在该族真有跳过时才出现**（第 349 轮 · 甲方案）：
     *   正常路径（跳过 0 处）⇒ **这一列一个字都不多** ⇒ 既有输出逐字不变
     *   （TASK §三"不该咬：正常路径输出逐字不变"的落点就在这一行）。
     */
    const skipCol = (r.skipped ?? 0) > 0 ? `  跳过 ${r.skipped} 处` : ''
    console.log(`  ${tag.padEnd(8)} ${r.name.padEnd(18)} exit=${r.code}  ${(r.ms / 1000).toFixed(1)}s${skipCol}`)
  }
  console.log('')
  console.log(`  共 ${results.length} 族：通过 ${results.filter((r) => r.code === 0).length}`
    + ` · 失败 ${v.failed.filter((r) => r.code === 1).length}`
    + ` · 崩溃 ${v.crashed.length} · 未执行 ${v.notRun.length}`)
  /**
   * ── ⚠⚠ **族数下界**（2026-10-24 · B 席）─────────────────────────────────
   *   改前：这里只印一个总数、**没有下界** ⇒ 删掉一族（`20 → 19`）**照样全绿**。
   *   现在：`< FAMILY_FLOOR` ⇒ 单列一条 **✗**，并把退出码**拉到 1**（见函数尾）。
   *   ⚠ 这条错误**不进 `v.failed`**（那是"某族自己报失败"的桶）⇒ 用局部变量带出去，
   *     判定行走**新的一档文案**，⛔ 不许悄悄改 `VERDICT_TEXT` 的既有三句。
   */
  const familyFloorBroken = results.length < FAMILY_FLOOR
  if (familyFloorBroken) {
    console.log(`  ✗ **族数下界被突破**：只跑了 **${results.length}** 族，而登记的下界是 **${FAMILY_FLOOR}**`
      + '（⚠ 族表是**派生**自 `package.json` 的 `check:*` ⇒ 删一族不会留下任何痕迹）'
      + '\n      ⇒ 若有**有意**收缩，必须同批改 `check-all.mjs` 的 `FAMILY_FLOOR` 并写明理由；'
      + '否则就是"某族被悄悄删掉 / 改名成非 `check:*`"—— 那正是本下界要抓的'
      + '（实测改前：把 `check:redeliver` 改名成 `gen:redeliver` ⇒ 族数 20→19，`check:gitignore` 仍 PASS）')
  } else {
    console.log(`  ✓ 族数下界：**${results.length}** 族 ≥ 下界 **${FAMILY_FLOOR}**`
      + '（⚠ 下界只准升不准降：有意收缩须同批改常量并写明理由）')
  }
  /**
   * ── ⚠⚠ **汇总行必须回答三件事**（第 349 轮 · TASK §二 硬要求 3）──────────────
   *   **查了几处 · 过了几处 · 跳了几处**。
   *   ⚠ 这一行的语义与上面那行（族级三档）**不是同一层**，⛔ 不许混：
   *     · 上面那行 = **族**（全部族里几族通过/失败/崩溃/未执行 —— ⚠ **族数以 `listFamilies()` 实测为准**，⛔ 不在文案里写死）；
   *     · 这一行 = **处**（各族自己报的断言数里，过了几处、跳了几处）。
   *   ⚠ `跳过 0 处` 时**仍然印这一行**（"没有跳过"是个有价值的读数，
   *     ⛔ 不许因为"是 0"就不印 —— 那会把"没查"与"没跳过"重新糊起来）。
   */
  /**
   * ── ⚠⚠ **两种分母分开报**（2026-10-21 · 第 351 轮 · 修混量纲）──────────────
   *
   * ── 改前是什么（这就是本单要治的）──────────────────────────────────────
   *   第 350 轮把当时 15 族的"处"**直接相加**：`1178`。但 `check:build` 的"处"
   *   是**读数行数**、不是**逐条断言数** ⇒ 那个 1178 是**混了量纲的数**。
   *   本仓纪律明写「不同量纲 ⛔ 不可相加」，这一行正是反例。
   *
   * ── 现在（甲方案 · 折中版）────────────────────────────────────────────
   *   ① **同分母的族**（`per-assertion`）⇒ 给出**总数**，并**点名它覆盖哪几族**；
   *   ② **异分母的族**（`per-reading-line`）⇒ **单列**、**明写"未计入总数"**；
   *   ③ 两组的族名都点出来 —— ⛔ 不许让读者自己去数"总数含谁、不含谁"。
   *   ⚠ `查了 = 过了 + 跳过` 这条等式**在每一族内部仍然成立**（本单未放松）——
   *     各族自己印的那一行没变，只有**上面的加总**改了。
   *   ⚠ **覆盖率**这个读数**保留**（按"报了口径的族数 / 总族数"算，与分母无关）；
   *     ⚠ 具体数字**由实测决定**（⛔ 不写死 `15/15` —— 族数会变，写死就是一条会漂的计数）。
   */
  const reported = results.filter((r) => typeof r.assertions === 'number')
  const notReported = results.filter((r) => typeof r.assertions !== 'number')
  const sameDenom = reported.filter((r) => r.denominator !== 'per-reading-line')
  const otherDenom = reported.filter((r) => r.denominator === 'per-reading-line')
  const sumOf = (rows, f) => rows.reduce((s, r) => s + f(r), 0)
  /**
   * ⚠⚠ **"过了"的取数点只有一处**（2026-10-23 · 修 P0-4 半接线）
   *
   * ── 改前是什么（这就是本单要治的）────────────────────────────────────
   *   上一轮把 `parsePassedCount()` 建好了、也接进了 `runFamilies`，但**汇总层没接线**：
   *   `passSame` 仍写 `assertions - skipped` **自算** ⇒ 族自报 `过了 -1 处`（`check:build`
   *   实测真会出现）时，汇总行照样印成一个好看的正数；而唯一能抓住它的族内自检
   *   （下面 `:373`）是**代数恒真**的 ⇒ 负数不可观测。**解析器建好不接线，比没建更坏**
   *   ——它让人以为已经修了。
   *
   * ── 现在 ──────────────────────────────────────────────────────────────
   *   `passedOf(r)` = **族自报值优先**，只有族没报时才退回 `assertions - skipped`，
   *   并把"这几族是自算的"**点名印出来**（⛔ 不许静默兜底）。
   */
  const passedOf = (r) => (typeof r.passed === 'number' ? r.passed : r.assertions - (r.skipped ?? 0))
  const selfComputed = sameDenom.filter((r) => typeof r.passed !== 'number')
  const chkSame = sumOf(sameDenom, (r) => r.assertions)
  const passSame = sumOf(sameDenom, passedOf)
  const skipSame = sumOf(sameDenom, (r) => r.skipped ?? 0)
  const covers = reported.length === results.length

  /**
   * ⚠ **总数只统计"同一分母"的族**，并**点名覆盖范围**（⛔ 不许让读者猜）。
   */
  console.log(`  处级口径（**逐条断言**分母 · ${sameDenom.length} 族）：`
    + `查了 ${chkSame} 处 · 过了 ${passSame} 处 · **跳过 ${skipSame} 处**`
    + `（⚠ 跳过**不计入通过**）`)
  console.log(`      ↳ 覆盖：${sameDenom.map((r) => r.name).join(' · ') || '(无)'}`)
  if (selfComputed.length > 0) {
    console.log(`      ⚠ 其中 **${selfComputed.length} 族没自报「过了」**、由汇总层按 \`查了−跳过\` 兜底：`
      + selfComputed.map((r) => r.name).join(' / ')
      + ' ⇒ ⛔ 这几族的"过了"不是族报的读数，别当独立证据')
  }

  /**
   * ⚠ **异分母族单列**：明写"未计入总数"，并说明它按什么数。
   *   ⛔ 若有一天某族自己声明了不同分母，它会**自动**落到这一段（不需要改本文件）。
   */
  if (otherDenom.length > 0) {
    for (const r of otherDenom) {
      /**
       * ⚠⚠ **单列行也必须用族自报的「过了」，⛔ 不许在这里再自算一次**（2026-10-23 · SRE）──
       *   改前这一行写 `r.assertions - (r.skipped ?? 0)` —— 与本文件 :377 `passedOf` **两处算法**。
       *   ⇒ 同一个族在"总数行"和"单列行"会印出**两个不同的"过了"**（实测 `check:build`
       *     自报 `过了 2`，单列行却印 `过了 5`）。同一事实两个来源必然漂（`E-128`），
       *   ⇒ 这里统一走 `passedOf()`，**取数点只有一处**。
       */
      const missedCol = typeof r.notPassed === 'number' ? ` · 没过 ${r.notPassed}` : ''
      console.log(`  ⚠ **未计入上面的总数**（分母不同）：${r.name}`
        + ` ⇒ 查了 ${r.assertions} · 过了 ${passedOf(r)}${missedCol} · 跳过 ${r.skipped ?? 0}`
        + `（⚠ 本族口径按**读数行**、非逐条断言 ⇒ ⛔ 不可与上面那个总数相加）`)
    }
  }

  /**
   * ⚠ **覆盖读数保留**（硬要求 3：覆盖率**不许退回去** —— ⚠ 判的是"有没有族漏报"，
   *   数字由实测印出，⛔ 不写死成 `15/15`）。
   */
  console.log(`  覆盖率：**${reported.length}/${results.length} 族**报了这个口径`
    + (covers ? '，**全覆盖**' : ''))

  /**
   * ── ⚠⚠ **断言数下界：每族一条 + 总数一条**（2026-10-24 · B 席 · 治"摘断言不红"）────
   *
   * ── 改前是什么（这就是本单要治的）──────────────────────────────────────
   *   汇总行只**加总**"查了 N 处"，**没有任何下界** ⇒ 把某族里一整组断言（含它的
   *   `ok()` 调用）摘掉，那个数**只是变小**，判定行**照样 PASS**
   *   （实测：九组断言全摘仍 PASS、只是 1244 变成 498）。
   *   ⚠ 这是"读数只报不核"的典型：**报了数字，但数字降了没人管**。
   *
   * ── 判据（⛔ 不猜、⛔ 不兜底）──────────────────────────────────────────
   *   · 只对**自报了口径**（`reported`）的族判 —— 没报的族已有上面那段点名，⛔ 不重复；
   *   · 每族 `查了 < ASSERTION_FLOORS.get(name)` ⇒ **记一条 over-floor 违规**；
   *   · ⚠ **不核"总数"**：跑红的族其处数会**合法变小**，混进来就是误报（详见下面那段）；
   *   · 两样一起进判定行与退出码（见函数尾）。
   *   ⚠ 缺登记（族在 `reported` 里但 `ASSERTION_FLOORS` 没有它）**也记一条**：
   *     否则"新加一族忘了登记下界"就变成一个静默的新口子（`E-122` 同族）。
   */
  const floorViolations = []
  /**
   * ⚠ **只对"逐条断言"分母 + 跑绿了的族**判下界：
   *   · `check:build` 的"处"是**读数行**（分母不同）⇒ 登记"断言下界"就是混量纲；
   *   · 跑红了的族其"查了"会**合法变小**（`bad()` 之后按设计提前收手）⇒ 不能拿它判。
   *   ⚠ 但它**跑绿**却没报够 ⇒ **没有任何合法解释** ⇒ 那才是"断言被摘掉"。
   */
  const greenReported = sameDenom.filter((r) => r.code === 0)
  /**
   * ── ⚠⚠ **跑绿了却压根没报口径 ⇒ 也算违规**（2026-10-24 · B 席）────────────────
   *   改前：没有这口气。表现是 `check:hob-create-dom` / `check:hob-gate` **只印
   *   "汇总：通过 N · 失败 M"** ⇒ 断言数不进总数、下界对它们**是盲的**
   *   （摘掉几条断言照样全绿）。⇒ 现在把"跑绿但不报口径"本身记一条违规。
   *   ⚠ 只对**跑绿的族**要求：跑红 / 未执行的族其口径行可能因为提前收手而没印，
   *     那时逼它印反而是噪声（⚠ 它们的红已经说明了问题）。
   */
  const greenSilent = results.filter((r) => r.code === 0 && typeof r.assertions !== 'number')
  const floorMissing = greenReported.filter((r) => !ASSERTION_FLOORS.has(r.name)).map((r) => r.name)
  if (floorMissing.length > 0) {
    floorViolations.push(`**${floorMissing.length} 族没有登记断言下界**：${floorMissing.join(' / ')}`
      + ' ⇒ 它们的"查了 N 处"降了也无人发现 ⇒ 修法：在 `ASSERTION_FLOORS` 里补一行（本轮实测值）')
  }
  for (const r of greenReported) {
    const floor = ASSERTION_FLOORS.get(r.name)
    if (floor === undefined) continue
    if (r.assertions < floor) {
      floorViolations.push(`${r.name}：查了 **${r.assertions}** 处 < 登记下界 **${floor}** 处`
        + `（少了 ${floor - r.assertions} 处 ⇒ 有断言被摘掉 / 某组走了"跳过"却还是报了这个口径）`)
    }
  }
  if (greenSilent.length > 0) {
    floorViolations.push(`**${greenSilent.length} 族跑绿了却压根没报 \`处级口径\`**：`
      + `${greenSilent.map((r) => r.name).join(' / ')}`
      + ' ⇒ 它们的断言数**不进总数**、下界对它们**是盲的**（摘掉几条断言照样全绿）'
      + '\n        ⇒ 修法：在该族的输出里印一行 \`处级口径：查了 N 处 · 过了 M 处 · 跳过 K 处\`'
      + '（\`check:all\` 的 `parseAssertionCount` / `parseSkipCount` 只认这一种形状）')
  }
  if (floorViolations.length > 0) {
    console.log(`  ✗ **断言数下界被突破**（⛔ 这不是"更精简"，是"覆盖面缩了"）：`)
    for (const f of floorViolations) console.log(`      · ${f}`)
    console.log('      ⇒ ⚠ 下界只准升不准降：真要有意减少，必须同批改 `FAMILY_FLOOR` 与 '
      + '`ASSERTION_FLOORS` 并写明理由（⚠ 常量名以本文件为准）')
  } else {
    const floorSum = greenReported.reduce((n, r) => n + (ASSERTION_FLOORS.get(r.name) ?? 0), 0)
    console.log(`  ✓ 断言数下界：**${greenReported.length}** 族（跑绿的那些）逐个 ≥ 登记下界`
      + `（它们的最低合计 = ${floorSum}，实测 ${chkSame}）`
      + '（⚠ 只准升不准降：有意减少须同批改常量并写明理由；'
      + '⚠ 跑红 / 没报口径的族**不参与**这一条，理由见 `ASSERTION_FLOORS` 上方注释）')
  }

  /**
   * ⚠⚠ **族内等式自检：必须是真等式，⛔ 不许写成恒真式**（2026-10-23 · 修 P0-4）
   *
   * ── 改前是什么（这就是本单要治的）────────────────────────────────────
   *   `r.assertions !== (r.assertions - (r.skipped ?? 0)) + (r.skipped ?? 0)`
   *   —— 右边代数上**恒等于左边** ⇒ 这个 filter **永远为空** ⇒ 这道理应抓住
   *   "族少报跳过 / 族自报过了与查了对不上"的自检，**永远不会红**。
   *
   * ── 现在怎么判（三档，⛔ 不许把"判不了"洗成"没问题"）──────────────────
   *   ① 族**自报**了 `过了`：核 `查了 == 过了 + 没过 + 跳过`（`没过` 只有报了才加）
   *      ⇒ 不成立 ⇒ **红**（真等式）；
   *   ② 族**没报** `过了`：这条等式**判不了** —— 单列点名，⛔ **不算通过**
   *      （这正是"读不到就两个都不认"那条纪律的落点，不许兜底成 OK）；
   *   ③ 自报负数（如 `过了 -1 处`）⇒ 上面①必然不成立 ⇒ 会被 ① 抓出来。
   *
   * ⚠⚠ **`没过` 必须进等式**（2026-10-23 · SRE · 修假红）：`check:build` 的口径是
   *   `查了 = ✓ + ✗`、`过了 = ✓`、`没过 = ✗` ⇒ 只按两项核会把它**误判成"读数不可信"**。
   *   ⚠ 老族不印 `没过`（`undefined`）⇒ 仍按两项核，⛔ 不替它们补 0（补 0 = 造一个它们没报的数）。
   */
  const hasPassed = reported.filter((r) => typeof r.passed === 'number')
  const noPassed = reported.filter((r) => typeof r.passed !== 'number')
  const missedOf = (r) => (typeof r.notPassed === 'number' ? r.notPassed : 0)
  const eqOf = (r) => r.passed + missedOf(r) + (r.skipped ?? 0)
  const broken = hasPassed.filter((r) => r.assertions !== eqOf(r))
  if (broken.length > 0) {
    console.log(`  ✗ **族内等式不成立**：${broken.map((r) => `${r.name}（查了 ${r.assertions} ≠ 过了 ${r.passed}`
      + `${typeof r.notPassed === 'number' ? ` + 没过 ${r.notPassed}` : ''} + 跳过 ${r.skipped ?? 0}）`).join(' / ')}`
      + ' ⇒ ⛔ 这几族的"查了 = 过了 + 跳过"对不上，读数不可信')
  }
  if (noPassed.length > 0) {
    console.log(`  ⚠ **${noPassed.length} 族没报「过了」⇒ 族内等式对它们【判不了】**（⛔ 不算通过）：`
      + noPassed.map((r) => r.name).join(' / '))
  }
  if (notReported.length > 0) {
    /**
     * ⚠⚠ **结构性做不到的族必须点名**（⛔ 不许静静少算）：
     *   这不是"兜底"，是"少算了几族"这件事本身要可见。
     */
    console.log(`  ⚠ **${notReported.length} 族结构上没能报这个口径**：`
      + notReported.map((r) => r.name).join(' / ')
      + ' ⇒ ⛔ 上面的总数**不含它们**，别当成全貌')
  }
  console.log('')
  /**
   * ══════════════════════════════════════════════════════════════════════
   * ⚠⚠ **判定行必须与退出码同源**（2026-10-21 · 第 331 轮 · 要求 2）
   * ══════════════════════════════════════════════════════════════════════
   *
   * ── 为什么这一条要写进代码而不是只写在注释里 ──────────────────────────
   *   第 325 轮踩过一次：**判定行说 PASS、退出码却是 1**（或反过来）——
   *   ⚠ 两者打架时，**机器只信退出码**，而**人只信判定行** ⇒ 同一份输出被读成两个结论。
   *
   * ── 现在怎么保证同源 ──────────────────────────────────────────────────
   *   判定行**只由 `v.exit` 一个变量决定**（下面那条 `switch`）；
   *   `VERDICT_TEXT` 把 `v.exit` 映射成**唯一**的一句话，⛔ 不允许任何分支另写措辞。
   *   ⚠ 结尾再跑一次 `assertVerdictMatchesExit()` —— 它把"判定行的档位"与 `v.exit`
   *     逐项对拍，**不一致就当场红**（⛔ 不许"印一套、退另一套"）。
   */
  const VERDICT_TEXT = {
    0: '判定：**全部通过** —— 每族都真跑过，且都通过。',
    1: '判定：**有失败** —— 先看上面标 ✗ 的那几族的原文。',
    2: '判定：**未执行** —— 没有失败，但有族没能跑起来（基准缺失）。⚠ **这不代表通过**。',
  }
  /**
   * ⚠ **档位与判定行的对拍**（要求 2 的机器化）：返回 `null` = 一致，否则给可读差异。
   *   ⚠ 它**不猜**：只比两样东西 —— `v.exit` 落在哪一档、上面印的那句话属于哪一档。
   */
  const checkVerdictSource = (exitCode, text) => {
    const want = VERDICT_TEXT[exitCode]
    if (want === undefined) return `退出码 ${String(exitCode)} 不在三档（0/1/2）之内`
    if (text !== want) return `退出码是 ${exitCode}，而判定行印的不是它那一句（实际=${JSON.stringify(text)}）`
    return null
  }
  const verdictLine = VERDICT_TEXT[v.exit]
  const srcMismatch = checkVerdictSource(v.exit, verdictLine)
  if (srcMismatch !== null) {
    /**
     * ⚠ 这一支**几乎不可能**走到（`verdictLine` 就是从 `VERDICT_TEXT[v.exit]` 取的），
     *   保留它是为了"将来有人改判定行忘了改档位"时**当场红**，而不是静静地印错话。
     */
    console.log(`判定：**内部不一致** —— ${srcMismatch}`)
    console.log('       ⇒ ⚠ 这是本脚本自身的缺陷（判定行与退出码不同源），⛔ 不许当成被测对象的结论。')
    return 1
  }
  /**
   * ⚠ **判定行只在这里印一次**（`verdictLine` 由 `v.exit` 唯一决定）——
   *   下面各分支**只印明细**，⛔ 不许再写第二句"判定：…"（那正是"印一套、退另一套"的入口）。
   */
  /**
   * ⚠⚠ **判定行不能与抬升后的退出码打架**（2026-10-24 · B 席）──────────────
   *   下界被突破时，`v.exit` 仍是 0（各族都过） ⇒ 若照直印"判定：**全部通过**"，
   *   就是本项目头号禁忌的形态：**判定行说通过、退出码却是 1**。
   *   ⇒ 下界一破，判定行改成**明确的那一句**（⛔ 不借用 `VERDICT_TEXT` 的三句，
   *     因为它们分别绑定 0/1/2 且带各自的因果）；且**只改这一句**，其余明细照旧。
   *   ⚠ `assertVerdictMatchesExit` 的对拍因此**只在"没有下界问题时"成立** ——
   *     这是**有意**的：下界问题本身要一句人话解释，塞进三档文案会丢掉"为什么"。
   */
  const floorBrokenAny = familyFloorBroken || floorViolations.length > 0
  if (floorBrokenAny && v.exit === 0) {
    console.log('判定：**有失败** —— ⚠ 各族本身都通过，但**覆盖面下界被突破**'
      + '（族数 / 断言数缩水，见上面那几条 ✗）⇒ **这不代表通过**。')
    console.log('       ⇒ 退出码按 1 记（⚠ 与上面那几条 ✗ 同源，⛔ 不是"未执行"）。')
  } else {
    console.log(verdictLine)
  }
  if (v.exit === 1) {
    /**
     * ⚠⚠ **两种"红"的修法必须分开印**（2026-10-24 · B 席 · 第四档）─────────────
     *   · `exit=1` ⇒ 那一族**查了、且查到违规** ⇒ 修被测对象 / 修判据；
     *   · `exit=3` ⇒ **检查器自身异常**（栈里能看见） ⇒ ⛔ **不是跑 preflight**。
     *   ⚠ 改前这里一律印 `（exit=1）`，而 `verdict()` 又把 `3` 归进"未执行"——
     *     于是**崩溃的族会被报成"exit=1"**（读数造假），修法还被指向 preflight。
     */
    for (const r of v.failed.filter((x) => x.code === 1)) console.log(`       ✗ ${r.name}（exit=1 · 查了且查出违规）`)
    if (v.crashed.length > 0) {
      console.log('       ✗ **检查器自身异常**（exit=3）—— 它们的结论**不可信**，⛔ 不是"查出违规"：')
      for (const r of v.crashed) console.log(`          · ${r.name}（exit=3）`)
      console.log('          ⇒ 修法：看那一族的原文里 `自身异常` 那条栈（⚠ **不是** `check:preflight`）')
    }
    if (v.notRun.length > 0) {
      /**
       * ⚠ 失败与未执行**同时存在**时，两者都要报出来（⛔ 不许因为"1 优先"就把 2 藏掉）——
       *   否则被吞掉的那几族**永远不会有人去补**（它们的读数就此消失）。
       */
      console.log('       ⚠ 另有族没能执行（exit≠0/1）—— 它们**没有**替你检查任何东西'
        + '（⚠ 退出码按"失败优先"记 1，但它们仍单列在这里）：')
      for (const r of v.notRun) console.log(`          · ${r.name}（exit=${r.code}）`)
    }
  } else if (v.exit === 2) {
    for (const r of v.notRun) console.log(`       · ${r.name}（exit=${r.code}）`)
    /**
     * ⚠ 走到 `exit 2` 说明**没有 `exit 3`**（`verdict()` 把 3 归进 `failed` ⇒ 会先落 1）
     *   ⇒ 这里的 `notRun` 只可能是"基准缺失" ⇒ preflight 这个提示**在这一档才正确**。
     */
    console.log('       ⇒ 这一档是**基准缺失 / 没跑起来**（⚠ 不是检查器崩溃）⇒ '
      + '跑 `npm run check:preflight` 看缺什么、怎么补。')
  }
  console.log('')
  console.log('       ⚠ 退出码口径：0 = 全部真跑过且通过 · 1 = 至少一族失败**或检查器自身异常（exit 3）** · '
    + '2 = 有族未执行 / 基准缺失（不代表通过）')
  /**
   * ── ⚠⚠ **新增的两条下界也要能改退出码**（2026-10-24 · B 席）─────────────────
   *   改前这里直接 `return v.exit`：`v.exit` 只看**各族自报的退出码** ⇒
   *   "族数少了一族"与"某族断言数缩水"**都不在它的视野里** ⇒ 两条下界只能打印、不能拦。
   *   ⚠ 那是"读数只报不核"的第二层：**断言只打印就等于没有**（本仓反复强调的形态）。
   *   ⇒ 现在：下界被突破 ⇒ **至少 `1`**（⚠ 不降到 2：这不是"没基准"，是"覆盖面对不上"）。
   *   ⚠ 但**不许把 `2` 洗成 `1`**：若本来只有"未执行"（`v.exit === 2`）且下界没破，
   *     仍返回 2 —— 下界只会**把 0 抬到 1**、把 2 抬到 1，⛔ 不会把 1 降下来。
   */
  if (familyFloorBroken || floorViolations.length > 0) {
    if (v.exit === 0 || v.exit === 2) {
      console.log('')
      console.log('       ⇒ ⚠ 上面那几条**下界被突破**的读数把本次判定抬到 **1**'
        + '（⚠ 覆盖面 / 断言数缩水 ≠ "更精简"，也 ≠ "没基准"）')
      return 1
    }
  }
  return v.exit
}

if (process.argv[1] !== undefined && (process.argv[1].endsWith('check-all.mjs') || process.argv[1].endsWith('npm'))) {
  const pf = preflight()
  if (pf.items.some((i) => !i.present)) {
    // ⚠ 预检不拦：缺东西时**照旧跑**，让各族自己如实打"未执行"（⛔ 不在这里替它们判）
    console.log('⚠ 前置条件不全 —— 下面先给体检，再照常逐族跑（各族的"未执行"以它们自己的输出为准）')
    console.log('')
    printPreflight(pf)
  }
  const names = listFamilies()
  if (names.length === 0) {
    console.error('✗ 从 package.json 的 scripts 里一个 `check:*` 都没解析到（基准缺失 ⇒ 不按通过处理）')
    process.exit(2)
  }
  const results = runFamilies(names)
  process.exit(printSummary(results))
}
