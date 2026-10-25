/**
 * client 半边入口 —— 注册本插件的**设置分区**（C1）。
 *
 * ── 本文件做什么 ──────────────────────────────────────────────────────
 *   把 {@link SettingsPanel} 挂到宿主设置界面的槽位 `settings.section`，
 *   使本插件在设置界面里有一个自己的分区（用户点得进去、看得见）。
 *
 * ── 与「宿主自动生成的表单」的分工（重要，避免重复造轮子）────────────
 *   · **改值** 走宿主在**插件管理页**为每个插件自动生成的表单
 *     （`autoGenerate=true`，字段标签来自 `config.ts` 的 `.description()`）；
 *   · **本分区** 提供人话摘要 + 两条语义说明（尤其"模块开关要重启"这条）。
 *   两者读的是**同一个** `configForms` 快照，不会不一致。
 *
 * ⚠ 三条已验证的纪律（全部来自旧项目实测，详见 `.hob/EXPERIENCE.md`）：
 *
 *   ① `apply` 里要用 `ctx.slots` 就必须 `export const inject = ['slots']`
 *      （cordis 的 inject 是**加载门禁**：列进来的服务缺失会让组合不挂载）。
 *
 *   ①-b ⚠ **门禁不是"到处都要声明"**：`ctx.get(name)` 与 `ctx.inject([name], cb)`
 *      都**不需要**模块级声明，也**不会**抛 `cannot get property "…" without inject`
 *      —— 会抛的只有**属性访问** `ctx.name`。
 *      第 3 轮实测的原始缺陷正是这个：`catalog.ts` 先 `ctx.get('remote')`（免 inject，OK），
 *      再**属性访问** `remote.agentPresets` ⇒ 抛
 *      `cannot get property "remote.agentPresets" without inject`
 *      （cordis `src/reflect.ts:144` 造错 / `:163` 抛出）。
 *      ⚠ **不许**用"把两个命名空间加进本文件的模块级 `inject`"去修 ——
 *      那是**加载门禁**：`dsh-api-remotes` 缺席时整块 client 插件不激活，
 *      **设置分区会整体消失**（回归，见 E-02 / E-41）。
 *      现改为：**订阅**用 `bindCatalog()`（`ctx.inject` 反应式，①-b 的 ①）、
 *      **读数**用 `ctx.get('<逐字名>')`（免 inject）—— 全程无属性访问。
 *
 *   ①-c 另一个同族实测（本轮顺手修）：`ctx.inject(...)` 的返回值是 **Fiber**，
 *      **不可调用**（`typeof === 'object'`，要 `off.dispose?.()`）——
 *      写成 `off?.()` 会在卸载/热重载时抛 `TypeError: off is not a function`。
 *      本文件与 `settings.ts` 的清理函数都已按 `dispose()` 写。
 *
 *   ② `ctx.slots.register` **必须带 `name` 字段**（= 槽位名），缺它报
 *      "slot undefined is not declared"；list 槽还必须给**唯一 `id`** ——
 *      复用官方 id 会顶掉那一格，新增自己的 id 才是"加一个条目"。
 *
 *   ③ 一切资源注册都要挂 `ctx.effect`（或用 `ctx.slots.inject` —— 它本身就是
 *      反应式+自动清理的封装），热重载/卸载时自动清理。
 *
 * ⚠ 另一条坑：**client 半边收不到插件 config**。
 *   客户端挂载路径是 `loader.create({ name: id })` —— 只传 name，没有 config。
 *   所以本文件 `apply` **只有 ctx 一个参数**；配置必须启动后经 DSH 原生
 *   `configForms`（Remote RPC）拉取，**不要**自己造 HTTP 路由（E-10）。
 */
import { SettingsPanel, bindLocale } from './settings-panel.tsx'
import * as React from 'react'
import {
  HOB_CREATE_ENTRY_ID, HOB_CREATE_OVERLAY_ID, HOB_OVERLAY_ORDER,
  HobCreateCommandEntry, createDialogState, HobCreateOverlayLive,
  HobCreatedNoticeLive, HOB_CREATED_NOTICE_ID,
} from './create-hob-dialog.tsx'
import { bindSettingsForm } from './settings.ts'
import { bindCatalog, setCatalogContext } from './catalog.ts'
import { ensurePanelStyles } from './panel-styles.ts'
import { installHobUnselectedGate, notifySessionSelected } from './hob-unselected-gate.tsx'

/** 包名：同时作为模块 id、槽位条目来源标识、settings namespace。 */
const PACKAGE_NAME = 'dsh-hob'

/**
 * 槽位依赖：`slots` 服务（宿主 UI 槽位机制）。
 *
 * ⚠ 少了这一行，`apply` 里访问 `ctx.slots` 会抛
 *   "cannot get property slots without inject"。
 */
/**
 * client 半边需要的宿主服务。
 *
 * ── `uiWorkspace` 是 2026-10-22 新增（**创建成功后真的进得去**）─────────────
 *   宿主公开声明（`dsh-cordis-client-runner/lib/client.js` 的声明表，原文）：
 *     · `uiWorkspace.openSession(target: SessionTarget): void`
 *       —— "Select a Session and **show its Conversation** as one UI navigation action."
 *     · `type SessionTarget = SessionId | SubagentAddress`
 *   ⇒ **传 sessionId 就能把该会话显示到主视图**，不要求它已有第一条消息。
 *   ⚠ 这是"建完用户能进去"的唯一**受支持**路径：空白会话被宿主**有意**从列表里
 *     过滤掉（本仓 `bus.ts` 有同口径记录）⇒ "让用户按 id 去列表找"是**假入口**。
 *   ⚠ 提供方 = `@deepseek-ai/dsh-client-ui-workspace`（有 `dsh.client` 段与 `./client` 导出）
 *     ⇒ 可列入 `package.json` 的 `dsh.client.inject`。
 */
export const inject = ['slots', 'uiWorkspace']

export function apply(ctx: any): void {
  ctx.logger?.debug?.(`[${PACKAGE_NAME}] client 半边已加载`)

  // 样式只注入一次（幂等），并挂在 `ctx.effect` 上：
  // 卸载/热重载时把**本次新建的那一个** `<style>` 摘掉，避免累积成孤儿标签。
  // ⚠ 宿主 `client-modules` 也会按 `data-plugin` 清理（`removeOwnedStyles`），
  //   两条路径互不冲突：谁都可能先跑，先跑的那个删掉、后跑的查询命中 null 即跳过。
  // ⚠ 为什么不是 `.module.css`：见 `./panel-styles.ts` 文件头（tsdown实测依据）。
  ctx.effect(() => {
    const tag = ensurePanelStyles()
    return () => { tag?.remove() }
  }, `${PACKAGE_NAME}: settings panel styles`)

  // 先把 configForms 反应式绑上：面板渲染时读它。
  // ⚠ 用 `ctx.inject` 反应式订阅，**不能**在 apply 里一次性 `ctx.get` ——
  //   fiber 并行激活，一次性取值会在服务就绪前拿到 undefined 且**无报错**（E-01）。
  ctx.effect(
    () => bindSettingsForm(ctx),
    `${PACKAGE_NAME}: configForms binding`,
  )

  // 候选来源（宿主预设清单 / 模型目录）经两个 Remote 命名空间读。
  // ⚠ 顺序有意义：先 `bindCatalog`（反应式订阅）再交 ctx —— 订阅是"到齐就重读"的
  //   驱动，而 `setCatalogContext` 里的首读在命名空间未就绪时会如实记成可重试的失败。
  //   两条合起来：命名空间**来得早** ⇒ 首读即成；**来得晚** ⇒ 订阅触发自动补读。
  ctx.effect(
    () => bindCatalog(ctx),
    `${PACKAGE_NAME}: remote catalog binding`,
  )
  setCatalogContext(ctx)

  // 语言服务（第 8 轮新增）：**反应式**绑定 + 在本插件 ns 注册中英词典。
  // ⚠ 用 `ctx.inject(['locale'], cb)` 而**不是**模块级 `inject` ——
  //   后者是**加载门禁**：`dsh-client-locale` 缺席会让**整个 client 插件不激活**
  //   ⇒ 设置分区整体消失（回归，见 E-02 / E-41 与上面 ① 的说明）。
  //   本插件的文案在语言服务缺席时走本地词典（固定中文），**面板照常可用**。
  ctx.effect(
    () => bindLocale(ctx),
    `${PACKAGE_NAME}: locale binding`,
  )

  // ⚠ `ctx.slots.inject` 本身就是"等槽位存在再注册"的反应式封装：
  //   槽位缺席时**不注册、不报错**（宿主其它界面插件未装载时也不该炸）。
  /**
   * ══════════════════════════════════════════════════════════════════════
   * **新建 Hob 会话的双轴弹窗（本插件自己的命令入口）**
   * ══════════════════════════════════════════════════════════════════════
   *
   * ── 2026-10-22 改道（按 Hob 裁决）──────────────────────────────────────
   *   上一版注册在 `conversation.hero.agentPreset`（**`kind:"single"`**）上，
   *   声称"低 order 就能并排"。⚠ 两处都错：
   *     ① `single` 槽第二条目**会 shadow** 宿主的预设选择器，而且**动态注册
   *        优先级更低 ⇒ 因而胜出**（宿主官方类型文档原话）⇒ 等于**顶掉**宿主 UI；
   *     ② 入口的 gating 读 `state.preset()`，而它**永远是 `undefined`**
   *        （`createDialogState()` 不传实参 + 全 client 零处 `setPreset(`）
   *        ⇒ **入口永不出现**。
   *
   * ── 现在的挂法（三条，⛔ 缺一条都算"假入口"）────────────────────────────
   *   ① **只注册 `shell.overlay`**（`kind:"list"` / `scope:"root"`，**无条件渲染**）
   *      —— 用**两个自有 id**：一个放命令入口、一个放弹窗；
   *   ② **不碰任何 single 槽**（宿主预设选择器、workspace、composer 一格不动）
   *      ⇒ **普通预设的创建流程完全不变**；
   *   ③ **不自动弹窗**：`HobCreateCommandEntry` 是普通按钮，**点了才 open()**。
   *
   * ── ⚠ 真机未验（必须如实说）───────────────────────────────────────────
   *   本文件只保证"注册到 list 槽 + 不抢 single 槽"这在**源码与宿主声明**上成立；
   *   **实际像素/焦点/窄屏**由 `scripts/check-hob-create-dom.mjs` 的**真 DOM 挂载**测，
   *   而**真实宿主里的渲染**（要重启）**本轮仍未验** —— 见回报的分层。
   */
  const dialogState = createDialogState()

  // ① 命令入口（⚠ 自有 id，list 槽，可叠加；点它才打开弹窗）
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: HOB_CREATE_ENTRY_ID,
    // ⚠ list 槽的排序：排在宿主自己的 overlay 之后（不抢先）
    order: HOB_OVERLAY_ORDER,
  }, () => React.createElement(HobCreateCommandEntry, { state: dialogState })))

  // ② 弹窗本体（⚠ 另一个自有 id；关闭时渲染 null，⛔ 不留空壳）
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: HOB_CREATE_OVERLAY_ID,
    order: HOB_OVERLAY_ORDER + 1,
  }, () => React.createElement(HobCreateOverlayLive, {
    state: dialogState,
    /**
     * ⚠ **"选完"要广播给未选横幅**（2026-10-24 · 修复单第 11 条）。
     *
     * ── 为什么需要这条线 ────────────────────────────────────────────────
     *   `GateMemory.forget()` 此前**生产零调用** ⇒ 用户在弹窗里选完之后，
     *   "本会话已自动弹过"的记录会留到刷新页面：任何一次重新挂载都会再判一次，
     *   而判定用的 `recorded` 可能还是旧值 ⇒ **横幅不消失 / 再弹一次**。
     *   ⇒ 弹窗成功（新建模式与已有会话模式都会调 `onCreated`）⇒ 广播一次
     *     ⇒ 挂着的横幅 `forget(id)` + 重读三态 ⇒ 横幅当场消失。
     *   ⚠ 只在**真正写成功**时触发（`onCreated` 就是那条路径，`cancel()` 不走它）。
     */
    onCreated: (sessionId: string) => { notifySessionSelected(sessionId) },
  })))

  /**
   * ③ **成功结果条**（2026-10-22 新增 · Hob 指出的缺口就是这里）。
   *
   * ── 上一版为什么是死路 ──────────────────────────────────────────────
   *   `HobCreatedNotice` 组件**存在但从未被注册**（生产里没有任何渲染点），
   *   而弹窗成功时 `markCreated` 后**立刻 close** ⇒ 用户看到的是"窗关了"，然后
   *   **什么也没有**；再加上空白会话被宿主从列表过滤 ⇒ 会话**根本找不到**。
   *
   * ── 现在接的是什么 ────────────────────────────────────────────────
   *   挂进同一个 `shell.overlay`（自有 id）⇒ 弹窗关掉之后**它还在**，
   *   显示"已创建 + 一个**真按钮**"，按钮调宿主**公开的**
   *   `uiWorkspace.openSession(sessionId)` —— 宿主声明原文：
   *   "Select a Session and show its Conversation as one UI navigation action."
   *   ⚠ `SessionTarget = SessionId | SubagentAddress` ⇒ 传 sessionId 就够，
   *     **不要求该会话已有第一条消息**（空白会话也能被 retain + 显示）。
   *   ⛔ 不再是"按 id 去列表找"那种假入口（空白会话列表里没有）。
   */
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: HOB_CREATED_NOTICE_ID,
    order: HOB_OVERLAY_ORDER + 2,
  }, () => React.createElement(HobCreatedNoticeLive, {
    state: dialogState,
    /**
     * ⚠ **真实导航**：`ctx.uiWorkspace` 由宿主服务提供（`inject` 已声明）。
     *   ⚠ 取不到就**降级为"如实说明看不见"**（⛔ 不伪造一个能点的按钮）——
     *     那条降级文案在 `HobCreatedNotice` 里。
     */
    openSession: (sessionId: string) => {
      try {
        const svc = ctx.uiWorkspace
        if (typeof svc?.openSession !== 'function') {
          ctx.logger?.warn?.('[dsh-hob] uiWorkspace.openSession 不可用 ⇒ 创建成功后无法自动打开会话')
          return
        }
        svc.openSession(sessionId)
      } catch (e) {
        ctx.logger?.warn?.(`[dsh-hob] openSession 失败：${String((e as Error)?.message ?? e)}`)
      }
    },
  })))

  /**
   * ④ **宿主原生新建的 Hob 会话 → 自动拉起 + 未选可见横幅**（2026-10-22 · 第 3 轮）。
   *
   * ── 为什么需要它（前两轮定下的边界就在这里收窄）────────────────────────
   *   前两条注册的入口都是**用户点了才有**。而宿主**原生**新建（Web UI 新建按钮 /
   *   `Ctrl+N` / 看板建卡）建出来的 Hob 会话**不经过本插件创建链** ⇒ 用户永远
   *   看不到选档弹窗，会话静默落在"未选"状态。
   *   ⇒ 本模块挂到 `conversation.hero.options`（`kind:"list"` / `scope:"session"`），
   *     在**空白会话被宿主打开时**检测"这是 Hob 且还没选"，然后：
   *       · 显示一条**可见横幅**（说明尚未选择、暂不推进）；
   *       · 条件满足时**自动**打开选档弹窗（同一会话只自动弹一次）。
   *
   * ⚠⚠ **它今天真的会读、会自动弹**（2026-10-24 据实订正 —— 上一版这段写的是
   *   「通道只有 issue/create/enums、今天不会自动弹」，**已与事实不符**，⛔ 别照那段读）：
   *   "还没选"的判据 `recorded` 在 host 半边的策略服务里
   *   （`src/session-policy-service.ts:70/835`），客户端经**本插件自己的**只读路由读它：
   *     `POST /api/dsh-hob/session-policy`（`src/modules/session-policy-route.ts`），
   *     `action` 两个（`:256-258`）：`read`（缺省）与 `write`（写已存在的会话）。
   *   ⚠ 它与 `POST /api/dsh-hob/session-create` 是**两条**路由 —— 后者仍只认
   *     `issue` / `create` / `enums`（别把两条记成一条，那正是上一版误写的来源）。
   *   ⇒ 路由回 `unrecorded` ⇒ 横幅 + 自动弹一次；回 `recorded` ⇒ 什么都不渲染；
   *     回 `unknown`（服务缺席 / 判不出 / 网络失败）⇒ **不渲染、不弹**（fail-closed）。
   *   ⛔ 这里**不伪造** `'unrecorded'` 让功能"看起来完成"。
   *
   * ⚠ 槽只承载**触发器 + 横幅**，弹窗本体仍在上面 `shell.overlay` 那层
   *   ⇒ "这个槽很窄放不下弹窗"不构成障碍。
   * ⚠ 不碰任何 single 槽；非 Hob 会话**一行都不渲染、一次都不请求**。
   */
  installHobUnselectedGate(ctx, {
    /**
     * ⚠⚠ **本轮打通的两个函数**（2026-10-22 第 4 轮 · 任务书 §二③）：
     *
     *   ① `readRecorded` —— 走**新的**只读路由 `POST /api/dsh-hob/session-policy`
     *      （`src/modules/session-policy-route.ts`）。⚠ 不传就用模块内置的同款默认实现
     *      （同一 URL），这里显式传只是为了"接线处一眼可见"。
     *   ② `openForSession` —— 用 `dialogState.openForSession(id)`：
     *      ⚠ 它打开的是**已有会话模式**（确认后**零 create**），
     *      ⛔ **不是** `dialogState.open()`（那会让用户确认后多出一个重复会话）。
     *
     * ⚠ 判据仍是三态、且由 gate 自己把 `'unknown'` 当"不打扰"：
     *   本处**不**给任何默认值、**不**把 `'unknown'` 改写成 `'unrecorded'`。
     */
    openForSession: (sessionId: string) => {
      dialogState.openForSession(sessionId)
    },
    autoOpen: true,
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    // 唯一 id：新增一格，不复用官方 id（复用会顶掉那一格）。
    id: PACKAGE_NAME,
    // 排在宿主自带分区之后，不抢位。
    order: 50,
    // 分区标题 —— **就是包名本身**（用户 2026-10-05 定，UD-24）：
    // 「dsh-hob」，明确不要中文别名；便于与插件管理页里的包名对上。
    label: () => 'dsh-hob',
  }, SettingsPanel))
}
