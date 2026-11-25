/**
 * **工具内用户确认（D1）**（2026-11-25）：把宿主 `userQuestions.ask` 包成批准工具可用的依赖。
 *
 * ⚠ 只做三件事：取服务、取活 agent、把回答规范成 `{ selected, answerId }`。
 *   ⛔ 不判断能不能批（那是判据的事）；⛔ 不在缺席时假装成功（调用方 fail-closed）。
 *
 * @module ask-user
 */

export interface AskPayload { header?: string; question: string; options: Array<{ label: string; description?: string }> }
export type AskResult = { ok: true; selected: string[]; answerId?: string } | { ok: false; reason: string }

export function makeAskUserOf(ctx: any): (exec: any, payload: AskPayload) => Promise<AskResult> {
  return async (exec: any, payload: AskPayload): Promise<AskResult> => {
    const service = (() => {
      try { return typeof ctx?.get === 'function' ? ctx.get('userQuestions') : ctx?.userQuestions } catch { return undefined }
    })()
    if (service === undefined || typeof service.ask !== 'function') return { ok: false, reason: 'no-questions-service' }
    const sessionId = String(exec?.agent?.session?.header?.id ?? exec?.agent?.id ?? '')
    const agent = (() => { try { return sessionId === '' ? undefined : ctx?.agents?.get?.(sessionId) } catch { return undefined } })()
    if (agent === undefined) return { ok: false, reason: 'no-live-agent' }
    try {
      const answer = await service.ask({
        questions: [{
          id: 'd1-confirm',
          ...(payload.header === undefined ? {} : { header: payload.header }),
          question: payload.question,
          options: payload.options.map((o) => ({ label: o.label, ...(o.description === undefined ? {} : { description: o.description }) })),
          multiple: false,
        }],
      }, agent)
      const item = Array.isArray(answer?.answers) ? answer.answers[0] : answer
      const selected = Array.isArray(item?.selected) ? item.selected.map(String) : []
      const answerId = String(item?.questionId ?? item?.id ?? '') || undefined
      return { ok: true, selected, ...(answerId === undefined ? {} : { answerId }) }
    } catch (e) {
      return { ok: false, reason: 'ask-failed: ' + String((e as Error)?.message ?? e) }
    }
  }
}
