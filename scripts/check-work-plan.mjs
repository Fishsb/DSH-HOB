#!/usr/bin/env node
/**
 * WorkPlan 纯函数行为判据。
 *
 * 这些断言必须先证明当前模型能阻止「档位名义上是单会话、实际却能派两路」。
 * 使用 Node 22 的内置 TypeScript 类型剥离直接加载真源码。
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const mod = await import(pathToFileURL(join(root, 'src', 'shared', 'work-plan.ts')).href)
const {
  validateWorkPlan,
  scopePathsOverlap,
  dependencyCycles,
  initiallyDispatchable,
  workPlanProgress,
  planModeOf,
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
      piecePaths: { parser: ['src/shared/work-plan.ts'], writer: ['src/shared/work-plan.ts', 'src/shared/state.ts'] },
    },
  }))
  const ordered = validateWorkPlan(plan({
    mode: 'multi',
    tracks: [t('a')],
    singleTrackReason: 'strict-order',
    singleTrackEvidence: { orderedSteps: ['schema', 'migration'] },
  }))
  if (!noReason.ok && codes(noReason).includes('multi-mode-one-track-reason')
    && !bareReason.ok && codes(bareReason).includes('unverified-single-track-reason')
    && verified.ok && ordered.ok) {
    ok('WM-3 ✓ 多会话单轨：无原因拒绝；只写理由拒绝；same-file / strict-order 给出结构化依据才通过')
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
    singleTrackEvidence: { mergedPieces: ['x', 'y'], sharedPaths: ['src/a', 'src/a/'] },
  }))
  const real = validateWorkPlan(plan({
    mode: 'multi',
    tracks: [t('a')],
    singleTrackReason: 'same-file',
    singleTrackEvidence: {
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
    singleTrackEvidence: { piecePaths: { p1: [shared[0]], p2: [shared[1]] } },
  })))
  /** 一个片段路径为空 ⇒ 该片段不算数，只剩一个片段 ⇒ 拒绝。 */
  const emptyPiece = validateWorkPlan(plan({
    mode: 'multi',
    tracks: [t('a')],
    singleTrackReason: 'same-file',
    singleTrackEvidence: { piecePaths: { p1: [''], p2: ['src/a/x.ts'] } },
  }))
  const good = validateWorkPlan(plan({
    mode: 'multi',
    tracks: [t('a')],
    singleTrackReason: 'same-file',
    singleTrackEvidence: { piecePaths: { p1: ['src/a'], p2: ['src/a/x.ts'] } },
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
    singleTrackEvidence: { piecePaths: { '': ['src/a'], ' ': ['src/a/b.ts'] } },
  }))
  const dup = validateWorkPlan(plan({
    mode: 'multi', tracks: [t('a')], singleTrackReason: 'same-file',
    singleTrackEvidence: { piecePaths: { p1: ['src/a'], ' p1\u200b': ['src/a/b.ts'] } },
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
    singleTrackEvidence: { orderedSteps: ['', ''] },
  }))
  const dup = validateWorkPlan(plan({
    mode: 'multi', tracks: [t('a')], singleTrackReason: 'strict-order',
    singleTrackEvidence: { orderedSteps: ['a', 'a'] },
  }))
  const real = validateWorkPlan(plan({
    mode: 'multi', tracks: [t('a')], singleTrackReason: 'strict-order',
    singleTrackEvidence: { orderedSteps: ['a', 'b'] },
  }))
  if (!blank.ok && !dup.ok && real.ok) {
    ok('WM-23 ✓ strict-order 只认 ≥2 个非空且互不相同的子步骤；空白/重复都不算')
  } else bad(`WM-23 · blank=${JSON.stringify(blank.problems)} dup=${JSON.stringify(dup.problems)} real=${JSON.stringify(real.problems)}`)
}

// WM-24 旧的自述式证据字段不能单独成立（必须给片段→路径）
{
  const oldForm = validateWorkPlan(plan({
    mode: 'multi', tracks: [t('a')], singleTrackReason: 'same-file',
    singleTrackEvidence: { mergedPieces: ['p1', 'p2'], sharedPaths: ['src/a', 'src/a/b.ts'] },
  }))
  const real = validateWorkPlan(plan({
    mode: 'multi', tracks: [t('a')], singleTrackReason: 'same-file',
    singleTrackEvidence: { piecePaths: { p1: ['src/a'], p2: ['src/a/b.ts'] } },
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
    singleTrackEvidence: { piecePaths: { p1: ['src/shared/w.ts'], ['p1' + ch]: ['src/shared/w.ts'] } },
  })))
  const stepHits = invisibles.map((ch) => validateWorkPlan(plan({
    mode: 'multi', tracks: [t('a')], singleTrackReason: 'strict-order',
    singleTrackEvidence: { orderedSteps: ['a', 'a' + ch] },
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
      singleTrackEvidence: { piecePaths: ['src/a', 'src/b'] },
    }))],
    ['piecePaths 是字符串', validateWorkPlan(plan({
      mode: 'multi', tracks: [t('a')], singleTrackReason: 'same-file',
      singleTrackEvidence: { piecePaths: 'src/a' },
    }))],
    ['piecePaths 值不是数组', validateWorkPlan(plan({
      mode: 'multi', tracks: [t('a')], singleTrackReason: 'same-file',
      singleTrackEvidence: { piecePaths: { p1: 'src/a', p2: ['src/a'] } },
    }))],
    ['orderedSteps 是字符串', validateWorkPlan(plan({
      mode: 'multi', tracks: [t('a')], singleTrackReason: 'strict-order',
      singleTrackEvidence: { orderedSteps: 'a,b' },
    }))],
    ['orderedSteps 是对象', validateWorkPlan(plan({
      mode: 'multi', tracks: [t('a')], singleTrackReason: 'strict-order',
      singleTrackEvidence: { orderedSteps: { a: 1 } },
    }))],
    ['orderedSteps 含非字符串', validateWorkPlan(plan({
      mode: 'multi', tracks: [t('a')], singleTrackReason: 'strict-order',
      singleTrackEvidence: { orderedSteps: ['a', 3] },
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
    singleTrackEvidence: { piecePaths: { [a]: ['src/shared/w.ts'], [b]: ['src/shared/w.ts'] } },
  })))
  const distinct = validateWorkPlan(plan({
    mode: 'multi', tracks: [t('a')], singleTrackReason: 'same-file',
    singleTrackEvidence: { piecePaths: { parser: ['src/shared/w.ts'], writer: ['src/shared/w.ts'] } },
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
        singleTrackEvidence: { piecePaths: { [n1]: [a], [n2]: [b] } },
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

console.log(`\n工作计划：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处`
  + (fail > 0 ? ` · 没过 ${fail} 处` : '')
  + ' · 跳过 0 处')
process.exitCode = fail > 0 ? 1 : 0
