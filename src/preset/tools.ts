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
 *   ① 突然多出 4 个 `interconnect_*` 工具（第三方插件 `dsh-interconnect` 的，屏蔽）；
 *   ② 突然拿到未被白名单放行的全部继承工具、且能直接执行任务看板/圆桌类工具（收敛）。
 *
 * ⚠ **F1 修正的行为倒挂**（阶段 E3 实测暴露）：这两处原先挂在 `ctx.inject([GATE_SERVICE])`
 *   回调内 ⇒ `modules.tools:false` 时**整段不执行** ⇒ 关掉门禁反而让助手
 *   从当时那个白名单**涨到**含能派活、能改工作状态的一大批（**具体名数以 `check:presets` 的判定为准**）——
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
  const serviceNameOf = (key: 'PERMISSION_SERVICE' | 'WORK_MODE_SERVICE' | 'SESSION_POLICY_SERVICE'): string | undefined => {
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
  /**
   * ⚠⚠ **2026-10-22 · `REQ-04`：档位不再是"实例级全局值"，而是"这个会话的策略"。**
   *
   * ── 改前 / 改后 ────────────────────────────────────────────────────
   *   · 改前：`levelOf()` 读入口 provide 的 `hobPermission`（= 全局 `config.permission.level`）
   *     ⇒ 一个全局值给**所有**会话用 ⇒ 改一次，所有已开会话在下一次 step 就跟着变（串线）。
   *   · 改后：`levelOf(session)` 读 `hobSessionPolicy` 服务（**按会话 id** 解析）。
   *     ⛔ 拿不到会话 / 拿不到服务 / 解析抛错 ⇒ **一律 `ledger`**（最低档，fail-closed）。
   *
   * ── ⚠ 为什么参数是 `session` 而不是"什么都不传" ───────────────────────
   *   四个闸门（装配过滤 / 预执行 / 哨兵 / execute）拿到的东西不一样：
   *   前三个有 `agent`（或装配 `context.agent`），第四个有 `exec.agent.session`。
   *   ⇒ 统一成"传 `session`（可为 `undefined`）"，由本函数做**唯一**解析。
   *   ⛔ 不许任何调用方"没 session 就退回全局值" —— 那正是要取消的串线路径。
   *
   * ── ⚠ 为什么保留 `permissionServiceName` 的强依赖检查（上面那段 throw）──────
   *   它现在**不再是档位来源**，但仍是两条既有契约的一部分：
   *   ① 机检 G-11 钉着"`PERMISSION_SERVICE` 缺席 ⇒ throw"（⛔ 本轮不改判据）；
   *   ② 老实例/老组合的具体行为不该在本轮被悄悄改变。
   *   ⇒ 保留该检查；它**不参与**档位判定。真正的判定看下面的 `policyOf()`。
   */
  const sessionPolicyName = serviceNameOf('SESSION_POLICY_SERVICE')

  /** 取会话策略服务（⛔ 不缓存实例；服务可能随重挂载换掉）。 */
  const policyService = (): any => {
    if (sessionPolicyName === undefined) return undefined
    try {
      return (ctx.get?.(sessionPolicyName) ?? ctx[sessionPolicyName]) as any
    } catch {
      return undefined
    }
  }

  /** 会话 → 策略解析（**唯一**入口；异常/缺服务 ⇒ 最低档）。 */
  const policyOf = (sessionOrAgent: any): { level: string; workMode: string; source: string; mayProceed: boolean } => {
    const floor = {
      level: 'ledger', workMode: workModeFace.DEFAULT_WORK_MODE, source: 'no-policy-service',
      // ⚠ 服务缺席时不拦（保持既有行为：老组合照样能用，只是按最低档）
      mayProceed: true,
    }
    /**
     * ⚠ 入参**可以是 Agent 也可以是 Session**（四个闸门拿到的东西不同）：
     *   `exec.agent` / `context.agent` 是 **Agent**，`exec.agent.session` 是 **Session**。
     *   ⇒ 这里统一归一成 Session（有 `.session` 就往下取一层），
     *     ⛔ 不让每个调用点各写一遍"我该传哪个"（那必然漂）。
     */
    const session = (() => {
      try {
        if (sessionOrAgent === null || sessionOrAgent === undefined) return undefined
        return sessionOrAgent.session ?? sessionOrAgent
      } catch { return undefined }
    })()
    try {
      const svc = policyService()
      if (typeof svc?.of !== 'function') return floor
      const r = svc.of(session)
      const lv = typeof r?.level === 'string' && (configFace.PERMISSION_LEVELS as readonly string[]).includes(r.level)
        ? r.level : 'ledger'
      const wm = typeof r?.workMode === 'string' && (workModeFace.WORK_MODE_VALUES as readonly string[]).includes(r.workMode)
        ? r.workMode : workModeFace.DEFAULT_WORK_MODE
      /**
       * ⚠⚠ **`mayProceed` 的方向改了**（2026-10-22 第 5 轮 · 任务书第 12 条点名）。
       *
       * ── 改前（第 4 轮）写的是什么、为什么是错的 ────────────────────────
       *   `typeof r?.mayProceed === 'boolean' ? r.mayProceed : true`
       *   ——"字段缺失就默认可推进"。
       *   ⚠ 后果：**服务在、但那份读数没有这个字段**（版本错配 / 实现被替换 / 半升级）
       *     时，旧会话会被当成"可以推进"，而它的原工作方式**根本没被确认**。
       *     那正是本批要消灭的形态：**拿不可信的值去派活**。
       *   ⚠ 我当时给的理由是"反过来会让每次版本不匹配都停摆" —— 但那是**拿事故换事故**：
       *     停摆是可读的、可恢复的；静默改写旧会话的工作方式是不可逆的。
       *
       * ── 现在：**只有明确说"可以"才放行**（fail-closed）──────────────────
       *   · `mayProceed === true` ⇒ 放行；
       *   · `false` / 缺席 / 非布尔 ⇒ **一律视为不可推进**（`mayProceed=false`）。
       *   ⚠ 例外只有一处：**服务整个缺席**（`floor`）——那是老组合的兼容面，
       *     此时走的是 `floor` 分支（下面 catch / 无服务），仍按既有行为
       *     （最低档 + 不拦）。⚠ 区别要看清：**"没有这个服务"** 与
       *     **"有服务但读数不可信"** 是两件事，处理方向相反。
       */
      const mayProceed = r?.mayProceed === true
      return { level: lv, workMode: wm, source: String(r?.source ?? 'unknown'), mayProceed }
    } catch {
      return floor
    }
  }

  /**
   * **现读**某个会话的可读档（⚠ 每次调用现取，⛔ 不是快照）。
   *
   * @param session - 该会话；`undefined` ⇒ 最低档（⛔ 不看全局值）。
   */
  const levelOf = (session: any): string => {
    const r = policyOf(session)
    if (r.level === 'ledger' && warnedNoPermissionService === false && r.source === 'no-policy-service') {
      warnedNoPermissionService = true
      const why = `⚠ 逐会话策略服务 "${sessionPolicyName ?? '(未导出)'}" 当前**没有被 provide**`
        + ' ⇒ 本预设按"最保守档 ledger"工作（fail-closed）：读文档 / 读工作区文件那几项会**看不见**。'
        + ' ⛔ 这不是"权限没配"，是"这一轮取不到策略权威"。'
      try { ctx.logger?.warn?.(`[dsh-hob preset] ${why}`) } catch { /* 忽略 */ }
      diag(`[dsh-hob preset] ${why}`)
    }
    return r.level
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
  const modeOf = (session: any = undefined): WorkMode => {
    try {
      return policyOf(session).workMode as WorkMode
    } catch {
      return workModeFace.DEFAULT_WORK_MODE
    }
  }

  /**
   * ⭐ **执行层"能不能推进"闸门**（2026-10-22 第 5 轮 · 任务书第 12 条）。
   *
   * ── 为什么需要它（Hob 源读数点出的两条）────────────────────────────────
   *   ① `mayProceed=false` 上一轮**只注入提示词**：模型照样可以强行点名
   *      `write_hob` / `hob_spawn` / `hob_send` ⇒ 提示词不是边界；
   *   ② `policyOf` 对"缺服务 / 缺字段"**默认 true** ⇒ 不可信的读数被当成"可推进"。
   *   ⇒ 现在两者都收口到**这一个函数**：动作为"改变项目"类工具在 `execute` 里调它。
   *
   * ── 判决（⚠ 按"能不能证明可以"排，⛔ 不按"默认放行"排）──────────────
   *   · 非 Hob（含认不出预设）⇒ **放行**：本机制不参与别人（保留既有行为）。
   *     ⚠ 这里**故意**放行：如果我连"Hob 与否"都判不出就拦，
   *       那会把**普通标准会话**一起打死 —— 那是比不拦更严重的回归。
   *   · Hob + `mayProceed === true` ⇒ 放行。
   *   · Hob + 其余 ⇒ **拒**，并在理由里点明是哪一档（`unknown-legacy` / 失败 / 服务缺席）。
   *
   * ⚠⚠ **2026-10-24 · 判据口径变了，但闸门保留**（用户裁定 1(a)）：
   *   改前 `derived-default`（新建 Hob、还没选可读档/工作方式）回 `mayProceed=false`
   *   ⇒ 本函数把 `hob_spawn` / `hob_send` / 建 standard 实施会话**全拒** ⇒ **死锁**
   *     （用户想干活，但没有任何工具能先把它"选起来"）。
   *   ⇒ 裁决：**这类新会话允许推进**（`session-policy.ts` 的 `derived-default` 支改 `mayProceed=true`）
   *     —— ⚠ 但它的**读档仍然是最低档 `ledger`**，所以这里**不需要也不允许**再按档位放行：
   *     本函数只看 `mayProceed`，⛔ 不再加"档位够宽才放行"这类判据（那会把"没选档"变成"必须选宽档"）。
   *   ⚠ **闸门本身不能删**：它仍然是"判不出 / 旧会话迁移未完成 / 归档 / 隔离 / pending"
   *     这些情形的执行层边界 —— 那些支的 `mayProceed` 仍然是 `false`（一个字没动）。
   *
   * @returns `undefined` = 放行；字符串 = 拒绝理由。
   */
  const proceedGateFor = (session: any): string | undefined => {
    const subject = (() => {
      try { return session?.session ?? session } catch { return undefined }
    })()
    let verdict: ReturnType<typeof policyOf>
    try {
      verdict = policyOf(subject)
    } catch (e) {
      // ⚠ 判不出 ⇒ 若这本来就是非 Hob 语境就没关系；但**判不出就是判不出**，
      //   不能假装"是普通会话"。⇒ 拒绝并说清（这是边界，fail-closed）。
      return `拒绝：无法判定本会话的策略（${String((e as Error)?.message ?? e)}）`
        + ' ⇒ 本次**不执行**（⛔ 不拿不可信的方式去改项目）'
    }
    // ⚠ 非 Hob：本机制不参与 ⇒ 放行（保留既有行为）
    if (verdict.source === 'non-hob') return undefined
    // ⚠ 服务整体缺席（floor）：老组合兼容面 ⇒ 放行（⚠ 与"有服务但读数不可信"方向相反）
    if (verdict.source === 'no-policy-service') return undefined
    if (verdict.mayProceed === true) return undefined
    /**
     * ⚠ **拒绝文案要覆盖所有 `mayProceed=false` 的来源**（2026-10-24 订正）：
     *   改前只写"旧 Hob 会话，迁移未完成或快照取不到" —— 但 `derived-default`
     *   （新会话未选档）已经改为放行，剩下的 `false` 来源其实是：
     *   `unknown-legacy`（旧会话无快照 / 创建时刻判不出）、`store-unreadable` /
     *   `version-unknown`、`quarantined`、`pending-activation`、`archived` /
     *   `archive-unknown`、`no-identity`。
     *   ⇒ 文案改成"按读数来源分述"，⛔ 不再把所有情形都说成"旧会话"（那会误导用户）。
     *   ⚠ 判决逻辑一个字没改（仍然只看 `mayProceed`）。
     */
    const why = ((): string => {
      switch (verdict.source) {
        case 'unknown-legacy': return '旧 Hob 会话的工作方式**无法确定**（迁移未完成 / 取不到切换快照 / 判不出创建时刻）'
        case 'store-unreadable':
        case 'version-unknown': return '策略文件**读不出来或结构版本不认识**，无法确定本会话的工作方式'
        case 'quarantined': return '本会话的策略记录**已被隔离作废**（创建失败兜底留下的残留）'
        case 'pending-activation': return '本会话的策略**尚未确认生效**（写在盘上了但没走完确认）'
        case 'archived': return '本会话**已被宿主持久归档**'
        case 'archive-unknown': return '**读不到宿主的归档状态**，无法证明本会话没被归档'
        case 'no-identity': return '**取不到可信的会话身份**，无法确定本会话的工作方式'
        case 'bad-record': return '本会话的策略记录**字段非法**（按不存在处理）'
        default: return `本会话的策略读数不可信（source=\`${verdict.source}\`）`
      }
    })()
    return `拒绝：${why}`
      + ' ⇒ 本次**不执行**任何改变项目的动作。'
      + '\n  ⚠ 可以做的：**只读**诊断（`hob_sessions` / `hob_workspaces` / `hob_read_doc` / `hob_glob` / `hob_grep` / `hob_read_image` / `hob_orch_status`）。'
      + '\n  ⚠ 为什么：给一个"没确认的方式"去派活，等于静默改写原工作方式（⛔ 不接受"日志里写了未保全"）。'
      + '\n  ⚠ 注：新建会话在**还没选**可读档 / 工作方式时**不在**本拒绝之列（那类会话可以派活，读档按最低档）。'
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

  /**
   * ⭐ **门禁状态：三态，⛔ 不是布尔**（2026-10-24 · 治「白名单与注册面脱钩」的消费侧）。
   *
   * ── 它治的确切形态（真功能缺口，不是风格）───────────────────────────
   *   `modules.tools = false` ⇒ 本模块**不加载** ⇒ 门禁 `hobTools` 不存在 ⇒
   *   下面的 `ctx.inject([GATE_SERVICE], …)` 回调**不跑** ⇒
   *   `read_contracts` / `write_hob` / `hob_read_doc` / `hob_glob` / `hob_grep` /
   *   `hob_read_image` **一个都没注册**。
   *   ⚠ 但收敛机制（装配期白名单 + 执行前拦截 + 哨兵）**挂在门禁外面**（刻意的：
   *     关掉门禁不许放权），它们只读 `PERMISSION_TIERS` —— 那张表**不知道注册面在不在**
   *   ⇒ 模型面出现"看得见、点一下 `unknown tool`"的那几个名字。
   *
   * ── ⚠⚠ 为什么必须是**三态**（2026-10-24 订正；一版曾用布尔，被 SP-10 咬出来）──────
   *   一版把"回调跑过"这一个布尔当成门禁状态，初值 `false`。而**测试/夹具的假壳**
   *   （`check:session-policy` 的 SP-10、`check:config-face`、`host-probe`）只 mock 了
   *   自己关心的那几条 `inject`，**不会** mock 一个 `hobTools` 服务 ⇒ 那个布尔恒 `false`
   *   ⇒ 把**正常工作宿主**的工具面误减了几个名字 ⇒ SP-10 当场红。
   *   ⇒ 根因是"**判不出**"与"**确定没装**"被混成了一个值。三种状态必须分开：
   *
   *   | 判据 | 状态 | 处置 |
   *   |---|---|---|
   *   | 下面 `ctx.inject([GATE_SERVICE], …)` 回调**跑过** | `'ready'` | 原样返回（正常路径零变化） |
   *   | 从**插件入口配置**读到 `modules.tools === false` | `'absent'` | 减掉门禁拥有的那批名字（**这才是本单要修的形态**） |
   *   | 两者都判不出（假壳 / 旧缓存 / 无 fiber 链） | `'unknown'` | **原样返回** + 一条 warn（fail-open 于"能力面"） |
   *
   * ── 为什么"判不出"要 fail-open（⚠ 这里的方向与安全面相反，理由是判据不同）──────
   *   减名字是**收紧**动作：判不出就收紧会**误伤正常会话**（SP-10 就是活证据：
   *   一个正常宿主被削掉了它本来就该有的 `hob_glob` / `hob_read_doc`）。
   *   而真实的"门禁没装"由 `modules.tools=false` 这个**显式开关**决定 ⇒ 那是**可判的**，
   *   不需要靠"判不出"去兜。⇒ 判不出时**不收紧**，但**说出来**（warn，⛔ 不静默）。
   *   ⚠ 这**不是**「把 fail-open 做成恒 true」：明确关掉 `modules.tools` 时**仍然会减**
   *     （负向对拍见交付读数：把状态强制成 `'absent'` ⇒ 那批名字确实被减掉）。
   *
   * ── 为什么不用 `ctx.get(GATE_SERVICE) !== undefined` 判 "ready" ────────────
   *   ⚠ 它在「服务已 provide、但工具注册还没完成」那一瞬也是 `true` ⇒ 两种状态混起来。
   *   ⇒ `'ready'` **只认**"门禁回调真的跑过了"这一件事（下面 inject 里置位）。
   */
  type GateState = 'ready' | 'absent' | 'unknown'
  /**
   * `inject` 回调跑过 ⇒ `'ready'`（单调：一旦跑过就不再回退 —— 卸载会同时拆掉
   * 工具注册，此刻再收紧只会让**正在卸载的中间态**突然改模型面）。
   */
  let gateInjected = false
  /** 从入口配置读到的显式开关（`undefined` = 判不出）。 */
  const entryToolsSwitch = ((): boolean | undefined => {
    const readEntry = (toolsFace as unknown as Record<string, unknown>).pluginEntryConfigOf
    const readSwitches = (configFace as unknown as Record<string, unknown>).moduleSwitches
    if (typeof readEntry !== 'function' || typeof readSwitches !== 'function') return undefined
    try {
      const cfg = (readEntry as (c: any) => unknown)(ctx)
      if (cfg === undefined || cfg === null) return undefined
      const sw = (readSwitches as (c: unknown) => { tools?: unknown })(cfg)
      return typeof sw?.tools === 'boolean' ? sw.tools : undefined
    } catch { return undefined }
  })()
  /** 判据顺序：运行期事实 → 装配期显式开关 → 判不出。 */
  const gateState = (): GateState => (gateInjected ? 'ready' : (entryToolsSwitch === false ? 'absent' : 'unknown'))

  /**
   * **该档对模型可见的工具名**（⚠ 唯一的口径收口点，所有消费处都过这里）。
   *
   * 语义（由 `modules/tools.ts` 的 `visibleToolsFor` 定义，⛔ 不在这里重写一份）：
   *   · `'ready'` / `'unknown'` ⇒ **原样返回**（前者正常路径；后者判不出不收紧，见上）；
   *   · `'absent'` ⇒ 只减掉**门禁自己拥有的那批名字**
   *     （名数以 `GATE_OWNED_TOOL_NAMES` 为准，⛔ 不在此写死数量），
   *     其余（编排/台账/检索）**一个不动**。
   * ⚠ 命名空间取用 + 运行时取值（`G-11` 钉着：本文件禁具名值导入）。
   * ⚠ `visibleToolsFor` 在旧缓存里缺席 ⇒ **原样返回**（= 既有行为），并降级说一句。
   */
  let warnedGateUnknown = false
  const visibleNamesFor = (names: readonly string[]): readonly string[] => {
    const fn = (toolsFace as unknown as Record<string, unknown>).visibleToolsFor
    if (typeof fn !== 'function') {
      degrade('visibleToolsFor', '`modules/tools.ts` 没有 `visibleToolsFor()` 导出（旧缓存？）'
        + ' ⇒ 工具名**按原样**下发（⚠ 关掉 `modules.tools` 时模型仍可能看见调不到的名字）')
      return names
    }
    const st = gateState()
    if (st === 'unknown' && !warnedGateUnknown) {
      warnedGateUnknown = true
      /**
       * ⚠ 这条 warn **是判据的一部分**（任务书要求"判不出 ⇒ 原样返回 + 一条 warn"）：
       *   它让"我们没判出门禁状态"这件事**可见**，而不是让工具面悄悄宽一点。
       */
      degrade('gate-state-unknown',
        '判不出工具门禁状态（既没跑过 `hobTools` 注入回调，也从插件入口配置读不到 `modules.tools`）'
        + ' ⇒ 工具名**按原样**下发（⚠ 若 `modules.tools` 实际关着，模型可能看见调不到的名字）')
    }
    /**
     * ⚠⚠ **传的是"门禁是否在场"，⛔ 不是"是否 ready"**：
     *   `visibleToolsFor(names, gatePresent)` 的第二参语义是「**门禁在 ⇒ 原样返回**」。
     *   ⇒ `'absent'`（明确关掉）才是唯一该减的状态；`'ready'` 与 `'unknown'` 都必须视为"在场"
     *     （后者是"判不出不收紧"，见上）。
     *   ⚠ 我第一版这里写成 `st === 'ready'` —— 于是 `'unknown'` 被当成"不在场"而**照减**，
     *     与上面那条 warn 的承诺（"按原样下发"）**自相矛盾**，被 SP-10 当场咬出来。
     *     ⇒ 判据只有一处：`st !== 'absent'`。
     */
    return (fn as (n: readonly string[], g: boolean) => readonly string[])(names, st !== 'absent')
  }

  // ⚠ **收敛机制的挂载点：直接在 preset scope 上**（不在门禁回调内）—— 见 apply 头部注释。
  //   两处都只认**本 scope**（ctx 即 preset 作用域），因此不影响其它预设；
  //   资源仍走 `ctx.effect`（卸载自动清理，§3.3 第 3 条）。
  //   ⚠ 用**外层 ctx**（不是门禁子 ctx）：门禁消失时收敛**必须留下**，否则就是本批要修的倒挂。
  //   ⚠ 2026-10-24：三处都多收一个 `visibleNamesFor`（= 名字集口径的唯一收口点）。
  filterModelToolList(ctx, levelOf, log, visibleNamesFor)
  enforceToolAllowlist(ctx, levelOf, log, visibleNamesFor)
  installPermissionGuard(ctx, levelOf, log, visibleNamesFor)

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
    injectWorkMode(ctx, modeOf, policyOf, log)
  }

  log('apply 完成权限边界与收敛；等待门禁 ' + GATE_SERVICE)

  /**
   * 反应式依赖：门禁（= `modules.tools` 模块）就绪时才注册工具。
   * 门禁不在 ⇒ 回调**不执行** ⇒ 助手退化为"无自定义工具"，但**预设不 broken**。
   *
   * ⚠ 门禁现在**只管工具注册**：收敛（模型面白名单 + 执行前拦截）已在上面挂好，
   *   不随门禁的在场与否改变。
   */
  /**
   * ⚠⚠ **`ORCH_SERVICE` / `createHobOrchTools` 声明必须早于门禁回调**（2026-10-24）。
   *
   * ── 为什么前移（这是"靠宿主偶然时序成立"的那个脆点）────────────────────
   *   门禁回调里 `registerTools(..., ORCH_SERVICE, ...)` 要用这两个名字，而它们原先
   *   声明在**门禁 inject 之后**。当前 cordis 的 `inject()` 一定是**异步**开始 apply 的
   *   （`Fiber._reload()` 首句就是 `await Promise.resolve()`，见
   *   `@deepseek-ai/cordis/lib/index.js:1349-1357`）⇒ 今天不会撞 TDZ。
   *   ⚠ 但那是**宿主的实现细节**，⛔ 不该成为我们正确性的前提：换个宿主版本/别的
   *     调度器若变成同步执行 apply，这里就会 `ReferenceError: Cannot access
   *     'ORCH_SERVICE' before initialization` —— 而且会炸在**订阅回调里**（半挂载）。
   *   ⇒ 纯**声明前移**（语义零变化：两者都只在 `apply` 里被读），把这个前提去掉。
   *   ⚠ 对应的 `degrade` 判定**留在原处**（它是"取不到就降级"的处置，与声明位置无关）。
   */
  const ORCH_SERVICE = orchFace.ORCH_SERVICE
  const createHobOrchTools = orchFace.createHobOrchTools

  ctx.inject([GATE_SERVICE], (gatedCtx: any) => {
    /**
     * ⚠⚠ **置位"门禁真的就绪"**（2026-10-24）—— 唯一可信的来源。
     *   ⚠ 只在这里置：本回调跑起来 ⇒ 服务已 provide **且** 我们要立刻注册工具。
     *   ⛔ 不用 `ctx.get(GATE_SERVICE) !== undefined` 判：那在"服务在、注册未完成"
     *     那一瞬也是真，两种状态会混（见 `apply` 里 `gateReady` 的注释）。
     *   ⚠ 置位**在注册之前**：`registerTools` 里 `tierNamesOf`/`proceedGateOf` 等
     *     会现读本值，置位后再注册才能保证"这一轮看到的名单 = 确实注册了的名单"。
     */
    gateInjected = true
    log('门禁就绪 ⇒ 注册工具')
    // ⚠ 用**回调给的子 ctx**注册（不是外层 ctx）：这是宿主的既有用法
    //   （`dsh-agent-preset-registry/lib/index.js` 里
    //   `ctx.inject(["settings"], (child) => {` 那一段 —— ⚠ 按**符号锚**定位，⛔ 别按行号）。
    //   子 ctx 继承依赖 API 且**拥有它自己创建的注册** ⇒ 门禁消失时这些注册随之拆除，
    //   不用手写卸载逻辑（§3.3 第 3 条：资源靠 ctx.effect 挂，卸载自动清理）。
    registerTools(gatedCtx, config, levelOf, proceedGateFor, log, ORCH_SERVICE, createHobTools, visibleNamesFor)
  })

  // ── M3 · 会话总线工具（UD-77）────────────────────────────────────────
  // ⚠ **与门禁无关**、单独的**反应式**订阅：`hobBus` 由 `modules/bus.ts` 在
  //   `sessions`/`agents` 就绪后 provide。服务不在（模块关掉 / 服务未就绪）⇒
  //   回调不跑 ⇒ **这两个工具根本不出现**（而不是出现后报错）。
  //   ⇒ 关掉 `modules.bus` 只影响 M3 自己，与「模块可独立启停」一致（§3.3）。
  //
  // ⚠⚠ **`BUS_SERVICE` 与 `createHobBusTools` 也是"缺一个就拖垮整块"的具名导出**
  //   （`TASK-D`①）⇒ 改成**运行时**取。取不到的处置：**可降级**（少掉 M3 的那几个工具，
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
      registerBusTools(busCtx, bus as HobBus, log, config, createHobBusTools, ledgerRootOf, proceedGateFor,
        /**
         * ⚠⚠ **T2（B5）：每次 `hob_*` 读写顺手对账**（2026-10-20）。
         *   ⚠ 用 `busCtx.get('hobOrchestrator')` **现取**（⛔ 不在这里 inject 它 ——
         *     那会把 M3 的可用性绑到 M5 上；M5 关掉时 `hob_send` 仍要能用）。
         *   ⚠ 取不到 ⇒ 什么都不做（⛔ 不报错：对账是附加观测，不是投递的前置条件）。
         *   ⚠ **不 await**：对账是后台对平，⛔ 不许拖慢投递本身。
         */
        () => {
          try {
            const orchSvc: any = busCtx.get?.('hobOrchestrator')
            if (orchSvc !== undefined && typeof orchSvc.reconcile === 'function') {
              void Promise.resolve(orchSvc.reconcile('hob-tool')).catch(() => { /* 对账失败不影响投递 */ })
            }
          } catch { /* 取不到就是不装 M5 ⇒ 没账可对 */ }
        })
    })
  }

  // ── M5 · 闭环编排工具（UD-80 · 批 17）────────────────────────────────
  // ⚠ 同 M3 的反应式订阅纪律：`hobOrchestrator` 由 `modules/orchestrator.ts` 在
  //   `sessions`/`agents` 就绪后 provide。服务不在（`modules.orch` 关掉 / 未就绪）
  //   ⇒ 回调不跑 ⇒ **三个编排工具根本不出现**。
  //   ⇒ 关掉 `modules.orch` 只影响 M5 自己：**会话总线仍在**（手工投递路不受影响）。
  // ⚠⚠ 与 M3 同款：`ORCH_SERVICE` / `createHobOrchTools` 改为**运行时**取，取不到即降级。
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
      registerOrchTools(orchCtx, orch as HobOrchestrator, log, createHobOrchTools, proceedGateFor)
    })
  }
}

/**
 * 屏蔽**继承来的**越界工具（{@link DEFAULT_DENY} + 配置追加）。
 *
 * ⚠ 为什么需要：`dsh-interconnect`（**第三方插件**，与本项目已退场的自研跨实例投递无关）的四个工具是它自己的 bundle patch 作为
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
 * 「助手」**发给模型的**工具清单 —— **装配期白名单**（**档1 的显式名字表**（⚠ 名数以 `check:presets` 的判定为准）；
 *   三档的名字集见 {@link PERMISSION_TIERS}，**逐档名数以 `check:presets` 的判定为准**）。
 *
 * ── 为什么是这些 ────────────────────────────────────────────────────
 * 「助手」只干这几件事：**读项目文档 / 读工作区文件 / 写自己的账本**、
 * **查资料**、**打开网页取正文**、**只读查询看板与圆桌**、**安排自己的定时提醒**、
 * **在只有用户能定时向用户提问**、**按需加载技能指引**、**把产出挂成交付卡**。
 * 于是清单（**以下全部为实测**：逐项 `grep` + `MODEL_TOOL_ALLOWLIST.length`）：
 *   · **既有 11 个** = 本插件 2（`read_contracts` / `write_hob`）
 *                    + 检索 5 + 定时 4（`schedule_*`）                          = 11
 *   · **批 9 新增 5 个** = `taskboard_list` / `taskboard_get` / `taskboard_comments`
 *                        + `roundtable_status`[P15 已删] + `web_fetch`              = 16
 *   · **批 11 / 13 新增 3 个** = `ask_user_question` + `skill` + `present`     = 19
 *   · **批 14 新增 2 个** = `hob_sessions` / `hob_send`                         = 21
 *   · **批 16 新增 2 个** = `hob_workspaces` / `hob_spawn`                      = 23
 *   · **批 17 新增 3 个** = `hob_dispatch` / `hob_orch_status` / `hob_orch_control` = **26**
 *   · **P15 删除 1 个** = `roundtable_status`（本机无提供方，调用即 `unknown tool`） = **25**。
 *
 * ⚠⚠ **订正说明（2026-10-21 · 第 337 轮 · 丙-7）**：本条原写作一串从 11 加到 **30** 的加法链，
 *   并声称「批 9 新增 **9** = 20 … 批 16 新增 **2 = 27** … 批 17 新增 **3 = 30**」。
 *   ⚠ **实测真值是 26**（`MODEL_TOOL_ALLOWLIST.length === 26`）。原链有两处错：
 *     ① **批 9 实际新增 5 个**（不是 9）—— 而且 `hob_read_doc` / `hob_glob` / `hob_grep` /
 *        `hob_read_image` **本就不在档1**（它们是档2/档3 的增量）⇒ 原链把"档位增量"
 *        算进了"本清单"；
 *     ② 累加到 **30** 之后**没有纠正** —— 而 **30 恰好是 `workspace` 档的数**
 *        （`PERMISSION_TIERS.workspace.length`），**不是本清单（= `ledger` 档）的数**。
 *   ⚠ 现在的口径（全实测）：本清单 **26** · `project` **27** · `workspace` **30**。
 *     ⚠ **逐档名数一律以 `check:presets` 的判定为准**（那是唯一的实测来源）。
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
  /**
   * ══════════════════════════════════════════════════════════════════════
   * ⚠⚠ **丙-6（2026-10-21 · 第 339 轮）：这 4 个定时工具**已从白名单删除**
   * ══════════════════════════════════════════════════════════════════════
   *
   * ── 定性（**实测**，不是推断）──────────────────────────────────────────
   *   ① 白名单曾列 `schedule_create` / `schedule_list` / `schedule_update` / `schedule_delete` 这四个；
   *   ② **本预设的声明面零命中** —— `preset/dsh-hob/preset-dsh-hob.patch.yml` 里
   *      `grep schedule` = **0**；
   *   ③ 本预设地基 = `dsh-web-app/presets/minimal.patch.yml`，而那份里
   *      只有 `tool-fs` **一行**工具面，**没有 `tool-schedule`**（`grep` = 0）；
   *   ④ 宿主 preset **不支持 `extends`**（`PROJECT.md` §4.3 / F-C3）⇒ 本预设
   *      **不会**从 standard / full 那类预设里继承到 `tool-schedule`；
   *   ⑤ 提供方是 `@deepseek-ai/dsh-tool-schedule`（dsh 主包直接依赖，
   *      `package.json:80`；装配 id = `tool-schedule`，见
   *      `dsh-web-app/presets/cordis.patch.yml:38-39`）—— **它不在本预设的装配面上**。
   *
   *   ⇒ **定性 = 模型面多余**：这几个名字被放行，但作用域里**根本没有注册**，
   *     调用只会得到 `unknown tool`（`E-86` 的"与门"缺一半）。
   *     ⚠ 这是白名单**比实际能力宽**，与"声明面漏行"方向相反 ——
   *     两种定性修法相反，本批按实测的那一种做：**删名字**。
   *
   * ── 代价（如实）─────────────────────────────────────────────────────
   *   ⚠ 名数按实测（**P15 删 `roundtable_status` 后**）：`ledger` **21** · `project` **22** · `workspace` **25**（**以 `check:presets` 的判定为准**）。
   *   ⚠ 受影响的断言（本批已全部跑过）：`P-1`（名数口径）、`⑤h`、`⑤m-3b`、`⑦`、`⑧`。
   *   ⚠ **能力面没有缩水** —— 那几个工具**本来就用不了**；删掉的只是"看起来能用"的假象。
   */
  // ── 批 9 / S1：编排**只读查询** 4 个（声明面零增量，已在继承面）─────
  'taskboard_list',
  'taskboard_get',
  'taskboard_comments',
  // ⚠⚠ **2026-10-30 P15：`roundtable_status` 已删** —— 它在本机**没有提供方**
  //   （`dsh-plugin-roundtable` 包在磁盘上，但**不在 profile 的 bundles / dependencies 里**
  //   ⇒ 宿主不加载它 ⇒ 该名字在模型面里根本不存在，调用即 `unknown tool`）。
  //   ⚠ 这正是 `Q8` 咬过的"白名单比实际能力宽"那类。⚠ 本轮顺手核过"有没有别的同类"：
  //   **只剩它一个**（其余 21 名要么是宿主 100 名里真实存在的，要么是本插件自注册的）。
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
 * **档位只管「可读范围」的那批名字**（2026-10-30 P14 · 用户裁定）。
 *
 * ── 用户原话（⛔ 不许改语义）────────────────────────────────────────
 *   「把当前项目自己的工具和其他工具做区分，**档位以及工作推进方式权限控制都是通过当前项目的
 *     工具去控制的不影响其他工具**」
 *   「**档位一直都只是控制 HOB 预设的可读操作权限啊**」
 *
 * ── 结论（这条常量就是那句话的机械形态）────────────────────────────
 *   `PERMISSION_TIERS` 从今往后**只**描述"这一档能读到哪里"：
 *     · `hob_read_doc`（项目内 `.md`）—— 档 2 起；
 *     · `hob_glob` / `hob_grep` / `hob_read_image`（目录/文本/图片）—— 档 3 才有。
 *   ⚠ 其余工具（编排七件、台账两件、检索、网络、`ask_user_question`…）**与档位无关**：
 *     它们的可达性由 deny 清单决定，⛔ 不再由档位开关。
 *
 * ── 为什么单列这张表而不是"档3 − 档1"───────────────────────────────
 *   "档3 − 档1" 在**将来**某档多加一个非读名字时会**静默把那个名字也算成读范围**
 *   （于是被判成"低档看不见"）。⇒ 读范围必须**指名**，⛔ 不许派生。
 *   机检 ⑤n-1 拿它与"档3 − 档1"做**双向点验**，两边一旦漂开就红。
 */
export const READ_SCOPED_TOOLS: readonly string[] = [
  'hob_read_doc',
  'hob_glob',
  'hob_grep',
  'hob_read_image',
]

/**
 * 一个工具名在**某一档**的模型面判决（**纯函数**，⛔ 不读任何全局状态）。
 *
 * ── 判决顺序（顺序本身是语义的一部分）────────────────────────────────
 *   ① 保留传输名 `run_code` ⇒ 留（滤掉它助手会彻底失去能力）；
 *   ② 在 deny 清单里 ⇒ **摘**（这是**唯一**的能力边界）；
 *   ③ 是**读范围**名字 ⇒ 看这一档有没有它（档位只管这一件）；
 *   ④ 其余 ⇒ **留**（默认放开），并标注"是否见过"。
 *
 * ── ⭐ 第 ④ 条的 `unseen` 就是"没见过的工具不静默放行"────────────────
 *   ⚠ 语义取**主流 `ask` 去掉交互形态**：**照常放行**（用户要的"新装插件自动可用"），
 *     但**必须留下一条待确认记录**并让它**可见**（调用方 `degrade('unseen-tool', …)` 一次一名）。
 *   ⛔ 不静默 = 有记录 + 报告里说出来；⛔ 不是"拦下来"（那就退回白名单了）。
 *
 * @param name - 工具名
 * @param level - 当前会话档位（`ledger` / `project` / `workspace`）
 * @param deny - deny 清单（与 `src/modules/tools.ts` 的 `DEFAULT_DENY` 同一份，由调用方传入）
 * @param known - 认识的名字（{@link MODEL_TOOL_ALLOWLIST} ∪ deny 清单；⚠ 其余一律算"没见过"）
 * @returns `{ keep, unseen, why }`；`why` 只用于日志/报告，⛔ 不参与判定
 */
export function decideToolFace(
  name: string,
  level: string,
  deny: readonly string[],
  known: readonly string[],
): { keep: boolean; unseen: boolean; why: string } {
  if (name === RESERVED_TRANSPORT_TOOL) return { keep: true, unseen: false, why: 'reserved-transport' }
  if (deny.includes(name)) return { keep: false, unseen: false, why: 'deny' }
  const tier = PERMISSION_TIERS[level as 'ledger' | 'project' | 'workspace'] ?? PERMISSION_TIERS.ledger
  if (READ_SCOPED_TOOLS.includes(name)) {
    return tier.includes(name)
      ? { keep: true, unseen: false, why: 'read-scope:in-tier' }
      : { keep: false, unseen: false, why: 'read-scope:out-of-tier' }
  }
  return { keep: true, unseen: !known.includes(name), why: 'default-open' }
}

/**
 * "见过"的名字 = 白名单 ∪ deny 清单 —— 判"没见过"用的**唯一**口径。
 *
 * ⚠⚠ **必须是函数、⛔ 不许做成模块顶层常量**：`toolsFace` 是命名空间导入，
 *   在**本模块求值的那一刻** `DEFAULT_DENY` 可能还没就绪（实测：顶层算出来是 **0 名**，
 *   于是 `bash` 之类会被误判成"没见过"）。⇒ 每次现读（O(1) 级别，调用点在装配/执行热路径上也不心疼）。
 */
function knownToolNames(): readonly string[] { return [...MODEL_TOOL_ALLOWLIST, ...DEFAULT_DENY_OF()] }

/** deny 清单（⚠ 唯一来源 = `src/modules/tools.ts`，⛔ 不在这里抄第二份）。 */
function DEFAULT_DENY_OF(): readonly string[] {
  return ((toolsFace as unknown as Record<string, unknown>).DEFAULT_DENY as readonly string[] | undefined) ?? []
}

/** ⚠ 仅供机检读取"当前进程看到的 deny 清单"（⛔ 产品路径不用它判任何事）。 */
export function __denyOf(): readonly string[] { return DEFAULT_DENY_OF() }

/** 已报过的"没见过"名字（⚠ 每名只报一次，⛔ 不刷屏）。 */
const UNSEEN_SEEN = new Set<string>()

/** 装配期/执行期共用的"没见过"记录落点（⚠ 模块层只留一份，⛔ 两处各写一遍）。 */
function reportUnseen(names: readonly string[]): void {
  const fresh = names.filter((n) => !UNSEEN_SEEN.has(n))
  if (fresh.length === 0) return
  for (const n of fresh) UNSEEN_SEEN.add(n)
  DEGRADED_CAPABILITIES.push({ key: 'unseen-tool',
    why: `模型面里出现了 ${fresh.length} 个**没见过的工具**（不在白名单、也不在 deny 清单）：`
    + fresh.map((n) => `"${n}"`).join(' / ')
    + ' ⇒ ⚠ **已按"默认放开"放行**（用户裁定：新装插件自动可用），'
    + ' ⛔ 但这不是"我确认过它安全" —— 是**待确认**。'
    + ' ↳ 处置：属命令/写/组队/改共享状态类 ⇒ 加进 `DEFAULT_DENY`；确认放行 ⇒ 加进 `MODEL_TOOL_ALLOWLIST`。' })
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
/**
 * 注入「推进工作方式」的口径。
 *
 * ⚠ 2026-10-22 第 4 轮：多收一个 `policyOf` —— 因为**只有它能回答 `mayProceed`**。
 *   ⚠ `modeOf()` 只回档位字符串，不知道"能不能推进"；用它来判会漏掉**暂停**那一档。
 *   ⛔ 不要把它并进 `modeOf` 的返回值（那会改一个被多处按字符串使用的契约）。
 */
function injectWorkMode(
  ctx: any,
  modeOf: (sessionOrAgent?: any) => WorkMode,
  policyOf: (sessionOrAgent?: any) => { level: string; workMode: string; source: string; mayProceed?: boolean },
  log: (m: string) => void,
): void {
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
    const textNow = (context?: any): string => {
      // ⚠ 运行时读（⛔ 不是模块顶层快照 `workModeInstruction`）—— 见文件头那段注释：
      //   这四个名字也可能在旧缓存里缺席。`apply` 已在挂载前用 `wmOk` 判过一轮，
      //   这里再取一次是因为**装配发生在很久以后**（`apply` 与装配之间可能隔着重载）。
      //
      // ⚠⚠ **2026-10-22 · `REQ-04`：这里开始按会话取工作方式。**
      //   宿主的 `resolveContext()` 会把**装配 context**（含 `agent`）作为参数传进来
      //   （`dsh-system-prompt/lib/index.js:184-190` 的 `entry.text(context)`），
      //   `refreshContext(assembly, context)` 同理（`:324-341`）⇒ 身份就在入参里。
      //   ⚠ 拿不到 context ⇒ `modeOf(undefined)` ⇒ 策略服务的保守值（⛔ 不是旧全局值）。
      try {
        const subject = context?.agent ?? context?.scope
        /**
         * ⚠⚠ **`mayProceed=false` ⇒ 必须先停下，⛔ 不许给出"按某种方式推进"的口径**
         * （2026-10-22 第 4 轮 · 任务书原文："要么暂停本次推进，要么用固定的原值快照"）。
         *
         * ── 为什么这条必须在这里、而不只是"读数里带个字段"──────────────
         *   读到 `mayProceed=false` 却仍然注入"请按 auto 自行判断怎么推进"这段话，
         *   等于**照样让模型去推进**，只是我们在日志里写了句"未保全"——
         *   那正是任务书点名**不接受**的形态。
         *   ⇒ 这里直接换成**暂停说明**：告诉模型不要推进、并说清原因。
         *   ⚠ 这段文字**不是**"工作方式口径"，所以⛔ 不拼 `workModeRedLine()` 之外的东西
         *     （避免模型把它当成又一个 mode）。
         */
        const verdict = policyOf(subject)
        if (verdict.mayProceed === false) {
          return '## 本轮**暂停推进**（本会话的工作方式/策略读数不可信）\n\n'
            + '⚠ 本会话此时**不能确定**该按哪种工作方式推进（旧会话迁移未完成 / 策略文件读不出 /'
            + ' 已被隔离或归档 / 策略尚未确认生效 —— 具体原因见工具返回值）。\n'
            + '⚠ 为避免把原来的 `multi`/`single` 静默改成 `auto`，**本轮不要推进项目**：\n'
            + '- 不要拆解任务、不要派活、不要按任何"工作方式"去规划；\n'
            + '- 可以先做**只读**的信息收集，或向用户说明情况并请其稍后重试。\n\n'
            + '（这条与"权限档"无关：读档仍按最低档执行。）\n'
            + '（⚠ 新建会话在**还没选**可读档 / 工作方式时**不会**走这一段 —— 那类会话可以推进，读档按最低档。）'
        }
        return workModeFace.workModeInstruction(verdict.workMode as WorkMode) + workModeFace.workModeRedLine()
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
function filterModelToolList(
  ctx: any,
  levelOf: (sessionOrAgent?: any) => string,
  log: (m: string) => void,
  /**
   * ⚠ 2026-10-24：名字集的**唯一收口点**（见 `apply` 里的 `visibleNamesFor`）。
   *   缺省 = 原样返回，只为兼容直接调用本函数的旧测试/旧路径（⛔ 产品路径一定传它）。
   */
  visibleNamesFor: (names: readonly string[]) => readonly string[] = (n) => n,
): void {
  // ⚠ **⛔ 不许在这里建 Set 快照**（2026-10-14 第 144 轮修的点）：
  //   旧版写 `const allow = new Set(MODEL_TOOL_ALLOWLIST)` —— 那是**装配期快照**，
  //   用户改完档位后**已开的会话仍按旧档**走到重挂载为止。
  //   ⚠ 2026-10-22 起档位**按会话**（`REQ-04`）⇒ 快照的危害升级成"跨会话串线"，更要现读。
  const allowFor = (subject: any): Set<string> => {
    const level = levelOf(subject)
    const names = PERMISSION_TIERS[level as 'ledger' | 'project' | 'workspace'] ?? PERMISSION_TIERS.ledger
    /**
     * ⚠⚠ **2026-10-24：必须过 `visibleNamesFor`**（否则 `modules.tools` 关掉时
     *   模型面白名单里仍有那 6 个**没注册**的名字 ⇒ 看得见、点一下 `unknown tool`）。
     *   ⚠ 语义仍由 `modules/tools.ts` 的 `visibleToolsFor` 定义：
     *     门禁在 ⇒ **原样返回**（本行对正常路径零影响）；门禁不在 ⇒ 只减门禁拥有的 6 个。
     */
    return new Set<string>(visibleNamesFor(names))
  }

  // ⚠ 走**反应式** `ctx.inject`（不是本模块的静态 `inject`）：
  //   静态 inject 缺依赖 ⇒ fiber 停 PENDING ⇒ 预设被标 `broken`
  //   ⇒ **在选择器里被静默过滤掉**（同本文件头部 E-21 的教训）。
  //   反应式注入在依赖缺席时只是**不跑回调** ⇒ 预设照常可用、宿主零告警。
  ctx.inject(['systemPrompt'], (spCtx: any) => {
    /**
     * ⚠⚠ **2026-10-22 · `REQ-04`：第二个形参从 `_context` 改名为 `context` 并真正使用。**
     *   宿主每步调 `assembleContextFor(agent, signal)` = `{ agent, scope: agent, signal }`
     *   （`dsh-agent/lib/index.js:291-297`）⇒ **身份就在这个形参里**，改前一直没接。
     *   ⚠ 拿不到 `context`（例如老宿主不传 / 别处直接调 `assemble()`）
     *     ⇒ 传 `undefined` ⇒ `levelOf(undefined)` ⇒ **最低档**（fail-closed，⛔ 不看全局值）。
     */
    const handler = async (assembly: any, context: any, next: any): Promise<any> => {
      // ⚠ 必须**先 `await next()`** 再过滤：后面的监听器可能还会往清单里加东西。
      const assembled = await next()
      const all: any[] = Array.isArray(assembled?.tools) ? assembled.tools : []
      // ⚠ 现读档位发生在**这一步**（每次装配）—— 这是"改档位不必重启"的落点。
      const subject = context?.agent ?? context?.scope
      const level = levelOf(subject)
      /**
       * ⚠⚠ **2026-10-30 P14：白名单 ⇒ 默认放开 + deny 清单 + 读范围。**
       *   用户裁定：**档位只管可读范围**，工具面与档位无关；工具面**默认放开**（新装插件自动可用），
       *   靠 `DEFAULT_DENY` 那张 deny 清单收。
       *   ⭐ 而"**没见过的工具**"**不静默放行** —— 照常放行，但逐名留一条待确认记录（见 {@link decideToolFace}）。
       */
      const kept: any[] = []
      const unseen: string[] = []
      const dropped: string[] = []
      for (const t of all) {
        const name = String(t?.name ?? '')
        const v = decideToolFace(name, level, DEFAULT_DENY_OF(), knownToolNames())
        /**
         * ⚠⚠ **第三道：门禁缺席时，门禁拥有的那批名字要从模型面摘掉**（2026-10-30 P14 保持原行为）。
         *   理由与"档位"无关 —— 那是**注册面**的事：`modules.tools:false` ⇒ 那批工具**根本没注册**，
         *   留在清单里就是"看得见、点一下 `unknown tool`"。
         *   ⚠ 判据仍走**同一个收口点** `visibleNamesFor`（⛔ 不在这里另判 `gateState`）。
         */
        const gateOk = v.keep && visibleNamesFor([name]).length > 0
        if (gateOk) {
          kept.push(t)
          if (v.unseen) unseen.push(name)
        } else dropped.push(name)
      }
      if (unseen.length > 0) reportUnseen(unseen)
      if (kept.length !== all.length || unseen.length > 0) {
        log(`装配期工具面（档=${level}）：模型面 ${all.length} ⇒ ${kept.length}`
          + `（摘掉 ${dropped.length}：${dropped.join(', ') || '无'}）`
          + `（没见过而放行 ${unseen.length}：${unseen.join(', ') || '无'}）`)
      }
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
function enforceToolAllowlist(
  ctx: any,
  levelOf: (sessionOrAgent?: any) => string,
  log: (m: string) => void,
  /** ⚠ 2026-10-24：同 `filterModelToolList` 的 `visibleNamesFor`（唯一收口点）。 */
  visibleNamesFor: (names: readonly string[]) => readonly string[] = (n) => n,
): void {
  // ⚠ 同上：**⛔ 不许快照**。执行期也要按**当次**档位判 ——
  //   否则"档2 会话调用档3 才有的名字"会被旧快照放行（或反向误拒）。
  //   ⚠ 2026-10-22 起档位**按会话**（`REQ-04`）：主体 = `exec.agent`。
  const allowFor = (subject: any): Set<string> => {
    const level = levelOf(subject)
    const names = PERMISSION_TIERS[level as 'ledger' | 'project' | 'workspace'] ?? PERMISSION_TIERS.ledger
    /**
     * ⚠⚠ **2026-10-24：执行前拦截也过同一层。**
     *   理由不是"让调用失败得更早"，而是**两个口径必须一致**：
     *   模型面已经看不见门禁拥有的那批名字了，若这里仍按全量白名单放行，
     *   一旦有人在别处（subagent / 直调）拿到那些名字，本层就会**放行一个门禁不在时的
     *   `unknown tool`** —— 那不是安全边界，是**不一致**。
     *   ⚠ 门禁在的正常路径：`visibleToolsFor` 原样返回 ⇒ 本层行为**一个字节都没变**。
     */
    return new Set<string>(visibleNamesFor(names))
  }

  ctx.effect(() => ctx.on('tools/pre-execute', async (exec: any, next: any) => {
    // ⚠ 整个判定体包在 try/catch 里：宿主对它自己的 catch 是 **fail-closed**，
    //   任何异常都会让**这次工具调用**失败（含白名单里的）。宁可放行。
    try {
      const name = exec?.name
      if (typeof name !== 'string') return await next()
      // ⚠ 2026-10-22：判定主体 = `exec.agent`（宿主每条工具调用都带，见
      //   `dsh-agent-loop/lib/index.js:509-518`）。⚠ **没有 agent ⇒ 最低档**。
      const subject = exec?.agent
      const level = levelOf(subject)
      /**
       * ⚠⚠ **2026-10-30 P14：执行期与装配期用同一个纯函数判决**（{@link decideToolFace}）。
       *   改前是"在白名单里 ⇒ 放行，否则 deny"，改后是"在 deny 清单里 ⇒ 拒；读范围外 ⇒ 拒；
       *   其余 ⇒ 放行"。两处**必须同源**，否则会出现"看不见却调得动"（旧批的反面）。
       */
      const v = decideToolFace(name, level, DEFAULT_DENY_OF(), knownToolNames())
      if (v.keep) {
        // ⚠ 与装配期同一道门：门禁缺席 ⇒ 门禁拥有的名字不可调用（否则就是"清单外放行"）。
        if (visibleNamesFor([name]).length === 0) return { kind: 'deny', reason: `"${name}" is unavailable: the tools gate is off in this session.`, info: { name: 'ToolDeniedError', code: 'TOOL_NOT_ALLOWED' } }
        if (v.unseen) reportUnseen([name])
        return await next()
      }
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

function installPermissionGuard(
  ctx: any,
  levelOf: (sessionOrAgent?: any) => string,
  log: (m: string) => void,
  /** ⚠ 2026-10-24：同 `filterModelToolList` 的 `visibleNamesFor`（唯一收口点）。 */
  visibleNamesFor: (names: readonly string[]) => readonly string[] = (n) => n,
): void {
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
      //
      // ⚠⚠ **2026-10-22 · `REQ-04`：主体改为 `exec.agent`（按会话判）。**
      //   ⚠ 没有 agent ⇒ `levelOf(undefined)` ⇒ **最低档**（fail-closed）。
      //   ⚠ 但**这一层不是唯一防线**：宿主在 `exec.agent === undefined` 时**根本不遍历
      //     scope 链**（`dsh-tools/lib/index.js:3024-3032`，`:3027` 是那句提前返回）
      //     ⇒ 那种调用路径下本哨兵**压根不会被调**。⇒ 四个读工具的 `execute`
      //     自己必须再核一次档位（见 `src/modules/tools.ts`；这是本轮 G-5 的落点）。
      const level = levelOf(exec?.agent)
      const tier = PERMISSION_TIERS[level as 'ledger' | 'project' | 'workspace'] ?? PERMISSION_TIERS.ledger
      /**
       * ⚠⚠ **2026-10-24：哨兵也过 `visibleNamesFor`**（三处口径必须同一份）。
       *   ⚠ 门禁在 ⇒ 原样返回 ⇒ 哨兵行为零变化；门禁不在 ⇒ 门禁拥有的那批名字由门禁负责的
       *     注册面本来就不存在，哨兵不该把它们算作"这一档可读"。
       */
      const names = visibleNamesFor(tier)
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
function registerTools(ctx: any, config: Config, levelOf: (sessionOrAgent?: any) => string,
  proceedGateFor: (sessionOrAgent?: any) => string | undefined, log: (m: string) => void,
  orchServiceName: string, createTools: (...a: any[]) => any,
  /**
   * ⚠ 2026-10-24：名字集收口点（`apply` 的 `visibleNamesFor`）。
   *   `tierNamesOf` 要用它 —— 否则 `write_hob` 的 tier 名核对会把门禁不在时
   *   **没注册**的那批名字报成"这一档可读"（名数以 `GATE_OWNED_TOOL_NAMES` 为准）。
   *   缺省 = 原样返回（兼容直接调用）。
   */
  visibleNamesFor: (names: readonly string[]) => readonly string[] = (n) => n): void {
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
    // ⚠ **现读档位**（不是快照）：⛔ 在 `createHobTools` 时读一次会让"改档位即生效"失效。
    //   ⚠⚠ **2026-10-22 · `REQ-04`：入参换成 `exec`** —— 档位现在**按会话**解析，
    //     而会话身份只存在于 `exec.agent` 里。`levelOf(exec?.agent)` 走**同一个**
    //     解析源（⛔ 不在这里另写一份判定）。拿不到 `exec` / `agent` ⇒ 最低档。
    levelOf: (exec?: any) => levelOf(exec?.agent ?? exec),
    /**
     * ⚠⚠ **执行层"能不能推进"闸门**（2026-10-22 第 5 轮 · 任务书第 12 条）。
     *   判据来自同一个 `policyOf`（唯一权威），⛔ 不另判一份：
     *   · 非 Hob ⇒ 放行（本机制不管别人）；
     *   · `mayProceed === true` ⇒ 放行；
     *   · 其余（false / 读数缺席 / 服务异常） ⇒ **拒绝并给可读理由**。
     *   ⚠ 这条**不依赖提示词**：模型强行点名 `write_hob` / `hob_spawn` / `hob_send`
     *     一样会被挡在这里（`execute` 内，晚于一切参数校验）。
     */
    proceedGateOf: (exec?: any) => proceedGateFor(exec?.agent ?? exec),
    // ⚠⚠ **该档的名字集**（2026-10-22 · `REQ-04`）：四个读工具的 `execute` 要用它做
    //   **本层读档门**（G-5）。⚠ 传**查表函数**而不是数组快照 —— 名字集是编译期常量、
    //   但传函数能保证"来源只有一处"（`PERMISSION_TIERS`，⛔ 不在模块层再抄一份）。
    //   ⚠ 非法档 / 查不到 ⇒ 空数组 ⇒ 什么都读不到（fail-closed）。
    tierNamesOf: (level: string) => {
      const t = (PERMISSION_TIERS as Record<string, readonly string[] | undefined>)[level]
      /**
       * ⚠⚠ **2026-10-24：也过 `visibleNamesFor`**（否则 `write_hob` 的 tier 名核对会把
       *   "门禁不在时根本没注册的那批名字"报成"这一档可读"⇒ 与模型面/拦截面不一致）。
       *   ⚠ 本函数由 `apply` 传入（`registerTools` 的 `deps`），见下面调用点的注释。
       */
      return Array.isArray(t) ? visibleNamesFor(t) : []
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
  createBusTools: (...a: any[]) => any, rootOf: (...a: any[]) => any,
  /** ⚠ 2026-10-22 第 5 轮：`hob_spawn` / `hob_send` 的执行层闸门（§任务书第 12 条）。 */
  proceedGateFor: (sessionOrAgent?: any) => string | undefined,
  /**
   * **T2 的挂点**（2026-10-20 · B5）：每次 `hob_*` 读写路径顺手对账一次。
   * ⚠ 缺省不传 ⇒ 不对账（旧调用形状**照旧可用**，向后兼容）。
   */
  onRead?: () => void): void {
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
  }, onRead, (exec: any) => proceedGateFor(exec?.agent ?? exec),
  /**
   * ⚠ 2026-10-22 第 5 轮：`hob_spawn` 显式给了两值 ⇒ **必须真写进去**。
   *   这里把策略服务的 `set` 透下去（⛔ 不让 bus 层自己去摸服务 —— 它拿不到同一份权威）。
   */
  (sessionId: string, level: string, workMode: string) => {
    try {
      // ⚠ 本函数在模块级（拿不到 `apply` 里的闭包）⇒ 按同文件既有纪律**每次现读**服务
      //   （⛔ 不缓存实例：服务可能随重挂载换掉）。
      //   ⚠ 服务名从 `config.ts` 的具名导出取（⛔ 不在这里写死字符串）。
      const name = (configFace as unknown as Record<string, unknown>).SESSION_POLICY_SERVICE
      const svc = typeof name === 'string' && name !== ''
        ? (ctx.get?.(name) ?? (ctx as any)[name])
        : undefined
      if (typeof svc?.set !== 'function') return { ok: false, reason: '逐会话策略服务缺席 ⇒ 两轴未落地' }
      return svc.set(sessionId, level, workMode)
    } catch (e) {
      return { ok: false, reason: `策略写入抛错：${String((e as Error)?.message ?? e)}` }
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
  createOrchTools: (...a: any[]) => any,
  /** ⚠ 2026-10-22 第 5 轮：`hob_dispatch` 的执行层闸门（§任务书第 12 条）。 */
  proceedGateFor: (sessionOrAgent?: any) => string | undefined): void {
  const { dispatch, status, control } = createOrchTools(orch, (exec: any) => proceedGateFor(exec?.agent ?? exec))
  ctx.effect(() => ctx.tools.register(dispatch), 'dsh-hob preset: hob_dispatch tool')
  ctx.effect(() => ctx.tools.register(status), 'dsh-hob preset: hob_orch_status tool')
  ctx.effect(() => ctx.tools.register(control), 'dsh-hob preset: hob_orch_control tool')
  log('已注册 hob_dispatch / hob_orch_status / hob_orch_control')
}
