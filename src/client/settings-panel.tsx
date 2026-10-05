/**
 * C1 · 设置面板（Client 半边）—— 本插件的**独立设置分区**。
 *
 * ── 它做什么 ──────────────────────────────────────────────────────────
 *   ① 在宿主设置界面里挂一个**自己的分区**（槽位 `settings.section`，
 *      id = `dsh-hob`），用户点进去能看到本插件；
 *   ② 显示**配置摘要**（人格 / 入口 / 投递 / 模块开关），数据经宿主原生
 *      `configForms`（Remote RPC）读取 —— **不自造 HTTP 路由**（E-10）；
 *   ③ 把两条**用户必须知道**的语义写在界面上：
 *      · 「值型字段改了**当场生效**」；
 *      · 「**模块开关**改了要**重启实例**才生效」（原因见下方注释）；
 *   ④ 提供「去哪改」的指引 —— 真正的改值入口是宿主在**插件管理页**
 *      自动生成的表单（本插件不自建编辑器，§5.4）。
 *
 * ── 为什么不自己画表单 ────────────────────────────────────────────────
 *   宿主 `SettingsForms.describe()` 会**自动生成**可编辑表单
 *   （本插件 `autoGenerate=true`），字段的中文标签/说明来自 `config.ts` 的
 *   `.description()`。自建编辑器是重复造轮子，而且会与宿主校验/冲突检测脱节
 *   （宿主有 `SettingsConflictError` 的 revision 机制）。
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
 */
import { useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { getSettingsForm, subscribeSettingsForm } from './settings.ts'

/** 展示用的配置形状（只取本插件 schema 里真实存在的字段）。 */
interface PanelValue {
  persona?: unknown
  showEntry?: unknown
  delivery?: unknown
  modules?: Record<string, unknown>
}

/** 解 volatile ref（`{ get() }`）或普通值。 */
function deref(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function') {
    try { return (value as { get: () => unknown }).get() } catch { return undefined }
  }
  return value
}

/** 把值安全地转成可读文本。 */
function text(value: unknown, fallback = '(未读到)'): string {
  const v = deref(value)
  if (v === undefined) return fallback
  if (typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? '开' : '关'
  try { return JSON.stringify(v) } catch { return String(v) }
}

/**
 * 模块开关 → 一句人话。
 *
 * ⚠ **只列设置页真正呈现的三个开关**（工具 / 预设 / 设置）。
 *   `bus` 那个开关**刻意不列** —— 用户 2026-10-05 定（UD-25 / UD-27）：
 *   M3 挂起中，"开了也不起作用"，露出来会误导用户以为"开了就有效"。
 *
 * ⚠ **本注释里也不写它的界面显示名**（只写配置键 `bus`）：
 *   client 产物**保留注释**，一旦把那个中文名写进来，
 *   "`lib/client.js` 里该字样零命中"这条判据就会失效
 *   —— 判据是**渲染文本**零命中，而注释不是渲染文本，混在一起就说不清。
 *   （历史坑：上一版注释一边说"刻意不写"，一边在上一行写了出来，
 *     结果产物里命中 1 处 —— 正是本注释要避免的那种自相矛盾。见 EXPERIENCE.md E-71。）
 *
 * ⚠ 注意 `bus` **仍在 `modules` 里**（配置键保留给 M3），所以**不能用
 *   "遍历 m 的所有键"** 来生成摘要 —— 那样会把它又漏出来。
 *   必须用**显式白名单**（本常量），这也是"掩底隐藏"能成立的原因。
 */
const VISIBLE_SWITCHES: Record<string, string> = {
  tools: '工具', preset: '预设', settings: '设置',
}

function moduleSummary(modules: Record<string, unknown> | undefined): string {
  const m = deref(modules) as Record<string, unknown> | undefined
  if (m === undefined || m === null) return '(未读到)'
  const parts = Object.entries(VISIBLE_SWITCHES)
    .filter(([k]) => k in m)
    .map(([k, name]) => `${name}${m[k] ? '开' : '关'}`)
  return parts.length > 0 ? parts.join(' · ') : '(未读到)'
}

/** 一行「标签：内容」。 */
function Row(props: { label: string; content: string }): ReactElement {
  return (
    <div className="dsh-hob-settings-row">
      {props.label}：{props.content}
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
  const snapshot = form?.getSnapshot?.()
  const status = snapshot?.status ?? 'unavailable'
  const value = (snapshot?.value ?? {}) as PanelValue

  const statusText =
    status === 'ready' ? '已就绪'
      : status === 'loading' ? '读取中…'
        : '不可用（未读到本插件的配置面）'

  return (
    <div className="dsh-hob-settings-panel">
      <div>dsh-hob · 人机翻译层</div>
      <div>
        本插件把「与你说人话的助手」和「动手干活的开发」分成两个 Agent 预设，
        并提供一个只读文档、只写账本的工具面。下面是当前配置摘要。
      </div>

      <Row label="配置状态" content={statusText} />
      <Row label="人格档位" content={text(value.persona)} />
      <Row label="显示入口" content={text(value.showEntry)} />
      <Row label="投递方式" content={text(value.delivery)} />
      <Row label="模块开关" content={moduleSummary(value.modules)} />

      <div className="dsh-hob-settings-note">
        · 人格档位 / 显示入口 / 投递方式：在设置里改完<b>当场生效</b>。
      </div>
      <div className="dsh-hob-settings-note">
        · 模块开关（工具 / 预设 / 设置）：改完需要<b>重启实例</b>才生效 ——
        宿主的规定是"改这些值不重挂插件"，而模块的装载发生在插件装载那一刻。
      </div>
      <div className="dsh-hob-settings-note">
        · 修改入口：插件管理页里由宿主为每个插件自动生成的配置表单（本插件不自建编辑器）。
      </div>
    </div>
  )
}
