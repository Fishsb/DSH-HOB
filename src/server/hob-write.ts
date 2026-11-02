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
import { lstat, readFile, writeFile, rename, readdir, unlink, mkdir, rm, open, chmod, stat } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { resolveInside } from './doc-read.ts'
import { renderReadings, renderReadingsNote, type RenderResult } from './hob-render.ts'

// ── 白名单：骨架只读，运行数据/方案可写（与 UD-05 的切分同一条线）─────────────

/**
 * 可写的账本文件（**运行数据 + 项目方案 + 当前需求**）。
 *
 * 沿革：
 *   · 原含 `FACTS.md`，2026-10-09 按 **UD-84** 退场（四本 → 三本）；
 *   · **2026-10-10 按 UD-88 / CHG-025 加入 `PROJECT.md`** —— 用户裁定
 *     「这些都是 hob 的账本，不要放工作区，**包括项目方案**」
 *     ⇒ 方案随账本一起住在账本区（工作区里**不再有任何项目文档**）。
 *   · **2026-10-22（用户批准方案重构后）**：现行需求根从 `USER-DECISIONS.md`
 *     迁到 **`REQUIREMENTS.md`**，旧根转为**只读历史**（见 {@link RETIRED_LEDGER_FILES}）。
 *     ⚠ 迁移的落点是 **"只有一个现行需求写面"** —— 两本都能写就是两套真相并存，
 *     那正是本次重构要治的病（用户原话：「旧账本的现行职责改为只记录当前想实现的功能需求」）。
 *
 * ⚠ **纪律（不加技术闸门）**：方案**只有用户能批准变更、Hob 只提议**。
 *   这条是**程序纪律**，写在方案自身与 `.hob/README.md` 里 ——
 *   **不**在这里写"禁止写方案"的代码：那会把该由人守的规矩变成静默的拒绝，
 *   而 `write_hob` 的语义是"按你给的路径与内容如实写"。
 */
export const LEDGER_FILES = ['PROJECT.md', 'REQUIREMENTS.md', 'DECISIONS.md', 'CONTEXT.md'] as const

/**
 * 已退役的根正本（**只读历史，拒写**）。
 *
 * ⚠ **它们仍在账本区根上、仍必须逐字节可读** —— 本清单只改**写入面**，
 *   ⛔ 不动读面、⛔ 不动盘上任何一个字节、⛔ 不删不移。
 *
 * ⚠⚠ **为什么必须单列一个 reason、而不是"从白名单里拿掉就算了"**：
 *   拿掉之后它会落进 `not-whitelisted` 那句笼统话术 —— 读者读不出
 *   「它还在，只是退役了，现行需求在别处」，容易误判成"工具坏了"或"文件没了"，
 *   于是有人会去 hand-edit 旧根绕开工具 ⇒ 又被写回第二个现行需求面。
 *   ⇒ 专门一个 `retired-historical`，把**去向**直接写进拒绝话术。
 */
export const RETIRED_LEDGER_FILES = ['USER-DECISIONS.md'] as const

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

/**
 * ⭐⭐ **新账本（`ledger/`）的写入面** —— 2026-10-30 · P4 · `TASK-P4.md` §一②。
 *
 * ── 为什么必须开（这一条是整期重构的"能不能用"分水岭）──────────────
 *   P3 结束时 `ledger/` 住在**工作区**里 —— ⚠ **Hob 只能写账本区**，
 *   它一个字节都改不了那份索引 ⇒ **新账本只是个陈列品**（面板显示一份写不动的数据）。
 *   ⇒ P4 把整树搬进账本区，并把这里的写入面开出来。
 *
 * ── ⚠⛔ `gen/**` **不在这里**（有意）──────────────────────────────
 *   `gen/` 是 `npm run gen:ledger` 的**生成物**，手改即红（`CONSTITUTION` §2 / I5）。
 *   开它等于允许"绕过索引直接改产物" —— 那正是这次重构要消灭的编辑原语。
 */
export const LEDGER_WRITABLE_DIRS = ['ledger/units', 'ledger/spec', 'ledger/changes'] as const

/** 新账本里**唯一可写的单文件**（索引）；⚠ `ledger/gen/**` 与 `CONSTITUTION.md` / `PROJECT.md` 都不在此列。 */
export const LEDGER_WRITABLE_FILES = ['ledger/units/index.toml'] as const

/**
 * 新账本写入面的**路径正则**（`ledger/<dir>/<任意相对路径>`；⚠ 只认登记的那几个 `<dir>`）。
 * ⚠ 扩展名放开到 `.md` / `.toml` / `.json` —— `spec/` 与 `changes/` 里会有多种文本件。
 */
const LEDGER_PATH_RE = /^ledger\/(units|spec|changes)\/([A-Za-z0-9._/-]+)$/

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
// ⚠ **2026-10-25（搬家单收口）改了尾段字符类** —— 与 `scripts/check-doc-shape.mjs` 的
//   `D_REF_RE` **必须逐字相同**（机检 K 组盯这一对）。
//   ⚠ 原 `[A-Za-z0-9._/-]*` **不含 CJK** ⇒ `…/evidence/03-条件项查重证据.txt` 会被**截断**成
//   `…/evidence/03-` ⇒ 写入侧认错路径、判据侧假报"不存在"。
//   ⚠ 改成"到空白 / 反引号 / 右括号 / 右方括号为止"⇒ 中文文件名完整保留。
//   ⚠ **不是放宽**：`<` `>` 占位与 `{}` 枚举仍不在具名引用里（判据侧另有跳过）。
// ⚠ **2026-10-25（final-green）：与 `scripts/check-doc-shape.mjs` 的 `D_REF_RE` 逐字相同**
//   （机检 K 组盯这一对，⛔ 只改一侧）。改法 = 原字符类**逐字保留** + **追加 CJK 基本区**。
//   ⚠ 由"到分隔符为止"收回白名单写法：效果等，但不给自己留放宽的口子。
const REF_PATH_RE = /archive\/\d{4}-\d{2}-\d{2}-[A-Za-z0-9._-]+\/[A-Za-z0-9._/\u4e00-\u9fa5-]*/g

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
  /**
   * **退役的历史正本**（2026-10-22 · 现行需求根迁到 `REQUIREMENTS.md`）。
   * ⚠ 与 `not-whitelisted` **必须分成两个值** —— 两者的修法完全不同：
   *   · `not-whitelisted`：你写错地方了，换一个允许的路径；
   *   · `retired-historical`：这份文件**确实存在且可读**，但它**不再是写面**，
   *     现行需求在 `REQUIREMENTS.md`。
   *   ⚠ 并成一个值 = 把"退役"说成"不存在"，正是本项目反复记的那类"两种原因一句话"。
   */
  | 'retired-historical'
  | 'not-markdown'
  | 'too-large'
  | 'bad-format'
  | 'id-not-sequential'
  | 'id-conflict'
  | 'shrinking'
  | 'archive-overwrite-denied'
  /**
   * **读不出来 ≠ 不存在**（2026-10-24 · 本单必修 1/2/3）。
   *
   * ⚠ 与 `write-failed` 必须**分成两个值**：两者的修法完全不同 ——
   *   · `read-failed`：目标**可能就在那儿**，只是读不出来（EACCES / EIO / EISDIR…）
   *     ⇒ 停手，去查权限 / 磁盘 / 路径上挡了什么；
   *   · `write-failed`：读没问题，是**写**没落下去。
   * ⚠ 并把两者都并进 `write-failed` 的话，`bytesBefore:0` 那种假读数会重新变得"看起来正常"。
   */
  | 'read-failed'
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

// ── 读盘：**"不存在"与"读不出来"必须分开** ────────────────────────────────────

/**
 * 一次目标读盘的结果（⚠ 三态，⛔ 不许合并成"内容 + 布尔"）。
 *
 * ── 它治的缺陷（2026-10-24 · 本单必修 1/2/3）──────────────────────────────
 *   改前的写法是：
 *   ```ts
 *   let existing = ''
 *   let exists = true
 *   try { existing = await readFile(absTarget, 'utf8') } catch { exists = false }
 *   ```
 *   ⚠ `catch` **吞掉了错误码** ⇒ `EACCES` / `EIO` / `EISDIR` 全被当成
 *   "文件不存在（首次创建）" ⇒ 两个真后果：
 *   · **`append` 用空 `existing` 拼内容** ⇒ **整本账本被覆盖成这一条**，
 *     而返回值仍是 `ok: true` / `bytesBefore: 0`（实测 200KB 账本被顶掉）；
 *   · **`backup()` 不备份**（它把"读不出来"读成"首次创建"）⇒ 覆盖前没有副本，
 *     正好破掉 R-17「副本必须先于重写」。
 *
 *   ⇒ 现在把三态**显式**带出来，由调用方逐档处理：
 *   · `missing` —— `ENOENT`（**唯一**可以当"首次创建"的错误码）；
 *   · `ok`      —— 读到内容；
 *   · `error`   —— 其它一切（含 `EACCES` / `EIO` / `EISDIR` / 软链环 …）⇒ **拒写**。
 *
 * ⚠ **为什么⛔ 不把 `ENOTDIR` 也当 missing**：`a/b.md` 里 `a` 是个普通文件时，
 *   `readFile` 报 `ENOTDIR` —— 那不是"还没有这个文件"，是**路径本身坏了**；
 *   写下去只会再失败一次，或者（更糟）在别处建出目录树。⇒ 归到 `error` 一侧，拒写并说明。
 */
type TargetRead =
  | { kind: 'ok'; bytes: Buffer }
  | { kind: 'missing' }
  | { kind: 'error'; code: string; message: string }

/**
 * 读一个已存在的目标文件；**只把 `ENOENT` 当"不存在"**（判据见 {@link TargetRead}）。
 *
 * ⚠ 读成 **Buffer** 而不是字符串：备份必须**逐字节**保真
 *   （{@link backup} 的副本是回滚源）。若先按 `utf8` 解码再编码回去，
 *   非法 UTF-8 字节会被替换成 `U+FFFD` ⇒ 备份**不再等于原文**，
 *   而回滚会把替换字符写进账本 —— 一个"有备份"掩盖着的静默损坏。
 */
async function readTargetBytes(absTarget: string): Promise<TargetRead> {
  try {
    return { kind: 'ok', bytes: await readFile(absTarget) }
  } catch (e) {
    const err = e as { code?: string; message?: string } | null
    const code = typeof err?.code === 'string' && err.code !== '' ? err.code : 'unknown'
    if (code === 'ENOENT') return { kind: 'missing' }
    return { kind: 'error', code, message: typeof err?.message === 'string' ? err.message : String(e) }
  }
}

/** {@link readTargetBytes} 的**文本**版（调用方要的就是内容本身，如幂等比对 / 拼接）。 */
async function readTarget(absTarget: string): Promise<{ kind: 'ok'; content: string } | { kind: 'missing' } | { kind: 'error'; code: string; message: string }> {
  const r = await readTargetBytes(absTarget)
  if (r.kind !== 'ok') return r
  return { kind: 'ok', content: r.bytes.toString('utf8') }
}

/** 把一次 {@link TargetRead} 的 `error` 档渲染成**可读的拒写原因**（⛔ 不说"不存在"）。 */
function describeReadFailure(file: string, r: { code: string; message: string }): string {
  return `拒绝：\`${file}\` **读不出来**（${r.code}）—— ${r.message}`
    + '\n      ⚠ 这**不是**"文件还不存在"：目标可能就在那儿，只是这次读不到'
    + '（权限 / 磁盘 / 路径上挡了东西 / 它是目录 …）。'
    + '\n      ⇒ 停手去查那一个原因；⛔ 不按"首次创建"处理 —— 那会把整本文件覆盖成这一次的内容，且返回看起来是成功的。'
}

/**
 * **写前备份读源失败**（`backup()` 抛它 ⇒ {@link writeHobFile} 落 `read-failed`）。
 *
 * ⚠ 单独一个错误类型而不是 `Error` 带一句字符串：调用方要能**机器可判**地认出
 *   "这是读不出来、不是写不进去"（`write-failed` 与 `read-failed` 的修法完全不同）。
 */
export class BackupReadError extends Error {
  /** 读盘失败的错误码（`EACCES` / `EIO` / `EISDIR`…；拿不到时是 `'unknown'`）。 */
  readonly code: string
  /**
   * ⚠ 这是**新增导出**（既有的导出一个未动）：它只承载错误码，⛔ 不改变任何既有语义。
   *   ⚠ code 取**原始错误码**，⛔ 不在这里判"该不该拒" —— 那是 {@link writeHobFile} 的事。
   */
  constructor(code: string, message: string) {
    super(`写前备份时读不出原文（${code}）：${message}`)
    this.name = 'BackupReadError'
    this.code = code
  }
}

/**
 * **原子落盘**（同目录 tmp → 写入 → fsync → chmod → rename → fsync 目录）。
 *
 * ⚠ 这是本文件**唯一**的原子写实现点：主写入路径（§13）与**回滚**路径
 *   （§14 的 `rollback`）都走它 —— 两处各写一份必然漂（本仓分层纪律）。
 * ⚠ **rename 之前**把原文件（若存在）的 mode chmod 到临时件上 ⇒ 覆盖后权限不变
 *   （实测改前 `600 → 644`）。原文件不存在 ⇒ 沿用系统默认（= 改前行为）。
 * ⚠ `Buffer` 与字符串都收：回滚要**逐字节**写回备份（⛔ 不经过字符串往返）。
 *
 * @param absTarget - 目标绝对路径。
 * @param data - 要写的内容。
 * @param modeOverride - 指定 mode（回滚时用备份那份的原 mode）；缺省 = 取现目标的 mode。
 */
async function atomicWriteWithMode(
  absTarget: string,
  data: string | Buffer,
  modeOverride?: number,
): Promise<void> {
  const tmp = `${absTarget}.tmp-${process.pid}-${Date.now()}`
  let originalMode = modeOverride
  if (originalMode === undefined) {
    try {
      originalMode = (await stat(absTarget)).mode & 0o777
    } catch {
      /** ⚠ 文件不存在 / 读不到权限 ⇒ 不 chmod（沿用系统默认，与改前一致）。 */
      originalMode = undefined
    }
  }
  try {
    const fh = await open(tmp, 'w')
    try {
      await fh.writeFile(data)
      /** ⚠ 数据先落地，再 rename（顺序不可换：先改名再 fsync 等于没防住断电）。 */
      await fh.sync()
    } finally {
      await fh.close()
    }
    if (originalMode !== undefined) {
      /** ⚠ chmod **在 rename 之前**：改名之后那个 inode 就是目标文件了。 */
      await chmod(tmp, originalMode)
    }
    await rename(tmp, absTarget)
    /** ⚠ 目录 fsync：让"改名"这件事也落到盘上（该平台不支持时尽力而为）。 */
    await fsyncDirBestEffort(dirname(absTarget))
  } catch (e) {
    try { await rm(tmp, { force: true }) } catch { /* 清理失败不掩盖主错误 */ }
    throw e
  }
}

/**
 * 尽力 fsync 一个目录（让"条目改名 / 新建"这件事本身落盘）。
 *
 * ⚠ **为什么"尽力而为"而⛔ 不当写失败**：`fsync` 目录句柄在部分平台 / 文件系统上
 *   根本不支持（Windows 上 `fsync` 目录会 `EPERM` / `EISDIR`；某些网络文件系统也是）。
 *   把它升级成失败会把**本来成功的写入**判成失败（= 换了一个更坏的缺陷）。
 * ⚠ 但**数据文件本身的 fsync 是硬的**（失败 ⇒ 拒绝写入，见 `writeHobFileInner` §13）：
 *   那一处丢了就是真的可能半截文件。
 */
async function fsyncDirBestEffort(dir: string): Promise<void> {
  let fh
  try {
    fh = await open(dir, 'r')
    await fh.sync()
  } catch {
    /* 该平台/文件系统不支持目录 fsync ⇒ 数据文件的 fsync 已经做过，不在此处升级为失败 */
  } finally {
    if (fh !== undefined) {
      try { await fh.close() } catch { /* 关不掉不影响结果 */ }
    }
  }
}

// ── 进程内串行队列（按文件路径 keyed）─────────────────────────────────────────

/**
 * ══════════════════════════════════════════════════════════════════════
 * ⚠⚠ **同进程内的写串行化**（2026-10-24 · 本单必修 4）
 * ══════════════════════════════════════════════════════════════════════
 *
 * ── 治的缺陷（实测）────────────────────────────────────────────────────
 *   两个并发的 `append` 各自先读盘、再拼内容、再写回：
 *     A 读到旧内容 → B 读到同一份旧内容 → B 写 → A 写（A 的快照里没有 B 的改动）
 *   ⇒ **B 的那一段凭空消失**，而**两次调用都返回 `ok: true`**（实测丢过 200KB）。
 *   ⚠ 本函数整个"读 → 判 → 拼 → 写 → 回读"都在队列里 ⇒ 同进程内不存在"用过期快照写"。
 *
 * ── ⚠ ⚠ **诚实说明本队列管不到的地方（⛔ 不许含糊）**──────────────────────
 *   · **跨进程仍然不防**：另一个 Node 进程（另一个 DSH 实例 / 手工脚本 / `git checkout`）
 *     与本进程**同时**写同一个文件，**照样会互相覆盖**。本队列是**进程内**的
 *     `Promise` 链，没有任何文件锁 —— 故意如此：加锁文件会引入死锁 / 残留锁 / 崩溃后无人清理
 *     这些**新的失败面**，而本仓的账本写入是"单写者"设计（`doc-read.ts` 的 *Single Writer
 *     Principle*）。⇒ 跨进程互斥**不在本批范围**，也**不要**把本队列当成它。
 *   · **跨机器更不防**（同上，且账本目录若在 NFS 上连 rename 语义都要另说）。
 *   ⚠ 上面两句必须留在代码里：否则下一个人会以为"已经防并发了"，把真并发问题当成已修。
 *
 * ── 实现 ───────────────────────────────────────────────────────────────
 *   每个**规范化后的目标绝对路径**一条 `Promise` 链：后到的排在前一个（成功或失败）之后。
 *   ⚠ 用 `then(ok, ok)` 续链：**前一个失败不打断队列**（否则一次失败会把后续写入永久卡死）。
 *   ⚠ 链尾用完即删（`finally` 里比对同一个 promise 才删）⇒ 不随写入次数增长（无内存泄漏）。
 */
const writeQueues = new Map<string, Promise<unknown>>()

async function withFileQueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeQueues.get(key) ?? Promise.resolve()
  /** ⚠ 两条回调都要把链续下去：前一个 reject 不该让后一个跟着 reject。 */
  const run = prev.then(() => fn(), () => fn())
  /**
   * ⚠ 链尾登记的是"这次跑完（无论成败）"的 promise，且**吞掉**它的 rejection ——
   *   真正的错误由 `run` 自己抛给本次调用方，队列只需要知道"轮到我了没有"。
   */
  const tail = run.then(() => undefined, () => undefined)
  writeQueues.set(key, tail)
  try {
    return await run
  } finally {
    /** ⚠ 只有**自己还是链尾**时才删（否则会把后来者登记的链尾一起删掉 ⇒ 又并发）。 */
    if (writeQueues.get(key) === tail) writeQueues.delete(key)
  }
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
  /**
   * ⭐ **新账本 `ledger/`**（2026-10-30 P4）。
   * ⚠ 判定顺序：先撞 **`gen/` 与其它非白名单子目录的显式拒绝**，再认白名单 ——
   *   这样"想写生成物"会得到**点名 gen 的那句**，而不是笼统的"不在白名单内"。
   */
  if (file === 'ledger' || file.startsWith('ledger/')) {
    // ⛔ 生成物：显式拒绝（有独立理由，⛔ 不混进笼统话术）
    if (file.startsWith('ledger/gen/') || file === 'ledger/gen') {
      return refuse(
        file,
        'not-whitelisted',
        `拒绝：\`ledger/gen/\` 是**生成物**（\`npm run gen:ledger\` 产出），手改即红（\`CONSTITUTION\` §2 / I5）。`
          + `\n      ⇒ 要改内容 ⇒ 改 \`ledger/units/index.toml\`，再跑 \`npm run gen:ledger\`。`,
      )
    }
    // 单文件白名单（索引）
    if ((LEDGER_WRITABLE_FILES as readonly string[]).includes(file)) return null
    // 目录白名单
    const ln = LEDGER_PATH_RE.exec(file)
    if (ln !== null) {
      // ⚠ 路径穿越守卫（`..` / 绝对路径已在正则字符集外，这里再挡一次显式）
      if (file.includes('..') || file.includes('//')) {
        return refuse(file, 'not-whitelisted', `拒绝：路径里不许出现 \`..\` 或空段（你给的是 ${file}）。`)
      }
      return null
    }
    return refuse(
      file,
      'not-whitelisted',
      `拒绝：\`${file}\` 不在新账本的可写面内。`
        + `\n      ⇒ 可写目录：${LEDGER_WRITABLE_DIRS.join(' / ')}（及其下任意 .md/.toml/.json）；`
        + `\n      ⇒ 可写单文件：${LEDGER_WRITABLE_FILES.join(' / ')}；`
        + `\n      ⇒ ⛔ \`ledger/gen/**\` 一律不可写（生成物）；`
        + `\n      ⇒ ⛔ \`ledger/CONSTITUTION.md\` / \`PROJECT.md\` 也不可写（红线与地图走人工编辑 + commit）。`,
    )
  }
  // 账本 + 项目方案 + 当前需求（PROJECT.md 自 2026-10-10 / UD-88 起与账本同级；
  // REQUIREMENTS.md 自 2026-10-22 起是**唯一现行需求根**）
  if ((LEDGER_FILES as readonly string[]).includes(file)) return null
  // ⚠ **退役的历史正本**：仍在盘上、仍可读，但**不再是写面**（2026-10-22）
  if ((RETIRED_LEDGER_FILES as readonly string[]).includes(file)) {
    return refuse(
      file,
      'retired-historical',
      `拒绝：\`${file}\` 是**退役的历史正本**（仍在账本区根上、逐字节保留、随时可读），`
        + `\n      ⛔ 但它**不再是现行需求写面** —— 现行需求只有 \`REQUIREMENTS.md\` 一个根。`
        + `\n      ⇒ 要改当前功能需求 ⇒ 写 \`REQUIREMENTS.md\`（根地图）+ \`volumes/requirements/REQ-<编号>.md\`（条目正文）；`
        + `\n      ⇒ 要查历史用户决策 ⇒ **读**它（读面不受影响），⛔ 不要往它里面追加。`
        + `\n      ⚠ 两个现行需求根并存 = 两套真相，那正是本次重构要治的病。`,
    )
  }
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

/**
 * 带编号的两个文件各自的编号规则（`CONTEXT.md` / `REQUIREMENTS.md` 无编号，不入此表）。
 *
 * ⚠ **2026-10-22 起 `USER-DECISIONS.md` 已从本表移除**：它在 {@link checkWhitelist}
 *   就被 `retired-historical` 拒掉，**根本走不到编号逻辑** ⇒ 留着它是**永远跑不到的死规则**，
 *   而"写着一段永不执行的校验"会让人误以为它还是活的写面（false comfort）。
 *   ⚠ 这**不是删断言**：它守的那件事（追加时编号必须连续）已由 `REQUIREMENTS.md` 的
 *   独立编号体系承担（`volumes/requirements/REQ-nn` 由卷索引与机检 L 组盯）。
 */
const ID_SPECS: Record<string, IdSpec> = {
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

/**
 * 各账本的**条目格式**校验：与 `.hob/templates/` 的列契约一致。
 *
 * 口径：只校验**结构形状**（行/块 + 列数），不校验语义内容 —— 语义靠模型，形状靠工具。
 */
function checkFormat(file: string, content: string): WriteHobResult | null {
  const body = normalize(content)
  if (body === '') return refuse(file, 'bad-format', '拒绝：content 为空。')

  /**
   * ── `REQUIREMENTS.md`：**根地图**，不是条目正文 ────────────────────────────
   *
   * ⚠ 这一条替换的是原先那条 `USER-DECISIONS.md` 的「6 列表格 / `### UD-` 块」校验 ——
   *   那条在 2026-10-22 之后**已是死规则**（旧根在 {@link checkWhitelist} 就被拒掉，
   *   根本走不到这里）。留着它 = 一段永不执行、还会误导人以为旧根仍可写的校验。
   *
   * ⚠ **本组守的那件事**（与旧那条**不同**，故意不沿用旧形状）：
   *   需求条目的**正文住在卷里**（`volumes/requirements/REQ-<编号>.md`），根上只放地图。
   *   ⇒ 判据 = 根文件里**必须至少有一行表格指向卷内条目**（即"它是地图，不是正文"）。
   *   否则有人会直接把需求正文写进根，回到"根文件无限增长"的老形态。
   *
   * ⚠ **为什么不做"每条都必须被点到"的正向核**：那件事已由 `check:gitignore` 的
   *   **断言 L（索引两向完整）**在卷索引面盯着 —— 这里再写一遍就是**同一条判据两份实现**
   *   （本项目明令要防的形态）。本处只判**形状**，与既有分工一致。
   */
  if (file === 'REQUIREMENTS.md') {
    const mapRows = body
      .split('\n')
      .filter((l) => l.trim().startsWith('|'))
      .filter((l) => /`volumes\/requirements\/[A-Za-z0-9._-]+\.md`/.test(l))
    if (mapRows.length === 0) {
      return refuse(
        file,
        'bad-format',
        `拒绝：\`REQUIREMENTS.md\` 是**现行需求根地图**，里面必须至少有一行表格指向卷内条目`
          + `（形如 \`volumes/requirements/REQ-01.md\`）。`
          + `\n      ⇒ 条目正文请写进 \`volumes/requirements/REQ-<编号>.md\`（一事一文件），根上只留地图；`
          + `\n      ⛔ 不要把需求正文直接写进根 —— 那会退回"根文件只进不出、无限增长"的老形态。`,
      )
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

/**
 * 一条备份的**排序键**（2026-10-24 · 本单必修 6）。
 *
 * ── 它治的缺陷 ────────────────────────────────────────────────────────
 *   备份名形如 `PROJECT.md.<YYYYMMDD-HHMMSS>.bak`，同秒冲突时还会长出
 *   `….<stamp>.1.bak` / `.2.bak`（见 {@link backup} 的 `wx` + 递增后缀）。
 *   ⚠ 改前 `listBackups` 直接 `names.sort()` —— **字典序**：
 *     `'…-040000.1.bak'` 与 `'…-040000.bak'` 比到后缀时 `'1' < 'b'`
 *     ⇒ **递增后缀排到无后缀那份前面**，于是"保留 N 份、删最旧"删掉的
 *     **恰恰是最新那一份**；更糟的是它可能删掉**本次刚生成、已经返回给调用方**
 *     的那个 `backupName` ⇒ 返回值里点名的备份**根本不在盘上**（回滚路径断掉）。
 *
 * ── 判据 ──────────────────────────────────────────────────────────────
 *   ① **先按 mtime**（文件的真实写入时刻，跨"同秒但不同批次"也分得开）；
 *   ② mtime 相同时按 **stamp 字符串**（同一秒名族）；
 *   ③ 再按**递增后缀序号**（`.1` 一定晚于无后缀那份 —— 它是"撞名后换的下一个名字"）。
 *   ⚠ 三条都升序 = 时间升序 ⇒ 删最旧就是删数组**头部**。
 */
interface BackupEntry {
  name: string
  /** 文件真实修改时刻（毫秒）；取不到时退化为 0（排序时按名继续区分）。 */
  mtimeMs: number
  /** 名字里的 stamp（`YYYYMMDD-HHMMSS`）；不符合命名形态 ⇒ 空串。 */
  stamp: string
  /** 递增后缀序号（无后缀 = 0）。 */
  seq: number
}

/** 解析一个备份名（相对 `base` 前缀）：返回 stamp 与递增序号；形态不符 ⇒ undefined。 */
function parseBackupName(name: string, base: string): { stamp: string; seq: number } | undefined {
  if (!name.startsWith(base + '.') || !name.endsWith('.bak')) return undefined
  const mid = name.slice(base.length + 1, name.length - '.bak'.length)
  const m = /^(\d{8}-\d{6})(?:\.(\d+))?$/.exec(mid)
  if (m === null) return undefined
  const seq = m[2] === undefined ? 0 : Number(m[2])
  return { stamp: m[1]!, seq: Number.isFinite(seq) ? seq : 0 }
}

/**
 * 列出一个文件的历史备份，**按真实时间升序**（判据见 {@link BackupEntry}）。
 *
 * ⚠ 这是**唯一**的备份排序实现点：`backup()` 的去重（"最近一份"）与保留策略
 *   （"删最旧"）都从它取顺序 —— 两处各排一遍必然漂（本仓分层纪律）。
 */
async function listBackupEntries(backupDir: string, base: string): Promise<BackupEntry[]> {
  let names: string[]
  try {
    names = await readdir(backupDir)
  } catch {
    return []
  }
  const out: BackupEntry[] = []
  for (const name of names) {
    const parsed = parseBackupName(name, base)
    if (parsed === undefined) continue
    let mtimeMs = 0
    try {
      mtimeMs = (await stat(join(backupDir, name))).mtimeMs
    } catch {
      /**
       * ⚠ 取不到 mtime（刚被别的进程删掉 / 权限）⇒ **不丢这一条**：
       *   `mtimeMs: 0` 会让它排到最前（= 视为最旧），而它本来就可能已经不在了；
       *   保留在清单里能让去重那一步照旧按内容判，⛔ 不会把"读不到"说成"没有备份"。
       */
      mtimeMs = 0
    }
    out.push({ name, mtimeMs, stamp: parsed.stamp, seq: parsed.seq })
  }
  return out.sort((a, b) => {
    if (a.mtimeMs !== b.mtimeMs) return a.mtimeMs - b.mtimeMs
    if (a.stamp !== b.stamp) return a.stamp < b.stamp ? -1 : 1
    return a.seq - b.seq
  })
}

/**
 * ⚠ **本文件不再有"只回名字"的 `listBackups`**：本单之后所有调用点都要排序键
 *   （mtime + stamp + 递增序号）—— 只回名字的版本会诱使下一个人回到 `names.sort()`
 *   （= 必修 6 的病根）。⇒ 唯一入口是 {@link listBackupEntries}。
 *   ⚠ 行为差异：这是一处**删除**（函数未导出、`src/` 内无外部调用者）；
 *     既有备份**命名规则一个字未改** ⇒ 盘上那 217 份历史备份照旧按族识别得出。
 */
/**
 * 写前备份：全量复制 + 与最近一份**去重** + 保留 `keepBackups` 份。
 *
 * 为什么全量而非 diff：账本是小文件，**可直接恢复**比省空间重要得多；
 * diff 要重放才能回退，回退路径越长越不可靠。
 *
 * @returns 备份文件名（相对备份目录）；未备份时 undefined。
 */
/**
 * **备份的卷限定目录**（2026-10-26 · 备份按卷分目录）。
 *
 * ⚠⚠ **为什么需要它**（上一单差点拿错备份去恢复）：
 *   改前所有备份平铺在 `backups/` 下，名字 = `basename + 时戳`。
 *   ⚠ 而 `volumes/user-decisions/INDEX.md` 与 `volumes/decisions/INDEX.md`
 *   的 `basename` **都是 `INDEX.md`** ⇒ 两卷的备份**同名混放**，
 *   ⇒ 只能靠**读内容**才能分辨哪份属于哪个卷。⛔ 那不是判据能依赖的东西。
 *
 * ⚠ **改法**：备份落到 `backups/<卷名>/<原名>.<时戳>.bak`。
 *   · 卷名 = 目标文件相对**账本根**的路径里，`volumes/<卷名>/…` 的那一段；
 *   · ⚠ **账本根上的文件**（`CONTEXT.md` / `PROJECT.md` / …）不属于任何卷
 *     ⇒ 落在 `backups/(root)/`（⚠ 用带括号的名字，⛔ 不用空串 ⇒ 目录名不会是 `backups//`）。
 *   · ⚠ **卷名从路径派生**（⛔ 不手写一张卷名表）：新增卷时**零改动**。
 *
 * ⚠ **`base` / `parseBackupName` / 去重 / 保留策略全部不变** ——
 *   本函数只决定**目录**，备份文件名照旧 ⇒ 族判定与排序行为**不受影响**。
 */
function backupVolumeDir(hobRoot: string, absTarget: string): string {
  const rel = relative(hobRoot, absTarget)
  const parts = rel.split(sep)
  // `volumes/<卷名>/<…>.md` ⇒ 取 `<卷名>`
  if (parts.length >= 3 && parts[0] === 'volumes') return parts[1]!
  // 账本根上的文件 ⇒ 归到 (root)
  return '(root)'
}

async function backup(
  absTarget: string,
  backupDir: string,
  keepBackups: number,
): Promise<string | undefined> {
  /**
   * ⚠⚠ **"读不出来"⛔ 不许当成"首次创建"**（2026-10-24 · 本单必修 2）。
   *
   * 改前这里是 `try { readFile } catch { return undefined }` —— 一个 `catch` 把
   *   `ENOENT`（真的还没有这个文件）与 `EACCES` / `EIO`（**读不出来**）说成同一句话。
   * ⇒ 后者的后果：**不备份**，然后覆盖写 ⇒ **改前那份原状没有任何副本**
   *   （R-17「副本必须先于重写」当场被破），而调用方看不出发生了什么。
   * ⇒ 现在只有 `ENOENT` 走"首次创建、无需备份"；其余**抛出去**，由
   *   {@link writeHobFile} 落成 `read-failed` 并说明。
   */
  const read = await readTargetBytes(absTarget)
  if (read.kind === 'error') {
    throw new BackupReadError(read.code, read.message)
  }
  if (read.kind === 'missing') return undefined // 真的还没有这个文件 ⇒ 无需备份
  /** ⚠ 逐字节保真（见 {@link readTargetBytes}）——⛔ 不经过字符串往返。 */
  const original = read.bytes

  await ensureDir(backupDir)
  const base = absTarget.split(sep).pop()!
  const existing = await listBackupEntries(backupDir, base)

  // 去重：与**最近一份**（按 mtime + 序号，见 `BackupEntry`）内容相同则不再新增
  //   （防"反复写同内容"刷屏）。⚠ 改前这里取的是 `sort()` 的最后一项 = 字典序最大，
  //   而同秒多份时它**不是**最新那份（`…040000.bak` vs `…040000.1.bak`）⇒ 去重会判错。
  if (existing.length > 0) {
    const latest = existing[existing.length - 1]!
    try {
      const latestBytes = await readFile(join(backupDir, latest.name))
      if (latestBytes.equals(original)) return latest.name
    } catch { /* 读不到就当没备份过 */ }
  }

  /**
   * ══════════════════════════════════════════════════════════════════════
   * ⚠⚠ **丙-4 最小修（2026-10-21 · 第 335 轮）：同秒冲突不许覆盖**
   * ══════════════════════════════════════════════════════════════════════
   *
   * ── 改前的病灶（`PROJECT-SURVEY-3` §6.3 丙-4，撞 **R-17「副本必须先于重写」**）────
   *   名字 = `basename + 秒级时间戳`，而 `writeFile` **默认覆盖**、**没有存在性检查**
   *   ⇒ 同一秒内对**同一路径**连改两次：第二份备份**把第一份覆盖掉**
   *   ⇒ ⚠ **第一次改前那份原状没有任何副本留存** —— 而 R-17 的承诺正是"改之前先留副本"。
   *
   * ── 现在：`wx` + 递增后缀（⚠ 两个都要，理由如下）──────────────────────
   *   · **`wx`**（`writeFile(..., { flag: 'wx' })`）：文件已存在 ⇒ **抛 `EEXIST`**
   *     ⇒ ⚠ **不覆盖**这个保证由**内核原子给出**，⛔ 不是"我先 stat 一下再写"
   *     （那个检查与写之间有窗口，并发/同秒连写照样撞）。
   *   · **递增后缀**（`.1` / `.2` …）：撞了之后要有**下一个可用名字**，
   *     否则"不覆盖"就等于"这次备份失败" ⇒ 写入会被拒 ⇒ 那是**更坏**的结果。
   *   ⚠ 两者缺一不可：只有 `wx` ⇒ 同秒第二次直接失败；只有后缀 ⇒ 存在性检查有窗口。
   *
   * ── ⚠ 为什么**不改族键**（`basename` → 账本区相对路径）─────────────────
   *   那是迁移工程（涉及 217 份历史备份的命名与族判定 `parseBackupName`），
   *   TASK 明令**另开轮**。⇒ 本批**只**保证"同秒不覆盖"。
   *   ⚠ ⚠ 因此**遗留一格已知缺陷**：**同一秒、两个不同路径、`basename` 相同**时，
   *     第二份仍会把第一份顶掉（`wx` 会撞、递增后缀会让它变成 `.1` ——
   *     ⚠ 但族判定（`parseBackupName`）按 `basename` 前缀，`.1` 仍算同一族 ⇒ **不再丢**）。
   *     见 {@link listBackupEntries} 的注释与报告里的"已知未修"。
   */
  const stampStr = stamp()
  let name = `${base}.${stampStr}.bak`
  /**
   * ⚠ 最多试 100 个后缀：再多的同秒冲突在本场景里不现实（而**无限循环**是不可接受的）。
   *   撞满 ⇒ 退化成"旧口径"（丢掉那一份）并在**返回值/日志**里说明 —— ⛔ 不许静默。
   */
  let wrote = false
  for (let attempt = 0; attempt < 100; attempt++) {
    name = attempt === 0 ? `${base}.${stampStr}.bak` : `${base}.${stampStr}.${attempt}.bak`
    try {
      /**
       * ⚠ `flag: 'wx'` = **独占创建**：已存在则 `EEXIST` ⇒ ⛔ **绝不覆盖**
       *   （这正是 R-17 要的那条保证，且它由内核原子给出，没有 TOCTOU 窗口）。
       */
      await writeFile(join(backupDir, name), original, { flag: 'wx' })
      /**
       * ⚠⚠ **D12 回读（2026-10-27 · 包 X）**：备份是"改了盘上东西"的一处，而它**尤其**
       *   不能只凭写函数返回就认定成功 —— 备份是 `R-17`（改之前先留副本）的**唯一凭据**：
       *   备份没落地而主写入照做 ⇒ 改前那份原状**永久丢失**，而返回值一切正常。
       *   ⇒ 写后**独立回读**，与**预期值**（`original` 的原始字节）**逐字节比**；
       *     不符 ⇒ 抛错（由既有 catch 落 `write-failed`，⛔ 不新增分支、⛔ 不复用 `EEXIST` 那条）。
       *   ⚠ **比对用 Buffer**（⛔ 不是 utf8 字符串）：备份对象可能是任何编码的原文，
       *     走字符串会引入一次解码替换，把"字节真的不一样"变成"看起来一样"。
       */
      const backBytes = await readFile(join(backupDir, name))
      if (!Buffer.from(backBytes).equals(Buffer.from(original))) {
        throw new Error(`备份回读与原文不符（${name}）`)
      }
      wrote = true
      break
    } catch (e) {
      const code = (e as { code?: string } | null)?.code
      if (code === 'EEXIST') continue   // ⚠ 同秒撞名 ⇒ 换下一个后缀
      /** ⚠ 其它错误（磁盘满 / 权限）⇒ 与改前一致：抛出去由调用方落 `write-failed`。 */
      throw e
    }
  }
  if (!wrote) {
    /**
     * ⚠ 100 个后缀全撞满 ⇒ **不假装成功**：抛错让调用方落"写前备份失败 ⇒ 不备份就不写"
     *   （既有语义 `:864` 那一句）。⛔ 不许退回"覆盖一份"—— 那会把 R-17 重新破掉。
     */
    throw new Error(`备份名冲突：同一秒内 \`${base}\` 已有 100 份同名备份（${stampStr}）⇒ 拒绝覆盖`)
  }

  /**
   * ══════════════════════════════════════════════════════════════════════
   * ⚠⚠ **保留 N 份：按真实时间删最旧的，且⛔ 永不删本次刚生成的那份**
   * （2026-10-24 · 本单必修 6）
   * ══════════════════════════════════════════════════════════════════════
   *
   * ── 改前的两条病灶 ───────────────────────────────────────────────────
   *   ① `const after = await listBackups(...)` 拿的是**字典序**；同秒多份时
   *      `…040000.bak` 排在 `…040000.1.bak` **之后**（`'b' > '1'`）⇒ "删最旧"删掉的
   *      恰恰是**最新那份**（刚生成的那份）。历史因此被削成"只剩最老的几份"。
   *   ② **没有排除本次的 `name`** ⇒ 上限很小时（`keepBackups = 1` 是最坏的一档）
   *      本次备份**自己**会被删掉，而 `name` **已经作为 `backupName` 返回给调用方** ——
   *      返回值指向一个**不在盘上**的备份 ⇒ 回滚路径（`readFile(join(backupDir, backupName))`）
   *      当场失效。
   *
   * ── 现在的判据（三句话）──────────────────────────────────────────────
   *   · 顺序来自 {@link listBackupEntries}（mtime → stamp → 递增序号，**时间升序**）；
   *   · **本次的 `name` 从候选里剔除**（它永远保留）—— 这是"返回值必须能在盘上被读到"的保证；
   *   · 剩下的按**从旧到新**删，删到总数 `<= max(1, keepBackups)`。
   *   ⚠ 删不掉不阻塞写入（既有语义不变）。
   */
  const after = await listBackupEntries(backupDir, base)
  const keep = Math.max(1, keepBackups)
  const prunable = after.filter((e) => e.name !== name)
  /** ⚠ 本次那份**也算**一份 ⇒ 它还占一个名额（否则总份数会达到 `keep + 1`）。 */
  const excess = prunable.length - Math.max(0, keep - 1)
  for (let i = 0; i < excess; i++) {
    try { await unlink(join(backupDir, prunable[i]!.name)) } catch { /* 删不掉不阻塞写入 */ }
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
  if (root === undefined || root.trim() === '') {
    return refuse(file, 'no-workspace-root', '拒绝：无法确定工作区根目录。')
  }
  /**
   * ══════════════════════════════════════════════════════════════════════
   * ⚠⚠ **同进程内按路径串行**（2026-10-24 · 本单必修 4）
   * ══════════════════════════════════════════════════════════════════════
   *
   * 队列 **必须**在"读存量之前"就开始 ⇒ 整个「读 → 判 → 拼 → 备份 → 写 → 回读」
   * 都在同一个临界区里。改前两次并发 `append` 各自读同一份旧内容、后写的把先写的
   * 顶掉，而**两次都回 `ok: true`**（实测丢过 200KB）。
   *
   * ⚠ **key 用规范化后的目标绝对路径**（不是入参原文）：`./CONTEXT.md` / `CONTEXT.md` /
   *   `a/../CONTEXT.md` 是**同一个文件**，必须排同一条队（用原文当 key 会让它们并行）。
   * ⚠ **判据在 {@link withFileQueue} 的注释里** —— ⛔ 这里不重写一份，只说"为什么在这里"。
   * ⚠ ⚠ **跨进程仍不防**（见那个注释）：本队列只是同进程内的一条 `Promise` 链。
   */
  const queueKey = resolveInside(resolveInside(root, opts.hobDir).abs, file).abs
  return withFileQueue(queueKey, () => writeHobFileInner(root, input, opts))
}

/**
 * {@link writeHobFile} 的实现体（**唯一**的落盘路径）。
 *
 * ⚠ 拆出来**只为**套那一层进程内队列（见上）；函数体本身的行为**一处未改**，
 *   除了本单点名的那几条（读失败判据 / 原子写 fsync / mode 保留）。
 */
async function writeHobFileInner(
  root: string,
  input: WriteHobInput,
  opts: WriteHobOptions,
): Promise<WriteHobResult> {
  const file = normalizeRelPath(input.file)
  const mode = input.mode ?? 'append'
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
  /**
   * ⚠ **扩展名守卫**（2026-10-30 P4 放宽了一个**窄口**）：
   *   · 老账本侧：**仍然只许 `.md`**（⛔ 一字未放宽）；
   *   · 新账本 `ledger/` 侧：额外允许 `.toml` / `.json` —— 因为那份索引**本身就是 TOML**
   *     （`units/index.toml`），`spec/` 与 `changes/` 也可能有结构化文本。
   *   ⚠ 只对 `ledger/` 前缀生效（下面前缀判断写死）；其它任何路径仍是"只许 .md"。
   *   ⛔ 这不是"整体放开扩展名" —— 那会让 `archive/**` 等面都能写二进制旁路。
   */
  const isLedgerNext = file === 'ledger' || file.startsWith('ledger/')
  const lower = file.toLowerCase()
  const extOk = lower.endsWith('.md') || (isLedgerNext && (lower.endsWith('.toml') || lower.endsWith('.json')))
  if (!extOk) {
    return refuse(
      file,
      'not-markdown',
      isLedgerNext
        ? '拒绝：`ledger/` 下只允许写 .md / .toml / .json 文件。'
        : '拒绝：只允许写 .md 文件。',
    )
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

  /**
   * ── 6.6：`REQUIREMENTS.md` 的**形状**必须两种模式都判 ─────────────────────
   *
   * ⚠ 为什么不能只放在 append 分支：**根地图是整份重写的**（`overwrite` 才是它的常态），
   *   而 `checkFormat` 原先只被 `append` 分支调用 ⇒ 把唯一的形状判据挂在**最少用的那条路**上，
   *   等于"日常写法不受检"（本仓反复记过的形态：判据落在无人走的路径上）。
   *   ⇒ 这里对**新根**单独补一次，`append` / `overwrite` 都走到。
   * ⚠ 其余文件保持原样（`DECISIONS.md` 的编号形状仍只在 append 判）—— 本批不扩判定面。
   */
  if (file === 'REQUIREMENTS.md') {
    const rootFmt = checkFormat(file, content)
    if (rootFmt !== null) return rootFmt
  }

  const contentBytes = Buffer.byteLength(content, 'utf8')
  if (contentBytes > opts.maxFileBytes) {
    return refuse(file, 'too-large', `拒绝：content ${contentBytes} 字节，超过上限 ${opts.maxFileBytes}。`)
  }

  /**
   * ── 7：读存量（append 需要它做编号/幂等；overwrite 需要它做缩水守卫）────
   *
   * ⚠⚠ **本单必修 1/3：读不出来必须拒写**（2026-10-24）。
   *
   * 改前：`try { existing = await readFile(...) } catch { exists = false }` ——
   *   `catch` 把**一切**错误都读成"文件不存在"。
   *   · `append` 于是用**空 `existing`** 拼内容 ⇒ **整本账本被覆盖成这一条**，
   *     而返回值仍是 `ok: true` / `bytesBefore: 0`（实测 200KB 账本被顶掉）；
   *   · `overwrite` 于是跳过缩水守卫与幂等比对（它们都以 `exists` 为前提）；
   *   · `backup()` 同理不备份（见 {@link backup}）。
   *
   * ⇒ 现在三态分开（{@link TargetRead}）：只有 `missing` 才当"首次创建"；
   *   `error` **当场拒写**并给可读原因（`read-failed`），
   *   ⛔ 绝不带着一个空的 `existing` 往下走 —— 那正是"账本被覆盖还报成功"的来源。
   */
  const read = await readTarget(absTarget)
  if (read.kind === 'error') {
    return refuse(file, 'read-failed', describeReadFailure(file, read))
  }
  const exists = read.kind === 'ok'
  const existing = read.kind === 'ok' ? read.content : ''

  // ── 8：编号校验 + 幂等（append 才需要）────────────────────────────────
  let id: string | undefined
  if (mode === 'append') {
    /**
     * ⚠ **这里再判一次"读不出来"是多余的**（上面已经拒掉了）—— 本段**刻意不写**
     *   `exists ? … : …` 之外的兜底：`exists === false` 此刻**只有一个含义**
     *   （文件真的不存在，ENOENT），不再兼指"读失败"。⛔ 不许在这里补一个
     *   "读不到就按空文件算"的分支 —— 那会把必修 1 修好的东西原路放回去。
     */
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
  /**
   * ⚠ **本单必修 3 的复查点**（2026-10-24）：下面 `append` 那一支仍然用
   *   `exists ? trimmed + … : body + …`。
   *   ⚠ 改前它的隐患是 `exists === false` **同时**意味着"文件不存在"与"读不出来"
   *     ⇒ 读到 `EACCES` 时会用**空 `existing`** 拼出"只有这一条"的内容并覆盖整本账本。
   *   ⇒ 必修 1 之后（见 §7 的 {@link readTarget} 三态）：走到这里时
   *     `exists === false` **只剩一个含义** —— `ENOENT`，即"这个文件真的还不存在"。
   *     `EACCES` / `EIO` / `EISDIR` 等已在 §7 **当场拒写**（`read-failed`），根本到不了这里。
   *   ⚠ 所以本段**不需要改写法**（改成 `existing` 非空判也会得到同一结果）——需要的是
   *     **判据被收紧**，而那是 §7 做的。⛔ 这里⛔ 不加"再做一次兜底"的分支：
   *     那会让两个判据并存，日后必然漂。
   */
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
  /**
   * ⚠ **按卷分目录**（2026-10-26）：`backups/<卷名>/` —— 见 {@link backupVolumeDir}。
   *   ⚠ 账本根上的文件落 `backups/(root)/`；卷内文件落 `backups/<卷名>/`。
   *   ⚠ `backup()` 内部只认 `backupDir`，改名不影响它的任何逻辑。
   */
  const backupSubdir = backupVolumeDir(hobRoot, absTarget)
  const backupDir = join(hobRoot, BACKUP_DIR, backupSubdir)
  let backupName: string | undefined
  try {
    backupName = await backup(absTarget, backupDir, opts.keepBackups)
  } catch (e) {
    /**
     * ⚠⚠ **两种成因⛔ 不许说成一句话**（2026-10-24 · 本单必修 2 的出口）：
     *   · `BackupReadError` —— **读不出原文** ⇒ `read-failed`（去查权限 / 磁盘 / 路径）；
     *   · 其它（`ENOSPC` / `EACCES` 写备份 / 100 个后缀撞满）—— **备份写不成**
     *     ⇒ `write-failed`（去查备份目录）。
     *   ⚠ 两者的处置完全不同（"不备份就不写"这条语义**没变**，变的是**说得清是哪一种**）。
     */
    if (e instanceof BackupReadError) {
      return refuse(file, 'read-failed', describeReadFailure(file, e))
    }
    return refuse(file, 'write-failed', `拒绝：写前备份失败（${e instanceof Error ? e.message : String(e)}）—— 不备份就不写。`)
  }

  // ── 13：原子写（同目录 tmp → rename，**补齐 fsync 链**）───────────────────
  /**
   * ══════════════════════════════════════════════════════════════════════
   * ⚠⚠ **原子写不只是 tmp → rename**（2026-10-24 · 本单必修 5）
   * ══════════════════════════════════════════════════════════════════════
   *
   * ── 改前缺的两件（都很实际）───────────────────────────────────────────
   *   ① **没有 fsync**：`writeFile(tmp)` 只把数据交给内核页缓存，`rename` 只改目录项。
   *      ⚠ 断电 / 崩溃时可能出现"目录项已经指向新名字、而数据还在页缓存里没落盘"
   *      ⇒ 重开得到一个**长度对、内容空白 / 半截**的文件 —— 原子写本该防的正是这个。
   *      ⇒ 现在：**先 fsync 临时文件**（数据先落地），**rename 之后再 fsync 目录**
   *        （让"改名"这件事本身也落地）。
   *   ② **rename 换掉了原文件的 mode**：`writeFile(tmp)` 用的是 `0o666 & ~umask`（通常 644），
   *      rename 之后**目标文件的权限跟着新 inode 走** ⇒ 实测 `600 → 644`
   *      （账本从"只有我能读"变成"同机所有人都能读"）。
   *      ⇒ 现在：**rename 之前**把原文件的 mode **chmod 到临时件上**（原文件不存在则沿用默认）。
   *
   * ── 既有行为哪一条仍然成立（凭什么确认）──────────────────────────────────
   *   · **同目录 tmp → rename 的原子性**：一条都没改（还是同一个 `rename`，同目录）；
   *   · **临时件命名**：`${absTarget}.tmp-${process.pid}-${Date.now()}` **一字未动**
   *     ⇒ 既有的"残留临时件可被识别 / 不会与目标同名"的前提不变；
   *   · **失败清理**：`rm(tmp, { force: true })` 仍在 `catch` 里，且失败不掩盖主错误；
   *   · **返回的 reason 仍集中在 `write-failed`**（除上面新分出的 `read-failed`）。
   *
   * ⚠ **fsync 失败怎么办**：与"写失败"同档 —— 拒绝、清理临时件、回 `write-failed`。
   *   ⛔ 不许"fsync 没成功就当没事"（那等于把持久化保证悄悄降级）。
   */
  await ensureDir(dirname(absTarget))
  try {
    /** ⚠ 具体判据（fsync 链 / mode 保留 / 为什么用 Buffer）见 {@link atomicWriteWithMode}。 */
    await atomicWriteWithMode(absTarget, next)
  } catch (e) {
    return refuse(file, 'write-failed', `写入失败：${e instanceof Error ? e.message : String(e)}`)
  }

  // ── 14：回读校验；不一致则从备份回滚 ────────────────────────────────────
  /**
   * ══════════════════════════════════════════════════════════════════════
   * ⚠⚠ **丙-3（2026-10-21 · 第 337 轮）：回读校验太弱 + 回滚非原子**
   * ══════════════════════════════════════════════════════════════════════
   *
   * ── 改前的两条病（`PROJECT-SURVEY-3` §6.3 丙-3）────────────────────────
   *   ① **判据太弱**：只判"落盘内容**包含**正文第一行非空行"。
   *      ⚠ 首行往往很短（`# 工作上下文` / `# 决策记录`）⇒ **任何仍含该行的旧内容都能通过**
   *      ⇒ 真的写坏了（后半截被截断 / 被别的进程覆盖）**照样报 ok**。
   *   ② **回滚非原子**：`writeFile(absTarget, 备份内容)` **直接覆盖目标**。
   *      ⚠ 回滚恰恰发生在"**已经出过一次错**"的时刻 —— 此时再崩一次就留**半截文件**。
   *
   * ── 现在的判据：与 **`next` 逐字节比**（⚠ 不是与 `body` 比）────────────────
   *   ⚠ **为什么比 `next` 而不是比 `body`**：真正落盘的是 `next`（见上面
   *     `writeFile(tmp, next, 'utf8')` ⇒ `rename`）。而 `body` 与它之间**确实有差异**：
   *       · `overwrite` 时 `next` 可能补过尾部换行；
   *       · `append` 时 `next` 是"原内容 + 分隔 + 正文"。
   *     ⚠ 拿 `body` 直接比 ⇒ **正常写入必然误报**（那会让每次写都回滚）。
   *   ⚠ **EOL 对齐**：两侧都是 `readFile(..., 'utf8')` / 写进去的同一个 JS 字符串，
   *     **没有做任何 EOL 归一** ⇒ 逐字节比**成立**（实测：正常 append / overwrite 均通过）。
   *   ⚠ 为稳妥仍保留一条"**长度先比**"的短路：长度不等就**不必**逐字节比，
   *     这样坏样本能给出更可读的差异（`实际 N 字节 / 期望 M 字节`）。
   */
  try {
    const back = await readFile(absTarget, 'utf8')
    if (back !== next) {
      /**
       * ⚠ 差异描述里**分别报长度与首个不一字节的位置** —— ⛔ 只说"不符"等于没说。
       *   ⚠ 位置只在长度相等时才有意义（长度不等时"第几个字节不同"是误导）。
       */
      const detail = back.length !== next.length
        ? `长度不符：落盘 ${Buffer.byteLength(back, 'utf8')} 字节 / 期望 ${Buffer.byteLength(next, 'utf8')} 字节`
        : (() => {
          let i = 0
          while (i < back.length && i < next.length && back[i] === next[i]) i++
          return `等长但内容不同（首处差异在第 ${i + 1} 个字符）`
        })()
      throw new Error(`回读内容与预期不符 —— ${detail}`)
    }
  } catch (e) {
    let rolled = false
    let how = ''
    if (backupName !== undefined) {
      try {
        /**
         * ⚠⚠ **回滚也走 `tmp → rename`**（丙-3 要求 1），且**与主写入同一个实现**
         *   （{@link atomicWriteWithMode}）：同目录临时件 ⇒ 写备份字节 ⇒ fsync ⇒
         *   chmod（沿用目标当前 mode）⇒ `rename` ⇒ fsync 目录。
         *   ⚠ `rename` 在同一文件系统内是**原子**的 ⇒ 目标要么是**旧的整体**、
         *     要么是**新的整体**，⛔ 绝不会是"半截回滚内容"。
         *   ⚠ 写入的是**备份的原始字节**（⛔ 不经过字符串往返）⇒ 回滚结果与备份逐字节相同。
         */
        const backBytes = await readFile(join(backupDir, backupName))
        await atomicWriteWithMode(absTarget, backBytes)
        /**
         * ⚠⚠ **D12 回读（2026-10-27 · 包 X）**：回滚也是"改了盘上东西"的一处。
         *   ⚠ 它尤其需要回读 —— 回滚发生在**已经出过一次错**之后：
         *     如果回滚写完却读回来不是备份字节，`rolled = true` 就是**第二句假话**
         *     （第一句是那次"写成功"），而消息会告诉用户"已从备份回滚"。
         *   ⇒ 现在：回滚写完**独立回读**，与**备份的原始字节逐字节比**；
         *     不符 ⇒ **不置 `rolled`** ⇒ 消息落到"回滚未成功，请人工检查"（如实）。
         *   ⚠ 比的是 `Buffer`（⛔ 不经过字符串往返）—— 与回滚写入用的是同一份字节。
         */
        const rolledBack = await readFile(absTarget)
        if (Buffer.from(rolledBack).equals(Buffer.from(backBytes))) {
          rolled = true
          how = '（原子回滚：tmp → rename + fsync，**已回读确认**）'
        }
      } catch { /* 回滚失败要在消息里说清 */ }
    }
    return refuse(file, 'readback-mismatch', `写入后回读校验失败（${e instanceof Error ? e.message : String(e)}）；${rolled ? `已从备份回滚${how}` : '回滚未成功，请人工检查'}。`)
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
    ...(backupName === undefined ? {} : { backup: `${BACKUP_DIR}/${backupSubdir}/${backupName}` }),
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
      + (backupName === undefined ? '' : `；备份 ${BACKUP_DIR}/${backupSubdir}/${backupName}`)
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
