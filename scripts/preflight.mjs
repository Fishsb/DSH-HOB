#!/usr/bin/env node
/**
 * `check:preflight` —— **判据的前置条件预检**（⚠ 只报告，不跑任何判据）。
 *
 * ── 它解决什么 ────────────────────────────────────────────────────────
 *   本仓有多族判据（⚠ **条数以 `package.json` 的 `check:*` 实测为准**，⛔ 不在此写死 ——
 *   这行原先写着"12 族"，实况早已不是 12），其中**有若干族在"缺基准"时打
 *   `未执行 / 不代表通过`（退出码 2）**。
 *   ⚠ 那个约定本身是对的（"没查"与"查过且过"必须可区分），但它有一个代价：
 *   **外部人看不懂该先补什么** —— 他看到一堆"未执行"，不知道是要装依赖、要构建、
 *   还是要先把记录区建出来。
 *   ⇒ 本脚本把"缺什么 / 怎么补"用一句人话讲清，让 `未执行` 变成**可执行的下一步**。
 *
 * ── ⛔ 它不做什么 ─────────────────────────────────────────────────────
 *   ⛔ **不跑判据**（那是 `check:all` 的活）。
 *   ⛔ **不把"缺基准"美化成"通过"** —— 它只说明为什么这回跑不了。
 *   ⛔ **不写任何文件**。
 *
 * ── 用法 ─────────────────────────────────────────────────────────────
 *   `npm run check:preflight`（或 `node scripts/preflight.mjs`）
 *   退出码：**0**（⚠ 恒为 0 —— 它是一次**体检**，不是判据；缺东西也不该让外壳脚本变红，
 *   否则"缺依赖"与"判据失败"在 CI 里分不开）。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { workspaceName } from './workspace-name.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

/**
 * 账本根判据 —— **与 `src/server/doc-read.ts` 同口径：未配 `ledgerHome` ⇒ 判不出**。
 *
 * ⚠⚠ **R-11：删掉了「兄弟目录派生」那一档**（`<工作区父目录>/.hob-ledgers/<工作区名>/`）。
 *
 *   ── 改前是什么（同一件事三处口径）──────────────────────────────────────
 *     · `doc-read.ts:139-146`：空串 ⇒ `undefined`（**fail-closed**，⛔ 不猜）
 *     · `tools.ts` 的注释 + 本脚本的 ② 档：**仍派生兄弟目录**
 *     · `README.md`（已更正）：空串 = 判不出
 *   ⇒ **照 README 配的人会得到「账本落点判不出」的拒绝，而体检说「记录区在位」。**
 *
 *   ── 为什么体检必须跟着收严（⛔ 不是"体检可以宽松点"）──────────────
 *     体检的作用是**在动手前告诉你缺什么**。它若按一条**运行时不存在的规则**报「在位」，
 *     那不是"宽松"，是**给了一个假保证** —— 与「跳过不计入通过」是同一条纪律。
 *
 *   ⚠ 代价（照实记）：本仓历史上确实用过兄弟目录，**存量工作区可能真在那儿**。
 *     ⇒ 不静默删掉那一档，而是**把它降为"提示"**：`how: 'legacy-sibling'`，
 *       在体检行里**明说「这是历史布局，运行时不认，请显式配 ledgerHome」**。
 *       ⛔ 不许把它当 `present: true` 的正规在位。
 */
export function deriveLedgerRoot() {
  // ① 预设行声明的 `ledgerHome`（唯一权威；⛔ 不硬编码本机路径）
  const candidates = []
  try {
    const preset = readFileSync(join(root, 'preset', 'dsh-hob', 'preset-dsh-hob.patch.yml'), 'utf8')
    const m = /ledgerHome:\s*(\S+)/.exec(preset)
    if (m !== null && m[1] !== '') candidates.push(m[1])
  } catch { /* 预设读不到 ⇒ 走下面的派生态 */ }
  // ⚠ 工作区名**从配置读**（唯一来源 = `scripts/workspace-name.mjs`）；未配置 ⇒ 落回 `basename(root)`。
  //   ⛔ 不再由本脚本自己猜目录名（隔离 worktree 里目录名 = 卡 id ⇒ 会派到不存在的账本区）。
  const wsName = workspaceName(() => basename(root))
  for (const home of candidates) {
    const dir = join(home, wsName)
    if (existsSync(dir)) return { dir, how: 'preset' }
  }
  /**
   * ② ⚠ **历史布局（运行时已不认）**：`<工作区父目录>/.hob-ledgers/<工作区名>/`
   *
   * ⚠ 单独一个 `how`，⛔ 不与 `preset` 混。调用方据此把它当**提示**而不是"在位"。
   */
  const legacySibling = join(dirname(resolve(root)), '.hob-ledgers', wsName)
  if (existsSync(legacySibling)) return { dir: legacySibling, how: 'legacy-sibling' }
  /**
   * ③ **判不出** —— 与运行时同口径。
   *   `dir` 给一个"本该在哪"的示意（预设父目录 + 工作区名），但 `how` 明说是 missing。
   */
  const expected = candidates.length > 0 ? join(candidates[0], wsName) : undefined
  return { dir: expected, how: 'missing' }
}

/**
 * 跑一次体检。
 *
 * @returns {{ items: Array<{ key: string, present: boolean, line: string, affects: string[] }> }}
 *   `line` 是给人看的一句话（含"怎么补"）。
 */
export function preflight() {
  const items = []

  // ── ⓪ Node 运行时（2026-10-24 · B 席 · 补"声明面 vs 现实"的体检）──────────
  /**
   * ── 为什么需要它（缺口有实测出处）──────────────────────────────────────
   *   本仓的判据脚本大量**直接 `import('./src/xxx.ts')`**（`check:policy` /
   *   `check:policy-cross` / `check:hob-gate` / `check:hob-create-dom` / …），
   *   靠的是 **Node 的 type-stripping**。⚠ 而 `package.json` 的 `engines` 此前只写
   *   `node: ">=20"` —— Node 20 上那条 import **必然**抛
   *   `ERR_UNKNOWN_FILE_EXTENSION: Unknown file extension ".ts"`（实测：
   *   `node --no-experimental-strip-types -e "import('./src/shared/work-mode.ts')"`）。
   *   ⇒ 声明与实现对不上：按 `engines` 装 Node 20 的人，跑 `npm run check` 会看到
   *     **一串看不懂的崩溃**，而没有任何东西告诉他"是 Node 版本不够"。
   *
   * ⚠ 本条**只体检、不拦**（本文件恒 exit 0）；真正的牙口有两条：
   *   ① `check-repo-rules.mjs` 断言 `engines.node` 的下界 **≥ 22.18**
   *      （type-stripping 从 22.18 起**默认开启**；再低就要带 flag）；
   *   ② 本项在"运行时实际不支持"时**明确说出来**，让那一串崩溃有归因。
   */
  {
    const ver = process.versions.node
    const parts = ver.split('.').map((x) => Number(x))
    const atLeast = (a, b, c) => parts[0] > a || (parts[0] === a && (parts[1] > b || (parts[1] === b && parts[2] >= c)))
    /** ⚠ Node 的权威读数：`process.features.typescript`（`false` / `'strip'` / `'transform'`）。 */
    const strip = process.features.typescript
    const okVer = atLeast(22, 18, 0)
    const present = okVer && strip !== false && strip !== undefined
    let line
    if (present) {
      line = `Node 运行时 \`v${ver}\` 支持 **type-stripping**（\`process.features.typescript=${JSON.stringify(strip)}\`）`
        + ' ⇒ 判据里那些 `import(\'./src/x.ts\')` 能跑'
    } else {
      line = `Node 运行时 \`v${ver}\` **不支持 type-stripping**`
        + `（\`process.features.typescript=${JSON.stringify(strip)}\` · 需要 **≥ 22.18**）`
        + ' ⇒ ⚠ 凡**直接 `import(\'.ts\')`** 的判据都会抛 `ERR_UNKNOWN_FILE_EXTENSION`，'
        + '那时的红**不是被测对象的问题**，是这台机器的 Node 太旧（先升级 Node）'
    }
    items.push({
      key: 'node',
      present,
      line,
      affects: present ? [] : ['check:policy', 'check:policy-cross', 'check:hob-gate', 'check:hob-create-dom',
        'check:hob-create', 'check:presets', 'check:config', 'check:readings'],
    })
  }

  // ── ① node_modules ────────────────────────────────────────────────────
  {
    const dir = join(root, 'node_modules')
    let present = false
    try { present = statSync(dir).isDirectory() && existsSync(join(dir, '@deepseek-ai')) } catch { present = false }
    items.push({
      key: 'node_modules',
      present,
      line: present
        ? '依赖目录 `node_modules/` 在位（含 `@deepseek-ai/*`）'
        : '缺依赖：`node_modules/` 不在或没有 `@deepseek-ai/` 子目录 ⇒ 跑 `pnpm install`（或 `npm install`）。'
          + '⚠ 依赖缺时，凡是要读宿主源码 / 真跑产物的判据都会打「未执行」',
      affects: present ? [] : ['check:client', 'check:gitignore（断言 C 读宿主包）'],
    })
  }

  // ── ② 构建产物 lib/ ──────────────────────────────────────────────────
  {
    const libDir = join(root, 'lib')
    const stamp = join(libDir, 'BUILD-STAMP')
    let present = false
    try { present = statSync(libDir).isDirectory() && existsSync(join(libDir, 'index.js')) } catch { present = false }
    const hasStamp = existsSync(stamp)
    let line
    if (!present) {
      line = '缺产物：`lib/` 不在（或没有 `lib/index.js`）⇒ 跑 `npm run build`。'
        + '⚠ `lib/` 是编译产物且**不入版本库** —— 不 build 直接装会得到一个空壳包'
    } else if (!hasStamp) {
      line = '产物在、但缺 `lib/BUILD-STAMP` ⇒ 跑 `npm run build`（它是"产物↔源码对应关系"的唯一读数）'
    } else {
      line = '构建产物 `lib/` 与 `lib/BUILD-STAMP` 都在位'
    }
    items.push({
      key: 'lib',
      present: present && hasStamp,
      line,
      affects: present && hasStamp ? [] : ['check:build', 'check:host', 'check:modules'],
    })
  }

  // ── ③ 记录区（账本区）────────────────────────────────────────────────
  {
    const { dir, how } = deriveLedgerRoot()
    /**
     * ⚠⚠ **R-11：`legacy-sibling` ⛔ 不算「在位」。**
     *   它是**历史布局**，运行时的 `resolveLedgerRoot` 已经**不再派生**它
     *   ⇒ 若体检把它报成在位，用户会去配一个运行时不认的路径，然后在第一次写账本时被拒。
     */
    const present = how === 'preset'
    const legacy = how === 'legacy-sibling'
    items.push({
      key: 'ledger',
      present,
      line: present
        ? `账本父目录在位（取自预设行声明）：\`${dir}\``
        : legacy
          ? ('⚠ **历史布局**：`' + dir + '` 存在，但**运行时不认这一档**（resolveLedgerRoot 已删除兄弟目录派生）'
            + '\n      ⇒ 要么在预设里显式写 ledgerHome，要么把账本搬过去；⛔ 别指望工具自己找到它')
          : `缺账本父目录：\`${dir ?? '(预设未声明 ledgerHome)'}\` ⇒ **首次使用这是正常状态**（插件第一次在某工作区干活时会把它建出来）；`
            + '⚠ 在那之前，凡是要读账本区的判据都会打「未执行 / 不代表通过」—— 那不是"通过"',
      affects: present ? [] : ['check:archive', 'check:rounds', 'check:readings', 'check:gitignore（账本区那几组）'],
    })
  }

  return { items }
}

/**
 * 判据族数 —— ⚠ **派生**自 `package.json` 的 `scripts`（⛔ 不写死；写死必漂）。
 *
 * 口径与 `check-all.mjs` 的 `listFamilies()` 同源：`check:*` 除去调度器与预检自身。
 * 读不到 ⇒ `undefined`（调用方按"全部"表述，⛔ 不编一个数字）。
 */
export function countFamilies() {
  let scripts = {}
  try {
    scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {}
  } catch { return undefined }
  const names = Object.keys(scripts)
    .filter((k) => k.startsWith('check:'))
    .filter((k) => k !== 'check:all' && k !== 'check:preflight')
  return names.length === 0 ? undefined : names.length
}

/** 打印体检结果（人读形态）。 */
export function printPreflight({ items }) {
  console.log('判据前置条件预检 · dsh-hob（⚠ 只报告，不跑判据）')
  console.log('')
  for (const it of items) {
    console.log(`  ${it.present ? '✓' : '✗'} ${it.line}`)
    if (it.affects.length > 0) {
      console.log(`      受影响：${it.affects.join(' · ')}`)
    }
  }
  const missing = items.filter((i) => !i.present)
  console.log('')
  if (missing.length === 0) {
    // ⚠ 族数**派生**自 package.json（⛔ 不写死 —— 写死就会漂）
    const n = countFamilies()
    console.log(`判定：前置条件齐备 —— ${n === undefined ? '全部' : n} 族判据都应当能真跑。`)
  } else {
    console.log(`判定：**${missing.length} 项前置条件不满足**（${missing.map((m) => m.key).join(' / ')}）`)
    console.log('       ⇒ 按上面每条的「怎么补」处理；补齐前，相关判据打「未执行」不代表通过。')
  }
  console.log('')
  console.log('       ⚠ 本命令恒 exit 0 —— 它是一次体检，不是判据；缺东西不该让外壳脚本变红。')
}

// ⚠ 只在**被直接执行**时打印（import 本模块时**不**触发，供 `check:all` 复用）。
if (process.argv[1] !== undefined && process.argv[1].endsWith('preflight.mjs')) {
  printPreflight(preflight())
  process.exit(0)
}
