/**
 * **验收门禁执行**（2026-11-25 · 自 orchestrator 搬出）。
 *
 * ⚠ 只做「门禁未接入 / 判不出 / 未通过」三档的**可读拒绝**；⛔ 不改判决、⛔ 不写账。
 *   通过时返回 `undefined`，由调用方继续走 `orch.judge`。
 *
 * @module accept-action
 */

export type AcceptGateVerdict = { ok: boolean; reason?: string }

export function runAcceptGate(input: {
  taskId: unknown
  gate: ((exec: unknown, taskId: string) => AcceptGateVerdict) | undefined
  exec: unknown
}): string | undefined {
  if (input.gate === undefined) {
    return JSON.stringify({
      ok: false, requestedVerdict: 'accepted', target: input.taskId,
      reason: '验收门禁未接入（acceptanceGateOf 缺席）⇒ 本次不落账',
    })
  }
  let verdict: AcceptGateVerdict
  try {
    verdict = input.gate(input.exec, String(input.taskId ?? ''))
  } catch (e) {
    return JSON.stringify({
      ok: false, requestedVerdict: 'accepted', target: input.taskId,
      reason: `验收门禁判不出（${String((e as Error)?.message ?? e)}）⇒ 本次不落账`,
    })
  }
  if (!verdict.ok) {
    return JSON.stringify({
      ok: false, requestedVerdict: 'accepted', target: input.taskId,
      reason: verdict.reason ?? '验收门禁未通过',
    })
  }
  return undefined
}

/**
 * **G5 结构化确认**（D1-4）：向用户点选「接受 / 退回 / 暂不处理」。
 *   ⚠ 问不到 ⇒ 返回 blocked（fail-closed）；返回 ref 时才允许落账。
 */
export async function runAcceptConfirm(input: {
  askUser: ((exec: unknown, payload: { header?: string; question: string; options: Array<{ label: string }> }) => Promise<{ ok: true; selected: string[]; answerId?: string } | { ok: false; reason: string }>) | undefined
  exec: unknown
  taskId: unknown
}): Promise<{ blocked: string } | { ref: string }> {
  if (input.askUser === undefined) return { blocked: JSON.stringify({ ok: false, requestedVerdict: 'accepted', target: input.taskId, reason: '拒绝：本环境没有用户提问服务 ⇒ 不落验收。' }) }
  const asked = await input.askUser(input.exec, {
    header: '验收确认',
    question: '是否接受 ' + String(input.taskId) + ' 的交付结果？',
    options: [{ label: '接受' }, { label: '退回' }, { label: '暂不处理' }],
  })
  if (asked.ok !== true) return { blocked: JSON.stringify({ ok: false, requestedVerdict: 'accepted', target: input.taskId, reason: '拒绝：用户确认未取得（' + asked.reason + '）⇒ 不落验收。' }) }
  const picked = String(asked.selected?.[0] ?? '')
  if (picked !== '接受') return { blocked: JSON.stringify({ ok: false, requestedVerdict: 'accepted', target: input.taskId, reason: '拒绝：用户点选「' + picked + '」⇒ 本次不落验收。' }) }
  const ref = String(asked.answerId ?? '').trim()
  if (ref === '') return { blocked: JSON.stringify({ ok: false, requestedVerdict: 'accepted', target: input.taskId, reason: '拒绝：宿主没有返回 answerId ⇒ 无凭证不落账。' }) }
  return { ref }
}
