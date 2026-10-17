/**
 * 「新建会话默认」的**候选来源**（Client 半边）—— 宿主预设清单 + 宿主模型目录。
 *
 * ── 数据从哪来（**不自造 RPC**）────────────────────────────────────────
 *   两条都是宿主既有 Remote 命名空间（经 `@deepseek-ai/dsh-api-remotes`
 *   的客户端半边挂载），本插件**只读**、不新增任何路由：
 *     · 预设清单 ← `<NS_AGENT_PRESETS>.list()`（宿主 `dsh-agent-preset-registry`）
 *     · 模型目录 ← `<NS_SESSION>.modelCatalog()`（宿主 `dsh-api-session-controller`）
 *   两条的返回形状都按宿主 client 的原生用法消费（对照
 *   `ctx.remote.agentPresets.list()` 在 `dsh-client-ui-agent-preset/lib/client.js`、
 *   `ctx.remote.session.modelCatalog()` 在 `dsh-client-ui-model-selection/lib/client.js`
 *   —— ⚠ 用**符号锚**，⛔ 不钉行号：宿主把 client 打成一个 bundle，行号会整体位移），**不使用**未在
 *   宿主 `dsh.client` 声明里出现的字段。
 *
 * ── ⚠ 这两个命名空间**怎么读**（第 3 轮修正，2026-10-10 · 必读）──────────
 *   旧写法是「`ctx.get('remote')` 拿服务 → 再**属性访问** `remote.agentPresets`」。
 *   那会撞 cordis 的 inject 门禁并**抛异常**：
 *     `cannot get property "remote.agentPresets" without inject`
 *   抛出点 = `@deepseek-ai/cordis/src/reflect.ts:144` 造错、
 *   `:163`（`lib/index.js:676` 造错、`:691`）抛出 —— 触发分支是
 *   `while` 走链时 `if (!fiber.runtime) throw error`
 *   （readonly 反射层逐级向上找实现，走到本 fiber 仍无声明 ⇒ 抛）。
 *   （⚠ 这四个锚点 2026-10-17 在 0.2.1-rc.2 上**逐行核过、仍准** —— `src/` 随包发布，
 *    不像打包后的 client bundle 那样整体位移；核法：`src/reflect.ts` 的
 *    `cannot get property "${prop}" without inject` / `if (!fiber.runtime) throw error`。）
 *   ⚠ **与"宿主有没有数据"无关**：第 2 轮读数（5 预设 / 3 组 6 模型）
 *   证明的是**宿主侧有数据**，不证明面板能取到 —— 两条不是一回事。
 *   ⚠ **与是否重启无关**：门禁是**声明**问题，重启不会让它变好。
 *
 *   ⇒ 现在的两条取用路径（**都不做属性访问**）：
 *     ① **反应式订阅**（主路径，见 {@link bindCatalog}）：`ctx.inject([<两个命名空间>], cb)`。
 *        缺席 ⇒ 这一块降级、**面板整体照常**（fiber 仍是 ACTIVE）；到齐 ⇒ 回调触发、
 *        自动重读一次（用户不必点重试）。这就是 E-01 / E-41 的纪律。
 *     ② **免 inject 现读**：`ctx.get('<命名空间逐字名>')` —— cordis 的 `get()` 文档
 *        原文就是 *"Read a service from the store without the inject requirement"*
 *        （`src/reflect.ts:226-233`；⚠ 2026-10-17 核过仍准），不要求先声明依赖，也不会抛。
 *   ⚠ **禁止**把这两个名字写进 `src/client/index.ts` 的**模块级** `export const inject` ——
 *     那是**加载门禁**（E-02 / E-41）：缺席会让**整个 client 插件不激活** ⇒
 *     设置分区整体消失，属回归。两种 inject 的后果差异见 `.hob/EXPERIENCE.md` E-41。
 *
 * ── 三条纪律（都是本项目实测过的形态）──────────────────────────────────
 *   ① **不许把 promise 内联进渲染回调**：本文件把加载收敛成**一次**外部存储
 *      （`useSyncExternalStore` 消费）—— 内联 promise 会被 `useEffect` 依赖捕获成
 *      自持循环（旧项目实测 8 秒 13420 次请求，见 `settings-panel.tsx` 文件头）。
 *   ② **react 被动等**：`apply` 阶段 ctx 已就绪，但 `remote` 命名空间可能稍后挂载
 *      ⇒ 首次读取失败是**正常状态**，如实记为 `error`，允许用户点重试；
 *      **不静默当成空列表**（那会让"加载失败"看起来像"宿主里一个预设都没有"）。
 *   ③ **broken 不静默过滤**：宿主自己的选择器会滤掉 `broken` 的预设
 *      （`presetOptions()` 只留 `broken === undefined`）—— 本项目**反其道而行**：
 *      如实列出并标"不可用"（E-46 的教训：静默过滤让用户以为预设不存在）。
 */
import type { ReactNode } from 'react'
import { PLANNING_PRESET_ID } from '../shared/planning-preset.ts'

/** 宿主预设清单里的一行（只取本面板用到的字段）。 */
export interface PresetRow {
  id: string
  name?: string
  description?: string
  /** 非空 = 该预设当前**不可用**（宿主给的原因）。**不隐藏**。 */
  broken?: string
  /** 宿主标记的默认预设（会话不点名时用它）。 */
  isDefault?: boolean
}

/** 模型目录里一个思考档位。 */
export interface EffortRow {
  id: string
  name: string
  description?: string
}

/** 模型目录里一个模型。 */
export interface ModelRow {
  id: string
  name: string
  description?: string
  /** 有 `efforts` 才呈现档位选择；没有就**不留空旋钮**。 */
  reasoning?: {
    efforts: EffortRow[]
    defaultEffort?: string
  }
}

/** 模型目录里一个 provider 分组。 */
export interface ProviderGroupRow {
  id: string
  name: string
  models: ModelRow[]
}

/** 模型目录的整体形状（宿主 `session.modelCatalog` 的返回子集）。 */
export interface ModelCatalogRow {
  default: { provider: string; model: string; reasoningEffort?: string }
  groups: ProviderGroupRow[]
  failures: { id: string; name: string; message: string }[]
}

/**
 * 一条**结构化的**失败原因。
 *
 * ⚠ 为什么不是一句写死的中文（第 8 轮 · 2026-10-10）：本文件在 **client 半边**
 *   但**不**依赖语言服务，而它产生的错误句**会**被面板渲染给用户
 *   ⇒ 若这里写死中文，切英文后这几行仍是中文（**语言跟随就有洞**）。
 *   ⇒ 改成"**给键 + 给参数**"，由面板经语言服务取词（见 `i18n.ts` 的 `t()`）。
 *   这与宿主 `ui-model-selection` 的做法同源：它把失败存成
 *   `state.failures[].message` 并在渲染处套 `t("warning.groupLoad", {…})`
 *   （`dsh-client-ui-model-selection/lib/client.js` —— ⚠ **符号锚**：
 *   渲染处 `t("warning.groupLoad"` 与词典键 `"warning.groupLoad"`；⛔ 不钉行号）。
 */
export interface CatalogError {
  /** 词条键（`i18n.ts` 的词典里必须有；缺了会退化成显示键名，由机检钉住）。 */
  key: string
  /** `{name}` 占位符参数。 */
  params?: Record<string, string | number>
}

/** 外部存储的快照（**稳定引用**，只在内容变化时替换）。 */
export interface CatalogSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /**
   * **可选**预设（已排除规划侧预设 —— 见 {@link excludedPresets}）。
   *
   * ⚠ 排除**不是**静默过滤（本项目 E-46 的教训：宿主的静默过滤让用户以为预设不存在）：
   *   被排除的那几条原样收在 {@link excludedPresets} 里，面板**常驻一行**说明为什么排除。
   */
  presets: PresetRow[]
  /**
   * 被排除的预设（当前 = 本插件的规划侧预设，`Hob`）——**仍然带出来**，不丢。
   *
   * 用途：① 面板常驻说明行要报出它的**显示名**；② 已存值恰好是它时，面板能**如实标"不作候选"**
   * 并说明实际效果（沿用既有"已存值不在清单里"的做法，不静默隐藏）。
   */
  excludedPresets: PresetRow[]
  catalog: ModelCatalogRow | null
  /** 读取失败的原因（**如实显示**，不吞；**结构化**，由面板取词）。 */
  error: CatalogError | null
}

let ctxRef: any
let snapshot: CatalogSnapshot = { status: 'idle', presets: [], excludedPresets: [], catalog: null, error: null }
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

/**
 * 两个 Remote 命名空间的**逐字服务名**。
 *
 * ⚠ 名字不是猜的，是**读出来的**（第 3 轮实测，2026-10-10；2026-10-17 在 0.2.1-rc.2 上复核）：
 *   `@deepseek-ai/dsh-api-gateway` 的 client bundle 里
 *     `function remoteServiceKey(namespace) { return \`remote.${namespace}\` }`
 *   而 `createNamespace()` 用 `this.ownerCtx.plugin({ name: remoteServiceKey(name), … })`
 *   把命名空间装成一个 `Service`，其 `name` 即下面这两个串。
 *   ⚠ **全部按符号锚**，⛔ 不钉行号 —— 这份 bundle 会重排（本行原先的
 *   `:2040-2042` / `:1743` 在 0.2.1-rc.2 上已对不上，实测 `remoteServiceKey` 在 `:2074`、
 *   `name: remoteServiceKey(name)` 在 `:1777`；⚠ 那些数**只用来说明"漂了"**，⛔ 不要再当锚）。
 *   命名空间名本身来自 `@deepseek-ai/dsh-api-remotes/lib/client.js` 的
 *   `TYPERT_REMOTE` 表：预设 = 描述符 `"agentPresets/list"` 的 `service: "agentPresets"`；
 *   模型 = 描述符 `"session/modelCatalog"` 的 `service: "sessionController"`。
 *   （⚠ 原先写的是 `:4631` / `:11475` 与 `TYPERT_REMOTE$23` —— 前者已漂，后者是**打包序号**、
 *    换一版就会变号，⛔ 不该当锚。）
 *
 * ⚠ 与宿主自己的 UI 用法**一致**（可对照）：
 *   `dsh-client-ui-agent-preset/lib/client.js` 的模块级 inject 含 `"remote.agentPresets"`；
 *   `dsh-client-ui-model-selection/lib/client.js` 的模块级 inject 含 `"remote.session"`。
 *   （⚠ 同样按符号锚：原 `:1532` / `:357` 已对不上，实测在 `:2257` / `:991`。）
 *   宿主是在**模块级 inject** 里声明的 —— 本插件**不那样做**（理由见文件头）。
 */
const NS_AGENT_PRESETS = 'remote.agentPresets'
const NS_SESSION = 'remote.session'

/** 登记 client 的 cordis context（`apply` 里调一次）。 */
export function setCatalogContext(ctx: any): void {
  ctxRef = ctx
  // 到齐即重读（用户不必点「重新读取」）：仅当上一次是失败态才自动重跑，
  // 避免把已经读好的清单无谓地再拉一遍。
  if (snapshot.status === 'error' || snapshot.status === 'idle') void loadCatalog()
}

/** `useSyncExternalStore` 的 getSnapshot —— 返回**稳定引用**。 */
export function getCatalogSnapshot(): CatalogSnapshot {
  return snapshot
}

/**
 * **反应式订阅**两个 Remote 命名空间（改法①；`apply` 里挂 `ctx.effect`）。
 *
 * ── 为什么选①（判据，不是偏好）──────────────────────────────────────────
 *   面板的这两个下拉是**可选能力**：宿主没装 `dsh-api-remotes` 时，
 *   本插件的设置分区**其余部分照常**（配置摘要、模块开关、说明），
 *   只是「新建会话默认」这一块降级为"候选读取失败 + 可重试"。
 *   这正是 `ctx.inject` 的语义 —— 与 `.hob/EXPERIENCE.md` **E-01 / E-41** 一致：
 *     模块级 `export const inject` = **加载门禁**（缺席 ⇒ 整块不激活）
 *     `ctx.inject(...)`          = **反应式订阅**（缺席 ⇒ 只回调不跑，模块仍 ACTIVE）
 *   实测（本轮 · cordis 4.0.4 · 命名空间**缺席**）：
 *     `fiber.state = 2 (ACTIVE)`，apply 照常跑、回调未触发；
 *     之后**补挂**命名空间 ⇒ 回调**自动触发**（面板不必重载页面就能重读）。
 *   ⚠ 若改用②（只在面板首渲染时 `ctx.get` 一次）则**丢掉"到齐自动重读"**：
 *     用户得自己点「重新读取」（首次渲染早于命名空间就绪时尤其明显）。
 *     ⇒ 故**订阅用①**；而**具体读数用 `serviceOf()`（免 inject `ctx.get`）**——
 *     两者不冲突：① 决定**何时**读，`ctx.get` 决定**怎么**读。
 *     这样客户端代码里**一个属性访问都没有**，机检判据因此可以很硬
 *     （见 `scripts/check-client-deps.mjs`）。
 *
 * ⚠ **不写模块级 `export const inject`**：那会让缺席时整个 client 插件不激活
 *   ⇒ 设置分区整体消失（回归）。见本文件头与 E-41。
 *
 * @param ctx - client 半的 cordis context。
 * @returns 解除订阅的函数（挂 `ctx.effect` 用；形状与 `settings.ts` 同款）。
 */
export function bindCatalog(ctx: any): () => void {
  if (typeof ctx?.inject !== 'function') return () => {}

  const off = ctx.inject([NS_AGENT_PRESETS, NS_SESSION], () => {
    // 到齐才走到这里 ⇒ 若之前是"未就绪/未加载"，自动补读一次。
    // ⚠ 只在**没读成**时补：已 `ready` 就不必再拉一遍（省一次 RPC）。
    if (snapshot.status === 'error' || snapshot.status === 'idle') void loadCatalog()
  })

  // ⚠ `ctx.inject()` 返回的是 **Fiber**（不是函数）——
  //   实测 cordis 4.0.4：`typeof off === 'object'`、`off.constructor.name === 'Fiber'`、
  //   `off.dispose` 是函数。故这里用 `dispose()` 而**不是** `off()`。
  //   （`Symbol.dispose` 也可用，但本仓 tsconfig 的 lib 不含 esnext.disposable ⇒ 只取 `.dispose`。）
  return () => {
    if (typeof off?.dispose === 'function') void off.dispose()
  }
}

/** `useSyncExternalStore` 的 subscribe。 */
export function subscribeCatalog(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function update(next: Partial<CatalogSnapshot>): void {
  snapshot = { ...snapshot, ...next }
  for (const fn of listeners) fn()
}

/**
 * 免 inject 现读一个服务（`ctx.get` 不要求先声明依赖 ⇒ **不抛**）。
 *
 * ⚠ **不要**改成 `ctx.<名字>` 或 `ctx.get('remote')` 之后再 `.agentPresets` ——
 *   那两种都是**属性访问**，会撞 inject 门禁抛
 *   `cannot get property "..." without inject`（本文件的原始缺陷，见文件头）。
 *   判据：`ctx.get('...')` 走的是 `reflect.get()`，文档写明
 *   *"without the inject requirement"*；属性访问走的是 reflect 的 **get 陷阱**
 *   （`src/reflect.ts:136-168`，⚠ 2026-10-17 核过仍准），未声明即抛。
 *
 * @param name - **逐字**服务名（如 `'remote.agentPresets'`）。
 * @returns 服务实例，或 `undefined`（未挂载/未就绪 —— 由调用方如实报错）。
 */
function serviceOf(name: string): any {
  if (ctxRef === undefined) return undefined
  try {
    return typeof ctxRef.get === 'function' ? ctxRef.get(name) : undefined
  } catch {
    return undefined
  }
}

/** 把一次 Remote 调用结果归一成"值或错误"（**不静默吞错**，错误结构化）。 */
function unwrap(response: any): { ok: true; value: any } | { ok: false; error: CatalogError } {
  if (response === undefined || response === null) {
    return { ok: false, error: { key: 'catalog.fail.noResult' } }
  }
  if (response.ok === true) return { ok: true, value: response.value }
  const code = String(response.error?.code ?? 'unknown')
  // ⚠ 宿主给的原句**不翻译**（那是宿主的文本，逐字透传才是"如实"）；
  //   这里翻译的只是**我们自己的**包裹句。
  const message = String(response.error?.message ?? String(response))
  return { ok: false, error: { key: 'catalog.fail.host', params: { code, message } } }
}

/**
 * 加载（或重试）候选。
 *
 * ⚠ **并发去重**：`inflight` 是"已有一次在飞"的闸门 —— 面板渲染 + 用户点重试
 *   同时触发时**只发一次**（与宿主 `ModelCatalogDirectory.load()` 同一手法）。
 * ⚠ **失败也必须落定**：任一读取失败 ⇒ `status='error'` + `error` 文本，
 *   **不会被当成空清单**（见文件头纪律 ②）。
 * ⚠ **复位不能写在 async IIFE 的 `finally` 里**（本轮实测踩到，见下）——
 *   必须挂在 promise **之后**。否则"同步路径"会把复位吃掉、重试永久失效。
 */
export function loadCatalog(): Promise<void> {
  if (inflight !== null) return inflight
  update({ status: 'loading', error: null })

  /**
   * ⚠⚠ **为什么把复位写成 `run.then(...)` 而不是体里的 `finally`**（实测判据）：
   *   `async` 箭头函数体会**同步**执行到**第一个 `await`**。本函数的"命名空间缺席"
   *   分支（`serviceOf()` 是同步的）**在任何 await 之前**就 `return` 了，于是：
   *     ① 体内 `finally { inflight = null }` 先跑 ⇒ `inflight = null`；
   *     ② 随后 `inflight = (async () => …)()` 的赋值才执行 ⇒ 又把 `null`
   *        **覆盖成那个已完成的 promise**；
   *     ③ ⇒ `inflight` **永久非 null**，此后每次 `loadCatalog()` 都直接返回那个
   *        作废的 promise：用户点「重新读取」**毫无反应**，命名空间到齐后的
   *        自动补读也一起失效（而 `status` 还停在 error，看起来像"重试没生效"）。
   *   实测复现（Node · cordis 4.0.4）：同步 early return 后 `inflight === null`
   *   读数 = **false**，即复位被覆盖。
   *   ⇒ 复位必须发生在**赋值之后**，用 promise 链而非函数体。
   *   （`run.then(onFulfilled, onRejected)` 两个分支都复位，且不产生
   *     未处理的 rejection —— 体内 try/catch 已兜住异常。）
   */
  const run = (async () => {
    try {
      // 两个命名空间**分别免 inject 现读**（不做属性访问，见文件头）。
      // 缺席 ⇒ 如实报"未挂载"，**不静默当空清单**（纪律 ②）。
      const presetsNs = serviceOf(NS_AGENT_PRESETS)
      const catalogNs = serviceOf(NS_SESSION)
      if (presetsNs === undefined || catalogNs === undefined) {
        const missing = [
          presetsNs === undefined ? NS_AGENT_PRESETS : null,
          catalogNs === undefined ? NS_SESSION : null,
        ].filter((x) => x !== null).join(' / ')
        update({
          status: 'error',
          error: { key: 'catalog.fail.nsNotReady', params: { missing } },
        })
        return
      }
      const presetResult = unwrap(await presetsNs.list())
      if (!presetResult.ok) {
        update({ status: 'error', error: { key: 'catalog.fail.preset', params: { message: presetResult.error.params?.message ?? '' } } })
        return
      }
      const catalogResult = unwrap(await catalogNs.modelCatalog())
      if (!catalogResult.ok) {
        update({ status: 'error', error: { key: 'catalog.fail.model', params: { message: catalogResult.error.params?.message ?? '' } } })
        return
      }
      const rows: PresetRow[] = Array.isArray(presetResult.value?.presets) ? presetResult.value.presets : []
      // ⚠ **刻意不过滤 `broken`**（见文件头纪律 ③）：原样带出去，由面板标"不可用"。
      const mapped: PresetRow[] = rows.map((r: any) => ({
        id: String(r?.id ?? ''),
        ...(typeof r?.name === 'string' ? { name: r.name } : {}),
        ...(typeof r?.description === 'string' ? { description: r.description } : {}),
        ...(typeof r?.broken === 'string' ? { broken: r.broken } : {}),
        ...(r?.isDefault === true ? { isDefault: true } : {}),
      })).filter((r) => r.id !== '')
      // ── 「新建会话默认」**不作候选**的预设（用户裁定 · 第 9 轮）────────────
      //   ⚠⚠ **这不是静默过滤**（那正是 E-46 的教训：宿主的静默过滤让用户以为预设不存在）：
      //     排除掉的几条**原样留在 `excludedPresets`** 里，面板据此**常驻一行**说明原因，
      //     并且「候选来源」的计数会讲清"可选 N 个（已排除规划侧预设）"。
      //   ⚠ 判据只用**逐字 id**（不看 name / broken），且 id 取自全仓唯一的
      //     `src/shared/planning-preset.ts` —— 与预设声明逐字交叉核对由 `check:presets` 钉住。
      const excluded: PresetRow[] = mapped.filter((p) => p.id === PLANNING_PRESET_ID)
      const selectable: PresetRow[] = mapped.filter((p) => p.id !== PLANNING_PRESET_ID)
      update({
        status: 'ready',
        error: null,
        presets: selectable,
        excludedPresets: excluded,
        catalog: normalizeCatalog(catalogResult.value),
      })
    } catch (e) {
      // 抛异常与"返回失败"同级处理：都如实记成 error（结构化，由面板取词）。
      update({ status: 'error', error: { key: 'catalog.fail.exception', params: { message: String((e as Error)?.message ?? e) } } })
    }
  })()

  inflight = run
  // 复位只在"还是我这一笔"时生效：若期间已被新的 load 取代，不要抹掉别人。
  const clear = (): void => { if (inflight === run) inflight = null }
  void run.then(clear, clear)
  return run
}

/** 宿主目录 → 本面板的最小形状（**逐字段**取，避免依赖未声明字段）。 */
function normalizeCatalog(value: any): ModelCatalogRow {
  const groups: ProviderGroupRow[] = Array.isArray(value?.groups)
    ? value.groups.map((g: any) => ({
        id: String(g?.id ?? ''),
        name: String(g?.name ?? g?.id ?? ''),
        models: Array.isArray(g?.models)
          ? g.models.map((m: any) => ({
              id: String(m?.id ?? ''),
              name: String(m?.name ?? m?.id ?? ''),
              ...(typeof m?.description === 'string' ? { description: m.description } : {}),
              ...(m?.reasoning !== undefined && m.reasoning !== null
                ? {
                    reasoning: {
                      efforts: Array.isArray(m.reasoning.efforts)
                        ? m.reasoning.efforts.map((e: any) => ({
                            id: String(e?.id ?? ''),
                            name: String(e?.name ?? e?.id ?? ''),
                            ...(typeof e?.description === 'string' ? { description: e.description } : {}),
                          })).filter((e: EffortRow) => e.id !== '')
                        : [],
                      ...(typeof m.reasoning.defaultEffort === 'string'
                        ? { defaultEffort: m.reasoning.defaultEffort }
                        : {}),
                    },
                  }
                : {}),
            })).filter((m: ModelRow) => m.id !== '')
          : [],
      })).filter((g: ProviderGroupRow) => g.id !== '' && g.models.length > 0)
    : []
  return {
    default: {
      provider: String(value?.default?.provider ?? ''),
      model: String(value?.default?.model ?? ''),
      ...(typeof value?.default?.reasoningEffort === 'string'
        ? { reasoningEffort: value.default.reasoningEffort }
        : {}),
    },
    groups,
    failures: Array.isArray(value?.failures)
      ? value.failures.map((f: any) => ({
          id: String(f?.id ?? ''),
          name: String(f?.name ?? f?.id ?? ''),
          message: String(f?.message ?? ''),
        }))
      : [],
  }
}

/** 在目录里找一个模型（找不到返回 `undefined` ⇒ 面板标"不可用"）。 */
export function findModel(catalog: ModelCatalogRow | null, provider: string, model: string): ModelRow | undefined {
  if (catalog === null) return undefined
  for (const g of catalog.groups) {
    if (g.id !== provider) continue
    for (const m of g.models) if (m.id === model) return m
  }
  return undefined
}

/** 预先在预设清单里找一个预设。 */
export function findPreset(presets: PresetRow[], id: string): PresetRow | undefined {
  return presets.find((p) => p.id === id)
}

/** 供面板渲染的"空"占位类型（只用于类型收窄）。 */
export type CatalogNode = ReactNode
