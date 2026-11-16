/**
 * **人工时间读数**（纯函数，零 I/O）—— 「人被叫了几次、每次等多久」。
 *
 * ══ 它治的病（缺口有实测出处）══════════════════════════════════════════════
 *   本仓有 `decided_by` / `decided_at`（`pipeline.ts:74-75`，且 `:549` 要求
 *   `decided_by === 'user'`、`:551` 要求 `decided_at` 可解析），
 *   面板摘要卡也有「阶段 / 下一步 / **在等谁** / 主阻断」四要素（`panel-markers.mjs:72`）。
 *   ⚠ 但那是**当前状态**，不是**累计量**：`grep '等待时长|人工时间|介入次数'` 全仓零实现。
 *   ⇒ 现在无法回答「这个项目上一批活，人一共被打断了几次、每次等了多久」。
 *
 *   ⚠ 这不是"少一个好看的数字"：省时间与挪时间是两件事 ——
 *     只量"审了多久"而不量"被叫了几次 + 等了多久"，会把**挪走的时间**当成**省下的时间**。
 *
 * ══ 口径（⚠ 写清才能复核）══════════════════════════════════════════════════
 *   · **介入次数** = 该 change 下 `decision_kind = 'stage-approval'` 且
 *     `decided_by = 'user'` 的 decision 单元数（⚠ 只数用户的，⛔ 不数 agent 的）；
 *   · **间隔** = 相邻两次 `decided_at` 的毫秒差（⚠ 不是"等了多少"，
 *     因为账本里**没有"进入待批"时刻**这个字段 —— 见下方"本模块不做什么"）；
 *   · **判不出** = 缺 `decided_at` / 时刻不可解析 ⇒ 计入 `undecidable`，⛔ 不当作 0。
 *
 * ══ 本模块**不做什么**（⛔ 别把缺口藏起来）══════════════════════════════════
 *   · ⛔ 不算「PR 等人等了多久」那种**从进入待批到被决定**的时长 ——
 *     那需要一个"进入待批"时刻字段，而账本里**没有**。要加它必须改写入协议
 *     （`pipeline.ts` 的 `EXTENDED_FIELDS`），影响所有既有写入方 ⇒ **单列待批**，
 *     ⛔ 不在这里用「created_at」冒充（那是单元创建时刻，不是"开始等人"时刻）。
 *   · ⛔ 不读文件、不看时间、不猜缺失值（照 `src/shared` 的既有纪律）。
 *
 * @module human-time
 */

/** 一次用户介入（⚠ 只保留可指认的字段，⛔ 不要整个 `any`）。 */
export interface HumanTouch {
  /** decision 单元 id。 */
  id: string
  /** 决定时刻（原样，ISO 8601）。 */
  at: string
  /** 这个决定绑的是哪个 artifact（`artifact_id`），没有就空串。 */
  artifact: string
}

/** 一个 change 的人工时间读数。 */
export interface HumanTimeReading {
  change: string
  /** 用户介入次数（⚠ 只数 `decided_by='user'` 的 stage-approval）。 */
  touches: number
  /** 相邻两次介入的间隔（毫秒，升序）。 */
  gapsMs: number[]
  /** 中位数间隔（毫秒）；无间隔时 `undefined`（⛔ 不是 0）。 */
  medianGapMs?: number
  /** 第 95 百分位间隔（毫秒）；无间隔时 `undefined`。 */
  p95GapMs?: number
  /** 判不出的 decision id（缺时刻 / 时刻不可解析）。 */
  undecidable: string[]
}

const txt = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** 一条 decision 是不是「用户对某个 artifact 的批准」。 */
function isUserApproval(u: Record<string, unknown>): boolean {
  return txt(u.kind) === 'decision'
    && txt(u.decision_kind) === 'stage-approval'
    && txt(u.decided_by) === 'user'
}

/**
 * 取一组单元里**属于某个 change** 的用户批准。
 *
 * ⚠ 归属口径：decision 的 `artifact_id` 若指向该 change 自己、或指向它下面的单元，
 *   就算这条 change 的。⚠ **判不出归属的不猜**（⛔ 不算给任何 change）。
 *
 * @param changeId - change 的 id
 * @param units - 全账本单元
 * @returns 用户介入序列（按时刻升序）
 */
export function userTouchesOf(changeId: string, units: readonly Record<string, unknown>[]): HumanTouch[] {
  const cid = txt(changeId)
  if (cid === '') return []
  /** 该 change 名下的单元 id 集合（含自己）。 */
  const owned = new Set<string>([cid])
  for (const u of units) {
    if (txt(u.parent) === cid) owned.add(txt(u.id))
  }
  const out: HumanTouch[] = []
  for (const u of units) {
    if (!isUserApproval(u)) continue
    const artifact = txt(u.artifact_id)
    if (artifact === '' || !owned.has(artifact)) continue
    out.push({ id: txt(u.id), at: txt(u.decided_at), artifact })
  }
  /** ⚠ 只按**可解析**时刻排序；不可解析的排在最后（它们仍会被计入 undecidable）。 */
  const ms = (s: string): number => {
    const t = Date.parse(s)
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
  }
  return out.sort((a, b) => ms(a.at) - ms(b.at))
}

/** 中位数（⚠ 偶数个时取中间两个的均值；空数组 ⇒ `undefined`）。 */
function median(xs: readonly number[]): number | undefined {
  if (xs.length === 0) return undefined
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid] : Math.round((s[mid - 1]! + s[mid]!) / 2)
}

/** 第 95 百分位（最近秩法；空数组 ⇒ `undefined`）。 */
function p95(xs: readonly number[]): number | undefined {
  if (xs.length === 0) return undefined
  const s = [...xs].sort((a, b) => a - b)
  const rank = Math.ceil(0.95 * s.length)
  return s[Math.min(s.length, Math.max(1, rank)) - 1]
}

/**
 * 一个 change 的人工时间读数。
 *
 * @param changeId - change id
 * @param units - 全账本单元
 * @returns 读数（⚠ 缺时刻的 decision 进 `undecidable`，⛔ 不当作 0）
 */
export function humanTimeOf(changeId: string, units: readonly Record<string, unknown>[]): HumanTimeReading {
  const touches = userTouchesOf(changeId, units)
  const undecidable: string[] = []
  const stamps: number[] = []
  for (const t of touches) {
    const ms = Date.parse(t.at)
    if (t.at === '' || Number.isNaN(ms)) undecidable.push(t.id)
    else stamps.push(ms)
  }
  const gapsMs: number[] = []
  for (let i = 1; i < stamps.length; i++) gapsMs.push(stamps[i]! - stamps[i - 1]!)
  const reading: HumanTimeReading = {
    change: txt(changeId),
    touches: touches.length,
    gapsMs,
    undecidable,
  }
  const med = median(gapsMs)
  if (med !== undefined) reading.medianGapMs = med
  const p = p95(gapsMs)
  if (p !== undefined) reading.p95GapMs = p
  return reading
}

/**
 * 面板摘要用的**一行文案**（⚠ 缺读数就说「判不出」，⛔ 不填 0）。
 *
 * ⚠ 为什么放在这里而不是 client：文案口径要与读数同源，两处各写一份必然漂
 *   （本仓 `STAGE_NAMES` ↔ `KIND_SPEC` 那次就是同形）。
 *
 * @param r - 读数
 * @returns 一句话
 */
export function humanTimeLine(r: HumanTimeReading): string {
  if (r.touches === 0) return '人工介入 0 次（⚠ 没有 stage-approval 记录，不一定是"没叫人"）'
  const gaps = r.gapsMs.length
  const head = `人工介入 ${r.touches} 次`
  if (gaps === 0) {
    return r.undecidable.length > 0
      ? `${head} · 间隔**判不出**（${r.undecidable.length} 条 decision 缺可解析时刻）`
      : `${head} · 只有一次介入，没有间隔`
  }
  const fmt = (ms: number): string => (ms >= 3600000 ? `${(ms / 3600000).toFixed(1)}h` : `${Math.round(ms / 60000)}min`)
  const tail = r.undecidable.length > 0 ? ` · ⚠ ${r.undecidable.length} 条缺时刻` : ''
  return `${head} · 间隔中位 ${fmt(r.medianGapMs ?? 0)} · P95 ${fmt(r.p95GapMs ?? 0)}${tail}`
}

/**
 * **本模块的自检**（返回问题清单；空数组 = 通过）。
 *
 * ⚠ 为什么住在实现旁边：`check:work-state` 那边只**调**它，⛔ 不在脚本里再造一份夹具
 *   （同 `diffBlockersSelfTest()` 的理由）。
 *
 * 三条：① 只数 `decided_by='user'` 的 stage-approval；② 缺时刻进 `undecidable` ⛔ 不当作 0；
 *      ③ 间隔按时刻升序算（⛔ 不按输入顺序）。
 *
 * @returns {string[]} 问题清单（空 = 通过）
 */
export function humanTimeSelfTest(): string[] {
  const out: string[] = []
  const chg = { id: 'CHG-HT', kind: 'change', parent: 'spec/x' }
  const dec = (id: string, by: string, at: string, kind = 'stage-approval') => ({
    id, kind: 'decision', decision_kind: kind, decided_by: by, decided_at: at, artifact_id: 'CHG-HT',
  })
  /** ⚠ 故意把时刻写成**乱序**：间隔必须按时刻算，⛔ 不按输入顺序。 */
  const units = [
    chg,
    dec('DEC-2', 'user', '2026-01-01T02:00:00+08:00'),
    dec('DEC-1', 'user', '2026-01-01T01:00:00+08:00'),
    dec('DEC-3', 'user', '2026-01-01T04:00:00+08:00'),
    dec('DEC-agent', 'agent', '2026-01-01T03:00:00+08:00'),
    dec('DEC-other', 'user', '2026-01-01T05:00:00+08:00', 'other-kind'),
    dec('DEC-bad', 'user', '不是时刻'),
  ]
  const r = humanTimeOf('CHG-HT', units)
  if (r.touches !== 4) out.push('介入次数应为 4（3 条 user stage-approval + 1 条时刻坏），实测 ' + r.touches)
  if (r.undecidable.length !== 1 || r.undecidable[0] !== 'DEC-bad') out.push('缺时刻的 decision 没有单列进 undecidable')
  /** 间隔：01→02 = 1h，02→04 = 2h ⇒ 中位 1.5h；若按输入顺序会算成别的。 */
  const H = 3600000
  if (r.gapsMs.length !== 2) out.push('间隔条数应为 2，实测 ' + r.gapsMs.length)
  else if (r.gapsMs[0] !== H || r.gapsMs[1] !== 2 * H) out.push('间隔没有按时刻升序算：' + JSON.stringify(r.gapsMs))
  if (r.medianGapMs !== 1.5 * H) out.push('中位间隔应为 1.5h，实测 ' + r.medianGapMs)
  if (!/判不出/.test(humanTimeLine({ change: 'x', touches: 1, gapsMs: [], undecidable: ['D'] }))) {
    out.push('只有一次介入 + 缺时刻时，文案没说「判不出」')
  }
  return out
}
