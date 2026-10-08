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
import { readMarkdownCapped, resolveLedgerRoot, resolveWorkspaceRoot } from '../server/doc-read.ts'
import { LEDGER_FILES, writeHobFile } from '../server/hob-write.ts'

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
   *   累计 2.3 MB（见 `.hob/FACTS.md` F-J25）—— **一个只读用途的诊断不该有写盘副作用**。
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
 * 工具定义工厂 —— **两个工具的唯一实现处**。
 *
 * 返回 `{ readContracts, writeHob }` 两个 `defineTool` 结果（写工具在
 * `enableWrite === false` 时为 `undefined`，即"根本不出现"）。
 * 调用方（预设行模块）负责在**正确的（预设）作用域**里注册它们。
 *
 * @param cfg - 该挂载点的配置（预设行传入）。
 */
export function createHobTools(cfg: HobToolsConfig = {}): {
  readContracts: ReturnType<typeof defineTool>
  writeHob: ReturnType<typeof defineTool> | undefined
} {
  const readContracts = defineTool({
    name: 'read_contracts',
    description: '只读本工作区账本内的 .md（决策记录 / 事实账 / 上下文）。',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: '相对工作区根目录的 .md 路径，如 README.md、PROJECT.md',
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

  if (cfg.enableWrite === false) return { readContracts, writeHob: undefined }

  const writeHob = defineTool({
    name: 'write_hob',
    description:
      '向本工作区的账本写入内容（账本在工作区之外，按工作区名独立存放）。'
      + '可写文件：' + LEDGER_FILES.join(' / ') + '，以及 archive/<YYYY-MM-DD-slug>/*.md；'
      + '骨架（README.md / templates/）只读。'
      + 'append=追加一条（默认，编号须与账本现有编号连续）；overwrite=整文件重写（受缩水守卫保护）。'
      + '写入前自动备份到 .hob/backups/；相同编号+相同内容会被幂等跳过。'
      + '建议先用 dryRun:true 预演。',
    parameters: {
      file: {
        type: 'string',
        required: true,
        description: '相对 .hob/ 的路径，如 FACTS.md、USER-DECISIONS.md、archive/2026-10-03-xxx/A.md',
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
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(
      args: { file: string; content: string; mode?: 'append' | 'overwrite'; reason?: string; dryRun?: boolean },
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
        // （否则 hobRoot = <账本目录>/.hob，写成 `<工作区名>/.hob/FACTS.md`）。
        hobDir: '',
        keepBackups: DEFAULTS.keepBackups,
        shrinkGuard: DEFAULTS.shrinkGuard,
        maxFileBytes: cfg.maxWriteBytes ?? DEFAULTS.maxWriteBytes,
      })
      return JSON.stringify(r)
    },
  })

  return { readContracts, writeHob }
}

/**
 * 模块入口：**提供门禁服务**（不注册工具，理由见文件头）。
 *
 * 资源纪律：门禁用 `ctx.provide` 挂（它自己就是 effect）；另用 `ctx.effect`
 * 挂一条卸载钩子，保证热重载/卸载时**没有任何残留**（§3.3 第 3 条）。
 */
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
