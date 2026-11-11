/**
 * ══ **面板 marker 契约的唯一归属地**（2026-11-07 · `archive/2026-11-07-panel-marker-contract/TASK.md` 段 1）══
 *
 * ── 它治的病（有实测出处，⛔ 不是假想）────────────────────────────────────────
 *   `check-stages-panel-dom.mjs` 的 `S-32a` 曾直接在源码里写死
 *   `[data-dsh-hob="stages-attention-item"]`，而面板改过 marker 名。
 *   ⇒ **同一批行，两边两套字符串** ⇒ 判据抓不到节点 ⇒ 假红 4 档（`S-32a` ×4）
 *     + 同源的 `S-36c` 1 档。
 *   ⚠ 2026-11-07 R-020 收口后「当前工作」队列已整块删除：注意力只在**补充信息**里
 *     由 `attentionBlock` 承载（空态 / 判不出 / 逐行都走它）。旧 `stages-work-*`
 *     四个 marker 已从本表移除；它们**不再由面板渲染**，判据也不许再用。
 *   ⚠ 这正是 `DECISIONS.md` 教训 6 那条：
 *     **判据的选择器与被测组件的 marker 必须有单一归属地** ——
 *     两处各写一遍 ⇒ 每次组件重构都制造假红。
 *
 * ── 设计约束（⚠ 决定了本模块**不能**是简单的 import 常量表）────────────────────
 *   面板 `src/client/project-panel.tsx` **只能** import `src/**` 内的模块
 *   （`tsconfig.client.json` 的 `include` 是 `src/client`，`ts-mount` 也只挂 `src`）。
 *   而本单 §三 **⛔ 明令不许改 `src/**` 任何源码**（含 `project-panel.tsx`）。
 *   ⇒ 物理上无法让面板「从本文件 import 常量」。
 *
 * ── 所以本模块做的是**契约声明 + 双向核对**，⛔ 不是「两边各写一份常量」──────
 *   ① `PANEL_MARKERS`：**唯一一份** marker 清单（名字 → 字面量 + 语义说明）；
 *   ② `checkMarkerContract({ panelSrc, checkerSrc })`：
 *      - **面板侧**：面板源码里必须**真的**出现每个"在用" marker 的字面量；
 *        且**退场**的 marker（`retired: true`）必须**一个都不出现**；
 *      - **判据侧**：判据源码里出现的每个 `stages-*` 字面量，必须是本表登记过的名字
 *        （⚠ 不许判据自己发明一个面板根本没渲染的 marker）。
 *   ⇒ 任何一侧改了 marker 而另一侧没跟上，**这条契约当场红**，并**点名是哪个 marker**。
 *   ⚠ 这不是"两处各写一份"：**名字与字面量的对应关系只在本文件写一次**；
 *     面板与判据里出现的是**业务代码本来就需要的字面量**（面板要写进 DOM、判据要查 DOM），
 *     本模块负责**核对它们是否与唯一那份清单一致**。
 *
 * ── ⚠ 若日后允许改 `src/**` ────────────────────────────────────────────────
 *   应把 `PANEL_MARKERS` 搬到 `src/shared/panel-markers.ts`，让面板真 import；
 *   本模块改为 re-export + 核对。⚠ 届时不变量不变：**字面量仍只写一处**。
 */

/**
 * **marker 清单（唯一一份）**。
 *
 * 字段：
 * - `literal`：`data-dsh-hob` 的**字面量**（⚠ 唯一真相；别处只许引用 `PANEL_MARKERS[名].literal`）；
 * - `who`：谁渲染它（`panel` = `project-panel.tsx`；`none` = 已彻底退场）；
 * - `retired`：`true` ⇒ 面板里**不许**再出现（退场依据写进 `why`）；
 * - `why`：为什么它存在 / 为什么退场（⚠ 退场的必须写依据）。
 */
export const PANEL_MARKERS = Object.freeze({
  // ── 注意力面（S-32 家族）─────────────────────────────────────────────────
  attention: Object.freeze({
    literal: 'stages-attention',
    who: 'panel',
    why: '注意力块容器；R-020 起只挂在「补充信息」折叠里，空态 / 判不出 / 逐行都由它承载',
  }),
  attentionItem: Object.freeze({
    literal: 'stages-attention-item',
    who: 'panel',
    /**
     * ⚠ **可达性（2026-11-07 R-020 收口重核）**：
     *   `project-panel.tsx` 的 `attentionBlock` **定义仍在**（它承载空态 / 判不出两条语义），
     *   但 `stages-attention-item` 这个 marker 只在 `attentionBlock` 的 `rows.map(...)` 里出现，
     *   R-020 起「当前工作」队列整块删除，注意力只走 `attentionBlock`；
     *   本 marker 仍留在源码里（`attentionBlock` 的 `rows.map`），且**真实渲染可达**
     *   （补充信息展开后能看到）。⚠ 因此它仍是 `who: 'panel'` 的正常 marker。
     */
  }),
  attentionEmpty: Object.freeze({
    literal: 'stages-attention-empty',
    who: 'panel',
    why: '注意力为 0 条时的空态（⚠ 与「判不出」分开的一档，S-32b 钉它）',
  }),
  // ── 摘要卡（R-018 第 1 条的四要素：阶段 / 下一步 / 在等谁 / 主阻断）─────────
  /**
   * ⚠ **2026-11-07 R-020 起退场**：首屏不再有全局摘要卡，改为
   *   「在途需求 → 选中需求的五步 → 唯一 currentStep」。
   *   保留登记只为让旧判据/文档可追溯；面板里**不许**再渲染它。
   */
  summary: Object.freeze({
    literal: 'stages-summary',
    who: 'none',
    retired: true,
    why: '全局摘要卡已删除；当前状态改由选中需求的五步主线表达',
  }),
  summaryStage: Object.freeze({
    literal: 'stages-summary-stage',
    who: 'none',
    retired: true,
    why: '随全局摘要卡退场；当前阶段改由五步行的 aria-current 表达',
  }),
  summaryAction: Object.freeze({
    literal: 'stages-summary-action',
    who: 'none',
    retired: true,
    why: '随全局摘要卡退场；下一步改由选中需求链自己的 next 表达',
  }),
  summaryWait: Object.freeze({
    literal: 'stages-summary-wait',
    who: 'none',
    retired: true,
    why: '随全局摘要卡退场；等待对象并入选中需求链的 next.why',
  }),
  summaryBlocker: Object.freeze({
    literal: 'stages-summary-blocker',
    who: 'none',
    retired: true,
    why: '随全局摘要卡退场；主阻断改由选中需求链的 next.blockedBy 表达',
  }),
  summaryAcceptance: Object.freeze({
    literal: 'stages-summary-acceptance',
    who: 'none',
    retired: true,
    why: '验收计数改在选中需求第 5 步的概要里出现，不再有全局摘要卡',
  }),
  summaryTruncated: Object.freeze({
    literal: 'stages-summary-truncated',
    who: 'panel',
    why: '响应被截断时的「另有 N 条未随本次返回」行（⚠ 仍在主线首屏，⛔ 不折叠）',
  }),
  // ── R-020 新主视图（2026-11-07）─────────────────────────────────────────
  ledgers: Object.freeze({
    literal: 'stages-ledgers',
    who: 'panel',
    why: '项目 / 账本选择器容器（data / empty / unreadable 三档）',
  }),
  ledgerItem: Object.freeze({
    literal: 'stages-ledger-item',
    who: 'panel',
    why: '一个账本项目（data-ledger 给名字，data-current 标当前工作区）',
  }),
  ledgerSummary: Object.freeze({
    literal: 'stages-ledgers-summary',
    who: 'panel',
    why: '项目选择器的一行摘要：`项目：<当前账本> · N 单元 ▾`（⚠ 与下拉同一行，⛔ 不再整块纵向列表）',
  }),
  ledgerCurrentName: Object.freeze({
    literal: 'stages-ledgers-current-name',
    who: 'panel',
    why: '同一行里的当前项目名；默认跟随服务端 current（当前工作区账本）',
  }),
  ledgerSummaryCounts: Object.freeze({
    literal: 'stages-ledgers-summary-counts',
    who: 'panel',
    why: '项目梳理汇总：最新 / 需迁 v3 / 空账 / 备份 / 读不了 各档计数（⛔ 不用单元总数冒充健康）',
  }),
  ledgerMenu: Object.freeze({
    literal: 'stages-ledgers-menu',
    who: 'panel',
    why: '账本下拉的**浮层菜单**（position:absolute + 限高滚动）；判据 S-34e 量它“⛔ 不推动下面内容、⛔ 不再套一份纵向列表”',
  }),
  workMode: Object.freeze({
    literal: 'stages-work-mode',
    who: 'panel',
    why: '首屏常驻「推进方式：<档位> · 来源：<来源>」一行（读取中 / 判不出 各有独立 data-state）',
  }),
  inflight: Object.freeze({
    literal: 'stages-inflight',
    who: 'panel',
    why: '在途需求列表容器；首屏回答“现在在走哪条需求”',
  }),
  inflightItem: Object.freeze({
    literal: 'stages-inflight-item',
    who: 'panel',
    why: '在途需求一条（data-req-id 给稳定需求 ID）',
  }),
  inflightCurrent: Object.freeze({
    literal: 'stages-inflight-current',
    who: 'panel',
    why: '在途列表里“哪条需求被选中”；⚠ 不是阶段“当前”，⛔ 不得与 stages-current-step 混用',
  }),
  mainline: Object.freeze({
    literal: 'stages-mainline',
    who: 'panel',
    why: '选中需求的五步主线容器（data-req-id 给需求 ID）',
  }),
  tree: Object.freeze({
    literal: 'stages-tree',
    who: 'panel',
    why: '选中需求的五步树容器（⚠ 与 stages-mainline 是同一棵树的两层语义，⛔ 不是两份数据）',
  }),
  treeStep: Object.freeze({
    literal: 'stages-tree-step',
    who: 'panel',
    why: '五步之一（同一节点带 data-mainline-step=true）',
  }),
  treeHead: Object.freeze({
    literal: 'stages-tree-head',
    who: 'panel',
    why: '五步行头（序号 / 名称 / 状态 / N/M / 条数），点击展开条目',
  }),
  treeIcon: Object.freeze({
    literal: 'stages-tree-icon',
    who: 'panel',
    why: '五步状态的图标与中文（✓/▶/⟳/✗/○）',
  }),
  treeCount: Object.freeze({
    literal: 'stages-tree-count',
    who: 'panel',
    why: '五步的完成数/总数（⛔ 百分比）',
  }),
  treeItemCount: Object.freeze({
    literal: 'stages-tree-item-count',
    who: 'panel',
    why: '步头里的“N 条”，告诉用户点开能看到多少条目',
  }),
  treeBody: Object.freeze({
    literal: 'stages-tree-body',
    who: 'panel',
    why: '某一步的展开体（统一条目行 + 第 4 步的计划/运行态折叠）',
  }),
  currentStep: Object.freeze({
    literal: 'stages-current-step',
    who: 'panel',
    why: '唯一“当前”标记；同一时刻最多一个',
  }),
  currentGate: Object.freeze({
    literal: 'stages-current-gate',
    who: 'panel',
    why: '当前用户/阶段门禁卡片（G1/G2/G5/G6）；data-gate 与 data-next-actor 供按门检查',
  }),
  pipelineReadout: Object.freeze({
    literal: 'stages-pipeline-readout',
    who: 'panel',
    why: '选中需求的主 Pipeline 读数（当前阶段 / 下一步 / 闸门）；唯一当前阶段出口',
  }),
  riskReadout: Object.freeze({
    literal: 'stages-risk-readout',
    who: 'panel',
    why: '首屏风险摘要（固有风险 + 交付档位 + 硬触发）；不在展开体里',
  }),
  currentAcceptanceMaterials: Object.freeze({
    literal: 'stages-current-acceptance-materials',
    who: 'panel',
    why: '当前第 5 步的验收材料提醒：产品确认 / 技术证据 / 用户例子逐条结果必须在首屏点名，⛔ 不藏在条目展开体里',
  }),
  historySection: Object.freeze({
    literal: 'stages-history-section',
    who: 'panel',
    why: '底部历史折叠；默认收起，按需求链列出已完成条目',
  }),
  historyChain: Object.freeze({
    literal: 'stages-history-chain',
    who: 'panel',
    why: '历史里的一条需求链（data-req-id）；已完成与退役都按需求收口',
  }),
  historyStep: Object.freeze({
    literal: 'stages-history-step',
    who: 'panel',
    why: '历史需求链内的一步（data-step），用于展开该链条目',
  }),
  historyRetired: Object.freeze({
    literal: 'stages-history-retired',
    who: 'panel',
    why: '已退役需求的默认折叠组；只进历史，不进在途列表与主线',
  }),
  historyStage: Object.freeze({
    literal: 'stages-history-stage',
    who: 'none',
    retired: true,
    why: '旧四视图的“历史视图按第 4/5 步分折叠”已退场；历史改由 stages-history-section 按需求链承载',
  }),
  /**
   * ⚠ `stages-guide-entry` 已退场（2026-11-08）：覆盖组件只返回 `null/undefined`
   *   决定“隐藏/交回宿主 fallback”，胶囊本身由宿主 `EntryBox` 渲染。
   *   ⇒ 面板不再渲染这个 marker，判据也不再按它抓行。
   */
  guideEntry: Object.freeze({
    literal: 'stages-guide-entry',
    who: 'none',
    retired: true,
    why: '覆盖组件只做可见性判断；可点胶囊由宿主 EntryBox 渲染（无本插件 marker）',
  }),
})

/** 面板侧**必须**出现的 marker（`who === 'panel'` 且未退场）。 */
export const PANEL_REQUIRED = Object.freeze(
  Object.entries(PANEL_MARKERS).filter(([, v]) => v.who === 'panel' && v.retired !== true).map(([k, v]) => ({ key: k, literal: v.literal })),
)

/**
 * 判据侧**不许**再用来抓「非空注意力行」的 marker（⚠ 语义退场，见上）。
 * ⚠ 只针对"抓行"这一用途；判"非空时没有重复渲染"那个**反向断言**仍然需要它
 *   （`S-32a` 里 `length > 0 ⇒ 判红`，那是断言"它不该有"，⛔ 不是抓行）。
 */
/**
 * ⚠ R-020 收口后 `stages-attention-item` **重新可达**（注意力只在补充信息里逐行渲染），
 *   所以不再禁止判据用它抓行；列表为空表示当前没有"语义已退场"的 marker。
 *   保留这个常量与 R-C 规则，供将来真正退场的 marker 使用。
 */
export const CHECKER_FORBIDDEN_FOR_ROW_SELECT = Object.freeze([])

/**
 * **本契约的管辖面**（⚠ 判据侧只核这些前缀下的 marker，理由见 `checkMarkerContract` 的 R-B）。
 * ⚠ 这是**管辖边界**，不是白名单：前缀内的未登记名字照样红。
 */
export const CONTRACT_SCOPE_PREFIXES = Object.freeze([
  'stages-attention',  // 注意力块族（空态 / 判不出 / 已退场的 item）
  'stages-summary',    // 摘要卡族（R-018 第 1 条四要素）
  'stages-ledgers',    // 项目 / 账本选择器
  'stages-ledger',     // 单个账本条目
  'stages-inflight',   // 在途需求列表
  'stages-mainline',   // 单需求五步主线
  'stages-current',    // 唯一当前标记
  'stages-history',    // 底部历史
  'stages-guide',      // 侧边栏胶囊
])

/** 判据侧允许出现的全部 `stages-*` 字面量（⚠ 来自本表 + 本表之外的面板 marker 白名单）。 */
export const KNOWN_LITERALS = Object.freeze(PANEL_MARKERS_SAFE_LIST())

function PANEL_MARKERS_SAFE_LIST() {
  const out = new Set(Object.values(PANEL_MARKERS).map((v) => v.literal))
  /**
   * ⚠ **本表之外**、判据确实在用的 marker —— 逐条登记（⚠ 闭合枚举，加名字必须写理由）。
   *   它们不参加"面板必须渲染"的核对（有些是历史 DOM、有些是判据自己的夹具节点），
   *   但必须在这里登记，否则 `checkMarkerContract` 的判据侧规则会把它判成"发明了一个 marker"。
   */
  for (const extra of [
    'stages-panel', // 面板根容器
    'stages-view', // 视图容器（map / work / plans / history）
    'stages-view-switch', // 视图切换条
    'stages-view-tab', // 一个视图 tab
    'stages-tree', // 五步树容器
    'stages-tree-step', // 一个步
    'stages-tree-head', // 步头（序号 + 名 + 三态图标 + N/M）
    'stages-tree-body', // 步展开体
    'stages-tree-item', // 树内一个账本条目
    'stages-tree-item-status', // 条目的唯一状态标签
    'stages-tree-item-count', // 条目计数
    'stages-tree-history', // 历史档
    'stages-tree-count', // 历史档计数
    'stages-item-relation', // 条目的关系行
    'stages-item-title', // 条目主标题
    'stages-item-flags', // 条目旗标
    'stages-item-detail-state', // 条目详情的判不出兜底
    'stages-current', // Current 区块
    'stages-current-text', // Current 正文
    'stages-unseen', // 待确认工具区块
    'stages-exec-state', // 执行态读数容器
    'stages-exec-bucket', // 执行态分组
    'stages-exec-bucket-title', // 执行态分组标题
    'stages-exec-item', // 执行态一条
    'stages-next', // 下一步块
    'stages-next-reason', // 下一步的原因行
    'stages-state', // 面板整体状态
    // ⚠ 2026-11-08 用户裁定「点项目名就是账本切换」：这两组从「收起组」改成
    //   **平铺的分组标题**（仍是独立分组，三态不混；但 ⛔ 不再是 <details>）。
    'stages-ledgers-empty-group', // 空账本分组（state=empty · 平铺，⛔ 不折叠）
    'stages-ledgers-unreadable-group', // 读不了账本分组（state=unreadable · 平铺，⛔ 不折叠）
    'stages-ledgers-current-missing', // 当前工作区没有对应账本时的说明
    'stages-preset-blocked', // 非 Hob / 预设判不出时的唯一说明行
  ]) out.add(extra)
  return Object.freeze([...out].sort())
}

/**
 * **双向契约核对**（⚠ 纯函数：只读两段源码文本，⛔ 不碰 fs、⛔ 不改任何东西）。
 *
 * 规则（每条都会**点名**是哪个 marker，⛔ 不写"某处不一致"）：
 *  - **R-A（面板必须渲染）**：`who === 'panel'` 的每个 marker，面板源码里必须出现其字面量。
 *    红 ⇒ 面板把这个 marker 改了/删了（或本表过期）。
 *  - **R-B（判据不许发明）**：判据源码里每个 `stages-*` 字面量，必须落在 {@link KNOWN_LITERALS} 里。
 *    红 ⇒ 判据在用面板根本没渲染的 marker（本轮 `S-32a` 的原始病灶就是这个）。
 *  - **R-C（退场的 marker 不许被拿去抓行）**：{@link CHECKER_FORBIDDEN_FOR_ROW_SELECT} 里的 marker
 *    **不许**出现在"取行"位置（`querySelectorAll(...)` 且结果被当成行集合用）。
 *    ⚠ 本规则**只认一种形态**：`querySelectorAll('[data-dsh-hob="<退场 marker>"]')` 后面跟 `.map(`
 *      （= 正在遍历那些节点当行用）。`length > 0` / `length !== 0` 那种**反向断言不在此列**。
 *
 * @param {{ panelSrc: string, checkerSrc: string }} input
 * @returns {{ problems: string[], checked: { panelRequired: number, checkerLiterals: number } }}
 */
export function checkMarkerContract({ panelSrc, checkerSrc }) {
  const problems = []
  let panelRequired = 0
  let checkerLiterals = 0

  // ── R-A：面板侧必须真的渲染 ──
  for (const { key, literal } of PANEL_REQUIRED) {
    panelRequired += 1
    if (!panelSrc.includes(literal)) {
      problems.push(`R-A 面板缺 marker \`${literal}\`（清单键 \`${key}\`）⇒ 面板改了它，或在 \`PANEL_MARKERS\` 里登记错了`)
    }
  }

  // ── R-B：判据侧不许发明 marker ──
  /**
   * ⚠ **只认真正的选择器形态**：`[data-dsh-hob="<marker>"]`。
   *   改前试过用裸正则 `stages-[a-z-]*` 扫全文 —— **误报 43 条**：
   *   它把注释里的 `stages-panel-dom` / `stages-work`、夹具里的假属性、文件名都算成 marker。
   *   ⇒ 收窄成"属性选择器里出现的才算"。⚠ 这不是放宽：**真正拿去查 DOM 的只有这个形态**。
   *
   * ⚠⚠ **再收窄一层到本契约的管辖面**（`CONTRACT_SCOPE_PREFIXES`）。
   *   理由（实测）：判据文件里有大量**历史 / 夹具**属性选择器（`stages-row` / `stages-legend` /
   *   `stages-progress-row` 等），它们查的是**早已不存在的旧 DOM** 或**判据自己造的假节点** ——
   *   把它们也纳入 R-B ⇒ **37 条噪音红**，而本单 §三 明令 ⛔ 不许为了让判据变绿而放宽口径，
   *   同时也不该把**与本契约无关的历史面**绑进来（那会让本模块变成"整个判据文件的 marker 总账"，
   *   超出"注意力族 marker 契约"的边界，且每条都要写理由 —— 那是另一单的活）。
   *   ⇒ 管辖面 = 注意力族 + 摘要卡族（就是本契约真正在治、且 `PANEL_MARKERS` 登记过的那两族）。
   *   ⚠ 这两族里**仍然严格**：判据只要用了未登记的名字，照样红。
   */
  const seenInChecker = new Set(
    [...checkerSrc.matchAll(/\[data-dsh-hob=\\?["']([a-z][a-z0-9-]*)['"]/g)].map((m) => m[1]),
  )
  for (const lit of seenInChecker) {
    if (!CONTRACT_SCOPE_PREFIXES.some((p) => lit.startsWith(p))) continue
    checkerLiterals += 1
    if (!KNOWN_LITERALS.includes(lit)) {
      problems.push(`R-B 判据在用未登记的 marker \`${lit}\` ⇒ 面板没渲染它（或 \`KNOWN_LITERALS\` 该登记它并写理由）`)
    }
  }

  // ── R-C：退场 marker 不许被拿去抓行 ──
  for (const lit of CHECKER_FORBIDDEN_FOR_ROW_SELECT) {
    /**
     * ⚠⚠ **正则必须允许中间夹 `[...]` 展开**（2026-11-07 修正）。
     *
     * 旧写法要求 `querySelectorAll(...).map(` **紧邻**，而真实抓行几乎都用
     *   `[...document.querySelectorAll(...)].map(` —— 中间有 `[...` 前缀和 `)]` 后缀
     *   ⇒ 旧正则一处都匹配不到 ⇒ **R-C 恒不触发**（S-MKd 的负向对拍当场失效）。
     *   ⚠ 这是"判据自己写错了，所以看着像契约没牙"，不是契约概念有问题。
     */
    const rowUse = new RegExp(
      `querySelectorAll\\(\\s*['"]\\[data-dsh-hob="${lit}"\\]['"]\\s*\\)\\s*\\]?\\s*\\)?\\s*\\.?\\s*map\\(`,
      'g',
    )
    const hits = [...checkerSrc.matchAll(rowUse)]
    if (hits.length > 0) {
      problems.push(`R-C 判据仍在用**已退场的** marker \`${lit}\` **抓行**（${hits.length} 处 \`querySelectorAll(...).map(\`）⇒ 它在真实渲染里不可达，会假红；请改用 \`${PANEL_MARKERS.tree.literal}\``)
    }
  }

  return { problems, checked: { panelRequired, checkerLiterals } }
}
