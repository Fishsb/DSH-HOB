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
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

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
const LEDGER_ROOT = (() => {
  // ⚠ 与其它脚本同口径：账本父目录**不硬编码本机绝对路径**（UD-73③），
  //   从 profile 的预设行声明 `ledgerHome` 读出；读不到再退回缺省候选。
  const candidates = []
  try {
    const preset = readFileSync(join(root, 'preset', 'dsh-hob', 'preset-dsh-hob.patch.yml'), 'utf8')
    const m = /ledgerHome:\s*(\S+)/.exec(preset)
    if (m !== null) candidates.push(m[1])
  } catch { /* 预设读不到 ⇒ 只走下面的候选 */ }
  // 候选：<ledgerHome>/<工作区目录名>（本项目的工作区名 = 目录名）
  const wsName = basename(root)
  for (const home of candidates) {
    const dir = join(home, wsName)
    if (existsSync(dir)) return dir
  }
  return undefined
})()

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
 * B / J / D / D′ / I 用的：正本文件名 —— **派生值，⛔ 不再手抄**（第 71 轮）。
 * ⚠ 与 `A_FILES` **不可合并**：A 的基准是**模板**（`templates/<同名>.md` 必须存在，
 *   没有就没法比），B 的基准是**正本本身** —— 两者**判据不同**
 *   （**E-110**：一个常量只服务一条断言；扩范围前先搜该常量的全部消费点）。
 */
const B_FILES = PRIMARY_FILES.files

/** 形态机检主体：A / B / J / C / D / D′ / E（累计顺序与拆前一致）。 */
export function runDocShape({ bad, ok }) {
  if (LEDGER_ROOT === undefined) {
    // ⚠ **明确跳过并说明**（不静默 PASS）：这一支不计入 fail，但**打印为什么跳过**。
    ok(`文档形态机检【跳过】—— 账本区读不到（工作区之外，本机可能未建立）`
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
    for (const f of B_FILES) {
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
      + `共 ${B_FILES.length} 份正本**全部纳入**（**实测派生**，非手抄）：${B_FILES.join(' / ')}`
      + `（口径 = 账本根一层下的 \`*.md\`，见 derivePrimaryFiles()）`)

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
     * ⚠ **范围**：只扫正本（`B_FILES`，第 71 轮起派生）· 只认 `^## `（二级）· 围栏内不参与。
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
        ok(`J ⏳ 活体实证【未取】—— 读不到历史坏快照 ${BAD_SNAPSHOT}`
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

      // ── J-C 主体：正本逐份跑（清单派生自账本根）──
      for (const f of B_FILES) {
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
    //   ⇒ 现在 `B_FILES` 是**唯一**的正本清单来源，本组只补上它的"目录"那一项。
    const C_MUST_NOT_IGNORE = [
      ...B_FILES.map((f) => [f, '账本根正本（派生自 derivePrimaryFiles()）']),
      ['archive/', '各批归档（§3 指针表说它由账本仓 git 记录保证）'],
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
        ok(`C ✓ 账本仓：${B_FILES.length} 份正本（派生）与 archive/ **均未被忽略**（${C_MUST_NOT_IGNORE.length} 项逐条实测）`)
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
    for (const f of B_FILES) {
      let src = ''
      try { src = readFileSync(join(LEDGER_ROOT, f), 'utf8') } catch { src = '' }
      if (src === '') {
        bad(`D 正本读不到：${join(LEDGER_ROOT, f)} —— 引用核验失去基准（不按通过处理）`)
        continue
      }
      src.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(D_REF_RE)) {
          const ref = m[0]
          // 通配（`TASK-*.md` 之类）不是具名引用 —— 跳过，不算数。
          if (ref.includes('*')) continue
          dTotal++
          if (!existsSync(join(LEDGER_ROOT, ref))) {
            dMissing++
            bad(`D 正本 ${f}:${i + 1} 引用了**不存在**的路径：\`${ref}\``
              + '\n      ⇒ 正本里的具名引用必须真的存在（凭记忆写文件名已踩坑三次：E-108 / E-109 / 本条的出处）'
              + `\n      ⇒ 核实方式：在 ${LEDGER_ROOT} 跑 \`ls ${ref}\``)
          }
        }
      })
    }
    if (dTotal === 0) {
      // ⚠ **不判 FAIL**：这一支是"没有可查对象"，不是"查出来有问题"。
      //   但也**不静默** —— 必须打印说明，否则读者会把"没输出"当成"查过了、没问题"。
      ok(`D ✓ ${B_FILES.length} 份正本里**没有**具名的 \`archive/…\` 路径引用（0 处）⇒`
        + ' 本断言**无对象可查**（已扫描，非跳过；占位形态 `archive/<日期>-<名>/` 按设计不计）')
    } else if (dMissing === 0) {
      ok(`D ✓ ${B_FILES.length} 份正本里的 ${dTotal} 处具名归档路径引用，**全部真实存在**（逐条 ${dTotal} 次 existsSync）`)
    }

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
    for (const f of B_FILES) {
      let src = ''
      try { src = readFileSync(join(LEDGER_ROOT, f), 'utf8') } catch { continue }
      src.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(D_TASK_RE)) {
          const name = m[0]
          tTotal++
          if (!archiveBasenames.has(name)) {
            tMissing++
            bad(`D 正本 ${f}:${i + 1} 引用了**不存在**的作业书：\`${name}\``
              + `\n      ⇒ 账本区 \`archive/*/\` 下没有这个 basename（实测 ${archiveBasenames.size} 个候选）`
              + '\n      ⇒ 写成文件名就**必须存在**：轮次号可以只叙事，但 `TASK-Rn.md` 是**具名物**'
              + `\n      ⇒ 核实方式：在 ${LEDGER_ROOT} 跑 \`ls archive/*/${name}\``)
          }
        }
      })
    }
    if (tTotal === 0) {
      // ⚠ 同上：**无对象可查 ≠ 通过**，但不判 FAIL（如实打印读数）。
      //   ⚠ 措辞与收紧后的判据一致：认的是 `TASK-R<数字>…md`（不是任意 `TASK-R*`），
      //     否则读者会以为"我写了 `TASK-Rnn.md` 却没被查" —— 文案与实现必须相符。
      ok(`D′ ✓ ${B_FILES.length} 份正本里**没有** \`TASK-R<数字>...md\` 形式的作业书文件名引用（0 处；`
        + '示意名如 `TASK-Rnn.md`、通配如 `TASK-R*.md` **按设计不计**）⇒'
        + ' 本支**无对象可查**（已扫描，非跳过）')
    } else if (tMissing === 0) {
      ok(`D′ ✓ ${B_FILES.length} 份正本里的 ${tTotal} 处作业书文件名引用，**全部真实存在**`
        + `（按 basename 在 archive 的各日期子目录下比对，候选 ${archiveBasenames.size} 个）`)
    }

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
  }
}

/** 断言 I：正本无未渲染占位标记（需 `await import` 渲染器 ⇒ async）。 */
export async function runResidualMarkers({ bad, ok }) {
  // ── 断言 I · 正本无残留标记（2026-10-11 新增 · 第 47 轮 · 结构改造④）────────
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
    ok('I ✓ 正本无残留标记【跳过】—— 账本区读不到（工作区之外），**不代表通过**'
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
    if (typeof scan === 'function') {
      const hits = []
      for (const f of B_FILES) {
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
        ok(`I ✓ ${B_FILES.length} 份正本里**没有**未渲染的占位标记（逐份扫描，命中 0 处）`
          + ' ⇒ "渲染被拒绝"不会悄悄留在正本里（渲染器的"只提示、不拒写"由此有了收尾兜底）')
      } else {
        bad(`I ${B_FILES.length} 份正本里存在**未渲染的占位标记**（${hits.length} 处）：${hits.join(' · ')}`
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
    }
  }
}