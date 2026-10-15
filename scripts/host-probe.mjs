/**
 * host-probe —— 用**真产物** `lib/index.js` 跑 host 半边的探针。
 *
 * ⚠ **必须在 `build` 之后跑**：本脚本 import 的是**构建产物**（`lib/`），不是 `src/`。
 *   `lib/` 不存在时**可读地报告并 exit 2**（不裸抛 —— 见下方"为什么未 build 要单独一档退出码"）。
 *
 *       npm run check:host          # 期望退出码 0（全部 PASS）
 *
 * ⚠ **何时该跑**：`Config` 的 schema（尤其 `modules.*` 的形态与**默认值**）或
 *   `apply()` 的模块登记行为变更时。⚠ 自 2026-10-11（第 49 轮）起它**已登记进
 *   `package.json` 的 `probe:host`**，并纳入收尾必跑（见 `.hob/README.md` §6.1 与 `PROJECT.md` §10.2）；
 *   此前它**不在任何自动路径上** ⇒ 5 条期望过期后**长期无人发现**（**E-122** 形态：机制在，没人跑）。
 *
 * ── 为什么退出码分三档（0 / 1 / 2）──────────────────────────────────────
 *   · **0** = 全 PASS；
 *   · **1** = 有断言 FAIL（**真缺陷或期望又过期了** ⇒ 必须有人看）；
 *   · **2** = **探针自己跑不起来**（`lib/` 不存在 / import 抛错）——
 *     ⚠ 这与"断言失败"**是两回事**：前者说明**没测到**，后者说明**测到了且不对**。
 *     同口径见 `PROJECT.md` 的 **R-10**（"静默 skipped ⇒ **exit 2，不是成功**"）：
 *     **"没跑起来"绝不能长得像"跑过且通过"**。
 *     ⇒ 与 `check:*` 的 0/1 约定**有意不同**：那些是纯文本/直载 `.ts` 的检查，
 *       不需要先 build；本脚本**依赖产物**，故多这一档。
 *
 * ⚠ **为什么每条断言各自 try/catch**（E-27 教训）：
 *   本脚本曾因第 1 条 FAIL 后、第 2 条在**构造实参**时抛异常（`cfgDefault.persona?.get()` 在
 *   `undefined` 上取 `.get`；`?.` 只护变量、不护方法）而**整体中断** —— 8 条只跑到 1 条、
 *   后 7 条从未执行 ⇒ 观测器反而成了盲区。现在每条断言独立捕获：
 *   **任何一条失败都不得阻止后续各条运行**，且每条都**必须能失败**（E-27：不许恒真）。
 *
 * ══ 断言口径的实测出处（2026-10-11 第 49 轮 · 用**真产物** `lib/index.js` 复测，非推断）══
 *   ⚠ 本轮**逐条重测并改正了 5 条过期期望**（清单见回报 §3）：它们停在 v4 时期
 *     （"两个预设 / `bus` 是布尔 false"那版），与现状脱节。**以下为现状真值**：
 *   · `Config(undefined).modules` === `{tools:{}, preset:{}, bus:{}, orch:{}, settings:{}}`
 *     ⇒ **五个子字段全是 volatile ref**（默认形态为 `{}`，须 `.get()` 取布尔）。
 *       ⚠ 沿革：`bus` **原是普通布尔**（v1–v4 刻意隐藏，UD-25）；**批 14 / M3 起改为 ref**
 *          —— 它真管用了，于是与其余四个同形（见 `src/config.ts` 该字段注释）。
 *   · 默认值（`.get()`）实测：`tools=true` · `preset=false` · `bus=true` · `orch=false` · `settings=true`。
 *       ⚠ `orch` 缺省 **false**（M5 会在无人看管时推进 ⇒ 宁可不开）；`bus` 缺省 **true**。
 *   · `modules` **本身不是 ref**（`typeof modules.get === 'undefined'`）—— 父对象不标 volatile，
 *     只有子字段各标（`src/config.ts` 的"方案 D"形状）。
 *   · `Config(undefined)` 的顶层键 === `['modules', 'spawn', 'permission']`
 *       —— ⚠ `spawn` 段自 2026-10-09 加入后成为第二个顶层键（本条期望**原先只列 modules**，已过期）；
 *         `permission`（权限档位）自 2026-10-14 第 144 轮加入，成为**第三**键。
 *   · 未知键（profile 旧配置段）被原样保留在**顶层**（`role` / `deliveryMode` / `autoSend` /
 *     `workspaceRoot` …），**不并入 `modules`** ⇒ `modules` 形状不受污染。
 *   · 默认配置 `apply` ⇒ 登记 `dsh-hob-tools` + `dsh-hob-bus` + `dsh-hob-settings`，
 *     日志「模块：tools, bus, settings」。
 *       ⚠ 本条期望**原先写 tools + settings 两条**（已过期）—— `bus` 缺省 true 且真管用，
 *         故它本来就在默认登记里。
 *   · `modules:{tools:false}` ⇒ 登记 `dsh-hob-bus` + `dsh-hob-settings`，
 *     日志「模块：bus, settings」。⚠ 同理（原期望写"只剩 settings"）。
 *   · 五个开关**全关** ⇒ 登记 0 个，日志「模块：无」。
 *   · **每个开关单独关** ⇒ 只少它自己那一个模块（其余四个照常）——
 *     这正是「模块可独立启停」这条架构性质的**逐开关实测**（本项为本轮新增，覆盖 v5 全五模块）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ⚠ **不硬编码绝对路径**（旧版写死 `/home/lk/FF/dsh-hob/lib/index.js` ⇒ clone 到别处即崩）：
//   按**本脚本自身位置**推仓库根 ⇒ 与 `scripts/check-*.mjs` 同一口径（可移植性 UD-73③）。
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const ENTRY = join(root, 'lib', 'index.js')

if (!existsSync(ENTRY)) {
  console.log(`未构建：找不到产物 ${ENTRY}\n`
    + '  ⇒ 先跑 `npm run build`（本探针用的是**真产物** `lib/`，不是 `src/`）。\n'
    + '  ⇒ 本次**未测到任何东西**（不是通过）—— 退出码 2 与"断言失败(1)"有意区分。')
  process.exit(2)
}

let mod
try {
  mod = await import(ENTRY)
} catch (e) {
  console.log(`产物加载失败：${ENTRY}\n  ${String(e?.message ?? e)}\n`
    + '  ⇒ 产物存在但 import 抛错（多半是构建未完成 / 半截产物）⇒ **未测到任何东西**，退出码 2。')
  process.exit(2)
}

let fail = 0
/**
 * 跑一条断言。`fn` 返回 `true` 表示通过；返回**字符串**表示失败并附原因；
 * 抛异常也算失败（附异常信息）。**任何情况都不中断后续断言。**
 */
function check(name, fn) {
  let ok = false
  let extra = ''
  try {
    const r = fn()
    if (r === true) {
      ok = true
    } else if (r === false || r === undefined) {
      ok = false
      extra = '返回非 true（断言未给出原因）'
    } else {
      ok = false
      extra = String(r)
    }
  } catch (e) {
    ok = false
    extra = '抛异常：' + String(e?.message ?? e)
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
  if (!ok) fail++
}

/** 造一份最小 fakeCtx（与 module-independence-probe.mjs 同款），返回登记到的插件名与 info 日志。 */
function fakeCtx() {
  const plugins = []
  const provided = new Map()
  const logs = []
  const ctx = {
    logger: { info: (m) => logs.push(String(m)), debug: () => {}, warn: () => {} },
    plugin: (p) => { plugins.push(p.name ?? '(anon)'); return { then() {} } },
    effect: (fn) => { const d = fn(); return { dispose: () => d?.() } },
    // ⚠ 第 144 轮新增：入口用 `ctx.provide` 挂「权限档位现读服务」
    //   （`hobPermission`）。假 ctx 必须跟着长这个方法，否则 apply 直接抛
    //   `ctx.provide is not a function` —— 那是**夹具缺能力**，不是实现错。
    provide: (name, value) => { provided.set(name, value); return { dispose: () => provided.delete(name) } },
    get: (name) => provided.get(name),
  }
  return { ctx, plugins, logs, provided }
}

/** 五个模块开关的 key（**唯一权威 = `src/config.ts` 的 `modules` schema**；此处只列名，不写默认值）。 */
const SWITCH_KEYS = ['tools', 'preset', 'bus', 'orch', 'settings']

/** key → 该模块的 `name` 常量（登记时出现在 `plugins` 里的名字）。 */
const MODULE_NAMES = {
  tools: 'dsh-hob-tools',
  preset: 'dsh-hob-preset',
  bus: 'dsh-hob-bus',
  orch: 'dsh-hob-orchestrator',
  settings: 'dsh-hob-settings',
}

/** 实测默认值（volatile ⇒ 取 `.get()` 才是真值）。 */
const DEFAULT_SWITCH_VALUES = { tools: true, preset: false, bus: true, orch: false, settings: true }

/** 实测的默认 modules 形状（多处引用，收口成常量）。 */
const DEFAULT_MODULES_JSON = '{"tools":{},"preset":{},"bus":{},"orch":{},"settings":{}}'

// ── 1) 默认配置：modules 的形状（五子字段全 ref）──────────────────────────
check('schema 校验：undefined → modules 形状 = {tools:{}, preset:{}, bus:{}, orch:{}, settings:{}}', () => {
  const got = JSON.stringify(mod.Config(undefined).modules)
  return got === DEFAULT_MODULES_JSON ? true : `got=${got} want=${DEFAULT_MODULES_JSON}`
})

// ── 2) 五个开关都是 volatile ref（须 .get()），默认值实测 ─────────────────
check('schema 校验：五个开关都是 volatile ref（{} 且 .get() 返回布尔）且默认值与实测一致', () => {
  const c = mod.Config(undefined)
  const shape = {}
  const bad = []
  for (const k of SWITCH_KEYS) {
    const v = c.modules[k]
    const isRef = v !== null && typeof v === 'object' && typeof v.get === 'function'
    shape[k] = `${isRef ? 'ref' : 'NOT-ref'}:${isRef ? JSON.stringify(v.get()) : '?'}`
    if (!isRef) bad.push(`${k} 不是 ref`)
    else if (v.get() !== DEFAULT_SWITCH_VALUES[k]) bad.push(`${k} 默认值 ${JSON.stringify(v.get())} ≠ ${JSON.stringify(DEFAULT_SWITCH_VALUES[k])}`)
  }
  return bad.length === 0 ? true : `${bad.join('；')}（形状：${JSON.stringify(shape)}）`
})

// ── 3) modules 父对象本身**不是** ref（方案 D 形状：父不标、子各标）────────
check('schema 校验：modules 父对象本身不是 ref（只有子字段各标 volatile）', () => {
  const m = mod.Config(undefined).modules
  if (m === null || typeof m !== 'object') return `modules 不是对象：${typeof m}`
  if (typeof m.get === 'function') return 'modules 竟带有 .get（父子同标会抛 ValidationError，与实测相反）'
  return true
})

// ── 4) 顶层键恰好 modules + spawn；未知键原样保留在顶层、不污染 modules ──
check('schema 兼容：未知键（profile 旧配置段）原样保留在顶层，且 modules 形状不受污染', () => {
  const c = mod.Config({ role: 'execution', deliveryMode: 'execute', autoSend: false, workspaceRoot: '' })
  const kept = { role: c.role, deliveryMode: c.deliveryMode, autoSend: c.autoSend, workspaceRoot: c.workspaceRoot }
  if (!(kept.role === 'execution' && kept.deliveryMode === 'execute' && kept.autoSend === false && kept.workspaceRoot === ''))
    return `未知键未原样保留：${JSON.stringify(kept)}`
  const got = JSON.stringify(c.modules)
  if (got !== DEFAULT_MODULES_JSON) return `modules 被污染：${got}`
  return true
})

// ── 5) 默认顶层键（⚠ **派生**，⛔ 不手抄一张会过期的表）───────────────────────
//   ⚠ ⚠ **本判据原来手抄了一份 `['modules','spawn','permission']`**（2026-10-16 第 224 轮之前），
//     结果本轮**新增 `skeleton` 顶层组**时它当场 FAIL —— ⚠ 那正是 **E-117** 的形态
//     （清单会过期，过期后要么假红、要么被人顺手改宽）。
//   ⇒ 与 `check-config-face.mjs` 的 `schemaTopGroups()` **同口径**：⚠ **从 `src/config.ts`
//     抽**顶层 `z.object(` 组名 ⇒ ⚠ 新增一个组时它**自动纳入**，⛔ 不必回来改本文件。
//   ⚠ 抽不到 ⇒ **FAIL**（⛔ 基准读不到不按通过处理 —— 与 `check-config-face` 同一条纪律）。
const CONFIG_TS = join(root, 'src', 'config.ts')
const DEFAULT_TOP_KEYS = (() => {
  let src = ''
  try { src = readFileSync(CONFIG_TS, 'utf8') } catch { return [] }
  const out = []
  for (const line of src.split('\n')) {
    const m = /^ {2}([A-Za-z0-9_]+): z\.object\(/.exec(line)
    if (m !== null) out.push(m[1])
  }
  return out
})()

check('schema 校验：`src/config.ts` 里抽得出顶层 `z.object` 组（⛔ 手抄表已删）', () => {
  return DEFAULT_TOP_KEYS.length > 0 ? true : `抽到 0 个顶层组（基准读不到 ⇒ 不按通过处理）`
})

check(`schema 校验：Config(undefined) 的顶层键 === 从 \`src/config.ts\` 抽出的顶层组 ${JSON.stringify(DEFAULT_TOP_KEYS)}（⚠ 派生，⛔ 不手抄）`, () => {
  const got = Object.keys(mod.Config(undefined))
  return JSON.stringify(got) === JSON.stringify(DEFAULT_TOP_KEYS) ? true : `got=${JSON.stringify(got)}`
})

// ── 6) apply 默认配置：登记 tools + bus + settings（且不抛错）─────────────
check("apply：默认配置 ⇒ 登记 tools + bus + settings，日志含「模块：tools, bus, settings」", () => {
  const { ctx, plugins, logs } = fakeCtx()
  mod.apply(ctx, mod.Config(undefined))
  const want = ['dsh-hob-tools', 'dsh-hob-bus', 'dsh-hob-settings']
  if (JSON.stringify(plugins) !== JSON.stringify(want)) return `plugins=${JSON.stringify(plugins)} want=${JSON.stringify(want)}`
  if (!logs.some((m) => m.includes('模块：tools, bus, settings'))) return `logs=${JSON.stringify(logs)}`
  return true
})

// ── 7) 模块可独立启停：**逐个**单独关 ⇒ 只少它自己 ────────────────────────
//   ⚠ 本轮把原来"只测 tools=false 一条"扩成**五个开关逐个实测** ——
//     因为它守的是"**模块可独立启停**"这条架构性质，而单测一个开关证明不了其余四个。
check('apply：五个开关**逐个**单独关 ⇒ 只少该模块自己，其余四个照常登记（模块可独立启停）', () => {
  const problems = []
  for (const off of SWITCH_KEYS) {
    const m = {}
    for (const k of SWITCH_KEYS) m[k] = true
    m[off] = false
    const { ctx, plugins, logs } = fakeCtx()
    mod.apply(ctx, mod.Config({ modules: m }))
    const want = SWITCH_KEYS.filter((k) => k !== off).map((k) => MODULE_NAMES[k]).sort()
    const got = [...plugins].sort()
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      problems.push(`关 ${off} ⇒ 登记 ${JSON.stringify(plugins)}（期望 ${JSON.stringify(want)}）`)
    }
    // 日志里的模块清单也必须**不含**被关掉的那个 key
    if (logs.some((l) => l.includes(`模块：`) && new RegExp(`\\b${off}\\b`).test(l.split('模块：')[1] ?? ''))) {
      problems.push(`关 ${off} ⇒ 日志仍含 ${off}：${JSON.stringify(logs)}`)
    }
  }
  return problems.length === 0 ? true : problems.join('；')
})

// ── 8) 五开关全关 ⇒ 不登记任何模块 ───────────────────────────────────────
check('apply：五个开关全关 ⇒ 不登记任何子模块（日志「模块：无」）', () => {
  const { ctx, plugins, logs } = fakeCtx()
  const all = {}
  for (const k of SWITCH_KEYS) all[k] = false
  mod.apply(ctx, mod.Config({ modules: all }))
  if (plugins.length !== 0) return `仍登记了=${JSON.stringify(plugins)}`
  if (!logs.some((m) => m.includes('模块：无'))) return `logs=${JSON.stringify(logs)}`
  return true
})

// ── 9) name 常量（entry id / 路由前缀 / settings ns 三契约）───────────────
check('name 常量 = dsh-hob（entry id / 路由前缀 / settings ns 三契约）', () => {
  return mod.name === 'dsh-hob' ? true : `name=${JSON.stringify(mod.name)}`
})

const TOTAL = 9
console.log(fail === 0 ? `\nALL PASS（${TOTAL} 条）` : `\n${fail} FAILED（共 ${TOTAL} 条）`)
process.exit(fail === 0 ? 0 : 1)
