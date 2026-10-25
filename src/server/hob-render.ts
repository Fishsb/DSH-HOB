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
  /**
   * ⚠ 标记在该行里的**起始字符偏移**（0 起，左闭）。
   *
   * ── 为什么必须记偏移，而不能让渲染侧再 `indexOf(raw)` 找（2026-10-24 · 本单必修 8）──
   *   改前 `renderReadings` 是 `line.indexOf(h.raw)`。**同一行出现两个内容相同的标记**
   *   （如 `共 <!-- hob:count | t --> 份 / 又 <!-- hob:count | t --> 份`）时，
   *   两次 `indexOf` **都指到第一处** ⇒ 第一处被替换两次（数字变一次），
   *   第二处**原样留在盘上**；而函数照样把这些标记记进 `rendered`、写入照样 `ok: true`
   *   ⇒ **正文被写坏而读数说"渲染成功"**（本单实测的形态）。
   *   ⇒ 偏移只认 `scanMarkers` 里 `matchAll` 给出的 `m.index`（**唯一来源**，天然按出现顺序、
   *     天然互不重叠），渲染侧**按偏移顺序消费**，不再猜"是第几处"。
   */
  start: number
  /** 标记在该行里的**结束偏移**（左开，`line.slice(start, end) === raw`）。 */
  end: number
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
  /**
   * ── 两条**内部一致性**拒绝（2026-10-24 · 本单必修 8 新增）────────────────────
   * ⚠ 它们不是"标记写错了"，而是"**本渲染器自己**的前提被破坏"：
   *   · `offset-mismatch` —— 扫描给出的区间与这一行原文对不上；
   *   · `overlap-guard`   —— 同一行里待替换的区间互相重叠（`matchAll` 本不该产出）。
   * ⚠ 两者都**不渲染**（标记原样保留）⇒ 收尾机检（断言 I）会当场咬到，
   *   ⛔ 绝不按错的/重叠的区间去切正文（那会静默写坏内容，仍回 `ok: true`）。
   */
  | 'offset-mismatch'
  | 'overlap-guard'

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
 * 计算一行里**行内代码段（code span）**覆盖的**字符区间**（左闭右开）。
 *
 * ── 为什么需要它（**E-125** 的根因）────────────────────────────────────────
 *   围栏豁免只挡**块级**形态。文档在**行内**引用这个标记的写法（`` `…` ``）
 *   过去**照旧被渲染 / 被断言 I 咬** ⇒ "讲这个机制怎么用"的正文天然会写出这个形态，
 *   于是文档被**自己**打挂（**E-114** 家族）。
 *   ⇒ 本函数把**行内代码段**也算进"形状可排除"的一侧（**调精度，不是放宽**）。
 *
 * ── 口径（CommonMark，够用即可；**以本文件的行为为准**）────────────────────
 *   · 开、闭都是**反引号串**（连续 `` ` ``），且**长度必须相等**才配对
 *     —— `` ` `` 不会被 ``` `` ``` 闭合，反之亦然；
 *   · 配对取**同长度的最近一个**串；跨不同长度的串**继续向后找**；
 *   · ⚠ **未闭合** ⇒ **该行从此处到行尾都不豁免**（本轮选定的口径，偏保守：
 *     宁可多咬、不可漏咬 —— 漏咬会让"真残留"变成看不见的假通过）；
 *   · **围栏优先**：围栏内的行内反引号**不参与**围栏判定（调用方先做围栏过滤，
 *     再对**未落围栏**的行调用本函数 ⇒ 两条豁免互不干扰）。
 *
 * @param line - 单行文本（不含换行符）。
 * @returns 豁免区间数组（空数组 = 该行没有行内代码段）。
 */
function inlineCodeRanges(line: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let i = 0
  while (i < line.length) {
    if (line[i] !== '`') {
      i += 1
      continue
    }
    let j = i
    while (j < line.length && line[j] === '`') j += 1
    const open = j - i
    // 向后找**同长度**的闭合串（长度不同的串一律略过，继续找）
    let k = j
    let close = -1
    while (k < line.length) {
      if (line[k] !== '`') {
        k += 1
        continue
      }
      let p = k
      while (p < line.length && line[p] === '`') p += 1
      if (p - k === open) {
        close = k
        break
      }
      k = p
    }
    if (close === -1) break // 未闭合 ⇒ 行尾不豁免（不登记任何区间，且不再往后找）
    ranges.push([i, close + open])
    i = close + open
  }
  return ranges
}

/**
 * 扫描内容里的**占位标记**（**跳过围栏代码块与行内代码段**）。
 *
 * ⚠ 这是**唯一的**标记识别实现：渲染（{@link renderReadings}）与
 *   机检的"正本无残留标记"（断言 I）**必须**共用它 ——
 *   否则会出现"文档里能安全写例子，但机检照样报残留"的自相矛盾。
 *
 * ⚠ **裸写的标记照旧被咬**（那是**真残留**，正是本函数存在的意义）：
 *   豁免只覆盖"形状上可排除"的两类 —— 围栏内、行内代码段内（**E-125**）。
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
    const exempt = inlineCodeRanges(line)
    for (const m of line.matchAll(MARKER_ANY_RE)) {
      const at = m.index
      // ⚠ **必须整段落在**行内代码段内才豁免（只起点在内不算 —— 那种"半截裸写"
      //   仍会被咬，宁可多咬不可漏咬）；段外照旧。
      const end = at + m[0].length
      if (exempt.some(([a, b]) => at >= a && end <= b)) continue
      const raw = m[0]
      const start = at
      const p = MARKER_PARSE_RE.exec(raw)
      if (p === null) {
        hits.push({
          kind: '', target: '', line: i + 1, raw, start, end,
          invalid: '标记形状不完整（应为 `<!-- hob:<count|bytes> | <目标> -->`）',
        })
        continue
      }
      const kind = p[1]!
      const target = p[2]!
      if (kind !== 'count' && kind !== 'bytes') {
        hits.push({ kind, target, line: i + 1, raw, start, end, invalid: `取值种类 \`${kind}\` 不认识（本轮只有 count / bytes）` })
        continue
      }
      if (target.trim() === '') {
        hits.push({ kind, target, line: i + 1, raw, start, end, invalid: '目标为空（没有对象可取）' })
        continue
      }
      hits.push({ kind, target, line: i + 1, raw, start, end })
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
    const line = lines[lineNo - 1]!
    /**
     * ⚠⚠ **按偏移消费，不再 `indexOf(raw)`**（2026-10-24 · 本单必修 8）。
     *
     * 改前的病灶：同一行出现**两个内容完全相同**的标记时，两次 `indexOf` **都指到第一处**
     *   ⇒ 第一处被替换两次（值只变一次），第二处**原样留在盘上**；而 `rendered` 里却记了两条、
     *   写入照样 `ok: true` ⇒ **正文写坏了、读数说渲染成功**。
     * ⇒ 现在只用 `scanMarkers` 给出的 `start` / `end`：
     *   · 它来自 `String.prototype.matchAll` 的 `m.index`（**唯一来源**，天然按出现顺序、
     *     天然互不重叠）；
     *   · 因此"第几个标记"这件事**不再靠猜**，同内容标记各替换各的。
     */
    const edits: Array<{ start: number; end: number; text: string }> = []
    for (const h of lineHits) {
      const d = decideOne(ledgerRoot, fileNorm, h)
      if ('value' in d) {
        /**
         * ── 自检 ①：区间必须真的对得上那段原文 ───────────────────────────
         *   ⚠ 对不上说明"扫描偏移"与"这一行"已经不是同一份文本了（违反本函数的前提）
         *     ⇒ **拒绝这一处**（标记原样保留、点名），⛔ 绝不按错的偏移去切 ——
         *     切错 = 正文被静默改写，正是本单要治的那一类。
         */
        if (line.slice(h.start, h.end) !== h.raw) {
          refused.push({
            kind: h.kind, target: h.target, line: h.line, reason: 'offset-mismatch', raw: h.raw,
            note: '扫描给出的区间与这一行的原文对不上 ⇒ **不渲染**（标记原样保留）。这属于内部不一致，'
              + '宁可留着让收尾的机检当场咬到（断言 I），也不按错的位置切正文',
          })
          continue
        }
        edits.push({ start: h.start, end: h.end, text: String(d.value) })
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
    /**
     * ── 自检 ②：替换区间**不得重叠**（本单必修 8 明令）────────────────────
     *   ⚠ `matchAll` 本来不会产出重叠区间 ⇒ 本检查**理应永不触发**；它的价值在于
     *     "把这条前提变成当场可判的事实"：一旦有人改了扫描器（或将来加了别种标记），
     *     重叠会让 `slice` 拼出**谁也预料不到的正文**，而写入照样回 `ok`。
     *   ⇒ 触发时**整行都不渲染**（把该行所有待渲染标记一并转成拒绝），
     *     理由写清楚 + 标记原样保留 ⇒ 收尾机检当场可见。⛔ 不猜"哪个更该赢"。
     */
    const sorted = [...edits].sort((a, b) => a.start - b.start)
    let overlapped = false
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.start < sorted[i - 1]!.end) { overlapped = true; break }
    }
    if (overlapped) {
      for (let i = rendered.length - 1; i >= 0; i--) {
        if (rendered[i]!.line !== lineNo) continue
        const r = rendered.splice(i, 1)[0]!
        refused.push({
          kind: r.kind, target: r.target, line: r.line, reason: 'overlap-guard', raw: r.raw,
          note: '同一行里被判定要替换的区间**互相重叠** ⇒ **本行一律不渲染**（标记原样保留）。'
            + '⚠ 这属于内部不一致（扫描器本不该产出重叠区间）：宁可留着让收尾机检当场咬到，'
            + '也不按重叠区间去拼正文 —— 那会静默写出谁也预料不到的内容',
        })
      }
      continue
    }
    // 从右往左替换（位移互不影响；顺序与"按偏移"并不矛盾：都只认同一条原始行文本）。
    let out = line
    for (const e of [...sorted].sort((a, b) => b.start - a.start)) {
      out = out.slice(0, e.start) + e.text + out.slice(e.end)
    }
    lines[lineNo - 1] = out
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
