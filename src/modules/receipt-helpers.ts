/**
 * **回执解析与看护落盘助手**（2026-11-23 · A·拆分，自 `modules/orchestrator.ts` 原样搬出）。
 *
 * ══ 它们做什么 ═══════════════════════════════════════════════════════════
 *   `lastAssistantEntry` / `changedFiles` / `receiptProgressRefsOf` / `buildReceipt`
 *   —— 从会话事件里抽出**回执正文与改动清单**；
 *   `toPersisted` —— 把内存看护记录投影成盘上形态（D10 四标记 / D11 时刻逐字保留）。
 * ⚠ 行为逐字保留；本模块只做纯转换，⛔ 不读写盘、⛔ 不改判据。
 *
 * @module receipt-helpers
 */
import type { PersistedWatch } from '../server/orch-state.ts'

/** 看护记录的结构面（⛔ 不回引 orchestrator —— 那会成循环依赖）。 */
type Watch = Record<string, any>

export function lastAssistantEntry(session: any): { text: string; at?: number } | undefined {
  try {
    const log = session?.log
    if (!Array.isArray(log)) return undefined
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i]
      if (e?.type !== 'assistant/message') continue
      const content = e.data?.message?.content
      if (!Array.isArray(content)) continue
      const text = content
        .filter((c: any) => c && c.type === 'text' && typeof c.text === 'string')
        .map((c: any) => c.text)
        .join('\n')
        .trim()
      if (text !== '') {
        const at = typeof e?.time === 'number' && Number.isFinite(e.time) ? e.time : undefined
        return at === undefined ? { text } : { text, at }
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

export function lastAssistantText(session: any): string | undefined {
  return lastAssistantEntry(session)?.text
}

export function changedFiles(session: any, max = 40): string[] {
  try {
    const log = session?.log
    if (!Array.isArray(log)) return []
    const seen = new Set<string>()
    for (const e of log) {
      if (e?.type !== 'tool/call') continue
      const nm = e.data?.name
      if (nm !== 'write' && nm !== 'edit' && nm !== 'notebook_edit') continue
      const raw = e.data?.arguments
      if (typeof raw !== 'string' || raw === '') continue
      try {
        const args = JSON.parse(raw)
        const p = args?.file_path ?? args?.path ?? args?.notebook_path
        if (typeof p === 'string' && p !== '') seen.add(p)
      } catch {
        /* 参数不是 JSON 就跳过 —— 不能因为一条坏记录让整份回传失败 */
      }
      if (seen.size >= max) break
    }
    return [...seen]
  } catch {
    return []
  }
}

export function receiptProgressRefsOf(text: string | undefined): string[] {
  if (typeof text !== 'string' || text.trim() === '') return []
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^[-*+]\s+/, '')
    if (line === '' || line.length > 240) continue
    const looksLikeReading = /(?:check:[a-z][a-z0-9-]*|npm run|exit\s*[-:]?\s*\d+|\b\d+\s*\/\s*\d+\b|\b\d+\s*(?:条|处|个|次|项|秒|毫秒|字节|B|KB|MB)\b)/i.test(line)
      && /(?:通过|失败|PASS|FAIL|exit|✓|✗|成功|报错|红|绿|\d+\s*\/\s*\d+)/i.test(line)
    if (looksLikeReading) out.push(line.slice(0, 200))
    if (out.length >= 12) break
  }
  return out
}

export function buildReceipt(w: Watch, session: any): string {
  const conclusion = lastAssistantText(session)
  const files = changedFiles(session)
  const lines: string[] = [
    '【自动回传】你派出去的那一轮有结果了。',
    '',
    `- 执行会话：${w.target}`,
    ...(w.round === undefined ? [] : [`- 轮次：第 ${w.round} 轮`]),
    ...(w.task === undefined ? [] : [`- 你派的事：${w.task}`]),
    '',
    '## 它给出的结论',
    conclusion === undefined
      ? '（没读到文本结论 —— 它这一轮可能只调了工具就结束了。必要时用 hob_sessions 看它的状态，或直接问它。）'
      : conclusion,
    '',
    '## 它改动的文件',
    files.length === 0
      ? '（没有观察到 write/edit 类调用 ⇒ 这一轮它没有落盘改动。）'
      : files.map((f) => `- ${f}`).join('\n'),
    '',
    '---',
    '⚠ 这只是**你自己的记录**：是"对方说它做了什么"，不是你已经验收过的结果。',
    '下一步由你判断：**续用这个会话**（同一个问题、上下文还干净）还是',
    '**新建一个会话**（进入新阶段、或这一轮把上下文弄脏了、偏离当前任务较大）。',
    '决定后用 hob_dispatch 下发；若判定这件事已经完了，直接宣布结束，不要再派。',
  ]
  return lines.join('\n')
}

export function toPersisted(w: Watch): PersistedWatch {
  return {
    target: w.target,
    watcher: w.watcher,
    ...(w.round === undefined ? {} : { round: w.round }),
    ...(w.task === undefined ? {} : { task: w.task }),
    ...(w.taskId === undefined ? {} : { taskId: w.taskId }),
    ...(w.dispatchId === undefined ? {} : { dispatchId: w.dispatchId }),
    ...(w.runId === undefined ? {} : { runId: w.runId }),
    ...(w.requestedTarget === undefined ? {} : { requestedTarget: w.requestedTarget }),
    ...(w.targetChanged === undefined ? {} : { targetChanged: w.targetChanged }),
    ...(w.ledgerProjection === undefined ? {} : { ledgerProjection: w.ledgerProjection }),
    at: w.at,
    sawRunning: w.sawRunning,
    ...(w.error === undefined ? {} : { error: w.error }),
    // 🔑 归属两件：**逐条**带（⛔ 不再由调用点"统一盖一个"）
    ...(w.owner === undefined || w.owner === '' ? {} : { owner: w.owner }),
    ...(w.ownerWsRoot === undefined || w.ownerWsRoot === '' ? {} : { wsRoot: w.ownerWsRoot }),
    // ── 耐久化五件（2026-10-20 · B2）：⛔ 缺一就修不掉 W3 / W4 / P2 ──────────
    ...(w.lastStatus === undefined ? {} : { lastStatus: w.lastStatus }),
    /**
     * ⚠⚠ **投递三件必须落盘**（2026-10-20 · 第 4 单）：它们是**跨进程幂等**的唯一依据
     *   （`reported` 只在内存里，一重载就归零 ⇒ 同一份回执会再发一份）。
     *   ⚠ 三件语义各不相同，⛔ 不许合并成一个字段：
     *     · `deliveryAttemptAt` —— 投之前落的"试过了"；
     *     · `deliveredAt` —— 投**成功**（⇒ 只差清账，⛔ 绝不重发）；
     *     · `cleanupFailedAt` —— 送到了但**清账失败**（下一轮只重试清账）。
     */
    ...(w.deliveryAttemptAt === undefined ? {} : { deliveryAttemptAt: w.deliveryAttemptAt }),
    ...(w.deliveredAt === undefined ? {} : { deliveredAt: w.deliveredAt }),
    ...(w.cleanupFailedAt === undefined ? {} : { cleanupFailedAt: w.cleanupFailedAt }),
    ...(w.cleanupRetryCount === undefined ? {} : { cleanupRetryCount: w.cleanupRetryCount }),
    ...(w.settleState === undefined ? {} : { settleState: w.settleState }),
    ...(w.recheckCount === undefined ? {} : { recheckCount: w.recheckCount }),
    ...(w.lastRecheckAt === undefined ? {} : { lastRecheckAt: w.lastRecheckAt }),
    ...(w.evidence === undefined ? {} : { evidence: w.evidence }),
    /**
     * ── **`D10` 四标记 + `D11` 运行态时刻必须落盘**（包 A 第 4/6 件）──────────
     *   ⚠ 这五个字段与 `settleState` / `recheckCount` 同一条纪律：**内存与盘上必须一致**。
     *     只活内存 ⇒ 重载后"拒收 / 要澄清 / 已验收 / 已退回"全部退回成"在跑没回音"
     *     或"已回传" —— 那正是 `D10` 要治的两对不可分辨。
     */
    ...(w.refusedAt === undefined ? {} : { refusedAt: w.refusedAt }),
    ...(w.clarifyAt === undefined ? {} : { clarifyAt: w.clarifyAt }),
    ...(w.acceptedAt === undefined ? {} : { acceptedAt: w.acceptedAt }),
    ...(w.sentBackAt === undefined ? {} : { sentBackAt: w.sentBackAt }),
    ...(w.returnTo === undefined ? {} : { returnTo: w.returnTo }),
    ...(w.sawRunningAt === undefined ? {} : { sawRunningAt: w.sawRunningAt }),
    /** ⚠ `D4` 未送达事实：与上面同一条纪律（内存与盘上必须一致）。 */
    ...(w.undeliveredAt === undefined ? {} : { undeliveredAt: w.undeliveredAt }),
    ...(w.undeliveredWhy === undefined ? {} : { undeliveredWhy: w.undeliveredWhy }),
    /** ⚠ 包 H：四态的依据也必须一并落盘（只活内存 ⇒ 重载后"有态无据"）。 */
    ...(w.refusedWhy === undefined ? {} : { refusedWhy: w.refusedWhy }),
    ...(w.clarifyWhy === undefined ? {} : { clarifyWhy: w.clarifyWhy }),
    ...(w.basis === undefined ? {} : { basis: w.basis }),
  }
}
