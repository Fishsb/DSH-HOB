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
  /** M4 配置 schema 模块。 */
  settings: boolean
}

export interface Config {
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
    /** ⚠ 普通布尔（**不是** ref）—— 刻意不在设置页呈现，配置键保留待 M3。 */
    bus: boolean
    settings: import('@deepseek-ai/cordis').Volatile<boolean>
  }
  /**
   * 人格/说话风格 —— **占位字段**，本轮没有任何代码读它。
   *
   * ⚠ 它带 `.volatile()` 是**刻意的**，用作「设置页可见」这条链路的**活样板**：
   *   DSH 的 `SettingsForms.describe()` 对每个 entry 先跑 `volatileForm(schema)`，
   *   **返回 undefined 就 `return []`** —— 该 entry 不出现在结果里，
   *   `configForms.get('<ns>')` 永远拿不到 value。而 `volatileForm` 的规则是
   *   **schema 里至少有一个字段带 `.volatile()`**。
   *   ⇒ 一个 volatile 都没有时，插件在设置页里**完全不可见**（且不报错）。
   *   详细踩坑见 `.hob/EXPERIENCE.md` E-08。
   *
   * ⚠ volatile 的两个硬约束（实测）：
   *   ① **父子不能同时标** —— 父对象标了 volatile，再给它的子字段标，**解析时**抛
   *      `ValidationError`：`volatile fields require a fixed object path without an
   *      enclosing volatile field`（`schemastery/src/index.ts:488-509` 的
   *      `validateVolatileSchema`）。
   *      ⚠ 精确表述（2026-10-05 复核纠正）：抛错的是「**父子同标**」，
   *        **不是**「给子字段各标」。**父不标 + 子字段各自标是完全合法的**，
   *        而且正是"隐藏某个子字段"唯一可行的形状（见下方 `modules` 的说明）。
   *      ⚠ 另一条曾被写错的表述：volatile **不必**是"顶层叶子" ——
   *        嵌在**非 volatile** 父对象里的 volatile 叶子同样合法
   *        （本项目的 `modules.tools` 就是这种，实测构造/解析都 OK）。
   *        受限的只是"volatile 里面再套 volatile"。
   *   ② 运行时它是 **ref 对象而非真值** ⇒ 读取必须 `.get()`，直读会**静默**得到 `{}`。
   *      类型写 `Volatile<string>`（而非裸 `string`）才能让 TS 站到正确一边。
   */
  persona: import('@deepseek-ai/cordis').Volatile<'mentor' | 'executor'>

  // ── M4 本轮新增：设置面板的字段（**已定字段，不接业务**）────────────────
  // ⚠ 下面这几个字段**本轮没有任何代码读它们**（除设置面板的只读展示）。
  //   它们的作用是让「设置页面板」这条链路有真实内容可渲染 —— 也就是
  //   把 C1 的面板骨架立起来，而不是留一个空壳。
  //   真接业务在后续批次，届时**不要**改字段名（会动 profile 里已落盘的配置键）。

  /** 是否在界面上显示悬浮球/入口。默认关闭（骨架期无 UI 可显示）。 */
  showEntry: import('@deepseek-ai/cordis').Volatile<boolean>
  /** 会话之间传话时使用的投递方式。语义见 `.hob/EXPERIENCE.md` E-40。 */
  delivery: import('@deepseek-ai/cordis').Volatile<'followup' | 'steer' | 'inject'>
}

export const Config = z.object({
  /**
   * 各模块开关。
   *
   * ⚠⚠ **形状 = 父对象【不】标 volatile；`tools`/`preset`/`settings` 三个子字段各标；
   *   `bus` 刻意不标** —— 这是第 6 步修订实测逼出来的形状（**方案 D**），
   *   为的是"**在设置页隐藏 `bus`、但保留 `modules.bus` 这个配置键**"（UD-25）。
   *
   * ── 为什么"隐藏一个子字段"需要这么绕（先看机制，别重走弯路）────────────
   * 宿主 `volatileForm(schema)`（`dsh-settings/lib/index.js:122-131`）的规则是：
   *   · schema **自己**带 `volatile` ⇒ `plainSchema(schema)` —— **整块原样呈现，子字段全显示**；
   *   · schema 是 object 且自己不带 ⇒ 递归子字段，**返回 `undefined` 的会被过滤掉**；
   *   · 一个 live 字段都没有 ⇒ 返回 `undefined` ⇒ 整块消失。
   *
   * ⇒ 两条**已实测**的推论：
   *   (a) **父子同标会直接抛** `ValidationError`（schemastery 的
   *       `validateVolatileSchema` 禁止 volatile 里再套 volatile，
   *       `schemastery/src/index.ts:488-509`）。
   *       ⚠ **精确边界（2026-10-05 复核纠正，与 PROJECT.md §5.3.1 一致）**：
   *         抛错的是「**父子同标**」；「**父不标 + 子各标**」**完全合法** ——
   *         正是本 `modules` 采用第二种形状的原因。别再把它误记成
   *         "给子字段各标会抛"（那会把人引向错误的规避方案）。
   *   (b) **父整体标了 volatile 之后，schema 层无法让某个子字段单独消失**
   *       （整块走 `plainSchema`，子字段全在）。
   *
   * （以上三条形状规则均可用 node 独立复现：构造阶段全 OK，差异只在**解析**阶段。
   *   复现脚本见 `.hob/archive/2026-10-05-step6rev2-evidence/volatile-三形状复现.mjs`。）
   *
   * ── 两种候选方案的实测对照（选 D 的理由）────────────────────────────
   * | 方案 | 设置页 | `bus` 键是否保留 | 结论 |
   * |---|---|---|---|
   * | **E**：父 volatile + schema 里**不声明** `bus` | `tools/preset/settings` | ❌ **一次 UI 写入就被抹掉** | **不可用** |
   * | **D**：父不标 + 三个可见子字段各标，`bus` 不标 | `tools/preset/settings` | ✅ **保留**（写入后仍在） | **采用** |
   *
   * **为什么 E 会丢**（实测复刻宿主写入路径得出）：`modules` 整体 volatile ⇒
   * 宿主 `strip()` 对整块返回 `{}`（连同 `bus` 一起从旧值里删掉），
   * 再 merge 进 `projectForm` 投影后的新值（其中**根本没有** `bus`）⇒ `bus` 被静默抹除。
   * 而 D 的形状下 `strip()` 只删三个 volatile 子键，**`bus` 不是 volatile ⇒ 被保留**。
   * （复刻脚本与结论见 `.hob/archive/2026-10-05-step6rev-evidence/`。）
   *
   * ⚠ **代价（同上一版，只是落点从父移到三个子字段）**：
   *   `tools` / `preset` / `settings` 各自是 **ref 对象** ⇒ `cfg.modules.tools` 是 ref
   *   （**恒 truthy**！直接当布尔用会**永远为真**，且不报错）。
   *   而 `bus` **不是** ref，是**普通布尔** —— 同一层里**两种形态并存**。
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
     * ⚠ **刻意不标 `.volatile()` ⇒ 不在设置页呈现**（UD-25）。
     *   理由：M3 已挂起（先做半自动转交），"开了也不起作用"，
     *   显示出来会误导用户以为"开了就有效"。
     *
     * ⚠ **但配置键必须保留** —— M3 将来要用；它仍可被读（`moduleSwitches().bus`）、
     *   也可在 profile 的 `cordis.patch.yml` 里手工设置。
     *   本字段的 `.description()` 只服务于**读代码的人**（设置页不显示它）。
     */
    bus: z.boolean().default(false)
      .description('会话总线（M3，当前挂起）：同实例内会话之间传话。刻意不在设置页呈现，配置键保留待 M3 使用。'),
    settings: z.boolean().default(true)
      .description('设置模块：登记本插件的配置面，使其出现在这个设置页里。')
      .volatile(),
  }).default({}),

  // 顶层字段（这里放顶层只是为了可读性；volatile **不必**是顶层叶子 ——
  // 嵌在非 volatile 父对象里的 volatile 叶子同样合法，见上方 persona 的说明）。
  // 默认 'mentor'：与旧项目一致，便于对照。
  persona: z.union(['mentor', 'executor'])
    .default('mentor')
    .description('人格档位：mentor＝引导式（先解释再动手）；executor＝执行式（直接干活）。')
    .volatile(),

  // M4 新增字段（同为顶层 volatile；"顶层"是布局选择，不是 volatile 的硬要求）。
  showEntry: z.boolean().default(false)
    .description('是否在界面上显示本插件的悬浮球入口。关闭时只保留设置页里的配置项。')
    .volatile(),
  // 默认 'followup'：语义最直白（开一个新 turn），且是三者中唯一
  // 「排队 + 唤醒」都做的（见 M3 接口确认结论）。
  delivery: z.union(['followup', 'steer', 'inject'])
    .default('followup')
    .description('会话之间传话时的投递方式：followup＝排队成下一个回合（默认）；steer＝插进当前回合的最近一步；inject＝只塞上下文、不唤醒对方。')
    .volatile(),
})

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
 * 为了"在设置页可见 / 隐藏某一个"，`modules` 的子字段**形态不一致**：
 *
 * | 字段 | schema 上的 volatile | 运行时形态 | 直读 `modules.x` 得到 |
 * |---|---|---|---|
 * | `tools` / `preset` / `settings` | ✅ 有（为了显示） | **ref 对象** | **ref**（恒 truthy，`if (m.tools)` 永远为真） |
 * | `bus` | ❌ 无（为了隐藏，UD-25） | 普通布尔 | 真布尔 ✅ |
 *
 * ⇒ **同一层里两种形态并存**，任何"直接读"的写法都会在**其中一半**上静默出错。
 * 本函数是**唯一**允许碰 `config.modules` 的地方：逐字段 `deref()`，
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
    bus: pick('bus', false),
    settings: pick('settings', true),
  }
}
