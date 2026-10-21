/**
 * **正本**的形态机检（族 ②）—— A / B / J / C / D / D′ / E / I。
 *
 * ⚠ 2026-10-11（第 60 轮）从 `check-gitignore.mjs` 拆分而来。
 *   读的全是账本区的正本（⚠ **第 71 轮起为"派生"清单**，见 `derivePrimaryFiles()`），
 *   外加账本仓自己的忽略规则。
 *   ⚠ 导出 `findDuplicateSectionHeadings` 供入口的 `--dup-headings` 单测入口复用。
 *   ⚠ `D_REF_RE` / `D_TASK_RE` / `FENCE_OPEN_RE` 的**新家就在这里** ——
 *     断言 K 的检查侧基准点必须指向本文件（否则 K 会因"提取不到"而 FAIL）。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { workspaceName } from './workspace-name.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
// ── 判据函数：正本里的节标题不得重复（2026-10-11 第 53 轮 · 断言 J）──────────
/**
 * **找出同一份 Markdown 里重复出现的二级节标题（`^## `）。**
 *
 * ── 为什么需要它（缺口有实测出处）──────────────────────────────────
 *   第 52 轮 Hob 写 `USER-DECISIONS.md` 时，第一版把两条新决定**追加到文件末尾**
 *   （`## 十一、归档清单` **之后**），并在尾部留下一个**重复的** `## 五、回复格式`。
 *   ⇒ 那一版**结构已坏**，而**当时跑遍所有检查都不会红** ——
 *   它是被第 52 轮的「备份 diff 判读」**偶然撞见**的，**不是任何判据抓到的**。
 *   ⚠ 这正是 **E-122**（机制没有喂养端）的又一形态：**"标题唯一"从来没被当成可判的事**。
 *   ⇒ 本函数把它变成一条可判的事，并把**那次真实坏快照**当活体夹具（见断言 J 的实证块）。
 *
 * ── 判据（只咬"该咬"的一侧）───────────────────────────────────────
 *   · 只看**行首** `^## `（二级）⇒ **行内提及**（如 `` `## 五、回复格式` ``）**不在行首，天然不咬**；
 *   · **围栏代码块内**的标题**不参与**（那是**示例**，见 `fencedMaskBelow`）——
 *     与断言 E / I 的围栏豁免**同族口径**（**E-114**：判据必须容忍元讨论）。
 *
 * ── 已知边界（照实登记，**不要试图消灭**）──────────────────────────
 *   · ⛔ **`### `（三级）重复不在本轮范围** —— 只认 `^## `；
 *   · ⛔ **只扫正本**（= `B_FILES`，**第 71 轮起派生自账本根**）；**骨架文件（`.hob/**`）暂不扫**；
 *   · ⚠ **与 `hob-render.ts` 的围栏实现同源**：下面 `fencedMaskBelow` 用的
 *     `FENCE_OPEN_RE` / 开闭判据**照抄**该文件的 `fencedMask`（**不重写一套正则**，
 *     否则会重演"文档里能安全写例子、机检却报残留"的自相矛盾）。
 *
 * @param content - 整份 Markdown 文本。
 * @returns 每个重复标题一条：`{ title, lines }`（`lines` 为 1 基行号，升序）。
 */
export function findDuplicateSectionHeadings(content) {
  const lines = String(content ?? '').replace(/\r\n/g, '\n').split('\n')
  const fenced = fencedMaskBelow(lines)
  const byTitle = new Map()
  for (let i = 0; i < lines.length; i++) {
    if (fenced[i]) continue // 围栏内的标题是示例，不参与判据
    const m = /^##\s+(\S.*)$/.exec(lines[i])
    if (m === null) continue // 行内提及 / 三级标题 / 普通正文：天然不匹配
    const title = m[1].trim()
    if (!byTitle.has(title)) byTitle.set(title, [])
    byTitle.get(title).push(i + 1)
  }
  const dup = []
  for (const [title, ls] of byTitle) if (ls.length >= 2) dup.push({ title, lines: ls })
  return dup
}

/** 围栏开标记（⚠ 与 `src/server/hob-render.ts` 的 `fencedMask` **逐字同源**）。 */
const FENCE_OPEN_RE = /^\s{0,3}(`{3,}|~{3,})(.*)$/

/**
 * 计算**围栏代码块**覆盖的行（`true` = 该行不参与标题判据）。
 * ⚠ 与 `src/server/hob-render.ts` 的 `fencedMask` 同口径（**未闭合 ⇒ 延伸到文末**，
 *   与 CommonMark 一致）—— 这里**照抄**而不 import：`scripts/` 与 `src/` 是两棵
 *   互不依赖的树（`src/` 不能 import `scripts/`，反之亦然，见 `hob-write.ts` 的注释）。
 */
function fencedMaskBelow(lines) {
  const mask = new Array(lines.length).fill(false)
  let fence = null
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE_OPEN_RE.exec(lines[i])
    if (fence === null) {
      if (m !== null && !(m[1][0] === '`' && m[2].includes('`'))) {
        fence = { char: m[1][0], len: m[1].length }
        mask[i] = true
      }
      continue
    }
    mask[i] = true
    if (m !== null && m[1][0] === fence.char && m[1].length >= fence.len && m[2].trim() === '') {
      fence = null
    }
  }
  return mask
}

/**
 * ── 文档形态机检（2026-10-10 新增 · UD-88 / CHG-025）────────────────────────
 *
 * 背景：用户裁定账本区的正本（方案 + 各本账本）一律**「只写当前状态」** ——
 * 正文只描述**现在是什么样**，**不带**「订正（日期·批次）：原文此处……」这类
 * **补丁式历史说明**；改动时**旧版整份归档**到 `archive/<日期>-<名>/`。
 * ⇒ 两条断言防它**回潮**：
 *   **A 模板与正本节名一致** —— 防"正本改了形态、模板没跟"（新工作区起手就写成旧形态）。
 *   **B 正本里不许出现补丁式历史说明** —— 形态本身被写回去。
 *
 * ⚠ **A 的闸门**：账本区在工作区**之外**，别的机器上可能不存在
 *   ⇒ 读不到时**明确跳过并说明**（计数 + 打印原因），**绝不静默 PASS**。
 *   这正是本脚本一贯盯防的"基准读不到就默认通过"。
 *
 * ⚠ **B 的正则为什么是这个形状**（实测调过，见回报的负向对拍读数）：
 *   ① **锚定行首 + 排除"元讨论"**：三份正本里**合法地**出现了这些词，但都出现在
 *      **讨论该纪律本身**的句子里（如 `CONTEXT.md:8` "本文件**不带历史说明** ——
 *      不写「原写…已失实」…"）。裸词 grep 会把**纪律条文**判成**违规**。
 *      ⇒ 只认**行首**的补丁注记形态（`订正（2026-…` / `原文此处` / `已失实` / `原写`），
 *        且**不**把 `**加粗**` 里的词、句子中段的引述算进来。
 *   ② **不弱化**：这不是"把正则调弱到永远 PASS" —— 它仍对**真实违规**有牙
 *      （实测：纳入前 `PROJECT.md` 曾被抓出 2 处真违规，读数见回报；
 *        第 20 轮负向对拍又当场抓着一次 —— 见该轮回报的插补丁句读数）。
 *
 * ⚠ **`PROJECT.md` 已于 2026-10-10 纳入**（第 20 轮 · UD-88 / CHG-025）：
 *   它原为**旧形态**（正文里成片「订正（日期）：原文此处……」式补丁说明），
 *   当时纳入会**当场 FAIL**；而"不许为了让检查通过而放宽断言"是本项目红线
 *   ⇒ 上一轮采取**显式排除 + 标注待办**，待办登记在 `CONTEXT.md` §2.2「未修的缺口」。
 *   2026-10-10 用户重载实例（解除旧插件 `write_hob` 可写名单的封锁）后，
 *   Hob 已把它**整份改写为 v2.0「只写当前状态」**：122455 → 67876 字节，
 *   旧整份存 `archive/2026-10-10-project-plan-move/PROJECT.md`（逐字节）。
 *   ⇒ 排除的**理由已消失**：`B_FILES`（第 71 轮起派生自账本根）**必然含 `PROJECT.md`**，
 *     账本根的正本**全部纳入**形态机检，本文件里**不再有任何"待纳入"的例外**。
 */
/**
 * ── 账本根的解析（⚠ 2026-10-21 · 第 324 轮 · **甲-1 试点**：把"读不到"变成可判的失败）────
 *
 * **改前是什么**（本项目最广的一处"没查 = 查过且过"，`PROJECT-SURVEY-3` §6.1 甲-1）：
 *   这里**只返回 `undefined`**，而 `undefined` 之后全族走 `ok('【跳过】…')`
 *   ⇒ ⚠ `ok()` **无条件打 ✓ 且不进 `fail` 计数** ⇒ 账本区读不到时 `check:all` 记成 **`✓ 通过`**。
 *   ⚠ 实测（第 324 轮，改前）：把工作区名指向不存在的目录 ⇒ `check:gitignore` 打出
 *     `✓ 文档形态机检【跳过】…不代表通过` 与 `✓ I 正本无残留标记【跳过】…不代表通过`
 *     两条**带 ✓ 的"没查"**（原文见 REPORT）。
 *
 * **现在**：解析结果多带一个 **`diag`** —— ⚠ 它回答"为什么读不到"（三档分开，⛔ 不合并成一句）：
 *   · `preset-unreadable` ⇒ 预设行都读不到（连候选都没有）；
 *   · `no-ledger-home`   ⇒ 预设读到了，但里面没有 `ledgerHome:` 声明；
 *   · `absent`           ⇒ 候选算出来了，但**那个目录不存在 / 不是目录 / 无权限**（`reason` 带 errno）。
 *   ⚠ 调用方（入口 `check-gitignore.mjs`）据此**在跑任何断言之前 `exit 2`**（甲-1 试点那一档），
 *   ⛔ **不再**让全族带着 `ok()` 的 ✓ 走完。
 *
 * ⚠ **本文件不自己 `exit`**（`docs-shape` 也被 import 做断言）—— 闸门只有入口一处。
 */
const ledgerDiag = (() => {
  // ⚠ 与其它脚本同口径：账本父目录**不硬编码本机绝对路径**（UD-73③），
  //   从 profile 的预设行声明 `ledgerHome` 读出；读不到再退回缺省候选。
  const candidates = []
  let presetErr
  try {
    const preset = readFileSync(join(root, 'preset', 'dsh-hob', 'preset-dsh-hob.patch.yml'), 'utf8')
    const m = /ledgerHome:\s*(\S+)/.exec(preset)
    if (m !== null) candidates.push(m[1])
    else return { kind: 'no-ledger-home', path: undefined, wsName: undefined,
      reason: '预设里没有 `ledgerHome:` 声明' }
  } catch (e) {
    presetErr = String(e?.message ?? e)
    return { kind: 'preset-unreadable', path: undefined, wsName: undefined,
      reason: `读不到预设 ${join(root, 'preset', 'dsh-hob', 'preset-dsh-hob.patch.yml')}（${presetErr}）` }
  }
  // 候选：<ledgerHome>/<工作区名>（⚠ 工作区名**从配置读**，唯一来源 = `scripts/workspace-name.mjs`；
  //   未配置 ⇒ 落回 `basename(root)`，与改动前逐字一致 —— ⛔ 本脚本不再自己猜目录名）
  const wsName = workspaceName(() => basename(root))
  const tried = []
  for (const home of candidates) {
    const dir = join(home, wsName)
    tried.push(dir)
    if (existsSync(dir)) return { kind: 'ok', path: dir, wsName, reason: '' }
  }
  /**
   * ⚠ **"不存在"与"存在但读不了"要分开报**（本项目头号禁忌：两种原因说成同一句话）：
   *   后者（无权限 / 不是目录）是**环境坏了**，前者是**没建账本** —— 修法完全不同。
   */
  const target = tried[0]
  let why = '不存在'
  try {
    const st = statSync(target)
    why = st.isDirectory() ? '存在且是目录，但 `existsSync` 却为假（异常）' : '存在但**不是目录**'
  } catch (e) {
    why = `不存在或读不到（${String(e?.code ?? '')} ${String(e?.message ?? e)}）`
  }
  return { kind: 'absent', path: target, wsName, reason: why, tried }
})()

/** 账本根（⚠ `undefined` = 读不到；**为什么**读不到见 {@link ledgerDiag}）。 */
const LEDGER_ROOT = ledgerDiag.kind === 'ok' ? ledgerDiag.path : undefined

/**
 * 导出给入口做**前置闸门**（甲-1 试点）：`{ kind, path, wsName, reason }`。
 * ⚠ `kind !== 'ok'` ⇒ 入口 `exit 2`，⛔ 不许降级成一条 `ok()` 的"跳过"。
 */
export const ledgerRootDiag = ledgerDiag

/**
 * A 用的：正本文件名（**有配套空模板**的那三本 —— 断言 A 比的是「正本节名 ↔ 模板节名」）。
 *
 * ── 为什么 `PROJECT.md` **不在 A 里**（2026-10-10 第 21 轮 · Hob 裁定，**非疏漏**）──
 *   **方案的模板不存在** —— `.hob/templates/` 里没有 `PROJECT.md`
 *   （该目录 7 份：`DECISIONS` / `USER-DECISIONS` / `CONTEXT` / `ROLES` / `GATES` / `TASK` / `REPORT`）。
 *   原因不是"还没建"：**方案是项目专有文档，不是可复用的骨架格式** ——
 *   三本账本是「同构空模板 + 每项目填条目」，方案是**逐项目唯一**的整篇文档，
 *   两者形态本就不同。⇒ **"无模板可比"是正当状态**，**不是遗漏、不是待办**。
 *   （⚠ 因此**不要**在这里写"待补模板"之类的话：把它登记成待办，等于把
 *    一个正当的分类结果误报成缺口。）
 *   ⚠ 反证：若把 `PROJECT.md` 塞进 A 的循环，A 会立刻报
 *   「A 模板读不到：…/.hob/templates/PROJECT.md —— 节名比对失去基准」⇒ **FAIL、exit 1**
 *   （第 20 轮实测）。而"不许为了让检查通过而放宽断言"是本项目红线
 *   ⇒ 正确做法是 **A 只覆盖有模板的三本**（判定逻辑一字未改），**B 覆盖全部正本**（第 71 轮起为派生值）。
 *
 * ⚠ **A / B 两个常量的基准不同 ⇒ 不可合并**（这正是第 20 轮暴露的缺陷）：
 *   · `A_FILES` 的基准 = **模板**（`templates/<同名>.md` 必须存在，没有就没法比）；
 *   · `B_FILES` 的基准 = **正本本身**（只需账本区有该文件，与模板无关）。
 *   两者**判据不同**，故**必须各用各的常量** ——
 *   合并成一个（第 20 轮之前就是合并的）会在"扩一条的范围"时**隐式连坐**另一条：
 *   给 B 加 `PROJECT.md`，A 当场被带挂，而改动方在运行前看不到（`B_FILES` 有第二个消费者）。
 *   ⇒ 见 `.hob/EXPERIENCE.md` **E-110**（同一教训已登记为经验条目）。
 */
const A_FILES = ['DECISIONS.md', 'USER-DECISIONS.md', 'CONTEXT.md']

/**
 * ── 正本清单的**派生点**（第 71 轮 · 结构改造 ④「值派生而非手抄」）──────────────
 *
 * **为什么派生**：原先是 `const B_FILES = ['PROJECT.md', …]` —— 一张**手抄的清单**。
 *   手抄的后果第 70 轮实测过：**账本根加第 5 份 `*.md` ⇒ D / I / J / B 一个都不扫它**
 *   （C 组也只数那 4 个名字）—— **一整类文件逃出机检**，而全部检查照旧全绿。
 *   ⇒ 这里把"账本根有哪些正本"改成**从账本根实测**：清单**无处可手抄**（结构解）。
 *
 * **口径**（照它逐字执行，别在这里加条件）：
 *   · `readdirSync(LEDGER_ROOT)` —— **一层、非递归**；
 *   · **只认 `.md`**，且**只认普通文件**（目录名恰好以 `.md` 结尾也不收）；
 *   · **排序稳定**（`sort()`，同输入 ⇒ 同顺序 ⇒ 输出可逐字比对）。
 *   `archive/` / `backups/` / `runtime/` 都是**子目录** ⇒ 结构上不可能进这张清单。
 *
 * **空结果 = FAIL，不是 PASS**：清单为空时每个消费方都会"扫 0 份然后报 ✓"
 *   —— 那正是 **E-126** 说的"判据改哑"与"判据改对"输出相同。
 *   ⇒ 本函数**不自行判死**，只把 `reason` 交出去，由消费方（`runDocShape`）
 *     打成**可读断言行**（**E-112**：判据不只是 exit ≠ 0）。
 */
function derivePrimaryFiles() {
  if (LEDGER_ROOT === undefined) {
    return { files: [], reason: '账本根**解析不到**（`LEDGER_ROOT === undefined`）' }
  }
  let entries = []
  try {
    entries = readdirSync(LEDGER_ROOT, { withFileTypes: true })
  } catch (e) {
    return { files: [], reason: `账本根**不可读**：\`${String(e?.message ?? e)}\`（${LEDGER_ROOT}）` }
  }
  const files = entries
    .filter((d) => d.isFile() && d.name.endsWith('.md'))
    .map((d) => d.name)
    .sort()
  if (files.length === 0) {
    return { files: [], reason: `账本根**一层下没有任何 \`.md\` 文件**（${LEDGER_ROOT}）` }
  }
  return { files, reason: '' }
}

const PRIMARY_FILES = derivePrimaryFiles()

/**
 * ── 卷文件清单的**派生点**（2026-10-11 第 78 轮 · UD-95 / CHG-032）─────────────
 *
 * **背景**：账本与方案改为「**地图＋分卷、一事一文件**」—— 根上那几份是**地图**，
 *   正文按卷落进 `<账本根>/volumes/<卷>/`，**一卷一目录、一事一文件**。
 *
 * **为什么也派生**：与 `derivePrimaryFiles()` **同一条理由** —— 手抄清单会让
 *   **新成员静默逃出机检**（第 70 轮实测形态，**E-133**）。⇒ 卷成员一律**从目录实测**。
 *
 * **口径**（照它逐字执行，别在这里加条件）：
 *   · `readdirSync(<账本根>/volumes)` 取**卷目录**（一层，只认目录、排序稳定）；
 *   · 每个卷目录下 `readdirSync` 取**一层** `*.md`（**非递归**、只认普通文件）；
 *   · 路径记成**相对账本根**的 POSIX 形（`volumes/<卷>/<文件>.md`）——
 *     与 `B_FILES`（根上文件名）拼在一起后，消费方只当"一串相对路径"用。
 *
 * **卷根不存在 = 迁移期正常态，交消费方打印"未执行"**（⛔ 不是放宽）：
 *   `exists: false` 时 `files` 为空且 `exists === false`，由 §断言 L 显式打印
 *   「未执行、不代表通过」；⚠ **这与"卷根存在但没有卷"不同** —— 后者是**空卷**，判 FAIL。
 */
function deriveVolumeFiles() {
  if (LEDGER_ROOT === undefined) {
    return { files: [], exists: false, reason: '账本根**解析不到**（`LEDGER_ROOT === undefined`）' }
  }
  const volumesRoot = join(LEDGER_ROOT, 'volumes')
  if (!existsSync(volumesRoot)) {
    return { files: [], exists: false, reason: `卷根尚未建立（${volumesRoot}）` }
  }
  let volDirs = []
  try {
    volDirs = readdirSync(volumesRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
  } catch (e) {
    return { files: [], exists: true, reason: `卷根**不可读**：\`${String(e?.message ?? e)}\`（${volumesRoot}）` }
  }
  const files = []
  const emptyVolumes = []
  for (const vol of volDirs) {
    let entries = []
    try {
      entries = readdirSync(join(volumesRoot, vol), { withFileTypes: true })
    } catch { continue }
    const mds = entries
      .filter((d) => d.isFile() && d.name.endsWith('.md'))
      .map((d) => d.name)
      .sort()
    if (mds.length === 0) emptyVolumes.push(vol)
    for (const f of mds) files.push(`volumes/${vol}/${f}`)
  }
  return { files, exists: true, volumes: volDirs, emptyVolumes, volumesRoot, reason: '' }
}

const VOLUME_FILES_RESULT = deriveVolumeFiles()

/**
 * B / J / D / D′ / I 用的：正本文件名 —— **派生值，⛔ 不再手抄**（第 71 轮）。
 * ⚠ 与 `A_FILES` **不可合并**：A 的基准是**模板**（`templates/<同名>.md` 必须存在，
 *   没有就没法比），B 的基准是**正本本身** —— 两者**判据不同**
 *   （**E-110**：一个常量只服务一条断言；扩范围前先搜该常量的全部消费点）。
 *
 * ⚠ **2026-10-11 第 78 轮扩范围（UD-95 / CHG-032）**：本条由"账本根一层"扩为
 *   **「账本根上的 + 卷里的」** —— 见下面的 `SCAN_FILES`。⚠ **A 不动**（它只管
 *   有模板的那三本，与卷无关）。
 */
const B_FILES = PRIMARY_FILES.files

/**
 * ── 扫描面 = 地图 + 卷（2026-10-11 第 78 轮 · UD-95 / CHG-032）─────────────────
 *
 * ⚠ **这是本轮唯一允许"扩范围"的地方**（作业书 §5 末条）：既有断言 B / J / D / D′ / I
 *   的**判据语义一字未改**，只是**成员清单多了卷里那几份**。
 *
 * 成员顺序：先根上的（`B_FILES`，已 `sort()`），再卷里的（`VOLUME_FILES_RESULT.files`，
 *   按卷名 + 文件名 `sort()`）—— **排序稳定**，同输入 ⇒ 同顺序 ⇒ 输出可逐字比对。
 *
 * ⚠ **消费点清单（扩范围前已 `grep`，逐条见回报）**：
 *   `B_FILES` 的消费者 = B 组（`runDocShape` 内 `for (const f of B_FILES)`）·
 *   J 组 · C 组（`C_MUST_NOT_IGNORE` 的拼装）· D 组 · D′ 组 · I 组（`runResidualMarkers`）。
 *   ⇒ 它们**全部**应当随之扩到卷；**没有**消费者需要"只看根、不看卷"。
 *   ⇒ 故这里**直接**把 `B_FILES` 的语义定为"扫描面"，并把原名保留（避免两套清单漂移）。
 */
const SCAN_FILES = [...B_FILES, ...VOLUME_FILES_RESULT.files]

/**
 * ── 骨架侧扫描面（2026-10-15 · 第 220 轮新增 · `UD-117` 第 ⑤ 组）────────────────
 *
 * **为什么需要（第 217 轮读实现实测的洞）**：读上限断言 **M** 的 `mTargets`
 *   原先只取 `B_FILES`（账本根）+ 卷内 + 卷索引 ⇒ ⚠ ⚠ **`.hob/**` 完全不在扫描面内** ⇒
 *   ⚠ **骨架侧的文件撞上同一个 `maxFileBytes` 时不会有任何红**。
 *   ⚠ 第 217 轮**实测**：`.hob/README.md` 余量只剩 2762 字节，⚠ **没有任何机检盯它**，
 *   是执行方**人工算**才发现的 ⇒ 该轮立了"到顶动作在设计期就写"的口径（`UD-115`）。
 *
 * ── 口径（⛔ 不许手抄数组：**派生**，与账本侧同一条理由）────────────────────────
 *   · 根 = `<工作区>/.hob`（工作区根由 `import.meta.url` 推导，⛔ 不硬编码绝对路径）；
 *   · **递归**取 `*.md`（⚠ 与账本侧的"一层 / 两层"不同 —— 骨架侧的目录是固定的几层：
 *     根 3 件 + `drafts/` + `experience/` + `roles/methods/` + `templates/`，
 *     ⚠ **递归才能不随目录增减而漏件**）；
 *   · 路径记成**相对工作区根**的 POSIX 形（`statSync(join(root, f))` 即用）；
 *   · **排序稳定**（`sort()`）⇒ 同输入同顺序 ⇒ 输出可逐字比对；
 *   · ⚠ **空结果不在这里判死**：把 `reason` 交出去，由断言 M 打成 FAIL
 *     （**E-112**：判据要可读；**E-126**：空结果⛔ 不许当 ✓）。
 *
 * ⚠ ⚠ **不进这个圈 ≠ 没后果**：⚠ `.hob/backups/` 里的 `.bak` **不是 `.md`**（⚠ 实测 0 份 `*.md`）
 *   ⇒ ⚠ **结构上不可能进这张清单**（它们本来也不走读取路径）。
 */
function collectSkeletonMdFiles() {
  const hobRoot = join(root, '.hob')
  if (!existsSync(hobRoot)) {
    return { files: [], reason: `骨架目录不存在（${hobRoot}）` }
  }
  const out = []
  const walk = (dir) => {
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch { return }        // ⚠ 不可读的子目录**不静默跳过** —— 由"总数对不上"侧写出来见 M 行
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        walk(p)
      } else if (e.isFile() && e.name.endsWith('.md')) {
        out.push(relative(root, p).split('\\').join('/'))
      }
    }
  }
  walk(hobRoot)
  out.sort()
  if (out.length === 0) {
    return { files: [], reason: `\`${hobRoot}\` 下递归扫描 **0 份** \`*.md\`` }
  }
  return { files: out, reason: '' }
}

/** 形态机检主体：A / B / J / C / D / D′ / E（累计顺序与拆前一致）。 */
export function runDocShape({ bad, ok, noObject, skip }) {
  /**
   * ⚠⚠ **`noObject`（2026-10-21 · 第 331 轮 · 乙-5）**：本组"**没有对象可查**"的出口。
   *   ⚠ 它与 `bad`（`exit 1`）、`ok`（`exit 0`）是**第三档**（`exit 2`）：
   *     一条判据都没跑，⛔ 既不算过、也不算不过。
   *   ⚠ 缺省不传 ⇒ 退化成"只打印不判定"（⚠ 仅向后兼容旧调用方，⛔ 入口必须传）。
   */
  const noObjectSink = typeof noObject === 'function' ? noObject : (m) => ok(`⚠ ${m}（⚠ 调用方未提供 noObject ⇒ 本档不参与退出码）`)
  /**
   * ── ⚠⚠ **`skip` 出口**（2026-10-21 · 第 349 轮 · 甲-1 甲方案）──────────────
   *   与 `noObject` 的区别见 `check-gitignore.mjs` 的 `noteSkip` 注释：
   *   `noObject` = **整族**没对象（退 2）；`skip` = **本组某一处**没对象（只计数，不退码）。
   *   ⚠ 缺省不传 ⇒ 退化成只打印（与 `noObjectSink` 同款的向后兼容），
   *     ⛔ 但**绝不**退化成 `ok()` —— 那会把"没查"重新记成"查过且过"。
   */
  /** ⚠ 缺省收集器（调用方没给 `skip` 时用）；声明**必须在** `skipSink` 之前（否则 TDZ 抛错）。 */
  const skipTrail = []
  const skipSink = typeof skip === 'function' ? skip : (m) => skipTrail.push(m)
  if (LEDGER_ROOT === undefined) {
    // ⚠ **明确跳过并说明**（不静默 PASS）：这一支不计入 fail，但**打印为什么跳过**。
    skipSink(`文档形态机检【跳过】—— 账本区读不到（工作区之外，本机可能未建立）`
      + `⇒ 断言 A（模板↔正本节名）、断言 B（正本无补丁式说明）、`
      + `断言 C（账本仓忽略规则不许写宽）**三条均未执行**，`
      + `不代表通过。跳过位置：scripts/check-gitignore.mjs 的 LEDGER_ROOT 解析。`)
  } else {
    /**
     * ── 前置：**正本清单必须非空**（第 71 轮 · 派生点的兜底）───────────────────
     * ⚠ 这一支**判 FAIL，不判跳过**：清单派生不出来时，下面 B / J / D / D′ / I
     *   五个消费方都会"扫 0 份 ⇒ 报 ✓" —— 那会把**派生断链**伪装成**全绿**
     *   （**E-126**：判据改哑与判据改对必须输出不同）。
     * ⚠ 判据**不只是 exit ≠ 0**：必须打印**可读断言行**（**E-112**）。
     */
    if (B_FILES.length === 0) {
      bad('正本清单**派生为空** ⇒ B / J / C / D / D′ / I **全部未执行**（不按通过处理）'
        + `\n      派生点：scripts/check-doc-shape.mjs 的 derivePrimaryFiles()`
        + `\n      原因：${PRIMARY_FILES.reason}`
        + '\n      ⇒ 正本清单的口径 = **账本根一层下的 `*.md`（非递归、只认普通文件、排序稳定）**'
        + '\n      ⇒ 清单为空时若照常报 ✓，等于"这份清单永远为空也 PASS" —— ⛔ 那是判据假绿')
    }

    // ── 断言 A：模板与正本的节名一致 ──────────────────────────────────────
    // ⚠ 节 key 口径：`## ` 之后的标题，**剥掉** `**加粗**` 与**尾部全角括号注解**。
    //   理由：注解是**本项目专有**的（如"（三条都是实测逼出来的）"），
    //   模板不应照抄项目史；而**节主题词**必须一致 ⇒ 只比主题词。
    const secKey = (line) => {
      let s = line.replace(/^##\s+/, '').replace(/\*\*/g, '').trim()
      let prev
      do {
        prev = s
        s = s.replace(/\s*[（(][^（()）]*[）)]\s*$/, '').trim()
      } while (s !== prev)
      return s
    }
    const secKeys = (src) => src.split('\n').filter((l) => /^##\s+\S/.test(l)).map(secKey)

    for (const f of A_FILES) {
      const mp = join(LEDGER_ROOT, f)
      const tp = join(root, '.hob', 'templates', f)
      let msrc = ''
      let tsrc = ''
      try { msrc = readFileSync(mp, 'utf8') } catch { msrc = '' }
      try { tsrc = readFileSync(tp, 'utf8') } catch { tsrc = '' }
      if (msrc === '') {
        bad(`A 正本读不到：${mp} —— 节名比对失去基准（不按通过处理）`)
        continue
      }
      if (tsrc === '') {
        bad(`A 模板读不到：${tp} —— 节名比对失去基准（不按通过处理）`)
        continue
      }
      const mKeys = secKeys(msrc)
      const tSet = new Set(secKeys(tsrc))
      if (mKeys.length === 0) {
        bad(`A 正本 ${f} 里一个 \`## \` 节标题都没解析到 —— 解析口径可能已漂（不按通过处理）`)
        continue
      }
      const missing = mKeys.filter((k) => !tSet.has(k))
      if (missing.length > 0) {
        bad(`A 模板缺节：模板 .hob/templates/${f} 里找不到正本 ${f} 的节 —— ${missing.map((k) => `「${k}」`).join(' / ')}`
          + '（正本改了形态而模板没跟 ⇒ 新工作区起手就会写成旧形态）')
      } else {
        ok(`A ✓ ${f}：模板与正本节名一致（${mKeys.length} 节全对上）`)
      }
    }

    // ── 断言 N：模板必须镜像正本的「结构 + 会约束行为的正文」（补断言 A 的盲区）──
    // ⚠ **A 只管节名**：模板里少一行表行 / 少一条必跑命令，A **照样全绿** ⇒ 新工作区
    //   照模板起手就会**写成旧形态或漏跑命令**（第四判 F1/F2/F4/F6 实测证实）。
    // ⚠ **收录口径**（第 95 轮裁定）：模板镜像正本的【**结构 + 会约束行为的正文**】
    //   （表行集 / 必跑的收尾命令 / 归口说明），⛔ **不搬项目现状**（具体编号 / 字节数 / 本项目史）。
    //   ⇒ 判据：**照模板起手的新工作区，不该因为模板缺东西而写成旧形态或漏跑命令**。
    //
    // ⚠ **扫描面派生**（⛔ 不手抄清单）：参与比对的正本 = 有配套模板的那几份（`A_FILES` 的同一来源）。
    // ⚠ **有配套模板的正本才比**：没模板的正本不参与，⛔ 不许因此报红。
    //
    // 两组：
    //   N1 表行集：模板里**有对应表**的，模板表行集 **⊇** 正本对应表的「结构行」集。
    //   N2 无硬编码阈值：三份模板里⛔ 不许出现写死的阈值 / 字节数。
    // ⚠ 归一化（去空白 / 统一引号 / 去反引号加粗）之后仍不能归一的（如正本行含具体字节数）
    //   ⇒ **如实列为已知边界**，⛔ 不为过而放宽整条。
    const N_HARD = [
      [/\d[\d,]*\s*字节/, '写死的字节数'],
      [/\d+(?:\.\d+)?\s*%/, '写死的百分数阈值'],
      [/maxFileBytes\s*[:=]\s*\d+/, '写死的读上限'],
      [/\b65536\b/, '写死的读上限字面量'],
    ]
    const nNorm = (v) => v.replace(/[`*]/g, '').replace(/[「」“”"'’]/g, '"').replace(/\s+/g, '').trim()
    const nTokenish = (t) => /\.md$/.test(t) || /\/$/.test(t) || /^npm run [a-z][\w:-]*$/i.test(t)
    // 「结构行」= 首格是**纯 token 列表**（只由反引号 token + 分隔符组成），且每个 token 都是**产物形状**。
    //   ⚠ 这刻意**排除散文行**（如"经验库：索引 + 条目目录"）与**读数行**（含字节 / %）
    //     —— 前者是**项目史**、后者是**项目现状**，都属"⛔ 不搬"的一侧（收录口径）。
    //   ⚠ ⚠ **第 238 轮收窄**（本处原为 `if (/\d/.test(l)) continue` —— **整行**含数字即跳过）：
    //     ⚠ 比对**只吃首格**（本函数末行 `out.push(nNorm(first))`，`first` 即上面逐行取出的首格）
    //     ⇒ ⚠ 说明列里的数字（如"自第 224 轮起派生"）**根本进不了比对**，却被整行规则**连坐** ——
    //     ⚠ 那是**规则比它要守的东西更宽**，不是"读数行"。
    //     ⚠ **实测代价（第 238 轮 · 用本函数原文跑）**：正本 §4 的 `npm run check:host` 与
    //     `npm run check:rounds` **首格都是纯命令 token**（`npm run <名>` 形态），
    //     却因**说明列**含轮次号被**整行跳过** ⇒ ⚠ **模板缺 `check:rounds` 那一行，判据照旧绿**
    //     —— ⚠ **与第 235 轮那次假绿同族**：**"判据没报错" ≠ "被检查过"**。
    //   ⇒ **收窄为只判首格**：只有**首格本身**含数字的行才排除（即"读数写在首格"那一类）；
    //     ⚠ 说明列的数字不再连坐。⚠ 本处**替换而非删除**（原规则守的事由下面那条负向样本接着守）。
    //   ⚠ ⚠ **残余排除面（据实登记，⛔ 不当"已解决"）**：首格本身是"含数字的产物形状 token"时
    //     **仍被排除** ⇒ ⚠ 实测正本 §2 的 `volumes/plan/11-pending-drafts.md` 一行即属此列
    //     （⚠ 收窄后它仍不进比对）⇒ ⚠ 见 `REPORT-R203.md` §4「残余排除面」。
    const nStructRows = (lines) => {
      const out = []
      let fence = false
      for (const l of lines) {
        if (/^\s*```/.test(l)) { fence = !fence; continue }
        if (fence) continue
        if (!l.trim().startsWith('|')) continue
        const raw = l.trim().replace(/^\|/, '').replace(/\|$/, '')
        const first = (raw.split('|')[0] || '').trim()
        if (/^:?-{2,}:?$/.test(first)) continue
        if (!first.includes('`')) continue
        if (/\d/.test(first)) continue
        if (N_HARD.some(([re]) => re.test(l))) continue
        const toks = [...first.matchAll(/`([^`]+)`/g)].map((m) => m[1])
        if (!toks.length) continue
        const stripped = first.replace(/\*\*/g, '').replace(/`[^`]*`/g, '@').replace(/[\s·+、/,]/g, '')
        if (stripped !== '@'.repeat(toks.length)) continue
        if (!toks.every(nTokenish)) continue
        out.push(nNorm(first))
      }
      return out
    }
    const nSplitSections = (src) => {
      const lines = src.split('\n'); const out = []; let cur = null
      for (const l of lines) {
        if (/^##\s+\S/.test(l)) { cur = { key: secKey(l), lines: [] }; out.push(cur); continue }
        if (cur) cur.lines.push(l)
      }
      return out
    }
    // ⚠ 判据核心：吃的是**内容**，不是文件 —— 这样负向对拍可以在内存里造坏样本，
    //   ⛔ 不需要真去改仓库文件（改仓库再还原正是"判据可能把自己写坏"的老病）。
    const nCompare = (msrc, tsrc) => {
      const msecs = nSplitSections(msrc)
      const tsecs = nSplitSections(tsrc)
      const missing = []
      let comparedTables = 0
      for (const ms of msecs) {
        const ts = tsecs.find((x) => x.key === ms.key)
        if (!ts) continue                    // 节缺失由断言 A 管，本组不重复报
        const mRows = nStructRows(ms.lines)
        if (!mRows.length) continue
        comparedTables++
        const tSet = new Set(nStructRows(ts.lines))
        for (const r of mRows) if (!tSet.has(r)) missing.push([ms.key, r])
      }
      return { missing, comparedTables }
    }
    let nBad = 0
    let nTables = 0
    for (const f of A_FILES) {
      let msrc = ''
      let tsrc = ''
      try { msrc = readFileSync(join(LEDGER_ROOT, f), 'utf8') } catch { msrc = '' }
      try { tsrc = readFileSync(join(root, '.hob', 'templates', f), 'utf8') } catch { tsrc = '' }
      // ⚠ 「有配套模板的正本才比」：任一侧读不到 ⇒ 本组退出（节名已由 A 报"失去基准"）
      if (msrc === '' || tsrc === '') continue
      const { missing, comparedTables } = nCompare(msrc, tsrc)
      nTables += comparedTables
      if (missing.length > 0) {
        nBad++
        bad(`N 模板缺表行：模板 .hob/templates/${f} 里缺 ${missing.length} 行「正本有、模板没有」的结构行`
          + missing.slice(0, 8).map(([k, r]) => `\n        §「${k}」缺行：${r}`).join('')
          + (missing.length > 8 ? `\n        …另有 ${missing.length - 8} 行` : '')
          + '\n      ⇒ 模板只镜像了"节名"（断言 A 已管）而**没镜像表行集**'
          + '\n      ⇒ 后果：**照模板起手的新工作区会缺行**（写成旧形态 / 漏跑命令）'
          + '\n      ⇒ 口径：模板必须镜像正本的「结构 + 会约束行为的正文」，⛔ 不搬项目现状')
      }
      // N3：模板⛔ 不许出现「正本没有、且不是「附：」的」节
      //   （断言 A 只核 正本 ⊆ 模板，管不到"模板凭空多一节" ⇒ 本组补上）
      {
        const mKeys = new Set(nSplitSections(msrc).map((x) => x.key))
        const extras = nSplitSections(tsrc)
          .map((x) => x.key)
          .filter((k) => !mKeys.has(k) && !k.startsWith('附：'))
        if (extras.length > 0) {
          nBad++
          bad(`N 模板多出节：模板 .hob/templates/${f} 里有正本没有、且非「附：」的节`
            + extras.map((k) => `\n        「${k}」`).join('')
            + '\n      ⇒ 断言 A 只核「正本 ⊆ 模板」，管不到模板凭空多一节'
            + '\n      ⇒ 新工作区会把这一节照抄成**不存在的规矩**'
            + '\n      ⇒ 修法：要么删掉，要么改用「附：…」前缀（"附"节是模板允许自带的）')
        }
      }
      // N2：模板里⛔ 不许出现写死的阈值 / 字节数
      for (const [i, l] of tsrc.split('\n').entries()) {
        for (const [re, why] of N_HARD) {
          if (!re.test(l)) continue
          nBad++
          bad(`N 模板写了硬阈值（${why}）：.hob/templates/${f}:${i + 1}`
            + `\n        ${l.trim().slice(0, 120)}`
            + '\n      ⇒ 模板是**可分发**的：写死的阈值会**随新工作区一起复制**，'
            + '\n        而该阈值在别的项目里几乎必然不成立（本仓已因一个百分数阈值错过一次 = CHG-034）'
            + '\n      ⇒ 修法：改成"**从预设行读**"或**留占位**（如 `[上限]`），⛔ 不写字面量')
        }
      }
    }
    // ── B3 自带坏样本（**内存里造**，⛔ 不碰仓库文件 ⇒ 不存在"改了忘了还原"）──
    //   四组必须**真被咬住**：① 删正本有的一行 ② 改错成员（漏 volumes/）③ 注入写死阈值 ④ 加瞎编的节。
    //   ⚠ 与 I 组的自带样本同法：**判据改哑与判据改对必须输出不同**（E-126）。
    //
    // ── ⚠ ⚠ **第 220 轮改法（`UD-117` 第 ② 组）：靶点由"正本原文"改为"机检自造样本"** ──────
    // **背景（第 179 轮实测）**：⚠ 本条原先的样本 ①② **拿真正本 `CONTEXT.md` 当基准**
    //   （`nCompare(mCTX, N_S1)`）⇒ ⚠ ⚠ **一旦正本里那条靶行被搬走，坏样本就"无从生效"**，
    //   探针会报「**判据改哑了**」，⚠ **而它实际想说的是"我找不到靶点了"**（⚠ 两者修法完全不同）。
    //   实测：第 178 轮把正本 §4 与 §4.1 整节移出 ⇒ **`check:gitignore` 当场 `EXIT=1`**，
    //   报的正是两句看不懂根因的话（⚠ 见 `E-151` 并入段）。
    // ⇒ ⚠ ⚠ **改后**：样本 ①②③④ 一律取**机检自己拼出来的样本对**（`N_SAMPLE_PAIR`），
    //   ⚠ **正本只作"被扫描对象"（上面那个 `for (const f of A_FILES)` 循环），⛔ 不再作基准**。
    //   ⚠ 于是：**正本怎么搬，这里的牙口都不受影响**。
    //   ⚠ ⛔ 并且**不许**因此放宽上面那条真断言（它照旧逐行比对正本 ↔ 模板）。
    {
      const tRef = ['.hob/templates/CONTEXT.md', '.hob/templates/DECISIONS.md', '.hob/templates/USER-DECISIONS.md']
        .map((rp) => { try { return readFileSync(join(root, rp), 'utf8') } catch { return '' } }).join('\n')
      const mRef = A_FILES.map((f) => { try { return readFileSync(join(LEDGER_ROOT, f), 'utf8') } catch { return '' } }).join('\n')
      // ⚠ ⚠ **机检自造的样本对**（⛔ 与真正本内容无关）：一份"正本样本" + 它的"模板样本"。
      //   形状要与真件同构：`## ` 节 + 首格为纯 token 列表的表行（nCompare 的收录口径）。
      const N_SAMPLE_M = [
        '## 4. 收尾必跑命令表',
        '',
        '| 命令 | 读 |',
        '|---|---|',
        '| `npm run build` | 构建 |',
        '| `npm run check:modules` | 模块探针 |',
        '| `npm run check:host` | 宿主探针 |',
        // ⚠ ⚠ **第 238 轮加的两行样本（成对，守"只判首格"这次收窄）**：
        //   ⑤ 首格是**纯命令 token**、**说明列含数字**（轮次号）⇒ 必须**被收录**（该咬）；
        //   ⑥ 首格**自己含数字**（读数写在首格）⇒ 必须**仍被排除**（不该咬）。
        '| `npm run check:rounds` | 轮次记录探针（第 233 轮新增） |',
        '| `volumes/plan/11-pending-drafts.md` | 待定稿项（3 档） |',
        '',
        '## 1. 骨架',
        '',
        '| 归属 | 说明 |',
        '|---|---|',
        '| `templates/` `experience/` | 骨架两处 |',
        '',
        '## 5. 尾巴',
        '',
      ].join('\n')
      const N_SAMPLE_T = N_SAMPLE_M   // ⚠ 自造模板样本 = 自造正本样本（初始一致 ⇒ 本当 PASS）
      // ① 模板样本删掉一行（正本样本里有 ⇒ 必须报 missing）
      const N_S1 = N_SAMPLE_T.replace(/^\| `npm run check:modules` \|.*$/m, '')
      // ② 模板样本给某行改个错成员（骨架行漏 `experience/` —— 该 token 是 `*/` 形态，属结构行）
      const N_S2 = N_SAMPLE_T.replace('| `templates/` `experience/` | 骨架两处 |',
        '| `templates/` | 骨架一处 |')
      // ③ 模板样本注入写死阈值
      const N_S3 = N_SAMPLE_T + '\n> ⚠ 本文件上限 65536 字节。\n'
      // ④ 模板样本加一个瞎编的节
      const N_S4 = N_SAMPLE_T + '\n## 77. 瞎编的节（正本没有、也不带「附：」）\n\n| 项 | 读 |\n|---|---|\n| `x.md` | ... |\n'
      // ⚠ ⑤（第 238 轮 · **守"只判首格"这次收窄**）：删掉那行"首格纯 token + 说明列含数字"的行
      //   ⇒ ⚠ **必须报 missing**。⚠ 它是一条**回归守卫**：若有人把规则改回"整行含数字即跳过"，
      //   ⚠ 这一行会被**静默跳过** ⇒ 本样本**当场失效**（probe 报"没被咬"）⇒ 收窄被撤销会被抓住。
      const N_S5 = N_SAMPLE_T.replace(/^\| `npm run check:rounds` \|.*$/m, '')
      // ⚠ ⑥（第 238 轮 · **配对"不该咬"**）：删掉那行"首格自己含数字"的行 ⇒ ⚠ **必须仍不报 missing**
      //   （读数行写在首格 ⇒ 仍属"模板有意不搬"的一侧）⇒ 守"别把排除面一刀删光"。
      const N_S6 = N_SAMPLE_T.replace(/^\| `volumes\/plan\/11-pending-drafts\.md` \|.*$/m, '')
      const probes = [
        ['① 模板样本删掉正本样本有的一行（§4 的 check:modules）',
          () => { const r = nCompare(N_SAMPLE_M, N_S1); return r.missing.length > 0 }],
        ['② 模板样本改错成员（§1 骨架行漏 `.hob/experience/`）',
          () => { const r = nCompare(N_SAMPLE_M, N_S2); return r.missing.length > 0 }],
        ['③ 模板样本注入写死阈值（"上限 65536 字节"）',
          () => N_S3.split('\n').some((l) => N_HARD.some(([re]) => re.test(l)))],
        ['④ 模板样本加瞎编的节（"## 77. 瞎编的节"）', () => {
          const mK = new Set(nSplitSections(N_SAMPLE_M).map((x) => x.key))
          return nSplitSections(N_S4).map((x) => x.key).filter((k) => !mK.has(k) && !k.startsWith('附：')).length > 0
        }],
        ['⑤ 模板样本删掉"首格纯 token + 说明列含数字"的行（§4 的 check:rounds）'
          + ' ⇒ **第 238 轮收窄的回归守卫**',
          () => {
            const r = nCompare(N_SAMPLE_M, N_S5)
            return r.missing.some(([, row]) => row === nNorm('`npm run check:rounds`'))
          }],
      ]
      // ⚠ ⚠ **另加两条"不该被咬"的对照**（**E-126** 成对）：⚠ 样本对**原样**时
      //   ⛔ 不许报 missing（否则"该咬的恒咬"这种恒红同样会让判据失去意义）；
      //   ⚠ ⑥ 另守"首格含数字的读数行**仍被排除**"（收窄的形状：只收窄到首格，⛔ 不是全放开）。
      const safeBite = nCompare(N_SAMPLE_M, N_SAMPLE_T)
      const safeBite2 = nCompare(N_SAMPLE_M, N_S6)
      let nSampleBad = 0
      if (safeBite.missing.length !== 0) {
        nSampleBad++
        bad('N 自带**不该咬**的样本被咬了：样本对**逐字相同**时报出了 missing'
          + `\n      ⇒ 实测 missing=${safeBite.missing.length} 行 —— 判据**过咬**了`
          + '\n      ⇒ 成对纪律（E-126）："该咬的真被咬"与"不该咬的真没被咬"**两条都要过**')
      }
      // ⚠ ⑥（第 238 轮 · 配对）：**首格自己含数字**的读数行，即便模板里没有，⛔ 也不许报 missing
      //   ⇒ ⚠ 守的是"收窄的形状"：**只收窄到首格**，⛔ 不是把排除面一刀删光
      //   （若有人把 `if (/\d/.test(first)) continue` 整条删掉 ⇒ 本样本当场报 missing ⇒ 被抓）。
      if (safeBite2.missing.length !== 0) {
        nSampleBad++
        bad('N 自带**不该咬**的样本（首格含数字的读数行）被咬了：模板样本里没有它却报出 missing'
          + `\n      ⇒ 实测 missing=${safeBite2.missing.length} 行：${safeBite2.missing.map(([, r]) => r).join(' · ')}`
          + '\n      ⇒ ⚠ 说明**排除面被一刀删光**（第 238 轮的收窄形状是"只判首格"，⛔ 不是"全放开"）'
          + '\n      ⇒ 成对纪律（E-126）：收窄与放宽**必须输出不同**')
      }
      for (const [why, fn] of probes) {
        let bit = false
        try { bit = fn() } catch { bit = false }
        if (!bit) {
          nSampleBad++
          bad(`N 自带坏样本**没被咬**：${why}` + '\n      ⇒ 该组判据**改哑了**（坏样本都放过去了，真缺陷更会溜）'
            + '\n      ⇒ 与 I 组同法：**判据改哑与判据改对必须输出不同**（E-126）'
            + '\n      ⇒ ⚠ 本样本对**由机检自造**（第 220 轮改法）⇒ 报出本条**就是判据自己的问题**，'
            + '⛔ **不再是"正本里那条靶行被搬走了"**（第 179 轮那种误导性报错）')
        }
      }
      if (nSampleBad === 0) {
        ok(`N ✓ 自带坏样本：5 组（删行 / 改错成员 / 注入硬阈值 / 瞎编节 / 删"首格纯 token+说明列含数字"行）`
          + `**全部被咬住** + 2 组"不该咬"（样本对逐字相同 · 删"首格含数字的读数行"）**全对**`
          + ' ⇒ 本组还长着牙、且不过咬（⚠ ⚠ **样本由机检自造 · 第 220 轮改法 · 第 238 轮加 ⑤⑥ 成对**，'
          + '⛔ **不依赖正本原文**）⇒ ⚠ 于是"正本那段被搬走 ⇒ 探针误报改哑"这一形态**不会再现**，'
          + '且**"整行含数字即跳过"若被改回去 ⇒ ⑤ 当场报没被咬**')
      }
      // ⚠ 参照面（真件）必须真的读到东西 —— ⚠ 它已**不再**是自造样本的基准，
      //   但上面那条**真断言**（逐个 `A_FILES` 比对）仍需两侧非空才有对象可查。
      if (tRef === '' || mRef === '') {
        bad('N 真断言的参照面**读不到**（模板 / 正本两侧任一为空）⇒ 上面那条"模板缺表行"失去对象（不按通过处理）')
      }
    }
    /**
     * ══════════════════════════════════════════════════════════════════════
     * ⚠⚠ **乙-5（2026-10-21 · 第 331 轮）：`nTables === 0` 时整组零输出**
     * ══════════════════════════════════════════════════════════════════════
     *
     * ── 改前的病灶（`PROJECT-SURVEY-3` §6.2 乙-5，与乙-4 同族）─────────────
     *   下面这条 `ok()` 的条件是 **`nBad === 0 && nTables > 0`** ⇒ `nTables === 0` 时
     *   **这条不打印**；而上面也没有别的出口 ⇒ ⚠ **N 组整组一行输出都没有**。
     *   ⚠ **"没有输出"比"打 ✓"更难发现**（乙-4 的原话）：打 ✓ 至少有那一行，
     *     而整组消失时，**输出里连 N 组的存在痕迹都没有** —— 没人会去数"本该有几组"。
     *
     * ── 现在：`nTables === 0` 时必须**有一条可读输出**，且**分清两种成因** ────────
     *   ① **模板里确实没有可比的表**（`A_FILES` 里每份都读到了，但一张"结构行表"都没有）
     *      ⇒ 这是"**没有对象**" ⇒ ⚠ 本组**未执行**，⛔ 不是通过；
     *   ② **读不到模板 / 正本**（`msrc === '' || tsrc === ''`，上游 `continue` 掉了）
     *      ⇒ 那是"**基准缺失**" ⇒ 走**既有的失败档**（`bad` ⇒ `exit 1`）——
     *        ⚠ 因为 `A` 已经在同一处报过"失去基准"，这里再落 `bad` 是**同一事实的第二个面**：
     *        A 管"节名比不了"，N 管"表行比不了"，⛔ 两种口径不许合并成一句。
     *
     * ── 档位选择：**`exit 2`**（没有对象），理由 ────────────────────────────
     *   TASK 让我二选一。选 `2` 是因为：`nTables === 0` **本身不是违规** ——
     *   一份正本如果确实没有"首格为纯 token 列表"的表，本组就**没有对象可查**，
     *   这与"查了发现不一致"（`1`）是两件事。⚠ 而 `1` 会让人去改模板，那是**白改**。
     *   ⚠ 但**读不到**那一支**必须**是 `1`（上面 ②）—— 那是真缺陷（模板丢了 / 路径变了）。
     */
    const nReadAny = A_FILES.some((f) => {
      let tsrc = ''
      try { tsrc = readFileSync(join(root, '.hob', 'templates', f), 'utf8') } catch { tsrc = '' }
      return tsrc !== ''
    })
    if (nBad === 0 && nTables === 0) {
      if (!nReadAny) {
        /**
         * ⚠ **一份模板都读不到** ⇒ 基准缺失 ⇒ 走既有失败档（`exit 1`）。
         *   这与"模板在、但没有可比的表"**完全不同**：前者的修法是"把模板放回来/改对路径"，
         *   后者是"这份正本本来就没有结构行表"（可能完全正常）。
         */
        bad('N 【基准缺失】模板镜像：**一份模板都读不到** ⇒ 本组一张表都没比（⛔ 不按通过处理）'
          + `\n      ⇒ 期望路径：${join(root, '.hob', 'templates')}/<正本名>`
          + '\n      ⇒ ⚠ 这与"模板在、但没有可比的表"是两件事：前者要**修路径/补模板**，'
          + '后者可能完全正常（⛔ 不许合并成一句）')
      } else {
        /**
         * ⚠ **模板读到了，但没有一张"结构行表"可比** ⇒ **没有对象** ⇒ `exit 2`。
         *   ⚠ 用 `noObject` 标记而不是 `ok()`：`ok()` 会把"没查"记成"查过且过"。
         *   ⚠ 也不能沉默：改前正是沉默（乙-5 的病灶）。
         */
        noObjectSink('N 模板镜像（结构行）**未执行** —— '
          + `${A_FILES.length} 份有模板的正本里，**一张"结构行表"都没有可比**`
          + `（模板读得到，共 ${A_FILES.length} 份；⚠ 这是"没有对象"，⛔ 不是"查过且过"）`
          + '\n      ⇒ 口径：本组只比**首格为纯 token 列表**且 token 属产物形状的表；'
          + '若正本里确实没有这类表，本组**理应没有对象**（⛔ 别为此去改模板）')
      }
    }
    if (nBad === 0 && nTables > 0) {
      ok(`N ✓ 模板镜像（结构行）：${A_FILES.length} 份有模板的正本里 ${nTables} 张表**逐行比对**，`
        + `模板表行集 **⊇ 正本**（0 缺行）；且三份模板里**无写死的阈值 / 字节数**`
        + ' ⇒ 照模板起手不会缺行、也不会把本项目阈值复制出去（口径：只镜像结构，⛔ 不搬项目现状）'
        + ' ⚠ **覆盖面（本组辖什么 / 不辖什么）**：'
        + '**在辖** = 首格为**纯 token 列表**（反引号 token + 分隔符）且 token 属**产物形状**'
        + '（`*.md` / `*/` / `npm run <名>`）的表行；'
        + '**不在辖** = 首格**含散文**的表（如关键约束速查表）与**读数行**'
        + '（它们是模板**有意不搬**的"项目现状 / 项目史"）—— 即本组绿的是"结构行"，'
        + '**不**代表"模板与正本逐字一致"（名单不写死：口径如上，以实测输出的表数为准）')
    }

    // ── 断言 V：`package.json` 的每一个 `check:*` 族都必须在正本 §4.1 收尾表里 ──
    //
    // ⚠ **为什么加这一组**（2026-10-20 第 320 轮 · TASK-D4）：
    //   断言 N 管的是「**正本 → 模板**」（模板必须镜像正本的行）。它有一个**结构性盲区**：
    //   ⚠ ⚠ **正本自己漏了一族时，N 组看不见** —— 它只要求"正本里有的，模板也得有"，
    //   从不要求"`package.json` 里有的，正本也得有"。
    //   实测出处：`check:redeliver` 于 `76e1bc3` 接进 `npm run check`（只改了 `package.json` +
    //   `check-repo-rules.mjs` 的落点登记），**两份 `CONTEXT.md` 都没跟上** ⇒ 两侧各 14 族、
    //   `package.json` 15 族，而**当时没有任何判据会红**。
    //   ⇒ 后果与 E-122 同族：**族在、判据在、但照着 §4.1 手工跑收尾的人永远跳过它**。
    //
    // ⚠ **方向与 N 组相反、两条都要**（⛔ 不许拿本条替换 N 组）：
    //   · N：正本 ⊆ 模板（模板别落后）
    //   · V：`package.json` 的族 ⊆ 正本（**正本别落后**）
    //   ⇒ 两条合起来才闭合"三处同批"：`package.json` · 正本 §4.1 · 模板 §4.1。
    //
    // ⚠ **扫描面派生、⛔ 不手抄族名**（E-133 同族；手抄一张会漂的期望表正是本条要治的病）：
    //   族名一律从 `package.json` 的 `scripts` 键现读，只保留 `check:` 前缀。
    //   ⚠ **排除 `check:all` 与 `check:preflight`** —— 它们自己就是聚合入口与体检
    //   （与 `scripts/check-all.mjs` 的 `SELF` 同口径），⛔ 不是判据族。
    //
    // ⚠ **正本读不到 / 解析不到时**：⛔ **不许静默通过**（照 N 组同款口径 —— 它用 `bad(...)`
    //   而不是 `ok(...)`：参见上面 `N 真断言的参照面**读不到**` 那一条）。
    //   同理 `package.json` 读不到也 `bad`（基准缺失 ⇒ 不按通过处理）。
    {
      /** 从一份 Markdown 的「`### 4.1` 起、下一个 `## ` 止」这段里抽出 `check:*` 族名。 */
      const vFamiliesInSection = (src) => {
        const lines = src.split('\n')
        let inSec = false
        const found = new Set()
        for (const l of lines) {
          if (/^###\s+4\.1(\s|$)/.test(l)) { inSec = true; continue }
          if (inSec && /^##\s+\S/.test(l)) break
          if (!inSec) continue
          if (!l.trim().startsWith('|')) continue
          // ⚠ 只认**首格里的反引号 token**（与 N 组的收录口径同族：只看首格，不看说明列）
          const first = (l.trim().replace(/^\|/, '').split('|')[0] || '')
          for (const m of first.matchAll(/`npm run (check:[A-Za-z0-9:_-]+)`/g)) found.add(m[1])
        }
        return found
      }
      /** 从 `package.json` 的 `scripts` 派生判据族（⚠ 派生，⛔ 不手抄）。 */
      const vFamiliesFromPkg = (raw) => {
        const scripts = JSON.parse(raw)?.scripts ?? {}
        const SELF_V = new Set(['check:all', 'check:preflight'])
        return new Set(Object.keys(scripts).filter((k) => k.startsWith('check:') && !SELF_V.has(k)))
      }
      let vPkgRaw = ''
      try {
        vPkgRaw = readFileSync(join(root, 'package.json'), 'utf8')
      } catch { vPkgRaw = '' }
      let vLedgerSrc = ''
      try {
        vLedgerSrc = readFileSync(join(LEDGER_ROOT, 'CONTEXT.md'), 'utf8')
      } catch { vLedgerSrc = '' }

      if (vPkgRaw === '') {
        bad('V 读不到 `package.json` ⇒ 「`check:*` 族必须进正本 §4.1」这一条**失去基准**（不按通过处理）')
      } else if (vLedgerSrc === '') {
        bad('V 读不到正本 `CONTEXT.md` ⇒ 「`check:*` 族必须进正本 §4.1」这一条**失去基准**（不按通过处理）'
          + `\n      ⇒ 期望路径：${join(LEDGER_ROOT, 'CONTEXT.md')}`)
      } else {
        let vPkgFams
        let vLedgerFams
        try {
          vPkgFams = vFamiliesFromPkg(vPkgRaw)
        } catch (e) {
          vPkgFams = undefined
          bad(`V \`package.json\` 不是合法 JSON ⇒ 本条失去基准（不按通过处理）：${String(e?.message ?? e)}`)
        }
        vLedgerFams = vFamiliesInSection(vLedgerSrc)
        // ⚠ 正本这一段**一条都抽不到**也是一个错（可能是 §4.1 被搬走 / 标题被改），⛔ 不许当"全过"
        if (vPkgFams !== undefined && vLedgerFams.size === 0) {
          bad('V 正本 `CONTEXT.md` 的 `### 4.1` 段里**一条 `npm run check:*` 都没抽到**'
            + ' ⇒ 扫描面为 0，本条**不是在通过**（⛔ 扫 0 份报 ✓ 是 E-126 假绿）'
            + '\n      ⇒ 可能原因：§4.1 整节被搬走 / 标题被改成非 `### 4.1` / 表格结构变了'
            + '\n      ⇒ 期望：`### 4.1 收尾必跑` 之后、下一个 `## ` 之前，有 `| \`npm run check:<名>\` | … |` 形态的行')
        } else if (vPkgFams !== undefined) {
          const vMissing = [...vPkgFams].filter((f) => !vLedgerFams.has(f)).sort()
          if (vMissing.length > 0) {
            bad(`V **收尾表漏族**：\`package.json\` 里有、而正本 \`CONTEXT.md\` §4.1 里**没有**的判据族：`
              + ` ${vMissing.map((m) => '`' + m + '`').join(' · ')}`
              + `\n      ⇒ 实测：\`package.json\` 的 \`check:*\` 族 **${vPkgFams.size}** 个 ·`
              + ` 正本 §4.1 抽到 **${vLedgerFams.size}** 个 · **缺 ${vMissing.length} 个**`
              + '\n      ⇒ ⚠ 这正是"族在、判据在、但**照着 §4.1 手工跑收尾的人永远跳过它**"那一形态'
              + '（`E-122` 同族：机制没有喂养端）'
              + '\n      ⇒ 处置：把缺的那几族**逐条补进正本 §4.1**（照该表既有行文：`| \\`npm run <族>\\` | <守什么> |`）'
              + '\n      ⇒ ⚠ **同批还要改两处**，否则会当场再红：模板 §4.1（断言 N 管）+ 本表的登记面'
              + '\n      ⇒ 加新 `check:` 族时必须同批改三处：`package.json` · 账本正本 `§4.1` · 模板 `§4.1`。')
          } else {
            ok(`V ✓ 收尾表**不漏族**：\`package.json\` 的 \`check:*\` 族 **${vPkgFams.size}** 个，`
              + `正本 \`CONTEXT.md\` §4.1 里**全部在列**（⚠ 派生自 \`package.json\`，⛔ 不手抄族名）`
              + ' ⇒ 与断言 N（正本 ⊆ 模板）方向相反、两条合起来才闭合"三处同批"：'
              + '`package.json` · 账本正本 §4.1 · 模板 §4.1')
          }
        }
      }

      // ── 断言 V 的自带样本（⚠ **在内存里造**，⛔ 不改任何真文件）──────────────
      //   ⚠ 与 N 组同法：样本**由机检自造**，⛔ 不拿真正本当基准
      //     （否则"正本那条靶行被搬走"会误报成"判据改哑了"，第 179 轮的坑）。
      //   ⚠ 成对纪律（E-126）：**该咬的真被咬** + **不该咬的真没被咬**，两条都要过。
      {
        const V_SAMPLE_M = [
          '### 4.1 收尾必跑（全部 exit 0）',
          '',
          '| 命令 | 守什么 |',
          '|---|---|',
          '| `npm run build` | 构建 |',
          '| `npm run check:orch` | 运行态 |',
          '| `npm run check:redeliver` | 补投 |',
          '',
          '## 5. 本批登记',
          '',
          '| 项 | 读 |',
          '|---|---|',
          '| `npm run check:zzz-not-in-41` | ⚠ 这一行在 §4.1 **之外**，⛔ 不许被算进收尾表 |',
          '',
        ].join('\n')
        const V_PKG = JSON.stringify({
          scripts: {
            'check:orch': 'node a.mjs',
            'check:redeliver': 'node b.mjs',
            'check:all': 'node c.mjs',
            'check:preflight': 'node d.mjs',
            build: 'tsc',
          },
        })
        const vSafe = vFamiliesInSection(V_SAMPLE_M)
        const vPkgSafe = vFamiliesFromPkg(V_PKG)
        const vProbes = [
          // ① **不该咬**：样本里 §4.1 的族齐全 ⇒ package.json 的族必须全部命中
          ['样本 §4.1 齐全 ⇒ 不许报缺族',
            () => {
              const miss = [...vPkgSafe].filter((f) => !vSafe.has(f))
              // check:all / check:preflight 必须被排除 ⇒ 否则本条会误报
              return miss.length === 0 && !vPkgSafe.has('check:all') && !vPkgSafe.has('check:preflight')
            }],
          // ② **该咬**：把 check:redeliver 从样本 §4.1 里删掉 ⇒ 必须报缺它
          ['样本 §4.1 删掉 `check:redeliver` ⇒ 必须报缺这一族',
            () => {
              const cut = V_SAMPLE_M.replace(/^\| `npm run check:redeliver` \|.*$/m, '')
              const got = vFamiliesInSection(cut)
              return [...vPkgSafe].filter((f) => !got.has(f)).includes('check:redeliver')
            }],
          // ③ **该排除**：写在 §4.1 **之外**的表行 ⛔ 不许被算进收尾表（否则"别处的表"能顶替收尾表）
          ['§4.1 之外的表行 ⛔ 不算收尾表（`check:zzz-not-in-41` 不许被收进）',
            () => !vSafe.has('check:zzz-not-in-41')],
          // ④ `check:all` / `check:preflight` 必须被排除（它们是调度器与体检，不是判据族）
          ['`check:all` / `check:preflight` 必须被排除（与 `check-all.mjs` 的 SELF 同口径）',
            () => !vPkgSafe.has('check:all') && !vPkgSafe.has('check:preflight')],
        ]
        let vSampleBad = 0
        for (const [why, fn] of vProbes) {
          let bit = false
          try { bit = fn() === true } catch { bit = false }
          if (!bit) {
            vSampleBad++
            bad(`V 自带样本**不符合预期**：${why}`
              + '\n      ⇒ 该组判据**改哑了**（或过咬）⇒ 真缺陷更会溜'
              + '\n      ⇒ 与 N / I 组同法：**判据改哑与判据改对必须输出不同**（E-126）')
          }
        }
        if (vSampleBad === 0) {
          ok('V ✓ 自带样本：2 组"该咬/不该咬"成对（§4.1 齐全 ⇒ 不报缺；删 `check:redeliver` ⇒ 真报缺）'
            + ' + 2 组排除面（§4.1 之外的表行不算 · `check:all`/`check:preflight` 不算）**全部符合预期**'
            + ' ⇒ 本组还长着牙、且不过咬（⚠ 样本由机检自造，⛔ 不依赖真正本原文）')
        }
      }
    }

    // ── 断言 O：地图 ↔ 卷 两向完整 + 说明列非空（第 99 轮 · UD-98 / CHG-038）──
    // ⚠ **只为"地图漏了某个板块"这一件事**加判据（⛔ 不扩到别的对象）。
    // ⚠ **扫描面派生**：读卷目录实测，⛔ 不手抄板块清单（E-133 同族）。
    // ⚠ **只对"有卷的地图"生效**：卷根不存在 ⇒ 打印「未执行、不代表通过」（迁移期口径，⛔ 不是放宽）。
    // ⚠ **新组、新常量**：⛔ 不改任何既有断言的语义；⛔ 不加"跳过"档。
    const oMapPath = join(LEDGER_ROOT, 'PROJECT.md')
    const oVolDir = join(LEDGER_ROOT, 'volumes', 'plan')
    if (!existsSync(oVolDir)) {
      // ⚠ 打印「未执行」—— **不报通过**（本仓口径：『没有』与『没查』必须可区分）
      skipSink('O 【未执行、不代表通过】`volumes/plan/` 卷根不存在 ⇒ '
        + '「地图 ↔ 卷 两向完整 + 说明列非空」这一组**没有查**，不是通过'
        + `\n      （卷根：${oVolDir}）`)
    } else {
      // ① 扫描面派生：卷目录里的节文件（排除 INDEX.md）
      let oVols = []
      try {
        oVols = readdirSync(oVolDir).filter((f) => f.endsWith('.md') && f !== 'INDEX.md').sort()
      } catch { oVols = [] }
      if (oVols.length === 0) {
        bad('O 卷目录里**一份节文件都没有**（或读不到）⇒ 「地图点到每一个卷」无从判定（不按通过处理）'
          + `\n      ⇒ 卷根：${oVolDir}`)
      } else if (!existsSync(oMapPath)) {
        bad(`O 地图读不到：${oMapPath} ⇒ 「地图 ↔ 卷 两向完整」失去基准（不按通过处理）`)
      } else {
        const oMapSrc = readFileSync(oMapPath, 'utf8')
        // ② 抽出「板块总览」表：三列 = 板块 / 这一块讲什么 / 去哪读
        const oRows = []
        for (const [i, l] of oMapSrc.split('\n').entries()) {
          if (!l.trim().startsWith('|')) continue
          const cells = l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((x) => x.trim())
          if (cells.length !== 3) continue
          if (cells[0] === '板块' || /^-{2,}$/.test(cells[0].replace(/:/g, ''))) continue
          const paths = [...cells[2].matchAll(/`([^`]+\.md)`/g)].map((m) => m[1])
          if (paths.length === 0) continue
          oRows.push({ lineNo: i + 1, name: cells[0], desc: cells[1], paths })
        }
        const oStripped = (v) => v.replace(/[`*\s｜|]/g, '')
        let oBad = 0
        // ③ 问一：卷里每一份节文件都必须被地图点到
        const oNamed = new Set()
        for (const r of oRows) for (const pa of r.paths) oNamed.add(pa.split('/').pop())
        const oMissing = oVols.filter((v) => !oNamed.has(v))
        if (oMissing.length > 0) {
          oBad++
          bad(`O 地图**漏了板块**：卷里有 ${oVols.length} 份节文件，地图的「板块总览」表只点到 ${oNamed.size} 份`
            + oMissing.map((v) => `\n        漏：volumes/plan/${v}`).join('')
            + '\n      ⇒ 「读完地图知道项目由哪些板块组成」这条标准**静默失效**'
            + '\n      ⇒ 修法：在 `PROJECT.md` 的「板块总览」表里补上该板块行')
        }
        // ④ 问二：说明列必须有实质内容（空 / 仅标点 / 与板块名逐字相同 ⇒ FAIL）
        for (const r of oRows) {
          const nameStripped = oStripped(r.name)
          const descStripped = oStripped(r.desc)
          const noSubstance = descStripped === ''
            || /^[，。、；：·—\-。！？\s]*$/.test(descStripped)
            || descStripped === nameStripped
          if (noSubstance) {
            oBad++
            bad(`O 「这一块讲什么」**没有实质内容**：PROJECT.md:${r.lineNo}`
              + `\n        板块：${r.name}`
              + `\n        说明列：${r.desc === '' ? '（空）' : r.desc}`
              + '\n      ⇒ 地图只剩板块名 ⇒ **读者不知道这一块是什么**（那正是本判据要防的）'
              + '\n      ⇒ 修法：写一到两句"解决什么问题 / 里面有什么"（写给人看，⛔ 不是关键词堆）')
          }
        }
        // ⑤ 问三：地图点到的路径必须真实存在
        for (const r of oRows) {
          for (const pa of r.paths) {
            if (!existsSync(join(LEDGER_ROOT, pa))) {
              oBad++
              bad(`O 地图点到**不存在的卷文件**：PROJECT.md:${r.lineNo} → \`${pa}\``
                + '\n      ⇒ "去哪读"指不到实体 ⇒ 读者照它去找会落空'
                + '\n      ⇒ 判据同既有「具名引用必须先实测存在」口径')
            }
          }
        }
        if (oBad === 0) {
          ok(`O ✓ 地图 ↔ 卷 两向完整：卷里 ${oVols.length} 份节文件**全部**被地图「板块总览」表点到；`
            + `${oRows.length} 行的"这一块讲什么"**均有实质内容**；地图点到的路径**全部真实存在**`
            + ' ⇒ 「读完地图知道项目由哪些板块组成」不再静默失效（覆盖面对照：卷目录实测派生，⛔ 非手抄）')
        }
      }
    }
    // ── 断言 B：正本里不许出现补丁式历史说明 ──────────────────────────────
    // 两级正则（都**行首锚定**，避免把"讨论该纪律"的句子误判）：
    //   T1 = 带日期锚的补丁注记：`订正（2026-…` / `更正（2026-…`
    //   T2 = 行首（可带列表记号/引用记号/加粗）的补丁式起句：`原文此处` / `已失实` / `原写` / `原为` …
    const PATCH_T1 = [
      /(?:订正|更正|修正)\s*[（(]\s*\d{4}/,
      /[（(]\s*\d{4}-\d{2}-\d{2}\s*[）)]\s*[：:]?\s*(?:原文|原写|原为)/,
    ]
    const PATCH_T2 = [
      /^\s*(?:[-*+]\s*)?(?:>\s*)?(?:\*\*)?(?:原文此处|已失实|原写|原为|原表述|此前写作)/,
    ]
    for (const f of SCAN_FILES) {
      let src = ''
      try { src = readFileSync(join(LEDGER_ROOT, f), 'utf8') } catch { src = '' }
      if (src === '') {
        bad(`B 正本读不到：${join(LEDGER_ROOT, f)} —— 形态比对失去基准（不按通过处理）`)
        continue
      }
      const hits = []
      src.split('\n').forEach((l, i) => {
        for (const re of [...PATCH_T1, ...PATCH_T2]) {
          if (re.test(l)) { hits.push(`:${i + 1} ${l.trim().slice(0, 90)}`); break }
        }
      })
      if (hits.length > 0) {
        bad(`B 正本 ${f} 出现**补丁式历史说明**（形态回潮）—— `
          + hits.map((h) => `\n        ${h}`).join('')
          + `\n      ⇒ 现行口径是「只写当前状态」：删掉补丁段，把**旧版整份**存进 archive/<日期>-<名>/`)
      } else {
        ok(`B ✓ ${f}：无补丁式历史说明（行首锚定 + 日期锚，正/负向都对拍过）`)
      }
    }
    ok(`文档形态机检【已执行】—— 正本根 = ${LEDGER_ROOT}；`
      + `共 ${SCAN_FILES.length} 份（地图 + 卷）**全部纳入**（**实测派生**，非手抄）：${SCAN_FILES.join(' / ')}`
      + `（口径 = 账本根一层下的 \`*.md\` + \`volumes/<卷>/\` 一层的 \`*.md\`，`
      + `见 derivePrimaryFiles() / deriveVolumeFiles()）`)

    /**
     * ── 断言 J（2026-10-11 新增 · 第 53 轮）：**正本里同一节标题不得出现两次** ──
     *
     * 背景见文件顶部的 `findDuplicateSectionHeadings`：第 52 轮 Hob 写 `USER-DECISIONS.md`
     * 时留过一个**重复的** `## 五、回复格式`，那一版**结构已坏而全部检查都不红** ——
     * 它是被「备份 diff 判读」**偶然撞见**的。本条把那次事故变成**可判的事**。
     *
     * ⚠ **判据成对**（**E-126**：只验一侧 ⇒ 判据写对与写错输出相同）
     *   ⇒ 下面**自带样本**：`N 该咬` + `M 不该咬`（**写死、不依赖正本内容**）。
     * ⚠ **另对"真实发生过的坏快照"做活体实证**（见 J-B 段）—— 比自造样本更强。
     * ⚠ **范围**：扫「地图 + 卷」（`SCAN_FILES`，第 78 轮扩范围）· 只认 `^## `（二级）· 围栏内不参与。
     */
    {
      // ── J-A 自带样本（写死在断言里，不依赖正本内容）──
      // ⚠ 数照实记（**E-117**：⛔ 不写死"预期几个"）；判据 = **该咬的全咬、不该咬的全不咬**。
      const J_BITE_SAMPLES = [
        ['## 一、甲\n## 二、乙\n## 一、甲\n', 'S1 行首二级标题**重复一次**（最朴素形态）'],
        ['## 一、甲\n正文\n## 二、乙\n## 一、甲\n## 一、甲\n', 'S2 同一标题**出现三次**（重复计数必须 ≥2）'],
        ['## 一、甲\n## 一、甲\n## 二、乙\n', 'S3 重复**相邻**（中间无正文）'],
        ['## 一、甲\n' + '```md\n' + '## 一、甲\n' + '```\n' + '## 一、甲\n',
          'S4 夹着一段围栏：**围栏内那份豁免、围栏外的两处仍须被咬**'],
      ]
      const J_EXEMPT_SAMPLES = [
        ['## 一、甲\n## 二、乙\n## 三、丙\n', 'S5 每个标题**只出现一次** ⇒ 不咬'],
        ['## 一、甲\n\n' + '```md\n' + '## 一、甲\n' + '```\n', 'S6 第二处在**围栏代码块内**（那是示例）⇒ 不咬'],
        ['同一行里提到 `## 一、甲` 与 `## 一、甲` ⇒ **不在行首**。\n', 'S7 行内提及（不在行首）⇒ 不咬'],
        ['### 一、甲\n### 一、甲\n', 'S8 三级标题重复 ⇒ **本轮范围外**（只认 `^## `）⇒ 不咬'],
        ['## 一、甲\n# 一、甲\n', 'S9 一级标题不属于本判据（只认 `^## `）⇒ 不咬'],
      ]
      let jBad = 0
      for (const [sample, why] of J_BITE_SAMPLES) {
        const d = findDuplicateSectionHeadings(sample)
        if (d.length === 0) {
          jBad++
          bad(`J 自带样本**没被咬**：${why} —— 期望 ≥1 个重复标题，实测 0 个`
            + '\n      ⇒ 判据**过窄/改哑**：真出现重复标题时它不会报 ⇒ 断言 J **失效**')
        }
      }
      for (const [sample, why] of J_EXEMPT_SAMPLES) {
        const d = findDuplicateSectionHeadings(sample)
        if (d.length !== 0) {
          jBad++
          bad(`J 自带样本**被误咬**：${why} —— 期望 0 个重复标题，实测 ${d.length} 个：`
            + ` ${d.map((x) => `「${x.title}」@${x.lines.join(',')}`).join(' · ')}`
            + '\n      ⇒ 判据**过宽**：把示例 / 行内提及 / 范围外标题当成违规 ⇒ 文档会被自己的例子打挂'
            + '（**E-114** 家族）')
        }
      }
      if (jBad === 0) {
        ok(`J ✓ 自带样本：${J_BITE_SAMPLES.length} 个"该咬"的样本**全部咬到**，`
          + `${J_EXEMPT_SAMPLES.length} 个"不该咬"的样本**全部未**被咬（自带样本，不依赖正本内容）`)
      }

      // ── J-B 活体实证：对**真实发生过的坏快照**跑同一函数（形同单测）──
      // ⚠ 备份**只读、只复制**（⛔ 绝不写 backups/）；坏的这份是 2026-10-11 第 52 轮
      //    Hob 写坏的那一版，`## 五、回复格式` 在第 200 与第 425 行各一个。
      // ⚠ 这条样本若**读不到**（别的机器上账本区可能不在）⇒ **明说"未取"，不静默当成通过**。
      const BAD_SNAPSHOT = join(LEDGER_ROOT, 'backups', 'USER-DECISIONS.md.20261011-022744.bak')
      let snapSrc = ''
      try {
        snapSrc = readFileSync(BAD_SNAPSHOT, 'utf8')
      } catch { snapSrc = '' }
      if (snapSrc === '') {
        skipSink(`J ⏳ 活体实证【未取】—— 读不到历史坏快照 ${BAD_SNAPSHOT}`
          + '（账本区 backups/ 可能不在本机）⛔ **这不代表通过**')
      } else {
        const dup = findDuplicateSectionHeadings(snapSrc)
        const hit = dup.find((x) => x.title === '五、回复格式')
        if (hit === undefined) {
          bad(`J 活体实证失败：历史坏快照 ${basename(BAD_SNAPSHOT)} 里没找出「五、回复格式」的重复`
            + `（实测重复标题 = ${dup.length === 0 ? '0 个' : dup.map((x) => `「${x.title}」`).join(' · ')}）`
            + '\n      ⇒ **判据没抓住真实发生过的错** ⇒ 判据写错了（不是夹具的问题）')
        } else if (hit.lines.length < 2) {
          bad(`J 活体实证失败：坏快照里「五、回复格式」只被找到 ${hit.lines.length} 处`
            + `（第 ${hit.lines.join(',')} 行）—— 期望 ≥2 处`)
        } else {
          ok(`J ✓ 活体实证（真实坏快照 ${basename(BAD_SNAPSHOT)}）：`
            + `「${hit.title}」重复，命中第 ${hit.lines.join(' 与第 ')} 行（共 ${hit.lines.length} 次）`
            + ' ⇒ 判据抓住了**真实发生过的那次错**，不是自造样本')
        }
      }

      // ── J-C 主体：正本逐份跑（清单派生自账本根 + 卷，第 78 轮扩范围）──
      for (const f of SCAN_FILES) {
        let src = ''
        try { src = readFileSync(join(LEDGER_ROOT, f), 'utf8') } catch {
          bad(`J 正本读不到：${join(LEDGER_ROOT, f)} —— 标题重复比对失去基准（不按通过处理）`)
          continue
        }
        const dup = findDuplicateSectionHeadings(src)
        if (dup.length > 0) {
          bad(`J 正本 ${f} 出现**重复的二级节标题** —— `
            + dup.map((x) => `\n        ✗ 「${x.title}」出现在第 ${x.lines.join(' 与第 ')} 行（共 ${x.lines.length} 次）`).join('')
            + `\n      ⇒ 一份文档里同一节只能有一处：重复标题多半是**追加写**留下的残骸`
            + `（第 52 轮实测：决定被追加到文件末尾、尾部重复了「五、回复格式」）`
            + ` ⇒ 修法：**整份重写**（正本改动必须整份重写），⛔ 不追加订正段`)
        } else {
          ok(`J ✓ ${f}：无重复的二级节标题（${(src.match(/^##\s+\S/gm) ?? []).length} 个标题，逐一唯一）`)
        }
      }
    }

    /**
     * ── 断言 C（2026-10-10 新增 · 第 19 轮 · UD-88 / CHG-025）────────────────
     * **账本仓自己的 `.gitignore` 不许写宽。**
     *
     * 背景：账本仓（`<ledgerRoot>/`）在 2026-10-10 新增了自己的 `.gitignore`，
     *   规则**只有一条** `backups/`（依据 README §1 的归类：改前备份属运行数据 · 不进 git）。
     *   ⚠ 风险：若有人图省事写成 `*`（或 `**` 之类宽规则），会把**正本与 `archive/`**
     *   一起**静默排除** —— git **不报任何错**，直到某天发现仓库里没有文档（E-70 / E-73 同族）。
     *
     * ⚠ **判据用"行为"而不是"解析文本"**（刻意）：
     *   解析 `.gitignore` 语法要重写一套 git 的匹配语义（取反、目录匹配、`**`），
     *   写出来**必然与 git 本身有偏差**；而这里要问的问题**git 自己就能回答** ——
     *   ⇒ 直接在**账本仓里**跑 `git check-ignore --no-index`，**以 git 的答案为准**。
     *   （同 §1.4 的既有口径：判"规则"而不是判"当下 index 看得见什么"。）
     *
     * 正反两向都验（缺一即假通过）：
     *   正向：正本（派生清单）+ `archive/` **必须都不被忽略**（任一被忽略 ⇒ FAIL）
     *   反向：`backups/` **必须被忽略**（否则"整目录不进库"没生效，噪音会回来）
     */
    const ignoreIn = (cwd, target) => {
      try {
        execFileSync('git', ['check-ignore', '-q', '--no-index', '--', target], { cwd, stdio: 'ignore' })
        return 0 // 被规则排除
      } catch (e) {
        if (typeof e.status === 'number') return e.status // 1 = 未被排除
        throw e
      }
    }
    // ⚠ 正本是**具体文件**、`archive/` 是**目录** —— 目录用「带尾斜杠 + 内嵌一个已知文件」两法都探，
    //   防"目录本身不匹配规则、但内部文件被排掉"这类偏差（与 `git check-ignore` 的目录语义有关）。
    // ⚠ **文件那部分从派生点取**（第 71 轮）：原先这里另抄了一份 4 个文件名的清单 ——
    //   同一个事实写两处 = **E-130 同病**（一处改了另一处没改，两面一起瞎）。
    //   ⇒ 现在 `SCAN_FILES` 是**唯一**的正本清单来源，本组只补上它的"目录"那一项。
    //   ⚠ 第 78 轮（UD-95 / CHG-032）：`SCAN_FILES` = 根上 + 卷里 ⇒ 卷根也纳入**同一条**口径。
    const C_MUST_NOT_IGNORE = [
      ...SCAN_FILES.map((f) => [f, '正本（派生自 derivePrimaryFiles() / deriveVolumeFiles()）']),
      ['archive/', '各批归档（§3 指针表说它由账本仓 git 记录保证）'],
      ['volumes/', '账本分卷根（UD-95 / CHG-032：卷与地图同权，都不许被忽略）'],
    ]
    // ⚠ 前置：账本仓**必须是 git 仓库**（否则 check-ignore 无意义，会一律报 exit 128 ⇒ 假 PASS）
    let ledgerIsRepo = false
    try {
      const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: LEDGER_ROOT, encoding: 'utf8' }).trim()
      ledgerIsRepo = top !== ''
    } catch { ledgerIsRepo = false }
    if (!ledgerIsRepo) {
      bad(`C 账本仓不是 git 仓库（${LEDGER_ROOT}）⇒ 忽略规则无从判定（不按通过处理）`)
    } else {
      const wronglyIgnored = C_MUST_NOT_IGNORE.filter(([p]) => ignoreIn(LEDGER_ROOT, p) === 0)
      if (wronglyIgnored.length > 0) {
        bad('C 账本仓的忽略规则**写宽了** —— 下列路径被判为"被忽略"：'
          + wronglyIgnored.map(([p, why]) => `\n        ${p}（${why}）`).join('')
          + '\n      ⇒ 它们会被**静默排除**（git 不报错）；规则应**只忽略 `backups/`**。'
          + `\n      判据：在 ${LEDGER_ROOT} 跑 \`git check-ignore --no-index <路径>\` 应为 1（未被排除）`)
      } else {
        ok(`C ✓ 账本仓：${SCAN_FILES.length} 份正本（派生）与 archive/ / volumes/ **均未被忽略**（${C_MUST_NOT_IGNORE.length} 项逐条实测）`)
      }
      // 反向：backups/ 必须被忽略
      if (ignoreIn(LEDGER_ROOT, 'backups/') !== 0) {
        bad('C 账本仓的 `backups/` **没有被忽略** —— "整目录不进库"（README §1 口径）未生效，'
          + '下一轮起 `git status` 会重新冒出"N 删 + M 增"的噪音')
      } else {
        ok('C ✓ 账本仓：`backups/` 确被忽略（反向判据，规则真的生效）')
      }
    }

    /**
     * ── 断言 D（2026-10-10 新增 · 第 25 轮 · UD-89/90 / CHG-026/027）──────────
     * **正本里"具名的"归档路径引用，必须真的存在。**
     *
     * 背景（本条的出处，实测）：第 24 轮执行方发现 `CONTEXT.md` 写着
     *   「各轮作业书（R21 系 / R22 系 / **R23 系**）」，而按 `TASK-R23` 通配
     *   **零命中** —— R23 系作业书**根本不存在**（Hob 把"轮次号"写成了"文件名"）。
     *   ⚠ 这是**同族第三次**（E-108 字段名 · E-109 数字口径 · 本次文件名），
     *   共同点是"**写的是我以为它叫什么，而不是我去看一眼它叫什么**"。
     *   ⚠ 关键：这类错误**当时没有任何机检能发现** —— 只能靠人读文档。
     *   ⇒ 把它变成机器盯的（E-108③：**能机器核的不要靠人记**）。
     *
     * ── 判据（为什么是这个形状）──────────────────────────────────────────
     *   在**派生出的正本清单**里扫 `archive/<YYYY-MM-DD-slug>/…` 形式的引用，**逐条核实磁盘上存在**。
     *
     *   ⚠ **只认"具名路径"** —— 判据**与既有权威口径同源**：
     *   `src/server/hob-write.ts` 的 `ARCHIVE_DIR_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/`
     *   （`hob-write.ts:57`，写侧一直在用它校验归档目录名）。
     *   ⚠ **为什么照抄而不是 `import`**：本脚本**零 src 依赖**（骨架机检不该依赖
     *     服务端模块能否加载 —— `hob-write.ts` 还牵连 `doc-read.ts`），且导出该常量
     *     要改 `src/**`（非本批范围）⇒ **照抄同一条正则并在此注明同源**。
     *   ⚠ **改这条正则时必须同步看一眼 `hob-write.ts:57`**，两边不许各写一套。
     *
     *   ⇒ 这样**天然排除**两类"不是引用"的文本（不需要另写排除表）：
     *   · 占位形态：`archive/<日期>-<名>/` · `archive/<YYYY-MM-DD-slug>/TASK.md`
     *     —— `<` 与 CJK 不在字符集里 ⇒ **不匹配**；
     *   · **描述性举例**：如 `archive/DATE-NAME/`（第 26 轮实测：它出现在
     *     `CONTEXT.md` 里**描述本断言边界**的那一行）—— 目录名段**不是日期格式**
     *     ⇒ **不匹配**。
     *   ⚠ 这条"不把举例当引用"的能力是**第 26 轮修出来的**（原来的宽正则把
     *     `archive/DATE-NAME/` 判成了"不存在的引用"，把断言自己打挂）。
     *     当时的注释写着"不会因为文档里出现了示例路径而误判"，而实现做不到 ——
     *     **现在做到了，本注释与实现相符**。见 `.hob/EXPERIENCE.md` **E-114**。
     *
     *   ⚠ **为什么用 `existsSync` 而不是"在 git 里"**：正本引用的是**账本区里的事实文件**
     *   （可能尚未 `git add`，如刚写的作业书）—— 问"文件在不在磁盘上"才是原意；
     *   "在不在 git 里"是**另一条判据**（断言 C 与 MUST-TRACK 已在管）。
     *
     *   ⚠ **举证形态**：一条引用都不存在 ⇒ 不是 FAIL，而是**打印计数说明**（见下）——
     *     "正本清单里没有任何具名引用"是**合法现状**（本批实测：`TASK-R*.md` 为 0 处），
     *     此时断言**无对象可查**，必须如实说明，**不许硬造**、也不许假装通过。
     */
    // ⚠ 与 `src/server/hob-write.ts:57` 的 `ARCHIVE_DIR_RE` **同源**（改一处请对一眼另一处）。
    //   只认 `archive/<YYYY-MM-DD-slug>` 打头的路径 ⇒ 占位与举例自然落选。
    // ⚠ **2026-10-11 第 54 轮收紧（只收紧、不放宽）**：slug 字符集由 `[a-z0-9-]` 放宽到
    //   `[A-Za-z0-9._-]` —— 原口径下 `archive/2026-10-11-plan-v2.2/PROJECT.md`（**slug 含点号**）
    //   **整条不被当引用** ⇒ 写入侧不报、**本断言也不报**（同源同病）；而写侧 `ARCHIVE_DIR_RE`
    //   会**拒写**那种目录 ⇒ 一条永远创建不出来的路径，全程无人提醒。
    //   ⚠ **不是放宽**：旧正则在**每一处**都仍匹配（严格超集，504 组组合实测 lost=0）⇒
    //     既有断言未被削弱，只是**多认出一种坏写法**（合法性仍归 `ARCHIVE_DIR_RE`）。
    //   ⚠ **同源的另一面**：与写侧 `REF_PATH_RE` **逐字同源**既是纪律（E-110），
    //     也意味着**一个缺陷会同时在两侧静默** —— "两边一致"不等于"两边都对"（**E-130**）。
    const D_REF_RE = /archive\/\d{4}-\d{2}-\d{2}-[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]*/g
    let dTotal = 0
    let dMissing = 0
    /**
     * ⚠ **R108 卡2「断言语义面收口」新增（只增输出）**：分文件计数。
     *   `[文件名, 命中处数 | null, 缺失处数 | null]`（`null` = 该份正本读不到）。
     *   ⛔ **它只喂下面的 `ok()` 输出行** —— 不参与任何 FAIL 判定、不改变 `bad()` 触发条件，
     *   也不改 `dTotal` / `dMissing` 的累加口径（两者仍是原来的逐条累加）。
     */
    const dPerFile = []
    for (const f of SCAN_FILES) {
      let src = ''
      try { src = readFileSync(join(LEDGER_ROOT, f), 'utf8') } catch { src = '' }
      if (src === '') {
        bad(`D 正本读不到：${join(LEDGER_ROOT, f)} —— 引用核验失去基准（不按通过处理）`)
        dPerFile.push([f, null, null])
        continue
      }
      let dFileHits = 0
      let dFileMissing = 0
      src.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(D_REF_RE)) {
          const ref = m[0]
          // 通配（`TASK-*.md` 之类）不是具名引用 —— 跳过，不算数。
          if (ref.includes('*')) continue
          dTotal++
          dFileHits++
          if (!existsSync(join(LEDGER_ROOT, ref))) {
            dMissing++
            dFileMissing++
            bad(`D 正本 ${f}:${i + 1} 引用了**不存在**的路径：\`${ref}\``
              + '\n      ⇒ 正本里的具名引用必须真的存在（凭记忆写文件名已踩坑三次：E-108 / E-109 / 本条的出处）'
              + `\n      ⇒ 核实方式：在 ${LEDGER_ROOT} 跑 \`ls ${ref}\``)
          }
        }
      })
      dPerFile.push([f, dFileHits, dFileMissing])
    }
    if (dTotal === 0) {
      // ⚠ **不判 FAIL**：这一支是"没有可查对象"，不是"查出来有问题"。
      //   但也**不静默** —— 必须打印说明，否则读者会把"没输出"当成"查过了、没问题"。
      ok(`D ✓ ${SCAN_FILES.length} 份里**没有**具名的 \`archive/…\` 路径引用（0 处）⇒`
        + ' 本断言**无对象可查**（已扫描，非跳过；占位形态 `archive/<日期>-<名>/` 按设计不计）')
    } else if (dMissing === 0) {
      ok(`D ✓ ${SCAN_FILES.length} 份里的 ${dTotal} 处具名归档路径引用，**全部真实存在**（逐条 ${dTotal} 次 existsSync）`)
    }
    // ⚠ R108 卡2「断言语义面收口」**只增输出**：**分文件计数** —— 逐份正本给出
    //   「命中 N 处 / 缺失 M 处」（缺失为 0 也照实打印 0；该份读不到则照实标"读不到"）。
    //   ⛔ 这一行**不参与任何判据**：FAIL 与否只由上面的 `bad()`（`dTotal` / `dMissing` 那两支）
    //   决定，本行只是把同一批扫描读数**摊到每份文件**上；⛔ 也不写死任何"预期 N"（E-117）。
    ok(`D ✓ 分文件计数（逐份，共 ${dPerFile.length} 份）：`
      + dPerFile.map(([f, h, m]) => (h === null
        ? `\n      · ${f} 读不到（已在上方逐条点名）`
        : `\n      · ${f} 命中 ${h} 处 / 缺失 ${m} 处`)).join('')
      + '\n      （读数取自本次扫描，非文档写死的预期值）')

    /**
     * ── D 的**自带样本**（2026-10-11 第 54 轮收紧后补 · **E-126** 成对纪律）────────
     *
     * ⚠ **为什么必须补**：第 54 轮把 slug 字符集由 `[a-z0-9-]` 放宽到 `[A-Za-z0-9._-]`
     *   （修"含点号 slug 整条不被当引用"的真缺口）。收紧/放宽判据时**必须同时验两侧**：
     *   只验"该咬的会咬" ⇒ **判据写对与过宽**输出相同；
     *   只验"不该咬的" ⇒ **判据写对与改哑**输出相同（**E-126** 原话）。
     *   ⇒ 下面写死一组样本：**该咬侧**必须匹配到、**不该咬侧**必须匹配不到；任一不符 ⇒ FAIL。
     * ⚠ 样本**写死、不依赖正本内容**（正本会变）；数照实记（**E-117**：⛔ 不写死"预期几个"）。
     */
    {
      const D_BITE_SAMPLES = [
        ['archive/2026-10-11-plan-v2.2/PROJECT.md', 'O1 含点号 slug（第 54 轮修的真缺口：旧口径整条不匹配）'],
        ['archive/2026-10-11-Plan-V2/PROJECT.md', 'O2 含大写 slug（同上，旧口径不匹配）'],
        ['archive/2026-10-10-docs_restructure/X.md', 'O3 含下划线 slug'],
        ['archive/2026-10-11-plan-v2-2/PROJECT.md', 'O4 合规 slug（既有能力，不许因收紧而丢）'],
      ]
      const D_SAFE_SAMPLES = [
        ['archive/<日期>-<名>/', 'N1 占位（含 `<` 与 CJK）—— 按设计不计'],
        ['archive/<YYYY-MM-DD-slug>/TASK.md', 'N2 占位（非数字日期）—— 按设计不计'],
        ['archive/DATE-NAME/', 'N3 描述性举例（目录名不是日期格式）—— 不匹配'],
        ['archive/2026-10-10-docs-restructure/X.md', 'N4 通配（`*`）—— 由调用方的 includes("*") 跳过，正则本身匹配'],
      ]
      let dBad = 0
      for (const [sample, why] of D_BITE_SAMPLES) {
        D_REF_RE.lastIndex = 0
        if (D_REF_RE.exec(sample) === null) {
          dBad++
          bad(`D 自带样本**没被咬**：${why} —— 样本 \`${sample}\` **没被 D 的正则匹配到**`
            + '\n      ⇒ 判据**过窄/改哑**：含这种 slug 的引用不会被核实 ⇒ D 对"写不出来的路径"无效'
            + '\n      ⇒ 这正是第 54 轮修的真缺口形态（`archive/2026-10-11-plan-v2.2/PROJECT.md` 曾一声不响）')
        }
      }
      for (const [sample, why] of D_SAFE_SAMPLES) {
        D_REF_RE.lastIndex = 0
        const hit = D_REF_RE.exec(sample)
        // ⚠ N4 是通配：正则**匹配**它（那是对的），由调用方按 `*` 跳过 ⇒ 只断言前三例。
        if (!why.startsWith('N4') && hit !== null) {
          dBad++
          bad(`D 自带样本**被误咬**：${why} —— 样本 \`${sample}\` 被 D 的正则匹配到 \`${hit[0]}\``
            + '\n      ⇒ 判据**过宽**：把占位 / 举例当成具名引用 ⇒ 文档记录判据边界会把自己打挂'
            + '（**E-114** 家族：第 26 轮实测事故）')
        }
      }
      if (dBad === 0) {
        ok(`D ✓ 自带样本：${D_BITE_SAMPLES.length} 个"该咬"的样本**全部匹配到**，`
          + `${D_SAFE_SAMPLES.length} 个"不该咬"的样本形态**全部未**被误咬（自带样本，不依赖正本内容）`)
      }
    }

    /**
     * ── 断言 D′：**作业书文件名引用**（`TASK-R*.md`）必须真的存在 ──────────────
     *
     * ⚠ 为什么要单独一支：这条**正是本轮缺陷的原形态** ——
     *   `CONTEXT.md` 曾写「各轮作业书（R21 系 / R22 系 / **R23 系**）」，
     *   而 `archive/` 下按 `TASK-R23` 通配**零命中**。⚠ 那种写法（"R23 系"）**不带 `.md` 后缀**，
     *   上面的 `archive/…` 正则**抓不到它**；但要防住这类错误，判据只能是
     *   「**写成文件名就必须存在**」（叙事里的"第 23 轮"不必有文件，
     *   可一旦落笔成 `TASK-R23.md` 就必须有 —— 见经验 E-113 的正确做法②）。
     *   ⇒ 本支扫**带 `.md` 后缀的 `TASK-R*` 具名引用**，逐条核实账本区里存在。
     *
     * ⚠ **判据：按 basename 在 archive 的各日期子目录下找**（不要求写全路径）——
     *   因为正本里引用作业书时通常只写文件名（如 `TASK-R21.md`），
     *   而它实际落在 `archive/<日期>-<名>/` 下；要求写全路径会把**正确写法**判成违规。
     *
     *   ⚠ **编号必须是数字**（`TASK-R\d+…`）—— 第 26 轮修出来的精度：
     *   原判据是 `TASK-R[A-Za-z0-9-]*\.md`，会把 `CONTEXT.md` / `DECISIONS.md` 里
     *   「⛔ 别为了齐整给每轮都编一个 `TASK-Rnn.md`」这句**反例示意名**判成"不存在的引用"。
     *   `Rnn` 不是文件名形态（真作业书是 `TASK-R21.md` / `TASK-R22-ADDENDUM.md`）⇒ 排除。
     *   ⚠ 同时排除 `TASK-R*.md`（含 `*`，通配不是具名物）。
     *   ⇒ 与 D 同一条原则：**分得清"引用"与"描述引用的散文"**。见 **E-114**。
     */
    const D_TASK_RE = /TASK-R\d+[A-Za-z0-9-]*\.md/g
    let tTotal = 0
    let tMissing = 0
    /** 账本区 `archive/` 下所有文件的 basename 集合（扫一次，供逐条比对）。 */
    const archiveBasenames = (() => {
      const set = new Set()
      try {
        for (const d of readdirSync(join(LEDGER_ROOT, 'archive'))) {
          let entries = []
          try { entries = readdirSync(join(LEDGER_ROOT, 'archive', d)) } catch { continue }
          for (const e of entries) set.add(e)
        }
      } catch { /* archive 不可读 ⇒ 空集（下面的比对会因此全部报"不存在"，宁可报也不静默） */ }
      return set
    })()
    const tPerFile = []
    for (const f of SCAN_FILES) {
      let src = ''
      // ⚠ 原口径：读不到 ⇒ `continue`（**不报**，与 D 支的 `bad()` 不同）—— 这一支**原样保留**，
      //   分文件计数只在"读到的那几份"上统计（读不到记 `null`，供输出行如实标注）。
      try { src = readFileSync(join(LEDGER_ROOT, f), 'utf8') } catch { tPerFile.push([f, null, null]); continue }
      let tFileHits = 0
      let tFileMissing = 0
      src.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(D_TASK_RE)) {
          const name = m[0]
          tTotal++
          tFileHits++
          if (!archiveBasenames.has(name)) {
            tMissing++
            tFileMissing++
            bad(`D 正本 ${f}:${i + 1} 引用了**不存在**的作业书：\`${name}\``
              + `\n      ⇒ 账本区 \`archive/*/\` 下没有这个 basename（实测 ${archiveBasenames.size} 个候选）`
              + '\n      ⇒ 写成文件名就**必须存在**：轮次号可以只叙事，但 `TASK-Rn.md` 是**具名物**'
              + `\n      ⇒ 核实方式：在 ${LEDGER_ROOT} 跑 \`ls archive/*/${name}\``)
          }
        }
      })
      tPerFile.push([f, tFileHits, tFileMissing])
    }
    if (tTotal === 0) {
      // ⚠ 同上：**无对象可查 ≠ 通过**，但不判 FAIL（如实打印读数）。
      //   ⚠ 措辞与收紧后的判据一致：认的是 `TASK-R<数字>…md`（不是任意 `TASK-R*`），
      //     否则读者会以为"我写了 `TASK-Rnn.md` 却没被查" —— 文案与实现必须相符。
      ok(`D′ ✓ ${SCAN_FILES.length} 份里**没有** \`TASK-R<数字>...md\` 形式的作业书文件名引用（0 处；`
        + '示意名如 `TASK-Rnn.md`、通配如 `TASK-R*.md` **按设计不计**）⇒'
        + ' 本支**无对象可查**（已扫描，非跳过）')
    } else if (tMissing === 0) {
      ok(`D′ ✓ ${SCAN_FILES.length} 份里的 ${tTotal} 处作业书文件名引用，**全部真实存在**`
        + `（按 basename 在 archive 的各日期子目录下比对，候选 ${archiveBasenames.size} 个）`)
    }
    // ⚠ R108 卡2「断言语义面收口」**只增输出**：D′ 的**分文件计数** —— 口径与 D 支一致
    //   （逐份「命中 N 处 / 缺失 M 处」，0 也照实打印；读不到的份照实标"读不到"）。
    //   ⛔ 不参与判据（FAIL 只由上面的 `bad()` / `tMissing` 决定），⛔ 不写死"预期 N"（E-117）。
    ok(`D′ ✓ 分文件计数（逐份，共 ${tPerFile.length} 份）：`
      + tPerFile.map(([f, h, m]) => (h === null
        ? `\n      · ${f} 读不到（本支原口径：读不到不报，仅不计）`
        : `\n      · ${f} 命中 ${h} 处 / 缺失 ${m} 处`)).join('')
      + '\n      （读数取自本次扫描，非文档写死的预期值）')

    /**
     * ── 断言 E：**元讨论容忍**（2026-10-10 新增 · 第 28 轮 · 采纳第 27 轮建议 2）────
     * **判据不许咬"描述它自己的文本"。**
     *
     * ── 为什么需要它（第 26 轮的实测事故）──────────────────────────────────
     *   D / D′ 上线一轮后，正本新增了「**描述这两条断言边界**」的文本
     *   （`archive/DATE-NAME/` 这类举例、`TASK-Rnn.md` 这类反例示意名），
     *   而**宽口径正则把它们当成了"不存在的引用"** ⇒ 断言**被描述自己的文本打挂**。
     *   ⚠ **必然性**：文档**要记录判据的边界**，"一旦记了就会触发它"
     *     ⇒ 这不是巧合，是**必现情形**（见 `EXPERIENCE.md` **E-114**）。
     *
     * ── 为什么必须"自带样本"（本组与第 27 轮那次第 4 组的**关键区别**）──────
     *   ⚠ 第 27 轮修复后，第 4 组是**直接用正本自带的文本**跑的
     *     ⇒ 它验证的只是"**当前那三行**"，**不是"任意举例形态"**；
     *     正本一旦改写或挪走那几行，**这条回归就静默失效**（而没人会知道）。
     *   ⇒ 本组把"**不该被当成引用**"的形状**硬编码为样本**，每次跑都验 ——
     *     验证的是**判据本身的性质**，**不依赖正本里恰好有什么**。
     *
     * ── 判据 ─────────────────────────────────────────────────────────────
     *   下面每个样本**必须不被** D / D′ 的正则匹配。
     *   任何一个被匹配 ⇒ **FAIL + exit 1**，并打印**哪条正则咬到哪个样本**。
     *   ⚠ 这是**反向保护**：它保的不是"正本内容对不对"（那是 D / D′ 的活），
     *     而是"**D / D′ 有没有退化成又会咬元讨论的宽口径**"。
     *   ⚠ **不能靠跑一遍正本来代替**：正本里此刻没有某类样本，
     *     不代表判据对它安全（第 26 轮就是这么栽的）。
     */
    const META_TOLERANCE_SAMPLES = [
      // ── 占位形态（描述"归档目录该长什么样"时必然出现）──
      ['archive/DATE-NAME/', '纯 ASCII 占位（第 26 轮实测：就是它把断言打挂的）'],
      ['archive/<日期>-<名>/', '含 `<` 与 CJK 的占位'],
      ['archive/<YYYY-MM-DD-slug>/TASK.md', '含 `<` 的占位路径 + 通用 TASK.md'],
      // ⚠ **刻意不放** `archive/2026-10-10-xxx/` 这类样本：它在**形状上**就是合法日期目录
      //   ⇒ D **应该**去核实它存在（不存在就 FAIL，那是**真违规**，不是元讨论）。
      //   把它塞进"容忍样本"等于要求断言放过真引用 —— 那是**放宽**，不是容忍。
      // ── 通配（描述"每轮作业书"时的省略写法）──
      ['TASK-*.md', '作业书通配'],
      ['TASK-R*.md', '作业书编号通配'],
      ['TASK-*-ADDENDUM.md', '附加件通配'],
      // ── 示意名（描述"别这么写"时的反例）──
      ['TASK-Rnn.md', '示意名：编号不是数字（第 26 轮实测的第二个命中）'],
      ['TASK-Rn.md', '示意名：单字母占位'],
    ]
    let eBad = 0
    for (const [sample, why] of META_TOLERANCE_SAMPLES) {
      // ⚠ 每次都要**重置 lastIndex**：这两个正则带 `g` 标志（有状态）。
      D_REF_RE.lastIndex = 0
      D_TASK_RE.lastIndex = 0
      const hitPath = D_REF_RE.exec(sample)
      const hitTask = D_TASK_RE.exec(sample)
      if (hitPath !== null || hitTask !== null) {
        eBad++
        const which = hitPath !== null ? 'D（路径）' : 'D′（作业书名）'
        const got = hitPath !== null ? hitPath[0] : hitTask[0]
        bad(`E 元讨论容忍**被破坏**：样本 \`${sample}\`（${why}）被**断言 ${which} 的正则咬到**`
          + `（匹配到 \`${got}\`）`
          + '\n      ⇒ 该样本**不是具名引用**，是**描述判据自身的文本** —— 不许当成引用'
          + '\n      ⇒ 这会让"文档记录判据边界"这一动作**把断言自己打挂**（第 26 轮实测事故，见 E-114）'
          + '\n      ⇒ 修法：判据要与既有权威口径同源（`archive/<YYYY-MM-DD-slug>/` / `TASK-R<数字>`），'
          + '别退回字符集宽口径')
      }
    }
    if (eBad === 0) {
      ok(`E ✓ 元讨论容忍：${META_TOLERANCE_SAMPLES.length} 个"不该被当成引用"的样本，`
        + '**全部未被** D / D′ 咬到（自带样本，不依赖正本内容）')
    }

    /**
     * ── 断言 L（2026-10-11 新增 · 第 78 轮 · UD-95 / CHG-032）：**索引两向完整** ──
     *
     * **为什么**：分卷后，"卷里有什么"与"索引里写了什么"是**两处事实**
     *   —— 只要没有东西钉住它们，**新增条目就会从索引里漏掉**（或索引点着一份不存在的文件），
     *   而全部检查照旧全绿（**E-133** 的实测形态）。
     *
     * **两向**：① 每卷**必须有** `INDEX.md`；② `INDEX.md` 点名的每份 `*.md` **必须真实存在**；
     *   ③ 卷内每份 `*.md`（除 `INDEX.md` 自身）**必须被 `INDEX.md` 点名**。
     *
     * ⚠ **卷根不存在 ⇒ 打印「未执行」并跳过**（迁移期的正常态，**不是放宽**）：
     *   本轮（机制轮）**明确不建 `volumes/`**，所以这里必然走这一支。
     *   ⚠ **但"卷根存在却没有卷"是另一回事** ⇒ **空卷/空卷根判 FAIL**
     *   （否则"扫 0 份然后报 ✓"就是**假绿**——正是 UD-95 点名要防的形态）。
     */
    // ⚠ 断言 M 也要看各 INDEX.md ⇒ 这个集合在 L 里收集、在 M 里消费。
    //   卷根不存在 ⇒ 保持为空（M 仍会查根上那几份，M 没有"跳过"档）。
    const indexNamesForM = []
    if (!VOLUME_FILES_RESULT.exists) {
      skipSink('L 【未执行】—— 卷根尚未建立，**不代表通过**'
        + `\n      ⇒ 口径：<账本根>/volumes/ 不存在时本断言跳过（迁移期正常态）`
        + `\n      ⇒ 原因：${VOLUME_FILES_RESULT.reason}`)
    } else {
      const volRoot = VOLUME_FILES_RESULT.volumesRoot
      const vols = VOLUME_FILES_RESULT.volumes ?? []
      if (vols.length === 0) {
        bad('L **卷根存在但一个卷目录都没有** —— 空卷根会让本断言"扫 0 份报 ✓"（假绿）'
          + `\n      ⇒ 卷根：${volRoot}`
          + '\n      ⇒ 要么**别建卷根**（迁移期就该不建），要么卷里得有真内容 —— ⛔ 不许建空壳')
      } else {
        let lBad = 0
        const indexNames = new Set()
        let indexedTotal = 0
        const listedInIndex = []
        // ⚠ 非「文件」列的 .md 提及（**提示用，不是 FAIL**）：0 处也要打印
        let outsidersTotal = 0
        const outsidersAll = []
        for (const vol of vols) {
          const volDir = join(volRoot, vol)
          const idxPath = join(volDir, 'INDEX.md')
          let idxSrc = ''
          try { idxSrc = readFileSync(idxPath, 'utf8') } catch { idxSrc = '' }
          if (idxSrc === '') {
            lBad++
            bad(`L 卷 \`${vol}\` **缺 INDEX.md**（或读不到）：${idxPath}`
              + '\n      ⇒ 每卷必须有自己那份索引（UD-95 / CHG-032 的目标形态）')
            continue
          }
          indexNames.add(`volumes/${vol}/INDEX.md`)
          indexNamesForM.push(`volumes/${vol}/INDEX.md`)
          // ② 索引点名的 *.md 必须真实存在
          let entries = []
          try {
            entries = readdirSync(volDir, { withFileTypes: true })
              .filter((d) => d.isFile() && d.name.endsWith('.md'))
              .map((d) => d.name)
          } catch { entries = [] }
          const realSet = new Set(entries)
          const named = new Set()
          /**
           * ── 点名面**只认表格「文件」列**（2026-10-11 · 第 80 轮收紧）────────────────
           * **改前**：通扫整份 `idxSrc` 里任何 `xxx.md` ⇒ **标题里顺带写个文件名就会被咬**，
           *   于是内容被迫**为通过而变形**（实测：`AGENTS.md` 被写成 `AGENTS`）。
           *   ⚠ 那正是本仓禁止的形态 —— **判据过宽 ⇒ 反过来塑造内容**。
           * **改后**：逐行解析 `|` 表格，**只取最后一格**里反引号包裹的 `*.md`。
           *   ⛔ 不再通扫全文。⚠ 非表格行 / 其它格里的提及**改走提示**（见下方 `outsiders`），
           *   **信息不许被一起收掉**。
           */
          const tableRows = []
          const outsiders = []
          idxSrc.split('\n').forEach((ln, li) => {
            const lineNo = li + 1
            const isTable = ln.trimStart().startsWith('|') && ln.trim().endsWith('|')
            if (!isTable) {
              // 非表格行：其中的 .md 提及全部计入"非文件列"
              for (const m of ln.matchAll(/[A-Za-z0-9._-]+\.md/g)) {
                if (m[0] !== 'INDEX.md') outsiders.push({ lineNo, name: m[0] })
              }
              return
            }
            const cells = ln.trim().slice(1, -1).split('|').map((c) => c.trim())
            const last = cells[cells.length - 1] ?? ''
            // 点名对象 = 最后一格里**反引号包裹**的 *.md
            const inFileCell = [...last.matchAll(/`([A-Za-z0-9._/-]+\.md)`/g)]
              .map((m) => m[1].split('/').pop())
            // 表头行 / 分隔行（分隔行形如 |---|---|）
            const isSep = cells.every((c) => /^:?-{2,}:?$/.test(c))
            const isHeader = cells[0] === '编号'
            if (!isSep && !isHeader && inFileCell.length > 0) {
              tableRows.push({ lineNo, cells, fileCell: last, names: inFileCell })
            } else if (!isSep && !isHeader) {
              // 有内容但文件格没给反引号文件名 ⇒ 也记提示
              for (const m of ln.matchAll(/[A-Za-z0-9._-]+\.md/g)) {
                if (m[0] !== 'INDEX.md') outsiders.push({ lineNo, name: m[0] })
              }
            }
            // 除最后一格之外的所有格里，若有 .md 提及 ⇒ 提示
            const others = cells.slice(0, -1).join(' | ')
            for (const m of others.matchAll(/[A-Za-z0-9._-]+\.md/g)) {
              if (m[0] !== 'INDEX.md') outsiders.push({ lineNo, name: m[0] })
            }
          })
          for (const row of tableRows) {
            for (const nm of row.names) {
              named.add(nm)
              listedInIndex.push(`volumes/${vol}/${nm}`)
              indexedTotal++
              if (!realSet.has(nm)) {
                lBad++
                bad(`L 索引点名了**不存在的文件**：volumes/${vol}/${nm}`
                  + `\n      ⇒ 索引：${idxPath}（第 ${row.lineNo} 行）`
                  + `\n      ⇒ 该卷实际有：${entries.length === 0 ? '（无）' : entries.join(' · ')}`)
              }
              /**
               * ── 正向对账：行内「编号」列必须与文件名主干一致 ──────────────────────────
               * `CHG-017` ↔ `CHG-017.md`。**不一致 ⇒ FAIL**（含两侧实值）。
               * **为什么**：只查"点名的文件在不在"是**单向**的 —— 编号写错、文件名写对，
               *   那份文件照样"存在"，索引却**指着一份对不上号的记录**。
               *   ⚠ 判据精度靠这一条补齐（点名面收窄后，必须同时加一条正向核）。
               */
              const numCell = (row.cells[0] ?? '').replace(/`/g, '').trim()
              const stem = nm.replace(/\.md$/, '')
              if (numCell !== '' && numCell !== stem) {
                lBad++
                bad(`L 索引第 ${row.lineNo} 行**编号与文件名主干不一致**：`
                  + `编号列 \`${numCell}\` ↔ 文件列 \`${nm}\``
                  + `\n      ⇒ 索引：${idxPath}`
                  + '\n      ⇒ 两列必须对得上（`CHG-017` ↔ `CHG-017.md`）—— 否则索引指着一份对不上号的记录')
              }
            }
          }
          /**
           * ── 提示（**不是 FAIL**）：非「文件」列出现的 `.md` 提及**逐条列出行号** ──────
           * ⚠ **0 处也要打印** —— "没有"与"没查"必须可区分（收紧扫描面**不许把信息一起收掉**）。
           */
          outsidersTotal += outsiders.length
          for (const o of outsiders) {
            outsidersAll.push(`volumes/${vol}/INDEX.md:${o.lineNo} → \`${o.name}\``)
          }
          // ③ 卷内每份 *.md（除 INDEX.md）必须被索引点名
          for (const nm of entries) {
            if (nm === 'INDEX.md') continue
            if (!named.has(nm)) {
              lBad++
              bad(`L 卷 \`${vol}\` 里的 \`${nm}\` **没有被 INDEX.md 点名**`
                + `\n      ⇒ 索引：${idxPath}`
                + '\n      ⇒ 新增条目必须同步写入该卷索引（否则它从此无人发现）')
            }
          }
          if (entries.length <= 1) {
            lBad++
            bad(`L 卷 \`${vol}\` 是**空卷**（除 INDEX.md 外没有任何条目）`
              + `\n      ⇒ 空卷 = "扫 0 份报 ✓" 的假绿源头（UD-95 明确要防）`)
          }
        }
        if (lBad === 0) {
          // ⚠ 构成标注（第 83 轮 · R82 复核 D6）：本行数的是**条目**（只数表格「文件」列），
          //   ⛔ 不含各卷的 `INDEX.md`，也⛔ 不含根上的地图 —— 与 M 的分母**不同**，
          //   并排出现时容易被当成同一个集合在变 ⇒ 各自写清构成。
          ok(`L ✓ 索引两向完整：${vols.length} 个卷 · 索引点名 ${indexedTotal} 份，`
            + '**全部真实存在**；卷内每一份（除 INDEX.md）**都被索引点名**')
          ok(`     构成（L 的分母 = **条目**）：卷内条目 ${indexedTotal} 份`
            + `（不含 ${vols.length} 个 \`INDEX.md\`，也不含根上地图）——`
            + ` ⚠ 它与 M 的分母（地图 + 卷内全部 \`.md\`）不是同一个集合，别并排比`)
        }
        // ⚠ 提示（不是 FAIL）：非「文件」列的 .md 提及 —— **0 处也打印**（"没有"与"没查"可区分）
        if (outsidersTotal === 0) {
          ok('L 提示：非「文件」列的 `.md` 提及 **0 处**（已逐行扫描全部索引；'
            + '点名面 = 表格最后一格的反引号 `*.md`）')
        } else {
          ok(`L 提示：非「文件」列的 \`.md\` 提及 **${outsidersTotal} 处**（**不计入失败**，仅供人工核对是否该改成点名）：`
            + outsidersAll.map((s) => `\n        · ${s}`).join(''))
        }
      }
    }

    /**
     * ── 断言 M（2026-10-11 新增 · 第 78 轮 · UD-95 / CHG-032）：**每份 ≤ 读上限** ──
     *
     * **为什么**：读上限 65536 是**默认读取路径**的门槛 —— 超限时
     *   `read_contracts` 给的是**截断视图**（默认路径只给部分信息），而**没有任何东西报警**。
     *   现有机检一条都不看字节数 ⇒ 允许写出"自己读不完的账本"。
     *
     * ⚠ **上限值从预设行读**（`preset/dsh-hob/preset-dsh-hob.patch.yml` 的 `maxFileBytes`，
     *   与 `LEDGER_ROOT` 解析**同一处读法**）—— ⛔ **不硬编码**：硬编码会在预设改值的当天过期，
     *   而且**过期后它会主动制造假冲突**（**E-117**）。
     * ⚠ **读不到上限 ⇒ FAIL**（"判不出"不许静默）。⚠ **M 没有"跳过"档** ——
     *   根上那几份**任何时候都要查**（它们是否存在与卷根无关）。
     *
     * ── ⚠ ⚠ **第 220 轮扩范围（`UD-117` 第 ⑤ 组）：账本侧 + 骨架侧都进扫描面** ──────────
     * **背景（第 217 轮读实现实测）**：本条原先只取 `B_FILES + 卷内 + 卷索引`
     *   ⇒ ⚠ ⚠ **`.hob/**` 撞上限时不会有任何红**（⚠ 该轮**正是靠人工算余量才发现的**）。
     * **做法**：把骨架侧的 `.md` 也纳入同一个循环 —— ⚠ **判据面与账本侧逐条一致**
     *   （同一条 `bad` 文案 · 同一个 `limit` · ⛔ **不是两套口径**）。
     * ⚠ ⚠ **成员清单派生**（⛔ 不手抄数组）：走 `collectSkeletonMdFiles()`，从
     *   `<root>/.hob` 实测递归取 `*.md`；⚠ **空结果 ⇒ FAIL**（**E-126** 假绿）。
     *
     * ⚠ ⚠ **据实说明：`.hob/EXPERIENCE.md` 与 `.hob/experience/**`（记录层）进这个圈** ——
     *   **理由**：⚠ 它们**同样走 `read_contracts` 那条默认读取路径**（`readMarkdownCapped`
     *   按 `maxFileBytes` 截断，与账本侧**同一个上限、同一个函数**）⇒
     *   ⚠ **超限的后果一模一样**（给的是截断视图，而没有任何东西报警）。
     *   ⚠ **且账本侧那几份正本（`CONTEXT.md` 等）本身也是"记录性"文件，它们本来就进来了** ⇒
     *   ⚠ **若把记录层排除出去，同一后果会在两侧得到不同待遇**（⚠ 那正是本组要治的分叉）。
     *   ⚠ **代价照实写**：⚠ 记录层**只增不改**（历史读数保留）⇒ ⚠ **它一旦接近上限，
     *   处置办法⛔ 不是"删旧读数"**（那会撞 `E-142`：核的对象悄悄变少）⇒
     *   ⚠ **应当按族再分册 / 另起索引**（⚠ 与 `.hob/README.md` §5.2 末节同一套办法）。
     *   ⚠ **在扩范围之前，这一侧 ⛔ 无人盯**（这就是本组要补的洞）。
     */
    {
      let limit = NaN
      try {
        const preset = readFileSync(join(root, 'preset', 'dsh-hob', 'preset-dsh-hob.patch.yml'), 'utf8')
        const m = /maxFileBytes:\s*(\d+)/.exec(preset)
        if (m !== null) limit = Number(m[1])
      } catch { /* 下面统一判 FAIL */ }
      if (!Number.isFinite(limit) || limit <= 0) {
        bad('M **读不到读上限**（`maxFileBytes`）⇒ 本断言判不了（不按通过处理）'
          + '\n      ⇒ 期望位置：preset/dsh-hob/preset-dsh-hob.patch.yml 的 `maxFileBytes`'
          + '\n      ⇒ ⛔ 不硬编码上限：判不出就必须 FAIL，不许静默 —— 那正是本断言要防的形态')
      } else {
        // 对象 = 地图（B_FILES） + 卷内文件 + 各 INDEX.md
        //   ⚠ `indexNamesForM` 由断言 L 收集（卷根不存在时为空集）——
        //     它与 `VOLUME_FILES_RESULT.files` 有重叠（INDEX.md 也在卷文件清单里），
        //     故下面用 `new Set(...)` 去重，⛔ 不重复计数。
        const mTargets = [...new Set([...B_FILES, ...VOLUME_FILES_RESULT.files, ...indexNamesForM])]
          .sort()
        // ⚠ ⚠ 第 220 轮：骨架侧进同一个循环（⛔ 不另起一套口径）
        const skelResult = collectSkeletonMdFiles()
        if (skelResult.files.length === 0) {
          // ⚠ **空结果 ⇒ FAIL**（E-126）：⛔ 不许"扫 0 份然后报 ✓"
          bad('M **骨架侧扫描面为空** ⇒ 本组对 `.hob/**` 的覆盖**不成立**（不按通过处理）'
            + `\n      ⇒ 期望：\`<工作区>/.hob\` 下递归存在 \`*.md\`；实测 ${skelResult.files.length} 份`
            + `\n      ⇒ 原因：${skelResult.reason}`
            + '\n      ⇒ ⛔ 绝不把"0 份"当"都合规"（这正是 E-126 的假绿形态）')
        }
        const sizes = []
        const skelSizes = []
        let mBad = 0
        for (const f of mTargets) {
          let sz = -1
          try { sz = statSync(join(LEDGER_ROOT, f)).size } catch { sz = -1 }
          if (sz < 0) {
            mBad++
            bad(`M **读不到**：${f} —— 大小判不了（不按通过处理）`)
            continue
          }
          sizes.push(`${f}=${sz}`)
          if (sz > limit) {
            mBad++
            bad(`M **超过读上限**：\`${f}\` —— 实测 ${sz} 字节，上限 ${limit} 字节`
              + `（超 ${sz - limit} 字节）`
              + '\n      ⇒ 超限后 `read_contracts` 给的是**截断视图**（默认路径只给部分信息）'
              + '\n      ⇒ 处置：按 UD-95 / CHG-032 拆成多卷，⛔ 不是压缩（压必然丢信息）')
          }
        }
        // ⚠ 骨架侧：**逐条与账本侧同口径**（同一条 bad 文案、同一个 limit）
        for (const f of skelResult.files) {
          let sz = -1
          try { sz = statSync(join(root, f)).size } catch { sz = -1 }
          if (sz < 0) {
            mBad++
            bad(`M **读不到**（骨架侧）：${f} —— 大小判不了（不按通过处理）`)
            continue
          }
          skelSizes.push(`${f}=${sz}`)
          if (sz > limit) {
            mBad++
            bad(`M **超过读上限**：\`${f}\` —— 实测 ${sz} 字节，上限 ${limit} 字节`
              + `（超 ${sz - limit} 字节）`
              + '\n      ⇒ ⚠ **这一侧原先 ⛔ 不在扫描面内**（第 217 轮读实现实测）⇒ 撞上限不会有任何红'
              + '\n      ⇒ 超限后 `read_contracts` / `hob_read_doc` 给的是**截断视图**（同一条默认读取路径）'
              + '\n      ⇒ 处置：⚠ 骨架侧⛔ 不可"压缩"（压必然丢信息）⇒ 按族**整块搬走 + 原位留指针**'
              + '（先例：`.hob/README.md` §5.2 → `.hob/drafts/discipline-details.md` · 第 217 轮）')
          }
        }
        if (mBad === 0) {
          // ⚠ 构成标注（第 83 轮 · R82 复核 D6）：本行的分母 = **地图 + 卷内全部 .md**，
          //   与 L 的分母（只数条目）**不同** ⇒ 各自写清，防并排误读。
          const mapN = B_FILES.length
          const volAllN = (VOLUME_FILES_RESULT.files ?? []).length
          const volIdxN = indexNamesForM.length
          const volEntryN = volAllN - volIdxN
          ok(`M ✓ 读上限：${mTargets.length} 份**全部在内**（上限 ${limit} 字节，实测逐份：${sizes.join(' · ')}）`)
          ok(`     构成（M 的分母 = **地图 + 卷内全部 \`.md\`**）：地图 ${mapN} 份 + 卷内条目 ${volEntryN} 份`
            + ` + 卷索引 ${volIdxN} 份 = ${mTargets.length} ——`
            + ` ⚠ 与 L 同口径的只有"卷内条目 ${volEntryN}"；`
            + ` L 另外不数那 ${volIdxN} 个卷索引、也不数那 ${mapN} 份地图`)
          // ⚠ 骨架侧**独立一行**（⛔ 不并进上面那行：两侧根不同、口径要能分开读）
          ok(`M ✓ 读上限（**骨架侧** \`.hob/**\` · 第 220 轮扩范围）：${skelResult.files.length} 份`
            + `**全部在内**（同一个上限 ${limit} 字节；逐份：${skelSizes.join(' · ')}）`)
        } else {
          // ⚠ **有超限时也把逐份读数打出来** —— 否则"哪几份接近上限"这个
          //   决定拆分优先级的信息就丢了（第 78 轮追加说明明确要这组读数）。
          ok(`M 读上限（${limit} 字节）逐份实测：${sizes.join(' · ')}`
            + `\n      ⇒ 其中 ${mBad} 项未过（见上面的 ✗ 行）`)
          if (skelSizes.length > 0) {
            ok(`M 读上限（${limit} 字节）**骨架侧**逐份实测：${skelSizes.join(' · ')}`)
          }
        }
        // ⚠ ⚠ **① 正本余量进收尾读数**（`UD-117` 第 ① 组）：⚠ ⛔ 不写死数字（**E-117**）·
        //   ⚠ **上限一律从预设行读**（上面的 `limit` 就是读出来的）。
        //   ⚠ 读法 = **按"距上限还剩多少字节"升序**（最紧的排前面）⇒ 一眼看出"谁快到了"。
        //   ⚠ 两侧都给；⛔ 不只报"没超限"。
        {
          const withHead = [
            ...sizes.map((s) => {
              const i = s.lastIndexOf('=')
              return { f: s.slice(0, i), sz: Number(s.slice(i + 1)), side: '账本侧' }
            }),
            ...skelSizes.map((s) => {
              const i = s.lastIndexOf('=')
              return { f: s.slice(0, i), sz: Number(s.slice(i + 1)), side: '骨架侧' }
            }),
          ].filter((x) => Number.isFinite(x.sz) && x.sz >= 0)
          withHead.sort((a, b) => (limit - a.sz) - (limit - b.sz))
          const topN = withHead.slice(0, 5)
            .map((x) => `${x.f} 还剩 ${limit - x.sz}`).join(' · ')
          const minOne = withHead[0]
          ok(`M 余量（① 第 220 轮新增 · 上限读自预设行 ${limit} 字节）：核 ${withHead.length} 份`
            + `（账本侧 ${sizes.length} 份 + 骨架侧 ${skelSizes.length} 份）——`
            + ` ⚠ **最紧的 ${Math.min(5, withHead.length)} 份**：${topN}`
            + `\n      ⇒ 最紧 = \`${minOne.f}\`（${minOne.side}）：还剩 **${limit - minOne.sz}** 字节`
            + `\n      ⇒ ⚠ 这一行只报读数，⛔ 不判红（判红由上面的超限分支负责）；`
            + ` ⚠ 它的用处 = **"还差多少"可读**，⛔ 不是"没超限就没事"`
            + `（先例：第 217 轮靠人工算"余量 2762 < 上一轮消耗 3131"才发现要腾）`)
        }
      }
    }
  }
}

/**
 * ── 断言 P（2026-10-14 新增 · 第 131 轮 · 用户授权）：**表结构完整性** ──────────
 *
 * ── 为什么是它（两条出处都是实测，不是推测）────────────────────────────
 *   · **P1 表内重复行**：第 124 轮实测（R124）**真发生过一回**，靠人当场自查发现；
 *     且第 125 / 126 轮的报告**两度把它登记为「仍属人守」**（无任何机检保它）——
 *     即：**这是一条被反复承认的观测盲区**，正是 §10.5「会让真实缺陷静默逃逸」那一档。
 *   · **P2 表结构（分隔行在位）**：2026-10-14 探针实测 —— 两份卷索引里**共 5 处**
 *     表行被空行夹成"孤立块"⇒ 缺分隔行 ⇒ **在 markdown 里不渲染成表**。
 *     内容还在（所以任何查内容的断言都不报），**形态静默失效** —— 同一档。
 *
 * ── 判据口径（只认可判的形态，⛔ 不判"内容写得好不好"）──────────────────
 *   · P1：同一张表内，两行**归一化后逐字相同** ⇒ 报出（并指出与哪一行重复）。
 *   · P2：一个表块的第 2 行**必须是分隔行**（`|---|---|`）；
 *     块只有 1 行 ⇒ 报"孤立表行"（它必是缺分隔行的那一类）。
 *   ⚠ **归一化**：去加粗 / 去反引号 / 去空白 —— 否则"标点重排"会假阳。
 *   ⚠ **围栏代码块内不扫**（与断言 E / I 同口径）：文档要能安全地**讲"表格怎么写"**。
 *   ⚠ **豁免只到"不渲染"这一层，不延展** —— ⛔ 不引入"是否该有这一行"之类不可判的问题。
 *
 * ── 覆盖面（照实登记，见 `.hob/README.md` §1.4）─────────────────────────
 *   · **在辖**：`## ` 级文件（地图 + 卷内全部 `.md`）**正文里**的管道表。
 *   · **不在辖**：`.hob/**`（骨架层 —— ⚠ **已知边界**，与断言 D / D′ 同；
 *     扩到骨架**须先处理"举例式占位"豁免**，另议）。
 *   · **不判**：列数是否一致、表头语义、行序 —— 那些不可判 / 会假阳。
 */
export function runTableIntegrity({ bad, ok }) {
  /** 切表块：连续以 `|` 开头的行 = 一个块（围栏内跳过）。 */
  const pSplitTables = (src) => {
    const lines = src.split('\n')
    const tables = []
    let fence = false
    let i = 0
    while (i < lines.length) {
      if (/^\s*```/.test(lines[i])) { fence = !fence; i++; continue }
      if (fence) { i++; continue }
      if (!lines[i].trim().startsWith('|')) { i++; continue }
      const startLine = i + 1
      const rows = []
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(lines[i]); i++ }
      tables.push({ startLine, rows })
    }
    return tables
  }
  const pIsSep = (l) => /^\|[\s:|-]+\|$/.test(l.trim())
  const pNorm = (l) => l.trim().replace(/[`*]/g, '').replace(/\s+/g, '')
  /** 纯函数：吃内容吐问题清单 —— 自带样本可在内存里造，⛔ 不必真改仓库文件。 */
  const pScan = (src) => {
    const dup = []
    const sepr = []
    for (const t of pSplitTables(src)) {
      if (t.rows.length === 1) {
        sepr.push({ line: t.startLine, why: '孤立表行（前后被空行夹住 ⇒ 该块无分隔行）' })
      } else if (!pIsSep(t.rows[1])) {
        sepr.push({ line: t.startLine + 1, why: '第 2 行不是分隔行' })
      }
      const seen = new Map()
      t.rows.forEach((r, idx) => {
        if (pIsSep(r)) return
        const k = pNorm(r)
        if (seen.has(k)) {
          dup.push({ line: t.startLine + idx, firstLine: t.startLine + seen.get(k), text: r.trim().slice(0, 90) })
        } else seen.set(k, idx)
      })
    }
    return { dup, sepr, tables: pSplitTables(src).length }
  }

  let pBad = 0
  let pTables = 0
  for (const f of SCAN_FILES) {
    let src = ''
    try { src = readFileSync(join(LEDGER_ROOT, f), 'utf8') } catch { continue }
    const { dup, sepr, tables } = pScan(src)
    pTables += tables
    for (const d of dup) {
      pBad++
      bad(`P1 表内重复行：${f}:${d.line}` + `\n        ${d.text}`
        + `\n      ⇒ 与第 ${d.firstLine} 行**逐字重复**（归一化后）`
        + '\n      ⇒ 本类**第 124 轮真发生一回**，当时靠人自查；第 125 / 126 轮报告**两度登记为"仍属人守"**'
        + '\n      ⇒ 修法：删掉多出来的那一行（⛔ 别"改个措辞让它看起来不同"）')
    }
    for (const s of sepr) {
      pBad++
      bad(`P2 表结构：${f}:${s.line} —— ${s.why}`
        + '\n      ⇒ 该块在 markdown 里**不渲染成表**（内容还在，**形态静默失效**）'
        + '\n      ⇒ 修法：把夹在中间的空行去掉，让它回到所属表块；或补上表头 + 分隔行')
    }
  }
  if (pTables === 0) {
    bad('P **没有扫到任何表块** ⇒ 「表结构完整性」无从判定（不按通过处理）')
  }

  // ── P 的自带样本（**内存里造**，⛔ 不碰仓库文件 ⇒ 无"改了忘了还原"）──
  {
    const GOOD = '| a | b |\n|---|---|\n| x | y |\n'
    const DUP = '| a | b |\n|---|---|\n| x | y |\n| **x** | `y` |\n'
    const LONE = '| a | b |\n\n| x | y |\n'
    const FENCED = '```\n| a | b |\n| x | y |\n```\n'
    const FENCED_DUP = '```\n| a | b |\n|---|---|\n| x | y |\n| x | y |\n```\n'
    const probes = [
      ['① 正常表（**不该被咬**）', () => pScan(GOOD).dup.length === 0 && pScan(GOOD).sepr.length === 0],
      ['② 表内重复行（**该被咬**）', () => pScan(DUP).dup.length === 1],
      ['③ 孤立表行（**该被咬**）', () => pScan(LONE).sepr.length === 2],
      ['④ 围栏内的坏表（**不该被咬** —— 文档要能讲怎么写）', () => pScan(FENCED).sepr.length === 0],
      ['⑤ 围栏内的重复行（**不该被咬**）', () => pScan(FENCED_DUP).dup.length === 0],
    ]
    let pSampleBad = 0
    for (const [why, fn] of probes) {
      let bit = false
      try { bit = fn() } catch { bit = false }
      if (!bit) {
        pSampleBad++
        bad(`P 自带样本**不符合预期**：${why}`
          + '\n      ⇒ 与 I / N 组同法：**判据改哑与判据改对必须输出不同**（E-126）——'
          + '\n        只验"该咬的"，会把"判据改哑"与"判据改对"变成同样输出')
      }
    }
    if (pSampleBad === 0) {
      ok('P ✓ 自带样本：5 组（正常表 / 重复行 / 孤立行 / 围栏内坏表 / 围栏内重复行）'
        + '**全部符合预期**（2 组"该咬"真被咬 · 3 组"不该被咬"真没被咬）⇒ 本组还长着牙且不过咬')
    }
  }

  if (pBad === 0 && pTables > 0) {
    ok(`P ✓ 表结构完整性：${SCAN_FILES.length} 份（地图 + 卷）里 ${pTables} 张表 ——`
      + ' **表内无重复行**；**每张表的分隔行在位**（无孤立表行）')
  }
}

/** 断言 I：正本无未渲染占位标记（需 `await import` 渲染器 ⇒ async）。 */
export async function runResidualMarkers({ bad, ok }) {  // ── 断言 I · 正本无残留标记（2026-10-11 新增 · 第 47 轮 · 结构改造④）────────
  /**
   * **正本里不得存在未渲染的占位标记**（清单派生自账本根，见 `derivePrimaryFiles()`）。
   *
   * ── 为什么这条是"结构性拒绝"的**另一半** ────────────────────────────────
   *   渲染器对"做不到的渲染"（自引用 / 父目录 / 目标不存在 …）采取**只提示、不拒写**
   *   —— 与结构改造① 的既有口径一致。⇒ 于是**非法状态仍然写得进去**：
   *   标记会**留在正本里**，而"它本该是个数字"这件事**没人看得见**。
   *   ⇒ 本条把那个状态**变成机检能当场抓住的 FAIL**：
   *     "渲染被拒绝"与"正本里有残留标记"由此**一一对应**，跳过不了。
   *
   * ⚠ **判据与渲染器同源**：用 `hob-render.ts` 的 `scanMarkers`（**含围栏豁免**）。
   *   若这里自己写一套正则，就会出现"文档里写的例子合法、机检却报残留"的自相矛盾。
   * ⚠ **空态给读数**（正本里没有标记是**正常状态**，不是"没查"）。
   */
  if (LEDGER_ROOT === undefined) {
    skipSink('I ✓ 正本无残留标记【跳过】—— 账本区读不到（工作区之外），**不代表通过**'
      + '（跳过位置：scripts/check-gitignore.mjs 的 LEDGER_ROOT 解析）')
  } else {
    const RENDER_TS_I = join(root, 'src', 'server', 'hob-render.ts')
    let scan = null
    try {
      const { pathToFileURL } = await import('node:url')
      scan = (await import(pathToFileURL(RENDER_TS_I).href)).scanMarkers
    } catch (e) {
      bad(`I 无法加载渲染模块（${String(e?.message ?? e)}）⇒ 残留标记扫描失去基准（不按通过处理）`)
    }
    /**
     * ⚠⚠ **`else` 分支是本批补的（2026-10-21 · 第 327 轮 · **乙-4**）** ────────────────
     *
     * ── 改前的病灶（`PROJECT-SURVEY-3` §6.1 乙-4，梳理报告原话判它是
     *    「**本路找到的最干净的假绿洞**」）──────────────────────────────────────
     *   这里只有 `if (typeof scan === 'function') { … }`，**没有 `else`**。
     *   ⚠ 上一支（`catch`）确实会 `bad('I 无法加载渲染模块…')`，而它**只接住 `import` 抛错**；
     *     `scan` 拿到一个**非函数**（导出被改名 / 改成常量 / 被 tree-shake 掉）时，
     *     `catch` **不触发**、`if` 也不进 ⇒ ⚠ **I 组整组静默消失**：
     *     既无 `bad`、也无 `ok`，**一行输出都没有**，退出码照旧 0。
     *
     * ── 为什么这比"报 ✓"更难发现 ──────────────────────────────────────────
     *   "报 ✓"至少**有那一行**，读的人还能看见"I 组跑了、说没问题"；
     *   而整组消失时，**输出里连 I 组的存在痕迹都没有** —— ⚠ 没人会去数"本该有几组"。
     *   这是 `E-126`（判据改哑 vs 判据改对必须输出不同）的**最纯形态**：
     *     改哑之后，两者的输出**完全相同**（都没有那一行）。
     *
     * ── 现在 ──────────────────────────────────────────────────────────────
     *   `scan` 不是函数 ⇒ **必须落 `bad`**（点名"I 组判据函数缺失 ⇒ 本组一条都没跑"）。
     *   ⛔ 不许落 `ok`、⛔ 不许沉默跳过（TASK 明令）。
     *   ⚠ 判据**不只是退出码**：必须打印**可读断言行**（`E-112`）。
     */
    if (typeof scan === 'function') {
      const hits = []
      for (const f of SCAN_FILES) {
        let src = ''
        try { src = readFileSync(join(LEDGER_ROOT, f), 'utf8') } catch {
          bad(`I 正本读不到：${join(LEDGER_ROOT, f)} —— 残留标记扫描失去基准（不按通过处理）`)
          continue
        }
        for (const h of scan(src)) {
          hits.push(`${f}:${h.line} \`${h.raw}\``)
        }
      }
      if (hits.length === 0) {
        ok(`I ✓ ${SCAN_FILES.length} 份里**没有**未渲染的占位标记（逐份扫描，命中 0 处）`
          + ' ⇒ "渲染被拒绝"不会悄悄留在正本里（渲染器的"只提示、不拒写"由此有了收尾兜底）')
      } else {
        bad(`I ${SCAN_FILES.length} 份里存在**未渲染的占位标记**（${hits.length} 处）：${hits.join(' · ')}`
          + '\n      ⇒ 标记没被渲染成实值就落盘了（渲染被拒绝，或写入绕过了渲染器）'
          + '\n      ⇒ 处置：看写入返回值里的「读数**未渲染**」清单（含行号 + 理由），'
          + '改成可渲染的表述（最常见：目标是**该文件自身**取 `bytes`，或**其父目录**取 `count` —— 两者结构上不可能）'
          + '\n      ⇒ ⛔ 不许为本条放宽判据、也不许把标记留在正本里当"待办"')
      }

      // ── 断言 I 的「不该被咬 / 该咬的仍要咬」自带样本（2026-10-11 · 第 50 轮）────
      /**
       * ⚠ **补齐 `README §1.4` 的既有纪律**：新增"扫原文里的引用"的断言，
       *   **必须自带"不该被咬"的样本**。断言 I 第 47 轮上线时**缺了这一组**，
       *   于是第 49 轮被**真实文档**引爆（Hob 在 `CONTEXT.md` 复述标记形态，见 **E-125**）。
       *
       * ⚠ **样本写死在断言里**（学**断言 E** 的做法）：⛔ **不写进正本** ——
       *   否则就是"又拿真实文档当样本"，同一个坑会再踩一次。
       *
       * ⚠ **正向 + 反向都要有**：只验"不该咬的不咬"、不验"该咬的还咬不咬"，
       *   等于**把判据改哑**（豁免写宽到放过裸写，照样全绿）。
       */
      const TICK = '`'
      const IM = '<!-- hob:bytes | PROJECT.md -->'
      const I_EXEMPT_SAMPLES = [
        [TICK + TICK + TICK + '\n' + IM + '\n' + TICK + TICK + TICK,
          'S1 围栏内（块级豁免，与 H5 同口径）'],
        [TICK + IM + TICK, 'S2 行内反引号（第 50 轮新增的 code span 豁免）'],
        [TICK + TICK + TICK + IM + TICK + TICK + TICK,
          'S3 三反引号串内（长度匹配即配对，CommonMark 口径）'],
      ]
      const I_BITE_SAMPLES = [
        [IM, 'S4 裸写 —— **必须被咬**（正面对照：判据还长着牙）'],
        [TICK + IM, 'S5 未闭合反引号 ⇒ 行尾不豁免（**宁可多咬不可漏咬**）'],
        [TICK + 'x' + IM, 'S6 半截裸写（标记只起点在代码段内）⇒ 仍被咬'],
        [IM + ' 和 ' + TICK + IM + TICK, 'S7 段外裸写 + 段内引用同一行 ⇒ 恰好咬 1 处'],
        [TICK + TICK + IM + TICK, 'S8 长度不匹配（双开单闭）⇒ 不算配对 ⇒ 仍被咬'],
      ]
      let iBad = 0
      for (const [sample, why] of I_EXEMPT_SAMPLES) {
        const n = scan(sample).length
        if (n !== 0) {
          iBad++
          bad(`I 豁免样本**被咬**：${why} —— 期望 0 处命中，实测 ${n} 处`
            + '\n      ⇒ "形状上可排除"的写法却仍被当成残留 ⇒ 文档一旦引用这个形态就被自己打挂'
            + '\n      ⇒ 这正是 **E-125**（第 49 轮真实文档引爆）要治的病')
        }
      }
      for (const [sample, why] of I_BITE_SAMPLES) {
        const n = scan(sample).length
        if (n === 0) {
          iBad++
          bad(`I 对照样本**没被咬**：${why} —— 期望 ≥1 处命中，实测 0 处`
            + '\n      ⇒ 豁免被写**过宽**，把**真残留**也放过了 ⇒ 断言 I **失效**'
            + '\n      ⇒ ⚠ 这不是"放宽"，是**判据改哑**：裸写标记会静默留在正本里而无人可见'
            + '\n      ⇒ 修法：豁免只能加在"**形状可排除**"的一侧（围栏内 / 行内代码段内），'
            + '**裸写的标记必须照旧被判**')
        }
      }
      if (iBad === 0) {
        ok(`I ✓ 自带样本：${I_EXEMPT_SAMPLES.length} 个"不该被咬"的样本**全部未**被咬，`
          + `${I_BITE_SAMPLES.length} 个"该咬"的对照样本**全部照旧被咬**`
          + ' ⇒ 豁免在起作用、且没有把裸写也放过（自带样本，不依赖正本内容）')
      }
    } else {
      /**
       * ⚠⚠ **乙-4 的修法本体**（2026-10-21 · 第 327 轮）：`scan` 不是函数 ⇒ **必须红**。
       *
       * ⚠ **为什么⛔ 不许落 `ok('I 【跳过】…')`**：那正是本项目反复踩的那一格 ——
       *   "跳过也打 ✓" ⇒ 机器读数把"没查"记成"查过且过"。
       * ⚠ **为什么⛔ 不许沉默**：改前连 `ok` 都没有 ⇒ 输出里**连 I 组的存在痕迹都没有**，
       *   没人会去数"本该有几组"（见上面那段长注）。
       * ⚠ 判据**必须可读**（`E-112`）：点名"判据函数缺失" + "本组一条都没跑" + 修法。
       */
      bad('I 【判据函数缺失】`hob-render.ts` 的 `scanMarkers` 不是函数'
        + `（实测 typeof = ${typeof scan}）⇒ **I 组一条都没跑**（⚠ 不是"没有残留标记"）`
        + `\n      ⇒ 位置：scripts/check-doc-shape.mjs 的断言 I（${join(root, 'src', 'server', 'hob-render.ts')}）`
        + '\n      ⇒ ⚠ 这正是乙-4 那个洞：`import` 成功但导出不是函数时，'
        + '旧代码既不进 `if`、也不进 `catch` ⇒ **整组静默消失**（连一行输出都没有）'
        + '\n      ⇒ 修法：确认 `hob-render.ts` 仍导出 `scanMarkers` 函数；'
        + '⛔ 不许把本组改成"跳过也打 ✓"')
    }
  }
}