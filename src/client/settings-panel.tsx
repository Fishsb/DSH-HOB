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
 *   ⚠ 同时删掉了「值型字段当场生效」那条说明 —— 它描述的三个字段已不存在，
 *     留着会指向**不存在的配置项**。剩下两条说明仍然成立。
 *   ⚠ 「先清理、不接写入路径」是用户明确定的（UD-44），本轮**没有**新增任何写入。
 *
 * ── 为什么不用宿主的 `SettingsForm`（判据，不是偏好）────────────────────
 *   `SettingsForm` 是**插件管理页 `plugins.item` 的卡片壳**，其契约是
 *   *"staged 编辑 + 一个 Save 把编辑写下去"*（`SettingsForm.d.ts` 开头原文：
 *   "the plugin's controls, and the save that writes every staged edit"）。
 *   宿主实测（`lib/client.js` 逐包统计）：
 *     · 用 `SettingsForm` 的 4 个包（subagent / web-search / agent-loop / shell）
 *       **全部注册进 `plugins.item`**，`settings.section` 命中数 = 0；
 *     · 注册进 `settings.section` 的 4 个包（general / models / account / plugins）
 *       **全部不用 `SettingsForm`**，各自画布局。
 *   而本分区是**只读摘要**：没有任何 staged 编辑 ⇒ 挂上 `SettingsForm`
 *   只会多出一个**永远禁用**的 Save 按钮（`blocked = !dirty || invalid || saving`
 *   恒真）、外加 `unavailable` 分支，属于凭空多一个无用 affordance 的功能面变化。
 *   ⇒ 按宿主 `settings.section` 各页的**同一做法**办：自己组织布局，
 *     但**组件与令牌一律复用宿主**（`StateDot` / `Tag` 来自
 *     `@deepseek-ai/dsh-client-ui-primitives`，样式全部走 `--dsw-*`）。
 *
 * ── 为什么模块开关不算"即改即生效"（必读，别把它当 bug）─────────────
 *   宿主写入后只做 `resolveConfig(fiber.runtime, resolved)`
 *   （`dsh-config-editor/lib/index.js:83`）—— 它**重新校验配置对象**，
 *   但**不会重新执行 `apply()`**。而模块的装载/卸载在 `apply()` 里
 *   （`src/index.ts` 的 `MODULE_REGISTRY` 循环）⇒ 开关值变了，
 *   已装载的模块不会被卸载。
 *   ⚠ 这**不是缺陷**：宿主的 `volatile` 定义就是
 *     *"editable **without remounting**"*（`dsh-settings/lib/types/schema.d.ts:7`）。
 *   要改变**挂载拓扑**，本来就需要重新挂载。实测证据见 `.hob/STEP6-REPORT.md`。
 *
 * ⚠ 组件必须返回**真正的 React 元素**（`SlotComponent = (props) => ReactNode`，
 *   `dsh-client-ui-slots/lib/types/index.d.ts:343`）。**不能**返回手写的
 *   `{ type, props }` 普通对象 —— 那不是合法的 ReactNode（React 元素需要
 *   `$$typeof` 标记），会渲染成 `[object Object]` 或直接报错。
 *   本文件用 JSX，由 `tsconfig.client.json` 的 `jsx: "react-jsx"` 编译
 *   （`react/jsx-runtime` 已在 tsdown 的 external 列表里）。
 *
 * ⚠ 另一条硬约束（旧项目实测，见 EXPERIENCE.md）：
 *   **别把 promise 内联进渲染回调** —— 内联会每渲染一次新建一个引用，
 *   被 `useEffect` 依赖捕获后形成自持循环（旧项目实测 8 秒 13420 次请求，
 *   把浏览器连接池打满）。本文件的读取全走 `useSyncExternalStore`，无内联 promise。
 *
 * ⚠ 样式注入（本轮新增）：`ensurePanelStyles()` 在 `apply()` 里**调用一次**，
 *   不是每次渲染都调 —— 见 `./panel-styles.ts` 的文件头（含"为什么不能用
 *   `.module.css`"的实测依据）。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  getSettingsForm, getSettingsSnapshot, subscribeSettingsForm, writeSpawnFields,
  type SettingsSnapshot, type WriteResult,
} from './settings.ts'
import {
  findModel, findPreset, getCatalogSnapshot, loadCatalog, subscribeCatalog,
  type CatalogSnapshot, type ModelRow, type PresetRow,
} from './catalog.ts'
import { S } from './panel-styles.ts'

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
 * ⚠ **列设置页真正呈现的四个开关**（工具 / 预设 / 会话总线 / 设置）。
 *   `bus`（会话总线）自 **批 14 / M3** 起**列入** —— 用户 2026-10-08 决策 UD-77
 *   落地 M3 后它**真管用**（提供 `hobBus` 服务 + 注册 `hob_sessions` / `hob_send`）。
 *   v1–v4 时期刻意不列（UD-25 / UD-27）：那时 M3 挂起中，"开了也不起作用"，
 *   露出来会误导用户以为"开了就有效" ⇒ **该理由的前提已消失**，
 *   继续隐藏反而变成"真实开关用户看不到"（PROJECT.md §5.3 的静默失败）。
 *
 * ⚠ `bus` 的**界面显示名**是用户 2026-10-05 定的（UD-27），本注释照旧只写配置键，
 *   **不写那个中文名** —— 判据写的是"渲染文本零命中"这条历史口径已随之作废
 *   （它现在**就该**出现在渲染文本里）。保留本条注释是为了说明：
 *   若将来再要隐藏某个开关，仍要遵守"注释与渲染文本分清"这条纪律（见 EXPERIENCE.md E-71）。
 *
 * ⚠ 摘要仍**不能用"遍历 m 的所有键"** 来生成 —— 必须用**显式白名单**（本常量）。
 *   那是"掩底隐藏"能成立的原因：配置键 `preset` 仍在 `modules` 里但值为 false，
 *   遍历会把它一并列出，白名单才能决定"给用户看哪几个"。
 */
const VISIBLE_SWITCHES: Record<string, string> = {
  tools: '工具', preset: '预设', bus: '会话总线',
  // ⚠ 批 17：`orch`（闭环编排）**也在设置页可见**。它缺省关，且它是一条会在
  //   无人看管时继续推进的能力 —— **越是这样越不能藏**：用户必须能一眼看到
  //   它现在是开是关，否则就成了"有个会自己跑的东西，但我不知道它在跑"
  //   （PROJECT.md §5.3 的静默失败形态）。
  orch: '闭环编排',
  settings: '设置',
}

function moduleSummary(modules: Record<string, unknown> | undefined): string {
  const m = deref(modules) as Record<string, unknown> | undefined
  if (m === undefined || m === null) return '(未读到)'
  const parts = Object.entries(VISIBLE_SWITCHES)
    .filter(([k]) => k in m)
    .map(([k, name]) => `${name}${m[k] ? '开' : '关'}`)
  return parts.length > 0 ? parts.join(' · ') : '(未读到)'
}

/**
 * 模块开关 → 逐个状态标记（本轮新增的**视觉**投影）。
 *
 * ⚠ 与 {@link moduleSummary} 用**同一个白名单** ⇒ `bus` 在这里同样不可能漏出。
 *   两条路径共享 `VISIBLE_SWITCHES` 是刻意的：白名单只有一份，
 *   任何"遍历所有键"的写法都进不来。
 *
 * @returns 每项含开关名与开/关；读不到时返回 `null`（由调用方退回纯文本）。
 */
function moduleChips(modules: Record<string, unknown> | undefined): { key: string; name: string; on: boolean }[] | null {
  const m = deref(modules) as Record<string, unknown> | undefined
  if (m === undefined || m === null) return null
  const rows = Object.entries(VISIBLE_SWITCHES)
    .filter(([k]) => k in m)
    .map(([k, name]) => ({ key: k, name, on: Boolean(m[k]) }))
  return rows.length > 0 ? rows : null
}

/**
 * 一行「标签 + 内容」。
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

/**
 * 「新建会话默认」卡片（批 18 · 2026-10-09）。
 *
 * ── 它写什么 ──────────────────────────────────────────────────────────
 *   本插件建出的会话（`hob_spawn`）套用的**预设 / 模型 / 思考档位**默认值。
 *   写入走宿主 `configForms` 的 `mutate`（**子字段路径**，见
 *   `settings.ts` 的 {@link writeSpawnField} 注释）。
 *
 * ── 三条**必须写在界面上**的边界（用户看不到就等于没有）───────────────
 *   ① 只影响**本插件建出的会话**，**不影响**手工新建的会话；
 *   ② 模型/预设**下线或删除**时，已存值**如实标"不可用"**（不静默吞）；
 *   ③ 当前页面**不允许写入**时，如实说明原因（**不假装保存成功**）。
 *
 * ── 候选来源（都是宿主既有 RPC，不自造）─────────────────────────────
 *   预设 ← `ctx.remote.agentPresets.list()`；模型 ← `ctx.remote.session.modelCatalog()`。
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

  // 目录里的选中项（找不到 ⇒ "不可用"，**不静默**）。
  const presetRow: PresetRow | undefined = preset === '' ? undefined : findPreset(snapshot.presets, preset)
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
      if (r.ok) setNotice({ tone: 'ok', text: '已写入（本插件建出的会话下次生效）。' })
      else setNotice({ tone: 'bad', text: r.reason ?? '写入被拒（未说明原因）。' })
    } finally {
      setBusy(false)
    }
  }
  /** 单字段写入（选中预设 / 单独改档位时用）。 */
  const write = (field: 'agentPreset' | 'provider' | 'model' | 'reasoningEffort', next: string): Promise<void> =>
    writeMany([{ field, value: next }])

  const catalogStatusText =
    snapshot.status === 'loading' ? '候选读取中…'
      : snapshot.status === 'error' ? `候选读取失败 —— ${snapshot.error ?? '未知原因'}`
        : snapshot.status === 'idle' ? '候选未加载'
          : `候选已就绪（预设 ${snapshot.presets.length} 个 / 模型 ${catalog?.groups.reduce((n, g) => n + g.models.length, 0) ?? 0} 个）`

  return (
    <div className={S.card}>
      <div className={S.cardHead}>
        <span className={S.cardTitle}>新建会话默认</span>
        <span className={S.cardNote}>
          仅影响本插件建出的会话（Hob 派活时经 <code>hob_spawn</code> 新建的那些）；
          <b>不影响</b>你手工新建的会话 —— 后者的默认由宿主自己的设置页管。
        </span>
      </div>

      {/* ── 预设 ───────────────────────────────────────────────────── */}
      <Row label="默认预设">
        <select
          className={S.select}
          disabled={busy}
          value={preset}
          onChange={(e) => { void write('agentPreset', e.target.value) }}
        >
          <option value="">（用宿主默认预设）</option>
          {/* ⚠ broken **照样列出**、标"不可用"（不静默过滤）。 */}
          {snapshot.presets.map((p) => (
            <option key={p.id} value={p.id}>
              {`${p.name ?? p.id}${p.broken === undefined ? '' : '（不可用）'}${p.isDefault === true ? ' · 宿主默认' : ''}`}
            </option>
          ))}
          {/* ⚠ 已存值不在清单里（预设被删/下线）⇒ **如实标"不可用"**，且仍可选中它以便改掉。 */}
          {preset !== '' && presetRow === undefined ? (
            <option value={preset}>{`${preset}（不可用 · 不在当前预设清单里）`}</option>
          ) : null}
        </select>
        {preset !== '' && presetRow?.broken !== undefined ? (
          <span className={S.warn}>{`该预设被宿主标为不可用：${presetRow.broken}`}</span>
        ) : null}
        {preset !== '' && presetRow === undefined ? (
          <span className={S.warn}>已存预设「{preset}」不在当前清单里（可能已被删除）—— 仍保留原值，可在此改掉。</span>
        ) : null}
      </Row>

      {/* ── 模型（按 provider 分组）────────────────────────────────── */}
      <Row label="默认模型">
        <select
          className={S.select}
          disabled={busy}
          value={provider === '' || model === '' ? '' : `${provider}\u0000${model}`}
          onChange={(e) => {
            const v = e.target.value
            if (v === '') { void writeMany([{ field: 'provider', value: '' }, { field: 'model', value: '' }, { field: 'reasoningEffort', value: '' }]); return }
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
        >
          <option value="">（用宿主默认模型）</option>
          {catalog?.groups.map((g) => (
            <optgroup key={g.id} label={`${g.name}（${g.id}）`}>
              {g.models.map((m) => (
                <option key={`${g.id}\u0000${m.id}`} value={`${g.id}\u0000${m.id}`}>
                  {m.name === m.id ? m.id : `${m.name}（${m.id}）`}
                </option>
              ))}
            </optgroup>
          ))}
          {/* ⚠ 已存值不在目录里（模型下线）⇒ **如实标"不可用"**。 */}
          {provider !== '' && model !== '' && modelRow === undefined ? (
            <option value={`${provider}\u0000${model}`}>{`${provider} / ${model}（不可用 · 不在当前模型目录里）`}</option>
          ) : null}
        </select>
        {provider !== '' && model !== '' && modelRow === undefined ? (
          <span className={S.warn}>
            已存模型「{provider} / {model}」不在当前目录里（可能已下线）—— 仍保留原值，可在此改掉。
          </span>
        ) : null}
        {/* ⚠ 只有选中模型**带** efforts 才呈现档位选择；没有就**不留空旋钮**。 */}
        {modelRow !== undefined && efforts.length > 0 ? (
          <span className={S.inline}>
            <span className={S.subLabel}>思考档位</span>
            <select
              className={S.select}
              disabled={busy}
              value={effort}
              onChange={(e) => { void write('reasoningEffort', e.target.value) }}
            >
              <option value="">{`（用模型默认${modelRow.reasoning?.defaultEffort === undefined ? '' : `：${modelRow.reasoning.defaultEffort}`}）`}</option>
              {efforts.map((x) => (
                <option key={x.id} value={x.id}>{x.description === undefined ? x.name : `${x.name} — ${x.description}`}</option>
              ))}
            </select>
          </span>
        ) : null}
      </Row>

      {/* ── 候选状态 / 失败如实显示 / 重试 ─────────────────────────── */}
      <Row label="候选来源">
        <span className={S.inline}>
          <span className={snapshot.status === 'error' ? S.warn : S.subNote}>{catalogStatusText}</span>
          <button
            type="button"
            className={S.linkBtn}
            disabled={snapshot.status === 'loading'}
            onClick={() => { void loadCatalog() }}
          >
            重新读取
          </button>
        </span>
      </Row>

      {/* ── 写入反馈（成功与失败都显示；失败必有原因）─────────────── */}
      {notice === null ? null : (
        <div className={S.row}>
          <div className={S.rowLabel}>写入结果</div>
          <div className={S.rowValue}>
            <span className={notice.tone === 'ok' ? S.ok : S.warn}>{notice.text}</span>
          </div>
        </div>
      )}

      {/* ── 不可写时如实说明（**不假装保存成功**）────────────────── */}
      {/* ⚠ 读的是**外部存储的快照**（`settings`），不是渲染期直调 `form.getSnapshot()`
          —— 后者与 form 的订阅脱钩，写入成功后这一行不会跟着变（本轮同源收益）。 */}
      {settings?.writable !== true ? (
        <div className={S.row}>
          <div className={S.rowLabel}>写入</div>
          <div className={S.rowValue}>
            <span className={S.warn}>
              当前页面<b>不允许写入</b>（宿主持久化模式 =
              <code>{settings?.mode ?? '未知'}</code>）——
              非本机回环访问时宿主只在内存里改、不落盘，故这里会如实拒写而不是假装保存。
            </span>
          </div>
        </div>
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
  //   宿主写入成功后不会有任何重渲染 ⇒ 下拉框继续显示旧值（本轮用户报的那个现象）。
  const settings = useSyncExternalStore(subscribeSettingsForm, getSettingsSnapshot, getSettingsSnapshot)
  const status = settings?.status ?? 'unavailable'
  const value = (settings?.value ?? {}) as PanelValue

  const statusText =
    status === 'ready' ? '已就绪'
      : status === 'loading' ? '读取中…'
        : '不可用（未读到本插件的配置面）'

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
        <h2 className={S.title} id="dsh-hob-panel-title">dsh-hob · 人机翻译层</h2>
        <p className={S.intro}>
          本插件提供一个只读文档、只写账本的工具面，并让「Hob」这个 Agent 预设
          把你说的话整理成给实施会话的指令（实施侧预设 Hob-Execute 已于 v4 删除，
          现只剩 Hob 一个）。下面是当前配置摘要。
        </p>
      </div>

      <div className={S.card}>
        <Row label="配置状态">
          <span className={S.inline}>
            <StateDot state={statusDot} />
            {statusText}
          </span>
        </Row>
        <Row label="模块开关">
          {chips === null ? summaryText : (
            <span className={S.chips}>
              {/* 视觉上是逐项状态标记；纯文本等值句作为文本替代给屏读用户
                  （同时让它成为该行的 title，鼠标悬停可读全句）。
                  ⚠ 这两者来源同一份白名单，不可能不一致。 */}
              <span className={S.srOnly}>{summaryText}</span>
              {chips.map((c) => (
                <Tag key={c.key} tone={c.on ? 'success' : 'neutral'}>{`${c.name} ${c.on ? '开' : '关'}`}</Tag>
              ))}
            </span>
          )}
        </Row>
      </div>

      <SpawnDefaultsCard form={form} settings={settings} value={value} snapshot={catalog} />

      <ul className={S.notes}>
        <li className={S.note}>
          · 模块开关（工具 / 预设 / 会话总线 / 闭环编排 / 设置，共五个）：改完需要<b>重启实例</b>才生效 ——
          宿主的规定是"改这些值不重挂插件"，而模块的装载发生在插件装载那一刻。
        </li>
        <li className={S.note}>
          · 「新建会话默认」是<b>即改即生效</b>的值型配置（宿主写入后不必重启）——
          它和上面的模块开关是两条不同的路径，别把两者的生效条件混起来。
        </li>
        <li className={S.note}>
          · 修改入口：本分区直接可改「新建会话默认」；其余字段仍可在插件管理页里
          由宿主自动生成的配置表单中改。
        </li>
      </ul>
    </section>
  )
}
