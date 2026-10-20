/**
 * 骨架的**源解析 + 首次铺骨架**（2026-10-16 · 第 224 轮 · `UD-118`「C」）。
 *
 * ── 它解决什么（缺口有实测出处）──────────────────────────────────────────────
 *   **第 221 轮实测**：`package.json` 的 `files` 只有 `lib` / `cordis.patch.yml` / `preset`；
 *   `npm pack --dry-run` 里 **`.hob/` 命中 0** ⇒ ⚠ **"装到别的实例就带上同一套约束"这件事，
 *   ⛔ 不由包装链路承担**；⚠ **真实链路 = git 仓 + 人工复制骨架** ⇒ 依赖"人记得跑那一步"。
 *   ⇒ 本模块让**插件自己**在工作区里铺骨架（用户裁定「C」）。
 *
 * ── ⚠ ⚠ 六条硬约束（本模块逐条落实；⛔ 任何一条做不到都要在报告里说清）────────────
 *   ① **只在「被协助的工作区根」下写** —— 目标是**调用方传进来的工作区根**，
 *      ⛔ 本模块**不自己找根**、⛔ 不写 profile 目录、⛔ 不写 `~/.dsh/**`；
 *      ⚠ 另有 {@link assertInsideWorkspace} 显式拒"逃出工作区根"的目标。
 *   ② **永不覆盖已存在的 `.hob/`** —— 只补缺；目标已存在 ⇒ **一个字节都不动**。
 *   ③ **默认开 + 一个真开关**（switches 由 config 侧提供；见 `config.ts` 的 `skeleton` 段）。
 *   ④ **失败必须可观测** —— 每一类失败都有可读 output（见 {@link ScaffoldResult} 的 `notes`）。
 *   ⑤ **单一来源 + 同源判据**：⚠ **仓库的 `.hob/**` 是唯一来源**，随包发出去的那份是**派生物**
 *      ⇒ ⚠ **{@link SKELETON_MANIFEST}（生成物）就是那条同源判据的载体**
 *      （判据在 `scripts/check-code-face.mjs` 的 `runSkeletonSource`，⛔ 提取不到即 FAIL）。
 *   ⑥ **不扩工具面** —— 本模块**不注册任何工具**；它是**插件的初始化行为**，
 *      ⛔ 不是 agent 的工具（⚠ 别把它接到 `write_hob` 的**入参**上）。
 *
 * ⚠ **零第三方依赖**（本仓纪律）：只用 `node:fs` / `node:crypto` / `node:path`。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SKELETON_MANIFEST } from './skeleton-manifest.ts'

export { SKELETON_MANIFEST }

/** 骨架在工作区里的落点（相对工作区根）。 */
export const SKELETON_DIR = '.hob'

/**
 * 允许铺的相对路径清单 —— ⚠ **派生值**（源 = `.gitignore` 的 `!` 例外，见 `.hob/README.md` §1）·
 * ⛔ **本文件不手抄这个数组**，它来自生成物 {@link SKELETON_MANIFEST}。
 *
 * ⚠ **为什么以 `.gitignore` 的 `!` 例外为源**：`README.md` §1 明写
 *   「本表的『位置』栏就是 `.gitignore` 例外的**唯一权威清单**」⇒ ⚠ 它就是"哪些是骨架"的既有口径，
 *   ⛔ 再造一张手抄清单等于**再造一个会漂移的判据**（**E-70** 同族）。
 */
export function skeletonAllowlist(): readonly string[] {
  return SKELETON_MANIFEST.allowlist
}

export interface ScaffoldNote {
  /** 机器可判的类别（可读输出的一等公民）。 */
  kind: 'scaffolded' | 'skipped-exists' | 'skipped-switch-off' | 'refused-outside' | 'source-missing' | 'failed'
  /** 给人/模型看的一句话。 */
  message: string
  /** 该条涉及的相对路径（有则给）。 */
  path?: string
}

export interface ScaffoldResult {
  ok: boolean
  /** 是否真的写了文件（⚠ `false` 不等于失败 —— 跳过也是正常态）。 */
  wrote: boolean
  /** 本次/该类**写下去**的相对路径。 */
  written: readonly string[]
  /** ⚠ **每一类结果都有可读输出**（约束 ④ · ⛔ 不许静默）。 */
  notes: readonly ScaffoldNote[]
  /**
   * ── ⚠⚠ **完整性读数**（2026-10-21 · 第 329 轮 · **甲-10** 要求 2）─────────────
   *
   * ⚠ **它治的是什么**（`PROJECT-SURVEY-3` §6.1 甲-10）：改前只有 `written.length` 一个数，
   *   而它**只是一个孤零零的分子** —— 没有分母，读的人无法回答
   *   「**该铺 7 件，实际铺了几件**？」更看不出"半套"（铺了 4 件、3 件失败）。
   *   现场形态：手上有 `written: ['a','b','c','d']`，而那到底是"全部"还是"一半"，
   *   ⚠ **盘上没有任何读数能回答**（`notes` 里虽有 failed 条目，但要人去数）。
   *
   * ⇒ 现在**显式给三个数**，让"半套"一眼可读：
   *   · `total`    —— 本次**应有**的件数（= 骨架源按清单列出的件数）；
   *   · `scaffolded` —— **真的写成**的件数（= `written.length`，⛔ 不另算一遍）；
   *   · `skippedExists` —— **因为已存在而整目录跳过**（那是幂等命中，⛔ 不是缺件）；
   *   · `failed`   —— **逐件失败**的件数（⚠ `total - scaffolded` 里除跳过以外的差额）。
   *
   * ⚠ ⛔ **它不是判据、只是一条读数**：本字段**不参与任何 ok/fail 判定**
   *   （那仍由既有的 `ok` / `notes` 决定），加它⛔ 不改任何既有语义。
   * ⚠ 三种出口（拒绝 / 跳过已存在 / 源缺失）**都要给这组数**，
   *   否则读者又回到"有的分支有读数、有的没有"那种状态。
   */
  completeness: {
    /** 应有件数（源按清单列出的件数；源读不到 ⇒ 0）。 */
    total: number
    /** 真写成的件数。 */
    scaffolded: number
    /** 因目标已存在而整目录跳过（⚠ 幂等命中，⛔ 不是缺件）。 */
    skippedExists: number
    /** 逐件失败数（含读源失败与写失败）。 */
    failed: number
  }
}

/**
 * ⚠ ⚠ **约束 ①的负向判据**：目标必须是**工作区根之内**的 `.hob/`。
 *
 * 判据（**四级，都要过**）：
 *   ① 目标根**必须是绝对路径**（⛔ 不认相对路径 —— 那等于"猜"）；
 *   ② 目标根**必须存在且是目录**（⚠ 工作区是一个**真实的**、本次会话正在用的目录）；
 *   ③ 目标根**不得落在**宿主配置区（`~/.dsh/**` / `~/.config/**` / `~/.local/share/**`）
 *      或**系统目录**（`/etc` `/usr` `/bin` `/sys` `/proc` …）—— ⚠ 这些**⛔ 绝不写**；
 *   ④ 目标根**不得浅于** `<a>/<b>`（⚠ 拒 `/` 与 `/etc` 这种"太浅"的根）。
 *   ⚠ 另：解析出的目标必须**真在工作区根之内**（`relative()` 不以 `..` 开头）。
 *
 * ⚠ ⚠ **诚实说明本判据的边界**（⚠ 2026-10-16 判据 e 的对拍当场抓出来的）：
 *   ⚠ 本函数**不是**"这是不是一个工作区"的判定器 —— ⚠ 任给一个绝对路径（比如别的项目目录），
 *   它**无法**从路径本身判断"它属于本会话还是别的会话"。⚠ 第一次跑对拍时
 *     `assertInsideWorkspace('/etc')` **放行了**，只靠操作系统的 `EACCES` 才没写进去
 *     ⇒ ⚠ 那是**假通过**（⚠ 换个有写权限的目录就会真写出去）。
 *   ⇒ 修法 = 上列 ②③④（⚠ 把"明显不该写的"显式拒掉），⚠
 *     **而"这个根是不是本会话的工作区"由调用方保证**：⚠ 它来自
 *     `resolveWorkspaceRoot(cfg.workspaceRoot, session.header.cwd)`（⚠ **fail-closed**：
 *     ⛔ 判不出就是 `undefined` ⇒ 调用方拒绝，⛔ 不猜）。
 *   ⇒ ⚠ **两级合起来才是"只写被协助的工作区"**：⚠ 调用方给根（⛔ 不猜）+ 本函数拒"明显越界"。
 *
 * ⚠ **本函数不"猜"根**：`workspaceRoot` 由调用方传入（⚠ 它的来源见 `modules/tools.ts` 的
 *   `rootOf()` ⇒ `resolveWorkspaceRoot(cfg.workspaceRoot, session.header.cwd)`）。
 */
export function assertInsideWorkspace(workspaceRoot: string, hobDir = SKELETON_DIR): { ok: true; abs: string } | { ok: false; reason: string; message: string } {
  const root = workspaceRoot.trim()
  if (root === '') {
    return { ok: false, reason: 'no-workspace-root', message: '拒绝：工作区根为空（⛔ 不猜、不退回 cwd）。' }
  }
  if (!isAbsolute(root)) {
    return { ok: false, reason: 'relative-root', message: `拒绝：工作区根必须是绝对路径（收到 \`${root}\`）。` }
  }
  const absRoot = resolve(root)
  // ② 必须存在且是目录（⚠ 工作区是**真实的**、本次会话在用的目录）
  let st = undefined
  try { st = statSync(absRoot) } catch { st = undefined }
  if (st === undefined) {
    return { ok: false, reason: 'root-missing', message: `拒绝：工作区根 \`${absRoot}\` **不存在**（⛔ 不写一个还不存在的根）。` }
  }
  if (!st.isDirectory()) {
    return { ok: false, reason: 'root-not-a-dir', message: `拒绝：工作区根 \`${absRoot}\` **不是目录**。` }
  }
  // ④ 不得太浅（⚠ 拒 `/`、`/etc`、`/home` 这种）
  const depth = absRoot.split(sep).filter((s) => s !== '').length
  if (depth < 2) {
    return { ok: false, reason: 'root-too-shallow', message: `拒绝：工作区根 \`${absRoot}\` **太浅**（⛔ 不写系统级目录）。` }
  }
  // ③ 宿主配置区 / 系统目录 ⇒ 拒（⚠ 约束① 明列：⛔ 不写 profile、⛔ 不写 ~/.dsh/**）
  const denied = ['/.dsh/', '/.config/', '/.local/share/']
  const sysDirs = ['/etc', '/usr', '/bin', '/sbin', '/lib', '/sys', '/proc', '/dev', '/boot', '/root', '/var', '/opt', '/srv', '/run']
  const probe = `${absRoot}${sep}`
  for (const d of denied) {
    if (probe.includes(d)) {
      return { ok: false, reason: 'denied-area', message: `拒绝：工作区根 \`${absRoot}\` 落在宿主配置区内（⛔ 约束①：不写 profile / 不写 ~/.dsh/**）。` }
    }
  }
  for (const d of sysDirs) {
    if (absRoot === d || absRoot.startsWith(`${d}/`)) {
      return { ok: false, reason: 'system-dir', message: `拒绝：工作区根 \`${absRoot}\` 在系统目录 \`${d}\` 内（⛔ 绝不写这里）。` }
    }
  }
  const absTarget = resolve(absRoot, hobDir)
  // ① 逃出工作区根 ⇒ 拒（`..` 型目标）
  const rel = relative(absRoot, absTarget)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    return { ok: false, reason: 'escapes-workspace', message: `拒绝：目标 \`${absTarget}\` 不在工作区根之内（⛔ 不写工作区之外）。` }
  }
  if (absTarget.includes('/.dsh/') || absTarget.includes('/.config/')) {
    return { ok: false, reason: 'denied-area', message: `拒绝：目标 \`${absTarget}\` 落在宿主配置区内（⛔ 约束①）。` }
  }
  return { ok: true, abs: absTarget }
}

/** 递归列出某目录下的普通文件（相对该目录的 POSIX 形）。 */
function listFiles(dir: string, acc: string[] = [], base = dir): string[] {
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) listFiles(p, acc, base)
    else if (e.isFile()) acc.push(relative(base, p).split(sep).join('/'))
  }
  return acc
}

/**
 * 解析**骨架的源目录**（⚠ §2① 的 (c)：**包内为默认，仓库优先**）。
 *
 * ⚠ ⚠ **"仓库优先、包内兜底"这句话在物理上是怎么落地的（2026-10-16 实测校正）**：
 *   本函数拿到的 `moduleDir` 是**本文件编译后的所在目录**，运行时有**两种落点**：
 *     · 开发态：`<repo>/lib/server` ⇒ ⚠ 候选 ① 是 `<repo>/lib/.hob`（**不存在**），
 *       候选 ② 是 `<repo>/.hob`（**存在**）⇒ 命中候选 ②；
 *     · 装到别处：`<...>/node_modules/dsh-hob/lib/server` ⇒ 候选 ② 是
 *       `<...>/node_modules/dsh-hob/.hob`（⚠ 由 `package.json` 的 `files` 带出去的那份）。
 *   ⇒ ⚠ ⚠ **判据不是"哪个目录"，而是"哪一份先命中"**：候选 ① 是 `<包根>/.hob` 上方
 *     那一层（⚠ 开发态下它**正是仓库根**），候选 ② 是**包根自己**的 `.hob`。
 *   ⚠ ⚠ **诚实说明**：本机 profile 用的是 **junction**（实测
 *     `~/.dsh/profiles/web/node_modules/dsh-hob -> /home/lk/FF/dsh-hob`）⇒
 *     ⚠ **在这个实例上，候选 ①/② 指的还是同一棵树**（`lib/.hob` 不存在，
 *     命中的是仓库根那份）⇒ ⚠ **"仓库那份 vs 包内那份"在本机分不开**；
 *     它们真正分开只发生在"打包装进另一个实例"时。⚠ 故：本函数**不谎称**自己
 *     分得清"仓库/包内"，它只报"命中第几个候选"。
 *   ⚠ ⚠ 而**权威的是仓库那份**这件事，是由**同源断言 R**（`check-code-face.mjs`）盯的
 *     —— ⚠ 它比对的是**仓库根 `.hob/**`** 与派生物，⛔ 不依赖本函数的标签。
 *
 * 顺序：① `<模块目录>/../.hob` → ② `<模块目录>/../../.hob` → ③ 都没有 ⇒
 *   **报"源读不到"**（⚠ 约束 ④：⛔ 不许静默跳过）。
 */
export function resolveSkeletonSource(moduleDir: string): { dir: string; which: 'above-package' | 'package'; candidates: string[] } | undefined {
  const candidates = [resolve(moduleDir, '..', SKELETON_DIR), resolve(moduleDir, '..', '..', SKELETON_DIR)]
  for (const [i, c] of candidates.entries()) {
    if (existsSync(join(c, 'templates')) && existsSync(join(c, 'INIT.md'))) {
      return { dir: c, which: i === 0 ? 'above-package' : 'package', candidates }
    }
  }
  return undefined
}

/** 读一份骨架文件（返回字节级内容；⚠ 用 `Buffer` 以免文本编码来回引入差异）。 */
function readSkeletonFile(dir: string, rel: string): Buffer | undefined {
  try {
    return readFileSync(join(dir, rel))
  } catch {
    return undefined
  }
}

/**
 * 按清单**列出源里实际存在的**骨架文件（⚠ 派生：清单来自 {@link skeletonAllowlist}，
 * 文件来自**源目录实测** ⇒ ⛔ 不手抄文件表）。
 */
export function listSkeletonFiles(sourceDir: string): string[] {
  const out: string[] = []
  for (const entry of skeletonAllowlist()) {
    const rel = entry.replace(/^\.hob\//, '')
    const abs = join(sourceDir, rel)
    if (!existsSync(abs)) continue
    const st = statSync(abs)
    if (st.isDirectory()) {
      for (const f of listFiles(abs)) out.push(`${rel}/${f}`)
    } else if (st.isFile()) {
      out.push(rel)
    }
  }
  return out.sort()
}

/**
 * ⚠ ⚠ **首次铺骨架**（约束 ①②④）。
 *
 * **"什么叫首次"（⚠ 定义写死，⛔ 不含糊）** = ⚠ **该工作区根的 `.hob/` 目录还不存在**。
 *   ⚠ 一旦它存在（无论里面有几种文件）⇒ 本函数**只跳过、⛔ 不补任何缺**。
 *
 * ⚠ ⚠ **为什么"存在就整体跳过"而不是"逐文件补缺"**：⚠ 约束 ② 要的是
 *   **"已存在 ⇒ 一个字节都不动"** —— 逐文件补缺会在用户**有意删掉某个模板**时把它塞回去
 *   （⚠ 那是**用户的意图**，⛔ 不是缺件）。⇒ ⚠ 判据取**目录级**，⛔ 不取文件级。
 *
 * @param workspaceRoot - **被协助的工作区根**（⚠ 由调用方解析，见 {@link assertInsideWorkspace}）。
 * @param opts.sourceDir - 骨架源目录（⚠ 由 {@link resolveSkeletonSource} 给出）。
 * @param opts.enabled - 开关值（⚠ 约束 ③：关 ⇒ 不铺**且要有可读输出**）。
 */
export function scaffoldSkeletonOnce(workspaceRoot: string, opts: { sourceDir?: string; enabled: boolean }): ScaffoldResult {
  const notes: ScaffoldNote[] = []
  // ── 开关（约束 ③）──────────────────────────────────────────────────────
  if (opts.enabled !== true) {
    notes.push({ kind: 'skipped-switch-off', message: '首次铺骨架：**开关关闭** ⇒ ⛔ 未铺任何文件（按配置跳过）。' })
    return { ok: true, wrote: false, written: [], notes,
      completeness: { total: 0, scaffolded: 0, skippedExists: 0, failed: 0 } }
  }
  // ── 目标（约束 ①）──────────────────────────────────────────────────────
  const guard = assertInsideWorkspace(workspaceRoot)
  if (guard.ok === false) {
    notes.push({ kind: 'refused-outside', message: guard.message })
    return { ok: false, wrote: false, written: [], notes,
      completeness: { total: 0, scaffolded: 0, skippedExists: 0, failed: 0 } }
  }
  const target = guard.abs
  // ── 闸门（约束 ②）：存在 ⇒ 整体跳过 ─────────────────────────────────────
  if (existsSync(target)) {
    notes.push({ kind: 'skipped-exists', message: `首次铺骨架：\`${target}\` **已存在** ⇒ ⛔ 一个字节都不动（只补缺、永不覆盖）。`, path: SKELETON_DIR })
    /**
     * ⚠ 跳过**不是缺件**（甲-10 要求 2）：这里把 `skippedExists` 记成 **1 次整目录跳过**，
     *   ⚠ 而"该铺几件"此刻**判不出**（源还没列）⇒ `total: 0` 是**如实**的"未计算"，
     *   ⛔ 不许拿它冒充"应该铺 0 件"。
     */
    return { ok: true, wrote: false, written: [], notes,
      completeness: { total: 0, scaffolded: 0, skippedExists: 1, failed: 0 } }
  }
  // ── 源（约束 ④：读不到 ⇒ 可观测，⛔ 不静默）──────────────────────────────
  if (opts.sourceDir === undefined || !existsSync(opts.sourceDir)) {
    notes.push({ kind: 'source-missing', message: `首次铺骨架：**骨架源读不到** ⇒ ⛔ 未铺任何文件（目标=\`${target}\`）。`, path: SKELETON_DIR })
    return { ok: false, wrote: false, written: [], notes,
      completeness: { total: 0, scaffolded: 0, skippedExists: 0, failed: 0 } }
  }
  const files = listSkeletonFiles(opts.sourceDir)
  if (files.length === 0) {
    notes.push({ kind: 'source-missing', message: `首次铺骨架：骨架源 \`${opts.sourceDir}\` 里**按清单一件也没列到** ⇒ ⛔ 未铺（⛔ 不把"0 件"当成功）。`, path: SKELETON_DIR })
    return { ok: false, wrote: false, written: [], notes,
      completeness: { total: 0, scaffolded: 0, skippedExists: 0, failed: 0 } }
  }
  // ── 铺（逐件原子写；⚠ 失败逐件可观测，⛔ 不吞）──────────────────────────
  const written: string[] = []
  for (const rel of files) {
    const buf = readSkeletonFile(opts.sourceDir, rel)
    if (buf === undefined) {
      notes.push({ kind: 'failed', message: `首次铺骨架：读源失败（跳过该件）\`${rel}\`。`, path: rel })
      continue
    }
    const dest = join(target, rel)
    try {
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, buf)
      written.push(`${SKELETON_DIR}/${rel}`)
    } catch (e) {
      notes.push({ kind: 'failed', message: `首次铺骨架：写失败 \`${SKELETON_DIR}/${rel}\` ⇒ ${e instanceof Error ? e.message : String(e)}（⛔ 不静默）。`, path: rel })
    }
  }
  if (written.length > 0) {
    notes.push({ kind: 'scaffolded', message: `首次铺骨架：\`${target}\` **原先不存在** ⇒ 铺了 ${written.length} 件（源=\`${opts.sourceDir}\`）。`, path: SKELETON_DIR })
  }
  const failedCount = notes.filter((n) => n.kind === 'failed').length
  const failed = failedCount > 0
  /**
   * ⚠⚠ **半套场景的读数**（甲-10 要求 2）：
   *   `total` = **源按清单列出的件数**（`files.length`），`scaffolded` = 真写成的，
   *   `failed` = 逐件失败数。⇒ ⚠ `total !== scaffolded + failed` 时，**差额就是"半套"**：
   *     例：`total 7 · scaffolded 4 · failed 3` ⇒ 一眼看出缺 3 件。
   *   ⚠ 改前只能看到 `written: [a,b,c,d]` —— **没有分母**，看不出它是不是全部。
   */
  return { ok: !failed, wrote: written.length > 0, written, notes,
    completeness: { total: files.length, scaffolded: written.length, skippedExists: 0, failed: failedCount } }
}

/** sha256（⚠ 同源判据用；`check-code-face.mjs` 用**同一函数**重算，⛔ 不另写一份）。 */
export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * 本模块编译后所在的目录（⚠ 运行时由 `import.meta.url` 现算，⛔ 不硬编码路径）。
 *
 * ⚠ **为什么用 `import.meta.url`**：⚠ 本仓既往**没有**这个先例（实测 `grep -rn "import.meta" src/`
 *   命中 0）⇒ 这里明写理由：⚠ 骨架源的位置**相对本文件**，而本文件既可能是
 *   `<repo>/lib/server/`（开发态）也可能是 `<...>/node_modules/dsh-hob/lib/server/`（装机态）；
 *   ⚠ 硬编码任一个都会在另一种落点上**静默指错**（而 `process.cwd()` 更糟：
 *   ⚠ 它随会话工作区变 —— 那**正是我们要铺骨架的目标**，⛔ 不能拿来当源的位置）。
 *
 * ⚠ 本函数**只在服务端**（`lib/server/`）跑，不进客户端包。
 */
function moduleDirOf(): string | undefined {
  try {
    return dirname(fileURLToPath(import.meta.url))
  } catch {
    return undefined
  }
}

/**
 * ⚠ ⚠ **首次铺骨架的入口**（**约束 ①②③④** 的收口点）。
 *
 * ── ⚠ "什么叫首次"（⛔ 不含糊 —— 它决定约束 ② 的判据）────────────────────────
 *   ⚠ = **该工作区根的 `.hob/` 目录还不存在**。
 *   ⚠ 一旦它存在（无论里面有几种文件）⇒ **只跳过、⛔ 一个字节都不动**
 *     （⚠ 判据取**目录级**，⛔ 不取文件级 —— 逐文件补缺会把用户**有意删掉**的模板塞回去，
 *     那是用户的意图，⛔ 不是缺件）。
 *
 * ── ⚠ 触发点（**本轮的裁定**）────────────────────────────────────────────────
 *   ⚠ = **插件为某个工作区干活时**，由**调用方**（模块层）在拿到工作区根之后调本函数。
 *   ⚠ ⛔ **它不是一个工具**（**约束 ⑥**）：⚠ 不注册、不声明、⛔ 不进 `write_hob` 的入参；
 *     它是**插件的初始化行为**（与"注册模块"同一档）。
 *
 * ── ⚠ 幂等性从哪来（⚠ 这是"每次调用都安全"的凭据）──────────────────────────
 *   ⚠ **不靠调用方记"铺过了"**，而靠**文件系统的既成事实**：⚠ 第一次调用把 `.hob/` 建出来，
 *   ⚠ 此后每一次调用都在 {@link scaffoldSkeletonOnce} 的"已存在"闸门处**短路**
 *     （⚠ 只返回一行 `skipped-exists`，⛔ 不读源、⛔ 不写盘）。
 *   ⇒ ⚠ **重复调用是空操作**这件事由**判据 ② 的对拍**证明（见报告 §3）。
 *
 * ── ⚠ 失败可观测（**约束 ④**）────────────────────────────────────────────────
 *   ⚠ 每一类都在返回值的 `notes` 里给 `kind` + 一句话（⚠ 调用方**原样回带**即可）：
 *   `scaffolded` / `skipped-exists` / `skipped-switch-off` / `refused-outside` /
 *   `source-missing` / `failed`。
 *
 * @param workspaceRoot - **被协助的工作区根**（⚠ 由调用方解析；⚠ 来源见 `modules/tools.ts`
 *   `rootOf()` ⇒ `resolveWorkspaceRoot(cfg.workspaceRoot, session.header.cwd)`）。
 * @param enabled - 开关值（⚠ 由 `config.ts` 的 `skeletonEnabled()` 现读，⛔ 不直读 ref）。
 */
export function scaffoldSkeletonForWorkspace(workspaceRoot: string, enabled: boolean): ScaffoldResult {
  const md = moduleDirOf()
  if (md === undefined) {
    return {
      ok: false,
      wrote: false,
      written: [],
      notes: [{ kind: 'source-missing', message: '首次铺骨架：解析不到本模块所在目录（`import.meta.url` 不可用）⇒ ⛔ 未铺任何文件。' }],
      completeness: { total: 0, scaffolded: 0, skippedExists: 0, failed: 0 },
    }
  }
  const src = resolveSkeletonSource(md)
  return scaffoldSkeletonOnce(workspaceRoot, {
    enabled,
    ...(src === undefined ? {} : { sourceDir: src.dir }),
  })
}
