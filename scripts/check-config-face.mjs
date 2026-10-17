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
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const CONFIG_TS = join(root, 'src', 'config.ts')
const PATCH = join(root, 'cordis.patch.yml')
const PANEL = join(root, 'src', 'client', 'settings-panel.tsx')
const SETTINGS_CLIENT = join(root, 'src', 'client', 'settings.ts')

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
