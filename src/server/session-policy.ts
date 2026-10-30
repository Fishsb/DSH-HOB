/**
 * **逐会话策略权威**：每个会话一行记录（可读档 + 推进工作方式），落在
 * `<账本目录>/runtime/session-policy.json`。
 *
 * ══ 它治的是什么（2026-10-22 · `REQ-04`）════════════════════════════════════
 *   改前这两个值都是**插件级全局**（`config.permission.level` / `config.workMode.mode`，
 *   见 `src/config.ts` 的 `permissionLevel()` / `workMode()`）⇒ 改一次，**所有已开的
 *   Hob 会话**在下一次 step / 下一次工具调用就跟着变（跨会话串线）。
 *   ⇒ 本模块提供**唯一**的会话维度权威：按 sessionId 读，读不到就**保守**。
 *
 * ══ 为什么是"账本运行态"而不是宿主的会话持久层 ═══════════════════════════════
 *   · 宿主没有"按会话存插件私有配置"的官方接口（`SessionCreateRequest` 只有四个
 *     字段且 `additionalProperties:false`；header 无 meta 袋，只认 `agentPreset`）；
 *   · 账本区**本来就是**本插件的运行态落点（`runtime/orch-watches.json` 是同款先例，
 *     且 `runtime/.gitignore` 让整目录不进账本历史）。
 *   ⇒ 选它：可审计、可原子写、跨重启保留、且与工作区名绑定（⛔ 不会跨工作区混用）。
 *
 * ══ 信任模型（⛔ 全部 fail-closed，任何一条都不许回退到"旧全局宽档"）══════════
 *   | 情形 | 读数 |
 *   |---|---|
 *   | 记录合法 | 用它 |
 *   | 没有记录、会话早于迁移时刻（旧会话） | `ledger` + 迁移时固化的工作方式（并**写回**记录） |
 *   | 没有记录、会话晚于迁移时刻（新会话，未选） | `ledger` + 安全缺省工作方式，`source='derived-default'`（⛔ 不写记录）；⚠ **`mayProceed=true`**（2026-10-24 改，理由见该分支注释）—— **放行，但读档仍是最低档** |
 *   | 文件不存在 | 同上两条（`store-absent` 并入，原因写清） |
 *   | 文件坏了 / 不是 JSON / 结构不对 | `ledger` + 安全缺省（`store-unreadable`） |
 *   | 结构版本不认识 | `ledger` + 安全缺省（`version-unknown`） |
 *   | 某条记录字段非法（枚举外/缺字段） | 该条**视为不存在**（`bad-record`），走保守分支 |
 *   | 取不到 sessionId | `ledger` + 安全缺省（`no-identity`）；调用方**不得**读工作区 |
 *   | 非 Hob 会话 | `isHob=false` ⇒ 调用方保持既有行为（本模块不参与） |
 *
 * ⚠ 本模块**不 import `config.ts`**（同 `orch-state.ts` / `hob-write.ts` 的纪律）：
 *   枚举与缺省由调用方以参数传入 ⇒ 便于独立测试，也避免模块间反向依赖。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** 运行态子目录名（⚠ 与 `orch-state.ts` 的 `ORCH_STATE_SUBDIR` **同一个目录**）。 */
export const POLICY_STATE_SUBDIR = 'runtime'

/** 文件名（⚠ 与编排运行态并列，互不覆盖）。 */
export const POLICY_STATE_FILENAME = 'session-policy.json'

/**
 * 结构版本。
 *
 * ⚠ 只在**结构**（字段含义/形状）变化时 +1；**不认识的版本 ⇒ 整份不认**，
 *   走保守分支（⛔ 不"尽力解释"一个未来版本 —— 那等于用猜测当权威）。
 */
export const POLICY_STATE_VERSION = 1

/** 单条会话策略（落盘形态）。 */
export interface SessionPolicyRecord {
  /** 可读档（`ledger` / `project` / `workspace`）—— 调用方用自己的枚举校验。 */
  level: string
  /** 推进工作方式（`auto` / `single` / `multi`）—— 同上。 */
  workMode: string
  /**
   * 来源。
   * · `explicit` —— 用户/调用方显式设置（将来弹窗与显式入站接口写的就是这个）；
   * · `legacy-migrated` —— 旧会话一次性迁移写下的（读档 = 最低；工作方式 = 迁移时的生效值）。
   */
  origin: 'explicit' | 'legacy-migrated'
  /** 写入时刻（ms）。⚠ 只用于审计，不参与判定。 */
  at: number
  /**
   * ⚠⚠ **持久隔离标记**（2026-10-22 · 治 `stranded` 残留高档）。
   *
   * ── 它解决什么（上一版为什么不算修好）─────────────────────────────
   *   创建链在「`set` 报成功、回读不一致、空白会话又撤不掉」时，盘上**已经**写进了
   *   用户选的那一档（可能是 `workspace` 高档）。上一版只是**如实报告**
   *   `stranded{level:workspace, executable:true}` —— ⚠ **报告不是修复**：
   *   那个会话**仍然能按高档读、按 auto 派活**，重载之后也照样。
   *
   * ── 本标记的语义（三条，⛔ 缺一条就不算隔离）───────────────────────
   *   ① **落盘持久**：写在策略文件里、跟着 `sessions[id]` 一起落盘 ⇒
   *      **宿主重启 / 文件重载之后仍然生效**（⛔ 不是进程内一次性降级）。
   *   ② **解析期硬降**：`resolveSessionPolicy` 见到它就**无条件**返回
   *      `level=最低` + `mayProceed=false`，⛔ 不管 `level` 字段存的是哪一档。
   *   ③ **可审计**：保留 `level` 原值（⛔ 不抹掉"曾经写过什么"），
   *      但对外读数一律按隔离后的最低档给，`source='quarantined'`。
   *
   * ⚠ **为什么不直接把记录删掉**：删记录会把会话打回「无记录」，而**旧会话**无记录
   *   会走 `legacy-migrated` / `unknown-legacy`，语义不确定；而且**删也可能失败**
   *   （与"写失败"同一种不可靠）⇒ 隔离标记是同一次写里能表达的**最强**语义：
   *   「这条记录存在、但它已被作废」。
   */
  quarantined?: true
  /**
   * ⚠⚠ **激活状态**（2026-10-22 · 治"未确认就激活宽档"）。
   *
   * ── 为什么需要它（上一版为什么治不好）───────────────────────────────
   *   上一版的顺序是：**先写用户选的宽档** → 回读 → 不一致就隔离。
   *   ⇒ 在"写宽档成功 + 回读不一致 + 隔离也写失败"那一格，盘上是**宽档且无隔离**
   *     ⇒ 那个会话**能按宽档执行**。"报警"治不了这个。
   *
   * ── 本字段的语义 ────────────────────────────────────────────────
   *   · `'pending'` —— 记录**已写入但未确认**。⚠ 解析期**一律按最低档 + 不推进**，
   *     ⛔ 不管 `level` 里存的是哪一档。⇒ **未确认状态绝不激活宽档**。
   *   · `'active'`  —— 已确认生效，按 `level` / `workMode` 执行。
   *   · **缺省（`undefined`）= `'active'`** —— ⚠ 这是**向后兼容**的关键：
   *     本轮之前的记录（含旧会话迁移、别处写入的显式记录）都没有这个字段，
   *     ⚠ 判成 `pending` 会把**所有既有 Hob 会话降级**（严重回归）。
   *     ⇒ 只有**创建链自己**显式写 `'pending'`，才有 pending 语义。
   *
   * ── 这样把最坏格移到哪里了 ──────────────────────────────────────
   *   创建链变成：`set(pending, 宽档)` → 回读 → **`activate()`** → 回读。
   *   ⇒ **`activate()` 之前的所有失败都落在 pending ⇒ 最低档，绝对安全**。
   *   ⇒ 只剩 `activate()` 那一次写：它"报成功但回读不一致"时盘上可能已 active 宽档
   *     ⇒ 那时才用隔离兜底；隔离也失败 ⇒ 如实 `unsafe`（见创建链注释）。
   *   ⚠ 这是把"从安全到不安全"的窗口从"宽档写 + 隔离写两次都可能谎报"
   *     压到"**唯一一次 activate 写**"，⛔ 不是消除了窗口 —— 见回报"未验/不可证"一节。
   */
  activation?: 'pending' | 'active'
}

/** 落盘文件形态。 */
export interface SessionPolicyFile {
  version: number
  /** 迁移纪元（ms）：第一次读到"没有记录"时写定，用于区分**旧会话**与**新会话**。 */
  migrationEpoch: number
  sessions: Record<string, SessionPolicyRecord>
}

/** 读盘可达性（⚠ 四档可分辨：⛔ 不把"文件没有"和"文件坏了"说成同一句）。 */
export type StoreReachability = 'ok' | 'absent' | 'unreadable' | 'version-unknown'

export interface PolicyStoreReading {
  reachability: StoreReachability
  file: SessionPolicyFile
  /** 可达性不可用时的可读原因（`ok` 时为空串）。 */
  reason: string
  /**
   * ⚠⚠ **纪元是不是真的从盘上读出来的**（2026-10-24 · 治"纪元从不落盘"）。
   *
   * ── 为什么必须单列这一位 ─────────────────────────────────────────────
   *   改前：文件不存在 / 文件里没有合法 `migrationEpoch` 时，本函数用 `now` **临时编**一个纪元
   *   ⇒ `resolveSessionPolicy` 拿它跟 `createdAt` 比 ⇒ **任何 1 秒前刚建的会话都 `createdAt < epoch`**
   *   ⇒ 被判成"旧会话"并 `mayProceed=true` 放行（实测复现）。
   *   ⚠ 那不是"旧会话迁移"，那是把"纪元没落盘"伪装成"纪元 = 此刻"。
   *   ⇒ 现在把这件事**显式**报出来：`epochDeclared=false` 表示"盘上没有纪元，这个数是临时的"，
   *     调用方必须用 {@link ensurePolicyStoreEpoch} 落盘，或用安装时刻的 `fallbackEpoch` 判新旧。
   */
  epochDeclared: boolean
}

/** 解析结果（调用方据此决定"能不能读工作区"）。 */
export interface PolicyResolution {
  /** 这个会话是不是 Hob 预设会话（否 ⇒ 调用方保持既有行为）。 */
  isHob: boolean
  /** 可读档。⚠ **兜底恒为最低档**。 */
  level: string
  /** 推进工作方式。⚠ 兜底 = 调用方给的**安全缺省**。 */
  workMode: string
  /** 读数来源（⚠ 让"降级"可见，⛔ 不静默）。 */
  source:
    | 'stored'
    | 'legacy-migrated'
    | 'derived-default'
    | 'no-identity'
    | 'store-unreadable'
    | 'version-unknown'
    /**
     * ⚠ **被隔离的记录**（`quarantined: true`）：记录在、但已作废。
     *   读数 = 最低档 + `mayProceed=false`。⚠ 单独一个值，⛔ 不并进 `stored` ——
     *   两者语义相反（`stored` = 可信现值；本值 = 已作废的残留）。
     */
    | 'quarantined'
    /**
     * ⚠ **已写入但未确认**（`activation:'pending'`）：读档最低 + 不推进。
     *   ⚠ 与 `quarantined` 分开：那是"作废"，这是"还没生效"。
     */
    | 'pending-activation'
    /**
     * ⚠ **已持久归档**（`workspaceRegistry.archivedSessionIds` 命中）：
     *   无条件最低档 + 不推进。⚠ 与 `quarantined` 分开：
     *   那是"策略记录作废"，这是"宿主持久归档"（更强的第二层，且宿主 pre-step 也拒）。
     */
    | 'archived'
    /**
     * ⚠ **归档状态不可知**（服务缺席 / 抛错 / 格式坏）：按已归档对待（最低档 + 不推进）。
     *   ⚠ 与 `archived` 分开：那是"确定已归档"，这是"我们读不到、所以不敢放宽"。
     */
    | 'archive-unknown'
    | 'bad-record'
    | 'non-hob'
    /**
     * ⚠ 2026-10-22 第 4 轮新增：**判不出它是不是旧会话**，且已有证据表明它**可能**是
     * （即：没有记录，但创建时刻取不到、或迁移尚未完成且我们说不出原值）。
     * ⇒ 读档=最低、`mayProceed=false`。⛔ 不许拿 `defaultMode` 当"最终方式"往下走。
     */
    | 'unknown-legacy'
  /** 人读原因（`stored` / `non-hob` 时也可能非空，用于说明没写记录的理由）。 */
  reason: string
  /** 是否允许读工作区文件。⚠ 只有 `workspace` 档为 `true`；其余一律 `false`。 */
  canReadWorkspace: boolean
  /**
   * ⚠⚠ **工作方式是否已经落盘**（2026-10-22 第 4 轮新增，治的是"先给值再偷偷改"）。
   *
   * 语义（**只有两种**，⛔ 不许有第三种含糊态）：
   * · `'persisted'` —— 这个工作方式**已经在策略文件里**（或本来就不该写：非 Hob / 新会话未选）。
   *   ⇒ 调用方可以放心按它推进，**它不会在后续被改**。
   * · `'snapshot'` —— 值来自**切换时刻的进程内快照**（旧会话尚未写盘）。
   *   ⇒ 值本身**是原值**（⛔ 不是 defaultMode），行为上可以按它推进；
   *     但**持久化尚未完成**，调用方**必须**把这件事说出来（⛔ 不许当"已完成"）。
   *
   * ⚠ 为什么必须单列这个字段、而不是塞进 `source` 字符串：
   *   `source` 已经承载"值从哪来"，而"写没写盘"是**另一根轴**。
   *   上一轮把两者混为一谈（`legacy-migrated` 既表示"还没迁"又表示"迁移值"），
   *   ⇒ 读者无法判断"这个 multi 会不会过一会儿变成 auto"。
   */
  persistence: 'persisted' | 'snapshot'
  /**
   * ⚠ 该会话本次**是否允许推进**（2026-10-22 第 4 轮新增）。
   *
   * · `true` —— 可以按 `workMode` 推进（值可信：要么已落盘，要么是原值快照）。
   * · `false` —— **必须停下**，⛔ 不许拿 `workMode` 去派活。
   *   ⚠ 触发条件 = **判不出它是不是旧 Hob 会话，而又明显不是新会话**那种情形
   *     （详见 `resolveSessionPolicy` 的 `unknown-legacy` 支）。
   *   ⚠ 与 `canReadWorkspace` **是两根独立的轴**：读不到工作区不代表不能推进
   *     （`ledger` 档的旧会话读档=最低，但仍然可以按原 `multi` 推进）。
   */
  mayProceed: boolean
}

/** 建店参数（枚举与缺省**由调用方传入**，⛔ 本模块不自己抄一份清单）。 */
export interface PolicyStoreOptions {
  /** 合法可读档（顺序无关；⚠ 最低档 = 数组首项，调用方负责给对）。 */
  levels: readonly string[]
  /** 合法工作方式。 */
  modes: readonly string[]
  /** 最低可读档（⚠ 兜底用它）。 */
  floorLevel: string
  /** 安全缺省工作方式（⚠ 兜底用它；不是"沿用全局"）。 */
  defaultMode: string
}

/** `<账本目录>` ⇒ 本模块的落盘文件路径。 */
export function policyStateFileOf(ledgerRoot: string): string {
  return `${ledgerRoot}/${POLICY_STATE_SUBDIR}/${POLICY_STATE_FILENAME}`
}

/** 空文件形态。 */
function emptyFile(epoch: number): SessionPolicyFile {
  return { version: POLICY_STATE_VERSION, migrationEpoch: epoch, sessions: {} }
}

/**
 * ⚠⚠ **写盘时该用的纪元**（2026-10-24 · "首次生成即写盘"的落点）。
 *
 * ── 为什么单列一个函数 ────────────────────────────────────────────────
 *   改前每个写函数都直接转抄 `reading.file.migrationEpoch`，而 `readPolicyStore` 在
 *   "文件不存在 / 没有该字段"时给的是**读的那一刻**（`now`）。两个后果：
 *     ① 那个值**从来没有被写进盘**（若写函数不落文件）⇒ 下一次读又是新的"此刻"；
 *     ② 即使由某次写入带下去了，它固化成"**那一次写入的时刻**"——
 *        与"本插件第一次看到这个账本"没有关系。
 *   ⇒ 现在写函数统一走本函数：**读到可信纪元 ⇒ 原样保留**（⛔ 不重写别人的历史）；
 *     **没有可信纪元 ⇒ 用 `fallbackEpoch`（调用方给的"安装时刻"）**，
 *     没给才退 `now`（⚠ 纯库调用方 / 单测：至少"写下去"这件事会发生，
 *     不会再出现"每次读都是新纪元"的漂移）。
 *
 * ⚠ 产品路径（服务层）**一定会先调 `ensurePolicyStoreEpoch`** 把纪元钉在安装时刻，
 *   所以这里拿到的基本都是 `epochDeclared=true` 的那一支。
 */
function epochForWrite(reading: PolicyStoreReading, now: number, fallbackEpoch?: number): number {
  if (reading.epochDeclared) return reading.file.migrationEpoch
  return typeof fallbackEpoch === 'number' && Number.isFinite(fallbackEpoch) ? fallbackEpoch : now
}

/** 逐字段把一条记录收窄（⚠ 判不出就丢**这一条**，不让整份读取失败）。 */
function asRecord(v: unknown, opts: PolicyStoreOptions): SessionPolicyRecord | undefined {
  if (v === null || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const level = o.level
  const workMode = o.workMode
  if (typeof level !== 'string' || !opts.levels.includes(level)) return undefined
  if (typeof workMode !== 'string' || !opts.modes.includes(workMode)) return undefined
  const origin = o.origin
  if (origin !== 'explicit' && origin !== 'legacy-migrated') return undefined
  const at = o.at
  if (typeof at !== 'number' || !Number.isFinite(at)) return undefined
  /**
   * ⚠⚠ **必须把 `quarantined` 收窄进来**（2026-10-22 实测踩过）：
   *   本函数是记录的**白名单**——它只把认识的字段拷出来。上一版漏了这个字段，
   *   于是 `quarantineSessionPolicy` **写进去后立刻回读不到** ⇒ 隔离"永远失败"
   *   （而盘上其实写了）。⚠ 这正是"写/读两侧字段集不同步"的经典形态。
   *   ⇒ 新增字段时**两处都要改**：`SessionPolicyRecord` 与这里。
   */
  const quarantined = o.quarantined === true ? true : undefined
  /**
   * ⚠ 只认**显式写下的** `'pending'` / `'active'`；任何别的值一律当 `undefined`
   *   （= `active`，向后兼容）。⛔ 不把"读不懂的值"当 pending —— 那会让旧记录被降级。
   *   ⚠ 与 `quarantined` 一样：**新增字段必须在这里收窄**，否则写进去读不回来
   *   （本轮早前就踩过 `quarantined` 的同一个坑）。
   */
  const activation: 'pending' | 'active' | undefined =
    o.activation === 'pending' ? 'pending' : o.activation === 'active' ? 'active' : undefined
  const base = { level, workMode, origin: origin as 'explicit' | 'legacy-migrated', at }
  return {
    ...base,
    ...(quarantined === undefined ? {} : { quarantined }),
    ...(activation === undefined ? {} : { activation }),
  }
}

/**
 * 读盘（⚠ **不做任何写**；迁移写入由 {@link ensureLegacyMigrated} 单独负责）。
 *
 * @param file - 落盘路径。
 * @param opts - 枚举与缺省。
 * @param now - 现在（ms）；只有在"文件不存在"时才用来生成迁移纪元。
 * @returns 四档可达性 + 已收窄的记录表。
 */
export function readPolicyStore(file: string, opts: PolicyStoreOptions, now: number = Date.now()): PolicyStoreReading {
  if (!existsSync(file)) {
    return {
      reachability: 'absent',
      file: emptyFile(now),
      reason: '还没有任何会话策略记录（本次运行第一次）',
      // ⚠ 这个纪元是**临时编的**（不是盘上的事实）⇒ 调用方不许拿它当"迁移时刻"判新旧。
      epochDeclared: false,
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    return {
      reachability: 'unreadable',
      file: emptyFile(now),
      reason: `策略文件存在但读不了/不是 JSON（${String((e as Error)?.message ?? e)}）⇒ 按最保守档处理`,
      epochDeclared: false,
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      reachability: 'unreadable',
      file: emptyFile(now),
      reason: '策略文件顶层不是对象 ⇒ 按最保守档处理',
      epochDeclared: false,
    }
  }
  const o = parsed as Record<string, unknown>
  const version = o.version
  if (version !== POLICY_STATE_VERSION) {
    return {
      reachability: 'version-unknown',
      file: emptyFile(now),
      reason: `策略文件结构版本是 ${JSON.stringify(version)}，本插件只认 ${POLICY_STATE_VERSION}`
        + ' ⇒ 不"尽力解释"未来/旧版本，直接按最保守档处理',
      epochDeclared: false,
    }
  }
  const epochRaw = o.migrationEpoch
  const epochOk = typeof epochRaw === 'number' && Number.isFinite(epochRaw)
  const epoch = epochOk ? epochRaw as number : now
  const sessionsRaw = o.sessions
  const sessions: Record<string, SessionPolicyRecord> = {}
  if (sessionsRaw !== null && typeof sessionsRaw === 'object' && !Array.isArray(sessionsRaw)) {
    for (const [id, rec] of Object.entries(sessionsRaw as Record<string, unknown>)) {
      if (id === '') continue
      const narrowed = asRecord(rec, opts)
      if (narrowed !== undefined) sessions[id] = narrowed
    }
  }
  return {
    reachability: 'ok',
    file: { version: POLICY_STATE_VERSION, migrationEpoch: epoch, sessions },
    reason: '',
    epochDeclared: epochOk,
  }
}

/**
 * 原子写盘（tmp + rename）。⚠ 失败**返回可读原因**，⛔ 不抛给调用方 ——
 *   策略写失败不该把工具调用炸掉（本项目的既有取向：边界 fail-closed，但
 *   "记录写不进去"是**可读的降级**，不是崩溃）。
 */
export function writePolicyStore(file: string, state: SessionPolicyFile): { ok: boolean; reason: string } {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  /**
   * ⚠⚠ **D12 回读验证（2026-10-27 · 包 X）**
   *
   * ── 改前 ──────────────────────────────────────────────────────────────
   *   `renameSync` 返回 ⇒ `{ ok: true }`。⚠ 这是"改了盘上东西还返成功"的一处：
   *   策略文件的**六个写入点**（`setSessionPolicy` / `quarantine` / 纪元补写 /
   *   三处 migrate）全都以这个 `ok` 决定"要不要如实说没落盘"。
   *
   * ── 现在：三条判据（`D12` §5.6）──────────────────────────────────────────
   *   ① **对着预期值比**：序列化后的 `expect` 与盘上**逐字节**比，⛔ 不是"文件存在"；
   *   ② **回读失败 ⇒ `ok:false` + 可读原因**（⛔ 不许说成功）；
   *   ③ **独立的一次读**：`readFileSync` 重新从盘上取，⛔ 不拿刚序列化的内存串充数。
   *
   * ⚠ **回读是第二道，不是替代**：写/rename 抛错仍走原 `catch`（原因文案一字未改）；
   *   回读不符走**新的**可读原因 —— 两种成因**分开说**（本仓纪律）。
   */
  const expect = JSON.stringify(state, null, 2)
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(tmp, expect, 'utf8')
    renameSync(tmp, file)
  } catch (e) {
    try { rmSync(tmp, { force: true }) } catch { /* 清理失败不掩盖主错误 */ }
    return { ok: false, reason: `策略写入失败：${String((e as Error)?.message ?? e)}` }
  }
  try {
    const back = readFileSync(file)
    if (!back.equals(Buffer.from(expect, 'utf8'))) {
      return { ok: false, reason: '策略写入后回读与预期不符 ⇒ 视为未落盘（勿按已保存处理）' }
    }
    return { ok: true, reason: '' }
  } catch (e) {
    return { ok: false, reason: `策略写入后回读失败：${String((e as Error)?.message ?? e)}` }
  }
}

/**
 * ⭐ **把迁移纪元落到盘上**（2026-10-24 · 治"纪元从不落盘"）。
 *
 * ══ 它治的是什么 ═══════════════════════════════════════════════════════
 *   改前 `migrationEpoch` **只在内存里**由 `readPolicyStore(file, opts, now)` 的 `now` 临时充当
 *   （文件不存在 / 文件里没有该字段时）⇒ 每次读都得到"此刻"作为纪元
 *   ⇒ 任何**刚建**的会话都满足 `createdAt < epoch` ⇒ 被误判成"旧会话"并放行。
 *   ⚠ 更糟的是：**它永远落不了盘** —— 只有 `setSessionPolicy` / `quarantineSessionPolicy` /
 *     `ensureLegacyMigrated*` 会写文件，而那三个都原样转抄 `reading.file.migrationEpoch`
 *     （= 那个临时 `now`）⇒ 记录一旦写下去，纪元就被固化成**那一次写入的时刻**，
 *     与"本插件第一次看到这个账本"毫无关系。
 *
 * ══ 现在的口径 ═══════════════════════════════════════════════════════════
 *   · **第一次**调用（文件不存在）⇒ 用 `now` 建文件、把纪元写进去；
 *   · 文件存在但**没有合法纪元** ⇒ 补写一个（⚠ 用 `fallbackEpoch`：调用方传入
 *     "本插件安装时刻"，那是**比"此刻"更早、且只在本进程内确定**的可信下界，
 *     这样"安装前就存在的会话"仍被判成旧会话，不会因为补写纪元而被误认成新会话）；
 *   · 已有合法纪元 ⇒ **不动**（幂等，⛔ 不重写别人的文件）。
 *
 * ⚠ 它**只补纪元**，不改任何 `sessions`（⛔ 不会把"没选"写成"选过了"）。
 * ⚠ 写失败**如实返回**（调用方据此在读数里说明"纪元未能落盘"），⛔ 不假装成功。
 *
 * @param file - 策略文件路径。
 * @param opts - 枚举与缺省（只为读盘收窄记录用）。
 * @param now - 现在（ms）；首次建文件时用作纪元。
 * @param fallbackEpoch - 文件在、却没有合法纪元时的补写值（⚠ 传"安装时刻"）。
 * @returns `{ ok, epoch, wrote, reason }` —— `wrote=false` 表示盘上本来就有合法纪元。
 */
export function ensurePolicyStoreEpoch(
  file: string,
  opts: PolicyStoreOptions,
  now: number = Date.now(),
  fallbackEpoch?: number,
): { ok: boolean; epoch: number; wrote: boolean; reason: string } {
  const reading = readPolicyStore(file, opts, now)
  if (reading.reachability === 'unreadable' || reading.reachability === 'version-unknown') {
    // ⚠ 坏文件不覆盖（覆盖会静默丢掉别人的记录）⇒ 如实说"纪元落不了盘"。
    return { ok: false, epoch: reading.file.migrationEpoch, wrote: false, reason: reading.reason }
  }
  if (reading.epochDeclared) {
    return { ok: true, epoch: reading.file.migrationEpoch, wrote: false, reason: '' }
  }
  const epoch = typeof fallbackEpoch === 'number' && Number.isFinite(fallbackEpoch) ? fallbackEpoch : now
  const state: SessionPolicyFile = {
    version: POLICY_STATE_VERSION,
    migrationEpoch: epoch,
    sessions: { ...reading.file.sessions },
  }
  ensurePolicyDirIgnored(dirname(file))
  const w = writePolicyStore(file, state)
  if (!w.ok) return { ok: false, epoch, wrote: false, reason: w.reason }
  /**
   * ⚠ **回读确认纪元真的在盘上**（⛔ 不拿 write 返回值当成功）——
   *   本函数存在的唯一目的就是"纪元落盘"，写没写进去必须当场核。
   */
  const back = readPolicyStore(file, opts, now)
  if (!back.epochDeclared || back.file.migrationEpoch !== epoch) {
    return { ok: false, epoch, wrote: true, reason: '纪元写入后回读不一致 ⇒ 视为未落盘' }
  }
  return { ok: true, epoch, wrote: true, reason: '' }
}

/** `<dir>` 的 `runtime/.gitignore`（内容 `*`）—— ⚠ 与本仓运行态同一口径：不进账本历史。 */
export function ensurePolicyDirIgnored(dir: string): boolean {
  /** ⚠ `D12`：内容固定 ⇒ 预期值固定，回读**逐字节比这一串**（⛔ 不是"文件在就行"）。 */
  const expect = '# dsh-hob 逐会话策略运行态（插件自管；不进账本历史）\n*\n'
  const target = `${dir}/.gitignore`
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(target, expect, 'utf8')
  } catch {
    return false
  }
  /**
   * ⚠⚠ **D12 回读（2026-10-27 · 包 X）**：返回值有**三处**调用方拿它决定"要不要告警"
   *   （`session-policy-service.ts` 三处）⇒ 写没写进去必须当场核，⛔ 不许"调过写函数就算成"。
   */
  try {
    return readFileSync(target, 'utf8') === expect
  } catch {
    return false
  }
}

/** 解析入参。 */
/**
 * ── **归档状态三态**（2026-10-22 第 13 轮 · 关键修法）──────────────────────────
 *
 * ── 上一版错在哪 ──────────────────────────────────────────────────────
 *   `archived?: boolean`：`undefined` 表示"没传"，于是走 `stored` 分支
 *   ⇒ ⛔ 一旦服务**读不到**归档集合（服务缺席 / getter 抛错 / 返回非数组），
 *     它就把 `undefined` 传下来 ⇒ 解析**当成"未归档"继续放行** `workspace` 高档
 *     ⇒ 直接点名读工具就**绕过了宿主 pre-step**。这是**静默放行**，正是 fail-open。
 *
 * ── 现在：三态，且**不可知 = 拒宽读** ──────────────────────────────────
 *   · `'archived'` —— 从宿主**可信**读到、且该 id **在**集合里；
 *   · `'not-archived'` —— 从宿主**可信**读到**有效集合**、且该 id **明确不在**里；
 *   · `'unknown'` —— 缺席 / 抛错 / 非数组 / 没有身份 ⇒ ⚠ **按已归档对待**（最低档）。
 *
 *   ⚠ **缺省（不传）也等于 `'unknown'`** —— 这样"纯函数调用方忘了传"不会静默放行
 *     （⛔ 不给 fail-open 留默认值）。要放宽**必须显式**说 `'not-archived'`。
 *   ⚠ 只影响 **Hob**：非 Hob 走它自己的既有路径（⛔ 不误挡别人）。
 */
export type ArchiveState = 'archived' | 'not-archived' | 'unknown'

export interface ResolveOptions extends PolicyStoreOptions {
  /** 策略文件路径；`undefined` = 判不出账本（⇒ 保守）。 */
  file: string | undefined
  /** 会话 id；`undefined` = 没有可信身份（⇒ 保守）。 */
  sessionId: string | undefined
  /** 这个会话是不是 Hob（⚠ 由调用方用**宿主投影**判，⛔ 不凭建档头猜）。 */
  isHob: boolean
  /** 会话创建时刻（ms）；`undefined` = 判不出 ⇒ 按**旧会话**处理（收紧，不只是放宽）。 */
  createdAt: number | undefined
  /**
   * ⚠⚠ **切换时刻的旧工作方式快照**（2026-10-22 第 4 轮 · 治启动竞态的核心）。
   *
   * ── 它解决什么 ────────────────────────────────────────────────────
   *   旧会话**没有记录**时（迁移还没写盘），上一版直接回 `defaultMode`（`auto`）
   *   ⇒ 一个原来是 `multi`/`single` 的旧会话，在迁移完成前的第一次 prompt
   *     就会按 `auto` 推进 —— **行为已经变了**，而 `reason` 里写"待迁移"并不能撤销这个改变。
   *   ⇒ 现在由调用方（服务层）在**安装那一刻**同步读一次旧全局值、**固化成快照**传进来；
   *     迁移没落地时就用它 ⇒ 值仍是**原值**，`persistence='snapshot'` 如实标明未写盘。
   *
   * ⚠ 缺席（`undefined`）时**不回落 `defaultMode`**，而是走 `unknown-legacy`：
   *   读档最低 + `mayProceed=false`（安全停下）。理由：拿不到快照就**没有**可信的原值，
   *   给个 `auto` 让它继续跑，正是本批要消灭的那个行为变化。
   */
  legacyWorkModeSnapshot?: string
  /**
   * ⚠⚠ **该会话是否在宿主的持久归档集合里**（2026-10-22 新增）。
   *
   * ── 为什么策略解析必须看它 ────────────────────────────────────────────
   *   创建失败时我们可能已经把 `active:workspace` 写进 policy.json，
   *   而 `quarantine` 又写失败。此时唯一还能用的持久禁用是
   *   `workspaceRegistry.archiveSession(id, {stopActivity:true})` ——
   *   **宿主的 `agent/pre-step` 会拒它**（`ArchivedSessionGate`），
   *   ⚠ 但**本插件的策略解析如果不看归档标志**，四个读工具仍会读到 `workspace`
   *     高档 ⇒ 「读」这一面根本没被挡住 ⇒ 归档等于只挡了一半。
   *   ⇒ 本字段一旦为 `true`，解析**无条件**回最低档 + 不推进、`source='archived'`。
   *
   * ⚠ 来源必须是**宿主的 `workspaceRegistry.archivedSessionIds`**（权威、持久），
   *   ⛔ 不许由调用方自己猜/缓存一份。
   * ⚠ 缺省（`undefined`）= 不知道 ⇒ 行为**与之前完全一致**（向后兼容）。
   */
  archived?: ArchiveState
  /**
   * ⚠⚠ **本插件"第一次看到这个账本"的时刻**（2026-10-24 · 治"纪元从不落盘"）。
   *
   * ── 为什么需要它 ──────────────────────────────────────────────────
   *   盘上没有合法 `migrationEpoch`（文件不存在 / 手写坏了 / 旧版本）时，
   *   **不能**再拿"此刻"当纪元：`now` 是**读的那一刻**，永远晚于任何刚建的会话
   *   ⇒ `createdAt < epoch` 恒真 ⇒ 所有新会话被误判成旧会话并放行（实测 1 秒前的会话即中招）。
   *   ⇒ 由服务层在**安装那一刻**取一次时间传进来：它比任何"本进程之后建的会话"早、
   *     又比"本进程启动前就存在的会话"晚 ⇒ 用它判新旧是**安全**的（旧会话仍判旧、新会话判新）。
   *
   * ⚠ 缺省（不传）时若盘上也没有纪元 ⇒ 走 `unknown-legacy`（不推进），⛔ 不猜。
   * ⚠ 它**不写盘**：落盘由 {@link ensurePolicyStoreEpoch} 负责（服务层在安装时调）。
   */
  fallbackEpoch?: number
  /** 现在（ms）。 */
  now?: number
}

/**
 * **唯一**的策略解析入口：所有闸门都调它，⛔ 不许各自再算一份。
 *
 * ⚠ 判定顺序（改顺序 = 改安全语义，⛔ 别动）：
 *   ① 非 Hob ⇒ `non-hob`（调用方保持既有行为）；
 *   ② 没有 sessionId ⇒ `no-identity`（**最低档**；⛔ 不读工作区）；
 *   ③ 没有账本路径 / 文件读不了 / 版本不认识 ⇒ 保守分支；
 *   ④ 有记录 ⇒ `stored`；
 *   ⑤ 无记录 + 会话早于迁移纪元 ⇒ **旧会话**：`ledger` + 迁移时固化的工作方式（`legacy-migrated`）；
 *   ⑥ 无记录 + 会话不早于迁移纪元 ⇒ **新会话未选**：`ledger` + 安全缺省（`derived-default`），
 *      **`mayProceed=true`**（2026-10-24 改；读档**仍是最低档**，原因见该分支注释）。
 *
 * ⚠⚠ **纪元必须可信**（2026-10-24）：`migrationEpoch` 只能来自**盘上真的写了**的那个数
 *   （`reading.epochDeclared === true`）。盘上没有/读不出 ⇒ 用调用方给的
 *   `fallbackEpoch`（= 本进程安装时刻）；两者都没有 ⇒ **判不出新旧**，
 *   按 `unknown-legacy`（最低档 + 不推进）—— ⛔ 绝不拿"此刻"当纪元。
 */
export function resolveSessionPolicy(o: ResolveOptions): PolicyResolution {
  const floor = o.floorLevel
  const safeMode = o.defaultMode
  /**
   * ⚠ `canReadWorkspace` 的判据 = **不是最低档**（且确实是合法档）——
   *   与 `workspace-read.ts` 的 `isAllowedForLevel()` 同义：最低档 `false`，
   *   其上两档才可能读到工作区（`project` 只 `.md`、`workspace` 任意文件，
   *   那一步的类型门由读工具自己的 `execute` 负责，⛔ 不由本函数代判）。
   *   ⚠ 刻意**不**用"枚举数组最后一项"来推 ⇒ 调用方传枚举的顺序不参与安全语义。
   */
  const canRead = (level: string): boolean => o.levels.includes(level) && level !== floor
  const base = (
    level: string,
    workMode: string,
    source: PolicyResolution['source'],
    reason: string,
    isHob: boolean,
    persistence: PolicyResolution['persistence'],
    mayProceed: boolean,
  ): PolicyResolution => ({
    isHob,
    level,
    workMode,
    source,
    reason,
    canReadWorkspace: isHob && canRead(level),
    persistence,
    mayProceed,
  })

  /**
   * ⚠ 快照是否**可用**：必须是合法枚举之一。
   *   非法/缺席 ⇒ 视为"没有可信原值"（⛔ 不拿它当值，也不拿 `defaultMode` 顶替）。
   */
  const snapshotMode = ((): string | undefined => {
    const v = o.legacyWorkModeSnapshot
    return typeof v === 'string' && o.modes.includes(v) ? v : undefined
  })()

  // ① 非 Hob ⇒ 本模块不参与。⚠ `persistence` 记 `persisted`：本来就不该写，谈不上未落盘。
  if (!o.isHob) {
    return base(floor, safeMode, 'non-hob', '非 Hob 会话：本模块不参与', false, 'persisted', true)
  }
  // ② 无身份 ⇒ 拒绝一切（读档最低、不推进）。
  if (typeof o.sessionId !== 'string' || o.sessionId === '') {
    return base(floor, safeMode, 'no-identity', '取不到可信 sessionId ⇒ 按最低可读档；⛔ 不读工作区', true, 'persisted', false)
  }
  if (o.file === undefined) {
    return base(floor, safeMode, 'no-identity', '判不出账本目录（无法定位策略文件）⇒ 按最低可读档', true, 'persisted', false)
  }

  const reading = readPolicyStore(o.file, o, o.now ?? Date.now())
  /**
   * ③ 坏存储 / 版本不认识 ⇒ **不覆盖、不升读**。
   *   ⚠ `mayProceed=false`：此时我们**根本不知道**这个会话原来用什么方式
   *     （文件坏了 ⇒ 连它有没有记录都读不出来）⇒ 拿 `auto` 让它继续跑就是行为变化。
   */
  if (reading.reachability === 'unreadable' || reading.reachability === 'version-unknown') {
    return base(
      floor, safeMode,
      reading.reachability === 'unreadable' ? 'store-unreadable' : 'version-unknown',
      reading.reason + '；⚠ 因此**不知道**本会话原来的工作方式 ⇒ 本次不推进（⛔ 不拿缺省顶替）',
      true, 'persisted', false,
    )
  }

  // ④ 有记录 ⇒ 唯一可信来源。⚠ **但先看隔离标记**（它优先级最高，见下）
  const rec = reading.file.sessions[o.sessionId]
  /**
   * ⚠⚠ **隔离优先于记录值**（2026-10-22 · 治 `stranded`）。
   *
   *   顺序**不可换**：必须先判 `quarantined` 再读 `rec.level`。
   *   否则"回读不一致、盘上留了 workspace 档、又被隔离"这条记录会被
   *   `'stored'` 分支当成**可信高档**返回 ⇒ 隔离形同虚设。
   *
   *   ⚠ `level` 字段**保留原值不抹**（审计要能看出"曾经写过哪一档"），
   *     但**对外读数一律最低档**、且 `mayProceed=false`。
   *   ⚠ `persistence='persisted'`：隔离标记**在盘上**（它是随记录一起写下去的），
   *     所以重载后依然生效 —— 这正是"持久"二字的落点。
   */
  /**
   * ⚠⚠ **归档优先于一切**（2026-10-22 · 本单第二核心）。
   *
   *   顺序：`archived` → `quarantined` → `pending` → `stored`。
   *   ⚠ **必须在 `stored` 之前**：否则归档会话会被当成"可信高档"返回
   *     ⇒ 四个读工具照读高档 ⇒ 归档只挡住了宿主的 step（跑），没挡住读。
   *   ⚠ 也**必须在 `quarantined` 之前**：归档是更强的持久事实（宿主级），
   *     两者同时为真时报"已归档"更准确。
   *   ⚠ 即便 `level` 写着 `workspace` / `activation` 是 `active`，
   *     这里一律压到最低档 + 不推进（"无条件"）。
   */
  /**
   * ⚠⚠ **归档三态判定**（2026-10-22 第 13 轮重写）
   *
   *   · `'archived'`     ⇒ 拒（最低档 + 不推进）；
   *   · `'unknown'`（含**不传**）⇒ **也拒**（⚠ 这正是本轮修的 fail-open）；
   *   · `'not-archived'` ⇒ **只有这一种**才继续走下面的记录判定。
   *
   *   ⚠ 为什么 `unknown` 必须拒：读不到归档集合时我们**无法证明**它没被归档
   *     ⇒ 按"已归档"处理才是安全侧。⛔ 不能按"未归档"放行（那是 fail-open）。
   *   ⚠ 只对 **Hob** 生效：非 Hob 的用户没有"两轴策略"这回事，
   *     拦它会是**误挡**（比不拦更坏）。⇒ 见下面 `isHob` 条件。
   */
  const archiveState: ArchiveState = o.archived ?? 'unknown'
  if (o.isHob && archiveState !== 'not-archived') {
    const reallyArchived = archiveState === 'archived'
    return base(
      floor, safeMode, reallyArchived ? 'archived' : 'archive-unknown',
      reallyArchived
        ? '该会话**已被持久归档**（宿主的 `archivedSessionIds` 命中）⇒ 读档=最低、**不推进**；'
          + '宿主 `agent/pre-step` 也会拒绝它的模型步。'
        : '**宿主的归档状态读不到**（服务缺席 / 读取抛错 / 返回格式不对）'
          + '⇒ 无法证明它没被归档 ⇒ 按**最保守**处理：读档=最低、**不推进**、不能读工作区。'
          + '⚠ 这不是"该会话没归档"，而是"我们不知道" —— 恢复归档服务后会自动按真实状态判定。',
      true, 'persisted', false,
    )
  }
  if (rec !== undefined && rec.quarantined === true) {
    return base(
      floor, safeMode, 'quarantined',
      `该会话的策略**已被隔离**（记录里的原档位 = \`${rec.level}\`，已作废）⇒ 读档=最低、**本次不推进**；`
      + '隔离标记随记录落盘 ⇒ 重启/重载后仍然生效。'
      + '⚠ 要恢复请从插件入口新建会话并在创建时选定两项。',
      true, 'persisted', false,
    )
  }
  /**
   * ⚠⚠ **未确认（`activation:'pending'`）⇒ 一律最低档 + 不推进**（2026-10-22）。
   *
   *   顺序：先 `quarantined`（作废）再 `pending`（未确认）再 `stored`（可信）。
   *   ⚠ 这一步是"**未确认状态绝不激活宽档**"的落点：创建链先写 `pending`，
   *     只有 `activate()` 成功并回读确认后才变 `active`。
   *   ⇒ 在 `activate()` **之前**的任何失败（写失败/回读不符/回收失败），
   *     盘上即使留着 `level:'workspace'`，解析也是**最低档** ⇒ **不可执行宽档**。
   *   ⚠ `source='pending-activation'`：单独一个值，⛔ 不并进 `stored`，
   *     这样"为什么降级"在读数里看得见。
   */
  if (rec !== undefined && rec.activation === 'pending') {
    return base(
      floor, safeMode, 'pending-activation',
      `该会话的策略**尚未确认生效**（记录里原档位 = \`${rec.level}\`）⇒ 读档=最低、**本次不推进**；`
      + '确认成功之后才会按你选的档位执行。',
      true, 'persisted', false,
    )
  }
  if (rec !== undefined) {
    return base(rec.level, rec.workMode, 'stored', `记录来源 ${rec.origin}`, true, 'persisted', true)
  }

  // 无记录：区分旧会话 / 新会话
  /**
   * ⚠⚠ **纪元必须可信**（2026-10-24 本轮修的一条）。
   *
   * ── 改前错在哪（实测复现）──────────────────────────────────────────
   *   `readPolicyStore` 在"文件不存在 / 文件里没有 `migrationEpoch`"时**用 `now` 编一个纪元**
   *   ⇒ `createdAt < epoch` 对**任何刚建的会话都成立** ⇒ 新会话被判成 `legacy-migrated`
   *   并 `mayProceed=true` 放行（实测：1 秒前建的会话被当旧会话）。
   *   ⚠ 而 `now` 是**读的那一刻**，`createdAt` 一定早于它 ⇒ 这不是概率问题，是必然。
   *
   * ── 现在的判据 ─────────────────────────────────────────────────────
   *   ① 盘上**确实写了**纪元（`epochDeclared`）⇒ 用盘上的（唯一可信来源）；
   *   ② 盘上没有 ⇒ 用调用方给的 `fallbackEpoch`（= 本进程**安装时刻**）：
   *      它早于"本进程之后建的任何会话"、又晚于"本进程启动前就存在的老会话"
   *      ⇒ 判新旧仍然正确；服务层还会在安装时把它**落盘**（见 `ensurePolicyStoreEpoch`）；
   *   ③ 两者都没有 ⇒ **判不出**新旧 ⇒ `unknown-legacy`（最低档 + 不推进）。
   *      ⛔ 绝不拿 `now` 当纪元 —— 那必然把所有会话判成旧会话。
   */
  const epoch = reading.epochDeclared
    ? reading.file.migrationEpoch
    : (typeof o.fallbackEpoch === 'number' && Number.isFinite(o.fallbackEpoch) ? o.fallbackEpoch : undefined)
  if (epoch === undefined) {
    return base(
      floor, safeMode, 'unknown-legacy',
      '**判不出迁移纪元**（盘上没有、调用方也没给安装时刻）⇒ 无法区分旧会话与新会话；'
      + '⚠ **本次不推进**（⛔ 不拿"此刻"当纪元：那样任何新会话都会被当成旧会话而放行）',
      true, 'snapshot', false,
    )
  }
  /**
   * ⚠⚠ **这一支是本轮的核心修复**（2026-10-22 第 4 轮）。
   *
   * ── 三条判决，按"我们能不能说出原值"排 ──────────────────────────────
   *   a. **确定是旧会话**（`createdAt < epoch`）且**有快照** ⇒
   *      `level=最低` + `workMode=快照里的原值` + `persistence='snapshot'`
   *      ⇒ **可以推进**（值就是原值），但必须外报"尚未落盘"。
   *   b. **确定是旧会话**但**没有快照** ⇒ `unknown-legacy` + `mayProceed=false`。
   *      ⛔ 不拿 `auto` 顶替 —— 那正是"先给新方式再偷偷改"。
   *   c. **创建时刻取不到** ⇒ 不知道新旧 ⇒ 同样 `unknown-legacy` + 不推进。
   *      ⚠ 这一条比上一版**更紧**：上一版把"判不出"也归到旧会话并给 `auto`，
   *        等于把"可能改写行为"的情形当普通情形处理。
   */
  const createdAtKnown = o.createdAt !== undefined
  const isLegacy = createdAtKnown && o.createdAt! < epoch
  if (isLegacy) {
    if (snapshotMode !== undefined) {
      return base(
        floor, snapshotMode, 'legacy-migrated',
        '旧会话（尚无记录）：读档=最低；工作方式=**切换时刻快照的原值**'
        + '（⚠ 持久化尚未完成，值本身已是原值、不会在后续被改成缺省）',
        true, 'snapshot', true,
      )
    }
    return base(
      floor, safeMode, 'unknown-legacy',
      '旧会话（尚无记录）且**取不到切换时刻的工作方式快照** ⇒ 读档=最低；'
      + '⚠ **本次不推进**（⛔ 不拿安全缺省 auto 当最终方式 —— 那会静默改变原工作方式）',
      true, 'snapshot', false,
    )
  }
  if (!createdAtKnown) {
    /**
     * ⚠ 创建时刻读不到 ⇒ **既可能是旧会话、也可能是新会话**。
     *   新会话给 `auto` 是"还没选"（无害）；但旧会话给 `auto` 就是**改写**。
     *   ⇒ 两种都可能时，取**更安全**的那一边：不推进。
     *   ⚠ 这不是"过度保守"——创建时刻是本仓已有的可信字段
     *     （`dsh-session/lib/index.js` 的 `validateSessionHeader` 保证它是非负安全整数），
     *     读不到本身就是一个**异常状态**，值得停下来。
     */
    return base(
      floor, safeMode, 'unknown-legacy',
      '创建时刻取不到 ⇒ 无法区分旧会话与新会话；'
      + '⚠ **本次不推进**（给 auto 对旧会话等于改写其工作方式）',
      true, 'snapshot', false,
    )
  }
  /**
   * ⑥ 新会话、**未做两项选择** ⇒ 最低档 + **允许推进**（2026-10-24 · 用户裁定 1(a)）。
   *
   * ══ 改前的口径（⚠ 历史，别再改回去）═════════════════════════════════
   *   2026-10-22 的回数是 `mayProceed=false`，理由写在当时的注释里：
   *   "REQ-04 要求未选两项就不能继续推进；宿主**直接**建 Hob（`session/create` / CLI /
   *    别的插件）不经过我们的弹窗 ⇒ 若这里放行，那种会话就会在用户从未选择的情况下
   *    按 auto 派活/写账本，等于'用户批准的双轴创建'被静默绕过。"
   *   ⚠ 那个理由**本身没错**，但它换来的是**死锁**（2026-10-24 实测）：
   *     新建 Hob 会话在用户还没选档时 → `derived-default/mayProceed:false`
   *     → `proceedGateFor` 拒掉 `hob_spawn` / `hob_send`，**连"建 standard 实施会话"都被拒**
   *     → 用户没法干活，也没法通过任何工具补上选择（弹窗要先有会话）。
   *
   * ══ 现在的口径（用户 2026-10-24 裁定 1）═══════════════════════════════
   *   裁定原文要点：**两条都做** ——
   *     (a) 允许 `hob_spawn` / `hob_send` 派活与建会话（解开死锁）；
   *     (b) 同时补完"选档记录落盘链"，让记录一定能写进去
   *         （本轮补的写入口闸 + 路由 `action:'write'` 的 isHob/开放面校验就是这条）。
   *   ⇒ 本支改为 `mayProceed=true`，**但读档仍然给 `floor`（最低档）**：
   *     放行只放宽"能不能动手"，⛔ **没有**放宽"能看见什么"。
   *     选档之后走 `stored` 分支，按用户所选执行。
   *   ⚠ 仍然**不写记录**（`persistence='persisted'` 指"本来就不该写"，
   *     不是"写了没落盘"）：把"没选"写成"选过了"会让弹窗再也不弹。
   *   ⚠ `source='derived-default'` **保持不变** —— 它让"这条会话还没选过"在读数里可见，
   *     UI 的"未选档位"横幅（`hob-unselected-gate`）正是靠它 + `recorded:false` 工作。
   *
   * ══ 为什么这不是"放开一切"（防下一个人误判为回归）═════════════════════
   *   · **旧会话**（`isLegacy`）走上面 ③a/③b：有快照 ⇒ 按快照原值推进；**没快照 ⇒ 仍 `mayProceed=false`**；
   *   · **判不出新旧**（`unknown-legacy` / 坏文件 / 版本不认识 / 无身份 / 归档 / 隔离 / pending）
   *     ⇒ 全部**仍然不推进**（一个字没动）；
   *   · **非 Hob** 走 ①：`mayProceed=true`（本模块不参与），行为一行未变。
   *   ⇒ 本轮只放宽**这一支**：确定是新会话、确定还没选过、读档确定是最低档。
   */
  return base(
    floor, safeMode, 'derived-default',
    '新会话**尚未做两项选择** ⇒ 读档=最低档，**允许推进**（2026-10-24 用户裁定：先解开死锁）'
    + '；选定可读档 / 工作方式之后按所选执行'
    + '（⚠ 这条会话还没有选择记录，界面的"未选档位"提示会照常出现）',
    true, 'persisted', true,
  )
}

/**
 * 显式设置一条会话策略（将来弹窗 / 显式入站接口的唯一写入口）。
 *
 * ⚠ 校验：枚举外的值**直接拒**（可读原因），⛔ 不做"就近归一"。
 * ⚠ 原子写；写完返回**回读校验**结果（⛔ 不只看 write 返回值就当成功）。
 */
export function setSessionPolicy(
  file: string,
  input: {
    sessionId: string
    level: string
    workMode: string
    now?: number
    /**
     * ⚠ **写入模式**（2026-10-22）：
     *   · `'pending'` —— 创建链用：写进去但**先不生效**（解析期最低档+不推进）；
     *   · 缺省 `'active'` —— 既有调用方的行为**一个字不变**（向后兼容）。
     */
    activation?: 'pending' | 'active'
    /**
     * ⚠ **盘上没有可信纪元时的下落值**（2026-10-24 · 见 `epochForWrite`）。
     *   · 产品路径（服务层）传"本进程安装时刻" ⇒ 新会话不会被写成旧会话；
     *   · 不传 ⇒ 退 `now`（⚠ 纯库调用方的既有行为，但**至少会写下去**，
     *     不再出现"每次读都是新纪元"的漂移）。
     */
    epochFallback?: number
  },
  opts: PolicyStoreOptions,
): { ok: boolean; reason: string } {
  const { sessionId, level, workMode } = input
  if (typeof sessionId !== 'string' || sessionId === '') return { ok: false, reason: 'sessionId 为空 ⇒ 拒绝写入' }
  if (!opts.levels.includes(level)) return { ok: false, reason: `可读档 ${JSON.stringify(level)} 不在合法枚举里` }
  if (!opts.modes.includes(workMode)) return { ok: false, reason: `工作方式 ${JSON.stringify(workMode)} 不在合法枚举里` }
  const now = input.now ?? Date.now()
  const reading = readPolicyStore(file, opts, now)
  if (reading.reachability === 'unreadable' || reading.reachability === 'version-unknown') {
    // ⚠ 坏文件不覆盖：覆盖会**静默丢掉**别人的记录。⇒ 拒绝写并给可读原因。
    return { ok: false, reason: `现有策略文件不可用（${reading.reason}）⇒ 拒绝覆盖写入` }
  }
  /**
   * ⚠⚠ **隔离标记闸门**（2026-10-23 · P0-2）：`quarantined` 只能由
   *   `quarantineSessionPolicy` 写入，⛔ 任何普通写入都不许把它**抹掉**。
   *
   * ── 改前是什么（这就是本单要治的）────────────────────────────────────
   *   下面那条写入是 `{...sessions, [sessionId]: {全新记录}}` —— **整条替换**，
   *   而新记录里没有 `quarantined` 字段 ⇒ 对一个**已被隔离**的会话再打一次普通写，
   *   标记就**静默消失**，而函数仍返回 `ok:true`。
   *   ⇒ 隔离（"这条记录已作废"）可以被一次普通写入**无声撤销**。
   *
   * ── 为什么是本函数漏了，而不是设计取舍 ────────────────────────────────
   *   同批的 `activateSessionPolicy` 有闸（`prev.quarantined === true ⇒ 拒`）、
   *   `quarantineSessionPolicy` 自己写 `quarantined:true`、解析器（`resolveSessionPolicy`）
   *   认这个标记 ⇒ 三个写函数里**只有这一个**漏了闸。
   *
   * ⚠ 顺序：闸门必须在**构造新 state 之前**、在**坏文件判定之后**
   *   （否则读不到旧记录时无法判断，而坏文件本来就已经被上面那条拒掉了）。
   */
  const prev = reading.file.sessions[sessionId]
  if (prev !== undefined && prev.quarantined === true) {
    return {
      ok: false,
      reason: '该会话的策略**已被隔离**（`quarantined:true`，原记录已作废）⇒ 拒绝普通写入'
        + '（⛔ 不许用一次普通写把作废标记抹掉；要恢复请从插件入口新建会话并重新选定两项）',
    }
  }
  const state: SessionPolicyFile = {
    version: POLICY_STATE_VERSION,
    migrationEpoch: epochForWrite(reading, now, input.epochFallback),
    sessions: {
      ...reading.file.sessions,
      [sessionId]: {
        level,
        workMode,
        origin: 'explicit',
        at: now,
        /**
         * ⚠ 只有调用方**显式**要 `pending` 才写这个字段；
         *   缺省**不写**（= `active`，与既有记录同形）⇒ 既有调用方零影响。
         */
        ...(input.activation === 'pending' ? { activation: 'pending' as const } : {}),
      },
    },
  }
  const w = writePolicyStore(file, state)
  if (!w.ok) return w
  const back = readPolicyStore(file, opts, now)
  const got = back.file.sessions[sessionId]
  if (got === undefined || got.level !== level || got.workMode !== workMode) {
    return { ok: false, reason: '写入后回读不一致 ⇒ 视为失败（⛔ 不报成功）' }
  }
  // ⚠ pending 必须**真的**落成 pending（否则"未确认不激活"是空话）
  if (input.activation === 'pending' && got.activation !== 'pending') {
    return { ok: false, reason: '写入后回读**不是 pending** ⇒ 视为失败（⛔ 不报"已暂存"）' }
  }
  return { ok: true, reason: '' }
}

/**
 * ── **确认生效**：把 `pending` 记录改成 `active`（2026-10-22）──────────────────
 *
 * **用于**：创建链在"写两值 → 回读一致"**之后**才调用它。
 *   ⇒ 在这**之前**的任何失败都停在 `pending` ⇒ 解析期最低档 + 不推进
 *     ⇒ **未确认绝不激活宽档**。
 *
 * ⚠ **回读必须确认 `activation` 不再是 `'pending'`** ——
 *   否则"它报成功但盘上还是 pending"会被当成生效（那就是又一次谎报）。
 * ⚠ 本函数**只在记录存在时**有意义：记录不存在 ⇒ 返回失败（⛔ 不凭空造一条 active）。
 */
export function activateSessionPolicy(
  file: string,
  /**
   * ⚠ `epochFallback` 同 `setSessionPolicy`：盘上没有可信纪元时用它（⛔ 不用 `now` 去覆盖历史）。
   */
  input: { sessionId: string; now?: number; epochFallback?: number },
  opts: PolicyStoreOptions,
): { ok: boolean; reason: string } {
  const { sessionId } = input
  if (typeof sessionId !== 'string' || sessionId === '') {
    return { ok: false, reason: 'sessionId 为空 ⇒ 无法确认生效' }
  }
  const now = input.now ?? Date.now()
  const reading = readPolicyStore(file, opts, now)
  if (reading.reachability === 'unreadable' || reading.reachability === 'version-unknown') {
    return { ok: false, reason: `现有策略文件不可用（${reading.reason}）⇒ 拒绝激活` }
  }
  const prev = reading.file.sessions[sessionId]
  if (prev === undefined) {
    return { ok: false, reason: '该会话没有策略记录 ⇒ 拒绝激活（⛔ 不凭空造 active 记录）' }
  }
  if (prev.quarantined === true) {
    return { ok: false, reason: '该会话的策略已被**隔离** ⇒ 拒绝激活（⛔ 不许把作废记录复活）' }
  }
  const state: SessionPolicyFile = {
    version: POLICY_STATE_VERSION,
    migrationEpoch: epochForWrite(reading, now, input.epochFallback),
    // ⚠ 显式写 `active`（而不是删字段）：让"确认过"这件事在盘上**可审计**
    sessions: { ...reading.file.sessions, [sessionId]: { ...prev, activation: 'active' as const } },
  }
  const w = writePolicyStore(file, state)
  if (!w.ok) return { ok: false, reason: `激活写盘失败：${w.reason}` }
  const back = readPolicyStore(file, opts, now)
  const got = back.file.sessions[sessionId]
  if (got === undefined || got.activation === 'pending') {
    return { ok: false, reason: '激活后回读**仍是 pending**（读不到 active）⇒ 视为失败' }
  }
  // ⚠ 激活**不许**悄悄改了用户选的值
  if (got.level !== prev.level || got.workMode !== prev.workMode) {
    return { ok: false, reason: '激活后回读的档位/方式与写入时不一致 ⇒ 视为失败' }
  }
  return { ok: true, reason: '' }
}

/**
 * ── **持久隔离**：把已有记录标记为作废（2026-10-22 · 治 `stranded` 残留高档）───────
 *
 * **用于**：创建链"`set` 成功 + 回读不一致 + 空白会话撤不掉"这一格 ——
 *   盘上可能已经是高档，⛔ 只报 `stranded` 不算修好（那个会话仍能按高档执行）。
 *
 * **语义**：把该 `sessionId` 的记录**改写**成 `quarantined: true`（**保留原 `level` 供审计**），
 *   落盘 + **回读确认隔离标记真的在盘上**。⛔ 回读不到 `quarantined` ⇒ 视为失败。
 *
 * ⚠ **它不删除记录**：删了会把会话打回"无记录"，而旧会话无记录语义不确定（见记录类型注释）。
 * ⚠ **失败即失败**：返回 `ok:false`，由调用方**停手并如实报**"无法保证隔离"
 *   —— ⛔ 绝不在隔离失败时仍宣称"残留会话是安全的"。
 */
export function quarantineSessionPolicy(
  file: string,
  /** ⚠ `epochFallback` 同上：盘上没有可信纪元时用它。 */
  input: { sessionId: string; reason?: string; now?: number; epochFallback?: number },
  opts: PolicyStoreOptions,
): { ok: boolean; reason: string } {
  const { sessionId } = input
  if (typeof sessionId !== 'string' || sessionId === '') {
    return { ok: false, reason: 'sessionId 为空 ⇒ 无法隔离' }
  }
  const now = input.now ?? Date.now()
  const reading = readPolicyStore(file, opts, now)
  if (reading.reachability === 'unreadable' || reading.reachability === 'version-unknown') {
    return { ok: false, reason: `现有策略文件不可用（${reading.reason}）⇒ 无法隔离（⛔ 不覆盖坏文件）` }
  }
  const prev = reading.file.sessions[sessionId]
  /**
   * ⚠ **没有记录也要能隔离**：最坏情形下"写成功但回读不一致"可能意味着
   *   我们连记录有没有写进去都不确定。
   *   ⚠⚠ 但**不能**伪造 `level:'unknown'` —— `asRecord()` 是**枚举白名单**
   *   （`level` 必须在 `opts.levels` 里），写 `'unknown'` 会被**读回时丢掉整条**
   *   ⇒ 隔离"写进去但读不出来"（本轮实测就是这个坑）。
   *   ⇒ 改用**合法地板值**：`level = floorLevel`、`workMode = defaultMode`，
   *     并**同时**打 `quarantined` ⇒ 记录一定可读回，而解析期只看隔离标记
   *     ⇒ 读数仍是"最低档 + 不推进"，且**不撒谎**（它本来就没有可信原值）。
   */
  const base: SessionPolicyRecord = prev ?? {
    level: opts.floorLevel,
    workMode: opts.defaultMode,
    origin: 'explicit',
    at: now,
  }
  const state: SessionPolicyFile = {
    version: POLICY_STATE_VERSION,
    migrationEpoch: epochForWrite(reading, now, input.epochFallback),
    sessions: { ...reading.file.sessions, [sessionId]: { ...base, quarantined: true } },
  }
  const w = writePolicyStore(file, state)
  if (!w.ok) return { ok: false, reason: `隔离写盘失败：${w.reason}` }
  // ⚠ **回读确认隔离标记真的落盘了** —— ⛔ 不拿 write 的返回值当成功
  const back = readPolicyStore(file, opts, now)
  const got = back.file.sessions[sessionId]
  if (got === undefined || got.quarantined !== true) {
    return {
      ok: false,
      reason: '隔离写入后**回读不到隔离标记** ⇒ 视为失败'
        + '（⛔ 不宣称已隔离：重载后它可能仍是高档）',
    }
  }
  return { ok: true, reason: '' }
}

/**
 * 旧会话一次性迁移：给"没有记录且早于迁移纪元"的 Hob 会话补一条
 * `{ level: floor, workMode: 迁移时生效值 }`。
 *
 * ⚠ **幂等**：已有记录不覆盖（⛔ 不把用户后来选的宽档改回最低）。
 * ⚠ 没有账本 / 没有会话 id ⇒ 跳过并回可读原因（⛔ 不猜）。
 */
export function ensureLegacyMigrated(
  file: string,
  sessions: ReadonlyArray<{ sessionId: string; createdAt: number | undefined }>,
  legacyWorkMode: string,
  opts: PolicyStoreOptions,
  now: number = Date.now(),
  /**
   * ⚠ **盘上没有可信纪元时的下落值**（2026-10-24 · 见 `epochForWrite`）。
   *   ⚠ 不传 ⇒ 退 `now`：那会把"读的那一刻"写成纪元 ⇒ 之后建的会话被判成旧会话。
   *     产品路径（服务层）**先**调 `ensurePolicyStoreEpoch` 钉住安装时刻，故这里通常用不上。
   */
  epochFallback?: number,
): { migrated: string[]; reason: string } {
  const reading = readPolicyStore(file, opts, now)
  if (reading.reachability === 'unreadable' || reading.reachability === 'version-unknown') {
    return { migrated: [], reason: `策略文件不可用（${reading.reason}）⇒ 本次不迁移` }
  }
  const state: SessionPolicyFile = {
    version: POLICY_STATE_VERSION,
    migrationEpoch: epochForWrite(reading, now, epochFallback),
    sessions: { ...reading.file.sessions },
  }
  const migrated: string[] = []
  for (const s of sessions) {
    if (typeof s.sessionId !== 'string' || s.sessionId === '') continue
    if (state.sessions[s.sessionId] !== undefined) continue
    // ⚠ 只迁**旧**会话；新会话保持"未选"（不写记录），否则会把"没选"变成"选过了"。
    if (s.createdAt !== undefined && s.createdAt >= state.migrationEpoch) continue
    if (!opts.modes.includes(legacyWorkMode)) continue
    state.sessions[s.sessionId] = { level: opts.floorLevel, workMode: legacyWorkMode, origin: 'legacy-migrated', at: now }
    migrated.push(s.sessionId)
  }
  if (migrated.length === 0) return { migrated, reason: reading.reachability === 'absent' ? '尚无记录，且没有可迁移的旧会话' : '' }
  ensurePolicyDirIgnored(dirname(file))
  const w = writePolicyStore(file, state)
  if (!w.ok) return { migrated: [], reason: w.reason }
  return { migrated, reason: '' }
}

/**
 * 一次**按工作区/账本文件分组**的旧会话迁移（2026-10-22 第 3 轮）。
 *
 * ══ 它修的是哪个缺陷 ═══════════════════════════════════════════════════════
 *   上一版 `service.migrateLegacy(sessions)` 只做两件事：
 *     `const file = policyFileFor(hostCtx, sessions[0])` —— **用第一条会话定文件**；
 *     `sessions.map(...)` —— **把全部会话原样喂给那一份文件**。
 *   ⇒ 两个方向的错，都是数据错：
 *     · **跨工作区串写**：A、B 两个工作区的会话都写进 A 的账本 ⇒ B 的记录落在 B 读不到的地方；
 *     · **非 Hob 混入**：非 Hob 会话被写成 Hob 策略记录 ⇒ 本机制越界管了别人。
 *   ⚠ 这两个都不是"风格问题"：前者让"旧会话保住工作方式"变成**假保全**（记录写错了地方），
 *     后者让`isHob=false` 的语义失效。
 *
 * ══ 现在的口径 ═══════════════════════════════════════════════════════════
 *   · **按 `file` 分组**：每个账本文件单独读-改-写，⛔ 不共用一个 `state`；
 *   · **由调用方负责"这条会话确实是已存在的旧 Hob"**（`isHob` / 投影读取在服务层做，
 *     ⚠ 因为纯库不碰宿主服务）；本函数**只**再核两道**它自己能核的**：
 *     ① `createdAt < migrationEpoch`（旧会话）；② 已有记录 ⇒ **跳过**（⛔ 不覆盖显式选择）。
 *   · **每组独立成败**：某个工作区写失败**不能**让别的工作区"看起来也成功了"
 *     ⇒ 返回逐组读数，调用方据此如实报告"哪些保住了 / 哪些没保住"。
 *
 * ⚠ **幂等**：已有记录一律跳过，所以重复调用不会改写任何已固化的工作方式。
 * ⚠ **一次性快照**：`legacyWorkMode` 由调用方在**切换时**读一次传进来
 *   ⇒ 之后改旧全局配置**不会**影响任何已迁移会话（本函数不再读任何全局值）。
 *
 * @param groups - 按账本文件分好组的会话（⚠ 同一条会话**不得**出现在两个组里）。
 * @param legacyWorkMode - **切换那一刻**的旧全局工作方式（一次性快照）。
 * @param opts - 枚举与最低档。
 * @param now - 现在（ms）。
 * @returns 逐文件读数：`migrated` / `skipped`（已有记录或非旧会话）/ 失败原因。
 */
export function ensureLegacyMigratedByFile(
  groups: ReadonlyArray<{ file: string; sessions: ReadonlyArray<{ sessionId: string; createdAt: number | undefined }> }>,
  legacyWorkMode: string,
  opts: PolicyStoreOptions,
  now: number = Date.now(),
  /** ⚠ 同 `ensureLegacyMigrated` 的 `epochFallback`（盘上没有可信纪元时用它）。 */
  epochFallback?: number,
): LegacyMigrationReport {
  const perFile: LegacyFileOutcome[] = []
  /** ⚠ 防御：同一条会话出现在两个组里 ⇒ 说明分组逻辑坏了，**这条不迁**（⛔ 不猜哪个对）。 */
  const seen = new Map<string, number>()
  for (const g of groups) {
    for (const s of g.sessions) seen.set(s.sessionId, (seen.get(s.sessionId) ?? 0) + 1)
  }

  for (const g of groups) {
    const file = g.file
    const outcome: LegacyFileOutcome = {
      file, migrated: [], skipped: [], ok: true, reason: '',
    }
    // ⚠ 工作方式不在枚举里 ⇒ 整组不写（⛔ 不写一个非法值，也不拿缺省顶替后自称"已保全"）。
    if (!opts.modes.includes(legacyWorkMode)) {
      outcome.ok = false
      outcome.reason = `迁移用的工作方式 ${JSON.stringify(legacyWorkMode)} 不在合法枚举里 ⇒ 本组不写（⛔ 不用缺省顶替）`
      perFile.push(outcome)
      continue
    }
    const reading = readPolicyStore(file, opts, now)
    if (reading.reachability === 'unreadable' || reading.reachability === 'version-unknown') {
      outcome.ok = false
      outcome.reason = `策略文件不可用（${reading.reason}）⇒ 本组不迁移（⛔ 不覆盖坏文件）`
      perFile.push(outcome)
      continue
    }
    const state: SessionPolicyFile = {
      version: POLICY_STATE_VERSION,
      migrationEpoch: epochForWrite(reading, now, epochFallback),
      sessions: { ...reading.file.sessions },
    }
    for (const s of g.sessions) {
      if (typeof s.sessionId !== 'string' || s.sessionId === '') { outcome.skipped.push('(空 id)'); continue }
      if ((seen.get(s.sessionId) ?? 0) > 1) {
        // ⚠ 同一条会话被归到多个文件 ⇒ 不写（写哪个都可能是错的）
        outcome.skipped.push(s.sessionId)
        continue
      }
      if (state.sessions[s.sessionId] !== undefined) { outcome.skipped.push(s.sessionId); continue }
      // ⚠ 只迁**旧**会话：新会话保持"未选"（⛔ 不能把"没选"写成"选过了"）
      if (s.createdAt !== undefined && s.createdAt >= state.migrationEpoch) { outcome.skipped.push(s.sessionId); continue }
      state.sessions[s.sessionId] = {
        level: opts.floorLevel,
        workMode: legacyWorkMode,
        origin: 'legacy-migrated',
        at: now,
      }
      outcome.migrated.push(s.sessionId)
    }
    if (outcome.migrated.length === 0) { perFile.push(outcome); continue }
    ensurePolicyDirIgnored(dirname(file))
    const w = writePolicyStore(file, state)
    if (!w.ok) {
      outcome.ok = false
      outcome.migrated = []   // ⚠ 写失败 ⇒ 一条也不算迁成功（⛔ 不许报"部分成功"来掩盖）
      outcome.reason = w.reason
      perFile.push(outcome)
      continue
    }
    perFile.push(outcome)
  }

  const migrated = perFile.flatMap((o) => o.migrated)
  const failed = perFile.filter((o) => !o.ok)
  return {
    migrated,
    perFile,
    failed,
    ok: failed.length === 0,
    // ⚠ 汇总原因**只在真有失败时**非空（否则下游会把"没失败"读成"有话说"）
    reason: failed.length === 0 ? '' : failed.map((f) => `${f.file}: ${f.reason}`).join('；'),
  }
}

/** 单个账本文件的迁移结局（⚠ **逐文件**，⛔ 不合并成一个总数）。 */
export interface LegacyFileOutcome {
  file: string
  /** 本次**真的写进去**的会话 id。 */
  migrated: string[]
  /** 有意跳过的：已有记录 / 新会话 / 空 id / 被归到多个文件。 */
  skipped: string[]
  ok: boolean
  reason: string
}

/** 整次迁移的结局（⚠ `ok=false` 时**必须**把 `reason` 报给用户）。 */
export interface LegacyMigrationReport {
  migrated: string[]
  perFile: LegacyFileOutcome[]
  failed: LegacyFileOutcome[]
  ok: boolean
  reason: string
}

/**
 * 会话创建时刻（ms）—— 用来判别"旧会话 / 新会话"。
 *
 * ⚠ 取 `session.header.createdAt`（宿主 `validateSessionHeader` 保证它是
 *   非负安全整数，见 `dsh-session/lib/index.js:1046`）⇒ 可信且无需重放事件。
 */
export function createdAtOf(session: any): number | undefined {
  try {
    const v = session?.header?.createdAt
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined
  } catch {
    return undefined
  }
}

/** 文件是否存在（⚠ 只读；给诊断用，⛔ 不触发创建）。 */
export function policyFileExists(file: string | undefined): boolean {
  if (file === undefined) return false
  try { return statSync(file).isFile() } catch { return false }
}
