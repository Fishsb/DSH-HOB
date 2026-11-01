#!/usr/bin/env node
/**
 * 产物构建戳 —— 往 `lib/BUILD-STAMP` 写一份「这份产物是怎么来的」的纯文本记录。
 *
 * ── 为什么需要它（本项目实测踩过，见 .hob/EXPERIENCE.md E-24 / E-25）────────
 * `lib/` 是 `src/` 的编译产物，且**被 `.gitignore` 忽略** ⇒ 「src 改了但没 build」
 * 这种漂移在 `git status` 里**完全看不见**（`git check-ignore -v lib/index.js`
 * 指向 `.gitignore:6:lib/`）。判「运行中的实例到底加载的是哪一版产物」时，
 * 过去只能靠 **mtime 推理**（产物 mtime 是否早于进程启动）—— 推理链条长、
 * 且 `lib/` 里任何一次无关写入都会污染结论。
 * ⇒ 本脚本在 build **最后一步**落一个戳，把"产物 ↔ 源码版本"的对应关系
 *   **写成可直读的数据**，而不是留给下一个人去算时间戳。
 *
 * ── 判据归属（重要）────────────────────────────────────────────────────
 * 戳只描述 **本地产物**：它是"哪个 commit 编译出来的、编译时工作树脏不脏、什么时候编的"。
 * ⚠ 它**不保证**运行中的进程已经加载了它 —— 「实例是否已加载这版产物」是**另一条判据**，
 *   正解是：**戳的 `built_at` 早于进程启动时刻**（有了戳，这一条从 mtime 推理
 *   升级为逐字比对）。本脚本只负责把戳写对，不负责证明加载。
 *
 * ── 落点与入库口径 ─────────────────────────────────────────────────────
 * 落点 `lib/BUILD-STAMP`（与 `lib/index.js` 同级）。`lib/` 已被忽略 ⇒ 戳**不进库**，
 * 这是**对的**（它描述的是本机这份产物，换台机器必然不同）。
 * ⚠ **不要**为它加 `.gitignore` 的 `!` 例外 —— 那会把"本地产物元数据"变成
 *   需要人工维护的入库物，与 `README §1`「格式进 git，内容不进」的切分相悖。
 *
 * 用法：node scripts/write-build-stamp.mjs
 * 退出码：0 = 已写入；1 = 写失败（build 应当因此失败，不要静默）
 * ⚠ 零第三方依赖（本仓纪律）。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/**
 * 跑一条 git 命令取 stdout（去尾空白）。
 * ⚠ git 不可用（非 git 仓 / 未装 git）**不抛** —— 戳的 `commit` 写 `unknown`，
 *   而不是让 build 崩掉：戳是**附加信息**，它的缺失不该阻断产物构建。
 */
function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

const commit = git(['rev-parse', 'HEAD']) ?? 'unknown'
/**
 * ⭐ **`commit_time`** —— 这个 commit 的**提交时刻**（2026-11-01 P40/R10 · `TASK-R10.md` §二）。
 *
 * ── ⚠⚠ 为什么需要它（它与 `built_at` 的区别是本轮要拆的那个循环）───────────
 *   `built_at` = **最后一次构建**的时刻 ⇒ **每跑一次 build 就往前跳**，而 `commit` 不变。
 *   于是任何"对应当前 commit"的旧证据，一 build 就"早于构建戳" ⇒ E-2 全红。
 *   ⚠ 这是**结构性**的：不是数据错，是判据拿了一个**会动的锚**。
 *
 *   `commit_time` = **这份代码诞生的时刻** ⇒ **同一 commit 反复 build 它不变**。
 *   那才是"旧读数冒充当前代码"该用的锚：一条读数若早于代码诞生，它不可能是这份代码的读数。
 *
 * ── ⚠ 取不到怎么办 ────────────────────────────────────────────────
 *   `git log` 不可用 / 非 git 仓 ⇒ 写 **`判不出`**（⛔ 不许编一个时刻）。
 *   E-2 见到 `判不出` ⇒ 报"判不出 N 条"，⛔ **不判红**
 *   （理由：拿一个不存在的锚去判红 = 每次 build 都误伤一遍，那正是本轮要拆的循环）。
 */
const commitTime = git(['log', '-1', '--format=%cI']) ?? '判不出'
const porcelain = git(['status', '--porcelain'])
const dirty = porcelain === null ? 'unknown' : porcelain === '' ? 'false' : 'true'

/** 本地时区的 ISO 8601（带时区偏移，如 2026-10-09T19:20:31+08:00）。 */
function localIso(d) {
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const oh = pad(Math.floor(Math.abs(off) / 60))
  const om = pad(Math.abs(off) % 60)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`
}

const stampPath = join(root, 'lib', 'BUILD-STAMP')
const text = [
  `commit=${commit}`,
  `commit_time=${commitTime}`,
  `dirty=${dirty}`,
  `built_at=${localIso(new Date())}`,
  'builder=build',
  '',
].join('\n')

try {
  mkdirSync(dirname(stampPath), { recursive: true })
  writeFileSync(stampPath, text, 'utf8')
} catch (e) {
  console.error(`[build-stamp] 写入失败：${stampPath}`)
  console.error(String(e?.message ?? e))
  process.exit(1)
}

console.log(`[build-stamp] ${stampPath}`)
console.log(`[build-stamp] commit=${commit} commit_time=${commitTime} dirty=${dirty}`)
