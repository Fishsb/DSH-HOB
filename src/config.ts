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
  /** M2 预设声明模块。 */
  preset: boolean
  /** M3 会话总线模块（同实例内会话之间传话）。 */
  bus: boolean
  /** M5 编排模块（闭环派活：投递 → 等对方跑完 → 回传结果 → 唤醒派活方）。 */
  orch: boolean
  /** M4 配置 schema 模块。 */
  settings: boolean
}

/**
 * 「新建会话默认值」（{@link Config.spawn} 的**普通值**形态）。
 *
 * ⚠ 与 {@link ModulesConfig} 同一条纪律：schema 上四个子字段**各标 `.volatile()`**，
 *   运行时它们都是 **ref 对象** ⇒ **调用方一律不许直接读 `config.spawn.x`**
 *   （直读恒真/恒为 ref，且不报错）。唯一入口是 {@link spawnDefaults}。
 */
export interface SpawnDefaults {
  /** 新会话默认 Agent 预设 id；空串 = 用宿主默认预设。 */
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
   *   · `tools` / `preset` / `settings` = `Volatile<boolean>`（ref 对象，为了在设置页可见）；
   *   · `bus` = 普通 `boolean`（刻意不标 volatile ⇒ 设置页不呈现，UD-25）。
   * ⇒ **绝不要直接读 `config.modules.x`**：三个 ref 恒 truthy、且不报错。
   *   一律经 {@link moduleSwitches} 取普通布尔。
   */
  modules: {
    tools: import('@deepseek-ai/cordis').Volatile<boolean>
    preset: import('@deepseek-ai/cordis').Volatile<boolean>
    /**
     * ⚠ **批 14 / M3 起改为 ref（volatile）** —— 它现在在设置页**可见**。
     *   v1–v4 时期它是普通布尔且刻意隐藏（UD-25：「开了也不起作用」会误导用户）。
     *   M3 落地后该模块**真管用**（提供 `hobBus` 服务 + 注册 2 个投递工具），
     *   隐藏它反而变成"用户看不到这个真实开关"（PROJECT.md §5.3 的静默失败）。
     *   ⇒ 与 `tools` / `preset` / `settings` 同形。
     */
    bus: import('@deepseek-ai/cordis').Volatile<boolean>
    settings: import('@deepseek-ai/cordis').Volatile<boolean>
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
   *     · 返回的 form 顶层键 = `["modules"]`，其子字段 = `{tools, preset, bus, settings}`
   *       （批 14 起含 `bus`；此前为 `{tools, preset, settings}`）
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
   * | **E**：父 volatile + schema 里**不声明** `bus` | `tools/preset/settings` | ❌ **一次 UI 写入就被抹掉** | **不可用** |
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
   *   `tools` / `preset` / `bus` / `settings` **各自都是 ref 对象** ⇒ `cfg.modules.tools`
   *   是 ref（**恒 truthy**！直接当布尔用会**永远为真**，且不报错）。
   *   ⇒ 这件事**只能**由 {@link moduleSwitches} 收口，调用方一律不许自己解。
   */
  modules: z.object({
    tools: z.boolean().default(true)
      .description('工具模块：提供「助手」会话里的两个工具（读文档 / 写账本）。')
      .volatile(),
    preset: z.boolean().default(false)
      .description('预设模块：以编程方式登记 / 查询 Agent 预设（预设本身由插件包自带，不依赖本开关）。')
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
      .description('新建会话默认预设（id，如 `Hob`）。留空 = 用宿主默认预设。只影响本插件建出的会话，不影响手工新建的会话。')
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
 * | `tools` / `preset` / `bus` / `settings`（批 14 起） | ✅ 有（为了显示） | **ref 对象** | **ref**（恒 truthy，`if (m.tools)` 永远为真） |
 *
 * ⇒ **任何"直接读 `config.modules.x` 当布尔用"的写法的后果都是静默的**（永远为真，
 *   且不报错）。本函数是**唯一**允许碰 `config.modules` 的地方：逐字段 `deref()`，
 * 调用方（`src/index.ts` 的模块登记表）永远拿**普通布尔**，不必知情。
 *
 * ⚠ 兜底原则：读不出来的字段给**安全默认**（见下方返回值），
 *   宁可模块多加载也不因读配置失败而整插件停摆。
 *
 * @param config - 插件配置（来自 Loader 时是 ref 形态；测试里的裸对象是普通形态）。
 * @returns 四个模块开关的普通布尔对象。
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
    preset: pick('preset', false),
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
  }
}
