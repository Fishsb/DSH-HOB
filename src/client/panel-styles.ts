/**
 * 设置面板的样式（C1 · UI 优化轮）。
 *
 * ── 为什么是「字符串 + 运行时注入」而不是 `.module.css` ────────────────
 * 本项目 client 半边由 **tsdown 0.15** 打包（`tsdown.config.ts`）。
 * **实测**：`import css from './x.module.css'` 在 tsdown 0.15 下
 *   ① 不会把 CSS 并进 `lib/client.js`，而是吐出**独立的 `lib/client.css`**；
 *   ② 模块里拿到的是**空对象** `{}`（class 名映射全丢）。
 * 而 DSH 的插件路由**只服务** `<id>/client.js` 与 `client.<name>.js` 分片
 * （`dsh-client-modules/lib/index.js:169` 的 `CLIENT_CHUNK` 正则），
 * **不会**去服务 `lib/client.css` ⇒ 独立 CSS 文件**根本送不到浏览器**。
 * （复现见 `.hob/UI-REV-REPORT.md` 判据 4 的证据脚本。）
 *
 * ⇒ 采用**宿主自己产物的同一形态**：把 CSS 作为**字符串**打进 JS，
 *   运行时建 `<style>` 标签注入。宿主 `@deepseek-ai/dsh-client-ui-theme`
 *   的 `base.css`、以及 `ui-settings-general` / `ui-settings-models` /
 *   `@linxin666/dsh-remote-web-ui` 等插件的产物都是这个形态
 *   （编译期 `.module.css` → `const css = "…"` → 运行时 append）。
 *
 * ── 两条必须遵守的注入约定（宿主 loader 靠它们做归属与清理）────────────
 *   ① `style.dataset.plugin = <包名>` —— `dsh-client-modules` 热重载/卸载时
 *      按它调 `removeOwnedStyles(id)`（`lib/client.js:194-196`）；
 *      不标 ⇒ 标签成为**孤儿**，重载后新旧两份样式叠加。
 *   ② `style.dataset.pluginCss = <唯一 tagId>` —— 幂等键。宿主自己的产物用
 *      `if (document.querySelector("style[data-plugin-css=…]") === null)` 防重复注入，
 *      本文件照抄这条判据（**不是**自己发明的约定）。
 *
 * ── ⚠ 为什么 CSS 里**一个颜色/尺寸都不硬编码** ────────────────────────
 *   全部走宿主的 `--dsw-*` 设计令牌。这不是"自己写一套样式系统"，
 *   而是**跟宿主走**：下面这些声明是从宿主**自己的 `settings.section` 页**
 *   逐一对照抄来的（出处写在每个规则上方），因此主题切换/尺寸调整会
 *   自动跟随宿主，不会漂移。
 *
 * ── 第 8 轮（2026-10-10）：间距节奏与控件改宿主口径 ────────────────────
 *   用户报「间隔不一致，排版不美观，下拉框是默认样式不好看」。
 *   改法两条（都对宿主**逐条对照抄**，不自造）：
 *     ① 字段行从"标签定宽 76px + baseline 单行"改成宿主设置页的
 *        **字段式「标签在上、控件在下」**（`ui-settings-models` 的 `.zGbnIq_field`
 *        `:58`：`flex-direction:column;gap:6px`，标签 `.zGbnIq_fieldLabel`
 *        `font-size:12px;font-weight:500;line-height:18px`）；
 *     ② 分区 `gap` 16→12、卡片内边距/行间距对齐 `.zGbnIq_rowCard` 的
 *        `padding:12px 14px;gap:12px`（同处 `:58`）。
 *   ⚠ 原生 `<select>` 与它的 `.dsh-hob-select` 规则**已整体删除**（改宿主 `Menu`）——
 *     触发按钮的观感改由下面的 `.dsh-hob-trigger` 承担（逐条抄宿主模型选择器的 `.trigger`）。
 */
const PLUGIN_ID = 'dsh-hob'

/** 幂等键：与宿主产物同名规则 `style[data-plugin-css="<tagId>"]`。 */
const STYLE_TAG_ID = `${PLUGIN_ID}/settings-panel.css`

/**
 * 面板样式表。
 *
 * 出处（宿主 `settings.section` 各页的实际 CSS，逐条对照）：
 *   · `.dsh-hob-section`  ← `ui-settings-models` 的 `.zGbnIq_section`
 *                            + `ui-settings-account` 的 `.LcmJYa_section`
 *   · `.dsh-hob-title`    ← `ui-settings-models` 的 `.zGbnIq_title`
 *   · `.dsh-hob-intro`    ← `ui-settings-models` 的 `.zGbnIq_intro`
 *   · `.dsh-hob-card`     ← `ui-settings-account` 的 `.LcmJYa_card`
 *                            / `ui-settings-models` 的 `.zGbnIq_rowCard`
 *                            / `ui-settings-plugin-inventory` 的 `.qSYn7G_card`
 *   · `.dsh-hob-row*`     ← primitives `settings-form/fields.module.css` 的
 *                            `.field` / `.field + .field` / `.label` / `.hint`
 *   · `.dsh-hob-note`     ← 同上的 `.hint`
 *
 * ⚠ 字段行用 `baseline` 对齐、标签列定宽 `76px`：对应宿主 `.field` 的
 *   "标签在上、控件在下"两行式，在一个**只读**面板里压成一行的等价层级
 *   （没有可编辑控件，不需要为输入框留整行）。
 */
const CSS = [
  // 分区容器：纵向堆叠 + 最大宽度 720px（与 models 页同宽，避免宽屏拉散）。
  // ⚠ gap 16→12：对齐 `ui-settings-models` 的 `.zGbnIq_section{gap:12px}`
  //   （`dsh-client-ui-settings-models/lib/client.js:58`）。宿主设置页整页的节奏
  //   就是 12px 一档，本面板原来 16px ⇒ 与相邻分区"间隔不一致"（用户报障③）。
  `.dsh-hob-section{display:flex;flex-direction:column;gap:12px;max-width:720px;padding:8px 0;`,
  `font-size:13px;line-height:22px;color:var(--dsw-alias-label-primary)}`,

  // 分区标题：16px/500（宿主 settings.section 页的统一标题级）。
  `.dsh-hob-title{margin:0;font-size:16px;font-weight:500;line-height:24px}`,

  // 分区引言：14px + tertiary，正文之下、提示之上的中间层级。
  `.dsh-hob-intro{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary)}`,

  // 卡片：宿主设置页卡片的统一观感（半像素描边 + xl 圆角 + 卡片底）。
  // ⚠ 内边距 4px 16px → 12px 14px、行间距由 gap 承担：逐字对齐
  //   `.zGbnIq_rowCard{padding:12px 14px;gap:12px}`（同处 `:58`）。
  `.dsh-hob-card{display:flex;flex-direction:column;padding:12px 14px;gap:12px;`,
  `border:0.5px solid var(--dsw-alias-settings-card-stroke);`,
  `border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill)}`,

  // ── 字段式行（第 8 轮改）：**标签在上、控件在下** ───────────────────────
  // 逐字对齐宿主 `ui-settings-models` 的 `.zGbnIq_field{flex-direction:column;gap:6px}`
  // 与本仓既有的字段列表分隔线手法（`.dsh-hob-row+.dsh-hob-row` 的 l2 半像素线）。
  // ⚠ 原来的 `align-items:baseline;gap:16px` + 标签定宽 76px 是"单行两列"，
  //   与宿主字段式不是一套节奏（任务书 §2-C.2 明令按宿主改）。现改为纵向。
  `.dsh-hob-row{display:flex;flex-direction:column;gap:6px}`,
  `.dsh-hob-row+.dsh-hob-row{border-top:0.5px solid var(--dsw-alias-border-l2);padding-top:12px}`,

  // 字段名：**次级色 + 12px/500/18px** —— 宿主 `.zGbnIq_fieldLabel` 的同一级
  // （`font-size:12px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-secondary)`）。
  `.dsh-hob-row-label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px}`,
  // 字段值：主色、可换行（不再 `flex:1` —— 纵向布局里它本来就占满一行）。
  `.dsh-hob-row-value{min-width:0;overflow-wrap:anywhere}`,

  // 行内「状态点 + 文本」与「状态标记 chips」。
  `.dsh-hob-inline{display:inline-flex;align-items:center;gap:6px}`,
  `.dsh-hob-chips{display:inline-flex;flex-wrap:wrap;align-items:center;gap:6px}`,

  // 三条说明：**次要层级**（12px + tertiary），与宿主的 `.hint` 同级。
  `.dsh-hob-notes{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}`,
  `.dsh-hob-note{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}`,
  // 说明里的强调词提一级（secondary），避免"提示里全是灰的、重点看不见"。
  `.dsh-hob-note strong{font-weight:500;color:var(--dsw-alias-label-secondary)}`,

  // 屏读专用文本（宿主同款写法，见 `ui-settings-general` 的 `.VOzbGW_hiddenLabel`）。
  `.dsh-hob-sr-only{position:absolute;width:1px;height:1px;white-space:nowrap;overflow:hidden;clip:rect(0 0 0 0)}`,

  // ── 批 18 新增 / 第 8 轮改：「新建会话默认」卡片 ───────────────────────
  // 卡片头：标题 + 一句边界说明。
  // ⚠ 间距改由外层 `.dsh-hob-card` 的 `gap:12px` 统一承担 ⇒ 这里不再自加 padding
  //   （原来 `padding:12px 0 4px` 与外层 gap 叠成 16/4 两种间距 = 用户说的"间隔不一致"）。
  `.dsh-hob-card-head{display:flex;flex-direction:column;gap:2px}`,
  `.dsh-hob-card-title{font-weight:500;color:var(--dsw-alias-label-primary)}`,
  `.dsh-hob-card-note{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}`,

  // ── 下拉触发按钮（第 8 轮新增）：宿主 `ui-model-selection` 的 `.trigger` 同源 ──
  // 逐条出处：`dsh-client-ui-model-selection/lib/client.js:330` 的 CSS 串
  //   `.trigger{border-radius:var(--dsw-radius-sm);height:28px;color:var(--dsw-alias-label-secondary);
  //    cursor:pointer;background:0 0;border:none;align-items:center;gap:4px;padding:0 4px 0 8px;
  //    font-size:13px;font-weight:400;line-height:20px;display:flex}`
  //   + `:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}`
  //   + `:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,…)}`
  //   + `.chevron{color:var(--dsw-alias-label-caption);transition:transform .12s}` /
  //     `.chevronOpen{transform:rotate(180deg)}`
  // ⚠ 这是**宿主自己的度量**，不是自造；`max-width` 用 360px 同 `.trigger`。
  `.dsh-hob-trigger{min-width:0;max-width:min(360px,100%);height:28px;color:var(--dsw-alias-label-secondary);`,
  `cursor:pointer;background:0 0;border:none;outline:none;align-items:center;gap:4px;`,
  `padding:0 4px 0 8px;font:inherit;font-size:13px;font-weight:400;line-height:20px;display:inline-flex}`,
  `.dsh-hob-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}`,
  `.dsh-hob-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}`,
  `.dsh-hob-trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}`,
  `.dsh-hob-trigger-value{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}`,
  `.dsh-hob-trigger-icon{flex:none;color:var(--dsw-alias-menu-icon)}`,
  `.dsh-hob-chevron{color:var(--dsw-alias-label-caption);flex:none;transition:transform .12s}`,
  `.dsh-hob-chevron-open{transform:rotate(180deg)}`,
  // 菜单行内的次级文本（预设「不可用」、模型 id、档位说明）——
  // 用宿主菜单的 caption 层级（`Menu.module.css` 的 `.shortcut` 用同一令牌）。
  `.dsh-hob-item-note{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}`,
  // 行内小标签（如「思考档位」）与次级说明。
  `.dsh-hob-sub-label{color:var(--dsw-alias-label-secondary);flex:none}`,
  `.dsh-hob-sub-note{color:var(--dsw-alias-label-tertiary)}`,
  // 如实告警 / 成功：用宿主**既有**的状态色令牌，不自造色。
  // ⚠ 宿主没有 `state-danger-primary`；承载"错误"语义的是 `state-error-primary`
  //   （实测 `ui-settings-models` / `ui-plugin-manager` 都用它），故照它写。
  `.dsh-hob-warn{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.6}`,
  `.dsh-hob-ok{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:1.6}`,
  // 链接式按钮（「重新读取」）：无边框、按下划线示意可点。
  // ⚠ 链接色令牌名是 `--dsw-alias-link`（不是 `label-link`，实测）。
  `.dsh-hob-link-btn{padding:0;font:inherit;color:var(--dsw-alias-link);background:none;border:0;cursor:pointer;text-decoration:underline}`,
  `.dsh-hob-link-btn:disabled{color:var(--dsw-alias-label-tertiary);cursor:default;text-decoration:none}`,
].join('')

/**
 * 幂等注入面板样式。
 *
 * ⚠ 必须**同时**写 `data-plugin` 与 `data-plugin-css`（理由见文件头注释）：
 *   前者让热重载能清理，后者防重复注入。
 * ⚠ 无 `document` 时静默返回 `null`（SSR / 测试环境不该因此崩）。
 *
 * @returns **本次新建**的 `<style>` 元素；已存在（幂等命中）或没有 document 时返回 `null`。
 *   ⚠ 返回它而不是 `void`，是为了让调用方把"谁建的谁拆"写清楚：
 *   `apply()` 里挂在 `ctx.effect` 的清理函数上。这样即使宿主的
 *   `removeOwnedStyles()` 没跑到，样式也不会**跨热重载累积**成孤儿标签。
 */
export function ensurePanelStyles(): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_TAG_ID)}]`) !== null) return null
  const tag = document.createElement('style')
  tag.dataset.plugin = PLUGIN_ID
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
  return tag
}

/** 外壳类名常量（拼错会静默无样式，故集中一处）。 */
export const S = {
  section: 'dsh-hob-section',
  title: 'dsh-hob-title',
  intro: 'dsh-hob-intro',
  card: 'dsh-hob-card',
  row: 'dsh-hob-row',
  rowLabel: 'dsh-hob-row-label',
  rowValue: 'dsh-hob-row-value',
  inline: 'dsh-hob-inline',
  chips: 'dsh-hob-chips',
  notes: 'dsh-hob-notes',
  note: 'dsh-hob-note',
  srOnly: 'dsh-hob-sr-only',
  cardHead: 'dsh-hob-card-head',
  cardTitle: 'dsh-hob-card-title',
  cardNote: 'dsh-hob-card-note',
  // ⚠ `select` 已**删除**（第 8 轮：原生 `<select>` 全换成宿主 `Menu`）——
  //   保留这个键会让"零原生 select"的机检与代码对不上（键在、用法没了）。
  trigger: 'dsh-hob-trigger',
  triggerValue: 'dsh-hob-trigger-value',
  triggerIcon: 'dsh-hob-trigger-icon',
  chevron: 'dsh-hob-chevron',
  chevronOpen: 'dsh-hob-chevron-open',
  itemNote: 'dsh-hob-item-note',
  subLabel: 'dsh-hob-sub-label',
  subNote: 'dsh-hob-sub-note',
  warn: 'dsh-hob-warn',
  ok: 'dsh-hob-ok',
  linkBtn: 'dsh-hob-link-btn',
} as const
