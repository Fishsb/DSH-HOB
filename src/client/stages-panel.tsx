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
import { StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  EXEC_BUCKET_LABELS,
  EXEC_LABEL_NOT_STARTED,
  EXEC_LABEL_RAN_BEFORE,
  EXEC_PROGRESS_ROUTE_PATH,
  EXEC_STATE_LABELS,
  execMergeNote,
} from '../shared/exec-protocol.ts'

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
export const STAGES_PROGRESS_PATH = '/api/dsh-hob/tasks-progress'

/** 执行态路由路径（⚠ **值来自** `shared/exec-protocol.ts` —— 与服务端同一份，⛔ 不各写一份）。 */
export const STAGES_EXEC_PATH = EXEC_PROGRESS_ROUTE_PATH

/** 五步汇总路由（新数据源 = `ledger-next/units/index.toml`；⛔ 不再读散文账）。 */
export const STAGES_ROUTE_PATH = '/api/dsh-hob/stages'

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
export async function defaultFetchStages(sessionId?: string): Promise<any> {
  const body = sessionId === undefined || sessionId === '' ? {} : { sessionId }
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

export class StaleRouteError extends Error {
  /** @param message - 人读说明（已含路径与状态码） */
  constructor(message: string) {
    super(message)
    this.name = 'StaleRouteError'
  }
}

const wrapStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--dsw-radius-md, 8px)',
  padding: '12px',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
}

const treeHeadStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
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

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
}

const indexStyle: React.CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  minWidth: '1.2em',
}

const nameStyle: React.CSSProperties = { flex: '1 1 auto' }

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
   * **五步汇总取数**（PRIMARY 数据源：`ledger-next/units/index.toml`）。
   * ⚠ 省略 ⇒ 用 `defaultFetchStages`（生产路径）。
   */
  fetchStages?: (sessionId?: string) => Promise<any>
  /** 宿主给这个标签页的会话 id（`sidebar.right.pane.tab` 的 inject 第一参）。 */
  sessionId?: string
  /**
   * 轮询间隔（毫秒）。⚠ 缺省 = {@link STAGES_POLL_MS}；机检传一个小值或用假定时器。
   * ⚠ 传 `0` ⇒ **不轮询**（只跑首次 + 手动）—— 机检用它做"不可见时不再调"的对照。
   */
  pollMs?: number
}): React.JSX.Element {
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
    return () => fn(props?.sessionId)
  }, [props?.fetchStages, props?.sessionId])
  const [state, setState] = React.useState<{ kind: 'reading' } | { kind: 'ok'; rows: any[] } | { kind: 'fail'; reason: string; message: string }>({ kind: 'reading' })
  /**
   * 执行态。（⚠ 与 `state` **分开**：两条路由各判各的 —— 账面读不到不该把执行项也抹掉。）
   */
  /**
   * **五步汇总**（PRIMARY）。⚠ 与 `state` / `execState` **三路分治**：
   *   任一路判不出都不许把另外两路抹掉（那是把"一个数据源的问题"放大成"整个面板没用"）。
   */
  const [stageState, setStageState] = React.useState<
    | { kind: 'reading' }
    | { kind: 'ok'; stages: any[]; caps: any[] }
    | { kind: 'fail'; reason: string; message: string }
  >({ kind: 'reading' })
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
  /** 手动刷新的计数（`data-dsh-hob="stages-refresh"` 按钮点一次 +1；仅用于触发重跑）。 */
  const [refreshTick, setRefreshTick] = React.useState(0)

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
        setState({ kind: 'ok', rows: res.rows })
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
        setStageState({ kind: 'ok', stages: res.stages, caps: Array.isArray(res.caps) ? res.caps : [] })
      } else {
        setStageState({
          kind: 'fail',
          reason: String(res?.reason ?? 'unknown'),
          message: String(res?.message ?? '（路由没有给出原因）'),
        })
      }
    }
    const pull = (): void => { void run(); void runExec(); void runStages() }
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
  }, [load, loadExec, loadStages, props?.pollMs, refreshTick])

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
      React.createElement('span', { style: { minWidth: '6.5em' } }, String(it?.target ?? '')),
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
   * ⚠ 数据源 = `POST /api/dsh-hob/stages`（`ledger-next/units/index.toml`）。
   */
  const stages = stageState.kind === 'ok' ? stageState.stages : []
  const caps = stageState.kind === 'ok' ? stageState.caps : []

  /** ⚠ **默认展开第一个 `doing` 的步**（任务书 §二②）；只算一次，⛔ 不覆盖用户手动开合。 */
  React.useEffect(() => {
    if (defaultAppliedRef.current) return
    if (stageState.kind !== 'ok') return
    defaultAppliedRef.current = true
    const firstDoing = stageState.stages.find((x: any) => x?.state === 'doing')
    if (firstDoing !== undefined && typeof firstDoing.step === 'number') {
      setExpanded(new Set([firstDoing.step]))
    }
  }, [stageState])

  const toggleStep = (step: number): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(step)) next.delete(step); else next.add(step)
      return next
    })
  }

  /** 五步树的三态（⚠ 读不到就整棵树走「判不出」，⛔ 不假装 0 步）。 */
  const stageTree = ((): React.JSX.Element => {
    if (stageState.kind === 'reading') {
      return React.createElement('div', { style: subNoteStyle, 'data-dsh-hob': 'stages-tree', 'data-state': 'reading' }, '读取中…')
    }
    if (stageState.kind === 'fail') {
      return React.createElement(
        'div',
        { style: subNoteStyle, 'data-dsh-hob': 'stages-tree', 'data-state': 'undecidable' },
        React.createElement('div', { style: { fontWeight: 600 } }, STAGES_UNDECIDABLE_TEXT),
        React.createElement('div', { 'data-dsh-hob': 'stages-tree-reason' }, stageState.message),
      )
    }
    return React.createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: '2px' }, 'data-dsh-hob': 'stages-tree', 'data-state': 'rows' },
      ...stages.map((st: any) => {
        const step = Number(st?.step ?? 0)
        const stateRaw = String(st?.state ?? 'todo')
        const state = (stateRaw === 'done' || stateRaw === 'doing' ? stateRaw : 'todo') as 'done' | 'doing' | 'todo'
        const isOpen = expanded.has(step)
        const items = Array.isArray(st?.items) ? st.items : []
        return React.createElement(
          'div',
          { key: `step-${step}`, style: { display: 'flex', flexDirection: 'column', gap: '1px' }, 'data-dsh-hob': 'stages-tree-step', 'data-step': String(step), 'data-step-state': state },
          // ── 行头：整行可点（⚠ 用 button 才有键盘可达性，⛔ 用 div+onClick 糊）──
          React.createElement(
            'button',
            {
              type: 'button',
              'data-dsh-hob': 'stages-tree-head',
              'aria-expanded': isOpen ? 'true' : 'false',
              style: { ...treeHeadStyle, cursor: 'pointer' },
              onClick: () => toggleStep(step),
            },
            React.createElement('span', { style: { minWidth: '1.2em' } }, String(step)),
            React.createElement('span', { style: { minWidth: '4.5em' } }, String(st?.name ?? '')),
            React.createElement('span', { 'data-dsh-hob': 'stages-tree-icon', style: { minWidth: '4.5em' } },
              `${STAGE_STATE_ICON[state]} ${STAGE_STATE_TEXT[state]}`),
            // ⚠ `完成数/总数`（⛔ 百分比）
            React.createElement('span', { 'data-dsh-hob': 'stages-tree-count' }, `${Number(st?.done ?? 0)}/${Number(st?.total ?? 0)}`),
            React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, isOpen ? '▾' : '▸'),
          ),
          // ── 展开体：条目 ──
          ...(isOpen
            ? [React.createElement(
                'div',
                { key: 'body', style: { display: 'flex', flexDirection: 'column', gap: '1px', paddingLeft: '2.2em' }, 'data-dsh-hob': 'stages-tree-body' },
                ...(items.length === 0
                  ? [React.createElement('div', { key: 'none', style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.9em' }, 'data-dsh-hob': 'stages-tree-empty' }, '这一步还没有条目')]
                  : items.map((it: any, k: number) => React.createElement(
                    'div',
                    { key: `${it?.id ?? 'it'}-${k}`, 'data-dsh-hob': 'stages-tree-item', 'data-item-id': String(it?.id ?? ''), style: treeItemStyle },
                    React.createElement('span', { style: { minWidth: '5.5em' } }, String(it?.id ?? '')),
                    React.createElement('span', { style: { flex: '1 1 auto' } }, String(it?.title ?? '')),
                    /**
                     * ⚠⚠ **2026-10-30 P13：这里原来直接打 `it.status` 原文** ⇒ 界面上出现英文
                     *   `running`（用户截图正是这个）。`CHG-272` §三·2 要求走九态中文映射。
                     * ⚠ 用 `EXEC_STATE_LABELS`（唯一真源），⛔ 不在这里另写一份中文。
                     * ⚠ 不是九态的值（如索引里出现未知状态）⇒ **照实打原文 + 「（判不出）」前缀**
                     *   —— ⛔ 不许美化成一个像模像样的中文词（那会把"判不出"说成"读到了"）。
                     */
                    React.createElement(
                      'span',
                      { 'data-dsh-hob': 'stages-tree-item-status', style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.9em' } },
                      (EXEC_STATE_LABELS as Record<string, string>)[String(it?.status ?? '')]
                        ?? `判不出（原值 ${String(it?.status ?? '')}）`,
                    ),
                  ))),
                // ⚠ 第 ④ 步展开体里**直接复用现有执行项**（现在/历史两档）—— ⛔ 不推翻
                ...(step === 4 ? [execList] : []),
              )]
            : []),
        )
      }),
    )
  })()

  /** 长期能力（`cap` 单列 · ⛔ 不进分母 · ⛔ 无百分比 · ⛔ 无完成度）。 */
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
          React.createElement('span', { style: { minWidth: '5.5em' } }, String(c?.id ?? '')),
          React.createElement('span', { style: { flex: '1 1 auto' } }, String(c?.title ?? '')),
          React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.9em' } }, String(c?.lastReading ?? '判不出')),
        ))),
    )
    : null

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


  return React.createElement(
    'div',
    { style: wrapStyle, 'data-dsh-hob': 'stages-panel' },
    React.createElement('div', { style: { fontWeight: 600 } }, STAGES_PANEL_TITLE),
    // ⭐ PRIMARY：五步树（新数据源 = units/index.toml）
    stageTree,
    capBlock,
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
    /**
     * ⚠⚠ **2026-10-30 P13：这里原来还有一份 `stages-exec` 区块（标题 + `execList`），
     *   与树内第 ④ 步展开体**渲染两次**（`CHG-272` §三·1）。
     *   ⇒ **删掉这份树外的**，保留树内那份（`stageTree` 里 `step === 4 ? [execList] : []`）。
     *   ⚠ 删之前已确认树内那份**功能完整**：现在/历史两档、未开跑/曾运行文案、
     *     计数、`stages-exec-item` / `stages-exec-bucket` / `stages-exec-state` 全都还在
     *     （它们都由 `execList` 这一个函数渲染，两份是**同一个 React 元素**，不是两份实现）。
     *   ⚠ 刷新按钮在外层 `stages-actions`，**未受影响**。
     */
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

