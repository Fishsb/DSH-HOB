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
 * 且「助手 = `read_contracts` + `write_hob`，工具面恰好 2 个」是**验收判据**。
 * ⇒ 在插件作用域注册会**同时打破这两条**。所以本模块**不注册**。
 *
 * ── 那工具由谁注册 ─────────────────────────────────────────────────────
 * 由 `src/preset/tools.ts`（预设行引用的模块）在**预设作用域**里注册 ——
 * 预设作用域注册**不会漏**（实测：助手仍恰好 2 个、`minimal` 不变）。
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
import { readMarkdownCapped, resolveWorkspaceRoot } from '../server/doc-read.ts'
import { LEDGER_FILES, writeHobFile } from '../server/hob-write.ts'
import { installWorkPresetDeny } from './work-deny.ts'

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
  /** 账本目录名，相对工作区根。 */
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
  hobDir: '.hob',
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

/**
 * Hob-Execute（实施侧）的**预设 id** —— 批 6 那条收窄规则的判据字面值。
 *
 * ⚠ 与 `preset/dsh-hob/preset-dsh-hob-work.patch.yml` 的 `config.id` 同字面值
 *   （2026-10-07 批 2 起显示名与 id 同字面值）。**不是**包名 / 目录名 / loader 行 id。
 */
export const WORK_PRESET_ID = 'Hob-Execute'

/**
 * 要从 **Hob-Execute 的模型面**摘掉的工具名（UD-64 / CHG-012 · 2026-10-07 批 6）。
 *
 * ── 为什么要摘 ──────────────────────────────────────────────────────
 *   Hob-Execute **对接的是 Hob，不是用户**（见它的 `## Your duties`）。
 *   「弹出问题、等真人当场回答」这类工具会让它**中途停下来等人** ——
 *   而它等的那个"人"根本不是它的上游 ⇒ 任务是**堵塞**而不是被澄清。
 *   用户裁定（UD-64）：需要决策 ⇒ **把不含糊的部分做掉、把问题记录下来、
 *   随完成回报一并交回**；整件事被卡住 ⇒ **停在安全状态**并写进回报。
 *
 * ── 为什么是**一个显式名字**而不是前缀/通配 ─────────────────────────
 *   与「Hob」侧同款纪律（§6.3 允许清单思维）：将来新装的插件**不得自动**被摘。
 *   本批只摘**契约条文指名的那一个代表**。
 *
 * ── ⚠ 与 CHG-003「Hob-Execute 工具全给」的关系（如实标注，不美化）─────
 *   这是那条约定的**定点例外**：`ask_user_question` 一项不再适用"全给"。
 *   代价已知并由用户拍板（`.hob/USER-DECISIONS.md` UD-64 记「强度待用户裁定」，
 *   本批按"机制落地"执行）。
 *
 * ⚠ 本清单**只作用于 {@link WORK_PRESET_ID}**：判据见 {@link presetIdOf}，
 *   对「Hob」与宿主自带的 standard / minimal / cordis **一律不生效**
 *   （隔离实例逐预设对照读数见 `.hob/archive/2026-10-07-orchestration/evidence/`）。
 */
export const WORK_MODEL_DENY: readonly string[] = ['ask_user_question']

/**
 * 读出一个 **live Agent 当前所属的预设 id**（批 6 收窄规则的身份判据）。
 *
 * ── 为什么需要"当前"而不是"创建时"──────────────────────────────────
 *   `session.header.agentPreset` 是**创建事实**且冻结；而宿主允许会话在**首个 turn 之前**
 *   改预设（`agent-preset/selected`，见 `dsh-agent-preset-registry/lib/types/session.d.ts`：
 *   "Current Session preset, initialized from its header and advanced by selection events"）。
 *   用它当判据会在"改了预设但还没说话"这条窗口上判错。
 *
 * ── 两条路径（顺序有意义）──────────────────────────────────────────
 *   ① **权威**：`ctx.agentPresets.composedPreset(agent.ctx)`
 *      （`dsh-agent-preset-registry/lib/index.js:723-725` = `standingMountFor(ctx)?.presetId`，
 *       读的是 agent scope 的**父链**指向的那个 standing mount ⇒ 改过预设也正确）；
 *   ② **兜底**：`agent.session.header.agentPreset`（注册表读不到时的创建事实）。
 *
 * ⚠ 全程 fail-open：读不到 ⇒ 返回 `undefined` ⇒ 调用方**一律放行**。
 *   本规则是**收窄措施**，不是安全边界；把某个会话弄瘫比漏一个工具更糟
 *   （同 `src/preset/tools.ts` 的 `enforceToolAllowlist` 注释）。
 *
 * @param ctx - 任一能看到 `agentPresets` 服务的 ctx（插件平面即可）。
 * @param agent - 被判定调用的主体 agent；缺失 ⇒ undefined。
 * @returns 预设 id，读不到时为 `undefined`。
 */
export function presetIdOf(ctx: any, agent: any): string | undefined {
  if (agent === undefined || agent === null) return undefined
  try {
    const registry = ctx?.get?.('agentPresets')
    const viaRegistry = registry?.composedPreset?.(agent.ctx)
    if (typeof viaRegistry === 'string' && viaRegistry !== '') return viaRegistry
  } catch { /* 注册表缺席/抛错 ⇒ 退到创建事实 */ }
  try {
    const header = agent?.session?.header?.agentPreset
    if (typeof header === 'string' && header !== '') return header
  } catch { /* 结构不认识 ⇒ 视为未知 */ }
  return undefined
}

/** 解析工作区根：显式配置优先，其次会话 cwd；都没有则 undefined（fail-closed）。 */
export function rootOf(cfg: HobToolsConfig, exec: ToolRunContext): string | undefined {
  return resolveWorkspaceRoot(cfg.workspaceRoot ?? '', exec.agent?.session.header.cwd)
}

/** 账本目录名（带默认值）。 */
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
    description: '只读工作区内的 .md 文档（项目文档 / 决策记录）。',
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
      const root = rootOf(cfg, exec)
      if (root === undefined) return '拒绝：无法确定工作区根目录。'
      const r = await readMarkdownCapped(root, args.path, cfg.maxFileBytes ?? DEFAULTS.maxFileBytes)
      return r.text
    },
  })

  if (cfg.enableWrite === false) return { readContracts, writeHob: undefined }

  const writeHob = defineTool({
    name: 'write_hob',
    description:
      '向 .hob/ 账本写入内容。'
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
      const root = rootOf(cfg, exec)
      if (root === undefined) {
        return JSON.stringify({ ok: false, reason: 'no-workspace-root', message: '拒绝：无法确定工作区根目录。' })
      }
      const r = await writeHobFile(root, {
        file: args.file,
        content: args.content,
        ...(args.mode === undefined ? {} : { mode: args.mode }),
        ...(args.reason === undefined ? {} : { reason: args.reason }),
        ...(args.dryRun === undefined ? {} : { dryRun: args.dryRun }),
      }, {
        hobDir: hobDirOf(cfg),
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

  // ⚠ **批 6 新增**：实施侧专属收窄（UD-64 / CHG-012）挂在这里，理由**不是**"顺路"——
  //   本模块正是插件平面（宿主平面行 `id: dsh-hob`）的那一个落点，而收窄**必须**
  //   挂在插件平面才能覆盖到 Hob-Execute（它的预设行不引用本插件任何模块，够不到）。
  //   为什么不另开一个 `MODULE_REGISTRY` 模块行：那会在 `src/index.ts` 的登记表里
  //   多出一个模块键、进而进入设置面 `modules.*` —— 本批要求"改动有界、
  //   不动既有配置语义"，故**就地挂载**、不新增开关。
  //   ⚠ 位置在 `ctx.provide` 之后、`ctx.effect` 卸载钩子之后：两处监听器**不依赖门禁**
  //     （门禁只管"工具注册"，见文件头）⇒ 不放进 `ctx.inject([GATE_SERVICE], …)` 回调，
  //     否则关掉 `modules.tools` 会让收窄一起失效（那正是本文件头部 F1 修过的倒挂形态）。
  installWorkPresetDeny(ctx, (m) => { try { ctx.logger?.debug?.(m) } catch { /* 无 logger 时忽略 */ } })

  ctx.logger?.debug?.(`[${name}] 已激活：已提供门禁 ${GATE_SERVICE}；工具定义由预设行在预设作用域注册`)
}
