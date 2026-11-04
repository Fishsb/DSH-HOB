/**
 * `.gitignore` 一致性核对 · dsh-hob —— **入口（薄调度）**。
 *
 * ⚠ 2026-10-11 第 60 轮拆分（用户拍板「① 拆分那个检查脚本」）：本文件由 1726 行的单体
 *   改为薄调度，判据按族搬进三个模块 ——
 *     · `check-repo-rules.mjs`  族 ① 入库 / 排除 / 骨架覆盖 / 脚本落点双向自检
 *     · `check-doc-shape.mjs`   族 ② 四份正本形态 A / B / J / C / D / D′ / E / I
 *     · `check-code-face.mjs`   族 ③ 静态面 K / F / G / H
 *   ⛔ **判据一条未改**（纯搬运）；⚠ 入口名与 `npm run check:gitignore` **保持不变**
 *     —— 它被 `.hob/README.md` §1.4/§5.1 与断言 F 的登记表指着。
 *
 * ⚠ 累计顺序**必须**与拆分前逐行一致（判定行的两个计数也来自本文件累计的清单）。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, sep } from 'node:path'
import { dirname, join as pjoin } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runRepoRules } from './check-repo-rules.mjs'
import { findDuplicateSectionHeadings, ledgerRootDiag, runDocShape, runLedgerCure, runRequirementPurity, runResidualMarkers, runTableIntegrity } from './check-doc-shape.mjs'
import { runDiscipline, runPlanModuleParity, runReadWhitelist, runRender, runRequirementsRoot, runSameSource, runSkeletonSource, runWorkspaceNameSource, runWriteScope, runZeroWidth } from './check-code-face.mjs'

/** ⚠ 本仓工作区根（从本文件位置现算，⛔ 不硬编码本机路径 —— `UD-73③`）。 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const fail = []
const note = []
/**
 * ⚠⚠ **第三档：没有对象**（2026-10-21 · 第 331 轮 · **乙-5**）——
 *   ⚠ 本族三档：`fail` ⇒ `exit 1` · `noObject` ⇒ `exit 2` · 两者皆空 ⇒ `exit 0`。
 *   ⚠ **⛔ 不许把 `noObject` 塞进 `fail`**：那会把"没有对象"洗成"查了不过"（红线 2 的反向）。
 *   ⚠ **⛔ 也不许塞进 `note`**：`note` 就是 `ok()`，塞进去等于把"没查"记成"查过且过"。
 */
const noObject = []
const noteNoObject = (m) => noObject.push(m)
/**
 * ── ⚠⚠ **第三态 `skip`：跳过 ≠ 通过**（2026-10-21 · 第 349 轮 · 甲-1 甲方案）──────
 *
 * ⚠ 它与上面两档的关系（⛔ 不许含糊）：
 *   · `fail`     ⇒ 查了、且查到违规              ⇒ `exit 1`
 *   · `noObject` ⇒ **整族**没有对象、一条判据都没跑 ⇒ `exit 2`
 *   · **`skip`** ⇒ **本族查了**，但**其中几处没对象** ⇒ **不退 2**，只单列 + 计数
 *
 * ⚠ **为什么 `skip` 不是 `noObject`**（这正是甲方案的理由）：
 *   把"某处跳过"升成 `exit 2` ⇒ 任何一台缺对象的机器上**整族退 2**，
 *   于是"查了 200 处只跳 3 处"与"一条都没跑"变成**同一个退出码** ⇒
 *   和"这一族真的查了"混为一谈，正是本项目最忌的"两种原因说成同一句话"。
 *   ⇒ 甲方案让跳过**有自己的计数**，`exit` 仍由 `fail`/`noObject` 决定。
 *
 * ⚠ **⛔ 不许把 skip 塞进 `note`**（那就是改前的老毛病：跳过也打 ✓、还进了"通过"的数）。
 */
const skip = []
const noteSkip = (m) => skip.push(m)
const bad = (m) => fail.push(m)
const ok = (m) => note.push(m)
/**
 * ── ⚠⚠ **第四档：报警明细（只报不拦）**（2026-10-25 · 账本根治第一批）──────────
 *
 * ⚠ 它与前三档的关系（⛔ 不许含糊）：
 *   · `fail`      ⇒ 查了、且查到违规 ⇒ `exit 1` · **计入「没过」**
 *   · `noObject`  ⇒ **整族**没有对象 ⇒ `exit 2`
 *   · `skip`      ⇒ 本组某处没对象 ⇒ 只计数
 *   · **`alarm`** ⇒ **查到了，但这一批（第一批）有意不拦** ⇒ **⛔ 不进退出码 · ⛔ 不进「查了」**
 *
 * ⚠ **为什么要有这一档**（而不是直接 `bad()`）：账本根治第一批的边界是「**先量清存量**」——
 *   存量没清就转拦 ⇒ 第一天全库红 ⇒ **恒红的判据等于没有判据**
 *   （`check-build-sync.mjs` 头注那三条是同一个理由）。
 * ⚠ **⛔ 不许把 `alarm` 塞进 `note`**：`note` 就是 `ok()` = "查过且过"；
 *   存量违规不是"过"，它是"**查到了、暂不拦**"。
 * ⚠ **⛔ 也不许进「查了」计数**：存量清掉后计数会跟着变小 ⇒ 那族的
 *   `ASSERTION_FLOORS` 下界就被存量牵着漂（**E-117**：会自己漂的数 ⛔ 不许当下界）。
 *   进计数的只有每组**固定的汇总行**，它的条数与存量多少无关。
 */
const alarm = []
const noteAlarm = (m) => alarm.push(m)

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

/**
 * ══════════════════════════════════════════════════════════════════════════
 * ⚠⚠ **前置闸门：账本根读不到 ⇒ `exit 2`**（2026-10-21 · 第 324 轮 · **甲-1 试点**）
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── 它堵的是哪一档（`PROJECT-SURVEY-3` §6.1 甲-1，本项目**最广**的一处假绿）──────
 *   本族 32 组里所有"跳过 / 未执行 / 未取"分支都走 `ok()`，而 `ok()` **无条件打 `✓`
 *   且不进 `fail` 计数** ⇒ 账本区读不到时，`check:all` 把那几组记成 **`✓ 通过`**。
 *   ⚠ **实测原文（第 324 轮 · 改前，把工作区名指向不存在的目录）**：
 *     `✓ 文档形态机检【跳过】—— 账本区读不到…不代表通过`
 *     `✓ I 正本无残留标记【跳过】—— 账本区读不到…**不代表通过**`
 *   ⇒ ⚠ **嘴上说"不代表通过"，机器读数却是 ✓** —— 读数与判据互相打架，而**机器只信 ✓**。
 *
 * ── 为什么落 `exit 2` 而⛔ 不是 `exit 1`、也⛔ 不是一条 `bad()` ────────────
 *   ① **不是 1**：`exit 1` 的语义在本族是"**查了，且查到违规**"。账本根读不到时，
 *      A / B / C / I / Q / P 那几组**一条判据都没跑** ⇒ 说"查了不过"是谎报
 *      （同 `check:readings` / `check:rounds` 既有的"未执行 ⇒ 2"那一档）。
 *   ② **不是 `bad()`**：`bad()` 会让**其余 31 组**继续跑完再报 FAIL，而它们的基准
 *      （正本清单、表块、写侧白名单）全都派生自账本根 ⇒ 那 31 组会**各自再报一次
 *      "失去基准"**，把一句真话淹没在几十行噪声里。前置闸门的价值就在于**只报一句**。
 *   ③ **不是"读不到就跳过"**（旧路径）：那正是本批要治的形态，⛔ 不许留。
 *
 * ── 为什么闸门放在**入口**而不在 `check-doc-shape.mjs` 里 `process.exit` ────────
 *   `check-doc-shape.mjs` 被 import 做断言（`--dup-headings` 与单测）⇒ 那里 `exit`
 *   会把"只想验一个函数"的调用方一起打死。⇒ 闸门**只设一处**：本入口。
 *
 * ── ⚠ 本批的**边界**（TASK ① 明令）────────────────────────────────
 *   **只堵这一档**。其余 31 组"跳过也打 ✓"的分支走向**一字未动**
 *   （那是 Q1 选项 ①，改动面大、另开轮）—— 清单见本批 REPORT ②。
 */
if (ledgerRootDiag.kind !== 'ok') {
  const KIND_TEXT = {
    'preset-unreadable': '**预设行读不到**（连候选路径都没有）',
    'no-ledger-home': '**预设里没有 `ledgerHome:` 声明**',
    absent: '**账本根目录读不到**',
  }
  console.log('`.gitignore` 一致性核对 · dsh-hob')
  console.log('')
  console.log(`判定：**未执行** —— ${KIND_TEXT[ledgerRootDiag.kind] ?? '账本根解析失败'}`
    + ' ⇒ 本族**一条判据都没跑**（退出码 2 与 FAIL(1) 有意区分）。')
  console.log(`  ✗ 读不到的路径：\`${String(ledgerRootDiag.path ?? '(算不出来)')}\``)
  console.log(`  ✗ 原因：${ledgerRootDiag.reason}`)
  if (ledgerRootDiag.wsName !== undefined) {
    console.log(`      ⇒ 工作区名 = \`${ledgerRootDiag.wsName}\`（来源：`
      + '`dsh-hob.workspace.json` 的 `workspaceName`；未配置则落回目录名）')
  }
  console.log('      ⇒ ⚠ 改前这一档**不会**退出 2：全族继续跑，其中若干组各打一条'
    + '`ok(\'…【跳过】…不代表通过\')` —— ⚠ **带 ✓、不进 `fail`** ⇒ `check:all` 记成「✓ 通过」。')
  console.log('      ⇒ 修法：确认预设行的 `ledgerHome` 可读、且'
    + ' `‹ledgerHome›/‹工作区名›` 存在；或先用 `node scripts/check-gitignore.mjs --dup-headings <file>`'
    + ' 走单测口径（那条不吃账本根）。')
  process.exit(2)
}

// ── ① 入库与仓规（带回 README / PKG 两处共享读数）───────────────────────
const { mustTrack, mustExclude, README, readmeSrc, PKG } = runRepoRules({ bad, ok, skip: noteSkip })

// ── ③ L-177：源码目录不得被整目录忽略吞掉（`E-177`）────────────────────
runSourceNotSwallowed({ bad, ok })

/**
 * ── ③ L-177：**源码目录不得被"整目录忽略"吞掉**（2026-10-31 P24 · `E-177`）──────────
 *
 * ⚠⚠ **它治的病（真实发生过，不是假想）**：
 *   `.gitignore` 里一行 **未锚根** 的 `lib/` ⇒ 匹配**任意层级**的 `lib/`
 *   ⇒ 把 `scripts/lib/ledger-root.mjs`（**113 行手写源码**，13 个判据脚本 import 它）
 *     一起吞了 ⇒ **从未入库**，而**本地永远绿**（文件在盘上、`git status` 不显示被忽略项）。
 *   爆点：**别人克隆本仓跑 `check:all` ⇒ `ERR_MODULE_NOT_FOUND`**，13 个族同时崩。
 *
 * ── 口径（⚠ 只查 `scripts/lib/`，**不是**全仓扫描 —— 见下方"为什么不做更强版"）──
 *   对 `scripts/lib/` 下**每一个 `.mjs`**：`git ls-files --error-unmatch <path>` 必须成功。
 *   ⚠ 失败 ⇒ 红，**并指名是哪个文件**（⛔ 只说"有文件没入库"没用，得让人知道去 add 哪个）。
 *
 * ── ⚠ 为什么不做更强版（"所有被忽略目录里的源码都该查"）──────────────
 *   实测：`git ls-files --others --ignored --exclude-standard -- src scripts kit preset` = **0 条**
 *   ⇒ 今天做强版**一条对象都没有**（空判据 = 恒绿 = 反而更危险，见 `E-27`）。
 *   ⚠ 而"全仓扫描"要先把 `lib/`（3.5 M 编译产物）、`node_modules/`（3943 条）、
 *     `.dsh-worktrees/`（110 M）全部排除掉才能跑 —— 那份排除表**本身就是新的漂移源**。
 *   ⇒ **只做 `scripts/lib/`**：它是**唯一**一个"手写源码放进名叫 lib 的目录"的地方，
 *     也正是这次真出事的地方。⚠ 判不出的部分⛔ 不假装判得出。
 */
function runSourceNotSwallowed({ bad, ok }) {
  const dir = 'scripts/lib'
  const abs = pjoin(root, dir)
  let names = []
  try {
    names = readdirSync(abs).filter((n) => n.endsWith('.mjs')).sort()
  } catch {
    // ⚠ 目录不存在 ⇒ 没有对象可查。⛔ 不许记 ✓（"没查到"与"查过且通过"是两件事）
    bad(`L-177 · 源码目录 \`${dir}/\` 读不到 ⇒ 本条失去对象（⛔ 不按通过处理）`)
    return
  }
  if (names.length === 0) {
    bad(`L · \`${dir}/\` 下**一个 .mjs 都没有** ⇒ 本条没有对象可查（⛔ 不按通过处理）`)
    return
  }
  const missing = []
  for (const n of names) {
    const rel = `${dir}/${n}`
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', '--', rel], { cwd: root, stdio: 'pipe' })
    } catch {
      missing.push(rel)
    }
  }
  if (missing.length > 0) {
    /**
     * ⚠ 红的时候要能**直接照做**：指名文件 + 告诉它可能被哪条规则挡了。
     *   `git check-ignore -v` 的输出正是"哪一行规则干的" —— 直接带出来。
     */
    const why = missing.map((rel) => {
      let rule = '（未被任何规则命中 ⇒ 只是忘了 add）'
      try {
        rule = execFileSync('git', ['check-ignore', '-v', '--', rel], { cwd: root, stdio: 'pipe' }).toString().trim()
      } catch { /* 没被忽略 ⇒ 保持上面那句 */ }
      return `      · \`${rel}\` —— ${rule}`
    }).join('\n')
    bad(`L-177 **源码被"整目录忽略"吞掉了**：\`${dir}/\` 下 ${missing.length}/${names.length} 个 .mjs **不在库里**`
      + `\n${why}`
      + '\n      ⇒ 这正是 `E-177`：未锚根的 `lib/` 会匹配**任意层级**的 `lib/`'
      + '\n      ⇒ 修法：把规则改成锚根（`/lib/`），然后逐路径 `git add` 那个文件'
      + '\n      ⇒ ⚠ 后果不是"少一个文件"：这些是判据脚本的**共享源码**，别人克隆后 `check:all` 会 `ERR_MODULE_NOT_FOUND`')
  } else {
    ok(`L-177 ✓ \`${dir}/\` 下 ${names.length} 个 .mjs **全部在库里**`
      + `（${names.join(' · ')}）⇒ 未锚根规则吞源码这件事会被当场咬住（\`E-177\`）`)
  }
}

// ── ③ K：同源判据的字面量必须逐字相同 ───────────────────────────────────
runSameSource({ bad, ok })

// ── ③ S：工作区名口径只有一套（运行时侧 ↔ 判据侧逐字相同）─────────────────
//   ⚠ 2026-10-18（第四张隔离卡收口 · UD-143 裁定二）：⚠ **判据修好、运行时没修**
//     会让"判据报绿、运行时却把账本区认到别处"—— 两侧各自看起来都对，合起来是错的。
//     ⇒ 把"照抄"从人守变成机检（与 K 同族：K 管归档/作业书正则，S 管工作区名）。
runWorkspaceNameSource({ bad, ok })

// ── ② 四份正本形态机检 A / B / J / C / D / D′ / E ──────────────────────
runDocShape({ bad, ok, noObject: noteNoObject, skip: noteSkip })

/**
 * ── ② X / Y / Z：账本根治第一批（2026-10-25 · **只报不拦**）───────────────────
 *
 * ⚠ 作业书 = `archive/2026-10-25-ledger-cure/TASK.md`。三组的判据体在
 *   `check-doc-shape.mjs` 的 `runLedgerCure()`（与既有形态族同一族、同一入口，
 *   ⛔ **不新增 `check:` 命令** —— 那会牵动 `package.json` / 正本收尾表 / 族数下界三处联动）。
 * ⚠ **一律只报不拦**：报警明细走 `noteAlarm`（`⚠` 前缀、单列输出、**不进 `fail`**、
 *   **不进「查了」**）⇒ 第一批只量存量，退出码一个字节都不动。
 */
runLedgerCure({ ok, bad, alarm: noteAlarm, skip: noteSkip })

// ── ③ F / G / H ────────────────────────────────────────────────────────
runDiscipline({ bad, ok, readmeSrc, PKG })
runZeroWidth({ bad, ok })
await runRender({ bad, ok })

// ── ② I：正本无残留标记（需 await 载入渲染器）──────────────────────────
await runResidualMarkers({ bad, ok })

// ── ③ Q：卷下两层子目录的写侧白名单（成对 + 强制登记）──────────────
await runWriteScope({ bad, ok })

// ══════════════════════════════════════════════════════════════════════
// M-1 · **元规则**：每条判据都必须自带一条负向对拍（2026-10-30 P6 · 任务书 §二）
// ══════════════════════════════════════════════════════════════════════
/**
 * 为什么放在本入口：`check:gitignore` 是**所有"抄写类"判据**的收口处，
 * 而元规则与它们同类（它守的不是产品行为，是"判据本身有没有牙"）。
 *
 * ⚠ 口径见 `scripts/check-meta-negctl.mjs` 头注释（只数 `ok`/`bad` 的字面量，沿 import 闭包累加）。
 * ⚠ 登记表：`scripts/meta-negative-floor.json`（每族下限，**只准升不准降**）。
 * ⚠⚠ **M-1 自己也有负向对拍**（见下方 N-M1）：把某族的来源换成"负向对拍 0 条"的文本 ⇒ 必须红。
 */
{
  const { runNegativeCoverage, measureFamilies, compareFloors, familiesFromPkg } = await import('./check-meta-negctl.mjs')
  const { measured, floor } = runNegativeCoverage({ bad, ok })

  // ── M-1b 弱版：每族至少一条对拍写了「先自证」（⚠ 只把"退步"判红，见 runSelfProof 头注释）──
  {
    const { runSelfProof } = await import('./check-meta-negctl.mjs')
    runSelfProof({ bad, ok, measured })

    /**
     * **N-M1b 负向对拍（自指）**：把某族的「先自证」标记清空 ⇒ M-1b 的"退步"必须红。
     * ⚠ 先自证夹具坏掉：断言替换后该族读数真的变 0（不是"以为改了"）。
     */
    const target = 'check:ledger'
    const fs = await import('node:fs')
    const srcPath = `scripts/${target.replace('check:', '').replace(/-/g, '-')}.mjs`
    const realFile = new URL('./check-ledger.mjs', import.meta.url).pathname
    let real = ''
    try { real = fs.readFileSync(realFile, 'utf8') } catch { real = '' }
    const stripped = real.replace(/先自证/g, 'XX')
    const reallyZero = real !== '' && (stripped.match(/先自证/g) ?? []).length === 0
    if (!reallyZero) {
      bad(`N-M1b · 负向对拍夹具没造出来（${realFile} 里找不到「先自证」或替换无效）⇒ 本条不可判`)
    } else {
      const { measureSelfProof } = await import('./check-meta-negctl.mjs')
      const replaced = 'XX'
      const replacedValid = !replaced.includes('先自证')
      const probe = measureSelfProof(
        { [target]: { count: 1 } },
        () => ['check-ledger.mjs'],
        () => stripped,
        replacedValid ? { 'check-ledger.mjs': replaced } : {},
      )
      const hit = probe.problems.find((x) => x.includes(target))
      if (hit !== undefined) {
        ok(`N-M1b ✓ 负向对拍（把 ${target} 的「先自证」标记清空 ⇒ 实测 0）⇒ M-1b 的"该族无可信度标记"**必红**`)
      } else {
        bad('N-M1b · 清空标记后 M-1b 没报 ⇒ 它没在数实测')
      }
    }
    void srcPath
  }

  // —— N-M1 负向对拍（⚠ 自指：先自证夹具真的把计数压到 0，再断言它红）——
  {
    /**
     * ⚠ 只改**一个族**的读数（`check:ledger`，它的对拍标签数最多、最好辨认）。
     *   把它的入口源换成"一条负向对拍都没有"的文本 ⇒ 实测计数变 0 ⇒ 必须 < 下限。
     * ⚠ 绝不落盘（只在内存里换字符串）。
     */
    const fams = familiesFromPkg()
    const target = 'check:ledger'
    if (fams[target] === undefined) {
      bad('N-M1 · 找不到 `check:ledger` 这个族 ⇒ 元规则的负向对拍失去对象（不按通过处理）')
    } else {
      const entryFile = fams[target].replace(/^scripts\//, '')
      const fakeSrc = '// 夹具：把所有 ok/bad 的「负向对拍」字样删掉\nok(`L 组全绿`)\n'
      const m2 = measureFamilies({ [target]: fams[target] }, { [entryFile]: fakeSrc })
      // ⚠ **先自证夹具真坏掉**：那次读数必须是 0
      const reallyZero = m2[target] !== undefined && m2[target].count === 0
      const probs = compareFloors({ [target]: m2[target] }, floor)
      if (!reallyZero) {
        bad(`N-M1 · 夹具没真的把计数压到 0（实测 ${m2[target]?.count}）⇒ 这条自指对拍不可判`)
      } else if (probs.length > 0) {
        ok(`N-M1 ✓ 负向对拍（把 ${target} 的对拍标签清空 ⇒ 实测 0 < 下限 ${floor[target]}）⇒ **M-1 必红**：${probs[0].slice(0, 90)}`)
      } else {
        bad('N-M1 · 把某族对拍清空后 M-1 仍通过 ⇒ 它数的是登记表、不是实测（元规则没有牙）')
      }
    }
    void measured
  }
}

// ── ③ T：现行需求根的迁移面（新根可写 / 旧根拒写且理由分得开 / 旧根仍可读）──
await runRequirementsRoot({ bad, ok })

// ── ③ Y：账本读白名单（`.md` + `.toml`）—— 正向逐字节 + 三条负向 ─────────
//   ⚠ 2026-11-02 · `CHG-2035` 轨 A：当时 `units/index.toml` 是唯一状态源；
//     2026-11-03 起状态源是 `units/`（入口 + 固定分片），
//     而读侧此前只认 `.md` ⇒ 能写读不到 ⇒ 改索引是盲写（历史上盲写丢过 6417 字节）。
await runReadWhitelist({ bad, ok })

// ── ③ W：方案 §3 的模块清单 ↔ `src/modules/` 实际文件（虚列即红）──
runPlanModuleParity({ bad, ok })

// ── ② U：需求面只记「用户要什么」（日期 / 工具名 / reason / 变更号 / 过程词一律不许进）──
runRequirementPurity({ bad, ok, skip: noteSkip })

// ── ② P：表结构完整性（表内重复行 / 分隔行在位）────────────────────────
runTableIntegrity({ bad, ok })

// ── ③ R：骨架同源（仓库 `.hob/**` ↔ 派生物 `skeleton-manifest.ts`）──────
//   ⚠ 2026-10-16 第 224 轮 · `UD-118`「C」· 约束 ⑤：⚠ **唯一来源 = 仓库**，
//     随包出去的那份是**派生物** ⇒ ⚠ **两份会各自漂** ⇒ 本条盯它。
//   ⚠ ⚠ **提取不到即 FAIL**（E-130 / E-131），⛔ 不许静默通过。
runSkeletonSource({ bad, ok })

// ── 输出 ────────────────────────────────────────────────────────────────
console.log('`.gitignore` 一致性核对 · dsh-hob')
console.log('约定归属地:', README)
console.log('')
/**
 * ══════════════════════════════════════════════════════════════════════════
 * ⚠⚠ **反向断言：它读的必须是正本，⛔ 不许再读回工作区之内**（2026-10-27 · 包 Y §三·3）
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── 为什么需要它（⚠ 这条比"修好"更重要）──────────────────────────────────
 *   本族改前读的是 `/home/lk/FF/dsh-hob/.hob` —— **工作区之内的旧落点**，
 *   而那底下只剩 11 份残留副本（四份正本一份都不在）。
 *   ⚠ 问题不在"它红了 65 条"，在 **"它读错了地方，红得真假都无从判断"**。
 *   ⇒ 光把路径改对**不够**：下一个人（或下一次重构）完全可能又把它改回
 *     "先试 `<工作区>/.hob`"那一档 —— 而**那时不会有任何东西响**。
 *
 * ── 判据（两条，都要）──────────────────────────────────────────────────
 *   ① **打印**实际解析到的账本根绝对路径（⛔ 不许只印"已执行"，那看不出在哪）；
 *   ② **断言**该路径**不在任何工作区之内** —— 具体做法：以 `root`（本仓工作区根）
 *      为基准，正本**不得**等于 `root` 或位于其下；⛔ 也不许是它下面的 `.hob`。
 *   ⚠ ②是**结构性**的：工作区路径是从 `import.meta.url` 现算的，⛔ 不硬编码本机路径
 *     （`UD-73③`）⇒ 换一台机器、换一个检出位置，判据照样成立。
 *
 * ── ⚠ 它的"改前红"是怎么证明的（本单实跑，⛔ 不是声称）──────────────────
 *   改前 `LEDGER_ROOT` 解析出 `/home/lk/FF/dsh-hob/.hob` ⇒ **它在 root 之下**
 *   ⇒ 本条必红。修后解析出 `/home/lk/.dsh/hob-ledgers/dsh-hob` ⇒ 绿。
 *   ⚠ 这两个读数在报告 §2/§3 都贴了原文。
 */
{
  const diag = ledgerRootDiag
  if (diag.kind !== 'ok') {
    /**
     * ⚠ 走不到（上面已经在闸门 `exit 2` 了）—— 留着是为了"将来有人搬走闸门"时仍能报，
     *   ⛔ 不许把它降级成 `ok()`：那样就是本族改前那种"没查 = 查过且过"。
     */
    bad('R-root 账本根解析不到 ⇒ 反向断言无从判定（不按通过处理）')
  } else {
    const abs = resolve(diag.path)
    const wsAbs = resolve(root)
    /** ② 判"在不在工作区之内"：相等，或以下面这个分隔符开头。 */
    const insideWorkspace = abs === wsAbs || abs.startsWith(wsAbs + sep)
    /**
     * ⚠ **先打印**（这里是 ① —— 读数必须出现在输出里，⛔ 不能只活在断言里）。
     *   ⚠ 措辞用"正本根"而不是"账本根"：与本族既有那行 `正本根 = …` 同一口径。
     */
    console.log(`  正本根（反向断言）：${abs}`)
    if (insideWorkspace) {
      bad(`R-root **账本根落在工作区之内**：\`${abs}\`
      ⇒ 工作区根 = \`${wsAbs}\`；二者相等或在其下 —— 而账本自 \`CHG-102\` 起**必须在工作区之外**。
      ⇒ ⚠ 这多半是有人把它改回了"先试 \`<工作区>/.hob\`"那一档（改前就是这么读的，那底下只剩残留副本）
      ⇒ 修法：走 \`scripts/lib/ledger-root.mjs\` 的共享解析（⛔ 不要再自己拼一份）`)
    } else {
      ok(`R-root ✓ 账本根**不在工作区之内**（正本 \`${abs}\` · 工作区 \`${wsAbs}\`）`
        + ' ⇒ 本条会在有人把它改回旧落点时立刻红')
    }
  }
}

for (const n of note) console.log('  ✓', n)
/**
 * ⚠⚠ **跳过类单列**（第 349 轮 · 甲方案）：⛔ 不进上面那堆 `✓`、⛔ 不计入"通过"的数。
 *   前缀 `·`（中性符号，与"未执行"同族），与 `✓ 通过` / `✗ 失败` 都不撞色。
 */
for (const k of skip) console.log('  ·', k)
/**
 * ── ⚠⚠ **报警明细单列**（2026-10-25 · 账本根治第一批）：**只报不拦** ──────────
 *   前缀 `⚠`，与 `✓`（过了）/ `✗`（没过）/ `·`（跳过）都不同色。
 *   ⚠ **⛔ 不进 `fail`**：存量没清完之前拦 ⇒ 恒红 ⇒ 恒红判据等于没有判据。
 *   ⚠ 但它**必须印出来**（"只报"不等于"不说"）：作业书要的就是这一批存量读数。
 */
for (const a of alarm) console.log('  ⚠', a)
if (alarm.length > 0) {
  console.log(`  ⚠ 上列 **${alarm.length} 条**是**报警明细**（只报不拦）：`
    + '⛔ 不计入退出码、⛔ 不计入「查了」 —— 第一批只量存量，存量清完再转拦。')
}
console.log('')
/**
 * ── ⚠⚠ **处级口径（机器可读）**（第 349 轮 · TASK §二 硬要求 3）────────────────
 *   `查了 N 处 · 过了 M 处 · 跳过 K 处` —— `check:all` 按这两个正则读它。
 *   ⚠ **无论 `skip` 是否为 0 都印**：`跳过 0 处` 本身就是"没有跳过"的读数，
 *     ⛔ 不许因为它是 0 就不印（那会让"没查"与"没跳过"重新糊在一起）。
 */
const checkedTotal = note.length + fail.length + skip.length
console.log(`  处级口径：查了 ${checkedTotal} 处 · 过了 ${note.length} 处`
  + (fail.length > 0 ? ` · 没过 ${fail.length} 处` : '')
  + ` · **跳过 ${skip.length} 处**`
  + `（⚠ 跳过**不计入通过**）`)
console.log('')
if (fail.length === 0 && noObject.length > 0) {
  /**
   * ⚠⚠ **乙-5 的出口**：某组"没有对象可查" ⇒ `exit 2`（⚠ 不是 0、也不是 1）。
   *   ⚠ 位置在 `fail` 判之后：**真查到违规**（`1`）优先于"某组没对象"（`2`）——
   *     与 `check-all.mjs` 的"失败优先于未执行"**同一口径**。
   */
  console.log('判定：**未执行** —— 有组**没有对象可查**（⚠ 这不代表通过，也不代表有违规）。')
  for (const m of noObject) console.log('  ·', m)
  console.log('       ⚠ 退出码 **2**（没有对象 / 没执行）：0 = 查过且过 · 1 = 查了不过。')
  process.exit(2)
}
if (fail.length === 0) {
  console.log(`判定：PASS —— ${mustTrack.length} 项必须入库、${mustExclude.length} 项必须排除，全部符合 README §1。`)
  process.exit(0)
} else {
  console.log('判定：FAIL')
  for (const f of fail) console.log('  ✗', f)
  process.exit(1)
}
