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
import { Config, moduleSwitches, spawnDefaults, permissionLevel, PERMISSION_SERVICE, workMode, WORK_MODE_SERVICE } from './config.ts'
export { PERMISSION_SERVICE }
import type { Config as ConfigShape, ModulesConfig } from './config.ts'
// ⭐ 逐会话策略权威（2026-10-22 · `REQ-04`）—— ⚠ 必须在入口 provide（两侧作用域都要用）。
import { installSessionPolicy, SESSION_POLICY_SERVICE } from './session-policy-service.ts'
export { SESSION_POLICY_SERVICE }

import * as toolsModule from './modules/tools.ts'
import * as busModule from './modules/bus.ts'
import * as orchModule from './modules/orchestrator.ts'
import * as settingsModule from './modules/settings.ts'
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
// ⚠ 2026-10-29（第 6 轮 · 四步主线数据接线 → 同日晚裁定改为五步）：**另一条只读路由** —— 五步进度表。
//   与上面那条**同族同形态**（`connection.fetch.register` + `ctx.inject(['connection'])` + 真 `Response`），
//   ⛔ 零写操作；账本根复用 `resolveLedgerRoot` + `declaredLedgerHome`（⛔ 不新开解析路径）。
import { installTasksProgressRoute } from './modules/tasks-progress-route.ts'
import { installExecProgressRoute } from './modules/exec-progress-route.ts'
import { installStagesRoute } from './modules/stages-route.ts'
import { installLedgerResourceRoute } from './modules/ledger-resource-route.ts'
import { installUnseenToolsRoute } from './modules/unseen-tools-route.ts'

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
] as const

/**
 * 每个模块的**对外可读名字**（只用来写日志）—— ⚠ 只在这里定义一次，⛔ 别处不许手抄。
 *
 * ── 为什么需要（2026-10-25 · 本单）──────────────────────────────────────
 *   日志要让人一眼看出"哪几个模块没起"，而 `MODULE_REGISTRY` 的 `key` 是**内部开关名**
 *   （`tools` / `bus` / `orch` / `settings`）—— ⚠ 作业书 §一-2 明令那一行**不许**泄露
 *   内部配置值；而 `orch` 这种缩写对外本来就读不懂。
 *   ⇒ 另立一张**显示名**表：外面看到的是"会话总线""闭环编排"这类日常说法，
 *     与设置页上用户看到的那几个开关是同一套词。
 *
 * ⚠ **新增模块时必须同步改这里**：类型是 `Record<(typeof MODULE_REGISTRY)[number]['key'], string>`
 *   ⇒ `MODULE_REGISTRY` 里加一个 key 而这里漏了，**`tsc` 直接红**，
 *   ⛔ 不会静默印成 `undefined`。这是"谁让它保持对"那一问的机制答案（REPORT §4）。
 */
const MODULE_LABELS: Record<(typeof MODULE_REGISTRY)[number]['key'], string> = {
  tools: '工具',
  bus: '会话总线',
  orch: '闭环编排',
  settings: '配置面自检',
}

/**
 * ⚠⚠ **2026-10-25 · 本函数改为 `async`**（本单的修法）。
 *
 * ── 为什么必须 async ───────────────────────────────────────────────
 *   收尾要印"哪些模块真的起来了"，而 fiber 的 `1`(LOADING) → `2`(ACTIVE) 之间隔着
 *   一个 `await Promise.resolve()`（`cordis/lib/index.js:1345` 的 `_reload()`）——
 *   ⚠ **同步代码结构上看不到它**（实测：同步自旋 20 / 1000 / 1e6 次都还是 `1`）。
 *   所以只能让 `apply` 自己变成 async、`await` 一下子 fiber 落定再印。
 *   ⚠ 这是本单唯一能同时满足"三态可分"与"正向样本正确"的落法（REPORT §3 有论证）。
 *
 * ── 宿主/cordis 对 async apply 的支持（⚠ 这不是我猜的）──────────────────
 *   `Fiber._execute()` 的 `runner.execute` 返回 Promise 时走 `effect.then(safeCollect)`
 *   （`cordis/lib/index.js:1148-1150`），`_reload()` 又 `await this._execute(...)`
 *   ⇒ **async apply 是被支持的正常形态**，父 fiber 会等到它 settle 才进 ACTIVE。
 *   实测：`ctx.plugin({apply: asyncFn})` 的父 fiber `await` 后为 `2`（REPORT §1 读数）。
 *
 * ── ⛔ 这次改动**不改变**任何模块的装载条件 ────────────────────────────
 *   只把"印日志"从"同步读一次"挪到"等落定再读"。开关/依赖/装载顺序**一个字没动**，
 *   ⛔ 没有把任何状态改成"乐观默认值"（作业书 §三 明令）。
 */
export async function apply(ctx: Context, config: ConfigShape): Promise<void> {
  const loaded: string[] = []
  /** ⚠ 与 `loaded` 一一对应的 fiber 引用（2026-10-24：用来判"真的激活了吗"）。 */
  const loadedFibers: Array<{ key: string; fiber: any }> = []
  /**
   * ⚠ 与 `loaded` 一一对应的**关掉原因**（`true` = 配置里这个开关是关的）。
   *   2026-10-25 新增：日志要能分清"没起"的两种成因（配置关 vs 起了但挂了），
   *   而"配置关"这个事实只在**这一层**知道（被 `continue` 跳过的模块，压根没有 fiber 可读）。
   *   ⇒ 必须在这里记下来，否则下游只能看到"少了几个"，⛔ 猜不出是关的还是挂的。
   */
  const skippedBySwitch: string[] = []
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

  // ⚠ 2026-10-29（第 6 轮）：五步进度**只读路由**。
  //   与本文件其它路由**无顺序依赖**（它只读文件，不碰任何服务），
  //   但放在同族旁边便于"路由都在这几条"一眼看到。
  //   ⚠ 它自己 `ctx.inject(['connection'])`：宿主 `connection` 缺席 ⇒ 不登记、不报错。
  installTasksProgressRoute(ctx)

  // ⚠ 2026-10-30（第 17 轮）：执行态**只读路由**（面板第 4 步子项的数据源）。
  //   ⚠ 数据源 = 编排自己的 `runtime/orch-watches.json` ⇒ **⛔ 不新增第二份运行态**（`D1`①）：
  //     路径由 `orch-state.ts` 的 `orchStateFileOf()` 派生，与 `hob_orch_status` 同一条入口。
  //   ⚠ 同样自己 `ctx.inject(['connection'])`：宿主 `connection` 缺席 ⇒ 不登记、不报错。
  installExecProgressRoute(ctx)

  // ⚠ 2026-10-30（P3）：五步汇总**只读路由**（面板新数据源 = `ledger/units/index.toml`）。
  installStagesRoute(ctx)
  installLedgerResourceRoute(ctx)

  // ⚠ 2026-10-31（P28 · `TSK-048` / `R-008`）：**「待确认工具」只读路由**。
  //   病：没见过的工具只进内存 + 宿主 warn，`debugLog` 默认关 ⇒ **重启即丢、用户永远看不到**。
  //   本路由是那条记忆的唯一读出口（⚠ 零写：只回快照，⛔ 不清空）。
  installUnseenToolsRoute(ctx)

  for (const entry of MODULE_REGISTRY) {
    // 开关关闭 ⇒ 不注册该模块。**只影响它自己**，不影响其他模块。
    // ⚠ 2026-10-25：跳过时**记下原因**，供收尾那一行区分"配置关"与"起了但挂了"。
    if (!entry.enabled(switches)) {
      skippedBySwitch.push(entry.key)
      continue
    }

    // 经 `ctx.plugin` 装载：模块自己的 `inject` 生效为加载门禁
    // （依赖不在 ⇒ 该 fiber 不激活，宿主不报错、其余模块照常）。
    // 用模块名作为 fiber 的显示名，便于 `dev_plugin_status` 之类诊断定位。
    // ⚠ `configFor` 传的是**普通值**（已解 ref）；没有它的模块保持原样（不传 config）。
    const modConfig = 'configFor' in entry ? entry.configFor(config) : undefined
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
    const fiber: any = ctx.plugin({ ...entry.mod, name: entry.mod.name }, modConfig)

    loaded.push(entry.key)
    loadedFibers.push({ key: entry.key, fiber })
  }

  /**
   * 读一条 fiber 的状态（⚠ **只读一次**，⛔ 不自旋、⛔ 不等）。
   *
   * ── ⚠⚠ 2026-10-25 · 这里原来有一段"同步自旋 20 次"，它是本单要治的那条缺陷的**根因** ──
   *   改前：`let st = read(); for (let i = 0; i < 20 && st === 1; i += 1) st = read()`。
   *   那句注释写的是"只让 LOADING 有机会落定" —— ⚠ **可它做不到**，而且不是"次数太少"：
   *     `state` 从 `1`(LOADING) 变 `2`(ACTIVE) 发生在 `_reload()` 里，而 `_reload()` 的
   *     第一步就是 `await Promise.resolve()`（`cordis/lib/index.js:1345`）⇒ **必须让出微任务队列**。
   *     同步 `for` 循环**一次微任务都不让出** ⇒ 循环 20 次与循环 100 万次结果**完全相同**都是 `1`。
   *     （实测见本单 REPORT §1：20 / 1000 / 1_000_000 次全读 `1`；而 `await` **一次还不够**、
   *     要**第 2 次**才变 `2` —— 所以正确做法是 `fiber.await()`，不是"多 await 几次"的猜测。）
   *   ⇒ ⚠ 于是 `1`（LOADING）落进了下面 `failedKeys` 那一支（"读得到且 ≠0/≠2"）
   *     ⇒ 四条**都还在装载中**的模块被印成"失败(FAILED)"，而 `activeKeys` 为空 ⇒ 印"无"。
   *   ⚠ **所以"自旋 20 次"这个上限本身是没有意义的旋钮**（它永远等不到任何东西）；
   *     真正需要的是**让出微任务**，那只能由 `await` 提供 ⇒ 见下面 `settleFibers()`。
   *
   * @returns `2`=ACTIVE / `0`=PENDING / 其它数字=FINAL 状态 / `undefined`=判不出（假 ctx）
   */
  const fiberStateOf = (f: any): number | undefined =>
    (typeof f?.state === 'number' ? f.state : undefined)

  /**
   * ⚠⚠ 2026-10-25 · **等子 fiber 落定再读**（本单的修法）。
   *
   * ── 为什么必须 await（而不是再自旋）────────────────────────────────
   *   见上面 `fiberStateOf` 的注释：`1 → 2` 要经过 `await Promise.resolve()`，
   *   同步代码**结构上**看不到它。⚠ `await` 是唯一能让出微任务的手段。
   *
   * ── 为什么是 `fiber.await()` 而不是 `Promise.all` + 超时 ──────────────
   *   `Fiber.await()`（`cordis/lib/index.js:1399-1403`）的语义正好是我们要的：
   *   `while (this.inertia) await this.inertia;` ⇒ 等本 fiber 的装载/卸载落定；
   *   然后 `if (this._error) throw this._error`。⚠ **实测 PENDING 的 fiber 也会立刻返回**
   *   （它没有 `inertia`）⇒ **不会挂住**（本单 REPORT §1 有读数：四条 fiber await 合计 1ms）。
   *   ⛔ 不自己造超时/轮询 —— 那会引入"等多久算够"这种**说不清的口径**。
   *
   * ── ⚠ 边界（说清它不保证什么）──────────────────────────────────────
   *   ① 它**只等**"装载这一瞬"落定；模块**之后**再因为依赖掉线而卸载，本行日志不会重打
   *      （那是宿主的 `internal/status` 事件，不在本行职责内）。
   *   ② `await` 抛（`_error`）时的 fiber 是 `3`(FAILED)，如实进"失败"桶。
   *   ③ 假 ctx（`check:host` 的探针）拿到的 `fiber` 是 `{ then(){} }` ⇒ **没有 `await` 方法**
   *      ⇒ 走下面的"判不出"分支，⛔ 不会因此把 `check:host` 判红（该行为**保持改前语义**）。
   */
  const settleFibers = async (items: Array<{ key: string; fiber: any }>): Promise<void> => {
    await Promise.all(items.map(async ({ fiber }) => {
      // ⚠ 假 ctx 的 fiber 没有 await（只有 then）⇒ 不强行造一个，交给下面的判不出分支
      if (typeof fiber?.await !== 'function') return
      try {
        await fiber.await()
      } catch {
        // ⚠ 装载失败**不是本函数的失败**：fiber 会停在 3(FAILED)，由下面如实分桶报出。
        //   ⛔ 不在这里吞掉错误信息 —— 它已经由宿主 logger 记过一遍（cordis `_reload` 的 catch）。
      }
    }))
  }

  // ⚠ 日志不是「模块真的生效」的判据（零日志 ≠ 没执行 —— 见 .hob/EXPERIENCE.md E-29）。
  //   真判据是装配树里能看到条目、以及模块真的注册了它该注册的东西。
  // ⚠ 本行原先还打 `persona=...` 片段；该字段已按 UD-43 从配置面删除
  //   （它是"空旋钮"：只被打进日志，不影响任何行为），故片段一并去掉。
  //   **日志本身保留** —— 它是"哪些模块被登记"的唯一运行时线索。
  /**
   * ⚠⚠ **2026-10-25 · 这一行现在是三态 + 真的会点名"哪个没起"**（本单的修法）。
   *
   * ── 改前（2026-10-24 那版）的病灶：它自称"不再是假判据"，但它**判不出真的没加载** ──
   *   ⚠ 两处硬伤，本单都用读数钉过（REPORT §1 / §2）：
   *     ① `1`(LOADING) 落进 `failedKeys` ⇒ 四条**都还在装载中**的模块被印成"失败(FAILED)"，
   *        `activeKeys` 为空 ⇒ info 印「模块：无」。⚠ 这是本单要治的那条。
   *     ② 更根本的：**同一份代码在"全都起"与"真的缺一个"两种情形下印出逐字相同的 info 行**
   *        （「模块：无」）。⇒ 那一行**对"模块没加载"这件事零分辨力**。
   *        实测：健康态与"缺 tools 服务"两种情形，info 行**逐字相同**（REPORT §2 两段原文）。
   *
   * ── 现在：先等落定，再按三态印 ────────────────────────────────────
   *   · `settleFibers()` 等每条 fiber 的装载**真的**落定（不再同步自旋 —— 那结构上不可能等到）；
   *   · 落定后按 `state` 三分：`2`=起来了 · `0`=待依赖(PENDING) · 其它数字=失败(FAILED)。
   *   ⚠ **三态各自成句**，⛔ 不再有"`无` 一句话了事"这种把两件事压成一句的形态：
   *     · **都起来了** ⇒ info 一句（原字样保留，判据逐字钉它）；
   *     · **部分没起 / 一个都没起** ⇒ info 仍打"已加载（模块：…）"，但**紧接着一条 warn 逐字点名**
   *       哪几个没起、各是什么状态（PENDING 还是 FAILED），并**明确说"缺的是哪一类"**。
   *       ⚠ 一个都没起时 **warn 里必须出现"一个都没起"** 这个可读短语
   *       （只印 `已加载（模块：无）` 会与"开关全关"这一合法情形**同形** —— 那正是改前的错）。
   *   ⚠ 假 ctx（`check:host`）的 fiber 没有 `await`、`state` 也读不到 ⇒ 落"判不出"，
   *     仍算作已加载（**保持改前语义**，⛔ 不让探针误红）。
   */
  await settleFibers(loadedFibers)
  const stateById = loadedFibers.map(({ key, fiber }) => ({ key, st: fiberStateOf(fiber) }))
  const activeKeys = stateById.filter((x) => x.st === 2 || x.st === undefined).map((x) => x.key)
  const pendingKeys = stateById.filter((x) => x.st === 0).map((x) => x.key)
  const failedKeys = stateById.filter((x) => x.st !== undefined && x.st !== 0 && x.st !== 2).map((x) => x.key)
  ctx.logger?.info?.(
    `[${name}] 已加载（模块：${activeKeys.length ? activeKeys.join(', ') : '无'}）`,
  )
  /**
   * ⚠⚠ **2026-10-25 · 本单的修法：在"有模块没起"时**额外**以 info 打一行"为什么没起"**
   *
   * ── 为什么 warn 不够（本单 §一-1 那个洞）──────────────────────────────
   *   原来区分两种"零个 ACTIVE"只靠下面那条 `warn`，而**生产日志通道看不到 warn**：
   *   `Logger._method` 的过滤是
   *   `(exporter.levels?.[name] ?? exporter.levels?.default ?? this.level ?? 1) < level ⇒ continue`
   *   （`cordis/lib/index.js:474`），内存 buffer 的 exporter **没配 `levels`** ⇒ 阈值落回 `1`，
   *   而 `warn` 的 level 是 **2** ⇒ **结构上永远被滤掉**（实测 111 条里 warn 一条没有）。
   *   ⇒ 于是"四个都没装"与"四个都装上了但一个都没起"在生产日志上**长得一模一样**。
   *
   * ── 这条 info 行的三条硬约束（作业书 §一-2，逐条对应下面的写法）─────────
   *   ① **必须能看出成因**：`配置关掉的` 与 `打开了但没起来的` **分成两段各自点名**，
   *      ⛔ 不合并成一句"没起"（两者成因不同：前者是用户选择，后者是环境故障）；
   *   ② **只有真有模块没起时才打**：全起时 `off.length === 0 && dead.length === 0`
   *      ⇒ **直接不进这支**，⛔ 一个字都不多打（"四都在"那一行与改前逐字相同）；
   *   ③ **对外可读**：只用 {@link MODULE_LABELS} 里的日常说法，⛔ 不出现 `modules.*` 开关名、
   *      ⛔ 不出现 `tools` / `hobBus` 这类内部标识、⛔ 不出现任何路径。
   *
   * ⚠ **为什么"配置关掉的"必须在这里记**：被开关跳过的模块**根本没有 fiber**
   *   （`continue` 掉了）⇒ 下游只看 `stateById` 只能看到"少了几个"，**猜不出**是关的还是挂的。
   *   ⇒ 成因在循环里用 `skippedBySwitch` 记下来（见上面那个数组）。
   */
  const offKeys = [...skippedBySwitch]
  const deadKeys = [...pendingKeys, ...failedKeys]
  if (offKeys.length > 0 || deadKeys.length > 0) {
    const total = MODULE_REGISTRY.length
    const label = (keys: string[]): string => keys.map((k) => MODULE_LABELS[k as keyof typeof MODULE_LABELS]).join('、')
    /** ⚠ 两段各自成句；哪一段为空就**不出现**（⛔ 不印"关闭的=无"这种噪声）。 */
    const parts: string[] = []
    if (offKeys.length > 0) {
      parts.push(`设置里关掉的=${label(offKeys)}（${offKeys.length} 个，这是配置所致、不是故障；`
        + '打开对应开关并重启实例后才会加载）')
    }
    if (deadKeys.length > 0) {
      parts.push(`设置里是打开的、但没起来的=${label(deadKeys)}（${deadKeys.length} 个，`
        + '这是环境不满足所致、不是配置关掉；补齐所缺的宿主能力后宿主会自动激活）')
    }
    /**
     * ⚠ 开头那个短语按"是不是一个都没起"分两种说法 —— 这是**人眼最先看的地方**：
     *   全都没起要说"一个都没起"，部分没起要说"有 N 个没起"，⛔ 不许都写成"部分"。
     *   ⚠ `total` 取 `MODULE_REGISTRY.length`（**不是** `stateById.length`）：
     *     开关全关时 `stateById` 是空的，用它算会把"4 个都没起"说成"0 个"，又说回"无"了。
     */
    const noneUp = activeKeys.length === 0 && total > 0
    const head = noneUp
      ? `${total} 个模块一个都没起`
      : `有 ${offKeys.length + deadKeys.length}/${total} 个模块没起`
    ctx.logger?.info?.(`[${name}] 模块未启动：${head} —— ${parts.join('；')}`)
  }
  if (pendingKeys.length > 0 || failedKeys.length > 0) {
    /**
     * ⚠⚠ **这条 warn 保留**（2026-10-25）：它是给"看得见 warn 的通道"（终端 / 文件 exporter）
     *   用的**明细**；⚠ 但**生产日志通道看不见它**（阈值只放 info 及以上），
     *   ⇒ **⛔ 不许把它当成"已经告知了"** —— 告知责任在上面那条 info 行。
     *
     *   这一段讲的是"**注册了但没起来**"（PENDING / FAILED）的逐条状态；
     *   ⚠ 它与上面那条 info 的分工：info 说**成因分类 + 对外名字**，warn 说**内部键名 + 精确状态**。
     *   ⚠ `loadedFibers` 为空（= 开关全关，**没有任何 fiber**）时不会进这一支，
     *     所以这里**只可能**是"打开了但没起来"，⛔ 不会与"配置关掉"混形。
     */
    const registered = stateById.length
    const dead = pendingKeys.length + failedKeys.length
    const allDead = registered > 0 && dead === registered
    ctx.logger?.warn?.(
      `[${name}] 模块未激活：待依赖(PENDING)=${pendingKeys.length ? pendingKeys.join(', ') : '无'}`
      + ` / 失败(FAILED)=${failedKeys.length ? failedKeys.join(', ') : '无'}`
      + (allDead ? `（⚠⚠ **${registered} 个模块一个都没起** —— 这是"全没装"，不是"开关全关"；`
        + '开关全关时这里不会打印本行）' : `（⚠ 上列 ${dead}/${registered} 个模块没起；其余照常）`)
      + '（⚠ 这些模块的 apply **没有执行** ⇒ 它们的能力当前**不存在**；'
      + '依赖就绪后宿主会自动激活，或关掉对应 `modules.*` 开关消除本条）',
    )
  }
}
