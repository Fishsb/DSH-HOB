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
import { useSyncExternalStore } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { getSettingsForm, subscribeSettingsForm } from './settings.ts'
import { S } from './panel-styles.ts'

/** 展示用的配置形状（只取本插件 schema 里真实存在的字段）。 */
interface PanelValue {
  modules?: Record<string, unknown>
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
          本插件把「与你说人话的助手」和「动手干活的开发」分成两个 Agent 预设，
          并提供一个只读文档、只写账本的工具面。下面是当前配置摘要。
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

      <ul className={S.notes}>
        <li className={S.note}>
          · 模块开关（工具 / 预设 / 设置）：改完需要<b>重启实例</b>才生效 ——
          宿主的规定是"改这些值不重挂插件"，而模块的装载发生在插件装载那一刻。
        </li>
        <li className={S.note}>
          · 修改入口：插件管理页里由宿主为每个插件自动生成的配置表单（本插件不自建编辑器）。
        </li>
      </ul>
    </section>
  )
}
