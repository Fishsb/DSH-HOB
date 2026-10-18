#!/usr/bin/env node
/**
 * `check:preflight` —— **判据的前置条件预检**（⚠ 只报告，不跑任何判据）。
 *
 * ── 它解决什么 ────────────────────────────────────────────────────────
 *   本仓有 12 族判据，其中**有若干族在"缺基准"时打 `未执行 / 不代表通过`（退出码 2）**。
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

/** 判据里"记录区"的派生口径与 `src/server/doc-read.ts` 同源（此处只读预设行，不引代码）。 */
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
  // ② 缺省派生态：`<工作区父目录>/.hob-ledgers/<工作区名>/`
  const fallback = join(dirname(resolve(root)), '.hob-ledgers', wsName)
  if (existsSync(fallback)) return { dir: fallback, how: 'derived' }
  return { dir: fallback, how: 'missing' }
}

/**
 * 跑一次体检。
 *
 * @returns {{ items: Array<{ key: string, present: boolean, line: string, affects: string[] }> }}
 *   `line` 是给人看的一句话（含"怎么补"）。
 */
export function preflight() {
  const items = []

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
    const present = how !== 'missing'
    items.push({
      key: 'ledger',
      present,
      line: present
        ? `记录区在位（${how === 'preset' ? '取自预设行声明' : '按缺省规则派生'}）：\`${dir}\``
        : `缺记录区：\`${dir}\` 不在 ⇒ **首次使用这是正常状态**（插件第一次在某工作区干活时会把它建出来）；`
          + '⚠ 在那之前，凡是要读记录区的判据都会打「未执行 / 不代表通过」—— 那不是"通过"',
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
