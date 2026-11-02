/**
 * 账本待投递记录 → 持久效果队列的桥。
 *
 * 目的：保留现有 `orch-watches.json.handoffs` 作为可见事实，同时让“投递”
 * 成为可恢复、可重试的 effect。⛔ 不把派发 watch 状态机搬进队列。
 */
import { join } from 'node:path'
import { EffectsQueue, openEffectsQueue } from './effects-queue.ts'
import { clearHandoffs, type PersistedHandoff } from './orch-state.ts'

export const HANDOFF_EFFECT = 'handoff-deliver'

export function handoffEffectKey(h: Pick<PersistedHandoff, 'kind' | 'ref'>): string {
  return `${h.kind}:${h.ref}`
}

export function handoffQueuePath(ledgerRoot: string): string {
  return join(ledgerRoot, 'runtime', 'effects.json')
}

/** 给补投使用的最小指针正文；与 `write-delivery` 的旧话术保持同一语义。 */
export function pointerMessageForRef(ref: string): string {
  return `请读并执行本文件：${ref}（账本区根下的相对路径）。先读它，再动手；`
    + '需要拍板的地方不要问我，把问题写进回报的「待决问题」段。'
}

/**
 * 创建或装载账本 handoff 效果队列。
 *
 * @param ledgerRoot - 账本区根
 * @param deliver - 实际投递函数；失败会抛错触发退避
 * @param stateFile - `orch-watches.json` 路径，用于成功后精确清除同一条 handoff
 * @returns 已启动的队列
 */
export function startHandoffEffects(
  ledgerRoot: string,
  deliver: (target: string, message: string, h: PersistedHandoff) => Promise<void>,
  stateFile: string,
): EffectsQueue {
  /**
   * ⚠ 同一账本根**只能有一个 writer**：两个 Hob 会话若各自 new 一个队列，
   *   会在同一份 `runtime/effects.json` 上做两套 read-modify-write ⇒ 丢更新。
   *   同进程按路径复用；跨进程由 EffectsQueue 的独占锁拒绝第二实例。
   */
  const q = openEffectsQueue(handoffQueuePath(ledgerRoot))
  q.handle(HANDOFF_EFFECT, {
    retry: [2_000, 60_000],
    ordered: false,
    limit: 2,
    run: async (payload, key) => {
      const p = payload as { target: string; message: string; handoff: PersistedHandoff }
      await deliver(p.target, p.message, p.handoff)
      clearHandoffs(stateFile, (h) => handoffEffectKey(h) === key)
    },
  })
  q.start()
  return q
}

/**
 * 登记一条待投递的**同时**入队。
 * ⚠ 先调用方落 handoff，再调用本函数；顺序反过来会产生“投出去了但账面没有”的窗口。
 */
export function enqueueHandoff(
  q: EffectsQueue,
  h: PersistedHandoff,
  target: string,
  message: string,
): void {
  q.enqueue(HANDOFF_EFFECT, handoffEffectKey(h), { target, message, handoff: h })
}
