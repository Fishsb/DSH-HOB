#!/usr/bin/env node
/**
 * 生成骨架清单 —— `src/server/skeleton-manifest.ts`（2026-10-16 · 第 224 轮 · `UD-118`「C」）。
 *
 * ── 它是什么（⚠ 约束 ⑤ 的"派生物"那一半）──────────────────────────────────────
 *   ⚠ **仓库的 `.hob/**` 是唯一来源**；本脚本把它**派生**成一份**机器可核的清单**：
 *     · `allowlist`  —— ⚠ **从 `.gitignore` 的 `!` 例外抽**（⛔ 不手抄；**E-70** 同族）
 *     · `entries`    —— 逐件 `sha256`（⚠ 同源判据的**唯一基准**）
 *   ⚠ 由 `scripts/check-code-face.mjs` 的 `runSkeletonSource` **反向核**：
 *     ⚠ **清单与仓库不一致 ⇒ FAIL**；⚠ **清单读不到 ⇒ FAIL**（⛔ 不许静默 —— **E-130 / E-131**）。
 *
 * ── ⚠ ⚠ 「铺哪些 / ⛔ 不铺哪些」（⚠ 判据见 `.hob/README.md` §1 与 `.hob/INIT.md` §7）─────
 *   **铺（结构层）**：`README.md`（骨架说明）· `INIT.md`（初始化清单）·
 *     `templates/**`（空模板）· `roles/**`（角色方法论）· `drafts/**`（⚠ **被 `check:presets` 无条件读取** ⇒ ⛔ 缺它则那条命令 ENOENT）。
 *   ⛔ **不铺（记录层 / 本项目专有）**：`EXPERIENCE.md` 与 `experience/**`
 *     —— ⚠ 它们是**本项目自己的历史**（⚠ `INIT.md` §7：换项目时"⛔ 不照抄"；
 *     ⚠ `README.md` §1：那些编号"**开箱不带**"）⇒ ⚠ **别的工作区里那些编号不存在**，
 *     铺过去只会造出**一堆悬空引用**（⚠ 而这正是 `E-109`/`E-151` 记过的形态）。
 *   ⛔ **不铺**：`backups/**`（⚠ 实测 14 件，是**本项目的改前备份**，⛔ 无跨项目价值）·
 *     `archive/` · 各正本数据（⚠ 那些**本来就不在 `.hob/` 里**，v4 起已外置到账本区）。
 *
 * 用法：node scripts/gen-skeleton-manifest.mjs [--check]
 *   ⚠ `--check`：只核"盘上的清单与仓库一致吗"，⛔ 不写文件（收尾断言用同一口径）。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const HOB = join(root, '.hob')
const OUT = join(root, 'src', 'server', 'skeleton-manifest.ts')

/** ⚠ 骨架的**源** = `.gitignore` 的 `!` 例外（⚠ README §1 明写它是"唯一权威清单"）。 */
function allowlistFromGitignore() {
  const src = readFileSync(join(root, '.gitignore'), 'utf8')
  const out = []
  for (const line of src.split('\n')) {
    const m = /^!(\.hob\/.+)$/.exec(line.trim())
    if (m !== null) out.push(m[1].replace(/\/$/, ''))
  }
  return out
}

/** ⚠ 记录层 / 非跨项目件 —— **明确排除**（⛔ 不铺；理由见文件头）。 */
const EXCLUDE = ['.hob/EXPERIENCE.md', '.hob/experience']

function isExcluded(p) {
  return EXCLUDE.some((x) => p === x || p.startsWith(`${x}/`))
}

function listMd(dir, base = dir, acc = []) {
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) listMd(p, base, acc)
    else if (e.isFile()) acc.push(relative(base, p).split(sep).join('/'))
  }
  return acc
}

function collect() {
  const allow = allowlistFromGitignore().filter((p) => !isExcluded(p))
  const entries = []
  for (const a of allow) {
    const rel = a.replace(/^\.hob\//, '')
    const abs = join(HOB, rel)
    if (!existsSync(abs)) continue
    const st = statSync(abs)
    const files = st.isDirectory() ? listMd(abs).map((f) => `${rel}/${f}`) : [rel]
    for (const f of files.sort()) {
      const buf = readFileSync(join(HOB, f))
      entries.push({ path: f, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length })
    }
  }
  return { allow, entries: entries.sort((a, b) => (a.path < b.path ? -1 : 1)) }
}

function render({ allow, entries }) {
  const lines = []
  lines.push('/**')
  lines.push(' * ⚠ ⚠ **生成物 —— ⛔ 不许手改**（改它没用：收尾断言拿仓库重算，不一致即 FAIL）。')
  lines.push(' *')
  lines.push(' * 生成：`node scripts/gen-skeleton-manifest.mjs`（2026-10-16 · 第 224 轮 · `UD-118`「C」）')
  lines.push(' * 判据：`scripts/check-code-face.mjs` 的 `runSkeletonSource`（⚠ 提取不到即 FAIL —— `E-130` / `E-131`）。')
  lines.push(' *')
  lines.push(' * ⚠ **源 = 仓库的 `.hob/**`**（唯一来源）；`allowlist` 派生自 `.gitignore` 的 `!` 例外（⛔ 不手抄）。')
  lines.push(' * ⚠ **记录层（`EXPERIENCE.md` / `experience/**`）与本项目备份（`backups/**`）⛔ 不在内** ——')
  lines.push(' *    理由见生成脚本的文件头（⚠ 铺过去会造出一堆悬空引用）。')
  lines.push(' */')
  lines.push('export interface SkeletonEntry {')
  lines.push('  /** 相对 `.hob/` 的 POSIX 路径。 */')
  lines.push('  path: string')
  lines.push('  /** 该件在**仓库**里的 sha256（⚠ 同源判据的基准）。 */')
  lines.push('  sha256: string')
  lines.push('  /** 该件字节数（⚠ 只作读数，判据用 `sha256`）。 */')
  lines.push('  bytes: number')
  lines.push('}')
  lines.push('')
  lines.push('/** ⚠ 允许铺的相对路径（`.hob/…`）—— 派生自 `.gitignore` 的 `!` 例外，**已剔除记录层**。 */')
  lines.push(`export const SKELETON_ALLOWLIST: readonly string[] = ${JSON.stringify(allow, null, 2)}`)
  lines.push('')
  lines.push('/** ⚠ 逐件 sha256（⚠ 与仓库不一致 ⇒ 收尾断言 FAIL）。 */')
  lines.push('export const SKELETON_ENTRIES: readonly SkeletonEntry[] = [')
  for (const e of entries) lines.push(`  { path: '${e.path}', sha256: '${e.sha256}', bytes: ${e.bytes} },`)
  lines.push(']')
  lines.push('')
  lines.push('/** 生成时刻（⚠ 只作追溯，⛔ 不作判据 —— 判据是 sha256）。 */')
  lines.push(`export const SKELETON_GENERATED_AT = '${new Date().toISOString()}'`)
  lines.push('')
  lines.push('export interface SkeletonManifest {')
  lines.push('  allowlist: readonly string[]')
  lines.push('  entries: readonly SkeletonEntry[]')
  lines.push('}')
  lines.push('')
  lines.push('/** ⚠ 单一出口（⚠ `runtimes` 只读它，⛔ 不各自拼一份）。 */')
  lines.push('export const SKELETON_MANIFEST: SkeletonManifest = {')
  lines.push('  allowlist: SKELETON_ALLOWLIST,')
  lines.push('  entries: SKELETON_ENTRIES,')
  lines.push('}')
  lines.push('')
  return lines.join('\n')
}

const want = render(collect())
if (process.argv.includes('--check')) {
  const onDisk = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
  // ⚠ 比对**除时刻行以外**的字面（时刻每次生成都会变，⛔ 不作判据）
  const strip = (s) => s.split('\n').filter((l) => !l.includes('SKELETON_GENERATED_AT')).join('\n')
  if (strip(onDisk) !== strip(want)) {
    console.error('✗ 骨架清单与仓库**不一致** —— 跑 `node scripts/gen-skeleton-manifest.mjs` 重新生成。')
    process.exit(1)
  }
  console.log('✓ 骨架清单与仓库一致')
  process.exit(0)
}
writeFileSync(OUT, want)
const { entries } = collect()
console.log(`✓ 已生成 ${relative(root, OUT)}：${entries.length} 件 · ${entries.reduce((a, e) => a + e.bytes, 0)} 字节`)
