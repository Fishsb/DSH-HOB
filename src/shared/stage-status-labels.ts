/**
 * **每个 kind 的「状态 → 中文」标签表**（2026-10-30 P21 · `TASK-P21.md` §一）。
 *
 * ── 它治的病（用户截图）──────────────────────────────────────────────
 *   面板上原先把**每个条目**的 `status` 都扔给 `EXEC_STATE_LABELS`（九态）查；
 *   查不到就印「判不出（原值 agreed / settled / built / unverified）」。
 *   ⚠ 但那四个值**都是各自 kind 的合法状态**（封闭集里就有）——
 *     ⛔ 不是"判不出"，是**没有中文标签**。那句话在骗人。
 *   ⇒ 现在按 **kind** 取标签：先看这个值在**该 kind 的封闭集**里吗？
 *     · 在 ⇒ 给中文（下表）；
 *     · 不在 ⇒ `判不出（原值 X）`（⚠ **兜底保留**，只是⛔ 不再当默认）。
 *
 * ── 状态集从哪来（⚠ 不凭印象，逐条给落点）──────────────────────────
 *   · `src/shared/stages-index.ts:26-33` 的 `STAGE_KIND_STATUSES`（**机读唯一源**）；
 *   · 它逐条对应 `<账本区>/ledger-next/PROJECT.md:22-27` 的「§2 状态集（封闭）」表，
 *     以及 `archive/2026-10-30-rearch-greenfield/DESIGN-V2.md:146-153` 的 §3.3 表。
 *   ⚠ 本文件**不另写一份状态集**：{@link stageStatusLabel} 每次现读
 *     `STAGE_KIND_STATUSES`（⛔ 抄第二份就会漂）。
 *
 * ── ⚠ 为什么 `run` 不在这里重写一份 ────────────────────────────────
 *   `run` 的五个状态（`registered` / `running` / `returned` / `refused` / `stuck`）
 *   **全部**在九态表 {@link EXEC_STATE_LABELS} 里，且措辞已被 E-9 钉住
 *   ⇒ 直接**转发**那张表（⛔ 在这里写第二份中文）。
 */
import { STAGE_KIND_STATUSES } from './stages-index.ts'
import { EXEC_STATE_LABELS } from './exec-protocol.ts'

/**
 * **非 `run` 各 kind 的中文标签**（`run` 转发九态表，见下）。
 *
 * ⚠ 措辞口径（`TASK-P21.md` §一-2）：**一句话、用户看得懂、⛔ 不照搬英文**。
 *   所以 `built` 不写"已构建"（那是给编译器看的词），写「已做完（待验收）」——
 *   它在这一步的**唯一含义**就是"实施侧交活了，等第 5 步验"。
 */
export const STAGE_STATUS_LABELS_ZH: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // ① 需求规格：还没定稿 / 已定稿 / 不做了
  req: {
    draft: '草稿（还没定稿）',
    agreed: '已定稿',
    dropped: '已放弃',
  },
  // ② 实现方案：在提 / 已定案 / 被后一版取代
  change: {
    proposed: '提议中（还没定案）',
    settled: '已定案',
    superseded: '已被新版取代',
  },
  // ③ 编码任务：没开工 / 在做 / 交活了
  task: {
    todo: '待开工',
    doing: '在做',
    built: '已做完（等验收）',
  },
  // ④ 任务执行：⚠ 转发九态表（见 stageStatusLabel），此处**不写**
  // ⑤ 验收核对：过了 / 退回 / 还没验
  acc: {
    pass: '验收通过',
    'send-back': '已退回',
    unverified: '还没验',
  },
  // — 长期能力：不是进度，是**当下健康度**（见 renderCapState 的说明）
  cap: {
    live: '正常',
    degraded: '降级',
    down: '不可用',
  },
  /**
   * ⚠⚠ **2026-10-31 P40/R2：三个受控对象**（`TASK-R2.md` §二）——————————————
   *   R-10 的护栏当场咬住了这处：新增 kind 而**不补标签** ⇒ 每个状态都判成
   *   「判不出（原值 open）」（实测原文：`R-10 · risk.open 判成「没有标签」（why=标签表缺 risk.open）`）。
   *   ⚠ 那是**护栏对的**，不是它多事 ——「判不出」正是在说"我方缺表"。
   *
   *   ⚠ 措辞口径照本文件第 31 行：**一句话、用户看得懂、⛔ 不照搬英文**。
   *   ⚠⚠ **这三类不是"完成度"**，措辞里⛔ 不许出现"完成 / 进度"字样
   *     （风险只有开/在处置/已处置，决策只有有效/已被取代，证据只有"记下了"）。
   */
  risk: {
    open: '开着（还没处置）',
    handling: '在处置',
    closed: '已处置',
  },
  decision: {
    active: '有效',
    superseded: '已被取代',
  },
  evidence: {
    recorded: '已记录读数',
  },
  /**
   * ⚠ **2026-11-02 P50/M10**：B 轨加 `goal` 时漏了本表 —— 而本文件的 R-10 护栏会**当场咬住**
   * （缺标签 ⇒ 每个状态都判成「判不出（原值 active）」）。
   *   值照 `STAGE_KIND_STATUSES.goal.statuses`：`active` / `done` / `retired`。
   *   ⚠ 措辞口径照本文件第 31 行：**一句话、用户看得懂、⛔ 不照搬英文**。
   *   ⚠ 与 `risk`/`decision`/`evidence` 那三类的口径**不同**：`goal` 是**目标**，
   *     它的终态是"做完了 / 撤了"，不是"处置完了 / 被取代"。
   */
  goal: {
    active: '在追（还没实现）',
    done: '已实现',
    retired: '已撤销（不再追）',
  },
}

/** 一个 kind 的合法状态集（⚠ 从 `STAGE_KIND_STATUSES` 现读，⛔ 不抄）。 */
export function statusesOfKind(kind: string): readonly string[] {
  return STAGE_KIND_STATUSES[kind]?.statuses ?? []
}

/**
 * 取某 kind 某状态的中文标签；**不在该 kind 封闭集里 ⇒ 判不出**。
 *
 * ⚠⚠ **兜底的语义边界**（`TASK-P21.md` §一-3）：
 *   · `status` **不在** `statusesOfKind(kind)` 里 ⇒ `{ label: '判不出（原值 X）', known: false }`
 *     —— 这才是真判不出（索引里出现了封闭集之外的值，说明有人写错了，⛔ 不许替它编中文）；
 *   · `status` 在集合里、但**标签表漏了** ⇒ 同样 `known: false`，但 `why` 写明
 *     「标签表缺这一条」—— ⚠ 这是**我方缺表**，不是索引错；
 *     `check:stages-route` 的 R-10 专门咬这一种（每个合法状态都必须有标签）。
 *
 * @param kind - `req` / `change` / `task` / `run` / `acc` / `cap`
 * @param status - 索引里的原值
 * @returns `{ label, known, why }`；`known=false` ⇒ 调用方应印 `label`（已含原值）
 */
export function stageStatusLabel(kind: string, status: string): { label: string; known: boolean; why: string } {
  const legal = statusesOfKind(kind)
  const raw = String(status ?? '')
  if (legal.length === 0) {
    // ⚠ 连这个 kind 都不认识 ⇒ 判不出（⛔ 不猜它是哪一步）
    return { label: `判不出（原值 ${raw}）`, known: false, why: `未知 kind "${kind}"` }
  }
  if (!legal.includes(raw)) {
    // ⚠ 索引里出现了封闭集之外的值 ⇒ 真判不出（⛔ 不许编中文）
    return { label: `判不出（原值 ${raw}）`, known: false, why: `"${raw}" 不在 ${kind} 的封闭状态集里` }
  }
  if (kind === 'run') {
    // ⚠ 转发九态表（`run` 的 5 个状态全在九态里；缺 ⇒ 同样降级为"判不出"）
    const hit = (EXEC_STATE_LABELS as Record<string, string>)[raw]
    if (hit !== undefined) return { label: hit, known: true, why: 'exec-state-labels' }
    return { label: `判不出（原值 ${raw}）`, known: false, why: `run 的九态表里没有 "${raw}"` }
  }
  const table = STAGE_STATUS_LABELS_ZH[kind] ?? {}
  const hit = table[raw]
  if (hit !== undefined) return { label: hit, known: true, why: 'kind-table' }
  // ⚠ 合法但缺标签 ⇒ 我方缺表（R-10 咬这一种）
  return { label: `判不出（原值 ${raw}）`, known: false, why: `标签表缺 ${kind}.${raw}` }
}
