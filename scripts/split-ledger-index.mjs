#!/usr/bin/env node
/**
 * 把超过单文件读取预算的 `units/index.toml` 机械拆成：
 *   · `units/index.toml`：文件头说明 / 导航；
 *   · `units/unit-01.toml`、`units/unit-02.toml` …：按原顺序切分的单元分片。
 *
 * ⚠ 只按 `[[unit]]` 边界切分，不改字段、不改顺序、不改正文。
 * ⚠ 已分片账本再次运行 ⇒ 直接跳过（不覆盖人工后续改动）。
 * ⚠ `--apply` 才写盘；缺省只打印预算读数。
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { LEDGER_DIR } from './gen-ledger.mjs'

const MAX_SHARD_BYTES = 60_000
const unitsDir = join(LEDGER_DIR, 'units')
const indexPath = join(unitsDir, 'index.toml')
const apply = process.argv.includes('--apply')

let existingShards = []
try {
  existingShards = readdirSync(unitsDir)
    .filter((name) => /^unit-[^/]+\.toml$/.test(name))
    .sort()
} catch (e) {
  if (e?.code !== 'ENOENT') throw e
}
if (existingShards.length > 0) {
  console.log(`[skip] 已存在分片：${existingShards.join(' / ')}`)
  process.exit(0)
}

const source = readFileSync(indexPath, 'utf8')
const firstUnit = source.search(/^\[\[unit\]\]\s*$/m)
if (firstUnit < 0) throw new Error('index.toml 里没有 [[unit]]，拒绝拆分')

const header = source.slice(0, firstUnit)
const body = source.slice(firstUnit)
const markerOffsets = [...body.matchAll(/^\[\[unit\]\]\s*$/gm)].map((m) => m.index)
if (markerOffsets.length < 2) throw new Error('单元过少，不需要分片')

const chunks = []
let start = 0
while (start < body.length) {
  const remaining = body.slice(start)
  if (Buffer.byteLength(remaining, 'utf8') <= MAX_SHARD_BYTES) {
    chunks.push(remaining)
    break
  }
  const candidates = markerOffsets
    .map((offset) => offset - start)
    .filter((offset) => offset > 0)
    .filter((offset) => Buffer.byteLength(body.slice(start, start + offset), 'utf8') <= MAX_SHARD_BYTES)
  const take = candidates[candidates.length - 1]
  if (take === undefined) throw new Error(`单条单元超过 ${MAX_SHARD_BYTES} B，无法按边界分片`)
  chunks.push(body.slice(start, start + take))
  start += take
}

const sizes = chunks.map((chunk) => Buffer.byteLength(chunk, 'utf8'))
if (chunks.join('') !== body) {
  throw new Error('分片合并结果与原单元正文不一致，拒绝写盘')
}
console.log(`index=${Buffer.byteLength(source, 'utf8')} B · shards=${chunks.length} · sizes=${sizes.join(' / ')}`)
if (!apply) {
  console.log('dry-run：加 --apply 才会写盘')
  process.exit(0)
}

mkdirSync(join(LEDGER_DIR, '..', 'archive', '2026-11-03-ledger-shard-migration', 'sources'), { recursive: true })
copyFileSync(indexPath, join(LEDGER_DIR, '..', 'archive', '2026-11-03-ledger-shard-migration', 'sources', 'index.toml'))

const nav = `${header.trimEnd()}

# ══════════════════════════════════════════════════════════════════════════════
# 2026-11-03 分片迁移：本文件保留导航与说明，不再承载单元正文。
# 单元按原顺序保存在同目录 unit-01.toml / unit-02.toml …
# 读取入口 scripts/gen-ledger.mjs 固定按文件名顺序合并；状态唯一源仍是 units/ 全目录。
# ══════════════════════════════════════════════════════════════════════════════
`
writeFileSync(indexPath, nav, 'utf8')
chunks.forEach((chunk, i) => {
  const name = `unit-${String(i + 1).padStart(2, '0')}.toml`
  writeFileSync(join(unitsDir, name), chunk.endsWith('\n') ? chunk : `${chunk}\n`, 'utf8')
})
console.log(`[write] ${dirname(indexPath)} · archive/2026-11-03-ledger-shard-migration/sources/index.toml`)
