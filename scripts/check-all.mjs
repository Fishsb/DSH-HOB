#!/usr/bin/env node
/**
 * `check:all` —— **一条命令跑完全部判据族**，并**汇总退出码**。
 *
 * ── 它解决什么（缺口有实测出处）──────────────────────────────────────────
 *   本仓原有 **12 条 `check:*`**，⛔ **没有任何聚合入口**（`package.json` 的 `scripts` 里
 *   只有 `build` / `typecheck` 与 12 条判据，没有 `check` / `test` / `verify`）。
 *   ⇒ 外部人拿到这个项目，**不知道"判据该跑哪条"**；跑了一半就以为全过了。
 *   这正是对外标准里「判据入口能**一条命令**跑」那一条不成立的直接原因。
 *
 * ── 判据（⚠ 三条，缺一条就等于没有汇总）──────────────────────────────────
 *   ① **逐族真跑**，每族**原样转发**它自己的输出（⚠ 不吞、不改写、不摘要）——
 *      "逐族打印"是被允许的，⛔ 但**必须**在末尾给汇总；
 *   ② **汇总退出码**：任一族非 0 ⇒ 整体非 0（⚠ 详见下面三档口径）；
 *   ③ ⚠ **"未执行"不许当"通过"**：某族退出码 2（基准缺失）必须**单独记一档**，
 *      并且在汇总里**点名是哪族** —— ⛔ 不允许把它并进"全绿"。
 *
 * ── 退出码（三档，与各族自己的口径对齐）──────────────────────────────────
 *   `0` = **全部族都真跑过且都通过**（⚠ 有族打 `未执行` 就不是 0）；
 *   `1` = **至少一族实际失败**（退出码 1）；
 *   `2` = **没有失败、但有族没能执行**（退出码 2 或异常）—— ⚠ `2` **不代表通过**。
 *   ⚠ 优先级：`1` 高于 `2`（既有真红又有未执行 ⇒ 报 1，因为失败更需要先看）。
 *
 * ── ⛔ 它不做什么 ───────────────────────────────────────────────────────
 *   ⛔ 不"放宽"任何一族的判据（它只是调度，判据字节未动）。
 *   ⛔ **不预设某族该是什么结果** —— 每族的期望值仍由那族自己决定。
 *   ⛔ 不写任何文件（各族的临时件仍由各族自己管，且都在系统临时目录里）。
 *
 * ── 用法 ───────────────────────────────────────────────────────────────
 *   `npm run check`（= `npm run check:all`）· 或 `node scripts/check-all.mjs`
 *   想看"哪几族现在跑不了、怎么补" ⇒ `npm run check:preflight`（⚠ 那一条只体检，不跑判据）。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { preflight, printPreflight } from './preflight.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

/**
 * 判据族清单 —— ⚠ **派生自 `package.json` 的 `scripts`**（⛔ 不手抄一张会漂的期望表）。
 *
 * 判据口径与 `check-repo-rules.mjs` 的「脚本落点」同源：
 * **`scripts` 里 `check:*` 那批就是判据族**，除此之外的不是（`build` / `typecheck` / `exp:*` / `gen:*`）。
 * ⚠ 显式排除本脚本与预检自身（否则自己调自己）。
 */
const SELF = new Set(['check:all', 'check:preflight'])

export function listFamilies() {
  let scripts = {}
  try {
    scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {}
  } catch { scripts = {} }
  return Object.keys(scripts)
    .filter((k) => k.startsWith('check:'))
    .filter((k) => !SELF.has(k))
    .sort()
}

/** 逐族真跑，收集 {name, code, ms}。 */
export function runFamilies(names) {
  const results = []
  for (const name of names) {
    const started = Date.now()
    console.log('')
    console.log('═'.repeat(72))
    console.log(`▶ ${name}`)
    console.log('═'.repeat(72))
    const r = spawnSync('npm', ['run', '--silent', name], {
      cwd: root,
      stdio: 'inherit',
      // ⚠ 不设 timeout：有一族要跑 60+ 秒（真跑组）；超时会把它误报成失败。
      shell: process.platform === 'win32',
    })
    const code = typeof r.status === 'number' ? r.status : 1
    results.push({ name, code, ms: Date.now() - started })
  }
  return results
}

/** 汇总判定：⚠ 三档口径见文件头。 */
export function verdict(results) {
  const failed = results.filter((r) => r.code === 1)
  const notRun = results.filter((r) => r.code !== 0 && r.code !== 1)
  if (failed.length > 0) return { exit: 1, failed, notRun }
  if (notRun.length > 0) return { exit: 2, failed, notRun }
  return { exit: 0, failed, notRun }
}

export function printSummary(results) {
  const v = verdict(results)
  console.log('')
  console.log('═'.repeat(72))
  console.log('汇总 · dsh-hob 判据全族')
  console.log('═'.repeat(72))
  for (const r of results) {
    const tag = r.code === 0 ? '✓ 通过' : r.code === 1 ? '✗ 失败' : '⚠ 未执行'
    console.log(`  ${tag.padEnd(8)} ${r.name.padEnd(18)} exit=${r.code}  ${(r.ms / 1000).toFixed(1)}s`)
  }
  console.log('')
  console.log(`  共 ${results.length} 族：通过 ${results.filter((r) => r.code === 0).length}`
    + ` · 失败 ${v.failed.length} · 未执行 ${v.notRun.length}`)
  console.log('')
  if (v.exit === 0) {
    console.log('判定：**全部通过** —— 每族都真跑过，且都通过。')
  } else if (v.exit === 1) {
    console.log('判定：**有失败** —— 先看上面标 ✗ 的那几族的原文。')
    for (const r of v.failed) console.log(`       ✗ ${r.name}（exit=1）`)
    if (v.notRun.length > 0) {
      console.log('       ⚠ 另有族没能执行（exit≠0/1）—— 它们**没有**替你检查任何东西：')
      for (const r of v.notRun) console.log(`          ⚠ ${r.name}（exit=${r.code}）`)
    }
  } else {
    console.log('判定：**未执行** —— 没有失败，但有族没能跑起来（基准缺失）。⚠ **这不代表通过**。')
    for (const r of v.notRun) console.log(`       ⚠ ${r.name}（exit=${r.code}）`)
    console.log('       ⇒ 跑 `npm run check:preflight` 看缺什么、怎么补。')
  }
  console.log('')
  console.log('       ⚠ 退出码口径：0 = 全部真跑过且通过 · 1 = 至少一族失败 · 2 = 有族未执行（不代表通过）')
  return v.exit
}

if (process.argv[1] !== undefined && (process.argv[1].endsWith('check-all.mjs') || process.argv[1].endsWith('npm'))) {
  const pf = preflight()
  if (pf.items.some((i) => !i.present)) {
    // ⚠ 预检不拦：缺东西时**照旧跑**，让各族自己如实打"未执行"（⛔ 不在这里替它们判）
    console.log('⚠ 前置条件不全 —— 下面先给体检，再照常逐族跑（各族的"未执行"以它们自己的输出为准）')
    console.log('')
    printPreflight(pf)
  }
  const names = listFamilies()
  if (names.length === 0) {
    console.error('✗ 从 package.json 的 scripts 里一个 `check:*` 都没解析到（基准缺失 ⇒ 不按通过处理）')
    process.exit(2)
  }
  const results = runFamilies(names)
  process.exit(printSummary(results))
}
