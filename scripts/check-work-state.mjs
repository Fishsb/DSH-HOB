#!/usr/bin/env node
/** Work State 九态判据：只读纯函数，零 I/O。 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = new URL('..', import.meta.url).pathname
const { WORK_STATES, workStateOf, attentionOf } = await import(pathToFileURL(join(root, 'src', 'shared', 'work-state.ts')).href)
const { effectiveAcceptanceOf } = await import(pathToFileURL(join(root, 'src', 'shared', 'acceptance-verdict.ts')).href)
let pass = 0
let fail = 0
const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail++; console.log(`  ✗ ${m}`) }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// W-1 封闭集恰好九态
if (eq(WORK_STATES, ['awaiting-user', 'awaiting-acceptance', 'delivery-failed', 'blocked', 'queued', 'working', 'idle', 'ended', 'undecidable'])) {
  ok('W-1 ✓ 工作状态恰好九态且顺序固定')
} else bad(`W-1 · ${JSON.stringify(WORK_STATES)}`)

// W-2 投递失败优先级最高
{
  const r = workStateOf({ id: 'R-001', kind: 'req', status: 'agreed', acceptance_ids: ['ACC-001'] }, [
    { id: 'ACC-001', kind: 'acc', status: 'unverified' },
    { id: 'RUN-001', kind: 'run', delivery: { error: 'offline' } },
  ])
  if (r.state === 'delivery-failed') ok('W-2 ✓ 投递失败优先于等验收')
  else bad(`W-2 · ${r.state}`)
}

// W-3 等用户回答
{
  const r = workStateOf({ id: 'T-001', kind: 'task', status: 'built', verify_refs: ['EVD-1'] }, [
    { id: 'RUN-1', kind: 'run', attention: 'desktop?' },
  ])
  if (r.state === 'awaiting-user') ok('W-3 ✓ 有结构化问题时进入等你回答')
  else bad(`W-3 · ${r.state}`)
}

// W-4 已定需求无验收路径
{
  const r = workStateOf({ id: 'R-1', kind: 'req', status: 'agreed', acceptance_ids: [] }, [])
  if (r.state === 'awaiting-user') ok('W-4 ✓ 已定需求无验收路径 ⇒ 等你决定')
  else bad(`W-4 · ${r.state}`)
}

// W-5 task built 但无证据
{
  const r = workStateOf({ id: 'T-1', kind: 'task', status: 'built', verify_refs: [] }, [])
  if (r.state === 'blocked') ok('W-5 ✓ 已交付但无证据 ⇒ blocked')
  else bad(`W-5 · ${r.state}`)
}

// W-6 task built 有证据无验收
{
  const r = workStateOf({ id: 'T-1', kind: 'task', status: 'built', verify_refs: ['EVD-1'] }, [])
  if (r.state === 'awaiting-acceptance') ok('W-6 ✓ 已交付有证据无验收 ⇒ 等验收')
  else bad(`W-6 · ${r.state}`)
}

// W-7 run 状态映射
{
  const a = workStateOf({ id: 'RUN-1', kind: 'run', status: 'registered' })
  const b = workStateOf({ id: 'RUN-2', kind: 'run', status: 'running' })
  const c = workStateOf({ id: 'RUN-3', kind: 'run', status: 'stuck' })
  if (a.state === 'queued' && b.state === 'working' && c.state === 'blocked') ok('W-7 ✓ run registered/running/stuck ⇒ queued/working/blocked')
  else bad(`W-7 · ${a.state}/${b.state}/${c.state}`)
}

// W-8 未知状态必须判不出
{
  const r = workStateOf({ id: 'T-X', kind: 'task', status: 'mystery' })
  if (r.state === 'undecidable') ok('W-8 ✓ 封闭集外状态 ⇒ undecidable，不猜')
  else bad(`W-8 · ${r.state}`)
}

// W-9 注意力列表只保留四类需要人的状态
{
  const units = [
    { id: 'R-1', kind: 'req', status: 'agreed', acceptance_ids: [] },
    { id: 'R-2', kind: 'req', status: 'agreed', acceptance_ids: [] },
    { id: 'T-1', kind: 'task', status: 'doing' },
  ]
  const rows = attentionOf(units)
  if (rows.length === 2 && rows.every((r) => r.state === 'awaiting-user')) ok('W-9 ✓ 注意力列表只保留需要人的状态；两条无验收路径都显示')
  else bad(`W-9 · ${JSON.stringify(rows)}`)
}

// N-W1 负向对拍：把未知状态塞成 work 会破坏判不出
{
  const badFn = (u) => ({ state: u.status === 'mystery' ? 'working' : workStateOf(u).state })
  if (badFn({ id: 'X', kind: 'task', status: 'mystery' }).state === 'working'
    && workStateOf({ id: 'X', kind: 'task', status: 'mystery' }).state === 'undecidable') {
    ok('N-W1 ✓ 负向对拍（把未知状态硬塞成 working）⇒ 与 undecidable 分辨力相反')
  } else bad('N-W1 · 夹具没有造出未知状态的错误映射')
}

// N-W2 负向对拍：投递失败不能与等验收合并
{
  const a = workStateOf(
    { id: 'R', kind: 'req', status: 'agreed', acceptance_ids: ['A'] },
    [{ id: 'A', kind: 'acc', status: 'unverified' }],
    { acceptanceById: new Map([['A', { id: 'A', kind: 'acc', status: 'unverified' }]]) },
  )
  const b = workStateOf(
    { id: 'R', kind: 'req', status: 'agreed', acceptance_ids: ['A'] },
    [
      { id: 'A', kind: 'acc', status: 'unverified' },
      { id: 'RUN', kind: 'run', delivery: { error: 'x' } },
    ],
    { acceptanceById: new Map([['A', { id: 'A', kind: 'acc', status: 'unverified' }]]) },
  )
  if (a.state === 'awaiting-acceptance' && b.state === 'delivery-failed') ok('N-W2 ✓ 负向对拍：投递失败与等验收两档可区分')
  else bad(`N-W2 · ${a.state}/${b.state}`)
}

// W-13 需求只认 acceptance_ids，不借任务验收作证
{
  const units = [
    { id: 'R-1', kind: 'req', status: 'agreed', acceptance_ids: ['ACC-1'] },
    { id: 'ACC-1', kind: 'acc', status: 'pass', verified_at: '2026-11-02T10:00:00+08:00' },
    { id: 'TSK-1', kind: 'task', status: 'built', verify_refs: ['EVD-1'] },
    { id: 'ACC-TASK', kind: 'acc', status: 'pass', parent: 'TSK-1', verified_at: '2026-11-02T10:00:00+08:00' },
  ]
  const related = new Map([['R-1', [{ id: 'ACC-TASK', kind: 'acc', status: 'pass' }]]])
  const rows = attentionOf(units, related)
  const wrong = workStateOf(units[0], related.get('R-1'), {
    acceptanceById: new Map(
      units.filter((u) => u.kind === 'acc').map((u) => [u.id, u]),
    ),
  })
  if (rows.length === 1 && rows[0].id === 'TSK-1' && wrong.state === 'ended') {
    ok('W-13 ✓ 需求只认 acceptance_ids：正式引用已通过即结束，不把任务 ACC 当需求验收')
  } else bad(`W-13 · rows=${JSON.stringify(rows)} wrong=${JSON.stringify(wrong)}`)
}

// W-10 同一 event_id 只算一次事实
{
  const units = [
    { id: 'T-1', kind: 'task', status: 'built', verify_refs: [], event_id: 'evt-1' },
    { id: 'T-1-replay', kind: 'task', status: 'built', verify_refs: [], event_id: 'evt-1' },
  ]
  const rows = attentionOf(units)
  if (rows.length === 1 && rows[0].id === 'T-1' && rows[0].event_id === 'evt-1') {
    ok('W-10 ✓ event_id 去重：同一事件重投只产生一条注意力')
  } else bad(`W-10 · ${JSON.stringify(rows)}`)
}

// W-11 同一线程同一工作态合并，成员可追溯
{
  const units = [
    { id: 'R-1', kind: 'req', status: 'agreed', acceptance_ids: [], thread_id: 'thr-1', event_id: 'e1' },
    { id: 'R-2', kind: 'req', status: 'agreed', acceptance_ids: [], thread_id: 'thr-1', event_id: 'e2' },
  ]
  const rows = attentionOf(units)
  if (rows.length === 1 && rows[0].thread_id === 'thr-1'
    && JSON.stringify(rows[0].merged) === '["R-1","R-2"]' && rows[0].event_id === 'e1') {
    ok('W-11 ✓ 同一 thread_id + 同一工作态合并一行；merged 逐 id 可追溯，保留首见 event_id')
  } else bad(`W-11 · ${JSON.stringify(rows)}`)
}

// W-12 不同线程绝不合并
{
  const units = [
    { id: 'R-1', kind: 'req', status: 'agreed', acceptance_ids: [], thread_id: 'thr-a' },
    { id: 'R-2', kind: 'req', status: 'agreed', acceptance_ids: [], thread_id: 'thr-b' },
  ]
  const rows = attentionOf(units)
  if (rows.length === 2) ok('W-12 ✓ 不同 thread_id 不合并（即使 ID 型、状态型看起来相同）')
  else bad(`W-12 · ${JSON.stringify(rows)}`)
}

// N-W3 负向对拍：忽略 event_id 会导致重投重复
{
  const units = [
    { id: 'T-1', kind: 'task', status: 'built', verify_refs: [], event_id: 'evt-3' },
    { id: 'T-2', kind: 'task', status: 'built', verify_refs: [], event_id: 'evt-3' },
  ]
  const broken = units.map((u) => workStateOf(u)).filter((r) => r.state === 'blocked')
  const good = attentionOf(units).filter((r) => r.state === 'blocked')
  if (broken.length === 2 && good.length === 1) ok('N-W3 ✓ 负向对拍（绕开 event_id 直接算状态）⇒ 同事件从 1 条膨胀成 2 条')
  else bad(`N-W3 · broken=${broken.length} good=${good.length}`)
}

// N-W4 负向对拍：错把不同线程合并会少报
{
  const units = [
    { id: 'R-1', kind: 'req', status: 'agreed', acceptance_ids: [], thread_id: 'a' },
    { id: 'R-2', kind: 'req', status: 'agreed', acceptance_ids: [], thread_id: 'b' },
  ]
  const wrong = new Map(units.map((u) => ['same', workStateOf(u)])).size
  const good = attentionOf(units).length
  if (wrong === 1 && good === 2) ok('N-W4 ✓ 负向对拍（按固定键强合并）⇒ 两条不同线程错误缩成 1 条；正确口径保留 2 条')
  else bad(`N-W4 · wrong=${wrong} good=${good}`)
}

// W-14 旧 SEND-BACK + 新 PASS ⇒ 最新判决为 accepted
{
  const r = effectiveAcceptanceOf([
    { id: 'ACC-OLD', status: 'send-back', verified_at: '2026-11-01T10:00:00+08:00' },
    { id: 'ACC-NEW', status: 'pass', verified_at: '2026-11-02T10:00:00+08:00' },
  ])
  const task = workStateOf(
    { id: 'TSK-1', kind: 'task', status: 'built', verify_refs: ['EVD-1'] },
    [
      { id: 'ACC-OLD', kind: 'acc', status: 'send-back', verified_at: '2026-11-01T10:00:00+08:00' },
      { id: 'ACC-NEW', kind: 'acc', status: 'pass', verified_at: '2026-11-02T10:00:00+08:00' },
    ],
  )
  if (r.verdict === 'accepted' && r.latest_id === 'ACC-NEW' && task.state === 'ended') {
    ok('W-14 ✓ 旧 SEND-BACK + 新 PASS ⇒ 按最新时刻收口')
  } else bad(`W-14 · verdict=${JSON.stringify(r)} task=${JSON.stringify(task)}`)
}

// W-15 旧 PASS + 新 SEND-BACK ⇒ 重新成为验收缺口
{
  const r = effectiveAcceptanceOf([
    { id: 'ACC-OLD', status: 'pass', verified_at: '2026-11-01T10:00:00+08:00' },
    { id: 'ACC-NEW', status: 'send-back', verified_at: '2026-11-02T10:00:00+08:00' },
  ])
  const task = workStateOf(
    { id: 'TSK-1', kind: 'task', status: 'built', verify_refs: ['EVD-1'] },
    [
      { id: 'ACC-OLD', kind: 'acc', status: 'pass', verified_at: '2026-11-01T10:00:00+08:00' },
      { id: 'ACC-NEW', kind: 'acc', status: 'send-back', verified_at: '2026-11-02T10:00:00+08:00' },
    ],
  )
  if (r.verdict === 'send-back' && r.latest_id === 'ACC-NEW' && task.state === 'awaiting-acceptance') {
    ok('W-15 ✓ 旧 PASS + 新 SEND-BACK ⇒ 重新打开验收缺口')
  } else bad(`W-15 · verdict=${JSON.stringify(r)} task=${JSON.stringify(task)}`)
}

// W-16 缺 verified_at ⇒ 判不出，不猜
{
  const r = effectiveAcceptanceOf([
    { id: 'ACC-OLD', status: 'send-back', verified_at: '2026-11-01T10:00:00+08:00' },
    { id: 'ACC-NO-TIME', status: 'pass' },
  ])
  const task = workStateOf(
    { id: 'TSK-1', kind: 'task', status: 'built', verify_refs: ['EVD-1'] },
    [
      { id: 'ACC-OLD', kind: 'acc', status: 'send-back', verified_at: '2026-11-01T10:00:00+08:00' },
      { id: 'ACC-NO-TIME', kind: 'acc', status: 'pass' },
    ],
  )
  if (r.verdict === 'undecidable' && task.state === 'undecidable') {
    ok('W-16 ✓ 缺时刻 ⇒ 有效判决与任务状态均为 undecidable')
  } else bad(`W-16 · verdict=${JSON.stringify(r)} task=${JSON.stringify(task)}`)
}

// W-17 同刻 PASS / SEND-BACK 冲突 ⇒ 判不出
{
  const at = '2026-11-02T10:00:00+08:00'
  const r = effectiveAcceptanceOf([
    { id: 'ACC-PASS', status: 'pass', verified_at: at },
    { id: 'ACC-BACK', status: 'send-back', verified_at: at },
  ])
  if (r.verdict === 'undecidable' && Array.isArray(r.conflicts) && r.conflicts.length === 2) {
    ok('W-17 ✓ 同一最新时刻的 PASS / SEND-BACK 冲突 ⇒ undecidable，列出双方 id')
  } else bad(`W-17 · ${JSON.stringify(r)}`)
}

// W-18 需求引用两条独立验收：一条 PASS 不能替另一条 SEND-BACK 作证
{
  const r = workStateOf(
    { id: 'R-1', kind: 'req', status: 'agreed', acceptance_ids: ['ACC-A', 'ACC-B'] },
    [
      { id: 'ACC-A', kind: 'acc', status: 'pass', verified_at: '2026-11-02T10:00:00+08:00' },
      { id: 'ACC-B', kind: 'acc', status: 'send-back', verified_at: '2026-11-02T11:00:00+08:00' },
    ],
    {
      acceptanceById: new Map([
        ['ACC-A', { id: 'ACC-A', kind: 'acc', status: 'pass', verified_at: '2026-11-02T10:00:00+08:00' }],
        ['ACC-B', { id: 'ACC-B', kind: 'acc', status: 'send-back', verified_at: '2026-11-02T11:00:00+08:00' }],
      ]),
    },
  )
  if (r.state === 'awaiting-acceptance') {
    ok('W-18 ✓ 需求的两条独立 ACC 必须各自有效 PASS，一条不能替另一条作证')
  } else bad(`W-18 · ${JSON.stringify(r)}`)
}

// W-19 单条判决缺时刻：判决仍可判，只影响时间覆盖率
{
  const r = effectiveAcceptanceOf([
    { id: 'ACC-LEGACY', status: 'pass' },
  ])
  const task = workStateOf(
    { id: 'TSK-1', kind: 'task', status: 'built', verify_refs: ['EVD-1'] },
    [{ id: 'ACC-LEGACY', kind: 'acc', status: 'pass' }],
  )
  if (r.verdict === 'accepted' && task.state === 'ended') {
    ok('W-19 ✓ 单条历史 ACC 缺 verified_at ⇒ 状态仍可判；⛔ 不把唯一 PASS 降成判不出')
  } else bad(`W-19 · verdict=${JSON.stringify(r)} task=${JSON.stringify(task)}`)
}

// W-20 需求下同一 parent 的旧 SEND-BACK + 新 PASS ⇒ 只认最新，不得永久卡住
{
  const oldBack = { id: 'ACC-OLD', kind: 'acc', parent: 'TSK-1', status: 'send-back', verified_at: '2026-11-02T10:00:00+08:00' }
  const newPass = { id: 'ACC-NEW', kind: 'acc', parent: 'TSK-1', status: 'pass', verified_at: '2026-11-03T10:00:00+08:00' }
  const r = workStateOf(
    { id: 'R-1', kind: 'req', status: 'agreed', acceptance_ids: ['ACC-OLD', 'ACC-NEW'] },
    [oldBack, newPass],
    { acceptanceById: new Map([['ACC-OLD', oldBack], ['ACC-NEW', newPass]]) },
  )
  if (r.state === 'ended') {
    ok('W-20 ✓ 需求下同一 parent 的旧 SEND-BACK + 新 PASS ⇒ 按最新判决收口')
  } else bad(`W-20 · ${JSON.stringify(r)}`)
}

// N-W5 负向对拍：把同 parent 的两条判决当成两道独立验收 ⇒ 新 PASS 被旧退回压住
{
  const oldBack = { id: 'ACC-OLD', kind: 'acc', parent: 'TSK-1', status: 'send-back', verified_at: '2026-11-02T10:00:00+08:00' }
  const newPass = { id: 'ACC-NEW', kind: 'acc', parent: 'TSK-1', status: 'pass', verified_at: '2026-11-03T10:00:00+08:00' }
  const broken = [oldBack, newPass].map((x) => effectiveAcceptanceOf([x]))
  const brokenBlocked = broken.some((x) => x.verdict === 'send-back')
  if (brokenBlocked) {
    ok('N-W5 ✓ 负向对拍（同 parent 逐条独立判决）⇒ 旧 SEND-BACK 会压住新 PASS，证明 W-20 的分组不是摆设')
  } else bad(`N-W5 · broken=${JSON.stringify(broken)}`)
}

console.log(`\nWork State：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处`
  + (fail > 0 ? ` · 没过 ${fail} 处` : '')
  + ' · 跳过 0 处（⚠ 跳过**不计入通过**）')
process.exitCode = fail > 0 ? 1 : 0
