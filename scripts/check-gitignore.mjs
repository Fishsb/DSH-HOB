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
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
  ['.hob/templates/FACTS.md', '骨架 · 空模板（README §1 + §2）'],
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
  // ⚠ **v4（2026-10-08）**：账本数据已迁出工作区（→ `/home/lk/FF/.hob-ledgers/<工作区名>/`），
  //   故下面这些路径**在本仓库里已不存在**。
  //   ⇒ 保留断言的意义变成**防回迁**：若有人把账本数据搬回 `.hob/`，
  //     本组立刻 FAIL（`git check-ignore` 会对已入库路径返回未忽略）。
  //   ⚠ 这是**改判据以跟随现状**，不是放宽 —— 断言条数不减，方向从
  //     "数据必须被排除" 变成 "数据既不在库、也不被意外放行"。
  ['.hob/FACTS.md', '运行数据 · 账本（**v4 已迁出**，此断言防回迁）'],
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
