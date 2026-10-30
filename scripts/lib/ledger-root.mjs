/**
 * ⚠⚠ **脚本侧唯一账本根解析实现**（2026-10-27 · 包 Q · `CHG-099` 第 4 条）
 * ══════════════════════════════════════════════════════════════════════
 *
 * ── 它治的病 ──────────────────────────────────────────────────────────
 *   改前**四个判据脚本各自写了一份** `resolveLedgerRoot` / `looksLikeLedger`，
 *   还有一个（`check-experience.mjs`）**硬编码** `join(root, '.hob')`。
 *   ⇒ 账本一搬，五份实现里有四份指向不存在的目录，而**没人知道哪一份是真口径**
 *     —— 那正是 `D1` ①「读侧与写侧必须用同一个解析入口」的反面。
 *
 * ── 与产品侧的关系（`CHG-099` 第 4 条后半）──────────────────────────────
 *   `src/server/doc-read.ts` 的 `resolveLedgerRoot` **保留自己的实现**
 *   （它要在宿主进程里跑，不能 import 一个 .mjs 脚本库）。
 *   ⇒ 两边**必须同口径**，故在 `check-orch-state.mjs` 里加一条**交叉断言**：
 *     同一组输入，两边算出的账本根必须一致；不一致 ⇒ 红。
 *   ⚠ ⛔ 不靠"两份都照文档写一遍"来保证一致 —— 那正是漂移的成因。
 *
 * ── 口径（与 `doc-read.ts` 逐条相同）────────────────────────────────────
 *   ① `cliLedger` 显式给 ⇒ 用它；
 *   ② `ledgerHome` + 工作区名 ⇒ `<ledgerHome>/<工作区名>/`；
 *   ③ 都没有 ⇒ `undefined`（⛔ **不许派生回 `<工作区>/.hob`**）。
 *   ⚠ **③ 不再有"本工作区 `.hob` 看起来像账本就用它"那一档** —— 该目录已不存在，
 *     留着它只会让"假搬"（软链/副本）继续被当成正典。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'

/** 预设行里声明账本父目录的那个键。 */
const LEDGER_HOME_RE = /ledgerHome:\s*(\S+)/

/**
 * 从预设行读 `ledgerHome`（与产品侧 `declaredLedgerHome()` 同源：都读预设配置）。
 * @returns 绝对路径字符串；读不到时 `null`
 */
export function ledgerHomeOf(root) {
  const cands = [
    join(root, 'preset', 'dsh-hob', 'preset-dsh-hob.patch.yml'),
    join(root, 'preset', 'preset-dsh-hob.patch.yml'),
  ]
  for (const p of cands) {
    try {
      const m = LEDGER_HOME_RE.exec(readFileSync(p, 'utf8'))
      if (m !== null && m[1] !== '') return m[1]
    } catch { /* 换下一个候选 */ }
  }
  return null
}

/** 工作区名：配置优先（`dsh-hob.workspace.json`），否则 git 目录名，最后目录名。 */
export function workspaceNameOf(root) {
  try {
    const cfg = JSON.parse(readFileSync(join(root, 'dsh-hob.workspace.json'), 'utf8'))
    if (typeof cfg?.workspaceName === 'string' && cfg.workspaceName.trim() !== '') {
      return cfg.workspaceName.trim()
    }
  } catch { /* 没配置 ⇒ 落回目录名 */ }
  try {
    const abs = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (abs !== '') return basename(dirname(abs))
  } catch { /* 不是 git 仓 ⇒ 落回目录名 */ }
  return basename(root)
}

/** 「这个目录看起来像不像一份账本」（与 `doc-read.ts` 的 `looksLikeLedger` 逐条相同）。 */
const CANON_FILES = ['REQUIREMENTS.md', 'PROJECT.md', 'DECISIONS.md', 'CONTEXT.md']
const SIDE_DIRS = ['volumes', 'archive', 'runtime']
export function looksLikeLedger(dir) {
  try { if (!statSync(dir).isDirectory()) return false } catch { return false }
  for (const f of CANON_FILES) {
    try { if (statSync(join(dir, f)).isFile()) return true } catch { /* 继续 */ }
  }
  for (const d of SIDE_DIRS) {
    try {
      const q = join(dir, d)
      // ⚠ 非空才算（与产品侧 `readdirSync(q).length > 0` 同一判据）
      if (statSync(q).isDirectory() && readdirSync(q).length > 0) return true
    } catch { /* 继续 */ }
  }
  return false
}

/**
 * 解析账本根。**这是脚本侧唯一实现**。
 *
 * ⚠⚠ **`homeOverride` 是为交叉断言而存在的**（`CHG-099` 第 4 条）：
 *   交叉断言要问"**同一组输入**下两边算得一样吗" —— 若本函数只会"自己去读预设行"，
 *   那它接收不到"把 `ledgerHome` 写成空串"这种输入，就**验不到两边同口径**。
 *   ⇒ 允许把 `ledgerHome` 显式传进来；缺省（`undefined`）仍走"读预设行"。
 *   ⚠ 它**只是把同一个值从外面递进来**，⛔ 不是第二套解析规则。
 *
 * @param root 工作区根（绝对路径）
 * @param cliLedger 命令行显式给的账本目录（可空）
 * @param homeOverride 显式指定 `ledgerHome`（交叉断言用；`undefined` ⇒ 读预设行）
 * @returns 账本目录绝对路径；判不出时 `undefined`
 */
export function resolveLedgerRoot(root, cliLedger, homeOverride) {
  if (typeof cliLedger === 'string' && cliLedger !== '') return cliLedger
  /**
   * ⚠⚠ **判据必须与产品侧 `doc-read.ts:resolveLedgerRoot` 逐条相同**：
   *   · `workspaceRoot === undefined` ⇒ **`undefined`**（⛔ 不许拿 `process.cwd()` 顶替）；
   *   · `home` 空 ⇒ **`undefined`**（⛔ 不许派生回工作区）；
   *   · 否则 ⇒ `join(home, 工作区名)`（⚠ **不检查该目录是否存在** ——
   *     产品侧也不查：它只管"账本该在哪"，"在不在"由调用方按可达性判）。
   *   ⚠ 改前本函数里的 `existsSync(cand) ? cand : undefined` **是产品侧没有的一档**
   *     ⇒ 那就是"两边不是一个口径"的实例，交叉断言正是用来抓它的。
   */
  if (root === undefined || root === '') return undefined
  const home = homeOverride === undefined ? ledgerHomeOf(root) : homeOverride
  if (home === null || home.trim() === '') return undefined
  return join(home, workspaceNameOf(root))
}
