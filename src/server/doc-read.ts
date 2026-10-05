/**
 * 文档读取的守卫与上限：**唯一**的路径校验与截断实现点。
 *
 * 被两处共用，避免守卫逻辑写两遍而漂移：
 *   · `tools/read-contracts.ts` —— 暴露给模型的 read_contracts 工具
 *   · `server/llm-bridge.ts`   —— 服务端代执行工具调用时
 *
 * 权限边界（硬约束）：
 *   只允许读工作区根目录下的 **.md**；非 .md 或越界一律拒绝。
 */
import { lstat, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/** 被拒绝的统一话术：不区分「不存在」与「不允许」，避免泄露存在性。 */
export const DENIED = '拒绝：只能读取工作区内的 .md 文档。'

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

export interface ReadResult {
  /** 是否成功读到内容。 */
  ok: boolean
  /** 正文（可能是截断后的）。 */
  text: string
  /** 是否发生了截断。 */
  truncated: boolean
  /** 文件实际大小（字节）；读失败时为 0。 */
  bytes: number
  /** 失败原因（ok=false 时给用户/模型看的一句话）。 */
  reason?: string
}

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
  if (!isMarkdown(abs) || !inside) {
    return { ok: false, text: DENIED, truncated: false, bytes: 0, reason: DENIED }
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
