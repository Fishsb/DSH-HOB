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

/** 模块名（同时是 fiber 显示名）。 */
export const name = 'dsh-hob-tools'

/**
 * **硬依赖**：`tools` 服务不在时，本模块的 fiber 停在 `PENDING`（不激活）。
 *
 * 这是「模块可独立启停」的**第二条路径**（第一条是 `modules.tools` 配置开关）：
 * 环境缺依赖 ⇒ 模块自动不加载，**宿主不报错、插件整体照常**。
 * 语义依据（cordis）：`FiberState.PENDING = 0` — "waiting for required services"
 * （`@deepseek-ai/cordis/lib/types/fiber.d.ts:60-68`）。
 */
export const inject = ['tools']

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
   * **现读**当前权限档位（`ledger` / `project` / `workspace`）。
   *
   * ⚠ 必须是**函数**（不是值）：档位可以**随时改**（volatile 值型配置，改完即生效），
   *   若在 `createHobTools` 时读一次存起来，就成了"装配期快照"——
   *   用户改完档位后**已开的会话仍按旧档**走到重挂载为止。
   *   ⇒ 四个读工具在**每次 execute** 时调它（与 `src/preset/tools.ts` 的
   *   装配期过滤"现读档位"是同一口径）。
   *
   * 缺席 / 抛异常 / 返回值不是三档之一 ⇒ 按**最保守**的 `ledger` 处理（fail-closed）。
   */
  levelOf?: () => string
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
    description: '只读本工作区账本内的 .md（项目方案 / 决策记录 / 用户决策 / 工作上下文）。',
    parameters: {
      path: {
        type: 'string',
        required: true,
        // ⚠ 2026-10-10（UD-88 / CHG-025）：原文写「相对**工作区根目录**…如 README.md、PROJECT.md」
        //    ——**两处都不实**：解析根**一直是账本区**（v4 / D7），工作区根本读不到（D6）；
        //    而 `PROJECT.md` 也**已于本批移入账本区**。⇒ 改准：根 = 账本区，示例换成账本区里真实存在的文件。
        description: '相对**账本区根目录**的 .md 路径，如 PROJECT.md、CONTEXT.md、DECISIONS.md、USER-DECISIONS.md',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: { path: string }, exec: ToolRunContext): Promise<string> {
      // v4：边界改为**账本目录**（D7）—— 只读自己的账本，不读工作区内的项目文档（D6）。
      const root = ledgerRootOf(cfg, exec)
      if (root === undefined) return '拒绝：无法确定账本目录。'
      const r = await readMarkdownCapped(root, args.path, cfg.maxFileBytes ?? DEFAULTS.maxFileBytes)
      return r.text
    },
  })

  // ── 权限档位的**读能力**四个工具（2026-10-14 第 144 轮）─────────────────
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
  const levelNow = (): string => {
    try {
      const v = deps.levelOf?.()
      return typeof v === 'string' && v !== '' ? v : 'ledger'
    } catch {
      // ⚠ 判不出档位 ⇒ 按**最保守**的档处理（与 `doc-read.ts` 的 fail-closed 同口径）。
      return 'ledger'
    }
  }
  const workspaceRootOf = (exec: ToolRunContext): string | undefined => rootOf(cfg, exec)
  const maxReadBytes = cfg.maxFileBytes ?? DEFAULTS.maxFileBytes

  const readWorkspaceDoc = defineTool({
    name: 'hob_read_doc',
    description:
      '只读本工作区内的文件（⛔ 不能写、不能改）。'
      + '⚠ 可读范围**随本会话的权限档位变**：'
      + '「项目」档**只可读 .md**；「工作区」档**工作区里的文件都可读取查看**（含代码与图片）。'
      + '越出工作区、软链一律拒绝。'
      + '⚠ 三种内容分别处理：文本 ⇒ 返回正文；二进制 / 非 UTF-8 ⇒ 只给一句短提示（⛔ 不吐乱码）；'
      + '图片 ⇒ 提示改用 hob_read_image。'
      + `⚠ 大文件会被截断并在尾部标注（单文件上限 ${65536} 字节）；需要后续内容用 offset/limit 分段读。`,
    parameters: {
      path: { type: 'string', required: true, description: '工作区内的相对路径（也可给工作区内的绝对路径），如 src/config.ts、.hob/README.md' },
      offset: { type: 'integer', description: '起始行（1 基）。缺省 = 从第 1 行。' },
      limit: { type: 'integer', description: '最多返回多少行。缺省 = 不按行切（只受字节上限约束）。' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: { path: string; offset?: number; limit?: number }, exec: ToolRunContext): Promise<string> {
      const root = workspaceRootOf(exec)
      if (root === undefined) return '拒绝：无法确定工作区目录。'
      const r = await readWorkspaceText(root, args.path, maxReadBytes, levelNow(), args.offset ?? 1, args.limit ?? 0)
      return r.text
    },
  })

  const globWorkspace = defineTool({
    name: 'hob_glob',
    description:
      '只列本工作区内的**文件路径**（⛔ 不读正文、不能写）。用于找文件 / 摸清目录结构。'
      + '⚠ 跳过 .git / node_modules / dist 等目录；软链不跟随；结果有上限。',
    parameters: {
      pattern: { type: 'string', required: true, description: 'glob 模式（相对工作区根），如 **/*.ts、docs/*.md、src/**/*.json' },
      limit: { type: 'integer', description: '最多返回多少条（缺省 200）。' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: { pattern: string; limit?: number }, exec: ToolRunContext): Promise<string> {
      const root = workspaceRootOf(exec)
      if (root === undefined) return '拒绝：无法确定工作区目录。'
      const r = await globWorkspacePaths(root, args.pattern, args.limit ?? 200)
      return r.text
    },
  })

  const grepWorkspaceTool = defineTool({
    name: 'hob_grep',
    description:
      '在本工作区**全部文件**里按正则搜索，返回**命中行**（⛔ 只读、不能写）。'
      + '⚠ 读不成文本的文件（二进制 / 非 UTF-8）**会被跳过**，并在结果里**注明跳过了几个**'
      + '（⛔ 不会把二进制正文当命中）。'
      + '⚠ 单文件与总量都有上限，被截断时会明说；软链不跟随。',
    parameters: {
      pattern: { type: 'string', required: true, description: '正则源（大小写敏感），如 "function\\s+\\w+"、TODO|FIXME' },
      path: { type: 'string', description: '限定在工作区内的某个子路径下搜（缺省 = 整个工作区）。' },
      limit: { type: 'integer', description: '最多返回多少条命中（缺省 200）。' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: { pattern: string; path?: string; limit?: number }, exec: ToolRunContext): Promise<string> {
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
      '读本工作区内的一张图片（PNG / JPEG / WebP / GIF）并把**图片本身**交给模型'
      + '（⛔ 只读、不能写、不能改图）。大图由宿主的附件服务自动缩小。'
      + '⚠ 只认工作区内的路径；不支持的类型 / 越界 / 软链 / 超上限一律拒绝。',
    parameters: {
      path: { type: 'string', required: true, description: '工作区内的图片路径，如 docs/shot.png、.hob/drafts/diagram.webp' },
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
      + '卷：volumes/<卷>/*.md；⚠ 卷下**具名两层**子目录另有一说（见 VOLUME_SUBDIRS）—— 本句是给人读的摘要，判据以写入侧常量为准。'
      + '骨架（README.md / templates/）只读。'
      + '⚠ `PROJECT.md`（项目方案）自 2026-10-10（UD-88 / CHG-025）起与账本同级、同在此可写面内；'
      + '但**方案只有用户能批准变更、Hob 只提议**（程序纪律，不是工具闸门）。'
      + 'append=追加一条（默认，编号须与账本现有编号连续）；overwrite=整文件重写（受缩水守卫保护）。'
      + '写入前自动备份到 .hob/backups/；相同编号+相同内容会被幂等跳过。'
      + '建议先用 dryRun:true 预演。',
    parameters: {
      file: {
        type: 'string',
        required: true,
        // ⚠ 原文写「相对 `.hob/` 的路径」——v4 起账本已外置，**没有 `.hob/` 这个前缀了**，
        //   那句话会让人以为要写 `.hob/CONTEXT.md`。改成与实现一致的措辞（根 = 账本区）。
        description: '账本区内的相对路径，如 CONTEXT.md、USER-DECISIONS.md、PROJECT.md、archive/2026-10-03-xxx/A.md',
      },
      content: {
        type: 'string',
        required: true,
        description: '要写入的 Markdown 文本。形状须符合对应账本的模板。',
      },
      mode: {
        type: 'string',
        enum: ['append', 'overwrite'],
        description: 'append=追加（默认）；overwrite=整文件重写。归档目录不允许 overwrite。',
      },
      reason: {
        type: 'string',
        description: '为什么写这一条（审计用；会随结果回显）。',
      },
      dryRun: {
        type: 'boolean',
        description: 'true=只跑全部校验、不落盘（推荐先试）。',
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
          handoffReading: renderHandoffReading(res.handoffs),
        })
      }
      return JSON.stringify(r)
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
  ctx.provide(GATE_SERVICE, { version: 1, module: name })

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
