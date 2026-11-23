/**
 * **诊断写入器**（2026-11-23 · A·拆分，自 `preset/tools.ts` 原样搬出）。
 * ⚠ 运行时取 `DEFAULTS`（旧缓存可能缺席）；开关默认**关**，缺席不该让任何东西失败。
 * ⛔ 只写本地调试日志，不碰账本。
 *
 * @module preset/diag
 */
import { appendFileSync, statSync } from 'node:fs'

export interface DiagConfig {
  debugLog?: boolean
  debugLogPath?: string
  debugLogMaxBytes?: number
}

export function makeDiag(config: DiagConfig, toolsFace: Record<string, unknown>): (msg: string) => void {
  if (config.debugLog !== true) return (): void => { /* 开关关闭：不做任何 IO */ }

  const path = config.debugLogPath ?? '/tmp/dsh-hob-preset-tools.log'
  // ⚠ `DEFAULTS` 也是"可能在旧缓存里缺席"的具名导出（`TASK-D`①）⇒ **运行时**取，
  //   且缺席时退到**同一个数**（`modules/tools.ts` 的 `debugLogMaxBytes` 缺省值）。
  //   ⚠ 诊断器本身**不是能力**（默认关着），它缺席不该让任何东西失败。
  const defaults = toolsFace.DEFAULTS as
    { debugLogMaxBytes?: number } | undefined
  const maxBytes = config.debugLogMaxBytes ?? defaults?.debugLogMaxBytes ?? 262144

  return (msg: string): void => {
    try {
      // ⚠ 先按**磁盘现值**判（不是内存计数器）：跨 fiber reload 依然有效，
      //   外部轮转/删除日志后也能自愈。
      let size = 0
      try { size = statSync(path).size } catch { /* 文件还不存在 ⇒ size=0 */ }
      // ⚠ 判据必须把**本行自身字节数**算进去：只判 `size >= max` 会让单行把文件顶过上限
      //   （实测：上限 600 B 时写成 796 B —— 末行 200 B 被整行追加）。
      //   真正的硬上限是"写入后 ≤ maxBytes"，超了就整行丢弃。
      const line = new Date().toISOString() + ' ' + msg + '\n'
      const bytes = Buffer.byteLength(line)
      if (size + bytes > maxBytes) return
      appendFileSync(path, line)
    } catch { /* 诊断写不进去不该影响功能 */ }
  }
}
