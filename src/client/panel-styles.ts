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
  `.dsh-hob-section{display:flex;flex-direction:column;gap:16px;max-width:720px;padding:8px 0;`,
  `font-size:13px;line-height:22px;color:var(--dsw-alias-label-primary)}`,

  // 分区标题：16px/500（宿主 settings.section 页的统一标题级）。
  `.dsh-hob-title{margin:0;font-size:16px;font-weight:500;line-height:24px}`,

  // 分区引言：14px + tertiary，正文之下、提示之上的中间层级。
  `.dsh-hob-intro{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary)}`,

  // 卡片：宿主设置页卡片的统一观感（半像素描边 + xl 圆角 + 卡片底）。
  `.dsh-hob-card{display:flex;flex-direction:column;padding:4px 16px;`,
  `border:0.5px solid var(--dsw-alias-settings-card-stroke);`,
  `border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill)}`,

  // 字段行：行间用半像素分隔线（宿主字段列表的同一手法），末行不留线。
  `.dsh-hob-row{display:flex;align-items:baseline;gap:16px;padding:12px 0}`,
  `.dsh-hob-row+.dsh-hob-row{border-top:0.5px solid var(--dsw-alias-border-l2)}`,

  // 字段名：定宽次级色；字段值：主色、可换行。
  `.dsh-hob-row-label{flex:none;width:76px;color:var(--dsw-alias-label-secondary)}`,
  `.dsh-hob-row-value{flex:1;min-width:0;overflow-wrap:anywhere}`,

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

  // ── 批 18 新增：「新建会话默认」卡片 ───────────────────────────────────
  // 卡片头：标题 + 一句边界说明（两者同排、允许换行）。
  `.dsh-hob-card-head{display:flex;flex-direction:column;gap:2px;padding:12px 0 4px}`,
  `.dsh-hob-card-title{font-weight:500;color:var(--dsw-alias-label-primary)}`,
  `.dsh-hob-card-note{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}`,
  // 选择控件：宿主设置页字段控件的观感（描边 + 圆角 + 卡片底 + 主色文字）。
  // ⚠ 令牌逐条取自宿主主题（`dsh-client-ui-theme`）：`--dsw-radius-md` 存在、
  //   `--dsw-radius-m` 不存在（曾写错，已按实况改正）。
  `.dsh-hob-select{min-width:220px;max-width:100%;height:28px;padding:0 6px;font:inherit;`,
  `color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);`,
  `border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md)}`,
  `.dsh-hob-select:disabled{opacity:.6;cursor:not-allowed}`,
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
  select: 'dsh-hob-select',
  subLabel: 'dsh-hob-sub-label',
  subNote: 'dsh-hob-sub-note',
  warn: 'dsh-hob-warn',
  ok: 'dsh-hob-ok',
  linkBtn: 'dsh-hob-link-btn',
} as const
