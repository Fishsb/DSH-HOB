#!/usr/bin/env node
/**
 * **执行态（第 4 步子项）· 服务端行为判据**（2026-10-30 · 第 17 轮 · 任务书 §三3）。
 *
 * ══ 它为什么存在 ═══════════════════════════════════════════════════════════
 *   任务书 §一B 把线格式定成**封闭集**（九态 · 四个字段 · 三类可分辨失败）。
 *   "源码里有那九个词"证明不了这些 —— 只有**真跑一遍真处理体**才行。
 *   ⇒ 本脚本 import `src/shared/exec-progress.ts` 的**真源码**（用 `ts-mount` 转译），
 *     喂**真夹具**跑各种情形。⛔ 不复制一份逻辑来测。
 *
 * ══ 判据（每条都能独立失败）════════════════════════════════════════════════
 *   E-0  转译图自证（`ts-mount` 的 `verifyMounted`）
 *   E-1  **正常**：三条记录（pending/lost/closed）⇒ `ok:true`、`source` 逐字、`readAt` 是 ISO、
 *        `items` 顺序原样、`state` 落九态、`target` 是短标签
 *   E-2  **零条** ⇒ `ok:true` + `items: []`（⚠ 空 ≠ 判不出）
 *   E-3  **账本根判不出** ⇒ `ok:false` + `reason === 'ledger-unreadable'`
 *   E-4  **文件不存在** ⇒ `reason === 'state-missing'`（与 E-3 **不同值**）
 *   E-5  **JSON 坏** ⇒ `reason === 'row-shape-unknown'`（与上两者都不同）
 *   E-5b **三类 reason 互不相同**（一条断言把三个值摆在一起比）
 *   E-6  **九态封闭集**：一堆脏 `settleState`/时刻组合，落点只可能是那九个值
 *   E-7  **`elapsedMs` 判不出 ⇒ 缺字段**（⛔ 不许是 `0`）—— 且"真开跑过"那条**必须有数**
 *   E-7b **负向对拍**：把 `elapsedMs` 的判空改成 `?? 0` ⇒ E-7 **必红**
 *   E-8  **路由路径单一真源**：`shared/exec-protocol.ts` 与客户端常量逐字一致
 *   E-9  **九态措辞单一真源**：`EXEC_STATE_LABELS` == `DISPATCH_STATE_LABELS`（逐键逐值）
 *   E-10 **`rechecks` 缺字段读 0**（那是"没重核过"，如实）
 *
 * 用法：node scripts/check-exec-progress.mjs   （或 npm run check:exec-progress）
 * 退出码：0 = 全通过；1 = 有失败；2 = 依赖不可用（⛔ 不算通过）
 * ⚠ 零第三方依赖（`ts-mount` 只用仓内 `typescript`）。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const ENTRY = 'src/shared/exec-progress.ts'
  /**
   * ⚠ **路径带 pid**（B4.2 · 2026-11-10）：改前是固定名 ⇒ 两个自检进程并发跑会互相
   *   `rmSync` 掉对方正在用的目录（实测：`check:stages-panel-dom` / `check:preset-contracts`
   *   并发跑必红、串行跑必绿）。⚠ 这类「串行绿、并发红」的假失败会让人误判成真缺陷。
   *   ⇒ 带 `process.pid` 后互不干扰；`.gitignore` 的 `.check-*-work/` 通配仍覆盖它们。
   */
const work = join(root, '.check-exec-progress-work-' + process.pid)

let pass = 0
let fail = 0
const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail++; console.log(`  ✗ ${m}`) }
const cleanup = () => { try { rmSync(work, { recursive: true, force: true }) } catch { /* 忽略 */ } }

rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })

console.log('')
console.log('E 组：执行态（第 4 步子项）· 服务端行为判据（真处理体 + 真夹具）')
console.log('')

try {
  // ══════════════════════════════════════════════════════════════════════
  // E-0 转译（复用 ts-mount 并自证）
  // ══════════════════════════════════════════════════════════════════════
  const tsPath = join(root, 'node_modules', 'typescript', 'lib', 'typescript.js')
  const ts = (await import(pathToFileURL(tsPath).href)).default
  const tsMount = await import('./ts-mount.mjs')
  const ENTRIES = [ENTRY, 'src/shared/exec-protocol.ts']
  const graph = tsMount.mountTsGraph({ root, outDir: join(work, 'out'), entries: ENTRIES, ts })
  const problems = [
    ...graph.problems,
    ...tsMount.verifyMounted({ root, entries: ENTRIES, mounted: graph.mounted, entryFiles: graph.entries }),
  ]
  if (problems.length > 0) {
    for (const p of problems) bad(`E-0 转译/自证失败：${p}`)
  } else {
    ok(`E-0 ✓ 转译图自证通过（${graph.mounted.join(' · ')}）`)
  }
  const entryOut = graph.entries[ENTRY]
  if (entryOut === undefined) throw new Error('入口没有产出（见 E-0）')
  const entryFile = join(work, 'entry.mjs')
  writeFileSync(entryFile, `export * from ${JSON.stringify(entryOut)}\n`)
  const mod = await import(pathToFileURL(entryFile).href)

  const protoPath = graph.entries['src/shared/exec-protocol.ts']
  let proto
  if (protoPath === undefined) {
    bad('E-0b 转译图里**没有** `src/shared/exec-protocol.ts` ⇒ 线协议没被真正加载')
    proto = undefined
  } else {
    const pf = join(work, 'proto.mjs')
    writeFileSync(pf, `export * from ${JSON.stringify(protoPath)}\n`)
    proto = await import(pathToFileURL(pf).href)
    ok('E-0b ✓ 线协议层（`exec-protocol.ts`）在转译图内 —— 客户端与服务端共用同一份值域')
  }

  const FIXED_NOW = new Date('2026-10-30T00:00:00.000Z')
  const NOW_MS = FIXED_NOW.getTime()
  /** 造依赖：`readText` 从给定字符串返回（`undefined` = 文件不存在）。 */
  const deps = (opts = {}) => ({
    ledgerRootOf: opts.rootFn ?? (() => '/fix'),
    ledgerRootWhyOf: opts.whyFn ?? (() => '夹具：给了根'),
    stateFileOf: () => '/fix/runtime/orch-watches.json',
    readText: opts.readText ?? (() => undefined),
    now: () => FIXED_NOW,
  })

  // ── E-1 正常：三类记录各一条 ─────────────────────────────────────────
  {
    const state = {
      version: 1,
      updatedAt: NOW_MS - 1000,
      // 在跑的活：见过 running，10 分钟前开跑
      pending: [{ target: 'session-aaaaaaaa-1111', at: NOW_MS - 700000, sawRunning: true, sawRunningAt: NOW_MS - 600000, recheckCount: 2 }],
      // 判丢的活：卡住
      lost: [{ target: 'session-bbbbbbbb-2222', at: NOW_MS - 900000, sawRunning: true, settleState: 'stuck', recheckCount: 3 }],
      // 已结算：回执已到
      closed: [{ target: 'session-cccccccc-3333', at: NOW_MS - 950000, sawRunning: true, sawRunningAt: NOW_MS - 900000, deliveredAt: NOW_MS - 800000 }],
      handoffs: [],
      sessions: [],
    }
    const res = mod.handleExecProgress(deps({ readText: () => JSON.stringify(state) }), { sessionId: 's-1' })
    const probs = []
    if (res.ok !== true) probs.push(`ok 不是 true（${JSON.stringify(res)}）`)
    else {
      if (res.source !== 'runtime/orch-watches.json') probs.push(`source 不是逐字 'runtime/orch-watches.json'：${JSON.stringify(res.source)}`)
      if (typeof res.readAt !== 'string' || Number.isNaN(Date.parse(res.readAt))) probs.push(`readAt 不是 ISO：${JSON.stringify(res.readAt)}`)
      if (!Array.isArray(res.items) || res.items.length !== 3) probs.push(`items 不是 3 条：${JSON.stringify(res.items?.length)}`)
      else {
        const targets = res.items.map((x) => x.target)
        /**
         * ⚠ 2026-10-30 第 20 轮：排序口径改了（任务书 §一3）——
         *   「现在」档整体在前；同档内 `running` 前、`stuck` 后。
         *   ⇒ 期望序 = aaaaaaaa(now/running) → cccccccc(history/returned) → bbbbbbbb(history/stuck)。
         */
        const want = ['aaaaaaaa', 'cccccccc', 'bbbbbbbb']
        if (JSON.stringify(targets) !== JSON.stringify(want)) probs.push(`target 短标签/顺序不对：${JSON.stringify(targets)}（期望 ${JSON.stringify(want)}）`)
        const states = res.items.map((x) => x.state)
        if (JSON.stringify(states) !== JSON.stringify(['running', 'returned', 'stuck'])) probs.push(`九态映射不对：${JSON.stringify(states)}（期望 ["running","returned","stuck"]）`)
        const buckets = res.items.map((x) => x.bucket)
        if (JSON.stringify(buckets) !== JSON.stringify(['now', 'history', 'history'])) probs.push(`分档不对：${JSON.stringify(buckets)}（期望 ["now","history","history"]）`)
      }
    }
    if (probs.length === 0) ok('E-1 ✓ 正常三条（pending/lost/closed）⇒ ok:true · source 逐字 · readAt 是 ISO · 顺序原样 · 九态映射对')
    else for (const p of probs) bad(`E-1 · ${p}`)
  }

  // ── E-2 零条 ⇒ ok:true + items:[] ────────────────────────────────────
  {
    const state = { version: 1, updatedAt: NOW_MS, pending: [], lost: [], closed: [], handoffs: [], sessions: [] }
    const res = mod.handleExecProgress(deps({ readText: () => JSON.stringify(state) }), {})
    if (res.ok === true && Array.isArray(res.items) && res.items.length === 0) {
      ok('E-2 ✓ 零条记录 ⇒ ok:true + items:[]（⚠ 空表不是失败、不是判不出）')
    } else {
      bad(`E-2 · 期望 ok:true + items:[]，实际 ${JSON.stringify({ ok: res.ok, n: res.items?.length, reason: res.reason })}`)
    }
  }

  // ── E-3/4/5 三类失败可分辨 ───────────────────────────────────────────
  const reasonOf = (d) => {
    const r = mod.handleExecProgress(d, { sessionId: 's' })
    return { ok: r.ok, reason: r.reason, message: r.message }
  }
  const rUnreadable = reasonOf(deps({ rootFn: () => undefined, whyFn: () => '夹具：判不出根' }))
  const rMissing = reasonOf(deps({ readText: () => undefined }))
  const rUnknown = reasonOf(deps({ readText: () => '{ 这不是 JSON' }))

  if (rUnreadable.ok === false && rUnreadable.reason === 'ledger-unreadable' && String(rUnreadable.message ?? '').includes('判不出')) {
    ok('E-3 ✓ 账本根判不出 ⇒ ok:false · reason=ledger-unreadable · message 明说"判不出"')
  } else bad(`E-3 · ${JSON.stringify(rUnreadable)}`)

  if (rMissing.ok === false && rMissing.reason === 'state-missing' && String(rMissing.message ?? '').includes(' orch-watches.json') === false) {
    // message 里含路径即可；这里只要求 reason 精确 + 提到"不存在"
    if (String(rMissing.message ?? '').includes('不存在')) ok('E-4 ✓ 运行态文件不存在 ⇒ reason=state-missing（与 ledger-unreadable 不同值）')
    else bad(`E-4 · state-missing 的 message 没提"不存在"：${JSON.stringify(rMissing.message)}`)
  } else if (rMissing.ok === false && rMissing.reason === 'state-missing') {
    ok('E-4 ✓ 运行态文件不存在 ⇒ reason=state-missing（与 ledger-unreadable 不同值）')
  } else bad(`E-4 · ${JSON.stringify(rMissing)}`)

  if (rUnknown.ok === false && rUnknown.reason === 'row-shape-unknown') {
    ok('E-5 ✓ JSON 坏 ⇒ reason=row-shape-unknown（与上两者都不同）')
  } else bad(`E-5 · ${JSON.stringify(rUnknown)}`)

  {
    const set = new Set([rUnreadable.reason, rMissing.reason, rUnknown.reason])
    if (set.size === 3) ok('E-5b ✓ 三类 reason 互不相同：ledger-unreadable / state-missing / row-shape-unknown')
    else bad(`E-5b · 三类 reason 有重复：${JSON.stringify([...set])}`)
  }

  // ── E-6 九态封闭集 ───────────────────────────────────────────────────
  {
    const NINE = proto?.EXEC_STATES ?? []
    if (NINE.length !== 9) {
      bad(`E-6 · 九态清单长度不是 9：${NINE.length}`)
    } else {
      /** 一堆脏组合：有的带各种时刻、有的什么都不带。 */
      const combos = [
        {}, { deliveredAt: 1 }, { sawRunning: true }, { clarifyAt: 1 }, { refusedAt: 1 },
        { acceptedAt: 1 }, { sentBackAt: 1 }, { settleState: 'stuck' }, { deliveryAttemptAt: 1 },
        { undeliveredAt: 1 }, { settleState: 'runner-up' }, { deliveredAt: '不是数' },
        { sawRunning: 'yes' }, { sentBackAt: 1, deliveredAt: 1 }, { settleState: 'stuck', deliveredAt: 1 },
      ]
      const seen = new Set()
      let oob = 0
      for (const c of combos) {
        const state = { version: 1, updatedAt: NOW_MS, pending: [{ target: 'session-zzzzzzzz-9', at: NOW_MS - 1000, ...c }], lost: [], closed: [], handoffs: [], sessions: [] }
        const r = mod.handleExecProgress(deps({ readText: () => JSON.stringify(state) }), {})
        // ⚠ 两种合法结局：ok:true 且 state 在九态内；或 row-shape-unknown（形态不认识）
        if (r.ok === true) {
          for (const it of r.items) {
            seen.add(it.state)
            if (!NINE.includes(it.state)) oob += 1
          }
        } else if (r.reason !== 'row-shape-unknown') {
          oob += 1
        }
      }
      if (oob === 0 && seen.size >= 5) {
        ok(`E-6 ✓ 九态封闭集：${combos.length} 组脏输入落点全在九态内（实测覆盖 ${seen.size} 态：${[...seen].join(' / ')}）`)
      } else {
        bad(`E-6 · 越界 ${oob} 次，覆盖 ${seen.size} 态（期望 0 / ≥5）`)
      }
    }
  }

  // ── E-7 / E-7b `elapsedMs` 判不出不许变 0 ────────────────────────────
  {
    const NOT_STARTED = { version: 1, updatedAt: NOW_MS, pending: [{ target: 'session-dddddddd-4', at: NOW_MS - 1000 }], lost: [], closed: [], handoffs: [], sessions: [] }
    const STARTED = { version: 1, updatedAt: NOW_MS, pending: [{ target: 'session-eeeeeeee-5', at: NOW_MS - 1000, sawRunning: true, sawRunningAt: NOW_MS - 5000 }], lost: [], closed: [], handoffs: [], sessions: [] }
    const a = mod.handleExecProgress(deps({ readText: () => JSON.stringify(NOT_STARTED) }), {})
    const b = mod.handleExecProgress(deps({ readText: () => JSON.stringify(STARTED) }), {})
    const probs = []
    if (a.ok !== true || a.items.length !== 1) probs.push(`未开跑那条没读到：${JSON.stringify(a).slice(0, 120)}`)
    else if ('elapsedMs' in a.items[0]) probs.push(`未开跑那条**带了** elapsedMs = ${JSON.stringify(a.items[0].elapsedMs)}（应缺字段）`)
    if (b.ok !== true || b.items.length !== 1) probs.push(`开跑那条没读到：${JSON.stringify(b).slice(0, 120)}`)
    else if (typeof b.items[0].elapsedMs !== 'number') probs.push(`开跑那条**没有** elapsedMs（应 = 5000 左右）`)
    else if (b.items[0].elapsedMs !== 5000) probs.push(`开跑那条 elapsedMs = ${b.items[0].elapsedMs}（期望 5000）`)
    if (probs.length === 0) {
      ok('E-7 ✓ `elapsedMs` 判不出 ⇒ **缺这个字段**（⛔ 不是 0）；真开跑过 ⇒ 有数（5000ms 精确对上）')
    } else for (const p of probs) bad(`E-7 · ${p}`)
  }
  {
    /**
     * E-7b **负向对拍**：把"判不出 ⇒ 不填"改成"判不出 ⇒ 填 0"，E-7 那条断言必须变红。
     * ⚠ 做法：把 `src/` 整棵**复制**到工作目录，只在副本里改那一行，再转译副本
     *   （⛔ 绝不改盘上源码 —— `ts-mount` 没有 overlay 选项，只能靠复制）。
     */
    const { cpSync } = await import('node:fs')
    const mutRoot = join(work, 'mutroot')
    cpSync(join(root, 'src'), join(mutRoot, 'src'), { recursive: true })
    const mutFile = join(mutRoot, 'src/shared/exec-progress.ts')
    const orig = readFileSync(mutFile, 'utf8')
    const mutated = orig.replace(
      'if (typeof prog?.ranMs === \'number\' && Number.isFinite(prog.ranMs)) item.elapsedMs = prog.ranMs',
      'item.elapsedMs = typeof prog?.ranMs === \'number\' && Number.isFinite(prog.ranMs) ? prog.ranMs : 0',
    )
    if (mutated === orig) {
      bad('E-7b · 负向对拍**没能改到**那行（锚点失配）⇒ 这条对拍本身失效')
    } else {
      writeFileSync(mutFile, mutated)
      const g2 = tsMount.mountTsGraph({ root: mutRoot, outDir: join(work, 'out-mut'), entries: [ENTRY], ts })
      const out2 = g2.entries[ENTRY]
      if (out2 === undefined) {
        bad(`E-7b · 副本转译失败：${g2.problems.join(' / ')}`)
      } else {
        const f2 = join(work, 'entry-mut.mjs')
        writeFileSync(f2, `export * from ${JSON.stringify(out2)}\n`)
        const mod2 = await import(pathToFileURL(f2).href)
        const NOT_STARTED = { version: 1, updatedAt: NOW_MS, pending: [{ target: 'session-dddddddd-4', at: NOW_MS - 1000 }], lost: [], closed: [], handoffs: [], sessions: [] }
        const r2 = mod2.handleExecProgress(deps({ readText: () => JSON.stringify(NOT_STARTED) }), {})
        const gotZero = r2.ok === true && r2.items.length === 1 && r2.items[0].elapsedMs === 0
        if (gotZero) {
          ok('E-7b ✓ 负向对拍（`?? 0` 版）⇒ E-7 的"缺字段"断言**确实会红**（实测到那个 0 出现了）')
        } else {
          bad(`E-7b · 负向对拍没有复现出 0：${JSON.stringify(r2).slice(0, 160)}`)
        }
      }
    }
  }

  // ── E-8 路径单一真源（协议层 == 客户端常量）──────────────────────────
  {
    const clientSrc = readFileSync(join(root, 'src/client/project-panel.tsx'), 'utf8')
    const routeSrc = readFileSync(join(root, 'src/modules/exec-progress-route.ts'), 'utf8')
    const p = proto?.EXEC_PROGRESS_ROUTE_PATH
    const probs = []
    if (typeof p !== 'string' || p !== '/api/dsh-hob/exec-progress') probs.push(`协议层路径不是逐字 '/api/dsh-hob/exec-progress'：${JSON.stringify(p)}`)
    if (!clientSrc.includes("from '../shared/exec-protocol.ts'")) probs.push('客户端**没有**从 `exec-protocol.ts` 取路径')
    if (!routeSrc.includes("from '../shared/exec-protocol.ts'")) probs.push('路由**没有**从 `exec-protocol.ts` 取路径')
    // ⚠ 负向侧：两边都不许再各自写一份字面量
    if (/export const STAGES_EXEC_PATH = '\/api\//.test(clientSrc)) probs.push('客户端仍然自己写了一份路径字面量')
    if (/export const EXEC_PROGRESS_ROUTE_PATH = '\/api\//.test(routeSrc)) probs.push('路由仍然自己写了一份路径字面量')
    if (probs.length === 0) ok('E-8 ✓ 路由路径单一真源：协议层一份，客户端与宿主都从它取（两侧零字面量）')
    else for (const x of probs) bad(`E-8 · ${x}`)
  }

  // ── E-9 九态措辞单一真源（与 `DISPATCH_STATE_LABELS` 逐键逐值）────────
  {
    const serverSrc = readFileSync(join(root, 'src/server/orch-state.ts'), 'utf8')
    const block = serverSrc.slice(
      serverSrc.indexOf('export const DISPATCH_STATE_LABELS'),
      serverSrc.indexOf('} as const', serverSrc.indexOf('export const DISPATCH_STATE_LABELS')),
    )
    const pairs = [...block.matchAll(/'([a-z-]+)':\s*'([^']+)'/g)].map((m) => [m[1], m[2]])
    const labels = proto?.EXEC_STATE_LABELS ?? {}
    const probs = []
    if (pairs.length !== 9) probs.push(`从服务端解析到的键值不是 9 对：${pairs.length}`)
    for (const [k, v] of pairs) if (labels[k] !== v) probs.push(`\`${k}\` 措辞不一致：服务端 ${JSON.stringify(v)} vs 协议层 ${JSON.stringify(labels[k])}`)
    for (const k of Object.keys(labels)) if (!pairs.some(([kk]) => kk === k)) probs.push(`协议层多出键 \`${k}\``)
    if (probs.length === 0) ok(`E-9 ✓ 九态措辞与 \`DISPATCH_STATE_LABELS\` **逐键逐值相同**（${pairs.length} 对，⛔ 不是两份各写）`)
    else for (const x of probs) bad(`E-9 · ${x}`)
  }

  // ── E-10 `rechecks` 缺字段读 0 ────────────────────────────────────────
  {
    const state = { version: 1, updatedAt: NOW_MS, pending: [{ target: 'session-ffffffff-6', at: NOW_MS - 1000, sawRunning: true, sawRunningAt: NOW_MS - 1000 }], lost: [], closed: [], handoffs: [], sessions: [] }
    const r = mod.handleExecProgress(deps({ readText: () => JSON.stringify(state) }), {})
    if (r.ok === true && r.items.length === 1 && r.items[0].rechecks === 0) ok('E-10 ✓ `rechecks` 缺字段 ⇒ 0（"没重核过"，如实；⛔ 不是判不出）')
    else bad(`E-10 · 期望 rechecks=0，实际 ${JSON.stringify(r).slice(0, 140)}`)
  }

  // ── E-12（判据 A）分档：pending 只进「现在」，lost/closed 只进「历史」──────
  {
    const state = {
      version: 1, updatedAt: NOW_MS,
      pending: [{ target: 'session-now00001-1', at: NOW_MS - 5000, sawRunning: true, sawRunningAt: NOW_MS - 4000 }],
      lost: [{ target: 'session-lost0001-2', at: NOW_MS - 900000, sawRunning: true, settleState: 'stuck' }],
      closed: [{ target: 'session-closed01-3', at: NOW_MS - 950000, sawRunning: true, deliveredAt: NOW_MS - 800000 }],
      handoffs: [], sessions: [],
    }
    const res = mod.handleExecProgress(deps({ readText: () => JSON.stringify(state) }), {})
    const probs = []
    if (res.ok !== true) probs.push(`ok 不是 true：${JSON.stringify(res).slice(0, 120)}`)
    else {
      const byTarget = new Map(res.items.map((x) => [x.target, x]))
      const n = byTarget.get('now00001')
      const l = byTarget.get('lost0001')
      const c = byTarget.get('closed01')
      if (n === undefined || n.bucket !== 'now') probs.push(`pending 那条不在「现在」档：${JSON.stringify(n)}`)
      if (l === undefined || l.bucket !== 'history') probs.push(`lost 那条不在「历史」档：${JSON.stringify(l)}`)
      if (c === undefined || c.bucket !== 'history') probs.push(`closed 那条不在「历史」档：${JSON.stringify(c)}`)
      // ⚠ 交叉出现即红：现在档里不许出现来自 lost/closed 的 target
      const nowTargets = res.items.filter((x) => x.bucket === 'now').map((x) => x.target)
      if (nowTargets.includes('lost0001') || nowTargets.includes('closed01')) probs.push(`「现在」档里混进了历史记录：${JSON.stringify(nowTargets)}`)
      // ⚠ 排序：现在档整体在前
      const firstHistory = res.items.findIndex((x) => x.bucket === 'history')
      const lastNow = res.items.map((x) => x.bucket).lastIndexOf('now')
      if (firstHistory !== -1 && lastNow > firstHistory) probs.push('「现在」档没有整体排在「历史」档之前')
    }
    if (probs.length === 0) ok('E-12 ✓ 判据A 分档：pending⇒「现在」· lost/closed⇒「历史」· 零交叉 · 现在档整体在前')
    else for (const x of probs) bad(`E-12 · ${x}`)
  }

  // ── E-13（判据 B）同一 target 3 条 ⇒ 1 行 + count=3 ─────────────────────
  {
    const state = {
      version: 1, updatedAt: NOW_MS,
      pending: [], lost: [], handoffs: [], sessions: [],
      closed: [
        { target: 'session-dupdup00-9', at: NOW_MS - 3000, sawRunning: true, deliveredAt: NOW_MS - 2000 },
        { target: 'session-dupdup00-9', at: NOW_MS - 2000, sawRunning: true, deliveredAt: NOW_MS - 1000 },
        { target: 'session-dupdup00-9', at: NOW_MS - 1000, sawRunning: true, acceptedAt: NOW_MS - 500 },
      ],
    }
    const res = mod.handleExecProgress(deps({ readText: () => JSON.stringify(state) }), {})
    const probs = []
    if (res.ok !== true) probs.push(`ok 不是 true：${JSON.stringify(res).slice(0, 120)}`)
    else {
      const rows = res.items.filter((x) => x.target === 'dupdup00')
      if (rows.length !== 1) probs.push(`同一 target 出了 ${rows.length} 行（期望 1）`)
      else {
        if (rows[0].count !== 3) probs.push(`count 不是 3：${JSON.stringify(rows[0].count)}`)
        // ⚠ 取**最新**那条：最新一条带 acceptedAt ⇒ 九态应为 accepted
        if (rows[0].state !== 'accepted') probs.push(`没有取最新状态：state=${JSON.stringify(rows[0].state)}（期望 accepted）`)
      }
      if (res.items.length !== 1) probs.push(`总行数 ${res.items.length}（期望 1）`)
    }
    if (probs.length === 0) ok('E-13 ✓ 判据B 按目标合并：3 条同 target ⇒ 1 行 · count=3 · 取最新那条的状态（accepted）')
    else for (const x of probs) bad(`E-13 · ${x}`)
  }

  // ── E-14（判据 C）无 ranMs 的非 pending 记录 ⇒ 展示词不含「执行中」──────
  {
    const state = {
      version: 1, updatedAt: NOW_MS,
      pending: [], lost: [], handoffs: [], sessions: [],
      // ⚠ 夹具要造出**九态=running 但无 ranMs** 的形态（真机那 22 行的样子）：
      //   sawRunning:true 且无 sawRunningAt ⇒ dispatchStateOf 给 'running'、dispatchProgressOf 给 ranMs=undefined；
      //   ⛔ 不能带 deliveredAt（那会映射成 'returned'，测的就不是这条判据了）。
      closed: [{ target: 'session-noran000-7', at: NOW_MS - 950000, sawRunning: true }],
    }
    const res = mod.handleExecProgress(deps({ readText: () => JSON.stringify(state) }), {})
    const probs = []
    if (res.ok !== true) probs.push(`ok 不是 true：${JSON.stringify(res).slice(0, 120)}`)
    else if (res.items.length !== 1) probs.push(`行数 ${res.items.length}（期望 1）`)
    else {
      const it = res.items[0]
      if ('elapsedMs' in it) probs.push(`没有 sawRunningAt 却带了 elapsedMs=${JSON.stringify(it.elapsedMs)}`)
      const label = proto.execDisplayLabel(it)
      if (label.includes('执行中')) probs.push(`展示词含「执行中」：${JSON.stringify(label)}（应改中性词）`)
      if (label !== '未开跑') probs.push(`展示词不是「未开跑」：${JSON.stringify(label)}`)
    }
    // ⚠ 对照：真在跑的（pending + ranMs）**必须**仍是「执行中」
    const state2 = {
      version: 1, updatedAt: NOW_MS,
      pending: [{ target: 'session-yesran00-8', at: NOW_MS - 9000, sawRunning: true, sawRunningAt: NOW_MS - 8000 }],
      lost: [], closed: [], handoffs: [], sessions: [],
    }
    const res2 = mod.handleExecProgress(deps({ readText: () => JSON.stringify(state2) }), {})
    if (res2.ok !== true || res2.items.length !== 1) probs.push('对照组（真在跑）读不到')
    else {
      const l2 = proto.execDisplayLabel(res2.items[0])
      if (l2 !== '执行中') probs.push(`对照组展示词不是「执行中」：${JSON.stringify(l2)}`)
    }
    if (probs.length === 0) ok('E-14 ✓ 判据C 无 ranMs 的非 pending ⇒ 展示词「未开跑」（⛔ 不含「执行中」）；真在跑的**仍是**「执行中」')
    else for (const x of probs) bad(`E-14 · ${x}`)
  }

  // ── E-12b（判据 E）负向对拍：去掉分档判断 ⇒ E-12 必红 ───────────────────
  {
    const { cpSync } = await import('node:fs')
    const mutRoot = join(work, 'mutroot-bucket')
    cpSync(join(root, 'src'), join(mutRoot, 'src'), { recursive: true })
    const mutFile = join(mutRoot, 'src/shared/exec-progress.ts')
    const orig = readFileSync(mutFile, 'utf8')
    // 把"按来源摞分档"改成"全归现在档" ⇒ pending/lost/closed 混在一起
    const mutated = orig.replace(
      "bucket: from === 'pending' ? 'now' : 'history',",
      "bucket: 'now',",
    )
    if (mutated === orig) {
      bad('E-12b · 负向对拍**没能改到**分档那行（锚点失配）⇒ 这条对拍本身失效')
    } else {
      writeFileSync(mutFile, mutated)
      const g2 = tsMount.mountTsGraph({ root: mutRoot, outDir: join(work, 'out-mut-bucket'), entries: ENTRIES, ts })
      const out2 = g2.entries[ENTRY]
      if (out2 === undefined) {
        bad(`E-12b · 副本转译失败：${g2.problems.join(' / ')}`)
      } else {
        const f2 = join(work, 'entry-mut-bucket.mjs')
        writeFileSync(f2, `export * from ${JSON.stringify(out2)}\n`)
        const mod2 = await import(pathToFileURL(f2).href)
        const state = {
          version: 1, updatedAt: NOW_MS,
          pending: [{ target: 'session-now00001-1', at: NOW_MS - 5000, sawRunning: true, sawRunningAt: NOW_MS - 4000 }],
          lost: [{ target: 'session-lost0001-2', at: NOW_MS - 900000, sawRunning: true, settleState: 'stuck' }],
          closed: [{ target: 'session-closed01-3', at: NOW_MS - 950000, sawRunning: true, deliveredAt: NOW_MS - 800000 }],
          handoffs: [], sessions: [],
        }
        const r = mod2.handleExecProgress(deps({ readText: () => JSON.stringify(state) }), {})
        const bad12 = r.ok !== true
          || r.items.find((x) => x.target === 'lost0001')?.bucket !== 'history'
          || r.items.find((x) => x.target === 'closed01')?.bucket !== 'history'
        if (bad12) ok('E-12b ✓ 负向对拍（全部归「现在」档）⇒ E-12 的分档断言**必红**')
        else bad('E-12b · 去掉分档后 E-12 仍通过 ⇒ 那条断言没有牙')
      }
    }
  }

  // ── E-13b（判据 E）负向对拍：去掉按 target 合并 ⇒ E-13 必红 ───────────────
  {
    const { cpSync } = await import('node:fs')
    const mutRoot = join(work, 'mutroot-merge')
    cpSync(join(root, 'src'), join(mutRoot, 'src'), { recursive: true })
    const mutFile = join(mutRoot, 'src/shared/exec-progress.ts')
    const orig = readFileSync(mutFile, 'utf8')
    // 把 key 里带上"记录序号" ⇒ 同一 target 不再合并
    const mutated = orig.replace(
      "const key = `${row.bucket}\\u0000${row.target}`",
      "const key = `${row.bucket}\\u0000${row.target}\\u0000${rows.indexOf(row)}`",
    )
    if (mutated === orig) {
      bad('E-13b · 负向对拍**没能改到**合并 key（锚点失配）⇒ 这条对拍本身失效')
    } else {
      writeFileSync(mutFile, mutated)
      const g2 = tsMount.mountTsGraph({ root: mutRoot, outDir: join(work, 'out-mut-merge'), entries: ENTRIES, ts })
      const out2 = g2.entries[ENTRY]
      if (out2 === undefined) {
        bad(`E-13b · 副本转译失败：${g2.problems.join(' / ')}`)
      } else {
        const f2 = join(work, 'entry-mut-merge.mjs')
        writeFileSync(f2, `export * from ${JSON.stringify(out2)}\n`)
        const mod2 = await import(pathToFileURL(f2).href)
        const state = {
          version: 1, updatedAt: NOW_MS, pending: [], lost: [], handoffs: [], sessions: [],
          closed: [
            { target: 'session-dupdup00-9', at: NOW_MS - 3000, sawRunning: true, deliveredAt: NOW_MS - 2000 },
            { target: 'session-dupdup00-9', at: NOW_MS - 2000, sawRunning: true, deliveredAt: NOW_MS - 1000 },
            { target: 'session-dupdup00-9', at: NOW_MS - 1000, sawRunning: true, acceptedAt: NOW_MS - 500 },
          ],
        }
        const r = mod2.handleExecProgress(deps({ readText: () => JSON.stringify(state) }), {})
        const rows = r.ok === true ? r.items.filter((x) => x.target === 'dupdup00') : []
        if (rows.length !== 1) ok(`E-13b ✓ 负向对拍（不合并）⇒ E-13 的"只出 1 行"**必红**：实际 ${rows.length} 行`)
        else bad('E-13b · 去掉合并后仍然只有 1 行 ⇒ 那条断言没有牙')
      }
    }
  }

  // ── E-15 合并行的 elapsedMs = **最长一次**（任务书 §一5：56h/67h 不许丢）────
  {
    const state = {
      version: 1, updatedAt: NOW_MS, pending: [], lost: [], handoffs: [], sessions: [],
      closed: [
        // ⚠ 最早那条开跑于 56 小时前（真机上就是用户点名要保住的那条），最新那条只有 1 秒
        { target: 'session-longest0-1', at: NOW_MS - 56 * 3600 * 1000, sawRunning: true, sawRunningAt: NOW_MS - 56 * 3600 * 1000, deliveredAt: NOW_MS - 50 * 3600 * 1000 },
        { target: 'session-longest0-1', at: NOW_MS - 1000, sawRunning: true, sawRunningAt: NOW_MS - 1000, acceptedAt: NOW_MS - 500 },
      ],
    }
    const res = mod.handleExecProgress(deps({ readText: () => JSON.stringify(state) }), {})
    const probs = []
    if (res.ok !== true || res.items.length !== 1) probs.push(`行数不是 1：${JSON.stringify(res).slice(0, 140)}`)
    else {
      const it = res.items[0]
      if (it.count !== 2) probs.push(`count 不是 2：${JSON.stringify(it.count)}`)
      if (it.state !== 'accepted') probs.push(`状态不是取最新那条（accepted）：${JSON.stringify(it.state)}`)
      const want = 56 * 3600 * 1000
      if (typeof it.elapsedMs !== 'number') probs.push('合并行没有 elapsedMs（应取最长那次）')
      else if (Math.abs(it.elapsedMs - want) > 5000) probs.push(`elapsedMs=${it.elapsedMs}（期望 ≈${want}，即 56 小时那次）`)
    }
    if (probs.length === 0) ok('E-15 ✓ 合并行 `elapsedMs` 取**最长一次**（56h 那条不丢）；状态仍取**最新**那条（accepted）')
    else for (const x of probs) bad(`E-15 · ${x}`)
  }

  // ── E-16 排序：现在档在前；同档 running 前、stuck 后 ────────────────────
  {
    const state = {
      version: 1, updatedAt: NOW_MS,
      pending: [
        { target: 'session-sortstuk-1', at: NOW_MS - 100, sawRunning: true, settleState: 'stuck' },
        { target: 'session-sortrun0-2', at: NOW_MS - 200, sawRunning: true, sawRunningAt: NOW_MS - 150 },
      ],
      lost: [{ target: 'session-sorthist-3', at: NOW_MS - 300, sawRunning: true, settleState: 'stuck' }],
      closed: [], handoffs: [], sessions: [],
    }
    const res = mod.handleExecProgress(deps({ readText: () => JSON.stringify(state) }), {})
    const probs = []
    if (res.ok !== true) probs.push(`ok 不是 true：${JSON.stringify(res).slice(0, 120)}`)
    else {
      const seq = res.items.map((x) => `${x.bucket}/${x.state}`)
      const want = ['now/running', 'now/stuck', 'history/stuck']
      if (JSON.stringify(seq) !== JSON.stringify(want)) probs.push(`排序不对：${JSON.stringify(seq)}（期望 ${JSON.stringify(want)}）`)
    }
    if (probs.length === 0) ok('E-16 ✓ 排序：现在档整体在前 · 同档内 running 前 / stuck 后')
    else for (const x of probs) bad(`E-16 · ${x}`)
  }

  // ── E-17（判据E）三组对照：now+running⇒执行中 / history+running+无⇒未开跑 / history+running+有⇒曾运行 ──
  {
    const cases = [
      ['现在档 running', { state: 'running', bucket: 'now', elapsedMs: 5000 }, '执行中'],
      ['历史档 running 无 elapsedMs', { state: 'running', bucket: 'history' }, '未开跑'],
      ['历史档 running 有 elapsedMs', { state: 'running', bucket: 'history', elapsedMs: 5000 }, '曾运行'],
      // ⚠ 对照四：非 running 的九态仍走九态原词（⛔ 不许被这条新规则波及）
      ['历史档 stuck', { state: 'stuck', bucket: 'history' }, '卡住'],
    ]
    const probs = []
    for (const [label, item, want] of cases) {
      const got = proto.execDisplayLabel(item)
      if (got !== want) probs.push(`${label} ⇒ ${JSON.stringify(got)}（期望 ${JSON.stringify(want)}）`)
    }
    if (probs.length === 0) ok('E-17 ✓ 判据E 三组对照齐：now+running⇒执行中 · history+running+无⇒未开跑 · history+running+有⇒**曾运行**（非 running 仍走九态原词）')
    else for (const x of probs) bad(`E-17 · ${x}`)
  }

  // ── E-18（判据F）消歧句里的 N = **未开跑条数**，⛔ 不是总条数 ─────────────
  {
    /**
     * 夹具：同一 target 共 3 条 —— **2 条从未进过运行态**（无 `sawRunningAt`）+ **1 条曾运行**。
     * ⇒ `count` 应为 3、`unrunCount` 应为 **2**，消歧句必须写「这 **2** 条」（⛔ 不是 3）。
     */
    const state = {
      version: 1, updatedAt: NOW_MS, pending: [], lost: [], handoffs: [], sessions: [],
      closed: [
        // ⚠ 最新那条（at 最大）也是"从未开跑"的 stuck ⇒ 代表行 state=stuck，
        //   这样夹具才真的是「卡住 · 未开跑 · 共 3 条」那个待消歧的形态。
        { target: 'session-mixed000-1', at: NOW_MS - 3000, sawRunning: true, settleState: 'stuck' },
        { target: 'session-mixed000-1', at: NOW_MS - 2000, sawRunning: true, sawRunningAt: NOW_MS - 1900, deliveredAt: NOW_MS - 1500 },
        { target: 'session-mixed000-1', at: NOW_MS - 1000, sawRunning: true, settleState: 'stuck' },
      ],
    }
    const res = mod.handleExecProgress(deps({ readText: () => JSON.stringify(state) }), {})
    const probs = []
    if (res.ok !== true || res.items.length !== 1) probs.push(`行数不是 1：${JSON.stringify(res).slice(0, 140)}`)
    else {
      const it = res.items[0]
      if (it.count !== 3) probs.push(`count 不是 3：${JSON.stringify(it.count)}`)
      // ⚠ 本条是本轮靶心：N 必须是未开跑条数（2），⛔ 不是总数（3）
      if (it.unrunCount !== 2) probs.push(`unrunCount 不是 2（未开跑条数）：${JSON.stringify(it.unrunCount)}`)
      const note = proto.execMergeNote(it)
      if (!/这\s*2\s*条/.test(note)) probs.push(`消歧句里的 N 不是 2：${JSON.stringify(note)}`)
      if (/这\s*3\s*条/.test(note)) probs.push(`消歧句写成了总条数 3（⛔ 本轮明令不许）：${JSON.stringify(note)}`)
      if (!note.includes('都没进过运行态')) probs.push(`消歧句缺"都没进过运行态"：${JSON.stringify(note)}`)
    }
    // ⚠ 对照：单条记录不拼消歧句（"这 1 条都没进过运行态"读起来别扭）
    const one = { version: 1, updatedAt: NOW_MS, pending: [], lost: [{ target: 'session-single00-2', at: NOW_MS - 1000, sawRunning: true, settleState: 'stuck' }], closed: [], handoffs: [], sessions: [] }
    const r1 = mod.handleExecProgress(deps({ readText: () => JSON.stringify(one) }), {})
    if (r1.ok === true && r1.items.length === 1 && proto.execMergeNote(r1.items[0]) !== '') probs.push('单条记录也拼了消歧句（应为空串）')
    if (probs.length === 0) ok('E-18 ✓ 判据F 消歧句 N = **未开跑条数 2**（⛔ 不是总条数 3）· 单条记录不拼该句')
    else for (const x of probs) bad(`E-18 · ${x}`)
  }

  // ── E-17b（判据E 负向对拍）改回旧口径（history 有 elapsedMs 仍写「执行中」）⇒ E-17 必红 ──
  {
    const { cpSync } = await import('node:fs')
    const mutRoot = join(work, 'mutroot-label')
    cpSync(join(root, 'src'), join(mutRoot, 'src'), { recursive: true })
    const mutFile = join(mutRoot, 'src/shared/exec-protocol.ts')
    const orig = readFileSync(mutFile, 'utf8')
    const mutated = orig.replace(
      "    return typeof item.elapsedMs === 'number' ? EXEC_LABEL_RAN_BEFORE : EXEC_LABEL_NOT_STARTED",
      "    return typeof item.elapsedMs === 'number' ? EXEC_STATE_LABELS.running : EXEC_LABEL_NOT_STARTED",
    )
    if (mutated === orig) {
      bad('E-17b · 负向对拍**没能改到**三档那一行（锚点失配）⇒ 这条对拍本身失效')
    } else {
      writeFileSync(mutFile, mutated)
      const g2 = tsMount.mountTsGraph({ root: mutRoot, outDir: join(work, 'out-mut-label'), entries: ENTRIES, ts })
      const out2 = g2.entries['src/shared/exec-protocol.ts']
      if (out2 === undefined) {
        bad(`E-17b · 副本转译失败：${g2.problems.join(' / ')}`)
      } else {
        const f2 = join(work, 'proto-mut.mjs')
        writeFileSync(f2, `export * from ${JSON.stringify(out2)}\n`)
        const proto2 = await import(pathToFileURL(f2).href)
        const got = proto2.execDisplayLabel({ state: 'running', bucket: 'history', elapsedMs: 5000 })
        if (got !== '曾运行') ok(`E-17b ✓ 负向对拍（改回旧口径）⇒ E-17 的"曾运行"断言**必红**：实际 ${JSON.stringify(got)}`)
        else bad('E-17b · 改回旧口径后仍是「曾运行」⇒ 那条断言没有牙')
      }
    }
  }

  // ── E-18b（判据F 负向对拍）把 N 写成总条数 ⇒ E-18 必红 ──────────────────
  {
    const { cpSync } = await import('node:fs')
    const mutRoot = join(work, 'mutroot-note')
    cpSync(join(root, 'src'), join(mutRoot, 'src'), { recursive: true })
    const mutFile = join(mutRoot, 'src/shared/exec-protocol.ts')
    const orig = readFileSync(mutFile, 'utf8')
    const mutated = orig.replace(
      '  return `（这 ${unrun} 条都没进过运行态）`',
      '  return `（这 ${count} 条都没进过运行态）`',
    )
    if (mutated === orig) {
      bad('E-18b · 负向对拍**没能改到**消歧句（锚点失配）⇒ 这条对拍本身失效')
    } else {
      writeFileSync(mutFile, mutated)
      const g2 = tsMount.mountTsGraph({ root: mutRoot, outDir: join(work, 'out-mut-note'), entries: ENTRIES, ts })
      const out2 = g2.entries['src/shared/exec-protocol.ts']
      if (out2 === undefined) {
        bad(`E-18b · 副本转译失败：${g2.problems.join(' / ')}`)
      } else {
        const f2 = join(work, 'proto-mut2.mjs')
        writeFileSync(f2, `export * from ${JSON.stringify(out2)}\n`)
        const proto2 = await import(pathToFileURL(f2).href)
        const note = proto2.execMergeNote({ count: 3, unrunCount: 2 })
        if (/这\s*3\s*条/.test(note)) ok(`E-18b ✓ 负向对拍（N 写成总数）⇒ E-18 的"N=2"断言**必红**：实际 ${JSON.stringify(note)}`)
        else bad(`E-18b · 改成总数后没印出 3：${JSON.stringify(note)}`)
      }
    }
  }

  // ── E-11 单条记录形态不认识 ⇒ row-shape-unknown（⛔ 不许静默丢）────────
  {
    const state = { version: 1, updatedAt: NOW_MS, pending: [{ target: 'session-gggggggg-7', at: NOW_MS - 1000 }, { at: NOW_MS }], lost: [], closed: [], handoffs: [], sessions: [] }
    const r = mod.handleExecProgress(deps({ readText: () => JSON.stringify(state) }), {})
    if (r.ok === false && r.reason === 'row-shape-unknown' && String(r.message ?? '').includes('形态不认识')) {
      ok('E-11 ✓ 一条缺 `target` ⇒ reason=row-shape-unknown（⛔ 不静默丢一条继续报绿）')
    } else bad(`E-11 · ${JSON.stringify(r).slice(0, 160)}`)
  }
} catch (e) {
  bad(`E 组**自身异常**（⛔ 不算通过）：${String(e?.stack ?? e)}`)
}

cleanup()

console.log('')
console.log(`E 组：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处 · **跳过 0 处**（⚠ 跳过**不计入通过**；依赖不可用走 \`exit 2\`）`)
console.log('')
if (fail === 0) {
  console.log('  ✅ E 组全绿（⚠ 真处理体 + 真夹具；真实宿主 HTTP 链路仍需重启后人工验）')
  process.exit(0)
} else {
  console.log('  ⛔ E 组有失败 —— 见上面逐条')
  process.exit(1)
}
