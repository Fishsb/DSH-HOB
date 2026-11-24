/**
 * **坏档隔离（不覆盖、不静默清空）**（2026-11-25 · 第 1 波 P0）。
 *
 * 病：坏 JSON 被 `catch` 读成「0 行/空队列」，下一次写入原子覆盖 ⇒ 待处理数据与历史
 *   永久消失，而调用方看到的是 ok。
 * 治法：**先隔离再继续** —— 把坏档原子改名为 `<file>.corrupt-<ts>`（原字节完整保留），
 *   然后把返回值如实带回 `{ quarantined, path, reason }`，由上层暴露到状态读数。
 * ⚠ 隔离是「保住证据」，不是「修好它」：⛔ 不尝试解析/合并坏档内容。
 *
 * @module corrupt-quarantine
 */
import { existsSync, renameSync, statSync } from 'node:fs'

export interface QuarantineResult {
  /** 坏档已被移到隔离名（原路径已空出）。 */
  quarantined: true
  /** 隔离后的绝对路径（证据）。 */
  path: string
  /** 原始报错（人读）。 */
  reason: string
}

const stamp = (d = new Date()): string => d.toISOString().replace(/[:.]/g, '-')

/**
 * 把坏档挪到隔离名。⚠ 目标名冲突时加序号（⛔ 不覆盖既有隔离件）。
 * 失败（权限/跨设备）⇒ 抛错：**上报失败**，由调用方 fail-closed（⛔ 不许当没发生过）。
 */
export function quarantineCorrupt(file: string, reason: string, now = new Date()): QuarantineResult {
  const base = file + '.corrupt-' + stamp(now)
  let target = base
  for (let i = 1; existsSync(target); i += 1) target = base + '-' + String(i)
  const size = existsSync(file) ? statSync(file).size : 0
  renameSync(file, target)
  return { quarantined: true, path: target, reason: reason + `（${size} 字节已隔离）` }
}
