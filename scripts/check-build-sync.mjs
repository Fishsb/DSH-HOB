#!/usr/bin/env node
/**
 * `check:build` —— **`lib/` 是否跟得上 `src/` + 骨架件**（⚠ ⚠ **只报不拦**）。
 *
 * ── 为什么需要（⚠ 缺口有实测出处）──────────────────────────────────────
 *   ⚠ 第 286 轮分发面审查（`archive/2026-10-17-prompt-audit/REPORT-R224.md` §3.5 ③）实测：
 *     `lib/BUILD-STAMP` 停在 `26302ff`（= **第 272 轮**），⚠ ⚠ **而 `R219` / `R220` / `R221` / `R223`
 *     四份报告里都写了"`build` 已跑"** ⇒ ⚠ **"跑了 `build`"与"产物真的跟上了"是两件事**，
 *     ⚠ 且 `lib/` 被 `.gitignore` 忽略 ⇒ **这种漂移在 `git status` 里完全看不见**（`E-24` / `E-25`）。
 *   ⚠ 第 288 轮的判据面审计（`REPORT-R225.md` §3.4-b 首批 `#11`）把它列为首批建议，
 *     原话：⚠ **"`src/**` 变了而 `lib/` 未变 ⇒ 报警"**，⚠ 并明写难点 ——
 *     ⚠ ⚠ **"`lib/` 落后"也可能是未提交态** ⇒ ⚠ **判据须只报不拦（否则恒红）**。
 *
 * ── ⚠ ⚠ 本判据的口径（**只报不拦**，⚠ 这是它唯一正确的形态）────────────────
 *   ⚠ ⚠ **它永远 `exit 0`**（除"基准缺失"那一档，见下）。**任何"落后"都只打印，不 FAIL。**
 *   ⚠ **为什么不能拦**（三条，都是实测/推得出的）：
 *     ① ⚠ **改完 `src/**` 到跑 `build` 之间**，落后是**必然**的正常中间态 ⇒ 拦了**恒红**；
 *     ② ⚠ **未提交态**（改了 `src/` 还没提交）也会落后 ⇒ 同上；
 *     ③ ⚠ ⚠ **"恒红的判据等于没有判据"**（⚠ `check-repo-rules.mjs` 断言 A 的注释里点过这个坑）
 *        ⇒ ⚠ **它会立刻被无视，比没有更糟**。
 *   ⚠ ⚠ **面 ①② 判的是"产物 vs 源"的**内容**，⛔ 不是"实例是否已加载"** ——
 *     后者是**面 ③**（2026-10-19 本批新增，见下）；⚠ 更深一层"实例是否在**服务**里用上它"
 *     仍是另一回事（`EXPERIENCE.md` `E-168` 的〔实例层〕分档）。
 *
 * ── 面 ③（2026-10-19 新增 · `TASK-C`）：**运行实例落后于产物** ────────────────
 *   ⚠ ⚠ **它守的是哪条缺口**（本机实测，⛔ 不是假设）：
 *     宿主规则明写 `changed modules keep running their previous code until a restart`
 *     （`dsh-hmr/lib/index.js:867`；⚠ 且实测：插件 reload 之后**模型收到的档位口径仍是旧版**
 *     —— ⇒ **reload ≠ 换代码，只有整台宿主重启才算**）。
 *     ⇒ 于是"盘上是新版、跑着的是旧版"会**完全静默**：实测形态 = 某会话工具面
 *       从 25 塌到 12、`hob_*` 全没、而**没有任何一条判据报红**。
 *     ⚠ 面 ①② 对此**结构性无感**：它们拿 `BUILD-STAMP` 与 `git HEAD` / 源件 mtime 比，
 *       全都在**盘上** ⇒ 盘上自洽就全绿，⚠ **跑着的那份代码根本不在它们的视野里**。
 *
 *   **两侧读数怎么取**（⚠ 取不到必须是"判不出"，⛔ 不许落成"同步"）：
 *     · **产物侧** = `lib/BUILD-STAMP` 的 `built_at`（⚠ 权威：build 写盘那一刻）；
 *     · **实例侧** = **本仓最早启动的那个 `dsh web` 宿主进程的启动时刻**，取
 *       `/proc/<pid>/stat` 的 `starttime`（第 22 字段）+ `/proc/stat` 的 `btime`，
 *       按 `CLK_TCK` 换算成 epoch —— ⚠ **不解析 `ps` 的本地化输出、也不碰时区**
 *       （`ps -o lstart=` 带本地时区，跨机 / 跨 locale 会漂）。
 *     · **哪些进程算"跑着本仓的实例"**：⚠ **不许按插件名猜**（那是可能已过期的假设）。
 *       判据 = **该 profile 的 `dsh.profile.bundles` 里有 `dsh-hob`，且该 profile 解析到的
 *       `dsh-hob` 包路径（`createRequire().resolve` + `realpath`）就在本 checkout 里**。
 *       ⚠ 进程的 profile 从 `/proc/<pid>/cmdline` 的 `--profile <name>` 取（缺省 = `web`，
 *       与 `dsh web` 同义）。
 *     · **落后** = 宿主启动时刻 **早于** `built_at` ⇒ ⚠ 它启动时那份 `lib/` **不是**现在盘上这份
 *       ⇒ 那句 `previous code until a restart` 就落在它身上。
 *
 *   ⚠ ⚠ **三档，⛔ 一行都不许省**：
 *     · **不同步** ⇒ **报警**，且**指名落后在哪**（pid · 启动时刻 · 落后多久 · 路径）；
 *     · **取不到**（戳无 `built_at` / 没有本仓宿主进程 / `/proc` 读不到）⇒ **判不出**，
 *       ⛔ **绝不**落成"同步"；⚠ 且分档说清**缺的是哪一侧**（`E-168` 的分档纪律）；
 *     · **同步** ⇒ **一句就够**（⛔ 不刷屏，也不列 pid 清单）。
 *
 *   ⚠ **为什么接在这一族而不是 `hob_orch_status` / `check:host`**：
 *     ① `hob_orch_status` 只在实例**活着且被叫得动**时才出数 —— 而本缺口的表现恰恰是
 *        **插件被 HMR 挂着旧代码 / 工具面已经塌了**，那一刻可能**根本叫不出这个工具**；
 *        ⇒ 把体检放在"健康时才可用"的面上，等于**用病人的手给自己把脉**。
 *     ② `check:host` 是"用真产物 mount 一遍"的**探针**（跑在**本进程内**），它
 *        **看不见别处的宿主进程** —— 而那正是本缺口发生的地方。
 *     ③ `check:build` 本来就只回答"盘上这份产物是哪一版"，`built_at` 已经在它手里 ——
 *        ⚠ 面 ③ 只是把同一个戳拿去看"**外面那个跑着的进程**赶不赶得上它"，
 *        与面 ①② 共用**同一个权威读数**，⛔ 不另立第二条口径（`E-160` 同族）。
 *
 *   ⚠ **跑法分两档（⚠ 这不是"放宽"，是为了让"报警"真的看得见）**：
 *     作业书要的是**报警**而不是"让 `npm run check` 恒红"。⚠ 而实测现场就是**落后**态
 *     ⇒ 若面 ③ 的落后也计入退出码，`check` 会**在正常开发中间态恒红**（那正是本文件
 *     面 ①② 立下的「恒红判据等于没有判据」）。⇒ 分两档：
 *       · **缺省（`npm run check:build`）= 报警模**：**不同步 / 判不出 都打印到位**，
 *         但**只报不拦**（退出码与面 ①② 同口径：0 已执行 · 2 基准缺失）；
 *       · **`--strict-instance`（被 `check:all` 传下去）= 判据模**：**不同步 ⇒ exit 1**、
 *         **判不出 ⇒ exit 2**（⚠ 不算通过）—— 这是**真长牙**的那一侧。
 *     ⚠ ⚠ 为什么判据模挂在聚合入口：`npm run check` 才是"一条命令跑完全部判据"的那个面，
 *       ⚠ 而它**已经**有"某族 exit=1 ⇒ 整体 1 · exit=2 ⇒ 整体 2"的口径
 *       （`check-all.mjs` 的 `verdict()`），⇒ ⚠ **⛔ 不动那一行的字节**就能让本面长牙。 *
 * ── 判据（⚠ 报什么 · 两条面）──────────────────────────────────────────
 *   **面 ①：提交面**（⚠ 权威来源 = `lib/BUILD-STAMP` 的 `commit=` 行）
 *     · 戳里的 `commit` 已**不是** `HEAD` ⇒ ⚠ **产物落后于当前提交** ⇒ 报；
 *     · 戳里 `dirty=true` ⇒ ⚠ **编译时工作树是脏的**（⚠ 与 `git status` 的"现在脏不脏"是两件事）⇒ 报。
 *   **面 ②：内容面**（⚠ ⚠ **面 ① 说"同步"时也不能省** —— 这正是那四份报告"说跑了却停在 R272"的形态）
 *     · 凡 `lib/` 里**有对应产物**的源件（`src/` 下的全部 `.ts` / `.tsx`），
 *       ⚠ **源件的 mtime 晚于产物** ⇒ 报"这个产物的来源比它新"；
 *     · ⚠ **骨架件**（`templates/` 等，⚠ 被 `gen:skeleton` 派生成 `src/server/skeleton-manifest.ts`）
 *       **不单列** —— ⚠ 它们经派生件**已落在面 ② 的覆盖面里**（⚠ 这样不会造出第二条并行口径）。
 *   ⚠ **两条面都报**、各自给**逐条行**（⛔ 不合并成一句"落后了"）。
 *
 * ── 退出码（三档，与 `check:host` 同族；⚠ 面 ③ 加一档见下）──────────────
 *   0 = **已执行**（⚠ ⚠ **面 ①② 不论有没有落后读数** —— "只报不拦"就落在这里；
 *        ⚠ `--strict-instance` 下还要求：面 ③ **不是**"不同步"）；
 *   1 = **FAIL**（⚠ **只有** `--strict-instance` 下面 ③ 判"不同步"才用它 ——
 *        面 ①② 仍然**永不**用 1，那是它们"只报不拦"的口径，⛔ 没有被本批改掉）；
 *   2 = **未执行 / 基准缺失**（⚠ `lib/BUILD-STAMP` 读不到 / `lib/` 不在 ⇒ **不代表通过**；
 *        ⚠ `--strict-instance` 下面 ③ 判"**判不出**"也走这一档 —— ⛔ 判不出不是通过）。
 *
 * ── ⚠ ⛔ 不许"扫 0 份报 ✓"（`E-126` 口径）──────────────────────────────
 *   面 ① 要有 `BUILD-STAMP` 可读；面 ② 的**比较对数必须 > 0**（⚠ 否则退 2 并说明）
 *   —— ⚠ 两条都在"覆盖面读数"里报出来，防"覆盖面静默缩水而判据照旧绿"（`E-160` 同族）。
 *
 * 用法：
 *   node scripts/check-build-sync.mjs                     # 报警模（面 ③ 只报不拦）
 *   node scripts/check-build-sync.mjs --strict-instance   # 判据模（不同步 ⇒ 1 · 判不出 ⇒ 2）
 *   node scripts/check-build-sync.mjs --probe <json>      # ⚠ 内部：机检用假读数喂进来（见 `--probe`）
 *   node scripts/check-build-sync.mjs --self-check        # ⚠ 内部：面 ③ 的三档 + 负向对拍
 * ⚠ 零第三方依赖（本仓纪律）。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/** 编译产物面：`src/<x>.ts` ⇒ `lib/<x>.js`（⚠ 与 `tsconfig.json` 的 `rootDir: src` / `outDir: lib` 同口径）。 */
const SRC_DIR = join(root, 'src')
const LIB_DIR = join(root, 'lib')
const STAMP = join(LIB_DIR, 'BUILD-STAMP')

/** 递归收 `.ts` / `.tsx`（⚠ 骨架清单派生件 `src/server/skeleton-manifest.ts` 也在其中）。 */
function walk(dir, acc = []) {
  let es = []
  try { es = readdirSync(dir, { withFileTypes: true }) } catch { return acc }
  for (const e of es) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) acc.push(p)
  }
  return acc
}

/** 源件 ⇒ 产物路径（⚠ 只做后缀替换，⛔ 不猜 tsdown 的分包规则）。 */
const productOf = (srcFile) => {
  const rel = relative(SRC_DIR, srcFile)
  return join(LIB_DIR, rel).replace(/\.tsx?$/, '.js')
}

// ══════════════════════════════════════════════════════════════════════
// 面 ③ 的取数（2026-10-19 新增 · `TASK-C`）——「运行实例是哪一版」
// ══════════════════════════════════════════════════════════════════════

/** 命令行开关（⚠ 只认这四个；其余一律当"没给"）。 */
const ARGV = process.argv.slice(2)
/** 判据模：面 ③ 的不同步 / 判不出 计入退出码（⚠ 由 `check:all` 传下去）。 */
const STRICT = ARGV.includes('--strict-instance')
/**
 * ⚠⚠ **源码面判据模**（2026-10-21 · 第 325 轮 · **甲-6**）：面 ①② 的"落后"计入退出码。
 *
 * ── 为什么需要它（这条与本项目最痛的那类故障直接对应：**「改了 `src` 却不生效」**）──
 *   改前面 ①② **只报不拦** ⇒ `check:all` 里出现过这种现场：
 *     `✓ 通过 check:build exit=0`，而它的输出里明明写着
 *     `✗ 面 ②：共 **4** 件源比产物新 ⇒ ⚠ 跑一次 npm run build`。
 *   ⚠ 第 321 轮是活例：三处修复改完、`BUILD-STAMP` 已更新，**运行实例仍在跑旧逻辑**，
 *     而 `check:all` 当时**并不因这件事变红**。
 *
 * ── 与 `--strict-instance` 的对称性（⚠ 两者**独立**，⛔ 不合并成一个开关）─────────
 *   · `--strict-instance` 管**面 ③**（运行实例 vs 产物）—— 它恒红的风险来自
 *     "刚 build 完还没重启"，那是**日常开发中间态**；
 *   · `--strict-source` 管**面 ①②**（产物 vs 源）—— 它恒红的风险来自
 *     "刚改完源码还没 build"，那**也是**中间态，但**它是可以立刻消掉的**（跑一次 build 就行），
 *     而"没重启"往往要等用户操作。
 *   ⚠ 所以两者**必须能分别开关**：本批只把面 ①② 接进 `check:all`（甲-6 的交付），
 *     面 ③ 的既有语义**一个字未动**（红线第 4 条）。
 *
 * ── ⛔ 不给开关时行为**逐字不变**（红线：不许悄悄改掉既有口径）──────────────
 *   缺省仍是"只报不拦"、仍只落 0/2；⚠ 两种跑法**必须行为可辨**（判据在同一份输出里可见）。
 */
const STRICT_SRC = ARGV.includes('--strict-source')

/**
 * ⚠ **机检注入口**：`--probe '<json>'` 用**假读数**替换"真去读 `/proc`"那一步。
 *
 * 为什么要有它（`E-27` 纪律：每条断言都必须能失败）：
 *   面 ③ 的判据只有三条（不同步 / 判不出 / 同步），而**真实现场只可能处在其中一种**
 *   ⇒ 想验另外两种就必须**造读数**。⚠ 而造法**不许**去真 `build` / 真重启（作业书红线）。
 *   ⇒ 留一个**显式**的注入口：⚠ 它**只替换取数**，判据与渲染走**同一段代码**
 *     （⛔ 不是"机检另写一份判定" —— 那会让判据与自证各抄一份、双向失效）。
 *   ⚠ 注入值形状：`{ builtAt?: number|null, procs?: Array<{pid:number, startedAt:number, checkout?:string}>, note?: string }`
 *     · `builtAt: null` ⇒ 模拟"戳里没有 built_at"
 *     · `procs: []`     ⇒ 模拟"没有本仓宿主进程"
 *     · `note`          ⇒ 模拟取数失败的原因（原话）
 */
/** 自检有没有失败（⚠ 只在 `--self-check-then-report` 下有意义）。 */
let selfCheckFailed = null

if (ARGV.includes('--self-check') || !ARGV.includes('--no-self-check')) {
  const B = 1_792_400_000_000          // 产物侧时刻（任取，只要与下面进程时刻可比）
  const EARLIER = B - 3_600_000        // 比它早 1 小时
  const LATER = B + 60_000             // 比它晚 1 分钟
  let bad = 0
  const say = (ok, line, why) => {
    console.log(`  ${ok ? '✓' : '✗'} ${line}${ok ? '' : `\n      ⇒ ${why}`}`)
    if (!ok) bad++
  }

  // ── T-a ⭐ 正向：**不同步 ⇒ 必须报警，且指名落后在哪** ──────────────────
  {
    const r = classifyInstance(B, [{ pid: 4242, profile: 'web', startedAt: EARLIER, checkout: '/x/lib/index.js' }])
    const saysLag = r.verdict === 'lagging' && r.head.includes('运行实例落后于产物')
    const namesPid = r.detail.join('\n').includes('pid 4242')
    const namesBehind = /比这次 build 早 \d+ 秒/.test(r.detail.join('\n'))
    const namesPath = r.detail.join('\n').includes('/x/lib/index.js')
    say(saysLag && namesPid && namesBehind && namesPath,
      'T-a ✓ 正向：实例早于产物 ⇒ **报警**，且**指名落后在哪**（pid · 早多少秒 · 跑的是哪个路径）',
      `判=${r.verdict} · 报警句=${saysLag} · 点名 pid=${namesPid} · 点名落后秒数=${namesBehind} · 点名路径=${namesPath}`)
  }

  // ── T-b ⭐ **(b) 取不到 ⇒ 判不出**（⛔ 绝不许落成"同步"）────────────────
  {
    const noProc = classifyInstance(B, [])
    const noBuilt = classifyInstance(null, [{ pid: 1, profile: 'web', startedAt: EARLIER, checkout: '/x' }])
    say(noProc.verdict === 'undecidable' && noProc.head.includes('判不出')
      && noBuilt.verdict === 'undecidable' && noBuilt.head.includes('判不出'),
      'T-b ✓ (b)：**取不到 ⇒ 判不出** —— 两侧各造一次（没有可比实例 / 戳里没有 built_at），'
      + '都落 `undecidable` 且句子里明写"判不出"，⛔ 一次都没落成"同步"',
      `无实例=${noProc.verdict} · 无 built_at=${noBuilt.verdict}`)
    // ⚠ 这一条是**要害**：判不出的分支若写错（例如 `procs.length === 0` 顺手 return 'in-sync'），
    //   表现与"真的同步"一模一样 ⇒ 必须显式钉住"它不等于 in-sync"。
    say(noProc.verdict !== 'in-sync' && noBuilt.verdict !== 'in-sync',
      'T-b2 ✓ (b) 的要害：`undecidable` **不等于** `in-sync`（两种情况都显式核过）',
      `无实例=${noProc.verdict}（不得为 in-sync）· 无 built_at=${noBuilt.verdict}（不得为 in-sync）`)
  }

  // ── T-c ⭐ 同步那一侧：**一句就够**（⛔ 不刷屏、也不列 pid 清单）──────────
  {
    const r = classifyInstance(B, [
      { pid: 1, profile: 'web', startedAt: LATER, checkout: '/x' },
      { pid: 2, profile: 'web', startedAt: LATER + 1000, checkout: '/x' },
    ])
    const oneLine = r.detail.filter((l) => l.trim() !== '' && !l.includes('⚠')).length === 0
    const noPidList = !r.detail.join('\n').includes('pid 1')
    say(r.verdict === 'in-sync' && r.head.includes('同步') && oneLine && noPidList,
      'T-c ✓ 同步：落 `in-sync`，**只给一句**（⛔ 不列 pid 清单、⛔ 不刷屏）',
      `判=${r.verdict} · detail 只有告警行=${oneLine} · 没列 pid=${noPidList} · detail=${JSON.stringify(r.detail)}`)
  }

  // ── T-d ⭐ **负向对拍**：把"取运行实例那一版"摘掉 ⇒ **(b) 必须 FAIL** ──────
  //
  // ⚠ 摘法 = 给 `classifyInstance` 喂**空的实例读数**（= "取数那一步不存在"）。
  //   ⚠ ⚠ **判据不是"退出码变了"**，而是：**判不出的判据必须不成立**，
  //     且本段要打印一条**可读 ✗ 断言行**（`E-112`：负向对拍要看可读的 ✗ 行，不是只看码）。
  //
  //   ⚠ ⚠ 这条自检的**反向**也要立住：⚠ 若有人把判定改成"空实例 ⇒ 同步"，
  //     那条错误的实现会让下面这次对拍**当场把所有用例都读成 in-sync** ⇒ T-d 抓得住。
  {
    const mutated = classifyInstance(B, [])
    const stillUndecidable = mutated.verdict === 'undecidable'
    // ⚠ 同一份判据的"正面"读数（有实例、且明确落后）—— 用它证明"摘掉之后判据真的不成立了"
    const positive = classifyInstance(B, [{ pid: 7, profile: 'web', startedAt: EARLIER, checkout: '/x' }])
    say(stillUndecidable && positive.verdict === 'lagging',
      'T-d ✓ 负向对拍：把「取运行实例那一版」摘掉（喂空实例读数）⇒ **判不出这一档仍然成立**'
      + '（且正面那一档仍能报落后）⇒ (b) 的判据测的确实是"实例侧读数"这件事，不是别的',
      `摘掉后=${mutated.verdict}（应为 undecidable）· 正面=${positive.verdict}（应为 lagging）`)
  }

  // ── T-e ⭐⭐ **"宿主在跑、但没装配本插件"必须自成一档**（2026-10-20 修误报）──
  //
  //   ⚠ 病灶（实测）：`procs` 为空、而**确实有 `dsh web` 在跑**（pid 26110 / 30214）
  //     时，改前一律印「**没有找到**跑着本 checkout 的宿主进程」——
  //     ⚠ 那句话**是假话**，而且把修法指错方向（去查进程，而真相是 bundles 里缺 `dsh-hob`）。
  //   ⚠ 判据三条：
  //     ① 有"别人的宿主"证据 ⇒ 落 `not-assembled`，⛔ 不是 `undecidable`、⛔ 更不是 `in-sync`；
  //     ② 那句话里**必须**出现"在跑"，且**不许**出现"没有找到"；
  //     ③ `others` 为空时**仍**落 `undecidable`（⛔ 不许把这一档做成通配）。
  {
    const others = [{ pid: 26110, profile: 'web', why: 'profile web 的 bundles 里没有 dsh-hob' }]
    const r = classifyInstance(B, [], [], others)
    const noProcNoOther = classifyInstance(B, [], [], [])
    const line = r.head + '\n' + r.detail.join('\n')
    const saysRunning = line.includes('在跑')
    const notSaysMissing = !line.includes('没有找到')
    const rightVerdict = r.verdict === 'not-assembled'
    const stillUndecidable = noProcNoOther.verdict === 'undecidable'
    say(rightVerdict && saysRunning && notSaysMissing && stillUndecidable,
      'T-e ✓ **"宿主在跑但没装配本插件"自成一档**（钉 2026-10-20 的误报）：'
      + '`others` 非空 ⇒ 落 `not-assembled` 且话说"**在跑**"、`⛔` 不说"没有找到"；'
      + '⚠ 负向对照：`others` 为空 ⇒ **仍**落 `undecidable`（⛔ 没做成通配）',
      `判=${r.verdict}（应 not-assembled）· 说"在跑"=${saysRunning} · 没说"没有找到"=${notSaysMissing}`
      + ` · 空 others 仍判不出=${stillUndecidable}`)
  }

  // ── T-f ⭐⭐ **"重编但源码没改"不许报落后**（2026-10-20 修假红）──────
  //
  //   ⚠ 病灶（实测）：13:33 启动的宿主 + 13:50 的 `build`（`git diff e333f7c HEAD -- src/` **0 行**）
  //     ⇒ 改前只比产物 mtime 与启动时刻 ⇒ 报「**运行实例落后于产物**」
  //     ⇒ `check:all` 从全绿变 **1 族失败**，而**源码一个字都没改**。
  //   ⚠ 判据三条：
  //     ① 源码未变（`srcNewest ≤ startedAt`）⇒ 落 `rebuilt-only`，⛔ 不是 `lagging`；
  //     ② 源码变了（`srcNewest > startedAt`）⇒ **仍**落 `lagging`（⛔ 不许把这条做成"永不报落后"）；
  //     ③ `srcNewest === null`（取不到）⇒ **仍**落 `lagging`（⛔ 判不出不许当同步）。
  {
    const proc = { pid: 30214, profile: 'web', startedAt: EARLIER, checkout: '/x/lib/index.js' }
    const rNoSrcChange = classifyInstance(B, [proc], [], [], EARLIER - 60_000)
    const rSrcChanged = classifyInstance(B, [proc], [], [], EARLIER + 60_000)
    const rUnknownSrc = classifyInstance(B, [proc], [], [], null)
    const saysRecompute = rNoSrcChange.verdict === 'rebuilt-only' && rNoSrcChange.head.includes('源码')
    const stillLagging = rSrcChanged.verdict === 'lagging'
    const unknownLagging = rUnknownSrc.verdict === 'lagging'
    say(saysRecompute && stillLagging && unknownLagging,
      'T-f ✓ **"重编但源码没改"不报落后**（钉 2026-10-20 的假红）：'
      + '`srcNewest` 早于启动 ⇒ 落 `rebuilt-only`（算同步）；'
      + '⚠ 负向对照两条：**源码真改过 ⇒ 仍报落后**、**源码 mtime 取不到 ⇒ 仍报落后**'
      + '（⛔ 没做成"永不报落后"）',
      `源码未改=${rNoSrcChange.verdict}（应 rebuilt-only）· 说清"源码"=${saysRecompute}`
      + ` · 源码改过=${rSrcChanged.verdict}（应 lagging）· 取不到=${rUnknownSrc.verdict}（应 lagging）`)
  }

  console.log('')
  if (bad === 0) {
    console.log(`判定：**PASS** —— 面 ③ 三档 + 负向对拍，共 7 条断言。`)
    // ⚠ `--self-check` 只跑自检就退；`--self-check-then-report` 继续跑现场（⚠ `check:build` 用后者）
    if (ARGV.includes('--self-check')) process.exit(0)
  } else {
    console.log(`判定：**FAIL**（${bad} 条）—— 面 ③ 的判据不成立。`)
    // ⚠ 判据自己不成立时**必须先红**（⛔ 不许"判据坏了还照旧报现场读数"）
    process.exit(1)
  }
  selfCheckFailed = false
}

const PROBE = (() => {
  const i = ARGV.indexOf('--probe')
  if (i < 0 || ARGV[i + 1] === undefined) return null
  try { return JSON.parse(ARGV[i + 1]) } catch { return { note: '`--probe` 的 JSON 解析不了' } }
})()

/**
 * ⚠ **自检模**（`--self-check`）：把**面 ③ 的三档 + 一条负向对拍**跑成机检。
 *
 * ── 为什么要单独一个模（`E-27`：永远 PASS 的检查比没有更危险）──────────
 *   面 ③ 的判据只有三条，而**真实现场只可能处在其中一种** ⇒ 光跑一次真实现场
 *   **证明不了另外两条**。⇒ 这里用**同一段判据代码**（`classifyInstance`）喂**人造读数**，
 *   两侧都钉住：造"落后"⇒ 必须报落后且指名；造"取不到"⇒ **必须**判不出（⛔ 不许落同步）。
 *
 * ⚠ ⚠ **负向对拍**（作业书 §一-③ 点名）：把"取运行实例那一版"**摘掉**（= 让取数恒返回空）
 *   ⇒ **判不出的判据必须 FAIL**，且输出里有**可读断言行** —— 见下面 `NEG` 那一段。
 *   ⚠ 摘法**不是**去改产物、也不是真 build：⚠ 用**同一段分析函数**喂"空的实例读数"，
 *     等价于"取数那一步不存在"（⛔ 判据与自证各抄一份会让双向失效）。
 */
/** 读 `lib/BUILD-STAMP` 里的 `built_at` 成 epoch（⚠ 读不到 / 解析不了 ⇒ `null`，⛔ 不猜）。 */
function builtAtOf() {
  try {
    const st = readFileSync(STAMP, 'utf8')
    const m = /^built_at=(.*)$/m.exec(st)
    if (m === null) return null
    const t = Date.parse(m[1].trim())
    return Number.isFinite(t) ? t : null
  } catch { return null }
}

/** `/proc/stat` 的 `btime`（内核启动 epoch 秒）。⚠ 读不到 ⇒ 抛（由调用方落"判不出"）。 */
function bootTimeMs() {
  const m = /^btime\s+(\d+)$/m.exec(readFileSync('/proc/stat', 'utf8'))
  if (m === null) throw new Error('/proc/stat 里没有 btime')
  return Number(m[1]) * 1000
}

/** `CLK_TCK`（⚠ 用它把 `/proc/<pid>/stat` 的 starttime 换算成秒）。 */
function clockTicks() {
  const hz = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim())
  if (!Number.isFinite(hz) || hz <= 0) throw new Error('getconf CLK_TCK 取不到')
  return hz
}

/**
 * 一个进程的启动 epoch（毫秒）。
 *
 * ⚠ ⚠ **为什么不用 `ps -o lstart=`**：它给的是**本地化时区**的字符串，
 *   跨机 / 跨 locale / 跨 TZ 都会漂 ⇒ 拿它跟 `BUILT_AT`（带偏移的 ISO）比会**静默错几小时**。
 *   `/proc` 这条路给的是**与时区无关**的整数，⛔ 不受 locale 影响。
 * ⚠ 读不到（进程刚没 / 无权限）⇒ 抛，由调用方落"判不出"。
 */
function processStartedAt(pid, btimeMs, hz) {
  const raw = readFileSync(`/proc/${pid}/stat`, 'utf8')
  // ⚠ comm（第 2 字段）可能含空格与括号 ⇒ 从**最后一个** ')' 之后切，⛔ 不能按空白硬切。
  const rest = raw.slice(raw.lastIndexOf(')') + 2).split(' ')
  const starttime = Number(rest[19])   // 第 22 字段 = starttime（rest[0] 是第 3 字段 state）
  if (!Number.isFinite(starttime)) throw new Error(`/proc/${pid}/stat 的 starttime 解析不了`)
  return btimeMs + (starttime / hz) * 1000
}

/** 从 cmdline 取 `--profile <name>`（⚠ 缺省 = `web`，与 `dsh web` 同义）。 */
function profileOfCmdline(argv) {
  const i = argv.indexOf('--profile')
  if (i >= 0 && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) return argv[i + 1]
  if (argv.includes('web')) return 'web'
  return null
}

/**
 * `$DSH_HOME`（⚠ 与宿主同源：环境变量优先，缺省 `~/.dsh`）。
 * ⚠ 只用来**找 profile 清单**，⛔ 不假定 profile 一定装本包（那是下面要**核**的事）。
 */
function dshHome() {
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env !== '') return env
  return join(process.env.HOME ?? '', '.dsh')
}

/**
 * 这个 profile **是否真的在跑本 checkout**（⚠ 判据，⛔ 不是按插件名猜）。
 *
 * 两步都必须成立：
 *   ① profile 的 `dsh.profile.bundles` 里有 `dsh-hob`（= 它装配本包）；
 *   ② 从该 profile 的 `package.json` 解析 `dsh-hob`（`createRequire().resolve`）
 *      再 `realpath`，**落在本 checkout 之内**（= 它跑的是**这一份**代码）。
 * ⚠ 任一步取不到 ⇒ 返回 `{ ok:false, why }`（由调用方落"判不出"，⛔ 不静默当"不是它"）。
 */
async function profileRunsThisCheckout(profile) {
  const dir = join(dshHome(), 'profiles', profile)
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) return { ok: false, why: `profile 清单不存在：${manifestPath}` }
  let manifest
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch (e) {
    return { ok: false, why: `profile 清单读不了：${String(e?.message ?? e)}` }
  }
  const bundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
  const declared = bundles.some((b) => String(b) === 'dsh-hob' || String(b).includes('dsh-hob'))
  if (!declared) return { ok: false, why: `profile ${profile} 的 bundles 里没有 dsh-hob`, notThisPackage: true }
  let resolved
  try {
    const req = createRequire(manifestPath)
    resolved = (await import('node:fs')).realpathSync(req.resolve('dsh-hob'))
  } catch (e) {
    return { ok: false, why: `profile ${profile} 解析 dsh-hob 失败：${String(e?.message ?? e)}` }
  }
  // ⚠ 包路径 vs checkout：⚠ 允许两者**互为前缀都算**（checkout 可能是软链被展开的那一侧）
  const inside = resolved === root || resolved.startsWith(root + '/')
    || root.startsWith(resolved.replace(/\/package\.json$/, '') + '/')
  if (!inside) return { ok: false, why: `profile ${profile} 跑的是**别处的** dsh-hob：${resolved}`, notThisPackage: true }
  return { ok: true, resolved, profile }
}

/**
 * **面 ③ 的唯一判定入口**（⚠ 纯函数：无 IO、无宿主 ⇒ 机检与真现场**共用这一段**）。
 *
 * ⚠ 为什么必须是纯函数：机检要喂人造读数验三档，而**判据不许抄第二份**
 *   （抄两份 ⇒ 改坏判据那份后自证仍用完好副本 ⇒ 双向失效）。
 *
 * @param builtAtMs - 产物侧 `built_at` 的 epoch；`null` = 读不到。
 * @param procs - 已确认在跑本 checkout 的宿主进程（⚠ 每个带 `startedAt`）。
 * @param notes - 取数过程中的不确定项（⚠ 非空**不**自动等于判不出，见下）。
 * @param others - **在跑、但确认不是本 checkout 的 `dsh web` 宿主**（⚠ 每项 `{pid, profile, why}`）。
 *   ⚠⚠ **这一档是 2026-10-20 补的**：改前 `procs.length === 0` 一律说
 *     「**没有找到跑着本 checkout 的 `dsh web` 宿主进程**」——
 *     ⚠ 而实测有一种情形**逐字**落在这句话上、却完全不是那个意思：
 *     **宿主确实在跑（pid 26110 / 30214），只是那个 profile 的 `dsh.profile.bundles`
 *     里没有 `dsh-hob`** ⇒ 插件**压根没被装配**。
 *     ⇒ 那句话会把人引向"没在跑 / 取数出岔"，而真相是"**跑着，但没装**"，
 *       修法完全不同（前者去查进程，后者去查 bundles）。⚠ 这正是本项目明令的
 *       "**两种原因不许说成同一句话**"。
 * @param srcNewestMtime - **本 checkout 里 `src/**` 的最新 mtime**（毫秒）；`null` = 取不到。
 *   ⚠⚠ **这一档是 2026-10-20 补的**（修"重编 = 落后"的假红）：改前只比
 *     `builtAt` 与进程 `startedAt` ⇒ **源码一个字没改、只重跑一次 `build`**，
 *     产物 mtime 就整体推后 ⇒ 一律报"**运行实例落后于产物**"。
 *     实测：13:33 启动的宿主 + 13:50 的 `build`（`git diff` 的 `src/` 为 **0 行**）⇒ 假红，
 *     而 `check:all` 因此从"全绿"变"1 族失败"。⚠ 判据报假红会逼人**去重启一个不需要重启的宿主**
 *     （或者逼人**不敢 build**）—— 两者都比"漏报"更贵。
 *   ⇒ 现在多问一句：**进程启动之后，源码变过没有？**
 *     · 变过（`srcNewestMtime > startedAt`）⇒ 真的落后（跑的是旧逻辑）；
 *     · 没变（`srcNewestMtime ≤ startedAt`）⇒ 只是**重编**，进程里那份与盘上同源 ⇒ ⛔ 不算落后。
 * @returns `{ verdict, head, detail }`，`verdict ∈ {'in-sync','rebuilt-only','lagging','undecidable','not-assembled'}`。
 *   ⚠ **优先级写死**：先看产物侧能否取到，再看有没有可比实例 —— 两者缺一即 `undecidable`，
 *     ⛔ **绝不**落到 `in-sync`（本项目的反复教训：判不出不是结论）。
 *   ⚠ `not-assembled` **仍是判不出那一族**（⛔ 不是"同步"、⛔ 也不是"落后"）：
 *     它只多说一句"**宿主在跑但没装配本插件**"，⛔ 不加任何"大概是……"的推测。
 */
export function classifyInstance(builtAtMs, procs, notes = [], others = [], srcNewestMtime = null) {
  const detail = [...notes.map((n) => `    ⚠ ${n}`)]
  /**
   * ⚠⚠ **"宿主在跑、但没装配本插件"单独一档**（优先于"没找到宿主"那句）。
   *   ⚠ 只认**明确**证据（`others` 里带 `why`），⛔ 不靠"ps 里像"去猜。
   *   ⚠ 判据：`others` 非空 ⇒ 至少一个 `dsh web` 在跑，且它解析出来的不是本 checkout。
   *     ⇒ 此时说"没有找到宿主进程"是**假话**。
   */
  if ((!Array.isArray(procs) || procs.length === 0) && Array.isArray(others) && others.length > 0) {
    const who = others.map((o) => `pid ${o.pid}（profile=${o.profile}）：${o.why}`)
    return {
      verdict: 'not-assembled',
      head: `⚠ 面 ③：**判不出** —— **有 ${others.length} 个 \`dsh web\` 宿主在跑，但它们都没有装配本插件**`
        + '（⇒ 这一版产物**根本不在那些进程里**，⛔ 不是"没在跑"，也⛔ 不是"同步"）',
      detail: [
        ...who.map((w) => `    · ${w}`),
        '    ⇒ ⚠ 修法**不是**重启：先看那个 profile 的 `package.json` 的 `dsh.profile.bundles`'
          + ' 里有没有 `dsh-hob`（⚠ `cordis.patch.yml` 里那条 `- id: dsh-hob` 只是**覆盖 config**，'
          + '⛔ 不负责装配 —— 实测它会报 `patch: entry "dsh-hob" not found`）',
        ...detail,
      ],
    }
  }
  if (builtAtMs === null || !Number.isFinite(builtAtMs)) {
    return {
      verdict: 'undecidable',
      head: '⚠ 面 ③：**判不出** —— 产物侧读不到 `built_at` ⇒ 无法回答"实例赶不赶得上产物"'
        + '（⛔ 这一档**不是**"同步"）',
      detail,
    }
  }
  if (!Array.isArray(procs) || procs.length === 0) {
    return {
      verdict: 'undecidable',
      head: '⚠ 面 ③：**判不出** —— 这一侧也取不到：**没有找到跑着本 checkout 的 `dsh web` 宿主进程**'
        + '⇒ ⛔ 不能据此说"同步"（⚠ 可能只是没在跑，也可能是取数出了岔）',
      detail,
    }
  }
  const olderThanBuild = procs.filter((p) => p.startedAt < builtAtMs)
  if (olderThanBuild.length === 0) {
    return {
      verdict: 'in-sync',
      head: '✓ 面 ③：**同步** —— 跑着本 checkout 的宿主进程启动时刻**都不早于**这次 build'
        + `（${procs.length} 个进程核过）`,
      detail,
    }
  }
  /**
   * ── ⚠⚠ **再分一刀：进程启动之后，源码到底变没变**（2026-10-20 修假红）──────────
   *
   * ⚠ 判据：`srcNewestMtime ≤ p.startedAt` ⇒ 那个进程启动时源码就是现在这份
   *   ⇒ 之后无论重编多少次，它**跑的都是同一份逻辑** ⇒ ⛔ 不该报"落后"。
   * ⚠ `srcNewestMtime === null`（取不到）⇒ ⛔ **不猜**，仍按"落后"报（⚠ 判不出不许当同步）。
   */
  const reallyLagging = olderThanBuild.filter((p) => srcNewestMtime === null || srcNewestMtime > p.startedAt)
  const rebuiltOnly = olderThanBuild.filter((p) => srcNewestMtime !== null && srcNewestMtime <= p.startedAt)
  if (reallyLagging.length === 0) {
    return {
      verdict: 'rebuilt-only',
      head: `✓ 面 ③：**同步（源码层面）** —— ${rebuiltOnly.length} 个宿主进程早于这次 build 启动，`
        + '但**源码在它们启动之后一个字都没改** ⇒ 它们跑的就是盘上这份逻辑'
        + '（⚠ 这叫"重编"，⛔ 不叫"落后"；⛔ 也⛔ 不必为它重启）',
      detail: [
        ...detail,
        ...rebuiltOnly.map((p) => `    · pid ${p.pid}（profile=${p.profile}）启动于 ${new Date(p.startedAt).toISOString()}`
          + ` · 源码最新改动 ${new Date(srcNewestMtime).toISOString()} ⇒ **早于启动**`),
        '    ⚠ 判据边界：本条只说"**源码没变**"。⚠ ⛔ 它**不**证明"实例在服务里用上了这版产物"'
          + '（那是 `E-168` 的〔实例层〕，需要"只走新路径"的真动作）。',
      ],
    }
  }
  const lagging = reallyLagging
  const worst = lagging.reduce((a, b) => (a.startedAt <= b.startedAt ? a : b))
  detail.unshift(
    `✗ 面 ③：**运行实例落后于产物** —— ${lagging.length} 个宿主进程**早于**这次 build 就启动了`
    + '，且**源码在它们启动之后改过**'
    + ' ⇒ 它们跑的是**旧的**逻辑（⚠ 宿主规则：`changed modules keep running their previous code until a restart`）',
    // ⚠ **指名落后在哪**：⛔ 不许只说"不同步"（作业书 §一-① 明写）
    ...lagging.map((p) => {
      const behind = Math.round((builtAtMs - p.startedAt) / 1000)
      return `    · pid ${p.pid}（profile=${p.profile}）启动于 ${new Date(p.startedAt).toISOString()}`
        + ` ⇒ **比这次 build 早 ${behind} 秒**（≈ ${(behind / 3600).toFixed(2)} 小时）· 跑的是 ${p.checkout}`
        + (srcNewestMtime === null ? ' · ⚠ 源码 mtime 取不到（按落后报）'
          : ` · 源码最新改动 ${new Date(srcNewestMtime).toISOString()}（**晚于启动**）`)
    }),
    '    ⇒ ⚠ 要让它跑上新产物：**只重启宿主**'
      + '（⚠ `npm run build` 只写盘，⛔ 不给运行中的进程换代码）',
  )
  void worst
  return { verdict: 'lagging', head: detail.shift(), detail }
}

/**
 * 取"跑着本 checkout 的宿主进程"清单（⚠ 一个都取不到 ≠ 同步）。
 *
 * @returns `{ procs, notes, others }`：`procs` 是**已确认在跑本 checkout** 的进程（带启动时刻），
 *   `notes` 是**取数过程中的不确定项**（⚠ 非空就意味着"判不出"那一档要单列，⛔ 不许吞），
 *   `others` 是**在跑、但明确不是本 checkout 的宿主**（⚠ `{pid, profile, why}`）——
 *   ⚠⚠ **它必须单独带出来**：否则"宿主在跑但没装配本插件"会被渲染成
 *     「**没有找到**跑着本 checkout 的宿主进程」（实测 2026-10-20 就是这么误报的，
 *     两句话的修法完全不同：一个查进程、一个查 `dsh.profile.bundles`）。
 */
async function runningInstances() {
  if (PROBE !== null) {
    // ⚠ 机检注入：只替换"取数"，判据与渲染走同一段（见 `PROBE` 的注释）
    return {
      procs: Array.isArray(PROBE.procs) ? PROBE.procs : [],
      notes: typeof PROBE.note === 'string' ? [PROBE.note] : [],
      others: Array.isArray(PROBE.others) ? PROBE.others : [],
    }
  }
  const notes = []
  let btimeMs, hz
  try { btimeMs = bootTimeMs(); hz = clockTicks() } catch (e) {
    return { procs: [], notes: [`取不到内核启动时刻 / CLK_TCK：${String(e?.message ?? e)}`] }
  }
  // ⚠ 只认**本仓**的宿主：命令行必须是 `node <...>/dsh web`（⚠ 排掉 `bash -c` 之类的包装行）
  let listing
  try {
    listing = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' })
  } catch (e) {
    return { procs: [], notes: [`跑不了 \`ps\`：${String(e?.message ?? e)}`] }
  }
  const candidates = listing.split('\n').map((l) => l.trim()).filter((l) => l !== '')
    .map((l) => { const m = /^(\d+)\s+(.*)$/.exec(l); return m === null ? null : { pid: Number(m[1]), args: m[2] } })
    .filter((x) => x !== null)
    .filter((x) => /(?:^|\/)node\b/.test(x.args) && /\bdsh\s+web\b/.test(x.args) && !/\bps\b/.test(x.args.split(' ')[0]))
  if (candidates.length === 0) {
    // ⚠ 一个宿主都没有 ⇒ **不是**"同步"，是"没有可比的实例" ⇒ 判不出（由渲染层说）
    return { procs: [], notes: [] }
  }
  const procs = []
  const others = []
  for (const c of candidates) {
    let argv = []
    try { argv = readFileSync(`/proc/${c.pid}/cmdline`, 'utf8').split('\0').filter((x) => x !== '') } catch (e) {
      notes.push(`pid ${c.pid} 的 cmdline 读不到：${String(e?.message ?? e)}`); continue
    }
    const profile = profileOfCmdline(argv)
    if (profile === null) { notes.push(`pid ${c.pid} 判不出用的是哪个 profile（cmdline：${argv.join(' ')}）`); continue }
    const own = await profileRunsThisCheckout(profile)
    if (own.ok !== true) {
      // ⚠ `notThisPackage` = 能判、且**确实不是**本 checkout
      //   ⇒ ⚠⚠ **不进 notes，但必须进 `others`**（2026-10-20 修误报）：
      //     它是"宿主在跑、但没装配本插件"的**唯一**证据 ——
      //     丢掉它，渲染层就只能说"没有找到宿主进程"（⚠ 那句话**是假话**）。
      //   其余 = 取不到 ⇒ ⚠ **必须**进 notes（否则"判不出"会被静默吞成"同步"）
      if (own.notThisPackage !== true) notes.push(`pid ${c.pid}（profile ${profile}）：${own.why}`)
      else others.push({ pid: c.pid, profile, why: own.why })
      continue
    }
    let startedAt
    try { startedAt = processStartedAt(c.pid, btimeMs, hz) } catch (e) {
      notes.push(`pid ${c.pid} 的启动时刻读不到：${String(e?.message ?? e)}`); continue
    }
    procs.push({ pid: c.pid, startedAt, profile, checkout: own.resolved })
  }
  return { procs, notes, others }
}

const stampExists = existsSync(STAMP)
const libExists = existsSync(LIB_DIR)

console.log('`lib/` 同步自检 · dsh-hob（⚠ ⚠ **只报不拦** —— 落后只打印，⛔ 不 FAIL）')
console.log('')

if (!stampExists || !libExists) {
  console.log('判定：**未执行** —— 读不到 `lib/BUILD-STAMP`（或 `lib/` 不在）'
    + '⇒ 本检查**不代表通过**（退出码 2 与"已执行"有意区分）。')
  console.log('       ⚠ 修法：跑一次 `npm run build` 生成产物与戳。')
  console.log(`       ⇒ STAMP 存在：${stampExists} · LIB 存在：${libExists}`)
  process.exit(2)
}

// ── 面 ①：提交面（⚠ 权威来源 = 戳本身）────────────────────────────────────
const stamp = readFileSync(STAMP, 'utf8')
const field = (k) => {
  const m = new RegExp(`^${k}=(.*)$`, 'm').exec(stamp)
  return m === null ? null : m[1].trim()
}
const commit = field('commit')
const dirty = field('dirty')
const builtAt = field('built_at')

let head = null
try {
  head = (await import('node:child_process')).execFileSync('git', ['rev-parse', 'HEAD'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
} catch { head = null }

const notes = []
const lag = []
/**
 * ⚠⚠ **`lag` 里哪些行算"真正的落后"**（甲-6 的判据面，2026-10-21 · 第 325 轮）——
 *
 * ── 为什么 `lag` 与"该不该拦"**不能是同一个集合** ────────────────────────
 *   `lag` 里混着**两类完全不同的东西**：
 *     · **落后**（`面 ① 落后于当前提交` · `面 ② 源比产物新`）
 *       ⇒ 跑一次 `npm run build` 就能消掉 ⇒ 拦下来**有意义**（它正是"改了 src 不生效"的探测器）；
 *     · **信息性读数**（`面 ① 戳 dirty=true`）
 *       ⇒ ⚠ 它说的是"**编译那一刻**工作树脏"，原文自己就写着
 *         「与"现在脏不脏"是两件事 ⇒ 只报，⛔ 不代表现在有什么问题」。
 *       ⇒ ⛔ **把它也计入退出码 = 只要有未提交改动就恒红** ——
 *         而本仓当前**恰恰有 5 个文件未提交**（第 321/323/330 轮的正当修复）
 *         ⇒ `--strict-source` 会变成**恒红判据**，而"恒红的判据等于没有判据"
 *         （⚠ `REPORT-R225.md` §3.4-b 首选条，本文件头也引过）。
 *   ⇒ 所以**用两个集合**：`lag` 管**打印**（一行不少，读数面不变），
 *     `lagBlocking` 管**退出码**（只装"真的落后"）。
 *   ⚠ ⛔ **不是放宽**：`lag` 的渲染一个字未改，`dirty=true` 照样印 `✗` 给人看；
 *     变的只是"它有没有资格单独把整个 `check:all` 判红"。
 */
const lagBlocking = []
if (commit === null || commit === 'unknown') {
  lag.push('✗ 面 ①：戳里读不到 `commit=` ⇒ ⚠ 无法判"产物对应哪一版源码"（⚠ 不按通过处理）')
  /** ⚠ 判不出**不是**"产物没问题" ⇒ 与落后同档计入（⛔ 不落 0）。 */
  lagBlocking.push('commit-unreadable')
} else if (head === null) {
  lag.push(`✗ 面 ①：取不到 \`HEAD\`（git 不可用 / 非 git 仓）⇒ 无法与戳比对（戳 commit=${commit.slice(0, 12)}）`)
  lagBlocking.push('head-unreadable')
} else if (commit !== head) {
  lag.push(`✗ 面 ①：产物**落后于当前提交** —— 戳 commit=${commit.slice(0, 12)} · HEAD=${head.slice(0, 12)}`
    + `（⚠ 戳 built_at=${builtAt ?? '?'}）⇒ ⚠ 跑一次 \`npm run build\``)
  lagBlocking.push('stamp-behind-head')
} else {
  notes.push(`✓ 面 ①：戳 commit = \`HEAD\` = ${commit.slice(0, 12)}（⚠ 产物对应当前提交）`)
}
if (dirty === 'true') {
  lag.push('✗ 面 ①：戳 `dirty=true` ⇒ ⚠ 编译时工作树**当时是脏的**'
    + '（⚠ 与"现在脏不脏"是两件事 ⇒ 只报，⛔ 不代表现在有什么问题）'
    + '\n      ⇒ ⚠ **本条不计入退出码**（⚠ 它不是"落后"：`commit` 已与 `HEAD` 一致、'
    + '面 ② 也逐对核过；⚠ 把它计入 ⇒ 只要有未提交改动就恒红）')
} else if (dirty !== null && dirty !== 'unknown') {
  notes.push(`✓ 面 ①：戳 dirty=${dirty}（⚠ 编译时工作树是干净的）`)
}

// ── 面 ②：内容面（⚠ 面 ① 说"同步"时也不能省）─────────────────────────────
const srcFiles = walk(SRC_DIR)
/**
 * ⚠⚠ **源码最新 mtime**（面 ③ 用来分辨"重编"与"真的改了源码"）——
 *   `null` = 一份源件都取不到（⚠ 此时面 ② 也会报"比较对 0"，⛔ 不静默）。
 */
const srcNewestMtime = (() => {
  let newest = null
  for (const f of srcFiles) {
    try {
      const t = statSync(f).mtimeMs
      if (newest === null || t > newest) newest = t
    } catch { /* 单件读不到 ⇒ 跳过（不影响"取到的那部分"） */ }
  }
  return newest
})()
let compared = 0
let missingProduct = 0
let staleProduct = 0
const staleLines = []
for (const f of srcFiles) {
  const prod = productOf(f)
  if (!existsSync(prod)) {
    // ⚠ 有些源件**本就没有独立产物**（类型 / 被内联进别的 bundle）⇒ ⚠ **不计入"比较对"**，
    //   但要**报出条数**（⛔ 不静默缩水，见文件头「不许扫 0 份报 ✓」）。
    missingProduct++
    continue
  }
  compared++
  const st = statSync(f).mtimeMs
  const pt = statSync(prod).mtimeMs
  if (st > pt + 1000) {   // ⚠ 1s 容差：同一批 build 里源与产物的 mtime 会非常接近
    staleProduct++
    if (staleLines.length < 20) {
      staleLines.push(`✗ 面 ②：\`${relative(root, f)}\` 比它的产物 \`${relative(root, prod)}\` 新`
        + `（源 ${new Date(st).toISOString()} > 产物 ${new Date(pt).toISOString()}）`)
    } else if (staleLines.length === 20) {
      staleLines.push('…（更多略）')
    }
  }
}
for (const l of staleLines) lag.push(l)
if (staleProduct > 0) {
  lag.push(`✗ 面 ②：共 **${staleProduct}** 件源比产物新 ⇒ ⚠ 跑一次 \`npm run build\``)
  lagBlocking.push('source-newer-than-product')
} else if (compared > 0) {
  notes.push(`✓ 面 ②：**${compared}** 对「源 ↔ 产物」**逐对核过 mtime**，⛔ 无一件源比产物新`)
}
/** ⚠ 骨架件经派生件已落在面 ② 的覆盖面里（⛔ 不另立口径）。 */
const manifestSrc = join(SRC_DIR, 'server', 'skeleton-manifest.ts')
if (existsSync(manifestSrc)) {
  notes.push(`✓ 面 ②：骨架派生件 \`src/server/skeleton-manifest.ts\` 在位`
    + '（⚠ 骨架件 ⇒ 派生件 ⇒ 产物 的链路**已被面 ② 覆盖**，⛔ 不另立第二条口径）')
}

// ── 面 ③：运行实例面（⚠ 三档，⛔ 一行都不许省）────────────────────────────
//
//   ⚠ 分档**只在** `classifyInstance()` 一处（本文件上半部）—— 这里只负责**取数 + 渲染**，
//     ⛔ 不在这儿再判一次（两处各写必然漂）。三档含义见该函数。
const inst = await runningInstances()
const stampBuiltAt = PROBE !== null && 'builtAt' in PROBE ? PROBE.builtAt : builtAtOf()
const instNotes = [...inst.notes]
/**
 * ⚠⚠ **把"在跑但没装配本插件"那一档一并喂进去**（2026-10-20 · 修误报）：
 *   少了它，`procs` 为空就会印出「**没有找到**跑着本 checkout 的宿主进程」——
 *   ⚠ 而宿主可能**明明在跑**（实测 pid 26110 / 30214，只是那个 profile 的
 *   `dsh.profile.bundles` 里没有 `dsh-hob`）⇒ 那句话把人引向错的修法。
 */
const classified = classifyInstance(stampBuiltAt, inst.procs, instNotes, inst.others, srcNewestMtime)
const instVerdict = classified.verdict
const instHead = classified.head
let instDetail = [...classified.detail]

console.log('  ✓ 覆盖面：')
console.log(`      · 面 ① 取数件：\`lib/BUILD-STAMP\`${stampExists ? '（可读）' : '（⚠ 读不到）'}`)
console.log(`      · 面 ② 源件 **${srcFiles.length}** 份（\`src/**/*.ts(x)\`，⚠ 排除 \`.d.ts\`）·`
  + ` 有对应产物 ⇒ 比较对 **${compared}** 对 · ⚠ 无独立产物（类型 / 被内联）**${missingProduct}** 份`
  + '（⛔ 不计入比较对，⚠ **照实报出条数，不静默缩水**）')
console.log(`      · 戳读数：commit=${commit ?? '?'} · dirty=${dirty ?? '?'} · built_at=${builtAt ?? '?'}`)
console.log(`      · 面 ③ 取数件：\`/proc/<pid>/stat\` + \`/proc/stat\` + profile 的 \`dsh.profile.bundles\``
  + ` · 已确认在跑本 checkout 的宿主进程 **${inst.procs.length}** 个`
  + (srcNewestMtime === null ? ' · ⚠ 源码 mtime 取不到' : ` · 源码最新改动 ${new Date(srcNewestMtime).toISOString()}`)
  + (instNotes.length > 0 ? ` · ⚠ **${instNotes.length} 处取不到**（见下）` : ''))
console.log('')
for (const n of notes) console.log('  ' + n)
/**
 * ⚠ **处级口径**（2026-10-21 · 第 350 轮 · 甲-1 收尾）：`查了 = 过了 + 跳过`。
 *
 * ⚠⚠ **本族的口径与其他族不同，必须说清（⛔ 不许硬凑成一个样子）**：
 *   · 其余族的"处"= **逐条断言**；本族是**按面**判的（面 ①② / 面 ③），
 *     一条"面"的结论里含多个取数动作 ⇒ **没有"逐条断言数"这个自然载体**。
 *   · ⇒ 本族的"查了"取 **`notes` 的条数**（= 真正印出来的 `✓` 读数行数），
 *     "过了" = `notes - lag.length`（`lag` 是落后/取不到的读数）。
 *   ⚠ 这个口径**在本族内部自洽**（`查了 = 过了 + 跳过` 恒成立），
 *     但它与"逐条断言族"的"处"**不是同一个分母**（一个按面、一个按条）。
 *   ⚠ 本族**没有**"跳过"分支 ⇒ `skip` 恒 0。⛔ `lag` 不进"过了"、也不进"跳过"。
 */
const SKIP_BUILD = []
console.log('')
console.log(`  处级口径：查了 ${notes.length + SKIP_BUILD.length} 处 · 过了 ${notes.length - lag.length} 处`
  + ` · **跳过 ${SKIP_BUILD.length} 处**（⚠ 跳过**不计入通过**；⚠ 本族口径按**读数行**、非逐条断言）`)
console.log('')
if (lag.length === 0) {
  console.log('判定：**已执行** —— 面 ① / 面 ② **都没有落后读数**（⚠ 产物跟得上源码）。')
  console.log('       ⚠ 面 ③（运行实例 vs 产物）**另在下面单独判**，⛔ 不并进这一句 ——'
    + ' 盘上绿**不代表**跑着的进程也绿（两者可以一个绿一个红）。')
  console.log('       ⚠ ⛔ 本判据**仍不判**"实例有没有在**服务里**用上这版产物" —— 那是 `E-168` 的〔实例层〕。')
  console.log('       ⚠ ⛔ 也**不判**"现在工作树脏不脏" —— 那是 `git status` 的活。')
} else {
  /**
   * ⚠ 这一句**必须把"本轮是哪种跑法"说清**（甲-6 的判据要求：两种跑法行为可辨）——
   *   改前无论哪一档都印同一句"只报不拦" ⇒ 读了会以为"永远拦不住"。
   */
  /**
   * ⚠⚠ **判定行必须与退出码同源**（`lagBlocking`，⛔ 不是 `lag`）——
   *   改前这一行拿 `lag` 写死：`dirty=true` 那种"信息性读数"也会把判定写成 FAIL，
   *   而出口却仍是 0 ⇒ **判定行与退出码互相打架**（本项目头号禁忌的同族）。
   */
  if (STRICT_SRC) {
    console.log(lagBlocking.length > 0
      ? '判定：**FAIL**（⚠ 面 ①② **落后** ⇒ `--strict-source` 下**计入退出码**）'
      : '判定：**PASS**（⚠ 面 ①② **没有落后** ⇒ `--strict-source` 下**不拦**；'
        + '⚠ 其余 `✗` 行是信息性读数，见各行末的"不计入退出码"说明）')
  } else {
    console.log('判定：**已执行**（⚠ ⚠ **有落后读数 —— 但本判据只报不拦，⛔ 不影响退出码**）')
  }
  for (const l of lag) console.log('  ' + l)
  console.log('')
  if (STRICT_SRC) {
    console.log('       ⚠ 本轮是**源码面判据模**（`--strict-source`）：面 ①② 的落后 **exit 1**。'
      + '⚠ 修法就是跑一次 `npm run build`（⚠ 本判据**不替你 build**）。')
  } else {
    console.log('       ⚠ ⚠ **为什么只报不拦**：⚠ "`lib/` 落后"**可能是未提交态 / 刚改完还没 build**'
      + '⇒ **拦了会恒红**，⚠ 而"恒红的判据等于没有判据"（⚠ `REPORT-R225.md` §3.4-b 首选条明写）。')
    console.log('       ⚠ 要让它长牙请用 `--strict-source`（⚠ `npm run check` 就是这么传下去的）。')
  }
}
console.log('')
// ── 面 ③ 的渲染（⚠ 三档各自成段；⛔ 同步那一档只许一行）─────────────────
console.log(instHead)
for (const l of instDetail) console.log(l)
if (instVerdict !== 'in-sync' && instVerdict !== 'rebuilt-only') {
  console.log('       ⚠ ⚠ 面 ③ **不等于**"产物有问题"：面 ①② 判的是**盘上**，面 ③ 判的是'
    + '**外面那个跑着的进程** —— 两者可以一个绿一个红（本文件头的成因说明）。')
}
console.log('')
if (STRICT) {
  console.log('       ⚠ 本轮是**判据模**（`--strict-instance`）：面 ③ 的不同步 / 判不出 **计入退出码**。')
} else {
  console.log('       ⚠ 本轮是**报警模**（缺省）：面 ③ **只打印、不影响退出码**'
    + '—— ⚠ 要让它长牙请用 `--strict-instance`（`npm run check` 就是这么传下去的）。')
}
console.log(STRICT_SRC
  ? '       ⚠ 面 ①②：本轮是**源码面判据模**（`--strict-source`）⇒ 落后 **exit 1**。'
  : '       ⚠ 面 ①②：本轮是**源码面报警模**（缺省）⇒ 落后**只打印、不影响退出码**'
    + '（⚠ 要让它长牙请用 `--strict-source`）。')
console.log('')
console.log('       ⚠ 覆盖面 / 判读口径：面 ①② = **产物 vs 源** · 面 ③ = **运行实例 vs 产物**'
  + '（⛔ 都不是"实例是否在服务里用上它"）；'
  + '⚠ 退出码 0=已执行 · 1=面③不同步（仅判据模）· 2=未执行/基准缺失或面③判不出'
  + '（含"宿主在跑但没装配本插件"那一档 · 仅判据模）；'
  + '⚠ 另有 **`rebuilt-only`（重编但源码未变）** 一档 —— 它**算同步**，⛔ 不计入退出码。')
/**
 * ⚠ 退出码：面 ①② 的那条口径（只报不拦 · 只设 0/2）**一个字都没改**；
 *   面 ③ 只在**判据模**下才动退出码 —— 见文件头的「跑法分两档」。
 */
// ══════════════════════════════════════════════════════════════════════
// 自检模（`--self-check`）—— 面 ③ 的三档 + 一条负向对拍
// ══════════════════════════════════════════════════════════════════════
//
// ⚠ 每一条都走 `classifyInstance()`（与真现场**同一段代码**），⛔ 不另写一份判定。
// ⚠ 每条都**必须能失败**（`E-27`）；且**不许**靠"看退出码"判 —— 要看**可读断言行**。

// ⚠ **判据自己坏了必须先红**（⛔ 不许"判据不成立还照旧报现场读数、然后绿"）
if (selfCheckFailed === true) process.exit(1)
/**
 * ⚠⚠ **面 ①② 的落后 ⇒ `exit 1`**（2026-10-21 · 第 325 轮 · **甲-6**）。
 *
 * ── 为什么排在面 ③ 之前 ────────────────────────────────────────────────
 *   两者的码语义**不同**、⛔ 不许压成一个（TASK 明令）：
 *     · 面 ①② 落后 ⇒ **1**（"产物与源不一致"= 查了、且有问题，可以立刻 `npm run build` 消掉）；
 *     · 面 ③ 判不出 / 未装配 ⇒ **2**（"没有基准可判"，不是"查了不过"）。
 *   ⚠ 若排在面 ③ 之后，面 ③ 判不出会把 `1` 吞成 `2` ⇒ 读的人会去查实例，而病灶在产物。
 *   ⚠ 反过来（面 ③ 不同步 + 面 ①② 落后）取 1 也可接受：**两者都是"跑 build 就能前进一格"**，
 *     而面 ③ 的 1 本来就是"不同步"，语义相容。
 *
 * ── ⚠ **基准缺失仍是 2**（⛔ 不许被本行改成 1）─────────────────────────
 *   戳读不到 / `lib/` 不存在 ⇒ 上面 `:617` 那处已经 `exit(2)` **提前返回**，走不到这里。
 *   ⇒ 本行只会因为**真的比对出了落后**而命中 —— 那正是"落后"与"基准缺失"分得开的证据。
 */
if (STRICT_SRC && lagBlocking.length > 0) process.exit(1)
if (STRICT && instVerdict === 'lagging') process.exit(1)
/**
 * ⚠⚠ **`not-assembled` 属于"判不出"那一族**（2026-10-20）：宿主在跑、但没装本插件
 *   ⇒ 这一版产物**不在任何进程里** ⇒ ⛔ 既不是"同步"也不是"落后" ⇒ 判据模下与
 *   `undecidable` **同档**（退出码 2）。⚠ ⛔ 不许让它悄悄落 0（那正是误报的另一种形态）。
 */
if (STRICT && (instVerdict === 'undecidable' || instVerdict === 'not-assembled')) process.exit(2)
process.exit(0)
