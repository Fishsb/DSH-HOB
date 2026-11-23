/**
 * **批准记录工具**（2026-11-23 · A·拆分，自 `modules/tools.ts` 原样搬出）。
 *
 * ══ 它做什么 ═══════════════════════════════════════════════════════════
 *   把用户回执落成 `decision` 单元（stage-approval），并支持**机器重绑**
 *   （产品事实未变时把既有批准绑到新修订；验证依据是账本快照，⛔ 不用自述）。
 * ══ 为什么单独一个模块 ═════════════════════════════════════════════════
 *   `tools.ts` 有「只准降不准升」的规模上限；批准写入是**独立职责**（写审计），
 *   与只读出口/派单判据分开更清楚。
 * ⚠ 行为逐字保留：所有校验、拒绝原因与话术与搬出前一致。
 *
 * @module approval-tool
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  APPROVAL_DECISION_KIND,
  artifactDigestOf,
  approvalScopeDigestOf,
  approvalStateOf,
  isPipelineV2,
  receiptPatternOf,
  revisionOf,
  selectedOptionValid,
} from '../shared/pipeline.ts'
import { parseUnitsToml } from '../shared/stages-index.ts'

/** 由 `tools.ts` 注入的 I/O 面（⛔ 本模块不自己拼账本落点、不自己拿写盘锁）。 */
export interface ApprovalToolDeps {
  resolveRoot: (exec: ToolRunContext) => string | undefined
  readUnits: (root: string) => Array<Record<string, unknown>>
  proceedGate: (exec: ToolRunContext) => string | undefined
  writeFile: (root: string, input: Record<string, unknown>, opts: Record<string, unknown>) => Promise<{ ok: boolean; reason?: string; message?: string }>
  maxWriteBytes: number
  keepBackups: number
  shrinkGuard: number
}

function approvalScopeFromSnapshot(root: string, artifactId: string, revision: number): { scope?: string; snapshot?: string } {
  const dir = join(root, 'backups', '(root)')
  let files: string[]
  try { files = readdirSync(dir).filter((f) => /^index\.toml\..*\.bak$/.test(f)).sort() } catch { return {} }
  for (const f of files) {
    try {
      const units = parseUnitsToml(readFileSync(join(dir, f), 'utf8')) as Array<Record<string, unknown>>
      const u = units.find((x) => String(x.id ?? '') === artifactId && Number(x.revision) === revision)
      if (u !== undefined) return { scope: approvalScopeDigestOf(u), snapshot: f }
    } catch { /* 单个快照坏了就跳过，⛔ 不让它污染判断 */ }
  }
  return {}
}

export function createLedgerApprove(deps: ApprovalToolDeps) {
  const ledgerApprove = defineTool({
    name: 'hob_pipeline_approve',
    description: '记录用户对 Pipeline v3 需求或方案的明确批准 / 修改要求。'
      + '⚠ 必须给用户回执原文 `source`；默认只预演，真写要 `dryRun:false`。'
      + '⚠ 它只写批准审计，不替用户选路径，也不自动推进阶段。',
    parameters: {
      artifactId: {
        type: 'string',
        required: true,
        description: '被批准的稳定 ID（R-... 或 CHG-...）。',
      },
      revision: {
        type: 'integer',
        required: true,
        description: '用户批准的具体修订号；必须与账本中的 revision 完全一致。',
      },
      decision: {
        type: 'string',
        required: true,
        enum: ['approve', 'request-changes'],
        description: 'approve=确认当前版本；request-changes=要求修改。',
      },
      source: {
        type: 'string',
        required: true,
        description: '用户回执原文，必须能证明用户明确说出了对象和版本。',
      },
      selectedOption: {
        type: 'string',
        description: '方案批准时必填：从当前 path_options 中选中的路径（如 A / B / C）。',
      },
      dryRun: {
        type: 'boolean',
        description: '（可选）缺省 true = 只预演。',
      },
      rebindFrom: {
        type: 'string',
        description: '（可选）把一条既有批准记录**机器重绑到当前修订**：需给出原决策 id（如 DEC-005）。'
          + '⚠ 仅在**产品事实未变**（标题/正文/路径/需求映射逐字相同）时成立 —— 服务端用账本快照复算原修订的产品事实摘要比对，不等则拒。⛔ 不代替用户重新确认新品决策。',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String((value as { message?: string })?.message ?? '') }],
    },
    async execute(args: {
      artifactId: string
      revision: number
      decision: 'approve' | 'request-changes'
      source: string
      selectedOption?: string
      dryRun?: boolean
      rebindFrom?: string
    }, exec: ToolRunContext): Promise<JsonValue> {
      const root = deps.resolveRoot(exec)
      if (root === undefined || root.trim() === '') {
        return { ok: false, reason: 'no-ledger-root', message: '拒绝：账本落点判不出。' } as unknown as JsonValue
      }
      let units: Array<Record<string, unknown>>
      try { units = deps.readUnits(root) as Array<Record<string, unknown>> } catch (e) {
        return { ok: false, reason: 'ledger-unreadable', message: `账本读不到：${String((e as Error)?.message ?? e)}` } as unknown as JsonValue
      }
      const id = String(args.artifactId ?? '').trim()
      const artifact = units.find((u) => String(u.id ?? '') === id)
      if (artifact === undefined) {
        return { ok: false, reason: 'artifact-not-found', message: `拒绝：账本里没有 ${id}` } as unknown as JsonValue
      }
      const kind = String(artifact.kind ?? '')
      if (kind !== 'req' && kind !== 'change') {
        return { ok: false, reason: 'artifact-not-approvable', message: `拒绝：${id} 是 ${kind}，只有需求和方案需要用户阶段批准。` } as unknown as JsonValue
      }
      if (!isPipelineV2(artifact)) {
        return { ok: false, reason: 'legacy-artifact', message: `拒绝：${id} 属于旧管线，不能后补成 v3 批准；请新建 v3 需求。` } as unknown as JsonValue
      }
      const actualRevision = revisionOf(artifact)
      if (actualRevision === undefined || actualRevision !== Number(args.revision)) {
        return {
          ok: false, reason: 'revision-mismatch',
          message: `拒绝：${id} 当前第 ${actualRevision ?? '?'} 版，用户回执写的是第 ${String(args.revision)} 版。`,
        } as unknown as JsonValue
      }
      let source = String(args.source ?? '').trim()
      if (source === '') {
        return { ok: false, reason: 'source-required', message: '拒绝：批准必须附用户回执原文 source。' } as unknown as JsonValue
      }
      /** ⚠ 2026-11-23：重绑时路径选择取自原决策，故先取标记、再校验候选。 */
      const rebindFromRaw = String(args.rebindFrom ?? '').trim()
      let selectedOption = String(args.selectedOption ?? '').trim()
      let decision = args.decision
      if (decision !== 'approve' && decision !== 'request-changes') {
        return { ok: false, reason: 'decision-invalid', message: '拒绝：decision 只收 approve / request-changes。' } as unknown as JsonValue
      }
      if (decision === 'approve' && kind === 'change' && rebindFromRaw === '') {
        const options = Array.isArray(artifact.path_options) ? artifact.path_options.map(String) : []
        if (selectedOption === '' || !options.includes(selectedOption)) {
          return {
            ok: false, reason: 'option-invalid',
            message: `拒绝：方案批准必须从当前 path_options 中选择路径（当前：${options.join(' / ') || '(无可选路径)'}）。`,
          } as unknown as JsonValue
        }
      }
      /**
       * The user receipt must name the object and revision. A bare "continue"
       * or "OK" is not approval.
       *
       * ⚠ **R-15：判据来自 {@link receiptPatternOf}，⛔ 不在这里内联正则。**
       * 本仓曾有两份不等价的回执正则（纯函数版 `\s+` / 本处 `\s*`），
       * 分叉的成因就是"在调用点重写一遍"。现在两处共用一份实现。
       * `acceptRevisionRequest: true` —— 本工具在同一入口既处理批准也处理退回。
       */
      let reboundMeta: { from: string; basis: string } | undefined
      const rebindFrom = rebindFromRaw
      if (rebindFrom !== '') {
        /**
         * ⚠ 2026-11-23 · **机器重绑**：用户已批准过同一份产品事实，只是修订号/机器细节变了。
         *   验证依据**不是**调用方自述，而是账本快照里原修订的产品事实摘要。
         *   ⛔ 产品事实任何一处不同 ⇒ 拒（那才是需要用户重新确认的变化）。
         */
        const old = units.find((u) => String(u.id ?? '') === rebindFrom && String(u.kind ?? '') === 'decision')
        if (old === undefined) return { ok: false, reason: 'rebind-source-not-found', message: `拒绝：账本里没有决策 ${rebindFrom}。` } as unknown as JsonValue
        if (String(old.artifact_id ?? '') !== id) return { ok: false, reason: 'rebind-target-mismatch', message: `拒绝：${rebindFrom} 批准的是 ${String(old.artifact_id ?? '?')}，不是 ${id}。` } as unknown as JsonValue
        if (String(old.decision_kind ?? '') !== APPROVAL_DECISION_KIND) return { ok: false, reason: 'rebind-not-approval', message: '拒绝：只有 stage-approval 决策可重绑。' } as unknown as JsonValue
        if (String(old.decision ?? '') !== 'approve') return { ok: false, reason: 'rebind-not-approve', message: '拒绝：只有 approve 决策可重绑（request-changes 需要新的用户回执）。' } as unknown as JsonValue
        const currentScope = approvalScopeDigestOf(artifact)
        let oldScope = String(old.approval_scope_digest ?? '').trim()
        let basis = 'recorded-scope-digest'
        if (oldScope === '') {
          const snap = approvalScopeFromSnapshot(root, id, Number(old.artifact_revision))
          if (snap.scope === undefined) {
            return { ok: false, reason: 'rebind-unverifiable', message: `拒绝：${rebindFrom} 没有作用域摘要，且找不到第 ${String(old.artifact_revision ?? '?')} 版的账本快照 ⇒ 无法机器验证「产品事实未变」，⛔ 不代你确认。` } as unknown as JsonValue
          }
          oldScope = snap.scope
          basis = 'snapshot:' + String(snap.snapshot ?? '')
        }
        if (oldScope !== currentScope) {
          return { ok: false, reason: 'rebind-scope-changed', message: `拒绝：${id} 的产品事实（标题/正文/路径/需求映射）在第 ${String(old.artifact_revision ?? '?')} 版之后发生了变化（原摘要 ${oldScope}，当前 ${currentScope}）⇒ 需用户重新确认，不能机器重绑。` } as unknown as JsonValue
        }
        selectedOption = String(old.selected_option ?? '').trim()
        if (kind === 'change' && !selectedOptionValid(artifact, selectedOption)) {
          const options = Array.isArray(artifact.path_options) ? (artifact.path_options as unknown[]).map(String) : []
          return { ok: false, reason: 'rebind-option-invalid', message: `拒绝：原批准选中的路径「${selectedOption || '(空)'}」已不在当前候选中（当前：${options.join(' / ') || '(无)'}）⇒ 需用户重新选择。` } as unknown as JsonValue
        }
        reboundMeta = { from: rebindFrom, basis }
        source = String(old.source ?? '').trim()
        decision = 'approve'
      }

      const receipt = receiptPatternOf(
        { id, kind: String(artifact.kind ?? ''), revision: actualRevision },
        { acceptRevisionRequest: true },
      )
      if (reboundMeta === undefined && !receipt.test(source)) {
        return {
          ok: false, reason: 'receipt-mismatch',
          message: `拒绝：用户回执没有同时点名 ${id} 与第 ${actualRevision} 版；只写“继续 / 可以”不算批准。`,
        } as unknown as JsonValue
      }
      const approval = approvalStateOf(artifact, units)
      if (approval.state === 'legacy') {
        return { ok: false, reason: 'legacy-artifact', message: '拒绝：旧管线条目不能后补批准。' } as unknown as JsonValue
      }
      const maxSeq = Math.max(0, ...units
        .filter((u) => String(u.kind) === 'decision')
        .map((u) => Number(/^DEC-(\d+)$/.exec(String(u.id ?? ''))?.[1] ?? 0)))
      const decisionId = `DEC-${String(maxSeq + 1).padStart(3, '0')}`
      const decidedAt = new Date().toISOString()
      const lines = [
        '[[unit]]',
        `id = ${JSON.stringify(decisionId)}`,
        'kind = "decision"',
        'status = "active"',
        `title = "用户${decision === 'approve' ? '批准' : '要求修改'} ${id} 第 ${actualRevision} 版"`,
        `decision_kind = ${JSON.stringify(APPROVAL_DECISION_KIND)}`,
        `approval_stage = ${JSON.stringify(kind === 'req' ? 'requirements' : 'plan')}`,
        `artifact_id = ${JSON.stringify(id)}`,
        `artifact_revision = ${JSON.stringify(String(actualRevision))}`,
        `artifact_digest = ${JSON.stringify(artifactDigestOf(artifact))}`,
        `approval_scope_digest = ${JSON.stringify(approvalScopeDigestOf(artifact))}`,
        ...(reboundMeta === undefined ? [] : [`rebound_from = ${JSON.stringify(reboundMeta.from)}`, `rebound_basis = ${JSON.stringify(reboundMeta.basis)}`]),
        `decision = ${JSON.stringify(decision)}`,
        ...(selectedOption === '' ? [] : [`selected_option = ${JSON.stringify(selectedOption)}`]),
        'decided_by = "user"',
        `decided_at = ${JSON.stringify(decidedAt)}`,
        `source = ${JSON.stringify(source)}`,
        '',
      ]
      const content = lines.join('\n')
      if (args.dryRun !== false) {
        return {
          ok: true, dryRun: true, decisionId,
          message: `[演练] 将记录 ${decisionId}：${source}`
            + (reboundMeta === undefined ? '' : `\n  ↳ 机器重绑自 ${reboundMeta.from}（依据 ${reboundMeta.basis}）：产品事实与原批准逐字相同，仅修订号/机器细节变化。`)
            + '\n  ⚠ 未落盘。确认后传 dryRun:false。',
        } as unknown as JsonValue
      }
      /**
       * ══════════════════════════════════════════════════════════════════════
       * **T-13：真写之前先过「能不能推进」闸门**（2026-11-10）
       * ══════════════════════════════════════════════════════════════════════
       *
       * ── 病（实测）────────────────────────────────────────────────────────
       *   `hob_pipeline_approve` / `hob_ledger_init` / `hob_ledger_migrate` /
       *   `hob_ledger_rebuild` 四个写工具**都不过 `proceedGate`**（`grep` 只命中
       *   `:1306` 定义与 `:1582` 的 `write_hob`）。
       *   ⇒ `archived` / `quarantined` / `pending-activation` / `unknown-legacy`
       *     的会话（`mayProceed=false`）**仍能写「用户批准」落账** ——
       *     「被隔离的会话不能推进」这条不变量在**写路径**上有一个旁路。
       *
       * ⚠ `dryRun` 保持放行（纯预演不改变任何东西，与 `write_hob` 一致）。
       * ⚠ `hob_ledger_init` 不过闸门是**有理由的**（它是开张而不是推进），
       *   本批不动它；`approve` 没有这个理由。
       */
      if (args.dryRun === false) {
        const blocked = deps.proceedGate(exec)
        if (blocked !== undefined) {
          return { ok: false, reason: 'proceed-not-confirmed', message: blocked } as unknown as JsonValue
        }
      }
      const w = await deps.writeFile(root, {
        file: 'ledger/units/unit-pipeline-approval.toml',
        content,
        mode: 'append',
      }, {
        hobDir: '',
        keepBackups: deps.keepBackups,
        shrinkGuard: deps.shrinkGuard,
        maxFileBytes: deps.maxWriteBytes,
        /**
         * ⚠ **T-06：不再传 `validateLedgerStructure: false`**（2026-11-10）。
         *
         * 原注释的理由是「approval units are valid v2 decisions even when other
         * legacy rows are not migrated」——**这个理由不成立**：
         *   · `decision` 与封闭契约**完全兼容**（`UNIT_STATUSES.decision = ['active','superseded']`，
         *     本工具写的正是 `status="active"`）；
         *   · 实测在健康账本上走统一校验 ⇒ `ok:true`；
         *   · 而豁免的**实际后果**是「连 C-22 字段校验都跳过」——
         *     即这个工具自己写出非法 decision 也能落盘。
         * ⇒ 去掉豁免，与其余三个写入口同一道校验。
         */
        allowApprovalShard: true,
      })
      if (!w.ok) {
        return { ok: false, reason: w.reason, message: `批准记录写盘失败：${w.message}` } as unknown as JsonValue
      }
      return {
        ok: true, decisionId, artifactId: id, revision: actualRevision, decision,
        ...(selectedOption === '' ? {} : { selectedOption }),
        message: `已记录 ${decisionId}：用户${decision === 'approve' ? '批准' : '要求修改'} ${id} 第 ${actualRevision} 版。`,
      } as unknown as JsonValue
    },
  })
  return ledgerApprove
}
