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
import { BUS_SERVICE, createHobBusTools, type HobBus } from '../modules/bus.ts'

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
  denyInheritedTools(ctx, log)

  // ⚠ **收敛机制的挂载点：直接在 preset scope 上**（不在门禁回调内）—— 见 apply 头部注释。
  //   两处都只认**本 scope**（ctx 即 preset 作用域），因此不影响其它预设；
  //   资源仍走 `ctx.effect`（卸载自动清理，§3.3 第 3 条）。
  //   ⚠ 用**外层 ctx**（不是门禁子 ctx）：门禁消失时收敛**必须留下**，否则就是本批要修的倒挂。
  filterModelToolList(ctx, log)
  enforceToolAllowlist(ctx, log)

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
    //   （`dsh-agent-preset-registry/lib/index.js:485` 的 `ctx.inject(["settings"], (child) => child.effect(...))`）。
    //   子 ctx 继承依赖 API 且**拥有它自己创建的注册** ⇒ 门禁消失时这些注册随之拆除，
    //   不用手写卸载逻辑（§3.3 第 3 条：资源靠 ctx.effect 挂，卸载自动清理）。
    registerTools(gatedCtx, config, log)
  })

  // ── M3 · 会话总线工具（UD-77）────────────────────────────────────────
  // ⚠ **与门禁无关**、单独的**反应式**订阅：`hobBus` 由 `modules/bus.ts` 在
  //   `sessions`/`agents` 就绪后 provide。服务不在（模块关掉 / 服务未就绪）⇒
  //   回调不跑 ⇒ **这两个工具根本不出现**（而不是出现后报错）。
  //   ⇒ 关掉 `modules.bus` 只影响 M3 自己，与「模块可独立启停」一致（§3.3）。
  ctx.inject([BUS_SERVICE], (busCtx: any) => {
    const bus = busCtx[BUS_SERVICE] ?? busCtx.get?.(BUS_SERVICE)
    if (bus === undefined) {
      log('hobBus 已就绪但不可用（跳过 M3 工具注册）')
      return
    }
    log('会话总线就绪 ⇒ 注册 M3 工具')
    registerBusTools(busCtx, bus as HobBus, log)
  })
}

/**
 * 屏蔽**继承来的**越界工具（{@link DEFAULT_DENY} + 配置追加）。
 *
 * ⚠ 为什么需要：`dsh-interconnect` 的四个工具是它自己的 bundle patch 作为
 *   **宿主平面行**声明的，会被**每个 agent 继承** —— 只靠"预设不挂它"**摘不掉**
 *   （实测：不摘时助手会多出 4 个）。收敛要靠**允许清单**思维（§6.3）。
 */
function denyInheritedTools(ctx: any, log: (m: string) => void): void {
  // ⚠ 原先此处还拼接 `config.denyTools ?? []`；该配置键已在阶段 E2 **删除**（无 patch 声明 ⇒ 恒空）。
  //   deny 名单现在**就是** `DEFAULT_DENY`（行为与删键前完全一致：删前它恒为 `[]`）。
  const deny = [...DEFAULT_DENY]
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
 * 「助手」**发给模型的**工具清单 —— **装配期白名单**（**25** 个显式名字）。
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
  // ── 批 9 / S3：只读看工作区文件 4 个（需 `tool-fs` + `tool-fs-search`）─
  'read',
  'glob',
  'grep',
  'read_image',
  // ── 批 11 / D2：向用户提问 1 个（需 `tool-ask-user` 指名增行）──────────
  // ⚠ 用户裁定 UD-68 / CHG-015：「允许 Hob 提问，但**尽量不问** —— 按项目方案主线
  //   决策推进，除非只能由用户决策才可以提问」。契约里已就地追加「决策自主」条文
  //   （见 `preset-dsh-hob.patch.yml` 的 `Decide on your own.` 一段），
  //   本条只是把"能问"这个**手段**接上；它不是"要多问"的授权。
  // ⚠ **只限本预设（Hob）**：`Hob-Execute` 侧的 `WORK_MODEL_DENY` 仍禁该工具，
  //   **一个字未动**（UD-64 的禁弹窗纪律对实施侧继续生效）。
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
]

/**
 * 保留的传输名（PTC 模式的 `run_code`）。
 *
 * ⚠ **必须显式放行**：ptc 模式下 `wireSchemas()` 只返回 `run_code` 一个
 *   （`dsh-tools/lib/index.js:2840-2843`）。若白名单把它滤掉，助手会拿到**空清单**
 *   —— 那是比"多几个工具"严重得多的回归（会话直接失去全部能力）。
 *   native 模式下它**根本不存在**（`view()` 只在 mode !== native 时加它），
 *   故 native 下清单仍**恰好 25**（批 14 / M3 起；批 13 为 23、批 11 为 21、批 9 为 20）。实测判据见阶段 C 报告 C3-1。
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
 * @param ctx - **本预设作用域**的 ctx（`apply` 的入参，即**外层** ctx）。
 *   ⚠ **不是**门禁子 ctx，也**不**随 `modules.tools` 开关消失 —— 见 `apply` 头部
 *   「F1 修正的行为倒挂」一节：收敛机制**必须留下**，否则关掉门禁反而放权。
 * @param log - 诊断输出。
 */
function filterModelToolList(ctx: any, log: (m: string) => void): void {
  const allow = new Set<string>(MODEL_TOOL_ALLOWLIST)

  // ⚠ 走**反应式** `ctx.inject`（不是本模块的静态 `inject`）：
  //   静态 inject 缺依赖 ⇒ fiber 停 PENDING ⇒ 预设被标 `broken`
  //   ⇒ **在选择器里被静默过滤掉**（同本文件头部 E-21 的教训）。
  //   反应式注入在依赖缺席时只是**不跑回调** ⇒ 预设照常可用、宿主零告警。
  ctx.inject(['systemPrompt'], (spCtx: any) => {
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

/**
 * 执行路径拦截：让 {@link MODEL_TOOL_ALLOWLIST} **拿不到**，而不只是**看不见**。
 *
 * ── 为什么需要 ─────────────────────────────────────────────────────
 * 阶段 C 实测：装配期过滤只改"发给模型的清单"，**执行路径不看清单** ——
 * 绕过清单直接点名，被滤掉的工具**照常执行**（`taskboard_list`/`list_agents` 都成功了）。
 * 根因：`dsh-tools/lib/index.js:2995` 的 `get()` 读 `view(scope).visible`，与模型清单无关。
 *
 * ── 机制依据（为什么挂这里）──────────────────────────────────────────
 *   · 宿主**官方** waterfall 事件：`dsh-tools/lib/types/index.d.ts:47`
 *     `'tools/pre-execute'(exec, next): Promise<PreToolDecision>`，可返回 `{kind:'deny'}`；
 *   · 派发点按 **agent scope** 过滤：`dsh-tools/lib/index.js:3224`
 *     `const carrier = scopeTarget(this, exec.agent)` —— 类型注释亦明写
 *     "agent-scoped listeners receive only that agent's calls"；
 *   · 宿主先例：`dsh-experimental-auto-review/lib/index.js:462`
 *     `ctx.on("tools/pre-execute", async (exec, next) => …)`（真机 profile 正装此 bundle）。
 *
 * ── ⚠⚠ 失败方向：宿主这里是 **fail-CLOSED**，所以本函数**必须自己兜住一切异常** ──
 *   实测（阶段 D）：监听器**抛异常**时，`dsh-tools/lib/index.js:3267` 的 catch 把异常变成
 *   `toolErrorResult` ⇒ 工具**不执行**（连 `read_contracts` 都失败）。
 *   ⇒ 本拦截器**不是**安全边界，而是收敛措施：**把「助手」弄瘫比漏一个工具更糟**。
 *   故：任何异常 / 不认识的 exec 形状 / 非本名单的名字 ⇒ **一律 `next()` 放行**。
 *
 * @param ctx - **本预设作用域**的 ctx（`apply` 的入参，即**外层** ctx）。
 *   ⚠ **不是**门禁子 ctx，也**不**随 `modules.tools` 开关消失 —— 见 `apply` 头部
 *   「F1 修正的行为倒挂」一节：关掉门禁时本拦截器**照常执行**（这正是那处修正的目的）。
 * @param log - 诊断输出（走 {@link makeDiag}：默认关、有磁盘上限，不新开日志）。
 */
function enforceToolAllowlist(ctx: any, log: (m: string) => void): void {
  const allow = new Set<string>(MODEL_TOOL_ALLOWLIST)

  ctx.effect(() => ctx.on('tools/pre-execute', async (exec: any, next: any) => {
    // ⚠ 整个判定体包在 try/catch 里：宿主对它自己的 catch 是 **fail-closed**，
    //   任何异常都会让**这次工具调用**失败（含白名单里的）。宁可放行。
    try {
      const name = exec?.name
      // ① 认识的、且在名单里 ⇒ 放行（门槛 4：不阻断白名单内的名字）。
      if (typeof name !== 'string') return await next()
      if (allow.has(name)) return await next()
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

  log('已挂执行路径拦截（' + MODEL_TOOL_ALLOWLIST.length + ' 个显式名字；名单外一律拒绝）')
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

/**
 * 注册 M3 的两个工具（定义在 `modules/bus.ts`，此处只挂载）。
 *
 * ⚠ 触发条件是 **`hobBus` 服务在**（= `modules.bus` 开着 且 `sessions`/`agents` 已就绪）。
 *   服务不在 ⇒ 本函数**根本不被调用** ⇒ 两个工具**不存在**，与"关掉模块只影响它自己"一致。
 *
 * ⚠ 与 `read_contracts`/`write_hob` 的**门禁不同源**：那两个跟 `hobTools`（= `modules.tools`），
 *   这两个跟 `hobBus`（= `modules.bus`）。⇒ 两个开关各自管自己那一组，互不牵连。
 */
function registerBusTools(ctx: any, bus: HobBus, log: (m: string) => void): void {
  const { sessions, send } = createHobBusTools(bus)
  ctx.effect(() => ctx.tools.register(sessions), 'dsh-hob preset: hob_sessions tool')
  ctx.effect(() => ctx.tools.register(send), 'dsh-hob preset: hob_send tool')
  log('已注册 hob_sessions / hob_send')
}
