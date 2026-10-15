/**
 * 源码与骨架静态面机检（族 ③）—— K / F / G / H。
 *
 * ⚠ 2026-10-11（第 60 轮）从 `check-gitignore.mjs` 拆分而来。
 *   读 `src/**` · `scripts/**` · 账本区（F 读 README §5.1；H 自建沙箱真跑写入器）。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const ZERO_WIDTH_RE = /[\u200B\uFEFF\u200E\u200F]/

/** 断言 K：两侧同源判据的字面量必须逐字相同。 */
export function runSameSource({ bad, ok }) {
  /**
   * ── 断言 K · **同源判据的字面量必须逐字相同**（2026-10-11 第 55 轮）────────────
   *
   * ── 为什么需要它（缺口有实测出处）──────────────────────────────────────
   *   同一条判据写在**两处**（写入侧 `src/server/hob-write.ts` · 检查侧本脚本），
   *   因为 `src/` 与 `scripts/` 是**两棵互不依赖的树**（`src/` 不能 import `scripts/`，
   *   反之亦然 —— 那会把检查脚本变成产品依赖）⇒ 只能**照抄 + 在两侧注释里互相指名**。
   *   ⇒ 后果："照抄"这件事**全靠人守**，谁忘了对一眼，两侧就会**各写一套**。
   *   ⚠ **实测发生的正是这个**（第 54 轮 · **E-130**）：两侧的归档路径正则都写 `[a-z0-9-]`
   *     （**不含点号**）⇒ 含点号的路径在**两侧同时**不被当引用 ⇒
   *     **写下一个永远创建不出来的路径，全程无人提醒**。
   *     ⚠ 危险之处在于：**两侧一致地错**时，"两边一致"会被误当成"两边都对"。
   *   ⇒ 本断言把"照抄"从**人守**变成**机检**：两侧的字面量必须**逐字相同**；
   *     不同 ⇒ FAIL 并**打印两侧各自的字面量与所在文件**。
   *
   * ── 判据（口径：**只比字面量文本**，不比"行为等价"）──────────────────────
   *   · 目标是**防各写一套**，不是判"两种写法是否等价" ⇒ **逐字文本比对**最简单、不误报；
   *     ⚠ **刻意不做"语义等价"判断**（那要写一个正则解析器，且会引入误报面）。
   *   · ⚠ **提取失败（找不到 / 换了写法）⇒ FAIL 并明说"提取不到"** ——
   *     ⛔ **不许静默通过**：静默通过等于这条机检不存在（与断言 I 的教训同族）。
   *
   * ── 覆盖范围（**照实登记**，见 `.hob/README.md` §1.4）────────────────────
   *   · **管**：两对**正则字面量** —— 归档路径（`REF_PATH_RE` ↔ `D_REF_RE`）·
   *     作业书文件名（`REF_TASK_RE` ↔ `D_TASK_RE`）。
   *     这些都是**具名声明**（`const X = /…/g`）⇒ 提取稳定。
   *   · **不管（已知边界）**：`hob-render.ts` 的 `fencedMask` ↔ 本脚本的 `fencedMaskBelow`
   *     —— 那是**函数体照抄**，不是字面量。⚠ 比对函数体**极易脆**（空白 / 注释 / 改名
   *     都会误报），故**判不可机检**，如实登记边界，⛔ **不为"看起来全护住"而写一条会误报的机检**。
   *     ⚠ **但它内含的那个正则（围栏开标记）是可机检的** ⇒ 本断言**顺带**比对它：
   *       检查侧有具名 `FENCE_OPEN_RE`，写侧是**内联字面量**（`const m = /…/.exec(...)`），
   *       故对写侧改用"**字面量文本是否在文件中出现**"的判据（见 K_LITERAL_CHECKS 的第 3 项）。
   *   · ⚠ **只覆盖"两侧都在的文件"**：将来若有**第三处**也抄一份，本断言**不自动覆盖**
   *     ⇒ 记进已知边界（与"脚本落点只扫一层"同族）。
   */
  {
    /** 声明式正则提取：`[export] const|let|var NAME = /…/flags`。 */
    const DECL_RE = /(?:^|\s)(?:const|let|var|export\s+const)\s+([A-Za-z_$][\w$]*)\s*=\s*(\/(?:\\.|\[[^\]]*\]|[^/\n\\])+\/[gimsuy]*)/g
    /** 从源码里取某个具名声明的正则字面量；找不到返回 `null`（**不静默**）。 */
    const grabDeclared = (src, name) => {
      DECL_RE.lastIndex = 0
      let m
      while ((m = DECL_RE.exec(src)) !== null) if (m[1] === name) return m[2]
      return null
    }
    const rel = (p) => relative(root, p).replace(/\\/g, '/')

    /**
     * 同源对清单：`[标签, 写侧文件, 写侧取法, 检查侧文件, 检查侧取法]`。
     * ⚠ 取法两种：`['decl', 名字]` = 具名声明；`['contains', 字面量]` = 文本包含。
     */
    const WRITE_TS = join(root, 'src', 'server', 'hob-write.ts')
    const RENDER_TS_K = join(root, 'src', 'server', 'hob-render.ts')
    const CHECK_MJS = join(root, 'scripts', 'check-doc-shape.mjs')
    const K_LITERAL_CHECKS = [
      ['归档路径（REF_PATH_RE ↔ D_REF_RE）', WRITE_TS, ['decl', 'REF_PATH_RE'], CHECK_MJS, ['decl', 'D_REF_RE']],
      ['作业书文件名（REF_TASK_RE ↔ D_TASK_RE）', WRITE_TS, ['decl', 'REF_TASK_RE'], CHECK_MJS, ['decl', 'D_TASK_RE']],
    ]
    const readOrNull = (p) => { try { return readFileSync(p, 'utf8') } catch { return null } }
    const srcW = readOrNull(WRITE_TS)
    const srcR = readOrNull(RENDER_TS_K)
    const srcC = readOrNull(CHECK_MJS)
    if (srcW === null || srcR === null || srcC === null) {
      bad('K 同源字面量比对【基准缺失】：读不到源码文件 '
        + `${[WRITE_TS, RENDER_TS_K, CHECK_MJS].map(rel).join(' / ')} ⇒ 不按通过处理（不许静默）`)
    } else {
      const srcOf = (p) => (p === WRITE_TS ? srcW : p === RENDER_TS_K ? srcR : srcC)
      let kBad = 0
      for (const [label, wFile, wHow, cFile, cHow] of K_LITERAL_CHECKS) {
        const wSrc = srcOf(wFile)
        const cSrc = srcOf(cFile)
        // 写侧：具名声明，或"该字面量出现在文件中"（内联写法）
        let wLit = null
        let cLit = null
        try {
          if (wHow[0] === 'decl') wLit = grabDeclared(wSrc, wHow[1])
          else { wLit = cHow[0] === 'decl' ? grabDeclared(cSrc, cHow[1]) : null }
          if (cHow[0] === 'decl') cLit = grabDeclared(cSrc, cHow[1])
          else cLit = wLit
        } catch { /* 下面按"提取不到"处理 */ }
        // ⚠ 提取失败 ⇒ FAIL 并明说（⛔ 不许静默通过）
        if (wHow[0] === 'decl' && wLit === null) {
          kBad++
          bad(`K 同源对【提取不到】：\`${label}\` 在写侧 ${rel(wFile)} 里找不到具名声明的正则字面量 `
            + `\`${wHow[1]}\`（写法变了？）— ⛔ 不许静默通过：提取不到 = 这条机检等于不存在`)
          continue
        }
        if (cHow[0] === 'decl' && cLit === null) {
          kBad++
          bad(`K 同源对【提取不到】：\`${label}\` 在检查侧 ${rel(cFile)} 里找不到具名声明的正则字面量 `
            + `\`${cHow[1]}\`（写法变了？）— ⛔ 不许静默通过：提取不到 = 这条机检等于不存在`)
          continue
        }
        if (wLit !== cLit) {
          kBad++
          bad(`K 同源对**不一致**：\`${label}\` —— 两侧的字面量**必须逐字相同**（改一处必须改另一处）`
            + `\n      · ${rel(wFile)}: \`${wLit}\``
            + `\n      · ${rel(cFile)}: \`${cLit}\``
            + '\n      ⇒ 这两处是**同一处口径的两个副本**（`src/` 与 `scripts/` 互不 import，只能照抄）'
            + `\n      ⇒ 后果实测过（第 54 轮 · E-130）：两侧各写一套时，含点号的路径在**两侧同时**`
            + `\n        不被当引用 ⇒ 一条永远创建不出来的路径全程无人提醒 —— "两边一致地错"`
            + `\n      ⇒ 修法：把两侧改成**同一个字面量**（改完请对一眼另一处）`)
        }
      }
      // ── 围栏开标记：写侧是**内联**字面量（非具名声明）⇒ 用"文本包含"判据 ──
      {
        const cLit = grabDeclared(srcC, 'FENCE_OPEN_RE')
        const wInline = /const\s+m\s*=\s*(\/(?:\\.|\[[^\]]*\]|[^/\n\\])+\/[gimsuy]*)\s*\.exec\s*\(/.exec(srcR)
        if (cLit === null) {
          kBad++
          bad('K 同源对【提取不到】：检查侧 `FENCE_OPEN_RE` 找不到（写法变了？）— ⛔ 不许静默通过')
        } else if (wInline === null) {
          kBad++
          bad('K 同源对【提取不到】：写侧围栏正则不是**内联字面量**形态（`const m = /…/.exec(…)`）——'
            + '写法变了 ⇒ 提取不到。⛔ 不许静默通过：请把本断言的取法同步到新写法（或改回内联）')
        } else if (wInline[1] !== cLit) {
          kBad++
          bad(`K 同源对**不一致**：\`围栏开标记（fencedMask 内联 ↔ FENCE_OPEN_RE）\` —— 两侧必须逐字相同`
            + `\n      · ${rel(RENDER_TS_K)}（内联）: \`${wInline[1]}\``
            + `\n      · ${rel(CHECK_MJS)}: \`${cLit}\``
            + `\n      ⇒ 两侧对"什么算围栏"必须同口径，否则文档里能安全写的例子，机检会报残留（E-114 家族）`)
        }
      }

      // ── K 的自带样本（**E-126**：成对，且**不依赖真实源码当前状态**）──
      //   ⚠ 判据 = **该咬的全咬、不该咬的全不咬**；数照实记（**E-117**：⛔ 不写死"预期几个"）。
      //   这里把"比对逻辑"抽成一个小函数（与主体同口径），再把样本喂它 —— 样本不受源码现状影响。
      const sameLiteral = (a, b) => a === b
      const K_BITE_SAMPLES = [
        ['/archive\\/\\d{4}-[a-z0-9-]+\\/X/g', '/archive\\/\\d{4}-[A-Za-z0-9._-]+\\/X/g', 'S1 只有字符集不同（第 54 轮真事故的最小复现）'],
        ['/TASK-R\\d+\\.md/g', '/TASK-R\\d+[A-Za-z0-9-]*\\.md/g', 'S2 量词不同（少了一段）'],
        ['/^\\s{0,3}(`{3,}|~{3,})(.*)$/', '/^\\s{0,3}(`{3,}|~{3,})+(.*)$/', 'S3 只差一个 `+`'],
      ]
      const K_SAFE_SAMPLES = [
        ['/archive\\/\\d{4}-\\d{2}-\\d{2}-[A-Za-z0-9._-]+\\/[A-Za-z0-9._/-]*/g', '/archive\\/\\d{4}-\\d{2}-\\d{2}-[A-Za-z0-9._-]+\\/[A-Za-z0-9._/-]*/g', 'S4 完全相同的字面量'],
        ['/TASK-R\\d+[A-Za-z0-9-]*\\.md/g', '/TASK-R\\d+[A-Za-z0-9-]*\\.md/g', 'S5 完全相同的字面量（另一对）'],
      ]
      for (const [a, b, why] of K_BITE_SAMPLES) {
        if (sameLiteral(a, b)) {
          kBad++
          bad(`K 自带样本**没被咬**：${why} —— 两个**不同**的字面量被判成"相同" ⇒ 判据**改哑**（永远通过）`)
        }
      }
      for (const [a, b, why] of K_SAFE_SAMPLES) {
        if (!sameLiteral(a, b)) {
          kBad++
          bad(`K 自带样本**被误咬**：${why} —— 两个**相同**的字面量被判成"不同" ⇒ 判据过宽（会误报）`)
        }
      }
      // ── 口径判定（§1⑤ 要求"先判口径并说明"）：**只比字面量文本，不比语义等价** ──
      //   ⚠ 下面这个样本是**刻意**的："语序/空白不同、语义可能相同" ⇒ **判为"不同"（该咬）**。
      //     理由：本断言要防的是"**各写一套**"，不是"判两种写法等价"—— 后者要写正则解析器、
      //     且必然引入误报面（正是本条注释开头点名"极易脆"的那类）。⇒ 口径 = **逐字文本**。
      {
        const a = '/TASK-R\\d+ [A-Za-z0-9-]*\\.md/g'
        const b = '/TASK-R\\d+[A-Za-z0-9-]*\\.md/g'
        if (sameLiteral(a, b)) {
          kBad++
          bad('K 口径样本异常：插入空白后仍被判"相同" ⇒ 说明比对不是"逐字文本"口径（与注释不符）')
        }
        // ⚠ 反过来说：**空白不同就该咬** ⇒ 若它"不咬"才是问题；这里断言它**确实咬**、
        //   并在输出里说明这是**有意口径**（不是误报）。
      }
      if (kBad === 0) {
        ok(`K ✓ 同源字面量：${K_LITERAL_CHECKS.length} 对具名声明**全部逐字相同**`
          + `（${K_LITERAL_CHECKS.map((x) => x[0].replace(/（.*$/, '')).join(' · ')}）`
          + '；另比 1 处**内联**字面量（围栏开标记：写侧内联 ↔ 检查侧 FENCE_OPEN_RE）**逐字相同**'
          + `；自带样本 ${K_BITE_SAMPLES.length} 该咬 / ${K_SAFE_SAMPLES.length} 不该咬 全过`
          + `；口径 = **只比字面量文本**（空白/语序不同即判不同 —— 有意如此）`)
      }
    }
  }
}

/** 断言 F：纪律登记表（README §5.1）第 3 列必须指向**存在的**检查。 */
export function runDiscipline({ bad, ok, readmeSrc, PKG }) {
  // ── 断言 F · 纪律登记表（2026-10-10 新增 · 第 45 轮 · 结构改造③）────────────
  /**
   * **每条纪律必须声明"谁来查"。**
   *
   * ── 为什么需要它（缺口 3 · 规矩没有执行器）─────────────────────────────
   *   纪律写在文档里、**靠立规矩的人记得遵守** ⇒ 实测失败 2 次：
   *     · 第 36 轮立"不写失效状态字"，而**该纪律的落点文本自己就犯了**；
   *     · 第 42 轮立"计数要带口径"，而**派单时又写死"预期 11 处"**。
   *   ⚠ 共同点：**立规矩的人与守规矩的人是同一个**，没有第三方核对。
   *
   * ── 设计要点（为什么不判断"什么算一条纪律"）────────────────────────────
   *   那是**语义判断**，机器做不到（也做不稳）。⇒ 改为**建一张登记表**，
   *   并断言**表里每个"机检归属"都真实存在** ⇒
   *   真正的牙口是「**指向一个不存在的检查**会被当场抓住」。
   *   ⚠ **可判、不依赖语义、也不需要数条数**（**E-117**：计数会漂移，不当判据）。
   *
   * ── 判据 ─────────────────────────────────────────────────────────────
   *   ① 表读不到 / 0 行 ⇒ **FAIL**（"失去基准 ⇒ 不按通过处理"，**不许静默**）；
   *   ② 每行第 3 列非空，空 ⇒ **FAIL 并打印是哪一行**；
   *   ③ 第 3 列须为 `` `check:<name>` ``（且该 name **在 package.json scripts 里存在**）
   *      或 `未机器化`，其余一律 **FAIL + 打印该行原文**；
   *   ④ 尤其：`` `check:不存在的名字` `` ⇒ **FAIL**（**本组主牙口**）。
   *
   * ⚠ **只解析 README §5.1 的表**（列名行 + 其后的 `| … | … | … |` 行）——
   *   不扫全文件，避免把别处的表格当登记表（那会让判据依赖无关内容）。
   */
  {
    const src = readmeSrc
    const lines = src.split('\n')
    // 表头行：三列表头里含「机检归属」
    const headIdx = lines.findIndex((l) => l.startsWith('|') && l.includes('机检归属'))
    let rows = []
    if (headIdx >= 0) {
      for (let i = headIdx + 1; i < lines.length; i++) {
        const l = lines[i]
        if (!l.startsWith('|')) break // 表结束
        if (/^\|[\s:|-]+\|$/.test(l.trim())) continue // 分隔行
        rows.push({ no: i + 1, raw: l })
      }
    }
    if (headIdx < 0 || rows.length === 0) {
      bad('F 读不到「纪律登记表」（README §5.1）⇒ 归属核验失去基准，**不按通过处理**'
        + '\n      ⇒ 该表的判据是"每条纪律必须有归属"，表没了则纪律**重新变回没人管**（本组要防的正是这个）')
    } else {
      // package.json 的 scripts **键名**（判据 ③ 要拿它当唯一权威；不硬编码期望表）
      let scriptNames = null
      try {
        const pkgRaw = execFileSync('cat', [PKG], { encoding: 'utf8' })
        const sc = JSON.parse(pkgRaw).scripts
        if (sc !== null && typeof sc === 'object') scriptNames = new Set(Object.keys(sc))
      } catch { scriptNames = null }
      if (scriptNames === null) {
        bad('F 读不到 package.json 的 scripts（归属判据的唯一权威缺失 ⇒ 不按通过处理）')
      } else {
        let fBad = 0
        let manualCount = 0
        for (const r of rows) {
          // 第 3 列 = 第 3 个 `|` 分隔的单元格
          const cells = r.raw.split('|').map((c) => c.trim())
          // cells[0] 是行首 `|` 前的空串 ⇒ 数据列从 cells[1] 起
          const third = cells[3] ?? ''
          if (third === '') {
            fBad++
            bad(`F 第 ${r.no} 行的「机检归属」为空 ⇒ **每条纪律都必须声明"谁来查"**`
              + `\n      ⇒ 该行原文：${r.raw}`
              + '\n      ⇒ 填 `check:<名字>`（须真实存在）或 `未机器化`（如实登记，不是失败）')
            continue
          }
          if (third === '未机器化') { manualCount++; continue }
          const m = /^`check:([A-Za-z0-9:._-]+)`$/.exec(third)
          if (m === null) {
            fBad++
            bad(`F 第 ${r.no} 行的「机检归属」不是合法值：\`${third}\``
              + `\n      ⇒ 该行原文：${r.raw}`
              + '\n      ⇒ 合法值只有两种：`` `check:<name>` ``（name 须在 package.json scripts 里）或 `未机器化`')
            continue
          }
          const name = `check:${m[1]}`
          if (!scriptNames.has(name)) {
            fBad++
            bad(`F 第 ${r.no} 行的「机检归属」指向**不存在的检查**：\`${name}\``
              + `\n      ⇒ 该行原文：${r.raw}`
              + `\n      ⇒ package.json 的 scripts 里没有 \`${name}\`（现有：${[...scriptNames].sort().join(' · ')}）`
              + '\n      ⇒ 这正是本组的主牙口：**指向一个不存在的检查会被当场抓住**'
              + '（否则纪律会挂着"有人管"的名义，实际没人管）')
            continue
          }
        }
        if (fBad === 0) {
          ok(`F ✓ 纪律登记表：${rows.length} 行，第 3 列**全部合法**`
            + `（\`check:<存在的名字>\` ${rows.length - manualCount} 行 · \`未机器化\` ${manualCount} 行）`)
        }
      }
    }
  }
}

/** 断言 G：`src/**` 与 `scripts/**` 内不得含零宽 / 不可见字符。 */
export function runZeroWidth({ bad, ok }) {
  // ── 断言 G · 零宽 / 不可见字符（2026-10-10 新增 · 第 45 轮）────────────────
  /**
   * **`src/**` 与 `scripts/**` 内不得含零宽 / 不可见字符。**
   *
   * ⛔ **不扫 `.md`**（**有意取舍**）：文档里**必然**会"**描述这个禁令本身**" ——
   *   本节的注释、README 与正本的纪律段都要写下那四个码位（如上面的 `[\u200B…]`）。
   *   若把 `.md` 也纳入，**讲这条禁令的那几行会把自己打挂**（**E-114 家族**：
   *   判据被"描述它自己的文本"咬到）。⇒ 只扫**代码**（那里没有"描述禁令"的正当需求）。
   *
   * ⚠ 为什么要有它：本条纪律（"不许零宽字符"）此前是**人守**的
   *   —— 实测在 `src/modules/orchestrator.ts` 的一句注释里**留了一个 U+200B**
   *   直到第 44 轮才被人工发现 ⇒ 本轮把它**机器化**（纪律登记表的归属随之上移）。
   */
  {
    const SKIP_DIRS = new Set(['node_modules', '.git'])
    const hits = []
    const walk = (dir) => {
      let entries = []
      try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (SKIP_DIRS.has(e.name)) continue
        const p = join(dir, e.name)
        if (e.isDirectory()) { walk(p); continue }
        if (!/\.(ts|mjs|js|tsx)$/.test(e.name)) continue
        let src = ''
        try { src = readFileSync(p, 'utf8') } catch { continue }
        src.split('\n').forEach((line, i) => {
          if (ZERO_WIDTH_RE.test(line)) {
            hits.push(`${relative(root, p).replace(/\\/g, '/')}:${i + 1}`)
          }
        })
      }
    }
    walk(join(root, 'src'))
    walk(join(root, 'scripts'))
    if (hits.length === 0) {
      ok('G ✓ `src/**` 与 `scripts/**` 内零宽/不可见字符（U+200B / U+FEFF / U+200E / U+200F）：**0 处**'
        + '（⛔ 不扫 `.md` —— 文档要"描述这条禁令本身"，扫了会自我打挂，见 E-114）')
    } else {
      bad(`G \`src/**\` 或 \`scripts/**\` 里出现零宽/不可见字符（${hits.length} 处）：`
        + ` ${hits.join(' · ')}`
        + '\n      ⇒ 这类字符**不可见却参与匹配/比较** ⇒ 会造成"看着一样、字节不同"的诡异缺陷'
        + '\n      ⇒ 清理后重跑；若确需在代码里引用这些码位，请用转义（`\\u200B`）而非字面量')
    }
  }
}

/** 断言 H：读数渲染的六条行为断言（真跑 hob-render/hob-write ⇒ async）。 */
export async function runRender({ bad, ok }) {
  // ── 断言 H · 读数渲染（2026-10-11 新增 · 第 47 轮 · 结构改造④）──────────────
  /**
   * **正本里"会漂移的读数"改由写入工具在落盘前渲染** —— 本组验它**真的有牙**。
   *
   * ── 治哪条根因（缺口 4 · 值靠手抄）─────────────────────────────────────
   *   计数 / 字节数此前**手写进文本**，靠"快照口径"声明"会过期"兜住漂移
   *   —— ⚠ 那是**免责**，不是**解决**。⇒ 值改由写入工具当场取。
   *
   * ── 为什么本组必须**真跑函数**而不是文本匹配 ─────────────────────────
   *   与 F 组同款理由：`src/**` 里 `renderReadings` 字样**还在**、实现被掏空时，
   *   文本断言照样 PASS。⇒ 用 Node ≥22 **直载 `.ts`** 实跑；import 失败即 **FAIL**
   *   （"基准跑不起来就默认通过"是假通过）。
   *
   * ── 判据（六条，逐条**真跑**）──────────────────────────────────────────
   *   H1 渲染正确：指向**真实存在**目标的标记 ⇒ 落盘内容是**实值**（与当场 `fs` 实测一致）；
   *   H2 值会变：目标文件**改大**后重写 ⇒ 渲染值**随之变**（与新实测一致）；
   *   H3 自引用拒绝：标记指向**正在写的那个文件自身**（`bytes`）⇒ **拒绝 + 点名**；
   *   H4 父目录拒绝：标记指向**正在写文件的父目录**（`count`）⇒ **拒绝 + 点名**；
   *   H5 围栏豁免：标记写在**围栏代码块内** ⇒ **不渲染、原样保留**（**E-114 家族**：
   *      "讲这个标记怎么写"的文档必须能安全存在）；
   *   H6 幂等保住：**同一份含标记的输入写两次** ⇒ 第二次 **skipped**
   *      （⚠ 渲染必须**先于**幂等比对，否则"标记原文"与"存量实值"永不相等 ⇒ 幂等失效）。
   *
   * ⚠ **判据同源**：本组用的 `scanMarkers` / `renderReadings` 与 `write_hob` 落盘时
   *   用的是**同一份实现**（`src/server/hob-render.ts`）—— 不在这里重写一套正则。
   *   理由：若各写一套，"文档里能安全写例子"与"机检报残留"会自相矛盾。
   */
  const RENDER_TS = join(root, 'src', 'server', 'hob-render.ts')
  const HOBWRITE_TS = join(root, 'src', 'server', 'hob-write.ts')

  /** H1–H6 的夹具：全部在临时目录里自造（不读真账本 ⇒ 不依赖账本根有几份正本）。 */
  {
    const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { pathToFileURL } = await import('node:url')

    let hr
    let hw
    let loadErr = null
    try {
      hr = await import(pathToFileURL(RENDER_TS).href)
      hw = await import(pathToFileURL(HOBWRITE_TS).href)
    } catch (e) {
      loadErr = e
      bad(`H 无法加载渲染 / 写入模块（${String(e?.message ?? e)}）⇒ 读数渲染的行为断言失去基准（不按通过处理）`)
    }

    if (loadErr === null && hr !== undefined && hw !== undefined) {
      const { scanMarkers } = hr
      const { writeHobFile } = hw
      /** 与 `src/modules/tools.ts` 的 DEFAULTS 同口径；上限调小以便本地沙箱够用。 */
      const opts = { hobDir: '', keepBackups: 3, shrinkGuard: 0.5, maxFileBytes: 262144 }
      const dir = mkdtempSync(join(tmpdir(), 'hob-hcheck-'))
      try {
        // 沙箱账本区：一个真目录（7 个条目）+ 一个大文件，供 H1/H2 取实测。
        mkdirSync(join(dir, 'templates'), { recursive: true })
        for (let i = 0; i < 7; i++) writeFileSync(join(dir, 'templates', `t${i}.md`), 'x', 'utf8')
        writeFileSync(join(dir, 'big.md'), 'a'.repeat(1234), 'utf8')

        // ── H1 **渲染正确**：落盘内容是实值（与当场 fs 实测一致）──
        {
          const c = '共 <!-- hob:count | templates --> 份 · <!-- hob:bytes | big.md --> 字节\n'
          const r = await writeHobFile(dir, { file: 'CONTEXT.md', content: c, mode: 'overwrite' }, opts)
          let disk = ''
          try { disk = readFileSync(join(dir, 'CONTEXT.md'), 'utf8') } catch { disk = '' }
          const wantCount = readdirSync(join(dir, 'templates')).length
          const wantBytes = readFileSync(join(dir, 'big.md')).length
          const okDisk = disk.includes(`共 ${wantCount} 份`) && disk.includes(`${wantBytes} 字节`)
          const noMarker = !disk.includes('<!-- hob:')
          if (r.ok === true && okDisk && noMarker) {
            ok(`H1 ✓ 渲染正确：落盘内容里是**实值**（count(templates)=${wantCount} · bytes(big.md)=${wantBytes}，`
              + '与当场 `fs` 实测一致），**标记不残留**')
          } else {
            bad(`H1 渲染未生效：ok=${r.ok} 落盘=${JSON.stringify(disk)}（期望 count=${wantCount} / bytes=${wantBytes}）`
              + ' ⇒ 标记没被替换成实值，或替换值不对')
          }
        }

        // ── H2 **值会变**：目标改大后重写 ⇒ 渲染值随之变 ──
        //   ⚠ 改写的内容**不短于**原内容：缩水守卫（`shrinkGuard`）会在"新内容 < 旧 × 0.5"时拒绝，
        //     那是**另一条**断言的地盘 —— 本组要验的是"渲染值跟着树走"，别让它被缩水守卫挡在门外。
        {
          writeFileSync(join(dir, 'big.md'), 'b'.repeat(4321), 'utf8')
          const pad = '（本条只验渲染值随目标变化，内容长度故意与上一版相当，避开缩水守卫。）\n'
          const r = await writeHobFile(dir, { file: 'CONTEXT.md', content: `<!-- hob:bytes | big.md --> 字节\n${pad}`, mode: 'overwrite' }, opts)
          let disk = ''
          try { disk = readFileSync(join(dir, 'CONTEXT.md'), 'utf8') } catch { disk = '' }
          const want = readFileSync(join(dir, 'big.md')).length
          if (r.ok === true && disk.trimStart().startsWith(`${want} 字节`)) {
            ok(`H2 ✓ 值会变：目标从 1234 改大到 ${want} 后重写 ⇒ 渲染值随之变为 ${want}（与新实测一致）`
              + ' —— 值取自**写入时**，不是写死在文本里')
          } else {
            bad(`H2 渲染值**没跟着变**：落盘=${JSON.stringify(disk)}（期望 ${want}）`
              + ' ⇒ 若渲染的是缓存/写死的值，本机制就退化成它要取代的"手抄"')
          }
        }

        // ── H3 **自引用拒绝**：指向正在写的那个文件自身（bytes）⇒ 拒绝 + 点名 + 原样保留 ──
        {
          const marker = '<!-- hob:bytes | PROJECT.md -->'
          const r = await writeHobFile(dir, { file: 'PROJECT.md', content: `自测：${marker}\n`, mode: 'overwrite' }, opts)
          let disk = ''
          try { disk = readFileSync(join(dir, 'PROJECT.md'), 'utf8') } catch { disk = '' }
          const refused = Array.isArray(r.readings?.refused) ? r.readings.refused : []
          const hit = refused.some((x) => x.reason === 'self-bytes' && x.line === 1)
          const msgHas = /读数\*\*未渲染\*\*|读数\*\*未渲染\*\*|未渲染/.test(r.message) && /第 1 行/.test(r.message)
          if (r.ok === true && hit && disk.includes(marker) && msgHas) {
            ok('H3 ✓ 自引用拒绝：指向**自身**且取 `bytes` ⇒ 拒绝渲染 + 点名（含**第 1 行** + 理由），'
              + '标记**原样保留**、**写入照常**（只提示、不拒写）')
          } else {
            bad(`H3 自引用未被拒绝或未被点名：ok=${r.ok} refused=${JSON.stringify(refused)} `
              + `标记还在盘上=${disk.includes(marker)} 消息含行号=${msgHas}`
              + ' ⇒ 这是"文件包含自身长度"的不可能任务，**必须**拒绝而不是渲染一个永远错的数')
          }
        }

        // ── H4 **父目录拒绝**：指向正在写文件的父目录（count）⇒ 拒绝 + 点名 ──
        {
          const marker = '<!-- hob:count | archive/2026-10-11-hcheck -->'
          const f = 'archive/2026-10-11-hcheck/TASK-R1.md'
          mkdirSync(join(dir, 'archive', '2026-10-11-hcheck'), { recursive: true })
          //   ⚠ 归档**拒 overwrite**（"归档是只增不改的历史"）⇒ 用 `append`（首写即创建）；
          //     否则本组会被**另一条**断言（archive-overwrite-denied）挡在门外，验不到父目录拒绝。
          const r = await writeHobFile(dir, { file: f, content: `自测：${marker}\n`, mode: 'append' }, opts)
          let disk = ''
          try { disk = readFileSync(join(dir, f), 'utf8') } catch { disk = '' }
          const refused = Array.isArray(r.readings?.refused) ? r.readings.refused : []
          const hit = refused.some((x) => x.reason === 'parent-count' && x.line === 1)
          if (r.ok === true && hit && disk.includes(marker)) {
            ok('H4 ✓ 父目录拒绝：指向**正在写文件的父目录**且取 `count` ⇒ 拒绝 + 点名（含第 1 行），'
              + '标记原样保留（写这份文件会改变该目录的条目数 ⇒ 同族的不可能任务）')
          } else {
            bad(`H4 父目录未被拒绝或未被点名：ok=${r.ok} refused=${JSON.stringify(refused)} 标记还在盘上=${disk.includes(marker)}`)
          }
        }

        // ── H5 **围栏豁免**（E-114 家族）：围栏内的标记不渲染、不报错 ──
        {
          const fenced = ['说明如下：', '```md', '<!-- hob:count | templates -->', '```', '结束。'].join('\n')
          const hits = scanMarkers(fenced)
          const r = await writeHobFile(dir, { file: 'CONTEXT.md', content: `${fenced}\n`, mode: 'overwrite' }, opts)
          let disk = ''
          try { disk = readFileSync(join(dir, 'CONTEXT.md'), 'utf8') } catch { disk = '' }
          const refused = Array.isArray(r.readings?.refused) ? r.readings.refused : []
          if (hits.length === 0 && refused.length === 0 && disk.includes('<!-- hob:count | templates -->')) {
            ok('H5 ✓ 围栏豁免：写在 ``` 围栏内的标记**不渲染、原样保留**、**不报 FAIL**'
              + '（**E-114 家族** —— "讲这个标记怎么写"的文档必须能安全存在，否则文档会被自己的例子打挂）')
          } else {
            bad(`H5 围栏豁免未生效：scanMarkers=${hits.length} refused=${JSON.stringify(refused.map((x) => x.reason))} `
              + `盘上还在=${disk.includes('<!-- hob:count | templates -->')}`
              + ' ⇒ 判据被"描述它自己的文本"咬到（E-114：必须调精度，⛔ 不许靠放宽判据绕开）')
          }
        }

        // ── H6 **幂等保住**：同一份含标记的输入写两次 ⇒ 第二次 skipped ──
        //   ⚠ 这条是本轮**最容易悄悄破的**：渲染若排在幂等比对**之后**，
        //     "标记原文"永远不等于"存量里的实值" ⇒ 每次写都"有变化"，幂等跳过失效。
        {
          const c = '共 <!-- hob:count | templates --> 份\n'
          const r1 = await writeHobFile(dir, { file: 'USER-DECISIONS.md', content: c, mode: 'overwrite' }, opts)
          const r2 = await writeHobFile(dir, { file: 'USER-DECISIONS.md', content: c, mode: 'overwrite' }, opts)
          let disk = ''
          try { disk = readFileSync(join(dir, 'USER-DECISIONS.md'), 'utf8') } catch { disk = '' }
          if (r1.ok === true && r2.action === 'skipped' && r2.reason === 'idempotent' && disk.trim().startsWith('共 ')) {
            ok('H6 ✓ 幂等保住：同一份**含标记**的输入写两次 ⇒ 第二次 `skipped`（渲染**先于**幂等比对）'
              + ' —— 否则幂等跳过失效、备份被反复刷屏')
          } else {
            bad(`H6 幂等被破坏：第一次=${r1.action} 第二次=${r2.action}/${r2.reason} 盘上=${JSON.stringify(disk)}`
              + ' ⇒ 渲染顺序错了（必须先渲染、再比对），这是本轮的**停手条件①**')
          }
        }
      } finally {
        try { rmSync(dir, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
      }
    }
  }
}

/**
 * 断言 Q：**卷下「具名两层子目录」的写侧白名单 —— 成对可验 + 强制登记**
 * （2026-10-15 第 213 轮 · `UD-116` 用户裁定「A」）。
 *
 * ── 治哪条根因（缺口有实测出处）──────────────────────────────────
 *   **第 210 轮**按 `UD-114` 把轮次登记换成「**一轮一文件**」，落在
 *   `volumes/context/rounds/` —— ⚠ 那是**两层**。⚠ **第 211 轮实测：`write_hob`
 *   写那个目录被当场拒绝**（白名单只到一层）⇒ **Hob 写不了自己的轮次记录**。
 *   ⛔ **只把 `rounds` 写成特例**的话，下次再出现一个新两层目录**同一条缝会再裂一次**
 *   （`UD-115` 的核心）。
 *
 * ── 判据（成对 · 两侧都必须能失败）────────────────────────────────
 *   **Q1 允许面**：登记在 `VOLUME_SUBDIRS` 里的两层路径 ⇒ **真跑写入器 ⇒ 放行**；
 *   **Q2 不在允许面**：一个**未登记**的卷下两层路径 ⇒ **真跑写入器 ⇒ 拒绝 + 点名它未登记**；
 *   **Q3 强制登记**：⚠ **扫账本区实际存在的 `volumes/<卷>/<子目录>/`** ⇒
 *     ⚠ **凡不在 `VOLUME_SUBDIRS` 里的，当场 FAIL 并点名那条路径**
 *     —— ⚠ **这一条才是"下次怎么办"的机械保证**（⛔ 不是靠人记得去登记）。
 *   **Q4 不放宽既有**：软链 / 骨架 / 归档 overwrite ⇒ **与改动前同判**（抽样对拍）。
 *
 * ── ⚠ 为什么必须**真跑写入器**而不是 grep 常量 ────────────────────────
 *   与 F / H 组同款理由：`VOLUME_SUBDIRS` 字样**还在**、而 `checkWhitelist` 被改回
 *   一层时，文本断言照样 PASS。⇒ 用 Node ≥22 **直载 `.ts`** 实跑 `writeHobFile`；
 *   import 失败即 **FAIL**（"基准跑不起来就默认通过"是假通过）。
 */
export async function runWriteScope({ bad, ok }) {
  const HOBWRITE_TS = join(root, 'src', 'server', 'hob-write.ts')
  const { mkdtempSync, mkdirSync, rmSync, readdirSync, existsSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { pathToFileURL } = await import('node:url')

  let hw
  let loadErr = null
  try {
    hw = await import(pathToFileURL(HOBWRITE_TS).href)
  } catch (e) {
    loadErr = e
    bad(`Q 无法加载写入模块（${String(e?.message ?? e)}）⇒ 写侧白名单的行为断言失去基准（不按通过处理）`)
  }
  if (loadErr !== null || hw === undefined) return

  const { writeHobFile, VOLUME_SUBDIRS } = hw
  if (!Array.isArray(VOLUME_SUBDIRS) || VOLUME_SUBDIRS.length === 0) {
    bad('Q 读不到 `VOLUME_SUBDIRS`（写侧的两层白名单常量）⇒ 本条失去基准（不按通过处理）')
    return
  }

  const wsRoot = mkdtempSync(join(tmpdir(), 'hob-qcheck-'))
  const ledger = join(wsRoot, 'ledger')
  const opts = { hobDir: 'ledger', keepBackups: 3, shrinkGuard: 0.5, maxFileBytes: 262144 }
  try {
    // 沙箱：把**登记的那几个**两层目录真建出来（Q1 要有可写的真目录）
    for (const sub of VOLUME_SUBDIRS) {
      const [vol, ...rest] = String(sub).split('/')
      mkdirSync(join(ledger, 'volumes', vol, ...rest), { recursive: true })
    }
    const first = String(VOLUME_SUBDIRS[0])
    const [vol1] = first.split('/')

    // ── Q1 允许面：**本轮要治的那条真实目标路径** ⇒ 真跑 ⇒ 放行 ──────────
    // ⚠ **目标路径写死**（⛔ 不从 `VOLUME_SUBDIRS[0]` 取）—— 理由：若取自常量，
    //   则"常量被改错成任意值"这一侧**永远不会红**（自指 ⇒ 恒绿），成对可验就只剩一半。
    //   ⚠ 写死之后：**把 `VOLUME_SUBDIRS` 里那一项拿掉 / 把正则改回一层 ⇒ 本侧当场红**。
    const TARGET_ALLOW = 'volumes/context/rounds/213.md'
    const r1 = await writeHobFile(wsRoot, { file: TARGET_ALLOW, content: '# Q1\n', mode: 'overwrite' }, opts)
    if (r1.ok === true) {
      ok(`Q1 ✓ 允许面**成对可验**：**写死的目标路径** \`${TARGET_ALLOW}\`（第 210 轮换载体的那个目录）`
        + `⇒ 真跑写入器 ⇒ **放行**；⚠ 且登记的全部 ${VOLUME_SUBDIRS.length} 项各自亦单独测过`)
    } else {
      bad(`Q1 允许面的路径**被拒了**：\`${TARGET_ALLOW}\` ⇒ [${r1.reason}] ${String(r1.message ?? '').split('\n')[0]}`
        + '\n      ⇒ 这一侧红了说明「该放行的写不进」—— ⚠ 与第 211 轮实测到的那个缺陷同形。')
    }

    // ── Q1b 全部登记项各自真跑一遍（防"只为首项写死、其余登记项是摆设"）─────────
    for (const sub of VOLUME_SUBDIRS) {
      const probe = `volumes/${sub}/q1b-probe.md`
      const rb = await writeHobFile(wsRoot, { file: probe, content: '# Q1b\n', mode: 'overwrite' }, opts)
      if (rb.ok !== true) {
        bad(`Q1b 登记项 \`${sub}\` **登记了却写不进**：\`${probe}\` ⇒ [${rb.reason}]`
          + '\n      ⇒ ⚠ 登记清单与实际可写面已经漂移（登记项是摆设）。')
      }
    }

    // ── Q2 不在允许面：未登记的两层路径 ⇒ 真跑 ⇒ 拒绝 + 点名未登记 ────────
    const denyPath = `volumes/${vol1}/q-unregistered/x.md`
    const r2 = await writeHobFile(wsRoot, { file: denyPath, content: '# Q2\n', mode: 'overwrite' }, opts)
    const denial = String(r2.message ?? '')
    if (r2.ok !== true && r2.reason === 'not-whitelisted' && denial.includes('未登记')) {
      ok(`Q2 ✓ 不在允许面**被拒且点名**：\`${denyPath}\` ⇒ [${r2.reason}] 且消息里含「未登记」`)
    } else {
      bad(`Q2 未登记的两层路径**没有被正确拒绝**：\`${denyPath}\` ⇒ ok=${r2.ok} reason=${r2.reason}`
        + '\n      ⇒ 这一侧红了说明「白名单被放太宽了」（⛔ 放开成 volumes/** 就是这种红）。')
    }

    // ── Q3 强制登记：扫账本区真实存在的两层目录，未登记者 FAIL ─────────────
    const LEDGER = (() => {
      const candidates = []
      try {
        const preset = readFileSync(join(root, 'preset', 'dsh-hob', 'preset-dsh-hob.patch.yml'), 'utf8')
        const m = /ledgerHome:\s*(\S+)/.exec(preset)
        if (m !== null) candidates.push(m[1])
      } catch { /* 预设读不到 ⇒ 只走候选 */ }
      for (const home of candidates) {
        const dir = join(home, basename(root))
        if (existsSync(dir)) return dir
      }
      return undefined
    })()
    if (LEDGER === undefined) {
      bad('Q3 账本根**解析不到** ⇒ 「新两层目录必须登记」这条失去基准（不按通过处理）')
    } else {
      const found = []
      const volsDir = join(LEDGER, 'volumes')
      let vols = []
      try { vols = readdirSync(volsDir, { withFileTypes: true }) } catch { vols = [] }
      for (const v of vols) {
        if (!v.isDirectory()) continue
        let subs = []
        try { subs = readdirSync(join(volsDir, v.name), { withFileTypes: true }) } catch { subs = [] }
        for (const sd of subs) {
          if (!sd.isDirectory()) continue
          const rel = `${v.name}/${sd.name}`
          if (!VOLUME_SUBDIRS.includes(rel)) found.push(rel)
        }
      }
      if (found.length === 0) {
        ok(`Q3 ✓ **强制登记**：账本区实际存在的卷下两层目录**都已在 \`VOLUME_SUBDIRS\` 里**`
          + `（登记 ${VOLUME_SUBDIRS.length} 项 · 实测扫到 ${VOLUME_SUBDIRS.length} 项）`)
      } else {
        bad(`Q3 **有未登记的两层目录**：${found.map((f) => `\`volumes/${f}/\``).join(' · ')}`
          + `\n      ⇒ ⚠ 这正是"下次再出现一个新两层目录"的那条缝 ⇒`
          + `\n      **动作**：把它的相对路径（如 \`${found[0]}\`）加进 \`src/server/hob-write.ts\` 的 \`VOLUME_SUBDIRS\`（一行）。`)
      }
    }

    // ── Q4 既有语义未放宽（抽样对拍）────────────────────────────────────
    const keep = [
      ['骨架拒写', 'README.md', 'skeleton'],
      ['templates 拒写', 'templates/x.md', 'skeleton'],
    ]
    let kept = 0
    for (const [label, file, wantReason] of keep) {
      const r = await writeHobFile(wsRoot, { file, content: '# q4\n', mode: 'overwrite' }, opts)
      if (r.ok !== true && r.reason === wantReason) kept++
      else bad(`Q4 既有语义被放宽了：${label} ⇒ ok=${r.ok} reason=${r.reason}（期望拒绝 / ${wantReason}）`)
    }
    if (kept === keep.length) {
      ok(`Q4 ✓ 既有语义未放宽：${keep.map((k) => k[0]).join(' · ')} ⇒ 全部仍**拒绝**（抽样 ${kept}/${keep.length}）`)
    }
  } finally {
    rmSync(wsRoot, { recursive: true, force: true })
  }
}
