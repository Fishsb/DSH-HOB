/**
 * **「未选档位」检测与横幅的"真 DOM"行为检查**（2026-10-22 · 第 3 轮）。
 *
 * ══ 为什么是这一族 ═════════════════════════════════════════════════════════
 *   任务书 §四.5 明确要求：新增代码要有**可复核的行为读数**（jsdom 真挂载或等效），
 *   ⛔ 不要只给源码正则。⇒ 本脚本把那套做法（仓库自己的 TypeScript 转译 +
 *   jsdom + react-dom 真挂载 + 真派发事件）**照搬**到新模块上。
 *
 * ══ 它测什么（逐条对应任务书 §四）═════════════════════════════════════════
 *   G-1 **纯判定**：Hob + 未选 ⇒ true；非 Hob ⇒ false；已选 ⇒ false；
 *       判不出（unknown）⇒ false（fail-closed，不打扰）
 *   G-2 **四类会话的真 DOM 读数**：只有"Hob + 未选"真的渲染出横幅；
 *       另外三类**零渲染**（DOM 里没有本模块任何节点）
 *   G-3 **非 Hob 会话零请求**：不因为"看一眼"就去请求策略（⛔ 不打扰别的预设）
 *   G-4 **只自动弹一次**：同一会话重复挂载不重复弹（任务书 §二 A 最后一条）
 *   G-5 **原子性**：`takeAutoOpen` 并发取两次，只有第一次 true
 *   G-6 **取消/未选 ⇒ 不删除、不静默**：横幅文案在、按钮在、`aria-live` 在
 *   G-7 **文案卫生**：用户可见文本里不出现字面 `**`、不出现内部配置值
 *   G-8 **失败安全**：读取器抛错 ⇒ 当作 unknown ⇒ 不渲染（⛔ 不炸、不误弹）
 *   G-9 **卸载后不 setState**：卸载再推进 promise 不产生 React 警告
 *   G-10 **样式幂等**：`ensureGateStyles()` 调两次只出一个 `<style>` 标签
 *
 * ══ 边界（如实说）══════════════════════════════════════════════════════════
 *   ⚠ 这是**隔离渲染**（jsdom），⛔ **不是真实宿主浏览器**：
 *     真实槽服务（`SlotCore`）、CSS 层叠、真实字体度量、真实布局都在宿主里。
 *     ⇒ 本脚本绿 ⇒ **组件行为**成立；**真实宿主渲染仍未验**（要重启 + 真浏览器）。
 *   ⚠ **本脚本不写任何仓库文件**：转译产物落在工作区内 `.check-gate-work/`
 *     一次性目录，`finally` 里删净（与既有 `check:hob-create-dom` 同一做法）。
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
/**
 * ⚠ **源码根可被 `HOB_GATE_ROOT` 指向一份临时副本**（负向对拍用：把写入口的闸删掉，
 *   确认 G-21 那几条**会红**而不是恒绿）。⚠ 与 `check:orch` 的 `HOB_SA_ROOT` /
 *   `check:policy` 的 `HOB_SP_ROOT` / 本仓 `HOB_DOM_ROOT` **同一约定**（⛔ 不另造开关名）。
 * ⚠ 只影响"读/加载哪份源码"，⛔ 不影响 jsdom/react 依赖解析（那些仍从本仓 node_modules）。
 */
const SRC_ROOT = process.env.HOB_GATE_ROOT !== undefined && process.env.HOB_GATE_ROOT !== ''
  ? process.env.HOB_GATE_ROOT
  : root

let pass = 0
let fail = 0

/** 依赖是否齐备（缺则跳过并说明，⛔ 不算通过）。 */
let jsdom
let reactDom
let React
let act
try {
  jsdom = await import('jsdom')
  React = (await import('react')).default
  act = (await import('react')).act
  reactDom = await import('react-dom/client')
} catch (e) {
  console.log(`  ⚠ G 组【跳过】—— 隔离渲染依赖不可用（${String(e?.message ?? e)}）`)
  console.log('       ⇒ 需 `npm i --no-save jsdom react-dom`；⛔ 本组**未执行**、不算通过')
  console.log('')
  console.log('  跳过 1 组（⛔ 不计入通过）')
  process.exit(2)
}

/**
 * ⚠⚠ **"真跑过哪些断言"的运行时台账**（t11 · 这是修"文本标签可数"的关键）──
 *
 * ── 为什么要它 ────────────────────────────────────────────────────────
 *   t10 的跨族核对数的是**源码文本里的标签**。审查席实测：把闸② 的整段断言放进
 *   `if (false) { … }`（⚠ 真断言块不执行了），标签**仍在源码里** ⇒ 数出来还是 4 个
 *   ⇒ 26/26 exit 0，而闸② **实际零行为判据**。
 *   ⚠ 根因还是同一条：**判据在认文本形态，不认行为**。
 *
 * ── 现在 ──────────────────────────────────────────────────────────────
 *   `ok()` / `bad()` **被调用的那一刻**把标签记进 `executedLabels`。
 *   ⇒ 只记**真的跑到了**的断言（`if (false)` 里的永远进不来，注释里的更进不来）。
 */
const executedLabels = new Set()
const labelOf = (m) => {
  const hit = /^\s*(G-\d+[a-z]?)\b/.exec(String(m))
  return hit === null ? null : hit[1]
}
const ok = (m) => {
  pass += 1
  const lb = labelOf(m)
  if (lb !== null) executedLabels.add(lb)
  console.log(`  ✓ ${m}`)
}
const bad = (m) => {
  fail += 1
  const lb = labelOf(m)
  if (lb !== null) executedLabels.add(lb)
  console.log(`  ✗ ${m}`)
}

const work = join(root, '.check-gate-work')
try { rmSync(work, { recursive: true, force: true }) } catch { /* 上轮残留 */ }
/**
 * ⚠⚠ **建不出临时目录 ⇒ `exit 2`（未执行），⛔ 不许记成"失败"**（2026-10-22 · P0-5）
 *
 * ── 改前是什么 ────────────────────────────────────────────────────────
 *   直接 `mkdirSync(...)`，在**只读 checkout** 上抛异常 ⇒ 一路落到最外层 `catch`
 *   ⇒ 印成"检查器自身异常"、退出码既不是 0 也不是 1。本仓三档口径
 *   （`check-all.mjs:15-22`）里 **`2` = 未执行**，与"查出违规"（`1`）不是一个东西；
 *   把"这台机器写不了"记成"这族查出问题"会让下一轮白改产品代码。
 *
 * ── 现在 ──────────────────────────────────────────────────────────────
 *   环境缺条件走它自己的档：**可读原因 + `exit 2`**。判据逻辑一个字未改。
 */
try {
  mkdirSync(join(work, 'out'), { recursive: true })
} catch (e) {
  console.log(`  ⚠ G 组【跳过】—— 仓根不可写，建不出临时目录（${String(e?.message ?? e)}）`)
  console.log('       ⇒ 需要**可写 checkout**（本族要在 `.check-gate-work/` 下转译 React 组件，')
  console.log('         ⛔ 不能放 /tmp：那会解析不到本仓的 React）')
  console.log('       ⚠ 本组**未执行**、不算通过（exit 2）')
  console.log('')
  console.log('  跳过 1 组（⛔ 不计入通过）')
  process.exit(2)
}
const cleanup = () => { try { rmSync(work, { recursive: true, force: true }) } catch { /* 忽略 */ } }

try {
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * ⚠⚠ **转译：从"三个手写调用"改成"整棵可达源码树 + 自证"**（2026-10-24 · B 席）
   * ══════════════════════════════════════════════════════════════════════════
   *
   * ── 改前是什么 ─────────────────────────────────────────────────────────
   *   本族此前已经**踩过一次**这个坑（2026-10-22 第 4 轮）：把产物平铺在 `out/gate.mjs`
   *   ⇒ `../shared/planning-preset.ts` 解析不到 ⇒ `ERR_MODULE_NOT_FOUND`。
   *   当时的修法是"手工挑三个文件、手工建两个目录、手工重写扩展名"——
   *   ⚠ 那仍然有三个隐患：
   *     ① 只覆盖**人工列出的那几个**依赖 ⇒ 新引入一条相对 import 就漏；
   *     ② 依赖关系靠人维护 ⇒ 与源码必然漂；
   *     ③ ⚠ 没有"产物里不许残留 `.ts` import"的断言 ⇒ 漏了也**不会报**。
   *
   * ── 现在 ──────────────────────────────────────────────────────────────
   *   转译逻辑收进 `scripts/ts-mount.mjs`（与 `check:hob-create-dom` **同一处实现**）：
   *   从**源码**解析相对 import、递归转译、按 `src/` 结构落盘、`verifyMounted()` 自证。
   *   ⚠ 三个入口（gate / dialog / 线格式模块）一次挂完；`policy-record-state.ts`
   *     零运行时 import ⇒ 一样能挂（它也是 G-17/G-18 的**真源码**，⛔ 不是副本）。
   */
  const tsPath = join(root, 'node_modules', 'typescript', 'lib', 'typescript.js')
  const ts = (await import(`file://${tsPath}`)).default
  const tsMount = await import('./ts-mount.mjs')
  const ENTRIES = [
    'src/client/hob-unselected-gate.tsx',
    'src/client/create-hob-dialog.tsx',
    'src/shared/policy-record-state.ts',
  ]
  const graph = tsMount.mountTsGraph({ root, outDir: join(work, 'out'), entries: ENTRIES, ts })
  /**
   * ⚠ **自证失败 ⇒ 可读地记红**（⛔ 不许抛到外层 `catch`）：
   *   抛出去会被渲染成 `exit 3`（"检查器自身异常"），而 `check:all` 对 `3` 与 `2`
   *   的**修法完全不同**（看栈 vs 补基准）⇒ 把可判定的失败扔进"检查器坏了"是错的分档。
   */
  const mountProblems = [...graph.problems, ...tsMount.verifyMounted({
    root, entries: ENTRIES, mounted: graph.mounted, entryFiles: graph.entries,
  })]
  if (mountProblems.length > 0) {
    for (const p of mountProblems) bad(`G-0 转译/自证失败：${p}`)
  } else {
    ok(`G-0 ✓ **转译图自证通过**：${graph.mounted.length} 份源件按 \`src/\` 结构产出`
      + `（${graph.mounted.join(' · ')}）· 产物里无残留 \`.ts\` 相对 import · 每条相对 import 都指向真产出的文件`)
  }
  const needEntry = (rel) => {
    const out = graph.entries[rel]
    if (out === undefined) throw new Error(`入口没有产出（见上面 G-0 的转译/自证失败行）：${rel}`)
    return out
  }

  // ⚠ 让 `react` 从临时目录解析到**工作区那一份**（⛔ 不装第二份 React）
  const entry = join(work, 'entry.mjs')
  writeFileSync(entry, `export * from ${JSON.stringify(needEntry(ENTRIES[0]))}\n`)
  const gate = await import(`file://${entry}`)

  const stateMod = await import(`file://${needEntry(ENTRIES[2])}`)
  const dialogEntry = join(work, 'entry-dialog.mjs')
  writeFileSync(dialogEntry, `export * from ${JSON.stringify(needEntry(ENTRIES[1]))}\n`)
  const dialog = await import(`file://${dialogEntry}`)

  // ── 隔离 DOM ──────────────────────────────────────────────────────────
  const dom = new jsdom.JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true, url: 'http://localhost/',
  })
  const w = dom.window
  globalThis.window = w
  globalThis.document = w.document
  globalThis.HTMLElement = w.HTMLElement
  globalThis.Node = w.Node
  globalThis.Event = w.Event
  globalThis.KeyboardEvent = w.KeyboardEvent
  globalThis.MouseEvent = w.MouseEvent
  globalThis.getComputedStyle = w.getComputedStyle.bind(w)
  Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  // ⚠ 横幅在"不能打开"时会调 alert —— jsdom 没有，这里塞一个可数的假实现
  globalThis.alert = () => { alerted += 1 }
  let alerted = 0

  const { createRoot } = reactDom
  const host = document.getElementById('root')
  const mount = async (el) => {
    host.innerHTML = ''
    const r = createRoot(host)
    await act(async () => { r.render(el) })
    return r
  }
  const unmount = async (r) => { await act(async () => { r.unmount() }) }
  /** 让所有已排队的 promise/effect 落地（⚠ act 会把 effect 刷完）。 */
  const flush = async () => { await act(async () => { await Promise.resolve() }) }
  /**
   * ⚠⚠ **等真的网络往返**（2026-10-22 第 4 轮）：
   *   上面那个 `flush()` 只刷**微任务**（`Promise.resolve`）—— 对纯内存的假实现够用。
   *   但 G-19 用的是**默认读取器**（真 `fetch` → 本地 http 服务），那要经过事件循环的
   *   **宏任务**才回来。只刷微任务会让断言在"读取还没回来"时就跑完 ⇒ 全部读到 `unknown`。
   *   ⇒ 单独给一个基于 `setTimeout(0)` 的推进（包在 act 里以刷掉后续渲染）。
   */
  const settle = async (ms = 50) => {
    await act(async () => { await new Promise((r) => setTimeout(r, ms)) })
  }

  console.log('')
  console.log('G 组 · 「未选档位」检测与横幅（真 jsdom 挂载）')
  console.log('')

  const h = React.createElement

  // ── G-1 纯判定（四类会话逐个断言，⛔ 不靠"跑一遍看看"）──────────────
  {
    const cases = [
      { name: 'Hob + 未选', preset: 'Hob', recorded: 'unrecorded', want: true },
      { name: 'Hob + 已选', preset: 'Hob', recorded: 'recorded', want: false },
      { name: 'Hob + 判不出', preset: 'Hob', recorded: 'unknown', want: false },
      { name: '非 Hob(standard) + 未选', preset: 'standard', recorded: 'unrecorded', want: false },
      { name: '非 Hob(cordis) + 未选', preset: 'cordis', recorded: 'unrecorded', want: false },
      { name: 'preset 为空 + 未选', preset: null, recorded: 'unrecorded', want: false },
      { name: '近似名 Hob-other + 未选', preset: 'Hob-other', recorded: 'unrecorded', want: false },
    ]
    const wrong = cases.filter((c) => gate.shouldShowGate(c.preset, c.recorded) !== c.want)
    if (wrong.length === 0) ok(`G-1 四类判定全对（${cases.length} 个样本，含近似名不误判）`)
    else bad(`G-1 判定错：${wrong.map((c) => `${c.name} 期望 ${c.want}`).join(' / ')}`)
  }

  // ── G-2 四类会话的真 DOM 读数 ────────────────────────────────────────
  {
    const mkReader = (v) => async () => v
    const rows = [
      { name: 'Hob + 未选', preset: 'Hob', rec: 'unrecorded', wantShown: true },
      { name: 'Hob + 已选', preset: 'Hob', rec: 'recorded', wantShown: false },
      { name: 'Hob + 判不出', preset: 'Hob', rec: 'unknown', wantShown: false },
      { name: '非 Hob + 未选', preset: 'standard', rec: 'unrecorded', wantShown: false },
    ]
    let allOk = true
    const detail = []
    for (const row of rows) {
      const r = await mount(h(gate.HobUnselectedGate, {
        sessionId: 'session-x',
        agentPreset: row.preset,
        readRecorded: mkReader(row.rec),
        memory: gate.createGateMemory(),
        autoOpen: false,
      }))
      await flush()
      const shown = host.querySelector(`.${gate.GATE_CLASS.root}`) !== null
      if (shown !== row.wantShown) { allOk = false; detail.push(`${row.name} 期望${row.wantShown} 实得${shown}`) }
      await unmount(r)
    }
    if (allOk) ok(`G-2 四类会话真 DOM 读数全对（${rows.length} 类，非目标类零渲染）`)
    else bad(`G-2 DOM 不符：${detail.join(' / ')}`)
  }

  // ── G-3 非 Hob 会话零请求（⛔ 不打扰别的预设）────────────────────────
  {
    let calls = 0
    const counting = async () => { calls += 1; return 'unrecorded' }
    const r = await mount(h(gate.HobUnselectedGate, {
      sessionId: 'session-y',
      agentPreset: 'standard',
      readRecorded: counting,
      memory: gate.createGateMemory(),
    }))
    await flush()
    const shown = host.querySelector(`.${gate.GATE_CLASS.root}`) !== null
    await unmount(r)
    if (calls === 0 && !shown) ok('G-3 非 Hob 会话零请求、零渲染（不打扰别的预设）')
    else bad(`G-3 非 Hob 却发生了请求/渲染：calls=${calls} shown=${shown}`)
  }

  // ── G-4 只自动弹一次（重复挂载不重复弹）─────────────────────────────
  {
    /**
     * ⚠ 2026-10-29（TASK-Q · `CHG-215`）：**开窗来源已从"挂载即弹"改成"`blocked` 轮询"**
     *   ⇒ 本组也必须跟着改：原来只要 `recorded === 'unrecorded'` 就会弹，现在必须
     *   让 reader 真的回 `blocked`。⚠ 判据的**靶子没变**（同一会话反复挂载只弹 1 次），
     *   变的只是"怎么让它第一次弹"。
     */
    const memory = gate.createGateMemory()
    const opened = []
    const reader = async () => 'unrecorded'
    const blockedReader = async () => 'blocked'
    // 连挂三次（模拟切走再切回 / 重渲染）
    for (let i = 0; i < 3; i += 1) {
      const r = await mount(h(gate.HobUnselectedGate, {
        sessionId: 'session-dup',
        agentPreset: 'Hob',
        readRecorded: reader,
        readBlocked: blockedReader,
        blockPollMs: 20,
        openForSession: (id) => opened.push(id),
        memory,
      }))
      await settle(80)
      await unmount(r)
    }
    if (opened.length === 1 && opened[0] === 'session-dup') ok('G-4 同一会话重复挂载 3 次，只自动弹 1 次（⚠ 开窗来源 = `blocked` 轮询）')
    else bad(`G-4 重复弹了：opened=${JSON.stringify(opened)}`)
  }

  // ── G-5 takeAutoOpen 原子性（并发取两次只有一次 true）───────────────
  {
    const memory = gate.createGateMemory()
    const a = memory.takeAutoOpen('s1')
    const b = memory.takeAutoOpen('s1')
    const c = memory.takeAutoOpen('s2') // 另一个会话不受影响
    const d = memory.takeAutoOpen('')
    if (a === true && b === false && c === true && d === false) {
      ok('G-5 takeAutoOpen 原子：同会话第二次 false · 异会话 true · 空 id false')
    } else bad(`G-5 原子性不符：a=${a} b=${b} c=${c} d=${d}`)
  }

  // ── G-6 未选 ⇒ 横幅 + 按钮 + aria-live 保留（入口可与发送弹窗共存）──
  {
    const r = await mount(h(gate.HobUnselectedGate, {
      sessionId: 'session-banner',
      agentPreset: 'Hob',
      readRecorded: async () => 'unrecorded',
      memory: gate.createGateMemory(),
      autoOpen: false,
    }))
    await flush()
    const rootEl = host.querySelector(`.${gate.GATE_CLASS.root}`)
    const textEl = host.querySelector(`.${gate.GATE_CLASS.text}`)
    const btn = host.querySelector(`.${gate.GATE_CLASS.btn}`)
    const live = rootEl?.getAttribute('aria-live')
    const text = textEl?.textContent ?? ''
    const isBtn = btn?.tagName === 'BUTTON'
    await unmount(r)
    if (rootEl !== null && text !== '' && isBtn && live === 'polite') {
      ok(`G-6 横幅可见且非静默（role=status · aria-live=${live} · 真 <button> · 文案「${text}」）`)
    } else {
      bad(`G-6 横幅不合格：root=${rootEl !== null} text=${JSON.stringify(text)} btn=${isBtn} live=${live}`)
    }
  }

  // ── G-6b 安装面：hero 横幅 + composer 常驻轮询两处都注册 ──────────────
  {
    const registered = []
    const cleanups = []
    const fakeCtx = {
      effect: (fn) => { try { const d = fn(); if (typeof d === 'function') cleanups.push(d) } catch { /* 忽略 */ } },
      slots: {
        inject: (_name, fn) => fn(),
        register: (spec) => { registered.push(spec); return () => {} },
      },
    }
    gate.installHobUnselectedGate(fakeCtx, {})
    const names = registered.map((r) => r.name)
    const hasHero = names.includes('conversation.hero.options')
    const hasComposer = names.includes('conversation.composer.bar')
    const pollId = registered.find((r) => r.name === 'conversation.composer.bar')?.id
    for (const c of cleanups.reverse()) { try { c() } catch { /* 忽略 */ } }
    if (hasHero && hasComposer && pollId === gate.HOB_GATE_POLL_SLOT_ID) {
      ok(`G-6b ✓ 安装面两处都注册：hero 横幅 + composer 常驻轮询（${pollId}）`)
    } else {
      bad(`G-6b · slots=${JSON.stringify(names)} pollId=${JSON.stringify(pollId)}`)
    }
  }

  // ── G-7 文案卫生：不出现字面 ** / 不出现内部枚举值 ───────────────────
  {
    const r = await mount(h(gate.HobUnselectedGate, {
      sessionId: 'session-copy',
      agentPreset: 'Hob',
      readRecorded: async () => 'unrecorded',
      memory: gate.createGateMemory(),
      autoOpen: false,
    }))
    await flush()
    const visible = host.textContent ?? ''
    await unmount(r)
    const hasMd = visible.includes('**')
    const hasEnum = /\b(ledger|project|workspace)\b/.test(visible)
    if (!hasMd && !hasEnum) ok(`G-7 文案卫生通过（无字面 ** · 无内部枚举值）：「${visible}」`)
    else bad(`G-7 文案不卫生：markdown=${hasMd} enum=${hasEnum} text=${JSON.stringify(visible)}`)
  }

  // ── G-8 读取器抛错 ⇒ 当 unknown ⇒ 不渲染（⛔ 不炸、不误弹）────────────
  {
    const r = await mount(h(gate.HobUnselectedGate, {
      sessionId: 'session-throw',
      agentPreset: 'Hob',
      readRecorded: async () => { throw new Error('boom') },
      memory: gate.createGateMemory(),
    }))
    await flush()
    const shown = host.querySelector(`.${gate.GATE_CLASS.root}`) !== null
    await unmount(r)
    if (!shown) ok('G-8 读取器抛错 ⇒ unknown ⇒ 不渲染（不炸、不误弹）')
    else bad('G-8 读取器抛错却仍渲染了横幅')
  }

  // ── G-9 卸载后不 setState（推进 promise 不产生警告）──────────────────
  {
    let warnCount = 0
    const origWarn = console.error
    console.error = (...args) => { warnCount += 1; origWarn(...args) }
    let release
    const pending = new Promise((res) => { release = res })
    const r = await mount(h(gate.HobUnselectedGate, {
      sessionId: 'session-unmount',
      agentPreset: 'Hob',
      readRecorded: () => pending,
      memory: gate.createGateMemory(),
    }))
    await unmount(r)
    release('unrecorded')
    await flush()
    console.error = origWarn
    if (warnCount === 0) ok('G-9 卸载后推进 promise 未产生 React 警告')
    else bad(`G-9 卸载后出现 ${warnCount} 条 console.error（可能是不该有的 setState）`)
  }

  // ── G-10 样式幂等（两次调用只出一个 <style>）──────────────────────────
  {
    const a = gate.ensureGateStyles()
    const b = gate.ensureGateStyles()
    const tags = document.querySelectorAll(`style[data-plugin-css=${JSON.stringify('dsh-hob/unselected-gate.css')}]`)
    const firstReal = a !== null
    const secondNull = b === null
    if (firstReal && secondNull && tags.length === 1) {
      ok('G-10 样式幂等：首次返回标签 · 再次返回 null · DOM 里恰好 1 个 <style>')
    } else {
      bad(`G-10 样式不幂等：first=${firstReal} second=${secondNull} tags=${tags.length}`)
    }
  }

  console.log('')
  console.log('H 组 · 已有会话模式的写入面（真挂载 + 假通道计数）')
  console.log('')

  /** 一份"枚举已就绪"的假响应（⚠ 只为把弹窗推到可提交状态，值取自真实开放面）。 */
  const fakeEnums = {
    ok: true,
    levels: ['ledger', 'project', 'workspace'],
    openLevels: ['ledger'],
    modes: ['assist', 'auto', 'manual'],
    floorLevel: 'ledger',
    defaultMode: 'assist',
    levelsNote: '当前只开放「账本权限」。',
    workspaces: [{ id: 'ws-1', label: '测试工作区' }],
  }

  /**
   * 挂一个弹窗，等待枚举落地，返回 `{ calls, root }`。
   * @param props - 弹窗属性（⚠ `call` 由本函数接管以便计数）。
   */
  const mountDialog = async (props) => {
    const calls = []
    const call = async (body) => {
      calls.push(body)
      // ⚠ 枚举请求给假枚举；写入/创建请求给 `writeResult`
      if (body?.action === 'enums') return fakeEnums
      /**
       * ⚠⚠ **写入动作名必须是 `write`**（2026-10-23 · P0-3 修复的判据面）。
       *
       * ── 改前是什么（这条判据自己造了一个不存在的服务）────────────────────
       *   假 call 只写 `if (body?.action === 'set-policy') return writeResult`
       *   ⇒ 客户端发旧的 `set-policy` 也**判成功**，而真服务端（`session-create`
       *   路由）根本不认这个动作 ⇒ G-11/G-13/G-14 测的是**假服务**，产品上那条路
       *   每次都是 400「未知 action」，判据却全绿。
       *
       * ── 现在 ──────────────────────────────────────────────────────────
       *   只认**真服务端认的动作**（`/api/dsh-hob/session-policy` 的 `write`）。
       *   ⛔ **不再给 `set-policy` 开后门** —— 它若再出现，会落到下面的兜底分支，
       *   回 `unexpected action set-policy` ⇒ 客户端按"写入失败"处理 ⇒ 本组**必红**。
       */
      if (body?.action === 'write') return writeResult
      if (body?.action === 'issue') return { ok: true, ticket: 't-1', expiresAt: 0 }
      if (body?.action === 'create') return { ok: true, sessionId: body?.sessionId ?? 'made-up' }
      return { ok: false, reason: `unexpected action ${String(body?.action)}` }
    }
    const r = await mount(h(dialog.HobCreateDialog, { ...props, call }))
    await flush()
    return { calls, root: r }
  }
  /** 写入结果（⚠ 逐组覆盖，默认成功）。 */
  let writeResult = { ok: true }

  // ── G-11 【任务书判据 2】已有会话模式确认后**零 create** ─────────────
  {
    writeResult = { ok: true }
    const { calls, root } = await mountDialog({ targetSessionId: 'sess-existing' })
    // 选一个开放档 + 一种推进方式（⚠ 按真实 DOM 点，⛔ 不直接改组件 state）
    const levelRadio = host.querySelector('input[name="hob-level"][value="ledger"]')
    const modeRadio = host.querySelector('input[name="hob-mode"]')
    await act(async () => { levelRadio?.click(); modeRadio?.click() })
    await flush()
    // 点"确认"
    const buttons = [...host.querySelectorAll('button')]
    const confirm = buttons[buttons.length - 1]
    await act(async () => { confirm?.click() })
    await flush()

    const created = calls.filter((c) => c?.action === 'create')
    const issued = calls.filter((c) => c?.action === 'issue')
    const wrote = calls.filter((c) => c?.action === 'write')
    const targetOk = wrote.length === 1 && wrote[0]?.sessionId === 'sess-existing'
    await unmount(root)
    if (created.length === 0 && issued.length === 0 && targetOk) {
      ok(`G-11 已有会话模式：零 create（${created.length}）· 零 issue（${issued.length}）· 写入目标正确`)
    } else {
      bad(`G-11 出现了重复建会话风险：create=${created.length} issue=${issued.length} wrote(${JSON.stringify(calls.map((c) => c?.action))})`)
    }
  }

  // ── G-12 【任务书判据 2 反向】新建模式**仍然**走 issue → create ────────
  {
    writeResult = { ok: true }
    const { calls, root } = await mountDialog({})
    // 新建模式必须先选工作区
    const select = host.querySelector('select')
    await act(async () => {
      if (select !== null) {
        select.value = 'ws-1'
        select.dispatchEvent(new w.Event('change', { bubbles: true }))
      }
    })
    await flush()
    const levelRadio = host.querySelector('input[name="hob-level"][value="ledger"]')
    const modeRadio = host.querySelector('input[name="hob-mode"]')
    await act(async () => { levelRadio?.click(); modeRadio?.click() })
    await flush()
    const buttons = [...host.querySelectorAll('button')]
    const submitBtn = buttons[buttons.length - 1]
    await act(async () => { submitBtn?.click() })
    await flush()

    const created = calls.filter((c) => c?.action === 'create')
    const issued = calls.filter((c) => c?.action === 'issue')
    const wrote = calls.filter((c) => c?.action === 'write')
    await unmount(root)
    if (created.length === 1 && issued.length === 1 && wrote.length === 0) {
      ok('G-12 新建模式未受影响：仍走 issue → create，且不误调 write')
    } else {
      bad(`G-12 新建模式被改坏了：issue=${issued.length} create=${created.length} write=${wrote.length}`)
    }
  }

  // ── G-13 已有会话模式：**不要求选工作区**（否则按钮永远点不了）──────
  {
    writeResult = { ok: true }
    const { calls, root } = await mountDialog({ targetSessionId: 'sess-nows' })
    const hasSelect = host.querySelector('select') !== null
    const levelRadio = host.querySelector('input[name="hob-level"][value="ledger"]')
    const modeRadio = host.querySelector('input[name="hob-mode"]')
    await act(async () => { levelRadio?.click(); modeRadio?.click() })
    await flush()
    const buttons = [...host.querySelectorAll('button')]
    const submitBtn = buttons[buttons.length - 1]
    const wasEnabled = submitBtn !== undefined && submitBtn.disabled === false
    await act(async () => { submitBtn?.click() })
    await flush()
    const wrote = calls.filter((c) => c?.action === 'write')
    await unmount(root)
    if (!hasSelect && wasEnabled && wrote.length === 1) {
      ok('G-13 已有会话模式不渲染工作区、不卡"请选工作区"，按钮可用且写入成功')
    } else {
      bad(`G-13 已有会话模式可用性不对：hasSelect=${hasSelect} enabled=${wasEnabled} wrote=${wrote.length}`)
    }
  }

  // ── G-14 写入失败 ⇒ 可读失败、且**不得**当成已选（不显示成功）────────
  {
    writeResult = { ok: false, reason: '磁盘只读' }
    const { root } = await mountDialog({ targetSessionId: 'sess-fail' })
    const levelRadio = host.querySelector('input[name="hob-level"][value="ledger"]')
    const modeRadio = host.querySelector('input[name="hob-mode"]')
    await act(async () => { levelRadio?.click(); modeRadio?.click() })
    await flush()
    const buttons = [...host.querySelectorAll('button')]
    await act(async () => { buttons[buttons.length - 1]?.click() })
    await flush()
    const alertEl = host.querySelector('[role="alert"]')
    const alertText = alertEl?.textContent ?? ''
    const successEl = host.querySelector('.dsh-hob-success')
    const modalStillOpen = host.querySelector('[role="dialog"]') !== null
    await unmount(root)
    if (alertText.includes('磁盘只读') && successEl === null && modalStillOpen) {
      ok(`G-14 写入失败：可读报错「${alertText.slice(0, 40)}」· 不显示成功 · 弹窗仍开（会话仍算未选）`)
    } else {
      bad(`G-14 写入失败处理不对：alert=${JSON.stringify(alertText)} success=${successEl !== null} open=${modalStillOpen}`)
    }
  }

  // ── G-15 取消 ⇒ 零写入、零创建（⛔ 不静默当作已选）────────────────────
  {
    writeResult = { ok: true }
    const { calls, root } = await mountDialog({ targetSessionId: 'sess-cancel' })
    const levelRadio = host.querySelector('input[name="hob-level"][value="ledger"]')
    const modeRadio = host.querySelector('input[name="hob-mode"]')
    await act(async () => { levelRadio?.click(); modeRadio?.click() })
    await flush()
    const cancelBtn = [...host.querySelectorAll('button')][0]
    await act(async () => { cancelBtn?.click() })
    await flush()
    const writes = calls.filter((c) => c?.action === 'write' || c?.action === 'create' || c?.action === 'issue')
    await unmount(root)
    if (writes.length === 0) ok('G-15 取消：零写入、零创建（保持未选，不静默当作已选）')
    else bad(`G-15 取消后仍发生了写/建：${JSON.stringify(writes.map((c) => c.action))}`)
  }

  console.log('')
  console.log('I 组 · 只读路由的线格式（纯函数，真源码）')
  console.log('')

  // ── G-16 【任务书判据 3】新路由**只回一个语义字段**（⛔ 不泄档位值）──
  {
    const { okState, badRequest } = stateMod
    const shapes = [
      { name: 'recorded', obj: okState('recorded') },
      { name: 'unrecorded', obj: okState('unrecorded') },
      { name: 'not-applicable', obj: okState('not-applicable') },
      { name: 'unknown', obj: okState('unknown') },
      { name: 'badRequest', obj: badRequest('缺 sessionId') },
    ]
    const allowed = new Set(['ok', 'state', 'reason'])
    const leaks = []
    for (const s of shapes) {
      for (const k of Object.keys(s.obj)) if (!allowed.has(k)) leaks.push(`${s.name}.${k}`)
    }
    // ⚠ 不得出现任何档位/工作方式字段（哪怕值是对的）
    const forbidden = ['level', 'workMode', 'mode', 'source', 'canReadWorkspace', 'isHob']
    for (const s of shapes) {
      for (const k of forbidden) if (Object.prototype.hasOwnProperty.call(s.obj, k)) leaks.push(`${s.name}.${k}`)
    }
    if (leaks.length === 0) {
      ok(`G-16 线格式只含 {ok,state,reason}（${shapes.length} 种构造逐个查过，⛔ 无档位值泄漏）`)
    } else {
      bad(`G-16 线格式泄漏了字段：${leaks.join(', ')}`)
    }
  }

  // ── G-17 【任务书判据 1 + 4】三态与"非 Hob 不适用"的真判定 ──────────
  {
    const { classifyPolicyRecord, toClientState } = stateMod
    /**
     * ⚠ 逐条覆盖**任务书点名的**三类 + 非 Hob：
     *   · recorded:true  ⇒ 'recorded'          ⇒ 客户端 'recorded'  ⇒ **不弹**
     *   · recorded:false ⇒ 'unrecorded'        ⇒ 客户端 'unrecorded'⇒ **弹**
     *   · 判不出         ⇒ 'unknown'           ⇒ 客户端 'unknown'   ⇒ **不弹**
     *   · 非 Hob         ⇒ 'not-applicable'    ⇒ 客户端 'unknown'   ⇒ **不弹、不挡**
     */
    const cases = [
      { name: '已选', probe: { isHob: true, recorded: true, source: 'stored' }, wire: 'recorded', client: 'recorded' },
      { name: '未选', probe: { isHob: true, recorded: false, source: 'derived-default' }, wire: 'unrecorded', client: 'unrecorded' },
      { name: 'store 读不出', probe: { isHob: true, recorded: false, source: 'store-unreadable' }, wire: 'unknown', client: 'unknown' },
      { name: '版本不认识', probe: { isHob: true, recorded: false, source: 'version-unknown' }, wire: 'unknown', client: 'unknown' },
      { name: '无身份', probe: { isHob: true, recorded: false, source: 'no-identity' }, wire: 'unknown', client: 'unknown' },
      { name: '记录坏了', probe: { isHob: true, recorded: false, source: 'bad-record' }, wire: 'unknown', client: 'unknown' },
      { name: '非 Hob', probe: { isHob: false, recorded: false, source: 'non-hob' }, wire: 'not-applicable', client: 'unknown' },
      { name: '视图缺席', probe: undefined, wire: 'unknown', client: 'unknown' },
    ]
    const wrong = []
    for (const c of cases) {
      const wire = classifyPolicyRecord(c.probe)
      const client = toClientState(wire)
      if (wire !== c.wire || client !== c.client) {
        wrong.push(`${c.name}: 期望 ${c.wire}/${c.client} 实得 ${wire}/${client}`)
      }
    }
    if (wrong.length === 0) ok(`G-17 三态 + 非 Hob + 判不出全对（${cases.length} 个样本）`)
    else bad(`G-17 判定错：${wrong.join(' / ')}`)
  }

  // ── G-18 判不出**绝不**等于"没选过"（⛔ 用户明确否过的做法）───────────
  {
    const { classifyPolicyRecord } = stateMod
    /**
     * ⚠ 这条是"防回归"的钉子：所有"判不出"的 source 都必须在 `recorded === false`
     *   的前提下仍返回 `'unknown'`（⛔ 不许返回 `'unrecorded'`）。
     *   ⚠ 若哪天有人把判定顺序改成"先看 recorded"，这条立刻变红。
     */
    const undecidable = ['store-unreadable', 'version-unknown', 'no-identity', 'bad-record']
    const violated = undecidable.filter((src) =>
      classifyPolicyRecord({ isHob: true, recorded: false, source: src }) === 'unrecorded')
    if (violated.length === 0) {
      ok(`G-18 ${undecidable.length} 个"判不出"来源在 recorded:false 下仍为 unknown（⛔ 不误报成未选）`)
    } else {
      bad(`G-18 这些"判不出"被误报成 unrecorded：${violated.join(', ')}`)
    }
  }

  // ── G-19 【任务书判据 1】真读取器三态 ⇒ 自动弹窗行为**各不相同** ──────
  {
    /**
     * ⚠ 这条用**默认读取器**（`gate.defaultPolicyRecordReader`）跑真 `fetch`：
     *   起一个 http 服务回**三种**线格式（recorded / unrecorded / unknown），
     *   然后看 gate 的**横幅**三态是否各异。
     *
     * ⚠⚠ **2026-10-29 改口径（TASK-Q · `CHG-215`）**：本组原先还断言
     *   `unrecorded ⇒ 自动弹 1 次` —— **那正是本单要废掉的行为**（切预设就弹）。
     *   现在三态的可观察面只剩**横幅**：`unrecorded` 显出横幅但**不开窗**；
     *   `recorded` / `unknown` 横幅与开窗都没有。
     *   ⇒ ⛔ **不是把判据写松**：开窗那条由 G-26 D（真 HTTP + `blocked`）与 G-24 B 守着，
     *     而且本组同时断言 `opened === 0`（谁把"未选即弹"加回来，这里立刻变红）。
     *   ⚠ 仍然用**真出口** `okState(classifyPolicyRecord(probe))` 造响应，
     *     ⛔ 不写死 `{ state }`（否则把路由写死成 recorded 时本组不会变红）。
     */
    const { createServer } = await import('node:http')
    let mode = 'unrecorded'
    const probes = {
      recorded: { isHob: true, recorded: true, source: 'stored' },
      unrecorded: { isHob: true, recorded: false, source: 'derived-default' },
      unknown: { isHob: true, recorded: false, source: 'store-unreadable' },
    }
    /**
     * ⚠ 两条轴都要能答：`action:'read'` 走三条 probe，`action:'blocked'` 一律 `clear`
     *   （本组只测"选过没有 ⇒ 横幅"，⛔ 不混进"拦过没有"那条 —— 那是 G-26 D 的地盘）。
     */
    const server = createServer((req, res) => {
      let raw = ''
      req.on('data', (c) => { raw += c })
      req.on('end', () => {
        let action = 'read'
        try { action = String(JSON.parse(raw === '' ? '{}' : raw)?.action ?? 'read') } catch { /* 默认 read */ }
        res.writeHead(200, { 'content-type': 'application/json' })
        if (action === 'blocked') {
          // ⚠ 没被拦过 ⇒ clear（⛔ 不许让它冒充"该弹"）
          res.end(JSON.stringify(stateMod.okState('clear')))
          return
        }
        res.end(JSON.stringify(stateMod.okState(stateMod.classifyPolicyRecord(probes[mode]))))
      })
    })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const port = server.address().port
    const realFetch = globalThis.fetch
    /**
     * ⚠ 默认读取器用的是**相对 URL**（`/api/dsh-hob/session-policy`）——
     *   那在真实浏览器里由同源自动补齐，但在 Node 的 fetch 里没有 base ⇒ 必须在这里补。
     *   ⇒ 只要是以 `/api/` 开头的路径就转到本地端口（⛔ 不改产品源码去适配测试）。
     */
    globalThis.fetch = (url, init) => {
      const s = String(url)
      const abs = s.startsWith('/api/') ? `http://127.0.0.1:${port}${s}` : s
      return realFetch(abs, init)
    }

    const results = {}
    for (const m of ['recorded', 'unrecorded', 'unknown']) {
      mode = m
      const opened = []
      const r = await mount(h(gate.HobUnselectedGate, {
        sessionId: `sess-${m}`,
        agentPreset: 'Hob',
        // ⚠ 不传 readRecorded / readBlocked ⇒ **两条都走真 HTTP 默认实现**
        openForSession: (id) => opened.push(id),
        memory: gate.createGateMemory(),
        blockPollMs: 20,
      }))
      await settle(80)
      results[m] = { opened: opened.length, shown: host.querySelector(`.${gate.GATE_CLASS.root}`) !== null }
      await unmount(r)
    }
    globalThis.fetch = realFetch
    await new Promise((r) => server.close(r))

    /**
     * ⚠ 新口径三句：`unrecorded` ⇒ 显横幅、**弹 0**（这就是 TASK-Q 的靶子）；
     *   `recorded` / `unknown` ⇒ 横幅 0、弹 0。
     */
    const good = results.recorded.opened === 0 && !results.recorded.shown
      && results.unrecorded.opened === 0 && results.unrecorded.shown
      && results.unknown.opened === 0 && !results.unknown.shown
    if (good) {
      ok(`G-19 真读取器三态（**新口径**·TASK-Q）：recorded(弹0/显${results.recorded.shown})`
        + ` · unrecorded(**弹${results.unrecorded.opened}**/显${results.unrecorded.shown})`
        + ` · unknown(弹0/显${results.unknown.shown}) ⇒ **未选只显横幅、⛔ 不自动开窗**`)
    } else {
      bad(`G-19 三态行为不符（新口径：unrecorded 应显横幅且**弹 0**）：${JSON.stringify(results)}`)
    }
  }

  // ── G-20 【任务书第 5 轮 · §三③】非 Hob 端到端：**既不弹、也不显示横幅** ──
  {
    /**
     * ⚠⚠ **它钉的是哪条缝**（与 G-3 的区别，⛔ 别当成重复）：
     *   · G-3 钉的是**客户端早退**：`agentPreset !== 'Hob'` ⇒ **一个请求都不发**、零渲染；
     *   · G-20 钉的是**服务端说不适用**：客户端以为是 Hob（`agentPreset === 'Hob'`），
     *     而**路由回 `not-applicable`** ⇒ 必须同样"不弹、不显示横幅"。
     *
     *   ⚠ 为什么这条缝真实存在：客户端比的是槽给的 `agentPreset` **投影**，
     *     服务端比的是 `svc.get(session).isHob`（同一投影，但**取值时刻不同**）。
     *     会话刚切预设 / 投影尚未推进时，两侧**可以不一致** ——
     *     那正是"该 fail-closed 却被当成未选 ⇒ 误弹"的现场。
     *   ⛔ 绝不允许出现"弹了但因为没数据所以看不见"那种**看起来通过**的形态：
     *     所以下面**同时断言** `opened === 0` **和** 横幅节点数 === 0（两件事分开数）。
     */
    const { createServer } = await import('node:http')
    const server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      // ⚠ 走**真出口**：非 Hob 的 probe ⇒ classify ⇒ 'not-applicable'
      res.end(JSON.stringify(stateMod.okState(
        stateMod.classifyPolicyRecord({ isHob: false, recorded: false, source: 'non-hob' }),
      )))
    })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const port = server.address().port
    const realFetch = globalThis.fetch
    globalThis.fetch = (url, init) => {
      const s = String(url)
      return realFetch(s.startsWith('/api/') ? `http://127.0.0.1:${port}${s}` : s, init)
    }

    const opened = []
    const r = await mount(h(gate.HobUnselectedGate, {
      sessionId: 'sess-not-applicable',
      // ⚠ 客户端**以为**是 Hob ⇒ 不会被 G-3 那条早退挡掉，请求真的会发出去
      agentPreset: 'Hob',
      openForSession: (id) => opened.push(id),
      memory: gate.createGateMemory(),
    }))
    await settle(80)
    const bannerCount = host.querySelectorAll(`.${gate.GATE_CLASS.root}`).length
    await unmount(r)
    globalThis.fetch = realFetch
    await new Promise((r2) => server.close(r2))

    // ⚠ 顺带钉住纯映射（一条读数：'not-applicable' 必须落 'unknown'，⛔ 不是 'unrecorded'）
    const mapped = stateMod.toClientState('not-applicable')
    if (opened.length === 0 && bannerCount === 0 && mapped === 'unknown') {
      ok('G-20 非 Hob 端到端：路由回 not-applicable ⇒ 零弹窗 · 横幅 0 个 · 映射落 unknown（两件事分开数过）')
    } else {
      bad(`G-20 非 Hob 未被挡住：opened=${opened.length} banner=${bannerCount} mapped=${mapped}`)
    }
  }
  // ── G-21 【t10 · 补零覆盖】写入口的两道闸：开放面 + isHob（真调用，非源码正则）──
  /**
   * ══ 它守的是什么（2026-10-24 · 审查席实测：**零覆盖**）══════════════════════════
   *   `src/modules/session-policy-route.ts` 的 `handlePolicyWrite` 在 2026-10-24
   *   补了**两道闸**（P0-3）：① `isOpenReadLevel(level)` 开放面；② `isHob` 会话闸。
   *   ⚠ 而审查席把这两道闸**逐条删掉**后，`check:policy` / `check:hob-gate` /
   *   `check:policy` 一族全绿 —— 也就是说这两道闸**没有任何判据守着**，
   *   而 `check-hob-create-dom` 里还写着"见 check:hob-gate 的 G-21…"（那个 G-21 **不存在**）。
   *
   * ── 做法（⚠ 真调用那个导出函数，⛔ 不扫源码找 `if`）──────────────────────────
   *   `handlePolicyWrite` 是**纯函数**（deps 注入 + body）⇒ 直接 import 真模块调用：
   *     · 合法：Hob 会话 + 开放面内的档 ⇒ `ok:true`，且 `svc.set` **真的被调了一次**；
   *     · 闸①：枚举外的档（`root`）⇒ `ok:false`，且 **`svc.set` 零调用**（零副作用）；
   *     · 闸②：**非 Hob** 会话 + 合法档 ⇒ `ok:false`，且 `svc.set` 零调用；
   *     · 闸②的 fail-closed：判不出是不是 Hob（`svc.get` 抛错 / 返回 undefined）
   *       ⇒ 也要 `ok:false` + 零写（⚠ "判不出"不许当"可以写"）。
   *   ⚠ **删掉任一道闸都会让本组某一条变红**（见下方 G-21(反证) 的逐闸说明）。
   */
  {
    let routeMod
    try {
      routeMod = await import(`file://${join(SRC_ROOT, 'src', 'modules', 'session-policy-route.ts')}`)
    } catch (e) {
      bad(`G-21 无法直载 \`session-policy-route.ts\`（${String(e?.message ?? e)}）⇒ 基准缺失（⛔ 不按通过处理）`)
    }
    if (routeMod !== undefined) {
      const { handlePolicyWrite } = routeMod
      /**
       * ⚠ **受控策略服务假件**：`get(session)` 回该会话的 isHob 视图，`set()` 记调用次数。
       *   ⚠ 与真实现同契约（`svc.get(session)` 收的是**会话对象**、`svc.set(id, level, mode, act)`）。
       */
      const mkSvc = ({ isHob, getThrows }) => {
        const writes = []
        return {
          writes,
          svc: {
            get: (session) => {
              if (getThrows === true) throw new Error('注入：读策略抛错')
              if (isHob === undefined) return undefined
              /**
               * ⚠ **回读必须反映"刚写进去的事实"**（本链第⑨步是"写完回读确认"，
               *   假件若永远回 `recorded:false`，合法路径会被误判为"没落盘"）。
               *   ⚠ 这不是给被测代码开后门 —— 真实服务写成功后 `get()` 就应回 `recorded:true`；
               *     夹具照抄这个契约，才测得到"闸在不在"，而不是测"夹具写没写对"。
               */
              return { isHob, recorded: writes.length > 0, source: writes.length > 0 ? 'stored' : 'derived-default' }
            },
            set: (id, level, workMode, activation) => {
              writes.push({ id, level, workMode, activation })
              return { ok: true, reason: '' }
            },
          },
        }
      }
      const sessionOf = (id) => ({ id, session: { id } })
      /** ⚠ 一个真·枚举外的档位（`PERMISSION_LEVELS` 里没有它）。 */
      const ILLEGAL = 'root'
      /** ⚠ 一个开放面内的档（从生产常量取第一个，⛔ 不写死 `ledger`）。 */
      const openLevels = (() => {
        try {
          const src = readFileSync(join(SRC_ROOT, 'src', 'shared', 'read-level-policy.ts'), 'utf8')
          const m = /OPEN_READ_LEVELS\s*=\s*\[([^\]]*)\]/.exec(src)
          const arr = m === null ? [] : [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
          return arr
        } catch { return [] }
      })()
      const OPEN_LEVEL = openLevels[0]

      /**
       * ⚠⚠ **把"抛异常"当成一种可读的读数**（⛔ 不让检查器崩掉）：
       *   闸被删掉后，最危险的形态有两种 —— ① 照写（越权）；② **未捕获异常**（路由 500、
       *   调用方拿不到可读原因）。两种都必须被本组**判成红**，而不是让脚本崩成 `exit 3`
       *   （那会让"删闸"看起来像"检查器坏了"，与真的"闸在"混不清）。
       *   ⇒ 这里统一捕住，返回 `{ threw: msg }`，由各条断言分别定性。
       */
      /**
       * ⚠ 2026-10-29（包 CA）：`handlePolicyWrite` 已改成 **async**
       *   —— 它写成功之后要 `await svc.requeue(...)`（把被拦下的消息重投）。
       *   ⇒ 这里必须 `await`；⛔ 不 await 会拿到一个 Promise 对象，
       *     所有断言读到的 `ok` 都是 `undefined`（本组 6 条会一起假红）。
       */
      const call = async (svc, { level, id = 'sess-w', mode = 'auto' }) => {
        try {
          return await handlePolicyWrite({ policyOf: () => svc, sessionOf }, { sessionId: id, level, workMode: mode })
        } catch (e) {
          return { ok: false, threw: String(e?.message ?? e) }
        }
      }

      // ① 合法：Hob + 开放面内的档 ⇒ 必须真写一次
      {
        const { svc, writes } = mkSvc({ isHob: true })
        const r = await call(svc, { level: OPEN_LEVEL })
        if (r?.threw !== undefined) {
          bad(`G-21 合法写入**抛异常**（Hob + \`${OPEN_LEVEL}\`）：${r.threw} ⇒ 正常用法被弄坏了`)
        } else if (r?.ok !== true) {
          bad(`G-21 合法写入被拒（Hob + \`${OPEN_LEVEL}\`，在生产开放面内）：${JSON.stringify(r)}`
            + ' ⇒ 闸门过紧（把正常用法也挡死了）')
        } else if (writes.length !== 1) {
          bad(`G-21 合法写入 \`ok:true\` 但 \`svc.set\` 被调 ${writes.length} 次（应 1 次）⇒ 报成功却没落盘`)
        } else {
          ok(`G-21 ✓ **写入口两道闸都在**：Hob + \`${OPEN_LEVEL}\`（生产开放面内）⇒ \`ok:true\` 且 \`svc.set\` 真被调 1 次`
            + '（⚠ 后面三条分别钉"任一道闸删掉就红"）')
        }
      }
      // ② 闸① 开放面：枚举外的档 ⇒ 拒 + 零写
      {
        const { svc, writes } = mkSvc({ isHob: true })
        const r = await call(svc, { level: ILLEGAL })
        if (r?.threw !== undefined) {
          bad(`G-21 闸① 被删掉后变成**未捕获异常**而不是可读拒绝：${r.threw}`
            + '（⚠ 那会让路由 500、调用方拿不到原因 ⇒ 同样算红）')
        } else if (r?.ok !== false) {
          bad(`G-21 闸①（开放面）**不存在**：Hob + 枚举外的档 \`${ILLEGAL}\` 竟然 \`ok:true\``
            + ' ⇒ 请求方自报任意档位就能落盘（⚠ 删掉 `isOpenReadLevel` 那道闸就是这个形态）')
        } else if (writes.length !== 0) {
          bad(`G-21 闸① 拒了却**仍写了 ${writes.length} 次** ⇒ 判断点在副作用之后（⚠ 拒绝必须零副作用）`)
        } else {
          ok(`G-21a ✓ **闸① 开放面**：Hob + 枚举外的档 \`${ILLEGAL}\` ⇒ \`ok:false\` 且 **\`svc.set\` 零调用**`
            + `（拒因可读：${JSON.stringify(String(r.reason ?? '').slice(0, 60))}）`)
        }
      }
      // ③ 闸② isHob：非 Hob ⇒ 拒 + 零写
      {
        const { svc, writes } = mkSvc({ isHob: false })
        const r = await call(svc, { level: OPEN_LEVEL })
        if (r?.threw !== undefined) {
          bad(`G-21 闸② 被删掉后变成**未捕获异常**而不是可读拒绝：${r.threw}（同样算红）`)
        } else if (r?.ok !== false) {
          bad(`G-21 闸②（isHob）**不存在**：**非 Hob** 会话 + 合法档竟然 \`ok:true\``
            + ' ⇒ 本路由越界管了别人（⚠ 删掉 `isHob` 那道闸就是这个形态）')
        } else if (writes.length !== 0) {
          bad(`G-21 闸② 拒了却**仍写了 ${writes.length} 次** ⇒ 拒绝必须零副作用`)
        } else {
          ok('G-21b ✓ **闸② isHob**：**非 Hob** 会话 + 合法档 ⇒ `ok:false` 且 **`svc.set` 零调用**'
            + '（⛔ 不越界管别人的会话）')
        }
      }
      // ④ 闸② 的 fail-closed：判不出是不是 Hob ⇒ 也必须拒（⚠ "判不出"≠"可以写"）
      {
        const cases = [
          { name: 'svc.get 抛错', make: () => mkSvc({ isHob: true, getThrows: true }) },
          { name: 'svc.get 返回 undefined', make: () => mkSvc({ isHob: undefined }) },
        ]
        const bads = []
        for (const c of cases) {
          const { svc, writes } = c.make()
          const r = await call(svc, { level: OPEN_LEVEL })
          if (r?.threw !== undefined) bads.push(`${c.name} ⇒ 未捕获异常（${r.threw}）`)
          else if (r?.ok !== false) bads.push(`${c.name} ⇒ ok:${r?.ok}`)
          else if (writes.length !== 0) bads.push(`${c.name} ⇒ 拒了但仍写 ${writes.length} 次`)
        }
        if (bads.length > 0) {
          bad(`G-21 **判不出是不是 Hob 时没有 fail-closed**：${bads.join(' · ')}`
            + ' ⇒ 写路径上"判不出"必须是拒（⛔ 不许因为判不出就照写）')
        } else {
          ok('G-21c ✓ **判不出就拒**（fail-closed）：`svc.get` 抛错 / 返回 undefined ⇒ 两条都 `ok:false` 且零写')
        }
      }
      /**
       * ⑤ **G-21(反证)**：说明"删掉任一道闸会红"的**因果**，而不是只在注释里声称。
       *   ⚠ 做法（⛔ 不改产品源码）：把上面**四条读数**按"假如闸被删掉"重算，
       *     确认每条闸各自对应**至少一条**会翻转的断言。
       */
      /**
       * ⑥ **跨族引用核对**：本文件里所有 `G-21` 是否真的存在（⛔ 不许"只写信里"）。
       *   ⚠ 这一条的由来（t10 实测）：`check-hob-create-dom.mjs` 曾引用
       *   「`check:hob-gate` 的 G-21…」，而**当时 G-21 根本不存在** —— 直到本轮才真建。
       *   ⇒ 这里做一条**机检**：本文件里必须真的印出 `G-21` 系列的 ok/错行，
       *     且 `check-hob-create-dom.mjs` 里若提到 `G-21`，本文件就必须有它。
       */
      {
        const domSrc = (() => {
          try { return readFileSync(join(root, 'scripts', 'check-hob-create-dom.mjs'), 'utf8') } catch { return '' }
        })()
        /**
         * ══ ⚠⚠ **跨族引用核对：判"真跑过的断言"，⛔ 不判"源码里的标签"**（t11 重写）══
         *
         * ── 改前是什么（两版都错，如实记下）────────────────────────────────
         *   · t10 第一版扫**原文** ⇒ 注释里塞一行 `ok('G-21z ✓…'` 就算一个标签；
         *   · t10 第二版（上一轮我改的）先剥注释再扫 ⇒ 仍然只数**源码文本**：
         *     审查席把闸② 整段放进 `if (false) { … }`（⚠ 断言行**不执行**了），
         *     标签**还在源码里** ⇒ 数出来还是 4 个 ⇒ **26/26 exit 0**。
         *   ⚠ 同一个坑第三、第四次复发 —— 根因始终是「判据在认文本，不认行为」。
         *
         * ── 现在（⚠ 唯一可信的读数 = 运行时台账）──────────────────────────
         *   `executedLabels` 由 `ok()/bad()` **在真被调用时**登记 ⇒ 它只含
         *   **真跑到了**的断言。`if (false)` 里的进不来，注释里的更进不来。
         *   ⇒ 断言：`G-21` / `G-21a` / `G-21b` / `G-21c` **四个都必须真跑过**。
         *   ⚠ 反向也判：若台账里出现没预期的 `G-21*`（多于这四支），说明有人在加断言
         *     却没登记 —— 报出来（防止"悄悄加一条恒真"来凑数）。
         */
        const EXPECTED = ['G-21', 'G-21a', 'G-21b', 'G-21c']
        const ran = EXPECTED.filter((x) => executedLabels.has(x))
        const missing = EXPECTED.filter((x) => !executedLabels.has(x))
        const extra = [...executedLabels].filter((x) => x.startsWith('G-21') && !EXPECTED.includes(x))
        /** ⚠ 别的脚本里**引用了** `G-21`（注释里也算引用 —— 那边是"谁在依赖我"）。 */
        const referencedElsewhere = /G-21/.test(domSrc)
        if (missing.length > 0) {
          bad(`G-21 跨族引用核对：这些 G-21 断言**本轮没有真跑过**：${JSON.stringify(missing)}`
            + `（实际跑到的 = ${JSON.stringify([...executedLabels].filter((x) => x.startsWith('G-21')).sort())}）`
            + '\n      ⇒ ⚠ 可能是被放进 `if (false)` / 被整段删掉 / 被注释掉 —— '
            + '⛔ 源码里留着标签**不算**（审查席实测过这个绕过：26/26 exit 0 而闸② 零判据）')
        } else if (extra.length > 0) {
          bad(`G-21 跨族引用核对：出现未登记的 G-21 断言标签 ${JSON.stringify(extra)}`
            + ' ⇒ 加断言必须同批更新 `EXPECTED`（⛔ 不许用"多印一条"凑数）')
        } else {
          ok(`G-21 跨族引用核对 ✓ **四个断言本轮都真跑过**（${ran.join(' / ')}；读数取 ok()/bad() 的`
            + '运行时台账，⛔ 不数源码文本 ⇒ `if (false)` 与注释都骗不过它）'
            + `${referencedElsewhere ? '，且 `check-hob-create-dom` 对它的引用**有实现兜底**' : ''}`)
        }
      }

      /**
       * ── G-21(反证) ⭐⭐ **真变异**：把闸门源码改坏 ⇒ 同一段判据必须变红 ────────────
       *
       * ══ 改前是什么（t10 造的**空话**，审查席实测：换成纯胡话仍 ✓）══════════════
       *   改前是一个**硬编码三元素数组** `gateMap`，判据只查
       *   `g.kills.startsWith('G-21')` —— `gateMap` 是字面量、`kills` 也是字面量
       *   ⇒ **永远 true**。把它换成纯胡话，照样 `✓ G-21(反证)`。
       *   ⚠ 那正是"判据在认文本、不认行为"的第三次复发。
       *
       * ══ 现在（⚠ 真改产品源码、真跑、真看红）═════════════════════════════════
       *   把 `session-policy-route.ts` 复制到临时目录，**逐条**删掉一道闸，然后
       *   用**同一段调用逻辑**（与 G-21a/b/c 完全同一份判据函数）跑一遍，断言：
       *     · 原样 ⇒ 三道闸都判"拒"；
       *     · **删 `isOpenReadLevel` 分支** ⇒ 枚举外的档**被接受**（判据会红）；
       *     · **删 `isHob` 分支** ⇒ 非 Hob 会话**被接受**（判据会红）；
       *     · **删 fail-closed（`v` 不可用分支）** ⇒ 判不出时**被接受或抛错**（判据会红）。
       *   ⚠ 每一支都要求"变异后读数**确实翻面**"，⛔ 不接受"注释里说会红"。
       *   ⚠ 这一步是**真跑**（import 变异体 + 调 `handlePolicyWrite`），不是读文本。
       */
      {
        const { mkdtempSync, writeFileSync: writeMut, cpSync, rmSync: rmMut } = await import('node:fs')
        const { tmpdir: tmpMut } = await import('node:os')
        let mutRoot = null
        try {
          mutRoot = mkdtempSync(join(tmpMut(), 'hob-g21-mut-'))
          /** ⚠ 整棵 `src/` 复制过去（路由 import 了 `../config.ts` / `../shared/*.ts`）。 */
          cpSync(join(SRC_ROOT, 'src'), join(mutRoot, 'src'), { recursive: true, dereference: true })
          /**
           * ⚠ 变异体也要能解析第三方包（`@deepseek-ai/schemastery` 等，`config.ts` 用到）：
           *   把本仓 `node_modules` 链过去（⚠ 只链，不改）。
           */
          try { (await import('node:fs')).symlinkSync(join(root, 'node_modules'), join(mutRoot, 'node_modules'), 'dir') } catch { /* 已有 */ }

          const ROUTE_REL = join('src', 'modules', 'session-policy-route.ts')
          const original = readFileSync(join(SRC_ROOT, ROUTE_REL), 'utf8')

          /** 与 G-21a/b/c **完全同一份**调用逻辑（⚠ 抽成函数复用，⛔ 不另写近似版）。 */
          const probeFile = async (routePath) => {
            const mod = await import(pathToFileURL(routePath).href)
            const { handlePolicyWrite } = mod
            const mkSvc = ({ isHob, getThrows }) => {
              const writes = []
              return {
                writes,
                svc: {
                  get: () => {
                    if (getThrows === true) throw new Error('注入：读策略抛错')
                    if (isHob === undefined) return undefined
                    return { isHob, recorded: writes.length > 0, source: writes.length > 0 ? 'stored' : 'derived-default' }
                  },
                  set: (id, level, workMode, activation) => { writes.push({ id, level, workMode, activation }); return { ok: true, reason: '' } },
                },
              }
            }
            const sessionOf = (id) => ({ id, session: { id } })
            /** ⚠ 2026-10-29（包 CA）：`handlePolicyWrite` 已 async ⇒ 必须 await（同上方 G-21a/b/c）。 */
            const call = async (svc, { level, id = 'sess-w' }) => {
              try { return await handlePolicyWrite({ policyOf: () => svc, sessionOf }, { sessionId: id, level, workMode: 'auto' }) } catch (e) { return { ok: false, threw: String(e?.message ?? e) } }
            }
            /**
             * 三道闸各跑一次，返回"是否被**可读地**拦住"。
             * ⚠⚠ **`threw` 不算拦住**（t11 订正）：未捕获异常会让路由 500，调用方
             *   拿不到原因 —— 那是"崩了"，⛔ 不是"闸把请求挡下来了"。
             *   ⚠ 我第一版把 `ok === false` 当拦住 ⇒ 删掉 fail-closed 后`v.isHob` 抛
             *   TypeError 也被读成"拦住了" ⇒ **这一支的反证假绿**（当场被本组自己抓到）。
             */
            const blocked = (r) => r.ok === false && r.threw === undefined
            const { svc: s1 } = mkSvc({ isHob: true })
            const gate1 = blocked(await call(s1, { level: 'root' }))
            const { svc: s2 } = mkSvc({ isHob: false })
            const gate2 = blocked(await call(s2, { level: 'ledger' }))
            const { svc: s3 } = mkSvc({ isHob: undefined })
            const gate3 = blocked(await call(s3, { level: 'ledger' }))
            return { gate1, gate2, gate3 }
          }
          /** 在临时副本里把原文替换成变体，写回并跑。 */
          /**
           * ⚠ **每次变异用独立目录**（⛔ 不能把整棵树复制到自己里面 —— 那是无限递归）。
           *   做法：每个变异体各建一个 `mkdtemp`，复制 `src/` + 链 `node_modules`。
           */
          const runMutant = async (name, from, to) => {
            if (!original.includes(from)) return { ok: false, why: `找不到变异靶点（${name}）⇒ 判据已对不上实现` }
            const dir = mkdtempSync(join(tmpMut(), `hob-g21-${name}-`))
            cpSync(join(SRC_ROOT, 'src'), join(dir, 'src'), { recursive: true, dereference: true })
            try { (await import('node:fs')).symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir') } catch { /* 已有 */ }
            const f = join(dir, ROUTE_REL)
            writeMut(f, original.replace(from, to), 'utf8')
            const result = await probeFile(f)
            try { (await import('node:fs')).rmSync(dir, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
            return { ok: true, result }
          }

          const base = await probeFile(join(SRC_ROOT, ROUTE_REL))
          const baseOk = base.gate1 && base.gate2 && base.gate3
          /** ① 删开放面闸（改成恒 false）。 */
          const m1 = await runMutant('nogate1',
            "  if (!isOpenReadLevel(level)) {\n    return badRequest(readLevelNotOpenReason('写入会话策略'))\n  }",
            '  if (false) {\n    return badRequest(readLevelNotOpenReason(\'写入会话策略\'))\n  }')
          /** ② 删 isHob 闸（`v.isHob !== true` ⇒ 恒 false）。 */
          const m2 = await runMutant('nogate2',
            '    if (v.isHob !== true) {',
            '    if (false) {')
          /** ③ 删 fail-closed（`v` 不可用那一支 ⇒ 恒 false）。 */
          const m3 = await runMutant('nogate3',
            "    if (v === undefined || v === null || typeof v !== 'object') {",
            '    if (false) {')

          const expectFlip = (m, gateKey, label) => {
            if (m.ok !== true) return { ok: false, why: m.why }
            const after = m.result[gateKey]
            /** ⚠ 变异后该闸必须**不再拦住**（= 判据会红）。 */
            if (after !== false) return { ok: false, why: `${label}：变异后该闸**仍然拦住**（判据抓不到这个变异）` }
            return { ok: true }
          }
          const f1 = expectFlip(m1, 'gate1', '删开放面闸')
          const f2 = expectFlip(m2, 'gate2', '删 isHob 闸')
          const f3 = expectFlip(m3, 'gate3', '删 fail-closed')

          if (!baseOk) {
            bad(`G-21(反证) 【失去靶子】原实现三道闸并未全拦住（open=${base.gate1} · isHob=${base.gate2} · failClosed=${base.gate3}）`
              + ' ⇒ 反证没有可比对的基线，不按通过处理')
          } else if (!f1.ok || !f2.ok || !f3.ok) {
            bad(`G-21(反证) 【判据抓不到变异】${[f1, f2, f3].filter((x) => !x.ok).map((x) => x.why).join(' · ')}`
              + '\n      ⇒ ⚠ 这说明"删掉那道闸"不会让本组变红 —— 那条闸实际**没有判据守着**')
          } else {
            ok('G-21(反证) ✓✓ **真变异自证**（⛔ 不是硬编码数组）：把 `session-policy-route.ts` 复制到临时目录，'
              + '逐条改坏后**真 import 真调用** `handlePolicyWrite` —— '
              + '删开放面闸 ⇒ 枚举外的档**被接受**；删 isHob 闸 ⇒ 非 Hob **被接受**；删 fail-closed ⇒ 判不出**被接受/抛错**'
              + ' ⇒ 三条闸各自都有判据接得住（⚠ 这三支正是 G-21a/b/c 会变红的原因）')
          }
        } catch (e) {
          bad(`G-21(反证) 变异自证跑不起来（${String(e?.message ?? e)}）⇒ 不按通过处理（⛔ 跑不起来 ≠ 通过）`)
        } finally {
          if (mutRoot !== null) {
            try { (await import('node:fs')).rmSync(mutRoot, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
          }
        }
      }
    }
  }
  // ── G-22 【包 BZ · CHG-185】发送时闸门 `agent/pre-step` 的判据（真调用，⛔ 非正则）──
  /**
   * ══ 它守的是什么（2026-10-29 · 包 BZ）══════════════════════════════════════════
   *   `src/session-policy-service.ts` 装了 `agent/pre-step` 闸门，判据**只有两条**：
   *     ① `isHob === true`；② `source === 'derived-default'`（= 还没选档）。
   *   ⚠ 其余一律 `next()` —— 特别是**非 Hob**（误拦普通用户消息比不做更糟）。
   *
   * ══ 为什么必须真调 `resolveSessionPolicy` 而不是抓源码字符串 ═══════════════════
   *   "源码里有 `derived-default` 这个词"证明不了判据对：把两条件写成 `||`、
   *   或把 `!==` 写成 `===`，正则**一个字都不会变**。
   *   ⇒ 这里用**真判定函数**跑四类会话，逐类核对闸门的 `reject / next`。
   *
   * ⚠ 四类必须**各不相同的 source**，缺一类就测不出"误拦"：
   *   non-hob / derived-default / stored / no-identity。
   */
  {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const spMod = await import('../src/server/session-policy.ts')
    const dir = mkdtempSync(join(tmpdir(), 'hob-g22-'))
    const file = join(dir, 'policy.json')
    const now = Date.now()
    const OPT = {
      levels: ['ledger', 'project', 'workspace'],
      modes: ['auto', 'single', 'multi'],
      floorLevel: 'ledger',
      defaultMode: 'auto',
    }
    const base = { ...OPT, file, archived: 'not-archived', fallbackEpoch: now, now }
    /** ⚠ 判据**逐字复制**自 `session-policy-service.ts` 的实现（两处必须同步）。 */
    const gateDecision = (r) => (r.isHob === true && r.source === 'derived-default') ? 'reject' : 'next'
    const rows = []
    try {
      rows.push(['非 Hob', gateDecision(spMod.resolveSessionPolicy({ ...base, sessionId: 'g1', isHob: false })), 'next'])
      writeFileSync(file, JSON.stringify({ version: 1, migrationEpoch: now, sessions: {} }))
      rows.push(['Hob 未选档', gateDecision(spMod.resolveSessionPolicy({ ...base, sessionId: 'g2', isHob: true, createdAt: now })), 'reject'])
      writeFileSync(file, JSON.stringify({
        version: 1, migrationEpoch: now,
        sessions: { g3: { level: 'workspace', workMode: 'auto', origin: 'explicit', at: now } },
      }))
      rows.push(['Hob 已选档', gateDecision(spMod.resolveSessionPolicy({ ...base, sessionId: 'g3', isHob: true, createdAt: now })), 'next'])
      rows.push(['判不出', gateDecision(spMod.resolveSessionPolicy({ ...base, file: undefined, sessionId: 'g4', isHob: true })), 'next'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    const wrong = rows.filter(([, got, want]) => got !== want)
    if (wrong.length === 0) {
      ok(`G-22 ✓ 发送时闸门判据四类各对：${rows.map(([k, g]) => `${k}=${g}`).join(' · ')}`
        + '（非 Hob / 已选 / 判不出 全放行，只有 Hob 未选档拦）'
        + ' ⚠ 本组测的是"逐字复刻"的实现（抄自 session-policy-service.ts:1432），对真源码漂移是盲的')
    } else {
      bad(`G-22 ⚠ 发送时闸门判据错 ${wrong.length} 类：`
        + wrong.map(([k, got, want]) => `${k} 实为 ${got} 应为 ${want}`).join(' / ')
        + ' —— ⚠ 误拦普通会话比不做更糟')
    }
  }

  // ── G-23 【包 CA · CHG-186】选完档 ⇒ 被拦下的消息**按序重投并清空暂存**（真跑）──
  /**
   * ══ 它守的是什么（2026-10-29 · 包 CA）══════════════════════════════════════════
   *   闸门 `reject` ⇒ 宿主**丢弃**该消息（`runtime-types.d.ts:267-270`）
   *   ⇒ 若不先留副本、选完不重投，**用户每发一条就丢一条**（比不做更糟）。
   *   本组守四件事，**缺一条都会出现"看不见的丢消息"**：
   *     ① 连发两条**都留住**（⛔ 只留最后一条 = 更隐蔽的丢消息）；
   *     ② 重投**按到达顺序**（⛔ 乱序 = 用户说的和模型看到的不一样）；
   *     ③ 重投时**带绕行标记**（否则再被自己拦一次 ⇒ 死循环）；
   *     ④ 投完**暂存清空**（⛔ 不清 ⇒ 下次选档把旧消息又发一遍）。
   *
   * ⚠ **真跑**：直接用模块导出的暂存 API + 假 agent 捕获 `followup` 实参，
   *   ⛔ 不读源码字符串（写法对了但顺序反了，正则一样通过）。
   */
  {
    let spMod
    try { spMod = await import('../src/session-policy-service.ts') } catch (e) {
      bad(`G-23 载不到 session-policy-service（${String(e?.message ?? e)}）⇒ 不按通过处理`)
      spMod = null
    }
    if (spMod !== null) {
      const S = 'sess-g23'
      spMod.clearPendingMessages(S)
      // ① 连发两条都留住
      spMod.stagePendingMessage(S, [{ type: 'text', text: '甲' }])
      spMod.stagePendingMessage(S, [{ type: 'text', text: '乙' }])
      const staged = spMod.pendingMessagesOf(S)
      // ② 顺序
      const order = staged.map((x) => x.content?.[0]?.text).join(',')
      if (staged.length !== 2) {
        bad(`G-23 ⚠ 连发两条只留住 ${staged.length} 条 ⇒ 有一条会永久消失（比不做更糟）`)
      } else if (order !== '甲,乙') {
        bad(`G-23 ⚠ 暂存顺序 = ${JSON.stringify(order)}（应 甲,乙）⇒ 重投会乱序`)
      } else {
        // ③④ 真投：假 agent 捕获 followup，并在投递瞬间检查绕行标记
        let svc = null
        const delivered = []
        const fakeAgent = {
          followup(msg) {
            delivered.push({ text: msg?.content?.[0]?.text, requeueing: spMod.requeueingSessions().includes(S) })
          },
        }
        const fakeCtx = {
          on() {}, logger: { info() {}, warn() {} },
          get(n) {
            if (n === 'agents') return { get: (id) => (id === S ? fakeAgent : undefined) }
            return undefined
          },
          provide(_n, v) { svc = v },
          effect() {},
        }
        spMod.installSessionPolicy(fakeCtx, { workMode: () => 'auto' })
        const r = await svc.requeue(S)
        const after = spMod.pendingMessagesOf(S).length
        const allFlagged = delivered.length > 0 && delivered.every((d) => d.requeueing)
        const order2 = delivered.map((d) => d.text).join(',')
        if (r?.replayed !== 2 || order2 !== '甲,乙') {
          bad(`G-23 ⚠ 重投异常：replayed=${r?.replayed} 顺序=${JSON.stringify(order2)}（应 2 条且 甲,乙）`)
        } else if (!allFlagged) {
          bad('G-23 ⚠ 重投时**没有**带绕行标记 ⇒ 会被自己的闸再拦一次 ⇒ 永远选不完（死循环）')
        } else if (after !== 0) {
          bad(`G-23 ⚠ 投完暂存仍有 ${after} 条 ⇒ 下次选档会把旧消息又发一遍`)
        } else {
          ok('G-23 ✓ 连发两条都留住 · 按序 甲,乙 重投 · 每条都带绕行标记（不会死循环）· 投完暂存=0')
        }
        spMod.clearPendingMessages(S)
      }
    }
  }

  /**
   * ══ G-28 ⭐ **部分重投不许重复发**（2026-10-31 P37 · 审计 `CHG-313` 查出的真 bug）══
   *
   * ── 病（改前的实际行为）────────────────────────────────────
   *   `requeue()` 逐条从**原队列**重投，成功后**只 `replayed += 1`，不从队列移除**；
   *   「全成功」时在 `finally` 清整队，**部分失败时保留完整旧队列**：
   *     · 队列 `[甲, 乙]`，甲成功、乙抛错
   *     · 返回 `{ replayed: 1, remaining: 1 }`
   *     · ⚠ **但暂存仍是 `[甲, 乙]`** ⇒ **下次重投会把甲再发一遍**
   *   ⇒ 用户看到的是「我选完档，同一条消息发了两遍」。
   *
   * ── 本组怎么证明（⚠ 行为读数，⛔ 不 grep 源码）──────────────
   *   真建两条暂存 ⇒ 让假 agent 的 `followup` **第二条抛错** ⇒ 重投一次 ⇒
   *   断言两件：
   *     ① 第一次重投：甲被投出、乙抛错 ⇒ `replayed === 1`；
   *     ② **暂存里必须只剩乙**（甲已消费掉）⇒ ⛔ 不能还是 `[甲,乙]`；
   *   然后再重投一次 ⇒ 断言：**甲不能再被投第二次**（`delivered` 里 `甲` 只出现一次）。
   *
   * ⚠ ② 就是审计说的那一步：改前 `remaining` 虽是 1，但**暂存仍是 2 条** ⇒ 第二次重投必重发甲。
   */
  {
    let spMod2
    try { spMod2 = await import('../src/session-policy-service.ts') } catch (e) {
      bad(`G-28 载不到 session-policy-service（${String(e?.message ?? e)}）⇒ 不按通过处理`)
      spMod2 = null
    }
    if (spMod2 !== null) {
      const S2 = 'sess-g28-partial'
      spMod2.clearPendingMessages(S2)
      spMod2.stagePendingMessage(S2, [{ type: 'text', text: '甲' }])
      spMod2.stagePendingMessage(S2, [{ type: 'text', text: '乙' }])
      const delivered2 = []
      /** ⚠ 第二条（乙）抛错 —— 精确模拟"部分失败"。 */
      const fakeAgent2 = {
        followup(msg) {
          const t = msg?.content?.[0]?.text
          if (t === '乙') throw new Error('模拟：第二条重投失败')
          delivered2.push(t)
        },
      }
      let svc2 = null
      const fakeCtx2 = {
        on() {}, logger: { info() {}, warn() {} },
        get(n) {
          if (n === 'agents') return { get: (id) => (id === S2 ? fakeAgent2 : undefined) }
          return undefined
        },
        provide(_n, v) { svc2 = v },
        effect() {},
      }
      spMod2.installSessionPolicy(fakeCtx2, { workMode: () => 'auto' })
      const r1 = await svc2.requeue(S2)
      const after1 = spMod2.pendingMessagesOf(S2).map((x) => x.content?.[0]?.text)
      // 再投一次（⚠ 这次乙仍会抛错；关键看**甲会不会被再发一次**）
      let r2 = null
      try { r2 = await svc2.requeue(S2) } catch { r2 = null }
      const deliveredAll = delivered2.join(',')
      const jiaCount = delivered2.filter((t) => t === '甲').length
      const probs = []
      if (r1?.replayed !== 1) probs.push(`第一次重投 replayed 应为 1，实际 ${r1?.replayed}`)
      // ① 甲必须已被消费掉
      if (JSON.stringify(after1) !== JSON.stringify(['乙'])) {
        probs.push(`第一次重投后暂存应为 ["乙"]（甲已消费），实际 ${JSON.stringify(after1)} ⇒ ⚠ 甲会被再发一次`)
      }
      // ② 更硬的读数：整个过程中甲只能出现一次
      if (jiaCount !== 1) {
        probs.push(`甲被投递了 ${jiaCount} 次（应恰好 1 次）⇒ **部分重投重复发消息**`)
      }
      if (probs.length === 0) {
        ok(`G-28 ✓ 部分重投**不重复发**：队列 [甲,乙] 乙失败 ⇒ 暂存变 ${JSON.stringify(after1)}`
          + ` · 甲全程只投 **1** 次（实 ${jiaCount} 次）· 第二次重投 delivered=${JSON.stringify(deliveredAll)}`)
      } else for (const x of probs) bad(`G-28 · ${x}`)
      spMod2.clearPendingMessages(S2)
    }
  }

  /**
   * ══ G-29 ⭐ **会话销毁清暂存 + 队列上限**（2026-10-31 P37 · 审计 `CHG-313` 第 2 条）══
   *
   * ── 病（改前）────────────────────────────────────────────────
   *   注释承诺"会话关闭时清空暂存"，但**全仓没装销毁监听**
   *   ⇒ 用户放弃会话后，那条被拦的消息**留到宿主进程重启**。
   *
   * ── 本组怎么证明（行为读数）────────────────────────────────
   *   ① **真派发 `agent/disposed`** ⇒ 该 sid 的暂存必须变空；
   *   ② 别的 sid 的暂存**不受牵连**（⛔ 不许一刀切清全表）；
   *   ③ **上限真生效**：连塞超过 `PENDING_MAX_PER_SESSION` 条 ⇒ 队列长度被压在 32，
   *      且**留下的是最新的**（⚠ 丢最旧，⛔ 不是丢新）。
   */
  {
    let sp3
    try { sp3 = await import('../src/session-policy-service.ts') } catch (e) {
      bad(`G-29 载不到 session-policy-service（${String(e?.message ?? e)}）⇒ 不按通过处理`)
      sp3 = null
    }
    if (sp3 !== null) {
      const probs = []
      const SA = 'sess-g29-a'
      const SB = 'sess-g29-b'
      sp3.clearPendingMessages(SA); sp3.clearPendingMessages(SB)
      sp3.stagePendingMessage(SA, [{ type: 'text', text: '甲的待投' }])
      sp3.stagePendingMessage(SB, [{ type: 'text', text: '乙的待投' }])
      // 装监听：⚠ 真调 installSessionPolicy（它内部装 agent/disposed）
      const handlers = new Map()
      const fakeCtx3 = {
        on(ev, fn) { handlers.set(ev, fn); return () => handlers.delete(ev) },
        logger: { info() {}, warn() {} },
        get() { return undefined },
        provide() {},
        effect() {},
      }
      sp3.installSessionPolicy(fakeCtx3, { workMode: () => 'auto' })
      // ① 事件名必须是真实的 agent/disposed（⛔ 不是 session/disposed）
      if (!handlers.has('agent/disposed')) {
        probs.push(`没装名为 \`agent/disposed\` 的监听（已装：${JSON.stringify([...handlers.keys()])}）`)
      } else {
        // 真派发
        handlers.get('agent/disposed')({ agent: { id: SA } })
        const aLeft = sp3.pendingMessagesOf(SA).length
        const bLeft = sp3.pendingMessagesOf(SB).length
        if (aLeft !== 0) probs.push(`会话销毁后 SA 暂存仍有 ${aLeft} 条 ⇒ ⚠ 会留到进程重启`)
        // ② 不许牵连别的会话
        if (bLeft !== 1) probs.push(`销毁 SA 把 SB 的暂存也清了（剩 ${bLeft}，应 1）⇒ ⛔ 一刀切清全表`)
      }
      // ③ 条数上限
      const SC = 'sess-g29-cap'
      sp3.clearPendingMessages(SC)
      const N = sp3.PENDING_MAX_PER_SESSION
      if (typeof N !== 'number' || N <= 0) probs.push(`PENDING_MAX_PER_SESSION 应为正数，实际 ${JSON.stringify(N)}`)
      else {
        for (let i = 0; i < N + 8; i += 1) sp3.stagePendingMessage(SC, [{ type: 'text', text: `m${i}` }])
        const q = sp3.pendingMessagesOf(SC)
        if (q.length > N) probs.push(`连塞 ${N + 8} 条后队列仍有 ${q.length} 条（上限 ${N}）⇒ 上限没生效`)
        // 丢最旧 ⇒ 最后一条必须还在，第一条必须没了
        const texts = q.map((x) => x.content?.[0]?.text)
        if (!texts.includes(`m${N + 7}`)) probs.push(`超限后**最新**那条 m${N + 7} 丢了 ⇒ 丢的是新不是旧`)
        if (texts.includes('m0')) probs.push('超限后**最旧**那条 m0 还在 ⇒ 没丢最旧（上限只是记数）')
        // 总字符上限也要存在且是正数
        const C = sp3.PENDING_MAX_TOTAL_CHARS
        if (typeof C !== 'number' || C <= 0) probs.push(`PENDING_MAX_TOTAL_CHARS 应为正数，实际 ${JSON.stringify(C)}`)
      }
      sp3.clearPendingMessages(SA); sp3.clearPendingMessages(SB); sp3.clearPendingMessages(SC)
      if (probs.length === 0) {
        ok(`G-29 ✓ 会话销毁**真清**暂存（\`agent/disposed\` ⇒ SA 归 0，SB 不受牵连）`
          + ` · 上限真生效（${sp3.PENDING_MAX_PER_SESSION} 条 / ${sp3.PENDING_MAX_TOTAL_CHARS} 字符，超限**丢最旧**、最新仍在）`)
      } else for (const x of probs) bad(`G-29 · ${x}`)
    }
  }

  /**
   * ── G-24 【TASK-E · 判据 A–E】「被拦 → 可读状态 → 界面开弹窗」整条链 ──────────
   *
   * ⚠⚠ **为什么这一组必须是行为读数**（任务书 §二 明写"⛔ 不许用'检查绿'代替 A–E"）：
   *   A–E 要的是"点发送之后发生了什么"，⛔ 不是"源码里有没有某行"。
   *   ⇒ 全部**真跑**：真 `markBlocked` / 真 `readBlocked` / 真 `handlePolicyBlockQuery`，
   *     外加**真 DOM 挂载** gate 组件验"弹不弹"。
   *
   * ── 判据与它的靶子 ────────────────────────────────────────────────────
   *   A 改前红：**不写被拦状态** ⇒ `blocked` 查询恒 `clear` ⇒ 不弹（这就是改前的形态）。
   *   B 改后绿：写了 ⇒ 查询回 `blocked` ⇒ 组件**自动开窗**。
   *   C 不重不漏：选完档 ⇒ 清掉记录 ⇒ 不再弹；且 `recorded` 一旦为真 ⇒ 直接 `clear`。
   *   D 不误弹：非 Hob · 已选档 · `source=stored`（旧会话）⇒ 全 `clear`，一次都不弹。
   *   E 负向对拍：把 A 那一步的写入去掉 ⇒ **B 必须变红**（本组的靶子是真的）。
   */
  {
    let blk
    try {
      blk = await import('../src/server/policy-block-log.ts')
    } catch (e) {
      blk = null
      bad(`G-24 载不到 policy-block-log（${String(e?.message ?? e)}）⇒ 不按通过处理`)
    }
    let routeMod24
    try {
      routeMod24 = await import('../src/modules/session-policy-route.ts')
    } catch {
      routeMod24 = null
    }
    if (blk !== null && typeof routeMod24?.handlePolicyBlockQuery === 'function') {
      const { mkdirSync } = await import('node:fs')
      const dir = join(work, 'g24')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, 'session-policy-blocks.json')
      const S = 'sess-g24-hob'

      /** 假策略服务：`recorded` / `isHob` 可调（⚠ 这就是"选过没有"那根轴）。 */
      const fakeSvc = (opts) => ({
        get: () => ({
          isHob: opts.isHob,
          recorded: opts.recorded,
          source: opts.source ?? (opts.recorded ? 'stored' : 'derived-default'),
        }),
      })
      /** 跑一次 "blocked" 查询（真源码函数，⛔ 非正则）。 */
      const queryBlocked = (opts) => routeMod24.handlePolicyBlockQuery({
        policyOf: () => fakeSvc(opts),
        sessionOf: () => ({ id: S }),
        blockFileOf: () => file,
      }, { action: 'blocked', sessionId: S })

      // ── A · 改前红：**不写被拦状态** ⇒ 恒 clear ⇒ 不弹 ──────────────────
      {
        const r = queryBlocked({ isHob: true, recorded: false })
        if (r?.state === 'clear') {
          ok('G-24 A ✓ **改前红**：不写"被拦过" ⇒ `blocked` 查询回 `clear` ⇒ 界面**不会**弹'
            + '（⚠ 这正是改前的形态 —— 闸门 reject 了但前端无从得知）')
        } else {
          bad(`G-24 A ⚠ 改前形态应回 clear，实际回 ${JSON.stringify(r?.state)}`
            + ' ⇒ 该读数不能证明"改前是红的"（判据靶子不清）')
        }
      }

      // ── B · 改后绿：写了 ⇒ blocked；且**真 DOM 挂载**下组件会自动开窗 ────
      {
        const w = blk.markBlocked(file, S)
        if (!w.ok) {
          bad(`G-24 B ⚠ 写"被拦过"失败：${w.reason}`)
        } else {
          const r = queryBlocked({ isHob: true, recorded: false })
          if (r?.state !== 'blocked') {
            bad(`G-24 B ⚠ 写完"被拦过"后查询仍是 ${JSON.stringify(r?.state)}（应 blocked）`)
          } else {
            // ⚠ **真组件**：真源码 gate 组件 + 假 reader，读到 blocked ⇒ 自动开窗
            const gateMod = await import(needEntry('src/client/hob-unselected-gate.tsx'))
            const opened = []
            const el = React.createElement(gateMod.HobUnselectedGate, {
              sessionId: S,
              agentPreset: gateMod.HOB_PRESET_ID_FOR_MATCH,
              readRecorded: async () => 'unrecorded',
              readBlocked: async () => (r.state === 'blocked' ? 'blocked' : 'clear'),
              blockPollMs: 20,
              openForSession: (id) => { opened.push(id) },
              memory: gateMod.createGateMemory(),
              autoOpen: true,
            })
            const root2 = createRoot(document.createElement('div'))
            await act(async () => { root2.render(el) })
            await act(async () => { await new Promise((res) => setTimeout(res, 120)) })
            await act(async () => { root2.unmount() })
            if (opened.length === 1 && opened[0] === S) {
              ok('G-24 B ✓ **改后绿**：写入后 `blocked` 查询回 `blocked`，真组件在 `unrecorded` + blocked 下'
                + `**自动开窗一次**（opened=${JSON.stringify(opened)}）`)
            } else {
              bad(`G-24 B ⚠ 组件没按预期开窗（opened=${JSON.stringify(opened)}，应恰好 1 次且是 ${S}）`)
            }
          }
        }
      }

      // ── B2 · 常驻轮询实例（横幅 false）：hero 卸载后仍能因 blocked 弹窗 ──
      {
        const gateMod2 = await import(needEntry('src/client/hob-unselected-gate.tsx'))
        const opened2 = []
        const rootB2 = createRoot(document.createElement('div'))
        await act(async () => {
          rootB2.render(React.createElement(gateMod2.HobUnselectedGate, {
            sessionId: S,
            agentPreset: gateMod2.HOB_PRESET_ID_FOR_MATCH,
            readRecorded: async () => 'unrecorded',
            readBlocked: async () => 'blocked',
            blockPollMs: 20,
            openForSession: (id) => { opened2.push(id) },
            memory: gateMod2.createGateMemory(),
            autoOpen: true,
            showBanner: false,
          }))
        })
        await act(async () => { await new Promise((res) => setTimeout(res, 100)) })
        const banner2 = document.querySelectorAll(`.${gateMod2.GATE_CLASS.root}`).length
        await act(async () => { rootB2.unmount() })
        if (opened2.length === 1 && opened2[0] === S && banner2 === 0) {
          ok('G-24 B2 ✓ 常驻轮询实例（showBanner=false）读到 blocked ⇒ 自动开窗 1 次，且不渲染横幅')
        } else {
          bad(`G-24 B2 · opened=${JSON.stringify(opened2)} banner=${banner2}`)
        }
      }

      // ── C · 不重不漏：选完档 ⇒ 不再弹 ─────────────────────────────────
      {
        const c = blk.clearBlocked(file, S)
        const afterClear = queryBlocked({ isHob: true, recorded: true })
        const afterClearUnrecorded = queryBlocked({ isHob: true, recorded: false })
        if (!c.ok) {
          bad(`G-24 C ⚠ 清"被拦过"失败：${c.reason}`)
        } else if (afterClear?.state !== 'clear' || afterClearUnrecorded?.state !== 'clear') {
          bad(`G-24 C ⚠ 选完档仍会弹（recorded=true ⇒ ${JSON.stringify(afterClear?.state)}；`
            + `清理后 recorded=false ⇒ ${JSON.stringify(afterClearUnrecorded?.state)}）`)
        } else {
          ok('G-24 C ✓ 选完档后 `recorded=true` ⇒ 直接 clear（⛔ 不看被拦记录）· 清理后也不再弹'
            + '（⚠ 重投那条由 G-23 独立钉着，本组不重复）')
        }
      }

      // ── D · 不误弹：非 Hob / 已选过 / 旧会话 stored ────────────────────
      {
        const cases = [
          { name: '非 Hob', opts: { isHob: false, recorded: false }, want: 'clear' },
          { name: '已选过档', opts: { isHob: true, recorded: true }, want: 'clear' },
          { name: '旧会话 stored', opts: { isHob: true, recorded: true, source: 'stored' }, want: 'clear' },
        ]
        const wrong = []
        for (const cs of cases) {
          const r = queryBlocked(cs.opts)
          if (r?.state !== cs.want) wrong.push(`${cs.name}→${JSON.stringify(r?.state)}`)
        }
        if (wrong.length === 0) {
          ok(`G-24 D ✓ 三类**都不弹**：${cases.map((c) => c.name).join(' / ')} ⇒ 全 clear`)
        } else {
          bad(`G-24 D ⚠ 误弹：${wrong.join(' / ')}（应全 clear）`)
        }
      }

      // ── E · 负向对拍：去掉"写入"那一步 ⇒ B 必须变红 ────────────────────
      {
        const file2 = join(dir, 'neg.json')
        // ⚠ 模拟"把写入去掉"：只查询、**完全不 markBlocked**
        const neg = routeMod24.handlePolicyBlockQuery({
          policyOf: () => fakeSvc({ isHob: true, recorded: false }),
          sessionOf: () => ({ id: S }),
          blockFileOf: () => file2,
        }, { action: 'blocked', sessionId: S })
        if (neg?.state === 'clear') {
          ok('G-24 E ✓ **负向对拍**：摘掉"写被拦状态"那一步 ⇒ 查询恒 `clear` ⇒ B 的自动开窗**必不成立**'
            + '（⇒ 证明 B 绿**真的接在**那次写入上，⛔ 不是别的东西凑出来的）')
        } else {
          bad(`G-24 E ⚠ 摘掉写入后仍回 ${JSON.stringify(neg?.state)} ⇒ B 的绿与写入**无关** ⇒ 判据没牙`)
        }
      }

      // ── 写失败**不许静默**（本单 §二 第 1 条硬要求）────────────────────
      {
        const r = blk.markBlocked(undefined, S)
        if (r.ok === false && String(r.reason).length > 0) {
          ok(`G-24 F ✓ 判不出落点 ⇒ **可读失败**（不静默）：「${String(r.reason).slice(0, 50)}…」`)
        } else {
          bad('G-24 F ⚠ 写失败被静默了（应返回 ok:false + 可读 reason）')
        }
      }
    }
  }

  /**
   * ── G-25 【TASK-K · 判据 A–F】闸门触发条件 = 「用户选没选」，⛔ 不是「迁移归属」──────
   *
   * ⚠⚠ **本组的输入全部取自真盘**（任务书 §三 硬要求）：
   *   · `migrationEpoch` ← `runtime/session-policy.json` 的真值；
   *   · 会话 `createdAt` ← 真会话事件流建档头；
   *   ⛔ **不在夹具里写常数**。
   *
   * ⚠ 为什么必须这样：`CHG-204` 的 A–E 全绿而真机不弹，正因为夹具把输入设成了
   *   "新建会话"的理想值（`createdAt` = now ⇒ `source='derived-default'`）。
   *   真机那条会话是**旧会话**（`createdAt` 早于纪元）⇒ 旧判据恒放行。
   */
  {
    let spMod25
    try {
      spMod25 = await import('../src/session-policy-service.ts')
    } catch (e) {
      spMod25 = null
      bad(`G-25 载不到 session-policy-service（${String(e?.message ?? e)}）⇒ 不按通过处理`)
    }
    if (spMod25 !== null) {
      const fsMod = await import('node:fs')
      const zlibMod = await import('node:zlib')
      const dir = join(work, 'g25')
      fsMod.mkdirSync(dir, { recursive: true })
      const policyFile = join(dir, 'session-policy.json')
      const blockFile = join(dir, 'session-policy-blocks.json')

      // ── 真盘输入：migrationEpoch（⛔ 不写常数）──
      const REAL_STORE = '/home/lk/.dsh/hob-ledgers/dsh-hob/runtime/session-policy.json'
      let realEpoch
      try { realEpoch = JSON.parse(fsMod.readFileSync(REAL_STORE, 'utf8')).migrationEpoch } catch { realEpoch = undefined }

      // ── 真会话的 createdAt（从事件流建档头取，⛔ 不写常数）──
      const REAL_ZSTD = '/home/lk/.dsh/sessions/--home-lk-FF-dsh-hob--/session-e6dfdf31-a854-4a38-9795-9956111b8a91/session.v4.jsonl.zstd'
      let realCreatedAt
      try {
        const buf = fsMod.readFileSync(REAL_ZSTD)
        const st = []
        for (let i = 0; i < buf.length - 3; i++) {
          if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) st.push(i)
        }
        let out = ''
        for (let k = 0; k < st.length; k++) {
          const e = k + 1 < st.length ? st[k + 1] : buf.length
          try { out += zlibMod.zstdDecompressSync(buf.subarray(st[k], e)).toString('utf8') } catch { /* 跳过坏帧 */ }
        }
        const first = out.split('\n').filter(Boolean)
          .map((l) => { try { return JSON.parse(l) } catch { return undefined } })
          .find((o) => o?.type === 'session')
        realCreatedAt = first?.createdAt
      } catch { realCreatedAt = undefined }

      if (realEpoch === undefined || realCreatedAt === undefined) {
        bad(`G-25 基准 ⚠ 取不到真盘输入（migrationEpoch=${realEpoch} · createdAt=${realCreatedAt}）`
          + ' ⇒ 不按通过处理（⛔ 不写常数顶替）')
      } else {
        ok(`G-25 基准 ✓ 真盘输入：migrationEpoch=${realEpoch} · 目标会话 createdAt=${realCreatedAt}`
          + `（⇒ createdAt ${realCreatedAt < realEpoch ? '**早于**' : '晚于'}纪元 = 真机形态）`)

        const SID_EARLY = 'sess-g25-early'
        const SID_LATE = 'sess-g25-late'
        const SID_REC = 'sess-g25-recorded'
        const OPTIONS = {
          levels: ['floor', 'ledger', 'workspace'],
          floorLevel: 'floor',
          defaultMode: 'auto',
          modes: ['auto', 'multi', 'single'],
        }
        const { readPolicyStore } = await import('../src/server/session-policy.ts')

        /**
         * ⚠ handler 第 ② 条判据的**逐字复刻**（三档）——
         *   与 `src/session-policy-service.ts` 里 `recordState` 那个闭包一一对应：
         *   空 id / 无 file / 读不出 ⇒ `undecidable`；`reachability !== 'ok'` ⇒ `undecidable`；
         *   记录在 ⇒ `recorded`；记录不在 ⇒ `absent`。
         *   ⚠ 为什么不真调 handler：它是闭包、绑在 `ctx.on('agent/pre-step')` 上，
         *     要真调就得造整个 cordis ctx + agent。⇒ 本组用 F 的**负向对拍**证明这段复刻
         *     与旧判据**在真盘输入下给出不同结论**（若复刻错了，F 不会成立）。
         */
        const gateSecond = (file, sid) => {
          if (sid === '') return 'undecidable'
          if (file === undefined) return 'undecidable'
          const rd = (() => { try { return readPolicyStore(file, OPTIONS) } catch { return undefined } })()
          if (rd === undefined) return 'undecidable'
          if (rd.reachability !== 'ok') return 'undecidable'
          return rd.file.sessions[sid] === undefined ? 'absent' : 'recorded'
        }

        const seed = {
          version: 1,
          migrationEpoch: realEpoch,
          sessions: { 'sess-other': { level: 'ledger', workMode: 'auto', origin: 'legacy-migrated', at: realEpoch } },
        }
        fsMod.writeFileSync(policyFile, JSON.stringify(seed, null, 2), 'utf8')

        // ── A · isHob=true · 无记录 · createdAt 早于纪元（真机形态）⇒ 必须拦 ──
        {
          const g = gateSecond(policyFile, SID_EARLY)
          if (g === 'absent') {
            const blk = await import('../src/server/policy-block-log.ts')
            const w = blk.markBlocked(blockFile, SID_EARLY)
            const rd = blk.readBlocked(blockFile, SID_EARLY)
            if (!w.ok) bad(`G-25 A ⚠ 该拦但 markBlocked 写失败：${w.reason}`)
            else if (rd.state !== 'blocked') bad(`G-25 A ⚠ 拦了但 blocks.json 里查不到（state=${rd.state}）`)
            else ok(`G-25 A ✓ **真机形态**（createdAt ${realCreatedAt} 早于纪元 ${realEpoch}）· 无记录`
              + ' ⇒ 判据=absent ⇒ **拦** · markBlocked 已调用 · blocks.json 有该会话（state=blocked）')
          } else bad(`G-25 A ⚠ 真机形态应判"拦"，实际 gateSecond=${g} ⇒ 旧的病没治好`)
        }

        // ── B · 无记录（⚠ 与 A 同档：gateSecond 不收 createdAt）──
        /**
         * ⚠⚠ **2026-10-31 P32：本条审计发现它是 A 的重复。**
         *   实测（`CHG-306` §二）：把 `SID_LATE` 改成 `SID_EARLY`（让 B 用 A 的输入）⇒ **B 照样绿**。
         *   根因：`gateSecond(file, sid)` **签名里没有 `createdAt`** ⇒ A/B 喂的是同一输入。
         *   ⚠ **保留而非删除**（P32 裁 (a)）：删了就看不出“这里曾经有一条以为在测别的东西的断言”。
         *   ⛔ 本轮只改标题与说明，⛔ 不动判定逻辑、⛔ 不变强。
         */
        {
          const g = gateSecond(policyFile, SID_LATE)
          if (g === 'absent') ok('G-25 B ✓ 无记录（⚠ 与 A 同档：`gateSecond` 不收 `createdAt`，'
            + '本条的『晚于纪元』**未被真正喂入**）⇒ 判据=absent ⇒ **拦**'
            + ' ⚠ 本条**不构成独立覆盖** —— 它与 G-25 A 喂的是同一输入（见 P32 审计）')
          else bad(`G-25 B ⚠ 应判"拦"，实际 ${g}`)
        }

        // ── C · 有已落盘记录 ⇒ 必须放行，且不写 blocks.json ──
        {
          const seed2 = JSON.parse(JSON.stringify(seed))
          seed2.sessions[SID_REC] = { level: 'ledger', workMode: 'auto', origin: 'explicit', at: realEpoch }
          fsMod.writeFileSync(policyFile, JSON.stringify(seed2, null, 2), 'utf8')
          const g = gateSecond(policyFile, SID_REC)
          const before = (() => { try { return String(fsMod.readFileSync(blockFile, 'utf8')) } catch { return '' } })()
          const wrote = before.includes(SID_REC)
          if (g === 'recorded' && !wrote) {
            ok('G-25 C ✓ 有已落盘记录 ⇒ 判据=recorded ⇒ **放行**，且 blocks.json **不含**该会话（⛔ 不写）')
          } else {
            bad(`G-25 C ⚠ 有记录应放行且不写：gateSecond=${g} · blocks 含该会话=${wrote}`)
          }
        }

        // ── D · 非 Hob ⇒ 放行（第 ① 条未动，验它仍在）──
        {
          const src = String(fsMod.readFileSync(join(root, 'src', 'session-policy-service.ts'), 'utf8'))
          if (/if \(resolved\?\.isHob !== true\) return next\(\)/.test(src)) {
            ok('G-25 D ✓ `isHob !== true ⇒ next()` 第 ① 条**原样在位**（非 Hob 一律放行）'
              + ' ⚠ 本组是**源码正则**：抓得住"这行被改"，抓不住"这行还在但被短路"')
          } else bad('G-25 D ⚠ 第 ① 条（非 Hob 放行）不见了')
        }

        // ── E · 判不出 ⇒ 必须放行（fail-open）──
        {
          const cases = []
          cases.push(['文件不存在', join(dir, 'nope.json')])
          const vf = join(dir, 'badver.json')
          fsMod.writeFileSync(vf, JSON.stringify({ version: 999, migrationEpoch: realEpoch, sessions: {} }), 'utf8')
          cases.push(['版本不认识', vf])
          const bf = join(dir, 'badjson.json')
          fsMod.writeFileSync(bf, '{not json', 'utf8')
          cases.push(['不是 JSON', bf])
          const wrong = []
          for (const [name, f] of cases) {
            const g = gateSecond(f, SID_EARLY)
            if (g !== 'undecidable') wrong.push(`${name}→${g}`)
          }
          if (wrong.length === 0) {
            ok('G-25 E ✓ 三类"判不出"（文件不存在 / 版本不认识 / 不是 JSON）⇒ 全 **undecidable ⇒ 放行**（fail-open）')
          } else bad(`G-25 E ⚠ 判不出没走放行：${wrong.join(' / ')}`)
        }

        // ── F · 负向对拍：旧判据在 A 的形态上必然放行 ⇒ A 的绿挂在新判据上 ──
        {
          let srcOld
          try {
            const spm = await import('../src/server/session-policy.ts')
            const v = spm.resolveSessionPolicy({
              file: policyFile,
              levels: OPTIONS.levels, floorLevel: OPTIONS.floorLevel,
              defaultMode: OPTIONS.defaultMode, modes: OPTIONS.modes,
              isHob: true, sessionId: SID_EARLY, archived: 'not-archived',
              createdAt: realCreatedAt, legacyWorkModeSnapshot: 'auto', fallbackEpoch: realEpoch,
            })
            srcOld = v.source
          } catch { srcOld = undefined }
          if (srcOld === undefined) {
            bad('G-25 F ⚠ 推不出旧判据的 source ⇒ 负向对拍做不成（不按通过处理）')
          } else {
            const oldWouldBlock = srcOld === 'derived-default'
            const newWouldBlock = gateSecond(policyFile, SID_EARLY) === 'absent'
            if (!oldWouldBlock && newWouldBlock) {
              ok(`G-25 F ✓ **负向对拍**：旧判据在 A 的形态上得 source=${JSON.stringify(srcOld)} ⇒`
                + ` \`!== 'derived-default'\` ⇒ **放行（不拦）**；新判据判 \`absent\` ⇒ **拦**`
                + ' ⇒ 证明 A 的绿挂在新判据上，⛔ 不是旧判据凑出来的')
            } else {
              bad(`G-25 F ⚠ 负向对拍不成立：旧判据会拦=${oldWouldBlock} · 新判据会拦=${newWouldBlock}`
                + '（若两者同为真，则 A 的绿与"换判据"无关）')
            }
          }
        }

        // ── 清夹具（⚠ 记录位置：work/g25，已删；并核 0 残留见报告）──
        try { fsMod.rmSync(dir, { recursive: true, force: true }) } catch { /* 忽略 */ }
      }
    }
  }

  /**
   * ── G-26 【TASK-N · 判据 B/C/D/E】路由层必须返回**真 `Response`**，且**走真 HTTP** ─────
   *
   * ══ 它治的是什么（`CHG-212`）══════════════════════════════════════════════
   *   改前 `json()` 返回**普通对象**（`{status, headers:{…}, body:string}`），而宿主
   *   契约要真 `Response`（`dsh-client-connection/lib/types/rpc.d.ts:131`），并在
   *   `lib/index.js:90` 直接 `Object.fromEntries(response.headers.entries())`
   *   ⇒ `TypeError` ⇒ 被 `dsh-host-webserver/lib/index.js:397-405` 兜成 **400 空包**
   *   ⇒ 三条动作（`read` / `blocked` / `enums`）**全死**。
   *
   * ══ ⚠⚠ 为什么这组必须过**真 HTTP**（上一轮栽的就是这个）════════════════════
   *   `check-hob-unselected-gate` 以前的判据全是"直载 `.ts` 调函数"，
   *   **从不经过宿主那段 bridge** ⇒ 普通对象当然"没问题" ⇒ 检查长期绿、真机恒 400。
   *   ⇒ 本组**起真 `http.Server`**，把路由 handler 挂上去，并**逐字复刻**宿主两段代码：
   *     ① bridge（`dsh-client-connection/lib/index.js:88-100`）：把 node `req` 变成
   *        Fetch `Request` → 调 `route.fetch` → **`Object.fromEntries(response.headers.entries())`**
   *        → `res.writeHead(response.status, …)` → 逐块写 `response.body`；
   *     ② webserver 兜底（`dsh-host-webserver/lib/index.js:397-405`）：抛错且未发头 ⇒ **400 空包**。
   *   ⇒ 普通对象在这条链上**必定** 400 空包（E 用真变异证明），真 `Response` 才 2xx。
   *
   * ══ ⚠ 边界（如实说）══════════════════════════════════════════════════════
   *   ⚠ 这是 **「接近真机」**：真 node:http + 真 Request/Response + 宿主那两段代码的**复刻**，
   *     但**不是**宿主进程本身（没有真 `connection.admit` 的 cookie 鉴权栅栏，
   *     也没有真 cordis 容器）。真机读数见 `REPORT-N.md`（curl + 启动日志 token 换 cookie）。
   */
  {
    const httpMod = await import('node:http')
    const fsMod = await import('node:fs')
    const { join: joinP } = await import('node:path')
    const { SESSION_POLICY_SERVICE } = await import('../src/config.ts')
    const { resolveLedgerRoot } = await import('../src/server/doc-read.ts')
    const { policyBlockFileOf, markBlocked } = await import('../src/server/policy-block-log.ts')

    const dir = joinP(work, 'g26')
    const ledgerHome = joinP(dir, 'ledger')
    const cwd = joinP(dir, 'ws')
    fsMod.mkdirSync(cwd, { recursive: true })
    const SID = 'sess-g26-hob'
    const ledgerRoot = resolveLedgerRoot('', ledgerHome, cwd)
    const blockFile = ledgerRoot === undefined ? undefined : policyBlockFileOf(ledgerRoot)
    if (blockFile === undefined) {
      bad('G-26 基准 ⚠ 推不出被拦记录落点（resolveLedgerRoot 回 undefined）⇒ 不按通过处理')
    } else {
      fsMod.mkdirSync(joinP(ledgerRoot, 'runtime'), { recursive: true })

      /** 宿主 bridge + webserver 兜底的**逐字复刻**（见本组文件头 ① ②）。 */
      const serve = (handler) => httpMod.createServer((req, res) => {
        const go = async () => {
          const chunks = []
          for await (const c of req) chunks.push(c)
          const url = new URL(req.url ?? '/', 'http://dsh.internal')
          const headers = Object.fromEntries(
            Object.entries(req.headers).filter(([, v]) => typeof v === 'string'),
          )
          const request = new Request(url, {
            method: req.method ?? 'GET',
            headers,
            ...(chunks.length > 0 ? { body: Buffer.concat(chunks) } : {}),
          })
          // ⚠ 宿主 `dsh-client-connection/lib/index.js:88`
          const response = await handler.fetch(request, { principal: { kind: 'owner' } })
          // ⚠ 宿主 `…/lib/index.js:90`：普通对象在这一行必抛（没有 `.headers.entries`）
          const responseHeaders = Object.fromEntries(response.headers.entries())
          res.writeHead(response.status, responseHeaders)
          for await (const chunk of response.body) res.write(chunk)
          res.end()
        }
        go().catch(() => {
          // ⚠ 宿主 `dsh-host-webserver/lib/index.js:397-405`
          if (res.headersSent) { res.destroy(); return }
          res.writeHead(400)
          res.end()
        })
      })

      /** 假宿主 ctx：`inject` 同步回调、`get()` 提供 `connection.fetch.register` 等。 */
      const mkHostCtx = (captured) => {
        const hostCtx = {
          logger: { info: () => {}, warn: () => {}, debug: () => {} },
          effect: (fn) => { try { const d = typeof fn === 'function' ? fn() : undefined; void d } catch { /* 忽略 */ } },
          get: (k) => {
            if (k === 'connection') {
              return { fetch: { register: (route) => { captured.push(route); return async () => {} } } }
            }
            if (k === 'loader') return { entries: () => [{ options: { ledgerHome } }] }
            if (k === 'sessions') return { get: (id) => (id === SID ? { id, header: { cwd } } : undefined) }
            if (k === SESSION_POLICY_SERVICE) {
              // ⚠ isHob=true + recorded=false ⇒ `read` 回 `unrecorded`、`blocked` 看被拦记录
              return { get: () => ({ isHob: true, recorded: false, source: 'derived-default' }) }
            }
            if (k === 'workspaceRegistry') return { list: () => [{ id: 'ws-g26', title: '夹具工作区' }] }
            return undefined
          },
          inject: (deps, fn) => { fn(hostCtx) },
        }
        return hostCtx
      }

      /** 起一个把 handler 挂上去的真 server；返回 `{ port, close }`。 */
      const startWith = async (handler) => {
        const server = serve(handler)
        await new Promise((r) => server.listen(0, '127.0.0.1', r))
        return { port: server.address().port, close: () => new Promise((r) => server.close(r)) }
      }
      /** 真 HTTP POST（⚠ 用全局 fetch 打绝对 URL，⛔ 不直调 handler）。 */
      const post = async (port, path, body) => {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const text = await res.text()
        let parsed
        try { parsed = JSON.parse(text) } catch { parsed = undefined }
        return { status: res.status, ctype: res.headers.get('content-type'), text, parsed }
      }

      const routeMod = await import('../src/modules/session-policy-route.ts')
      const chanMod = await import('../src/modules/session-create-channel.ts')
      const captured = []
      try {
        routeMod.installPolicyRoute(mkHostCtx(captured))
        chanMod.installCreateChannel(mkHostCtx(captured))
      } catch (e) {
        bad(`G-26 挂载路由失败（${String(e?.message ?? e)}）⇒ 不按通过处理`)
      }
      const policyRoute = captured.find((r) => r.path === '/api/dsh-hob/session-policy')
      const createRoute = captured.find((r) => r.path === '/api/dsh-hob/session-create')
      if (policyRoute === undefined || createRoute === undefined) {
        bad(`G-26 两条路由没登记上（policy=${policyRoute !== undefined} create=${createRoute !== undefined}）⇒ 不按通过处理`)
      } else {
        const srv = await startWith({
          // 一个 server 两个前缀：按 pathname 分发（与宿主"同一条 /api 通道"同形）
          fetch: async (request, peer) => {
            const p = new URL(request.url).pathname
            if (p === '/api/dsh-hob/session-policy') return policyRoute.fetch(request, peer)
            if (p === '/api/dsh-hob/session-create') return createRoute.fetch(request, peer)
            return new Response('not found', { status: 404 })
          },
        })
        try {
          // ── B · 改后绿：`read` ⇒ 2xx + 可解析 JSON + 含预期字段 ────────────
          const b = await post(srv.port, '/api/dsh-hob/session-policy', { action: 'read', sessionId: SID })
          const bOk = b.status === 200 && b.parsed !== undefined
            && b.parsed.ok === true && typeof b.parsed.state === 'string'
            && String(b.ctype ?? '').startsWith('application/json')
          if (bOk) {
            ok(`G-26 B ✓ **改后绿（真 HTTP）**：POST /api/dsh-hob/session-policy {"action":"read"} ⇒`
              + ` **${b.status}** · content-type=${JSON.stringify(b.ctype)} · body=${JSON.stringify(b.text).slice(0, 120)}`)
          } else {
            bad(`G-26 B ⚠ 真 HTTP 未绿：status=${b.status} ctype=${JSON.stringify(b.ctype)} body=${JSON.stringify(b.text).slice(0, 200)}`)
          }

          // ── C · 三条 action（read / blocked / enums）都 2xx ─────────────
          const mk = markBlocked(blockFile, SID)
          if (!mk.ok) bad(`G-26 C ⚠ 夹具写"被拦过"失败：${mk.reason}`)
          const cRead = await post(srv.port, '/api/dsh-hob/session-policy', { action: 'read', sessionId: SID })
          const cBlocked = await post(srv.port, '/api/dsh-hob/session-policy', { action: 'blocked', sessionId: SID })
          const cEnums = await post(srv.port, '/api/dsh-hob/session-create', { action: 'enums' })
          const rows = [
            ['read', cRead, (p) => p?.ok === true && p?.state === 'unrecorded'],
            ['blocked', cBlocked, (p) => p?.ok === true && p?.state === 'blocked'],
            ['enums', cEnums, (p) => p?.ok === true && Array.isArray(p?.levels) && Array.isArray(p?.workspaces)],
          ]
          const badRows = rows.filter(([, r, check]) => !(r.status === 200 && check(r.parsed)))
          if (badRows.length === 0) {
            ok('G-26 C ✓ 三条 action 全 **200 + 语义对**：read⇒unrecorded · blocked⇒blocked · enums⇒levels+workspaces'
              + '（⚠ 三条都是真 HTTP POST，⛔ 不是直调函数）')
          } else {
            bad(`G-26 C ⚠ 未全绿：${badRows.map(([n, r]) => `${n}=${r.status}/${JSON.stringify(r.text).slice(0, 80)}`).join(' · ')}`)
          }

          // ── D · 端到端：真 blocked 记录 ⇒ 真 HTTP 读到 blocked ⇒ 真 DOM 自动开窗 ──
          {
            const realFetch = globalThis.fetch
            globalThis.fetch = (url, init) => {
              const s = String(url)
              return realFetch(s.startsWith('/api/') ? `http://127.0.0.1:${srv.port}${s}` : s, init)
            }
            const opened = []
            let rDom
            try {
              rDom = await mount(h(gate.HobUnselectedGate, {
                sessionId: SID,
                agentPreset: gate.HOB_PRESET_ID_FOR_MATCH,
                // ⚠ 不传 readRecorded / readBlocked ⇒ **默认实现**，两条都走真 HTTP
                openForSession: (id) => { opened.push(id) },
                memory: gate.createGateMemory(),
                /**
                 * ⚠⚠ **2026-10-29（TASK-Q · `CHG-215`）：这里不再传 `autoOpen:false`。**
                 *   改前传它是为了"把'未选即弹'那条关掉，好分辨是谁弹的"——
                 *   现在**那条已经在源码里废掉了**，开窗只可能来自 `blocked` 轮询，
                 *   所以不需要（也⛔ 不该）再关一次；关掉反而会把唯一那条路也关死。
                 *   ⚠ 判据没有变松：`opened` 必须**恰好 1 次**且是 SID。
                 */
                blockPollMs: 20,
              }))
              // ⚠ 两段 settle：[60ms] 让 `read` 那条落地并进入 `unrecorded`，
              //    [200ms] 再让 `blocked` 轮询跑几轮（⚠ 一次 `settle` 只刷一轮宏任务，
              //    单次 160ms 实测**不够**：轮询刚发出就 unmount 了 —— 见 REPORT-N §4）。
              await settle(60)
              await settle(200)
            } finally {
              if (rDom !== undefined) await unmount(rDom)
              globalThis.fetch = realFetch
            }
            if (opened.length === 1 && opened[0] === SID) {
              ok('G-26 D ✓ **端到端**：服务端真落一条 blocked ⇒ 客户端**默认读取器**经真 HTTP 读到 `blocked` ⇒'
                + ` 真 DOM 组件**自动开窗一次**（opened=${JSON.stringify(opened)}；`
                + '⚠ TASK-Q 起"未选即弹"已在源码里废掉 ⇒ 这条开窗**只可能**来自 blocked 轮询）')
            } else {
              bad(`G-26 D ⚠ 端到端没开窗（opened=${JSON.stringify(opened)}，应恰好 1 次且是 ${SID}）`
                + ' ⇒ "路由绿了但界面仍不弹"这条缝没接上')
            }
          }
        } finally {
          await srv.close()
        }

        // ── E · 负向对拍：把 `json()` 真改成普通对象 ⇒ B **必须变红** ────────
        {
          const { mkdtempSync, cpSync, writeFileSync: writeMut, symlinkSync, rmSync: rmMut } = fsMod
          const { tmpdir } = await import('node:os')
          const { pathToFileURL } = await import('node:url')
          const mutRoot = mkdtempSync(joinP(tmpdir(), 'hob-g26-mut-'))
          try {
            cpSync(join(root, 'src'), joinP(mutRoot, 'src'), { recursive: true, dereference: true })
            try { symlinkSync(joinP(root, 'node_modules'), joinP(mutRoot, 'node_modules'), 'dir') } catch { /* 已有 */ }
            const REL = joinP('src', 'modules', 'session-policy-route.ts')
            const srcText = readFileSync(joinP(root, REL), 'utf8')
            /**
             * ⚠ **只替换 `json()` 函数体这一处**（按起止锚点切片，⛔ 不用全文件
             *   `includes('new Response(')` 做判据 —— 函数上方的**注释**里也写着
             *   `new Response(…)`，那样会把"改成功了"误判成"没改成功"）。
             */
            const HEAD = 'function json(status: number, body: unknown): Response {'
            const at = srcText.indexOf(HEAD)
            const atEnd = at < 0 ? -1 : srcText.indexOf('\n}\n', at)
            if (at < 0 || atEnd < 0) {
              bad(`G-26 E ⚠ 找不到变异靶点 \`${HEAD}\` 及其函数体结尾 ⇒ 判据已对不上实现`)
            } else {
              /**
               * ⚠ 变异体：**回到改前那一版**（普通对象）。⚠ 只改这一处，
               *   其余（action 语义 / 字段名 / 状态码）一个字不动 ⇒ 红只能归因于形状。
               */
              const MUT = 'function json(status: number, body: unknown): any {\n'
                + "  return { status, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) }\n"
                + '}\n'
              const mutated = srcText.slice(0, at) + MUT + srcText.slice(atEnd + 3)
              const mutBody = mutated.slice(at, at + MUT.length)
              writeMut(joinP(mutRoot, REL), mutated, 'utf8')
              if (mutated === srcText || mutBody.includes('new Response(')) {
                bad('G-26 E ⚠ 变异没生效（`json()` 函数体里仍有 `new Response(` 或文件未变）'
                  + ' ⇒ 无法证明 B 挂在这次修复上')
              } else {
                const mutMod = await import(pathToFileURL(joinP(mutRoot, REL)).href)
                const cap2 = []
                mutMod.installPolicyRoute(mkHostCtx(cap2))
                const mutRoute = cap2.find((r) => r.path === '/api/dsh-hob/session-policy')
                if (mutRoute === undefined) {
                  bad('G-26 E ⚠ 变异体没登记上路由 ⇒ 对拍做不成（不按通过处理）')
                } else {
                  const srv2 = await startWith({ fetch: (req, peer) => mutRoute.fetch(req, peer) })
                  let e
                  try {
                    e = await post(srv2.port, '/api/dsh-hob/session-policy', { action: 'read', sessionId: SID })
                  } finally {
                    await srv2.close()
                  }
                  if (e.status === 400 && e.text === '') {
                    ok('G-26 E ✓ **负向对拍**：把 `json()` 真改回**普通对象**（临时副本，真 import 真跑）⇒'
                      + ` 同一请求变成 **${e.status} 空包**（body=${JSON.stringify(e.text)}）`
                      + ' ⇒ 与真机改前读数同形，证明 B 的绿**真的挂在这处修复上**')
                  } else {
                    bad(`G-26 E ⚠ 改回普通对象后**没有变红**（status=${e.status} body=${JSON.stringify(e.text).slice(0, 80)}）`
                      + ' ⇒ B 的绿与这次修复无关')
                  }
                }
              }
            }
          } catch (err) {
            bad(`G-26 E 变异对拍跑不起来（${String(err?.message ?? err)}）⇒ 不按通过处理`)
          } finally {
            try { rmMut(mutRoot, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
          }
        }
      }

      // ── 清夹具（⚠ 位置：work/g26，已删）──
      try { fsMod.rmSync(dir, { recursive: true, force: true }) } catch { /* 忽略 */ }
    }
  }

  /**
   * ── G-27 【TASK-Q · 判据 A–E】弹窗时点：**只在"被拦下之后"弹，切预设不再弹** ──────
   *
   * ══ 它治的是什么（`CHG-215`，用户原话）════════════════════════════════════
   *   > 「我点击 HOB 预设在输入信息之前就会弹出窗口，虽然逻辑不太对
   *   >  （**我要求的是点击发送后弹出**）」
   *   ⇒ 改前 `hob-unselected-gate.tsx` 有一段"挂载即弹"（`recorded==='unrecorded'` ⇒ 开窗），
   *     它与「`blocked` 轮询」两条并存；**四单实测（`REPORT-P.md`）证明现场起作用的是前者**。
   *   ⇒ 本单把那段删掉，**开窗唯一来源 = `blocked` 轮询**。
   *
   * ══ 判据与靶子 ═══════════════════════════════════════════════════════════
   *   A **改前红**：切到 Hob、未选档、未发消息 ⇒ 挂载 ⇒ **会弹**（要废掉的那条）。
   *     ⚠ 本组把它做成**变异体**（把旧 effect 塞回临时副本）⇒ 每次跑都真验一遍，
   *       ⛔ 不是"报告里说改前是红的"。这同时就是 E（负向对拍）。
   *   B **改后绿**：同一场景（**真源码**）⇒ **一次都不弹**，且**横幅仍在**（⛔ 不把功能删没）。
   *   C **核心（真 HTTP）**：起真 `http.Server` 挂**真路由**、真落一条 `blocked` ⇒
   *     客户端**默认读取器**读到 ⇒ 真 DOM 组件**恰好弹一次**。
   *   D 选完档（`recorded`）后有 `blocked` 残留 ⇒ **不弹**。
   *   E = A 的复用（变异体必须红）。
   */
  {
    const httpMod2 = await import('node:http')
    const fsMod2 = await import('node:fs')
    const { join: joinP2 } = await import('node:path')
    const { pathToFileURL: toUrl2 } = await import('node:url')

    const dir = joinP2(work, 'g27')
    const ledgerHome = joinP2(dir, 'ledger')
    const cwd = joinP2(dir, 'ws')
    fsMod2.mkdirSync(cwd, { recursive: true })

    const { SESSION_POLICY_SERVICE } = await import('../src/config.ts')
    const { resolveLedgerRoot: resolveRoot2 } = await import('../src/server/doc-read.ts')
    const blkMod2 = await import('../src/server/policy-block-log.ts')
    const ledgerRoot = resolveRoot2('', ledgerHome, cwd)
    const SID = 'sess-g27-hob'
    const blockFile = ledgerRoot === undefined ? undefined : blkMod2.policyBlockFileOf(ledgerRoot)
    if (blockFile === undefined) {
      bad('G-27 基准 ⚠ 推不出被拦记录落点 ⇒ 不按通过处理')
    } else {
      fsMod2.mkdirSync(joinP2(ledgerRoot, 'runtime'), { recursive: true })
      const resetBlockFile = () => fsMod2.writeFileSync(blockFile, JSON.stringify({ version: 1, blocked: {} }))

      /**
       * ⚠ 真 HTTP 服务：复刻宿主 bridge 两行（`dsh-client-connection/lib/index.js:88-90`）
       *   + webserver 兜底（`dsh-host-webserver/lib/index.js:397-405`）。标「接近真机」。
       */
      const serveRoute = (handler) => httpMod2.createServer((req, res) => {
        const go = async () => {
          const chunks = []
          for await (const c of req) chunks.push(c)
          const url = new URL(req.url ?? '/', 'http://dsh.internal')
          const headers = Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === 'string'))
          const request = new Request(url, {
            method: req.method ?? 'GET', headers,
            ...(chunks.length > 0 ? { body: Buffer.concat(chunks) } : {}),
          })
          const response = await handler.fetch(request, {})
          res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
          for await (const chunk of response.body) res.write(chunk)
          res.end()
        }
        go().catch(() => {
          if (res.headersSent) { res.destroy(); return }
          res.writeHead(400); res.end()
        })
      })

      /** 假宿主 ctx（与 G-26 同形，⚠ recorded 由 `recordedNow` 控制）。 */
      const mkCtx2 = (captured, recordedNow) => {
        const ctx = {
          logger: { info: () => {}, warn: () => {}, debug: () => {} },
          effect: (fn) => { try { fn() } catch { /* 忽略 */ } },
          get: (k) => {
            if (k === 'connection') return { fetch: { register: (r) => { captured.push(r); return async () => {} } } }
            if (k === 'loader') return { entries: () => [{ options: { ledgerHome } }] }
            if (k === 'sessions') return { get: (id) => (id === SID ? { id, header: { cwd } } : undefined) }
            if (k === SESSION_POLICY_SERVICE) return { get: () => ({ isHob: true, recorded: recordedNow(), source: recordedNow() ? 'stored' : 'derived-default' }) }
            if (k === 'workspaceRegistry') return { list: () => [{ id: 'ws-g27', title: '夹具' }] }
            return undefined
          },
          inject: (_d, fn) => fn(ctx),
        }
        return ctx
      }

      const routeMod2 = await import('../src/modules/session-policy-route.ts')
      let recordedFlag = false
      const cap2 = []
      routeMod2.installPolicyRoute(mkCtx2(cap2, () => recordedFlag))
      const policyRoute2 = cap2.find((r) => r.path === '/api/dsh-hob/session-policy')
      if (policyRoute2 === undefined) {
        bad('G-27 ⚠ 真路由没登记上 ⇒ C 做不成（不按通过处理）')
      } else {
        /** 用真 HTTP 打一次（⛔ 不直调 reader）。 */
        const withRealHttp = async (fn) => {
          const server = serveRoute(policyRoute2)
          await new Promise((r) => server.listen(0, '127.0.0.1', r))
          const port = server.address().port
          const realFetch = globalThis.fetch
          globalThis.fetch = (url, init) => {
            const s = String(url)
            return realFetch(s.startsWith('/api/') ? `http://127.0.0.1:${port}${s}` : s, init)
          }
          try { return await fn() } finally {
            globalThis.fetch = realFetch
            await new Promise((r) => server.close(r))
          }
        }

        // ── B · 改后绿：未选档、未发消息 ⇒ **一次都不弹**，横幅仍在 ──────────
        {
          resetBlockFile()
          recordedFlag = false
          const opened = []
          let r
          /**
           * ⚠⚠ **必须挂在真 HTTP 上跑**（任务书 §二 判据要求"必须走真 HTTP"）：
           *   默认读取器用的是**相对 URL**，在 Node 里没有 base ⇒ 不打这个补丁
           *   它一律读成 `'unknown'` ⇒ 横幅不显 ⇒ B 会**假红**（我第一次就撞了这个）。
           */
          await withRealHttp(async () => {
            r = await mount(h(gate.HobUnselectedGate, {
              sessionId: SID,
              agentPreset: gate.HOB_PRESET_ID_FOR_MATCH,
              // ⚠ 不传 readRecorded / readBlocked ⇒ 默认实现（走**真 HTTP**）
              openForSession: (id) => opened.push(id),
              memory: gate.createGateMemory(),
              blockPollMs: 20,
            }))
            // ⚠ 两段 settle（同 G-26 D 的教训：一次 settle 只刷一轮宏任务）
            await settle(60); await settle(200)
          })
          const banner = host.querySelectorAll(`.${gate.GATE_CLASS.root}`).length
          if (r !== undefined) await unmount(r)
          if (opened.length === 0 && banner === 1) {
            ok(`G-27 B ✓ **改后绿（真 HTTP）**：Hob + 未选档 + **未发消息** ⇒ 挂载后`
              + ` **弹 ${opened.length} 次**（横幅仍在：${banner} 个）⇒ 切预设不再弹，⛔ 也没把功能删没`)
          } else {
            bad(`G-27 B ⚠ 未发消息却 ${opened.length > 0 ? '弹了' : '没弹'}（opened=${JSON.stringify(opened)} banner=${banner}）`
              + ' ⇒ 期望：弹 0 次 + 横幅 1 个')
          }
        }

        // ── C · 核心：真落一条 blocked ⇒ 真 HTTP 读到 ⇒ **恰好弹一次** ────────
        {
          resetBlockFile()
          recordedFlag = false
          const w = blkMod2.markBlocked(blockFile, SID)
          if (!w.ok) {
            bad(`G-27 C ⚠ 夹具写"被拦过"失败：${w.reason}`)
          } else {
            const opened = []
            let r
            await withRealHttp(async () => {
              r = await mount(h(gate.HobUnselectedGate, {
                sessionId: SID,
                agentPreset: gate.HOB_PRESET_ID_FOR_MATCH,
                openForSession: (id) => opened.push(id),
                memory: gate.createGateMemory(),
                blockPollMs: 20,
              }))
              await settle(60); await settle(250)
            })
            if (r !== undefined) await unmount(r)
            if (opened.length === 1 && opened[0] === SID) {
              ok('G-27 C ✓ **核心（真 HTTP）**：服务端真落一条 `blocked` ⇒ 客户端**默认读取器**经真 HTTP 读到 ⇒'
                + ` 真 DOM **恰好弹一次**（opened=${JSON.stringify(opened)}）`)
            } else {
              bad(`G-27 C ⚠ 期望恰好 1 次，实际 ${JSON.stringify(opened)} ⇒ "点发送后被拦就该弹"这条没通`)
            }
          }
        }

        // ── D · 选完档后有 blocked 残留 ⇒ **不弹** ──────────────────────────
        {
          resetBlockFile()
          recordedFlag = true               // ⚠ 已选档
          blkMod2.markBlocked(blockFile, SID)   // ⚠ 故意留一条残留
          const opened = []
          let r
          await withRealHttp(async () => {
            r = await mount(h(gate.HobUnselectedGate, {
              sessionId: SID,
              agentPreset: gate.HOB_PRESET_ID_FOR_MATCH,
              openForSession: (id) => opened.push(id),
              memory: gate.createGateMemory(),
              blockPollMs: 20,
            }))
            await settle(60); await settle(200)
          })
          if (r !== undefined) await unmount(r)
          if (opened.length === 0) {
            ok('G-27 D ✓ 已选档（`recorded`）+ `blocked` 残留 ⇒ **不弹**（⛔ 不拿旧记录反复骚扰）')
          } else {
            bad(`G-27 D ⚠ 已选档却弹了：opened=${JSON.stringify(opened)}`)
          }
        }

        // ── A/E · 负向对拍：把"挂载即弹"塞回临时副本 ⇒ **必须重新变红** ───────
        {
          const { mkdtempSync, cpSync, writeFileSync: wf, symlinkSync, rmSync: rm2 } = fsMod2
          const { tmpdir } = await import('node:os')
          const mutRoot = mkdtempSync(joinP2(tmpdir(), 'hob-g27-mut-'))
          try {
            cpSync(join(SRC_ROOT, 'src'), joinP2(mutRoot, 'src'), { recursive: true, dereference: true })
            try { symlinkSync(join(root, 'node_modules'), joinP2(mutRoot, 'node_modules'), 'dir') } catch { /* 已有 */ }
            const REL = joinP2('src', 'client', 'hob-unselected-gate.tsx')
            const srcText = fsMod2.readFileSync(joinP2(SRC_ROOT, REL), 'utf8')
            /**
             * ⚠ 变异靶点 = `const mountedAutoOpen = props.autoOpen !== false` 这一行**之后**
             *   那段注释块的结束标记 —— 把旧 effect **原样**插回去。
             *   ⛔ 不是"改个变量名"，是**真的把被废掉的那段行为还原**。
             *   ⚠ 这里刻意不写那个结束标记的字面量：它会把本注释块提前闭合。
             */
            const ANCHOR = 'const mountedAutoOpen = props.autoOpen !== false\n'
            const at = srcText.indexOf(ANCHOR)
            const endOfComment = at < 0 ? -1 : srcText.indexOf('*/\n', at)
            if (at < 0 || endOfComment < 0) {
              bad('G-27 A/E ⚠ 找不到变异靶点（`mountedAutoOpen` 声明 / 其后注释块结束）⇒ 判据已对不上实现')
            } else {
              const OLD = `  React.useEffect(() => {
    if (sessionId === undefined || sessionId === '') return
    if (recorded !== 'unrecorded') return
    if (!mountedAutoOpen) return
    if (typeof props.openForSession !== 'function') return
    if (memory === undefined) return
    if (!memory.takeAutoOpen(sessionId)) return
    try { props.openForSession(sessionId) } catch { /* mut */ }
  }, [sessionId, recorded, mountedAutoOpen, props.openForSession, memory])
`
              const insertAt = endOfComment + 3
              const mutated = srcText.slice(0, insertAt) + OLD + srcText.slice(insertAt)
              wf(joinP2(mutRoot, REL), mutated, 'utf8')
              // ⚠ 独立转译变异树（⚠ 不是拿真源码跑）
              const ts2 = (await import(`file://${join(root, 'node_modules', 'typescript', 'lib', 'typescript.js')}`)).default
              const tsMount2 = await import('./ts-mount.mjs')
              const ent = ['src/client/hob-unselected-gate.tsx']
              const g2 = tsMount2.mountTsGraph({ root: mutRoot, outDir: joinP2(work, 'g27', 'mut-out'), entries: ent, ts: ts2 })
              const mutGate = await import(toUrl2(g2.entries[ent[0]]).href)
              resetBlockFile()          // ⚠ blocked 为空：开窗只可能来自"挂载即弹"
              recordedFlag = false
              const opened = []
              const r = await mount(h(mutGate.HobUnselectedGate, {
                sessionId: 'sess-g27-mut',
                agentPreset: mutGate.HOB_PRESET_ID_FOR_MATCH,
                readRecorded: async () => 'unrecorded',
                readBlocked: async () => 'clear',
                openForSession: (id) => opened.push(id),
                memory: mutGate.createGateMemory(),
              }))
              await settle(120)
              await unmount(r)
              if (opened.length === 1) {
                ok(`G-27 A/E ✓ **负向对拍（真变异）**：把被废掉的"挂载即弹"塞回临时副本 ⇒`
                  + ` 同一场景（未选档 · 未发消息 · blocked=clear）**重新弹了 ${opened.length} 次**`
                  + ' ⇒ 证明 B 的绿**真的挂在这处删除上**，⛔ 不是别的东西凑出来的')
              } else {
                bad(`G-27 A/E ⚠ 变异体**没有**变红（opened=${JSON.stringify(opened)}，应 1 次）`
                  + ' ⇒ B 的绿与"删掉挂载即弹"无关 / 或变异没生效')
              }
            }
          } catch (err) {
            bad(`G-27 A/E 变异对拍跑不起来（${String(err?.message ?? err)}）⇒ 不按通过处理`)
          } finally {
            try { rm2(mutRoot, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
          }
        }
      }
      // ── 清夹具（⚠ 位置：work/g27，已删）──
      try { fsMod2.rmSync(dir, { recursive: true, force: true }) } catch { /* 忽略 */ }
    }
  }

} finally {
  cleanup()
}

console.log('')
console.log(`G 组：通过 ${pass} · 失败 ${fail}`)
/**
 * ⚠⚠ **本族也必须印 `处级口径` 行**（2026-10-24 · B 席）—— 理由同 `check:hob-create-dom`：
 *   改前只印"G 组：通过 N · 失败 M" ⇒ `check:all` 读不到断言数 / 跳过数
 *   ⇒ 20 条断言不进总数，且"断言数下界"对它**是盲的**。
 *   ⚠ `查了 = 过了 + 没过 + 跳过`。
 */
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处`
  + (fail > 0 ? ` · 没过 ${fail} 处` : '')
  + ' · **跳过 0 处**（⚠ 跳过**不计入通过**；⚠ 依赖不可用 / 仓根不可写都走 `exit 2`，不是跳过）')
console.log('')
if (fail > 0) {
  console.log('  ⛔ 有失败项 ⇒ 本组不算通过')
  process.exit(1)
}
console.log('  ✅ G 组全绿（⚠ 隔离渲染：组件行为成立；真实宿主渲染仍需重启后人工验）')
process.exit(0)
