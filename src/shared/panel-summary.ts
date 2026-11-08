/**
 * 任务进度面板的**第一屏摘要**（纯函数，零 I/O）。
 *
 * 它只从既有派生读数里折叠出四件事：
 *   当前阶段 / 唯一主动作 / 在等谁 / 主阻断。
 * ⛔ 不新增状态、⛔ 不读时间、⛔ 不猜缺失值。
 */
import type { NextAction } from './next-action.ts'
import type { StageRow } from './stages-index.ts'
import type { WorkStateReading } from './work-state.ts'

export type PanelWaitFor = 'user' | 'acceptance' | 'execution' | 'upstream' | 'undecidable'

export interface PanelSummary {
  stage: {
    step: number
    name: string
    state: 'done' | 'doing' | 'todo'
    done: number
    total: number
  } | null
  action: {
    kind: NextAction['kind']
    target: string | null
    /**
     * ⚠ **只给结论短句，不复述 `next.why`**（2026-11-07 去重）。
     *
     * 病灶实测：`summary.action.why === next.why` 逐字相同，
     *   `summary.blocker === next.blockedBy[0]` 也逐字相同 ⇒ 同一句话在
     *   第一屏摘要卡和下面的「下一步」块**各显示一次**。
     *   ⚠ 读者会以为那是两件事，实际是同一件事说了两遍。
     *
     * 处置：摘要给**这一轮该干什么**（动词短语），`next` 给**为什么 / 卡在哪**（完整原因）。
     *   两者语义互补，⛔ 不再重叠。完整原因仍可从 `next.why` 取，没有丢信息。
     */
    headline: string
  } | null
  waitFor: PanelWaitFor
  waitingFor: string
  blocker: string | null
  openItems: number
}

const WAIT_LABEL: Readonly<Record<PanelWaitFor, string>> = {
  user: '你（用户）',
  acceptance: '独立验收会话',
  execution: '开发 / 实施会话',
  upstream: '上游阶段',
  undecidable: '判不出',
}

const waitForOf = (kind: NextAction['kind'] | undefined): PanelWaitFor => {
  switch (kind) {
    case 'wait-user': return 'user'
    case 'accept': return 'acceptance'
    case 'dispatch': return 'execution'
    case 'blocked': return 'upstream'
    case 'converge': return 'acceptance'
    default: return 'undecidable'
  }
}

/**
 * 主动作的**短结论**（第一屏用）。
 *
 * ⚠ 它回答「这一轮该干什么」，⛔ 不回答「为什么」—— 为什么在 `next.why` 里，
 *   那是下方「下一步」块的职责。两处给同一句话就等于只说了一遍却占了两块地方。
 */
function actionHeadlineOf(next: NextAction): string {
  const target = next.target === null || next.target === undefined || next.target === ''
    ? ''
    : ` ${next.target}`
  switch (next.kind) {
    case 'dispatch': return `派下一件活${target}`
    case 'accept': return `验收${target}`
    case 'converge': return `收口变更${target}`
    case 'wait-user': return '等你决定'
    case 'blocked': return '先解开上游阻塞'
    default: return '判不出下一步'
  }
}

/** 当前阶段：取第一条未完成（doing/todo）；全部完成时取最后一步。 */
function currentStageOf(stages: readonly StageRow[]): PanelSummary['stage'] {
  if (stages.length === 0) return null
  /**
   * ⚠ 先取「**第一条未完成**」：全部 done 时不能回退到第一步，
   *   否则会把「已经走到验收」显示成「需求规格」。最后一步仅作为无 todo 时的兜底。
   */
  const stage = stages.find((s) => s.state !== 'done')
    ?? stages[stages.length - 1]
  if (stage === undefined) return null
  return {
    step: stage.step,
    name: stage.name,
    state: stage.state,
    done: stage.done,
    total: stage.total,
  }
}

/** 从既有读数生成第一屏摘要。 */
export function panelSummaryOf(input: {
  stages: readonly StageRow[]
  next?: NextAction | undefined
  attention?: readonly WorkStateReading[] | undefined
}): PanelSummary {
  const action = input.next === undefined
    ? null
    : {
        kind: input.next.kind,
        target: input.next.target,
        headline: actionHeadlineOf(input.next),
      }
  const waitFor = waitForOf(input.next?.kind)
  return {
    stage: currentStageOf(input.stages),
    action,
    waitFor,
    waitingFor: WAIT_LABEL[waitFor],
    blocker: input.next?.blockedBy?.[0] ?? null,
    openItems: input.attention?.length ?? 0,
  }
}

/**
 * 把已由“下一步”点名的主对象从注意力列表里去掉，避免同一件事在两块重复。
 * ⚠ 只按稳定 id 去重；不按自然语言相似度合并。
 */
export function attentionAfterMainAction(
  attention: readonly WorkStateReading[] | undefined,
  next: NextAction | undefined,
  units: readonly Record<string, unknown>[] = [],
): WorkStateReading[] {
  const rows = attention ?? []
  if (next === undefined || next.blockedBy.length === 0) return [...rows]
  const main = new Set<string>()
  for (const line of next.blockedBy) {
    for (const m of line.matchAll(/\b(?:G|R|CHG|TSK|RUN|ACC|EVD|RSK|DEC|CAP)-[A-Za-z0-9-]+\b/g)) main.add(m[0])
  }
  const parentOf = new Map(units.map((u) => [String(u.id ?? ''), String(u.parent ?? '')]))
  return rows.filter((row) => {
    if (main.has(row.id)) return false
    const parent = parentOf.get(row.id)
    return parent === undefined || !main.has(parent)
  })
}
