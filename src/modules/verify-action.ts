/**
 * **技术验证动作（control verify）**（2026-11-25 · 自 orchestrator 搬出）。
 *
 * ⚠ 只做**参数校验 + 事实组装 + 调投影**；判据（能不能落、落什么）在 `ledger-projection`，
 *   ⛔ 本模块不复制任何判据。
 *
 * @module verify-action
 */

export interface VerifyArgs {
  taskId?: unknown
  verdict?: unknown
  verifiedAt?: unknown
  verifier?: unknown
  verificationSession?: unknown
  basis?: unknown
  criteriaRefs?: unknown
  verificationRefs?: unknown
  nonconformanceRefs?: unknown
  riskReviewRefs?: unknown
  returnTo?: unknown
  evidence?: unknown
}

export interface VerifyDeps {
  sessionId: string
  projector: { apply: (fact: Record<string, unknown>) => Promise<{ ok: boolean; reason?: string }> } | undefined
}

const list = (v: unknown): string[] => Array.isArray(v)
  ? v.map(String).map((x) => x.trim()).filter((x) => x !== '')
  : []

export async function runVerify(args: VerifyArgs, deps: VerifyDeps): Promise<string> {
  if (typeof args.taskId !== 'string' || args.taskId.trim() === '') {
    return JSON.stringify({ ok: false, reason: 'verify 需要 taskId' })
  }
  const verdict = args.verdict
  if (verdict !== 'pass' && verdict !== 'send-back' && verdict !== 'waived') {
    return JSON.stringify({ ok: false, reason: 'verify 需要 verdict: pass / send-back / waived' })
  }
  const at = typeof args.verifiedAt === 'string' ? args.verifiedAt.trim() : new Date().toISOString()
  if (!Number.isFinite(Date.parse(at))) {
    return JSON.stringify({ ok: false, reason: 'verifiedAt 不是可解析时刻：' + JSON.stringify(at) })
  }
  const verifier = String(args.verifier ?? '').trim() || deps.sessionId || ''
  if (verifier === '') return JSON.stringify({ ok: false, reason: 'verify 判不出 verifier' })
  if (deps.projector === undefined) return JSON.stringify({ ok: false, reason: '账本投影器未接入 ⇒ 技术验证不落账' })
  const projection = await deps.projector.apply({
    kind: 'verify', taskId: args.taskId, verdict, verifiedAt: at,
    basis: list(args.basis), verifier,
    ...(typeof args.verificationSession === 'string' ? { verificationSession: args.verificationSession } : {}),
    criteriaRefs: list(args.criteriaRefs), evidenceRefs: list(args.verificationRefs),
    evidenceItems: Array.isArray(args.evidence) ? args.evidence as unknown as ReadonlyArray<Record<string, unknown>> : [],
    nonconformanceRefs: list(args.nonconformanceRefs),
    riskReviewRefs: list(args.riskReviewRefs),
    ...(args.returnTo === undefined ? {} : { sendBackTo: args.returnTo }),
  })
  const evdMade = Array.isArray(args.evidence) ? args.evidence.length : 0
  const noEvidence = projection.ok === true && evdMade === 0 && list(args.verificationRefs).length === 0
  return JSON.stringify({
    ok: projection.ok, target: args.taskId, verdict,
    ...(evdMade > 0 ? { evidenceCreated: evdMade } : {}),
    ...(noEvidence ? { warn: '没有证据条目也没有 verificationRefs ⇒ VER 不会被计数。' } : {}),
    ...(projection.reason === undefined ? {} : { reason: projection.reason }),
    ledgerProjection: projection,
  })
}
