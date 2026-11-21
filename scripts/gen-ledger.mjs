#!/usr/bin/env node
/**
 * **生成器**：`ledger/units/`（index 导航 + unit-*.toml 分片）⇒ `ledger/gen/stages.md` + `ledger/gen/index.md`
 * （2026-10-30 · P1 · `DESIGN-V2.md` §四 / §八 M2）。
 *
 * ══ 三条硬要求 ═══════════════════════════════════════════════════════════════════
 *   ① **确定性**：同样的输入两次跑，输出**逐字节相同**。
 *      ⚠ 所以⛔ **不写时间戳、不写"生成于…"**、不遍历 `Object.keys` 之外的顺序 —— 一律按索引里的声明顺序。
 *   ② **纯函数化**：`render()` 只吃字符串、只吐字符串（`check-ledger.mjs` 的 I2 直接调它，
 *      不需要落地文件就能验"改一条 status ⇒ 阶段跟着变"）。
 *   ③ **⛔ 零第三方依赖**：TOML 只用一个**受限子集解析器**（见 `parseTomlSubset`）——
 *      只认本索引用到的那几种写法；⛔ 不假装支持完整 TOML（那会是一个假的保证）。
 *
 * 用法：node scripts/gen-ledger.mjs            （写文件）
 *       node scripts/gen-ledger.mjs --stdout   （只打印，不写）
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ledgerHomeOf, resolveLedgerRoot } from './lib/ledger-root.mjs'
import { STAGE_IDS, STAGE_NAMES, gateProblemsAt } from '../src/shared/stage-controls.ts'

const here = dirname(fileURLToPath(import.meta.url))
export const ROOT = join(here, '..')

/**
 * ⚠⚠ **2026-10-30 P4：`ledger/` 已搬进账本区**（Hob 只能写账本区 ⇒ 索引必须住那儿）。
 *   解析走**脚本侧唯一实现** `scripts/lib/ledger-root.mjs`（⛔ 不在这里再拼一套）。
 *   ⚠ 判不出账本根 ⇒ **抛错**（⛔ 不落回工作区根 —— 那会两处真相）。
 *
 * @returns 账本区里 `ledger/` 的绝对路径
 */
export function resolveLedgerDir() {
  // ⚠ 签名是 `(root, cliLedger, homeOverride)` —— 顺序错会把工作区根当 cliLedger。
  const ledgerRoot = resolveLedgerRoot(ROOT, undefined, ledgerHomeOf(ROOT))
  if (ledgerRoot === undefined || ledgerRoot === '') {
    throw new Error('账本根判不出 ⇒ 不知道 ledger/ 在哪（⛔ 不猜、⛔ 不回退到工作区根）')
  }
  return join(ledgerRoot, 'ledger')
}

export const LEDGER_DIR = resolveLedgerDir()

/**
 * ⚠ **共享收敛判定**（2026-10-31 P42b/R4b · `TASK-R4b.md` §一.4）。
 *   唯一实现在 `src/shared/convergence.ts`；本文件**不重写**它（⛔ 两处真相会漂）。
 *   ⚠ 用 `pathToFileURL` 载 `.ts`：与 `check:stages-route` 同一套办法
 *     （Node 22 内置类型剥离），⛔ 不引入构建步骤。
 *   ⚠ 顶层 await 在本文件可用（ESM）；失败时**不抛**，让 `convergence` 保持 `undefined`
 *     ⇒ `checkpoint` 会写「判不出（未注入收敛判定）」，⛔ 不静默给假读数。
 */
let convergenceOfShared
try {
  const convUrl = new URL('../src/shared/convergence.ts', import.meta.url)
  convergenceOfShared = (await import(convUrl.href)).convergenceOf
} catch { convergenceOfShared = undefined }

/**
 * ⚠ **组合层**（2026-11-01 P40/R6 · `TASK-R6.md` §2.1）：唯一实现在
 *   `src/shared/portfolio.ts`；本文件**不重写**它（⛔ 两处真相会漂）。
 *   同一份实现还被 `src/shared/stages-index.ts`（浏览器半边）调用 —— 一份实现，两个消费者。
 *   ⚠ 载入失败 ⇒ `undefined`，`spec/portfolio.md` 照实写「判不出」，⛔ 不静默当 0 条。
 */
/**
 * ⚠ **有效验收判决**的唯一实现：同一任务多条 ACC 按 `verified_at` 取最新。
 *   载入失败 ⇒ 保持 `undefined`；Current 明写“判不出”，⛔ 不回退成“有任一 pass 就算过”。
 */
/**
 * Current 的需求级状态必须与注意力视图共用同一份九态派生逻辑。
 * ⚠ 尤其同一 parent 下的旧 SEND-BACK + 新 PASS：Current ⛔ 不能自己再写一套
 *   “逐 acc 独立判”的旧口径，否则页面与注意力会互相打脸。
 */
export const INDEX_PATH = join(LEDGER_DIR, 'units', 'index.toml')
export const GEN_DIR = join(LEDGER_DIR, 'gen')

/** 分片文件名：`unit-01.toml`、`unit-02.toml` …（⚠ 按文件名字典序合并，顺序稳定）。 */
import { readUnits, collectInputs, renderAll, renderSpecArtifacts, renderCheckFamiliesBlock, writeBlockInto } from '../src/shared/ledger-gen.ts'
export { KIND_SPEC, renderStages, parseTomlSubset, readUnits, summarizeStep, collectInputs, renderAll, renderSpecArtifacts, renderCurrent, renderRequirementRoot, renderRequirementAxis, renderPortfolio, renderCheckpoint, renderWraparound, renderModules, renderArchiveIndex, renderCheckFamiliesBlock, writeBlockInto, SEND_BACK_TARGETS, REQ_PRIORITIES, BUDGET_KEYS, PARENT_VS_AFTER, EVIDENCE_PARENT_KINDS, CONTROLLED_FIELDS, EXTENDED_FIELDS, SEND_BACK_ACTOR, CHANGE_AGGREGATE, BLOCKED_BY_SHAPE, STEP_NAMES, STAGE_ICON, UNIT_SHARD_RE } from '../src/shared/ledger-gen.ts'

function main() {
  const units = readUnits(INDEX_PATH)
  const inputs = collectInputs(ROOT, LEDGER_DIR)
  const out = renderAll(units, inputs, ROOT)

  /**
   * ── `spec/checkpoint.md`（2026-10-31 P42/R4 · `TASK-R4.md` §三）─────────────
   * ⚠ 外部读数在这里**实测**（⛔ 不取时间戳）：
   *   · `CONSTITUTION.md` 字节 —— 直接读盘数；
   *   · 构建戳 —— 读 `lib/BUILD-STAMP`；读不到就传 `null` ⇒ 快照里写「判不出」。
   * ⚠ 收敛判定**本轮不注入**（`renderCheckpoint` 会写「判不出（未注入）」）：
   *   注入需要 `check-convergence.mjs` 的 `convergenceOf`，而那会把**判据**拖进**生成器**
   *   ⇒ 生成器就开始"判对错"了，那不是它的事。⛔ 宁可写判不出，也不在生成器里造第二份判据。
   */
  let constitutionBytes = null
  try { constitutionBytes = Buffer.byteLength(readFileSync(join(ROOT, 'preset', 'dsh-hob', 'CONSTITUTION.md'), 'utf8'), 'utf8') } catch { constitutionBytes = null }
  /**
   * ⚠ 2026-11-02 P50/M6：**不再读 `lib/BUILD-STAMP`** —— 见 `renderCheckpoint` 里那段裁定 A 的注释。
   *   （`lib/BUILD-STAMP` 文件本身照旧由 `npm run build` 写、照旧是唯一构建戳来源，只是本生成物不再引用它。）
   */
  /**
   * ⚠ **注入收敛判定**（`TASK-R4b.md` §一.4）：不注入 ⇒ checkpoint 的「收口」列
   *   恒为「判不出（未注入收敛判定）」—— 那正是 R4 验收指出的那一半缺口。
   */
  const convFn = typeof convergenceOfShared === 'function'
    ? (chg) => {
        const r = convergenceOfShared(chg, units)
        return { converged: r.converged, blockedBy: r.blockedBy }
      }
    : undefined
  const specOut = renderSpecArtifacts(units, { ...inputs, constitutionBytes, convergence: convFn })
  const stdoutOnly = process.argv.includes('--stdout')
  if (!stdoutOnly) mkdirSync(GEN_DIR, { recursive: true })
  for (const [name, text] of Object.entries(out)) {
    if (stdoutOnly) { process.stdout.write(`===== ${name} =====\n${text}\n`); continue }
    writeFileSync(join(GEN_DIR, name), text)
    console.log(`  写出 gen/${name}（${Buffer.byteLength(text, 'utf8')} 字节）`)
  }
  // ── spec/checkpoint.md（⚠ 与 gen/** 同批写，⛔ 不许分两次跑）──
  const SPEC_DIR = join(LEDGER_DIR, 'spec')
  for (const [name, text] of Object.entries(specOut)) {
    if (stdoutOnly) { process.stdout.write(`===== spec/${name} =====\n${text}\n`); continue }
    mkdirSync(SPEC_DIR, { recursive: true })
    writeFileSync(join(SPEC_DIR, name), text)
    console.log(`  写出 spec/${name}（${Buffer.byteLength(text, 'utf8')} 字节）`)
  }
  /**
   * ⚠ **需求根是派生视图**（用户已冻结）：根页与 `spec/requirement-root.md` 必须逐字节一致。
   * 这里只做**已经算好的那份文本**的落点同步，⛔ 不另写第三份渲染逻辑。
   */
  const requirementRoot = specOut['requirement-root.md']
  if (!stdoutOnly && requirementRoot !== undefined) {
    writeFileSync(join(dirname(LEDGER_DIR), 'REQUIREMENTS.md'), requirementRoot)
    console.log(`  写出 REQUIREMENTS.md（${Buffer.byteLength(requirementRoot, 'utf8')} 字节）`)
  }
  /**
   * §4.1 族清单块也由生成器就地同步。
   * ⚠ 正本与模板共用族清单，但说明列按 `flavor` 分工；
   *   `check:ledger` 的 I5b 仍逐字节核对，防止手工改块。
   */
  if (!stdoutOnly) {
    const ledgerRoot = dirname(LEDGER_DIR)
    const blocks = [
      [join(ledgerRoot, 'CONTEXT.md'), renderCheckFamiliesBlock(ROOT, 'canonical')],
      [join(ROOT, 'kit', 'templates', 'CONTEXT.md'), renderCheckFamiliesBlock(ROOT, 'template')],
    ]
    for (const [file, block] of blocks) {
      const r = writeBlockInto(file, block)
      console.log(`  ${r.changed ? '同步' : '保持'} §4.1 生成块：${file}（${r.why}）`)
    }
  }
  if (!stdoutOnly) console.log(`\n  ✅ 已生成 ${Object.keys(out).length} 份 + ${Object.keys(specOut).length} 份快照（来源：units/ 索引分片 · ${units.length} 条单元）`)
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main()
