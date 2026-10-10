/**
 * 读数渲染（结构改造 ④ · 2026-10-11）：把正本里的**占位标记**替换成**当场读到的实值**。
 *
 * ── 治哪条根因（缺口 4 · 值靠手抄）────────────────────────────────────────
 *   计数 / 字节数 / 版本号此前**手写进文本**，靠"快照口径"声明"会过期"兜住漂移 ——
 *   ⚠ 那是**免责**，不是**解决**：值仍然会漂，只是漂了没人负责。
 *   ⇒ 值改由**写入工具在落盘前渲染**：**谁写账本，值就在谁那里取**。
 *
 * ── 为什么这条路对"跨实例"天然成立 ──────────────────────────────────────
 *   **插件代码跑在宿主 Node 进程里，本来就有 `fs` 能力**（`write_hob` 现在就能
 *   `existsSync` 核引用即证）⇒ "数条目""读字节数"**不需要跑命令**；
 *   且它**不开任何新写口** —— 账本仍只有 Hob 侧一个写者（*Single Writer Principle*）。
 *
 * ── 语法（HTML 注释形态）─────────────────────────────────────────────────
 *   `<!-- hob:count | <目标> -->`  → 目录的**条目数**（目标 = 相对账本根的目录路径）
 *   `<!-- hob:bytes | <目标> -->`  → 文件的**字节数**（目标 = 相对账本根的文件路径）
 *   渲染 = 把**整个标记**替换成十进制实值（即"落盘内容是实值、不是标记"）。
 *   ⚠ 用 HTML 注释形态的理由：占位在 **Markdown 渲染结果**里**不出现**（不干扰排版），
 *     而在**原文**里**看得见**（可复查）—— 且它**不碰** Markdown 的其它语法。
 *   ⛔ 本轮只做这两种取值（尤其**不渲染"本仓 HEAD"** —— 那会引入时间/状态依赖）。
 *
 * ── 结构性拒绝（本轮核心：**让非法状态表达不出来**，不是"记得别写"）──────────
 *   ⛔ 目标 == 正在写的那个文件 且 取 `bytes` ⇒ **拒绝渲染**。
 *      理由：渲染动作本身改变文件长度 ⇒ 渲染出来的值**永远不是最终值**
 *      （"文件能否包含自身哈希"的同一类问题 —— **实务上做不到**）。
 *   ⛔ 目标 == 正在写文件的**父目录** 且 取 `count` ⇒ **拒绝渲染**（同族）。
 *   ⚠ 拒绝时**不替换**（标记原样保留）+ **逐条点名**（含行号与理由），
 *     **写入照常进行** —— 与结构改造① 的"只提示、不拒写"**同一口径**。
 *     ⇒ 于是"正本里存在未渲染的标记"成为**可被机检当场抓住**的状态
 *       （`check:gitignore` 的断言 I）。
 *   ⚠ 另有几条**同向**的拒绝（目标不存在 / 种类与实体不符 / 越出账本根 / 路径含软链）：
 *     渲染"读不到的东西"只能给出**假值**（0），而**假读数**正是本机制要治的病
 *     ⇒ 一律**拒绝并点名**，而不是安静地渲染一个 0。
 *
 * ── 围栏代码块豁免（**E-114 家族**）──────────────────────────────────────
 *   ⚠ ``` / ~~~ 围栏内的内容**不参与**标记扫描。
 *   理由：**任何"讲这个标记怎么写"的文档，都必须写出标记的样子** ——
 *   若不跳过，**文档会被自己的例子打挂**（E-114 形态①：**形状可排除**，调精度即可，不是死路）。
 *
 * ── 幂等性（必须保住）────────────────────────────────────────────────────
 *   ⚠ 写入工具有**幂等跳过**（内容与上次一致 ⇒ 跳过、不建备份）
 *   ⇒ 渲染必须**先于**幂等比对（否则"原文含标记" 与 "存量是实值" 永远不相等 ⇒ 幂等失效）。
 *   ⇒ 本函数是**纯函数**：同样的输入 + 同样的树 ⇒ **同样的输出**
 *     （⛔ 不渲染时间戳 / 随机数 / 本次操作产生的量）。
 */
import { lstatSync, readdirSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

/** 取值种类（本轮只有这两种）。 */
export type ReadingKind = 'count' | 'bytes'

/**
 * **宽**匹配器：任何 `<!-- hob:… -->` 都算"一个标记"。
 *
 * ⚠ 为什么用宽口径而不是只匹配合法形状：**打错的标记不能被静默忽略** ——
 *   若只认合法形状，`<!-- hob:lines | x -->` 这种拼错会**留在文件里而没人报**，
 *   等它被渲染成数字的期望落空时，人只会看到原文里有一行怪注释。
 *   ⇒ 宽匹配 + 逐条解析 + **非法形状也点名**，与"计数出现即可见"同一条纪律。
 */
const MARKER_ANY_RE = /<!--\s*hob:[^>]*-->/g

/** **窄**解析器：`<!-- hob:<kind> | <目标> -->`（两端锚定到整段标记）。 */
const MARKER_PARSE_RE = /^<!--\s*hob:([A-Za-z]+)\s*\|\s*([\s\S]*?)\s*-->$/

/** 一个扫描到的标记（**未**取值，只描述"这里有一个"）。 */
export interface MarkerHit {
  /** 原文里的取值种类词（可能非法，如 `lines`）。 */
  kind: string
  /** 原文里的目标（未归一化）。 */
  target: string
  /** 在新写入内容里的行号（1 起；便于点名）。 */
  line: number
  /** 标记原文。 */
  raw: string
  /** 非空 = **形状非法**，值为原因（这类**必须**当拒绝处理，不许静默）。 */
  invalid?: string
}

/** 一条**成功渲染**的读数。 */
export interface RenderedReading {
  kind: ReadingKind
  /** 归一化后的目标（相对账本根；账本根写作空串）。 */
  target: string
  line: number
  /** 当场读到的实值。 */
  value: number
  raw: string
}

/** 拒绝渲染的原因码。 */
export type ReadingRefuseReason =
  | 'bad-shape'
  | 'self-bytes'
  | 'parent-count'
  | 'outside-ledger'
  | 'symlink'
  | 'target-missing'
  | 'kind-mismatch'

/** 一条**被拒绝渲染**的读数（标记原样保留）。 */
export interface RefusedReading {
  kind: string
  target: string
  line: number
  reason: ReadingRefuseReason
  /** 给人看的理由（含处置建议）。 */
  note: string
  raw: string
}

export interface RenderResult {
  /** 渲染后的内容（被拒绝的标记**原样保留**）。 */
  content: string
  rendered: RenderedReading[]
  refused: RefusedReading[]
}

/**
 * 归一化目标路径：统一 `/`、去 `./` 前缀与尾部 `/`。
 *
 * ⚠ **账本根写作空串**（`.` / `./` / `` 都归一到 `''`）——
 *   "父目录"对**根下的文件**（如 `CONTEXT.md`）来说就是**账本根**，
 *   若不归一，`count | .` 这类写法会绕过"父目录拒绝"（判据与对象擦肩而过）。
 */
export function normalizeTarget(t: string): string {
  let s = t.trim().replace(/\\/g, '/')
  s = s.replace(/^\.\//, '').replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  if (s === '.' || s === './') return ''
  return s
}

/** 正在写的文件的父目录（账本根写作空串 —— 与 {@link normalizeTarget} 同口径）。 */
export function parentDirOf(file: string): string {
  const f = file.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  const i = f.lastIndexOf('/')
  return i <= 0 ? '' : f.slice(0, i)
}

/**
 * 逐行判断"是否落在围栏代码块内"。
 *
 * 口径（CommonMark 的围栏规则，够用即可）：
 *   · 开栏：行首 ≤3 空格 + ≥3 个 `` ` `` 或 `~`；用反引号时**信息串不得含反引号**；
 *   · 闭栏：同类字符、**长度不短于**开栏、且其后只有空白；
 *   · 未闭合的围栏**延伸到文末**（与 CommonMark 一致）。
 *
 * @returns 与 `lines` 等长的布尔数组；`true` = 该行**不参与**标记扫描。
 */
function fencedMask(lines: string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false)
  let fence: { char: string; len: number } | null = null
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]!)
    if (fence === null) {
      if (m !== null && !(m[1]![0] === '`' && m[2]!.includes('`'))) {
        fence = { char: m[1]![0]!, len: m[1]!.length }
        mask[i] = true
      }
      continue
    }
    mask[i] = true
    if (m !== null && m[1]![0] === fence.char && m[1]!.length >= fence.len && m[2]!.trim() === '') {
      fence = null
    }
  }
  return mask
}

/**
 * 扫描内容里的**占位标记**（**跳过围栏代码块**）。
 *
 * ⚠ 这是**唯一的**标记识别实现：渲染（{@link renderReadings}）与
 *   机检的"正本无残留标记"（断言 I）**必须**共用它 ——
 *   否则会出现"文档里能安全写例子，但机检照样报残留"的自相矛盾。
 *
 * @param content - 待扫描文本。
 * @returns 命中的标记（**含**形状非法的；空数组 = 一处也没有）。
 */
export function scanMarkers(content: string): MarkerHit[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const mask = fencedMask(lines)
  const hits: MarkerHit[] = []
  lines.forEach((line, i) => {
    if (mask[i] === true) return
    for (const m of line.matchAll(MARKER_ANY_RE)) {
      const raw = m[0]
      const p = MARKER_PARSE_RE.exec(raw)
      if (p === null) {
        hits.push({
          kind: '', target: '', line: i + 1, raw,
          invalid: '标记形状不完整（应为 `<!-- hob:<count|bytes> | <目标> -->`）',
        })
        continue
      }
      const kind = p[1]!
      const target = p[2]!
      if (kind !== 'count' && kind !== 'bytes') {
        hits.push({ kind, target, line: i + 1, raw, invalid: `取值种类 \`${kind}\` 不认识（本轮只有 count / bytes）` })
        continue
      }
      if (target.trim() === '') {
        hits.push({ kind, target, line: i + 1, raw, invalid: '目标为空（没有对象可取）' })
        continue
      }
      hits.push({ kind, target, line: i + 1, raw })
    }
  })
  return hits
}

/** 路径链上是否有符号链接（**任一段**是即返回它）。同步版，供纯函数渲染器使用。 */
function symlinkOnPath(root: string, absTarget: string): string | null {
  const rel = relative(root, absTarget)
  if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) return null
  let cur = root
  for (const part of rel.split(sep)) {
    cur = resolve(cur, part)
    try {
      if (lstatSync(cur).isSymbolicLink()) return cur
    } catch {
      return null // 不存在的段：由"目标不存在"那条拒绝去报，这里不算软链
    }
  }
  return null
}

/** 单条标记的判定：给出实值，或给出拒绝理由。 */
function decideOne(
  ledgerRoot: string,
  file: string,
  h: MarkerHit,
): { value: number } | { reason: ReadingRefuseReason; note: string } {
  if (h.invalid !== undefined) {
    return { reason: 'bad-shape', note: `${h.invalid} ⇒ **不渲染**（拼错的标记必须看得见，不许静默忽略）` }
  }
  const kind = h.kind as ReadingKind
  const target = normalizeTarget(h.target)

  // ── 结构性拒绝（本轮核心）：先于一切存在性判定 ──
  if (kind === 'bytes' && target === file) {
    return {
      reason: 'self-bytes',
      note: '目标是**正在写的这个文件自身**且取 `bytes` ⇒ **结构上不可能**：'
        + '渲染动作本身改变文件长度，渲染出来的值**永远不是最终值**'
        + '（"文件能否包含自身哈希"的同一类问题）。⇒ 请改写成**不依赖该文件自身长度**的表述',
    }
  }
  if (kind === 'count' && target === parentDirOf(file)) {
    return {
      reason: 'parent-count',
      note: '目标是**正在写文件的父目录**且取 `count` ⇒ **结构上不可能**：'
        + '往这份文件里写东西会改变该目录的条目数（新增 / 删除文件时）。'
        + '⇒ 请改写成**不依赖该目录条目数**的表述',
    }
  }

  const abs = resolve(ledgerRoot, target)
  const rel = relative(ledgerRoot, abs)
  if (rel !== '' && (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))) {
    return {
      reason: 'outside-ledger',
      note: `目标 \`${target}\` 越出**账本根** ⇒ 不渲染（读账本以外的东西会引入本机制管不到的边界）`,
    }
  }

  const link = symlinkOnPath(ledgerRoot, abs)
  if (link !== null) {
    return {
      reason: 'symlink',
      note: `目标的路径里有符号链接（\`${link}\`）⇒ 不渲染`
        + '（与读 / 写两侧同一条守卫：不跟随软链）',
    }
  }

  let st
  try {
    st = lstatSync(abs)
  } catch {
    return {
      reason: 'target-missing',
      note: `目标 \`${target}\` **不存在** ⇒ 不渲染。`
        + '⚠ 这里**故意不渲染 0**：渲染"读不到的东西"只能给出**假读数**，而假读数正是本机制要治的病',
    }
  }

  if (kind === 'count') {
    if (!st.isDirectory()) {
      return { reason: 'kind-mismatch', note: `目标是**文件**（\`${target}\`），而 \`count\` 取的是**目录的条目数** ⇒ 不渲染` }
    }
    try {
      return { value: readdirSync(abs).length }
    } catch {
      return { reason: 'target-missing', note: `目录 \`${target}\` 读不到（权限？）⇒ 不渲染` }
    }
  }

  if (!st.isFile()) {
    return { reason: 'kind-mismatch', note: `目标 \`${target}\` 不是**普通文件**（目录 / 特殊文件），而 \`bytes\` 取的是文件的字节数 ⇒ 不渲染` }
  }
  return { value: st.size }
}

/**
 * 渲染内容里的所有占位标记。
 *
 * @param ledgerRoot - 账本根（目标相对它解析）。
 * @param file - 正在写的文件的相对路径（用于"自引用 / 父目录"两条结构拒绝）。
 * @param content - 待写入的正文。
 * @returns 渲染后的内容 + 渲染清单 + 拒绝清单（**纯函数**，同样输入 ⇒ 同样输出）。
 */
export function renderReadings(ledgerRoot: string, file: string, content: string): RenderResult {
  const hits = scanMarkers(content)
  if (hits.length === 0) return { content, rendered: [], refused: [] }

  const fileNorm = file.replace(/\\/g, '/').replace(/^\.\//, '')
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const rendered: RenderedReading[] = []
  const refused: RefusedReading[] = []

  // 逐行处理：同一行可能有多个标记 ⇒ 从**右往左**替换，避免位移互相影响。
  const byLine = new Map<number, MarkerHit[]>()
  for (const h of hits) {
    const arr = byLine.get(h.line) ?? []
    arr.push(h)
    byLine.set(h.line, arr)
  }

  for (const [lineNo, lineHits] of byLine) {
    let line = lines[lineNo - 1]!
    const edits: Array<{ start: number; end: number; text: string }> = []
    for (const h of lineHits) {
      const d = decideOne(ledgerRoot, fileNorm, h)
      if ('value' in d) {
        const start = line.indexOf(h.raw)
        if (start === -1) continue // 理论上不会发生（raw 来自本行）
        edits.push({ start, end: start + h.raw.length, text: String(d.value) })
        rendered.push({
          kind: h.kind as ReadingKind,
          target: normalizeTarget(h.target),
          line: h.line,
          value: d.value,
          raw: h.raw,
        })
      } else {
        refused.push({
          kind: h.kind, target: h.target, line: h.line, reason: d.reason, note: d.note, raw: h.raw,
        })
      }
    }
    for (const e of edits.sort((a, b) => b.start - a.start)) {
      line = line.slice(0, e.start) + e.text + line.slice(e.end)
    }
    lines[lineNo - 1] = line
  }

  return { content: lines.join('\n'), rendered, refused }
}

/**
 * 把渲染 / 拒绝清单渲染成能直接贴进返回值的说明（都为空 ⇒ 空串）。
 *
 * ⚠ **E-118 的出处要求**：既然值是**工具算的**，就要**说得出是哪些值** ——
 *   否则"这个数字哪来的"又变成不可复核的。
 */
export function renderReadingsNote(res: RenderResult): string {
  const parts: string[] = []
  if (res.rendered.length > 0) {
    parts.push(`\n🖩 读数渲染：${res.rendered.length} 处 —— `
      + res.rendered.map((r) => `${r.kind}(${r.target})=${r.value}`).join(' · ')
      + '（值取自**写入时**的实测，非手抄）')
  }
  if (res.refused.length > 0) {
    parts.push(`\n⚠ 读数**未渲染**：${res.refused.length} 处 —— `
      + res.refused.map((r) => `第 ${r.line} 行 \`${r.raw}\`：${r.note}`).join(' · ')
      + '\n  ↳ 标记**原样保留**、**本次写入照常**（只提示、不拒写）；'
      + '⚠ 但它会留在正本里 ⇒ 收尾的 `npm run check:gitignore` 会当场 FAIL（断言 I）。')
  }
  return parts.join('')
}
