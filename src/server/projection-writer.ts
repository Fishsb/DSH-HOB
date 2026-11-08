/**
 * **运行态投影的落盘器**（I/O 适配层，唯一写入口）。
 *
 * ══ 分层（⚠ 与 `ledger-projection.ts` 的纯函数分工）══════════════════════════
 *   · `src/server/ledger-projection.ts` —— **纯函数**：事实 ⇒ 账本操作清单；
 *   · 本文件 —— **只做 I/O**：读当前账本、调用纯函数、把操作写成单元文件。
 *   ⛔ 本文件**不判断"该不该落账"**（那是纯函数的事）；⛔ 纯函数**不写盘**。
 *
 * ══ 三条硬边界 ═══════════════════════════════════════════════════════════════
 *   ① **落盘仍走 `writeHobFile`**：同一道白名单 / 缩水守卫 / 备份 / 原子写。
 *      ⛔ 不自己拼路径 `mkdir` + `writeFile`（那会在守卫旁边开后门）。
 *   ② **只追加新单元，不覆盖已有分片**：
 *      · 新 RUN/ACC ⇒ 追加到 `ledger/units/unit-projection.toml`（固定分片名）；
 *      · 状态迁移（TSK doing→built）⇒ 追加一条**迁移记录**到同一分片？
 *        ⚠ 不行：账本读取是"按 [[unit]] 顺序合并"，同 id 两条会重复。
 *      ⇒ 迁移必须**改写原分片里那一条**。为不破坏其它单元，本文件按分片逐份
 *        "读出 → 替换目标单元 → 整份 overwrite"，⚠ 每份都有备份（writeHobFile 自带）。
 *   ③ **写失败不掩盖**：返回 `{ok:false, reason, message}`，由调用方原样回带。
 *
 * ⚠ 为什么迁移要改原分片而不是追加"覆盖单元"：
 *   `parseUnitsToml` / `gen-ledger` 都把每条 `[[unit]]` 当独立单元；同 id 两条
 *   会让 `readLedgerUnits` 返回两份，`ledgerClosureProblems` / 链投影会各算一遍。
 *   ⇒ "一个 id 一个单元"是账本格式的硬约束，⛔ 不许用追加来模拟更新。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { writeHobFile, type WriteHobResult } from './hob-write.ts'
import {
  projectFact,
  describeProjection,
  type ProjectionFact,
  type ProjectionOp,
  type ProjectionResult,
  type ProjectionUnitLike,
} from './ledger-projection.ts'
import { parseUnitsToml } from '../shared/stages-index.ts'
import { modelFaceFingerprintOf } from './model-face.ts'

/**
 * 投影新单元写入的固定分片。
 * ⚠ 名字**不带数字序号**：它按字典序排在 `unit-01..` 之后，但不会让人误以为
 *   "账本有 90 片"。读取规则仍是 `unit-*.toml`，⛔ 不需要改解析器。
 */
export const PROJECTION_SHARD = 'unit-projection.toml'

/** 投影落盘的默认写入策略（与 `modules/tools.ts` 的 DEFAULTS 同值；⚠ 只在这里写一次）。 */
export const PROJECTION_WRITE_OPTS = {
  keepBackups: 20,
  shrinkGuard: 0.5,
  maxFileBytes: 262144,
} as const

/**
 * **按账本根串行**：一场投影横跨「读全账本 → 分配编号 → 写多个分片」。
 *
 * ⚠ `writeHobFile` 只按**单个目标文件**排队。两个并发投影会各自读到同一份旧账本，
 *   都算出 `RUN-001`，再分别追加到同一个分片 ⇒ 最终出现两条相同 ID。
 *   2026-11-08 用临时账本并行派发两条真实 todo 任务，实测两次都返回成功，
 *   `unit-projection.toml` 里确实写出两条 `RUN-001`。
 *
 * ⇒ 临界区必须是**整场投影**，不是每次写文件。键用规范化后的账本根；
 *   ⛔ 堆在文件级队列之后不解决问题（编号已经分配完才开始写）。
 *
 * ⚠ 与其他运行态队列同口径：只做同进程串行。跨进程单写者前提仍由账本区
 *   `doc-read.ts` 的 Single Writer Principle 承担，⛔ 本队列不冒充文件锁。
 */
const projectionQueues = new Map<string, Promise<unknown>>()

async function withProjectionQueue<T>(ledgerRoot: string, fn: () => Promise<T>): Promise<T> {
  const key = ledgerRoot.replace(/[\\/]+$/, '')
  const prev = projectionQueues.get(key) ?? Promise.resolve()
  const run = prev.then(() => fn(), () => fn())
  const tail = run.then(() => undefined, () => undefined)
  projectionQueues.set(key, tail)
  try {
    return await run
  } finally {
    if (projectionQueues.get(key) === tail) projectionQueues.delete(key)
  }
}

/** 一次投影落盘的结果（⚠ 三档：applied / skipped / undecidable / failed）。 */
export interface ProjectionApplyResult {
  ok: boolean
  key: string
  /** 实际写成功的操作数。 */
  applied: number
  /** 纯函数给出的操作（供调用方回读）。 */
  ops: ProjectionOp[]
  /** 跳过 / 判不出 / 写失败的可读原因（⚠ 有值 = 没有全部落账）。 */
  reason?: string
  /** 本次改动过的账本区相对路径（⚠ 便于复核与回滚）。 */
  files: string[]
}

/** 读账本全部单元（与 `readLedgerUnits` 同一口径：index + unit-*.toml）。 */
export function readProjectionUnits(ledgerRoot: string): ProjectionUnitLike[] {
  const dir = join(ledgerRoot, 'ledger', 'units')
  if (!existsSync(dir)) return []
  const names = readdirSync(dir)
    .filter((n) => n === 'index.toml' || /^unit-[^/]+\.toml$/.test(n))
    .sort()
  const out: ProjectionUnitLike[] = []
  for (const name of names) {
    const text = readFileSync(join(dir, name), 'utf8')
    for (const u of parseUnitsToml(text)) out.push(u as unknown as ProjectionUnitLike)
  }
  return out
}

/** 把一条单元渲染成受限 TOML 子集（⚠ 只认字符串 / 字符串数组）。 */
function renderUnit(unit: Record<string, unknown>): string {
  const lines: string[] = ['[[unit]]']
  for (const [key, value] of Object.entries(unit)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string') {
      lines.push(`${key} = ${JSON.stringify(value)}`)
    } else if (Array.isArray(value)) {
      const items = value.map(String)
      lines.push(`${key} = [${items.map((x) => JSON.stringify(x)).join(', ')}]`)
    }
  }
  return lines.join('\n')
}

/** 从分片文本里删掉指定 id 的整段 `[[unit]]`（⚠ 只删那一段，其余原样）。 */
function removeUnitBlock(text: string, id: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let skipping = false
  for (const line of lines) {
    if (line.trim() === '[[unit]]') {
      skipping = false
    }
    if (!skipping && line.trim().startsWith('id = ')) {
      const m = /^id\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(line.trim())
      if (m !== null && m[1] === id) {
        /** 回退掉刚写进去的 `[[unit]]` 行。 */
        while (out.length > 0 && out[out.length - 1]!.trim() === '[[unit]]') out.pop()
        skipping = true
        continue
      }
    }
    if (!skipping) out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/** 把一条新单元追加到投影分片（⚠ 文件不存在 ⇒ 新建）。 */
async function appendUnit(
  ledgerRoot: string,
  unit: Record<string, unknown>,
  opts: { keepBackups: number; shrinkGuard: number; maxFileBytes: number },
): Promise<WriteHobResult> {
  return writeHobFile(ledgerRoot, {
    file: `ledger/units/${PROJECTION_SHARD}`,
    content: renderUnit(unit),
    mode: 'append',
  }, { hobDir: '', ...opts, validateLedgerStructure: false })
}

/**
 * **把一条运行态事实落成账本事实**（唯一 I/O 入口）。
 *
 * ⚠ 顺序：先读当前账本 → 纯函数出操作 → 逐条执行。
 *   · `create-unit` ⇒ 追加到投影分片；
 *   · `transition-unit` ⇒ 在**原分片**里替换那一条（先备份，writeHobFile 自带）；
 *   · `link-unit` ⇒ 同上（更新 `run_ids` / `acceptance_ids`）。
 *
 * @param ledgerRoot - 账本区根
 * @param fact - 已发生的运行态事实
 * @returns 三档结果（⚠ 写失败与"判不出"分开报）
 */
export async function applyProjection(
  ledgerRoot: string,
  fact: ProjectionFact,
  opts: { keepBackups: number; shrinkGuard: number; maxFileBytes: number } = PROJECTION_WRITE_OPTS,
): Promise<ProjectionApplyResult> {
  return withProjectionQueue(ledgerRoot, () => applyProjectionLocked(ledgerRoot, fact, opts))
}

/** 已进入本账本临界区的投影实现；⛔ 不得从外部直接调用。 */
async function applyProjectionLocked(
  ledgerRoot: string,
  fact: ProjectionFact,
  opts: { keepBackups: number; shrinkGuard: number; maxFileBytes: number },
): Promise<ProjectionApplyResult> {
  const units = readProjectionUnits(ledgerRoot)
  /**
   * ⚠ 新 RUN 必须钉住**本次实际使用的模型面**（`check:ledger` 的 F-9）：
   *   投影落账与人工落账过**同一道判据**，⛔ 不因为"是自动写的"就少这两项。
   *   读不到 ⇒ 不写（由 F-9 如实报缺，⛔ 不编版本号 / 哈希）。
   */
  const fingerprint = fact.kind === 'dispatch' ? modelFaceFingerprintOf() : undefined
  const factWithFace = fact.kind === 'dispatch' && fingerprint !== undefined
    ? { ...fact, modelFace: fingerprint }
    : fact
  let result: ProjectionResult
  try {
    result = projectFact(units, factWithFace)
  } catch (e) {
    return { ok: false, key: '', applied: 0, ops: [], reason: `投影纯函数抛错：${String((e as Error)?.message ?? e)}`, files: [] }
  }
  if (result.ops.length === 0) {
    return {
      ok: false,
      key: result.key,
      applied: 0,
      ops: [],
      reason: describeProjection(result),
      files: [],
    }
  }
  /** 逐条执行（⚠ 顺序有意义：先建 RUN，再迁 TSK，再 link）。 */
  const files: string[] = []
  let applied = 0
  /** 工作副本：后续操作要看见前面刚建的单元（否则 link 会找不到新 RUN）。 */
  const working = [...units]
  for (const op of result.ops) {
    if (op.op === 'create-unit') {
      const unit: Record<string, unknown> = { id: op.id, kind: op.kind, ...op.fields }
      const w = await appendUnit(ledgerRoot, unit, opts)
      if (!w.ok) {
        return { ok: false, key: result.key, applied, ops: result.ops, reason: `创建 ${op.id} 失败：${w.reason ?? 'write-failed'}（${w.message}）`, files }
      }
      applied += 1
      files.push(`ledger/units/${PROJECTION_SHARD}`)
      working.push(unit as unknown as ProjectionUnitLike)
      continue
    }
    if (op.op === 'transition-unit' || op.op === 'link-unit') {
      const hit = working.find((u) => String(u.id) === op.id)
      if (hit === undefined) {
        return { ok: false, key: result.key, applied, ops: result.ops, reason: `找不到要更新的单元 ${op.id}`, files }
      }
      const next: Record<string, unknown> = { ...hit }
      if (op.op === 'transition-unit') {
        next.status = op.to
        for (const [k, v] of Object.entries(op.fields ?? {})) next[k] = v
      } else {
        const cur = Array.isArray(next[op.field]) ? (next[op.field] as string[]).map(String) : []
        next[op.field] = [...new Set([...cur, ...op.add])]
      }
      /** 在**原分片**里替换那一条（⚠ 同 id 一个单元是格式硬约束）。 */
      const dir = join(ledgerRoot, 'ledger', 'units')
      const shard = readdirSync(dir)
        .filter((n) => n === 'index.toml' || /^unit-[^/]+\.toml$/.test(n))
        .sort()
        .find((n) => {
          try { return parseUnitsToml(readFileSync(join(dir, n), 'utf8')).some((u) => String(u.id) === op.id) } catch { return false }
        })
      if (shard === undefined) {
        return { ok: false, key: result.key, applied, ops: result.ops, reason: `找不到 ${op.id} 所在的分片`, files }
      }
      const src = readFileSync(join(dir, shard), 'utf8')
      const without = removeUnitBlock(src, op.id)
      const content = `${without.trimEnd()}\n\n${renderUnit(next)}\n`
      const w = await writeHobFile(ledgerRoot, {
        file: `ledger/units/${shard}`,
        content,
        mode: 'overwrite',
      }, { hobDir: '', ...opts, validateLedgerStructure: false })
      if (!w.ok) {
        return { ok: false, key: result.key, applied, ops: result.ops, reason: `更新 ${op.id} 失败：${w.reason ?? 'write-failed'}（${w.message}）`, files }
      }
      applied += 1
      files.push(`ledger/units/${shard}`)
      const idx = working.findIndex((u) => String(u.id) === op.id)
      if (idx >= 0) working[idx] = next as unknown as ProjectionUnitLike
    }
  }
  return { ok: true, key: result.key, applied, ops: result.ops, files }
}
