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

/** 投递的运行时依赖（⚠ 由 `index.ts` 注入 —— ⚠ 与 `bus.ts` 的 `ledgerRootOf` 同款纪律）。 */
export interface InterconnectDeps {
  /**
   * ⚠ **现读**开关（⚠ ⛔ 不是快照）：⚠ 开关若在 `apply` 时读一次，
   *   ⚠ 用户改完**已装模块不会卸载** ⇒ ⚠ 表现成"改了没反应"（⚠ 与 `skeletonEnabled` 同条教训）。
   */
  enabledOf: () => boolean
  /** ⚠ **现读**白名单（⚠ 同上：⛔ 不缓存）。 */
  targetsOf: () => readonly InterconnectTarget[]
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
  opts: { json?: boolean; cwd?: string } = {},
): Promise<DeliverRemoteResult> {
  const target = name.trim()
  // ── ① 开关（⚠ 缺省关：⚠ 关着就**什么都不投**，但**要有可读输出**）────────────
  if (deps.enabledOf() !== true) {
    return Promise.resolve({
      ok: false, reason: 'switch-off', target,
      message: '跨实例投递**开关关闭** ⇒ ⛔ 未投递任何东西（⚠ 这是缺省状态；⚠ 要对端干活请在配置里显式打开）。',
    })
  }
  // ── ② 白名单（⚠ 地址只从配置来 ⇒ ⛔ 不接受任意远端）──────────────────────
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

  deps.log?.(`[${name}] 投递到对端 \`${target}\`（profile=${profile} cwd=${cwd} json=${wantJson}）`)

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
 * ── ⚠ 可读权限控制（⚠ 边界 ③）────────────────────────────────────────────────
 *   ⚠ **档位低（`ledger`）时⛔ 不提供本服务** —— ⚠ 判据照 §1.3："判据是**有没有改动能力**"；
 *   ⚠ 跨实例投递**向对端派活**，⚠ 那是一种**影响外部状态**的动作 ⇒ ⚠ 与"只读档"不相容。
 *   ⚠ `levelOf` 是**现读**函数（⛔ 不是快照 —— 档位可随时改，⚠ 见 `config.ts` 的 `permissionLevel`）。
 *
 * ── ⚠ 诊断（⚠ 本仓纪律：能观测的都要说出来）──────────────────────────────────
 *   ⚠ 激活时把"开关状态 / 白名单内有几个对端 / 当前档位"如实打出来
 *     （⚠ 关着也要说 —— ⛔ 别让它"静默地什么都不做"）。
 */
export const INTERCONNECT_SERVICE = 'hobInterconnect'

export const name = 'dsh-hob-interconnect'

/** ⚠ 本模块**不需要** `inject`：⚠ 它只用 node 内置能力 + 配置（⚠ ⛔ 不依赖别的模块的服务）。 */
export function apply(ctx: any, config: unknown): void {
  // ⚠ 依赖经 `config` 传入（⚠ 照 `bus.ts` 的 `configFor` 同款：⚠ 模块自己不捅全局 config）：
  //   ⚠ `index.ts` 的 `configFor` 把 `deps`（现读开关/白名单）与 `levelOf`（现读档位）打成一个普通对象。
  const cfg = (config ?? {}) as { deps?: InterconnectDeps; levelOf?: () => string }
  const deps = cfg.deps ?? { enabledOf: () => false, targetsOf: () => [] }
  const levelOf = cfg.levelOf ?? (() => 'ledger')
  const log = (m: string): void => { deps.log?.(m) }
  ctx.effect(() => {
    return () => {
      ctx.logger?.debug?.(`[${name}] 已卸载（${INTERCONNECT_SERVICE} 随之消失）`)
    }
  }, `${name}: service`)

  ctx.provide(INTERCONNECT_SERVICE, {
    version: 1,
    /** ⚠ 投递入口（⚠ 每次现读开关与白名单 —— ⛔ 不缓存）。 */
    deliver: (target: string, task: string, opts?: { json?: boolean; cwd?: string }) =>
      deliverRemote(deps, target, task, opts ?? {}),
    /** ⚠ 白名单只读快照（⚠ 供诊断/面板显示 —— ⚠ 每次现读）。 */
    targets: () => deps.targetsOf().map((t) => t.name),
  })

  // ⚠ 如实报告（⚠ 关着 / 白名单空 / 档位不足 —— 三种都要说出来，⛔ 不静默）
  const on = deps.enabledOf() === true
  const targets = deps.targetsOf()
  const level = (() => { try { return levelOf() } catch { return 'ledger' } })()
  if (!on) {
    log(`[${name}] 已加载，但**开关关闭**（缺省）⇒ ⛔ 不会向任何对端投递`
      + `（⚠ 白名单里有 ${targets.length} 个对端，⚠ 但开关关着就用不上）。`)
  } else if (level === 'ledger') {
    log(`[${name}] 开关**开着**，但**当前可读权限控制 = 账本权限** ⇒ ⛔ 不提供投递服务`
      + `（⚠ 跨实例投递是"影响外部状态"的动作；⚠ 升到"项目"档才可用）。`)
  } else {
    log(`[${name}] 已加载：开关=开 · 档位=${level} · 白名单对端=[${targets.map((t) => t.name).join(', ') || '（空）'}]。`)
  }
}
