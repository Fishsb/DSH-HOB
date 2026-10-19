/**
 * 插件配置 schema（Schemastery）。
 *
 * 原则：所有可配置项走 schema，不硬编码。
 *
 * ⚠ 本文件目前是**骨架**：只声明「模块开关」与少量占位字段，没有业务字段。
 *   业务字段在后续批次按需追加。
 *
 * ⚠ 一条已实测的坑（见 `.hob/EXPERIENCE.md` E-39）：
 *    profile 层写同 id 条目 = **id 定向覆盖 config，而且是整体覆盖（不合并）**。
 *    所以**不要**在 profile 里重复声明本插件的 config —— 那会把本文件（以及
 *    `cordis.patch.yml`）提供的整份配置面**遮蔽掉**。要改配置就走本文件的默认值，
 *    或在 profile 层**写全**字段。
 */
import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_WORK_MODE,
  WORK_MODE_DISPLAY,
  WORK_MODE_VALUES,
  type WorkMode,
} from './shared/work-mode.ts'

/**
 * 模块开关：每个宿主半边模块（`src/modules/*`）可**独立启停**。
 *
 * 这是「模块可独立启停」这条架构性质的**配置面载体**：关掉一个模块，
 * 只是不装载它，**不影响其他模块**。
 *
 * ⚠ 另有一条**与配置无关**的独立启停路径：模块自己的 `inject` 声明。
 *   声明的服务不存在时，该模块的 fiber 停在 `PENDING`（不激活），
 *   **插件整体照常加载、其他模块照常工作**。两条路径互不替代：
 *   · `modules.*` 开关 = **用户/配置**决定的启停
 *   · `inject` = **环境依赖**决定的启停
 *
 * ⚠ 未在这里声明的键会被 schemastery **原样保留**（已实测：未知键与其嵌套子键
 *   都不被丢弃）。因此线上 profile 里可能残留的旧配置段**不会**导致校验失败 ——
 *   这是有意的兼容性，不是疏漏。
 */
export interface ModulesConfig {
  /** M1 工具模块（Host 半边）。 */
  tools: boolean
  /** M3 会话总线模块（同实例内会话之间传话）。 */
  bus: boolean
  /** M5 编排模块（闭环派活：投递 → 等对方跑完 → 回传结果 → 唤醒派活方）。 */
  orch: boolean
  /** M4 配置 schema 模块。 */
  settings: boolean
  /**
   * M6a 跨实例投递模块（2026-10-16 第 237 轮 · `UD-119` 裁定）。
   *
   * ⚠ ⚠ **缺省 `false`** —— ⚠ 它会在**无人看管时向另一个实例投递**（⚠ 与 `orch` 同风险档）。
   * ⚠ ⚠ **且它另有一道并列的闸门**：⚠ **可读权限控制 = 账本权限时，即便这里是 `true` 也不注册**
   *   （⚠ 跨实例投递是"影响外部状态"的动作 ⇒ 只读档不做）。
   */
  interconnect: boolean
}

/**
 * 「新建会话默认值」（{@link Config.spawn} 的**普通值**形态）。
 *
 * ⚠ 与 {@link ModulesConfig} 同一条纪律：schema 上四个子字段**各标 `.volatile()`**，
 *   运行时它们都是 **ref 对象** ⇒ **调用方一律不许直接读 `config.spawn.x`**
 *   （直读恒真/恒为 ref，且不报错）。唯一入口是 {@link spawnDefaults}。
 */
export interface SpawnDefaults {
  /** 新会话默认 Agent 预设 id；空串 = **出厂默认 `standard`**（⛔ 不是"用宿主默认预设"）。 */
  agentPreset: string
  /** 新会话默认模型 provider；空串 = 用宿主默认模型。 */
  provider: string
  /** 新会话默认模型 id；空串 = 用宿主默认模型。 */
  model: string
  /** 该模型的思考档位；空串 = 用模型自身默认档。 */
  reasoningEffort: string
}

export interface Config {
  /**
   * 「新建会话默认值」——只影响**本插件建出的会话**（`hob_spawn`），
   * 不影响用户在宿主界面里手工新建的会话（后者由宿主自己的设置页管）。
   *
   * ⚠ **形状与 `modules` 同款**：父对象 `spawn` **不**标 `.volatile()`，
   *   四个子字段**各标** —— 父子同标会抛 `ValidationError`
   *   （`validateVolatileSchema` 禁止 volatile 里再套 volatile），
   *   且**非 volatile 路径会被宿主写入通道拒**
   *   （`dsh-settings` 的 `isVolatilePath` 校验 `mutate` 的每一个 path）。
   *   与 `modules` 唯一的差别是**父对象也不同**：这里四个子字段全是字符串，
   *   没有"隐藏某个子字段"的需求，故四者同形。
   *
   * ⚠ **本段落地后，下面 `modules` 那段"唯一支撑"的说法要按同一批更新** ——
   *   见 {@link moduleSwitches} 上方 schema 注释里的"两处支撑"。
   */
  spawn: {
    agentPreset: import('@deepseek-ai/cordis').Volatile<string>
    provider: import('@deepseek-ai/cordis').Volatile<string>
    model: import('@deepseek-ai/cordis').Volatile<string>
    reasoningEffort: import('@deepseek-ai/cordis').Volatile<string>
  }
  /**
   * 各模块开关。
   *
   * ⚠ **运行时形态是混合的**（这是"隐藏 bus"逼出来的，见 {@link Config} 的 schema 注释）：
   *   · `tools` / `settings` = `Volatile<boolean>`（ref 对象，为了在设置页可见）；
   *   · `bus` = 普通 `boolean`（刻意不标 volatile ⇒ 设置页不呈现，UD-25）。
   * ⇒ **绝不要直接读 `config.modules.x`**：两个 ref 恒 truthy、且不报错。
   *   一律经 {@link moduleSwitches} 取普通布尔。
   */
  modules: {
    tools: import('@deepseek-ai/cordis').Volatile<boolean>
    /**
     * ⚠ **批 14 / M3 起改为 ref（volatile）** —— 它现在在设置页**可见**。
     *   v1–v4 时期它是普通布尔且刻意隐藏（UD-25：「开了也不起作用」会误导用户）。
     *   M3 落地后该模块**真管用**（提供 `hobBus` 服务 + 注册 2 个投递工具），
     *   隐藏它反而变成"用户看不到这个真实开关"（PROJECT.md §5.3 的静默失败）。
     *   ⇒ 与 `tools` / `settings` 同形。
     */
    bus: import('@deepseek-ai/cordis').Volatile<boolean>
    settings: import('@deepseek-ai/cordis').Volatile<boolean>
  }
  /**
   * 「Hob 推进项目的工作方式」（2026-10-19 · `UD-97`）。
   *
   * ⚠ **形状与 `spawn` 同款**：父对象 `workMode` **不**标 volatile、子字段 `mode` **标**
   *   （父子同标会抛 `ValidationError`；非 volatile 路径会被宿主写入通道拒
   *   ⇒ 设置面必须写 `['workMode','mode']`）。
   * ⚠ **绝不要直接读 `config.workMode.mode`**：运行时它是 ref 对象（恒 truthy、且不报错）。
   *   一律经 {@link workMode} 取普通值。
   */
  workMode: {
    mode: import('@deepseek-ai/cordis').Volatile<WorkMode>
  }
}

export const Config = z.object({
  /**
   * 各模块开关。
   *
   * ⚠⚠ **形状 = 父对象【不】标 volatile；四个子字段各标** —— 这是第 6 步修订实测
   *   逼出来的形状（**方案 D**），原本为的是"**在设置页隐藏 `bus`、但保留
   *   `modules.bus` 这个配置键**"（UD-25）。
   *   ⚠ **批 14 / M3 起 `bus` 也标 volatile**（它真管用了 ⇒ 该可见，见下方字段注释）。
   *   ⇒ 现在**四个子字段全标**，形状本身（父不标 + 子各标）**未变**。
   *
   * ⚠⚠ **这个形状是"设置页分区可见"的两处支撑之一**（2026-10-06 配置面清理轮首次实测；
   *   **2026-10-09 本轮新增 `spawn` 段后改为"两处"**）：
   *   本 schema 里**没有顶层 volatile 字段**（三个空旋钮 persona / showEntry /
   *   delivery 已按 UD-43 删除）⇒ 可见性依赖**两个都带 volatile 子字段的父对象**：
   *     · `modules` —— 四个子字段各标 `.volatile()`；
   *     · `spawn`   —— 四个子字段各标 `.volatile()`（**本轮新增**，见该段注释）。
   *   ⚠ **改动只是把"唯一支撑"改说成"两处支撑之一"，结论没有变**：
   *     下面那条"任何人不许把这四个 `.volatile()` 从子字段上摘掉"**仍然逐字成立** ——
   *     摘掉 `modules` 的四个、`spawn` 的四个**全摘**，`volatileForm` 仍会
   *     返回 `undefined` ⇒ 整个 dsh-hob 分区照样静默消失。
   *   （`spawn` 段的加入**不减轻** `modules` 的约束，只是让"全摘才消失"这条
   *     在崩掉之前多一层缓冲；反过来说，"只靠 `spawn` 撑住"也**不算**通过。）
   *   实测（用**宿主 `volatileForm` 原文**跑真 schema，见
   *   `.hob/archive/2026-10-06-config-cleanup-evidence/分区可见性验证.mjs`）：
   *     · `volatileForm(schema)` 返回**非 undefined** ⇒ 分区仍可见 ✅
   *     · 返回的 form 顶层键 = `["modules"]`，其子字段 = `{tools, bus, settings}`
   *       （批 14 起含 `bus`；后续批次又相继加入 `orch` / `interconnect`）
   *       ⚠ 那是**该次实测当时的**返回值；本轮加了 `spawn` ⇒ 顶层键应为
   *         `["modules", "spawn"]`（**已按真 schema 复测**，读数在回报里）。
   *   ⇒ **"父不标 + 子各标"单独就足以让 entry 可见**，不需要任何顶层 volatile。
   *     （更一般的规则见下方 "volatile 的三个形状规则"。）
   *   ⚠ 因此：**任何人不许把这四个 `.volatile()` 从子字段上摘掉** ——
   *     摘掉一两个不影响可见性（还剩别的），但**全摘** ⇒
   *     `volatileForm` 返回 undefined ⇒ `describe()` 对该 entry `return []`
   *     ⇒ **整个 dsh-hob 分区在设置页静默消失**（宿主不报错）。
   *
   * ── volatile 的三个形状规则（宿主机读，逐条实测）─────────────────────
   * 宿主 `volatileForm(schema)`（`dsh-settings/lib/index.js:122-131`）：
   *   · schema **自己**带 `volatile` ⇒ `plainSchema(schema)` —— **整块原样呈现，子字段全显示**；
   *   · schema 是 object 且自己不带 ⇒ 递归子字段，**返回 `undefined` 的子字段被过滤掉**；
   *   · 一个 live 子字段都没有 ⇒ 返回 `undefined` ⇒ **该 entry 从设置面消失（静默）**。
   *
   * 由此三条（均已实测）：
   *   (a) **父子同标会直接抛** `ValidationError`（schemastery 的
   *       `validateVolatileSchema` 禁止 volatile 里再套 volatile，
   *       `schemastery/src/index.ts:488-509`）。
   *       ⚠ **精确边界（2026-10-05 复核纠正，与 PROJECT.md §5.3.1 一致）**：
   *         抛错的是「**父子同标**」；「**父不标 + 子各标**」**完全合法** ——
   *         正是本 `modules` 采用第二种形状的原因。别再把它误记成
   *         "给子字段各标会抛"（那会把人引向错误的规避方案）。
   *   (b) **父整体标了 volatile 之后，schema 层无法让某个子字段单独消失**
   *       （整块走 `plainSchema`，子字段全在）。
   *   (c) **volatile 不必是"顶层叶子"** —— 嵌在**非 volatile** 父对象里的
   *       volatile 叶子同样合法（本 `modules.tools` 就是这种，实测构造/解析都 OK），
   *       且**单独就足以让分区可见**。
   *       受限的只是"volatile 里面再套 volatile"（即 (a)）。
   *
   * （以上形状规则均可用 node 独立复现：构造阶段全 OK，差异只在**解析**阶段。
   *   复现脚本见 `.hob/archive/2026-10-05-step6rev2-evidence/volatile-三形状复现.mjs`。）
   *
   * ── 两种候选方案的实测对照（选 D 的理由）────────────────────────────
   * | 方案 | 设置页 | `bus` 键是否保留 | 结论 |
   * |---|---|---|---|
   * | **E**：父 volatile + schema 里**不声明** `bus` | `tools/settings` | ❌ **一次 UI 写入就被抹掉** | **不可用** |
   * | **D**：父不标 + 各子字段各标 | 四个都在 | ✅ **保留**（写入后仍在） | **采用** |
   *
   * **为什么 E 会丢**（实测复刻宿主写入路径得出）：`modules` 整体 volatile ⇒
   * 宿主 `strip()` 对整块返回 `{}`（连同被隐藏字段一起从旧值里删掉），
   * 再 merge 进 `projectForm` 投影后的新值（其中**根本没有**那个字段）⇒ 被静默抹除。
   * 而 D 的形状下 `strip()` 只删**.volatile() 标了的**子键，未标的子键被保留。
   * ⚠ 批 14 起四个子字段**全标** ⇒ 上面这条"未标者被保留"的差别在本项目**当前无对象**，
   *   但它仍是**形状规则**（将来若再要隐藏某个字段就靠它），故原样保留说明。
   * （复刻脚本与结论见 `.hob/archive/2026-10-05-step6rev-evidence/`。）
   *
   * ⚠ **代价（批 14 起四个子字段同形）**：
   *   `tools` / `bus` / `settings`（及后续加入的 `orch` / `interconnect`）
   *   **各自都是 ref 对象** ⇒ `cfg.modules.tools`
   *   是 ref（**恒 truthy**！直接当布尔用会**永远为真**，且不报错）。
   *   ⇒ 这件事**只能**由 {@link moduleSwitches} 收口，调用方一律不许自己解。
   */
  modules: z.object({
    tools: z.boolean().default(true)
      .description('工具模块：提供「助手」会话里的两个工具（读文档 / 写账本）。')
      .volatile(),
    /**
     * 会话总线开关（M3）。
     *
     * ⚠ **批 14 / M3 起：真管用，因此标 `.volatile()` 出现在设置页**。
     *   v1–v4 时期它刻意隐藏（UD-25）：那时 M3 是骨架，"开了也不起作用"，
     *   显示出来会误导用户以为"开了就有效"。
     *   M3 落地后语义反转 —— 现在是"**开关真的控制一个真功能**"，
     *   隐藏它就变成 PROJECT.md §5.3 那种**静默失败**（用户看不到真实开关）。
     *   ⚠ 关掉它只影响 M3 自己：`hobBus` 服务不提供 ⇒ 预设行那两个投递工具
     *     连同 `hob_sessions` / `hob_send` 一起不注册，其余三个模块照常。
     */
    bus: z.boolean().default(true)
      .description('会话总线（M3）：提供 hob_sessions / hob_send，把指令投递给同实例内的另一个会话。关掉它只影响这两个工具。')
      .volatile(),
    /**
     * 编排开关（M5 · 批 17）。
     *
     * ⚠ **缺省 `false`（与 `bus` 的 `true` 不同）** —— 两者风险等级不同：
     *   · `bus` 只是"多两个投递工具"，**每次调用都由模型显式发起**；
     *   · `orch` 会**在被派发的会话跑完后自动唤醒派活方** ⇒ 一旦转起来，
     *     循环会**在用户看不到的时候**持续投递/建会话/烧 token（用户 2026-10-09
     *     明确选择了"不设上限、只能手动停"）。
     *   ⇒ 默认不装：要用的人**显式打开**，并在打开时就知道自己在开什么。
     *
     * ⚠ 关掉它只影响 M5 自己：`hobOrchestrator` 服务不提供 ⇒ 预设行那三个编排工具
     *   连同 `hob_dispatch` / `hob_orch_status` / `hob_orch_control` 一起不注册，
     *   其余四个模块照常（会话总线仍在，手工投递路不受影响）。
     */
    orch: z.boolean().default(false)
      .description('闭环编排（M5）：对方跑完自动回传并唤醒派活方（hob_dispatch / hob_orch_status / hob_orch_control）。⚠ 它会在无人看管时继续推进 —— 默认关闭，要用请显式打开。')
      .volatile(),
    settings: z.boolean().default(true)
      .description('设置模块：登记本插件的配置面，使其出现在这个设置页里。')
      .volatile(),
    /**
     * ── 跨实例投递开关（M6a · 2026-10-16 第 237 轮 · `UD-119` 裁定）─────────────
     *
     * **它管什么**：⚠ 允许把一条任务**投递给另一个 DSH 实例**（⚠ 走宿主原生
     *   `dsh headless` —— ⚠ **一次性进程 + stdout**；⛔ 不写任何自研协议）。
     *
     * ⚠ ⚠ **缺省 `false`（与 `bus` 的 `true` 不同）** —— ⚠ 理由与 `orch` 同档：
     *   ⚠ **它一旦转起来会在无人看管时向别处投递**（⚠ 而这次的"别处"是**另一个实例**）
     *   ⇒ ⚠ 要用的人**显式打开**，且打开时就知道自己在开什么。
     *   ⚠ **并据实说明**：⚠ **地址只能从白名单来** ⇒ ⛔ 它不是"能写任意远端"
     *     （⚠ 白名单为空 ⇒ 每个对端都被拒，⚠ 且拒的时候**点名**说清楚）。
     *
     * ⚠ 关掉它只影响 M6a 自己：⚠ 投递服务不提供，⚠ 其余模块照常。
     *   ⚠ ⚠ **且档位规则仍然生效**：⚠ 即便这里开着，**档位 = 账本时服务也不提供**
     *     （⚠ 与"只读档不做影响外部状态的动作"同一条判据）。
     */
    interconnect: z.boolean().default(false)
      .description('跨实例投递（M6a）：允许把任务投递给白名单里的另一个 DSH 实例（走宿主原生 dsh headless）。⚠ 缺省关；⚠ 地址只从白名单来。')
      .volatile(),
  }).default({}),

  /**
   * 「新建会话默认值」（2026-10-09 · 本轮新增）。
   *
   * ── 它管什么 ────────────────────────────────────────────────────────
   *   `hob_spawn` 建出的会话套用这四个默认值；**只影响本插件建出的会话**，
   *   **不影响**用户在宿主界面里手工新建的会话（后者由宿主自己的设置页管）。
   *
   * ── 形状（与 `modules` 同形，**不是**随手选的）──────────────────────
   *   · 父对象 `spawn` **不标** `.volatile()`；
   *   · 四个子字段**各标** `.volatile()`。
   *   这是**被宿主的两条硬约束逼出来的**（都在 `dsh-settings/lib/index.js` 实测过）：
   *     ① **父子同标会直接抛** `ValidationError`（`validateVolatileSchema`
   *        禁止 volatile 里再套 volatile，`schemastery` 的 `validateVolatileSchema`）；
   *     ② **写入路径必须逐级 volatile** —— `mutate()` 对每个 path 调
   *        `isVolatilePath(schema, path)`，非 volatile 路径直接
   *        `throw new Error('Config field "…" is not volatile')`。
   *        ⇒ 设置面**必须写子字段路径**（如 `['spawn','provider']`），
   *        **不得整块写 `spawn`**（`spawn` 自己不 volatile ⇒ 被拒）。
   *
   * ── 空串语义（**不是**"没配置"的隐式形态，而是显式约定）──────────────
   *   四个字段**空串 = 用宿主默认**。选择这一形态的理由：
   *   · schema 层**无法**给"未设置"配一个可写的空值（`.default('')` 是**继承值**，
   *     用户层的"清空"由设置面的 `unset` 承担 —— 那在宿主侧表现为**键缺席**）；
   *   · `spawnDefaults()` 把"空串 / 缺席 / ref 读不出来"**三种都归一到空串**，
   *     调用方只面对一种语义（见该函数）。
   *
   * ⚠ **本段落地后 `modules` 那段"设置页分区可见的【唯一】支撑"不再准确** ——
   *   `spawn` 的四个子字段同样带 volatile、同样会呈现在设置面上。**这只是说法变了，
   *   结论没变**：`modules` 的形状（父不标 + 子各标）**仍然一个字不许动**，
   *   理由见那段注释本身（它讲的是形状规则，与本段无关）。
   */
  spawn: z.object({
    agentPreset: z.string().default('')
      .description('新建会话默认预设（id，如 `standard`）。⚠ 留空 = **出厂默认 `standard`**（标准模式），**不是**「用宿主默认预设」。⚠ 若这里填的是本插件的规划侧预设（`Hob`）⇒ 不套用它（它只规划、不施工），改走出厂默认并在返回里说明。只影响本插件建出的会话，不影响手工新建的会话。')
      .volatile(),
    provider: z.string().default('')
      .description('新建会话默认模型的 provider 路由（如 `dshapi`）。留空 = 用宿主默认模型。')
      .volatile(),
    model: z.string().default('')
      .description('新建会话默认模型 id（如 `deepseek-v4.1-flash`）。留空 = 用宿主默认模型。')
      .volatile(),
    reasoningEffort: z.string().default('')
      .description('默认模型的思考档位（如 `high`）。留空 = 用该模型自身默认档。')
      .volatile(),
  }).default({}),

  /**
   * 「可读权限控制」（2026-10-14 第 144 轮 · 用户裁定「档3 要真硬机制」+「档2不给，档3的都给」；
 *   **2026-10-17 由「权限档位」改名而来** —— ⚠ 只改名，⛔ 不扩权、⛔ 不改内部取值）。
   *
   * ── 它管什么 ────────────────────────────────────────────────────────
   *   「助手」预设这一档会话**能看到哪些工具**。三档是**包含链**：
   *   · `ledger`（账本，默认）= **只读自己的账本 + 网络**，看不到项目工作区的文件；
   *   · `project`（项目）= 上面那些 **+** 读工作区里的**文档（`.md`）**，不可读代码；
   *   · `workspace`（工作区）= 上面那些 **+** 工作区里的**任意文件**（含代码与图片）、
   *     跨文件搜索。
   *   ⚠ **任何一档都不能改动**：写类 / 命令类工具在三档里**都不存在**
   *     （不声明 + 不注册 —— 见 `src/preset/tools.ts` 的三档表与哨兵）。
   *   ⚠ **档位只改「读」的范围**，不改「写」的边界。
   *
   * ── 形状（与 `spawn` 同形，**不是**随手选的）──────────────────────
   *   · 父对象 `permission` **不标** `.volatile()`；
   *   · 子字段 `level` **标** `.volatile()`。
   *   理由与 `spawn` 那段完全同源（父子同标会抛 `ValidationError`；
   *   写入路径必须逐级 volatile，故设置面**必须写 `['permission','level']`**）。
   *
   * ── 为什么是 `.volatile()`（而不只是普通配置）──────────────────────
   *   档位要求「**改完即生效、不必重启**」。`.volatile()` 让宿主写入走
   *   **volatile-only 通道**（`cordis-plugin-loader` 的 `equalExceptVolatile` 判定为真
   *   ⇒ 只换 `fiber._config`、**不重挂载**）⇒ 已开的会话在**下一次模型 step**
   *   就按新档位走（装配期过滤是**逐 step 现算**的，见 `src/preset/tools.ts`）。
   *   ⚠ 若档位改成普通（非 volatile）字段 ⇒ 宿主走重挂载通道 ⇒ **必须重载/重启**。
   *
   * ── 为什么是 `z.union([z.const(…), …])` 而不是 `z.string()` ─────────
   *   `z.string()` 在设置面会退化成**自由文本输入**（用户能填出三档之外的值）；
   *   `z.union` 的 const 列表在宿主 form 里是**选项**形态（`volatileForm` 保留
   *   `{type:'union', list:[{type:'const',value}…]}`）⇒ 用户只能三选一。
   *
   * ── ⛔ 不许改成顶层标量 ─────────────────────────────────────────────
   *   顶层标量（`permission: z.string()`）会让 `volatileForm` 返回 `undefined`
   *   ⇒ **整个本插件分区在设置页静默消失**（宿主不报错）。
   *   `check:config` 的 B 组对此有断言（子键集合双向比对 + 顶层组必须双向在位）。
   */
  permission: z.object({
    level: z.union([
      z.const('ledger'),
      z.const('project'),
      z.const('workspace'),
    ]).default('ledger')
      .description('「助手」会话的可读权限控制（三选一）：账本权限 = 只读自己的账本与网络；文档权限 = 另可读工作区的 .md 文档，不可读代码；完全权限 = 另可读工作区里的任意文件（含代码与图片）、可跨文件搜索。⚠ 完全权限 = 工作区里任何文件都可读，仍然不能写、不能执行命令、不能组队（写类与命令类工具三档都不存在）。改完即生效，不必重启实例。')
      .volatile(),
  }).default({}),

  /**
   * ── 「首次使用时铺骨架」（2026-10-16 第 224 轮 · **`UD-118` 用户裁定「C」**）───────
   *
   * **它管什么**：⚠ 插件**首次**在一个工作区里干活时，把骨架（`.hob/**` 的**结构层**）
   *   铺进那个工作区 —— ⚠ 免得"装到别的实例"这件事**依赖人记得复制**
   *   （⚠ 由来见 `UD-118`：第 221 轮实测 `npm pack` 里 `.hob/` 命中 0）。
   *
   * ⚠ ⚠ **这不是 agent 的工具**（**约束 ⑥**）：⚠ Hob 的工具面**一个都不多**
   *   ⇒ ⛔ **别把它接到 `write_hob` 的入参上**，也⛔ 别在预设里声明它。
   *   ⚠ 它是**插件的初始化行为**（与"注册模块"同一档）。
   *
   * ⚠ **形状**（与 `spawn` / `permission` 同形，**不是**随手选的）：
   *   · 父对象 `skeleton` **不标** `.volatile()`；
   *   · 子字段 `enabled` **标** —— ⚠ 父子同标会抛 `ValidationError`，
   *     且非 volatile 路径会被宿主写入通道拒（`isVolatilePath`）。
   *
   * ⚠ **缺省 `true`（默认开）** —— ⚠ 理由：⚠ 用户要的是**省心**（`UD-118` 的原话就是「C」）；
   *   ⚠ 而它的失效方向**可观测且无害**：⛔ **永不覆盖已存在的 `.hob/`**（只补缺）
   *   ⇒ ⚠ 对**已经有骨架**的工作区，它是**空操作**（只打一行"已存在 ⇒ 跳过"）。
   *   ⚠ 与 `orch` 的"缺省 false"不矛盾：⚠ 那个的失效方向是**在无人看管时继续烧 token**，
   *     方向不同 ⇒ 兜底取值不同（同一条"取后果更轻的那一边"纪律）。
   */
  skeleton: z.object({
    enabled: z.boolean().default(true)
      .description('首次在某工作区干活时，把骨架（`.hob/**` 结构层）铺进那个工作区。⚠ 只补缺：目标已存在 ⇒ 一个字节都不动。⚠ 这不是工具，是插件的初始化行为。')
      .volatile(),
  }).default({}),

  /**
   * ── 跨实例投递的**对端白名单**（M6a · 2026-10-16 第 237 轮 · `UD-119` 裁定）──────
   *
   * ⚠ ⚠ **它是那条硬边界的载体**：⚠ **对端地址只从这里来** ⇒ ⛔ **不接受任意远端**
   *   （⚠ 与"能写任意远端"是两回事 —— ⚠ 前者是点名的、有限的、可审计的）。
   *
   * ⚠ **形状（⚠ 与 `spawn` / `permission` / `skeleton` 同形）**：
   *   · 父对象 `interconnectTargets` **不标** `.volatile()`；
   *   · 子字段 `list` **标** ⇒ ⚠ 改白名单**即改即生效**（⛔ 不必重启）；
   *   ⚠ 父子同标会抛 `ValidationError`；⚠ 写入必须走子字段路径 `['interconnectTargets','list']`。
   *
   * ⚠ ⚠ **为什么是"一行一个字符串"而不是结构化对象**：⚠ 本仓的配置面用的是
   *   schemastery 的 `z.string()` 形态（⚠ 结构化数组在宿主设置页上的呈现未经实测）
   *   ⇒ ⚠ **取已验证的形态**：⚠ **每行一个对端**，格式 `名字=<launcher>`，⚠ 或只写 `名字`
   *     （⚠ 后者用**运行时解析**出来的宿主入口，见 `interconnect.ts` 的 `resolveDefaultLauncher()`）。
   *     ⚠ 解析器见 {@link interconnectTargets}。
   *   ⚠ ⚠ **空的含义**：⚠ **空 = 白名单为空** ⇒ ⚠ **每个对端都会被拒**（⚠ 而拒的时候会**点名**说明）。
   */
  interconnectTargets: z.object({
    list: z.array(z.string()).default([])
      .description('跨实例投递的对端白名单：每行一个，格式 `名字` 或 `名字=<launcher 路径>`。⚠ 空 = 谁都不许投（拒绝时会点名）。')
      .volatile(),
  }).default({}),

  /**
   * ── 「Hob 推进项目的工作方式」（2026-10-19 · `UD-97` 推进优先）───────────────
   *
   * ⚠ ⚠ **它管什么、⛔ 不管什么**（这是本段最容易被误读的地方）：
   *   ✅ 管：**Hob 怎么拆活、拆成几路**（三档：自动 / 单会话 / 多会话）；
   *   ⛔ 不管：权限档位（那是上面 `permission`）、谁能写什么、验收口径。
   *   ⇒ 它与 `permission` 是**两个正交的旋钮**：一个管"看得见什么"，一个管"拆几路"。
   *
   * ── 三档（⚠ 取值与顺序的唯一来源是 `src/shared/work-mode.ts`）──────────────
   *   `auto`（缺省）= 按任务与方案自己判该拆成几路；`single` = **恒定一路**；
   *   `multi` = 拆到**最细**、**尽可能多路**（⚠ 费用与时间不设上限）。
   *   ⚠ 顺序照 `WORK_MODE_VALUES`（面板渲染顺序同此）。
   *
   * ── 形状（⚠ 与 `spawn` / `permission` / `skeleton` / `interconnectTargets` 同形）──
   *   · 父对象 `workMode` **不标** `.volatile()`；
   *   · 子字段 `mode` **标** `.volatile()`。
   *   理由与那四段完全同源：父子同标会抛 `ValidationError`；
   *   写入路径必须逐级 volatile ⇒ 设置面**必须写** `['workMode','mode']`。
   *
   * ── 为什么是 `.volatile()`（而不只是普通配置）────────────────────────────
   *   ⚠ 三档要**改完即生效、不必重启**：`.volatile()` 让宿主写入走 volatile-only 通道
   *   （`equalExceptVolatile` 判定为真 ⇒ 只换 `fiber._config`、**不重挂载**）。
   *   而消费方（`src/preset/tools.ts` 注入的那段口径）**每次装配现读**档位
   *   ⇒ 已开的 Hob 会话**下一次模型 step** 就按新档走（与 `permission.level` 同一条落法）。
   *   ⚠ 若改成普通（非 volatile）字段 ⇒ 宿主走重挂载通道 ⇒ **必须重载/重启**
   *   （而重启只有用户能做）—— 那就与界面写的那句"改完即生效"不符，
   *   属于本任务书明令禁止的"写了却做不到"。
   *
   * ── 为什么是 `z.union([z.const(…), …])` 而不是 `z.string()` ────────────
   *   `z.string()` 在设置面会退化成**自由文本输入**（用户能填出三档之外的值，
   *   而非法值在消费方只能静默归到缺省档 = 一个用户看不出没生效的失败）；
   *   `z.union` 的 const 列表在宿主 form 里是**选项**形态（`volatileForm` 保留
   *   `{type:'union', list:[{type:'const',value}…]}`）⇒ 用户只能三选一。
   *
   * ── ⛔ 不许改成顶层标量 ──────────────────────────────────────────────
   *   顶层标量（`workMode: z.string()`）会让 `volatileForm` 返回 `undefined`
   *   ⇒ **整个本插件分区在设置页静默消失**（宿主不报错）。`check:config` 的 B 组钉着。
   */
  workMode: z.object({
    mode: z.union(WORK_MODE_VALUES.map((v) => z.const(v))).default(DEFAULT_WORK_MODE)
      .description(
        'Hob 推进项目的工作方式（三选一）：'
        + `${WORK_MODE_DISPLAY.auto} = Hob 按任务与方案自己判该拆成几路（结果随任务而变）；`
        + `${WORK_MODE_DISPLAY.single} = 恒定一路推进；`
        + `${WORK_MODE_DISPLAY.multi} = 拆到最细、尽可能多路（费用与时间不设上限）。`
        + '⚠ 它只改「怎么拆活、拆成几路」，不改权限档位、不改谁能写什么、不改验收口径。'
        + '⚠ 「多会话」的无限制只到"费用与时间不设上限"这一层，不解除任何既有红线：'
        + '不改看板、不碰别人项目的卡、不放宽任何判据、不把"多"理解成"每个会话都能干任意事"。'
        + '改完即生效，不必重启实例（已开的会话从下一步起按新档走）。',
      )
      .volatile(),
  }).default({}),
})

/**
 * 读出「新建会话默认值」的**普通对象**，屏蔽 volatile ref 形态。
 *
 * ⚠ **调用方一律不许直接读 `config.spawn.x`**（与 {@link moduleSwitches} 同一条纪律）：
 *   `spawn` 的四个子字段都标了 `.volatile()` ⇒ 运行时都是 **ref 对象**
 *   （`createVolatile()` 的产物，`Object.freeze({ get, [write] })`）。
 *   直接拿 `config.spawn.provider` 当字符串用**会静默得到 ref**（不是字符串、恒 truthy），
 *   拼进 `hob_spawn` 的默认值里就会变成一个 `[object Object]` 之类的垃圾值，
 *   **且不报错** —— 这正是本函数存在的唯一理由。
 *
 * ── 归一语义（三种输入形态都收口到"空串 = 用宿主默认"）────────────────
 *   · ref 且 `.get()` 给字符串 ⇒ 用它（空白字符串也归一到空串）；
 *   · 键缺席 / ref 读不出来 / 读到非字符串 ⇒ **空串**（= 用宿主默认）；
 *   · 普通裸对象（测试里的 `Config({…})` 或 fake config）⇒ 直读同一套判据。
 *   ⇒ 调用方只面对一种语义，不必知情字段是 ref 还是普通值。
 *
 * ⚠ 兜底方向：读不出来给**空串**（= 交还宿主默认），
 *   而不是"给某个猜出来的模型/预设" —— 后者会在配置面坏掉时**悄悄改变**
 *   用户建出的会话用哪个模型。空串的后果只是"回到本批之前的行为"，最轻。
 *
 * @param config - 插件配置（来自 Loader 时是 ref 形态；测试里的裸对象是普通形态）。
 * @returns 四个默认值的普通字符串对象（空串 = 用宿主默认）。
 */
export function spawnDefaults(config: unknown): SpawnDefaults {
  const raw = deref((config as { spawn?: unknown } | undefined)?.spawn)
  const pick = (key: keyof SpawnDefaults): string => {
    if (raw === null || typeof raw !== 'object') return ''
    const v = deref((raw as Record<string, unknown>)[key])
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : ''
  }
  return {
    agentPreset: pick('agentPreset'),
    provider: pick('provider'),
    model: pick('model'),
    reasoningEffort: pick('reasoningEffort'),
  }
}

/**
 * 解出 volatile ref 的普通值；非 ref 原样返回。
 *
 * `createVolatile()` 的产物是 `Object.freeze({ get, [write] })`
 * （`cosmokit/lib/index.js:102-110`）—— 拿它当布尔用会**恒 truthy**，且不报错。
 */
function deref(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function') {
    try { return (value as { get: () => unknown }).get() } catch { return undefined }
  }
  return value
}

/**
 * 读出模块开关的**普通对象**，屏蔽"每个开关是 ref 还是普通布尔"这件事。
 *
 * ── 为什么需要它（第 6 步实测的静默陷阱）────────────────────────────────
 * 本函数诞生于"`modules` 的子字段**形态不一致**"那个时期（当时 `bus` 刻意不标
 * volatile 以隐藏它）。**批 14 / M3 起四个子字段同形**（都标了 volatile ⇒ 都是 ref），
 * 但本函数**仍然必须存在且仍是唯一入口**，理由有二：
 *   ① 历史形状可能回来（将来若要再隐藏某个字段，就又是"两形态并存"）；
 *   ② 兜底语义（读不出来给安全默认）是**独立的**，与字段是 ref 还是布尔无关。
 *
 * | 字段 | schema 上的 volatile | 运行时形态 | 直读 `modules.x` 得到 |
 * |---|---|---|---|
 * | `tools` / `bus` / `settings`（批 14 起；`orch` / `interconnect` 同形） | ✅ 有（为了显示） | **ref 对象** | **ref**（恒 truthy，`if (m.tools)` 永远为真） |
 *
 * ⇒ **任何"直接读 `config.modules.x` 当布尔用"的写法的后果都是静默的**（永远为真，
 *   且不报错）。本函数是**唯一**允许碰 `config.modules` 的地方：逐字段 `deref()`，
 * 调用方（`src/index.ts` 的模块登记表）永远拿**普通布尔**，不必知情。
 *
 * ⚠ 兜底原则：读不出来的字段给**安全默认**（见下方返回值），
 *   宁可模块多加载也不因读配置失败而整插件停摆。
 *
 * @param config - 插件配置（来自 Loader 时是 ref 形态；测试里的裸对象是普通形态）。
 * @returns 各模块开关的普通布尔对象。
 */
export function moduleSwitches(config: unknown): ModulesConfig {
  const raw = deref((config as { modules?: unknown } | undefined)?.modules)
  const pick = (key: keyof ModulesConfig, fallback: boolean): boolean => {
    if (raw === null || typeof raw !== 'object') return fallback
    const v = deref((raw as Record<string, unknown>)[key])
    return typeof v === 'boolean' ? v : fallback
  }
  return {
    tools: pick('tools', true),
    // ⚠ 缺省 **true**（与 schema 的 `.default(true)` 一致）：读不出来时
    //   宁可让 M3 可用（它是"投递"能力，失效表现为工具不出现，易于发现），
    //   而不是静默把用户已经打开的模块关掉。
    bus: pick('bus', true),
    // ⚠ 缺省 **false**（与 schema 的 `.default(false)` 一致）：读不出来时
    //   宁可**不**开闭环 —— 它的失效模式是"在无人看管时继续推进"，
    //   反向的误判（把用户开着的模块关掉）只是少三个工具，代价小得多。
    //   ⇒ **两个方向的兜底都取"后果更轻"的那一边**，不取"更保守"或"更激进"。
    orch: pick('orch', false),
    settings: pick('settings', true),
    // ⚠ 缺省 **false**（与 schema 的 `.default(false)` 一致）：读不出来时**宁可不开** ——
    //   它的失效方向是**在无人看管时向另一个实例投递**（⚠ 而"别处"是另一台机器/实例）
    //   ⇒ 与 `orch` 同一条"取后果更轻的那一边"纪律。
    interconnect: pick('interconnect', false),
  }
}

/**
 * 可读权限控制的**现读**服务名（2026-10-14 第 144 轮）。
 *
 * ⚠ 它是一个**函数**（返回 `'ledger' | 'project' | 'workspace'`），不是值：
 *   调用方**必须每次调**，不许存起来（见 {@link permissionLevel} 的注释）。
 * ⚠ 定义在 `config.ts`（而不是 `index.ts`）：**两侧都要用它** ——
 *   插件入口（provide 方）与预设作用域（消费方），放这里不会造成循环 import。
 */
export const PERMISSION_SERVICE = 'hobPermission'

/** 可读权限控制的三档合法值（**唯一**枚举来源；⛔ 取值自 2026-10-17 改名起一字未动）。 */
export const PERMISSION_LEVELS = ['ledger', 'project', 'workspace'] as const

/** 可读权限控制的档位类型。 */
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number]

/** 缺省档位 = `ledger`（与 schema 的 `.default('ledger')` 一致）。 */
export const DEFAULT_PERMISSION_LEVEL: PermissionLevel = 'ledger'

/**
 * 读出当前**可读权限控制**的档位（`ledger` / `project` / `workspace` —— ⚠ 内部取值，⛔ 不是显示名）。
 *
 * ── 为什么必须是**函数**、且调用方必须**每次现读**────────────────────
 *   `permission.level` 标了 `.volatile()` ⇒ 运行时是 **ref 对象**，
 *   宿主写入走 volatile-only 通道**原地更新**（不重挂载）。
 *   ⇒ 若在挂载时读一次存起来，用户改完档位后**已开的会话仍按旧档**走到重挂载为止 ——
 *     正是"设置页改了但行为没变"那个静默失败（与 `spawnDefaults` 的注释同一条教训）。
 *
 * ── 兜底口径（fail-closed）────────────────────────────────────────────
 *   读不出来 / 不是三档之一 / 抛异常 ⇒ 一律归到**最保守**的 {@link DEFAULT_PERMISSION_LEVEL}
 *   （档1 账本）。理由：档位的失效方向应当是**收窄**而不是放大权限。
 *
 * @param config - 插件配置（或任何带 `permission.level` 的对象）。
 */
export function permissionLevel(config: unknown): PermissionLevel {
  try {
    const raw = deref((config as { permission?: unknown } | undefined)?.permission)
    if (raw === null || typeof raw !== 'object') return DEFAULT_PERMISSION_LEVEL
    const v = deref((raw as Record<string, unknown>).level)
    return typeof v === 'string' && (PERMISSION_LEVELS as readonly string[]).includes(v)
      ? (v as PermissionLevel)
      : DEFAULT_PERMISSION_LEVEL
  } catch {
    return DEFAULT_PERMISSION_LEVEL
  }
}

/**
 * 「Hob 推进项目的工作方式」的**现读**服务名（2026-10-19 · `UD-97`）。
 *
 * ⚠ 与 {@link PERMISSION_SERVICE} 同形：它是一个**函数**（返回 `'auto' | 'single' | 'multi'`），
 *   不是值 —— 调用方**必须每次调**，不许存起来（理由见 {@link workMode} 的注释）。
 * ⚠ 定义在 `config.ts`（而不是 `index.ts`）：**两侧都要用它** ——
 *   插件入口（provide 方）与预设作用域（消费方），放这里不会造成循环 import。
 */
export const WORK_MODE_SERVICE = 'hobWorkMode'

/**
 * 读出「Hob 推进项目的工作方式」的档位（`auto` / `single` / `multi` —— ⚠ 内部取值，⛔ 不是显示名）。
 *
 * ── 为什么必须是**函数**、且调用方必须**每次现读**────────────────────
 *   与 {@link permissionLevel} 同一条纪律：`workMode.mode` 标了 `.volatile()`
 *   ⇒ 运行时是 **ref 对象**，宿主写入走 volatile-only 通道**原地更新**（不重挂载）。
 *   ⇒ 若在挂载时读一次存起来，用户改完档位后**已开的会话仍按旧档**走到重挂载为止 ——
 *     正是"设置页改了但行为没变"那个静默失败。
 *   ⚠ 本项的**唯一消费者**是 `src/preset/tools.ts` 注册的那段 scoped prompt section，
 *     它的 `text` 是函数、**每次装配现调** ⇒ "改完即生效"在这里成立。
 *
 * ── 兜底口径 ─────────────────────────────────────────────────────────
 *   读不出来 / 不是三档之一 / 抛异常 ⇒ 一律归到 {@link DEFAULT_WORK_MODE}（`auto`）。
 *   ⚠ **为什么兜底是 `auto` 而不是 `single`**：两条判据 ——
 *     ① `auto` 是**缺省档**（与 schema 的 `.default('auto')` 一致；不一致会让
 *        "读不到配置"与"用户没设过"表现为**两种不同行为**，那就是漂）；
 *     ② 兜底方向取**后果更轻**的那一边：`auto` = "按任务自己判"；`single` 则会把一个
 *        **本可并行**的任务强行压成一路 ⇒ 那是**替用户做了一个他没做过的选择**。
 *     ⚠ 这与 `permissionLevel` 的 fail-closed **不矛盾**：那一档的误判方向是
 *     **放大权限**（必须收紧），而本项**不涉及任何权限面**（见 `shared/work-mode.ts` 的注释）。
 *
 * @param config - 插件配置（或任何带 `workMode.mode` 的对象）。
 */
export function workMode(config: unknown): WorkMode {
  try {
    const raw = deref((config as { workMode?: unknown } | undefined)?.workMode)
    if (raw === null || typeof raw !== 'object') return DEFAULT_WORK_MODE
    const v = deref((raw as Record<string, unknown>).mode)
    return typeof v === 'string' && (WORK_MODE_VALUES as readonly string[]).includes(v)
      ? (v as WorkMode)
      : DEFAULT_WORK_MODE
  } catch {
    return DEFAULT_WORK_MODE
  }
}

/**
 * 读出「首次铺骨架」开关的**普通布尔**（2026-10-16 第 224 轮 · `UD-118`「C」）。
 *
 * ⚠ **调用方一律不许直接读 `config.skeleton.enabled`**（与 {@link moduleSwitches} /
 *   {@link spawnDefaults} 同一条纪律）：该子字段标了 `.volatile()` ⇒ 运行时是 **ref 对象**
 *   ⇒ 直读会拿到 ref（**恒 truthy 且不报错**）。
 *
 * ── 兜底口径 ──────────────────────────────────────────────────────────
 *   读不出来 ⇒ **`true`**（与 schema 的 `.default(true)` 一致）。
 *   ⚠ 理由 = 取**后果更轻**的那一边：⚠ 这个功能的失效方向是"多铺一次"，
 *   而 ⛔ **永不覆盖已存在的 `.hob/`**（只补缺）⇒ ⚠ **多铺的后果是空操作**；
 *   反过来（读不出来就关掉）会让"装到别的实例"**重新依赖人记得复制** ——
 *   那正是 `UD-118` 要治的形态。
 *
 * @param config - 插件配置（来自 Loader 时是 ref 形态；测试里的裸对象是普通形态）。
 */
export function skeletonEnabled(config: unknown): boolean {
  const raw = deref((config as { skeleton?: unknown } | undefined)?.skeleton)
  if (raw === null || typeof raw !== 'object') return true
  const v = deref((raw as Record<string, unknown>).enabled)
  return typeof v === 'boolean' ? v : true
}

/**
 * 读出「跨实例投递」开关的**普通布尔**（M6a · 2026-10-16 第 237 轮 · `UD-119` 裁定）。
 *
 * ⚠ **调用方一律不许直接读 `config.modules.interconnect`**（与 `moduleSwitches` 同一条纪律）：
 *   该子字段标了 `.volatile()` ⇒ 运行时是 **ref 对象** ⇒ 直读会拿到 ref（**恒 truthy 且不报错**）。
 *
 * ── 兜底口径 ──────────────────────────────────────────────────────────────
 *   读不出来 ⇒ **`false`**（与 schema 的 `.default(false)` 一致）。
 *   ⚠ 理由：⚠ **它的失效方向是"在无人看管时向别处投递"** ⇒ ⚠ **宁可不开**
 *     （⚠ 与 `orch` 同一条"取后果更轻的那一边"纪律；⚠ 与 `skeletonEnabled` 的方向相反，
 *     因为那两个功能的失效方向本身相反）。
 *
 * @param config - 插件配置（来自 Loader 时是 ref 形态；测试里的裸对象是普通形态）。
 */
export function interconnectEnabled(config: unknown): boolean {
  const raw = deref((config as { modules?: unknown } | undefined)?.modules)
  if (raw === null || typeof raw !== 'object') return false
  const v = deref((raw as Record<string, unknown>).interconnect)
  return typeof v === 'boolean' ? v : false
}

/**
 * 读出**对端白名单**（⚠ 那条"⛔ 不接受任意远端"硬边界的载体）。
 *
 * ── 解析口径（⚠ 一行一个对端）──────────────────────────────────────────────
 *   · `名字` ⇒ ⚠ 对端名 = 名字，⚠ launcher 用缺省（**运行时解析**，⛔ 不是写死的安装路径）；
 *   · `名字=<launcher>` ⇒ ⚠ 显式给启动器；
 *   · ⚠ 空行 / 名字里有非法字符（空格、`=` 之外的分隔符）⇒ **跳过该行**（⚠ 但**不报错** ——
 *     ⚠ 因为"跳过"在这里的后果只是"少一个对端"，⚠ 而**投递时会因为"不在白名单"而被拒并点名**
 *     ⇒ ⚠ **⛔ 不会静默地投到别处**）。
 *   ⚠ ⚠ **名字唯一**：⚠ 同名后者覆盖前者（⚠ 保持"点名的那个"是确定的）。
 *
 * ⚠ **兜底**：⚠ 读不出来 ⇒ **空数组**（⚠ = 谁都不许投 ⇒ ⚠ 每个对端都被拒、且拒的时候点名）。
 *
 * ⚠ ⚠ **本函数是白名单的**唯一**解析点** —— ⚠ 消费方（`interconnect.ts`）⛔ 不自己解析字符串。
 */
export function interconnectTargets(config: unknown): { name: string; launcher?: string }[] {
  const raw = deref((config as { interconnectTargets?: unknown } | undefined)?.interconnectTargets)
  if (raw === null || typeof raw !== 'object') return []
  const list = deref((raw as Record<string, unknown>).list)
  if (!Array.isArray(list)) return []
  const out = new Map<string, { name: string; launcher?: string }>()
  for (const item of list) {
    if (typeof item !== 'string') continue
    const line = item.trim()
    if (line === '') continue
    const eq = line.indexOf('=')
    const name = (eq < 0 ? line : line.slice(0, eq)).trim()
    const launcher = eq < 0 ? undefined : line.slice(eq + 1).trim()
    // ⚠ 名字里不许有空白（⚠ 那会让"显式点名"变得不可靠）—— ⚠ 这样的行跳过。
    if (name === '' || /\s/.test(name)) continue
    out.set(name, { name, ...(launcher === undefined || launcher === '' ? {} : { launcher }) })
  }
  return [...out.values()]
}
