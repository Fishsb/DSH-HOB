/**
 * **工作区读取**的守卫与上限：三档权限里「项目 / 工作区」两档的读能力实现点。
 *
 * ── 与 `doc-read.ts` 的分工（⛔ 别混）──────────────────────────────────
 *   · `doc-read.ts` —— 读**账本区**（账本在工作区之外，按工作区名派生）。
 *     它是 `read_contracts` / `write_hob` 的边界，**不管**工作区内的文件。
 *   · 本文件 —— 读**工作区**内的文件（档2 只 `.md`；档3 文本类 + 图片），
 *     是三个自注册只读工具（`hob_read_doc` / `hob_grep` / `hob_read_image`）的边界。
 *
 * ── 为什么独立一个文件（而不是塞进 `doc-read.ts`）────────────────────
 *   两者的**根目录不同**（账本区 vs 工作区）、**允许的类型不同**（`.md` vs 文本类 + 图片）。
 *   混在一个文件里，日后改一侧会误伤另一侧。守卫的三块（包含性 / 软链 / 上限）
 *   则**复用 `doc-read.ts` 的同一份实现**（`resolveInside` / `findSymlinkOnPath`），
 *   ⛔ 不重写第二份 —— 重写必然漂移（本项目既有纪律：守卫逻辑只写一份）。
 *
 * ── 权限口径（硬约束，三处都在本文件）────────────────────────────────
 *   ① **包含性**：目标必须落在工作区根之内（`path.relative`，⛔ 不用 `startsWith`）；
 *   ② **软链**：路径上任一段是符号链接即拒（软链的真实目标可能在区外）；
 *   ③ **类型**：档2 只认 `.md`；档3 认 {@link TEXT_EXTENSIONS}（**22 个**）
 *      —— 二进制 / 图片**不**走文本读（图片有单独的工具）。
 *   ④ **编码**：非 UTF-8 一律拒（⛔ 不静默把坏字节替换成 U+FFFD）。
 */
import { lstat, readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep, basename, extname } from 'node:path'
import { findSymlinkOnPath, resolveInside } from './doc-read.ts'

/**
 * **档3 的文本类名单**（22 个扩展名）—— `hob_read_doc`（文本模式）与 `hob_grep`
 * 的搜索范围**共用这一份常量**。
 *
 * ⚠ **⛔ 不许在别处再写一份**（E-110 / 用户 2026-10-14 补遗 A4 明文要求）：
 *   两处各写一份 ⇒ 改一处忘另一处时，`hob_read_doc` 能读的文件 `hob_grep`
 *   搜不到（或反之），而这种不一致**没有任何现象**会提示。
 *
 * ⚠ 口径 = **扩展名白名单**（不是"非二进制即可"）：
 *   "如何判二进制"本身没有稳定判据（`doc-read.ts` 现在也不判），
 *   而扩展名白名单是**可判、可列、可机检**的。
 */
export const TEXT_EXTENSIONS: readonly string[] = [
  '.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.ini', '.csv',
  '.ts', '.tsx', '.js', '.mjs', '.cjs',
  '.py', '.sh',
  '.go', '.rs', '.java', '.sql',
  '.html', '.css', '.xml',
] as const

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

/** {@link TEXT_EXTENSIONS} 的 Set 形态（判定用；保持与常量同源）。 */
const TEXT_EXT_SET = new Set(TEXT_EXTENSIONS)

/** 是否为文本类（档3 口径）。⚠ 大小写不敏感。 */
export function isTextFile(p: string): boolean {
  return TEXT_EXT_SET.has(extname(p).toLowerCase())
}

/** 是否为档2 可读的 `.md`。 */
export function isMarkdownFile(p: string): boolean {
  return extname(p).toLowerCase() === '.md'
}

/**
 * 按**档位**判类型：`project` 只认 `.md`；`workspace` 认 {@link TEXT_EXTENSIONS}。
 *
 * ⚠ 这是"档位只改**读**的范围"这条口径的**唯一**落点 ——
 *   `hob_read_doc` 的两种模式差异**只在这里**，别在别处再判一次。
 *
 * @param p - 文件路径（取扩展名）。
 * @param level - 当前档位（`ledger` 下两个工具都不可见，故这里只处理 2 / 3）。
 */
export function isAllowedTextFor(p: string, level: string): boolean {
  if (level === 'project') return isMarkdownFile(p)
  if (level === 'workspace') return isTextFile(p)
  return false
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
 * 解码并**显式校验** UTF-8：坏字节一律拒（⛔ 不静默替换成 U+FFFD）。
 *
 * ⚠ 为什么必须显式判（本项目既有缺口）：`doc-read.ts:211` 用的是
 *   `readFile(abs, 'utf8')` —— Node 对非法序列会**静默替换**成 U+FFFD 且不报错
 *   ⇒ 模型拿到的是"看起来正常、实则被改过"的正文。本模块不继承这个行为。
 *
 * @param bytes - 原始字节。
 * @returns 解码后的文本；非法 UTF-8 / 含 NUL 时为 undefined。
 */
function decodeStrictUtf8(bytes: Uint8Array): string | undefined {
  // 二进制快筛：文本类文件里出现 NUL 字节极不正常（且是 tar/可执行文件的特征）。
  const probe = bytes.subarray(0, Math.min(bytes.length, 8192))
  for (let i = 0; i < probe.length; i++) if (probe[i] === 0) return undefined
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

/**
 * 读工作区内的**文本类**文件（档2 = 只 `.md`；档3 = {@link TEXT_EXTENSIONS}）。
 *
 * @param root - 工作区根（绝对路径）。
 * @param relPath - 相对（或工作区内绝对）路径。
 * @param maxBytes - 单文件字节上限；超出则**截断并在尾部明确标注**（⛔ 不静默截断）。
 * @param level - 当前档位（决定类型口径）。
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

  if (!isAllowedTextFor(abs, level)) {
    const want = level === 'project' ? '只允许 .md' : `只允许文本类（${TEXT_EXTENSIONS.join(' ')}）`
    return { ok: false, text: `拒绝：${want}。`, truncated: false, bytes: 0, reason: 'type' }
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

  const text = decodeStrictUtf8(raw)
  if (text === undefined) {
    return {
      ok: false,
      text: '拒绝：该文件不是有效的 UTF-8 文本（可能是二进制，或编码不是 UTF-8）。',
      truncated: false,
      bytes,
      reason: 'binary-or-encoding',
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
 * 在工作区内**按扩展名白名单**搜索（档3 的 `hob_grep`）。
 *
 * ── 为什么必须带类型过滤 ──────────────────────────────────────────────
 *   用户裁定「档3 的都给」，但档3 的语义是"**文本类**都可读"
 *   ⇒ 搜索范围 = {@link TEXT_EXTENSIONS}，⛔ **不搜二进制 / 图片**。
 *   本函数与 `readWorkspaceText`（文本模式）**共用同一份常量**。
 *
 * ── 为什么不用宿主 `grep`（`dsh-tool-fs-search`）──────────────────────
 *   ① 它读**任意**文件正文（无扩展名过滤）⇒ 直接给会把"档3 只读文本类"
 *      这条口径变成只靠调用方自觉；
 *   ② 声明它就得连 `tool-fs-search` 一起声明 ⇒ 宿主 `write`/`edit` 也会回来。
 *   ⇒ 自建一个**范围受控**的搜索（本条是设计 §b 与补遗 A2 的落点）。
 *
 * ── 判据（可判、有界）────────────────────────────────────────────────
 *   · `pattern` = 正则源（大小写敏感，与 `grep` 默认一致）；
 *   · 只搜 {@link TEXT_EXTENSIONS}；跳过 {@link SKIP_DIRS}；
 *   · 单文件 ≤ {@link GREP_MAX_BYTES_PER_FILE}、总量 ≤ {@link GREP_MAX_FILES}；
 *   · 软链**不跟随**（`readdir` 给的是 `Dirent`，软链不是 `isFile()` ⇒ 天然跳过）；
 *   · 返回最多 `maxHits` 条，**并在被截断时明说**。
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
): Promise<{ ok: boolean; hits: GrepHit[]; scanned: number; capped: boolean; reason?: string }> {
  let re: RegExp
  try {
    re = new RegExp(pattern)
  } catch (e) {
    return { ok: false, hits: [], scanned: 0, capped: false, reason: `正则无效：${String((e as Error)?.message ?? e)}` }
  }

  let base = root
  if (subPath.trim() !== '') {
    const g = await resolveGuarded(root, subPath)
    if (!g.ok) return { ok: false, hits: [], scanned: 0, capped: false, reason: g.reason }
    base = g.abs
  }

  const hits: GrepHit[] = []
  let scanned = 0
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
      if (!isTextFile(ent.name)) continue
      const abs = join(dir, ent.name)
      scanned++
      let text: string | undefined
      try {
        const st = await lstat(abs)
        if (st.size > GREP_MAX_BYTES_PER_FILE) continue
        text = decodeStrictUtf8(await readFile(abs))
      } catch {
        continue
      }
      if (text === undefined) continue
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
  return { ok: true, hits, scanned, capped }
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
