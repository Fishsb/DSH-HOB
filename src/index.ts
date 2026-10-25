/**
 * 宿主入口：登记各模块（**一个模块一个文件，入口只登记一行**）。
 *
 * 架构性质（必须保持）：
 *   ① 一个模块一个文件，各自 `apply(ctx, config)`；
 *   ② 依赖靠 `inject` 声明 ⇒ 依赖不在就**不激活，不报错、不阻塞整插件**；
 *   ③ 资源靠 `ctx.effect` 挂 ⇒ 卸载自动清理；
 *   ④ **加模块 = 加文件 + 入口登记一行**，不动其他模块。
 *
 * ⚠ 本轮是**骨架**：只把上面这条形状立起来，**不注册任何业务能力**。
 */
import type { Context } from '@deepseek-ai/cordis'
import { Config, moduleSwitches, spawnDefaults, permissionLevel, PERMISSION_SERVICE, interconnectEnabled, interconnectTargets, workMode, WORK_MODE_SERVICE } from './config.ts'
export { PERMISSION_SERVICE }
import type { Config as ConfigShape, ModulesConfig } from './config.ts'
// ⭐ 逐会话策略权威（2026-10-22 · `REQ-04`）—— ⚠ 必须在入口 provide（两侧作用域都要用）。
import { installSessionPolicy, SESSION_POLICY_SERVICE } from './session-policy-service.ts'
export { SESSION_POLICY_SERVICE }

import * as toolsModule from './modules/tools.ts'
import * as busModule from './modules/bus.ts'
import * as orchModule from './modules/orchestrator.ts'
import * as settingsModule from './modules/settings.ts'
// ⚠ M6a 跨实例投递（2026-10-16 第 237 轮 · `UD-119` 裁定）
import * as interconnectModule from './modules/interconnect.ts'
// ⚠ 新建 Hob 会话的受信通道（2026-10-22 · `REQ-04` UI 源码阶段）：
//   它是**独立模块**，不进 `MODULE_REGISTRY`（那个表管的是"可开关的业务能力"，
//   而这条通道是"建会话+写策略"的**原子入口**，没有独立开关语义）。
//   ⚠ 它自己用反应式 `ctx.inject(['connection','sessions'])`：缺任一 ⇒ 不登记、不报错。
import { installCreateChannel } from './modules/session-create-channel.ts'
// ⚠ 「这个会话选过档位没有」的**只读**路由（2026-10-22 第 4 轮 · 任务书 §二①）：
//   ⚠ 独立文件而不是给创建通道加 `action` —— 那个文件本单**禁改**（另一实施会话持有）。
//   ⚠ 它自己用反应式 `ctx.inject(['connection'])`：缺 ⇒ 不登记、不报错。
//   ⛔ 只读：不建会话、不写策略、不改任何状态。
import { installPolicyRoute } from './modules/session-policy-route.ts'

export { Config }

/**
 * 插件名 —— 同时是**加载器 entry id**、**RPC 路由前缀**（`/plugins/<name>/*`）
 * 与 **settings namespace**。
 *
 * ⚠ 改这一个常量会同时改动三条对外契约，改名时须与 `package.json` /
 *   `cordis.patch.yml` / client 侧同名常量同批改，否则宿主按旧名找包、
 *   client 按新名请求路由，两边对不上（旧项目实测，见 .hob/EXPERIENCE.md E-03）。
 */
export const name = 'dsh-hob'


/**
 * 模块登记表：**加模块只改这里一行**。
 *
 * 每项 = { key, 显示名, 模块本体, 配置开关读取器 }。
 * 模块的 `inject` 由模块自己声明（cordis 会把 `inject` 当作加载门禁），
 * 入口不代它决定依赖 —— 这正是「模块可独立启停」能成立的原因。
 *
 * ⚠ `enabled()` 的入参是**已解出的开关对象**（{@link moduleSwitches} 的返回值），
 *   **不是**整个 config —— 因为 `modules` 标了 `.volatile()`（为了设置页可见），
 *   运行时它是 ref 对象，直接 `c.modules.tools` 会**静默**得到 `undefined`，
 *   四个模块会全部不加载（详见 `config.ts` 的 `moduleSwitches` 注释）。
 *
 * ⚠ `configFor()`（可选）把该模块需要的**已解 ref 的普通值**传给它。
 *   目前只有 `bus` 需要（`spawn` 的四个默认值）—— 同样是因为 `spawn.*` 是 volatile ref，
 *   模块内直读会**静默**拿到 ref。收口点仍只有 `config.ts` 的 `spawnDefaults()`。
 */
const MODULE_REGISTRY = [
  { key: 'tools', mod: toolsModule, enabled: (m: ModulesConfig) => m.tools },
  {
    key: 'bus',
    mod: busModule,
    enabled: (m: ModulesConfig) => m.bus,
    // ⚠ **传的是"现读"函数，不是解好的快照** —— 这是实测逼出来的：
    // 设置页写入**不会重启插件**（宿主 `volatile` 的定义就是 "editable without remounting"，
    // 实测写入前后 `dsh-hob` / `dsh-hob-bus` 的 fiber uid **未变**），
    // 而 volatile ref 是**原地更新**的 ⇒ 在 `apply` 时快照一次会拿到**旧值**，
    // 且**静默不报错**（表现为"设置页改了，但建会话仍用旧默认"）。
    // ⇒ 每次 `spawn()` 现读，值永远与设置页一致。
    // 收口点仍是 `config.ts` 的 `spawnDefaults()`（模块内**不**直接读 `config.spawn.x`）。
    configFor: (c: ConfigShape) => ({ spawnDefaults: () => spawnDefaults(c) }),
  },
  // ⚠ M5 编排（批 17）：**缺省关**（见 config.ts 该字段注释 —— 它会在无人看管时推进）。
  { key: 'orch', mod: orchModule, enabled: (m: ModulesConfig) => m.orch },
  { key: 'settings', mod: settingsModule, enabled: (m: ModulesConfig) => m.settings },
  // ⚠ M6a 跨实例投递（2026-10-16 第 237 轮 · `UD-119` 裁定）：
  //   ⚠ **缺省关**（⚠ 它会在无人看管时向另一个实例投递 ⇒ 与 `orch` 同风险档）。
  //   ⚠ ⚠ **它 `provide` 的是一条"能力"，⛔ 不是一个面向模型的新工具**
  //     ⇒ ⚠ **⛔ 不动 `MODEL_TOOL_ALLOWLIST`、⛔ 不动三档白名单**（⚠ 避开第 234 轮点名的第 ④ 处外溢）。
  //   ⚠ ⚠ **两个"现读"**（⛔ 不是快照）：⚠ 开关与白名单都会随设置面改 ⇒
  //     在 `apply` 时快照一次会让"改完不生效"（⚠ 与 `bus.ts` 的 `spawnDefaults` 同条教训）。
  {
    key: 'interconnect',
    mod: interconnectModule,
    // ⚠ ⚠ **档位闸门**（⚠ 与开关**并列**的第二道）：⚠ 档位 = 账本时**⛔ 不注册**
    //   —— 跨实例投递是"影响外部状态"的动作，只读档不做（⚠ 见 §1.3 的判据"有没有改动能力"）。
    // ⚠ ⚠ **档位闸门**（⚠ 与开关**并列**的第二道）：⚠ 档位 = 账本时**⛔ 不注册**
    //   —— 跨实例投递是"影响外部状态"的动作，只读档不做（⚠ §1.3 判据：**有没有改动能力**）。
    //   ⚠ `switches` 是**入口 apply 里**解出的普通布尔（⚠ 设计如此：注册表本身在模块作用域，
    //     拿不到 `config`/`ctx`）⇒ ⚠ 档位那一半在 `apply` 的循环里判（⚠ 见下 `gate`）。
    enabled: (m: ModulesConfig) => m.interconnect,
  },
] as const

export function apply(ctx: Context, config: ConfigShape): void {
  const loaded: string[] = []
  /** ⚠ 与 `loaded` 一一对应的 fiber 引用（2026-10-24：用来判"真的激活了吗"）。 */
  const loadedFibers: Array<{ key: string; fiber: any }> = []
  // 开关一次性解出普通对象：把 volatile 的 ref 形态收口在 moduleSwitches 里。
  const switches = moduleSwitches(config)

  // ── 可读权限控制的**现读**服务（2026-10-14 第 144 轮；2026-10-17 改名）─────────
  //   ⚠ **为什么在入口 provide 而不是在模块里**：档位要同时对**两个半边**生效 ——
  //     · 预设行（`preset/dsh-hob/preset-tools` 的装配期过滤 + 哨兵）在**预设作用域**；
  //     · 模块层（四个读工具的 `execute`）在**模块作用域**。
  //     两处都不该各自去捅 `config`（`permission.level` 是 volatile ref，
  //     直读会静默拿到 ref 对象）⇒ 由入口 provide 一个**闭包每次现读**的函数，
  //     两侧都用它。这与 `spawnDefaults: () => spawnDefaults(c)` 是同一条纪律。
  //   ⚠ **必须是闭包不是快照**：档位改完要"即改即生效"（volatile 原地更新，
  //     宿主不重挂载）⇒ 快照会让改完的档位对已开会话不可见。
  ctx.provide(PERMISSION_SERVICE, () => permissionLevel(config))

  // ── 「工作方式」档位的**现读**服务（2026-10-19 · `UD-97`）─────────────────────
  //   ⚠ 与上面 `PERMISSION_SERVICE` 完全同一条落法与纪律（照抄，别各写一份）：
  //     · **为什么在入口 provide**：唯一消费方在**预设作用域**（`src/preset/tools.ts`
  //       注册的那段 scoped prompt section），而 `workMode.mode` 是 volatile ref；
  //       预设作用域**不该自己捅 config**（直读会静默拿到 ref 对象）。
  //     · **必须是闭包不是快照**：档位改完要"即改即生效"（volatile 原地更新、
  //       宿主不重挂载）⇒ 快照会让改完的档位对已开会话不可见。
  //   ⚠ ⛔ 本服务**不授予任何能力**：它只回一个档位字符串（决定"拆几路"的口径文本）。
  ctx.provide(WORK_MODE_SERVICE, () => workMode(config))

  // ── ⭐ **逐会话策略权威**（2026-10-22 · `REQ-04`）──────────────────────────────
  //   ⚠ 上面那两个服务**仍是实例级全局值**；它们现在的用途只剩两条：
  //     ① 机检 G-4 / G-11 与既有调用方的**兼容面**；
  //     ② 迁移旧会话时"一次性固化其工作方式"的**取值来源**（`hobSessionPolicy` 的迁移
  //        触发器里读：它在**切换那一刻**读一次、作为快照传给每个工作区的写入）。
  //   ⛔ 任何**读档 / 工作方式判定**都不许再读它们 —— 一律走下面这个服务。
  //
  //   ⚠ **为什么在入口 provide**：消费方横跨**预设作用域**（模型面装配 / 预执行 / 哨兵 /
  //     工作方式口径）与**模块作用域**（四个读工具的 `execute`）⇒ 两侧必须拿到同一个解析源。
  //     放模块里则预设作用域取不到；放预设里则模块作用域取不到。
  //   ⚠ 它是**服务**不是工具：⛔ 不进 `MODEL_TOOL_ALLOWLIST`、⛔ 不动三档白名单。
  //
  //   ⚠⚠ **2026-10-24 · 必须把 `workMode(config)` 现读闭包**显式传进去**（裁定方案 A）**：
  //     策略服务在**安装时**要抓一次"切换那一刻的工作方式"作为旧会话迁移的快照。
  //     改前它自己 `ctx.get('hobWorkMode')?.()` —— 而 `ctx.get` 缺省是 **strict**，
  //     cordis 只返回 `fiber.state === 2` 的实现（`@deepseek-ai/cordis/lib/index.js:763-771`）；
  //     `apply` 期本 fiber 是 **state 1** ⇒ 那次读**恒 undefined**
  //     ⇒ 迁移落盘 `workMode:auto`，用户设的全局 `multi` 被静默改写（实测盘上 workMode=auto）。
  //     ⇒ 现在由入口把**同一个闭包**（与上面 `provide` 的那个逐字相同）传进去。
  //     ⚠ 只改 `get(name,false)` 是**半修**：那只是绕过 strict，仍依赖"装配期能取到"这件事。
  installSessionPolicy(ctx, { workMode: () => workMode(config) })

  // ⚠ **必须排在 `installSessionPolicy` 之后**：这条通道要调策略服务的 `set/get`，
  //   而那两个来自上一步 provide 的服务。⚠ 顺序反了会拿到 undefined
  //   （不是崩溃，是"通道装上了但永远写不进去"—— 那种静默失败更难查）。
  installCreateChannel(ctx)

  // ⚠ **同样排在 `installSessionPolicy` 之后**（它读的是那一步 provide 的服务；
  //   顺序反了不会崩，而是"路由装上了但每次都是 unknown"——那种静默失败更难查）。
  //   ⚠ 与创建通道**分开两条路由**：本单禁改那个文件（见 import 处的说明）。
  installPolicyRoute(ctx)

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * ⚠⚠ **2026-10-22（第 2 轮 · `REQ-04` + `REQ-05`）：装载期的全局档闸门已删除**
   * ══════════════════════════════════════════════════════════════════════════
   *
   * ── 改前是什么（以及为什么它错了）──────────────────────────────────────
   *   这里原有一句"若全局档位 === 账本，则 `continue`（不装载本模块）"的判定
   *   （⚠ 具体标识符名不再写在这里：`check:policy-cross` 的 CX-12 会逐字扫源码，
   *     留着名字会被它当成"闸门还在"，而那是**误报**。
   *     判据只看**代码**，但它不解析注释边界 —— 所以这里不写那个名字）。
   *   ⚠ 它做的事：在**模块装载期**用**实例级全局**档位决定「跨实例能力装不装」。
   *   两个方向的错，实测都能说清：
   *     · 全局档 = 账本、而**发起会话**在更宽档 ⇒ 能力**压根没装载** ⇒ 合法调用也拒
   *       （这正是上一轮回报里承认的那条：重启后合法请求全拒）；
   *     · 全局档宽 ⇒ 能力装载了，但**每个会话**还得各自够宽才有意义 ——
   *       用一个全局值当装载开关，本质上仍是"旧全局值在决定逐会话行为的边界"，
   *       与 `REQ-04`（会话独立）直接冲突。
   *   ⇒ 判据错在**时刻**与**主体**：跨实例投递是"影响外部状态"的动作，该在**投递那一刻**
   *     按**发起者是谁**判，⛔ 不是在装载时按"整台机器一个值"判。
   *
   * ── 现在：装载只看**显式开关**，准入在**投递时**按**可信发起会话**判 ──────
   *   · 装载层：只剩 `entry.enabled(switches)`（即 `modules.interconnect`）——与档位无关；
   *   · 投递层（`src/modules/interconnect.ts` 的 `deliverRemote`）：
   *     开关 → 白名单 → **可信发起者** → 该会话自己的策略 → 启动器 → 执行。
   *   ⚠ 会不会因此放宽？⛔ 不会，两个方向都仍然拒：
   *     · 拿不到可信发起者（无 initiator / 非活会话 / 伪造别会话 id）⇒ 拒；
   *     · 拿得到但该会话档位不够 ⇒ 拒。
   *   ⇒ 删掉的只是"用全局值在装载期一票否决"这条**串线**，⛔ 不是删掉准入。
   *
   * ── ⚠ 为什么把"可信发起者"放在**本文件**解析（而不是模块里）─────────────
   *   它要读 `agents` 服务的 `requireInitiator()`、再经 `sessions.get()` 核活、
   *   再经 `hobSessionPolicy` 取档 —— 三件都在**入口作用域**能拿到。
   *   模块作用域拿 `hobSessionPolicy` 要跨作用域，⛔ 不该为此把服务做成全局单例。
   *   ⇒ 模块只收一个**纯函数** `admissionOf()`：它要么给出「谁 + 什么档」，
   *     要么给出一个**机器可判的拒因**（⛔ 不返回"看起来像档位的字符串"）。
   */
  for (const entry of MODULE_REGISTRY) {
    // 开关关闭 ⇒ 不注册该模块。**只影响它自己**，不影响其他模块。
    //   ⚠ 跨实例投递的**唯一**装载条件就是它（显式开关），⛔ 不再参考任何档位。
    if (!entry.enabled(switches)) continue

    // 经 `ctx.plugin` 装载：模块自己的 `inject` 生效为加载门禁
    // （依赖不在 ⇒ 该 fiber 不激活，宿主不报错、其余模块照常）。
    // 用模块名作为 fiber 的显示名，便于 `dev_plugin_status` 之类诊断定位。
    // ⚠ `configFor` 传的是**普通值**（已解 ref）；没有它的模块保持原样（不传 config）。
    const modConfig = 'configFor' in entry ? entry.configFor(config) : undefined
    // ⚠ M6a 的运行态依赖（⚠ **现读**开关与白名单 —— ⛔ 不缓存）：⚠ 只有它需要，故按 key 给。
    const modConfigFinal = entry.key === 'interconnect'
      ? {
        deps: {
          enabledOf: () => interconnectEnabled(config),
          targetsOf: () => interconnectTargets(config),
          log: (msg: string) => { try { ctx.logger?.debug?.(msg) } catch { /* 无 logger 时忽略 */ } },
          /**
           * ⭐⭐ **投递准入：可信发起者 → 该会话策略**（2026-10-22 第 2 轮 · `REQ-04`/`REQ-05`）。
           *
           * ── 它取代了什么 ────────────────────────────────────────────────────
           *   上一轮的 `sessionLevelOf(sessionKey)` 收的是**一个字符串**。
           *   ⚠ 那等于"谁传什么就信什么"：调用方传 `'sess-A'` 就套用 sess-A 的档，
           *     传别人的 id 就借用别人的权限 —— **可伪造**，⛔ 不是授权。
           *   ⇒ 现在改成**从宿主执行上下文取发起者**，⛔ 不接受调用方自报身份。
           *
           * ── 三级取法（每一级都只在"确实拿到了活对象"时才往下走）───────────
           *   ① `agents.currentInitiator()` —— 宿主用 `AsyncLocalStorage` 维护的
           *      **当前执行归属**（`dsh-agent/lib/index.js:325` / `:370`）。
           *      ⚠ 它由 `agent-loop` 在**真正执行这一轮**时建立
           *      （`dsh-agent-loop/lib/index.js:868` 的 `withInitiator(this, …)`）
           *      ⇒ 走到投递时，发起者就是那个 agent。**这是唯一可信来源**。
           *   ② 拿它的 `agent.session`（宿主硬保证 `agent.id === session.id`，
           *      `dsh-agent/lib/index.js:514` 附近 `const { session } = agent`）。
           *   ③ 用 `sessions.get(session.id)` **回表核实它仍是活会话**
           *      —— ⚠ 不信"对象长得像"，要"能在这个 store 里查到同一份"。
           *
           * ── 拒（fail-closed）的每一档都带**机器可判**的原因 ──────────────────
           *   `no-initiator` —— 没有执行归属（定时器 / 外部直接调用 / 别处回调）
           *   `stale-session` —— 有 initiator，但它的会话不在活表里（已销毁 / 派生残留）
           *   `no-policy`    —— 策略服务缺席或取不到（没装 / 还没就绪）
           *   `bad-policy`   —— 取到了但形状不对（档位不是三档之一）
           *   ⛔ **一律不退回全局宽档** —— 那正是本批要断的串线。
           */
          admissionOf: () => {
            const deny = (code: string, detail: string) => ({ ok: false as const, code, detail })
            // ① 执行归属（⚠ 这一步**必须现读**：AsyncLocalStorage 是"当前栈"的，⛔ 缓存无效）
            let agent: any
            try {
              const agents = (ctx as any).get?.('agents') ?? (ctx as any).agents
              if (typeof agents?.currentInitiator !== 'function') {
                return deny('no-initiator', '宿主 `agents` 服务不可用（或没有 `currentInitiator`）⇒ 取不到执行归属')
              }
              agent = agents.currentInitiator()
            } catch (e) {
              return deny('no-initiator', `取执行归属抛错：${String((e as Error)?.message ?? e)}`)
            }
            if (agent === undefined || agent === null) {
              return deny('no-initiator',
                '当前没有执行归属（无 initiator 边界）⇒ ⛔ 不投递。'
                + '⚠ 常见于定时器 / 外部脚本直接调服务 / 非 agent 回调；'
                + '⚠ 这类调用没有"发起会话"，因此**没有**可判的逐会话档位。')
            }
            // ② 它的会话（⚠ 宿主保证同一 id；这里取对象本身去回表）
            let session: any
            try { session = agent.session } catch { session = undefined }
            if (session === undefined || session === null) {
              return deny('stale-session', '发起者有 agent 但没有 session ⇒ 无法判档')
            }
            const sid = (() => { try { return typeof session.id === 'string' ? session.id : '' } catch { return '' } })()
            if (sid === '') return deny('stale-session', '发起者的 session.id 取不到 ⇒ 无法判档')
            // ③ 回表核实：必须仍是**活会话**，且必须是**同一份对象或同 id 的活对象**
            let live: any
            try {
              const sessions = (ctx as any).get?.('sessions') ?? (ctx as any).sessions
              if (typeof sessions?.get !== 'function') {
                return deny('stale-session', '宿主 `sessions` 服务不可用 ⇒ 无法核实发起会话是否仍活着')
              }
              live = sessions.get(sid)
            } catch (e) {
              return deny('stale-session', `回表核实抛错：${String((e as Error)?.message ?? e)}`)
            }
            if (live === undefined || live === null) {
              return deny('stale-session', `发起会话 ${JSON.stringify(sid)} 不在活表里 ⇒ ⛔ 不投递（不借用已销毁会话的身份）`)
            }
            // ④ 该会话自己的策略
            let resolved: any
            try {
              const svc = (ctx as any).get?.(SESSION_POLICY_SERVICE) ?? (ctx as any)[SESSION_POLICY_SERVICE]
              if (typeof svc?.of !== 'function') {
                return deny('no-policy', '逐会话策略服务缺席 ⇒ 无法判定发起会话的档位（⛔ 不退回全局值）')
              }
              resolved = svc.of(live)
            } catch (e) {
              return deny('no-policy', `取逐会话策略抛错：${String((e as Error)?.message ?? e)}`)
            }
            const level = (() => { try { return resolved?.level } catch { return undefined } })()
            if (typeof level !== 'string' || !['ledger', 'project', 'workspace'].includes(level)) {
              return deny('bad-policy', `策略形状不对（level=${JSON.stringify(level)}）⇒ 按最保守处理`)
            }
            return {
              ok: true as const,
              sessionId: sid,
              level,
              isHob: resolved?.isHob === true,
              source: String(resolved?.source ?? 'unknown'),
            }
          },
        },
      }
      : modConfig
    /**
     * ⚠⚠ **捕获 `ctx.plugin()` 的返回值**（2026-10-24 · 治"假判据日志"）。
     *
     * ── 改前是什么（这就是本单要治的假判据）──────────────────────────────
     *   下面的 `[${name}] 已加载（模块：…）` **只依据"循环跑到了哪个 key"**，
     *   与"那条 fiber 到底激活没有"毫无关系。而 `ctx.plugin()` 在**依赖不满足**时
     *   **不抛错**：它建出一条 fiber 但 `state=0`（PENDING）、`apply` 根本没跑
     *   ⇒ 日志照样点它的名 ⇒ 使用者以为 `tools` / `orch` 在跑，实际一个都没装载。
     *   ⚠ 这正是本仓最忌讳的"静默失败"：**日志说有、实际没有**。
     *
     * ── 现在：把返回值收下来，循环结束后逐个读 `state` 再报 ────────────────
     *   `state`：0=PENDING / 1=LOADING / 2=ACTIVE / 3=FAILED（cordis 的 fiber 状态）。
     *   · 读得到且 =2 ⇒ 计入"已加载"（原样保留那句 info 的字样）；
     *   · 读得到且 ≠2 ⇒ 归到 warn 的"未激活"清单（点名 PENDING / FAILED）；
     *   · **读不到**（`state` 不是数字，例如单测/探针的假 ctx 返回 `{ then(){} }`）
     *     ⇒ 按"未知"处理并**仍然算作已加载**（⚠ 保持既有行为：`check:host` 的
     *       fake ctx 就是这样，若把它算成"未激活"那条判据会红 —— 而它并不是缺陷）。
     *   ⚠ **不 await 这条 fiber**：LOADING 与 PENDING 在循环刚结束那一瞬同形
     *     （实测报错态 `.then()` 永不 settle）⇒ 只读一次 `state`，⛔ 不等待。
     */
    const fiber: any = ctx.plugin({ ...entry.mod, name: entry.mod.name }, modConfigFinal)

    loaded.push(entry.key)
    loadedFibers.push({ key: entry.key, fiber })
  }

  /**
   * 读一条 fiber 的状态。⚠ 轮询上限极小（只让 LOADING 有机会落定），
   *   ⛔ 不 await（见上面"别 await 父 fiber"的理由）。
   * @returns `2`=ACTIVE / 其它数字=FINAL 状态 / `undefined`=判不出（假 ctx）
   */
  const fiberStateOf = (f: any): number | undefined => {
    const read = (): number | undefined => (typeof f?.state === 'number' ? f.state : undefined)
    let st = read()
    // ⚠ 只在"明确 LOADING(1)"时让出极短时间（同步自旋，不引入 await/延时）
    for (let i = 0; i < 20 && st === 1; i += 1) st = read()
    return st
  }

  // ⚠ 日志不是「模块真的生效」的判据（零日志 ≠ 没执行 —— 见 .hob/EXPERIENCE.md E-29）。
  //   真判据是装配树里能看到条目、以及模块真的注册了它该注册的东西。
  // ⚠ 本行原先还打 `persona=...` 片段；该字段已按 UD-43 从配置面删除
  //   （它是"空旋钮"：只被打进日志，不影响任何行为），故片段一并去掉。
  //   **日志本身保留** —— 它是"哪些模块被登记"的唯一运行时线索。
  /**
   * ⚠⚠ **2026-10-24 · 这一行不再是假判据**：它现在只点"真的 ACTIVE 的模块"。
   *
   * ── 改前的病灶 ────────────────────────────────────────────────────
   *   它把**循环走过的 key** 全列出来，而 `ctx.plugin()` 在依赖不满足时**不抛错**
   *   （fiber 停在 PENDING=0、`apply` 未跑）⇒ 日志说"已加载"，实际一个都没装。
   *   ⚠ 这类"日志说有、实际没有"比没有日志更坏：它让人**不去查**。
   *
   * ── 现在的分工（⚠ 分工就是判据）────────────────────────────────────
   *   · `已加载（模块：…）` —— 只含 **state===2**（ACTIVE）的 key，**以及 state 判不出的 key**
   *     （⚠ 判不出 ≠ 没装：单测/探针的假 ctx 拿不到 `state`，把它算作"未加载"会让
   *      `check:host` 误红；这是"读不到"与"确定失败"必须分开的同一条纪律）；
   *   · `模块未激活：待依赖(PENDING)=… / 失败(FAILED)=…` —— 只含**读得到且 ≠2** 的 key。
   *   ⚠ 两句都**只依据 fiber.state**，⛔ 不再依据"循环走到哪"。
   *   ⚠ info 那句的**原字样必须保留**（有判据逐字钉它）。
   */
  const stateById = loadedFibers.map(({ key, fiber }) => ({ key, st: fiberStateOf(fiber) }))
  const activeKeys = stateById.filter((x) => x.st === 2 || x.st === undefined).map((x) => x.key)
  const pendingKeys = stateById.filter((x) => x.st === 0).map((x) => x.key)
  const failedKeys = stateById.filter((x) => x.st !== undefined && x.st !== 0 && x.st !== 2).map((x) => x.key)
  ctx.logger?.info?.(
    `[${name}] 已加载（模块：${activeKeys.length ? activeKeys.join(', ') : '无'}）`,
  )
  if (pendingKeys.length > 0 || failedKeys.length > 0) {
    ctx.logger?.warn?.(
      `[${name}] 模块未激活：待依赖(PENDING)=${pendingKeys.length ? pendingKeys.join(', ') : '无'}`
      + ` / 失败(FAILED)=${failedKeys.length ? failedKeys.join(', ') : '无'}`
      + `（⚠ 这些模块的 apply **没有执行** ⇒ 它们的能力当前**不存在**；`
      + '依赖就绪后宿主会自动激活，或关掉对应 `modules.*` 开关消除本条）',
    )
  }
}
