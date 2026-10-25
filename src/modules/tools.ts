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
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { readMarkdownCapped, resolveLedgerRoot, resolveWorkspaceRoot } from '../server/doc-read.ts'
import {
  grepWorkspace as grepWorkspaceText,
  globWorkspace as globWorkspacePaths,
  readWorkspaceImage as readWorkspaceImageBytes,
  readWorkspaceText,
} from '../server/workspace-read.ts'
import { basename } from 'node:path'
import { LEDGER_FILES, writeHobFile } from '../server/hob-write.ts'
// ── 首次铺骨架（2026-10-16 第 224 轮 · `UD-118`「C」）──────────────────────
//   ⚠ 它是**插件的初始化行为**，⛔ 不是工具：⚠ 本模块的参数表**一个字段都没加**。
import { scaffoldSkeletonForWorkspace } from '../server/skeleton.ts'
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
// ── 「首次铺骨架」开关的**唯一解 ref 点**（2026-10-24 · 本单必修 3）───────────
//   ⚠ `skeleton.enabled` 标了 `.volatile()` ⇒ 运行时是 **ref 对象**，直读拿到的是 ref
//     （恒 truthy、且不报错）。⇒ 一律经 `config.ts` 的 `skeletonEnabled()` 解。
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
 */
export const DEFAULT_DENY = [
  'interconnect_send',
  'interconnect_reply',
  'interconnect_ping',
  'interconnect_list',
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

/** @deprecated v4 起账本已迁出工作区，账本位置改由 {@link ledgerRootOf} 解析。 */
export function hobDirOf(cfg: HobToolsConfig): string {
  return cfg.hobDir ?? DEFAULTS.hobDir
}

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
   * **现读**「首次铺骨架」开关（2026-10-16 第 224 轮 · `UD-118`「C」）。
   *
   * ⚠ 与 `levelOf` 同一条纪律：必须是**函数**（⛔ 不是值）——
   *   `skeleton.enabled` 标了 `.volatile()`（运行时是 ref 对象），
   *   ⚠ 在 `createHobTools` 时读一次就是**装配期快照** ⇒ 用户改完开关后
   *   **已开的会话仍按旧值**走到重挂载为止（正是 `spawnDefaults` 那条教训）。
   *
   * ── ⚠⚠ **2026-10-24 订正：它是【兜底】，不是权威** ─────────────────────
   *   权威是 {@link setEntrySkeletonSwitch}（由 `apply` 从**插件入口配置**装上）。
   *   **优先级：入口配置 > 本字段 > 兜底 `true`**（见 `writeHob` 里那段取值注释）。
   *
   *   ⚠ 为什么本字段**注定读不到用户那个开关**：真机唯一注入它的是
   *   `src/preset/tools.ts`，传的是 `configFace.skeletonEnabled(config)` —— 那个
   *   `config` 是**预设行的配置**（`HobToolsConfig`：workspaceRoot / ledgerHome / …），
   *   **没有 `skeleton` 段** ⇒ `skeletonEnabled()` 按兜底返回 `true`。
   *   ⇒ 只靠本字段 = **空旋钮**（用户在设置页关掉，照样铺骨架）。这正是本单必修 3。
   *
   *   ⚠ 那为什么**不删掉它**：不跑 `apply` 的调用方（`check:orch` 的 SM-a/SM-b
   *   直接 `createHobTools(cfg, { skeletonEnabledOf: () => true })`）靠它指定行为；
   *   删了会打断既有机检路径。⇒ 保留为**降级路径**，但**不再是权威**。
   *   ⚠ 缺席 ⇒ 按 schema 的 `.default(true)` 处理（理由见 `skeleton.ts` 的兜底注释）。
   */
  skeletonEnabledOf?: () => boolean
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
let entrySkeletonSwitch: (() => boolean) | undefined

/** 写入权威读取器（只由 `apply` 调用）。 */
export function setEntrySkeletonSwitch(fn: (() => boolean) | undefined): void {
  entrySkeletonSwitch = fn
}

/** 读当前权威值（⚠ 没装 `apply` 时返回 `undefined`，调用方据此退回注入值 / 兜底）。 */
export function currentEntrySkeletonSwitch(): boolean | undefined {
  try {
    return typeof entrySkeletonSwitch === 'function' ? entrySkeletonSwitch() : undefined
  } catch {
    return undefined
  }
}

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
 *   退回 `deps.skeletonEnabledOf`（既有行为）。判据是"取不到 ≠ 关掉"。
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
} {
  const readContracts = defineTool({
    name: 'read_contracts',
    description: '只读本工作区账本内的 .md（项目方案/决策记录/用户决策/工作上下文）。',
    parameters: {
      path: {
        type: 'string',
        required: true,
        // ⚠ 2026-10-10（UD-88 / CHG-025）：原文写「相对**工作区根目录**…如 README.md、PROJECT.md」
        //    ——**两处都不实**：解析根**一直是账本区**（v4 / D7），工作区根本读不到（D6）；
        //    而 `PROJECT.md` 也**已于本批移入账本区**。⇒ 改准：根 = 账本区，示例换成账本区里真实存在的文件。
        description: '相对**账本区根目录**的 .md 路径，如 PROJECT.md、CONTEXT.md。',
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
      + 'append=追加一条（默认，编号须与账本现有编号连续）；overwrite=整文件重写（受缩水守卫保护）。'
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
        description: 'append（默认）/ overwrite；归档目录不允许 overwrite。',
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
        description: '（可选）写完**紧接着投递**给这个会话 id（取自 hob_sessions；不自动挑会话）。'
          + '投递走与 hob_dispatch 同一条路径（登记回传 + 清"待投递"），返回值会附投递后的"待投递"读数。',
      },
      delivery: {
        type: 'string',
        enum: ['manual'],
        description: '（可选）`manual` = 本轮**有意人工转达**（不自动投）⇒ 该条待投递记录带标注，'
          + '状态行会把"有意转达"与"漏投"分开报。⚠ 与 dispatchTo 同时给时以 dispatchTo（真投）为准。',
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
        reason?: string
        dryRun?: boolean
        dispatchTo?: string
        delivery?: 'manual'
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
      // v4：账本目录按工作区派生（在工作区之外）⇒ 边界仍是「账本目录」，只是位置变了。
      const root = ledgerRootOf(cfg, exec)
      if (root === undefined) {
        return JSON.stringify({ ok: false, reason: 'no-ledger-root', message: '拒绝：无法确定账本目录。' })
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
      // ── ⚠ 触发点：**首次在某工作区干活时铺骨架**（2026-10-16 第 224 轮 · `UD-118`「C」）──
      //   ⚠ **为什么挂在这里**：本工具是插件**唯一**会在"某个工作区"里干活的动作
      //     （`rootOf(cfg, exec)` 从**本会话**解析出那个工作区根）⇒ ⚠ 它就是
      //     "插件为该工作区初始化"这句话的**物理落点**，⛔ 不必另造一个触发器。
      //   ⚠ **"什么叫首次"** = ⚠ **那个工作区根的 `.hob/` 目录还不存在**
      //     （⚠ 判据在 `skeleton.ts` 的 `scaffoldSkeletonOnce`：已存在 ⇒ 整目录跳过、
      //     ⛔ 一个字节都不动）⇒ ⚠ **重复调用是空操作**（幂等靠**盘上的既成事实**，
      //     ⛔ 不靠这里记"铺过了"）。
      //   ⚠ ⚠ **⛔ 它不是一个工具**（**约束 ⑥**）：⚠ 本工具的参数表**一个字段都没加**，
      //     Hob 的工具面**不扩** —— ⚠ 这是**插件的初始化行为**，与"注册模块"同一档。
      //   ⚠⚠ **只在「真写**且**写成功」时触发**（2026-10-21 · 第 329 轮 · **甲-10** 要求 1）——
      //     条件 = `args.dryRun !== true` **且** `r.ok`。
      //     ⚠ **改前只判了 `dryRun`，`r.ok` 一个字没判** —— 于是**写被拒时照样把骨架铺下去**：
      //       用户想写的文件没写成，`.hob/` 却被建了出来（一次被拒的写入留下了它不该留的东西）。
      //       ⚠ 而 `:637` 原注释还写着"只在真写时触发" ⇒ **注释与代码方向相反**（TASK 明令要改）。
      //     ⚠ dryRun 那一半的理由不变：它的语义是"只看会发生什么、⛔ 不落盘"
      //       ⇒ 在 dryRun 上真去建目录会**违背它自己的承诺**。
      //   ⚠ ⚠ **不改写写入语义**：⚠ 骨架铺没铺、铺成没铺成，⛔ **都不影响**写入的结果字段 ——
      //     只在返回值里**新增**一个 `skeletonScaffold` 字段如实回带（⛔ 不掩盖、⛔ 不冒充成功）。
      /**
       * ⚠ 类型带上 **`completeness`**（甲-10 要求 2）：`已铺 N / 共 M` 必须**能在
       *   `write_hob` 的返回里看见**。⚠ 改前这个字段根本不存在 ⇒ 读者只看到
       *   `written: [a,b,c,d]` 这个**没有分母**的分子，看不出是不是"半套"。
       */
      let skeletonNote: {
        ok: boolean
        wrote: boolean
        written: readonly string[]
        notes: readonly { kind: string; message: string }[]
        completeness: { total: number; scaffolded: number; skippedExists: number; failed: number }
      } | undefined
      /**
       * ⚠⚠ **触发条件 = 真写 且 写成功**（甲-10）。⛔ 不许只判 `dryRun`。
       *   ⚠ 为什么不判 `r.ok` 会更糟：`r.ok === false` 的写入（越权 / 白名单外 / 目标不存在）
       *     **一个字节都没落盘**，而这里却会建 `.hob/` 目录树 ⇒ 用户看到"被拒了但多了个目录"。
       *   ⚠ `dryRun` 时 `r.ok` 是 `true`（预览成功）⇒ 两个条件都必须有，⛔ 不能只用 `r.ok`。
       */
      if (args.dryRun !== true && r.ok === true) {
        const wsRoot = rootOf(cfg, exec)
        if (wsRoot === undefined) {
          // ⚠ 判不出工作区根 ⇒ **如实说**，⛔ 不猜、⛔ 不拿账本区顶上（fail-closed）。
          skeletonNote = {
            ok: false, wrote: false, written: [],
            notes: [{ kind: 'source-missing', message: '首次铺骨架：判不出工作区根 ⇒ ⛔ 未铺任何文件（fail-closed，不猜）。' }],
            completeness: { total: 0, scaffolded: 0, skippedExists: 0, failed: 0 },
          }
        } else {
          /**
           * ⚠⚠ **开关值的取法（2026-10-24 修正 · 治"空旋钮"）** ────────────────
           *   **优先级：入口配置（权威） > 注入的 `deps.skeletonEnabledOf` > 兜底 `true`**。
           *
           *   ① `currentEntrySkeletonSwitch()` —— 由 {@link apply} 从**插件入口配置**装上的
           *      现读器（`configFace.skeletonEnabled(入口 config)`）。**这才是用户那个开关**。
           *   ② 注入的那个 —— ⚠ 真机它读的是**预设行配置**（`HobToolsConfig`，没有 `skeleton`
           *      段）⇒ 恒落到兜底 `true`（**这就是空旋钮的成因**）。保留它只为
           *      **不跑 `apply` 的调用方**（机检 SM-a/SM-b 直接传 `() => true`；语义不变）。
           *   ③ 两者都没有 ⇒ `true`（与 schema 的 `.default(true)` 一致，理由见 `skeleton.ts`）。
           *
           *   ⚠ 为什么这一层不能"只用注入的"：那样关掉开关**永远不生效**（本单必修 3 的病灶）；
           *   ⚠ 也不能"只读入口配置、丢掉注入"：那会打断机检直接调 `createHobTools` 的既有路径
           *     （它们没有 ctx，拿不到入口配置）。
           */
          const authoritative = currentEntrySkeletonSwitch()
          const injected = deps.skeletonEnabledOf?.()
          const enabled = authoritative ?? injected ?? true
          skeletonNote = scaffoldSkeletonForWorkspace(wsRoot, enabled)
        }
      }
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
            }),
          // ⚠ 投递后（或直接标注后）的**待投递读数** —— 让"清干净了没有"当场可见
          // ⚠ ⚠ **并把可达性带上**（2026-10-16 第 247 轮 · `TASK-R207`）——
          //   治的是"**够不到账本**"与"**真的没有待投递**"给同一读数这个缺陷
          //   （第 243 轮实测 · `REPORT-R205.md` §3.2-c）。
          handoffReading: renderHandoffReading(res.handoffs, res.reachability),
          ...(skeletonNote === undefined ? {} : { skeletonScaffold: skeletonNote }),
        })
      }
      return JSON.stringify({
        ...r,
        ...(skeletonNote === undefined ? {} : { skeletonScaffold: skeletonNote }),
      })
    },
  })

  return {
    readContracts,
    writeHob: cfg.enableWrite === false ? undefined : writeHob,
    readWorkspaceDoc,
    globWorkspace,
    grepWorkspaceTool,
    readWorkspaceImage: readWorkspaceImageTool,
  }
}

export function apply(ctx: any): void {
  /**
   * ⚠⚠ **「首次铺骨架」开关的权威读取器**（2026-10-24 · 本单必修 3 —— 治"空旋钮"）────
   *
   * ── 改前是什么（实测出来的空旋钮）───────────────────────────────────────
   *   消费点（本文件 `createHobTools` 里那次 `scaffoldSkeletonForWorkspace(wsRoot, …)`）
   *   拿的是**注入进来的** `deps.skeletonEnabledOf`。而真机唯一注入它的是
   *   `src/preset/tools.ts`，那里传的是
   *   `configFace.skeletonEnabled(config)` —— ⚠ 那个 `config` 是**预设行的配置**
   *   （`HobToolsConfig`：workspaceRoot / ledgerHome / maxFileBytes…），**根本没有
   *   `skeleton` 段** ⇒ `skeletonEnabled()` 读不到 ⇒ 按它自己的兜底返回 **`true`**。
   *   ⇒ 用户在设置页把「首次铺骨架」关掉，**写进了插件配置、却没有人读**
   *     （消费点读的是另一份配置里不存在的键）⇒ 关掉照样铺骨架 = **空旋钮**。
   *
   * ── 现在：从**插件入口配置**读（唯一权威），不再依赖预设行转手 ────────────
   *   `apply` 的 ctx 是**模块 fiber 的 ctx**，它的 `parent.fiber` 就是**插件入口条目**
   *   （`id: dsh-hob`）的 fiber，`config` 正是那份带 `skeleton.enabled` 的插件配置。
   *   ⇒ 这里取一次**配置对象本身**（⚠ 不是取一次**值**），读取器每次调用时现解 ref
   *     （`configFace.skeletonEnabled()` 内部 `deref()`）⇒ 设置页改完**下一次写入即生效**
   *     （volatile ref 原地更新，宿主不重挂载）。
   *
   * ── ⚠ 为什么"取对象"而不是"取值"─────────────────────────────────────
   *   取一次值 = 装配期快照 ⇒ 用户改完开关后已开实例仍按旧值走到重挂载为止
   *   （与 `spawnDefaults` / `levelOf` 同一条教训）。
   *
   * ── ⚠ 与注入进来的 `deps.skeletonEnabledOf` 的关系（向后兼容）──────────
   *   · **有权威读取器时以权威为准**（它就是用户的开关）；
   *   · **没有时退回注入的那个**（机检/夹具直接 `createHobTools(...)` 不跑 `apply`，
   *     它们传的 `skeletonEnabledOf: () => true` 照旧生效 ⇒ `check:orch` 的 SM-a/SM-b 不变）。
   *   ⚠ 预设行那份传参因此**不再影响行为**（它读的是预设行配置，天生读不到本开关）；
   *     C 席应把它删掉或改成从门禁读（见交付报告「需转派」清单）。
   */
  const entryConfig = pluginEntryConfigOf(ctx)
  if (entryConfig !== undefined) {
    setEntrySkeletonSwitch(() => configFace.skeletonEnabled(entryConfig))
  }

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
      /**
       * ⚠ 门禁**顺带**回带"铺骨架开关此刻的值"（只读、现解 ref）。
       *   消费方（将来的预设行 / 诊断）可以从门禁拿到**同一份权威**，
       *   ⛔ 不必再去读预设行配置里那个不存在的键（那正是空旋钮的成因）。
       */
      skeletonEnabledOf: () => currentEntrySkeletonSwitch(),
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
