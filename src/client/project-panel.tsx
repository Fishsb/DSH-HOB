/**
 * 四步主线面板（**第 1 轮：只验位置**）。
 *
 * ── 本文件做什么 ─────────────────────────────────────────────────────
 *   给宿主右侧栏提供一块**只读**面板，竖排四步：
 *     需求规格 / 实现方案 / 编码任务 / 任务执行
 *   入口在**侧边栏「开始」页那排工具位**里（一个胶囊；点它打开右侧栏那张标签页）。
 *
 * ── ⚠⚠ 本轮最硬的一条纪律：**不接数据，也不许摆假数据** ──────────────
 *   ⚠⚠ **2026-10-29 第 9 轮（`CHG-229`，用户裁定）**：图例**不再写状态词**。
 *      ── 改前是什么 ────────────────────────────────────────────────────
 *        图例每行右边挂一个 `Tag`，字样是「未接线」。数据接通后那五个字**是错的**：
 *        下面明明有六行真数据，图例却说没接线 ⇒ **界面自相矛盾**，比没信息更糟。
 *      ── 现在（方案 A：只列步名）────────────────────────────────────────
 *        `1 需求规格` … `5 验收核对`，**不带任何状态词**。
 *        ⛔ 不许换成「—」「?」「未就绪」之类 —— 那是**换个词继续糊**。
 *        ⚠ 真状态只在下面的进度表里（同一条 `rows`），图例只回答"有哪五步"。
 *      ── 判据 ──────────────────────────────────────────────────────────
 *        `check:stages-dom` 的 S-6 **只量 `[data-dsh-hob="stages-legend"]` 容器**
 *        （⛔ 不全文件 grep：数据区将来复用该词会误报）；S-10 是它的负向对拍。
 *   ⛔ 不许出现任何数字、百分比、勾选、进度条 —— 用户明确反对假界面；
 *   一个诚实的"未接线"比一个漂亮的假 80% 强。下一轮才接线。
 *
 * ── 为什么面板里**没有**任何按钮回调 ─────────────────────────────────
 *   本组件是 `sidebar.right.pane.tab` 的 body，**只读**；本轮没有任何写操作。
 *   ⚠ 本组件**没有任何写操作**；入口胶囊由宿主的 guide 页负责渲染与导航。
 *
 * ── 常量为什么写死在这里且导出 ───────────────────────────────────────
 *   四个步骤名是**定死的常量**（⛔ 不从网络取、不从配置读）。
 *   导出是为了让机检（`scripts/check-stages-panel-dom.mjs`）能**锚定真值**做负向对拍，
 *   而不是在脚本里再抄一份字面量（抄一份 ⇒ 改了一处也不会红）。
 */
import * as React from 'react'
import { StateDot, Tag } from './atoms.tsx'
import {
  EXEC_BUCKET_LABELS,
  EXEC_LABEL_NOT_STARTED,
  EXEC_LABEL_RAN_BEFORE,
  EXEC_PROGRESS_ROUTE_PATH,
  EXEC_STATE_LABELS,
  execMergeNote,
} from '../shared/exec-protocol.ts'
/**
 * ⚠⚠ **2026-10-30 P21：按 kind 取中文标签**（⛔ 不再把每个 kind 的状态都扔给九态表）。
 *   病（用户截图）：`agreed`/`settled`/`built`/`unverified` 都是各自 kind 的**合法状态**，
 *   却因为九态表里没有而印成「判不出（原值 X）」—— 那句话在骗人。
 */
import { stageStatusLabel } from '../shared/stage-status-labels.ts'
import { UNSEEN_TOOLS_ROUTE_PATH } from '../shared/unseen-tools.ts'
import { readPathOf } from '../shared/ledger-resources.ts'
import { ITEM_FLAG_MESSAGES, relationLabelOf, type ItemFlagCode, type ItemPresentation } from '../shared/item-presentation.ts'
import type { RequirementChain } from '../shared/requirement-chain.ts'
import { HOB_PRESET_ID } from '../shared/planning-preset.ts'
import { CurrentPanel } from './current-panel.tsx'
// 工作计划面板（第五波）：计划 / 轨道 / 执行者 / 等待关系 / 单轨原因，只读。
import { WorkPlanPanel } from './work-plan-panel.tsx'

/** 标签页**类型 id**（= 宿主 `sidebar.right.pane.tab` 的 `key`）。 */
export const STAGES_TAB_ID = 'dsh-hob-stages'
/** 标签页**kind**（= `ctx.sidebarRight.openTab(kind)` 的参数）。 */
export const STAGES_TAB_KIND = 'dsh-hob-stages'
/**
 * 侧边栏「开始」页那排工具位里的**胶囊 id**（`SidebarRightGuideEntry.id`）。
 *
 * ⚠ 2026-10-29 第 9 轮：入口**从栏脚搬到侧边栏**（用户原话「入口不要放在左下角，
 *   放在侧边栏挂载」）。那排**不是槽**，是**每个 tab 类型自己的 `guide` 数组**
 *   （宿主 `…/dsh-client-ui-sidebar-right/lib/client.js:4734-4738` 把每个 definition 的
 *   `guide` 条目摊平后按 `order` 排序）⇒ 只需在**类型注册**里带上 `guide`。
 * ⛔ 原来的 `sidebar.footer.action` 注册已删除（两个入口比没有入口更糟）。
 */
export const STAGES_GUIDE_ENTRY_ID = 'dsh-hob-stages'
/** 胶囊在那排里的位置：排在「新建终端」(order 20) 之后、「会话数据诊断」(order 60) 之前。 */
export const STAGES_GUIDE_ORDER = 50

/**
 * **五步名** —— **定死**，顺序即主线顺序（2026-10-29 用户裁定：四步 → 五步）。
 *
 * ⚠ 第 5 步「验收核对」是**新加的**（原四步之后）；⛔ 不许改顺序、⛔ 不许加第 6 个。
 */
export const STAGES_STEP_NAMES = ['需求规格', '实现方案', '编码任务', '任务执行', '验收核对'] as const

/**
 * **步号 → kind**（`1..5`）。
 *
 * ⚠ 与账本侧 `src/shared/stages-index.ts` 的 `STAGE_DEFS` **同序**（`req/change/task/run/acc`）；
 *   ⛔ 这里不 import 服务端模块（客户端包不该拉服务端解析器），所以是一张**三行小表**。
 *   ⚠ 一致性由 `check:stages-route` 的 R-10 咬住（它逐 kind 点验标签表，
 *     若这张表与 `STAGE_DEFS` 漂开，那一步的条目就会全变「判不出」⇒ DOM 断言必红）。
 */
export const STAGE_KIND_BY_STEP: Readonly<Record<number, string>> = {
  1: 'req',
  2: 'change',
  3: 'task',
  4: 'run',
  5: 'acc',
}

/** 取某一步的 kind（判不出 ⇒ 空串，⚠ 让 `stageStatusLabel` 走"未知 kind"那条兜底）。 */
export function kindOfStep(step: number): string {
  return STAGE_KIND_BY_STEP[step] ?? ''
}

/** 「未接线」这个词 —— ⚠ **2026-10-29 第 9 轮起图例不再使用它**（数据已接通，见 `legend` 注释）。
 *  保留导出只为两件事：① 历史/文档一致性；② 判据可以断言「图例区不含它」。 */
export const STAGES_UNWIRED_LABEL = '未接线'

/** 面板标题（⚠ 2026-10-29 四步→五步：标题同步，⛔ 不许留着「四步」骗人）。 */
export const STAGES_PANEL_TITLE = '任务进度'

/**
 * 三态用词（`R-4`：各自可读，⛔ 不许含糊）。
 *
 * ⚠ 「表里是空的」与「判不出」是**两句不同的话**，界面上必须字面不同：
 *   前者 = 表在、零行（一个**事实**）；后者 = 读不到（一个**缺失**）。
 */
export const STAGES_EMPTY_TEXT = '表里是空的'
export const STAGES_UNDECIDABLE_TEXT = '判不出'

/** 本路由路径（客户端要与服务端逐字一致；⛔ 不许各写一份）。 */
/** LEGACY：旧 `volumes/tasks/INDEX.md` 兼容视图；权威五步数据见 `STAGES_ROUTE_PATH`。 */
export const STAGES_PROGRESS_PATH = '/api/dsh-hob/tasks-progress'

/** 执行态路由路径（⚠ **值来自** `shared/exec-protocol.ts` —— 与服务端同一份，⛔ 不各写一份）。 */
export const STAGES_EXEC_PATH = EXEC_PROGRESS_ROUTE_PATH

/** 五步汇总路由（新数据源 = `ledger/units/` 的索引分片；⛔ 不再读散文账）。 */
export const STAGES_ROUTE_PATH = '/api/dsh-hob/stages'
/** 需求链汇总路由（面板主视图；只返回链摘要，⛔ 不重复下发条目正文）。 */
export const REQUIREMENT_CHAINS_ROUTE_PATH = '/api/dsh-hob/requirement-chains'
/**
 * 账本目录路由（2026-11-07 · `R-020`）。
 * ⚠ 面板用它列举"项目"（= 账本）并切换；⛔ 不读账本内容。
 */
export const LEDGERS_ROUTE_PATH = '/api/dsh-hob/ledgers'

/**
 * 「待确认工具」只读路由（⚠ **值来自** 纯共享层的同一份常量，
 * ⛔ 不在这里再写一份字符串，也⛔ 不从服务端路由导入实现）。
 *
 * ── 为什么面板要读它（2026-11-01 P41/R20 · `TASK-R20.md` §一）────────────────
 *   `R-008` 的标题是「「被判出」**必须能在界面上看见**，⛔ 不能只落日志」，
 *   而那条只读路由早已存在、`describeUnseen` 也已完整 —— 但 `src/client/` 里**零处**读它。
 *   ⇒ 标题这一条**今天没被满足**：判出来了，用户还是看不见。
 *   ⛔ 本块**只读**：不新开路由、不改它的返回形状、不写任何东西。
 */
export const STAGES_UNSEEN_PATH = UNSEEN_TOOLS_ROUTE_PATH

/** 按稳定 ID 读取完整账本单元（⚠ 与资源路由同一路径；只读）。 */
export const STAGES_RESOURCE_PATH = '/api/dsh-hob/ledger-resource'

/** 三态图标（照 SDD Dashboard 的 circle / play / check；⛔ 无百分比）。 */
export const STAGE_STATE_ICON: Readonly<Record<'done' | 'doing' | 'todo', string>> = {
  done: '✓',
  doing: '▶',
  todo: '○',
}

/** 三态的中文词（⚠ 只在这里出现一次）。 */
export const STAGE_STATE_TEXT: Readonly<Record<'done' | 'doing' | 'todo', string>> = {
  done: '完成',
  doing: '进行中',
  todo: '未开始',
}

/** 需求链展示态（五态封闭集）的图标与中文；⚠ 只做展示映射，不改账本状态。 */
export const CHAIN_STATE_ICON: Readonly<Record<'done' | 'doing' | 'waiting' | 'blocked' | 'todo', string>> = {
  done: '✓',
  doing: '▶',
  waiting: '⟳',
  blocked: '✗',
  todo: '○',
}

export const CHAIN_STATE_TEXT: Readonly<Record<'done' | 'doing' | 'waiting' | 'blocked' | 'todo', string>> = {
  done: '已完成',
  doing: '进行中',
  waiting: '等待',
  blocked: '卡住',
  todo: '未开始',
}

/** 「长期能力」栏的标题（`cap` 单列，⛔ 不进分母、⛔ 无百分比）。 */
export const STAGES_CAPS_TITLE = '长期能力（无完成态）'

/**
 * **自动刷新间隔（毫秒）** —— ⚠ 写死成常量（任务书 §一A：不许散在代码里）。
 * 5 秒：短到"派活后几秒内就看见变化"，长到不会把宿主轮询成负载。
 */
export const STAGES_POLL_MS = 5000

/**
 * 第 4 步子项的**空态**文案（`R-4`：空态不许说成"没发生"）。
 * ⚠ 它说的是"**现在**没有在跑的活"，⛔ 不是"从来没派过活"（后者是 `state-missing`）。
 */
export const STAGES_EXEC_EMPTY_TEXT = '这一项没有在跑的活'

/** 「现在」档的标题（`R-1`：此刻的与累计的 ⛔ 不许并排）。 */
export const STAGES_EXEC_NOW_TITLE = '现在'

/**
 * 「历史」档标题的**前缀**（后面拼条数：`历史 27 条（默认折叠）`）。
 * ⚠ 任务书 §一1：历史档**默认折叠**，且标题里必须写明条数与"默认折叠"。
 */
export const STAGES_EXEC_HISTORY_TITLE_PREFIX = '历史'

/** 历史档标题的**后缀**（逐字，机检断言它）。 */
export const STAGES_EXEC_HISTORY_TITLE_SUFFIX = '条（默认折叠）'

/** 合并行的后缀用词（`共 N 条`）。 */
export const STAGES_EXEC_COUNT_PREFIX = '共'
export const STAGES_EXEC_COUNT_SUFFIX = '条'

/**
 * `step` → 人读标签（七值封闭集；⛔ 不新增第八个）。
 *
 * ⚠ 只做**文案映射**，不做任何"完成度换算"（⛔ 零百分比）。
 *
 * @param step - 线格式里的 `step` 原值
 * @returns 展示用中文/符号
 */
export function stepLabel(step: unknown): string {
  const s = String(step ?? '')
  if (s === '1') return `1 ${STAGES_STEP_NAMES[0]}`
  if (s === '2') return `2 ${STAGES_STEP_NAMES[1]}`
  if (s === '3') return `3 ${STAGES_STEP_NAMES[2]}`
  if (s === '4') return `4 ${STAGES_STEP_NAMES[3]}`
  /**
   * ⚠⚠ **`'5'` 与 `'done'` 是两态，⛔ 不许合并**（用户裁定 `CHG-223` / `CHG-224`）：
   *   · `'5'`    = **在做验收**（第 5 步「验收核对」进行中）；
   *   · `'done'` = **已验收通过**（终态）。
   *   把 `'5'` 写成"✅ 验收完成"就是把"在验"说成"验过了" —— 那是伪造读数。
   * ⚠ 第 5 步的状态**只能由规划侧按原始读数判**；⛔ 实施方自报"完成了"不算数。
   */
  if (s === '5') return `5 ${STAGES_STEP_NAMES[4]}`
  if (s === 'done') return '✅ 验收完成'
  if (s === 'unfilled') return '未回填'
  return '判不出'
}

/**
 * 默认的进度读取实现（生产路径）。
 *
 * ⚠ POST + JSON body（与宿主 `connection.fetch.register` 的 `methods:['POST']` 一致）；
 *   失败**抛出**（由调用方转成"判不出"状态），⛔ **不返回空数组冒充"表里是空的"**。
 *
 * @returns 线格式响应原文（`{ok,readAt,source,rows}` 或 `{ok:false,reason,message}`）
 */
export async function defaultFetchProgress(sessionId?: string): Promise<any> {
  /**
   * ⚠⚠ **必须带 `sessionId`**（2026-10-29 第 8 轮真机实测的第二个缺陷）。
   *
   * ── 不带会怎样（实测原文）──────────────────────────────────────────
   *   服务端用 `session.header.cwd` 派生账本根；没有 `sessionId` ⇒ 没有 cwd
   *   ⇒ `resolveLedgerRoot` 返回 `undefined` ⇒ 真机返回：
   *     `{"ok":false,"reason":"ledger-unreadable","message":"账本根判不出 ⇒ …：没给工作区根…"}`
   *   面板于是显示「判不出」——**路由通了、数据没通**。
   * ⚠ 所以 body 里**必须**带上宿主给这个标签页的 sessionId（keyed/session 槽的 inject 第一参）。
   * ⛔ 不许改成"服务端猜一个最近会话"：那会在多会话下读错账本。
   */
  const body = sessionId === undefined || sessionId === '' ? {} : { sessionId }
  const res = await fetch(STAGES_PROGRESS_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  /**
   * ⚠⚠ **"打错门"与"读不到账本"必须分开说**（2026-10-29 第 10 轮 · 用户裁定）。
   *
   * ── 改前是什么（真机踩到的原话）───────────────────────────────────
   *   这里对任何响应都 `res.json()`。当路径上没有我们的处理体时，宿主回的是
   *   **纯文本 `not found`**（9 字节，`content-type: text/plain;charset=UTF-8`；
   *   出处 `dsh-client-connection/lib/index.js:835` 与 `:893` 的
   *   `new Response("not found", { status: 404 })`）⇒ `res.json()` 抛
   *     `Unexpected token 'o', "not found" is not valid JSON`
   *   ⇒ 界面上那行字**对用户零信息量**，而且会让人以为账本坏了。
   *
   * ── 现在 ──────────────────────────────────────────────────────────
   *   · **404 / 405** ⇒ 抛 {@link StaleRouteError}，文案点明"这个路径没有处理体
   *     （可能是方法或前缀不对）"—— 那是**接线**问题，⛔ 不是账本问题；
   *   · **其余非 JSON 响应** ⇒ 抛普通 `Error`（界面走"请求失败：…"）；
   *   · **`{ok:false,reason}` 的业务响应（含 400）照旧解析** —— 那是服务端**答了**，
   *     只是答案是可分辨的失败（`ledger-unreadable` / `table-missing` /
   *     `row-shape-unknown`），⛔ 不许把它当网络错误。
   */
  if (res.status === 404 || res.status === 405) {
    throw new StaleRouteError(
      `这个路径没有处理体（可能是方法或前缀不对）：${STAGES_PROGRESS_PATH} · HTTP ${res.status}`,
    )
  }
  try {
    return await res.json()
  } catch (e) {
    // ⚠ 非 JSON ⇒ 把状态码与响应体前 80 字带上（否则又变成一句没信息量的话）
    let snippet = ''
    try { snippet = (await res.clone().text()).slice(0, 80) } catch { /* 忽略 */ }
    throw new Error(`HTTP ${res.status} 的响应不是 JSON（${snippet === '' ? '空响应体' : `前 80 字：${snippet}`}）`)
  }
}

/**
 * **"打错门"专用错误**（404 / 405）—— 与"读不到账本"**不是一回事**。
 *
 * ⚠ 单独一个类而不是 `Error` + 字符串前缀，是为了让界面**按类型分支**：
 *   判据要能断言"显示的是那句接线问题"，而不是靠匹配一句会被改写的文案。
 */
/**
 * 默认的执行态读取实现（生产路径）。
 *
 * ⚠ 与 {@link defaultFetchProgress} **同一套"打错门"判据**（404/405 ⇒ {@link StaleRouteError}），
 *   但路径不同、线格式不同（`items` 而不是 `rows`）⇒ 两个函数，⛔ 不合并成一个"万能取数"。
 *
 * @returns 线格式响应原文（`{ok,items}` 或 `{ok:false,reason,message}`）
 */
/**
 * 默认取数：账本目录（`POST /api/dsh-hob/ledgers`）。
 *
 * ⚠ 与 `defaultFetchStages` 同形：POST + `sessionId`；服务端据此标 `current`。
 * ⛔ 零写。
 */
export async function defaultFetchLedgers(sessionId?: string): Promise<any> {
  const body = sessionId === undefined || sessionId === '' ? {} : { sessionId }
  const res = await fetch(LEDGERS_ROUTE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 404 || res.status === 405) {
    throw new StaleRouteError(
      `这个路径没有处理体（可能是方法或前缀不对）：${LEDGERS_ROUTE_PATH} · HTTP ${res.status}`,
    )
  }
  try {
    return await res.json()
  } catch (e) {
    let snippet = ''
    try { snippet = (await res.clone().text()).slice(0, 80) } catch { /* 忽略 */ }
    throw new Error(`HTTP ${res.status} 的响应不是 JSON（${snippet === '' ? '空响应体' : `前 80 字：${snippet}`}）`)
  }
}

export async function defaultFetchExec(sessionId?: string): Promise<any> {
  const body = sessionId === undefined || sessionId === '' ? {} : { sessionId }
  const res = await fetch(STAGES_EXEC_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 404 || res.status === 405) {
    throw new StaleRouteError(
      `这个路径没有处理体（可能是方法或前缀不对）：${STAGES_EXEC_PATH} · HTTP ${res.status}`,
    )
  }
  try {
    return await res.json()
  } catch (e) {
    let snippet = ''
    try { snippet = (await res.clone().text()).slice(0, 80) } catch { /* 忽略 */ }
    throw new Error(`HTTP ${res.status} 的响应不是 JSON（${snippet === '' ? '空响应体' : `前 80 字：${snippet}`}）`)
  }
}

/**
 * 九态 → 人读标签（⚠ 措辞只从 {@link EXEC_STATE_LABELS} 取，本函数**不写中文**）。
 *
 * @param state - 线格式里的 `state` 原值
 * @returns 展示用标签；不在九态内 ⇒ `'判不出'`（⛔ 不猜一档、⛔ 不显示原值冒充标签）
 */
export function execStateLabel(state: unknown): string {
  const s = String(state ?? '')
  const hit = (EXEC_STATE_LABELS as Record<string, string>)[s]
  return typeof hit === 'string' ? hit : '判不出'
}

/**
 * **一行执行项的展示词**（⚠ 委托协议层的 {@link execDisplayLabel}，⛔ 不在客户端另写一套）：
 * 「执行中」只给真的在跑的；无 `ranMs` 的历史记录 ⇒ 「未开跑」。
 *
 * @param item - 一行执行项（需要 `state` / `bucket` / `elapsedMs`）
 * @returns 展示用中文
 */
export function execItemLabel(item: any): string {
  const s = String(item?.state ?? '')
  if (s !== 'running') return execStateLabel(s)
  /**
   * ⚠ **三条互斥、按 `bucket` 优先**（2026-10-30 第 21 轮 · 任务书 §一①）：
   *   · 现在档的 running ⇒ 「执行中」（真的在跑）；
   *   · 历史档 + 无 `elapsedMs` ⇒ 「未开跑」（从未进过运行态）；
   *   · 历史档 + 有 `elapsedMs` ⇒ 「**曾运行**」（跑过、现在不在跑）。
   * ⛔ 历史档**一律**不许出现「执行中」—— 那 13 条带 `elapsedMs` 的漏网记录正是本轮靶心。
   */
  if (item?.bucket === 'now') return EXEC_STATE_LABELS.running
  return typeof item?.elapsedMs === 'number' ? EXEC_LABEL_RAN_BEFORE : EXEC_LABEL_NOT_STARTED
}

/**
 * 已跑时长 → 人读。
 *
 * ⚠⚠ **`elapsedMs` 缺失 ⇒ 写「判不出」**（⛔ 不许写 `0 秒`：
 *   那会把"还没开跑 / 不知道何时开跑"说成"刚开跑"，是本仓明令的伪造读数）。
 *
 * @param ms - 线格式里的 `elapsedMs`（可能不存在）
 * @returns 展示用时长
 */
export function elapsedLabel(ms: unknown, merged = false): string {
  /**
   * ⚠ 合并行（`count > 1`）的时长口径是**「该 target 历史上最长一次」**（见服务端 `toExecProgress`
   *   的合并注释）⇒ 必须在文案里**明说**是"最长"，否则读者会以为它是这条记录跑的时间。
   * ⛔ 不许把这个前缀省掉：省掉 = 拿一个口径冒充另一个口径。
   */
  const prefix = merged ? '已跑（最长）：' : '已跑：'
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return `${prefix}判不出`
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const sec = totalSec % 60
  if (h > 0) return `${prefix}${h} 时 ${m} 分`
  if (m > 0) return `${prefix}${m} 分 ${sec} 秒`
  return `${prefix}${sec} 秒`
}

/**
 * 重核次数 → 人读（⚠ 缺字段读成 `0` —— 那是"没重核过"，如实，不是判不出）。
 *
 * @param n - 线格式里的 `rechecks`
 * @returns 展示用文案
 */
export function rechecksLabel(n: unknown): string {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0
  return `重核 ${v} 次`
}

/**
 * 默认的**五步汇总**取数实现（生产路径，PRIMARY 数据源）。
 *
 * ⚠ 与另两个取数函数**同一套"打错门"判据**（404/405 ⇒ {@link StaleRouteError}），
 *   但路径与线格式都不同（`stages` + `caps` 而不是 `rows` / `items`）⇒ 三个函数，⛔ 不合并。
 *
 * @returns 线格式原文（`{ok,readAt,stages,caps}` 或 `{ok:false,reason,message}`）
 */
export async function defaultFetchStages(sessionId?: string, ledger?: string): Promise<any> {
  /** 新面板只要紧凑列表；旧字段由默认线格式继续提供给既有消费方。 */
  const body = {
    ...(sessionId === undefined || sessionId === '' ? {} : { sessionId }),
    ...(ledger === undefined || ledger === '' ? {} : { ledger }),
    compact: true,
  }
  const res = await fetch(STAGES_ROUTE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 404 || res.status === 405) {
    throw new StaleRouteError(
      `这个路径没有处理体（可能是方法或前缀不对）：${STAGES_ROUTE_PATH} · HTTP ${res.status}`,
    )
  }
  try {
    return await res.json()
  } catch (e) {
    let snippet = ''
    try { snippet = (await res.clone().text()).slice(0, 80) } catch { /* 忽略 */ }
    throw new Error(`HTTP ${res.status} 的响应不是 JSON（${snippet === '' ? '空响应体' : `前 80 字：${snippet}`}）`)
  }
}

/**
 * 默认取数：需求链（`POST /api/dsh-hob/requirement-chains`）。
 *
 * ⚠ 与 `defaultFetchStages` 同形：POST + `sessionId` + 可选 `ledger`；
 *   ⛔ 不改服务端返回形状，⛔ 零写。
 */
export async function defaultFetchChains(sessionId?: string, ledger?: string): Promise<any> {
  const body = {
    ...(sessionId === undefined || sessionId === '' ? {} : { sessionId }),
    ...(ledger === undefined || ledger === '' ? {} : { ledger }),
  }
  const res = await fetch(REQUIREMENT_CHAINS_ROUTE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 404 || res.status === 405) {
    throw new StaleRouteError(
      `这个路径没有处理体（可能是方法或前缀不对）：${REQUIREMENT_CHAINS_ROUTE_PATH} · HTTP ${res.status}`,
    )
  }
  try {
    return await res.json()
  } catch (e) {
    let snippet = ''
    try { snippet = (await res.clone().text()).slice(0, 80) } catch { /* 忽略 */ }
    throw new Error(`HTTP ${res.status} 的响应不是 JSON（${snippet === '' ? '空响应体' : `前 80 字：${snippet}`}）`)
  }
}

/**
 * 默认取数：「待确认工具」只读路由（`POST /api/dsh-hob/unseen-tools`）。
 *
 * ⚠ 形状照 `defaultFetchStages`：POST + 带 `sessionId`（本路由其实不读会话，但保持一致），
 *   ⛔ 零写、⛔ 不改服务端返回形状（`UnseenReport`：`{ok,count,names,summary,items}`）。
 * ⚠ 404/405 ⇒ 抛 `StaleRouteError`（"打错门"与"读不到"必须分开说，同既有口径）。
 */
export async function defaultFetchUnseen(sessionId?: string): Promise<any> {
  const body = sessionId === undefined || sessionId === '' ? {} : { sessionId }
  const res = await fetch(STAGES_UNSEEN_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 404 || res.status === 405) {
    throw new StaleRouteError(
      `这个路径没有处理体（可能是方法或前缀不对）：${STAGES_UNSEEN_PATH} · HTTP ${res.status}`,
    )
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}：${STAGES_UNSEEN_PATH}`)
  return await res.json()
}

/** 按稳定 ID 读取一条账本资源；失败一律返回可读原因，⛔ 不伪造空正文。 */
export async function defaultFetchResource(sessionId?: string, resource?: string, ledger?: string): Promise<any> {
  if (typeof resource !== 'string' || resource === '') {
    return { ok: false, reason: 'bad-resource', message: '资源路径为空' }
  }
  const res = await fetch(STAGES_RESOURCE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...(sessionId ? { sessionId } : {}),
      ...(ledger === undefined || ledger === '' ? {} : { ledger }),
      resource,
    }),
  })
  if (!res.ok) return { ok: false, reason: 'route-error', message: `HTTP ${res.status}：${STAGES_RESOURCE_PATH}` }
  try { return await res.json() } catch { return { ok: false, reason: 'invalid-json', message: '资源路由没有返回 JSON' } }
}

export class StaleRouteError extends Error {
  /** @param message - 人读说明（已含路径与状态码） */
  constructor(message: string) {
    super(message)
    this.name = 'StaleRouteError'
  }
}

/**
 * ── ⭐ **2026-10-31 P36：面板根可上下滚**（用户原话「展开之后已经超出显示范围之后，
 *   需要提供上下滑动功能」）──────────────────────────────────────────
 *
 * ── 改前为什么必须改（不是"滚动做得不好"，是**压根没有**）────────────
 *   `grep 'overflow|maxHeight|height:'` 在改前的 `project-panel.tsx` **零命中**
 *   ⇒ 面板既没有滚动容器、也没有高度上限，内容长了就**直接溢出被裁掉**。
 *
 * ── 谁的高度真的有限（量测，⛔ 不许猜）──────────────────────────
 *   宿主 `@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js` 的 CSS（实测原文）：
 *     · `.P3OORG_panel … {position:absolute;top:0;bottom:0;right:0;overflow:clip}`
 *       ⇒ 宿主侧栏**自身 overflow: clip**（⛔ 不是 auto/scroll）
 *     · `.P3OORG_tabBody {height:100%;min-height:0;display:flex;overflow:hidden}`
 *       ⇒ 标签页身体**也不滚**，只是 `hidden`
 *   ⇒ ⚠ **宿主这一层根本不会给滚动条** —— 它只会把超出部分**裁掉**。
 *   ⇒ 所以「内层再加会不会双重滚动条」的答案是：**不会** —— 因为外层压根没有滚动条。
 *     ⚠ 这一条必须先量宿主，否则"加 overflow:auto"可能变成第二个滚动条。
 *
 * ── 为什么加在**面板根**（而不是某个列表）────────────────────────
 *   ① 一处管全部：五步树 + cap 区 + 展开体（现在/历史两档）都在面板根之下，
 *      加在这里等于**所有内容**都进同一个滚动容器；
 *   ② 若只给「展开体」加，`cap` 区和步头仍会溢出 ⇒ 用户还是要滚两次；
 *   ③ 面板根本身就是 `display:flex; flexDirection:column` 的**单一纵向流**，
 *      天然适合做滚动容器（不需要额外包一层 div）。
 *
 * ── 四条要求的落点（⚠ 逐条对应）──────────────────────────
 *   1. **只在超出时出现滚动条** ⇒ `overflowY: 'auto'`（⛔ 不是 `scroll` —— scroll 会**恒显**滚动条）；
 *   2. **⛔ 不双重滚动条** ⇒ 见上：宿主 `clip`/`hidden`，无第二滚动容器；
 *   3. **高度上限有具体值** ⇒ `maxHeight: '70vh'`（⚠ 取面板可见高度的 7 成，
 *      剩下的 3 成留给宿主标签栏与用户在会话区的视线；⛔ 不用 `100%`
 *      —— 那会与 `min-height:0` 的父链耦合太紧，宿主一改就失效）；
 *   4. **键盘可达** ⇒ `tabIndex: 0` + `role: 'region'` + `aria-label`，
 *      容器能拿焦点后，方向键/PageUp/PageDown 由浏览器原生滚动处理（⛔ 不自己写键盘逻辑）。
 *      ⚠ 同时给 `outlineOffset` 让焦点环不被 `overflow` 裁掉。
 */
export const STAGES_PANEL_SCROLL_MAX_HEIGHT = '70vh'

const wrapStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--dsw-radius-md, 8px)',
  padding: '12px',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  /** ⚠ 只在**超出**上限时才出滚动条（`auto`）；`scroll` 会恒显 ⇒ 违反"只在超出时"。 */
  overflowY: 'auto',
  /**
   * ⚠⚠ **2026-10-31 P39：显式禁掉横向滚**（用户真机报「下面左右滑动的滑块」）──────────
   *
   * ── 病（CSS 计算规则，不是巧合）──────────────────────────────────
   *   改前本对象**只有 `overflowY`，没有 `overflowX`** ⇒ `overflowX` 落在初始值 `visible`；
   *   而「一轴 `visible`、另一轴 `auto`/`scroll` 时，`visible` **计算为 `auto`**」
   *   ⇒ 根容器实际是**两轴都 auto** ⇒ 内容一横向溢出就长出横向滚动条。
   *
   * ── 为什么写 `hidden` 而不是 `clip` ────────────────────────────────
   *   ① `auto`/`scroll` ⛔ 本就是要删掉的东西，写回去等于没改；
   *   ② `hidden` 仍是**滚动容器**语义（可被 `scrollLeft` 程序化移动、可被键盘聚焦滚动链影响），
   *      `clip` 则完全退出滚动体系 —— 宿主父链 `.P3OORG_tabBody` 已 `overflow:hidden`，
   *      再叠一层 `clip` 会让「焦点环被裁」的既有 `outlineOffset: 2px` 兜底失效；
   *   ③ 但⚠ **`hidden` 只是"不滚"，它会把溢出的字裁掉** ⇒ 必须同时去掉溢出的
   *      **根因**（见下方三处 `minWidth: 0` + 换行），⛔ 不靠裁切盖住。
   */
  overflowX: 'hidden',
  /** ⚠ 具体值（⛔ 不用 100% / 不设 undefined）——判据要能读出这个数。 */
  maxHeight: STAGES_PANEL_SCROLL_MAX_HEIGHT,
  /** ⚠ 键盘可达：容器可聚焦 ⇒ 方向键 / PageUp / PageDown 原生滚动。 */
  outlineOffset: '2px',
}

const treeHeadStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  /**
   * ⚠⚠ **2026-10-31 P39：步头允许换行**（横向溢出的第二个根因）──────────
   *   改前本行是**单行 flex**，且三列各带固定 `minWidth`（`1.2em` / `4.5em` / `4.5em`）
   *   加「条数」那列 `3.4em` ⇒ **固定下界之和 13.6em**，再加 4 个 `gap: 8px`(32px)
   *   与面板 `padding: 12px`(24px) —— 窄侧栏里这个**和**本身就可能超宽 ⇒ 撑破 ⇒ 横向滚。
   *   ⇒ ① `flexWrap: 'wrap'`：装不下就换行（⛔ 不是裁掉，字一个不少）；
   *     ② 两列 `4.5em` 收窄到 `3.2em` / `3.6em`：`minWidth` 只是**对齐下界**不是上限，
   *        文字长了列仍会长（⛔ 不会截字），但下界之和降到 **11.4em**，窄侧栏下更少换行。
   */
  flexWrap: 'wrap',
  rowGap: '2px',
  font: 'inherit',
  fontSize: '0.95em',
  color: 'inherit',
  background: 'transparent',
  border: 'none',
  padding: '2px 0',
  textAlign: 'left',
  width: '100%',
}

const treeItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '0.9em',
  /** ⚠ P39：长 id + 长标题 + 状态词装不下一行时**换行**（⛔ 不是横向溢出、⛔ 不是裁切）。 */
  flexWrap: 'wrap',
  rowGap: '1px',
}

const subNoteStyle: React.CSSProperties = {
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: '0.9em',
  paddingLeft: '1.2em',
}

const subRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  paddingLeft: '1.2em',
  fontSize: '0.92em',
  /** ⚠ P39：执行项那一行列多（目标/标签/未跑说明/已跑/重核/共N条），同 `treeItemStyle` 处理。 */
  flexWrap: 'wrap',
  rowGap: '1px',
}

const refreshStyle: React.CSSProperties = {
  font: 'inherit',
  fontSize: '0.9em',
  padding: '2px 10px',
  cursor: 'pointer',
  color: 'inherit',
  background: 'transparent',
  border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.4))',
  borderRadius: 'var(--dsw-radius-sm, 4px)',
}

const viewTabStyle: React.CSSProperties = {
  font: 'inherit',
  fontSize: '0.88em',
  padding: '3px 8px',
  cursor: 'pointer',
  color: 'inherit',
  background: 'transparent',
  border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.4))',
  borderRadius: 'var(--dsw-radius-sm, 4px)',
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  /** ⚠ P39：装不下就换行（⛔ 不是裁掉）—— 与 {@link treeHeadStyle} 同一处理。 */
  flexWrap: 'wrap',
  rowGap: '2px',
}

const indexStyle: React.CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  minWidth: '1.2em',
}

/**
 * ⚠⚠ **2026-10-31 P39：`flex: '1 1 auto'` 的文本列必须 `minWidth: 0`** ⚠⚠
 *
 * ── 病（这才是横向溢出的**根因**，不是巧合）──────────────────────
 *   flex 项的 `min-width` 默认是 `auto` ⇒ **不许缩到 `min-content` 以下**
 *   ⇒ 长名称把整行撑破 ⇒ 父行溢出 ⇒ 根容器出横向滚动条。
 *   光给根加 `overflowX: hidden` 只会把**字裁掉**（用户看到「字被切一半」），
 *   ⇒ 必须同时把 `min-width` 从 `auto` 改成 `0`，让这一列**可以被压缩**，
 *      再配 `overflowWrap: 'anywhere'` 让长串（长 id / 长标题）能**断行**而不是硬撑。
 *   ⚠ 三处各自**显式**写 `minWidth: 0`（⛔ 不抽成一个共享常量）—— S-24 要求
 *      「每个 `flex: 1 1 auto` 的文本节点**各自**声明」，抽共享会让"删掉其中一处"
 *      这个负向对拍失去意义。
 */
const nameStyle: React.CSSProperties = { flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere' }

const noteStyle: React.CSSProperties = {
  marginTop: '4px',
  paddingTop: '8px',
  borderTop: '1px solid var(--dsw-alias-border-l4, transparent)',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: '0.9em',
}

/**
 * 右侧栏标签页的面板本体（**只读**）。
 *
 * ── 结构（顶部图例 + 下面进度表）─────────────────────────────────────
 *   ① **四步常量仍作图例留在顶部**（`STAGES_STEP_NAMES`）—— 那是"有哪四步"，与
 *      "某件事停在第几步"是两回事，⛔ 本轮不把图例删掉；
 *   ② 下面接**真进度表**：每行 = 名称 · 第几步 · 卡在谁那里。
 *
 * ── 三态必须各自可读（`R-4`）─────────────────────────────────────────
 *   · 有数据   ⇒ 逐行显示（每行带 `data-dsh-hob="stages-progress-row"`）；
 *   · 真空     ⇒ 写「**表里是空的**」（⛔ 不许写"没有数据"那种含糊话）；
 *   · 判不出   ⇒ 写「**判不出**」+ **一句原因**（⛔ 显示 0 行冒充空）。
 *   ⚠ 第四条（可选）：还在读 ⇒ 写「读取中…」。它不是"空"也不是"判不出"。
 *
 * ── ⛔ 本轮仍不做的东西 ───────────────────────────────────────────────
 *   零百分比、零进度条、零勾选。谁要加"完成度"得先过一次用户裁定。
 *
 * ── ⚠ 为什么要能注入 `fetchProgress`（而是自己 `fetch`）──────────────────
 *   机检（`check:stages-dom`）必须在 **jsdom** 里真挂载一个"有数据 / 真空 / 判不出"
 *   的组件 —— 它不可能真发 HTTP。⇒ 生产路径默认自己发请求（`defaultFetchProgress`），
 *   测试路径注入假函数。⛔ 这不是"为测试改生产语义"：两条路径走的是**同一个**
 *   状态机与同一套渲染分支。
 *
 * @param props - `{ fetchProgress? }`（省略 ⇒ 用默认 HTTP 实现）
 * @returns 图例 + 进度表（三态之一）
 */
export function StagesPanel(props?: {
  fetchProgress?: (sessionId?: string) => Promise<any>
  /** 执行态取数（省略 ⇒ 用默认 HTTP 实现）。⚠ 与 `fetchProgress` 分开注入，两路各自可判不出。 */
  fetchExec?: (sessionId?: string) => Promise<any>
  /**
   * **五步汇总取数**（PRIMARY 数据源：`ledger/units/` 的索引分片）。
   * ⚠ 省略 ⇒ 用 `defaultFetchStages`（生产路径）。
   */
  fetchStages?: (sessionId?: string, ledger?: string) => Promise<any>
  /** **需求链取数**（主视图；省略 ⇒ 用 `defaultFetchChains`）。 */
  fetchChains?: (sessionId?: string, ledger?: string) => Promise<any>
  /**
   * **待确认工具取数**（`R-008` 的界面出口）。
   * ⚠ 省略 ⇒ 用 `defaultFetchUnseen`（生产路径）。
   */
  fetchUnseen?: (sessionId?: string) => Promise<any>
  /** Current 页取数（独立只读区块；失败不遮蔽其它区块）。 */
  fetchCurrent?: (sessionId?: string) => Promise<any>
  /** 工作计划取数（独立只读区块；省略 ⇒ 用默认 HTTP 实现）。 */
  fetchPlans?: (sessionId?: string, ledger?: string) => Promise<any>
  /** 按稳定 ID 读取条目完整详情（省略 ⇒ 用默认 HTTP 实现；只读）。 */
  fetchResource?: (sessionId?: string, resource?: string, ledger?: string) => Promise<any>
  /**
   * **账本目录取数**（2026-11-07 · `R-020`）：列举 `ledgerHome` 下全部账本。
   * ⚠ 省略 ⇒ 用 `defaultFetchLedgers`（生产路径）。
   */
  fetchLedgers?: (sessionId?: string) => Promise<any>
  /**
   * 本会话的 `agentPreset` 投影值。
   * ⚠ 与 `hob-unselected-gate` 同源（宿主 `agentPreset` 投影）；
   *   面板**只服务 Hob 预设** —— 非 Hob 不发起任何请求，只显示一行说明。
   * ⚠ `undefined` = 判不出（显示面板 + 提示），⛔ 不静默隐藏。
   */
  agentPreset?: string | null
  /** 宿主给这个标签页的会话 id（`sidebar.right.pane.tab` 的 inject 第一参）。 */
  sessionId?: string
  /**
   * 轮询间隔（毫秒）。⚠ 缺省 = {@link STAGES_POLL_MS}；机检传一个小值或用假定时器。
   * ⚠ 传 `0` ⇒ **不轮询**（只跑首次 + 手动）—— 机检用它做"不可见时不再调"的对照。
   */
  pollMs?: number
}): React.JSX.Element {
  /**
   * **预设门禁**（2026-11-07 · `R-020`）：面板只服务 Hob 预设。
   *
   * ⚠ 两条入口必须分开：
   *   · `props === undefined`（或**没有** `agentPreset` 属性）= 旧机检夹具形态，
   *     保持可注入；
   *   · 包装器显式传入 `agentPreset`（含 `undefined` / `null`）= 真宿主投影，
   *     **只有 `'Hob'` 放行**，其余一律 fail-closed、零请求。
   *   ⛔ 不把“判不出”当成 Hob，也⛔ 不静默隐藏（早退后只留一行说明）。
   */
  const presetProvided = props !== undefined
    && Object.prototype.hasOwnProperty.call(props, 'agentPreset')
  const isHobPreset = props?.agentPreset === HOB_PRESET_ID
  const blockedByPreset = presetProvided && !isHobPreset
  /**
   * **账本目录**（2026-11-07 · `R-020`）：列举"项目"并支持切换。
   * ⚠ 与另外几路分治：目录读不到 ⛔ 不许把五步抹掉。
   */
  const [ledgerState, setLedgerState] = React.useState<
    | { kind: 'reading' }
    | { kind: 'ok'; home: string; items: any[]; currentResolved: boolean }
    | { kind: 'fail'; reason: string; message: string }
  >({ kind: 'reading' })
  /**
   * **默认账本**（= 服务端按当前工作区标出的 `current`）。
   * ⚠ 与“用户手动选择”分开存：工作区变了，默认要跟着变；
   *   但用户点过下拉之后，不能被下一次轮询覆盖。
   */
  const [defaultLedger, setDefaultLedger] = React.useState<string | undefined>(undefined)
  /** **用户手动选择的账本**；`undefined` = 没选过，使用默认。 */
  const [pickedLedger, setPickedLedger] = React.useState<string | undefined>(undefined)
  /**
   * **下拉菜单是否展开**（2026-11-08 第 2 次修正）。
   *
   * ⚠ 必须受控：选完账本要**自动收起**；`<details>` 默认是一直开着，
   *   用户选完还看到下面挂着一整列 —— 这就是上一版被报“套壳”的观感来源。
   */
  const [ledgerMenuOpen, setLedgerMenuOpen] = React.useState(false)
  /** 实际生效的账本：用户选择优先，其次当前工作区默认。 */
  const selectedLedger = pickedLedger ?? defaultLedger
  const load = React.useMemo(() => {
    const fn = props?.fetchProgress ?? defaultFetchProgress
    return () => fn(props?.sessionId)
  }, [props?.fetchProgress, props?.sessionId])
  const loadExec = React.useMemo(() => {
    const fn = props?.fetchExec ?? defaultFetchExec
    return () => fn(props?.sessionId)
  }, [props?.fetchExec, props?.sessionId])
  const loadStages = React.useMemo(() => {
    const fn = props?.fetchStages ?? defaultFetchStages
    return () => fn(props?.sessionId, selectedLedger)
  }, [props?.fetchStages, props?.sessionId, selectedLedger])
  const loadChains = React.useMemo(() => {
    const fn = props?.fetchChains ?? defaultFetchChains
    return () => fn(props?.sessionId, selectedLedger)
  }, [props?.fetchChains, props?.sessionId, selectedLedger])
  /** 待确认工具只读取数（全局工具面，不随账本切换）。 */
  const loadUnseen = React.useMemo(() => {
    const fn = props?.fetchUnseen ?? defaultFetchUnseen
    return () => fn(props?.sessionId)
  }, [props?.fetchUnseen, props?.sessionId])
  /**
   * 待确认工具取数（`R-008` 的界面出口）。
   * ⚠ 与 `state` / `execState` / `stageState` **四路分治**：这一路读不到 ⛔ 不许把别的抹掉。
   */
  /** 工作计划只取一次；活动与历史两个投影共用这一份响应。 */
  const loadPlans = React.useMemo(() => {
    const fn: (sessionId?: string, ledger?: string) => Promise<any> = props?.fetchPlans ?? (async (sessionId?: string, ledger?: string) => {
      const res = await fetch('/api/dsh-hob/work-plans', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(sessionId === undefined || sessionId === '' ? {} : { sessionId }),
          ...(ledger === undefined || ledger === '' ? {} : { ledger }),
        }),
      })
      if (!res.ok) return { ok: false, reason: 'route-error', message: `HTTP ${res.status}：/api/dsh-hob/work-plans` }
      try { return await res.json() } catch { return { ok: false, reason: 'invalid-json', message: '工作计划路由没有返回 JSON' } }
    })
    return () => fn(props?.sessionId, selectedLedger)
  }, [props?.fetchPlans, props?.sessionId, selectedLedger])
  const loadResource = React.useMemo(() => {
    const fn = props?.fetchResource ?? defaultFetchResource
    return (resource: string) => fn(props?.sessionId, resource, selectedLedger)
  }, [props?.fetchResource, props?.sessionId, selectedLedger])
  /**
   * ⚠ 2026-11-08：`ok` 档多带一份 `stageHealth`（服务端算好的账本缺口清单）。
   *   ⚠ 改前这里只存 `rows`，于是健康清单**拿到了但没被保存** ——
   *     面板看起来"没有在途需求"、派活却被拒，两处读数打架。
   */
  const [state, setState] = React.useState<
    | { kind: 'reading' }
    | { kind: 'ok'; rows: any[]; stageHealth?: { ok: boolean; count: number; problems?: Array<{ rule: string; unit: string; why: string }>; truncated?: boolean } }
    | { kind: 'fail'; reason: string; message: string }
  >({ kind: 'reading' })
  /** 手动刷新的计数（`data-dsh-hob="stages-refresh"` 按钮点一次 +1；仅用于触发重跑）。 */
  const [refreshTick, setRefreshTick] = React.useState(0)
  /**
   * 执行态。（⚠ 与 `state` **分开**：两条路由各判各的 —— 账面读不到不该把执行项也抹掉。）
   */
  /**
   * **账本目录取数**（2026-11-07 · `R-020`）。
   * ⚠ 非 Hob 会话**不发请求**（预设门禁在取数层，而不只是渲染层）。
   */
  React.useEffect(() => {
    if (blockedByPreset) return
    let alive = true
    const fn = props?.fetchLedgers ?? defaultFetchLedgers
    void (async () => {
      try {
        const res = await fn(props?.sessionId)
        if (!alive) return
        if (res !== null && typeof res === 'object' && res.ok === true && Array.isArray(res.items)) {
          setLedgerState({ kind: 'ok', home: String(res.home ?? ''), items: res.items, currentResolved: res.currentResolved === true })
          /**
           * 默认账本 = **当前工作区对应的账本**（服务端按 `session.header.cwd` 标 `current`）。
           *
           * ⚠⚠ 2026-11-08 用户报障「不管哪个工作区打开都落到 dsh-hob」：
           *   服务端解析是对的；旧客户端把“当前工作区”与“用户选择”混在同一个 state 里，
           *   只在首次设一次 ⇒ 换工作区后仍停在上一本。
           *   现在拆成两个 state：`defaultLedger` 每轮跟随服务端 `current`，
           *   `pickedLedger` 只在用户点下拉时写 ⇒ 换工作区自动跟随，用户选择仍优先。
           */
          const cur = res.items.find((x: any) => x?.current === true)
          const curName = typeof cur?.name === 'string' ? cur.name : undefined
          const firstWithData = res.items.find((x: any) => x?.state === 'data')
          const firstDataName = typeof firstWithData?.name === 'string' ? firstWithData.name : undefined
          const firstEmpty = res.items.find((x: any) => x?.state === 'empty')
          const firstEmptyName = typeof firstEmpty?.name === 'string' ? firstEmpty.name : undefined
          const fallback = curName ?? firstDataName ?? firstEmptyName ?? (typeof res.items[0]?.name === 'string' ? res.items[0].name : undefined)
          setDefaultLedger(fallback)
          /** ⚠ 用户选过、但该名字已不在目录里 ⇒ 清掉选择，回落到默认（避免空白面板）。 */
          setPickedLedger((prev) => {
            if (prev === undefined) return prev
            const names = new Set(res.items.map((x: any) => String(x?.name ?? '')))
            return names.has(prev) ? prev : undefined
          })
        } else {
          setLedgerState({
            kind: 'fail',
            reason: String(res?.reason ?? 'unknown'),
            message: String(res?.message ?? '（路由没有给出原因）'),
          })
        }
      } catch (e) {
        if (!alive) return
        setLedgerState({ kind: 'fail', reason: 'network', message: `请求失败：${String((e as Error)?.message ?? e)}` })
      }
    })()
    return () => { alive = false }
  /**
   * ⚠ **刷新节拍也要重取账本目录**（2026-11-08）：
   *   当前工作区变了，服务端 `current` 会变；若只在挂载时取一次，
   *   同一标签页里换工作区后仍停在上一本账。
   *   `refreshTick` 由面板“刷新”按钮与统一轮询推进，与五步/链共用同一 tick。
   */
  }, [props?.fetchLedgers, props?.sessionId, blockedByPreset, refreshTick])

  /**
   * **五步汇总**（PRIMARY）。⚠ 与 `state` / `execState` **三路分治**：
   *   任一路判不出都不许把另外两路抹掉（那是把"一个数据源的问题"放大成"整个面板没用"）。
   */
  const [stageState, setStageState] = React.useState<
    | { kind: 'reading' }
    | { kind: 'ok'; stages: any[]; caps: any[] }
    | { kind: 'fail'; reason: string; message: string }
  >({ kind: 'reading' })
  /** **需求链**（主视图的唯一状态源）；与 `/stages` 分治，任一路失败不遮蔽另一路。 */
  const [chainState, setChainState] = React.useState<
    | { kind: 'reading' }
    | { kind: 'ok'; chains: RequirementChain[]; retiredChains: RequirementChain[]; activeCount: number; completedCount: number; retiredCount: number; historyItemCount: number; unattached: string[] }
    | { kind: 'fail'; reason: string; message: string }
  >({ kind: 'reading' })
  /** 选中的需求（⚠ 切换账本时重置，⛔ 不把上一本的 ID 带过来）。 */
  const [selectedReqId, setSelectedReqId] = React.useState<string | undefined>(undefined)
  /**
   * 展开的步（`Set<number>`）。⚠ **默认展开第一个 `doing` 的步**，其余折叠（任务书 §二②）；
   *   ⛔ 用户手动开合的优先级高于默认值 —— 所以这里只在**首次拿到数据**时算一次默认。
   */
  const [expanded, setExpanded] = React.useState<Set<number>>(new Set())
  const defaultAppliedRef = React.useRef(false)
  const [execState, setExecState] = React.useState<
    | { kind: 'reading' }
    | { kind: 'ok'; items: any[] }
    | { kind: 'fail'; reason: string; message: string }
  >({ kind: 'reading' })
  /**
   * **待确认工具**（`R-008` 的界面出口 · 2026-11-01 P41/R20）。
   * ⚠ 与另外三路分治：这一路读不到 ⛔ 不许把别的抹掉。
   * ⚠ `ok` 分支存的是**整份 `UnseenReport`**（含 `summary` / `names` / `count`）——
   *   `summary` 就是"0 条也要写出 0 条"那句话的唯一来源（`describeUnseen` 已处理），
   *   ⛔ 不在这里另写一份文案（两份文案会漂）。
   */
  const [unseenState, setUnseenState] = React.useState<
    | { kind: 'reading' }
    | { kind: 'ok'; report: any }
    | { kind: 'fail'; reason: string; message: string }
  >({ kind: 'reading' })
  /** 工作计划读数（⚠ 活动 / 历史两个投影共用；失败不遮蔽五步）。 */
  const [plansState, setPlansState] = React.useState<
    | { kind: 'reading' }
    | { kind: 'ok'; report: any }
    | { kind: 'fail'; message: string }
  >({ kind: 'reading' })
  /** 自动轮询的计数：Current / 工作计划子区块与主数据共用同一条刷新节拍。 */
  const [pollTick, setPollTick] = React.useState(0)
  /** 展开详情：按稳定资源 ID 懒读取；⛔ 不改列表主读数。 */
  const [itemDetails, setItemDetails] = React.useState<Record<string, { kind: 'reading' } | { kind: 'ok'; unit: any; presentation?: ItemPresentation } | { kind: 'fail'; message: string }>>({})

  const loadItemDetails = React.useCallback((it: any) => {
    const id = String(it?.id ?? '')
    if (id === '' || itemDetails[id]?.kind === 'ok' || itemDetails[id]?.kind === 'reading') return
    setItemDetails((prev) => ({ ...prev, [id]: { kind: 'reading' } }))
    void (async () => {
      try {
        const resource = readPathOf({ id, kind: String(it?.kind ?? '') })
        const res = await loadResource(resource)
        if (res?.ok === true && res.card?.unit !== undefined) {
          setItemDetails((prev) => ({ ...prev, [id]: { kind: 'ok', unit: res.card.unit, presentation: res.card.presentation } }))
        } else {
          setItemDetails((prev) => ({ ...prev, [id]: { kind: 'fail', message: String(res?.message ?? res?.reason ?? '资源读不到（没有可读原因）') } }))
        }
      } catch (e) {
        setItemDetails((prev) => ({ ...prev, [id]: { kind: 'fail', message: String((e as Error)?.message ?? e) } }))
      }
    })()
  }, [itemDetails, loadResource])

  /**
   * ── 取数（**自动轮询 + 不可见时停 + 手动**）───────────────────────────────
   *
   * ⚠⚠ 任务书 §一A 的四条，逐条落在下面：
   *   · 间隔 {@link STAGES_POLL_MS}（常量，⛔ 不散在代码里）；
   *   · **标签页不可见时停轮询**（`document.visibilitychange`），**回到可见立刻拉一次**；
   *   · **手动刷新**入口（下面那个按钮，`data-dsh-hob="stages-refresh"`）；
   *   · ⚠ **`document` 可能不存在**（jsdom / 非浏览器宿主）⇒ **取不到就只跑首次 + 手动**，
   *     ⛔ 不许抛：`globalThis.document` 判空即可，⛔ 不 try/catch 吞异常式"兼容"。
   */
  React.useEffect(() => {
    /**
     * ⚠ **预设门禁在取数层**（2026-11-07 · `R-020`）：非 Hob 会话**一个请求都不发**。
     *   ⛔ 只在渲染层隐藏不够 —— 那仍会打网络、仍会读账本。
     */
    if (blockedByPreset) return
    let alive = true
    const run = async (): Promise<void> => {
      let res: any
      try {
        res = await load()
      } catch (e) {
        if (!alive) return
        const isStale = e instanceof StaleRouteError
        setState({
          kind: 'fail',
          reason: isStale ? 'stale-route' : 'network',
          message: isStale
            ? `接不上：${String((e as Error)?.message ?? e)}`
            : `请求失败：${String((e as Error)?.message ?? e)}`,
        })
        return
      }
      if (!alive) return
      if (res !== null && typeof res === 'object' && res.ok === true && Array.isArray(res.rows)) {
        setState({
          kind: 'ok',
          rows: res.rows,
          ...(res.stageHealth === undefined || res.stageHealth === null ? {} : { stageHealth: res.stageHealth }),
        })
      } else {
        setState({
          kind: 'fail',
          reason: String(res?.reason ?? 'unknown'),
          message: String(res?.message ?? '（路由没有给出原因）'),
        })
      }
    }
    const runExec = async (): Promise<void> => {
      let res: any
      try {
        res = await loadExec()
      } catch (e) {
        if (!alive) return
        const isStale = e instanceof StaleRouteError
        setExecState({
          kind: 'fail',
          reason: isStale ? 'stale-route' : 'network',
          message: isStale
            ? `接不上：${String((e as Error)?.message ?? e)}`
            : `请求失败：${String((e as Error)?.message ?? e)}`,
        })
        return
      }
      if (!alive) return
      if (res !== null && typeof res === 'object' && res.ok === true && Array.isArray(res.items)) {
        setExecState({ kind: 'ok', items: res.items })
      } else {
        setExecState({
          kind: 'fail',
          reason: String(res?.reason ?? 'unknown'),
          message: String(res?.message ?? '（路由没有给出原因）'),
        })
      }
    }
    /**
     * **五步汇总取数**（PRIMARY）。
     * ⚠ 三态口径与另两路**完全同构**（`R-4`）：读不到 ⇒ 「判不出」+ 一句原因，⛔ 不落成空表。
     */
    const runStages = async (): Promise<void> => {
      let res: any
      try {
        res = await loadStages()
      } catch (e) {
        if (!alive) return
        const isStale = e instanceof StaleRouteError
        setStageState({
          kind: 'fail',
          reason: isStale ? 'stale-route' : 'network',
          message: isStale
            ? `接不上：${String((e as Error)?.message ?? e)}`
            : `请求失败：${String((e as Error)?.message ?? e)}`,
        })
        return
      }
      if (!alive) return
      if (res !== null && typeof res === 'object' && res.ok === true && Array.isArray(res.stages)) {
        /**
         * ⚠ **`next` 必须一起存进 state**（2026-10-31 P42/R4）——
         *   实测踩过：只存 `stages`/`caps` 而把 `next` 漏掉 ⇒ 面板走进
         *   「后端没有返回」那条兜底 ⇒ 真账本明明给出 `accept`，页面却显示「判不出」。
         *   ⚠ 那正是 `TASK-R4.md` §四 明令 ⛔ 不许的两种错之一（"不许显示成空/已完成"的邻居：
         *     把**判得出**的东西显示成**判不出**，同样是假读数）。
         */
        setStageState({
          kind: 'ok',
          stages: res.stages,
          caps: Array.isArray(res.caps) ? res.caps : [],
          next: res.next,
          /**
           * ⚠ **`portfolio` 也必须一起存进 state**（2026-11-01 P40/R6 · `TASK-R6.md` §三）——
           *   漏存 ⇒ 面板永远拿不到它 ⇒ 组合层区块**恒显示「判不出」**。
           *   ⚠ 这正是 `S-18`（真账本数据渲染 · 全文不许出现「判不出」）当场咬出来的：
           *     第一次跑就红了 —— 组合层那一行的「判不出」跑到了读数位置。
           *   ⇒ 存进来（⚠ 不兜底成 `undefined` 之外的任何值：后端没给就是没给，
           *     由 `portfolioBlock` 显示「判不出」，⛔ 不显示 0）。
           */
          portfolio: (res as any).portfolio,
          attention: (res as any).attention,
          summary: (res as any).summary,
          /**
           * ⚠ **`truncated` 必须一起存**（2026-11-07）：服务端在极端规模下会按阶段末尾
           *   少列条目；不存这个字段 ⇒ 面板会把"少列"显示成"账本只有这些"。
           *   缺省 = 没截断（正常线格式，不显示任何额外行）。
           */
          truncated: (res as any).truncated,
          relations: (res as any).relations,
          /** ⚠ 账本健康清单（2026-11-08）：与派活门禁同一份函数的产物，面板只展示。 */
          stageHealth: (res as any).stageHealth,
        } as any)
      } else {
        setStageState({
          kind: 'fail',
          reason: String(res?.reason ?? 'unknown'),
          message: String(res?.message ?? '（路由没有给出原因）'),
        })
      }
    }
    /**
     * **需求链取数**（主视图）。⚠ 与 `/stages` 分治：链读不到时，
     *   仅主视图落「判不出」，⛔ 不把条目/历史一起抹掉。
     */
    const runChains = async (): Promise<void> => {
      let res: any
      try {
        res = await loadChains()
      } catch (e) {
        if (!alive) return
        const isStale = e instanceof StaleRouteError
        setChainState({
          kind: 'fail',
          reason: isStale ? 'stale-route' : 'network',
          message: isStale
            ? `接不上：${String((e as Error)?.message ?? e)}`
            : `请求失败：${String((e as Error)?.message ?? e)}`,
        })
        return
      }
      if (!alive) return
      if (res !== null && typeof res === 'object' && res.ok === true && Array.isArray(res.chains)) {
        setChainState({
          kind: 'ok',
          chains: res.chains,
          retiredChains: Array.isArray(res.retiredChains) ? res.retiredChains : [],
          activeCount: Number(res.activeCount ?? 0),
          completedCount: Number(res.completedCount ?? 0),
          retiredCount: Number(res.retiredCount ?? 0),
          historyItemCount: Number(res.historyItemCount ?? 0),
          unattached: Array.isArray(res.unattached) ? res.unattached.map(String) : [],
        })
      } else {
        setChainState({
          kind: 'fail',
          reason: String(res?.reason ?? 'unknown'),
          message: String(res?.message ?? '（路由没有给出原因）'),
        })
      }
    }
    /**
     * 待确认工具取数（`R-008`）。⚠ 单独一个函数：与三路各自独立，
     *   它失败**只**把这一块落成「判不出」，⛔ 不影响五步树 / 执行态 / 账面表。
     */
    const runUnseen = async (): Promise<void> => {
      let res: any
      try {
        res = await loadUnseen()
      } catch (e) {
        if (!alive) return
        const isStale = e instanceof StaleRouteError
        setUnseenState({
          kind: 'fail',
          reason: isStale ? 'stale-route' : 'network',
          message: isStale
            ? `接不上：${String((e as Error)?.message ?? e)}`
            : `请求失败：${String((e as Error)?.message ?? e)}`,
        })
        return
      }
      if (!alive) return
      /**
       * ⚠ 形状校验照服务端的 `UnseenReport`：`ok===true` 且 `summary` 是**非空字符串**。
       *   ⛔ 不兜底成 `''`：空串就是"没查"与"查了 0 条"混成一团，正是本条要治的病。
       */
      if (res !== null && typeof res === 'object' && res.ok === true && typeof res.summary === 'string' && res.summary !== '') {
        setUnseenState({ kind: 'ok', report: res })
      } else {
        setUnseenState({
          kind: 'fail',
          reason: String(res?.reason ?? 'shape'),
          message: String(res?.message ?? '路由没给出可读的 summary'),
        })
      }
    }
    const runPlans = async (): Promise<void> => {
      let res: any
      try {
        res = await loadPlans()
      } catch (e) {
        if (!alive) return
        setPlansState({ kind: 'fail', message: String((e as Error)?.message ?? e) })
        return
      }
      if (!alive) return
      if (res !== null && typeof res === 'object' && res.ok === true && Array.isArray(res.plans)) {
        setPlansState({ kind: 'ok', report: res })
      } else {
        setPlansState({ kind: 'fail', message: String(res?.message ?? res?.reason ?? '工作计划读不到（没有可读原因）') })
      }
    }
    const pull = (): void => {
      /**
       * ⚠ **旧 `tasks-progress` 只是隐藏的兼容表**（`stages-legacy-account`）。
       *   生产面板不再需要它 ⇒ 未注入 `fetchProgress` 时**不请求**，
       *   避免每 5 秒多打一条无展示作用的旧路由。
       *   ⚠ 机检仍可注入 `fetchProgress` 验证那条兼容线；⛔ 不把注入路径当成生产路径。
       */
      if (props?.fetchProgress !== undefined) void run()
      void runExec(); void runStages(); void runChains(); void runUnseen(); void runPlans()
      setPollTick((n) => n + 1)
    }
    pull()

    /**
     * ⚠ `document` 取不到 ⇒ **只跑首次 + 手动**（⛔ 不抛、⛔ 不装一个假 document）。
     *   `pollMs === 0` 也走这一支（机检用它做对照）。
     */
    const doc: any = (globalThis as any).document
    const interval = props?.pollMs ?? STAGES_POLL_MS
    const canPoll = interval > 0 && doc !== undefined && typeof setInterval === 'function'
    if (!canPoll) {
      return () => { alive = false }
    }

    /**
     * ⚠ 可见性：`doc.visibilityState` 取不到 ⇒ 当作**可见**（保守：宁可多轮询，不许
     *   "因为拿不到状态就永远不刷新" —— 那正是用户抱怨的那个"完全没变化"）。
     */
    const isHidden = (): boolean => {
      try { return doc.visibilityState === 'hidden' } catch { return false }
    }
    let timer: any = null
    const start = (): void => {
      if (timer !== null) return
      timer = setInterval(() => { if (!isHidden()) pull() }, interval)
    }
    const stop = (): void => {
      if (timer === null) return
      try { clearInterval(timer) } catch { /* 忽略 */ }
      timer = null
    }
    if (isHidden()) stop(); else start()

    /** 回到可见 ⇒ **立刻拉一次**（⛔ 不等下一个 tick：等待会让人以为"还是没变化"）。 */
    const onVisibleChange = (): void => {
      if (isHidden()) { stop(); return }
      pull()
      start()
    }
    try { doc.addEventListener?.('visibilitychange', onVisibleChange) } catch { /* 忽略 */ }

    return () => {
      alive = false
      stop()
      try { doc.removeEventListener?.('visibilitychange', onVisibleChange) } catch { /* 忽略 */ }
    }
  }, [load, loadExec, loadStages, loadChains, loadUnseen, loadPlans, props?.pollMs, refreshTick])

  /**
   * 图例（`data-dsh-hob="stages-legend"`）：**只列步名**，不带任何状态词。
   * 2026-10-29 第 9 轮改动的原因见**文件头**（本处刻意不重复那个状态词，
   * 免得"图例附近"的判断被注释里的字面量污染）。
   */
  /**
   * ── 第 4 步「任务执行」的**子项**（2026-10-30 第 17 轮新增）──────────────────
   *
   * ⚠ 子项来源 = 执行态路由的 `items`（一条派发记录 = 一个执行项），
   *   ⛔ **不新开手写表**（任务书 §一C）。
   * ⚠ 每项一行：**目标 · 状态 · 已跑时长 · 重核次数**。
   * ⛔ **零百分比、零进度条、零勾选**（用户已明确否掉完成度）。
   * ⚠ 三态各自可读（`R-4`）：
   *   · 有执行项 ⇒ 逐项（每行带 `data-dsh-hob="stages-exec-item"`）；
   *   · 零执行项 ⇒ {@link STAGES_EXEC_EMPTY_TEXT}（"**现在**没有在跑的活"）；
   *   · 判不出   ⇒ 「判不出」+ **一句原因**（⚠ 句子里**不许出现 `0` 或 `%`**：
   *                那是"判不出"时最容易被滥用的两个假读数，机检会咬住）。
   */
  const execList = ((): React.JSX.Element => {
    if (execState.kind === 'reading') {
      return React.createElement('div', { style: subNoteStyle, 'data-dsh-hob': 'stages-exec-state', 'data-state': 'reading' }, '读取中…')
    }
    if (execState.kind === 'fail') {
      return React.createElement(
        'div',
        { style: subNoteStyle, 'data-dsh-hob': 'stages-exec-state', 'data-state': 'undecidable' },
        React.createElement('div', { style: { fontWeight: 600 } }, STAGES_UNDECIDABLE_TEXT),
        React.createElement('div', { 'data-dsh-hob': 'stages-exec-reason' }, execState.message),
      )
    }
    if (execState.items.length === 0) {
      return React.createElement(
        'div',
        { style: subNoteStyle, 'data-dsh-hob': 'stages-exec-state', 'data-state': 'empty' },
        STAGES_EXEC_EMPTY_TEXT,
      )
    }

    /**
     * ── **两档**（2026-10-30 第 20 轮 · `R-1`）────────────────────────────────
     *
     * ⚠⚠ 改前把 `pending`/`lost`/`closed` 全摊在一个列表里 ⇒ 用户看到的是
     *   一张**历史堆积表**（实测两条已跑 56 时 57 分 / 67 时 15 分，与"此刻在跑"并排）。
     *   ⇒ 现在分两档：`now`（`pending`）在前、`history`（`lost`+`closed`）在后且**默认折叠**。
     *   ⚠ 折叠**只是收起**，⛔ 不是过滤：`<details>` 一展开，27 条一条不少
     *     （那两条 56/67 小时的记录**照实留着**，⛔ 不截断、⛔ 不四舍五入）。
     */
    const nowRows = execState.items.filter((it: any) => it?.bucket === 'now')
    const historyRows = execState.items.filter((it: any) => it?.bucket !== 'now')

    /** 一行执行项（合并行 = `count > 1` 时多一个「共 N 条」）。 */
    const renderItem = (it: any, i: number): React.JSX.Element => React.createElement(
      'div',
      {
        key: `${it?.target ?? 'item'}-${i}`,
        style: subRowStyle,
        'data-dsh-hob': 'stages-exec-item',
        'data-target': String(it?.target ?? ''),
        'data-exec-state': String(it?.state ?? ''),
        'data-bucket': String(it?.bucket ?? ''),
      },
      React.createElement('span', { style: { minWidth: '6.5em', overflowWrap: 'anywhere' } }, String(it?.target ?? '')),
      /**
       * ⚠ 展示词三条互斥（见 {@link execItemLabel}）：现在档 running=执行中 /
       *   历史档无 `elapsedMs`=未开跑 / 历史档有 `elapsedMs`=**曾运行**。
       */
      React.createElement(Tag, { tone: 'neutral' }, execItemLabel(it)),
      React.createElement(
        'span',
        { 'data-dsh-hob': 'stages-exec-unrun-note', style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.9em' } },
        execMergeNote({ count: Number(it?.count ?? 0), unrunCount: Number(it?.unrunCount ?? 0) }),
      ),
      React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.9em' } }, elapsedLabel(it?.elapsedMs, Number(it?.count) > 1)),
      React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.9em' } }, rechecksLabel(it?.rechecks)),
      ...(Number(it?.count) > 1
        ? [React.createElement(
            'span',
            { key: 'count', 'data-dsh-hob': 'stages-exec-count', style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.9em' } },
            `${STAGES_EXEC_COUNT_PREFIX} ${Number(it.count)} ${STAGES_EXEC_COUNT_SUFFIX}`,
          )]
        : []),
    )

    /**
     * 「现在」档：⚠ **零条也要有标题**（否则读者分不清"没有在跑的"与"这一档不存在"）。
     */
    const nowBlock = React.createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: '3px' }, 'data-dsh-hob': 'stages-exec-bucket', 'data-bucket': 'now' },
      React.createElement(
        'div',
        { style: { fontWeight: 600, fontSize: '0.92em' }, 'data-dsh-hob': 'stages-exec-bucket-title' },
        `${EXEC_BUCKET_LABELS.now}`,
      ),
      ...(nowRows.length === 0
        ? [React.createElement(
            'div',
            { key: 'empty-now', style: subNoteStyle, 'data-dsh-hob': 'stages-exec-now-empty' },
            STAGES_EXEC_EMPTY_TEXT,
          )]
        : nowRows.map((it: any, i: number) => renderItem(it, i))),
    )

    /**
     * 「历史」档：**默认折叠**（`<details>` 不带 `open`），标题 = `历史 N 条（默认折叠）`。
     * ⚠ 用 `<details>/<summary>` 是**原生的**折叠：零 JS、可键盘操作、`open` 属性可被机检断言。
     */
    const historyBlock = React.createElement(
      'details',
      { style: { display: 'flex', flexDirection: 'column', gap: '3px' }, 'data-dsh-hob': 'stages-exec-bucket', 'data-bucket': 'history' },
      React.createElement(
        'summary',
        { style: { cursor: 'pointer', fontSize: '0.92em', fontWeight: 600 }, 'data-dsh-hob': 'stages-exec-bucket-title' },
        `${STAGES_EXEC_HISTORY_TITLE_PREFIX} ${historyRows.length} ${STAGES_EXEC_HISTORY_TITLE_SUFFIX}`,
      ),
      ...historyRows.map((it: any, i: number) => renderItem(it, i)),
    )

    return React.createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: '6px' }, 'data-dsh-hob': 'stages-exec-state', 'data-state': 'items' },
      nowBlock,
      ...(historyRows.length === 0 ? [] : [historyBlock]),
    )
  })()

  /**
   * ── **五步树**（2026-10-30 · P3 · 用户原话「这几个是有状态，然后可以展开每一个阶段小节状态」）──
   *
   * 每步一行：`序号 + 步名 + 三态图标 + 完成数/总数`，**点行展开**列出该步的条目。
   * ⚠ 三态只认 `done / doing / todo`（⛔ 百分比、⛔ 进度条、⛔ 勾选）。
   * ⚠ `cap` **单列**在树下面，⛔ 不进分母、⛔ 无完成度。
   * ⚠ 数据源 = `POST /api/dsh-hob/stages`（`ledger/units/` 的索引分片）。
   */
  const stages = stageState.kind === 'ok' ? stageState.stages : []
  const caps = stageState.kind === 'ok' ? stageState.caps : []
  /** 「下一步」一条（⚠ 只读；后端 `buildStages` 已算好，这里只呈现）。 */
  const next = stageState.kind === 'ok' ? (stageState as any).next : undefined
  /** ⚠ 组合层读数（2026-11-01 P40/R6）；读不到 ⇒ `undefined` ⇒ 下面显示「判不出」。 */
  const portfolio = stageState.kind === 'ok' ? (stageState as any).portfolio : undefined
  /** 关系标题共享表（服务端只给每个稳定 ID 一份，避免每条重复父标题）。 */
  const relations = stageState.kind === 'ok' ? ((stageState as any).relations ?? {}) : {}
  /** 紧凑线截断说明（缺省 = 全部条目都在；⛔ 不许当成"没事"而不显示）。 */
  const truncated = stageState.kind === 'ok' ? (stageState as any).truncated : undefined
  /**
   * 一条阶段条目：折叠时固定「ID + 标题 + 状态」，下面最多两条关系/读数；
   * 完整原文、证据和诊断放进原生 `<details>`。旧字段仍保留，缺投影时回退。
   */
  const renderStageItem = (it: any, step: number, keyPrefix: string, index: number): React.JSX.Element => {
    const p = it?.presentation
    const title = typeof p?.displayTitle === 'string' && p.displayTitle !== '' ? p.displayTitle : '判不出标题'
    const relation = p?.relation
    const facts = Array.isArray(p?.facts) ? p.facts : []
    const flags: ItemFlagCode[] = Array.isArray(p?.flags) ? p.flags : []
    const loaded = itemDetails[String(it?.id ?? '')]
    const originalTitle = loaded?.kind === 'ok' && typeof loaded.unit?.title === 'string' ? loaded.unit.title : ''
    const kind = String(it?.kind ?? '')
    /**
     * ⚠⚠ **关系标签以服务端为准**（2026-11-07）：`presentation.relation.label` 是
     *   `item-presentation.ts` 里 `relationOf()` 派生的**唯一事实源**。
     *   客户端此前自己按 `kind` 又写了一份映射 ⇒ **两套事实源**：
     *   服务端把「所属方案」改成别的词时，界面**完全看不出来**（负向对拍实测）。
     *   ⇒ 优先用服务端标签；只有旧线格式没带 `label` 时才回落到下面的映射。
     */
    /**
     * ⚠ 标签从**共享函数**取（与服务端 `relationOf()` 同一份事实源）。
     *   客户端此前自己按 `kind` 又写了一份映射 ⇒ 服务端改标签时界面看不出来
     *   （2026-11-07 负向对拍实测）。
     */
    const relationLabel = relationLabelOf(relation, kind)
    const relationTitle = relation?.id === null || relation?.id === undefined
      ? ''
      : String(relations?.[String(relation.id)] ?? '')
    const relationText = relation === null || relation === undefined
      ? ''
      : relation.state === 'ok' && relation.id !== null
        ? `${relationLabel}  ${String(relation.id)}${relationTitle === '' ? '' : ` · ${relationTitle}`}`
        : `${relationLabel}  判不出${relation.id === null || relation.id === undefined ? '（正式关系缺失）' : `（父级 ${String(relation.id)} 不存在）`}`
    const status = stageStatusLabel(kindOfStep(step), String(it?.status ?? ''))
    return React.createElement(
      'details',
      {
        key: `${keyPrefix}-${it?.id ?? 'it'}-${index}`,
        'data-dsh-hob': 'stages-tree-item',
        'data-item-id': String(it?.id ?? ''),
        'data-kind': String(it?.kind ?? ''),
        style: { ...treeItemStyle, display: 'block', padding: '3px 0' },
        onToggle: (e: any) => { if (e?.currentTarget?.open === true) loadItemDetails(it) },
      },
      React.createElement(
        'summary',
        { style: { cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2, listStyle: 'none' } },
        React.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', rowGap: 1 } },
          React.createElement('span', { 'data-dsh-hob': 'stages-item-id', style: { minWidth: '5.5em', overflowWrap: 'anywhere', color: 'var(--dsw-alias-label-secondary)' } }, String(it?.id ?? '')),
          React.createElement('span', { 'data-dsh-hob': 'stages-item-title', style: { flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere' } }, title),
          React.createElement(
            'span',
            {
              'data-dsh-hob': 'stages-tree-item-status',
              'data-status-known': status.known ? 'true' : 'false',
              style: { minWidth: '4.5em', color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.9em' },
            },
            status.label,
          ),
        ),
        ...(relationText === ''
          ? []
          : [React.createElement('div', { key: 'relation', 'data-dsh-hob': 'stages-item-relation', style: { paddingLeft: '6.1em', color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.86em', overflowWrap: 'anywhere' } }, relationText)]),
        ...(facts.length === 0
          ? []
          : [React.createElement(
              'div',
              { key: 'facts', 'data-dsh-hob': 'stages-item-facts', style: { paddingLeft: '6.1em', color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.84em', overflowWrap: 'anywhere' } },
              facts.slice(0, 2).map((f: any) => Array.isArray(f)
                ? `${String(f[0] ?? '读数')}  ${String(f[1] ?? '判不出')}`
                : `${String(f.label ?? f.key ?? '')}  ${String(f.value ?? '判不出')}`).join(' · '),
            )]),
        ...(flags.length === 0
          ? []
          : [React.createElement(
              'div',
              { key: 'flags', 'data-dsh-hob': 'stages-item-flags', style: { paddingLeft: '6.1em', color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.82em', overflowWrap: 'anywhere' } },
              `⚠ ${flags.map((code) => ITEM_FLAG_MESSAGES[code] ?? String(code)).filter((x: string) => x !== '').join('；')}`,
            )]),
      ),
      React.createElement(
        'div',
        { 'data-dsh-hob': 'stages-item-details', style: { display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0 2px 6.1em', fontSize: '0.84em', color: 'var(--dsw-alias-label-tertiary)', overflowWrap: 'anywhere' } },
        React.createElement('div', { 'data-dsh-hob': 'stages-item-original-title' }, `原始标题  ${originalTitle === '' ? '判不出' : originalTitle}`),
        React.createElement(
          'div',
          { 'data-dsh-hob': 'stages-item-exception' },
          `异常  ${flags.length === 0 ? '无' : flags.map((code) => ITEM_FLAG_MESSAGES[code] ?? String(code)).join('；')}`,
        ),
        ...((): React.ReactNode[] => {
          if (loaded === undefined) return [React.createElement('div', { key: 'detail-lazy-hint', 'data-dsh-hob': 'stages-item-detail-hint' }, '展开后读取完整账本字段')]
          if (loaded.kind === 'reading') return [React.createElement('div', { key: 'detail-reading', 'data-dsh-hob': 'stages-item-detail-state', 'data-state': 'reading' }, '读取中…')]
          if (loaded.kind === 'fail') return [React.createElement('div', { key: 'detail-fail', 'data-dsh-hob': 'stages-item-detail-state', 'data-state': 'undecidable' }, `判不出：${loaded.message}`)]
          /**
           * 展开详情只显示服务端完整投影的中文事实；⛔ 不把英文账本字段名直接打给用户。
           * ⚠ 投影缺失（旧资源路由）⇒ 明写判不出，⛔ 不退回原始字段名冒充统一格式。
           */
          const full = loaded.presentation
          if (full === undefined) {
            return [React.createElement('div', { key: 'detail-no-presentation', 'data-dsh-hob': 'stages-item-detail-state', 'data-state': 'undecidable' }, '判不出：资源路由没有返回完整展示投影')]
          }
          return [React.createElement(
            'div',
            { key: 'detail-lazy', 'data-dsh-hob': 'stages-item-detail-full' },
            ...full.details.filter((f) => f.key !== 'flags').map((f, i) => React.createElement(
              'div',
              { key: `full-${f.key}-${i}`, 'data-dsh-hob': 'stages-item-full-field', 'data-field': f.key, 'data-state': f.state, style: { overflowWrap: 'anywhere' } },
              `${f.label}  ${f.value}`,
            )),
          )]
        })(),
      ),
    )
  }

  /**
   * ⚠ **默认展开该需求链的 `currentStep`**；只算一次，⛔ 不覆盖用户手动开合。
   *   ⚠ 第 4 步的运行态也挂在这个展开体里，所以测试注入 `fetchExec` 后
   *     只要第 4 步是当前步就会真实渲染运行态。
   */
  /**
   * ⚠ 默认展开推迟到主视图区（`selectedCurrentStep` 在那里才算得出来）；
   *   这里只保留 `toggleStep`，避免在声明前引用。
   */

  const toggleStep = (step: number): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(step)) next.delete(step); else next.add(step)
      return next
    })
  }

  /** 五步树的三态（⚠ 读不到就整棵树走「判不出」，⛔ 不假装 0 步）。 */
  /**
   * ── **「下一步」与阻断原因**（2026-10-31 P42/R4 · `TASK-R4.md` §四）────────────
   *
   * ── ⚠⚠ 硬约束（作业书点名，⛔ 一条都不许破）────────────────────────────
   *   · **仍然只读**：零按钮、零勾选、零百分比、零进度条 —— `check:stages-dom` 的
   *     S-1..S-4 已钉住这几条，⛔ 本块一个可交互元素都不加；
   *   · ⛔ **不加横向滚动条**：`wrapStyle` 的 `overflowX: 'hidden'` + 三处 `minWidth: 0`
   *     是既有修法，⛔ 别回退 —— 所以本块的文字用 `overflowWrap: 'anywhere'` 换行，
   *     ⛔ 不设 `minWidth` 硬下界、⛔ 不设 `whiteSpace: 'nowrap'`；
   *   · ⛔ **不引入新的 client 依赖包**：只用 `React.createElement`。
   *
   * ── `undecidable` 的呈现（作业书 §四 明写）──────────────────────────
   *   **明写判不出**：⛔ 不许显示成空、⛔ 不许显示成"已完成"。
   *   ⇒ 走 `STAGES_UNDECIDABLE_TEXT`（既有常量，措辞与别处一致）。
   */
  /**
   * ── **待确认工具**（`R-008` 的界面出口 · 2026-11-01 P41/R20）───────────────────
   *
   * ⚠⚠ `R-008` 的标题是「「被判出」**必须能在界面上看见**，⛔ 不能只落日志」。
   *   只读路由与 `describeUnseen` 早就在（P28 落地），但 `src/client/` **零处**读它
   *   ⇒ 标题这一条一直**没被满足**。本块就是补这一块。
   *
   * ── 三条硬约束（`TASK-R20.md` §一）──────────────────────────────────
   *   ① **0 条也必须写出「0 条」**：文案直接取 `report.summary`（`describeUnseen` 已处理
   *      「没查」与「查了、确实 0」的区分）⇒ ⛔ 本块**不另写一份文案**（两份文案会漂）。
   *   ② **逐名列出**，⛔ 不只给一个数字。
   *   ③ **零写 / 零百分比 / 零进度条 / 零勾选**（`R-005` 咬住这一条）——
   *      ⛔ 本块里**没有任何** button / input / progress / role=checkbox。
   *
   * ⚠ 判不出时明写「判不出」+ 原因（⛔ 不显示成 0 条 —— 那正是把"读不到"说成"查过了"）。
   */
  const unseenBlock = ((): React.JSX.Element => {
    if (unseenState.kind === 'reading') {
      return React.createElement('div', { style: subNoteStyle, 'data-dsh-hob': 'stages-unseen', 'data-state': 'reading' }, '读取中…')
    }
    if (unseenState.kind === 'fail') {
      return React.createElement(
        'div',
        { style: subNoteStyle, 'data-dsh-hob': 'stages-unseen', 'data-state': 'undecidable' },
        React.createElement('div', { style: { fontWeight: 600 } }, STAGES_UNDECIDABLE_TEXT),
        React.createElement('div', { 'data-dsh-hob': 'stages-unseen-reason' }, unseenState.message),
      )
    }
    const report = unseenState.report
    const names: string[] = Array.isArray(report?.names) ? report.names : []
    const count = typeof report?.count === 'number' && Number.isFinite(report.count) ? report.count : names.length
    const items: any[] = Array.isArray(report?.items) ? report.items : []
    /** 按来源前缀分组；⚠ 顺序固定，未匹配的进「其他」，⛔ 不丢任何名字。 */
    const GROUPS = ['mcp__wincu__', 'ego_', 'session_', 'dshm_'] as const
    const groupOf = (name: string): string => GROUPS.find((prefix) => name.startsWith(prefix)) ?? '其他'
    const grouped = [...GROUPS, '其他'].map((label) => ({
      label,
      rows: names.filter((name) => groupOf(name) === label),
    })).filter((group) => group.rows.length > 0)
    const renderName = (n: string, key: string): React.JSX.Element => {
      const why = String(items.find((x) => x?.name === n)?.why ?? '').trim()
      return React.createElement(
        'div',
        { key, 'data-dsh-hob': 'stages-unseen-item', style: { overflowWrap: 'anywhere', paddingLeft: 10, textIndent: '-10px' } },
        `· ${n}${why === '' ? '' : ` — ${why}`}`,
      )
    }
    return React.createElement(
      'div',
      { style: { ...subNoteStyle, display: 'flex', flexDirection: 'column', gap: 3 }, 'data-dsh-hob': 'stages-unseen', 'data-state': 'ok' },
      /**
       * ⚠ `summary` 仍是“0 条也要明写 0 条”的原始读数，但**有名字时不再把整份名单
       *   塞进同一行**：那样会与下面的逐名清单重复两遍（截图实测 117 条 × 2）。
       *   0 条时 summary 本身已经是完整说明，照原样显示。
       */
      React.createElement(
        'details',
        { open: count === 0 ? true : undefined, 'data-dsh-hob': 'stages-unseen-details' },
        React.createElement('summary', { style: { fontWeight: 600, cursor: 'pointer' } }, '待确认工具'),
        React.createElement(
          'div',
          { 'data-dsh-hob': 'stages-unseen-summary', style: count === 0 ? undefined : { color: 'var(--dsw-alias-label-secondary)' } },
          count === 0 ? String(report?.summary ?? '') : `${count} 条待确认`,
        ),
        ...(count === 0
          ? []
          : grouped.map((group) => React.createElement(
              'div',
              { key: `ug-${group.label}`, 'data-dsh-hob': 'stages-unseen-group', 'data-prefix': group.label },
              React.createElement('div', { style: { fontWeight: 600, marginTop: 3 } }, `${group.label} · ${group.rows.length} 条`),
              ...group.rows.map((n, i) => renderName(n, `un-${group.label}-${i}`)),
            ))),
      ),
    )
  })()

  /** 长期能力（`cap` 单列 · ⛔ 不进分母 · ⛔ 无百分比 · ⛔ 无完成度）。 */
  /**
   * ── **项目组合层区块**（2026-11-01 P40/R6 · `TASK-R6.md` §三）──────────────────
   *
   * ── 作业书钉死的四条（⛔ 一条都不许破）──────────────────────────────
   *   · **位置**：放在「卡在哪 / 下一步」**之后**（`TASK-R6.md` §三 明写「⛔ 别打乱既有顺序」）
   *     —— 实际接线在 `secondaryBlock` 内，排在注意力块之前；
   *   · **只要两行**：① 覆盖读数 ② 孤儿逐条点名（为空时**不显示第二行**，
   *     ⛔ 不许显示空行 / 占位符）；
   *   · ⛔ **不许**出现百分比、进度条、"完成度"；⛔ 不许横向滚动（`check:stages-dom` 会咬）
   *     ⇒ 文字走 `overflowWrap: 'anywhere'`，⛔ 不设 `whiteSpace: 'nowrap'` / 硬 `minWidth`；
   *   · **数据读不到 ⇒ 显示「判不出」**，⛔ 不许显示 0、⛔ 不许空白（`CONSTITUTION` §7）。
   *
   * ⚠⚠ **为什么"0 条孤儿"与"判不出"必须分开显示**：
   *   0 条是一条**读数**（查过，确实没人被漏掉）；判不出是**没有读数**。
   *   把后者显示成 0 等于"把一次故障伪装成一次干净的读数"—— 本仓最忌的形态。
   */
  const portfolioBlock = ((): React.JSX.Element | null => {
    if (stageState.kind === 'reading') return null
    if (stageState.kind === 'fail') return null
    const p = portfolio as { counts?: any; orphans?: unknown; orphanNote?: unknown } | undefined
    const counts = p?.counts
    const orphans = Array.isArray(p?.orphans) ? p!.orphans.map((x: unknown) => String(x)) : undefined
    /** ⚠ 第三行用（R7）：有 built 的 task 却没有 pass acc 的需求；⛔ 不是红项。 */
    const builtNoAcc = Array.isArray((p as any)?.builtNoAcc) ? ((p as any).builtNoAcc as unknown[]).map((x) => String(x)) : undefined
    /**
     * ⚠ 判据：`counts` 的四个数**都必须是有限整数**才认这一份读数。
     *   缺一个 ⇒ 「判不出」（⛔ 不许拿 `?? 0` 顶 —— 那会把"没读到"显示成"0 条"）。
     */
    const nums = ['total', 'covered', 'proven', 'orphan']
    const okNums = counts !== undefined && counts !== null
      && nums.every((k) => typeof counts[k] === 'number' && Number.isFinite(counts[k]))
    const head = okNums
      ? `需求覆盖：${counts.covered}/${counts.total} 有 change 承接 · ${counts.proven} 条已有 pass 验收 · ${counts.orphan} 条没人接`
      : STAGES_UNDECIDABLE_TEXT
    return React.createElement(
      'div',
      { style: subNoteStyle, 'data-dsh-hob': 'stages-portfolio', 'data-state': okNums ? 'ok' : 'undecidable' },
      React.createElement('div', { 'data-dsh-hob': 'stages-portfolio-head' }, head),
      /**
       * ⚠ 第二行**只在真有孤儿时**出现（`orphans.length > 0`）。
       *   `okNums === false` 时 `orphans` 一定是 `undefined` ⇒ 也不出第二行（第一行已写「判不出」）。
       */
      ...(okNums && orphans !== undefined && orphans.length > 0
        ? [React.createElement(
          'div',
          { key: 'orphans', 'data-dsh-hob': 'stages-portfolio-orphans' },
          `没人接：${orphans.join(' · ')}`,
        )]
        : []),
      /**
       * ── **第三行**（2026-11-01 P40/R7 · `TASK-R7.md` §三）─────────────────────
       *   `builtNoAcc` 非空时显示「做完了没人验：…」；**为空则整行不出现**（⛔ 不许空行）。
       * ⚠⚠ 这一行的存在理由就是 R6 被退回的那件事：R6 把这三条需求写进了「没人接」，
       *   而它们的真名是「活做完了，缺的是第 5 步」。⇒ 单独一行说出来，
       *   面板才不再需要靠「没人做」去表达它。
       * ⚠ 它⛔ **不是红项**、⛔ 不进 P-1、⛔ 不算百分比。
       */
      ...(okNums && builtNoAcc !== undefined && builtNoAcc.length > 0
        ? [React.createElement(
          'div',
          { key: 'built-no-acc', 'data-dsh-hob': 'stages-portfolio-built-no-acc' },
          `做完了没人验：${builtNoAcc.join(' · ')}`,
        )]
        : []),
    )
  })()

  const capBlock = stageState.kind === 'ok'
    ? React.createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--dsw-alias-border-l4, transparent)' }, 'data-dsh-hob': 'stages-caps' },
      React.createElement('div', { style: { fontWeight: 600, fontSize: '0.92em' } }, STAGES_CAPS_TITLE),
      ...(caps.length === 0
        ? [React.createElement('div', { key: 'none', style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.9em' } }, '（本索引里没有长期能力条目）')]
        : caps.map((c: any, k: number) => React.createElement(
          'div',
          { key: `${c?.id ?? 'cap'}-${k}`, 'data-dsh-hob': 'stages-cap-item', style: treeItemStyle },
          React.createElement('span', { style: { minWidth: '5.5em', overflowWrap: 'anywhere' } }, String(c?.id ?? '')),
          React.createElement('span', { style: { flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere' } }, String(c?.title ?? '')),
          /**
           * ⚠⚠ **2026-10-30 P21 · `cap` 不加"状态"位（这是本轮的判断，理由见下）** ──────
           *
           * ── 判：⛔ 不加**进度式状态标签**，但读写**当下健康度**（`live/degraded/down`）────
           *   ① **它不是进度**：`cap` 不进任何一步的分母、无终态（`CONSTITUTION` §6 / I4）——
           *      给它加一个和五步条目同样形态的"状态位"，会让人以为它也在走那五步
           *      （⚠ 这正是 R-005「零百分比」要防的观感）。
           *   ② **但它有合法封闭集**（`live/degraded/down`，`STAGE_KIND_STATUSES.cap`）——
           *      这个值是**当下健康度**，不是"到哪一步了"。⇒ 用**独立的一栏**表达
           *      （`data-dsh-hob="stages-cap-item-state"`，写在读数**之前**），
           *      ⛔ 不借用条目的 `stages-tree-item-status`（那个位置的语义是"进度状态"）。
           *   ③ ⚠ 为什么不能干脆不显示：`down`/`degraded` 是**要人看见**的（长期能力挂了没人知道
           *      比多一栏更糟）。⇒ 显示，但**换语义、换位置、换数据属性**。
           */
          React.createElement('span', {
            'data-dsh-hob': 'stages-cap-item-state',
            style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.9em', minWidth: '4em' },
          }, stageStatusLabel('cap', String(c?.status ?? '')).label),
          React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.9em' } }, String(c?.lastReading ?? '判不出')),
        ))),
    )
    : null

  /**
   * **注意力视图**（只读派生）：只列需要人或验收方行动的条目。
   * ⚠ 与五步/portfolio 分治；字段缺席 ⇒ 明写「判不出」，⛔ 不渲染成 0 条。
   */
  const attentionBlock = ((): React.JSX.Element => {
    if (stageState.kind === 'reading') {
      return React.createElement('div', { style: subNoteStyle, 'data-dsh-hob': 'stages-attention', 'data-state': 'reading' }, '读取中…')
    }
    if (stageState.kind === 'fail') {
      return React.createElement(
        'div',
        { style: subNoteStyle, 'data-dsh-hob': 'stages-attention', 'data-state': 'undecidable' },
        `判不出：${stageState.message}`,
      )
    }
    const rows = (stageState as any).attention
    if (!Array.isArray(rows)) {
      return React.createElement(
        'div',
        { style: subNoteStyle, 'data-dsh-hob': 'stages-attention', 'data-state': 'undecidable' },
        '判不出：后端没有返回注意力读数',
      )
    }
    return React.createElement(
      'div',
      { style: { ...subNoteStyle, display: 'flex', flexDirection: 'column', gap: 3 }, 'data-dsh-hob': 'stages-attention', 'data-state': rows.length === 0 ? 'empty' : 'rows' },
      React.createElement(
        'div',
        { style: { fontWeight: 600 } },
        /**
         * ⚠ 标题带口径（2026-11-07）：这一块只收**需要人或验收方动手**的
         *   （等用户 / 等验收 / 投递失败 / 阻塞），⛔ 不是"所有未完成条目"。
         *   与阶段地图的「当前相关条目」是两个口径，条数不同是正常的。
         */
        '需要处理（只列需要人或验收方动手的）',
      ),
      ...(rows.length === 0
        ? [React.createElement('div', { key: 'none', 'data-dsh-hob': 'stages-attention-empty' }, '没有需要人或验收方处理的事项')]
        : rows.map((r: any, i: number) => React.createElement(
          'div',
          {
            key: `${String(r?.id ?? 'row')}-${i}`,
            'data-dsh-hob': 'stages-attention-item',
            'data-item-id': String(r?.id ?? ''),
            'data-work-state': String(r?.state ?? ''),
            style: { overflowWrap: 'anywhere', display: 'grid', gridTemplateColumns: 'minmax(5.5em, auto) minmax(4.5em, auto) minmax(0, 1fr)', gap: 8, alignItems: 'baseline', paddingLeft: 0 },
          },
          React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, String(r?.id ?? '')),
          React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, String(r?.label ?? '判不出')),
          React.createElement('span', null, String(r?.why ?? '没给原因')),
        ))),
    )
  })()

  const legend = React.createElement(
    'div',
    { 'data-dsh-hob': 'stages-legend', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
    ...STAGES_STEP_NAMES.map((name, i) => React.createElement(
      'div',
      { key: name, style: rowStyle, 'data-dsh-hob': 'stages-row' },
      React.createElement('span', { style: indexStyle }, String(i + 1)),
      React.createElement(StateDot, { state: 'idle', size: 10 }),
      React.createElement('span', { style: nameStyle }, name),
    )),
  )

  /** 进度表（三态）。 */
  const table = ((): React.JSX.Element => {
    if (state.kind === 'reading') {
      return React.createElement('div', { style: noteStyle, 'data-dsh-hob': 'stages-state', 'data-state': 'reading' }, '读取中…')
    }
    if (state.kind === 'fail') {
      return React.createElement(
        'div',
        { style: noteStyle, 'data-dsh-hob': 'stages-state', 'data-state': 'undecidable' },
        React.createElement('div', { style: { fontWeight: 600 } }, STAGES_UNDECIDABLE_TEXT),
        React.createElement('div', { 'data-dsh-hob': 'stages-reason' }, state.message),
      )
    }
    if (state.rows.length === 0) {
      return React.createElement('div', { style: noteStyle, 'data-dsh-hob': 'stages-state', 'data-state': 'empty' }, STAGES_EMPTY_TEXT)
    }
    return React.createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: '4px' }, 'data-dsh-hob': 'stages-state', 'data-state': 'rows' },
      ...state.rows.map((r, i) => React.createElement(
        'div',
        { key: `${r?.name ?? 'row'}-${i}`, style: rowStyle, 'data-dsh-hob': 'stages-progress-row' },
        React.createElement(StateDot, { state: 'idle', size: 10 }),
        React.createElement('span', { style: nameStyle }, String(r?.name ?? '')),
        React.createElement(Tag, { tone: 'neutral' }, stepLabel(r?.step)),
        React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.9em' } }, String(r?.blockedBy ?? '')),
      )),
    )
  })()

  /**
   * **主视图：在途需求列表 + 选中需求的五步主线**（2026-11-07 · `R-020`）。
   *
   * ⚠ 这里不再有四个一级标签，也不再渲染全局 `summaryCard`：
   *   - 在途列表回答“现在在走哪条需求”；
   *   - 选中需求的五步行回答“走到哪一步”；
   *   - `currentStep` 是**唯一**的当前标记；
   *   - `selectedNextBlock` 读该链自己的 `next`，⛔ 不复用全局 `next`。
   */
  const stageItemsById = new Map<string, any>()
  if (stageState.kind === 'ok') {
    for (const st of stageState.stages) {
      for (const it of Array.isArray(st?.items) ? st.items : []) {
        stageItemsById.set(String(it?.id ?? ''), { ...it, step: Number(st.step) })
      }
    }
  }
  /**
   * ⚠ **运行态 / 计划只属于当前工作区那本账**（2026-11-08）：
   *   它们是会话级读数，没有跨账本语义。用户切到别的账本时，
   *   ⛔ 不许把当前会话的 RUN 计划混进别的项目的主线。
   *   `currentResolved=false`（当前工作区没有对应账本）时也**不显示**，⛔ 不猜。
   */
  const currentLedgerName = ledgerState.kind === 'ok'
    ? (ledgerState.items.find((x: any) => x?.current === true)?.name ?? undefined)
    : undefined
  /**
   * ⚠ 只有**明确知道**「当前工作区账本」且用户选中的是**另一本**时才隐藏。
   *   目录还在读 / 读不到 / 没有当前账本标记时，⛔ 不误伤当前会话的运行态。
   */
  const showsSessionRuntime = !(
    ledgerState.kind === 'ok'
    && currentLedgerName !== undefined
    && selectedLedger !== undefined
    && selectedLedger !== currentLedgerName
  )

  const chains = chainState.kind === 'ok' ? chainState.chains : []
  const inFlight = chains.filter((c) => c.inFlight)
  const completed = chains.filter((c) => c.state === 'completed')
  const retiredChains = chainState.kind === 'ok' ? chainState.retiredChains : []
  /**
   * ⚠ **只把在途需求当主线**。没有在途需求时主线写“没有在途需求”，
   *   ⛔ 不自动把某条已完成需求顶上来 —— 否则同一需求会在主线和底部历史里出现两遍。
   */
  const selectedChain = chains.find((c) => c.reqId === selectedReqId)
    ?? inFlight[0]
    ?? undefined
  const selectedChainId = selectedChain?.reqId
  const selectedChainNext = selectedChain?.next
  const selectedCurrentStep = selectedChain?.currentStep ?? null

  /**
   * ⚠ **默认展开该需求链的 `currentStep`**；只算一次，⛔ 不覆盖用户手动开合。
   *   第 4 步的运行态挂在这个展开体里，所以注入 `fetchExec` 后能真实渲染。
   */
  React.useEffect(() => {
    if (defaultAppliedRef.current) return
    if (selectedCurrentStep === null || selectedCurrentStep === undefined) return
    defaultAppliedRef.current = true
    setExpanded(new Set([selectedCurrentStep]))
  }, [selectedCurrentStep])

  /** 切换账本 ⇒ 清掉上一本的需求选择与展开态，⛔ 不把上一本的 ID 带过来。 */
  React.useEffect(() => {
    setSelectedReqId(undefined)
    defaultAppliedRef.current = false
    setExpanded(new Set())
  }, [selectedLedger])

  /**
   * **账本健康（只读）**（2026-11-08 · 用户报「旧账本梳理不到完全健康」）。
   *
   * ⚠ 它回答一个此前**看不见**的问题：这本账"差什么才算健康"。
   *   改前只有"在途需求 / 五步 / 下一步"——一本**只有一条孤立方案**的账
   *   （`prompt-enhancer-release`）在面板上看起来"没有在途需求"，
   *   而派活又会被拒，两处读数互相打架。
   *
   * ⚠ 数据源 = `stages` 路由返回的 `stageHealth`（服务端用与门禁**同一个**
   *   `stageControlProblems` + `ledgerClosureProblems` 算出来的）——
   *   ⛔ 不在客户端另算一份（两处漂开就会"面板说健康、派活说不行"）。
   * ⚠ 只读：⛔ 零写操作、⛔ 零百分比。
   */
  const healthBlock = ((): React.JSX.Element | null => {
    if (blockedByPreset) return null
    /**
     * ⚠⚠ **数据源是 `stageState`（`/stages` 路由），⛔ 不是 `state`**（2026-11-08 实测踩到）：
     *   `state` 走的是旧的 `/tasks-progress`（线格式是 `{ok, rows}`），
     *   健康清单只在 `/stages` 的返回里。从 `state` 取会**永远是 undefined**
     *   ⇒ 面板"看起来没有缺口"、派活却被拒，两处读数打架。
     */
    if (stageState.kind !== 'ok') return null
    const health = (stageState as any).stageHealth as
      | { ok?: boolean; count?: number; problems?: Array<{ rule?: string; unit?: string; why?: string }>; truncated?: boolean }
      | undefined
    if (health === undefined) return null
    const problems = Array.isArray(health.problems) ? health.problems : []
    if (health.ok === true && problems.length === 0) return null
    return React.createElement(
      'details',
      { 'data-dsh-hob': 'stages-health', 'data-state': problems.length === 0 ? 'ok' : 'unhealthy', style: { fontSize: '0.9em' } },
      React.createElement(
        'summary',
        { style: { cursor: 'pointer', color: 'var(--dsw-alias-state-error-primary)' } },
        `账本健康：${problems.length} 条缺口（先补齐才能派活）`,
      ),
      ...problems.slice(0, 12).map((p, i) => React.createElement(
        'div',
        { key: `health-${i}`, 'data-dsh-hob': 'stages-health-item', style: { paddingLeft: '1.2em', overflowWrap: 'anywhere' } },
        `${String(p.rule ?? '?')} · ${String(p.unit ?? '?')} · ${String(p.why ?? '')}`,
      )),
      ...(problems.length > 12
        ? [React.createElement('div', { key: 'health-more', style: { paddingLeft: '1.2em', color: 'var(--dsw-alias-label-tertiary)' } }, `另有 ${problems.length - 12} 条`)]
        : []),
    )
  })()

  /** 需求列表：只显示在途需求；完成/退役进底部历史。 */
  const inFlightBlock = ((): React.JSX.Element => {
    if (blockedByPreset) return React.createElement('div', null)
    if (chainState.kind === 'reading') {
      return React.createElement('div', { style: subNoteStyle, 'data-dsh-hob': 'stages-inflight', 'data-state': 'reading' }, '读取中…')
    }
    if (chainState.kind === 'fail') {
      /**
       * ⚠⚠ **2026-11-08：这两种失败不是"判不出"，而是"还没开张"**（用户报「全是判不出」）。
       *
       *   `ledger-missing` = 这个项目**还没建账本**；`index-legacy` = 账本**是旧格式**。
       *   两者都**已知**、都有明确下一步，⛔ 不该顶着「判不出」三个字让人去猜。
       *   ⚠ 说法与 `hob_ledger_status` / `hob_ledger_init` 的返回值同源（同一套 reason）。
       *   ⚠ 这里**只在本面板说一次**（下面主线 / 下一步 / 历史不再复述）。
       */
      const knownGap = chainState.reason === 'ledger-missing'
        ? { state: 'not-initialized', title: '这个项目还没有账本', how: '在 Hob 会话里让 Hob 先建账本（`hob_ledger_init`），建好后再回来看进度。' }
        : chainState.reason === 'index-legacy'
          ? { state: 'legacy', title: '这本账是旧格式，现行面板读不进来', how: '需要先按现行格式迁移 `ledger/units/index.toml`；`hob_ledger_init` 会说明要改哪里。' }
          : undefined
      if (knownGap !== undefined) {
        return React.createElement(
          'div',
          { style: subNoteStyle, 'data-dsh-hob': 'stages-inflight', 'data-state': knownGap.state },
          React.createElement('div', { style: { fontWeight: 600 } }, knownGap.title),
          React.createElement('div', { 'data-dsh-hob': 'stages-inflight-reason' }, knownGap.how),
        )
      }
      return React.createElement(
        'div',
        { style: subNoteStyle, 'data-dsh-hob': 'stages-inflight', 'data-state': 'undecidable' },
        React.createElement('div', { style: { fontWeight: 600 } }, STAGES_UNDECIDABLE_TEXT),
        React.createElement('div', { 'data-dsh-hob': 'stages-inflight-reason' }, chainState.message),
      )
    }
    if (inFlight.length === 0) {
      return React.createElement(
        'div',
        { style: subNoteStyle, 'data-dsh-hob': 'stages-inflight', 'data-state': 'empty' },
        completed.length > 0
          ? `没有在途需求 —— ${completed.length} 条需求已走完五步`
          : '没有在途需求',
      )
    }
    return React.createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 3 }, 'data-dsh-hob': 'stages-inflight', 'data-state': 'rows' },
      React.createElement('div', { style: { fontWeight: 600, fontSize: '0.95em' } }, `在途需求（${inFlight.length}）`),
      ...inFlight.map((c) => {
        const isSel = c.reqId === selectedChainId
        const step = c.currentStep === null ? undefined : c.steps.find((s) => s.step === c.currentStep)
        return React.createElement(
          'button',
          {
            key: `inflight-${c.reqId}`,
            type: 'button',
            'data-dsh-hob': 'stages-inflight-item',
            'data-req-id': c.reqId,
            'data-selected': isSel ? 'true' : 'false',
            'aria-pressed': isSel ? 'true' : 'false',
            style: { ...viewTabStyle, textAlign: 'left', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline', fontWeight: isSel ? 600 : 400 },
            onClick: () => setSelectedReqId(c.reqId),
          },
          React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, c.reqId),
          React.createElement('span', { style: { flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere' } }, c.title),
          React.createElement('span', { 'data-dsh-hob': 'stages-inflight-stage', style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.88em' } },
            step === undefined ? STAGES_UNDECIDABLE_TEXT : `${step.name} · ${CHAIN_STATE_TEXT[step.displayState]}`),
          ...(isSel ? [React.createElement('span', { key: 'cur', 'data-dsh-hob': 'stages-inflight-current' }, '已选')] : []),
        )
      }),
    )
  })()

  /** 选中需求的五步：固定序号 / 名称 / 展示态 / 概要 / 条数，点开看该链条目。 */
  const mainlineBlock = ((): React.JSX.Element => {
    if (blockedByPreset) return React.createElement('div', null)
    if (chainState.kind === 'reading') {
      return React.createElement('div', { style: subNoteStyle, 'data-dsh-hob': 'stages-mainline', 'data-state': 'reading' }, '读取中…')
    }
    if (chainState.kind === 'fail') {
      /**
       * ⚠ 空账本（目录存在但没有 `ledger/units/`）会以 `index-unreadable` 返回；
       *   对用户应说“这本账还没有可展示的需求链”，⛔ 不把 ENOENT 原文抛到首屏。
       *   ⚠ 只有**空账本**这一种成因走这句；其它读失败仍是“判不出 + 原因”。
       */
      /**
       * ⚠⚠ **2026-11-08：同一句原因只在首屏出现一次**（用户报「全是判不出」）。
       *
       *   改前这段文案（`判不出：<message>`）在主线性、下一步、历史**各印一遍**，
       *   而 message 本身就有 60+ 字（含绝对路径与 ENOENT 原文）⇒ 首屏被三份同样的
       *   长句占满，读的人反而找不到"那到底该怎么办"。
       *   ⇒ 现在：**在途区（第一处）说完整原因**，其余三处只留状态锚点（`undecidable`），
       *     ⛔ 不再复述 —— 判据仍能按 `data-state` 找到它们。
       */
      return React.createElement('div', { style: subNoteStyle, 'data-dsh-hob': 'stages-mainline', 'data-state': 'undecidable' })
    }
    if (selectedChain === undefined) {
      /**
       * ⚠ **“没有在途”只由在途区说一次**（2026-11-08 用户报「原来的还在」）：
       *   在途区已经写「没有在途需求 —— N 条需求已走完五步」，
       *   主线与下一步再各写一遍就是同一句话出现三次。
       *   ⇒ 没有选中链时，主线保持一个**无内容占位**（data-state=empty），
       *     不再重复计数；历史仍在底部说明 N 条已完成。
       *   ⛔ 不把“全部收口”说成“账本为空”（空账本已在 fail 分支单独处理）。
       */
      return React.createElement('div', { style: subNoteStyle, 'data-dsh-hob': 'stages-mainline', 'data-state': 'empty' })
    }
    /**
     * ⚠ **一棵树、两种 marker**：外层是 `stages-mainline`（R-020 正典），
     *   同一节点同时挂 `stages-tree`（旧判据兼容锚点）。
     *   ⛔ 不再复制第二棵步骤树 —— 那会让同一份数据渲染两遍。
     */
    return React.createElement(
      'div',
      {
        style: { display: 'flex', flexDirection: 'column', gap: 2 },
        'data-dsh-hob': 'stages-mainline',
        'data-view': 'mainline',
        'data-tree': 'stages-tree',
        'data-state': 'rows',
        'data-req-id': selectedChain.reqId,
      },
      React.createElement('div', { style: { fontWeight: 600, fontSize: '0.95em', overflowWrap: 'anywhere' }, 'data-dsh-hob': 'stages-mainline-title' },
        `${selectedChain.state === 'completed' ? '历史' : '当前'}：${selectedChain.reqId}`),
      React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 2 }, 'data-dsh-hob': 'stages-tree', 'data-state': 'rows' },
        ...selectedChain.steps.map((step) => {
          const isCurrent = selectedCurrentStep === step.step
          const isOpen = expanded.has(step.step)
          const items = step.itemIds.map((id) => stageItemsById.get(id)).filter((x) => x !== undefined)
          const legacyState: 'done' | 'doing' | 'todo' = step.displayState === 'done' ? 'done' : step.displayState === 'todo' ? 'todo' : 'doing'
          return React.createElement(
            'div',
            {
              key: `tree-${step.step}`,
              style: { display: 'flex', flexDirection: 'column', gap: 1 },
              'data-dsh-hob': 'stages-tree-step',
              'data-tree-step': 'true',
              'data-mainline-step': 'true',
              'data-step': String(step.step),
              'data-step-state': legacyState,
              ...(isCurrent ? { 'aria-current': 'step' } : {}),
            },
            React.createElement(
              'button',
              {
                type: 'button',
                'data-dsh-hob': 'stages-tree-head',
                'data-mainline-head': 'true',
                'aria-expanded': isOpen ? 'true' : 'false',
                style: { ...treeHeadStyle, cursor: 'pointer' },
                onClick: () => toggleStep(step.step),
              },
              React.createElement('span', { style: { minWidth: '1.2em' } }, String(step.step)),
              React.createElement('span', { style: { minWidth: '3.2em', overflowWrap: 'anywhere' } }, step.name),
              React.createElement('span', { 'data-dsh-hob': 'stages-tree-icon', 'data-mainline-state': 'true', style: { minWidth: '4.2em' } }, `${CHAIN_STATE_ICON[step.displayState]} ${CHAIN_STATE_TEXT[step.displayState]}`),
              React.createElement('span', { 'data-dsh-hob': 'stages-mainline-summary', style: { flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere', color: 'var(--dsw-alias-label-secondary)' } }, step.summary),
              React.createElement('span', { 'data-dsh-hob': 'stages-tree-count', 'data-mainline-count': 'true', style: { minWidth: '3.4em', color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.9em' } }, `${step.done}/${step.total}`),
              React.createElement('span', { 'data-dsh-hob': 'stages-tree-item-count', 'data-mainline-item-count': 'true', style: { minWidth: '3.4em', color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.9em' } }, `${step.total} 条`),
              ...(isCurrent ? [React.createElement('span', { key: 'cur', 'data-dsh-hob': 'stages-current-step', style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '0.88em' } }, '⬅当前')] : []),
              React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, isOpen ? '▾' : '▸'),
            ),
            ...(isOpen
              ? [React.createElement(
                  'div',
                  { key: 'body', style: { display: 'flex', flexDirection: 'column', gap: 1, paddingLeft: '2.2em' }, 'data-dsh-hob': 'stages-tree-body', 'data-mainline-body': 'true' },
                  ...(items.length === 0
                    ? [React.createElement('div', { key: 'none', style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.9em' }, 'data-dsh-hob': 'stages-mainline-empty' }, '这一步还没有条目')]
                    : items.map((it: any, i: number) => renderStageItem(it, step.step, `chain-${step.step}`, i))),
                  ...(step.step === 4 && showsSessionRuntime
                    ? [
                        React.createElement('details', { key: 'exec', 'data-dsh-hob': 'stages-step-exec' },
                          React.createElement('summary', { style: { cursor: 'pointer', fontSize: '0.9em', color: 'var(--dsw-alias-label-tertiary)' } }, '运行态（当前会话 · 默认折叠）'),
                          execList),
                        React.createElement('details', { key: 'plans', 'data-dsh-hob': 'stages-step-plans' },
                          React.createElement('summary', { style: { cursor: 'pointer', fontSize: '0.9em', color: 'var(--dsw-alias-label-tertiary)' } }, '计划与轨道（默认折叠）'),
                          React.createElement(WorkPlanPanel, {
                            sessionId: props?.sessionId,
                            source: plansState,
                            ...(props?.fetchPlans === undefined ? {} : { fetchPlans: props.fetchPlans }),
                          })),
                      ]
                    : []),
                )]
              : []),
          )
        }),
      ),
    )
  })()

  /** 选中需求自己的「卡在哪 / 下一步」；⚠ 不复用全局 `next`。 */
  const selectedNextBlock = ((): React.JSX.Element => {
    if (blockedByPreset) return React.createElement('div', null)
    if (chainState.kind === 'reading') {
      return React.createElement('div', { style: subNoteStyle, 'data-dsh-hob': 'stages-next', 'data-state': 'reading' }, '读取中…')
    }
    if (chainState.kind === 'fail') {
      /** ⚠ 同一条原因只在在途区说（见 `mainlineBlock` 那段注释）。 */
      return React.createElement('div', { style: subNoteStyle, 'data-dsh-hob': 'stages-next', 'data-state': 'undecidable' })
    }
    if (selectedChain === undefined) {
      /** ⚠ 同上：没有在途时结论已在在途区说过，这里不再重复第二句。 */
      return React.createElement('div', { style: subNoteStyle, 'data-dsh-hob': 'stages-next', 'data-state': 'empty' })
    }
    /**
     * ⚠ **主阻断只列第一个**；其余放“另有 N 条”（与旧摘要卡的“最多 3 条”口径不同，
     *   因为这里只给一个结论，不再做第二张结论卡）。⛔ 不复述完整 `why` 两遍。
     */
    const a = selectedChain.next
    const blockers = Array.isArray(a.blockedBy) ? a.blockedBy.map(String) : []
    const why = typeof a.why === 'string' && a.why !== '' ? a.why : STAGES_UNDECIDABLE_TEXT
    return React.createElement(
      'div',
      { style: subNoteStyle, 'data-dsh-hob': 'stages-next', 'data-state': a.kind === 'undecidable' ? 'undecidable' : 'ok', 'data-next-kind': a.kind },
      React.createElement('div', { style: { fontWeight: 600, overflowWrap: 'anywhere' }, 'data-dsh-hob': 'stages-next-line' },
        a.kind === 'undecidable' ? `${STAGES_UNDECIDABLE_TEXT}：${why}` : `下一步：${why}`),
      React.createElement('div', { 'data-dsh-hob': 'stages-next-blocker', style: { overflowWrap: 'anywhere' } },
        blockers.length === 0 ? '卡在哪：没有主阻断' : `卡在哪：${blockers[0]}`),
      ...(blockers.length > 1 ? [React.createElement('div', { key: 'more', 'data-dsh-hob': 'stages-next-blocker-rest' }, `另有 ${blockers.length - 1} 条`)] : []),
    )
  })()

  /** 底部历史：已完成 / 退役需求；每个需求可展开看该链的条目。 */
  const historySection = ((): React.JSX.Element => {
    if (blockedByPreset) return React.createElement('div', null)
    if (chainState.kind === 'reading') {
      return React.createElement('div', { style: subNoteStyle, 'data-dsh-hob': 'stages-history-section', 'data-state': 'reading' }, '读取中…')
    }
    if (chainState.kind === 'fail') {
      /** ⚠ 同一条原因只在在途区说（见 `mainlineBlock` 那段注释）。 */
      return React.createElement('div', { style: subNoteStyle, 'data-dsh-hob': 'stages-history-section', 'data-state': 'undecidable' })
    }
    const total = chainState.kind === 'ok' ? chainState.historyItemCount : 0
    const renderChainHistory = (c: RequirementChain, i: number): React.JSX.Element => React.createElement(
      'details',
      { key: `hist-chain-${c.reqId}-${i}`, 'data-dsh-hob': 'stages-history-chain', 'data-req-id': c.reqId },
      React.createElement('summary', { style: { cursor: 'pointer', fontSize: '0.9em', overflowWrap: 'anywhere' } }, `${c.reqId} · ${c.title}`),
      ...c.steps.map((s) => {
        const items = s.itemIds.map((id) => stageItemsById.get(id)).filter((x) => x !== undefined)
        return React.createElement(
          'div',
          { key: `hist-step-${c.reqId}-${s.step}`, style: { paddingLeft: 10 }, 'data-dsh-hob': 'stages-history-step', 'data-step': String(s.step) },
          React.createElement('div', { style: { fontWeight: 600, fontSize: '0.86em', color: 'var(--dsw-alias-label-tertiary)' } }, `${s.step} ${s.name} · ${CHAIN_STATE_TEXT[s.displayState]}`),
          ...items.map((it: any, k: number) => renderStageItem(it, s.step, `h-${c.reqId}-${s.step}`, k)),
        )
      }),
    )
    return React.createElement(
      'details',
      { 'data-dsh-hob': 'stages-history-section', style: { display: 'flex', flexDirection: 'column', gap: 4 } },
      React.createElement('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, `历史（${completed.length} 条已完成需求 · ${total} 条条目）`),
      ...completed.map(renderChainHistory),
      ...(retiredChains.length === 0
        ? []
        : [React.createElement(
            'details',
            { key: 'retired', 'data-dsh-hob': 'stages-history-retired' },
            React.createElement('summary', { style: { cursor: 'pointer', fontSize: '0.9em', color: 'var(--dsw-alias-label-tertiary)' } }, `已退役需求（${retiredChains.length}）`),
            ...retiredChains.map((c) => React.createElement(
              'details',
              { key: `ret-${c.reqId}`, 'data-dsh-hob': 'stages-history-chain', 'data-req-id': c.reqId, style: subNoteStyle },
              React.createElement('summary', { style: { cursor: 'pointer', overflowWrap: 'anywhere' } }, `${c.reqId} · ${c.title}`),
              React.createElement('div', { style: { paddingLeft: 10 } }, `需求状态：${c.reqStatus === 'retired' ? '已退役' : '已丢弃'} · 历史条目 ${c.itemIds.length} 条`),
            )),
          )]),
    )
  })()

  /** 紧凑线截断说明：它是“为什么少列了”的读数，仍在主线首屏，⛔ 不折叠。 */
  const truncatedNotice = ((): React.JSX.Element | null => {
    if (blockedByPreset) return null
    const t = stageState.kind === 'ok' ? (stageState as any).truncated : undefined
    const omitted = Number(t?.omitted ?? 0)
    if (t === undefined || !Number.isFinite(omitted) || omitted <= 0) return null
    return React.createElement(
      'div',
      { 'data-dsh-hob': 'stages-summary-truncated', style: subNoteStyle },
      `列表范围：另有 ${omitted} 条未随本次返回（${String(t?.reason ?? '响应超过体积上限')}）`,
    )
  })()

  /**
   * **项目选择器**（2026-11-07 · `R-020`；2026-11-08 改成一行下拉）。
   *
   * 用户要求：当前项目名和切换控件在**同一行**，不要再占一整块纵向列表。
   * 结构：`项目：dsh-hob · 292 单元 ▾`，点开才是菜单；菜单里仍按三态分组。
   * ⚠ 默认账本 = 当前工作区对应账本（`current:true`），**不是**“第一个有数据的”。
   *   只有当前工作区没有对应账本时才回落，并明写回落说明。
   */
  const ledgerPicker = ((): React.JSX.Element => {
    if (blockedByPreset) {
      return React.createElement(
        'div',
        { 'data-dsh-hob': 'stages-ledgers', 'data-state': 'blocked-by-preset', style: subNoteStyle },
        '本面板仅用于 Hob 预设的会话；当前会话不是 Hob，故不读取任何账本。',
      )
    }
    if (ledgerState.kind === 'reading') {
      return React.createElement('div', { 'data-dsh-hob': 'stages-ledgers', 'data-state': 'reading', style: subNoteStyle }, '账本：读取中…')
    }
    if (ledgerState.kind === 'fail') {
      return React.createElement(
        'div',
        { 'data-dsh-hob': 'stages-ledgers', 'data-state': 'undecidable', style: subNoteStyle },
        `账本：${STAGES_UNDECIDABLE_TEXT}（${ledgerState.message}）`,
      )
    }
    const items = ledgerState.items
    if (items.length === 0) {
      return React.createElement('div', { 'data-dsh-hob': 'stages-ledgers', 'data-state': 'empty', style: subNoteStyle }, '账本：一个都没有（`ledgerHome` 下没有目录）')
    }
    /**
     * ⚠ **按服务端三态分组**（⛔ 不再用 `readable && units > 0` 猜）：
     *   · `data`：有单元，常显；
     *   · `empty`：目录在、确实没有单元，收起；
     *   · `unreadable`：没有读数，单列并明写“读不了”。
     *   把后两者混成一组，会把“空骨架”说成“坏了”，或把“坏了”说成 0 单元。
     */
    const withData = items.filter((x: any) => x?.state === 'data')
    const empty = items.filter((x: any) => x?.state === 'empty')
    const unreadable = items.filter((x: any) => x?.state !== 'data' && x?.state !== 'empty')
    const row = (x: any): React.JSX.Element => {
      const name = String(x?.name ?? '')
      const units = Number(x?.units ?? 0)
      const state = String(x?.state ?? 'unreadable')
      const isCur = x?.current === true
      const isSel = selectedLedger === name
      return React.createElement(
        'button',
        {
          key: `ledger-${name}`,
          type: 'button',
          'data-dsh-hob': 'stages-ledger-item',
          'data-ledger': name,
          'data-state': state,
          'data-current': isCur ? 'true' : 'false',
          'data-selected': isSel ? 'true' : 'false',
          'aria-pressed': isSel ? 'true' : 'false',
          className: 'dsh-hob-ledger-row',
          /** ⚠ 选完即收起：与原生下拉框的行为一致（⛔ 不把菜单一直挂在下面）。 */
          onClick: () => {
            setPickedLedger(name)
            setLedgerMenuOpen(false)
          },
        },
        React.createElement('span', { className: 'dsh-hob-ledger-row-name' }, `${isCur ? '● ' : ''}${name}`),
        React.createElement('span', { className: 'dsh-hob-ledger-row-meta' },
          state === 'data' ? `${units} 单元` : state === 'empty' ? '空账本' : '读不了'),
      )
    }
    /**
     * 当前选中项（用于同一行的项目名）。⚠ 找不到时如实写判不出，⛔ 不拿第一项冒充。
     */
    const selected = items.find((x: any) => x?.name === selectedLedger)
      ?? items.find((x: any) => x?.current === true)
      ?? withData[0]
      ?? items[0]
    const selectedName = String(selected?.name ?? '判不出')
    const selectedState = String(selected?.state ?? 'unreadable')
    const selectedUnits = Number(selected?.units ?? 0)
    const current = items.find((x: any) => x?.current === true)
    /**
     * **浮层下拉**（2026-11-08 第 2 次修正 · 用户报「又套个壳、原来的还在」）。
     *
     * ── 病（真机 DOM 已核对）──────────────────────────────────────────────
     *   上一版把 `<details>` 的内容留在**正常流**里：展开后菜单把下面整块内容往下推，
     *   而且菜单里还是原来那份**纵向账本列表**（含「空账本 N 个」二级折叠）。
     *   ⇒ 用户看到的是「一行触发 + 里面又套了一份旧列表」，即所谓“套壳”。
     *
     * ── 改法（结构只留一套，⛔ 不新增第二套列表）──────────────────────────
     *   ① 容器 `<details>` 只占**一行**高度，菜单绝对定位浮在内容之上（`position:absolute`），
     *      ⛔ 不再推动下面的在途需求 / 五步主线；
     *   ② 菜单自身限高 + 内部滚动，窄侧栏下也不会把面板撑爆；
     *   ③ 选完自动收起（受控 `open`），行为与下拉框一致；
     *   ④ 菜单里仍按服务端三态分组（data 常显 / empty、unreadable 各自收起），
     *      ⚠ 这三态是判据 S-34b 的被测物，⛔ 不许合并成一组。
     * ⚠ 仍只读：选择账本只改客户端显示，不写账本。
     */
    return React.createElement(
      'details',
      {
        'data-dsh-hob': 'stages-ledgers',
        'data-state': 'rows',
        className: 'dsh-hob-ledger-picker',
        /** ⚠ 浮层锚点：写内联（同菜单那段的理由），不依赖样式表被加载。 */
        style: { position: 'relative', display: 'block' },
        open: ledgerMenuOpen,
        onToggle: (e: React.SyntheticEvent<HTMLDetailsElement>) => {
          const next = e.currentTarget.open
          /** ⚠ 受控写回：只在真变化时 setState，避免 toggle 回环。 */
          if (next !== ledgerMenuOpen) setLedgerMenuOpen(next)
        },
      },
      React.createElement(
        'summary',
        {
          'data-dsh-hob': 'stages-ledgers-summary',
          className: 'dsh-hob-ledger-trigger',
          'aria-haspopup': 'listbox',
          'aria-expanded': ledgerMenuOpen ? 'true' : 'false',
          style: {
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'baseline',
            gap: 6,
            flexWrap: 'wrap',
            fontWeight: 600,
            fontSize: '0.92em',
            /** ⚠ 去掉 `<summary>` 原生三角：只保留行尾那一个箭头，⛔ 不叠两层。 */
            listStyle: 'none',
          },
        },
        React.createElement('span', { className: 'dsh-hob-ledger-label' }, '项目'),
        React.createElement('span', { 'data-dsh-hob': 'stages-ledgers-current-name', className: 'dsh-hob-ledger-name' }, selectedName),
        React.createElement(
          'span',
          { className: 'dsh-hob-ledger-units' },
          selectedState === 'data' ? `${selectedUnits} 单元` : selectedState === 'empty' ? '空账本' : '读不了',
        ),
        React.createElement(
          'span',
          { 'aria-hidden': 'true', className: 'dsh-hob-ledger-caret' },
          /** 用 CSS 随 `details[open]` 翻转；默认收起时朝右。 */
          '▸',
        ),
      ),
      React.createElement(
        'div',
        {
          'data-dsh-hob': 'stages-ledgers-menu',
          className: 'dsh-hob-ledger-menu',
          role: 'group',
          'aria-label': '切换项目账本',
          /**
           * ⚠ 定位/限高**写内联**，不只靠 `panel-styles.ts`：
           *   ① 隔离渲染（jsdom）不注入样式表，判据量不到 `position` ⇒ 会假红；
           *   ② 这条是"⛔ 不许推动下面内容"的**结构约束**，不该依赖某份 CSS 恰好被加载。
           */
          style: {
            position: 'absolute',
            left: 0,
            right: 0,
            top: '100%',
            zIndex: 30,
            marginTop: 4,
            boxSizing: 'border-box',
            maxHeight: 'min(60vh, 320px)',
            overflowY: 'auto',
            padding: 4,
            /**
             * ⚠⚠ **必须自己按 `open` 切 `display`**（2026-11-08 真机量到）：
             *   浏览器对 `<details>` 收起态的隐藏规则是 `display:none`，而内联
             *   `display:flex` 的优先级更高 ⇒ 收起时菜单**仍然显示**（真机 rect 高度 62）。
             *   ⇒ 显式跟随 `ledgerMenuOpen`，收起就是 `none`。
             */
            display: ledgerMenuOpen ? 'flex' : 'none',
            flexDirection: 'column',
            gap: 2,
            border: '0.5px solid var(--dsw-alias-border-l4, rgba(127,127,127,.4))',
            borderRadius: 'var(--dsw-radius-md, 8px)',
            background: 'var(--dsw-alias-bg-layer-1, transparent)',
            boxShadow: '0 6px 18px rgba(0,0,0,.18)',
          },
        },
        ...withData.map(row),
        ...(empty.length === 0
          ? []
          : [React.createElement(
              'div',
              { key: 'ledgers-empty', 'data-dsh-hob': 'stages-ledgers-empty-group', 'data-state': 'empty', className: 'dsh-hob-ledger-group' },
              /**
               * ⚠ **只做小标题，⛔ 不再折叠**（2026-11-08 用户裁定）：
               *   「点项目名就是要能直接切换账本」—— 菜单里再套一层「空账本 N 个」折叠，
               *   等于让用户点两下才看得到可选项，也容易被读成“又套了个壳”。
               *   ⚠ 三态**仍然分开**（S-34b 的被测物）：这里只是把「折叠」降级成「分组标题」。
               */
              React.createElement('div', { className: 'dsh-hob-ledger-group-title' }, `空账本 ${empty.length} 个`),
              ...empty.map(row),
            )]),
        ...(unreadable.length === 0
          ? []
          : [React.createElement(
              'div',
              { key: 'ledgers-unreadable', 'data-dsh-hob': 'stages-ledgers-unreadable-group', 'data-state': 'unreadable', className: 'dsh-hob-ledger-group' },
              React.createElement('div', { className: 'dsh-hob-ledger-group-title' }, `读不了的账本 ${unreadable.length} 个`),
              ...unreadable.map(row),
            )]),
        ...(current === undefined
          ? [React.createElement('div', { key: 'cur-miss', 'data-dsh-hob': 'stages-ledgers-current-missing', className: 'dsh-hob-ledger-note' }, '当前工作区没有对应账本，已回落到第一个有数据的。')]
          : []),
      ),
    )
  })()

  const secondaryBlock = React.createElement(
    'details',
    { 'data-dsh-hob': 'stages-secondary', style: { display: 'flex', flexDirection: 'column', gap: 6 } },
    React.createElement('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, '补充信息（Current / 注意力 / 需求覆盖 / 待确认工具 / 能力）'),
    React.createElement(CurrentPanel, {
      sessionId: props?.sessionId,
      refreshTick: pollTick,
      fetchCurrent: async (sessionId?: string) => loadResource('current'),
      ...(props?.fetchCurrent === undefined ? {} : { fetchCurrent: props.fetchCurrent }),
    }),
    attentionBlock,
    unseenBlock,
    portfolioBlock,
    capBlock,
  )


  /**
   * **非 Hob / 预设判不出：只渲染一行说明，不挂任何子区块。**
   * ⚠ 必须在取数层已经短路（见上方两个 effect）；这里再早退，
   *   是为了保证 `CurrentPanel` / `WorkPlanPanel` 之类的子组件**根本不会挂载**。
   */
  if (blockedByPreset) {
    return React.createElement(
      'div',
      {
        style: wrapStyle,
        'data-dsh-hob': 'stages-panel',
        'data-state': 'blocked-by-preset',
        tabIndex: 0,
        role: 'region',
        'aria-label': `${STAGES_PANEL_TITLE}（仅 Hob 预设）`,
      },
      React.createElement('div', { style: { fontWeight: 600 } }, STAGES_PANEL_TITLE),
      React.createElement(
        'div',
        { 'data-dsh-hob': 'stages-preset-blocked', style: subNoteStyle },
        '本面板仅用于 Hob 预设；当前会话不是 Hob 或预设判不出，未读取任何账本。',
      ),
    )
  }

  return React.createElement(
    'div',
    {
      style: wrapStyle,
      'data-dsh-hob': 'stages-panel',
      /** ⚠ 键盘可达（第 4 条）：可聚焦 + 语义区域 + 可读名字。 */
      tabIndex: 0,
      role: 'region',
      'aria-label': `${STAGES_PANEL_TITLE}（可上下滚动）`,
    },
    React.createElement('div', { style: { fontWeight: 600 } }, STAGES_PANEL_TITLE),
    ledgerPicker,
    healthBlock,
    inFlightBlock,
    mainlineBlock,
    selectedNextBlock,
    truncatedNotice,
    historySection,
    secondaryBlock,
    /**
     * ⚠ **旧「账面」表（`volumes/tasks/INDEX.md`）—— 2026-10-30 P4：视觉隐藏，⛔ DOM 不许删。**
     *   理由：面板现在有两张表，用户会以为是重复渲染（`CHG-261` §四·1）。
     *   ⚠ 但**不许删 DOM**：`check:stages-dom` 的 S-6/S-8* 仍然量它 ——
     *     删了就是"为好看删掉被测物"，那些断言会变成恒绿。
     *   ⇒ `display:none` + `aria-hidden`：视觉上没了，断言仍然读得到。
     */
    React.createElement(
      'div',
      { 'data-dsh-hob': 'stages-legacy-account', style: { display: 'none' }, 'aria-hidden': 'true' },
      React.createElement('div', { style: { marginTop: '8px', fontSize: '0.85em' } }, '账面（旧数据源 · 已隐藏）'),
      legend,
      table,
    ),
    React.createElement(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '8px' }, 'data-dsh-hob': 'stages-actions' },
      React.createElement(
        'button',
        {
          type: 'button',
          'data-dsh-hob': 'stages-refresh',
          style: refreshStyle,
          onClick: () => setRefreshTick((n) => n + 1),
        },
        '刷新',
      ),
      React.createElement(
        'span',
        { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.85em' } },
        `每 ${Math.round((props?.pollMs ?? STAGES_POLL_MS) / 1000)} 秒自动刷新（标签页不可见时停）`,
      ),
    ),
    React.createElement(
      'div',
      { style: noteStyle, 'data-dsh-hob': 'stages-note' },
      '⚠ 只读：本面板没有任何写操作',
    ),
  )
}

export function StagesTabTitle(): React.JSX.Element {
  return React.createElement('span', null, STAGES_PANEL_TITLE)
}

/**
 * **槽用的活面板**：把宿主给的 `sessionId` / `useProjection` 映射成普通 props。
 *
 * ⚠ 为什么单独一层（与 `HobUnselectedGateLive` 同形）：`useProjection('agentPreset')`
 *   是宿主 hook 面，组件本体必须能在 jsdom 里直接挂载、直接传普通值。
 * ⚠ `undefined` = 预设判不出 ⇒ 面板显示“判不出”提示，但**不取数**。
 */
export function StagesPanelLive(props: {
  sessionId?: string
  useProjection?: (key: string) => unknown
}): React.JSX.Element {
  const useProjection = props.useProjection
  const preset = typeof useProjection === 'function'
    ? (useProjection('agentPreset') as string | null | undefined)
    : undefined
  return (StagesPanel as any)({
    sessionId: props.sessionId,
    agentPreset: preset,
  })
}

/**
 * **侧边栏 guide 胶囊的预设门禁**：覆盖同一个 guide entry 的渲染。
 *
 * ⚠ guide 的 `title()` 是同步函数，拿不到会话投影；只靠它返回空串不够。
 *   这里用 `sidebar.right.tab.guide.entry` 的 keyed 槽（`key = STAGES_TAB_ID`）：
 *   - Hob ⇒ 原生胶囊外观，点击由宿主 `onPick` 打开本面板；
 *   - 非 Hob / 判不出 ⇒ 返回 `null`，不出现可点入口。
 * ⚠ 只读：不打开标签、不发请求。
 */
/**
 * 覆盖组件的导航器：**由注册闭包写入**，不依赖宿主传给组件的 props。
 * ⚠ 宿主只把展示字段传给 guide.entry 覆盖组件（实测 `ctx` / `sidebar` 都不在 props 上）。
 */
let stagesGuideNavigate: ((kind: string) => void) | undefined

export function StagesGuideEntry(props: {
  title?: string
  description?: string
  kind?: string
  useProjection?: (key: string) => unknown
  useTabInfo?: () => any
  /** 注册时捕获的 client 上下文；覆盖组件拿不到 `useTabInfo` 时用它导航。 */
  ctx?: any
  /** 注册时捕获的 `sidebarRight` 服务（比运行时 `ctx.get` 更可靠）。 */
  sidebar?: any
}): React.ReactElement | null {
  /**
   * ⚠ 只有**明确非 Hob** 才隐藏；`undefined`（投影未就绪）照常渲染入口，
   *   否则宿主 guide 槽没有 `useProjection` 时会把 Hob 自己的入口一起吞掉。
   *   面板 body 仍负责非 Hob 的零请求门禁。
   */
  if (typeof props.useProjection === 'function') {
    const preset = props.useProjection('agentPreset') as string | null | undefined
    if (preset !== undefined && preset !== null && preset !== HOB_PRESET_ID) return null
  }
  /**
   * ⚠⚠ **返回 `null` = 隐藏；返回 `undefined` = 交回宿主 fallback**（2026-11-08 真机实测）。
   *
   * 事实链：
   *   · keyed 槽命中覆盖 ⇒ 宿主只渲染本组件，**不会**再包 `EntryBox`；
   *   · 覆盖组件只收到 `entryId/kind/title/description`，`useTabInfo` 在 `hookContext` 里、
   *     **没有**作为 prop 传进来 ⇒ 覆盖组件自己无法 `openTab`；
   *   · 真机表现：条目在 DOM 里，但没有按钮、点了没反应。
   * ⇒ 覆盖组件只做**可见性判断**：明确非 Hob ⇒ `null`；其余 ⇒ `undefined`，
   *   由宿主 `fallback: <EntryBox onClick=onPick>` 渲染可点胶囊并完成导航。
   *   ⚠ 面板 body 仍会在非 Hob 时零请求、只显示一行说明。
   */
  /**
   * ⚠⚠ 覆盖命中时宿主**只渲染本组件**，不包 `EntryBox`、也不补 fallback
   *   （返回 `undefined` 会得到空 cell；2026-11-08 真机实测）。
   *   因此本组件必须自己渲染可点整格，并自己导航。
   *
   * 导航来源（按可靠性排序）：
   *   ① `useTabInfo().tab.actions`（宿主若注入）；
   *   ② 注册时捕获的 `ctx.sidebarRight.openTab(kind)`（覆盖组件拿不到 ① 时的真实路径）。
   * ⛔ 不嵌套 `<button>`：整格用 `div role="button"`。
   */
  /**
   * ⚠⚠ **hook 必须在渲染期调用**：`useTabInfo` 在事件回调里调用会触发
   *   React #321（invalid hook call）—— 真机点击“没反应”的真实原因之一。
   */
  const tab = typeof props.useTabInfo === 'function' ? props.useTabInfo() : undefined
  const open = (): void => {
    if (typeof tab?.actions?.openTab === 'function') {
      tab.actions.openTab(String(props.kind ?? STAGES_TAB_KIND), { replaceTab: true })
      if (typeof tab.actions.close === 'function') tab.actions.close()
      return
    }
    /**
     * ⚠ 现取优先：注册时捕获的服务可能是另一个上下文实例；
     *   点击发生在宿主渲染树里，现取的 `sidebarRight` 才是当前会话的导航面。
     */
    const sidebar = (() => {
      try { return props.ctx?.get?.('sidebarRight') } catch { return undefined }
    })() ?? props.sidebar
    if (typeof sidebar?.openTab === 'function') {
      sidebar.openTab(String(props.kind ?? STAGES_TAB_KIND), { replaceTab: true })
      return
    }
    /** ⚠ 最终兜底：注册闭包里的导航器（宿主会丢弃上面两个 prop）。 */
    stagesGuideNavigate?.(String(props.kind ?? STAGES_TAB_KIND))
  }
  return React.createElement(
    'div',
    {
      'data-dsh-hob': 'stages-guide-entry',
      role: 'button',
      tabIndex: 0,
      'aria-label': props.title ?? STAGES_PANEL_TITLE,
      onClick: open,
      onKeyDown: (e: any) => {
        if (e?.key === 'Enter' || e?.key === ' ') { e.preventDefault?.(); open() }
      },
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 3,
        width: '100%',
        boxSizing: 'border-box',
        padding: '14px 20px',
        font: 'inherit',
        textAlign: 'left',
        color: 'inherit',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '0.5px solid var(--dsw-alias-border-l3)',
        borderRadius: 'var(--dsw-radius-xl, 12px)',
        cursor: 'pointer',
      },
    },
    React.createElement('span', { style: { fontWeight: 600, fontSize: 14 } }, props.title ?? STAGES_PANEL_TITLE),
    ...(props.description === undefined ? [] : [React.createElement('span', { key: 'desc', style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, props.description)]),
  )
}

/**
 * 把 guide entry 覆盖注册进 `sidebar.right.tab.guide.entry`。
 *
 * @param ctx - client 根上下文
 * @returns 清理函数
 */
export function bindStagesGuideEntry(ctx: any): () => void {
  if (typeof ctx?.slots?.inject !== 'function') return () => {}
  /**
   * ⚠ 在注册时把 `sidebarRight` 服务捕获下来：覆盖组件运行在宿主渲染树里，
   *   运行时 `ctx.get('sidebarRight')` 可能受上下文边界影响；
   *   捕获后的服务对象与 `openTab` 调用面稳定。
   */
  const sidebarOf = (): any => {
    try { return ctx.get?.('sidebarRight') } catch { return undefined }
  }
  stagesGuideNavigate = (kind: string): void => {
    /**
     * ⚠ 导航面可能晚于 guide 注册就绪（宿主按会话 adopt 右侧栏）。
     *   ⇒ 每次点击现取一次；取不到再退到注册时捕获的那份。
     */
    const sidebar = sidebarOf() ?? capturedSidebar
    if (typeof sidebar?.openTab === 'function') sidebar.openTab(kind, { replaceTab: true })
  }
  const capturedSidebar = sidebarOf()
  const off = ctx.slots.inject('sidebar.right.tab.guide.entry', () => ctx.slots.register({
    name: 'sidebar.right.tab.guide.entry',
    key: STAGES_TAB_ID,
  }, (slotProps: any) => React.createElement(StagesGuideEntry, {
    ...slotProps,
    ctx,
    sidebar: sidebarOf(),
    ...(typeof slotProps?.useProjection === 'function' ? { useProjection: slotProps.useProjection } : {}),
  })))
  return () => {
    if (typeof off?.dispose === 'function') void off.dispose()
  }
}

/**
 * 注册标签页**类型**（stage one）—— 没有它 `openTab(kind)` 必抛。
 *
 * 宿主契约：`SidebarRightTabDefinition`（`…/tab-registry.d.ts:75-120`）要求
 *   `id`（本实现的身份，也是 body 注册的 `key`）、`kind`（`openTab` 用的判别符）、
 *   `title`（打开时抓取的标签文字）。页类型**省略 `patterns`**（按 kind 打开，不认地址）。
 *
 * @param ctx - client 根上下文
 * @returns 清理函数（Fiber 用 `dispose()`，⛔ 不当函数调用）
 */
export function bindStagesTabType(ctx: any): () => void {
  if (typeof ctx?.inject !== 'function') return () => {}
  const off = ctx.inject(['sidebarRightTabs'], (sub: any) => {
    const reg = typeof sub?.get === 'function' ? sub.get('sidebarRightTabs') : undefined
    if (typeof reg?.register !== 'function') return
    const dispose = reg.register({
      id: STAGES_TAB_ID,
      kind: STAGES_TAB_KIND,
      priority: 'extension',
      title: () => STAGES_PANEL_TITLE,
      /**
       * ⚠⚠ **入口就挂在这里**（2026-10-29 第 9 轮 · 用户裁定「放在侧边栏挂载」）。
       *
       * 宿主「开始」页那排工具位**不是槽**，而是每个 tab 类型自己的 `guide` 数组：
       *   `…/dsh-client-ui-sidebar-right/lib/client.js:4734-4738`
       *   `this.guideEntries = this.cached.flatMap((definition) => (definition.guide ?? []).map(…)).sort((l,r) => l.order - r.order)`
       * ⇒ 加一个 `guide` 条目 = 那排多一个胶囊；点它按 `kind` 打开本面板
       *   （`GuideBody` 的 `onPick` → 打开该 kind 的页，见同文件 `:520-527`）。
       * ⚠ `order: 50` 落在「新建终端」(20) 与「会话数据诊断」(60) 之间，不抢先。
       */
      guide: [{
        id: STAGES_GUIDE_ENTRY_ID,
        order: STAGES_GUIDE_ORDER,
        title: () => STAGES_PANEL_TITLE,
        description: () => '五步主线：需求规格 → 验收核对（只读）',
      }],
    })
    return () => { try { dispose?.() } catch { /* 忽略 */ } }
  })
  return () => {
    if (typeof off?.dispose === 'function') void off.dispose()
  }
}

