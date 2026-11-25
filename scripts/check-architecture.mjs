#!/usr/bin/env node
/**
 * 架构纪律机检 —— 把「分层方向 / 无环 / 文件规模 / 单源权威」从**人的自觉**变成**断言**。
 *
 * ── 为什么需要它 ──────────────────────────────────────────────────────
 *   `check:modules`（`module-independence-probe.mjs`）只测**模块启停**：
 *   cordis 能否按 `modules.x` 开关装载、缺依赖时是否停在 PENDING。
 *   ⛔ 它**完全不看依赖方向** ⇒ 谁在 `shared/` 里写一句 `import ... from '../server/x'`，
 *   把 shared 变成有副作用的层，**没有任何判据会红**。
 *
 *   而本项目历史上最大的缺陷来源正是「同一事实两份实现」（REVIEW 的 R-02 就是它），
 *   而成因几乎总是「多了一个不该有的依赖方向」。⇒ 必须有机检。
 *
 * ── ⚠⚠ 本族守的是**跨层**，不是「shared 不许碰 node:」───────────────
 *   `src/shared/tasks-progress.ts` 确实 import 了 `node:fs`，那是**允许的**：
 *   它只被 server 侧消费，不进浏览器包（实测：从 client 出发的可达性分析，
 *   走不到任何 `node:` 内置 = 0 处）。
 *   ⛔ 不要"顺手"把它判成违规 —— 那会把一条正确设计逼成误报。
 *   真正要守的是：**shared 不许反向依赖 server/modules/preset/client**。
 *
 * ── 四组断言 ──────────────────────────────────────────────────────────
 *   A 分层方向：A1 shared 零反向依赖 · A2 client 不碰 server/modules · A3 server 不碰 client
 *   B 循环依赖：B1 import 图零环（⚠ DFS 找环，不是"看起来像"）
 *   C 文件规模：C1 单文件行数**只准降不准升**（登记表 FILE_CEILINGS，零余量）
 *   D 单源权威：D1 关键判据在全仓**只有一处定义**；D2 其余位置只许**转接**
 *
 * ── 口径（⚠ 改本文件前先读完）──────────────────────────────────────────
 *   · 依赖边 = **静态 `import ... from '...'` 与 `export ... from '...'`** 的**相对路径**；
 *     `import type` **也算一条边**（类型环同样让分层失真，且会绕开 lint）；
 *     ⛔ 不解析动态 `import()`：本仓 `src/**` 实测 0 处，若将来出现须在此登记。
 *   · 剥离注释/字符串用**逐字符状态机**（仓内纪律：不用正则处理字符串本身）。
 *   · 每条断言**自带负向对拍**（M-1 元规则）：造一个必错变体，断言必须被咬住。
 *
 * 用法：node scripts/check-architecture.mjs
 * 退出码：0 = 全通过；1 = 有违规；2 = 基准缺失（⚠ 不算通过）
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const SRC = join(root, 'src')

const fail = []
const note = []
const skip = []
const bad = (m) => fail.push(m)
const ok = (m) => note.push(m)
const noteSkip = (m) => skip.push(m)

/** 退出码 2：基准缺失（⛔ 不是通过）。 */
function noBaseline(m) {
  console.log('')
  console.log('  ✗ ' + m)
  console.log('')
  console.log('判定：NO-BASELINE（exit 2）—— 基准缺失，本次**未测到任何东西**（⛔ 不是通过）')
  process.exit(2)
}

if (!existsSync(SRC)) noBaseline('读不到 ' + SRC)

/**
 * ── 逐字符剥离器：注释 + 字符串 + 模板串 ⇒ 只留**可执行代码** ──────────
 *   ⚠ 保留换行与列位置，便于报行号。
 *   ⚠ 已知边界（如实声明）：正则字面量 `/…/` 不单独识别，按除法处理
 *     （与 `check-client-deps.mjs` 同一边界；本仓 src/** 现无这类正则）。
 */
function stripNonCode(text) {
  const out = []
  let i = 0
  const n = text.length
  let mode = 'code'
  let quote = ''
  while (i < n) {
    const c = text[i]
    const c2 = text[i + 1]
    if (mode === 'code') {
      if (c === '/' && c2 === '/') { mode = 'line'; out.push(' ', ' '); i += 2; continue }
      if (c === '/' && c2 === '*') { mode = 'block'; out.push(' ', ' '); i += 2; continue }
      if (c === "'" || c === '"' || c === '`') { mode = 'str'; quote = c; out.push(' '); i += 1; continue }
      out.push(c); i += 1; continue
    }
    if (mode === 'line') {
      if (c === String.fromCharCode(10)) { mode = 'code'; out.push(c) } else out.push(' ')
      i += 1; continue
    }
    if (mode === 'block') {
      if (c === '*' && c2 === '/') { mode = 'code'; out.push(' ', ' '); i += 2; continue }
      out.push(c === String.fromCharCode(10) ? c : ' '); i += 1; continue
    }
    /** mode === 'str' */
    if (c === String.fromCharCode(92)) { out.push(' ', ' '); i += 2; continue }
    if (c === quote) { mode = 'code'; out.push(' '); i += 1; continue }
    out.push(c === String.fromCharCode(10) ? c : ' '); i += 1; continue
  }
  return out.join('')
}

/** 递归收集 src 下全部 .ts/.tsx。 */
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx)$/.test(name)) acc.push(p)
  }
  return acc
}

const FILES = walk(SRC)
if (FILES.length === 0) noBaseline('src/ 下一个 .ts/.tsx 都没有（基准缺失）')

/** 把绝对路径规整成 `shared/xxx.ts` 这种仓内相对名（报错用）。 */
const rel = (abs) => relative(SRC, abs).split(sep).join('/')
/** 顶层层名：shared / server / modules / preset / client（src 根下四个文件算 'root'）。 */
const layerOf = (abs) => {
  const r = rel(abs)
  const i = r.indexOf('/')
  return i < 0 ? 'root' : r.slice(0, i)
}

/**
 * 解析一条 import/export-from 的模块说明符 ⇒ 仓库内绝对路径（解析不到 ⇒ undefined）。
 *   ⚠ 只处理相对路径；`node:` / 包名一律返回 undefined（外部依赖，不构成层内边）。
 */
function resolveSpec(fromAbs, spec) {
  if (!spec.startsWith('.')) return undefined
  const base = resolve(dirname(fromAbs), spec)
  const cands = [base, base + '.ts', base + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx')]
  for (const c of cands) {
    if (existsSync(c) && statSync(c).isFile()) return c
  }
  return undefined
}

/**
 * 从剥离后的代码里取全部 `from '<spec>'`（import / export-from 都算）。
 *   ⚠ 剥离器把字符串内容抹成空格了，所以**必须从原文取 spec** ⇒ 两遍扫：
 *     先在原文里找 `from` 后紧跟的引号串，再用剥离后的文本确认它**不在注释里**。
 */
function edgesOf(abs) {
  const raw = readFileSync(abs, 'utf8')
  const code = stripNonCode(raw)
  const edges = []
  /** 在原文里扫 from 子句，逐条用 code 的同位置校验"这里确实是代码"。 */
  const re = /\bfrom\s*(['"])([^'"]+)\1/g
  let m
  while ((m = re.exec(raw)) !== null) {
    const at = m.index
    /** 剥离后该位置应是空白（原字符串位置被抹掉）—— 用 from 关键字位置判断更稳。 */
    const kw = raw.indexOf('from', at)
    if (kw < 0) continue
    if (code.slice(kw, kw + 4) !== 'from') continue
    const spec = m[2]
    const target = resolveSpec(abs, spec)
    if (target !== undefined) edges.push({ spec, target, line: lineOf(raw, at) })
  }
  return edges
}

function lineOf(text, at) {
  let line = 1
  for (let i = 0; i < at && i < text.length; i++) if (text[i] === String.fromCharCode(10)) line++
  return line
}

const EDGES = new Map()
for (const f of FILES) EDGES.set(f, edgesOf(f))
// ══════════════════════════════════════════════════════════════════════════
// A 组 · 分层方向
// ══════════════════════════════════════════════════════════════════════════
/**
 * 允许的跨层方向（只列**允许**，其余一律不许 —— 白名单比黑名单少漂移）。
 *
 * ⚠⚠ **`root` 为什么对每一层都开放（2026-11-11 实测后订正）** ──────────────────
 *   `src/` 根下只有 4 个文件：`index.ts`（入口）· `config.ts`（配置契约）·
 *   `model-selection.ts` · `session-policy-service.ts`。
 *   实测 `modules/` 有 **16 处**引用它们，形态全是 `import { X } from '../config.ts'`：
 *   `config.ts` 是**全层共用的契约面**（服务名常量 / 配置 schema），
 *   把它判成"模块反向依赖入口"是**判据的误报**，不是代码的问题。
 *   ⇒ 本族把 `root` 当**公共契约层**（与 `shared` 同级），⛔ 不要"顺手收紧"。
 *   ⚠ 真要收紧，得先把契约常量搬进 `shared/`；那是独立改动，⛔ 不在本族里做。
 *
 * ⚠⚠ **`preset` 为什么可以依赖 `modules`（2026-11-11 实测后订正）** ──────────────
 *   `src/preset/tools.ts` 对 `modules/{tools,bus,orchestrator}.ts` 用的是
 *   `import * as toolsFace from '../modules/tools.ts'` —— **命名空间导入**，
 *   目的是**缺模块时可降级**（`DEGRADED_CAPABILITIES` 逐条 `warn` + `diag`）。
 *   文件里明写「⚠ 必须用命名空间导入，⛔ 不许写具名导入」（`TASK-D2`）。
 *   ⇒ 这是**装配层的依赖注入**，不是"preset 复用 modules 的业务逻辑"。
 *     判成违规会把一条有意的设计逼成误报。
 *   ⚠ 真正要守的仍是：`modules` 不许反向依赖 `preset`（那条**没有**豁免）。
 */
const ALLOWED = new Map([
  ['shared', new Set(['root'])],
  ['server', new Set(['shared', 'root'])],
  ['preset', new Set(['shared', 'server', 'modules', 'root'])],
  ['modules', new Set(['shared', 'server', 'preset', 'root'])],
  ['client', new Set(['shared', 'root'])],
  ['root', new Set(['shared', 'server', 'preset', 'modules', 'client', 'root'])],
])

{
  const violations = []
  for (const [from, edges] of EDGES) {
    const fromLayer = layerOf(from)
    const allowed = ALLOWED.get(fromLayer)
    if (allowed === undefined) continue
    for (const e of edges) {
      const toLayer = layerOf(e.target)
      if (toLayer === fromLayer) continue
      if (allowed.has(toLayer)) continue
      violations.push(`${rel(from)}:${e.line} → ${rel(e.target)}`
        + `（${fromLayer} 不许依赖 ${toLayer}）`)
    }
  }
  if (violations.length === 0) {
    ok('A1-A3 ✓ 分层方向零违规：shared 无反向依赖 · client 不碰 server/modules · server 不碰 client')
  } else {
    for (const v of violations.slice(0, 8)) bad('A 分层违规 · ' + v)
    if (violations.length > 8) bad(`A 分层违规共 ${violations.length} 处（只列前 8 处）`)
  }

  /** ── A 的负向对拍：在内存里把一条合法边改成非法边，断言必须被咬住 ── */
  {
    const probe = (fromLayer, toLayer) => {
      const allowed = ALLOWED.get(fromLayer)
      return allowed === undefined ? false : !allowed.has(toLayer) && fromLayer !== toLayer
    }
    const sharedToServer = probe('shared', 'server')
    const clientToServer = probe('client', 'server')
    const clientToModules = probe('client', 'modules')
    const sharedToShared = probe('shared', 'shared')
    const okEdge = probe('modules', 'shared')
    const okRoot = probe('modules', 'root')
    const serverToModules = probe('server', 'modules')
    const sharedToPreset = probe('shared', 'preset')
    const presetToModules = probe('preset', 'modules')
    if (sharedToServer && clientToServer && clientToModules && serverToModules && sharedToPreset
      && sharedToShared === false && okEdge === false && okRoot === false
      && presetToModules === false) {
      ok('负向对拍 ✓ 分层判据有牙：shared→server / shared→preset / server→modules /'
        + ' client→server / client→modules 判违规；'
        + 'shared→shared / modules→shared / modules→root / preset→modules 判合法')
    } else {
      bad('负向对拍失败：分层判据**没有分辨力**（该拒的没拒 / 该放的没放）⇒ A 组是假绿')
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// B 组 · 循环依赖
// ══════════════════════════════════════════════════════════════════════════
/**
 * DFS 找环（三色标记）。返回**每条环一次**，已排序便于稳定输出。
 *   ⚠ 不豁免 `import type` 环：类型环同样让分层失真，且会绕开后续任何"只查运行时"的判据。
 */
function findCycles(edges) {
  const color = new Map()
  const stack = []
  const cycles = []
  const seenKey = new Set()
  const visit = (n) => {
    color.set(n, 1)
    stack.push(n)
    for (const e of edges.get(n) ?? []) {
      const d = e.target
      if (!edges.has(d)) continue
      const c = color.get(d) ?? 0
      if (c === 0) visit(d)
      else if (c === 1) {
        const i = stack.indexOf(d)
        if (i >= 0) {
          const cyc = stack.slice(i).concat(d)
          const key = cyc.slice().sort().join('|')
          if (!seenKey.has(key)) { seenKey.add(key); cycles.push(cyc) }
        }
      }
    }
    stack.pop()
    color.set(n, 2)
  }
  for (const n of edges.keys()) if ((color.get(n) ?? 0) === 0) visit(n)
  return cycles
}

{
  const cycles = findCycles(EDGES)
  if (cycles.length === 0) {
    ok(`B1 ✓ import 图零环（${EDGES.size} 个模块全扫）`)
  } else {
    for (const c of cycles.slice(0, 5)) bad('B 循环依赖 · ' + c.map(rel).join(' → '))
    if (cycles.length > 5) bad(`B 循环依赖共 ${cycles.length} 条（只列前 5 条）`)
  }

  /** ── B 的负向对拍：造一个最小三节点环，断言必须被咬住 ── */
  {
    const mk = (a, b) => new Map([
      [a, [{ target: b }]],
      [b, [{ target: a }]],
    ])
    const two = findCycles(mk('x.ts', 'y.ts'))
    const acyclic = findCycles(new Map([['x.ts', [{ target: 'y.ts' }]], ['y.ts', []]]))
    if (two.length > 0 && acyclic.length === 0) {
      ok('负向对拍 ✓ 环判据有牙：x→y→x 判出环，x→y（无环）判不出')
    } else {
      bad(`负向对拍失败：环判据**没有分辨力**（有环=${two.length}，无环=${acyclic.length}）⇒ B 组是假绿`)
    }
  }
}
// ══════════════════════════════════════════════════════════════════════════
// C 组 · 文件规模（只准降不准升）
// ══════════════════════════════════════════════════════════════════════════
/**
 * ── ⚠⚠ 登记表：每条都是**实测值**，零余量 ────────────────────────────────
 *   · 判据：该文件**不得高于**登记值；
 *   · **只准降不准升**：拆小了必须同批把这里改小；⛔ 不许为了"加点东西"抬它。
 *   · 为什么只登记这 8 个：低于 2000 行的文件不构成"逻辑无法独立推理"的问题。
 *   · ⚠ 登记值本身**不证明**这些文件健康 —— 它只保证"**不再更糟**"。
 */
/**
 * ⚠⚠ **`modules/orchestrator.ts` 为什么还没拆**（2026-11-11 实测，⛔ 不是没想过）
 *
 *   ```
 *   apply(ctx) 闭包      :2023 – :8828   6806 行 = 全文件 60%
 *   闭包内顶层声明       92 个
 *   共享度最高的 5 个     watches(84 处) agents(48) orch(45) wsRootOfSession(36) flushWatches(30)
 *   只被引用 ≤2 次的      26 个（候选）
 *   ```
 *
 *   ⇒ **拆分不是"搬文件"，是"解共享可变状态"**：`watches` 被 84 处引用，
 *     任何一刀都要先把这 5 个状态改成显式传参的 context 对象。
 *     那是一次**行为等价性重构**，`check:orch`（357 处断言）只能兜住已覆盖的行为。
 *
 *   ⚠ 本组现在的作用是**把上限钉死**：11347 行**只准降不准升**。
 *   ✅ **2026-11-11/12 已拆 11 个**（`orchestrator-phase-readings.ts`）：
 *      `readHandoffs` · `closedForTrack` · `abandonedSummary` · `closedPlanSummary`
 *      · `targetPresetOf` · `wsRootOfSession`（后两个需把服务对象当参数传入）
 *   ✅ **2026-11-12 再拆 4 个**：`stateFileForOwner`（两个解析器都当参数）·
 *      `messageTextOf` / `userReplyAfter` / `awaitingUserOf`（⚠ 后两者与闭包里同名，
 *      导入必须**用别名**，否则局部声明遮蔽导入 → 包装变成自引用死循环，实测踩过）
 *      —— 它们**零闭包状态依赖**，只依赖模块级导入 ⇒ 移动是行为等价的。
 *      实测 `check:orch` 357 处断言**修前修后逐条相同**（这是"没改坏"的证据）。
 *
 *   ⏳ **下一步可拆**：`planConflictProblems`（50 行）—— ⚠ 它依赖 `activePlansAt` /
 *      `occupyingTracksOfPlan` ⇒ 那条链扎进 `isStoppedFor`（13 处引用，闭包核心），
 *      要么把「占槽判定」当参数传入，要么与 ② 档（解 `watches`）同批做。
 *   ⛔ **不要先拆碰 `watches` 的**（84 处引用）：那需要先把共享状态改成显式 context，
 *      属行为等价性重构，风险与上面这一档**完全不同**。
 */
const FILE_CEILINGS = new Map([
  // ⚠ 2026-11-11：11347 → 11298（6 个无状态读数搬到 orchestrator-phase-readings.ts）
  // ⚠ 2026-11-12：11298 → 11252（再搬 stateFileForOwner / messageTextOf / userReplyAfter / awaitingUserOf）
  // ⚠ 2026-11-12 续：11252 → 11183（summarizePlan 搬出；WorkPlanTrackStatus/WorkPlanSummary 下沉到 shared/work-plan.ts）
  ['modules/orchestrator.ts', 11182],
  ['client/project-panel.tsx', 4307],
  // ⚠ 2026-11-11：3334 → 3122（派发读数下沉到 shared/dispatch-reading.ts，−212 行）
  ['server/orch-state.ts', 3122],
  ['server/card-wake.ts', 2929],
  ['modules/tools.ts', 2805],
  ['modules/bus.ts', 2271],
  ['server/hob-write.ts', 2268],
  ['preset/tools.ts', 2187],
])

{
  const over = []
  const improved = []
  for (const [name, ceil] of FILE_CEILINGS) {
    const abs = join(SRC, name)
    if (!existsSync(abs)) { over.push(`${name} 不存在了（⚠ 拆了/改名了 ⇒ 必须同批更新本表，⛔ 不许留着死条目）`); continue }
    /**
     * ⚠ **行数口径与 `wc -l` 一致**：`split` 出来的最后一段若为空串（文件以换行结尾），
     *   不计入行数。否则每个文件都比 `wc -l` 多 1，登记表会**永远差一**。
     */
    const chunks = readFileSync(abs, 'utf8').split(String.fromCharCode(10))
    const lines = chunks[chunks.length - 1] === '' ? chunks.length - 1 : chunks.length
    if (lines > ceil) over.push(`${name} = ${lines} 行 > 登记上限 ${ceil}（⛔ 只准降不准升）`)
    else if (lines < ceil) improved.push(`${name} ${ceil} → ${lines}`)
  }
  if (over.length === 0) {
    ok(`C1 ✓ ${FILE_CEILINGS.size} 个重点文件均**不超过**登记上限（只准降不准升）`)
  } else for (const o of over.slice(0, 6)) bad('C 规模 · ' + o)
  if (improved.length > 0) {
    noteSkip(`C 有 ${improved.length} 个文件已小于登记值（${improved.slice(0, 4).join(' · ')}）`
      + ' ⇒ ⚠ 请同批把 FILE_CEILINGS 改小（判据不会自己收窄）')
  }

  /** ── C 的负向对拍：判据函数用同一个比较式，造"超限"与"达标"两个值 ── */
  {
    const violates = (lines, ceil) => lines > ceil
    if (violates(100, 99) === true && violates(99, 99) === false) {
      ok('负向对拍 ✓ 规模判据有牙：超 1 行判违规，恰好等于上限判合法（零余量）')
    } else {
      bad('负向对拍失败：规模判据**没有分辨力** ⇒ C 组是假绿')
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// D 组 · 单源权威
// ══════════════════════════════════════════════════════════════════════════
/**
 * ── 守什么 ────────────────────────────────────────────────────────────
 *   「同一个事实只能有一份判据」是本项目最贵的一条纪律：
 *   REVIEW 的 R-02（「链完成了吗」有 5 份实现）就是这条纪律被违反的后果。
 *
 * ── 怎么守 ────────────────────────────────────────────────────────────
 *   ① 这些符号**必须**在 `src/` 里恰好有 **1 处**定义（`function X` / `const X =`）；
 *   ② 其余文件只许**转接**（把回调传下去 / 当作参数），⛔ 不许再写一份实现。
 *
 * ⚠ **不登记 `proceedGateOf`**：它是**回调参数名**（`proceedGateOf?: (exec) => …`），
 *   不是实现；唯一实现在 `src/preset/tools.ts` 的 `proceedGateFor`，
 *   `proceedGateOf: (exec) => proceedGateFor(exec?.agent ?? exec)` 是**转接**。
 *   ⇒ 登记 `proceedGateFor`，并断言全仓只有 1 处定义。
 */
const SINGLE_SOURCE = ['ledgerHealthOf', 'proceedGateFor']

{
  const defRe = (sym) => new RegExp('(?:^|[\\s;{}])(?:export\\s+)?(?:async\\s+)?(?:function|const)\\s+' + sym + '\\b', 'm')
  /** 统计某符号在多少个文件里有**定义**（剥注释后）。 */
  const defsOf = (sym) => {
    const re = defRe(sym)
    const hits = []
    for (const f of FILES) {
      const code = stripNonCode(readFileSync(f, 'utf8'))
      if (re.test(code)) hits.push(rel(f))
    }
    return hits
  }
  const multi = []
  const missing = []
  for (const sym of SINGLE_SOURCE) {
    const hits = defsOf(sym)
    if (hits.length === 0) missing.push(sym)
    else if (hits.length > 1) multi.push(`${sym} 有 ${hits.length} 处定义：${hits.join(' · ')}`)
  }
  if (missing.length > 0) {
    bad(`D 单源 · 找不到定义：${missing.join(' · ')}（⚠ 改名了 ⇒ 必须同批更新 SINGLE_SOURCE，⛔ 不许删条目了事）`)
  }
  if (multi.length > 0) for (const m of multi) bad('D 单源 · ' + m + ' ⇒ 同一事实两份实现是本项目最大的缺陷来源（R-02 即此）')
  if (missing.length === 0 && multi.length === 0) {
    ok(`D1 ✓ ${SINGLE_SOURCE.length} 个关键判据全仓**各有唯一实现**：${SINGLE_SOURCE.join(' · ')}`)
  }

  /** ── D 的负向对拍：同一符号在假源码里出现两次，判据必须数出 2 ── */
  {
    const sym = 'ledgerHealthOf'
    const fakeOne = 'export function ledgerHealthOf(u) { return u }'
    const fakeTwo = fakeOne + String.fromCharCode(10) + 'function ledgerHealthOf(u) { return 1 }'
    const countIn = (text) => {
      const c = stripNonCode(text)
      const re = defRe(sym)
      return re.test(c) ? 1 : 0
    }
    /** ⚠ 正则带 m 标志只看"有没有"，故按行切分逐个统计。 */
    const countLines = (text) => {
      const c = stripNonCode(text)
      const re = new RegExp('(?:^|[\\s;{}])(?:export\\s+)?(?:async\\s+)?(?:function|const)\\s+' + sym + '\\b', 'g')
      let n = 0
      while (re.exec(c) !== null) n++
      return n
    }
    const one = countLines(fakeOne)
    const two = countLines(fakeTwo)
    const commented = countLines('// ' + fakeOne)
    if (one === 1 && two === 2 && commented === 0) {
      ok('负向对拍 ✓ 单源判据有牙：一份定义数 1 · 两份定义数 2 · **注释里那份不算**')
    } else {
      bad(`负向对拍失败：单源判据没有分辨力（1 份=${one} 2 份=${two} 注释=${commented}）⇒ D 组是假绿`)
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// E 组 · 架构文档里的「文件:行号」引用必须可核
// ══════════════════════════════════════════════════════════════════════════
/**
 * ── 守什么 ────────────────────────────────────────────────────────────
 *   `kit/drafts/architecture-overview.md` 里会写 `文件:行号` 这种**可核引用**
 *   （例：`src/shared/stage-controls.ts:46  STAGE_NAMES = {`）。
 *   它们是读者按图索骥的入口 —— 行号漂了，读者会**找到别的东西**，
 *   然后以为「这条规则不存在」或「代码就是这么写的」。
 *
 * ⚠ **本组只核「引用的那一行里确实有那个符号」**，⛔ 不核「那段描述对不对」。
 *   口径：抓 `路径:行号` 后面的**标识符**（连续大写/驼峰），断言它出现在该行。
 *   抓不到标识符的行 ⇒ 跳过（⚠ 跳过不计入通过，会在汇总里点名）。
 */
{
  const DOC = join(root, 'kit', 'drafts', 'architecture-overview.md')
  let docSrc = ''
  try { docSrc = readFileSync(DOC, 'utf8') } catch {
    bad('E 读不到架构文档 `kit/drafts/architecture-overview.md`（⛔ 不按通过处理）')
  }
  if (docSrc !== '') {
    const refs = []
    for (const raw of docSrc.split(String.fromCharCode(10))) {
      /** 形如 `src/xx/yy.ts:46  STAGE_NAMES = {` —— 取路径、行号、紧随的标识符。 */
      const m = raw.match(/([A-Za-z0-9_./-]+\.(?:tsx|ts|mjs)):([0-9]+)\s+([A-Za-z_][A-Za-z0-9_]{2,})/)
      if (m !== null) refs.push({ file: m[1], line: Number(m[2]), symbol: m[3] })
    }
    if (refs.length === 0) {
      noteSkip('E 架构文档里没有「文件:行号 符号」形态的可核引用 ⇒ 本组无对象')
    } else {
      const broken = []
      for (const r of refs) {
        const abs = join(root, r.file)
        if (!existsSync(abs)) { broken.push(`${r.file}:${r.line} 的文件不存在`); continue }
        const lines = readFileSync(abs, 'utf8').split(String.fromCharCode(10))
        if (r.line < 1 || r.line > lines.length) { broken.push(`${r.file}:${r.line} 行号越界（文件 ${lines.length} 行）`); continue }
        const text = lines[r.line - 1]
        if (!text.includes(r.symbol)) {
          broken.push(`${r.file}:${r.line} 里找不到 \`${r.symbol}\`（该行是 \`${text.trim().slice(0, 60)}\`）`)
        }
      }
      if (broken.length === 0) {
        ok(`E1 ✓ 架构文档里 ${refs.length} 处 \`文件:行号 符号\` 引用**全部可核**（该行确实有那个符号）`)
      } else for (const b of broken) bad('E 文档引用失准 · ' + b)

      /** ── E 的负向对拍：把行号推到文件外，判据必须咬住 ── */
      {
        const probeRef = refs[0]
        const abs = join(root, probeRef.file)
        const total = readFileSync(abs, 'utf8').split(String.fromCharCode(10)).length
        const inRange = (ln) => ln >= 1 && ln <= total
        if (inRange(probeRef.line) === true && inRange(total + 999) === false) {
          ok('负向对拍 ✓ 文档引用判据有牙：正常行号判合法，越界行号判非法')
        } else {
          bad('负向对拍失败：文档引用判据**没有分辨力** ⇒ E 组是假绿')
        }
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 收尾
// ══════════════════════════════════════════════════════════════════════════
console.log('')
console.log('断言：A 分层方向零违规 · B import 图零环 · C 重点文件不超上限 · D 关键判据唯一实现 · E 架构文档引用可核')
console.log('')
for (const n of note) console.log('  ✓', n)
for (const k of skip) console.log('  ·', k)
console.log('')
console.log(`  处级口径：查了 ${note.length + fail.length + skip.length} 处 · 过了 ${note.length} 处`
    + (fail.length > 0 ? ` · 没过 ${fail.length} 处` : '')
  + ` · **跳过 ${skip.length} 处**（⚠ 跳过**不计入通过**）`)
/**
 * ── **D 断言编号唯一**（2026-11-25 · P2）────────────────────────────────────
 *   ⚠ 实测踩过三次：新断言用了已被占用的编号（SC-34 / SC-38 / PIPE-24），插入被同名守卫**静默跳过**，
 *     看起来像「已加断言」，实际一条都没跑。⇒ 编号冲突必须能自己响。
 *   只扫检查脚本里的编号**定义点**（ok(...'SC-12 ✓ ...'）这种），按 (族, 编号) 去重计数。
 */
{
  const { readdirSync: rd, readFileSync: rf } = await import('node:fs')
  const dir = join(root, 'scripts')
  const dupes = []
  for (const f of rd(dir).filter((x) => x.startsWith('check-') && x.endsWith('.mjs'))) {
    const src = rf(join(dir, f), 'utf8')
    /** ⚠ 只数**正向断言标签**（ok('X-N ✓ ...')）；正负对拍写在 if/else 两行，不会重复计。 */
    /** ⚠ 口径：**小节标题**（`// ── SC-12：…`）的编号唯一。组内多条 ok 共用同一编号是既有惯例，⛔ 不算重号。 */
    const labels = [...src.matchAll(/\/\/ ── ((?:SC|PIPE|LP)-\d+)[:：]/g)].map((m) => m[1])
    const count = new Map()
    for (const id of labels) count.set(id, (count.get(id) ?? 0) + 1)
    for (const [id, n] of count) if (n > 1) dupes.push(f + ' · ' + id + ' · ' + String(n) + ' 个同名小节')
  }
  /** ⚠ 存量：SC-31 / SC-33 各有两个同名小节（历史分段），登记上限 2；**第三个同名小节就是新重号**。 */
  const KNOWN_DUP_HEADERS = 2
  if (dupes.length === 0) ok('D ✓ 断言编号唯一：没有编号被两个小节共用（⚠ 重号会让新断言被静默跳过）')
  else if (dupes.length <= KNOWN_DUP_HEADERS) {
    ok('D ✓ 断言编号唯一（存量 ' + String(dupes.length) + ' 处 ≤ 登记 ' + String(KNOWN_DUP_HEADERS) + '）：' + dupes.join(' / '))
  } else for (const d of dupes.slice(0, 6)) bad('D 断言编号重复（新增重号） · ' + d)
}

if (fail.length === 0) {
  console.log('判定：PASS —— 分层方向、依赖成环、文件规模、单源权威、文档引用可核，五件事都由断言守着。')
  process.exit(0)
}
console.log('判定：FAIL')
for (const f of fail) console.log('  ✗', f)
process.exit(1)
