/**
 * 仓库规则机检（族 ①）—— 入库 / 排除 / 骨架覆盖 / 脚本落点**双向**自检。
 *
 * ⚠ 2026-10-11（第 60 轮）从 `check-gitignore.mjs` 拆分而来（用户拍板「① 拆分那个检查脚本」）。
 *   只管**本仓库自己**：`.gitignore` 两栏清单 · README §1 骨架栏覆盖 ·
 *   `package.json` 的 `scripts` ↔ `scripts/*.mjs` 落点的正反两向。
 *   入口仍是 `scripts/check-gitignore.mjs`（`npm run check:gitignore`）。
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

  return { mustTrack, mustExclude, README, readmeSrc, PKG }
}