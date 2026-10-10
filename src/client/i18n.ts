/**
 * 语言接线的**管线** + **预设显示名解析**（第 8 轮 · 2026-10-10）。
 *
 * ── 它解决用户报障的哪两条 ──────────────────────────────────────────────
 *   ①「默认预设的显示名称和 DSH 的显示不一致」—— 宿主给四个**内置**预设
 *     （`standard` / `ptc` / `minimal` / `cordis`）显示的是**本地化名**
 *     （「标准模式」「创造模式」…），而本面板原来直接显示 `name ?? id`
 *     ⇒ 显示成裸 `standard` / `cordis`。见 {@link presetDisplayName}。
 *   ②「当前项目这些设置是否支持跟随 DSH 语言切换」—— 原来是**不支持**的：
 *     面板文案全写死在 `settings-panel.tsx` 里。现在全走语言服务，见下。
 *
 * ── 为什么字典在 `settings-panel.tsx` 而不是这里 ────────────────────────
 *   宿主自己的做法就是这样：`dsh-client-ui-agent-preset/lib/client.js:1576-1618`
 *   把 `en` / `zh` 两个字面量写在**同一个文件**里、紧跟组件，
 *   `:1591` 才 `ctx.locale.register(ns, { zh, en })`。
 *   本仓沿用同形（面板文件里 `PANEL_ZH` / `PANEL_EN` + 本模块的
 *   {@link configureDictionary}）—— 好处是"这一屏的文案"一眼可见，
 *   不必在两个文件之间来回跳。
 *
 * ── 宿主判据（**读出来的行号，不是猜的**）────────────────────────────────
 *   `@deepseek-ai/dsh-client-ui-agent-preset/lib/client.js`：
 *     · `:225-242` `BUILT_IN_PRESET_KEYS` = standard/ptc/minimal/cordis → 语言键；
 *     · `:249-251` `isBuiltInPreset()`：**`name === undefined` 且** id 在表里 ⇒ 内置；
 *     · `:258-268` `presetDisplayText()`：内置 ⇒ `t(<键>)`；非内置 ⇒ `name ?? id`；
 *     · `:1591` `ctx.locale.register("settings.agentPreset", { zh, en })` ← **宿主那个 ns**；
 *     · `:309/:311/:313/:315` 中文词条 = 标准模式 / PTC 模式 / 极简模式 / **创造模式**；
 *       英文词条在同一份 `en` 里（同文件 `:289` 起）= Standard mode / PTC mode /
 *       Minimal mode / Creator mode。
 *   `@deepseek-ai/dsh-client-locale/lib/client.js`：
 *     · `:1414-1422` `bind(ns)`；`:1423-1428` `translate()`：
 *       查不到时**返回键名本身**（`:1425` 的 `?? key`）—— 这条决定了下面必须有兜底；
 *     · `:1443-1455` `publish()` → 通知 `subscribe` 的订阅者（切语言即重渲染）；
 *     · `lib/types/client/index.d.ts:132-144` `getSnapshot()` 契约 =
 *       *"stable reference between changes, uSES-safe"*；`subscribe(fn)` 返回 unsubscribe。
 *
 * ── ⚠ 三条纪律（各自都有实测判据）────────────────────────────────────────
 *   ① **绝不许把键名当名字显示**：宿主 `translate()` 取不到时返回键名，
 *      而"键名"（`presetStandardName`）对用户毫无意义 ⇒
 *      {@link translateVia} 把"返回值 === 键"判成**取不到**（返回 `undefined`），
 *      {@link presetDisplayName} 再逐级兜底，最后宁可显示**裸 id**。
 *   ② **自备词条与宿主逐字一致**：宿主插件缺席时用本文件的四条词条
 *      （标准模式 / PTC 模式 / 极简模式 / 创造模式），**逐字**抄自宿主 `:309-315`。
 *   ③ **接法守本仓纪律**（`check:client` 不许放宽）：
 *      `ctx.inject(['locale'], cb)` 反应式订阅 + `cb.get('locale')` 免 inject 现读；
 *      **禁止**把 `locale` 写进模块级 `export const inject` ——
 *      那是**加载门禁**：服务缺席会让**整个 client 插件不激活** ⇒ 设置分区整体消失
 *      （`.hob/EXPERIENCE.md` E-02 / E-41；`src/client/index.ts:19-30` 同款说明）。
 *
 * ── 已知限制（如实声明，别当成已解决）───────────────────────────────────
 *   语言服务整体缺席时（宿主没装 `dsh-client-locale`）：走本模块的**本地词典**，
 *   语言固定取 {@link DEFAULT_LANG}（中文）—— 此时**没有**语言可跟随，
 *   面板仍可用、文案仍可读，只是不随宿主语言变。
 *
 * ⚠ 本文件**不含任何面向用户的中文文案**（那些都在 `settings-panel.tsx` 的字典里，
 *   以便与 `check:config` 的"面板文案"断言对得上）。这里只有**预设名兜底**四个词
 *   —— 它们是宿主词条的逐字副本，故必须与宿主同文，不能"换个说法"。
 */

/** 本插件自己的语言命名空间（与宿主各家互不重叠）。 */
export const LOCALE_NS = 'dsh-hob.settings'

/**
 * **宿主**预设文案的命名空间（逐字，来自
 * `dsh-client-ui-agent-preset/lib/client.js:1591` 的 `ctx.locale.register("settings.agentPreset", …)`）。
 *
 * ⚠ 读**别人的** ns 是在"复用宿主词条、宿主改文案我们自动跟"与"跨插件耦合"之间
 *   选的**前者**（任务书 §2-A.2 的首选）；**取不到时有逐级兜底**
 *   （见 {@link presetDisplayName}）⇒ 这条耦合**不构成**新的失败面。
 */
const HOST_PRESET_NS = 'settings.agentPreset'

/** 语言服务缺席时用的语言（本项目的默认语言）。 */
const DEFAULT_LANG = 'zh'

/** 宿主 `BUILT_IN_PRESET_KEYS` 的**同形副本**（`:225-242`；只取 `name` 那一半）。 */
const BUILT_IN_PRESET_KEYS: Record<string, string> = {
  standard: 'presetStandardName',
  ptc: 'presetPtcName',
  minimal: 'presetMinimalName',
  cordis: 'presetCordisName',
}

/**
 * 四个内置预设名的**兜底词条**（宿主插件缺席 / 词条缺失时用）。
 *
 * ⚠ **逐字**抄自宿主 `dsh-client-ui-agent-preset/lib/client.js`
 *   中文 `:309` / `:311` / `:313` / `:315`，英文同文件 `en` 词典。
 *   改这里必须同步核对方才不算漂移（机检钉住这四条的存在与取值，见 `check:client`）。
 */
const PRESET_FALLBACK: Record<string, { zh: string; en: string }> = {
  presetStandardName: { zh: '标准模式', en: 'Standard mode' },
  presetPtcName: { zh: 'PTC 模式', en: 'PTC mode' },
  presetMinimalName: { zh: '极简模式', en: 'Minimal mode' },
  presetCordisName: { zh: '创造模式', en: 'Creator mode' },
}

/** 词典参数（`{name}` 占位符）。 */
export type Params = Record<string, string | number>

// ══════════════════════════════════════════════════════════════════════════
// 本插件的字面词典（由 `settings-panel.tsx` 在模块加载时灌进来）
// ══════════════════════════════════════════════════════════════════════════

interface Dictionary {
  zh: Record<string, string>
  en: Record<string, string>
}

let panelDict: Dictionary | null = null

/**
 * 灌入本插件的词典（**在 `settings-panel.tsx` 模块顶层调用一次**）。
 *
 * @param dict - `{ zh, en }` 两份键集相同的字面量。
 */
export function configureDictionary(dict: Dictionary): void {
  panelDict = dict
}

/** `{name}` 占位符替换（与宿主 `translate()` 的 `:1426-1427` 同一手法）。 */
function interpolate(template: string, params?: Params): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}

// ══════════════════════════════════════════════════════════════════════════
// 语言服务的外部存储（与 `settings.ts` 同款：订阅 + disposer + 稳定引用）
// ══════════════════════════════════════════════════════════════════════════

/** 当前就绪的语言服务（宿主 `LocaleRuntime`）；`null` = 缺席。 */
let currentLocale: any = null

/** 语言服务**自身**订阅的 disposer；`null` = 无订阅。 */
let localeUnsubscribe: (() => void) | null = null

/** 本插件词典注册的 disposer（换服务 / 卸载时释放，**不泄漏**）。 */
let dictDispose: (() => void) | null = null

const listeners = new Set<() => void>()

/** 通知本模块的订阅者（语言服务换了 / 活动语言变了）。 */
function emit(): void {
  for (const fn of [...listeners]) fn()
}

/**
 * 当前活动语言 —— **每次现读**（不缓存）。
 *
 * ⚠ 这条是**探针抓出来的真问题**（第 8 轮）：第一版把活动语言缓存在模块变量里，
 *   靠"订阅回调里刷新"更新。后果是**取词路径分叉** ——
 *   语言服务那条路（`translateVia`）读的是**实时**活动语言，
 *   而本地词典那条路（`localLookup`）读的是**缓存**值；
 *   宿主切语言后若本地兜底先被走到，两处就会给出**不同语言**的文案
 *   （实测：英文下 `t('presetStandardName')` 返回中文「标准模式」）。
 *   ⇒ 活动语言**现读**（`getLocale()` 是一次廉价的读快照），两条路必然一致。
 *
 * @returns 活动语言 id；服务缺席时 = {@link DEFAULT_LANG}。
 */
function activeLang(): string {
  const live = currentLocale?.getLocale?.()?.active
  return typeof live === 'string' && live !== '' ? live : DEFAULT_LANG
}

/**
 * 释放语言服务自身的订阅（幂等）。
 *
 * ⚠ 这个 disposer **不能**命名成 `off` / `disposer` / `subscription` / `sub` ——
 *   本仓 `scripts/check-client-deps.mjs` 的 E 组把那几个名字**约定为**
 *   "`ctx.inject(...)` 返回的 Fiber 对象"的专用名（第 7 轮实测踩过，见 E-103 ⑥）。
 */
function releaseLocale(): void {
  const unsubscribe = localeUnsubscribe
  localeUnsubscribe = null
  if (unsubscribe === null) return
  try {
    unsubscribe()
  } catch {
    // 释放失败不该让面板挂掉；"订阅有没有接上"由下面的正向路径保证。
  }
}

/** 释放本插件词典的注册（幂等）。 */
function releaseDict(): void {
  const dispose = dictDispose
  dictDispose = null
  if (dispose === null) return
  try {
    dispose()
  } catch {
    // 同上：释放失败不致命（宿主重载时还会按 data-plugin 清理）。
  }
}

/**
 * 登记就绪的语言服务，**并接上它自身的订阅**（切语言 ⇒ 本模块通知 ⇒ React 重渲染）。
 *
 * ⚠ 幂等：同一个服务重复设置不叠加订阅（提前返回），但**仍通知一次**。
 * ⚠ 不许泄漏：换服务（或 `null`）时**先**用 disposer 释放旧订阅。
 */
function adoptLocale(locale: any): void {
  if (locale === currentLocale) {
    emit()
    return
  }
  releaseLocale()
  currentLocale = locale ?? null
  if (currentLocale !== null && typeof currentLocale.subscribe === 'function') {
    localeUnsubscribe = currentLocale.subscribe(() => { emit() })
  }
  emit()
}

/**
 * `useSyncExternalStore` 的 **getSnapshot（语言快照）** —— 供面板订阅"语言变了"。
 *
 * ⚠⚠ **硬约束**：引用**在值未变化时必须恒定**（宿主 `getSnapshot()` 契约 =
 *   *"stable reference between changes, uESL-safe"*，
 *   `dsh-client-locale/lib/types/client/index.d.ts:132-136`）⇒ **直接透传**宿主快照，
 *   服务缺席时返回 `null` 字面量。**不要**自己新建对象（否则无限重渲染）。
 *
 * @returns 宿主语言快照，或 `null`。
 */
export function getLocaleSnapshot(): any {
  return currentLocale?.getSnapshot?.() ?? null
}

/** `useSyncExternalStore` 的 subscribe（本模块自身的订阅集合）。 */
export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

// ══════════════════════════════════════════════════════════════════════════
// 取词
// ══════════════════════════════════════════════════════════════════════════

/**
 * 经语言服务取一条词；**取不到返回 `undefined`**（而不是返回键名）。
 *
 * ⚠ 判据（宿主 `dsh-client-locale/lib/client.js:1423-1428`）：
 *   `translate()` 的最后一级兜底是 **`?? key`** —— 查不到就**把键名返回给你**。
 *   ⇒ "返回值 === 键"必须判成**没取到**，否则面板会把 `presetStandardName`
 *     这种键名当成人话显示给用户（任务书 §2-A.2 的红线）。
 *
 * @param ns     - 语言命名空间。
 * @param key    - 词条键。
 * @param params - `{name}` 占位符参数。
 * @returns 译文；服务缺席 / 无该词条 / 抛错时 `undefined`。
 */
function translateVia(ns: string, key: string, params?: Params): string | undefined {
  const runtime = currentLocale
  if (runtime === null || typeof runtime.bind !== 'function') return undefined
  try {
    const bound = runtime.bind(ns)
    if (typeof bound !== 'function') return undefined
    const out = bound(key, params)
    // ⚠ 这一行就是"键名回退有兜底"的判据：宿主取不到时返回键名本身。
    if (typeof out === 'string' && out !== key && out !== '') return out
  } catch {
    // 服务异常按"取不到"处理（下面还有本地词典兜底，不会空白）。
  }
  return undefined
}

/** 按语言取本插件词典（`zh-*` 都归中文，其余归英文）。 */
function dictFor(lang: string): Record<string, string> | null {
  if (panelDict === null) return null
  return lang.toLowerCase().startsWith('zh') ? panelDict.zh : panelDict.en
}

/** 本地词典查一条（当前语言 → 英文 → 内置预设名兜底）；查不到 `undefined`。 */
function localLookup(key: string): string | undefined {
  const hit = dictFor(activeLang())?.[key]
  if (hit !== undefined) return hit
  const en = panelDict?.en[key]
  if (en !== undefined) return en
  // ⚠ 四个内置预设名**不**在面板词典里（归 {@link PRESET_FALLBACK} 管）——
  //   但 `t()` 也不能因此把键名漏给用户：万一有人写出 `t('presetCordisName')`，
  //   这里必须给得出人话（**任何取词入口都不许把键名当文案**，由 `check:client` 的
  //   J-2 家族与 §11e 自证共同钉住）。
  const fallback = PRESET_FALLBACK[key]
  if (fallback !== undefined) return activeLang().toLowerCase().startsWith('zh') ? fallback.zh : fallback.en
  return undefined
}

/**
 * 面板取词入口（**所有面向用户的文案都经它**）。
 *
 * 顺序：① 本插件 ns（语言服务里已注册的当前语言词条）
 *      → ② 本地词典（当前语言 → 英文）
 *      → ③ 键名本身（最后兜底；正常情况下不该走到这里）。
 *
 * @param key    - 词条键。
 * @param params - `{name}` 占位符参数。
 * @returns 面向用户的文本。
 */
export function t(key: string, params?: Params): string {
  const viaService = translateVia(LOCALE_NS, key, params)
  if (viaService !== undefined) return viaService
  return interpolate(localLookup(key) ?? key, params)
}

/**
 * 预设的**显示名** —— 与 DSH 逐字一致且随语言切换。
 *
 * 判据链（逐条对应宿主 `presetDisplayText()`，`:258-268`）：
 *   ① **内置**（`name === undefined` 且 id 在 {@link BUILT_IN_PRESET_KEYS} 里）
 *      ⇒ 先读**宿主自己的 ns**（`settings.agentPreset`）—— 宿主改文案我们自动跟；
 *   ② 宿主那条**取不到**（插件缺席 / 词条缺失） ⇒ 读本插件 ns；
 *   ③ 本插件 ns 也取不到 ⇒ {@link PRESET_FALLBACK}（**逐字**同宿主 `:309-315`）；
 *   ④ 连兜底都没有（不该发生） ⇒ 退回**裸 id**。
 *      ⚠ **绝不返回键名** —— `presetStandardName` 这种串对用户毫无意义。
 *   ⑤ **非内置**（用户自建预设带 `name`）⇒ `name ?? id`，与宿主同口径，**不变**。
 *
 * @param row - 宿主预设行（`{ id, name? }` 子集）。
 * @returns 面向用户的显示名。
 */
export function presetDisplayName(row: { id: string; name?: string }): string {
  // ① 与宿主 `isBuiltInPreset()` 同判据：**name 缺席**且 id 在表里。
  const key = row.name === undefined ? BUILT_IN_PRESET_KEYS[row.id] : undefined
  if (key !== undefined) {
    const viaHost = translateVia(HOST_PRESET_NS, key)
    if (viaHost !== undefined) return viaHost
    const viaOwn = translateVia(LOCALE_NS, key)
    if (viaOwn !== undefined) return viaOwn
    const fallback = PRESET_FALLBACK[key]
    if (fallback !== undefined) return activeLang().toLowerCase().startsWith('zh') ? fallback.zh : fallback.en
    // ④ 宁可是裸 id，也**不**把键名当名字。
    return row.id
  }
  // ⑤ 非内置：与宿主一致。
  return row.name ?? row.id
}

/**
 * 反应式绑定语言服务（`apply` 里挂 `ctx.effect`）。
 *
 * ⚠ 必须用 `ctx.inject`（**反应式**）而不是一次性 `ctx.get`：cordis 的 fiber 并行激活，
 *   语言服务可能晚于本插件就绪 ⇒ 一次性取会拿到 `undefined` **且无报错**（E-01）。
 * ⚠ **不写进模块级 `export const inject`** —— 那是加载门禁，缺席会让整个设置分区消失
 *   （E-02 / E-41）。
 *
 * @param ctx - client 半的 cordis context。
 * @returns 解除绑定的函数（挂 `ctx.effect` 用；`ctx.inject` 返回 **Fiber**，用 `.dispose()`）。
 */
export function bindLocale(ctx: any): () => void {
  if (typeof ctx?.inject !== 'function') return () => {}

  const off = ctx.inject(['locale'], (localeCtx: any) => {
    // 免 inject 现读（`ctx.get` 不要求先声明，也不做属性访问 —— E-100）。
    const locale = typeof localeCtx?.get === 'function' ? localeCtx.get('locale') : undefined
    if (locale === undefined || locale === null) return
    if (typeof locale.register === 'function' && panelDict !== null) {
      // 重复注册会抛（宿主 `register` 的 "namespace already has locale"）⇒ 先释放上一笔。
      releaseDict()
      try {
        dictDispose = locale.register(LOCALE_NS, { zh: panelDict.zh, en: panelDict.en })
      } catch {
        // 注册失败（例如命名空间已被别人占）时本地词典仍可用 ⇒ 不致命。
      }
    }
    if (typeof locale.bind === 'function') adoptLocale(locale)
  })

  return () => {
    releaseDict()
    adoptLocale(null)
    // ⚠ `ctx.inject(...)` 返回的是 **Fiber 对象**，不是函数（E-101 / E-103）。
    if (typeof off?.dispose === 'function') void off.dispose()
  }
}

/**
 * 供机检读取的**兜底词条表**（避免"测试要读源码里某个字面量"那种脆断言）。
 *
 * @returns 键 → 中英兜底文案（副本，调用方改不动内部状态）。
 */
export function presetFallbackWords(): Record<string, { zh: string; en: string }> {
  return { ...PRESET_FALLBACK }
}

/**
 * 供机检/探针读取的**内置预设键表**（同上：让断言钉的是数据，不是文本形态）。
 *
 * @returns id → 语言键（副本）。
 */
export function builtInPresetKeys(): Record<string, string> {
  return { ...BUILT_IN_PRESET_KEYS }
}
