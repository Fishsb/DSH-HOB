/**
 * **有效验收判决** —— 同一任务存在多条 ACC 时，只看最新一条可判定的判决。
 *
 * ⚠ 历史判决不删除、不改写；新判决追加一条 ACC。派生状态必须按 `verified_at`
 *   选最新，否则旧 SEND-BACK 会永久压住复验 PASS，旧 PASS 也可能掩盖后来退回。
 * ⚠ 纯函数、零 I/O，client / script 共用：
 *   · 最新 PASS ⇒ accepted；
 *   · 最新 SEND-BACK ⇒ send-back；
 *   · 缺时刻、时刻无法排序或最新时刻冲突 ⇒ undecidable（fail-closed）。
 */

export type EffectiveAcceptanceVerdict = 'accepted' | 'send-back' | 'undecidable'

export interface AcceptanceVerdictLike {
  id?: string
  status?: string
  verified_at?: string
}

export interface EffectiveAcceptance {
  verdict: EffectiveAcceptanceVerdict
  /** 作为依据的最新 ACC id；判不出或缺判决时为 undefined。 */
  latest_id?: string
  /** 最新判决时刻；判不出时保留空值。 */
  verified_at?: string
  /** 同一最新时刻上并存的 ACC id（⚠ 只在冲突时出现）。 */
  conflicts?: string[]
  /** 判不出的结构化原因；可判定时缺省。 */
  reason?: string
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** 把 ISO8601 转成可比较的毫秒数；缺时区时按 UTC 解释，非法值返回 undefined。 */
function instantOf(raw: string): number | undefined {
  const withZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)
    ? raw
    : `${raw}Z`
  const ms = Date.parse(withZone)
  return Number.isFinite(ms) ? ms : undefined
}

/**
 * 从一组 ACC 求出有效判决。
 *
 * @param accs - 同一任务直属的 ACC（⚠ 调用方负责先把范围限定到同一任务）
 * @returns 最新判决；任何缺时刻 / 时刻冲突 / 未知状态都返回 undecidable
 */
export function effectiveAcceptanceOf(accs: readonly AcceptanceVerdictLike[]): EffectiveAcceptance {
  if (accs.length === 0) {
    return { verdict: 'undecidable', reason: '没有已判决的验收' }
  }

  const pending = accs.filter((a) => ['', 'unverified'].includes(text(a.status)))
  if (pending.length > 0) {
    return {
      verdict: 'undecidable',
      latest_id: text(pending[0].id) || undefined,
      reason: '验收尚未判决',
    }
  }

  const judged = accs.filter((a) => ['pass', 'send-back'].includes(text(a.status)))
  if (judged.length === 0) {
    return { verdict: 'undecidable', reason: '存在未知验收状态，无法判定' }
  }

  const rows: Array<{ id: string, status: 'pass' | 'send-back', at: number, rawAt: string }> = []
  for (const a of accs) {
    const id = text(a.id) || '(无 id)'
    const status = text(a.status)
    if (!['pass', 'send-back'].includes(status)) return { verdict: 'undecidable', reason: `${id} 状态未知` }
    const rawAt = text(a.verified_at)
    /**
     * ⚠ 只有**一条**判决时，状态本身就是有效判决，缺时刻只降低“完成→判决”
     *   时间差的覆盖率，⛔ 不能把一个确定 PASS 降成 undecidable。
     *   需要排序的仅是多条判决；存储质量由 Current 的 verified_at 覆盖率单列。
     */
    if (rawAt === '' && accs.length === 1) {
      return {
        verdict: status === 'pass' ? 'accepted' : 'send-back',
        latest_id: id,
      }
    }
    if (rawAt === '') {
      return { verdict: 'undecidable', reason: `${id} 缺 verified_at，无法确定哪条最新` }
    }
    const at = instantOf(rawAt)
    if (at === undefined) {
      return { verdict: 'undecidable', reason: `${id} 的 verified_at 无法解析` }
    }
    rows.push({ id, status: status as 'pass' | 'send-back', at, rawAt })
  }

  const latestAt = Math.max(...rows.map((r) => r.at))
  const latest = rows.filter((r) => r.at === latestAt)
  if (latest.length > 1) {
    const statuses = new Set(latest.map((r) => r.status))
    if (statuses.size > 1) {
      return {
        verdict: 'undecidable',
        verified_at: latest[0].rawAt,
        conflicts: latest.map((r) => r.id).sort(),
        reason: '最新判决时刻上同时存在 PASS 与 SEND-BACK',
      }
    }
    return {
      verdict: latest[0].status === 'pass' ? 'accepted' : 'send-back',
      latest_id: latest.map((r) => r.id).sort()[0],
      verified_at: latest[0].rawAt,
    }
  }

  const chosen = latest[latest.length - 1]
  return {
    verdict: chosen.status === 'pass' ? 'accepted' : 'send-back',
    latest_id: chosen.id,
    verified_at: chosen.rawAt,
  }
}
