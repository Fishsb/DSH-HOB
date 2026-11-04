#!/usr/bin/env node
/**
 * WorkPlan 运行态存储判据。
 *
 * 临时目录，不碰真实账本。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const root = new URL('..', import.meta.url).pathname
const mod = await import(pathToFileURL(join(root, 'src', 'server', 'work-plan-state.ts')).href)
const {
  workPlanDirOf,
  workPlanFileOf,
  writeWorkPlan,
  readWorkPlan,
  listWorkPlans,
  removeWorkPlan,
  removeStaleWorkPlanTemps,
  newWorkPlan,
  closeWorkPlan,
  listClosedWorkPlans,
  pruneClosedWorkPlans,
} = mod

let pass = 0
let fail = 0
const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail++; console.log(`  ✗ ${m}`) }
const clean = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'hob-work-plan-'))
  clean.push(d)
  return d
}
const base = (overrides = {}) => ({
  planId: 'WP-001',
  changeId: 'CHG-001',
  mode: 'single',
  rationale: 'one thread',
  tracks: [{
    trackId: 'a',
    taskId: 'TSK-001',
    sessionId: 'session-a',
    goal: 'goal',
    scopePaths: ['src/a/'],
    accessType: 'write',
    dependsOn: [],
    budget: 'tool_calls=10 · rounds=1',
    acceptance: ['check-a'],
    message: 'do',
  }],
  joinPolicy: 'all',
  joinOwnerSessionId: 'session-hob',
  ...overrides,
})

try {
  // WPS-1 写入 + 读取
  {
    const ledger = tmp()
    const plan = newWorkPlan(base(), 1000)
    const w = writeWorkPlan(ledger, plan)
    const r = readWorkPlan(ledger, plan.planId)
    if (w.ok && r.state === 'ok' && r.plan.planId === plan.planId
      && r.plan.state === 'planned' && r.plan.createdAt === 1000) {
      ok('WPS-1 ✓ 原子写后按 planId 回读，状态与时刻原样保留')
    } else bad(`WPS-1 · write=${JSON.stringify(w)} read=${JSON.stringify(r)}`)
  }

  // WPS-2 文件落在 runtime/work-plans/active
  {
    const ledger = tmp()
    const plan = newWorkPlan(base(), 1)
    writeWorkPlan(ledger, plan)
    const file = workPlanFileOf(ledger, plan.planId)
    const expectedDir = join(ledger, 'runtime', 'work-plans', 'active')
    if (file.startsWith(expectedDir) && existsSync(file)
      && workPlanDirOf(ledger) === expectedDir) {
      ok('WPS-2 ✓ 活动计划只落在 runtime/work-plans/active')
    } else bad(`WPS-2 · file=${file} dir=${workPlanDirOf(ledger)}`)
  }

  // WPS-3 不存在 = absent，不伪造空计划
  {
    const ledger = tmp()
    const r = readWorkPlan(ledger, 'WP-none')
    if (r.state === 'absent') ok('WPS-3 ✓ 无文件返回 absent（不伪造空计划）')
    else bad(`WPS-3 · ${JSON.stringify(r)}`)
  }

  // WPS-4 坏 JSON = unreadable
  {
    const ledger = tmp()
    const file = workPlanFileOf(ledger, 'WP-bad')
    const dir = workPlanDirOf(ledger)
    const { mkdirSync } = await import('node:fs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, '{broken')
    const r = readWorkPlan(ledger, 'WP-bad')
    if (r.state === 'unreadable') ok('WPS-4 ✓ 坏 JSON 返回 unreadable，不读成空计划')
    else bad(`WPS-4 · ${JSON.stringify(r)}`)
  }

  // WPS-5 未知 storeVersion
  {
    const ledger = tmp()
    const file = workPlanFileOf(ledger, 'WP-version')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(workPlanDirOf(ledger), { recursive: true })
    writeFileSync(file, JSON.stringify({ storeVersion: 99, plan: { version: 1, planId: 'WP-version', tracks: [] } }))
    const r = readWorkPlan(ledger, 'WP-version')
    if (r.state === 'unreadable' && r.reason === 'store-version-unknown') {
      ok('WPS-5 ✓ 未知 storeVersion 明确拒绝（不按未来格式猜）')
    } else bad(`WPS-5 · ${JSON.stringify(r)}`)
  }

  // WPS-6 列表
  {
    const ledger = tmp()
    writeWorkPlan(ledger, newWorkPlan(base({ planId: 'WP-b' }), 2))
    writeWorkPlan(ledger, newWorkPlan(base({ planId: 'WP-a' }), 1))
    const list = listWorkPlans(ledger)
    if (list.length === 2 && list[0].planId === 'WP-a' && list[1].planId === 'WP-b'
      && list.every((x) => x.state === 'ok')) {
      ok('WPS-6 ✓ 活动计划按文件名稳定排序')
    } else bad(`WPS-6 · ${JSON.stringify(list)}`)
  }

  // WPS-7 删除幂等
  {
    const ledger = tmp()
    writeWorkPlan(ledger, newWorkPlan(base(), 1))
    const first = removeWorkPlan(ledger, 'WP-001')
    const second = removeWorkPlan(ledger, 'WP-001')
    const after = readWorkPlan(ledger, 'WP-001')
    if (first.ok && second.ok && after.state === 'absent') ok('WPS-7 ✓ 删除活动计划幂等；不删账本其它文件')
    else bad(`WPS-7 · first=${JSON.stringify(first)} second=${JSON.stringify(second)} after=${after.state}`)
  }

  // WPS-8 路径穿越拒绝
  {
    let threw = false
    try { workPlanFileOf('/tmp/ledger', '../escape') } catch { threw = true }
    if (threw) ok('WPS-8 ✓ planId 路径穿越被拒')
    else bad('WPS-8 · planId 路径穿越未被拒')
  }

  // WPS-9 原子写中间件不会读成计划
  {
    const ledger = tmp()
    const dir = workPlanDirOf(ledger)
    const { mkdirSync } = await import('node:fs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'WP-x.json.tmp-test'), '{half')
    const list = listWorkPlans(ledger)
    if (list.length === 0) ok('WPS-9 ✓ .tmp-* 半写件不被读成计划')
    else bad(`WPS-9 · ${JSON.stringify(list)}`)
  }

  // WPS-10 过期中间件清理
  {
    const ledger = tmp()
    const dir = workPlanDirOf(ledger)
    const { mkdirSync, utimesSync } = await import('node:fs')
    mkdirSync(dir, { recursive: true })
    const stale = join(dir, 'WP-old.json.tmp-stale')
    writeFileSync(stale, '{half')
    const old = new Date(Date.now() - 120_000)
    utimesSync(stale, old, old)
    const removed = removeStaleWorkPlanTemps(ledger, 60_000)
    if (removed === 1 && !existsSync(stale)) ok('WPS-10 ✓ 过期 .tmp-* 被清理，活动计划不受影响')
    else bad(`WPS-10 · removed=${removed} exists=${existsSync(stale)}`)
  }

  // N-WPS1 负向对拍：坏文件不能读成 absent
  {
    const ledger = tmp()
    const file = workPlanFileOf(ledger, 'WP-negative')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(workPlanDirOf(ledger), { recursive: true })
    writeFileSync(file, '{"storeVersion":1,"plan":{"version":1,"planId":"WP-negative","tracks":[]}')
    const r = readWorkPlan(ledger, 'WP-negative')
    if (r.state === 'unreadable' && r.file === file) {
      ok('N-WPS1 ✓ 负向对拍：半截 JSON 只能落 unreadable，不会伪装成“没计划”')
    } else bad(`N-WPS1 · ${JSON.stringify(r)}`)
  }

  // N-WPS2 负向对拍：清理不能碰活动 .json
  {
    const ledger = tmp()
    writeWorkPlan(ledger, newWorkPlan(base({ planId: 'WP-live' }), 1))
    const file = workPlanFileOf(ledger, 'WP-live')
    const { utimesSync } = await import('node:fs')
    const old = new Date(Date.now() - 120_000)
    utimesSync(file, old, old)
    removeStaleWorkPlanTemps(ledger, 60_000)
    if (existsSync(file)) ok('N-WPS2 ✓ 负向对拍：过期清理只碰 .tmp-*，活动 .json 仍在')
    else bad('N-WPS2 · 活动计划被过期清理误删')
  }

  // WPS-11 汇合收口：终态进 completed，active 删除
  {
    const ledger = tmp()
    const plan = newWorkPlan(base(), 1)
    plan.state = 'joining'
    writeWorkPlan(ledger, plan)
    const closed = closeWorkPlan(ledger, plan, 'completed')
    const active = readWorkPlan(ledger, plan.planId)
    const completed = listClosedWorkPlans(ledger)
    if (closed.ok && active.state === 'absent'
      && completed.length === 1 && completed[0].planId === plan.planId
      && completed[0].state === 'completed') {
      ok('WPS-11 ✓ 汇合计划从 active 收口到 completed，仍可读')
    } else bad(`WPS-11 · closed=${JSON.stringify(closed)} active=${active.state} completed=${JSON.stringify(completed)}`)
  }

  // WPS-12 收口区不是历史档案：超量/超龄会被清理，活动计划一个都不碰
  {
    const ledger = tmp()
    for (let i = 0; i < 5; i++) {
      const plan = newWorkPlan(base({ planId: `WP-old-${i}` }), i + 1)
      plan.state = 'completed'
      closeWorkPlan(ledger, plan, 'completed')
    }
    const live = newWorkPlan(base({ planId: 'WP-live-keep' }), 1)
    writeWorkPlan(ledger, live)
    const now = Date.now()
    const pruned = pruneClosedWorkPlans(ledger, { maxCount: 2, maxAgeMs: 10 * 365 * 24 * 3600 * 1000 }, now)
    const keptClosed = listClosedWorkPlans(ledger)
    if (pruned.removed === 3 && keptClosed.length === 2
      && readWorkPlan(ledger, 'WP-live-keep').state === 'ok') {
      ok('WPS-12 ✓ 收口区超量按最旧清理（5 → 2），活动计划不受影响')
    } else bad(`WPS-12 · pruned=${JSON.stringify(pruned)} kept=${JSON.stringify(keptClosed.map((x) => x.planId))} live=${readWorkPlan(ledger, 'WP-live-keep').state}`)
  }

  // N-WPS4 负向对拍：不清理时收口区会一直长（证明上面那条不是恒真）
  {
    const ledger = tmp()
    for (let i = 0; i < 5; i++) {
      const plan = newWorkPlan(base({ planId: `WP-grow-${i}` }), i + 1)
      plan.state = 'completed'
      closeWorkPlan(ledger, plan, 'completed')
    }
    const before = listClosedWorkPlans(ledger).length
    const noop = pruneClosedWorkPlans(ledger, { maxCount: 5, maxAgeMs: 10 * 365 * 24 * 3600 * 1000 })
    const after = listClosedWorkPlans(ledger).length
    if (before === 5 && noop.removed === 0 && after === 5) {
      ok('N-WPS4 ✓ 负向对拍：上限内一条不删（清理不是"每次都清空"）')
    } else bad(`N-WPS4 · before=${before} pruned=${JSON.stringify(noop)} after=${after}`)
  }

  // WPS-13 超龄清理真的会删（不是只有超量分支有效）
  {
    const ledger = tmp()
    const plan = newWorkPlan(base({ planId: 'WP-ancient' }), 1)
    plan.state = 'completed'
    closeWorkPlan(ledger, plan, 'completed')
    const live = newWorkPlan(base({ planId: 'WP-ancient-live' }), 1)
    writeWorkPlan(ledger, live)
    /** 把收口件的时间戳拨回 30 天前，模拟"很久以前汇合、早已验收"。 */
    const { utimesSync } = await import('node:fs')
    const closedFile = workPlanFileOf(ledger, 'WP-ancient').replace('active', 'completed')
    const old = (Date.now() - 30 * 24 * 3600 * 1000) / 1000
    utimesSync(closedFile, old, old)
    const pruned = pruneClosedWorkPlans(ledger, { maxCount: 50 }, Date.now())
    if (pruned.removed === 1 && listClosedWorkPlans(ledger).length === 0
      && readWorkPlan(ledger, 'WP-ancient-live').state === 'ok') {
      ok('WPS-13 ✓ 超过保留期的收口计划被删除；活动计划一个都不碰')
    } else bad(`WPS-13 · pruned=${JSON.stringify(pruned)} closed=${listClosedWorkPlans(ledger).length} live=${readWorkPlan(ledger, 'WP-ancient-live').state}`)
  }

  // N-WPS3 负向对拍：失败计划保留终态，不伪装成成功
  {
    const ledger = tmp()
    const plan = newWorkPlan(base({ planId: 'WP-live-2' }), 1)
    writeWorkPlan(ledger, plan)
    const closed = closeWorkPlan(ledger, plan, 'failed')
    const completed = listClosedWorkPlans(ledger)
    if (closed.ok && completed.length === 1 && completed[0].state === 'failed'
      && readWorkPlan(ledger, plan.planId).state === 'absent') {
      ok('N-WPS3 ✓ 失败计划也保留终态文件，不伪装成成功')
    } else bad(`N-WPS3 · closed=${JSON.stringify(closed)} completed=${JSON.stringify(completed)}`)
  }
} finally {
  for (const d of clean) rmSync(d, { recursive: true, force: true })
}

console.log(`\nWorkPlan 运行态：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处`
  + (fail > 0 ? ` · 没过 ${fail} 处` : '')
  + ' · 跳过 0 处')
process.exitCode = fail > 0 ? 1 : 0
