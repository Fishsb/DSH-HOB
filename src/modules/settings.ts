/**
 * M4 · 配置面收口（schema 唯一来源）+ 与宿主 settings 服务的连接点。
 *
 * ── 本模块的职责 ──────────────────────────────────────────────────────
 *   ① **schema 唯一来源**：把 `config.ts` 的 `Config` 与类型重新导出，
 *      全插件（含 client 半边、预设行）都从这里取，**不各写一份**；
 *   ② **连接点**：`settings` 服务就绪时，确认本插件在宿主配置面上"可见"，
 *      并把结果如实打出来（可见/不可见都要说出来 —— 见下）。
 *
 * ── 本模块**不做**什么（刻意）─────────────────────────────────────────
 *   · **不为设置页写任何 UI**：宿主 `SettingsForms.describe()` 已经**自动生成**
 *     表单（本插件 `autoGenerate=true`，实测），字段的**中文标签与说明来自
 *     schema 的 `.description()`**（写在 `config.ts`）。自建页面是重复造轮子（§5.4）。
 *   · **不自己实现写入**：写入走宿主 `settings.update()`（Remote RPC），
 *     落盘到 profile 的 `cordis.patch.yml`。旧项目实测过自造 HTTP 路由完全不必要（E-10）。
 *
 * ── 一条**必须如实报告**的语义边界（第 6 步实测）─────────────────────
 *   `settings.update()` **即改即生效**，但**只对"值型"字段成立**：
 *
 *   | 字段 | 类型 | 改后是否即时生效 |
 *   |---|---|---|
 *   | `modules.*`（四个开关） | **拓扑型** | ❌ **需重载** |
 *
 *   ⚠ **本插件已没有"值型字段"了**（2026-10-06 配置面清理轮，UD-43）：
 *     原先的 `persona` / `showEntry` / `delivery` 三个字段**已删除** ——
 *     它们是"空旋钮"（界面上有、背后无功能：`persona` 只进日志，
 *     另两个无人消费），用户决定清掉，只留真开关。
 *     ⇒ 所以本表只剩"拓扑型"一行。若将来新增**真有消费方**的值型字段，
 *       这一行要连同"即时生效"那句一起加回来（别只加字段不加说明）。
 *
 *   为什么模块开关需重载：宿主写入后只做 `resolveConfig(fiber.runtime, resolved)`
 *   （`dsh-config-editor/lib/index.js:83`）—— 它**重新校验**配置对象，
 *   但**不会重新执行 `apply()`**。而模块的装载/卸载发生在 `apply()` 里
 *   （`src/index.ts` 的 `MODULE_REGISTRY` 循环），所以开关值变了、
 *   已装载的模块**不会被卸载**。
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

export function apply(ctx: any): void {
  ctx.logger?.info?.(`[${name}] 已激活（配置面收口；设置页由宿主自动生成）`)

  ctx.inject(['settings'], (svcCtx: any) => {
    const settings = svcCtx.settings ?? svcCtx.get?.('settings')
    if (settings === undefined) {
      svcCtx.logger?.warn?.(`[${name}] settings 已就绪但不可用。`)
      return
    }

    svcCtx.effect(() => {
      try {
        const rows: DescriptorRow[] = settings.describe?.() ?? []
        const mine = rows.find((r) => r.ns === SETTINGS_NS)

        // ⚠ **如实报告可见性**：看不到就说看不到，不要沉默（E-08/E-29 同族）。
        //   看不到的典型原因是 schema 里没有任何 volatile（`volatileForm` 返回 undefined
        //   ⇒ `describe()` 对该 entry 直接 `return []`），且**宿主不会报错**。
        if (mine === undefined) {
          svcCtx.logger?.warn?.(
            `[${name}] 本插件在设置面上**不可见**（namespace=${SETTINGS_NS}）。`
            + `请检查 config.ts：schema 里必须至少有一个 .volatile() 字段，`
            + `否则宿主 describe() 会静默跳过本 entry。`,
          )
          return () => { /* 无可清理资源 */ }
        }

        // 可见时把「哪些字段会显示」说清楚 —— 便于事后核对，不必靠截图。
        const fields = Object.keys((mine.schema as { dict?: Record<string, unknown> } | undefined)?.dict ?? {})
        ctx.logger?.info?.(
          `[${name}] 设置页可见：namespace=${SETTINGS_NS} autoGenerate=${mine.autoGenerate}`
          + ` revision=${mine.revision} 字段=[${fields.join(', ')}]`,
        )
      } catch (e) {
        // 观测路径失败不该影响配置面本身。
        svcCtx.logger?.warn?.(`[${name}] describe() 探测失败：${String((e as Error)?.message ?? e)}`)
      }
      return () => { /* 只读探测，无资源 */ }
    }, `${name}: settings visibility probe`)
  })
}
