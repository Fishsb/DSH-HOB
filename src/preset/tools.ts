/**
 * 助手预设的工具**挂载点** —— preset 行直接引用本模块。
 *
 * ── 本文件与 `src/modules/tools.ts` 的分工（**一份实现、一处挂载**）──────
 *   · `src/modules/tools.ts`  = 两个工具的**定义**（唯一一份）+ 门禁服务 `hobTools`
 *   · **本文件**              = 在**预设作用域**里注册它们 + 屏蔽越界工具
 *
 * ⚠ 为什么不直接在插件作用域（`modules/tools.ts`）里注册 —— **这是量出来的，不是偏好**：
 *   实测（2026-10-05，隔离实例，逐预设 dump 工具面）：插件作用域注册一个工具，
 *   它会**漏进每一个预设**：
 *
 *   | 预设 | 注册前 | 注册后 |
 *   |---|---|---|
 *   | `minimal` | 5 | **6** |
 *   | `standard` | 30 | **31** |
 *   | `dsh-hob`（助手） | 2 | **3** |
 *   | `dsh-hob-work`（开发） | 33 | **34** |
 *
 *   证据：`.hob/archive/2026-10-05-step4-evidence/spike-leak-measurement.log`
 *   （同一次 dump 里 `GLOBAL(5)` 含 `spike_plugin_scope_tool`，四行数字全部 +1）。
 *   ⇒ 在插件作用域注册会**污染宿主自带的 standard/minimal/cordis**，
 *   直接违反 `PROJECT.md` §5.2「**只有规划预设挂本插件的工具**」。
 *   在**预设作用域**注册则不会漏（实测：助手恰好 2 个，`minimal` 不变）。
 *
 * ⚠ 为什么门禁用**反应式** `ctx.inject` 而不是本模块的静态 `inject`：
 *   静态 `inject` 缺依赖 ⇒ 该 fiber 停在 PENDING ⇒ 预设被标 **`broken`** ⇒
 *   **在选择器里被静默过滤掉**（`presetOptions()` 只留 `broken === undefined`）。
 *   实测反例：`spike2 [BROKEN: probe (hob-spike/modules/tools): waiting for hobToolsGate]`
 *   （`.hob/archive/2026-10-05-step4-evidence/spike-gate-broken.log`）。
 *   反应式 `ctx.inject` 在依赖缺席时**只是不跑回调**，预设照常可用、宿主零告警
 *   （实测：`spike-reactive-gate.log`）。
 *
 * ⚠ 本模块**不注册** DSH 原生 read/bash/write —— 与 `PROJECT.md` §5.2 同款纪律。
 */
import { appendFileSync, statSync } from 'node:fs'
import {
  GATE_SERVICE,
  DEFAULT_DENY,
  DEFAULTS,
  createHobTools,
  type HobToolsConfig,
} from '../modules/tools.ts'

/** 模块名（preset 行的 `name` 指向本模块）。 */
export const name = 'dsh-hob-tools'

/**
 * 只声明 **tools**。
 *
 * ⚠ 门禁 `hobTools` **刻意不写在这里** —— 写在这里就是静态依赖，缺失会把预设标
 *   `broken`（在选择器里静默消失）。它走 `apply` 里的 `ctx.inject`（反应式、可选）。
 */
export const inject = ['tools']

/** preset 行传入的配置。 */
export type Config = HobToolsConfig

/**
 * 诊断输出 —— **默认关闭**，由配置开关 `debugLog` 显式打开。
 *
 * ⚠ 为什么默认关：旧实现**无条件** `appendFileSync('/tmp/dsh-hob-preset-tools.log', …)`，
 *   实测真机 3 分钟写 508 KB、累计 2.3 MB（`.hob/FACTS.md` F-J25）。
 *   问题不在"写了多少"，而在**一个只读用途的诊断拥有写盘副作用**：
 *   用户没要求、日志路径硬编码、且随运行时间无限增长。
 *
 * ⚠ `debugLog` 是**真实消费者**（不是空旋钮）：为 false 时本函数**一次 fs 调用都不发**。
 *
 * ⚠ 上限判据是**文件现有字节数**（`statSync`），**不是内存计数器** ——
 *   宿主 fiber 会重载/重挂，内存计数随 reload 归零，上限形同虚设（旧项目实测踩坑）。
 */
function makeDiag(config: Config): (msg: string) => void {
  if (config.debugLog !== true) return (): void => { /* 开关关闭：不做任何 IO */ }

  const path = config.debugLogPath ?? '/tmp/dsh-hob-preset-tools.log'
  const maxBytes = config.debugLogMaxBytes ?? DEFAULTS.debugLogMaxBytes

  return (msg: string): void => {
    try {
      // ⚠ 先按**磁盘现值**判（不是内存计数器）：跨 fiber reload 依然有效，
      //   外部轮转/删除日志后也能自愈。
      let size = 0
      try { size = statSync(path).size } catch { /* 文件还不存在 ⇒ size=0 */ }
      // ⚠ 判据必须把**本行自身字节数**算进去：只判 `size >= max` 会让单行把文件顶过上限
      //   （实测：上限 600 B 时写成 796 B —— 末行 200 B 被整行追加）。
      //   真正的硬上限是"写入后 ≤ maxBytes"，超了就整行丢弃。
      const line = new Date().toISOString() + ' ' + msg + '\n'
      const bytes = Buffer.byteLength(line)
      if (size + bytes > maxBytes) return
      appendFileSync(path, line)
    } catch { /* 诊断写不进去不该影响功能 */ }
  }
}

/**
 * 挂载：**先立权限边界**（屏蔽越界工具），再等门禁就绪后注册工具。
 *
 * 为什么屏蔽要放在门禁**外面**：它是这个预设的**权限边界**，不是"本插件工具模块"的
 * 附属物 —— 即使 `modules.tools` 关掉（门禁不在、不注册工具），
 * 助手会话也不该突然多出 4 个 `interconnect_*` 工具。
 *
 * @param ctx - preset 作用域的上下文。
 * @param config - preset 行给的配置。
 */
export function apply(ctx: any, config: Config = {}): void {
  // ⚠ 诊断器**每挂载构造一次**（不是模块级单例）：上限要按"这次挂载"读磁盘现值，
  //   模块级可变状态在 fiber reload 后既不可靠、也让本模块带上跨实例状态。
  const diag = makeDiag(config)
  const log = (m: string): void => {
    try { ctx.logger?.debug?.(m) } catch { /* 无 logger 时忽略 */ }
    diag(m)
  }
  denyInheritedTools(ctx, config, log)
  log('apply 完成权限边界；等待门禁 ' + GATE_SERVICE)

  /**
   * 反应式依赖：门禁（= `modules.tools` 模块）就绪时才注册工具。
   * 门禁不在 ⇒ 回调**不执行** ⇒ 助手退化为"无自定义工具"，但**预设不 broken**。
   */
  ctx.inject([GATE_SERVICE], (gatedCtx: any) => {
    log('门禁就绪 ⇒ 注册工具')
    // ⚠ 用**回调给的子 ctx**注册（不是外层 ctx）：这是宿主的既有用法
    //   （`dsh-agent-preset-registry/lib/index.js:485` 的 `ctx.inject(["settings"], (child) => child.effect(...))`）。
    //   子 ctx 继承依赖 API 且**拥有它自己创建的注册** ⇒ 门禁消失时这些注册随之拆除，
    //   不用手写卸载逻辑（§3.3 第 3 条：资源靠 ctx.effect 挂，卸载自动清理）。
    registerTools(gatedCtx, config, log)
    // ⚠ 装配期白名单也放在**门禁内**：`modules.tools` 关掉 ⇒ 不注册工具，
    //   此时再限制清单只会让助手"什么都干不了"，与门禁语义不符。
    filterModelToolList(gatedCtx, log)
  })
}

/**
 * 屏蔽**继承来的**越界工具（{@link DEFAULT_DENY} + 配置追加）。
 *
 * ⚠ 为什么需要：`dsh-interconnect` 的四个工具是它自己的 bundle patch 作为
 *   **宿主平面行**声明的，会被**每个 agent 继承** —— 只靠"预设不挂它"**摘不掉**
 *   （实测：不摘时助手会多出 4 个）。收敛要靠**允许清单**思维（§6.3）。
 */
function denyInheritedTools(ctx: any, config: Config, log: (m: string) => void): void {
  const deny = [...DEFAULT_DENY, ...(config.denyTools ?? [])]
  log('deny=' + JSON.stringify(deny))

  /** 已摘掉的名字（含"这套部署里没有"的 —— 不重复试，避免每次都抛一遍）。 */
  const settled = new Set<string>()

  /**
   * 尝试摘一遍（幂等；已 settled 的跳过）。
   *
   * ⚠⚠ **必须"先记 settled 再调 restrict"**（实测的重入坑）：
   *   `ctx.tools.restrict()` 成功时**会同步 emit `tools/change`**。
   *   先调后记 ⇒ 那次同步 emit 会在 `settled.add()` 之前**重入**本函数 ⇒
   *   递归到爆栈（症状：`Maximum call stack size exceeded` + 上万行重复日志）。
   *   ⇒ **先记后调**，失败再撤回（失败时 restrict 没生效、没有 emit，撤回是安全的）。
   */
  const attemptDeny = (): void => {
    for (const toolName of deny) {
      if (settled.has(toolName)) continue
      settled.add(toolName)
      try {
        ctx.tools.restrict({ deny: [toolName] })
        log('restrict 成功 ' + toolName)
      } catch (e) {
        // 撤回 settled：该名字此刻还不在 restrictableNames 里，可能只是**还没注册**
        // （宿主平面行与 preset 行并行激活，顺序不保证）⇒ 等下次 tools/change 再试。
        settled.delete(toolName)
        log('restrict 未就绪 ' + toolName + '：' + String((e as Error)?.message ?? e))
      }
    }
  }

  // 先试一次（多数情况下 preset 行晚于宿主行激活，这一下就成功）。
  attemptDeny()
  // 再订阅工具面变化：宿主平面工具出现后补摘（**关键兜底**）。
  // ⚠ 监听器内 try/catch：观测路径失败绝不污染宿主的工具事件派发。
  ctx.effect(() => {
    const onToolsChange = (): void => {
      try { attemptDeny() } catch { /* 已在内层接住 */ }
    }
    // `tools/change` 是**无参**事件（见 dsh-tools 的类型声明）。
    return ctx.on('tools/change', onToolsChange)
  }, 'dsh-hob preset: deny retry on tools/change')
}

/**
 * 「助手」**发给模型的**工具清单 —— **装配期白名单**（11 个显式名字）。
 *
 * ── 为什么是这 11 个 ────────────────────────────────────────────────
 * 「助手」只干两件事：**读项目文档、写自己的账本**，以及**查资料**、**安排自己的定时提醒**。
 * 于是清单 = 本插件的 2 个 + 检索 5 个 + 定时 4 个，一个不多。
 *
 * ── 为什么**排除** roundtable / taskboard / team_task / 团队编排 ──────
 * 这些是"**驱动他人干活、改动工作状态**"的工具（派活、认领、移卡、拉专家、发消息给别的会话）。
 * 「助手」的职责是**只出指令**、由用户手工把指令带给「开发」——
 * 一旦它自己就能指挥别的会话/改任务状态，这条职责边界当场失效
 * （`preset-dsh-hob.patch.yml` 的 "You cannot message it, and it is not in this session."）。
 *
 * ⚠ **不用通配 / 前缀**：将来新装的插件**不得自动**进入「助手」的清单。
 *   这正是 `restrict({ deny })` 黑名单的反面教训 —— 黑名单每装一个新插件都会漏。
 * ⚠ 本清单是**装配期过滤**（看不见），不是 `restrict` 的硬摘除（拿不到）；
 *   两者的差别与残余风险见 `filterModelToolList` 的注释。
 */
export const MODEL_TOOL_ALLOWLIST: readonly string[] = [
  'read_contracts',
  'write_hob',
  'advanced_search',
  'multi_search',
  'platform_search',
  'video_search',
  'free_search_test',
  'schedule_create',
  'schedule_list',
  'schedule_update',
  'schedule_delete',
]

/**
 * 保留的传输名（PTC 模式的 `run_code`）。
 *
 * ⚠ **必须显式放行**：ptc 模式下 `wireSchemas()` 只返回 `run_code` 一个
 *   （`dsh-tools/lib/index.js:2840-2843`）。若白名单把它滤掉，助手会拿到**空清单**
 *   —— 那是比"多几个工具"严重得多的回归（会话直接失去全部能力）。
 *   native 模式下它**根本不存在**（`view()` 只在 mode !== native 时加它），
 *   故 native 下清单仍**恰好 11**。实测判据见阶段 C 报告 C3-1。
 */
const RESERVED_TRANSPORT_TOOL = 'run_code'

/**
 * 装配期白名单：把**发给模型的**工具清单收敛到 {@link MODEL_TOOL_ALLOWLIST}。
 *
 * ── 机制依据（为什么挂这里）──────────────────────────────────────────
 *   ① 请求里的工具清单确实来自这次装配：`dsh-agent-loop/lib/index.js:907`
 *      `await this.loopCtx.systemPrompt.assemble(...)`；
 *   ② 装配是个**可拦截的瀑布**：`dsh-system-prompt/lib/types/index.d.ts:27`
 *      声明 `'system-prompt/assemble'(assembly, context, next)`；
 *   ③ 工具清单由 `dsh-tools/lib/index.js:2707`
 *      `ctx.systemPrompt.tools((context) => this.wireSchemas(context.scope))` 提供。
 *
 * ── 为什么用装配期过滤而**不是** `restrict({ allow })`（阶段 B 实测结论）────
 *   在 preset 行落点（真实落点）上，`restrict({ allow })`：
 *   · 点名 `read_contracts`/`write_hob`/`schedule_*` 会**直接抛错**
 *     （它们不在 `restrictableNames` 里 —— 那集合只含**继承来的**全局名）；
 *   · 退让成"只写能点名的"⇒ 会**把本预设自己的 read_contracts/write_hob 一并摘掉**
 *     （实测 57 ⇒ 18，两个工具都没了）。
 *   根因是宿主明写的语义：`dsh-tools/lib/types/index.d.ts:639-641`
 *   "Restrict **global** tools … scoped registrations remain visible"。
 *   ⇒ 数量目标只能靠"装配期过滤"达成。
 *
 * ── ⚠ 这是「看不见」，**不是「拿不到」**（如实标注，不美化）────────────
 *   被滤掉的工具**仍在注册表里**：装配期只改**送给模型的清单**，
 *   不动 `tools.get(name, scope)` 的解析（它读的是 `view(scope).visible`）。
 *   ⇒ 残余风险：若某条路径**绕过模型清单**直接点名调用，那些工具**仍可执行**。
 *     本批已按要求做越权调用实测（阶段 C 报告 C3-4 附**原始输出**）。
 *
 * ── 作用半径 ────────────────────────────────────────────────────────
 *   监听器注册在**本预设作用域**上；宿主的瀑布按 scope 链派发，
 *   故它只参与"scope 链里含本预设 scope"的装配 ⇒ **只有「助手」受影响**。
 *   `dsh-hob-work`（开发）与宿主自带的 minimal/standard/cordis **零影响**
 *   （实测逐名对照见 C3-3）。
 *
 * @param gateCtx - 门禁就绪后的子 ctx（`modules.tools` 关闭时本函数不会被调用）。
 * @param log - 诊断输出。
 */
function filterModelToolList(gateCtx: any, log: (m: string) => void): void {
  const allow = new Set<string>(MODEL_TOOL_ALLOWLIST)

  // ⚠ 走**反应式** `ctx.inject`（不是本模块的静态 `inject`）：
  //   静态 inject 缺依赖 ⇒ fiber 停 PENDING ⇒ 预设被标 `broken`
  //   ⇒ **在选择器里被静默过滤掉**（同本文件头部 E-21 的教训）。
  //   反应式注入在依赖缺席时只是**不跑回调** ⇒ 预设照常可用、宿主零告警。
  gateCtx.inject(['systemPrompt'], (spCtx: any) => {
    const handler = async (assembly: any, _context: any, next: any): Promise<any> => {
      // ⚠ 必须**先 `await next()`** 再过滤：后面的监听器可能还会往清单里加东西。
      const assembled = await next()
      const all: any[] = Array.isArray(assembled?.tools) ? assembled.tools : []
      const kept = all.filter((t) => allow.has(t?.name) || t?.name === RESERVED_TRANSPORT_TOOL)
      if (kept.length !== all.length) log(`装配期白名单：模型面工具 ${all.length} ⇒ ${kept.length}`)
      return { ...assembled, tools: kept }
    }
    // ⚠ 监听器必须挂在 **ctx** 上，不能挂在服务实例上：`SystemPrompt` 是 cordis `Service`
    //   子类，而 `Service` **不代理**事件 API（`cordis/lib/index.js:1742` 的类定义里没有
    //   `on`/`effect`）—— 写 `sp.on(...)` 会直接 `TypeError`。宿主的先例也都是 ctx：
    //   `dsh-agent/lib/index.js:167` 的 `agentCtx.on("system-prompt/assemble", …)`。
    // ⚠ 资源靠 `ctx.effect` 挂（§3.3 第 3 条）：依赖消失/卸载时监听器自动拆除。
    spCtx.effect(() => spCtx.on('system-prompt/assemble', handler),
      'dsh-hob preset: model-facing tool allowlist')
    log('已挂装配期白名单（' + MODEL_TOOL_ALLOWLIST.length + ' 个显式名字）')
  })
}

/** 注册两个工具（工具**定义**来自 `modules/tools.ts`，此处不重写实现）。 */
function registerTools(ctx: any, config: Config, log: (m: string) => void): void {
  const { readContracts, writeHob } = createHobTools(config)

  ctx.effect(() => ctx.tools.register(readContracts), 'dsh-hob preset: read_contracts tool')
  log('已注册 read_contracts')

  if (writeHob === undefined) {
    log('enableWrite=false ⇒ 不注册 write_hob（该工具根本不出现）')
    return
  }
  ctx.effect(() => ctx.tools.register(writeHob), 'dsh-hob preset: write_hob tool')
  log('已注册 write_hob')
}
