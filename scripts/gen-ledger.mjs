#!/usr/bin/env node
/**
 * **生成器**：`ledger-next/units/index.toml` ⇒ `ledger-next/gen/stages.md` + `ledger-next/gen/index.md`
 * （2026-10-30 · P1 · `DESIGN-V2.md` §四 / §八 M2）。
 *
 * ══ 三条硬要求 ═══════════════════════════════════════════════════════════════════
 *   ① **确定性**：同样的输入两次跑，输出**逐字节相同**。
 *      ⚠ 所以⛔ **不写时间戳、不写"生成于…"**、不遍历 `Object.keys` 之外的顺序 —— 一律按索引里的声明顺序。
 *   ② **纯函数化**：`render()` 只吃字符串、只吐字符串（`check-ledger-next.mjs` 的 I2 直接调它，
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

const here = dirname(fileURLToPath(import.meta.url))
export const ROOT = join(here, '..')

/**
 * ⚠⚠ **2026-10-30 P4：`ledger-next/` 已搬进账本区**（Hob 只能写账本区 ⇒ 索引必须住那儿）。
 *   解析走**脚本侧唯一实现** `scripts/lib/ledger-root.mjs`（⛔ 不在这里再拼一套）。
 *   ⚠ 判不出账本根 ⇒ **抛错**（⛔ 不落回工作区根 —— 那会两处真相）。
 *
 * @returns 账本区里 `ledger-next/` 的绝对路径
 */
export function resolveLedgerNextDir() {
  // ⚠ 签名是 `(root, cliLedger, homeOverride)` —— 顺序错会把工作区根当 cliLedger。
  const ledgerRoot = resolveLedgerRoot(ROOT, undefined, ledgerHomeOf(ROOT))
  if (ledgerRoot === undefined || ledgerRoot === '') {
    throw new Error('账本根判不出 ⇒ 不知道 ledger-next/ 在哪（⛔ 不猜、⛔ 不回退到工作区根）')
  }
  return join(ledgerRoot, 'ledger-next')
}

export const LEDGER_DIR = resolveLedgerNextDir()
export const INDEX_PATH = join(LEDGER_DIR, 'units', 'index.toml')
export const GEN_DIR = join(LEDGER_DIR, 'gen')

/**
 * 封闭状态集（`DESIGN-V2.md` §3.3）—— ⚠ 唯一真源，⛔ 不许在别处再列一遍。
 * `init` = 初始态（"一条非初始态都没有" ⇒ 步显示「未开始」）；`final` = 终态。
 */
export const KIND_SPEC = {
  req: { step: 1, statuses: ['draft', 'agreed', 'dropped'], init: 'draft', finals: ['agreed', 'dropped'], prefix: 'R-' },
  change: { step: 2, statuses: ['proposed', 'settled', 'superseded'], init: 'proposed', finals: ['settled', 'superseded'], prefix: 'CHG-' },
  task: { step: 3, statuses: ['todo', 'doing', 'built'], init: 'todo', finals: ['built'], prefix: 'TSK-' },
  run: { step: 4, statuses: ['registered', 'running', 'returned', 'refused', 'stuck'], init: 'registered', finals: ['returned', 'refused', 'stuck'], prefix: 'RUN-' },
  acc: { step: 5, statuses: ['pass', 'send-back', 'unverified'], init: 'unverified', finals: ['pass', 'send-back'], prefix: 'ACC-' },
  /** ⚠ `cap` **不进任何一步**（`step: null`），且**无终态**。 */
  cap: { step: null, statuses: ['live', 'degraded', 'down'], init: 'live', finals: [], prefix: 'CAP-' },
}

/** 五步的名字（渲染顺序）。 */
export const STEP_NAMES = ['需求规格', '实现方案', '编码任务', '任务执行', '验收核对']

/** 三态图标（照 SDD Dashboard 的 `circle / play / check`；⛔ 无百分比）。 */
export const STAGE_ICON = { notStarted: '○', doing: '▶', done: '✓' }

/**
 * **受限 TOML 子集解析器**。
 *
 * 只认本仓 `units/index.toml` 用到的那几种写法：
 *   · `[[unit]]` 数组表；
 *   · `key = "字符串"`；
 *   · `key = ["a", "b"]`（字符串数组，可跨行）；
 *   · `#` 行注释、空行。
 * ⚠ 遇到不认识的写法 ⇒ **抛错**（⛔ 静默忽略 —— 那会让"写错了"表现为"少了一条"，正是本仓最忌的形态）。
 *
 * @param {string} src - 文件全文
 * @returns {{ unit: Array<Record<string, string|string[]>> }} 解析结果
 */
export function parseTomlSubset(src) {
  const out = { unit: [] }
  let cur = null
  /** 正在读的多行数组的累积缓冲。 */
  let pendingKey = null
  let pendingBuf = ''

  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue

    if (line === '[[unit]]') {
      cur = {}
      out.unit.push(cur)
      continue
    }
    if (line.startsWith('[')) {
      throw new Error(`第 ${i + 1} 行：不支持的 TOML 表头 ${JSON.stringify(line)}（本解析器只认 [[unit]]）`)
    }
    if (cur === null) throw new Error(`第 ${i + 1} 行：键出现在 [[unit]] 之前：${JSON.stringify(line)}`)

    // 多行数组续读
    if (pendingKey !== null) {
      pendingBuf += ' ' + line
      if (line.includes(']')) {
        cur[pendingKey] = parseArray(pendingBuf, i + 1)
        pendingKey = null
        pendingBuf = ''
      }
      continue
    }

    const eq = line.indexOf('=')
    if (eq < 0) throw new Error(`第 ${i + 1} 行：不是 key = value：${JSON.stringify(line)}`)
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()

    if (val.startsWith('[') && !val.includes(']')) {
      pendingKey = key
      pendingBuf = val
      continue
    }
    if (val.startsWith('"')) {
      cur[key] = parseString(val, i + 1)
    } else if (val.startsWith('[')) {
      cur[key] = parseArray(val, i + 1)
    } else {
      throw new Error(`第 ${i + 1} 行：只支持 "字符串" 与 ["数组"]，实际 ${JSON.stringify(val)}`)
    }
  }
  if (pendingKey !== null) throw new Error(`文件末尾有多行数组没有闭合：${pendingKey}`)
  return out
}

function parseString(v, lineNo) {
  const m = /^"((?:[^"\\]|\\.)*)"\s*$/.exec(v)
  if (m === null) throw new Error(`第 ${lineNo} 行：字符串格式不对：${JSON.stringify(v)}`)
  return m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

function parseArray(v, lineNo) {
  const m = /^\[(.*)\]\s*$/s.exec(v)
  if (m === null) throw new Error(`第 ${lineNo} 行：数组格式不对：${JSON.stringify(v)}`)
  const body = m[1].trim()
  if (body === '') return []
  const items = []
  const re = /"((?:[^"\\]|\\.)*)"\s*(?:,|$)/g
  let hit
  let consumed = 0
  while ((hit = re.exec(body)) !== null) {
    items.push(hit[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'))
    consumed = re.lastIndex
  }
  // ⚠ 检查"除了空白与逗号，没剩下别的东西" —— 否则会被静默吞掉
  if (body.slice(consumed).replace(/[,\s]/g, '') !== '') {
    throw new Error(`第 ${lineNo} 行：数组里有解析不了的内容：${JSON.stringify(body.slice(consumed))}`)
  }
  return items
}

/**
 * 汇总某一步的三态 + `完成数/总数`。
 *
 * ⚠ 规则（`DESIGN-V2.md` §四，逐条照做）：
 *   · 一条都没有，或全是初始态 ⇒ `notStarted`；
 *   · 有非初始态、但未全部到终态 ⇒ `doing`；
 *   · 全部到终态 ⇒ `done`。
 *
 * @param {Array<object>} units - 该步的单元（⚠ 调用方已按 kind 过滤）
 * @param {object} spec - {@link KIND_SPEC} 里该 kind 的条目
 * @returns {{ state: 'notStarted'|'doing'|'done', finals: number, total: number }}
 */
export function summarizeStep(units, spec) {
  const total = units.length
  const finals = units.filter((u) => spec.finals.includes(u.status)).length
  if (total === 0) return { state: 'notStarted', finals: 0, total: 0 }
  const nonInit = units.filter((u) => u.status !== spec.init).length
  if (nonInit === 0) return { state: 'notStarted', finals, total }
  if (finals === total) return { state: 'done', finals, total }
  return { state: 'doing', finals, total }
}

/**
 * 生成 `gen/stages.md`。
 *
 * ⚠ **纯函数**：只吃 `units` 数组，只吐字符串。⛔ 不读盘、⛔ 不取当前时间
 * （确定性要求：同输入两次跑必须逐字节相同）。
 *
 * @param {Array<Record<string, any>>} units - 索引里的全部单元
 * @returns {string} markdown 全文
 */
export function renderStages(units) {
  const lines = []
  lines.push('# 五步阶段（**生成物** · ⛔ 手改即红）')
  lines.push('')
  lines.push('> 由 `npm run gen:ledger` 从 `units/index.toml` 算出（依据 `DESIGN-V2.md` §四）。')
  lines.push('> ⚠ ⛔ 不许手改本文件：改索引，再重新生成（`CONSTITUTION` §2 / I5）。')
  lines.push('')
  lines.push('| 步 | 状态 | 完成/总数 | 条目 |')
  lines.push('|---|---|---|---|')
  for (const [kind, spec] of Object.entries(KIND_SPEC)) {
    if (spec.step === null) continue
    const unitsOfStep = units.filter((u) => u.kind === kind)
    const { state, finals, total } = summarizeStep(unitsOfStep, spec)
    const label = state === 'done' ? `${STAGE_ICON.done} 完成`
      : state === 'doing' ? `${STAGE_ICON.doing} 进行中`
        : `${STAGE_ICON.notStarted} 未开始`
    const ids = unitsOfStep.map((u) => String(u.id)).join(' ')
    lines.push(`| ${['①', '②', '③', '④', '⑤'][spec.step - 1]} ${STEP_NAMES[spec.step - 1]} | ${label} | ${finals}/${total} | ${ids === '' ? '—' : ids} |`)
  }
  lines.push('')
  lines.push('## 长期能力（无完成态）')
  lines.push('')
  lines.push('> ⚠ `cap` 单元**不进任何一步的分母**，⛔ 无终态、⛔ 无百分比（`CONSTITUTION` §6 / I4）。')
  lines.push('> 只写**最近一次真实读数 + 时间**；判不出就写「判不出」，⛔ 不许填 0。')
  lines.push('')
  const caps = units.filter((u) => u.kind === 'cap')
  if (caps.length === 0) {
    lines.push('（本索引里没有 `cap` 单元）')
  } else {
    lines.push('| 条目 | 最近一次真实读数 |')
    lines.push('|---|---|')
    for (const c of caps) {
      // ⚠ 缺 `last_reading` ⇒ 明说"判不出"，⛔ 不编
      const reading = typeof c.last_reading === 'string' && c.last_reading.trim() !== ''
        ? c.last_reading
        : '判不出（索引里没有 `last_reading`）'
      lines.push(`| ${c.id} ${c.title ?? ''} | ${reading} |`)
    }
  }
  lines.push('')
  lines.push(...renderWraparound(ROOT))
  return lines.join('\n')
}

/**
 * **「收尾必跑」一节** —— 由 `package.json` 的 `check:*` 族生成（2026-10-30 P6 · B0）。
 *
 * ⚠ 它是**将来 `V` / `N` 删段后的替代**：那两段守的是"同一份族清单抄在 §4.1 / 模板 §4.1"，
 *   而这一节**由 `package.json` 直出** ⇒ 清单不可能与来源漂移。
 * ⚠ 纯函数：只吃 `package.json` 文本，⛔ 不取当前时间。
 *
 * @param {string} root - 工作区根
 * @returns {string[]} markdown 行
 */
export function renderWraparound(root) {
  const lines = []
  lines.push('## 收尾必跑（由 `package.json` 的 `check:*` 直出，⛔ 手改即红）')
  lines.push('')
  let pkg
  try { pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) } catch { pkg = { scripts: {} } }
  const fams = Object.keys(pkg.scripts ?? {}).filter((k) => k.startsWith('check:')).sort()
  if (fams.length === 0) {
    lines.push('（`package.json` 里没有任何 `check:*` 族 —— ⚠ 这本身是个异常，⛔ 不当作"没有要跑的"）')
  } else {
    lines.push(`共 **${fams.length}** 族（⚠ 顺序 = 字典序，⛔ 不是重要性；\`check:build\` 按读数行计，⛔ 不与逐条断言相加）：`)
    lines.push('')
    lines.push('| # | 族 | 命令 |')
    lines.push('|---|---|---|')
    fams.forEach((f, i) => lines.push(`| ${i + 1} | \`${f}\` | \`npm run ${f}\` |`))
  }
  lines.push('')
  return lines
}

/**
 * **§4.1「收尾必跑」生成块** —— 由 `package.json` + `scripts/check-family-catalog.json` 渲染。
 *
 * ── 它替换掉什么（`TASK-P7.md` §一）────────────────────────────────────────
 *   改前：同一份族清单**手抄三处**（`package.json` · 正本 `CONTEXT.md` §4.1 · 模板 §4.1），
 *     由断言 `V`（package.json → 正本）与 `N`（正本 → 模板）两条守着。
 *     ⚠ 而这两处在 P2、P3 **各被咬过一次**（新族加了、§4.1 忘了补）。
 *   ⇒ 现在：族清单**只从 `package.json` 派生**，写进一对标记之间的块；
 *     正本与模板**各一份、内容逐字节相同**（同一个渲染器）。
 *
 * ── 为什么还要 `check-family-catalog.json` ─────────────────────────────
 *   `package.json` 只有命令，**没有"守什么"那句话**。那句是人类文字，必须有个手写落点。
 *   ⇒ 这个 JSON 是**唯一手写源**；⚠ 它只提供说明列，**族清单仍派生自 `package.json`**，
 *     少一族 / 多一族 / 次序不符 ⇒ {@link renderCheckFamiliesBlock} **当场抛错**（⛔ 不静默补/删）。
 *
 * @param {string} root - 工作区根（读 `package.json` 与 catalog）
 * @returns {string} 带 BEGIN/END 标记的整块（含首尾标记行）
 */
export function renderCheckFamiliesBlock(root, flavor = 'canonical') {
  const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'))
  const fams = Object.keys(pkg.scripts ?? {}).filter((k) => k.startsWith('check:')).sort()
  const cat = JSON.parse(readFileSync(`${root}/scripts/check-family-catalog.json`, 'utf8'))
  const self = new Set(cat.self ?? [])
  const rows = cat.rows ?? []
  const byCmd = new Map(rows.map((r) => [r.cmd, r.what]))

  // ⚠ 逐族核对（⚠ 这是 V 组原有的保护，改由生成器承担 —— 少一族/多一族都当场抛错）
  const wantFams = fams.filter((f) => !self.has(f))
  const gotFams = rows.map((r) => r.cmd).filter((c) => c.startsWith('check:') && !self.has(c))
  const missing = wantFams.filter((f) => !byCmd.has(f))
  if (missing.length > 0) {
    throw new Error(`§4.1 生成块：\`package.json\` 里有、而 catalog 里**没有说明**的族：${missing.join(' / ')}`
      + '（⚠ 新增一族必须同批在 scripts/check-family-catalog.json 里补一行「守什么」）')
  }
  const extra = gotFams.filter((f) => !wantFams.includes(f))
  if (extra.length > 0) {
    throw new Error(`§4.1 生成块：catalog 里有、而 \`package.json\` 里**已经没有**的族：${extra.join(' / ')}`
      + '（⚠ 删族必须同批删掉 catalog 里那一行 —— ⛔ 否则是"照着表跑一个不存在的命令"）')
  }

  const out = []
  out.push('<!-- BEGIN gen:check-families -->')
  out.push('<!-- ⚠ 本块由 `npm run gen:ledger` 写入，⛔ 不许手改；族清单派生自 `package.json`，'
    + '「守什么」那列的唯一手写源是 `scripts/check-family-catalog.json` -->')
  out.push('')
  out.push('| 命令 | 守什么 |')
  out.push('|---|---|')
  if (flavor === 'template') {
    /**
     * ⚠⚠ **模板侧为什么不是同一份散文**（2026-10-30 P7 实测冲突）：
     *   正本那列的「守什么」是**本项目的事实**（含"第 4 轮"、本插件名、具体编号 …），
     *   而 `kit/templates/` 是**开箱层** —— `check:gitignore` 的**断言 B** 明令
     *   ⛔ 模板里不许出现本项目专有值（否则新项目开箱即错）。
     *   ⇒ 于是两侧**族清单完全相同**（同一个 `package.json` 派生、同一个渲染器），
     *     但**说明列不同**：正本给本项目的事实，模板给"去本仓 §4.1 看"。
     *   ⚠ 这不是"为了绿而弱化"：模板行**原本就是 `| ... |` 占位**，P7 之前也没有真说明。
     */
    for (const r of rows) out.push(`| \`npm run ${r.cmd}\` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |`)
  } else {
    for (const r of rows) out.push(`| \`npm run ${r.cmd}\` | ${r.what} |`)
  }
  out.push('')
  out.push(`⚠ 本块共 **${rows.filter((r) => r.cmd.startsWith('check:')).length}** 个 \`check:*\` 族`
    + `（另有 \`build\` / \`typecheck\` 两个非判据命令）；`
    + `\`check:all\` 与 \`check:preflight\` 是调度器与体检，⛔ 不入本块（与 \`SELF\` 同口径）。`)
  out.push('<!-- END gen:check-families -->')
  return out.join('\n')
}

/**
 * 把生成块**就地写进**某个文件的标记之间（⚠ 只动标记之间，块外一个字不碰）。
 *
 * @param {string} filePath - 目标文件
 * @param {string} block - {@link renderCheckFamiliesBlock} 的输出
 * @returns {{changed: boolean, why: string}} 是否真的改了
 */
export function writeBlockInto(filePath, block) {
  const BEGIN = '<!-- BEGIN gen:check-families -->'
  const END = '<!-- END gen:check-families -->'
  let src = ''
  try { src = readFileSync(filePath, 'utf8') } catch {
    return { changed: false, why: `读不到：${filePath}` }
  }
  const i = src.indexOf(BEGIN)
  const j = src.indexOf(END)
  if (i < 0 || j < 0) {
    return { changed: false, why: `没有找到标记（BEGIN=${i} / END=${j}）：${filePath}` }
  }
  if (j < i) return { changed: false, why: `标记次序颠倒：${filePath}` }
  const next = src.slice(0, i) + block + src.slice(j + END.length)
  if (next === src) return { changed: false, why: 'already-up-to-date' }
  writeFileSync(filePath, next)
  return { changed: true, why: 'written' }
}

/**
 * **`gen/modules.md`** —— 由 `src/modules/` 目录实测生成（2026-10-30 P6 · B0）。
 *
 * ⚠ 它是**将来 `W` 删段后的替代**：`W` 守的是"`volumes/plan/03` 的模块表行数 = `src/modules/` 文件数"，
 *   而本文件**由目录直出** ⇒ 表不可能与目录漂移。
 * ⚠ 纯函数：吃文件列表，⛔ 不取时间戳、⛔ 不读 mtime。
 *
 * @param {string[]} stems - `src/modules/` 下的文件名主干（不含 `.ts`），调用方已排序
 * @returns {string} markdown 全文
 */
export function renderModules(stems) {
  const lines = []
  lines.push('# 宿主模块（由 `src/modules/` 目录实测生成 · ⛔ 手改即红）')
  lines.push('')
  lines.push('> 由 `npm run gen:ledger` 从目录直出（依据 `DESIGN-V2.md` §七「模块表由目录生成」）。')
  lines.push('> ⚠ ⛔ 不许手改：改了 `src/modules/` 就重跑生成器（`CONSTITUTION` §2 / I5）。')
  lines.push('')
  lines.push(`共 **${stems.length}** 个模块文件：`)
  lines.push('')
  lines.push('| # | 模块文件 |')
  lines.push('|---|---|')
  stems.forEach((s, i) => lines.push(`| ${i + 1} | \`src/modules/${s}.ts\` |`))
  lines.push('')
  lines.push('⚠ 本表只回答"**目录里有哪些文件**"，⛔ 不回答"哪个进 `MODULE_REGISTRY`" —— ')
  lines.push('   后者是代码事实，读 `src/index.ts` / `src/modules/orchestrator.ts`，⛔ 不在这里复写。')
  lines.push('')
  return lines.join('\n')
}

/**
 * **`gen/archive-index.md`** —— 由账本区 `archive/` 目录实测生成（2026-10-30 P6 · B0）。
 *
 * ⚠ 它是**将来 `check:archive` ① 清单部分的替代**：那份清单是手写的，
 *   而本文件**由目录直出** ⇒ 条目不可能与盘上漂移。
 * ⚠⚠ **它不替代 `check:archive` ② （成员完整性核）** —— 那条没有新家。
 * ⚠ 纯函数：吃"归档目录名 + 每目录文件数"的数组，⛔ 不取时间、⛔ 不读 mtime。
 *
 * @param {Array<{name: string, files: string[]}>} dirs - 归档目录（调用方已排序）
 * @returns {string} markdown 全文
 */
export function renderArchiveIndex(dirs) {
  const lines = []
  lines.push('# 归档索引（由账本区 `archive/` 目录实测生成 · ⛔ 手改即红）')
  lines.push('')
  lines.push('> 由 `npm run gen:ledger` 从目录直出。⚠ ⛔ 不许手改（`CONSTITUTION` §2 / I5）。')
  lines.push('> ⚠ 本文件只回答"**盘上有哪些归档目录、各几件**"，⛔ 不替代 `check:archive` ② 的成员完整性核。')
  lines.push('')
  lines.push(`共 **${dirs.length}** 个归档目录：`)
  lines.push('')
  lines.push('| # | 归档目录 | 文件数 |')
  lines.push('|---|---|---|')
  dirs.forEach((d, i) => lines.push(`| ${i + 1} | \`archive/${d.name}/\` | ${d.files.length} |`))
  lines.push('')
  return lines.join('\n')
}

/**
 * 生成 `gen/index.md`（全量索引，按 kind 分组，⚠ 顺序 = 索引里的声明顺序）。
 *
 * @param {Array<Record<string, any>>} units - 索引里的全部单元
 * @returns {string} markdown 全文
 */
export function renderIndex(units) {
  const lines = []
  lines.push('# 全量索引（**生成物** · ⛔ 手改即红）')
  lines.push('')
  lines.push('> 由 `npm run gen:ledger` 从 `units/index.toml` 算出。⚠ 状态只在索引里，本文件是**读数投影**。')
  lines.push('')
  for (const [kind, spec] of Object.entries(KIND_SPEC)) {
    const group = units.filter((u) => u.kind === kind)
    if (group.length === 0) continue
    const stepLabel = spec.step === null ? '长期能力（无完成态）' : `第 ${spec.step} 步 · ${STEP_NAMES[spec.step - 1]}`
    lines.push(`## ${kind} · ${stepLabel}（${group.length} 条）`)
    lines.push('')
    lines.push('| id | 标题 | 状态 | after | 来源 |')
    lines.push('|---|---|---|---|---|')
    for (const u of group) {
      const after = Array.isArray(u.after) && u.after.length > 0 ? u.after.join(', ') : '—'
      lines.push(`| ${u.id} | ${u.title ?? ''} | ${u.status} | ${after} | ${u.source ?? '—'} |`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** 读索引并解析（供生成器与判据共用 —— ⚠ 单一入口）。 */
export function readUnits(indexPath = INDEX_PATH) {
  const src = readFileSync(indexPath, 'utf8')
  const parsed = parseTomlSubset(src)
  return parsed.unit
}

/**
 * 生成**全部**产物（不写盘）。
 *
 * ⚠ 2026-10-30 P6：从 2 份增到 **4 份** —— 新增 `modules.md`（`src/modules/` 直出）与
 *   `archive-index.md`（账本区 `archive/` 直出）。三份新生成端一律纳入 **I5**（手改即红）。
 * ⚠ 纯函数：只吃"已在参数里递进来的数据"，⛔ 不在渲染层读盘取时间。
 *
 * @param {Array<object>} units - 索引单元
 * @param {{stems?: string[], archiveDirs?: Array<{name:string,files:string[]}>}} [extra]
 *   - `stems`：`src/modules/` 的文件主干（已排序）
 *   - `archiveDirs`：账本区 `archive/` 的目录（已排序）
 * @returns {Record<string,string>} 文件名 → 全文
 */
export function renderAll(units, extra = {}) {
  return {
    'stages.md': renderStages(units),
    'index.md': renderIndex(units),
    'modules.md': renderModules(extra.stems ?? []),
    'archive-index.md': renderArchiveIndex(extra.archiveDirs ?? []),
  }
}

/**
 * 采集"外部输入"（目录实测）—— ⚠ **读盘但不取时间**，所以仍然确定性。
 *
 * @param {string} root - 工作区根（取 `src/modules/`）
 * @param {string} ledgerDir - 账本区 `ledger-next/` 的**上级**（= 账本根；取 `archive/`）
 * @returns {{stems: string[], archiveDirs: Array<{name:string, files:string[]}>}}
 */
export function collectInputs(root, ledgerDir) {
  /** `src/modules/` 的文件主干（⚠ 只 `.ts`，排除 `.d.ts`）。 */
  let stems = []
  try {
    stems = readdirSync(join(root, 'src', 'modules'))
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
      .map((f) => f.slice(0, -3))
      .sort()
  } catch { stems = [] }
  /** 账本区 `archive/` 的子目录 + 每目录文件数。 */
  const ledgerRoot = dirname(ledgerDir)
  const archiveRoot = join(ledgerRoot, 'archive')
  let archiveDirs = []
  try {
    archiveDirs = readdirSync(archiveRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        let files = []
        try {
          files = readdirSync(join(archiveRoot, e.name), { withFileTypes: true })
            .filter((x) => x.isFile())
            .map((x) => x.name)
            .sort()
        } catch { files = [] }
        return { name: e.name, files }
      })
      .sort((a, b) => (a.name < b.name ? -1 : 1))
  } catch { archiveDirs = [] }
  return { stems, archiveDirs }
}

/** 主入口（仅在直接执行时写盘）。 */
function main() {
  const units = readUnits()
  const out = renderAll(units, collectInputs(ROOT, LEDGER_DIR))
  const stdoutOnly = process.argv.includes('--stdout')
  if (!stdoutOnly) mkdirSync(GEN_DIR, { recursive: true })
  for (const [name, text] of Object.entries(out)) {
    if (stdoutOnly) { process.stdout.write(`===== ${name} =====\n${text}\n`); continue }
    writeFileSync(join(GEN_DIR, name), text)
    console.log(`  写出 gen/${name}（${Buffer.byteLength(text, 'utf8')} 字节）`)
  }
  if (!stdoutOnly) console.log(`\n  ✅ 已生成 ${Object.keys(out).length} 份（来源：units/index.toml · ${units.length} 条单元）`)
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main()
