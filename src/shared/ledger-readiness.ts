/**
 * **账本就绪度（LedgerReadiness）· 纯函数，零 I/O**（2026-11-08 · 用户裁定）。
 *
 * ══ 它回答什么问题 ═══════════════════════════════════════════════════════════
 *   「这本账现在能不能用来推进任务？」
 *
 *   用户原话（2026-11-08）：
 *     「没有账本的项目必须先建立账本才能推进任务」
 *     「不管是旧的还是空的 hob 会话在工作之前必须把账本建立梳理健康才能推进任务」
 *
 * ══ 为什么它必须是一个**独立可判的档**（⛔ 不是"读不到 = 缺口"）══════════════
 *   改前只有两种读数：能算出来 / 算不出来。于是三种**完全不同**的情形被混成一句：
 *     · 这个工作区**从来没开过账**（该去建）
 *     · 账本**在，但是旧格式**（该去迁移）
 *     · 账本**在、格式对，但里面还是空的**（该去补第一条需求）
 *   ⚠ 它们各自的**下一步动作不同**，给同一句话等于让人猜。⇒ 这里分成五档。
 *
 * ══ 五档（封闭集）═══════════════════════════════════════════════════════════
 *   `unresolved`  工作区根 / 账本根判不出 ⇒ 连"该去哪儿建"都不知道
 *   `missing`     账本目录在，但没有 `ledger/units/`（含：目录整个不存在）
 *   `legacy`      有 `ledger/units/`，但索引是**旧格式**（`[units."ID"]` 表头）
 *   `empty`       格式合规，但**一条单元都没有**
 *   `unhealthy`   有单元，但结构 / 字段 / 闭环存在缺口
 *   `ready`       有单元、结构 / 字段 / 闭环无缺口 ⇒ 可以进入管线处理；
 *                 G1/G2 是否已批准属于当前阶段与派发门禁，不在这里冒充结构缺口
 *
 * ⚠ 「空」与「旧格式」与「没开账」**必须分开**：这与 `R-4`（空 ≠ 判不出）同一条纪律。
 * ⚠ 本模块**不做任何 fs 操作**：调用方把"读到什么"传进来，这里只做判定。
 *   这样面板、派活门禁、机检三处能对**同一份输入**得出**同一个**结论。
 */

import { parseUnitsToml } from './stages-index.ts'
import { ledgerHealthOf } from './ledger-health.ts'
import type { StageControlUnit } from './stage-controls.ts'

/** 就绪度五档 + 一档"能建"（`unresolved` 不可建，其余四档都有明确动作）。 */
export type LedgerReadinessState =
  | 'unresolved'
  | 'missing'
  | 'legacy'
  | 'empty'
  | 'unhealthy'
  | 'ready'

/** 一个缺口（与阶段控制问题同形，但只在这里暴露"给用户看"的最小面）。 */
export interface ReadinessGap {
  /** 规则号（如 `C-3`）。 */
  rule: string
  /** 出问题的单元 id。 */
  unit: string
  /** 一句人读原因。 */
  why: string
}

export interface LedgerReadiness {
  state: LedgerReadinessState
  /** 一句话人读结论（⛔ 不含路径：路径另有字段）。 */
  headline: string
  /** 下一步该做什么（一句祈使句）。⚠ `ready` 时为空串。 */
  nextAction: string
  /**
   * 该账本**结构上**是否自洽（shape + field + closure 全空）。
   *
   * ⚠ 与 {@link canProceed} 的分工（D-T02-1 选项 C）：
   *   · 本字段 = 「内容自洽、可以读写」；`draft` / `proposed` 是合法草稿，未批准**不是**账本坏了；
   *   · `canProceed` = 本字段 ∧ 用户批准齐备（G1/G2）。
   *   ⛔ 不要把 approval 并进本字段：那会让「刚写下的需求」在第一次建账时就判 unhealthy。
   */
  structurallyReady: boolean
  /**
   * 该账本能不能用来**推进**（派活 / 写推进）。
   *
   * ⚠ 与 `state === 'ready'` 的差别：`ready` 只说明结构自洽；
   *   有单元但**用户尚未批准**时，`ready` 为真而本字段为假（D-T02-1 选项 C）。
   */
  canProceed: boolean
  /** 能不能**现在**建 / 修（`unresolved` 时为 false —— 连落点都判不出）。 */
  canInitialize: boolean
  /** 单元数（`missing` / `legacy` 时为 0 —— ⛔ 不是"读了 0 条"）。 */
  unitCount: number
  /** 缺口（仅 `unhealthy` 非空；⚠ 最多 20 条，全量在账本里）。 */
  gaps: ReadinessGap[]
  /** 缺口总数（可能 > `gaps.length`）。 */
  gapCount: number
  /** 机器可读的原因码（给日志 / 判据用；⛔ 不进用户文案）。 */
  reason?: string
  /** 判不出 / 读不到时的详细原因（⚠ 可含路径，供诊断）。 */
  detail?: string
}

/**
 * 建账本要铺的东西（**声明式清单**，⛔ 不是一堆散落在代码里的字符串）。
 *
 * ⚠ 与 `kit/INIT.md` §3 同源：这里只列**最小可推进集**，五份正本里的
 *   `USER-DECISIONS.md` 是新项目的**历史档**、`LEDGER-RULES` 是规则卷 ——
 *   ⚠ 它们**不阻塞推进**（缺了也能跑），故不放进 `required`。
 *   ⛔ 别把"骨架要求的全部"当成"推进要求的最小集"：那会让新项目开账变成填表。
 */
export const INIT_REQUIRED_FILES = [
  'ledger/units/index.toml',
  'PROJECT.md',
] as const

/** 建议（不阻塞推进）铺的文件。 */
export const INIT_OPTIONAL_FILES = [
  'CONTEXT.md',
  'DECISIONS.md',
  'REQUIREMENTS.md',
  'volumes/context/LEDGER-RULES.md',
] as const

/**
 * 判定"索引文本是不是旧格式"。
 *
 * ⚠ 旧格式 = `[units."ID"]` 表头（`[meta]` 也属于这一代）。
 *   现行格式 = 只有 `[[unit]]`（由 `parseUnitsToml` 唯一支持）。
 * ⚠ 这里**不抛错**：它是"分类"，抛错会让调用方只能拿到一个异常。
 */
export function looksLikeLegacyIndex(text: string): boolean {
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    if (line === '[[unit]]') continue
    if (/^\[/.test(line)) return true
  }
  return false
}

/** 读到的原始素材（⚠ 由调用方注入；本模块零 I/O）。 */
export interface LedgerProbe {
  /** 账本根；`undefined` = 判不出。 */
  ledgerRoot?: string
  /** `ledger/units/` 是否存在。 */
  unitsDirExists: boolean
  /** `ledger/units/index.toml` 的全文；`undefined` = 文件不存在。 */
  indexText?: string
  /** 分片全文（按文件名序）。⚠ 只在 `unitsDirExists` 时有意义。 */
  shardTexts?: readonly string[]
  /** 读失败时的原因（⚠ 与"不存在"分开）。 */
  readError?: string
  /** 账本根判不出的原因。 */
  rootWhy?: string
}

/** 把缺口裁剪成给用户看的最小集（⚠ 总数照实给）。 */
function toGaps(problems: ReadonlyArray<{ rule: string; unit: string; why: string }>): { gaps: ReadinessGap[]; gapCount: number } {
  const gapCount = problems.length
  const gaps = problems.slice(0, 20).map((p) => ({ rule: String(p.rule), unit: String(p.unit), why: String(p.why) }))
  return { gaps, gapCount }
}

/**
 * **判定就绪度**（唯一入口）。
 *
 * ⚠ 顺序即优先级，⛔ 不许重排：
 *   ① 账本根判不出 ⇒ `unresolved`（连落点都没有，**不可建**）
 *   ② `ledger/units/` 不在 ⇒ `missing`（**可建**）
 *   ③ 索引读不到 / 读出错 ⇒ `unhealthy`（**在，但坏了**；⛔ 不当 missing，那会让人重建覆盖掉）
 *   ④ 旧格式 ⇒ `legacy`（**可迁移**）
 *   ⑤ 格式对但 0 条 ⇒ `empty`（**可补第一条**）
 *   ⑥ 有单元 ⇒ 数缺口：0 ⇒ `ready`，否则 `unhealthy`
 */
export function assessLedgerReadiness(probe: LedgerProbe): LedgerReadiness {
  // ① 落点判不出
  if (probe.ledgerRoot === undefined || probe.ledgerRoot.trim() === '') {
    return {
      state: 'unresolved',
      headline: '账本落点判不出 ⇒ 不知道该在哪儿建',
      nextAction: '先确认会话的工作区根，再重试。',
      canProceed: false,
      structurallyReady: false,
      canInitialize: false,
      unitCount: 0,
      gaps: [],
      gapCount: 0,
      reason: 'no-ledger-root',
      ...(probe.rootWhy === undefined ? {} : { detail: probe.rootWhy }),
    }
  }

  // ② 没开过账
  if (!probe.unitsDirExists) {
    return {
      state: 'missing',
      headline: '这个项目还没有账本',
      nextAction: '先建账本（`hob_ledger_init`），再推进任务。',
      canProceed: false,
      structurallyReady: false,
      canInitialize: true,
      unitCount: 0,
      gaps: [],
      gapCount: 0,
      reason: 'units-dir-missing',
      detail: probe.ledgerRoot,
    }
  }

  // ③ 壳在、读不出来
  if (probe.readError !== undefined) {
    return {
      state: 'unhealthy',
      headline: '账本读不出来',
      nextAction: '先修好读权限或文件，再推进任务。',
      canProceed: false,
      structurallyReady: false,
      canInitialize: false,
      unitCount: 0,
      gaps: [],
      gapCount: 0,
      reason: 'read-error',
      detail: probe.readError,
    }
  }
  if (probe.indexText === undefined) {
    return {
      state: 'unhealthy',
      headline: '账本缺入口索引',
      nextAction: '补 `ledger/units/index.toml`（`hob_ledger_init` 会补齐缺失件）。',
      canProceed: false,
      structurallyReady: false,
      canInitialize: true,
      unitCount: 0,
      gaps: [],
      gapCount: 0,
      reason: 'index-missing',
      detail: probe.ledgerRoot,
    }
  }

  // ④ 旧格式
  if (looksLikeLegacyIndex(probe.indexText)) {
    return {
      state: 'legacy',
      headline: '账本是旧格式，现行面板读不进来',
      nextAction: '先迁移成现行 `[[unit]]` 格式（`hob_ledger_init` 会给出迁移清单）。',
      canProceed: false,
      structurallyReady: false,
      canInitialize: true,
      unitCount: 0,
      gaps: [],
      gapCount: 0,
      reason: 'legacy-index-format',
      detail: probe.ledgerRoot,
    }
  }

  // ⑤ / ⑥ 解析现行格式
  let units: Array<Record<string, string | string[]>>
  try {
    units = parseUnitsToml([probe.indexText, ...(probe.shardTexts ?? [])].join('\n'))
  } catch (e) {
    return {
      state: 'unhealthy',
      headline: '账本索引不是合法格式',
      nextAction: '按报错行修索引（`hob_ledger_init` 会指出是哪一行）。',
      canProceed: false,
      structurallyReady: false,
      canInitialize: true,
      unitCount: 0,
      gaps: [],
      gapCount: 0,
      reason: 'index-malformed',
      detail: String((e as Error)?.message ?? e),
    }
  }

  if (units.length === 0) {
    return {
      state: 'empty',
      headline: '账本已建，但还没有任何单元',
      nextAction: '先落第一条需求（R-xxx），再推进任务。',
      canProceed: false,
      structurallyReady: false,
      canInitialize: true,
      unitCount: 0,
      gaps: [],
      gapCount: 0,
      reason: 'no-units',
      detail: probe.ledgerRoot,
    }
  }

  // ⑥ 有单元 ⇒ 数缺口（⚠ 与派活门禁同一个纯函数，⛔ 不另判一份）
  /**
   * 四类缺口的**并集**（shape + field + approval + closure）。
   * ⚠ 与 `gaps` / `gapCount` 同源：四个出口必须报**同一份**清单（§3.3.3）。
   */
  let problems: Array<{ rule: string; unit: string; why: string }>
  /** 推进层是否干净（结构 + 用户批准）；异常分支由下面各自显式给 false。 */
  let canProceed = true
  /** 结构层是否干净（shape + field + closure）。 */
  let structurallyReady = false
  try {
    /**
     * ⚠⚠ **2026-11-08 加第二道：闭环**（用户报「旧账本梳理不到完全健康」）。
     *
     *   `stageFieldProblems` 是**逐条单元的字段门禁**，它回答"这一条填全了没有"。
     *   ⇒ 一本账里**只有一条 `change`**（没有 req / task / run / acc）也判"无缺口"，
     *     于是面板与派活都说"完全健康"。实测：`prompt-enhancer-release` 只有 `CHG-344`
     *     ⇒ `problems = []` ⇒ ready（这是**假的健康**）。
     *   ⇒ 再加 `ledgerClosureProblems`：引用必须指向**真实存在**的上游
     *     （change→req / task→change / run→task / acc→task）。
     */
    /**
     * ⚠ **结构合法性先于字段完整性**（2026-11-08 真账本实测）：
     *   一本账里出现 `task.status = settled` 时，
     *     · 阶段接口整本返回 `row-shape-unknown`；
     *     · 就绪度只跑字段门禁，却可能说「健康」。
     *   ⇒ 两种读数来自同一条坏行，却给用户相反结论。
     *   现在先把 `unitShapeProblems` 并进同一份问题集，健康面板、派活门禁、
     *   阶段接口对这本账给出同一个「坏在哪一行」的结论。
     */
    /**
     * ⚠ **B1.3（T-02）：判据集改由 `ledgerHealthOf` 一处产生**（⛔ 不在这里再拼一份）。
     *
     * ── 为什么 readiness 只取 `structuralProblems`（不含 approval）──────────
     *   Readiness asks whether the ledger can advance. Unapproved content is a
     *   valid draft, so user approval is checked by the progression gate rather
     *   than reported as structural corruption here.
     *   ⚠ 若把 approval 并进来，「刚写下的需求」会立刻把整本账判 unhealthy
     *     ⇒ **第一次建账就红**，那正是改前这条注释要避免的形态。
     *
     * ── 与改前的**唯一差异**（有意，且是修缺陷）────────────────────────────
     *   shape 问题的 `why` 不再追加「⇒ 先按封闭状态表改正这一行，再推进」那句后缀。
     *   理由：四个出口共用同一份 `why`（`ledgerHealthOf`），若 readiness 单独加后缀，
     *   同一条坏行在面板与门禁里就是**两种说法** —— 那正是本批要消灭的形态。
     *   ⚠ 若将来有断言依赖那句后缀，应改成断言「`rule`=`S-0` 且 `why` 含原文」，
     *     ⛔ 不要去改回去让四个出口重新分叉。
     */
    const health = ledgerHealthOf(units as unknown as StageControlUnit[])
    /**
     * ⚠ **取并集，不取结构层**（§3.3.3）：`gaps` / `gapCount` 是四个出口对外的那份清单，
     *   少报 approval 就会让「只有审批缺口」的账本在 readiness 上显示 0 条
     *   （附录 A-8 的 F4，改前实测）。
     */
    problems = health.problems as unknown as typeof problems
    /**
     * ⚠ 两个投影都要给（D-T02-1 选项 C）：
     *   · `structurallyReady` = 结构层干净 ⇒ 账本内容可用（建账 / 生命周期判有效）；
     *   · `canProceed` = 推进层干净（结构 **且** 用户批准）⇒ 能派活 / 能推进。
     *   ⛔ 两者不许合并成一个布尔：那正是 T-02 的形态。
     */
    structurallyReady = health.structurallyReady
    canProceed = health.canProceed
  } catch (e) {
    return {
      state: 'unhealthy',
      headline: '账本单元判不出健康度',
      nextAction: '先修单元格式，再推进任务。',
      canProceed: false,
      structurallyReady: false,
      canInitialize: true,
      unitCount: units.length,
      gaps: [],
      gapCount: 0,
      reason: 'health-undecidable',
      detail: String((e as Error)?.message ?? e),
    }
  }
  const { gaps, gapCount } = toGaps(problems)
  if (gapCount > 0) {
    /**
     * ⚠ **结构干净、只缺批准**时，文案必须说清"内容没问题、差的是批准"，
     *   否则用户会以为账本坏了去重建（A-8 的 F4 误读形态）。
     */
    const approvalOnly = structurallyReady
    return {
      state: 'unhealthy',
      headline: approvalOnly
        ? `账本内容已就绪，但有 ${gapCount} 条缺口待处理`
        : `账本有 ${gapCount} 条缺口`,
      nextAction: approvalOnly
        ? '内容自洽，缺的是用户对当前修订的批准（G1/G2）⇒ 先取得批准，再派活 / 推进。'
        : '先补齐缺口（逐条见 gaps），再推进任务。',
      canProceed: false,
      structurallyReady,
      canInitialize: true,
      unitCount: units.length,
      gaps,
      gapCount,
      reason: 'stage-control-gaps',
      detail: probe.ledgerRoot,
    }
  }
  /**
   * ⚠ **结构干净 ≠ 可以推进**（D-T02-1 选项 C）。
   *
   * 实测分歧格 F4：一条 v3 需求内容齐全但**用户还没批准**时，
   *   · 改前 readiness 报 `ready`，而 `stageGateOfLedger` / `stageHealth` / `/stages`
   *     三处都报 BLOCK（C-18）⇒ `hob_ledger_init` 会说"不需要建账本"，
   *     用户于是以为这本账能推，一派活就被拒。
   *   · 现在：`state` / `structurallyReady` 仍说结构自洽（草稿是合法状态），
   *     但 `canProceed` 按**同一份判据**取推进层（含 approval）⇒ 与另三处同结论。
   *
   * ⚠ 这里必须用**同一个** `health`（不是再跑一遍判据）：否则又是两份实现。
   */
  return {
    state: 'ready',
    headline: `账本就绪（${units.length} 条单元，无缺口）`,
    nextAction: '',
    canProceed,
    structurallyReady,
    canInitialize: false,
    unitCount: units.length,
    gaps: [],
    gapCount: 0,
    detail: probe.ledgerRoot,
  }
}

/** 一行人读摘要（面板 / 工具返回值共用；⛔ 三处各写一份文案会漂）。 */
export function readinessLineOf(r: LedgerReadiness): string {
  if (r.state === 'ready') return r.headline
  const tail = r.gapCount > 0 ? `（${r.gapCount} 条）` : ''
  return `${r.headline}${tail} —— 下一步：${r.nextAction}`
}

/**
 * **新建账本时要写的入口索引**（纯函数：不给 fs、不给时间源以外的输入）。
 *
 * ⚠ 内容刻意**极小**：只放 `[meta]` 之外的说明注释 + 零条单元。
 *   ⛔ 不预置任何 `[[unit]]` 夹具 —— 那会让"新账本"看起来"已经有需求了"，
 *     而实际上一件事都还没做（这正是"空 ≠ 有内容"的另一种假读数）。
 * ⚠ 现行格式 = 只有 `[[unit]]` 一种表头（见 `parseUnitsToml`）；
 *   这里连 `[meta]` 都不写，因为解析器**不认**它（旧格式才有）。
 */
export function initialIndexToml(nowIso: string): string {
  return [
    '# 账本单元索引 —— 唯一机读状态源（每条 `[[unit]]` 一条单元）',
    '#',
    '# ⚠ 本文件由 `hob_ledger_init` 创建；⚠ 手改可，但必须保持「受限 TOML 子集」：',
    '#   · 只允许 `[[unit]]` 表头、`key = "字符串"`、`key = ["数组"]`、注释与空行；',
    '#   · ⛔ 不许出现 `[meta]` / `[units."ID"]` 这类其它表头（那是旧格式，现行解析器会拒）。',
    '#',
    '# ⚠ 新建账本时这里**故意是空的**：一条需求都还没落，⛔ 不许塞夹具冒充已有内容。',
    '#   第一条需求落进来之后，面板才会显示「在途需求」。',
    `# created_at = "${nowIso}"`,
    '',
  ].join('\n')
}

/**
 * **最小正本**（`PROJECT.md` / `CONSTITUTION.md`）—— 建账时一并落盘。
 *
 * ⚠ 二者是"推进所需的最小集"（见 {@link INIT_REQUIRED_FILES}）：
 *   `PROJECT.md` 回答"这个项目是什么"，`CONSTITUTION.md` 回答"本账本的硬规矩"。
 * ⛔ 这里只写**结构骨架 + 待填标记**，不许编造项目内容 —— 内容由 Hob 按真实需求填。
 */
export function initialProjectMd(workspaceName: string): string {
  return [
    `# ${workspaceName} · 项目定位`,
    '',
    '> ⚠ 本文件由 `hob_ledger_init` 起手，**尚未填写项目内容**。',
    '> 填写方式：只写"现在是什么样"，⛔ 不写编年流水（历史进 `archive/`）。',
    '',
    '## 一、这个项目是什么',
    '',
    '（待填：一句话定位 + 服务谁 + 边界在哪）',
    '',
    '## 二、当前范围',
    '',
    '（待填：这一轮要做成什么、明确不做什么）',
    '',
    '## 三、约束与依据',
    '',
    '（待填：硬约束、外部依赖、不能动的东西）',
    '',
  ].join('\n')
}

/**
 * ⚠⚠ **不提供 `CONSTITUTION.md` 的生成器**（2026-11-08 核实后的删减）。
 *
 *   `server/hob-write.ts` 的写入面白名单是 `LEDGER_FILES` = PROJECT / REQUIREMENTS /
 *   DECISIONS / CONTEXT 四份；`ledger/CONSTITUTION.md` **不在任何白名单里**
 *   （注释原文：「红线与地图走人工编辑 + commit」）。
 *   ⇒ 建账工具**不许**绕过这层守卫自己拼路径落盘（那等于在守卫旁边开一个后门）。
 *   需要宪法时：由人按 `kit/templates/` 起手并 commit。⛔ 不在这里造第二套写面。
 */
/**
 * **从"已读好的素材"判定**（服务端用；⚠ 本函数仍然只做判定，不读盘）。
 *
 * ⚠ 与 {@link assessLedgerReadiness} 的分工：那个吃 `LedgerProbe`（原始素材），
 *   这个吃"已经把 `ledger/units/` 列出来"的结果 —— 服务端只需要一次 `readdirSync`。
 */
export function probeFromDirListing(input: {
  ledgerRoot?: string
  rootWhy?: string
  listUnitsDir: () => string[]
  readText: (abs: string) => string | undefined
}): LedgerProbe {
  const root = input.ledgerRoot
  if (root === undefined || root.trim() === '') {
    return { unitsDirExists: false, ...(input.rootWhy === undefined ? {} : { rootWhy: input.rootWhy }) }
  }
  const unitsDir = `${root.replace(/[\\/]+$/, '')}/ledger/units`
  let names: string[]
  try {
    names = input.listUnitsDir()
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code
    /**
     * ⚠ `ENOENT` = **没有这个目录**（没开过账）⇒ `missing`；
     *   其余（`EACCES` / `EIO`…）= **有但读不了** ⇒ `unhealthy`。
     *   ⛔ 不许把两者合成 `missing`：那会让"权限坏了"被当成"没建"，然后被重建覆盖。
     */
    if (code === 'ENOENT') return { ledgerRoot: root, unitsDirExists: false }
    return { ledgerRoot: root, unitsDirExists: true, readError: `${unitsDir}：${String((e as Error)?.message ?? e)}` }
  }
  const shardNames = names.filter((n) => /^unit-[^/]+\.toml$/.test(n)).sort()
  const indexPath = `${unitsDir}/index.toml`
  const indexText = input.readText(indexPath)
  const shardTexts: string[] = []
  for (const n of shardNames) {
    const t = input.readText(`${unitsDir}/${n}`)
    if (t === undefined) {
      return { ledgerRoot: root, unitsDirExists: true, indexText, readError: `分片不存在：${unitsDir}/${n}` }
    }
    shardTexts.push(t)
  }
  return { ledgerRoot: root, unitsDirExists: true, ...(indexText === undefined ? {} : { indexText }), shardTexts }
}
