/**
 * 派活前的「执行预设」判定 —— **唯一事实源**（host 两侧共用）。
 *
 * 用户口径（2026-11-09）：
 *   · 设置里的执行预设是**派活时期望的会话预设**，不是只给 `hob_spawn` 看的建议值；
 *   · 派给一个**已存在**的会话时，先核对它的当前预设：
 *       - 与设置一致 ⇒ 正常自动派活；
 *       - 不一致（含读不到）⇒ 先问用户：继续用这个活跃会话，还是按设置新建会话；
 *       - 目标是 Hob 项目总代理预设 ⇒ **永远不能当作实施会话**，只能新建或取消。
 *
 * ⚠ 本文件只做**纯判定**，不碰宿主服务、不发问、不建会话：
 *   发问与建会话分别由 orchestrator / bus 的调用方完成，避免两个入口各写一份判定。
 */
import { FACTORY_DEFAULT_PRESET_ID, HOB_PRESET_ID } from './planning-preset.ts'

/** 设置里的原始预设值（可能为空串，表示未设置）。 */
export type ConfiguredPreset = string | undefined | null

/** 目标会话的当前预设（可能读不到）。 */
export type TargetPreset = string | undefined | null

/** 判定结果。 */
export type DispatchPresetVerdict =
  | {
      kind: 'match'
      configuredPreset: string
      targetPreset: string
    }
  | {
      kind: 'mismatch'
      configuredPreset: string
      targetPreset: string
      targetIsHob: false
    }
  | {
      kind: 'target-hob'
      configuredPreset: string
      targetPreset: string
    }
  | {
      kind: 'unknown'
      configuredPreset: string
      targetPreset?: undefined
    }

/** 把设置值归一成实际会使用的执行预设。空串 / Hob 都退回出厂默认。 */
export function configuredExecutionPreset(raw: ConfiguredPreset): string {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (value === '' || value === HOB_PRESET_ID) return FACTORY_DEFAULT_PRESET_ID
  return value
}

/**
 * 判定目标会话能否直接接收这次派活。
 *
 * ⚠ 顺序有意如此：**先判 Hob**，再判相等，最后才判 unknown。
 *   Hob 即使恰好等于某个配置值，也仍然是不可施工的目标；不能因为字符串相等就放行。
 */
export function decideDispatchPreset(
  configuredRaw: ConfiguredPreset,
  targetRaw: TargetPreset,
): DispatchPresetVerdict {
  const configuredPreset = configuredExecutionPreset(configuredRaw)
  const targetPreset = typeof targetRaw === 'string' && targetRaw.trim() !== '' ? targetRaw.trim() : undefined
  if (targetPreset === HOB_PRESET_ID) {
    return { kind: 'target-hob', configuredPreset, targetPreset }
  }
  if (targetPreset === undefined) {
    return { kind: 'unknown', configuredPreset }
  }
  if (targetPreset === configuredPreset) {
    return { kind: 'match', configuredPreset, targetPreset }
  }
  return { kind: 'mismatch', configuredPreset, targetPreset, targetIsHob: false }
}

/** 用户选择：继续用活跃会话 / 按设置新建会话 / 取消。 */
export type PresetChoice = 'active' | 'new' | 'cancel'

/**
 * 派活目标解析结果（**所有派活入口共用**）。
 *
 * ⚠ `ok:true` 的 `sessionId` 才是**最终要投递的目标**：用户选择“新建”时它会是新会话 id，
 *   不是调用方最初点名的那个活跃会话。调用方必须用返回值继续投递，⛔ 不要继续用原参数。
 */
export type PresetTargetResolution =
  | {
    ok: true
    sessionId: string
    /** 是否因为预设不一致而新建了会话。 */
    created: boolean
    configuredPreset: string
    targetPreset?: string
    /** 用户明确选择继续用活跃会话时出现。 */
    choice?: PresetChoice
  }
  | {
    ok: false
    /** 机器可判的原因（工具返回值直接用它）。 */
    reason: string
    /** 给人/模型读的说明（含下一步）。 */
    message: string
    configuredPreset?: string
    targetPreset?: string
    /** 已经新建出来、但最终不能继续派活的会话（⚠ 调用方必须如实告诉用户）。 */
    createdSessionId?: string
    /** 是否因为需要用户确认而停下（而不是投递本身失败）。 */
    needsUser?: boolean
  }

/** 给用户看的二选一（Hob 目标只给新建 / 取消，绝不给“继续用 Hob 施工”）。 */
export const PRESET_CHOICE_LABELS = {
  active: '继续使用活跃会话',
  new: '新建会话（用当前执行预设）',
  cancel: '取消本次派活',
} as const

/** 问句正文（供 orchestrator 的 userQuestions 调用；不含宿主内部标识）。 */
export function presetChoiceQuestion(verdict: DispatchPresetVerdict, target: string): string {
  if (verdict.kind === 'target-hob') {
    return `目标会话 ${target} 是 Hob 项目总代理预设，不能承担具体实施。`
      + `当前执行预设是「${verdict.configuredPreset}」。要按当前执行预设新建一个会话再派活，还是取消？`
  }
  if (verdict.kind === 'unknown') {
    return `目标会话 ${target} 的当前预设读不到；当前执行预设是「${verdict.configuredPreset}」。`
      + '要继续用这个活跃会话，还是按当前执行预设新建一个会话？'
  }
  return `目标会话 ${target} 的当前预设是「${verdict.targetPreset}」，`
    + `与设置里的执行预设「${verdict.configuredPreset}」不一致。`
    + '要继续用这个活跃会话，还是按当前执行预设新建一个会话？'
}

/** 解析用户回答（选项标签或自由文本都收口到这里）。 */
export function parsePresetChoice(
  selected: readonly string[] | undefined,
  custom: string | undefined,
): PresetChoice {
  const values = [...(selected ?? [])].filter((v) => typeof v === 'string' && v.trim() !== '')
  if (values.some((v) => v.includes(PRESET_CHOICE_LABELS.cancel))) return 'cancel'
  if (values.some((v) => v.includes(PRESET_CHOICE_LABELS.new))) return 'new'
  if (values.some((v) => v.includes(PRESET_CHOICE_LABELS.active))) return 'active'
  // 自由文本：先认明确的否定，再认动作词；认不出就按取消处理（⛔ 不默认替用户选活跃会话）。
  const text = typeof custom === 'string' ? custom.trim() : ''
  if (text === '') return 'cancel'
  if (/取消|不要|不用|停止|cancel|no\b/i.test(text)) return 'cancel'
  if (/新建|新会话|new/i.test(text)) return 'new'
  if (/活跃|现有|继续|existing|active|continue/i.test(text)) return 'active'
  return 'cancel'
}
