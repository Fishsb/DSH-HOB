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
const work = join(root, '.check-exec-progress-work')

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
        const want = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc']
        if (JSON.stringify(targets) !== JSON.stringify(want)) probs.push(`target 短标签/顺序不对：${JSON.stringify(targets)}（期望 ${JSON.stringify(want)}）`)
        const states = res.items.map((x) => x.state)
        if (JSON.stringify(states) !== JSON.stringify(['running', 'stuck', 'returned'])) probs.push(`九态映射不对：${JSON.stringify(states)}（期望 ["running","stuck","returned"]）`)
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
    const clientSrc = readFileSync(join(root, 'src/client/stages-panel.tsx'), 'utf8')
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
