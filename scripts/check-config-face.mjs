#!/usr/bin/env node
/**
 * 配置面一致性核对 —— 机检「`src/config.ts` 的 schema ↔ `cordis.patch.yml` 的 config 段
 * ↔ 设置面板实际呈现」三处不漂移，并钉住本批新增的「新建会话默认值」的形状。
 *
 * ══ 为什么需要它（本批实测教训）════════════════════════════════════════
 *   `cordis.patch.yml` 头部自己写明：**本文件的 `config` 段必须与 `src/config.ts` 的
 *   schema 一一对应**（否则会留下"指向已删/不存在字段的脏声明"，
 *   且它随包分发到每个装了本插件的 profile）。
 *   而在本批之前，这条纪律**只写在注释里、没有任何机检兜着** —— 与 E-70 同族：
 *   靠人读的约定必然漂移。
 *
 *   同时，「新建会话默认值」有**三个各不相同的静默失败点**，都只能靠机检抓：
 *     ① **父子同标 volatile** ⇒ 构造阶段直接抛 `ValidationError`
 *        （`schemastery` 的 `validateVolatileSchema`：volatile 里不许再套 volatile）；
 *     ② **父对象标了 volatile** ⇒ 设置面**无法**只呈现子字段，而写入通道要逐级 volatile
 *        （`dsh-settings` 的 `isVolatilePath`）⇒ 面板必须写子字段路径；
 *     ③ **子字段漏标 volatile** ⇒ 该字段从设置面**静默消失**
 *        （`volatileForm` 递归时"返回 undefined 的子字段被过滤掉"）。
 *   三条的共同点是**宿主不报错**，只表现为"界面上少了个旋钮"或"写入被拒"。
 *
 * ══ 断言口径（**不许静默放宽** —— 改本文件前先读完这一节）══════════════════
 *   A. **schema 形状**：`spawn` 父对象存在、**不**标 volatile；四个子字段**各**标
 *      `.volatile()`。判据 = 从 `src/config.ts` 文本里抽出 `spawn` 段，
 *      在段内数 `.volatile()` 出现次数恰好 4、且**父对象收尾处**不接 `.volatile()`。
 *   B. **一一对应**：`cordis.patch.yml` 的 `- id: dsh-hob` 条目 `config` 段里
 *      出现的**每一个键**都必须在 schema 里声明（**不许有 schema 里没有的键**）；
 *      且 `modules` / `spawn` 两组的子键**集合相等**（schema 有的 patch 也要有）。
 *   C. **收口唯一**：`spawnDefaults` 必须是 `spawn` 段的**唯一**导出入口 ——
 *      `src/modules/*.ts` 与 `src/preset/tools.ts` 里**不得**出现对 `spawn.` 的直读
 *      （`config.spawn.x` 是 volatile ref，直读恒真/恒为 ref 且**静默**）。
 *      判据 = 这些文件里 `\.spawn\.` 命中数为 0（`bus.ts` 通过注入的现读函数取）。
 *   D. **面板文案已更正**（本批顺手改对的两处）：
 *      · 引言**不得**再写"两个 Agent 预设"（实施侧预设 v4 已删）；
 *      · 页脚的开关清单**必须**含 `VISIBLE_SWITCHES` 里每个键对应的中文名 ——
 *        ⚠ **清单本身从面板派生**（⛔ 不在本文件手抄一份，见断言 D 的实现）。
 *   E. **写入必须走子字段路径**：面板侧只允许经 `writeSpawnField`（它写 `['spawn', 字段]`），
 *      源码里**不得**出现整块写 `spawn` 的路径（`['spawn']`）。
 *
 *   每条断言都**必须能失败**（E-27：永远 PASS 的检查比没有更危险）——
 *   交付时逐条做过负向对拍（故意破坏 → FAIL → 还原 → PASS），读数见回报。
 *
 * 用法：node scripts/check-config-face.mjs      （或 npm run check:config）
 * 退出码：0 = 全通过；1 = 有违规（逐条打印）
 * ⚠ 零第三方依赖（本仓纪律）：只做文本级/行级解析，不引 YAML 库。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
/**
 * ⚠ **源码根可被 `HOB_CONFIG_ROOT` 指向一份临时副本**（负向对拍用：把真渲染点去掉、
 *   只在注释里留一句 `MODE_KEYS.map(`，确认 G-3 ①**会红**而不是被注释满足）。
 * ⚠ 与 `check:orch` 的 `HOB_SA_ROOT` / `check:policy` 的 `HOB_SP_ROOT` / `HOB_DOM_ROOT` /
 *   `HOB_GATE_ROOT` / `HOB_CF_ROOT` **同一约定**（⛔ 不另造开关名）。
 */
const root = process.env.HOB_CONFIG_ROOT !== undefined && process.env.HOB_CONFIG_ROOT !== ''
  ? process.env.HOB_CONFIG_ROOT
  : join(here, '..')
const CONFIG_TS = join(root, 'src', 'config.ts')
const PATCH = join(root, 'cordis.patch.yml')
const PANEL = join(root, 'src', 'client', 'settings-panel.tsx')
const SETTINGS_CLIENT = join(root, 'src', 'client', 'settings.ts')
/**
 * ⚠ **「工作方式」控件的**新落点**（2026-10-24 · B 席）**：
 *   死卡 `WorkModeCard` 已删（client 侧第 8 条「死代码」），控件搬进了**新建会话弹窗**
 *   （`create-hob-dialog.tsx` 的 `MODE_OPTIONS` + `mode.label.*` 词典）。
 *   ⇒ G-3 的"第 3 处（界面控件）"必须跟着落点走，⛔ 否则它会报"面板里没有控件"而
 *     实际控件**已经在**（那是**判据落点过期**，不是产品缺功能）。
 */
const DIALOG_TSX = join(root, 'src', 'client', 'create-hob-dialog.tsx')

/**
 * 宿主包的 `@deepseek-ai` 根（G-10 装配层判据要 import 宿主真包）。
 *
 * ⚠ 兜底顺序与 `check-preset-contracts.mjs` 的 `HOST_NODE_MODULES_CANDIDATES` **同款**
 *   （先本仓 `node_modules`，再宿主全局 checkout）—— ⛔ 不另立一套解析口径。
 * ⚠ 取第一个真有 `dsh-system-prompt` 的候选；都探不到 ⇒ 返回首个，
 *   由 G-10 报 **FAIL（基准缺失不按通过处理）**，⛔ 不静默跳过。
 */
const HOST_NODE_MODULES = (() => {
  const candidates = [
    join(root, 'node_modules', '@deepseek-ai'),
    '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai',
    '/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai',
  ]
  for (const c of candidates) {
    try { if (existsSync(join(c, 'dsh-system-prompt', 'lib', 'index.js'))) return c } catch { /* 继续 */ }
  }
  return candidates[1]
})()

const fail = []
const note = []
const skip = []
const noteSkip = (m) => skip.push(m)
const bad = (m) => fail.push(m)
const ok = (m) => note.push(m)

function readOr(path, label) {
  try {
    return readFileSync(path, 'utf8')
  } catch (e) {
    bad(`读不到 ${label}（${path}）：${String(e?.message ?? e)} —— 基准缺失 ⇒ 不按通过处理`)
    return ''
  }
}

const cfgSrc = readOr(CONFIG_TS, 'src/config.ts')
const patchSrc = readOr(PATCH, 'cordis.patch.yml')
const panelSrc = readOr(PANEL, '设置面板源码')
const settingsClientSrc = readOr(SETTINGS_CLIENT, '设置绑定源码')
const dialogSrc = readOr(DIALOG_TSX, '新建会话弹窗源码')

/** 抽出 `src/config.ts` 里 `spawn: z.object({ … })` 的整段文本（含父收尾与可能的 `.volatile()` 尾巴）。 */
function spawnSchemaBlock(src) {
  const start = src.indexOf('spawn: z.object({')
  if (start < 0) return null
  // 段尾 = 父对象收尾 `}).default({})`，**连同其后可能紧跟的 `.volatile()` 一起**切进来。
  // ⚠ 两点都是刻意的：
  //   ① 必须含父收尾 —— 否则"父对象不标 volatile"的判据会因为"看不到父收尾"而**恒真**；
  //   ② 必须容忍 `.volatile()` 尾巴 —— 否则"父子同标"这个**要抓的缺陷**
  //      会让整段匹配失败，报出的是"找不到段"这种**误导性**结论，
  //      而不是它真正的罪名（E-27 族：判据报错要指到真问题上）。
  const marker = '}).default({})'
  const at = src.indexOf(marker, start)
  if (at < 0) return null
  const tail = src.slice(at + marker.length)
  const vol = /^\s*\.volatile\(\)/.exec(tail)
  return src.slice(start, at + marker.length + (vol === null ? 0 : vol[0].length))
}

/** 去掉块注释与行注释（判据只看可执行文本；注释里的**反例写法**不算直读）。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

// ── A. schema 形状：父不标 + 四个子字段各标 ──────────────────────────────
{
  const block = spawnSchemaBlock(cfgSrc)
  if (block === null) {
    bad('A schema 里找不到 `spawn: z.object({ … }).default({}),` 段（配置面无「新建会话默认值」）')
  } else {
    const SUBFIELDS = ['agentPreset', 'provider', 'model', 'reasoningEffort']
    const missing = SUBFIELDS.filter((k) => !new RegExp(`\\b${k}:\\s*z\\.string\\(\\)`).test(block))
    if (missing.length > 0) {
      bad(`A spawn 段缺子字段（或类型不是 z.string()）：${missing.join(', ')}`)
    } else ok(`A spawn 四个子字段齐备（${SUBFIELDS.join(', ')}，均为 z.string()）`)

    // 子字段各标 volatile：段内 `.volatile()` 恰好 4 次。
    const volatileCount = [...block.matchAll(/\.volatile\(\)/g)].length
    if (volatileCount !== 4) {
      bad(`A spawn 段的 .volatile() 应为 4 次（四个子字段各一次），实测 ${volatileCount}`
        + ' —— 漏标会让该字段从设置面静默消失；多标/父子同标会抛 ValidationError')
    } else ok('A spawn 四个子字段各标 .volatile()（恰好 4 次）')

    // 父对象**不**标：spawn 段收尾不得紧跟 `.volatile()`。
    if (/}\)\.default\(\{\}\)\s*\.volatile\(\)/.test(block)) {
      bad('A `spawn` 父对象被标了 .volatile() —— 父子同标会抛 ValidationError，且设置面无法只呈现子字段')
    } else {
      // 反向核验：真正的父收尾确实存在（防"段尾截断导致上面这条恒真"）。
      if (!/}\)\.default\(\{\}\)\s*,?\s*$/.test(block)) {
        bad('A 读不到 spawn 段的父对象收尾（`.default({})`）—— 上面"父不标"的判据可能恒真')
      } else ok('A spawn 父对象不标 volatile（父不标 + 子各标，与 modules 同形；父子同标会抛）')
    }

    // 收口函数必须在位。
    if (!/export function spawnDefaults\s*\(/.test(cfgSrc)) {
      bad('A 缺 `spawnDefaults()` 导出 —— volatile ref 的解 ref 唯一入口')
    } else ok('A `spawnDefaults()` 导出在位（spawn 段解 ref 的唯一入口）')
  }
}

/** 从 patch 文本里抽 `- id: dsh-hob` 条目的 config 段，返回 { keyPath: value } 的顶层键 → 子键数组。 */
/**
 * **负向对拍（N-CFG · 2026-10-30 P7）**：`spawnSchemaBlock` 必须真的抽出 **schema 那段**，
 * ⚠ 先自证夹具坏掉：夹具里 `before` / `after` 是块外哨兵，抽出块若含它们即证明抽取器过宽。
 * 而不是把整个文件当块交出去（否则"配置面漂移"永远对得上）。
 * ⚠ 本族此前 0 条负向对拍（M-1 实测）。
 */
{
  const src = 'const before = 1\nexport const cfg = {\n  spawn: z.object({\n    a: z.string(),\n  }).default({}),\n}\nconst after = 2\n'
  const blk = spawnSchemaBlock(src)
  const reallyBites = typeof blk === 'string' && blk.includes('z.string()') && !blk.includes('before')
  if (!reallyBites) {
    bad(`N-CFG · 负向对拍**没咬住**：抽出的块=${JSON.stringify(String(blk).slice(0, 60))} ⇒ 抽取器把块外也吃了（或没抽到）`)
  } else {
    ok('N-CFG ✓ 负向对拍（喂一段含 `before` / `schema` / `after` 的源）⇒ 抽出的块**只含 schema 内部**，块外的 `before` / `after` 都被排除')
  }
}

function patchConfigGroups(src) {
  const lines = src.split('\n')
  // ⚠ `- id:` 行**带缩进**（它嵌在 `- insert:` 之下），故用 `\s*` 而非 `^`。
  const startIdx = lines.findIndex((l) => /^\s*-\s*id:\s*dsh-hob\s*$/.test(l))
  if (startIdx < 0) return null
  const indent = /^(\s*)/.exec(lines[startIdx])[1].length
  // 条目范围 = 到**同级或更浅**的下一个 `- ` 行为止。
  let endIdx = lines.length
  for (let i = startIdx + 1; i < lines.length; i++) {
    const m = /^(\s*)-\s/.exec(lines[i])
    if (m !== null && m[1].length <= indent) { endIdx = i; break }
  }
  const block = lines.slice(startIdx + 1, endIdx)
  const cfgAt = block.findIndex((l) => /^\s+config:\s*$/.test(l))
  if (cfgAt < 0) return { groups: {}, keys: [] }
  const cfgIndent = /^(\s*)/.exec(block[cfgAt])[1].length
  const groups = {}
  const keys = []
  let current = null
  for (let i = cfgAt + 1; i < block.length; i++) {
    const line = block[i]
    if (/^\s*#/.test(line) || line.trim() === '') continue
    const thisIndent = /^(\s*)/.exec(line)[1].length
    if (thisIndent <= cfgIndent) break // 走出 config 段
    const group = /^\s*([A-Za-z0-9_]+):\s*$/.exec(line)
    if (group !== null) { current = group[1]; groups[current] = []; keys.push(current); continue }
    const leaf = /^\s*([A-Za-z0-9_]+):/.exec(line)
    if (leaf !== null && current !== null) { groups[current].push(leaf[1]); continue }
  }
  return { groups, keys }
}

/**
 * 从 `src/config.ts` 文本里抽出**顶层 `z.object` 组**及其**子键**。
 *
 * ── 为什么需要它（2026-10-14 第 143 轮实测的缺口）──────────────────────
 *   旧版 B 组只认识 `modules` / `spawn` **两组写死的清单** ——
 *   新增一个顶层组（如 `permission`）时，**它的子键集合没有任何判据**：
 *   往 patch 里塞一个 schema 没有的子键，检查**照样 PASS**（实测）。
 *   ⇒ 改为**从 schema 派生**：哪个组、每组的子键，一律以 `src/config.ts` 为准。
 *
 * ── 口径 ─────────────────────────────────────────────────────────────
 *   · 顶层组 = 行首两空格 + `名字: z.object(`（组的一行）；
 *   · 子键 = 组起始之后、**同级或更浅**的下一行之前，行首**四空格** + `名字: z.`
 *     （四空格是各组统一的缩进档位，与文件现有形态一致）；
 *   · ⚠ **只认 `z.object(` 形态的组**：顶层**标量**既不是组、也不会出现在设置面
 *     （`volatileForm` 要求顶层是 object 或自带 volatile）⇒ 若有人把配置写成顶层标量，
 *     由本组的「patch 键必须在 schema 里」那一半去咬（见下）。
 *
 * @param src - `src/config.ts` 全文。
 * @returns 组名 → 子键数组（保持文件里的先后顺序）。
 */
function schemaTopGroups(src) {
  const out = {}
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {2}([A-Za-z0-9_]+): z\.object\(/.exec(lines[i])
    if (m === null) continue
    const name = m[1]
    const subs = []
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]
      if (/^ {2}[A-Za-z0-9_]+: z\.object\(/.test(l)) break // 下一个顶层组
      if (/^\}\)/.test(l) || /^export /.test(l)) break     // schema 收尾
      const s = /^ {4}([A-Za-z0-9_]+):\s*z\./.exec(l)
      if (s !== null) subs.push(s[1])
    }
    out[name] = subs
  }
  return out
}

// ── B. 一一对应：schema ↔ patch **双向**成立（顶层键 + 每组子键集合） ──────
{
  const parsed = patchConfigGroups(patchSrc)
  if (parsed === null) {
    bad('B cordis.patch.yml 里找不到 `- id: dsh-hob` 条目（基准缺失 ⇒ 不按通过处理）')
  } else {
    const { groups, keys } = parsed
    if (keys.length === 0) bad('B `- id: dsh-hob` 的 config 段读不到任何键')
    else ok(`B patch config 顶层键：${keys.join(', ')}`)

    // 每个 patch 顶层键都必须在 schema 里声明。
    const unknownTop = keys.filter((k) => !new RegExp(`\\n\\s{2}${k}:\\s*z\\.object\\(`).test(cfgSrc))
    if (unknownTop.length > 0) {
      bad(`B patch 声明了 schema 里没有的顶层键（脏声明）：${unknownTop.join(', ')}`
        + ' —— 本文件头部纪律：config 段必须与 config.ts 一一对应')
    } else ok(`B patch 的 ${keys.length} 个顶层键都在 schema 里`)

    // ★ 反向：schema 里**每一个**顶层组都必须在 patch 里出现（否则该字段
    //   在随包分发的默认配置里缺失，用户层拿不到基准值）。
    const schemaGroups = schemaTopGroups(cfgSrc)
    const schemaNames = Object.keys(schemaGroups)
    const missTop = schemaNames.filter((k) => !keys.includes(k))
    if (schemaNames.length === 0) {
      bad('B schema 里一个顶层 `z.object` 组都抽不出来（基准缺失 ⇒ 不按通过处理）')
    } else if (missTop.length > 0) {
      bad(`B schema 声明了、patch 里没有的顶层组：${missTop.join(', ')}`
        + ' —— 双向判据的另一半：只查"patch 不脏"会漏掉"schema 有而 patch 缺"')
    } else ok(`B schema 的 ${schemaNames.length} 个顶层组在 patch 里都有（${schemaNames.join(', ')}）`)

    // ★ 逐组比对**子键集合**（双向）—— 不再只认 modules/spawn 两组写死的清单。
    //   ⚠ **派生**而非写死：新增一个组时它自动被纳入判定（这正是旧版的缺口）。
    for (const g of schemaNames) {
      const schemaSubs = schemaGroups[g]
      const patchSubs = groups[g] ?? []
      if (!keys.includes(g)) continue // 顶层已缺 ⇒ 上面已报，不重复
      const miss = schemaSubs.filter((k) => !patchSubs.includes(k))
      const extra = patchSubs.filter((k) => !schemaSubs.includes(k))
      if (schemaSubs.length === 0) {
        bad(`B ${g} 组在 schema 里抽不出任何子键（基准缺失 ⇒ 不按通过处理）`)
      } else if (miss.length > 0 || extra.length > 0) {
        bad(`B ${g} 子键与 schema 不一致（缺：${miss.join(', ') || '无'}；多：${extra.join(', ') || '无'}）`)
      } else {
        ok(`B ${g} 子键与 schema 一致（${schemaSubs.join('/')}，共 ${schemaSubs.length} 项）`)
      }
    }
  }
}

// ── C. 收口唯一：模块侧不得直读 `spawn.` ─────────────────────────────────
{
  const moduleFiles = [
    join(root, 'src', 'modules', 'bus.ts'),
    join(root, 'src', 'preset', 'tools.ts'),
  ]
  let hits = 0
  const hitWhere = []
  for (const f of moduleFiles) {
    let src = ''
    try { src = readFileSync(f, 'utf8') } catch { continue }
    // ⚠ 只看**可执行文本** —— 注释里出现过反例写法（`config.spawn.x`），
    //   那是说明文字，不是直读；不剔注释会让这条判据**恒 FAIL**（E-27 族）。
    src = stripComments(src)
    // 直读形态（**两种都要抓**，第一种漏掉过 —— 见下方注释）：
    //   ① 属性访问 `.spawn.<字段>`：**不要求**点号前面是标识符 ——
    //      首版写成 `\w+\.spawn\.\w+`，结果 `(config as any).spawn.provider`
    //      这种**带类型断言的直读**从判据里漏了出去（负向对拍当场抓到并改正）。
    //   ② 下标访问 `['spawn']['字段']` / `['spawn'].字段` —— 与属性访问等价的直读。
    for (const m of src.matchAll(/\.spawn\.\w+/g)) {
      hits++
      hitWhere.push(`${f.split('/').slice(-2).join('/')}: ${m[0]}`)
    }
    for (const m of src.matchAll(/\[\s*['"]spawn['"]\s*\]/g)) {
      hits++
      hitWhere.push(`${f.split('/').slice(-2).join('/')}: ${m[0]}`)
    }
  }
  if (hits > 0) {
    bad(`C 模块侧出现对 spawn 子字段的**直读**（${hits} 处）—— volatile ref 直读恒真/恒为 ref 且静默：\n     ${hitWhere.join('\n     ')}`)
  } else ok('C 模块侧无 `*.spawn.*` 直读（解 ref 收口在 config.ts 的 spawnDefaults()）')
}

// ── D. 面板文案已更正（两处过时文案）───────────────────────────────────
{
  // ① 引言不得再主张"两个 Agent 预设"（实施侧预设 Hob-Execute v4 已删）。
  const staleIntro = panelSrc.includes('两个 Agent 预设')
  if (staleIntro) {
    bad('D 面板引言仍写"两个 Agent 预设"—— 实施侧预设 Hob-Execute 已于 v4 删除，现只剩 Hob')
  } else ok('D 面板引言已不再主张"两个 Agent 预设"（过时文案 ①已修）')

  // ② 页脚开关清单必须在位（缺一个就是把真实开关藏起来）。
  //   ⚠ ⚠ **2026-10-16 第 237 轮改为派生**（⚠ 原先是手抄的 `FIVE` 数组）。
  //     ⚠ **为什么要改**：⚠ 历史上某一轮给面板加过一个新开关 ⇒
  //     ⚠ ⚠ **手抄的"五个"当场过期**（⚠ 而它的失败方式是**报一条与事实不符的判定行**，
  //     ⚠ 或者更糟：⚠ 有人为了让它过而**把一个真开关藏回面板外**）。
  //     ⚠ ⚠ **这正是 `E-117` 同族**（⚠ 与第 224 轮 `check:host` 那处手抄顶层键表**同形**）。
  //   ⚠ **判据从哪来**：⚠ **`VISIBLE_SWITCHES`（面板那份唯一白名单）** ——
  //     ⚠ 它才是"该显示哪几个开关"的**唯一来源**（⚠ 手抄一份等于**再造一个会漂的判据**）。
  //   ⚠ 提取不到（面板里读不到 `VISIBLE_SWITCHES` / 抽不出键）⇒ **FAIL**（⛔ 基准读不到不按通过处理）。
  const visMatch = /const VISIBLE_SWITCHES\s*=\s*\[([^\]]*)\]/.exec(panelSrc)
  if (visMatch === null) {
    bad('D 面板里抽不出 `VISIBLE_SWITCHES`（开关白名单）⇒ 本条失去基准（**不按通过处理**）')
  } else {
    const keys = [...visMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    if (keys.length === 0) {
      bad('D `VISIBLE_SWITCHES` 抽到 0 个键 ⇒ 本条失去基准（**不按通过处理**）')
    } else {
      // ⚠ 逐键核：① 面板词典里得有它的中文名（⚠ 否则该开关在页面上**没有名字**）；
      //   ② 页脚那句 `note.restart` 的参数表里得提到它（⚠ 否则"改完要重启"那句话漏了它）。
      const noName = keys.filter((k) => !new RegExp(`'module\\.${k}'\\s*:`).test(panelSrc))
      const notInFooter = keys.filter((k) => !new RegExp(`\\b${k}\\s*:`).test(panelSrc.slice(panelSrc.indexOf("t('note.restart.pre'"), panelSrc.indexOf("note.restart.strong"))))
      if (noName.length > 0) {
        bad(`D 开关没中文名（面板词典里缺 \`module.<key>\`）：${noName.join(', ')}`
          + '\n      ⇒ ⚠ 页面上会显示**键名**而不是人话（⚠ 等于把这个真开关藏起来）')
      }
      if (notInFooter.length > 0) {
        bad(`D 页脚"改完要重启"那句没点到这些开关：${notInFooter.join(', ')}`
          + '\n      ⇒ ⚠ 页脚那句话列举的是**全部模块开关**；⚠ 漏一个 ⇒ 用户以为改了它不用重启')
      }
      if (noName.length === 0 && notInFooter.length === 0) {
        ok(`D 页脚开关清单**派生自面板的 \`VISIBLE_SWITCHES\`**：${keys.length} 个（${keys.join(' / ')}）`
          + ' —— ⚠ 逐键核过"有中文名 + 在页脚那句话里"（⛔ 手抄表已删）')
      }
    }
  }
}

// ── E. 写入必须走子字段路径（不得整块写 spawn）────────────────────────────
{
  const wholeBlock = /path:\s*\[\s*['"]spawn['"]\s*\]/.test(settingsClientSrc)
  if (wholeBlock) {
    bad("E 设置绑定里出现整块写 `['spawn']` —— 父对象不 volatile ⇒ 宿主 isVolatilePath 会拒（Config field \"spawn\" is not volatile）")
  } else ok('E 无整块写 spawn 的路径（写入只经 writeSpawnField 的子字段路径）')

  const subfield = /path:\s*\[\s*['"]spawn['"]\s*,\s*field\s*\]/.test(settingsClientSrc)
  if (!subfield) {
    bad("E 找不到子字段写入路径 `['spawn', field]` —— 面板的写入路径可能已被改坏")
  } else ok("E 子字段写入路径 `['spawn', field]` 在位（走宿主 mutate 的逐级 volatile 校验）")

  // 边界文案必须在面板里（用户看不到就等于没有）。
  if (!panelSrc.includes('不影响') || !panelSrc.includes('手工新建')) {
    bad('D 面板缺"只影响本插件建出的会话、不影响手工新建的会话"这条边界说明')
  } else ok('D 面板写明了边界：只影响本插件建出的会话，不影响手工新建的会话')
}

// ══════════════════════════════════════════════════════════════════════════
// G 组 · 「Hob 推进项目的工作方式」（2026-10-19 · `UD-97`）
//
// 判什么（⚠ 每一条都能失败，见回报里的负向对拍）：
//   G-0 基准（三档取值 / 缺省档）—— **抽不出即 FAIL**（⛔ 基准缺失不按通过处理）；
//   G-1 第 1 处 · schema（union **派生自**唯一来源 + 形状父不标子各标）；
//   G-2 第 2 处 · 配置段（声明值合法 + **等于缺省档**）；
//   G-3 第 3 处 · 面板控件（顺序派生 + 两份词典齐备 + 中文显示名与来源逐字同源）；
//   G-4 **真实消费者**（收口 → 服务 → 注入 → 每次装配现读；且三档分支真的不同）；
//   G-5 **显示名 / 配置值分层**（配置值零出现在可见文本里）；
//   G-6 **红线条在位**（三处：给模型的口径 / 界面 / schema description）；
//   G-7 兜底同值（面板与收口函数用同一个 `DEFAULT_WORK_MODE`）；
//   G-8 写入走子字段路径（⛔ 无整块写）；
//   G-9 ⛔ 无 `*.workMode.*` 直读（volatile ref 直读静默）。
//
// ⚠ 为什么单开一组而不并进 B/E：B 只管"键/子键集合对"（结构对而语义空正是本项目
//   定义的失败形态）；E 只管 spawn 那一项的写入路径。**"三处齐备但没人读"**这个
//   组合形态，只有本组能咬住 —— 它是本项最可能的失败方式（空旋钮）。
// ══════════════════════════════════════════════════════════════════════════
{
  const SHARED = join(root, 'src', 'shared', 'work-mode.ts')
  const HOST_ENTRY = join(root, 'src', 'index.ts')
  const PRESET_TOOLS = join(root, 'src', 'preset', 'tools.ts')
  const CLIENT_SETTINGS = join(root, 'src', 'client', 'settings.ts')
  const readG = (p) => { try { return readFileSync(p, 'utf8') } catch { return undefined } }
  const sharedSrc = readG(SHARED)
  const hostEntrySrc = readG(HOST_ENTRY)
  const presetToolsSrc = readG(PRESET_TOOLS)
  const clientSettingsSrc = readG(CLIENT_SETTINGS)

  /** 从面板源码里抽一份词典块（`const PANEL_XX: Record<string,string> = {…}`）。 */
  const dictBlock = (name) => {
    const m = new RegExp(`const\\s+${name}\\s*:\\s*Record<string,\\s*string>\\s*=\\s*\\{([\\s\\S]*?)\\n\\}`).exec(panelSrc)
    return m === null ? null : m[1]
  }

  // ── G-0 基准 ──────────────────────────────────────────────────────────
  const mValues = sharedSrc === undefined ? null : /export\s+const\s+WORK_MODE_VALUES\s*=\s*\[([^\]]*)\]/.exec(sharedSrc)
  const values = mValues === null ? [] : [...mValues[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  const mDefault = sharedSrc === undefined
    ? null
    : /export\s+const\s+DEFAULT_WORK_MODE\s*:\s*WorkMode\s*=\s*'([^']+)'/.exec(sharedSrc)
  const defaultMode = mDefault === null ? undefined : mDefault[1]

  if (sharedSrc === undefined) {
    bad('G-0 读不到 `src/shared/work-mode.ts` —— 三档的唯一来源不在，G 组失去基准（**不按通过处理**）')
  } else if (values.length !== 3) {
    bad(`G-0 \`WORK_MODE_VALUES\` 抽到 ${values.length} 个值（应恰好 3 个）`
      + ' —— 要么档位被改少了（需求是三档），要么抽取口径已漂（⇒ 不按通过处理）')
  } else if (defaultMode === undefined || !values.includes(defaultMode)) {
    bad(`G-0 \`DEFAULT_WORK_MODE\` 缺失或不在三档里（抽到 ${JSON.stringify(defaultMode)}）`
      + ' —— 兜底档必须真实存在且是合法值')
  } else {
    ok(`G-0 三档唯一来源在位（${values.join(' / ')}；缺省 = ${defaultMode}）`)
  }

  if (values.length === 3 && defaultMode !== undefined) {
    // ── G-1 第 1 处 · schema ─────────────────────────────────────────────
    const hasUnion = /mode:\s*z\.union\(WORK_MODE_VALUES\.map\(\(v\)\s*=>\s*z\.const\(v\)\)\)/.test(cfgSrc)
    if (!hasUnion) {
      bad('G-1 schema 的 `workMode.mode` 不再从 `WORK_MODE_VALUES` 派生'
        + '（找不到 `z.union(WORK_MODE_VALUES.map((v) => z.const(v)))`）'
        + '\n      ⇒ 要么档位退化成自由文本（用户能填出三档之外的值），'
        + '\n        要么 schema 与唯一来源之间出现第二份清单（必然漂）')
    } else ok('G-1 schema 的 union 列表**派生自** `WORK_MODE_VALUES`（⛔ 无第二份清单）')

    const wmBlock = (() => {
      const start = cfgSrc.indexOf('workMode: z.object({')
      if (start < 0) return null
      const marker = '}).default({})'
      const at = cfgSrc.indexOf(marker, start)
      return at < 0 ? null : cfgSrc.slice(start, at + marker.length)
    })()
    if (wmBlock === null) {
      bad('G-1 schema 里找不到 `workMode: z.object({ … }).default({})` 段（配置面无「工作方式」）')
    } else {
      const volatileCount = [...wmBlock.matchAll(/\.volatile\(\)/g)].length
      if (volatileCount !== 1) {
        bad(`G-1 workMode 段的 .volatile() 应为 1 次（子字段 mode 一次），实测 ${volatileCount}`
          + ' —— 漏标会让该字段从设置面静默消失；多标/父子同标会抛 ValidationError')
      } else if (/}\)\.default\(\{\}\)\s*\.volatile\(\)/.test(wmBlock)) {
        bad('G-1 `workMode` 父对象被标了 .volatile() —— 父子同标会抛 ValidationError')
      } else {
        ok('G-1 workMode 形状 = 父不标 volatile + 子字段各标（与 spawn / permission 同形）')
      }
    }

    // ── G-2 第 2 处 · 配置段 ─────────────────────────────────────────────
    {
      const parsed = patchConfigGroups(patchSrc)
      const subs = parsed?.groups?.workMode ?? []
      if (!subs.includes('mode')) {
        bad('G-2 `cordis.patch.yml` 的 `workMode` 段缺 `mode` 子键'
          + ' —— 随包分发的默认配置里没有这一项，用户层拿不到基准值')
      } else {
        const at = patchSrc.indexOf('workMode:')
        const block = at < 0 ? '' : patchSrc.slice(at).split('\n').slice(0, 4).join('\n')
        const mLine = /^\s*mode:\s*(\S+)\s*$/m.exec(block)
        const declared = mLine === null ? undefined : mLine[1].replace(/^["']|["']$/g, '')
        if (declared === undefined || !values.includes(declared)) {
          bad(`G-2 patch 里 \`workMode.mode\` 的声明值非法（抽到 ${JSON.stringify(declared)}）—— 必须是三档之一`)
        } else if (declared !== defaultMode) {
          bad(`G-2 patch 的声明值 ${JSON.stringify(declared)} 与缺省档 ${JSON.stringify(defaultMode)} 不一致`
            + ' —— 同一个"没设过"的状态会出现两种行为（面板显示一个、跑起来另一个）')
        } else {
          ok(`G-2 patch 声明 \`workMode.mode: ${declared}\`（= 缺省档，与来源一致）`)
        }
      }
    }

    /**
     * ⚠ **「工作方式」控件的落点判定（G-3 / G-6 共用，⚠ 只算一次）**（2026-10-24 · B 席）：
     *   定义在两组之前，⛔ 不许在 G-6 里再判一遍（同一事实两个来源必然漂）。
     *   · 设置面板：`WORK_MODE_ORDER.map(`（旧落点，若还在就认）；
     *   · 新建会话弹窗：`MODE_KEYS.map(` / `modeOptions.map(` / `WORK_MODE_ORDER.map(`
     *     —— 三者都要求带 `.map(`，⛔ 手写三行不算。
     */
    /**
     * ══ ⚠⚠ **必须先剥注释再扫 `.map(`**（t11 · 修上轮已报未改的缺口）══════════════
     *   改前直接扫**原文**：两个 `.tsx` 的**头部注释里**都大量出现
     *   `WorkModeCard` / `MODE_OPTIONS` / `WORK_MODE_ORDER` 这些词（它们是"讲历史"的），
     *   ⇒ 只要注释里写过 `MODE_KEYS.map(` 这个形态，`dialogSpot` 就**恒真**
     *   ⇒ G-3 ①"控件在位"**永远通过**，哪怕组件里根本没有渲染点。
     *   ⚠ 这是"判据在认文本形态"的又一例（本仓 E-27 同族）。
     *
     *   ⇒ 现在用**同长度注释掩码**（与 `check:orch` 的 SE-a / `check:hob-gate` 同一套做法），
     *     在**代码区**里找 `.map(`。⚠ 掩码是逐字符换空格 ⇒ 偏移不变、行号不变。
     */
    const maskComments = (t) => {
      const out = t.split('')
      for (const m of t.matchAll(/\/\*[\s\S]*?\*\//g)) {
        for (let k = m.index; k < m.index + m[0].length; k += 1) if (out[k] !== '\n') out[k] = ' '
      }
      for (const m of t.matchAll(/(^|[^:'"`\\])(\/\/[^\n]*)/g)) {
        const st = m.index + m[1].length
        for (let k = st; k < st + m[2].length; k += 1) out[k] = ' '
      }
      return out.join('')
    }
    const panelCode = maskComments(panelSrc)
    const dialogCode = maskComments(dialogSrc)
    const panelSpot = /WORK_MODE_ORDER\.map\(/.test(panelCode)
    const dialogSpot = /MODE_KEYS\.map\(|modeOptions\.map\(|WORK_MODE_ORDER\.map\(/.test(dialogCode)

    // ── G-3 第 3 处 · 界面控件（⚠ 落点 2026-10-24 迁到新建会话弹窗）────────────
    /**
     * ══ 改前是什么（**判据落点过期** · 2026-10-24 · B 席）══════════════════════
     *   改前只认 `panelSrc`（`settings-panel.tsx`）里有没有 `WORK_MODE_ORDER.map(`。
     *   ⚠ 而设置面板里的 `WorkModeCard` 已被**删除**（client 侧第 8 条「死代码清理」），
     *     「工作方式」的**控件搬进了新建会话弹窗**（`MODE_OPTIONS` + `mode.label.*`）。
     *   ⇒ 本条会报"面板里找不到控件"—— ⚠ **那是判据的落点过期，不是产品缺功能**。
     *
     * ══ 现在（⚠ 判的是"控件真的在**某个**用户能看到的地方"，⛔ 不绑死文件名）══════
     *   三段**各自能失败**：
     *     ① **落点在位**：两个候选（设置面板 / 新建会话弹窗）**至少一处**有
     *        `WORK_MODE_ORDER.map(` 或 `MODE_OPTIONS.map(`（⚠ 两者都是"从常量派生"，
     *        ⛔ 手写三行字面不算 —— 那条由下面的词典同源判据兜）；
     *     ② **弹窗词典齐备**：`mode.label.*` 三条在；
     *     ③ **中英文显示名逐字同源**：弹窗词典 ↔ `WORK_MODE_DISPLAY` / `WORK_MODE_LABEL_EN`
     *        （⚠ 这一条是主牙口 —— 改错一个字就红）。
     *   ⚠ **落点写死成"必须是 panelSrc"会被判成"落点过期"**；而"只要任一处出现就算过"
     *     又太松 ⇒ 所以 ① 只判"控件存在"，**严格的同源比对放在 ②③**。
     */
    {
      /**
       * ⚠ **落点判定**：两个候选里**任一处**有"从常量派生渲染"即可。
       *   ⚠ 命中处**点名报出来**（⛔ 不许只说"通过了" —— 那看不出控件到底在哪）。
       */
      /**
       * ⚠ **"从常量派生"的落点判据**（⛔ 不绑死变量名）：
       *   · 设置面板：`WORK_MODE_ORDER.map(`（旧落点，若还在就认）；
       *   · 新建会话弹窗：`MODE_KEYS.map(` —— ⚠ 实际常量名是 **`MODE_KEYS`**（不是
       *     `MODE_OPTIONS`，那是**渲染期从服务枚举来**的数组）；**或者**
       *     `modeOptions.map(`（渲染期枚举，同样是从外部数据派生、⛔ 不是手写三行）。
       *   ⚠ 三个候选都认，但它们**都必须带 `.map(`** ⇒ 手写三行 `<label>` 不算过。
       */
      if (!panelSpot && !dialogSpot) {
        bad('G-3 **两个候选落点里都没有「工作方式」控件**'
          + '（`settings-panel.tsx` 无 `WORK_MODE_ORDER.map(`，`create-hob-dialog.tsx` 无 `MODE_KEYS.map(` / `modeOptions.map(`）'
          + ' ⇒ 三处只剩两处 ⇒ 有键无功能：用户没有任何地方能选工作方式')
      } else {
        ok(`G-3 「工作方式」控件在位：${
          [panelSpot ? '设置面板 `WORK_MODE_ORDER.map(`' : '', dialogSpot ? '新建会话弹窗 `MODE_KEYS.map(` / `modeOptions.map(`' : '']
            .filter(Boolean).join(' + ')}`
          + '（⚠ 判据只认"从常量派生"，⛔ 不绑死文件名 —— 落点可以搬）')
      }
      /**
       * ⚠ **弹窗词典的三条标签**（新增落点也要齐备）：
       *   缺一条 ⇒ 界面会**显示键名**（等于把这个档藏起来）。
       *   ⚠ 只在弹窗真的承载控件时才要求（`dialogSpot`）——
       *     否则会变成"给一个不存在的落点提要求"。
       */
      if (dialogSpot) {
        const missDlg = values.filter((v) => !new RegExp(`'mode\\.label\\.${v}'\\s*:`).test(dialogCode))
        if (missDlg.length > 0) {
          bad(`G-3 弹窗词典缺这些档位的显示名：${missDlg.map((v) => `mode.label.${v}`).join(', ')}`
            + ' ⇒ 缺一个就会在界面上**显示键名**（等于把这个档藏起来）')
        } else {
          ok(`G-3 弹窗词典三档标签齐备（${values.map((v) => `mode.label.${v}`).join(' · ')}）`)
        }
      }

      /**
       * ══ ⚠⚠ **同源比对：落点跟着控件走**（2026-10-24 · B 席 · 本组第二处落点过期）══
       *
       * ── 改前是什么 ────────────────────────────────────────────────────────
       *   这一段只知道**设置面板**那套词典：`PANEL_ZH` / `PANEL_EN` 里的 `wm.mode.*`。
       *   ⚠ `WorkModeCard` 删掉后，`wm.mode.*` 这三条**跟着一起没了**
       *   （`settings-panel.tsx` 实测 0 处 `wm.mode.`）⇒ 这三条断言**全部变红**，
       *   而显示名其实**完好地活在弹窗词典**里（`mode.label.*`）。
       *   ⇒ ⚠ 那是"判据还盯着旧落点"，不是"显示名丢了"。
       *
       * ── 现在（⚠ 判**同源**，⛔ 不判"在哪个文件"）────────────────────────────
       *   对**每一套真正承载控件的落点**（设置面板 / 新建会话弹窗）各判一次：
       *     · 该落点里**必须**有那三档的**键**（缺一条 ⇒ 界面显示键名）；
       *     · 且**标签值必须与唯一来源逐字相同**（`WORK_MODE_DISPLAY` 中文 /
       *       `WORK_MODE_LABEL_EN` 英文）⇒ 这一条是**主牙口**（改错一个字就红）。
       *   ⚠ 一个落点都没有承载控件 ⇒ 上面 G-3 的 ① 已经报过红（⛔ 不在这里重复刷红）。
       */
      const mDisplay = /export\s+const\s+WORK_MODE_DISPLAY[^=]*=\s*\{([\s\S]*?)\n\}/.exec(sharedSrc)
      const displayPairs = mDisplay === null
        ? []
        : [...mDisplay[1].matchAll(/(\w+)\s*:\s*'([^']*)'/g)].map((x) => ({ key: x[1], label: x[2] }))
      const mLabelEn = /export\s+const\s+WORK_MODE_LABEL_EN[^=]*=\s*\{([\s\S]*?)\n\}/.exec(sharedSrc)
      const enPairs = mLabelEn === null
        ? []
        : [...mLabelEn[1].matchAll(/(\w+)\s*:\s*'([^']*)'/g)].map((x) => ({ key: x[1], label: x[2] }))
      if (displayPairs.length !== 3) {
        bad(`G-3 从 \`WORK_MODE_DISPLAY\` 抽到 ${displayPairs.length} 个显示名（应 3 个）⇒ 本组失去基准（不按通过处理）`)
      } else if (enPairs.length !== 3) {
        bad(`G-3 从 \`WORK_MODE_LABEL_EN\` 抽到 ${enPairs.length} 个英文名（应 3 个）⇒ 基准缺失（不按通过处理）`)
      } else {
        /**
         * ⚠ **落点清单**（派生：哪个文件真的承载控件就核哪个）。
         *   键前缀（`wm.mode.` / `mode.label.`）是各落点自己的**内部命名**，
         *   但**值必须同源** —— 那才是"不许两套说法"的落点。
         */
        /**
         * ⚠ **每个落点各自的两本词典**（中文 / 英文**分开取** —— ⛔ 不能都拿整份源码，
         *   否则英文明细会去中文词典里找、必然"缺"）。
         *   · 设置面板：`PANEL_ZH` / `PANEL_EN`（既有）；
         *   · 弹窗：`HOB_DIALOG_ZH` / `HOB_DIALOG_EN`（本文件的命名）。
         *   ⚠ 抽不到 ⇒ 该落点报"基准缺失"，⛔ 不静默跳过。
         */
        const dialogDict = (name) => {
          /** ⚠ 掩掉注释：词典的"说明文字"里可能逐字引用过 `mode.label.*` 的写法。 */
          const re = new RegExp(`const\\s+${name}\\s*:[^=]*=\\s*\\{([\\s\\S]*?)\\n\\}`)
          const m = re.exec(dialogCode)
          return m === null ? null : m[1]
        }
        const SPOTS = [
          { name: '设置面板', prefix: 'wm.mode.', block: () => dictBlock('PANEL_ZH'), blockEn: () => dictBlock('PANEL_EN'), active: panelSpot },
          { name: '新建会话弹窗', prefix: 'mode.label.', block: () => dialogDict('HOB_DIALOG_ZH'), blockEn: () => dialogDict('HOB_DIALOG_EN'), active: dialogSpot },
        ].filter((x) => x.active)
        if (SPOTS.length === 0) {
          bad('G-3 没有任何承载「工作方式」控件的落点 ⇒ 显示名同源无从核对（⛔ 不按通过处理）')
        }
        for (const spot of SPOTS) {
          const zhBlock = spot.block()
          const enBlock = spot.blockEn()
          if (zhBlock === null) { bad(`G-3 抽不出 ${spot.name} 词典 ⇒ 显示名同源无从核对（不按通过处理）`); continue }
          /** ① **键必须齐**（缺一条 ⇒ 界面显示键名）。 */
          const missing = displayPairs.filter(({ key }) => !new RegExp(`'${spot.prefix.replace(/\./g, '\\.')}${key}'\\s*:`).test(zhBlock))
          if (missing.length > 0) {
            bad(`G-3 ${spot.name} 词典缺这些档位的显示名：${missing.map(({ key }) => `${spot.prefix}${key}`).join(', ')}`
              + ' ⇒ 缺一个就会在界面上**显示键名**（等于把这个档藏起来）')
            continue
          }
          /** ② **中文值必须与 `WORK_MODE_DISPLAY` 逐字相同** —— 主牙口。 */
          const mismatched = []
          for (const { key, label } of displayPairs) {
            const hit = new RegExp(`'${spot.prefix.replace(/\./g, '\\.')}${key}'\\s*:\\s*'([^']*)'`).exec(zhBlock)
            if (hit !== null && hit[1] !== label) mismatched.push(`${key}：来源「${label}」/ ${spot.name}「${hit[1]}」`)
          }
          if (mismatched.length > 0) {
            bad(`G-3 ${spot.name} 中文显示名与 \`WORK_MODE_DISPLAY\` **不是同一套说法**：${mismatched.join('；')}`
              + ' —— 显示名只有一个来源，两处各写一份必然漂')
          }
          /** ③ **英文值必须与 `WORK_MODE_LABEL_EN` 逐字相同**（⛔ 两套英文）。 */
          const missEn = []
          for (const { key, label } of enPairs) {
            const hit = new RegExp(`'${spot.prefix.replace(/\./g, '\\.')}${key}'\\s*:\\s*'([^']*)'`).exec(enBlock)
            if (hit === null || hit[1] !== label) missEn.push(`${key}（来源「${label}」/ ${spot.name}「${hit?.[1] ?? '缺'}」）`)
          }
          if (missEn.length > 0) {
            bad(`G-3 ${spot.name} 英文显示名与 \`WORK_MODE_LABEL_EN\` 不一致：${missEn.join('；')}`
              + ' —— 模型面的英文名与界面英文名必须同一套')
          }
          if (mismatched.length === 0 && missEn.length === 0) {
            ok(`G-3 ${spot.name} 三档显示名与来源**逐字同源**（中：${displayPairs.map((p) => p.label).join(' / ')}`
              + ` · 英：${enPairs.map((p) => p.label).join(' / ')}）`)
          }
        }
      }
    }

    // ── G-4 真实消费者（本组最重要的一条）──────────────────────────────
    {
      const consumers = [
        { label: 'host 收口函数 `workMode()`', src: cfgSrc, needle: 'export function workMode(' },
        { label: '入口 provide 现读服务', src: hostEntrySrc, needle: 'ctx.provide(WORK_MODE_SERVICE, () => workMode(config))' },
        //   ⚠ 2026-10-22 第 4 轮：`injectWorkMode` 多收一个 `policyOf`（要判 `mayProceed`）。
        //     锚点随实现更新；⚠ 判据仍是"预设作用域里真的挂了这个注入"。
        { label: '预设作用域挂载注入', src: presetToolsSrc, needle: 'injectWorkMode(ctx, modeOf, policyOf, log)' },
        //   ⚠ 2026-10-19（`TASK-D`①）改**判据词**、⛔ 不是放宽：改前这里钉的是**具名导入**的
        //     调用形态（`workModeInstruction(modeOf()) + workModeRedLine()`），而那个形态正是
        //     "一个名字不到就整块求值失败"的来源。现在钉的是**运行时命名空间取值**的同一处调用
        //     —— 语义（两条通路共用同一个现拼函数、且它确实拼出"档位口径 + 红线"）一字未变，
        //     只是把"从哪个面取"钉到了新形态上。
        //   ⚠ 2026-10-22（`REQ-04`）：`modeOf()` 改为**按会话**取（`modeOf(context?.agent ?? context?.scope)`）
        //      ⇒ 锚点跟着改，**语义一字未变**：两条通路共用同一个现拼函数、且它确实拼出「档位口径 + 红线」。
        //      ⚠ 这不叫放宽：下面 G-4 另有一条**更强**的断言（textNow 必须接受 context 形参）。
        /**
         * ⚠ 2026-10-22 第 4 轮：`textNow` 现在先取 `verdict`（判 `mayProceed`）再拼正文，
         *   局部变量名从 `mode` 变成 `verdict.workMode` ⇒ 锚点随实现更新。
         *   ⚠ 语义**更强**：原文只要求"拼出「口径+红线」"，现在还要求"拼之前判过能不能推进"。
         */
        { label: '两条通路共用的现拼正文 `textNow()`', src: presetToolsSrc, needle: 'workModeFace.workModeInstruction(verdict.workMode as WorkMode) + workModeFace.workModeRedLine()' },
        { label: '段通路 `section()` 注册', src: presetToolsSrc, needle: 'spCtx.systemPrompt.section({' },
        { label: '上下文通路 `context()` 注册（G-10 证明它是生效那条）', src: presetToolsSrc, needle: 'spCtx.systemPrompt.context({' },
        { label: '上下文必须 `required: true`（否则被 suppress 丢）', src: presetToolsSrc, needle: 'required: true,' },
      ]
      const missing = consumers.filter((c) => c.src === undefined || !c.src.includes(c.needle))
      if (missing.length > 0) {
        bad(`G-4 「工作方式」缺真实消费者：${missing.map((c) => c.label).join(' / ')}`
          + '\n      ⇒ ⚠ 这正是本项目明确要避免的**空旋钮**：界面有开关、背后没人读')
      } else ok('G-4 消费者链在位：收口 → 入口现读服务 → 预设注入 → textNow 现拼 → 两条通路注册 → required（7/7）')

      if (presetToolsSrc !== undefined) {
        const fnStart = presetToolsSrc.indexOf('function injectWorkMode(')
        const fnBody = fnStart < 0 ? '' : presetToolsSrc.slice(fnStart, fnStart + 8000)
        //   ⚠ 判据：`textNow` 必须是**函数**（`const textNow = (): string => …`），
        //     且两条通路的 `text:` 都**引用它**（`text: textNow,`）—— ⛔ 不许写常量字符串。
        //     ⚠ 2026-10-19 第 2 轮起正文由 `textNow()` 统一现拼（两条通路共用一份，
        //     防"section 与 context 各拼一份、改一处漏一处"）。
        /**
         * ⚠ 2026-10-22（`REQ-04`）改锚点、**并加强**：
         *   改前钉 `const textNow = (): string =>`（无参）。
         *   现在必须**接受一个 context 形参** —— 因为「工作方式」要**按会话**取，
         *   而会话身份只从装配 context 进来（宿主 `resolveContext()` 传 `entry.text(context)`）。
         *   ⇒ 判据从"是个函数"升级成"是个**能按会话**的函数"（⛔ 不是放宽）。
         */
        const isFn = /const\s+textNow\s*=\s*\([^)]*\)\s*:\s*string\s*=>/.test(fnBody)
        const takesContext = /const\s+textNow\s*=\s*\(\s*(context|ctx)\b/.test(fnBody)
        /**
         * ⚠ 2026-10-22 第 4 轮：判定口径从"传给 modeOf"升级为"**经 policyOf 取整份读数**"
         *   —— 因为只回档位字符串问不出 `mayProceed`，而"能不能推进"是必须的一档。
         *   ⚠ 判据**没有放宽**：仍然要求"会话身份从 context 进来"（`subject` 赋值那一句），
         *     并且额外要求"那份读数被真正用于判定"。
         */
        const takesSubjectFromContext = /const\s+subject\s*=\s*context\?\.agent\s*\?\?\s*context\?\.scope/.test(fnBody)
        const feedsContext = takesSubjectFromContext
          && /const\s+verdict\s*=\s*policyOf\(\s*subject\s*\)/.test(fnBody)
        const sectionRef = /section\(\{[\s\S]{0,600}?text:\s*textNow,/.test(fnBody)
        const contextRef = /context\(\{[\s\S]{0,600}?text:\s*textNow,/.test(fnBody)
        if (!isFn) {
          bad('G-4 注入正文不是**函数**（找不到 `const textNow = (...) : string =>`）'
            + '\n      ⇒ 若是常量字符串，档位改了**已开会话仍按旧档**走到重挂载为止 ——'
            + '\n        那正是"设置页改了但行为没变"的静默失败')
        } else if (!takesContext || !feedsContext) {
          bad('G-4 `textNow` **不接受 context 形参**或没把会话身份喂给 `policyOf()`'
            + `（形参=${takesContext} · 传给 modeOf=${feedsContext}）`
            + '\n      ⇒ ⚠ `REQ-04` 起「工作方式」必须**按会话**取：会话身份只从装配 context 进来'
            + '\n        （宿主 `resolveContext()` 调 `entry.text(context)`）'
            + '\n        ⇒ 不收 context 就等于"又回到全局值"，与"取消全局联动"直接冲突')
        } else if (!sectionRef || !contextRef) {
          bad(`G-4 两条通路没有**共用**同一个现拼函数（section=${sectionRef} · context=${contextRef}）`
            + '\n      ⇒ 各拼一份的话，改一处必然漏一处（"+1 处口径"的分裂）')
        } else ok('G-4 正文由 `textNow()` 函数现拼，且 section / context 两条通路共用（⛔ 非常量）')

        //   ⚠⚠ 2026-10-19 第 3 轮（`UD-149` 裁定 ③）：`section()` 那条**今天无效**，
        //     保留但注释必须写明"今天无效、为什么无效"（否则下一个人把它当生效通路读）。
        //     判据 = 在 `section()` 注册**前后 4000 字符**里必须同时出现"无效"的解释与原因锚。
        const secAt = fnBody.indexOf('spCtx.systemPrompt.section({')
        const secZone = secAt < 0 ? '' : fnBody.slice(Math.max(0, secAt - 4000), secAt + 600)
        const declaresDead = secZone.includes('本条今天不进模型上下文') || secZone.includes('今天这条是无效的')
        const givesReason = secZone.includes('completeSection') || secZone.includes('complete: true')
        //   ⚠ 判据 = **正面声称**"两条都生效"才 FAIL；写成否定句（"它**不是**两条都生效"）是**允许且鼓励**的
        //     —— 这一条本身就是在防那个误读，禁掉否定说法等于逼人删掉最有用的那句。⇒ 逐行判：
        //     含该短语的行必须**同一行**带否定标记（不是 / 别 / ⛔ / 不），否则才算正面声称。
        const NEGATION = /不是|别|⛔|不两条|并不/
        const bothClaimLines = secZone.split('\n')
          .filter((line) => /两条通路都生效|两条都生效/.test(line) && !NEGATION.test(line))
        if (!declaresDead) {
          bad('G-4 `section()` 通路没有**明写"今天无效"**'
            + '\n      ⇒ `UD-149` 裁定 ③：这条保留（零成本），但注释必须写明今天无效、为什么无效，'
            + '\n        ⛔ 不许让人读成"两条都生效"（那会让下一个人守着一条不生效的通路）')
        } else if (!givesReason) {
          bad('G-4 `section()` 的"今天无效"没给出**原因锚**（缺 `completeSection` / `complete: true`）'
            + '\n      ⇒ 只说"无效"不说"为什么"，等于把结论留成口口相传')
        } else if (bothClaimLines.length > 0) {
          bad('G-4 `section()` 附近出现**"两条都生效"式正面声称** —— 与实测相反（实测 section 被 complete 吞）'
            + '\n      ⇒ ' + JSON.stringify(bothClaimLines[0].trim().slice(0, 80)))
        } else ok('G-4 `section()` 保留且**明写今天无效 + 原因**（⛔ 未声称两条都生效）')
      }

      if (sharedSrc !== undefined) {
        const fnStart = sharedSrc.indexOf('export function workModeInstruction(')
        const fnEnd = sharedSrc.indexOf('export function workModeRedLine(')
        const fnBody = fnStart < 0 || fnEnd < 0 ? '' : sharedSrc.slice(fnStart, fnEnd)
        const branches = ["mode === 'single'", "mode === 'multi'"].filter((b) => fnBody.includes(b))
        if (branches.length !== 2) {
          bad('G-4 `workModeInstruction()` 缺分档分支（应能见到 single / multi 两个分支）'
            + ` —— 实测只见 ${branches.length} 个 ⇒ 三档可能返回同一段（假消费）`)
        } else {
          ok('G-4 `workModeInstruction()` 分档分支齐备（single / multi 各一支，其余落缺省档）')
        }
      }

      //   ⚠⚠ **真不同**：三档正文必须**逐档互不相同**，且各自带着"那一档才有的"
      //   语义标记。⚠ 光有分支不算数 —— "分支在、正文一样"照样是假消费（负向对拍实证）。
      //   ⚠ 这里**实跑真模块**（⛔ 不靠文本推断）：Node ≥22 可直载 TS。
      //
      //   ⚠⚠ **本组只判"口径文本本身对不对"** —— ⛔ 它**不**证明"模型读到了"。
      //     "真进上下文"由 **G-10 组**（跑宿主真装配）判；上一单正是把 G-4 当成了通过证据
      //     才被打回（`assembly.sections` 里有它 ≠ 进最终上下文）。两组分工不许混。
      {
        let wm = null
        try {
          wm = await import(pathToFileURL(join(root, 'src', 'shared', 'work-mode.ts')).href)
        } catch (e) {
          bad(`G-4 无法加载 \`src/shared/work-mode.ts\`（${String(e?.message ?? e)}）`
            + ' ⇒ "三档真的不同"这一条失去基准（**不按通过处理**）')
        }
        if (wm !== null) {
          if (typeof wm.workModeInstruction !== 'function' || typeof wm.workModeRedLine !== 'function') {
            bad('G-4 `work-mode.ts` 没导出 `workModeInstruction()` / `workModeRedLine()` 函数'
              + ' ⇒ 三档正文无从实跑（**不按通过处理**）')
          } else {
            const texts = {}
            for (const m of values) texts[m] = wm.workModeInstruction(m) + wm.workModeRedLine()
            const distinct = new Set(Object.values(texts))
            if (distinct.size !== 3) {
              bad(`G-4 三档口径正文**不是互不相同**（实测只有 ${distinct.size} 种不同正文 / 共 3 档）`
                + '\n      ⇒ 档位改了而注入内容没变 = **假消费**（比没有这个旋钮更坏：界面看起来在动）')
            } else ok('G-4 三档口径正文实跑互不相同（3 档 → 3 种不同正文；⚠ 是否真进上下文由 G-10 判）')

            //   ⚠ 单会话档**必须明写"恒定一路"**；多会话档**必须明写"拆更细/更多路"**。
            //     这两条是任务书 §二-② 直接点名的判据（不只是"不同"，还要"朝那个方向不同"）。
            const SINGLE_MARK = 'One track, always.'
            const MULTI_MARK = 'Split as finely'
            if (!texts.single.includes(SINGLE_MARK)) {
              bad(`G-4 单会话档正文缺「${SINGLE_MARK}」—— 判据要能证明`
                + '"即使任务本可拆多路，也只走一路"，而这句正是那个证明的落点')
            } else ok(`G-4 单会话档明写「${SINGLE_MARK}」（覆盖"本可拆多路"）`)
            if (!texts.multi.includes(MULTI_MARK)) {
              bad(`G-4 多会话档正文缺「${MULTI_MARK}」—— 判据要能证明`
                + '"同一个任务在多会话档下拆出的路数 > 单会话档"')
            } else ok(`G-4 多会话档明写「${MULTI_MARK}」（朝"更细/更多路"）`)

            //   ⚠ **交叉污染**：单会话档不得含多会话的措辞，反之亦然
            //     （防"两档拼在一起"这种看起来更周全、实际让模型收到矛盾指令的形态）。
            if (texts.single.includes(MULTI_MARK) || texts.multi.includes(SINGLE_MARK)) {
              bad('G-4 两档措施**互相污染**（单会话档里出现多会话措辞，或反之）'
                + ' —— 模型会同时收到两条相反指令，档位等于没设')
            } else ok('G-4 两档措辞互不污染（各档只收到自己那条）')

            //   ⚠ 红线**三档共同**：不是"只在多会话档出现"。
            //     理由：单会话档照样不许碰别人的卡、不许放宽判据（任务书 §二-② 的"恒定"那半）。
            const RED_MARK = 'never means more power'
            const missRed = values.filter((m) => !texts[m].includes(RED_MARK))
            if (missRed.length > 0) {
              bad(`G-4 红线**没有三档共同在场**：${missRed.join(', ')} 档缺它`
                + ' —— 红线的适用面是三档共同的，⛔ 不是"只有多会话才要守"')
            } else ok('G-4 红线三档共同在场（不是只在多会话档）')

            //   ⚠⚠ **2026-10-29（第 332 轮 · TASK-E 第 2 件）改口径**：
            //     原文案暗示「**不先问就派**」（`Then hand it over yourself, without asking first …
            //     not as a question ahead of it`）—— 与 `CHG-092`（默认先协商、用户明说才派）**相冲**。
            //     ⇒ 现口径 = **默认先协商**（`CHG-092`）+ **若本档确实"判完即可派"，派完必须报三条**
            //       （`UD-149` §二，那半句**仍然有效**，⛔ 一个字都没删）。
            //     ⚠ 判据仍**成对**（`E-126`：只验一侧 ⇒ 判据写对与写错输出相同）：
            //       ① 旧的 (甲) 措辞**必须消失**（"先问一句再干"那条作废口径）；
            //       ② 旧的**"不先问"暗示**必须消失（`without asking first` / `question ahead of it`）；
            //       ③ `CHG-092` 的**协商口径在场**（判据词 `negotiate against the current plan`）；
            //       ④ **"派完说清路数与去向"那一句必须在**（判据词 `the report is not optional`）。
            const OLD_REPORT_FIRST = 'say in one line how many tracks'
            const OLD_NO_ASK = ['without asking first', 'question ahead of it']
            const NEW_CONSULT = 'negotiate against the current plan'
            const NEW_REPORT = 'the report is not optional'
            /**
             * ⚠⚠ **判据必须只看「档位正文」**（`workModeInstruction(auto)`），
             *   ⛔ **不能看 `texts[auto]`** —— 那里拼进了**三档共用的红线**，
             *   而红线里那句 `Handing over without asking first lifts …` 是**边界说明**
             *   （"全自动≠全授权"），**不是**"允许不先问"的指令。
             *   ⚠ 本单第一版就栽在这：拿 `texts` 判 ⇒ 红线把它顶红 ⇒ **假失败**。
             *   （这也正是下面 `AUTO_ONLY` 那段注释早就写过的同一条坑。）
             */
            const AUTO_INSTR = wm.workModeInstruction(defaultMode)
            if (texts[defaultMode].includes(OLD_REPORT_FIRST)) {
              bad(`G-4 缺省档（${defaultMode}）**仍含已作废的 (甲) 措辞**「${OLD_REPORT_FIRST}」`
                + '\n      ⇒ 用户已裁定「全自动」= (乙)（`UD-149`）：判完直接派、不再先问一句。'
                + '\n        旧措辞留着会让模型收到两条相反指令（"先问"×"直接派"）—— 档位等于没设')
            } else if (OLD_NO_ASK.some((n) => AUTO_INSTR.includes(n))) {
              const hit = OLD_NO_ASK.find((n) => AUTO_INSTR.includes(n))
              bad(`G-4 缺省档（${defaultMode}）的**档位正文**仍含「不先问就派」的暗示（判据词「${hit}」）`
                + '\n      ⇒ 与 `CHG-092`「收到输入默认动作 = 协商方案」直接相冲：'
                + '\n        模型会读到"不必先问"从而跳过协商 —— 正是本单第 2 件要消掉的那句')
            } else if (!AUTO_INSTR.includes(NEW_CONSULT)) {
              bad(`G-4 缺省档（${defaultMode}）缺「默认先协商」口径（判据词「${NEW_CONSULT}」）`
                + '\n      ⇒ `CHG-092` 规矩 1：默认动作 = 对照方案与账本与用户协商，⛔ 不是派活')
            } else if (!AUTO_INSTR.includes(NEW_REPORT)) {
              bad(`G-4 缺省档（${defaultMode}）缺「派完必须说清路数与去向」（判据词「${NEW_REPORT}」）`
                + '\n      ⇒ "不再先报"⛔ **不等于**"不报"（`UD-149` §二）：'
                + '\n        派完必须在回复里说清 拆成几路 / 每路给了谁 / 哪一路先回来才能定下一步')
            } else {
              ok(`G-4 缺省档（${defaultMode}）= 「默认先协商（\`CHG-092\`）+ 派完必报三条（\`UD-149\` §二）」：`
                + '旧 (甲) 措辞已清除 · 「不先问」暗示已清除 · 协商口径在场 · 派完报三条在场（四条成对）')
            }

            //   ⚠ **另两档不许被动**（用户只裁了「自动」档）：单会话 / 多会话的**档位正文**里
            //     ⛔ 不许出现"直接派 / 不再先问"这类只属于「自动」档的措辞 ——
            //     否则就是"改一档、顺手改了另两档"（本项目的口径分裂族）。
            //     ⚠⚠ 判据必须只看**档位正文**（`workModeInstruction(m)`），⛔ 不能看
            //     `texts[m]`：那里拼进了**三档共用的红线**（`workModeRedLine()`），
            //     而红线里的「全自动」边界是**故意三档都在**的 —— 拿 texts 判会假失败。
            const ONLY_INSTR = {}
            for (const m of values) ONLY_INSTR[m] = wm.workModeInstruction(m)
            /**
             * ⚠⚠ **2026-10-29 改口径（与上面 G-4 同批）**：判据词从
             *   「不先问就派」（`without asking first` / `report after dispatching`）
             *   换成**现口径**的两条：协商口径（`negotiate against the current plan`）
             *   与派完报三条（`the report is not optional`）。
             * ⚠ 判据**没减弱**：仍是"这两条只许出现在缺省档的档位正文里"。
             */
            const AUTO_ONLY = ['negotiate against the current plan', 'the report is not optional']
            const contaminated = values.filter((m) => m !== defaultMode
              && AUTO_ONLY.some((needle) => ONLY_INSTR[m].includes(needle)))
            if (contaminated.length > 0) {
              bad(`G-4 「全自动」措辞漏进了非缺省档的**档位正文**：${contaminated.join(', ')}`
                + '\n      ⇒ 用户只裁了「自动」档（`UD-149` §三）；另两档的口径 ⛔ 一个字都不许动')
            } else ok('G-4 「全自动」措辞只在缺省档的档位正文里（单会话 / 多会话未被改动；'
              + '红线那段三档共用，不算污染）')
          }
        }
      }
    }

    // ── G-5 显示名 / 配置值分层 ──────────────────────────────────────────
    {
      const offenders = []
      for (const dict of ['PANEL_ZH', 'PANEL_EN']) {
        const block = dictBlock(dict)
        if (block === null) continue
        for (const lit of block.matchAll(/'((?:[^'\\]|\\.)*)'/g)) {
          const v = lit[1]
          if (/^[A-Za-z][\w.]*$/.test(v)) continue // 键形态（`wm.mode.auto` 是键，不是可见文本）
          for (const val of values) {
            // 独立词匹配：`automatically` / `multi-session` 这类不算
            if (new RegExp(`(^|[^A-Za-z0-9_-])${val}([^A-Za-z0-9_-]|$)`).test(v)) {
              offenders.push(`${dict}: 出现配置值「${val}」→ ${JSON.stringify(v.slice(0, 60))}`)
            }
          }
        }
      }
      if (offenders.length > 0) {
        bad(`G-5 配置值出现在**用户可见文本**里：\n     ${offenders.join('\n     ')}`
          + '\n      ⇒ 配置值是内部标识（⛔ 不进对话文本）；界面该显示的是「自动 / 单会话 / 多会话」')
      } else ok('G-5 三档配置值零出现在面板可见文本里（分层成立）')
    }

    // ── G-6 红线条在位（三处）────────────────────────────────────────────
    {
      //   ⚠ 锚点逐个落在**同一行**内（口径正文是数组 join 出来的，跨行的短语会假失败）。
      const RED_ANCHORS = ['never means more power', 'lifts nothing else', 'the board', 'criterion is relaxed']
      //   ⚠ 2026-10-19 第 3 轮（`UD-149`）：红线段**扩写了两段边界**，
      //     第二段是「全自动」的边界（⚠ 名字带「全」的那一档最容易读成"权限更大"，`R-26` 同族）。
      //     它的关键限定单独列锚点 —— ⛔ 不许被裁掉成"只是一句好听的话"。
      const AUTOMATIC_ANCHORS = ['fully authorised', 'lifts', 'permission level']
      const redStart = (sharedSrc ?? '').indexOf('export function workModeRedLine(')
      const redBody = redStart < 0 ? '' : (sharedSrc ?? '').slice(redStart)
      const missModel = RED_ANCHORS.filter((a) => !redBody.includes(a))
      const missAuto = AUTOMATIC_ANCHORS.filter((a) => !redBody.includes(a))
      //   ⚠⚠ 2026-10-19 第 3 轮**补**（负向对拍暴露的真缺口）：
      //     上面只判了**英文**函数 `workModeRedLine()`，而**中文原文常量**
      //     `WORK_MODE_RED_LINE` 是「全自动」边界在三处的**唯一落点**（`UD-149` §一）。
      //     实测：把「自动」那半句从常量里删掉 ⇒ 上面两条判据**仍然全绿**（判据失去分辨力）。
      //     ⇒ 必须**单独**把中文源常量也钉住（否则面板与 schema 里的那句会悄悄停在旧版）。
      const zhRedStart = (sharedSrc ?? '').indexOf('export const WORK_MODE_RED_LINE')
      const zhRedBody = zhRedStart < 0
        ? ''
        : (sharedSrc ?? '').slice(zhRedStart, (sharedSrc ?? '').indexOf('\n\n', zhRedStart) + 2)
      const ZH_RED_AUTO = ['自动', '全自动', '不越过权限档位', '不再先问用户就派出去']
      const missZhRed = ZH_RED_AUTO.filter((a) => !zhRedBody.includes(a))
      if (zhRedStart < 0) {
        bad('G-6 抽不到 `WORK_MODE_RED_LINE`（中文红线原文常量）⇒ 三处的中文源无从核对（不按通过处理）')
      } else if (missZhRed.length > 0) {
        bad(`G-6 中文红线原文缺「全自动」那条边界：${missZhRed.join(', ')}`
          + '\n      ⇒ 它是面板与 schema 那句限定的**中文源**（`UD-149` §一：凡出现「全自动」这个名，'
          + '\n        紧邻必须有那句限定）。源常量缺了，下游两处即使"看起来有"也是各写各的')
      } else if (missModel.length > 0) {
        bad(`G-6 给模型看的口径里缺红线关键限定：${missModel.join(', ')}`
          + ' —— 红线是任务书 §二-② 写死的一条，⛔ 不许被裁掉或改写成更弱的说法')
      } else if (missAuto.length > 0) {
        bad(`G-6 给模型看的口径里缺「全自动」那条边界的关键限定：${missAuto.join(', ')}`
          + '\n      ⇒ `UD-149` §一：「全自动」只到"不再先问就派出去"这一层，'
          + '\n        不解除任何红线、不越过权限档位（名字带「全」⇒ 必须挡住"权限更大"那个误读）')
      } else ok('G-6 给模型看的口径含两条边界全部关键限定（多会话 / 全自动）')

      /**
       * ── ⚠⚠ **界面侧红线条：落点跟着控件走**（2026-10-24 · B 席 · 第三处落点过期）──
       *
       * ── 改前是什么 ──────────────────────────────────────────────────────
       *   只查 `PANEL_ZH`（设置面板词典）。⚠ `WorkModeCard` 删掉后，面板里那条红线
       *   词条**跟着一起没了** ⇒ 本条变红，而红线**完好地活在弹窗词典**
       *   （`HOB_DIALOG_ZH` 的 `redline.workMode`）。⇒ 又是"判据盯着旧落点"。
       *
       * ── 现在（⚠ 判"承载控件的那一屏有红线"，⛔ 不判在哪个文件）──────────
       *   对每个**真的承载控件**的落点各判一次；一个落点都没有 ⇒ 上面 G-3 ① 已报红。
       *   ⚠ 判据词仍是**面板/弹窗上真出现的措辞**（⛔ 不按源码注释里的说法判）。
       */
      {
        const zhPanel = dictBlock('PANEL_ZH')
        const zhDialog = (() => {
          const m = /const\s+HOB_DIALOG_ZH\s*:[^=]*=\s*\{([\s\S]*?)\n\}/.exec(dialogSrc)
          return m === null ? null : m[1]
        })()
        const RED_SPOTS = [
          { name: '设置面板', block: panelSpot ? zhPanel : null, active: panelSpot },
          { name: '新建会话弹窗', block: dialogSpot ? zhDialog : null, active: dialogSpot },
        ].filter((x) => x.active)
        if (RED_SPOTS.length === 0) {
          bad('G-6 没有任何承载「工作方式」控件的落点 ⇒ 界面上的红线条无从核对（⛔ 不按通过处理）')
        }
        for (const spot of RED_SPOTS) {
          if (spot.block === null) {
            bad(`G-6 抽不出${spot.name}的中文词典 ⇒ 界面上的红线条无从核对（不按通过处理）`)
            continue
          }
          /** ⚠ 界面侧同样**两段都要在**：多会话四限定 + 自动档那条边界。 */
          const missPanel = ['看板', '别人项目的卡', '判据', '权限'].filter((a) => !spot.block.includes(a))
          /**
           * ⚠ **自动档边界**：判据词随实现措辞（`全自动` 是旧设置面板的说法；
           *   弹窗里写的是「自动档同理：…不越过权限档位」）。
           *   ⇒ 取"**要么出现「全自动」+「不越过权限档位」，要么出现「自动档」+「不越过权限档位」**"，
           *     ⛔ 不许放宽成"只要有「不越过权限档位」就算"（那样少了"自动档"这个指向就分不清
           *     它管的是哪一档）。
           */
          const autoNamed = spot.block.includes('全自动') || spot.block.includes('自动档')
          const missPanelAuto = [
            ...(autoNamed ? [] : ['全自动 / 自动档']),
            ...(['不越过权限档位'].filter((a) => !spot.block.includes(a))),
          ]
          if (missPanel.length > 0) {
            bad(`G-6 ${spot.name}的红线条缺关键限定：${missPanel.join(', ')}`
              + ' —— 用户看不到就等于没有（本项名字自带"更多更强"的暗示，界面必须挡住那个误读）')
          } else if (missPanelAuto.length > 0) {
            bad(`G-6 ${spot.name}的红线条缺「自动档」边界：${missPanelAuto.join(', ')}`
              + '\n      ⇒ 「自动」档显示名下一句都没有它，用户只会看到"自动"两个字'
              + '\n        （`UD-149` §一：凡出现这一档的名，紧邻必须有那句限定）')
          } else {
            ok(`G-6 ${spot.name}上有两条边界（多会话四限定 + 自动档那条）`)
          }
        }
      }

      /**
       * ── ⚠⚠ **G-6(反证)：把红线句改错一个字 ⇒ 必须红**（2026-10-24 · B 席）──────
       *   ⚠ 为什么要它：本组的三条判据都是 `includes(锚点)` 形态 —— 那种形态**很容易**
       *     退化成恒绿（例如锚点选得太泛、或者落点取到了**注释**）。⇒ 用一次真实的
       *     "改错一个字"对拍，把"它到底咬不咬得住"变成读数。
       *   ⚠ 做法：把 `WORK_MODE_RED_LINE` 的中文源常量里那句关键限定改一个字
       *     （`不越过权限档位` ⇒ `不越过权限档委`），其余一字不动 ⇒
       *     上面那个"中文源"判据必须**当场不成立**。
       */
      {
        const KEY = '不越过权限档位'
        const BROKEN = '不越过权限档委'
        /**
         * ⚠ **只在"中文红线常量体内"改字**（⛔ 不全文 `replace`）——
         *   `work-mode.ts` 里 `KEY` 出现 **2 次**：一次在**注释**里（讲这条边界的来由）、
         *   一次在**常量正文**里。全文 replace 只会改到第一处（注释）⇒ 对拍**没打到靶子**
         *   ⇒ 反证误报"判据恒绿"（本组第一版就这么误报过一次，是反证自己的缺陷）。
         *   ⇒ 先把常量体切出来、只在它里面替换，再拼回全文。
         */
        const rawShared = sharedSrc ?? ''
        const zhStart0 = rawShared.indexOf('export const WORK_MODE_RED_LINE')
        const zhEnd0 = zhStart0 < 0 ? -1 : rawShared.indexOf('\n\n', zhStart0)
        const zhBodyRaw = zhStart0 < 0 || zhEnd0 < 0 ? '' : rawShared.slice(zhStart0, zhEnd0 + 2)
        const mutBody = zhBodyRaw.includes(KEY) ? zhBodyRaw.replace(KEY, BROKEN) : ''
        if (!zhBodyRaw.includes(KEY)) {
          bad(`G-6(反证) 【失去靶子】中文红线源里找不到「${KEY}」⇒ 反证无从对拍（⛔ 不按通过处理）`)
        } else if (mutBody.includes(KEY)) {
          bad('G-6(反证) 【判据恒绿】把中文红线源改错一个字之后，那三条判据**仍然认为它在**'
            + ' ⇒ 说明它们不是在比对这句话本身（锚点选得太泛 / 取到了注释）')
        } else {
          ok(`G-6(反证) ✓ 负向对拍：把中文红线源的「${KEY}」改一个字（⇒「${BROKEN}」）后，`
            + '该判据**当场不成立** ⇒ 它咬的确实是这句限定本身')
        }
      }

      const descBlock = (() => {
        const start = cfgSrc.indexOf('workMode: z.object({')
        if (start < 0) return ''
        const at = cfgSrc.indexOf('}).default({})', start)
        return at < 0 ? '' : cfgSrc.slice(start, at)
      })()
      const SCHEMA_ANCHORS = ['不解除任何既有红线', '不改看板', '不碰别人项目的卡', '不放宽任何判据']
      const SCHEMA_AUTO = ['全自动', '不越过权限档位']
      const missSchema = SCHEMA_ANCHORS.filter((a) => !descBlock.includes(a))
      const missSchemaAuto = SCHEMA_AUTO.filter((a) => !descBlock.includes(a))
      if (missSchema.length > 0) {
        bad(`G-6 schema 的 \`.description()\` 缺红线关键限定：${missSchema.join(', ')}`
          + '\n      ⇒ 插件管理页的自动表单只读这份 description；它缺了，红线在自动表单里就不存在')
      } else if (missSchemaAuto.length > 0) {
        bad(`G-6 schema 的 \`.description()\` 缺「全自动」边界：${missSchemaAuto.join(', ')}`
          + '\n      ⇒ 三处落点必须同形（给模型的正文 / 面板紧邻控件 / 这份 description），少一处就是缺口')
      } else ok('G-6 schema 的 `.description()` 含两条边界（自动表单里也在场）')
    }

    // ── G-7 兜底同值 ─────────────────────────────────────────────────────
    {
      const mHostFallback = /export function workMode\([\s\S]*?return DEFAULT_WORK_MODE/.test(cfgSrc)
      const mClientFallback = clientSettingsSrc === undefined
        ? false
        : /export function readWorkMode\([\s\S]*?DEFAULT_WORK_MODE/.test(clientSettingsSrc)
      const mClientImports = clientSettingsSrc === undefined
        ? false
        : /from\s*'\.\.\/shared\/work-mode\.ts'/.test(clientSettingsSrc)
      if (!mHostFallback) {
        bad('G-7 host 收口函数 `workMode()` 的兜底不是 `DEFAULT_WORK_MODE`'
          + ' —— 兜底值必须在唯一来源里，⛔ 不许在函数体里另写一个字面量')
      } else if (!mClientFallback || !mClientImports) {
        bad('G-7 面板的 `readWorkMode()` 没有从 `shared/work-mode.ts` 取兜底'
          + '（缺 `DEFAULT_WORK_MODE` 或没 import 该文件）'
          + '\n      ⇒ 配置读不到时面板显示与实际生效各说一套，且都不报错')
      } else {
        ok(`G-7 兜底同源（两处都用 shared 的 \`DEFAULT_WORK_MODE\` = ${defaultMode}）`)
      }
    }

    // ── G-8 写入路径 ─────────────────────────────────────────────────────
    if (clientSettingsSrc === undefined) {
      bad('G-8 读不到 `src/client/settings.ts` ⇒ 写入路径无从核对（不按通过处理）')
    } else {
      const hasWhole = /path:\s*\[\s*['"]workMode['"]\s*\]/.test(clientSettingsSrc)
      const hasSub = /path:\s*\[\s*['"]workMode['"]\s*,\s*['"]mode['"]\s*\]/.test(clientSettingsSrc)
      if (hasWhole) {
        bad("G-8 设置绑定里出现整块写 `['workMode']` —— 父对象不 volatile ⇒ 宿主 isVolatilePath 会拒")
      } else if (!hasSub) {
        bad("G-8 找不到子字段写入路径 `['workMode','mode']` —— 面板的写入路径可能已被改坏")
      } else ok("G-8 写入走子字段路径 `['workMode','mode']`（⛔ 无整块写）")
    }

    // ── G-9 ⛔ 无直读 ────────────────────────────────────────────────────
    {
      const files = [PRESET_TOOLS, PANEL]
      const hits = []
      for (const f of files) {
        const s = readG(f)
        if (s === undefined) continue
        const code = stripComments(s)
        for (const m of code.matchAll(/\.workMode\.\w+/g)) hits.push(`${f.slice(root.length + 1)}: ${m[0]}`)
      }
      if (hits.length > 0) {
        bad(`G-9 模块侧/面板出现对 \`workMode\` 子字段的**直读**（${hits.length} 处）`
          + ' —— volatile ref 直读恒为对象且不报错：\n     ' + hits.join('\n     '))
      } else ok('G-9 模块侧与面板无 `*.workMode.*` 直读（解 ref 收口在 config.ts 的 workMode()）')
    }

    // ── G-11 预设模块的**具名导出不拖垮整块**（2026-10-19 · `TASK-D`①）──────
    //
    // ⚠⚠ 本组要咬死的形态（已实测的真事故，见 `TASK-D`）：ESM 的**具名导入在链接期**
    //   就要求目标模块有那个名字 ⇒ 少一个可选服务 ⇒ **整个 preset 模块求值失败**
    //   ⇒ `apply` 从不被调用 ⇒ 工具面 25→12、`hob_*` 全没、`fiberPhase=null`，**而且不报错**。
    //   `TASK-D2` 只治了 `../config.ts` 一处；本组把这条纪律**扩到全部依赖模块**并**机检钉住**。
    //
    // 判据（四条，每条都能失败）：
    //   ① `src/preset/tools.ts` 里**零具名值导入**（只允许 `import type`）—— 否则下次再加一个名字
    //      就又是同一个形态；
    //   ② **可读**：降级必须既有 `warn` 又有**可查的落点**（`DEGRADED_CAPABILITIES`）；
    //   ③ **关键依赖不许一起降级**：`modules/tools.ts` 那五个名字 + `PERMISSION_SERVICE`
    //      必须是 `throw` 路径（`degrade(` 不许出现在它们的分支里）；
    //   ④ **真跑**（Node ≥22 直载 TS）：沙盒里删掉一个可选导出 ⇒ 模块**仍然求值成功**、
    //      `apply` 跑完、降级清单里有它；再删掉一个**关键**导出 ⇒ **必须抛**。
    {
      const presetSrc = presetToolsSrc
      if (presetSrc === undefined) {
        bad('G-11 读不到 `src/preset/tools.ts` ⇒ 降级面无从核对（不按通过处理）')
      } else {
        const code = stripComments(presetSrc)
        // ① 零具名值导入（`import { a, b } from '...'`）；`import type { T }` 与命名空间导入不算
        const namedValueImports = []
        for (const m of code.matchAll(/^\s*import\s+(?!type\b)([^;]*?)\s+from\s+'([^']+)'/gm)) {
          const clause = m[1]
          if (/^\s*\*\s+as\s+/.test(clause)) continue          // `import * as ns` —— 允许
          // ⚠ 本组只盯**依赖模块**（相对路径）：`node:` 内建是宿主提供的固定面，
          //   不存在"旧缓存里没这个名字"那种形态（它不是本插件自己的产物）。
          if (!m[2].startsWith('.')) continue
          if (/^\s*\{/.test(clause) && /\btype\b/.test(clause)) continue // 混合型，保守放行
          if (/^\s*\{/.test(clause)) namedValueImports.push(`${m[2]} → ${clause.trim()}`)
          else namedValueImports.push(`${m[2]} → ${clause.trim()}`) // 默认导入同形风险
        }
        if (namedValueImports.length > 0) {
          bad(`G-11 \`src/preset/tools.ts\` 里仍有**具名值导入**（${namedValueImports.length} 处）：`
            + `\n     ${namedValueImports.join('\n     ')}`
            + '\n      ⇒ ESM 具名导入在**链接期**校验名字：任何一个对不上 ⇒ **整块模块求值失败** ⇒'
            + '\n        `apply` 从不被调用 ⇒ `hob_*` 全消失、工具面塌一半，**且不报错**（`TASK-D` 的实测链）'
            + '\n      ⇒ 一律改 `import * as ns from \'…\'` + 运行时取值（只导类型可用 `import type`）')
        } else {
          ok('G-11 预设模块零具名值导入（依赖面全部命名空间导入；类型面用 `import type`）')
        }

        // ② 降级可读：`degrade(` 必须同时有 warn 与可查落点
        if (!/export const DEGRADED_CAPABILITIES/.test(code)) {
          bad('G-11 降级没有**可查的落点**（找不到 `export const DEGRADED_CAPABILITIES`）'
            + '\n      ⇒ 只有日志时"少了什么"事后查不到（用户默认关着 debugLog）')
        } else if (!/logger\?\.warn\?\./.test(code)) {
          bad('G-11 降级没有 warn 通道（找不到 `logger?.warn?.(`）⇒ 少了一块却没人说')
        } else if (!/const\s+degrade\s*=/.test(code)) {
          bad('G-11 找不到统一的 `degrade()` 落点 ⇒ 各分支各写一份告警，必然漂（E-110 同族）')
        } else {
          ok('G-11 降级**可读**：`degrade()` 统一落点 = warn + `DEGRADED_CAPABILITIES`（事后可查）')
        }

        // ③ 关键依赖不许降级：`modules/tools.ts` 那五个名字 + `PERMISSION_SERVICE` 走 throw
        const CRITICAL_FACE = ['GATE_SERVICE', 'DEFAULT_DENY', 'DEFAULTS', 'createHobTools', 'ledgerRootOf']
        const faceBlock = /const TOOLS_FACE_NAMES = \[([\s\S]*?)\] as const/.exec(code)
        const declared = faceBlock === null
          ? []
          : [...faceBlock[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
        const missDecl = CRITICAL_FACE.filter((n) => !declared.includes(n))
        if (missDecl.length > 0) {
          bad(`G-11 关键依赖清单不全：${missDecl.join(', ')} 不在 \`TOOLS_FACE_NAMES\` 里`
            + '\n      ⇒ 判据：**它缺席时其余能力还能不能安全工作** —— 这五个名字里有工具定义本身、'
            + '\n        门禁名、账本根解析、默认值、屏蔽名单，任何一个缺席都无法安全降级')
        } else if (!/throw new Error\(`dsh-hob preset: 关键依赖（modules\/tools\.ts 的/.test(code)) {
          bad('G-11 关键依赖缺席的路径**不是 throw** ⇒ 会静默半挂载（把"装错了"变成"看起来正常"）')
        } else if (!/throw new Error\(`dsh-hob preset: 关键依赖 "PERMISSION_SERVICE" 取不到/.test(code)) {
          bad('G-11 `PERMISSION_SERVICE` 缺席的路径**不是 throw** ⇒ 安全面三处会按一个编出来的档位放行/收窄')
        } else {
          ok('G-11 关键依赖**不降级**：`modules/tools.ts` 五名 + `PERMISSION_SERVICE` 缺席一律 `throw`')
        }

        // ④ **真跑**：沙盒删导出 ⇒ 可选降级 / 关键抛错
        //
        // ⚠⚠ **每个场景必须用独立子进程**（2026-10-19 实测踩到）：
        //   同进程里跑两次时，第二次 `import` 的 `modules/tools.ts` 命中了**第一次的 ESM 缓存**
        //   ⇒ 盘上删了导出也没用 ⇒ "关键依赖缺失"那条**假 PASS**（`E-131` 同族：
        //   判据自身失效却报绿）。子进程隔离后每个场景都是**全新的模块图**。
        {
          const { spawnSync } = await import('node:child_process')
          const { mkdtempSync, cpSync, rmSync, writeFileSync, lstatSync } = await import('node:fs')
          const { tmpdir } = await import('node:os')
          let sandbox = null
          try {
            sandbox = mkdtempSync(join(tmpdir(), 'hob-g11-'))
            /**
             * ⚠⚠ **`dereference: true` 是本处防写穿的要害**（同 `check-orch-state.mjs` 丁-7）：
             *   `fs.cpSync` **默认不解引用**（`dereference:false`）⇒ 源树里若 `src` 是**软链**，
             *   复制出来的 `sandbox/src` **还是那条软链** ⇒ 下面场景脚本里的
             *   `writeFileSync(join(SB,'src',file))` 会**写回源树**。
             *   ⚠ 同款机理已在第 322 轮实测过：受控靶仓 `git status --porcelain src/`
             *     跑前 0 行、跑后 **4 行 M**。
             *   ⚠ 本处当天 `src` 是**真目录**故不发作 —— 这是**消掉同款风险**，⛔ 不是修一个现存缺陷。
             */
            cpSync(join(root, 'src'), join(sandbox, 'src'), { recursive: true, dereference: true })
            /**
             * ⚠ **复制完必须自证"不是软链"**（⛔ 不靠"我给了参数所以一定对"）——
             *   与 `check-orch-state.mjs` 的 `lstatSync(...).isSymbolicLink()` 自证逐字对齐：
             *   仍然是软链 ⇒ **当场抛**（由外层 catch 落 `bad`：不按通过处理），
             *   ⛔ 不许带着写穿风险继续跑那两个场景。
             */
            if (lstatSync(join(sandbox, 'src')).isSymbolicLink()) {
              throw new Error('沙箱里的 `src` 仍是软链（`dereference` 未生效）⇒ ⛔ 会写穿到源树，本组拒绝继续')
            }
            writeFileSync(join(sandbox, 'package.json'), JSON.stringify({ type: 'module', name: 'g11' }))

            /** 场景脚本：在**本进程**里改名导出 → import 真模块 → 调 apply → 打印一行 JSON。 */
            const runnerSrc = `
import { readFileSync, writeFileSync, symlinkSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
const SB = process.cwd()
const REPO = process.argv[2]
const [file, exportName] = process.argv[3].split('::')
// ⚠ node_modules 用**绝对路径**软链（相对路径在临时目录里解析不到 ⇒ 被测模块 import 宿主包失败）
const nm = resolve(REPO, 'node_modules')
// ⚠ 第二个场景时软链已存在（同一个沙盒跑两次）⇒ 先判再建，⛔ 别让 EEXIST 把判据搞成"跑不起来"
if (existsSync(nm) && !existsSync(join(SB, 'node_modules'))) symlinkSync(nm, join(SB, 'node_modules'), 'dir')
if (file !== '-') {
  const p = join(SB, 'src', file)
  const t = readFileSync(p, 'utf8')
  const re = new RegExp('export\\\\s+(const|function|async function)\\\\s+' + exportName + '\\\\b')
  if (!re.test(t)) { console.log(JSON.stringify({ setupError: 'export not found: ' + exportName })); process.exit(0) }
  writeFileSync(p, t.replace(re, '$1 ' + exportName + '___absent'))
}
const warns = []
const shell = {
  logger: { debug() {}, info() {}, warn: (m) => warns.push(String(m)) },
  get: (k) => (k === 'hobPermission' ? () => 'ledger' : k === 'hobWorkMode' ? () => 'auto' : undefined),
  inject: () => ({ dispose: () => {} }),
  effect: (fn) => { try { fn() } catch {} },
  on: () => ({ dispose: () => {} }),
  provide: () => {},
  tools: { guard: () => () => {}, restrict: () => {}, register: () => () => {} },
}
let threw = null, degraded = [], evaluated = false
try {
  const mod = await import(pathToFileURL(join(SB, 'src', 'preset', 'tools.ts')).href)
  evaluated = true
  try { mod.apply(shell, {}) } catch (e) { threw = String(e?.message ?? e) }
  degraded = (mod.DEGRADED_CAPABILITIES ?? []).map((d) => d.key)
} catch (e) { threw = String(e?.message ?? e) }
console.log(JSON.stringify({ evaluated, threw, degraded, warns }))
`
            writeFileSync(join(sandbox, 'runner.mjs'), runnerSrc)

            /** 跑一个场景（**独立子进程**），返回它打印的 JSON。 */
            const runScenario = (spec) => {
              const r = spawnSync(process.execPath, [join(sandbox, 'runner.mjs'), root, spec], {
                cwd: sandbox, encoding: 'utf8', timeout: 120000,
              })
              const line = String(r.stdout ?? '').trim().split('\n').filter((l) => l.startsWith('{')).pop()
              if (line === undefined) {
                throw new Error(`场景 ${spec} 没有输出可读结果（stderr: ${String(r.stderr ?? '').slice(0, 300)}）`)
              }
              return JSON.parse(line)
            }

            // (a) 可选：删 `WORK_MODE_SERVICE`（今晚真事故的形态）⇒ 降级、不抛
            const opt = runScenario('config.ts::WORK_MODE_SERVICE')
            if (opt.setupError !== undefined) {
              bad(`G-11 场景搭不起来：${opt.setupError} ⇒ 不按通过处理`)
            } else if (opt.threw !== null) {
              bad(`G-11 【可选项缺失】**照旧整块失败**了：${opt.threw}`
                + '\n      ⇒ 这正是本件要治的形态：少一个可选服务不该拖垮整个模块')
            } else if (!opt.degraded.includes('WORK_MODE_SERVICE')) {
              bad('G-11 【可选项缺失】降级清单里没有 `WORK_MODE_SERVICE`'
                + '\n      ⇒ "少了什么"不可读（清单为空 = 事后查不到）')
            } else if (opt.warns.length === 0) {
              bad('G-11 【可选项缺失】没有任何可读 warn')
            } else {
              ok(`G-11 ✓ 可选导出缺失 ⇒ **模块仍求值成功**、apply 跑完、降级可读（`
                + `清单=${opt.degraded.join('/')}；warn=${opt.warns.length} 条）`)
            }

            // (b) 关键：删 `createHobTools` ⇒ **必须抛**，且抛错点明缺哪个名字
            const crit = runScenario('modules/tools.ts::createHobTools')
            if (crit.setupError !== undefined) {
              bad(`G-11 场景搭不起来：${crit.setupError} ⇒ 不按通过处理`)
            } else if (crit.threw === null) {
              bad('G-11 【关键依赖缺失】**没有失败** ⇒ 关键依赖被一起降级了'
                + '\n      ⇒ 那会把"装错了"变成"看起来正常"：半套工具 / 屏蔽名单凭空消失，用户看不出')
            } else if (!/关键依赖/.test(crit.threw) || !/createHobTools/.test(crit.threw)) {
              bad(`G-11 【关键依赖缺失】抛错文本不可读（未点名缺哪个名字）：${crit.threw}`)
            } else if (crit.degraded.length !== 0) {
              bad(`G-11 【关键依赖缺失】关键依赖被写进了降级清单（${crit.degraded.join(',')}）`
                + ' —— 关键依赖是 throw 路径，⛔ 不是降级路径')
            } else {
              ok(`G-11 ✓ 关键依赖缺失 ⇒ **照旧失败**且原因可读（「${crit.threw.slice(0, 42)}…」）`)
            }
          } catch (e) {
            // ⚠ 跑不起来就是"什么都没测到" ⇒ FAIL（⛔ 不许静默跳过，`E-130/E-131` 同族）
            bad(`G-11 真跑那一条**跑不起来**（${String(e?.message ?? e)}）⇒ 不按通过处理`
              + '\n      ⇒ ⛔ 跑不起来 ≠ 通过')
          } finally {
            if (sandbox !== null) { try { rmSync(sandbox, { recursive: true, force: true }) } catch { /* 忽略 */ } }
          }
        }
      }
    }

    // ── G-12 面板明写「改代码 / 重 build 之后要重启实例」（2026-10-19 · `TASK-D`②）──
    //
    // ⚠ 为什么这条必须机检：`build` **只是写盘**，运行中的实例用的是**启动那一刻**加载的代码。
    //   实测吃亏过：以为改了就是生效了。⇒ 界面上必须有一句，且措辞要准：
    //     · 必须说清"两步不是一步"（build ≠ 生效）；
    //     · ⛔ 不许写成"重启一下就好" —— 重启会冲掉在跑的派发（本项目已实测多次）。
    //
    // 判据（三条）：
    //   ① 两份词典**都有**这三个键（缺一个 ⇒ 该语言下**静默显示键名**）；
    //   ② 中文那句**同时**含"build 只写盘 / 要重启 / 会冲掉在等回传的派发"三件事（缺一即 FAIL）；
    //   ③ 面板**真的渲染了**它（词典里写了却不挂在 JSX 上 = 用户看不见，等于没写）。
    {
      const zhBlock = dictBlock('PANEL_ZH')
      const enBlock = dictBlock('PANEL_EN')
      const KEYS = ['note.buildrestart.pre', 'note.buildrestart.strong', 'note.buildrestart.post']
      if (zhBlock === null || enBlock === null) {
        bad('G-12 抽不出两份面板词典 ⇒ 重启提示无从核对（不按通过处理）')
      } else {
        const missZh = KEYS.filter((k) => !zhBlock.includes(`'${k}'`))
        const missEn = KEYS.filter((k) => !enBlock.includes(`'${k}'`))
        if (missZh.length > 0 || missEn.length > 0) {
          bad(`G-12 重启提示的键不全（zh 缺：${missZh.join(', ') || '无'}；en 缺：${missEn.join(', ') || '无'}）`
            + '\n      ⇒ 缺一个就会在那种语言下**显示键名**（宿主 translate 取不到时返回键本身）')
        } else {
          ok('G-12 重启提示三个键在中英两词典都齐（`note.buildrestart.pre/strong/post`）')
        }

        // ② 中文那句的三件事必须都在
        //   ⚠ 取法：三行**各取一次**再拼 —— ⛔ 不许用"直到下一个 note. 为止"的切片
        //     （pre 行自己就紧跟 strong 行，切片会把后两行切掉 ⇒ 判据假 FAIL）。
        const lineOf = (blk, key) => {
          const at = blk.indexOf(`'${key}'`)
          if (at < 0) return ''
          const end = blk.indexOf('\n', at)
          return blk.slice(at, end < 0 ? blk.length : end)
        }
        const zhNote = zhBlock === null
          ? ''
          : KEYS.map((k) => lineOf(zhBlock, k)).join(' ')
        const WANT_ZH = [
          ['build 只写盘', /build\s*只是把文件写到盘上/],
          ['不重启等于没改', /不重启，等于没改|等于没改/],
          ['重启会冲掉在等回传的派发', /冲掉|等在等回传|等回传的派发/],
        ]
        const missWords = WANT_ZH.filter(([, re]) => !re.test(zhNote)).map(([label]) => label)
        if (missWords.length > 0) {
          bad(`G-12 面板那句**没把该说的说全**：缺 ${missWords.join(' / ')}`
            + '\n      ⇒ 措辞必须同时讲清：build 只写盘（≠生效）· 换代码要重启 · 重启会冲掉在跑的派发。'
            + '\n        ⛔ 少了最后一条就变成"重启一下就好"，而本项目已实测多次重启会冲掉在等回传的派发')
        } else {
          ok('G-12 面板那句三件事都在（build 只写盘 / 要重启 / 会冲掉派发）')
        }

        // ③ 真的渲染了（词典写了不挂 JSX = 用户看不见）
        if (!/t\('note\.buildrestart\.pre'\)/.test(panelSrc) || !/t\('note\.buildrestart\.strong'\)/.test(panelSrc)) {
          bad("G-12 词典里有重启提示，但面板**没有渲染它**（找不到 `t('note.buildrestart.pre')` / `.strong`）"
            + '\n      ⇒ 写了不挂 = 用户看不见 = 这条提示不存在')
        } else {
          ok('G-12 重启提示**真的渲染在面板上**（`t(\'note.buildrestart.pre/strong/post\')` 三处都在）')
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // ── G-10 **装配层**：档位口径**真进上下文**且三档互不相同 ──────────────
    //
    // ⚠⚠ 本组的由来（2026-10-19 第 2 轮 · 上一单被打回的原因）：
    //   上一单的 G-4 只证明"注入了、正文随档位变"，就写在 `assembly.sections` 里；
    //   而本预设 persona 配 `complete: true` ⇒ 宿主 `assemble()` 末尾
    //   `sections: completeSection === void 0 ? transformed.sections : [completeSection]`
    //   ⇒ **任何 section 注册都被整段覆盖**。实测：三档 `renderPrompt(assembly)` 长度相同。
    //   ⇒ 所以必须**跑宿主真装配**、取**真正进模型上下文的那一份**，⛔ 不许停在 sections。
    //
    // ⚠ 本组**挂真模块**（`src/preset/tools.ts` 的 `apply`）+ **宿主真包**
    //   （`dsh-system-prompt` 的 `SystemPrompt`/`renderPrompt`/`renderContextSections`、
    //    `dsh-scope` 的 `createScope`、宿主自己的 `cordis` 的 `Context`）——
    //   ⛔ 不自己复刻装配语义（复刻的就不是判据了）。
    //
    // ⚠ 判据（三条，⛔ 缺一条就不算"真进上下文"）：
    //   ① `refreshContext()` 后 `contexts` 非空 ⇒ 那条上下文**会被 `agent-loop` 投成 user 消息**；
    //   ② 该上下文快照**含档位口径标记**（`How work is split`）与**红线标记**；
    //   ③ **三档快照互不相同**（⚠ 不是"注入内容不同"，是**最终进上下文的那段**不同）。
    // ⚠ 且必须**能失败**：内置负向对拍 —— 摘掉 context 注册 ⇒ ①②③ 必须全不成立。
    {
      let spMod, scopeMod, cordisMod, wmMod, presetMod
      let loadErr
      try {
        spMod = await import(pathToFileURL(join(HOST_NODE_MODULES, 'dsh-system-prompt', 'lib', 'index.js')).href)
        scopeMod = await import(pathToFileURL(join(HOST_NODE_MODULES, 'dsh-scope', 'lib', 'index.js')).href)
        cordisMod = await import(pathToFileURL(join(HOST_NODE_MODULES, 'cordis', 'lib', 'index.js')).href)
        wmMod = await import(pathToFileURL(join(root, 'src', 'shared', 'work-mode.ts')).href)
        presetMod = await import(pathToFileURL(PRESET_TOOLS).href)
      } catch (e) {
        loadErr = e
      }
      if (loadErr !== undefined) {
        // ⚠ 宿主包读不到 / TS 直载失败 ⇒ **FAIL，⛔ 不许静默跳过**（基准缺失不按通过处理）
        bad(`G-10 装配层判据**跑不起来**（${String(loadErr?.message ?? loadErr)}）`
          + '\n      ⇒ ⛔ 基准缺失不按通过处理：这一条正是上一单唯一缺的判据，'
          + '\n        跳过它等于回到"`assembly.sections` 里有它就算过"那个被打回的状态')
      } else if (typeof presetMod.apply !== 'function') {
        bad('G-10 `src/preset/tools.ts` 没有导出 `apply` ⇒ 装配层判据失去被测物（不按通过处理）')
      } else {
        const { SystemPrompt, renderPrompt, renderContextSections, joinContextSections } = spMod
        const { createScope, scopeOf } = scopeMod
        const { Context } = cordisMod
        const PERSONA_TEXT = 'You are Hob, the project owner between the user and the developer session.\n'
        const WANT = {
          mark: 'How work is split',
          red: 'never means more power',
          track: {
            auto: 'Decide for yourself how many tracks',
            single: 'One track, always.',
            multi: 'Split as finely',
          },
        }

        /**
         * 挂**真** `apply`，只让它跑到 `injectWorkMode`；其余挂载在假宿主下无害跳过。
         *
         * ⚠ 结构照**本预设真实配置**：
         *   · persona 段 `complete: true`（`preset-dsh-hob.patch.yml` 的 `complete: true`）；
         *   · `suppressRuntimeContext()`（同文件的 `includeRuntimeContext: false`）——
         *     ⚠ **这一条是本组的第二个靶子**：它会把非 `required` 的 context 整条丢掉，
         *     所以 `injectWorkMode` 必须写 `required: true`（摘掉它 ⇒ 本组当场 FAIL，见下）。
         *
         * @param mode 档位（模拟宿主 volatile 现读）
         * @param opts.skipContext 负向对拍：把 context 注册摘掉
         */
        const mountAndAssemble = async (mode, opts = {}) => {
          const rootCtx = new Context()
          new SystemPrompt(rootCtx, 'systemPrompt')
          const { ctx: presetCtx } = createScope(rootCtx, { preset: 'Hob' })
          const personaSp = presetCtx.systemPrompt
          personaSp.section({
            name: spMod.PERSONA_PREFIX_SECTION,
            order: personaSp.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
            text: PERSONA_TEXT,
            complete: true,
          })
          personaSp.suppressRuntimeContext()

          const shellProto = {
            logger: { debug() {}, info() {}, warn() {} },
            get: (k) => {
              // ⚠ 旧的两个全局服务**仍提供**（兼容面：入口仍 provide 它们）。
              if (k === 'hobPermission') return () => 'ledger'
              if (k === 'hobWorkMode') return () => mode
              /**
               * ⚠⚠ **2026-10-22（`REQ-04`）：必须同时提供逐会话权威**，否则本组测不到东西。
               *
               * ── 为什么必须加这一行 ──────────────────────────────────────────
               *   改后「工作方式」**只认** `hobSessionPolicy`（按会话解析）；旧 `hobWorkMode`
               *   已退成兼容面。若本 mock 只提供旧服务 ⇒ 策略服务缺席 ⇒ `modeOf()` 走
               *   保守缺省 ⇒ **三档快照全一样** ⇒ G-10 ③ 会红。
               *   ⚠ 那是**测试台缺依赖**，不是实现缺陷 —— 但⛔ 也不能因此把 ③ 删掉：
               *     三档必须有区别，这条判据是对的。⇒ 正确做法是**让测试台提供真实契约**。
               * ⚠ 这里返回的是一个**按档位回答的假会话策略**：宿主真实实现按 sessionId 查表；
               *   本组只关心"档位口径是否随会话策略变化而进上下文"⇒ 用档位当输入即可。
               */
              if (k === 'hobSessionPolicy') {
                return {
                  /**
                   * ⚠⚠ **2026-10-22 第 6 轮：必须返回 `mayProceed: true`。**
                   *
                   * ── 为什么这一行现在必须加 ──────────────────────────────────
                   *   `src/preset/tools.ts` 的 `policyOf` 改成了 **fail-closed**：
                   *   `mayProceed = r?.mayProceed === true`（缺字段 ⇒ 视为不可推进）。
                   *   ⇒ 本 mock 只给 `isHob/level/workMode/source` ⇒ `mayProceed=false`
                   *     ⇒ `textNow()` 按设计返回**暂停说明**而不是档位口径
                   *     ⇒ G-10 报"快照不含档位口径"。
                   *   ⚠ 那是**测试台缺契约**，不是实现缺陷 —— 但⛔ 也不能因此把 fail-closed 退回
                   *     "缺字段默认 true"（那正是第 5 轮修掉的真缺陷）。
                   *   ⇒ 正确做法：让 mock 提供**真实的**契约（含 `mayProceed`），
                   *     这样它测的才是"档位口径真的进了上下文"。
                   */
                  of: () => ({
                    isHob: true, level: 'ledger', workMode: mode, source: 'stored',
                    reason: '', canReadWorkspace: false,
                    persistence: 'persisted', mayProceed: true,
                  }),
                }
              }
              return undefined
            },
            inject: (deps, cb) => {
              if (!Array.isArray(deps) || !deps.includes('systemPrompt')) return { dispose: () => {} }
              const shell = Object.create(shellProto)
              const realSp = presetCtx.systemPrompt
              shell.systemPrompt = opts.skipContext === true
                ? new Proxy(realSp, { get: (t, p, r) => (p === 'context' ? () => () => {} : Reflect.get(t, p, r)) })
                : realSp
              cb(shell)
              return { dispose: () => {} }
            },
            effect: (fn, label) => presetCtx.effect(fn, label),
            on: (...a) => presetCtx.on(...a),
            provide: () => {},
            tools: { guard: () => () => {}, restrict: () => {} },
          }
          presetMod.apply(shellProto, {})

          const assembly = await presetCtx.systemPrompt.assemble({ scope: scopeOf(presetCtx) })
          // ⚠ 每步宿主都会 `refreshContext()`（`agent-loop` 的 `step`）⇒ 这里也跑一遍，
          //   才是"真正会投进上下文的那一份"。
          const refreshed = presetCtx.systemPrompt.refreshContext(assembly, { scope: scopeOf(presetCtx) })
          const ctxSections = renderContextSections(refreshed)
          return {
            rendered: renderPrompt(assembly),
            snapshot: joinContextSections(ctxSections),
            contextCount: refreshed.contexts.length,
          }
        }

        try {
          const pos = {}
          for (const m of values) pos[m] = await mountAndAssemble(m)

          // ① contexts 非空（否则它根本不会被投进上下文）
          const emptyCtx = values.filter((m) => pos[m].contextCount === 0)
          if (emptyCtx.length > 0) {
            bad(`G-10 「工作方式」的 context **在三档里都被丢掉了**（${emptyCtx.join(', ')} 档 contexts=0）`
              + '\n      ⇒ ⚠ 本预设 persona 配了 `includeRuntimeContext: false` ⇒ `suppressRuntimeContext()`；'
              + '\n        宿主 `assemble()`/`refreshContext()` 里 `if (suppressed && provider?.required !== true) continue;`'
              + '\n      ⇒ 注册 context 时必须 `required: true`，否则整条被静默丢弃（外观与"从没注册"一样）')
          } else {
            ok(`G-10 三档 context 都在（contexts=${values.map((m) => pos[m].contextCount).join('/')}，`
              + '⚠ 非 required 会被 suppressRuntimeContext 丢掉，故必须 required:true）')
          }

          // ② 快照含档位口径 + 红线
          const missMark = values.filter((m) => !pos[m].snapshot.includes(WANT.mark))
          const missRed = values.filter((m) => !pos[m].snapshot.includes(WANT.red))
          if (missMark.length > 0) {
            bad(`G-10 进上下文的快照**不含档位口径**：${missMark.join(', ')} 档缺「${WANT.mark}」`
              + '\n      ⇒ ⛔ 这就是「空旋钮」：面板上有档位、背后没有任何东西进模型上下文')
          } else if (missRed.length > 0) {
            bad(`G-10 进上下文的快照**不含红线**：${missRed.join(', ')} 档缺「${WANT.red}」`
              + ' —— 红线必须三档共同在场，⛔ 不许只在多会话档')
          } else {
            ok('G-10 三档进上下文的快照都含档位口径与红线')
          }

          // ③ 三档快照互不相同
          const snaps = values.map((m) => pos[m].snapshot)
          if (new Set(snaps).size !== values.length) {
            bad(`G-10 三档**进上下文的快照不是互不相同**（实测 ${new Set(snaps).size} 种 / 共 ${values.length} 档）`
              + '\n      ⇒ 档位改了而模型看到的口径没变 = 假消费')
          } else {
            ok(`G-10 三档进上下文的快照互不相同（${values.map((m) => `${m}=${pos[m].snapshot.length}字符`).join(' · ')}）`)
          }

          // ④ 每一档的"那一档特有语义"确实在它自己的快照里（朝对的方向不同）
          const trackMiss = values.filter((m) => !pos[m].snapshot.includes(WANT.track[m]))
          if (trackMiss.length > 0) {
            bad(`G-10 这些档的上下文里缺它**自己那条**语义标记：${trackMiss.join(', ')}`
              + ' —— "不同"还不够，必须朝"本档应有的方向"不同')
          } else ok('G-10 三档上下文各含自己的语义标记（auto 自判 / single 恒定一路 / multi 拆更细）')

          // ⑤ **内置负向对拍**：摘掉 context 注册 ⇒ ②③ 必须**都不成立**
          const neg = {}
          for (const m of values) neg[m] = await mountAndAssemble(m, { skipContext: true })
          const negSnaps = values.map((m) => neg[m].snapshot)
          const negHasMark = negSnaps.some((s) => s.includes(WANT.mark))
          const negUniq = new Set(negSnaps).size
          if (negHasMark || negUniq === values.length) {
            bad(`G-10 【负向对拍失败】摘掉 context 注册后判据**仍然成立**`
              + `（含口径=${negHasMark} · 不同快照数=${negUniq}）`
              + '\n      ⇒ 说明本组测的不是"进上下文"这一环 ⇒ 判据失去分辨力')
          } else {
            ok('G-10 ✓ 负向对拍：摘掉 context 注册 ⇒ 上下文里没有档位口径、三档不再有区别'
              + '（⇒ 本组测的确实是"进上下文"那一环）')
          }
        } catch (e) {
          bad(`G-10 装配层判据抛错（${String(e?.message ?? e)}）⇒ 不按通过处理`
            + '\n      ⇒ ⛔ 跑不起来 ≠ 通过（`E-130/E-131` 同族）')
        }
      }
    }
  }
}

// ── T. **三向键集对账：schema ⊇ ModulesConfig ⊇ Config.modules**（2026-10-21 · 第 333 轮 · **乙-9**）──
//
// ⚠⚠ 本组守的是哪一格（PROJECT-SURVEY-3 §6.2 乙-9，乙类最后一条）：
//   Config.modules 只声明了 **3** 个键（tools / bus / settings），
//   而 ModulesConfig 与 schema 当时都是 **5 个** ⇒ 缺的正是那两个高风险开关。
//   ⚠ 2026-10-24：自研跨实例投递退场 ⇒ 现在三处都是 **4 个** 键（tools / bus / orch / settings）。
//   ⚠ 运行期一律走 moduleSwitches（读运行时对象、不读这个类型）
//     ⇒ **一件事都不响**：编译能过、check:all 全绿、设置页照常显示这两项。
//   ⇒ ⚠ 所以**光补齐接口不够** —— 不钉住的话，下次加一个模块键照样会漂，
//     而且是**同一个静默形态**（无人发现）。
//
// ── 判据：三向包含，且**双向**（不是单向子集检查）──────────────────
//   记三个键集（⚠ 全部从源码实测解析，⛔ 不硬编码键名 —— 硬编码就是第二份会漂的东西）：
//     · K_schema —— src/config.ts 里 modules: z.object({ … }) 的直接子键；
//     · K_iface  —— interface ModulesConfig { … } 的顶层键；
//     · K_cfg    —— Config 里 modules: { … } 那个**内联**对象类型的键。
//   ⚠ 要求三条，缺一不可：
//     ① K_schema ⊇ K_iface（schema 必须能配置接口声明的每一个开关）
//     ② K_iface ⊇ K_cfg（Config.modules 必须声明接口的每一个键 —— **乙-9 就是这里破的**）
//     ③ 三者不漂移：K_schema === K_iface === K_cfg（⚠ 这条比 ①② 更强，
//        专治"两个都少同一个键"那种情况 —— 那时 ①② 都成立却仍是漂的）
//
// ⚠ 为什么用源码文本解析而不是 import 运行时对象：Config 是**纯类型接口**，
//   运行期**不存在**（tsc 编译后擦除）⇒ 只能读源码。⚠ 这也是本缺陷当初看不见的原因之一。
// ⚠ ⛔ 不硬编码键名清单：具体开关名**一个都不写进判据**
//   —— 全部从上面三处源码里抽出来比对。⇒ 加模块/删模块时本组自动跟上。
{
  /** ⚠ 便于跑"改前 / 改后 / 反向"三档：允许外部塞一份源码进来（默认读真仓）。 */
  const T_SRC = process.env.HOB_T_SRC !== undefined && process.env.HOB_T_SRC !== ''
    ? process.env.HOB_T_SRC
    : null

  /**
   * 从一个 { … } 块里抽出**顶层的**「标识符:」形式的键（⚠ 只取深度 1）。
   * ⚠ 用**括号计数**而不是正则一把梭：这三处的值里都含对象字面量
   *   （如 import(...).Volatile<boolean> 与 z.boolean().default(true)），
   *   正则会在嵌套里误抓。
   */
  const topKeysOf = (blockBody) => {
    const keys = []
    let depth = 0
    let segStart = 0
    const segs = []
    /**
     * ⚠⚠ **按顶层行切段**（不是按 `;`）：TS interface 成员**不写分号**
     *   ⇒ 按 `;` 切会把整个块体当一段。⚠ 这里改成"在 depth === 0 处遇到换行就切"。
     */
    for (let i = 0; i < blockBody.length; i++) {
      const ch = blockBody[i]
      if (ch === '(' || ch === '{' || ch === '[') depth++
      else if (ch === ')' || ch === '}' || ch === ']') depth--
      else if (ch === '\n' && depth === 0) {
        segs.push(blockBody.slice(segStart, i))
        segStart = i + 1
      }
    }
    segs.push(blockBody.slice(segStart))
    for (const seg of segs) {
      /**
       * ⚠ 只认「行首 标识符:」。⚠ 段内可能夹注释，先剥掉再判 ——
       *   否则注释里的 "xxx:" 会被当成键。
       */
      const stripped = seg
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((l) => l.replace(/\/\/.*$/, ''))
        .join('\n')
      /**
       * ⚠⚠ **按行判，而不是按分号分段**（2026-10-21 · 第 333 轮现场实测的坑）：
       *   TS 的 interface 成员**不写分号**（`tools: boolean` 后面直接换行）⇒
       *   用 `;` 分段会把**整个块体当成一段**、只认出第一个键
       *   ⇒ ⚠ 本组会"看起来绿、其实只比了 1 个键"（比恒绿更坏：它有输出、像在干活）。
       *   ⇒ 现在逐行扫：**行首的 `标识符:`** 就是成员声明（⚠ 对象字面量的值也长这样，
       *     但那些行**不以行首标识符开头**——它们在 `{}` 内部、缩进更深，
       *     而我们已经用 `depth === 0` 只在顶层扫）。
       */
      const m = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(stripped)
      if (m !== null) keys.push(m[1])
    }
    return keys
  }

  /** 取 src 里 startIdx 之后第一个 { 的**配对块体**（{} 之内）。 */
  const blockAfter = (src, startIdx) => {
    const open = src.indexOf('{', startIdx)
    if (open < 0) return null
    let depth = 0
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') {
        depth--
        if (depth === 0) return src.slice(open + 1, i)
      }
    }
    return null
  }

  /** 取一个 interface 的块体。 */
  const ifaceBody = (src, nameRe) => {
    const m = nameRe.exec(src)
    if (m === null) return null
    return blockAfter(src, m.index)
  }

  let tSrc = null
  try {
    tSrc = T_SRC !== null ? readFileSync(T_SRC, 'utf8') : readFileSync(CONFIG_TS, 'utf8')
  } catch (e) {
    bad('T 【失去基准】读不到 config 源码（' + String(e?.message ?? e) + '）⇒ 三向键集对账无法进行（不按通过处理）')
  }

  if (tSrc !== null) {
    /** ① schema */
    const Ks = (() => {
      const m = /modules\s*:\s*z\s*\.\s*object\s*\(/.exec(tSrc)
      if (m === null) return { label: 'schema', keys: null, why: '找不到 modules: z.object(' }
      const body = blockAfter(tSrc, m.index)
      if (body === null) return { label: 'schema', keys: null, why: '找不到配对的 {} 块' }
      const keys = topKeysOf(body)
      return { label: 'schema', keys, why: keys.length === 0 ? '解析出 0 个键' : '' }
    })()
    /** ② ModulesConfig */
    const Ki = (() => {
      const body = ifaceBody(tSrc, /export\s+interface\s+ModulesConfig\b/)
      if (body === null) return { label: 'ModulesConfig', keys: null, why: '找不到 interface ModulesConfig' }
      const keys = topKeysOf(body)
      return { label: 'ModulesConfig', keys, why: keys.length === 0 ? '解析出 0 个键' : '' }
    })()
    /** ③ Config.modules */
    const Kc = (() => {
      const body = ifaceBody(tSrc, /export\s+interface\s+Config\b/)
      if (body === null) return { label: 'Config.modules', keys: null, why: '找不到 interface Config' }
      const mm = /(^|\n)\s*modules\s*:\s*/.exec(body)
      if (mm === null) return { label: 'Config.modules', keys: null, why: 'interface Config 里没有 modules: 段' }
      const blk = blockAfter(body, mm.index)
      if (blk === null) return { label: 'Config.modules', keys: null, why: 'modules: 后面没有配对的 {} 块' }
      const keys = topKeysOf(blk)
      return { label: 'Config.modules', keys, why: keys.length === 0 ? '解析出 0 个键' : '' }
    })()

    const unreadable = [Ks, Ki, Kc].filter((x) => x.keys === null)
    if (unreadable.length > 0) {
      bad('T 【失去基准】三处键集有解析不到的 ⇒ 本组一条都没比：'
        + '\n      ' + unreadable.map((x) => x.label + '：' + x.why).join('\n      ')
        + '\n      ⇒ ⚠ 解析失败**⛔ 不许当成"没问题"**（那会让本组变成恒绿）'
        + '\n      ⇒ 修法：核对 src/config.ts 里这三处的写法是否变了形状（正则要跟着改）')
    } else {
      const fmt = (a) => '{' + a.join(', ') + '}'
      const setOf = (a) => new Set(a)
      const diff = (a, b) => [...setOf(a)].filter((x) => !setOf(b).has(x))
      const ifaceNotCfg = diff(Ki.keys, Kc.keys)
      const cfgNotIface = diff(Kc.keys, Ki.keys)
      const ifaceNotSchema = diff(Ki.keys, Ks.keys)
      const schemaNotCfg = diff(Ks.keys, Kc.keys)

      const problems = []
      if (ifaceNotCfg.length > 0) {
        problems.push('② Config.modules **缺** ' + ifaceNotCfg.length + ' 个键：' + ifaceNotCfg.join(' / ')
          + '\n         ⇒ 接口之间不一致：ModulesConfig 有、而 Config.modules 没有'
          + '\n         ⇒ ⚠ 这正是乙-9 的原病（某些模块开关曾长期缺席）'
          + '\n         ⇒ 修法：在 interface Config 的 modules: 里补上这些键（与 ModulesConfig 同形）')
      }
      if (cfgNotIface.length > 0) {
        problems.push('③ Config.modules **多** ' + cfgNotIface.length + ' 个键：' + cfgNotIface.join(' / ')
          + '\n         ⇒ ModulesConfig 里没有这些 ⇒ 接口之间不一致'
          + '\n         ⇒ 修法：要么补进 ModulesConfig，要么从 Config.modules 删掉')
      }
      if (ifaceNotSchema.length > 0) {
        problems.push('① schema **缺** ' + ifaceNotSchema.length + ' 个键：' + ifaceNotSchema.join(' / ')
          + '\n         ⇒ ModulesConfig 声明了、而 modules: z.object({…}) 里没有'
          + '\n         ⇒ ⚠ 后果：**这个开关在设置页里根本不存在**（配了也不认）'
          + '\n         ⇒ 修法：在 schema 里补 z.boolean().default(…) + .volatile()')
      }
      if (schemaNotCfg.length > 0) {
        problems.push('④ schema **有而 Config.modules 没有** ' + schemaNotCfg.length + ' 个键：' + schemaNotCfg.join(' / ')
          + '\n         ⇒ ⚠ 这就是"两个都少同一个键"那一格：① 与 ② 都成立（因为都少），'
          + '\n           而 **schema 是唯一能配的面** ⇒ 少它意味着"用户配得到、而类型面不承认"'
          + '\n         ⇒ 修法：Config.modules 必须与 schema 对齐')
      }

      if (problems.length === 0) {
        ok('T ✓ **三向键集对账**：schema ' + fmt(Ks.keys) + ' ⊇ ModulesConfig ' + fmt(Ki.keys)
          + ' ⊇ Config.modules ' + fmt(Kc.keys) + '，且**三者完全相同**（' + Ks.keys.length + ' 个键）'
          + ' ⇒ ⛔ 不再是"Config.modules 少两段而运行期一件事都不响"'
          + '（⚠ 键名**不硬编码**：三处全部从源码实测解析，加/删模块时本组自动跟上）')
      } else {
        bad('T **三向键集漂移**（schema ' + Ks.keys.length + ' 个 / ModulesConfig ' + Ki.keys.length + ' 个'
          + ' / Config.modules ' + Kc.keys.length + ' 个）：\n      ' + problems.join('\n      ')
          + '\n      ⇒ 三处实测键集：\n         schema           = ' + fmt(Ks.keys)
          + '\n         ModulesConfig    = ' + fmt(Ki.keys)
          + '\n         Config.modules   = ' + fmt(Kc.keys)
          + '\n      ⇒ ⚠ 这是**双向**判据：少了红、多了也红、两处同少同一个键**同样红**'
          + '\n        （⛔ 不是单向子集检查 —— 那种检查放过"两个都少"这一格）')
      }
    }
  }
}

// ── U. **第 4 向：把「模块登记表」并进三向对账**（2026-10-25 · 本单）──────────
//
// ⚠⚠ 本组守的是哪一格（上一单 REPORT §8-Q2 点名的那个口子）：
//   加一个模块开关要改**三处**：① `src/index.ts` 的 `MODULE_REGISTRY`、
//   ② `src/config.ts` 的 `modules: z.object({…})` schema、③ `src/config.ts` 的
//   `interface ModulesConfig`（⚠ 还有第四处 `interface Config` 的 `modules:` 内联块，已由 T 组守住）。
//   ⚠ 现在**只有①被类型约束着**（上一单加了 `MODULE_LABELS`，它的 key 由登记表派生 ⇒ 漏了编译红）。
//   ⚠ 而 ②③ 与①之间**没有任何约束** ⇒ **只在①加了开关、忘了②** 的后果是：
//     **设置页上根本没有这个开关（用户关不掉它），而编译不报、全部机检也不报。**
//   ⇒ 这一格就是"静默失败"的教科书形态：产物照跑、界面少个旋钮、没人知道。
//
// ── 为什么加在 T 组里面而不是新开 `check:` 命令（作业书 §一-2 明令）──────
//   T 组已经是"三向键集对账"，本组是它的**第 4 向**：同一件事（键集同形）多一个参与者。
//   ⚠ 开一条新命令会让"同名不同义"的两族长期并存（各测一半），那正是上一单 §4.3 说的坏形态。
//
// ── 判据：**双向三条**（作业书 §一-2 逐条对应）──────────────────────────
//   记 K_reg = 登记表里每项的 `key`（⚠ 从 `src/index.ts` 文本实测解析，⛔ 不硬编码键名）。
//   ① K_reg ⊆ K_schema   —— 登记表里的每一项，**schema 里存在**；
//   ② K_reg ⊆ K_iface    —— 登记表里的每一项，**类型接口里存在**；
//   ③ K_schema ⊆ K_reg   —— **反向**：schema 里有的开关，**登记表里也有**
//      （⚠ 防"删了模块却留下一个关不掉的开关"）。
//   ⚠ 三条都在、且**每条单独报**（⛔ 不许合并成一条"键集相等"）：
//     合并后"漏 schema"与"schema 多一项"会印成同一句话，读的人分不出该修哪边。
//   ⚠ 解析不到 ⇒ **落失败**（⛔ 不按通过处理 —— 那是"失去基准"，见 E-112 同族）。
{
  /** ⚠ 与 T 组同一个对拍开关：允许外部塞一份 `src/index.ts` 进来（负向对拍用）。 */
  const U_IDX = process.env.HOB_U_IDX !== undefined && process.env.HOB_U_IDX !== ''
    ? process.env.HOB_U_IDX
    : null
  /** ⚠ 同理，`config.ts` 侧沿用 T 组的 `HOB_T_SRC`（⛔ 不另造第二个开关名）。 */
  const U_CFG = process.env.HOB_T_SRC !== undefined && process.env.HOB_T_SRC !== ''
    ? process.env.HOB_T_SRC
    : null

  const idxPath = U_IDX ?? join(root, 'src', 'index.ts')
  const cfgPath = U_CFG ?? CONFIG_TS

  // ⚠ 复用 T 组的解析器：它们定义在 T 组的块作用域里 ⇒ 这里**重新取一遍**（⛔ 不复制粘贴逻辑）。
  //   实际上 T 组把 `topKeysOf` / `blockAfter` / `ifaceBody` 都放在块内，
  //   这里用同样三小段（⚠ 若哪天要改解析口径，两处必须同批改 —— 已在下面 ok() 里点名）。
  const topKeysOfU = (blockBody) => {
    const keys = []
    let depth = 0
    let segStart = 0
    const segs = []
    for (let i = 0; i < blockBody.length; i++) {
      const ch = blockBody[i]
      if (ch === '(' || ch === '{' || ch === '[') depth++
      else if (ch === ')' || ch === '}' || ch === ']') depth--
      else if (ch === '\n' && depth === 0) { segs.push(blockBody.slice(segStart, i)); segStart = i + 1 }
    }
    segs.push(blockBody.slice(segStart))
    for (const seg of segs) {
      const stripped = seg.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
      const m = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(stripped)
      if (m !== null) keys.push(m[1])
    }
    return keys
  }
  const blockAfterU = (src, startIdx) => {
    const open = src.indexOf('{', startIdx)
    if (open < 0) return null
    let depth = 0
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open + 1, i) }
    }
    return null
  }
  const ifaceBodyU = (src, nameRe) => {
    const m = nameRe.exec(src)
    return m === null ? null : blockAfterU(src, m.index)
  }

  let uIdxSrc = null
  let uCfgSrc = null
  try { uIdxSrc = readFileSync(idxPath, 'utf8') } catch (e) {
    bad('U 【失去基准】读不到 src/index.ts（' + String(e?.message ?? e) + '）⇒ 第 4 向对账无法进行（不按通过处理）')
  }
  try { uCfgSrc = readFileSync(cfgPath, 'utf8') } catch (e) {
    bad('U 【失去基准】读不到 src/config.ts（' + String(e?.message ?? e) + '）⇒ 第 4 向对账无法进行（不按通过处理）')
  }

  if (uIdxSrc !== null && uCfgSrc !== null) {
    /**
     * ⚠ **登记表的键**：只认 `MODULE_REGISTRY = [ … ] as const` 这一段里的 `key: '<k>'`。
     *   ⚠ 先切段再抽 key —— 否则**模块内其它地方**的 `key:`（如 `[...].map(x => x.key)`）
     *     会被误当成登记表条目（那会造出不存在的"开关"⇒ 假红）。
     *   ⚠ 切不到段 ⇒ 落失败（⛔ 不退回"从整个文件抽"—— 那会静默换个更大的面）。
     */
    const regStartM = /const\s+MODULE_REGISTRY\s*=\s*\[/.exec(uIdxSrc)
    /**
     * ⚠⚠ **数组要按 `[]` 配对取，不能复用 `blockAfterU`**（那个按 `{}` 配对）——
     *   实测踩到的坑：登记表的元素本身是 `{ … }` 对象字面量 ⇒ 用 `{}` 配对会在
     *   **第一个元素收尾处**就"配对成功" ⇒ 只解析出 **1 个 key**（`{tools}`），
     *   然后 U③ 会把另外 3 个开关全报成"schema 有、登记表没有"= **整片假红**。
     *   ⇒ 这里用一份**只数 `[]`** 的配对器（⚠ 内部 `{}` 不参与，因为它们不改变 `[]` 深度）。
     */
    const arrayAfter = (src, openIdx) => {
      if (openIdx < 0 || src[openIdx] !== '[') return null
      let depth = 0
      for (let i = openIdx; i < src.length; i++) {
        if (src[i] === '[') depth++
        else if (src[i] === ']') { depth--; if (depth === 0) return src.slice(openIdx + 1, i) }
      }
      return null
    }
    const regKeys = (() => {
      if (regStartM === null) return { keys: null, why: '找不到 `const MODULE_REGISTRY = [`' }
      const body = arrayAfter(uIdxSrc, uIdxSrc.indexOf('[', regStartM.index))
      if (body === null) return { keys: null, why: '登记表 `[` 之后找不到配对的 `]`' }
      const keys = [...body.matchAll(/\bkey:\s*'([A-Za-z_$][\w$]*)'/g)].map((m) => m[1])
      // 去重但保持原序（⚠ 重复 key 本身是另一个缺陷，这里不判它，只去重以免假红）
      return { keys: [...new Set(keys)], why: keys.length === 0 ? '登记表里抽到 0 个 key' : '' }
    })()

    const schemaKeys = (() => {
      const m = /modules\s*:\s*z\s*\.\s*object\s*\(/.exec(uCfgSrc)
      if (m === null) return { keys: null, why: '找不到 modules: z.object(' }
      const body = blockAfterU(uCfgSrc, m.index)
      if (body === null) return { keys: null, why: '找不到配对的 {} 块' }
      const keys = topKeysOfU(body)
      return { keys, why: keys.length === 0 ? '解析出 0 个键' : '' }
    })()
    const ifaceKeys = (() => {
      const body = ifaceBodyU(uCfgSrc, /export\s+interface\s+ModulesConfig\b/)
      if (body === null) return { keys: null, why: '找不到 interface ModulesConfig' }
      const keys = topKeysOfU(body)
      return { keys, why: keys.length === 0 ? '解析出 0 个键' : '' }
    })()

    const unreadableU = [regKeys, schemaKeys, ifaceKeys].filter((x) => x.keys === null || x.keys.length === 0)
    if (unreadableU.length > 0) {
      bad('U 【失去基准】第 4 向的键集有解析不到的 ⇒ 本组一条都没比：'
        + '\n      ' + [['登记表', regKeys], ['schema', schemaKeys], ['ModulesConfig', ifaceKeys]]
          .filter(([, v]) => v.keys === null || v.keys.length === 0)
          .map(([n, v]) => n + '：' + v.why).join('\n      ')
        + '\n      ⇒ ⚠ 解析失败**⛔ 不许当成"没问题"**（那会让本组变成恒绿）')
    } else {
      const fmt = (a) => '{' + a.join(', ') + '}'
      const setOf = (a) => new Set(a)
      const diff = (a, b) => [...setOf(a)].filter((x) => !setOf(b).has(x))
      const regNotSchema = diff(regKeys.keys, schemaKeys.keys)   // ①
      const regNotIface = diff(regKeys.keys, ifaceKeys.keys)     // ②
      const schemaNotReg = diff(schemaKeys.keys, regKeys.keys)   // ③

      /**
       * ⚠⚠ **三条各自独立成一条断言**（⛔ 不合并成一条"键集相等"）。
       *   两个理由：
       *     ① **读的人要能分**：合并后"漏 schema"与"schema 多一项"会印成同一句 ⇒ 不知道该往哪边修；
       *     ② **处数要能数**：本仓的处级口径按"逐条断言"计 ⇒ 合并会让"三条判据"在
       *        分母上只剩 1 处，将来有人删掉其中一条**下界也不会动**（静默缩水）。
       *   ⇒ 每条都 `ok()` 或 `bad()` **恰好一次**，⛔ 不许有的分支不落任何一条。
       */
      if (regNotSchema.length > 0) {
        bad('U① 登记表 **有、schema 没有** ' + regNotSchema.length + ' 个开关：' + regNotSchema.join(' / ')
          + '\n         ⇒ ⚠ **后果：这个开关在设置页上根本不存在，用户关不掉它**，而编译与其余机检都不报'
          + '\n         ⇒ 修法：在 `src/config.ts` 的 `modules: z.object({…})` 里补一整段'
          + '（`<key>: z.boolean().default(<bool>).description(…).volatile()`）')
      } else {
        ok('U① ✓ 登记表 ⊆ schema：' + fmt(regKeys.keys) + ' 全部在 schema 里（' + regKeys.keys.length + ' 个）'
          + ' ⇒ ⛔ 不会出现"只在登记表加了开关、忘了 schema ⇒ 设置页少个旋钮而无人报"')
      }
      if (regNotIface.length > 0) {
        bad('U② 登记表 **有、ModulesConfig 没有** ' + regNotIface.length + ' 个开关：' + regNotIface.join(' / ')
          + '\n         ⇒ ⚠ 后果：类型面不承认这个开关（`Volatile<boolean>` 缺席）⇒'
          + '           `moduleSwitches()` 读得到、而类型声明里没有 ⇒ 下次有人照类型写就读不到它'
          + '\n         ⇒ 修法：在 `interface ModulesConfig` 里补 `<key>: Volatile<boolean>`'
          + '（⚠ 与 schema 同档：schema 标了 `.volatile()` 的，这里必须写 `Volatile<boolean>`）')
      } else {
        ok('U② ✓ 登记表 ⊆ ModulesConfig：' + fmt(regKeys.keys) + ' 全部在类型接口里（' + regKeys.keys.length + ' 个）')
      }
      if (schemaNotReg.length > 0) {
        bad('U③ schema **有、登记表没有** ' + schemaNotReg.length + ' 个开关：' + schemaNotReg.join(' / ')
          + '\n         ⇒ ⚠ 这就是"删了模块却留下一个关不掉的开关"那一格：'
          + '设置页上有个旋钮，拨它没有任何效果（没有任何模块读这个 key）'
          + '\n         ⇒ 修法：要么把模块加回 `MODULE_REGISTRY`，要么从 schema 里删掉这个开关'
          + '（⚠ ⛔ 不许"两边都不动、让它躺着"）')
      } else {
        ok('U③ ✓ schema ⊆ 登记表：' + fmt(schemaKeys.keys) + ' 每一个都能在登记表里找到对应模块（'
          + schemaKeys.keys.length + ' 个）⇒ ⛔ 没有"拨了没效果"的残留旋钮')
      }
      /** ⚠ 只有三条全绿才印这条总账（它不占处数，只做一眼可见的确认）。 */
      if (regNotSchema.length === 0 && regNotIface.length === 0 && schemaNotReg.length === 0) {
        ok('U ✓ **第 4 向三向同形**：登记表 ' + fmt(regKeys.keys) + ' === schema ' + fmt(schemaKeys.keys)
          + ' === ModulesConfig ' + fmt(ifaceKeys.keys) + '（' + regKeys.keys.length + ' 个开关，双向成立）'
          + '（⚠ 键名**不硬编码**：三处全部从源码实测解析，加/删模块时本组自动跟上）')
      } else {
        bad('U **第 4 向漂移**（登记表 ' + regKeys.keys.length + ' 个 / schema ' + schemaKeys.keys.length
          + ' 个 / ModulesConfig ' + ifaceKeys.keys.length + ' 个）'
          + '\n      实测键集：\n         登记表        = ' + fmt(regKeys.keys)
          + '\n         schema        = ' + fmt(schemaKeys.keys)
          + '\n         ModulesConfig = ' + fmt(ifaceKeys.keys)
          + '\n      ⇒ ⚠ 上面 U①/U②/U③ 已逐条点名"哪个开关、缺在哪处" ⇒ 按那三行修，⛔ 别只看这一行')
      }
    }
  }
}

// ── 输出 ────────────────────────────────────────────────────────────────
console.log('配置面一致性核对 · dsh-hob（schema ↔ cordis.patch.yml ↔ 设置面板）')
console.log('schema :', CONFIG_TS)
console.log('patch  :', PATCH)
console.log('panel  :', PANEL)
console.log('')
for (const n of note) console.log('  ✓', n)
for (const k of skip) console.log('  ·', k)
console.log('')
console.log(`  处级口径：查了 ${note.length + fail.length + skip.length} 处 · 过了 ${note.length} 处`
    + (fail.length > 0 ? ` · 没过 ${fail.length} 处` : '')
  + ` · **跳过 ${skip.length} 处**（⚠ 跳过**不计入通过**）`)
console.log('')
console.log('')
if (fail.length === 0) {
  console.log('判定：PASS —— 形状、一一对应、解 ref 收口、面板文案、写入路径 全部通过。')
  process.exit(0)
}
console.log('判定：FAIL')
for (const f of fail) console.log('  ✗', f)
process.exit(1)
