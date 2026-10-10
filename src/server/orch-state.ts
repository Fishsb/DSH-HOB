/**
 * 编排运行态的**落盘**（跨插件重载仍可观测的那一份记录）。
 *
 * ══ 为什么需要它（本批实测暴露，对照实验已证）══════════════════════════
 *   `modules/orchestrator.ts` 的 `watches` 是**纯内存**的 `Map`，且建在
 *   `apply()` 的 `ctx.inject(['sessions','agents'], cb)` 回调**内部**。
 *
 *   实测（2026-10-09，本机实例**未重启**，只调 `dev_reload_package dsh-hob`）：
 *     · 重载前：`dsh-hob#521 / tools#522 / bus#523 / orchestrator#524 / settings#525`，
 *               `hobOrchestrator.status().watches.length = 1`
 *     · 重载后：`dsh-hob#529 / tools#530 / bus#531 / orchestrator#532 / settings#533`，
 *               `watches.length = 0`
 *   —— cordis 把该包的 6 个 fiber **全量重建**（旧 uid 全消失、新 uid 全出现），
 *   回调里的 `watches` 是**新建的空 Map**，而**没有任何东西**记下"曾经派过"。
 *
 *   派活方于是读到「在等回传 0 · 已回传 0 · 被停闸拦下 0」——
 *   **与"从来没派过"完全无法区分**。这正是用户报障的那个现象，
 *   也是 `relaysBlocked` 为 0 的原因（不是被刹车吞掉，是记录本身没了）。
 *
 * ⇒ 本模块把「未结算的派发」落一份盘：重载后被读回，
 *   交给 `hob_orch_status` 报出「曾经丢过 N 条」，并（尽力）唤醒派活方。
 *
 * ══ 落点（用户决策 UD-86 授权范围内）══════════════════════════════════
 *   `<账本目录>/runtime/orch-watches.json` —— 在账本目录**之内**，
 *   但**不是**三本账本（`DECISIONS.md` / `USER-DECISIONS.md` / `CONTEXT.md`）之一，
 *   是一个名字明确的**运行态**子目录。
 *
 *   ⚠ 账本目录由调用方（预设行的 `ledgerHome`）给出，本模块**不硬编码任何
 *     本机绝对路径**（可移植性口径 UD-73③）。
 *   ⚠ `runtime/` 自带 `.gitignore`（内容 `*`）⇒ 不会被账本仓跟踪 ——
 *     运行态**不进账本历史**（任务书 §2.1 第 4 条要求同批处理忽略）。
 *
 * ══ 为什么**不**做成"重载后自动续上 watch" ═════════════════════════════
 *   `agent/status` 的 `running → idle` 是**事件**、不是可轮询的状态：
 *   目标会话若在重载**之前**就已跑完，那条跳变**永远不会再来**。
 *   自动续上会留下一个**永不结算**的 watch —— 比丢掉更坏：
 *   它会命中 `dispatch` 的「同目标至多一条未结算」闸门，
 *   让该会话**永久不能再派**（另一个方向的坏掉）。
 *   ⇒ 本模块只**如实记账 + 报告 + 唤醒**，**不**替派活方决定重派。
 *
 * ══ 写入纪律（镜像 `server/hob-write.ts`）═════════════════════════════
 *   · **原子写**（同目录 tmp → rename），避免半截 JSON；
 *   · **读侧宽容**：文件不存在 / 坏了 / 结构不对 ⇒ 返回空态，**不抛** ——
 *     一个诊断用途的账不该让编排模块起不来；
 *   · **写失败不掩盖**：返回 `false`，由调用方记日志（绝不静默）。
 *
 * ⚠ 本模块**不 import `config.ts`**（同 `hob-write.ts` 的纪律）：
 *   配置由调用方以参数传入，便于独立测试、也避免模块间反向依赖。
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 运行态子目录名（账本目录**之内**、非账本）。 */
export const ORCH_STATE_SUBDIR = 'runtime'

/** 运行态文件名（名字明确：编排的"在等回传"记录）。 */
export const ORCH_STATE_FILENAME = 'orch-watches.json'

/** 结构版本（将来改结构时用它判新旧，而不是猜字段）。 */
export const ORCH_STATE_VERSION = 1

/** 落盘的一条"未结算派发"（是 `Watch` 的可序列化子集 + 工作区归属）。 */
export interface PersistedWatch {
  /** 被派发的会话（执行方）。 */
  target: string
  /** 派活方会话（回传的收件人）。 */
  watcher: string
  /** 第几轮（调用方自己数）。 */
  round?: number
  /** 派了什么。 */
  task?: string
  /** 登记时间（毫秒）。 */
  at: number
  /** 是否已见它进入 `running`。 */
  sawRunning: boolean
  /** 回传失败原因（有值 = 试过没送回去的残骸）。 */
  error?: string
  /** 这条记录属于哪个**工作区根**（决定了它落在哪个账本目录下）。 */
  wsRoot?: string
}

/**
 * 落盘的一条**待投递**中间态（2026-10-10 · 用户报障修复）。
 *
 * ── 为什么需要它（与上面的"重载抹 watch"是**同一个病的两面**）──────────
 *   `write_hob`（写 `archive/<日期>/TASK.md`）与 `hob_dispatch`（投递）是
 *   **两个独立工具调用**，中间没有耦合；而 `watches` **只在投递成功之后**才登记
 *   （见 `orchestrator.ts` 的 `dispatch`）⇒ **"写了文件但没投"这件事，
 *   系统里根本不存在** ⇒ 状态输出无法把它与"无事可做"区分开。
 *   实测：第 9 轮与第 21 轮各发生一次，**两次都是用户发现的**，
 *   现场读数逐字相同（`在等回传：0 个`）。
 *   ⇒ 本结构把**第一步做完、第二步没做**这件事**落一份记录**。
 */
export interface PersistedHandoff {
  /** 待投递的是什么：交接文件 / 新建但尚未派指令的会话。 */
  kind: 'task-file' | 'spawned-session'
  /** 交接文件的账本区相对路径，或新会话 id。 */
  ref: string
  /** 记录产生时刻（毫秒）。 */
  at: number
  /** 可选备注（如"第 21 轮"，由调用方给）。 */
  note?: string
  /** 这条记录属于哪个**工作区根**（决定它落在哪个账本目录下）。 */
  wsRoot?: string
  /**
   * **有意人工转达**（2026-10-10 第 44 轮 · 结构改造②）—— `true` = 这是**有意**
   * 交给用户手工带过去的，**不是忘了投**。
   *
   * ⚠ 它存在的唯一理由：让"**有意转达**"与"**漏投**"**可区分** ——
   *   后者才是缺陷。没有它，两种情形在状态输出里长得**逐字一样**
   *   （都是"待投递：N 份"），于是"有意转达"会持续制造**假告警**，
   *   而**假告警会训练人忽略真告警**（这才是它真正的代价）。
   *
   * ⚠ **向后兼容**：旧文件没有这个字段 ⇒ 读成 `false`（不抛、不判坏）。
   */
  manual?: true
}

/** 落盘文件的整体结构。 */
export interface OrchStateFile {
  version: number
  /** 最后一次写入时刻（毫秒）。 */
  updatedAt: number
  /** **未结算**的派发（插件活着时写的；重载后会被挪进 `lost`）。 */
  pending: PersistedWatch[]
  /** **已确认丢失**的派发（重载那次挪过来的；供 `hob_orch_status` 报"丢过"）。 */
  lost: PersistedWatch[]
  /** 最近一次"发现丢失"的时刻（毫秒）。 */
  lostAt?: number
  /**
   * **待投递**的中间态（2026-10-10 新增）—— "写了/建了，但还没投出去"。
   *
   * ⚠ **向后兼容**：旧文件没有这个字段 ⇒ 读成**空数组**（不抛、不判坏）。
   *   理由同 `lost`：一份**诊断用途**的运行态不该因缺字段而读不进来。
   */
  handoffs: PersistedHandoff[]
}

/** 空态（文件不存在/坏了时的返回值）。 */
export function emptyOrchState(): OrchStateFile {
  return { version: ORCH_STATE_VERSION, updatedAt: 0, pending: [], lost: [], handoffs: [] }
}

/** `<账本目录>` ⇒ 本模块的落盘文件路径。 */
export function orchStateFileOf(ledgerRoot: string): string {
  return join(ledgerRoot, ORCH_STATE_SUBDIR, ORCH_STATE_FILENAME)
}

/**
 * 宽容地把一条 JSON 记录**收窄**成 {@link PersistedWatch}。
 *
 * ⚠ 为什么要收窄而不是 `as`：文件是**跨版本、跨进程**读的 ——
 *   直接 `as` 会让一个坏字段（比如 `round: "2"`）一路漂到 `hob_orch_status`
 *   的输出里，表现为"回传信息看起来对但其实是垃圾"。
 *   这里**逐字段判类型**，判不出就丢那一条（丢一条 ≠ 让整次读取失败）。
 */
function asWatch(v: unknown): PersistedWatch | undefined {
  if (v === null || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (typeof o.target !== 'string' || o.target === '') return undefined
  if (typeof o.watcher !== 'string') return undefined
  if (typeof o.at !== 'number' || !Number.isFinite(o.at)) return undefined
  const out: PersistedWatch = {
    target: o.target,
    watcher: o.watcher,
    at: o.at,
    sawRunning: o.sawRunning === true,
  }
  if (typeof o.round === 'number' && Number.isFinite(o.round)) out.round = o.round
  if (typeof o.task === 'string') out.task = o.task
  if (typeof o.error === 'string') out.error = o.error
  if (typeof o.wsRoot === 'string' && o.wsRoot !== '') out.wsRoot = o.wsRoot
  return out
}

/** 把数组字段读成 `PersistedWatch[]`（逐条收窄，坏的丢掉）。 */
function asWatchList(v: unknown): PersistedWatch[] {
  if (!Array.isArray(v)) return []
  const out: PersistedWatch[] = []
  for (const item of v) {
    const w = asWatch(item)
    if (w !== undefined) out.push(w)
  }
  return out
}

/** 待投递记录的两种 kind（与 {@link PersistedHandoff.kind} 同源，运行时也要判）。 */
const HANDOFF_KINDS = ['task-file', 'spawned-session'] as const

/**
 * 宽容地把一条 JSON 记录**收窄**成 {@link PersistedHandoff}（纪律同 {@link asWatch}）。
 *
 * ⚠ `kind` 必须**在集合内**：一个拼错的 `kind`（如 `'taskfile'`）若放行，
 *   就会漂到状态输出里，表现为"有一条待投递，但看不出是什么"。
 */
function asHandoff(v: unknown): PersistedHandoff | undefined {
  if (v === null || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (typeof o.kind !== 'string') return undefined
  if (!(HANDOFF_KINDS as readonly string[]).includes(o.kind)) return undefined
  if (typeof o.ref !== 'string' || o.ref === '') return undefined
  if (typeof o.at !== 'number' || !Number.isFinite(o.at)) return undefined
  const out: PersistedHandoff = {
    kind: o.kind as PersistedHandoff['kind'],
    ref: o.ref,
    at: o.at,
  }
  if (typeof o.note === 'string' && o.note !== '') out.note = o.note
  if (typeof o.wsRoot === 'string' && o.wsRoot !== '') out.wsRoot = o.wsRoot
  // ⚠ **严格只认 `true`**（`o.manual === true`）：`"true"` / `1` 这类宽松值**不收**
  //   —— 判宽了会让"漏投"被误标成"有意转达"，那比缺字段更坏（把缺陷说成设计）。
  if (o.manual === true) out.manual = true
  return out
}

/** 把数组字段读成 `PersistedHandoff[]`（逐条收窄，坏的丢掉）。 */
function asHandoffList(v: unknown): PersistedHandoff[] {
  if (!Array.isArray(v)) return []
  const out: PersistedHandoff[] = []
  for (const item of v) {
    const h = asHandoff(item)
    if (h !== undefined) out.push(h)
  }
  return out
}

/**
 * 读落盘状态（**宽容**：文件不在/坏了/结构不对 ⇒ 空态，绝不抛）。
 *
 * ⚠ 判据是"能不能用"，不是"文件在不在"：`readFileSync` 成功但内容不是 JSON
 *   必须与"文件不存在"走同一条路 —— 否则一个被写坏的文件会让编排模块
 *   在每次 `status()` 时抛异常。
 */
export function readOrchState(file: string): OrchStateFile {
  try {
    const raw = readFileSync(file, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return emptyOrchState()
    const o = parsed as Record<string, unknown>
    const out: OrchStateFile = {
      version: typeof o.version === 'number' ? o.version : ORCH_STATE_VERSION,
      updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : 0,
      pending: asWatchList(o.pending),
      lost: asWatchList(o.lost),
      // ⚠ **向后兼容**（本轮核心要求之一）：旧文件没有 `handoffs` 字段 ⇒
      //   `asHandoffList(undefined)` = `[]` ⇒ 读成**空数组**，**不抛、不判坏**。
      //   这正与 `lost` 同款纪律：缺字段 ≠ 文件坏了（运行态是诊断用途）。
      handoffs: asHandoffList(o.handoffs),
    }
    if (typeof o.lostAt === 'number' && Number.isFinite(o.lostAt)) out.lostAt = o.lostAt
    return out
  } catch {
    return emptyOrchState()
  }
}

/**
 * 原子写落盘状态（同目录 tmp → rename）。
 *
 * @returns 是否写成功。**失败不抛** —— 由调用方记日志（一个记不上账的
 *   诊断不该让编排的主流程崩掉；但也绝不静默：返回值必须被消费）。
 */
export function writeOrchState(file: string, state: OrchStateFile): boolean {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
    renameSync(tmp, file)
    return true
  } catch {
    try { rmSync(tmp, { force: true }) } catch { /* 清理失败不掩盖主错误 */ }
    return false
  }
}

// ══════════════════════════════════════════════════════════════════════
// 运行态目录的**自忽略**（运行态不进账本历史）
// ══════════════════════════════════════════════════════════════════════

/** `runtime/` 自带的忽略文件（内容是 `*` ⇒ 该目录整体不参与 git）。 */
export const ORCH_STATE_IGNORE = '.gitignore'

/**
 * 保证 `runtime/` 目录被 git 忽略。
 *
 * ⚠ 为什么由插件自己写：账本目录**是一个 git 仓**（用户决策 D3/D4 —— 账本随仓留痕）。
 *   运行态文件（"在等回传"的中间记录）**不该进账本历史** —— 它每派一次就变，
 *   混进提交会让账本仓的 diff 充满噪声。
 *   任务书 §2.1 第 4 条要求"若会被跟踪就同批处理忽略"，这里就地处掉。
 *
 * ⚠ 内容是 `*`：该目录下**所有**文件（含本 `.gitignore` 自己）都不被跟踪 ⇒
 *   `git status` 干净，不需要人工 `git add` 任何东西。
 */
export function ensureRuntimeIgnored(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, ORCH_STATE_IGNORE),
      '# dsh-hob 编排运行态（插件自管；不进账本历史）\n*\n',
      'utf8',
    )
    return true
  } catch {
    return false
  }
}

// ══════════════════════════════════════════════════════════════════════
// 丢失判定（**本批的核心**：重载前未结算的那些派发）
// ══════════════════════════════════════════════════════════════════════

/** 保留的"已丢失"记录上限（防止文件无限增长 —— 它是运行态、不是审计日志）。 */
export const MAX_LOST = 50

/** 一条 watch 的身份：目标 + 登记时刻（两者合起来在本机内唯一）。 */
export function watchKey(w: Pick<PersistedWatch, 'target' | 'at'>): string {
  return `${w.target}@${w.at}`
}

/** {@link markLost} 的结果。 */
export interface MarkLostResult {
  /** 本次**新发现**的丢失（上一代留下、这一代不认识的）。 */
  lost: PersistedWatch[]
  /** 落盘后的完整状态（即使没新丢失也返回，便于调用方读计数）。 */
  state: OrchStateFile
  /** 是否真的写盘了。 */
  wrote: boolean
}

/**
 * 把落盘里**这一代不认识**的 `pending` 判为"丢失"，挪进 `lost` 并落盘。
 *
 * ── 判据 ──────────────────────────────────────────────────────────────
 *   `known(w)` 为真 = 这一代的编排器**正持有**这条 watch（还在等）
 *   ⇒ 它不是丢失的。为假 ⇒ 这条是**上一代**留下的 ⇒ 丢失。
 *
 *   ⚠ 为什么要传 `known` 而不是"文件里还有 pending ⇒ 全算丢"：
 *     预设作用域与编排模块的 fiber **可以各自重建**。若预设那一侧先重建、
 *     编排模块那一侧的 watch 还活着，则"文件里有 pending"并不意味着丢失 ——
 *     按 `known` 判能把这种情况排除掉（**不冤枉活着的 watch**）。
 *
 *   ⚠ 幂等：丢失项一旦挪进 `lost` 就不再出现在 `pending` 里 ⇒
 *     第二次调用不会重复报告、也不会重复唤醒派活方。
 */
export function markLost(
  file: string,
  known: (w: PersistedWatch) => boolean,
): MarkLostResult {
  const state = readOrchState(file)
  const unknown = state.pending.filter((w) => !known(w))
  if (unknown.length === 0) return { lost: [], state, wrote: false }

  const knownSet = new Set(state.pending.filter(known).map(watchKey))
  state.pending = state.pending.filter((w) => knownSet.has(watchKey(w)))
  // 新的在前；超过上限就丢掉最老的（运行态，不是审计留档）。
  state.lost = [...unknown, ...state.lost].slice(0, MAX_LOST)
  state.lostAt = Date.now()
  state.updatedAt = Date.now()
  return { lost: unknown, state, wrote: writeOrchState(file, state) }
}

/**
 * 把这一代**活着的** watch 落成 `pending`（保留既有 `lost` 与 `handoffs`）。
 *
 * ⚠ 必须保留 `lost`：它是"曾经丢过"的唯一在盘记录 ——
 *   覆盖掉它，重启后就又变成"从来没派过"，正是第 19 轮要修的失败。
 *
 * ⚠ **同样必须保留 `handoffs`**（2026-10-10 新增）：它是"写了但还没投"的
 *   唯一在盘记录。⚠ 覆盖掉它，就等于**又变成"从来没写过"** ——
 *   那正是本轮要修的那个失败本身（见 `PersistedHandoff` 的注释）。
 *   这与 `lost` 是**同一条纪律**，不是顺手加的一行。
 *
 * ⚠ 实现上**在函数内读回既有文件**取 `handoffs`（而不是加第 4 个参数）：
 *   ① 既有调用点（`orchestrator.ts` 的 `persistWatches`）传的是
 *      `(file, pending, prev.lost)`，签名一变就得同批改调用点；
 *   ② `check-orch-state.mjs` 的 **D4** 断言锚在**调用点的实参形状**
 *      （`writePending(…, …, prev.lost)`）—— 加参数会让它 FAIL，
 *      而"为了让新代码过得去而改既有断言"是红线。
 *   ⇒ 在函数内读回，既有调用点与既有断言**一字不动**。
 */
export function writePending(
  file: string,
  pending: PersistedWatch[],
  lost: PersistedWatch[],
): boolean {
  // 读回既有 handoffs（读不到 ⇒ 空数组，与 `readOrchState` 的宽容口径一致）。
  const prevHandoffs = readOrchState(file).handoffs
  const state: OrchStateFile = {
    version: ORCH_STATE_VERSION,
    updatedAt: Date.now(),
    pending,
    lost: lost.slice(0, MAX_LOST),
    handoffs: prevHandoffs.slice(0, MAX_HANDOFFS),
  }
  return writeOrchState(file, state)
}

// ══════════════════════════════════════════════════════════════════════
// 待投递中间态：记 / 清 / 读（2026-10-10 新增 · 用户报障修复）
// ══════════════════════════════════════════════════════════════════════

/** 保留的"待投递"记录上限（同 `MAX_LOST` 的理由：运行态，不是审计日志）。 */
export const MAX_HANDOFFS = 50

/** {@link recordHandoff} / {@link clearHandoffs} 的结果。 */
export interface HandoffWriteResult {
  /** 是否真的写盘了。 */
  wrote: boolean
  /** 落盘后的完整状态。 */
  state: OrchStateFile
}

/**
 * 记一条**待投递**（"写了/建了，但还没投出去"）。
 *
 * ⚠ **幂等去重**：同一 `(kind, ref)` 只保留**最新一条** ——
 *   否则"写了同一个 TASK 两次"会在状态输出里变成两条待投递（虚报）。
 *   ⚠ 去重键**不含 `at`**（与 `watchKey` 相反）：`watch` 要区分"同一会话的第几轮"，
 *   而待投递问的是"这个文件/会话**现在**还没投出去吗" ⇒ 是**布尔状态**，不是流水。
 *
 * ⚠ **失败不抛**：返回 `wrote: false`，由调用方记日志（同 `writeOrchState` 纪律）。
 */
export function recordHandoff(file: string, h: PersistedHandoff): HandoffWriteResult {
  const state = readOrchState(file)
  const rest = state.handoffs.filter((x) => !(x.kind === h.kind && x.ref === h.ref))
  // 新的在前；超过上限丢最老的（运行态，不是审计留档）。
  state.handoffs = [h, ...rest].slice(0, MAX_HANDOFFS)
  state.updatedAt = Date.now()
  return { wrote: writeOrchState(file, state), state }
}

/**
 * 清掉**匹配**的待投递记录（投递成功之后调）。
 *
 * @param match - 判"这条记录是否已被投出"。
 *   ⚠ 匹配细则由**调用方**给（投递路径各自知道自己能证明什么）：
 *   `task-file` 用"投递发生在其 `at` 之后"，`spawned-session` 用"目标会话 id === ref"。
 *   ⚠ **绝不按"消息文本里含路径"匹配** —— 脆、会误判（把别的话题里提到路径当成投递）。
 *
 * @returns 清掉了哪几条（供调用方记日志）与是否写盘。
 *   ⚠ **没有匹配项时不写盘**（`wrote: false`）：避免每次投递都无谓改文件。
 */
export function clearHandoffs(
  file: string,
  match: (h: PersistedHandoff) => boolean,
): { cleared: PersistedHandoff[]; wrote: boolean; state: OrchStateFile } {
  const state = readOrchState(file)
  const cleared = state.handoffs.filter(match)
  if (cleared.length === 0) return { cleared: [], wrote: false, state }
  state.handoffs = state.handoffs.filter((h) => !match(h))
  state.updatedAt = Date.now()
  return { cleared, wrote: writeOrchState(file, state), state }
}
