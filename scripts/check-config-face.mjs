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
const root = join(here, '..')
const CONFIG_TS = join(root, 'src', 'config.ts')
const PATCH = join(root, 'cordis.patch.yml')
const PANEL = join(root, 'src', 'client', 'settings-panel.tsx')
const SETTINGS_CLIENT = join(root, 'src', 'client', 'settings.ts')

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
  //     ⚠ **为什么要改**：⚠ 本轮给面板加了第六个开关（`interconnect`）⇒
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

    // ── G-3 第 3 处 · 面板控件 ───────────────────────────────────────────
    {
      if (!/WORK_MODE_ORDER\.map\(/.test(panelSrc)) {
        bad('G-3 面板里找不到 `WORK_MODE_ORDER.map(…)` —— 「工作方式」没有控件（三处只剩两处 ⇒ 有键无功能）')
      } else ok('G-3 面板控件经 `WORK_MODE_ORDER.map(…)` 渲染（顺序派生，⛔ 无手写清单）')

      const mDisplay = /export\s+const\s+WORK_MODE_DISPLAY[^=]*=\s*\{([\s\S]*?)\n\}/.exec(sharedSrc)
      const displayPairs = mDisplay === null
        ? []
        : [...mDisplay[1].matchAll(/(\w+)\s*:\s*'([^']*)'/g)].map((x) => ({ key: x[1], label: x[2] }))
      if (displayPairs.length !== 3) {
        bad(`G-3 从 \`WORK_MODE_DISPLAY\` 抽到 ${displayPairs.length} 个显示名（应 3 个）⇒ 本组失去基准（不按通过处理）`)
      }
      for (const dict of ['PANEL_ZH', 'PANEL_EN']) {
        const block = dictBlock(dict)
        if (block === null) { bad(`G-3 抽不出面板词典 ${dict} ⇒ 显示名无从核对（不按通过处理）`); continue }
        const missing = values.filter((v) => !new RegExp(`'wm\\.mode\\.${v}'\\s*:`).test(block))
        if (missing.length > 0) {
          bad(`G-3 ${dict} 缺这些档位的显示名：${missing.map((v) => `wm.mode.${v}`).join(', ')}`
            + ' —— 缺一个就会在界面上**显示键名**（等于把这个档藏起来）')
        }
      }
      const zhBlock = dictBlock('PANEL_ZH')
      if (zhBlock === null) {
        bad('G-3 抽不出 `PANEL_ZH` ⇒ 显示名同源无从核对（不按通过处理）')
      } else {
        const mismatched = []
        for (const { key, label } of displayPairs) {
          const hit = new RegExp(`'wm\\.mode\\.${key}'\\s*:\\s*'([^']*)'`).exec(zhBlock)
          if (hit !== null && hit[1] !== label) mismatched.push(`${key}：来源「${label}」/ 面板「${hit[1]}」`)
        }
        if (mismatched.length > 0) {
          bad(`G-3 面板中文显示名与 \`WORK_MODE_DISPLAY\` **不是同一套说法**：${mismatched.join('；')}`
            + ' —— 显示名只有一个来源，两处各写一份必然漂')
        } else ok(`G-3 三档显示名与来源逐字同源（${displayPairs.map((p) => p.label).join(' / ')}）`)
      }
      //   ⚠ 对称的一半：**英文**词典必须与 `WORK_MODE_LABEL_EN` 逐字相等（⛔ 两套英文）。
      //     判据同源理由与中文那条一样；缺了它，模型面的英文名与面板英文名可以各说一套。
      {
        const enBlock = dictBlock('PANEL_EN')
        const mLabel = /export\s+const\s+WORK_MODE_LABEL_EN[^=]*=\s*\{([\s\S]*?)\n\}/.exec(sharedSrc)
        const enPairs = mLabel === null
          ? []
          : [...mLabel[1].matchAll(/(\w+)\s*:\s*'([^']*)'/g)].map((x) => ({ key: x[1], label: x[2] }))
        if (enBlock === null) {
          bad('G-3 抽不出 `PANEL_EN` ⇒ 英文显示名同源无从核对（不按通过处理）')
        } else if (enPairs.length !== 3) {
          bad(`G-3 从 \`WORK_MODE_LABEL_EN\` 抽到 ${enPairs.length} 个英文名（应 3 个）⇒ 基准缺失（不按通过处理）`)
        } else {
          const missEn = []
          for (const { key, label } of enPairs) {
            const hit = new RegExp(`'wm\\.mode\\.${key}'\\s*:\\s*'([^']*)'`).exec(enBlock)
            if (hit === null || hit[1] !== label) missEn.push(`${key}（来源「${label}」/ 面板「${hit?.[1] ?? '缺'}」）`)
          }
          if (missEn.length > 0) {
            bad(`G-3 面板英文显示名与 \`WORK_MODE_LABEL_EN\` 不一致：${missEn.join('；')}`
              + ' —— 模型面的英文名与面板英文名必须同一套')
          } else ok(`G-3 面板英文显示名与来源逐字同源（${enPairs.map((p) => p.label).join(' / ')}）`)
        }
      }
    }

    // ── G-4 真实消费者（本组最重要的一条）──────────────────────────────
    {
      const consumers = [
        { label: 'host 收口函数 `workMode()`', src: cfgSrc, needle: 'export function workMode(' },
        { label: '入口 provide 现读服务', src: hostEntrySrc, needle: 'ctx.provide(WORK_MODE_SERVICE, () => workMode(config))' },
        { label: '预设作用域挂载注入', src: presetToolsSrc, needle: 'injectWorkMode(ctx, modeOf, log)' },
        { label: '两条通路共用的现拼正文 `textNow()`', src: presetToolsSrc, needle: 'workModeInstruction(modeOf()) + workModeRedLine()' },
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
        const isFn = /const\s+textNow\s*=\s*\(\s*\)\s*:\s*string\s*=>/.test(fnBody)
        const sectionRef = /section\(\{[\s\S]{0,600}?text:\s*textNow,/.test(fnBody)
        const contextRef = /context\(\{[\s\S]{0,600}?text:\s*textNow,/.test(fnBody)
        if (!isFn) {
          bad('G-4 注入正文不是**函数**（找不到 `const textNow = (): string =>`）'
            + '\n      ⇒ 若是常量字符串，档位改了**已开会话仍按旧档**走到重挂载为止 ——'
            + '\n        那正是"设置页改了但行为没变"的静默失败')
        } else if (!sectionRef || !contextRef) {
          bad(`G-4 两条通路没有**共用**同一个现拼函数（section=${sectionRef} · context=${contextRef}）`
            + '\n      ⇒ 各拼一份的话，改一处必然漏一处（"+1 处口径"的分裂）')
        } else ok('G-4 正文由 `textNow()` 函数现拼，且 section / context 两条通路共用（⛔ 非常量）')
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

            //   ⚠ 缺省档**必须**含"动手前先报一句"（任务书 §二-③ 的 (甲) 口径）。
            //     ⛔ (乙) 是产品取向、留待用户裁定 —— 这条判据把 (甲) 钉住，⛔ 不许被悄悄改成 (乙)。
            if (!texts[defaultMode].includes('say in one line how many tracks')) {
              bad(`G-4 缺省档（${defaultMode}）缺「先报一句要拆成几份」`
                + '\n      ⇒ 本单按 §二-③ 的 (甲) 实现（只自动选路，动手前仍先报一句）；'
                + '\n        ⛔ (乙)「选路 + 派活都自动」属产品取向、留待用户裁定，⛔ 不许自行升格')
            } else ok(`G-4 缺省档明写"动手前先报一句"（§二-③ 的 (甲) 口径被钉住）`)
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
      const redStart = (sharedSrc ?? '').indexOf('export function workModeRedLine(')
      const redBody = redStart < 0 ? '' : (sharedSrc ?? '').slice(redStart)
      const missModel = RED_ANCHORS.filter((a) => !redBody.includes(a))
      if (missModel.length > 0) {
        bad(`G-6 给模型看的口径里缺红线关键限定：${missModel.join(', ')}`
          + ' —— 红线是任务书 §二-② 写死的一条，⛔ 不许被裁掉或改写成更弱的说法')
      } else ok('G-6 给模型看的口径含红线全部关键限定（不解除 / 看板 / 别人的卡 / 判据）')

      const zhBlock = dictBlock('PANEL_ZH')
      if (zhBlock === null) {
        bad('G-6 抽不出 `PANEL_ZH` ⇒ 界面上的红线条无从核对（不按通过处理）')
      } else {
        const missPanel = ['看板', '别人项目的卡', '判据', '权限'].filter((a) => !zhBlock.includes(a))
        if (missPanel.length > 0) {
          bad(`G-6 界面上的红线条缺关键限定：${missPanel.join(', ')}`
            + ' —— 用户看不到就等于没有（本项名字自带"更多更强"的暗示，界面必须挡住那个误读）')
        } else ok('G-6 界面上有红线条（看板 / 别人项目的卡 / 判据 / 权限 四个限定都在）')
      }

      const descBlock = (() => {
        const start = cfgSrc.indexOf('workMode: z.object({')
        if (start < 0) return ''
        const at = cfgSrc.indexOf('}).default({})', start)
        return at < 0 ? '' : cfgSrc.slice(start, at)
      })()
      const SCHEMA_ANCHORS = ['不解除任何既有红线', '不改看板', '不碰别人项目的卡', '不放宽任何判据']
      const missSchema = SCHEMA_ANCHORS.filter((a) => !descBlock.includes(a))
      if (missSchema.length > 0) {
        bad(`G-6 schema 的 \`.description()\` 缺红线关键限定：${missSchema.join(', ')}`
          + '\n      ⇒ 插件管理页的自动表单只读这份 description；它缺了，红线在自动表单里就不存在')
      } else ok('G-6 schema 的 `.description()` 含红线原文（自动表单里也在场）')
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
        const PERSONA_TEXT = 'You are the translation layer between the user and the developer session.\n'
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
              if (k === 'hobPermission') return () => 'ledger'
              if (k === 'hobWorkMode') return () => mode
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

// ── 输出 ────────────────────────────────────────────────────────────────
console.log('配置面一致性核对 · dsh-hob（schema ↔ cordis.patch.yml ↔ 设置面板）')
console.log('schema :', CONFIG_TS)
console.log('patch  :', PATCH)
console.log('panel  :', PANEL)
console.log('')
for (const n of note) console.log('  ✓', n)
console.log('')
if (fail.length === 0) {
  console.log('判定：PASS —— 形状、一一对应、解 ref 收口、面板文案、写入路径 全部通过。')
  process.exit(0)
}
console.log('判定：FAIL')
for (const f of fail) console.log('  ✗', f)
process.exit(1)
