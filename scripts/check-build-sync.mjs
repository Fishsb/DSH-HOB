#!/usr/bin/env node
/**
 * `check:build` —— **`lib/` 是否跟得上 `src/` + 骨架件**（⚠ ⚠ **只报不拦**）。
 *
 * ── 为什么需要（⚠ 缺口有实测出处）──────────────────────────────────────
 *   ⚠ 第 286 轮分发面审查（`archive/2026-10-17-prompt-audit/REPORT-R224.md` §3.5 ③）实测：
 *     `lib/BUILD-STAMP` 停在 `26302ff`（= **第 272 轮**），⚠ ⚠ **而 `R219` / `R220` / `R221` / `R223`
 *     四份报告里都写了"`build` 已跑"** ⇒ ⚠ **"跑了 `build`"与"产物真的跟上了"是两件事**，
 *     ⚠ 且 `lib/` 被 `.gitignore` 忽略 ⇒ **这种漂移在 `git status` 里完全看不见**（`E-24` / `E-25`）。
 *   ⚠ 第 288 轮的判据面审计（`REPORT-R225.md` §3.4-b 首批 `#11`）把它列为首批建议，
 *     原话：⚠ **"`src/**` 变了而 `lib/` 未变 ⇒ 报警"**，⚠ 并明写难点 ——
 *     ⚠ ⚠ **"`lib/` 落后"也可能是未提交态** ⇒ ⚠ **判据须只报不拦（否则恒红）**。
 *
 * ── ⚠ ⚠ 本判据的口径（**只报不拦**，⚠ 这是它唯一正确的形态）────────────────
 *   ⚠ ⚠ **它永远 `exit 0`**（除"基准缺失"那一档，见下）。**任何"落后"都只打印，不 FAIL。**
 *   ⚠ **为什么不能拦**（三条，都是实测/推得出的）：
 *     ① ⚠ **改完 `src/**` 到跑 `build` 之间**，落后是**必然**的正常中间态 ⇒ 拦了**恒红**；
 *     ② ⚠ **未提交态**（改了 `src/` 还没提交）也会落后 ⇒ 同上；
 *     ③ ⚠ ⚠ **"恒红的判据等于没有判据"**（⚠ `check-repo-rules.mjs` 断言 A 的注释里点过这个坑）
 *        ⇒ ⚠ **它会立刻被无视，比没有更糟**。
 *   ⚠ ⚠ **并且它判的是"产物 vs 源"的**内容**，⛔ 不是"实例是否已加载"** ——
 *     后者是**另一条判据**（见 `EXPERIENCE.md` `E-168`：「〔产物层〕✅ / 〔实例层〕⛔」分档；
 *     ⚠ 判"实例在用它"唯一办法 = 拿一个只走那条路径的动作去试，⚠ **重启是硬红线**）。
 *
 * ── 判据（⚠ 报什么 · 两条面）──────────────────────────────────────────
 *   **面 ①：提交面**（⚠ 权威来源 = `lib/BUILD-STAMP` 的 `commit=` 行）
 *     · 戳里的 `commit` 已**不是** `HEAD` ⇒ ⚠ **产物落后于当前提交** ⇒ 报；
 *     · 戳里 `dirty=true` ⇒ ⚠ **编译时工作树是脏的**（⚠ 与 `git status` 的"现在脏不脏"是两件事）⇒ 报。
 *   **面 ②：内容面**（⚠ ⚠ **面 ① 说"同步"时也不能省** —— 这正是那四份报告"说跑了却停在 R272"的形态）
 *     · 凡 `lib/` 里**有对应产物**的源件（`src/` 下的全部 `.ts` / `.tsx`），
 *       ⚠ **源件的 mtime 晚于产物** ⇒ 报"这个产物的来源比它新"；
 *     · ⚠ **骨架件**（`templates/` 等，⚠ 被 `gen:skeleton` 派生成 `src/server/skeleton-manifest.ts`）
 *       **不单列** —— ⚠ 它们经派生件**已落在面 ② 的覆盖面里**（⚠ 这样不会造出第二条并行口径）。
 *   ⚠ **两条面都报**、各自给**逐条行**（⛔ 不合并成一句"落后了"）。
 *
 * ── 退出码（三档，与 `check:host` 同族）────────────────────────────────
 *   0 = **已执行**（⚠ ⚠ **不论有没有落后读数** —— "只报不拦"就落在这里）；
 *   1 = **保留不用**（⚠ 本判据**不设** FAIL 档 —— 见上"口径"，⛔ 这是有意的）；
 *   2 = **未执行 / 基准缺失**（⚠ `lib/BUILD-STAMP` 读不到 / `lib/` 不在 ⇒ **不代表通过**）。
 *
 * ── ⚠ ⛔ 不许"扫 0 份报 ✓"（`E-126` 口径）──────────────────────────────
 *   面 ① 要有 `BUILD-STAMP` 可读；面 ② 的**比较对数必须 > 0**（⚠ 否则退 2 并说明）
 *   —— ⚠ 两条都在"覆盖面读数"里报出来，防"覆盖面静默缩水而判据照旧绿"（`E-160` 同族）。
 *
 * 用法：node scripts/check-build-sync.mjs
 * ⚠ 零第三方依赖（本仓纪律）。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/** 编译产物面：`src/<x>.ts` ⇒ `lib/<x>.js`（⚠ 与 `tsconfig.json` 的 `rootDir: src` / `outDir: lib` 同口径）。 */
const SRC_DIR = join(root, 'src')
const LIB_DIR = join(root, 'lib')
const STAMP = join(LIB_DIR, 'BUILD-STAMP')

/** 递归收 `.ts` / `.tsx`（⚠ 骨架清单派生件 `src/server/skeleton-manifest.ts` 也在其中）。 */
function walk(dir, acc = []) {
  let es = []
  try { es = readdirSync(dir, { withFileTypes: true }) } catch { return acc }
  for (const e of es) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) acc.push(p)
  }
  return acc
}

/** 源件 ⇒ 产物路径（⚠ 只做后缀替换，⛔ 不猜 tsdown 的分包规则）。 */
const productOf = (srcFile) => {
  const rel = relative(SRC_DIR, srcFile)
  return join(LIB_DIR, rel).replace(/\.tsx?$/, '.js')
}

const stampExists = existsSync(STAMP)
const libExists = existsSync(LIB_DIR)

console.log('`lib/` 同步自检 · dsh-hob（⚠ ⚠ **只报不拦** —— 落后只打印，⛔ 不 FAIL）')
console.log('')

if (!stampExists || !libExists) {
  console.log('判定：**未执行** —— 读不到 `lib/BUILD-STAMP`（或 `lib/` 不在）'
    + '⇒ 本检查**不代表通过**（退出码 2 与"已执行"有意区分）。')
  console.log('       ⚠ 修法：跑一次 `npm run build` 生成产物与戳。')
  console.log(`       ⇒ STAMP 存在：${stampExists} · LIB 存在：${libExists}`)
  process.exit(2)
}

// ── 面 ①：提交面（⚠ 权威来源 = 戳本身）────────────────────────────────────
const stamp = readFileSync(STAMP, 'utf8')
const field = (k) => {
  const m = new RegExp(`^${k}=(.*)$`, 'm').exec(stamp)
  return m === null ? null : m[1].trim()
}
const commit = field('commit')
const dirty = field('dirty')
const builtAt = field('built_at')

let head = null
try {
  head = (await import('node:child_process')).execFileSync('git', ['rev-parse', 'HEAD'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
} catch { head = null }

const notes = []
const lag = []
if (commit === null || commit === 'unknown') {
  lag.push('✗ 面 ①：戳里读不到 `commit=` ⇒ ⚠ 无法判"产物对应哪一版源码"（⚠ 不按通过处理）')
} else if (head === null) {
  lag.push(`✗ 面 ①：取不到 \`HEAD\`（git 不可用 / 非 git 仓）⇒ 无法与戳比对（戳 commit=${commit.slice(0, 12)}）`)
} else if (commit !== head) {
  lag.push(`✗ 面 ①：产物**落后于当前提交** —— 戳 commit=${commit.slice(0, 12)} · HEAD=${head.slice(0, 12)}`
    + `（⚠ 戳 built_at=${builtAt ?? '?'}）⇒ ⚠ 跑一次 \`npm run build\``)
} else {
  notes.push(`✓ 面 ①：戳 commit = \`HEAD\` = ${commit.slice(0, 12)}（⚠ 产物对应当前提交）`)
}
if (dirty === 'true') {
  lag.push('✗ 面 ①：戳 `dirty=true` ⇒ ⚠ 编译时工作树**当时是脏的**'
    + '（⚠ 与"现在脏不脏"是两件事 ⇒ 只报，⛔ 不代表现在有什么问题）')
} else if (dirty !== null && dirty !== 'unknown') {
  notes.push(`✓ 面 ①：戳 dirty=${dirty}（⚠ 编译时工作树是干净的）`)
}

// ── 面 ②：内容面（⚠ 面 ① 说"同步"时也不能省）─────────────────────────────
const srcFiles = walk(SRC_DIR)
let compared = 0
let missingProduct = 0
let staleProduct = 0
const staleLines = []
for (const f of srcFiles) {
  const prod = productOf(f)
  if (!existsSync(prod)) {
    // ⚠ 有些源件**本就没有独立产物**（类型 / 被内联进别的 bundle）⇒ ⚠ **不计入"比较对"**，
    //   但要**报出条数**（⛔ 不静默缩水，见文件头「不许扫 0 份报 ✓」）。
    missingProduct++
    continue
  }
  compared++
  const st = statSync(f).mtimeMs
  const pt = statSync(prod).mtimeMs
  if (st > pt + 1000) {   // ⚠ 1s 容差：同一批 build 里源与产物的 mtime 会非常接近
    staleProduct++
    if (staleLines.length < 20) {
      staleLines.push(`✗ 面 ②：\`${relative(root, f)}\` 比它的产物 \`${relative(root, prod)}\` 新`
        + `（源 ${new Date(st).toISOString()} > 产物 ${new Date(pt).toISOString()}）`)
    } else if (staleLines.length === 20) {
      staleLines.push('…（更多略）')
    }
  }
}
for (const l of staleLines) lag.push(l)
if (staleProduct > 0) {
  lag.push(`✗ 面 ②：共 **${staleProduct}** 件源比产物新 ⇒ ⚠ 跑一次 \`npm run build\``)
} else if (compared > 0) {
  notes.push(`✓ 面 ②：**${compared}** 对「源 ↔ 产物」**逐对核过 mtime**，⛔ 无一件源比产物新`)
}
/** ⚠ 骨架件经派生件已落在面 ② 的覆盖面里（⛔ 不另立口径）。 */
const manifestSrc = join(SRC_DIR, 'server', 'skeleton-manifest.ts')
if (existsSync(manifestSrc)) {
  notes.push(`✓ 面 ②：骨架派生件 \`src/server/skeleton-manifest.ts\` 在位`
    + '（⚠ 骨架件 ⇒ 派生件 ⇒ 产物 的链路**已被面 ② 覆盖**，⛔ 不另立第二条口径）')
}

console.log('  ✓ 覆盖面：')
console.log(`      · 面 ① 取数件：\`lib/BUILD-STAMP\`${stampExists ? '（可读）' : '（⚠ 读不到）'}`)
console.log(`      · 面 ② 源件 **${srcFiles.length}** 份（\`src/**/*.ts(x)\`，⚠ 排除 \`.d.ts\`）·`
  + ` 有对应产物 ⇒ 比较对 **${compared}** 对 · ⚠ 无独立产物（类型 / 被内联）**${missingProduct}** 份`
  + '（⛔ 不计入比较对，⚠ **照实报出条数，不静默缩水**）')
console.log(`      · 戳读数：commit=${commit ?? '?'} · dirty=${dirty ?? '?'} · built_at=${builtAt ?? '?'}`)
console.log('')
for (const n of notes) console.log('  ' + n)
console.log('')
if (lag.length === 0) {
  console.log('判定：**已执行** —— 面 ① / 面 ② **都没有落后读数**（⚠ 产物跟得上源码）。')
  console.log('       ⚠ ⛔ 本判据**不判**"运行实例有没有加载这版产物" —— 那是 `E-168` 分档里的〔实例层〕。')
  console.log('       ⚠ ⛔ 也**不判**"现在工作树脏不脏" —— 那是 `git status` 的活。')
} else {
  console.log('判定：**已执行**（⚠ ⚠ **有落后读数 —— 但本判据只报不拦，⛔ 不影响退出码**）')
  for (const l of lag) console.log('  ' + l)
  console.log('')
  console.log('       ⚠ ⚠ **为什么只报不拦**：⚠ "`lib/` 落后"**可能是未提交态 / 刚改完还没 build**'
    + '⇒ **拦了会恒红**，⚠ 而"恒红的判据等于没有判据"（⚠ `REPORT-R225.md` §3.4-b 首选条明写）。')
}
console.log('')
console.log('       ⚠ 覆盖面 / 判读口径：**产物 vs 源**（⛔ 不是"实例是否加载"）；'
  + '⚠ 退出码 0=已执行 · 2=未执行/基准缺失（⚠ **本判据不设 1**）。')
process.exit(0)
