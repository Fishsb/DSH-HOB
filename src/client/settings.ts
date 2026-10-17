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
/** 当前 form 自身订阅的 disposer（宿主 `subscribe()` 的返回值）；`null` = 无订阅。 */
let formUnsubscribe: (() => void) | null = null
const listeners = new Set<() => void>()

/** 通知本模块的订阅者（form 换了 / 宿主快照变了）。 */
function emit(): void {
  for (const fn of [...listeners]) fn()
}

/** 释放当前 form **自身**的订阅（幂等：没有订阅时什么都不做）。 */
function releaseForm(): void {
  // ⚠ 这个 disposer **不能**命名成 `off` / `disposer` / `subscription` / `sub`：
  //   本仓机检（`scripts/check-client-deps.mjs` 的 E 组）把那几个名字**约定为**
  //   "`ctx.inject(...)` 的返回值（Fiber 对象）"的专用名，用来抓
  //   `off()` 这种"把 Fiber 当函数调"的写法。重名会让 E 断言**误报**
  //   （实测：命名为 `off` 时 `npm run check:client` 直接 FAIL）。
  const unsubscribe = formUnsubscribe
  formUnsubscribe = null
  if (unsubscribe === null) return
  try {
    unsubscribe()
  } catch {
    // 释放失败不该让整个面板挂掉（**但绝不静默吞掉"订阅没接上"** —— 那由下面的正向路径保证）。
  }
}

/**
 * 登记就绪的 form，**并接上 form 自身的订阅**（本轮修的就是这半根线）。
 *
 * ⚠ **为什么必须订阅 form 自身**：`form.getSnapshot()` 是宿主 mirror store 的
 *   **稳定快照**（`dsh-client-ui-settings/lib/client.js:1136-1138` = `store.getSnapshot()`），
 *   而 host 写入成功后经 `mutate()` → `mirror.acceptView()`（`:1190`）→
 *   `mirror` 的 store 更新（`:1435-1447`）→ 构造函数里注册的
 *   `mirror.subscribe(() => this.derive())`（`:1127-1131`）→ `derive()` 里
 *   `this.store.update(...)`（`:1221-1243`）—— 而 `subscribe` 就是
 *   `this.store.subscribe(listener)`（`:1142-1144`）。
 *   ⇒ **宿主会通知**；不接这根线的话，本模块只在"form 就绪那一次"通知过
 *   （`bindSettingsForm` 的 inject 回调），此后写入成功也**没有任何重渲染**，
 *   界面永远停在旧值 —— 这正是用户报的"写入成功但下框不回显"。
 *
 * ⚠ 幂等：**同一个 form 重复设置不叠加订阅**（提前返回），但**仍通知一次**
 *   （首次就绪 / 重复登记时 React 需要一次重渲染）。
 *
 * ⚠ 不许泄漏：换成另一个 form（或 `null`）时**先**用 disposer 释放旧订阅。
 */
export function setSettingsForm(form: ConfigForm | null): void {
  if (form === currentForm) {
    emit()
    return
  }
  releaseForm()
  currentForm = form
  if (form !== null && typeof form.subscribe === 'function') {
    formUnsubscribe = form.subscribe(() => { emit() })
  }
  emit()
}

/** 当前的 form（**写入路径**用：`writeSpawnFields` 要调它的 `mutate`）。 */
export function getSettingsForm(): ConfigForm | null {
  return currentForm
}

/**
 * `useSyncExternalStore` 的 **getSnapshot（值）** —— 渲染用的值来源。
 *
 * ⚠⚠ **硬约束**：引用**在值未变化时必须恒定**，否则 `useSyncExternalStore`
 *   会判定"每次渲染都变了"⇒ 无限重渲染。
 *   宿主 `ConfigForm.getSnapshot()` 的契约恰好是
 *   *"stable reference until the next change"*（`config-form.d.ts:52-53`）
 *   ⇒ **直接透传**，**不要**自己每次新建对象（也不要 `{ ...snapshot }`）。
 *   无 form 时返回 `null`（字面量，同样是稳定引用）。
 */
export function getSettingsSnapshot(): SettingsSnapshot | null {
  return currentForm?.getSnapshot() ?? null
}

/** `useSyncExternalStore` 的 subscribe（本模块自身的订阅集合）。 */
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
    // ⚠ `ctx.inject(...)` 返回的是 **Fiber**，**不是函数** —— 写成 `off?.()` 会抛
    //   `TypeError: off is not a function`（实测 cordis 4.0.4：`typeof off === 'object'`、
    //   `off.constructor.name === 'Fiber'`、`off.dispose` 是函数）。
    //   该清理函数挂在 `ctx.effect` 上 ⇒ 卸载 / **热重载**时必被调用 ⇒
    //   写错会让"本插件的清理路径"每次都抛，却因为发生在卸载期而不易被发现。
    //   （`Symbol.dispose` 也可用，但本仓 tsconfig 的 lib 不含 esnext.disposable ⇒ 只取 `.dispose`。）
    if (typeof off?.dispose === 'function') void off.dispose()
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

/** 可读权限控制的三档值（与 `src/config.ts` 的 `PERMISSION_LEVELS` 同源口径；⚠ 内部取值，⛔ 不是显示名）。 */
export type PermissionLevel = 'ledger' | 'project' | 'workspace'

/** 档位的展示顺序（= 包含链从窄到宽；面板按这个顺序渲染）。 */
export const PERMISSION_LEVEL_ORDER: readonly PermissionLevel[] = ['ledger', 'project', 'workspace']

/**
 * 写**可读权限控制**的档位（`permission.level`；⚠ 内部取值一字未变）。
 *
 * ⚠ 与 {@link writeSpawnField} 同形的三条纪律（照抄，别各写一份）：
 *   ① **必须写子字段路径** `['permission', 'level']` —— 父对象 `permission`
 *      自己不 volatile，宿主 `isVolatilePath` 会拒整块写；
 *   ② `snapshot.writable !== true` ⇒ **拒写并说清为什么**（非本机回环访问时，
 *      宿主只在内存里改、不落盘）—— 静默"看起来改了"是这里最坏的失败形态；
 *   ③ 走宿主 `form.mutate`（Remote RPC），**不自己实现写入**（E-10）。
 *
 * ⚠ 为什么档位**没有** `unset` 分支（与 spawn 四个字段不同）：
 *   档位有 `.default('ledger')`，而"缺省"本身就是 `ledger` 这一档
 *   ⇒ 清空没有独立语义，一律写成显式三值之一。
 *
 * @param form - 当前 settings form（`null` = 还没就绪）。
 * @param level - 要写入的档位。
 * @returns 写入结果（含失败原因；前置检查不过就**一个字也不写**）。
 */
export async function writePermissionLevel(
  form: ConfigForm | null,
  level: PermissionLevel,
): Promise<WriteResult> {
  if (form === null) return { ok: false, reason: '配置面尚未就绪（读不到本插件的 form），未写入。' }
  if (!PERMISSION_LEVEL_ORDER.includes(level)) {
    return { ok: false, reason: `档位 ${String(level)} 不是三档之一（ledger / project / workspace），未写入。` }
  }
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
    const ops: ConfigMutationOp[] = [{ op: 'set', path: ['permission', 'level'], value: level }]
    const accepted = await form.mutate(ops)
    return accepted === true ? { ok: true } : { ok: false, reason: '宿主拒绝了这次写入（版本冲突或该字段不可写）。' }
  } catch (e) {
    return { ok: false, reason: `写入失败：${String((e as Error)?.message ?? e)}` }
  }
}

/**
 * 从 settings snapshot 里读出**当前档位**（面板用来显示选中态）。
 *
 * ⚠ 兜底 = `ledger`（**最保守**档）：读不出来时不能让面板显示成更宽的档 ——
 *   那会让用户以为"已经放开了"，而实际生效的是保守档。
 *
 * @param snapshot - 宿主 form 的快照（`null` = 未就绪）。
 */
export function readPermissionLevel(snapshot: SettingsSnapshot | null): PermissionLevel {
  const raw = (snapshot as { value?: unknown } | null)?.value
  const perm = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>).permission : undefined
  const lvl = perm !== null && typeof perm === 'object' ? (perm as Record<string, unknown>).level : undefined
  return typeof lvl === 'string' && (PERMISSION_LEVEL_ORDER as readonly string[]).includes(lvl)
    ? (lvl as PermissionLevel)
    : 'ledger'
}

/**
 * 读出「首次铺骨架」开关（2026-10-16 第 224 轮 · `UD-118`「C」）。
 *
 * ⚠ 与 {@link readPermissionLevel} 同一条纪律：**从快照读、⛔ 不在渲染期直调 form**
 *   （否则宿主写入成功后这一处不会跟着重渲染）。
 * ⚠ 兜底 = `true`（与 schema 的 `.default(true)` 一致）：⚠ 它的失效方向是"多铺一次"，
 *   而铺骨架**永不覆盖已存在的 `.hob/`** ⇒ 多铺的后果是**空操作**。
 *
 * @param snapshot - `configForms.get()` 的快照（或 `null`）。
 */
export function readSkeletonEnabled(snapshot: SettingsSnapshot | null): boolean {
  const raw = (snapshot as { value?: unknown } | null)?.value
  const sk = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>).skeleton : undefined
  const v = sk !== null && typeof sk === 'object' ? (sk as Record<string, unknown>).enabled : undefined
  return typeof v === 'boolean' ? v : true
}

/**
 * 写「首次铺骨架」开关（2026-10-16 第 224 轮 · `UD-118`「C」）。
 *
 * ⚠ **必须写子字段路径** `['skeleton','enabled']` —— ⛔ 不得整块写 `['skeleton']`：
 *   父对象 `skeleton` 自己不 volatile ⇒ 宿主 `isVolatilePath` 会拒
 *   （`Config field "skeleton" is not volatile`）。
 * ⚠ 与 {@link writePermissionLevel} 同形：**先判可写性**，⛔ 不许假装保存成功。
 *
 * @param form - 就绪的 settings form（`null` = 配置面尚未就绪）。
 * @param enabled - 目标开关值。
 */
export async function writeSkeletonEnabled(form: ConfigForm | null, enabled: boolean): Promise<WriteResult> {
  if (form === null) return { ok: false, reason: '配置面尚未就绪（读不到本插件的 form），未写入。' }
  const snapshot = form.getSnapshot()
  if (snapshot.writable !== true) {
    return {
      ok: false,
      reason: `当前页面不允许写入（持久化模式 = ${snapshot.mode}；非本机回环访问时宿主只在内存里改），未写入。`,
    }
  }
  if (typeof form.mutate !== 'function') {
    return { ok: false, reason: '该配置面不支持写入（宿主 form 未提供 mutate）。' }
  }
  try {
    const ops: ConfigMutationOp[] = [{ op: 'set', path: ['skeleton', 'enabled'], value: enabled }]
    const accepted = await form.mutate(ops)
    return accepted === true ? { ok: true } : { ok: false, reason: '宿主拒绝了这次写入（版本冲突或该字段不可写）。' }
  } catch (e) {
    return { ok: false, reason: `写入失败：${String((e as Error)?.message ?? e)}` }
  }
}
