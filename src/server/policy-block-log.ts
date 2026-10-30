/**
 * **「这个会话被选档闸拦下过」的可读运行态**（2026-10-29 · 第 332 轮 · 包 cb）。
 *
 * ══ 它解决什么（缺了它就没法补上这条链）══════════════════════════════════
 *   `agent/pre-step` 是**waterfall**，`reject` 的宿主语义是"消息到此为止、turn 无 step 地关闭"
 *   （`dsh-agent/lib/types/runtime-types.d.ts:304 / :269-271`）⇒ **前端拿不到任何回调**。
 *   ⇒ 客户端只能自己去问"这个会话被拦过没有"。本模块就是那个答案的**唯一落点**。
 *
 * ══ 为什么不能复用既有 `source === 'derived-default'` 当"被拦过"的证据 ══════
 *   ⚠ `unrecorded` 只表示"这个 Hob 会话还没选过" —— **新建的空白会话一打开就是它**。
 *   拿它当"被拦过"的证据 ⇒ **一进会话就弹**（正是本单明令禁止的"骚扰"）。
 *   ⇒ "选过没有"（既有 `session-policy.json`）与"被拦过没有"（本文件）是**两根轴**。
 *
 * ══ 落点为什么是 `runtime/` 同一处（⛔ 不是新开第二真相源）══════════════════
 *   与 `session-policy.json`（`POLICY_STATE_SUBDIR = 'runtime'`）**同目录**、
 *   同一套"账本根 → 文件"派生方式、同一套原子写纪律。
 *   ⚠ 但**不并进那个文件**：它是 `readPolicyStore` 的白名单结构
 *   （`asRecord` 只拷认识的字段），塞进去要么被静默丢掉、要么逼着改那套解析。
 *   ⇒ 单独文件，**同一目录、同一邻居**，符合"与既有运行态同一处或相邻"。
 *
 * ══ 纪律 ══════════════════════════════════════════════════════════════════
 *   ① **写失败必须可读**：本模块**只返回 `{ok,reason}`**，⛔ 不抛；
 *      调用方（闸门）**必须**把失败打成一条可读日志，⛔ 不许 catch 掉当没发生。
 *   ② **读不到 ≠ 没被拦过**：`readBlocked` 用三态表达（`blocked` / `clear` / `unknown`），
 *      ⛔ 不把"判不出"降级成"没拦过"（那会让本该弹的不弹，且无声）。
 *   ③ **体积有界**：每次写顺带修剪（超过 `MAX_ENTRIES` 或超过 `MAX_AGE_MS` 的条目），
 *      ⛔ 不让它无限长（这是运行态，不是审计日志）。
 *   ④ **⛔ 不改 `reject` 语义**：本模块只**记录发生过**，⛔ 不决定拦不拦。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** 与 `session-policy.json` **同目录**（`POLICY_STATE_SUBDIR` 的同一处）。 */
export const POLICY_BLOCK_SUBDIR = 'runtime'
export const POLICY_BLOCK_FILENAME = 'session-policy-blocks.json'

/** 本文件结构版本（⚠ 与策略主文件各自独立，⛔ 不共用版本号）。 */
export const POLICY_BLOCK_VERSION = 1

/** 条目上限（超出按 `at` 从旧到新丢）。 */
export const MAX_ENTRIES = 200
/** 条目有效期（默认 24h；过期的"被拦过"没有意义 —— 用户早就忘了）。 */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000

/** `<账本目录>` ⇒ 本模块的落盘文件路径（口径与 `policyStateFileOf` 逐字同构）。 */
export function policyBlockFileOf(ledgerRoot: string): string {
  return `${ledgerRoot}/${POLICY_BLOCK_SUBDIR}/${POLICY_BLOCK_FILENAME}`
}

/** 一条"被拦过"的记录。 */
export interface PolicyBlockRecord {
  /** 最近一次被拦的时刻（ms）。 */
  at: number
  /** 累计被拦次数（⚠ 只增不减；用于"到底拦过几次"的可读性，⛔ 不参与判定）。 */
  count: number
}

interface PolicyBlockFile {
  version: number
  blocked: Record<string, PolicyBlockRecord>
}

/** 读盘可达性三态（⚠ 与策略主文件同一套分档口径，⛔ 不把"读不到"说成"没拦过"）。 */
export type BlockReadState = 'blocked' | 'clear' | 'unknown'

export interface BlockReading {
  state: BlockReadState
  /** `state === 'blocked'` 时有效。 */
  at?: number
  count?: number
  /** 可读原因（⚠ `unknown` 时必须非空；`clear` 时可空）。 */
  reason: string
}

function emptyFile(): PolicyBlockFile {
  return { version: POLICY_BLOCK_VERSION, blocked: {} }
}

/**
 * 读整个文件（内部用）。
 * ⚠ 四个失败档**分开说**（不存在 / 读不了 / 版本不认识 / 结构坏）——
 *   但对外**统一收敛成 `unknown`**：调用方只关心"能不能确定它没被拦过"。
 */
function readFile_(file: string): { file: PolicyBlockFile; reason: string } {
  if (!existsSync(file)) return { file: emptyFile(), reason: '' }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    return { file: emptyFile(), reason: `被拦记录文件存在但读不了/不是 JSON（${String((e as Error)?.message ?? e)}）` }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { file: emptyFile(), reason: '被拦记录文件顶层不是对象' }
  }
  const o = parsed as Record<string, unknown>
  if (o.version !== POLICY_BLOCK_VERSION) {
    return { file: emptyFile(), reason: `被拦记录结构版本是 ${JSON.stringify(o.version)}，本插件只认 ${POLICY_BLOCK_VERSION}` }
  }
  const raw = o.blocked
  const blocked: Record<string, PolicyBlockRecord> = {}
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
      if (id === '') continue
      if (v === null || typeof v !== 'object') continue
      const r = v as Record<string, unknown>
      const at = r.at
      const count = r.count
      if (typeof at !== 'number' || !Number.isFinite(at)) continue
      blocked[id] = { at, count: typeof count === 'number' && Number.isFinite(count) ? count : 1 }
    }
  }
  return { file: { version: POLICY_BLOCK_VERSION, blocked }, reason: '' }
}

/**
 * 原子写盘（tmp + rename + **回读逐字节比**，与策略主文件 `writePolicyStore` 同一纪律）。
 * ⚠ 失败**返回可读原因**，⛔ 不抛给调用方。
 */
function writeFile_(file: string, state: PolicyBlockFile): { ok: boolean; reason: string } {
  const expect = JSON.stringify(state, null, 2)
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(tmp, expect, 'utf8')
    renameSync(tmp, file)
  } catch (e) {
    try { rmSync(tmp, { force: true }) } catch { /* 清理失败不掩盖主错误 */ }
    return { ok: false, reason: `被拦记录写入失败：${String((e as Error)?.message ?? e)}` }
  }
  try {
    const back = readFileSync(file)
    if (!back.equals(Buffer.from(expect, 'utf8'))) {
      return { ok: false, reason: '被拦记录写入后回读与预期不符 ⇒ 视为未落盘' }
    }
    return { ok: true, reason: '' }
  } catch (e) {
    return { ok: false, reason: `被拦记录写入后回读失败：${String((e as Error)?.message ?? e)}` }
  }
}

/** 修剪（⚠ 就地改传入的 `blocked`，调用方传自己的副本）。 */
function prune(blocked: Record<string, PolicyBlockRecord>, now: number): void {
  for (const [id, r] of Object.entries(blocked)) {
    if (now - r.at > MAX_AGE_MS) delete blocked[id]
  }
  const ids = Object.keys(blocked)
  if (ids.length <= MAX_ENTRIES) return
  ids
    .sort((a, b) => blocked[a].at - blocked[b].at)
    .slice(0, ids.length - MAX_ENTRIES)
    .forEach((id) => { delete blocked[id] })
}

/**
 * **记一次"这个会话被拦下了"**。
 *
 * @param file - `policyBlockFileOf(ledgerRoot)`；`undefined` ⇒ 判不出落点，返回可读失败。
 * @returns `{ok, reason}` —— ⚠ 调用方**必须**在 `ok===false` 时打一条可读日志，⛔ 不许吞。
 */
export function markBlocked(file: string | undefined, sessionId: string, now: number = Date.now()): { ok: boolean; reason: string } {
  if (file === undefined || file === '') return { ok: false, reason: '判不出账本落点（`policyBlockFileOf` 得到 undefined）⇒ 被拦状态未记录' }
  if (typeof sessionId !== 'string' || sessionId === '') return { ok: false, reason: '会话 id 为空 ⇒ 被拦状态未记录' }
  const reading = readFile_(file)
  if (reading.reason !== '') {
    // ⚠ 读失败**不放弃写**：下面会用空表重建（宁可覆盖掉读不出来的旧档，也不能让"被拦过"落不了盘）。
    //   但原因**必须带出去**（调用方会打成 warn），⛔ 不静默。
  }
  const blocked = { ...reading.file.blocked }
  const prev = blocked[sessionId]
  blocked[sessionId] = { at: now, count: (prev?.count ?? 0) + 1 }
  prune(blocked, now)
  const w = writeFile_(file, { version: POLICY_BLOCK_VERSION, blocked })
  if (!w.ok) return { ok: false, reason: reading.reason === '' ? w.reason : `${w.reason}（⚠ 且读旧档时：${reading.reason}）` }
  return { ok: true, reason: reading.reason }
}

/** **问"这个会话被拦过没有"**（⚠ 三态，⛔ 不把判不出说成"没拦过"）。 */
export function readBlocked(file: string | undefined, sessionId: string, now: number = Date.now()): BlockReading {
  if (file === undefined || file === '') return { state: 'unknown', reason: '判不出账本落点 ⇒ 无法确认是否被拦过' }
  if (typeof sessionId !== 'string' || sessionId === '') return { state: 'unknown', reason: '会话 id 为空 ⇒ 无法确认是否被拦过' }
  const r = readFile_(file)
  if (r.reason !== '') return { state: 'unknown', reason: r.reason }
  const rec = r.file.blocked[sessionId]
  if (rec === undefined) return { state: 'clear', reason: '' }
  if (now - rec.at > MAX_AGE_MS) return { state: 'clear', reason: '被拦记录已过期（超过有效期）' }
  return { state: 'blocked', at: rec.at, count: rec.count, reason: '' }
}

/**
 * **清掉某会话的"被拦过"**（⚠ 用户选完档后调用：选完了就不该再弹）。
 * ⚠ 失败**返回可读原因**，⛔ 不抛（选档主流程不该因为清理失败而失败）。
 */
export function clearBlocked(file: string | undefined, sessionId: string): { ok: boolean; reason: string } {
  if (file === undefined || file === '') return { ok: false, reason: '判不出账本落点 ⇒ 未清理被拦记录' }
  const r = readFile_(file)
  if (r.reason !== '') return { ok: false, reason: r.reason }
  if (r.file.blocked[sessionId] === undefined) return { ok: true, reason: '' }
  const blocked = { ...r.file.blocked }
  delete blocked[sessionId]
  return writeFile_(file, { version: POLICY_BLOCK_VERSION, blocked })
}
