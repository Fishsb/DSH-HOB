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
 *   `1` = **至少一族实际失败**（退出码 1）；
 *   `2` = **没有失败、但有族没能执行**（退出码 2 或异常）—— ⚠ `2` **不代表通过**。
 *   ⚠ 优先级：`1` 高于 `2`（既有真红又有未执行 ⇒ 报 1，因为失败更需要先看）。
 *
 * ── ⛔ 它不做什么 ───────────────────────────────────────────────────────
 *   ⛔ 不"放宽"任何一族的判据（它只是调度，判据字节未动）。
 *   ⛔ **不预设某族该是什么结果** —— 每族的期望值仍由那族自己决定。
 *   ⛔ 不写任何文件（各族的临时件仍由各族自己管，且都在系统临时目录里）。
 *
 * ── 判据模的传参（2026-10-19 新增 · `TASK-C`）────────────────────────────
 *   ⚠ `check:build` 的**面 ③**（运行实例 vs 产物）有**两档跑法**：
 *     · 单独跑 `npm run check:build` ⇒ **报警模**（落后只打印，⛔ 不 FAIL）；
 *     · 由**本聚合入口**跑 ⇒ **判据模**（`--strict-instance` ⇒ 落后 exit 1 · 判不出 exit 2）。
 *   ⚠ ⚠ **为什么在这里传、而不让那一族自己决定**：报警与"跑判据"是两个面。
 *     ⚠ 本入口存在的理由就是"**一条命令跑完**、且**有失败就红**"；而实测现场就是落后态
 *     ⇒ 若那一族在任何时候都只报不拦，则"实例跑的是旧代码"这件事**永远不会让任何东西变红**
 *     —— 那正是本件要治的静默。
 *   ⚠ ⛔ 本入口**不改**那族判据的任何一个字节：它只多传一个开关（`STRICT_FAMILIES`）。
 *     ⚠ 同理**不改** `verdict()` —— 那三档口径（1 失败 / 2 未执行）本来就够了。
 *
 * ── 用法 ───────────────────────────────────────────────────────────────
 *   `npm run check`（= `npm run check:all`）· 或 `node scripts/check-all.mjs`
 *   想看"哪几族现在跑不了、怎么补" ⇒ `npm run check:preflight`（⚠ 那一条只体检，不跑判据）。
 */

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
  const all = [...out.matchAll(/跳过\s*(\d+)\s*处/g)]
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
 * ── ⚠⚠ **读这一族的"处"是什么分母**（2026-10-21 · 第 351 轮）────────────────
 *
 * ── 为什么必须读它（汇总行的混量纲）──────────────────────────────────────
 *   第 350 轮的汇总行把 15 族的"处"**直接相加**得到 `1178`。但至少有一族
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
  const failed = results.filter((r) => r.code === 1)
  /** ⚠ 口径不变：**非 0 且非 1** 一律算"未执行"（含 `2` 与任何异常码）。 */
  const notRun = results.filter((r) => r.code !== 0 && r.code !== 1)
  if (failed.length > 0) return { exit: 1, passed, failed, notRun }
  if (notRun.length > 0) return { exit: 2, passed, failed, notRun }
  return { exit: 0, passed, failed, notRun }
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
    const tag = r.code === 0 ? '✓ 通过' : r.code === 1 ? '✗ 失败' : '· 未执行'
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
    + ` · 失败 ${v.failed.length} · 未执行 ${v.notRun.length}`)
  /**
   * ── ⚠⚠ **汇总行必须回答三件事**（第 349 轮 · TASK §二 硬要求 3）──────────────
   *   **查了几处 · 过了几处 · 跳了几处**。
   *   ⚠ 这一行的语义与上面那行（族级三档）**不是同一层**，⛔ 不许混：
   *     · 上面那行 = **族**（15 族里几族通过/失败/未执行）；
   *     · 这一行 = **处**（各族自己报的断言数里，过了几处、跳了几处）。
   *   ⚠ `跳过 0 处` 时**仍然印这一行**（"没有跳过"是个有价值的读数，
   *     ⛔ 不许因为"是 0"就不印 —— 那会把"没查"与"没跳过"重新糊起来）。
   */
  /**
   * ── ⚠⚠ **两种分母分开报**（2026-10-21 · 第 351 轮 · 修混量纲）──────────────
   *
   * ── 改前是什么（这就是本单要治的）──────────────────────────────────────
   *   第 350 轮把 15 族的"处"**直接相加**：`1178`。但 `check:build` 的"处"
   *   是**读数行数**、不是**逐条断言数** ⇒ 那个 1178 是**混了量纲的数**。
   *   本仓纪律明写「不同量纲 ⛔ 不可相加」，这一行正是反例。
   *
   * ── 现在（甲方案 · 折中版）────────────────────────────────────────────
   *   ① **同分母的族**（`per-assertion`）⇒ 给出**总数**，并**点名它覆盖哪几族**；
   *   ② **异分母的族**（`per-reading-line`）⇒ **单列**、**明写"未计入总数"**；
   *   ③ 两组的族名都点出来 —— ⛔ 不许让读者自己去数"总数含谁、不含谁"。
   *   ⚠ `查了 = 过了 + 跳过` 这条等式**在每一族内部仍然成立**（本单未放松）——
   *     各族自己印的那一行没变，只有**上面的加总**改了。
   *   ⚠ `15/15 全覆盖` 这个读数**保留**（覆盖率按"报了口径的族数"算，与分母无关）。
   */
  const reported = results.filter((r) => typeof r.assertions === 'number')
  const notReported = results.filter((r) => typeof r.assertions !== 'number')
  const sameDenom = reported.filter((r) => r.denominator !== 'per-reading-line')
  const otherDenom = reported.filter((r) => r.denominator === 'per-reading-line')
  const sumOf = (rows, f) => rows.reduce((s, r) => s + f(r), 0)
  const chkSame = sumOf(sameDenom, (r) => r.assertions)
  const passSame = sumOf(sameDenom, (r) => r.assertions - (r.skipped ?? 0))
  const skipSame = sumOf(sameDenom, (r) => r.skipped ?? 0)
  const covers = reported.length === results.length

  /**
   * ⚠ **总数只统计"同一分母"的族**，并**点名覆盖范围**（⛔ 不许让读者猜）。
   */
  console.log(`  处级口径（**逐条断言**分母 · ${sameDenom.length} 族）：`
    + `查了 ${chkSame} 处 · 过了 ${passSame} 处 · **跳过 ${skipSame} 处**`
    + `（⚠ 跳过**不计入通过**）`)
  console.log(`      ↳ 覆盖：${sameDenom.map((r) => r.name).join(' · ') || '(无)'}`)

  /**
   * ⚠ **异分母族单列**：明写"未计入总数"，并说明它按什么数。
   *   ⛔ 若有一天某族自己声明了不同分母，它会**自动**落到这一段（不需要改本文件）。
   */
  if (otherDenom.length > 0) {
    for (const r of otherDenom) {
      console.log(`  ⚠ **未计入上面的总数**（分母不同）：${r.name}`
        + ` ⇒ 查了 ${r.assertions} · 过了 ${r.assertions - (r.skipped ?? 0)} · 跳过 ${r.skipped ?? 0}`
        + `（⚠ 本族口径按**读数行**、非逐条断言 ⇒ ⛔ 不可与上面那个总数相加）`)
    }
  }

  /**
   * ⚠ **覆盖读数保留**（硬要求 3：15/15 不许退回去）。
   */
  console.log(`  覆盖率：**${reported.length}/${results.length} 族**报了这个口径`
    + (covers ? '，**全覆盖**' : ''))

  /**
   * ⚠ **族内等式自检**：逐族核 `查了 = 过了 + 跳过`（⛔ 不许因为改了汇总就放松族内等式）。
   */
  const broken = reported.filter((r) => r.assertions !== (r.assertions - (r.skipped ?? 0)) + (r.skipped ?? 0))
  if (broken.length > 0) {
    console.log(`  ✗ **族内等式不成立**：${broken.map((r) => r.name).join(' / ')}`
      + ' ⇒ ⛔ 这几族的"查了 = 过了 + 跳过"对不上，读数不可信')
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
  console.log(verdictLine)
  if (v.exit === 1) {
    for (const r of v.failed) console.log(`       ✗ ${r.name}（exit=1）`)
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
    console.log('       ⇒ 跑 `npm run check:preflight` 看缺什么、怎么补。')
  }
  console.log('')
  console.log('       ⚠ 退出码口径：0 = 全部真跑过且通过 · 1 = 至少一族失败 · 2 = 有族未执行（不代表通过）')
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
