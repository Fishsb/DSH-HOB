/**
 * C1 · 设置面板（Client 半边）—— 本插件的**独立设置分区**。
 *
 * ── 它做什么 ──────────────────────────────────────────────────────────
 *   ① 在宿主设置界面里挂一个**自己的分区**（槽位 `settings.section`，
 *      id = `dsh-hob`），用户点进去能看到本插件；
 *   ② 显示**配置摘要**（配置状态 + 模块开关），数据经宿主原生
 *      `configForms`（Remote RPC）读取 —— **不自造 HTTP 路由**（E-10）；
 *   ③ 把一条**用户必须知道**的语义写在界面上：
 *      · 「**模块开关**改了要**重启实例**才生效」（原因见下方注释）；
 *   ④ 提供「去哪改」的指引 —— 真正的改值入口是宿主在**插件管理页**
 *      自动生成的表单（本插件不自建编辑器，§5.4）。
 *
 * ── 为什么不自己画表单 ────────────────────────────────────────────────
 *  宿主 `SettingsForms.describe()` 会**自动生成**可编辑表单
 *   （本插件 `autoGenerate=true`），字段的中文标签/说明来自 `config.ts` 的
 *   `.description()`。自建编辑器是重复造轮子，而且会与宿主校验/冲突检测脱节
 *   （宿主有 `SettingsConflictError` 的 revision 机制）。
 *
 * ── 配置面清理轮（2026-10-06 · UD-43）改了什么 ────────────────────────
 *   删掉了三个**空旋钮**字段的展示行：`persona` / `showEntry` / `delivery`
 *   —— 它们在界面上有、背后**没有功能**：
 *     · `persona` 只被打进一行加载日志，不影响任何行为；
 *     · `showEntry` / `delivery` 完全无人消费（悬浮球与 M3 均已挂起）。
 *   ⇒ 面板现在只展示**真开关**（`modules.*`，它决定模块是否加载）。
 *
 * ── ⚠ 第 8 轮（2026-10-10）改了什么 —— 用户报的三条 ────────────────────
 *   ①「默认预设的显示名称和 DSH 的显示不一致」⇒ 预设名走
 *       `presetDisplayName()`（本地化解析，宿主 `settings.agentPreset` ns 优先，
 *       逐级兜底；**绝不显示键名**）。见 `./i18n.ts`。
 *   ②「当前项目这些设置是否支持跟随 DSH 语言切换」⇒ 本文件底部
 *       `PANEL_ZH` / `PANEL_EN` 两份词典（**键集相同**）+ `t()` 取词，
 *       并订阅语言服务 ⇒ **切语言当场重渲染**。
 *      ⚠ **不写进模块级 `export const inject`**：那是加载门禁，`locale` 缺席会让
 *        整个设置分区消失（回归）。接法 = `ctx.inject(['locale'], cb)` +
 *        `cb.get('locale')` 免 inject 现读（见 `./i18n.ts` 的 `bindLocale`）。
 *      ⚠ **已知限制（如实声明）**：`src/config.ts` 的 `.description()` 仍是中文、
 *        由宿主**插件管理页的自动表单**直接显示 —— 那条路径**没有**语言机制，
 *        本轮不动（见回报「未做到」段）。
 *   ③「排版样式需要优化，间隔不一致、下拉框是默认样式」⇒
 *       · 三个控件由**原生 `<select>`** 换成宿主 `Menu` 那套（与 DSH 输入框旁的
 *         模型选择器同源：`MenuSurface` + `MenuGroup` + `MenuItemButton`）；
 *         **键盘走位 / Escape / 焦点归还由宿主组件负责**，本文件**不另写一份**
 *         （`dsh-client-ui-primitives/lib/types/Menu.d.ts:70-121` 的契约）。
 *       · 间距节奏对齐宿主设置页度量（逐条出处在 `./panel-styles.ts` 的注释里）。
 *       · 颜色尺寸一律走 `--dsw-*` 令牌（**不自造令牌**）。
 *
 * ── ⚠⚠ 回归红线（第 7 轮刚修好的那条，本轮**必须仍成立**）──────────────
 *   渲染用的值**只能**来自外部存储（`getSettingsSnapshot`，见 `:405` 一带的注释）——
 *   **不许**为了迁就新控件回退成"渲染期直读 snapshot"。写入成功 ⇒ 宿主快照换
 *   ⇒ React 重渲染 ⇒ **控件显示新值**；失败 ⇒ 仍显示宿主真值 + 原因可见。
 *   机检 `scripts/check-client-deps.mjs` 的断言 I 钉着这一条（零放宽）。
 *
 * ⚠ 组件必须返回**真正的 React 元素**（`SlotComponent = (props) => ReactNode`，
 *   `dsh-client-ui-slots/lib/types/index.d.ts:343`）。**不能**返回手写的
 *   `{ type, props }` 普通对象 —— 那不是合法的 ReactNode（React 元素需要
 *   `$$typeof` 标记），会渲染成 `[object Object]` 或直接报错。
 *
 * ⚠ 另一条硬约束（旧项目实测，见 EXPERIENCE.md）：
 *   **别把 promise 内联进渲染回调** —— 内联会每渲染一次新建一个引用，
 *   被 `useEffect` 依赖捕获后形成自持循环（旧项目实测 8 秒 13420 次请求，
 *   把浏览器连接池打满）。本文件的读取全走 `useSyncExternalStore`，无内联 promise。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement, ReactNode } from 'react'
import {
  IconChevronDownOutlineRegular, IconCheckOutlineRegular, IconDataOutlineRegular,
  Menu, MenuGroup, MenuItemButton, StateDot, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  getSettingsForm, getSettingsSnapshot, subscribeSettingsForm, writeSpawnFields,
  type SettingsSnapshot, type WriteResult,
} from './settings.ts'
import {
  findModel, findPreset, getCatalogSnapshot, loadCatalog, subscribeCatalog,
  type CatalogError, type CatalogSnapshot, type ModelRow, type PresetRow,
} from './catalog.ts'
import {
  bindLocale, configureDictionary, getLocaleSnapshot, presetDisplayName,
  subscribeLocale, t, type Params,
} from './i18n.ts'
import { S } from './panel-styles.ts'
// ⚠ 第 11 轮：空值 == 标准模式，**显示与派活同源** —— 两边都取这个单源常量
//   （`src/modules/bus.ts` 派活时也用它），不各写一个 `'standard'` 字面量。
import { FACTORY_DEFAULT_PRESET_ID } from '../shared/planning-preset.ts'

/** 展示用的配置形状（只取本插件 schema 里真实存在的字段）。 */
interface PanelValue {
  modules?: Record<string, unknown>
  spawn?: Record<string, unknown>
}

/** 解 volatile ref（`{ get() }`）或普通值。 */
function deref(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function') {
    try { return (value as { get: () => unknown }).get() } catch { return undefined }
  }
  return value
}

/**
 * 模块开关 → 一句人话。
 *
 * ⚠ **列设置页真正呈现的五个开关**（工具 / 预设 / 会话总线 / 闭环编排 / 设置）。
 *   `bus`（会话总线）自 **批 14 / M3** 起**列入** —— 用户 2026-10-08 决策 UD-77
 *   落地 M3 后它**真管用**（提供 `hobBus` 服务 + 注册 `hob_sessions` / `hob_send`）。
 *   而 `orch`（闭环编排）是**缺省关**、且会在无人看管时继续推进的能力 ——
 *   越是这种越不能藏（PROJECT.md §5.3 的静默失败形态）。
 *
 * ⚠ 摘要**不能用"遍历 m 的所有键"** 来生成 —— 必须用**显式白名单**（本常量）：
 *   配置键 `preset` 仍在 `modules` 里但值为 false，遍历会把它一并列出，
 *   白名单才能决定"给用户看哪几个"。
 *
 * ⚠ 显示名从第 8 轮起**走语言服务**（键 `module.<配置键>`）——
 *   本常量只保留**顺序与配置键**，中文名在 `PANEL_ZH` 里。
 */
const VISIBLE_SWITCHES = ['tools', 'preset', 'bus', 'orch', 'settings'] as const

/** 一个开关的显示名（经语言服务）。 */
function switchName(key: string): string {
  return t(`module.${key}`)
}

function moduleSummary(modules: Record<string, unknown> | undefined): string {
  const m = deref(modules) as Record<string, unknown> | undefined
  if (m === undefined || m === null) return t('moduleUnread')
  const parts = VISIBLE_SWITCHES
    .filter((k) => k in m)
    .map((k) => `${switchName(k)}${m[k] ? t('moduleOn') : t('moduleOff')}`)
  return parts.length > 0 ? parts.join(' · ') : t('moduleUnread')
}

/**
 * 模块开关 → 逐个状态标记（**视觉**投影）。
 *
 * ⚠ 与 {@link moduleSummary} 用**同一个白名单** ⇒ `bus` / `orch` 不可能漏出。
 *   两条路径共享 `VISIBLE_SWITCHES` 是刻意的：白名单只有一份。
 *
 * @returns 每项含开关名与开/关；读不到时返回 `null`（由调用方退回纯文本）。
 */
function moduleChips(modules: Record<string, unknown> | undefined): { key: string; name: string; on: boolean }[] | null {
  const m = deref(modules) as Record<string, unknown> | undefined
  if (m === undefined || m === null) return null
  const rows = VISIBLE_SWITCHES
    .filter((k) => k in m)
    .map((k) => ({ key: k, name: switchName(k), on: Boolean(m[k]) }))
  return rows.length > 0 ? rows : null
}

/**
 * 一行「标签在上、控件在下」。
 *
 * ⚠ 布局是**宿主设置页的字段式**（`ui-settings-models` 的 `.zGbnIq_field`
 *   `flex-direction:column;gap:6px`）—— 第 8 轮从"标签定宽 76px + baseline 单行"改过来，
 *   为的是与宿主其它设置页同一套节奏（用户报障③）。
 *
 * ⚠ 值可以是任意节点（状态点 / 标记 chips / 纯文本），
 *   但**每个值都必须自带可读文本** —— `StateDot` 是 `aria-hidden`，
 *   单独放一个点对屏读用户等于没信息（组件文档自己写明了这条）。
 */
function Row(props: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className={S.row}>
      <div className={S.rowLabel}>{props.label}</div>
      <div className={S.rowValue}>{props.children}</div>
    </div>
  )
}

/** 从快照里取一个普通字符串（volatile ref 与裸值都收口到这里）。 */
function readString(value: unknown): string {
  const v = deref(value)
  return typeof v === 'string' ? v : ''
}

/** 把结构化错误渲染成当前语言的句子（**不吞原因**）。 */
function catalogErrorText(error: CatalogError | null): string {
  if (error === null) return t('catalog.fail', { message: '' })
  return t(error.key, error.params as Params | undefined)
}

/**
 * 一个下拉控件（宿主 `Menu` 那套）—— 第 8 轮替换原生 `<select>`。
 *
 * ── 为什么不自己画（判据，不是偏好）────────────────────────────────────
 *   宿主**自己的**模型选择器就是这套：`dsh-client-ui-model-selection/lib/client.js:871`
 *   （`MenuSurface` + `createPortal`）、`:981`（`MenuGroup`）、触发按钮 `:856-868`
 *   （图标 + 文本 + `IconChevronDownOutlineRegular`，展开时旋转）。
 *   本组件的触发按钮样式**逐条**抄自它的 `.trigger`（出处见 `panel-styles.ts`）。
 *
 * ── ⚠ 无障碍**不退化**（这是"照宿主实现"的实质，不是客套）──────────────
 *   键盘走位 / `Tab` 落格 / `Escape` 关闭 / **焦点归还触发按钮** 全部由宿主
 *   `Menu` 负责（契约 `dsh-client-ui-primitives/lib/types/Menu.d.ts:70-121`：
 *   *"Escape or Shift+Tab close it and return focus to the anchor's first button"*）
 *   ⇒ 本文件**不另写一份**键盘处理（另写必然与宿主的行为分叉）。
 *   触发按钮自己声明 `aria-haspopup="menu"` / `aria-expanded`（与宿主 `:840-846` 同款）。
 *
 * @param props.value    - 当前选中项 id（`''` = 未选，显示 placeholder）。
 * @param props.placeholder - 未选时的显示文本（如"（用宿主默认预设）"）。
 * @param props.groups   - 分组选项（`label` 空 = 不分组，直接平铺）。
 * @param props.onSelect - 选中回调（**不关**写入逻辑，由调用方决定）。
 * @param props.disabled - 写入期间禁用（沿用既有 `busy`；**语义不减**）。
 * @param props.icon     - 触发按钮的前导图标（可选）。
 * @param props.ariaLabel - 触发按钮的无障碍名。
 * @param props.itemNote - 每项右侧的次级文本（"不可用"等原因）。
 */
function MenuSelect(props: {
  value: string
  placeholder: string
  groups: ReadonlyArray<{ key: string; label: string; items: ReadonlyArray<{ id: string; label: string; note?: string }> }>
  onSelect: (id: string) => void
  disabled: boolean
  icon?: ReactNode
  ariaLabel: string
}): ReactElement {
  const [open, setOpen] = useState(false)
  const selectedLabel = (() => {
    for (const g of props.groups) {
      const hit = g.items.find((it) => it.id === props.value)
      if (hit !== undefined) return hit.label
    }
    return undefined
  })()

  const trigger = (
    <button
      type="button"
      className={S.trigger}
      disabled={props.disabled}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={props.ariaLabel}
      onClick={() => { setOpen((v) => !v) }}
    >
      {props.icon === undefined ? null : <span className={S.triggerIcon}>{props.icon}</span>}
      <span className={S.triggerValue}>{selectedLabel ?? props.placeholder}</span>
      <IconChevronDownOutlineRegular
        className={open ? `${S.chevron} ${S.chevronOpen}` : S.chevron}
      />
    </button>
  )

  return (
    <Menu
      open={open}
      anchor={trigger}
      onClose={() => { setOpen(false) }}
      // portal：本面板挂在设置页的滚动容器里，就地展开会被祖先的 overflow 裁掉
      // （宿主模型选择器同样用 portal，见 `dsh-client-ui-model-selection/lib/client.js:871`）。
      portal
    >
      {props.groups.map((g) => (
        <MenuGroup key={g.key} label={g.label}>
          {g.items.map((it) => (
            <MenuItemButton
              key={it.id}
              icon={it.id === props.value ? <IconCheckOutlineRegular /> : undefined}
              onSelect={() => {
                setOpen(false)
                props.onSelect(it.id)
              }}
            >
              <span className={S.triggerValue}>{it.label}</span>
              {it.note === undefined ? null : <span className={S.itemNote}>{it.note}</span>}
            </MenuItemButton>
          ))}
        </MenuGroup>
      ))}
    </Menu>
  )
}

/**
 * 「新建会话默认」卡片（批 18 · 2026-10-09；第 8 轮换控件 + 走语言）。
 *
 * ── 它写什么 ──────────────────────────────────────────────────────────
 *   本插件建出的会话（`hob_spawn`）套用的**预设 / 模型 / 思考档位**默认值。
 *   写入走宿主 `configForms` 的 `mutate`（**子字段路径**，见 `settings.ts`）。
 *
 * ── 三条**必须写在界面上**的边界（用户看不到就等于没有）───────────────
 *   ① 只影响**本插件建出的会话**，**不影响**手工新建的会话；
 *   ② 模型/预设**下线或删除**时，已存值**如实标"不可用"**（不静默吞）；
 *   ③ 当前页面**不允许写入**时，如实说明原因（**不假装保存成功**）。
 *
 * ── 候选来源（都是宿主既有 RPC，不自造）─────────────────────────────
 *   预设 ← `remote.agentPresets.list()`；模型 ← `remote.session.modelCatalog()`。
 *   ⚠ `broken` 的预设**照样列出**并标"不可用"（E-46：宿主的静默过滤是教训）。
 *   ⚠ 选中模型**没有** `reasoning.efforts` ⇒ **不呈现**档位控件（不留空旋钮）。
 */
function SpawnDefaultsCard(props: {
  form: ReturnType<typeof getSettingsForm>
  /** 宿主快照（**外部存储的当前值**）—— 渲染用的值只能来自这里。 */
  settings: SettingsSnapshot | null
  value: PanelValue
  snapshot: CatalogSnapshot
}): ReactElement {
  const { form, settings, value, snapshot } = props
  const spawn = (deref(value.spawn) ?? {}) as Record<string, unknown>
  const preset = readString(spawn.agentPreset)
  const provider = readString(spawn.provider)
  const model = readString(spawn.model)
  const effort = readString(spawn.reasoningEffort)

  // ── 第 11 轮（2026-10-10 · 用户裁定）：**空值 == 标准模式**（显示与派活同一口径）──
  //   ⚠ 用户原话：「说了出厂默认设置成标准模式 …… 不要宿主默认预设」。
  //   ⚠ 上一轮那套"把空值当'不指定'、交给宿主解析它的有效默认"是**在给一个不该存在的
  //     选项打补丁** —— 宿主的有效默认**可能是规划侧预设**（本机 `selectedDefault: Hob`）
  //     ⇒ 越补越乱。现在直接**不给这个选项**：空值就按出厂默认（标准模式）显示与派活。
  //   ⚠ 与 `bus.ts` 的派活口径**必须同源**：两边都用 `FACTORY_DEFAULT_PRESET_ID`
  //     （`src/shared/planning-preset.ts` 的单源常量），不是各写一个 `'standard'`。
  const effectivePreset = preset === '' ? FACTORY_DEFAULT_PRESET_ID : preset

  // 目录里的选中项（找不到 ⇒ "不可用"，**不静默**）。
  const presetRow: PresetRow | undefined = findPreset(snapshot.presets, effectivePreset)
  const catalog = snapshot.catalog
  const modelRow: ModelRow | undefined = (provider === '' || model === '') ? undefined : findModel(catalog, provider, model)
  const efforts = modelRow?.reasoning?.efforts ?? []

  // 写入反馈（成功/失败都**如实**显示在这里；失败带原因）。
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const formRef = useRef(form)
  formRef.current = form

  // ⚠ 只在面板**第一次**渲染时读一次候选（不是每次渲染，也不是内联 promise ——
  //   内联会被依赖捕获成自持循环，见文件头）。失败时用户可点「重试」。
  useEffect(() => { void loadCatalog() }, [])

  /** 统一写入入口：失败**一定**有可读原因（writeSpawnFields 保证）。 */
  const writeMany = async (
    writes: ReadonlyArray<{ field: 'agentPreset' | 'provider' | 'model' | 'reasoningEffort'; value: string }>,
  ): Promise<void> => {
    setBusy(true)
    try {
      const r: WriteResult = await writeSpawnFields(formRef.current, writes)
      if (r.ok) setNotice({ tone: 'ok', text: t('write.ok') })
      else setNotice({ tone: 'bad', text: r.reason ?? t('write.rejected') })
    } finally {
      setBusy(false)
    }
  }
  /** 单字段写入（选中预设 / 单独改档位时用）。 */
  const write = (field: 'agentPreset' | 'provider' | 'model' | 'reasoningEffort', next: string): Promise<void> =>
    writeMany([{ field, value: next }])

  const catalogStatusText =
    snapshot.status === 'loading' ? t('catalog.status.loading')
      : snapshot.status === 'error' ? catalogErrorText(snapshot.error)
        : snapshot.status === 'idle' ? t('catalog.status.idle')
          : t('catalog.status.ready', {
              // ⚠ 口径（用户要求「计数与可选数一致，别让用户数不上」）：
              //   正文那个数**就是可选数**（已排除项不算在内）；有排除时**另起一句**
              //   说明排除了几项，且与被排除项的名字（见下面的说明行）互相对得上。
              presets: snapshot.presets.length,
              models: catalog?.groups.reduce((n, g) => n + g.models.length, 0) ?? 0,
              excluded: snapshot.excludedPresets.length === 0
                ? ''
                : t('catalog.status.excluded', { count: snapshot.excludedPresets.length }),
            })

  // ── 第 11 轮：**整块撤销**上一轮的"解析宿主有效默认 + 警告"（用户裁定）───────────
  //   ⚠ 上一轮在这里解析"宿主会落到哪个预设"并据此显示/警告。用户裁定：那个选项
  //     （「用宿主默认预设」）**本来就不该存在** ⇒ 该做的是**删掉选项**，
  //     而不是给它加解析与警告（**给不该存在的选项打补丁，越补越乱**）。
  //   ⇒ 现在空值直接按出厂默认（标准模式）走（见 `effectivePreset`），
  //     因此这里**不再**需要读 `isDefault`、不再需要 `hostDefault*` 三个量。
  //   ⚠ 教训与判据留在 EXPERIENCE E-107；机检 ⑨ 组钉"这些残留不得回来"。

  // ── 预设候选：**只列真实预设**（第 11 轮：第一项「（用宿主默认预设）」已删除）─────
  //   ⚠ 删除理由（用户裁定）：那个选项把空值当"不指定"交给宿主，而宿主的有效默认
  //     **可能是规划侧预设**（本机 `selectedDefault: Hob`）⇒ 会建出只能再规划的会话。
  //     上一轮给它加了"解析 + 警告"，那是**给不该存在的选项打补丁**；本轮的修法是
  //     **删掉选项本身**，空值按出厂默认（标准模式）走（见上面的 `effectivePreset`）。
  //   ⚠ `Hob` **仍不在候选**（第 9 轮语义不变），且排除**仍可见地说明**（见下面的 `note.excluded`）。
  const presetItems: { id: string; label: string; note?: string }[] = [
    ...snapshot.presets.map((p) => {
      const marks: string[] = []
      if (p.broken !== undefined) marks.push(t('tag.unavailable'))
      if (p.isDefault === true) marks.push(t('tag.hostDefault'))
      return { id: p.id, label: presetDisplayName(p), note: marks.join('') || undefined }
    }),
  ]
  // ⚠ 已存值**不在可选清单**里（被排除的规划侧预设、或已被删除的预设）⇒ **如实显示**，
  //   并**仍可选中它以便改掉**（沿用第 9 轮做法）。
  //   ⚠ 两种情形**必须分开说**：被本项目有意排除 vs 已被删除 —— 混为一谈会让用户
  //     以为预设丢了（E-46 同族）。
  const presetIsExcluded = snapshot.excludedPresets.some((p) => p.id === effectivePreset)
  if (presetIsExcluded) {
    const row = snapshot.excludedPresets.find((p) => p.id === effectivePreset)
    presetItems.push({
      id: effectivePreset,
      label: row === undefined ? effectivePreset : presetDisplayName(row),
      note: t('tag.notACandidate'),
    })
  } else if (presetRow === undefined) {
    presetItems.push({ id: effectivePreset, label: effectivePreset, note: t('tag.unavailableNotInPresetList') })
  }
  // 被排除项的显示名（说明行要用）—— 取不到就退回 id，**不留空白**。
  const excludedNames = snapshot.excludedPresets.map((p) => presetDisplayName(p))

  // ── 模型候选（**provider 分组保留**：用宿主 `MenuGroup` 的组标签）────────
  const modelGroups: { key: string; label: string; items: { id: string; label: string; note?: string }[] }[] = [
    {
      key: '',
      // 未分组的那一项（"用宿主默认模型"）不挂组标签 —— 组标签是给 provider 用的。
      label: '',
      items: [{ id: '', label: t('opt.hostDefaultModel') }],
    },
    ...(catalog?.groups ?? []).map((g) => ({
      key: g.id,
      label: `${g.name}（${g.id}）`,
      items: g.models.map((m) => ({
        id: `${g.id}\u0000${m.id}`,
        label: m.name === m.id ? m.id : `${m.name}（${m.id}）`,
      })),
    })),
  ]
  // ⚠ 已存值不在目录里（模型下线）⇒ **如实标"不可用"**。
  if (provider !== '' && model !== '' && modelRow === undefined) {
    modelGroups.push({
      key: '\u0000missing',
      label: '',
      items: [{ id: `${provider}\u0000${model}`, label: `${provider} / ${model}`, note: t('tag.unavailableNotInModelCatalog') }],
    })
  }

  // ── 档位候选（⚠ 只有选中模型**带** efforts 才呈现；没有就**不留空旋钮**）──
  const effortItems = [
    {
      id: '',
      label: t('opt.modelDefaultEffort', {
        effort: modelRow?.reasoning?.defaultEffort === undefined ? '' : `：${modelRow.reasoning.defaultEffort}`,
      }),
    },
    ...efforts.map((x) => ({ id: x.id, label: x.description === undefined ? x.name : `${x.name} — ${x.description}` })),
  ]

  return (
    <div className={S.card}>
      <div className={S.cardHead}>
        <span className={S.cardTitle}>{t('cardTitle')}</span>
        <span className={S.cardNote}>
          {t('cardNote.pre')}<code>hob_spawn</code>{t('cardNote.mid')}
          <b>{t('cardNote.noAffect')}</b>{t('cardNote.post')}
        </span>
      </div>

      {/* ── 预设 ───────────────────────────────────────────────────── */}
      <Row label={t('label.preset')}>
        <MenuSelect
          // ⚠ 第 11 轮：空值**不再**显示成「（用宿主默认预设）」，而是**解析到出厂默认**
          //   （标准模式）—— 与派活口径同源（`FACTORY_DEFAULT_PRESET_ID`）。
          //   这样"没设过"的用户看到的与**实际会用到的**是同一个预设，不会两处不一致。
          value={effectivePreset}
          // placeholder 只在"清单里连标准模式都没有"时兜底显示（正常不该出现）。
          placeholder={t('preset.factoryName')}
          groups={[{ key: 'preset', label: '', items: presetItems }]}
          onSelect={(id) => { void write('agentPreset', id) }}
          disabled={busy}
          ariaLabel={t('label.preset')}
        />
        {presetRow?.broken !== undefined ? (
          <span className={S.warn}>{t('warn.presetBroken', { reason: presetRow.broken })}</span>
        ) : null}
        {/* ⚠ 已存值 = 被排除项 ⇒ 如实说明"它是谁排的 + 实际效果"，不与"已被删除"混为一谈 */}
        {presetIsExcluded ? (
          <span className={S.warn}>
            {t('warn.presetExcluded', { id: effectivePreset, names: excludedNames.join(' / ') })}
          </span>
        ) : null}
        {!presetIsExcluded && presetRow === undefined ? (
          <span className={S.warn}>{t('warn.presetMissing', { id: effectivePreset })}</span>
        ) : null}
        {/* ── 常驻说明：为什么某个预设**不在**候选里（**不许静默过滤** · E-46）────
            ⚠ 它**常驻**（不是只在异常时出现）：用户拉开下拉看不见 Hob 时，
              必须当场能读到"为什么没有"，而不是以为预设不存在。
            ⚠ 只在宿主**确实返回了**该预设时才显示（`excludedPresets` 非空）——
              宿主里没有它时显示"已排除 X"反而是假话。 */}
        {excludedNames.length > 0 ? (
          <span className={S.subNote}>{t('note.excluded', { names: excludedNames.join(' / ') })}</span>
        ) : null}
      </Row>

      {/* ── 模型（按 provider 分组）────────────────────────────────── */}
      <Row label={t('label.model')}>
        <MenuSelect
          value={provider === '' || model === '' ? '' : `${provider}\u0000${model}`}
          placeholder={t('opt.hostDefaultModel')}
          groups={modelGroups}
          icon={<IconDataOutlineRegular />}
          ariaLabel={t('label.model')}
          disabled={busy}
          onSelect={(v) => {
            if (v === '') {
              void writeMany([
                { field: 'provider', value: '' },
                { field: 'model', value: '' },
                { field: 'reasoningEffort', value: '' },
              ])
              return
            }
            const [p, m] = v.split('\u0000')
            const nextModel = findModel(catalog, p, m)
            // ⚠ **一次 mutate 原子下发**（不是连着写两次）：选模型本质是
            //   (provider, model[, effort]) 一起变；分开写会产生"新 provider + 旧 model"
            //   的中间态，且推两次 revision、触发两次重渲染。
            //   档位：旧档位不属于新模型 ⇒ 一并清掉（= 用新模型默认档）；
            //   仍适用则保留（不必重写）。
            const keepEffort = effort !== '' && (nextModel?.reasoning?.efforts ?? []).some((x) => x.id === effort)
            void writeMany([
              { field: 'provider', value: p },
              { field: 'model', value: m },
              ...(keepEffort ? [] : [{ field: 'reasoningEffort' as const, value: '' }]),
            ])
          }}
        />
        {provider !== '' && model !== '' && modelRow === undefined ? (
          <span className={S.warn}>{t('warn.modelMissing', { provider, model })}</span>
        ) : null}
        {modelRow !== undefined && efforts.length > 0 ? (
          <span className={S.inline}>
            <span className={S.subLabel}>{t('label.effort')}</span>
            <MenuSelect
              value={effort}
              placeholder={effortItems[0].label}
              groups={[{ key: 'effort', label: '', items: effortItems }]}
              onSelect={(id) => { void write('reasoningEffort', id) }}
              disabled={busy}
              ariaLabel={t('label.effort')}
            />
          </span>
        ) : null}
      </Row>

      {/* ── 候选状态 / 失败如实显示 / 重试 ─────────────────────────── */}
      <Row label={t('label.catalog')}>
        <span className={S.inline}>
          <span className={snapshot.status === 'error' ? S.warn : S.subNote}>{catalogStatusText}</span>
          <button
            type="button"
            className={S.linkBtn}
            disabled={snapshot.status === 'loading'}
            onClick={() => { void loadCatalog() }}
          >
            {t('action.reload')}
          </button>
        </span>
      </Row>

      {/* ── 写入反馈（成功与失败都显示；失败必有原因）─────────────── */}
      {notice === null ? null : (
        <Row label={t('label.writeResult')}>
          <span className={notice.tone === 'ok' ? S.ok : S.warn}>{notice.text}</span>
        </Row>
      )}

      {/* ── 不可写时如实说明（**不假装保存成功**）────────────────── */}
      {/* ⚠ 读的是**外部存储的快照**（`settings`），不是渲染期直调 `form.getSnapshot()`
          —— 后者与 form 的订阅脱钩，写入成功后这一行不会跟着变（第 7 轮的同源收益）。 */}
      {settings?.writable !== true ? (
        <Row label={t('label.write')}>
          <span className={S.warn}>
            {t('write.notWritable.pre')}<b>{t('write.notWritable.noWrite')}</b>
            {t('write.notWritable.mid')}<code>{settings?.mode ?? '?'}</code>
            {t('write.notWritable.post')}
          </span>
        </Row>
      ) : null}
    </div>
  )
}

/**
 * 设置分区组件。
 *
 * 数据源：`configForms.get('dsh-hob')` 的快照（经 `useSyncExternalStore` 消费）。
 * 状态如实显示 —— `unavailable` 是真实状态，**不隐藏、不美化**（E-29）。
 */
export function SettingsPanel(): ReactElement {
  const form = useSyncExternalStore(subscribeSettingsForm, getSettingsForm, getSettingsForm)
  const catalog = useSyncExternalStore(subscribeCatalog, getCatalogSnapshot, getCatalogSnapshot)
  // ⚠ 渲染用的值是**外部存储的快照**（本模块已在 form 自身的订阅回调里刷新它）；
  //   不能再写成 `form?.getSnapshot?.()` —— 那样值的变化**进不了 React 的订阅**，
  //   宿主写入成功后不会有任何重渲染 ⇒ 下拉框继续显示旧值（第 7 轮用户报的那个现象）。
  const settings = useSyncExternalStore(subscribeSettingsForm, getSettingsSnapshot, getSettingsSnapshot)
  // ⚠ 订阅语言服务：切语言 ⇒ 宿主通知 ⇒ 本模块通知 ⇒ **当场重渲染**。
  //   快照本身不参与渲染（语言通过 `t()` 在渲染期现读），它只用来**触发重渲染**。
  useSyncExternalStore(subscribeLocale, getLocaleSnapshot, getLocaleSnapshot)
  const status = settings?.status ?? 'unavailable'
  const value = (settings?.value ?? {}) as PanelValue

  const statusText =
    status === 'ready' ? t('statusReady')
      : status === 'loading' ? t('statusLoading')
        : t('statusUnavailable')

  // 状态点语义映射（用宿主的五态词汇，不发明新词）：
  //   ready → done（绿）；loading → ongoing（转环）；unavailable → error（红）。
  // ⚠ 红不是"报错"而是"这里读不到配置"，故文本部分**如实写出原因**，
  //   不让颜色单独承担语义。
  const statusDot = status === 'ready' ? 'done' : status === 'loading' ? 'ongoing' : 'error'

  const chips = moduleChips(value.modules)
  const summaryText = moduleSummary(value.modules)

  return (
    <section className={S.section} aria-labelledby="dsh-hob-panel-title">
      <div>
        <h2 className={S.title} id="dsh-hob-panel-title">{`dsh-hob · ${t('sectionTitle')}`}</h2>
        <p className={S.intro}>{t('sectionIntro')}</p>
      </div>

      <div className={S.card}>
        <Row label={t('configStatus')}>
          <span className={S.inline}>
            <StateDot state={statusDot} />
            {statusText}
          </span>
        </Row>
        <Row label={t('modules')}>
          {chips === null ? summaryText : (
            <span className={S.chips}>
              {/* 视觉上是逐项状态标记；纯文本等值句作为文本替代给屏读用户
                  （同时让它成为该行的 title，鼠标悬停可读全句）。
                  ⚠ 这两者来源同一份白名单，不可能不一致。 */}
              <span className={S.srOnly}>{summaryText}</span>
              {chips.map((c) => (
                <Tag key={c.key} tone={c.on ? 'success' : 'neutral'}>{`${c.name} ${c.on ? t('moduleOn') : t('moduleOff')}`}</Tag>
              ))}
            </span>
          )}
        </Row>
      </div>

      <SpawnDefaultsCard form={form} settings={settings} value={value} snapshot={catalog} />

      <ul className={S.notes}>
        <li className={S.note}>
          {t('note.restart.pre', {
            tools: t('module.tools'),
            preset: t('module.preset'),
            bus: t('module.bus'),
            orch: t('module.orch'),
            settings: t('module.settings'),
          })}<b>{t('note.restart.strong')}</b>{t('note.restart.post')}
        </li>
        <li className={S.note}>
          {t('note.effective.pre', { card: t('cardTitle') })}<b>{t('note.effective.strong')}</b>{t('note.effective.post')}
        </li>
        <li className={S.note}>
          {t('note.entry', { card: t('cardTitle') })}
        </li>
      </ul>
    </section>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// 本插件设置分区的**词典**（中 / 英，键集必须完全一致，机检钉住）
// ══════════════════════════════════════════════════════════════════════════
/**
 * ⚠ 为什么字典写在这个文件里：宿主自己的做法就是这样 ——
 *   `dsh-client-ui-agent-preset/lib/client.js:1576-1618` 把 `en` / `zh` 两个字面量
 *   写在**同一个文件**里、紧跟组件，`:1591` 才 `ctx.locale.register(ns, { zh, en })`。
 *   照抄它好处是"这一屏的文案"一眼可见。
 * ⚠ 两份词典**键集必须完全相同**（宿主的语言服务对 `register` 做双语平衡校验，
 *   且键集不一致会导致某语言下静默显示键名）。机检 `check:client` 钉这一条。
 * ⚠ 四个内置预设名（`presetStandardName` 等）**不在**这里 ——
 *   它们由 `i18n.ts` 的兜底表负责（逐字同宿主），这里只放本插件自己的 UI 文案。
 */
const PANEL_EN: Record<string, string> = {
  sectionTitle: 'Human–agent translation layer',
  sectionIntro:
    'This plugin provides a tool surface that reads documents and writes only its ledger, and lets the «Hob» agent preset '
    + 'turn what you say into instructions for an implementation session (the implementation-side preset Hob-Execute was '
    + 'removed in v4, so Hob is the only one left). The current configuration summary follows.',
  configStatus: 'Configuration status',
  statusReady: 'Ready',
  statusLoading: 'Reading…',
  statusUnavailable: 'Unavailable (this plugin’s configuration surface was not found)',
  modules: 'Module switches',
  moduleOn: 'on',
  moduleOff: 'off',
  moduleUnread: '(not read)',
  'module.tools': 'Tools',
  'module.preset': 'Presets',
  'module.bus': 'Session bus',
  'module.orch': 'Closed-loop orchestration',
  'module.settings': 'Settings',
  cardTitle: 'New-session defaults',
  'cardNote.pre': 'Affects only sessions this plugin creates (the ones Hob starts via ',
  'cardNote.mid': '); ',
  'cardNote.noAffect': 'sessions you create by hand are unaffected',
  'cardNote.post': ' — their defaults come from DSH’s own settings page.',
  'label.preset': 'Default preset',
  'label.model': 'Default model',
  'label.effort': 'Reasoning effort',
  'label.catalog': 'Candidate sources',
  'label.writeResult': 'Write result',
  'label.write': 'Write',
  'preset.factoryName': 'the factory default preset (Standard mode)',
  'opt.hostDefaultModel': '(Use the host default model)',
  'opt.modelDefaultEffort': '(Model default{effort})',
  'tag.unavailable': ' · unavailable',
  'tag.hostDefault': ' · host default',
  'tag.unavailableNotInPresetList': ' · unavailable · not in the current preset list',
  'tag.unavailableNotInModelCatalog': ' · unavailable · not in the current model catalog',
  'tag.notACandidate': ' · not offered as a new-session default',
  'warn.presetBroken': 'The host marks this preset unavailable: {reason}',
  'warn.presetMissing': 'The stored preset “{id}” is not in the current list (it may have been deleted) — the value is kept so you can change it here.',
  'warn.presetExcluded': 'The stored preset “{id}” is not offered as a new-session default; hob_spawn will use the factory default (Standard mode) instead. The value is kept so you can change it here.',
  'note.excluded': 'Not offered as a new-session default: {names} — this plugin’s planning-side preset cannot carry out work.',
  'warn.modelMissing': 'The stored model “{provider} / {model}” is not in the current catalog (it may be retired) — the value is kept so you can change it here.',
  'catalog.status.loading': 'Reading candidates…',
  'catalog.status.idle': 'Candidates not loaded',
  'catalog.status.ready': 'Candidates ready ({presets} presets / {models} models)',
  'catalog.status.excluded': ' ({count} planning-side preset(s) not offered here)',
  'catalog.fail': 'Reading candidates failed — {message}',
  'catalog.fail.host': '{code}: {message}',
  'catalog.fail.noResult': 'The host returned no result (its namespace may not be mounted yet)',
  'catalog.fail.nsNotReady': 'The host Remote namespaces are not ready: {missing} (the page is still loading, or the service is not mounted) — press “Reload” to retry',
  'catalog.fail.preset': 'Reading the preset list failed — {message}',
  'catalog.fail.model': 'Reading the model catalog failed — {message}',
  'catalog.fail.exception': 'Reading candidates threw — {message}',
  'action.reload': 'Reload',
  'write.ok': 'Written (takes effect for the sessions this plugin creates from now on).',
  'write.rejected': 'The host rejected this write (no reason given).',
  'write.notWritable.pre': 'This page does ',
  'write.notWritable.noWrite': 'not allow writes',
  'write.notWritable.mid': ' (host persistence mode = ',
  'write.notWritable.post': ') — on non-loopback access the host only changes settings in memory, so this panel refuses the write instead of pretending it saved.',
  'note.restart.pre': '· Module switches ({tools} / {preset} / {bus} / {orch} / {settings}, five in total): a change needs ',
  'note.restart.strong': 'an instance restart',
  'note.restart.post': ' to take effect — the host’s rule is that changing these values does not remount the plugin, and modules are loaded at plugin-load time.',
  'note.effective.pre': '· «{card}» is a ',
  'note.effective.strong': 'takes-effect-immediately',
  'note.effective.post': ' value-type configuration (no restart after a host write) — it is a different path from the module switches above; do not mix up their conditions.',
  'note.entry': '· Where to change things: this section edits «{card}» directly; the remaining fields can still be changed in the plugin-management page’s host-generated configuration form.',
}

/** 中文词典（键集与 {@link PANEL_EN} **完全相同**）。 */
const PANEL_ZH: Record<string, string> = {
  sectionTitle: '人机翻译层',
  sectionIntro:
    '本插件提供一个只读文档、只写账本的工具面，并让「Hob」这个 Agent 预设把你说的话整理成给实施会话的指令'
    + '（实施侧预设 Hob-Execute 已于 v4 删除，现只剩 Hob 一个）。下面是当前配置摘要。',
  configStatus: '配置状态',
  statusReady: '已就绪',
  statusLoading: '读取中…',
  statusUnavailable: '不可用（未读到本插件的配置面）',
  modules: '模块开关',
  moduleOn: '开',
  moduleOff: '关',
  moduleUnread: '(未读到)',
  'module.tools': '工具',
  'module.preset': '预设',
  'module.bus': '会话总线',
  'module.orch': '闭环编排',
  'module.settings': '设置',
  cardTitle: '新建会话默认',
  'cardNote.pre': '仅影响本插件建出的会话（Hob 派活时经 ',
  'cardNote.mid': ' 新建的那些）；',
  'cardNote.noAffect': '不影响',
  'cardNote.post': '你手工新建的会话 —— 后者的默认由宿主自己的设置页管。',
  'label.preset': '默认预设',
  'label.model': '默认模型',
  'label.effort': '思考档位',
  'label.catalog': '候选来源',
  'label.writeResult': '写入结果',
  'label.write': '写入',
  'preset.factoryName': '出厂默认预设（标准模式）',
  'opt.hostDefaultModel': '（用宿主默认模型）',
  'opt.modelDefaultEffort': '（用模型默认{effort}）',
  'tag.unavailable': '（不可用）',
  'tag.hostDefault': ' · 宿主默认',
  'tag.unavailableNotInPresetList': '（不可用 · 不在当前预设清单里）',
  'tag.unavailableNotInModelCatalog': '（不可用 · 不在当前模型目录里）',
  'tag.notACandidate': '（不作候选）',
  'warn.presetBroken': '该预设被宿主标为不可用：{reason}',
  'warn.presetMissing': '已存预设「{id}」不在当前清单里（可能已被删除）—— 仍保留原值，可在此改掉。',
  'warn.presetExcluded': '已存预设「{id}」不作候选；派活时改用出厂默认（标准模式）。原值仍保留，可在此改掉。',
  'note.excluded': '以下预设不作候选：{names} —— 本插件的规划侧预设，不能施工。',
  'warn.modelMissing': '已存模型「{provider} / {model}」不在当前目录里（可能已下线）—— 仍保留原值，可在此改掉。',
  'catalog.status.loading': '候选读取中…',
  'catalog.status.idle': '候选未加载',
  'catalog.status.ready': '候选已就绪（预设 {presets} 个 / 模型 {models} 个）',
  'catalog.status.excluded': '（另有 {count} 个规划侧预设不作候选）',
  'catalog.fail': '候选读取失败 —— {message}',
  'catalog.fail.host': '{code}: {message}',
  'catalog.fail.noResult': '宿主未返回结果（命名空间可能尚未挂载）',
  'catalog.fail.nsNotReady': '宿主 Remote 命名空间未就绪：{missing}（页面加载中或服务未挂载）—— 点「重新读取」重试',
  'catalog.fail.preset': '预设清单读取失败 —— {message}',
  'catalog.fail.model': '模型目录读取失败 —— {message}',
  'catalog.fail.exception': '候选读取异常 —— {message}',
  'action.reload': '重新读取',
  'write.ok': '已写入（本插件建出的会话下次生效）。',
  'write.rejected': '写入被拒（未说明原因）。',
  'write.notWritable.pre': '当前页面',
  'write.notWritable.noWrite': '不允许写入',
  'write.notWritable.mid': '（宿主持久化模式 = ',
  'write.notWritable.post': '）—— 非本机回环访问时宿主只在内存里改、不落盘，故这里会如实拒写而不是假装保存。',
  'note.restart.pre': '· 模块开关（{tools} / {preset} / {bus} / {orch} / {settings}，共五个）：改完需要',
  'note.restart.strong': '重启实例',
  'note.restart.post': '才生效 —— 宿主的规定是"改这些值不重挂插件"，而模块的装载发生在插件装载那一刻。',
  'note.effective.pre': '· 「{card}」是',
  'note.effective.strong': '即改即生效',
  'note.effective.post': '的值型配置（宿主写入后不必重启）—— 它和上面的模块开关是两条不同的路径，别把两者的生效条件混起来。',
  'note.entry': '· 修改入口：本分区直接可改「{card}」；其余字段仍可在插件管理页里由宿主自动生成的配置表单中改。',
}

// ⚠ 必须在**模块加载时**（而不是 `apply` 里）灌进去：`bindLocale` 的 inject 回调
//   可能在任何时刻触发，而它读的就是这份字典。
configureDictionary({ zh: PANEL_ZH, en: PANEL_EN })

/** 供机检读取两份词典（键集一致性 / 键名存在性由 `check:client` 钉住）。 */
export const PANEL_DICTIONARIES = { zh: PANEL_ZH, en: PANEL_EN } as const

/** 供 `src/client/index.ts` 在 `apply` 里挂 `ctx.effect` 用（转出以免它 import 本文件内部）。 */
export { bindLocale }
