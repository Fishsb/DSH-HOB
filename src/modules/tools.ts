/**
 * M1 · 工具模块（Host 半边）—— 本插件**两个工具的唯一实现点**。
 *
 * ── 本模块"提供工具"的确切含义（**一个实测出来的架构约束**）──────────────
 *
 * ⚠ **本模块【不在插件作用域】注册这两个工具** —— 这是量出来的，不是偏好。
 *
 * 实测（2026-10-05，隔离实例，探针 dump 各预设的工具面）：
 * 在插件作用域注册一个工具，它会**漏进每一个预设**：
 *
 * | 预设 | 注册前 | 注册后 |
 * |---|---|---|
 * | `minimal` | 5 | **6** |
 * | `standard` | 30 | **31** |
 * | `dsh-hob`（助手） | 2 | **3** |
 * | `dsh-hob-work`（开发） | 33 | **34** |
 *
 * 证据：`.hob/archive/2026-10-05-step4-evidence/spike-leak-measurement.log`
 * （同一次 dump 里 `GLOBAL(5)` 含 `spike_plugin_scope_tool`，四行的数字全部 +1）。
 *
 * 而 `PROJECT.md` §5.2 写死：「**只有规划预设挂本插件的工具**；干活预设不挂」，
 * 且「助手 = `read_contracts` + `write_hob`」是**验收判据**。
 * ⇒ 在插件作用域注册会**同时打破这两条**。所以本模块**不注册**。
 *
 * ── 那工具由谁注册 ─────────────────────────────────────────────────────
 * 由 `src/preset/tools.ts`（预设行引用的模块）在**预设作用域**里注册 ——
 * 预设作用域注册**不会漏**（实测：助手仍恰好 2 个、`minimal` 不变）。
 * ⚠ **"恰好 2 个"的两个所指必须分清**（批 9 起）：
 *   · **本插件注册的工具** 恒为 **2**（`read_contracts` + `write_hob`）—— 上句与机检 ⑥ 说的是这个；
 *   · **助手模型面可见的工具** 批 9 起为 **20**（既有 11 + 批 9 新增 9）—— 见
 *     `src/preset/tools.ts` 的 `MODEL_TOOL_ALLOWLIST`。
 *   "2" 是**注册面**事实，"20" 是**模型面**事实；两者**不矛盾**，也不是同一层。
 * 本模块与它的分工：
 *   · **本模块** = 工具**定义**（唯一一份）+ 门禁服务 + 配置口径
 *   · `preset/tools.ts` = 挂载点（预设作用域）+ 越界工具屏蔽
 * 一份定义、一处挂载 —— 满足「守卫/实现只写一份」。
 *
 * ── 门禁服务（让 `modules.tools` 开关真正有效）───────────────────────────
 * `apply` 会 `ctx.provide('hobTools', …)`。预设行用**反应式** `ctx.inject(['hobTools'], …)`
 * 订阅它，因此：
 *   · 开关开 ⇒ 门禁在 ⇒ 预设行注册两个工具；
 *   · 开关关 ⇒ 门禁不在 ⇒ 预设行**不注册**（助手退化为"无工具"），
 *     **但预设不 broken、宿主零告警、插件整体照常**（实测，见
 *     `.hob/archive/2026-10-05-step4-evidence/spike-reactive-gate.log`）。
 *
 * ⚠ 为什么必须用**反应式** `ctx.inject` 而不是把 `hobTools` 写进预设行的静态 `inject`：
 *   静态 `inject` 缺依赖时会让该 fiber 停在 PENDING ⇒ 预设被标 **`broken`** ⇒
 *   **在选择器里被静默过滤掉**（`presetOptions()` 只留 `broken === undefined`）。
 *   实测症状：`spike2 [BROKEN: probe (hob-spike/modules/tools): waiting for hobToolsGate]`，
 *   见 `.hob/archive/2026-10-05-step4-evidence/spike-gate-broken.log`。
 *
 * ⚠ 本模块**不注册** DSH 原生 `read` / `bash` / `write` —— 与 `PROJECT.md` §5.2 同款纪律。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import {
  acceptanceProblems,
  evaluateGate,
  gateScopeUnits,
  withProvenanceResolver,
  type GateAction,
  type GateDecision,
  type GateScope,
  type StageControlUnit,
  type UnitProvenance,
  type UnitProvenanceResolver,
} from '../shared/stage-controls.ts'
import {
  assessLedgerReadiness,
  initialIndexToml,
  initialProjectMd,
  probeFromDirListing,
  readinessLineOf,
  type LedgerReadiness,
} from '../shared/ledger-readiness.ts'
import {
  assessLedgerLifecycle,
  indexIntegrityProblems,
  initialContextMd,
  initialDecisionsMd,
  initialLedgerActivation,
  initialTemplateManifest,
  nextGenerationOf,
  renderLedgerArchiveManifest,
  probeLedgerLifecycle,
  type LedgerLifecycle,
} from '../shared/ledger-lifecycle.ts'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { readMarkdownCapped, resolveLedgerRoot, resolveWorkspaceRoot } from '../server/doc-read.ts'
import {
  grepWorkspace as grepWorkspaceText,
  globWorkspace as globWorkspacePaths,
  readWorkspaceImage as readWorkspaceImageBytes,
  readWorkspaceText,
} from '../server/workspace-read.ts'
import { readLedgerResource, type LedgerUnitLike } from '../shared/ledger-resources.ts'
// ── 账本单元的**唯一解析实现**（R-06 / L-04）────────────────────────────────
//   ⚠ 与写前校验（`hob-write.ts`）、`/stages`（`stages-index.ts`）、readiness 共用
//     同一份严格解析器；⛔ 本模块**不再自带**第二份宽松解析器 —— 两份的失败形态是
//     「同一本账在门禁眼里非法、在读取眼里正常」。
//   ⚠ `reason` 词表也复用这里的 `STAGES_REASON_*` 常量（⛔ 不复制字面量）：
//     它是「阶段接口 / 需求链接口 / 资源接口」的共用词汇，复制会在改一处时静默漂。
import {
  parseUnitsToml,
  STAGES_REASON_INDEX_LEGACY,
  STAGES_REASON_INDEX_MALFORMED,
  STAGES_REASON_INDEX_UNREADABLE,
  STAGES_REASON_LEDGER_MISSING,
} from '../shared/stages-index.ts'
import { listWorkPlans } from '../server/work-plan-state.ts'
import { basename } from 'node:path'
import { LEDGER_FILES, writeHobFile } from '../server/hob-write.ts'
import { publishLiveChangeForLedger } from '../server/live-hub.ts'
import { HOB_WRITE_OPERATIONS, classifyHobWritePath, isCurrentRootDoc, type HobWriteOperation } from '../shared/ledger-write-policy.ts'
import {
  APPROVAL_DECISION_KIND,
  artifactDigestOf,
  approvalStateOf,
  isPipelineV2,
  receiptPatternOf,
  revisionOf,
} from '../shared/pipeline.ts'
import { pipelineDispatchProblems } from '../shared/pipeline-view.ts'
// ── 账本健康的**唯一判据**（B1.3 / T-02 / T-05）────────────────────────────
//   ⚠ 四个出口（readiness / stageGateOfLedger / stageHealthOfLedger / /stages.stageHealth）
//     必须共用它；⛔ 任何出口都不得自己再拼一份判据集（那正是 T-02 的病）。
import { describeLedgerHealth, ledgerHealthOf, type LedgerHealthProblem } from '../shared/ledger-health.ts'
// ── 首次铺骨架（2026-10-16 第 224 轮 · `UD-118`「C」）──────────────────────
//   ⚠ 它是**插件的初始化行为**，⛔ 不是工具：⚠ 本模块的参数表**一个字段都没加**。
// ── 待投递中间态记账（2026-10-10 · 用户报障修复）──────────────────────────
//   ⚠ **分层纪律**：`hob-write.ts`（落盘层）**不 import** 运行态模块 ——
//     它只回一个可判定的 `handoff` 字段，**由本层（工具层）决定记不记**。
//     工具层已持有账本根（`ledgerRootOf`），正是记账该在的地方。
// ── 改 2 · 写入即投递（2026-10-10 第 44 轮 · 结构改造②）──────────────────
//   ⚠ 桥接逻辑放在 `server/write-delivery.ts`：它只依赖 `node:fs` 与 `orch-state.ts`，
//     既守住"落盘层不碰运行态"（机检 F6），又能被机检**直接 import 真跑**。
//   ⚠ 记账（记一条"待投递"）**已从本层移进 `write-delivery.ts`** ——
//     它与投递必须是**一次调用里的两步**（否则又回到"两个独立动作"的缺陷形态）；
//     故 `ensureRuntimeIgnored` / `orchStateFileOf` / `recordHandoff` / `dirname`
//     在本模块**已不再直接使用**（由该模块统一持有）。
import { deliverHandoff, renderHandoffReading, type DispatchLike } from '../server/write-delivery.ts'
import type { EffectsQueue } from '../server/effects-queue.ts'
import { enqueueHandoff, handoffEffectKey, pointerMessageForRef, HANDOFF_EFFECT } from '../server/handoff-effects.ts'
// ── 「首次铺骨架」开关的**唯一解 ref 点**（2026-10-24 · 本单必修 3）───────────
//   ⚠ `skeleton.enabled` 标了 `.volatile()` ⇒ 运行时是 **ref 对象**，直读拿到的是 ref
//     （恒 truthy、且不报错）。⇒ ⚠ **该函数已退役**（O-14）：`config.ts` 里已无 `skeletonEnabled`，
//     本行保留只为记录当时的诊断结论，⛔ 不要照着去找那个函数。
//   ⚠ 用**命名空间导入**（与 `preset/tools.ts` 的 `TASK-D` 纪律同一条）：
//     具名导入在 ESM **链接期**就要求目标模块有那个名字 —— 少一个名字会让**整个模块**
//     求值失败（症状：工具面整体消失且不报错）。命名空间导入把代价缩到"这一条降级"。
import * as configFace from '../config.ts'
// ── 能力红线的**单一来源**（2026-10-24 · 跨席收口）─────────────────────────
//   ⚠ 这句话原先在本文件里是**逐字副本**（「不能写、不能执行命令、不能组队」）。
//     多份副本的失败形态是**静默漂移**：某天真的开了写能力，只改一处 ⇒ 另一处
//     仍在向用户/模型承诺"不能写" —— 那是**谎报**，比没有这句更坏。
//   ⚠ `src/shared/capability-red-line.ts` **零 import**（纯常量模块）⇒ host 侧
//     直接 import 安全（不需要 ctx、不会有循环依赖）。
import { CAPABILITY_RED_LINE_ZH } from '../shared/capability-red-line.ts'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

/**
 * 资源路径与文件路径的**判别点**。
 * ⚠ 只认已知语义前缀；其余一律走旧文件读取路径，保持向后兼容。
 */
export function looksLikeResource(p: string): boolean {
  const x = String(p ?? '').trim().replace(/^\/+|\/+$/g, '')
  return /^(goals|requirements|changes|tasks|runs|acceptances|evidences|risks|decisions|capabilities|caps)$/.test(x)
    || /^(goal|requirement|change|task|run|acceptance|evidence|risk|decision|capability)\/[^/]+(?:\/children)?$/.test(x)
}

/**
 * 账本单元读取失败（**带机器可判的 reason**）。
 *
 * ⚠ 三族成因⛔ 不许压成一句 `index-unreadable`：下一步动作完全不同 ——
 *   · `ledger-missing`   —— 还没开账 ⇒ **去建账**；
 *   · `index-legacy`     —— 已知旧格式（`[meta]` / `[units."ID"]`）⇒ **去迁移**；
 *   · `index-malformed`  —— 现行 `[[unit]]` 格式写坏了 ⇒ **去修那一行**；
 *   · `index-unreadable` —— 读不出来（EACCES / EIO / EISDIR…）⇒ **去查权限 / 磁盘**。
 * ⚠ `reason` 取值复用 `stages-index.ts` 的 `STAGES_REASON_*` 常量（⛔ 不在这里复制字面量）。
 */
export class LedgerUnitsReadError extends Error {
  /** 机器可判的成因（`STAGES_REASON_*` 之一）。 */
  readonly reason: string
  /** 触发失败的源文件名（`index.toml` / `unit-01.toml`）；目录级失败时是 `ledger/units`。 */
  readonly file: string
  constructor(reason: string, file: string, message: string) {
    super(message)
    this.name = 'LedgerUnitsReadError'
    this.reason = reason
    this.file = file
  }
}

/**
 * 读取并解析账本单元：`index.toml` 导航 + 固定 `unit-*.toml` 分片。
 *
 * ⚠ **严格解析**（`parseUnitsToml`，与写前校验 / `/stages` 共用同一份实现）：
 *   任一份源文件不是现行 `[[unit]]` 格式 ⇒ **抛 {@link LedgerUnitsReadError}**，
 *   错误带 `reason`（复用 `STAGES_REASON_*` 词表）与**文件名**。
 *   ⛔ 不静默跳过坏行 / 丢字段 —— 那会把「账本写坏了」伪装成「账本少一条」，
 *   与写侧 `catch { return [] }` 是同族错误的两级（一个丢分片、一个丢字段）。
 *
 * ⚠ 只认固定文件名，⛔ 不把同目录其它 TOML 误当账本。
 */
export function readLedgerUnits(ledgerRoot: string): LedgerUnitLike[] {
  const unitsDir = join(ledgerRoot, 'ledger', 'units')
  /** 目录级失败的消息里要有可点的位置（不是整个账本根）。 */
  const dirLabel = 'ledger/units'
  let shards: string[]
  try {
    shards = readdirSync(unitsDir)
      .filter((name) => /^unit-[^/]+\.toml$/.test(name))
      .sort()
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code
    /** ⚠ 目录不存在 = 还没开账；其余（EACCES / EISDIR…）一律是「读不出来」。 */
    const reason = code === 'ENOENT' ? STAGES_REASON_LEDGER_MISSING : STAGES_REASON_INDEX_UNREADABLE
    throw new LedgerUnitsReadError(
      reason,
      dirLabel,
      `${dirLabel}: 读不出来（${code ?? 'unknown'}）—— ${String((e as Error)?.message ?? e)}`,
    )
  }
  const files = ['index.toml', ...shards]
  return files.flatMap((name) => {
    let src: string
    try {
      src = readFileSync(join(unitsDir, name), 'utf8')
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code
      /** ⚠ 入口 `index.toml` 缺 = 还没开账；分片缺 = 账本在但残了（与 `stages-index` 同口径）。 */
      const reason = code !== 'ENOENT'
        ? STAGES_REASON_INDEX_UNREADABLE
        : (name === 'index.toml' ? STAGES_REASON_LEDGER_MISSING : STAGES_REASON_INDEX_UNREADABLE)
      throw new LedgerUnitsReadError(
        reason,
        name,
        `${name}: 读不出来（${code ?? 'unknown'}）—— ${String((e as Error)?.message ?? e)}`,
      )
    }
    try {
      return parseUnitsToml(src) as unknown as LedgerUnitLike[]
    } catch (e) {
      const msg = String((e as Error)?.message ?? e)
      /**
       * ⚠ **旧格式 ≠ 写坏了**：`[meta]` / `[units."ID"]` 是**已知、可迁移**的形态
       *   ⇒ 说清「去迁移」；其余解析失败才是 `index-malformed`（去修那一行）。
       *   ⚠ 判定与 `stages-index.ts:769` / `requirement-chains-route.ts:118` 同一份正则。
       */
      const legacy = /不支持的 TOML 表头\s*"\[(?:meta|units)/.test(msg)
      const reason = legacy ? STAGES_REASON_INDEX_LEGACY : STAGES_REASON_INDEX_MALFORMED
      throw new LedgerUnitsReadError(reason, name, `${name}: ${msg}`)
    }
  })
}

/**
 * **历史分片号段**（S-02 地基 · 2026-11-10）。
 *
 * ⚠ 这是**账本侧的可核事实**（单元落在哪个物理分片），⛔ 不是单元自己声明的字段。
 * 实测存量：`clarify_legacy` 共 177 行，全部在 `dsh-hob` 的 `unit-01..06`；
 * `unit-07` 为 0 ⇒ 这六片装的就是控制上线前的历史单元。
 * ⚠ 当前只是“地基”：等后续批次冻结这六个分片（只允许原地修正）后，
 *   `legacy-migrated` 才真正变成路径事实；本批不改写盘面。
 */
export const HISTORIC_UNIT_SHARDS: readonly string[] = [
  'unit-01.toml', 'unit-02.toml', 'unit-03.toml',
  'unit-04.toml', 'unit-05.toml', 'unit-06.toml',
]

/**
 * 按账本构造 provenance 解析器（I/O 侧唯一实现）。
 *
 * 判据：
 *   · 单元所在分片 ∈ {@link HISTORIC_UNIT_SHARDS} ⇒ `legacy-migrated`；
 *   · 单元在 `index.toml` / 新分片里 ⇒ `current`；
 *   · 单元 id 判不出（空 id / 分片读不出来） ⇒ `unknown`（= 老逻辑兼容档）。
 *
 * ⚠ 只按**分片号段**判定，不读 `ledger.toml` 的 `created_at`：
 *   该字段的语义（建账时刻 vs 最后激活时刻）尚未核实（`01-judgment.md` §13 #4），
 *   拿它当“历史”会误判整本新账；本批只启用已实测的分片事实。
 */
export function provenanceResolverOf(ledgerRoot: string): UnitProvenanceResolver {
  const unitsDir = join(ledgerRoot, 'ledger', 'units')
  const shardOfId = new Map<string, string>()
  try {
    const shards = readdirSync(unitsDir)
      .filter((name) => /^unit-[^/]+\.toml$/.test(name))
      .sort()
    for (const name of ['index.toml', ...shards]) {
      let units: LedgerUnitLike[]
      try {
        units = parseUnitsToml(readFileSync(join(unitsDir, name), 'utf8')) as unknown as LedgerUnitLike[]
      } catch {
        /** 读不出来的分片不猜：其单元保持 `unknown`（⛔ 不按“历史”放行）。 */
        continue
      }
      for (const u of units) {
        const id = String((u as { id?: unknown }).id ?? '').trim()
        if (id !== '') shardOfId.set(id, name)
      }
    }
  } catch {
    return () => 'unknown'
  }
  const historic = new Set<string>(HISTORIC_UNIT_SHARDS)
  return (u: StageControlUnit): UnitProvenance => {
    const id = String(u.id ?? '').trim()
    if (id === '') return 'unknown'
    const shard = shardOfId.get(id)
    if (shard === undefined) return 'unknown'
    return historic.has(shard) ? 'legacy-migrated' : 'current'
  }
}

/**
 * 在**本账本 provenance 已注入**的上下文里执行一次同步判定，判完恢复原注入。
 * ⚠ 所有“读账本 + 跑阶段判据”的出口都必须经过本函数（`01-judgment.md` §9 #10）。
 */
function withLedgerProvenance<T>(ledgerRoot: string, run: () => T): T {
  return withProvenanceResolver(provenanceResolverOf(ledgerRoot), run)
}

/** 模块名（同时是 fiber 显示名）。 */
export const name = 'dsh-hob-tools'

/**
 * **硬依赖**：`tools` 服务不在时，本模块的 fiber 停在 `PENDING`（不激活）。
 *
 * 这是「模块可独立启停」的**第二条路径**（第一条是 `modules.tools` 配置开关）：
 * 环境缺依赖 ⇒ 模块自动不加载，**宿主不报错、插件整体照常**。
 * 语义依据（cordis）：`FiberState.PENDING = 0` — "waiting for required services"
 * （`@deepseek-ai/cordis/lib/types/fiber.d.ts:60-68`）。
 *
 * ── ⚠⚠ **这条依赖是"真的被用上"的，不是一个挂在门口没人读的声明**（2026-10-24）──
 *   **改前**：`inject = ['tools']` 声明了，而 `apply` 里**一次都没读 `ctx.tools`**
 *   ⇒ 它只起"加载门禁"作用，看上去像空声明。
 *
 *   **现在**：`apply` **真的读它一次**，并据此决定要不要提供门禁服务
 *   （见 {@link apply} 里的 `registerOk`）：门禁 `hobTools` 的语义是
 *   「工具面此刻**可以**注册」，而这句话只有在宿主 `tools` 服务**真的有 `register`**
 *   时才成立。宿主把 `tools` 换成一个没有 `register` 的形状（版本错配 / 夹具）
 *   时，若照旧提供门禁 ⇒ 预设行会**先注册再炸**；现在 ⇒ **不提供门禁 + 一行 warn**
 *   （预设行只是不注册工具，不 broken、不刷错误栈）。
 *   ⚠ 真实宿主（`@deepseek-ai/dsh-tools` 的 `ToolsService`）**一直有 `register`**
 *     ⇒ 正常路径的行为**一个字都没变**（判据见 `scripts/module-independence-probe.mjs`
 *     路径 A/B：默认配置下 tools 模块仍被登记，缺服务时仍 PENDING）。
 *   ⚠ `inject` 本身**保留**：它仍是"环境依赖决定的启停"这条架构性质的载体
 *     （`check:modules` 的路径 B 用它证明"缺依赖 ⇒ PENDING 且整体照常"）。
 */
export const inject = ['tools']

/**
 * 由**门禁**负责注册的模型面工具名（⚠ 单一来源，⛔ 别处不许再抄一份）。
 *
 * ── 为什么这个清单必须在这里、而不是在预设的档位表里 ─────────────────────
 *   `src/preset/tools.ts` 的 `PERMISSION_TIERS` 是三档**模型面**名字集，而上面这些名字的
 *   **注册面**在本模块的门禁后面（`modules.tools` 关掉 ⇒ 门禁不在 ⇒ 这些名称**不存在**）。
 *   ⇒ 两个面**必须能对账**，否则就是"模型看得见、一调就 `unknown tool`"：
 *     2026-10-24 排查确认的形态 —— `modules.tools=false` 时模型仍看见 4 个只读名
 *     （`hob_read_doc` / `hob_glob` / `hob_grep` / `hob_read_image`）。
 *   ⚠ 本常量就是那份**对账依据**：消费方（`preset/tools.ts` 的装配期过滤 / 执行前拦截）
 *     应当在**门禁缺席**时把这份集合从"允许名"里减掉 —— 具体接线在 C 席文件里，
 *     本单只提供单一来源（见交付报告里的转派项）。
 *   ⚠ 名字的**增删只在这里改**：加一个"由门禁注册"的工具时，本数组 + 预设的档位表
 *     必须同批更新；漏一边就会被上述对账判据抓到。
 */
export const GATE_OWNED_TOOL_NAMES: readonly string[] = [
  // 账本两件（`modules.tools` 关 ⇒ 这两个也不存在）
  'read_contracts',
  'write_hob',
  /**
   * ⚠ 账本先建 / 迁移三件同样由本模块注册：
   *   `modules.tools` 关掉时它们根本不存在 ⇒ 必须从可见名里一起摘掉，
   *   否则模型面会出现“看得见、点一下 unknown tool”的假能力。
   */
  'hob_ledger_status',
  'hob_ledger_init',
  'hob_ledger_rebuild',
  'hob_ledger_migrate',
  'hob_pipeline_approve',
  // 四个自注册只读工具（`modules.tools` 关 ⇒ 同样不存在；它们正是"看得见却调不到"的那四个）
  'hob_read_doc',
  'hob_glob',
  'hob_grep',
  'hob_read_image',
]

/**
 * **白名单 ↔ 注册面对账**：把"门禁不在时**必然** `unknown tool`"的名字从允许集里减掉。
 *
 * ── 它治的确切形态（2026-10-24 排查确认，实测复现见交付报告）────────────────
 *   `modules.tools = false` ⇒ 本模块**根本不加载** ⇒ 门禁 `hobTools` 不存在 ⇒
 *   `src/preset/tools.ts` 的 `ctx.inject([GATE_SERVICE])` 回调**不跑** ⇒
 *   **`read_contracts` / `write_hob` / `hob_read_doc` / `hob_glob` / `hob_grep` /
 *   `hob_read_image` 一个都没注册**。
 *   ⚠ 而同一文件里的**装配期白名单**（`filterModelToolList`）与**执行前拦截**
 *   （`enforceToolAllowlist`）挂在门禁**外面**（那是刻意的：关掉门禁不许放权），
 *   它们的名字集来自 `PERMISSION_TIERS` —— 那个表**只描述"这一档该有哪些名字"**，
 *   **不知道注册面在不在**。
 *   ⇒ 模型面于是出现"看得见、点一下就 `unknown tool`"的四个只读名（这是**模型面比注册面宽**
 *     的失败，与"声明面漏行"方向相反，修法也相反）。
 *
 * ── 用法（**消费方只有一处**：`src/preset/tools.ts` 的那两个名字集构造点）────
 *   ```ts
 *   // 原来： const allow = new Set(PERMISSION_TIERS[level])
 *   // 现在： const allow = visibleToolsFor(PERMISSION_TIERS[level], gateReady)
 *   ```
 *   其中 `gateReady` = 门禁回调**跑过了**（`let gateReady = false; ctx.inject([GATE_SERVICE], () => { gateReady = true; … })`
 *   —— ⚠ 必须在**同一作用域**里维护，⛔ 不要用 `ctx.get(GATE_SERVICE) !== undefined`：
 *   后者在**门禁服务存在但工具注册尚未完成**的那一瞬也可能是 `true`，两种状态会混）。
 *
 * ── ⚠ 语义三条（⛔ 缺一条就变成"另一种静默"）─────────────────────────────
 *   ① `gatePresent === true` ⇒ **原样返回**（一个名字都不动 ⇒ 正常路径零行为变化）；
 *   ② `gatePresent === false` ⇒ 只减掉 {@link GATE_OWNED_TOOL_NAMES}，**其余名字一个不动**
 *      （⚠ 白名单里还有编排 / 台账 / 检索那批名字，它们的注册面**不归门禁管**，
 *       一并减掉会造成"关掉 tools 顺手关掉别的能力"——那正是本轮要防的拆东墙）；
 *   ③ 入参是任意可迭代名字集，返回**新数组**（⛔ 不改入参、⛔ 不缓存快照）。
 *
 * @param names - 该档的名字集（通常 `PERMISSION_TIERS[level]`）。
 * @param gatePresent - 门禁**当前是否就绪**（= 门禁回调跑过 ⇒ 工具确实注册了）。
 */
export function visibleToolsFor(names: readonly string[], gatePresent: boolean): readonly string[] {
  if (gatePresent) return names
  const hidden = new Set<string>(GATE_OWNED_TOOL_NAMES)
  return names.filter((n) => !hidden.has(n))
}

/**
 * 门禁服务名 —— 预设行据此判断「工具模块是否就绪」。
 *
 * 用一个**服务**而不是一个环境变量/文件：它是 cordis 原生的依赖表达，
 * 能跨作用域（插件平面 → 预设作用域）被看到，且天然有生命周期
 * （模块卸载 ⇒ 服务消失 ⇒ 预设行的注册随之拆除）。
 */
export const GATE_SERVICE = 'hobTools'

/**
 * 两个工具的配置口径。
 *
 * ⚠ **刻意不用插件 Config schema**：预设行的 config 是**纯 Cordis 条目配置**，
 *   与包自己的 Schemastery schema 是两条不同的路。若这里写 Config + `.volatile()`，
 *   preset 行传进来的就只是 `{}`，而 volatile 字段会解析成 ref 对象 ——
 *   读它得到 `{}`，于是 `bytes <= {}` 恒 false，**每个文件都被当成超限**（静默读成空）。
 *   故这里只收普通标量，并且**逐个带默认值**。
 */
export interface HobToolsConfig {
  /** 工作区根；留空 = 按会话 cwd 解析（不硬编码路径）。 */
  workspaceRoot?: string
  /**
   * 账本父目录（**v4 新增**）。账本按 `<ledgerHome>/<工作区名>/` 派生。
   *
   * ⚠ 为什么父目录也不硬编码在代码里：那会把插件绑死在本机路径上
   *   （可移植性口径 UD-73③）。缺省值由预设行的配置给出。
   */
  ledgerHome?: string
  /** 直接指定本工作区的账本目录（覆盖派生；便于特殊工作区）。 */
  ledgerRoot?: string
  /** @deprecated v4 起账本已迁出工作区；保留仅为兼容旧配置的目录名。 */
  hobDir?: string
  /** 单个 `.md` 的读取上限（字节）。 */
  maxFileBytes?: number
  /** 账本单文件写入上限（字节）。 */
  maxWriteBytes?: number
  /** 是否注册写工具（false = 只读模式，写工具**根本不出现**）。 */
  enableWrite?: boolean
  // ⚠ 此处原有 `denyTools?: string[]`（"额外屏蔽的继承工具名"）。**已删**（阶段 E2）：
  //   它**无任何 patch 声明**（`grep -rn denyTools preset/ cordis.patch.yml` = 0 命中）
  //   ⇒ 读取处恒为 `?? []`，是一个**死键**；用户口径「配置面只留真管用的字段」（UD-43 先例）。
  //   当时保留的理由（"机制未定前删键会留下半截状态"）**已消失**：
  //   收敛机制现为**代码内常量**（装配期过滤见 `MODEL_TOOL_ALLOWLIST` + 执行期拦截
  //   见 `enforceToolAllowlist`），不再依赖配置项。
  //   ⚠ `DEFAULT_DENY` 与现有 deny 路径**行为不变**（本批只删死键）。
  /**
   * 诊断日志开关。**默认关**（缺省/未给 = 不写任何文件）。
   *
   * ⚠ 为什么默认关：早期版本无条件 `appendFileSync('/tmp/…')`，实测真机 3 分钟写 508 KB、
   *   累计 2.3 MB（原 `FACTS.md` 的 F-J25，现已退场并入归档
   *   `archive/2026-10-09-ledger-history/FACTS-final.md`）—— **一个只读用途的诊断不该有写盘副作用**。
   * ⚠ 开关必须有**真实消费者**（挂载侧据此决定写不写）；只留配置键而不读，就是"空旋钮"。
   */
  debugLog?: boolean
  /** 诊断日志路径；仅在 `debugLog: true` 时有意义。 */
  debugLogPath?: string
  /**
   * 诊断日志的**磁盘上限**（字节）。
   *
   * ⚠ 判据是**文件现有大小**，不是内存计数器：宿主 fiber 会被重载/重挂，
   *   内存计数随 reload 归零 ⇒ 上限形同虚设（旧项目的实测踩坑）。
   */
  debugLogMaxBytes?: number
}

/** 默认值集中在此，避免两处各写一套。 */
export const DEFAULTS = {
  /** @deprecated v4 起账本不在工作区内；仅作旧配置兼容。 */
  hobDir: '.hob',
  /**
   * 账本父目录缺省值（**v4 新增**）。
   *
   * ⚠ **刻意留空** —— 留空时由 `resolveLedgerRoot` 退到「工作区的**兄弟目录**」
   *   `<工作区父目录>/.hob-ledgers/<工作区名>/`，**不含任何本机绝对路径**。
   *
   *   实测教训（2026-10-08 重启后复核）：这里曾写死 `/home/lk/FF/.hob-ledgers`，
   *   结果在 `cwd=/home/bob/work/myproj` 的环境里账本被写到 **`/home/lk/FF/...`**
   *   （上一台机器的路径）—— 撞可移植性口径 **UD-73③**。
   *
   * ⇒ 想改父目录就**配这一项**（预设行给出）；不配也能正确工作。
   */
  ledgerHome: '',
  maxFileBytes: 65536,
  maxWriteBytes: 262144,
  keepBackups: 20,
  shrinkGuard: 0.5,
  debugLogMaxBytes: 262144,
  /** 单张图片的读取上限（字节）。⚠ 图片**不做截断**（截断即损坏）。 */
  maxImageBytes: 8 * 1024 * 1024,
} as const

/**
 * 默认要**摘掉**的宿主平面工具（越界清单）。
 *
 * ⚠ 为什么需要这一节：`dsh-interconnect` 的四个工具**不是**本插件挂的，
 *   而是它自己的 bundle patch 作为**宿主平面行**声明的。宿主平面的工具会
 *   **被每个 agent 继承** —— 只靠"预设不挂它"**摘不掉**（实测：不摘时助手会多出 4 个，
 *   见 `.hob/archive/2026-10-05-step4-evidence/spike-leak-measurement.log` 的对照行）。
 *   ⇒ 必须用 `ctx.tools.restrict({ deny })` 屏蔽。收敛要靠**允许清单**思维（§6.3）。
 *
 * ⚠ **本常量只服务「Hob」（规划侧）那一个预设**，语义自本文件建立以来未变（2026-10-07 批 6 复核）。
 *
 * ⚠⚠ **2026-10-24 · 本项目自研的跨实例投递模块已整体删除，与本常量无关**：
 *   这里屏蔽的 `interconnect_*` 是**第三方插件 `dsh-interconnect`** 注册的工具名，
 *   ⛔ **不是**本项目自研的那一套（已删除）。两条完全不同的东西，⛔ 别因为名字像就一起删 ——
 *   删掉它们 ⇒ 若将来装了那个插件，Hob 会话会**多出一批跨实例工具**（等于放权）。
 *   ⇒ 本常量**保留不动**，属「不碰既有行为」那一侧的边界。
 */
export const DEFAULT_DENY = [
  // ── ① 跨实例投递（第三方 `dsh-interconnect` 的宿主平面行，会被每个 agent 继承）──
  //   理由：这条通道**不受本会话的策略约束** —— 它能把指令送到**别的宿主实例**上的会话，
  //   而那不在本项目的账本与验收链里（送出去的东西既不进 `runs/`、也不进 `acc/`）。
  //   ⇒ 一旦可达，"投递 ≠ 做完"这条不变量就失去了唯一的记录面。
  'interconnect_send',
  'interconnect_reply',
  'interconnect_ping',
  'interconnect_list',

  // ── ②' 能力放大口（**P15 新增**：它自己不动任何文件，但能"点开"别的能力）────
  //   `ops_discover_tools`（`dsh-ops` 的 discovery 行）做的事是：按查询**选择并发布**
  //   `ops_*` 能力到下一步的模型面。⚠ 读它的实现（`lib/discovery/index.js:78-81`）：
  //   过滤条件只有"该会话的 sandbox policy 不是 read-only" ⇒ 在 `danger-full-access`
  //   会话里它能发布 `ops_write_file` / `ops_edit_file` / `ops_remove` / `ops_bash`。
  //   ⇒ 它本身**不写**，但它是**通往写/命令的那扇门**；deny 掉它，`ops_*` 写类
  //     就**无从进入**模型面（那批名字不在本清单里，只是"没被发布"）。
  //   ⚠ 只读那几件（`ops_glob`/`ops_grep`/`ops_read_files`/`ops_inspect_local_file`/
  //     `ops_result`）是**独立发布**的，不受本条影响 ⇒ 读能力一点没少。
  'ops_discover_tools',

  // ── ② 命令类（能在**本机**执行任意命令）──────────────────────────────
  //   理由：Hob 的职责是"写清步骤交给实施会话"，**不是自己动手**（正式阶段里第 4 步明确规定
  //   `executor` 是 developer session）。`bash`/`pwsh` 一可达，就同时具备读写任意文件、
  //   起任意进程、改任何仓库的能力 —— 那等于把执行、技术验证和产品验收合并到同一个主体。
  'bash',
  'pwsh',
  // ⚠⚠ **P14 实况补录**：本机还装了 `dsh-experimental-terminal-bundle` ⇒ 它带来 6 个
  //   `terminal_*`（`open`/`send`/`signal`/`close`/`read`/`list`），那是**持久化的 shell**
  //   —— 与 `bash` 同类同权（能起进程、能改文件），⛔ 不是"只是读终端"。
  //   ⚠ 这条是"没见过的工具"那条判据**当场咬出来的**：不补进来的话它们会以
  //   `unseen → 放行` 的形态进模型面（= 默认放开的副作用，必须靠 deny 清单收）。
  'terminal_open',
  'terminal_send',
  'terminal_signal',
  'terminal_close',
  'terminal_read',
  'terminal_list',

  // ── ③ 写类（能改**任意路径**，含代码与账本之外的任何文件）────────────────
  //   理由：账本写入已经收口到 `write_hob`（有白名单 + 缩水守卫 + 归档禁 overwrite）。
  //   放行通用的 `write`/`edit` 等于绕过那一整套守卫 ⇒ "账本只有一个写者"从机制退回约定。
  'write',
  'edit',
  'str_replace_editor',

  // ── ④ 组队 / 派活类（能拉一支团队、给别的会话发指令、改它们的生命周期）──────
  //   理由：本项目的编排口径是"**投递一条消息**"（`hob_send` / `hob_dispatch`，记账、可验收）。
  //   而 `spawn_teammate` / `team_task_*` / `wait_agent` / `interrupt_agent` 是**另一套**团队
  //   运行面：它自己建 roster、自己认领任务、自己判完成 —— 与正式阶段里的 `run`/`verification`/`acc` 三处记录
  //   **对不上**。两套并存 ⇒ 同一件事有两个"谁在做、做完没有"的答案。
  'spawn_teammate',
  'team_task_create',
  'team_task_get',
  'team_task_list',
  'team_task_update',
  'send_message',
  'wait_agent',
  'interrupt_agent',
  'list_agents',
  // ⚠ **P14 实况补录**：本机 `@nanmicoder/dsh-agent-teams` 的 15 个 `agent_teams_*` 与
  //   `team_task_*` 是**同一套团队运行面**（建 roster / 认领任务 / 改生命周期 / 自己判完成）。
  //   ⇒ 与上面 `spawn_teammate`/`team_task_*` 同一条理由，⛔ 不能只挡一半。
  'agent_teams_create',
  'agent_teams_add_member',
  'agent_teams_remove_member',
  'agent_teams_create_task',
  'agent_teams_claim_task',
  'agent_teams_update_task',
  'agent_teams_amend_task',
  'agent_teams_reassign_task',
  'agent_teams_approve',
  'agent_teams_edit_plan',
  'agent_teams_send_message',
  'agent_teams_status',
  'agent_teams_resume',
  'agent_teams_delete',

  // ── ⑤ 改共享工作状态类（看板卡的创建/移动/勾选/报告）──────────────────
  //   理由：看板是**用户**的确认面（任务只有用户能移进 `done`）。Hob 若自己能建卡、移卡、
  //   勾清单、交执行报告，"完成须用户确认"这条就变成自己给自己签字。
  //   ⚠ 只读的三个（`taskboard_list`/`get`/`comments`）**不在本清单** —— 读看板是合法的。
  'taskboard_create',
  'taskboard_move',
  'taskboard_update',
  'taskboard_delete',
  'taskboard_checklist',
  'taskboard_comment_add',
  'taskboard_execution_report',

  // ── ⑥ 其它能改共享状态 / 起并行工作面的 ─────────────────────────────
  //   `job_*`：后台任务本子（起/停/读别人起的活）；`todo_write`/`create_goal`/`update_goal`：
  //   改写会话的目标与待办（那是**用户**的意图面）；`subagent*`/`workflow`/`ralph`：
  //   另起一个独立 agent 去干活，同样绕开 `run`/`acc` 记录。
  'job_kill',
  'job_list',
  'job_output',
  'todo_write',
  'create_goal',
  'update_goal',
  'subagent',
  'subagent_codex',
  'subagent_claude_code',
  'subagent_fork',
  'workflow',
  'ralph',
  // ⚠ **P14 实况补录（改共享状态 / 改宿主本身）**：
  //   `create_worktree` 会在别的仓库里建分支与工作区（改**别的项目**的磁盘状态）；
  //   `dshm_install`/`uninstall`/`upgrade`/`toggle`/`restart` 改的是**宿主 profile**
  //   （装/卸插件、重启宿主）—— 那是比"改一个文件"更大的共享状态，且**用户看不见过程**。
  //   ⚠ 市场**只读**三件（`dshm_search`/`dshm_list`/`dshm_outdated`）**不在此列**。
  'create_worktree',
  'dshm_install',
  'dshm_uninstall',
  'dshm_upgrade',
  'dshm_toggle',
  'dshm_restart',
] as const

/** 解析工作区根：显式配置优先，其次会话 cwd；都没有则 undefined（fail-closed）。 */
export function rootOf(cfg: HobToolsConfig, exec: ToolRunContext): string | undefined {
  return resolveWorkspaceRoot(cfg.workspaceRoot ?? '', exec.agent?.session.header.cwd)
}

/**
 * 解析**账本目录**（v4：在工作区之外，按工作区名派生）。
 *
 * ⚠ 与 {@link rootOf} 的分工：工作区根是**读项目文件**的边界（v4 后已不再用于账本），
 *   账本目录是**读写账本**的边界。两者**物理分开**，隔离由文件系统保证。
 *
 * fail-closed：判不出 ⇒ undefined ⇒ 调用方拒绝（不猜、不退回 cwd）。
 */
export function ledgerRootOf(cfg: HobToolsConfig, exec: ToolRunContext): string | undefined {
  return resolveLedgerRoot(
    cfg.ledgerRoot ?? '',
    cfg.ledgerHome ?? DEFAULTS.ledgerHome,
    rootOf(cfg, exec),
  )
}

/**
 * 派单 / 写入前的阶段门禁：从**真实账本**读单元，再用与检查族同一套纯函数判定。
 *
 * ⚠ 只拒绝**非历史豁免**的新单元缺口；历史存量仍按 `pre-control` 只读豁免。
 * ⚠ 读不到账本 ⇒ 返回可读原因，⛔ 不放行（fail-closed），避免“判不出”被当成“没有缺口”。
 */
export function stageGateOfLedger(ledgerRoot: string): string | undefined {
  try {
    const units = readLedgerUnits(ledgerRoot) as StageControlUnit[]
    /**
     * ⚠ **B1.3（T-02）：判据集改由 `ledgerHealthOf` 一处产生**。
     *   ⚠ 取 `problems`（结构层 + approval）= 推进层：阶段门禁必须**同时**看
     *     用户批准（G1/G2 是硬要求）与结构缺口。
     *   ⚠ 改前这里调的是 `stageControlProblems`（field + approval，**不含 closure**）
     *     ⇒ 与 readiness / /stages 对同一夹具给出不同结论（四套判据的第一套）。
     */
    const health = withLedgerProvenance(ledgerRoot, () => ledgerHealthOf(units))
    if (health.problems.length === 0) return undefined
    const first = describeLedgerHealth(health.problems)
    return `阶段门禁未通过：${health.problems.length} 条缺口（${first}）⇒ 先回查需求 / 方案 / 任务，补齐后再推进。`
  } catch (e) {
    return `阶段门禁判不出：账本读不到（${String((e as Error)?.message ?? e)}）⇒ 本次不推进（⛔ 不把“判不出”当成“没有缺口”）。`
  }
}

/**
 * **按作用域判定的阶段门禁**（2026-11-06 · Wave 1）。
 *
 * ── 它治什么 ──────────────────────────────────────────────────────────────
 *   `stageGateOfLedger` 用**全账本**判据：别的需求缺一个字段，就把当前这一单也拦下。
 *   用户要的是「推进受阻才回流」，⛔ 不是「账本全局有任何欠账就全体停工」。
 *   ⇒ 本入口先按 `task / requirement / change / plan` 收敛作用域，再看该链上的缺口。
 *
 * ── 三档语义（⛔ 不许合并）────────────────────────────────────────────────
 *   · `go`      —— 该作用域无阻塞，可以推进；
 *   · `return`  —— 该作用域有阻塞，须回到最早失效阶段；
 *   · `hold`    —— 判不出（账本读不到 / 作用域缺 id）⇒ 不推进，且**不冒充**成 `return`。
 *   `project` 作用域只出**健康报告**（blockers 非空但 decision = go），⛔ 不用它拦单。
 *
 * @param ledgerRoot - 账本区根
 * @param input - 动作 + 作用域
 */
export function stageGateAtLedger(
  ledgerRoot: string,
  input: { action: GateAction; scope: GateScope },
): GateDecision {
  const scopeText = input.scope.kind === 'project'
    ? 'project'
    : `${input.scope.kind}:${String(input.scope.id ?? '').trim() || '(missing)'}`
  if (input.scope.kind !== 'project' && String(input.scope.id ?? '').trim() === '') {
    return { decision: 'hold', scope: scopeText, blockers: [], allowedRepairs: [] }
  }
  try {
    const units = readLedgerUnits(ledgerRoot) as StageControlUnit[]
    /**
     * ⚠⚠ **2026-11-08 · 用户裁定：作用域指向的单元不存在 ⇒ `hold`，⛔ 不许 `go`。**
     *
     * ── 病（真机 + 纯函数双向实测）──────────────────────────────────────────
     *   `evaluateGate` 走 `gateScopeUnits`：把作用域 id 在账本里**找它自己与上下游**。
     *   找不到 ⇒ 作用域解析出**空集** ⇒ 空集上没有缺口 ⇒ **判 `go`**。
     *   实测：`scope.id = 'TSK-079'`（真实存在）⇒ `return`（4 条阻塞）；
     *        `scope.id = '随便一句话'` / 任何不存在的号 ⇒ **`go`（0 条阻塞）**。
     *
     *   ⇒ 后果正是用户报的「说个东西直接就派活了」：需求没落成 R、方案没落成 CHG、
     *     任务没落成 TSK 时，只要 `task` 参数不是一个真实存在的号，**门禁等于不存在**。
     *
     * ── 为什么不能靠"补全上游"来救 ────────────────────────────────────────
     *   空集不是"这条链很干净"，而是"**根本没有这条链**"。两者给同一个 `go`，
     *   就是把"判不出"读成"没有缺口" —— 与 `R-4` 同一条错误的镜像。
     *
     * ⚠ `project` 作用域**不受本档影响**（它本来就只报健康、不拦推进）。
     */
    if (input.scope.kind !== 'project') {
      const wanted = String(input.scope.id ?? '').trim()
      /**
       * ⚠⚠ **两条豁免，缺一就会误伤历史**（2026-11-08 实测）：
       *   ① `implicit`：`hob_dispatch` **不给 `task`** 时，编排器自己写下的计划用
       *      `taskId: 'implicit'` 占位（`orchestrator.ts` 的 `WP-implicit-…`）。
       *      它不是真实 TSK，⛔ 不能按"账本里没有 ⇒ hold"处理 —— 那会把
       *      所有"没写 task 的老计划"一起判死（真机当场就红：`task:implicit`）。
       *   ② 形如 `TSK-…` / `CHG-…` 这类**账本编号**才做存在性核对；
       *      其余自由文本（用户一句话被当成 task 传下来）**也拦**，因为那正是
       *      "说个东西直接就派活"的入口形态。
       */
      const isPlaceholder = wanted === 'implicit'
      if (!isPlaceholder) {
        const hit = units.find((u) => String((u as unknown as { id?: unknown }).id ?? '').trim() === wanted)
        if (hit === undefined) {
          return {
            decision: 'hold', scope: scopeText, blockers: [], allowedRepairs: [],
            reason: `派活对象 \`${wanted}\` 不在账本里 ⇒ 先按正式阶段把它落成真实单元（需求 → 方案 → 任务），再派。`,
          }
        }
        /**
         * ⚠⚠ **2026-11-08 · 用户报「新的任务没有走阶段流程」：派活只能落在 `task` 上。**
         *
         *   ── 病（实测）────────────────────────────────────────────────────
         *     改前只核"这个 id 在账本里存在"，于是 `R-020` / `CHG-…` / `RUN-056` / `ACC-066`
         *     **都能当任务号派活并放行**：
         *       `dispatchGateAtLedger(root, { taskId: 'R-020' })` ⇒ 放行
         *       `dispatchGateAtLedger(root, { taskId: 'CHG-2026-…' })` ⇒ 放行
         *     ⇒ 用户一句话 → Hob 拿一个需求号/方案号就去派活，**前 3 步等于没走**。
         *
         *   ── 判据 ────────────────────────────────────────────────────────
         *     派活对象必须是 `kind = task` 的单元。
         *     ⚠ 需求 / 方案 / 执行 / 验收**都不是派活对象**：它们各自是正式阶段里的一步，
         *       派活的语义是"把第 3 步拆出来的任务交给执行者"。
         *     ⚠ 这不限制"读"：`read_contracts` 照旧能按任意 ID 读。
         */
        const kind = String((hit as unknown as { kind?: unknown }).kind ?? '').trim()
        if (kind !== 'task') {
          return {
            decision: 'hold', scope: scopeText, blockers: [], allowedRepairs: [],
            reason: `派活对象 \`${wanted}\` 是 ${kind}（不是 task）⇒ 派活只能落在第 3 步拆出的任务上。`
              + ' ⚠ 需求 / 方案 / 执行 / 验收都不是派活对象。',
          }
        }
      }
    }
    return withLedgerProvenance(ledgerRoot, () => evaluateGate({ action: input.action, scope: input.scope, units }))
  } catch {
    return { decision: 'hold', scope: scopeText, blockers: [], allowedRepairs: [] }
  }
}

/** 把结构化判决渲染成一行可读拒绝理由（⛔ 不吞掉 `hold` 与 `return` 的区别）。 */
export function gateMessageOf(d: GateDecision): string | undefined {
  if (d.decision === 'go') return undefined
  if (d.decision === 'hold') {
    /** ⚠ 2026-11-08：有具体原因就说具体原因（⛔ 不再一律"账本读不到或作用域缺 id"）。 */
    if (typeof d.reason === 'string' && d.reason.trim() !== '') return d.reason
    return `阶段门禁判不出（${d.scope}）：账本读不到或作用域缺 id ⇒ 本次不推进。`
  }
  const first = d.blockers.slice(0, 5).map((p) => `${p.rule} · ${p.unit} · ${p.why}`).join('；')
  return `阶段门禁未通过（${d.scope}）：${d.blockers.length} 条缺口（${first}）⇒ 先回查需求 / 方案 / 任务，补齐后再推进。`
}

/** 某任务的作用域链是否干净；供派单 / 判决路径复用（⚠ 只判该链，不判全账本）。 */
export function stageGateOfTask(ledgerRoot: string, taskId: string, action: GateAction = 'write-forward'): string | undefined {
  return gateMessageOf(stageGateAtLedger(ledgerRoot, { action, scope: { kind: 'task', id: taskId } }))
}

/**
 * 项目健康报告：**只报不拦**（它自己不拦单；调用方按用途决定）。
 *
 * ── B1.3（T-02）改了什么 ───────────────────────────────────────────────────
 *   改前走 `stageGateAtLedger({ scope: 'project' })` ⇒ 拿的是 `stageControlProblems`
 *   （**field + approval**，⛔ 无 closure、⛔ 无 shape）⇒ 与 readiness / `/stages`
 *   对同一本账给出不同结论（附录 A-8 的 F1/F3/F4）。
 *   现在直接调唯一判据 {@link ledgerHealthOf}，⛔ 不再经 project 分支。
 *
 * ── 与 T-05 的关系（必须同批）──────────────────────────────────────────────
 *   `repairOf` 命中判据读的正是本函数的 `blockers`：只改它、不改 ① 会让
 *   「修复写认的 blocker」与「推进门禁认的 blocker」继续分叉 ⇒ 死锁换个方向。
 */
export function stageHealthOfLedger(ledgerRoot: string): { ok: boolean; blockers: LedgerHealthProblem[]; message?: string } {
  try {
    const units = readLedgerUnits(ledgerRoot) as StageControlUnit[]
    const health = withLedgerProvenance(ledgerRoot, () => ledgerHealthOf(units))
    return {
      ok: health.problems.length === 0,
      blockers: health.problems,
      ...(health.problems.length === 0 ? {} : {
        message: `账本健康：${health.problems.length} 条全局缺口（不阻塞当前单；逐条见 blockers）`,
      }),
    }
  } catch (e) {
    /** ⚠ 判不出 ⇒ `ok:false`（⛔ 不与「健康」共用 true —— 那正是 T-02 要治的病）。 */
    return { ok: false, blockers: [], message: `账本健康判不出：${String((e as Error)?.message ?? e)}` }
  }
}

/**
 * **派活 / 投递前的作用域门禁**（2026-11-06 · Wave 1 接线）。
 *
 * ── 它替掉什么 ────────────────────────────────────────────────────────────
 *   `hob_send` / `hob_spawn` 原先调 `stageGateOfLedger`（全账本），
 *   ⇒ 别的需求缺一个字段，就把这一条投递也拦下。方案 §4.1 明确要求
 *   「项目作用域只生成健康报告，不作为所有动作的硬阻断」。
 *
 * ── 作用域怎么取（⚠ 顺序即优先级）────────────────────────────────────────
 *   ① 有 `taskId` ⇒ `task` 作用域（只判这条任务链）；
 *   ② 无 taskId、但有活动工作计划 ⇒ `plan` + 计划内各轨任务；
 *   ③ 两者都没有 ⇒ **不硬拦**（只返回健康读数）——
 *      此时"没有对应的计划/任务"本身就是**判不出该判谁**，
 *      ⛔ 不能拿"全账本有缺口"当拒绝理由。
 *
 * ⚠ 判不出账本根 / 账本读不到 ⇒ 仍然 fail-closed（与既有口径一致）。
 */
/**
 * **读一本书的就绪度**（2026-11-08 · 用户裁定「不管旧会话还是空会话，先建账并梳理健康才能推进」）。
 *
 * ⚠ 走 {@link assessLedgerReadiness} 的**同一个纯函数**（⛔ 不在这里另判一份）。
 * ⚠ 读盘失败一律折成 `unhealthy`（带原因），⛔ 不许当成 `ready`。
 */
export function ledgerReadinessOfRoot(ledgerRoot: string | undefined): LedgerReadiness {
  if (ledgerRoot === undefined || ledgerRoot.trim() === '') {
    return assessLedgerReadiness({ unitsDirExists: false })
  }
  const probe = probeFromDirListing({
    ledgerRoot,
    listUnitsDir: () => readdirSync(join(ledgerRoot, 'ledger', 'units')),
    readText: (abs: string) => {
      try { return readFileSync(abs, 'utf8') } catch (e) {
        if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined
        throw e
      }
    },
  })
  return withLedgerProvenance(ledgerRoot, () => assessLedgerReadiness(probe))
}

/**
 * One I/O adapter for ledger lifecycle. The pure verdict lives in
 * `shared/ledger-lifecycle.ts`; this function only supplies filesystem reads.
 */
export function ledgerLifecycleOfRoot(ledgerRoot: string | undefined): LedgerLifecycle {
  const readiness = ledgerReadinessOfRoot(ledgerRoot)
  const probe = probeLedgerLifecycle(ledgerRoot, {
    listUnitsDir: () => ledgerRoot === undefined ? [] : readdirSync(join(ledgerRoot, 'ledger', 'units')),
    readText: (abs) => {
      try { return readFileSync(abs, 'utf8') } catch (e) {
        if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined
        throw e
      }
    },
    join: (root, rel) => join(root, rel),
  })
  /**
   * ⚠⚠ **lifecycle 的"有效/无效"只看结构层**（D-T02-1 选项 C 的落点）。
   *
   *   `assessLedgerReadiness` 的 `canProceed` 现在是**推进层**（结构 + 用户批准）；
   *   而 `assessLedgerLifecycle` 用 `canProceed` 判"这本账还能不能作为当前账本"。
   *   两者直接对接会把「内容齐全、只是还没批」的账本判成 `invalid`
   *   ⇒ `hob_ledger_init` 会对一本**结构完好**的账报 `ledger-invalid`，
   *     用户于是以为账本坏了（这正是 T-02 要消灭的那类假读数）。
   *
   *   ⇒ 这里显式投影：结构层干净 ⇒ 账本有效；"能不能推进"由 G1/G2 闸门回答，
   *     ⛔ 不由 lifecycle 替它回答。
   */
  const lifecycle = assessLedgerLifecycle(probe, {
    ...readiness,
    /**
     * ⚠ **lifecycle 的有效性只看结构层**（D-T02-1 选项 C 的落点）。
     *
     *   `assessLedgerReadiness` 的 `canProceed` / `state` 现在是**推进层**（含用户批准）；
     *   而 `assessLedgerLifecycle` 用它们判"这本账还能不能作为当前账本"。
     *   直接对接会把「内容齐全、只是还没批」的账本判成 `invalid` ⇒ `hob_ledger_init`
     *   会对一本**结构完好**的账报 `ledger-invalid`，用户于是以为账本坏了去重建
     *   —— 这正是 T-02 要消灭的那类假读数。
     *
     *   ⇒ 这里显式投影：结构层干净 ⇒ 账本有效（等价于旧的"结构就绪"语义）；
     *     "能不能推进"由 G1/G2 闸门回答，⛔ 不由 lifecycle 替它回答。
     */
    state: readiness.structurallyReady ? 'ready' : readiness.state,
    canProceed: readiness.structurallyReady,
  })
  /**
   * Index/body consistency is mandatory only for an explicitly activated ledger.
   * Pre-activation ledgers keep the legacy compatible read path and are labelled
   * `legacyCompatible`; they must not be silently rewritten to look new.
   */
  /**
   * ⚠ **判据改成"有激活记录且已激活"，不再要求 `lifecycle.active`**（B1.3 · T-02 副作用修复）。
   *
   *   `ledgerHealthOf` 现在**带 `seenIds`** 查重复 ID（附录 A-3 / LH-3 要求），
   *   于是「同一个 ID 同时出现在 index 与分片」会让 readiness 判 `unhealthy`
   *   ⇒ `assessLedgerLifecycle` 随之给出 `active:false` ⇒ 改前这里的
   *   `lifecycle.active` 前置条件**再也进不来**，A-4（索引/单元源分裂）这条
   *   **具体诊断**被降级成泛化的 S-0「重复 ID」。
   *
   *   ⇒ 分裂检测本来就是**读盘事实**（index 与分片的单元集合），不依赖 readiness 的结论：
   *     只要这本账有激活记录且已激活，就必须跑。⛔ 不许因为上游判了 unhealthy 就跳过诊断。
   */
  /**
   * ── **O-05：A-4 必须对**所有有 index 的账本**跑，⛔ 不只是已激活的** ──────────
   *
   * ⚠ 改前条件是 `lifecycle.activation === 'active'`。而**现行真实账本没有 ledger.toml**
   *   （实测 `dsh-hob` 账本根：`ls ledger.toml` 不存在）⇒ `activation = 'missing'`
   *   ⇒ **A-4（索引与单元源一致性）从不执行**。
   *
   * ⚠ 后果：`index.toml` 与分片不一致时，**没有任何一处会报**。
   *   而这类不一致正是 T-01 的形态（同一批单元在两个地方各存一份）。
   *
   * ⚠ **为什么放宽是安全的**：A-4 是**只读诊断**，不改账本、不阻止写入；
   *   它只在**发现真不一致**时把 lifecycle 标 `invalid`。
   *   ⇒ 对 legacy 账本跑它，最坏结果是**多报一个真实问题**，不会误伤。
   *
   * ⛔ 不要改成「无条件跑」：`probe.indexText === undefined` 时没有可比对的基准，
   *   跑它只会得到 `ENOENT` —— 那是「还没开账」，不是「不一致」。
   */
  if (probe.indexText !== undefined && (lifecycle.activation === 'active' || lifecycle.legacyCompatible || lifecycle.activation === 'missing')) {
    try {
      const unitsDir = join(ledgerRoot!, 'ledger', 'units')
      /**
       * ⚠ **不再吞解析失败**（O-33 第二处实例）：坏分片直接抛到下面的 catch
       *   ⇒ 账本落 `state:'invalid'` + `A-4` blocker（账本坏了就不该 active）。
       *   这里**刻意不保留** `catch { return [] }` —— 那会把"整片读不出来"读成"这篇没有单元"。
       */
      const parseOne = (name: string): Array<Record<string, unknown>> =>
        parseUnitsToml(readFileSync(join(unitsDir, name), 'utf8')) as unknown as Array<Record<string, unknown>>
      const indexUnits = parseOne('index.toml')
      const shardNames = readdirSync(unitsDir).filter((n) => /^unit-[^/]+\.toml$/.test(n)).sort()
      const shardUnits = shardNames.flatMap(parseOne)
      const split = indexIntegrityProblems(indexUnits, shardUnits)
      if (split.length > 0) {
        return {
          ...lifecycle, state: 'invalid', integrity: 'invalid', active: false,
          headline: `账本索引与单元源不一致（${split.length} 条）`,
          nextAction: '归档旧账并按模板重建；修单份索引不是可靠的继续路径。',
          blockers: [...lifecycle.blockers, ...split],
        }
      }
    } catch (e) {
      return { ...lifecycle, state: 'invalid', integrity: 'invalid', active: false,
        headline: '账本索引一致性判不出', nextAction: '先恢复可校验的账本快照，再推进。',
        blockers: [...lifecycle.blockers, { rule: 'A-4', unit: 'ledger/units/index.toml', why: String((e as Error)?.message ?? e) }] }
    }
  }
  return lifecycle
}

export function dispatchGateAtLedger(
  ledgerRoot: string,
  opts: { taskId?: string; planId?: string } = {},
): { blocked: string | undefined; health: { ok: boolean; blockers: GateDecision['blockers'] } } {
  /**
   * ⚠⚠ **第一道：账本先得能推进**（2026-11-08 · 用户裁定）。
   *
   *   用户原话：「没有账本的项目必须先建立账本才能推进任务」「不管是旧的还是空的 hob 会话
   *   在工作之前必须把账本建立梳理健康才能推进任务」。
   *
   *   ⚠ 改前这一档是**漏的**，三处实测：
   *     · `Mana`（没建账）+ 不给 `task` ⇒ **放行**
   *     · `prompt-enhancer-release`（旧格式账本）⇒ **放行**
   *     · `dsh-hob`（真账本）+ 不存在的任务号 ⇒ **放行**（见 `stageGateAtLedger` 那条补丁）
   *   ⇒ 「先建账」曾经只是文档里的规定，**运行时不拦**。
   *
   *   ⚠ 本档与作用域无关：**任何派活都先过它**，然后再看具体任务链。
   *   ⛔ 不许把它降级成"只报健康"—— 那等于回到改前。
   */
  const readiness = ledgerReadinessOfRoot(ledgerRoot)
  const lifecycle = ledgerLifecycleOfRoot(ledgerRoot)
  /** Empty ledgers may accept the first requirement but never a dispatch. */
  const emptyLedger = lifecycle.integrity === 'empty' && lifecycle.state === 'active'
  if (!lifecycle.active) {
    return {
      blocked: `账本不能作为当前账本推进：${lifecycle.headline} ⇒ ${lifecycle.nextAction}`
        + (lifecycle.blockers.length === 0 ? '' : `（${lifecycle.blockers.slice(0, 3).map((b) => `${b.rule} · ${b.unit}`).join('；')}）`),
      health: { ok: false, blockers: [] },
    }
  }
  if (lifecycle.integrity === 'empty' && String(opts.taskId ?? '').trim() === '') {
    return { blocked: undefined, health: { ok: false, blockers: [] } }
  }
  if (emptyLedger && String(opts.taskId ?? '').trim() !== '') {
    return { blocked: '账本已建但还没有需求链 ⇒ 先落第一条需求并取得 G1 批准，再派任务。', health: { ok: false, blockers: [] } }
  }
  const taskId = String(opts.taskId ?? '').trim()
  if (taskId !== '') {
    const d = stageGateAtLedger(ledgerRoot, { action: 'dispatch', scope: { kind: 'task', id: taskId } })
    /**
     * Pipeline v3 downstream lock.
     *
     * The legacy scope gate answers field/relationship validity. It does not
     * prove that the user approved the requirement or the plan. Read the whole
     * ledger once and check the task's actual upstream chain here.
     */
    try {
      const units = readLedgerUnits(ledgerRoot) as StageControlUnit[]
      const task = units.find((u) => String(u.id ?? '').trim() === taskId)
      if (task !== undefined) {
        const p = withLedgerProvenance(ledgerRoot, () => pipelineDispatchProblems(units as any, task as any))
        if (p.length > 0) {
          return {
            blocked: `Pipeline v3 门禁未通过：${p.map((x) => `${x.rule} · ${x.unit} · ${x.why}`).join('；')}`,
            health: { ok: false, blockers: d.blockers },
          }
        }
      }
    } catch (e) {
      return {
        blocked: `Pipeline v3 门禁判不出（${String((e as Error)?.message ?? e)}）⇒ 本次不派单。`,
        health: { ok: false, blockers: d.blockers },
      }
    }
    return {
      blocked: gateMessageOf(d),
      health: { ok: d.decision === 'go', blockers: d.blockers },
    }
  }
  let plans: Array<{ plan?: { planId?: string; tracks?: Array<{ taskId?: string }> } }> = []
  try { plans = listWorkPlans(ledgerRoot).filter((row) => row.state === 'ok') as typeof plans } catch { plans = [] }
  const wantedPlan = String(opts.planId ?? '').trim()
  const plan = wantedPlan === ''
    ? plans[0]
    : plans.find((row) => String(row.plan?.planId ?? '') === wantedPlan)
  if (plan?.plan !== undefined) {
    const tasks = (plan.plan.tracks ?? []).map((t) => String(t.taskId ?? '')).filter((x) => x !== '')
    let units: StageControlUnit[]
    try {
      units = readLedgerUnits(ledgerRoot) as StageControlUnit[]
    } catch (e) {
      return {
        blocked: `Pipeline v3 门禁判不出（${String((e as Error)?.message ?? e)}）⇒ 本次不派单。`,
        health: { ok: false, blockers: [] },
      }
    }
    for (const id of tasks) {
      /**
       * `implicit` is the orchestrator's legacy placeholder for "no task id".
       * It creates no ledger RUN and has no v3 upstream chain to verify, so it
       * follows the existing scope gate only. This does not widen dispatch:
       * free text and any other non-existent TSK still fail closed.
       */
      if (id === 'implicit') {
        const d = stageGateAtLedger(ledgerRoot, { action: 'dispatch', scope: { kind: 'task', id } })
        if (d.decision !== 'go') {
          return { blocked: gateMessageOf(d), health: { ok: false, blockers: d.blockers } }
        }
        continue
      }
      /**
       * Multi-track dispatch must pass the same upstream gate as a single task.
       * The scope gate alone does not prove G1/G2 or v3 enrollment.
       */
      const task = units.find((u) => String(u.id ?? '').trim() === id)
      if (task === undefined) {
        return { blocked: `Pipeline v3 门禁：计划轨道里的 ${id || '(空)'} 不是账本里的真实任务。`, health: { ok: false, blockers: [] } }
      }
      const p = withLedgerProvenance(ledgerRoot, () => pipelineDispatchProblems(units as any, task as any))
      if (p.length > 0) {
        return {
          blocked: `Pipeline v3 门禁未通过：${p.map((x) => `${x.rule} · ${x.unit} · ${x.why}`).join('；')}`,
          health: { ok: false, blockers: [] },
        }
      }
      const d = stageGateAtLedger(ledgerRoot, { action: 'dispatch', scope: { kind: 'task', id } })
      if (d.decision !== 'go') {
        return { blocked: gateMessageOf(d), health: { ok: false, blockers: d.blockers } }
      }
    }
    return { blocked: undefined, health: { ok: true, blockers: [] } }
  }
  /** ③ 无任务、无活动计划 ⇒ 只报健康，⛔ 不拿全局缺口当拒绝理由。 */
  const h = stageHealthOfLedger(ledgerRoot)
  return { blocked: undefined, health: { ok: h.ok, blockers: h.blockers } }
}

/**
 * **验收门禁**（2026-11-06 · Wave 1）：按账本真实 ACC 单元判 `accept` 能不能落账。
 *
 * 判据：
 *   ① 账本里必须有 `acc` 单元，且 `parent = taskId`；
 *   ② 该 ACC 必须已 `pass`（退回中的任务不能被"验收"）；
 *   ③ 判据走 `acceptanceProblems`（同一份纯函数），因此独立会话 / 证据 / 例子结果缺一不可；
 *   ④ `actor` 与 `acceptance_session` 必须**不同**于该任务的 `built_by`。
 *
 * ⚠ 判不出（账本读不到 / 找不到 ACC）⇒ 拒绝，⛔ 不把"没有验收单元"当成"验收通过"。
 */
export function acceptanceGateOfLedger(
  ledgerRoot: string,
  taskId: string,
): { ok: boolean; reason?: string } {
  try {
    const units = readLedgerUnits(ledgerRoot) as StageControlUnit[]
    const accs = units.filter((u) => u.kind === 'acc' && String(u.parent ?? '').trim() === taskId)
    if (accs.length === 0) {
      return { ok: false, reason: `拒绝：账本里没有挂在 ${taskId} 下的验收单元 ⇒ 回传不等于验收。` }
    }
    const passed = accs.filter((u) => String(u.status ?? '').trim() === 'pass')
    if (passed.length === 0) {
      return { ok: false, reason: `拒绝：${taskId} 没有 status=pass 的验收单元（当前：${accs.map((u) => `${u.id}=${u.status}`).join(' / ')}）。` }
    }
    const problems = withLedgerProvenance(ledgerRoot, () => passed.flatMap((u) => acceptanceProblems(u, units)))
    if (problems.length > 0) {
      const first = problems.slice(0, 5).map((p) => `${p.rule} · ${p.unit} · ${p.why}`).join('；')
      return { ok: false, reason: `验收门禁未通过：${problems.length} 条缺口（${first}）` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: `验收门禁判不出：账本读不到（${String((e as Error)?.message ?? e)}）` }
  }
}

export { gateScopeUnits }

/** @deprecated v4 起账本已迁出工作区，账本位置改由 {@link ledgerRootOf} 解析。 */
/**
 * **可注入的依赖缝**（2026-10-10 第 44 轮 · 结构改造②）—— 让"写入即投递"
 * 能在**不启宿主**的前提下被机检真跑（机检传**假编排**；真机由 `preset/tools.ts` 传真服务）。
 *
 * ⚠ 为什么用注入而不是让本模块直接 `ctx.get('hobOrchestrator')`：
 *   本模块**没有 ctx**（工具定义工厂是纯函数，定义在模块作用域、注册在预设作用域）。
 *   编排服务在**预设作用域**才可见 ⇒ 由挂载方（`registerTools`）把它传进来，
 *   与 `ledgerRootOf` 交给 bus 层是**同一条纪律**（一处解析、传函数/服务，不各写一份）。
 *
 * ⚠ **缺省 = 不投递**（`orchOf` 不给 ⇒ 只记账）：fail-closed，不猜、不装作投了。
 *   这不是"功能降级静默" —— 返回值里会如实带 `deliverReason`。
 */
export interface HobToolsDeps {
  /** 按执行上下文取编排服务（`hob_dispatch` 的同一条路径）。缺席 ⇒ 不投递。 */
  orchOf?: (exec: ToolRunContext) => DispatchLike | undefined
  /**
   * **现读**当前可读权限控制的档位（`ledger` / `project` / `workspace` —— 内部取值）。
   *
   * ⚠ 必须是**函数**（不是值）：档位可以**随时改**（volatile 值型配置，改完即生效），
   *   若在 `createHobTools` 时读一次存起来，就成了"装配期快照"——
   *   用户改完档位后**已开的会话仍按旧档**走到重挂载为止。
   *   ⇒ 四个读工具在**每次 execute** 时调它（与 `src/preset/tools.ts` 的
   *   装配期过滤"现读档位"是同一口径）。
   *
   * 缺席 / 抛异常 / 返回值不是三档之一 ⇒ 按**最保守**的 `ledger` 处理（fail-closed）。
   */
  levelOf?: (exec?: ToolRunContext) => string
  /**
   * ⚠ **该档允许的工具名集合**（2026-10-22 · `REQ-04`）。
   *
   * ── 为什么必须注入而不是本模块自己判 ─────────────────────────────────
   *   本模块是**工具定义层**，⛔ 不知道"哪一档有哪些名字" —— 那是**预设的权限面**
   *   （`src/preset/tools.ts` 的 `PERMISSION_TIERS`）。在这里再抄一份必然漂。
   *   ⇒ 由挂载方（`registerTools`）把**唯一来源**的那个查表函数传进来。
   *
   * ⚠ 缺席 / 抛异常 ⇒ 空数组 ⇒ **什么都不许读**（fail-closed）。
   * ⚠ 这是 G-5 的落点：即使宿主的 scope guard 被跳过（无 agent），
   *   本层也按名字集把"这一档本来就没有的刀"挡住。
   */
  tierNamesOf?: (level: string) => readonly string[]
  /**
   * ⚠⚠ **"这次能不能推进"的执行层闸门**（2026-10-22 第 5 轮 · 任务书第 12 条）。
   *
   * ── 为什么必须在这里、而不只是提示词 ──────────────────────────────────
   *   上一轮 `mayProceed=false` 只体现在**注入的那段文字**里（告诉模型别推进）。
   *   ⚠ 但提示词**不是边界**：模型仍可强行点名 `write_hob` / `hob_dispatch` /
   *     `hob_spawn`；而 `policyOf` 当时对"缺服务/缺字段"还默认 `true`。
   *   ⇒ 任务书要求：**在真实派活 / 会话创建 / 账本写这三处执行层作硬拒**，
   *     且"强制点名调用也不能绕"（那就是本闸门 —— 它在 `execute` 里，晚于一切参数校验）。
   *
   * ── 语义（⚠ 与 `mayProceed` 同一份事实，⛔ 不另判一份）──────────────────
   *   返回 `undefined` ⇒ 放行；返回**字符串** ⇒ 拒绝理由（直接回给模型）。
   *   ⚠ **非 Hob 会话必须放行**（本机制不参与别人）：判据在注入方，
   *     这里只看它给不给理由。
   *   ⚠ 只读工具（`hob_read_doc`/`hob_glob`/`hob_grep`/`hob_read_image`/
   *     `hob_orch_status` 等）**不走这道门** —— 允许只读诊断（任务书原文）。
   */
  proceedGateOf?: (exec: ToolRunContext) => string | undefined
  /**
   * 把图片字节**存成附件**并取回引用（`hob_read_image` 用）。
   *
   * ⚠ 为什么是注入而不是本模块直接 `ctx.get('attachments')`：与 `orchOf` 同一理由
   *   —— 本模块**没有 ctx**（工具定义是纯函数，定义在模块作用域、注册在预设作用域）。
   *   实测（第 144 轮）：`attachments` 由宿主平面 provide，**预设作用域取得到**，
   *   故由 `registerTools` 把 `ctx.get('attachments').saveImage` 绑好传进来。
   *
   * ⚠ 缺席 ⇒ `hob_read_image` **照常注册**，但调用时如实返回"没有附件服务"
   *   （fail-closed：不假装图片已交给模型）。
   */
  saveImage?: (input: { data: Uint8Array; mediaType: string; name: string }) => Promise<{
    attachmentId: string
    mediaType: string
    bytes: number
    width: number
    height: number
    name?: string
  } | undefined>
  /**
   * 可选：账本 handoff 持久队列。
   * ⚠ 缺席 ⇒ 完全保持旧行为；有它时，投递失败会留下可恢复 effect。
   */
  handoffEffectsOf?: (ledgerRoot: string) => EffectsQueue | undefined
}

/**
 * 取本会话 id（= 调工具的 agent 自己）。
 *
 * ⚠ 与 `orchestrator.ts` 的 `selfSessionIdOf` **同源**（两处都要"我是谁"）：
 *   它用于编排层的"不派给自己"那道闸。⚠ 不复用不 import —— 那会造出
 *   `tools.ts ↔ orchestrator.ts` 的依赖方向问题（工具层不该 import 编排实现）；
 *   两行判据，照抄并在两侧互相指名（同 `ARCHIVE_DIR_RE` 的口径）。
 */
function sessionIdOf(exec: any): string | undefined {
  const id = exec?.agent?.id ?? exec?.agent?.session?.id
  return typeof id === 'string' && id !== '' ? id : undefined
}

/**
 * ⚠⚠ **「首次铺骨架」开关的权威读取器**（2026-10-24 · 本单必修 3）。
 *
 * ── 为什么它必须是**模块级**的一个槽，而不是 `apply` 里的一个局部闭包 ─────────
 *   消费点在 {@link createHobTools}（**纯函数工厂**，模块作用域），它拿不到 `apply`
 *   的 ctx；而 `apply` 是唯一能看到**插件入口配置**的地方（见 `pluginEntryConfigOf`）。
 *   ⇒ 用一个模块级可写槽把"权威读取器"传下去。
 *
 * ── ⚠ 模块级可变状态的边界（⛔ 不许扩大）───────────────────────────────
 *   · 存的**不是值**，是一个**函数**（每次调用现解 ref）⇒ 设置页改完即生效；
 *   · 只由 {@link apply} 写一次；`createHobTools` 只在**调用时**读它；
 *   · 卸载时**不清空**：清了反而会让"卸载后残留的旧工具定义"回退到"永远 true"，
 *     而那种残留本就不该被执行（工具注册随 fiber 一起拆）。⚠ 这是**有意**的取舍，
 *     写在这里免得后人以为是漏了清理。
 */
/**
 * 取**插件入口条目**（`id: dsh-hob`）的已解配置对象。
 *
 * ⚠ 怎么取（实测过的链，不是猜的）：
 *   `apply` 的 ctx 是**本模块 fiber 的 ctx**；cordis 把 `fiber` mixin 到每个 ctx 上
 *   （`@deepseek-ai/cordis/lib/index.js` 的 `this.mixin("fiber", ["runtime", "effect"])`），
 *   而 `fiber.parent` 是**父 ctx**、`fiber.parent.fiber` 是**父 fiber** —— 在本插件里
 *   父 fiber 就是入口条目那个 fiber，它的 `config` 正是带 `skeleton.enabled` 的插件配置。
 *   实测（`scripts/` 外的探针，真 `Context`）：本模块 fiber 的
 *   `parent.fiber.config.skeleton.enabled` 在 `skeleton.enabled=false` 时解出 `false`、
 *   在 `true` 时解出 `true`（双向读数在交付报告里）。
 *
 * ⚠ **取不到就返回 `undefined`**（⛔ 不猜、⛔ 不编一个 `{}`）：
 *   机检/夹具直接 `createHobTools(...)` 时不跑 `apply` ⇒ 这条链根本不存在 ⇒
 *   退回 `deps.skeletonEnabledOf`（既有行为）。判据是「取不到 ≠ 关掉」。
 *   ⚠ 上面的权威读取器（`configFace.skeletonEnabled`）**已退役**（O-14），
 *     所以现在**只剩**注入这一条路 —— 即「取不到就用注入值」，没有用户开关。
 */
export function pluginEntryConfigOf(ctx: any): unknown {
  try {
    const parentFiber = ctx?.fiber?.parent?.fiber
    const cfg = parentFiber?.config
    return cfg !== undefined && cfg !== null && typeof cfg === 'object' ? cfg : undefined
  } catch {
    return undefined
  }
}

/**
 * 工具定义工厂 —— **两个工具的唯一实现处**。
 *
 * 返回 `{ readContracts, writeHob }` 两个 `defineTool` 结果（写工具在
 * `enableWrite === false` 时为 `undefined`，即"根本不出现"）。
 * 调用方（预设行模块）负责在**正确的（预设）作用域**里注册它们。
 *
 * @param cfg - 该挂载点的配置（预设行传入）。
 * @param deps - 可注入依赖（缺省 = 无编排服务 ⇒ 只写不投）。
 */
export function createHobTools(cfg: HobToolsConfig = {}, deps: HobToolsDeps = {}): {
  readContracts: ReturnType<typeof defineTool>
  writeHob: ReturnType<typeof defineTool> | undefined
  readWorkspaceDoc: ReturnType<typeof defineTool>
  globWorkspace: ReturnType<typeof defineTool>
  grepWorkspaceTool: ReturnType<typeof defineTool>
  readWorkspaceImage: ReturnType<typeof defineTool>
  /**
   * **账本就绪度（只读）**（2026-11-08 · 用户裁定「先建账并梳理健康才能推进」）。
   * ⚠ 它与派活门禁**共用同一个纯函数**，⛔ 不是第二次判断。
   */
  ledgerStatus: ReturnType<typeof defineTool>
  /** **建账本 / 补齐**（2026-11-08 · 用户裁定「预设本身要具备这个能力」）。 */
  ledgerInit: ReturnType<typeof defineTool>
  /** **旧 kind/status 词迁移**（内置有限映射，默认预演）。 */
  ledgerMigrate: ReturnType<typeof defineTool>
  ledgerApprove: ReturnType<typeof defineTool>
  /** Archive an invalid ledger and initialise an empty current one. */
  ledgerArchiveRebuild: ReturnType<typeof defineTool>
} {
  const readContracts = defineTool({
    name: 'read_contracts',
    description: '只读本工作区账本内的 .md / .toml（项目方案/决策记录/工作上下文/账本索引），或按稳定 ID 读取全部账本资源（goal/G-…、requirement/R-…、change/CHG-…、task/TSK-…、run/RUN-…、acceptance/ACC-…、evidence/EVD-…、risk/RSK-…、decision/DEC-…、capability/CAP-…）。',
    parameters: {
      path: {
        type: 'string',
        required: true,
        // ⚠ 2026-10-10（UD-88 / CHG-025）：原文写「相对**工作区根目录**…如 README.md、PROJECT.md」
        //    ——**两处都不实**：解析根**一直是账本区**（v4 / D7），工作区根本读不到（D6）；
        //    而 `PROJECT.md` 也**已于本批移入账本区**。⇒ 改准：根 = 账本区，示例换成账本区里真实存在的文件。
        description: '相对**账本区根目录**的 .md / .toml 路径（如 PROJECT.md、ledger/spec/current.md），或资源读取路径（如 requirements/、goal/G-01、risk/RSK-001、decision/DEC-001、capability/CAP-01、task/TSK-061/children）。',
      },
    },
    output: {
      // ⚠ **结构化输出**（照 `write_hob` 的模式）：成功给 `{ok:true, ...}`，
      //   失败给 `{ok:false, reason, message}` ⇒ **原因取得到**（D-4 的判据）。
      //   ⚠ 根用 `json` 而不是 `object`：成功时带 `truncated` / `bytes` / `text`，
      //     由 `render` 决定实际块形状（与 `hob_read_image` 取同一档口径）。
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => {
        const v = value as { ok?: boolean; text?: string; message?: string }
        // ⚠ 成功 ⇒ 正文原样给模型（**行为与改前一致**：正文仍是它读到的那一份）。
        //   失败 ⇒ 给对外那句 `message`（⚠ 与改前的 `r.text` **同一句**）。
        return [{ type: 'text', text: v.ok === true ? String(v.text ?? '') : String(v.message ?? '') }]
      },
    },
    async execute(args: { path: string }, exec: ToolRunContext): Promise<JsonValue> {
      // v4：边界改为**账本目录**（D7）—— 只读自己的账本，不读工作区内的项目文档（D6）。
      const root = ledgerRootOf(cfg, exec)
      if (root === undefined) {
        return { ok: false, reason: 'no-ledger-root', message: '拒绝：无法确定账本目录。' }
      }
      /**
       * ⚠ **资源语法先于文件路径**：`requirements/`、`task/TSK-…` 等不是文件路径，
       * 它们必须在同一个只读边界内解析为账本资源图。
       * ⛔ 不把它们当作工作区文件；⛔ 不新增写路径。
       */
      if (looksLikeResource(args.path)) {
        try {
          const units = readLedgerUnits(root)
          const r = readLedgerResource(units, args.path)
          return { ok: r.ok, text: JSON.stringify(r, null, 2), truncated: false, bytes: 0 }
        } catch (e) {
          return { ok: false, reason: 'resource-unreadable', message: `账本资源读取失败：${String((e as Error)?.message ?? e)}` }
        }
      }
      const r = await readMarkdownCapped(root, args.path, cfg.maxFileBytes ?? DEFAULTS.maxFileBytes)
      if (r.ok) {
        return { ok: true, text: r.text, truncated: r.truncated, bytes: r.bytes }
      }
      // ⚠ ⚠ **对外文案仍同一句**（`r.text`，即 `DENIED` 那族）——
      //   ⛔ 不把"不存在"与"不允许"拆成两句：不泄露存在性是**有意的**安全考量。
      //   ⚠ 要修的是**"原因取不到"** ⇒ 把 `doc-read` 已经算出来的 `reason` **传出去**。
      return {
        ok: false,
        reason: r.reason ?? 'read-error',
        message: r.text,
      }
    },
  })

  // ── 可读权限控制的**读能力**四个工具（2026-10-14 第 144 轮；2026-10-17 改名）─────
  //   ⚠ **为什么这四个在这里定义、却由预设行注册**：与 `read_contracts` 同一条分层
  //     —— 工具**定义**在本模块（可被机检直接 import 真跑），**注册**在预设作用域
  //     （`src/preset/tools.ts` 的 `registerTools`），因为"哪些档看得见"是预设的权限面。
  //
  //   ⚠ **档位必须"现读"**：`deps.levelOf()` 在**每次 execute 时**调，
  //     ⛔ **不许**在 `createHobTools` 时读一次存起来 —— 那会让"改档位不必重启"
  //     变成"改档位要重挂载"（本项目第 143 轮设计 §a 的反例）。
  //
  //   ⚠ **写类工具不在这里**：本模块只定义**只读**工具；写类 / 命令类的名字
  //     在三档里都不存在（不声明 + 不注册），见 `src/preset/tools.ts` 的三档表与哨兵。
  const levelNow = (exec?: ToolRunContext): string => {
    try {
      const v = deps.levelOf?.(exec)
      return typeof v === 'string' && v !== '' ? v : 'ledger'
    } catch {
      // ⚠ 判不出档位 ⇒ 按**最保守**的档处理（与 `doc-read.ts` 的 fail-closed 同口径）。
      return 'ledger'
    }
  }

  /**
   * ⚠⚠ **本层读档门**（2026-10-22 · `REQ-04` 的 G-5 落点）。
   *
   * ── 为什么每把刀都要自己再核一次（⛔ 不是重复劳动）─────────────────────
   *   改前三个工具（`hob_glob` / `hob_grep` / `hob_read_image`）**只在武器架与哨兵上被挡**：
   *   · 模型面过滤 —— 只管"看不见"；
   *   · `tools/pre-execute` —— 挂在**预设作用域**上，`scopeTarget(this, exec.agent)` 对
   *     **没有 agent 的执行**把事件送不到（`dsh-scope/lib/index.js:327-337`）；
   *   · `ctx.tools.guard` —— 宿主在 `exec.agent === undefined` 时**直接 `return undefined`**
   *     （`dsh-tools/lib/index.js:3027`）⇒ **整条 scope 链的哨兵一条都不跑**。
   *   ⇒ 三条路都有"没身份就静默放行"的形态 ⇒ **必须在工具自己的 `execute` 里兜住**：
   *     没有可信身份 / 档位读不到 ⇒ **拒读工作区**（⛔ 不回退到任何全局宽档）。
   *
   * ── 返回什么 ────────────────────────────────────────────────────────
   *   允许 ⇒ `undefined`；拒绝 ⇒ **一句可读的拒绝文本**（调用方直接回给模型）。
   *
   * @param exec - 本次执行的宿主上下文（⚠ 身份只在 `exec.agent` 里）。
   * @param toolName - 工具名（用于拒绝文案，⚠ 不参与判定）。
   */
  const workspaceGate = (exec: ToolRunContext, toolName: string): string | undefined => {
    /**
     * ⚠⚠ **身份门在最前**（`REQ-04` 的硬要求，⛔ 不能只靠 `levelNow` 的返回值）。
     *
     * ── 为什么必须先判身份 ─────────────────────────────────────────────
     *   `levelNow(exec)` 走 `deps.levelOf(exec)` ⇒ 策略服务 ⇒ 无身份时它**恰好**回
     *   `ledger`（fail-closed）。但那只是"当前实现恰好保守"：
     *   ① 将来任何一次 `levelOf` 注入写错 / 被替换成旧全局闭包 ⇒ 返回 `workspace`；
     *   ② 宿主在 `exec.agent === undefined` 时**压根不跑 scope guard**
     *      （`dsh-tools/lib/index.js:3027`），预执行监听器也送不到（无 scope key）。
     *   ⇒ 那时"没有身份"就变成"按宽档读工作区"——正是任务书点名要堵的那条路。
     *   ⇒ 本门**自己**判身份：没有可信 agent / session.id ⇒ **一律拒**，与档位无关。
     *
     * ⚠ "可信" = `exec.agent.session.id` 是非空字符串（宿主保证 `agent.id === session.id`，
     *   见 `dsh-agent/lib/index.js:514`）。⛔ 不接受"只有 agent 对象、没有 id"的形态。
     */
    const sid = (() => {
      try {
        const v = exec?.agent?.session?.id ?? exec?.agent?.id
        return typeof v === 'string' && v !== '' ? v : undefined
      } catch { return undefined }
    })()
    if (sid === undefined) {
      return `拒绝：本次调用**没有可信会话身份** ⇒ ${toolName} 不读工作区`
        + '（⚠ 无身份的调用不受会话策略约束，按最保守处理：拒绝而不是照旧读）。'
    }
    const level = levelNow(exec)
    /**
     * ⚠⚠ **判据 = 该工具名是否在**这个档的名字集**里**（⛔ 不是"档不低就放行"）。
     *
     * 改前（本函数第一版）只挡 `ledger` ⇒ `project` 档下 `hob_glob` 仍能列代码目录
     * —— **`hob_glob` 本来就不在 `project` 档的名字集里**（只有 `hob_read_doc` 在）。
     * 那次是负向样本（SP-6d）咬出来的，不是想当然。
     * ⇒ 现在与 `src/preset/tools.ts` 的 `PERMISSION_TIERS` **同一份事实**：
     *   名字集没有它 ⇒ 这一档**不该**读工作区。⚠ 单一来源，⛔ 不在这里再抄一份清单。
     */
    const names = deps.tierNamesOf?.(level) ?? []
    if (!names.includes(toolName)) {
      const label = level === 'ledger' ? '「账本权限」' : level === 'project' ? '「文档权限」' : '「完全权限」'
      return `拒绝：本会话的可读范围是${label} ⇒ ${toolName} 不在这一档的工具面里`
        + '（⚠ 这是**本会话自己的**档位，不随全局设置变；要读请在创建/该会话策略里选更宽的档）。'
    }
    return undefined
  }

  /**
   * ⚠⚠ **执行层"能不能推进"闸门**（2026-10-22 第 5 轮 · 任务书第 12 条）。
   *
   * 在**改变项目的动作**（本模块里 = `write_hob` 的**真写**）之前调一次。
   * ⚠ 判据来自注入方（它读逐会话策略的唯一权威），本模块⛔ 不自己判。
   * ⚠ 出错方向：**闸门自己抛错 ⇒ 拒绝**（这是边界，不是收敛措施 ——
   *   与 `enforceToolAllowlist` 的 fail-open 取向相反，理由同 `installPermissionGuard`）。
   * ⚠ `dryRun` **不受**本闸门限制（只读预演，不改变任何东西）——
   *   否则用户连"看看会写成什么样"都做不到。
   */
  const proceedGate = (exec: ToolRunContext): string | undefined => {
    try {
      return deps.proceedGateOf?.(exec)
    } catch (e) {
      return `拒绝：无法确认本会话的原「推进工作方式」（闸门抛错：${String((e as Error)?.message ?? e)}）`
        + ' ⇒ 本动作不执行（⛔ 不拿不可信的方式去改项目）'
    }
  }

  const workspaceRootOf = (exec: ToolRunContext): string | undefined => rootOf(cfg, exec)
  const maxReadBytes = cfg.maxFileBytes ?? DEFAULTS.maxFileBytes

  const readWorkspaceDoc = defineTool({
    name: 'hob_read_doc',
    description:
      '只读本工作区内的文件（⛔ 不能写、不能改）。'
      + '⚠ 可读范围**随可读权限档位变**：'
      + '「文档权限」档**只可读 .md**；「完全权限」档**工作区内任意文件都可读**（含代码与图片），'
      + '但仍' + CAPABILITY_RED_LINE_ZH + '。越出工作区、软链一律拒绝。'
      + '⚠ 二进制 / 非 UTF-8 ⇒ 只给一句短提示（⛔ 不吐乱码）；图片 ⇒ 改用 hob_read_image。'
      + `⚠ 大文件会被截断并在尾部标注（上限 ${maxReadBytes} 字节）；需要后续内容用 offset/limit 分段读。`,
    parameters: {
      path: { type: 'string', required: true, description: '工作区内的路径（相对或绝对），如 src/config.ts' },
      offset: { type: 'integer', description: '起始行（1 基，缺省 1）。' },
      limit: { type: 'integer', description: '最多返回多少行（缺省 = 不按行切）。' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: { path: string; offset?: number; limit?: number }, exec: ToolRunContext): Promise<string> {
      // ⚠ 本层读档门（G-5）：`ledger` 档 / 无身份 ⇒ 不读工作区（⛔ 不看全局值）。
      const gate = workspaceGate(exec, 'hob_read_doc')
      if (gate !== undefined) return gate
      const root = workspaceRootOf(exec)
      if (root === undefined) return '拒绝：无法确定工作区目录。'
      const r = await readWorkspaceText(root, args.path, maxReadBytes, levelNow(exec), args.offset ?? 1, args.limit ?? 0)
      return r.text
    },
  })

  const globWorkspace = defineTool({
    name: 'hob_glob',
    description:
      '只列本工作区内的**文件路径**（⛔ 不读正文、不能写）。用于找文件 / 摸清目录结构。'
      + '⚠ 跳过 .git / node_modules / dist 等目录；软链不跟随；结果有上限。',
    parameters: {
      pattern: { type: 'string', required: true, description: 'glob 模式（相对工作区根），如 **/*.ts、docs/*.md。' },
      limit: { type: 'integer', description: '最多返回多少条（缺省 200）。' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: { pattern: string; limit?: number }, exec: ToolRunContext): Promise<string> {
      // ⚠⚠ 本层读档门（G-5 的**核心**）：改前这把刀**完全没有**档位判断，
      //   直接 execute 在 `ledger` 档照样列出工作区路径（前轮实测已证）。
      const gate = workspaceGate(exec, 'hob_glob')
      if (gate !== undefined) return gate
      const root = workspaceRootOf(exec)
      if (root === undefined) return '拒绝：无法确定工作区目录。'
      const r = await globWorkspacePaths(root, args.pattern, args.limit ?? 200)
      return r.text
    },
  })

  const grepWorkspaceTool = defineTool({
    name: 'hob_grep',
    description:
      '在本工作区里按正则搜索，返回**命中行**（⛔ 只读、不能写）。'
      + '⚠ **9 类目录不搜**（.git / node_modules / .venv / venv / __pycache__ / dist / build / .next / coverage），'
      + '且**超过 512KB 的文件跳过**；故"没命中"不等于"工作区里没有"。'
      + '⚠ 读不成文本的文件（二进制 / 非 UTF-8）也会跳过，并在结果里注明跳过了几个。'
      + '⚠ 单文件与总量都有上限，被截断时会明说；软链不跟随。',
    parameters: {
      pattern: { type: 'string', required: true, description: '正则源（大小写敏感），如 TODO|FIXME。' },
      path: { type: 'string', description: '限定子路径（缺省 = 整个工作区）。' },
      limit: { type: 'integer', description: '最多返回多少条命中（缺省 200）。' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: { pattern: string; path?: string; limit?: number }, exec: ToolRunContext): Promise<string> {
      // ⚠⚠ 本层读档门（G-5）：改前这把刀也**没有**档位判断，直接 execute 在
      //   `ledger` 档能搜出工作区正文（前轮实测已证）。
      const gate = workspaceGate(exec, 'hob_grep')
      if (gate !== undefined) return gate
      const root = workspaceRootOf(exec)
      if (root === undefined) return '拒绝：无法确定工作区目录。'
      const r = await grepWorkspaceText(root, args.pattern, args.path ?? '', args.limit ?? 200)
      if (!r.ok) return r.reason ?? '搜索失败。'
      // ⚠ 跳过的二进制**必须报出**（用户裁定"文件都可以读取查看"，读者要知道
      //   哪些没被搜到、以及为什么 —— ⛔ 不许静默少搜）。
      const skipped = r.skippedBinary > 0
        ? `\n（另有 ${r.skippedBinary} 个文件读不成文本、已跳过 —— 二进制 / 非 UTF-8，未按文本搜索。）`
        : ''
      if (r.hits.length === 0) return `没有命中「${args.pattern}」（扫了 ${r.scanned} 个文件）。${skipped}`
      const body = r.hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join('\n')
      return body + skipped + (r.capped ? `\n\n---\n[已截断] 命中数达到上限 ${args.limit ?? 200}。` : '')
    },
  })

  /**
   * `hob_read_image` —— 读数形态**实测结论**（见 `REPORT-R148.md`）：
   *   宿主 `read_image`（`dsh-tool-fs/lib/index.js:987-1057`）把图片经
   *   `attachments.saveImage()` 存成附件，工具输出 `{path, image}`，`render` 给出
   *   **两个内容块**：一个 `text` 信封 + 一个 `{type:'image', attachment}`。
   *   ⚠ 图片**不走文本通道** —— 它必须作为 image 块交给模型。
   *
   *   实测：`attachments` 服务由宿主平面 provide，预设作用域**取得到**
   *   （`/tmp/r148-logs/probe-scope-services3.mjs`：`saveImage = function` 且实调成功）。
   *   ⇒ 自注册版能做到**与宿主等价**，故 `needsImage` 标记走"要 attachments"的注册路径。
   */
  const readWorkspaceImageTool = defineTool({
    name: 'hob_read_image',
    description:
      '读本工作区内的一张图片（PNG/JPEG/WebP/GIF），把**图片本身**交给模型（⛔ 只读、不能写）。'
      + '大图由宿主附件服务自动缩小。⚠ 只认工作区内的路径；不支持的类型 / 越界 / 软链 / 超上限一律拒绝。',
    parameters: {
      path: { type: 'string', required: true, description: '工作区内的图片路径，如 docs/shot.png。' },
    },
    output: {
      // ⚠ 用 `json` 根而不是 `object`：`{path, image}` 里的 `image` 是宿主
      //   附件引用（`attachmentId` 是品牌类型），在 author-facing schema 里
      //   无法干净复刻 ⇒ 取"无损 JSON 根"，由 `render` 决定实际块形状。
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => {
        const v = value as { path?: string; image?: Record<string, unknown>; envelope?: string }
        const blocks: unknown[] = [{ type: 'text', text: v.envelope ?? `<path>${v.path ?? ''}</path>` }]
        if (v.image !== undefined) blocks.push({ type: 'image', attachment: v.image })
        return blocks as never
      },
    },
    async execute(args: { path: string }, exec: ToolRunContext): Promise<JsonValue> {
      // ⚠⚠ 本层读档门（G-5）：改前这把刀也**没有**档位判断 —— 只要宿主挂了
      //   `attachments`，`ledger` 档直接 execute 就能把 PNG 字节读出来交给模型。
      const gate = workspaceGate(exec, 'hob_read_image')
      if (gate !== undefined) return { path: String(args.path), envelope: gate }
      const root = workspaceRootOf(exec)
      if (root === undefined) return { path: String(args.path), envelope: '拒绝：无法确定工作区目录。' }
      const r = await readWorkspaceImageBytes(root, args.path, DEFAULTS.maxImageBytes)
      if (!r.ok) return { path: String(args.path), envelope: r.reason ?? '拒绝。' }
      const saved = await deps.saveImage?.({
        data: r.data as Uint8Array,
        mediaType: r.mediaType as string,
        name: basename(r.displayPath as string),
      })
      if (saved === undefined) {
        return {
          path: r.displayPath as string,
          envelope: '拒绝：当前组合没有挂载附件服务（attachments），无法把图片交给模型。'
            + '请让宿主装上附件后端，或改用文本读取。',
        }
      }
      const displayPath = String(r.displayPath ?? args.path)
      const envelope = `<path>${displayPath}</path>\n<type>image</type>\n<content>\n`
        + `${r.mediaType} image, ${saved.width}x${saved.height} px, ${saved.bytes} bytes\n</content>`
      // ⚠ 逐字段显式拷贝（不是 `...saved`）：`JsonValue` 不接受 `undefined` 字段，
      //   而 `saved.name` 是可选的 ⇒ 展开会把 `undefined` 带进去。
      return {
        path: displayPath,
        image: {
          attachmentId: saved.attachmentId,
          mediaType: saved.mediaType,
          bytes: saved.bytes,
          width: saved.width,
          height: saved.height,
          ...(saved.name === undefined ? {} : { name: saved.name }),
        },
        envelope,
      }
    },
  })

  const writeHob = defineTool({
    name: 'write_hob',
    description:
      '向本工作区的账本写入内容（账本在工作区之外，按工作区名独立存放）。'
      + '可写文件：' + LEDGER_FILES.join(' / ') + '，以及 archive/<YYYY-MM-DD-slug>/*.md；'
      + '卷：volumes/<卷>/*.md；另有**具名两层**子目录（当前是 volumes/<卷>/context/rounds/*.md），未登记的会被拒。'
      + '骨架（README.md / templates/）只读。'
      + '⚠ `PROJECT.md`（项目方案）与账本同级、同在此可写面内；'
      + '但**方案只有用户能批准变更、Hob 只提议**（程序纪律，不是工具闸门）。'
      + '当前正文（CONTEXT / PROJECT / DECISIONS）只能 overwrite 整份替换，append 会被拒绝；'
      + '替换前自动归档旧版。ledger/gen 与 ledger/spec 是生成物，不可写。'
      + '活跃 change 只允许 proposal.md / tasks.md / deltas.md。'
      + 'append=新增不可变条目；overwrite=整文件重写（受缩水守卫保护）。'
      + '写入前自动备份到账本区的 backups/；相同编号+相同内容会被幂等跳过。'
      + '建议先用 dryRun:true 预演。',
    parameters: {
      file: {
        type: 'string',
        required: true,
        // ⚠ 原文写「相对 `.hob/` 的路径」——v4 起账本已外置，**没有 `.hob/` 这个前缀了**，
        //   那句话会让人以为要写 `.hob/CONTEXT.md`。改成与实现一致的措辞（根 = 账本区）。
        description: '账本区内的相对路径，如 CONTEXT.md、archive/2026-10-03-xxx/A.md。',
      },
      content: {
        type: 'string',
        required: true,
        description: '要写入的 Markdown 文本（形状见对应账本模板）。',
      },
      mode: {
        type: 'string',
        enum: ['append', 'overwrite'],
        description: 'append/overwrite。当前根正文必须 overwrite；归档目录不允许 overwrite。',
      },
      operation: {
        type: 'string',
        enum: [...HOB_WRITE_OPERATIONS],
        description: '显式账本写操作。省略时按路径推断以兼容旧调用，但写入边界仍由工具强制。',
      },
      reason: {
        type: 'string',
        description: '为什么写这一条（仅供人读，工具不消费它）。',
      },
      dryRun: {
        type: 'boolean',
        description: 'true=只跑校验、不落盘。',
      },
      // ── 改 2 · 写入即投递（2026-10-10 第 44 轮 · 结构改造②）──────────────
      //   ⚠ 两个参数**都不强制**：不给就照旧"只写不投"（并附「尚未投递」提醒）。
      //     ⛔ 这不是硬闸门 —— 写入语义不变（见 `hob-write.ts` 文件头的纪律）。
      dispatchTo: {
        type: 'string',
        description: '（可选）写完**紧接着投递**一条**纯通知**给这个会话 id（取自 hob_sessions；不自动挑会话）。'
          + '⚠ 这是单向通知，**不登记回传**；要派活必须用 `hob_dispatch` + 真实 `taskId`。',
      },
      delivery: {
        type: 'string',
        enum: ['manual'],
        description: '（可选）`manual` = 本轮**有意人工转达**（不自动投）⇒ 该条待投递记录带标注，'
          + '状态行会把"有意转达"与"漏投"分开报。⚠ 与 dispatchTo 同时给时以 dispatchTo（真投）为准。',
      },
      gateIntent: {
        type: 'string',
        enum: ['forward', 'repair'],
        description: '（可选）`forward`（缺省）= 正常推进，必须过当前作用域门禁；'
          + '`repair` = **修复写**，用于补当前 blocker（如补验收证据、加历史字段）。'
          + '⚠ repair 不是无条件放行：给了 `repairOf` 时必须命中真实 blocker；'
          + '不给 `repairOf` 时只允许写 `ledger/units/` 与 `archive/`（补证据的落点）。',
      },
      repairOf: {
        type: 'string',
        description: '（可选）`gateIntent=repair` 专用：要修复的单元 id（如 `ACC-062`）。'
          + '⚠ 它必须是当前账本里真实存在、且确实触发 blocker 的单元；'
          + '⛔ 用一个无关 id 逃闸会被拒。',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(
      args: {
        file: string
        content: string
        mode?: 'append' | 'overwrite'
        operation?: HobWriteOperation
        reason?: string
        dryRun?: boolean
        dispatchTo?: string
        delivery?: 'manual'
        gateIntent?: 'forward' | 'repair'
        repairOf?: string
      },
      exec: ToolRunContext,
    ): Promise<string> {
      /**
       * ⚠⚠ **真写之前先过"能不能推进"闸门**（2026-10-22 第 5 轮）。
       *   `dryRun` 是只读预演 ⇒ 放行（见 `proceedGate` 的注释）。
       *   ⚠ 这条**在 `ledgerRootOf` 之前**：连"判账本落点"都不必做，省得
       *     顺带触发任何初始化动作。
       */
      if (args.dryRun !== true) {
        const blocked = proceedGate(exec)
        if (blocked !== undefined) {
          return JSON.stringify({
            ok: false, reason: 'proceed-not-confirmed', message: blocked,
          })
        }
      }
      const inferred = classifyHobWritePath(args.file)
      const operation = args.operation ?? inferred
      if (operation === undefined) {
        return JSON.stringify({
          ok: false,
          reason: 'operation-unclassified',
          message: `拒绝：无法从路径 ${args.file} 判定账本写操作。`,
        })
      }
      if (isCurrentRootDoc(args.file) && operation !== 'replace-current') {
        return JSON.stringify({
          ok: false,
          reason: 'operation-path-mismatch',
          message: `拒绝：当前正文 ${args.file} 只能使用 replace-current。`,
        })
      }
      if (isCurrentRootDoc(args.file) && args.mode !== 'overwrite') {
        return JSON.stringify({
          ok: false,
          reason: 'append-current-denied',
          message: `拒绝：当前正文 ${args.file} 不能 append；请提交完整替换内容并使用 overwrite。`,
        })
      }
      if (isCurrentRootDoc(args.file) && String(args.reason ?? '').trim() === '') {
        return JSON.stringify({
          ok: false,
          reason: 'missing-reason',
          message: `拒绝：替换当前正文 ${args.file} 必须写 reason，说明这次替换改变了什么。`,
        })
      }
      // v4：账本目录按工作区派生（在工作区之外）⇒ 边界仍是「账本目录」，只是位置变了。
      const root = ledgerRootOf(cfg, exec)
      if (root === undefined) {
        return JSON.stringify({ ok: false, reason: 'no-ledger-root', message: '拒绝：无法确定账本目录。' })
      }
      if (args.dryRun !== true) {
        /**
         * **修复写 vs 推进写**（2026-11-06 · Wave 1）。
         *
         * ⚠ 为什么不能全走 `stageGateOfLedger`：补 blocker 本身就是一次账本写入，
         *   若它也被同一个 blocker 拦住，账本里的缺陷就**永远修不掉**——
         *   这不是"严格"，是死锁。
         * ⚠ 为什么 repair 不能完全绕闸：`repairOf` 必须命中**当前真实 blocker**；
         *   未指定目标时只允许 `ledger/units/` 与 `archive/`（补证据的落点），
         *   ⛔ 不能拿 repair 当"随便写当前正文"的后门。
         */
        let stageBlocked: string | undefined
        if (args.gateIntent === 'repair') {
          const target = String(args.repairOf ?? '').trim()
          const repairAllowedPath = args.file.startsWith('ledger/units/') || args.file.startsWith('archive/')
          if (target === '') {
            if (!repairAllowedPath) {
              return JSON.stringify({
                ok: false,
                reason: 'repair-scope-denied',
                message: `拒绝：未指定 repairOf 时，修复写只允许 ledger/units/ 与 archive/；`
                  + `当前路径 ${args.file} 不属于补证据的落点。`,
              })
            }
          } else {
            const health = stageHealthOfLedger(root)
            if (health.blockers.every((p) => p.unit !== target)) {
              return JSON.stringify({
                ok: false,
                reason: 'repair-target-not-a-blocker',
                message: `拒绝：${target} 不是当前账本的真实 blocker ⇒ repair 不能用来逃闸。`
                  + `当前 blocker：${health.blockers.slice(0, 5).map((p) => `${p.rule} · ${p.unit}`).join('；') || '无'}`,
              })
            }
          }
        } else {
          stageBlocked = stageGateOfLedger(root)
        }
        if (stageBlocked !== undefined) {
          return JSON.stringify({ ok: false, reason: 'stage-gate-blocked', message: stageBlocked })
        }
      }
      const r = await writeHobFile(root, {
        file: args.file,
        content: args.content,
        ...(args.mode === undefined ? {} : { mode: args.mode }),
        ...(args.reason === undefined ? {} : { reason: args.reason }),
        ...(args.dryRun === undefined ? {} : { dryRun: args.dryRun }),
      }, {
        // v4：`root` 已是**账本目录本身** ⇒ hobDir 传空串，避免多套一层
        // （否则 hobRoot = <账本目录>/.hob，写成 `<工作区名>/.hob/CONTEXT.md`）。
        hobDir: '',
        keepBackups: DEFAULTS.keepBackups,
        shrinkGuard: DEFAULTS.shrinkGuard,
        maxFileBytes: cfg.maxWriteBytes ?? DEFAULTS.maxWriteBytes,
      })
      // ── 记账 + 投递：交给了交接文件（2026-10-10 新增；第 44 轮扩展为"写入即投递"）──
      //   ⚠ 为什么在这一层：落盘层（hob-write）刻意不碰运行态；本层有账本根。
      //   ⚠ 为什么必须记：`watches` 只在**投递成功之后**登记 ⇒ 不记这一条，
      //     "写了文件却没投"在系统里**根本不存在**（第 9 / 21 / 40 轮实测漏派三次，
      //     其中两次是用户发现的，现场读数与"从来没派过"逐字相同）。
      //   ⚠ 记账失败**不掩盖**、但也**不改写结果**：只**新增**字段如实回带
      //     （`handoffRecorded` / `handoffNote`），既有字段一个不动 ——
      //     写入本身已经落盘，记账是**附加可观测**，不该把成功报成失败。
      //   ⚠ 只在**真写成功**且判定为交接文件时记（`r.ok && r.handoff`）——
      //     幂等跳过 / 拒绝 / dryRun 都不算"写了一份新交接文件"
      //     （⚠ `dryRun` 单独再判：它返回 `ok: true` 但**没落盘**）。
      //   ⚠ 不引 `console.*`：本模块（乃至 `src/**`）零 console 先例，
      //     日志走工具返回值 / `ctx.logger`；这里没有 ctx，故走返回值。
      //   ⚠ **改 2**：投递**不是**硬闸门 —— 不给 `dispatchTo` 就只记账（现状不变）。
      if (r.ok === true && r.handoff !== undefined && args.dryRun !== true) {
        /**
         * `write_hob(dispatchTo)` has no task id, so it cannot create a RUN-bound
         * dispatch. Keep the file write, but do not turn the handoff into an
         * execution side door; the caller must use hob_dispatch for real work.
         */
        if (args.dispatchTo !== undefined) {
          return JSON.stringify({
            ...r,
            handoffRecorded: false,
            delivered: false,
            deliverReason: 'notification-only: write_hob(dispatchTo) cannot bind a ledger task/RUN; use hob_dispatch with a real taskId',
            returnRegistered: false,
            handoffReading: '待投递：0 份（本次文件已写；未投递，需用 hob_dispatch）',
          })
        }
        const orch = deps.orchOf?.(exec)
        const res = await deliverHandoff({
          ledgerRoot: root,
          ref: r.handoff.ref,
          at: Date.now(),
          ...(args.dispatchTo === undefined ? {} : { dispatchTo: args.dispatchTo }),
          // ⚠ 与 `dispatchTo` 同时给时**以真投为准**（`manual` 只描述"没自动投"）：
          //   否则会出现"既投了、又标注为有意人工转达"的自相矛盾记录。
          ...(args.delivery === 'manual' && args.dispatchTo === undefined ? { delivery: 'manual' as const } : {}),
          self: sessionIdOf(exec),
          ...(orch === undefined ? {} : { orch }),
        })
        /**
         * ⚠ **持久补投**：现有一投失败后，把同一条 handoff 放进 effect 队列。
         * ⚠ 不改变本次返回值；队列只在后台补投，成功后清同一条 handoff。
         */
        const effects = deps.handoffEffectsOf?.(root)
        /**
         * A preset-confirmation stop is not a transient transport failure. The
         * user must choose the target first; retrying in the background would
         * either re-open the same question repeatedly or bypass the decision.
         */
        if (args.dispatchTo !== undefined && res.dispatched !== true && res.needsUser !== true && effects !== undefined) {
          enqueueHandoff(effects, {
            kind: 'task-file',
            ref: r.handoff.ref,
            at: Date.now(),
            ...(sessionIdOf(exec) === undefined ? {} : { owner: sessionIdOf(exec) }),
          }, args.dispatchTo, pointerMessageForRef(r.handoff.ref))
        }
        if (args.dispatchTo !== undefined && res.dispatched === true && effects !== undefined) {
          try {
            const h = { kind: 'task-file' as const, ref: r.handoff.ref }
            // handoffEffects 的 handler 成功时会清账；这里只需撤掉尚未跑的重复 effect。
            effects.cancel?.(HANDOFF_EFFECT, handoffEffectKey(h))
          } catch { /* 后台读数兜底 */ }
        }
        return JSON.stringify({
          ...r,
          handoffRecorded: res.recorded,
          ...(res.note === undefined ? {} : { handoffNote: res.note }),
          // 改 2 · 投递结果（只在**给了 dispatchTo** 时出现，避免给返回值添噪音）
          ...(args.dispatchTo === undefined
            ? {}
            : {
              delivered: res.dispatched,
              ...(res.dispatchReason === undefined ? {} : { deliverReason: res.dispatchReason }),
              ...(res.needsUser === true ? { needsUser: true } : {}),
              ...(res.configuredPreset === undefined ? {} : { configuredPreset: res.configuredPreset }),
              ...(res.targetPreset === undefined ? {} : { targetPreset: res.targetPreset }),
            }),
          // ⚠ 投递后（或直接标注后）的**待投递读数** —— 让"清干净了没有"当场可见
          // ⚠ ⚠ **并把可达性带上**（2026-10-16 第 247 轮 · `TASK-R207`）——
          //   治的是"**够不到账本**"与"**真的没有待投递**"给同一读数这个缺陷
          //   （第 243 轮实测 · `REPORT-R205.md` §3.2-c）。
          handoffReading: renderHandoffReading(res.handoffs, res.reachability),
        })
      }
      return JSON.stringify({
        ...r,
      })
    },
  })

  /**
   * ══ **账本就绪度查询**（2026-11-08 · 用户裁定「先建账并梳理健康才能推进」）══
   *
   * ⚠ 这是**只读**诊断：⛔ 不建任何目录、⛔ 不写任何文件。
   * ⚠ 它调的判定与派活门禁**同一个纯函数**（`assessLedgerReadiness`）——
   *   ⛔ 不许在这条路上另写一份"看起来差不多"的判定：两处漂开的后果是
   *   「工具说就绪、派活仍被拦」或者更坏的反过来。
   *
   * ⚠ 为什么单独做成一个工具（而不是只在拒绝时回一句话）：
   *   模型需要**在动手之前**就能问"这本账现在什么状态、下一步该做什么"，
   *   而不是反复撞到拒绝才知道缺哪一步。
   */
  const ledgerStatus = defineTool({
    name: 'hob_ledger_status',
    description: '**只读**：报告本会话对应账本的就绪度（未建 / 旧格式 / 空 / 有缺口 / 就绪），'
      + '并给出下一步该做什么。⚠ 它不建目录、不写文件。'
      + '⚠ 派活前如果被判"账本还不能推进"，先用它看原因。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => {
        const v = value as Partial<LedgerReadiness> & { ok?: boolean }
        return [{ type: 'text', text: readinessLineOf(v as LedgerReadiness) }]
      },
    },
    async execute(_args: unknown, exec: ToolRunContext): Promise<JsonValue> {
      const root = ledgerRootOf(cfg, exec)
      const readiness = ledgerReadinessOfRoot(root)
      return {
        ok: true,
        /**
         * ⚠ **两个字段一起给**（D-T02-1 选项 C）：
         *   `structurallyReady` 回答"账本内容自洽吗"，`canProceed` 回答"能推进吗"。
         *   改前只有一个 `canProceed`，于是「内容齐全但还没批准」只能被读成
         *   "就绪"或"不健康"其中之一，两种都不对。
         */
        structurallyReady: readiness.structurallyReady,
        canProceed: readiness.canProceed,
        canInitialize: readiness.canInitialize,
        state: readiness.state,
        headline: readiness.headline,
        nextAction: readiness.nextAction,
        unitCount: readiness.unitCount,
        gapCount: readiness.gapCount,
        gaps: readiness.gaps,
        ...(readiness.reason === undefined ? {} : { reason: readiness.reason }),
        ...(readiness.detail === undefined ? {} : { detail: readiness.detail }),
        ...(root === undefined ? {} : { ledgerRoot: root }),
      } as unknown as JsonValue
    },
  })

  /**
   * **账本状态词迁移**（2026-11-08 · 真实账本实测）。
   *
   * 现实旧账本不只是 `[units."ID"]` 旧格式；还有一类**表头已经换成 `[[unit]]`、
   * 但状态用了别的时代词**：
   *   · `task.status="settled"`（实际含义：任务已交付）
   *   · `kind="evd"`（实际含义：证据）
   *   · `decision.status="settled"`（实际含义：现行决策）
   *
   * 这些不是“自由文本”，而是语义可判的旧词。本工具只接受**声明式映射**，
   * 默认只预演；真写必须 `dryRun:false`，并且先备份。⛔ 不凭空猜任意未知状态。
   */
  const ledgerMigrate = defineTool({
    name: 'hob_ledger_migrate',
    description: '把旧账本里可判定的旧 kind/status 词迁移到现行封闭集。默认只预演；'
      + '要真写必须显式传 `dryRun:false`。⚠ 不做任意值替换：只接受内置的有限映射。',
    parameters: {
      dryRun: {
        type: 'boolean',
        description: '（可选）缺省 true = 只预演。真要迁移请显式传 false。',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String((value as { message?: string })?.message ?? '') }],
    },
    async execute(args: { dryRun?: boolean }, exec: ToolRunContext): Promise<JsonValue> {
      const root = ledgerRootOf(cfg, exec)
      if (root === undefined || root.trim() === '') {
        return { ok: false, reason: 'no-ledger-root', message: '拒绝：账本落点判不出。' } as unknown as JsonValue
      }
      const unitsDir = join(root, 'ledger', 'units')
      const indexPath = join(unitsDir, 'index.toml')
      let src = ''
      try { src = readFileSync(indexPath, 'utf8') } catch (e) {
        return { ok: false, reason: 'index-unreadable', message: `账本索引读不到：${String((e as Error)?.message ?? e)}` } as unknown as JsonValue
      }
  /**
   * ── **O-37：迁移核心必须是纯函数，供 index 与所有分片复用** ────────────────
   *
   * ⚠ 改前整段逻辑**写死在 `index.toml` 上**：只读 index、只写 index。
   *   而现行账本的单元**几乎全在分片里**（实测 `dsh-hob`：index 0 条 / 7 个分片 292 条）
   *   ⇒ 在真实存量上，`hob_ledger_migrate` 是一条**无效的修复通道**：
   *     它报「没有发现可自动迁移的已知旧词」，而分片里其实有 13 处旧词。
   *
   * ⚠ 抽成纯函数（输入文本、输出文本 + 变更清单）的三个理由：
   *   ① index 与分片**必须走同一套规则** —— 两份实现迟早分叉（本仓反复记的形态）；
   *   ② 纯函数可单独测（不落盘、不依赖账本）；
   *   ③ 变更清单要能**跨文件汇总**给用户看（只报文件名不够，要报 `id.field from→to`）。
   *
   * @param src - 一个 TOML 分片（或 index）的原文
   * @returns 迁移后的文本 + 变更清单（行号相对于该文件）
   */
  const migrateShardText = (src: string): { out: string; changes: Array<{ line: number; id: string; field: string; from: string; to: string }> } => {
    /**
     * 迁移规则**只改等号右边的可识别旧词**，并只在对应的 kind 块内应用；
     * ⛔ 不做全局字符串替换（那会把正文里出现的同名词一起改掉）。
     */
    const lines = src.replace(/\r\n/g, '\n').split('\n')
    const changes: Array<{ line: number; id: string; field: string; from: string; to: string }> = []
    const blocks: Array<{ start: number; end: number; id: string; kind: string }> = []
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.trim() !== '[[unit]]') continue
      let end = i + 1
      while (end < lines.length && lines[end]!.trim() !== '[[unit]]') end++
      const body = lines.slice(i, end)
      const get = (k: string): string => {
        const l = body.find((x) => new RegExp(`^${k}\\s*=`).test(x.trim()))
        return l === undefined ? '' : (/=\s*"([^"]*)"/.exec(l)?.[1] ?? '')
      }
      blocks.push({ start: i, end, id: get('id'), kind: get('kind') })
    }
    const setFieldInBlock = (b: { start: number; end: number; id: string }, field: string, to: string): void => {
      for (let i = b.start; i < b.end; i++) {
        const m = new RegExp(`^(\\s*${field}\\s*=\\s*)"([^"]*)"(\\s*)$`).exec(lines[i]!)
        if (m === null) continue
        if (m[2] === to) return
        changes.push({ line: i + 1, id: b.id, field, from: m[2]!, to })
        lines[i] = `${m[1]}"${to}"${m[3] ?? ''}`
        return
      }
    }
    for (const b of blocks) {
      const oldKind = b.kind
      const kind = oldKind === 'evd' ? 'evidence' : oldKind
      if (kind !== oldKind) {
        setFieldInBlock(b, 'kind', kind)
        const oldStatus = blocks.find((x) => x.start === b.start)?.kind === oldKind
          ? (/status\s*=\s*"([^"]*)"/.exec(lines.slice(b.start, b.end).join('\n'))?.[1] ?? '')
          : ''
        if (oldStatus === 'settled' || oldStatus === '') setFieldInBlock(b, 'status', 'recorded')
        b.kind = kind
      }
      const statusLine = lines.slice(b.start, b.end).join('\n')
      const status = /status\s*=\s*"([^"]*)"/.exec(statusLine)?.[1] ?? ''
      if (kind === 'task' && status === 'settled') setFieldInBlock(b, 'status', 'built')
      if (kind === 'decision' && status === 'settled') setFieldInBlock(b, 'status', 'active')
    }

    return { out: lines.join('\n'), changes }
  }

      /**
       * ── **遍历 index + 全部分片**（O-37 的核心修复）────────────────────────
       *
       * ⚠ 顺序：**index 在前**（它是导航入口，人先看它）；分片按名排序（确定性）。
       * ⚠ 只认 `^unit-[^/]+\.toml$` —— 与三个读取面**同一个过滤式**，
       *   ⛔ 不要把 `sub/x.toml` 那种读不见的文件也算进来（那是 R-19 的坑）。
       */
      const shardNames = (() => {
        try { return readdirSync(unitsDir).filter((n) => /^unit-[^/]+\.toml$/.test(n)).sort() } catch { return [] }
      })()
      /** 每个文件各自的迁移结果；⚠ 文件名与变更清单一起收，才能跨文件汇总。 */
      const perFile: Array<{ file: string; out: string; changes: Array<{ line: number; id: string; field: string; from: string; to: string }> }> = []
      const changes: Array<{ file: string; line: number; id: string; field: string; from: string; to: string }> = []
      for (const [file, text] of [['index.toml', src] as const, ...shardNames.map((n) => {
        try { return [n, readFileSync(join(unitsDir, n), 'utf8')] as const } catch { return [n, ''] as const }
      })]) {
        /** ⚠ 读不到的分片**不静默跳过**：报出来，让人知道这本账有一块读不了。 */
        if (text === '' && file !== 'index.toml') {
          return { ok: false, reason: 'shard-unreadable', message: `分片 \`${file}\` 读不到 ⇒ 本次迁移**不能声称完成**（⛔ 不静默少迁一个文件）。` } as unknown as JsonValue
        }
        const r = migrateShardText(text)
        perFile.push({ file, out: r.out, changes: r.changes })
        for (const c of r.changes) changes.push({ file, ...c })
      }

      if (changes.length === 0) {
        return {
          ok: true, dryRun: args?.dryRun !== false, changes: [], state: 'nothing-to-migrate',
          scanned: perFile.map((x) => x.file),
          message: `扫描了 ${perFile.length} 个文件（index + ${shardNames.length} 个分片），没有发现可自动迁移的已知旧词；⛔ 未写盘。`,
        } as unknown as JsonValue
      }
      const summary = changes.map((c) => `${c.file} · ${c.id}.${c.field} ${c.from}→${c.to}`).join('；')
      if (args?.dryRun !== false) {
        return {
          ok: true, dryRun: true, changes, state: 'preview',
          scanned: perFile.map((x) => x.file),
          message: `[演练] 扫描 ${perFile.length} 个文件，将迁移 ${changes.length} 处：${summary}`
            + '\n  ⚠ 未落盘。确认后传 `dryRun:false`。',
        } as unknown as JsonValue
      }
      /** ⚠ 只重写**真有变更**的文件（⛔ 不把没变的文件也覆写一遍 —— 那会无谓地产生备份与 mtime 抖动）。 */
      const dirty = perFile.filter((x) => x.changes.length > 0)
      for (const f of dirty) {
        const w = await writeHobFile(root, {
          file: `ledger/units/${f.file}`,
          content: f.out,
          mode: 'overwrite',
          reason: '迁移旧账本 kind/status 词到现行封闭集',
        }, {
          hobDir: '',
          keepBackups: DEFAULTS.keepBackups,
          shrinkGuard: DEFAULTS.shrinkGuard,
          maxFileBytes: cfg.maxWriteBytes ?? DEFAULTS.maxWriteBytes,
          /**
           * ⚠ 迁移前这本账按定义还不合法，必须允许「把坏行改成合法行」；
           *   写入后由 `ledgerReadinessOfRoot(root)` 重新核全账，若仍坏就如实回报。
           */
          validateLedgerStructure: false,
        })
        if (!w.ok) {
          return { ok: false, reason: w.reason, message: `迁移写盘失败（${f.file}）：${w.message}`, changes } as unknown as JsonValue
        }
      }
      const after = ledgerReadinessOfRoot(root)
      /** Migration changes the project checklist and must refresh open catalogs. */
      publishLiveChangeForLedger(root, ['catalog'])
      return {
        ok: after.state === 'ready', state: after.state, gapCount: after.gapCount, gaps: after.gaps,
        changes,
        message: after.state === 'ready'
          ? `已迁移 ${changes.length} 处；账本现在就绪。`
          : `已迁移 ${changes.length} 处，但账本仍有 ${after.gapCount} 条缺口 ⇒ 先补齐再推进。`,
      } as unknown as JsonValue
    },
  })

  /**
   * Record an explicit user decision for a Pipeline v3 requirement or plan.
   *
   * This tool writes a decision audit unit. It does not promote `req.status` or
   * `change.status`; approval is a separate fact and cannot be manufactured by
   * the project agent. The user receipt must be supplied verbatim.
   */
  const ledgerApprove = defineTool({
    name: 'hob_pipeline_approve',
    description: '记录用户对 Pipeline v3 需求或方案的明确批准 / 修改要求。'
      + '⚠ 必须给用户回执原文 `source`；默认只预演，真写要 `dryRun:false`。'
      + '⚠ 它只写批准审计，不替用户选路径，也不自动推进阶段。',
    parameters: {
      artifactId: {
        type: 'string',
        required: true,
        description: '被批准的稳定 ID（R-... 或 CHG-...）。',
      },
      revision: {
        type: 'integer',
        required: true,
        description: '用户批准的具体修订号；必须与账本中的 revision 完全一致。',
      },
      decision: {
        type: 'string',
        required: true,
        enum: ['approve', 'request-changes'],
        description: 'approve=确认当前版本；request-changes=要求修改。',
      },
      source: {
        type: 'string',
        required: true,
        description: '用户回执原文，必须能证明用户明确说出了对象和版本。',
      },
      selectedOption: {
        type: 'string',
        description: '方案批准时必填：从当前 path_options 中选中的路径（如 A / B / C）。',
      },
      dryRun: {
        type: 'boolean',
        description: '（可选）缺省 true = 只预演。',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String((value as { message?: string })?.message ?? '') }],
    },
    async execute(args: {
      artifactId: string
      revision: number
      decision: 'approve' | 'request-changes'
      source: string
      selectedOption?: string
      dryRun?: boolean
    }, exec: ToolRunContext): Promise<JsonValue> {
      const root = ledgerRootOf(cfg, exec)
      if (root === undefined || root.trim() === '') {
        return { ok: false, reason: 'no-ledger-root', message: '拒绝：账本落点判不出。' } as unknown as JsonValue
      }
      let units: Array<Record<string, unknown>>
      try { units = readLedgerUnits(root) as Array<Record<string, unknown>> } catch (e) {
        return { ok: false, reason: 'ledger-unreadable', message: `账本读不到：${String((e as Error)?.message ?? e)}` } as unknown as JsonValue
      }
      const id = String(args.artifactId ?? '').trim()
      const artifact = units.find((u) => String(u.id ?? '') === id)
      if (artifact === undefined) {
        return { ok: false, reason: 'artifact-not-found', message: `拒绝：账本里没有 ${id}` } as unknown as JsonValue
      }
      const kind = String(artifact.kind ?? '')
      if (kind !== 'req' && kind !== 'change') {
        return { ok: false, reason: 'artifact-not-approvable', message: `拒绝：${id} 是 ${kind}，只有需求和方案需要用户阶段批准。` } as unknown as JsonValue
      }
      if (!isPipelineV2(artifact)) {
        return { ok: false, reason: 'legacy-artifact', message: `拒绝：${id} 属于旧管线，不能后补成 v3 批准；请新建 v3 需求。` } as unknown as JsonValue
      }
      const actualRevision = revisionOf(artifact)
      if (actualRevision === undefined || actualRevision !== Number(args.revision)) {
        return {
          ok: false, reason: 'revision-mismatch',
          message: `拒绝：${id} 当前第 ${actualRevision ?? '?'} 版，用户回执写的是第 ${String(args.revision)} 版。`,
        } as unknown as JsonValue
      }
      const source = String(args.source ?? '').trim()
      if (source === '') {
        return { ok: false, reason: 'source-required', message: '拒绝：批准必须附用户回执原文 source。' } as unknown as JsonValue
      }
      const selectedOption = String(args.selectedOption ?? '').trim()
      const decision = args.decision
      if (decision !== 'approve' && decision !== 'request-changes') {
        return { ok: false, reason: 'decision-invalid', message: '拒绝：decision 只收 approve / request-changes。' } as unknown as JsonValue
      }
      if (decision === 'approve' && kind === 'change') {
        const options = Array.isArray(artifact.path_options) ? artifact.path_options.map(String) : []
        if (selectedOption === '' || !options.includes(selectedOption)) {
          return {
            ok: false, reason: 'option-invalid',
            message: `拒绝：方案批准必须从当前 path_options 中选择路径（当前：${options.join(' / ') || '(无可选路径)'}）。`,
          } as unknown as JsonValue
        }
      }
      /**
       * The user receipt must name the object and revision. A bare "continue"
       * or "OK" is not approval.
       *
       * ⚠ **R-15：判据来自 {@link receiptPatternOf}，⛔ 不在这里内联正则。**
       * 本仓曾有两份不等价的回执正则（纯函数版 `\s+` / 本处 `\s*`），
       * 分叉的成因就是"在调用点重写一遍"。现在两处共用一份实现。
       * `acceptRevisionRequest: true` —— 本工具在同一入口既处理批准也处理退回。
       */
      const receipt = receiptPatternOf(
        { id, kind: String(artifact.kind ?? ''), revision: actualRevision },
        { acceptRevisionRequest: true },
      )
      if (!receipt.test(source)) {
        return {
          ok: false, reason: 'receipt-mismatch',
          message: `拒绝：用户回执没有同时点名 ${id} 与第 ${actualRevision} 版；只写“继续 / 可以”不算批准。`,
        } as unknown as JsonValue
      }
      const approval = approvalStateOf(artifact, units)
      if (approval.state === 'legacy') {
        return { ok: false, reason: 'legacy-artifact', message: '拒绝：旧管线条目不能后补批准。' } as unknown as JsonValue
      }
      const maxSeq = Math.max(0, ...units
        .filter((u) => String(u.kind) === 'decision')
        .map((u) => Number(/^DEC-(\d+)$/.exec(String(u.id ?? ''))?.[1] ?? 0)))
      const decisionId = `DEC-${String(maxSeq + 1).padStart(3, '0')}`
      const decidedAt = new Date().toISOString()
      const lines = [
        '[[unit]]',
        `id = ${JSON.stringify(decisionId)}`,
        'kind = "decision"',
        'status = "active"',
        `title = "用户${decision === 'approve' ? '批准' : '要求修改'} ${id} 第 ${actualRevision} 版"`,
        `decision_kind = ${JSON.stringify(APPROVAL_DECISION_KIND)}`,
        `approval_stage = ${JSON.stringify(kind === 'req' ? 'requirements' : 'plan')}`,
        `artifact_id = ${JSON.stringify(id)}`,
        `artifact_revision = ${JSON.stringify(String(actualRevision))}`,
        `artifact_digest = ${JSON.stringify(artifactDigestOf(artifact))}`,
        `decision = ${JSON.stringify(decision)}`,
        ...(selectedOption === '' ? [] : [`selected_option = ${JSON.stringify(selectedOption)}`]),
        'decided_by = "user"',
        `decided_at = ${JSON.stringify(decidedAt)}`,
        `source = ${JSON.stringify(source)}`,
        '',
      ]
      const content = lines.join('\n')
      if (args.dryRun !== false) {
        return {
          ok: true, dryRun: true, decisionId,
          message: `[演练] 将记录 ${decisionId}：${source}\n  ⚠ 未落盘。确认后传 dryRun:false。`,
        } as unknown as JsonValue
      }
      /**
       * ══════════════════════════════════════════════════════════════════════
       * **T-13：真写之前先过「能不能推进」闸门**（2026-11-10）
       * ══════════════════════════════════════════════════════════════════════
       *
       * ── 病（实测）────────────────────────────────────────────────────────
       *   `hob_pipeline_approve` / `hob_ledger_init` / `hob_ledger_migrate` /
       *   `hob_ledger_rebuild` 四个写工具**都不过 `proceedGate`**（`grep` 只命中
       *   `:1306` 定义与 `:1582` 的 `write_hob`）。
       *   ⇒ `archived` / `quarantined` / `pending-activation` / `unknown-legacy`
       *     的会话（`mayProceed=false`）**仍能写「用户批准」落账** ——
       *     「被隔离的会话不能推进」这条不变量在**写路径**上有一个旁路。
       *
       * ⚠ `dryRun` 保持放行（纯预演不改变任何东西，与 `write_hob` 一致）。
       * ⚠ `hob_ledger_init` 不过闸门是**有理由的**（它是开张而不是推进），
       *   本批不动它；`approve` 没有这个理由。
       */
      if (args.dryRun === false) {
        const blocked = proceedGate(exec)
        if (blocked !== undefined) {
          return { ok: false, reason: 'proceed-not-confirmed', message: blocked } as unknown as JsonValue
        }
      }
      const w = await writeHobFile(root, {
        file: 'ledger/units/unit-pipeline-approval.toml',
        content,
        mode: 'append',
      }, {
        hobDir: '',
        keepBackups: DEFAULTS.keepBackups,
        shrinkGuard: DEFAULTS.shrinkGuard,
        maxFileBytes: cfg.maxWriteBytes ?? DEFAULTS.maxWriteBytes,
        /**
         * ⚠ **T-06：不再传 `validateLedgerStructure: false`**（2026-11-10）。
         *
         * 原注释的理由是「approval units are valid v2 decisions even when other
         * legacy rows are not migrated」——**这个理由不成立**：
         *   · `decision` 与封闭契约**完全兼容**（`UNIT_STATUSES.decision = ['active','superseded']`，
         *     本工具写的正是 `status="active"`）；
         *   · 实测在健康账本上走统一校验 ⇒ `ok:true`；
         *   · 而豁免的**实际后果**是「连 C-22 字段校验都跳过」——
         *     即这个工具自己写出非法 decision 也能落盘。
         * ⇒ 去掉豁免，与其余三个写入口同一道校验。
         */
        allowApprovalShard: true,
      })
      if (!w.ok) {
        return { ok: false, reason: w.reason, message: `批准记录写盘失败：${w.message}` } as unknown as JsonValue
      }
      return {
        ok: true, decisionId, artifactId: id, revision: actualRevision, decision,
        ...(selectedOption === '' ? {} : { selectedOption }),
        message: `已记录 ${decisionId}：用户${decision === 'approve' ? '批准' : '要求修改'} ${id} 第 ${actualRevision} 版。`,
      } as unknown as JsonValue
    },
  })

  /**
   * ══ **建账本 / 补齐**（2026-11-08 · 用户裁定「Hob 预设本身要具备这个能力」）══
   *
   * ── 它做什么（**只做"让账本可推进"所需的最小集**）──────────────────────
   *   · `missing`   ⇒ 建 `ledger/units/index.toml`（空索引）+ `PROJECT.md` 起手
   *   · `empty`     ⇒ 只补缺失的那几份（⛔ 不覆盖已有内容）
   *   · `legacy`    ⇒ **不自动迁移**：旧索引里是别人的真实数据，
   *                   自动改写 = 替用户重写历史（⛔ 越权）。这里只给出迁移清单。
   *   · `unhealthy` ⇒ 只回缺口清单（补内容是指挥的活，⛔ 不是建账工具该干的）
   *   · `ready`     ⇒ 什么都不做
   *
   * ── 三条硬边界 ────────────────────────────────────────────────────────
   *   ① **不越写面**：落盘一律走 `writeHobFile`（同一道白名单 / 同一条守卫），
   *      ⛔ 不自己拼路径 `mkdir` + `writeFile` —— 那会在守卫旁边开一个后门；
   *   ② **不覆盖**：`mode: 'append'` 且先探测存在性；已存在就跳过并如实回报"跳过"；
   *   ③ **默认演练**：`dryRun` 缺省 `true`；要真落盘必须显式 `dryRun: false`。
   *      ⚠ 这是"建账本"这种**结构性写入**该有的默认姿态。
   */
  const ledgerInit = defineTool({
    name: 'hob_ledger_init',
    description: '**给当前工作区建账本**（或补齐缺失件）：账本没建 / 是空账本时，先跑它。'
      + '⚠ 默认只演练（`dryRun` 缺省 true），要真落盘请显式给 `dryRun: false`。'
      + '⚠ 不覆盖已有文件；⚠ 旧格式账本**不自动改写**（只给迁移清单）。'
      + '⚠ 账本就绪之前 `hob_dispatch` / `hob_send` 会被拒 —— 这是设计，不是故障。',
    parameters: {
      dryRun: {
        type: 'boolean',
        description: '（可选）**缺省 true = 只演练不落盘**。要真建账本请显式传 false。',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String((value as { message?: string })?.message ?? '') }],
    },
    async execute(args: { dryRun?: boolean }, exec: ToolRunContext): Promise<JsonValue> {
      const dryRun = args?.dryRun !== false
      const root = ledgerRootOf(cfg, exec)
      if (root === undefined || root.trim() === '') {
        return {
          ok: false,
          reason: 'no-ledger-root',
          message: '拒绝：账本落点判不出（会话没有工作区根，或 `ledgerHome` 没配）⇒ 不知道该在哪儿建。'
            + '先确认会话从哪个工作区打开，再重试。',
        } as unknown as JsonValue
      }
      const before = ledgerReadinessOfRoot(root)
      /**
       * ⚠ 旧格式 / 真坏账本：**只报清单**。
       *   自动改写别人的真实数据 = 替用户重写历史，⛔ 这不是建账工具能做的事。
       */
      const lifecycleBefore = ledgerLifecycleOfRoot(root)
      if (lifecycleBefore.state === 'archived') {
        return { ok: false, reason: 'ledger-archived', state: lifecycleBefore.state,
          message: '这本账已归档，不是当前账本；请切换到当前账本或显式重建，不会原地复活归档账。', ledgerRoot: root } as unknown as JsonValue
      }
      if (lifecycleBefore.state === 'active' && lifecycleBefore.integrity === 'valid') {
        /**
         * ⚠ **"不用建" ≠ "能推进"**（D-T02-1 选项 C）。
         *
         *   `lifecycle.integrity === 'valid'` 现在只看**结构层**；一本内容齐全但
         *   用户还没批准的账本同样是 valid ⇒ 本工具正确地说"不需要建账本"。
         *   ⚠ 但若只说这一句，用户会以为能派活了，一派就被 G1/G2 拦。
         *   ⇒ 把推进层的读数一并如实回带（⛔ 不改判据，只补一句为什么）。
         */
        const proceedNote = before.state === 'ready'
          ? ''
          : ` ⚠ 但还不能推进：${before.gapCount} 条缺口（${before.gaps.slice(0, 3).map((g) => g.rule + ' · ' + g.unit).join('；') || before.headline}）。`
        return { ok: true, state: 'ready', noop: true, canProceed: before.canProceed,
          message: `${lifecycleBefore.headline} ⇒ 不需要建账本。${proceedNote}`, ledgerRoot: root } as unknown as JsonValue
      }
      if (lifecycleBefore.state === 'invalid' || lifecycleBefore.state === 'provisioning') {
        return {
          ok: false, reason: lifecycleBefore.state === 'invalid' ? 'ledger-invalid' : 'ledger-provisioning',
          state: lifecycleBefore.state, headline: lifecycleBefore.headline, nextAction: lifecycleBefore.nextAction,
          blockers: lifecycleBefore.blockers,
          message: `不能原地修补当前账本：${lifecycleBefore.headline} ⇒ ${lifecycleBefore.nextAction}`
            + ' ⚠ 坏账本只能归档重建或恢复；本工具不会覆盖已有单元。',
          ledgerRoot: root,
        } as unknown as JsonValue
      }
      if (before.state === 'legacy' || before.state === 'unhealthy' && before.reason === 'index-malformed') {
        return {
          ok: false,
          reason: before.reason ?? 'legacy',
          state: before.state,
          message: `不自动改写：${before.headline}。`
            + '\n  旧账本只能只读保存为历史证据；要作为当前账本继续，必须显式迁移或归档后按模板重建。'
            + '\n  ⚠ 迁移前后都要逐字节留副本（规则：证据与历史只增不改）。',
          ledgerRoot: root,
        } as unknown as JsonValue
      }
      if (before.state === 'unhealthy' && before.reason !== 'index-missing') {
        return {
          ok: false,
          reason: before.reason ?? 'unhealthy',
          state: before.state,
          gapCount: before.gapCount,
          gaps: before.gaps,
          message: `账本已建，但有 ${before.gapCount} 条缺口 ⇒ 这不是缺少文件，而是账本不合法。`
            + ' 按当前规则应归档旧账并重新建账，或恢复已验证快照；本工具不会逐条修补。',
          ledgerRoot: root,
        } as unknown as JsonValue
      }
      if (before.state === 'ready' && lifecycleBefore.integrity !== 'valid') {
        return { ok: false, reason: 'ledger-not-active', state: lifecycleBefore.state,
          message: `${lifecycleBefore.headline} ⇒ ${lifecycleBefore.nextAction}`, ledgerRoot: root } as unknown as JsonValue
      }
      /**
       * `missing` / `empty` / 索引缺：按清单补齐**缺失件**。
       * ⚠ 只用 `existsSync` 判"在不在"；⛔ 不读内容判断"该不该改"（那不是建账）。
       */
      const workspaceName = (() => {
        const base = root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? 'project'
        return base === '' ? 'project' : base
      })()
      const nowIso = new Date().toISOString()
      /**
       * ⚠ 每份文件的落盘形态**不同**，必须逐份声明（真机踩过）：
       *   · `ledger/units/index.toml` ⇒ `append`（它是索引，允许追加）；
       *   · `PROJECT.md` ⇒ **`overwrite` + `reason`** —— 当前正文只接受整份替换，
       *     `append` 会被守卫直接拒（`append-current-denied`，实测原文）。
       *   ⛔ 不许为了省事把两者写成同一种 mode。
       */
      const plan: Array<{ file: string; content: string; mode: 'append' | 'overwrite'; reason?: string }> = []
      const indexPath = join(root, 'ledger', 'units', 'index.toml')
      if (!existsSync(indexPath)) {
        plan.push({ file: 'ledger/units/index.toml', content: initialIndexToml(nowIso), mode: 'append' })
      }
      const projectPath = join(root, 'PROJECT.md')
      if (!existsSync(projectPath)) {
        plan.push({ file: 'PROJECT.md', content: initialProjectMd(workspaceName), mode: 'overwrite', reason: '建账本：起手 PROJECT.md（待填）' })
      }
      /** New ledgers always carry an explicit activation record. */
      const ledgerId = `${workspaceName}-${nowIso.replace(/[^0-9]/g, '').slice(0, 14)}`
      const activationPath = join(root, 'ledger.toml')
      if (!existsSync(activationPath)) {
        plan.push({ file: 'ledger.toml', content: initialLedgerActivation({
          ledgerId, workspace: workspaceName, createdAt: nowIso,
        }), mode: 'append' })
      }
      /** Optional starter documents are empty skeletons, never copied project facts. */
      const starters = [
        ['CONTEXT.md', initialContextMd(workspaceName)],
        ['DECISIONS.md', initialDecisionsMd(workspaceName)],
      ] as const
      for (const [file, content] of starters) {
        if (!existsSync(join(root, file))) {
          plan.push({ file, content, mode: 'overwrite', reason: `建账本：起手 ${file}（空骨架，待填）` })
        }
      }
      const templateManifestPath = join(root, 'ledger.templates.toml')
      if (!existsSync(templateManifestPath)) {
        plan.push({ file: 'ledger.templates.toml', content: initialTemplateManifest({ createdAt: nowIso, workspace: workspaceName }), mode: 'append' })
      }
      if (plan.length === 0) {
        return {
          ok: false,
          reason: 'nothing-to-create',
          state: before.state,
          message: `判不出该建什么：就绪度=${before.state}，但清单里的文件都在。`
            + '⚠ 这通常意味着账本格式或单元内容需要人确认 ⇒ 先用 `hob_ledger_status` 看明细。',
          ledgerRoot: root,
        } as unknown as JsonValue
      }
      if (dryRun) {
        return {
          ok: true,
          dryRun: true,
          state: before.state,
          willCreate: plan.map((p) => p.file),
          message: `[演练] 将新建 ${plan.length} 份文件：${plan.map((p) => p.file).join(' · ')}`
            + '\n  ⚠ 未落盘。确认后传 `dryRun: false` 真建。',
          ledgerRoot: root,
        } as unknown as JsonValue
      }
      const created: string[] = []
      const failures: Array<{ file: string; reason?: string; message: string }> = []
      for (const item of plan) {
        const w = await writeHobFile(root, {
          file: item.file,
          content: item.content,
          mode: item.mode,
          ...(item.reason === undefined ? {} : { reason: item.reason }),
        }, {
          hobDir: '',
          keepBackups: DEFAULTS.keepBackups,
          shrinkGuard: DEFAULTS.shrinkGuard,
          maxFileBytes: cfg.maxWriteBytes ?? DEFAULTS.maxWriteBytes,
        })
        if (w.ok === true) created.push(item.file)
        else failures.push({ file: item.file, ...(w.reason === undefined ? {} : { reason: w.reason }), message: w.message })
      }
      const after = ledgerReadinessOfRoot(root)
      /**
       * A successful init creates or repairs the project ledger root. The
       * catalog view must re-read even when no unit content was added.
       */
      if (failures.length === 0) publishLiveChangeForLedger(root, ['catalog'])
      return {
        ok: failures.length === 0,
        state: after.state,
        created,
        ...(failures.length === 0 ? {} : { failures }),
        message: failures.length === 0
          ? `已建 ${created.length} 份：${created.join(' · ')}。`
            + `\n  现在就绪度 = ${after.state}：${after.headline}`
            + (after.state === 'ready' ? '' : ` ⇒ ${after.nextAction}`)
          : `${created.length} 份成功、${failures.length} 份失败：${failures.map((f) => `${f.file}（${f.reason ?? '?'}）`).join('；')}`,
        ledgerRoot: root,
      } as unknown as JsonValue
    },
  })


  /**
   * Explicit archive-and-rebuild. Defaults to dry-run. The old ledger is copied
   * verbatim under archive/<date>-ledger-rebuild/source and verified before the
   * active tree is replaced; a failed copy leaves the active tree untouched.
   */
  const ledgerArchiveRebuild = defineTool({
    name: 'hob_ledger_rebuild',
    description: '**归档旧账并新建当前账本**：仅用于账本已失效 / 旧格式 / 无法作为当前账本继续。'
      + '默认只演练；真执行必须显式 `dryRun:false` 并给出 `reason`。'
      + '旧账整份进入 `archive/<YYYY-MM-DD>-ledger-rebuild/source/`，新账本从空需求开始；不回填旧批准或旧任务状态。',
    parameters: {
      reason: { type: 'string', description: '为什么这本账必须退出当前账本（必填，人读）。' },
      dryRun: { type: 'boolean', description: '缺省 true；真归档重建必须显式 false。' },
    },
    output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: String((v as { message?: string })?.message ?? '') }] },
    async execute(args: { reason?: string; dryRun?: boolean }, exec: ToolRunContext): Promise<JsonValue> {
      const root = ledgerRootOf(cfg, exec)
      if (root === undefined) return { ok: false, reason: 'no-ledger-root', message: '账本落点判不出。' } as unknown as JsonValue
      const reason = String(args?.reason ?? '').trim()
      if (reason === '') return { ok: false, reason: 'reason-required', message: '归档重建必须写 reason。' } as unknown as JsonValue
      const before = ledgerLifecycleOfRoot(root)
      if (before.state === 'missing' || (before.integrity === 'empty' && before.activation === 'active')) {
        return { ok: false, reason: 'nothing-to-rebuild', message: `${before.headline} ⇒ 当前账本无需归档重建。`, lifecycle: before } as unknown as JsonValue
      }
      if (before.state === 'active' && before.integrity === 'valid') {
        return { ok: false, reason: 'active-ledger', message: '当前账本健康且已激活；归档重建是失效账本的退出路径，不用于正常项目。', lifecycle: before } as unknown as JsonValue
      }
      const dryRun = args?.dryRun !== false
      if (dryRun) {
        return { ok: true, dryRun: true, state: before.state, message: `[演练] 将归档 ${root} 到 archive/<date>-ledger-rebuild/source，并从模板新建空账。`, lifecycle: before } as unknown as JsonValue
      }
      const workspaceName = root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? 'project'
      const now = new Date()
      const iso = now.toISOString()
      const stamp = iso.slice(0, 10)
      const archiveDir = join(root, 'archive', `${stamp}-ledger-rebuild`)
      const sourceDir = join(archiveDir, 'source')
      if (existsSync(archiveDir)) return { ok: false, reason: 'archive-target-exists', message: `归档目录已存在：${archiveDir} ⇒ 不覆盖历史。` } as unknown as JsonValue
      try {
        mkdirSync(archiveDir, { recursive: true })
        /** Copy the whole ledger except its own archive/backups to avoid recursive nesting. */
        for (const name of readdirSync(root)) {
          if (name === 'archive' || name === 'backups' || name === 'runtime') continue
          cpSync(join(root, name), join(sourceDir, name), { recursive: true })
        }
        const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)])
        const files = walk(sourceDir)
        const hash = createHash('sha256')
        let bytes = 0
        for (const f of files.sort()) { const b = readFileSync(f); bytes += b.length; hash.update(f.slice(sourceDir.length)); hash.update(b) }
        const activation = before.ledgerId === undefined ? undefined : { id: before.ledgerId, gen: before.generation }
        const manifest = renderLedgerArchiveManifest({
          ledger_id: activation?.id ?? workspaceName, workspace: workspaceName,
          generation: activation?.gen ?? '1', archived_at: iso, reason,
          source_digest: `sha256:${hash.digest('hex')}`, source_bytes: bytes, source_files: files.length,
          next_generation: nextGenerationOf(activation?.gen),
        })
        writeFileSync(join(archiveDir, 'MANIFEST.toml'), manifest)
        /**
         * Keep the original active tree until the new empty ledger has been
         * written. `source/` is already the verified immutable copy, so the
         * replacement becomes visible only after both mandatory files exist.
         */
        const holding = join(root, `.ledger-rebuild-${process.pid}-${Date.now()}`)
        const originalLedger = join(root, 'ledger')
        const originalActivation = join(root, 'ledger.toml')
        renameSync(originalLedger, holding)
        const heldActivation = `${holding}.ledger-toml`
        if (existsSync(originalActivation)) renameSync(originalActivation, heldActivation)
        try {
          mkdirSync(join(root, 'ledger', 'units'), { recursive: true })
          const w1 = await writeHobFile(root, { file: 'ledger/units/index.toml', content: initialIndexToml(iso), mode: 'append' }, { hobDir: '', keepBackups: DEFAULTS.keepBackups, shrinkGuard: DEFAULTS.shrinkGuard, maxFileBytes: cfg.maxWriteBytes ?? DEFAULTS.maxWriteBytes })
          const w2 = await writeHobFile(root, { file: 'ledger.toml', content: initialLedgerActivation({ ledgerId: `${workspaceName}-${iso.replace(/[^0-9]/g, '').slice(0, 14)}`, workspace: workspaceName, generation: nextGenerationOf(activation?.gen), predecessor: activation?.id, createdAt: iso }), mode: 'append' }, { hobDir: '', keepBackups: DEFAULTS.keepBackups, shrinkGuard: DEFAULTS.shrinkGuard, maxFileBytes: cfg.maxWriteBytes ?? DEFAULTS.maxWriteBytes })
          if (!w1.ok || !w2.ok) throw new Error(`新账本写入未完成：${w1.message}；${w2.message}`)
          /** The verified source copy is the durable archive; holding is removed only here. */
          rmSync(holding, { recursive: true, force: true })
          rmSync(heldActivation, { force: true })
            const after = ledgerLifecycleOfRoot(root)
          publishLiveChangeForLedger(root, ['catalog'])
          return { ok: after.state === 'active', archived: `${stamp}-ledger-rebuild`, manifest: join(archiveDir, 'MANIFEST.toml'), lifecycle: after, message: after.state === 'active' ? `已归档旧账并建立空账本；现在就绪度=${after.headline}。` : `归档副本已生成，但新账本没有启用：${after.headline}` } as unknown as JsonValue
        } catch (e) {
          /** Restore the active tree if the replacement failed; never leave a half ledger. */
          try {
            rmSync(join(root, 'ledger'), { recursive: true, force: true })
            if (existsSync(holding)) renameSync(holding, join(root, 'ledger'))
            if (existsSync(heldActivation)) renameSync(heldActivation, join(root, 'ledger.toml'))
          } catch { /* keep the original error visible */ }
          return { ok: false, reason: 'archive-rebuild-failed', message: `归档重建失败，当前账本已撤销替换：${String((e as Error)?.message ?? e)}` } as unknown as JsonValue
        }
      } catch (e) {
        return { ok: false, reason: 'archive-rebuild-failed', message: `归档重建失败：${String((e as Error)?.message ?? e)}` } as unknown as JsonValue
      }
    },
  })

  return {
    readContracts,
    writeHob: cfg.enableWrite === false ? undefined : writeHob,
    readWorkspaceDoc,
    globWorkspace,
    grepWorkspaceTool,
    readWorkspaceImage: readWorkspaceImageTool,
    ledgerStatus,
    ledgerInit,
    ledgerMigrate,
    ledgerApprove,
    ledgerArchiveRebuild,
  }
}

export function apply(ctx: any): void {
  /**
   * ── ⚠⚠ **「首次铺骨架」开关已退役**（O-14 · 2026-11-11）──────────────────
   *
   * ⚠ **这段注释原来描述的是一套已经不存在的机制**：
   *   它说权威读取器是 `config.ts` 的 `skeletonEnabled()`，
   *   而 `grep -rn skeletonEnabled src/config.ts` ⇒ **零命中**（函数已删）。
   *   同类描述在本文件还有 7 处（`:146` / `:1296` / `:2733` / `:2735` /
   *   `:2737` / `:2745` / `:2752` / `:2755`），全部指向那个不存在的函数。
   *
   * ⚠ **为什么必须改而不是留**：读这段的人会去找 `configFace.skeletonEnabled()`，
   *   找不到，然后怀疑自己看错了文件或版本。**一段指向不存在代码的注释，
   *   比没有注释更坏** —— 它消耗的是排查时间。
   *
   * ⚠ **现在的实况**（照实写）：
   *   · 「首次铺骨架」**不再是用户可关的开关**；`scaffoldSkeletonForWorkspace`
   *     仍会被调用（`createHobTools` 里那处），但它**没有开关**，总是执行；
   *   · `deps.skeletonEnabledOf` 这个注入点**仍存在**（机检/夹具在用，
   *     `check:orch` 的 SM-a/SM-b 依赖它），⛔ 不要删 —— 但**它不再由用户配置驱动**。
   *
   * ⛔ **不要试图复活那个开关**：它退役时删掉的不只是一个函数，还有它背后
   *   「预设行配置 vs 插件入口配置」两套配置的分工。复活要先把那套分工重新设计。
   */
  /**
   * ── ⚠ `inject = ['tools']` 的**真实使用点**（2026-10-24 · 本单必修 6）────────
   *   改前这条声明只当"加载门禁"用，`apply` 里**一次都没读 `ctx.tools`**。
   *   现在读它一次并据此决定**要不要提供门禁服务**：
   *     宿主 `tools` 服务存在但**没有 `register`**（版本错配 / 精简夹具）⇒
   *     门禁服务**不提供** + 一行 warn ⇒ 预设行**不注册**工具（它只等门禁），
   *     而不是"注册到一半炸在 `ctx.tools.register is not a function`"。
   *   ⚠ 真实宿主（`ToolsService`）一直有 `register` ⇒ 正常路径行为**未变**。
   *   ⚠ 用一个 `let` 承接（而不是提前 return）：卸载 effect 与调试日志仍要挂上，
   *     否则"模块装上了但什么都没说"又是一种静默。
   */
  const toolsSvc = (() => {
    try { return ctx.get?.('tools') ?? ctx.tools } catch { return undefined }
  })()
  const registerOk = typeof toolsSvc?.register === 'function'

  if (registerOk) {
    ctx.provide(GATE_SERVICE, {
      version: 1,
      module: name,
      /**
       * ⚠ **本门禁负责注册的工具名**（= {@link GATE_OWNED_TOOL_NAMES} 的运行时投影）。
       *
       * 为什么让门禁把它带出去：预设行那两处名字集（装配期过滤 / 执行前拦截）需要知道
       * "哪些名字的注册面在门禁后面"。让它们**从门禁读**，就不必另抄一份常量、
       * 也不会出现"门禁改了、预设的清单没跟上"（本轮第 4 条的成因就是这个方向）。
       * ⚠ 只在门禁**在场**时有意义；门禁不在 ⇒ 预设读不到 ⇒ 回落它自己的名字集
       *   （那正是 {@link visibleToolsFor} 要处理的那一侧）。
       */
      toolNames: GATE_OWNED_TOOL_NAMES,
    })
  } else {
    ctx.logger?.warn?.(
      `[${name}] 宿主 \`tools\` 服务**没有 register()**（版本错配？）⇒ **不提供门禁 ${GATE_SERVICE}**：`
      + '预设行因此不会注册任何工具（⛔ 不假装就绪，也⛔ 不在注册到一半时炸）。',
    )
  }

  // 资源示范 + 卸载纪律：卸载时打印一行，便于诊断"模块真的被拆干净了"。
  ctx.effect(() => {
    return () => {
      ctx.logger?.debug?.(`[${name}] 已卸载（门禁 ${GATE_SERVICE} 随之消失）`)
    }
  }, `${name}: gate`)

  // ── v4：批 6 的「实施侧专属收窄」**已整段删除** ──────────────────────
  //   它由 `installWorkPresetDeny` 提供，唯一服务对象是 **Hob-Execute** 预设。
  //   v4 用户决策 D1「删掉 Hob-Execute」+ D2「执行交给任意会话」之后：
  //   · 该预设已不存在（`preset-dsh-hob-work.patch.yml` 已删、bundle 项已摘）
  //   · 收窄的判据 `WORK_PRESET_ID` / `presetIdOf` 随之失去对象
  //   ⇒ 连同 `src/modules/work-deny.ts`（121 行）一并删除；顺带解除了
  //     `tools.ts ↔ work-deny.ts` 的**循环依赖**（EXPERIENCE E-* 已记录该形态）。
  //   ⚠ 契约的「禁弹窗」纪律**不因此消失**：它改由**指令文本**承担
  //     —— Hob 写 TASK.md 时明写要求，不再依赖预设级收窄（见方案 §3.2）。

  ctx.logger?.debug?.(`[${name}] 已激活：已提供门禁 ${GATE_SERVICE}；工具定义由预设行在预设作用域注册`)
}
