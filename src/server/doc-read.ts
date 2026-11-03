/**
 * 文档读取的守卫与上限：**唯一**的路径校验与截断实现点。
 *
 * 被多处共用，避免守卫逻辑写两遍而漂移（⚠ 2026-10-21 第 333 轮 · **丁-8** 订正）：
 *   · `server/workspace-read.ts` —— 读**工作区**内的文件（它的包含性 / 软链守卫从这里来）
 *   · `server/hob-write.ts`      —— 写账本时的越界与软链守卫
 *   · `modules/orchestrator.ts`  —— `resolveLedgerRoot` 的账本根解析
 *   ⚠ **订正说明**：本条原写作「`tools/read-contracts.ts`」与「`server/llm-bridge.ts`」，
 *     而**这两个路径都不存在**（实测 `src/tools/` 整个目录没有、`server/llm-bridge.ts` 也没有）
 *     ⇒ 读注释的人会去找两个找不到的文件。现在按**实际 import 本模块的地方**重写。
 *
 * 权限边界（硬约束）：
 *   只允许读**账本目录**内的 **.md** 与 **.toml**；其余后缀或越界一律拒绝。
 *   ⚠ 2026-11-02（`CHG-2035` 轨 A）**只加了 `.toml` 一个后缀**，目录范围未动
 *     —— 理由见 {@link isToml}（`units/` 是唯一状态源，此前能写读不到）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { lstat, readFile, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/**
 * 被拒绝的统一话术：不区分「不存在」与「不允许」，避免泄露存在性。
 *
 * ⚠ **v4 起边界是「账本目录」而不是「工作区根」**（用户决策 D7）——
 *   账本已迁出工作区（按工作区名派生到工作区之外）。
 *   ⇒ 话术同步改为「本工作区的账本」，否则**说法与行为不符**（挂着失效内容）。
 */
export const DENIED = '拒绝：只能读取本工作区账本目录内的 .md / .toml 文档。'

/**
 * 解析工作区根目录（fail-closed）。
 *
 * 取值口径：① 显式配置 workspaceRoot；② 会话 cwd。
 * 刻意不退回 process.cwd()：宿主进程 cwd 是 DSH profile 目录，
 * 退回它会让工具读到 profile 下的 .md，也会把 .hob/ 建错位置。
 */
export function resolveWorkspaceRoot(configuredRoot: string, sessionCwd?: string): string | undefined {
  const configured = configuredRoot.trim()
  if (configured) return resolve(configured)
  if (sessionCwd) return resolve(sessionCwd)
  return undefined
}

/**
 * 解析**账本目录**（v4：账本已迁出工作区，按工作区派生）。
 *
 * ── 为什么需要它 ──────────────────────────────────────────────────
 *   账本不再落在 `<工作区>/.hob/`，而在**工作区之外**、**按工作区名独立**的目录里
 *   （用户决策 D3/D4：`/home/lk/FF/.hob-ledgers/<工作区名>/`）。
 *   隔离由**文件系统**保证，不靠契约约束。
 *
 * ── 为什么不能是静态配置值 ────────────────────────────────────────
 *   实测：静态相对路径（如 `../.hob`）会让**所有工作区撞进同一个目录**
 *   （`resolve('/FF/a','../.hob')` 与 `resolve('/FF/b','../.hob')` 都得到 `/FF/.hob`）
 *   ⇒ 必须**按工作区名派生**，否则违反「每个工作区独立、不可放一起」。
 *
 * ── 取值口径（顺序有意义）──────────────────────────────────────────
 *   ① 显式 `ledgerRoot` —— 直接指定，最高优先级（便于特殊工作区覆盖）；
 *   ② **工作区名**（见下「工作区名从哪来」）+ `ledgerHome` —— 派生（配了就用它）；
 *   ③ 都没配 ⇒ **工作区的兄弟目录 `<工作区父目录>/.hob-ledgers/<工作区名>/`**
 *      —— ⚠ **可移植**：不含任何本机绝对路径，换机器/换用户自动成立；
 *   ④ 连工作区都判不出 ⇒ `undefined`（fail-closed：调用方拒绝，不猜）。
 *
 * ── 工作区名从哪来（⚠ 2026-10-18 · 第四张隔离卡 + 本批）────────────────
 *   ① **配置文件**（唯一来源）：`<工作区根>/dsh-hob.workspace.json` 的 `workspaceName`。
 *      ⇒ 与**判据脚本**同一份文件、同一个字段（见 `scripts/workspace-name.mjs`）：
 *        判据侧与运行时侧**不是两套口径** —— 这是本批要治的东西。
 *   ② **不带配置 / 写坏**（文件不在 / 非法 JSON / 缺字段 / 不是单段目录名）⇒
 *      落回 `basename(<工作区根>)` = **改动前的行为**（向后兼容，逐字一致）。
 *
 *   ⚠ **为什么运行时不能直接 import `scripts/workspace-name.mjs`**：
 *     `src/` 与 `scripts/` 是**两棵互不依赖的树**（脚本不得成为产品依赖；
 *     且 `package.json` 的 `files` 只发 `lib` —— 装上后根本没有 `scripts/`）。
 *     ⇒ 只能**照抄同一套口径**，并由机检钉住（见下「同源」那一段）。
 *
 *   ⚠ **为什么必须修这一处**：这是 `R-24` 的另一半。判据脚本修好之后，
 *     运行时若仍用目录名猜 ⇒ **判据报绿、运行时却把账本区认到别处**
 *     （隔离 worktree 里目录名 = 卡 id ⇒ 读写到一个不该存在的账本区）。
 *
 * ⚠ **为什么 ③ 用"兄弟目录"而不是硬编码 `/home/lk/FF/.hob-ledgers`**：
 *   硬编码会把插件绑死在本机路径上 —— 实测（2026-10-08 重启后复核）在
 *   `cwd=/home/bob/work/myproj` 的新环境里，账本会被写到 **`/home/lk/FF/...`**
 *   （上一台机器的路径，可能不存在或无权限）。这撞本项目一贯的
 *   **可移植性口径（UD-73③）**。⇒ 缺省值必须**从工作区推导**，不能是常量。
 *
 * ── 为什么 ③ 仍然满足"不与代码混放" ─────────────────────────────
 *   兄弟目录在**工作区之外**（`..` 一级），不是工作区内部 ⇒ 与代码物理分开，
 *   且"每个工作区一个子目录"的隔离**不依赖任何配置**。
 *
 * @param ledgerRoot - 显式账本目录（绝对路径）。
 * @param ledgerHome - 账本父目录；留空 ⇒ 用兄弟目录缺省。
 * @param workspaceRoot - 已解析的工作区根（用来取目录名与父目录）。
 * @returns 账本目录绝对路径；判不出时为 undefined。
 */
export function resolveLedgerRoot(
  ledgerRoot: string,
  ledgerHome: string,
  workspaceRoot: string | undefined,
): string | undefined {
  const explicit = ledgerRoot.trim()
  if (explicit) return resolve(explicit)

  // 工作区名：**配置优先**，未配置/写坏 ⇒ 落回目录名（= 改动前的行为）
  // ⚠ 根目录本身没有名字 ⇒ 判不出（fail-closed，⛔ 不猜）
  if (workspaceRoot === undefined) return undefined
  const ws = resolve(workspaceRoot)
  const base = workspaceNameOf(ws)
  if (base === '' || base === sep) return undefined

  /**
   * ══════════════════════════════════════════════════════════════════════
   * **2026-10-27 · 包 Q（`CHG-091` / `CHG-099`）：账本移出工作区**
   * ══════════════════════════════════════════════════════════════════════
   *
   * ── 为什么必须搬（不是洁癖）──────────────────────────────────────────
   *   账本曾在 `<工作区>/.hob/`，而**实施侧对工作区有写权限**
   *   ⇒ 「账本只有一个写者」从来是**约定，不是机制**。
   *   ⇒ 只有搬到工作区之外，它才**够不到**。
   *
   * ── 改前那一版的三档（已删）──────────────────────────────────────────
   *    ③ `looksLikeLedger(<ws>/.hob)` ⇒ 用它（**新正典**）；
   *    ④ `ledgerHome` + 工作区名（过渡桥）；
   *    ⑤ 兜底 `join(ws, '.hob')`（**又派生回工作区**）。
   *   ⚠ 搬完之后 ③ **永远为假**（目录已不存在）、⑤ **会把账本重新指回工作区里**
   *     —— 那等于"账本还在工作区"，是假搬。⇒ ③ 删、⑤ 删。
   *
   * ── 现在只有两档（`CHG-099` 已批）────────────────────────────────────
   *    ① `ledgerRoot` 显式给 ⇒ 用它（最优先，不变）；
   *    ② `ledgerHome` + 工作区名 ⇒ `<ledgerHome>/<工作区名>/`（**唯一缺省**）。
   *   ⚠ **一个派生到工作区里的路径都不剩** —— 这是本档的全部意义。
   *
   * ── ⑤ 为什么**不返回 `undefined` 了事**（`CHG-099` 第 2 条）────────────────
   *   "账本没读到" ≠ "没有账本"：前者该去查配置/磁盘，后者才是"这个项目还没有账本"。
   *   两者给同一句 `undefined`，读的人会把"我配错了"读成"本来就没有"
   *   ⇒ 与 `R4` / `R7` 同一族错误（**空态与没发生必须可分辨**）。
   *   ⇒ 现在**没配 `ledgerHome`** 时返回 `undefined`，同时由
   *     {@link ledgerRootWhy} 给出**可读原因**（调用方负责把它印出来）。
   */
  const home = ledgerHome.trim()
  if (home !== '') return resolve(home, base)

  /**
   * ⚠ **到此 = 判不出**（⛔ 不许再派生回工作区）。
   *   `ledgerRootWhy()` 会给出原因；本条只负责**不猜**。
   */
  return undefined
}

/**
 * ⚠⚠ **账本根"判不出"的可读原因**（`CHG-099` 第 2 条：⛔ 不许只 `return undefined`）────────
 *
 * ── 它治的病 ──────────────────────────────────────────────────────────
 *   `resolveLedgerRoot()` 返回 `undefined` 是**同一个值**，可是它背后至少有三种成因：
 *     · 没配 `ledgerHome`（**配置面**：该去补配置）；
 *     · `workspaceRoot` 判不出（**调用面**：没给 cwd）；
 *     · 工作区名解析成空（**路径面**：根目录本身没有名字）。
 *   ⇒ 三者给同一句话 ⇒ 读的人只能猜。本条把它们**分开说**。
 *
 * ⚠ 只给原因，**不给结论**（仍然 `undefined` ⇒ 调用方仍然 fail-closed）。
 */
export type LedgerRootWhy =
  | { kind: 'ok' }
  | { kind: 'no-workspace'; why: string }
  | { kind: 'no-name'; why: string }
  | { kind: 'no-ledger-home'; why: string }

export function ledgerRootWhy(
  ledgerRoot: string,
  ledgerHome: string,
  workspaceRoot: string | undefined,
): LedgerRootWhy {
  if (ledgerRoot.trim() !== '') return { kind: 'ok' }
  if (workspaceRoot === undefined) {
    return { kind: 'no-workspace', why: '没给工作区根（`workspaceRoot` 为 undefined ⇒ 判不出该用哪本账）' }
  }
  const ws = resolve(workspaceRoot)
  const base = workspaceNameOf(ws)
  if (base === '' || base === sep) {
    return { kind: 'no-name', why: `工作区 \`${ws}\` 解析不出目录名（根目录本身没有名字）` }
  }
  if (ledgerHome.trim() === '') {
    return {
      kind: 'no-ledger-home',
      why: '没配 `ledgerHome`（账本已移出工作区，⛔ 不再派生到 `<工作区>/.hob`）'
        + ' ⇒ 该去预设行补 `ledgerHome: <账本父目录>`',
    }
  }
  return { kind: 'ok' }
}

/**
 * 工作区名配置文件（**工作区根**上，被 git 跟踪 ⇒ 随分支走）。
 *
 * ⚠ ⚠ **必须与 `scripts/workspace-name.mjs` 的 `WORKSPACE_CONFIG_FILE` 逐字相同** ——
 *   两侧是同一处口径的两个副本（`src/` 与 `scripts/` 互不 import，只能照抄）。
 *   机检：`npm run check:gitignore` 的 **S 组**比对这两个字面量（见该脚本 S 组注释）。
 */
export const WORKSPACE_CONFIG_FILE = 'dsh-hob.workspace.json'

/** 配置里承载工作区名的字段（⚠ 同上：与 `scripts/workspace-name.mjs` 的 `WORKSPACE_NAME_KEY` 逐字相同）。 */
export const WORKSPACE_NAME_KEY = 'workspaceName'

/**
 * 工作区名：**① 配置**（唯一来源）→ **② 目录名**（未配置/写坏的向后兼容路径）。
 *
 * ⚠ 与 `scripts/workspace-name.mjs` 的 `workspaceName()` **同一套判定**：
 *   配置在且合法 ⇒ 用配置；不在 / 非法 JSON / 缺字段 / 不是单段目录名 ⇒ 落回 `basename(ws)`。
 *
 * ⚠ 与脚本侧**唯一的有意差别**：这里**不打印**诊断。运行时装在每个会话的热路径上，
 *   每读一次账本就打一行 stderr 会污染宿主日志；"配置写坏了"这件事由
 *   **判据侧**（`scripts/workspace-name.mjs`，只在跑 `npm run check` 时）报出来。
 *   ⇒ 后果要说清：**运行时静默落回旧猜法**（⛔ 不静默变绿 —— 判据会红）。
 *
 * 安全：只接受**单段目录名**（`/`、`\`、`.`、`..` 一律视为写坏）
 *   ⇒ ⛔ 不许用配置把账本区派到工作区之外。
 *
 * @param ws - 已 `resolve` 的工作区根。
 * @returns 工作区名；判不出时为空串（调用方 fail-closed）。
 */
export function workspaceNameOf(ws: string): string {
  const fallback = basename(ws)

  let raw: string
  try {
    raw = readFileSync(join(ws, WORKSPACE_CONFIG_FILE), 'utf8')
  } catch {
    return fallback   // 文件不在 ⇒ 未配置
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fallback   // 非法 JSON ⇒ 按未配置处理
  }

  const value = parsed === null || typeof parsed !== 'object'
    ? undefined
    : (parsed as Record<string, unknown>)[WORKSPACE_NAME_KEY]
  if (typeof value !== 'string' || value.trim() === '') return fallback

  const name = value.trim()
  if (name === '.' || name === '..' || /[\\/]/.test(name)) return fallback
  return name
}

/**
 * 账本目录名（**工作区自己目录下的**一层）。
 *
 * ⚠ 2026-10-25（C 步）：**这是"账本落在哪"的唯一常量**。
 *   `/home/lk/FF/dsh-hob`  ⇒ `/home/lk/FF/dsh-hob/.hob`
 *   `/home/bob/work/myproj` ⇒ `/home/bob/work/myproj/.hob`
 *
 * ⚠ **与它替代掉的旧常量 `DEFAULT_LEDGER_DIR = '.hob-ledgers'` 的区别**（不只是改名）：
 *   · 旧：`<工作区父目录>/.hob-ledgers/<工作区名>/` —— 账本在工作区**之外**，且**用名字做子目录键**；
 *   · 新：`<工作区>/.hob/` —— 账本在**工作区之内**，键就是工作区路径本身。
 *
 * ⚠ **为什么不再保留 `.hob-ledgers` 那个兜底**：实测 `resolve(dirname(ws), '.hob-ledgers', base)`
 *   指向的 `/home/lk/FF/.hob-ledgers/dsh-hob` **从未存在过** ⇒ 保留它等于保留一条
 *   "配置一空就静默落到空目录"的暗路。**已删除**（不是改名、不是改值）。
 */
export const LEDGER_DIR_IN_WORKSPACE = '.hob'

/**
 * 「这个目录看起来像不像一份账本」—— 用于 `resolveLedgerRoot` 的 ③ 档判定。
 *
 * ⚠ **为什么不能只判 `existsSync(dir)`**：`.hob/` 在本项目**同时承载记录层**
 *   （`EXPERIENCE.md` / `experience/`），光"目录在"不能说明账本已经搬进来。
 *   若只判存在 ⇒ 未迁移的部署会被误判成"账本在 `.hob/`" ⇒ 读到空账本、全族报绿/报红都不对。
 *
 * **判据**：目录在，且**至少有一件账本特征**：
 *   · 正本之一（`REQUIREMENTS.md` / `PROJECT.md` / `DECISIONS.md` / `CONTEXT.md`），或
 *   · `volumes/` / `archive/` / `runtime/` 任一子目录在。
 *
 * ⚠ 这是**启发式**，不是权威：⚠ 一个只有 `archive/` 的 `.hob/`（历史残留）也会被认成账本。
 *   ⇒ 已知边界：本项目的 `.hob/archive` 目前是**空目录**且确实属记录层历史位，
 *     若将来它变成非空，本函数会把 `.hob/` 认成账本 —— 那时应改用显式标记（见 REPORT 待决问题）。
 */
export function looksLikeLedger(dir: string): boolean {
  try {
    if (!statSync(dir).isDirectory()) return false
  } catch {
    return false   // 目录不在 / 无权限 ⇒ 不是账本（fail-closed，由调用方走下一档）
  }
  for (const f of LEDGER_CANON_FILES) {
    try {
      if (statSync(join(dir, f)).isFile()) return true
    } catch { /* 该件不在 ⇒ 继续看 */ }
  }
  for (const d of LEDGER_SIDE_DIRS) {
    try {
      const p = join(dir, d)
      // ⚠ **必须非空**：空目录不是账本证据（见下方「空目录不算账本」那一段）
      if (statSync(p).isDirectory() && readdirSync(p).length > 0) return true
    } catch { /* 该目录不在 / 读不到 ⇒ 继续看 */ }
  }
  // ⚠ **空目录不算账本**（2026-10-25 实测补的正门）：
  //   本项目的 `.hob/archive/` 是**空目录**（记录层历史位），但按上面那条会被判成"像账本"
  //   ⇒ 未迁移的部署会被误认成"账本已在 `.hob/`"，读到空账本。
  //   ⇒ 只有**正本文件**或**非空的**侧目录才算证据。
  return false
}

/** 「像账本」判据：正本文件名（⚠ 与 `kit/INIT.md` §3.1 的四份同源）。 */
const LEDGER_CANON_FILES = ['REQUIREMENTS.md', 'PROJECT.md', 'DECISIONS.md', 'CONTEXT.md'] as const

/** 「像账本」判据：账本侧目录（⚠ `volumes/` 是本项目独有；`archive/` `runtime/` 简版账本也有）。 */
const LEDGER_SIDE_DIRS = ['volumes', 'archive', 'runtime'] as const

/**
 * 把请求路径落到绝对路径，并判断是否真的落在 root 之内。
 *
 * 关键点：`startsWith(root)` 单独用是错的 —— 根 `/a/b` 会错误放行 `/a/b-evil`。
 * 这里用 path.relative 求规范化相对路径，再判断它是否仍在本目录内
 * （等价于「绝对路径前缀 + 分隔符边界」，且天然处理冗余分隔符与 `..` 穿越）。
 *
 * ⚠ 本函数**只做字符串层的越界判断**，不看文件系统 ⇒ 它挡不住符号链接
 *   （软链的路径字符串仍在 root 内，但真实目标在区外）。软链由
 *   {@link findSymlinkOnPath} 另行拦截 —— 两者必须**一起**用才是完整的越界检查。
 */
export function resolveInside(root: string, requested: string): { abs: string; inside: boolean } {
  const abs = resolve(root, requested)
  const rel = relative(root, abs)
  const inside = rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))
  return { abs, inside }
}

/**
 * 从 `rootDir` 到 `absTarget` 逐段 lstat，**任一段是符号链接即返回它**。
 *
 * 为什么放在本文件（读侧）：本文件不 import `hob-write.ts`，所以它可以被两侧共用
 * 而不成环；`hob-write.ts` 已经 import 本文件。**读侧与写侧共用这一份实现**
 * （「守卫逻辑只写一份」）。
 *
 * ⚠ 历史（2026-10-05 第 4 步的实测发现）：本文件原先只写了
 *   "已知限制：未跟随符号链接……当前不处理；如需收紧再加"。
 *   **实测确认这是真漏洞**：工作区内放一个指向区外的 `.md` 软链，
 *   `read_contracts` 就把区外内容原样读了出来。因为任务书把
 *   "跟随符号链接"列为**必须拦住的场景**，本步把它收紧：
 *   读之前逐段 lstat，命中软链即拒绝（与写侧同口径）。
 *
 * @param rootDir - 允许范围的根（工作区根 / `.hob/`）。
 * @param absTarget - 已 resolve 的目标绝对路径。
 * @returns 命中的软链接绝对路径；无则 null。
 */
export async function findSymlinkOnPath(rootDir: string, absTarget: string): Promise<string | null> {
  const rel = relative(rootDir, absTarget)
  if (rel === '') return null
  const parts = rel.split(sep)
  let cur = rootDir
  for (const part of parts) {
    cur = join(cur, part)
    try {
      const st = await lstat(cur)
      if (st.isSymbolicLink()) return cur
    } catch {
      // 该段尚不存在（首次创建 / 目标不存在）⇒ 之后的段更不可能存在，停止。
      break
    }
  }
  return null
}

/** 是否为 .md（大小写不敏感，适配 Windows 侧文件）。 */
export function isMarkdown(p: string): boolean {
  return p.toLowerCase().endsWith('.md')
}

/**
 * 是否为 `.toml`（大小写不敏感，理由同上）。
 *
 * ⚠ **只加这一个扩展名**（2026-11-02 · `CHG-2035` 轨 A）：
 *   `ledger/units/` 是账本的**唯一状态源**，而读侧此前只认 `.md`
 *   ⇒ Hob **能写它、读不到它** ⇒ 每次改索引都是**盲写**（历史上盲写丢过 6417 字节）。
 *   ⇒ 读侧补上 `.toml`，让"写过的那个文件"读得回来。
 *
 * ⚠ ⚠ **目录范围一个字节都没放宽**：本函数只管**后缀**，越界仍由
 *   {@link resolveInside} 挡、软链仍由 {@link findSymlinkOnPath} 挡。
 *   ⛔ 别把这条理解成"账本区外也能读了" —— 那是另一条判据（`outside-root`），本条不碰它。
 */
export function isToml(p: string): boolean {
  return p.toLowerCase().endsWith('.toml')
}

/**
 * 读侧**可读后缀**的唯一判定（`.md` 与 `.toml`）。
 *
 * ⚠ 写成"一个函数"而不是两处 `if`：读侧只允许**一处**决定"什么后缀能读"，
 *   否则加第三个后缀时会漏改一处而静默放行（与 `DENIED` 只写一处同一条纪律）。
 */
export function isReadableDoc(p: string): boolean {
  return isMarkdown(p) || isToml(p)
}

export interface ReadResult {
  /** 是否成功读到内容。 */
  ok: boolean
  /** 正文（可能是截断后的）。 */
  text: string
  /** 是否发生了截断。 */
  truncated: boolean
  /** 文件实际大小（字节）；读失败时为 0。 */
  bytes: number
  /**
   * 失败原因的**机器可判类别**（ok=false 时给；成功时不设）。
   *
   * ⚠ ⚠ **它只用于内部结构化返回，⛔ 不进对外文案** —— `text` 仍是同一句 `DENIED`
   *   （不区分"不存在"与"不允许"是**有意的**安全考量：不泄露存在性）。
   *   ⇒ 两种消费者各取所需：**模型/调用方**按 `reason` 分类处理，
   *     **用户**看到的话术仍不泄露存在性。
   *
   * 五族互不重叠（⛔ 不许把两族并成一个值 —— 那正是"原因取不到"的另一种形态）：
   *   · `not-md`       —— 后缀不符（既不是 `.md` 也不是 `.toml`；⚠ 值名沿用旧称，
   *                       改值会破坏 `tools.ts` 的透传契约，故只在此注明实际判定）；
   *   · `outside-root` —— 路径越出账本根（`../` 穿越、绝对路径越界等）；
   *   · `symlink`      —— 路径链上有符号链接（不跟随）；
   *   · `not-found`    —— `.md` 且在界内，但文件不存在 / 不可 stat；
   *   · `read-error`   —— 文件在，但读取过程失败（权限 / IO）。
   */
  reason?: ReadReason
}

/** {@link ReadResult.reason} 的取值族（⛔ 只增不并：每族必须能单独分辨）。 */
export type ReadReason = 'not-md' | 'outside-root' | 'symlink' | 'not-found' | 'read-error'

/**
 * 读一个工作区内的 .md，带字节上限。
 *
 * @param root - 工作区根目录（绝对路径）。
 * @param relPath - 相对路径。
 * @param maxBytes - 单文件上限；超出则截断并在正文尾部明确标注。
 *
 * 截断时**必须明确告知**（验收要求）：只在正文尾部加一句说明，
 * 让模型知道它看到的不完整，从而不会基于残缺内容下结论。
 */
export async function readMarkdownCapped(
  root: string,
  relPath: string,
  maxBytes: number,
): Promise<ReadResult> {
  const { abs, inside } = resolveInside(root, relPath)
  // ⚠ 两种拒绝**必须分开报**（⛔ 不再共用 `DENIED` 当 reason）：
  //   非 .md 与越界是**不同原因**，按类分辨是 D-4 的判据。
  //   ⚠ 但**对外 `text` 仍一字不改**（同一句 `DENIED`）—— 不泄露存在性。
  if (!inside) {
    return { ok: false, text: DENIED, truncated: false, bytes: 0, reason: 'outside-root' }
  }
  if (!isReadableDoc(abs)) {
    return { ok: false, text: DENIED, truncated: false, bytes: 0, reason: 'not-md' }
  }

  // ⚠ 字符串层的越界判断挡不住软链（软链路径仍在 root 内，真实目标在区外）。
  //   逐段 lstat：命中软链即拒绝，与写侧同口径（2026-10-05 第 4 步收紧）。
  //   拒绝话术沿用 DENIED —— 不区分"不允许"与"不存在"，避免泄露存在性。
  if (await findSymlinkOnPath(root, abs) !== null) {
    return { ok: false, text: DENIED, truncated: false, bytes: 0, reason: 'symlink' }
  }

  let bytes = 0
  try {
    const st = await stat(abs)
    bytes = st.size
  } catch {
    return { ok: false, text: '读取失败：文件不存在或不可读。', truncated: false, bytes: 0, reason: 'not-found' }
  }

  try {
    if (bytes <= maxBytes) {
      const text = await readFile(abs, 'utf8')
      return { ok: true, text, truncated: false, bytes }
    }
    // 超限：只读前 maxBytes 字节。按字节读再解码，避免先整读进内存。
    const handle = await readFile(abs)
    // 从截断处往前找一个合法的 UTF-8 边界，避免把一个多字节字符劈成半个。
    let cut = maxBytes
    while (cut > 0 && (handle[cut]! & 0xc0) === 0x80) cut--
    const text = handle.subarray(0, cut).toString('utf8')
    const note = `\n\n---\n[已截断] 该文件共 ${bytes} 字节，超过单文件上限 ${maxBytes} 字节，`
      + `以上仅为前 ${cut} 字节。若需后续内容，请针对性询问或先在本地查看。`
    return { ok: true, text: text + note, truncated: true, bytes }
  } catch {
    return { ok: false, text: '读取失败：文件不存在或不可读。', truncated: false, bytes, reason: 'read-error' }
  }
}
