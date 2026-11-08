/**
 * **当前模型面指纹**（只读，零状态）—— 从生成契约里现读版本与 SHA-256。
 *
 * ⚠ 为什么要它：账本判据 F-9 要求**新记的 `run`** 钉住"这次实际用的提示词版本"。
 *   自动投影如果只写 `RUN registered` 而不带 `prompt_version` / `prompt_hash`，
 *   下一次 `check:ledger` 就会红 —— 那等于自动落账绕过了人工落账要过的判据。
 * ⚠ 读的是 `preset/dsh-hob/gen/contracts.md` 的版本行（生成物，由
 *   `gen:preset-contract` 写），⛔ 不从 `persona.md` 现算哈希（那会在读到一半时漂）。
 * ⚠ 读不到 ⇒ 返回 `undefined`（调用方不写这两项，由 F-9 如实报"缺"）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface ModelFaceFingerprint {
  version: string
  hash: string
}

/** 读一次当前模型面指纹；判不出 ⇒ `undefined`（⛔ 不编）。 */
export function modelFaceFingerprintOf(rootHint?: string): ModelFaceFingerprint | undefined {
  const candidates: string[] = []
  if (typeof rootHint === 'string' && rootHint.trim() !== '') {
    candidates.push(join(rootHint, 'preset', 'dsh-hob', 'gen', 'contracts.md'))
  }
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    candidates.push(join(here, '..', '..', 'preset', 'dsh-hob', 'gen', 'contracts.md'))
    candidates.push(join(here, '..', 'preset', 'dsh-hob', 'gen', 'contracts.md'))
  } catch { /* 非 ESM 文件路径环境 ⇒ 只用 rootHint */ }
  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue
      const text = readFileSync(p, 'utf8')
      const m = /> 模型面版本：`v(\d+)`[^\n]*SHA-256：`([a-f0-9]{64})`/.exec(text)
      if (m !== null) return { version: `v${m[1]}`, hash: m[2] }
    } catch { /* 换下一个候选 */ }
  }
  return undefined
}
