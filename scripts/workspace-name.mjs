#!/usr/bin/env node
/**
 * **工作区名的唯一来源** —— 判据脚本的账本区派生只准从这里取，⛔ 不再从目录名猜。
 *
 * ── 它解决什么（缺口有实测出处）──────────────────────────────────────────
 *   判据脚本们原先各自用 `basename(root)` 派生账本区名（`<ledgerHome>/<工作区名>/`）。
 *   ⚠ 在**看板隔离 worktree** 里，目录名 = **卡 id**（`t-…`）而不是工作区名
 *   ⇒ 它们去找 `<ledgerHome>/<卡 id>` ⇒ **不存在** ⇒ 账本面整族报「未执行 / 失败」：
 *     · `check:gitignore` 的 Q3（账本根解析不到）与 P（扫不到任何表块）**FAIL**；
 *     · `check:readings` **退 2**（未执行）。
 *   ⇒ 后果：**隔离卡永远拿不到全绿**，而「全绿才提交」是本项目的硬纪律
 *   （出处：`archive/2026-10-18-isolated-batch/VERDICT.md` §二）。
 *
 * ── 判据（⚠ 只改「工作区名从哪来」，⛔ 不改任何判据的分辨力）──────────────
 *   ① **唯一来源 = 配置**：工作区根上那份**被 git 跟踪**的 `dsh-hob.workspace.json`
 *      的 `workspaceName` 字段（⚠ 它随分支走 ⇒ 同一份代码放进任何目录都派得对）。
 *      ⛔ **不落在 `preset/**`**（`ledgerHome` 的载体在预设行，那条线归并行的另一张卡）。
 *   ② **不带配置 ⇒ 落回改动前的猜法**：由调用方传入它原来的 `legacy()`（缺省 = `basename(root)`）
 *      ⇒ ⚠ 未配置时**行为与改动前逐字一致**（向后兼容，见卡片的判据 ③）。
 *   ③ **配置在但写坏了**（非法 JSON / 缺字段 / 不是单段目录名）⇒ **按"未配置"处理**
 *      并**打印一行原因**（⛔ 不静默：静默会让"配置写错了"永远没人发现），
 *      判定口径**不因写坏而变宽**（仍然落到 ② 的旧猜法）。
 *
 * ── ⛔ 它不做什么 ───────────────────────────────────────────────────────
 *   ⛔ 不判「账本区是否存在」（那是各脚本自己 `existsSync` 的事 —— 基准缺失该报红就报红）。
 *   ⛔ 不放宽任何断言、不加豁免名单、不把「未执行」改判成「通过」。
 *   ⚠ 零第三方依赖（本仓纪律）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/** 配置文件名（工作区根，**被 git 跟踪**；⚠ 单一来源，⛔ 不在 `preset/**`）。 */
export const WORKSPACE_CONFIG_FILE = 'dsh-hob.workspace.json'
/** 配置里承载工作区名的字段。 */
export const WORKSPACE_NAME_KEY = 'workspaceName'
/** 配置的绝对路径（供诊断打印）。 */
export const WORKSPACE_CONFIG_PATH = join(root, WORKSPACE_CONFIG_FILE)

/**
 * 读配置里的工作区名；**未配置 / 写坏**一律 `null`（⛔ 不抛、也⛔ 不编一个值）。
 * ⚠ 写坏时**打印一行原因**（落回旧猜法，但"为什么不生效"要可见）。
 * @returns {string|null}
 */
export function configuredWorkspaceName() {
  if (!existsSync(WORKSPACE_CONFIG_PATH)) return null
  let raw = ''
  try {
    raw = readFileSync(WORKSPACE_CONFIG_PATH, 'utf8')
  } catch (e) {
    console.error(`[workspace-name] 读不到 ${WORKSPACE_CONFIG_FILE}（${String(e?.message ?? e)}）⇒ 按「未配置」处理`)
    return null
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.error(`[workspace-name] ${WORKSPACE_CONFIG_FILE} 不是合法 JSON ⇒ 按「未配置」处理（落回猜目录名逻辑）`)
    return null
  }
  const value = parsed === null || typeof parsed !== 'object' ? undefined : parsed[WORKSPACE_NAME_KEY]
  if (typeof value !== 'string' || value.trim() === '') {
    console.error(`[workspace-name] ${WORKSPACE_CONFIG_FILE} 缺字符串字段 \`${WORKSPACE_NAME_KEY}\` ⇒ 按「未配置」处理`)
    return null
  }
  const name = value.trim()
  // ⚠ 只接受**单段目录名**：带分隔符 / `.` / `..` 的值会把账本区派到别处 ⇒ 视为写坏。
  if (name === '.' || name === '..' || /[\\/]/.test(name)) {
    console.error(`[workspace-name] ${WORKSPACE_CONFIG_FILE} 的 \`${WORKSPACE_NAME_KEY}\` 不是单段目录名`
      + `（${JSON.stringify(name)}）⇒ 按「未配置」处理`)
    return null
  }
  return name
}

/**
 * 工作区名：**① 配置**（唯一来源）→ **② 调用方原有的猜法**（不带配置时的向后兼容路径）。
 *
 * @param {() => string} [legacy] 改动前那套派生逻辑；缺省 `() => basename(root)`。
 *   ⚠ 传它只为**保住"未配置时与改前逐字一致"**，⛔ 不是为了给配置留后门。
 * @returns {string}
 */
export function workspaceName(legacy) {
  const configured = configuredWorkspaceName()
  if (configured !== null) return configured
  if (typeof legacy === 'function') return legacy()
  return basename(root)
}
