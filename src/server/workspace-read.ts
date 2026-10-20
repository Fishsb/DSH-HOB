/**
 * **工作区读取**的守卫与上限：三档权限里「项目 / 工作区」两档的读能力实现点。
 *
 * ── 与 `doc-read.ts` 的分工（⛔ 别混）──────────────────────────────────
 *   · `doc-read.ts` —— 读**账本区**（账本在工作区之外，按工作区名派生）。
 *     它是 `read_contracts` / `write_hob` 的边界，**不管**工作区内的文件。
 *   · 本文件 —— 读**工作区**内的文件（档2 只 `.md`；档3 **任意文件**），
 *     是**四个**自注册只读工具（`hob_read_doc` / `hob_glob` / `hob_grep` / `hob_read_image`）的边界。
 *     ⚠ **订正说明**（2026-10-21 第 333 轮 · **丁-8**）：原文写「三个」并只列了三个名字，
 *       而 `hob_glob` 也是走本文件边界（`workspace-read.ts` 的 glob 入口）
 *       ⇒ 少算了一个，且**列出的名单里就缺它**。
 *
 * ── 为什么独立一个文件（而不是塞进 `doc-read.ts`）────────────────────
 *   两者的**根目录不同**（账本区 vs 工作区）、**允许的类型不同**（`.md` vs 任意文件）。
 *   混在一个文件里，日后改一侧会误伤另一侧。守卫的三块（包含性 / 软链 / 上限）
 *   则**复用 `doc-read.ts` 的同一份实现**（`resolveInside` / `findSymlinkOnPath`），
 *   ⛔ 不重写第二份 —— 重写必然漂移（本项目既有纪律：守卫逻辑只写一份）。
 *
 * ── 权限口径（硬约束，三处都在本文件）────────────────────────────────
 *   ① **包含性**：目标必须落在工作区根之内（`path.relative`，⛔ 不用 `startsWith`）；
 *   ② **软链**：路径上任一段是符号链接即拒（软链的真实目标可能在区外）；
 *   ③ **类型**：档2 只认 `.md`；**档3 不设类型白名单**（任意文件都可读可看）。
 *      ⚠ 但"能读"不等于"按文本读"：`hob_read_doc` 会**先看内容**再决定怎么回 ——
 *        文本 ⇒ 正文；二进制 ⇒ **短提示**；图片 ⇒ 提示改用 `hob_read_image`。
 *   ④ **编码**：非 UTF-8 **不静默替换**（⛔ 不留 U+FFFD）—— 走二进制那条路，给短提示。
 *
 * ── ⚠ 与第 144 轮的口径差异（用户 2026-10-14 追加裁定「档3的都加，文件都可以读取查看」）──
 *   第 144 轮档3 曾用**扩展名白名单**；本轮改为**任意文件**（白名单已删）。
 *   ⇒ 原来那份 `TEXT_EXTENSIONS` 常量**已删净**（⛔ 不留无人使用的清单 —— 空旋钮纪律）。
 *   ⚠ **档2 不变**（仍只 `.md`）⇒ 类型面**只剩一处判定**：{@link isAllowedForLevel}。
 */
import { lstat, readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep, basename, extname } from 'node:path'
import { findSymlinkOnPath, resolveInside } from './doc-read.ts'

/**
 * **图片类名单**（档3）—— 与宿主 `read_image` 的支持面**逐项一致**。
 *
 * 实测来源：`dsh-tool-fs/lib/index.js:792-798` 的 `IMAGE_EXTENSIONS`
 * （`.png` / `.jpg` / `.jpeg` / `.webp` / `.gif`，分别映射到
 * `image/png` / `image/jpeg` / `image/webp` / `image/gif`）。
 * ⚠ 宿主另有「无扩展名但内容可嗅探」一条路（`:1003` 的 `sniffImageMediaType`）
 *   —— 本实现**不覆盖**该情形（按扩展名判；无扩展名 ⇒ 拒），如实登记在有界说明里。
 */
export const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** 被拒绝的统一话术（⛔ 不区分"不存在"与"不允许"，避免泄露存在性）。 */
export const DENIED_WORKSPACE = '拒绝：只能读取本工作区内允许的文件。'

/** 是否为档2 可读的 `.md`。 */
export function isMarkdownFile(p: string): boolean {
  return extname(p).toLowerCase() === '.md'
}

/**
 * 按**档位**判类型：`project` 只认 `.md`；**`workspace` 不设类型白名单**。
 *
 * ⚠ 这是"档位只改**读**的范围"这条口径的**唯一**落点 ——
 *   `hob_read_doc` 的两种模式差异**只在这里**，别在别处再判一次。
 *
 * ⚠⚠ **类型面只剩这一处**（第 145 轮）：原来档3 还查一份扩展名白名单，
 *   用户 2026-10-14 裁定「档3的都加，文件都可以读取查看」后**该白名单已删净**。
 *   ⇒ 档3 的类型判定 = **恒真**（只受包含性与软链约束）。
 *
 * @param p - 文件路径（取扩展名；档3 不再看它）。
 * @param level - 当前档位（`ledger` 下两个工具都不可见，故这里只处理 2 / 3）。
 */
export function isAllowedForLevel(p: string, level: string): boolean {
  if (level === 'project') return isMarkdownFile(p)
  if (level === 'workspace') return true   // ⚠ 任意文件（用户裁定）
  return false
}

/**
 * 判一段字节**是不是可读的文本**（`hob_read_doc` 用来分"文本 / 二进制"两态）。
 *
 * ⚠ 判据（两条，都可判、都不猜编码）：
 *   ① 前 8 KB 内含 NUL 字节 ⇒ 二进制（文本文件里出现 NUL 极不正常）；
 *   ② **严格** UTF-8 解码失败 ⇒ 二进制 / 非 UTF-8。
 * ⚠ ⛔ **绝不用"解码失败就替换成 U+FFFD"的宽松口径** —— 那正是本项目一直在防的
 *   "静默替换"（`doc-read.ts:211` 的既有缺口，本模块**不继承**）。
 *
 * @param bytes - 原始字节。
 * @returns 能解码成文本时返回文本；否则 `undefined`。
 */
function decodeStrictUtf8(bytes: Uint8Array): string | undefined {
  const probe = bytes.subarray(0, Math.min(bytes.length, 8192))
  for (let i = 0; i < probe.length; i++) if (probe[i] === 0) return undefined
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

/** 图片扩展名（`hob_read_doc` 用它给"改用 hob_read_image"的提示），与宿主支持面一致。 */
export function isImageFile(p: string): boolean {
  return IMAGE_EXTENSIONS[extname(p).toLowerCase()] !== undefined
}

export interface WorkspaceReadResult {
  ok: boolean
  text: string
  truncated: boolean
  bytes: number
  reason?: string
}

/** 每次调用解析一遍"路径 + 包含性 + 软链"三件（三个工具共用）。 */
async function resolveGuarded(
  root: string,
  relPath: string,
): Promise<{ abs: string; ok: true } | { ok: false; reason: string }> {
  const requested = String(relPath ?? '').trim()
  if (requested === '') return { ok: false, reason: '路径为空。' }
  if (isAbsolute(requested)) {
    // ⚠ 允许绝对路径**当且仅当**它落在工作区内 —— 这样模型把
    //   `/home/lk/FF/dsh-hob/src/x.ts` 这样写也能用，而越界照样被下面的包含性判定拒。
    const abs = resolve(requested)
    const rel = relative(root, abs)
    const inside = rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))
    if (!inside) return { ok: false, reason: DENIED_WORKSPACE }
    if (await findSymlinkOnPath(root, abs) !== null) return { ok: false, reason: DENIED_WORKSPACE }
    return { abs, ok: true }
  }
  const { abs, inside } = resolveInside(root, requested)
  if (!inside) return { ok: false, reason: DENIED_WORKSPACE }
  if (await findSymlinkOnPath(root, abs) !== null) return { ok: false, reason: DENIED_WORKSPACE }
  return { abs, ok: true }
}


/**
 * 读工作区内的一个文件，**按内容分三态回**（档2 仍只 `.md`；档3 任意文件）。
 *
 * ── 三态（用户 2026-10-14 裁定「文件都可以读取查看」的落点）──────────────
 *   ① **文本** ⇒ 返回正文（受 `maxBytes` 上限，超限**截断并在尾部标注**）；
 *   ② **二进制 / 非 UTF-8** ⇒ **短提示**（⛔ 不吐乱码、⛔ **不静默替换成 U+FFFD**）；
 *   ③ **图片** ⇒ 提示**改用 `hob_read_image`**（图片走附件通道，不经文本读）。
 *   ⚠ 三态的判定顺序有讲究：**先判图片**（按扩展名，可判），再**按内容**判文本 / 二进制。
 *
 * ⚠ **"类型拒绝"只在档2 发生**（只允许 `.md`）；档3 **不因类型拒绝**（只受包含性与软链约束）。
 *
 * @param root - 工作区根（绝对路径）。
 * @param relPath - 相对（或工作区内绝对）路径。
 * @param maxBytes - 单文件字节上限（`hob_read_doc` 传 **65536**）；超出则截断并标注。
 * @param level - 当前档位（决定类型口径；档3 = 任意文件）。
 * @param offset - 起始行（1 基）；缺省 1。
 * @param limit - 最多返回行数；缺省 = 不按行切（只受字节上限约束）。
 */
export async function readWorkspaceText(
  root: string,
  relPath: string,
  maxBytes: number,
  level: string,
  offset = 1,
  limit = 0,
): Promise<WorkspaceReadResult> {
  const g = await resolveGuarded(root, relPath)
  if (!g.ok) return { ok: false, text: g.reason, truncated: false, bytes: 0, reason: g.reason }
  const abs = g.abs

  // ⚠ 类型拒绝**只在档2**（档3 = 任意文件 ⇒ 这一句对它是恒假的）。
  if (!isAllowedForLevel(abs, level)) {
    return { ok: false, text: '拒绝：本档只允许读 .md（「文档权限」档）。', truncated: false, bytes: 0, reason: 'type' }
  }

  let bytes = 0
  try {
    const st = await stat(abs)
    if (!st.isFile()) {
      return { ok: false, text: '拒绝：目标不是普通文件。', truncated: false, bytes: 0, reason: 'not-file' }
    }
    bytes = st.size
  } catch {
    return { ok: false, text: '读取失败：文件不存在或不可读。', truncated: false, bytes: 0, reason: 'not-found' }
  }

  let truncated = false
  let raw: Uint8Array
  try {
    if (bytes <= maxBytes) {
      raw = await readFile(abs)
    } else {
      // 超限：只读前 maxBytes 字节，并从截断处往前找合法 UTF-8 边界。
      const handle = await readFile(abs)
      let cut = maxBytes
      while (cut > 0 && (handle[cut]! & 0xc0) === 0x80) cut--
      raw = handle.subarray(0, cut)
      truncated = true
    }
  } catch {
    return { ok: false, text: '读取失败：文件不存在或不可读。', truncated: false, bytes, reason: 'read-error' }
  }

  // ── 三态之二 / 之三：图片与二进制 ────────────────────────────────────
  //   ⚠ **先判图片**（按扩展名，确定性判据），再按内容判文本 / 二进制。
  if (isImageFile(abs)) {
    return {
      ok: false,
      text: `该文件是图片（${extname(abs).toLowerCase()}）—— 请改用 hob_read_image 读取它（图片走附件通道，不经文本读）。`,
      truncated: false,
      bytes,
      reason: 'image-use-image-tool',
    }
  }
  const text = decodeStrictUtf8(raw)
  if (text === undefined) {
    // ⚠ **短提示**：不说"拒绝"（它**没有**被拒 —— 档3 允许读任意文件），
    //   只说"这不是文本、看不了正文"。⛔ 不吐乱码、⛔ 不留 U+FFFD。
    return {
      ok: false,
      text: `该文件不是可读的文本（二进制或非 UTF-8 编码），无法展示正文。`
        + `文件大小 ${bytes} 字节。`,
      truncated: false,
      bytes,
      reason: 'binary',
    }
  }

  // 行窗口：offset / limit（缺省整份）。
  let body = text
  if (offset > 1 || limit > 0) {
    const lines = text.split('\n')
    const start = Math.max(0, offset - 1)
    const end = limit > 0 ? start + limit : lines.length
    body = lines.slice(start, end).join('\n')
  }
  if (truncated) {
    body += `\n\n---\n[已截断] 该文件共 ${bytes} 字节，超过单文件上限 ${maxBytes} 字节，`
      + `以上仅为前 ${raw.length} 字节。若需后续内容，请用 offset/limit 分段读。`
  }
  return { ok: true, text: body, truncated, bytes }
}

/** grep 的单条命中。 */
export interface GrepHit {
  /** 相对工作区根的 POSIX 路径。 */
  path: string
  /** 1 基行号。 */
  line: number
  /** 命中行的原文（已去掉行尾 \r）。 */
  text: string
}

/** 遍历时**一律跳过**的目录（体积大 / 非源码 / 版本库内部）。 */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', 'coverage'])

/** 单次遍历的硬上限（防"搜到天荒地老"把会话卡住）。 */
const GREP_MAX_FILES = 4000
const GREP_MAX_BYTES_PER_FILE = 512 * 1024

/**
 * 在工作区内搜索（档3 的 `hob_grep`）—— 范围 = **全部文件**，**跳过二进制并计数**。
 *
 * ── 范围口径（用户 2026-10-14 裁定「文件都可以读取查看」）───────────────
 *   ⚠ 第 144 轮的范围是**扩展名白名单**；本轮改为**全部文件**。
 *   ⛔ **但二进制不能按文本搜** —— 对二进制求正则命中会得到**乱码行**，
 *     那既不是用户要的"命中了"，也不是可用的读数。
 *   ⇒ 口径 =「**扫全部文件；读不成文本的跳过，并在结果里如实报出跳过了几个**」。
 *     这一条是本模块**唯一**还看内容（而非扩展名）的地方，⚠ 它**不是**类型白名单：
 *     任何文件都**会被尝试**，只是"读不成文本"的那些留给 `hob_read_doc` 去给短提示。
 *
 * ── 为什么不用宿主 `grep`（`dsh-tool-fs-search`）──────────────────────
 *   ① 它没有"跳过二进制并计数"这一层 ⇒ 结果里会混进乱码行；
 *   ② 声明它就得连 `tool-fs-search` 一起声明 ⇒ 宿主 `write`/`edit` 也会回来。
 *   ⇒ 自建一个**范围受控**的搜索。
 *
 * ── 判据（可判、有界）────────────────────────────────────────────────
 *   · `pattern` = 正则源（大小写敏感，与 `grep` 默认一致）；
 *   · 遍历时跳过 {@link SKIP_DIRS}；
 *   · 单文件 ≤ {@link GREP_MAX_BYTES_PER_FILE}、总量 ≤ {@link GREP_MAX_FILES}；
 *   · 软链**不跟随**（`readdir` 给的是 `Dirent`，软链不是 `isFile()` ⇒ 天然跳过）；
 *   · 返回最多 `maxHits` 条，**并在被截断时明说**；**跳过的二进制个数一并返回**。
 *
 * @param root - 工作区根（绝对路径）。
 * @param pattern - 正则源。
 * @param subPath - 限定子目录（可选；仍是工作区内路径，走同一套守卫）。
 * @param maxHits - 命中上限。
 */
export async function grepWorkspace(
  root: string,
  pattern: string,
  subPath = '',
  maxHits = 200,
): Promise<{ ok: boolean; hits: GrepHit[]; scanned: number; skippedBinary: number; capped: boolean; reason?: string }> {
  let re: RegExp
  try {
    re = new RegExp(pattern)
  } catch (e) {
    return { ok: false, hits: [], scanned: 0, skippedBinary: 0, capped: false, reason: `正则无效：${String((e as Error)?.message ?? e)}` }
  }

  let base = root
  if (subPath.trim() !== '') {
    const g = await resolveGuarded(root, subPath)
    if (!g.ok) return { ok: false, hits: [], scanned: 0, skippedBinary: 0, capped: false, reason: g.reason }
    base = g.abs
  }

  const hits: GrepHit[] = []
  let scanned = 0
  let skippedBinary = 0
  let capped = false

  const walk = async (dir: string): Promise<void> => {
    if (scanned >= GREP_MAX_FILES || hits.length >= maxHits) { capped = true; return }
    let entries: import('node:fs').Dirent[] = []
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      if (scanned >= GREP_MAX_FILES || hits.length >= maxHits) { capped = true; return }
      // ⚠ 软链不跟随：`isFile()` / `isDirectory()` 对软链都是 false ⇒ 天然跳过。
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue
        await walk(join(dir, ent.name))
        continue
      }
      if (!ent.isFile()) continue
      // ⚠ **不再按扩展名筛**（第 145 轮：范围 = 全部文件）。
      const abs = join(dir, ent.name)
      scanned++
      let text: string | undefined
      try {
        const st = await lstat(abs)
        if (st.size > GREP_MAX_BYTES_PER_FILE) { skippedBinary++; continue }
        text = decodeStrictUtf8(await readFile(abs))
      } catch {
        skippedBinary++
        continue
      }
      // 读不成文本（含二进制 / 非 UTF-8）⇒ **跳过并计数**，⛔ 不把它的正文当命中。
      if (text === undefined) { skippedBinary++; continue }
      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i++) {
        // 每行都测同一个正则；`lastIndex` 对无 g 标志的正则无影响。
        if (re.test(lines[i]!)) {
          hits.push({
            path: relative(root, abs).split(sep).join('/'),
            line: i + 1,
            text: lines[i]!.replace(/\r$/, ''),
          })
          if (hits.length >= maxHits) { capped = true; break }
        }
      }
    }
  }
  await walk(base)
  return { ok: true, hits, scanned, skippedBinary, capped }
}

/** `hob_read_image` 的读取结果。 */
export interface WorkspaceImageResult {
  ok: boolean
  /** 原始字节。 */
  data?: Uint8Array
  /** MIME（由扩展名判定）。 */
  mediaType?: string
  /** 工作区内的展示路径。 */
  displayPath?: string
  /** 文件字节数。 */
  bytes?: number
  reason?: string
}

/**
 * 读工作区内的一张图片（档3 的 `hob_read_image`）。
 *
 * ── 形态（实测结论，见 `REPORT-R148.md`）────────────────────────────
 *   宿主 `read_image`（`dsh-tool-fs/lib/index.js:987-1057`）走的是
 *   **`attachments.saveImage()`**，输出一个 `{type:'image', attachment}` 内容块
 *   —— 图片不走文本通道，而是作为附件交给模型。
 *   实测：`attachments` / `fs` / `llm` 三个服务都是**宿主平面 provide** 的，
 *   而预设作用域**取得到**（scope 链向上查找）⇒ 自注册工具可以走**同一条路**。
 *
 * ── 本函数只管"**读到合法字节**"这一段 ────────────────────────────────
 *   包含性 + 软链 + 扩展名 + 字节上限在本函数内；
 *   `saveImage` 与"产出 image 块"在 `src/modules/tools.ts` 里做
 *   （那需要 `attachments` 服务，属模块层的事）。
 *
 * @param root - 工作区根（绝对路径）。
 * @param relPath - 相对（或工作区内绝对）路径。
 * @param maxBytes - 字节上限（超出即拒，⛔ 不截断图片 —— 截断的图片是坏图片）。
 */
export async function readWorkspaceImage(
  root: string,
  relPath: string,
  maxBytes: number,
): Promise<WorkspaceImageResult> {
  const g = await resolveGuarded(root, relPath)
  if (!g.ok) return { ok: false, reason: g.reason }
  const abs = g.abs

  const mediaType = IMAGE_EXTENSIONS[extname(abs).toLowerCase()]
  if (mediaType === undefined) {
    return { ok: false, reason: `拒绝：只允许 ${Object.keys(IMAGE_EXTENSIONS).join(' ')} 这几类图片。` }
  }

  let size = 0
  try {
    const st = await stat(abs)
    if (!st.isFile()) return { ok: false, reason: '拒绝：目标不是普通文件。' }
    size = st.size
  } catch {
    return { ok: false, reason: '读取失败：文件不存在或不可读。' }
  }
  if (size > maxBytes) {
    return { ok: false, reason: `拒绝：图片 ${size} 字节，超过上限 ${maxBytes} 字节（图片不做截断 —— 截断即损坏，请先缩小副本）。` }
  }

  let data: Uint8Array
  try {
    data = await readFile(abs)
  } catch {
    return { ok: false, reason: '读取失败：文件不存在或不可读。' }
  }
  return { ok: true, data, mediaType, displayPath: relative(root, abs).split(sep).join('/') || basename(abs), bytes: size }
}

/** `hob_glob` 的读取结果。 */
export interface GlobResult {
  ok: boolean
  text: string
  /** 命中条数（截断前）。 */
  count: number
  capped: boolean
  reason?: string
}

/**
 * 把 glob 模式转成可用的判定（只支持 `*` / `**` / `?`，够用且可判）。
 *
 * ⚠ 刻意**不引第三方 glob 库**（本仓取向：运行时零第三方依赖）——
 *   而且模式来自模型，转义不当会带来正则层面的意外，故只做**必要的转义**。
 */
function globToRegExp(pattern: string): RegExp {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!
    if (c === '*') {
      if (pattern[i + 1] === '*') { out += '.*'; i++ } else { out += '[^/]*' }
    } else if (c === '?') out += '[^/]'
    else if ('\\^$.|+()[]{}'.includes(c)) out += '\\' + c
    else out += c
  }
  return new RegExp('^' + out + '$')
}

/**
 * 列工作区内的**文件路径**（档3 的 `hob_glob`）—— **只回路径、不读正文**。
 *
 * ── 为什么档3 给、档2 不给 ────────────────────────────────────────────
 *   列名**不违**"档2 不可读代码"（它不读正文），但**文件名本身常含语义**
 *   ⇒ 属"看结构"，超出档2「只读 `.md` 文档」的语义。
 *   档3 的语义是"工作区文档与代码都可读" ⇒ 列目录是它的子集。
 *
 * ── 判据 ─────────────────────────────────────────────────────────────
 *   · 模式相对工作区根；支持 `*`（不跨 `/`）、`**`（跨 `/`）、`?`；
 *   · 模式**不得**以 `/` 开头、不得含 `..`（那是越界写法，直接拒）；
 *   · 跳过 {@link SKIP_DIRS}；**软链不跟随**（`Dirent.isFile()` 对软链为 false）；
 *   · 结果条数有上限，被截断时**在正文里明说**（⛔ 不静默截断）。
 *
 * @param root - 工作区根（绝对路径）。
 * @param pattern - glob 模式。
 * @param limit - 最多返回条数。
 */
export async function globWorkspace(
  root: string,
  pattern: string,
  limit = 200,
): Promise<GlobResult> {
  const pat = String(pattern ?? '').trim()
  if (pat === '') return { ok: false, text: '拒绝：模式为空。', count: 0, capped: false, reason: 'empty-pattern' }
  if (pat.startsWith('/') || pat.split('/').includes('..')) {
    return { ok: false, text: DENIED_WORKSPACE, count: 0, capped: false, reason: 'pattern-escape' }
  }
  const re = globToRegExp(pat)
  const hits: string[] = []
  let capped = false

  const walk = async (dir: string): Promise<void> => {
    if (hits.length >= limit) { capped = true; return }
    let entries: import('node:fs').Dirent[] = []
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      if (hits.length >= limit) { capped = true; return }
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue
        await walk(join(dir, ent.name))
        continue
      }
      if (!ent.isFile()) continue
      const abs = join(dir, ent.name)
      const rel = relative(root, abs).split(sep).join('/')
      if (re.test(rel)) hits.push(rel)
    }
  }
  await walk(root)
  hits.sort()
  const body = hits.length === 0
    ? `没有匹配「${pat}」的文件。`
    : hits.join('\n') + (capped ? `\n\n---\n[已截断] 命中数达到上限 ${limit}，以上不完整。` : '')
  return { ok: true, text: body, count: hits.length, capped }
}
