#!/usr/bin/env node
/**
 * 账本分片再平衡：把已分片的 ledger/units/unit-*.toml 按 [[unit]] 边界重新均匀切分。
 *
 * 为什么需要：split-ledger-index.mjs 只做一次性迁移；迁移后新单元都追加到最后一片，
 * 最后一片会持续长大，而单片读取上限是 65536 B。超限不会报错，只会静默截断。
 *
 * 只在 [[unit]] 边界切原始文本：parse 后重新序列化会丢注释与字段顺序。
 *
 * 用法：
 *   node scripts/rebalance-ledger-shards.mjs
 *   node scripts/rebalance-ledger-shards.mjs --apply
 *   node scripts/rebalance-ledger-shards.mjs --target 45000 --apply
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { LEDGER_DIR } from './gen-ledger.mjs'

export const DEFAULT_TARGET_BYTES = 44_000
export const HARD_CAP_BYTES = 65_536
const UNIT_MARKER = /^\[\[unit\]\]\s*$/gm

/**
 * 纯函数：把多份分片正文按 [[unit]] 边界重切成不超过 limit 的块。
 * @param {string[]} sources 分片原文（按读取顺序）
 * @param {number} limit 每块字节上限
 */
export function rebalanceChunks(sources, limit) {
  const all = sources.join('')
  const starts = [...all.matchAll(UNIT_MARKER)].map((m) => m.index)
  if (starts.length === 0) return { ok: false, reason: '分片里没有 [[unit]]' }
  const preamble = all.slice(0, starts[0])
  const units = starts.map((start, i) => all.slice(start, starts[i + 1] ?? all.length))
  const oversize = units.findIndex((u) => Buffer.byteLength(u, 'utf8') > limit)
  if (oversize >= 0) {
    return { ok: false, reason: `单元 #${oversize + 1} 单条 ${Buffer.byteLength(units[oversize], 'utf8')}B > 目标 ${limit}B` }
  }
  const chunks = []
  let current = preamble
  for (const unit of units) {
    if (current !== '' && Buffer.byteLength(current + unit, 'utf8') > limit) {
      chunks.push(current)
      current = unit
    } else {
      current += unit
    }
  }
  if (current !== '') chunks.push(current)
  if (chunks.join('') !== all) return { ok: false, reason: '切分合并结果与原文不一致' }
  return { ok: true, chunks }
}

/** 读当前全部分片（文件名排序 = 读侧合并顺序）。 */
export function readShards(dir) {
  return readdirSync(dir)
    .filter((name) => /^unit-[^/]+\.toml$/.test(name))
    .sort()
    .map((name) => ({ name, path: join(dir, name), text: readFileSync(join(dir, name), 'utf8') }))
}

/** 计算重切方案（不写盘）。 */
export function planRebalance(dir, limit = DEFAULT_TARGET_BYTES) {
  const shards = readShards(dir)
  const before = shards.map((s) => ({ name: s.name, bytes: Buffer.byteLength(s.text, 'utf8') }))
  const r = rebalanceChunks(shards.map((s) => s.text), limit)
  if (!r.ok) return { ok: false, reason: r.reason, before }
  const sizes = r.chunks.map((c) => Buffer.byteLength(c, 'utf8'))
  const unchanged = r.chunks.length === shards.length && r.chunks.every((c, i) => c === shards[i].text)
  return { ok: true, shards, before, chunks: r.chunks, sizes, unchanged }
}

export function applyRebalance(dir, plan, backupDir) {
  mkdirSync(backupDir, { recursive: true })
  for (const s of plan.shards) cpSync(s.path, join(backupDir, s.name))
  const tmps = plan.chunks.map((chunk, i) => {
    const name = `unit-${String(i + 1).padStart(2, '0')}.toml`
    const tmp = join(dir, `.tmp-rebalance-${name}`)
    writeFileSync(tmp, chunk.endsWith('\n') ? chunk : `${chunk}\n`, 'utf8')
    return { tmp, name }
  })
  try {
    const keep = new Set(tmps.map((t) => t.name))
    for (const s of plan.shards) if (!keep.has(s.name)) rmSync(s.path, { force: true })
    for (const t of tmps) renameSync(t.tmp, join(dir, t.name))
  } catch (e) {
    for (const t of tmps) { try { rmSync(t.tmp, { force: true }) } catch { /* 忽略 */ } }
    throw e
  }
}

function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const ti = args.indexOf('--target')
  const target = ti >= 0 ? Number(args[ti + 1]) : DEFAULT_TARGET_BYTES
  if (!Number.isFinite(target) || target <= 0 || target > HARD_CAP_BYTES) {
    console.error(`--target 必须是 (0, ${HARD_CAP_BYTES}] 的数字`)
    process.exit(2)
  }
  const dir = join(LEDGER_DIR, 'units')
  const plan = planRebalance(dir, target)
  if (!plan.ok) {
    console.error(`拒绝：${plan.reason}`)
    process.exit(1)
  }
  console.log(`当前：${plan.before.map((b) => `${b.name}=${b.bytes}B`).join(' · ')}`)
  console.log(`目标：每片 <= ${target}B`)
  console.log(`结果：${plan.chunks.length} 片 · ${plan.sizes.join(' / ')} B`)
  if (plan.unchanged) {
    console.log('无需再平衡：现有切分已满足目标')
    return
  }
  if (!apply) {
    console.log('dry-run：加 --apply 才会写盘')
    return
  }
  const stamp = new Date().toISOString().slice(0, 10)
  const backup = join(LEDGER_DIR, '..', 'archive', `${stamp}-ledger-rebalance`, 'sources')
  applyRebalance(dir, plan, backup)
  console.log(`[write] ${plan.chunks.length} 片 · 备份 ${backup}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main()
