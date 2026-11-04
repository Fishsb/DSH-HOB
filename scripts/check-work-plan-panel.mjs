#!/usr/bin/env node
/**
 * **工作计划面板 · 真 DOM 判据**（第五波 · 方案 §六 第五波 / §七 WM 面板项）。
 *
 * 证明的是「用户能从面板看见计划」，而不是「源码里有一个组件」：
 *   WP-1 面板真的挂进 `StagesPanel`（挂载后能找到 `data-dsh-hob="work-plan-panel"`）；
 *   WP-2 有数据时逐条显示计划、轨道数、执行者、等待关系；
 *   WP-3 单轨原因与串行链/重叠路径**可见**（不是只存在 JSON 里）；
 *   WP-4 判不出时明写原因，⛔ 不显示成「0 个计划」；
 *   WP-5 没有活动计划时明写「表里是空的」；
 *   WP-6 面板**零可交互元素**、零百分比、零进度条（只读）；
 *   WP-7 负向对拍：把挂载摘掉 ⇒ WP-1 必红。
 *
 * ⚠ 隔离渲染（jsdom），⛔ 不是真实宿主浏览器；真实宿主由独立验收另验。
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const ENTRY = 'src/client/project-panel.tsx'
const WORK = join(root, '.check-work-plan-panel-work')

let pass = 0
let fail = 0
const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail++; console.log(`  ✗ ${m}`) }

const cleanup = () => { try { rmSync(WORK, { recursive: true, force: true }) } catch { /* 忽略 */ } }
cleanup()
mkdirSync(WORK, { recursive: true })

let jsdom
let react
let reactDom
try {
  jsdom = await import('jsdom')
  react = await import('react')
  reactDom = await import('react-dom/client')
} catch (e) {
  console.log(`  ⚠ 依赖不可用（jsdom / react / react-dom）：${String(e?.message ?? e)}`)
  console.log('       ⇒ 需 `npm ci`；⛔ 本组**未执行**、不算通过')
  process.exit(2)
}

console.log('')
console.log('WP 组：工作计划面板 · 真 DOM 判据（jsdom 隔离渲染）')
console.log('')

try {
  const tsPath = join(root, 'node_modules', 'typescript', 'lib', 'typescript.js')
  const ts = (await import(pathToFileURL(tsPath).href)).default
  const tsMount = await import('./ts-mount.mjs')

  const shimDir = join(WORK, 'node_modules', '@deepseek-ai', 'dsh-client-ui-primitives')
  mkdirSync(shimDir, { recursive: true })
  writeFileSync(join(shimDir, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-client-ui-primitives', type: 'module', main: 'index.mjs',
  }, null, 2))
  writeFileSync(join(shimDir, 'index.mjs'), `
import React from 'react'
export function Tag({ tone, className, children }) {
  return React.createElement('span', { 'data-primitive': 'Tag', 'data-tone': tone ?? 'outline', className }, children)
}
export function StateDot({ state }) {
  return React.createElement('span', { 'data-primitive': 'StateDot', 'data-state': state, 'aria-hidden': 'true' })
}
`)

  const graph = tsMount.mountTsGraph({ root, outDir: join(WORK, 'out'), entries: [ENTRY], ts })
  const problems = [
    ...graph.problems,
    ...tsMount.verifyMounted({ root, entries: [ENTRY], mounted: graph.mounted, entryFiles: graph.entries }),
  ]
  if (problems.length > 0) for (const p of problems) bad(`WP-0 转译/自证失败：${p}`)
  else ok(`WP-0 ✓ 转译图自证通过（${graph.mounted.length} 个模块，含工作计划面板）`)

  const entryOut = graph.entries[ENTRY]
  if (entryOut === undefined) throw new Error('入口没有产出（见 WP-0）')
  const entryFile = join(WORK, 'entry.mjs')
  writeFileSync(entryFile, `export * from ${JSON.stringify(entryOut)}\n`)
  const ui = await import(pathToFileURL(entryFile).href)

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
  const tick = async (ms = 30) => { await actFn(async () => { await new Promise((res) => setTimeout(res, ms)) }) }

  const container = () => document.getElementById('root')

  /**
   * 挂一个 `StagesPanel`（其余取数全部给合法空读数）。
   *
   * @param plansResponse - 工作计划取数返回值（`undefined` ⇒ 不注入）
   * @param entry - 要挂的模块（负向对拍会传变体）
   * @returns React root（调用方负责 unmount）
   */
  const mount = async (plansResponse, entry = ui) => {
    const rootEl = reactDom.createRoot(container())
    const props = {
      fetchProgress: async () => ({ ok: true, rows: [] }),
      fetchExec: async () => ({ ok: true, items: [] }),
      fetchStages: async () => ({ ok: true, stages: [], caps: [] }),
      fetchUnseen: async () => ({ ok: true, count: 0, names: [], items: [], summary: '0 条 —— 当前没有待确认的工具' }),
      fetchCurrent: async () => ({ ok: true, text: '# Current\n\n- 夹具' }),
      ...(plansResponse === undefined ? {} : { fetchPlans: async () => plansResponse }),
      pollMs: 0,
    }
    await actFn(async () => { rootEl.render(react.createElement(entry.StagesPanel, props)) })
    await tick(40)
    return rootEl
  }

  const fixture = {
    ok: true,
    mode: 'multi',
    plans: [{
      planId: 'WP-demo-1',
      state: 'running',
      trackCount: 2,
      running: 1,
      waiting: 1,
      returned: 0,
      failed: 0,
      rationale: '两个模块互不相交',
      modeSnapshot: 'multi',
      singleTrackReason: 'same-file',
      serialized: { reason: 'same-file', groups: [['a', 'b']], sharedPaths: ['src/shared/x.ts'] },
      tracks: [
        { trackId: 'a', taskId: 'TSK-1', sessionId: 'session-alpha', accessType: 'write', dependsOn: [], state: 'running' },
        { trackId: 'b', taskId: 'TSK-2', sessionId: 'session-beta', accessType: 'write', dependsOn: ['a'], state: 'pending' },
      ],
    }],
    unreadable: [],
  }

  // WP-1 挂载
  {
    const r = await mount(fixture)
    const panel = document.querySelector('[data-dsh-hob="work-plan-panel"]')
    if (panel !== null) ok('WP-1 ✓ 工作计划面板真挂进 StagesPanel（data-dsh-hob="work-plan-panel" 存在）')
    else bad('WP-1 · StagesPanel 里找不到工作计划面板')
    r.unmount()
  }

  // WP-2 有数据：计划 / 轨道数 / 执行者 / 等待关系
  {
    const r = await mount(fixture)
    const rows = [...document.querySelectorAll('[data-dsh-hob="work-plan-row"]')].map((x) => x.textContent ?? '')
    const tracks = [...document.querySelectorAll('[data-dsh-hob="work-plan-track-row"]')].map((x) => x.textContent ?? '')
    const all = rows.join('\n') + '\n' + tracks.join('\n')
    const need = ['WP-demo-1', '轨道 2', 'session-alpha', 'session-beta', '等 a']
    const missing = need.filter((x) => !all.includes(x))
    if (rows.length === 1 && tracks.length === 2 && missing.length === 0) {
      ok(`WP-2 ✓ 有数据时显示计划、轨道数、两条执行者与等待关系：${tracks.map((t) => t.trim()).join(' | ')}`)
    } else bad(`WP-2 · rows=${rows.length} tracks=${tracks.length} missing=${JSON.stringify(missing)} all=${JSON.stringify(all).slice(0, 300)}`)
    r.unmount()
  }

  // WP-3 单轨原因 / 串行链 / 重叠路径可见
  {
    const r = await mount(fixture)
    const reason = document.querySelector('[data-dsh-hob="work-plan-single-reason"]')?.textContent ?? ''
    if (reason.includes('写同一批文件') && reason.includes('a → b') && reason.includes('src/shared/x.ts')) {
      ok(`WP-3 ✓ 单轨原因与依据可见：${reason.trim()}`)
    } else bad(`WP-3 · 单轨原因行=${JSON.stringify(reason)}`)
    r.unmount()
  }

  // WP-4 判不出
  {
    const r = await mount({ ok: false, reason: 'status-error', message: '夹具：编排器读不到' })
    const reason = document.querySelector('[data-dsh-hob="work-plan-reason"]')?.textContent ?? ''
    const empty = document.querySelector('[data-dsh-hob="work-plan-empty"]')
    if (reason.includes('判不出') && reason.includes('夹具：编排器读不到') && empty === null) {
      ok('WP-4 ✓ 判不出时明写原因，⛔ 没有伪装成「0 个计划」')
    } else bad(`WP-4 · reason=${JSON.stringify(reason)} empty=${empty !== null}`)
    r.unmount()
  }

  // WP-5 空表
  {
    const r = await mount({ ok: true, mode: 'single', plans: [], unreadable: [] })
    const empty = document.querySelector('[data-dsh-hob="work-plan-empty"]')?.textContent ?? ''
    if (empty.includes('表里是空的') && empty.includes('单会话')) {
      ok(`WP-5 ✓ 没有活动计划时明写「表里是空的」并带上当前档位：${empty.trim()}`)
    } else bad(`WP-5 · empty=${JSON.stringify(empty)}`)
    r.unmount()
  }

  // WP-6 只读：零可交互元素 / 零百分比 / 零进度条
  {
    const r = await mount(fixture)
    const panel = document.querySelector('[data-dsh-hob="work-plan-panel"]')
    const interactive = panel === null ? -1 : panel.querySelectorAll('button, input, select, textarea, a[href]').length
    const text = panel?.textContent ?? ''
    if (interactive === 0 && !text.includes('%') && panel?.querySelector('progress') === null) {
      ok('WP-6 ✓ 工作计划面板零可交互元素、零百分比、零进度条（仍只读）')
    } else bad(`WP-6 · interactive=${interactive} percent=${text.includes('%')} progress=${panel?.querySelector('progress') !== null}`)
    r.unmount()
  }

  // WP-7 负向对拍：摘掉挂载 ⇒ WP-1 必须红
  {
    const src = readFileSync(ENTRY, 'utf8')
    const mountRe = /React\.createElement\(WorkPlanPanel, \{[^\n]*\}\),\n/
    const stripped = src.replace(mountRe, '')
    if (stripped === src) {
      bad('WP-7 · 源码里找不到 WorkPlanPanel 的唯一挂载点 ⇒ 负向对拍无法构造')
    } else {
      /**
       * ⚠ 变体必须**换一份源码根**：`mountTsGraph` 按 `root` 读源码，
       *   在原根上写一份变体文件不会被读到（那会让本对拍恒绿）。
       * ⇒ 复制 `src/` 到临时根，只改那一份，再用同一个入口路径编译。
       */
      const variantRoot = join(WORK, 'variant-root')
      cpSync(join(root, 'src'), join(variantRoot, 'src'), { recursive: true })
      writeFileSync(join(variantRoot, ENTRY), stripped)
      const graph2 = tsMount.mountTsGraph({ root: variantRoot, outDir: join(WORK, 'variant-out'), entries: [ENTRY], ts })
      if (graph2.entries[ENTRY] === undefined) {
        bad('WP-7 · 变体转译失败 ⇒ 无法判')
      } else {
        const out = join(WORK, 'variant-mod.mjs')
        writeFileSync(out, `export * from ${JSON.stringify(graph2.entries[ENTRY])}\n`)
        const variantMod = await import(pathToFileURL(out).href)
        const r = await mount(fixture, variantMod)
        const panel = document.querySelector('[data-dsh-hob="work-plan-panel"]')
        if (panel === null) ok('WP-7 ✓ 负向对拍（摘掉 WorkPlanPanel 挂载）⇒ WP-1 的区块存在断言必红')
        else bad('WP-7 · 摘掉挂载后面板仍在 ⇒ WP-1 没有牙')
        r.unmount()
      }
    }
  }
  // WP-8 只读路由：真注册 POST 路径，处理体返回计划读数
  {
    const ROUTE = 'src/modules/work-plans-route.ts'
    const graph3 = tsMount.mountTsGraph({ root, outDir: join(WORK, 'route-out'), entries: [ROUTE], ts })
    const probs3 = [
      ...graph3.problems,
      ...tsMount.verifyMounted({ root, entries: [ROUTE], mounted: graph3.mounted, entryFiles: graph3.entries }),
    ]
    if (probs3.length > 0) for (const x of probs3) bad(`WP-8 转译/自证失败：${x}`)
    else {
      const out3 = join(WORK, 'route-mod.mjs')
      writeFileSync(out3, `export * from ${JSON.stringify(graph3.entries[ROUTE])}\n`)
      const routeMod = await import(pathToFileURL(out3).href)
      let handler
      const registered = []
      /** ⚠ `workPlans()` 一旦被调用就是**写盘**（推进计划）⇒ 这里让它直接炸，证明路由没走它。 */
      const fakeOrch = {
        status(opts) {
          if (opts?.self !== 'session-x') throw new Error(`status 未收到 self：${JSON.stringify(opts)}`)
          return { workPlans: { mode: 'multi', plans: [{ planId: 'WP-route', tracks: [] }], unreadable: [] } }
        },
        async workPlans() { throw new Error('路由不该调用 workPlans（那会写盘）') },
      }
      const fakeCtx = {
        logger: { info: () => {}, warn: () => {} },
        get: (n) => {
          if (n === 'hobOrchestrator') return fakeOrch
          if (n === 'hobSessionPolicy') return { of: () => ({ workMode: 'multi' }) }
          if (n === 'sessions') return { get: () => ({ header: { cwd: root } }) }
          return undefined
        },
        inject: (_names, cb) => {
          cb({
            get: (n) => {
              if (n === 'connection') {
                return { fetch: { register: (route) => { registered.push(route); handler = route.fetch; return () => {} } } }
              }
              if (n === 'hobOrchestrator') return fakeOrch
              return undefined
            },
          })
          return { dispose: () => {} }
        },
        effect: () => {},
      }
      routeMod.installWorkPlansRoute(fakeCtx)
      const route = registered[0]
      const q = []
      if (route?.path !== routeMod.WORK_PLANS_ROUTE_PATH) q.push(`注册路径不对：${JSON.stringify(route?.path)}`)
      if (JSON.stringify(route?.methods) !== '["POST"]') q.push(`methods 不是 POST：${JSON.stringify(route?.methods)}`)
      if (typeof handler !== 'function') q.push('没有可调用的处理体')
      else {
        const req = (body) => ({ text: async () => JSON.stringify(body) })
        const good = await handler(req({ sessionId: 'session-x' }))
        const goodBody = await good.json()
        const noSession = await handler(req({}))
        const noSessionBody = await noSession.json()
        const badJson = await handler({ text: async () => '{broken' })
        const badJsonBody = await badJson.json()
        if (good.status !== 200 || goodBody.ok !== true
          || goodBody.plans?.[0]?.planId !== 'WP-route' || goodBody.mode !== 'multi') {
          q.push(`正常读数不对：${good.status} ${JSON.stringify(goodBody)}`)
        }
        if (noSession.status !== 400 || noSessionBody.reason !== 'no-session') {
          q.push(`缺 sessionId 未归 no-session：${noSession.status} ${JSON.stringify(noSessionBody)}`)
        }
        if (badJson.status !== 400 || badJsonBody.reason !== 'bad-request') {
          q.push(`坏 JSON 未归 bad-request：${badJson.status} ${JSON.stringify(badJsonBody)}`)
        }
      }
      if (q.length === 0) ok('WP-8 ✓ 只读路由：注册 POST 路径；正常读数带 plans/mode；缺 sessionId 与坏 JSON 各自可分辨；未调用会写盘的 workPlans()')
      else for (const x of q) bad(`WP-8 · ${x}`)
    }
  }

  // WP-9 编排器缺席 ⇒ 路由不登记（降级，⛔ 不抛）
  {
    const ROUTE = 'src/modules/work-plans-route.ts'
    const out3 = join(WORK, 'route-mod-degrade.mjs')
    const graph4 = tsMount.mountTsGraph({ root, outDir: join(WORK, 'degrade-out'), entries: [ROUTE], ts })
    if (graph4.entries[ROUTE] === undefined) {
      bad('WP-9 · 降级用例转译失败 ⇒ 无法判')
    } else {
      writeFileSync(out3, `export * from ${JSON.stringify(graph4.entries[ROUTE])}\n`)
      const mod = await import(pathToFileURL(out3).href)
      const registered = []
      const ctx = {
        logger: { info: () => {}, warn: () => {} },
        get: () => undefined,
        inject: (_names, cb) => {
          cb({ get: (n) => n === 'connection'
            ? { fetch: { register: (r) => { registered.push(r); return () => {} } } }
            : undefined })
          return { dispose: () => {} }
        },
        effect: () => {},
      }
      let threw
      try { mod.installWorkPlansRoute(ctx) } catch (e) { threw = e }
      if (threw === undefined && registered.length === 0) {
        ok('WP-9 ✓ 编排器缺席 ⇒ 路由不登记，也不抛（面板那格会显示判不出）')
      } else bad(`WP-9 · threw=${String(threw)} registered=${registered.length}`)
    }
  }

} finally {
  cleanup()
}

console.log('')
console.log(`WP 组：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处`
  + (fail > 0 ? ` · 没过 ${fail} 处` : '')
  + ' · 跳过 0 处')
console.log('')
if (fail > 0) {
  console.log('  ⛔ 有失败项 ⇒ 本组不算通过')
  process.exit(1)
}
console.log('  ✅ WP 组全绿（⚠ 隔离渲染；真实宿主面板仍需重启后人工验）')
process.exit(0)
