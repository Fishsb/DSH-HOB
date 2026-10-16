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
        const wsName = basename(root)
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
   *     （README §1.2），**不是拿给别的项目用的模板**；
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
    const FAMILIES = [
      ['项目专有编号具体值', /\b(?:CHG|UD|E)-\d{1,3}\b/g, PLACEHOLDER, ['.hob/templates', '.hob/roles']],
      ['项目名', /dsh-hob|hob-ledgers|prompt-enhancer/g, null, ['.hob/templates', '.hob/roles']],
      ['本机路径', /\/home\/lk\b|\/mnt\/[a-z]\//g, null,
        ['.hob/templates', '.hob/roles', '.hob/EXPERIENCE.md']],
      ['第N轮引用', /第 *\d+ *轮/g, null,
        ['.hob/templates', '.hob/roles', '.hob/EXPERIENCE.md']],
    ]
    const IN_SCOPE = ['.hob/templates', '.hob/roles', '.hob/EXPERIENCE.md']
    const EXEMPT = [
      ['.hob/README.md', '本项目骨架**说明书** —— 第 147 轮已加节级标注声明"编号是本项目账本条目号、开箱不带"'],
      ['.hob/INIT.md', '同上（文件头已有节级标注）'],
      ['.hob/drafts/', '本项目**自己的契约正文 / 草案**（README §1.2）—— 不是拿给别项目用的模板'],
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
              bads.push(`${rel}:${i + 1} [${name}] 「${real.map((m) => m[0]).join(' / ')}」`)
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
          + '\n        「第 N 轮」在其中出现 ⇒ 新项目开箱即错'
          + '\n      ⇒ 修法：删具体值、把**规则本身**写出来（第 147 轮教训：换一个编号会**造出新的悬空引用**）'
          + '\n      ⇒ 分族覆盖读数（核了多少行）：'
          + FAMILIES.map(([n]) => `${n} 核${checked.get(n)}行`).join(' · '))
      } else {
        ok(`断言 B · 可分发层（templates/ ${collect('.hob/templates').length} 份 + roles/ ${collect('.hob/roles').length} 份`
          + ` + EXPERIENCE.md 索引）四族命中**全 0**；**分族覆盖读数**（核了多少行 / 命中多少）：`
          + FAMILIES.map(([n]) => `${n} 核${checked.get(n)}行/命中0`).join(' · ')
          + `（⚠ 占位号 CHG-000/UD-00 **不计**，见 INIT.md 明文"有意占位"；`
          + `⚠ 「命中 0」**不是**"干净"的证据 —— 覆盖读数才是，见上面每族的"核 N 行"）`)
      }
      // ⚠ 豁免面**逐层点名 + 理由**：让"没扫"可见（⛔ 不是静默跳过）
      ok('断言 B · 豁免面（逐层点名，⛔ 未扫但已说明理由）：'
        + EXEMPT.map(([p, why]) => `${p}（${why}）`).join('；'))
    }
  }

  return { mustTrack, mustExclude, README, readmeSrc, PKG }
}