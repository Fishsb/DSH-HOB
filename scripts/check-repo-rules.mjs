/**
 * 仓库规则机检（族 ①）—— 入库 / 排除 / 骨架覆盖 / 脚本落点**双向**自检。
 *
 * ⚠ 2026-10-11（第 60 轮）从 `check-gitignore.mjs` 拆分而来（用户拍板「① 拆分那个检查脚本」）。
 *   只管**本仓库自己**：`.gitignore` 两栏清单 · README §1 骨架栏覆盖 ·
 *   `package.json` 的 `scripts` ↔ `scripts/*.mjs` 落点的正反两向。
 *   入口仍是 `scripts/check-gitignore.mjs`（`npm run check:gitignore`）。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { workspaceName } from './workspace-name.mjs'

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

/** 由入口调用；返回入口打印判定行所需的两个清单与几处共享读数。 */
export function runRepoRules({ bad, ok }) {
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
    // ⚠ 2026-10-13（第 128 轮）新增 `.hob/INIT.md`（**新工作区初始化清单**）——
    //   按 README §6.1 的既有程序「**三处同批**」登记：① 骨架件落盘 · ② `.gitignore` 的 `!` 例外 ·
    //   ③ 本清单加一行。⚠ **缺 ②** ⇒ 该文件静默不入库，git 不报任何错（**E-70**）。
    //   ⚠ **反向**：README §1 骨架栏点名了它、而本清单没有 ⇒ 本脚本当场 FAIL
    //   （本轮实测：加 README §1 而不加本行 ⇒ `✗ …机检与约定已漂移`，EXIT=1）。
    //   ⇒ 本行是**新增**，不放松任何既有断言；两方向对账见 **E-128**。
    ['.hob/INIT.md', '骨架 · 新工作区初始化清单（README §1 + §1.8）'],
    ['.hob/EXPERIENCE.md', '骨架 · 经验库**索引**（README §1 + §1.7）'],
    // ⚠ 2026-10-11（第 81 轮）**原样加回** —— 第 80 轮曾因「目录尚不存在、.gitignore 也没放行」
    //   把它撤下；本轮目录真的建了、`!` 例外真的加了、文件真的入库了 ⇒ 三处同批恢复。
    //   ⚠ 目录形态的判据见 `inIndexDir()`（`git ls-files --error-unmatch` 对目录恒 false）。
    ['.hob/experience/', '骨架 · 经验库条目目录（README §1 + §1.7；一条一个 <编号数字>.md）'],
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
    ['scripts/check-archive-consistency.mjs', '入库脚本（被 package.json 的 check:archive 调用 · 归档一致性机检）'],
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
    // ⚠ 2026-10-15 补（第 210 轮 · 根治「滚出行丢失」）：轮次号集「只增不减」对账。
    //   本脚本的"反向自检"**又一次当场 FAIL** 抓出本行缺失（与上面五条同族的**第六次**现场抓获）——
    //   这正是"加完 script 未登记 ⇒ 直接红"这条自检形态有效的又一次证据。
    //   ⚠ 它由 `check:rounds` 调用；⚠ 覆盖面 = **轮次号这一类标识**（⚠ 归纳，⛔ 非穷举）。
    ['scripts/check-rounds-records.mjs', '入库脚本（被 package.json 的 check:rounds 调用 · 轮次号集只增不减对账）'],
    // ⚠ 2026-10-16 补（第 224 轮 · `UD-118`「C」）：骨架「同源」机制**生成派生物**那一半。
    //   ⚠ 它由 `npm run gen:skeleton` 调用（⚠ 是一个**真入口**：有自己的入参 `--check`、
    //     输出行与退出码 ⇒ ⛔ 不进 `SCRIPT_LANDING_EXEMPT`，那份只放"纯库"）。
    //   ⚠ **本脚本的"反向自检"当场 FAIL 抓出本行缺失**（与上面六条同族的**第七次**现场抓获）——
    //     这正是"加完 script 未登记 ⇒ 直接红"这条自检形态有效的又一次证据。
    //   ⚠ 它生成 `src/server/skeleton-manifest.ts`；⚠ 由 `check:gitignore` 的断言 **R** 反向核（同源）。
    ['scripts/gen-skeleton-manifest.mjs', '入库脚本（被 package.json 的 gen:skeleton 调用 · 由 .gitignore 的 ! 例外派生骨架清单）'],
    // ⚠ 2026-10-17 补（第 288 轮 · `UD-130` 放行「动判据脚本」）：**读数可指认**机检。
    //   ⚠ 同族的**第八次**现场抓获 —— 加完 `check:readings` 未登记时，
    //     本脚本的"反向自检"（读 package.json 的 scripts 反查 MUST-TRACK）**当场 FAIL**：
    //     `✗ package.json 声明的脚本不在 MUST-TRACK 里：scripts/check-readings-citable.mjs`。
    //   ⚠ ⇒ 本条即那次的修正结果；⛔ **未放松任何既有断言**（`UD-130` 的边界）。
    ['scripts/check-readings-citable.mjs', '入库脚本（被 package.json 的 check:readings 调用 · 报告读数可指认机检）'],
    // ⚠ 2026-10-17 补（第 292 轮 · `TASK-R226` (c) · 依 `REPORT-R225.md` §3.4-b 首批 `#11`）：
    //   **`lib/` 同步自检**。⚠ 由来有实测：⚠ `lib/BUILD-STAMP` 停在 `26302ff`（= 第 272 轮），
    //   ⚠ ⚠ **而 `R219`/`R220`/`R221`/`R223` 四份报告都写了"`build` 已跑"**
    //   ⇒ ⚠ "跑了 `build`"与"产物真的跟上了"是两件事。
    //   ⚠ ⚠ **它只报不拦**（落后只打印、**永远 exit 0**）—— ⚠ 因为"`lib/` 落后"也可能是未提交态，
    //     拦了**恒红**（⚠ `REPORT-R225.md` §3.4-b 明写的难点）⇒ ⚠ 它不是"断言的牙口"，是**报警器**。
    //   ⚠ 同族的**第九次**现场抓获 —— 加完 `check:build` 未登记时，本脚本的"反向自检"
    //     （读 package.json 的 scripts 反查 MUST-TRACK）**当场 FAIL**：
    //     `✗ package.json 声明的脚本不在 MUST-TRACK 里：scripts/check-build-sync.mjs`。
    //   ⚠ ⇒ 本条即那次的修正结果；⛔ **未放松任何既有断言**（`UD-130` 的边界）。
    ['scripts/check-build-sync.mjs', '入库脚本（被 package.json 的 check:build 调用 · lib/ 同步只报不拦自检）'],
    // ⚠ 2026-10-19 补（本单 · `TASK` 补投判据接线）：**补投判据**（错投回执按 owner 补送）。
    //   ⚠ 由来（实测）：该脚本上一轮作为**独立入口**落下（`node scripts/check-redeliver.mjs`），
    //     ⚠ ⚠ 但**总门不会跑它** ⇒ 正是本仓最忌讳的形态「**判据在、但不会响**」。
    //   ⚠ 本行**同时**被 `check-repo-rules` 的"脚本落点"双向自检要求：该脚本已进
    //     `package.json` 的 `check:redeliver`（= 它因此被 `check-all` 的派生族表自动收录）。
    //   ⚠ ⛔ 本条只**新增一条登记**，上面既有条目一字未动（`UD-130` 的边界）。
    ['scripts/check-redeliver.mjs', '入库脚本（被 package.json 的 check:redeliver 调用 · 补投判据：错投回执按 owner 补送）'],
    // ⚠ 2026-10-18 补（本批 · `UD-138` ⑥「补齐对外最小面」）：**聚合判据入口**与**前置条件预检**。
    //   ⚠ 由来：本仓此前有 12 条 `check:*`、**零聚合入口** ⇒ 对外标准「判据入口能一条命令跑」
    //     直接不成立（外部人不知道该跑哪条、跑了一半就以为全过了）。
    //   ⚠ ⚠ 同族的**第十次**现场抓获 —— 加完这两个 script 未登记时，本脚本的"反向自检"
    //     （读 package.json 的 scripts 反查 MUST-TRACK）**当场 FAIL**：
    //     `✗ package.json 声明的脚本不在 MUST-TRACK 里：scripts/check-all.mjs`（与 preflight 同批）。
    //   ⚠ ⇒ 本条即那次的修正结果；⛔ **未放松任何既有断言**（`UD-130` 的边界）——
    //     本条只**新增**两条登记，上面九条一字未动。
    //   ⚠ 两者分工：`check-all` 是**调度器**（不改任何判据的字节，只逐族转调 + 汇总退出码）；
    //     `preflight` 是**体检**（恒 exit 0，不是判据 —— 缺条件不该让外壳脚本变红，
    //     否则"缺依赖"与"判据失败"在 CI 里就分不开了）。
    ['scripts/check-all.mjs', '入库脚本（被 package.json 的 check / check:all 调用 · 一条命令跑完全部判据族并汇总退出码）'],
    ['scripts/preflight.mjs', '入库脚本（被 package.json 的 check:preflight 调用 · 判据前置条件体检，恒 exit 0）'],
    // ⚠ 2026-10-18 补（本卡 · 修「检查脚本靠猜目录名定位账本区」）：**工作区名配置的载体**。
    //   ⚠ 它是 `scripts/workspace-name.mjs` 读的**唯一**配置源（工作区根、被 git 跟踪）——
    //     随分支走 ⇒ 同一份代码放进任何目录名都派得对（隔离 worktree 目录名 = 卡 id 也不影响）。
    //   ⚠ 为什么必须进 MUST-TRACK：⚠ 它一旦被规则静默排除（**E-70** 形态），
    //     **clone / 新 worktree 里就没有它** ⇒ 7 个脚本退回猜目录名 ⇒ 账本面整族报
    //     「未执行 / 失败」，⚠ **而 git 不报任何错**（正是本卡病灶的复发路径）。
    //   ⚠ 它不是脚本、没有落点问题：本条只是"必须能被 git 跟踪"的登记。
    ['dsh-hob.workspace.json', '配置文件（工作区名的唯一来源 · 由 scripts/workspace-name.mjs 读取 · 随分支走）'],
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

  /**
   * 目录形态的 MUST-TRACK 判据（2026-10-11 · 第 81 轮新增）。
   *
   * **为什么不能直接用 `inIndex()`**：`git ls-files --error-unmatch -- <目录>/`
   *   **永远 exit 1**（实测：`error: pathspec '.hob/experience/' did not match any file(s) known to git`）
   *   —— git 只跟踪**文件**，目录本身不在 index 里。
   *   ⇒ 若照搬文件判据，本项会**常红**，而"常红"会让它被无视（**E-117** 同族）。
   *
   * ⚠ **这不是放宽**：改成的判据**更严** —— 不满足于"目录在那儿"，而是要求
   *   **该目录下至少有一个文件真的进了 index**。即它拦的正是本项要拦的东西
   *   （E-70 的失效模式：文件静默不入库）。
   */
  function inIndexDir(dir) {
    try {
      const out = execFileSync('git', ['ls-files', '--', dir], { cwd: root, encoding: 'utf8' })
      return out.trim() !== ''
    } catch (e) {
      if (typeof e.status === 'number') return false
      throw e
    }
  }

  for (const [p, why] of mustTrack) {
    const isDir = p.endsWith('/')
    const code = ignoreExitCode(p)
    if (code === 0) {
      bad(`MUST-TRACK 却被规则排除：${p}  —— ${why}`)
      continue
    }
    if (!existsSync(join(root, p))) {
      bad(`MUST-TRACK 但磁盘上不存在：${p}  —— ${why}（不存在无法证明"规则放行"，不算通过）`)
      continue
    }
    if (isDir ? !inIndexDir(p) : !inIndex(p)) {
      bad(isDir
        ? `MUST-TRACK（目录）但其中没有任何文件加入 git index：${p}  —— ${why}（目录在、规则也放行，但目录**空**或其中文件从未 git add ⇒ 仓库里仍没有它）`
        : `MUST-TRACK 但未加入 git index：${p}  —— ${why}（规则放行且文件在，但从未 git add ⇒ 仓库里仍没有它）`)
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
   * 两向对账：**`.gitignore` 注释里的骨架清单 ↔ README §1 骨架栏**（2026-10-14 第 147 轮新增）。
   *
   * ── 为什么需要（缺口有实测出处）──────────────────────────────────────
   *   `.gitignore` 头部那条注释**自称**：「本清单与 README §1 是**同一份清单的两处载体**
   *   ⇒ 改一处必须同步另一处，并由 `npm run check:gitignore` 机检」。
   *   ⚠ **而它其实没有任何判据管** —— 上面那条断言读的是**README 与 `!` 规则**，
   *   注释是**第三种载体**。第 146 轮实测：第 128 轮加 `.hob/INIT.md` 时改了
   *   README + `!` 规则 + 本脚本清单，**唯独漏了注释** ⇒ 注释停在 6 项、README 是 7 项，
   *   **静默漂了很久**；并**现场实证**（往注释里塞一行噪音 ⇒ 判据输出与退出码**都不变**）。
   *
   * ── 判据（**两向**，E-126：只验一侧 ⇒ "改哑"与"改对"输出相同）────────────────
   *   ① 抽取：README §1 骨架行的 `` `.hob/xxx` `` 提及 ↔ `.gitignore` 注释**骨架段**里的同形提及；
   *   ② 两向差集**都必须为空**，任一非空 ⇒ FAIL 并**逐个点名**；
   *   ③ ⚠ **基准缺失 ⇒ FAIL**（抽不到任一侧 / 定位锚点不在 ⇒ **不按通过处理**，⛔ 不许静默跳过）。
   *
   * ⚠ 抽取口径与上面那条**同源**（都取 `.hob/xxx` 形态）—— 同一处口径写两遍会漂。
   */
  {
    const giSrc = (() => {
      try { return execFileSync('cat', [join(root, '.gitignore')], { encoding: 'utf8' }) } catch { return '' }
    })()
    const giLines = giSrc.split('\n')
    const startAt = giLines.findIndex((l) => l.includes('账本：骨架进 git'))
    const endAt = giLines.findIndex((l) => l.includes('运行数据（填充进格式'))
    if (startAt < 0 || endAt < 0 || endAt <= startAt) {
      bad('`.gitignore` 注释里的骨架清单读不到（基准缺失 ⇒ 不按通过处理）：'
        + '未找到「账本：骨架进 git」/「运行数据（填充进格式」两个定位锚点')
    } else {
      const giComment = giLines.slice(startAt, endAt).join('\n')
      const inComment = [...new Set([...giComment.matchAll(/`(\.hob\/[A-Za-z0-9._-]+\/?)`/g)].map((m) => m[1]))]
      const inReadme = [...new Set(mentioned)]
      if (inComment.length === 0) {
        bad('`.gitignore` 注释的骨架段里抽不到任何 `.hob/xxx` 提及（基准缺失 ⇒ 不按通过处理）')
      } else {
        const onlyReadme = inReadme.filter((p) => !inComment.includes(p))
        const onlyComment = inComment.filter((p) => !inReadme.includes(p))
        if (onlyReadme.length > 0 || onlyComment.length > 0) {
          bad('`.gitignore` 注释的骨架清单与 README §1 骨架栏**不一致**（两向对账）：'
            + `\n       README 有、注释缺：${onlyReadme.join(', ') || '无'}`
            + `\n       注释有、README 缺：${onlyComment.join(', ') || '无'}`
            + '\n      ⇒ 那条注释自称"本清单与 README §1 是同一份清单的两处载体"'
            + '\n        ⇒ 改一处必须同步另一处（第 128 轮加 `.hob/INIT.md` 时漏的正是注释）')
        } else {
          ok('`.gitignore` 注释的骨架清单与 README §1 骨架栏**两向一致**'
            + `（各 ${inComment.length} 项：${inComment.join(' ')}）`)
        }
      }
    }
  }

  /**
   * `roles/` 的**存在性断言**（2026-10-14 第 147 轮新增，**派生式**）。
   *
   * ── 为什么需要（缺口有实测出处）──────────────────────────────────────
   *   第 146 轮审计实测：`roles/` 有 **18 份**，而本脚本 MUST-TRACK 只登记了 **2 份**
   *   （`qa.md` / `quality-gates.md` 两条"代表项"）⇒ **其余 16 份删掉一半不会有任何红**。
   *   而 README §1.3 把 `roles/` 归骨架的理由是「**可复用、可分发**的格式+知识契约」
   *   —— 一份"可分发契约"少了成员却无人报，与 E-70 同族（**清单有、机检没有**）。
   *
   * ── 判据（**派生式**，⛔ 不写死成员数）──────────────────────────────
   *   ① 目录 `roles/methods/` **必须存在且非空**（否则 FAIL，⛔ 不按通过处理）；
   *   ② 盘上每一份成员**必须逐个可读**，且**不得是空文件**；
   *   ③ 成员数**必须 ≥ 上面 MUST-TRACK 里已登记的 `roles/` 条数**
   *      （防止"登记的还在、别的成员已被删"）；
   *   ④ ⚠ **不写死任何数字**（E-117：写死会漂）—— 报的是**实测值**。
   */
  {
    const rolesDir = join(root, '.hob', 'roles', 'methods')
    let names = []
    let dirOk = true
    try { names = readdirSync(rolesDir).filter((n) => n.endsWith('.md')) } catch { dirOk = false }
    if (!dirOk) {
      bad('`.hob/roles/methods/` 读不到（目录不在 / 不可读 ⇒ 基准缺失，不按通过处理）')
    } else if (names.length === 0) {
      bad('`.hob/roles/methods/` 里一份 `.md` 也没有（README §1.3 说它是"随角色数增长的多份" ⇒ 与约定不符）')
    } else {
      const unreadable = []
      const empty = []
      for (const n of names) {
        try {
          const body = readFileSync(join(rolesDir, n), 'utf8')
          if (body.trim() === '') empty.push(n)
        } catch { unreadable.push(n) }
      }
      const registered = mustTrack.filter(([p]) => p.startsWith('.hob/roles/')).length
      if (unreadable.length > 0) bad('`.hob/roles/methods/` 有读不到的成员：' + unreadable.join(', '))
      if (empty.length > 0) bad('`.hob/roles/methods/` 有空成员（0 字节）：' + empty.join(', '))
      if (names.length < registered) {
        bad('`.hob/roles/methods/` 成员数（' + names.length + '）少于 MUST-TRACK 登记的 roles 条数（'
          + registered + '）⇒ 登记的还在、别的成员已被删（或目录被截断）')
      }
      if (unreadable.length === 0 && empty.length === 0 && names.length >= registered) {
        ok('`.hob/roles/methods/` 存在性断言通过：' + names.length + ' 份成员**逐个可读**、无空文件'
          + '（⚠ 数字是**实测值**，⛔ 不写死）')
      }
    }
  }


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
   * ⚠ 白名单**当前非空**（见下：2026-10-11 第 60 轮登记的三个纯库模块）；表存在的意义是：越过规则时
   * **必须留下一条带理由的记录**，而不是悄悄漏掉。
   * ⚠ 白名单自身也**不许腐烂**（E-122 同族）：表里的路径若**已不在磁盘**、或**反而被
   * package.json 声明了**（自相矛盾）⇒ 同样 **FAIL**，逼人删掉或修正，不留幽灵条目。
   */
  const SCRIPTS_DIR = join(root, 'scripts')
  /**
   * 白名单：本就不该被 `npm run` 单独调到的 `scripts/*.mjs`（相对仓库根的路径）。
   * 每条形如 `[path, 理由]`。⛔ 理由必须写清"为什么它不需要落点"。
   */
  const SCRIPT_LANDING_EXEMPT = [
    // ── 2026-10-11 第 60 轮：`check-gitignore.mjs` 拆成「薄调度 + 三个模块」──
    //   ⚠ 这三份是**纯库**：被入口 `import` 后按族依次调用，**自己不该单独进 `npm run`**
    //     （它们只导出 `run*` 函数，没有自己的进程入口、输出段与退出码）。
    //   ⛔ 不是"扫不到就算了"—— 逐条显式登记 + 写明理由（见上方纪律）。
    ['scripts/check-repo-rules.mjs', '纯库：族 ① 入库/排除/骨架覆盖/脚本落点双向自检，由入口 import 调用'],
    ['scripts/check-doc-shape.mjs', '纯库：族 ② 正本形态 A/B/J/C/D/D′/E/I + findDuplicateSectionHeadings，由入口 import 调用'],
    ['scripts/check-code-face.mjs', '纯库：族 ③ 静态面 K/F/G/H，由入口 import 调用'],
    // ⚠ 2026-10-18（本卡 · 修「检查脚本靠猜目录名定位账本区」）：**工作区名的唯一来源**。
    //   ⚠ 它是**纯库**：只导出 `workspaceName()` / `configuredWorkspaceName()` 与两个常量，
    //     没有自己的进程入口、输出段与退出码 ⇒ ⛔ 不该单独进 `npm run`。
    //   ⚠ 存在的理由：原先 7 个脚本**各写一份**猜目录名的逻辑（`basename(root)` 等），
    //     隔离 worktree 里目录名 = 卡 id ⇒ 账本面整族报「未执行 / 失败」。
    //     现在**只有一个来源**（配置 + 本模块），调用方一律传自己的旧猜法兜底 ⇒
    //     未配置时与改动前逐字一致（⛔ 不是放宽，是收口）。
    ['scripts/workspace-name.mjs', '纯库：工作区名的唯一来源（配置优先 · 未配置落回调用方旧猜法），由各判据脚本 import 调用'],
  ]
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
   * ── 断言 A（2026-10-14 第 148 轮）：骨架**活规矩层**的**引用闭合** ─────────────
   *
   * ── 为什么需要（缺口有实测出处）──────────────────────────────────────
   *   第 146 轮审计的结论是「**骨架层完全没有判据**」：骨架里的路径 / 文件名引用
   *   **可以随便断，而全部收尾命令一条都不会红**（`check-doc-shape.mjs` 自陈
   *   "只扫正本"、`.hob/**` "不在辖"）。P-2 / R-1 / C-1 / C-3 **全是它的直接后果**。
   *
   * ── ⚠⚠ 必须**分层**（这是本条最关键的设计，⛔ 不是可有可无）────────────────
   *   **记录层**（`.hob/experience/**`）里的"断"是**历史** —— 第 146 轮实测 **80 处**，
   *   那些路径**当时存在、现已退场**，改了就是**伪造历史**。
   *   ⇒ 若把记录层纳入判据，这条断言**会恒红**（比没有更糟：恒红的判据等于没有判据）。
   *   **只扫活规矩层** = `.hob/{README.md,INIT.md,EXPERIENCE.md}` + `templates/` + `roles/` + `drafts/`。
   *
   * ── 判据（**派生式**，⛔ 不写死清单）──────────────────────────────────
   *   ① 抽活规矩层里**具名引用**两族：`src/… · scripts/… · preset/… · lib/… · package.json`
   *      （工作区相对路径）与 `archive/… · volumes/…`（账本区相对路径）；
   *   ② 逐条 `existsSync`（工作区族查工作区、账本区族查账本根 —— 账本根取自
   *      `LEDGER` 的解析，读不到 ⇒ **FAIL**，⛔ 不静默跳过）；
   *   ③ ⚠ **排除**：以 `/` 结尾的**目录简称**（正文里"归档区/某目录"的泛指）、含 `...` 或 `*` 的
   *      **示意形态**、以及**账本区在当前机器上不存在**时的账本族整体（打印"未执行、不代表通过"）；
   *   ④ 每族**都报计数**（核了多少 / 排除多少 / 为什么）—— 防"覆盖面静默缩水"（第 121 轮的教训）。
   */
  {
    const liveFiles = (() => {
      const out = []
      const roots = ['.hob/templates', '.hob/roles', '.hob/drafts']
      for (const r of roots) {
        const abs = join(root, r)
        let es = []
        try { es = readdirSync(abs, { withFileTypes: true }) } catch { continue }
        const dig = (dir) => {
          let ds = []
          try { ds = readdirSync(dir, { withFileTypes: true }) } catch { return }
          for (const d of ds) {
            const p = join(dir, d.name)
            if (d.isDirectory()) dig(p)
            else if (/\.(md|html)$/.test(d.name)) out.push(p)
          }
        }
        for (const e of es) {
          const p = join(abs, e.name)
          if (e.isDirectory()) dig(p)
          else if (/\.(md|html)$/.test(e.name)) out.push(p)
        }
      }
      for (const f of ['.hob/README.md', '.hob/INIT.md', '.hob/EXPERIENCE.md']) {
        const p = join(root, f)
        try { readFileSync(p); out.push(p) } catch { /* 不在就跳过 */ }
      }
      return out
    })()

    if (liveFiles.length === 0) {
      bad('断言 A：骨架活规矩层一份文件也读不到（基准缺失 ⇒ 不按通过处理）')
    } else {
      // 账本根：⚠ **与 check-doc-shape 同口径**（唯一权威 = 预设行声明的 `ledgerHome`）
      //   ⛔ **不硬编码本机绝对路径**（UD-73③）：从预设行读 `ledgerHome`，取 `<ledgerHome>/<工作区名>`。
      const ledgerRoot = (() => {
        const candidates = []
        try {
          const preset = readFileSync(join(root, 'preset', 'dsh-hob', 'preset-dsh-hob.patch.yml'), 'utf8')
          const m = /ledgerHome:\s*(\S+)/.exec(preset)
          if (m !== null) candidates.push(m[1])
        } catch { /* 预设读不到 ⇒ 下面的候选为空 ⇒ 走"未执行"分支 */ }
        // ⚠ 工作区名**从配置读**（唯一来源 = `scripts/workspace-name.mjs`）；
        //   未配置 ⇒ 落回 `basename(root)`（与改动前逐字一致）—— ⛔ 本脚本不再自己猜目录名。
        const wsName = workspaceName(() => basename(root))
        for (const home of candidates) {
          const dir = join(home, wsName)
          if (existsSync(dir)) return dir
        }
        return undefined
      })()
      const ledgerExists = ledgerRoot !== undefined
      const wsRe = /`((?:src|scripts|preset|lib)\/[A-Za-z0-9._\/-]+)`/g
      const ledgerRe = /`((?:archive|volumes)\/[A-Za-z0-9._\/-]+)`/g
      /**
       * ⚠⚠ **不该咬的**（第 126 轮口径：禁词判据必须点名"只在哪个格子里找"）──────────
       * 这两类**不是"断裂的引用"**，判据**必须**能区分它们（否则会误报、进而逼人删真信息）：
       *
       * ① **明示缺失 / 历史的叙述**：同一行里带这些标记词 ⇒ 该路径**本来就说的是"曾经/不在"**。
       *    例：`.hob/README.md:647`（`…**未搬运** —— 现役机检是…`）、
       *        `.hob/drafts/restructure-plan.md:62`（`… | 删文件 |`）。
       *    ⚠ 清单**逐条列出**而不是"看着像就算了"；新增豁免必须在这里显式登记 + 写理由。
       *
       * ② **声明为"外部/历史归档"的整节**：`.hob/EXPERIENCE.md` 的 `## 8. 可搬资产清单`
       *    那一节的路径**指向工作区之外的旧项目归档**（`archive/…` 是**那份副本内部的**相对路径，
       *    ⛔ 不是本账本区的路径）⇒ 该节整体**不在辖**（理由写在 `EXPERIENCE.md` 表头："全部在归档目录里可查"）。
       *    ⚠ 用**节标题**定位而不是行号（行号会漂）。
       */
      const ABSENCE_MARKERS = ['未搬运', '未做', '不许假设', '删文件', '已删', '已退场', '曾是', '曾于', '原口径', '历史上', '拟删']
      const isAbsenceNarrative = (line) => ABSENCE_MARKERS.some((w) => line.includes(w))
      // 整节豁免：按**节标题**起止（`## N. 标题` 到下一个 `## `），⛔ 不按行号
      const sectionExempt = (src) => {
        const lines = src.split('\n')
        const marks = []
        for (let i = 0; i < lines.length; i++) if (/^## /.test(lines[i])) marks.push(i)
        const out = new Set()
        for (let k = 0; k < marks.length; k++) {
          const title = lines[marks[k]]
          if (title.includes('可搬资产清单')) {
            const end = k + 1 < marks.length ? marks[k + 1] : lines.length
            for (let j = marks[k]; j < end; j++) out.add(j)
          }
        }
        return out
      }
      const wsHits = []
      const ledgerHits = []
      let skippedDir = 0
      let skippedPattern = 0
      let skippedAbsence = 0
      for (const f of liveFiles) {
        const rel = relative(root, f).split('\\').join('/')
        const src = readFileSync(f, 'utf8')
        const exemptLines = sectionExempt(src)
        src.split('\n').forEach((line, i) => {
          const at = `${rel}:${i + 1}`
          // ⚠ 整节豁免（按节标题定位）与"明示缺失叙述"逐行豁免 —— 见上面那段注释
          const lineExempt = exemptLines.has(i) || isAbsenceNarrative(line)
          for (const m of line.matchAll(wsRe)) {
            const p = m[1]
            if (p.endsWith('/')) { skippedDir++; continue }
            if (lineExempt) { skippedAbsence++; continue }
            wsHits.push({ at, p, ok: existsSync(join(root, p)) })
          }
          for (const m of line.matchAll(ledgerRe)) {
            const p = m[1]
            if (p.endsWith('/') || p.includes('...') || p.includes('*')) { skippedPattern++; continue }
            if (lineExempt) { skippedAbsence++; continue }
            ledgerHits.push({ at, p, ok: ledgerExists ? existsSync(join(ledgerRoot, p)) : null })
          }
        })
      }
      const wsBad = wsHits.filter((x) => !x.ok)
      for (const x of wsBad) {
        bad(`断言 A · 工作区引用断裂：${x.at} → \`${x.p}\`（该路径不存在）`
          + '\n      ⇒ 骨架活规矩层里的具名引用必须指向**存在的实体**'
          + '\n      ⇒ 修法：改对路径，或把"这是历史/示意"写明（⛔ 不要删真引用）')
      }
      if (wsBad.length === 0) {
        ok(`断言 A · 工作区引用闭合：核 ${wsHits.length} 处，**全部存在**`
          + `（排除：目录简称 ${skippedDir} 处 · **明示缺失/历史叙述与整节豁免 ${skippedAbsence} 处**`
        + ` —— 后者见判据内的 ABSENCE_MARKERS 与"可搬资产清单"整节豁免，⛔ 都是**点名登记**的）`)
      }
      if (!ledgerExists) {
        // ⚠ 与 check-doc-shape 同款口径：账本区不在本机 ⇒ **打印"未执行"，⛔ 不报 ✓**
        ok(`断言 A · 账本区引用：**未执行、不代表通过**（账本根解析不到 —— 预设行的 \`ledgerHome\` 读不到 / 目录不在本机）`
          + ` —— 已收 ${ledgerHits.length} 处留待届时核`)
      } else {
        const ledgerBad = ledgerHits.filter((x) => x.ok === false)
        for (const x of ledgerBad) {
          bad(`断言 A · 账本区引用断裂：${x.at} → \`${x.p}\``
            + '\n      ⇒ 与工作区引用同一条判据（账本区路径也要指向存在的实体）')
        }
        if (ledgerBad.length === 0) {
          ok(`断言 A · 账本区引用闭合：核 ${ledgerHits.length} 处，**全部存在**`
            + `（排除示意形态/目录简称 ${skippedPattern} 处）`)
        }
      }
      ok(`断言 A · 覆盖面：活规矩层 ${liveFiles.length} 份（含根 3 件 + templates/ + roles/ + drafts/）；`
        + `⛔ **记录层 .hob/experience/** 不在辖**（那里 80 处"断"是历史，纳入会恒红）`)
    }
  }

  /**
   * ── 断言 B（2026-10-14 第 148 轮）：**可分发层不得含"开箱即错"族** ────────────
   *
   * ── 为什么需要（缺口有实测出处）──────────────────────────────────────
   *   骨架的**存在理由**是「拿去管别的项目」。而 `templates/**` 与 `roles/**` 正是
   *   **拿去开箱的那两层** —— 里面若写着本项目的编号 / 项目名 / 本机路径 /「第 N 轮」，
   *   新项目**开箱即错**（第 146/147 两轮各修过一批，且第 147 轮**实测过兜底网有洞**：
   *   「第 N 轮」那族 **0/2 命中**）。
   *
   * ── ⚠⚠ 豁免面**逐层点名 + 写明理由**（⛔ 不许用"通扫全文 = 0 命中"当判据）──────
   *   · `.hob/templates/**` —— **在辖**（开箱层）；
   *   · `.hob/roles/**`     —— **在辖**（开箱层，README §1.3 明写"可复用、可分发"）；
   *   · `.hob/README.md` / `.hob/INIT.md` —— **豁免**：它们是**本项目骨架的说明书**，
   *     已由第 147 轮的**节级标注**声明"其中编号是本项目账本条目号、开箱不带"
   *     （标注位置：`README.md` 文件头、`INIT.md` 文件头）；
   *   · `.hob/drafts/**`    —— **豁免**：它是**本项目自己的契约正文 / 草案**
   *     （README §1.2）—— ⚠ ⚠ **它确实随包分发**（在 `package.json` 的 `files` 里、
   *     也铺进新工作区）；⚠ ⚠ **豁免的真实理由是「随包分发的是本项目自己的契约正文、
   *     ⛔ 不是给别项目复用的模板」**（⚠ 第 292 轮更正：原措辞与「它随包发出」这一事实不一致）；
   *   · `.hob/EXPERIENCE.md` + `experience/**` —— **豁免**：**记录层**，历史读数**永久不改**。
   *   ⇒ ⛔ 这条判据**只扫两个在辖层**，并对豁免层**逐条打印理由**（让"没扫"可见）。
   *
   * ── 判据（**分族计数**）────────────────────────────────────────────────
   *   族 = ① 项目专有编号**具体值**（`CHG-nn`/`UD-nn`/`E-nn`，⚠ **占位号 `CHG-000`/`UD-00` 除外**）
   *        · ② 项目名（`dsh-hob` / `hob-ledgers` / `prompt-enhancer`）
   *        · ③ 本机路径（`/home/lk` · `/mnt/<盘>/` · `C:\\Users`）
   *        · ④「第 N 轮」项目史引用。
   *   ⚠ **每族都报计数**（核了多少 / 命中多少），⛔ 「命中 0」不得单独当"干净"的证据。
   */
  {
    const PLACEHOLDER = /^(?:CHG-0{3}|UD-0{2})$/
    /**
     * ⚠⚠ **分族 × 分层的在辖面**（⛔ 不是"整个文件豁免"）─────────────────────
     * 为什么不能用"整文件豁免"：`.hob/EXPERIENCE.md` 是**记录层索引**，
     *   它引**自己账本的条目编号**（`E-nn` 165 处）是**索引的本职** ⇒ 那一族**必须豁免**；
     *   但它的**本机路径 / 「第 N 轮」**是**换机必断**的形态（第 148 轮 ① 刚把它修净）
     *   ⇒ 那两族**必须留在辖**，否则**刚修好的东西会被下次改动注回去而无人报**（这正是回归对拍要证的事）。
     * ⇒ 故在辖面按**族**给，而不是按"文件"给。
     */
    /**
     * ⚠⚠ **第 5 族（第 292 轮新增 · `TASK-R226` (b) · 依 `REPORT-R224.md` §3.5 ②）** ──────
     * **要堵的洞（有实测出处）**：`templates/TASK.md` 里写着**本项目真实归档路径**
     *   （例：`archive/<本项目某日期>-<slug>/REPORT-R<号>.md`）—— ⚠ ⚠ **在别的项目里必断**
     *   （那个目录**不存在**），⚠ **而原 4 族一条都咬不到它**（它既无编号具体值中的 `E-/UD-/CHG-`，
     *   也不含项目名 / 本机路径 / 「第 N 轮」）。
     * ⚠ **为什么不能靠断言 A**：⚠ 断言 A（引用闭合）**扫**这一族，⚠ **而它拿「本项目账本」当基准**
     *   （`:545-560`：`existsSync(join(ledgerRoot, p))`）⇒ ⚠ ⚠ **在本项目里两条都通、换项目就断
     *   ⇒ A 证不了"别的项目里不断"**（这正是 R224 把它判成"盲区"的理由）。
     * ⚠ **口径（⛔ 不是"凡 archive/ 就咬"）**：⚠ 只咬**具体实例**，**放过通用形状** ——
     *   · **咬**：路径里出现**本项目的具体标识** —— 日期戳（`YYYY-MM-DD`）· 条目/报告号
     *     （`REPORT-R<号>`/`TASK-R<号>`/`UD-<号>`/`CHG-<号>`）· 轮次件（`rounds/<号>.md`）。
     *   · **放过**：`archive/<日期>-<名>/` 这类**尖括号占位**、`volumes/plan/INDEX.md` 这类
     *     **通用结构卷**、目录简称（`volumes/plan/`）—— ⚠ **新项目也会建同名卷** ⇒ **不算错**
     *     （⚠ 与 `REPORT-R224.md` §3.3-d 的（甲）/（乙）之分**逐字同口径**）。
     * ⚠ **占位号同样不计**（`UD-00` / `CHG-000` 形态）—— 与族 ① 同一把尺子。
     */
    const PLACEHOLDER_PTR = /(?:UD-0{2}|CHG-0{3})(?![\d])/
    const PTR_RE = /(?:^|[^A-Za-z0-9._/-])((?:archive|volumes)\/[A-Za-z0-9._/-]*(?:\d{4}-\d{2}-\d{2}|(?:REPORT-R|TASK-R|UD-|CHG-)\d{1,4}|rounds\/\d{1,4}\.md)[A-Za-z0-9._/-]*)/g
    const FAMILIES = [
      ['项目专有编号具体值', /\b(?:CHG|UD|E)-\d{1,3}\b/g, PLACEHOLDER, ['.hob/templates', '.hob/roles']],
      ['项目名', /dsh-hob|hob-ledgers|prompt-enhancer/g, null, ['.hob/templates', '.hob/roles']],
      ['本机路径', /\/home\/lk\b|\/mnt\/[a-z]\//g, null,
        ['.hob/templates', '.hob/roles', '.hob/EXPERIENCE.md']],
      ['第N轮引用', /第 *\d+ *轮/g, null,
        ['.hob/templates', '.hob/roles', '.hob/EXPERIENCE.md']],
      // ⚠ 第 5 族：⚠ **在辖面与 `IN_SCOPE` 逐字相同**（模板 + roles + 索引）——
      //   ⚠ 它**不**扫 `.hob/drafts/**`（那是**本项目自己的契约正文**，见 `EXEMPT` 那行：
      //   它逐条引本项目归档件是**本职**，纳入会**恒红** ⇒ 与"恒红的判据等于没有判据"同族）。
      ['具体归档/账本指针', PTR_RE, PLACEHOLDER_PTR,
        ['.hob/templates', '.hob/roles', '.hob/EXPERIENCE.md']],
    ]
    const IN_SCOPE = ['.hob/templates', '.hob/roles', '.hob/EXPERIENCE.md']
    const EXEMPT = [
      ['.hob/README.md', '本项目骨架**说明书** —— 第 147 轮已加节级标注声明"编号是本项目账本条目号、开箱不带"'],
      ['.hob/INIT.md', '同上（文件头已有节级标注）'],
      ['.hob/drafts/', '本项目**自己的契约正文 / 草案**（README §1.2）—— ⚠ ⚠ **随包分发**'
        + '（在 `package.json` 的 `files` 里、也铺进新工作区）；⚠ **分发的是本项目自己的契约正文，⛔ 不是给别项目复用的模板**'],
      ['.hob/EXPERIENCE.md', '**记录层索引** —— ⚠ **按族分**：其"编号具体值/项目名"两族**豁免**（引自己账本条目的编号是索引本职）；'
        + '"本机路径/第N轮"两族**在辖**（换机必断，且第 148 轮 ① 刚修净 ⇒ 必须留回归守卫）'],
      ['.hob/experience/', '**记录层** —— 历史读数永久不改'],
      ['.hob/backups/', '改前备份（不进 git）'],
      ['.gitignore', '仓库自身配置，不是骨架件'],
    ]
    // ⚠ 既收**目录**也收**单文件**（否则像 `.hob/EXPERIENCE.md` 这样的在辖项会被静默漏掉：
    //   `readdirSync(文件)` 抛异常 ⇒ 被 catch 吞掉 ⇒ 返回空表 ⇒ 该族"核 0 行"却报 ✓）
    const collect = (target) => {
      const abs = join(root, target)
      let st = null
      try { st = statSync(abs) } catch { return [] }
      if (!st.isDirectory()) return /\.(md|html)$/.test(target) ? [abs] : []
      const out = []
      const dig = (d) => {
        let es = []
        try { es = readdirSync(d, { withFileTypes: true }) } catch { return }
        for (const e of es) {
          const p = join(d, e.name)
          if (e.isDirectory()) dig(p)
          else if (/\.(md|html)$/.test(e.name)) out.push(p)
        }
      }
      dig(abs)
      return out
    }
    const files = IN_SCOPE.flatMap(collect)
    if (files.length === 0) {
      bad('断言 B：在辖层（templates/ + roles/）一份文件也读不到（基准缺失 ⇒ 不按通过处理）')
    } else {
      // 在辖判定：`rel`（当前文件）落在该族的哪个在辖前缀下
      const applies = (rel, scopes) => scopes.some((sc) => rel === sc || rel.startsWith(sc + '/'))
      /**
       * ⚠⚠ **命中行打印取组 ①** —— 族 ⑤ 的正则**带一个前导边界字符**
       *   （`(?:^|[^A-Za-z0-9._/-])`，⚠ 否则行首/紧邻反引号的形态会漏配），
       *   ⚠ 故取 `m[1]` 才等于**路径本身**；其余族无捕获组 ⇒ 回落到 `m[0]`。
       *   ⚠ 这是**取值面**的修正（⛔ 不改任何一族的牙口）。
       */
      const hitText = (m) => (m[1] !== undefined ? m[1] : m[0])
      const counts = new Map(FAMILIES.map(([n]) => [n, 0]))
      const checked = new Map(FAMILIES.map(([n]) => [n, 0]))
      const bads = []
      for (const f of files) {
        const rel = relative(root, f).split('\\').join('/')
        readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
          for (const [name, re, isPlaceholder, scopes] of FAMILIES) {
            if (!applies(rel, scopes)) continue   // ⚠ 该族在这份文件上**不在辖**（见上：分族给在辖面）
            checked.set(name, checked.get(name) + 1)
            re.lastIndex = 0
            const ms = [...line.matchAll(re)]
            const real = ms.filter((m) => (isPlaceholder === null ? true : !isPlaceholder.test(m[0])))
            if (real.length === 0) continue
            counts.set(name, counts.get(name) + real.length)
            if (bads.length < 20) {
              bads.push(`${rel}:${i + 1} [${name}] 「${real.map(hitText).join(' / ')}」`)
            } else if (bads.length === 20) {
              bads.push('…（更多略）')
            }
          }
        })
      }
      const total = [...counts.values()].reduce((a, b) => a + b, 0)
      if (total > 0) {
        bad('断言 B · **可分发层含"开箱即错"族**（新项目开箱即错）：'
          + '\n      ' + bads.join('\n      ')
          + '\n      ⇒ templates/ 与 roles/ 是**拿去开箱的两层**：本项目专有编号 / 项目名 / 本机路径 /'
          + '\n        「第 N 轮」/ **指向本项目具体归档·账本件的指针** 在其中出现 ⇒ 新项目开箱即错'
          + '\n      ⇒ 修法：删具体值、把**规则本身**写出来（第 147 轮教训：换一个编号会**造出新的悬空引用**）'
          + '\n      ⇒ 分族覆盖读数（核了多少行）：'
          + FAMILIES.map(([n]) => `${n} 核${checked.get(n)}行`).join(' · '))
      } else {
        ok(`断言 B · 可分发层（templates/ ${collect('.hob/templates').length} 份 + roles/ ${collect('.hob/roles').length} 份`
          + ` + EXPERIENCE.md 索引）**${FAMILIES.length} 族**命中**全 0**；**分族覆盖读数**（核了多少行 / 命中多少）：`
          + FAMILIES.map(([n]) => `${n} 核${checked.get(n)}行/命中0`).join(' · ')
          + `（⚠ 占位号 CHG-000/UD-00 **不计**，见 INIT.md 明文"有意占位"；`
          + `⚠ 族 ⑤「具体归档/账本指针」**只咬具体实例**（日期戳 / 报告号 / 轮次件），`
          + `**放过**占位形状 \`archive/<日期>-<名>/\` 与通用结构卷 \`volumes/plan/INDEX.md\`；`
          + `⚠ ⛔ 它**不**扫 \`.hob/drafts/**\`（那是本项目自己的契约正文，纳入会恒红）；`
          + `⚠ 「命中 0」**不是**"干净"的证据 —— 覆盖读数才是，见上面每族的"核 N 行"）`)
      }
      // ⚠ 豁免面**逐层点名 + 理由**：让"没扫"可见（⛔ 不是静默跳过）
      ok('断言 B · 豁免面（逐层点名，⛔ 未扫但已说明理由）：'
        + EXEMPT.map(([p, why]) => `${p}（${why}）`).join('；'))

      /**
       * ── ⚠ ⚠ **断言 B · 自带样本（第 292 轮新增 · 只针对第 ⑤ 族）** ──────────────
       *   **为什么要**：⚠ ⚠ **"命中 0"不等于"这一族长着牙"** —— ⚠ 一条正则写错（漏配）时
       *     它在**在辖面上照样报"命中 0"**、照样 ✓ ⇒ ⚠ ⚠ **判据改哑与判据改对必须输出不同**
       *     （⚠ `E-126` 口径；⚠ 与断言 `I` / `P` / `Q` 的自带样本同法）。
       *   **自造样本对**（⛔ 与真件内容无关）：⚠ 3 条**该咬**（具体归档指针的两类形态 + 卷内具体编号件）·
       *     ⚠ 4 条**不该咬**（占位形状 / 通用结构卷 / 目录简称 —— ⚠ 它们**正是模板里真实存在的形态**）。
       *   ⚠ **不要求"样本里那两条被判 False"才通过**：⚠ 样本读的是**族 ⑤ 的同一个正则**，
       *     所以它证的是**牙口**（该咬的咬住 / 不该咬的放过），⛔ 不是"真仓干净"。
       */
      {
        const f5 = FAMILIES.find(([n]) => n === '具体归档/账本指针')
        const bite = (line) => {
          f5[1].lastIndex = 0
          const ms = [...line.matchAll(f5[1])]
          return ms.filter((m) => !f5[2].test(m[0])).length
        }
        const SAMPLES_BITE = [
          ['具体归档目录 + 报告号', '⚠ **占位 + 落定后回填** ⇒ `archive/2026-10-15-context-pre-194/REPORT-R177.md`；'],
          ['具体归档目录 + 报告号（另一条）', '⚠ **占位 + 不回填（也合格）** ⇒ `archive/2026-10-15-check-surface/REPORT-R192.md`。'],
          ['卷内具体编号件', '见 `volumes/user-decisions/UD-130.md` 的边界（⚠ 具体条目号 ⇒ 换项目即悬空）'],
        ]
        const SAMPLES_SAFE = [
          ['占位形状（日期/名）', '> 落点：`<账本目录>/archive/<YYYY-MM-DD-slug>/TASK.md`。'],
          ['占位形状（卷 + 编号占位）', '**全文**在 `volumes/user-decisions/<编号>.md` —— 一事一文件。'],
          ['通用结构卷（新项目也有）', '索引 `volumes/plan/INDEX.md`；轮次在 `volumes/context/rounds/<轮次标识>.md`'],
          ['目录简称', '**正文按节**在 `volumes/plan/`（索引 `volumes/plan/INDEX.md`）'],
        ]
        const missed = SAMPLES_BITE.filter(([, l]) => bite(l) === 0).map(([n]) => n)
        const overbit = SAMPLES_SAFE.filter(([, l]) => bite(l) > 0).map(([n]) => n)
        if (f5 === undefined) {
          bad('断言 B · 自带样本：找不到第 ⑤ 族「具体归档/账本指针」（⛔ 不按通过处理）')
        } else if (missed.length > 0 || overbit.length > 0) {
          bad('断言 B · 第 ⑤ 族自带样本**不符合预期**（牙口松了 / 过咬了）：'
            + (missed.length > 0 ? `\n      ⇒ 该咬而**没咬住**：${missed.join(' · ')}` : '')
            + (overbit.length > 0 ? `\n      ⇒ 不该咬而**咬了**：${overbit.join(' · ')}` : '')
            + '\n      ⇒ 修法：照 `REPORT-R224.md` §3.3-d 的（甲）/（乙）之分校 `PTR_RE` / `PLACEHOLDER_PTR`'
            + '（⚠ 族只咬**具体实例**：日期戳 / 报告号 / 卷内编号件）')
        } else {
          ok(`断言 B · 第 ⑤ 族自带样本：**${SAMPLES_BITE.length}** 个"该咬"样本**全部咬住** ·`
            + ` **${SAMPLES_SAFE.length}** 个"不该咬"样本**全部放过**`
            + '（⚠ 它们正是模板里**真实存在**的形态 ⇒ 证的是**牙口**，⛔ 不依赖真件内容）')
        }
      }
    }
  }

  /**
   * ── 断言 C（2026-10-17 第 299 轮）：**类型基准与运行时同代** ─────────────────────
   *
   * ── 为什么需要（缺口有本机实测出处）──────────────────────────────────
   *   第 298 轮上游差异核对（`archive/2026-10-17-upstream-diff/UPSTREAM-REPORT.md` §2.3）实测：
   *     · **宿主运行时**装的是 `0.2.1-rc.2`（`$DSH_HOME/profiles/node_modules/@deepseek-ai/`）；
   *     · **工作区**装的却是 `0.2.0-rc.2`，且 `package.json` **没声明** `@deepseek-ai/dsh-tools`
   *       （而 `src/modules/*.ts` 确实 `import { defineTool } from '@deepseek-ai/dsh-tools'`）
   *       ⇒ `tsc` 解析到**工作区**那份 0.2.0-rc.2，而**跑起来的是** 0.2.1-rc.2。
   *   ⇒ 后果：**`typecheck` 绿不证明对运行时兼容**。上游改一个签名，`tsc` 会继续报绿，
   *     而运行时已断 —— 且 `lib/` 被 gitignore，**`git status` 也看不见**（R-1 / R-2 同族）。
   *   ⚠ 这条与 `check:build`（产物 vs 源）**不重叠**：那条管"src 改了 lib 没跟上"，
   *     本条管"**编译时看到的宿主**与**运行时是同一个宿主**吗"。两条缺口各自独立。
   *
   * ── 判据（⚠ 只比"代"，不比补丁号）──────────────────────────────────
   *   · **代** = 版本串里**第一个 `-` 之前**的部分（`0.2.1-rc.2` ⇒ `0.2.1`；
   *     `0.1.0` ⇒ `0.1.0`）。⚠ 用"代"而不是全等：`rc.2` / `rc.3` 之间签名通常不变，
   *     把它们判红会让本断言**恒红**（恒红判据等于没有判据 —— 见 A 组注释同款告诫）。
   *   · 对拍集合 = **两边都有**的 `@deepseek-ai/*` 包名（⚠ 单边出现**不判**：
   *     工作区不需要装齐宿主那 300 个包；宿主也不装本项目的开发依赖）。
   *   · 不同代 ⇒ **FAIL 并点名包**（包名 + 两边版本），逐包一行。
   *   · ⚠ **覆盖面必须 > 0**：两边一份都对不上 ⇒ **不按通过处理**（`E-126` 口径：
   *     不许"扫 0 份报 ✓"）。
   *
   * ── 运行时的位置（⚠ 不硬编码本机绝对路径，UD-73③）──────────────────
   *   `$DSH_HOME/profiles/node_modules/@deepseek-ai`，`DSH_HOME` 缺省 `~/.dsh`。
   *   ⚠ 解析不到 ⇒ **如实报"未执行、不代表通过"**（与断言 A 的账本区同款口径），
   *   ⛔ 不按 PASS、也不假装 FAIL —— 那是"没测到"，不是"测到了且不对"。
   *
   * ── 负向对拍（⚠ ⛔ 缺这条就等于没写）────────────────────────────────
   *   ⚠ `E-27`：**每条断言都必须能失败**。上式写错（例如恒取同一边、或比错了字段）
   *   会让它**永远绿**，而绿的样子跟"真的同代"**一模一样**。
   *   ⇒ 本条末尾用**同一份比较器**跑一组人造输入：把某个已知包故意改成旧代，
   *     **必须**报出那一个包；全都同代 ⇒ **必须**零告警。
   *   ⚠ 比较器只写**一份**（`diffGenerations`），断言与自证共用它 ——
   *     若各抄一份，改坏断言那份后自证仍用完好副本 ⇒ 双向失效（本脚本 §5 与
   *     `check-client-deps` I 组的同款教训）。
   */
  {
    /** 版本串的"代"：第一个 `-` 之前。`0.2.1-rc.2` ⇒ `0.2.1`。 */
    const generationOf = (v) => String(v).split('-')[0]

    /**
     * 对拍两份 `包名 ⇒ 版本` 表，返回**不同代**的条目。
     * ⚠ 断言与负向自证**共用这一份**（见上方"负向对拍"）。
     * @param workspace - 工作区实装版本表。
     * @param runtime - 宿主运行时实装版本表。
     * @returns `[{ name, ws, rt }]`，按包名排序；空数组 = 全部同代。
     */
    const diffGenerations = (workspace, runtime) => {
      const out = []
      for (const name of Object.keys(workspace).sort()) {
        if (!(name in runtime)) continue // 单边出现 ⇒ 不判（见判据）
        const ws = workspace[name]
        const rt = runtime[name]
        if (generationOf(ws) !== generationOf(rt)) out.push({ name, ws, rt })
      }
      return out
    }

    /** 读一个 `@deepseek-ai` 目录下的 `包名 ⇒ 版本` 表（只看顶层直接包）。 */
    const readScopeVersions = (dir) => {
      const table = {}
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        // ⚠ 符号链接也要算（profile 里 link: 进来的包是 dir 但有的宿主用 symlink）
        if (!d.isDirectory() && !d.isSymbolicLink()) continue
        const pj = join(dir, d.name, 'package.json')
        try {
          const v = JSON.parse(readFileSync(pj, 'utf8')).version
          if (typeof v === 'string' && v !== '') table[d.name] = v
        } catch { /* 包缺 package.json ⇒ 跳过（不是本断言的判据面） */ }
      }
      return table
    }

    const WS_SCOPE = join(root, 'node_modules', '@deepseek-ai')
    const dshHome = process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh')
    const RT_SCOPE = join(dshHome, 'profiles', 'node_modules', '@deepseek-ai')

    // ── 负向对拍（先跑：它不依赖本机实际装了什么）────────────────────────
    {
      const selfFail = []
      const ws = { 'pkg-alpha': '0.2.0-rc.2', 'pkg-beta': '0.2.1-rc.2', 'pkg-gamma': '0.2.1-rc.2' }
      const rt = { 'pkg-alpha': '0.2.1-rc.2', 'pkg-beta': '0.2.1-rc.2', 'pkg-gamma': '0.2.1-rc.2' }
      const hit = diffGenerations(ws, rt)
      // ① 该咬：只有 pkg-alpha 不同代 ⇒ 必须**恰好**报它一个
      if (hit.length !== 1 || hit[0].name !== 'pkg-alpha') {
        selfFail.push(`不同代时没咬住（期望只报 pkg-alpha，实测 ${JSON.stringify(hit.map((x) => x.name))}）`)
      }
      // ② 不该咬：**全都同代**（仅补丁号不同）⇒ 必须零告警（防"恒红"那一侧）
      //   ⚠ 两句都要**同代**：`0.2.1-rc.2` ⇄ `0.2.1-rc.3` 属同一代 ⇒ 报出来就是口径写错。
      if (diffGenerations({ 'pkg-a': '0.2.1-rc.2' }, { 'pkg-a': '0.2.1-rc.3' }).length !== 0) {
        selfFail.push('同代但补丁号不同时误报了（"代"的口径写错 ⇒ 本断言会恒红）')
      }
      // ③ 单边不判：只在工作区出现的包不许报
      if (diffGenerations({ ...ws, 'only-ws': '9.9.9' }, rt).length !== 1) {
        selfFail.push('单边出现的包被算进去了（宿主不装本项目开发依赖 ⇒ 会误报）')
      }
      if (selfFail.length > 0) {
        bad(`断言 C · 负向对拍失败（判据牙口不对，⛔ 本断言不成立）：${selfFail.join(' / ')}`)
      } else {
        ok('断言 C · 负向对拍：不同代**咬住**（故意把 1 个包改成旧代 ⇒ 恰好报出它）· '
          + '同代不误报（补丁号不同不报）· 单边出现不报（3 项双向对拍）')
      }
    }

    // ── 正向：读两边实况并对拍 ──────────────────────────────────────────
    let wsTable = undefined
    let rtTable = undefined
    try {
      if (existsSync(WS_SCOPE)) wsTable = readScopeVersions(WS_SCOPE)
    } catch { wsTable = undefined }
    try {
      if (existsSync(RT_SCOPE)) rtTable = readScopeVersions(RT_SCOPE)
    } catch { rtTable = undefined }

    if (wsTable === undefined || Object.keys(wsTable).length === 0) {
      bad('断言 C · 工作区 `node_modules/@deepseek-ai` 读不到任何包（基准缺失 ⇒ 不按通过处理）')
    } else if (rtTable === undefined || Object.keys(rtTable).length === 0) {
      // ⚠ "没测到"≠"测到了且不对"：如实报未执行，⛔ 不混进 PASS 也不假装 FAIL
      ok(`断言 C · **未执行、不代表通过**（宿主运行时目录解析不到：\`${RT_SCOPE}\`；`
        + '⚠ 换台机器/换 profile 时可能如此 —— 这条要的是"至少一边基准缺失就说清"，⛔ 不是绿灯）')
    } else {
      const compared = Object.keys(wsTable).filter((n) => n in rtTable)
      const diffs = diffGenerations(wsTable, rtTable)
      if (compared.length === 0) {
        bad('断言 C · 工作区与宿主运行时**一个 `@deepseek-ai/*` 包都没对上**（覆盖面无 ⇒ 不按通过处理）')
      } else if (diffs.length > 0) {
        bad(`断言 C · **类型基准与运行时不同代**（${diffs.length} / ${compared.length} 个包）：`
          + diffs.map((d) => `\n      · ${d.name}：工作区 ${d.ws} ≠ 运行时 ${d.rt}`).join('')
          + '\n      ⇒ 后果：`typecheck` 判的是工作区那份、**跑的是运行时那份** ⇒'
          + '\n         `typecheck` 绿**不证明**运行时兼容（`UPSTREAM-REPORT.md` §2.3）'
          + '\n      ⇒ 修法：按运行时同代升齐工作区 `devDependencies` 并显式声明 `src/**` 直接 import 的包')
      } else {
        ok(`断言 C · 类型基准与运行时同代：核了 **${compared.length}** 个 \`@deepseek-ai/*\` 包`
          + `（工作区 ⇄ \`${RT_SCOPE}\`），**逐包同代**、零告警`
          + `（⚠ 工作区共 ${Object.keys(wsTable).length} 个、运行时共 ${Object.keys(rtTable).length} 个，`
          + '取**交集**对拍；单边出现不判）')
      }
    }
  }

  return { mustTrack, mustExclude, README, readmeSrc, PKG }
}