/**
 * `.hob/` 账本写入的守卫与落地：**唯一**的写入实现点（镜像 `doc-read.ts`）。
 *
 * 对称关系（改一处必须看另一处，这是本项目的分层纪律）：
 *   · `server/doc-read.ts`    ←→ `tools/read-contracts.ts`   （读）
 *   · `server/hob-write.ts`   ←→ `tools/write-hob.ts`        （写，本文件）
 *
 * 权限边界（硬约束，fail-closed —— **先拒绝，后动手**）：
 *   1. 只能写 `.hob/` 目录**之内**的文件；
 *   2. 路径校验用 `path.relative`（复用 `doc-read.ts` 的 `resolveInside`，防 `..` 穿越）；
 *   3. **不跟随符号链接**：`.hob/` 自身与目标路径的**每一段**都 lstat 检查（读侧允许，
 *      写侧必须更严 —— 写穿软链会逃出 `.hob/`）；
 *   4. **白名单穷举**：三个账本 + `archive/<日期目录>/*.md`；
 *   5. **骨架只读**：`README.md` / `templates/**` 一律拒写（骨架进 git，变更走人工 + commit）。
 *
 * 写入安全：
 *   · 写前**全量备份**（去重 + 保留 N 份）；
 *   · **原子写**（同目录 tmp → rename），避免半截文件损坏账本；
 *   · 写后**回读校验**，失败自动从备份回滚；
 *   · **幂等**：以**编号为主键**，已存在且内容相同 → 跳过（不改文件、不建备份）。
 *
 * ⚠ 本模块**刻意不 import `config.ts`** —— 配置由调用方以 options 传入。
 *   这样它可以被独立测试，也避免 core/server 反向依赖配置类型。
 */
import { lstat, readFile, writeFile, rename, readdir, unlink, mkdir, rm } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { resolveInside } from './doc-read.ts'
import { renderReadings, renderReadingsNote, type RenderResult } from './hob-render.ts'

// ── 白名单：骨架只读，运行数据/方案可写（与 UD-05 的切分同一条线）─────────────

/**
 * 可写的账本文件（**运行数据 + 项目方案**）。
 *
 * 沿革：
 *   · 原含 `FACTS.md`，2026-10-09 按 **UD-84** 退场（四本 → 三本）；
 *   · **2026-10-10 按 UD-88 / CHG-025 加入 `PROJECT.md`** —— 用户裁定
 *     「这些都是 hob 的账本，不要放工作区，**包括项目方案**」
 *     ⇒ 方案随账本一起住在账本区（工作区里**不再有任何项目文档**）。
 *
 * ⚠ **纪律（不加技术闸门）**：方案**只有用户能批准变更、Hob 只提议**。
 *   这条是**程序纪律**，写在方案自身与 `.hob/README.md` 里 ——
 *   **不**在这里写"禁止写方案"的代码：那会把该由人守的规矩变成静默的拒绝，
 *   而 `write_hob` 的语义是"按你给的路径与内容如实写"。
 */
export const LEDGER_FILES = ['PROJECT.md', 'DECISIONS.md', 'USER-DECISIONS.md', 'CONTEXT.md'] as const

/** 骨架文件（**拒写**）：格式契约，进 git，变更须人工 + commit。 */
export const SKELETON_FILES = ['README.md'] as const

/** 骨架目录（**拒写**）。 */
export const SKELETON_DIRS = ['templates'] as const

/** 工具自管的备份目录（**模型也不可写** —— 最小权限：备份只由本模块产生）。 */
export const BACKUP_DIR = 'backups'

/** 归档目录名必须长这样（与既有 4 个归档目录一致）。 */
const ARCHIVE_DIR_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/
/** 归档路径：`archive/<日期目录>/<名字>.md`（**只允许一层**子目录）。 */
const ARCHIVE_PATH_RE = /^archive\/([^/]+)\/([^/]+\.md)$/

/**
 * 卷路径：`volumes/<卷>/<文件>.md`（**只允许一层**子目录）—— 2026-10-11 第 78 轮 ·
 * **UD-95 / CHG-032**：账本与方案改为「**地图＋分卷、一事一文件**」。
 *
 * ⚠ **只放开卷目录，不放宽其余任何白名单**：账本根那几份仍是 `LEDGER_FILES` 原样，
 *   `archive/` 仍走 `ARCHIVE_PATH_RE`，骨架仍拒写。
 *
 * ⚠ **两条命名规则与归档目录"同档"**：
 *   · 卷目录名 slug：**只允许小写字母 / 数字 / 连字符**（`^[a-z0-9-]+$`，与
 *     `ARCHIVE_DIR_RE` **同字符集**）—— 理由见 **R-16**：写侧守卫是**窄**的那一档
 *     （"能不能建"），判据侧是**宽**的那一档（"认不认得出"），两档**别混**。
 *   · 卷内文件名：`^[A-Za-z0-9._-]+\.md$` —— 允许点号/大写（条目文件名是人给的事实名，
 *     不像卷 slug 那样参与路径构造）。
 *
 * ⚠ **有意留下的已知边界（本轮不修，如实登记）**：**卷内路径本轮不加入「具名引用」判据**
 *   —— `REF_PATH_RE` / `REF_TASK_RE` **一字不改**。后果：正文里写
 *   `volumes/<卷>/<文件>.md` 这种**指不到实体**的引用，写侧不会当场点名
 *   （归档路径那一路仍然会）。⇒ 记入 `DECISIONS.md` CHG-032 的"不做（边界）"，
 *   留待搬家轮或后续单独立项时再收紧。
 */
const VOLUME_DIR_RE = /^[a-z0-9-]+$/
/** 卷路径：`volumes/<卷>/<文件>.md`（**只允许一层**子目录）。 */
const VOLUME_PATH_RE = /^volumes\/([^/]+)\/([A-Za-z0-9._-]+\.md)$/

/**
 * ⚠ ⚠ **卷下的「具名两层子目录」白名单** —— 2026-10-15 第 213 轮 · **UD-116（用户裁定「A」）**。
 *
 * ── 为什么有这一条（缺口有实测出处）──────────────────────────────────
 *   **第 210 轮**按 `UD-114` 把轮次登记换成「**一轮一文件**」，落在
 *   `volumes/context/rounds/`（**118 件**）—— ⚠ 那是**两层**。
 *   ⚠ ⚠ **第 211 轮实测：`write_hob` 写那个目录被工具当场拒绝**（上面的 `VOLUME_PATH_RE`
 *   **只到一层**）⇒ ⚠ **Hob 写不了自己的轮次记录**，第 211 轮那件只能暂存进 `archive/`。
 *   ⇒ ⚠ 本清单就是**把那个目录收进白名单**，且**只收这一个**。
 *
 * ── ⚠ ⚠ 「下次再出现一个新的两层目录怎么办」（`UD-115` 的核心 · ⛔ 别当特例读）
 *   ① **动作 = 把它的相对路径（如 `context/rounds`）加进本数组** —— ⚠ **一行**，⛔ 不改任何正则；
 *   ② ⚠ **且有东西强制你登记**：`npm run check:gitignore` 的 **Q 组**会**扫账本区**里
 *      实际存在的 `volumes/<卷>/<子目录>/`，⚠ **凡不在本数组里的，当场 FAIL 并点名那条路径**；
 *   ③ ⇒ ⚠ **只把 `rounds` 写成特例这件事，⛔ 不会重演**：⚠ 下一条新两层目录**不登记就跑不过收尾**。
 *   ⚠ **为什么不直接放开成 `volumes/**`**（⛔ 那是被明确否掉的做法）：那会把
 *   `volumes/<卷>/<任意深>/<任意名>` 一并放进来 ⇒ **边界白设**；本清单是**窄**的那一档。
 *
 * ⚠ **只放开这两处，⛔ 不放宽其余任何白名单**：账本根那几份仍是 `LEDGER_FILES` 原样，
 *   `archive/` 仍走 `ARCHIVE_PATH_RE`，骨架仍拒写，软链 / 缩水守卫 / 归档禁 overwrite **一条未动**。
 * ⚠ **命名规则与卷 slug 同档**：⚠ 子目录的**每一层**都只允许小写字母 / 数字 / 连字符
 *   （`^[a-z0-9-]+$`，与 `VOLUME_DIR_RE` / `ARCHIVE_DIR_RE` **同字符集** · 理由见 **R-16**）。
 */
export const VOLUME_SUBDIRS = ['context/rounds'] as const

/** 具名两层子目录下的路径：`volumes/<卷>/<子目录>/<文件>.md`（⚠ 登记名含"卷/子目录"两层）。 */
const VOLUME_SUBDIR_PATH_RE = /^volumes\/([a-z0-9-]+\/[a-z0-9-]+)\/([A-Za-z0-9._-]+\.md)$/

/**
 * 交接文件判据（2026-10-10 新增）：`archive/<日期目录>/TASK*.md`。
 *
 * ── 为什么是**路径形状**而不是内容 ──────────────────────────────────────
 *   本模块的职责是「守卫 + 落地」，**不解析正文语义** —— 若改成"看正文里有没有
 *   指令段"，就多出一个**会漂移的判据点**（正文格式由另一侧决定）。
 *   而"交接文件叫什么名字"是**本项目已有的事实**：`.hob/README.md` §1 与
 *   `preset/dsh-hob/preset-dsh-hob.patch.yml` 都写着交接文件落
 *   `archive/<日期>/TASK.md`（沿革：`TASK-*.md` / `TASK-Rn.md` 同族）。
 *
 * ⚠ 判据**宁可宽**（多提示一次无害）：`TASK*.md` 大小写不敏感、允许
 *   `TASK.md` / `TASK-R22.md` / `TASK-R22-ADDENDUM.md` ——
 *   漏判 = 该提示不出现（本缺陷的形态）；误判 = 多一句提示（无害）。
 */
export function isHandoffPath(file: string): boolean {
  const m = ARCHIVE_PATH_RE.exec(file)
  if (m === null) return false
  return /^task/i.test(m[2]!)
}

/**
 * ── ②「先落副本」提醒的**判据**（2026-10-15 · 第 221 轮 · `UD-117` 第 ② 组）──────────
 *
 * **背景（R-17「先落副本」本批三度未做到）**：⚠ **三份副本全是"重写之后才补"**
 *   ⇒ ⚠ 根因 = **"重写正本"那一刻没有任何东西提醒先落副本**。
 * ⚠ **触发条件（作业书 §2② 指定）**：⚠ **被覆盖的是一份「已存在且未归档」的正本**。
 *   · **已存在** ⇒ `exists === true`（⚠ ⛔ 不含"用 overwrite 创建新文件"那一支）；
 *   · **未归档** ⇒ ⚠ **路径不在 `archive/` 下**（⚠ 归档是只增不改的历史：
 *     它连 `overwrite` 都已被 `:655` 那条拒绝 ⇒ ⚠ **本提醒对归档路径永不适用**）；
 *   · **是"正本"** ⇒ ⚠ 判据 = **账本根上的一层 `.md`**（⚠ 与 `check-doc-shape.mjs` 的
 *     `derivePrimaryFiles()` 同口径：根上那些就是**地图 / 正本**那一档）。
 *     ⚠ 卷内文件（`volumes/**`）**不算**"正本" —— 它们是**分卷正文**。
 *
 * ⚠ **判据宁可窄**（⚠ 与 `isHandoffPath` 的"宁可宽"相反）：⚠
 *   **误报**会让"该提醒"这件事**贬值**（每次都提醒 = 每次都忽略）；
 *   ⚠ **漏报**的代价 = 回到本组要治的老形态。⚠ 故只圈**最典型的那一档**：根上正本。
 * ⚠ ⛔ **本函数只判"要不要提醒"，⛔ 不判"写不写"** —— **只提示、不拒写**（作业书 §2② 明令）。
 */
export function isPrimaryRootDoc(file: string): boolean {
  if (file.includes('/')) return false            // ⚠ 只认根上一层（卷 / 归档 / 备份全排除）
  return /^[A-Za-z0-9._-]+\.md$/.test(file)
}

// ── 改 1 · 写入边界校验：具名引用存在性（2026-10-10 第 44 轮 · 结构改造①）──────

/**
 * 具名归档路径（与 `scripts/check-doc-shape.mjs` 的**断言 D** 同源）。
 *
 * ⚠ 2026-10-11 第 60 轮：`check-gitignore.mjs` 已拆为「薄调度 + 三个模块」，
 *   **本正则的检查侧同源点搬到了 `scripts/check-doc-shape.mjs`**（入口名不变）。
 *
 * ⚠ **同源纪律**（E-110：一个常量只服务一条断言 —— 这里是"一处口径两处用"，
 *   与断言 D 必须**逐字同源**）：改这里请对一眼
 *   `scripts/check-doc-shape.mjs` 的 `D_REF_RE`，反之亦然。
 *   ⚠ 为什么**照抄而不 import**：写侧（`src/`）与检查侧（`scripts/`）是两棵
 *   互不依赖的树，`src/` 不能 import `scripts/`（那会把检查脚本变成产品依赖）。
 *   ⇒ 照抄 + 在两侧注释里互相指名。
 *
 * ⚠ **只认** `archive/<YYYY-MM-DD-slug>/…` ⇒ 占位形态（`archive/<日期>-<名>/`）
 *   **天然落选**（`<` 与 CJK 不匹配 `\d{4}-\d{2}-\d{2}`）。见 **E-114**。
 *
 * ⚠ **2026-10-11 第 54 轮收紧（只收紧、不放宽）** —— 修一个**两面一起失效**的真缺口：
 *   原 slug 字符集是 `[a-z0-9-]`，**点号不在内** ⇒
 *   `archive/2026-10-11-plan-v2.2/PROJECT.md`（slug 里有点号）**整条不被当引用** ⇒
 *   写入侧**一声不响**，收尾侧（断言 D 的同源正则）**同样不报** ——
 *   而写工具自己的 `ARCHIVE_DIR_RE` 会**直接拒写**那种目录
 *   ⇒ **写下一条永远创建不出来的路径，全程无人提醒**（Hob 第 54 轮实测）。
 *   ⇒ 现把 slug 字符集放宽到 `[A-Za-z0-9._-]`（**能容纳"含点号 / 大写"的非法 slug**），
 *     使它**能被当引用去核实**：指向实体 ⇒ 通过；指不到 ⇒ **当场点名**。
 *   ⚠ **这不是放宽**：旧正则在**每一处**都仍然匹配（严格超集，第 54 轮用 504 组组合实测
 *     `lost(旧有新无)=0`）⇒ 既有断言一句都没被削弱，只是**多认出了一种坏写法**。
 *   ⚠ **合法性判据仍归 `ARCHIVE_DIR_RE`**（`^[a-z0-9-]+$`）—— 本正则只负责"**把它算作引用**"，
 *     **不负责判它合规**；两者分工不要混。
 *   ⚠ **同源的另一面**：两侧**逐字同源**既是纪律（E-110），也意味着**一个缺陷会同时在两侧静默**
 *     —— **"两边一致"不等于"两边都对"**（本轮两边一致地错）。见 **E-130**。
 */
const REF_PATH_RE = /archive\/\d{4}-\d{2}-\d{2}-[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]*/g

/**
 * 作业书文件名（与 `scripts/check-doc-shape.mjs` 的**断言 D′** 同源）。
 *
 * ⚠ 2026-10-11 第 60 轮：`check-gitignore.mjs` 拆分后，本正则的检查侧同源点
 *   搬到了 `scripts/check-doc-shape.mjs`（入口名 `check:gitignore` 不变）。
 *
 * ⚠ **编号必须是数字**（`TASK-R\d+…`）—— 第 26 轮修出来的精度：
 *   原判据 `TASK-R[A-Za-z0-9-]*\.md` 会把「别为了齐整给每轮都编一个
 *   `TASK-Rnn.md`」这种**反例示意名**判成"不存在的引用"（**E-114 / E-113**）。
 *   `Rnn` 不是文件名形态（真作业书是 `TASK-R21.md`）⇒ 排除。
 */
const REF_TASK_RE = /TASK-R\d+[A-Za-z0-9-]*\.md/g

/** 一条**指不到实体**的具名引用。 */
export interface DanglingRef {
  /** 引用的字面文本。 */
  ref: string
  /** 在**新写入内容**里的行号（1 起；便于调用方点名）。 */
  line: number
  /** 引用类型：归档路径 / 作业书文件名。 */
  kind: 'archive-path' | 'task-file'
}

/**
 * **写入边界校验**（2026-10-10 第 44 轮 · 结构改造①）：扫新写入的内容，
 * 逐条核实**具名引用**（归档路径 / 作业书文件名）是否**真的存在**。
 *
 * ── 为什么放在写入工具里（而不是只靠事后收尾检查）─────────────────────
 *   既有防线是**断言 D / D′**，它扫的是**账本区四份正本**、且**在收尾时**才跑 ⇒
 *   引用写错要等到那一轮收尾**才被发现**（跨动作、跨时间、跨人）。
 *   ⇒ 本函数把同一条判据**搬到写入的那一刻、当场**（"Parse, don't validate"
 *     的落地：校验放在**数据产生的边界**上）。
 *
 * ⚠ **只报告、不拒绝**：写入语义是"按你给的路径与内容如实写"。
 *   本函数**不改 `ok`、不改 `action`**，只回一个可读清单。
 *
 * ⚠ **判据同源**：与断言 D / D′ 用**同一条正则语义**（见上面两个常量的注释）。
 *
 * ⚠ **不许咬到的形态**（E-114 家族 —— "描述这条校验自身"的句子必须能安全存在）：
 *   · `archive/<日期>-<名>/`（占位：含 `<` 与 CJK ⇒ 不匹配 `\d{4}-\d{2}-\d{2}`）
 *   · `TASK-*.md` / `TASK-R*.md`（通配：含 `*` ⇒ 显式跳过）
 *   · `TASK-Rnn.md`（示意名：编号非数字 ⇒ 不匹配 `\d+`）
 *   ⇒ 三类**按设计不计**。
 *
 * @param ledgerRoot - 账本区根（引用相对它解析）。
 * @param content - 刚写入（或即将写入）的文本。
 * @returns 指不到实体的引用清单（**空数组 = 全部指得到**）。
 */
export function collectDanglingRefs(ledgerRoot: string, content: string): DanglingRef[] {
  const out: DanglingRef[] = []
  const lines = content.replace(/\r\n/g, '\n').split('\n')

  // 账本区 `archive/` 下所有文件的 basename 集合（扫一次，供 D′ 逐条比对）。
  // ⚠ 与断言 D′ 同款：作业书通常只写文件名，故**按 basename 在 archive 各日期子目录下找**
  //   （要求写全路径会把正确写法判成违规）。
  const archiveBasenames = ((): Set<string> => {
    const set = new Set<string>()
    try {
      for (const d of readdirSync(join(ledgerRoot, 'archive'))) {
        let entries: string[] = []
        try { entries = readdirSync(join(ledgerRoot, 'archive', d)) } catch { continue }
        for (const e of entries) set.add(e)
      }
    } catch { /* archive 不可读 ⇒ 空集（比对会因此全部报"不存在"，宁可报也不静默） */ }
    return set
  })()

  lines.forEach((line, i) => {
    for (const m of line.matchAll(REF_PATH_RE)) {
      const ref = m[0]
      if (ref.includes('*')) continue // 通配不是具名引用
      if (!existsSync(join(ledgerRoot, ref))) out.push({ ref, line: i + 1, kind: 'archive-path' })
    }
    for (const m of line.matchAll(REF_TASK_RE)) {
      const ref = m[0]
      if (ref.includes('*')) continue
      if (!archiveBasenames.has(ref)) out.push({ ref, line: i + 1, kind: 'task-file' })
    }
  })
  return out
}

/** 把悬空引用清单渲染成一句**能直接贴进返回值**的提醒（空清单 ⇒ 空串）。 */
export function renderDanglingRefsNote(refs: DanglingRef[]): string {
  if (refs.length === 0) return ''
  const items = refs.map((r) => `\`${r.ref}\`（第 ${r.line} 行）`).join(' · ')
  return `\n⚠ 引用核验：本次写入含 ${refs.length} 处**指不到实体**的具名引用（**只提示、未拒写**）——`
    + ` ${items}`
    + '\n  ↳ 核实：在账本区根跑 `ls` 逐条确认；形如 `archive/<日期>-<名>/`、`TASK-Rnn.md`、'
    + '`TASK-R*.md` 属**占位/示意/通配**，按设计不计。'
}

// ── 结果与原因码（原因码供机器判定；验收测试直接断言它）─────────────────────


export type WriteAction = 'appended' | 'overwritten' | 'skipped' | 'refused'

export type RefuseReason =
  | 'no-workspace-root'
  | 'outside-hob'
  | 'symlink'
  | 'skeleton'
  | 'not-whitelisted'
  | 'not-markdown'
  | 'too-large'
  | 'bad-format'
  | 'id-not-sequential'
  | 'id-conflict'
  | 'shrinking'
  | 'archive-overwrite-denied'
  | 'write-failed'
  | 'readback-mismatch'

export interface WriteHobResult {
  ok: boolean
  action: WriteAction
  /** 相对 `.hob/` 的路径（规范化 `/`）。 */
  file: string
  /** 本条目的编号（只有带编号的文件会有）。 */
  id?: string
  /** 备份路径（相对 `.hob/`）；无备份时缺省。 */
  backup?: string
  bytesBefore?: number
  bytesAfter?: number
  /** 给人/模型看的一句话。 */
  message: string
  /** 机器可判的原因（refused / skipped 时给出）。 */
  reason?: RefuseReason | 'idempotent'
  /**
   * **交接文件判定**（2026-10-10 新增 · 用户报障修复）—— 只描述事实：
   * "这个路径看起来是交接文件"。**由调用方决定记不记**（本模块**不碰** orch-state，
   * 它刻意不 import config / 不碰运行态，见文件头分层纪律）。
   *
   * ⚠ 这是**新增字段**，既有字段一个未动（`ok` / `action` / `file` / `id` /
   *   `backup` / `bytesBefore` / `bytesAfter` / `message` / `reason` 名字与语义都不变）。
   * ⚠ 判据是**路径形状**（`archive/<日期目录>/TASK*.md`），不是内容 ——
   *   本模块的职责是"守卫 + 落地"，不该解析正文语义（那会引入第二个判据点）。
   */
  handoff?: { kind: 'task-file'; ref: string }
  /**
   * **悬空具名引用**（2026-10-10 第 44 轮 · 结构改造①）—— 本次写入里
   * "指不到实体"的归档路径 / 作业书文件名。**只描述事实，由调用方决定怎么提示**。
   *
   * ⚠ 这是**新增字段**，既有字段一个未动；⚠ **不影响 `ok`** ——
   *   写入了就还是 `ok: true`（写入语义是"如实写"，**不是**"内容合规才写"）。
   * ⚠ 与 `handoff` 同款分层：本模块**不碰**运行态、不 import 配置，只回事实。
   */
  danglingRefs?: DanglingRef[]
  /**
   * **读数渲染**（2026-10-11 第 47 轮 · 结构改造④）—— 本次写入里
   * 「占位标记 → 实值」的渲染清单与拒绝清单。**只描述事实**。
   *
   * ⚠ 这是**新增字段**，既有字段一个未动；⚠ **不影响 `ok`** ——
   *   渲染了值、或拒绝了某个标记，**都不改写入语义**（"如实写"不是"内容合规才写"）。
   * ⚠ 与 `danglingRefs` 同款分层：本模块只回事实，措辞由调用方拼。
   */
  readings?: RenderResult
  /**
   * ── ②「先落副本」提醒（2026-10-15 · 第 221 轮 · `UD-117` 第 ② 组）────────────────
   *
   * ⚠ **只描述事实**：本次 `overwrite` 覆盖的是一份**已存在且未归档的根上正本**
   *   ⇒ ⚠ **该先落副本**（R-17）。⚠ **调用方决定怎么提示**（本模块不拼长文案）。
   *
   * ⚠ 这是**新增字段**，既有字段一个未动；⚠ ⛔ **不影响 `ok`**（⚠ **只提示、不拒写**）。
   * ⚠ 与 `danglingRefs` / `readings` 同款分层：**只回事实**。
   * ⚠ ⚠ **它在何时为真**：⚠ 仅当 `mode === 'overwrite'` **且** `exists === true`
   *   **且** `isPrimaryRootDoc(file)`。⚠ 缩水守卫 / 骨架拒写 / 归档禁 overwrite
   *   **一条都不因它而变**（⚠ 它在那些守卫**之后**、落盘**之前**判）。
   */
  preOverwriteBackupReminder?: { file: string; bytesBefore: number }
  /**
   * ── ⚠ ⚠ **账本根原先不存在**（2026-10-16 · 第 247 轮 · `TASK-R207`）────────────
   *
   * ⚠ **它治的缺陷**（第 243 轮实测 · `REPORT-R205.md` §3.2-d）：`write_hob` 在
   *   **账本根整个不存在**时会 `mkdir -p` **静默新建一份账本**，⚠ 并返回 **`ok: true`**
   *   ⇒ ⚠ ⚠ 在"够不到账本"的部署里，读者以为"写成功了"，其实**建了一份新的空账本**
   *   （⚠ 两份账本各自漂 = `M6-PLAN` **R1** 的形态）。
   *
   * ⚠ ⚠ **本字段只描述事实，⛔ 不改写入语义**（⛔ 不拒绝、⛔ 不改 `ok`）——
   *   与 `danglingRefs` / `readings` / `preOverwriteBackupReminder` **同款分层**。
   *
   * ⚠ ⚠ **为什么⛔ 不能直接把它变成拒绝**（本单实测的结论，见报告 §3.3）：
   *   ① **"首次为一个新工作区建账本"是正当路径**，而它由**人工**做
   *      （`.hob/INIT.md` §3.1 的 `mkdir -p "$NEW"/{…}` + `cp` 模板）；
   *   ② ⚠ **"正当新建"与"够不到而误建"在本函数里区分不了** ——
   *      两者都是"账本根不存在 + 有人来写"（⚠ 本函数**看不到**调用方是谁、意图是什么）。
   *   ⇒ ⚠ 按作业书 §3③ 的明令：**只报读数 + 登记，⛔ 不硬改**。
   */
  ledgerRootCreated?: { ledgerRoot: string }
}

export interface WriteHobOptions {
  /** 账本目录名（相对工作区根），默认 `.hob`。 */
  hobDir: string
  /** 每个文件保留的备份份数上限。 */
  keepBackups: number
  /** 缩水守卫阈值：overwrite 后新内容 < 旧内容 × 该比例 → 拒绝。 */
  shrinkGuard: number
  /** 结果文件字节上限（含 content）。 */
  maxFileBytes: number
}

export interface WriteHobInput {
  /** 相对 `.hob/` 的路径，如 `CONTEXT.md`、`archive/2026-10-03-x/A.md`。 */
  file: string
  /** Markdown 文本（**由调用方按模板产出，本模块只校验、不构造**）。 */
  content: string
  mode?: 'append' | 'overwrite'
  reason?: string
  /** 只跑全部校验、不落盘（便于自检与测试）。 */
  dryRun?: boolean
}

// ── 小工具 ──────────────────────────────────────────────────────────────────

/** 归一化：统一换行、去行尾空白、去首尾空行 —— 用于幂等比对。 */
function normalize(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .trim()
}

/** 检测文件主导换行符，让追加内容与原文件一致。 */
function dominantEol(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

/** 规范化用户给的 `file`：去 `./`、统一 `/`。 */
function normalizeRelPath(file: string): string {
  return file.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/')
}

/** 时间戳：`YYYYMMDD-HHMMSS`（本地时区，人读友好）。 */
function stamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function refuse(file: string, reason: RefuseReason, message: string): WriteHobResult {
  return { ok: false, action: 'refused', file, message, reason }
}

// ── 路径守卫 ────────────────────────────────────────────────────────────────

/**
 * ⚠ 走链检查的实现**不在本文件** —— 它在 `doc-read.ts`（本文件已 import 它，
 *   反过来 import 会成环）。读侧与写侧**共用同一份**，满足「守卫只写一份」。
 *   历史：本函数原先在这里、只给写侧用；第 4 步发现读侧**确实可被读穿**
 *   （工作区内放一个指向区外的 `.md` 软链，`read_contracts` 把区外内容读了出来，
 *   实测见 `.hob/archive/2026-10-05-step4-evidence/`），于是把它上提到
 *   `doc-read.ts` 并导出，两侧共用。
 */
import { findSymlinkOnPath } from './doc-read.ts'

/** 白名单判定：返回拒绝结果，或 `null` 表示放行。 */
function checkWhitelist(file: string): WriteHobResult | null {
  // 骨架：显式拒绝（并说明原因，别让调用方猜）
  if ((SKELETON_FILES as readonly string[]).includes(file)) {
    return refuse(file, 'skeleton', `拒绝：${file} 是**骨架**（格式契约，进 git），write_hob 不可写。骨架变更请走人工编辑 + commit。`)
  }
  if ((SKELETON_DIRS as readonly string[]).some((d) => file === d || file.startsWith(d + '/'))) {
    return refuse(file, 'skeleton', `拒绝：${file} 在骨架目录 templates/ 下，write_hob 不可写。`)
  }
  // 备份目录：工具自管，模型不可写（最小权限）
  if (file === BACKUP_DIR || file.startsWith(BACKUP_DIR + '/')) {
    return refuse(file, 'not-whitelisted', `拒绝：${BACKUP_DIR}/ 由 write_hob 自管，不接受写入。`)
  }
  // 账本 + 项目方案（PROJECT.md 自 2026-10-10 / UD-88 起与账本同级）
  if ((LEDGER_FILES as readonly string[]).includes(file)) return null
  // 归档：只允许 archive/<日期目录>/<名>.md，且只一层
  const m = ARCHIVE_PATH_RE.exec(file)
  if (m !== null) {
    if (!ARCHIVE_DIR_RE.test(m[1]!)) {
      return refuse(file, 'not-whitelisted', `拒绝：归档目录名须形如 YYYY-MM-DD-<slug>（你给的是 ${m[1]}）。`)
    }
    return null
  }
  // 卷：只允许 volumes/<卷>/<文件>.md，且只一层（2026-10-11 第 78 轮 · UD-95 / CHG-032）
  const v = VOLUME_PATH_RE.exec(file)
  if (v !== null) {
    if (!VOLUME_DIR_RE.test(v[1]!)) {
      return refuse(
        file,
        'not-whitelisted',
        `拒绝：卷目录名只允许小写字母 / 数字 / 连字符（你给的是 ${v[1]}）。`,
      )
    }
    return null
  }
  // 卷下的**具名两层**子目录（2026-10-15 第 213 轮 · UD-116）—— ⚠ 只认 `VOLUME_SUBDIRS` 里登记的那些
  const vs = VOLUME_SUBDIR_PATH_RE.exec(file)
  if (vs !== null) {
    const subDir = vs[1]!
    if (!(VOLUME_SUBDIRS as readonly string[]).includes(subDir)) {
      return refuse(
        file,
        'not-whitelisted',
        `拒绝：卷下两层子目录 \`${subDir}\` **未登记**（可写的是：${VOLUME_SUBDIRS.join(' / ')}）。`
          + `\n      ⇒ ⚠ 新增一个这样的目录 ⇒ **把它的相对路径加进 \`src/server/hob-write.ts\` 的 \`VOLUME_SUBDIRS\`**（一行）；`
          + `\n      ⚠ 且有断言强制登记：\`npm run check:gitignore\` 的 **Q 组**会扫出未登记的两层目录并 FAIL。`,
      )
    }
    return null
  }
  return refuse(
    file,
    'not-whitelisted',
    `拒绝：${file} 不在白名单内。可写：${LEDGER_FILES.join(' / ')} / archive/<YYYY-MM-DD-slug>/*.md / volumes/<卷>/*.md / volumes/<卷>/<具名两层子目录>/*.md（${VOLUME_SUBDIRS.join(' / ')}）。`,
  )
}

// ── 编号与幂等 ──────────────────────────────────────────────────────────────

interface IdSpec {
  /** 从 content 里抽编号的完整匹配。 */
  full: RegExp
  /** 该编号在**存量文件**里的出现形式。 */
  family: RegExp
  /** 该编号族名（`F` / `UD` / `CHG`），仅用于报错。 */
  label: string
}

/** 带编号的两个文件各自的编号规则（`CONTEXT.md` 无编号，不入此表）。 */
const ID_SPECS: Record<string, IdSpec> = {
  'USER-DECISIONS.md': { full: /\bUD-(\d+)\b/, family: /UD-(\d+)/g, label: 'UD' },
  'DECISIONS.md': { full: /\bCHG-(\d+)\b/, family: /CHG-(\d+)/g, label: 'CHG' },
}

/** 从 content 里抽出编号（返回展示串 + 序号）。 */
function extractId(file: string, content: string): { id: string; num: number } | null {
  const spec = ID_SPECS[file]
  if (spec === undefined) return null
  const m = spec.full.exec(content)
  if (m === null) return null
  return { id: m[0], num: Number(m[1]) }
}

/** 存量文件里同族的最大序号。 */
function maxSeq(text: string, file: string): number {
  const spec = ID_SPECS[file]
  if (spec === undefined) return 0
  let max = 0
  for (const m of text.matchAll(spec.family)) {
    max = Math.max(max, Number(m[1]))
  }
  return max
}

/**
 * 取出存量文件里**某个编号对应的那一条**（用于幂等比对）。
 *
 * 两种形态都要支持：
 *   · 块形态（`### UD-004 · …` / `### CHG-006 · …`）：从该标题到下一个 `### ` 或文末；
 *   · 行形态（表格行 `| **UD-08** | … |` / `| F-R61 | … |`）：含该编号的那一行。
 */
function findEntryById(text: string, id: string): string | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const headRe = new RegExp(`^#{1,6}\\s+${id.replace(/[-]/g, '\\-')}\\b`)
  const headIdx = lines.findIndex((l) => headRe.test(l.trim()))
  if (headIdx !== -1) {
    let end = lines.length
    for (let i = headIdx + 1; i < lines.length; i++) {
      if (/^#{1,6}\s+\S/.test(lines[i]!.trim())) { end = i; break }
    }
    return lines.slice(headIdx, end).join('\n')
  }
  const rowIdx = lines.findIndex((l) => l.includes(id))
  return rowIdx === -1 ? null : lines[rowIdx]!
}

// ── 格式校验（只校验，不构造）───────────────────────────────────────────────

/** 表格行的列数（按 `|` 切，去掉首尾空段）。 */
function tableCols(line: string): number {
  const t = line.trim()
  if (!t.startsWith('|') || !t.endsWith('|')) return -1
  return t.slice(1, -1).split('|').length
}

/**
 * 各账本的**条目格式**校验：与 `.hob/templates/` 的列契约一致。
 *
 * 口径：只校验**结构形状**（行/块 + 列数），不校验语义内容 —— 语义靠模型，形状靠工具。
 */
function checkFormat(file: string, content: string): WriteHobResult | null {
  const body = normalize(content)
  if (body === '') return refuse(file, 'bad-format', '拒绝：content 为空。')

  if (file === 'USER-DECISIONS.md') {
    const isBlock = /^#{1,6}\s+UD-\d+/.test(body)
    if (!isBlock) {
      const offending = body.split('\n').find((l) => l.trim() !== '' && tableCols(l) !== 6)
      if (offending !== undefined) {
        return refuse(file, 'bad-format', `拒绝：USER-DECISIONS.md 条目须为 6 列表格行或 \`### UD-NNN · …\` 块。问题行：${offending.slice(0, 80)}`)
      }
    }
  }
  if (file === 'DECISIONS.md') {
    if (!/^#{1,6}\s+CHG-\d+\s*·/.test(body)) {
      return refuse(file, 'bad-format', '拒绝：DECISIONS.md 条目须以 `### CHG-NNN · <日期> · <标题>` 开头。')
    }
  }
  // CONTEXT.md：自由章节，不做形状校验
  return null
}

// ── 备份 ────────────────────────────────────────────────────────────────────

async function ensureDir(p: string): Promise<void> {
  await mkdir(p, { recursive: true })
}

/** 列出一个文件的历史备份（按名升序 = 时间升序）。 */
async function listBackups(backupDir: string, base: string): Promise<string[]> {
  try {
    const names = await readdir(backupDir)
    return names.filter((n) => n.startsWith(base + '.') && n.endsWith('.bak')).sort()
  } catch {
    return []
  }
}

/**
 * 写前备份：全量复制 + 与最近一份**去重** + 保留 `keepBackups` 份。
 *
 * 为什么全量而非 diff：账本是小文件，**可直接恢复**比省空间重要得多；
 * diff 要重放才能回退，回退路径越长越不可靠。
 *
 * @returns 备份文件名（相对备份目录）；未备份时 undefined。
 */
async function backup(
  absTarget: string,
  backupDir: string,
  keepBackups: number,
): Promise<string | undefined> {
  let original: Buffer
  try {
    original = await readFile(absTarget)
  } catch {
    return undefined // 文件尚不存在（首次创建）⇒ 无需备份
  }

  await ensureDir(backupDir)
  const base = absTarget.split(sep).pop()!
  const existing = await listBackups(backupDir, base)

  // 去重：与最近一份内容相同则不再新增（防"反复写同内容"刷屏）
  if (existing.length > 0) {
    const latestPath = join(backupDir, existing[existing.length - 1]!)
    try {
      const latest = await readFile(latestPath)
      if (latest.equals(original)) return existing[existing.length - 1]!
    } catch { /* 读不到就当没备份过 */ }
  }

  const name = `${base}.${stamp()}.bak`
  await writeFile(join(backupDir, name), original)

  // 保留 N 份：超出则删最旧
  const after = await listBackups(backupDir, base)
  const excess = after.length - Math.max(1, keepBackups)
  for (let i = 0; i < excess; i++) {
    try { await unlink(join(backupDir, after[i]!)) } catch { /* 删不掉不阻塞写入 */ }
  }
  return name
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

/**
 * 写入一个 `.hob/` 内的账本文件。
 *
 * @param root - 工作区根目录（绝对路径；不可解析时由调用方传 undefined）。
 * @param input - 写入请求。
 * @param opts - 策略参数（来自配置）。
 */
export async function writeHobFile(
  root: string | undefined,
  input: WriteHobInput,
  opts: WriteHobOptions,
): Promise<WriteHobResult> {
  const file = normalizeRelPath(input.file)
  const mode = input.mode ?? 'append'
  if (root === undefined || root.trim() === '') {
    return refuse(file, 'no-workspace-root', '拒绝：无法确定工作区根目录。')
  }
  /**
   * ⚠ ⚠ **写之前**账本根在不在（2026-10-16 第 247 轮 · `TASK-R207`）。
   *
   * ⚠ **必须在任何写动作之前取**：本函数稍后会 `ensureDir(dirname(absTarget))`
   *   **递归建目录** ⇒ ⚠ 之后再看就永远为 `true`（量不到事实）。
   * ⚠ 取法用 `existsSync(hobRoot)`（`hobRoot` 即 `resolveInside(root, hobDir).abs`
   *   —— ⛔ 不另写一份路径解析）。
   */
  const ledgerRootExistedBefore = existsSync(resolveInside(root, opts.hobDir).abs)

  // ── 1~6：静态守卫（全在动手之前）────────────────────────────────────────
  const hobRoot = resolveInside(root, opts.hobDir).abs
  const { abs: absTarget, inside } = resolveInside(hobRoot, file)
  if (!inside || file === '') {
    // ⚠ ⚠ **话术里的根路径**（2026-10-16 第 247 轮 / `TASK-R207` 修 · 作业书 §3④）：
    //   原字符串写 `${opts.hobDir}/` —— ⚠ 而 v4 起调用方传的是 `hobDir: ''`
    //   （账本根**本身**就是 `root`，见 `modules/tools.ts:600`）⇒
    //   ⚠ ⚠ **渲染出来是 `拒绝：只能写 / 目录内的文件。`** —— 读者看不到"哪个根"
    //   （第 243 轮实测原文 · `REPORT-R205.md` §3.2-f）。
    //   ⇒ 空 `hobDir` 时**改用真正判过的根**（`root`），⛔ 不改任何判据、⛔ 不改 reason 码。
    const shown = opts.hobDir === '' ? root : `${opts.hobDir}/`
    return refuse(file, 'outside-hob', `拒绝：只能写 ${shown}/ 目录内的文件。`)
  }
  if (!file.toLowerCase().endsWith('.md')) {
    return refuse(file, 'not-markdown', '拒绝：只允许写 .md 文件。')
  }
  const wl = checkWhitelist(file)
  if (wl !== null) return wl

  // .hob/ 自身若是软链，写出去就逃逸了 —— 连带检查
  try {
    const hobStat = await lstat(hobRoot)
    if (hobStat.isSymbolicLink()) {
      return refuse(file, 'symlink', `拒绝：${opts.hobDir}/ 本身是符号链接，写入可能逃出预期范围。`)
    }
  } catch {
    // .hob/ 不存在 → 稍后 mkdir 创建（正常首写）
  }
  const link = await findSymlinkOnPath(hobRoot, absTarget)
  if (link !== null) {
    return refuse(file, 'symlink', `拒绝：路径中存在符号链接（${link}），write_hob 不跟随软链。`)
  }

  const isArchive = file.startsWith('archive/')
  if (isArchive && mode === 'overwrite') {
    return refuse(file, 'archive-overwrite-denied', '拒绝：归档是只增不改的历史，不允许 overwrite（需覆盖请人工处理）。')
  }

  // ── 6.5：**读数渲染**（2026-10-11 第 47 轮 · 结构改造④）──────────────────
  //   ⚠ **必须在幂等比对之前**：存量里是**上次渲染出的实值**，而本次输入是**标记原文**
  //     ⇒ 若先比对再渲染，`normalize(existing) !== normalize(标记原文)` **永远成立**
  //     ⇒ **幂等跳过被破坏**（同一份内容每写一次都"有变化"）。
  //   ⚠ 也必须在 `contentBytes` 之前：落盘的是**渲染后**的内容，尺寸上限该按最终值算。
  //   ⚠ **纯函数**：同样输入 + 同样树 ⇒ 同样输出（⛔ 不渲染时间戳 / 随机数 / 本次操作产生的量）
  //     —— 这正是"幂等性必须保住"对渲染器的要求。
  const rendered = renderReadings(hobRoot, file, input.content)
  const content = rendered.content

  const contentBytes = Buffer.byteLength(content, 'utf8')
  if (contentBytes > opts.maxFileBytes) {
    return refuse(file, 'too-large', `拒绝：content ${contentBytes} 字节，超过上限 ${opts.maxFileBytes}。`)
  }

  // ── 7：读存量（append 需要它做编号/幂等；overwrite 需要它做缩水守卫）────
  let existing = ''
  let exists = true
  try {
    existing = await readFile(absTarget, 'utf8')
  } catch {
    exists = false
  }

  if (!exists && mode === 'overwrite') {
    // overwrite 一个不存在的文件 = 创建；允许，但缩水守卫无从比较
  }

  // ── 8：编号校验 + 幂等（append 才需要）────────────────────────────────
  let id: string | undefined
  if (mode === 'append') {
    const fmt = checkFormat(file, content)
    if (fmt !== null) return fmt

    const got = extractId(file, content)
    if (got !== null) {
      id = got.id
      const prev = exists ? findEntryById(existing, got.id) : null
      if (prev !== null) {
        if (normalize(prev) === normalize(content)) {
          return {
            ok: true, action: 'skipped', file, id,
            message: `⏭ 幂等跳过：${got.id} 已存在且内容一致（未改动文件、未建备份）。`,
            reason: 'idempotent',
          }
        }
        return refuse(file, 'id-conflict', `拒绝：编号 ${got.id} 已存在但内容不同。换一个新编号，或显式用 overwrite 整文件重写。`)
      }
      const max = exists ? maxSeq(existing, file) : 0
      if (got.num !== max + 1) {
        const label = ID_SPECS[file]!.label
        const expected = `${label}-${String(max + 1).padStart(2, '0')}`
        return refuse(file, 'id-not-sequential', `拒绝：编号不连续。${
          label
        } 当前最大为 ${`${label}-${String(max).padStart(2, '0')}`}，应写 ${expected}（你写的 ${got.id}）。`)
      }
    }
  }

  // ── 9：缩水守卫（overwrite）──────────────────────────────────────────────
  if (mode === 'overwrite' && exists) {
    const oldBytes = Buffer.byteLength(existing, 'utf8')
    const newBytes = contentBytes
    if (oldBytes > 0 && newBytes < oldBytes * opts.shrinkGuard) {
      const pct = Math.round((newBytes / oldBytes) * 100)
      return refuse(file, 'shrinking', `拒绝：overwrite 后仅剩原文件的 ${pct}%（${oldBytes} → ${newBytes} 字节），低于缩水阈值 ${Math.round(opts.shrinkGuard * 100)}%。这多半是内容没写全；确认无误请分两次写或人工处理。`)
    }
  }

  // ── 10：幂等（overwrite：结果与现状一致则跳过）──────────────────────────
  if (mode === 'overwrite' && exists && normalize(existing) === normalize(content)) {
    return {
      ok: true, action: 'skipped', file,
      message: '⏭ 幂等跳过：overwrite 内容与现有文件一致（未改动文件、未建备份）。',
      reason: 'idempotent',
    }
  }

  // ── 10.5：②「先落副本」提醒（⚠ **只判事实，⛔ 不拒写**）──────────────────────
  //   ⚠ 位置：⚠ **在缩水守卫（§9）与幂等跳过（§10）之后** ⇒
  //     · 被拒的写**根本不会走到这里**（⛔ 不会为一次拒绝发提醒）；
  //     · 幂等跳过的写也**已提前 return**（⛔ 没改动文件就没必要提醒落副本）。
  //   ⚠ 条件（作业书 §2②）= **overwrite + 已存在 + 未归档的根上正本**；
  //     ⚠ `archive/` 走不到这里（`:655` 已把 `archive + overwrite` 拒掉）⇒
  //     "未归档"这一半由**上游那道拒绝**保证，⚠ 但这里仍显式再判一次（⛔ 不靠隐式）。
  const needsCopyReminder = mode === 'overwrite' && exists && isPrimaryRootDoc(file)
  const copyReminder = needsCopyReminder
    ? { file, bytesBefore: Buffer.byteLength(existing, 'utf8') }
    : undefined

  // ── 11：组装最终内容 ────────────────────────────────────────────────────
  const eol = exists ? dominantEol(existing) : '\n'
  const body = eol === '\r\n' ? content.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n') : content.replace(/\r\n/g, '\n')
  let next: string
  if (mode === 'overwrite') {
    next = body.endsWith(eol) ? body : body + eol
  } else {
    // append：接在**最后一个非空行**之后，避免尾部空行越积越多
    const trimmed = existing.replace(/\s+$/, '')
    next = exists && trimmed !== '' ? trimmed + eol + eol + body.replace(/\s+$/, '') + eol : body.replace(/\s+$/, '') + eol
  }

  const nextBytes = Buffer.byteLength(next, 'utf8')
  if (nextBytes > opts.maxFileBytes) {
    return refuse(file, 'too-large', `拒绝：写入后文件将达 ${nextBytes} 字节，超过上限 ${opts.maxFileBytes}。`)
  }

  if (input.dryRun === true) {
    const dRefs = collectDanglingRefs(hobRoot, body)
    return {
      ok: true, action: mode === 'overwrite' ? 'overwritten' : 'appended', file, id,
      bytesBefore: Buffer.byteLength(existing, 'utf8'), bytesAfter: nextBytes,
      ...(dRefs.length === 0 ? {} : { danglingRefs: dRefs }),
      ...(rendered.rendered.length === 0 && rendered.refused.length === 0 ? {} : { readings: rendered }),
      // ⚠ ⚠ **dryRun 也要给同一条提醒**（⚠ 否则试跑与真跑不一致 —— 与 `readings` 同一条纪律）
      ...(copyReminder === undefined ? {} : { preOverwriteBackupReminder: copyReminder }),
      message: `[dryRun] 校验全过，将${mode === 'overwrite' ? '覆盖' : '追加'} ${file}（${Buffer.byteLength(existing, 'utf8')} → ${nextBytes} 字节），未落盘。`
        + renderDanglingRefsNote(dRefs)
        // ⚠ `dryRun` **也要渲染**（否则试跑与真跑不一致）：本函数在 §6.5 已渲染，
        //   这里只是**如实报出**它渲染了哪些值 —— 而**未落盘**。
        + renderReadingsNote(rendered)
        + renderCopyReminderNote(copyReminder),
    }
  }

  // ── 12：备份 ────────────────────────────────────────────────────────────
  const backupDir = join(hobRoot, BACKUP_DIR)
  let backupName: string | undefined
  try {
    backupName = await backup(absTarget, backupDir, opts.keepBackups)
  } catch (e) {
    return refuse(file, 'write-failed', `拒绝：写前备份失败（${e instanceof Error ? e.message : String(e)}）—— 不备份就不写。`)
  }

  // ── 13：原子写（同目录 tmp → rename）────────────────────────────────────
  await ensureDir(dirname(absTarget))
  const tmp = `${absTarget}.tmp-${process.pid}-${Date.now()}`
  try {
    await writeFile(tmp, next, 'utf8')
    await rename(tmp, absTarget)
  } catch (e) {
    try { await rm(tmp, { force: true }) } catch { /* 清理失败不掩盖主错误 */ }
    return refuse(file, 'write-failed', `写入失败：${e instanceof Error ? e.message : String(e)}`)
  }

  // ── 14：回读校验；不一致则从备份回滚 ────────────────────────────────────
  try {
    const back = await readFile(absTarget, 'utf8')
    if (!back.includes(body.replace(/\s+$/, '').split('\n')[0]!)) {
      throw new Error('回读内容与预期不符')
    }
  } catch (e) {
    let rolled = false
    if (backupName !== undefined) {
      try {
        await writeFile(absTarget, await readFile(join(backupDir, backupName)))
        rolled = true
      } catch { /* 回滚失败要在消息里说清 */ }
    }
    return refuse(file, 'readback-mismatch', `写入后回读校验失败（${e instanceof Error ? e.message : String(e)}）；${rolled ? '已从备份回滚' : '回滚未成功，请人工检查'}。`)
  }

  // ── 14.5：**改 1 · 写入边界校验**（2026-10-10 第 44 轮 · 结构改造①）────────
  //   ⚠ **只报告、不拒绝**：文件已经落盘且回读通过 ⇒ `ok` 仍为 true。
  //     本清单只是把"引用是否真实存在"这件事**从收尾时提前到写入时**。
  const danglingRefs = collectDanglingRefs(hobRoot, body)

  return {
    ok: true,
    action: mode === 'overwrite' ? 'overwritten' : 'appended',
    file,
    id,
    ...(backupName === undefined ? {} : { backup: `${BACKUP_DIR}/${backupName}` }),
    bytesBefore: Buffer.byteLength(existing, 'utf8'),
    bytesAfter: nextBytes,
    ...(isHandoffPath(file) ? { handoff: { kind: 'task-file' as const, ref: file } } : {}),
    ...(danglingRefs.length === 0 ? {} : { danglingRefs }),
    ...(rendered.rendered.length === 0 && rendered.refused.length === 0 ? {} : { readings: rendered }),
    // ⚠ ⚠ **②「先落副本」提醒**（⚠ 只提示、⛔ 不拒写 —— 同 `danglingRefs` / `rendered` 那一族）
    ...(copyReminder === undefined ? {} : { preOverwriteBackupReminder: copyReminder }),
    // ⚠ ⚠ **账本根原先不存在**（第 247 轮 · 形态丙的机器可读面 —— ⚠ 只报事实、⛔ 不拒写）
    ...(ledgerRootExistedBefore ? {} : { ledgerRootCreated: { ledgerRoot: root } }),
    message: `✅ 已${mode === 'overwrite' ? '覆盖' : '追加'} ${file}${id === undefined ? '' : `：${id}`}`
      + `（${Buffer.byteLength(existing, 'utf8')} → ${nextBytes} 字节）`
      + (backupName === undefined ? '' : `；备份 ${BACKUP_DIR}/${backupName}`)
      + renderDanglingRefsNote(danglingRefs)
      // ── 读数渲染的**出处**（E-118：值是工具算的，就要说得出是哪些值）────────
      + renderReadingsNote(rendered)
      // ── ②「先落副本」提醒的**文案**（⚠ 只提示、⛔ 不拒写 —— 含"归属说清"那一句）
      + renderCopyReminderNote(copyReminder)
      // ── 那一刻的提醒（2026-10-10 新增 · 那一轮**最高价值**的一处）────────────
      //   ⚠ 为什么必须在这里：这份文件写完后**还要再调一次投递**才算交付。
      //     实测漏了两次（第 9 / 21 轮），两次都是用户发现的 ——
      //     而"写成功"的返回值此前**只报写成功**，读的人看不出还有第二步。
      //   ⚠ 它是**提示、不是闸门**：不改写入语义、不拒绝写入、不影响任何既有字段
      //     （本条是 `message` 的**追加**文本）。
      //   ⚠ 措辞里**不出现内部标识**（包名 / 模块路径 / 文件路径）—— 这句话会被
      //     派活方读到并可能**复述给用户**。
      + (isHandoffPath(file)
        ? '\n⚠ 这是交接文件：**尚未投递** —— 写完本轮回复前先 hob_dispatch / hob_send'
          + '（或明确告知用户需手工转达）。'
        : '')
      // ── ⚠ ⚠ 形态【丙】的**可读标记**（2026-10-16 第 247 轮 · `TASK-R207`）──────
      //   ⚠ 只在"**写之前账本根本不存在**"时出现（`ledgerRootExistedBefore`）。
      //   ⚠ ⚠ **它不改写入语义**（`ok` 照旧 true —— 写入确实成功了）：
      //     它只是把"**刚刚发生了一次账本根新建**"这件事**说出来**。
      + renderLedgerRootCreatedNote(ledgerRootExistedBefore, root),
  }
}

/**
 * ⚠ ⚠ **形态【丙】的提醒文案**（2026-10-16 第 247 轮 · `TASK-R207`）。
 *
 * ⚠ **只提示、⛔ 不拒写**（与 `renderCopyReminderNote` / `renderReadingsNote` 同款分层）。
 *
 * ⚠ ⚠ **为什么⛔ 不做成闸门 / 拒绝**（本单实测结论 · 报告 §3.3）：
 *   ⚠ **"首次为一个新工作区建账本"是正当路径**（`.hob/INIT.md` §3.1 由**人工** `mkdir -p`），
 *   ⚠ ⚠ 而**"正当新建"与"够不到而误建"在本函数里区分不了** ——
 *   两者都是"账本根不存在 + 有人来写"。
 *   ⇒ ⚠ 故**只报事实**，把判断交回读者（⚠ 作业书 §3③ 的明令：说不清就**只报读数 + 登记**）。
 *
 * ⚠ 措辞里**不出现内部标识**（包名 / 模块路径）—— 与上面两条提醒同一纪律。
 *   ⚠ 但**必须出现账本根**：⚠ 本标记的**全部价值**就在于告诉读者"新建的是哪一个根"
 *   （⚠ 与 §3④ 那处"根渲染成空"正是同一条病 —— **失败/异常路径必须可读**）。
 */
function renderLedgerRootCreatedNote(existedBefore: boolean, ledgerRoot: string): string {
  if (existedBefore) return ''
  return `\n⚠⚠ 注意：**本次写入时账本目录原本不存在** —— 现在它被**新建**出来了（\`${ledgerRoot}\`）。`
    + '\n   ⇒ ⚠ 若这**不是**你要的账本（例如它本该在别的位置），'
    + '那说明**当前解析到的账本位置不对**：本读数**不能**当作一次正常写入接受。'
    + '\n   ⇒ ⚠ **只提示、不拒写**：本条不改写入语义，写入仍按你的指令执行。'
}

/**
 * ── ② 提醒文案（⚠ 只提示、⛔ 不拒写）──────────────────────────────────────────
 *
 * **必须含的三件（作业书 §2② 明令）**：
 *   ① **它现在是什么**（⚠ 例：这份正本要动手了）；
 *   ② **该先做什么**（⚠ 先把当时的整份**逐字节**归档 —— ⚠ **R-17**）；
 *   ③ **归属说清**（⚠ **"只提示、不拒写"**）。
 * ⚠ 措辞里**不出现内部标识**（包名 / 模块路径 / 绝对路径）—— 这句会被派活方读到并可能**复述给用户**
 *   （⚠ 与上面那条交接提醒同一条纪律）。
 */
function renderCopyReminderNote(r: WriteHobResult['preOverwriteBackupReminder']): string {
  if (r === undefined) return ''
  return `\n⚠ 提醒：这份正本（${r.file} · 现 ${r.bytesBefore} 字节）**要被整份重写了** ——`
    + '动手前**先把当时的整份逐字节落一份副本**（本项目 R-17：副本必须**先于**重写，不是事后补）。'
    + '\n   ⇒ ⚠ **只提示、不拒写**：本条不影响写入语义，写入仍按你的指令执行。'
}
