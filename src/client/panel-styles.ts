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

  // ── 下拉触发按钮 ────────────────────────────────────────────────────────
  // ⚠⚠ **第 9 轮订正（用户报障「按钮没有凸显样式」）—— 上轮抄错了对象。**
  //   上轮逐条抄的是 `ui-model-selection` 的 `.trigger`，而那份样式里写的是
  //   `background:0 0;border:none;padding:0 4px 0 8px`（**无边框无底色**）。
  //   它在宿主里之所以看着像个控件，是因为**嵌在输入框内部**，那圈描边与底色
  //   由**外层**提供 —— `dsh-client-ui-primitives/lib/Input.module.css:1-14` 的 `.wrap`：
  //     `height:32px;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l4);
  //      border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)`
  //   我们把那个按钮**单独**放进设置页 ⇒ **丢了外层那圈描边与底色** ⇒ 看着就是一段灰字。
  //   ⇒ **该抄的是宿主"设置页控件"的度量**：
  //     `dsh-client-ui-primitives/lib/settings-form/fields.module.css`
  //       `.input` **`:107-117`**：`height:34px;padding:0 12px;`
  //         `border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);`
  //         `background:var(--dsw-alias-bg-layer-3);font-size:13px;line-height:1.5;color:label-primary`
  //       `.input:focus-visible` **`:119-122`**：`outline:none;border-color:state-business-primary`
  //       `.input:disabled` **`:124-127`**：`color:label-tertiary;cursor:default`
  //   旁证：宿主 `ui-settings-models` 页自己的下拉也是 `input + selectInput` 的带边框组合
  //     （该文件 CSS 串内 `:1358`/`:1767`/`:2288` 三处用的是同一个 `input` 类）。
  //   ⚠ **文字层级**照旧用次级色（`label-secondary`）保持"这是当前值"的观感，
  //     但**边框与底色必须有**（用户要的就是这个）；箭头保留（第 8 轮既有行为）。
  //   ⚠ 颜色尺寸一律走 `--dsw-*`，**不自造令牌**（上面各条都取自宿主原文）。
  `.dsh-hob-trigger{min-width:180px;max-width:min(360px,100%);height:34px;box-sizing:border-box;`,
  `color:var(--dsw-alias-label-secondary);cursor:pointer;`,
  `border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);`,
  `background:var(--dsw-alias-bg-layer-3);`,
  `align-items:center;gap:4px;padding:0 12px;`,
  `font:inherit;font-size:13px;font-weight:400;line-height:1.5;display:inline-flex}`,
  // hover：底色提亮（宿主设置页按钮的同一手法 —— 交互底色令牌）。
  `.dsh-hob-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}`,
  // focus-visible：宿主 `.input:focus-visible` 的**换描边色**写法（不是自造的 box-shadow）。
  `.dsh-hob-trigger:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}`,
  `.dsh-hob-trigger:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}`,
  `.dsh-hob-trigger-value{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}`,
  `.dsh-hob-trigger-icon{flex:none;color:var(--dsw-alias-menu-icon)}`,
  `.dsh-hob-chevron{color:var(--dsw-alias-label-caption);flex:none;transition:transform .12s}`,
  `.dsh-hob-chevron-open{transform:rotate(180deg)}`,
  /**
   * 项目选择器的行内箭头：收起朝右、展开朝下。
   * ⚠ `<summary>` 的原生三角已用内联 `listStyle:none` 去掉，只保留这一个箭头。
   */
  `details[data-dsh-hob="stages-ledgers"] > summary > span[aria-hidden="true"]{transition:transform .12s}`,
  `details[data-dsh-hob="stages-ledgers"][open] > summary > span[aria-hidden="true"]{transform:rotate(90deg)}`,
  /**
   * ══ 项目选择器 = **一行触发 + 浮层菜单**（2026-11-08 第 2 次修正）══════════
   *
   * 病（真机 DOM 核对）：上一版 `<details>` 把菜单留在**正常流**里 ⇒ 展开后把下面
   *   在途需求 / 五步主线整体往下推，菜单里又是一整列账本（还带“空账本”二级折叠）
   *   ⇒ 用户看到的就是“一行控件里又套了一份旧列表”。
   *
   * 改法（三条都不引新令牌，全部用宿主既有 `--dsw-*`）：
   *   ① 容器 `position:relative`，菜单 `position:absolute;top:100%` **浮在内容之上**；
   *   ② 菜单 `max-height` + `overflow-y:auto`：窄侧栏也不撑爆面板；
   *   ③ 触发块做成宿主设置页输入框的同款描边/底色（`.dsh-hob-trigger` 已按该度量抄过），
   *      并把「项目 / 名字 / 单元数 / 箭头」压成**同一行**（⛔ 不再各占一行）。
   */
  `.dsh-hob-ledger-picker{position:relative;display:block}`,
  `.dsh-hob-ledger-trigger{height:30px;box-sizing:border-box;align-items:center;gap:6px;`,
  `padding:0 10px;border:0.5px solid var(--dsw-alias-border-l4);`,
  `border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);`,
  `font-size:13px;font-weight:600;line-height:1.5;white-space:nowrap;`,
  `overflow:hidden;text-overflow:ellipsis}`,
  `.dsh-hob-ledger-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}`,
  `.dsh-hob-ledger-trigger:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}`,
  `.dsh-hob-ledger-label{color:var(--dsw-alias-label-tertiary);font-weight:400;flex:none}`,
  `.dsh-hob-ledger-name{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis}`,
  `.dsh-hob-ledger-units{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;flex:none}`,
  `.dsh-hob-ledger-caret{color:var(--dsw-alias-label-caption);font-size:12px;flex:none;transition:transform .12s}`,
  /** 浮层：贴住触发块下沿，宽度跟随触发块，最高 60vh（超出内部滚动）。 */
  `.dsh-hob-ledger-menu{position:absolute;left:0;right:0;top:100%;z-index:30;margin-top:4px;`,
  `box-sizing:border-box;max-height:min(60vh,320px);overflow-y:auto;padding:4px;`,
  `display:flex;flex-direction:column;gap:2px;`,
  `border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);`,
  `background:var(--dsw-alias-bg-layer-1);box-shadow:0 6px 18px rgba(0,0,0,.18)}`,
  `.dsh-hob-ledger-row{display:flex;justify-content:space-between;align-items:baseline;gap:8px;`,
  `width:100%;box-sizing:border-box;padding:4px 8px;font:inherit;font-size:13px;text-align:left;`,
  `color:var(--dsw-alias-label-primary);background:transparent;border:0;border-radius:var(--dsw-radius-sm,4px);cursor:pointer}`,
  `.dsh-hob-ledger-row:hover{background:var(--dsw-alias-interactive-bg-hover)}`,
  `.dsh-hob-ledger-row[data-selected="true"]{background:var(--dsw-alias-interactive-bg-active)}`,
  `.dsh-hob-ledger-row[data-selected="true"] .dsh-hob-ledger-row-name{font-weight:600}`,
  `.dsh-hob-ledger-row-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
  `.dsh-hob-ledger-row-meta{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px}`,
  `.dsh-hob-ledger-group{border-top:0.5px solid var(--dsw-alias-border-l2)}`,
  `.dsh-hob-ledger-group-summary{cursor:pointer;padding:4px 8px;color:var(--dsw-alias-label-tertiary);font-size:12px}`,
  `.dsh-hob-ledger-note{padding:4px 8px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}`,
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

  // ══════════════════════════════════════════════════════════════════════
  // 新建 Hob 会话：命令入口 + 双轴弹窗（2026-10-22）
  // ══════════════════════════════════════════════════════════════════════
  //
  // ⚠ 入口**不遮挡**：dock 固定右下角、`pointer-events:none`（容器不接事件 ⇒
  //   点空白处会**穿透**到下面界面）；只有按钮自己 `pointer-events:auto`。
  //   ⚠ 不占满屏、不盖导航 —— 这是任务书"不得遮挡现有导航"的落点。
  `.dsh-hob-entryDock{position:fixed;right:16px;bottom:16px;z-index:40;display:flex;gap:8px;align-items:center}`,
  `.dsh-hob-entryBtn{pointer-events:auto;padding:6px 12px;font:inherit;font-size:12px;line-height:1.6;`
    + `color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);`
    + `border:0.5px solid var(--dsw-alias-interactive-bg-hover);border-radius:999px;cursor:pointer;`
    + `box-shadow:0 2px 8px rgba(0,0,0,0.16)}`,
  `.dsh-hob-entryBtn:hover{background:var(--dsw-alias-interactive-bg-active)}`,
  `.dsh-hob-entryBtn:focus-visible{outline:2px solid var(--dsw-alias-link);outline-offset:2px}`,

  // 弹窗：遮罩 + 卡片。⚠ **不写死宽度**（窄屏会溢出的根源）⇒ 用 `min()` + 百分比。
  `.dsh-hob-dialogBackdrop{position:fixed;inset:0;z-index:50;display:flex;align-items:center;`
    + `justify-content:center;padding:16px;background:rgba(0,0,0,0.32)}`,
  `.dsh-hob-dialog{width:min(560px, 100%);max-width:100%;max-height:calc(100vh - 32px);overflow:auto;`
    + `box-sizing:border-box;padding:16px;display:flex;flex-direction:column;gap:12px;`
    + `background:var(--dsw-alias-bg-elevated, var(--dsw-alias-interactive-bg-hover));`
    + `color:var(--dsw-alias-label-primary);border-radius:12px;`
    + `box-shadow:0 8px 32px rgba(0,0,0,0.24)}`,
  `.dsh-hob-dialog:focus{outline:none}`,
  `.dsh-hob-dialogTitle{margin:0;font-size:16px;font-weight:600;line-height:1.5}`,
  `.dsh-hob-dialogLead{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}`,
  `.dsh-hob-fieldset{margin:0;padding:8px;display:flex;flex-direction:column;gap:6px;`
    + `border:0.5px solid var(--dsw-alias-interactive-bg-hover);border-radius:8px}`,
  `.dsh-hob-legend{padding:0 4px;font-size:12px;font-weight:600}`,
  `.dsh-hob-select{width:100%;box-sizing:border-box;padding:6px 8px;font:inherit;font-size:12px;`
    + `color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);`
    + `border:0.5px solid var(--dsw-alias-interactive-bg-hover);border-radius:6px}`,
  `.dsh-hob-select:focus-visible{outline:2px solid var(--dsw-alias-link);outline-offset:1px}`,
  `.dsh-hob-option{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;font-size:12px;line-height:1.6;cursor:pointer}`,
  `.dsh-hob-optionLabel{font-weight:600}`,
  `.dsh-hob-optionHint{color:var(--dsw-alias-label-secondary)}`,
  `.dsh-hob-option[data-emphasis="strict"] .dsh-hob-optionHint{color:var(--dsw-alias-label-primary)}`,
  /**
   * ⚠ 「暂未开放」那两档的**视觉置灰**（2026-10-22 · 用户就地纠正后）：
   *   ⚠ 语义**不靠颜色**表达 —— 真禁用在 `input.disabled`、文字标在 `optionBadge`；
   *     这里只是让"点不了"**看起来**也像点不了（避免用户反复点）。
   */
  `.dsh-hob-option[data-unavailable="true"]{cursor:not-allowed;opacity:.55}`,
  `.dsh-hob-optionBadge{font-size:11px;padding:0 6px;border-radius:8px;border:1px solid currentColor;color:var(--dsw-alias-label-secondary)}`,
  `.dsh-hob-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}`,
  `.dsh-hob-btn{padding:6px 12px;font:inherit;font-size:12px;border-radius:6px;cursor:pointer;`
    + `color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);`
    + `border:0.5px solid var(--dsw-alias-interactive-bg-hover)}`,
  `.dsh-hob-btn:disabled{cursor:default;opacity:0.55}`,
  `.dsh-hob-btnPrimary{color:var(--dsw-alias-label-on-brand, #fff);background:var(--dsw-alias-brand-primary, #4d6bfe);`
    + `border-color:transparent}`,
  `.dsh-hob-btn:focus-visible{outline:2px solid var(--dsw-alias-link);outline-offset:2px}`,
  `.dsh-hob-error{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-state-error-primary)}`,
  // ⚠ 失败时必须同时给出**重试按钮**（2026-10-24 · 修复单第 7 条）⇒ 错误行与按钮排一行，
  //   窄屏会换行（flex-wrap）而不是把按钮挤出可视区。
  `.dsh-hob-errorBox{display:flex;flex-wrap:wrap;align-items:center;gap:8px}`,
  `.dsh-hob-success{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-state-success-primary)}`,
  `.dsh-hob-created{padding:6px 8px;display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:12px;`
    + `border:0.5px solid var(--dsw-alias-interactive-bg-hover);border-radius:6px}`,
  `.dsh-hob-createdId{font-family:var(--ds-font-family-code, monospace);font-size:12px}`,
  `.dsh-hob-createdHint{color:var(--dsw-alias-label-secondary)}`,

  // ⚠ **窄屏适配**（任务书要求"移动窄视口无遮挡/不重叠"）：
  //   ① ≤480px：入口贴底边、按钮左右留白收紧；弹窗内边距与字号收紧；
  //   ② 极窄（≤360px）：动作按钮**整行铺满**，⛔ 不并排挤成一行。
  `@media (max-width: 480px){`
    + `.dsh-hob-entryDock{right:8px;bottom:8px}`
    + `.dsh-hob-dialog{padding:12px;gap:8px;border-radius:10px}`
    + `.dsh-hob-fieldset{padding:6px}`
    + `.dsh-hob-actions{justify-content:stretch}`
    + `.dsh-hob-btn{flex:1 1 auto;min-width:44px;min-height:44px}`
    + `}`,
  `@media (max-width: 360px){`
    + `.dsh-hob-actions{flex-direction:column;align-items:stretch}`
    + `.dsh-hob-dialogLead,.dsh-hob-option{font-size:11px}`
    + `}`,
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
