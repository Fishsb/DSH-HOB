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
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
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
 * ⚠ 为什么 `PROJECT.md` **不在 A 里**（第 20 轮实测，非疏漏）：
 *   账本区 `templates/` 下**没有** `PROJECT.md` 空模板（`ls .hob/templates/` = 7 份：
 *   `DECISIONS` / `USER-DECISIONS` / `CONTEXT` / `ROLES` / `GATES` / `TASK` / `REPORT`）。
 *   方案是**逐项目唯一**的整篇文档，与三本账本"同构空模板 + 每项目填条目"的形态不同
 *   ⇒ 现状**无模板可比**。若把 `PROJECT.md` 塞进 A 的循环，A 会立刻报
 *   「模板读不到 … 不按通过处理」⇒ FAIL（实测读数见本轮回报）。
 *   ⚠ 而"不许为了让检查通过而放宽断言"是本项目红线 ⇒ 正确做法是
 *   **A 只覆盖有模板的三本**（判定逻辑一字未改），**B 覆盖全部四份正本**。
 *   ⇒ 把 `PROJECT.md` 纳入 A 的**前置条件**是账本区先出现配套模板（归 Hob/用户），
 *     已登记为待决问题，不在本轮擅自新建（`.hob/templates/**` 是本轮红线）。
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
