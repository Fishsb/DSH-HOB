/**
 * WorkPlan 运行态存储。
 *
 * 设计边界：
 * · 只存在 `<账本>/runtime/work-plans/active/`；
 * · 一个 plan 一个文件，完成/失败后删除活动文件；
 * · 不复制 RUN / ACC / 回传状态——那些仍以 orch-watches 与账本为权威；
 * · 任何损坏/半写文件都不解释为“空计划”，而是明确报 unreadable。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  WORK_PLAN_VERSION,
  type WorkPlan,
  type WorkPlanInput,
} from '../shared/work-plan.ts'

export const WORK_PLAN_SUBDIR = 'work-plans'
export const WORK_PLAN_ACTIVE_DIR = 'active'
export const WORK_PLAN_FILE_SUFFIX = '.json'
export const WORK_PLAN_STORE_VERSION = 1

export function workPlanDirOf(ledgerRoot: string): string {
  return join(ledgerRoot, 'runtime', WORK_PLAN_SUBDIR, WORK_PLAN_ACTIVE_DIR)
}

export function workPlanFileOf(ledgerRoot: string, planId: string): string {
  const safe = String(planId).trim()
  if (!/^[A-Za-z0-9._-]+$/.test(safe) || safe === '.' || safe === '..') {
    throw new Error(`invalid-plan-id: ${JSON.stringify(planId)}`)
  }
  return join(workPlanDirOf(ledgerRoot), `${safe}${WORK_PLAN_FILE_SUFFIX}`)
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
}

/**
 * 原子写：同目录临时件 + rename，读取方不会看到半截 JSON。
 */
export function writeWorkPlan(ledgerRoot: string, plan: WorkPlan): {
  ok: boolean
  file?: string
  reason?: string
} {
  try {
    const dir = workPlanDirOf(ledgerRoot)
    ensureDir(dir)
    const file = workPlanFileOf(ledgerRoot, plan.planId)
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const body = JSON.stringify({
      storeVersion: WORK_PLAN_STORE_VERSION,
      plan,
    }, null, 2) + '\n'
    writeFileSync(tmp, body, 'utf8')
    renameSync(tmp, file)
    return { ok: true, file }
  } catch (e) {
    return { ok: false, reason: String((e as Error)?.message ?? e) }
  }
}

export type WorkPlanRead =
  | { state: 'ok'; plan: WorkPlan; file: string }
  | { state: 'absent'; file: string }
  | { state: 'unreadable'; file: string; reason: string }

export function readWorkPlan(ledgerRoot: string, planId: string): WorkPlanRead {
  let file = ''
  try {
    file = workPlanFileOf(ledgerRoot, planId)
    if (!existsSync(file)) return { state: 'absent', file }
    const raw = readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw) as { storeVersion?: unknown; plan?: Partial<WorkPlan> }
    if (parsed.storeVersion !== WORK_PLAN_STORE_VERSION) {
      return { state: 'unreadable', file, reason: 'store-version-unknown' }
    }
    const plan = parsed.plan
    if (plan === undefined || plan.version !== WORK_PLAN_VERSION
      || typeof plan.planId !== 'string' || plan.planId.trim() === ''
      || !Array.isArray(plan.tracks)) {
      return { state: 'unreadable', file, reason: 'plan-shape-invalid' }
    }
    return { state: 'ok', plan: plan as WorkPlan, file }
  } catch (e) {
    return { state: 'unreadable', file, reason: String((e as Error)?.message ?? e) }
  }
}

export interface ListedWorkPlan {
  file: string
  planId: string
  plan?: WorkPlan
  state: 'ok' | 'unreadable' | 'ignored'
  reason?: string
}

/**
 * 列出全部活动计划。⚠ 只认 `.json`；`.tmp-*` 是写盘中间件，不当成计划。
 */
export function listWorkPlans(ledgerRoot: string): ListedWorkPlan[] {
  const dir = workPlanDirOf(ledgerRoot)
  try {
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((name) => name.endsWith(WORK_PLAN_FILE_SUFFIX))
      .sort()
      .map((name) => {
        const file = join(dir, name)
        const planId = name.slice(0, -WORK_PLAN_FILE_SUFFIX.length)
        const r = readWorkPlan(ledgerRoot, planId)
        if (r.state === 'ok') return { file, planId, plan: r.plan, state: 'ok' }
        return { file, planId, state: 'unreadable', reason: r.state === 'unreadable' ? r.reason : 'absent' }
      })
  } catch (e) {
    return [{
      file: dir,
      planId: '',
      state: 'unreadable',
      reason: String((e as Error)?.message ?? e),
    }]
  }
}

/**
 * 只删除活动文件；不存在视为已清理（幂等）。
 */
export function removeWorkPlan(ledgerRoot: string, planId: string): { ok: boolean; reason?: string } {
  try {
    const file = workPlanFileOf(ledgerRoot, planId)
    rmSync(file, { force: true })
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: String((e as Error)?.message ?? e) }
  }
}

/**
 * 汇合完成后收口：把终态保留在 `completed/`，并从 `active/` 删除。
 *
 * ⚠ 不删除计划文件本身：运行期仍需可读「汇合已到、等独立验收」。
 * ⚠ 同一 planId 已收口过 ⇒ 幂等；`active/` 不存在视为已收口。
 */
export function closeWorkPlan(
  ledgerRoot: string,
  plan: WorkPlan,
  terminal: Extract<WorkPlan['state'], 'completed' | 'failed'>,
): { ok: boolean; file?: string; reason?: string } {
  try {
    const closedDir = join(ledgerRoot, 'runtime', WORK_PLAN_SUBDIR, 'completed')
    ensureDir(closedDir)
    const file = join(closedDir, `${plan.planId}${WORK_PLAN_FILE_SUFFIX}`)
    const body = JSON.stringify({
      storeVersion: WORK_PLAN_STORE_VERSION,
      plan: { ...plan, state: terminal },
    }, null, 2) + '\n'
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    writeFileSync(tmp, body, 'utf8')
    renameSync(tmp, file)
    const active = workPlanFileOf(ledgerRoot, plan.planId)
    if (existsSync(active)) rmSync(active, { force: true })
    return { ok: true, file }
  } catch (e) {
    return { ok: false, reason: String((e as Error)?.message ?? e) }
  }
}

/** 列已收口计划（只读；用于状态面展示 `joining` 而不是把它当活动计划重复推进）。 */
export function listClosedWorkPlans(ledgerRoot: string): WorkPlan[] {
  const dir = join(ledgerRoot, 'runtime', WORK_PLAN_SUBDIR, 'completed')
  try {
    if (!existsSync(dir)) return []
    const out: WorkPlan[] = []
    for (const name of readdirSync(dir).filter((x) => x.endsWith(WORK_PLAN_FILE_SUFFIX)).sort()) {
      try {
        const parsed = JSON.parse(readFileSync(join(dir, name), 'utf8')) as {
          storeVersion?: unknown
          plan?: WorkPlan
        }
        if (parsed.storeVersion === WORK_PLAN_STORE_VERSION
          && parsed.plan?.version === WORK_PLAN_VERSION
          && typeof parsed.plan.planId === 'string') {
          out.push(parsed.plan)
        }
      } catch { /* 单条坏文件不影响其它计划 */ }
    }
    return out
  } catch { return [] }
}

/**
 * 旧中间件清理：只删除本目录中明确命名的 `.tmp-*`。
 * 不递归、不碰活动 .json。
 */
export function removeStaleWorkPlanTemps(ledgerRoot: string, olderThanMs = 60_000, now = Date.now()): number {
  const dir = workPlanDirOf(ledgerRoot)
  let removed = 0
  try {
    if (!existsSync(dir)) return 0
    for (const name of readdirSync(dir)) {
      if (!name.includes('.tmp-')) continue
      const file = join(dir, name)
      try {
        if (statSync(file).mtimeMs < now - olderThanMs) {
          rmSync(file, { force: true })
          removed++
        }
      } catch { /* 单个文件的竞态不影响其它清理 */ }
    }
  } catch { /* 清理是维护动作，不阻塞读取 */ }
  return removed
}

/**
 * 收口区保留策略（⛔ 不是历史档案）。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────
 *   `completed/` 只服务「汇合已到、等独立验收」这一段：让面板还能看见
 *   「计划 X 已汇合、还没验收」。它不是项目历史 —— 永久结果在 RUN / ACC / EVD。
 *   ⇒ 没有上限就会重演用户抱怨的「账本只增不删、文档堆积」。
 *
 * ── 规则（两条，取先到者）──────────────────────────────────────────────
 *   ① 超过 `maxAgeMs`（缺省 7 天）⇒ 删除；
 *   ② 数量超过 `maxCount`（缺省 50）⇒ 从最旧的开始删，直到不超。
 *
 * ⚠ 只删 `completed/` 里**明确是计划文件**的 `.json`；`active/` 一个都不碰。
 */
export interface ClosedPlanRetention {
  maxAgeMs?: number
  maxCount?: number
}

export const CLOSED_PLAN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
export const CLOSED_PLAN_MAX_COUNT = 50

export function pruneClosedWorkPlans(
  ledgerRoot: string,
  retention: ClosedPlanRetention = {},
  now = Date.now(),
): { removed: number; kept: number } {
  const maxAgeMs = retention.maxAgeMs ?? CLOSED_PLAN_MAX_AGE_MS
  const maxCount = retention.maxCount ?? CLOSED_PLAN_MAX_COUNT
  const dir = join(ledgerRoot, 'runtime', WORK_PLAN_SUBDIR, 'completed')
  let removed = 0
  try {
    if (!existsSync(dir)) return { removed: 0, kept: 0 }
    const files = readdirSync(dir)
      .filter((name) => name.endsWith(WORK_PLAN_FILE_SUFFIX))
      .map((name) => {
        const file = join(dir, name)
        let mtimeMs = 0
        try { mtimeMs = statSync(file).mtimeMs } catch { /* 读不到时间 ⇒ 当作最旧 */ }
        return { file, mtimeMs }
      })
      .sort((a, b) => a.mtimeMs - b.mtimeMs)
    for (const entry of files) {
      if (now - entry.mtimeMs > maxAgeMs) {
        try { rmSync(entry.file, { force: true }); removed++ } catch { /* 单个文件失败不影响其它 */ }
      }
    }
    const remaining = files.filter((entry) => existsSync(entry.file))
    const excess = Math.max(0, remaining.length - Math.max(0, maxCount))
    for (const entry of remaining.slice(0, excess)) {
      try { rmSync(entry.file, { force: true }); removed++ } catch { /* 同上 */ }
    }
    return { removed, kept: Math.max(0, remaining.length - excess) }
  } catch {
    return { removed, kept: 0 }
  }
}

export function newWorkPlan(input: WorkPlanInput, now = Date.now()): WorkPlan {
  return {
    version: WORK_PLAN_VERSION,
    ...input,
    /** 计划创建时冻结档位：此后会话改档只影响下一份计划（`WM-8`）。 */
    modeSnapshot: input.mode,
    state: 'planned',
    createdAt: now,
  }
}

