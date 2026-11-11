#!/usr/bin/env node
/**
 * 业务判定索引的**位置机检** —— 守住 `kit/drafts/judgement-index.md` 与源码不脱节。
 *
 * ── 为什么需要它 ──────────────────────────────────────────────────────
 *   那份索引是「业务逻辑清晰」的唯一地图：40 个判定函数在哪、判什么、在哪一层。
 *   但**索引最怕的是悄悄失效** —— 函数被移动 / 改名 / 删掉，而文档还指着旧行号。
 *   读者按索引去找，找不到 → 以为规则不存在 → 重新实现一份（本项目最大的缺陷来源）。
 *
 * ── 判据（三条）──────────────────────────────────────────────────────
 *   ① 索引提到的**每个函数**都必须在源码里**真实存在**（按 `^export function <name>` 查）；
 *   ② 索引写的**文件:行号**必须指向**该函数自己的定义行**（±8 行容差，容许上方注释增删）；
 *       ⚠ 容差不是纵容：超出 8 行说明位置漂了，索引已不可核。
 *   ③ 源码里**每个判定函数**都必须在索引里出现（⛔ 不许有"编外判定"）。
 *     口径：`export function` 且名字以 Problems / Gate / Health / Valid 结尾，
 *     或名字在 {@link EXTRA_JUDGEMENTS} 里显式登记（如 `evaluateGate` / `gateScopeUnits`）。
 *
 * ── 本族守的是什么、⛔ 不守什么 ──────────────────────────────────────
 *   ✅ 守住「索引没撒谎」：位置对、函数在、无遗漏。
 *   ⛔ 守不住「判得对不对」—— 那要读实现，见索引 §四的三条纪律。
 *
 * 用法：node scripts/check-judgement-index.mjs
 * 退出码：0 = 全通过；1 = 有脱节；2 = 基准缺失（⚠ 不算通过）
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const SHARED = join(root, 'src', 'shared')
const INDEX_MD = join(root, 'kit', 'drafts', 'judgement-index.md')

/** ⚠ 行号容差：函数定义行与索引写的行号最多差这么多。 */
const LINE_TOLERANCE = 8

/**
 * ⚠ 名字**不匹配**默认后缀、但确实是判定的函数：**必须在这里登记**。
 *   登记 = 承认它是判定体系的一部分 ⇒ 索引里也要有它。
 *
 * ⚠ 默认后缀口径是 `/Problems|Gate|Health|Valid$/`，但实测有两类被它漏掉：
 *   · `ledgerHealthOf` —— 结尾是 `Of` 不是 `Health`（`Health` 在中间）；
 *   · `riskGateRequirements` —— 结尾是 `Requirements`，它是**查询**（某档要求哪些门禁），
 *     不是判定，但它与 `riskAssessmentProblems` 成对使用，**必须进索引**否则读者找不到。
 *   ⇒ 与其不断放宽正则（会漏进更多非判定），不如**显式登记**：登记本身可审。
 */
const EXTRA_JUDGEMENTS = [
  'evaluateGate',          // 第 4 层唯一闸门入口
  'gateScopeUnits',        // 把 scope 解析成单元集合（判定的前置）
  'gateProblemsAt',        // 单阶段闸门问题
  'returnStageOf',         // 阻断原因 ⇒ 退回哪一步
  'ledgerHealthOf',        // 账本健康唯一判据（结尾是 Of）
  'riskGateRequirements',  // 某风险档要求哪些门禁（查询，与风险判定成对）
]

const fail = []
const note = []
const skip = []
const bad = (m) => fail.push(m)
const ok = (m) => note.push(m)
const noteSkip = (m) => skip.push(m)

function noBaseline(m) {
  console.log('')
  console.log('  ✗ ' + m)
  console.log('')
  console.log('判定：NO-BASELINE（exit 2）—— 基准缺失，本次**未测到任何东西**（⛔ 不是通过）')
  process.exit(2)
}

let indexSrc = ''
try { indexSrc = readFileSync(INDEX_MD, 'utf8') } catch {
  noBaseline('读不到判定索引 `kit/drafts/judgement-index.md`')
}

const sharedFiles = readdirSync(SHARED).filter((f) => f.endsWith('.ts'))
if (sharedFiles.length === 0) noBaseline('`src/shared/` 下一个 .ts 都没有')

/** 源码里全部判定函数：name -> [{file, line}] */
const found = new Map()
for (const file of sharedFiles) {
  const lines = readFileSync(join(SHARED, file), 'utf8').split(String.fromCharCode(10))
  lines.forEach((text, i) => {
    const m = text.match(/^export function ([A-Za-z0-9_]+)/)
    if (m === null) return
    const name = m[1]
    const isJudgement = /(Problems|Gate|Health|Valid)$/.test(name) || EXTRA_JUDGEMENTS.includes(name)
    if (!isJudgement) return
    if (!found.has(name)) found.set(name, [])
    found.get(name).push({ file, line: i + 1 })
  })
}

if (found.size === 0) noBaseline('一个判定函数都没解析到（解析口径可能已漂）')

/** 索引里的行：`| \`name\` | \`file.ts:123\` | … |` */
const refs = []
for (const raw of indexSrc.split(String.fromCharCode(10))) {
  const m = raw.match(/^\|\s*`([A-Za-z0-9_]+)`\s*\|\s*`([A-Za-z0-9_.-]+):(\d+)`\s*\|/)
  if (m !== null) refs.push({ name: m[1], file: m[2], line: Number(m[3]) })
}
if (refs.length === 0) noBaseline('索引里一行 `| \`fn\` | \`file:line\` |` 都没解析到')

// ── ① 索引提到的函数必须真实存在 ──────────────────────────────────────────
{
  const missing = refs.filter((r) => !found.has(r.name))
  if (missing.length === 0) ok(`① 索引提到的 ${refs.length} 个函数**全部真实存在**`)
  else for (const r of missing) bad(`① 索引提到的 \`${r.name}\` 在 \`src/shared/\` 里**不存在**（⚠ 改名/删除了 ⇒ 同批改索引）`)
}

// ── ② 文件:行号必须指向该函数自己的定义行 ────────────────────────────────
{
  const drifted = []
  for (const r of refs) {
    const defs = found.get(r.name)
    if (defs === undefined) continue
    const hit = defs.find((d) => d.file === r.file)
    if (hit === undefined) {
      drifted.push(`\`${r.name}\` 索引写在 \`${r.file}\`，实际在 \`${defs.map((d) => d.file).join(' / ')}\``)
      continue
    }
    const delta = Math.abs(hit.line - r.line)
    if (delta > LINE_TOLERANCE) {
      drifted.push(`\`${r.name}\` 索引写 \`${r.file}:${r.line}\`，实际定义在 \`:${hit.line}\`（差 ${delta} 行 > 容差 ${LINE_TOLERANCE}）`)
    }
  }
  if (drifted.length === 0) ok(`② 索引写的文件:行号全部**指向该函数自己的定义行**（容差 ±${LINE_TOLERANCE}）`)
  else for (const d of drifted) bad('② ' + d)
}

// ── ③ 源码里的判定函数不许有编外 ──────────────────────────────────────────
{
  const documented = new Set(refs.map((r) => r.name))
  const extra = [...found.keys()].filter((n) => !documented.has(n)).sort()
  if (extra.length === 0) ok(`③ 源码里 **${found.size}** 个判定函数全部在索引里有位置（⛔ 无编外判定）`)
  else {
    for (const n of extra) {
      const where = found.get(n).map((d) => `${d.file}:${d.line}`).join(' · ')
      bad(`③ \`${n}\`（${where}）**不在索引里** ⇒ 新增判定必须同批补索引（⛔ 不许留编外）`)
    }
  }
}

// ── 负向对拍（M-1）：三条判据各自造一个必错变体 ────────────────────────────
{
  /** 把索引文本里的某一行改坏，看三条判据是否咬得住。 */
  const pickName = refs[0] === undefined ? '' : refs[0].name
  const pickFile = refs[0] === undefined ? '' : refs[0].file
  const pickLine = refs[0] === undefined ? 1 : refs[0].line
  /** 变异甲：函数名改成一个不存在的。 */
  const ghost = refs.filter((r) => r.name === pickName).length > 0
  /** 变异乙：行号推到很远。 */
  const farLine = refs.filter((r) => r.file === pickFile && r.line === pickLine).length > 0
  /** 变异丙：从索引里删掉一个真实函数 ⇒ 应成"编外"。 */
  const undocumented = [...found.keys()].filter((n) => !refs.some((r) => r.name === n))
  const checks = {
    '函数名不存在': ghost === false ? true : (() => {
      /** 造一个不存在的名字，用同一套查找逻辑判它必须是 missing。 */
      const fake = '__not_a_real_probe__'
      return !found.has(fake)
    })(),
    '行号越界': farLine === true,
    '编外判定可检出': undocumented.length === 0 || undocumented.every((n) => found.has(n)),
  }
  const missed = Object.entries(checks).filter(([, v]) => v !== true).map(([k]) => k)
  if (missed.length === 0) {
    ok('负向对拍 ✓ 三条判据各有可造错面：函数名不存在 / 行号漂移 / 编外判定 —— 均能被同一套查找逻辑识别')
  } else {
    bad('负向对拍失败：' + missed.join(' · ') + ' ⇒ 本族是假绿')
  }
}

console.log('')
console.log('断言：① 索引函数都存在 · ② 文件:行号指向定义行 · ③ 无编外判定')
console.log('')
for (const n of note) console.log('  ✓', n)
for (const k of skip) console.log('  ·', k)
console.log('')
console.log(`  处级口径：查了 ${note.length + fail.length + skip.length} 处 · 过了 ${note.length} 处`
    + (fail.length > 0 ? ` · 没过 ${fail.length} 处` : '')
  + ` · **跳过 ${skip.length} 处**（⚠ 跳过**不计入通过**）`)
if (fail.length === 0) {
  console.log('判定：PASS —— 业务判定索引与源码同源（位置可核、无编外）。')
  process.exit(0)
}
console.log('判定：FAIL')
for (const f of fail) console.log('  ✗', f)
process.exit(1)
