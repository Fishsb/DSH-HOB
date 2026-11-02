/**
 * **一个变更收没收口** —— K-1..K-6 的**唯一实现**（纯函数，零 I/O）。
 * 2026-10-31 · P42b/R4b · `TASK-R4b.md` §一。
 *
 * ══ 为什么它必须搬到 `src/shared/` ═══════════════════════════════════════════
 *   原来 K-1..K-6 住在 `scripts/check-convergence.mjs`，而那个文件用了 `node:fs`。
 *   ⇒ 两处**到不了**它：
 *     ① `src/shared/stages-index.ts` 调 `nextAction(units)` 不传 `opts.convergence`
 *        ⇒ 第 ③ 步（`converge`）**整段跳过** ⇒ 六态里有一态在面板侧永远不出现；
 *     ② `gen-ledger.mjs` 渲染 `checkpoint` 时注不进去 ⇒ 「收口」列**恒为「判不出」**。
 *   ⛔ 两处各写一份 = 两处真相（本仓踩过：`KIND_SPEC` ↔ `STAGE_KIND_STATUSES`）。
 *   ⇒ **一份实现，两处 import**。
 *
 * ══ ⚠⚠ 硬约束 ═══════════════════════════════════════════════════════════════
 *   · ⛔ **不许** `import 'node:fs'` / `node:path` / 任何 `scripts/` 目录的东西
 *     —— 它要能在 **client 半边**跑（那边没有 `node:fs`）；
 *   · K-1..K-6 的**判定口径原样搬**（⛔ 借机改口径、⛔ 顺手优化）；
 *   · `blockedBy` 形状照旧：`<判据编号> · <单元 id> · <原因>`。
 *   ⇒ 上面两条由 `check:stages-route` 的 **R-13 / R-14** 咬住（含负向对拍）。
 */

import { effectiveAcceptanceOf, type AcceptanceVerdictLike } from './acceptance-verdict.ts'

/** 一条阻断项（结构化）。 */
export interface Blocker {
  /** 判据编号（`K-1`..`K-6`）。 */
  rule: string
  /** 单元 id（`(change)` 表示"这条 change 本身"）。 */
  unit: string
  /** 一句话原因（用户看得懂）。 */
  why: string
}

/** 收敛判定结果。⚠ `blockedBy` 是给人看的字符串，`blockers` 是给程序用的结构。 */
export interface ConvergenceResult {
  converged: boolean
  /** `<判据编号> · <单元 id> · <原因>` —— `TASK-R4b.md` §一.1 钉死的形状。 */
  blockedBy: string[]
  blockers: Blocker[]
  /** 允许但**必须列出**的（`K-4` 的 `handling` 风险）。 */
  noted: string[]
}

/** 账本单元的最小形状（⚠ 只要用到的字段，⛔ 不要整个 `any`）。 */
export interface ConvUnit extends AcceptanceVerdictLike {
  id?: string
  kind?: string
  status?: string
  parent?: string
  verified_at?: string
  actor?: string
  built_by?: string
  /**
   * ⚠⚠ **`acc` 的判决唯一落点是 `status`**（2026-11-01 P40/R5b · `TASK-R5b.md` §3.1-3）。
   *   `outcome` 字段已从账本 `EXTENDED_FIELDS` 删除、并由 `check:ledger` 的 `S-1` 咬住
   *   「出现即红」。⛔ 这里**不许再加回** `outcome?: string`（哪怕只是"兼容"）——
   *   兼容 = 两个落点继续活着，下次谁改一个忘另一个仍然会漂。
   */
  acceptance_ids?: string[]
  addresses?: string[]
  verify_refs?: string[]
  supersedes?: string
  superseded_by?: string
  affects?: string[]
  risk_ids?: string[]
  decisions?: string[]
}

/** 取字符串数组（缺 ⇒ 空数组；去空串）。 */
const arr = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map((x) => String(x).trim()).filter((x) => x !== '') : [])

/**
 * 某 change 的"相关单元"：它自己 + `parent` 指向它的 task/acc + 引用了它的 risk/decision。
 *
 * ⚠ "相关 risk" 的口径（⚠ 必须写清，否则 K-4 会被"找不到就跳过"绕过去）：
 *   ① `risk.affects` 里点了这个 change（或其下任一 task）；
 *   ② 这个 change / 其下任一 task 的 `risk_ids` 里点了这条 risk。
 *   ⛔ 不做"全库所有 risk 都算相关"（那会让 K-4 永远红）。
 */
export function relatedOf(units: readonly ConvUnit[], chg: ConvUnit): {
  tasks: ConvUnit[]; accs: ConvUnit[]; risks: ConvUnit[]; decisions: ConvUnit[]
} {
  const cid = String(chg.id)
  const tasks = units.filter((u) => u.kind === 'task' && String(u.parent) === cid)
  const taskIds = new Set(tasks.map((t) => String(t.id)))
  const accs = units.filter((u) => u.kind === 'acc' && (String(u.parent) === cid || taskIds.has(String(u.parent))))
  const anchors = new Set([cid, ...taskIds])
  const risks = units.filter((u) => {
    if (u.kind !== 'risk') return false
    if (arr(u.affects).some((x) => anchors.has(x))) return true
    return false
  })
  // 反向：change/task 上点名的 risk 也算相关
  const named = new Set<string>()
  for (const u of [chg, ...tasks]) for (const r of arr(u.risk_ids)) named.add(r)
  for (const u of units) {
    if (u.kind === 'risk' && named.has(String(u.id)) && !risks.includes(u)) risks.push(u)
  }
  const decisions = units.filter((u) => {
    if (u.kind !== 'decision') return false
    const namedOnUnit = [...arr(chg.decisions), ...tasks.flatMap((t) => arr(t.decisions))]
    return namedOnUnit.includes(String(u.id))
  })
  return { tasks, accs, risks, decisions }
}

/**
 * **I7 的判定本体**（`built` 任务的 `verify_refs` 必须指向真实 `evidence`）。
 *
 * ⚠⚠ 这里**是唯一实现**：`scripts/check-ledger.mjs` 的 `checkI7` 现在是
 *   **re-export 本函数**（⛔ 不再是第二份）。理由见 `K-2` 的注释：两套口径会漂。
 *
 * @param units - 全部单元
 * @returns 问题清单（字符串；空 = 绿）
 */
export function verifyRefsProblems(units: readonly ConvUnit[]): string[] {
  const problems: string[] = []
  const byId = new Map(units.map((u) => [String(u.id), u]))
  const tasks = units.filter((u) => u.kind === 'task')
  if (tasks.length === 0) return problems
  for (const t of tasks) {
    if (String(t.status) !== 'built') continue
    const refs = arr(t.verify_refs)
    if (refs.length === 0) {
      problems.push(`${t.id}：\`status=built\` 但 \`verify_refs\` **空** ⇒ 任务说做完了却指不出读数（⛔ 不按通过处理）`)
      continue
    }
    for (const rid of refs) {
      const e = byId.get(rid)
      if (e === undefined) {
        problems.push(`${t.id}：\`verify_refs\` 里的 \`${rid}\` **不存在** ⇒ 判不出（⛔ 悬空引用不许放过）`)
        continue
      }
      if (e.kind !== 'evidence') {
        problems.push(`${t.id}：\`verify_refs\` 里的 \`${rid}\` 是 \`${e.kind}\`（⛔ 不是证据单元）`)
      }
    }
  }
  return problems
}

/**
 * **I8 的判定本体**（决策取代必须**双向对上**且状态跟上）。
 *
 * ⚠⚠ 唯一实现；`scripts/check-ledger.mjs` 的 `checkI8` 现在是 re-export。
 *
 * @param units - 全部单元
 * @returns 问题清单（空 = 绿）
 */
export function decisionChainProblems(units: readonly ConvUnit[]): string[] {
  const problems: string[] = []
  const byId = new Map(units.map((u) => [String(u.id), u]))
  const decisions = units.filter((u) => u.kind === 'decision')
  if (decisions.length === 0) return problems
  const one = (v: unknown): string => (typeof v === 'string' && v.trim() !== '' ? v.trim() : '')
  for (const a of decisions) {
    const sup = one(a.supersedes)
    if (sup !== '') {
      const b = byId.get(sup)
      if (b === undefined) {
        problems.push(`${a.id}：\`supersedes = ${JSON.stringify(sup)}\` 指向的单元**不存在** ⇒ 判不出（⛔ 悬空引用不许放过）`)
      } else if (b.kind !== 'decision') {
        problems.push(`${a.id}：\`supersedes\` 里的 \`${sup}\` 是 \`${b.kind}\`（⛔ 只能取代决策）`)
      } else {
        if (one(b.superseded_by) !== a.id) {
          problems.push(`${a.id} 说取代了 \`${sup}\`，而 \`${sup}.superseded_by = ${JSON.stringify(b.superseded_by ?? null)}\``
            + ' ⇒ **单边声明**（⛔ 取代必须双向对上）')
        }
        if (String(b.status) !== 'superseded') {
          problems.push(`\`${sup}\` 已被 \`${a.id}\` 取代，而它的 \`status = ${JSON.stringify(b.status)}\`（应为 \`superseded\`）`
            + ' ⇒ **状态没跟上**')
        }
      }
    }
    const by = one(a.superseded_by)
    if (by !== '') {
      const b = byId.get(by)
      if (b === undefined) {
        problems.push(`${a.id}：\`superseded_by = ${JSON.stringify(by)}\` 指向的单元**不存在** ⇒ 判不出`)
      } else if (b.kind !== 'decision') {
        problems.push(`${a.id}：\`superseded_by\` 里的 \`${by}\` 是 \`${b.kind}\`（⛔ 只能被决策取代）`)
      } else if (one(b.supersedes) !== a.id) {
        problems.push(`${a.id}：\`superseded_by = ${by}\` 而 \`${by}.supersedes = ${JSON.stringify(b.supersedes ?? null)}\``
          + ' ⇒ **单边声明**（⛔ 反向也要对上）')
      }
    }
  }
  return problems
}

/**
 * **K-1** · 该 change 下所有 task 都到终态（`built`）。
 *
 * ── ⚠⚠ 零 task 档的口径（2026-11-01 P40/R10 裁定 · `TASK-R10.md` §一）────────
 *   **旧口径**：一条 task 都没有 ⇒ 一律红，消息写「判不出收没收口」。
 *
 *   **为什么那是错的**（⛔ 这不叫放宽，是改错消息）：
 *     K-1 的原意是「**没活干就别宣布收口**」。但对一条**只做验收**的 change：
 *       · 「没建任何 task」是**故意的**，不是漏了 —— 活早在别的 task 做完了；
 *       · 而且**判得出**它收没收口：`addresses` 里每条需求都得有 `pass` 的 acc（那是 K-3）。
 *     ⇒ 消息里那句「**判不出**收没收口」在这类 change 上是**假话**。
 *     ⚠ 实测：`CHG-2026-11-01-accept-backlog` 零 task（活早在 `TSK-031/032/033` 做完），
 *       旧口径让它**永远收不了口**，而它其实判得出（靠 K-3）。
 *
 *   **新口径（⚠ 必须窄）**：
 *     零 task **不判红**  ⟺  该 change 的 `addresses` **非空**。
 *     · `addresses` 非空 ⇒ K-3 会逐条需求判，**判据链完整** ⇒ K-1 让位（⛔ 不报）。
 *     · `addresses` **为空** ⇒ **仍然红** —— 那时它底下**什么都没有**，是真判不出。
 *       ⚠⚠ **这是本改法唯一的洞，⛔ 不许漏**：若"零 task + 零 addresses"也不报，
 *          K-1 不报、K-3 无对象 ⇒ **真空收口**（全绿）。`N-K1` 的第 ① 条就是防这个。
 *
 *   ⚠ **让位的前提是 K-3 真的会跑**：`addresses` 非空 ⇒ K-3 有对象。
 *     若将来 K-3 改成"只在有 task 时才跑"，这条让位就必须收回。
 */
export function k1(tasks: readonly ConvUnit[], addresses: readonly string[] = []): Blocker[] {
  if (tasks.length === 0) {
    /**
     * ⚠ 零 task：只有**承接了需求**（`addresses` 非空）才让位给 K-3。
     *   `addresses` 空 ⇒ 底下什么都没有 ⇒ 仍红（⛔ 否则真空收口）。
     */
    if (addresses.length > 0) return []
    return [{
      rule: 'K-1',
      unit: '(change)',
      why: '这条 change 下一条 task 都没有、**也没承接任何需求** ⇒ 它底下什么都没有，判不出收没收口'
        + '（⛔ 不按收口处理；⚠ 零 task 但 `addresses` 非空的 change 由 K-3 判，不在此列）',
    }]
  }
  const out: Blocker[] = []
  for (const t of tasks) {
    const st = String(t.status)
    if (st !== 'built') {
      out.push({ rule: 'K-1', unit: String(t.id), why: `task 状态是 \`${st}\`（终态应为 \`built\`）⇒ 还有活没做完` })
    }
  }
  return out
}

/**
 * **K-2** · 每个 `built` task 的 `verify_refs` 都指向真实 `evidence`。
 *
 * ⚠⚠ **与 I7 同源**：直接调 `verifyRefsProblems`（上面那份唯一实现），
 *   ⛔ 不另写一套口径（`TASK-R3.md` §二 K-2 明写"⛔ 不另写一套口径"）。
 */
export function k2(units: readonly ConvUnit[], taskIds: readonly string[], i7?: (u: readonly ConvUnit[]) => string[]): Blocker[] {
  const ids = new Set(taskIds)
  const probs = (i7 ?? verifyRefsProblems)(units)
  return probs
    .filter((p) => [...ids].some((id) => p.startsWith(id)))
    .map((p) => ({ rule: 'K-2', unit: p.split('：')[0], why: p }))
}

/**
 * **K-3** · 该 change 的 `addresses` 里每条需求都有 `acc` 且 `status = pass`。
 * ⚠ 判决只认 `status`（2026-11-01 R5b 裁定 A：`outcome` 已删）。
 *   ⚠⚠ 这条曾经**漂过**：R5 给 `check-ledger.mjs` 加了 `outcome ?? status`，
 *   而这里**仍然只读 `outcome`** ⇒ 本账本 28 条 acc 的 `outcome` 全空，
 *   一旦触发就会报「验收都不是 `pass`（实测：ACC-xxx=null）」—— **那是假话**。
 *   当时没红只因为没被触发（两条 change 的 `addresses` 恰好指向没有 acc 的需求）。
 *   ⇒ **恒绿只是因为没被触发，不是因为判据对。** ⛔ 不许把这里改回 `?? outcome`。
 * ⚠ 三条"判不出 ⇒ 红"：① `addresses` 空 ② 需求不存在 ③ 需求下找不到 acc。
 */
export function k3(units: readonly ConvUnit[], chg: ConvUnit, accs: readonly ConvUnit[]): Blocker[] {
  const out: Blocker[] = []
  const reqIds = arr(chg.addresses)
  if (reqIds.length === 0) {
    return [{ rule: 'K-3', unit: String(chg.id), why: '`addresses` **空** ⇒ 说不出这条 change 满足哪几条需求（⛔ 不按收口处理）' }]
  }
  const byId = new Map(units.map((u) => [String(u.id), u]))
  for (const rid of reqIds) {
    const r = byId.get(rid)
    if (r === undefined) {
      out.push({ rule: 'K-3', unit: String(chg.id), why: `\`addresses\` 里的 \`${rid}\` **不存在** ⇒ 判不出` })
      continue
    }
    if (r.kind !== 'req') {
      out.push({ rule: 'K-3', unit: String(chg.id), why: `\`addresses\` 里的 \`${rid}\` 是 \`${r.kind}\`（⛔ 不是需求）` })
      continue
    }
    /**
     * ⚠ 找这条需求的验收：`req.acceptance_ids` **或** 挂在该需求下的 task 的 acc。
     *   两条路都要走 —— 只走一条会把"验收挂在需求上"的形态误判成没验。
     * ⚠ 同一验收路径的多条历史判决按 `verified_at` 取最新有效判决；
     *   缺时刻 / 最新冲突 / 仍有待判决 ⇒ 判不出，⛔ 不许拿任一旧 PASS 代替。
     */
    const directIds = arr(r.acceptance_ids)
    const direct = directIds.map((x) => byId.get(x)).filter((x): x is ConvUnit => x !== undefined && x.kind === 'acc')
    const missingDirect = directIds.filter((x) => {
      const u = byId.get(x)
      return u === undefined || u.kind !== 'acc'
    })
    const taskIdsOfReq = new Set(units.filter((u) => u.kind === 'task' && String(u.parent) === rid).map((t) => String(t.id)))
    const indirect = accs.filter((a) => taskIdsOfReq.has(String(a.parent)))
    const allCandidates = [...direct, ...indirect]
    if (allCandidates.length === 0) {
      out.push({ rule: 'K-3', unit: rid, why: '这条需求**没有任何 acc** ⇒ 需求没被证明满足（⛔ 不许当已满足）' })
      continue
    }
    if (missingDirect.length > 0) {
      out.push({ rule: 'K-3', unit: rid, why: `\`acceptance_ids\` 里的 ${missingDirect.join(' / ')} 不存在或不是 acc ⇒ 判不出` })
      continue
    }
    /**
     * ⚠ 每条被需求正式引用的 ACC 都是独立验收路径：不能因为其中一条 PASS
     *   就替另一条 SEND-BACK 作证。同一路径的复验以新 ACC id 追加时，
     *   按 `parent` 分组取最新有效判决。
     */
    /**
     * ⚠ 同一路径 = 同一任务直属的 ACC 序列。需求直接引用的 ACC 仍逐条独立判定。
     *   旧 ACC 没有 `parent` 时，用它的 id 作为自己的路径，避免不同历史记录互相覆盖。
     */
    const groups = new Map<string, ConvUnit[]>()
    for (const a of allCandidates) {
      const key = String(a.parent ?? '').trim() !== ''
        ? `task:${String(a.parent)}`
        : `direct:${String(a.id)}`
      const list = groups.get(key) ?? []
      list.push(a)
      groups.set(key, list)
    }
    const unresolved: string[] = []
    for (const group of groups.values()) {
      const verdict = effectiveAcceptanceOf(group)
      if (verdict.verdict !== 'accepted') {
        unresolved.push(`${group.map((a) => String(a.id)).join(' / ')} = ${verdict.verdict}`
          + (verdict.reason === undefined ? '' : `（${verdict.reason}）`))
      }
    }
    if (unresolved.length > 0) {
      out.push({ rule: 'K-3', unit: rid, why: `有效验收不是 \`pass\`（${unresolved.join('；')}）⇒ 需求没被证明满足` })
    }
  }
  return out
}

/**
 * **K-4** · 相关 `risk` 里**没有** `status = open`（`handling` 允许，但必须列出）。
 *
 * ⚠⚠ 这是"最容易被顺手放过"的两条之一："开着风险就宣布收口" —— ⛔ 不许静默放过。
 * ⚠ `handling` **不算阻断**（在处置就是有人管着），但**必须出现在输出里**
 *   —— 否则读者会以为"没提就是没有风险"。
 */
export function k4(risks: readonly ConvUnit[]): { blockers: Blocker[]; noted: string[] } {
  const blockers: Blocker[] = []
  const noted: string[] = []
  for (const r of risks) {
    const st = String(r.status)
    if (st === 'open') {
      blockers.push({ rule: 'K-4', unit: String(r.id), why: '风险 `status=open`（**还没处置**）⇒ 开着风险就宣布收口' })
    } else if (st === 'handling') {
      noted.push(`${r.id}（在处置）`)
    }
  }
  return { blockers, noted }
}

/**
 * **K-5** · 相关 `decision` 里没有"已被取代却没指向继任者"的。
 * ⚠⚠ **与 I8 同源**：直接调 `decisionChainProblems`，⛔ 不另写一套。
 */
export function k5(units: readonly ConvUnit[], decIds: readonly string[], i8?: (u: readonly ConvUnit[]) => string[]): Blocker[] {
  const ids = new Set(decIds)
  if (ids.size === 0) return []
  const probs = (i8 ?? decisionChainProblems)(units)
  return probs
    .filter((p) => [...ids].some((id) => p.startsWith(id) || p.includes(id)))
    .map((p) => ({ rule: 'K-5', unit: p.split('：')[0].replace(/`/g, ''), why: p }))
}

/**
 * **K-6** · 该 change 的 `built_by` 与它下所有 `acc.actor` **不同一个人**（`CONSTITUTION` §3/§4）。
 * ⚠ 判不出 ⇒ 红：`built_by` 或 `actor` 缺 ⇒ 没法判（⛔ 不按通过处理）。
 * ⚠ 一条 acc 都没有时**不在这里报**（那是 K-3 的活）。
 */
export function k6(chg: ConvUnit, accs: readonly ConvUnit[]): Blocker[] {
  const out: Blocker[] = []
  const builder = typeof chg.built_by === 'string' ? chg.built_by.trim() : ''
  if (builder === '') {
    return [{ rule: 'K-6', unit: String(chg.id), why: '`built_by` **缺失** ⇒ 没法判"是不是自己验自己"（⛔ 不按通过处理）' }]
  }
  for (const a of accs) {
    const actor = typeof a.actor === 'string' ? a.actor.trim() : ''
    if (actor === '') {
      out.push({ rule: 'K-6', unit: String(a.id), why: '`actor` **缺失** ⇒ 判不出是谁验的（⛔ 不按通过处理）' })
      continue
    }
    if (actor === builder) {
      out.push({ rule: 'K-6', unit: String(a.id), why: `\`acc.actor\` 等于 \`${chg.id}.built_by\`（${actor}）⇒ **自己验自己**` })
    }
  }
  return out
}

/**
 * **一个 change 的完整收敛判定**（K-1..K-6 汇总）。
 *
 * ⚠ 签名照 `TASK-R4b.md` §一.1：`convergenceOf(change, units)`。
 * ⚠ 返回**结构化**结果，⛔ 不是布尔。
 *
 * @param chg - 要判的 change
 * @param units - 全部单元
 * @param deps - 可选：注入 `i7`/`i8`（⚠ 只为对拍；缺省用本文件的唯一实现）
 * @returns 收敛判定（`converged` + `blockedBy` + `blockers` + `noted`）
 */
export function convergenceOf(
  chg: ConvUnit,
  units: readonly ConvUnit[],
  deps: { i7?: (u: readonly ConvUnit[]) => string[]; i8?: (u: readonly ConvUnit[]) => string[] } = {},
): ConvergenceResult {
  const { tasks, accs, risks, decisions } = relatedOf(units, chg)
  const blockers: Blocker[] = []
  /**
   * ⚠ `k1` 现在要 `addresses`（R10 裁定）：零 task 的 change 若承接了需求，
   *   收口由 K-3 判 ⇒ K-1 让位。⚠ `chg.addresses` 缺省当空数组（= 仍红，⛔ 不默认放过）。
   */
  blockers.push(...k1(tasks, Array.isArray(chg.addresses) ? chg.addresses.map(String) : []))
  blockers.push(...k2(units, tasks.map((t) => String(t.id)), deps.i7))
  blockers.push(...k3(units, chg, accs))
  const r4 = k4(risks)
  blockers.push(...r4.blockers)
  blockers.push(...k5(units, decisions.map((d) => String(d.id)), deps.i8))
  blockers.push(...k6(chg, accs))
  return {
    converged: blockers.length === 0,
    /** ⚠ 形状照 `TASK-R4b.md` §一.1：`<判据编号> · <单元 id> · <原因>`。 */
    blockedBy: blockers.map((b) => `${b.rule} · ${b.unit} · ${b.why}`),
    blockers,
    noted: r4.noted,
  }
}

/**
 * **渲染一段可读判定**（⚠ 阻断项**逐条列出**，⛔ 不许只给布尔）。
 *
 * @param cid - change id
 * @param res - 判定结果
 * @returns 多行文本
 */
/**
 * ── ⚠⚠ **阻断项不分档**（2026-11-01 P40/R11 裁定 · `TASK-R11.md` §二）──────────────
 *   背景：R10 把 K-1 的零 task 档改成"让位给 K-3"之后，
 *   `CHG-2026-11-01-accept-backlog` 的 4 条阻断项**全是验收类**（K-3×3 + K-4），
 *   一条"活没干完"都没有。⇒ R10 §五-2 问：要不要在渲染层**按类分开标注**？
 *
 *   **裁定：⛔ 不做。**
 *
 *   ── 为什么（⚠ 三条理由，别只记结论）──────────────────────────────
 *     ① **阻断项回答的是"还差什么才能收口"**，⛔ 不是"差的是哪一类"。
 *        分类是读者的追问，不是判据的产物。
 *     ② 一旦按类分开标注，这条 change 的阻断数就会出现**两个版本**
 *        （一个总数、一个分类计数）⇒ 正是 R5b 治过的「**同一件事两个落点**」：
 *        两个数会各自漂，而没人说得清哪个是权威。
 *     ③ ⚠ 若读者需要知道"全是验收类"，那由**生成物里的原文**自己说话 ——
 *        `K-3 · R-002 · 验收都不是 pass` 已经写得很清楚，⛔ 不需要再上一层分类。
 *        分类层加得越多，越容易出现"分类对了但原文不对"的假读数。
 *
 *   ⚠ 这条裁定**不是"以后再说"**：它明确排除了一个方向（渲染层分档），
 *     若将来真要做，必须先答"两个计数谁是权威"（那会推翻 ② 的理由）。
 */
export function renderVerdict(cid: string, res: ConvergenceResult): string {
  const head = res.converged ? `converged` : `not-converged: ${res.blockers.length} 阻断项`
  const lines = [`${cid} ⇒ ${head}`]
  for (const b of res.blockers) lines.push(`    · ${b.rule} · ${b.unit} —— ${b.why}`)
  if (res.noted.length > 0) lines.push(`    ⚠ 允许但必须列出（在处置中，不算阻断）：${res.noted.join(' · ')}`)
  return lines.join('\n')
}
