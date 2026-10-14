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
import { Config, moduleSwitches, spawnDefaults, permissionLevel, PERMISSION_SERVICE } from './config.ts'
export { PERMISSION_SERVICE }
import type { Config as ConfigShape, ModulesConfig } from './config.ts'

import * as toolsModule from './modules/tools.ts'
import * as presetModule from './modules/preset.ts'
import * as busModule from './modules/bus.ts'
import * as orchModule from './modules/orchestrator.ts'
import * as settingsModule from './modules/settings.ts'

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
  { key: 'preset', mod: presetModule, enabled: (m: ModulesConfig) => m.preset },
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

export function apply(ctx: Context, config: ConfigShape): void {
  const loaded: string[] = []
  // 开关一次性解出普通对象：把 volatile 的 ref 形态收口在 moduleSwitches 里。
  const switches = moduleSwitches(config)

  // ── 权限档位的**现读**服务（2026-10-14 第 144 轮）─────────────────────
  //   ⚠ **为什么在入口 provide 而不是在模块里**：档位要同时对**两个半边**生效 ——
  //     · 预设行（`preset/dsh-hob/preset-tools` 的装配期过滤 + 哨兵）在**预设作用域**；
  //     · 模块层（四个读工具的 `execute`）在**模块作用域**。
  //     两处都不该各自去捅 `config`（`permission.level` 是 volatile ref，
  //     直读会静默拿到 ref 对象）⇒ 由入口 provide 一个**闭包每次现读**的函数，
  //     两侧都用它。这与 `spawnDefaults: () => spawnDefaults(c)` 是同一条纪律。
  //   ⚠ **必须是闭包不是快照**：档位改完要"即改即生效"（volatile 原地更新，
  //     宿主不重挂载）⇒ 快照会让改完的档位对已开会话不可见。
  ctx.provide(PERMISSION_SERVICE, () => permissionLevel(config))

  for (const entry of MODULE_REGISTRY) {
    // 开关关闭 ⇒ 不注册该模块。**只影响它自己**，不影响其他模块。
    if (!entry.enabled(switches)) continue

    // 经 `ctx.plugin` 装载：模块自己的 `inject` 生效为加载门禁
    // （依赖不在 ⇒ 该 fiber 不激活，宿主不报错、其余模块照常）。
    // 用模块名作为 fiber 的显示名，便于 `dev_plugin_status` 之类诊断定位。
    // ⚠ `configFor` 传的是**普通值**（已解 ref）；没有它的模块保持原样（不传 config）。
    const modConfig = 'configFor' in entry ? entry.configFor(config) : undefined
    ctx.plugin({ ...entry.mod, name: entry.mod.name }, modConfig)

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
