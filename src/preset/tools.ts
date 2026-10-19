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
import type { HobToolsConfig } from '../modules/tools.ts'
/**
 * ⚠⚠ **必须用「命名空间导入」，⛔ 不许写具名导入**（2026-10-19 · `TASK-D2`）。
 *
 * ── 改前的失败链（实测定性，不是猜测）──────────────────────────────────
 *   旧写法是 `import { PERMISSION_SERVICE, WORK_MODE_SERVICE, skeletonEnabled } from '../config.ts'`。
 *   ESM 的**具名导入在链接期（link time）**就要求目标模块**确实有那个名字**：
 *   只要有一个名字对不上，`import` 就抛
 *   `SyntaxError: The requested module '../config.ts' does not provide an export named 'WORK_MODE_SERVICE'`
 *   ⇒ **整个本模块求值失败** ⇒ `apply` 从未被调用 ⇒ `tools` 一行都没注册。
 *
 *   真实现场：宿主进程跑的是**启动时那份 `dsh-hob` 模块缓存**，而磁盘产物已被重新 build、
 *   新增了 `WORK_MODE_SERVICE` 这个导出 ⇒ 新预设文件在那个旧进程里**链接失败** ⇒
 *   该会话工具面 **25 → 12**、`hob_*` 全部消失、插件条目 `enabled=true` 但 `fiberPhase=null`，
 *   ⚠ **而且不报错**（求值失败被宿主当成"这个 preset 就这德行"）。
 *
 * ── 为什么命名空间导入能治它 ──────────────────────────────────────────
 *   `import * as configFace from '../config.ts'` **不检查名字是否存在**：
 *   缺的那个名字在运行时只是 `undefined`（属性缺席），**模块照样求值成功**。
 *   ⇒ 于是"少一个可选服务"的代价可以缩到**只少那一条能力**，而不是整块工具面。
 *   ⚠ 取值时机必须是**运行时**（`apply` 里 / 每次调用时光读），⛔ 不许在模块顶层快照
 *     （那会把"这一份缓存有没有那个导出"凝固成常量，正是本条要避免的形态）。
 */
import * as configFace from '../config.ts'
/**
 * ⚠⚠ **同一纪律扩到「一个名字就能拖垮整块」的全部具名导入**（2026-10-19 · `TASK-D`①）。
 *
 * `TASK-D2` 只治了 `../config.ts` 那一处，但**失败链是 ESM 的共性、不是那个文件的个性**：
 * 本模块原来还有四组**具名导入**（`modules/tools.ts` 的五个名字 · `shared/work-mode.ts` 的
 * 四个名字 · `modules/bus.ts` 的 `BUS_SERVICE` · `modules/orchestrator.ts` 的 `ORCH_SERVICE`），
 * 任何一组里少一个名字 ⇒ **同一个症状**：整块求值失败 ⇒ `apply` 不被调用 ⇒ `hob_*` 全没，且不报错。
 *
 * ⇒ 现在**全部改为命名空间导入**，取值时机一律**运行时**（`apply` 里 / 订阅回调里 / 每次现读）。
 *   缺席时的处置按「它缺席时其余能力还能不能安全工作」分两档（本单 §三-③ 的判据）：
 *
 *   | 面 | 缺席时 | 为什么 |
 *   |---|---|---|
 *   | 工具定义 / 门禁名 / 默认值（`modules/tools.ts`） | ⛔ **关键：起手 throw** | 没有它本预设一行工具都注册不出来；"少一半工具却看着正常"正是要避免的形态 |
 *   | `PERMISSION_SERVICE`（`config.ts`） | ⛔ **关键：throw** | 安全面三处（白名单 / 允许清单 / 执行前拦截），详见 `apply` 里那段注释 |
 *   | `BUS_SERVICE` / `ORCH_SERVICE` | 可降级 | 只在**用它的那次订阅**里取；缺席 = 少 M3 / M5 那组工具，其余照常 |
 *   | `WORK_MODE_SERVICE` | 可降级 | 只决定一段给模型看的规划口径 |
 *   | `skeletonEnabled()` / 共享口径函数 | 可降级 | 缺了退回**同一份** schema 缺省值 |
 *
 * ⚠ 降级**必须可读**：每条降级都 `warn` + `diag` 说清「少了什么 / 为什么少 / 影响什么 / 怎么修」，
 *   并记进 {@link DEGRADED_CAPABILITIES} 供诊断读取（⛔ 不许静默少一块）。
 */
import * as toolsFace from '../modules/tools.ts'
import * as workModeFace from '../shared/work-mode.ts'
import * as busFace from '../modules/bus.ts'
import * as orchFace from '../modules/orchestrator.ts'
// ⚠ ⚠ **只导类型**（`import type`）—— 类型在编译期擦除，**不产生运行时绑定** ⇒
//   它们缺席不会造成 ESM 链接失败。这正是"值的面可降级、类型的面仍精确"的分界线。
import type { HobBus } from '../modules/bus.ts'
import type { HobOrchestrator } from '../modules/orchestrator.ts'
import type { WorkMode } from '../shared/work-mode.ts'

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
 * **本模块当前降级了哪些能力**（`TASK-D`①-②："降级必须可读"的**可读落点**）。
 *
 * ⚠ 为什么要有这个导出，而不是只打一行 `warn`：
 *   日志是**易失**的（用户默认关着 `debugLog`、`ctx.logger.warn` 只在宿主控制台），
 *   而"少了什么"这件事必须在**事后**也能读出来（诊断脚本 / 将来的面板）。
 *   ⇒ 每次 `apply` **重写**这份清单（它描述的是"这一次挂载的实况"，不是历史累积）。
 *
 * ⚠ 键 = `config.ts` / 依赖模块里的**具名导出名**（与告警文本一一对应，便于对照源码）。
 * ⚠ ⛔ **关键依赖不写进这里** —— 那条路径是 `throw`，不是降级（本单 §三-③）。
 */
export const DEGRADED_CAPABILITIES: { key: string; why: string }[] = []

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
  // ⚠ `DEFAULTS` 也是"可能在旧缓存里缺席"的具名导出（`TASK-D`①）⇒ **运行时**取，
  //   且缺席时退到**同一个数**（`modules/tools.ts` 的 `debugLogMaxBytes` 缺省值）。
  //   ⚠ 诊断器本身**不是能力**（默认关着），它缺席不该让任何东西失败。
  const defaults = (toolsFace as unknown as Record<string, unknown>).DEFAULTS as
    { debugLogMaxBytes?: number } | undefined
  const maxBytes = config.debugLogMaxBytes ?? defaults?.debugLogMaxBytes ?? 262144

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
 * 挂载：**先立权限边界**（屏蔽越界工具）与**收敛机制**（模型面白名单 + 执行前拦截），
 * 再等门禁就绪后注册工具。
 *
 * 为什么**屏蔽**与**收敛**都要放在门禁**外面**：它们是这个预设的**权限边界**与
 * **收敛措施**，不是"本插件工具模块"的附属物。即使 `modules.tools` 关掉
 * （门禁不在、不注册工具），助手会话也不该
 *   ① 突然多出 4 个 `interconnect_*` 工具（屏蔽）；
 *   ② 突然拿到未被白名单放行的全部继承工具、且能直接执行任务看板/圆桌类工具（收敛）。
 *
 * ⚠ **F1 修正的行为倒挂**（阶段 E3 实测暴露）：这两处原先挂在 `ctx.inject([GATE_SERVICE])`
 *   回调内 ⇒ `modules.tools:false` 时**整段不执行** ⇒ 关掉门禁反而让助手
 *   从当时白名单的 11 个工具**涨到 51 个**（含能派活、能改工作状态的工具）——
 *   用户"减少能力"的意图被执行成了"放大权限"。与方案 §3.3「关掉只影响该模块自己」不符。
 *   ⇒ 现在门禁**只继续管"工具注册"这一件事**。
 *   ⚠ 上面「11 → 51」是**阶段 E3 那次实测的历史读数**（当时的白名单是 11 项）；
 *     批 9 起白名单为 **20** 项、**批 11 起 21 项**，同一构成的漏出数会随本机 bundle 构成漂移 ——
 *     判据仍是"关掉门禁后助手**不得**多出白名单外的名字"，**不是**这两个绝对值。
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

  /** 记一条**降级**（可读 + 可查）。⚠ 每条只记一次，`apply` 重入时重置清单。 */
  DEGRADED_CAPABILITIES.length = 0
  const degrade = (key: string, why: string): void => {
    DEGRADED_CAPABILITIES.push({ key, why })
    try { ctx.logger?.warn?.(`[dsh-hob preset] ${why}`) } catch { /* 日志失败不影响判定 */ }
    diag(`[dsh-hob preset] 降级 ${key}：${why}`)
  }

  /**
   * **运行时**取本模块依赖的具名导出（⛔ 不是模块顶层快照）。
   *
   * ⚠ 为什么要有这一层：见文件头那段注释 —— 四个依赖模块现在都是**命名空间导入**，
   *   "这一份缓存到底有没有这个导出"只能在运行时回答。
   * ⚠ 返回 `undefined` 的语义 = **这个具名导出在你手上这份模块里根本不存在**
   *   （旧缓存 / 版本错配）—— 这与"导出在、但服务没被 provide"（模块关掉）是**两件事**，
   *   下面按各自的口径分开处理，⛔ 不许混成一句。
   */
  const faceOf = (key: string): unknown => (toolsFace as unknown as Record<string, unknown>)[key]

  /**
   * ⚠⚠ **关键依赖①：`modules/tools.ts` 的五个名字**（`TASK-D`① 新增的这条判据）。
   *
   * 判据（本单 §三-③）：**它缺席时，其余能力还能不能安全工作** —— 答案是不能：
   *   这五个名字里有**工具定义本身**（`createHobTools`）、**门禁服务名**（`GATE_SERVICE`）、
   *   **账本根解析**（`ledgerRootOf`）、**默认值**（`DEFAULTS`）与**屏蔽名单**（`DEFAULT_DENY`）。
   *   ⇒ 少了它们，`apply` 要么立刻抛 `TypeError`（更糟：抛在订阅回调里，变成半挂载），
   *     要么**静默少掉一整组工具/整条屏蔽**——后者正是"装错了却看起来正常"。
   *   ⇒ 起手就 `throw`，并且**把缺了哪几个名字逐条说出来**（⛔ 不许只说"依赖缺失"）。
   */
  const TOOLS_FACE_NAMES = ['GATE_SERVICE', 'DEFAULT_DENY', 'DEFAULTS', 'createHobTools', 'ledgerRootOf'] as const
  const missingToolsFace = TOOLS_FACE_NAMES.filter((k) => faceOf(k) === undefined)
  if (missingToolsFace.length > 0) {
    const why = '⚠ 本预设依赖的工具模块面**取不到这些具名导出**：'
      + missingToolsFace.map((k) => `"${k}"`).join(' / ')
      + '。当前这份 `modules/tools.ts`（很可能是宿主进程里的**旧模块缓存**）没有它们。'
      + ' ⚠ 它决定工具定义 / 门禁服务名 / 账本根解析 / 默认值 / 屏蔽名单五处，'
      + '⛔ 少了它**无法安全降级**（会变成"只有半套工具、或屏蔽名单凭空消失"，用户看不出）。'
      + ' ⇒ 按"关键依赖缺席照旧失败"处理：本预设工具面不注册。'
      + ' ↳ 修法：重启宿主，让它加载与盘上产物同版本的 `dsh-hob`。'
    try { ctx.logger?.warn?.(`[dsh-hob preset] ${why}`) } catch { /* 日志失败不影响判定 */ }
    diag(`[dsh-hob preset] 关键依赖缺席：${why}`)
    throw new Error(`dsh-hob preset: 关键依赖（modules/tools.ts 的 ${missingToolsFace.join(' / ')}）取不到`
      + ' ⇒ 拒绝以降级方式运行（理由见日志 warn / 见 src/preset/tools.ts 的 TASK-D 注释）')
  }
  /** 已过关键依赖检查 ⇒ 这些名字此后按非空使用（`typeof` 收窄只在本地有效，故显式取一次）。 */
  const GATE_SERVICE = faceOf('GATE_SERVICE') as string
  const DEFAULT_DENY = faceOf('DEFAULT_DENY') as readonly string[]
  const DEFAULTS = faceOf('DEFAULTS') as { debugLogMaxBytes: number }
  const createHobTools = faceOf('createHobTools') as (...a: any[]) => any
  const ledgerRootOf = faceOf('ledgerRootOf') as (...a: any[]) => any

  /**
   * 从 `config.ts` 的面里**运行时**取一个具名服务的服务名（⛔ 不是模块顶层快照）。
   *
   * ⚠ 为什么要有这一层：`../config.ts` 现在是**命名空间导入**（见文件头那段注释），
   *   所以"这一份缓存到底有没有这个导出"只能在**运行时**回答。
   * ⚠ 返回 `undefined` 的语义 = **这个具名导出在你手上这份 `config.ts` 里根本不存在**
   *   （旧缓存 / 版本错配）—— 这与"导出在、但服务没被 provide"（模块关掉）是**两件事**，
   *   下面按各自的口径分开处理，⛔ 不许混成一句。
   *
   * @param key - `config.ts` 里的导出名。
   * @returns 服务名字符串；该导出缺席 ⇒ `undefined`。
   */
  const serviceNameOf = (key: 'PERMISSION_SERVICE' | 'WORK_MODE_SERVICE'): string | undefined => {
    const value = (configFace as unknown as Record<string, unknown>)[key]
    return typeof value === 'string' && value !== '' ? value : undefined
  }

  /**
   * ⚠⚠ **关键依赖缺席 ⇒ 照旧失败，但必须给出能读懂的原因**（`TASK-D2` §三-③）。
   *
   * ── 为什么 `PERMISSION_SERVICE` 是**关键**依赖、不许降级 ─────────────────
   *   它决定三件事，而这三件**都是安全面**：模型面工具白名单（{@link filterModelToolList}）、
   *   装配期允许清单（{@link enforceToolAllowlist}）、执行前拦截哨兵（{@link installPermissionGuard}）。
   *   ⇒ 它缺席时，**其余能力不能"安全工作"**：我们会**不知道用户选的是哪一档**，
   *     只能编一个档位往下传（旧行为是静默编 `ledger`）—— 那会让
   *     ① 工作区档的用户**静默少掉**一堆本该看得见的读工具；或
   *     ② 反过来把本该收窄的档位当成更宽的档。
   *     两种都是**用户看不出没生效**的失败，正是本项目明令要避免的形态。
   *   ⇒ 判据（`TASK-D2` §三）：**关键依赖缺席就该照旧失败** —— 这里落 `throw`，
   *     ⛔ 不落"静默退回某个档"。
   *
   * ⚠ 与 `WORK_MODE_SERVICE` 的区别（同一次判断的两侧，⛔ 别读反）：
   *   那个只决定**一段给模型看的规划口径**；它缺席时其余能力**照常安全工作**（工具面不变、
   *   权限面不变）⇒ 它属于**可降级**的那一侧（见 `apply` 尾部）。
   */
  const permissionServiceName = serviceNameOf('PERMISSION_SERVICE')
  if (permissionServiceName === undefined) {
    const why = '⚠ 本预设想通过具名服务 "PERMISSION_SERVICE" 取"可读权限档位"，'
      + '但当前这份 `config.ts`（很可能是宿主进程里的**旧模块缓存**）**没有这个导出**。'
      + ' ⚠ 它决定模型面白名单 / 装配期允许清单 / 执行前拦截哨兵三处，'
      + '⛔ 少了它**无法安全降级**（会变成"按一个编出来的档位放行或收窄"，且用户看不出）。'
      + ' ⇒ 按"关键依赖缺席照旧失败"处理：本预设工具面不注册。'
      + ' ↳ 修法：重启宿主，让它加载与盘上产物同版本的 `dsh-hob`。'
    try { ctx.logger?.warn?.(`[dsh-hob preset] ${why}`) } catch { /* 日志失败不影响判定 */ }
    diag(`[dsh-hob preset] 关键依赖缺席：${why}`)
    throw new Error(`dsh-hob preset: 关键依赖 "PERMISSION_SERVICE" 取不到（旧版 config.ts 缓存？）`
      + ' ⇒ 拒绝以降级方式运行（理由见日志 warn / 见 src/preset/tools.ts 的 TASK-D2 注释）')
  }
  /**
   * **现读**当前可读权限控制的档位（每次调用现取，⛔ 不是快照）。
   *
   * ⚠ 走插件入口 provide 的 `PERMISSION_SERVICE`（闭包，每次现读 `config.permission.level`），
   *   因为 `permission.level` 是 volatile ref，**本预设作用域不该自己捅 config**。
   * ⚠ 服务名在（见上面的关键依赖检查）但**服务不在**（模块关掉 / 没 provide）⇒
   *   退到 `ledger`（**最保守**档，fail-closed）。⚠ 这是"模块关掉"这一档的既有语义，
   *   ⛔ 与"导出缺席"那种关键失败**不是同一件事**（后者上面已经 throw 了）。
   * ⚠ 这条退路**也要可读**：第一次走到它时打一句 warn（⛔ 不许静默收窄）。
   */
  let warnedNoPermissionService = false
  const levelOf = (): string => {
    try {
      const svc = ctx.get?.(permissionServiceName) ?? ctx[permissionServiceName]
      if (typeof svc === 'function') return String(svc())
      if (!warnedNoPermissionService) {
        warnedNoPermissionService = true
        const why = `⚠ 权限服务 "${permissionServiceName}" 当前**没有被 provide**（多半是 modules.tools 关着 / 还没就绪）'
          + ' ⇒ 本预设按"最保守档 ledger"工作（fail-closed）：读文档 / 读工作区文件那几项会**看不见**。'
          + ' ⛔ 这不是"权限没配"，是"这一轮取不到"。`
        try { ctx.logger?.warn?.(`[dsh-hob preset] ${why}`) } catch { /* 忽略 */ }
        diag(`[dsh-hob preset] ${why}`)
      }
      return 'ledger'
    } catch {
      return 'ledger'
    }
  }
  /**
   * **现读**当前「工作方式」档位（每次调用现取，⛔ 不是快照 —— 2026-10-19 · `UD-97`）。
   *
   * ⚠ 与 {@link levelOf} **同一条纪律、同一条取法**（照抄，别各写一份）：
   *   走插件入口 provide 的 `WORK_MODE_SERVICE`（闭包，每次现读 `workMode.mode`），
   *   因为 `workMode.mode` 是 volatile ref，**本预设作用域不该自己捅 config**。
   * ⚠ 服务不在（模块关掉 / 旧版本组合 / 裸跑）⇒ 退到 `DEFAULT_WORK_MODE`（`auto`）。
   *   ⚠ 兜底方向的理由见 `config.ts` 的 `workMode()`：取**后果更轻**的那一边，
   *   而不是替用户选了 `single`（那会把本可并行的任务压成一路）。
   * ⚠ **读到的不是三档之一** ⇒ 同样归到缺省档（⛔ 不许把非法值当一档往下传 ——
   *   那会让 `workModeInstruction()` 落进 `auto` 分支却带着一个说不清的档位名）。
   */
  const modeOf = (): WorkMode => {
    try {
      const name = serviceNameOf('WORK_MODE_SERVICE')
      if (name === undefined) return workModeFace.DEFAULT_WORK_MODE
      const svc = ctx.get?.(name) ?? ctx[name]
      const raw = typeof svc === 'function' ? String(svc()) : ''
      return (workModeFace.WORK_MODE_VALUES as readonly string[]).includes(raw)
        ? (raw as WorkMode) : workModeFace.DEFAULT_WORK_MODE
    } catch {
      return workModeFace.DEFAULT_WORK_MODE
    }
  }

  /**
   * ⚠ `shared/work-mode.ts` 里那四个**口径函数/常量**同样是"缺一个就整块求值失败"的具名导出。
   *
   * 判据：**它们缺席时其余能力还能不能安全工作** ⇒ 能 —— 工具面、权限面、收敛机制都不读它们，
   *   只有「工作方式」这一段口径与两个降级兜底用到。⇒ **可降级**，但必须可读。
   * ⚠ 因此把它们收成一个 `wm` 句柄：缺席的字段是 `undefined`，下面的口径注入**整体跳过**，
   *   而不是让 `apply` 在 `workModeInstruction is not a function` 上炸掉。
   */
  const wmOk = typeof workModeFace.workModeInstruction === 'function'
    && typeof workModeFace.workModeRedLine === 'function'
    && typeof workModeFace.DEFAULT_WORK_MODE === 'string'
    && Array.isArray(workModeFace.WORK_MODE_VALUES)
  denyInheritedTools(ctx, log, DEFAULT_DENY)

  // ⚠ **收敛机制的挂载点：直接在 preset scope 上**（不在门禁回调内）—— 见 apply 头部注释。
  //   两处都只认**本 scope**（ctx 即 preset 作用域），因此不影响其它预设；
  //   资源仍走 `ctx.effect`（卸载自动清理，§3.3 第 3 条）。
  //   ⚠ 用**外层 ctx**（不是门禁子 ctx）：门禁消失时收敛**必须留下**，否则就是本批要修的倒挂。
  filterModelToolList(ctx, levelOf, log)
  enforceToolAllowlist(ctx, levelOf, log)
  installPermissionGuard(ctx, levelOf, log)

  // ⚠ 「工作方式」口径的挂载点**同上**：外层 ctx（本预设作用域）、不随门禁消失。
  //   理由与收敛机制同一条：关掉 `modules.tools` 不该让"拆几路"的口径**消失**
  //   （那不是工具能力，是规划口径 —— 与本插件工具面无关）。
  //
  // ⚠⚠ **这一条是「可降级」的那一侧**（`TASK-D2` §三-①）：`WORK_MODE_SERVICE` 只决定
  //   **一段给模型看的规划口径**；它缺席时工具面、权限面、收敛机制**全都照常安全工作**。
  //   ⇒ 缺席（导出根本没有 / 服务没 provide）⇒ **只跳过这一段**，⛔ 不许影响其余注册。
  //   ⚠ 但降级**必须可读**（§三-②）：少了什么、为什么少、影响是什么，一次 warn 说清。
  const workModeServiceName = serviceNameOf('WORK_MODE_SERVICE')
  if (!wmOk) {
    // ⚠ 依赖模块整块缺席（旧缓存里没有 `shared/work-mode.ts` 这四个名字）⇒ 口径**无从拼起**。
    degrade('WORK_MODE_SERVICE',
      '⚠ 「工作方式」档位口径**没有注入**：`shared/work-mode.ts` 里'
      + ' `workModeInstruction` / `workModeRedLine` / `DEFAULT_WORK_MODE` / `WORK_MODE_VALUES`'
      + ' **至少有一个取不到**（当前这份 `dsh-hob` 很可能是宿主进程里的**旧模块缓存**）。'
      + ' ⇒ 影响面**只有这一条**：Hob 收不到"拆几路"的规划口径（按本项落地之前的行为走）；'
      + ' ⚠ 工具面 / 权限档位 / 收敛机制**不受影响，已照常注册**。'
      + ' ↳ 修法：重启宿主，让它加载与盘上产物同版本的 `dsh-hob`。')
  } else if (workModeServiceName === undefined) {
    degrade('WORK_MODE_SERVICE',
      '⚠ 「工作方式」档位口径**没有注入**：当前这份 `config.ts`（很可能是宿主进程里的'
      + '**旧模块缓存**）没有具名导出 "WORK_MODE_SERVICE"。'
      + ' ⇒ 影响面**只有这一条**：Hob 会按缺省档的拆分口径做事（`' + workModeFace.DEFAULT_WORK_MODE + '`），'
      + '「单会话 / 多会话」两档的设置**这一轮读不到**；'
      + ' ⚠ 工具面 / 权限档位 / 收敛机制**不受影响，已照常注册**。'
      + ' ↳ 修法：重启宿主，让它加载与盘上产物同版本的 `dsh-hob`。')
  } else {
    injectWorkMode(ctx, modeOf, log)
  }

  log('apply 完成权限边界与收敛；等待门禁 ' + GATE_SERVICE)

  /**
   * 反应式依赖：门禁（= `modules.tools` 模块）就绪时才注册工具。
   * 门禁不在 ⇒ 回调**不执行** ⇒ 助手退化为"无自定义工具"，但**预设不 broken**。
   *
   * ⚠ 门禁现在**只管工具注册**：收敛（模型面白名单 + 执行前拦截）已在上面挂好，
   *   不随门禁的在场与否改变。
   */
  ctx.inject([GATE_SERVICE], (gatedCtx: any) => {
    log('门禁就绪 ⇒ 注册工具')
    // ⚠ 用**回调给的子 ctx**注册（不是外层 ctx）：这是宿主的既有用法
    //   （`dsh-agent-preset-registry/lib/index.js` 里
    //   `ctx.inject(["settings"], (child) => {` 那一段 —— ⚠ 按**符号锚**定位，⛔ 别按行号）。
    //   子 ctx 继承依赖 API 且**拥有它自己创建的注册** ⇒ 门禁消失时这些注册随之拆除，
    //   不用手写卸载逻辑（§3.3 第 3 条：资源靠 ctx.effect 挂，卸载自动清理）。
    registerTools(gatedCtx, config, levelOf, log, ORCH_SERVICE, createHobTools)
  })

  // ── M3 · 会话总线工具（UD-77）────────────────────────────────────────
  // ⚠ **与门禁无关**、单独的**反应式**订阅：`hobBus` 由 `modules/bus.ts` 在
  //   `sessions`/`agents` 就绪后 provide。服务不在（模块关掉 / 服务未就绪）⇒
  //   回调不跑 ⇒ **这两个工具根本不出现**（而不是出现后报错）。
  //   ⇒ 关掉 `modules.bus` 只影响 M3 自己，与「模块可独立启停」一致（§3.3）。
  //
  // ⚠⚠ **`BUS_SERVICE` 与 `createHobBusTools` 也是"缺一个就拖垮整块"的具名导出**
  //   （`TASK-D`①）⇒ 改成**运行时**取。取不到的处置：**可降级**（少 M3 这 4 个工具，
  //   工具面其余部分 / 权限面 / 收敛机制 / M5 全部照常）—— 判据仍是本单 §三-③
  //   "它缺席时其余能力还能不能安全工作"。⚠ 但⛔ 不许静默：`degrade` 会说清少了哪 4 个。
  const BUS_SERVICE = busFace.BUS_SERVICE
  const createHobBusTools = busFace.createHobBusTools
  if (typeof BUS_SERVICE !== 'string' || typeof createHobBusTools !== 'function') {
    degrade('BUS_SERVICE',
      '⚠ 会话总线（M3）四个工具**没有注册**：`modules/bus.ts` 的'
      + ' `BUS_SERVICE` / `createHobBusTools` 至少有一个取不到（旧模块缓存？）。'
      + ' ⇒ 少了 `hob_sessions` / `hob_send` / `hob_workspaces` / `hob_spawn` 这 4 个；'
      + ' ⚠ 工具面其余部分 / 权限档位 / 收敛机制 / 编排工具（M5）**不受影响**。'
      + ' ↳ 修法：重启宿主，让它加载与盘上产物同版本的 `dsh-hob`。')
  } else {
    ctx.inject([BUS_SERVICE], (busCtx: any) => {
      const bus = busCtx[BUS_SERVICE] ?? busCtx.get?.(BUS_SERVICE)
      if (bus === undefined) {
        log('hobBus 已就绪但不可用（跳过 M3 工具注册）')
        return
      }
      log('会话总线就绪 ⇒ 注册 M3 工具')
      registerBusTools(busCtx, bus as HobBus, log, config, createHobBusTools, ledgerRootOf)
    })
  }

  // ── M5 · 闭环编排工具（UD-80 · 批 17）────────────────────────────────
  // ⚠ 同 M3 的反应式订阅纪律：`hobOrchestrator` 由 `modules/orchestrator.ts` 在
  //   `sessions`/`agents` 就绪后 provide。服务不在（`modules.orch` 关掉 / 未就绪）
  //   ⇒ 回调不跑 ⇒ **三个编排工具根本不出现**。
  //   ⇒ 关掉 `modules.orch` 只影响 M5 自己：**会话总线仍在**（手工投递路不受影响）。
  // ⚠⚠ 与 M3 同款：`ORCH_SERVICE` / `createHobOrchTools` 改为**运行时**取，取不到即降级。
  const ORCH_SERVICE = orchFace.ORCH_SERVICE
  const createHobOrchTools = orchFace.createHobOrchTools
  if (typeof ORCH_SERVICE !== 'string' || typeof createHobOrchTools !== 'function') {
    degrade('ORCH_SERVICE',
      '⚠ 闭环编排（M5）三个工具**没有注册**：`modules/orchestrator.ts` 的'
      + ' `ORCH_SERVICE` / `createHobOrchTools` 至少有一个取不到（旧模块缓存？）。'
      + ' ⇒ 少了 `hob_dispatch` / `hob_orch_status` / `hob_orch_control` 这 3 个；'
      + ' ⚠ 工具面其余部分 / 权限档位 / 收敛机制 / 会话总线（M3）**不受影响**。'
      + ' ↳ 修法：重启宿主，让它加载与盘上产物同版本的 `dsh-hob`。')
  } else {
    ctx.inject([ORCH_SERVICE], (orchCtx: any) => {
      const orch = orchCtx[ORCH_SERVICE] ?? orchCtx.get?.(ORCH_SERVICE)
      if (orch === undefined) {
        log('hobOrchestrator 已就绪但不可用（跳过 M5 工具注册）')
        return
      }
      log('闭环编排就绪 ⇒ 注册 M5 工具')
      registerOrchTools(orchCtx, orch as HobOrchestrator, log, createHobOrchTools)
    })
  }
}

/**
 * 屏蔽**继承来的**越界工具（{@link DEFAULT_DENY} + 配置追加）。
 *
 * ⚠ 为什么需要：`dsh-interconnect` 的四个工具是它自己的 bundle patch 作为
 *   **宿主平面行**声明的，会被**每个 agent 继承** —— 只靠"预设不挂它"**摘不掉**
 *   （实测：不摘时助手会多出 4 个）。收敛要靠**允许清单**思维（§6.3）。
 */
function denyInheritedTools(ctx: any, log: (m: string) => void, defaultDeny: readonly string[]): void {
  // ⚠ 原先此处还拼接 `config.denyTools ?? []`；该配置键已在阶段 E2 **删除**（无 patch 声明 ⇒ 恒空）。
  //   deny 名单现在**就是** `DEFAULT_DENY`（行为与删键前完全一致：删前它恒为 `[]`）。
  const deny = [...defaultDeny]
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
 * 「助手」**发给模型的**工具清单 —— **装配期白名单**（**档1 的 26 个显式名字**；
 *   三档的名字集见 {@link PERMISSION_TIERS}，**逐档名数以 `check:presets` 的判定为准**）。
 *
 * ── 为什么是这些 ────────────────────────────────────────────────────
 * 「助手」只干这几件事：**读项目文档 / 读工作区文件 / 写自己的账本**、
 * **查资料**、**打开网页取正文**、**只读查询看板与圆桌**、**安排自己的定时提醒**、
 * **在只有用户能定时向用户提问**、**按需加载技能指引**、**把产出挂成交付卡**。
 * 于是清单 = 本插件的 2 个 + 检索 5 个 + 定时 4 个（既有 11）
 *           + 编排只读查询 4 个 + 网页正文 1 个 + 文件只读 4 个（批 9 新增 9 = 20）
 *           + 向用户提问 1 个（**批 11 / D2 新增 1 = 21**）
 *           + 技能加载 1 个 + 产出挂卡 1 个（**批 13 新增 2 = 23**）。
 *           + **会话总线投递 2 个**（`hob_sessions` / `hob_send`，**批 14 / M3 新增 2 = 25**）。
 *           + **建会话 2 个**（`hob_workspaces` / `hob_spawn`，**批 16 新增 2 = 27**）。
 *           + **闭环编排 3 个**（`hob_dispatch` / `hob_orch_status` / `hob_orch_control`，**批 17 新增 3 = 30**）。
 *
 * ── ⚠ 能力落点 = **声明面 与 白名单 的「与门」**（批 8 审查实测，见 E-86）────
 * 白名单**只**决定"这一项发不发给模型"；工具**还必须在该预设作用域里被注册**——
 * 否则执行时得到的是 `unknown tool "X"`（作用域内根本没有），而不是白名单的拒绝文本。
 * ⇒ 本批两类改动必须**成对**落：
 *   · 编排只读查询 4 个 —— **零声明增量**（它们已在插件平面被继承到本预设作用域）；
 *   · 网页正文 1 个 + 文件只读 4 个 —— **必须同时**在 `preset-dsh-hob.patch.yml` 里
 *     指名增行（`tool-web` / `tool-fs` / `tool-fs-search`），否则只是"放行了名字"；
 *   · **批 13 同理**：`skill` 需 `tool-skill`（且 `skill-filesystem` 供目录）、
 *     `present` 需 `present` 行 —— 两处**都已在**同批的声明面增行里落好。
 *
 * ── 为什么**排除**「改动共享状态 / 拉团队」那一批 ────────────────────────
 * `taskboard_create|move|update|delete` · `taskboard_checklist|comment_add|execution_report` ·
 * `team_task_*` · `spawn_teammate` / `send_message` / `wait_agent` / `interrupt_agent` ·
 * `roundtable_create|speak|next_round|…` 是"**改共享工作状态 / 拉一支团队**"的工具
 * （认领、移卡、开会、拉专家、组队）。
 * ⚠ **批 14 / M3 的口径更正（UD-77）**：本项目原先的理由是"一旦能指挥别的会话，
 *   职责边界当场失效"。用户 2026-10-08 决策 M3 之后，**边界改了口径** ——
 *   「**投递**」是允许的（`hob_sessions` / `hob_send`，见清单末尾），
 *   「**改共享工作状态**」仍不允许：派单不落到看板、不替人认领/移卡。
 *   ⇒ 上面这批**继续排除**，理由从"不许指挥别的会话"改成
 *     "**不许替人改动共享状态**"（`hob_send` 只发一条消息，不改任何卡的状态）。
 *   ⚠ 契约同步改了那句 `You cannot message it`（见 `preset-dsh-hob.patch.yml`）——
 *     它曾是本清单排除该项的**依据**，现在依据变了，注释不能留着旧理由。
 *
 * ── 为什么**排除** `write` / `edit` / `bash`（批 9 的核心取捨）────────────
 * 见 `preset-dsh-hob.patch.yml` 的头部注释「批 9」一节：
 * 白名单的粒度是**工具名**，**无法**用它闸"写到哪个路径 / 写什么类型"（E-87）。
 * ⇒ 只要放行 `write` / `edit`，就等于把"改任意路径（含代码）"的能力给了「助手」。
 * 它们**不在**本清单里；本批不改这条取捨。
 *
 * ── 批 13 为何只增 `skill` / `present`（两个新名字都**不**带写权限）──────────
 * 用户裁定（UD-72）：做 O4 / O3 / O2 / O5 中的 `present`，**不做** O1（`/goal` 目标类）、
 * O6（`/plan` + `exit_plan_mode`）、`todo_write` / `job_*`。
 * ⇒ 那几类**对应工具名一个都没进**本清单（`create_goal` / `get_goal` / `update_goal` /
 * `todo_write` / `job_list` / `job_output` / `job_kill` / `exit_plan_mode` 全部零命中）。
 * ⚠ 注意 **O4（`agent-instructions`）与 O2（`/compact`）本就不产生工具名** ——
 *   前者注入**消息段**、后者是**斜杠命令** ⇒ 它们**只改声明面**，白名单这里**无从体现**。
 *   这一点在回报里单列，免得后来人以为"漏加了名字"。
 *
 * ⚠ **不用通配 / 前缀**：将来新装的插件**不得自动**进入「助手」的清单。
 *   这正是 `restrict({ deny })` 黑名单的反面教训 —— 黑名单每装一个新插件都会漏。
 * ⚠ 本清单是**装配期过滤**（看不见），不是 `restrict` 的硬摘除（拿不到）；
 *   两者的差别与残余风险见 `filterModelToolList` 的注释。
 */
export const MODEL_TOOL_ALLOWLIST: readonly string[] = [
  // ── 本插件的两个工具 ──────────────────────────────────────────────
  'read_contracts',
  'write_hob',
  // ── 检索 5 个（既有）──────────────────────────────────────────────
  'advanced_search',
  'multi_search',
  'platform_search',
  'video_search',
  'free_search_test',
  // ── 定时提醒 4 个（既有）──────────────────────────────────────────
  'schedule_create',
  'schedule_list',
  'schedule_update',
  'schedule_delete',
  // ── 批 9 / S1：编排**只读查询** 4 个（声明面零增量，已在继承面）─────
  'taskboard_list',
  'taskboard_get',
  'taskboard_comments',
  'roundtable_status',
  // ── 批 9 / S2：打开网页取正文 1 个（需 `tool-web` 指名增行）─────────
  'web_fetch',
  // ── 批 21 / 权限收缩（**2026-10-14 · 用户裁定**）：~~批 9 / S3 只读看工作区文件 4 个~~ ──
  // ⛔ **已收缩**：`read` / `glob` / `grep` / `read_image` **从本清单移除**。
  //   用户原话：「hob 预设……**只能看账本和网络访问权限**，其他的收缩」，
  //   并**明确裁定范围 A** = 只收「工作区文件读取」这一族（编排全家与问用户等**保留**）。
  // ⚠ **同批连带**（否则会红/会漂）：
  //   · 声明面删掉 `tool-fs` + `tool-fs-search` 两行（见 `preset-dsh-hob.patch.yml`）；
  //   · 机检 ⑤h 的"恰好 N 名"断言同步 30 → 26；
  //   · 预设契约（人读版 + 机器读版）里描述"看工作区文件"的段落同步改。
  // ⚠ **副作用（是好事，如实记录）**：`tool-fs` 的 `apply` **同时注册 `write` / `edit`**，
  //   而宿主**没有"只给 read 系"的开关**（见 preset 里「S3 的取捨」那段）——
  //   ⇒ 删该声明行后，`write` / `edit` **连注册面都不再存在**，
  //   原先"拦截器 fail-open ⇒ write/edit 理论上可达"那条**已知残余风险**随之收窄。
  // ── 批 11 / D2：向用户提问 1 个（需 `tool-ask-user` 指名增行）──────────
  // ⚠ 用户裁定 UD-68 / CHG-015：「允许 Hob 提问，但**尽量不问** —— 按项目方案主线
  //   决策推进，除非只能由用户决策才可以提问」。契约里已就地追加「决策自主」条文
  //   （见 `preset-dsh-hob.patch.yml` 的 `Decide on your own.` 一段），
  //   本条只是把"能问"这个**手段**接上；它不是"要多问"的授权。
  // ⚠ **v4 起本插件只剩 `Hob` 一个预设**：原句「只限本预设（Hob）——`Hob-Execute` 侧的
  //   `WORK_MODEL_DENY` 仍禁该工具、一个字未动」是 **v4 之前的现状断言，现已失实**：
  //   实施侧预设 `Hob-Execute` 与 `WORK_MODEL_DENY`（`src/modules/work-deny.ts`）**均已整段删除**
  //   ⇒ 该禁项**随预设一并移除**，现无"另一侧"可言（UD-64 的禁弹窗纪律只在实施侧预设存在时成立）。
  'ask_user_question',
  // ── 批 13 / O3：按需加载技能指引 1 个（需 `tool-skill` + `skill-filesystem`）─
  // ⚠ 与 E-86 的「与门」同款：光放行名字不够，声明面必须同时有那两行
  //   （本批已落，见 `preset-dsh-hob.patch.yml` 的「批 13」一节）。
  // ⚠ **目录可能为空是正常的**：用户裁定要求**收窄技能发现范围**（UD-72②），
  //   本预设把 `skill-filesystem` 配成 `includeDefaultRoots: false` + 空清单
  //   ⇒ 生效技能 **0 个**。此时 `skill` 工具**仍在**（可调用），
  //   只是调用会得到"技能未知或不再可用" ⇒ 这是**有意的收窄态**，不是故障。
  'skill',
  // ── 批 13 / O5：把产出挂成交付卡 1 个（需 `present` 指名增行）──────────
  // ⚠ `present` **不写工作区**：它只声明"这些已存在的文件是交付物"，
  //   让界面给出可预览/可打开的文件卡（`dsh-tool-present`）。⇒ 不撞 UD-13。
  'present',
  // ── 批 14 / M3：会话总线投递 2 个（UD-77）─────────────────────────────
  // ⚠ **这是本项目第一条"能指挥别的会话"的能力** —— 它改的是 PROJECT.md §6.1
  //   那行「派活 / 委派 ❌」。用户 2026-10-08 决策 UD-77 明确要它（方案 B），
  //   并把口径从"绝对没有"改成"**投递 ≠ 完成**：交付是 agent 干的，不是它干的"。
  //   落点仍是**与门**（E-86）：工具定义在 `modules/bus.ts`，注册在下面
  //   `registerBusTools`（预设作用域）；只加名字不加注册 ⇒ `unknown tool`。
  // ⚠ **不收 `inject` 语义**（第三种投递语义"只写上下文不唤醒"）：对派活无意义，
  //   且它的失败是静默的（会话可能一直不读）⇒ 不在枚举里，工具层也拒。
  'hob_sessions',
  'hob_send',
  // ── 批 16：建会话能力 2 个（UD-79）────────────────────────────────────
  // ⚠ 用户 2026-10-09 决策：Hob 派活/编排时**如需新建会话，新建的会话必须注意
  //   工作区归属**。落法是 `hob_workspaces`（看可选工作区）+ `hob_spawn`
  //   （建会话，**强制带 `workspaceId`**）。
  // ⚠ 为什么必须强制：宿主 `sessionController.create` 的 `workspaceId` 是**可选**字段，
  //   不传就建出"不属于任何工作区"的孤儿会话（2026-10-09 实测：只传 cwd 建出的
  //   会话在 workspace.json 里查无归属）。⇒ 本工具**不接受"不指定"**：
  //   要么显式给，要么落到调用方自己的工作区，解析不出就**拒**，绝不造孤儿。
  // ⚠ 与门（E-86）同前：定义在 `modules/bus.ts`，注册在 `registerBusTools`。
  'hob_workspaces',
  'hob_spawn',
  // ── 批 17：闭环编排 3 个（UD-80）──────────────────────────────────────
  // ⚠ 用户 2026-10-09 要求：会话任务完成后**自动回传**给对应的 Hob 会话，Hob 分析后
  //   继续推进并下发下一步；**续用还是新建由 Hob 自己判断**。
  // ⚠ 这条能力**会自己在无人看管时往下转**（用户明确选了"不设上限、只能手动停"）
  //   ⇒ `modules.orch` **缺省关**；开了才有这三个工具。
  // ⚠ 与门（E-86）同前：定义在 `modules/orchestrator.ts`，注册在 `registerOrchTools`。
  'hob_dispatch',
  'hob_orch_status',
  'hob_orch_control',
]

/**
 * 保留的传输名（PTC 模式的 `run_code`）。
 * ⚠ **必须显式放行**：ptc 模式下 `wireSchemas()` 只返回 `run_code` 一个
 *   （`dsh-tools/lib/index.js` 的 `wireSchemas(scope)` 里，非 native 分支
 *   `.filter((schema) => schema.name === RUN_CODE_NAME)` —— ⚠ 按**符号锚**定位）。若白名单把它滤掉，助手会拿到**空清单**
 *   —— 那是比"多几个工具"严重得多的回归（会话直接失去全部能力）。
 *   native 模式下它**根本不存在**（`view()` 只在 mode !== native 时加它）。
 *   ⚠ **名数不再写死在这里**（旧文本写「恰好 30」，而批 21 收缩后真值已变 —— 这正是
 *     「文档里的名数会静默变旧」的实例）⇒ 一律引用 **`check:presets` 的 ⑤m 组实测**。
 */
const RESERVED_TRANSPORT_TOOL = 'run_code'

/**
 * **权限三档的名字集**（2026-10-14 第 144 轮 · 用户裁定「档3 要真硬机制」+「档2不给，档3的都给」）。
 *
 * ── 三档是什么（包含链）────────────────────────────────────────────────
 *   · `ledger`（账本，**默认**）= **只读自己的账本 + 网络** —— 看不到项目工作区的文件。
 *     ⚠ **与批 21 收缩后的现状逐名一致**（机检 ⑤m-2 用双向差集钉这条）。
 *   · `project`（项目）= 档1 **+** `hob_read_doc`（**只 `.md`** 模式）。
 *   · `workspace`（工作区）= 档2 **+** `hob_glob` + `hob_grep` + `hob_read_image`
 *     （且 `hob_read_doc` 在档3 **不设类型白名单** —— 工作区里的文件都可读取查看）。
 *
 * ── ⛔ 写类 / 命令类名字在三档里**一个都没有** ───────────────────────────
 *   `write` / `edit` / `bash` / `pwsh` / `str_replace_editor` **不在任何一档**
 *   （机检 ⑤m-4 逐个点验）。
 *   ⚠ **这不只是"没放行"** —— 它们**根本不注册**（`tool-fs` / `tool-bash` /
 *     `tool-pwsh` / `str-replace-editor` 在声明面一行都没有）⇒ 结构性不可达。
 *     机检 ⑤m-6 另有一条盯**宿主平面**：那 4 个包必须仍处 `disabled: true`，
 *     否则写类工具会**静默回到注册面**而三档白名单照样 PASS。
 *
 * ── ⚠ 这份表是**唯一**的名字集来源（E-110）──────────────────────────────
 *   `MODEL_TOOL_ALLOWLIST`（档1 的历史常量）与各档必须是**同一份事实**：
 *   ⛔ 不许在别处再抄一份名字清单（机检 ⑤m-2 拿它与那份常量做**双向差集**）。
 *
 * ── 为什么档1 不直接用 `MODEL_TOOL_ALLOWLIST` ────────────────────────────
 *   留那个常量是为了**兼容既有断言与既有语义**（批 21 收缩后的那一档），
 *   而两档之上的档是**同一张表的切片**。二者由机检钉成"逐名相等"而不是"看起来差不多"。
 */
export const PERMISSION_TIERS: Readonly<Record<'ledger' | 'project' | 'workspace', readonly string[]>> = {
  /** 档1 账本 = 批 21 收缩后的现状（只读账本 + 网络 + 编排全家）。 */
  ledger: MODEL_TOOL_ALLOWLIST,
  /** 档2 项目 = 档1 + 只读 `.md`（自注册工具，**不声明 `tool-fs`**）。 */
  project: [
    ...MODEL_TOOL_ALLOWLIST,
    'hob_read_doc',
  ],
  /** 档3 工作区 = 档2 + 目录列举 + 文本搜索 + 图片（全部自注册只读）。 */
  workspace: [
    ...MODEL_TOOL_ALLOWLIST,
    'hob_read_doc',
    'hob_glob',
    'hob_grep',
    'hob_read_image',
  ],
}

/**
 * 三档里**一律不许出现**的名字（共享禁项）。
 *
 * ⚠ 这份清单的**来源是实测**（第 144 轮全机扫描，见 `REPORT-R148.md`）：
 *   全机只有这 5 个写类 / 命令类工具名，出自 5 个包
 *   （`dsh-tool-fs` → `write`/`edit`；`dsh-tool-bash`/`-persistent` → `bash`；
 *    `dsh-tool-pwsh`/`-persistent` → `pwsh`；`dsh-tool-str-replace-editor` → `str_replace_editor`）。
 *   ⛔ **不许凭记忆**增减 —— 将来新装插件带进新的写类名字时，**应当把它加进来**，
 *     这也正是 ⑤m-4 要盯的那件事。
 */
export const SHARED_FORBIDDEN_TOOLS: readonly string[] = [
  'write',
  'edit',
  'bash',
  'pwsh',
  'str_replace_editor',
]

/**
 * 哨兵**要罩**的名字（写类 / 命令类 + 两个范围可变的读工具）。
 *
 * ⚠ 罩的范围**刻意最小**：账本两件（`read_contracts` / `write_hob`）与编排七件
 *   **一律不罩** —— 哨兵自己出问题时，账本与编排**必须照常**（实测反例：
 *   裸哨兵抛异常会把 `read_contracts` 一起弄瘫，见 `REPORT-R147.md` §c-3）。
 */
export const GUARDED_TOOLS: readonly string[] = [
  ...SHARED_FORBIDDEN_TOOLS,
  'hob_read_doc',
  'hob_glob',
  'hob_grep',
  'hob_read_image',
]

/**
 * **「Hob 推进项目的工作方式」口径注入**（2026-10-19 · `UD-97`）—— 本项的**唯一真实消费者**。
 *
 * ── ⚠⚠ 两条通路都要注册（2026-10-19 第 2 轮 · 装配层实测逼出来的）──────────
 *   本预设的 persona 用 **`complete: true`**（"本段成为唯一 prompt 段"）。
 *   宿主 `SystemPrompt.assemble()` 在**装配瀑布跑完之后**做这一步：
 *     `sections: completeSection === void 0 ? transformed.sections : [completeSection]`
 *   ⇒ **任何 `section()` 注册都会被它整段覆盖** —— 这是我在装配层实测出来的，不是推断：
 *     用宿主真 `SystemPrompt` + 真 `createScope`（本预设同构）跑三档，
 *     `renderPrompt(assembly)` 三档**长度完全相同、且逐字等于 persona 正文**。
 *     （读数：`archive/2026-10-19-work-mode-effective/tmp/route-costs.mjs` 的 (C) 段。）
 *
 *   ⇒ 所以本函数注册**两处**：
 *     · **`section()`** —— 仅在"将来 persona 不再 complete"时有用（今天被吞，⛔ 但**留着**：
 *       删了它会让本项在那种组合下**静默失效**，而留着是零成本的）；
 *     · **`context()`** —— ⚠ **真正生效的那一条**：动态上下文**不受 complete 段影响**
 *       （宿主 `assemble()` 里 `contexts` 与 `completeSection` 是两条独立通路，
 *       `complete` 只重写 `sections`）。而 `agent-loop` 每步会把它投成**一条 user 消息**
 *       （`dsh-agent-loop/lib/index.js` 的 `preStep` → `renderContextSections` +
 *       `runtimeContext.project` ⇒ `messages: [...claimed, context]`）。
 *
 * ── ⚠ 为什么 `contexts` 通路仍满足"**改完即生效**"（关键，别读成"要重载"）────
 *   `agent-loop` 每步都 `refreshContext(assembly, …)`（`dsh-system-prompt` 的该方法原文：
 *   *"@returns the accepted assembly with current runtime-context provider text"*），
 *   它对每个 context 调 `resolveContext(provider, context)` ⇒ **provider 函数每步重跑**
 *   ⇒ 本函数的 `text: () => …` **每步现读档位** ⇒ 改完下一步即生效。
 *
 * ── ⚠ 为什么 `contexts` 通路**不会新旧口径并存**（这条与 `agent.inbox` 的本质区别）──
 *   宿主 `RuntimeContextProjection.project(current, sections)` 的语义是
 *   *"只在保留值不同时创建一份未提交快照"*：
 *     `if (this.retained?.text === snapshot) return;`
 *   且新快照正文首句写明 *"This snapshot supersedes earlier runtime-context snapshots."*
 *   ⇒ 改档位后是**新快照顶掉旧快照**（同一条被替换），⛔ 不是并列两条。
 *   ⚠ 这正是它比 `agent.inbox`**更适合本项**的理由（inbox 每次投一条、**留在会话史**，
 *     改档后旧口径仍在，除非自建作废机制 —— 代价读数见同一份报告）。
 *
 * ── 它的有效性判据（⛔ 不是"注入了"）──────────────────────────────────
 *   `scripts/check-config-face.mjs` 的 G-10 组：**跑宿主真装配**、取**最终正文**、
 *   要求三档最终正文互不相同且都含档位口径；并做**负向对拍**（摘掉注册 ⇒ 必须 FAIL）。
 *   ⚠ 本项在 `assembly.sections` 里"看得见"**不再算通过**（那正是上一单被打回的原因）。
 *
 * ── ⚠ 与 `complete: true` 的关系（如实标注）───────────────────────────
 *   `section()` 那一条**今天确实进不了最终正文** —— 这不是 bug，是本预设的既定形态；
 *   真正生效的是 `context()` 那一条。⛔ 报告里不许把两者混着说"都生效"。
 *
 * @param ctx - **本预设作用域**的 ctx（`apply` 的入参，即**外层** ctx）。
 * @param modeOf - **现读**档位（每次装配/每步重新调；⛔ 传值会变成快照）。
 * @param log - 诊断输出。
 */
function injectWorkMode(ctx: any, modeOf: () => WorkMode, log: (m: string) => void): void {
  // ⚠ 走**反应式** `ctx.inject`（不是本模块的静态 `inject`）：
  //   静态 inject 缺依赖 ⇒ fiber 停 PENDING ⇒ 预设被标 `broken`
  //   ⇒ **在选择器里被静默过滤掉**（同本文件头部 E-21 的教训）。
  ctx.inject(['systemPrompt'], (spCtx: any) => {
    // ⚠ 名字**必须**稳定且带本项目前缀：宿主这两张表都是**按名字**去重的
    //   （`NamedEntries.insert` 重名即抛）⇒ 名字里带档位会让"改档位"变成**多出**一个条目
    //   （旧条目还在、新档又加一条），那不是本项要的行为。
    //   ⚠ 段名与上下文名**分开**（两张表各自唯一），但都带 `dsh-hob:` 前缀便于识别。
    const SECTION_NAME = 'dsh-hob:work-mode'
    const CONTEXT_NAME = 'dsh-hob:work-mode-context'
    // 排序位：取 persona 之后、工具说明之前那一档（`DEPLOYMENT_PERSONA_PREFIX` = 0，
    // `TOOL_*` 从 1000 起）⇒ 用 500（宿主 `SECTION_ORDERS.PLAN_POLICY` 的值）。
    // ⚠ 用**字面量而非 `getSectionOrder('PLAN_POLICY')`**：后者要求 `systemPrompt`
    //   实例在位，而 order 只是一个排序数 —— 拿不到就退字面量会让"顺序"变成"有时不同"。
    //   ⚠ 取值出处：`dsh-system-prompt/lib/types/index.d.ts` 的 `SECTION_ORDERS`
    //   （`PLAN_POLICY: 500`）—— 它若在上游被重排，本条目只是**换了个先后**，不会失效。
    const ORDER = 500

    /**
     * 现拼口径正文 —— 两条通路**共用这一个函数**（⛔ 不许各写一份）。
     *
     * ⚠ 整段包 try/catch：装配/刷新期抛错会让**这一轮整个装配或这一步失败**
     *   （宿主 fail-closed），那比"口径没注入"严重得多（会话可能整轮跑不起来）。
     *   异常 ⇒ 退回**缺省档**的正文（而不是空串）：空串等于"没有这个口径"，
     *   而缺省档是本项落地之前的行为，最轻。
     */
    const textNow = (): string => {
      // ⚠ 运行时读（⛔ 不是模块顶层快照 `workModeInstruction`）—— 见文件头那段注释：
      //   这四个名字也可能在旧缓存里缺席。`apply` 已在挂载前用 `wmOk` 判过一轮，
      //   这里再取一次是因为**装配发生在很久以后**（`apply` 与装配之间可能隔着重载）。
      try {
        return workModeFace.workModeInstruction(modeOf()) + workModeFace.workModeRedLine()
      } catch (e) {
        log('工作方式口径取档位异常（退回缺省档）：' + String((e as Error)?.message ?? e))
        try {
          return workModeFace.workModeInstruction(workModeFace.DEFAULT_WORK_MODE) + workModeFace.workModeRedLine()
        } catch {
          return ''
        }
      }
    }

    // ── ① 段通路（`section()`）—— ⚠⚠ **今天这条是无效的，读代码的人别误读** ──────
    //
    //   ⚠⚠ **结论：本条今天不进模型上下文。** 原因（实测，不是推断）：
    //     本预设的 persona 行配了 `complete: true`（`preset-dsh-hob.patch.yml`），
    //     而宿主 `SystemPrompt.assemble()` 在末尾做
    //       `sections: completeSection === void 0 ? transformed.sections : [completeSection]`
    //     ⇒ **任何 section 注册都被整段替换掉**。
    //     实测读数：三档 `renderPrompt(assembly)`（= 最终系统提示词正文）**逐字相同**，
    //     档位口径**一个字都没进去**（读数见 `archive/2026-10-19-work-mode-effective/`）。
    //   ⚠ **所以它不是"两条通路都生效"**：真正生效的是下面的 ② `context()`，
    //     `check:config` 的 **G-10** 只对 ② 取装配层读数；G-4 只判"这条注册在位"。
    //     ⛔ 别把这两条读成互为备份、更别在任何报告里写"两条都生效"。
    //
    //   ⚠ **为什么仍然保留（2026-10-19 第 3 轮 · `UD-149` 裁定 ③：保留）**：
    //     零成本，且"将来 persona 不再 `complete`"（或本行换掉）时，
    //     它就是这条口径的**唯一通路** —— 删掉会让那种组合下**静默失效**
    //     （本项目最忌讳的形态：没有注入、也没有任何报错）。
    //     ⚠ 保留的前提是**注释如实写明今天无效**，否则下一个人会把它当生效通路。
    spCtx.effect(() => spCtx.systemPrompt.section({
      name: SECTION_NAME,
      order: ORDER,
      // ⚠ **函数**（不是字符串）：每次装配现读档位 ⇒ 这一天生效时它也是"改完即生效"的落点。
      text: textNow,
    }), 'dsh-hob preset: work-mode instruction section (⚠ 今天被 persona complete 吞掉，见上方注释)')

    // ── ② 上下文通路（`context()`）—— ⚠ **真正生效的那条** ─────────────────
    //   ⚠ 为什么它是有效的：`complete` 只重写 `sections`，`contexts` 是另一条通路；
    //     而 `agent-loop` 每步 `refreshContext()` 会**重跑 provider**（本处 = textNow）
    //     并把结果作为一条 user 消息投进去（`preStep` 的 `runtimeContext.project`）。
    //   ⚠ `required: false`（不写 = 缺省 false）：它应当**可被 runtime-context 抑制**
    //     —— 本预设 persona 配了 `includeRuntimeContext: false`（`suppressRuntimeContext()`），
    //     ⚠ **这会让本通路的正文不进上下文**！⇒ 见下 §③ 的处理。
    spCtx.effect(() => spCtx.systemPrompt.context({
      name: CONTEXT_NAME,
      order: ORDER,
      text: textNow,
      // ⚠⚠ **必须 `required: true`**（这是本轮第二个实测发现，不是可选口味）：
      //   本预设的 persona 配了 `includeRuntimeContext: false`
      //   ⇒ `dsh-persona` 会调 `systemPrompt.suppressRuntimeContext()`
      //   ⇒ 宿主 `assemble()`/`refreshContext()` 里
      //      `if (suppressed && provider?.required !== true) continue;`
      //   ⇒ **非 required 的 context 会被整条丢掉**。
      //   ⚠ 设 `required: true` 的语义（宿主原文）：*"Keep this operational context when
      //     optional runtime context is disabled."* —— 正是本项需要的：它是**运行口径**，
      //     不是可选的运行环境快照（工作目录那类）。
      required: true,
    }), 'dsh-hob preset: work-mode instruction context')

    log(`已注入「工作方式」口径（段 ${SECTION_NAME} 被 complete 段覆盖；`
      + `上下文 ${CONTEXT_NAME} 为**生效通路**；当前档 = ${modeOf()}）`)
  })
}

/**
 * 装配期白名单：把**发给模型的**工具清单收敛到 {@link MODEL_TOOL_ALLOWLIST}。
 *
 * ── 机制依据（为什么挂这里）──────────────────────────────────────────
 *   ① 请求里的工具清单确实来自这次装配：`dsh-agent-loop/lib/index.js:907`
 *      `await this.loopCtx.systemPrompt.assemble(...)`（⚠ 本行号 2026-10-17 在 0.2.1-rc.2 上核过，仍在位）；
 *   ② 装配是个**可拦截的瀑布**：`dsh-system-prompt/lib/types/index.d.ts:27`
 *      声明 `'system-prompt/assemble'(assembly, context, next)`（⚠ 同上，仍在位）；
 *   ③ 工具清单由 `dsh-tools/lib/index.js` 的 `ctx.systemPrompt.tools((context) => this.wireSchemas(context.scope))`
 *      提供 —— ⚠ 按**符号锚**定位（0.2.1-rc.2 上在 `:2802`，但它会随重排漂移）。
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
 * @param ctx - **本预设作用域**的 ctx（`apply` 的入参，即**外层** ctx）。
 *   ⚠ **不是**门禁子 ctx，也**不**随 `modules.tools` 开关消失 —— 见 `apply` 头部
 *   「F1 修正的行为倒挂」一节：收敛机制**必须留下**，否则关掉门禁反而放权。
 * @param log - 诊断输出。
 */
function filterModelToolList(ctx: any, levelOf: () => string, log: (m: string) => void): void {
  // ⚠ **⛔ 不许在这里建 Set 快照**（2026-10-14 第 144 轮修的点）：
  //   旧版写 `const allow = new Set(MODEL_TOOL_ALLOWLIST)` —— 那是**装配期快照**，
  //   用户改完档位后**已开的会话仍按旧档**走到重挂载为止。
  //   档位是 volatile 值型配置（宿主原地更新、不重挂载）⇒ **必须每次装配现读**。
  const allowFor = (): Set<string> => {
    const level = levelOf()
    const names = PERMISSION_TIERS[level as 'ledger' | 'project' | 'workspace'] ?? PERMISSION_TIERS.ledger
    return new Set<string>(names)
  }

  // ⚠ 走**反应式** `ctx.inject`（不是本模块的静态 `inject`）：
  //   静态 inject 缺依赖 ⇒ fiber 停 PENDING ⇒ 预设被标 `broken`
  //   ⇒ **在选择器里被静默过滤掉**（同本文件头部 E-21 的教训）。
  //   反应式注入在依赖缺席时只是**不跑回调** ⇒ 预设照常可用、宿主零告警。
  ctx.inject(['systemPrompt'], (spCtx: any) => {
    const handler = async (assembly: any, _context: any, next: any): Promise<any> => {
      // ⚠ 必须**先 `await next()`** 再过滤：后面的监听器可能还会往清单里加东西。
      const assembled = await next()
      const all: any[] = Array.isArray(assembled?.tools) ? assembled.tools : []
      // ⚠ 现读档位发生在**这一步**（每次装配）—— 这是"改档位不必重启"的落点。
      const allow = allowFor()
      const kept = all.filter((t) => allow.has(t?.name) || t?.name === RESERVED_TRANSPORT_TOOL)
      if (kept.length !== all.length) log(`装配期白名单（档=${levelOf()}）：模型面工具 ${all.length} ⇒ ${kept.length}`)
      return { ...assembled, tools: kept }
    }
    // ⚠ 监听器必须挂在 **ctx** 上，不能挂在服务实例上：`SystemPrompt` 是 cordis `Service`
    //   子类，而 `Service` **不代理**事件 API（⚠ **符号锚**：`cordis/lib/index.js` 里
    //   `var Service = class Service {` 的类体没有 `on`/`effect`；0.2.1-rc.2 上在 `:1742`）
    //   —— 写 `sp.on(...)` 会直接 `TypeError`。宿主的先例也都是 ctx：
    //   `dsh-agent/lib/index.js:167` 的 `agentCtx.on("system-prompt/assemble", …)`（⚠ 本行号核过，仍在位）。
    // ⚠ 资源靠 `ctx.effect` 挂（§3.3 第 3 条）：依赖消失/卸载时监听器自动拆除。
    spCtx.effect(() => spCtx.on('system-prompt/assemble', handler),
      'dsh-hob preset: model-facing tool allowlist')
    log('已挂装配期白名单（逐 step 现读档位；名数以 check:presets 的 ⑤m 判定为准）')
  })
}

/**
 * 执行路径拦截：让 {@link MODEL_TOOL_ALLOWLIST} **拿不到**，而不只是**看不见**。
 *
 * ── 为什么需要 ─────────────────────────────────────────────────────
 * 阶段 C 实测：装配期过滤只改"发给模型的清单"，**执行路径不看清单** ——
 * 绕过清单直接点名，被滤掉的工具**照常执行**（`taskboard_list`/`list_agents` 都成功了）。
 * 根因：`dsh-tools/lib/index.js` 的 `get(name, scope)` 读 `view(scope).visible`，与模型清单无关
 *   （⚠ 按**符号锚**：`get(name, scope)` → `return this.view(scope).visible.get(name);`；0.2.1-rc.2 上在 `:3091`）。
 *
 * ── 机制依据（为什么挂这里）──────────────────────────────────────────
 *   · 宿主**官方** waterfall 事件：`dsh-tools/lib/types/index.d.ts:47`
 *     `'tools/pre-execute'(exec, next): Promise<PreToolDecision>`，可返回 `{kind:'deny'}`；
 *   · 派发点按 **agent scope** 过滤：`dsh-tools/lib/index.js` 的 `prepareExecution()` 里
 *     `const carrier = scopeTarget(this, exec.agent)`（⚠ **符号锚**：`prepareExecution` + `scopeTarget(this, exec.agent)`）—— 类型注释亦明写
 *     "agent-scoped listeners receive only that agent's calls"；
 *   · 宿主先例：`dsh-experimental-auto-review/lib/index.js` 里的
 *     `ctx.on("tools/pre-execute", async (exec, next) => …)`（真机 profile 正装此 bundle；⚠ **符号锚**，⛔ 不钉行号 —— 实测该调用在 0.2.1-rc.2 上是 `:461`，原先写的 `:462` 指的已是 `const agent = exec.agent;` 那一行）。
 *
 * ── ⚠⚠ 失败方向：宿主这里是 **fail-CLOSED**，所以本函数**必须自己兜住一切异常** ──
 *   实测（阶段 D）：监听器**抛异常**时，`dsh-tools/lib/index.js` 的 `prepareExecution()`
 *   外层 `catch (error) { … result: toolErrorResult(error) }` 把异常变成
 *   `toolErrorResult` ⇒ 工具**不执行**（连 `read_contracts` 都失败）。
 *   ⚠ **符号锚**：`prepareExecution` 内的 `catch` + `toolErrorResult(error)`（0.2.1-rc.2 上在 `:3363`）。
 *   ⇒ 本拦截器**不是**安全边界，而是收敛措施：**把「助手」弄瘫比漏一个工具更糟**。
 *   故：任何异常 / 不认识的 exec 形状 / 非本名单的名字 ⇒ **一律 `next()` 放行**。
 *
 * @param ctx - **本预设作用域**的 ctx（`apply` 的入参，即**外层** ctx）。
 *   ⚠ **不是**门禁子 ctx，也**不**随 `modules.tools` 开关消失 —— 见 `apply` 头部
 *   「F1 修正的行为倒挂」一节：关掉门禁时本拦截器**照常执行**（这正是那处修正的目的）。
 * @param log - 诊断输出（走 {@link makeDiag}：默认关、有磁盘上限，不新开日志）。
 */
function enforceToolAllowlist(ctx: any, levelOf: () => string, log: (m: string) => void): void {
  // ⚠ 同上：**⛔ 不许快照**。执行期也要按**当次**档位判 ——
  //   否则"档2 会话调用档3 才有的名字"会被旧快照放行（或反向误拒）。
  const allowFor = (): Set<string> => {
    const level = levelOf()
    const names = PERMISSION_TIERS[level as 'ledger' | 'project' | 'workspace'] ?? PERMISSION_TIERS.ledger
    return new Set<string>(names)
  }

  ctx.effect(() => ctx.on('tools/pre-execute', async (exec: any, next: any) => {
    // ⚠ 整个判定体包在 try/catch 里：宿主对它自己的 catch 是 **fail-closed**，
    //   任何异常都会让**这次工具调用**失败（含白名单里的）。宁可放行。
    try {
      const name = exec?.name
      // ① 认识的、且在**当前档位**的名单里 ⇒ 放行（门槛 4：不阻断白名单内的名字）。
      if (typeof name !== 'string') return await next()
      if (allowFor().has(name)) return await next()
      // ② 保留传输名（ptc 的 `run_code`）⇒ 放行：滤掉它会让助手彻底失去能力。
      if (name === RESERVED_TRANSPORT_TOOL) return await next()
      // ③ 嵌套子派发（`exec.parent` 存在）⇒ 放行：那是 `run_code` 内部调用，
      //    不是"模型直接点名"，拦住会破坏传输自身（宿主先例同款判定）。
      if (exec?.parent !== undefined) return await next()
      // ④ 名单外的**模型直呼** ⇒ 拒绝（这才是本批要堵的越权路径）。
      log('执行路径拦截：拒绝 ' + name)
      return {
        kind: 'deny',
        reason: `"${name}" is not available in this session; work for another session is out of scope for 助手.`,
        info: { name: 'ToolDeniedError', code: 'TOOL_NOT_ALLOWED' },
      }
    } catch (e) {
      // ⚠ fail-open：**绝不**因为本拦截器自身的问题让工具失败。
      log('执行路径拦截器异常（已放行）：' + String((e as Error)?.message ?? e))
      return await next()
    }
  }), 'dsh-hob preset: enforce tool allowlist on pre-execute')

  log('已挂执行路径拦截（逐 step 现读档位；名单外一律拒绝）')
}

/**
 * **单调执行哨兵**（2026-10-14 第 144 轮 · 用户裁定「档3 要真硬机制」）。
 *
 * ── 它补的是哪一层 ────────────────────────────────────────────────────
 *   工具面三层（`volumes/plan/05-features.md` §5.2）：
 *   · **注册面** —— 写类工具**根本不存在**（声明面没有 `tool-fs` / `tool-bash` /
 *     `tool-pwsh` / `str-replace-editor`）⇒ 结构性不可达（**主机制**）；
 *   · **模型面** —— 三档白名单（{@link PERMISSION_TIERS}）⇒ 看不见；
 *   · **执行面** —— 本哨兵（**次机制**）：名字在名单内但**参数越界**时拒。
 *
 * ── ⚠⚠ 为什么用 `ctx.tools.guard()` 而不是 `tools/pre-execute` ─────────
 *   ① **单调拒**：guard 的返回值**没有 allow 形态** —— 返回理由即拒，
 *      后面的监听器**无法把它翻回放行**（⚠ **符号锚**：`dsh-tools/lib/index.js` 的 `guard()` 处
 *      JSDoc —— "while no guard can force-allow a call another guard denied"；
 *      0.2.1-rc.2 上在 `:3008-3012`；类型声明同句在 `lib/types/index.d.ts:647`）；
 *      而 `pre-execute` 瀑布的 `{kind:'allow'}` 可以被后续监听器改写。
 *   ② **fail-CLOSED**：哨兵**抛异常**时宿主让工具**不执行**
 *      （实测：`{"isError":true,"error":{"message":"GUARD-BLEW-UP"}}`，见
 *      `REPORT-R147.md` §c-3）。⚠ 这与上面那个拦截器的取向**相反** ——
 *      那个是收敛措施、fail-open；**本哨兵是边界、fail-closed**。
 *
 * ── ⚠⚠ 三条硬性（⛔ 缺一条就是事故，实测反例见 `REPORT-R147.md` §c-3）──
 *   ① **先判名短路**：`GUARDED_TOOLS` 之外**立即 `return undefined`**，
 *      **先于任何可能抛的代码** —— 这是"不罩瘫账本与编排"的**结构保证**。
 *      实测反例：裸哨兵（任何异常直接冒泡）会让 `read_contracts` **也**被拒 ⇒ Hob 瘫。
 *   ② **名单内判定体整题包 try/catch**，异常收敛到 **`return <拒绝理由>`**
 *      （安全的一侧：拒）。⛔ 不许 finally 里放行、不许 catch 后 return undefined。
 *   ③ **绝不 `throw`**：本函数体内不得出现 `throw`（机检 ⑤m-8 盯这条）。
 *
 * @param ctx - **本预设作用域**的 ctx（`apply` 的入参）。
 * @param levelOf - 现读档位的函数（每次调用现取）。
 * @param log - 诊断输出。
 */
/**
 * 从一次工具调用里**尽可能**取出"要读哪个路径"（哨兵的类型规则用）。
 *
 * ⚠ 为什么写得这么防御性：哨兵跑在**任何工具**的调用前，参数形状由各工具自己定义
 *   （`path` / `file_path` / 别的）；取不到就返回 `undefined`（**放行**）——
 *   因为"取不到"是**哨兵不认识这次调用**，不是"用户越权"。
 *   ⛔ 不许在这里 `throw`（硬性③）。
 *
 * @param exec - 宿主给的执行上下文。
 * @returns 路径字符串；取不到时为 undefined。
 */
function readPathArg(exec: any): string | undefined {
  try {
    const args = exec?.arguments ?? exec?.args
    if (args === null || typeof args !== 'object') return undefined
    for (const key of ['path', 'file_path', 'file']) {
      const v = (args as Record<string, unknown>)[key]
      if (typeof v === 'string') return v
    }
    return undefined
  } catch {
    return undefined
  }
}

function installPermissionGuard(ctx: any, levelOf: () => string, log: (m: string) => void): void {
  const guarded = new Set<string>(GUARDED_TOOLS)
  const forbidden = new Set<string>(SHARED_FORBIDDEN_TOOLS)

  ctx.effect(() => ctx.tools.guard((exec: any): string | undefined => {
    // ── 硬性①：**先判名短路**（名单外一律放行；先于一切可能抛的代码）──────
    const name = exec?.name
    if (typeof name !== 'string' || name === '') return undefined
    if (!guarded.has(name)) return undefined

    // ── 名单内：判定体包 try/catch（硬性②），异常收敛到"拒"（硬性③：不 throw）
    try {
      // 写类 / 命令类：**任何一档**都不许执行。
      // ⚠ 它们本不该到达这里（注册面不存在 ⇒ 大概率是 `unknown tool`）——
      //   但"到达不了"这个判断**依赖声明面**（别人改 profile 就失效，见 ⑤m-6）
      //   ⇒ 本层作为**第二道**，宁拒不放。
      if (forbidden.has(name)) {
        return `"${name}" cannot change anything in this session: this preset has no write-capable tools.`
      }

      // 读工具：名字本身没问题（白名单已筛过），此处只兜住"参数越界"。
      // ⚠ 参数检查交给工具自己的 `execute`（它返回可读的拒绝文本）；
      //   本哨兵在这里**只确认"这个档位看得见它"** —— 因为 guard 是按**调用名**
      //   生效的，而档位可能在会话中途**变窄**（workspace ⇒ ledger）：
      //   变窄后**已发出的调用**不该还能落地。
      const level = levelOf()
      const names = PERMISSION_TIERS[level as 'ledger' | 'project' | 'workspace'] ?? PERMISSION_TIERS.ledger
      if (!names.includes(name)) {
        return `"${name}" is not available at the current readable-permission level (${level}).`
      }

      // ── **类型规则：只在档2**（2026-10-14 第 145 轮 · 用户裁定「档3的都加」）──
      //   · **档2 `project`**：只许 `.md` —— 用户原话「档2不给」「不可以读代码」；
      //   · **档3 `workspace`**：**不设类型规则**（任意文件都可读可看）
      //     ⇒ 这一档只剩**包含性 + 软链**，它们由工具自己的 `execute` 守
      //       （`workspace-read.ts` 的 `resolveGuarded`，复用 `doc-read.ts` 的同一份实现）。
      //   ⚠ 哨兵**只看扩展名**（可判、不猜内容）：内容层面的"文本 / 二进制 / 图片"
      //     三态由 `hob_read_doc` 的 `execute` 决定怎么回（短提示 / 提示改用图片工具）。
      //     哨兵在这里的职责是**权限**（档2 不许读非 `.md`），不是**呈现**。
      if (level === 'project') {
        const requested = readPathArg(exec)
        if (typeof requested === 'string' && requested.trim() !== '') {
          const lower = requested.trim().toLowerCase()
          if (!lower.endsWith('.md')) {
            return `"${requested}" is not available at the document-permission level: this level reads only .md documents.`
          }
        }
      }
      return undefined
    } catch (e) {
      // 硬性②③：哨兵自身出问题 ⇒ 收敛到**拒**（安全的一侧），且**不往外抛**。
      // ⚠ 实测：抛异常会让宿主 fail-closed ⇒ **连账本工具一起拒**（Hob 瘫）。
      log('权限哨兵异常（收敛为拒）：' + String((e as Error)?.message ?? e))
      return 'the permission guard failed internally; this call was refused rather than allowed.'
    }
  }), 'dsh-hob preset: monotonic permission guard')

  log('已挂单调权限哨兵（名册 ' + GUARDED_TOOLS.length + ' 个；名单外一律放行）')
}

/** 注册两个工具（工具**定义**来自 `modules/tools.ts`，此处不重写实现）。 */
function registerTools(ctx: any, config: Config, levelOf: () => string, log: (m: string) => void,
  orchServiceName: string, createTools: (...a: any[]) => any): void {
  // ── 改 2 · 写入即投递（2026-10-10 第 44 轮 · 结构改造②）────────────────
  //   ⚠ 把**编排服务**注入工具定义，让 `write_hob(dispatchTo=…)` 能走
  //     `hob_dispatch` 的同一条路径（登记回传 + 清"待投递"）。
  //   ⚠ 用 **惰性取值**（每次执行时才 `ctx.get`）而不是在这里取一次快照：
  //     `write_hob` 与编排服务**挂载时机不同**（前者跟 `hobTools` 门禁、
  //     后者跟 `hobOrchestrator`），快照会取到 `undefined` 并**永久**定格成"不能投"。
  //     惰性取值让"编排迟到"也能用上（与 `ledgerRootOf` 传**函数**而非值是同款理由）。
  //   ⚠ 取不到 ⇒ 传 `undefined` ⇒ 只记账、不投递（fail-closed，返回值里如实带原因）。
  const {
    readContracts, writeHob,
    readWorkspaceDoc, globWorkspace: globTool, grepWorkspaceTool, readWorkspaceImage,
  } = createTools(config, {
    // ⚠ **惰性取值**（每次执行时才 `ctx.get`），见上面那段注释的同一个理由。
    orchOf: () => {
      try { return ctx.get?.(orchServiceName) as HobOrchestrator | undefined } catch { return undefined }
    },
    // ⚠ **现读档位**（不是快照）：档位是 volatile 值型配置，宿主原地更新、不重挂载
    //   ⇒ 在 `createHobTools` 时读一次会让"改档位即生效"失效。
    levelOf: () => levelOf(),
    // ⚠ **现读开关**（⛔ 不是快照）：`skeleton.enabled` 是 volatile（ref 对象）
    //   ⇒ 在 `createHobTools` 时读一次会让"改开关即生效"失效（与上面档位同一条教训）。
    // ⚠ 收口点 = `config.ts` 的 `skeletonEnabled()`（本作用域⛔ 不直接读 `config.skeleton.enabled`）。
    // ⚠ **命名空间取用**（`TASK-D2`）：这个具名导出同样可能在旧缓存里缺席 ⇒ 用可选 call，
    //   缺席时退回 schema 的缺省值（`true`，与 `skeletonEnabled()` 自己的兜底**同值**），
    //   并且**说一句**（⛔ 不许静默少一块 —— 见 §三-②）。
    skeletonEnabledOf: () => {
      const fn = (configFace as unknown as Record<string, unknown>).skeletonEnabled
      if (typeof fn === 'function') return Boolean((fn as (c: unknown) => unknown)(config))
      // ⚠ 本函数作用域只有 `log`（没有 `diag`）；用 `log` 说这一句 —— 可读优先于通道区别。
      log('⚠ `config.ts` 没有 `skeletonEnabled()` 导出（旧缓存？）⇒ 「首次铺骨架」按缺省值 true 处理')
      return true
    },
    // ⚠ 图片的存储走宿主 `attachments` 服务（实测：宿主平面 provide，
    //   **预设作用域取得到**）。⚠ 惰性取值 + 取不到时返回 undefined
    //   （工具会如实回"没有附件服务"，而不是假装图片已交给模型）。
    saveImage: async (input: unknown) => {
      try {
        const att = ctx.get?.('attachments')
        if (att === undefined || typeof att.saveImage !== 'function') return undefined
        return await att.saveImage(input)
      } catch (e) {
        log('saveImage 失败：' + String((e as Error)?.message ?? e))
        return undefined
      }
    },
  })

  ctx.effect(() => ctx.tools.register(readContracts), 'dsh-hob preset: read_contracts tool')
  log('已注册 read_contracts')

  // ── 四个自注册**只读**工具（2026-10-14 第 144 轮）─────────────────────
  //   ⚠ 它们**始终注册**（三档都注册），可见性由**装配期过滤**按档决定
  //     （`PERMISSION_TIERS`）—— 这是"换档不必重挂载"的前提：
  //     若按档增删注册，换档就得重挂载（撞"改档位即生效"那条）。
  //     ⚠ 代价如实登记：档1 的**注册面**因此比今天多这 4 个只读名
  //     （模型面仍与今天逐名一致 —— 机检 ⑤m-2 钉的是模型面）。
  ctx.effect(() => ctx.tools.register(readWorkspaceDoc), 'dsh-hob preset: hob_read_doc tool')
  ctx.effect(() => ctx.tools.register(globTool), 'dsh-hob preset: hob_glob tool')
  ctx.effect(() => ctx.tools.register(grepWorkspaceTool), 'dsh-hob preset: hob_grep tool')
  ctx.effect(() => ctx.tools.register(readWorkspaceImage), 'dsh-hob preset: hob_read_image tool')
  log('已注册 hob_read_doc / hob_glob / hob_grep / hob_read_image（只读；按档可见）')

  if (writeHob === undefined) {
    log('enableWrite=false ⇒ 不注册 write_hob（该工具根本不出现）')
    return
  }
  ctx.effect(() => ctx.tools.register(writeHob), 'dsh-hob preset: write_hob tool')
  log('已注册 write_hob（支持 dispatchTo / delivery 参数：写入即投递）')
}

/**
 * 注册 M3 的两个工具（定义在 `modules/bus.ts`，此处只挂载）。
 *
 * ⚠ 触发条件是 **`hobBus` 服务在**（= `modules.bus` 开着 且 `sessions`/`agents` 已就绪）。
 *   服务不在 ⇒ 本函数**根本不被调用** ⇒ 两个工具**不存在**，与"关掉模块只影响它自己"一致。
 *
 * ⚠ 与 `read_contracts`/`write_hob` 的**门禁不同源**：那两个跟 `hobTools`（= `modules.tools`），
 *   这两个跟 `hobBus`（= `modules.bus`）。⇒ 两个开关各自管自己那一组，互不牵连。
 */
function registerBusTools(ctx: any, bus: HobBus, log: (m: string) => void, config: Config,
  createBusTools: (...a: any[]) => any, rootOf: (...a: any[]) => any): void {
  // ⚠ 把**账本根解析闭包**交给 bus 工具（2026-10-10 新增）：`hob_spawn` / `hob_send`
  //   要用它记 / 清"待投递"。理由：解析逻辑（`ledgerRootOf` + config）**只在本层**，
  //   传给 bus 层就不必在那里再造一份 —— 两处各写一份必然漂（见 `EXPERIENCE.md` E-110）。
  //   ⚠ 传**函数**而不是值：账本落点按 exec 的 cwd 派生，快照会拿错工作区。
  //   ⚠ 闭包内 fail-closed（`ledgerRootOf` 判不出 ⇒ `undefined`）⇒ 记账被跳过，
  //     但工具的**功能照常**（记账是附加可观测，不是前置条件）。
  const { sessions, send, workspaces, spawn } = createBusTools(bus, (exec: any) => {
    try {
      return rootOf(config, exec)
    } catch {
      return undefined
    }
  })
  ctx.effect(() => ctx.tools.register(sessions), 'dsh-hob preset: hob_sessions tool')
  ctx.effect(() => ctx.tools.register(send), 'dsh-hob preset: hob_send tool')
  ctx.effect(() => ctx.tools.register(workspaces), 'dsh-hob preset: hob_workspaces tool')
  ctx.effect(() => ctx.tools.register(spawn), 'dsh-hob preset: hob_spawn tool')
  log('已注册 hob_sessions / hob_send / hob_workspaces / hob_spawn')
}

/**
 * 注册闭环编排的三个工具（工具**定义**来自 `modules/orchestrator.ts`）。
 *
 * ⚠ 只有三个：`dispatch`（派活并登记回传）+ `status`（看编排状态）+ `control`（停/恢复）。
 *   stop 与 resume 合成一个带 `action` 枚举的工具 —— **每个工具名都占白名单的一个位置**，
 *   两个反义动作不值得占两个名字。
 */
function registerOrchTools(ctx: any, orch: HobOrchestrator, log: (m: string) => void,
  createOrchTools: (...a: any[]) => any): void {
  const { dispatch, status, control } = createOrchTools(orch)
  ctx.effect(() => ctx.tools.register(dispatch), 'dsh-hob preset: hob_dispatch tool')
  ctx.effect(() => ctx.tools.register(status), 'dsh-hob preset: hob_orch_status tool')
  ctx.effect(() => ctx.tools.register(control), 'dsh-hob preset: hob_orch_control tool')
  log('已注册 hob_dispatch / hob_orch_status / hob_orch_control')
}
