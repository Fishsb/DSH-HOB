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
import { Config, moduleSwitches, spawnDefaults, permissionLevel, PERMISSION_SERVICE, interconnectEnabled, interconnectTargets } from './config.ts'
export { PERMISSION_SERVICE }
import type { Config as ConfigShape, ModulesConfig } from './config.ts'

import * as toolsModule from './modules/tools.ts'
import * as busModule from './modules/bus.ts'
import * as orchModule from './modules/orchestrator.ts'
import * as settingsModule from './modules/settings.ts'
// ⚠ M6a 跨实例投递（2026-10-16 第 237 轮 · `UD-119` 裁定）
import * as interconnectModule from './modules/interconnect.ts'

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

  // ⚠ M6a 的**档位闸门**（2026-10-16 第 237 轮 · `UD-119` 裁定）：
  //   ⚠ ⚠ 它**在开关之外**再加一道：⚠ **档位 = 账本 ⇒ 不注册**（⚠ 跨实例投递是"影响外部状态"的动作）。
  //   ⚠ 判据照 §1.3："判据是**有没有改动能力**" —— ⚠ 只读档不做影响外部状态的事。
  //   ⚠ ⚠ **现读**（⛔ 不是快照）：⚠ 档位可随时改（volatile 原地更新、宿主不重挂载）
  //     ⇒ ⚠ 在 `apply` 时快照会让"升档之后仍不提供"（⚠ 与 `spawnDefaults` 同条教训）。
  const interconnectAllowed = () => permissionLevel(config) !== 'ledger'

  for (const entry of MODULE_REGISTRY) {
    // 开关关闭 ⇒ 不注册该模块。**只影响它自己**，不影响其他模块。
    if (!entry.enabled(switches)) continue
    // ⚠ M6a：第二道闸门（档位）—— ⚠ 只在**它自己**身上生效，⛔ 不影响别的模块。
    if (entry.key === 'interconnect' && !interconnectAllowed()) {
      ctx.logger?.info?.(`[${name}] 跨实例投递**未注册**：可读权限控制 = 账本权限（⚠ 只读档不做影响外部状态的动作）。`)
      continue
    }

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
        },
        levelOf: () => permissionLevel(config),
      }
      : modConfig
    ctx.plugin({ ...entry.mod, name: entry.mod.name }, modConfigFinal)

    loaded.push(entry.key)
  }

  // ⚠ 日志不是「模块真的生效」的判据（零日志 ≠ 没执行 —— 见 .hob/EXPERIENCE.md E-29）。
  //   真判据是装配树里能看到条目、以及模块真的注册了它该注册的东西。
  // ⚠ 本行原先还打 `persona=...` 片段；该字段已按 UD-43 从配置面删除
  //   （它是"空旋钮"：只被打进日志，不影响任何行为），故片段一并去掉。
  //   **日志本身保留** —— 它是"哪些模块被登记"的唯一运行时线索。
  ctx.logger?.info?.(
    `[${name}] 已加载（模块：${loaded.length ? loaded.join(', ') : '无'}）`,
  )
}
