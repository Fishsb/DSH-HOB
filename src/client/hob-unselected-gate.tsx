/**
 * **宿主原生新建的 Hob 会话 → 自动拉起选档弹窗 + 未选可见横幅**（2026-10-22 · 第 3 轮）。
 *
 * ══ 它解决的是哪条边界 ═════════════════════════════════════════════════════
 *   前两轮的结论是：选档弹窗**只在用户点本插件入口时**才弹（`HOB_CREATE_ENTRY_ID`）。
 *   而**宿主原生新建**（Web UI 新建按钮 / `Ctrl+N` / 看板建卡 / CLI）建出来的 Hob 会话
 *   **不经过本插件的创建链** ⇒ 用户永远看不到那个弹窗，会话静默落在「未选」状态。
 *
 *   ⇒ 本模块补的就是这一段：**在宿主原生新建的 Hob 会话上，把"你还没选"这件事
 *     变成看得见、点得开的界面**。
 *
 * ══ 挂在哪、为什么 ════════════════════════════════════════════════════════
 *   `conversation.hero.options`（`kind:"list"` / `scope:"session"`）。
 *   证据（宿主 0.2.1-rc.2，`dsh-client-ui-conversation/lib/client.js`）：
 *     · 槽声明 `:19766-19769` —— `{ kind: "list", scope: "session" }`
 *     · 渲染点 `:17812-17815` ——
 *       `sessionId === void 0 ? null : <div class=heroOptions>{renderSlot("conversation.hero.options", {})}</div>`
 *     · 何时进入该分支 `:17545` ——
 *       `hero = sessionId === void 0 || shellPhase === "blank" && (openState === "open" || summaryBlank === true)`
 *     · 空白会话会被打开 `dsh-client-ui-workspace/lib/client.js:1489`
 *       `this.replaceMain(sessionId, navigation, "reveal", beforeOpen)`
 *   ⇒ **新建出来的空白会话正好落在这个槽里**，这就是"自动检测"的落点。
 *
 *   ⚠ 槽本身只承载**触发器 + 横幅**，⛔ 不承载弹窗本体（弹窗仍渲染在
 *     `shell.overlay` 那一层）。所以"这个槽很窄、放不下弹窗"不构成障碍 ——
 *     我们只往里面放一行提示 + 一个按钮。
 *   ⚠ 该槽 official doc 原文：*"Compact options right-aligned in the New Session row
 *     after the workspace and preset controls; rendered only with a Session."*
 *     （`dsh-cordis-client-runner/lib/client.js:3146`）⇒ 它确实是一条**行内**位置。
 *
 * ══ 判定条件（⚠ 三态，不是布尔）════════════════════════════════════════════
 *   要「自动弹/显示横幅」，必须同时满足：
 *     ① 该会话的 `agentPreset` 投影 === `'Hob'`（宿主的 `agentPreset` 投影，
 *        定义见 `dsh-agent-preset-registry/lib/types/session.js:20-27`：
 *        `init: header.agentPreset ?? null`，之后被 `agent-preset/selected` 推进）；
 *     ② 该会话的策略记录 `recorded === false`（`src/session-policy-service.ts:70`
 *        有这个字段，`:835` 是它的赋值点 `reading?.file.sessions[sid] !== undefined`）。
 *
 *   ⚠⚠ **② 走的是本插件自己的只读路由**（2026-10-24 据实订正 —— 上一版这段注释
 *      写的是「通道只有 issue/create/enums、今天不会自动弹」，**已与事实不符**）：
 *     · 插件的策略服务只是 `ctx.provide(SESSION_POLICY_SERVICE, …)`
 *       （`src/session-policy-service.ts:977`）⇒ **宿主内部服务，客户端调不到**；
 *     · 本插件**没有**注册任何 `sessionProjections.register(...)`（全仓 0 命中）
 *       ⇒ `recorded` 不在任何客户端可读投影里；
 *     · **但是**本插件登记了一条独立路由 `POST /api/dsh-hob/session-policy`
 *       （`src/modules/session-policy-route.ts`），它按 `action` 分发**两个**动作
 *       （`session-policy-route.ts:256-258`）：
 *         · `read`（缺省） ⇒ 只回答"这个会话选过没有"（线格式 `{ok,state,reason}`）；
 *         · `write`       ⇒ 给**已存在的会话**写两项选择（弹窗的已有会话模式用）。
 *       注意：**它不是** `session-create` 那条路由 —— 那条仍只认
 *       `issue` / `create` / `enums`，两条路由各管各的动作。
 *     · 宿主 `remote.session` 命名空间仍只暴露 `create` / `selectModel` / `rename` 等
 *       （`dsh-api-session-controller/lib/index.js:755/793/827`），**没有策略读**
 *       ⇒ 这条路只能走本插件自己的路由。
 *   ⇒ 本模块把 ② 做成**注入的读取器 + 三态**：
 *       `'recorded'` ⇒ 不渲染任何东西（已选过）；
 *       `'unrecorded'` ⇒ 显示横幅（+ 允许自动弹）；
 *       `'unknown'` ⇒ **不渲染、不弹**（fail-closed：判不出就不打扰用户）。
 *     ⚠ 默认读取器真的会读（见 {@link defaultPolicyRecordReader}）⇒ **自动弹是通的**：
 *       路由回 `unrecorded` 就弹一次；`unknown`（服务缺席 / 判不出）则不弹。
 *       ⛔ 仍然**不伪造**一个假的 'unrecorded' 来"让功能看起来完成了"。
 *
 * ══ 为什么不直接调 `state.open()` ══════════════════════════════════════════
 *   现有 `DialogState.open()` 打开的是**"新建会话"**模式
 *   （`src/client/create-hob-dialog.tsx:600-620` 的 `createDialogState()`，只有
 *    `isOpen/open/close/created/markCreated/clearCreated/subscribe` 七个成员，
 *   **没有"为某个已有会话选档位"的入口**）。
 *   ⇒ 在宿主原生会话上直接 `open()` 会让用户看到"新建 Hob 会话"弹窗，
 *     点确认会**再建一个会话** —— 那不是"给这个会话选档位"，是**建重复会话**。
 *   ⛔ 因此本模块**只**通过注入的 `openForSession` 打开；该能力缺席时
 *     **只显示横幅**（横幅上的按钮此时给出可读说明，⛔ 不假装能开）。
 *
 * ══ 边界（如实说）════════════════════════════════════════════════════════
 *   · 只覆盖**有界面**的路径。CLI / headless / 跨实例**没有槽可渲染** ⇒ 本模块
 *     对它们**完全无效**（那条口径是"未显式给两项 ⇒ 可读拒绝"，落在创建侧，不是这里）。
 *   · 宿主直建但**不是 Hob** 的会话：`agentPreset !== 'Hob'` ⇒ 一行都不渲染。
 *   · 旧会话已迁移（`legacy-migrated`）：其 `recorded` 为 `true` ⇒ 不渲染。
 *     ⚠ 但若读取器给 `'unknown'`（默认情形），也**不渲染** —— 同样不打扰。
 *   · 本模块**不创建、不删除、不修改**任何会话；它只显示与转交点击。
 */

import * as React from 'react'

/** list 槽里的条目 id（⚠ 自有 id，⛔ 不复用宿主或他插件的 id）。 */
export const HOB_GATE_SLOT_ID = 'dsh-hob.unselected-gate'
/** 常驻轮询实例（会话输入区 list 槽；不渲染横幅）。 */
export const HOB_GATE_POLL_SLOT_ID = 'dsh-hob.unselected-gate-poll'

/** 排序：排在宿主自己的 hero 选项**之后**（不抢先，⛔ 不遮挡）。 */
export const HOB_GATE_ORDER = 900

/** 本模块的样式标签 id（幂等注入，卸载时摘掉）。 */
const STYLE_TAG_ID = 'dsh-hob/unselected-gate.css'

/**
 * Hob 预设的 id —— ⚠ **必须**取自唯一来源 `src/shared/planning-preset.ts`。
 *
 * ── 2026-10-22 第 4 轮订正（`check:presets` ⑦ 组当场抓获）──────────────
 *   上一轮这里写的是**字面值** `'Hob'`，理由是"client 半边不该 import 可能会拖
 *   host 依赖的模块"。⚠ 那个理由是**错的**：
 *     · `src/shared/planning-preset.ts` 是**纯常量文件**（零 import）⇒ 对 client 安全；
 *     · 而且 `src/client/create-hob-dialog.tsx:38` **早就**在 client 半边 import 它了
 *       ⇒ "client 不能 import"这个前提与事实不符；
 *     · 真正的代价是：两处字面值 ⇒ **改名时必漏一处**，而漏掉的那处**不会报错**，
 *       只会静默地把 Hob 会话认成"非 Hob"⇒ 永不弹窗（最难查的那种失败）。
 *   ⇒ 改为 import；`HOB_PRESET_ID_FOR_MATCH` 保留为**别名导出**（兼容既有引用，
 *     同时把"这是同一个值的引用"这件事写在类型系统里）。
 */
import { HOB_PRESET_ID } from '../shared/planning-preset.ts'
// ⚠ 取词**只有一个入口**（`t()`）—— 本文件只把自己这屏的中英词条当**入参**灌进去，
//   ⛔ 不自建第二套查表（2026-10-24 · 修复单第 6 条：此前这里全是中文字面量）。
import { addDictionaryLayer, getLocaleSnapshot, subscribeLocale, t } from './i18n.ts'

/** ⚠ 别名（= `HOB_PRESET_ID`，⛔ 不是第二处字面值）。 */
export const HOB_PRESET_ID_FOR_MATCH = HOB_PRESET_ID

/**
 * 策略记录的**三态**（⚠ 不是布尔）。
 *
 * `'unknown'` 是**默认且安全**的一档：判不出 ⇒ 不渲染、不弹、不打扰。
 * ⚠ 为什么不允许"判不出就当成未选"：那会在**已选过**的会话上每次开都弹一次，
 *   属于本仓反复禁止的"把判不出当结论"。
 */
export type PolicyRecordState = 'recorded' | 'unrecorded' | 'unknown'

/** 读一个会话的策略记录状态（⚠ 注入，便于机检用假实现跑真逻辑）。 */
export type PolicyRecordReader = (sessionId: string) => Promise<PolicyRecordState>

/**
 * **默认读取器**：走本插件自己的通道。
 *
 * ⚠ 现状（2026-10-24 据实订正）：本插件**已有**读动作 ——
 *   `POST /api/dsh-hob/session-policy` 的 `action: 'read'`（缺省动作，
 *   见 `src/modules/session-policy-route.ts:256-258` 的分发），线格式 `{ok,state,reason}`。
 *   ⚠ 注意别把它与 `POST /api/dsh-hob/session-create` 混起来：那条只认
 *     `issue` / `create` / `enums`（没有读）。上一版这里写"通道没有读动作"是把
 *     两条路由记混了 —— 照那段注释，会让人以为自动弹是死的（实际是通的）。
 *   ⇒ 服务缺席 / 回 `unknown` / 网络失败 ⇒ `'unknown'` ⇒ 不打扰（fail-closed）。
 *   ⛔ 不许在这里"猜"一个答案（例如按 agentPreset 就当成 unrecorded）——
 *     那正好把"已选过"的会话也弹一遍。
 */
export const defaultPolicyRecordReader: PolicyRecordReader = async (sessionId) => {
  try {
    const res = await fetch('/api/dsh-hob/session-policy', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'read', sessionId }),
    })
    const parsed: any = await res.json().catch(() => undefined)
    if (parsed?.ok !== true) return 'unknown'
    // ⚠ 线格式四态 ⇒ 客户端三态（⚠ 唯一映射点，与 host 侧共用 `toClientState` 的语义）
    const state = String(parsed.state ?? '')
    if (state === 'recorded') return 'recorded'
    if (state === 'unrecorded') return 'unrecorded'
    // 'not-applicable' | 'unknown' | 任何意外的值 ⇒ 不打扰
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * **「这个会话被选档闸拦下过没有」的读取器**（2026-10-29 · 第 332 轮 · 包 cb）。
 *
 * ══ 为什么必须**单独**问这一句（本单最要紧的一条分界）════════════════════
 *   `defaultPolicyRecordReader` 回的是"**选过档没有**"。⚠ 新建的空白 Hob 会话
 *   一打开就是 `unrecorded` —— 拿它当"该弹窗"的证据 ⇒ **一进会话就弹**
 *   （骚扰，本单明令禁止）。本单要的是"**用户刚点过发送、被拦了**"这个**一次性事件**。
 *   ⇒ 服务端在 `reject` 时落一条"被拦过"（`src/server/policy-block-log.ts`），
 *     客户端来这里问。**两根轴，⛔ 不能合并。**
 *
 * ══ 三态（⚠ 与服务端 `handlePolicyBlockQuery` 逐字对齐）════════════════════
 *   · `'blocked'` —— 被拦过且尚未选档 ⇒ **该弹**；
 *   · `'clear'`   —— 没被拦过 / 已选档 / 记录过期 ⇒ 不弹；
 *   · `'unknown'` —— 判不出 ⇒ **不弹**（fail-closed：⛔ 判不出就不打扰）。
 *
 * ══ ⚠ 为什么用轮询而不是订阅（本单 §二 第 2 条允许二选一）══════════════════
 *   宿主对 `reject` **不 emit 任何事件**（`agent/pre-step` 是 `waterfall`，
 *   宿主 `runtime-types.d.ts:304 / :269-271`）⇒ 客户端**没有可订阅的东西**。
 *   而本插件自己的通道是 `POST`（不是 SSE/WebSocket）⇒ 只能轮询。
 *   ⚠ 频率取 **4 秒**：用户点发送到弹窗的容忍延迟是秒级；4s 下每会话每分钟 15 次
 *     POST，且**只在该会话是 Hob 且尚未选档时**才轮询（见组件里 `needPoll` 的早退）。
 *   ⛔ 不整页轮询：每个挂载的 gate 只查**自己的 `sessionId`**。
 */
export type PolicyBlockReader = (sessionId: string) => Promise<'blocked' | 'clear' | 'unknown'>

/** 轮询间隔（ms）—— ⚠ 改这里必须同步改回报里的口径说明。 */
export const BLOCK_POLL_INTERVAL_MS = 4000

export const defaultPolicyBlockReader: PolicyBlockReader = async (sessionId) => {
  try {
    const res = await fetch('/api/dsh-hob/session-policy', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'blocked', sessionId }),
    })
    const parsed: any = await res.json().catch(() => undefined)
    if (parsed?.ok !== true) return 'unknown'
    const state = String(parsed.state ?? '')
    if (state === 'blocked') return 'blocked'
    if (state === 'clear') return 'clear'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * **"同一会话只自动弹一次"的记忆**（⚠ 模块级，跨挂载存活）。
 *
 * 为什么要模块级而不是组件内 ref：
 *   `conversation.hero.options` 的条目会随会话切换/重渲染**反复挂载**；
 *   用组件内 ref 的话"切走再切回"会再弹一次 —— 那正是任务书点名不许的。
 * ⚠ 键 = `sessionId`；⚠ 不按 `agentPreset` 分键（同一会话的预设可能变，但那不该让它再弹）。
 * ⚠ 这是**进程内内存**，⛔ 不落盘（刷新页面后会重来一次 —— 如实记在回报里）。
 */
export interface GateMemory {
  /** 该会话是否**已经**自动弹过（只读）。 */
  hasAutoOpened(sessionId: string): boolean
  /**
   * 取一次"是否该自动弹"，**并在返回 true 时立刻记下**（原子，避免重复挂载竞态）。
   * @returns 首次 ⇒ true；之后一律 false。
   */
  takeAutoOpen(sessionId: string): boolean
  /**
   * 忘记一个会话的"已自动弹过"记录。
   *
   * ⚠ **生产调用点**（2026-10-24 · 修复单第 11 条）：弹窗写成功 ⇒
   *   `index.ts` 的 `onCreated` ⇒ {@link notifySessionSelected} ⇒ 横幅订阅回调里调它，
   *   同时重读三态（横幅当场消失）。改前它**零生产调用** ⇒ 记录留到刷新页面。
   * ⚠ 测试也用它造"没弹过"的初态。
   */
  forget(sessionId: string): void
  /** 当前记了多少个会话（⚠ 只给机检断言"没有无限增长"）。 */
  size(): number
}

/** 造一份记忆（⚠ 每次 `apply` 一份，⛔ 全局单例 —— 热重载时跟着本 fiber 走）。 */
export function createGateMemory(): GateMemory {
  const opened = new Set<string>()
  return {
    hasAutoOpened: (sessionId) => opened.has(sessionId),
    takeAutoOpen: (sessionId) => {
      if (sessionId === '' || opened.has(sessionId)) return false
      opened.add(sessionId)
      return true
    },
    forget: (sessionId) => { opened.delete(sessionId) },
    size: () => opened.size,
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 本屏的**词条数据**（中 / 英，键集必须完全一致）
// ══════════════════════════════════════════════════════════════════════════
/**
 * ⚠ 只是灌进 `i18n.ts` 的**入参**（`addDictionaryLayer('hob-gate', …)`），
 *   ⛔ 不是第二套查表实现 —— 取词入口始终只有 `t()` 一个。
 *
 * ⛔ 三条硬约束（任务书 §二 B）：
 *   ① 不出现内部配置值（不写 `ledger` / `workspace` 这类枚举字面值）；
 *   ② 不用字面 markdown 标记（不出现 `**`、`##` 之类）；
 *   ③ 若出现「完全权限」字样，紧邻必须带完整边界句 —— 本文案**整体不提那三个字**。
 */
const HOB_GATE_ZH: Record<string, string> = {
  'gate.banner': '本会话尚未选择可读范围，暂不推进。',
  'gate.banner.selected': '本会话已选择档位，可随时重新选择。',
  'gate.btn': '选择可读范围',
  'gate.btn.selected': '重新选择档位',
  'gate.btn.unavailable': '选择入口暂不可用',
  'gate.alert.unavailable': '本版尚未接上为此会话选档位的入口。',
}

const HOB_GATE_EN: Record<string, string> = {
  'gate.banner': 'This session has not chosen a readable range yet, so it does not advance.',
  'gate.banner.selected': 'This session already has levels selected; you can change them at any time.',
  'gate.btn': 'Choose the readable range',
  'gate.btn.selected': 'Change the levels',
  'gate.btn.unavailable': 'The chooser is not available',
  'gate.alert.unavailable': 'This version has no entry point yet for choosing this session’s levels.',
}

// ⚠ 模块加载时就灌进去（⛔ 不放在 apply 里：语言服务的 inject 回调可能更早就触发，
//   晚登记会让宿主那条取词路径看不到本屏词条 ⇒ 横幅永远中文）。
addDictionaryLayer('hob-gate', { zh: HOB_GATE_ZH, en: HOB_GATE_EN })

/**
 * **"这个会话已经选完了"的进程内广播**（2026-10-24 · 修复单第 11 条）。
 *
 * ── 修的是什么 ────────────────────────────────────────────────────────
 *   `GateMemory.forget()` 在此之前**生产零调用**（只有测试与注释提到它）⇒
 *   用户在弹窗里选完之后，`takeAutoOpen` 记下的那条"已自动弹过"会**留到刷新页面**。
 *   后果不是"多弹一次"这么轻：选完之后如果因为任何原因重新挂载（切会话再切回 /
 *   宿主重渲染），`recorded` 仍读到旧值（或读到 `unrecorded`）⇒ 横幅还在 /
 *   会再弹一次，而用户明明已经选过了。
 *   ⇒ 写入成功时由 {@link notifySessionSelected} 广播一次，挂着的横幅据此：
 *     ① `memory.forget(id)`（清掉"弹过"的记录）；② 重新读一次三态（横幅随即消失）。
 *
 * ⚠ 为什么用模块级广播而不是把回调层层传下去：`DialogState`（弹窗）与
 *   `HobUnselectedGate`（横幅）挂在**两个不同的槽**上，没有共同的 React 父组件
 *   —— 与 `createDialogState()` 用模块内订阅的理由同源。
 * ⚠ 只在**真正写成功**时广播（`onCreated`），⛔ 取消/失败一律不广播：
 *   失败后横幅必须留着（那正是"还没选"的事实）。
 */
const selectedListeners = new Set<(sessionId: string) => void>()

/**
 * 广播"某会话已选完"（⚠ 由 `index.ts` 接在弹窗的 `onCreated` 上）。
 *
 * @param sessionId - 刚写完两项选择的会话 id。
 */
export function notifySessionSelected(sessionId: string): void {
  if (typeof sessionId !== 'string' || sessionId === '') return
  for (const fn of [...selectedListeners]) {
    try { fn(sessionId) } catch { /* 一个订阅者出错不影响其他人 */ }
  }
}

/** 横幅上用的类名（⚠ 集中一处，拼错会静默无样式）。 */
export const GATE_CLASS = {
  root: 'dsh-hob-gate',
  text: 'dsh-hob-gateText',
  btn: 'dsh-hob-gateBtn',
} as const

const GATE_CSS = [
  // ⚠ 只占**行内**一格：不设 position:fixed、不吃全屏、不遮挡导航。
  //   父容器是宿主的 `.heroOptions`（`display:flex; align-items:center; margin-left:auto`）。
  `.${GATE_CLASS.root}{display:flex;align-items:center;gap:8px;min-width:0;`
    + `font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,inherit)}`,
  `.${GATE_CLASS.text}{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
  `.${GATE_CLASS.btn}{flex:none;padding:4px 10px;font:inherit;font-size:12px;line-height:1.6;`
    + `color:var(--dsw-alias-label-primary,inherit);`
    + `background:var(--dsw-alias-interactive-bg-hover,transparent);`
    + `border:0.5px solid var(--dsw-alias-state-warn-secondary,currentColor);border-radius:999px;cursor:pointer}`,
  `.${GATE_CLASS.btn}:focus-visible{outline:2px solid var(--dsw-alias-link,currentColor);outline-offset:2px}`,
].join('')

/**
 * 幂等注入本模块的样式（⚠ 与 `panel-styles.ts` 同一套做法，但**独立成一份**）。
 *
 * ⚠ 为什么不并进 `panel-styles.ts`：那个文件正被**另一实施会话**改
 *   （第 3 轮开工时 `git diff --stat` 显示 +74 行）。本模块自带样式 ⇒
 *   **零冲突**，卸载时也只摘自己这一个 `<style>`。
 */
export function ensureGateStyles(): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_TAG_ID)}]`) !== null) return null
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-hob'
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = GATE_CSS
  document.head.appendChild(tag)
  return tag
}

/**
 * 横幅文案。
 *
 * ⛔ 三条硬约束（任务书 §二 B）：
 *   ① 不出现内部配置值（不写 `ledger` / `workspace` 这类枚举字面值）；
 *   ② 不用字面 markdown 标记（不出现 `**`、`##` 之类）；
 *   ③ 若出现「完全权限」字样，紧邻必须带完整边界句 —— 本文案**整体不提那三个字**，
 *      所以不触发该约束（更省事也更不容易说错）。
 */
/**
 * ⚠ 2026-10-24（修复单第 6 条）：这三句原先是**硬编码中文 export 常量**，
 *   本文件不 import 语言服务 ⇒ 切英文后横幅仍是中文。
 *   现在它们是**键**（`GATE_TEXT_KEY` 等），渲染期经 `t()` 现读 —— 切语言当场变。
 *   ⚠ 旧名（`GATE_TEXT` 等）**保留为 getter 函数**（`gateText()`），不是字面量：
 *     机检与别的调用点若还按"值是字符串"读，会读到**当前语言**的文案（比字面量更准）。
 */
const GATE_TEXT_KEY = 'gate.banner'
const GATE_TEXT_SELECTED_KEY = 'gate.banner.selected'
const GATE_BTN_KEY = 'gate.btn'
const GATE_BTN_SELECTED_KEY = 'gate.btn.selected'
const GATE_BTN_UNAVAILABLE_KEY = 'gate.btn.unavailable'

/** 横幅主文案（⭐ 每次调用现读语言）。 */
export function gateText(selected = false): string { return t(selected ? GATE_TEXT_SELECTED_KEY : GATE_TEXT_KEY) }
/** 按钮文案（可开时；selected=true ⇒ 二次切换话术）。 */
export function gateButtonText(selected = false): string { return t(selected ? GATE_BTN_SELECTED_KEY : GATE_BTN_KEY) }
/** 读取器缺席/判不出时的按钮说明（诚实话术，⛔ 不假装能开）。 */
export function gateButtonUnavailableText(): string { return t(GATE_BTN_UNAVAILABLE_KEY) }

/** 组件属性（⚠ 全部注入，便于机检用假实现跑真逻辑）。 */
export interface HobUnselectedGateProps {
  /** 槽给的本会话 id（`scope:'session'` ⇒ 一定有；缺席 ⇒ 不渲染）。 */
  sessionId?: string
  /**
   * 本会话的 `agentPreset` 投影值。
   * ⚠ 由 live 包装器用 `useProjection('agentPreset')` 取；机检直接传。
   */
  agentPreset?: string | null
  /** 策略记录读取器（默认走本插件通道；缺席 ⇒ 'unknown' ⇒ 不渲染）。 */
  readRecorded?: PolicyRecordReader | null
  /**
   * **「被选档闸拦下过没有」读取器**（2026-10-29 · 第 332 轮 · 包 cb）。
   * ⚠ 与上面的 `readRecorded` 是**两根轴**（选过没有 vs 拦过没有）。
   *   缺席 ⇒ 用 {@link defaultPolicyBlockReader}；显式 `null` ⇒ 不轮询（机检用）。
   */
  readBlocked?: PolicyBlockReader | null
  /** 轮询间隔（ms；机检可调小以免等 4 秒）。 */
  blockPollMs?: number
  /**
   * **为某个已有会话**打开选档弹窗。
   * ⚠ 现状缺席 —— 现有 `DialogState` 没有这个入口（详见文件头"为什么不直接调 state.open()"）。
   *   缺席 ⇒ 只显示横幅，按钮给"暂不可用"的说明。
   */
  openForSession?: (sessionId: string) => void
  /** 只自动弹一次的共享记忆（⚠ 必须由调用方注入同一份，跨挂载才有效）。 */
  memory?: GateMemory
  /**
   * 是否允许**本组件自动打开**弹窗（默认 true；机检可关掉以单独测横幅）。
   *
   * ⚠ 2026-10-29（TASK-Q · `CHG-215`）：这个开关现在只 gate「`blocked` 轮询开窗」那一条
   *   （改前它 gate 的是「挂载即弹」，那段已废）。语义没变：`false` ⇒ 自动开窗一次都不发生；
   *   ⚠ 用户点横幅按钮仍能开（那是用户动作，不归本开关管）。
   */
  autoOpen?: boolean
  /** 是否渲染可见横幅；仅轮询实例传 false（默认 true）。 */
  showBanner?: boolean
}

/**
 * 判据①：该会话是不是 Hob。
 *
 * ⚠ 用**严格相等**比较具体预设 id，⛔ 不用大小写不敏感/前缀匹配 ——
 *   那会把 `Hob-other` 之类的自建预设也算进来（误弹）。
 */
export function isHobPreset(agentPreset: string | null | undefined): boolean {
  return agentPreset === HOB_PRESET_ID_FOR_MATCH
}

/**
 * 纯判定：给定三态，是否应该**显示横幅**。
 *
 * ⚠ 只有 `'unrecorded'` 才显示；`'recorded'`（已选）与 `'unknown'`（判不出）
 *   都**不显示** —— 后者是 fail-closed 的落点（判不出就不打扰）。
 * ⚠ 抽成纯函数是为了让机检能直接对四类会话逐条断言，而不必造 DOM。
 */
export function shouldShowGate(
  agentPreset: string | null | undefined,
  recorded: PolicyRecordState,
): boolean {
  /** 横幅入口保留；发送被拦后的自动弹窗由常驻轮询负责（见 `showBanner`）。 */
  /**
   * 入口在**未选**和**已选**两种状态下都存在：
   * · 未选：提示尚未选择；
   * · 已选：提示可以重新选择（二次切换能力）。
   * `unknown` 仍不显示（判不出不打扰）。
   */
  return isHobPreset(agentPreset) && (recorded === 'unrecorded' || recorded === 'recorded')
}

/**
 * **横幅 + 自动拉起**（组件本体）。
 *
 * 时序（⚠ 每一步都影响判据，别改顺序）：
 *   ① 没有 `sessionId` ⇒ 立刻 `null`（槽是 `scope:'session'`，正常一定有）；
 *   ② 不是 Hob ⇒ 立刻 `null`，**不发起任何请求**（⛔ 非 Hob 会话零打扰）；
 *   ③ 读三态（异步）⇒ `'recorded'`/`'unknown'` ⇒ `null`；
 *   ④ `'unrecorded'` ⇒ 显示横幅；若允许自动弹且本会话没弹过 ⇒ 打开一次。
 */
export function HobUnselectedGate(props: HobUnselectedGateProps): any {
  // ⚠ 订阅语言变化只为触发重渲染（用的是 i18n 已有的 subscribeLocale，
  //   ⛔ 不是第二套订阅）；横幅挂在 `conversation.hero.options`，不在设置面板的子树里
  //   ⇒ 不自己订阅的话，切语言后横幅仍是旧语言（第 6 条）。
  React.useSyncExternalStore(subscribeLocale, getLocaleSnapshot, getLocaleSnapshot)
  const h = React.createElement
  const sessionId = props.sessionId
  const memory = props.memory
  const [recorded, setRecorded] = React.useState<PolicyRecordState>('unknown')
  /**
   * ⚠⚠ **每轮 effect 自增的令牌**（2026-10-24 · 修复单第 3 条）。
   *
   * ── 修的是什么（实测两方向都坏）──────────────────────────────────────
   *   上一版用 `const alive = useRef(true)` + 每个 effect 首行 `alive.current = true`：
   *   **新 effect 会先把闸重新打开**，于是**上一个会话**那次仍在飞的读取，回包时
   *   `alive.current` 读到的已经是新 effect 置的 `true` ⇒ 它照旧 `setRecorded(…)`：
   *     · 旧会话回 `'unrecorded'`、当前会话其实已选 ⇒ **误弹一次**；
   *     · 旧会话回 `'recorded'`、当前会话其实未选 ⇒ **横幅被抹掉**（该提示的不提示）。
   *   ⇒ 改为**令牌**：每次 effect 开头 `token.current += 1` 并记下 `myToken`，
   *     回包时只有 `token.current === myToken` 才写 state。切换会话/卸载都会让
   *     旧令牌**永久失效**（不存在"重新打开闸"的路径）。
   *   ⚠ 与弹窗的 `abandonedRef` **同形**（同一个团队定的写法，⛔ 不要各写一套）。
   */
  const token = React.useRef(0)
  /** 选完之后的**重读计数**（自增 ⇒ 下面的读取 effect 重跑；见 `notifySessionSelected`）。 */
  const [reload, setReload] = React.useState(0)

  /**
   * 订阅"本会话已选完"（第 11 条）：命中 ⇒ ① 清掉"弹过"的记录；② 重读三态。
   * ⚠ 只在自己这个 `sessionId` 上生效 —— 别人的会话选完不该动我的横幅。
   */
  React.useEffect(() => {
    if (sessionId === undefined || sessionId === '') return undefined
    const onSelected = (id: string) => {
      if (id !== sessionId) return
      memory?.forget(sessionId)
      setReload((n) => n + 1)
    }
    selectedListeners.add(onSelected)
    return () => { selectedListeners.delete(onSelected) }
  }, [sessionId, memory])

  React.useEffect(() => {
    token.current += 1
    const myToken = token.current
    /**
     * ⚠ **非 Hob 直接早退**：这是"非 Hob ⇒ 不渲染、不请求"的落点。
     *   放在 effect 里而不是渲染期，是为了让请求数可数（机检断言"零请求"）。
     */
    if (sessionId === undefined || sessionId === '' || !isHobPreset(props.agentPreset)) {
      setRecorded('unknown')
      // ⚠ 早退分支也要**作废**本轮令牌（否则它不会被任何回包用到，但语义要一致）
      return () => { token.current += 1 }
    }
    /**
     * ⚠⚠ **读取器的选取**（2026-10-22 第 4 轮修正 · 真缺陷）：
     *   上一版写的是「没传 `readRecorded` ⇒ 直接 `'unknown'`」—— 那是**错的**：
     *   生产注册处（`src/client/index.ts`）**不需要**显式传它，默认就应该走本插件的
     *   只读路由。照上一版，`install…({openForSession})` 装出来的 gate **永远不会读**，
     *   于是"自动弹"永远不生效 —— 功能看着接上了、其实是死的。
     *   ⇒ 现在：未传 ⇒ 用 {@link defaultPolicyRecordReader}（同源 POST 到本插件路由）。
     *   ⚠ 只有**显式传了 `null`** 才表示"我就是不想读"（机检用它测"零请求"分支）。
     */
    const reader = props.readRecorded === null
      ? undefined
      : (props.readRecorded ?? defaultPolicyRecordReader)
    if (typeof reader !== 'function') {
      // ⚠ 显式 null ⇒ 判不出 ⇒ 'unknown'（⛔ 不猜成 unrecorded）
      setRecorded('unknown')
      return () => { token.current += 1 }
    }
    void (async () => {
      let next: PolicyRecordState = 'unknown'
      try {
        next = await reader(sessionId)
      } catch {
        next = 'unknown'
      }
      /**
       * ⚠ **令牌核对**（第 3 条）：只有"这一次 effect 发的请求"才允许写 state。
       *   切换会话 / 卸载之后 `token.current` 已经变了 ⇒ 这次回包**一个 state 都不写**
       *   （⛔ 不许用上一会话的判定覆盖当前会话的判定）。
       */
      if (token.current !== myToken) return
      setRecorded(next)
    })()
    return () => { token.current += 1 }
  }, [sessionId, props.agentPreset, props.readRecorded, reload])

  /**
   * **挂载时"未选即弹"这条路已废（2026-10-29 · 第 333 轮 · TASK-Q · `CHG-215`）**。
   *
   * ── 它原来是干什么的 ──────────────────────────────────────────────────
   *   改前这里有一段 `useEffect`：只要 `recorded === 'unrecorded'`（= 切到 Hob 预设、
   *   还一条消息都没发）就 `memory.takeAutoOpen()` ⇒ `openForSession(sid)`。
   *
   * ── 为什么必须废（用户原话）──────────────────────────────────────────
   *   > 「我点击 HOB 预设在输入信息之前就会弹出窗口，虽然逻辑不太对
   *   >  （**我要求的是点击发送后弹出**）」
   *   ⇒ 改前的时点是"**切预设**"，而用户要的是"**点发送、被拦下之后**"。
   *   ⚠ 实测归因（`REPORT-P.md` §3 格5）：现场 `blocks.json` 里没有该会话、
   *     5 个 turn 全 `completed`、**无一条 blocked** ⇒ 那次弹窗**只能**来自这段代码，
   *     ⛔ 不是 `blocked` 轮询。所以关掉的就是它。
   *
   * ── 现在开窗的唯一来源 ────────────────────────────────────────────────
   *   下面那条「`blocked` 轮询」（{@link BLOCK_POLL_INTERVAL_MS} = 4 s，**挂载时先跑一次**）：
   *   用户点发送 ⇒ 服务端闸门 `reject` 并落一条"被拦过" ⇒ 轮询读到 `blocked` ⇒ 才开窗。
   *   ⇒ **未发消息 ⇒ 一次都不弹**；**被拦下 ⇒ 弹恰好一次**。
   *
   * ⚠ 三条不许动的边界（任务书 §二）：
   *   ① 开窗**仍然只经过** `memory.takeAutoOpen(sessionId)` 这一个去重记号（⛔ 不拆两份，
   *      否则"挂载一次 + 轮询一次"会双弹）；
   *   ② ⛔ **不做常驻入口 / 不加新按钮**（`CHG-185` F4）：横幅与按钮仍是**既有的**那一个；
   *   ③ `autoOpen === false` 仍是**总闸**（机检靠它造"零开窗"场景），只是现在它 gate 的是
   *      轮询那条路（改前 gate 的是已废掉的那条）。
   */
  const mountedAutoOpen = props.autoOpen !== false

  /**
   * ⚠⚠ **"被拦过"轮询 → 开弹窗**（2026-10-29 · 第 332 轮 · 包 cb 的**主线**）。
   *
   * ── 它补的是哪一段 ────────────────────────────────────────────────────
   *   用户点发送 ⇒ 服务端闸门 `reject`（消息被暂存）**并**落一条"被拦过"；
   *   宿主对 `reject` **不 emit 事件** ⇒ 客户端只能轮询来发现它。
   *   一旦读到 `'blocked'` ⇒ 走**既有的** `openForSession` 开弹窗
   *   （⛔ 不新造第二个弹窗实现）。
   *
   * ── ⚠ 三条"不打扰"边界（本单 §二 第 2 条）──────────────────────────
   *   ① **非 Hob / 无 sessionId ⇒ 一次请求都不发**（与上面 `recorded` 读取同一条早退）；
   *   ② **已选档（`recorded !== 'unrecorded'`）⇒ 不停**：那说明用户已经选过了，
   *      再问也没意义（⛔ 省掉无用的往返）；
   *   ③ **同会话只自动弹一次**：用同一份 `memory.takeAutoOpen`（⚠ 与既有自动弹**共用**
   *      一个记号 —— 否则会出现"横幅弹一次、轮询又弹一次"的双弹）。
   *   ⚠ `'unknown'` ⇒ **不弹**（fail-closed）。
   *
   * ── ⚠ 轮询自身的纪律 ────────────────────────────────────────────────
   *   · 只查**自己的** `sessionId`（⛔ 不整页轮询）；
   *   · `sessionId` / `recorded` / reader 变化 ⇒ 重建定时器（⚠ 依赖数组写全）；
   *   · 卸载 ⇒ `clearInterval`（⛔ 不留孤儿定时器）；
   *   · 令牌规则与 `recorded` 读取**同形**：回包时代际不符 ⇒ 一个 state 都不写。
   */
  React.useEffect(() => {
    if (sessionId === undefined || sessionId === '') return undefined
    if (!isHobPreset(props.agentPreset)) return undefined
    // ⚠ 已选档 / 判不出 ⇒ 不轮询（`unrecorded` 才可能是"被拦了但还没选"）
    if (recorded !== 'unrecorded') return undefined
    /**
     * ⚠⚠ **`autoOpen === false` ⇒ 这条也不跑**（2026-10-29 · TASK-Q）。
     *   改前 `autoOpen` 只 gate「挂载即弹」那一段；那段废掉后，本参数若不跟过来，
     *   **机检就再也造不出"零开窗"场景**（它一直是靠 `autoOpen:false` 关掉开窗的）。
     *   ⚠ 语义仍然是"**允不允许本组件自动开窗**"：`false` ⇒ 一次都不开；
     *     用户点横幅按钮（`onClick → openForSession`）**不受影响** —— 那是用户动作，不是自动。
     */
    if (!mountedAutoOpen) return undefined
    if (props.readBlocked === null) return undefined
    const reader = props.readBlocked ?? defaultPolicyBlockReader
    if (typeof reader !== 'function') return undefined
    const interval = typeof props.blockPollMs === 'number' && props.blockPollMs > 0
      ? props.blockPollMs
      : BLOCK_POLL_INTERVAL_MS
    let alive = true
    const tick = async () => {
      let next: 'blocked' | 'clear' | 'unknown' = 'unknown'
      try {
        next = await reader(sessionId)
      } catch {
        next = 'unknown'
      }
      if (!alive) return
      if (next !== 'blocked') return
      if (typeof props.openForSession !== 'function') return
      if (memory === undefined) return
      /**
       * ⚠ **原子取记号**：`memory.takeAutoOpen` 是**本组件唯一的开窗去重记号**
       *   （⚠ 改前它由"挂载即弹"与"轮询"两条路共用；TASK-Q 之后只剩这一条路，
       *    但**记号本身一个字没改**、`memory.forget` 的清理路径也没改）。
       *   ⚠ 取不到（已经弹过）⇒ 静默返回（⛔ 不重复开窗）。
       */
      if (!memory.takeAutoOpen(sessionId)) return
      try { props.openForSession(sessionId) } catch { /* 打不开不影响其它 */ }
    }
    void tick()
    const timer = setInterval(() => { void tick() }, interval)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [sessionId, props.agentPreset, props.readBlocked, props.blockPollMs, recorded, props.openForSession, memory, mountedAutoOpen])

  if (props.showBanner === false) return null
  if (!shouldShowGate(props.agentPreset, recorded)) return null

  const canOpen = typeof props.openForSession === 'function'
  const selected = recorded === 'recorded'
  return h('div', { className: GATE_CLASS.root, role: 'status', 'aria-live': 'polite' },
    // ⚠ 文案经 `t()` **现读**（切语言 ⇒ 订阅触发重渲染 ⇒ 这里拿到新语言的句子）
    h('span', { className: GATE_CLASS.text }, gateText(selected)),
    h('button', {
      type: 'button',
      className: GATE_CLASS.btn,
      // ⚠ 不能开时**不用 disabled**：disabled 的按钮在部分宿主主题下读不出来，
      //   且用户不知道"为什么点不动"。改成可点 + 可读说明（见 onClick）。
      'aria-disabled': canOpen ? undefined : 'true',
      'data-gate-action': canOpen ? 'open' : 'unavailable',
      onClick: () => {
        if (!canOpen || sessionId === undefined) {
          try {
            // ⚠ 如实说明，⛔ 不假装已经打开
            globalThis.alert?.(`${gateText(selected)}\n${gateButtonUnavailableText()}：${t('gate.alert.unavailable')}`)
          } catch { /* 无 alert 环境 ⇒ 静默（横幅文案已可见） */ }
          return
        }
        props.openForSession?.(sessionId)
      },
    }, canOpen ? gateButtonText(selected) : gateButtonUnavailableText()),
  )
}

/**
 * **槽用的活组件**：把宿主给的标准 props 映射成本组件的 props。
 *
 * ⚠ 为什么单独一层：槽注入的是 `sessionId` 与 `useProjection` 这类**hook 面**，
 *   而组件本体要的是**普通值** —— 分开才能让机检直接挂组件本体（不依赖槽）。
 * ⚠ `useProjection('agentPreset')` 是宿主第五个框架 hook（签名见
 *   `dsh-api-session-controller/lib/types/client/sessions/projection-store.d.ts:28-30`），
 *   与 `dsh-client-ui-agent-preset/lib/client.js:2095` 的用法同源。
 */
export function HobUnselectedGateLive(props: {
  sessionId?: string
  useProjection?: (key: string) => unknown
  readRecorded?: PolicyRecordReader | null
  openForSession?: (sessionId: string) => void
  memory: GateMemory
  autoOpen?: boolean
  showBanner?: boolean
}): any {
  const useProjection = props.useProjection
  const preset = typeof useProjection === 'function'
    ? (useProjection('agentPreset') as string | null | undefined)
    : undefined
  return React.createElement(HobUnselectedGate, {
    sessionId: props.sessionId,
    agentPreset: preset,
    ...(props.readRecorded === undefined ? {} : { readRecorded: props.readRecorded }),
    ...(props.openForSession === undefined ? {} : { openForSession: props.openForSession }),
    memory: props.memory,
    ...(props.autoOpen === undefined ? {} : { autoOpen: props.autoOpen }),
    ...(props.showBanner === undefined ? {} : { showBanner: props.showBanner }),
  })
}

/**
 * 把本模块注册进 `conversation.hero.options`。
 *
 * ⚠ 用 `ctx.slots.inject`（反应式）而**不是**模块级 `inject`：
 *   槽缺席时**不注册、不报错**（宿主其它界面插件未装载时也不该炸）——
 *   与 `src/client/index.ts` 里三条 `shell.overlay` 注册同一套纪律。
 * ⚠ 样式挂 `ctx.effect`，热重载/卸载时自动摘掉（⛔ 不留孤儿 `<style>`）。
 *
 * @param ctx - client 半边上下文。
 * @param deps - 外部能力：是否允许自动弹、为已有会话开弹窗（⚠ 现状缺席）。
 */
export function installHobUnselectedGate(ctx: any, deps: {
  readRecorded?: PolicyRecordReader | null
  openForSession?: (sessionId: string) => void
  autoOpen?: boolean
} = {}): GateMemory {
  const memory = createGateMemory()

  ctx.effect(() => {
    const tag = ensureGateStyles()
    return () => { tag?.remove() }
  }, 'dsh-hob: unselected gate styles')

  ctx.slots.inject('conversation.hero.options', () => ctx.slots.register({
    name: 'conversation.hero.options',
    id: HOB_GATE_SLOT_ID,
    // ⚠ 排在宿主自己的 hero 选项之后（不抢先）
    order: HOB_GATE_ORDER,
  }, (slotProps: any) => React.createElement(HobUnselectedGateLive, {
    sessionId: typeof slotProps?.sessionId === 'string' ? slotProps.sessionId : undefined,
    ...(typeof slotProps?.useProjection === 'function' ? { useProjection: slotProps.useProjection } : {}),
    ...(deps.readRecorded === undefined ? {} : { readRecorded: deps.readRecorded }),
    ...(deps.openForSession === undefined ? {} : { openForSession: deps.openForSession }),
    memory,
    ...(deps.autoOpen === undefined ? {} : { autoOpen: deps.autoOpen }),
  })))

  /**
   * ⚠ 2026-11-04：发送后 `conversation.hero.options` 会卸载 ⇒ 轮询跟着消失。
   * 在**会话常驻**的 composer 槽再挂一个**只轮询、不渲染横幅**的实例，
   * 与 hero 实例**共用同一份 memory** ⇒ 读到 blocked 时仍只弹一次。
   */
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: HOB_GATE_POLL_SLOT_ID,
    order: HOB_GATE_ORDER,
  }, (slotProps: any) => React.createElement(HobUnselectedGateLive, {
    sessionId: typeof slotProps?.sessionId === 'string' ? slotProps.sessionId : undefined,
    ...(typeof slotProps?.useProjection === 'function' ? { useProjection: slotProps.useProjection } : {}),
    ...(deps.readRecorded === undefined ? {} : { readRecorded: deps.readRecorded }),
    ...(deps.openForSession === undefined ? {} : { openForSession: deps.openForSession }),
    memory,
    ...(deps.autoOpen === undefined ? {} : { autoOpen: deps.autoOpen }),
    showBanner: false,
  })))

  return memory
}
