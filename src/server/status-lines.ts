/**
 * **状态工具的两段读数格式化**（2026-11-24 · A·拆分，自 orchestrator 搬出）。
 *   · notify 档：中风险动作留痕（放行 + 知情）；
 *   · 推进焦点：哪个会话在推哪条需求，其余 queued / paused / blocked。
 * ⚠ 纯字符串拼装：⛔ 不读盘、⛔ 不判对错、⛔ 不改任何状态。
 *
 * @module status-lines
 */

export interface NotifyFace {
  read: (limit?: number) => { readable: boolean; rows: Array<{ at: string; kind: string; subject: string; detail?: string; count?: number }>; total: number; reason?: string }
}

export function notifyLinesOf(face: NotifyFace | undefined): string[] {
  if (face === undefined) return []
  try {
    const r = face.read(8)
    if (r.readable !== true) return ['通知（notify 档）：⚠ 读不到（' + String(r.reason ?? '原因未知') + '）—— ⛔ 不等于没有中风险动作']
    if (r.total === 0) return ['通知（notify 档）：暂无（⛔ 这档是「确实没有」，不是「没去读」）']
    const lines = ['通知（notify 档）：' + String(r.total) + ' 条（新的在前，最多列 8 条）']
    for (const row of r.rows) {
      lines.push('  · ' + row.at + ' · ' + row.kind + ' · ' + row.subject
        + (row.count !== undefined && row.count > 1 ? '（触发 ' + String(row.count) + ' 次）' : '')
        + (row.detail === undefined ? '' : ' ↳ ' + row.detail))
    }
    lines.push('  ↳ ⚠ 这一档是知情，不是批准；需要拍板的事仍走 G1/G2/G5')
    return lines
  } catch (e) {
    return ['通知（notify 档）：⚠ 读数抛错（' + String((e as Error)?.message ?? e) + '）—— ⛔ 不等于没有条目']
  }
}

export function focusLinesOf(result: { ok?: boolean; rows?: unknown[] } | undefined): string[] {
  if (result === undefined || result.ok !== true) return ['推进焦点：⚠ 读不到（账本根判不出或服务缺席）—— ⛔ 不等于没有焦点']
  const rows = Array.isArray(result.rows) ? result.rows as Array<Record<string, unknown>> : []
  if (rows.length === 0) return ['推进焦点：暂无（这一档是「确实没有」，不是「没去读」）']
  return ['推进焦点：' + String(rows.length) + ' 条', ...rows.slice(0, 6).map((x) => '  · ' + String(x.session) + ' → ' + String(x.reqId) + ' · ' + String(x.state) + (x.expired === true ? '（租约已过期）' : '') + (x.reason === undefined ? '' : ' ↳ ' + String(x.reason)))]
}
