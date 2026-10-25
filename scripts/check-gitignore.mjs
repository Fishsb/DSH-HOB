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
import { readFileSync } from 'node:fs'
import { runRepoRules } from './check-repo-rules.mjs'
import { findDuplicateSectionHeadings, ledgerRootDiag, runDocShape, runRequirementPurity, runResidualMarkers, runTableIntegrity } from './check-doc-shape.mjs'
import { runDiscipline, runPlanModuleParity, runRender, runRequirementsRoot, runSameSource, runSkeletonSource, runWorkspaceNameSource, runWriteScope, runZeroWidth } from './check-code-face.mjs'

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

// ── ③ K：同源判据的字面量必须逐字相同 ───────────────────────────────────
runSameSource({ bad, ok })

// ── ③ S：工作区名口径只有一套（运行时侧 ↔ 判据侧逐字相同）─────────────────
//   ⚠ 2026-10-18（第四张隔离卡收口 · UD-143 裁定二）：⚠ **判据修好、运行时没修**
//     会让"判据报绿、运行时却把账本区认到别处"—— 两侧各自看起来都对，合起来是错的。
//     ⇒ 把"照抄"从人守变成机检（与 K 同族：K 管归档/作业书正则，S 管工作区名）。
runWorkspaceNameSource({ bad, ok })

// ── ② 四份正本形态机检 A / B / J / C / D / D′ / E ──────────────────────
runDocShape({ bad, ok, noObject: noteNoObject, skip: noteSkip })

// ── ③ F / G / H ────────────────────────────────────────────────────────
runDiscipline({ bad, ok, readmeSrc, PKG })
runZeroWidth({ bad, ok })
await runRender({ bad, ok })

// ── ② I：正本无残留标记（需 await 载入渲染器）──────────────────────────
await runResidualMarkers({ bad, ok })

// ── ③ Q：卷下两层子目录的写侧白名单（成对 + 强制登记）──────────────
await runWriteScope({ bad, ok })

// ── ③ T：现行需求根的迁移面（新根可写 / 旧根拒写且理由分得开 / 旧根仍可读）──
await runRequirementsRoot({ bad, ok })

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
for (const n of note) console.log('  ✓', n)
/**
 * ⚠⚠ **跳过类单列**（第 349 轮 · 甲方案）：⛔ 不进上面那堆 `✓`、⛔ 不计入"通过"的数。
 *   前缀 `·`（中性符号，与"未执行"同族），与 `✓ 通过` / `✗ 失败` 都不撞色。
 */
for (const k of skip) console.log('  ·', k)
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