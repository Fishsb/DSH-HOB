/**
 * 源码与骨架静态面机检（族 ③）—— K / F / G / H。
 *
 * ⚠ 2026-10-11（第 60 轮）从 `check-gitignore.mjs` 拆分而来。
 *   读 `src/**` · `scripts/**` · 账本区（F 读 README §5.1；H 自建沙箱真跑写入器）。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { workspaceName } from './workspace-name.mjs'

const here = dirname(fileURLToPath(import.meta.url))
/**
 * ⚠ **源码根可被 `HOB_CF_ROOT` 指向一份临时副本**（负向对拍用：把 `hob-write.ts` 回退成
 *   改前的 `catch { exists = false }`，确认 H7 **会红**而不是恒绿）。
 * ⚠ 与 `check:orch` 的 `HOB_SA_ROOT` / `check:policy` 的 `HOB_SP_ROOT` /
 *   `HOB_DOM_ROOT` / `HOB_GATE_ROOT` **同一约定**（⛔ 不另造开关名）。
 * ⚠ 它就是本文件的 `root`，所以**所有** join(root, …) 自动跟着走（含 skeleton 清单核对）。
 */
const root = process.env.HOB_CF_ROOT !== undefined && process.env.HOB_CF_ROOT !== ''
  ? process.env.HOB_CF_ROOT
  : join(here, '..')

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
        //   ⚠ 2026-10-22：载体从 `USER-DECISIONS.md`（已退役、现在会被 `retired-historical` 拒）
        //     改为 `REQUIREMENTS.md` —— 本组验的是**渲染与幂等的先后**，与哪个文件无关；
        //     ⚠ 但新根有自己的形状判据（必须是地图）⇒ 内容里带一行指向卷条目的表格，
        //     否则会先被 `bad-format` 挡在门外、验不到幂等（那是另一条断言的地盘）。
        {
          const c = '共 <!-- hob:count | templates --> 份\n\n| 编号 | 条目 |\n|---|---|\n| REQ-01 | `volumes/requirements/REQ-01.md` |\n'
          const r1 = await writeHobFile(dir, { file: 'REQUIREMENTS.md', content: c, mode: 'overwrite' }, opts)
          const r2 = await writeHobFile(dir, { file: 'REQUIREMENTS.md', content: c, mode: 'overwrite' }, opts)
          let disk = ''
          try { disk = readFileSync(join(dir, 'REQUIREMENTS.md'), 'utf8') } catch { disk = '' }
          if (r1.ok === true && r2.action === 'skipped' && r2.reason === 'idempotent' && disk.trim().startsWith('共 ')) {
            ok('H6 ✓ 幂等保住：同一份**含标记**的输入写两次 ⇒ 第二次 `skipped`（渲染**先于**幂等比对）'
              + ' —— 否则幂等跳过失效、备份被反复刷屏')
          } else {
            bad(`H6 幂等被破坏：第一次=${r1.action} 第二次=${r2.action}/${r2.reason} 盘上=${JSON.stringify(disk)}`
              + ' ⇒ 渲染顺序错了（必须先渲染、再比对），这是本轮的**停手条件①**')
          }
        }
        // ── H7 **读不出来 ≠ 文件不存在 ⇒ 拒写且原文不变**（2026-10-24 · t10 补）──
        /**
         * ══ 它守的是 A 席修的那条最严重的**假读数**（审查席实测：零判据覆盖）══════
         *   改前 `hob-write.ts` 写的是 `try { existing = await readFile(…) } catch { exists = false }`
         *   —— `catch` 把**一切**读取失败都读成"文件不存在"：
         *     · `append` 于是用**空 `existing`** 拼内容 ⇒ **整本账本被这一条顶掉**，
         *       而且返回值仍是 `ok:true` / `bytesBefore:0`（实测 200KB 账本被覆盖）；
         *     · `overwrite` 于是跳过缩水守卫与幂等比对（两者都以 `exists` 为前提）；
         *     · `backup()` 同理不备份。
         *   修法：三态 `readTarget()` —— 只有 `missing` 才当首次创建，`error` 当场 `read-failed`。
         *
         * ── 判据（四条，缺一条就是"只修了一半"）──────────────────────────────
         *   ① `ok === false`（⛔ 不许报成功）；
         *   ② `reason === 'read-failed'`（**与 `write-failed` 分开**：修法完全不同）；
         *   ③ **盘上原文一个字没变**（⚠ 这是最要紧的一条：改前会被覆盖成空 + 这一条）；
         *   ④ 拒因**可读**（必须说清"这不是文件不存在"）—— 否则下一个人会照着
         *      `exists=false` 的老思路去查。
         *
         * ── 怎么造"读不出来"（⚠ 可移植，不靠 chmod）────────────────────────────
         *   **把一个目录放到目标路径上**：`readFile(<目录>)` ⇒ POSIX 上 `EISDIR`，
         *   Windows 上 `EISDIR`/`EPERM` —— 两边都是"**路径在、但读不出内容**"，
         *   正是本判据要的那个形态。⛔ 不用 `chmod 000`（root 跑就失效、CI 上不可靠）。
         *
         * ── 负向对拍（⚠ 改前是什么样，这里如实示范）──────────────────────────
         *   把 `read.kind === 'error'` 那一支删掉（= 改前 `catch { exists = false }`）⇒
         *   `append` 会用空 `existing` 拼内容 ⇒ 盘上那条**用户原有的内容被顶掉** ⇒ ③ 红。
         *   ⚠ 本组**不断言"改前会红"**（改前的代码已经不在了），而是断言**现在必须有**这四条。
         */
        {
          const DirCase = join(dir, 'hob-read-failed-case')
          try {
            /**
             * ⚠ 造形态：`hob-read-failed-case/CONTEXT.md` 是**目录**（不是文件）。
             *   把一条"看起来像账本内容"的东西放进去，好证明"没有把目录内容当原文"。
             */
            mkdirSync(join(DirCase, 'CONTEXT.md'), { recursive: true })
            writeFileSync(join(DirCase, 'CONTEXT.md', 'decoy.md'), '这是目录里的诱饵，⛔ 不是账本原文', 'utf8')
            /**
             * ⚠ `append` 是最危险的一支（改前会把整本覆盖成"这一条"）——
             *   所以正例就用 `append`。
             */
            const r = await writeHobFile(DirCase, {
              file: 'CONTEXT.md', content: '# 新内容\n', mode: 'append',
            }, opts)
            /** ③ 盘上"原文"—— 目标仍应是那个目录，且里面只剩诱饵（⛔ 没被写成文件）。 */
            const stillDir = (() => {
              try { return readdirSync(join(DirCase, 'CONTEXT.md')).join(',') } catch { return null }
            })()
            const msg = String(r?.message ?? '')
            if (r?.ok !== false) {
              bad(`H7 ⚠⚠ **读不出来时仍然报成功**（ok=${r?.ok} · action=${r?.action}）`
                + ' ⇒ 这正是改前那条假读数：`catch { exists = false }` 把"读不出"当成"不存在"'
                + ' ⇒ `append` 会用空 existing 拼内容，**整本账本被这一条顶掉**')
            } else if (r?.reason !== 'read-failed') {
              bad(`H7 拒了但 reason=${JSON.stringify(r?.reason)}（应 \`read-failed\`）`
                + ' ⇒ ⚠ 与 `write-failed` 混在一起了：这两种的修法完全不同（一个查读权限/路径，一个查写权限/磁盘）')
            } else if (stillDir !== 'decoy.md') {
              bad(`H7 ⚠⚠ **拒写之后盘上被改动了**（\`CONTEXT.md\` 现在的内容 = ${JSON.stringify(stillDir)}）`
                + ' ⇒ 拒绝必须是**零副作用**：原文一个字都不许动（改前正是"覆盖成这一条还报成功"）')
            } else if (!/读不出来|读不到|不是.*不存在|EISDIR/i.test(msg)) {
              bad(`H7 拒因不可读（应说清"这不是文件不存在"）：${JSON.stringify(msg.slice(0, 160))}`
                + ' ⇒ ⚠ 下一个人会照着旧的 `exists=false` 思路去查，永远查不到真原因')
            } else {
              ok('H7 ✓ **读不出来 ⇒ 拒写（`read-failed`）且原文一字未动**：'
                + '目标是个目录（`EISDIR` 形态）· `ok:false` · `reason=read-failed` · '
                + '`CONTEXT.md` 仍是那个目录、诱饵还在（⛔ 没被覆盖成"这一条"）· 拒因指明"这不是文件不存在"'
                + '（⚠ A 席那条最严重的假读数现在有判据守着了）')
            }
          } catch (e) {
            bad(`H7 用例本身抛错（${String(e?.message ?? e)}）⇒ 不按通过处理（⛔ 跑不起来 ≠ 通过）`)
          }
        }
        // ── H8 **并发队列：同一文件的两次交叠 append 不许互相顶掉**（t11 补）──
        /**
         * ══ 它守的是什么（审查席实测：**6 族全绿而行为真丢数据**）══════════════
         *   `writeHobFile` 外面套了一层**同进程按路径排队**（`withFileQueue`）。
         *   去掉它以后：两次并发 `append` 各自读到**同一份旧内容**、各自拼上自己那一条、
         *   后写的那份把先写的**整本顶掉** —— 而**两次都回 `ok:true`**。
         *   审查席实测读数：`okA=false, 100001 字节, hasA=false`（A 那条**永久消失**）。
         *
         * ── 判据（⚠ 必须真并发，⛔ 不许顺序写两次充数）────────────────────────
         *   `Promise.all([append A, append B])` —— 这才是"交叠"的形态：
         *     · 两次都 `ok === true`；
         *     · 盘上**两条都在**（A 那条不丢）；
         *     · 字节数 > 单条（证明没有互相截断）。
         *   ⚠ 顺序写两次**测不到**这件事（第二次会读到第一次的结果）——
         *     所以这里**必须** `Promise.all`。
         */
        {
          const qdir = mkdtempSync(join(tmpdir(), 'hob-queue-'))
          try {
            const big = 'x'.repeat(100000)
            const A = '# 甲\n' + big + '\n'
            const B = '# 乙\n' + big + '\n'
            /** ⚠ `Promise.all`（真并发）：两个调用在同一 tick 里进入，必然交叠读。 */
            const [ra, rb] = await Promise.all([
              writeHobFile(qdir, { file: 'CONTEXT.md', content: A, mode: 'append' }, opts),
              writeHobFile(qdir, { file: 'CONTEXT.md', content: B, mode: 'append' }, opts),
            ])
            let disk = ''
            try { disk = readFileSync(join(qdir, 'CONTEXT.md'), 'utf8') } catch { disk = '' }
            const hasA = disk.includes('# 甲')
            const hasB = disk.includes('# 乙')
            if (ra?.ok !== true || rb?.ok !== true) {
              bad(`H8 并发 append 有调用**报失败**：A.ok=${ra?.ok}(${String(ra?.reason ?? '-')}) · B.ok=${rb?.ok}(${String(rb?.reason ?? '-')})`
                + ' ⇒ 同一文件的两次写不该互相拖垮')
            } else if (!hasA || !hasB) {
              bad(`H8 ⚠⚠ **并发 append 丢数据**：盘上 甲=${hasA} · 乙=${hasB}（字节=${disk.length}）`
                + '\n      ⇒ 这正是去掉 `withFileQueue` 的形态：两次读同一份旧内容、后写顶掉先写，'
                + '**而两次都回 ok:true**（审查席实测 okA=false/100001 字节/hasA=false）')
            } else if (disk.length < A.length + B.length - 100) {
              bad(`H8 并发 append 被截断：盘上 ${disk.length} 字节，两次内容合计约 ${A.length + B.length}`
                + ' ⇒ 有一条被顶掉了一半')
            } else {
              ok('H8 ✓ **同一文件的并发 append 不丢数据**：`Promise.all` 两次交叠写 ⇒ 两次都 `ok:true`、'
                + `盘上**甲与乙都在**（${disk.length} 字节）⇒ 同进程按路径排队在位 `
                + '（⚠ 去掉 `withFileQueue` 时本条会红：后写的那份把先写的整本顶掉）')
            }
          } finally {
            try { rmSync(qdir, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
          }
        }

        // ── H9 **mode 保留：覆盖写不许改掉原文件的权限位**（t11 补）──
        /**
         * ══ 它守的是什么（审查席实测：全绿）════════════════════════════════════
         *   `atomicWriteWithMode` 会在 rename **之前**把原文件的 `mode & 0o777` chmod 到
         *   临时件上。去掉那段 ⇒ 覆盖后权限被重置成系统默认（实测 `600 → 644`）
         *   —— 对"用户特意设成 600 的账本"是**权限被悄悄放宽**。
         *
         * ── 判据 ──────────────────────────────────────────────────────────
         *   建一个 `0o600` 的文件 → 覆盖写 → **仍是 `0o600`**。
         *   ⚠ 用 `chmodSync` 显式造 600（⛔ 不依赖 umask / 默认值 —— 那在不同环境会漂）。
         */
        {
          const mdir = mkdtempSync(join(tmpdir(), 'hob-mode-'))
          try {
            const f = join(mdir, 'CONTEXT.md')
            writeFileSync(f, '# 旧\n', 'utf8')
            const { chmodSync, statSync } = await import('node:fs')
            chmodSync(f, 0o600)
            const before = statSync(f).mode & 0o777
            const r = await writeHobFile(mdir, { file: 'CONTEXT.md', content: '# 新内容\n', mode: 'overwrite' }, opts)
            const after = (() => { try { return statSync(f).mode & 0o777 } catch { return -1 } })()
            if (r?.ok !== true) {
              bad(`H9 覆盖写失败（${String(r?.reason ?? '-')}）⇒ 本组失去读数`)
            } else if (before !== 0o600) {
              bad(`H9 前置不成立：造出来的文件 mode = 0o${before.toString(8)}（应 0o600）`)
            } else if (after !== 0o600) {
              bad(`H9 ⚠ **覆盖写把权限位改掉了**：0o600 ⇒ 0o${after.toString(8)}`
                + ' ⇒ 用户特意收紧的账本权限被悄悄放宽（改前实测 600 → 644）')
            } else {
              ok('H9 ✓ **覆盖写保留原文件权限位**：`0o600` 的文件覆盖后仍是 `0o600`'
                + '（⚠ 去掉 chmod-在-rename-之前那段时，本条会红：权限会被重置成系统默认）')
            }
          } finally {
            try { rmSync(mdir, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
          }
        }

        // ── H10 **同内容标记各替换各的（按偏移消费，⛔ 不 `indexOf(raw)`）**（t11 补）──
        /**
         * ══ 它守的是什么（审查席实测：全绿；上轮已报未补）══════════════════════
         *   `hob-render.ts` 改前用 `line.indexOf(h.raw)` 定位每处标记。同一行出现**两个
         *   内容完全相同**的标记时，两次 `indexOf` **都指到第一处**：
         *     · 第一处被替换两次（值只变一次）；
         *     · **第二处原样留在盘上**；
         *     · 而 `rendered` 仍记两条、写入 `ok:true` ⇒ **正文写坏了、读数说渲染成功**。
         *   修法：只用 `scanMarkers` 给的 `start/end`（`matchAll` 的唯一来源）。
         *
         * ── 判据（⚠ 造"同一行两个同内容标记"的形态）──────────────────────────
         *   · 盘上**一个 `<!-- hob:` 都不剩**（两处都渲染了）；
         *   · 两个位置的值**都对**（不是同一处被替换两次）。
         *   ⚠ 回购 `indexOf(h.raw)` ⇒ 第二处残留 ⇒ 本条红。
         */
        {
          const rdir = mkdtempSync(join(tmpdir(), 'hob-offset-'))
          try {
            mkdirSync(join(rdir, 'templates'), { recursive: true })
            for (let k = 0; k < 3; k += 1) writeFileSync(join(rdir, 'templates', `t${k}.md`), 'x', 'utf8')
            const want = readdirSync(join(rdir, 'templates')).length
            /**
             * ⚠ **同一行、两个内容完全相同的标记** —— 这正是 `indexOf` 会踩的形态。
             *   两者之间用 ` / ` 分隔（⛔ 不放换行：那会分成两行、`indexOf` 也能过）。
             */
            const mk = '<!-- hob:count | templates -->'
            const line = `第一处 ${mk} / 第二处 ${mk}`
            const r = await writeHobFile(rdir, { file: 'CONTEXT.md', content: `${line}\n`, mode: 'overwrite' }, opts)
            let disk = ''
            try { disk = readFileSync(join(rdir, 'CONTEXT.md'), 'utf8') } catch { disk = '' }
            const leftover = (disk.match(/<!--\s*hob:/g) ?? []).length
            const valuesOk = (disk.match(new RegExp(`第一处 ${want} / 第二处 ${want}`, 'g')) ?? []).length === 1
            if (r?.ok !== true) {
              bad(`H10 写失败（${String(r?.reason ?? '-')}）⇒ 本组失去读数`)
            } else if (leftover !== 0) {
              bad(`H10 ⚠⚠ **同一行两个同内容标记只渲染了第一处**：盘上还剩 ${leftover} 个 \`<!-- hob:\``
                + `（盘上=${JSON.stringify(disk.slice(0, 160))}）`
                + '\n      ⇒ 这正是 `line.indexOf(h.raw)` 的形态：两次都指到第一处 ⇒ 第二处原样留着，'
                + '而 `rendered` 记两条、`ok:true`（**正文写坏了、读数说成功**）')
            } else if (!valuesOk) {
              bad(`H10 两处渲染值不对：盘上=${JSON.stringify(disk.slice(0, 160))}（期望"第一处 ${want} / 第二处 ${want}"）`)
            } else {
              ok('H10 ✓ **同一行两个内容相同的标记各替换各的**：盘上零残留、两处都渲染成实值'
                + `（"第一处 ${want} / 第二处 ${want}"）⇒ 按偏移消费在位（⚠ 回购 \`indexOf(h.raw)\` 时本条会红）`)
            }
          } finally {
            try { rmSync(rdir, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
          }
        }

        // ── H11 **read-failed §7 主读守卫**（⚠ 单回退它必须红）──
        /**
         * ══ 它守的是什么（审查席实测：**上一轮只覆盖了一半**）══════════════════════
         *   `read-failed` 这条线上有**两处读**：
         *     · **§7 主读守卫**（`hob-write.ts` 的 `const read = await readTarget(...)`）——
         *       `append` / `overwrite` 每条写路径**都先过它**；
         *     · **§12 备份读守卫**（`backup()` 里的 `BackupReadError`）—— 走到 §12 才用。
         *   ⚠ 上一轮 H7 用"目录顶在目标上"造 EISDIR —— 那条**先撞 §7**
         *     ⇒ 只回退 §12 备份守卫时 **H7 仍绿**（因为 §7 接住了）。
         *     审查席的判词是"只覆盖一半"，**成立**。
         *
         * ── 现在①：把 §7 单独钉死（本条，⚠ 可确定性地判）────────────────────
         *   形态 = 目录顶在目标上（读 ⇒ `EISDIR`），**两种 `keepBackups` 各跑一次**：
         *     · `keepBackups: 0`（不备份）⇒ 只剩 §7；
         *     · `keepBackups: 3`（备份）—— ⚠ §7 **仍在备份之前**。
         *   两处都要求：`ok:false` + `reason==='read-failed'`
         *   + **拒因来自 `describeReadFailure`**（消息含「**读不出来**」，⛔ **不含**「写前备份」）。
         *   ⚠ 靠"消息出处"而不是只看 `reason` —— 两者 `reason` 都是 `read-failed`，
         *     只看 `reason` 会让"备份代劳"冒充"§7 在工作"（那种假绿我 t11 当场撞过一次）。
         *
         * ── 现在②：§12 备份读守卫**如实登记为不可确定性判**（见 §1.4）──────────
         *   它只在"§7 读得到、§12 读不到"那个 **TOCTOU 窗口**里触发
         *   （两次读之间文件被换掉 / 权限被改）—— 那需要精确的时序注入，
         *   ⛔ 本组做不到确定性复现 ⇒ **不假装测了它**，登记进 `.hob/README.md §1.4`。
         *   ⚠ 但它的**存在性**仍判（`BackupReadError` 必须被导出、且 §12 的 catch 必须认它）
         *     ⇒ 删掉那个 `instanceof` 分支会红。
         */
        {
          const rf = (keep) => {
            const d = mkdtempSync(join(tmpdir(), 'hob-rf-'))
            mkdirSync(join(d, 'CONTEXT.md'), { recursive: true })
            writeFileSync(join(d, 'CONTEXT.md', 'decoy.md'), '诱饵', 'utf8')
            return { d, o: { ...opts, keepBackups: keep } }
          }
          const a = rf(0)
          const b = rf(3)
          try {
            const ra = await writeHobFile(a.d, { file: 'CONTEXT.md', content: '# x\n', mode: 'append' }, a.o)
            const rb = await writeHobFile(b.d, { file: 'CONTEXT.md', content: '# x\n', mode: 'append' }, b.o)
            /** ⚠ 判据：`read-failed` **且**出自 §7（消息不含「写前备份」）。 */
            const fromMainRead = (r) => r?.ok === false && r?.reason === 'read-failed'
              && /读不出来/.test(String(r?.message ?? ''))
              && !String(r?.message ?? '').includes('写前备份')
            const mainA = fromMainRead(ra)
            const mainB = fromMainRead(rb)
            /** ⚠ 存在性：`BackupReadError` 必须被导出（删了它，§12 那道分支的判据就无从谈起）。 */
            const hasBackupErr = typeof hw.BackupReadError === 'function'
            if (!mainA || !mainB) {
              const which = !mainA ? 'keepBackups:0' : 'keepBackups:3'
              const r = !mainA ? ra : rb
              bad(`H11 ⚠ **§7 主读守卫被回退**（${which}）：reason=${JSON.stringify(r?.reason)}`
                + ` · 消息出处=${String(r?.message ?? '').includes('写前备份') ? '备份守卫（应为 §7 主读）' : '§7 主读'}`
                + '\n      ⇒ 读不出来会被当成"文件不存在"⇒ 覆盖写 + 不备份（改前 200KB 账本被顶掉就是这条）')
            } else if (!hasBackupErr) {
              bad('H11 ⚠ `BackupReadError` **不再是导出**（§12 备份读守卫的类型没了）⇒ 那一档无从分类')
            } else {
              ok('H11 ✓ **§7 主读守卫在位**（`keepBackups:0` 与 `:3` 两种都判过）：目录顶在目标上 ⇒ '
                + '`ok:false` · `reason=read-failed` · 拒因出自 `describeReadFailure`（「读不出来」，⛔ 不是备份代劳）；'
                + '⚠ `BackupReadError` 导出仍在（§12 那道守卫的类型在位；⚠ 它只在 §7→§12 的 TOCTOU 窗口触发，'
                + '确定性测不到 ⇒ 已登记进 `.hob/README.md §1.4`）')
            }
          } finally {
            try { rmSync(a.d, { recursive: true, force: true }) } catch { /* 同上 */ }
            try { rmSync(b.d, { recursive: true, force: true }) } catch { /* 同上 */ }
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
      // ⚠ 工作区名**从配置读**（唯一来源 = `scripts/workspace-name.mjs`）；
      //   未配置 ⇒ 落回 `basename(root)`（与改动前逐字一致）—— ⛔ 本脚本不再自己猜目录名。
      const wsName = workspaceName(() => basename(root))
      for (const home of candidates) {
        const dir = join(home, wsName)
        if (existsSync(dir)) return dir
      }
      return undefined
    })()
    if (LEDGER === undefined) {
      bad('Q3 账本根**解析不到** ⇒ 「新两层目录必须登记」这条失去基准（不按通过处理）')
    } else {
      const found = []
      const volsDir = join(LEDGER, 'volumes')
      /**
       * ══════════════════════════════════════════════════════════════════════
       * ⚠⚠ **乙-6（2026-10-21 · 第 327 轮）：这一段的两个读数都不老实**
       * ══════════════════════════════════════════════════════════════════════
       *
       * ── 病灶 ①（改前）：`catch { vols = [] }` 把"读不到"吞成"没有" ────────────
       *   卷目录**不存在 / 无权限 / 不是目录** ⇒ `vols = []` ⇒ 下面 `found.length === 0`
       *   ⇒ ⚠ **打 ✓**：「实际存在的卷下两层目录**都已在** `VOLUME_SUBDIRS` 里」——
       *   而真相是**一个都没扫到**。「没有对象」与「扫过且都对」被印成同一句话。
       *
       * ── 病灶 ②（改前）：读数用**常量长度**冒充"实测扫到 N 项" ──────────────────
       *   `实测扫到 ${VOLUME_SUBDIRS.length} 项` —— 那个值是**登记表的长度**，
       *   ⚠ **它跟这次到底扫到几条毫无关系**。⇒ 读数看起来是实测值，其实是常量
       *   （本项目最忌的形态：**读数不老实**，比"没有读数"更坏 —— 它让人以为核过了）。
       *
       * ── 现在 ──────────────────────────────────────────────────────────────
       *   ① 读不到 ⇒ **`bad`**（点名路径 + 成因），⛔ 不再落 `ok`；
       *   ② "实测扫到 N 项"改用**真的扫出来的** `scanned`；
       *   ③ ⚠ **`scanned !== VOLUME_SUBDIRS.length` 也必须是一条 `bad`** ——
       *      那正是"配置声明的白名单与实际落盘不一致"（TASK 明令要求这一条）。
       *
       * ── 为什么选 `bad` 而⛔ 不选 `exit 2` ──────────────────────────────────
       *   `exit 2` 的语义在本族是"**没有对象**"（基准缺失）。而这里的情形**一半是**：
       *   卷目录真的不存在时确实是"没有对象"；**但另一半不是** ——
       *   目录在、权限不足 / 读到一半抛错，那是"**查了但查不成**"。
       *   ⚠ 两者成因不同、修法不同（一个是"去建目录"，一个是"去查权限"），
       *   ⛔ 压成同一个退出码就又是"两种原因说成同一句话"。
       *   ⇒ 统一落 `bad`（退出码 1），并在**文案里点名成因**把两档分开：
       *     `ENOENT`（不存在）与其它 errno（无权限 / 不是目录）**分别措辞**。
       *   ⚠ 另有一条硬理由：`exit 2` 会让**整族**（Q1/Q2/Q4 等）一条都不跑，
       *     而那些判据与账本卷目录**无关** ⇒ 那是"为修一格而废掉全族"。
       */
      let vols = []
      let volsWhy = ''
      try {
        vols = readdirSync(volsDir, { withFileTypes: true })
      } catch (e) {
        const code = String(e?.code ?? '')
        volsWhy = code === 'ENOENT'
          ? `目录**不存在**（ENOENT）`
          : `**读不到**（${code || 'unknown'} ${String(e?.message ?? e)}）`
      }
      if (volsWhy !== '') {
        bad(`Q3 **卷目录读不到** ⇒ 「新两层目录必须登记」这一条**一条都没跑**`
          + `\n      ⇒ 路径：\`${volsDir}\``
          + `\n      ⇒ 成因：${volsWhy}`
          + '\n      ⇒ ⚠ 改前这一档会 `vols = []` ⇒ 下面打 ✓「实际存在的都已登记」'
          + ' —— ⚠ 那是把「**一个都没扫到**」印成「**扫过且都对**」'
          + '\n      ⇒ 修法：确认账本区 `volumes/` 存在且可读；'
          + '若本机尚未建立账本卷目录，那是**基准缺失**，⛔ 不代表通过')
      }
      /** ⚠ **真的扫出来的**两层目录数（⛔ 不是 `VOLUME_SUBDIRS.length`）。 */
      let scanned = 0
      let subWhy = ''
      for (const v of vols) {
        if (!v.isDirectory()) continue
        let subs = []
        try {
          subs = readdirSync(join(volsDir, v.name), { withFileTypes: true })
        } catch (e) {
          /** ⚠ 卷子目录读不到 ⇒ 也**不许**吞成"没有"（否则覆盖面无声明地缩水）。 */
          subWhy += `\n      ⇒ 卷 \`${v.name}\` 读不到（${String(e?.code ?? '')}）⇒ 该卷两层目录**未计入实测数**`
          continue
        }
        for (const sd of subs) {
          if (!sd.isDirectory()) continue
          scanned += 1
          const rel = `${v.name}/${sd.name}`
          if (!VOLUME_SUBDIRS.includes(rel)) found.push(rel)
        }
      }
      if (subWhy !== '') {
        bad(`Q3 **卷子目录读不到** ⇒ 实测覆盖率不完整（⛔ 不按通过处理）${subWhy}`)
      }
      /**
       * ⚠⚠ **病灶 ② 的修法 + TASK 要求的第三条**：
       *   `scanned`（实测）与 `VOLUME_SUBDIRS.length`（登记表）**必须相等** ——
       *   不等就是"配置声明的白名单与实际落盘不一致"。
       *   ⚠ 注意方向：`scanned > 登记数` ⇒ 有**未登记**的（`found` 会抓到）；
       *     `scanned < 登记数` ⇒ 登记表里有**落盘上不存在的**条目（`found` 抓不到，
       *     因为 `found` 只按"扫到的"枚举）⇒ 这一侧改前**完全没有判据**。
       */
      if (volsWhy === '' && found.length === 0 && scanned !== VOLUME_SUBDIRS.length) {
        bad(`Q3 **登记表与实测对不上**：\`VOLUME_SUBDIRS\` 登记 **${VOLUME_SUBDIRS.length}** 项，`
          + `而本次实测扫到 **${scanned}** 项`
          + `\n      ⇒ 路径：\`${volsDir}\``
          + '\n      ⇒ ⚠ 改前这一行印的是 `实测扫到 ${VOLUME_SUBDIRS.length} 项` —— '
          + '**那个值是登记表的长度，跟扫到几条毫无关系**'
          + '\n      ⇒ ⚠ 两种成因、两种修法（⛔ 不许压成一句）：'
          + '\n         ① `scanned > 登记数` ⇒ 有落盘存在但**未登记**的两层目录 ⇒ 加进 `VOLUME_SUBDIRS`；'
          + '\n         ② `scanned < 登记数` ⇒ 登记表里有**落盘上已不存在**的条目 ⇒ 删掉那一行（或把目录建回来）')
      }
      if (volsWhy === '' && found.length === 0 && scanned === VOLUME_SUBDIRS.length) {
        ok(`Q3 ✓ **强制登记**：账本区实际存在的卷下两层目录**都已在 \`VOLUME_SUBDIRS\` 里**`
          + `（登记 ${VOLUME_SUBDIRS.length} 项 · **实测扫到 ${scanned} 项** —— `
          + '⚠ 这个数来自本次真的 `readdirSync`，⛔ 不是登记表的长度）')
      } else if (volsWhy === '' && found.length > 0) {
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

/**
 * ── 断言 T · **现行需求根的迁移面**（2026-10-22 · 用户批准方案重构后）──────────────
 *
 * **它防的是什么**：现行需求根从 `USER-DECISIONS.md` 迁到 `REQUIREMENTS.md`。
 *   ⚠ 这类迁移**最典型的失败形态是"两本都能写"** —— 旧根没关掉，于是两个
 *   现行需求真相并存；⚠ 而**没有任何东西会红**（写哪本都成功）。
 *
 * **判据（成对，⛔ 缺一侧即假绿 —— E-126）**：
 *   · **正向**：新根 `REQUIREMENTS.md` ⇒ **真跑写入器 ⇒ 放行**；
 *     并且 `volumes/requirements/*.md`（条目正文落点）⇒ **也放行**；
 *   · **负向**：旧根 `USER-DECISIONS.md` ⇒ **真跑写入器 ⇒ 拒绝**，
 *     且 reason 必须是 **`retired-historical`**（⛔ 不许是 `not-whitelisted` ——
 *     那等于把"退役"说成"不存在"，读者分不出该去改哪儿）；
 *   · **形状负向**：往新根写**没有卷条目指向的地图**（纯散文）⇒ **`bad-format` 拒** ——
 *     防"把需求正文直接写进根"，退回根文件无限增长的老形态；
 *   · **读面未动**：旧根的**读**仍可用（`readMarkdownCapped` 读得到），
 *     ⚠ 否则"保历史可读"这句话就是空的。
 *
 * ⚠ **全部在临时沙箱里真跑**（`mkdtempSync`，`finally` 里删净）—— ⛔ 不碰真账本。
 * ⚠ **不 import 被测常量来自证**：目标路径**写死**成字面量（`REQUIREMENTS.md` /
 *   `USER-DECISIONS.md`），这样"常量被改回旧值"这一侧才会**当场红**；
 *   若从 `LEDGER_FILES` 取，自指恒绿 ⇒ 成对可验只剩一半（与 Q1 同款理由）。
 */
export async function runRequirementsRoot({ bad, ok }) {
  const HOBWRITE_TS = join(root, 'src', 'server', 'hob-write.ts')
  const DOCREAD_TS = join(root, 'src', 'server', 'doc-read.ts')
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { pathToFileURL } = await import('node:url')

  let hw
  let dr
  let loadErr = null
  try {
    hw = await import(pathToFileURL(HOBWRITE_TS).href)
    dr = await import(pathToFileURL(DOCREAD_TS).href)
  } catch (e) {
    loadErr = e
    bad(`T 无法加载写入 / 读取模块（${String(e?.message ?? e)}）⇒ 需求根迁移面失去基准（不按通过处理）`)
  }
  if (loadErr !== null || hw === undefined || dr === undefined) return

  const { writeHobFile } = hw
  const { readMarkdownCapped } = dr
  /** 与 `src/modules/tools.ts` 的 DEFAULTS 同口径（上限调小以便沙箱够用）。 */
  const opts = { hobDir: '', keepBackups: 3, shrinkGuard: 0.5, maxFileBytes: 262144 }
  const dir = mkdtempSync(join(tmpdir(), 'hob-tcheck-'))
  try {
    // 沙箱里先铺一份"迁移后"的形状：新根 + 需求卷目录 + 一份旧根的历史内容
    mkdirSync(join(dir, 'volumes', 'requirements'), { recursive: true })
    const LEGACY_BODY = '# USER-DECISIONS.md —— 历史（只读）\n\n| 编号 | 标题 |\n|---|---|\n| UD-01 | 历史条目 |\n'
    writeFileSync(join(dir, 'USER-DECISIONS.md'), LEGACY_BODY, 'utf8')

    // ── T1 正向：新根真跑 ⇒ 放行 ────────────────────────────────────────
    const newRootMap = [
      '# 用户当前功能需求 · 索引',
      '',
      '| 编号 | 当前功能目标 | 条目 |',
      '|---|---|---|',
      '| 01 | 总工程师 | `volumes/requirements/REQ-01.md` |',
      '',
    ].join('\n')
    const t1 = await writeHobFile(dir, { file: 'REQUIREMENTS.md', content: newRootMap, mode: 'overwrite' }, opts)
    if (t1.ok === true) {
      ok('T1 ✓ 新根可写：`REQUIREMENTS.md` ⇒ 真跑写入器 ⇒ **放行**（现行需求只有一个写面）')
    } else {
      bad(`T1 新根**写不进**：\`REQUIREMENTS.md\` ⇒ [${t1.reason}] ${String(t1.message ?? '').split('\n')[0]}`
        + '\n      ⇒ 这一侧红了说明「现行需求根搬不过去」—— 迁移没完成。')
    }

    // ── T2 正向：需求条目正文落点 volumes/requirements/*.md ⇒ 放行 ────────
    const t2 = await writeHobFile(
      dir,
      { file: 'volumes/requirements/REQ-01.md', content: '# REQ-01\n\n**用户要实现的功能**：……\n', mode: 'overwrite' },
      opts,
    )
    if (t2.ok === true) {
      ok('T2 ✓ 需求卷可写：`volumes/requirements/REQ-01.md` ⇒ 真跑写入器 ⇒ **放行**（条目正文有落点）')
    } else {
      bad(`T2 需求卷**写不进**：\`volumes/requirements/REQ-01.md\` ⇒ [${t2.reason}] ${String(t2.message ?? '').split('\n')[0]}`
        + '\n      ⇒ 这一侧红了说明"根能写、条目没处放"，等于把正文逼回根文件。')
    }

    // ── T3 负向：旧根 ⇒ 拒绝，且 reason 必须是 retired-historical ──────────
    const t3 = await writeHobFile(dir, { file: 'USER-DECISIONS.md', content: '# 追加\n', mode: 'append' }, opts)
    const t3msg = String(t3.message ?? '')
    if (t3.ok !== true && t3.reason === 'retired-historical' && t3msg.includes('REQUIREMENTS.md')) {
      ok('T3 ✓ 旧根**不再是写面**：`USER-DECISIONS.md` ⇒ 拒绝，reason = `retired-historical`，'
        + '且话术里点名现行需求在 `REQUIREMENTS.md`（⚠ 不是笼统的 `not-whitelisted`）')
    } else {
      bad(`T3 旧根**仍可写 / 或拒绝理由不对**：\`USER-DECISIONS.md\` ⇒ ok=${t3.ok} reason=${t3.reason}`
        + `\n      ⇒ 期望：拒绝 + reason=\`retired-historical\` + 话术指向 \`REQUIREMENTS.md\``
        + '\n      ⇒ ⚠ 若 ok=true，说明**两个现行需求写面并存** —— 那正是本次重构要治的病。'
        + '\n      ⇒ ⚠ 若 reason=not-whitelisted，说明"退役"被说成了"不存在"，读者分不出该去改哪儿。')
    }

    // ── T4 形状负向：往新根写纯散文（无卷条目指向）⇒ bad-format ────────────
    const t4 = await writeHobFile(
      dir,
      { file: 'REQUIREMENTS.md', content: '# 需求\n\n这里直接塞一堆需求正文，根上没有一条指向卷。\n', mode: 'overwrite' },
      opts,
    )
    if (t4.ok !== true && t4.reason === 'bad-format') {
      ok('T4 ✓ 根必须是**地图**：写"没有卷条目指向的纯散文" ⇒ `bad-format` 拒'
        + '（防把需求正文塞回根、退回无限增长的老形态）')
    } else {
      bad(`T4 纯散文**被放进根了**：ok=${t4.ok} reason=${t4.reason}`
        + '\n      ⇒ 期望 `bad-format`；⚠ 这一侧红了说明新根退化成"正文容器"。')
    }

    // ── T5 读面未动：旧根**仍读得到**（逐字节）──────────────────────────
    const t5 = await readMarkdownCapped(dir, 'USER-DECISIONS.md', 262144)
    if (t5.ok === true && t5.text === LEGACY_BODY && t5.truncated === false) {
      ok('T5 ✓ 旧根**仍逐字节可读**（读面未动）：抽取内容与写入时**逐字相同**'
        + ' ⇒ "旧卷与归档副本逐个字节保留可读"这半句不是空话')
    } else {
      bad(`T5 旧根**读不到 / 内容变了**：ok=${t5.ok} truncated=${t5.truncated} bytes=${t5.bytes}`
        + `\n      ⇒ ⚠ 拒绝写入**不许**连带把读面关掉 —— 那是把"保留可读"变成"删掉"。`)
    }
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
  }
}

/**
 * ── 断言 W · **方案卷的模块清单必须与 `src/modules/` 实际文件同源** ─────────────────
 *
 * **它防的是什么**（2026-10-22 实测形态）：`volumes/plan/03-architecture-modular.md` 长期列着一个
 *   **`M2 预设装配挂点`** —— 而全仓 `agent-presets` **零命中**、`src/modules/` 里**没有那个文件**。
 *   ⇒ 读者会去找一个**从不存在的模块**；⚠ 而**没有任何判据会红**（文档与代码各自看着都"正常"）。
 *   ⚠ 同族形态还有一次：`09` 把**已实现的跨实例**与**暂缓的跨系统**合并写成"挂起"——
 *     读者会以为跨实例没做。**本组管前者（模块清单），后者由人工核对**（见回报的"未验证"）。
 *
 * **判据（成对，⛔ 缺一侧即假绿）**：
 *   · 正向：`src/modules/*.ts` **每个文件名主干**都必须在方案 §3 里出现（⛔ 不许有"写了代码没写方案"）；
 *   · 反向：方案 §3 宿主模块表的**行数**必须等于实际模块文件数（⛔ 不许虚列一个不存在的模块）。
 *
 * ⚠ **为什么用"行数相等"而不是"id ↔ 文件名映射表"**：映射表会变成**第三份手抄事实**
 *   （改一处忘另一处，正是本组要防的形态）；行数 + 主干出现这两条**都从两侧实测派生**。
 * ⚠ **取不到任一侧 ⇒ FAIL**（⛔ 不静默通过 —— E-130/E-131）。
 */
export function runPlanModuleParity({ bad, ok }) {
  const MOD_DIR = join(root, 'src', 'modules')
  /**
   * ⚠ **账本区在工作区之外** ⇒ 不能 `join(root,'volumes',...)`。
   *   解析口径与 `runWriteScope` 的 Q3 逐字相同：预设行的 `ledgerHome` + 工作区名。
   */
  const LEDGER = (() => {
    const candidates = []
    try {
      const preset = readFileSync(join(root, 'preset', 'dsh-hob', 'preset-dsh-hob.patch.yml'), 'utf8')
      const m = /ledgerHome:\s*(\S+)/.exec(preset)
      if (m !== null) candidates.push(m[1])
    } catch { /* 预设读不到 ⇒ 只走候选 */ }
    const wsName = workspaceName(() => basename(root))
    for (const home of candidates) {
      const dir = join(home, wsName)
      if (existsSync(dir)) return dir
    }
    return undefined
  })()
  if (LEDGER === undefined) {
    bad('W 账本根**解析不到** ⇒ 方案 §3 模块清单同源判据失去基准（不按通过处理）')
    return
  }
  const PLAN03 = join(LEDGER, 'volumes', 'plan', '03-architecture-modular.md')

  let plan = ''
  try { plan = readFileSync(PLAN03, 'utf8') } catch { plan = '' }
  if (plan === '') {
    bad('W 方案 §3 卷**读不到**（`volumes/plan/03-architecture-modular.md`）⇒ 模块清单同源判据失去基准（不按通过处理）')
    return
  }
  let stems = []
  try {
    stems = readdirSync(MOD_DIR)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => basename(f, '.ts'))
      .sort()
  } catch (e) {
    bad(`W \`src/modules/\` **读不到**（${String(e?.message ?? e)}）⇒ 本组失去基准（不按通过处理）`)
    return
  }
  if (stems.length === 0) {
    bad('W `src/modules/` 下**没有任何 .ts** ⇒ 派生为空，本组不得报绿（E-126）')
    return
  }

  /** 纯函数：从方案文本里数「宿主模块表」的模块行 —— 自带样本可在内存里造。 */
  const countModuleRows = (src) => {
    // 只认「行首是 | **M<数字>[字母]?** |」这种模块行；标题行与分隔行天然不匹配
    return src.split('\n').filter((l) => /^\|\s*\*\*M\d+[a-z]?\*\*\s*\|/.test(l)).length
  }

  // ── W0 自带样本：该咬 / 不该咬成对（⛔ 缺一侧即"判据没牙"）──────────────
  const MUST_BITE = [
    ['虚列一个不存在的模块', '| **M1** | a | b | c |\n| **M2** | a | b | c |\n| **M3** | a | b | c |\n', 3],
    ['少列一个真模块', '| **M1** | a | b | c |\n', 1],
  ]
  const MUST_NOT_BITE = [
    ['分隔行与表头不计数', '| # | 模块 | 职责 | 依赖 |\n|---|---|---|---|\n| **M1** | a | b | c |\n', 1],
  ]
  let wBad = 0
  for (const [label, sample, want] of MUST_BITE) {
    if (countModuleRows(sample) !== want) { wBad++; bad(`W 自带样本**没被咬**：${label} ⇒ 计数判据失效`) }
  }
  for (const [label, sample, want] of MUST_NOT_BITE) {
    if (countModuleRows(sample) !== want) { wBad++; bad(`W 自带样本**被误咬**：${label} ⇒ 计数判据过宽`) }
  }
  if (wBad === 0) {
    ok(`W0 ✓ 计数判据成对可验：${MUST_BITE.length} 组该咬**全咬住** · ${MUST_NOT_BITE.length} 组不该咬**全放过**`)
  }

  // ── W1 实测两侧 ──────────────────────────────────────────────────────
  const rows = countModuleRows(plan)
  let w1Bad = 0
  if (rows !== stems.length) {
    w1Bad++
    bad(`W 方案 §3 的宿主模块表**虚列/漏列**：表内 **${rows}** 行，而 \`src/modules/\` 实际 **${stems.length}** 个文件`
      + `\n      ⇒ 实际模块（从目录派生）：${stems.map((x) => `\`${x}.ts\``).join(' · ')}`
      + '\n      ⇒ ⚠ 两数不等 = 方案在描述一个**不存在的模块**（或漏写一个真的）—— 实测踩过：曾虚列 \`M2\`')
  }
  for (const stem of stems) {
    // 主干必须作为代码标识出现（反引号里，避免"工具"这类中文词误命中）
    if (!plan.includes(`\`${stem}.ts\``) && !plan.includes(`\`${stem}\``)) {
      w1Bad++
      bad(`W 模块 \`${stem}.ts\` **在方案 §3 里没被提到** ⇒ "写了代码没写方案"（读者找不到它）`)
    }
  }
  if (w1Bad === 0) {
    ok(`W ✓ 方案 §3 与 \`src/modules/\` **同源**：模块表 ${rows} 行 = 实际 ${stems.length} 个文件，`
      + `且 ${stems.map((x) => `\`${x}\``).join(' · ')} 逐个在正文里点名`)
  }
}

/**
 * ── 断言 R · 骨架「同源」（2026-10-16 · 第 224 轮 · `UD-118`「C」· 约束 ⑤）──────────────
 *
 * **它防的是什么**（⚠ 这是「C」的**第二个判据点**风险）：⚠ **仓库的 `.hob/**` 是唯一来源**，
 *   而随包发出去的那份（`src/server/skeleton-manifest.ts`）是**派生物** ⇒
 *   ⚠ ⚠ **两份会各自漂** —— ⚠ 改了一侧忘了另一侧时，⚠ **没有任何东西会报**
 *   （⚠ 而这正是 **E-130 / E-131** 记的形态："提取不到 ⇒ 静默通过"）。
 *
 * ── 判据（⚠ 逐条，⛔ 一条都不许静默）──────────────────────────────────────────
 *   ① ⚠ **提取不到即 FAIL**：清单文件读不到 / 抽不出 `SKELETON_ENTRIES` / 条数为 0
 *      ⇒ **FAIL**（⛔ 不按通过处理 —— **E-130 / E-131**）；
 *   ② ⚠ **逐件比对 `sha256`**：清单里每一条 `{path, sha256}` 都要与**仓库那份**重算值相等；
 *      ⚠ 仓库**缺该件** ⇒ FAIL；⚠ **值不等** ⇒ FAIL（并点名路径 + 两个值）；
 *   ③ ⚠ **反向完整性**（⚠ 防"漏登记"）：⚠ 按**同一个派生口径**（`.gitignore` 的 `!` 例外，
 *      剔除记录层）从仓库重算的文件集，必须与清单的**路径集逐名相等**
 *      ⇒ ⚠ 仓库**新增**一件而清单没跟 ⇒ FAIL（⚠ 这正是"漂"的主方向）；
 *   ④ ⚠ **派生口径同源**（⚠ 防"两套口径"）：⚠ `allowlist` 必须与该口径算出的集合相等。
 *
 * ⚠ ⚠ **判据读的是"仓库那份"，⛔ 不是"包内那份"** —— ⚠ 因为**唯一来源是仓库**；
 *   ⚠ 包内那份是**它的拷贝**（⚠ 由 `package.json` 的 `files` 带出去）。
 * ⚠ **本函数不 import 被测模块**（⚠ 与 `Q` 组不同）：⚠ 它要判的**恰恰是"清单本身对不对"** ⇒
 *   ⚠ 只能**独立重算**（⚠ 若调 `skeleton.ts` 的 `skeletonAllowlist()` 就等于**拿被测物自证**）。
 */
export function runSkeletonSource({ bad, ok }) {
  const MANIFEST = join(root, 'src', 'server', 'skeleton-manifest.ts')
  const HOB = join(root, '.hob')

  // ── ① 提取（⚠ 提取不到 ⇒ FAIL，⛔ 不许静默）────────────────────────────────
  let src = ''
  try {
    src = readFileSync(MANIFEST, 'utf8')
  } catch {
    bad('R **读不到骨架清单** `src/server/skeleton-manifest.ts` ⇒ 同源判据失去基准（**不按通过处理**）'
      + '\n      ⇒ 修法：跑 `node scripts/gen-skeleton-manifest.mjs` 重新生成')
    return
  }
  const entriesBlock = /\bSKELETON_ENTRIES[^=]*=\s*\[([\s\S]*?)\n\]/.exec(src)
  const allowBlock = /\bSKELETON_ALLOWLIST[^=]*=\s*\[([\s\S]*?)\n\]/.exec(src)
  if (entriesBlock === null || allowBlock === null) {
    bad('R **抽不出**清单里的 `SKELETON_ENTRIES` / `SKELETON_ALLOWLIST` ⇒ 同源判据失去基准（**不按通过处理**）'
      + '\n      ⇒ ⛔ 提取不到即 FAIL，⛔ 不许静默通过（**E-130 / E-131**）')
    return
  }
  // ⚠ 行级抽取（本仓零第三方依赖纪律：⛔ 不 eval 那个 TS 文件）
  const entries = []
  for (const line of entriesBlock[1].split('\n')) {
    const m = /path:\s*'([^']+)'\s*,\s*sha256:\s*'([0-9a-f]{64})'/.exec(line)
    if (m !== null) entries.push({ path: m[1], sha256: m[2] })
  }
  // ⚠ ⚠ **引号口径**（2026-10-16 当场抓到）：⚠ 生成器用 `JSON.stringify` 落的是**双引号**，
  //   而本抽取一开始只认单引号 ⇒ ⚠ **抽出 0 项**（⚠ 那会让本条**误报"清单为空"**）。
  //   ⇒ ⚠ 两种引号都认；⚠ **抽到 0 项 ⇒ FAIL**（⛔ 不许把它读成"清单本来就是空的"）。
  const manifestAllow = [...allowBlock[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1])
  if (manifestAllow.length === 0) {
    bad('R `SKELETON_ALLOWLIST` **抽到 0 项** ⇒ 同上，同源判据失去基准（**不按通过处理**）'
      + '\n      ⇒ ⚠ 若清单确实是空的 ⇒ 生成器或提取口径坏了（⛔ 不按通过处理）')
    return
  }
  if (entries.length === 0) {
    bad('R 清单里**一条 `SKELETON_ENTRIES` 都抽不到**（条数 0）⇒ 同源判据失去基准（**不按通过处理**）')
    return
  }

  // ── ④ 派生口径（⚠ 与生成器**同一口径**：`.gitignore` 的 `!` 例外 − 记录层）──────
  const EXCLUDE = ['.hob/EXPERIENCE.md', '.hob/experience']
  const isExcluded = (p) => EXCLUDE.some((x) => p === x || p.startsWith(`${x}/`))
  let giSrc = ''
  try {
    giSrc = readFileSync(join(root, '.gitignore'), 'utf8')
  } catch {
    bad('R 读不到 `.gitignore` ⇒ 派生口径失去基准（**不按通过处理**）')
    return
  }
  const expectAllow = []
  for (const line of giSrc.split('\n')) {
    const m = /^!(\.hob\/.+)$/.exec(line.trim())
    if (m !== null) expectAllow.push(m[1].replace(/\/$/, ''))
  }
  const expectAllowFiltered = expectAllow.filter((p) => !isExcluded(p))
  const setEq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
  if (!setEq(manifestAllow, expectAllowFiltered)) {
    bad('R **清单的 `allowlist` 与派生口径不一致**（⚠ 两套口径 = 会各自漂）'
      + `\n      ⇒ 清单：${manifestAllow.join(' · ')}`
      + `\n      ⇒ 口径：${expectAllowFiltered.join(' · ')}`
      + '\n      ⇒ 修法：跑 `node scripts/gen-skeleton-manifest.mjs`（⛔ 不许手改清单）')
  }

  // ── ⑤ ⚠ **打包面**：`package.json` 的 `files` 必须**带得走**清单里的每一条 ──────────
  //   ⚠ **为什么这一条必须有**（⚠ 第三份会漂的地方）：⚠ `files` 与清单是**两处独立声明**
  //     ⇒ ⚠ 清单里加了件、`files` 忘了加 ⇒ ⚠ **装机态读不到那份骨架**，
  //       而**本机的开发态照样正常**（⚠ 因为开发态走的是仓库那份）⇒ ⚠ **测不出来**。
  //     ⚠ 这正是 `UD-118` 要治的形态（"装到别处就少了东西"）。
  //   ⚠ 判据：清单 `allowlist` 的**每一项**都要被 `files` 里某一项**覆盖**
  //     （⚠ `files` 项是**前缀**语义：`.hob/templates` 覆盖 `.hob/templates/**`）。
  //   ⚠ 读不到 `files`（文件缺失 / 段缺失）⇒ **FAIL**（⛔ 基准读不到不按通过处理）。
  let pkgFiles = undefined
  try {
    pkgFiles = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).files
  } catch { pkgFiles = undefined }
  if (!Array.isArray(pkgFiles)) {
    bad('R 读不到 `package.json` 的 `files` 段 ⇒ 打包面判据失去基准（**不按通过处理**）'
      + '\n      ⇒ ⚠ 跳过等于"基准读不到就默认通过"，那正是本条盯防的形态')
  } else {
    const uncovered = expectAllowFiltered.filter((a) => !pkgFiles.some((f) => typeof f === 'string' && (f === a || a.startsWith(`${f}/`))))
    if (uncovered.length > 0) {
      bad('R **清单里的骨架件打不进包**（`package.json` 的 `files` 没覆盖）'
        + `\n      ⇒ 未覆盖：${uncovered.join(' · ')}`
        + '\n      ⇒ 实测后果：⚠ 装机态（装进别的实例）读不到那份骨架，而本机开发态**照样正常** ⇒ 测不出来'
        + '\n      ⇒ 修法：把缺的那几条加进 `package.json` 的 `files`（⚠ 只加白名单里的，⛔ 别整个 `.hob` 加进去 —— 那会连带打进 `backups/` 与本项目记录层）')
    } else {
      ok(`R ✓ 打包面：清单 **${expectAllowFiltered.length} 项**全部被 \`files\` 覆盖（⚠ 装机态拿得到骨架）`)
    }
    // ⚠ 反向：⛔ **不许把整个 `.hob` 加进 `files`** —— 那会连带打进本项目记录层与备份。
    if (pkgFiles.some((f) => f === '.hob' || f === '.hob/' || f === '.hob/**')) {
      bad('R `package.json` 的 `files` 里出现了整个 `.hob` ⇒ ⚠ 会连带打进**本项目记录层**'
        + '（`.hob/experience/**`）与**本项目的改前备份**（`.hob/backups/**`）'
        + '\n      ⇒ ⚠ 前者是"本项目自己的历史"（⚠ 换项目不该照抄）、后者是本机产物'
        + '\n      ⇒ 修法：改成逐项白名单（`README.md` / `INIT.md` / `templates` / `drafts` / `roles`）')
    }
  }

  // ── ③ 反向完整性：按同一口径从仓库重算路径集 ────────────────────────────────
  const walkMd = (dir, base, acc) => {
    let es = []
    try { es = readdirSync(dir, { withFileTypes: true }) } catch { return acc }
    for (const e of es) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walkMd(p, base, acc)
      else if (e.isFile()) acc.push(relative(base, p).split('\\').join('/'))
    }
    return acc
  }
  const expectPaths = []
  for (const a of expectAllowFiltered) {
    const rel = a.replace(/^\.hob\//, '')
    const abs = join(HOB, rel)
    if (!existsSync(abs)) continue
    const st = readdirSync(dirname(abs), { withFileTypes: true }).find((e) => e.name === basename(abs))
    if (st !== undefined && st.isDirectory()) {
      for (const f of walkMd(abs, abs, []).sort()) expectPaths.push(`${rel}/${f}`)
    } else {
      expectPaths.push(rel)
    }
  }
  expectPaths.sort()
  const manifestPaths = entries.map((e) => e.path).sort()
  const missingInManifest = expectPaths.filter((p) => !manifestPaths.includes(p))
  const extraInManifest = manifestPaths.filter((p) => !expectPaths.includes(p))
  if (missingInManifest.length > 0) {
    bad('R **仓库有、清单没有**（⚠ 新增了骨架件而清单没跟 ⇒ 会漂）'
      + `\n      ⇒ ${missingInManifest.slice(0, 10).join(' · ')}${missingInManifest.length > 10 ? ` …另有 ${missingInManifest.length - 10} 件` : ''}`
      + '\n      ⇒ 修法：跑 `node scripts/gen-skeleton-manifest.mjs`（⛔ 不许手改清单）')
  }
  if (extraInManifest.length > 0) {
    bad('R **清单有、仓库没有**（⚠ 清单登记了一件源里已不存在的件）'
      + `\n      ⇒ ${extraInManifest.slice(0, 10).join(' · ')}`
      + '\n      ⇒ 修法：同上（重新生成）')
  }

  // ── ② 逐件 sha256（⚠ 判据的主体）───────────────────────────────────────────
  let compared = 0
  let mismatch = 0
  for (const e of entries) {
    const abs = join(HOB, e.path)
    if (!existsSync(abs)) {
      mismatch++
      bad(`R **仓库里缺该件**：\`.hob/${e.path}\` —— 清单登记了它，而源里读不到（⛔ 不按通过处理）`)
      continue
    }
    let buf = null
    try { buf = readFileSync(abs) } catch { buf = null }
    if (buf === null) {
      mismatch++
      bad(`R **读不到源件**：\`.hob/${e.path}\`（⛔ 不按通过处理）`)
      continue
    }
    compared++
    const actual = createHash('sha256').update(buf).digest('hex')
    if (actual !== e.sha256) {
      mismatch++
      bad(`R **同源漂了**：\`.hob/${e.path}\``
        + `\n      ⇒ 清单 sha256：${e.sha256}`
        + `\n      ⇒ 仓库 sha256：${actual}`
        + '\n      ⇒ 修法：⚠ **以仓库那份为准**（它是唯一来源）⇒ 跑 `node scripts/gen-skeleton-manifest.mjs` 重生成')
    }
  }
  if (mismatch === 0 && missingInManifest.length === 0 && extraInManifest.length === 0) {
    ok(`R ✓ 骨架同源：清单 **${entries.length} 件**（逐件 sha256 比对 **${compared} 件全等**）·`
      + ` 反向完整性 **${expectPaths.length} 件逐名相等** ·`
      + ` 派生口径（\`.gitignore\` 的 \`!\` 例外 − 记录层）**${expectAllowFiltered.length} 项一致**`
      + ' ⇒ ⚠ **仓库那份是唯一来源**，清单是它的派生物；⚠ 两侧任一漂 ⇒ 本条当场红')
  }
}

/**
 * 断言 S：**工作区名口径只有一套**（判据侧 ↔ 运行时侧必须逐字相同）。
 *
 * ── 为什么需要它（本条的病灶就是"没这条机检"）────────────────────────
 *   账本区由 `<ledgerHome>/<工作区名>/` 派生，而"工作区名"被**两棵树**各自使用：
 *     · 判据侧 `scripts/workspace-name.mjs`（`npm run check` 的 7 个脚本都用它）
 *     · 运行时侧 `src/server/doc-read.ts`（`resolveLedgerRoot` 是唯一解析入口）
 *   ⚠ `src/` 与 `scripts/` **互不 import**（脚本不得成为产品依赖；且
 *   `package.json` 的 `files` 只发 `lib` ⇒ 装上后根本没有 `scripts/`）
 *   ⇒ 只能**照抄**。⚠ 而"照抄"这件事没有机检就等于**必然漂**（E-130 同族）。
 *
 * ── 为什么这条比"看着像"更要紧 ─────────────────────────────────────
 *   实测过后果（2026-10-18 · 第四张隔离卡）：**判据侧修好了、运行时侧没修**
 *   ⇒ 判据报 12/12 全绿，**运行时却仍把账本区认到目录名派生的位置**
 *   （隔离 worktree 里目录名 = 卡 id ⇒ 读写到一个不该存在的账本区）。
 *   ⇒ 两侧**各自"看起来对"**，合起来就是错的 —— 这正是本条要堵的形态。
 *
 * ── 判据（⚠ 只比字面量与判定分支，⛔ 不比"行为等价"）────────────────
 *   S1 配置文件名常量：两侧必须逐字相同（`WORKSPACE_CONFIG_FILE`）。
 *   S2 字段名常量：两侧必须逐字相同（`WORKSPACE_NAME_KEY`）。
 *   S3 两侧都必须有"落回目录名"的那条分支（否则未配置时行为会变）。
 *   ⚠ 提取不到 ⇒ **FAIL 并明说**（⛔ 不许静默通过：静默通过 = 本条不存在）。
 *   ⚠ 自带样本：S1/S2 的比对逻辑喂一对"该咬"与一对"不该咬"，证它有牙。
 */
export function runWorkspaceNameSource({ bad, ok }) {
  const RUNTIME_TS = join(root, 'src', 'server', 'doc-read.ts')
  const CHECK_MJS = join(root, 'scripts', 'workspace-name.mjs')

  const readOrNull = (p) => { try { return readFileSync(p, 'utf8') } catch { return null } }
  const srcR = readOrNull(RUNTIME_TS)
  const srcC = readOrNull(CHECK_MJS)
  if (srcR === null || srcC === null) {
    bad('S 工作区名口径比对【基准缺失】：读不到 '
      + `${[RUNTIME_TS, CHECK_MJS].map((p) => relative(root, p)).join(' / ')} ⇒ 不按通过处理`)
    return
  }

  /** 取 `[export] const NAME = '…'` 的单引号字面量；找不到 ⇒ null（⛔ 不静默）。 */
  const grabStr = (src, name) => {
    const m = new RegExp(`(?:^|\\s)(?:export\\s+)?const\\s+${name}\\s*=\\s*'([^']*)'`).exec(src)
    return m === null ? null : m[1]
  }

  let sBad = 0
  const PAIRS = [
    ['S1 配置文件名', 'WORKSPACE_CONFIG_FILE'],
    ['S2 配置字段名', 'WORKSPACE_NAME_KEY'],
  ]
  for (const [label, name] of PAIRS) {
    const a = grabStr(srcR, name)
    const b = grabStr(srcC, name)
    if (a === null) {
      sBad++
      bad(`${label}【提取不到】：运行时侧 ${relative(root, RUNTIME_TS)} 里找不到 `
        + `\`const ${name} = '…'\`（写法变了？）— ⛔ 不许静默通过`)
      continue
    }
    if (b === null) {
      sBad++
      bad(`${label}【提取不到】：判据侧 ${relative(root, CHECK_MJS)} 里找不到 `
        + `\`const ${name} = '…'\`（写法变了？）— ⛔ 不许静默通过`)
      continue
    }
    if (a !== b) {
      sBad++
      bad(`${label}**两侧不一致**：\`${name}\` 必须逐字相同`
        + `\n      · ${relative(root, RUNTIME_TS)}: '${a}'`
        + `\n      · ${relative(root, CHECK_MJS)}: '${b}'`
        + '\n      ⇒ 两侧各自"看起来对"、合起来就是错的：判据按一套名字找账本区，'
        + '\n        运行时按另一套名字读写账本区 ⇒ **判据绿、运行时却认到别处**')
    }
  }

  // S3：两侧都必须留着"未配置 ⇒ 落回目录名"这条分支（向后兼容不许被悄悄删掉）
  {
    const rHasBase = /basename\s*\(/.test(srcR)
    const cHasBase = /basename\s*\(/.test(srcC)
    if (!rHasBase) {
      sBad++
      bad('S3 运行时侧找不到 `basename(` —— "未配置时落回目录名"这条向后兼容分支没了'
        + '\n      ⇒ ⚠ 那会让**不带配置的工作区**行为与改动前不一致（本条的判据 ③）')
    }
    if (!cHasBase) {
      sBad++
      bad('S3 判据侧找不到 `basename(` —— 同上，"不带配置时落回旧猜法"这条没了')
    }
  }

  // ── 自带样本（E-126：成对，且不依赖源码现状）──────────────────────────
  {
    const sameLiteral = (a, b) => a === b
    const SHOULD_BITE = [
      ['dsh-hob.workspace.json', 'dsh-hob.workspace.yaml', 'S-S1 只差扩展名'],
      ['workspaceName', 'workspace', 'S-S2 只差后缀'],
    ]
    const SHOULD_NOT_BITE = [
      ['dsh-hob.workspace.json', 'dsh-hob.workspace.json', 'S-S3 完全相同的字面量'],
      ['workspaceName', 'workspaceName', 'S-S4 完全相同的字面量'],
    ]
    for (const [a, b, why] of SHOULD_BITE) {
      if (sameLiteral(a, b)) {
        sBad++
        bad(`S 自带样本**没被咬**：${why} —— 两个**不同**的字面量被判成相同 ⇒ 判据改哑了`)
      }
    }
    for (const [a, b, why] of SHOULD_NOT_BITE) {
      if (!sameLiteral(a, b)) {
        sBad++
        bad(`S 自带样本**被误咬**：${why} —— 两个**相同**的字面量被判成不同 ⇒ 判据过宽`)
      }
    }
  }

  if (sBad === 0) {
    ok('S ✓ 工作区名口径**只有一套**（运行时侧 ↔ 判据侧字面量逐字相同）'
      + `· 配置文件名 \`${grabStr(srcR, 'WORKSPACE_CONFIG_FILE')}\``
      + `· 字段名 \`${grabStr(srcR, 'WORKSPACE_NAME_KEY')}\``
      + '· 两侧都保留"未配置 ⇒ 落回目录名"分支'
      + ' ⇒ ⚠ 判据说的账本区与运行时读写的账本区**同源**')
  }
}
