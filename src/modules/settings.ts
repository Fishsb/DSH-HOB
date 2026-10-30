/**
 * M4 · 配置面收口（schema 唯一来源）+ **设置面可见性自检**。
 *
 * ── 本模块的职责（⚠ 2026-10-24 第 5 轮订正：与实现逐条对齐）───────────────
 *   ① **schema 唯一来源**：把 `config.ts` 的 `Config` 与类型重新导出，
 *      全插件（含 client 半边、预设行）都从这里取，**不各写一份**；
 *   ② **可见性自检（探测）**：`settings` 服务就绪时，问宿主 `describe()`
 *      要一行"本插件在配置面上到底可见不可见"，并把结果如实打出来
 *      （可见/不可见都要说出来 —— 见下）。
 *
 * ── ⚠⚠ 本模块**不控制**设置页分区的在场与否（2026-10-24 订正）────────────
 *   **改前的错误说法**：`config.ts` 的 `modules.settings` 描述曾写
 *   「设置模块：登记本插件的配置面，使其出现在这个设置页里。」—— ⚠ **不成立**。
 *   实测（读宿主 `dsh-settings/lib/index.js` 的 `describe()` 与本仓 `src/client/index.ts`）：
 *   · 分区是否出现，由**两条与本开关无关的事实**决定：
 *     ① client 半边 `src/client/index.ts` 在 `ctx.slots.inject('settings.section', …)`
 *        里**无条件**注册那一格（`id = PACKAGE_NAME`）—— 没有开关、也不读插件 config
 *        （client 半边根本拿不到插件 config，那份 config 只在宿主侧）；
 *     ② 宿主 `describe()` 是否为本 entry 返回表单行 —— 条件是 **fiber 已 ACTIVE 且
 *        schema 里至少有一个 `.volatile()` 字段**（`volatileForm()` 非 `undefined`）。
 *        ⚠ 那也是**入口条目**（`dsh-hob` 本身）的属性，与本模块装不装无关。
 *   ⇒ **本模块关掉时**：分区**照样在**，少掉的只是本文件这段**探测日志**。
 *     这句话现在是本模块的**契约**（见下方 {@link apply} 的日志文案），
 *     ⛔ 不许再改回"关掉 ⇒ 配置面消失"那种说法。
 *
 * ── 那它为什么还留着（不删的理由）───────────────────────────────────────
 *   它是**唯一**会去问一句"宿主到底认不认本 entry"的代码：`describe()` 在两种情况下
 *   **静默**给空结果（entry 未 ACTIVE / schema 里一个 volatile 都没有），宿主**不报错**。
 *   ⇒ 留一个**只读自检**在设置面这条链上，把"不可见"变成一行可读的 warn；
 *     关掉它 = 放弃这条自检（**这是它唯一的作用**，也是 `modules.settings` 的准确语义）。
 *
 * ── 本模块**不做**什么（刻意）─────────────────────────────────────────
 *   · **不为设置页写任何 UI**：宿主 `SettingsForms.describe()` 已经**自动生成**
 *     表单（本插件 `autoGenerate=true`，实测），字段的**中文标签与说明来自
 *     schema 的 `.description()`**（写在 `config.ts`）。自建页面是重复造轮子（§5.4）。
 *   · **不自己实现写入**：写入走宿主 `settings.update()`（Remote RPC），
 *     落盘到 profile 的 `cordis.patch.yml`。旧项目实测过自造 HTTP 路由完全不必要（E-10）。
 *
 * ── 一条**必须如实报告**的语义边界（第 6 步实测；⚠ 2026-10-24 订正表体）────
 *   `settings.update()` **即改即生效**，但**只对"值型"（= schema 里标了 `.volatile()`）字段成立**：
 *
 *   | 字段 | 类型 | 改后是否即时生效 |
 *   |---|---|---|
 *   | `modules.*`（四个开关） | **拓扑型**（⚠ 只用于**显示**才标了 volatile） | ❌ **需重载** |
 *   | `spawn.*` | **值型** | ✅ 即时（下一次建会话时按新值） |
 *   | `workMode.mode` | **值型** | ✅ 即时 |
 *   | `skeleton.enabled` | **值型** | ✅ 即时（下一次真写时按新值；⚠ 本轮才真正接上消费方） |
 *   | `permission.level` | **值型，但已无消费方** | ⚠ **改了什么都不会变**（也不是迁移来源 —— 迁移只搬「推进方式」，档位按最低档落库；见 `config.ts` 的说明） |
 *
 *   ⚠ **改前这张表只写了一行 `modules.*`，还附了一句"本插件已没有值型字段了"** ——
 *     那句话自 `spawn` / `workMode` / `skeleton` 落地起就**不再成立**（上面五行都是
 *     `.volatile()`）。⇒ 本轮按 schema 逐字段订正（⛔ 不再靠记忆；判据 =
 *     `check:config` 的 B 组对 volatile 形状的双向比对）。
 *   ⚠ **`permission.level` 单独标出来**是刻意的：它是**值型但没人读**——
 *     若混在"✅ 即时"那一档里，等于继续承诺一件不会发生的事（本单必修 2）。
 *
 *   为什么**模块开关**即便标了 volatile 仍需重载：宿主写入后只做
 *   `resolveConfig(fiber.runtime, resolved)`（`dsh-config-editor/lib/index.js:83`）——
 *   它**重新校验**配置对象，但**不会重新执行 `apply()`**。而模块的装载/卸载发生在
 *   `apply()` 里（`src/index.ts` 的 `MODULE_REGISTRY` 循环），所以开关值变了、
 *   已装载的模块**不会被卸载**。
 *   ⚠ 那些开关标 `.volatile()` 的**真实目的**是"让宿主的 `volatileForm()` 认这个
 *     字段 ⇒ 设置面能画出它"，⛔ 不是"承诺它热生效"。两者是不同的事，别混着说。
 *
 *   ⚠ 这不是缺陷，是宿主的既定语义：`volatile` 的定义就是
 *     *"editable **without remounting**"*（`dsh-settings/lib/types/schema.d.ts:7`）。
 *     要改变**挂载拓扑**，本来就需要重新挂载。
 *
 *   ⇒ 对用户的诚实说法：**「改了模块开关要重启实例才生效」**。
 *     本模块把这句话在设置页可见的地方也说一遍（见 `client/settings-panel.tsx`）。
 *
 * 依赖语义：`settings` 服务由 `@deepseek-ai/dsh-settings` 提供，且在
 * `dsh-base/cordis.patch.yml:101-103` 处被
 * `disabled: !!js "!ctx.get('profileContext')"` **门控** —— 即
 * **headless/无 profileContext 的场景下该服务不存在**。
 * 这正是本模块该用反应式 `ctx.inject` 的原因：服务不在 ⇒ 不激活，
 * 但**插件与其它模块照常工作**。
 */
export { Config, moduleSwitches } from '../config.ts'
export type { Config as ConfigShape, ModulesConfig } from '../config.ts'

export const name = 'dsh-hob-settings'

/**
 * 本插件的 settings namespace ＝ profile entry id ＝ 包名。
 *
 * ⚠ 三者必须与 `cordis.patch.yml` 的 `id` / `package.json` 的 `name` /
 *   本文件所在入口的 `name` **完全一致**，不一致就永远拿不到 form（E-03）。
 */
export const SETTINGS_NS = 'dsh-hob'

/** `describe()` 里属于本插件的那一行（只取本模块用到的字段）。 */
interface DescriptorRow {
  ns: string
  autoGenerate: boolean
  revision: number
  /** 表单 schema（宿主已按 volatile 投影过）。 */
  schema?: { dict?: Record<string, unknown> } | unknown
  /** 当前生效值。 */
  value?: unknown
}

/**
 * 自检结果 —— ⚠ **结构化返回**（不只是往日志里打一行）。
 *
 * 为什么要有这个返回形状：日志是**易失**的（用户默认关 debugLog、控制台会滚走），
 * 而"宿主到底认不认本 entry"这件事必须**可判**（诊断脚本 / 将来面板都能读）。
 * ⇒ {@link probeSettingsVisibility} 是**纯函数**（不碰 ctx、不写盘），
 *   {@link apply} 只是把它的结果打成日志。
 */
export interface VisibilityProbeResult {
  /** 宿主 `describe()` 是否为本 entry 返回了**一行**表单（= 在配置面上可见）。 */
  visible: boolean
  /** 判据落到哪一档（⚠ 失败原因不许合并成一句 —— 见下 `message`）。 */
  reason: 'visible' | 'no-row' | 'describe-unavailable' | 'probe-failed'
  /** 查询的 namespace。 */
  ns: string
  /** 可见时：宿主给的 `autoGenerate`（本插件应为 `true`）。 */
  autoGenerate?: boolean
  /** 可见时：宿主给的 revision。 */
  revision?: number
  /** 可见时：schema 里的字段名（便于事后核对"哪些字段会出现在表单里"）。 */
  fields: string[]
  /** 给人/日志看的一句话（⚠ 不可见时必须说清**为什么**）。 */
  message: string
}

/**
 * 只读探测：问宿主 `describe()` 要一行本插件的表单描述。
 *
 * ⚠ **纯函数**：只读入参 `settings`，不依赖 `ctx`、不写任何状态 ⇒ 可被机检直接调用
 *   （真跑的话需要宿主 `SettingsForms` 实例；机检用**形状相同的假对象**即可）。
 *
 * ⚠ 三种"看不见"必须**分开说**（⛔ 不许合并成一句"设置面不可见"）：
 *   · `describe-unavailable` —— `settings.describe` 不是函数/缺席（服务形状不对）；
 *   · `no-row`              —— `describe()` 能调，但**没有本 ns 的行**
 *                              （典型成因：entry 未 ACTIVE，或 schema 里一个 `.volatile()` 都没有
 *                              ⇒ 宿主 `volatileForm()` 返回 `undefined` ⇒ `describe()` 对该 entry `return []`）；
 *   · `probe-failed`        —— `describe()` 抛错（观测路径失败）。
 *
 * @param settings - 宿主 `settings` 服务（或同形状对象）。
 * @param ns - 目标 namespace（缺省 {@link SETTINGS_NS}）。
 */
export function probeSettingsVisibility(settings: any, ns: string = SETTINGS_NS): VisibilityProbeResult {
  const base = { ns, fields: [] as string[] }
  if (settings === undefined || settings === null || typeof settings.describe !== 'function') {
    return {
      ...base,
      visible: false,
      reason: 'describe-unavailable',
      message: `宿主 settings 服务**没有 describe()** ⇒ 无法判断本插件在设置面上是否可见`
        + `（⚠ 这是"取数面缺能力"，⛔ 不等于"不可见"）。`,
    }
  }
  try {
    const rows: DescriptorRow[] = settings.describe() ?? []
    const mine = Array.isArray(rows) ? rows.find((r) => r?.ns === ns) : undefined
    if (mine === undefined) {
      return {
        ...base,
        visible: false,
        reason: 'no-row',
        message: `本插件在设置面上**不可见**（namespace=${ns}）：宿主 describe() 没有为本 entry 返回表单行。`
          + ` 常见成因：① 本 entry 的 fiber 不是 ACTIVE；② schema 里**一个 .volatile() 字段都没有**`
          + `（宿主 volatileForm() 返回 undefined ⇒ describe() 对该 entry 静默跳过，**宿主不报错**）。`
          + ' ↳ 修法：检查 config.ts —— 至少保留一个 .volatile() 子字段'
          + '（modules / spawn 等组已各带）。',
      }
    }
    const fields = Object.keys((mine.schema as { dict?: Record<string, unknown> } | undefined)?.dict ?? {})
    return {
      ...base,
      visible: true,
      reason: 'visible',
      autoGenerate: mine.autoGenerate,
      revision: mine.revision,
      fields,
      message: `设置页可见：namespace=${ns} autoGenerate=${mine.autoGenerate}`
        + ` revision=${mine.revision} 字段=[${fields.join(', ')}]。`
        + ` ⚠ 这条只回答"宿主 describe() 认不认本 entry"；`
        + `分区在界面上**出现在哪、标题叫什么**由 client 半边（src/client/index.ts 的`
        + ` settings.section 注册）决定，与本模块的开关无关。`,
    }
  } catch (e) {
    return {
      ...base,
      visible: false,
      reason: 'probe-failed',
      message: `describe() 探测失败：${String((e as Error)?.message ?? e)}`
        + `（⚠ 观测路径失败，不代表配置面本身坏了）。`,
    }
  }
}

/**
 * 模块体：**只做自检**（⚠ 不注册 UI、不提供开关能力 —— 见文件头"本模块不控制…"）。
 *
 * ⚠ 关掉本模块（`modules.settings = false`）的**真实后果**只说一件：
 *   不再有这条自检日志。⛔ 不是"设置页分区消失"。
 */
export function apply(ctx: any): void {
  ctx.logger?.info?.(
    `[${name}] 已激活（配置面自检；⚠ 设置页分区由 client 半边注册，关掉本模块只会少掉这条自检）`,
  )

  ctx.inject(['settings'], (svcCtx: any) => {
    const settings = svcCtx.settings ?? svcCtx.get?.('settings')
    if (settings === undefined) {
      svcCtx.logger?.warn?.(`[${name}] settings 已就绪但不可用（取到 undefined）⇒ 本轮不做可见性自检。`)
      return
    }

    /**
     * ⚠ 探测跑在 `effect` 里（而不是激活时一次性）：宿主重挂 entry / 改配置后
     *   `describe()` 的行会变（revision 变），这里跟着重跑一遍是**只读**的。
     * ⚠ 但**不是**"每次 describe 都跑" —— 只在依赖变化/重挂时跑，成本可忽略。
     */
    const runProbe = (): void => {
      const r = probeSettingsVisibility(settings)
      const log = (m: string): void => { try { svcCtx.logger?.info?.(`[${name}] ${m}`) } catch { /* 日志失败不影响任何判定 */ } }
      const warn = (m: string): void => { try { svcCtx.logger?.warn?.(`[${name}] ${m}`) } catch { /* 同上 */ } }
      // ⚠ 如实报告：可见就说可见、不可见就说**为什么**不可见（E-08/E-29 同族）。
      if (r.reason === 'visible') log(r.message)
      else warn(r.message)
    }

    if (typeof svcCtx.effect === 'function') {
      svcCtx.effect(() => {
        runProbe()
        return () => { /* 只读探测，无资源 */ }
      }, `${name}: settings visibility probe`)
    } else {
      // ⚠ 夹具/老宿主没有 effect ⇒ 降级成"跑一次"，⛔ 不抛（观测路径不该拖垮配置面）。
      runProbe()
    }
  })
}
