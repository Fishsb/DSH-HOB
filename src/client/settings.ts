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
 *    ⚠ **批 18（2026-10-09）起本模块不再只读**：设置面板新增「新建会话默认」卡片，
 *    首次引入**写入路径**（经宿主 `ConfigForm.mutate`，见 {@link ConfigForm.mutate}）。
 *    在这条约束下 ⇒ `writable === false`（非回环 / memory 模式）时
 *    **必须如实拒写并说明原因**，**不许假装保存成功**。
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
  /**
   * 写**一个或多个子字段**（宿主 `ConfigForm.mutate`）。
   *
   * ⚠ **必须写子字段路径**（如 `['spawn','provider']`），**不得整块写 `spawn`**：
   *   宿主 `dsh-settings` 的 `mutate()` 对每个 path 调 `isVolatilePath(schema, path)`
   *   （`lib/index.js:78-84`、`:507`），而本插件 schema 里**父对象 `spawn` 自己不标 volatile**
   *   （父子同标会抛 `ValidationError`）⇒ 整块写会被
   *   `throw new Error('Config field "spawn" is not volatile')` **拒掉**。
   *
   * @param ops - 宿主 `mutate` 的操作数组（`{op:'set'|'unset', path, value?}`）。
   * @returns 宿主是否接受（`false` = 被拒或持久化模式不允许；**不抛**）。
   */
  mutate(ops: readonly ConfigMutationOp[]): Promise<boolean>
}

/** 一条宿主配置写入操作（与 `dsh-settings` 的 `ConfigMutation` 同形）。 */
export interface ConfigMutationOp {
  op: 'set' | 'unset'
  /** **子字段路径**（相对本插件 namespace），如 `['spawn','provider']`。 */
  path: string[]
  value?: unknown
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

/** 一次写入的结果（**如实带原因**，供面板显示；不抛）。 */
export interface WriteResult {
  ok: boolean
  /** `ok=false` 时的可读原因（**必须**显示给用户，不许静默）。 */
  reason?: string
}

/**
 * 写「新建会话默认」的一个**子字段**（批 18 新增的写入路径）。
 *
 * ── 三条口径（都来自任务书 §3.1，逐条落在代码里）──────────────────────
 *   ① **写子字段路径**：`mutate([{op:'set', path:['spawn', field], value}])`；
 *      **不得整块写 `spawn`**（父对象不 volatile ⇒ 宿主 `isVolatilePath` 会拒）。
 *   ② `writable === false`（非回环 ⇒ 宿主的 `memory` 模式）⇒ **如实拒写**，
 *      返回原因而**不是**假装成功（宿主 `ConfigFormController.enqueue` 在
 *      `persistence==='memory'` 时直接 `Promise.resolve(false)`）。
 *   ③ 空值 ⇒ 用 **`unset`**：语义 = "用宿主默认"（与 schema 的"空串 = 用宿主默认"一致）。
 *      ⚠ **实测澄清（别把 unset 当成"删掉那一行"）**：宿主 `SettingsService.mutate`
 *        （`dsh-settings/lib/index.js:489-502`）对 `unset` 的处理是
 *        *"取继承值，若继承值不是 undefined 就改成 `set 继承值`"*。
 *        而本插件 schema 给四个 spawn 字段的 `.default('')` **就是**那个继承值
 *        ⇒ 一次 `unset` 的最终效果是 **`set ""`**（用户层留下一行空串），
 *        **不是**把键删掉。这与宿主自己的设置页行为**同源**（它们也走同一个 mutate）。
 *      ⇒ 空串与"键缺席"在本插件里**行为等价**（`spawnDefaults()` 两者都归一到空串），
 *        故这里**不需要**、也**无法**靠 unset 去追求"键消失"那种更干净的形态。
 *
 * @param form - 当前 settings form（`null` = 还没就绪）。
 * @param field - `spawn` 的子字段名。
 * @param value - 要写的值；**空串 ⇒ `unset`**（最终落到 `set ""`，行为 = 用宿主默认）。
 * @returns 写入结果（含失败原因）。
 */
export async function writeSpawnField(
  form: ConfigForm | null,
  field: 'agentPreset' | 'provider' | 'model' | 'reasoningEffort',
  value: string,
): Promise<WriteResult> {
  return writeSpawnFields(form, [{ field, value }])
}

/**
 * **一次 mutate 写多个** spawn 子字段（批 18）。
 *
 * ⚠ 为什么需要它（而不是连着调几次 {@link writeSpawnField}）：宿主 `mutate` 每次是
 *   **一次原子写入 + 一次 revision 推进**（`ConfigFormController.mutate`）。
 *   分开调会写两笔、推两次 revision 并触发两次重渲染；更关键的是**中间态可被读到**
 *   （例如"新 provider + 旧 model"那一瞬）。选一个模型本质是
 *   **(provider, model[, effort]) 三个字段一起变**，故用一个 op 数组原子下发。
 *
 * ⚠ 每个 op 仍**必须**是**子字段路径**（`['spawn', 字段]`）—— 整块写 `spawn`
 *   会被宿主 `isVolatilePath` 拒（父对象不标 volatile，见该函数注释）。
 *
 * @param form - 当前 settings form（`null` = 还没就绪）。
 * @param writes - 要写的字段与值（空串 ⇒ `unset`）。
 * @returns 写入结果（含失败原因；任一前置检查不过就**一个字段也不写**）。
 */
export async function writeSpawnFields(
  form: ConfigForm | null,
  writes: ReadonlyArray<{ field: 'agentPreset' | 'provider' | 'model' | 'reasoningEffort'; value: string }>,
): Promise<WriteResult> {
  if (form === null) return { ok: false, reason: '配置面尚未就绪（读不到本插件的 form），未写入。' }
  if (writes.length === 0) return { ok: false, reason: '没有要写入的字段（未做任何修改）。' }
  const snapshot = form.getSnapshot()
  if (snapshot.writable !== true) {
    return {
      ok: false,
      reason: `当前页面不允许写入（持久化模式 = ${snapshot.mode}；非本机回环访问时宿主只在内存里改，不落盘）⇒ 已拒写，未做任何修改。`,
    }
  }
  if (typeof form.mutate !== 'function') {
    return { ok: false, reason: '该配置面不支持写入（宿主 form 未提供 mutate）。' }
  }
  try {
    const ops: ConfigMutationOp[] = writes.map(({ field, value }) => (
      value === ''
        ? { op: 'unset', path: ['spawn', field] }
        : { op: 'set', path: ['spawn', field], value }
    ))
    const accepted = await form.mutate(ops)
    return accepted === true ? { ok: true } : { ok: false, reason: '宿主拒绝了这次写入（版本冲突或该字段不可写）。' }
  } catch (e) {
    return { ok: false, reason: `写入失败：${String((e as Error)?.message ?? e)}` }
  }
}
