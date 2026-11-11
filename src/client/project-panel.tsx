/**
 * 四步主线面板（**第 1 轮：只验位置**）。
 *
 * ── 本文件做什么 ─────────────────────────────────────────────────────
 *   给宿主右侧栏提供一块**只读**面板，竖排四步：
 *     Pipeline v3 stages: requirements / plan / tasks / execution / verification / acceptance / closure
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
 *        ⚠ 真状态只在下面的进度表里（同一条 `rows`），图例只回答"有哪几个阶段"。
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
import { STAGES_PATH, TASKS_PROGRESS_PATH, REQUIREMENT_CHAINS_PATH, LEDGERS_PATH, LEDGER_RESOURCE_PATH } from './routes.ts'
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
/**
 * **S-09：`/stages` 的线格式必须用**服务端那份真类型**，⛔ 不许本地手抄 3 个字段 + `as any`。**
 *
 * ⚠ 改前：state 只声明 `stages` / `caps` / `pipelines` 三个字段，
 *   而写入时实际放了 **10 个**（`next` / `portfolio` / `attention` / `summary` /
 *   `truncated` / `relations` / `stageHealth` …）⇒ 靠 `as any` 蒙混。
 *   ⇒ 服务端改字段名时 **TypeScript 全绿**，面板静默显示「判不出」。
 *
 * ⚠ **为什么这一条比它看上去重要**：`as any` 是 `T-09`（取回即弃）与 `R-24`
 *   （存了不用的字段）的**藏身之处** —— 用真类型后，编辑器会直接标出「声明了但未使用」。
 *
 * ⚠ 只 import **type**（`import type`）：不引入任何运行期依赖，
 *   客户端产物不会因此多一个模块。
 */
import type { StagesOk } from '../shared/stages-index.ts'
import { HOB_PRESET_ID } from '../shared/planning-preset.ts'
/**
 * ⚠⚠ **A 方案（面板迁 i18n）· 第 1 轮**（2026-11-11）：
 *   面板此前**零 i18n 接入**（`t(` 计数 = 0，见 §77 的 O-21 / 裁定 B）。
 *   本轮先接**取词管线**，⛔ 不同时改 216 处文案（那样一轮验不完）。
 *
 *   ⚠ 与另三屏（`settings-panel` / `create-hob-dialog` / `hob-unselected-gate`）**同一条管线**：
 *     各自把词条灌进 `i18n.ts` 的词典层，取词入口始终只有 `t()` 一个。
 */
import { t, addDictionaryLayer } from './i18n.ts'
import { CurrentPanel } from './current-panel.tsx'
// 工作计划面板（第五波）：计划 / 轨道 / 执行者 / 等待关系 / 单轨原因，只读。
// ⚠ R-26：路由常量**只认这一份**（面板内联取数也 import 它），⛔ 不再各写一份字符串。
import { WorkPlanPanel, WORK_PLANS_ROUTE_PATH } from './work-plan-panel.tsx'
import { createLiveClient, type LiveConnectionState } from './live-client.ts'
import {
  LIVE_RECONNECTING_POLL_MS,
  LIVE_SAFETY_POLL_MS,
  LIVE_MAX_FOLLOW_UP_PULLS,
} from '../shared/live-protocol.ts'

type PanelPipeline = RequirementChain['pipeline']

/**
 * Resolve the active stage without letting the legacy chain heuristic win.
 * Pipeline-backed responses use the server's single stage authority. The
 * fallback is only for older fixtures/servers that do not yet send `pipeline`.
 */
function selectedChartStepOf(chain: RequirementChain | undefined): 1 | 2 | 3 | 4 | 5 | 6 | 7 | null {
  if (chain === undefined) return null
  if (chain.pipeline !== undefined) return chain.pipeline.activeStage
  return chain.currentStep ?? null
}

/**
 * Project Pipeline into the legacy next-action wire shape consumed by the
 * current row renderer. This is display-only and deliberately does not create
 * a new stage algorithm.
 */
function nextOfPipeline(chain: RequirementChain | undefined): RequirementChain['next'] | undefined {
  if (chain === undefined) return undefined
  /**
   * Older hosts can return a chain without the v2 projection during a rolling
   * upgrade. They remain readable through their legacy fields, but no gate is
   * inferred and no dispatch right is manufactured.
   */
  if (chain.pipeline === undefined) return chain.next
  /**
   * Once a requirement is approved through the tasks stage, keep the richer
   * chain action (dispatch / accept / blocked). At G1/G2, however, the user gate
   * overrides any old heuristic that might otherwise suggest dispatch.
   */
  if (chain.pipeline.gate === 'G1-requirement' || chain.pipeline.gate === 'G2-plan') {
    return {
      kind: 'wait-user',
      target: chain.pipeline.gate === 'G1-requirement'
        ? chain.pipeline.reqId
        : (chain.pipeline.stages[1]?.itemIds[0] ?? null),
      why: chain.pipeline.nextAction,
      blockedBy: chain.pipeline.blockedBy,
    }
  }
  if (chain.pipeline.state === 'legacy') {
    return {
      kind: 'blocked',
      target: chain.pipeline.reqId,
      why: chain.pipeline.nextAction,
      blockedBy: chain.pipeline.blockedBy,
    }
  }
  return chain.next
}

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
 * **Pipeline v3 stage names** — fixed order, same as the server pipeline.
 *
 * ⚠ Verification and product acceptance are separate. Delivery closure is risk-gated.
 */
export const STAGES_STEP_NAMES = ['需求规格', '实现方案', '任务图', '任务执行', '技术验证', '产品验收', '交付收口'] as const

/**
 * **步号 → kind**（`1..5`）。
 *
 * ⚠ 与账本侧 `src/shared/stages-index.ts` 的 `STAGE_DEFS` **同序**（req/change/task/run/verification/acc/closure）；
 *   ⛔ 这里不 import 服务端模块（客户端包不该拉服务端解析器），所以是一张**三行小表**。
 *   ⚠ 一致性由 `check:stages-route` 的 R-10 咬住（它逐 kind 点验标签表，
 *     若这张表与 `STAGE_DEFS` 漂开，那一步的条目就会全变「判不出」⇒ DOM 断言必红）。
 */
export const STAGE_KIND_BY_STEP: Readonly<Record<number, string>> = {
  1: 'req',
  2: 'change',
  3: 'task',
  4: 'run',
  5: 'verification',
  6: 'acc',
  7: 'closure',
}

/**
 * ⚠ **R-08：legacy 链的第 5 步是「验收核对」= 产品验收**（2026-11-10）。
 *
 * ── 病（实测）──────────────────────────────────────────────────────────────
 *   `LEGACY_STEP_DEFS` 只有 5 步，第 5 步叫「验收核对」、`kind: 'acc'`；
 *   而 v3 是 7 步，第 5 步「技术验证」、第 6 步「产品验收」——**两件事**。
 *   ⇒ legacy 账本的第 5 步若按 `'verification'` 查标签表，
 *     一个**合法的 ACC 状态**（`pass` / `send-back` / `undecidable`）会被查进 VER 的封闭集
 *     ⇒ 印「判不出（原值 pass）」，而**不会报错**（`stageStatusLabel` 只校验"该 kind 的封闭集"，
 *     不反问"这个 status 是否本属另一个 kind"）——**静默错配**。
 *
 * ── 为什么必须与服务端同批改 ────────────────────────────────────────────────
 *   服务端 `requirement-chain` 已把 legacy 第 5 步的条目源改成 `accs`（R-08 三处）。
 *   ⚠ 若客户端表不改 ⇒ **服务端给 ACC、客户端按 VER 解释** ⇒ legacy 第 5 步全部印「判不出」。
 *   ⇒ 两张表（服务端的 `step5Set` 与本表）**必须同时切换**，⛔ 不许只改一边。
 *
 * ⚠ 如何判别 legacy：调用方持有 `chain.pipeline.state === 'legacy'`
 *   （见 `buildRequirementChain`）⇒ 用 {@link kindOfStepFor} 传入。
 */
export const LEGACY_STAGE_KIND_BY_STEP: Readonly<Record<number, string>> = {
  1: 'req',
  2: 'change',
  3: 'task',
  4: 'run',
  /** 旧语义里「验收核对」就是产品验收（verification 是 v3 才独立出来的）。 */
  5: 'acc',
}

/**
 * 取某一步的 kind（判不出 ⇒ 空串，⚠ 让 `stageStatusLabel` 走"未知 kind"那条兜底）。
 *
 * @param legacy - 该链是否 legacy（来自 `chain.pipeline.state === 'legacy'`）。
 *   ⚠ **缺省 false** = v3 口径（保持既有调用方行为不变）。
 */
export function kindOfStep(step: number, legacy = false): string {
  return (legacy ? LEGACY_STAGE_KIND_BY_STEP : STAGE_KIND_BY_STEP)[step] ?? ''
}

/** 「未接线」这个词 —— ⚠ **2026-10-29 第 9 轮起图例不再使用它**（数据已接通，见 `legend` 注释）。
 *  保留导出只为两件事：① 历史/文档一致性；② 判据可以断言「图例区不含它」。 */
export const STAGES_UNWIRED_LABEL = '未接线'

/**
 * ⚠⚠ **面板词条层**（A 方案第 1 轮）：先建**骨架**，⛔ 不是全量。
 *
 *   键集 = 本文件已迁的文案。⚠ 每迁一处就往这里加一条，
 *   并且 `zh` / `en` **键集必须相同**（`check:client` 的 J 家族会逐键核）。
 *
 *   ⚠ 为什么先建层而不是直接改文案：`t()` 的兜底链是
 *     服务 → 本地词典 → **键名本身**。没有词条时它会**把键名当文案显示**
 *     —— 那是本仓明令禁止的形态（J-2「任何取词入口都不许把键名当文案」）。
 *   ⇒ **先有词条，再有调用**，⛔ 不许反过来。
 */
const STAGES_DICT_ZH: Record<string, string> = {
  'stages.panelTitle': '任务进度',
  'stages.undecidable': '判不出',
  'stages.capsTitle': '长期能力（无完成态）',
  /** 三态词（R-4：四态/五态各自可读，⛔ 不许含糊）。 */
  'stages.state.done': '完成',
  'stages.state.doing': '进行中',
  'stages.state.todo': '未开始',
  /** 需求链展示态（五态封闭集）。 */
  'stages.chain.done': '已完成',
  'stages.chain.doing': '进行中',
  'stages.chain.waiting': '等待',
  'stages.chain.blocked': '卡住',
  'stages.chain.todo': '未开始',
  /** 执行态小标题（⚠ 它们是**片段**，由引用方拼句子）。 */
  'stages.exec.empty': '这一项没有在跑的活',
  'stages.exec.historyPrefix': '历史',
  'stages.exec.historySuffix': '条（默认折叠）',
  'stages.exec.countPrefix': '共',
  'stages.exec.countSuffix': '条',
  /**
   * 路由「打错门」的统一措辞（404/405）。
   * ⚠ **它是排查方向的指路牌**：说清「路径没有处理体」= 接线问题，
   *   ⛔ 不是「账本读不到」。两者排查方向完全不同（见 §69 T-17 / §65 O-36）。
   * ⚠ `{path}` / `{status}` 是占位符，由 `routeMissMessage()` 填。
   */
  'stages.routeMiss': '这个路径没有处理体（可能是方法或前缀不对）：{path} · HTTP {status}',
  /**
   * ⚠⚠ **「判不出」不是一个词，是三种语义**（R-4：各自可读，⛔ 不许含糊）。
   *   共用一个键会让界面上的三件事**读起来一样**，而它们的处置完全不同：
   *     · `unknownStage`  —— 阶段号不在封闭集里（**数据**问题）；
   *     · `unknownExec`   —— 执行态不在封闭集里（**数据**问题）；
   *     · `unknownTime`   —— 时长读不出（**读数缺失**，不是数据坏）。
   *   ⇒ 三个键**必须分开**，⛔ 不许为了省一个词条合并。
   */
  'stages.unknownStage': '判不出',
  'stages.unknownExec': '判不出',
  'stages.unknownTime': '判不出',
  /** ⚠ **第四种**：字段**值缺失**（不是数据坏、也不是读数缺失，是这条记录没写这个字段）。 */
  'stages.missingValue': '判不出',
  /** 账本健康缺计数的说明（⚠ 它是**后半句**，前半句「判不出」由调用方拼）。 */
  'stages.healthNoCount': '（本次响应未带缺口计数）',
  /** 旧版账本横幅（整句；⚠ 它含**操作指引**，⛔ 不许只译一半）。 */
  'stages.legacyLedger': '这本账仍是旧版：已有条目只读，不会自动回填批准或风险。新工作请先建一条 v3 需求（R-xxx，pipeline_version=v3），再进入需求确认。',
  'stages.initLedger': '在 Hob 会话里让 Hob 先建账本（`hob_ledger_init`），建好后再回来看进度。',
  'stages.migrateLedger': '需要先按现行格式迁移 `ledger/units/index.toml`；`hob_ledger_init` 会说明要改哪里。',
  'stages.noLedgerAtAll': '账本：一个都没有（`ledgerHome` 下没有目录）',
  'stages.fellBackLedger': '当前工作区没有对应账本，已回落到第一个有数据的。',
  'stages.presetOnlyBanner': '本面板仅用于 Hob 预设的会话；当前会话不是 Hob，故不读取任何账本。',
  'stages.legacyPipelineReadonly': '当前阶段：旧管线只读；如需继续推进，请新建 v3 需求',
  'stages.gate5WaitAccept': 'G5 · 技术验证已通过，等待产品验收',
  /** G1 / G2 门禁（各 3 个占位符）。 */
  'stages.gate1': 'G1 · 等用户确认需求 {req} 第 {rev} 版',
  'stages.gate2': 'G2 · 等用户确认方案 {plan} 第 {rev} 版',
  'stages.gate6': 'G6 · 交付收口（{mode}）',
  'stages.acceptChoices': '接受 / 有条件接受 / 退回 / 延期 / 拒绝',
  'stages.needHumanAction': '需要处理（只列需要人或验收方动手的）',
  'stages.notInResponse': ' 条未随本次返回（响应超体积上限，可按 ID 读全文）',
  'stages.residualUnknown': ' · 残余风险：判不出（ACC 未记录等级）',
  /** 路由给了失败但没给原因（⚠ 5 处共用 —— 用户要能分辨「有原因」与「没给原因」）。 */
  'stages.noRouteReason': '（路由没有给出原因）',
  'stages.noReadableSummary': '路由没给出可读的 summary',
  'stages.missingRelation': '（正式关系缺失）',
  'stages.maxElapsedPrefix': '已跑（最长）：',
  /** ⚠ 响应体为空（5 处共用）—— 与「没有处理体」不同：这是**路由通了但没内容**。 */
  'stages.emptyBody': '空响应体',
  'stages.reading': '读取中…',
  /** 资源路由失败的两档（⚠ 与「空响应体」不同：这是**解析/展示**环节）。 */
  'stages.resourceEmptyPath': '资源路径为空',
  'stages.resourceNoJson': '资源路由没有返回 JSON',
  'stages.plansNoJson': '工作计划路由没有返回 JSON',
  'stages.resourceUnreadable': '资源读不到（没有可读原因）',
  'stages.plansUnreadable': '工作计划读不到（没有可读原因）',
  'stages.noReasonGiven': '没给原因',
  'stages.elapsedPrefix': '已跑：',
  'stages.readingFields': '展开后读取完整账本字段',
  'stages.stepEmpty': '这一步还没有条目',
  'stages.runtimeCollapsed': '运行态（当前会话 · 默认折叠）',
  'stages.plansCollapsed': '计划与轨道（默认折叠）',
  'stages.noBlocker': '卡在哪：没有主阻断',
  'stages.discarded': '已丢弃',
  'stages.responseTooLarge': '响应超过体积上限',
  'stages.ledgerReading': '账本：读取中…',
  'stages.switchLedger': '切换项目账本',
  'stages.modeReading': '推进方式：读取中…',
  'stages.singleSession': '单会话',
  'stages.multiSession': '多会话',
  'stages.sessionPolicy': '本会话策略',
  'stages.legacyMigrate': '旧会话迁移',
  'stages.neverSucceeded': '从未成功',
  'stages.readOnlyNotice': '⚠ 只读：本面板没有任何写操作',
  'stages.capsEmpty': '（本索引里没有长期能力条目）',
  'stages.legacyFormatUnreadable': '这本账是旧格式，现行面板读不进来',
  'stages.sixStagesDone': '当前阶段：六阶段已走完',
  'stages.deliveryPending': '（已过）· 待交付收口',
  'stages.needsReview': ' · 需独立评审',
  'stages.needsDoubleReview': ' · 需双评审',
  'stages.resourceNoPresentation': '判不出：资源路由没有返回完整展示投影',
  'stages.gapCountPrefix': ' 条缺口（先补齐才能派活）',
  'stages.secondsAgo': ' 秒前',
  'stages.legacyBoardHidden': '账面（旧数据源 · 已隐藏）',
  /** ⚠ 下列都含**一个**占位符，由 stageFmt() 填（见它的注释）。 */
  'stages.rematchCount': '重核 {n} 次',
  'stages.inFlightCount': '在途需求（{n}）',
  'stages.retiredCount': '已退役需求（{n}）',
  'stages.latestUnits': '最新 · {n} 单元',
  'stages.migrateUnits': '需迁 v3 · {n} 单元',
  'stages.backupUnits': '备份 · {n} 单元',
  'stages.anotherCount': '另有 {n} 条',
  'stages.blockedOn': '卡在哪：{why}',
  'stages.factUndecidable': '{x}（事实判不出）',
  'stages.awaitUserConfirm': '{name} · 等用户确认',
  /** ⚠ 下列含**多个**占位符（stageFmt 支持任意个）。 */
  'stages.durationHM': '{prefix}{h} 时 {m} 分',
  'stages.durationMS': '{prefix}{m} 分 {sec} 秒',
  'stages.groupCount': '{label} · {n} 条',
  'stages.factWithControl': '{x}（有控制：{mitigation}）',
  'stages.historySummary': '历史（{done} 条已完成需求 · {total} 条条目）',
  'stages.emptyLedgerCount': '空账本 {n} 个',
  'stages.unreadableLedgerCount': '读不了的账本 {n} 个',
  'stages.monitoringNote': ' · 监控 / 回退：{m}',
  'stages.requestFailed': '请求失败：{msg}',
  'stages.fetchTimedOutMsg': '取数超时（{sec} 秒无响应）⇒ 面板本次未能刷新',
  'stages.responsible': '责任方：{who}',
  'stages.residualNote': ' · 残余风险：{r}',
  'stages.inherentRisk': ' 固有风险：{tier}（G2 冻结）',
  'stages.modeUndecidable': '推进方式：判不出（{msg}）',
  'stages.noActiveReq': '没有在途需求 —— {n} 条需求已走完六阶段',
  'stages.doneNotVerified': '做完了没人验：{list}',
  'stages.presetOnlyLine': '本面板仅用于 Hob 预设；当前会话不是 Hob 或预设判不出，未读取任何账本。',
  'stages.liveUndecidable': '实时状态判不出（宿主未提供可见性 / 连接读数）—— 下方数据可能未在刷新',
  'stages.mainlineHint': '六阶段主线：需求规格 → 技术验证 → 产品验收（只读）',
  'stages.extraInfoTitle': '补充信息（Current / 注意力 / 需求覆盖 / 待确认工具 / 能力）',
  'stages.productAccepted': '产品已接受；等待发布 / 回滚 / 监控证据与残余风险接受',
  'stages.editReqHint': '要求修改需求 {req}：<修改意见>',
  'stages.editPlanHint': '要求修改方案 {plan}：<修改意见>',
  'stages.currentStage': '当前阶段：第 {step} 步 · {name} · {action}',
  'stages.riskAndClosure': '风险：{tier}（固有） · 交付：{closure}',
  'stages.modeAndSource2': '推进方式：{mode} · 来源：{source}',
  'stages.acceptorNote': '（接受人：{list}）',
  'stages.retired': '已退役',
  'stages.noneLabel': '无',
  'stages.originalTitle': '原始标题  {v}',
  'stages.flagsLine': '异常  {v}',
  'stages.coverageLine': '需求覆盖：{covered}/{total} 有 change 承接 · {proven} 条已有 pass 验收 · {orphan} 条没人接',
  'stages.acceptanceMaterials': '验收材料：候选 ACC {n} 条。产品确认、技术证据、用户例子逐条结果须在 ACC 内逐项可核。{rest}',
  'stages.confirmReq': '确认需求 {req} 第 {rev} 版',
  'stages.confirmPlan': '确认方案 {plan} 第 {rev} 版，选 <A/B/C>',
  'stages.catalogSummary': '项目梳理：最新 {cur} · 需迁 v3 {out} · 空账 {empty} · 备份 {backup}{rest}',
  'stages.unreadableSuffix': ' · 读不了 {n}',
  'stages.reqStatus': '需求状态：{st} · 历史条目 {n} 条',
  'stages.fetchTimedOut': '取数已超时：面板数据停止刷新（最后一次成功：',
  'stages.retryingPrefix': '）—— 正在按 ',
  'stages.retryingSuffix': ' 秒间隔重试',
  'stages.liveConnected': '实时更新已连接（断线自动重连；另有定时兜底）',
  'stages.liveDegraded': '实时连接不可用，已降级为定时刷新',
  'stages.liveReconnecting': '实时连接断开，正在重连（同时保留定时刷新）',
  'stages.liveConnecting': '正在连接实时更新…',
  /** 账本健康读数（2 处共用）。 */
  'stages.healthPrefix': '账本健康：',
  'stages.attentionUndecidable': '判不出：后端没有返回注意力读数',
  'stages.stageUndecidableNoView': '当前阶段：判不出（响应里没有 Pipeline 视图）',
}
const STAGES_DICT_EN: Record<string, string> = {
  'stages.panelTitle': 'Task progress',
  'stages.undecidable': 'cannot tell',
  'stages.capsTitle': 'Long-lived capabilities (no completion state)',
  'stages.state.done': 'done',
  'stages.state.doing': 'in progress',
  'stages.state.todo': 'not started',
  'stages.chain.done': 'completed',
  'stages.chain.doing': 'in progress',
  'stages.chain.waiting': 'waiting',
  'stages.chain.blocked': 'blocked',
  'stages.chain.todo': 'not started',
  'stages.exec.empty': 'nothing is running for this item',
  'stages.exec.historyPrefix': 'history',
  'stages.exec.historySuffix': 'item(s), collapsed by default',
  'stages.exec.countPrefix': 'total',
  'stages.exec.countSuffix': 'item(s)',
  'stages.routeMiss': 'this path has no handler (wrong method or prefix?): {path} · HTTP {status}',
  'stages.unknownStage': 'cannot tell',
  'stages.unknownExec': 'cannot tell',
  'stages.unknownTime': 'cannot tell',
  'stages.missingValue': 'cannot tell',
  'stages.healthNoCount': ' (this response carried no gap count)',
  'stages.legacyLedger': 'This ledger is still on the old version: existing items are read-only and will not backfill approvals or risk. Start new work with a v3 requirement (R-xxx, pipeline_version=v3), then confirm it.',
  'stages.initLedger': 'In a Hob session ask Hob to init the ledger first (`hob_ledger_init`), then come back to see progress.',
  'stages.migrateLedger': 'Migrate `ledger/units/index.toml` to the current format first; `hob_ledger_init` will say what to change.',
  'stages.noLedgerAtAll': 'Ledger: none at all (no directory under `ledgerHome`)',
  'stages.fellBackLedger': 'This workspace has no matching ledger; fell back to the first one with data.',
  'stages.presetOnlyBanner': 'This panel is only for Hob-preset sessions; the current session is not Hob, so no ledger is read.',
  'stages.legacyPipelineReadonly': 'Current stage: legacy pipeline is read-only; create a v3 requirement to continue',
  'stages.gate5WaitAccept': 'G5 · technical verification passed, waiting for product acceptance',
  'stages.acceptChoices': 'accept / accept with conditions / send back / defer / reject',
  'stages.needHumanAction': 'Needs action (only items a person or acceptor must act on)',
  'stages.notInResponse': ' item(s) not included in this response (response too large; read by ID for full text)',
  'stages.residualUnknown': ' · residual risk: cannot tell (ACC recorded no tier)',
  'stages.noRouteReason': '(the route gave no reason)',
  'stages.noReadableSummary': 'the route gave no readable summary',
  'stages.missingRelation': '(formal relation missing)',
  'stages.maxElapsedPrefix': 'ran (longest): ',
  'stages.emptyBody': 'empty response body',
  'stages.reading': 'loading…',
  'stages.resourceEmptyPath': 'the resource path is empty',
  'stages.resourceNoJson': 'the resource route did not return JSON',
  'stages.plansNoJson': 'the work-plan route did not return JSON',
  'stages.resourceUnreadable': 'resource unreadable (no readable reason given)',
  'stages.plansUnreadable': 'work plan unreadable (no readable reason given)',
  'stages.noReasonGiven': 'no reason given',
  'stages.elapsedPrefix': 'ran: ',
  'stages.readingFields': 'expand to read the full ledger fields',
  'stages.stepEmpty': 'this step has no items yet',
  'stages.runtimeCollapsed': 'runtime (this session · collapsed by default)',
  'stages.plansCollapsed': 'plans and tracks (collapsed by default)',
  'stages.noBlocker': 'blocked on: no primary blocker',
  'stages.discarded': 'discarded',
  'stages.responseTooLarge': 'the response exceeded the size limit',
  'stages.ledgerReading': 'ledger: loading…',
  'stages.switchLedger': 'switch project ledger',
  'stages.modeReading': 'mode: loading…',
  'stages.singleSession': 'single session',
  'stages.multiSession': 'multi session',
  'stages.sessionPolicy': 'this session policy',
  'stages.legacyMigrate': 'legacy session migration',
  'stages.neverSucceeded': 'never succeeded',
  'stages.readOnlyNotice': '⚠ read-only: this panel performs no writes',
  'stages.capsEmpty': '(this index has no long-lived capability entries)',
  'stages.legacyFormatUnreadable': 'this ledger is in the old format; the current panel cannot read it',
  'stages.sixStagesDone': 'current stage: all six stages are done',
  'stages.deliveryPending': '(passed) · awaiting delivery closure',
  'stages.needsReview': ' · needs independent review',
  'stages.needsDoubleReview': ' · needs double review',
  'stages.resourceNoPresentation': 'cannot tell: the resource route returned no full presentation projection',
  'stages.gapCountPrefix': ' gap(s) — fill them before dispatching',
  'stages.secondsAgo': 's ago',
  'stages.legacyBoardHidden': 'board (old data source · hidden)',
  'stages.rematchCount': 'rechecked {n} time(s)',
  'stages.inFlightCount': 'active requirements ({n})',
  'stages.retiredCount': 'retired requirements ({n})',
  'stages.latestUnits': 'latest · {n} unit(s)',
  'stages.migrateUnits': 'needs v3 migration · {n} unit(s)',
  'stages.backupUnits': 'backup · {n} unit(s)',
  'stages.anotherCount': '{n} more',
  'stages.blockedOn': 'blocked on: {why}',
  'stages.factUndecidable': '{x} (the fact cannot be determined)',
  'stages.awaitUserConfirm': '{name} · awaiting user confirmation',
  'stages.durationHM': '{prefix}{h}h {m}m',
  'stages.durationMS': '{prefix}{m}m {sec}s',
  'stages.groupCount': '{label} · {n} item(s)',
  'stages.factWithControl': '{x} (control: {mitigation})',
  'stages.historySummary': 'history ({done} completed requirement(s) · {total} item(s))',
  'stages.emptyLedgerCount': '{n} empty ledger(s)',
  'stages.unreadableLedgerCount': '{n} unreadable ledger(s)',
  'stages.monitoringNote': ' · monitoring / rollback: {m}',
  'stages.requestFailed': 'request failed: {msg}',
  'stages.fetchTimedOutMsg': 'fetch timed out ({sec}s with no response) ⇒ the panel did not refresh',
  'stages.responsible': 'responsible: {who}',
  'stages.residualNote': ' · residual risk: {r}',
  'stages.inherentRisk': ' inherent risk: {tier} (frozen at G2)',
  'stages.modeUndecidable': 'mode: cannot tell ({msg})',
  'stages.noActiveReq': 'no active requirement — {n} requirement(s) finished all six stages',
  'stages.doneNotVerified': 'done but unverified: {list}',
  'stages.presetOnlyLine': 'This panel is only for the Hob preset; this session is not Hob (or the preset cannot be determined), so no ledger was read.',
  'stages.liveUndecidable': 'live state cannot be determined (the host provided no visibility / connection reading) — the data below may not be refreshing',
  'stages.mainlineHint': 'six-stage mainline: requirements → technical verification → product acceptance (read-only)',
  'stages.extraInfoTitle': 'supplementary info (Current / attention / requirement coverage / pending tools / capabilities)',
  'stages.productAccepted': 'product accepted; awaiting release / rollback / monitoring evidence and residual-risk acceptance',
  'stages.editReqHint': 'request changes to requirement {req}: <your comments>',
  'stages.editPlanHint': 'request changes to plan {plan}: <your comments>',
  'stages.currentStage': 'current stage: step {step} · {name} · {action}',
  'stages.riskAndClosure': 'risk: {tier} (inherent) · delivery: {closure}',
  'stages.modeAndSource2': 'mode: {mode} · source: {source}',
  'stages.acceptorNote': '(accepted by: {list})',
  'stages.retired': 'retired',
  'stages.noneLabel': 'none',
  'stages.originalTitle': 'original title {v}',
  'stages.flagsLine': 'anomalies {v}',
  'stages.coverageLine': 'requirement coverage: {covered}/{total} carried by a change · {proven} with a passing acceptance · {orphan} unclaimed',
  'stages.acceptanceMaterials': 'acceptance materials: {n} candidate ACC(s). Product confirmation, technical evidence and per-item example results must each be verifiable inside the ACC.{rest}',
  'stages.confirmReq': 'confirm requirement {req}, revision {rev}',
  'stages.confirmPlan': 'confirm plan {plan}, revision {rev}, choose <A/B/C>',
  'stages.catalogSummary': 'project inventory: latest {cur} · needs v3 migration {out} · empty {empty} · backup {backup}{rest}',
  'stages.unreadableSuffix': ' · unreadable {n}',
  'stages.reqStatus': 'requirement status: {st} · {n} historical item(s)',
  'stages.fetchTimedOut': 'fetch timed out: the panel stopped refreshing (last success: ',
  'stages.retryingPrefix': ') — retrying every ',
  'stages.retryingSuffix': 's',
  'stages.liveConnected': 'live updates connected (auto-reconnect on drop; periodic fallback in place)',
  'stages.liveDegraded': 'live connection unavailable — degraded to periodic refresh',
  'stages.liveReconnecting': 'live connection dropped — reconnecting (periodic refresh still active)',
  'stages.liveConnecting': 'connecting live updates…',
  'stages.healthPrefix': 'ledger health: ',
  'stages.attentionUndecidable': 'cannot tell: the backend returned no attention reading',
  'stages.stageUndecidableNoView': 'current stage: cannot tell (the response carried no Pipeline view)',
  'stages.gate1': 'G1 · awaiting user confirmation of requirement {req}, revision {rev}',
  'stages.gate2': 'G2 · awaiting user confirmation of plan {plan}, revision {rev}',
  'stages.gate6': 'G6 · delivery closure ({mode})',
}
addDictionaryLayer('stages-panel', { zh: STAGES_DICT_ZH, en: STAGES_DICT_EN })

/**
 * 面板取词（⚠ 与另三屏同一入口）。
 *
 * @param key - 词条键（必须在 {@link STAGES_DICT_ZH} 里有条目）。
 * @returns 当前语言的文案；服务与词典都取不到时返回**中文兜底**（⛔ 不返回键名）。
 */
/**
 * 路由「打错门」（404/405）的统一文案。
 *
 * ⚠ **8 个取数函数共用这一句** —— 旧码在 8 处各写一遍字面量，
 *   改一处漏一处就会让用户在某个路由上读到**过时的排查方向**。
 *
 * @param path - 该路由的路径常量。
 * @param status - HTTP 状态码。
 * @returns 可读文案（中文兜底；⛔ 不返回键名）。
 */
/**
 * 带**一个**占位符的取词（{n} / {why} / {x} / {name}）。
 *
 * ⚠ 含插值的文案**不能整串进词条**（占位符名会散落几十处），
 *   也**不能拆成「前缀 + 插值 + 后缀」**（句子结构被拆碎，译者看不懂）。
 *   ⇒ 统一用 {name} 占位符，由本函数替换。
 *
 * @param key - 词条键（值里含 {xxx}）。
 * @param name - 占位符名（不含花括号）。
 * @param value - 要代入的值。
 * @returns 填好的文案；⚠ 词条缺该占位符时**原样返回**（⛔ 不静默吞掉）。
 */
function stageFmt(key: string, vars: Record<string, unknown>): string {
  let out = stageText(key)
  for (const name of Object.keys(vars)) {
    const token = '{' + name + '}'
    /** ⚠ 缺占位符时**不动**（⛔ 不把 `{x}` 漏给用户，也不静默吞掉整句）。 */
    if (out.includes(token)) out = out.split(token).join(String(vars[name]))
  }
  return out
}
function routeMissMessage(path: string, status: number): string {
  const tpl = stageText('stages.routeMiss')
  /**
   * ⚠ 词条缺 `{path}` / `{status}` 时**退回旧字面量**（⛔ 不许留花括号给用户看）。
   *   这层兜底让「词条没建全」退化成**文案稍旧**，而不是**占位符外泄**。
   */
  if (!tpl.includes('{path}')) return `这个路径没有处理体（可能是方法或前缀不对）：${path} · HTTP ${status}`
  return tpl.split('{path}').join(path).split('{status}').join(String(status))
}
function stageText(key: string): string {
  const viaT = t(key)
  /**
   * ⚠ `t()` 在两层都取不到时会**返回键名本身** —— 那条路径不能漏给用户。
   *   ⇒ 这里再兜一层：取到的是键名 ⇒ 退回中文词条（再没有就退回 key，但那说明词条漏了）。
   */
  if (viaT !== key) return viaT
  return STAGES_DICT_ZH[key] ?? key
}

/** 面板标题（⚠ 阶段数变化时同步，⛔ 不许留着旧阶段数骗人）。 */
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
/** LEGACY：旧 `volumes/tasks/INDEX.md` 兼容视图；权威阶段数据见 `STAGES_ROUTE_PATH`。 */
export const STAGES_PROGRESS_PATH = TASKS_PROGRESS_PATH

/** 执行态路由路径（⚠ **值来自** `shared/exec-protocol.ts` —— 与服务端同一份，⛔ 不各写一份）。 */
export const STAGES_EXEC_PATH = EXEC_PROGRESS_ROUTE_PATH

/** 阶段清单路由（新数据源 = `ledger/units/` 的索引分片；⛔ 不再读散文账）。 */
export const STAGES_ROUTE_PATH = STAGES_PATH
/** 需求链汇总路由（面板主视图；只返回链摘要，⛔ 不重复下发条目正文）。 */
export const REQUIREMENT_CHAINS_ROUTE_PATH = REQUIREMENT_CHAINS_PATH
/**
 * 账本目录路由（2026-11-07 · `R-020`）。
 * ⚠ 面板用它列举"项目"（= 账本）并切换；⛔ 不读账本内容。
 */
export const LEDGERS_ROUTE_PATH = LEDGERS_PATH

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
export const STAGES_RESOURCE_PATH = LEDGER_RESOURCE_PATH

/** 三态图标（照 SDD Dashboard 的 circle / play / check；⛔ 无百分比）。 */
export const STAGE_STATE_ICON: Readonly<Record<'done' | 'doing' | 'todo', string>> = {
  done: '✓',
  doing: '▶',
  todo: '○',
}

/**
 * 三态的中文词（⚠ 只在这里出现一次）。
 *
 * ⚠⚠ **A 方案第 2 轮**：值改为**取词**，⛔ 不再写死中文。
 *   ⚠ 键名与常量名**都不变** —— 它们是 `check-stages-panel-dom.mjs` 的锚点。
 *   ⚠ 用 getter 而不是加载时求值：切语言后读到的**立即是新值**（同 `t()` 的语义）。
 */
export const STAGE_STATE_TEXT: Readonly<Record<'done' | 'doing' | 'todo', string>> = {
  get done() { return stageText('stages.state.done') },
  get doing() { return stageText('stages.state.doing') },
  get todo() { return stageText('stages.state.todo') },
} as Readonly<Record<'done' | 'doing' | 'todo', string>>

/** 需求链展示态（五态封闭集）的图标与中文；⚠ 只做展示映射，不改账本状态。 */
export const CHAIN_STATE_ICON: Readonly<Record<'done' | 'doing' | 'waiting' | 'blocked' | 'todo', string>> = {
  done: '✓',
  doing: '▶',
  waiting: '⟳',
  blocked: '✗',
  todo: '○',
}

export const CHAIN_STATE_TEXT: Readonly<Record<'done' | 'doing' | 'waiting' | 'blocked' | 'todo', string>> = {
  get done() { return stageText('stages.chain.done') },
  get doing() { return stageText('stages.chain.doing') },
  get waiting() { return stageText('stages.chain.waiting') },
  get blocked() { return stageText('stages.chain.blocked') },
  get todo() { return stageText('stages.chain.todo') },
} as Readonly<Record<'done' | 'doing' | 'waiting' | 'blocked' | 'todo', string>>

/** 「长期能力」栏的标题（`cap` 单列，⛔ 不进分母、⛔ 无百分比）。 */
export const STAGES_CAPS_TITLE = '长期能力（无完成态）'
/** ⚠ A 方案第 2 轮：渲染侧改读这个词（常量留作机检锚点）。 */
export const stageCapsTitle = (): string => stageText('stages.capsTitle')

/**
 * **自动刷新间隔（毫秒）** —— ⚠ 写死成常量（任务书 §一A：不许散在代码里）。
 * 5 秒：短到"派活后几秒内就看见变化"，长到不会把宿主轮询成负载。
 */
export const STAGES_POLL_MS = 5000

/**
 * **单次取数超时（毫秒）** —— D-CLI-A 推荐值 A。
 *
 * 取值依据（三条，逐条可核）：
 *   ① 与同仓既有的浏览器 fetch 超时**同值**：`create-hob-dialog.tsx:373` 的
 *      `DEFAULT_CALL_TIMEOUT_MS = 30000`（注释写「30s 与宿主侧同类通道口径一致」）。
 *      ⛔ 不新造第二个数字 —— 同一浏览器、同一类只读接口，两条通道两个超时是无理由的分叉。
 *   ② 必须相对最长安全轮询间隔（`LIVE_SAFETY_POLL_MS = 60_000`，shared/live-protocol.ts:25）
 *      留出余量：一次请求必须在下一个周期排上之前结束，否则就是在堆积。
 *      30s 给单次请求 30s 预算、留 30s 给下一轮 ⇒ 语义正确。
 *      ⚠ 若取 >= 60s，「卡死」与「慢轮询」在观感上无法区分（都是每分钟一次）。
 *   ③ 必须远大于一次快照的真实耗时：六条只读路由都是「读 index.toml + 纯函数投影」，
 *      无网络外呼；夹具 <50ms，最坏情况（compact 线 64KB 上限 / 体积兜底）也在百毫秒级。
 *      30s 给了约 100 倍余量 ⇒ 不会误杀「慢而正常」的请求。
 *   ⚠ 没有真机量过最慢响应；若上线后误报，按实测分布调整**这一个常量**（⛔ 不另开分支）。
 *
 * ⚠ 机检可通过 `Props.fetchTimeoutMs` 注入小值（与既有 `pollMs` 同款注入惯例），
 *   生产缺省用本常量 ⇒ 测的是**生产路径**，不是变体。
 */
export const FETCH_TIMEOUT_MS = 30_000

/**
 * 生成一次取数用的**超时句柄**。
 *
 * - 超时后 `fetch` 抛 `AbortError`（与 fetch 自身的 abort 同形）⇒ 调用方既有 catch 分支原样生效；
 * - `AbortController` 不可用时（裁剪宿主 / 老 jsdom）退化为「只计时不取消」，
 *   返回的 `timedOut()` 仍可为 true ⇒ 供 `pull()` 的降级判据与 run* 的 catch 使用。
 *
 * ⚠ 为什么包 `fetch` 而不是包整个 `defaultFetch*`：
 *   包 fetch 才能把 signal 传到底层（真正取消连接）；包外层只能「放弃等待」，
 *   连接会留在宿主里直到自然结束 —— 那只是把「面板卡住」换成「连接泄漏」。
 *
 * @param ms - 超时毫秒数
 * @returns `signal`（可传给 fetch；不可用时为 undefined）、`timedOut()`、`done()`（清理定时器）
 */
function timeoutSignal(ms: number): { signal?: AbortSignal; timedOut: () => boolean; done: () => void } {
  const AC = (globalThis as any).AbortController
  if (typeof AC !== 'function') {
    let fired = false
    const timer = setTimeout(() => { fired = true }, ms)
    return { done: () => clearTimeout(timer), timedOut: () => fired }
  }
  const ctrl = new AC()
  const timer = setTimeout(() => { try { ctrl.abort() } catch { /* 忽略 */ } }, ms)
  return {
    signal: ctrl.signal as AbortSignal,
    done: () => clearTimeout(timer),
    timedOut: () => ctrl.signal.aborted === true,
  }
}

/**
 * 超时态的统一文案（六路取数共用一句，⛔ 不各写一份）。
 * ⚠ 必须同时说清两件事：① 超时了；② 本次没刷新（⛔ 不许只说"请求失败"让人以为是账本问题）。
 *
 * @param ms - 超时毫秒数（文案里换成「N 秒」）
 * @returns 人读说明
 */
function timeoutMessage(ms: number): string {
  const sec = Math.max(1, Math.round(ms / 1000))
  return stageFmt('stages.fetchTimedOutMsg', { sec })
}

/**
 * 第 4 步子项的**空态**文案（`R-4`：空态不许说成"没发生"）。
 * ⚠ 它说的是"**现在**没有在跑的活"，⛔ 不是"从来没派过活"（后者是 `state-missing`）。
 */
export const STAGES_EXEC_EMPTY_TEXT = '这一项没有在跑的活'
export const stageExecEmpty = (): string => stageText('stages.exec.empty')

/** 「现在」档的标题（`R-1`：此刻的与累计的 ⛔ 不许并排）。 */

/**
 * 「历史」档标题的**前缀**（后面拼条数：`历史 27 条（默认折叠）`）。
 * ⚠ 任务书 §一1：历史档**默认折叠**，且标题里必须写明条数与"默认折叠"。
 */
export const STAGES_EXEC_HISTORY_TITLE_PREFIX = '历史'
export const stageExecHistoryPrefix = (): string => stageText('stages.exec.historyPrefix')

/** 历史档标题的**后缀**（逐字，机检断言它）。 */
export const STAGES_EXEC_HISTORY_TITLE_SUFFIX = '条（默认折叠）'
export const stageExecHistorySuffix = (): string => stageText('stages.exec.historySuffix')

/** 合并行的后缀用词（`共 N 条`）。 */
export const STAGES_EXEC_COUNT_PREFIX = '共'
export const stageExecCountPrefix = (): string => stageText('stages.exec.countPrefix')
export const STAGES_EXEC_COUNT_SUFFIX = '条'
export const stageExecCountSuffix = (): string => stageText('stages.exec.countSuffix')

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
  if (s === '6') return `6 ${STAGES_STEP_NAMES[5]}`
  if (s === '7') return `7 ${STAGES_STEP_NAMES[6]}`
  if (s === 'done') return '✅ 验收完成'
  if (s === 'unfilled') return '未回填'
  /** ⚠ A 方案第 4 轮：走 **unknownStage** 那个键（阶段号不在封闭集 = 数据问题）。 */
  return stageText('stages.unknownStage')
}

/**
 * 默认的进度读取实现（生产路径）。
 *
 * ⚠ POST + JSON body（与宿主 `connection.fetch.register` 的 `methods:['POST']` 一致）；
 *   失败**抛出**（由调用方转成"判不出"状态），⛔ **不返回空数组冒充"表里是空的"**。
 *
 * @returns 线格式响应原文（`{ok,readAt,source,rows}` 或 `{ok:false,reason,message}`）
 */
export async function defaultFetchProgress(sessionId?: string, signal?: AbortSignal): Promise<any> {
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
    ...(signal === undefined ? {} : { signal }),
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
      routeMissMessage(STAGES_PROGRESS_PATH, res.status),
    )
  }
  try {
    return await res.json()
  } catch (e) {
    // ⚠ 非 JSON ⇒ 把状态码与响应体前 80 字带上（否则又变成一句没信息量的话）
    let snippet = ''
    try { snippet = (await res.clone().text()).slice(0, 80) } catch { /* 忽略 */ }
    throw new Error(`HTTP ${res.status} 的响应不是 JSON（${snippet === '' ? stageText('stages.emptyBody') : `前 80 字：${snippet}`}）`)
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
export async function defaultFetchLedgers(sessionId?: string, signal?: AbortSignal): Promise<any> {
  const body = sessionId === undefined || sessionId === '' ? {} : { sessionId }
  const res = await fetch(LEDGERS_ROUTE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  })
  if (res.status === 404 || res.status === 405) {
    throw new StaleRouteError(
      routeMissMessage(LEDGERS_ROUTE_PATH, res.status),
    )
  }
  try {
    return await res.json()
  } catch (e) {
    let snippet = ''
    try { snippet = (await res.clone().text()).slice(0, 80) } catch { /* 忽略 */ }
    throw new Error(`HTTP ${res.status} 的响应不是 JSON（${snippet === '' ? stageText('stages.emptyBody') : `前 80 字：${snippet}`}）`)
  }
}

export async function defaultFetchExec(sessionId?: string, ledger?: string, signal?: AbortSignal): Promise<any> {
  const body = {
    ...(sessionId === undefined || sessionId === '' ? {} : { sessionId }),
    ...(ledger === undefined || ledger === '' ? {} : { ledger }),
  }
  const res = await fetch(STAGES_EXEC_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  })
  if (res.status === 404 || res.status === 405) {
    throw new StaleRouteError(
      routeMissMessage(STAGES_EXEC_PATH, res.status),
    )
  }
  try {
    return await res.json()
  } catch (e) {
    let snippet = ''
    try { snippet = (await res.clone().text()).slice(0, 80) } catch { /* 忽略 */ }
    throw new Error(`HTTP ${res.status} 的响应不是 JSON（${snippet === '' ? stageText('stages.emptyBody') : `前 80 字：${snippet}`}）`)
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
  /** ⚠ A 方案第 4 轮：走 **unknownExec** 那个键（执行态不在封闭集 = 数据问题）。 */
  return typeof hit === 'string' ? hit : stageText('stages.unknownExec')
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
  const prefix = merged ? stageText('stages.maxElapsedPrefix') : stageText('stages.elapsedPrefix')
  /** ⚠ A 方案第 4 轮：走 **unknownTime** 那个键（读数缺失，⛔ 不是数据坏）。 */
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return `${prefix}${stageText('stages.unknownTime')}`
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const sec = totalSec % 60
  if (h > 0) return stageFmt('stages.durationHM', { prefix, h, m })
  if (m > 0) return stageFmt('stages.durationMS', { prefix, m, sec })
  return `${prefix}${sec} 秒`
}

/**
 * Advance a running item's elapsed reading locally.
 *
 * The snapshot's `elapsedMs` is anchored at its `readAt`. Only `now` items that
 * are still running advance; a historical merged maximum must never grow just
 * because the panel stayed open. Missing or malformed values stay undecidable.
 */
export function liveElapsedMsOf(
  item: { state?: unknown; bucket?: unknown; elapsedMs?: unknown },
  readAtMs: number | undefined,
  nowMs: number,
): number | undefined {
  const base = item?.elapsedMs
  if (typeof base !== 'number' || !Number.isFinite(base) || base < 0) return undefined
  if (item?.state !== 'running' || item?.bucket !== 'now') return base
  if (typeof readAtMs !== 'number' || !Number.isFinite(readAtMs)) return base
  return base + Math.max(0, nowMs - readAtMs)
}

/**
 * 重核次数 → 人读（⚠ 缺字段读成 `0` —— 那是"没重核过"，如实，不是判不出）。
 *
 * @param n - 线格式里的 `rechecks`
 * @returns 展示用文案
 */
export function rechecksLabel(n: unknown): string {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0
  return stageFmt('stages.rematchCount', { n: v })
}

/**
 * 默认的**阶段清单**取数实现（生产路径，PRIMARY 数据源）。
 *
 * ⚠ 与另两个取数函数**同一套"打错门"判据**（404/405 ⇒ {@link StaleRouteError}），
 *   但路径与线格式都不同（`stages` + `caps` 而不是 `rows` / `items`）⇒ 三个函数，⛔ 不合并。
 *
 * @returns 线格式原文（`{ok,readAt,stages,caps}` 或 `{ok:false,reason,message}`）
 */
export async function defaultFetchStages(sessionId?: string, ledger?: string, signal?: AbortSignal): Promise<any> {
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
    ...(signal === undefined ? {} : { signal }),
  })
  if (res.status === 404 || res.status === 405) {
    throw new StaleRouteError(
      routeMissMessage(STAGES_ROUTE_PATH, res.status),
    )
  }
  try {
    return await res.json()
  } catch (e) {
    let snippet = ''
    try { snippet = (await res.clone().text()).slice(0, 80) } catch { /* 忽略 */ }
    throw new Error(`HTTP ${res.status} 的响应不是 JSON（${snippet === '' ? stageText('stages.emptyBody') : `前 80 字：${snippet}`}）`)
  }
}

/**
 * 默认取数：需求链（`POST /api/dsh-hob/requirement-chains`）。
 *
 * ⚠ 与 `defaultFetchStages` 同形：POST + `sessionId` + 可选 `ledger`；
 *   ⛔ 不改服务端返回形状，⛔ 零写。
 */
export async function defaultFetchChains(sessionId?: string, ledger?: string, signal?: AbortSignal): Promise<any> {
  const body = {
    ...(sessionId === undefined || sessionId === '' ? {} : { sessionId }),
    ...(ledger === undefined || ledger === '' ? {} : { ledger }),
  }
  const res = await fetch(REQUIREMENT_CHAINS_ROUTE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  })
  if (res.status === 404 || res.status === 405) {
    throw new StaleRouteError(
      routeMissMessage(REQUIREMENT_CHAINS_ROUTE_PATH, res.status),
    )
  }
  try {
    return await res.json()
  } catch (e) {
    let snippet = ''
    try { snippet = (await res.clone().text()).slice(0, 80) } catch { /* 忽略 */ }
    throw new Error(`HTTP ${res.status} 的响应不是 JSON（${snippet === '' ? stageText('stages.emptyBody') : `前 80 字：${snippet}`}）`)
  }
}

/**
 * 默认取数：「待确认工具」只读路由（`POST /api/dsh-hob/unseen-tools`）。
 *
 * ⚠ 形状照 `defaultFetchStages`：POST + 带 `sessionId`（本路由其实不读会话，但保持一致），
 *   ⛔ 零写、⛔ 不改服务端返回形状（`UnseenReport`：`{ok,count,names,summary,items}`）。
 * ⚠ 404/405 ⇒ 抛 `StaleRouteError`（"打错门"与"读不到"必须分开说，同既有口径）。
 */
export async function defaultFetchUnseen(sessionId?: string, signal?: AbortSignal): Promise<any> {
  const body = sessionId === undefined || sessionId === '' ? {} : { sessionId }
  const res = await fetch(STAGES_UNSEEN_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  })
  if (res.status === 404 || res.status === 405) {
    throw new StaleRouteError(
      routeMissMessage(STAGES_UNSEEN_PATH, res.status),
    )
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}：${STAGES_UNSEEN_PATH}`)
  return await res.json()
}

/** 按稳定 ID 读取一条账本资源；失败一律返回可读原因，⛔ 不伪造空正文。 */
export async function defaultFetchResource(sessionId?: string, resource?: string, ledger?: string, signal?: AbortSignal): Promise<any> {
  if (typeof resource !== 'string' || resource === '') {
    return { ok: false, reason: 'bad-resource', message: stageText('stages.resourceEmptyPath') }
  }
  const res = await fetch(STAGES_RESOURCE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...(sessionId ? { sessionId } : {}),
      ...(ledger === undefined || ledger === '' ? {} : { ledger }),
      resource,
    }),
    ...(signal === undefined ? {} : { signal }),
  })
  /**
   * ⚠ **T-17**：404 / 405 是「打错门」，⛔ 不是「资源读不到」（与另 5 个取数函数同一套判据）。
   *   旧码对任何非 2xx 都返回 `{ok:false, reason:'route-error'}` ⇒ 界面说
   *   「判不出（HTTP 404：…）」—— 那是**接线**问题，却让人去翻账本。
   *   ⇒ 抛 {@link StaleRouteError}，由调用方印「接不上：这个路径没有处理体…」。
   */
  if (res.status === 404 || res.status === 405) {
    throw new StaleRouteError(
      routeMissMessage(STAGES_RESOURCE_PATH, res.status),
    )
  }
  if (!res.ok) return { ok: false, reason: 'route-error', message: `HTTP ${res.status}：${STAGES_RESOURCE_PATH}` }
  try { return await res.json() } catch { return { ok: false, reason: 'invalid-json', message: stageText('stages.resourceNoJson') } }
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
 *   ① 一处管全部：阶段树 + cap 区 + 展开体（现在/历史两档）都在面板根之下，
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
  fetchProgress?: (sessionId?: string, signal?: AbortSignal) => Promise<any>
  /** 执行态取数（省略 ⇒ 用默认 HTTP 实现）。⚠ 与 `fetchProgress` 分开注入，两路各自可判不出。 */
  fetchExec?: (sessionId?: string, ledger?: string, signal?: AbortSignal) => Promise<any>
  /**
   * **阶段清单取数**（PRIMARY 数据源：`ledger/units/` 的索引分片）。
   * ⚠ 省略 ⇒ 用 `defaultFetchStages`（生产路径）。
   */
  fetchStages?: (sessionId?: string, ledger?: string, signal?: AbortSignal) => Promise<any>
  /** **需求链取数**（主视图；省略 ⇒ 用 `defaultFetchChains`）。 */
  fetchChains?: (sessionId?: string, ledger?: string, signal?: AbortSignal) => Promise<any>
  /**
   * **待确认工具取数**（`R-008` 的界面出口）。
   * ⚠ 省略 ⇒ 用 `defaultFetchUnseen`（生产路径）。
   */
  fetchUnseen?: (sessionId?: string, signal?: AbortSignal) => Promise<any>
  /** Current 页取数（独立只读区块；失败不遮蔽其它区块）。 */
  fetchCurrent?: (sessionId?: string, signal?: AbortSignal) => Promise<any>
  /** 工作计划取数（独立只读区块；省略 ⇒ 用默认 HTTP 实现）。 */
  fetchPlans?: (sessionId?: string, ledger?: string, signal?: AbortSignal) => Promise<any>
  /** 按稳定 ID 读取条目完整详情（省略 ⇒ 用默认 HTTP 实现；只读）。 */
  fetchResource?: (sessionId?: string, resource?: string, ledger?: string, signal?: AbortSignal) => Promise<any>
  /**
   * **账本目录取数**（2026-11-07 · `R-020`）：列举 `ledgerHome` 下全部账本。
   * ⚠ 省略 ⇒ 用 `defaultFetchLedgers`（生产路径）。
   */
  fetchLedgers?: (sessionId?: string, signal?: AbortSignal) => Promise<any>
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
  /**
   * **取数超时（毫秒）** —— 机检 seam（与 `pollMs` 同款注入惯例）。
   * ⚠ 省略 = 生产常量 {@link FETCH_TIMEOUT_MS}（30s）；传入小值测的是**生产路径**，
   *   ⛔ 不是另开一条测试分支（见 `FETCH_TIMEOUT_MS` 的取值依据）。
   */
  fetchTimeoutMs?: number
  /**
   * Optional live transport factory. Production omits it and uses the real
   * fetch-based SSE client; jsdom fixtures inject `null` so no network happens
   * while the polling contract is under test.
   */
  liveClient?: (() => ReturnType<typeof createLiveClient>) | null
  /**
   * Visibility of this particular sidebar tab. A tab can stay mounted while
   * another tab is active; an invisible tab must not hold its own live stream
   * or refresh timer. `undefined` keeps the legacy jsdom/document-only path.
   */
  tabVisible?: boolean
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
  /**
   * ── **O-41：门禁必须三态，⛔ 不能用「属性在不在」判定** ────────────────────
   *
   * ⚠ 改前：
   * ```ts
   * const presetProvided = props !== undefined && hasOwnProperty(props, 'agentPreset')
   * const blockedByPreset = presetProvided && !isHobPreset
   * ```
   * ⇒ **只要调用方没写那个属性，门禁整体放行**。三种情况被压成同一种：
   *
   * | 情况 | 改前行为 | 应该 |
   * |---|---|---|
   * | 夹具：`props === undefined`（完全没传） | 放行 | ✅ 放行（夹具要能测渲染） |
   * | **生产：传了 props 但漏写 `agentPreset`** | **放行** ← 病 | ⛔ **拦住并说明** |
   * | 生产：传了 `agentPreset: '非Hob'` | 拦住 | ✅ 拦住 |
   *
   * ⚠ 「漏写一个字段」是**最常见的集成错误**，而它导致的是**门禁静默失效** ——
   *   面板会在非 Hob 会话里照常取数、照常渲染，没有任何提示。
   *
   * ⚠ **三态的判法**（关键）：用 `props === undefined` 区分「夹具形态」与「生产形态」，
   *   生产形态下**必须**有 `agentPreset` 属性（值是 `undefined` 也算「显式判不出」⇒ 拦住）。
   *   ⛔ 不要退回 `hasOwnProperty` —— 那正是本条要治的写法。
   */
  /**
   * ⚠⚠ **React 对无属性组件传的是空对象，⛔ 不是 `undefined`**（实测）。
   *   ⇒ 判「夹具形态」不能只看 `props === undefined`，还要看「**空对象**」
   *     （既没有任何自有键）。两者都是「调用方没打算走生产门禁」。
   *   ⛔ 不要因此退回 `hasOwnProperty` 单条件 —— 那会把「漏写 agentPreset 的生产调用」
   *     也归进夹具形态，正是 O-41 要治的病。
   */
  const propKeys = props === undefined ? [] : Object.keys(props)
  const isFixtureShape = props === undefined || propKeys.length === 0
  const hasPresetField = props !== undefined && Object.prototype.hasOwnProperty.call(props, 'agentPreset')
  const isHobPreset = props?.agentPreset === HOB_PRESET_ID
  /**
   * ⚠ **夹具形态放行**（它要测渲染）；**生产形态必须显式给 `agentPreset`**，
   *   漏写 ⇒ 按「判不出」拦住，⛔ 不按「没这个门禁」放行。
   */
  const blockedByPreset = !isFixtureShape && (!hasPresetField || !isHobPreset)
  /**
   * **账本目录**（2026-11-07 · `R-020`）：列举"项目"并支持切换。
   * ⚠ 与另外几路分治：目录读不到 ⛔ 不许把阶段清单抹掉。
   */
  const [ledgerState, setLedgerState] = React.useState<
    | { kind: 'reading' }
    | { kind: 'ok'; home: string; items: any[]; currentResolved: boolean; summary?: { current: number; outdated: number; empty: number; unreadable: number; backup: number } }
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
  /**
   * ⚠ T-04：每个取数闭包都**透传 signal**（由 `pull()` 的超时句柄生成）。
   *   包 fetch 才能把取消真的传到底层；只包外层只是「放弃等待」，连接会留在宿主里。
   */
  const load = React.useMemo(() => {
    const fn = props?.fetchProgress ?? defaultFetchProgress
    return (signal?: AbortSignal) => fn(props?.sessionId, signal)
  }, [props?.fetchProgress, props?.sessionId])
  const loadExec = React.useMemo(() => {
    const fn = props?.fetchExec ?? defaultFetchExec
    return (signal?: AbortSignal) => fn(props?.sessionId, selectedLedger, signal)
  }, [props?.fetchExec, props?.sessionId, selectedLedger])
  const loadStages = React.useMemo(() => {
    const fn = props?.fetchStages ?? defaultFetchStages
    return (signal?: AbortSignal) => fn(props?.sessionId, selectedLedger, signal)
  }, [props?.fetchStages, props?.sessionId, selectedLedger])
  const loadChains = React.useMemo(() => {
    const fn = props?.fetchChains ?? defaultFetchChains
    return (signal?: AbortSignal) => fn(props?.sessionId, selectedLedger, signal)
  }, [props?.fetchChains, props?.sessionId, selectedLedger])
  /** 待确认工具只读取数（全局工具面，不随账本切换）。 */
  const loadUnseen = React.useMemo(() => {
    const fn = props?.fetchUnseen ?? defaultFetchUnseen
    return (signal?: AbortSignal) => fn(props?.sessionId, signal)
  }, [props?.fetchUnseen, props?.sessionId])
  /**
   * 待确认工具取数（`R-008` 的界面出口）。
   * ⚠ 与 `state` / `execState` / `stageState` **四路分治**：这一路读不到 ⛔ 不许把别的抹掉。
   */
  /** 工作计划只取一次；活动与历史两个投影共用这一份响应。 */
  const loadPlans = React.useMemo(() => {
    const fn: (sessionId?: string, ledger?: string, signal?: AbortSignal) => Promise<any> = props?.fetchPlans ?? (async (sessionId?: string, ledger?: string, signal?: AbortSignal) => {
      const res = await fetch(WORK_PLANS_ROUTE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(sessionId === undefined || sessionId === '' ? {} : { sessionId }),
          ...(ledger === undefined || ledger === '' ? {} : { ledger }),
        }),
        ...(signal === undefined ? {} : { signal }),
      })
      /**
       * ⚠ O-36：**404 / 405 是"打错门"，不是"计划读不到"**（与 `defaultFetchStages` 同一套判据）。
       *   旧码对任何非 2xx 都返回 `{ok:false, reason:'route-error'}` ⇒ 界面说
       *   「判不出（HTTP 404：…）」—— 那是**接线**问题，却让人去翻账本。
       *   ⇒ 抛 {@link StaleRouteError}，由调用方印「接不上：这个路径没有处理体…」。
       */
      if (res.status === 404 || res.status === 405) {
        throw new StaleRouteError(
          routeMissMessage(WORK_PLANS_ROUTE_PATH, res.status),
        )
      }
      if (!res.ok) return { ok: false, reason: 'route-error', message: `HTTP ${res.status}：${WORK_PLANS_ROUTE_PATH}` }
      try { return await res.json() } catch { return { ok: false, reason: 'invalid-json', message: stageText('stages.plansNoJson') } }
    })
    return (signal?: AbortSignal) => fn(props?.sessionId, selectedLedger, signal)
  }, [props?.fetchPlans, props?.sessionId, selectedLedger])
  const loadResource = React.useMemo(() => {
    const fn = props?.fetchResource ?? defaultFetchResource
    return (resource: string, signal?: AbortSignal) => fn(props?.sessionId, resource, selectedLedger, signal)
  }, [props?.fetchResource, props?.sessionId, selectedLedger])
  /**
   * **Current 面板的取数引用必须稳定**（O-18；与 T-04 同批的原因见 L-6）。
   *
   * ⚠ 病：改前 `:3011` 是内联 `async (sessionId?) => loadResource('current')`，
   *   **每次渲染都是一条新函数** ⇒ `CurrentPanel` 的 effect（依赖 `props.fetchCurrent`）
   *   会被面板每秒的本地时钟重渲染带着重跑 ⇒ `/ledger-resource` 每秒一条。
   *   ⚠ 更糟的是 T-04 修好后，这个 1s 节拍会把降级徽标反复点亮 —— 两条必须同批修。
   * ⚠ 这里用 `useCallback` 把它钉在 `loadResource` 上；`loadResource` 只在账本 / 会话变化时重建。
   * ⚠ CurrentPanel 侧**不需要改**（它的依赖数组本身是对的，只是上游引用不稳）。
   */
  const fetchCurrentResource = React.useCallback(
    () => loadResource('current'),
    [loadResource],
  )
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
   * Catalog refresh tick. A realtime change can create or retire a ledger, and
   * the picker must follow without waiting for the 60-second safety poll. This
   * is separate from `refreshTick`, which deliberately restarts the whole
   * snapshot effect on a manual refresh.
   */
  const [catalogTick, setCatalogTick] = React.useState(0)
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
          setLedgerState({
            kind: 'ok',
            home: String(res.home ?? ''),
            items: res.items,
            currentResolved: res.currentResolved === true,
            ...(res.summary === undefined ? {} : { summary: res.summary }),
          })
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
            message: String(res?.message ?? stageText('stages.noRouteReason')),
          })
        }
      } catch (e) {
        if (!alive) return
        setLedgerState({ kind: 'fail', reason: 'network', message: stageFmt('stages.requestFailed', { msg: String((e as Error)?.message ?? e) }) })
      }
    })()
    return () => { alive = false }
  /**
   * ⚠ **刷新节拍也要重取账本目录**（2026-11-08）：
   *   当前工作区变了，服务端 `current` 会变；若只在挂载时取一次，
   *   同一标签页里换工作区后仍停在上一本账。
   *   `refreshTick` 由面板“刷新”按钮与统一轮询推进，与阶段/链共用同一 tick。
   */
  }, [props?.fetchLedgers, props?.sessionId, blockedByPreset, refreshTick, catalogTick])

  /**
   * **阶段清单**（PRIMARY）。⚠ 与 `state` / `execState` **三路分治**：
   *   任一路判不出都不许把另外两路抹掉（那是把"一个数据源的问题"放大成"整个面板没用"）。
   */
  const [stageState, setStageState] = React.useState<
    | { kind: 'reading' }
    /**
     * ⚠ **S-09：用服务端真类型 `StagesOk`（去掉 `ok: true` 与 `readAt` 之外全部照抄）。**
     *   `Omit<StagesOk, 'ok'>` 是刻意的：本 state 用 `kind: 'ok'` 表达"成功"，
     *   而线格式用 `ok: true` —— 两个判别式**不能混用**（混了会让 `kind === 'ok'`
     *   与 `ok === true` 各判一半，正是"同一事实两份来源"）。
     */
    | ({ kind: 'ok' } & Omit<StagesOk, 'ok'>)
    | { kind: 'fail'; reason: string; message: string }
  >({ kind: 'reading' })
  /** **需求链**（主视图的唯一状态源）；与 `/stages` 分治，任一路失败不遮蔽另一路。 */
  const [chainState, setChainState] = React.useState<
    | { kind: 'reading' }
    /** ⚠ O-23：只保留**真的被读**的字段；`activeCount` / `retiredCount` / `unattached` 已删（存了不读）。 */
    | { kind: 'ok'; chains: RequirementChain[]; retiredChains: RequirementChain[]; completedCount: number; historyItemCount: number }
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
    | { kind: 'ok'; items: any[]; readAtMs?: number }
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
  /** 工作计划读数（⚠ 活动 / 历史两个投影共用；失败不遮蔽阶段清单）。 */
  const [plansState, setPlansState] = React.useState<
    | { kind: 'reading' }
    | { kind: 'ok'; report: any }
    | { kind: 'fail'; message: string }
  >({ kind: 'reading' })
  /** 自动轮询的计数：Current / 工作计划子区块与主数据共用同一条刷新节拍。 */
  const [pollTick, setPollTick] = React.useState(0)
  /** Live transport state is rendered, not inferred; a dead push channel must be visible. */
  const [liveState, setLiveState] = React.useState<LiveConnectionState>('connecting')
  /**
   * **数据通道降级（T-04）** —— 任一取数超时 ⇒ 面板必须**可观测地**说"停止刷新"。
   *
   * ⚠ 与 `liveState` **正交**：SSE 传输层可以健康（live）而快照取数全部超时。
   *   ⛔ 不合进 `LiveConnectionState` 封闭集（那会把两个维度混成一档，
   *   于是「已连接 + 数据定格」又能同时成立 —— 正是 T-04 的原病）。
   * ⚠ 只有「全部成功」的那一轮才清回 false（业务性 fail 不算降级，见 `pull()`）。
   */
  const [stalled, setStalled] = React.useState(false)
  /**
   * 最近一次「全部取数成功」的时刻；`undefined` = 从未成功。
   * ⛔ 不许用 `Date.now()` 冒充 —— 那会把"从来没成功"说成"刚刚成功"。
   */
  const [lastOkAt, setLastOkAt] = React.useState<number | undefined>(undefined)
  /**
   * 当前重试间隔（毫秒），只用于降级文案里的「正在按 N 秒间隔重试」。
   * ⚠ 来自刷新节拍（live 健康时是 60s 安全轮询、否则是 `pollMs`），由 effect 写入。
   */
  const [retryIntervalMs, setRetryIntervalMs] = React.useState<number>(props?.pollMs ?? STAGES_POLL_MS)
  /** Monotonic mount id: an old panel instance must not overwrite a new one's transport state. */
  const liveEpochRef = React.useRef(0)
  React.useEffect(() => {
    const epoch = ++liveEpochRef.current
    return () => { liveEpochRef.current = Math.max(liveEpochRef.current, epoch) }
  }, [])
  /**
   * Local clock for a running item's elapsed time. The snapshot carries the
   * elapsed value as of `readAt`; the panel advances it locally once a second
   * instead of asking the server for a new snapshot every second.
   */
  const [clockNow, setClockNow] = React.useState(() => Date.now())
  /** Whether a second-by-second local clock is needed (only while something runs). */
  const hasRunningExec = execState.kind === 'ok' && execState.items.some((it: any) => it?.state === 'running')
  React.useEffect(() => {
    if (!hasRunningExec) return
    setClockNow(Date.now())
    const timer = setInterval(() => { setClockNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [hasRunningExec])
  /**
   * Latest host tab visibility, read by the long-lived refresh effect.
   *
   * ⚠ O-23：这里原来还存着一份 liveState 的 ref（声明 + 两处写、**零读**；
   *   刷新节拍实际读的是 `live?.state()`，见 `applyInterval`）——
   *   已删除。存了不读的状态会让下一个读码人以为"某处在用它"。
   */
  const tabVisibleRef = React.useRef<boolean | undefined>(props?.tabVisible)
  tabVisibleRef.current = props?.tabVisible
  /** Imperative apply/stop hook owned by the refresh effect, called on prop changes. */
  const tabVisibilityControlRef = React.useRef<((visible: boolean | undefined) => void) | undefined>(undefined)
  const tabVisibilityBootRef = React.useRef(false)
  React.useEffect(() => {
    if (!tabVisibilityBootRef.current) {
      tabVisibilityBootRef.current = true
      return
    }
    tabVisibilityControlRef.current?.(props?.tabVisible)
  }, [props?.tabVisible])
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
          setItemDetails((prev) => ({ ...prev, [id]: { kind: 'fail', message: String(res?.message ?? res?.reason ?? stageText('stages.resourceUnreadable')) } }))
        }
      } catch (e) {
        /**
         * ⚠ **T-17（第二处）**：404 / 405 抛的是 {@link StaleRouteError} ——
         *   那是**接线**问题，⛔ 不是「这个资源读不到」。
         *   旧码一律折成 `fail`，界面就说「资源读不到（这个路径没有处理体…）」——
         *   前半句**指错了方向**（让人去翻账本，而账本没问题）。
         *   ⇒ 与另 6 处同形：isStale ⇒ 前缀「接不上：」，并把 reason 标出来。
         */
        const isStale = e instanceof StaleRouteError
        setItemDetails((prev) => ({
          ...prev,
          [id]: {
            kind: 'fail',
            ...(isStale ? { reason: 'stale-route' } : {}),
            message: isStale
              ? `接不上：${String((e as Error)?.message ?? e)}`
              : String((e as Error)?.message ?? e),
          },
        }))
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
    /**
     * 取数超时（毫秒）。生产 = {@link FETCH_TIMEOUT_MS}（30s）；
     * 机检通过 `fetchTimeoutMs` 注入小值（与 `pollMs` 同款 seam）⇒ 测的是**生产路径**。
     */
    const fetchTimeoutMs = typeof props?.fetchTimeoutMs === 'number'
      && Number.isFinite(props.fetchTimeoutMs)
      && props.fetchTimeoutMs > 0
      ? props.fetchTimeoutMs
      : FETCH_TIMEOUT_MS
    /**
     * ⚠ T-04：每路取数各带一个**超时句柄**，并把"这一路是否超时"作为返回值交给 `pull()`
     *   汇总判降级。⛔ 不把超时混成业务失败：`{ok:false, reason:'ledger-missing'}` 是正常读数。
     */
    const run = async (): Promise<boolean> => {
      const t = timeoutSignal(fetchTimeoutMs)
      let res: any
      let error: unknown
      try {
        res = await load(t.signal)
      } catch (e) {
        error = e
      } finally {
        t.done()
      }
      if (!alive) return false
      if (error !== undefined) {
        const isStale = error instanceof StaleRouteError
        const isTimeout = t.timedOut()
        setState({
          kind: 'fail',
          reason: isStale ? 'stale-route' : isTimeout ? 'timeout' : 'network',
          message: isStale
            ? `接不上：${String((error as Error)?.message ?? error)}`
            : isTimeout
              ? timeoutMessage(fetchTimeoutMs)
              : stageFmt('stages.requestFailed', { msg: String((error as Error)?.message ?? error) }),
        })
        return isTimeout
      }
      if (!alive) return false
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
          message: String(res?.message ?? stageText('stages.noRouteReason')),
        })
      }
      /** 形状正确/业务失败都算"没有超时" —— 降级只看超时，⛔ 不把账本缺口说成面板坏了。 */
      return false
    }
    const runExec = async (): Promise<boolean> => {
      const t = timeoutSignal(fetchTimeoutMs)
      let res: any
      let error: unknown
      try {
        res = await loadExec(t.signal)
      } catch (e) {
        error = e
      } finally {
        t.done()
      }
      if (!alive) return false
      if (error !== undefined) {
        const isStale = error instanceof StaleRouteError
        const isTimeout = t.timedOut()
        setExecState({
          kind: 'fail',
          reason: isStale ? 'stale-route' : isTimeout ? 'timeout' : 'network',
          message: isStale
            ? `接不上：${String((error as Error)?.message ?? error)}`
            : isTimeout
              ? timeoutMessage(fetchTimeoutMs)
              : stageFmt('stages.requestFailed', { msg: String((error as Error)?.message ?? error) }),
        })
        return isTimeout
      }
      if (res !== null && typeof res === 'object' && res.ok === true && Array.isArray(res.items)) {
        const readAtMs = typeof res.readAt === 'string' ? Date.parse(res.readAt) : Number.NaN
        setExecState({
          kind: 'ok',
          items: res.items,
          ...(Number.isFinite(readAtMs) ? { readAtMs } : {}),
        })
      } else {
        setExecState({
          kind: 'fail',
          reason: String(res?.reason ?? 'unknown'),
          message: String(res?.message ?? stageText('stages.noRouteReason')),
        })
      }
      return false
    }
    /**
     * **阶段清单取数**（PRIMARY）。
     * ⚠ 三态口径与另两路**完全同构**（`R-4`）：读不到 ⇒ 「判不出」+ 一句原因，⛔ 不落成空表。
     */
    const runStages = async (): Promise<boolean> => {
      const t = timeoutSignal(fetchTimeoutMs)
      let res: any
      let error: unknown
      try {
        res = await loadStages(t.signal)
      } catch (e) {
        error = e
      } finally {
        t.done()
      }
      if (!alive) return false
      if (error !== undefined) {
        const isStale = error instanceof StaleRouteError
        const isTimeout = t.timedOut()
        setStageState({
          kind: 'fail',
          reason: isStale ? 'stale-route' : isTimeout ? 'timeout' : 'network',
          message: isStale
            ? `接不上：${String((error as Error)?.message ?? error)}`
            : isTimeout
              ? timeoutMessage(fetchTimeoutMs)
              : stageFmt('stages.requestFailed', { msg: String((error as Error)?.message ?? error) }),
        })
        return isTimeout
      }
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
          /**
           * ⚠⚠ **R-24：这三个字段的读取点状态必须写清，⛔ 不许「存了不用」还让人以为是遗漏。**
           *
           * | 字段 | 客户端读取点 | 结论 |
           * |---|---|---|
           * | `next` | ✅ **有**（`:2016` 取出 → `:3045-3069` 渲染成 `stages-next` 块） | 正常使用 |
           * | `pipelines` | ❌ **零读取** | ⚠ **等价重复下发**：它与 `/requirement-chains` 的 `chain.pipeline` **同源**（都是 `pipelineViewsOf(units)`，`stages-index.ts:436` / `requirement-chain.ts:56`），客户端用的是后者 ⇒ 存下来只为**保持线格式完整**，⛔ 不是遗漏 |
           * | `summary` | ❌ **零读取** | ⚠ **服务端已声明退役**：`stages-index.ts:186-193` 写明「已退役…字段保留是为了不破坏旧消费者；⛔ 不许再把它渲染成当前阶段」 |
           *
           * ⚠ **为什么不删这两个字段**：它们是**线格式**的一部分，删了会破坏旧消费者；
           *   而「保留但标注清楚」正是服务端注释已经采取的做法 —— 客户端侧照抄同一口径。
           * ⛔ **不要为了"消掉未读取"而删字段**：那是把兼容性当洁癖。
           */
          pipelines: Array.isArray(res.pipelines) ? res.pipelines : [],
          next: res.next,
          /**
           * ⚠ **`portfolio` 也必须一起存进 state**（2026-11-01 P40/R6 · `TASK-R6.md` §三）——
           *   漏存 ⇒ 面板永远拿不到它 ⇒ 组合层区块**恒显示「判不出」**。
           *   ⚠ 这正是 `S-18`（真账本数据渲染 · 全文不许出现「判不出」）当场咬出来的：
           *     第一次跑就红了 —— 组合层那一行的「判不出」跑到了读数位置。
           *   ⇒ 存进来（⚠ 不兜底成 `undefined` 之外的任何值：后端没给就是没给，
           *     由 `portfolioBlock` 显示「判不出」，⛔ 不显示 0）。
           */
          portfolio: res.portfolio,
          attention: res.attention,
          summary: res.summary,
          /**
           * ⚠ **`truncated` 必须一起存**（2026-11-07）：服务端在极端规模下会按阶段末尾
           *   少列条目；不存这个字段 ⇒ 面板会把"少列"显示成"账本只有这些"。
           *   缺省 = 没截断（正常线格式，不显示任何额外行）。
           */
          truncated: res.truncated,
          relations: res.relations,
          /** ⚠ 账本健康清单（2026-11-08）：与派活门禁同一份函数的产物，面板只展示。 */
          stageHealth: res.stageHealth,
          /** ⚠ `readAt` 是 `StagesOk` 的**必填字段**（服务端给了就读，没给就不硬造）。 */
          readAt: res.readAt,
        })
      } else {
        setStageState({
          kind: 'fail',
          reason: String(res?.reason ?? 'unknown'),
          message: String(res?.message ?? stageText('stages.noRouteReason')),
        })
      }
      return false
    }
    /**
     * **需求链取数**（主视图）。⚠ 与 `/stages` 分治：链读不到时，
     *   仅主视图落「判不出」，⛔ 不把条目/历史一起抹掉。
     */
    const runChains = async (): Promise<boolean> => {
      const t = timeoutSignal(fetchTimeoutMs)
      let res: any
      let error: unknown
      try {
        res = await loadChains(t.signal)
      } catch (e) {
        error = e
      } finally {
        t.done()
      }
      if (!alive) return false
      if (error !== undefined) {
        const isStale = error instanceof StaleRouteError
        const isTimeout = t.timedOut()
        setChainState({
          kind: 'fail',
          reason: isStale ? 'stale-route' : isTimeout ? 'timeout' : 'network',
          message: isStale
            ? `接不上：${String((error as Error)?.message ?? error)}`
            : isTimeout
              ? timeoutMessage(fetchTimeoutMs)
              : stageFmt('stages.requestFailed', { msg: String((error as Error)?.message ?? error) }),
        })
        return isTimeout
      }
      if (res !== null && typeof res === 'object' && res.ok === true && Array.isArray(res.chains)) {
        setChainState({
          kind: 'ok',
          chains: res.chains,
          retiredChains: Array.isArray(res.retiredChains) ? res.retiredChains : [],
          /**
           * ⚠ O-23：`activeCount` / `retiredCount` / `unattached` 三个字段**存了不读**，
           *   已从 state 删除（在途 / 退役各由上面的数组承载）。
           *   `completedCount` 保留，并**成为渲染用的那一个读数**（⛔ 不在渲染里再 filter 数一遍）。
           */
          completedCount: Number(res.completedCount ?? 0),
          historyItemCount: Number(res.historyItemCount ?? 0),
        })
      } else {
        setChainState({
          kind: 'fail',
          reason: String(res?.reason ?? 'unknown'),
          message: String(res?.message ?? stageText('stages.noRouteReason')),
        })
      }
      return false
    }
    /**
     * 待确认工具取数（`R-008`）。⚠ 单独一个函数：与三路各自独立，
     *   它失败**只**把这一块落成「判不出」，⛔ 不影响阶段树 / 执行态 / 账面表。
     */
    const runUnseen = async (): Promise<boolean> => {
      const t = timeoutSignal(fetchTimeoutMs)
      let res: any
      let error: unknown
      try {
        res = await loadUnseen(t.signal)
      } catch (e) {
        error = e
      } finally {
        t.done()
      }
      if (!alive) return false
      if (error !== undefined) {
        const isStale = error instanceof StaleRouteError
        const isTimeout = t.timedOut()
        setUnseenState({
          kind: 'fail',
          reason: isStale ? 'stale-route' : isTimeout ? 'timeout' : 'network',
          message: isStale
            ? `接不上：${String((error as Error)?.message ?? error)}`
            : isTimeout
              ? timeoutMessage(fetchTimeoutMs)
              : stageFmt('stages.requestFailed', { msg: String((error as Error)?.message ?? error) }),
        })
        return isTimeout
      }
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
          message: String(res?.message ?? stageText('stages.noReadableSummary')),
        })
      }
      return false
    }
    const runPlans = async (): Promise<boolean> => {
      const t = timeoutSignal(fetchTimeoutMs)
      let res: any
      let error: unknown
      try {
        res = await loadPlans(t.signal)
      } catch (e) {
        error = e
      } finally {
        t.done()
      }
      if (!alive) return false
      if (error !== undefined) {
        /**
         * ⚠ O-36：`loadPlans` 现在会对 404/405 抛 {@link StaleRouteError}；
         *   这里必须**按类型分支**，否则「打错门」又被印成「请求失败：…」，
         *   与阶段清单那几路的口径漂开。
         */
        const isStale = error instanceof StaleRouteError
        const isTimeout = t.timedOut()
        setPlansState({
          kind: 'fail',
          message: isStale
            ? `接不上：${String((error as Error)?.message ?? error)}`
            : isTimeout
              ? timeoutMessage(fetchTimeoutMs)
              : stageFmt('stages.requestFailed', { msg: String((error as Error)?.message ?? error) }),
        })
        return isTimeout
      }
      if (res !== null && typeof res === 'object' && res.ok === true && Array.isArray(res.plans)) {
        setPlansState({ kind: 'ok', report: res })
      } else {
        setPlansState({ kind: 'fail', message: String(res?.message ?? res?.reason ?? stageText('stages.plansUnreadable')) })
      }
      return false
    }
    /**
     * One snapshot pull with a bounded re-run when an invalidation arrives mid-flight.
     *
     * ── T-04 的三层兜底（⚠ 逐层对应原有病）──────────────────────────────────
     *   ① **每路取数带超时**（`timeoutSignal`）—— 正常情况下 30s 后 abort 传播、promise settle；
     *   ② **独立 watch-dog** —— 若宿主/夹具让 promise **永不 settle**，
     *      `Promise.allSettled` 永不 resolve ⇒ 闸永不放（T-04 的原病，超时也救不了）；
     *      这里在 `fetchTimeoutMs + 5s` 时强制放开闸，并点亮降级徽标；
     *   ③ **单调 `pullSeq`** —— watch-dog 与正常结算都靠它判断「是不是我这一轮」，
     *      晚到的一方直接 return ⇒ 不会二次复位、更不会二次 `pull()`。
     */
    let pulling = false
    let pullAgain = false
    let followUpsLeft = LIVE_MAX_FOLLOW_UP_PULLS
    /** 本轮 pull 的单调序号（watch-dog 与正常结算共用）。 */
    let pullSeq = 0
    /** 本 effect 里所有未清理的 watch-dog 定时器（卸载时统一 clear，⛔ 不留悬空退化徽标）。 */
    const watchdogs = new Set<ReturnType<typeof setTimeout>>()
    const pull = (runStagesAgain = true): void => {
      if (pulling) {
        /** A change landed mid-pull; coalesce it into one queued follow-up. */
        if (followUpsLeft > 0) {
          pullAgain = true
          followUpsLeft -= 1
        }
        return
      }
      pulling = true
      const mySeq = ++pullSeq
      /**
       * ⚠⚠ watch-dog：无论下面怎么结算，超过 `fetchTimeoutMs + 5s` 必须放开闸。
       *   ＋5s 是给 abort 传播留的余量（abort 后 fetch 的 reject 是下一个 microtask，
       *   某些宿主 polyfill 会慢一拍）。
       *   ⚠ 这层兜底存在的理由：`Promise.allSettled` 只在**每个 promise 都 settle** 时
       *     resolve；任何一条永久 pending（宿主打桩 / 某个 defaultFetch 内部自己串行化到死）
       *     ⇒ allSettled 永不 resolve ⇒ 闸永不放 ⇒ 面板定格。
       */
      const watchdog = setTimeout(() => {
        watchdogs.delete(watchdog)
        if (pullSeq !== mySeq || !pulling) return
        pulling = false
        /** ⚠ 卡死 = 数据通道降级；徽标据此改说「停止刷新」，⛔ 不许继续说「已连接」。 */
        setStalled(true)
        /** 归还配额，避免「卡一次就永久丢后续失效帧」。 */
        followUpsLeft = LIVE_MAX_FOLLOW_UP_PULLS
        if (!alive) return
        /**
         * ⚠ 复位后补拉一次，而不是等下一个 tick：否则面板会停在「旧数据 + 已降级徽标」
         *   最长一个轮询周期（live 健康时是 60s）。
         * ⚠ **必须让出一轮宏任务**：watch-dog 自己就在定时器回调里，同步调 `pull()` 会立刻
         *   看到 `pulling=false` 再次启动 ⇒ 在「服务端持续不回包」时形成不受 setInterval
         *   节制的自旋。用 `setTimeout(0)` 明确让出 ⇒ 重试节奏仍由 poll 节拍主导。
         */
        setTimeout(() => { if (alive) pull() }, 0)
      }, fetchTimeoutMs + 5_000)
      watchdogs.add(watchdog)
      /**
       * ⚠ **旧 `tasks-progress` 只是隐藏的兼容表**（`stages-legacy-account`）。
       *   生产面板不再需要它 ⇒ 未注入 `fetchProgress` 时**不请求**，
       *   避免每 5 秒多打一条无展示作用的旧路由。
       *   ⚠ 机检仍可注入 `fetchProgress` 验证那条兼容线；⛔ 不把注入路径当成生产路径。
       */
      const requests: Array<Promise<boolean>> = []
      if (props?.fetchProgress !== undefined) requests.push(run())
      requests.push(runExec(), runChains(), runUnseen(), runPlans())
      if (runStagesAgain) requests.push(runStages())
      void Promise.allSettled(requests).then((results) => {
        clearTimeout(watchdog)
        watchdogs.delete(watchdog)
        /** ⚠ 已被 watch-dog 判过 ⇒ ⛔ 不二次结算（也不二次 pull）。 */
        if (pullSeq !== mySeq) return
        pulling = false
        if (!alive) return
        /**
         * ⚠ 只有「全部无超时」才清 stalled / 记成功时刻。
         *   判据只用**超时**，⛔ 不掺业务性 fail：
         *   {ok:false, reason:'ledger-missing'} 是**正常读数**，不是降级；
         *   让它点亮降级徽标 = 把「账本还没建」说成「面板坏了」。
         */
        const anyTimeout = results.some((r) => r.status === 'fulfilled' && r.value === true)
        if (anyTimeout) {
          setStalled(true)
        } else {
          setStalled(false)
          setLastOkAt(Date.now())
        }
        if (pullAgain) {
          /** Consume the coalesced invalidation; new ones may queue one more. */
          pullAgain = false
          pull()
        } else {
          /**
           * The cap is per busy period, not per panel lifetime. Without this
           * reset, three unrelated bursts over a long session would exhaust it
           * and every later invalidation that happened mid-pull would be lost.
           */
          followUpsLeft = LIVE_MAX_FOLLOW_UP_PULLS
        }
      })
      setPollTick((n) => n + 1)
    }
    pull()

    /**
     * Live invalidation and the fallback timer share this effect and this pull.
     * A healthy stream disables the fast timer; a dead stream still refreshes.
     * Hidden tabs paint nothing, so the stream is stopped rather than buffered.
     */
    const makeLive = props?.liveClient === undefined ? createLiveClient : props.liveClient
    const liveEpoch = liveEpochRef.current
    const live = blockedByPreset || makeLive === null
      ? undefined
      : makeLive({
          sessionId: props?.sessionId,
          ...(selectedLedger === undefined ? {} : { ledger: selectedLedger }),
          /**
           * Every invalidation currently refreshes the complete snapshot,
           * including the catalog. That is deliberate: one write can touch a
           * run, a plan and a project's existence, and the cheap request is
           * preferable to a temporarily inconsistent panel.
           */
          onChange: () => { setCatalogTick((n) => n + 1); pull() },
          onState: (next) => {
            /** The sidebar can discard an old body while its effect is still settling. */
            if (liveEpoch !== liveEpochRef.current) return
            if (alive) setLiveState(next)
          },
        })

    /**
     * ⚠ `document` 取不到 ⇒ **只跑首次 + 手动**（⛔ 不抛、⛔ 不装一个假 document）。
     *   `pollMs === 0` 也走这一支（机检用它做对照）。
     */
    const doc: any = (globalThis as any).document
    const configuredPoll = props?.pollMs ?? STAGES_POLL_MS
    /** Without a live stream (fixtures or an unsupported host) polling stays as configured. */
    const canPoll = configuredPoll > 0 && doc !== undefined && typeof setInterval === 'function'

    /**
     * The host tab signal is authoritative. `document.visibilityState` is not:
     * a sidebar tab can be on screen in a headless or backgrounded document,
     * and treating that as hidden leaves the panel stuck at "connecting".
     */
    const isHidden = (): boolean => {
      return tabVisibleRef.current === false
    }
    let timer: any = null
    /** Current cadence, recomputed from the live transport whenever it changes. */
    let interval = configuredPoll
    const intervalOf = (state: LiveConnectionState): number => {
      if (live === undefined) return configuredPoll
      return state === 'live' ? LIVE_SAFETY_POLL_MS
        : state === 'reconnecting' ? Math.min(configuredPoll, LIVE_RECONNECTING_POLL_MS)
          : configuredPoll
    }
    const start = (): void => {
      if (timer !== null || !canPoll) return
      /**
       * Re-read the cadence at every tick as well as on transitions. A missed
       * listener callback then degrades to a slower refresh, never to a frozen
       * panel; the interval variable is updated by `applyInterval`.
       */
      timer = setInterval(() => {
        applyInterval(live?.state() ?? 'fallback')
        if (!isHidden()) pull()
      }, interval)
    }
    const stop = (): void => {
      if (timer === null) return
      try { clearInterval(timer) } catch { /* 忽略 */ }
      timer = null
    }
    /** A transport transition replaces the timer so a healthy stream stops 5s polling. */
    const applyInterval = (state: LiveConnectionState): void => {
      const next = intervalOf(state)
      if (next === interval) return
      interval = next
      /** ⚠ 降级文案要说「正在按 N 秒间隔重试」⇒ 渲染层需要这个数（state 驱动，⛔ 不在渲染期读定时器）。 */
      setRetryIntervalMs(next)
      if (timer === null) return
      stop()
      start()
    }
    interval = intervalOf(live?.state() ?? 'fallback')
    /**
     * Start on mount regardless of `document.visibilityState`: a sidebar tab can
     * be on screen in a backgrounded or headless document. Tab visibility is
     * the authoritative hide signal and is applied in `applyTabVisibility`.
     */
    if (!isHidden()) { start(); live?.start() }
    const offLiveState = live?.onStateChange?.((state) => {
      applyInterval(state)
    })

    /** 回到可见 ⇒ **立刻拉一次**（⛔ 不等下一个 tick：等待会让人以为"还是没变化"）。 */
    /** Visibility changes rerun only this control, not the snapshot effect. */
    const applyTabVisibility = (next: boolean | undefined): void => {
      if (!alive || next === undefined) return
      if (next === false) { stop(); live?.stop(); return }
      pull()
      live?.start()
      applyInterval(live?.state() ?? 'fallback')
      start()
    }
    tabVisibilityControlRef.current = applyTabVisibility

    return () => {
      alive = false
      /**
       * ⚠ 卸载 / 依赖变化时**清掉未触发的 watch-dog**：否则旧 effect 的定时器到点后
       *   仍会 `setStalled(true)` ⇒ 新 effect 明明健康，徽标却被上一个实例点亮。
       */
      for (const w of watchdogs) { try { clearTimeout(w) } catch { /* 忽略 */ } }
      watchdogs.clear()
      if (tabVisibilityControlRef.current === applyTabVisibility) tabVisibilityControlRef.current = undefined
      stop()
      offLiveState?.()
      live?.stop()
    }
  }, [load, loadExec, loadStages, loadChains, loadUnseen, loadPlans, props?.pollMs, props?.fetchTimeoutMs, refreshTick,
    blockedByPreset, props?.sessionId, selectedLedger, props?.liveClient])

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
      return React.createElement('div', { style: subNoteStyle, 'data-dsh-hob': 'stages-exec-state', 'data-state': 'reading' }, stageText('stages.reading'))
    }
    if (execState.kind === 'fail') {
      return React.createElement(
        'div',
        { style: subNoteStyle, 'data-dsh-hob': 'stages-exec-state', 'data-state': 'undecidable' },
        React.createElement('div', { style: { fontWeight: 600 } }, stageText('stages.undecidable')),
        React.createElement('div', { 'data-dsh-hob': 'stages-exec-reason' }, execState.message),
      )
    }
    if (execState.items.length === 0) {
      return React.createElement(
        'div',
        { style: subNoteStyle, 'data-dsh-hob': 'stages-exec-state', 'data-state': 'empty' },
        stageExecEmpty(),
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
      React.createElement('span', {
        'data-dsh-hob': 'stages-exec-elapsed',
        style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.9em' },
      }, elapsedLabel(liveElapsedMsOf(it, execState.readAtMs, clockNow), Number(it?.count) > 1)),
      React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.9em' } }, rechecksLabel(it?.rechecks)),
      ...(Number(it?.count) > 1
        ? [React.createElement(
            'span',
            { key: 'count', 'data-dsh-hob': 'stages-exec-count', style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.9em' } },
            `${stageExecCountPrefix()} ${Number(it.count)} ${stageExecCountSuffix()}`,
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
            stageExecEmpty(),
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
        `${stageExecHistoryPrefix()} ${historyRows.length} ${stageExecHistorySuffix()}`,
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
   * ── **阶段树**（2026-10-30 · P3 · 用户原话「这几个是有状态，然后可以展开每一个阶段小节状态」）──
   *
   * 每步一行：`序号 + 步名 + 三态图标 + 完成数/总数`，**点行展开**列出该步的条目。
   * ⚠ 三态只认 `done / doing / todo`（⛔ 百分比、⛔ 进度条、⛔ 勾选）。
   * ⚠ `cap` **单列**在树下面，⛔ 不进分母、⛔ 无完成度。
   * ⚠ 数据源 = `POST /api/dsh-hob/stages`（`ledger/units/` 的索引分片）。
   */
  const stages = stageState.kind === 'ok' ? stageState.stages : []
  const caps = stageState.kind === 'ok' ? stageState.caps : []
  /** 「下一步」一条（⚠ 只读；后端 `buildStages` 已算好，这里只呈现）。 */
  const next = stageState.kind === 'ok' ? stageState.next : undefined
  /** ⚠ 组合层读数（2026-11-01 P40/R6）；读不到 ⇒ `undefined` ⇒ 下面显示「判不出」。 */
  const portfolio = stageState.kind === 'ok' ? stageState.portfolio : undefined
  /** 关系标题共享表（服务端只给每个稳定 ID 一份，避免每条重复父标题）。 */
  const relations = stageState.kind === 'ok' ? (stageState.relations ?? {}) : {}
  /** 紧凑线截断说明（缺省 = 全部条目都在；⛔ 不许当成"没事"而不显示）。 */
  const truncated = stageState.kind === 'ok' ? stageState.truncated : undefined
  /**
   * 一条阶段条目：折叠时固定「ID + 标题 + 状态」，下面最多两条关系/读数；
   * 完整原文、证据和诊断放进原生 `<details>`。旧字段仍保留，缺投影时回退。
   */
  /**
   * @param legacy - 该链是否 legacy（**R-08**：legacy 第 5 步是「验收核对」= acc，
   *   ⛔ 不是 v3 的 verification）。缺省 false = v3 口径。
   */
  const renderStageItem = (it: any, step: number, keyPrefix: string, index: number, legacy = false): React.JSX.Element => {
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
        : `${relationLabel}  判不出${relation.id === null || relation.id === undefined ? stageText('stages.missingRelation') : `（父级 ${String(relation.id)} 不存在）`}`
    const status = stageStatusLabel(kindOfStep(step, legacy), String(it?.status ?? ''))
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
                ? `${String(f[0] ?? '读数')}  ${String(f[1] ?? stageText('stages.missingValue'))}`
                : `${String(f.label ?? f.key ?? '')}  ${String(f.value ?? stageText('stages.missingValue'))}`).join(' · '),
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
        React.createElement('div', { 'data-dsh-hob': 'stages-item-original-title' }, stageFmt('stages.originalTitle', { v: originalTitle === '' ? stageText('stages.missingValue') : originalTitle })),
        React.createElement(
          'div',
          { 'data-dsh-hob': 'stages-item-exception' },
          stageFmt('stages.flagsLine', { v: flags.length === 0 ? stageText('stages.noneLabel') : flags.map((code) => ITEM_FLAG_MESSAGES[code] ?? String(code)).join('；') }),
        ),
        ...((): React.ReactNode[] => {
          if (loaded === undefined) return [React.createElement('div', { key: 'detail-lazy-hint', 'data-dsh-hob': 'stages-item-detail-hint' }, stageText('stages.readingFields'))]
          if (loaded.kind === 'reading') return [React.createElement('div', { key: 'detail-reading', 'data-dsh-hob': 'stages-item-detail-state', 'data-state': 'reading' }, stageText('stages.reading'))]
          if (loaded.kind === 'fail') return [React.createElement('div', { key: 'detail-fail', 'data-dsh-hob': 'stages-item-detail-state', 'data-state': 'undecidable' }, `判不出：${loaded.message}`)]
          /**
           * 展开详情只显示服务端完整投影的中文事实；⛔ 不把英文账本字段名直接打给用户。
           * ⚠ 投影缺失（旧资源路由）⇒ 明写判不出，⛔ 不退回原始字段名冒充统一格式。
           */
          const full = loaded.presentation
          if (full === undefined) {
            return [React.createElement('div', { key: 'detail-no-presentation', 'data-dsh-hob': 'stages-item-detail-state', 'data-state': 'undecidable' }, stageText('stages.resourceNoPresentation'))]
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

  /** 阶段树的三态（⚠ 读不到就整棵树走「判不出」，⛔ 不假装 0 步）。 */
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
      return React.createElement('div', { style: subNoteStyle, 'data-dsh-hob': 'stages-unseen', 'data-state': 'reading' }, stageText('stages.reading'))
    }
    if (unseenState.kind === 'fail') {
      return React.createElement(
        'div',
        { style: subNoteStyle, 'data-dsh-hob': 'stages-unseen', 'data-state': 'undecidable' },
        React.createElement('div', { style: { fontWeight: 600 } }, stageText('stages.undecidable')),
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
              React.createElement('div', { style: { fontWeight: 600, marginTop: 3 } }, stageFmt('stages.groupCount', { label: group.label, n: group.rows.length })),
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
      ? stageFmt('stages.coverageLine', { covered: counts.covered, total: counts.total, proven: counts.proven, orphan: counts.orphan })
      : stageText('stages.undecidable')
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
          stageFmt('stages.doneNotVerified', { list: builtNoAcc.join(' · ') }),
        )]
        : []),
    )
  })()

  const capBlock = stageState.kind === 'ok'
    ? React.createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--dsw-alias-border-l4, transparent)' }, 'data-dsh-hob': 'stages-caps' },
      React.createElement('div', { style: { fontWeight: 600, fontSize: '0.92em' } }, stageCapsTitle()),
      ...(caps.length === 0
        ? [React.createElement('div', { key: 'none', style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.9em' } }, stageText('stages.capsEmpty'))]
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
           *      给它加一个和阶段条目同样形态的"状态位"，会让人以为它也在走正式阶段
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
          React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.9em' } }, String(c?.lastReading ?? stageText('stages.missingValue'))),
        ))),
    )
    : null

  /**
   * **注意力视图**（只读派生）：只列需要人或验收方行动的条目。
   * ⚠ 与阶段/portfolio 分治；字段缺席 ⇒ 明写「判不出」，⛔ 不渲染成 0 条。
   */
  const attentionBlock = ((): React.JSX.Element => {
    if (stageState.kind === 'reading') {
      return React.createElement('div', { style: subNoteStyle, 'data-dsh-hob': 'stages-attention', 'data-state': 'reading' }, stageText('stages.reading'))
    }
    if (stageState.kind === 'fail') {
      return React.createElement(
        'div',
        { style: subNoteStyle, 'data-dsh-hob': 'stages-attention', 'data-state': 'undecidable' },
        `判不出：${stageState.message}`,
      )
    }
    const rows = stageState.kind === 'ok' ? stageState.attention : undefined
    if (!Array.isArray(rows)) {
      return React.createElement(
        'div',
        { style: subNoteStyle, 'data-dsh-hob': 'stages-attention', 'data-state': 'undecidable' },
        stageText('stages.attentionUndecidable'),
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
        stageText('stages.needHumanAction'),
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
          React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, String(r?.label ?? stageText('stages.missingValue'))),
          React.createElement('span', null, String(r?.why ?? stageText('stages.noReasonGiven'))),
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
      return React.createElement('div', { style: noteStyle, 'data-dsh-hob': 'stages-state', 'data-state': 'reading' }, stageText('stages.reading'))
    }
    if (state.kind === 'fail') {
      return React.createElement(
        'div',
        { style: noteStyle, 'data-dsh-hob': 'stages-state', 'data-state': 'undecidable' },
        React.createElement('div', { style: { fontWeight: 600 } }, stageText('stages.undecidable')),
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
   * **主视图：在途需求列表 + 选中需求的阶段主线**（2026-11-07 · `R-020`）。
   *
   * ⚠ 这里不再有四个一级标签，也不再渲染全局 `summaryCard`：
   *   - 在途列表回答“现在在走哪条需求”；
   *   - 选中需求的阶段行回答“走到哪一步”；
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
  /**
   * ⚠ O-23：**完成条数以服务端 `completedCount` 为准**，⛔ 不在渲染里再 filter 数一遍。
   *   （数组 `completed` 仍用于逐条渲染历史；`retiredChains` 同理。）
   */
  const completedCount = chainState.kind === 'ok' ? chainState.completedCount : 0
  const retiredChains = chainState.kind === 'ok' ? chainState.retiredChains : []
  /**
   * ⚠ **只把在途需求当主线**。没有在途需求时主线写“没有在途需求”，
   *   ⛔ 不自动把某条已完成需求顶上来 —— 否则同一需求会在主线和底部历史里出现两遍。
   */
  const selectedChain = chains.find((c) => c.reqId === selectedReqId)
    ?? inFlight[0]
    ?? undefined
  const selectedChainId = selectedChain?.reqId
  const selectedPipeline = selectedChain?.pipeline
  /**
   * Pipeline v3 is the only authority for the active stage and next actor.
   * The `currentStep` fallback exists solely for older `/requirement-chains`
   * responses; it cannot promote a legacy item or bypass a user gate.
   */
  const selectedCurrentStep = selectedChartStepOf(selectedChain)
  const selectedChainNext = nextOfPipeline(selectedChain)

  /**
   * ⚠ **默认展开该需求链的 `currentStep`**；只算一次，⛔ 不覆盖用户手动开合。
   *   第 4 步的运行态挂在这个展开体里，所以注入 `fetchExec` 后能真实渲染。
   */
  React.useEffect(() => {
    if (defaultAppliedRef.current) return
    if (selectedCurrentStep === null || selectedCurrentStep === undefined) return
    /**
     * A user gate does not need an expanded item list to be understood. Keep
     * the five-step map collapsed so the current stage, actor and receipt stay
     * in the first screen without duplicating them in an open body.
     */
    if (selectedPipeline?.gate !== null && selectedPipeline?.gate !== undefined) {
      defaultAppliedRef.current = true
      setExpanded(new Set())
      return
    }
    defaultAppliedRef.current = true
    setExpanded(new Set([selectedCurrentStep]))
  }, [selectedCurrentStep, selectedPipeline?.gate])

  /**
   * 切换账本 ⇒ 清掉上一本的需求选择、展开态**与展开详情缓存**，⛔ 不把上一本的内容带过来。
   */
  React.useEffect(() => {
    setSelectedReqId(undefined)
    defaultAppliedRef.current = false
    setExpanded(new Set())
    /**
     * ⚠⚠ **必须一起清 `itemDetails`**（T-16）。
     *   它按**裸 ID** 为键（R-001 / TSK-001 每本账都从 001 起）⇒ 不清的话，
     *   账本 A 里展开过的 R-001，切到账本 B 后命中 `loadItemDetails` 的
     *   `itemDetails[id]?.kind === 'ok'` 早退 ⇒ **显示 A 的正文**，
     *   且早退在每次展开时都成立 ⇒ **永远不会自愈**。
     *   ⚠ 这是「界面有内容、格式正确、内容属于另一个项目」—— 最难被用户识别的一类。
     */
    setItemDetails({})
  }, [selectedLedger])

  /**
   * **账本健康（只读）**（2026-11-08 · 用户报「旧账本梳理不到完全健康」）。
   *
   * ⚠ 它回答一个此前**看不见**的问题：这本账"差什么才算健康"。
   *   改前只有"在途需求 / 阶段 / 下一步"——一本**只有一条孤立方案**的账
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
    const health = (stageState.kind === 'ok' ? stageState.stageHealth : undefined) as
      | { ok?: boolean; count?: number; problems?: Array<{ rule?: string; unit?: string; why?: string }>; truncated?: boolean }
      | undefined
    if (health === undefined) return null

    /**
     * ⚠⚠ **三件事必须分开判**（T-09 的全部内容）：
     *   ① `count`（全量条数）与 `problems.length`（本次随响应回来的条数）**不是同一个数**；
     *   ② `problems` 缺席 ≠ 没有缺口 —— 体积兜底会把它整段丢掉（stages-index.ts:602-607）；
     *   ③ 「健康」= `ok === true`，⛔ 不是 `problems.length === 0`。
     *
     * ⚠ 改前的两个假读数（必须写进 PR，否则会被当成回归）：
     *   · 41~300 条缺口时，「另有 N 条」用的是 `problems.length - 12` ⇒ 少数 10 条；
     *   · 体积兜底把 problems 丢空而 `count=300` 时，旧码印「0 条缺口」+ `data-state='ok'`
     *     —— **把 300 条缺口说成健康**。
     */
    const total = typeof health.count === 'number' && Number.isFinite(health.count) ? health.count : undefined
    const problems = Array.isArray(health.problems) ? health.problems : []
    const shown = problems.length
    /**
     * ⚠ `truncated` 有**两个来源**：服务端置位（>40 条），或「回来的比全量少」
     *   （体积兜底丢了全文）⇒ 两个都要算。
     */
    const truncated = health.truncated === true || (total !== undefined && shown < total)

    /** 真空：健康且确实是 0 条 ⇒ 整块不渲染（保持现状，⛔ 不新增噪音）。 */
    if (health.ok === true && total === 0) return null
    /** ok 但没给 count：按健康处理（⛔ 不把「上游没给读数」渲染成红块）。 */
    if (health.ok === true && total === undefined) return null

    return React.createElement(
      'details',
      {
        'data-dsh-hob': 'stages-health',
        /**
         * ⚠ **不能再用 `problems.length === 0` 判 ok**：那会把「problems 被丢空」算成健康
         *   —— 正是 T-09 的原病（300 条缺口印成「0 条缺口」且 data-state=ok）。
         */
        'data-state': health.ok === true ? 'ok' : 'unhealthy',
        'data-count': total === undefined ? '' : String(total),
        'data-shown': String(shown),
        'data-truncated': truncated ? 'true' : 'false',
        style: { fontSize: '0.9em' },
      },
      React.createElement(
        'summary',
        { style: { cursor: 'pointer', color: 'var(--dsw-alias-state-error-primary)' } },
        /**
         * ⚠ 文案口径（T-09 的唯一验收面，逐字给死，免得下一个人改成「约 N 条」）：
         *   · 全量已知 ⇒「账本健康：<total> 条缺口（先补齐才能派活）」
         *   · 全量判不出 ⇒「账本健康：判不出（本次响应未带缺口计数）」
         *   · ⛔ 任何情况下都不许把 problems.length 当总数列在这一行。
         */
        total === undefined
          ? stageText('stages.healthPrefix') + stageText('stages.undecidable') + stageText('stages.healthNoCount')
          : stageText('stages.healthPrefix') + total + stageText('stages.gapCountPrefix'),
      ),
      ...problems.slice(0, 12).map((p, i) => React.createElement(
        'div',
        { key: `health-${i}`, 'data-dsh-hob': 'stages-health-item', style: { paddingLeft: '1.2em', overflowWrap: 'anywhere' } },
        `${String(p.rule ?? '?')} · ${String(p.unit ?? '?')} · ${String(p.why ?? '')}`,
      )),
      /**
       * ⚠⚠ 「另有 N 条」的口径（T-09 要求的那条文案口径，三条给死）：
       *   ① N = 全量 − 本次已渲染条数。⛔ **不是** `problems.length - 12`：
       *      problems 本身可能已被服务端截到 40 ⇒「另有」必须把**两段截断一起算**。
       *   ② problems 缺席而 count > 0 ⇒ 明写「未随本次返回（响应超体积上限）」——
       *      ⛔ 不许写成「另有 N 条」：那会让人以为只是折叠了，实际是**没下发**。
       *   ③ 已全部渲染（rest <= 0）⇒ 这一行不出现。
       */
      ...(() => {
        if (total === undefined) return []
        if (shown === 0 && total > 0) {
          return [React.createElement('div', {
            key: 'health-more',
            'data-dsh-hob': 'stages-health-more',
            'data-kind': 'not-delivered',
            style: { paddingLeft: '1.2em', color: 'var(--dsw-alias-label-tertiary)' },
          }, '另有 ' + total + stageText('stages.notInResponse'))]
        }
        const rendered = Math.min(shown, 12)
        const rest = total - rendered
        return rest > 0
          ? [React.createElement('div', {
              key: 'health-more',
              'data-dsh-hob': 'stages-health-more',
              /** ⚠ 机检要能区分「折叠了」与「没下发」⇒ 用 data-kind 而不是靠文案。 */
              'data-kind': truncated ? 'truncated' : 'folded',
              style: { paddingLeft: '1.2em', color: 'var(--dsw-alias-label-tertiary)' },
            }, '另有 ' + rest + ' 条')]
          : []
      })(),
    )
  })()

  /** 需求列表：只显示在途需求；完成/退役进底部历史。 */
  const inFlightBlock = ((): React.JSX.Element => {
    if (blockedByPreset) return React.createElement('div', null)
    if (chainState.kind === 'reading') {
      return React.createElement('div', { style: subNoteStyle, 'data-dsh-hob': 'stages-inflight', 'data-state': 'reading' }, stageText('stages.reading'))
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
        ? { state: 'not-initialized', title: '这个项目还没有账本', how: stageText('stages.initLedger') }
        : chainState.reason === 'index-legacy'
          ? { state: 'legacy', title: stageText('stages.legacyFormatUnreadable'), how: stageText('stages.migrateLedger') }
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
        React.createElement('div', { style: { fontWeight: 600 } }, stageText('stages.undecidable')),
        React.createElement('div', { 'data-dsh-hob': 'stages-inflight-reason' }, chainState.message),
      )
    }
    /**
     * A structurally healthy ledger can still contain no v3 chain. That is a
     * migration state, not an empty project: say what to do next instead of
     * showing the benign "nothing in flight" line.
     */
    const selectedIsLegacyLedger = ledgerState.kind === 'ok'
      && (ledgerState.items.find((x: any) => x?.name === selectedLedger)?.health === 'outdated')
    if (inFlight.length === 0) {
      return React.createElement(
        'div',
        { style: subNoteStyle, 'data-dsh-hob': 'stages-inflight', 'data-state': selectedIsLegacyLedger ? 'legacy' : 'empty' },
        selectedIsLegacyLedger
          ? stageText('stages.legacyLedger')
          : completedCount > 0
            ? stageFmt('stages.noActiveReq', { n: completedCount })
            : '没有在途需求',
      )
    }
    return React.createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 3 }, 'data-dsh-hob': 'stages-inflight', 'data-state': 'rows' },
      React.createElement('div', { style: { fontWeight: 600, fontSize: '0.95em' } }, stageFmt('stages.inFlightCount', { n: inFlight.length })),
      ...inFlight.map((c) => {
        const isSel = c.reqId === selectedChainId
        const activeStep = selectedChartStepOf(c)
        const step = activeStep === null ? undefined : c.steps.find((s) => s.step === activeStep)
        const gate = c.pipeline?.gate
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
          React.createElement(
            'span',
            { 'data-dsh-hob': 'stages-inflight-stage', style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.88em' } },
            step === undefined
              ? stageText('stages.undecidable')
              : gate !== undefined && gate !== null
                ? stageFmt('stages.awaitUserConfirm', { name: step.name })
                : `${step.name} · ${CHAIN_STATE_TEXT[step.displayState]}`,
          ),
          ...(isSel ? [React.createElement('span', { key: 'cur', 'data-dsh-hob': 'stages-inflight-current' }, '已选')] : []),
        )
      }),
    )
  })()

  /** 选中需求的阶段：固定序号 / 名称 / 展示态 / 概要 / 条数，点开看该链条目。 */
  const mainlineBlock = ((): React.JSX.Element => {
    if (blockedByPreset) return React.createElement('div', null)
    if (chainState.kind === 'reading') {
      return React.createElement('div', { style: subNoteStyle, 'data-dsh-hob': 'stages-mainline', 'data-state': 'reading' }, stageText('stages.reading'))
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
       *   在途区已经写「没有在途需求 —— N 条需求已走完正式阶段」，
       *   主线与下一步再各写一遍就是同一句话出现三次。
       *   ⇒ 没有选中链时，主线保持一个**无内容占位**（data-state=empty），
       *     不再重复计数；历史仍在底部说明 N 条已完成。
       *   ⛔ 不把“全部收口”说成“账本为空”（空账本已在 fail 分支单独处理）。
       */
      return React.createElement('div', { style: subNoteStyle, 'data-dsh-hob': 'stages-mainline', 'data-state': 'empty' })
    }
    /**
     * ⚠ **验收材料三件不藏在展开体里**（2026-11-08 · 阶段反馈核对）。
     *   当前步一旦是产品验收，用户最需要知道的是“产品确认 / 技术证据 / 例子结果”
     *   哪件还缺；把它放进折叠条目里等于让验收再次靠猜。
     *   ⚠ 这里只显示账本已经给出的事实：AC 条目与候选证据的**存在数**；
     *     ⛔ 不在这里推导“通过”、⛔ 不显示百分比。
     */
    const acceptanceReadout = selectedPipeline?.stages[selectedCurrentStep === null ? -1 : selectedCurrentStep - 1]?.id === 'acceptance'
      ? (() => {
          const items = selectedChain.steps.find((s) => s.name === '产品验收')?.itemIds
            .map((id) => stageItemsById.get(id))
            .filter((x) => x !== undefined) ?? []
          const accs = items.filter((it: any) => it.kind === 'acc')
          /**
           * Residual risk belongs to the product decision. When the ledger has
           * a decided acceptance, show its residual tier and acceptance facts
           * on the first screen; an absent tier is stated as undecidable rather
           * than silently reading as low.
           */
          const decided = accs.filter((it: any) => it.status === 'pass' || it.status === 'send-back')
          const residuals = [...new Set(decided.map((it: any) => String(it.risk_residual_tier ?? '').trim()).filter((x) => x !== ''))]
          const residualLine = decided.length === 0
            ? ''
            : residuals.length === 0
              ? stageText('stages.residualUnknown')
              : stageFmt('stages.residualNote', { r: residuals.join(' / ') })
                  + (() => {
                      const acceptedBy = [...new Set(decided.map((it: any) => String(it.risk_accepted_by ?? '').trim()).filter((x) => x !== ''))]
                      return acceptedBy.length === 0 ? '' : stageFmt('stages.acceptorNote', { list: acceptedBy.join(' / ') })
                    })()
                  + (() => {
                      const monitoring = [...new Set(decided.map((it: any) => String(it.risk_residual_monitoring ?? '').trim()).filter((x) => x !== ''))]
                      return monitoring.length === 0 ? '' : stageFmt('stages.monitoringNote', { m: monitoring[0] })
                    })()
          /**
           * The first screen also states the intrinsic risk alongside the
           * residual one, so the user can see the two layers together instead
           * of reading a low residual as if the original risk were low.
           */
          const intrinsicLine = selectedPipeline?.risk === undefined
            ? ''
            : stageFmt('stages.inherentRisk', { tier: selectedPipeline.risk.tier })
          return stageFmt('stages.acceptanceMaterials', { n: accs.length, rest: intrinsicLine + residualLine })
        })()
      : ''
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
        {
          'data-dsh-hob': 'stages-pipeline-readout',
          'data-state': selectedPipeline?.state ?? 'legacy',
          'data-gate': selectedPipeline?.gate ?? '',
          'data-active-stage': selectedPipeline?.activeStage === null
            ? 'done'
            : String(selectedPipeline?.activeStage ?? ''),
          style: subNoteStyle,
        },
        selectedPipeline === undefined
          ? stageText('stages.stageUndecidableNoView')
          : selectedPipeline.state === 'legacy'
            ? stageText('stages.legacyPipelineReadonly')
            : selectedPipeline.activeStage === null
              ? stageText('stages.sixStagesDone')
              : stageFmt('stages.currentStage', { step: selectedPipeline.activeStage, name: selectedPipeline.stages[selectedPipeline.activeStage - 1]?.name ?? '', action: selectedPipeline.nextAction })
                + (selectedPipeline.closurePending === true
                  /**
                   * ⚠⚠ **R-09**：交付收口是**风险启用门**，⛔ 不是第七个业务阶段。
                   *   旧码在收口未完成时设 `activeStage = 7` ⇒ 这里印「第 7 步 · 交付收口」，
                   *   用户以为还有**第七个业务阶段**没做。
                   *   ⇒ 现在业务阶段停在 6，收口用 `closurePending` 表达，这里改印**门的措辞**：
                   *     「第 6 步 · 产品验收（已过）· 待交付收口」。
                   *   ⚠ 「已过」是准确的：能走到 closurePending，说明 G5 已经过了。
                   */
                  ? stageText('stages.deliveryPending')
                  : ''),
      ),
      ...(selectedPipeline?.gate === 'G1-requirement'
        ? [React.createElement(
            'div',
            {
              key: 'gate-g1',
              'data-dsh-hob': 'stages-current-gate',
              'data-gate': 'G1-requirement',
              'data-next-actor': selectedPipeline.nextActor,
              style: { ...subNoteStyle, color: 'var(--dsw-alias-label-secondary)' },
            },
            React.createElement('div', null, stageFmt('stages.gate1', { req: selectedPipeline.reqId, rev: selectedPipeline.requirementRevision ?? '?' })),
            React.createElement('div', { 'data-dsh-hob': 'stages-gate-actor' }, stageFmt('stages.responsible', { who: selectedPipeline.nextActor })),
            React.createElement('div', { 'data-dsh-hob': 'stages-gate-action' }, `下一步：${selectedPipeline.nextAction}`),
            React.createElement('div', { 'data-dsh-hob': 'stages-gate-receipt' },
              stageFmt('stages.confirmReq', { req: selectedPipeline.reqId, rev: selectedPipeline.requirementRevision ?? '?' })),
            React.createElement('div', { 'data-dsh-hob': 'stages-gate-receipt' },
              stageFmt('stages.editReqHint', { req: selectedPipeline.reqId })),
          )]
        : []),
      ...(selectedPipeline?.gate === 'G2-plan'
        ? [React.createElement(
            'div',
            {
              key: 'gate-g2',
              'data-dsh-hob': 'stages-current-gate',
              'data-gate': 'G2-plan',
              'data-next-actor': selectedPipeline.nextActor,
              style: { ...subNoteStyle, color: 'var(--dsw-alias-label-secondary)' },
            },
            React.createElement('div', null, stageFmt('stages.gate2', { plan: selectedPipeline.stages[1]?.itemIds[0] ?? '', rev: selectedPipeline.planRevision ?? '?' })),
            React.createElement('div', { 'data-dsh-hob': 'stages-gate-actor' }, stageFmt('stages.responsible', { who: selectedPipeline.nextActor })),
            React.createElement('div', { 'data-dsh-hob': 'stages-gate-action' }, `下一步：${selectedPipeline.nextAction}`),
            React.createElement('div', { 'data-dsh-hob': 'stages-gate-receipt' },
              stageFmt('stages.confirmPlan', { plan: selectedPipeline.stages[1]?.itemIds[0] ?? '', rev: selectedPipeline.planRevision ?? '?' })),
            React.createElement('div', { 'data-dsh-hob': 'stages-gate-receipt' },
              stageFmt('stages.editPlanHint', { plan: selectedPipeline.stages[1]?.itemIds[0] ?? '' })),
          )]
        : []),
      ...(selectedPipeline?.gate === 'G5-acceptance'
        ? [React.createElement(
            'div',
            {
              key: 'gate-g5',
              'data-dsh-hob': 'stages-current-gate',
              'data-gate': 'G5-acceptance',
              'data-next-actor': selectedPipeline.nextActor,
              style: { ...subNoteStyle, color: 'var(--dsw-alias-label-secondary)' },
            },
            React.createElement('div', null, stageText('stages.gate5WaitAccept')),
            React.createElement('div', { 'data-dsh-hob': 'stages-gate-actor' }, stageFmt('stages.responsible', { who: selectedPipeline.nextActor })),
            React.createElement('div', { 'data-dsh-hob': 'stages-gate-action' }, `下一步：${selectedPipeline.nextAction}`),
            React.createElement('div', { 'data-dsh-hob': 'stages-gate-receipt' }, stageText('stages.acceptChoices')),
          )]
        : []),
      ...(selectedPipeline?.gate === 'G6-closure'
        ? [React.createElement(
            'div',
            {
              key: 'gate-g6',
              'data-dsh-hob': 'stages-current-gate',
              'data-gate': 'G6-closure',
              'data-next-actor': selectedPipeline.nextActor,
              style: { ...subNoteStyle, color: 'var(--dsw-alias-label-secondary)' },
            },
            React.createElement('div', null, stageFmt('stages.gate6', { mode: selectedPipeline.closureMode ?? stageText('stages.undecidable') + '模式' })),
            React.createElement('div', { 'data-dsh-hob': 'stages-gate-actor' }, stageFmt('stages.responsible', { who: selectedPipeline.nextActor })),
            React.createElement('div', { 'data-dsh-hob': 'stages-gate-action' }, `下一步：${selectedPipeline.nextAction}`),
            React.createElement('div', { 'data-dsh-hob': 'stages-gate-receipt' }, stageText('stages.productAccepted')),
          )]
        : []),
      ...(selectedPipeline?.risk === undefined
        ? []
        : [React.createElement(
            'div',
            { key: 'risk-readout', 'data-dsh-hob': 'stages-risk-readout', 'data-risk-tier': selectedPipeline.risk.tier, style: subNoteStyle },
            stageFmt('stages.riskAndClosure', { tier: selectedPipeline.risk.tier, closure: selectedPipeline.closureMode ?? selectedPipeline.risk.closure })
              + (selectedPipeline.risk.hardTriggers.length === 0
                ? ''
                : ` · 硬触发：${selectedPipeline.risk.hardTriggers.map((x) => {
                    const checked = selectedPipeline.risk?.hardTriggerFacts?.find((f) => f.trigger === x)
                    return checked === undefined ? stageFmt('stages.factUndecidable', { x }) : stageFmt('stages.factWithControl', { x, mitigation: checked.mitigation })
                  }).join(' / ')}`)
              + (selectedPipeline.risk.needsIndependentReview ? stageText('stages.needsReview') : '')
              + (selectedPipeline.risk.needsDualReview ? stageText('stages.needsDoubleReview') : ''),
          )]),
      ...(acceptanceReadout === ''
        ? []
        : [React.createElement(
            'div',
            { key: 'acceptance-materials', 'data-dsh-hob': 'stages-current-acceptance-materials', style: { fontSize: '0.9em', overflowWrap: 'anywhere', color: 'var(--dsw-alias-label-secondary)' } },
            acceptanceReadout,
          )]),
      React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 2 }, 'data-dsh-hob': 'stages-tree', 'data-state': 'rows' },
        ...selectedChain.steps.map((step) => {
          /** ⚠ **R-08**：legacy 链的第 5 步是「验收核对」= acc（与 v3 的 verification 不同）。 */
          const chainIsLegacy = selectedChain.pipeline?.state === 'legacy'
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
                    ? [React.createElement('div', { key: 'none', style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.9em' }, 'data-dsh-hob': 'stages-mainline-empty' }, stageText('stages.stepEmpty'))]
                    : items.map((it: any, i: number) => renderStageItem(it, step.step, `chain-${step.step}`, i, chainIsLegacy))),
                  ...(step.step === 4 && showsSessionRuntime
                    ? [
                        React.createElement('details', { key: 'exec', 'data-dsh-hob': 'stages-step-exec' },
                          React.createElement('summary', { style: { cursor: 'pointer', fontSize: '0.9em', color: 'var(--dsw-alias-label-tertiary)' } }, stageText('stages.runtimeCollapsed')),
                          execList),
                        React.createElement('details', { key: 'plans', 'data-dsh-hob': 'stages-step-plans' },
                          React.createElement('summary', { style: { cursor: 'pointer', fontSize: '0.9em', color: 'var(--dsw-alias-label-tertiary)' } }, stageText('stages.plansCollapsed')),
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
      return React.createElement('div', { style: subNoteStyle, 'data-dsh-hob': 'stages-next', 'data-state': 'reading' }, stageText('stages.reading'))
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
    const a = selectedChainNext ?? selectedChain.next
    const blockers = Array.isArray(a.blockedBy) ? a.blockedBy.map(String) : []
    const why = typeof a.why === 'string' && a.why !== '' ? a.why : stageText('stages.undecidable')
    return React.createElement(
      'div',
      { style: subNoteStyle, 'data-dsh-hob': 'stages-next', 'data-state': a.kind === 'undecidable' ? 'undecidable' : 'ok', 'data-next-kind': a.kind },
      React.createElement('div', { style: { fontWeight: 600, overflowWrap: 'anywhere' }, 'data-dsh-hob': 'stages-next-line' },
        a.kind === 'undecidable' ? `${stageText('stages.undecidable')}：${why}` : `下一步：${why}`),
      React.createElement('div', { 'data-dsh-hob': 'stages-next-blocker', style: { overflowWrap: 'anywhere' } },
        blockers.length === 0 ? stageText('stages.noBlocker') : stageFmt('stages.blockedOn', { why: blockers[0] })),
      ...(blockers.length > 1 ? [React.createElement('div', { key: 'more', 'data-dsh-hob': 'stages-next-blocker-rest' }, stageFmt('stages.anotherCount', { n: blockers.length - 1 }))] : []),
    )
  })()

  /** 底部历史：已完成 / 退役需求；每个需求可展开看该链的条目。 */
  const historySection = ((): React.JSX.Element => {
    if (blockedByPreset) return React.createElement('div', null)
    if (chainState.kind === 'reading') {
      return React.createElement('div', { style: subNoteStyle, 'data-dsh-hob': 'stages-history-section', 'data-state': 'reading' }, stageText('stages.reading'))
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
        /** ⚠ **R-08**：历史链同样要区分 legacy（同上）。 */
        const histIsLegacy = c.pipeline?.state === 'legacy'
        return React.createElement(
          'div',
          { key: `hist-step-${c.reqId}-${s.step}`, style: { paddingLeft: 10 }, 'data-dsh-hob': 'stages-history-step', 'data-step': String(s.step) },
          React.createElement('div', { style: { fontWeight: 600, fontSize: '0.86em', color: 'var(--dsw-alias-label-tertiary)' } }, `${s.step} ${s.name} · ${CHAIN_STATE_TEXT[s.displayState]}`),
          ...items.map((it: any, k: number) => renderStageItem(it, s.step, `h-${c.reqId}-${s.step}`, k, histIsLegacy)),
        )
      }),
    )
    return React.createElement(
      'details',
      { 'data-dsh-hob': 'stages-history-section', style: { display: 'flex', flexDirection: 'column', gap: 4 } },
      React.createElement('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, stageFmt('stages.historySummary', { done: completedCount, total })),
      ...completed.map(renderChainHistory),
      ...(retiredChains.length === 0
        ? []
        : [React.createElement(
            'details',
            { key: 'retired', 'data-dsh-hob': 'stages-history-retired' },
            React.createElement('summary', { style: { cursor: 'pointer', fontSize: '0.9em', color: 'var(--dsw-alias-label-tertiary)' } }, stageFmt('stages.retiredCount', { n: retiredChains.length })),
            ...retiredChains.map((c) => React.createElement(
              'details',
              { key: `ret-${c.reqId}`, 'data-dsh-hob': 'stages-history-chain', 'data-req-id': c.reqId, style: subNoteStyle },
              React.createElement('summary', { style: { cursor: 'pointer', overflowWrap: 'anywhere' } }, `${c.reqId} · ${c.title}`),
              React.createElement('div', { style: { paddingLeft: 10 } }, stageFmt('stages.reqStatus', { st: c.reqStatus === 'retired' ? stageText('stages.retired') : stageText('stages.discarded'), n: c.itemIds.length })),
            )),
          )]),
    )
  })()

  /** 紧凑线截断说明：它是“为什么少列了”的读数，仍在主线首屏，⛔ 不折叠。 */
  const truncatedNotice = ((): React.JSX.Element | null => {
    if (blockedByPreset) return null
    const t = stageState.kind === 'ok' ? stageState.truncated : undefined
    const omitted = Number(t?.omitted ?? 0)
    if (t === undefined || !Number.isFinite(omitted) || omitted <= 0) return null
    return React.createElement(
      'div',
      { 'data-dsh-hob': 'stages-summary-truncated', style: subNoteStyle },
      `列表范围：另有 ${omitted} 条未随本次返回（${String(t?.reason ?? stageText('stages.responseTooLarge'))}）`,
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
        stageText('stages.presetOnlyBanner'),
      )
    }
    if (ledgerState.kind === 'reading') {
      return React.createElement('div', { 'data-dsh-hob': 'stages-ledgers', 'data-state': 'reading', style: subNoteStyle }, stageText('stages.ledgerReading'))
    }
    if (ledgerState.kind === 'fail') {
      return React.createElement(
        'div',
        { 'data-dsh-hob': 'stages-ledgers', 'data-state': 'undecidable', style: subNoteStyle },
        `账本：${stageText('stages.undecidable')}（${ledgerState.message}）`,
      )
    }
    const items = ledgerState.items
    const catalogSummary = ledgerState.kind === 'ok' ? ledgerState.summary : undefined
    if (items.length === 0) {
      return React.createElement('div', { 'data-dsh-hob': 'stages-ledgers', 'data-state': 'empty', style: subNoteStyle }, stageText('stages.noLedgerAtAll'))
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
      const health = String(x?.health ?? (state === 'data' ? 'outdated' : state === 'empty' ? 'empty' : 'unreadable'))
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
          'data-health': health,
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
          health === 'current'
            ? stageFmt('stages.latestUnits', { n: units })
            : health === 'outdated'
              ? stageFmt('stages.migrateUnits', { n: units })
              : health === 'backup'
                ? stageFmt('stages.backupUnits', { n: units })
                : state === 'empty'
                  ? '空账本'
                  : '读不了'),
      )
    }
    /**
     * 当前选中项（用于同一行的项目名）。⚠ 找不到时如实写判不出，⛔ 不拿第一项冒充。
     */
    const selected = items.find((x: any) => x?.name === selectedLedger)
      ?? items.find((x: any) => x?.current === true)
      ?? withData[0]
      ?? items[0]
    const selectedName = String(selected?.name ?? stageText('stages.missingValue'))
    const selectedState = String(selected?.state ?? 'unreadable')
    const selectedHealth = String(selected?.health ?? (selectedState === 'data' ? 'outdated' : selectedState === 'empty' ? 'empty' : 'unreadable'))
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
     *      ⛔ 不再推动下面的在途需求 / 阶段主线；
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
          selectedHealth === 'current'
            ? stageFmt('stages.latestUnits', { n: selectedUnits })
            : selectedHealth === 'outdated'
              ? stageFmt('stages.migrateUnits', { n: selectedUnits })
              : selectedHealth === 'backup'
                ? stageFmt('stages.backupUnits', { n: selectedUnits })
                : selectedState === 'empty'
                  ? '空账本'
                  : '读不了',
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
          'aria-label': stageText('stages.switchLedger'),
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
              React.createElement('div', { className: 'dsh-hob-ledger-group-title' }, stageFmt('stages.emptyLedgerCount', { n: empty.length })),
              ...empty.map(row),
            )]),
        ...(unreadable.length === 0
          ? []
          : [React.createElement(
              'div',
              { key: 'ledgers-unreadable', 'data-dsh-hob': 'stages-ledgers-unreadable-group', 'data-state': 'unreadable', className: 'dsh-hob-ledger-group' },
              React.createElement('div', { className: 'dsh-hob-ledger-group-title' }, stageFmt('stages.unreadableLedgerCount', { n: unreadable.length })),
              ...unreadable.map(row),
            )]),
        ...(catalogSummary === undefined
          ? []
          : [React.createElement('div', {
              key: 'ledgers-summary',
              'data-dsh-hob': 'stages-ledgers-summary-counts',
              className: 'dsh-hob-ledger-note',
            }, stageFmt('stages.catalogSummary', {
              cur: catalogSummary.current,
              out: catalogSummary.outdated,
              empty: catalogSummary.empty,
              backup: catalogSummary.backup,
              rest: catalogSummary.unreadable > 0
                ? stageFmt('stages.unreadableSuffix', { n: catalogSummary.unreadable })
                : '',
            }))]),
        ...(current === undefined
          ? [React.createElement('div', { key: 'cur-miss', 'data-dsh-hob': 'stages-ledgers-current-missing', className: 'dsh-hob-ledger-note' }, stageText('stages.fellBackLedger'))]
          : []),
      ),
    )
  })()

  /**
   * **当前推进方式**（常驻一行）。
   *
   * ⚠ 用户报障：三个面板都显示“当前状态”，却不知道当前会话按哪一档推进。
   *   ⇒ 首屏只给一行事实：档位 + 来源；⛔ 不重复计划里的 `modeSnapshot`（那是创建时快照）。
   * ⚠ 读数来自 `work-plans` 路由的现读结果；判不出就明写「判不出」，⛔ 不猜缺省档。
   */
  const workModeLine = ((): React.JSX.Element | null => {
    if (blockedByPreset) return null
    if (plansState.kind === 'reading') {
      return React.createElement('div', {
        'data-dsh-hob': 'stages-work-mode',
        'data-state': 'reading',
        style: subNoteStyle,
      }, stageText('stages.modeReading'))
    }
    if (plansState.kind === 'fail') {
      return React.createElement('div', {
        'data-dsh-hob': 'stages-work-mode',
        'data-state': 'undecidable',
        style: subNoteStyle,
      }, stageFmt('stages.modeUndecidable', { msg: plansState.message }))
    }
    const report = plansState.report
    const MODE_TEXT: Readonly<Record<string, string>> = { auto: '自动', single: stageText('stages.singleSession'), multi: stageText('stages.multiSession') }
    const mode = String(report?.mode ?? 'unknown')
    const source = String(report?.modeSource ?? 'unknown')
    const sourceText = source === 'stored' ? stageText('stages.sessionPolicy')
      : source === 'legacy-migrated' ? stageText('stages.legacyMigrate')
        : source === 'unknown' ? stageText('stages.missingValue') : source
    return React.createElement('div', {
      'data-dsh-hob': 'stages-work-mode',
      'data-state': mode,
      style: { ...subNoteStyle, overflowWrap: 'anywhere' },
    }, stageFmt('stages.modeAndSource2', { mode: MODE_TEXT[mode] ?? mode, source: sourceText }))
  })()

  /**
   * 降级文案里的「最后一次成功」。
   *
   * ⚠ **渲染期读 `Date.now()` 的取舍**：这里接受静止（面板本来就有 5s/60s 刷新节拍，
   *   下次渲染自校正），⛔ **不为这一行再加一个定时器**——那正是 O-18 的病
   *   （1s 时钟驱动父组件重渲染）。
   */
  const lastOkLabel = lastOkAt === undefined
    ? stageText('stages.neverSucceeded')
    : Math.max(1, Math.round((Date.now() - lastOkAt) / 1000)) + stageText('stages.secondsAgo')

  const secondaryBlock = React.createElement(
    'details',
    { 'data-dsh-hob': 'stages-secondary', style: { display: 'flex', flexDirection: 'column', gap: 6 } },
    React.createElement('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, stageText('stages.extraInfoTitle')),
    React.createElement(CurrentPanel, {
      sessionId: props?.sessionId,
      refreshTick: pollTick,
      /**
       * ⚠ O-18：引用必须**稳定**（见 `fetchCurrentResource`），否则 CurrentPanel 的 effect
       *   每秒重跑一次 `/ledger-resource`。注入的 `props.fetchCurrent` 优先（宿主/机检可覆盖）。
       */
      ...(props?.fetchCurrent === undefined
        ? { fetchCurrent: fetchCurrentResource }
        : { fetchCurrent: props.fetchCurrent }),
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
        'aria-label': `${stageText('stages.panelTitle')}（仅 Hob 预设）`,
      },
      React.createElement('div', { style: { fontWeight: 600 } }, stageText('stages.panelTitle')),
      React.createElement(
        'div',
        { 'data-dsh-hob': 'stages-preset-blocked', style: subNoteStyle },
        stageText('stages.presetOnlyLine'),
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
      'aria-label': `${stageText('stages.panelTitle')}（可上下滚动）`,
    },
    React.createElement('div', { style: { fontWeight: 600 } }, stageText('stages.panelTitle')),
    workModeLine,
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
      React.createElement('div', { style: { marginTop: '8px', fontSize: '0.85em' } }, stageText('stages.legacyBoardHidden')),
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
        {
          'data-dsh-hob': 'stages-live-state',
          /**
           * ⚠ **降级优先**：数据通道超时 ⇒ 徽标必须说「已降级 / 停止刷新」，
           *   ⛔ 不许在"数据定格"时仍显示「已连接」（T-04 的核心观感）。
           */
          'data-state': stalled ? 'degraded' : liveState,
          /** 传输层原值单独保留，便于机检把两个正交维度分开断言。 */
          'data-transport': liveState,
          'data-stalled': stalled ? 'true' : 'false',
          style: { color: (stalled || liveState === 'fallback') ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-tertiary)', fontSize: '0.85em' },
        },
        stalled
          /**
           * ⚠ 这句必须**同时**说清三件事（缺一句就还是「说不清」）：
           *   ① 数据没刷新；② 最后一次成功是何时；③ 有没有在重试。
           * ⛔ 不许出现「已连接」字样（T-04 的核心观感：不能一边定格一边说连着）。
           */
          ? stageText('stages.fetchTimedOut') + lastOkLabel + stageText('stages.retryingPrefix') + Math.max(1, Math.round(retryIntervalMs / 1000)) + stageText('stages.retryingSuffix')
          : liveState === 'live' ? stageText('stages.liveConnected')
            : liveState === 'fallback' ? stageText('stages.liveDegraded')
              : liveState === 'reconnecting' ? stageText('stages.liveReconnecting')
                /**
                 * ⚠ **'unknown' 是占位档，当前不会有真值**：`LiveConnectionState` 是四值封闭集
                 *   （live-client.ts:18），本批**不改**它。这一支只为 O-41（B5，门禁三态化）预留：
                 *   落地后 `StagesPanelLive` 可把「宿主未注入 useTabInfo / 可见性判不出」传进来。
                 *   ⛔ 不删（删了 O-41 就没有观感出口），也⛔ 不现在给它造假值。
                 */
                : (liveState as string) === 'unknown' ? stageText('stages.liveUndecidable')
                  : stageText('stages.liveConnecting'),
      ),
    ),
    React.createElement(
      'div',
      { style: noteStyle, 'data-dsh-hob': 'stages-note' },
      stageText('stages.readOnlyNotice'),
    ),
  )
}

export function StagesTabTitle(): React.JSX.Element {
  return React.createElement('span', null, stageText('stages.panelTitle'))
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
  useTabInfo?: () => any
}): React.JSX.Element {
  const useProjection = props.useProjection
  const preset = typeof useProjection === 'function'
    ? (useProjection('agentPreset') as string | null | undefined)
    : undefined
  /**
   * Host tab visibility is stronger than `document.visibilityState`: the two
   * sidebar tabs share one document. `sidebar.expanded` is required because a
   * selected tab can stay mounted while its right-hand column is collapsed.
   */
  const tabInfo = typeof props.useTabInfo === 'function' ? props.useTabInfo() : undefined
  const tabVisible = tabInfo?.tab?.visible
  const sidebarExpanded = tabInfo?.sidebar?.expanded
  const effectiveVisible = tabVisible === true && sidebarExpanded !== false
  return (StagesPanel as any)({
    sessionId: props.sessionId,
    agentPreset: preset,
    tabVisible: effectiveVisible,
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
      'aria-label': props.title ?? stageText('stages.panelTitle'),
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
    React.createElement('span', { style: { fontWeight: 600, fontSize: 14 } }, props.title ?? stageText('stages.panelTitle')),
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
      title: () => stageText('stages.panelTitle'),
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
        title: () => stageText('stages.panelTitle'),
        description: () => stageText('stages.mainlineHint'),
      }],
    })
    return () => { try { dispose?.() } catch { /* 忽略 */ } }
  })
  return () => {
    if (typeof off?.dispose === 'function') void off.dispose()
  }
}

