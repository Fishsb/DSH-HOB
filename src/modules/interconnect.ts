/**
 * M6a · 跨实例投递（2026-10-16 第 237 轮 · `UD-119` 裁定 + `M6-PLAN.md` §1 候选 B）。
 *
 * ── 它解决什么 ────────────────────────────────────────────────────────────────
 *   ⚠ **M3 的投递只在本实例内**（`bus.ts:2`：「**同实例内**，把一条消息投递到另一个会话」）
 *   ⇒ ⚠ 要让"另一个 DSH 实例"干活，必须**另有一条到对端的通道** —— 这就是 M6a。
 *
 * ── 形态（⚠ 按裁定，⛔ 不自选别的路）────────────────────────────────────────────
 *   ⚠ **投递走宿主原生 `dsh headless`**（⚠ `M6-PLAN.md` §1 候选 B 实测过：
 *     「一次性进程 + stdout + `--json`」）⇒ ⚠ **⛔ 不写任何自研协议**。
 *
 * ── ⚠ ⚠ 四条硬边界（⚠ 逐条落实，⛔ 一条都不许放宽）────────────────────────────
 *   **① 对端须显式白名单** —— ⚠ 地址**只从配置的白名单来** ⇒ ⛔ **不做成"能写任意远端"**。
 *   **② 缺省关** —— ⚠ 它一旦转起来会**在无人看管时向别处投递**（⚠ 与 `orch` 同风险档）。
 *   **③ 可读权限控制对它同样生效** —— ⚠ 档位低时**⛔ 不提供本服务**（⚠ 见 `index.ts` 的登记条件）。
 *   **④ 失败每一类都可读** —— ⚠ 不可达 / 超时 / 非零退出 / stdout 缺字段 / 白名单不认 ⇒
 *     ⚠ **每类一句可读原因 + 一个明确的不成功标记**（⛔ **不许静默**）。
 *
 * ── ⚠ ⚠ 为什么**不**加一个面向模型的新工具（⚠ 边界 ③ 的裁定）────────────────────
 *   ⚠ 作业书 §2.2③ 的措辞是「**尽量⛔ 不加** —— 若必须加 ⇒ 那是唯一允许的外溢」。
 *   ⚠ ⚠ **本模块的结论是"不必加"**：⚠ 投递能力**作为一个服务**提供
 *     ⇒ ⚠ **⛔ 不动 `MODEL_TOOL_ALLOWLIST`、⛔ 不动三档白名单**
 *     ⇒ ⚠ ⚠ **`check:presets` 的逐档判据一行都不用改**（⚠ 这正好避开第 234 轮点名的第 ④ 处外溢）。
 *   ⚠ ⚠ **代价（⚠ 据实说清）**：⚠ 模型**不能直接调**它 ——
 *     ⚠ 要让它面向模型，需要**另一次放行**去加工具（⚠ 那时才动白名单三档）。
 *
 * ── ⚠ 本模块**不碰运行中的实例** ─────────────────────────────────────────────
 *   ⚠ 它**只 spawn 一个新的一次性进程**（`dsh --profile headless <task>`），
 *   ⛔ **不注入、⛔ 不重启、⛔ 不改**任何已在跑的实例。
 *
 * ── ⚠ 零第三方依赖（本仓纪律）+ ⚠ 不用 `console.*`（`src/**` 零 console 先例）──
 *   ⚠ 日志经传进来的 `log` 回调（与 `bus.ts` / `orchestrator.ts` 同款）。
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, resolve, sep } from 'node:path'

/** 一个对端（⚠ **只从配置来** —— ⛔ 不接受任意地址）。 */
export interface InterconnectTarget {
  /** 对端的短名（⚠ 投递时**显式点名**用它 —— 照 M3"显式点名、⛔ 不自动挑"的纪律）。 */
  name: string
  /**
   * ⚠ 对端要用的 DSH 启动器（可执行文件的绝对路径，或 PATH 里的名字）。
   * ⚠ 缺省 = **运行时解析**出来的宿主入口（⚠ 见 {@link resolveDefaultLauncher}；⛔ 不写死安装路径）。
   */
  launcher?: string
  /** ⚠ 对端的 profile 名（⚠ 缺省 `headless` —— ⚠ 那是宿主自带的"答一个任务就退"形态）。 */
  profile?: string
  /**
   * ⚠ 对端的**子命令**（⚠ 缺省 `headless`）。
   * ⚠ ⚠ **为什么必须显式带上它**：⚠ 实测（第 237 轮）本仓 `dsh` 的形态是
   *   `dsh --profile <p> [--patch <f>] **headless** [--json] <task>` ——
   *   ⚠ **`--json` 与任务串属于【子命令之后】** ⇒ ⚠ 漏掉子命令时它们会被当成**顶层参数**
   *   ⇒ ⚠ 对端报 `unknown option`（⚠ 本轮实测撞到过：⚠ 见报告 §3.4）。
   */
  subcommand?: string
  /** ⚠ 对端的工作目录（⚠ 必须是**绝对路径**；⚠ 缺省 = 调用时的 cwd）。 */
  cwd?: string
}

/** 投递结果（⚠ 每一类失败都有**可读原因** + 明确的成功标记）。 */
export interface DeliverRemoteResult {
  ok: boolean
  /** 机器可判的类别 —— ⚠ 与 `reason` 一起构成"可读且可判"的失败面。 */
  reason?: 'switch-off' | 'target-not-in-allowlist' | 'launcher-missing' | 'spawn-failed'
    | 'timeout' | 'nonzero-exit' | 'empty-stdout' | 'malformed-json' | 'ok'
    /**
     * ⚠ 2026-10-22 新增（`REQ-04`）：**本会话**的可读档不够（不是全局档不够）。
     * ⚠ 与 `switch-off` **分开**：那个是"模块开关关了"，这个是"这个会话只有账本档"。
     * ⚠ 两者**必须可分辨** —— 修法不同（改配置 vs 改该会话的档位）。
     */
    | 'session-level-too-low'
    /** ⚠ 2026-10-22 第 2 轮：**没有可信发起者**（无 initiator / 已销毁 / 无策略 / 策略坏）。 */
    | 'no-trusted-initiator'
  /** ⚠ 给人和模型看的一句话（⛔ 不许空着）。 */
  message: string
  /** 对端 stdout（⚠ 成功时是答案；⚠ 失败时原文保留，便于定位）。 */
  stdout?: string
  /** 对端 stderr（⚠ 失败时原文保留）。 */
  stderr?: string
  /** 退出码（⚠ 拿得到就给）。 */
  exitCode?: number
  /** ⚠ 对端 `--json` 事件（**解析成功才给**；⚠ 解析不了 ⇒ `malformed-json`）。 */
  events?: unknown[]
  /** 实际用了哪个对端（⚠ 点名用的那个）。 */
  target: string
  /**
   * ⚠ 准入拒因的**细分代码**（2026-10-22 第 2 轮）。
   *   `no-initiator` / `stale-session` / `no-policy` / `bad-policy` —— 拒；
   *   `level-too-low` —— 有身份但该会话档位不够。
   *   ⚠ 与 `reason` 并用：`reason` 是**族**（能不能投），本字段是**为什么**（该修哪）。
   */
  admissionCode?: string
  /** ⚠ 通过/被拒时涉及的**真实发起会话 id**（⚠ 取自执行归属，⛔ 不是调用方参数）。 */
  sessionId?: string
}

/**
 * 宿主启动器的**解析结果**。
 *
 * `path` 恒为绝对路径（**只有在真解析出来时才有值**）；`reason` 是**解析不出来时**
 * 的可读原因 —— 三者**必有其一**，⛔ 不会出现"既没路径也没原因"的静默空值。
 */
export interface LauncherResolution {
  /** 解析到的启动器绝对路径；解析不出 ⇒ `''`（⚠ 调用方据此走 `launcher-missing`）。 */
  path: string
  /** 解析不出来的一句话原因（成功时为空串）。 */
  reason: string
}

/**
 * 从**运行时**解析宿主启动器（⛔ **不写死任何安装路径**）。
 *
 * ── 为什么不能再写死（本函数存在的理由）──────────────────────────────
 *   ⚠ 原实现是 `'/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js'` ——
 *   ⚠ 那是**某一台机器**的安装落点（npm 全局 / 版本管理器 / 容器镜像各不相同）。
 *   ⇒ 换机后它要么**不存在**（对端起不来），要么碰巧存在但是**另一个版本**的入口。
 *
 * ── 解析顺序（⚠ 每一档都是"运行时事实"，⛔ 没有常量兜底）──────────────
 *   ① **本进程自己的入口**：`process.argv[1]` 解析成绝对路径后，若它就是
 *      `.../@deepseek-ai/dsh/lib/bin.js`（或同包内 bin），直接用它 ——
 *      这是"**我现在就跑在这个宿主上**"的**最硬证据**；
 *   ② ① 不是宿主入口（例如被别的东西启动 / 被测试夹具加载）⇒ 走**包解析**：
 *      从本模块解析 `@deepseek-ai/dsh/package.json`，取其 `bin` 字段指向的文件；
 *   ③ 都拿不到 ⇒ **不猜路径**，返回 `path: ''` + 一句**可读原因**。
 *
 * ⚠ ⚠ **为什么 ③ 不许"给个像是的路径"**：⚠ 走到一条不存在的路径时，
 *   失败会表现成 `spawn-failed`（"起不来"）—— ⚠ 而真实原因是"根本没解析出启动器"。
 *   ⇒ 保持 `launcher-missing` 这一族（⚠ 判据不放宽），且把**为什么**说清楚。
 *
 * ⚠ 本函数是**纯读**：不写文件、不改环境、不 spawn。可被机检直接 import 真跑。
 *
 * @param argv1 - 本进程入口（缺省取 `process.argv[1]`；可注入以便实测"解析不出"那一档）。
 * @param resolvePkg - 包解析器（缺省走 `createRequire`；可注入以便实测）。
 * @returns 绝对路径（成功）或空串 + 可读原因（失败）。
 */
export function resolveDefaultLauncher(
  argv1: string | undefined = process.argv[1],
  resolvePkg: (id: string) => string = (id) => createRequire(import.meta.url).resolve(id),
): LauncherResolution {
  // ── ① 本进程入口是不是宿主 bin ─────────────────────────────────────
  //   ⚠ 只认**能解析成真实文件**的那条；`argv[1]` 可能是 `dsh`（PATH 里的软链名，
  //     例如 `/usr/local/bin/dsh`）⇒ 用 realpath 之后再看它落在哪里。
  const entryReason = (() => {
    const raw = (argv1 ?? '').trim()
    if (raw === '') return '本进程没有 `process.argv[1]`'
    let abs: string
    try {
      abs = realpathSync(raw)
    } catch {
      return `本进程入口 \`${raw}\` 解析不到真实文件`
    }
    // 判据 = 它就在 @deepseek-ai/dsh 包里、且文件名是 bin.js（宿主 bin 的实测形态）。
    const marker = `${sep}@deepseek-ai${sep}dsh${sep}`
    if (abs.includes(marker) && /[\\/]bin\.js$/.test(abs) && existsSync(abs)) return { abs }
    return `本进程入口 \`${abs}\` 不是宿主 \`@deepseek-ai/dsh/lib/bin.js\``
  })()
  if (typeof entryReason !== 'string') return { path: entryReason.abs, reason: '' }

  // ── ② 包解析：`@deepseek-ai/dsh/package.json` 的 `bin.dsh` ────────────
  try {
    const pkgPath = resolvePkg('@deepseek-ai/dsh/package.json')
    const pkgDir = dirname(pkgPath)
    let binRel: unknown
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin?: unknown }
      const b = pkg.bin
      binRel = typeof b === 'string' ? b : (b !== null && typeof b === 'object' ? (b as Record<string, unknown>).dsh : undefined)
    } catch {
      binRel = undefined
    }
    if (typeof binRel === 'string' && binRel !== '') {
      const abs = resolve(pkgDir, binRel)
      if (existsSync(abs)) return { path: abs, reason: '' }
      return { path: '', reason: `${entryReason}；且 \`@deepseek-ai/dsh\` 的 \`bin\` 声明的 \`${abs}\` **不存在**` }
    }
    return {
      path: '',
      reason: `${entryReason}；且 \`@deepseek-ai/dsh/package.json\` 里读不到 \`bin\` 字段`
        + '（⇒ 无法确定入口文件，**不猜路径**）；请在对端配置里显式给 `launcher`',
    }
  } catch (e) {
    const code = (e as { code?: unknown })?.code
    return {
      path: '',
      reason: `${entryReason}；且解析 \`@deepseek-ai/dsh/package.json\` 失败`
        + `${typeof code === 'string' ? `（${code}）` : ''}`
        + '（⚠ 本插件跑在宿主进程外，或该包没装在可达位置）；请在对端配置里显式给 `launcher`',
    }
  }
}

/** ⚠ 只读用途：判断一个启动器路径像不像"node 脚本"（⚠ 决定要不要前面补 `node`）。 */
function looksLikeScript(p: string): boolean {
  return p.endsWith('.js') || p.endsWith('.mjs') || p.endsWith('.cjs')
}

/**
 * 一次投递的**准入判定结果**（判别联合 —— ⚠ 两种结果**不可互换**）。
 *
 * ── 为什么不是"返回一个档位字符串"（上一轮就是那样，本轮改掉）───────────
 *   字符串把三件事压成一个读数：
 *     · 有身份、档位够 ⇒ 放行；
 *     · 有身份、档位不够 ⇒ 拒（**改该会话的档**就能解决）；
 *     · 根本不知道是谁 ⇒ 拒（**接执行上下文**才能解决，改档没用）。
 *   ⇒ 后两者对读者的下一步指示**相反**。压成同一个 `'ledger'` 会让
 *     "身份链路没接上"表现成"你的权限太低"，把人指去修错的地方
 *     （与 `SS-a` 丙-2 同一条教训：两件事必须分开印）。
 */
export type Admission =
  | {
    ok: true
    /** 可信发起会话的 id（⚠ 取自宿主执行归属并回表核实过，⛔ 不是调用方自报）。 */
    sessionId: string
    /** 该会话自己的可读档（三档之一）。 */
    level: string
    /** 该会话是不是 Hob 会话（非 Hob 时本插件不做逐会话判定 —— 但仍须有身份）。 */
    isHob: boolean
    /** 策略来源（`stored` / `derived-default` / …；诊断用）。 */
    source: string
  }
  | {
    ok: false
    /** ⚠ 机器可判的拒因 —— 修法各不相同，⛔ 不许压成一句"被拒"。 */
    code: 'no-initiator' | 'stale-session' | 'no-policy' | 'bad-policy'
    /** 给人看的一句话（⛔ 不许空着）。 */
    detail: string
  }

/** 投递的运行时依赖（⚠ 由 `index.ts` 注入 —— ⚠ 与 `bus.ts` 的 `ledgerRootOf` 同款纪律）。 */
export interface InterconnectDeps {
  /**
   * ⚠ **现读**开关（⚠ ⛔ 不是快照）：⚠ 开关若在 `apply` 时读一次，
   *   ⚠ 用户改完**已装模块不会卸载** ⇒ ⚠ 表现成"改了没反应"（⚠ 与 `skeletonEnabled` 同条教训）。
   */
  enabledOf: () => boolean
  /** ⚠ **现读**白名单（⚠ 同上：⛔ 不缓存）。 */
  targetsOf: () => readonly InterconnectTarget[]
  /**
   * ⭐⭐ **投递准入：可信发起者 → 该会话策略**（2026-10-22 第 2 轮 · `REQ-04`/`REQ-05`）。
   *
   * ── 它取代了什么 ────────────────────────────────────────────────────
   *   上一轮的 `sessionLevelOf(sessionKey)` 收**调用方自报的字符串**作身份
   *   ⇒ 谁传谁算，传别人的 id 就能借用别人的权限。**那不是授权，是可伪造的声称。**
   *   ⇒ 现在本模块**不接受**任何身份参数：它只问一句"当前这次投递是谁发起的"，
   *     由入口用宿主的执行归属（`agents.currentInitiator()`，`AsyncLocalStorage`）回答。
   *
   * ── 返回值是**判别**，不是字符串 ─────────────────────────────────────
   *   · `{ ok: true, sessionId, level, isHob, source }` —— 有可信发起者且取到了档；
   *   · `{ ok: false, code, detail }` —— 拒，且 `code` **机器可判**：
   *     `no-initiator` / `stale-session` / `no-policy` / `bad-policy`。
   *   ⚠ 为什么不用"返回 `'ledger'` 表示拒"：那会把**两种完全不同的事**
   *     （"这个人只有账本档" vs "根本不知道是谁"）压成同一个读数，
   *     而它们的修法相反（前者去改该会话的档，后者去接执行上下文）。
   *     上一轮就是这么写的 —— 本轮改成判别类型，把两者**分开**。
   *
   * ⚠ 缺席 / 抛异常 / 形状不对 ⇒ 一律拒。**fail-closed**，⛔ 不退回全局宽档。
   */
  admissionOf?: () => Admission
  /**
   * ⚠ 上一轮留下的全局档读取口（**仅供诊断文案**使用，⛔ 不参与准入判定）。
   *
   * ── 为什么还留着 ────────────────────────────────────────────────────
   *   模块装载时那几行如实报告要说出"**装载层现在只看开关**"，否则读数会变成
   *   "档位=ledger 却装上了" —— 看着像 bug。留它只为把**声明**打清楚。
   *   ⛔ 任何 `deliverRemote` 的放行/拒绝分支都**不许**读它（判据挂
   *     `scripts/check-policy-cross-instance.mjs` 的负向对拍）。
   */
  diagnosticLevelOf?: () => string
  /** ⚠ 日志（⚠ 本模块不用 `console.*`）。 */
  log?: (m: string) => void
  /** ⚠ 超时毫秒（⚠ 缺省 {@link DEFAULT_TIMEOUT_MS}）。 */
  timeoutMs?: number
}

/** ⚠ 缺省超时：⚠ 一次性实例要起进程 + 跑一个任务 ⇒ **给宽一点**（⛔ 不是"越短越好"）。 */
export const DEFAULT_TIMEOUT_MS = 120_000

/**
 * ⚠ 在**白名单里**找一个对端（⚠ **显式点名** ⇒ ⛔ 不自动挑、⛔ 不模糊匹配）。
 *
 * @returns 找到就给那个 target；⚠ **不在白名单里 ⇒ `undefined`**（⚠ 由调用方报可读原因）。
 */
export function findTarget(targets: readonly InterconnectTarget[], name: string): InterconnectTarget | undefined {
  const want = name.trim()
  if (want === '') return undefined
  return targets.find((t) => t.name === want)
}

/**
 * ⚠ 投递一条任务到**白名单内的对端**（⚠ 起一个**一次性**的 `dsh headless` 进程）。
 *
 * ⚠ ⚠ **每一类失败都返回可读的 `reason` + `message`**（⚠ 边界 ④）：
 *   `switch-off` / `target-not-in-allowlist` / `launcher-missing` / `spawn-failed` /
 *   `timeout` / `nonzero-exit` / `empty-stdout` / `malformed-json`。
 *
 * @param deps - ⚠ 提供"现读"的开关与白名单（⛔ 本函数不自己读 config）。
 * @param name - ⚠ 对端短名（⚠ **必须显式点名**）。
 * @param task - ⚠ 要它干的活（⚠ 一句话；⚠ 会被当作**一个 argv** 传给对端）。
 * @param opts - ⚠ `json`：要不要对端给结构化事件（⚠ 缺省 `true`）。
 */
export function deliverRemote(
  deps: InterconnectDeps,
  name: string,
  task: string,
  /**
   * ⚠⚠ **这里刻意没有 `sessionKey`**（2026-10-22 第 2 轮）。
   *
   *   上一轮加过 `sessionKey?: string` —— 那是"调用方自报身份"，**可伪造**：
   *   传别人的 id 就借用别人的档位。本轮删掉它，改用宿主的执行归属
   *   （`deps.admissionOf()`，内部走 `agents.currentInitiator()` + `sessions.get()` 回表）。
   *   ⇒ 调用方**没有任何**参数可以声明"我是谁"。
   */
  opts: { json?: boolean; cwd?: string } = {},
): Promise<DeliverRemoteResult> {
  const target = name.trim()
  /** 通过准入后的真实发起会话（⚠ 只给日志用；⛔ 后续任何分支都不再据此放行）。 */
  let admittedSessionId = ''
  let admittedLevel = ''
  // ── ① 开关（⚠ 缺省关：⚠ 关着就**什么都不投**，但**要有可读输出**）────────────
  //   ⚠ 语义与文案**逐字未变**（既有断言 SS / host-probe 依赖它）。
  if (deps.enabledOf() !== true) {
    return Promise.resolve({
      ok: false, reason: 'switch-off', target,
      message: '跨实例投递**开关关闭** ⇒ ⛔ 未投递任何东西（⚠ 这是缺省状态；⚠ 要对端干活请在配置里显式打开）。',
    })
  }
  // ── ② 白名单（⚠ 地址只从配置来 ⇒ ⛔ 不接受任意远端）──────────────────────
  //   ⚠ 顺序：开关 → **白名单** → 身份 → 档位。
  //     把白名单放在身份之前，是为了让"地址写错了"这件事**先**被说出来 ——
  //     否则一个未接入执行上下文的调用会先撞"没身份"，把配置错误盖掉。
  //     ⚠ 这不叫放宽：白名单拒与身份拒**都是拒**，只是**谁先说**。
  const targets = deps.targetsOf()
  const found = findTarget(targets, target)
  if (found === undefined) {
    const known = targets.map((t) => t.name).join(' / ')
    return Promise.resolve({
      ok: false, reason: 'target-not-in-allowlist', target,
      message: `对端 \`${target}\` **不在白名单里** ⇒ ⛔ 拒绝投递。`
        + (known === '' ? '（⚠ 当前白名单**为空** —— 请先在配置里点名对端。）' : `（⚠ 白名单内可用：${known}）`),
    })
  }
  // ── ③ ⭐ 投递准入：**可信发起会话** → 该会话自己的策略 ────────────────────
  //   ⚠⚠ 这一层是本轮的核心：身份**不来自调用方参数**，来自宿主执行归属。
  //     上一轮收的是 `opts.sessionKey`（调用方自报）⇒ 传别人的 id 就能借用别人的权限。
  //     ⛔ 现在函数签名里**没有**任何身份参数 —— 想伪造也没有入口。
  //   ⚠ 顺序放在白名单之后、启动器之前：白名单/开关的既有文案逐字不变；
  //     而**未通过准入的调用绝不进入启动器解析与 spawn**（⛔ 不触发任何外部进程）。
  {
    let verdict: Admission
    try {
      verdict = deps.admissionOf?.() ?? {
        ok: false, code: 'no-policy',
        detail: '本模块没有拿到准入判定器（`admissionOf` 缺席）⇒ 无法确认发起者，按拒处理',
      }
    } catch (e) {
      verdict = { ok: false, code: 'no-policy', detail: `准入判定器抛错：${String((e as Error)?.message ?? e)}` }
    }
    if (verdict.ok !== true) {
      /**
       * ⚠ 每一档拒因都**单独成句**（⛔ 不许合并成"被拒"）——
       *   因为它们指向的修法不同：
       *     `no-initiator` ⇒ 这条调用路径压根没有 agent（定时器/外部脚本）：
       *                      要么改成从 agent 内发起，要么明确"这条路径不支持跨实例投递"；
       *     `stale-session`⇒ 发起者已销毁/派生残留：不该再用它的身份；
       *     `no-policy`    ⇒ 逐会话策略服务没就绪/没装：**先修链路**，不是调权限；
       *     `bad-policy`   ⇒ 策略形状坏了：查策略文件。
       *   ⚠ 四种都**不投递、不 spawn**。
       */
      const headline = verdict.code === 'no-initiator'
        ? '当前调用**没有可信发起会话**（无执行归属）'
        : verdict.code === 'stale-session'
          ? '发起会话**已不在活表里**（无法核实身份）'
          : verdict.code === 'no-policy'
            ? '**取不到**发起会话的逐会话策略'
            : '发起会话的策略**形状不对**'
      return Promise.resolve({
        ok: false, reason: 'no-trusted-initiator', target,
        message: `${headline} ⇒ ⛔ 未投递任何东西（⚠ 未启动任何对端进程）。`
          + `\n  拒因代码：\`${verdict.code}\``
          + `\n  详情：${verdict.detail}`
          + '\n  ⚠ 跨实例投递是"影响外部状态"的动作 ⇒ 判据是**发起者是谁**，'
          + '⛔ 不接受调用方自报身份，也⛔ 不退回全局宽档。',
        admissionCode: verdict.code,
      })
    }
    // 档位不够 ⇒ 拒。⚠ 与"没身份"**分开报**（修法不同：改这个会话的档 vs 接执行上下文）。
    if (verdict.level === 'ledger') {
      return Promise.resolve({
        ok: false, reason: 'session-level-too-low', target,
        /**
         * ⚠⚠ **可见文字必须用显示名，⛔ 不许出现内部配置值**（2026-10-22 第 3 轮纠错）。
         *
         * ── 改前这句错在哪 ─────────────────────────────────────────────────
         *   原文写「要放行请把该会话的读档提到**「项目」**或以上」——
         *   「项目」是 `config` 里的**内部档位值**（`project`），
         *   而设置页给用户看的名字是 **「文档权限」**（见 `config.ts:383` 的 description
         *   与 `modules/tools.ts:457` 的既有映射）。⇒ 用户照着这句话去设置页**找不到「项目」**。
         *
         * ⚠ 更糟的是它还**说反了方向**：`ledger` 之上最近的一档是 `project`
         *   （显示名「文档权限」），不是"项目"；而且"项目"在别处指的是**工作区/项目**，
         *   与可读档完全无关 —— 两个不相干的词撞在一起，读者只会更糊涂。
         *
         * ⇒ 现在按**既有显示名映射**写（与 `modules/tools.ts:457` 同口径），
         *   并且**两个能放的档都点名**，让用户知道"文档权限只到 .md"这层区别。
         */
        message: `发起会话 \`${verdict.sessionId}\` 的可读档是**「账本权限」** ⇒ ⛔ 未投递（⚠ 未启动任何对端进程）。`
          + '\n  ⚠ 这是**这个会话自己的**档位（不随全局设置变）；'
          + '要放行请把**该会话**的读档提到**「文档权限」**或**「完全权限」**。'
          + '\n  ⚠ 两档的区别：**「文档权限」只可读工作区的 .md**；**「完全权限」可读任意文件**。',
        admissionCode: 'level-too-low',
        sessionId: verdict.sessionId,
      })
    }
    // ⚠ 通过准入：把**实际的发起会话 id** 交给后续（⚠ 用于日志，⛔ 不参与再判定）
    admittedSessionId = verdict.sessionId
    admittedLevel = verdict.level
  }
  // ── ③ 启动器（⚠ 找不到 ⇒ 可读，⛔ 不静默；⛔ 不猜别的路径）──────────────
  //   ⚠ 缺省值**运行时解析**（⛔ 不写死安装路径，见 {@link resolveDefaultLauncher}）。
  //   ⚠ 解析不出时**落进同一族** `launcher-missing` —— ⛔ 不走到一条不存在的路径，
  //     且把"为什么解析不出"（`resolution.reason`）带进对外那句话里。
  const resolution = found.launcher === undefined ? resolveDefaultLauncher() : undefined
  const launcher = (found.launcher ?? resolution?.path ?? '').trim()
  if (launcher === '') {
    const why = resolution !== undefined && resolution.reason !== ''
      ? `（⚠ 缺省启动器**解析不出**：${resolution.reason}）`
      : ''
    return Promise.resolve({
      ok: false, reason: 'launcher-missing', target,
      message: `对端 \`${target}\` 的 \`launcher\` 为空${why} ⇒ ⛔ 未投递（⚠ 请给它一个可执行的启动器路径）。`,
    })
  }
  // ⚠ 绝对路径要先存在才用；⚠ PATH 里的名字（非绝对）交给宿主解析 —— ⚠ 两种都不猜。
  if (isAbsolute(launcher) && !existsSync(launcher)) {
    return Promise.resolve({
      ok: false, reason: 'launcher-missing', target,
      message: `对端 \`${target}\` 的启动器**不存在**：\`${launcher}\` ⇒ ⛔ 未投递（⛔ 不改试别的路径）。`,
    })
  }
  const profile = (found.profile ?? 'headless').trim() || 'headless'
  const sub = (found.subcommand ?? 'headless').trim() || 'headless'
  const cwd = resolve(opts.cwd ?? found.cwd ?? process.cwd())
  const wantJson = opts.json !== false
  // ⚠ ⚠ 参数表 = **实测**出来的宿主形态（⚠ 第 237 轮在隔离实例上跑通的那条）：
  //   `dsh --profile <p> [--patch <f>] <subcommand> [--json] <task>`
  //   ⚠ ⚠ **`--profile` 在顶层、`--json` 与任务串在【子命令之后】** ——
  //     两边各就各位（⚠ 错位的形态实测报 `unknown option`，⚠ 见报告 §3.4）。
  const topLevel = ['--profile', profile]
  const afterSub = [...(wantJson ? ['--json'] : []), task]
  const args = looksLikeScript(launcher)
    ? [launcher, ...topLevel, sub, ...afterSub]
    : [...topLevel, sub, ...afterSub]
  const bin = looksLikeScript(launcher) ? process.execPath : launcher

  deps.log?.(
    `[${name}] 投递到对端 \`${target}\`（profile=${profile} cwd=${cwd} json=${wantJson}`
    + ` · 发起会话=${admittedSessionId || '(未知)'} · 该会话档位=${admittedLevel || '(未知)'}）`,
  )

  return new Promise<DeliverRemoteResult>((done) => {
    execFile(bin, args, {
      cwd,
      timeout: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      // ⚠ 环境沿用本进程（⚠ ⛔ 不额外注入凭据；⚠ 对端自己那套配置说了算）。
    }, (err, stdout, stderr) => {
      const out = String(stdout ?? '')
      const errText = String(stderr ?? '')
      const code = (err as { code?: unknown } | null)?.code
      const killed = (err as { killed?: boolean; signal?: string } | null)?.killed === true
        || (err as { signal?: string } | null)?.signal === 'SIGTERM'
      // ── ④ 失败面逐类（⚠ 每类都**可读**，⛔ 不许静默）────────────────────
      if (err !== null && err !== undefined) {
        if (killed) {
          return done({
            ok: false, reason: 'timeout', target, stdout: out, stderr: errText,
            message: `对端 \`${target}\` **超时**（${deps.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms）⇒ ⛔ 未拿到结果`
              + `（⚠ 已终止该一次性进程；⚠ 对端的部分输出保留在 stdout/stderr 里）。`,
          })
        }
        const numeric = typeof code === 'number' ? code : undefined
        if (numeric !== undefined) {
          return done({
            ok: false, reason: 'nonzero-exit', target, stdout: out, stderr: errText, exitCode: numeric,
            message: `对端 \`${target}\` **以非零退出**（exit=${numeric}）⇒ ⛔ 未拿到可用结果`
              + `（⚠ stderr 原文保留；⚠ 这不是"它没收到"，而是"它收到了但没干成"）。`,
          })
        }
        return done({
          ok: false, reason: 'spawn-failed', target, stdout: out, stderr: errText,
          message: `对端 \`${target}\` **起不来**（⚠ 进程未能启动：`
            + `${String((err as Error)?.message ?? err)}）⇒ ⛔ 未投递成功（⚠ 检查 \`launcher\` 与执行权限）。`,
        })
      }
      if (out.trim() === '') {
        return done({
          ok: false, reason: 'empty-stdout', target, stdout: out, stderr: errText, exitCode: 0,
          message: `对端 \`${target}\` **退出码 0 但 stdout 为空** ⇒ ⚠ 拿不到结果`
            + `（⚠ 这是"看起来成功、其实什么都没有"的形态 ⇒ 本条**⛔ 不按成功处理**）。`,
        })
      }
      let events: unknown[] | undefined
      if (wantJson) {
        const parsed: unknown[] = []
        let bad = false
        for (const line of out.split('\n')) {
          const t = line.trim()
          if (t === '') continue
          try { parsed.push(JSON.parse(t)) } catch { bad = true; break }
        }
        if (bad || parsed.length === 0) {
          return done({
            ok: false, reason: 'malformed-json', target, stdout: out, stderr: errText, exitCode: 0,
            message: `对端 \`${target}\` 的 \`--json\` 输出**不是逐行 JSON** ⇒ ⚠ 结构化事件不予采信`
              + `（⚠ stdout 原文保留；⚠ 这条**⛔ 不按成功处理** —— 免得下游把散文当事件）。`,
          })
        }
        events = parsed
      }
      return done({
        ok: true, reason: 'ok', target, stdout: out, stderr: errText, exitCode: 0,
        ...(events === undefined ? {} : { events }),
        message: `对端 \`${target}\` **投递成功**（exit=0${events === undefined ? '' : ` · ${events.length} 条事件`}）。`,
      })
    })
  })
}

/**
 * ⚠ 本模块的**运行态入口**（⚠ 照既有模块形态：`index.ts` 经 `ctx.plugin` 装载它）。
 *
 * ── 它 `provide` 什么 ────────────────────────────────────────────────────────
 *   ⚠ 服务名 `{@link INTERCONNECT_SERVICE}` ⇒ ⚠ 服务体 = `{ deliver }`。
 *   ⚠ ⚠ **这是"能力"而不是"工具"** —— ⚠ `M6a` 的裁定是**尽量⛔ 不加面向模型的新工具**
 *     ⇒ ⚠ 投递能力**只经服务暴露**（⛔ 不进 `MODEL_TOOL_ALLOWLIST`、⛔ 不动三档白名单）。
 *
 * ── ⚠ 权限控制（⚠ 边界 ③）—— 2026-10-22 第 2 轮**改了判据的位置** ──────────
 *   ⚠ 判据本身没变：跨实例投递"向对端派活"= **影响外部状态** ⇒ 低档会话不该做。
 *   ⚠ 变的是**在哪判**：
 *     · 改前 —— **装载期**按**实例级全局**档，档位=账本 ⇒ **整个模块不装载**；
 *     · 现在 —— 装载**只看显式开关**；**每次投递**按**发起会话自己的**策略判
 *       （`deps.admissionOf()`，内部走宿主执行归属 + 活表核实 + 策略服务）。
 *   ⚠ 为什么这个改动**不是放宽**：全局档是一个值，而"谁能发起"是逐会话的事实。
 *     用全局值在装载期一票否决，会同时造成两种错：全局窄 ⇒ **合法会话也被拒**（能力凭空消失）；
 *     全局宽 ⇒ 每个会话都得自己再够宽（否则等于"全局值决定逐会话边界"，仍是串线）。
 *   ⇒ 删除的是**串线**那一半，⛔ 不是准入。
 *
 * ── ⚠ 诊断（⚠ 本仓纪律：能观测的都要说出来）──────────────────────────────────
 *   ⚠ 激活时把"开关状态 / 白名单内有几个对端"如实打出来，并**明写**：
 *     · 装载条件只有开关；
 *     · 投递准入在投递时按发起会话判；
 *     · 全局档读数**仅供参考、不参与准入**（⚠ 否则下一个人会把它接回判据）。
 */
export const INTERCONNECT_SERVICE = 'hobInterconnect'

export const name = 'dsh-hob-interconnect'

/** ⚠ 本模块**不需要** `inject`：⚠ 它只用 node 内置能力 + 配置（⚠ ⛔ 不依赖别的模块的服务）。 */
export function apply(ctx: any, config: unknown): void {
  // ⚠ 依赖经 `config` 传入（⚠ 照 `bus.ts` 的 `configFor` 同款：⚠ 模块自己不捅全局 config）：
  //   ⚠ `index.ts` 的 `configFor` 把 `deps`（现读开关/白名单）与 `levelOf`（现读档位）打成一个普通对象。
  const cfg = (config ?? {}) as { deps?: InterconnectDeps; levelOf?: () => string }
  const deps = cfg.deps ?? { enabledOf: () => false, targetsOf: () => [] }
  /**
   * ⚠ 兼容面：老配置里可能还传 `levelOf`。⚠ **它只用于诊断文案**，
   *   ⛔ 不参与准入（准入一律走 `deps.admissionOf()`）。
   *   把这条写出来，是为了让下一个人别再把 `levelOf` 当判据接回去。
   */
  const levelOf = cfg.levelOf ?? deps.diagnosticLevelOf ?? (() => 'ledger')
  const log = (m: string): void => { deps.log?.(m) }
  ctx.effect(() => {
    return () => {
      ctx.logger?.debug?.(`[${name}] 已卸载（${INTERCONNECT_SERVICE} 随之消失）`)
    }
  }, `${name}: service`)

  ctx.provide(INTERCONNECT_SERVICE, {
    version: 1,
    /**
     * ⚠ 投递入口（⚠ 每次现读开关与白名单 —— ⛔ 不缓存）。
     *
     * ⚠⚠ **签名里没有身份参数**（2026-10-22 第 2 轮）：发起者由 `deps.admissionOf()`
     *   从宿主执行归属里取，⛔ 调用方无法声明"我是谁"。
     */
    deliver: (target: string, task: string, opts?: { json?: boolean; cwd?: string }) =>
      deliverRemote(deps, target, task, opts ?? {}),
    /** ⚠ 白名单只读快照（⚠ 供诊断/面板显示 —— ⚠ 每次现读）。 */
    targets: () => deps.targetsOf().map((t) => t.name),
  })

  // ⚠ 如实报告（⚠ 关着 / 白名单空 —— 两种都要说出来，⛔ 不静默）
  const on = deps.enabledOf() === true
  const targets = deps.targetsOf()
  const level = (() => { try { return levelOf() } catch { return 'ledger' } })()
  if (!on) {
    log(`[${name}] 已加载，但**开关关闭**（缺省）⇒ ⛔ 不会向任何对端投递`
      + `（⚠ 白名单里有 ${targets.length} 个对端，⚠ 但开关关着就用不上）。`)
  } else {
    /**
     * ══════════════════════════════════════════════════════════════════════════
     * ⚠⚠ **2026-10-22（第 2 轮）：装载层不再看档位，所以这里不许再报"档位不足"**
     * ══════════════════════════════════════════════════════════════════════════
     *
     * ── 改前这里是什么 ──────────────────────────────────────────────────
     *   三分支：关着 / **档位=账本** / 正常档。中间那一支印的是
     *   「服务已提供，但每次投递都会被档位拒（升到"项目"档才放行）」。
     *   ⚠ 那句话在**装载层按全局档**的旧设计下是对的；但本轮把装载闸门删掉之后，
     *     它变成**又一句假话**：现在"档位=账本"**不影响装载**，
     *     而且投递时判的是**发起会话自己**的档，⛔ 不是这个全局值。
     *   ⇒ 若继续印，读者会以为"把全局档升上去就能投"—— 那是**错的方向**。
     *
     * ── 现在印什么（三个**各自独立**的事实）──────────────────────────────
     *   ① 装载条件 = **只有开关**（⛔ 与任何档位无关）—— 这是本行要传达的第一件事；
     *   ② 投递准入 = **发起会话 + 它的策略**（现场判，⛔ 不是装载时判）；
     *   ③ 白名单里有几个对端（配置事实）。
     *   ⚠ 全局档只作为**诊断读数**附带印出，并**明写"不参与准入"** ——
     *     否则下一个人又会把它接回判据里。
     */
    log(`[${name}] 已加载：开关=开 · 白名单对端=[${targets.map((t) => t.name).join(', ') || '（空）'}]`
      + ` · ⚠ 装载条件**只有开关**（⛔ 与任何档位无关）`)
    log(`[${name}] 投递准入在**投递时**按**发起会话自己的**策略判`
      + `（全局档读数=\`${level}\`，⚠ **仅供参考、⛔ 不参与准入**）。`
      + `无执行归属 / 发起会话已销毁 / 策略取不到 ⇒ 一律拒（⛔ 不退回任何宽档）。`)
  }
}
