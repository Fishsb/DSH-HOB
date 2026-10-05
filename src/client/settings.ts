/**
 * 设置绑定：经 DSH 原生 `configForms` 读 host 半的 config。
 *
 * 为什么不是 HTTP：client 半边**收不到插件 config**（挂载走
 * `loader.create({ name: id })`，只传 name）—— 但 `configForms` 走的是
 * **Remote RPC**（`settings.describe`），与挂载参数是两条不相干的路径。
 * ⚠ 所以**不要**自己造 `POST /config`（旧项目实测证明完全不必要，
 *   见 `.hob/EXPERIENCE.md` E-10）。
 *
 * ⚠ 两个已实测的硬约束（写在代码里免得后人踩）：
 * ① **schema 必须至少有一个字段带 `.volatile()`**，否则宿主 `describe()`
 *    对该 entry `return []`，这里拿到的 form 永远 `loading`。（见 config.ts）
 * ② **非回环访问时写入不落盘**（宿主硬编码
 *    `persistence = ctx.remote.$host.isLoopback ? "host" : "memory"`）。
 *    本模块本轮**只读**，不受影响。
 */

/**
 * 本插件的 settings namespace ＝ profile entry id ＝ 包名。
 *
 * ⚠ 三者必须与 `cordis.patch.yml` 的 `id` / `package.json` 的 `name` /
 * host 侧 `src/index.ts` 的 `name` **完全一致**，不一致就永远拿不到 form。
 */
export const SETTINGS_NS = 'dsh-hob'

/** `configForms.get()` 返回的快照（只取我们用到的字段）。 */
export interface SettingsSnapshot {
  /** `loading` 直到首个被接受的 section；`unavailable` = 命名空间不可见。 */
  status: 'loading' | 'ready' | 'unavailable'
  /** 当前生效的配置段（已按 schema 解析）。 */
  value: Record<string, unknown> | undefined
  /** 宿主是否接受写入（`memory` 模式下恒 false）。 */
  writable: boolean
  /** `host` 会落盘；`memory` 是远端浏览器的进程内模式。 */
  mode: 'host' | 'memory'
}

/** 对 configForms form 的最小接口（避免依赖宿主类型的运行时形态）。 */
export interface ConfigForm {
  getSnapshot(): SettingsSnapshot
  subscribe(listener: () => void): () => void
}

/**
 * 就绪的 settings form 的**外部存储**。
 *
 * 为什么需要它：`ctx.inject(['configForms'], cb)` 的回调是**异步**触发的
 * （服务并行激活 ⇒ 与一次 `ctx.get` 那个坑同源），而面板可能在那之前就渲染了。
 * 用 `useSyncExternalStore` 消费它 —— React 官方认可的接法。
 */
let currentForm: ConfigForm | null = null
const listeners = new Set<() => void>()

/** 登记就绪的 form。 */
export function setSettingsForm(form: ConfigForm | null): void {
  currentForm = form
  for (const fn of listeners) fn()
}

/** `useSyncExternalStore` 的 getSnapshot —— 返回稳定引用。 */
export function getSettingsForm(): ConfigForm | null {
  return currentForm
}

/** `useSyncExternalStore` 的 subscribe。 */
export function subscribeSettingsForm(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/**
 * 反应式绑定 settings form。
 *
 * ⚠ 必须用 `ctx.inject` **反应式**订阅，**不能**在 apply 里一次性 `ctx.get`：
 *   cordis 的 fiber 并行激活，一次性取值会在服务就绪前拿到 undefined，
 *   **且没有任何报错**（见 `.hob/EXPERIENCE.md` E-01）。
 *
 * @param ctx     client 半的 cordis context。
 * @param onReady form 就绪回调 —— 用于在**拿到 form 之后**才注册设置页。
 * @returns 解除绑定的函数（挂 `ctx.effect` 用）。
 */
export function bindSettingsForm(ctx: any, onReady?: (form: ConfigForm) => void): () => void {
  if (typeof ctx?.inject !== 'function') return () => {}

  const off = ctx.inject(['configForms'], (settingsCtx: any) => {
    const forms = settingsCtx?.get?.('configForms') ?? settingsCtx?.configForms
    // 拿不到服务就静默降级（**刻意不报错**：settings 失效不该让整个面板挂掉）。
    if (forms === undefined || typeof forms.get !== 'function') return
    const form = forms.get(SETTINGS_NS) as ConfigForm | undefined
    if (form === undefined || typeof form.getSnapshot !== 'function') return
    setSettingsForm(form)
    onReady?.(form)
  })

  return () => {
    setSettingsForm(null)
    off?.()
  }
}
