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
import { publishLiveChange } from './live-hub.ts'

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

/**
 * **半完成读数**：一条投影横跨「建 RUN → 迁 TSK → link」多次写盘，中途失败时
 * 前面已落盘的操作**不会回滚** ⇒ 账本停在半完成态。
 *
 * ⚠ 为什么不在这里回滚：`writeHobFile` 虽然每份分片都有备份，但「按 files 反向恢复」
 *   需要跨分片事务；当前只有按账本根串行的**进程内队列**（{@link withProjectionQueue}），
 *   它保证不并发、不保证原子。⇒ 本批只把半完成**如实回带**，由调用方 / 人工修账。
 */
export interface ProjectionPartial {
  /** 本次投影已成功创建的单元 id（⚠ 只含 create-unit；迁移不新增 id）。 */
  created: string[]
  /** 失败的那一步（可读，带操作名与目标 id）。 */
  failed: string
}

/** 一次投影落盘的结果（⚠ 三档：applied / skipped / undecidable / failed）。 */
export interface ProjectionApplyResult {
  ok: boolean
  key: string
  /** 实际写成功的操作数。 */
  applied: number
  /** RUN allocated and created by this projection, if any. */
  createdRunId?: string
  /** 纯函数给出的操作（供调用方回读）。 */
  ops: ProjectionOp[]
  /** 跳过 / 判不出 / 写失败的可读原因（⚠ 有值 = 没有全部落账）。 */
  reason?: string
  /**
   * **半完成读数**（⚠ 有值 = 已落盘一部分、剩余没落 ⇒ 账本需人工修账）。
   * ⛔ 第一步就失败（applied=0）时不出现：盘上什么都没变，不是半完成。
   */
  partial?: ProjectionPartial
  /** 本次改动过的账本区相对路径（⚠ 便于复核与回滚）。 */
  files: string[]
}

/** 读账本全部单元（与 `readLedgerUnits` 同一口径：index + unit-*.toml）。 */
export function readProjectionUnits(ledgerRoot: string): ProjectionUnitLike[] {
  const r = readProjectionUnitsState(ledgerRoot)
  /**
   * ⚠ 兼容壳：旧调用方要的是「单元数组」。
   *   ⚠ 但它**不区分「读不出」与「空账」** —— 那正是 O-09 要治的形态。
   *   ⇒ 新代码请用 {@link readProjectionUnitsState}，⛔ 不要在新地方用这个。
   */
  return r.kind === 'ok' ? r.units : []
}

/**
 * ── **O-09：`readProjectionUnits` 必须三态，⛔ 不许「一坏就整体抛」** ──────────
 *
 * ⚠ 改前：`readFileSync` **没有 try/catch** ⇒ 任一单分片读不出（EACCES / EIO / EISDIR…）
 *   **整个函数抛异常** ⇒ 调用方（`orchestrator.ts` 派发前的门禁取数）
 *   **整次派发失败**，而错误信息只是一句 `EACCES` —— 读者分不清
 *   「这本账没有单元」与「这本账有单元但读不出来」。
 *
 * ⚠ 本仓已有同款纪律（`hob-write.ts` 的 `TargetRead` 三态、O-33 的四态）：
 *   **「不存在」与「读不出来」不许合并成同一个值**。本条把它用到投影读侧。
 *
 * ⚠ 三态：
 *   · `missing` —— 目录不存在（**还没开账**，不是错）；
 *   · `ok`      —— 读到了（可能 0 条，那是**真的空**）；
 *   · `unreadable` —— 有分片读不出 ⇒ **点名那个分片**，⛔ 不整体抛。
 */
export function readProjectionUnitsState(ledgerRoot: string):
  | { kind: 'missing' }
  | { kind: 'ok'; units: ProjectionUnitLike[] }
  | { kind: 'unreadable'; shard: string; code: string } {
  const dir = join(ledgerRoot, 'ledger', 'units')
  if (!existsSync(dir)) return { kind: 'missing' }
  let names: string[]
  try {
    names = readdirSync(dir).filter((n) => n === 'index.toml' || /^unit-[^/]+\.toml$/.test(n)).sort()
  } catch (e) {
    return { kind: 'unreadable', shard: '(目录)', code: String((e as NodeJS.ErrnoException)?.code ?? 'unknown') }
  }
  const out: ProjectionUnitLike[] = []
  for (const name of names) {
    let text: string
    try {
      text = readFileSync(join(dir, name), 'utf8')
    } catch (e) {
      /** ⚠ **点名是哪个分片** —— 只说「读不出来」等于没说。 */
      return { kind: 'unreadable', shard: name, code: String((e as NodeJS.ErrnoException)?.code ?? 'unknown') }
    }
    for (const u of parseUnitsToml(text)) out.push(u as unknown as ProjectionUnitLike)
  }
  return { kind: 'ok', units: out }
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

/**
 * 从分片文本里删掉指定 id 的整段 `[[unit]]`（只删那一段，其余行**逐字节原样**）。
 *
 * ⚠ **必须按块处理，不能按行**（R-18）：`id` 不是首键时（手改账本很常见），
 *   行级实现会把 `id` 之前的行留成**没有 id 的孤儿块** —— 解析器照样把它算一条单元，
 *   而那次写入返回 ok:true，下一次任意写入又被自己制造的垃圾拦死。
 *
 * ⚠ 旧实现末尾统一 `replace(/\n{3,}/g, '\n\n')` 会**改写未涉及单元的布局**（O-07）；
 *   本实现只做 `trimEnd() + '\n'`，把「删一整块」与「重新格式化」分开。
 */
/**
 * 从分片里**整块**删除一条单元（R-18）。
 *
 * ⚠ **必须是块级删除，⛔ 不能是行级删除。** 旧实现按行删，当 `id` 不是首键时：
 *   `id` 之前的行已写进 `out`、`[[unit]]` 已被弹出 ⇒ 留下**无 `id` 的裸块**，
 *   解析器照样算一条单元 ⇒ 账本长出 `id=''` 的单元 ⇒ **下一次任意写入都会被拒**；
 *   且每次投影迁移**再复制一份**（与 T-07 叠加成累积垃圾）。
 *
 * ⚠ 导出仅为本条留可回归的负向对拍：`id` 写在第二行时删完**单元数必须不变**。
 */
export function removeUnitBlock(text: string, id: string): string {
  const lines = text.split('\n')
  const HEAD = '[[unit]]'
  /** 块表：head = `[[unit]]` 行号，end = 下一块块头（最后一块则为文件行数）。 */
  const blocks: Array<{ head: number; end: number }> = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() !== HEAD) continue
    const prev = blocks.length > 0 ? blocks[blocks.length - 1]! : undefined
    /** 见到下一块块头 ⇒ 上一块在这里结束（⛔ 不是文件末尾）。 */
    if (prev !== undefined && prev.end > i) prev.end = i
    blocks.push({ head: i, end: lines.length })
  }
  /** 该块的 id（块内**第一个** `id = "…"` 行；⛔ 不跨块找）。 */
  const idOfBlock = (b: { head: number; end: number }): string => {
    for (let i = b.head + 1; i < b.end; i++) {
      const m = /^id\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(lines[i]!.trim())
      if (m !== null) return m[1]!
    }
    return ''
  }
  const target = blocks.find((b) => idOfBlock(b) === id)
  /** 找不到 ⇒ 原样返回（⛔ 不是返回空串 —— 那会让调用方写出空分片）。 */
  if (target === undefined) return text
  /** 连同块前的空行一起删（避免删完留下多余空行；只影响该块前的分隔）。 */
  let from = target.head
  while (from > 0 && lines[from - 1]!.trim() === '') from--
  const kept = [...lines.slice(0, from), ...lines.slice(target.end)]
  return kept.join('\n').trimEnd() + '\n'
}

/**
 * 把一条新单元追加到投影分片（⚠ 文件不存在 ⇒ 新建）。
 *
 * ⚠ **不再传 `validateLedgerStructure: false`**（B1.4 ③ / T-06）：
 *   投影器是账本的写入口之一，新旧写入必须过**同一道**结构 / 关系 / 字段校验。
 *   旧豁免的原始理由「账本里可能还留着历史缺口，新 RUN 必须能追加」**不成立**：
 *   历史缺口由读侧如实报告，写入侧不该为它开一条绕过自检的路；
 *   开了之后，投影自己写坏的分片（R-18）也不会被自己拦下。
 */
async function appendUnit(
  ledgerRoot: string,
  unit: Record<string, unknown>,
  opts: { keepBackups: number; shrinkGuard: number; maxFileBytes: number },
): Promise<WriteHobResult> {
  return writeHobFile(ledgerRoot, {
    file: `ledger/units/${PROJECTION_SHARD}`,
    content: renderUnit(unit),
    mode: 'append',
  }, { hobDir: '', ...opts })
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

/**
 * 失败结果的**唯一构造点**：把「已落盘多少 / 失败在哪一步」如实回带（T-07）。
 *
 * ⚠ 半完成不是「没有变化」：`applied` 条操作已经写进分片，账本停在
 *   「RUN 有了、TSK 没迁 / 没 link」这种状态，下一次写会被这次留下的半成品拦死。
 *   ⇒ 有半完成时：
 *   · 返回 `partial: {created, failed}`（机读，供调用方 / 面板点名）；
 *   · `reason` 里点名「需人工修账」（人读，⛔ 不把半完成压成一句「失败」）。
 *
 * ⚠ 第一步就失败（`applied === 0`）**不给 partial**：盘上什么都没变，
 *   报半完成会让调用方去修一本没被动的账。
 */
function failedApply(
  result: ProjectionResult,
  applied: number,
  created: readonly string[],
  failed: string,
  files: readonly string[],
): ProjectionApplyResult {
  const half = applied > 0
  const createdNote = created.length === 0 ? '' : `（已创建 ${created.join(' / ')}）`
  return {
    ok: false,
    key: result.key,
    applied,
    ops: result.ops,
    reason: half
      ? `${failed} ⇒ 已落盘 ${applied} / ${result.ops.length} 条操作${createdNote}，账本处于半完成态，需人工修账`
      : failed,
    files: [...files],
    ...(half ? { partial: { created: [...created], failed } } : {}),
    ...(result.createdRunId === undefined ? {} : { createdRunId: result.createdRunId }),
  }
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
      ...(result.createdRunId === undefined ? {} : { createdRunId: result.createdRunId }),
      reason: describeProjection(result),
      files: [],
    }
  }
  /** 逐条执行（⚠ 顺序有意义：先建 RUN，再迁 TSK，再 link）。 */
  const files: string[] = []
  let applied = 0
  /** 本次已成功 create 的单元 id（⚠ 半完成读数 `partial.created` 的唯一来源）。 */
  const created: string[] = []
  /** 工作副本：后续操作要看见前面刚建的单元（否则 link 会找不到新 RUN）。 */
  const working = [...units]
  for (const op of result.ops) {
    if (op.op === 'create-unit') {
      const unit: Record<string, unknown> = {
        id: op.id,
        kind: op.kind,
        // Runtime-created artifacts enter Pipeline v3 explicitly; revision starts at 1.
        ...(['run', 'acc', 'verification', 'closure'].includes(op.kind) ? { pipeline_version: 'v3', revision: '1' } : {}),
        ...op.fields,
      }
      const w = await appendUnit(ledgerRoot, unit, opts)
      if (!w.ok) {
        return failedApply(result, applied, created, `创建 ${op.id} 失败：${w.reason ?? 'write-failed'}（${w.message}）`, files)
      }
      applied += 1
      created.push(op.id)
      files.push(`ledger/units/${PROJECTION_SHARD}`)
      working.push(unit as unknown as ProjectionUnitLike)
      continue
    }
    if (op.op === 'transition-unit' || op.op === 'link-unit') {
      const hit = working.find((u) => String(u.id) === op.id)
      if (hit === undefined) {
        return failedApply(result, applied, created, `${op.op} ${op.id}：找不到要更新的单元`, files)
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
        return failedApply(result, applied, created, `${op.op} ${op.id}：找不到所在的分片`, files)
      }
      const src = readFileSync(join(dir, shard), 'utf8')
      const without = removeUnitBlock(src, op.id)
      const content = `${without.trimEnd()}\n\n${renderUnit(next)}\n`
      const w = await writeHobFile(ledgerRoot, {
        file: `ledger/units/${shard}`,
        content,
        mode: 'overwrite',
      }, { hobDir: '', ...opts })
      if (!w.ok) {
        return failedApply(result, applied, created, `${op.op} ${op.id} 失败：${w.reason ?? 'write-failed'}（${w.message}）`, files)
      }
      applied += 1
      files.push(`ledger/units/${shard}`)
      const idx = working.findIndex((u) => String(u.id) === op.id)
      if (idx >= 0) working[idx] = next as unknown as ProjectionUnitLike
    }
  }
  /**
   * Ledger writes publish through `writeHobFile`; this extra runtime signal is
   * what refreshes the execution items even when a projection was skipped and
   * therefore produced no ledger write.
   */
  publishLiveChange(ledgerRoot, ['runtime'])
  return { ok: true, key: result.key, applied, ops: result.ops, files, ...(result.createdRunId === undefined ? {} : { createdRunId: result.createdRunId }) }
}
