#!/usr/bin/env node
/**
 * WorkPlan 纯函数行为判据。
 *
 * 这些断言必须先证明当前模型能阻止「档位名义上是单会话、实际却能派两路」。
 * 使用 Node 22 的内置 TypeScript 类型剥离直接加载真源码。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const mod = await import(pathToFileURL(join(root, 'src', 'shared', 'work-plan.ts')).href)
const {
  guardIntentAllowsWake,
  guardIntentForOwner,
  GUARD_INTENTS,
  validateWorkPlan,
  scopePathsOverlap,
  dependencyCycles,
  initiallyDispatchable,
  workPlanProgress,
  planModeOf,
  closePlanProblems,
  validateSingleTargetDispatch,
  candidatesAreIndependent,
  hasIndependentCandidatePair,
} = mod
/** 计划的构造在存储模块里（⚠ 纯函数，不落盘）。 */
const { newWorkPlan } = await import(
  pathToFileURL(join(root, 'src', 'server', 'work-plan-state.ts')).href
)

let pass = 0
let fail = 0
const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail++; console.log(`  ✗ ${m}`) }
const t = (trackId, overrides = {}) => ({
  trackId,
  taskId: `TSK-${trackId}`,
  sessionId: `session-${trackId}`,
  goal: `goal-${trackId}`,
  scopePaths: [`src/${trackId}/`],
  accessType: 'write',
  dependsOn: [],
  budget: 'tool_calls=10 · rounds=1',
  acceptance: [`check-${trackId}`],
  message: `do-${trackId}`,
  ...overrides,
})
const plan = (overrides = {}) => ({
  planId: 'WP-001',
  changeId: 'CHG-001',
  mode: 'auto',
  rationale: 'two independent modules',
  tracks: [t('a', { accessType: 'read' }), t('b', { accessType: 'read' })],
  joinPolicy: 'all',
  joinOwnerSessionId: 'session-hob',
  ...overrides,
})
const codes = (v) => v.problems.map((p) => p.code)
/** 多会话单轨的合法候选表：两个候选范围重叠、验收相同 ⇒ 不存在独立对。 */
const mergedCandidates = [
  { pieceId: 'left', scopePaths: ['src/shared/'], acceptance: ['one-result'] },
  { pieceId: 'right', scopePaths: ['src/shared/x.ts'], acceptance: ['one-result'] },
]
/** 多会话单轨证据：候选表 + 原因自己的证据（合并成一条 `singleTrackEvidence`）。 */
const multiEvidence = (extra = {}) => ({ candidatePieces: mergedCandidates, ...extra })

// WM-0 合法多轨
{
  const v = validateWorkPlan(plan())
  if (v.ok) ok('WM-0 ✓ 两条范围互斥的独立轨通过校验')
  else bad(`WM-0 · ${JSON.stringify(v.problems)}`)
}

// WM-1 单会话硬限制
{
  const v = validateWorkPlan(plan({ mode: 'single' }))
  if (!v.ok && codes(v).includes('single-mode-one-track')) {
    ok('WM-1 ✓ 单会话档 + 两轨 ⇒ 拒绝（不再只靠提示词）')
  } else bad(`WM-1 · ${JSON.stringify(v.problems)}`)
}

// WM-2 单会话合法一轨
{
  const v = validateWorkPlan(plan({ mode: 'single', tracks: [t('a')] }))
  if (v.ok) ok('WM-2 ✓ 单会话档一轨通过')
  else bad(`WM-2 · ${JSON.stringify(v.problems)}`)
}

// WM-3 多会话单轨必须写原因，且 same-file / strict-order 必须可交叉验证
{
  const noReason = validateWorkPlan(plan({ mode: 'multi', tracks: [t('a')] }))
  const bareReason = validateWorkPlan(plan({
    mode: 'multi', tracks: [t('a')], singleTrackReason: 'same-file',
  }))
  const verified = validateWorkPlan(plan({
    mode: 'multi',
    tracks: [t('a')],
    singleTrackReason: 'same-file',
    singleTrackEvidence: {
      candidatePieces: mergedCandidates,
      piecePaths: { parser: ['src/shared/work-plan.ts'], writer: ['src/shared/work-plan.ts', 'src/shared/state.ts'] },
    },
  }))
  const ordered = validateWorkPlan(plan({
    mode: 'multi',
    tracks: [t('a')],
    singleTrackReason: 'strict-order',
    singleTrackEvidence: multiEvidence({ orderedSteps: ['schema', 'migration'] }),
  }))
  if (!noReason.ok && codes(noReason).includes('multi-mode-one-track-reason')
    && !bareReason.ok && codes(bareReason).includes('missing-split-evidence')
    && verified.ok && ordered.ok) {
    ok('WM-3 ✓ 多会话单轨：无原因拒绝；只写理由缺候选证据拒绝；候选+same-file/strict-order 结构化依据才通过')
  } else bad(`WM-3 · noReason=${JSON.stringify(noReason.problems)} bare=${JSON.stringify(bareReason.problems)} verified=${JSON.stringify(verified.problems)} ordered=${JSON.stringify(ordered.problems)}`)
}

// WM-4 写范围重叠 ⇒ 串行化，不伪并行
{
  const v = validateWorkPlan(plan({
    tracks: [
      t('a', { scopePaths: ['src/shared/'] }),
      t('b', { scopePaths: ['src/shared/work-plan.ts'] }),
    ],
  }))
  const n = v.normalized
  const b = n?.tracks.find((x) => x.trackId === 'b')
  if (v.ok && n?.singleTrackReason === 'same-file'
    && JSON.stringify(b?.dependsOn) === '["a"]') {
    ok('WM-4 ✓ 写范围前缀重叠 ⇒ 记为 same-file 并串成 a -> b，不假装并行')
  } else bad(`WM-4 · ok=${v.ok} problems=${JSON.stringify(v.problems)} normalized=${JSON.stringify(n)}`)
}

// WM-4a 自动档：可拆 ⇒ 多路且理由落盘
{
  const v = validateWorkPlan(plan({ mode: 'auto' }))
  if (v.ok && v.normalized?.tracks.length === 2 && v.normalized?.rationale !== '') {
    ok('WM-4a ✓ 自动 + 两条独立只读轨 ⇒ 两路，且 rationale 随计划保留')
  } else bad(`WM-4a · ${JSON.stringify(v)}`)
}

// WM-5a 自动档：不可拆 ⇒ 单路且必须留封闭依据
{
  const noReason = validateWorkPlan(plan({ mode: 'auto', tracks: [t('a')] }))
  const ordered = validateWorkPlan(plan({
    mode: 'auto',
    tracks: [t('a')],
    singleTrackReason: 'strict-order',
    singleTrackEvidence: { orderedSteps: ['write-schema', 'migrate'] },
  }))
  if (!noReason.ok && codes(noReason).includes('multi-mode-one-track-reason') && ordered.ok) {
    ok('WM-5a ✓ 自动 + 不可拆：无依据拒绝；strict-order + 有序子步骤才通过')
  } else bad(`WM-5a · noReason=${JSON.stringify(noReason.problems)} ordered=${JSON.stringify(ordered.problems)}`)
}

// WM-8f 模式冻结：计划用创建时快照，会话改档只影响下一份计划
{
  const created = newWorkPlan(plan({ mode: 'multi' }), 1000)
  const liveModeNow = 'single'
  /** 若按**现在**的档位复验，两轨计划必须被拒 —— 说明冻结不是空话。 */
  const underLiveMode = validateWorkPlan({ ...created, mode: liveModeNow })
  /** 按**快照**复验，本计划仍成立。 */
  const underSnapshot = validateWorkPlan({ ...created, mode: planModeOf(created) })
  const next = newWorkPlan(plan({ mode: liveModeNow, tracks: [t('a')] }), 2000)
  if (created.modeSnapshot === 'multi' && planModeOf(created) === 'multi'
    && !underLiveMode.ok && codes(underLiveMode).includes('single-mode-one-track')
    && underSnapshot.ok && planModeOf(next) === 'single') {
    ok('WM-8f ✓ 计划冻结创建时档位：按现档复验会被拒，按快照成立；下一份计划才用新档')
  } else bad(`WM-8f · snapshot=${created.modeSnapshot} live=${JSON.stringify(underLiveMode.problems)} snap=${JSON.stringify(underSnapshot.problems)} next=${next.modeSnapshot}`)
}

// WM-5 只读范围重叠可并行
{
  const v = validateWorkPlan(plan({
    tracks: [
      t('a', { accessType: 'read', scopePaths: ['src/shared/'] }),
      t('b', { accessType: 'read', scopePaths: ['src/shared/'] }),
    ],
  }))
  if (v.ok) ok('WM-5 ✓ 两条只读轨可共享同一范围')
  else bad(`WM-5 · ${JSON.stringify(v.problems)}`)
}

// WM-6 预算 / 验收 / 范围必填
{
  const v = validateWorkPlan(plan({
    tracks: [t('a', { scopePaths: [], acceptance: [], budget: '' })],
  }))
  const c = codes(v)
  if (c.includes('missing-scope') && c.includes('missing-acceptance') && c.includes('missing-budget')) {
    ok('WM-6 ✓ 缺范围 / 验收 / 预算分别被拒')
  } else bad(`WM-6 · ${JSON.stringify(v.problems)}`)
}

// WM-7 同会话 / 同任务去重
{
  const v = validateWorkPlan(plan({
    tracks: [
      t('a'),
      t('b', { taskId: 'TSK-a', sessionId: 'session-a' }),
    ],
  }))
  const c = codes(v)
  if (c.includes('duplicate-task') && c.includes('duplicate-session')) {
    ok('WM-7 ✓ 同任务 / 同执行会话不被算作两条独立轨')
  } else bad(`WM-7 · ${JSON.stringify(v.problems)}`)
}

// WM-8 未知依赖 / 环
{
  const unknown = validateWorkPlan(plan({
    tracks: [t('a', { dependsOn: ['ghost'] })],
  }))
  const cyclicTracks = [t('a', { dependsOn: ['b'] }), t('b', { dependsOn: ['a'] })]
  const cyclic = validateWorkPlan(plan({ tracks: cyclicTracks }))
  if (codes(unknown).includes('dependency-unknown')
    && codes(cyclic).includes('dependency-cycle')
    && dependencyCycles(cyclicTracks).length === 1) {
    ok('WM-8 ✓ 未知依赖与依赖环分别被拒')
  } else bad(`WM-8 · unknown=${JSON.stringify(unknown.problems)} cyclic=${JSON.stringify(cyclic.problems)}`)
}

// WM-9 首波只派无依赖轨
{
  const p = plan({
    tracks: [
      t('a'),
      t('b', { dependsOn: ['a'] }),
    ],
  })
  const first = initiallyDispatchable(p).map((x) => x.trackId)
  if (JSON.stringify(first) === '["a"]') ok('WM-9 ✓ 首波只含无前置依赖的轨')
  else bad(`WM-9 · first=${JSON.stringify(first)}`)
}

// WM-10 路径归一
{
  const cases = [
    ['src/a/', 'src/a', true],
    ['src/a', 'src/a/b', true],
    ['src/a', 'src/b', false],
    ['src/**', 'src/a', true],
  ]
  const got = cases.every(([a, b, want]) => scopePathsOverlap(a, b) === want)
  if (got) ok('WM-10 ✓ 路径归一：同路径 / 前缀 / 通配视为重叠')
  else bad('WM-10 · 路径归一某一格不符')
}

// WM-11 汇合 / 理由
{
  const v = validateWorkPlan(plan({ joinOwnerSessionId: '', rationale: '' }))
  const c = codes(v)
  if (c.includes('invalid-join') && c.includes('invalid-rationale')) {
    ok('WM-11 ✓ 缺汇合责任人 / 缺拆分理由分别被拒')
  } else bad(`WM-11 · ${JSON.stringify(v.problems)}`)
}

// WM-12 同一工作区最多一条**同时运行**的写轨
{
  const writePlan = plan({
    tracks: [
      t('a', { accessType: 'write', scopePaths: ['src/a/'] }),
      t('b', { accessType: 'write', scopePaths: ['src/b/'] }),
    ],
  })
  const readOnly = validateWorkPlan(plan({
    tracks: [
      t('a', { accessType: 'read', scopePaths: ['src/a/'] }),
      t('b', { accessType: 'read', scopePaths: ['src/b/'] }),
    ],
  }))
  const v = validateWorkPlan(writePlan)
  const first = initiallyDispatchable(v.normalized ?? writePlan).map((x) => x.trackId)
  const strict = validateWorkPlan(writePlan, { serializeWrites: false })
  if (v.ok && v.normalized?.singleTrackReason === 'strict-order'
    && JSON.stringify(first) === '["a"]' && readOnly.ok
    && !strict.ok && codes(strict).includes('multiple-write-tracks')) {
    ok('WM-12 ✓ 两条写轨被串成一条链（首波仅 a）；关闭串行化仍由 multiple-write-tracks 拒绝；两条只读轨可并行')
  } else bad(`WM-12 · write=${JSON.stringify(v)} first=${JSON.stringify(first)} strict=${JSON.stringify(strict.problems)} read=${JSON.stringify(readOnly.problems)}`)
}

// WM-13 进度：首波派出但未返回 ⇒ running，不提前 joining
{
  const p = plan()
  const early = workPlanProgress({ ...p, version: 1, state: 'running', createdAt: 1,
    trackStates: { a: 'running', b: 'running' } })
  const done = workPlanProgress({ ...p, version: 1, state: 'running', createdAt: 1,
    trackStates: { a: 'returned', b: 'returned' } })
  if (early.nextState === 'running' && done.nextState === 'joining' && done.terminal) {
    ok('WM-13 ✓ 只有全部轨道终态后才 joining')
  } else bad(`WM-13 · early=${early.nextState} done=${done.nextState} terminal=${done.terminal}`)
}

// WM-14 依赖轨只在返回后 ready；前置失败 ⇒ 计划失败
{
  const p = plan({ tracks: [t('a'), t('b', { dependsOn: ['a'] }), t('c', { dependsOn: ['b'] })] })
  const pending = workPlanProgress({ ...p, version: 1, state: 'running', createdAt: 1,
    trackStates: { a: 'running', b: 'pending', c: 'pending' } })
  const afterA = workPlanProgress({ ...p, version: 1, state: 'running', createdAt: 1,
    trackStates: { a: 'returned', b: 'pending', c: 'pending' } })
  const failed = workPlanProgress({ ...p, version: 1, state: 'running', createdAt: 1,
    trackStates: { a: 'failed', b: 'pending', c: 'pending' } })
  if (pending.ready.length === 0 && afterA.ready.map((x) => x.trackId).join(',') === 'b'
    && failed.nextState === 'failed') {
    ok('WM-14 ✓ 依赖链逐级放行；前置失败时计划进入 failed')
  } else bad(`WM-14 · pending=${pending.ready.length} afterA=${JSON.stringify(afterA.ready.map((x) => x.trackId))} failed=${failed.nextState}`)
}

// WM-15 多写轨串行化必须无环：逆序依赖不得被"按入参顺序补边"造出环
{
  const v = validateWorkPlan(plan({
    tracks: [
      t('a', { accessType: 'write', scopePaths: ['src/a/'], dependsOn: ['b'] }),
      t('b', { accessType: 'write', scopePaths: ['src/b/'] }),
    ],
  }))
  const n = v.normalized
  const cycles = n === undefined ? [['none']] : dependencyCycles(n.tracks)
  const first = n === undefined ? [] : initiallyDispatchable(n).map((x) => x.trackId)
  const progress = n === undefined ? undefined : workPlanProgress({
    ...n, version: 1, state: 'running', createdAt: 1, trackStates: { a: 'pending', b: 'pending' },
  })
  if (v.ok && cycles.length === 0 && JSON.stringify(first) === '["b"]'
    && progress?.ready.length === 1 && progress?.waiting.length === 1) {
    ok('WM-15 ✓ 逆序依赖的多写轨按拓扑序串链：无环，首波只放 b，a 等 b')
  } else bad(`WM-15 · ok=${v.ok} cycles=${JSON.stringify(cycles)} first=${JSON.stringify(first)} ready=${progress?.ready.length}`)
}

// WM-16 三条写轨逆序依赖也不得造环
{
  const v = validateWorkPlan(plan({
    tracks: [
      t('a', { accessType: 'write', scopePaths: ['src/a/'], dependsOn: ['c'] }),
      t('b', { accessType: 'write', scopePaths: ['src/b/'] }),
      t('c', { accessType: 'write', scopePaths: ['src/c/'] }),
    ],
  }))
  const n = v.normalized
  const cycles = n === undefined ? [['none']] : dependencyCycles(n.tracks)
  const first = n === undefined ? [] : initiallyDispatchable(n).map((x) => x.trackId)
  if (v.ok && cycles.length === 0 && JSON.stringify(first) === '["b"]') {
    ok('WM-16 ✓ 三条写轨逆序依赖（a 等 c、c 等 b）仍是无环链，首波只有 b')
  } else bad(`WM-16 · ok=${v.ok} cycles=${JSON.stringify(cycles)} first=${JSON.stringify(first)}`)
}

// WM-17 same-file 不能靠同一条路径的两种拼写凑出"两条重叠路径"
{
  /** 旧形态（只写 mergedPieces + sharedPaths）不再算证据；必须给出两个片段的实际路径。 */
  const degenerate = validateWorkPlan(plan({
    mode: 'multi',
    tracks: [t('a')],
    singleTrackReason: 'same-file',
    singleTrackEvidence: multiEvidence({ mergedPieces: ['x', 'y'], sharedPaths: ['src/a', 'src/a/'] }),
  }))
  const real = validateWorkPlan(plan({
    mode: 'multi',
    tracks: [t('a')],
    singleTrackReason: 'same-file',
    singleTrackEvidence: {
      candidatePieces: mergedCandidates,
      piecePaths: { x: ['src/shared/work-plan.ts'], y: ['src/shared/work-plan.ts', 'src/shared/state.ts'] },
    },
  }))
  if (!degenerate.ok && codes(degenerate).includes('unverified-single-track-reason') && real.ok) {
    ok('WM-17 ✓ same-file 只认 piecePaths：旧的自述式字段被拒，两个片段真写同一文件才通过')
  } else bad(`WM-17 · degenerate=${JSON.stringify(degenerate.problems)} real=${JSON.stringify(real.problems)}`)
}

// WM-18 经只读轨的传递依赖不得被补成环（第二轮独立验收发现的残留）
{
  const v = validateWorkPlan(plan({
    tracks: [
      t('b', { accessType: 'write', scopePaths: ['src/b/'], dependsOn: ['r'] }),
      t('a', { accessType: 'write', scopePaths: ['src/a/'] }),
      t('r', { accessType: 'read', scopePaths: ['src/r/'], dependsOn: ['a'] }),
    ],
  }))
  const n = v.normalized
  const cycles = n === undefined ? [['none']] : dependencyCycles(n.tracks)
  const first = n === undefined ? [] : initiallyDispatchable(n).map((x) => x.trackId)
  if (v.ok && cycles.length === 0 && JSON.stringify(first) === '["a"]') {
    ok('WM-18 ✓ 写轨 b 经只读轨 r 依赖 a ⇒ 全图排序后无环，首波只有 a')
  } else bad(`WM-18 · ok=${v.ok} problems=${JSON.stringify(v.problems.map((x) => x.code))} cycles=${JSON.stringify(cycles)} first=${JSON.stringify(first)}`)
}

// WM-19 same-file 不接受空串 / `.` 充当"第二条重叠路径"
{
  const cases = [['', 'src/a'], ['.', 'src/a']]
  const badOnes = cases.map((shared) => validateWorkPlan(plan({
    mode: 'multi',
    tracks: [t('a')],
    singleTrackReason: 'same-file',
    singleTrackEvidence: multiEvidence({ piecePaths: { p1: [shared[0]], p2: [shared[1]] } }),
  })))
  /** 一个片段路径为空 ⇒ 该片段不算数，只剩一个片段 ⇒ 拒绝。 */
  const emptyPiece = validateWorkPlan(plan({
    mode: 'multi',
    tracks: [t('a')],
    singleTrackReason: 'same-file',
    singleTrackEvidence: multiEvidence({ piecePaths: { p1: [''], p2: ['src/a/x.ts'] } }),
  }))
  const good = validateWorkPlan(plan({
    mode: 'multi',
    tracks: [t('a')],
    singleTrackReason: 'same-file',
    singleTrackEvidence: multiEvidence({ piecePaths: { p1: ['src/a'], p2: ['src/a/x.ts'] } }),
  }))
  if ([...badOnes, emptyPiece].every((x) => !x.ok && codes(x).includes('unverified-single-track-reason')) && good.ok) {
    ok('WM-19 ✓ same-file 拒绝空路径片段；两个片段真写重叠范围才通过')
  } else bad(`WM-19 · ${JSON.stringify(badOnes.map((x) => x.problems.map((p) => p.code)))} empty=${JSON.stringify(emptyPiece.problems)} good=${JSON.stringify(good.problems)}`)
}

// WM-20 规范化后的自检兜底：任何情况下都不返回带环的 normalized 计划
{
  const v = validateWorkPlan(plan({
    tracks: [
      t('a', { accessType: 'write', scopePaths: ['src/a/'], dependsOn: ['b'] }),
      t('b', { accessType: 'write', scopePaths: ['src/b/'], dependsOn: ['a'] }),
    ],
  }))
  if (!v.ok && codes(v).includes('dependency-cycle') && v.normalized === undefined) {
    ok('WM-20 ✓ 真成环的多写轨被拒，且不返回任何 normalized 计划')
  } else bad(`WM-20 · ok=${v.ok} codes=${JSON.stringify(codes(v))} normalized=${v.normalized === undefined ? 'undefined' : 'present'}`)
}

// WM-21 same-file 共享路径必须按路径语义归一（点段拼写不算第二条）
{
  /** 归一化函数本身要能把点段/通配折叠到同一路径。 */
  const { canonicalScopePath, scopePathsOverlap } = mod
  const same = (a, b) => canonicalScopePath(a) === canonicalScopePath(b)
  const foldChecks = [
    ['src/a', 'src/a/.'],
    ['src/a', 'src/a/../a'],
    ['src/a', 'src/a/**'],
    ['src/a', 'src/a/**/'],
    ['src/a', 'src/a/*/'],
    ['src/a', 'src/a/**/**'],
  ]
  const overlapOf = scopePathsOverlap('src/shared', 'src/shared/w.ts')
  if (foldChecks.every(([a, b]) => same(a, b)) && overlapOf) {
    ok('WM-21 ✓ 路径归一先折叠再剥通配：点段/多重通配都折叠到同一路径；前缀仍判重叠')
  } else bad(`WM-21 · folds=${JSON.stringify(foldChecks.map(([a, b]) => [a, b, same(a, b)]))} overlap=${overlapOf}`)
}

// WM-22 same-file 的合并片段必须非空且互不相同
{
  const blank = validateWorkPlan(plan({
    mode: 'multi', tracks: [t('a')], singleTrackReason: 'same-file',
    singleTrackEvidence: multiEvidence({ piecePaths: { '': ['src/a'], ' ': ['src/a/b.ts'] } }),
  }))
  const dup = validateWorkPlan(plan({
    mode: 'multi', tracks: [t('a')], singleTrackReason: 'same-file',
    singleTrackEvidence: multiEvidence({ piecePaths: { p1: ['src/a'], ' p1\u200b': ['src/a/b.ts'] } }),
  }))
  if (!blank.ok && codes(blank).includes('unverified-single-track-reason')
    && !dup.ok && codes(dup).includes('unverified-single-track-reason')) {
    ok('WM-22 ✓ 片段名是空白或仅差不可见字符（同一片段换个写法）都不算两个片段')
  } else bad(`WM-22 · blank=${JSON.stringify(blank.problems)} dup=${JSON.stringify(dup.problems)}`)
}

// WM-23 strict-order 的有序子步骤必须非空且互不相同
{
  const blank = validateWorkPlan(plan({
    mode: 'multi', tracks: [t('a')], singleTrackReason: 'strict-order',
    singleTrackEvidence: multiEvidence({ orderedSteps: ['', ''] }),
  }))
  const dup = validateWorkPlan(plan({
    mode: 'multi', tracks: [t('a')], singleTrackReason: 'strict-order',
    singleTrackEvidence: multiEvidence({ orderedSteps: ['a', 'a'] }),
  }))
  const real = validateWorkPlan(plan({
    mode: 'multi', tracks: [t('a')], singleTrackReason: 'strict-order',
    singleTrackEvidence: multiEvidence({ orderedSteps: ['a', 'b'] }),
  }))
  if (!blank.ok && !dup.ok && real.ok) {
    ok('WM-23 ✓ strict-order 只认 ≥2 个非空且互不相同的子步骤；空白/重复都不算')
  } else bad(`WM-23 · blank=${JSON.stringify(blank.problems)} dup=${JSON.stringify(dup.problems)} real=${JSON.stringify(real.problems)}`)
}

// WM-24 旧的自述式证据字段不能单独成立（必须给片段→路径）
{
  const oldForm = validateWorkPlan(plan({
    mode: 'multi', tracks: [t('a')], singleTrackReason: 'same-file',
    singleTrackEvidence: multiEvidence({ mergedPieces: ['p1', 'p2'], sharedPaths: ['src/a', 'src/a/b.ts'] }),
  }))
  const real = validateWorkPlan(plan({
    mode: 'multi', tracks: [t('a')], singleTrackReason: 'same-file',
    singleTrackEvidence: multiEvidence({ piecePaths: { p1: ['src/a'], p2: ['src/a/b.ts'] } }),
  }))
  if (!oldForm.ok && codes(oldForm).includes('unverified-single-track-reason') && real.ok) {
    ok('WM-24 ✓ 只写 mergedPieces/sharedPaths 不算证据；给出片段→路径才通过')
  } else bad(`WM-24 · old=${JSON.stringify(oldForm.problems)} real=${JSON.stringify(real.problems)}`)
}

// WM-25 不可见字符（Default_Ignorable）不得让同一片段/步骤伪装成两个
{
  const invisibles = ['\u00AD', '\uFE0F', '\u034F', '\u061C', '\u180E', '\u200B', '\u2060', '\uFEFF']
  const pieceHits = invisibles.map((ch) => validateWorkPlan(plan({
    mode: 'multi', tracks: [t('a')], singleTrackReason: 'same-file',
    singleTrackEvidence: multiEvidence({ piecePaths: { p1: ['src/shared/w.ts'], ['p1' + ch]: ['src/shared/w.ts'] } }),
  })))
  const stepHits = invisibles.map((ch) => validateWorkPlan(plan({
    mode: 'multi', tracks: [t('a')], singleTrackReason: 'strict-order',
    singleTrackEvidence: multiEvidence({ orderedSteps: ['a', 'a' + ch] }),
  })))
  const allRefused = [...pieceHits, ...stepHits]
    .every((x) => !x.ok && codes(x).includes('unverified-single-track-reason'))
  if (allRefused) {
    ok(`WM-25 ✓ ${invisibles.length} 种不可见字符（含 U+00AD/FE0F/034F/061C/180E）都伪装不出第二个片段或步骤`)
  } else bad(`WM-25 · pieces=${JSON.stringify(pieceHits.map((x) => x.problems.map((p) => p.code)))} steps=${JSON.stringify(stepHits.map((x) => x.problems.map((p) => p.code)))}`)
}

// WM-26 证据形态错误必须被拒绝，而不是抛异常
{
  const cases = [
    ['piecePaths 是数组', validateWorkPlan(plan({
      mode: 'multi', tracks: [t('a')], singleTrackReason: 'same-file',
      singleTrackEvidence: multiEvidence({ piecePaths: ['src/a', 'src/b'] }),
    }))],
    ['piecePaths 是字符串', validateWorkPlan(plan({
      mode: 'multi', tracks: [t('a')], singleTrackReason: 'same-file',
      singleTrackEvidence: multiEvidence({ piecePaths: 'src/a' }),
    }))],
    ['piecePaths 值不是数组', validateWorkPlan(plan({
      mode: 'multi', tracks: [t('a')], singleTrackReason: 'same-file',
      singleTrackEvidence: multiEvidence({ piecePaths: { p1: 'src/a', p2: ['src/a'] } }),
    }))],
    ['orderedSteps 是字符串', validateWorkPlan(plan({
      mode: 'multi', tracks: [t('a')], singleTrackReason: 'strict-order',
      singleTrackEvidence: multiEvidence({ orderedSteps: 'a,b' }),
    }))],
    ['orderedSteps 是对象', validateWorkPlan(plan({
      mode: 'multi', tracks: [t('a')], singleTrackReason: 'strict-order',
      singleTrackEvidence: multiEvidence({ orderedSteps: { a: 1 } }),
    }))],
    ['orderedSteps 含非字符串', validateWorkPlan(plan({
      mode: 'multi', tracks: [t('a')], singleTrackReason: 'strict-order',
      singleTrackEvidence: multiEvidence({ orderedSteps: ['a', 3] }),
    }))],
  ]
  let threw
  try {
    /** 上面已经在构造时调用过；这里再跑一遍，专门抓"抛异常"这种失败形态。 */
    for (const [, v] of cases) if (typeof v?.ok !== 'boolean') throw new Error('verdict 形状不对')
  } catch (e) { threw = e }
  const allRefused = threw === undefined && cases.every(([, v]) => !v.ok && codes(v).includes('unverified-single-track-reason'))
  if (allRefused) {
    ok('WM-26 ✓ 六种错误证据形态都被判「证据不合格」，⛔ 没有抛异常把工具打崩')
  } else bad(`WM-26 · threw=${String(threw)} ${JSON.stringify(cases.map(([n, v]) => [n, v?.problems?.map((p) => p.code)]))}`)
}

// WM-27 片段名只差大小写 / 只差一个点，也不算两个片段
{
  const variants = [
    ['p', 'P'],
    ['p', 'p.'],
    ['p', 'ｐ'],
    ['p', 'P.'],
  ]
  const results = variants.map(([a, b]) => validateWorkPlan(plan({
    mode: 'multi', tracks: [t('a')], singleTrackReason: 'same-file',
    singleTrackEvidence: multiEvidence({ piecePaths: { [a]: ['src/shared/w.ts'], [b]: ['src/shared/w.ts'] } }),
  })))
  const distinct = validateWorkPlan(plan({
    mode: 'multi', tracks: [t('a')], singleTrackReason: 'same-file',
    singleTrackEvidence: multiEvidence({ piecePaths: { parser: ['src/shared/w.ts'], writer: ['src/shared/w.ts'] } }),
  }))
  if (results.every((x) => !x.ok && codes(x).includes('unverified-single-track-reason')) && distinct.ok) {
    ok('WM-27 ✓ 片段名只差大小写/全半角/一个点都不算两个片段；真正不同名仍通过')
  } else bad(`WM-27 · ${JSON.stringify(results.map((x) => x.problems.map((p) => p.code)))} distinct=${JSON.stringify(distinct.problems)}`)
}

// WM-28 证据门小规模 fuzz：任何被接受的输入都必须真有 >=2 个片段和 >=2 条路径
{
  const { evidenceKey, canonicalScopePath } = mod
  const spell = ['src/a', 'src/a/', 'src/a/.', 'src/a/../a', 'src/a/**', 'src//a', 'SRC/A', '.', '', 'src/a/b']
  const names = ['p', 'p ', 'p\u200b', 'Ｐ', 'p.', 'P', '.', '']
  let total = 0
  let badAccept = 0
  let threw = 0
  for (const a of spell) for (const b of spell) for (const n1 of names) for (const n2 of names) {
    total++
    let v
    try {
      v = validateWorkPlan(plan({
        mode: 'multi', tracks: [t('a')], singleTrackReason: 'same-file',
        singleTrackEvidence: multiEvidence({ piecePaths: { [n1]: [a], [n2]: [b] } }),
      }))
    } catch { threw++; continue }
    if (!v.ok) continue
    const keys = new Set([n1, n2].map(evidenceKey).filter((x) => x !== ''))
    const paths = [canonicalScopePath(a), canonicalScopePath(b)].filter((x) => x !== '')
    if (keys.size < 2 || paths.length < 2) badAccept++
  }
  if (threw === 0 && badAccept === 0 && total >= 5000) {
    ok(`WM-28 ✓ 证据门 fuzz ${total} 组：伪造通过 0 · 抛异常 0`)
  } else bad(`WM-28 · total=${total} badAccept=${badAccept} threw=${threw}`)
}

// ── WG：看护意图（2026-11-04 用户裁定）───────────────────────────────
{
  const planOf = (state, states) => ({
    version: 1, planId: 'WP-g', changeId: 'CHG-g', mode: 'multi', modeSnapshot: 'multi',
    rationale: 'g', joinPolicy: 'all', joinOwnerSessionId: 'hob', createdAt: 1, state,
    trackStates: states,
    tracks: [
      t('a', { accessType: 'read', scopePaths: ['src/a/'] }),
      t('b', { accessType: 'read', scopePaths: ['src/b/'] }),
    ],
  })
  const intentOf = (plan, opts = {}) => guardIntentForOwner({
    plans: plan === undefined ? [] : [plan],
    stopped: opts.stopped === true,
    awaitingUser: opts.awaitingUser === true,
  }).intent

  const cases = [
    ['WG-1 计划 completed', intentOf(planOf('completed', { a: 'returned', b: 'returned' })), 'completed'],
    ['WG-2 计划 joining', intentOf(planOf('joining', { a: 'returned', b: 'returned' })), 'joining'],
    ['WG-3 用户 stop', intentOf(planOf('running', { a: 'running', b: 'pending' }), { stopped: true }), 'stopped'],
    ['WG-5 等用户', intentOf(planOf('running', { a: 'running', b: 'pending' }), { awaitingUser: true }), 'waiting-user'],
    ['WG-7 全部返回', intentOf(planOf('running', { a: 'returned', b: 'returned' })), 'joining'],
    ['WG-8 仍有未结算', intentOf(planOf('running', { a: 'running', b: 'pending' })), 'expecting-return'],
    ['WG-9 无活动计划', intentOf(undefined), 'stale'],
    ['WG-12 计划失败', intentOf(planOf('failed', { a: 'failed', b: 'cancelled' })), 'failed'],
  ]
  const wrong = cases.filter(([, got, want]) => got !== want)
  if (wrong.length === 0) {
    ok(`WG-1..WG-9 ✓ 看护意图逐档正确（${cases.length} 个场景）：completed/joining/stopped/waiting-user/全部返回/仍有未结算/无计划/失败`)
  } else bad(`WG 意图错：${wrong.map(([name, got, want]) => `${name} 期望 ${want} 实得 ${got}`).join(' / ')}`)

  const wakeable = GUARD_INTENTS.filter((x) => guardIntentAllowsWake(x))
  if (JSON.stringify(wakeable) === '["expecting-return"]') {
    ok('WG-10 ✓ 唯一允许唤醒的意图是 expecting-return（其余一律不叫）')
  } else bad(`WG-10 · wakeable=${JSON.stringify(wakeable)}`)

  /** 负向对拍：去掉意图闸 ⇒ "计划已完成"也会被当成可唤醒。 */
  const completed = planOf('completed', { a: 'returned', b: 'returned' })
  const noGate = guardIntentForOwner({ plans: [completed], stopped: false }).intent
  if (noGate === 'completed' && !guardIntentAllowsWake(noGate) && guardIntentAllowsWake('expecting-return')) {
    ok('N-WG1 ✓ 负向对拍：completed 不唤醒、expecting-return 唤醒 ⇒ 闸门确实按意图分流')
  } else bad(`N-WG1 · completed=${noGate}`)
}

// N-WM1 负向对拍：旧提示词本身不进入本校验 ⇒ 去掉单会话门必须红
{
  const v = validateWorkPlan(plan({ mode: 'single' }))
  const withoutGate = { ...plan({ mode: 'single' }), mode: 'auto' }
  const probe = validateWorkPlan(withoutGate)
  if (!v.ok && probe.ok) {
    ok('N-WM1 ✓ 负向对拍：把单会话换成自动档后两轨通过 ⇒ 说明拒绝来自档位门')
  } else bad(`N-WM1 · gate=${JSON.stringify(v.problems)} bypass=${JSON.stringify(probe.problems)}`)
}

// N-WM2 负向对拍：关掉串行化，重叠写轨必须回到硬拒绝
{
  const overlapPlan = plan({
    tracks: [
      t('a', { scopePaths: ['src/shared/'] }),
      t('b', { scopePaths: ['src/shared/work-plan.ts'] }),
    ],
  })
  const serialized = validateWorkPlan(overlapPlan)
  const refused = validateWorkPlan(overlapPlan, { serializeWrites: false })
  const manualNoConflict = overlapPlan.tracks.every((x) => x.scopePaths.length > 0)
    && overlapPlan.tracks.length === 2
  if (serialized.ok && !refused.ok && codes(refused).includes('multiple-write-tracks')
    && manualNoConflict) {
    ok('N-WM2 ✓ 负向对拍：结构完整但范围重叠 ⇒ 只有串行化/写轨门能使其不并行')
  } else bad(`N-WM2 · serialized=${JSON.stringify(serialized)} refused=${JSON.stringify(refused.problems)}`)
}

// ── WM-13：收口判据（2026-11-06 · Wave 1）──────────────────────────────
{
  const returnedPlan = {
    ...plan({ mode: 'multi' }),
    state: 'joining',
    trackStates: { a: 'returned', b: 'running' },
  }
  const p1 = closePlanProblems(returnedPlan)
  if (p1.some((x) => x.includes('未到终态'))) ok('WM-13 ✓ 收口：还有 running 轨 ⇒ 拒绝（返回 ≠ 全部完成）')
  else bad(`WM-13 有 running 轨仍被允许收口：${JSON.stringify(p1)}`)

  const failedPlan = {
    ...plan({ mode: 'multi' }),
    state: 'joining',
    trackStates: { a: 'returned', b: 'failed' },
  }
  const p2 = closePlanProblems(failedPlan)
  if (p2.some((x) => x.includes('失败'))) ok('WM-13 ✓ 收口：有 failed 轨 ⇒ 拒绝收成 completed')
  else bad(`WM-13 失败轨仍被允许收成 completed：${JSON.stringify(p2)}`)

  const notJoining = {
    ...plan({ mode: 'multi' }),
    state: 'running',
    trackStates: { a: 'returned', b: 'returned' },
  }
  const p3 = closePlanProblems(notJoining)
  if (p3.some((x) => x.includes('joining'))) ok('WM-13 ✓ 收口：未到 joining ⇒ 拒绝（不能跳进入口）')
  else bad(`WM-13 未到 joining 仍被允许收口：${JSON.stringify(p3)}`)

  const good = {
    ...plan({ mode: 'multi' }),
    state: 'joining',
    trackStates: { a: 'returned', b: 'returned' },
  }
  const p4 = closePlanProblems(good)
  if (p4.length === 0) ok('N-WM13 ✓ 负向对拍：全部 returned + joining ⇒ 放行（判据不是恒拒）')
  else bad(`N-WM13 全终态仍被拒绝：${JSON.stringify(p4)}`)

  const srcOrch = (await import('node:fs')).readFileSync(join(root, 'src', 'modules', 'orchestrator.ts'), 'utf8')
  if (srcOrch.includes('closePlanProblems(plan)')) ok('WM-13 ✓ 收口判据已接进 closePlan（不是只写纯函数）')
  else bad('WM-13 closePlan 没有调用收口判据 ⇒ 纯函数只是摆设')
}

// ── WM-14：三档的多条写轨都只能串行（⛔ 不承诺并行写）──────────────────
{
  const autoTwoWrites = plan({
    mode: 'auto',
    tracks: [t('a', { scopePaths: ['src/a/'] }), t('b', { scopePaths: ['src/b/'] })],
  })
  const serialized = validateWorkPlan(autoTwoWrites)
  const parallel = validateWorkPlan(autoTwoWrites, { serializeWrites: false })
  if (serialized.ok) ok('WM-14 ✓ 自动档重叠/多条写轨默认串行化 ⇒ 放行（既有行为不被误伤）')
  else bad(`WM-14 自动档默认串行化被拒：${JSON.stringify(serialized.problems)}`)
  if (!parallel.ok && codes(parallel).includes('multiple-write-tracks')) {
    ok('WM-14 ✓ 自动档关闭串行化（负向对拍）⇒ multiple-write-tracks 拒绝；生产不开放并行写')
  } else bad(`WM-14 自动档真并行多条写轨未被拦：${JSON.stringify(parallel.problems)}`)
  const readOnlyAuto = plan({ mode: 'auto', tracks: [t('a', { accessType: 'read' }), t('b', { accessType: 'read' })] })
  const ro = validateWorkPlan(readOnlyAuto, { serializeWrites: false })
  if (ro.ok) ok('N-WM14 ✓ 负向对拍：自动档两条只读轨可并行（判据不误伤只读）')
  else bad(`N-WM14 自动档两条只读轨被拒：${JSON.stringify(ro.problems)}`)
}

// ── WM-29：三档策略表（2026-11-09 · 推进方式落地）────────────────────────
{
  const wm = await import(pathToFileURL(join(root, 'src', 'shared', 'work-mode.ts')).href)
  const { workModePolicy } = wm
  const single = workModePolicy('single')
  const auto = workModePolicy('auto')
  const multi = workModePolicy('multi')
  const okShape = single.topology === 'single' && single.maxActiveTracks === 1
    && single.allowParallelRead === false && single.acceptsSingleTrackReason === false
    && auto.topology === 'adaptive' && auto.allowParallelRead === true
    && auto.acceptsSingleTrackReason === true && auto.singleTrackEvidence === 'basic'
    && auto.mustSplitIndependentCandidates === false && auto.requiresPostDispatchReport === true
    && multi.topology === 'fanout' && multi.singleTrackEvidence === 'candidates'
    && multi.mustSplitIndependentCandidates === true && multi.requiresPostDispatchReport === false
    && single.allowParallelWrite === false && auto.allowParallelWrite === false && multi.allowParallelWrite === false
  if (okShape) ok('WM-29 ✓ 三档策略表：单会话硬单轨 / 自动动态判路 / 多会话候选扇出；三档写轨都串行')
  else bad(`WM-29 · single=${JSON.stringify(single)} auto=${JSON.stringify(auto)} multi=${JSON.stringify(multi)}`)
}

// ── WM-30：多会话单轨必须给候选证据，且独立候选必须拆轨 ─────────────────
{
  const cand = (pieceId, overrides = {}) => ({
    pieceId,
    scopePaths: [`src/${pieceId}/`],
    acceptance: [`check-${pieceId}`],
    ...overrides,
  })
  const independent = [
    cand('a'),
    cand('b'),
  ]
  const shared = [
    cand('a', { sharedContracts: ['api-v1'] }),
    cand('b', { sharedContracts: ['api-v1'] }),
  ]
  const sameUnit = [
    cand('a', { acceptanceUnit: 'one-product-result' }),
    cand('b', { acceptanceUnit: 'one-product-result' }),
  ]
  const oneTrack = (mode, singleTrackReason, candidatePieces) => plan({
    mode,
    tracks: [t('a', { accessType: 'read' })],
    singleTrackReason,
    ...(candidatePieces === undefined ? {} : { singleTrackEvidence: { candidatePieces } }),
  })
  const cases = [
    ['WM-30a', '多会话单轨缺 candidatePieces ⇒ missing-split-evidence', oneTrack('multi', 'insufficient-independent-scope'), 'missing-split-evidence'],
    ['WM-30b', '多会话单轨列出独立候选 ⇒ multi-mode-split-required', oneTrack('multi', 'insufficient-independent-scope', independent), 'multi-mode-split-required'],
    ['WM-30c', '多会话单轨 shared-contract 有交集 ⇒ 通过', oneTrack('multi', 'shared-contract', shared), undefined],
    ['WM-30d', '多会话单轨 single-acceptance-unit 同一单元 ⇒ 通过', oneTrack('multi', 'single-acceptance-unit', sameUnit), undefined],
    ['WM-30e', '自动档单轨只要求封闭原因（不强制候选）', oneTrack('auto', 'insufficient-independent-scope'), undefined],
  ]
  for (const [id, label, input, want] of cases) {
    const v = validateWorkPlan(input)
    const hit = want === undefined ? v.ok : !v.ok && codes(v).includes(want)
    if (hit) ok(`${id} ✓ ${label}`)
    else bad(`${id} · ${label} ⇒ ok=${v.ok} problems=${JSON.stringify(v.problems)}`)
  }
  const sameScope = [
    cand('a', { scopePaths: ['src/shared/'] }),
    cand('b', { scopePaths: ['src/shared/x.ts'] }),
  ]
  const dep = [
    cand('a'),
    cand('b', { dependsOn: ['a'] }),
  ]
  if (!candidatesAreIndependent(sameScope[0], sameScope[1]) && !candidatesAreIndependent(dep[0], dep[1])
    && hasIndependentCandidatePair(independent) && !hasIndependentCandidatePair(shared)) {
    ok('WM-30f ✓ 独立判定看真实范围与依赖：重叠 / 有依赖 / 共享契约都不算独立')
  } else bad('WM-30f · 候选独立判定与预期不符')
}

// ── WM-31：单目标派活也受档位约束（等价于隐式单轨计划）──────────────────
{
  const noReasonAuto = validateSingleTargetDispatch({ mode: 'auto' })
  const noReasonMulti = validateSingleTargetDispatch({ mode: 'multi' })
  const multiIndep = validateSingleTargetDispatch({
    mode: 'multi',
    singleTrackReason: 'insufficient-independent-scope',
    singleTrackEvidence: { candidatePieces: [
      { pieceId: 'a', scopePaths: ['src/a/'], acceptance: ['check-a'] },
      { pieceId: 'b', scopePaths: ['src/b/'], acceptance: ['check-b'] },
    ] },
  })
  const multiMerged = validateSingleTargetDispatch({
    mode: 'multi',
    singleTrackReason: 'single-acceptance-unit',
    singleTrackEvidence: { candidatePieces: [
      { pieceId: 'a', scopePaths: ['src/a/'], acceptance: ['check-a'], acceptanceUnit: 'u' },
      { pieceId: 'b', scopePaths: ['src/b/'], acceptance: ['check-b'], acceptanceUnit: 'u' },
    ] },
  })
  const autoReason = validateSingleTargetDispatch({
    mode: 'auto',
    singleTrackReason: 'strict-order',
    singleTrackEvidence: { orderedSteps: ['write-schema', 'migrate'] },
  })
  const singleNoReason = validateSingleTargetDispatch({ mode: 'single' })
  if (!noReasonAuto.ok && noReasonAuto.problems.some((p) => p.code === 'single-target-reason-required')
    && !noReasonMulti.ok && noReasonMulti.problems.some((p) => p.code === 'single-target-reason-required')
    && !multiIndep.ok && multiIndep.problems.some((p) => p.code === 'single-target-split-required')
    && multiMerged.ok && autoReason.ok && singleNoReason.ok) {
    ok('WM-31 ✓ 单目标：自动要原因 / 多会话要候选且独立必拆 / 单会话设定本身')
  } else bad(`WM-31 · autoNo=${JSON.stringify(noReasonAuto)} multiNo=${JSON.stringify(noReasonMulti)} indep=${JSON.stringify(multiIndep)} merged=${JSON.stringify(multiMerged)} autoReason=${JSON.stringify(autoReason)} single=${JSON.stringify(singleNoReason)}`)
}

// ── WM-32：单目标与计划层共用同一份单轨证据门（⛔ 不是免检通道）────────
{
  const forgedSameFile = validateSingleTargetDispatch({
    mode: 'auto',
    singleTrackReason: 'same-file',
    singleTrackEvidence: { mergedPieces: ['p1', 'p2'], sharedPaths: ['src/a', 'src/a/x.ts'] },
  })
  const goodSameFile = validateSingleTargetDispatch({
    mode: 'auto',
    singleTrackReason: 'same-file',
    singleTrackEvidence: { piecePaths: { p1: ['src/a/x.ts'], p2: ['src/a/x.ts'] } },
  })
  const forgedOrder = validateSingleTargetDispatch({
    mode: 'auto',
    singleTrackReason: 'strict-order',
    singleTrackEvidence: { orderedSteps: ['a', 'a'] },
  })
  if (!forgedSameFile.ok && forgedSameFile.problems.some((p) => p.code === 'unverified-single-track-reason')
    && goodSameFile.ok
    && !forgedOrder.ok && forgedOrder.problems.some((p) => p.code === 'unverified-single-track-reason')) {
    ok('WM-32 ✓ 单目标派活复用 same-file / strict-order 证据门：伪造被拒，真证据放行')
  } else bad(`WM-32 · forgedSame=${JSON.stringify(forgedSameFile)} goodSame=${JSON.stringify(goodSameFile)} forgedOrder=${JSON.stringify(forgedOrder)}`)
}

// ── WM-33：多会话的 same-file / strict-order 也不能绕过候选表 ─────────────
{
  const sameFileNoCandidates = validateWorkPlan(plan({
    mode: 'multi', tracks: [t('a')], singleTrackReason: 'same-file',
    singleTrackEvidence: { piecePaths: { p1: ['src/a/x.ts'], p2: ['src/a/x.ts'] } },
  }))
  const orderNoCandidates = validateWorkPlan(plan({
    mode: 'multi', tracks: [t('a')], singleTrackReason: 'strict-order',
    singleTrackEvidence: { orderedSteps: ['schema', 'migrate'] },
  }))
  if (!sameFileNoCandidates.ok && codes(sameFileNoCandidates).includes('missing-split-evidence')
    && !orderNoCandidates.ok && codes(orderNoCandidates).includes('missing-split-evidence')) {
    ok('WM-33 ✓ 多会话单轨：same-file / strict-order 也必须有候选表（原因证据不能替代候选证据）')
  } else bad(`WM-33 · same=${JSON.stringify(sameFileNoCandidates.problems)} order=${JSON.stringify(orderNoCandidates.problems)}`)
}

// ── WM-34：R-21 —— 注释里提到的函数必须真的存在 ────────────────────────────
//
//  ⚠ 这条钉的是「注释描述了一个不存在的函数」：
//    `work-plan.ts` 里原有一段带 `@param` / `@returns` 的完整 JSDoc，
//    **下面直接接下一个定义** —— 注释描述的函数从来没有函数体。
//    而它宣称的「本计划按创建时的快照**推进**」也是假的：
//    `advanceWorkPlans()` 调 `dispatch` 时**不传 `workMode`**，推进一律用**当前档位**。
//
//  ⚠ 判据只查两件可静态判定的事（⛔ 不试图复现运行时行为）：
//    ① `work-plan.ts` 里**不再有**「按快照复验计划」那种无函数体的 JSDoc；
//    ② `planModeOf` 仍然是 `modeSnapshot ?? mode` 的唯一读法（WM-8 的读侧）。
//  ⚠ 反向：谁再写一段「宣称有函数但下面没函数体」的注释 ⇒ 红。
{
  const src = readFileSync(join(root, 'src/shared/work-plan.ts'), 'utf8')
  const p = []
  /**
   * ① 找「JSDoc 之后**紧接着**就是另一个 JSDoc 或文件结束」的形态。
   *    ⚠ 这是本条缺陷的精确形状：**有注释、没函数体**。
   */
  const docs = [...src.matchAll(/\/\*\*[\s\S]*?\*\//g)]
  for (const d of docs) {
    const after = src.slice(d.index + d[0].length)
    const nextNonWs = after.replace(/^\s+/, '')
    /** 紧跟的必须是代码；若又是 `/**` 或直接 EOF ⇒ 这段 JSDoc 没挂任何东西。 */
    if (nextNonWs === '' || nextNonWs.startsWith('/**')) {
      const head = d[0].split('\n').slice(0, 3).join(' ').slice(0, 80)
      /** ⚠ 允许「刻意保留的记录性注释」：带 @deprecated 且明写「不存在这个函数」。 */
      if (!(d[0].includes('@deprecated') && d[0].includes('不存在这个函数'))) {
        p.push('发现一段**没有函数体**的 JSDoc（描述的函数不存在）：' + head)
      }
    }
  }
  /** ② `planModeOf` 必须仍是唯一读法且实现正确。 */
  if (!/export function planModeOf\(plan: WorkPlan\): WorkMode \{\s*\n\s*return plan\.modeSnapshot \?\? plan\.mode/.test(src)) {
    p.push('`planModeOf` 的实现变了（应为 `plan.modeSnapshot ?? plan.mode`）⇒ WM-8 的读侧基准漂了')
  }
  /** ③ 反向：不许有人再写「按快照复验」这种宣称。 */
  if (/用\*\*计划自己的档位快照\*\*复验计划/.test(src)) {
    p.push('又出现了「按计划自己的档位快照复验计划」的宣称 ⇒ 那个函数不存在，会误导下一个人')
  }
  if (p.length === 0) {
    ok('WM-34 ✓ **负向对拍**：`work-plan.ts` 里没有「有注释没函数体」的 JSDoc；'
      + '`planModeOf` 仍是 `modeSnapshot ?? mode` 的唯一读法；⛔ 不再宣称「快照驱动推进」'
      + '（R-21：注释说的必须是真事）')
  } else for (const x of p) bad('WM-34 · ' + x)
}
console.log(`\n工作计划：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处`
  + (fail > 0 ? ` · 没过 ${fail} 处` : '')
  + ' · 跳过 0 处')
process.exitCode = fail > 0 ? 1 : 0
