/**
 * **账本健康的唯一判据**（B1.3 / T-02 / T-05）。
 *
 * ── 它治的缺陷 ──────────────────────────────────────────────────────────────
 *   改前「这本账健不健康」有 **4 套互不承认的实现**，对同一夹具给出相反结论
 *  （实测「只含一条 L-2 闭环缺口」的账本）：
 *
 *     | 出口 | 用的判据集 | 结论 |
 *     |---|---|---|
 *     | \`ledgerReadinessOfRoot\` | shape + field + closure | unhealthy / 1 |
 *     | \`stageGateOfLedger\` | field + approval | **放行** |
 *     | \`stageHealthOfLedger\` | 走 project 作用域 ⇒ 无 closure | {ok:true, blockers:[]} |
 *     | \`/stages.stageHealth\` | field + approval + closure | {ok:false, count:1} |
 *
 *   ⇒ 面板说「1 条缺口」、写前门禁说「没问题」、\`repairOf\` 的依据说「健康」，
 *     用户永远不知道该信哪个；而 \`gateIntent=repair\` 的死锁就是这套分裂的直接后果。
 *
 * ── ⚠ 关键设计：**一份判据，两个投影** —— ⛔ 不是「强制所有人用同一个结论」──────
 *   四个出口的**用途不同**，硬合成一个布尔会造出新的错误：
 *
 *     · **结构层**（\`structuralProblems\` = shape + field + closure）
 *       = 「这本账的内容是否自洽到可以读 / 可以推进」。**这是所有人共用的那一份**。
 *     · **推进层**（\`problems\` = 结构层 + approval）
 *       = 「能不能真的往下走」。
 *
 *   ⚠ **为什么 readiness 只看结构层**：\`draft\` / \`proposed\` 是**合法草稿**，
 *     用户还没批准**不是账本坏了**。把 approval 并进 readiness 会让「刚写下的需求」
 *     立刻把整本账判成 unhealthy ⇒ **第一次建账就红**，那正是改前 readiness 注释
 *     明确要避免的形态（见 \`ledger-readiness.ts\` 里那段 "Unapproved content is a valid draft"）。
 *   ⚠ **为什么 gate 两层都看**：推进动作必须过用户闸门（G1/G2 的批准是硬要求）。
 *
 *   ⇒ 于是「四出口同结论」的准确含义是：**对同一个问题集，四处报的条数与内容一致**；
 *     它们各自的**结论位**（\`canProceed\` vs \`structurallyReady\`）**按用途取不同投影**。
 *     ⛔ 这不是又一套判据：问题集只有一处产生（本文件）。
 *
 * ── ⚠ 纯函数硬约束（构建级，不是风格）────────────────────────────────────────
 *   \`stages-index.ts\` 的**传递闭包在 client 产物里**
 *   （\`client/project-panel.tsx\` → \`stage-status-labels.ts:25\` 值导入 \`STAGE_KIND_STATUSES\`
 *   → \`stages-index.ts\`）。而 \`stages-index\` 会 import 本文件
 *   ⇒ ⛔ **本文件不许 import \`node:fs\` / \`src/server/**\` / 任何 I/O**
 *   否则浏览器包会打进只能用 Node 的模块，**构建即失败**。
 */
import { unitShapeProblems } from './ledger-validation.ts'
import {
  ledgerClosureProblems,
  stageApprovalProblems,
  stageFieldProblems,
  type StageControlProblem,
  type StageControlUnit,
} from './stage-controls.ts'

/**
 * 一条账本健康问题（在 {@link StageControlProblem} 上多一个**分层标记**）。
 *
 * ⚠ 分层不是为了「分类好看」：它决定了这条问题**属不属于结构层**
 *   （= 是否影响 \`structurallyReady\`）。⛔ 别把 approval 层的问题标成结构层，
 *   那会让草稿期直接判 unhealthy。
 */
export interface LedgerHealthProblem extends StageControlProblem {
  /** 问题来源层。 */
  layer: 'shape' | 'field' | 'closure' | 'approval'
}

/** 账本健康读数（**一份问题集 + 两个投影**）。 */
export interface LedgerHealth {
  /** 全量问题（结构层 + approval），按层排序。 */
  problems: LedgerHealthProblem[]
  /**
   * 结构层问题（shape + field + closure）。
   * ⚠ 这是四个出口**共同**看的那一份；\`readiness\` 直接用它。
   */
  structuralProblems: LedgerHealthProblem[]
  /** 四类缺口各自的条数（面板按类分组用；⛔ 不让人再各算一遍）。 */
  bySource: { shape: number; field: number; approval: number; closure: number }
  /** 结构层是否干净（= 「这本账内容自洽，可以推进」）。 */
  structurallyReady: boolean
  /** 推进层是否干净（= 结构层干净 **且** 用户批准齐备）。 */
  canProceed: boolean
}

/**
 * 把一条 {@link StageControlProblem} 标上层。
 *
 * ⚠ 只是**加字段**，⛔ 不改 \`rule\` / \`unit\` / \`why\` 一个字节 ——
 *   四条出口的文案与既有断言全部依赖那三个字段的原文（改一个字就会红）。
 */
function tag(p: StageControlProblem, layer: LedgerHealthProblem['layer']): LedgerHealthProblem {
  return { rule: p.rule, unit: p.unit, why: p.why, layer }
}

/**
 * **算一本账的健康**（唯一入口）。
 *
 * @param units - 全账本单元（调用方负责读盘；⚠ 本函数**不读盘**）。
 * @returns 一份问题集 + 两个投影。
 *
 * ⚠ 调用方若需要**历史豁免**口径（\`clarify_legacy\`），必须在**外面**套
 *   \`withProvenanceResolver(...)\` 或 \`withLedgerProvenance(...)\` ——
 *   本函数是纯函数，不认识「哪个账本根」，也知道不了 provenance。
 *   （这是**有意**的：账本根是 I/O 事实，纯函数层不许碰。）
 */
export function ledgerHealthOf(units: readonly StageControlUnit[]): LedgerHealth {
  /**
   * ⚠ **shape 必须在最前**：\`status="settled"\` 这种「越过封闭集」的行，
   *   后面的 field / closure 判据大多会**因为读不到合法 status 而放行**
   *   ⇒ 不先跑 shape 就会出现「坏行一本账判健康」（\`ledger-readiness\` 已实测过这一族）。
   */
  /**
   * ⚠ **必须传 seenIds**：改前 `ledger-readiness.ts` 漏传，导致同一单元同时出现在
   *   `index.toml` 与分片时 readiness 报「无缺口」（附录 A-3 / LH-3）。
   *   合并后的账本里出现重复 ID **是账本坏了**，四个出口必须一致地报出来。
   */
  const seenIds = new Set<string>()
  const shape = units
    .flatMap((u) => unitShapeProblems(u as unknown as Record<string, unknown>, seenIds))
    .map((why) => {
      /**
       * ⚠ \`unitShapeProblems\` 返回的是**一句话**（不是结构体），既有口径要从里面
       *   把 id 抠出来。正则取自 \`ledger-readiness.ts\` 的同一段（⛔ 不新造一种抠法）。
       */
      const m = /^(.+?): kind=.*kind=([^\s（]+)/.exec(why)
        ?? /^(.+?): status=.*不属于 kind=([^\s（]+)/.exec(why)
      return {
        rule: 'S-0',
        unit: m?.[1] ?? '(unit)',
        why,
        layer: 'shape' as const,
      }
    })

  const structural: LedgerHealthProblem[] = [
    ...shape,
    ...stageFieldProblems(units).map((p) => tag(p, 'field')),
    ...ledgerClosureProblems(units).map((p) => tag(p, 'closure')),
  ]
  const approval = stageApprovalProblems(units).map((p) => tag(p, 'approval'))

  const countOf = (layer: LedgerHealthProblem['layer']): number => {
    const structuralPart = structural.filter((p) => p.layer === layer).length
    return layer === 'approval' ? approval.length : structuralPart
  }

  return {
    problems: [...structural, ...approval],
    structuralProblems: structural,
    bySource: {
      shape: countOf('shape'),
      field: countOf('field'),
      approval: countOf('approval'),
      closure: countOf('closure'),
    },
    structurallyReady: structural.length === 0,
    canProceed: structural.length === 0 && approval.length === 0,
  }
}

/**
 * 把健康读数渲染成**一句可直接进拒绝话术**的清单（前 N 条 + 总数）。
 *
 * ⚠ 四个出口共用本函数 ⇒ 同一条缺口在面板、门禁、状态行里**措辞一致**
 *   （改前它们各自拼话术，同一条缺口有四种说法）。
 */
export function describeLedgerHealth(
  problems: readonly LedgerHealthProblem[],
  limit = 5,
): string {
  if (problems.length === 0) return ''
  const first = problems.slice(0, limit).map((p) => `${p.rule} · ${p.unit} · ${p.why}`).join('；')
  return problems.length <= limit
    ? first
    : `${first}；…（另有 ${problems.length - limit} 条）`
}
