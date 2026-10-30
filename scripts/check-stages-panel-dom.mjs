#!/usr/bin/env node
/**
 * **四步主线面板的"真 DOM"位置判据**（2026-10-29 · 第 1 轮：只验位置）。
 *
 * ══ 它为什么存在 ═══════════════════════════════════════════════════════════
 *   本轮任务只证明"位置成立、挂得上去、看得见"，⛔ 不接数据。能证明这件事的
 *   最低标准**不是**"源码里有那几行"（那种 grep 判据恒真、没有牙），而是：
 *     · 栏脚按钮**真的渲染出来**、**真的可点**；
 *     · 点了**真的调用**了侧栏服务的打开方法，且参数是那个常量；
 *     · 面板挂上后 DOM 里**四个步骤名都在**，每格旁边是「未接线」；
 *     · **负向对拍**：把常量改掉 ⇒ 断言必须变红。
 *   ⇒ 本脚本把 `src/client/stages-panel.tsx` **真编译**（tsc API，内存/临时目录转译），
 *     用 **jsdom + react-dom** **真的挂载**、真的派发 click、真的读 DOM。
 *
 * ══ 沿用哪个既有机件的牙口 ═══════════════════════════════════════════════
 *   · 转译复用 `scripts/ts-mount.mjs`（与 `check:hob-create-dom` / `check:hob-gate` 同一实现），
 *     并按它的 `verifyMounted()` **自证**：产物里不许残留 `.ts` 相对 import、
 *     每条相对 import 必须指向真产出、入口每条源码相对 import 都必须在产出集合里。
 *     自证失败 ⇒ **直接记红**（⛔ 不许"没转出来就跳过"）。
 *
 * ══ ⚠ 边界（如实说）════════════════════════════════════════════════════
 *   · 这是**隔离渲染**（jsdom），⛔ **不是真实宿主浏览器**：宿主的 `SlotCore`、
 *     真实 CSS 层叠、字体度量、侧栏 dock 的布局都不在这里。
 *   · 宿主的 `@deepseek-ai/dsh-client-ui-primitives` **在隔离环境里 import 不了**
 *     （它的 `lib/index.js` 转手 import `clsx` 与一堆 `.module.css`，本仓未装 `clsx`、
 *      Node 也不认 CSS）⇒ 本脚本给它一个**最小替身**（只导出 `Tag` / `StateDot` 两个
 *     纯展示原子，语义与宿主契约一致：`Tag` 渲染 label，`StateDot` 是 `aria-hidden`
 *     的圆点）。⚠ **替身只影响"长什么样"，不影响本脚本判的三件事**（渲染/可点/调用）。
 *   · `ctx.sidebarRight.openTab(kind)` 的调用面用**假服务**验（记录调用参数）；
 *     真实宿主里那条路径仍要**重启后人工验**。
 *
 * ══ 判据（每条都能独立失败；负向对拍见 S-7）════════════════════════════════
 *   S-0 转译图自证（ts-mount 的 verifyMounted）
 *   S-1 四个步骤名 + 唯一状态词，都是**从生产源码抽出来的**（不是本脚本里另抄一份）
 *   S-2 栏脚按钮**真的渲染**且可点（DOM 里有 button[data-dsh-hob=stages-entry]）
 *   S-3 点击 ⇒ `openStages` **真的被调用**恰好一次
 *   S-4 `makeOpenStages(ctx)` 产出的函数 ⇒ 调它 ⇒ 假 `sidebarRight.openTab` 收到
 *       **恰好 `STAGES_TAB_KIND`**
 *   S-5 服务缺席 ⇒ `makeOpenStages` 返回 `undefined`，且栏脚渲染**不可用说明**、
 *       **没有按钮**（如实降级，⛔ 不造假按钮）
 *   S-6 面板挂上后：四行**都在**、顺序对、每行都有「未接线」、且**没有任何数字/百分比**
 *   S-7 **负向对拍**：把步骤名常量改掉 ⇒ S-6 的判据必须变红；把 kind 改掉 ⇒ S-4 必须变红
 *
 * 用法：node scripts/check-stages-panel-dom.mjs     （或 npm run check:stages-dom）
 * 退出码：0 = 全通过；1 = 有失败；2 = 依赖不可用（⛔ 不算通过）
 * ⚠ 依赖 `jsdom@25.0.1` / `react-dom@19.3.1` / `typescript` —— 均在 devDependencies。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const ENTRY = 'src/client/stages-panel.tsx'
const SRC = join(root, ENTRY)
const work = join(root, '.check-stages-work')

let pass = 0
let fail = 0
const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail++; console.log(`  ✗ ${m}`) }

const cleanup = () => { try { rmSync(work, { recursive: true, force: true }) } catch { /* 忽略 */ } }

// ── 依赖探测：缺了就 exit 2（⛔ 不静默算过）──────────────────────────────
let jsdom
let reactDom
let react
try {
  jsdom = await import('jsdom')
  react = await import('react')
  reactDom = await import('react-dom/client')
} catch (e) {
  console.log(`  ⚠ 依赖不可用（jsdom / react / react-dom）：${String(e?.message ?? e)}`)
  console.log('       ⇒ 需 `npm ci`；⛔ 本组**未执行**、不算通过')
  process.exit(2)
}
rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })

console.log('')
console.log('S 组：五步主线面板 · 位置判据（真 DOM 挂载，jsdom 隔离渲染）')
console.log('')

try {
  // ══════════════════════════════════════════════════════════════════════
  // S-1 从**生产源码**抽常量（唯一真值；⛔ 不在本脚本里另抄一份）
  // ══════════════════════════════════════════════════════════════════════
  const src = readFileSync(SRC, 'utf8')
  const pickStr = (name) => {
    const m = new RegExp(`${name}\\s*=\\s*'([^']*)'`).exec(src) ?? new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(src)
    return m === null ? undefined : (m[1] ?? m[2])
  }
  const stepNamesMatch = /STAGES_STEP_NAMES\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(src)
  const prodSteps = stepNamesMatch === null
    ? []
    : [...stepNamesMatch[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2])
  const prodUnwired = pickStr('STAGES_UNWIRED_LABEL')
  const prodKind = pickStr('STAGES_TAB_KIND')
  const prodTabId = pickStr('STAGES_TAB_ID')

  /**
   * ⚠ 2026-10-29 用户裁定：四步 → 五步 ⇒ 这里从 `=== 4` 改成 `=== 5`。
   *   ⚠ 这条是**硬基准**：常量若被改动（少一个/多一个）⇒ 判据失去基准 ⇒ 必须红，
   *     ⛔ 不许写成 `>= 4` 那种"多一个也过"的形态（那会让"第五步没加"看不出来）。
   */
  if (prodSteps.length === 5 && prodUnwired !== undefined && prodKind !== undefined && prodTabId !== undefined) {
    ok(`S-1 ✓ 从 \`${ENTRY}\` 抽出真值：${prodSteps.length} 个步骤名（${prodSteps.join(' / ')}）`
      + ` · 状态词「${prodUnwired}」· tab kind「${prodKind}」· tab id「${prodTabId}」`)
  } else {
    bad('S-1 · 抽不到 `STAGES_STEP_NAMES`（**5 项**）/ `STAGES_UNWIRED_LABEL` / `STAGES_TAB_KIND` / `STAGES_TAB_ID`'
      + ' —— 判据失去基准（常量被改名或结构变了）⇒ 不按通过处理')
  }

  // ══════════════════════════════════════════════════════════════════════
  // 转译（复用 ts-mount）+ 给宿主 primitives 一个最小替身
  // ══════════════════════════════════════════════════════════════════════
  const tsPath = join(root, 'node_modules', 'typescript', 'lib', 'typescript.js')
  const ts = (await import(pathToFileURL(tsPath).href)).default
  const tsMount = await import('./ts-mount.mjs')

  /** 宿主原子的最小替身（⚠ 只导 `Tag` / `StateDot`；语义对齐宿主契约）。 */
  const shimDir = join(work, 'node_modules', '@deepseek-ai', 'dsh-client-ui-primitives')
  mkdirSync(shimDir, { recursive: true })
  writeFileSync(join(shimDir, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-client-ui-primitives', type: 'module', main: 'index.mjs',
  }, null, 2))
  writeFileSync(join(shimDir, 'index.mjs'), `
import React from 'react'
export function Tag({ tone, className, children }) {
  return React.createElement('span', { 'data-primitive': 'Tag', 'data-tone': tone ?? 'outline', className }, children)
}
export function StateDot({ state, size, appearance }) {
  return React.createElement('span', { 'data-primitive': 'StateDot', 'data-state': state, 'aria-hidden': 'true' })
}
`)

  const graph = tsMount.mountTsGraph({ root, outDir: join(work, 'out'), entries: [ENTRY], ts })
  const mountProblems = [
    ...graph.problems,
    ...tsMount.verifyMounted({ root, entries: [ENTRY], mounted: graph.mounted, entryFiles: graph.entries }),
  ]
  if (mountProblems.length > 0) {
    for (const p of mountProblems) bad(`S-0 转译/自证失败：${p}`)
  } else {
    ok(`S-0 ✓ 转译图自证通过（${graph.mounted.join(' · ')}）· 无残留 \`.ts\` 相对 import · 每条相对 import 指向真产出`)
  }

  const entryOut = graph.entries[ENTRY]
  if (entryOut === undefined) throw new Error('入口没有产出（见 S-0）')
  const entryFile = join(work, 'entry.mjs')
  writeFileSync(entryFile, `export * from ${JSON.stringify(entryOut)}\n`)
  const ui = await import(pathToFileURL(entryFile).href)

  // ══════════════════════════════════════════════════════════════════════
  // 隔离 DOM
  // ══════════════════════════════════════════════════════════════════════
  const dom = new jsdom.JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true, url: 'http://localhost/',
  })
  const w = dom.window
  globalThis.window = w
  globalThis.document = w.document
  globalThis.HTMLElement = w.HTMLElement
  globalThis.Node = w.Node
  globalThis.Event = w.Event
  globalThis.MouseEvent = w.MouseEvent
  Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  const { act } = await import('react-dom/test-utils').catch(() => ({ act: undefined }))
  const actFn = act ?? ((fn) => { fn() })
  /**
   * 等一轮异步（`fetchProgress` 是 async ⇒ 状态在 effect 之后的 microtask 里落地）。
   * ⚠ 用 `actFn` 包住，否则 React 会警告"update not wrapped in act"，
   *   且 `stateOf()` 可能读到挂载瞬间的 `reading` 态。
   */
  const tick = async (ms = 30) => { await actFn(async () => { await new Promise((res) => setTimeout(res, ms)) }) }

  const { createRoot } = reactDom
  const mount = (el) => {
    const host = document.getElementById('root')
    host.innerHTML = ''
    const r = createRoot(host)
    actFn(() => { r.render(el) })
    return r
  }
  const text = () => document.getElementById('root').textContent ?? ''

  const execStateOf = () => {
    const el = document.querySelector('[data-dsh-hob="stages-exec-state"]')
    return el === null ? { state: null, text: '' } : { state: el.getAttribute('data-state'), text: el.textContent ?? '' }
  }
  const execItems = () => [...document.querySelectorAll('[data-dsh-hob="stages-exec-item"]')]

  /**
   * **造一个变体模块**（2026-10-30 第 17 轮修：面板现在有了相对 import
   *   `../shared/exec-protocol.ts`，而旧的 inline 写法只 `transpileModule`、**不重写说明符**
   *   ⇒ 产物里残留 `.ts` ⇒ `ERR_MODULE_NOT_FOUND`。本函数把它落到
   *   `work/out/client/<name>.mjs`，这样 `../shared/exec-protocol.ts` 正好指向
   *   `ts-mount` 已经产出的 `work/out/shared/exec-protocol.mjs`（⚠ 只需把扩展名改掉）。
   *
   * @param name - 变体名（文件名）
   * @param mutated - 已改好的源码文本
   * @returns 变体模块的绝对路径
   */
  const writeMutant = (name, mutated) => {
    const outDir = join(work, 'out', 'client')
    mkdirSync(outDir, { recursive: true })
    const out = join(outDir, `${name}.mjs`)
    const code = ts.transpileModule(mutated, {
      compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true },
    }).outputText.replace(/(['"])(\.{1,2}\/[^'"]+)\.tsx?\1/g, "'$2.mjs'")
    writeFileSync(out, code)
    return out
  }

  // ══════════════════════════════════════════════════════════════════════
  // S-2/S-3/S-5 ⚠ **已删除**（2026-10-29 第 9 轮）
  //   改前：断言左栏栏脚按钮真渲染/可点/服务缺席时降级。
  //   现在：入口搬到**侧边栏「开始」页那排**（tab 类型注册的 `guide` 条目），
  //         宿主自己渲染那个胶囊 ⇒ 那三条的被测对象**在本模块里已不存在**。
  //   ⛔ 不是"为了变绿删断言"：被测物被用户裁定搬走了，留着就是**恒红**。
  //   ⇒ 改成断言**guide 条目确实注册了、且 id/order/kind 正确**（见 S-11）。
  // ══════════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════════
  // S-11 入口在**侧边栏 guide 排**：`bindStagesTabType` 注册的类型必须带 guide 条目
  //      （2026-10-29 第 9 轮 · 用户裁定「入口不要放在左下角，放在侧边栏挂载」）
  // ══════════════════════════════════════════════════════════════════════
  {
    /** 假 `sidebarRightTabs`：记录 register 的入参。 */
    const seen = []
    const fakeCtx = {
      logger: { warn: () => {} },
      inject: (_names, cb) => {
        cb({ get: (n) => (n === 'sidebarRightTabs' ? { register: (def) => { seen.push(def); return () => {} } } : undefined) })
        return { dispose: () => {} }
      },
    }
    ui.bindStagesTabType(fakeCtx)
    const def = seen[0]
    const p = []
    if (def === undefined) p.push('`bindStagesTabType` 一次都没调 register')
    else {
      if (def.kind !== prodKind) p.push(`kind 不是 ${JSON.stringify(prodKind)}：${JSON.stringify(def.kind)}`)
      if (!Array.isArray(def.guide) || def.guide.length !== 1) p.push(`guide 不是恰好 1 条：${JSON.stringify(def.guide)}`)
      else {
        const g = def.guide[0]
        if (g.id !== 'dsh-hob-stages') p.push(`guide[0].id 不是 dsh-hob-stages：${JSON.stringify(g.id)}`)
        if (typeof g.title !== 'function' || g.title() !== '任务进度') p.push(`guide[0].title 不是「任务进度」：${JSON.stringify(typeof g.title === 'function' ? g.title() : g.title)}`)
        if (g.order !== 50) p.push(`guide[0].order 不是 50：${JSON.stringify(g.order)}`)
      }
    }
    if (p.length === 0) ok('S-11 ✓ 入口在侧边栏 guide 排：类型注册带 1 条胶囊（id=dsh-hob-stages · order=50 · 标题「任务进度」）')
    else for (const x of p) bad(`S-11 · ${x}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // S-6 面板  // ══════════════════════════════════════════════════════════════════════
  // S-6 面板：四行都在、顺序对、每行「未接线」、无数字/百分比
  // ══════════════════════════════════════════════════════════════════════
  /**
   * 面板断言 —— **抽成函数**，因为 S-7 的负向对拍要拿同一把尺子量一个被改坏的版本。
   *
   * @param mod - 一个导出了 `StagesPanel` 的模块
   * @param steps - **生产**真值（⛔ 不是被测模块自己的导出 —— 那会让负向对拍恒真）
   * @param unwired - **生产**真值
   * @returns 问题清单（空 = 通过）
   */
  const auditPanel = (mod, steps, unwired, fetchProgress) => {
    const problems = []
    // ⚠ 必须注入假 fetch：面板现在会**真发请求**（`defaultFetchProgress`），
    //   jsdom 里没有服务端 ⇒ 不注入就会落到"判不出"，图例仍在但表区是 fail 态。
    //   本条断言只关心**图例四行**，故给一个"表里是空的"的固定响应。
    const r = mount(react.createElement(mod.StagesPanel, {
      fetchProgress: fetchProgress ?? (async () => ({ ok: true, rows: [], readAt: '2026-10-29T00:00:00.000Z', source: 'volumes/tasks/INDEX.md' })),
      // ⚠ 第 17 轮起面板**两路取数**（账面 + 执行态）⇒ 不注入执行态就会在 jsdom 里真发请求。
      fetchExec: async () => ({ ok: true, readAt: '2026-10-29T00:00:00.000Z', source: 'runtime/orch-watches.json', items: [] }),
      fetchStages: async () => ({ ok: true, readAt: '2026-10-30T00:00:00.000Z', stages: [], caps: [] }),
      pollMs: 0,
    }))
    const rows = [...document.querySelectorAll('[data-dsh-hob="stages-row"]')]
    if (rows.length !== steps.length) {
      problems.push(`面板只有 ${rows.length} 行（期望 ${steps.length}）`)
    }
    const got = rows.map((x) => x.textContent ?? '')
    steps.forEach((name, i) => {
      const row = got[i]
      if (row === undefined) { problems.push(`缺第 ${i + 1} 行「${name}」`); return }
      if (!row.includes(name)) problems.push(`第 ${i + 1} 行里没有「${name}」，实际「${row.trim()}」`)
    })
    /**
     * ── 图例区**不许出现状态词**（2026-10-29 第 9 轮 · `CHG-229`）──────────────
     * ⚠ 量的是**图例容器**（`[data-dsh-hob="stages-legend"]`），⛔ 不是全文件 grep：
     *   数据区将来复用这个词时，全文件口径会误报（而误报会逼人改内容迎合判据）。
     */
    const legendEl = document.querySelector('[data-dsh-hob="stages-legend"]')
    if (legendEl === null) {
      problems.push('找不到图例容器 [data-dsh-hob="stages-legend"] ⇒ 本条判据失去基准')
    } else {
      const lt = legendEl.textContent ?? ''
      for (const banned of [unwired, '—', '?', '未就绪', '待接线', '暂无']) {
        if (lt.includes(banned)) problems.push(`图例区出现了状态词「${banned}」（⛔ 图例只许列步名）`)
      }
    }
    const all = text()
    // ⛔ 本轮不许有任何"假进度"的形态：百分比 / 假勾选 / 假完成态。
    //   ⚠ 只查**行内文本**（面板标题「四步进度」里的"进度"是产品名，不是状态值；
    //     把它也算进来就是判据口径写错了 —— 那会让这条断言永远红）。
    if (/%/.test(all)) problems.push('面板里出现了 `%` —— 本轮不许有任何百分比')
    const rowsText = got.join(' ')
    if (/已完成|完成度|已勾选/.test(rowsText)) problems.push('图例行里出现了"已完成/完成度/已勾选"字样')
    // ⚠ 圆点数 = 图例的 steps.length 个（表区在"空表"态下是 0 个）
    const dots = [...document.querySelectorAll('[data-primitive="StateDot"]')]
    if (dots.length < steps.length) problems.push(`状态圆点 ${dots.length} 个（图例至少要 ${steps.length} 个）`)
    if (!dots.every((d) => d.getAttribute('aria-hidden') === 'true')) problems.push('StateDot 未标 aria-hidden（宿主契约要求圆点对读屏隐藏）')
    actFn(() => r.unmount())
    return problems
  }
  {
    const problems = auditPanel(ui, prodSteps, prodUnwired)
    if (problems.length === 0) {
      ok(`S-6 ✓ 面板**五行**齐全、顺序正确、图例区**无任何状态词**（含「${prodUnwired}」）、零百分比`)
    } else {
      for (const p of problems) bad(`S-6 · ${p}`)
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // S-8 三态渲染（2026-10-29 · 第 6 轮 · 任务书 §四②）
  //     ⚠ 有数据 / 真空 / 判不出 —— 三态必须**各自可读**，且判不出时
  //       ⛔ 不许出现「0 行」冒充空、⛔ 不许出现 `%`。
  // ══════════════════════════════════════════════════════════════════════
  {
    /** 挂载面板并等一轮 microtask/effect 落地（fetch 是 async）。 */
    const mountPanel = async (fetchProgress, extra) => {
      const r = mount(react.createElement(ui.StagesPanel, {
        fetchProgress,
        fetchExec: async () => ({ ok: true, readAt: '2026-10-29T00:00:00.000Z', source: 'runtime/orch-watches.json', items: [] }),
        // ⚠ P3 起面板有**第三路**取数（五步树）⇒ 不注入就会在 jsdom 里真发请求。
        fetchStages: async () => ({ ok: true, readAt: '2026-10-30T00:00:00.000Z', stages: [], caps: [] }),
        pollMs: 0,
        ...(extra ?? {}),
      }))
      await tick(30)
      return r
    }
    /** 执行态区域的三态读数（`data-dsh-hob="stages-exec-state"`）。 */
    const stateOf = () => {
      const el = document.querySelector('[data-dsh-hob="stages-state"]')
      return el === null ? { state: null, text: '' } : { state: el.getAttribute('data-state'), text: el.textContent ?? '' }
    }



    // —— S-8a 有数据 ⇒ 逐行显示 ——
    {
      const r = await mountPanel(async () => ({
        ok: true,
        readAt: '2026-10-29T00:00:00.000Z',
        source: 'volumes/tasks/INDEX.md',
        rows: [
          { name: 'REQ-01', step: 'unfilled', blockedBy: '' },
          { name: 'FIVE-STAGE', step: '4', blockedBy: '用户（重启验界面）' },
        ],
      }))
      const rows = [...document.querySelectorAll('[data-dsh-hob="stages-progress-row"]')]
      const t = text()
      const p = []
      if (rows.length !== 2) p.push(`进度行 ${rows.length} 条（期望 2）`)
      if (!t.includes('REQ-01')) p.push('缺 REQ-01')
      if (!t.includes('FIVE-STAGE')) p.push('缺 FIVE-STAGE')
      if (!t.includes('未回填')) p.push('缺「未回填」（unfilled 的展示词）')
      if (!t.includes('4 任务执行')) p.push('缺「4 任务执行」（step=4 的展示词）')
      if (!t.includes('用户（重启验界面）')) p.push('缺卡点列「用户（重启验界面）」')
      if (/%/.test(t)) p.push('出现了 `%` —— 本轮零百分比')
      if (p.length === 0) ok(`S-8a ✓ 有数据 ⇒ ${rows.length} 行逐行显示（名称/第几步/卡在谁那里 三项都在）`)
      else for (const x of p) bad(`S-8a · ${x}`)
      actFn(() => r.unmount())
    }

    // —— S-8f `'5'`（在做验收）与 `'done'`（已验收通过）的**展示词**必须不同 ——
    {
      const r = await mountPanel(async () => ({
        ok: true, readAt: '2026-10-29T00:00:00.000Z', source: 'volumes/tasks/INDEX.md',
        rows: [{ name: 'A', step: '5', blockedBy: '甲' }, { name: 'B', step: 'done', blockedBy: '乙' }],
      }))
      const t = text()
      const p = []
      if (!t.includes('5 验收核对')) p.push(`'5' 没显示成「5 验收核对」：${JSON.stringify(t)}`)
      if (!t.includes('验收完成')) p.push(`'done' 没显示成「✅ 验收完成」：${JSON.stringify(t)}`)
      // ⚠ 两态不许合并：'5' 那行**不许**被写成"验收完成"
      if (t.split('验收完成').length - 1 > 1) p.push('"验收完成"出现多于一次 ⇒ 疑把 \'5\' 也写成了"验收完成"（两态合并）')
      if (p.length === 0) ok("S-8f ✓ '5'（在做验收）与 'done'（已验收通过）展示词不同，⛔ 没合并")
      else for (const x of p) bad(`S-8f · ${x}`)
      actFn(() => r.unmount())
    }

    // —— S-12 404/405「打错门」与「读不到账本」必须分开说（第 10 轮）——
    {
      /**
       * 注入"404 纯文本"的假响应 —— **必须真的走 `defaultFetchProgress`**
       * （⛔ 不能只在面板层塞一个 Error：那样测不到 404 判定那段代码）。
       */
      const realFetch = globalThis.fetch
      globalThis.fetch = async () => ({
        status: 404,
        ok: false,
        json: async () => { throw new SyntaxError("Unexpected token 'o', \"not found\" is not valid JSON") },
        clone: () => ({ text: async () => 'not found' }),
      })
      let r
      try {
        r = mount(react.createElement(ui.StagesPanel, { sessionId: 's1' }))
        await tick(40)
      } finally {
        globalThis.fetch = realFetch
      }
      const st = stateOf()
      const t = text()
      const p = []
      if (!/这个路径没有处理体/.test(t)) p.push(`界面没有那句"没有处理体"：${JSON.stringify(t.slice(0, 160))}`)
      if (/Unexpected token/.test(t)) p.push('界面里出现了 `Unexpected token`（这正是要消灭的那句）')
      if (st.state !== 'undecidable') p.push(`状态不是 undecidable：${JSON.stringify(st.state)}`)
      if (p.length === 0) ok('S-12 ✓ 404 纯文本 ⇒ 显示「这个路径没有处理体（可能是方法或前缀不对）」，且不出现 `Unexpected token`')
      else for (const x of p) bad(`S-12 · ${x}`)
      actFn(() => r.unmount())
    }

    // —— S-12b 负向对拍：去掉 404 判定 ⇒ S-12 必须变红 ——
    {
      const mutated = src.replace(
        "  if (res.status === 404 || res.status === 405) {",
        "  if (false) {",
      )
      if (mutated === src) {
        bad('S-12b · 造不出「去掉 404 判定」的变体（源码形态变了）⇒ 负向对拍不可判')
      } else {
        const out = writeMutant('mut-404', mutated)
        const modN = await import(pathToFileURL(out).href)
        const realFetch2 = globalThis.fetch
        globalThis.fetch = async () => ({
          status: 404, ok: false,
          json: async () => { throw new SyntaxError("Unexpected token 'o', \"not found\" is not valid JSON") },
          clone: () => ({ text: async () => 'not found' }),
        })
        let r2
        try {
          r2 = mount(react.createElement(modN.StagesPanel, { sessionId: 's1' }))
          await tick(40)
        } finally { globalThis.fetch = realFetch2 }
        const t2 = document.querySelector('[data-dsh-hob="stages-state"]')?.textContent ?? ''
        if (!/这个路径没有处理体/.test(t2)) {
          ok(`S-12b ✓ 负向对拍（去掉 404 判定）⇒ S-12 必红：实际「${t2.trim().slice(0, 90)}」`)
        } else {
          bad('S-12b · 去掉 404 判定后界面**仍**显示那句 ⇒ 断言没有牙')
        }
        actFn(() => r2.unmount())
      }
    }

    // —— S-10 负向对拍：把「未接线」加回图例 ⇒ S-6 的图例断言必须变红 ——
    {
      const mutated = src.replace(
        "      React.createElement('span', { style: nameStyle }, name),\n    )),",
        "      React.createElement('span', { style: nameStyle }, name),\n      React.createElement(Tag, { tone: 'outline' }, STAGES_UNWIRED_LABEL),\n    )),",
      )
      if (mutated === src) {
        bad('S-10 · 造不出「把未接线加回图例」的变体（源码形态变了）⇒ 负向对拍不可判')
      } else {
        const out = writeMutant('mut-legend', mutated)
        const modL = await import(pathToFileURL(out).href)
        const pL = auditPanel(modL, prodSteps, prodUnwired)
        if (pL.length > 0) {
          ok(`S-10 ✓ 负向对拍（把「未接线」加回图例）⇒ S-6 图例断言**变红**：${pL[0]}`)
        } else {
          bad('S-10 · 把「未接线」加回图例后 S-6 仍通过 ⇒ 图例断言没有牙')
        }
      }
    }

    // —— S-9 **sessionId 必须真的送到请求里**（2026-10-29 第 8 轮真机缺陷）——
    {
      let got
      const r = mount(react.createElement(ui.StagesPanel, {
        sessionId: 'session-probe-123',
        fetchProgress: async (sid) => { got = sid; return { ok: true, rows: [] } },
      }))
      await tick(30)
      if (got === 'session-probe-123') {
        ok(`S-9 ✓ 面板把 host 给的 sessionId 真的传给了取数函数（got=${JSON.stringify(got)}）`)
      } else {
        bad(`S-9 · 取数函数没收到 sessionId（got=${JSON.stringify(got)}）⇒ 真机上会"账本根判不出"`)
      }
      actFn(() => r.unmount())
    }

    // —— S-8b 真空（表在、零行）⇒ 必须写「表里是空的」 ——
    {
      const r = await mountPanel(async () => ({ ok: true, readAt: '2026-10-29T00:00:00.000Z', source: 'volumes/tasks/INDEX.md', rows: [] }))
      const st = stateOf()
      const p = []
      if (st.state !== 'empty') p.push(`data-state=${JSON.stringify(st.state)}（期望 empty）`)
      if (!st.text.includes('表里是空的')) p.push(`文本里没有「表里是空的」：${JSON.stringify(st.text)}`)
      if (/没有数据/.test(st.text)) p.push('出现了「没有数据」这种含糊话（⛔ 禁用）')
      if (p.length === 0) ok('S-8b ✓ 真空 ⇒ 明写「表里是空的」（⛔ 不是"没有数据"）')
      else for (const x of p) bad(`S-8b · ${x}`)
      actFn(() => r.unmount())
    }

    // —— S-8c 判不出 ⇒ 明写「判不出」+ 一句原因，且 ⛔ 不出现「0」冒充空 ——
    {
      const r = await mountPanel(async () => ({ ok: false, reason: 'ledger-unreadable', message: '账本根判不出 ⇒ 不知道该读哪本账（⛔ 不猜）' }))
      const st = stateOf()
      const reasonEl = document.querySelector('[data-dsh-hob="stages-reason"]')
      const t = document.querySelector('[data-dsh-hob="stages-state"]')?.textContent ?? ''
      const p = []
      if (st.state !== 'undecidable') p.push(`data-state=${JSON.stringify(st.state)}（期望 undecidable）`)
      if (!st.text.includes('判不出')) p.push(`文本里没有「判不出」：${JSON.stringify(st.text)}`)
      if (reasonEl === null || (reasonEl.textContent ?? '').trim() === '') p.push('没有给"一句原因"（`stages-reason` 缺席或空）')
      // ⛔ 判不出时不许出现 0（"0 行"会让人误读成"表里是空的"）
      if (/(^|[^0-9])0($|[^0-9])/.test(t)) p.push(`判不出态里出现了数字 0：${JSON.stringify(t)}`)
      if (/%/.test(t)) p.push('判不出态里出现了 `%`')
      // ⚠ 反向：判不出时**不许**有进度行（那才是"显示 0 行冒充空"的反面陷阱）
      if (document.querySelectorAll('[data-dsh-hob="stages-progress-row"]').length !== 0) p.push('判不出态却渲染了进度行')
      if (p.length === 0) ok('S-8c ✓ 判不出 ⇒ 明写「判不出」+ 一句原因；零进度行、无「0」、无 `%`')
      else for (const x of p) bad(`S-8c · ${x}`)
      actFn(() => r.unmount())
    }

    // —— S-8d 网络抛错 ⇒ 也落"判不出"（⛔ 不许落成"空表"）——
    {
      const r = await mountPanel(async () => { throw new Error('Failed to fetch') })
      const st = stateOf()
      if (st.state === 'undecidable' && st.text.includes('判不出')) {
        ok('S-8d ✓ fetch 抛错 ⇒ 落"判不出"（⛔ 没落成"表里是空的"）')
      } else {
        bad(`S-8d · fetch 抛错后状态不对：state=${JSON.stringify(st.state)} text=${JSON.stringify(st.text)}`)
      }
      actFn(() => r.unmount())
    }

    // —— S-8e 负向对拍：把"表里是空的"改成一个含糊词 ⇒ S-8b 必须变红 ——
    {
      const mutated = src.replace("STAGES_EMPTY_TEXT = '表里是空的'", "STAGES_EMPTY_TEXT = '没有数据'")
      if (mutated === src) {
        bad('S-8e · 造不出「改空态文案」的变体 ⇒ 负向对拍不可判')
      } else {
        const out = writeMutant('mut-empty', mutated)
        const modE = await import(pathToFileURL(out).href)
        const r = mount(react.createElement(modE.StagesPanel, { fetchProgress: async () => ({ ok: true, rows: [] }) }))
        await tick(30)
        const st = stateOf()
        if (!st.text.includes('表里是空的')) {
          ok(`S-8e ✓ 负向对拍（空态文案改成「没有数据」）⇒ S-8b 必红：实际「${st.text.trim()}」`)
        } else {
          bad('S-8e · 改了空态文案，S-8b 判据**仍然通过** ⇒ 没有牙')
        }
        actFn(() => r.unmount())
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // S-7 负向对拍（证明上面那条判据**有牙**，不是恒真）
  // ══════════════════════════════════════════════════════════════════════
  {
    /**
     * 造一个"被改坏"的模块：只做**字符串替换**（步骤名 / kind），其余源码不动。
     * ⚠ 用 `transpileModule` 单文件即可 —— 该文件零相对 import。
     */
    const buildMutant = (name, replace) => {
      const mutated = replace(src)
      if (mutated === src) return undefined
      return writeMutant(name, mutated)
    }

    // ══════════════════════════════════════════════════════════════════
    // S-13 执行项（第 4 步子项）—— 2026-10-30 第 17 轮
    //   ⚠ 五条断言，各配负向对拍；对应任务书 §三2 的清单。
    // ══════════════════════════════════════════════════════════════════

    /** 造一份"两执行项"的执行态响应（含一条**卡住**的脏数据 —— 必须照实显示）。 */
    /**
     * ⚠ **树内第 ④ 步必须 `doing`** —— 它默认展开，`execList` 才会渲染
     *   （P13 把树外那份删了，`execItems()` 现在只可能来自树内展开体）。
     */
    const EXEC_STAGES_DOING = {
      ok: true,
      readAt: '2026-10-30T00:00:00.000Z',
      stages: [
        { step: 1, name: '需求规格', state: 'done', done: 1, total: 1, items: [] },
        { step: 2, name: '实现方案', state: 'done', done: 1, total: 1, items: [] },
        { step: 3, name: '编码任务', state: 'done', done: 1, total: 1, items: [] },
        { step: 4, name: '任务执行', state: 'doing', done: 0, total: 1, items: [] },
        { step: 5, name: '验收核对', state: 'todo', done: 0, total: 1, items: [] },
      ],
      caps: [],
    }

    const EXEC_TWO = {
      ok: true,
      readAt: '2026-10-30T00:00:00.000Z',
      source: 'runtime/orch-watches.json',
      /**
       * ⚠ 2026-10-30 第 21 轮：线格式已带 `bucket` / `count` / `unrunCount`
       *   （第 20 轮分档、第 21 轮加未开跑计数）⇒ 夹具必须补齐，否则第 1 项会被判成历史档、
       *   展示词变「曾运行」，S-13a 的「执行中」断言就成了假红。
       */
      items: [
        { target: 'aaaaaaaa', state: 'running', bucket: 'now', count: 1, unrunCount: 0, elapsedMs: 65000, rechecks: 2 },
        { target: 'bbbbbbbb', state: 'stuck', bucket: 'now', count: 1, unrunCount: 1, rechecks: 3 },
      ],
    }

    // —— S-13a 有执行项 ⇒ 逐项渲染（`data-dsh-hob="stages-exec-item"` 在）——
    {
      /**
       * ⚠⚠ **2026-10-30 P13：必须注入 `fetchStages`，且第 ④ 步要 `doing`**。
       *   改前：`execList` 在外层 `stages-exec` 区块里 ⇒ 只要挂载就渲染。
       *   改后：**树外那份已删**，`execList` 只出现在树内第 ④ 步的展开体里
       *   ⇒ 树里若第 ④ 步不是 `doing`（默认不展开），`execList` **根本不渲染** ⇒ 本组全红。
       *   ⚠ 这是**测量面变化**（被测元素从"外层区块"移到"树内展开体"），⛔ 不是放宽：
       *     断言仍在量同一批 `stages-exec-*` DOM，只是挂载路径变了。
       */
      const r = mount(react.createElement(ui.StagesPanel, {
        fetchProgress: async () => ({ ok: true, rows: [], readAt: '2026-10-30T00:00:00.000Z', source: 'volumes/tasks/INDEX.md' }),
        fetchExec: async () => EXEC_TWO,
        fetchStages: async () => EXEC_STAGES_DOING,
        pollMs: 0,
      }))
      await tick(30)
      const items = execItems()
      const probs = []
      if (items.length !== 2) probs.push(`渲染了 ${items.length} 个执行项（期望 2）`)
      else {
        const t0 = items[0].getAttribute('data-target')
        const s0 = items[0].getAttribute('data-exec-state')
        if (t0 !== 'aaaaaaaa') probs.push(`第 1 项 data-target 不是 aaaaaaaa：${JSON.stringify(t0)}`)
        if (s0 !== 'running') probs.push(`第 1 项 data-exec-state 不是 running：${JSON.stringify(s0)}`)
        const txt = items[0].textContent ?? ''
        if (!txt.includes('执行中')) probs.push(`第 1 项没有九态的**中文措辞**（执行中）：${JSON.stringify(txt)}`)
        if (!txt.includes('已跑')) probs.push(`第 1 项没有"已跑时长"：${JSON.stringify(txt)}`)
        if (!txt.includes('重核')) probs.push(`第 1 项没有"重核次数"：${JSON.stringify(txt)}`)
        // ⚠ 第 2 项是"卡住"那条脏数据 —— 必须**照实显示**，⛔ 不许美化/过滤
        const t1 = items[1].textContent ?? ''
        if (!t1.includes('卡住')) probs.push(`第 2 项（卡住那条）没照实显示：${JSON.stringify(t1)}`)
        if (!/判不出/.test(t1)) probs.push(`第 2 项缺少 elapsedMs ⇒ 应写"判不出"，实际：${JSON.stringify(t1)}`)
      }
      /**
       * ⛔ 零百分比、零进度条、零勾选
       *
       * ⚠⚠ **2026-10-30 P13：测量面从「整个 root」收窄到「执行项所在容器」。**
       *   改前量 `document.getElementById('root').innerHTML` —— 那时树不渲染（没注 `fetchStages`），
       *   root 里只有执行项 ⇒ 全量扫等价于只扫执行项。
       *   改后树真渲染了 ⇒ 树的 `treeHeadStyle` 带 `width: '100%'`（**布局 CSS，不是完成度**）
       *   ⇒ 全量扫会把布局样式误判成"百分比读数"——**那是假红**（断言口径错了，不是内容错）。
       *   ⚠ 所以改成量**执行项自身容器**：`[data-dsh-hob="stages-tree-body"]`（第 ④ 步展开体）。
       *   ⚠ 这不是放宽：被测对象仍是"执行项区域"，断言强度不变；⚠ 且百分比若真出现在执行项里，
       *     仍然会红（下面的 S-17e 负向对拍证明这条口径有牙）。
       */
      const execHost = document.querySelector('[data-dsh-hob="stages-tree-step"][data-step="4"] [data-dsh-hob="stages-tree-body"]')
      const html = execHost === null ? '' : execHost.innerHTML
      if (execHost === null) probs.push('找不到第 ④ 步展开体（执行项容器）⇒ 零百分比断言失去测量面')
      if (/%/.test(html)) probs.push('执行项区域出现了 `%`（用户明确否掉完成度）')
      if (/<progress|role="progressbar"|type="checkbox"/.test(html)) probs.push('执行项区域出现了进度条/勾选控件')
      if (probs.length === 0) ok('S-13a ✓ 有执行项 ⇒ 逐项渲染（data-dsh-hob="stages-exec-item" · 目标/态/已跑/重核齐全 · 卡住那条照实显示 · 零 % 零进度条零勾选）')
      else for (const x of probs) bad(`S-13a · ${x}`)
      actFn(() => r.unmount())
    }

    // —— S-13b 无执行项 ⇒ 「这一项没有在跑的活」——
    {
      const r = mount(react.createElement(ui.StagesPanel, {
        fetchProgress: async () => ({ ok: true, rows: [], readAt: '2026-10-30T00:00:00.000Z', source: 'volumes/tasks/INDEX.md' }),
        fetchStages: async () => EXEC_STAGES_DOING,
        fetchExec: async () => ({ ok: true, readAt: '2026-10-30T00:00:00.000Z', source: 'runtime/orch-watches.json', items: [] }),
        pollMs: 0,
      }))
      await tick(30)
      const st = execStateOf()
      const want = ui.STAGES_EXEC_EMPTY_TEXT
      if (st.state === 'empty' && st.text.includes(want)) {
        ok(`S-13b ✓ 无执行项 ⇒ data-state=empty 且写「${want}」（R-4：⛔ 不说成"没发生"）`)
      } else {
        bad(`S-13b · 期望 state=empty + 「${want}」，实际 state=${JSON.stringify(st.state)} text=${JSON.stringify(st.text)}`)
      }
      actFn(() => r.unmount())
    }

    // —— S-13c 判不出 ⇒ 「判不出」+ 原因，且**不出现 `0`、不出现 `%`** ——
    {
      const r = mount(react.createElement(ui.StagesPanel, {
        fetchProgress: async () => ({ ok: true, rows: [], readAt: '2026-10-30T00:00:00.000Z', source: 'volumes/tasks/INDEX.md' }),
        fetchStages: async () => EXEC_STAGES_DOING,
        fetchExec: async () => ({ ok: false, reason: 'state-missing', message: '运行态文件不存在 —— 这台机器还没派过活' }),
        pollMs: 0,
      }))
      await tick(30)
      const st = execStateOf()
      const probs = []
      if (st.state !== 'undecidable') probs.push(`data-state 不是 undecidable：${JSON.stringify(st.state)}`)
      if (!st.text.includes('判不出')) probs.push(`没写「判不出」：${JSON.stringify(st.text)}`)
      const reasonEl = document.querySelector('[data-dsh-hob="stages-exec-reason"]')
      if (reasonEl === null || (reasonEl.textContent ?? '').trim() === '') probs.push('没有给原因（stages-exec-reason 缺失或空）')
      // ⚠ 判不出的区域**不许出现 `0` 与 `%`**（那是判不出时最容易被滥用的两个假读数）
      const area = document.querySelector('[data-dsh-hob="stages-exec-state"]')
      const areaText = area?.textContent ?? ''
      if (/0/.test(areaText)) probs.push(`判不出的区域出现了 \`0\`：${JSON.stringify(areaText)}`)
      if (/%/.test(areaText)) probs.push(`判不出的区域出现了 \`%\`：${JSON.stringify(areaText)}`)
      if (probs.length === 0) ok('S-13c ✓ 判不出 ⇒ data-state=undecidable · 写「判不出」+ 原因 · 区域里零 `0` 零 `%`')
      else for (const x of probs) bad(`S-13c · ${x}`)
      actFn(() => r.unmount())
    }

    // —— S-13d 轮询：调了 2 次；不可见时不再调 ——
    {
      /**
       * ⚠ 用**真 setInterval + 小间隔**（`pollMs=40`）跑两次 tick，不引假定时器：
       *   假定时器要替换全局 `setInterval`，反而会掩盖"真的用了 setInterval"这件事。
       */
      let calls = 0
      const hiddenRef = { v: false }
      const prevVis = Object.getOwnPropertyDescriptor(document, 'visibilityState')
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hiddenRef.v ? 'hidden' : 'visible') })
      const r = mount(react.createElement(ui.StagesPanel, {
        fetchProgress: async () => { calls += 1; return { ok: true, rows: [], readAt: '2026-10-30T00:00:00.000Z', source: 'volumes/tasks/INDEX.md' } },
        fetchStages: async () => EXEC_STAGES_DOING,
        fetchExec: async () => ({ ok: true, readAt: '2026-10-30T00:00:00.000Z', source: 'runtime/orch-watches.json', items: [] }),
        pollMs: 40,
      }))
      await tick(140)
      const afterPoll = calls
      // 切到隐藏 ⇒ 停轮询
      hiddenRef.v = true
      try { document.dispatchEvent(new (await import('jsdom')).JSDOM('').window.Event('visibilitychange')) } catch { document.dispatchEvent(new Event('visibilitychange')) }
      await tick(20)
      const atHide = calls
      await tick(150)
      const afterHidden = calls
      const probs = []
      if (afterPoll < 2) probs.push(`可见期间只调了 ${afterPoll} 次（期望 ≥2 ⇒ 轮询没跑起来）`)
      if (afterHidden !== atHide) probs.push(`不可见之后又调了 ${afterHidden - atHide} 次（期望 0 ⇒ 没有停轮询）`)
      if (probs.length === 0) {
        ok(`S-13d ✓ 轮询生效：可见期调了 ${afterPoll} 次；切到 hidden 后 150ms 内**零新增**（停在 ${atHide} 次）`)
      } else for (const x of probs) bad(`S-13d · ${x}`)
      actFn(() => r.unmount())
      if (prevVis === undefined) delete document.visibilityState
      else Object.defineProperty(document, 'visibilityState', prevVis)
    }

    // —— S-13e 手动刷新按钮真的触发了一次取数 ——
    {
      let calls = 0
      const r = mount(react.createElement(ui.StagesPanel, {
        fetchProgress: async () => { calls += 1; return { ok: true, rows: [], readAt: '2026-10-30T00:00:00.000Z', source: 'volumes/tasks/INDEX.md' } },
        fetchStages: async () => EXEC_STAGES_DOING,
        fetchExec: async () => ({ ok: true, readAt: '2026-10-30T00:00:00.000Z', source: 'runtime/orch-watches.json', items: [] }),
        pollMs: 0,
      }))
      await tick(30)
      const before = calls
      const btn = document.querySelector('[data-dsh-hob="stages-refresh"]')
      if (btn === null) bad('S-13e · 找不到手动刷新按钮（`data-dsh-hob="stages-refresh"`）')
      else {
        actFn(() => { btn.dispatchEvent(new (btn.ownerDocument.defaultView ?? window).MouseEvent('click', { bubbles: true })) })
        await tick(40)
        if (calls === before + 1) ok(`S-13e ✓ 手动刷新按钮点一次 ⇒ 取数 +1（${before} → ${calls}）`)
        else bad(`S-13e · 点刷新后取数次数 ${before} → ${calls}（期望 +1）`)
      }
      actFn(() => r.unmount())
    }

    // —— S-13f 负向对拍：空态文案改掉 ⇒ S-13b 必红 ——
    {
      const mutant = buildMutant('exec-empty', (t) => t.replace("export const STAGES_EXEC_EMPTY_TEXT = '这一项没有在跑的活'", "export const STAGES_EXEC_EMPTY_TEXT = '无'"))
      if (mutant === undefined) {
        bad('S-13f · 造不出「改空态文案」的变体（源码形态变了）⇒ 负向对拍不可判')
      } else {
        const modE = await import(pathToFileURL(mutant).href)
        const r = mount(react.createElement(modE.StagesPanel, {
          fetchProgress: async () => ({ ok: true, rows: [], readAt: '2026-10-30T00:00:00.000Z', source: 'volumes/tasks/INDEX.md' }),
          fetchStages: async () => EXEC_STAGES_DOING,
            fetchExec: async () => ({ ok: true, readAt: '2026-10-30T00:00:00.000Z', source: 'runtime/orch-watches.json', items: [] }),
          pollMs: 0,
        }))
        await tick(30)
        const st = execStateOf()
        if (!st.text.includes('这一项没有在跑的活')) {
          ok(`S-13f ✓ 负向对拍（空态文案改成"无"）⇒ S-13b 的文案断言**必红**：实际 ${JSON.stringify(st.text)}`)
        } else {
          bad('S-13f · 改了空态文案，S-13b 仍通过 ⇒ 那条断言没有牙')
        }
        actFn(() => r.unmount())
      }
    }

    // —— S-13g 负向对拍：轮询停不下来 ⇒ S-13d 必红（把 visibilitychange 处理摘掉）——
    {
      const mutant = buildMutant('exec-novis', (t) => t.replace(
        "    const onVisibleChange = (): void => {\n      if (isHidden()) { stop(); return }\n      pull()\n      start()\n    }",
        "    const onVisibleChange = (): void => {\n      pull()\n      start()\n    }",
      ).replace(
        "    if (isHidden()) stop(); else start()",
        "    start()",
      ).replace(
        "      timer = setInterval(() => { if (!isHidden()) pull() }, interval)",
        "      timer = setInterval(() => { pull() }, interval)",
      ))
      if (mutant === undefined) {
        bad('S-13g · 造不出「去掉可见性判断」的变体（源码形态变了）⇒ 负向对拍不可判')
      } else {
        const modN = await import(pathToFileURL(mutant).href)
        let calls2 = 0
        const hidden2 = { v: false }
        const prevVis2 = Object.getOwnPropertyDescriptor(document, 'visibilityState')
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden2.v ? 'hidden' : 'visible') })
        const r = mount(react.createElement(modN.StagesPanel, {
          fetchProgress: async () => { calls2 += 1; return { ok: true, rows: [], readAt: '2026-10-30T00:00:00.000Z', source: 'volumes/tasks/INDEX.md' } },
          fetchStages: async () => EXEC_STAGES_DOING,
            fetchExec: async () => ({ ok: true, readAt: '2026-10-30T00:00:00.000Z', source: 'runtime/orch-watches.json', items: [] }),
          pollMs: 40,
        }))
        await tick(100)
        hidden2.v = true
        document.dispatchEvent(new Event('visibilitychange'))
        await tick(20)
        const atHide2 = calls2
        await tick(150)
        if (calls2 > atHide2) {
          ok(`S-13g ✓ 负向对拍（摘掉可见性判断）⇒ S-13d 的"不可见后零新增"**必红**：又多调了 ${calls2 - atHide2} 次`)
        } else {
          bad('S-13g · 摘掉可见性判断后仍然不调 ⇒ S-13d 的判据来源不是它')
        }
        actFn(() => r.unmount())
        if (prevVis2 === undefined) delete document.visibilityState
        else Object.defineProperty(document, 'visibilityState', prevVis2)
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // S-14 两档 + 合并 + 「未开跑」+ 历史默认折叠（2026-10-30 第 20 轮 · R-1）
    //   ⚠ 任务书 §二2 的 A/B/C/D 四条，各配负向对拍（E 条）。
    // ══════════════════════════════════════════════════════════════════

    /** 一份两档执行态：现在 1 条、历史 3 条（同一 target 3 条 ⇒ 应合并成 1 行）。 */
    const EXEC_BOTH = {
      ok: true,
      readAt: '2026-10-30T00:00:00.000Z',
      source: 'runtime/orch-watches.json',
      items: [
        { target: 'nowaaaaa', state: 'running', bucket: 'now', count: 1, elapsedMs: 65000, rechecks: 2 },
        // ⚠ 历史里同一 target 3 条 —— 服务端已合并成 count:3
        { target: 'histbbbb', state: 'accepted', bucket: 'history', count: 3, elapsedMs: 3600000, rechecks: 1 },
        // ⚠ 真机那批：running 但无 elapsedMs（从未进过运行态）⇒ 必须「未开跑」
        { target: 'histcccc', state: 'running', bucket: 'history', count: 1, rechecks: 0 },
      ],
    }

    // —— S-14a 判据A：档位不交叉（pending 只在 now、lost/closed 只在 history）——
    {
      const r = mount(react.createElement(ui.StagesPanel, {
        fetchProgress: async () => ({ ok: true, rows: [], readAt: '2026-10-30T00:00:00.000Z', source: 'volumes/tasks/INDEX.md' }),
        fetchStages: async () => EXEC_STAGES_DOING,
        fetchExec: async () => EXEC_BOTH,
        pollMs: 0,
      }))
      await tick(30)
      const items = execItems()
      const probs = []
      const nowItems = items.filter((x) => x.getAttribute('data-bucket') === 'now')
      const hist = items.filter((x) => x.getAttribute('data-bucket') === 'history')
      if (nowItems.length !== 1) probs.push(`「现在」档行数 ${nowItems.length}（期望 1）`)
      if (hist.length !== 2) probs.push(`「历史」档行数 ${hist.length}（期望 2）`)
      if (nowItems.some((x) => x.getAttribute('data-target') === 'histbbbb')) probs.push('「现在」档里混进了历史记录')
      if (hist.some((x) => x.getAttribute('data-target') === 'nowaaaaa')) probs.push('「历史」档里混进了现在记录')
      // 两档各有标题
      const titles = [...document.querySelectorAll('[data-dsh-hob="stages-exec-bucket-title"]')].map((x) => x.textContent ?? '')
      if (!titles.some((t) => t.includes('现在'))) probs.push(`「现在」档没有标题：${JSON.stringify(titles)}`)
      if (!titles.some((t) => t.includes('历史'))) probs.push(`「历史」档没有标题：${JSON.stringify(titles)}`)
      // DOM 顺序：现在档在历史档之前
      const buckets = [...document.querySelectorAll('[data-dsh-hob="stages-exec-bucket"]')].map((x) => x.getAttribute('data-bucket'))
      if (buckets.indexOf('now') > buckets.indexOf('history') && buckets.includes('history')) probs.push(`「现在」档没有排在「历史」之前：${JSON.stringify(buckets)}`)
      if (probs.length === 0) ok('S-14a ✓ 判据A 两档不交叉：现在 1 行 / 历史 2 行 · 各带标题 · 现在档整体在前')
      else for (const x of probs) bad(`S-14a · ${x}`)
      actFn(() => r.unmount())
    }

    // —— S-14b 判据B：合并行只占 1 行且带「共 3 条」——
    {
      const r = mount(react.createElement(ui.StagesPanel, {
        fetchProgress: async () => ({ ok: true, rows: [], readAt: '2026-10-30T00:00:00.000Z', source: 'volumes/tasks/INDEX.md' }),
        fetchStages: async () => EXEC_STAGES_DOING,
        fetchExec: async () => EXEC_BOTH,
        pollMs: 0,
      }))
      await tick(30)
      const rows = execItems().filter((x) => x.getAttribute('data-target') === 'histbbbb')
      const probs = []
      if (rows.length !== 1) probs.push(`同一 target 渲染了 ${rows.length} 行（期望 1）`)
      else {
        const cnt = rows[0].querySelector('[data-dsh-hob="stages-exec-count"]')
        if (cnt === null) probs.push('合并不出「共 N 条」标记（stages-exec-count 缺失）')
        else if (!/共\s*3\s*条/.test(cnt.textContent ?? '')) probs.push(`「共 N 条」文案不对：${JSON.stringify(cnt.textContent)}`)
        /**
         * ⚠ 合并行的时长口径是「该 target 历史上最长一次」⇒ 文案必须**明说"最长"**
         *   （任务书 §一5 要保住 56h/67h 那两条真读数；口径不写清 = 拿一个口径冒充另一个）。
         */
        const t = rows[0].textContent ?? ''
        if (!t.includes('已跑（最长）')) probs.push(`合并行时长没写「已跑（最长）」口径：${JSON.stringify(t)}`)
      }
      if (probs.length === 0) ok('S-14b ✓ 判据B 合并：同 target 3 条 ⇒ 1 行 · 带「共 3 条」')
      else for (const x of probs) bad(`S-14b · ${x}`)
      actFn(() => r.unmount())
    }

    // —— S-14c 判据C：无 ranMs 的历史 running ⇒ 文本不含「执行中」，写「未开跑」——
    {
      const r = mount(react.createElement(ui.StagesPanel, {
        fetchProgress: async () => ({ ok: true, rows: [], readAt: '2026-10-30T00:00:00.000Z', source: 'volumes/tasks/INDEX.md' }),
        fetchStages: async () => EXEC_STAGES_DOING,
        fetchExec: async () => EXEC_BOTH,
        pollMs: 0,
      }))
      await tick(30)
      const row = execItems().find((x) => x.getAttribute('data-target') === 'histcccc')
      const probs = []
      if (row === undefined) probs.push('找不到那条「从未开跑」的历史记录行')
      else {
        const t = row.textContent ?? ''
        if (t.includes('执行中')) probs.push(`含「执行中」：${JSON.stringify(t)}`)
        if (!t.includes('未开跑')) probs.push(`没写「未开跑」：${JSON.stringify(t)}`)
      }
      // 对照：真在跑的那条**必须**仍是「执行中」
      const nowRow = execItems().find((x) => x.getAttribute('data-target') === 'nowaaaaa')
      if (nowRow === undefined) probs.push('找不到对照组（现在档 running）')
      else if (!(nowRow.textContent ?? '').includes('执行中')) probs.push(`对照组没写「执行中」：${JSON.stringify(nowRow.textContent)}`)
      if (probs.length === 0) ok('S-14c ✓ 判据C：无 ranMs 的历史记录写「未开跑」（⛔ 不含「执行中」）；真在跑的仍是「执行中」')
      else for (const x of probs) bad(`S-14c · ${x}`)
      actFn(() => r.unmount())
    }

    // —— S-14d 判据D：历史档**默认折叠**，标题写条数 + 「默认折叠」——
    {
      const r = mount(react.createElement(ui.StagesPanel, {
        fetchProgress: async () => ({ ok: true, rows: [], readAt: '2026-10-30T00:00:00.000Z', source: 'volumes/tasks/INDEX.md' }),
        fetchStages: async () => EXEC_STAGES_DOING,
        fetchExec: async () => EXEC_BOTH,
        pollMs: 0,
      }))
      await tick(30)
      const det = document.querySelector('[data-dsh-hob="stages-exec-bucket"][data-bucket="history"]')
      const probs = []
      if (det === null) probs.push('历史档容器不存在')
      else {
        if (det.tagName.toLowerCase() !== 'details') probs.push(`历史档不是 <details>（实际 ${det.tagName}）⇒ 无法默认折叠`)
        if (det.hasAttribute('open')) probs.push('历史档**默认是展开的**（details 带了 open）')
        const title = det.querySelector('[data-dsh-hob="stages-exec-bucket-title"]')
        const tt = title?.textContent ?? ''
        if (!/历史\s*2\s*条/.test(tt)) probs.push(`历史档标题条数不对（期望「历史 2 条」）：${JSON.stringify(tt)}`)
        if (!tt.includes('默认折叠')) probs.push(`历史档标题没写「默认折叠」：${JSON.stringify(tt)}`)
        // ⚠ 折叠 ≠ 过滤：两条历史记录**必须都在 DOM 里**
        const histRows = det.querySelectorAll('[data-dsh-hob="stages-exec-item"]')
        if (histRows.length !== 2) probs.push(`历史档里 DOM 记录 ${histRows.length} 条（期望 2 —— 折叠不许过滤）`)
      }
      if (probs.length === 0) ok('S-14d ✓ 判据D 历史档默认折叠：<details> 无 open · 标题「历史 2 条（默认折叠）」· 2 条记录全在 DOM（折叠≠过滤）')
      else for (const x of probs) bad(`S-14d · ${x}`)
      actFn(() => r.unmount())
    }

    // —— S-14e 负向对拍（判据A）：把档位判断摘掉 ⇒ S-14a 必红 ——
    {
      const mutant = buildMutant('exec-nobucket', (t) => t.replace(
        "        'data-bucket': String(it?.bucket ?? ''),",
        "        'data-bucket': 'now',",
      ))
      if (mutant === undefined) {
        bad('S-14e · 造不出「档位固定为 now」的变体（源码形态变了）⇒ 负向对拍不可判')
      } else {
        const modB = await import(pathToFileURL(mutant).href)
        const r = mount(react.createElement(modB.StagesPanel, {
          fetchProgress: async () => ({ ok: true, rows: [], readAt: '2026-10-30T00:00:00.000Z', source: 'volumes/tasks/INDEX.md' }),
          fetchStages: async () => EXEC_STAGES_DOING,
            fetchExec: async () => EXEC_BOTH,
          pollMs: 0,
        }))
        await tick(30)
        const nowItems2 = execItems().filter((x) => x.getAttribute('data-bucket') === 'now')
        // 变体下所有行都自称 now ⇒ 「现在」档行数 ≠ 1 且历史档 0 行
        if (nowItems2.length !== 1) {
          ok(`S-14e ✓ 负向对拍（档位恒为 now）⇒ S-14a 的"现在档 1 行"**必红**：实际 ${nowItems2.length} 行`)
        } else {
          bad('S-14e · 档位恒为 now 后 S-14a 仍通过 ⇒ 那条断言没有牙')
        }
        actFn(() => r.unmount())
      }
    }

    // —— S-14f 负向对拍（判据B）：把合并后缀摘掉 ⇒ S-14b 必红 ——
    {
      const mutant = buildMutant('exec-nocount', (t) => t.replace(
        "      ...(Number(it?.count) > 1",
        "      ...(false",
      ))
      if (mutant === undefined) {
        bad('S-14f · 造不出「摘掉共 N 条」的变体（源码形态变了）⇒ 负向对拍不可判')
      } else {
        const modC = await import(pathToFileURL(mutant).href)
        const r = mount(react.createElement(modC.StagesPanel, {
          fetchProgress: async () => ({ ok: true, rows: [], readAt: '2026-10-30T00:00:00.000Z', source: 'volumes/tasks/INDEX.md' }),
          fetchStages: async () => EXEC_STAGES_DOING,
            fetchExec: async () => EXEC_BOTH,
          pollMs: 0,
        }))
        await tick(30)
        const row = execItems().find((x) => x.getAttribute('data-target') === 'histbbbb')
        if (row === undefined || row.querySelector('[data-dsh-hob="stages-exec-count"]') === null) {
          ok('S-14f ✓ 负向对拍（摘掉「共 N 条」）⇒ S-14b 的该标记断言**必红**')
        } else {
          bad('S-14f · 摘掉「共 N 条」后 S-14b 仍通过 ⇒ 那条断言没有牙')
        }
        actFn(() => r.unmount())
      }
    }

    // —— S-14g 负向对拍（判据D）：把历史档改成默认展开 ⇒ S-14d 必红 ——
    {
      const mutant = buildMutant('exec-open', (t) => t.replace(
        "{ style: { display: 'flex', flexDirection: 'column', gap: '3px' }, 'data-dsh-hob': 'stages-exec-bucket', 'data-bucket': 'history' }",
        "{ open: true, style: { display: 'flex', flexDirection: 'column', gap: '3px' }, 'data-dsh-hob': 'stages-exec-bucket', 'data-bucket': 'history' }",
      ))
      if (mutant === undefined) {
        bad('S-14g · 造不出「历史档默认展开」的变体（源码形态变了）⇒ 负向对拍不可判')
      } else {
        const modD = await import(pathToFileURL(mutant).href)
        const r = mount(react.createElement(modD.StagesPanel, {
          fetchProgress: async () => ({ ok: true, rows: [], readAt: '2026-10-30T00:00:00.000Z', source: 'volumes/tasks/INDEX.md' }),
          fetchStages: async () => EXEC_STAGES_DOING,
            fetchExec: async () => EXEC_BOTH,
          pollMs: 0,
        }))
        await tick(30)
        const det2 = document.querySelector('[data-dsh-hob="stages-exec-bucket"][data-bucket="history"]')
        if (det2 !== null && det2.hasAttribute('open')) {
          ok('S-14g ✓ 负向对拍（历史档加 open）⇒ S-14d 的"默认折叠"断言**必红**')
        } else {
          bad('S-14g · 加了 open 之后 S-14d 仍通过 ⇒ 那条断言没有牙')
        }
        actFn(() => r.unmount())
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // S-15 历史档一律不写「执行中」+ 消歧句（2026-10-30 第 21 轮）
    // ══════════════════════════════════════════════════════════════════

    /** 历史档三条：有 elapsedMs 的 running（应「曾运行」）/ 无的（「未开跑」）/ stuck（「卡住」）。 */
    const EXEC_HIST = {
      ok: true,
      readAt: '2026-10-30T00:00:00.000Z',
      source: 'runtime/orch-watches.json',
      items: [
        { target: 'histranx0', state: 'running', bucket: 'history', count: 1, unrunCount: 0, elapsedMs: 7200000, rechecks: 1 },
        { target: 'histnorun', state: 'running', bucket: 'history', count: 1, unrunCount: 1, rechecks: 0 },
        // ⚠ **3 条里只有 2 条未开跑**（第 3 条曾运行）—— 这样"用总数"的变异才会印出 3，负向对拍才有牙
        { target: 'histstuk0', state: 'stuck', bucket: 'history', count: 3, unrunCount: 2, rechecks: 3 },
      ],
    }

    // —— S-15a 判据E：历史档出现 running 时，⛔ 整个区域不许有「执行中」；须见「曾运行」与「未开跑」——
    {
      const r = mount(react.createElement(ui.StagesPanel, {
        fetchProgress: async () => ({ ok: true, rows: [], readAt: '2026-10-30T00:00:00.000Z', source: 'volumes/tasks/INDEX.md' }),
        fetchStages: async () => EXEC_STAGES_DOING,
        fetchExec: async () => EXEC_HIST,
        pollMs: 0,
      }))
      await tick(30)
      const probs = []
      const rows = execItems()
      const byTarget = new Map(rows.map((x) => [x.getAttribute('data-target'), x]))
      const ran = byTarget.get('histranx0')?.textContent ?? ''
      const never = byTarget.get('histnorun')?.textContent ?? ''
      if (!ran.includes('曾运行')) probs.push(`带 elapsedMs 的历史 running 没写「曾运行」：${JSON.stringify(ran)}`)
      if (!never.includes('未开跑')) probs.push(`无 elapsedMs 的历史 running 没写「未开跑」：${JSON.stringify(never)}`)
      /**
       * ⚠⚠ 本轮靶心：**历史档一律不许出现「执行中」**（那 13 条带 elapsedMs 的漏网记录）。
       *   只量「历史」档容器，⛔ 不量整面板（现在档的 running 合法地写「执行中」）。
       */
      const histBucket = document.querySelector('[data-dsh-hob="stages-exec-bucket"][data-bucket="history"]')
      const histText = histBucket?.textContent ?? ''
      if (histText.includes('执行中')) probs.push(`历史档里出现了「执行中」：${JSON.stringify(histText.slice(0, 160))}`)
      if (probs.length === 0) ok('S-15a ✓ 判据E 历史档：带 elapsedMs ⇒ 「曾运行」· 无 ⇒ 「未开跑」· **整档零「执行中」**')
      else for (const x of probs) bad(`S-15a · ${x}`)
      actFn(() => r.unmount())
    }

    // —— S-15b 判据F：消歧句 N = 未开跑条数（2），⛔ 不是总条数 ——
    {
      const r = mount(react.createElement(ui.StagesPanel, {
        fetchProgress: async () => ({ ok: true, rows: [], readAt: '2026-10-30T00:00:00.000Z', source: 'volumes/tasks/INDEX.md' }),
        fetchStages: async () => EXEC_STAGES_DOING,
        fetchExec: async () => EXEC_HIST,
        pollMs: 0,
      }))
      await tick(30)
      const row = execItems().find((x) => x.getAttribute('data-target') === 'histstuk0')
      const probs = []
      if (row === undefined) probs.push('找不到 stuck 那条合并行')
      else {
        const note = row.querySelector('[data-dsh-hob="stages-exec-unrun-note"]')
        const t = note?.textContent ?? ''
        if (!/这\s*2\s*条都没进过运行态/.test(t)) probs.push(`消歧句不对（期望「这 2 条都没进过运行态」）：${JSON.stringify(t)}`)
        if (/这\s*3\s*条/.test(t)) probs.push(`消歧句写成了总条数：${JSON.stringify(t)}`)
      }
      // ⚠ 对照：单条记录不拼消歧句
      const single = execItems().find((x) => x.getAttribute('data-target') === 'histranx0')
      const st = single?.querySelector('[data-dsh-hob="stages-exec-unrun-note"]')?.textContent ?? ''
      if (st !== '') probs.push(`单条记录也拼了消歧句：${JSON.stringify(st)}`)
      if (probs.length === 0) ok('S-15b ✓ 判据F 消歧句「这 2 条都没进过运行态」（⛔ 不是 3）· 单条不拼')
      else for (const x of probs) bad(`S-15b · ${x}`)
      actFn(() => r.unmount())
    }

    // —— S-15c 负向对拍（判据E）：历史档 running 一律「执行中」⇒ S-15a 必红 ——
    {
      const mutant = buildMutant('exec-oldlabel', (t) => t.replace(
        "  if (item?.bucket === 'now') return EXEC_STATE_LABELS.running",
        "  if (item?.bucket === 'now' || true) return EXEC_STATE_LABELS.running",
      ))
      if (mutant === undefined) {
        bad('S-15c · 造不出「历史档也写执行中」的变体（源码形态变了）⇒ 负向对拍不可判')
      } else {
        const modE = await import(pathToFileURL(mutant).href)
        const r = mount(react.createElement(modE.StagesPanel, {
          fetchProgress: async () => ({ ok: true, rows: [], readAt: '2026-10-30T00:00:00.000Z', source: 'volumes/tasks/INDEX.md' }),
          fetchStages: async () => EXEC_STAGES_DOING,
            fetchExec: async () => EXEC_HIST,
          pollMs: 0,
        }))
        await tick(30)
        const histBucket = document.querySelector('[data-dsh-hob="stages-exec-bucket"][data-bucket="history"]')
        if ((histBucket?.textContent ?? '').includes('执行中')) {
          ok('S-15c ✓ 负向对拍（改回旧口径）⇒ S-15a 的"历史档零执行中"断言**必红**')
        } else {
          bad('S-15c · 改回旧口径后历史档仍无「执行中」⇒ 那条断言没有牙')
        }
        actFn(() => r.unmount())
      }
    }

    // —— S-15d 负向对拍（判据F）：消歧句用总条数 ⇒ S-15b 必红 ——
    {
      const mutant = buildMutant('exec-note', (t) => t.replace(
        'execMergeNote({ count: Number(it?.count ?? 0), unrunCount: Number(it?.unrunCount ?? 0) })',
        'execMergeNote({ count: Number(it?.count ?? 0), unrunCount: Number(it?.count ?? 0) })',
      ))
      if (mutant === undefined) {
        bad('S-15d · 造不出「消歧句用总条数」的变体（源码形态变了）⇒ 负向对拍不可判')
      } else {
        const modF = await import(pathToFileURL(mutant).href)
        const r = mount(react.createElement(modF.StagesPanel, {
          fetchProgress: async () => ({ ok: true, rows: [], readAt: '2026-10-30T00:00:00.000Z', source: 'volumes/tasks/INDEX.md' }),
          fetchStages: async () => EXEC_STAGES_DOING,
            fetchExec: async () => EXEC_HIST,
          pollMs: 0,
        }))
        await tick(30)
        const row = execItems().find((x) => x.getAttribute('data-target') === 'histstuk0')
        const t = row?.querySelector('[data-dsh-hob="stages-exec-unrun-note"]')?.textContent ?? ''
        if (/这\s*3\s*条/.test(t)) {
          ok(`S-15d ✓ 负向对拍（用总条数）⇒ S-15b 的"N=2"断言**必红**：实际 ${JSON.stringify(t)}`)
        } else {
          bad(`S-15d · 用总条数后没印出 3：${JSON.stringify(t)}`)
        }
        actFn(() => r.unmount())
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // S-16 自动刷新：假定时器推进 3 个周期 ⇒ 首次 + 3 次轮询 = 4 次，
    //      且间隔恒为 STAGES_POLL_MS = 5000（2026-10-30 第 22 轮 · 任务书 §二）
    //   ⚠⚠ **这仍是"夹具里的定时器"，⛔ 不等于"真浏览器里会转"** —— 见本组注释末的边界声明。
    // ══════════════════════════════════════════════════════════════════
    {
      /**
       * 假定时器：只替换 `setInterval` / `clearInterval`。
       * ⚠ **不替换 `setTimeout`** —— `tick()` 用它推 microtask，替换了会把推进本身也冻住。
       */
      const fake = { now: 0, timers: [], seq: 1 }
      const realSI = globalThis.setInterval
      const realCI = globalThis.clearInterval
      const registered = []
      globalThis.setInterval = (fn, ms) => {
        const id = fake.seq++
        fake.timers.push({ id, fn, ms, next: fake.now + ms })
        registered.push(ms)
        return id
      }
      globalThis.clearInterval = (id) => { fake.timers = fake.timers.filter((t) => t.id !== id) }

      /** 推进 `delta` 毫秒：逐个触发到期回调，并让 React 落状态。 */
      const advanceBy = async (delta) => {
        const target = fake.now + delta
        for (;;) {
          const due = fake.timers.filter((t) => t.next <= target).sort((a, b) => a.next - b.next)[0]
          if (due === undefined) break
          fake.now = due.next
          due.next += due.ms
          actFn(() => { due.fn() })
          await tick(0)
        }
        fake.now = target
      }

      let calls = 0
      const probs = []

      // ── ① 常量必须是 5000 ──
      if (ui.STAGES_POLL_MS !== 5000) probs.push(`STAGES_POLL_MS 不是 5000：${JSON.stringify(ui.STAGES_POLL_MS)}`)

      // ── ② 不传 pollMs ⇒ 用常量；推进 3 个周期 ──
      const r = mount(react.createElement(ui.StagesPanel, {
        fetchProgress: async () => { calls += 1; return { ok: true, rows: [], readAt: '2026-10-30T00:00:00.000Z', source: 'volumes/tasks/INDEX.md' } },
        fetchStages: async () => EXEC_STAGES_DOING,
        fetchExec: async () => ({ ok: true, readAt: '2026-10-30T00:00:00.000Z', source: 'runtime/orch-watches.json', items: [] }),
        // ⚠ **刻意不传 `pollMs`** —— 要验的就是"缺省走常量"那条路径
      }))
      await tick(20)
      const afterMount = calls
      await advanceBy(15000)   // 3 个 5000ms 周期
      const afterThree = calls

      if (afterMount !== 1) probs.push(`挂载时取数 ${afterMount} 次（期望 1 —— 首次）`)
      if (afterThree !== 4) probs.push(`推进 3 个周期后共 ${afterThree} 次（期望 4 = 首次 + 3 次轮询）`)
      const badMs = registered.filter((ms) => ms !== 5000)
      if (registered.length === 0) probs.push('一个 setInterval 都没注册 ⇒ 轮询根本没起来')
      if (badMs.length > 0) probs.push(`注册的间隔里有非 5000 的：${JSON.stringify(badMs)}`)

      actFn(() => r.unmount())
      globalThis.setInterval = realSI
      globalThis.clearInterval = realCI

      if (probs.length === 0) {
        ok(`S-16a ✓ 自动刷新：STAGES_POLL_MS=5000 · 首次 1 次 + 假定时器推进 3 个周期 ⇒ 共 ${afterThree} 次 · 注册间隔全为 5000ms`)
      } else for (const x of probs) bad(`S-16a · ${x}`)
    }

    // —— S-16b 负向对拍：把 STAGES_POLL_MS 改成 0 ⇒ S-16a 必红 ——
    {
      const mutant = buildMutant('exec-pollzero', (t) => t.replace(
        'export const STAGES_POLL_MS = 5000',
        'export const STAGES_POLL_MS = 0',
      ))
      if (mutant === undefined) {
        bad('S-16b · 造不出「STAGES_POLL_MS = 0」的变体（源码形态变了）⇒ 负向对拍不可判')
      } else {
        const modP = await import(pathToFileURL(mutant).href)
        const fake2 = { now: 0, timers: [], seq: 1 }
        const realSI2 = globalThis.setInterval
        const realCI2 = globalThis.clearInterval
        let registered2 = 0
        globalThis.setInterval = (fn, ms) => {
          const id = fake2.seq++
          fake2.timers.push({ id, fn, ms, next: fake2.now + ms })
          registered2 += 1
          return id
        }
        globalThis.clearInterval = (id) => { fake2.timers = fake2.timers.filter((t) => t.id !== id) }
        const advance2 = async (delta) => {
          const target = fake2.now + delta
          for (;;) {
            const due = fake2.timers.filter((t) => t.next <= target).sort((a, b) => a.next - b.next)[0]
            if (due === undefined) break
            fake2.now = due.next
            due.next += due.ms
            actFn(() => { due.fn() })
            await tick(0)
          }
          fake2.now = target
        }
        let calls2 = 0
        const r = mount(react.createElement(modP.StagesPanel, {
          fetchProgress: async () => { calls2 += 1; return { ok: true, rows: [], readAt: '2026-10-30T00:00:00.000Z', source: 'volumes/tasks/INDEX.md' } },
          fetchStages: async () => EXEC_STAGES_DOING,
            fetchExec: async () => ({ ok: true, readAt: '2026-10-30T00:00:00.000Z', source: 'runtime/orch-watches.json', items: [] }),
        }))
        await tick(20)
        await advance2(15000)
        actFn(() => r.unmount())
        globalThis.setInterval = realSI2
        globalThis.clearInterval = realCI2
        const red = modP.STAGES_POLL_MS !== 5000 || calls2 === 1 || registered2 === 0
        if (red) {
          ok(`S-16b ✓ 负向对拍（STAGES_POLL_MS=0）⇒ S-16a 必红：常量=${modP.STAGES_POLL_MS} · 推进 3 周期后仍只有 ${calls2} 次 · 注册的 interval ${registered2} 个`)
        } else {
          bad(`S-16b · 把常量改成 0 后仍满足 S-16a（calls=${calls2} · intervals=${registered2}）⇒ 那条断言没有牙`)
        }
      }
    }

    // ⚠ **S-16 的边界（照实写，⛔ 不许省略）**：以上全部是 **jsdom + 假定时器** 里的读数。
    //   ✅ 它证明：缺省路径走的是 `STAGES_POLL_MS`、其值为 5000、按 5000ms 注册了 interval、
    //      每周期真的会再调一次取数、常量变 0 时确实不再注册。
    //   ⛔ 它**不证明**：真浏览器里页面可见时定时器真的会走、真 `document.visibilityState`
    //      真的会变、真 `fetch` 真的能拿到新数据。那三件只有用户真机看得到。

    // ══════════════════════════════════════════════════════════════════
    // S-17 五步树（2026-10-30 · P3 · 用户原话「这几个是有状态，然后可以展开每一个阶段小节状态」）
    // ══════════════════════════════════════════════════════════════════

    /** 一份真形状的五步响应（第 ④ 步 = doing ⇒ 应**默认展开**）。 */
    const STAGES_OK = {
      ok: true,
      readAt: '2026-10-30T00:00:00.000Z',
      stages: [
        { step: 1, name: '需求规格', state: 'done', done: 2, total: 2, items: [
          { id: 'R-001', title: '五步主线各步有状态', status: 'agreed', extra: '' },
          { id: 'R-002', title: '执行态分两档', status: 'agreed', extra: '' },
        ] },
        { step: 2, name: '实现方案', state: 'done', done: 1, total: 1, items: [{ id: 'CHG-X', title: '重构', status: 'settled', extra: '' }] },
        { step: 3, name: '编码任务', state: 'done', done: 1, total: 1, items: [{ id: 'TSK-1', title: '任务', status: 'built', extra: '' }] },
        { step: 4, name: '任务执行', state: 'doing', done: 0, total: 1, items: [{ id: 'RUN-001', title: '在跑', status: 'running', extra: '2026-10-30T08:37:31+08:00' }] },
        { step: 5, name: '验收核对', state: 'todo', done: 0, total: 2, items: [
          { id: 'ACC-001', title: '验收一', status: 'unverified', extra: 'session-89db' },
          { id: 'ACC-002', title: '验收二', status: 'unverified', extra: 'session-89db' },
        ] },
      ],
      caps: [{ id: 'CAP-01', title: '叫醒面', status: 'live', lastReading: '2026-10-30 07:29 · 有在途记录' }],
    }
    const mountTree = async (over) => {
      const r = mount(react.createElement(ui.StagesPanel, {
        fetchProgress: async () => ({ ok: true, rows: [] }),
        fetchExec: async () => ({ ok: true, items: [] }),
        fetchStages: async () => STAGES_OK,
        pollMs: 0,
        ...(over ?? {}),
      }))
      await tick(40)
      return r
    }

    // —— S-17a 五步行头齐全（序号 / 步名 / 三态图标 / 完成数/总数）——
    {
      const r = await mountTree()
      const heads = [...document.querySelectorAll('[data-dsh-hob="stages-tree-head"]')]
      const probs = []
      if (heads.length !== 5) probs.push(`步行头 ${heads.length} 个（期望 5）`)
      else {
        const names = ['需求规格', '实现方案', '编码任务', '任务执行', '验收核对']
        heads.forEach((h, i) => {
          const t = h.textContent ?? ''
          if (!t.includes(names[i])) probs.push(`第 ${i + 1} 行没有步名「${names[i]}」：${JSON.stringify(t)}`)
          if (!/^(✓|▶|○)/.test((h.querySelector('[data-dsh-hob="stages-tree-icon"]')?.textContent ?? '').trim())) {
            probs.push(`第 ${i + 1} 行没有三态图标：${JSON.stringify(h.querySelector('[data-dsh-hob="stages-tree-icon"]')?.textContent)}`)
          }
          const cnt = h.querySelector('[data-dsh-hob="stages-tree-count"]')?.textContent ?? ''
          if (!/^\d+\/\d+$/.test(cnt.trim())) probs.push(`第 ${i + 1} 行「完成数/总数」不是 N/M：${JSON.stringify(cnt)}`)
        })
      }
      if (probs.length === 0) ok('S-17a ✓ 五步行头齐全：序号 + 步名 + 三态图标（✓/▶/○）+ 完成数/总数（N/M，⛔ 非百分比）')
      else for (const x of probs) bad(`S-17a · ${x}`)
      actFn(() => r.unmount())
    }

    // —— S-17b 默认展开第一个 doing 步（第 ④），其余折叠；点行可开合 ——
    {
      const r = await mountTree()
      const probs = []
      const heads = [...document.querySelectorAll('[data-dsh-hob="stages-tree-head"]')]
      const expandedIdx = heads.map((h, i) => (h.getAttribute('aria-expanded') === 'true' ? i + 1 : null)).filter(Boolean)
      if (JSON.stringify(expandedIdx) !== JSON.stringify([4])) probs.push(`默认展开的步不是恰好第 4 步：${JSON.stringify(expandedIdx)}`)
      const body4 = document.querySelector('[data-dsh-hob="stages-tree-step"][data-step="4"] [data-dsh-hob="stages-tree-body"]')
      if (body4 === null) probs.push('第 4 步没有展开体')
      else if (!(body4.textContent ?? '').includes('RUN-001')) probs.push(`第 4 步展开体里没有 RUN-001：${JSON.stringify(body4.textContent)}`)
      // 点第 1 步 ⇒ 展开；再点 ⇒ 收起
      actFn(() => { heads[0].dispatchEvent(new (heads[0].ownerDocument.defaultView ?? window).MouseEvent('click', { bubbles: true })) })
      await tick(20)
      const h1a = document.querySelector('[data-dsh-hob="stages-tree-step"][data-step="1"] [data-dsh-hob="stages-tree-head"]')
      if (h1a?.getAttribute('aria-expanded') !== 'true') probs.push('点第 1 步行头后没有展开')
      const b1 = document.querySelector('[data-dsh-hob="stages-tree-step"][data-step="1"] [data-dsh-hob="stages-tree-body"]')
      if (b1 === null || !(b1.textContent ?? '').includes('R-001')) probs.push('第 1 步展开体里没有 R-001')
      actFn(() => { h1a.dispatchEvent(new (h1a.ownerDocument.defaultView ?? window).MouseEvent('click', { bubbles: true })) })
      await tick(20)
      const h1b = document.querySelector('[data-dsh-hob="stages-tree-step"][data-step="1"] [data-dsh-hob="stages-tree-head"]')
      if (h1b?.getAttribute('aria-expanded') !== 'false') probs.push('再点一次后没有收起（⛔ 只开不合）')
      if (probs.length === 0) ok('S-17b ✓ 默认展开第一个 doing 步（第 ④）· 其余折叠 · 点行可开合（aria-expanded 真变）')
      else for (const x of probs) bad(`S-17b · ${x}`)
      actFn(() => r.unmount())
    }

    // —— S-17c cap 单列：不在五步里、区域内零 `%`、零百分比字样 ——
    {
      const r = await mountTree()
      const probs = []
      const capsEl = document.querySelector('[data-dsh-hob="stages-caps"]')
      if (capsEl === null) probs.push('找不到「长期能力」区（stages-caps）')
      else {
        const ct = capsEl.textContent ?? ''
        if (!ct.includes('长期能力')) probs.push(`「长期能力」区没有标题：${JSON.stringify(ct)}`)
        if (!ct.includes('CAP-01')) probs.push(`cap 条目没渲染：${JSON.stringify(ct)}`)
        if (/%/.test(ct)) probs.push(`「长期能力」区出现了 \`%\`：${JSON.stringify(ct)}`)
        if (/完成度|已完成|进度/.test(ct)) probs.push(`「长期能力」区出现完成度字样：${JSON.stringify(ct)}`)
      }
      // ⚠ cap **不进五步分母**：五步行头里不许出现 cap 的 id
      const headsText = [...document.querySelectorAll('[data-dsh-hob="stages-tree-head"]')].map((x) => x.textContent ?? '').join(' ')
      if (headsText.includes('CAP-01')) probs.push('cap 的 id 出现在了五步行头里（⛔ 不进分母）')
      if (probs.length === 0) ok('S-17c ✓ cap 单列：「长期能力（无完成态）」区有 CAP-01 · 区域内零 `%` 零完成度 · ⛔ 不进五步分母')
      else for (const x of probs) bad(`S-17c · ${x}`)
      actFn(() => r.unmount())
    }

    // —— S-17d 第 ④ 步展开体里复用现有执行项两档（⛔ 不推翻）——
    {
      const r = await mountTree({
        fetchExec: async () => ({
          ok: true,
          items: [
            { target: 'nowaaaaa', state: 'running', bucket: 'now', count: 1, unrunCount: 0, elapsedMs: 60000, rechecks: 0 },
            { target: 'histbbbb', state: 'running', bucket: 'history', count: 1, unrunCount: 1, rechecks: 2 },
          ],
        }),
      })
      const probs = []
      const body4 = document.querySelector('[data-dsh-hob="stages-tree-step"][data-step="4"] [data-dsh-hob="stages-tree-body"]')
      if (body4 === null) probs.push('第 4 步没有展开体')
      else {
        const nowBuckets = body4.querySelectorAll('[data-dsh-hob="stages-exec-bucket"][data-bucket="now"]')
        const histBuckets = body4.querySelectorAll('[data-dsh-hob="stages-exec-bucket"][data-bucket="history"]')
        if (nowBuckets.length !== 1) probs.push(`第 ④ 步里「现在」档 ${nowBuckets.length} 个（期望 1）`)
        if (histBuckets.length !== 1) probs.push(`第 ④ 步里「历史」档 ${histBuckets.length} 个（期望 1）`)
        const bt = body4.textContent ?? ''
        if (!bt.includes('未开跑')) probs.push(`历史档那条没写「未开跑」：${JSON.stringify(bt.slice(0, 160))}`)
        // ⚠ 折叠≠过滤：历史条目的 DOM 必须在
        if (body4.querySelectorAll('[data-dsh-hob="stages-exec-item"]').length !== 2) {
          probs.push(`执行项 ${body4.querySelectorAll('[data-dsh-hob="stages-exec-item"]').length} 条（期望 2 —— 折叠不许过滤）`)
        }
      }
      if (probs.length === 0) ok('S-17d ✓ 第 ④ 步展开体复用现有两档（现在/历史各一 · 「未开跑」文案在 · 2 条 DOM 都在，⛔ 没把历史摊进现在）')
      else for (const x of probs) bad(`S-17d · ${x}`)
      actFn(() => r.unmount())
    }

    // —— S-17f 树内条目状态**按 kind** 取中文（2026-10-30 P21 · `TASK-P21.md` §一）——
    /**
     * ⚠⚠ **这条断言的测量面变过（P21），逐条说明为什么不是放宽**：
     *   · 改前（P13 版）：只喂**第 4 步**（`run`）两条 —— 一条九态 `running`、一条乱码；
     *     期望 `running ⇒ 执行中`、乱码 ⇒ `判不出`。
     *   · 改后（P21 版）：**必须同时喂 5 个 kind** —— 因为 P13 的病正是
     *     "`agreed`/`settled`/`built`/`unverified` 被当成九态查 ⇒ 全印判不出"，
     *     只测 `run` 的话**这条断言对那个病完全瞎**（它就是当时漏测的原因）。
     *   ⇒ 断言**变严**：5 个 kind 的合法状态各一条、逐个点名比中文；
     *     另加一条乱码（`zzz-nonsense`）验证**兜底仍在**（⛔ 没被删掉）。
     */
    {
      const r = await mountTree({
        fetchStages: async () => ({
          ok: true, readAt: '2026-10-30T00:00:00.000Z',
          stages: [
            { step: 1, name: '需求规格', state: 'done', done: 1, total: 1, items: [{ id: 'R-001', title: '需求', status: 'agreed', extra: '' }] },
            { step: 2, name: '实现方案', state: 'done', done: 1, total: 1, items: [{ id: 'CHG-X', title: '方案', status: 'settled', extra: '' }] },
            { step: 3, name: '编码任务', state: 'done', done: 1, total: 1, items: [{ id: 'TSK-X', title: '任务', status: 'built', extra: '' }] },
            {
              step: 4, name: '任务执行', state: 'doing', done: 0, total: 2,
              items: [
                { id: 'RUN-001', title: '第 27 轮', status: 'running', extra: '' },
                { id: 'RUN-9XX', title: '怪值', status: 'zzz-nonsense', extra: '' },
              ],
            },
            { step: 5, name: '验收核对', state: 'todo', done: 0, total: 1, items: [{ id: 'ACC-001', title: '验收', status: 'unverified', extra: '' }] },
          ],
          caps: [],
        }),
      })
      /**
       * ⚠ 面板**只自动展开第一条 `doing` 的步**（见 `stages-panel.tsx` 的 effect）。
       *   ⇒ 要量全部 5 个 kind，必须先把每一步都点开（⚠ 真点按钮，⛔ 不 hack 内部 state）。
       */
      for (const head of [...document.querySelectorAll('[data-dsh-hob="stages-tree-head"]')]) {
        if (head.getAttribute('aria-expanded') !== 'true') actFn(() => head.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
      }
      await tick(30)
      const probs = []
      const spans = [...document.querySelectorAll('[data-dsh-hob="stages-tree-item-status"]')]
      const got = spans.map((e) => (e.textContent ?? '').trim())
      // ⚠ 6 个 span：5 个 kind 各一条 + 第 4 步多一条乱码（RUN-9XX）
      if (spans.length !== 6) probs.push(`状态 span ${spans.length} 个（期望 6 = 5 kind + 1 乱码）`)
      /**
       * ⚠ **按 `data-item-id` 精确取**（⛔ 用下标 —— 展开顺序一变就错位，我第一版就这么错过：
       *   把 `acc` 那条读成了第 5 个，而第 5 个其实是 `RUN-9XX`）。
       */
      /**
       * ⚠ `data-item-id` 在**外层条目 div** 上（`stages-tree-item`），⛔ 不在状态 span 上
       *   —— 我第一版直接读 span 的 `data-item-id` ⇒ 全是空串 ⇒ 全报"(缺)"。
       */
      const byId = new Map([...document.querySelectorAll('[data-dsh-hob="stages-tree-item"]')].map((row) => [
        row.getAttribute('data-item-id') ?? '',
        (row.querySelector('[data-dsh-hob="stages-tree-item-status"]')?.textContent ?? '').trim(),
      ]))
      const WANT = [
        ['R-001', 'req.agreed', '已定稿'],
        ['CHG-X', 'change.settled', '已定案'],
        ['TSK-X', 'task.built', '已做完（等验收）'],
        ['RUN-001', 'run.running', '执行中'],
        ['ACC-001', 'acc.unverified', '还没验'],
      ]
      for (const [id, label, want] of WANT) {
        const v = byId.get(id)
        if (v !== want) probs.push(`${label} 应为 ${JSON.stringify(want)}，实际 ${JSON.stringify(v ?? '(缺)')}`)
        if (v !== undefined && /^[a-z-]+$/.test(v)) probs.push(`${label} 仍打英文原文 ${JSON.stringify(v)}`)
      }
      // ⚠ 兜底仍在：乱码那条必须是"判不出（原值 …）"（⛔ 没被删掉、也⛔ 没被美化）
      const badTxt = byId.get('RUN-9XX') ?? ''
      if (!/判不出/.test(badTxt)) probs.push(`封闭集外的值没写「判不出」：${JSON.stringify(badTxt)}`)
      if (!/zzz-nonsense/.test(badTxt)) probs.push(`兜底没带原值（⛔ 会让人查不到是哪条）：${JSON.stringify(badTxt)}`)
      if (probs.length === 0) {
        ok('S-17f ✓ 树内条目状态**按 kind** 取中文：req.agreed⇒已定稿 · change.settled⇒已定案 · '
          + 'task.built⇒已做完（等验收）· run.running⇒执行中 · acc.unverified⇒还没验；'
          + '封闭集外的值仍写「判不出（原值 zzz-nonsense）」（兜底在）')
      } else for (const x of probs) bad(`S-17f · ${x}`)
      actFn(() => r.unmount())
    }

    // —— S-17g 负向对拍：把映射改回原文直打 ⇒ S-17f 必红 ——
    {
      /**
       * ⚠ P21 改点：现在状态文本来自 `stageStatusLabel(kind, status).label`
       *   ⇒ 变异体把它换成**原文直打**（正是 P13 那个 bug 的形态），S-17f 必红。
       */
      const mutant = buildMutant('exec-raw-status', (t) => t.replace(
        "stageStatusLabel(kindOfStep(step), String(it?.status ?? '')).label,",
        "String(it?.status ?? ''),",
      ))
      if (mutant === undefined) {
        bad('S-17g · 造不出「状态直接打原文」的变体（源码形态变了）⇒ 负向对拍不可判')
      } else {
        const modRaw = await import(pathToFileURL(mutant).href)
        const r = mount(react.createElement(modRaw.StagesPanel, {
          fetchProgress: async () => ({ ok: true, rows: [] }),
          fetchExec: async () => ({ ok: true, items: [] }),
          fetchStages: async () => ({
            ok: true, readAt: '2026-10-30T00:00:00.000Z',
            stages: [{ step: 4, name: '任务执行', state: 'doing', done: 0, total: 1, items: [{ id: 'RUN-001', title: 'x', status: 'running', extra: '' }] }],
            caps: [],
          }),
          pollMs: 0,
        }))
        await tick(30)
        const t = document.querySelector('[data-dsh-hob="stages-tree-item-status"]')?.textContent ?? ''
        if (t === 'running') ok(`S-17g ✓ 负向对拍（把映射改回原文直打）⇒ S-17f **必红**：实际 ${JSON.stringify(t)}`)
        else bad(`S-17g · 变体仍没打出英文原文（实 ${JSON.stringify(t)}）⇒ 那条断言没有牙`)
        actFn(() => r.unmount())
      }
    }

    // —— S-17e 负向对拍：把某步的计数写成百分比 ⇒ S-17a 的 N/M 断言必红 ——
    {
      const mutant = buildMutant('exec-pct', (t) => t.replace(
        "React.createElement('span', { 'data-dsh-hob': 'stages-tree-count' }, `${Number(st?.done ?? 0)}/${Number(st?.total ?? 0)}`)",
        "React.createElement('span', { 'data-dsh-hob': 'stages-tree-count' }, `${Math.round((Number(st?.done ?? 0) / Math.max(1, Number(st?.total ?? 0))) * 100)}%`)",
      ))
      if (mutant === undefined) {
        bad('S-17e · 造不出「计数写成百分比」的变体（源码形态变了）⇒ 负向对拍不可判')
      } else {
        const modPct = await import(pathToFileURL(mutant).href)
        const r = mount(react.createElement(modPct.StagesPanel, {
          fetchProgress: async () => ({ ok: true, rows: [] }),
          fetchExec: async () => ({ ok: true, items: [] }),
          fetchStages: async () => STAGES_OK,
          pollMs: 0,
        }))
        await tick(40)
        const cnt = document.querySelector('[data-dsh-hob="stages-tree-count"]')?.textContent ?? ''
        if (/%/.test(cnt)) {
          ok(`S-17e ✓ 负向对拍（计数写成百分比）⇒ S-17a 的「N/M」断言**必红**：实际 ${JSON.stringify(cnt)}`)
        } else {
          bad(`S-17e · 改成百分比后没印出 %：${JSON.stringify(cnt)} ⇒ 那条断言没有牙`)
        }
        actFn(() => r.unmount())
      }
    }

    // ① 改一个步骤名 ⇒ 面板判据必须红    // ① 改一个步骤名 ⇒ 面板判据必须红    // ① 改一个步骤名 ⇒ 面板判据必须红    // ① 改一个步骤名 ⇒ 面板判据必须红    // ① 改一个步骤名 ⇒ 面板判据必须红
    const mutantA = buildMutant('steps', (s) => s.replace(`'${prodSteps[0]}'`, `'被改坏的步骤'`))
    if (mutantA === undefined) {
      bad('S-7 · 造不出「改步骤名」的变体（源码里找不到该字面量）⇒ 负向对拍不可判')
    } else {
      const modA = await import(pathToFileURL(mutantA).href)
      const pA = auditPanel(modA, prodSteps, prodUnwired)
      if (pA.length > 0) ok(`S-7a ✓ 负向对拍（改步骤名）⇒ S-6 判据**变红**：${pA[0]}`)
      else bad('S-7a · 改了步骤名，S-6 判据**仍然通过** ⇒ 那条判据是恒真的、没有牙')
    }

    // ② 把 guide 胶囊的 order 改掉 ⇒ S-11 必须变红（证明那条断言有牙）
    const mutantB = buildMutant('guide', (t) => t.replace('export const STAGES_GUIDE_ORDER = 50', 'export const STAGES_GUIDE_ORDER = 51'))
    if (mutantB === undefined) {
      bad('S-7b · 造不出「改 STAGES_GUIDE_ORDER」的变体 ⇒ 负向对拍不可判')
    } else {
      const modB = await import(pathToFileURL(mutantB).href)
      const seen2 = []
      modB.bindStagesTabType({
        logger: { warn: () => {} },
        inject: (_n, cb) => {
          cb({ get: (n) => (n === 'sidebarRightTabs' ? { register: (d) => { seen2.push(d); return () => {} } } : undefined) })
          return { dispose: () => {} }
        },
      })
      const g = seen2[0]?.guide?.[0]
      if (g?.order !== 50) {
        ok(`S-7b ✓ 负向对拍（guide order 50 ⇒ 51）⇒ S-11 的 \`order !== 50\` 必红：实际 ${JSON.stringify(g?.order)}`)
      } else {
        bad('S-7b · 改了 order，S-11 判据**仍然通过** ⇒ 没有牙')
      }
    }
  }
    // ══════════════════════════════════════════════════════════════════
    // S-18 ⭐ **用真账本数据渲染一遍，扫全文：页面上不许出现「判不出」**
    //      （2026-10-30 P21 · `TASK-P21.md` 判据 4）
    // ══════════════════════════════════════════════════════════════════
    /**
     * ── 为什么要"真账本"而不是夹具 ───────────────────────────────────
     *   用户截图那个 bug 只在**真数据**下出现（真索引里就是 `agreed`/`settled`/`built`/`unverified`）。
     *   夹具是我们自己编的，编的时候很容易"恰好避开"那个值 —— 那就成了自证。
     *   ⇒ 本组**真读** `<账本区>/ledger-next/units/index.toml`，走**真解析器**
     *     （`buildStages`，与产品路由同一个），再把结果喂给**真组件**。
     *
     * ── 口径 ────────────────────────────────────────────────────
     *   · 扫 `[data-dsh-hob="stages-panel"]` 的**全文**（`textContent`）；
     *   · ⛔ 不许出现「判不出」三个字（⚠ 一处都不许）；
     *   · ⚠ 另打印**每一条**条目的实际标签作为可复核读数。
     *   ── 负向对拍（S-18b）──────────────────────────────────────
     *   把真数据里**第一条 `req` 的 status 改成一个封闭集外的值**（`zzz-ghost`）
     *   ⇒ 「判不出」**必须重新出现**（证明这条断言有牙、且兜底没被删）。
     */
    {
      const { resolveLedgerRoot } = await import('./lib/ledger-root.mjs')
      const ledgerRoot = resolveLedgerRoot(root, undefined, undefined)
      if (ledgerRoot === undefined) {
        bad('S-18 · 账本根判不出 ⇒ 无法用真账本数据渲染（⛔ 不按通过处理）')
      } else {
        const idx = await import(pathToFileURL(join(root, 'src', 'shared', 'stages-index.ts')).href)
        const idxPath = join(ledgerRoot, idx.STAGES_INDEX_REL)
        const units = idx.parseUnitsToml(readFileSync(idxPath, 'utf8'))
        const built = idx.buildStages(units, '2026-10-30T00:00:00.000Z')
        const r = mount(react.createElement(ui.StagesPanel, {
          fetchProgress: async () => ({ ok: true, rows: [] }),
          fetchExec: async () => ({ ok: true, items: [] }),
          fetchStages: async () => built,
          pollMs: 0,
        }))
        await tick(40)
        for (const head of [...document.querySelectorAll('[data-dsh-hob="stages-tree-head"]')]) {
          if (head.getAttribute('aria-expanded') !== 'true') actFn(() => head.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
        }
        await tick(30)
        const panel = document.querySelector('[data-dsh-hob="stages-panel"]')
        const text = (panel?.textContent ?? '')
        const probs = []
        if (panel === null) probs.push('面板没渲染出来 ⇒ 本条失去测量面')
        /**
         * ⚠⚠ **口径修正（第一次跑就咬出我自己一个错）**：
         *   "扫全文不出现判不出"**不能直接照字面判** —— 真账本里有一条**需求标题**是
         *   `R-003「执行中」只给真的在跑的；判不出写「未开跑」`，它**正文里就有"判不出"三个字**
         *   （那是需求文本，⛔ 不是状态标签）。
         *   ⇒ 本组拆成**两条**，都保留：
         *     ① **状态面**（`stages-tree-item-status` / `stages-cap-item`）⛔ 一个都不许有
         *        —— 这才是用户截图那个 bug 的落点；
         *     ② **全文**里的每一处「判不出」都必须**落在条目标题节点内**（数据文本），
         *        落不到标题里的 ⇒ **红**（说明又跑到状态/读数里去了）。
         */
        const statusTexts = [...document.querySelectorAll('[data-dsh-hob="stages-tree-item-status"]')].map((e) => e.textContent ?? '')
        const capTexts = [...document.querySelectorAll('[data-dsh-hob="stages-cap-item"]')].map((e) => e.textContent ?? '')
        const statusHits = [...statusTexts, ...capTexts].filter((t) => t.includes('判不出'))
        if (statusHits.length > 0) probs.push(`**状态/读数面**出现「判不出」${statusHits.length} 处：${JSON.stringify(statusHits.slice(0, 3))}`)
        // ② 全文出现次数 == 标题里的出现次数（多出来的就是跑到别处去了）
        const titleTexts = [...document.querySelectorAll('[data-dsh-hob="stages-tree-item"]')]
          .map((row) => row.querySelectorAll('span')[1]?.textContent ?? '')
        const count = (arr) => arr.reduce((n, t) => n + (t.split('判不出').length - 1), 0)
        const inTitles = count(titleTexts)
        const inAll = text.split('判不出').length - 1
        if (inAll > inTitles) {
          probs.push(`全文出现「判不出」${inAll} 处，但条目标题里只有 ${inTitles} 处 ⇒ 有 ${inAll - inTitles} 处跑到了状态/读数等非标题位置`)
        }
        const rows = [...document.querySelectorAll('[data-dsh-hob="stages-tree-item"]')]
        const labels = rows.map((row) => `${row.getAttribute('data-item-id')}:` + (row.querySelector('[data-dsh-hob="stages-tree-item-status"]')?.textContent ?? '').trim())
        if (rows.length === 0) probs.push('一条条目都没渲染 ⇒ 扫全文这步没有对象（⛔ 不报 ✓）')
        if (probs.length === 0) {
          ok(`S-18 ✓ **真账本数据渲染（${rows.length} 条条目，${units.length} 条单元）**`
            + ` · **状态/读数面 0 处「判不出」**（⚠ 全文另有 ${inTitles} 处，全在条目标题里 = 数据文本，⛔ 不算）`
            + `\n      ⇒ 标签实测：${labels.join(' · ')}`)
        } else for (const x of probs) bad(`S-18 · ${x}`)

        /**
         * ⚠⚠ **必须先把上一个实例卸掉再挂下一个**（`mount` 每次都 `createRoot` 同一个容器；
         *   同一容器两次 `createRoot` 会告警，且卸载时抛 `NotFoundError`）。
         *   ⇒ 串行：量完 S-18 立刻 `r.unmount()`，再挂 S-18b 用的实例。
         */
        actFn(() => r.unmount())

        // ── S-18b 负向对拍：把一个 status 改成封闭集外的值 ⇒ 「判不出」必须回来 ──
        const tampered = units.map((u) => (u.id === 'R-001' ? { ...u, status: 'zzz-ghost' } : u))
        const built2 = idx.buildStages(tampered, '2026-10-30T00:00:00.000Z')
        const r2 = mount(react.createElement(ui.StagesPanel, {
          fetchProgress: async () => ({ ok: true, rows: [] }),
          fetchExec: async () => ({ ok: true, items: [] }),
          fetchStages: async () => built2,
          pollMs: 0,
        }))
        await tick(40)
        for (const head of [...document.querySelectorAll('[data-dsh-hob="stages-tree-head"]')]) {
          if (head.getAttribute('aria-expanded') !== 'true') actFn(() => head.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
        }
        await tick(30)
        const t2 = document.querySelector('[data-dsh-hob="stages-panel"]')?.textContent ?? ''
        if (t2.includes('判不出') && t2.includes('zzz-ghost')) {
          ok('S-18b ✓ 负向对拍（把 R-001 的 status 改成封闭集外的 `zzz-ghost`）⇒ 「判不出（原值 zzz-ghost）」**重新出现**'
            + ' ⇒ S-18 的"全文无判不出"有牙，且**兜底没被删**')
        } else {
          bad(`S-18b · 改成非法值后仍未出现「判不出（原值 zzz-ghost）」⇒ 兜底被弄丢了（或这条断言没牙）`)
        }
        /**
         * ⚠⚠ **顺序要紧**（我第一次跑就崩了：`NotFoundError: The node to be removed is not a child`）：
         *   两次 `mount` 挂的是**同一个 root 容器** ⇒ 必须先卸 `r2`（后挂的那个），
         *   再卸 `r`；反过来卸会把已经不在树上的节点再摘一次 ⇒ 抛 DOMException。
         */
        actFn(() => r2.unmount())
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // S-19 `cap` 那一栏：**有健康度标签**，但⛔ 不借用"进度状态"位置（2026-10-30 P21 §二）
    // ══════════════════════════════════════════════════════════════════
    /**
     * ── 本轮对 §二 的判断（写成断言，免得下一个人"别的行都有所以它也加"）──
     *   **判：加"健康度"栏，⛔ 不加"进度状态"位。**
     *   理由三条（源码 `capBlock` 里有同样一份）：
     *     ① `cap` 无终态、不进分母 ⇒ 进度式状态位会误导成"它也在走五步"；
     *     ② 但它有合法封闭集（`live/degraded/down`）= **当下健康度** ⇒ 该显示；
     *     ③ 所以换**语义**（健康度而非进度）、换**位置**（读数之前）、换**数据属性**
     *        （`stages-cap-item-state`，⛔ 不是 `stages-tree-item-status`）。
     *   ⇒ 本组同时验：**在**（`正常`/`降级`/`不可用`）+ **没占用条目状态位**。
     */
    {
      const caps = [
        { id: 'CAP-01', title: '叫醒面', status: 'live', lastReading: '2026-10-30 07:29 · 有在途记录（pending 1 条）' },
        { id: 'CAP-02', title: '降级的', status: 'degraded', lastReading: '2026-10-30 07:00 · 读不到' },
        { id: 'CAP-03', title: '挂了的', status: 'down', lastReading: '2026-10-30 06:00 · 无响应' },
        { id: 'CAP-04', title: '非法值', status: 'zzz-ghost', lastReading: 'x' },
      ]
      // ⚠ `mountTree` 是**内层块**作用域里的（`S-17*` 那一段），S-19 在它外面 ⇒ 直接用 `mount`
      const r = mount(react.createElement(ui.StagesPanel, {
        fetchProgress: async () => ({ ok: true, rows: [] }),
        fetchExec: async () => ({ ok: true, items: [] }),
        fetchStages: async () => ({
          ok: true, readAt: '2026-10-30T00:00:00.000Z',
          stages: [{ step: 1, name: '需求规格', state: 'done', done: 0, total: 0, items: [] }],
          caps,
        }),
        pollMs: 0,
      }))
      await tick(40)
      const probs = []
      const states = [...document.querySelectorAll('[data-dsh-hob="stages-cap-item-state"]')].map((e) => (e.textContent ?? '').trim())
      if (states.length !== 4) probs.push(`cap 健康度栏 ${states.length} 个（期望 4）`)
      const WANT = [['live', '正常', 0], ['degraded', '降级', 1], ['down', '不可用', 2]]
      for (const [st, want, idx] of WANT) {
        if (states[idx] !== want) probs.push(`cap.${st} 应为 ${JSON.stringify(want)}，实际 ${JSON.stringify(states[idx] ?? '(缺)')}`)
      }
      if (!/判不出/.test(states[3] ?? '')) probs.push(`cap 非法值没写「判不出」：${JSON.stringify(states[3] ?? '')}`)
      // ⚠ 关键：⛔ 不许占用条目的"进度状态"位
      const treeStatus = [...document.querySelectorAll('[data-dsh-hob="stages-tree-item-status"]')]
      if (treeStatus.length !== 0) probs.push(`cap 把状态塞进了 \`stages-tree-item-status\`（${treeStatus.length} 个）⇒ 与"进度状态"语义混了`)
      // ⚠ 读数仍在（健康度是**加**出来的，⛔ 没顶掉 last_reading）
      const capsText = document.querySelector('[data-dsh-hob="stages-cap-item"]')?.textContent ?? ''
      if (!capsText.includes('pending 1 条')) probs.push(`cap 行的 last_reading 被顶掉了：${JSON.stringify(capsText)}`)
      if (probs.length === 0) {
        ok('S-19 ✓ `cap` 有**健康度**栏（live⇒正常 · degraded⇒降级 · down⇒不可用 · 非法⇒判不出）'
          + '，且⛔ 未占用进度状态位、⛔ 未顶掉 last_reading')
      } else for (const x of probs) bad(`S-19 · ${x}`)
      actFn(() => r.unmount())
    }

    // —— S-19b 负向对拍：把 cap 的映射删成直打原文 ⇒ S-19 必红 ——
    {
      /**
       * ⚠ `buildMutant` 是 **S-7 那个块**里的局部函数（S-19b 在它外面）⇒ 这里直接用
       *   顶层可用的 `writeMutant`（同一个实现，见 `:207`）。
       */
      const _built = ((t) => {
        const m = t.replace(
          "}, stageStatusLabel('cap', String(c?.status ?? '')).label),",
          "}, String(c?.status ?? '')),",
        )
        return m === t ? undefined : writeMutant('cap-raw', m)
      })(src)
      const mutant = _built
      if (mutant === undefined) {
        bad('S-19b · 造不出「cap 直打原文」的变体（源码形态变了）⇒ 负向对拍不可判')
      } else {
        const modRaw = await import(pathToFileURL(mutant).href)
        const r = mount(react.createElement(modRaw.StagesPanel, {
          fetchProgress: async () => ({ ok: true, rows: [] }),
          fetchExec: async () => ({ ok: true, items: [] }),
          fetchStages: async () => ({
            ok: true, readAt: '2026-10-30T00:00:00.000Z',
            stages: [{ step: 1, name: '需求规格', state: 'done', done: 0, total: 0, items: [] }],
            caps: [{ id: 'CAP-01', title: '叫醒面', status: 'live', lastReading: 'x' }],
          }),
          pollMs: 0,
        }))
        await tick(30)
        const t = document.querySelector('[data-dsh-hob="stages-cap-item-state"]')?.textContent ?? ''
        if (t === 'live') ok(`S-19b ✓ 负向对拍（cap 映射改回原文直打）⇒ S-19 **必红**：实际 ${JSON.stringify(t)}`)
        else bad(`S-19b · 变体仍没打出英文原文（实 ${JSON.stringify(t)}）⇒ 那条断言没有牙`)
        actFn(() => r.unmount())
      }
    }

} finally {
  cleanup()
}

console.log('')
console.log(`S 组：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处`
  + (fail > 0 ? ` · 没过 ${fail} 处` : '')
  + ' · **跳过 0 处**（⚠ 跳过**不计入通过**；依赖不可用走 `exit 2`）')
console.log('')
if (fail > 0) {
  console.log('  ⛔ 有失败项 ⇒ 本组不算通过')
  process.exit(1)
}
console.log('  ✅ S 组全绿（⚠ 隔离渲染：组件行为/挂载位置成立；真实宿主渲染仍需重启后人工验）')
process.exit(0)
