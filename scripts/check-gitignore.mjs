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
import { findDuplicateSectionHeadings, runDocShape, runResidualMarkers, runTableIntegrity } from './check-doc-shape.mjs'
import { runDiscipline, runRender, runSameSource, runSkeletonSource, runWriteScope, runZeroWidth } from './check-code-face.mjs'

const fail = []
const note = []
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

// ── ① 入库与仓规（带回 README / PKG 两处共享读数）───────────────────────
const { mustTrack, mustExclude, README, readmeSrc, PKG } = runRepoRules({ bad, ok })

// ── ③ K：同源判据的字面量必须逐字相同 ───────────────────────────────────
runSameSource({ bad, ok })

// ── ② 四份正本形态机检 A / B / J / C / D / D′ / E ──────────────────────
runDocShape({ bad, ok })

// ── ③ F / G / H ────────────────────────────────────────────────────────
runDiscipline({ bad, ok, readmeSrc, PKG })
runZeroWidth({ bad, ok })
await runRender({ bad, ok })

// ── ② I：正本无残留标记（需 await 载入渲染器）──────────────────────────
await runResidualMarkers({ bad, ok })

// ── ③ Q：卷下两层子目录的写侧白名单（成对 + 强制登记）──────────────
await runWriteScope({ bad, ok })

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
console.log('')
if (fail.length === 0) {
  console.log(`判定：PASS —— ${mustTrack.length} 项必须入库、${mustExclude.length} 项必须排除，全部符合 README §1。`)
  process.exit(0)
} else {
  console.log('判定：FAIL')
  for (const f of fail) console.log('  ✗', f)
  process.exit(1)
}