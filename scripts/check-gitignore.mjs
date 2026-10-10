#!/usr/bin/env node
/**
 * `.gitignore` 一致性断言 —— 把「**排除漂移**」从**静默**变成**显式 FAIL**。
 *
 * ── 为什么需要它（本项目实测踩过两次，见 `.hob/EXPERIENCE.md` E-70 / E-73）──
 * `.gitignore` 的排除是**静默**的：某个该入库的文件被 `.hob/*` 顺带排除掉时，
 * `git status` **不会**提示、`git init` **不会**报错 —— 它只是**不出现**。
 * 两次实测：
 *   ① E-70：`.hob/EXPERIENCE.md` 被排除（`!` 例外少列一项）⇒ 69 条经验不入库；
 *   ② E-73：`.hob/drafts/` 被排除 —— 但**已入库的** `check-preset-contracts.mjs`
 *      会读它 ⇒ **新 clone 跑 `npm run check:presets` 直接 ENOENT 崩掉**。
 * ⇒ 本脚本按 `.hob/README.md` §1 的两栏清单**逐条断言**，任一漂移即 FAIL。
 *
 * ── 判据（关键：如何区分"被规则排除"与"不存在所以没出现"）──────────────
 * 用 `git check-ignore` 而不是 `git status` / `git ls-files`：
 *   · `git check-ignore` 是**纯规则匹配** —— 路径**不必存在**就会给出答案。
 *     实测：仓库里没有 `lib/` 目录时，`git check-ignore lib/` 仍返回"被忽略"。
 *   · ⇒ **MUST-EXCLUDE** 的判据 = `check-ignore` 退出 **0**（被规则排除）。
 *     这**不能**用 `ls` 是否存在来判断（不存在 ⇒ 什么也证明不了）。
 *   · ⇒ **MUST-TRACK** 的判据 = `check-ignore` 退出 **1**（未被规则排除）
 *     **且**文件确实存在于磁盘。**两条都要过** —— 只查"没被忽略"会把
 *     "文件根本不存在"误判成通过（这正是"`git status` 看不见 ≠ 被排除"的同一类坑）。
 *
 * ── ⚠ 一个必须显式处理的边界 ────────────────────────────────────────────
 * `lib/` 这类**构建产物**在未 build 时**不存在**。对它只断言「被规则排除」，
 * **不**断言"存在" —— 但要在输出里**如实标注**它当前不在磁盘，
 * 以免读者把"规则对"误读成"产物在"。
 *
 * 用法：node scripts/check-gitignore.mjs      （或 npm run check:gitignore）
 * 退出码：0 = 全通过；1 = 有违规（逐条打印）
 * ⚠ 附加退出码（第 53 轮新增的直接调用入口）：2 = 用法错 / 目标读不到（**基准缺失不算通过**）。
 * ⚠ 零第三方依赖（本仓纪律）。
 *
 * ⚠⚠ **已知：本脚本职责膨胀（照实登记，本轮不动）** ────────────────────────
 *   它现在同时承担：排除漂移（MUST-TRACK / MUST-EXCLUDE）· 骨架覆盖 · **脚本落点双向自检** ·
 *   以及文档形态机检 **A / B / J / C / D / D′ / E / F / G / H / I** 多组。
 *   ⇒ **脚本名与实际职责已明显偏离**（`check-gitignore` 远不止 gitignore）。
 *   ⚠ 这**不是本轮引入的**，也**不是本轮该修的**：Hob 已把它登记为
 *   **待评估项**（正本 `CONTEXT.md` §2.2「`check:gitignore` 职责膨胀」），
 *   **拆分须用户拍板** ⇒ 本轮**只在注释里记已知**，⛔ **不拆分、不改结构**。
 *   ⚠ 之所以继续往这里加：**同族判据放同一消费点**，不制造第二张需要同步的期望表
 *   （**E-110**：一个常量只服务一条断言 / 同类判据不要散落多处）。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/**
 * 只要退出码，不关心输出；git 未安装/非 git 仓 时抛出真实错误。
 *
 * ⚠⚠ **必须带 `--no-index`** —— 这是本脚本最容易写错、且**写错了还看不出来**的地方。
 *
 * 不加时，`git check-ignore` 会**优先信任 index**：一个**已被跟踪**的文件
 * **永远不会**被报告为 "ignored"，**即使 `.gitignore` 里确实有规则排除它**。
 * 实测（临时删掉 `!.hob/README.md` 之后）：
 * ```
 *   git check-ignore -q            .hob/README.md  →  exit 1（"未被排除"）← 漏报
 *   git check-ignore -q --no-index .hob/README.md  →  exit 0（"被排除"）  ← 抓到
 * ```
 * ⇒ 本脚本要断言的恰恰是**规则本身**（"这份清单是否与 README §1 一致"），
 *   而不是"当前 index 恰好看得见它"。若用默认行为，**已经被跟踪的骨架文件
 *   即使规则被改坏也永远 PASS** ⇒ 断言对**最需要保护的那批文件**完全失效。
 *   （这是"判据选错 ⇒ 断言恒真"的又一例，与 E-67 同族。）
 * ⇒ 本脚本用 `--no-index`（**纯规则匹配**，不看 index、也不要求路径存在）。
 */
function ignoreExitCode(target) {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', '--', target], { cwd: root, stdio: 'ignore' })
    return 0 // 被规则排除
  } catch (e) {
    if (typeof e.status === 'number') return e.status // 1 = 未被排除
    throw e
  }
}

const fail = []
const note = []
const bad = (m) => fail.push(m)
const ok = (m) => note.push(m)

// ── 判据函数：正本里的节标题不得重复（2026-10-11 第 53 轮 · 断言 J）──────────
/**
 * **找出同一份 Markdown 里重复出现的二级节标题（`^## `）。**
 *
 * ── 为什么需要它（缺口有实测出处）──────────────────────────────────
 *   第 52 轮 Hob 写 `USER-DECISIONS.md` 时，第一版把两条新决定**追加到文件末尾**
 *   （`## 十一、归档清单` **之后**），并在尾部留下一个**重复的** `## 五、回复格式`。
 *   ⇒ 那一版**结构已坏**，而**当时跑遍所有检查都不会红** ——
 *   它是被第 52 轮的「备份 diff 判读」**偶然撞见**的，**不是任何判据抓到的**。
 *   ⚠ 这正是 **E-122**（机制没有喂养端）的又一形态：**"标题唯一"从来没被当成可判的事**。
 *   ⇒ 本函数把它变成一条可判的事，并把**那次真实坏快照**当活体夹具（见断言 J 的实证块）。
 *
 * ── 判据（只咬"该咬"的一侧）───────────────────────────────────────
 *   · 只看**行首** `^## `（二级）⇒ **行内提及**（如 `` `## 五、回复格式` ``）**不在行首，天然不咬**；
 *   · **围栏代码块内**的标题**不参与**（那是**示例**，见 `fencedMaskBelow`）——
 *     与断言 E / I 的围栏豁免**同族口径**（**E-114**：判据必须容忍元讨论）。
 *
 * ── 已知边界（照实登记，**不要试图消灭**）──────────────────────────
 *   · ⛔ **`### `（三级）重复不在本轮范围** —— 只认 `^## `；
 *   · ⛔ **只扫四份正本**（与 `B_FILES` 同集合）；**骨架文件（`.hob/**`）暂不扫**；
 *   · ⚠ **与 `hob-render.ts` 的围栏实现同源**：下面 `fencedMaskBelow` 用的
 *     `FENCE_OPEN_RE` / 开闭判据**照抄**该文件的 `fencedMask`（**不重写一套正则**，
 *     否则会重演"文档里能安全写例子、机检却报残留"的自相矛盾）。
 *
 * @param content - 整份 Markdown 文本。
 * @returns 每个重复标题一条：`{ title, lines }`（`lines` 为 1 基行号，升序）。
 */
export function findDuplicateSectionHeadings(content) {
  const lines = String(content ?? '').replace(/\r\n/g, '\n').split('\n')
  const fenced = fencedMaskBelow(lines)
  const byTitle = new Map()
  for (let i = 0; i < lines.length; i++) {
    if (fenced[i]) continue // 围栏内的标题是示例，不参与判据
    const m = /^##\s+(\S.*)$/.exec(lines[i])
    if (m === null) continue // 行内提及 / 三级标题 / 普通正文：天然不匹配
    const title = m[1].trim()
    if (!byTitle.has(title)) byTitle.set(title, [])
    byTitle.get(title).push(i + 1)
  }
  const dup = []
  for (const [title, ls] of byTitle) if (ls.length >= 2) dup.push({ title, lines: ls })
  return dup
}

/** 围栏开标记（⚠ 与 `src/server/hob-render.ts` 的 `fencedMask` **逐字同源**）。 */
const FENCE_OPEN_RE = /^\s{0,3}(`{3,}|~{3,})(.*)$/

/**
 * 计算**围栏代码块**覆盖的行（`true` = 该行不参与标题判据）。
 * ⚠ 与 `src/server/hob-render.ts` 的 `fencedMask` 同口径（**未闭合 ⇒ 延伸到文末**，
 *   与 CommonMark 一致）—— 这里**照抄**而不 import：`scripts/` 与 `src/` 是两棵
 *   互不依赖的树（`src/` 不能 import `scripts/`，反之亦然，见 `hob-write.ts` 的注释）。
 */
function fencedMaskBelow(lines) {
  const mask = new Array(lines.length).fill(false)
  let fence = null
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE_OPEN_RE.exec(lines[i])
    if (fence === null) {
      if (m !== null && !(m[1][0] === '`' && m[2].includes('`'))) {
        fence = { char: m[1][0], len: m[1].length }
        mask[i] = true
      }
      continue
    }
    mask[i] = true
    if (m !== null && m[1][0] === fence.char && m[1].length >= fence.len && m[2].trim() === '') {
      fence = null
    }
  }
  return mask
}

// ── 判据函数的**直接调用入口**（第 53 轮 · §1③ 的"可单测"要求）──────────────
// ⚠ 只在**被直接执行**时生效（import 本模块做断言时**不会**触发）：
//   把"找重复标题"从"只能对整个仓跑"变成"能对任意一份 .md 跑" ——
//   否则历史坏快照那份**没法当活体夹具**（它不在四份正本里）。
// 用法：node scripts/check-gitignore.mjs --dup-headings <某份.md 的路径>
if (process.argv[1] !== undefined && process.argv[1].endsWith('check-gitignore.mjs')
  && process.argv.includes('--dup-headings')) {
  const target = process.argv[process.argv.indexOf('--dup-headings') + 1]
  if (target === undefined) {
    console.error('用法：node scripts/check-gitignore.mjs --dup-headings <markdown 路径>')
    process.exit(2)
  }
  let src = ''
  try {
    src = readFileSync(target, 'utf8')
  } catch (e) {
    console.error(`读不到 ${target}：${String(e?.message ?? e)}`)
    process.exit(2)
  }
  const dup = findDuplicateSectionHeadings(src)
  if (dup.length === 0) {
    console.log(`PASS —— ${target} 里无重复的二级节标题`)
    process.exit(0)
  }
  console.log(`FAIL —— ${target} 里有 ${dup.length} 个重复的二级节标题：`)
  for (const d of dup) {
    console.log(`  ✗ 「${d.title}」出现在第 ${d.lines.join(' 与第 ')} 行（共 ${d.lines.length} 次）`)
  }
  process.exit(1)
}

// ── 前置：必须是 git 仓库（否则 check-ignore 无意义）──────────────────
try {
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim()
  if (top !== root) bad(`本目录不是仓库根：rev-parse 给出 ${top}，期望 ${root}`)
  else ok(`是 git 仓库根：${top}`)
} catch {
  console.error('判定：FAIL —— 本目录不是 git 仓库（先 git init）')
  process.exit(1)
}

/**
 * MUST-TRACK：必须**能被 git 跟踪**。
 * 判据三连（缺一不可 —— 任一条单独用都有假通过）：
 *   ① 未被规则排除：`check-ignore --no-index` != 0
 *      （不加 `--no-index` 时，已跟踪文件永远报"未排除" ⇒ 规则被改坏也 PASS）
 *   ② 磁盘上存在：`existsSync`
 *      （只查①会把"文件根本不存在"误判为通过）
 *   ③ **确实在 index 里**：`git ls-files --error-unmatch`
 *      （只查①②的项目：规则放行、文件也在，但**从未 `git add`** ⇒ 仓库里还是没有！
 *        E-70 的失效模式正是"文件不在 git 里"，所以这一条必须查。）
 *   ⚠ ③ 的代价：新建骨架文件后**尚未 `git add`** 时本脚本会 FAIL —— 这是**刻意**的：
 *     它在说"这个骨架文件还没进 git"，而不是等提交后才发现漏了。
 */
const mustTrack = [
  ['.hob/README.md', '骨架 · 约定归属地（README §1）'],
  ['.hob/EXPERIENCE.md', '骨架 · 经验库（README §1 + 专节）'],
  ['.hob/templates/DECISIONS.md', '骨架 · 空模板'],
  ['.hob/templates/USER-DECISIONS.md', '骨架 · 空模板'],
  ['.hob/templates/CONTEXT.md', '骨架 · 空模板'],
  ['.hob/templates/ROLES.md', '骨架 · 角色簇（README §1.3）'],
  ['.hob/templates/GATES.md', '骨架 · 阶段与门禁（README §1.3）'],
  ['.hob/templates/TASK.md', '骨架 · 指令模板（v4 · 交接协议载体）'],
  ['.hob/templates/REPORT.md', '骨架 · 回报模板（v4 · 交接协议载体）'],
  ['.hob/roles/methods/qa.md', '骨架 · 角色方法论（README §1.3 · 代表项）'],
  ['.hob/roles/methods/quality-gates.md', '骨架 · 门禁方法论源（README §1.3 · 代表项）'],
  ['.hob/drafts/preset-contracts.md', '骨架 · 被 check:presets 读取的规范源（README §1.2）'],
  ['.hob/drafts/restructure-plan.md', '骨架 · 重构方案人读版（README §1.2）'],
  // ⚠ 顺带盯住"入库脚本不能依赖不入库文件"这条：这些脚本自己必须在库里
  ['scripts/check-preset-contracts.mjs', '入库脚本（被 package.json 的 check:presets 调用）'],
  ['scripts/check-gitignore.mjs', '本脚本自身也必须入库（否则 clone 后无从核对）'],
  // ⚠ 2026-10-09 补：另两条**已声明**的命令脚本原先**没被盯住** ——
  //   与 E-70 / E-73 同族：脚本一旦被 `.gitignore` 静默排除，
  //   **clone 后收尾命令直接 ENOENT**，而当时的机检**不会报**。
  //   `check:experience` 自批 11 起是**收尾必跑四条命令之一** ⇒ 这个缺口的影响面比前两条更大。
  ['scripts/check-experience.mjs', '入库脚本（被 package.json 的 check:experience 调用 · 收尾四条命令之一）'],
  ['scripts/next-experience-id.mjs', '入库脚本（被 package.json 的 exp:next-id 调用 · 取下一个经验编号）'],
  // ⚠ 2026-10-09 补（本批 · 用户裁定 A 方案）：build 末尾新增的构建戳脚本。
  //   它由 `build` 串联调用（`node scripts/write-build-stamp.mjs`），
  //   与上面两条**同族**：一旦被 `.gitignore` 静默排除，clone 后 `npm run build`
  //   会在最后一步 ENOENT —— 而**产物已经编译完**，失败点离现场很远。
  ['scripts/write-build-stamp.mjs', '入库脚本（被 package.json 的 build 调用 · 产物构建戳 lib/BUILD-STAMP）'],
  // ⚠ 2026-10-09 补（批 18 · 新建会话默认值）：配置面一致性机检。
  //   与上面几条同族；它由 `check:config` 调用。本脚本的"反向自检"（读 package.json
  //   的 scripts 反查）**当场就抓到遗漏**（加完 script 未登记时直接 FAIL，读数见回报），
  //   说明这条自检形态确实有效 —— 此处登记即为那次的修正结果。
  ['scripts/check-config-face.mjs', '入库脚本（被 package.json 的 check:config 调用 · 配置面三处一致性机检）'],
  // ⚠ 2026-10-09 补（第 2 轮 · 闭环回传丢失修复）：编排运行态跨重载可观测性机检。
  //   同族的又一次现场抓获 —— 加完 `check:orch` 未登记时，本脚本的"反向自检"
  //   （读 package.json 的 scripts 反查 MUST-TRACK）**当场 FAIL**，
  //   这条登记就是那次的修正结果。
  ['scripts/check-orch-state.mjs', '入库脚本（被 package.json 的 check:orch 调用 · 编排运行态跨重载可观测性机检）'],
  // ⚠ 2026-10-10 补（第 3 轮 · 「候选来源读取失败」修复）：client 半边宿主服务取用机检。
  //   同族的**第三次**现场抓获 —— 加完 `check:client` 未登记时，本脚本的"反向自检"
  //   （读 package.json 的 scripts 反查 MUST-TRACK）**当场 FAIL**，这条登记就是修正结果。
  ['scripts/check-client-deps.mjs', '入库脚本（被 package.json 的 check:client 调用 · client 半边 ctx 取用/免 inject 读法机检）'],
  // ⚠ 2026-10-11 补（第 49 轮 · 收尾 host-probe）：**真产物级**的 host 半边探针。
  //   它此前**不在 package.json、也不在本清单** ⇒ 5 条期望过期后**长期无人发现**
  //   （**E-122** 形态：机制在，但**没有任何东西要求它跑**）。
  //   本轮把它登记进 `probe:host` ⇒ 本脚本的"反向自检"**当场 FAIL** 抓出本行缺失，
  //   与上面三条同族的**第四次**现场抓获。
  //   ⚠ 它**依赖构建产物 `lib/`**（不是直载 `.ts`）⇒ 必须**在 `build` 之后**跑；
  //     `lib/` 缺失时它**可读地报错并 exit 2**（与 0/1 分档，理由见该脚本头部）。
  ['scripts/host-probe.mjs', '入库脚本（被 package.json 的 check:host 调用 · 真产物 lib/ 的 host 半边探针）'],
  // ⚠ 2026-10-11 补（第 51 轮 · 收尾 module-independence-probe）：与上面一行**同病同源**。
  //   它自基线期（`a850ae6`）就在库里，却**既不在 package.json、也不在本清单** ⇒
  //   1 条期望过期（`bus` 自 M3 `a89111f` 起默认 true）**挂了六轮无人发现**（**E-122**）。
  //   本轮登记进 `check:modules` ⇒ 反向自检**又一次当场 FAIL** 抓出本行缺失（第五次现场抓获）。
  //   ⚠ 它与 `check:host` **覆盖面不重叠**：host-probe 验的是 schema 形状/默认值 +
  //     `apply()` **登记表**；本探针真调 cordis `ctx.plugin`，验的是**真 fiber 状态**
  //     （配置开关 ⇒ 未装载 · 缺依赖 ⇒ PENDING · 两种 inject 的不同后果）。
  //   ⚠ 同样**依赖 `lib/`** ⇒ 必须在 `build` 之后跑；缺 `lib/` 时同样 exit 2。
  ['scripts/module-independence-probe.mjs', '入库脚本（被 package.json 的 check:modules 调用 · 真产物 lib/ 的模块独立启停探针）'],
]

/** 该路径是否已在 git index 里（= 已 `git add`）。 */
function inIndex(target) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', target], { cwd: root, stdio: 'ignore' })
    return true
  } catch (e) {
    if (typeof e.status === 'number') return false
    throw e
  }
}

for (const [p, why] of mustTrack) {
  const code = ignoreExitCode(p)
  if (code === 0) {
    bad(`MUST-TRACK 却被规则排除：${p}  —— ${why}`)
    continue
  }
  if (!existsSync(join(root, p))) {
    bad(`MUST-TRACK 但磁盘上不存在：${p}  —— ${why}（不存在无法证明"规则放行"，不算通过）`)
    continue
  }
  if (!inIndex(p)) {
    bad(`MUST-TRACK 但未加入 git index：${p}  —— ${why}（规则放行且文件在，但从未 git add ⇒ 仓库里仍没有它）`)
    continue
  }
  ok(`MUST-TRACK ✓ ${p}`)
}

/**
 * MUST-EXCLUDE：必须**被规则排除**。
 * 判据 = check-ignore == 0（纯规则匹配，与是否存在于磁盘**无关**）。
 * ⚠ 这正是与 MUST-TRACK 的区别所在：这里**故意不看**存在性 ——
 *   否则"文件不存在"会被误判成"排除成功"。
 */
const mustExclude = [
  ['node_modules/', '依赖目录（.gitignore 构建产物段）'],
  ['lib/', '构建产物 · host（同一段）'],
  ['dist/', '构建产物（同一段）'],
  // ⚠ **v4（2026-10-08）**：账本数据已迁出工作区（→ `/home/lk/.dsh/hob-ledgers/<工作区名>/`，
  //   2026-10-09 按 UD-86/87 迁自 `/home/lk/FF/.hob-ledgers/<工作区名>/`），
  //   故下面这些路径**在本仓库里已不存在**。
  //   ⇒ 保留断言的意义变成**防回迁**：若有人把账本数据搬回 `.hob/`，
  //     本组立刻 FAIL（`git check-ignore` 会对已入库路径返回未忽略）。
  //   ⚠ 这是**改判据以跟随现状**，不是放宽 —— 断言条数不减，方向从
  //     "数据必须被排除" 变成 "数据既不在库、也不被意外放行"。
  ['.hob/DECISIONS.md', '运行数据 · 账本（v4 已迁出）'],
  ['.hob/USER-DECISIONS.md', '运行数据 · 账本（v4 已迁出）'],
  ['.hob/CONTEXT.md', '运行数据 · 账本（v4 已迁出）'],
  ['.hob/archive/', '运行数据 · 归档（v4 已迁出）'],
  ['.hob/backups/', '改前备份（v4 起仅存本仓库内的改前备份，账本备份已迁出）'],
  ['.hob/CARRYOVER.md', '运行数据 · 可搬资产登记（v4 已迁出）'],
  ['.hob/STEP6-REPORT.md', '运行数据 · 各轮报告的代表（v4 已迁出）'],
  ['.hob/CLEANUP-REPORT.md', '运行数据 · 各轮报告的代表（v4 已迁出）'],
]

for (const [p, why] of mustExclude) {
  if (ignoreExitCode(p) !== 0) {
    bad(`MUST-EXCLUDE 却未被规则排除：${p}  —— ${why}`)
    continue
  }
  // 附加：若它已经躺在 index 里（曾被 add 过），"排除"就只是纸面 ——
  // 已被跟踪的文件即使后来被加入 .gitignore，git 也**不会**停止跟踪它。
  if (inIndex(p)) {
    bad(`MUST-EXCLUDE 且规则已排除，但它**已在 git index 里**：${p}  —— ${why}（规则对已跟踪文件不生效，需 git rm --cached）`)
    continue
  }
  ok(`MUST-EXCLUDE ✓ ${p}${existsSync(join(root, p)) ? '' : '（当前不在磁盘 · 规则匹配与存在性无关）'}`)
}

/**
 * 反向保护：**骨架清单里的每一项都必须被上面覆盖到**（防止 README 加了新骨架、
 * 本脚本没跟上 —— 那正是 E-70 的成因：清单有、机检没有）。
 * 判据：README §1 表格提到的骨架路径，逐一必须在 mustTrack 里出现过。
 */
const README = join(root, '.hob', 'README.md')
const readmeSrc = (() => {
  try { return execFileSync('cat', [README], { encoding: 'utf8' }) } catch { return '' }
})()
// 抽取 README 里形如 `.hob/xxx` 的**骨架行**提及（第 1 行表格 = 骨架栏）
const skeletonRow = readmeSrc.split('\n').find((l) => l.startsWith('| **骨架**')) ?? ''
const mentioned = [...skeletonRow.matchAll(/\.hob\/[A-Za-z0-9._-]+\/?/g)].map((m) => m[0])
const trackedPaths = new Set(mustTrack.map(([p]) => p))
for (const m of mentioned) {
  // README 里写的可能是目录（带尾斜杠）——用其下已知文件核对
  const probe = m.endsWith('/') ? `${m}FACTS.md` : m
  const isDirProbe = m.endsWith('/')
  const covered = isDirProbe
    ? [...trackedPaths].some((p) => p.startsWith(m))
    : trackedPaths.has(m)
  if (!covered) bad(`README §1 骨架栏提到 ${m}，但本脚本的 MUST-TRACK 清单里没有它 ⇒ 机检与约定已漂移`)
}
if (mentioned.length === 0) bad('读不到 README §1 的骨架行（约定归属地读不到 ⇒ 本断言失去基准）')
else ok(`README §1 骨架栏提到的 ${mentioned.length} 项，均已纳入 MUST-TRACK 覆盖`)

/**
 * 反向自检（2026-10-09 新增）：**package.json 里声明的脚本必须都在 MUST-TRACK 里**。
 *
 * ── 为什么需要（这一条是本次补的，理由有实测出处）────────────────────
 * 上面两条断言都是**正向**的（"清单里的必须满足"），它们**抓不到"清单漏了谁"**：
 * `check-experience.mjs` / `next-experience-id.mjs` 被 `package.json` 声明为收尾命令，
 * 却**长期不在 MUST-TRACK 里** —— 这个缺口是**人工排查**发现的，不是本脚本报的。
 * 同形缺口（新加一条 `npm run xxx` ⇒ 忘记登记）会**再次静默发生**。
 * ⇒ 用**数据源反查**把它从静默变显式：**能被 `npm run` 调到的脚本，必须受本脚本保护**。
 *
 * ── 判据（为什么读 package.json 而不是"硬编码一张期望表"）────────────
 * 期望表的**唯一权威是 `package.json` 的 `scripts`** —— 手抄一份进本脚本，
 * 等于再造一个会漂移的清单（与本脚本要防的 E-70 同族）。
 * 故这里**解析** `package.json`，取所有 `node scripts/<x>.mjs` 形式的调用目标。
 *
 * ⚠ **只断言单向**：`scripts` 里被声明的 ⇒ 必须在 MUST-TRACK；
 *   **不**反推"MUST-TRACK 里的每一脚本都必须被 scripts 声明"
 *   （反方向不成立：`check-gitignore.mjs` 自己也被声明，但骨架文件类条目与 `npm run` 无关）。
 * ⚠ 解析失败（`package.json` 读不到 / `scripts` 段缺失）⇒ **FAIL 而不是跳过** ——
 *   跳过等于"基准读不到就默认通过"，那正是本脚本反复盯防的假通过形态。
 */
const PKG = join(root, 'package.json')
{
  let pkgSrc = ''
  try { pkgSrc = execFileSync('cat', [PKG], { encoding: 'utf8' }) } catch { pkgSrc = '' }
  if (pkgSrc === '') {
    bad('读不到 package.json（脚本声明面读不到 ⇒ 本断言失去基准，不按通过处理）')
  } else {
    let scripts = undefined
    try { scripts = JSON.parse(pkgSrc).scripts } catch { scripts = undefined }
    if (scripts === undefined || typeof scripts !== 'object' || scripts === null) {
      bad('package.json 里找不到可解析的 `scripts` 段（基准缺失 ⇒ 不按通过处理）')
    } else {
      // 抽 `node scripts/<x>.mjs`（允许路径前后有其它参数，如 `node scripts/x.mjs --flag`）
      const declared = new Set()
      for (const cmd of Object.values(scripts)) {
        if (typeof cmd !== 'string') continue
        for (const m of cmd.matchAll(/node\s+(scripts\/[A-Za-z0-9._-]+\.mjs)/g)) declared.add(m[1])
      }
      if (declared.size === 0) {
        bad('package.json 的 scripts 里一个 `node scripts/*.mjs` 都没解析到（解析口径可能已漂 ⇒ 不按通过处理）')
      } else {
        const missing = [...declared].filter((p) => !trackedPaths.has(p))
        for (const p of missing) {
          bad(`package.json 声明的脚本不在 MUST-TRACK 里：${p}  —— 「被 npm run 调到」的脚本一旦被 .gitignore 静默排除，`
            + 'clone 后该命令直接 ENOENT，而本脚本不会报（这正是 check-experience / next-experience-id 曾经漏掉的形态）')
        }
        if (missing.length === 0) {
          ok(`package.json 声明的 ${declared.size} 个脚本（${[...declared].sort().join(' · ')}）全部已在 MUST-TRACK 里`)
        }
      }
    }
  }
}

/**
 * ── 反向自检（2026-10-11 新增 · 第 52 轮）：**`scripts/*.mjs` 必须都有落点** ──────
 *
 * ── 为什么需要（缺口有实测出处）──────────────────────────────────────
 * 上面那段是**正方向**的一条半：`package.json` 声明的 ⇒ 必须在 MUST-TRACK 里。
 * 它仍然**抓不到反方向**：`scripts/` 下**存在一个 `.mjs`、却没被任何 `npm run` 调到** ——
 * 那个脚本**没有任何东西会跑它**，它的期望值过期后**无人发现**（E-127 实证：`host-probe`
 * 的 5 条期望过期六轮；`module-independence-probe` 同病，第 49 / 51 轮各清一个）。
 * ⇒ 上加断言：**每个 `scripts/*.mjs` 都必须在 `package.json` 的 `scripts` 里找到落点**。
 * 这正是 **E-122**（"机制建好，却没人往里送东西"）的收口 —— 把"忘记登记"从静默变显式 FAIL。
 *
 * ── 判据（为什么以 package.json 为唯一权威）─────────────────────────────
 * 与上面那段同源：**声明的唯一权威是 `package.json` 的 `scripts`**；手抄一张期望表
 * 等于再造一个会漂移的清单（E-70 同族）。
 *
 * ⛔ **不许放宽既有断言** —— 本段**只追加**，上面那段（正方向）一字未动。
 *
 * ── 显式白名单（⛔ 不是"扫不到就算了"）───────────────────────────────
 * 有些 `.mjs` 可能是**纯库 / 被别的脚本 import**（本就不该单独进 `npm run`）⇒
 * 它们必须**逐条显式登记在下面这张表里**，而不是靠"规则扫不到"。
 * ⚠ 白名单**当前为空**（实测 10/10 全部有落点）；表存在的意义是：将来越过规则时
 * **必须留下一条带理由的记录**，而不是悄悄漏掉。
 * ⚠ 白名单自身也**不许腐烂**（E-122 同族）：表里的路径若**已不在磁盘**、或**反而被
 * package.json 声明了**（自相矛盾）⇒ 同样 **FAIL**，逼人删掉或修正，不留幽灵条目。
 */
const SCRIPTS_DIR = join(root, 'scripts')
/**
 * 白名单：本就不该被 `npm run` 单独调到的 `scripts/*.mjs`（相对仓库根的路径）。
 * 每条形如 `[path, 理由]`。⛔ 理由必须写清"为什么它不需要落点"。
 */
const SCRIPT_LANDING_EXEMPT = []
{
  let onDisk = []
  try {
    onDisk = readdirSync(SCRIPTS_DIR, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.mjs'))
      .map((d) => `scripts/${d.name}`)
      .sort()
  } catch {
    onDisk = []
  }
  if (onDisk.length === 0) {
    bad('读不到 scripts/ 下的任何 .mjs（基准读不到 ⇒ 本断言不按通过处理；'
      + '跳过等于"扫不到就默认通过"，那正是本脚本反复盯防的形态）')
  } else {
    let pkgSrc2 = ''
    try { pkgSrc2 = readFileSync(PKG, 'utf8') } catch { pkgSrc2 = '' }
    let declared2 = undefined
    try { declared2 = JSON.parse(pkgSrc2).scripts } catch { declared2 = undefined }
    if (pkgSrc2 === '' || declared2 === undefined || typeof declared2 !== 'object' || declared2 === null) {
      bad('反向自检读不到 package.json 的 `scripts` 段（基准缺失 ⇒ 不按通过处理）')
    } else {
      const declaredSet = new Set()
      for (const cmd of Object.values(declared2)) {
        if (typeof cmd !== 'string') continue
        for (const m of cmd.matchAll(/node\s+(scripts\/[A-Za-z0-9._-]+\.mjs)/g)) declaredSet.add(m[1])
      }
      const exemptSet = new Set(SCRIPT_LANDING_EXEMPT.map(([p]) => p))
      // ① 白名单不许腐烂：幽灵条目 / 自相矛盾条目都 FAIL
      for (const [p, why] of SCRIPT_LANDING_EXEMPT) {
        if (!onDisk.includes(p)) {
          bad(`白名单里有幽灵条目（磁盘上已无此文件）：${p}  —— ${why}`
            + '（E-122：白名单自己也会腐烂 ⇒ 过期条目必须清掉，不能静默留着）')
        }
        if (declaredSet.has(p)) {
          bad(`白名单条目与事实矛盾（该文件其实已被 package.json 声明）：${p}  —— ${why}`
            + '（既已声明就不该再豁免 ⇒ 二者只能留一个）')
        }
      }
      // ② 主体：每个 scripts/*.mjs 必须有落点
      const orphan = onDisk.filter((p) => !declaredSet.has(p) && !exemptSet.has(p))
      for (const p of orphan) {
        bad(`scripts/ 下的脚本没有落点（不在 package.json 的 scripts 里）：${p}`
          + '\n      ⇒ 没有任何 `npm run` 会调到它 ⇒ 它的期望值过期也**无人发现**'
          + '\n      ⇒ 这正是 **E-122 / E-127** 的形态（host-probe 5 条期望过期六轮无人发现）'
          + '\n      ⇒ 修法：要么把它接进 `package.json` 的某个 script（并在 MUST-TRACK 里登记），'
          + '\n        要么——若它本就不该单独跑（纯库 / 被别的脚本 import）——'
          + '\n        在 `SCRIPT_LANDING_EXEMPT` 里**显式登记 + 写明理由**（⛔ 不许靠"扫不到就算了"）')
      }
      if (orphan.length === 0) {
        ok(`反向自检 ✓ scripts/ 下 ${onDisk.length} 个 .mjs **全部有落点**`
          + `（都在 package.json 的 scripts 里${exemptSet.size > 0 ? `，另有 ${exemptSet.size} 个显式豁免` : ''}）`
          + ' ⇒ "新加脚本忘了登记"这种静默缺口已被机检收口')
      }
    }
  }
}

/**
 * ── 断言 K · **同源判据的字面量必须逐字相同**（2026-10-11 第 55 轮）────────────
 *
 * ── 为什么需要它（缺口有实测出处）──────────────────────────────────────
 *   同一条判据写在**两处**（写入侧 `src/server/hob-write.ts` · 检查侧本脚本），
 *   因为 `src/` 与 `scripts/` 是**两棵互不依赖的树**（`src/` 不能 import `scripts/`，
 *   反之亦然 —— 那会把检查脚本变成产品依赖）⇒ 只能**照抄 + 在两侧注释里互相指名**。
 *   ⇒ 后果："照抄"这件事**全靠人守**，谁忘了对一眼，两侧就会**各写一套**。
 *   ⚠ **实测发生的正是这个**（第 54 轮 · **E-130**）：两侧的归档路径正则都写 `[a-z0-9-]`
 *     （**不含点号**）⇒ 含点号的路径在**两侧同时**不被当引用 ⇒
 *     **写下一个永远创建不出来的路径，全程无人提醒**。
 *     ⚠ 危险之处在于：**两侧一致地错**时，"两边一致"会被误当成"两边都对"。
 *   ⇒ 本断言把"照抄"从**人守**变成**机检**：两侧的字面量必须**逐字相同**；
 *     不同 ⇒ FAIL 并**打印两侧各自的字面量与所在文件**。
 *
 * ── 判据（口径：**只比字面量文本**，不比"行为等价"）──────────────────────
 *   · 目标是**防各写一套**，不是判"两种写法是否等价" ⇒ **逐字文本比对**最简单、不误报；
 *     ⚠ **刻意不做"语义等价"判断**（那要写一个正则解析器，且会引入误报面）。
 *   · ⚠ **提取失败（找不到 / 换了写法）⇒ FAIL 并明说"提取不到"** ——
 *     ⛔ **不许静默通过**：静默通过等于这条机检不存在（与断言 I 的教训同族）。
 *
 * ── 覆盖范围（**照实登记**，见 `.hob/README.md` §1.4）────────────────────
 *   · **管**：两对**正则字面量** —— 归档路径（`REF_PATH_RE` ↔ `D_REF_RE`）·
 *     作业书文件名（`REF_TASK_RE` ↔ `D_TASK_RE`）。
 *     这些都是**具名声明**（`const X = /…/g`）⇒ 提取稳定。
 *   · **不管（已知边界）**：`hob-render.ts` 的 `fencedMask` ↔ 本脚本的 `fencedMaskBelow`
 *     —— 那是**函数体照抄**，不是字面量。⚠ 比对函数体**极易脆**（空白 / 注释 / 改名
 *     都会误报），故**判不可机检**，如实登记边界，⛔ **不为"看起来全护住"而写一条会误报的机检**。
 *     ⚠ **但它内含的那个正则（围栏开标记）是可机检的** ⇒ 本断言**顺带**比对它：
 *       检查侧有具名 `FENCE_OPEN_RE`，写侧是**内联字面量**（`const m = /…/.exec(...)`），
 *       故对写侧改用"**字面量文本是否在文件中出现**"的判据（见 K_LITERAL_CHECKS 的第 3 项）。
 *   · ⚠ **只覆盖"两侧都在的文件"**：将来若有**第三处**也抄一份，本断言**不自动覆盖**
 *     ⇒ 记进已知边界（与"脚本落点只扫一层"同族）。
 */
{
  /** 声明式正则提取：`[export] const|let|var NAME = /…/flags`。 */
  const DECL_RE = /(?:^|\s)(?:const|let|var|export\s+const)\s+([A-Za-z_$][\w$]*)\s*=\s*(\/(?:\\.|\[[^\]]*\]|[^/\n\\])+\/[gimsuy]*)/g
  /** 从源码里取某个具名声明的正则字面量；找不到返回 `null`（**不静默**）。 */
  const grabDeclared = (src, name) => {
    DECL_RE.lastIndex = 0
    let m
    while ((m = DECL_RE.exec(src)) !== null) if (m[1] === name) return m[2]
    return null
  }
  const rel = (p) => relative(root, p).replace(/\\/g, '/')

  /**
   * 同源对清单：`[标签, 写侧文件, 写侧取法, 检查侧文件, 检查侧取法]`。
   * ⚠ 取法两种：`['decl', 名字]` = 具名声明；`['contains', 字面量]` = 文本包含。
   */
  const WRITE_TS = join(root, 'src', 'server', 'hob-write.ts')
  const RENDER_TS_K = join(root, 'src', 'server', 'hob-render.ts')
  const CHECK_MJS = join(root, 'scripts', 'check-gitignore.mjs')
  const K_LITERAL_CHECKS = [
    ['归档路径（REF_PATH_RE ↔ D_REF_RE）', WRITE_TS, ['decl', 'REF_PATH_RE'], CHECK_MJS, ['decl', 'D_REF_RE']],
    ['作业书文件名（REF_TASK_RE ↔ D_TASK_RE）', WRITE_TS, ['decl', 'REF_TASK_RE'], CHECK_MJS, ['decl', 'D_TASK_RE']],
  ]
  const readOrNull = (p) => { try { return readFileSync(p, 'utf8') } catch { return null } }
  const srcW = readOrNull(WRITE_TS)
  const srcR = readOrNull(RENDER_TS_K)
  const srcC = readOrNull(CHECK_MJS)
  if (srcW === null || srcR === null || srcC === null) {
    bad('K 同源字面量比对【基准缺失】：读不到源码文件 '
      + `${[WRITE_TS, RENDER_TS_K, CHECK_MJS].map(rel).join(' / ')} ⇒ 不按通过处理（不许静默）`)
  } else {
    const srcOf = (p) => (p === WRITE_TS ? srcW : p === RENDER_TS_K ? srcR : srcC)
    let kBad = 0
    for (const [label, wFile, wHow, cFile, cHow] of K_LITERAL_CHECKS) {
      const wSrc = srcOf(wFile)
      const cSrc = srcOf(cFile)
      // 写侧：具名声明，或"该字面量出现在文件中"（内联写法）
      let wLit = null
      let cLit = null
      try {
        if (wHow[0] === 'decl') wLit = grabDeclared(wSrc, wHow[1])
        else { wLit = cHow[0] === 'decl' ? grabDeclared(cSrc, cHow[1]) : null }
        if (cHow[0] === 'decl') cLit = grabDeclared(cSrc, cHow[1])
        else cLit = wLit
      } catch { /* 下面按"提取不到"处理 */ }
      // ⚠ 提取失败 ⇒ FAIL 并明说（⛔ 不许静默通过）
      if (wHow[0] === 'decl' && wLit === null) {
        kBad++
        bad(`K 同源对【提取不到】：\`${label}\` 在写侧 ${rel(wFile)} 里找不到具名声明的正则字面量 `
          + `\`${wHow[1]}\`（写法变了？）— ⛔ 不许静默通过：提取不到 = 这条机检等于不存在`)
        continue
      }
      if (cHow[0] === 'decl' && cLit === null) {
        kBad++
        bad(`K 同源对【提取不到】：\`${label}\` 在检查侧 ${rel(cFile)} 里找不到具名声明的正则字面量 `
          + `\`${cHow[1]}\`（写法变了？）— ⛔ 不许静默通过：提取不到 = 这条机检等于不存在`)
        continue
      }
      if (wLit !== cLit) {
        kBad++
        bad(`K 同源对**不一致**：\`${label}\` —— 两侧的字面量**必须逐字相同**（改一处必须改另一处）`
          + `\n      · ${rel(wFile)}: \`${wLit}\``
          + `\n      · ${rel(cFile)}: \`${cLit}\``
          + '\n      ⇒ 这两处是**同一处口径的两个副本**（`src/` 与 `scripts/` 互不 import，只能照抄）'
          + `\n      ⇒ 后果实测过（第 54 轮 · E-130）：两侧各写一套时，含点号的路径在**两侧同时**`
          + `\n        不被当引用 ⇒ 一条永远创建不出来的路径全程无人提醒 —— "两边一致地错"`
          + `\n      ⇒ 修法：把两侧改成**同一个字面量**（改完请对一眼另一处）`)
      }
    }
    // ── 围栏开标记：写侧是**内联**字面量（非具名声明）⇒ 用"文本包含"判据 ──
    {
      const cLit = grabDeclared(srcC, 'FENCE_OPEN_RE')
      const wInline = /const\s+m\s*=\s*(\/(?:\\.|\[[^\]]*\]|[^/\n\\])+\/[gimsuy]*)\s*\.exec\s*\(/.exec(srcR)
      if (cLit === null) {
        kBad++
        bad('K 同源对【提取不到】：检查侧 `FENCE_OPEN_RE` 找不到（写法变了？）— ⛔ 不许静默通过')
      } else if (wInline === null) {
        kBad++
        bad('K 同源对【提取不到】：写侧围栏正则不是**内联字面量**形态（`const m = /…/.exec(…)`）——'
          + '写法变了 ⇒ 提取不到。⛔ 不许静默通过：请把本断言的取法同步到新写法（或改回内联）')
      } else if (wInline[1] !== cLit) {
        kBad++
        bad(`K 同源对**不一致**：\`围栏开标记（fencedMask 内联 ↔ FENCE_OPEN_RE）\` —— 两侧必须逐字相同`
          + `\n      · ${rel(RENDER_TS_K)}（内联）: \`${wInline[1]}\``
          + `\n      · ${rel(CHECK_MJS)}: \`${cLit}\``
          + `\n      ⇒ 两侧对"什么算围栏"必须同口径，否则文档里能安全写的例子，机检会报残留（E-114 家族）`)
      }
    }

    // ── K 的自带样本（**E-126**：成对，且**不依赖真实源码当前状态**）──
    //   ⚠ 判据 = **该咬的全咬、不该咬的全不咬**；数照实记（**E-117**：⛔ 不写死"预期几个"）。
    //   这里把"比对逻辑"抽成一个小函数（与主体同口径），再把样本喂它 —— 样本不受源码现状影响。
    const sameLiteral = (a, b) => a === b
    const K_BITE_SAMPLES = [
      ['/archive\\/\\d{4}-[a-z0-9-]+\\/X/g', '/archive\\/\\d{4}-[A-Za-z0-9._-]+\\/X/g', 'S1 只有字符集不同（第 54 轮真事故的最小复现）'],
      ['/TASK-R\\d+\\.md/g', '/TASK-R\\d+[A-Za-z0-9-]*\\.md/g', 'S2 量词不同（少了一段）'],
      ['/^\\s{0,3}(`{3,}|~{3,})(.*)$/', '/^\\s{0,3}(`{3,}|~{3,})+(.*)$/', 'S3 只差一个 `+`'],
    ]
    const K_SAFE_SAMPLES = [
      ['/archive\\/\\d{4}-\\d{2}-\\d{2}-[A-Za-z0-9._-]+\\/[A-Za-z0-9._/-]*/g', '/archive\\/\\d{4}-\\d{2}-\\d{2}-[A-Za-z0-9._-]+\\/[A-Za-z0-9._/-]*/g', 'S4 完全相同的字面量'],
      ['/TASK-R\\d+[A-Za-z0-9-]*\\.md/g', '/TASK-R\\d+[A-Za-z0-9-]*\\.md/g', 'S5 完全相同的字面量（另一对）'],
    ]
    for (const [a, b, why] of K_BITE_SAMPLES) {
      if (sameLiteral(a, b)) {
        kBad++
        bad(`K 自带样本**没被咬**：${why} —— 两个**不同**的字面量被判成"相同" ⇒ 判据**改哑**（永远通过）`)
      }
    }
    for (const [a, b, why] of K_SAFE_SAMPLES) {
      if (!sameLiteral(a, b)) {
        kBad++
        bad(`K 自带样本**被误咬**：${why} —— 两个**相同**的字面量被判成"不同" ⇒ 判据过宽（会误报）`)
      }
    }
    // ── 口径判定（§1⑤ 要求"先判口径并说明"）：**只比字面量文本，不比语义等价** ──
    //   ⚠ 下面这个样本是**刻意**的："语序/空白不同、语义可能相同" ⇒ **判为"不同"（该咬）**。
    //     理由：本断言要防的是"**各写一套**"，不是"判两种写法等价"—— 后者要写正则解析器、
    //     且必然引入误报面（正是本条注释开头点名"极易脆"的那类）。⇒ 口径 = **逐字文本**。
    {
      const a = '/TASK-R\\d+ [A-Za-z0-9-]*\\.md/g'
      const b = '/TASK-R\\d+[A-Za-z0-9-]*\\.md/g'
      if (sameLiteral(a, b)) {
        kBad++
        bad('K 口径样本异常：插入空白后仍被判"相同" ⇒ 说明比对不是"逐字文本"口径（与注释不符）')
      }
      // ⚠ 反过来说：**空白不同就该咬** ⇒ 若它"不咬"才是问题；这里断言它**确实咬**、
      //   并在输出里说明这是**有意口径**（不是误报）。
    }
    if (kBad === 0) {
      ok(`K ✓ 同源字面量：${K_LITERAL_CHECKS.length} 对具名声明**全部逐字相同**`
        + `（${K_LITERAL_CHECKS.map((x) => x[0].replace(/（.*$/, '')).join(' · ')}）`
        + '；另比 1 处**内联**字面量（围栏开标记：写侧内联 ↔ 检查侧 FENCE_OPEN_RE）**逐字相同**'
        + `；自带样本 ${K_BITE_SAMPLES.length} 该咬 / ${K_SAFE_SAMPLES.length} 不该咬 全过`
        + `；口径 = **只比字面量文本**（空白/语序不同即判不同 —— 有意如此）`)
    }
  }
}

/**
 * ── 文档形态机检（2026-10-10 新增 · UD-88 / CHG-025）────────────────────────
 *
 * 背景：用户裁定四份文档（方案 + 三本账本）一律**「只写当前状态」** ——
 * 正文只描述**现在是什么样**，**不带**「订正（日期·批次）：原文此处……」这类
 * **补丁式历史说明**；改动时**旧版整份归档**到 `archive/<日期>-<名>/`。
 * ⇒ 两条断言防它**回潮**：
 *   **A 模板与正本节名一致** —— 防"正本改了形态、模板没跟"（新工作区起手就写成旧形态）。
 *   **B 正本里不许出现补丁式历史说明** —— 形态本身被写回去。
 *
 * ⚠ **A 的闸门**：账本区在工作区**之外**，别的机器上可能不存在
 *   ⇒ 读不到时**明确跳过并说明**（计数 + 打印原因），**绝不静默 PASS**。
 *   这正是本脚本一贯盯防的"基准读不到就默认通过"。
 *
 * ⚠ **B 的正则为什么是这个形状**（实测调过，见回报的负向对拍读数）：
 *   ① **锚定行首 + 排除"元讨论"**：三份正本里**合法地**出现了这些词，但都出现在
 *      **讨论该纪律本身**的句子里（如 `CONTEXT.md:8` "本文件**不带历史说明** ——
 *      不写「原写…已失实」…"）。裸词 grep 会把**纪律条文**判成**违规**。
 *      ⇒ 只认**行首**的补丁注记形态（`订正（2026-…` / `原文此处` / `已失实` / `原写`），
 *        且**不**把 `**加粗**` 里的词、句子中段的引述算进来。
 *   ② **不弱化**：这不是"把正则调弱到永远 PASS" —— 它仍对**真实违规**有牙
 *      （实测：纳入前 `PROJECT.md` 曾被抓出 2 处真违规，读数见回报；
 *        第 20 轮负向对拍又当场抓着一次 —— 见该轮回报的插补丁句读数）。
 *
 * ⚠ **`PROJECT.md` 已于 2026-10-10 纳入**（第 20 轮 · UD-88 / CHG-025）：
 *   它原为**旧形态**（正文里成片「订正（日期）：原文此处……」式补丁说明），
 *   当时纳入会**当场 FAIL**；而"不许为了让检查通过而放宽断言"是本项目红线
 *   ⇒ 上一轮采取**显式排除 + 标注待办**，待办登记在 `CONTEXT.md` §2.2「未修的缺口」。
 *   2026-10-10 用户重载实例（解除旧插件 `write_hob` 可写名单的封锁）后，
 *   Hob 已把它**整份改写为 v2.0「只写当前状态」**：122455 → 67876 字节，
 *   旧整份存 `archive/2026-10-10-project-plan-move/PROJECT.md`（逐字节）。
 *   ⇒ 排除的**理由已消失**：`B_FILES` 现含 `PROJECT.md`，四份正本**全部纳入**形态机检，
 *     本文件里**不再有任何"待纳入"的例外**。
 */
const LEDGER_ROOT = (() => {
  // ⚠ 与其它脚本同口径：账本父目录**不硬编码本机绝对路径**（UD-73③），
  //   从 profile 的预设行声明 `ledgerHome` 读出；读不到再退回缺省候选。
  const candidates = []
  try {
    const preset = readFileSync(join(root, 'preset', 'dsh-hob', 'preset-dsh-hob.patch.yml'), 'utf8')
    const m = /ledgerHome:\s*(\S+)/.exec(preset)
    if (m !== null) candidates.push(m[1])
  } catch { /* 预设读不到 ⇒ 只走下面的候选 */ }
  // 候选：<ledgerHome>/<工作区目录名>（本项目的工作区名 = 目录名）
  const wsName = basename(root)
  for (const home of candidates) {
    const dir = join(home, wsName)
    if (existsSync(dir)) return dir
  }
  return undefined
})()

/**
 * A 用的：正本文件名（**有配套空模板**的那三本 —— 断言 A 比的是「正本节名 ↔ 模板节名」）。
 *
 * ── 为什么 `PROJECT.md` **不在 A 里**（2026-10-10 第 21 轮 · Hob 裁定，**非疏漏**）──
 *   **方案的模板不存在** —— `.hob/templates/` 里没有 `PROJECT.md`
 *   （该目录 7 份：`DECISIONS` / `USER-DECISIONS` / `CONTEXT` / `ROLES` / `GATES` / `TASK` / `REPORT`）。
 *   原因不是"还没建"：**方案是项目专有文档，不是可复用的骨架格式** ——
 *   三本账本是「同构空模板 + 每项目填条目」，方案是**逐项目唯一**的整篇文档，
 *   两者形态本就不同。⇒ **"无模板可比"是正当状态**，**不是遗漏、不是待办**。
 *   （⚠ 因此**不要**在这里写"待补模板"之类的话：把它登记成待办，等于把
 *    一个正当的分类结果误报成缺口。）
 *   ⚠ 反证：若把 `PROJECT.md` 塞进 A 的循环，A 会立刻报
 *   「A 模板读不到：…/.hob/templates/PROJECT.md —— 节名比对失去基准」⇒ **FAIL、exit 1**
 *   （第 20 轮实测）。而"不许为了让检查通过而放宽断言"是本项目红线
 *   ⇒ 正确做法是 **A 只覆盖有模板的三本**（判定逻辑一字未改），**B 覆盖全部四份正本**。
 *
 * ⚠ **A / B 两个常量的基准不同 ⇒ 不可合并**（这正是第 20 轮暴露的缺陷）：
 *   · `A_FILES` 的基准 = **模板**（`templates/<同名>.md` 必须存在，没有就没法比）；
 *   · `B_FILES` 的基准 = **正本本身**（只需账本区有该文件，与模板无关）。
 *   两者**判据不同**，故**必须各用各的常量** ——
 *   合并成一个（第 20 轮之前就是合并的）会在"扩一条的范围"时**隐式连坐**另一条：
 *   给 B 加 `PROJECT.md`，A 当场被带挂，而改动方在运行前看不到（`B_FILES` 有第二个消费者）。
 *   ⇒ 见 `.hob/EXPERIENCE.md` **E-110**（同一教训已登记为经验条目）。
 */
const A_FILES = ['DECISIONS.md', 'USER-DECISIONS.md', 'CONTEXT.md']

/** B 用的：正本文件名（账本区**四份文档全部纳入**，2026-10-10 起无例外）。 */
const B_FILES = ['PROJECT.md', 'DECISIONS.md', 'USER-DECISIONS.md', 'CONTEXT.md']

if (LEDGER_ROOT === undefined) {
  // ⚠ **明确跳过并说明**（不静默 PASS）：这一支不计入 fail，但**打印为什么跳过**。
  ok(`文档形态机检【跳过】—— 账本区读不到（工作区之外，本机可能未建立）`
    + `⇒ 断言 A（模板↔正本节名）、断言 B（正本无补丁式说明）、`
    + `断言 C（账本仓忽略规则不许写宽）**三条均未执行**，`
    + `不代表通过。跳过位置：scripts/check-gitignore.mjs 的 LEDGER_ROOT 解析。`)
} else {
  // ── 断言 A：模板与正本的节名一致 ──────────────────────────────────────
  // ⚠ 节 key 口径：`## ` 之后的标题，**剥掉** `**加粗**` 与**尾部全角括号注解**。
  //   理由：注解是**本项目专有**的（如"（三条都是实测逼出来的）"），
  //   模板不应照抄项目史；而**节主题词**必须一致 ⇒ 只比主题词。
  const secKey = (line) => {
    let s = line.replace(/^##\s+/, '').replace(/\*\*/g, '').trim()
    let prev
    do {
      prev = s
      s = s.replace(/\s*[（(][^（()）]*[）)]\s*$/, '').trim()
    } while (s !== prev)
    return s
  }
  const secKeys = (src) => src.split('\n').filter((l) => /^##\s+\S/.test(l)).map(secKey)

  for (const f of A_FILES) {
    const mp = join(LEDGER_ROOT, f)
    const tp = join(root, '.hob', 'templates', f)
    let msrc = ''
    let tsrc = ''
    try { msrc = readFileSync(mp, 'utf8') } catch { msrc = '' }
    try { tsrc = readFileSync(tp, 'utf8') } catch { tsrc = '' }
    if (msrc === '') {
      bad(`A 正本读不到：${mp} —— 节名比对失去基准（不按通过处理）`)
      continue
    }
    if (tsrc === '') {
      bad(`A 模板读不到：${tp} —— 节名比对失去基准（不按通过处理）`)
      continue
    }
    const mKeys = secKeys(msrc)
    const tSet = new Set(secKeys(tsrc))
    if (mKeys.length === 0) {
      bad(`A 正本 ${f} 里一个 \`## \` 节标题都没解析到 —— 解析口径可能已漂（不按通过处理）`)
      continue
    }
    const missing = mKeys.filter((k) => !tSet.has(k))
    if (missing.length > 0) {
      bad(`A 模板缺节：模板 .hob/templates/${f} 里找不到正本 ${f} 的节 —— ${missing.map((k) => `「${k}」`).join(' / ')}`
        + '（正本改了形态而模板没跟 ⇒ 新工作区起手就会写成旧形态）')
    } else {
      ok(`A ✓ ${f}：模板与正本节名一致（${mKeys.length} 节全对上）`)
    }
  }

  // ── 断言 B：正本里不许出现补丁式历史说明 ──────────────────────────────
  // 两级正则（都**行首锚定**，避免把"讨论该纪律"的句子误判）：
  //   T1 = 带日期锚的补丁注记：`订正（2026-…` / `更正（2026-…`
  //   T2 = 行首（可带列表记号/引用记号/加粗）的补丁式起句：`原文此处` / `已失实` / `原写` / `原为` …
  const PATCH_T1 = [
    /(?:订正|更正|修正)\s*[（(]\s*\d{4}/,
    /[（(]\s*\d{4}-\d{2}-\d{2}\s*[）)]\s*[：:]?\s*(?:原文|原写|原为)/,
  ]
  const PATCH_T2 = [
    /^\s*(?:[-*+]\s*)?(?:>\s*)?(?:\*\*)?(?:原文此处|已失实|原写|原为|原表述|此前写作)/,
  ]
  for (const f of B_FILES) {
    let src = ''
    try { src = readFileSync(join(LEDGER_ROOT, f), 'utf8') } catch { src = '' }
    if (src === '') {
      bad(`B 正本读不到：${join(LEDGER_ROOT, f)} —— 形态比对失去基准（不按通过处理）`)
      continue
    }
    const hits = []
    src.split('\n').forEach((l, i) => {
      for (const re of [...PATCH_T1, ...PATCH_T2]) {
        if (re.test(l)) { hits.push(`:${i + 1} ${l.trim().slice(0, 90)}`); break }
      }
    })
    if (hits.length > 0) {
      bad(`B 正本 ${f} 出现**补丁式历史说明**（形态回潮）—— `
        + hits.map((h) => `\n        ${h}`).join('')
        + `\n      ⇒ 现行口径是「只写当前状态」：删掉补丁段，把**旧版整份**存进 archive/<日期>-<名>/`)
    } else {
      ok(`B ✓ ${f}：无补丁式历史说明（行首锚定 + 日期锚，正/负向都对拍过）`)
    }
  }
  ok(`文档形态机检【已执行】—— 正本根 = ${LEDGER_ROOT}；`
    + `四份正本**全部纳入** ${B_FILES.join(' / ')}`
    + `（2026-10-10 起无例外：\`PROJECT.md\` 已改写为 v2.0「只写当前状态」，故纳入）`)

  /**
   * ── 断言 J（2026-10-11 新增 · 第 53 轮）：**四份正本里同一节标题不得出现两次** ──
   *
   * 背景见文件顶部的 `findDuplicateSectionHeadings`：第 52 轮 Hob 写 `USER-DECISIONS.md`
   * 时留过一个**重复的** `## 五、回复格式`，那一版**结构已坏而全部检查都不红** ——
   * 它是被「备份 diff 判读」**偶然撞见**的。本条把那次事故变成**可判的事**。
   *
   * ⚠ **判据成对**（**E-126**：只验一侧 ⇒ 判据写对与写错输出相同）
   *   ⇒ 下面**自带样本**：`N 该咬` + `M 不该咬`（**写死、不依赖正本内容**）。
   * ⚠ **另对"真实发生过的坏快照"做活体实证**（见 J-B 段）—— 比自造样本更强。
   * ⚠ **范围**：只扫四份正本（`B_FILES`）· 只认 `^## `（二级）· 围栏内不参与。
   */
  {
    // ── J-A 自带样本（写死在断言里，不依赖正本内容）──
    // ⚠ 数照实记（**E-117**：⛔ 不写死"预期几个"）；判据 = **该咬的全咬、不该咬的全不咬**。
    const J_BITE_SAMPLES = [
      ['## 一、甲\n## 二、乙\n## 一、甲\n', 'S1 行首二级标题**重复一次**（最朴素形态）'],
      ['## 一、甲\n正文\n## 二、乙\n## 一、甲\n## 一、甲\n', 'S2 同一标题**出现三次**（重复计数必须 ≥2）'],
      ['## 一、甲\n## 一、甲\n## 二、乙\n', 'S3 重复**相邻**（中间无正文）'],
      ['## 一、甲\n' + '```md\n' + '## 一、甲\n' + '```\n' + '## 一、甲\n',
        'S4 夹着一段围栏：**围栏内那份豁免、围栏外的两处仍须被咬**'],
    ]
    const J_EXEMPT_SAMPLES = [
      ['## 一、甲\n## 二、乙\n## 三、丙\n', 'S5 每个标题**只出现一次** ⇒ 不咬'],
      ['## 一、甲\n\n' + '```md\n' + '## 一、甲\n' + '```\n', 'S6 第二处在**围栏代码块内**（那是示例）⇒ 不咬'],
      ['同一行里提到 `## 一、甲` 与 `## 一、甲` ⇒ **不在行首**。\n', 'S7 行内提及（不在行首）⇒ 不咬'],
      ['### 一、甲\n### 一、甲\n', 'S8 三级标题重复 ⇒ **本轮范围外**（只认 `^## `）⇒ 不咬'],
      ['## 一、甲\n# 一、甲\n', 'S9 一级标题不属于本判据（只认 `^## `）⇒ 不咬'],
    ]
    let jBad = 0
    for (const [sample, why] of J_BITE_SAMPLES) {
      const d = findDuplicateSectionHeadings(sample)
      if (d.length === 0) {
        jBad++
        bad(`J 自带样本**没被咬**：${why} —— 期望 ≥1 个重复标题，实测 0 个`
          + '\n      ⇒ 判据**过窄/改哑**：真出现重复标题时它不会报 ⇒ 断言 J **失效**')
      }
    }
    for (const [sample, why] of J_EXEMPT_SAMPLES) {
      const d = findDuplicateSectionHeadings(sample)
      if (d.length !== 0) {
        jBad++
        bad(`J 自带样本**被误咬**：${why} —— 期望 0 个重复标题，实测 ${d.length} 个：`
          + ` ${d.map((x) => `「${x.title}」@${x.lines.join(',')}`).join(' · ')}`
          + '\n      ⇒ 判据**过宽**：把示例 / 行内提及 / 范围外标题当成违规 ⇒ 文档会被自己的例子打挂'
          + '（**E-114** 家族）')
      }
    }
    if (jBad === 0) {
      ok(`J ✓ 自带样本：${J_BITE_SAMPLES.length} 个"该咬"的样本**全部咬到**，`
        + `${J_EXEMPT_SAMPLES.length} 个"不该咬"的样本**全部未**被咬（自带样本，不依赖正本内容）`)
    }

    // ── J-B 活体实证：对**真实发生过的坏快照**跑同一函数（形同单测）──
    // ⚠ 备份**只读、只复制**（⛔ 绝不写 backups/）；坏的这份是 2026-10-11 第 52 轮
    //    Hob 写坏的那一版，`## 五、回复格式` 在第 200 与第 425 行各一个。
    // ⚠ 这条样本若**读不到**（别的机器上账本区可能不在）⇒ **明说"未取"，不静默当成通过**。
    const BAD_SNAPSHOT = join(LEDGER_ROOT, 'backups', 'USER-DECISIONS.md.20261011-022744.bak')
    let snapSrc = ''
    try {
      snapSrc = readFileSync(BAD_SNAPSHOT, 'utf8')
    } catch { snapSrc = '' }
    if (snapSrc === '') {
      ok(`J ⏳ 活体实证【未取】—— 读不到历史坏快照 ${BAD_SNAPSHOT}`
        + '（账本区 backups/ 可能不在本机）⛔ **这不代表通过**')
    } else {
      const dup = findDuplicateSectionHeadings(snapSrc)
      const hit = dup.find((x) => x.title === '五、回复格式')
      if (hit === undefined) {
        bad(`J 活体实证失败：历史坏快照 ${basename(BAD_SNAPSHOT)} 里没找出「五、回复格式」的重复`
          + `（实测重复标题 = ${dup.length === 0 ? '0 个' : dup.map((x) => `「${x.title}」`).join(' · ')}）`
          + '\n      ⇒ **判据没抓住真实发生过的错** ⇒ 判据写错了（不是夹具的问题）')
      } else if (hit.lines.length < 2) {
        bad(`J 活体实证失败：坏快照里「五、回复格式」只被找到 ${hit.lines.length} 处`
          + `（第 ${hit.lines.join(',')} 行）—— 期望 ≥2 处`)
      } else {
        ok(`J ✓ 活体实证（真实坏快照 ${basename(BAD_SNAPSHOT)}）：`
          + `「${hit.title}」重复，命中第 ${hit.lines.join(' 与第 ')} 行（共 ${hit.lines.length} 次）`
          + ' ⇒ 判据抓住了**真实发生过的那次错**，不是自造样本')
      }
    }

    // ── J-C 主体：四份正本逐份跑 ──
    for (const f of B_FILES) {
      let src = ''
      try { src = readFileSync(join(LEDGER_ROOT, f), 'utf8') } catch {
        bad(`J 正本读不到：${join(LEDGER_ROOT, f)} —— 标题重复比对失去基准（不按通过处理）`)
        continue
      }
      const dup = findDuplicateSectionHeadings(src)
      if (dup.length > 0) {
        bad(`J 正本 ${f} 出现**重复的二级节标题** —— `
          + dup.map((x) => `\n        ✗ 「${x.title}」出现在第 ${x.lines.join(' 与第 ')} 行（共 ${x.lines.length} 次）`).join('')
          + `\n      ⇒ 一份文档里同一节只能有一处：重复标题多半是**追加写**留下的残骸`
          + `（第 52 轮实测：决定被追加到文件末尾、尾部重复了「五、回复格式」）`
          + ` ⇒ 修法：**整份重写**（正本改动必须整份重写），⛔ 不追加订正段`)
      } else {
        ok(`J ✓ ${f}：无重复的二级节标题（${(src.match(/^##\s+\S/gm) ?? []).length} 个标题，逐一唯一）`)
      }
    }
  }

  /**
   * ── 断言 C（2026-10-10 新增 · 第 19 轮 · UD-88 / CHG-025）────────────────
   * **账本仓自己的 `.gitignore` 不许写宽。**
   *
   * 背景：账本仓（`<ledgerRoot>/`）在 2026-10-10 新增了自己的 `.gitignore`，
   *   规则**只有一条** `backups/`（依据 README §1 的归类：改前备份属运行数据 · 不进 git）。
   *   ⚠ 风险：若有人图省事写成 `*`（或 `**` 之类宽规则），会把**四份文档与 `archive/`**
   *   一起**静默排除** —— git **不报任何错**，直到某天发现仓库里没有文档（E-70 / E-73 同族）。
   *
   * ⚠ **判据用"行为"而不是"解析文本"**（刻意）：
   *   解析 `.gitignore` 语法要重写一套 git 的匹配语义（取反、目录匹配、`**`），
   *   写出来**必然与 git 本身有偏差**；而这里要问的问题**git 自己就能回答** ——
   *   ⇒ 直接在**账本仓里**跑 `git check-ignore --no-index`，**以 git 的答案为准**。
   *   （同 §1.4 的既有口径：判"规则"而不是判"当下 index 看得见什么"。）
   *
   * 正反两向都验（缺一即假通过）：
   *   正向：四份文档 + `archive/` **必须都不被忽略**（任一被忽略 ⇒ FAIL）
   *   反向：`backups/` **必须被忽略**（否则"整目录不进库"没生效，噪音会回来）
   */
  const ignoreIn = (cwd, target) => {
    try {
      execFileSync('git', ['check-ignore', '-q', '--no-index', '--', target], { cwd, stdio: 'ignore' })
      return 0 // 被规则排除
    } catch (e) {
      if (typeof e.status === 'number') return e.status // 1 = 未被排除
      throw e
    }
  }
  // ⚠ 四份文档是**具体文件**、`archive/` 是**目录** —— 目录用「带尾斜杠 + 内嵌一个已知文件」两法都探，
  //   防"目录本身不匹配规则、但内部文件被排掉"这类偏差（与 `git check-ignore` 的目录语义有关）。
  const C_MUST_NOT_IGNORE = [
    ['PROJECT.md', '项目方案（唯一事实源）'],
    ['DECISIONS.md', '方案变更记录'],
    ['USER-DECISIONS.md', '用户决策记录'],
    ['CONTEXT.md', '当前工作上下文'],
    ['archive/', '各批归档（§3 指针表说它由账本仓 git 记录保证）'],
  ]
  // ⚠ 前置：账本仓**必须是 git 仓库**（否则 check-ignore 无意义，会一律报 exit 128 ⇒ 假 PASS）
  let ledgerIsRepo = false
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: LEDGER_ROOT, encoding: 'utf8' }).trim()
    ledgerIsRepo = top !== ''
  } catch { ledgerIsRepo = false }
  if (!ledgerIsRepo) {
    bad(`C 账本仓不是 git 仓库（${LEDGER_ROOT}）⇒ 忽略规则无从判定（不按通过处理）`)
  } else {
    const wronglyIgnored = C_MUST_NOT_IGNORE.filter(([p]) => ignoreIn(LEDGER_ROOT, p) === 0)
    if (wronglyIgnored.length > 0) {
      bad('C 账本仓的忽略规则**写宽了** —— 下列路径被判为"被忽略"：'
        + wronglyIgnored.map(([p, why]) => `\n        ${p}（${why}）`).join('')
        + '\n      ⇒ 它们会被**静默排除**（git 不报错）；规则应**只忽略 `backups/`**。'
        + `\n      判据：在 ${LEDGER_ROOT} 跑 \`git check-ignore --no-index <路径>\` 应为 1（未被排除）`)
    } else {
      ok(`C ✓ 账本仓：四份文档与 archive/ **均未被忽略**（${C_MUST_NOT_IGNORE.length} 项逐条实测）`)
    }
    // 反向：backups/ 必须被忽略
    if (ignoreIn(LEDGER_ROOT, 'backups/') !== 0) {
      bad('C 账本仓的 `backups/` **没有被忽略** —— "整目录不进库"（README §1 口径）未生效，'
        + '下一轮起 `git status` 会重新冒出"N 删 + M 增"的噪音')
    } else {
      ok('C ✓ 账本仓：`backups/` 确被忽略（反向判据，规则真的生效）')
    }
  }

  /**
   * ── 断言 D（2026-10-10 新增 · 第 25 轮 · UD-89/90 / CHG-026/027）──────────
   * **正本里"具名的"归档路径引用，必须真的存在。**
   *
   * 背景（本条的出处，实测）：第 24 轮执行方发现 `CONTEXT.md` 写着
   *   「各轮作业书（R21 系 / R22 系 / **R23 系**）」，而按 `TASK-R23` 通配
   *   **零命中** —— R23 系作业书**根本不存在**（Hob 把"轮次号"写成了"文件名"）。
   *   ⚠ 这是**同族第三次**（E-108 字段名 · E-109 数字口径 · 本次文件名），
   *   共同点是"**写的是我以为它叫什么，而不是我去看一眼它叫什么**"。
   *   ⚠ 关键：这类错误**当时没有任何机检能发现** —— 只能靠人读文档。
   *   ⇒ 把它变成机器盯的（E-108③：**能机器核的不要靠人记**）。
   *
   * ── 判据（为什么是这个形状）──────────────────────────────────────────
   *   在四份**正本**里扫 `archive/<YYYY-MM-DD-slug>/…` 形式的引用，**逐条核实磁盘上存在**。
   *
   *   ⚠ **只认"具名路径"** —— 判据**与既有权威口径同源**：
   *   `src/server/hob-write.ts` 的 `ARCHIVE_DIR_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/`
   *   （`hob-write.ts:57`，写侧一直在用它校验归档目录名）。
   *   ⚠ **为什么照抄而不是 `import`**：本脚本**零 src 依赖**（骨架机检不该依赖
   *     服务端模块能否加载 —— `hob-write.ts` 还牵连 `doc-read.ts`），且导出该常量
   *     要改 `src/**`（非本批范围）⇒ **照抄同一条正则并在此注明同源**。
   *   ⚠ **改这条正则时必须同步看一眼 `hob-write.ts:57`**，两边不许各写一套。
   *
   *   ⇒ 这样**天然排除**两类"不是引用"的文本（不需要另写排除表）：
   *   · 占位形态：`archive/<日期>-<名>/` · `archive/<YYYY-MM-DD-slug>/TASK.md`
   *     —— `<` 与 CJK 不在字符集里 ⇒ **不匹配**；
   *   · **描述性举例**：如 `archive/DATE-NAME/`（第 26 轮实测：它出现在
   *     `CONTEXT.md` 里**描述本断言边界**的那一行）—— 目录名段**不是日期格式**
   *     ⇒ **不匹配**。
   *   ⚠ 这条"不把举例当引用"的能力是**第 26 轮修出来的**（原来的宽正则把
   *     `archive/DATE-NAME/` 判成了"不存在的引用"，把断言自己打挂）。
   *     当时的注释写着"不会因为文档里出现了示例路径而误判"，而实现做不到 ——
   *     **现在做到了，本注释与实现相符**。见 `.hob/EXPERIENCE.md` **E-114**。
   *
   *   ⚠ **为什么用 `existsSync` 而不是"在 git 里"**：正本引用的是**账本区里的事实文件**
   *   （可能尚未 `git add`，如刚写的作业书）—— 问"文件在不在磁盘上"才是原意；
   *   "在不在 git 里"是**另一条判据**（断言 C 与 MUST-TRACK 已在管）。
   *
   *   ⚠ **举证形态**：一条引用都不存在 ⇒ 不是 FAIL，而是**打印计数说明**（见下）——
   *     "四份正本里没有任何具名引用"是**合法现状**（本批实测：`TASK-R*.md` 为 0 处），
   *     此时断言**无对象可查**，必须如实说明，**不许硬造**、也不许假装通过。
   */
  // ⚠ 与 `src/server/hob-write.ts:57` 的 `ARCHIVE_DIR_RE` **同源**（改一处请对一眼另一处）。
  //   只认 `archive/<YYYY-MM-DD-slug>` 打头的路径 ⇒ 占位与举例自然落选。
  // ⚠ **2026-10-11 第 54 轮收紧（只收紧、不放宽）**：slug 字符集由 `[a-z0-9-]` 放宽到
  //   `[A-Za-z0-9._-]` —— 原口径下 `archive/2026-10-11-plan-v2.2/PROJECT.md`（**slug 含点号**）
  //   **整条不被当引用** ⇒ 写入侧不报、**本断言也不报**（同源同病）；而写侧 `ARCHIVE_DIR_RE`
  //   会**拒写**那种目录 ⇒ 一条永远创建不出来的路径，全程无人提醒。
  //   ⚠ **不是放宽**：旧正则在**每一处**都仍匹配（严格超集，504 组组合实测 lost=0）⇒
  //     既有断言未被削弱，只是**多认出一种坏写法**（合法性仍归 `ARCHIVE_DIR_RE`）。
  //   ⚠ **同源的另一面**：与写侧 `REF_PATH_RE` **逐字同源**既是纪律（E-110），
  //     也意味着**一个缺陷会同时在两侧静默** —— "两边一致"不等于"两边都对"（**E-130**）。
  const D_REF_RE = /archive\/\d{4}-\d{2}-\d{2}-[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]*/g
  let dTotal = 0
  let dMissing = 0
  for (const f of B_FILES) {
    let src = ''
    try { src = readFileSync(join(LEDGER_ROOT, f), 'utf8') } catch { src = '' }
    if (src === '') {
      bad(`D 正本读不到：${join(LEDGER_ROOT, f)} —— 引用核验失去基准（不按通过处理）`)
      continue
    }
    src.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(D_REF_RE)) {
        const ref = m[0]
        // 通配（`TASK-*.md` 之类）不是具名引用 —— 跳过，不算数。
        if (ref.includes('*')) continue
        dTotal++
        if (!existsSync(join(LEDGER_ROOT, ref))) {
          dMissing++
          bad(`D 正本 ${f}:${i + 1} 引用了**不存在**的路径：\`${ref}\``
            + '\n      ⇒ 正本里的具名引用必须真的存在（凭记忆写文件名已踩坑三次：E-108 / E-109 / 本条的出处）'
            + `\n      ⇒ 核实方式：在 ${LEDGER_ROOT} 跑 \`ls ${ref}\``)
        }
      }
    })
  }
  if (dTotal === 0) {
    // ⚠ **不判 FAIL**：这一支是"没有可查对象"，不是"查出来有问题"。
    //   但也**不静默** —— 必须打印说明，否则读者会把"没输出"当成"查过了、没问题"。
    ok('D ✓ 四份正本里**没有**具名的 `archive/…` 路径引用（0 处）⇒'
      + ' 本断言**无对象可查**（已扫描，非跳过；占位形态 `archive/<日期>-<名>/` 按设计不计）')
  } else if (dMissing === 0) {
    ok(`D ✓ 四份正本里的 ${dTotal} 处具名归档路径引用，**全部真实存在**（逐条 ${dTotal} 次 existsSync）`)
  }

  /**
   * ── D 的**自带样本**（2026-10-11 第 54 轮收紧后补 · **E-126** 成对纪律）────────
   *
   * ⚠ **为什么必须补**：第 54 轮把 slug 字符集由 `[a-z0-9-]` 放宽到 `[A-Za-z0-9._-]`
   *   （修"含点号 slug 整条不被当引用"的真缺口）。收紧/放宽判据时**必须同时验两侧**：
   *   只验"该咬的会咬" ⇒ **判据写对与过宽**输出相同；
   *   只验"不该咬的" ⇒ **判据写对与改哑**输出相同（**E-126** 原话）。
   *   ⇒ 下面写死一组样本：**该咬侧**必须匹配到、**不该咬侧**必须匹配不到；任一不符 ⇒ FAIL。
   * ⚠ 样本**写死、不依赖正本内容**（正本会变）；数照实记（**E-117**：⛔ 不写死"预期几个"）。
   */
  {
    const D_BITE_SAMPLES = [
      ['archive/2026-10-11-plan-v2.2/PROJECT.md', 'O1 含点号 slug（第 54 轮修的真缺口：旧口径整条不匹配）'],
      ['archive/2026-10-11-Plan-V2/PROJECT.md', 'O2 含大写 slug（同上，旧口径不匹配）'],
      ['archive/2026-10-10-docs_restructure/X.md', 'O3 含下划线 slug'],
      ['archive/2026-10-11-plan-v2-2/PROJECT.md', 'O4 合规 slug（既有能力，不许因收紧而丢）'],
    ]
    const D_SAFE_SAMPLES = [
      ['archive/<日期>-<名>/', 'N1 占位（含 `<` 与 CJK）—— 按设计不计'],
      ['archive/<YYYY-MM-DD-slug>/TASK.md', 'N2 占位（非数字日期）—— 按设计不计'],
      ['archive/DATE-NAME/', 'N3 描述性举例（目录名不是日期格式）—— 不匹配'],
      ['archive/2026-10-10-docs-restructure/X.md', 'N4 通配（`*`）—— 由调用方的 includes("*") 跳过，正则本身匹配'],
    ]
    let dBad = 0
    for (const [sample, why] of D_BITE_SAMPLES) {
      D_REF_RE.lastIndex = 0
      if (D_REF_RE.exec(sample) === null) {
        dBad++
        bad(`D 自带样本**没被咬**：${why} —— 样本 \`${sample}\` **没被 D 的正则匹配到**`
          + '\n      ⇒ 判据**过窄/改哑**：含这种 slug 的引用不会被核实 ⇒ D 对"写不出来的路径"无效'
          + '\n      ⇒ 这正是第 54 轮修的真缺口形态（`archive/2026-10-11-plan-v2.2/PROJECT.md` 曾一声不响）')
      }
    }
    for (const [sample, why] of D_SAFE_SAMPLES) {
      D_REF_RE.lastIndex = 0
      const hit = D_REF_RE.exec(sample)
      // ⚠ N4 是通配：正则**匹配**它（那是对的），由调用方按 `*` 跳过 ⇒ 只断言前三例。
      if (!why.startsWith('N4') && hit !== null) {
        dBad++
        bad(`D 自带样本**被误咬**：${why} —— 样本 \`${sample}\` 被 D 的正则匹配到 \`${hit[0]}\``
          + '\n      ⇒ 判据**过宽**：把占位 / 举例当成具名引用 ⇒ 文档记录判据边界会把自己打挂'
          + '（**E-114** 家族：第 26 轮实测事故）')
      }
    }
    if (dBad === 0) {
      ok(`D ✓ 自带样本：${D_BITE_SAMPLES.length} 个"该咬"的样本**全部匹配到**，`
        + `${D_SAFE_SAMPLES.length} 个"不该咬"的样本形态**全部未**被误咬（自带样本，不依赖正本内容）`)
    }
  }

  /**
   * ── 断言 D′：**作业书文件名引用**（`TASK-R*.md`）必须真的存在 ──────────────
   *
   * ⚠ 为什么要单独一支：这条**正是本轮缺陷的原形态** ——
   *   `CONTEXT.md` 曾写「各轮作业书（R21 系 / R22 系 / **R23 系**）」，
   *   而 `archive/` 下按 `TASK-R23` 通配**零命中**。⚠ 那种写法（"R23 系"）**不带 `.md` 后缀**，
   *   上面的 `archive/…` 正则**抓不到它**；但要防住这类错误，判据只能是
   *   「**写成文件名就必须存在**」（叙事里的"第 23 轮"不必有文件，
   *   可一旦落笔成 `TASK-R23.md` 就必须有 —— 见经验 E-113 的正确做法②）。
   *   ⇒ 本支扫**带 `.md` 后缀的 `TASK-R*` 具名引用**，逐条核实账本区里存在。
   *
   * ⚠ **判据：按 basename 在 archive 的各日期子目录下找**（不要求写全路径）——
   *   因为正本里引用作业书时通常只写文件名（如 `TASK-R21.md`），
   *   而它实际落在 `archive/<日期>-<名>/` 下；要求写全路径会把**正确写法**判成违规。
   *
   *   ⚠ **编号必须是数字**（`TASK-R\d+…`）—— 第 26 轮修出来的精度：
   *   原判据是 `TASK-R[A-Za-z0-9-]*\.md`，会把 `CONTEXT.md` / `DECISIONS.md` 里
   *   「⛔ 别为了齐整给每轮都编一个 `TASK-Rnn.md`」这句**反例示意名**判成"不存在的引用"。
   *   `Rnn` 不是文件名形态（真作业书是 `TASK-R21.md` / `TASK-R22-ADDENDUM.md`）⇒ 排除。
   *   ⚠ 同时排除 `TASK-R*.md`（含 `*`，通配不是具名物）。
   *   ⇒ 与 D 同一条原则：**分得清"引用"与"描述引用的散文"**。见 **E-114**。
   */
  const D_TASK_RE = /TASK-R\d+[A-Za-z0-9-]*\.md/g
  let tTotal = 0
  let tMissing = 0
  /** 账本区 `archive/` 下所有文件的 basename 集合（扫一次，供逐条比对）。 */
  const archiveBasenames = (() => {
    const set = new Set()
    try {
      for (const d of readdirSync(join(LEDGER_ROOT, 'archive'))) {
        let entries = []
        try { entries = readdirSync(join(LEDGER_ROOT, 'archive', d)) } catch { continue }
        for (const e of entries) set.add(e)
      }
    } catch { /* archive 不可读 ⇒ 空集（下面的比对会因此全部报"不存在"，宁可报也不静默） */ }
    return set
  })()
  for (const f of B_FILES) {
    let src = ''
    try { src = readFileSync(join(LEDGER_ROOT, f), 'utf8') } catch { continue }
    src.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(D_TASK_RE)) {
        const name = m[0]
        tTotal++
        if (!archiveBasenames.has(name)) {
          tMissing++
          bad(`D 正本 ${f}:${i + 1} 引用了**不存在**的作业书：\`${name}\``
            + `\n      ⇒ 账本区 \`archive/*/\` 下没有这个 basename（实测 ${archiveBasenames.size} 个候选）`
            + '\n      ⇒ 写成文件名就**必须存在**：轮次号可以只叙事，但 `TASK-Rn.md` 是**具名物**'
            + `\n      ⇒ 核实方式：在 ${LEDGER_ROOT} 跑 \`ls archive/*/${name}\``)
        }
      }
    })
  }
  if (tTotal === 0) {
    // ⚠ 同上：**无对象可查 ≠ 通过**，但不判 FAIL（如实打印读数）。
    //   ⚠ 措辞与收紧后的判据一致：认的是 `TASK-R<数字>…md`（不是任意 `TASK-R*`），
    //     否则读者会以为"我写了 `TASK-Rnn.md` 却没被查" —— 文案与实现必须相符。
    ok('D′ ✓ 四份正本里**没有** `TASK-R<数字>...md` 形式的作业书文件名引用（0 处；'
      + '示意名如 `TASK-Rnn.md`、通配如 `TASK-R*.md` **按设计不计**）⇒'
      + ' 本支**无对象可查**（已扫描，非跳过）')
  } else if (tMissing === 0) {
    ok(`D′ ✓ 四份正本里的 ${tTotal} 处作业书文件名引用，**全部真实存在**`
      + `（按 basename 在 archive 的各日期子目录下比对，候选 ${archiveBasenames.size} 个）`)
  }

  /**
   * ── 断言 E：**元讨论容忍**（2026-10-10 新增 · 第 28 轮 · 采纳第 27 轮建议 2）────
   * **判据不许咬"描述它自己的文本"。**
   *
   * ── 为什么需要它（第 26 轮的实测事故）──────────────────────────────────
   *   D / D′ 上线一轮后，正本新增了「**描述这两条断言边界**」的文本
   *   （`archive/DATE-NAME/` 这类举例、`TASK-Rnn.md` 这类反例示意名），
   *   而**宽口径正则把它们当成了"不存在的引用"** ⇒ 断言**被描述自己的文本打挂**。
   *   ⚠ **必然性**：文档**要记录判据的边界**，"一旦记了就会触发它"
   *     ⇒ 这不是巧合，是**必现情形**（见 `EXPERIENCE.md` **E-114**）。
   *
   * ── 为什么必须"自带样本"（本组与第 27 轮那次第 4 组的**关键区别**）──────
   *   ⚠ 第 27 轮修复后，第 4 组是**直接用正本自带的文本**跑的
   *     ⇒ 它验证的只是"**当前那三行**"，**不是"任意举例形态"**；
   *     正本一旦改写或挪走那几行，**这条回归就静默失效**（而没人会知道）。
   *   ⇒ 本组把"**不该被当成引用**"的形状**硬编码为样本**，每次跑都验 ——
   *     验证的是**判据本身的性质**，**不依赖正本里恰好有什么**。
   *
   * ── 判据 ─────────────────────────────────────────────────────────────
   *   下面每个样本**必须不被** D / D′ 的正则匹配。
   *   任何一个被匹配 ⇒ **FAIL + exit 1**，并打印**哪条正则咬到哪个样本**。
   *   ⚠ 这是**反向保护**：它保的不是"正本内容对不对"（那是 D / D′ 的活），
   *     而是"**D / D′ 有没有退化成又会咬元讨论的宽口径**"。
   *   ⚠ **不能靠跑一遍正本来代替**：正本里此刻没有某类样本，
   *     不代表判据对它安全（第 26 轮就是这么栽的）。
   */
  const META_TOLERANCE_SAMPLES = [
    // ── 占位形态（描述"归档目录该长什么样"时必然出现）──
    ['archive/DATE-NAME/', '纯 ASCII 占位（第 26 轮实测：就是它把断言打挂的）'],
    ['archive/<日期>-<名>/', '含 `<` 与 CJK 的占位'],
    ['archive/<YYYY-MM-DD-slug>/TASK.md', '含 `<` 的占位路径 + 通用 TASK.md'],
    // ⚠ **刻意不放** `archive/2026-10-10-xxx/` 这类样本：它在**形状上**就是合法日期目录
    //   ⇒ D **应该**去核实它存在（不存在就 FAIL，那是**真违规**，不是元讨论）。
    //   把它塞进"容忍样本"等于要求断言放过真引用 —— 那是**放宽**，不是容忍。
    // ── 通配（描述"每轮作业书"时的省略写法）──
    ['TASK-*.md', '作业书通配'],
    ['TASK-R*.md', '作业书编号通配'],
    ['TASK-*-ADDENDUM.md', '附加件通配'],
    // ── 示意名（描述"别这么写"时的反例）──
    ['TASK-Rnn.md', '示意名：编号不是数字（第 26 轮实测的第二个命中）'],
    ['TASK-Rn.md', '示意名：单字母占位'],
  ]
  let eBad = 0
  for (const [sample, why] of META_TOLERANCE_SAMPLES) {
    // ⚠ 每次都要**重置 lastIndex**：这两个正则带 `g` 标志（有状态）。
    D_REF_RE.lastIndex = 0
    D_TASK_RE.lastIndex = 0
    const hitPath = D_REF_RE.exec(sample)
    const hitTask = D_TASK_RE.exec(sample)
    if (hitPath !== null || hitTask !== null) {
      eBad++
      const which = hitPath !== null ? 'D（路径）' : 'D′（作业书名）'
      const got = hitPath !== null ? hitPath[0] : hitTask[0]
      bad(`E 元讨论容忍**被破坏**：样本 \`${sample}\`（${why}）被**断言 ${which} 的正则咬到**`
        + `（匹配到 \`${got}\`）`
        + '\n      ⇒ 该样本**不是具名引用**，是**描述判据自身的文本** —— 不许当成引用'
        + '\n      ⇒ 这会让"文档记录判据边界"这一动作**把断言自己打挂**（第 26 轮实测事故，见 E-114）'
        + '\n      ⇒ 修法：判据要与既有权威口径同源（`archive/<YYYY-MM-DD-slug>/` / `TASK-R<数字>`），'
        + '别退回字符集宽口径')
    }
  }
  if (eBad === 0) {
    ok(`E ✓ 元讨论容忍：${META_TOLERANCE_SAMPLES.length} 个"不该被当成引用"的样本，`
      + '**全部未被** D / D′ 咬到（自带样本，不依赖正本内容）')
  }
}

// ── 断言 F · 纪律登记表（2026-10-10 新增 · 第 45 轮 · 结构改造③）────────────
/**
 * **每条纪律必须声明"谁来查"。**
 *
 * ── 为什么需要它（缺口 3 · 规矩没有执行器）─────────────────────────────
 *   纪律写在文档里、**靠立规矩的人记得遵守** ⇒ 实测失败 2 次：
 *     · 第 36 轮立"不写失效状态字"，而**该纪律的落点文本自己就犯了**；
 *     · 第 42 轮立"计数要带口径"，而**派单时又写死"预期 11 处"**。
 *   ⚠ 共同点：**立规矩的人与守规矩的人是同一个**，没有第三方核对。
 *
 * ── 设计要点（为什么不判断"什么算一条纪律"）────────────────────────────
 *   那是**语义判断**，机器做不到（也做不稳）。⇒ 改为**建一张登记表**，
 *   并断言**表里每个"机检归属"都真实存在** ⇒
 *   真正的牙口是「**指向一个不存在的检查**会被当场抓住」。
 *   ⚠ **可判、不依赖语义、也不需要数条数**（**E-117**：计数会漂移，不当判据）。
 *
 * ── 判据 ─────────────────────────────────────────────────────────────
 *   ① 表读不到 / 0 行 ⇒ **FAIL**（"失去基准 ⇒ 不按通过处理"，**不许静默**）；
 *   ② 每行第 3 列非空，空 ⇒ **FAIL 并打印是哪一行**；
 *   ③ 第 3 列须为 `` `check:<name>` ``（且该 name **在 package.json scripts 里存在**）
 *      或 `未机器化`，其余一律 **FAIL + 打印该行原文**；
 *   ④ 尤其：`` `check:不存在的名字` `` ⇒ **FAIL**（**本组主牙口**）。
 *
 * ⚠ **只解析 README §5.1 的表**（列名行 + 其后的 `| … | … | … |` 行）——
 *   不扫全文件，避免把别处的表格当登记表（那会让判据依赖无关内容）。
 */
const ZERO_WIDTH_RE = /[\u200B\uFEFF\u200E\u200F]/
{
  const src = readmeSrc
  const lines = src.split('\n')
  // 表头行：三列表头里含「机检归属」
  const headIdx = lines.findIndex((l) => l.startsWith('|') && l.includes('机检归属'))
  let rows = []
  if (headIdx >= 0) {
    for (let i = headIdx + 1; i < lines.length; i++) {
      const l = lines[i]
      if (!l.startsWith('|')) break // 表结束
      if (/^\|[\s:|-]+\|$/.test(l.trim())) continue // 分隔行
      rows.push({ no: i + 1, raw: l })
    }
  }
  if (headIdx < 0 || rows.length === 0) {
    bad('F 读不到「纪律登记表」（README §5.1）⇒ 归属核验失去基准，**不按通过处理**'
      + '\n      ⇒ 该表的判据是"每条纪律必须有归属"，表没了则纪律**重新变回没人管**（本组要防的正是这个）')
  } else {
    // package.json 的 scripts **键名**（判据 ③ 要拿它当唯一权威；不硬编码期望表）
    let scriptNames = null
    try {
      const pkgRaw = execFileSync('cat', [PKG], { encoding: 'utf8' })
      const sc = JSON.parse(pkgRaw).scripts
      if (sc !== null && typeof sc === 'object') scriptNames = new Set(Object.keys(sc))
    } catch { scriptNames = null }
    if (scriptNames === null) {
      bad('F 读不到 package.json 的 scripts（归属判据的唯一权威缺失 ⇒ 不按通过处理）')
    } else {
      let fBad = 0
      let manualCount = 0
      for (const r of rows) {
        // 第 3 列 = 第 3 个 `|` 分隔的单元格
        const cells = r.raw.split('|').map((c) => c.trim())
        // cells[0] 是行首 `|` 前的空串 ⇒ 数据列从 cells[1] 起
        const third = cells[3] ?? ''
        if (third === '') {
          fBad++
          bad(`F 第 ${r.no} 行的「机检归属」为空 ⇒ **每条纪律都必须声明"谁来查"**`
            + `\n      ⇒ 该行原文：${r.raw}`
            + '\n      ⇒ 填 `check:<名字>`（须真实存在）或 `未机器化`（如实登记，不是失败）')
          continue
        }
        if (third === '未机器化') { manualCount++; continue }
        const m = /^`check:([A-Za-z0-9:._-]+)`$/.exec(third)
        if (m === null) {
          fBad++
          bad(`F 第 ${r.no} 行的「机检归属」不是合法值：\`${third}\``
            + `\n      ⇒ 该行原文：${r.raw}`
            + '\n      ⇒ 合法值只有两种：`` `check:<name>` ``（name 须在 package.json scripts 里）或 `未机器化`')
          continue
        }
        const name = `check:${m[1]}`
        if (!scriptNames.has(name)) {
          fBad++
          bad(`F 第 ${r.no} 行的「机检归属」指向**不存在的检查**：\`${name}\``
            + `\n      ⇒ 该行原文：${r.raw}`
            + `\n      ⇒ package.json 的 scripts 里没有 \`${name}\`（现有：${[...scriptNames].sort().join(' · ')}）`
            + '\n      ⇒ 这正是本组的主牙口：**指向一个不存在的检查会被当场抓住**'
            + '（否则纪律会挂着"有人管"的名义，实际没人管）')
          continue
        }
      }
      if (fBad === 0) {
        ok(`F ✓ 纪律登记表：${rows.length} 行，第 3 列**全部合法**`
          + `（\`check:<存在的名字>\` ${rows.length - manualCount} 行 · \`未机器化\` ${manualCount} 行）`)
      }
    }
  }
}

// ── 断言 G · 零宽 / 不可见字符（2026-10-10 新增 · 第 45 轮）────────────────
/**
 * **`src/**` 与 `scripts/**` 内不得含零宽 / 不可见字符。**
 *
 * ⛔ **不扫 `.md`**（**有意取舍**）：文档里**必然**会"**描述这个禁令本身**" ——
 *   本节的注释、README 与正本的纪律段都要写下那四个码位（如上面的 `[\u200B…]`）。
 *   若把 `.md` 也纳入，**讲这条禁令的那几行会把自己打挂**（**E-114 家族**：
 *   判据被"描述它自己的文本"咬到）。⇒ 只扫**代码**（那里没有"描述禁令"的正当需求）。
 *
 * ⚠ 为什么要有它：本条纪律（"不许零宽字符"）此前是**人守**的
 *   —— 实测在 `src/modules/orchestrator.ts` 的一句注释里**留了一个 U+200B**
 *   直到第 44 轮才被人工发现 ⇒ 本轮把它**机器化**（纪律登记表的归属随之上移）。
 */
{
  const SKIP_DIRS = new Set(['node_modules', '.git'])
  const hits = []
  const walk = (dir) => {
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue
      const p = join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!/\.(ts|mjs|js|tsx)$/.test(e.name)) continue
      let src = ''
      try { src = readFileSync(p, 'utf8') } catch { continue }
      src.split('\n').forEach((line, i) => {
        if (ZERO_WIDTH_RE.test(line)) {
          hits.push(`${relative(root, p).replace(/\\/g, '/')}:${i + 1}`)
        }
      })
    }
  }
  walk(join(root, 'src'))
  walk(join(root, 'scripts'))
  if (hits.length === 0) {
    ok('G ✓ `src/**` 与 `scripts/**` 内零宽/不可见字符（U+200B / U+FEFF / U+200E / U+200F）：**0 处**'
      + '（⛔ 不扫 `.md` —— 文档要"描述这条禁令本身"，扫了会自我打挂，见 E-114）')
  } else {
    bad(`G \`src/**\` 或 \`scripts/**\` 里出现零宽/不可见字符（${hits.length} 处）：`
      + ` ${hits.join(' · ')}`
      + '\n      ⇒ 这类字符**不可见却参与匹配/比较** ⇒ 会造成"看着一样、字节不同"的诡异缺陷'
      + '\n      ⇒ 清理后重跑；若确需在代码里引用这些码位，请用转义（`\\u200B`）而非字面量')
  }
}

// ── 断言 H · 读数渲染（2026-10-11 新增 · 第 47 轮 · 结构改造④）──────────────
/**
 * **正本里"会漂移的读数"改由写入工具在落盘前渲染** —— 本组验它**真的有牙**。
 *
 * ── 治哪条根因（缺口 4 · 值靠手抄）─────────────────────────────────────
 *   计数 / 字节数此前**手写进文本**，靠"快照口径"声明"会过期"兜住漂移
 *   —— ⚠ 那是**免责**，不是**解决**。⇒ 值改由写入工具当场取。
 *
 * ── 为什么本组必须**真跑函数**而不是文本匹配 ─────────────────────────
 *   与 F 组同款理由：`src/**` 里 `renderReadings` 字样**还在**、实现被掏空时，
 *   文本断言照样 PASS。⇒ 用 Node ≥22 **直载 `.ts`** 实跑；import 失败即 **FAIL**
 *   （"基准跑不起来就默认通过"是假通过）。
 *
 * ── 判据（六条，逐条**真跑**）──────────────────────────────────────────
 *   H1 渲染正确：指向**真实存在**目标的标记 ⇒ 落盘内容是**实值**（与当场 `fs` 实测一致）；
 *   H2 值会变：目标文件**改大**后重写 ⇒ 渲染值**随之变**（与新实测一致）；
 *   H3 自引用拒绝：标记指向**正在写的那个文件自身**（`bytes`）⇒ **拒绝 + 点名**；
 *   H4 父目录拒绝：标记指向**正在写文件的父目录**（`count`）⇒ **拒绝 + 点名**；
 *   H5 围栏豁免：标记写在**围栏代码块内** ⇒ **不渲染、原样保留**（**E-114 家族**：
 *      "讲这个标记怎么写"的文档必须能安全存在）；
 *   H6 幂等保住：**同一份含标记的输入写两次** ⇒ 第二次 **skipped**
 *      （⚠ 渲染必须**先于**幂等比对，否则"标记原文"与"存量实值"永不相等 ⇒ 幂等失效）。
 *
 * ⚠ **判据同源**：本组用的 `scanMarkers` / `renderReadings` 与 `write_hob` 落盘时
 *   用的是**同一份实现**（`src/server/hob-render.ts`）—— 不在这里重写一套正则。
 *   理由：若各写一套，"文档里能安全写例子"与"机检报残留"会自相矛盾。
 */
const RENDER_TS = join(root, 'src', 'server', 'hob-render.ts')
const HOBWRITE_TS = join(root, 'src', 'server', 'hob-write.ts')

/** 断言 I 的扫描口径：**四份正本**（与 `B_FILES` 同源 —— 值就写在它们身上）。 */
{
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { pathToFileURL } = await import('node:url')

  let hr
  let hw
  let loadErr = null
  try {
    hr = await import(pathToFileURL(RENDER_TS).href)
    hw = await import(pathToFileURL(HOBWRITE_TS).href)
  } catch (e) {
    loadErr = e
    bad(`H 无法加载渲染 / 写入模块（${String(e?.message ?? e)}）⇒ 读数渲染的行为断言失去基准（不按通过处理）`)
  }

  if (loadErr === null && hr !== undefined && hw !== undefined) {
    const { scanMarkers } = hr
    const { writeHobFile } = hw
    /** 与 `src/modules/tools.ts` 的 DEFAULTS 同口径；上限调小以便本地沙箱够用。 */
    const opts = { hobDir: '', keepBackups: 3, shrinkGuard: 0.5, maxFileBytes: 262144 }
    const dir = mkdtempSync(join(tmpdir(), 'hob-hcheck-'))
    try {
      // 沙箱账本区：一个真目录（7 个条目）+ 一个大文件，供 H1/H2 取实测。
      mkdirSync(join(dir, 'templates'), { recursive: true })
      for (let i = 0; i < 7; i++) writeFileSync(join(dir, 'templates', `t${i}.md`), 'x', 'utf8')
      writeFileSync(join(dir, 'big.md'), 'a'.repeat(1234), 'utf8')

      // ── H1 **渲染正确**：落盘内容是实值（与当场 fs 实测一致）──
      {
        const c = '共 <!-- hob:count | templates --> 份 · <!-- hob:bytes | big.md --> 字节\n'
        const r = await writeHobFile(dir, { file: 'CONTEXT.md', content: c, mode: 'overwrite' }, opts)
        let disk = ''
        try { disk = readFileSync(join(dir, 'CONTEXT.md'), 'utf8') } catch { disk = '' }
        const wantCount = readdirSync(join(dir, 'templates')).length
        const wantBytes = readFileSync(join(dir, 'big.md')).length
        const okDisk = disk.includes(`共 ${wantCount} 份`) && disk.includes(`${wantBytes} 字节`)
        const noMarker = !disk.includes('<!-- hob:')
        if (r.ok === true && okDisk && noMarker) {
          ok(`H1 ✓ 渲染正确：落盘内容里是**实值**（count(templates)=${wantCount} · bytes(big.md)=${wantBytes}，`
            + '与当场 `fs` 实测一致），**标记不残留**')
        } else {
          bad(`H1 渲染未生效：ok=${r.ok} 落盘=${JSON.stringify(disk)}（期望 count=${wantCount} / bytes=${wantBytes}）`
            + ' ⇒ 标记没被替换成实值，或替换值不对')
        }
      }

      // ── H2 **值会变**：目标改大后重写 ⇒ 渲染值随之变 ──
      //   ⚠ 改写的内容**不短于**原内容：缩水守卫（`shrinkGuard`）会在"新内容 < 旧 × 0.5"时拒绝，
      //     那是**另一条**断言的地盘 —— 本组要验的是"渲染值跟着树走"，别让它被缩水守卫挡在门外。
      {
        writeFileSync(join(dir, 'big.md'), 'b'.repeat(4321), 'utf8')
        const pad = '（本条只验渲染值随目标变化，内容长度故意与上一版相当，避开缩水守卫。）\n'
        const r = await writeHobFile(dir, { file: 'CONTEXT.md', content: `<!-- hob:bytes | big.md --> 字节\n${pad}`, mode: 'overwrite' }, opts)
        let disk = ''
        try { disk = readFileSync(join(dir, 'CONTEXT.md'), 'utf8') } catch { disk = '' }
        const want = readFileSync(join(dir, 'big.md')).length
        if (r.ok === true && disk.trimStart().startsWith(`${want} 字节`)) {
          ok(`H2 ✓ 值会变：目标从 1234 改大到 ${want} 后重写 ⇒ 渲染值随之变为 ${want}（与新实测一致）`
            + ' —— 值取自**写入时**，不是写死在文本里')
        } else {
          bad(`H2 渲染值**没跟着变**：落盘=${JSON.stringify(disk)}（期望 ${want}）`
            + ' ⇒ 若渲染的是缓存/写死的值，本机制就退化成它要取代的"手抄"')
        }
      }

      // ── H3 **自引用拒绝**：指向正在写的那个文件自身（bytes）⇒ 拒绝 + 点名 + 原样保留 ──
      {
        const marker = '<!-- hob:bytes | PROJECT.md -->'
        const r = await writeHobFile(dir, { file: 'PROJECT.md', content: `自测：${marker}\n`, mode: 'overwrite' }, opts)
        let disk = ''
        try { disk = readFileSync(join(dir, 'PROJECT.md'), 'utf8') } catch { disk = '' }
        const refused = Array.isArray(r.readings?.refused) ? r.readings.refused : []
        const hit = refused.some((x) => x.reason === 'self-bytes' && x.line === 1)
        const msgHas = /读数\*\*未渲染\*\*|读数\*\*未渲染\*\*|未渲染/.test(r.message) && /第 1 行/.test(r.message)
        if (r.ok === true && hit && disk.includes(marker) && msgHas) {
          ok('H3 ✓ 自引用拒绝：指向**自身**且取 `bytes` ⇒ 拒绝渲染 + 点名（含**第 1 行** + 理由），'
            + '标记**原样保留**、**写入照常**（只提示、不拒写）')
        } else {
          bad(`H3 自引用未被拒绝或未被点名：ok=${r.ok} refused=${JSON.stringify(refused)} `
            + `标记还在盘上=${disk.includes(marker)} 消息含行号=${msgHas}`
            + ' ⇒ 这是"文件包含自身长度"的不可能任务，**必须**拒绝而不是渲染一个永远错的数')
        }
      }

      // ── H4 **父目录拒绝**：指向正在写文件的父目录（count）⇒ 拒绝 + 点名 ──
      {
        const marker = '<!-- hob:count | archive/2026-10-11-hcheck -->'
        const f = 'archive/2026-10-11-hcheck/TASK-R1.md'
        mkdirSync(join(dir, 'archive', '2026-10-11-hcheck'), { recursive: true })
        //   ⚠ 归档**拒 overwrite**（"归档是只增不改的历史"）⇒ 用 `append`（首写即创建）；
        //     否则本组会被**另一条**断言（archive-overwrite-denied）挡在门外，验不到父目录拒绝。
        const r = await writeHobFile(dir, { file: f, content: `自测：${marker}\n`, mode: 'append' }, opts)
        let disk = ''
        try { disk = readFileSync(join(dir, f), 'utf8') } catch { disk = '' }
        const refused = Array.isArray(r.readings?.refused) ? r.readings.refused : []
        const hit = refused.some((x) => x.reason === 'parent-count' && x.line === 1)
        if (r.ok === true && hit && disk.includes(marker)) {
          ok('H4 ✓ 父目录拒绝：指向**正在写文件的父目录**且取 `count` ⇒ 拒绝 + 点名（含第 1 行），'
            + '标记原样保留（写这份文件会改变该目录的条目数 ⇒ 同族的不可能任务）')
        } else {
          bad(`H4 父目录未被拒绝或未被点名：ok=${r.ok} refused=${JSON.stringify(refused)} 标记还在盘上=${disk.includes(marker)}`)
        }
      }

      // ── H5 **围栏豁免**（E-114 家族）：围栏内的标记不渲染、不报错 ──
      {
        const fenced = ['说明如下：', '```md', '<!-- hob:count | templates -->', '```', '结束。'].join('\n')
        const hits = scanMarkers(fenced)
        const r = await writeHobFile(dir, { file: 'CONTEXT.md', content: `${fenced}\n`, mode: 'overwrite' }, opts)
        let disk = ''
        try { disk = readFileSync(join(dir, 'CONTEXT.md'), 'utf8') } catch { disk = '' }
        const refused = Array.isArray(r.readings?.refused) ? r.readings.refused : []
        if (hits.length === 0 && refused.length === 0 && disk.includes('<!-- hob:count | templates -->')) {
          ok('H5 ✓ 围栏豁免：写在 ``` 围栏内的标记**不渲染、原样保留**、**不报 FAIL**'
            + '（**E-114 家族** —— "讲这个标记怎么写"的文档必须能安全存在，否则文档会被自己的例子打挂）')
        } else {
          bad(`H5 围栏豁免未生效：scanMarkers=${hits.length} refused=${JSON.stringify(refused.map((x) => x.reason))} `
            + `盘上还在=${disk.includes('<!-- hob:count | templates -->')}`
            + ' ⇒ 判据被"描述它自己的文本"咬到（E-114：必须调精度，⛔ 不许靠放宽判据绕开）')
        }
      }

      // ── H6 **幂等保住**：同一份含标记的输入写两次 ⇒ 第二次 skipped ──
      //   ⚠ 这条是本轮**最容易悄悄破的**：渲染若排在幂等比对**之后**，
      //     "标记原文"永远不等于"存量里的实值" ⇒ 每次写都"有变化"，幂等跳过失效。
      {
        const c = '共 <!-- hob:count | templates --> 份\n'
        const r1 = await writeHobFile(dir, { file: 'USER-DECISIONS.md', content: c, mode: 'overwrite' }, opts)
        const r2 = await writeHobFile(dir, { file: 'USER-DECISIONS.md', content: c, mode: 'overwrite' }, opts)
        let disk = ''
        try { disk = readFileSync(join(dir, 'USER-DECISIONS.md'), 'utf8') } catch { disk = '' }
        if (r1.ok === true && r2.action === 'skipped' && r2.reason === 'idempotent' && disk.trim().startsWith('共 ')) {
          ok('H6 ✓ 幂等保住：同一份**含标记**的输入写两次 ⇒ 第二次 `skipped`（渲染**先于**幂等比对）'
            + ' —— 否则幂等跳过失效、备份被反复刷屏')
        } else {
          bad(`H6 幂等被破坏：第一次=${r1.action} 第二次=${r2.action}/${r2.reason} 盘上=${JSON.stringify(disk)}`
            + ' ⇒ 渲染顺序错了（必须先渲染、再比对），这是本轮的**停手条件①**')
        }
      }
    } finally {
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
    }
  }
}

// ── 断言 I · 正本无残留标记（2026-10-11 新增 · 第 47 轮 · 结构改造④）────────
/**
 * **四份正本里不得存在未渲染的占位标记。**
 *
 * ── 为什么这条是"结构性拒绝"的**另一半** ────────────────────────────────
 *   渲染器对"做不到的渲染"（自引用 / 父目录 / 目标不存在 …）采取**只提示、不拒写**
 *   —— 与结构改造① 的既有口径一致。⇒ 于是**非法状态仍然写得进去**：
 *   标记会**留在正本里**，而"它本该是个数字"这件事**没人看得见**。
 *   ⇒ 本条把那个状态**变成机检能当场抓住的 FAIL**：
 *     "渲染被拒绝"与"正本里有残留标记"由此**一一对应**，跳过不了。
 *
 * ⚠ **判据与渲染器同源**：用 `hob-render.ts` 的 `scanMarkers`（**含围栏豁免**）。
 *   若这里自己写一套正则，就会出现"文档里写的例子合法、机检却报残留"的自相矛盾。
 * ⚠ **空态给读数**（正本里没有标记是**正常状态**，不是"没查"）。
 */
if (LEDGER_ROOT === undefined) {
  ok('I ✓ 正本无残留标记【跳过】—— 账本区读不到（工作区之外），**不代表通过**'
    + '（跳过位置：scripts/check-gitignore.mjs 的 LEDGER_ROOT 解析）')
} else {
  const RENDER_TS_I = join(root, 'src', 'server', 'hob-render.ts')
  let scan = null
  try {
    const { pathToFileURL } = await import('node:url')
    scan = (await import(pathToFileURL(RENDER_TS_I).href)).scanMarkers
  } catch (e) {
    bad(`I 无法加载渲染模块（${String(e?.message ?? e)}）⇒ 残留标记扫描失去基准（不按通过处理）`)
  }
  if (typeof scan === 'function') {
    const hits = []
    for (const f of B_FILES) {
      let src = ''
      try { src = readFileSync(join(LEDGER_ROOT, f), 'utf8') } catch {
        bad(`I 正本读不到：${join(LEDGER_ROOT, f)} —— 残留标记扫描失去基准（不按通过处理）`)
        continue
      }
      for (const h of scan(src)) {
        hits.push(`${f}:${h.line} \`${h.raw}\``)
      }
    }
    if (hits.length === 0) {
      ok(`I ✓ 四份正本里**没有**未渲染的占位标记（${B_FILES.length} 份逐份扫描，命中 0 处）`
        + ' ⇒ "渲染被拒绝"不会悄悄留在正本里（渲染器的"只提示、不拒写"由此有了收尾兜底）')
    } else {
      bad(`I 四份正本里存在**未渲染的占位标记**（${hits.length} 处）：${hits.join(' · ')}`
        + '\n      ⇒ 标记没被渲染成实值就落盘了（渲染被拒绝，或写入绕过了渲染器）'
        + '\n      ⇒ 处置：看写入返回值里的「读数**未渲染**」清单（含行号 + 理由），'
        + '改成可渲染的表述（最常见：目标是**该文件自身**取 `bytes`，或**其父目录**取 `count` —— 两者结构上不可能）'
        + '\n      ⇒ ⛔ 不许为本条放宽判据、也不许把标记留在正本里当"待办"')
    }

    // ── 断言 I 的「不该被咬 / 该咬的仍要咬」自带样本（2026-10-11 · 第 50 轮）────
    /**
     * ⚠ **补齐 `README §1.4` 的既有纪律**：新增"扫原文里的引用"的断言，
     *   **必须自带"不该被咬"的样本**。断言 I 第 47 轮上线时**缺了这一组**，
     *   于是第 49 轮被**真实文档**引爆（Hob 在 `CONTEXT.md` 复述标记形态，见 **E-125**）。
     *
     * ⚠ **样本写死在断言里**（学**断言 E** 的做法）：⛔ **不写进四份正本** ——
     *   否则就是"又拿真实文档当样本"，同一个坑会再踩一次。
     *
     * ⚠ **正向 + 反向都要有**：只验"不该咬的不咬"、不验"该咬的还咬不咬"，
     *   等于**把判据改哑**（豁免写宽到放过裸写，照样全绿）。
     */
    const TICK = '`'
    const IM = '<!-- hob:bytes | PROJECT.md -->'
    const I_EXEMPT_SAMPLES = [
      [TICK + TICK + TICK + '\n' + IM + '\n' + TICK + TICK + TICK,
        'S1 围栏内（块级豁免，与 H5 同口径）'],
      [TICK + IM + TICK, 'S2 行内反引号（第 50 轮新增的 code span 豁免）'],
      [TICK + TICK + TICK + IM + TICK + TICK + TICK,
        'S3 三反引号串内（长度匹配即配对，CommonMark 口径）'],
    ]
    const I_BITE_SAMPLES = [
      [IM, 'S4 裸写 —— **必须被咬**（正面对照：判据还长着牙）'],
      [TICK + IM, 'S5 未闭合反引号 ⇒ 行尾不豁免（**宁可多咬不可漏咬**）'],
      [TICK + 'x' + IM, 'S6 半截裸写（标记只起点在代码段内）⇒ 仍被咬'],
      [IM + ' 和 ' + TICK + IM + TICK, 'S7 段外裸写 + 段内引用同一行 ⇒ 恰好咬 1 处'],
      [TICK + TICK + IM + TICK, 'S8 长度不匹配（双开单闭）⇒ 不算配对 ⇒ 仍被咬'],
    ]
    let iBad = 0
    for (const [sample, why] of I_EXEMPT_SAMPLES) {
      const n = scan(sample).length
      if (n !== 0) {
        iBad++
        bad(`I 豁免样本**被咬**：${why} —— 期望 0 处命中，实测 ${n} 处`
          + '\n      ⇒ "形状上可排除"的写法却仍被当成残留 ⇒ 文档一旦引用这个形态就被自己打挂'
          + '\n      ⇒ 这正是 **E-125**（第 49 轮真实文档引爆）要治的病')
      }
    }
    for (const [sample, why] of I_BITE_SAMPLES) {
      const n = scan(sample).length
      if (n === 0) {
        iBad++
        bad(`I 对照样本**没被咬**：${why} —— 期望 ≥1 处命中，实测 0 处`
          + '\n      ⇒ 豁免被写**过宽**，把**真残留**也放过了 ⇒ 断言 I **失效**'
          + '\n      ⇒ ⚠ 这不是"放宽"，是**判据改哑**：裸写标记会静默留在正本里而无人可见'
          + '\n      ⇒ 修法：豁免只能加在"**形状可排除**"的一侧（围栏内 / 行内代码段内），'
          + '**裸写的标记必须照旧被判**')
      }
    }
    if (iBad === 0) {
      ok(`I ✓ 自带样本：${I_EXEMPT_SAMPLES.length} 个"不该被咬"的样本**全部未**被咬，`
        + `${I_BITE_SAMPLES.length} 个"该咬"的对照样本**全部照旧被咬**`
        + ' ⇒ 豁免在起作用、且没有把裸写也放过（自带样本，不依赖四份正本内容）')
    }
  }
}

// ── 输出 ────────────────────────────────────────────────────────────────
console.log('`.gitignore` 一致性核对 · dsh-hob')
console.log('约定归属地:', README)
console.log('')
for (const n of note) console.log('  ✓', n)
console.log('')
if (fail.length === 0) {
  console.log(`判定：PASS —— ${mustTrack.length} 项必须入库、${mustExclude.length} 项必须排除，全部符合 README §1。`)
  process.exit(0)
} else {
  console.log('判定：FAIL')
  for (const f of fail) console.log('  ✗', f)
  process.exit(1)
}
