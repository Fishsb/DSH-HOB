#!/usr/bin/env node
/**
 * 持久效果队列判据。
 * ⚠ 使用临时目录，不碰真实账本、不连宿主。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const root = new URL('..', import.meta.url).pathname
const { EffectsQueue, openEffectsQueue } = await import(pathToFileURL(join(root, 'src', 'server', 'effects-queue.ts')).href)

let pass = 0
let fail = 0
const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail++; console.log(`  ✗ ${m}`) }
const clean = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'hob-effects-'))
  clean.push(d)
  return d
}
const wait = async (fn, timeout = 1000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, 5))
  }
  return false
}

try {
  // Q-1 成功即删除
  {
    const path = join(tmp(), 'effects.json')
    const q = new EffectsQueue(path)
    let hits = 0
    q.handle('reply', { retry: [5, 20], run: async () => { hits++ } })
    q.enqueue('reply', 'm1', { text: 'hello' })
    q.start()
    await q.idle('reply')
    if (hits === 1 && q.pending().length === 0) ok('Q-1 ✓ 成功执行一次后从持久队列删除')
    else bad(`Q-1 · hits=${hits} pending=${q.pending().length}`)
  }

  // Q-2 失败退避，不丢
  {
    let t = 1000
    const q = new EffectsQueue(join(tmp(), 'effects.json'), { now: () => t })
    let hits = 0
    q.handle('reply', { retry: [10, 20], run: async () => { hits++; throw new Error('temporary') } })
    q.enqueue('reply', 'm2', { text: 'x' })
    q.start()
    await q.idle('reply')
    const row = q.pending('reply', 'm2')[0]
    const before = row?.attempts
    t += 11
    await q.idle('reply')
    const after = q.pending('reply', 'm2')[0]?.attempts
    if (hits >= 2 && before === 1 && after === 2) ok('Q-2 ✓ 失败不丢，按退避后重试并递增 attempts')
    else bad(`Q-2 · hits=${hits} attempts ${before} -> ${after}`)
  }

  // Q-3 重启后恢复
  {
    const path = join(tmp(), 'effects.json')
    const q1 = new EffectsQueue(path, { lockPath: `${path}.q1.lock` })
    q1.enqueue('launch', 'a3', { task: 'X' })
    const q2 = new EffectsQueue(path, { lockPath: `${path}.q2.lock` })
    const restored = q2.pending('launch', 'a3')[0]
    if (restored !== undefined && JSON.stringify(restored.payload) === '{"task":"X"}') ok('Q-3 ✓ 重启后从磁盘恢复同键 payload')
    else bad('Q-3 · 重启后没有恢复队列')
  }

  // Q-4 同键合并保留队列位置，并提升代际
  {
    const path = join(tmp(), 'effects.json')
    const q = new EffectsQueue(path)
    q.enqueue('reply', 'k4', { v: 1 })
    q.enqueue('reply', 'other', { v: 2 })
    q.enqueue('reply', 'k4', { v: 3 })
    const rows = q.pending('reply')
    const k = rows.find((r) => r.key === 'k4')
    if (rows.length === 2 && k?.generation === 2 && k?.seq < rows.find((r) => r.key === 'other').seq) ok('Q-4 ✓ 同键合并：payload 更新、代际递增、队列位置保持')
    else bad(`Q-4 · ${JSON.stringify(rows)}`)
  }

  // Q-5 执行旧代际时被新 payload 覆盖，旧成功不删新行
  {
    const path = join(tmp(), 'effects.json')
    const q = new EffectsQueue(path)
    let release
    const gate = new Promise((r) => { release = r })
    let startedResolve
    const started = new Promise((r) => { startedResolve = r })
    let secondResolve
    const second = new Promise((r) => { secondResolve = r })
    q.handle('reply', { retry: [5, 10], run: async (_p, k) => {
      if (k === 'k5' && typeof _p === 'object' && _p !== null && _p.v === 1) { startedResolve(); await gate; return }
      if (k === 'k5' && typeof _p === 'object' && _p !== null && _p.v === 2) { secondResolve(); return }
    } })
    q.start()
    q.enqueue('reply', 'k5', { v: 1 })
    await started
    q.enqueue('reply', 'k5', { v: 2 })
    release()
    await second
    const row = q.pending('reply', 'k5')[0]
    if (row !== undefined && row.generation === 2 && JSON.stringify(row.payload) === '{"v":2}') ok('Q-5 ✓ 旧代际成功不删除新代际 payload')
    else bad(`Q-5 · ${JSON.stringify(row)}`)
  }

  // Q-6 ordered 同 kind 严格顺序
  {
    const q = new EffectsQueue(join(tmp(), 'effects.json'))
    const seen = []
    q.handle('reply', { retry: [5, 10], ordered: true, run: async (_p, k) => {
      seen.push(k)
      await new Promise((r) => setTimeout(r, 2))
    } })
    q.enqueue('reply', 'a', {})
    q.enqueue('reply', 'b', {})
    q.enqueue('reply', 'c', {})
    q.start()
    await q.idle('reply')
    if (JSON.stringify(seen) === '["a","b","c"]') ok('Q-6 ✓ ordered 同 kind 按 seq 严格顺序执行')
    else bad(`Q-6 · seen=${JSON.stringify(seen)}`)
  }

  // Q-7 并发上限
  {
    const q = new EffectsQueue(join(tmp(), 'effects.json'))
    let active = 0
    let max = 0
    q.handle('reply', { retry: [5, 10], limit: 2, run: async () => {
      active++
      max = Math.max(max, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
    } })
    for (let i = 0; i < 6; i++) q.enqueue('reply', `c${i}`, {})
    q.start()
    await q.idle('reply')
    if (max <= 2 && q.pending().length === 0) ok(`Q-7 ✓ 并发上限生效（实测 max=${max}）`)
    else bad(`Q-7 · max=${max} pending=${q.pending().length}`)
  }

  // Q-8 ordered 队头退避时，后续行不得越队
  {
    let t = 1000
    const q = new EffectsQueue(join(tmp(), 'effects.json'), { now: () => t })
    const seen = []
    q.handle('reply', { retry: [100, 100], ordered: true, run: async (_p, k) => {
      seen.push(k)
      if (k === 'head') throw new Error('retry me')
    } })
    q.enqueue('reply', 'head', {})
    q.enqueue('reply', 'next', {})
    q.start()
    await new Promise((r) => setTimeout(r, 20))
    const headPending = q.pending('reply', 'head').length === 1
    const nextStillPending = q.pending('reply', 'next').length === 1
    const sawNext = seen.includes('next')
    if (headPending && nextStillPending && !sawNext && JSON.stringify(seen) === '["head"]') ok('Q-8 ✓ ordered 队头退避时，后续行不越队')
    else bad(`Q-8 · seen=${JSON.stringify(seen)} headPending=${headPending} nextPending=${nextStillPending}`)
  }

  // N-Q1 负向对拍：持久化文件坏损时按空队列恢复，不能假装还有任务
  {
    const path = join(tmp(), 'effects.json')
    writeFileSync(path, '{broken')
    const q = new EffectsQueue(path)
    if (q.pending().length === 0) ok('N-Q1 ✓ 负向对拍（坏 JSON）⇒ 空队列恢复，不抛错')
    else bad('N-Q1 · 坏 JSON 后仍读到任务')
  }

  // N-Q2 负向对拍：去掉 ordered 后，队尾会越队执行
  {
    let t = 1000
    const q = new EffectsQueue(join(tmp(), 'effects.json'), { now: () => t })
    const seen = []
    q.handle('reply', { retry: [100, 100], ordered: false, run: async (_p, k) => {
      seen.push(k)
      if (k === 'head') throw new Error('retry me')
    } })
    q.enqueue('reply', 'head', {})
    q.enqueue('reply', 'next', {})
    q.start()
    await new Promise((r) => setTimeout(r, 20))
    if (seen.includes('next')) ok('N-Q2 ✓ 负向对拍（非 ordered 队头退避时队尾仍可执行）')
    else bad('N-Q2 · 没有 order 约束时队尾也被阻塞，夹具未造出对照')
  }

  // Q-9 同进程按路径复用唯一 writer
  {
    const path = join(tmp(), 'effects.json')
    let built = 0
    const q1 = openEffectsQueue(path, () => { built++; return new EffectsQueue(path) })
    const q2 = openEffectsQueue(path, () => { built++; return new EffectsQueue(path) })
    const same = q1 === q2 && built === 1
    await q1.drain()
    const q3 = openEffectsQueue(path)
    const reopened = q3 !== q1
    await q3.drain()
    if (same && reopened) ok('Q-9 ✓ 同进程按队列路径复用唯一实例；drain 后释放，下一次可重新打开')
    else bad(`Q-9 · same=${same} built=${built} reopened=${reopened}`)
  }

  // N-Q3 负向对拍：第二个独立 writer 必须被独占锁拒绝
  {
    const path = join(tmp(), 'effects.json')
    const q1 = new EffectsQueue(path)
    let rejected = false
    try {
      // eslint-disable-next-line no-new
      new EffectsQueue(path)
    } catch (e) {
      rejected = String(e?.message ?? e).includes('effect-queue-locked')
    }
    await q1.drain()
    const lockReleased = (() => { try { readFileSync(`${path}.lock`); return false } catch { return true } })()
    if (rejected && lockReleased) ok('N-Q3 ✓ 负向对拍（同文件再开第二个 writer）⇒ 必被独占锁拒绝；显式 drain 后锁释放')
    else bad(`N-Q3 · rejected=${rejected} lockReleased=${lockReleased}`)
  }

  // Q-10 崩溃遗留锁：确认锁主已死 ⇒ 原子隔离并允许接管
  {
    const path = join(tmp(), 'effects.json')
    writeFileSync(`${path}.lock`, JSON.stringify({ pid: 42424242, identity: 'dead-worker', at: 1 }))
    const q = new EffectsQueue(path, { isProcessAlive: () => false })
    let hits = 0
    q.handle('reply', { retry: [5, 10], run: async () => { hits++ } })
    q.enqueue('reply', 'recovered', { ok: true })
    q.start()
    await q.idle('reply')
    const owner = JSON.parse(readFileSync(`${path}.lock`, 'utf8'))
    if (hits === 1 && q.pending().length === 0 && owner.pid === process.pid) {
      ok('Q-10 ✓ 锁主已死 ⇒ 陈旧锁被原子隔离，新 writer 接管并恢复投递')
    } else {
      bad(`Q-10 · hits=${hits} pending=${q.pending().length} owner.pid=${owner.pid}`)
    }
    await q.drain()
  }

  // N-Q4 负向对拍：锁主仍活 / 判不出 / 锁内容坏 ⇒ 一律不得抢占
  {
    const cases = [
      ['still-alive', JSON.stringify({ pid: 42424243, identity: 'alive', at: 1 }), () => true],
      ['unknown', JSON.stringify({ pid: 42424244, identity: 'unknown', at: 1 }), () => undefined],
      ['malformed', '{broken', () => false],
    ]
    const results = []
    for (const [name, body, isProcessAlive] of cases) {
      const path = join(tmp(), 'effects.json')
      writeFileSync(`${path}.lock`, body)
      let rejected = false
      try {
        // eslint-disable-next-line no-new
        new EffectsQueue(path, { isProcessAlive })
      } catch (e) {
        rejected = String(e?.message ?? e).includes('effect-queue-locked')
      }
      const untouched = readFileSync(`${path}.lock`, 'utf8') === body
      results.push({ name, rejected, untouched })
    }
    if (results.every((x) => x.rejected && x.untouched)) {
      ok('N-Q4 ✓ 负向对拍（锁主仍活 / 判不出 / 锁坏）⇒ 三种都 fail-closed，原锁字节不动')
    } else {
      bad(`N-Q4 · ${JSON.stringify(results)}`)
    }
  }
} finally {
  for (const d of clean) rmSync(d, { recursive: true, force: true })
}

console.log(`\n效果队列：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处`
  + (fail > 0 ? ` · 没过 ${fail} 处` : '')
  + ' · 跳过 0 处（⚠ 跳过**不计入通过**）')
process.exitCode = fail > 0 ? 1 : 0
