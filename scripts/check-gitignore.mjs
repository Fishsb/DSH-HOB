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
 * ⚠ 零第三方依赖（本仓纪律）。
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
  const D_REF_RE = /archive\/\d{4}-\d{2}-\d{2}-[a-z0-9-]+\/[A-Za-z0-9._/-]*/g
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
