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
console.log('S 组：四步主线面板 · 位置判据（真 DOM 挂载，jsdom 隔离渲染）')
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

  if (prodSteps.length === 4 && prodUnwired !== undefined && prodKind !== undefined && prodTabId !== undefined) {
    ok(`S-1 ✓ 从 \`${ENTRY}\` 抽出真值：${prodSteps.length} 个步骤名（${prodSteps.join(' / ')}）`
      + ` · 状态词「${prodUnwired}」· tab kind「${prodKind}」· tab id「${prodTabId}」`)
  } else {
    bad('S-1 · 抽不到 `STAGES_STEP_NAMES`（4 项）/ `STAGES_UNWIRED_LABEL` / `STAGES_TAB_KIND` / `STAGES_TAB_ID`'
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
  const { createRoot } = reactDom
  const mount = (el) => {
    const host = document.getElementById('root')
    host.innerHTML = ''
    const r = createRoot(host)
    actFn(() => { r.render(el) })
    return r
  }
  const text = () => document.getElementById('root').textContent ?? ''

  // ══════════════════════════════════════════════════════════════════════
  // S-2 / S-3 栏脚按钮：真的渲染 + 真的可点 + 真的调用
  // ══════════════════════════════════════════════════════════════════════
  {
    const calls = []
    const r = mount(react.createElement(ui.StagesFooterAction, {
      wide: true,
      openStages: () => { calls.push('open') },
    }))
    const btn = document.querySelector('[data-dsh-hob="stages-entry"]')
    if (btn === null || btn.tagName !== 'BUTTON') {
      bad('S-2 · 栏脚入口**没有渲染出 `<button>`**（DOM 里找不到 [data-dsh-hob=stages-entry]）')
    } else if (btn.textContent.trim() === '') {
      bad('S-2 · 栏脚按钮渲染出来了但**看不见字**（空文本）⇒ 用户看到的是空白格')
    } else {
      ok(`S-2 ✓ 栏脚入口真的渲染出可点的 \`<button>\`，文本「${btn.textContent.trim()}」`)
    }
    if (btn !== null) {
      actFn(() => { btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true })) })
      if (calls.length === 1) ok('S-3 ✓ 点击 ⇒ `openStages` 真的被调用，恰好 1 次')
      else bad(`S-3 · 点击后 \`openStages\` 被调用 ${calls.length} 次（期望 1）`)
    }
    actFn(() => r.unmount())
  }

  // ══════════════════════════════════════════════════════════════════════
  // S-5 服务缺席 ⇒ 如实降级（无按钮、一句说明）
  // ══════════════════════════════════════════════════════════════════════
  {
    const r = mount(react.createElement(ui.StagesFooterAction, { wide: true, openStages: undefined }))
    const btn = document.querySelector('[data-dsh-hob="stages-entry"]')
    const note = document.querySelector('[data-dsh-hob="stages-entry-unavailable"]')
    if (btn !== null) bad('S-5 · 服务缺席时**仍然渲染了按钮** ⇒ 那是一个点了没反应的假入口')
    else if (note === null || note.textContent.trim() === '') bad('S-5 · 服务缺席时没有任何说明文本 ⇒ 用户看不到"为什么没有入口"')
    else ok(`S-5 ✓ 服务缺席 ⇒ 无按钮、有说明「${note.textContent.trim()}」`)
    actFn(() => r.unmount())
  }

  // ══════════════════════════════════════════════════════════════════════
  // S-4 `makeOpenStages` 真调假服务，参数必须是那个 kind
  // ══════════════════════════════════════════════════════════════════════
  const makeCtx = (service) => ({
    logger: { warn: () => {} },
    get: (name) => (name === 'sidebarRight' ? service : undefined),
    inject: () => ({ dispose: () => {} }),
  })
  {
    const opened = []
    const open = ui.makeOpenStages(makeCtx({ openTab: (kind) => { opened.push(kind) } }))
    if (typeof open !== 'function') {
      bad('S-4 · `makeOpenStages(ctx)` 在 `sidebarRight.openTab` 在场时**没有**给出函数')
    } else {
      open()
      if (opened.length === 1 && opened[0] === prodKind) {
        ok(`S-4 ✓ 点开链路真的调到 \`sidebarRight.openTab\`，参数 = 「${opened[0]}」（= STAGES_TAB_KIND）`)
      } else {
        bad(`S-4 · \`openTab\` 调用参数不对：收到 ${JSON.stringify(opened)}，期望恰好 ["${prodKind}"]`)
      }
    }
    // 服务缺席 ⇒ undefined（与 S-5 同一条纪律的运行时一半）
    const none = ui.makeOpenStages(makeCtx(undefined))
    if (none === undefined) ok('S-4b ✓ 服务缺席 ⇒ `makeOpenStages` 返回 undefined（调用方据此如实降级）')
    else bad('S-4b · 服务缺席时 `makeOpenStages` 仍给出函数 ⇒ 会产出"点了没反应"的假入口')
  }

  // ══════════════════════════════════════════════════════════════════════
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
  const auditPanel = (mod, steps, unwired) => {
    const problems = []
    const r = mount(react.createElement(mod.StagesPanel))
    const rows = [...document.querySelectorAll('[data-dsh-hob="stages-row"]')]
    if (rows.length !== steps.length) {
      problems.push(`面板只有 ${rows.length} 行（期望 ${steps.length}）`)
    }
    const got = rows.map((x) => x.textContent ?? '')
    steps.forEach((name, i) => {
      const row = got[i]
      if (row === undefined) { problems.push(`缺第 ${i + 1} 行「${name}」`); return }
      if (!row.includes(name)) problems.push(`第 ${i + 1} 行里没有「${name}」，实际「${row.trim()}」`)
      if (!row.includes(unwired)) problems.push(`第 ${i + 1} 行（「${name}」）旁边没有「${unwired}」，实际「${row.trim()}」`)
    })
    const all = text()
    // ⛔ 本轮不许有任何"假进度"的形态：百分比 / 假勾选 / 假完成态。
    //   ⚠ 只查**行内文本**（面板标题「四步进度」里的"进度"是产品名，不是状态值；
    //     把它也算进来就是判据口径写错了 —— 那会让这条断言永远红）。
    if (/%/.test(all)) problems.push('面板里出现了 `%` —— 本轮不许有任何百分比')
    const rowsText = got.join(' ')
    if (/已完成|完成度|已勾选/.test(rowsText)) problems.push('行内出现了"已完成/完成度/已勾选"字样 —— 本轮一律写"未接线"')
    const dots = [...document.querySelectorAll('[data-primitive="StateDot"]')]
    if (dots.length !== steps.length) problems.push(`状态圆点 ${dots.length} 个（期望 ${steps.length} 个，每行一个）`)
    if (!dots.every((d) => d.getAttribute('aria-hidden') === 'true')) problems.push('StateDot 未标 aria-hidden（宿主契约要求圆点对读屏隐藏）')
    actFn(() => r.unmount())
    return problems
  }
  {
    const problems = auditPanel(ui, prodSteps, prodUnwired)
    if (problems.length === 0) {
      ok(`S-6 ✓ 面板四行齐全、顺序正确、每行都写「${prodUnwired}」、零百分比、零假完成态`)
    } else {
      for (const p of problems) bad(`S-6 · ${p}`)
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
      const outDir = join(work, 'mut', name)
      mkdirSync(outDir, { recursive: true })
      const out = join(outDir, 'mutant.mjs')
      writeFileSync(out, ts.transpileModule(mutated, {
        compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true },
      }).outputText)
      return out
    }

    // ① 改一个步骤名 ⇒ 面板判据必须红
    const mutantA = buildMutant('steps', (s) => s.replace(`'${prodSteps[0]}'`, `'被改坏的步骤'`))
    if (mutantA === undefined) {
      bad('S-7 · 造不出「改步骤名」的变体（源码里找不到该字面量）⇒ 负向对拍不可判')
    } else {
      const modA = await import(pathToFileURL(mutantA).href)
      const pA = auditPanel(modA, prodSteps, prodUnwired)
      if (pA.length > 0) ok(`S-7a ✓ 负向对拍（改步骤名）⇒ S-6 判据**变红**：${pA[0]}`)
      else bad('S-7a · 改了步骤名，S-6 判据**仍然通过** ⇒ 那条判据是恒真的、没有牙')
    }

    // ② 改 tab kind ⇒ 打开链路的判据必须红
    const mutantB = buildMutant('kind', (s) => s.replace(`'${prodKind}'`, `'other-kind-x'`))
    if (mutantB === undefined) {
      bad('S-7 · 造不出「改 kind」的变体 ⇒ 负向对拍不可判')
    } else {
      const modB = await import(pathToFileURL(mutantB).href)
      const opened = []
      const open = modB.makeOpenStages(makeCtx({ openTab: (k) => { opened.push(k) } }))
      const wrong = typeof open !== 'function' || opened.length !== 1 || opened[0] !== prodKind
      if (wrong) ok(`S-7b ✓ 负向对拍（改 kind）⇒ S-4 判据**变红**：openTab 收到 ${JSON.stringify(opened)}，生产值是「${prodKind}」`)
      else bad('S-7b · 改了 kind，S-4 判据**仍然通过** ⇒ 没有牙')
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
