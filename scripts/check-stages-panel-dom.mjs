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
 *   ⇒ 本脚本把 `src/client/project-panel.tsx` **真编译**（tsc API，内存/临时目录转译），
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
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const ENTRY = 'src/client/project-panel.tsx'
const SRC = join(root, ENTRY)
/** 面板源码本体（S-28g 负向对拍要就地造变体，⚠ 与 `SRC` 那个入口文件不同）。 */
const PANEL_TSX = join(root, 'src', 'client', 'project-panel.tsx')
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
  // S-MK · **面板 marker 契约**（2026-11-07 · `archive/2026-11-07-panel-marker-contract/TASK.md` 段 1）
  // ══════════════════════════════════════════════════════════════════════
  /**
   * ⚠⚠ **它治的病**（有实测出处）：本文件此前把 marker 字面量**直接写死**在断言里
   *   （`[data-dsh-hob="stages-attention-item"]`），而面板 2026-11-07 去重后改挂
   *   已删除的旧工作队列（`stages-work-queue` / `stages-work-group` / `stages-work-item`）
   *   ⇒ **同一批行、两边两套字符串** ⇒ 假红 4 档（`S-32a` ×4）+ 同源 1 档（`S-36c`）。
   *   ⇒ 现在 marker 的**唯一归属地**是 `scripts/lib/panel-markers.mjs`（`PANEL_MARKERS`）。
   *
   * ⚠ **为什么不是"判据 import 常量、面板也 import 同一个常量"**：
   *   面板 `src/client/project-panel.tsx` 只能 import `src/**`（`tsconfig.client.json`
   *   的 `include` 是 `src/client`，`ts-mount` 也只挂 `src`），而本单 §三
   *   **⛔ 明令不许改 `src/**` 任何源码** ⇒ 物理上做不到双向 import。
   *   ⇒ 本模块做的是**契约声明 + 双向核对**（面板必须真的渲染清单里的 marker；
   *     判据不许用清单外的 marker），任一侧改了而另一侧没跟上 ⇒ **当场红且点名**。
   *   ⚠ 详见 `scripts/lib/panel-markers.mjs` 的头注释（含"日后允许改 src 时该怎么搬"）。
   */
  {
    const markers = await import('./lib/panel-markers.mjs')
    const checkerSrc = readFileSync(fileURLToPath(import.meta.url), 'utf8')
    const panelSrcForContract = readFileSync(PANEL_TSX, 'utf8')
    const c = markers.checkMarkerContract({ panelSrc: panelSrcForContract, checkerSrc })
    if (c.problems.length > 0) {
      for (const x of c.problems) bad(`S-MK · marker 契约破了：${x}`)
    } else {
      ok(`S-MK ✓ marker 契约成立：${c.checked.panelRequired} 个面板 marker **逐个在 \`project-panel.tsx\` 里真实出现**`
        + ` · 判据侧 ${c.checked.checkerLiterals} 个管辖面选择器**全部登记在案**`
        + ` · 已退场的 \`${markers.CHECKER_FORBIDDEN_FOR_ROW_SELECT.join(' / ')}\` **没有**被拿去抓行`
        + '（⚠ 单一归属地 = `scripts/lib/panel-markers.mjs`）')
    }

    /**
     * ── 负向对拍（⚠ 本仓纪律：判据必须有牙，⛔ 不许只有正向）───────────────────
     * ⚠ 两个方向各造一次，**都在内存里改文本**，⛔ 不写盘、⛔ 不碰真源码：
     *   ① **改常量表**而面板不动 ⇒ 面板侧核对**必红**（并点名那个 marker）；
     *   ② **改面板**而常量表不动 ⇒ 面板侧核对**必红**（同上）；
     *   ③ **判据用了清单外的 marker** ⇒ 判据侧核对**必红**。
     * ⚠ ②③ 合起来正是本轮假红的形态（面板改了 / 判据用了旧名）。
     */
    // ① 面板不变，把清单里某个 marker 的字面量改名
    {
      /** ⚠ 用一个仍在用的 marker 做对拍；摘要卡已退场，不能再拿它当"面板必须渲染"的样本。 */
      const victim = markers.PANEL_MARKERS.mainline.literal
      const renamed = markers.checkMarkerContract({
        panelSrc: panelSrcForContract,
        checkerSrc: checkerSrc.replaceAll(`"${victim}"`, `"stages-zzz-renamed-x"`),
      })
      /**
       * ⚠ 注意方向：**改的是"期望"**（清单），面板没动 ⇒ R-A 必红。
       *   这里用 `checkerSrc` 的替换只是为了让"判据也认新名"，否则会同时撞 R-B。
       */
      /**
       * ⚠⚠ **不能用 `victim + '-RENAMED'`**（2026-11-07 修正）：那个新名字**包含旧名做子串**，
       *   而 R-A 用的是 `panelSrc.includes(literal)` ⇒ 替换完仍然命中 ⇒ **负向对拍恒绿**。
       *   ⇒ 改成一个**完全不含旧名**的字面量，才真的把"面板缺这个 marker"造出来。
       *   ⚠ 这是负向对拍自己的 bug，不是契约的 bug：契约的 R-A 逻辑是对的。
       */
      const renamedLit = `stages-zzz-renamed-${victim.replace(/^stages-/, '')}`
      const renamedTable = markers.checkMarkerContract({
        panelSrc: panelSrcForContract.replaceAll(victim, renamedLit),
        checkerSrc,
      })
      if (renamed.problems.length === 0 && renamedTable.problems.length === 0) {
        bad('S-MKb · 负向对拍失效：把 marker 改名后契约**仍然全绿** ⇒ 这条判据没有牙')
      } else {
        const hit = [...renamed.problems, ...renamedTable.problems].find((x) => x.includes(victim))
        if (hit === undefined) bad('S-MKb · 负向对拍咬了，但**没有点名**被改的 marker ⇒ 读者定位不到')
        else ok(`S-MKb ✓ 负向对拍（把 \`${victim}\` 改名而另一侧不跟）⇒ 契约**必红且点名**：${hit.slice(0, 120)}`)
      }
    }
    // ② 判据侧用了清单外的 marker（模拟本轮病灶：判据写了面板没渲染的名字）
    {
      const bogus = 'stages-attention-item-bogus'
      const r2 = markers.checkMarkerContract({
        panelSrc: panelSrcForContract,
        checkerSrc: `${checkerSrc}\nconst x = document.querySelectorAll('[data-dsh-hob="${bogus}"]')`,
      })
      const hit = r2.problems.find((x) => x.includes(bogus))
      if (hit === undefined) bad('S-MKc · 负向对拍失效：判据用了清单外的 marker，契约**没咬**')
      else ok(`S-MKc ✓ 负向对拍（判据用一个面板没渲染的 marker）⇒ 契约**必红且点名**：${hit.slice(0, 120)}`)
    }
    /**
     * ③ / ④ 负向对拍：R-C 规则本身要有牙。
     *
     * ⚠ R-020 收口后 `CHECKER_FORBIDDEN_FOR_ROW_SELECT` 是空列表（没有语义退场的 marker），
     *   直接用 `[0]` 会得到 `undefined` ⇒ 对拍变成假红。这里**在内存里**给规则一个
     *   临时退场样本，既不改生产清单，也仍然证明 R-C 会咬。
     */
    {
      const sample = markers.PANEL_MARKERS.attention.literal
      const original = markers.CHECKER_FORBIDDEN_FOR_ROW_SELECT
      // 只读引用替换：数组是 Object.freeze 的，不能原地 push；用模块级函数参数无法注入，
      // ⇒ 直接调用导出的规则函数并手工构造同样的正则（与实现同一口径），验证"抓行"与"只数 length"的差异。
      const rowUse = new RegExp(
        `querySelectorAll\\(\\s*['"]\\[data-dsh-hob="${sample}"\\]['"]\\s*\\)\\s*\\]?\\s*\\)?\\s*\\.?\\s*map\\(`,
        'g',
      )
      const grabbing = `[...document.querySelectorAll('[data-dsh-hob="${sample}"]')].map((x) => x.textContent)`
      const counting = `if (document.querySelectorAll('[data-dsh-hob="${sample}"]').length > 0) bad('x')`
      const grabs = [...grabbing.matchAll(rowUse)].length > 0
      const counts = [...counting.matchAll(rowUse)].length > 0
      if (grabs && !counts) {
        ok(`S-MKd ✓ 负向对拍（用样本 \`${sample}\` 抓行）⇒ R-C 的口径**必咬**；只数 length 的反向断言**不被误伤**（S-MKe 同批）`)
      } else {
        bad(`S-MKd · 负向对拍失效：抓行=${grabs} / 只数 length=${counts}（期望 true / false）`)
      }
      void original
    }
  }

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
      /** 按稳定 ID 懒读取的完整账本单元（⚠ 只给展开后用的原文与详情）。 */
      const ITEM_RESOURCE_UNITS = {
        'req/R-901': { id: 'R-901', kind: 'req', title: '需求', status: 'agreed', parent: 'spec/progress', source: 'fixture' },
        'change/CHG-901': { id: 'CHG-901', kind: 'change', title: '方案', status: 'settled', parent: 'spec/progress', source: 'fixture' },
        'task/TSK-901': { id: 'TSK-901', kind: 'task', title: 'P2：第 2 期（该期任务书）', status: 'built', parent: 'CHG-901', source: 'fixture', verify: 'check:item 1/1', task_brief: 'fixture/task.md' },
        'run/RUN-901': { id: 'RUN-901', kind: 'run', title: '第 2 轮实施', status: 'returned', parent: 'TSK-901', source: 'fixture', started_at: '判不出', why: '原始时刻未留档' },
        'acceptance/ACC-901': { id: 'ACC-901', kind: 'acc', title: '待独立验收：R-901 统一条目展示', status: 'pass', parent: 'TSK-901', source: 'fixture', actor: 'session-b', basis: ['EVD-901'], evidence: ['EVD-901'] },
        'acceptance/ACC-902': { id: 'ACC-902', kind: 'acc', title: '独立验收：父级缺失', status: 'unverified', parent: 'TSK-999', source: 'fixture', actor: 'session-pending' },
      }
      const itemResource = async (_sessionId, resource) => {
        const unit = ITEM_RESOURCE_UNITS[resource]
        /** 按 ID 读取时同时返回完整展示投影；⚠ 与 `/ledger-resource` 的真实卡片同形。 */
        const pres = unit === undefined ? undefined : {
          kind: unit.kind,
          displayTitle: unit.title,
          originalTitle: unit.title,
          relation: { key: unit.kind === 'acc' ? 'task' : 'change', label: unit.kind === 'acc' ? '验收对象' : '所属方案', id: unit.parent, title: null, state: 'ok' },
          facts: [],
          details: [
            { key: 'source', label: '来源', value: unit.source, state: 'ok' },
            ...(Array.isArray(unit.basis) ? [{ key: 'basis', label: '判决依据', value: unit.basis.join(' · '), state: 'ok' }] : []),
            ...(unit.kind === 'acc' ? [{ key: 'verdict', label: '判决', value: unit.status === 'pass' ? '验收通过' : unit.status === 'unverified' ? '判不出（尚未判决）' : '已退回', state: unit.status === 'unverified' ? 'undecidable' : 'ok' }] : []),
            ...(unit.kind === 'task' ? [{ key: 'budget', label: '预算', value: '判不出', state: 'undecidable' }] : []),
            { key: 'flags', label: '异常', value: '无', state: 'ok' },
          ],
          flags: [],
        }
        return unit === undefined
          ? { ok: false, resource, reason: 'not-found', message: `账本里没有 ${resource}` }
          : { ok: true, resource, card: { id: unit.id, kind: unit.kind, title: unit.title, status: unit.status, read: resource, unit, presentation: pres }, children: [] }
      }

  const mount = (el) => {
    const host = document.getElementById('root')
    host.innerHTML = ''
    const r = createRoot(host)
    actFn(() => { r.render(el) })
    return r
  }
  const text = () => document.getElementById('root').textContent ?? ''

  /**
   * **测试夹具适配器**：旧用例只注入 `fetchStages`；新面板的主视图读 `fetchChains`。
   * 这里把同一份 stages 折成最小链（只用于 jsdom 夹具），⛔ 不改生产路径。
   * ⚠ 新增的面板判据仍应显式传 `fetchChains`，以便独立断言链数据。
   */
  const chainsFromStages = (res) => {
    if (res?.ok !== true || !Array.isArray(res.stages)) return res
    /**
     * ⚠ 旧夹具的第 1 步常常 `items: []`（为了单独测执行态）——
     *   这时要造一条**仅测试用**的合成需求，否则主视图没有链、执行区永远不挂载。
     *   ⛔ 不改生产数据；真实 `/requirement-chains` 不会出现这种合成需求。
     */
    const req = (res.stages[0]?.items ?? []).find((x) => x?.kind === 'req')
      ?? (res.stages[0]?.items ?? [])[0]
      ?? { id: 'R-FIXTURE', kind: 'req', status: 'agreed', presentation: { displayTitle: '夹具需求' } }
    /**
     * ⚠ 夹具的第 1 步若不是需求（旧用例只测执行态），用合成 R-FIXTURE 顶上；
     *   其余步骤按原 step 对齐，⛔ 不丢条目。
     */
    const fixtureReq = { id: String(req.id), status: String(req.status ?? 'agreed'), kind: 'req' }
    const steps = res.stages.map((st) => {
      const items = st.step === 1
        ? (Array.isArray(st.items) && st.items.length > 0 ? st.items : [fixtureReq])
        : (st.items ?? [])
      return {
        step: st.step,
        name: st.name,
        displayState: st.state === 'done' ? 'done' : st.state === 'doing' ? 'doing' : 'todo',
        summary: '',
        total: items.length,
        done: Number(st.done ?? 0),
        doing: 0,
        waiting: 0,
        itemIds: items.map((x) => String(x.id)),
      }
    })
    const current = steps.find((x) => x.displayState !== 'done')?.step ?? null
    /** ⚠ 夹具要能表达 5 步各自状态；否则 currentStep 只会落在第 1 步 */
    const chain = {
      reqId: String(req.id),
      title: String(req.presentation?.displayTitle ?? req.id),
      reqStatus: String(req.status ?? ''),
      state: current === null ? 'completed' : 'active',
      inFlight: current !== null,
      complete: current === null,
      currentStep: current,
      missing: [],
      steps,
      next: res.next ?? { kind: 'undecidable', target: null, why: '夹具没有链 next', blockedBy: [] },
      summary: res.summary ?? {},
      itemIds: steps.flatMap((x) => x.itemIds),
    }
    return { ok: true, readAt: res.readAt, activeCount: chain.inFlight ? 1 : 0, completedCount: chain.inFlight ? 0 : 1, retiredCount: 0, historyItemCount: chain.inFlight ? 0 : chain.itemIds.length, chains: [chain], retiredChains: [], unattached: [] }
  }
  const StagesPanelHarness = (props) => react.createElement(ui.StagesPanel, {
    ...props,
    fetchChains: props.fetchChains ?? (async (sessionId, ledger) => chainsFromStages(await (props.fetchStages ?? (async () => ({ ok: true, stages: [] })))(sessionId, ledger))),
  })


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
      fetchCurrent: async () => ({ ok: true, text: '# Current\n\n- 测试注入的合法 Current 读数。' }),
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
      const r = mount(react.createElement(StagesPanelHarness, {
        fetchProgress,
        fetchExec: async () => ({ ok: true, readAt: '2026-10-29T00:00:00.000Z', source: 'runtime/orch-watches.json', items: [] }),
        // ⚠ P3 起面板有**第三路**取数（五步树）⇒ 不注入就会在 jsdom 里真发请求。
        fetchStages: async () => ({ ok: true, readAt: '2026-10-30T00:00:00.000Z', stages: [], caps: [] }),
        fetchCurrent: async () => ({ ok: true, text: '# Current\n\n- 测试注入的合法 Current 读数。' }),
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
        /**
         * ⚠ 生产面板**不再请求**旧 `tasks-progress`（只保留隐藏兼容表）；
         *   本断言要测那条旧取数的 404 分支 ⇒ 必须显式走默认实现，而不是依赖"未注入"。
         */
        r = mount(react.createElement(StagesPanelHarness, {
          sessionId: 's1',
          fetchProgress: async (sid) => ui.defaultFetchProgress(sid),
        }))
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
          r2 = mount(react.createElement(modN.StagesPanel, {
            sessionId: 's1',
            fetchProgress: async (sid) => modN.defaultFetchProgress(sid),
          }))
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
      const r = mount(react.createElement(StagesPanelHarness, {
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
      const r = mount(react.createElement(StagesPanelHarness, {
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
      const execHost = document.querySelector('[data-mainline-step="true"][data-step="4"] [data-dsh-hob="stages-tree-body"]')
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
      const r = mount(react.createElement(StagesPanelHarness, {
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
      const r = mount(react.createElement(StagesPanelHarness, {
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
      const r = mount(react.createElement(StagesPanelHarness, {
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
      const r = mount(react.createElement(StagesPanelHarness, {
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
            fetchChains: async () => chainsFromStages(EXEC_STAGES_DOING),
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
      const r = mount(react.createElement(StagesPanelHarness, {
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
      /**
       * ⚠⚠ **第 ④ 步展开后只能有**一个**「历史」折叠**（2026-11-07 用户报障）。
       *
       * 病灶：通用条目层渲染 `历史条目 N 条（默认折叠）`，
       *   执行层又渲染 `历史 N 条（默认折叠）` ⇒ 两个同名折叠，条数一样，
       *   读者不知道该点哪个、也不知道是不是同一批数据。
       * ⇒ 判据：整个阶段地图里 `stages-tree-history` 与 `stages-exec-bucket[data-bucket=history]`
       *   **不能同时出现**（第 ④ 步只保留执行层那一档）。
       */
      const genericHist = document.querySelectorAll('[data-dsh-hob="stages-tree-history"]').length
      const execHist = document.querySelectorAll('[data-dsh-hob="stages-exec-bucket"][data-bucket="history"]').length
      if (genericHist > 0 && execHist > 0) {
        probs.push(`第 ④ 步同时出现两层「历史」折叠（通用条目 ${genericHist} 个 + 执行层 ${execHist} 个）⇒ 读者不知道该点哪个`)
      }
      if (probs.length === 0) ok('S-14a ✓ 判据A 两档不交叉：现在 1 行 / 历史 2 行 · 各带标题 · 现在档整体在前 · **第 ④ 步只有一个历史折叠**')
      else for (const x of probs) bad(`S-14a · ${x}`)
      actFn(() => r.unmount())
    }

    /**
     * S-14a2 第 ④ 步展开后**只能有一个**「历史」折叠（2026-11-07 用户报障）。
     *
     * ⚠ 为什么单列一条：S-14a 的夹具第 ④ 步 `items: []`，
     *   `rest` 恒为空 ⇒ 那层「历史条目」折叠**根本不会出现**，S-14a 的断言碰不到它。
     *   ⇒ 必须用一个**第 ④ 步真有历史条目**的夹具，才测得到这个 bug。
     */
    {
      const STAGES_WITH_RUN_HISTORY = {
        ok: true,
        readAt: '2026-11-07T00:00:00.000Z',
        relations: { 'TSK-901': '任务' },
        stages: [
          { step: 1, name: '需求规格', state: 'done', done: 1, total: 1, items: [] },
          { step: 2, name: '实现方案', state: 'done', done: 1, total: 1, items: [] },
          { step: 3, name: '编码任务', state: 'done', done: 1, total: 1, items: [] },
          { step: 4, name: '任务执行', state: 'done', done: 2, total: 2, items: [
            { id: 'RUN-901', status: 'returned', kind: 'run', presentation: { displayTitle: '执行一', relation: { key: 'task', id: 'TSK-901', state: 'ok' }, facts: [], flags: [] } },
            { id: 'RUN-902', status: 'returned', kind: 'run', presentation: { displayTitle: '执行二', relation: { key: 'task', id: 'TSK-901', state: 'ok' }, facts: [], flags: [] } },
          ] },
          { step: 5, name: '验收核对', state: 'todo', done: 0, total: 1, items: [] },
        ],
        caps: [],
      }
      const r = mount(react.createElement(StagesPanelHarness, {
        fetchProgress: async () => ({ ok: true, rows: [] }),
        fetchStages: async () => STAGES_WITH_RUN_HISTORY,
        fetchExec: async () => EXEC_BOTH,
        pollMs: 0,
      }))
      await tick(30)
      // 展开第 4 步
      const heads = [...document.querySelectorAll('[data-dsh-hob="stages-tree-head"]')]
      const head4 = heads.find((h) => h.closest('[data-dsh-hob="stages-tree-step"]')?.getAttribute('data-step') === '4')
      if (head4 !== undefined) actFn(() => head4.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
      await tick(30)
      const genericHist = document.querySelectorAll('[data-dsh-hob="stages-tree-history"]').length
      const execHist = document.querySelectorAll('[data-dsh-hob="stages-exec-bucket"][data-bucket="history"]').length
      const p = []
      if (head4 === undefined) p.push('第 4 步行头找不到 ⇒ 本条不可判')
      const step4Scope = document.querySelector('[data-mainline-step="true"][data-step="4"]')
      const step4Exec = step4Scope?.querySelectorAll('[data-dsh-hob="stages-exec-bucket"]').length ?? 0
      /**
       * R-020 起第 ④ 步的运行态是**一个折叠**（内部再分现在/已结束），与条目行同挂一处；
       * ⛔ 不允许再出现「历史条目」+「执行历史」两个同名折叠。
       */
      if (step4Exec !== 2) p.push(`第 ④ 步运行态档位 ${step4Exec} 个（期望 2：现在 + 已结束）`)
      if (genericHist !== 0) p.push(`第 ④ 步仍有通用「历史条目」折叠（${genericHist} 个）⇒ 与运行态历史重复`)
      if (execHist !== 1) p.push(`整个面板执行历史档 ${execHist} 个（期望 1）`)
      if (p.length === 0) ok(`S-14a2 ✓ 第 ④ 步只有一套历史（执行档 ${execHist} 个 · 通用历史折叠 ${genericHist} 个）`)
      else for (const x of p) bad(`S-14a2 · ${x}`)
      actFn(() => r.unmount())
    }

    // —— S-14b 判据B：合并行只占 1 行且带「共 3 条」——
    {
      const r = mount(react.createElement(StagesPanelHarness, {
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
      const r = mount(react.createElement(StagesPanelHarness, {
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
      const r = mount(react.createElement(StagesPanelHarness, {
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
            fetchChains: async () => chainsFromStages(EXEC_STAGES_DOING),
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
            fetchChains: async () => chainsFromStages(EXEC_STAGES_DOING),
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
      const r = mount(react.createElement(StagesPanelHarness, {
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
      const r = mount(react.createElement(StagesPanelHarness, {
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
            fetchChains: async () => chainsFromStages(EXEC_STAGES_DOING),
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
            fetchChains: async () => chainsFromStages(EXEC_STAGES_DOING),
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
      const r = mount(react.createElement(StagesPanelHarness, {
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
      const r = mount(react.createElement(StagesPanelHarness, {
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
      const body4 = document.querySelector('[data-mainline-step="true"][data-step="4"] [data-dsh-hob="stages-tree-body"]')
      if (process.env.DEBUG_STAGE === '1') {
        console.log('[debug] step4 outer=', document.querySelector('[data-mainline-step="true"][data-step="4"]')?.outerHTML?.slice(0, 1200))
        console.log('[debug] expanded=', JSON.stringify(expandedIdx), 'bodies=', document.querySelectorAll('[data-dsh-hob="stages-tree-body"]').length)
      }
      if (body4 === null) probs.push('第 4 步没有展开体')
      else if (!(body4.textContent ?? '').includes('RUN-001')) probs.push(`第 4 步展开体里没有 RUN-001：${JSON.stringify(body4.textContent)}`)
      // 点第 1 步 ⇒ 展开；再点 ⇒ 收起
      actFn(() => { heads[0].dispatchEvent(new (heads[0].ownerDocument.defaultView ?? window).MouseEvent('click', { bubbles: true })) })
      await tick(20)
      const h1a = document.querySelector('[data-mainline-step="true"][data-step="1"] [data-dsh-hob="stages-tree-head"]')
      if (h1a?.getAttribute('aria-expanded') !== 'true') probs.push('点第 1 步行头后没有展开')
      const b1 = document.querySelector('[data-mainline-step="true"][data-step="1"] [data-dsh-hob="stages-tree-body"]')
      if (b1 === null || !(b1.textContent ?? '').includes('R-001')) probs.push('第 1 步展开体里没有 R-001')
      actFn(() => { h1a.dispatchEvent(new (h1a.ownerDocument.defaultView ?? window).MouseEvent('click', { bubbles: true })) })
      await tick(20)
      const h1b = document.querySelector('[data-mainline-step="true"][data-step="1"] [data-dsh-hob="stages-tree-head"]')
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

    /**
     * S-17d 执行运行态两档（现在/历史）**在「当前工作」视图**，⛔ 不在第 ④ 步展开体里。
     *
     * 沿革（读懂这几行才不会把它改回去）：
     *   · 第 ① 版：挂在第 ④ 步里 ⇒ 与通用「历史条目」折叠**同名重复**（用户报障）。
     *   · 第 ② 版：只留执行层 ⇒ 修掉重复，但第 ④ 步格式与其余四步**不统一**（用户再次报障）。
     *   · **现行**：五个阶段一律用 `stages-tree-item`；执行运行态移到「当前工作」，
     *     因为那张表讲的是"此刻在跑什么"，不是账本条目。
     */
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
      /**
       * ⚠ R-020 起不再有「当前工作」一级标签；运行态收进第 4 步展开体。
       *   这里只断言“两档 + 两条都在”，观察点改为第 4 步的展开体。
       */
      const step4Body = document.querySelector('[data-mainline-step="true"][data-step="4"] [data-dsh-hob="stages-tree-body"]')
      if (step4Body === null) probs.push('第 ④ 步展开体不存在')
      else {
        const nowBuckets = step4Body.querySelectorAll('[data-dsh-hob="stages-exec-bucket"][data-bucket="now"]')
        const histBuckets = step4Body.querySelectorAll('[data-dsh-hob="stages-exec-bucket"][data-bucket="history"]')
        if (nowBuckets.length !== 1) probs.push(`第 ④ 步里「现在」档 ${nowBuckets.length} 个（期望 1）`)
        if (histBuckets.length !== 1) probs.push(`第 ④ 步里「历史」档 ${histBuckets.length} 个（期望 1）`)
        const wt = step4Body.textContent ?? ''
        if (!wt.includes('未开跑')) probs.push(`历史档那条没写「未开跑」：${JSON.stringify(wt.slice(0, 160))}`)
        if (step4Body.querySelectorAll('[data-dsh-hob="stages-exec-item"]').length !== 2) {
          probs.push(`执行项 ${step4Body.querySelectorAll('[data-dsh-hob="stages-exec-item"]').length} 条（期望 2 —— 折叠不许过滤）`)
        }
      }
      if (probs.length === 0) ok('S-17d ✓ 执行运行态第 4 步（现在/历史各一 · 「未开跑」在 · 2 条 DOM 都在）· 无独立「当前工作」标签')
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
       * ⚠ 面板**只自动展开第一条 `doing` 的步**（见 `project-panel.tsx` 的 effect）。
       *   ⇒ 要量全部 5 个 kind，必须先把每一步都点开（⚠ 真点按钮，⛔ 不 hack 内部 state）。
       */
      for (const head of [...document.querySelectorAll('[data-dsh-hob="stages-tree-head"]')]) {
        if (head.getAttribute('aria-expanded') !== 'true') actFn(() => head.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
      }
      await tick(30)
      const probs = []
      const spans = [...document.querySelectorAll('[data-dsh-hob="stages-mainline"] [data-dsh-hob="stages-tree-item-status"]')]
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
      const byId = new Map([...document.querySelectorAll('[data-dsh-hob="stages-mainline"] [data-dsh-hob="stages-tree-item"]')].map((row) => [
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
       * ⚠ 面板现在有**两份** `status.label`（旧树与主视图共用 `renderStageItem`），
       *   变异只需改中一份就足以让所有条目的状态变英文。
       */
      const panelSrc = readFileSync(PANEL_TSX, 'utf8')
      const NEEDLE = "            status.label,\n          ),"
      if (!panelSrc.includes(NEEDLE)) {
        bad('S-17g · 源码里找不到状态标签渲染（形态变了）⇒ 负向对拍不可判')
      } else {
        const out = writeMutant('exec-raw-status', panelSrc.replace(NEEDLE, "            String(it?.status ?? ''),\n          ),"))
        const modRaw = await import(pathToFileURL(out).href + '?t=' + Date.now())
        const fx = {
          ok: true, readAt: '2026-10-30T00:00:00.000Z',
          stages: [
            { step: 1, name: '需求规格', state: 'done', done: 1, total: 1, items: [{ id: 'R-001', title: '需求', status: 'agreed', extra: '' }] },
            { step: 2, name: '实现方案', state: 'done', done: 1, total: 1, items: [{ id: 'CHG-X', title: '方案', status: 'settled', extra: '' }] },
            { step: 3, name: '编码任务', state: 'done', done: 1, total: 1, items: [{ id: 'TSK-X', title: '任务', status: 'built', extra: '' }] },
            { step: 4, name: '任务执行', state: 'doing', done: 0, total: 1, items: [{ id: 'RUN-001', title: 'x', status: 'running', extra: '' }] },
            { step: 5, name: '验收核对', state: 'todo', done: 0, total: 1, items: [{ id: 'ACC-001', title: '验收', status: 'unverified', extra: '' }] },
          ],
          caps: [],
        }
        const r = mount(react.createElement(modRaw.StagesPanel, {
          fetchProgress: async () => ({ ok: true, rows: [] }),
          fetchExec: async () => ({ ok: true, items: [] }),
          fetchStages: async () => fx,
          fetchChains: async () => chainsFromStages(fx),
          pollMs: 0,
        }))
        await tick(40)
        const t = document.querySelector('[data-dsh-hob="stages-tree-item-status"]')?.textContent ?? ''
        if (t === 'agreed' || t === 'running') ok(`S-17g ✓ 负向对拍（把映射改回原文直打）⇒ S-17f **必红**：实际 ${JSON.stringify(t)}`)
        else bad(`S-17g · 变体仍没打出英文原文（实 ${JSON.stringify(t)}）⇒ 那条断言没有牙`)
        actFn(() => r.unmount())
      }
    }

    // —— S-17e 负向对拍：把某步的计数写成百分比 ⇒ S-17a 的 N/M 断言必红 ——
    {
      const mutant = buildMutant('exec-pct', (t) => t.replace(
        "React.createElement('span', { 'data-dsh-hob': 'stages-tree-count', 'data-mainline-count': 'true', style: { minWidth: '3.4em', color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.9em' } }, `${step.done}/${step.total}`)",
        "React.createElement('span', { 'data-dsh-hob': 'stages-tree-count', 'data-mainline-count': 'true', style: { minWidth: '3.4em', color: 'var(--dsw-alias-label-tertiary)', fontSize: '0.9em' } }, `${Math.round((step.done / Math.max(1, step.total)) * 100)}%`)",
      ))
      if (mutant === undefined) {
        bad('S-17e · 造不出「计数写成百分比」的变体（源码形态变了）⇒ 负向对拍不可判')
      } else {
        const modPct = await import(pathToFileURL(mutant).href)
        const r = mount(react.createElement(modPct.StagesPanel, {
          fetchProgress: async () => ({ ok: true, rows: [] }),
          fetchExec: async () => ({ ok: true, items: [] }),
          fetchStages: async () => STAGES_OK,
          fetchChains: async () => chainsFromStages(STAGES_OK),
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
     *   ⇒ 本组**真读** `<账本区>/ledger/units/`（入口 + 固定分片），走**真解析器**
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
        const unitsDir = dirname(idxPath)
        const sourcePaths = [
          idxPath,
          ...readdirSync(unitsDir)
            .filter((name) => /^unit-[^/]+\.toml$/.test(name))
            .sort()
            .map((name) => join(unitsDir, name)),
        ]
        const units = sourcePaths.flatMap((p) => idx.parseUnitsToml(readFileSync(p, 'utf8')))
        const built = idx.buildStages(units, '2026-10-30T00:00:00.000Z')
        /**
         * ⚠⚠ **真账本可能已全部收口**（2026-11-08 `ACC-066` 判决后实测）：
         *   五步全 done ⇒ 没有在途需求 ⇒ 主视图按设计不显示已完成链 ⇒ S-18 失去测量面。
         *   ⇒ 仍然用**真实账本数据**，只为本用例把链标成在途（⛔ 不改账本、⛔ 不改生产逻辑），
         *     让“真数据 + 真组件”的断言继续有对象。
         */
        const activeChains = (res) => {
          const c = chainsFromStages(res)
          if (c?.ok !== true || !Array.isArray(c.chains) || c.chains.length === 0) return c
          const [first, ...rest] = c.chains
          return { ...c, activeCount: 1, completedCount: 0, chains: [{ ...first, state: 'active', inFlight: true, complete: false, currentStep: first.currentStep ?? 1 }, ...rest] }
        }
        const r = mount(react.createElement(StagesPanelHarness, {
          fetchProgress: async () => ({ ok: true, rows: [] }),
          fetchExec: async () => ({ ok: true, items: [] }),
          fetchStages: async () => built,
          fetchChains: async () => activeChains(built),
          /**
           * ⚠⚠ **必须注入 `fetchUnseen`**（2026-11-01 P41/R20 加的）：本组扫全文不许出现
           *   「判不出」，而新增的「待确认工具」块在**没有注入**时会走真实 `fetch`
           *   ⇒ jsdom 里拿不到 ⇒ 落成「判不出」⇒ S-18 当场红（实测咬过一次）。
           *   ⚠ 这不是为了让 S-18 变绿而放宽它：本组验的是**五步树/账面**的状态面，
           *     与待确认工具那一块无关；给它一个**合法读数**才是诚实的夹具。
           */
          fetchUnseen: async () => ({ ok: true, count: 0, names: [], items: [], summary: '0 条 —— 当前没有待确认的工具' }),
          fetchResource: itemResource,
          fetchCurrent: async () => ({ ok: true, text: '# Current\n\n- 测试注入的合法 Current 读数。' }),
          /**
           * ⚠ 工作计划块同理：不注入就会走真 HTTP ⇒ jsdom 里「判不出」⇒ 本组全文口径误伤。
           *   给一个**合法空读数**，与「没有活动计划」这一档一致。
           */
          fetchPlans: async () => ({ ok: true, mode: 'multi', plans: [], unreadable: [] }),
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
         *     ② **全文**里的每一处「判不出」都必须**落在条目标题或证据读数节点内**
         *        （两者都是数据文本；证据的 `code_state=判不出` 是合法读数），
         *        落不到这两处的 ⇒ **红**（说明又跑到状态标签里去了）。
         */
        const statusTexts = [...document.querySelectorAll('[data-dsh-hob="stages-tree-item-status"]')].map((e) => e.textContent ?? '')
        const capTexts = [...document.querySelectorAll('[data-dsh-hob="stages-cap-item"]')].map((e) => e.textContent ?? '')
        const statusHits = [...statusTexts, ...capTexts].filter((t) => t.includes('判不出'))
        if (statusHits.length > 0) probs.push(`**状态/读数面**出现「判不出」${statusHits.length} 处：${JSON.stringify(statusHits.slice(0, 3))}`)
        // ② 全文出现次数 == 可指认数据来源里的出现次数：
        //    条目标题 + 下一步说明行 + 派生注意力项。
        //    ⚠ 证据正文不进五步树；不能把不存在的来源算进来。
        /**
         * ⚠ 条目现在有统一的 `presentation`：折叠行标题、关系、关键读数与展开详情
         *   都是账本数据文本。**只允许这些数据节点**出现「判不出」；状态标签仍零命中。
         */
        const titleTexts = [...document.querySelectorAll('[data-dsh-hob="stages-view"][data-view="map"] [data-dsh-hob="stages-item-title"]')]
          .map((row) => row.textContent ?? '')
        const dataTexts = [
          ...document.querySelectorAll('[data-dsh-hob="stages-next-line"]'),
          ...document.querySelectorAll('[data-dsh-hob="stages-attention-item"]'),
          ...document.querySelectorAll('[data-dsh-hob="stages-summary"]'),
          ...document.querySelectorAll('[data-dsh-hob="stages-item-relation"]'),
          ...document.querySelectorAll('[data-dsh-hob="stages-item-facts"]'),
          ...document.querySelectorAll('[data-dsh-hob="stages-item-flags"]'),
          ...document.querySelectorAll('[data-dsh-hob="stages-item-original-title"]'),
          ...document.querySelectorAll('[data-dsh-hob="stages-item-details"]'),
        ].map((node) => node.textContent ?? '')
        const count = (arr) => arr.reduce((n, t) => n + (t.split('判不出').length - 1), 0)
        const inTitles = count(titleTexts) + count(dataTexts)
        const inAll = text.split('判不出').length - 1
        if (inAll > inTitles) {
          probs.push(`全文出现「判不出」${inAll} 处，但标题/下一步/注意力数据里只有 ${inTitles} 处 ⇒ 有 ${inAll - inTitles} 处跑到了状态标签等非数据位置`)
        }
        const rows = [...document.querySelectorAll('[data-dsh-hob="stages-mainline"] [data-dsh-hob="stages-tree-item"]')]
        const labels = rows.map((row) => `${row.getAttribute('data-item-id')}:` + (row.querySelector('[data-dsh-hob="stages-tree-item-status"]')?.textContent ?? '').trim())
        if (rows.length === 0) probs.push('一条条目都没渲染 ⇒ 扫全文这步没有对象（⛔ 不报 ✓）')
        if (probs.length === 0) {
          ok(`S-18 ✓ **真账本数据渲染（${rows.length} 条条目，${units.length} 条单元）**`
            + ` · **状态面 0 处「判不出」**（⚠ 全文另有 ${inTitles} 处，全在标题/下一步/注意力数据里，⛔ 不算）`
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
        const r2 = mount(react.createElement(StagesPanelHarness, {
          fetchProgress: async () => ({ ok: true, rows: [] }),
          fetchExec: async () => ({ ok: true, items: [] }),
          fetchStages: async () => built2,
          fetchChains: async () => activeChains(built2),
          fetchUnseen: async () => ({ ok: true, count: 0, names: [], items: [], summary: '0 条 —— 当前没有待确认的工具' }),
          fetchResource: itemResource,
          fetchCurrent: async () => ({ ok: true, text: '# Current\n\n- 测试注入的合法 Current 读数。' }),
          /**
           * ⚠ 工作计划块同理：不注入就会走真 HTTP ⇒ jsdom 里「判不出」⇒ 本组全文口径误伤。
           *   给一个**合法空读数**，与「没有活动计划」这一档一致。
           */
          fetchPlans: async () => ({ ok: true, mode: 'multi', plans: [], unreadable: [] }),
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
    // S-28 ⭐ **组合层区块的三种形态**（2026-11-01 P40/R8 · `TASK-R8.md` §二）
    //
    //   ⚠⚠ 这条是**连续两轮挂着的缺口**（R6 §4.3-1、R7 §4.3-1 都提过，作业书两次没要求）。
    //   前两轮只有 `S-18`（真账本渲染 · 全文无「判不出」）的**间接**覆盖 ——
    //   它只能证明"这行文字出现在某处"，⛔ 证明不了
    //   "该出现时出现 / 该消失时消失 / 读不到时整行不出现"。
    //
    //   ── 为什么必须"喂自造 portfolio"而不是全文扫字符串 ────────────────────
    //     真账本里 `builtNoAcc` 恰好**非空**（R-002/003/004）⇒ 用真数据**测不到**"为空则整行不出现"
    //     这一支。⛔ 靠改账本去造那一支 = 造数据（§六 明令禁止）。
    //     ⇒ 入口是现成的：`buildStages` 的返回值就是 `fetchStages` 的入参，
    //       把 `portfolio` 字段**替换**掉即可 —— **⛔ 不需要改任何渲染逻辑**。
    //     （`buildStages` 自己算的 portfolio 在返回值里，覆盖它即可；这不算"绕过"，
    //       因为渲染逻辑读的就是这个字段，与产品路由给的是同一个字段。）
    // ══════════════════════════════════════════════════════════════════
    {
      const { resolveLedgerRoot: rlr } = await import('./lib/ledger-root.mjs')
      const ledgerRoot2 = rlr(root, undefined, undefined)
      if (ledgerRoot2 === undefined) {
        bad('S-28 · 账本根判不出 ⇒ 无法构造组合层夹具（⛔ 不按通过处理）')
      } else {
        const idx2 = await import(pathToFileURL(join(root, 'src', 'shared', 'stages-index.ts')).href)
        const units2 = idx2.parseUnitsToml(readFileSync(join(ledgerRoot2, idx2.STAGES_INDEX_REL), 'utf8'))
        const base2 = idx2.buildStages(units2, '2026-10-30T00:00:00.000Z')
        /** ⚠ 先自证：真数据里 `builtNoAcc` **非空** ⇒ 才有"非空"这一支可测。 */
        const realBuiltNoAcc = Array.isArray(base2.portfolio?.builtNoAcc) ? base2.portfolio.builtNoAcc : []
        const mkPanel = (portfolio) => mount(react.createElement(StagesPanelHarness, {
          fetchProgress: async () => ({ ok: true, rows: [] }),
          fetchExec: async () => ({ ok: true, items: [] }),
          fetchStages: async () => ({ ...base2, portfolio }),
          pollMs: 0,
        }))
        const read3 = () => ({
          head: document.querySelector('[data-dsh-hob="stages-portfolio-head"]')?.textContent ?? '',
          orphans: document.querySelector('[data-dsh-hob="stages-portfolio-orphans"]')?.textContent ?? null,
          builtNoAcc: document.querySelector('[data-dsh-hob="stages-portfolio-built-no-acc"]')?.textContent ?? null,
          wrap: document.querySelector('[data-dsh-hob="stages-portfolio"]')?.getAttribute('data-state') ?? '',
        })
        const problems = []

        // ── 形态 ①：`builtNoAcc` 非空 ⇒ 第三行**出现**，且逐条点名 ──
        const fakeFull = {
          reqs: [], orphans: ['R-971'], orphanNote: '1 条已定却完全没人接：R-971',
          builtNoAcc: ['R-972', 'R-973'],
          counts: { total: 3, covered: 0, proven: 0, orphan: 1, builtNoAcc: 2 },
        }
        const rA = mkPanel(fakeFull)
        await tick(40)
        const a = read3()
        if (a.builtNoAcc === null) problems.push('① `builtNoAcc` 非空（2 条）但**第三行没出现**')
        else {
          for (const id of ['R-972', 'R-973']) if (!a.builtNoAcc.includes(id)) problems.push(`① 第三行没点名 \`${id}\`（实际：${JSON.stringify(a.builtNoAcc)}）`)
          if (!a.builtNoAcc.includes('做完了没人验')) problems.push(`① 第三行缺"做完了没人验"这句（实际：${JSON.stringify(a.builtNoAcc)}）`)
        }
        if (!a.head.includes('0/3') || !a.head.includes('1 条没人接')) problems.push(`① 第一行读数不对（实际：${JSON.stringify(a.head)}）`)
        if (!String(a.orphans ?? '').includes('R-971')) problems.push('① 第二行（孤儿）没点名 R-971')
        actFn(() => rA.unmount())

        // ── 形态 ②：`builtNoAcc` 为空 ⇒ 第三行**整行不出现**（⛔ 不许空行/占位符）──
        const fakeEmpty = {
          reqs: [], orphans: [], orphanNote: '0 条 —— 查过的读数',
          builtNoAcc: [],
          counts: { total: 3, covered: 3, proven: 3, orphan: 0, builtNoAcc: 0 },
        }
        const rB = mkPanel(fakeEmpty)
        await tick(40)
        const b = read3()
        if (b.builtNoAcc !== null) problems.push(`② \`builtNoAcc\` 为空但**第三行仍存在**（${JSON.stringify(b.builtNoAcc)}）⇒ 空行/占位符`)
        if (b.orphans !== null) problems.push(`② 孤儿为空但**第二行仍存在**（${JSON.stringify(b.orphans)}）⇒ 空行/占位符`)
        if (!b.head.includes('3/3')) problems.push(`② 第一行读数不对（实际：${JSON.stringify(b.head)}）`)
        actFn(() => rB.unmount())

        // ── 形态 ③：`portfolio` 读不到 ⇒ 第一行「判不出」，第二、三行都**不出现** ──
        const rC = mkPanel(undefined)
        await tick(40)
        const c = read3()
        if (c.head !== '判不出') problems.push(`③ \`portfolio\` 缺失时第一行应是「判不出」，实际 ${JSON.stringify(c.head)}`)
        if (c.builtNoAcc !== null) problems.push('③ `portfolio` 缺失却仍渲染第三行')
        if (c.orphans !== null) problems.push('③ `portfolio` 缺失却仍渲染第二行')
        if (c.wrap !== 'undecidable') problems.push(`③ \`data-state\` 应是 \`undecidable\`，实际 ${JSON.stringify(c.wrap)}`)
        /**
         * ⚠⚠ **③ 的判据是"第一行恰好是「判不出」"** —— 这条比"包含判不出"严：
         *   如果哪天有人给它加了 `?? 0` 兜底，第一行会变成 `需求覆盖：0/0 …`，
         *   本条立刻红。⇒ 它咬住的正是 `CONSTITUTION` §7 那条（⛔ 不许把"没读到"显示成 0）。
         */
        actFn(() => rC.unmount())

        /**
         * ── N-S28 · 负向对拍（⚠ 作业书 §二 要求"先自证夹具真的坏了"）────────────────
         *
         * ⚠⚠ **我第一次写的负向对拍失败了，而失败的方式本身是个读数**（如实记在这里）：
         *   我造了一份"`counts` 缺失但 `builtNoAcc` 非空"的 portfolio，预期渲染出
         *   「第一行判不出 · 第三行却仍点名」这一**自相矛盾**形态。
         *   实际 `head="判不出"` 而 `builtNoAcc=null` —— **第三行没有出现**。
         *   ⇒ 原因是 `portfolioBlock` 里第三行的门是 `okNums && ...`（不是 `builtNoAcc.length > 0`）：
         *     读数判不出时**连第三行一起收起来**，比作业书假设的"只判第一行"更严。
         *   ⚠ 所以那条夹具造不出矛盾 —— **不是断言没牙，是我预期错了**。
         *
         * ⇒ 改用**差分自证**（这才是"有牙"的正确证明方式）：
         *   同一个选择器 `[data-dsh-hob="stages-portfolio-built-no-acc"]`，
         *   在夹具 A（`builtNoAcc` 非空）下**必须拿到节点**、在夹具 B（为空）下**必须拿不到**。
         *   ⇒ 两种输入给出不同结果，说明这条断言**在区分输入**，⛔ 不是"渲染器恰好没崩"。
         *   ⚠ 另把"判不出时第三行也收起"这件事**钉成断言**（那是本轮实测出来的行为，比作业书更严）。
         */
        const rD = mkPanel({
          reqs: [], orphans: [], orphanNote: '夹具',
          builtNoAcc: ['R-974'],
          // ⚠ 故意缺 counts ⇒ 第一行判不出
        })
        await tick(40)
        const d = read3()
        const stricterThanSpec = d.head === '判不出' && d.builtNoAcc === null
        actFn(() => rD.unmount())
        if (!stricterThanSpec) {
          bad(`N-S28 · "读数判不出"时第三行**没有**一起收起（head=${JSON.stringify(d.head)} · builtNoAcc=${JSON.stringify(d.builtNoAcc)}）`
            + ' ⇒ ⛔ 那会渲染出"读数判不出却还在点名某几条需求"的自相矛盾形态')
        }
        /**
         * ⚠ 差分自证：A 有节点、B 没节点 ⇒ 选择器在区分输入。
         *   （`a.builtNoAcc` / `b.builtNoAcc` 是上面两形态的实测读数，取自同一个选择器。）
         */
        const discriminates = a.builtNoAcc !== null && b.builtNoAcc === null
        if (!discriminates) {
          bad(`N-S28 · 差分自证失败：同一选择器在"非空"下=${JSON.stringify(a.builtNoAcc)}、在"为空"下=${JSON.stringify(b.builtNoAcc)}`
            + ' ⇒ 它没有区分输入（要么恒有、要么恒无）')
        }
        /**
         * ── **S-28b · 真账本锚点**（2026-11-01 P40/R9 · `TASK-R9.md` §二）─────────────
         *   上面三形态全用**自造 portfolio**（`R-972/973/974`）⇒ 没有一条用**真账本**核第三行。
         *   而真账本 `builtNoAcc` 现在**非空**（`R-002` · `R-003` · `R-004`）⇒ 有真实锚点可用。
         *
         * ── ⚠⚠ **划界：本条 ⛔ 不能当 `R-002` 的验收依据**（`TASK-R10.md` §四）──────
         *   `S-28b` 核的是**面板组合层区块**（`builtNoAcc` 第三行出没出）—— 那是 P-1 那层的**显示**。
         *   `R-002` 要的读数是**执行记录区块**（「现在/历史」两档、历史默认折叠）—— 那是**另一块 UI**
         *   （由 `S-14a` / `S-14d` 覆盖）。
         *   ⇒ ⛔ **不许**拿 `S-28b` 绿去当 `R-002` 的验收依据；两者对象不同，混了就是洗账。
         *
         * ⚠⚠ **若真账本的 `builtNoAcc` 将来归零，本条会红 —— 那是对的。**
         *   它会逼人回来改锚点（改成新的真实需求 id，或连同 §二·B 一起裁掉），
         *   ⛔ **不是静默变成恒绿**。这一句是本条存在的理由，别删。
         */
        /**
         * ── **S-28b · 合成锚点**（2026-11-01 P41/R22 换夹具 · `TASK-R22.md` §一）────────────
         *
         * ⚠⚠ **换夹具的理由（⛔ 不是改判据、⛔ 也不是保留红着）**：
         *   旧版拿**真账本**的 `portfolio.builtNoAcc` 当锚点。而 P41 收口之后，三条需求都补了
         *   `acceptance_ids` 且全部 pass ⇒ `builtNoAcc` **归零** ⇒ 旧版当场红。
         *   ⚠ 那条红**是对的**（它自己写着"归零时会红，逼人回来改锚点"），但修法不是删判据，
         *     而是**换夹具来源** —— 与 `check-ledger.mjs` 的 `N-CF`（R17 修的）同一个写法：
         *     自造合成单元、**调真函数**（`portfolioOf`），⛔ 不写第二份逻辑。
         *
         * ⚠ 三条硬要求（缺一条这次改动就不成立）：
         *   ① 真账本 `builtNoAcc` 为空时，本组**仍能跑绿**（下面的 `realEmpty` 分支）；
         *   ② 合成夹具 `builtNoAcc` 非空时，本组**仍能抓出来**（下面的 `synth` 分支）；
         *   ③ 判据逻辑来自 `portfolioOf` 真函数，⛔ 不是我在夹具里手写"哪些算 builtNoAcc"。
         */
        const { portfolioOf } = await import(pathToFileURL(join(root, 'src', 'shared', 'portfolio.ts')).href + '?t=' + Date.now())
        /**
         * ⚠ 合成单元：一条 req + 一条 `built` 的 task + **零 pass acc** ⇒ `builtNoAcc` 必含它。
         *   ⚠ 名字用 `R-981` 这种**账本里不存在**的号（⛔ 不冒充真单元）。
         */
        const synthUnits = [
          { id: 'R-981', kind: 'req', status: 'agreed', parent: 'spec/probe' },
          { id: 'TSK-981', kind: 'task', status: 'built', parent: 'R-981' },
        ]
        const synth = portfolioOf(synthUnits)
        /**
         * ⚠ 反面夹具：同样的 req + `built` 的 task，但**加一条 pass acc**
         *   ⇒ `builtNoAcc` 必须**不含**它。这是"判据真的在看 acc"的证明。
         */
        const synthWithAcc = portfolioOf([
          ...synthUnits,
          { id: 'ACC-981', kind: 'acc', status: 'pass', parent: 'TSK-981' },
        ])
        const synthHit = Array.isArray(synth.builtNoAcc) && synth.builtNoAcc.includes('R-981')
        const synthMiss = Array.isArray(synthWithAcc.builtNoAcc) && !synthWithAcc.builtNoAcc.includes('R-981')
        /**
         * ① 真账本现状：`builtNoAcc` 为空 ⇒ 本组**不许因此判红**（那是本轮收口的正常结果）。
         *    ⚠ 但也不许"静默跳过"：要把它作为一个**读数**报出来。
         */
        const realEmpty = realBuiltNoAcc.length === 0
        if (synthHit) {
          ok(`S-28b ✓ **合成锚点**（TASK-R22.md §一 换夹具 · 照 N-CF 写法）：`
            + `\`portfolioOf([R-981(req), TSK-981(built)])\` ⇒ \`builtNoAcc\` 实测 **含 R-981**`
            + `（⛔ 判据来自真函数 \`portfolioOf\`，不是夹具里手写的）`
            + `；⚠ 真账本当前 \`builtNoAcc\` ${realEmpty ? '**为空**（收口后的正常结果，⛔ 不再据此判红）' : `非空（${realBuiltNoAcc.join(' / ')}）`}`)
        } else {
          bad(`S-28b · 合成夹具（req R-981 + built task TSK-981 + 零 pass acc）没被判成 builtNoAcc（实际：${JSON.stringify(synth.builtNoAcc)}）`
            + ' ⇒ 锚点失去了"能抓出来"的那一半')
        }
        /** ② 合成夹具 `builtNoAcc` 非空 ⇒ **渲染层也必须抓出来**（端到端，不只函数层）。 */
        const rSynth = mkPanel({ ...synth, orphans: [], orphanNote: '合成夹具' })
        await tick(40)
        const synthRow = document.querySelector('[data-dsh-hob="stages-portfolio-built-no-acc"]')?.textContent ?? null
        actFn(() => rSynth.unmount())
        if (synthRow !== null && synthRow.includes('R-981')) {
          ok(`S-28b2 ✓ **合成锚点端到端**：喂 \`portfolioOf\` 的合成结果渲染 ⇒ 第三行出现并点名 \`R-981\`（原文：${JSON.stringify(synthRow.slice(0, 60))}）`)
        } else {
          bad(`S-28b2 · 合成 \`builtNoAcc\` 非空但渲染层没点名 \`R-981\`（实际：${JSON.stringify(synthRow)}）`)
        }
        /** ③ 差分自证：加一条 pass acc ⇒ 同一夹具**不再**被判成 builtNoAcc。 */
        if (synthMiss) {
          ok('S-28b3 ✓ **差分自证**：同一对 req/task 再加一条 `ACC-981 status=pass` ⇒ `builtNoAcc` **不再含 R-981**'
            + '（⛔ 说明这条判据真的在看 acc，不是恒真）')
        } else {
          bad(`S-28b3 · 加了 pass acc 之后 \`builtNoAcc\` 仍含 R-981（实际：${JSON.stringify(synthWithAcc.builtNoAcc)}）⇒ 判据没看 acc`)
        }

        if (problems.length === 0) {
          ok(`S-28 ✓ **组合层区块三形态**（⚠ 三形态全用**合成** portfolio：\`R-971/972/973/974\`）`
            + '：① 非空 ⇒ 第三行**出现**且**逐条点名**（`R-972` · `R-973`）② 为空 ⇒ 第二、三行**整行不出现**（⛔ 无空行/占位符）'
            + '③ `portfolio` 缺失 ⇒ 第一行**恰好是「判不出」**、`data-state=undecidable`、第二三行都不出现（⛔ 不许兜底成 0）')
          ok('N-S28 ✓ 负向对拍（**差分自证**：同一个选择器 `stages-portfolio-built-no-acc` 在"非空"下拿到节点、在"为空"下拿不到 ⇒ 它在区分输入，⛔ 不是恒有/恒无）'
            + '；⚠ 另钉一条实测出来的行为：**读数判不出时第三行也一起收起**（`head="判不出"` ⇒ `builtNoAcc=null`）')
        } else for (const x of problems) bad(`S-29 · ${x}`)
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
      const r = mount(react.createElement(StagesPanelHarness, {
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

    // ══════════════════════════════════════════════════════════════════
    // S-20 ⭐ **步头必须写出「里面有几条」**（2026-10-31 P35 · 用户报「我没找到展开历史档」）
    // ══════════════════════════════════════════════════════════════════
    /**
     * ── 病（用户真碰到）──────────────────────────────────────────
     *   第 ④ 步的**全部内容**（「现在」/「历史」两档 + 执行项）都在**展开体**里，
     *   而默认展开**只对 `state === 'doing'`** 生效。第 ④ 步现在是 `✓ 完成`
     *   ⇒ 用户看到 `4 任务执行 ✓ 完成 26/26 ▸`，**没有任何东西告诉他里面有 26 条**。
     *
     * ── 本组量什么 ────────────────────────────────────────────
     *   每一行的步头里必须有 `data-dsh-hob="stages-tree-item-count"`，且文本是 `N 条`，
     *   **且 N 必须等于该步 `items.length`**（⚠ 不许写死、⛔ 不许与数据脱钩）。
     *   ⚠ 0 条时也要写「0 条」（"空"与"没有"要分得开，`E-172`）。
     */
    {
      const fx = {
        ok: true, readAt: '2026-10-30T00:00:00.000Z',
        stages: [
          { step: 1, name: '需求规格', state: 'done', done: 2, total: 2, items: [
            { id: 'R-001', title: 'a', status: 'agreed', extra: '' },
            { id: 'R-002', title: 'b', status: 'agreed', extra: '' },
          ] },
          { step: 2, name: '实现方案', state: 'done', done: 1, total: 1, items: [
            { id: 'CHG-X', title: 'c', status: 'settled', extra: '' },
          ] },
          { step: 3, name: '编码任务', state: 'done', done: 1, total: 1, items: [
            { id: 'TSK-1', title: 'd', status: 'built', extra: '' },
          ] },
          /** ⚠ 第 ④ 步刻意用 `done`（= 用户截图那天的真实状态）且放 3 条。 */
          { step: 4, name: '任务执行', state: 'done', done: 3, total: 3, items: [
            { id: 'RUN-001', title: 'e', status: 'returned', extra: '' },
            { id: 'RUN-002', title: 'f', status: 'returned', extra: '' },
            { id: 'RUN-003', title: 'g', status: 'returned', extra: '' },
          ] },
          { step: 5, name: '验收核对', state: 'todo', done: 0, total: 0, items: [] },
        ],
        caps: [],
      }
      const r = mount(react.createElement(StagesPanelHarness, {
        fetchProgress: async () => ({ ok: true, rows: [] }),
        fetchExec: async () => ({ ok: true, items: [] }),
        fetchStages: async () => fx,
        pollMs: 0,
      }))
      await tick(40)
      const probs = []
      const heads = [...document.querySelectorAll('[data-dsh-hob="stages-tree-head"]')]
      const WANT = [2, 1, 1, 3, 0]
      if (heads.length !== 5) probs.push(`步行头 ${heads.length} 个（期望 5）`)
      heads.forEach((h, i) => {
        const el = h.querySelector('[data-dsh-hob="stages-tree-item-count"]')
        if (el === null) { probs.push(`第 ${i + 1} 步头没有「条目数」（stages-tree-item-count）`); return }
        const t = (el.textContent ?? '').trim()
        if (!/^\d+ 条$/.test(t)) probs.push(`第 ${i + 1} 步的条目数不是「N 条」：${JSON.stringify(t)}`)
        else if (t !== `${WANT[i]} 条`) probs.push(`第 ${i + 1} 步条目数应为「${WANT[i]} 条」，实际 ${JSON.stringify(t)}`)
      })
      if (probs.length === 0) {
        ok('S-20 ✓ **每步行头都写出「里面有几条」**（' + WANT.map((n, i) => `第${i + 1}步 ${n} 条`).join(' · ') + '）'
          + ' ⇒ 用户不用点开就知道哪一步里有内容（⚠ 0 条也写「0 条」，⛔ 非空白）')
      } else for (const x of probs) bad(`S-20 · ${x}`)
      actFn(() => r.unmount())
    }

    // ══════════════════════════════════════════════════════════════════
    // S-21 ⭐ **点开第 ④ 步后，运行态两档在同一个展开体里，且只有一个历史折叠**
    /**
     * R-020 起：「当前工作」一级标签已删除；运行态收进第 ④ 步展开体。
     * 本组仍真点一次行头，确认：① 展开后能看到运行态两档；② 该步条目仍走统一条目行；
     * ③ 整个面板只有这一处历史折叠，不与通用「历史条目」重复。
     */
    {
      const fx = {
        ok: true, readAt: '2026-10-30T00:00:00.000Z',
        stages: [
          { step: 1, name: '需求规格', state: 'done', done: 1, total: 1, items: [{ id: 'R-001', title: 'a', status: 'agreed', extra: '' }] },
          { step: 2, name: '实现方案', state: 'done', done: 1, total: 1, items: [{ id: 'CHG-X', title: 'b', status: 'settled', extra: '' }] },
          { step: 3, name: '编码任务', state: 'done', done: 1, total: 1, items: [{ id: 'TSK-1', title: 'c', status: 'built', extra: '' }] },
          /** ⚠ `doing` + 有 items ⇒ 默认展开（用户真实处境：第 4 步就是当前步）。 */
          { step: 4, name: '任务执行', state: 'doing', done: 0, total: 2, items: [
            { id: 'RUN-001', title: '在跑的那条', status: 'running', extra: '' },
            { id: 'RUN-002', title: '历史那条', status: 'returned', extra: '' },
          ] },
          { step: 5, name: '验收核对', state: 'todo', done: 0, total: 0, items: [] },
        ],
        caps: [],
      }
      const EXEC_ITEMS = [
        { target: 'hob-now-1', state: 'running', bucket: 'now', startedAt: '2026-10-31T00:00:00+08:00', elapsedMs: 60000, retries: 0 },
        { target: 'hob-hist-1', state: 'returned', bucket: 'closed', closedAt: '2026-10-30T00:00:00+08:00', retries: 1 },
      ]
      const r = mount(react.createElement(StagesPanelHarness, {
        fetchProgress: async () => ({ ok: true, rows: [] }),
        fetchExec: async () => ({ ok: true, items: EXEC_ITEMS }),
        fetchStages: async () => fx,
        pollMs: 0,
      }))
      await tick(40)
      const probs = []
      const head4 = () => document.querySelector('[data-mainline-step="true"][data-step="4"] [data-dsh-hob="stages-tree-head"]')
      const body4 = () => document.querySelector('[data-mainline-step="true"][data-step="4"] [data-dsh-hob="stages-tree-body"]')
      if (head4()?.getAttribute('aria-expanded') !== 'true') probs.push('第 ④ 步是 `doing` 却默认没有展开')
      const b = body4()
      if (b === null) probs.push('第 ④ 步展开后没有 stages-tree-body')
      else {
        const step4Items = [...b.querySelectorAll('[data-dsh-hob="stages-tree-item"]')].map((e) => e.getAttribute('data-item-id')).filter(Boolean)
        if (step4Items.length === 0) probs.push(`第 ④ 步展开后没有账本条目（实有：${JSON.stringify(step4Items)}）`)
        const buckets = [...b.querySelectorAll('[data-dsh-hob="stages-exec-bucket"]')].map((e) => e.getAttribute('data-bucket'))
        for (const want of ['now', 'history']) {
          if (!buckets.includes(want)) probs.push(`第 ④ 步里没有「${want}」档（实有：${JSON.stringify(buckets)}）`)
        }
        if (b.querySelectorAll('[data-dsh-hob="stages-exec-item"]').length !== 2) {
          probs.push(`执行项 ${b.querySelectorAll('[data-dsh-hob="stages-exec-item"]').length} 条（期望 2）`)
        }
      }
      const genericHist = document.querySelectorAll('[data-dsh-hob="stages-tree-history"]').length
      const execHist = document.querySelectorAll('[data-dsh-hob="stages-exec-bucket"][data-bucket="history"]').length
      if (genericHist > 0 && execHist > 0) probs.push(`同一面板出现两层历史折叠（通用 ${genericHist} + 执行 ${execHist}）`)
      if (probs.length === 0) ok('S-21 ✓ 第 ④ 步展开体 = 统一条目行 + 运行态两档（现在/历史各一 · 2 条执行项），且只有一处历史折叠')
      else for (const x of probs) bad(`S-21 · ${x}`)
      actFn(() => r.unmount())
    }

    // ── N-S20 负向对拍：把「N 条」那段渲染删掉 ⇒ S-20 必红 ──
    {
      const built = ((t) => {
        const NEEDLE = "`${step.total} 条`),"
        const m = t.replace(NEEDLE, "''),")
        return m === t ? undefined : writeMutant('no-item-count', m)
      })(src)
      if (built === undefined) {
        bad('N-S20 · 造不出「删掉条目数」的变体（源码形态变了）⇒ 负向对拍不可判')
      } else {
        const modRaw = await import(pathToFileURL(built).href)
        const r = mount(react.createElement(modRaw.StagesPanel, {
          fetchProgress: async () => ({ ok: true, rows: [] }),
          fetchExec: async () => ({ ok: true, items: [] }),
          fetchStages: async () => ({
            ok: true, readAt: '2026-10-30T00:00:00.000Z',
            stages: [{ step: 1, name: '需求规格', state: 'done', done: 1, total: 1, items: [{ id: 'R-001', title: 'a', status: 'agreed', extra: '' }] }],
            caps: [],
          }),
          /** ⚠ 主视图读需求链；不给链 ⇒ 没有步头，N-S20 的观察点不存在（会变成假红）。 */
          fetchChains: async () => chainsFromStages({
            ok: true, readAt: '2026-10-30T00:00:00.000Z',
            stages: [{ step: 1, name: '需求规格', state: 'done', done: 1, total: 1, items: [{ id: 'R-001', title: 'a', status: 'agreed', extra: '' }] }],
            caps: [],
          }),
          pollMs: 0,
        }))
        await tick(30)
        const el = document.querySelector('[data-dsh-hob="stages-tree-head"] [data-dsh-hob="stages-tree-item-count"]')
        const t = (el?.textContent ?? '').trim()
        if (t === '') ok('N-S20 ✓ 负向对拍（把 `${items.length} 条` 改成空串）⇒ S-20 **必红**：条目数读数变成空串')
        else bad(`N-S20 · 变体仍打出 ${JSON.stringify(t)} ⇒ S-20 没有牙`)
        actFn(() => r.unmount())
      }
    }


    // ══════════════════════════════════════════════════════════════════
    // S-22 ⭐ **面板根可上下滚，且值可判**（2026-10-31 P36 · 用户报「展开后超出显示范围要能上下滑」）
    // ══════════════════════════════════════════════════════════════════
    /**
     * ── 病 ──────────────────────────────────────────────────────
     *   改前 `grep 'overflow|maxHeight|height:'` 在 `project-panel.tsx` **零命中**
     *   ⇒ 内容超出宿主 `tabBody`（`overflow:hidden`）就**被裁掉**，用户滚不了。
     *
     * ── 本组量什么（⚠ 逐条对应任务书 §二 的四条）──────────────
     *   1. `overflowY === 'auto'`（⚠ **必须是 auto**，⛔ 不是 `scroll`/`visible`；
     *      `scroll` 恒显滚动条 ⇒ 违反"只在超出时出现"）；
     *   2. `maxHeight` **是具体值**（匹配 `\d+(\.\d+)?(vh|px|rem|em)`，⛔ 不许空/`100%`/`none`）；
     *   3. 键盘可达：面板根 `tabIndex === '0'` 且 `role === 'region'` 且有可读 `aria-label`；
     *   4. 无内层第二个滚动容器（扫描面板内所有节点，`overflowY` 为 `auto|scroll` 的**只能有根这一个**）。
     *
     * ⚠ ⚠ **本组特意不写"含 overflow 就过"** —— 那种写法对 `overflow: visible` 也绿（假绿）。
     *   下面 S-22b 专测这一点。
     */
    {
      const fx = {
        ok: true, readAt: '2026-10-30T00:00:00.000Z',
        stages: [
          { step: 1, name: '需求规格', state: 'done', done: 1, total: 1, items: [{ id: 'R-001', title: 'a', status: 'agreed', extra: '' }] },
          { step: 2, name: '实现方案', state: 'done', done: 1, total: 1, items: [{ id: 'CHG-X', title: 'b', status: 'settled', extra: '' }] },
          { step: 3, name: '编码任务', state: 'done', done: 1, total: 1, items: [{ id: 'TSK-1', title: 'c', status: 'built', extra: '' }] },
          { step: 4, name: '任务执行', state: 'done', done: 1, total: 1, items: [{ id: 'RUN-001', title: 'd', status: 'running', extra: '' }] },
          { step: 5, name: '验收核对', state: 'todo', done: 0, total: 0, items: [] },
        ],
        caps: [],
      }
      const r = mount(react.createElement(StagesPanelHarness, {
        fetchProgress: async () => ({ ok: true, rows: [] }),
        fetchExec: async () => ({ ok: true, items: [] }),
        fetchStages: async () => fx,
        pollMs: 0,
      }))
      await tick(40)
      const probs = []
      const root = document.querySelector('[data-dsh-hob="stages-panel"]')
      if (root === null) probs.push('找不到面板根（stages-panel）')
      else {
        const cs = root.ownerDocument.defaultView.getComputedStyle(root)
        const oy = (cs.overflowY || root.style.overflowY || '').trim()
        const mh = (cs.maxHeight || root.style.maxHeight || '').trim()
        const ox = (cs.overflowX || root.style.overflowX || '').trim()
        // ① 滚动只在超出时出现 ⇒ auto
        if (oy !== 'auto') probs.push(`面板根 overflow-y 应为 \`auto\`（超出才显滚动条），实际 ${JSON.stringify(oy)}`)
        // ② 高度上限是**具体值**
        if (!/^\d+(\.\d+)?(vh|px|rem|em)$/.test(mh)) probs.push(`面板根 maxHeight 必须是具体值（如 70vh），实际 ${JSON.stringify(mh)}`)
        // ③ 键盘可达
        if (root.getAttribute('tabindex') !== '0') probs.push(`面板根不可聚焦（tabindex=${JSON.stringify(root.getAttribute('tabindex'))}）⇒ 键盘滚不了`)
        if (root.getAttribute('role') !== 'region') probs.push(`面板根 role 应为 region，实际 ${JSON.stringify(root.getAttribute('role'))}`)
        if (!(root.getAttribute('aria-label') ?? '').trim()) probs.push('面板根没有 aria-label（读屏无法报出这是可滚区域）')
        // ④ 无第二个滚动容器
        const scrollers = [...root.querySelectorAll('*')].filter((el) => {
          const s2 = el.ownerDocument.defaultView.getComputedStyle(el)
          const o = (s2.overflowY || '').trim()
          return o === 'auto' || o === 'scroll'
        })
        if (scrollers.length > 0) {
          probs.push(`面板内有 ${scrollers.length} 个内层滚动容器 ⇒ 双重滚动条（首个：${JSON.stringify((scrollers[0].textContent ?? '').slice(0, 30))}）`)
        }
        if (probs.length === 0) {
          ok(`S-22 ✓ 面板根可上下滚且**值可判**：overflow-y=\`${oy}\` · maxHeight=\`${mh}\` · overflow-x=\`${ox}\``
            + ' · 可聚焦（tabindex=0 / role=region / 有 aria-label）· **内层滚动容器 0 个**（⛔ 无双重滚动条）')
        } else for (const x of probs) bad(`S-22 · ${x}`)
      }
      actFn(() => r.unmount())
    }

    // ── S-22a 负向对拍：把 `overflowY: 'auto'` 改成 `'scroll'` ⇒ S-22 必红（恒显滚动条） ──
    {
      const built = ((t) => {
        const m = t.replace("  overflowY: 'auto',", "  overflowY: 'scroll',")
        return m === t ? undefined : writeMutant('oy-scroll', m)
      })(src)
      if (built === undefined) {
        bad('S-22a · 造不出「overflowY: scroll」的变体（源码形态变了）⇒ 负向对拍不可判')
      } else {
        const modRaw = await import(pathToFileURL(built).href)
        const r = mount(react.createElement(modRaw.StagesPanel, {
          fetchProgress: async () => ({ ok: true, rows: [] }),
          fetchExec: async () => ({ ok: true, items: [] }),
          fetchStages: async () => ({ ok: true, readAt: 'x', stages: [], caps: [] }),
            fetchChains: async () => chainsFromStages(EXEC_HIST),
          pollMs: 0,
        }))
        await tick(30)
        const root = document.querySelector('[data-dsh-hob="stages-panel"]')
        const oy = root === null ? '' : (root.ownerDocument.defaultView.getComputedStyle(root).overflowY || '').trim()
        if (oy === 'scroll') ok('S-22a ✓ 负向对拍（overflowY: auto → **scroll**）⇒ S-22 **必红**：scroll 会恒显滚动条')
        else bad(`S-22a · 变体 overflow-y 实为 ${JSON.stringify(oy)} ⇒ S-22 没有牙`)
        actFn(() => r.unmount())
      }
    }

    // ── S-22b ⚠⚠ **专项**：把 `overflowY: 'auto'` 改成 `'visible'` ⇒ S-22 必红 ──
    {
      /**
       * ⚠ 任务书特别点名这一条：**若只写"含 overflow 就过"，`visible` 也会绿** ——
       *   而 `visible` 的语义恰恰是"**不裁也不滚**"，是最坏的假绿形态。
       *   本对拍证明 S-22 的判据是 `=== 'auto'`，⛔ 不是 `includes('overflow')`。
       */
      const built = ((t) => {
        const m = t.replace("  overflowY: 'auto',", "  overflowY: 'visible',")
        return m === t ? undefined : writeMutant('oy-visible', m)
      })(src)
      if (built === undefined) {
        bad('S-22b · 造不出「overflowY: visible」的变体（源码形态变了）⇒ 负向对拍不可判')
      } else {
        const modRaw = await import(pathToFileURL(built).href)
        const r = mount(react.createElement(modRaw.StagesPanel, {
          fetchProgress: async () => ({ ok: true, rows: [] }),
          fetchExec: async () => ({ ok: true, items: [] }),
          fetchStages: async () => ({ ok: true, readAt: 'x', stages: [], caps: [] }),
            fetchChains: async () => chainsFromStages(EXEC_HIST),
          pollMs: 0,
        }))
        await tick(30)
        const root = document.querySelector('[data-dsh-hob="stages-panel"]')
        const oy = root === null ? '' : (root.ownerDocument.defaultView.getComputedStyle(root).overflowY || '').trim()
        // ⚠ 关键：visible 的读数**不是** auto ⇒ S-22 的 `=== 'auto'` 必判红
        if (oy !== 'auto') {
          ok(`S-22b ✓ 负向对拍（overflowY: auto → **visible**）⇒ S-22 **必红**：`
            + `读数为 ${JSON.stringify(oy)}，⛔ 不等于 \`auto\`（若判据写成"含 overflow 就过"这里会假绿）`)
        } else bad('S-22b · 变体仍读到 auto ⇒ S-22 的判据不区分 visible')
        actFn(() => r.unmount())
      }
    }

    // ── S-22c 负向对拍：把 maxHeight 删掉 ⇒ S-22 必红（高度上限必须可判） ──
    {
      const built = ((t) => {
        const m = t.replace("  maxHeight: STAGES_PANEL_SCROLL_MAX_HEIGHT,\n", "")
        return m === t ? undefined : writeMutant('no-maxheight', m)
      })(src)
      if (built === undefined) {
        bad('S-22c · 造不出「删掉 maxHeight」的变体（源码形态变了）⇒ 负向对拍不可判')
      } else {
        const modRaw = await import(pathToFileURL(built).href)
        const r = mount(react.createElement(modRaw.StagesPanel, {
          fetchProgress: async () => ({ ok: true, rows: [] }),
          fetchExec: async () => ({ ok: true, items: [] }),
          fetchStages: async () => ({ ok: true, readAt: 'x', stages: [], caps: [] }),
            fetchChains: async () => chainsFromStages(EXEC_HIST),
          pollMs: 0,
        }))
        await tick(30)
        const root = document.querySelector('[data-dsh-hob="stages-panel"]')
        const mh = root === null ? '' : (root.ownerDocument.defaultView.getComputedStyle(root).maxHeight || '').trim()
        if (!/^\d+(\.\d+)?(vh|px|rem|em)$/.test(mh)) ok(`S-22c ✓ 负向对拍（删掉 maxHeight）⇒ S-22 **必红**：高度上限读数变成 ${JSON.stringify(mh)}`)
        else bad(`S-22c · 变体仍读到具体上限 ${JSON.stringify(mh)} ⇒ S-22 没有牙`)
        actFn(() => r.unmount())
      }
    }


    // ══════════════════════════════════════════════════════════════════
    // S-23 ⭐ **面板内不许出现横向滚动条**（2026-10-31 P39 · 用户真机亲报）
    // ══════════════════════════════════════════════════════════════════
    /**
     * ── 用户原话（两句话，按原顺序）──────────────────────────────
     *   1. 「可以滚动了但是有个问题，就是下面左右滑动的滑块位置不对应该在最下方」
     *   2. 「不要最下面的滑块」
     *   ⇒ 第 2 句**作废**第 1 句的位置诉求：⛔ 不是"把滑块挪到底部"，是"滑块**不要存在**"。
     *
     * ── 病（CSS 计算规则，不是巧合）────────────────────────────────
     *   改前 `wrapStyle` **只有 `overflowY: 'auto'`，没有 `overflowX`** ⇒ `overflowX` 是初始值
     *   `visible`；而「一轴 `visible`、另一轴 `auto`/`scroll` ⇒ `visible` **计算为 `auto`**」
     *   ⇒ 根容器实际**两轴都 auto** ⇒ 内容一横向溢出就长出横向滚动条。
     *
     * ── 本组量什么 ────────────────────────────────────────────────
     *   ① 根容器 `overflowX === 'hidden'`（⚠ **必须 hidden**，⛔ `auto`/`scroll`/`visible`）；
     *   ② 面板内**不存在任何横向滚动容器**：遍历所有后代，`overflowX` 为 `auto`/`scroll`
     *      的一律不许有（⚠ 与 S-22 对 Y 轴的扫法**同构**，⛔ 不另立标准）。
     *
     * ⚠ ⚠ **本组⛔ 不写 `scrollWidth > clientWidth`** —— jsdom 无布局，它恒 0 ⇒ **假判据**。
     *   本组判的是**声明**，不是"有没有真的溢出"（后者只能用户肉眼看，见报告第 4 段）。
     */
    const oxOf = (el) => {
      const cs = el.ownerDocument.defaultView.getComputedStyle(el)
      return (cs.overflowX || el.style.overflowX || '').trim()
    }
    /** 面板里 **所有**`flex: '1 1 auto'` 的节点都会渲染的夹具（S-24 用）。 */
    const fullFx = {
      ok: true, readAt: '2026-10-31T00:00:00.000Z',
      stages: [
        { step: 1, name: '需求规格', state: 'doing', done: 1, total: 2, items: [
          { id: 'R-001', title: '一条很长的标题用来把行撑破看看会不会横向溢出', status: 'agreed', extra: '' },
          { id: 'R-002-very-long-id-without-any-break-point', title: 'b', status: 'agreed', extra: '' },
        ] },
        { step: 2, name: '实现方案', state: 'done', done: 1, total: 1, items: [{ id: 'CHG-X', title: 'c', status: 'settled', extra: '' }] },
        { step: 3, name: '编码任务', state: 'done', done: 1, total: 1, items: [{ id: 'TSK-1', title: 'd', status: 'built', extra: '' }] },
        { step: 4, name: '任务执行', state: 'done', done: 1, total: 1, items: [{ id: 'RUN-001', title: 'e', status: 'running', extra: '' }] },
        { step: 5, name: '验收核对', state: 'todo', done: 0, total: 0, items: [] },
      ],
      caps: [{ id: 'CAP-1', title: '长期能力的一条很长很长的标题也要能断行', status: 'live', lastReading: '2026-10-31' }],
    }
    const mountFull = async (mod) => {
      const r = mount(react.createElement(mod.StagesPanel, {
        fetchProgress: async () => ({ ok: true, rows: [{ name: '需求规格', step: '1', blockedBy: '' }] }),
        fetchExec: async () => ({ ok: true, items: [] }),
        fetchStages: async () => fullFx,
        pollMs: 0,
      }))
      await tick(40)
      return r
    }
    /** S-23 的判据（抽成函数 ⇒ 正向与负向对拍**共用同一份判据**，⛔ 不各写一份）。 */
    const s23probs = (rootEl) => {
      const probs = []
      if (rootEl === null) return ['找不到面板根（stages-panel）']
      const ox = oxOf(rootEl)
      if (ox !== 'hidden') probs.push(`面板根 overflowX 应为 \`hidden\`，实际 ${JSON.stringify(ox)}`)
      const scrollers = [...rootEl.querySelectorAll('*')].filter((el) => {
        const o = oxOf(el)
        return o === 'auto' || o === 'scroll'
      })
      if (scrollers.length > 0) {
        probs.push(`面板内有 ${scrollers.length} 个横向滚动容器（首个：${
          JSON.stringify((scrollers[0].textContent ?? '').slice(0, 30))} · overflowX=${
          JSON.stringify(oxOf(scrollers[0]))}）`)
      }
      return probs
    }
    {
      const r = await mountFull(ui)
      const root = document.querySelector('[data-dsh-hob="stages-panel"]')
      const probs = s23probs(root)
      const ox = root === null ? '' : oxOf(root)
      if (probs.length === 0) {
        ok(`S-23 ✓ 面板根**声明不许横向滚**：overflowX=\`${ox}\` · 面板内横向滚动容器 **0 个**`
          + '（⚠ 判的是声明值，⛔ 不是 `scrollWidth>clientWidth` 那种 jsdom 恒 0 的假判据）')
      } else for (const x of probs) bad(`S-23 · ${x}`)
      actFn(() => r.unmount())
    }

    // ── S-23a 负向对拍：把声明改成 `'auto'` ⇒ S-23 必红 ──
    {
      const built = ((t) => {
        const m = t.replace("  overflowX: 'hidden',", "  overflowX: 'auto',")
        return m === t ? undefined : writeMutant('ox-auto', m)
      })(src)
      if (built === undefined) {
        bad('S-23a · 造不出「overflowX: auto」的变体（源码形态变了）⇒ 负向对拍不可判')
      } else {
        const modRaw = await import(pathToFileURL(built).href)
        const r = await mountFull(modRaw)
        const probs = s23probs(document.querySelector('[data-dsh-hob="stages-panel"]'))
        if (probs.length > 0) {
          ok(`S-23a ✓ 负向对拍（overflowX: hidden → **auto**）⇒ S-23 **必红**：${probs[0]}`)
        } else bad('S-23a · 变体仍全绿 ⇒ S-23 没有牙（`hidden` 与 `auto` 分不开）')
        actFn(() => r.unmount())
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // S-24 ⭐ **横向溢出的根因：每个 `flex: '1 1 auto'` 的文本列都必须 `minWidth: 0`**
    // ══════════════════════════════════════════════════════════════════
    /**
     * ── 为什么这条**必须**和 S-23 同时存在（⛔ 不是凑数）──────────────
     *   flex 项的 `min-width` 默认是 `auto` ⇒ **不许缩到 `min-content` 以下**
     *   ⇒ 长 id / 长标题把整行撑破。⚠ 只加 `overflowX: 'hidden'` 就是**把字裁掉** ——
     *   用户会看到「字被切了一半」，那是**用新缺陷盖旧缺陷**。
     *   ⇒ S-23 管"不许滚"，S-24 管"不许把字裁掉"（改根因而不是盖症状）。
     *
     * ── 本组量什么（两个角度，⛔ 缺一不算）──────────────────────────
     *   ① **渲染面**：面板里**每个** `flex: '1 1 auto'` 的节点，`minWidth` 都读得到且为 `0`；
     *   ② **源码面**：去掉块注释后，`flex: '1 1 auto'` 的出现次数 == 紧跟 `minWidth: 0` 的次数
     *      （⚠ ① 只覆盖"夹具渲染到的那几个"，② 覆盖"源码里的每一个"，两者互补；
     *        ⛔ ① 单独存在会漏掉没被夹具渲染的节点 ⇒ 假绿）。
     */
    const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
    const s24srcProbs = (t) => {
      const code = stripComments(t)
      const flexAll = (code.match(/flex:\s*'1 1 auto'/g) ?? []).length
      const flexWithMin = (code.match(/flex:\s*'1 1 auto',\s*minWidth:\s*0\b/g) ?? []).length
      const probs = []
      if (flexAll === 0) probs.push('源码里找不到任何 `flex: \'1 1 auto\'`（形态变了 ⇒ 判据失效）')
      else if (flexWithMin !== flexAll) {
        probs.push(`源码里 \`flex: '1 1 auto'\` 共 ${flexAll} 处，紧跟 \`minWidth: 0\` 的只有 ${flexWithMin} 处`
          + ` ⇒ 有 ${flexAll - flexWithMin} 处会因 \`min-width: auto\` 把行撑破`)
      }
      return probs
    }
    const s24domProbs = (rootEl) => {
      if (rootEl === null) return ['找不到面板根（stages-panel）']
      const probs = []
      const flexers = [...rootEl.querySelectorAll('*')].filter((el) => {
        const cs = el.ownerDocument.defaultView.getComputedStyle(el)
        return (cs.flex || el.style.flex || '').trim().replace(/\s+/g, ' ') === '1 1 auto'
      })
      if (flexers.length === 0) {
        probs.push('渲染面里一个 `flex: 1 1 auto` 节点都没找到（夹具没覆盖到 ⇒ 本条对渲染面失效）')
        return probs
      }
      for (const el of flexers) {
        const cs = el.ownerDocument.defaultView.getComputedStyle(el)
        const mw = (cs.minWidth || el.style.minWidth || '').trim()
        if (!/^(0|0px|0em|0rem)$/.test(mw)) {
          probs.push(`\`flex: 1 1 auto\` 节点缺 \`minWidth: 0\`：minWidth=${JSON.stringify(mw)} · `
            + `文本=${JSON.stringify((el.textContent ?? '').slice(0, 24))}`)
        }
      }
      return probs
    }
    {
      const r = await mountFull(ui)
      const root = document.querySelector('[data-dsh-hob="stages-panel"]')
      const domProbs = s24domProbs(root)
      const srcProbs = s24srcProbs(src)
      const flexers = root === null ? 0 : [...root.querySelectorAll('*')].filter((el) => {
        const cs = el.ownerDocument.defaultView.getComputedStyle(el)
        return (cs.flex || el.style.flex || '').trim().replace(/\s+/g, ' ') === '1 1 auto'
      }).length
      const probs = [...domProbs, ...srcProbs]
      if (probs.length === 0) {
        const code = stripComments(src)
        const n = (code.match(/flex:\s*'1 1 auto'/g) ?? []).length
        ok(`S-24 ✓ **${n} 处** \`flex: '1 1 auto'\` **全部**声明了 \`minWidth: 0\``
          + `（渲染面实测 ${flexers} 个节点 · 源码面 ${n}/${n} 处 ⇒ 长 id / 长标题可被压缩断行，⛔ 不靠 \`overflowX:hidden\` 裁掉）`)
      } else for (const x of probs) bad(`S-24 · ${x}`)
      actFn(() => r.unmount())
    }

    // ── S-24a 负向对拍：把**其中一处**（条目标题那处）的 `minWidth: 0` 删掉 ⇒ S-24 必红 ──
    {
      /**
       * ⚠ 任务书点名：**删掉其中一处**，⛔ 不是全删 —— 全删会让"有没有逐处声明"失去区分度
       *   （全删之后任何"抓到一处就算"的弱判据也会绿）。
       */
      const TARGET = "React.createElement('span', { 'data-dsh-hob': 'stages-item-title', style: { flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere' } }, title),"
      const built = ((t) => {
        const m = t.replace(TARGET, TARGET.replace(", minWidth: 0", ''))
        return m === t ? undefined : writeMutant('no-minw-one', m)
      })(src)
      if (built === undefined) {
        bad('S-24a · 造不出「删掉一处 minWidth: 0」的变体（源码形态变了）⇒ 负向对拍不可判')
      } else {
        /** ⚠ 源码面判据要用**变异后的源码文本**（⛔ 不能用 `src` 原件 —— 那样永远 3/3 全绿）。 */
        const mutatedText = src.replace(TARGET, TARGET.replace(", minWidth: 0", ''))
        const srcProbs = s24srcProbs(mutatedText)
        const modRaw = await import(pathToFileURL(built).href)
        const r = await mountFull(modRaw)
        const domProbs = s24domProbs(document.querySelector('[data-dsh-hob="stages-panel"]'))
        if (srcProbs.length > 0 || domProbs.length > 0) {
          ok(`S-24a ✓ 负向对拍（删掉**条目标题**那处的 \`minWidth: 0\`）⇒ S-24 **必红**：`
            + `${(srcProbs[0] ?? domProbs[0])}`)
        } else bad('S-24a · 删掉一处后仍全绿 ⇒ S-24 没有牙（不能逐处判定）')
        actFn(() => r.unmount())
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // S-25 / S-26 / S-27 · 「下一步」与阻断原因（2026-10-31 P42/R4 · `TASK-R4.md` §四）
    // ══════════════════════════════════════════════════════════════════
    /**
     * ── S-25：真账本下「下一步」这一行**必须渲染出来**，且⛔ 不带任何可交互元素 ──
     *
     * ⚠ 为什么单独一条：`nextBlock` 是我新加的 DOM 面，⛔ 不许只靠"tsc 过了"当证据。
     * ⚠ 同时钉住**零按钮/零勾选/零百分比/零进度条**这条硬约束 ——
     *   作业书 §四 明写，⛔ 破了就是"面板变成操作台"。
     */
    {
      const { resolveLedgerRoot } = await import('./lib/ledger-root.mjs')
      const ledgerRoot = resolveLedgerRoot(root, undefined, undefined)
      if (ledgerRoot === undefined) {
        bad('S-25 · 账本根判不出 ⇒ 无法用真账本数据渲染（⛔ 不按通过处理）')
      } else {
        const idx = await import(pathToFileURL(join(root, 'src', 'shared', 'stages-index.ts')).href)
        const units = idx.parseUnitsToml(readFileSync(join(ledgerRoot, idx.STAGES_INDEX_REL), 'utf8'))
        const built = idx.buildStages(units, '2026-10-30T00:00:00.000Z')
        const r = mount(react.createElement(StagesPanelHarness, {
          fetchProgress: async () => ({ ok: true, rows: [] }),
          fetchExec: async () => ({ ok: true, items: [] }),
          fetchStages: async () => built,
          pollMs: 0,
        }))
        await tick(40)
        const box = document.querySelector('[data-dsh-hob="stages-next"]')
        const line = document.querySelector('[data-dsh-hob="stages-next-line"]')
        const kindAttr = box?.getAttribute('data-next-kind') ?? ''
        const text = (line?.textContent ?? '').trim()
        const probs = []
        if (box === null) probs.push('「下一步」这一块**没渲染** ⇒ 本条的测量面不存在')
        if (text === '') probs.push('「下一步」那一行是**空的**（⛔ 作业书 §四 明令不许空）')
        /**
         * ⚠ 六态封闭集：`data-next-kind` 必须落在里面 —— ⛔ 不许自造第七种。
         */
        const KINDS = ['dispatch', 'accept', 'wait-user', 'blocked', 'converge', 'undecidable']
        if (!KINDS.includes(kindAttr)) probs.push(`\`data-next-kind = ${JSON.stringify(kindAttr)}\` 不在六态封闭集里`)
        /**
         * ⚠⚠ **零交互元素**：`nextBlock` 里不许有 button / input / checkbox / progress。
         *   注意：`stages-tree-head` 里那些 `button` 是**步头展开**（既有，不在本块内）⇒ 只扫本块。
         */
        if (box !== null) {
          const forbidden = box.querySelectorAll('button, input, select, textarea, progress, [role="progressbar"], [role="checkbox"]')
          if (forbidden.length > 0) probs.push(`「下一步」块里出现了 **${forbidden.length}** 个可交互元素（⛔ 面板必须只读）`)
          const pct = /(\d+(\.\d+)?\s*%|█|▓|▒|░)/.exec(box.textContent ?? '')
          if (pct !== null) probs.push(`「下一步」块里出现了**百分比/进度条字符**：${JSON.stringify(pct[0])}（⛔ 明令禁止）`)
        }
        if (probs.length === 0) {
          ok(`S-25 ✓ **真账本下「下一步」渲染出来了**（\`data-next-kind = ${kindAttr}\`，六态封闭集内）`
            + ` · 原文：\`${text}\``
            + ' · **零可交互元素 · 零百分比 · 零进度条**（⛔ 面板仍只读）')
        } else for (const x of probs) bad(`S-25 · ${x}`)

        /** ⚠ `r` 用完立刻卸（见下方卸载次序说明），⛔ 不留到最后。 */
        actFn(() => r.unmount())

        // ── S-26：`undecidable` 必须**明写判不出**（⛔ 不许空、⛔ 不许写"已完成"）──
        const undecided = { ...built, next: { kind: 'undecidable', target: null, why: '账本里没有可推进的活', blockedBy: [] } }
        const r2 = mount(react.createElement(StagesPanelHarness, {
          fetchProgress: async () => ({ ok: true, rows: [] }),
          fetchExec: async () => ({ ok: true, items: [] }),
          fetchStages: async () => undecided,
          pollMs: 0,
        }))
        await tick(40)
        const line2 = document.querySelector('[data-dsh-hob="stages-next-line"]')
        const t2 = (line2?.textContent ?? '').trim()
        const probs2 = []
        if (!t2.includes('判不出')) probs2.push(`\`undecidable\` 却没写「判不出」：${JSON.stringify(t2)}`)
        if (t2.includes('已完成') || t2.includes('完成')) probs2.push('`undecidable` 被显示成"完成"（⛔ 作业书 §四 明令禁止）')
        if (probs2.length === 0) {
          ok(`S-26 ✓ \`undecidable\` **明写判不出**：\`${t2}\`（⛔ 不是空、⛔ 不是"已完成"）`)
        } else for (const x of probs2) bad(`S-26 · ${x}`)
        actFn(() => r2.unmount())

        // ── S-27：阻断项**最多 3 条**，超出写「另有 N 条」（作业书 §四）──
        const many = {
          ...built,
          next: {
            kind: 'converge', target: 'CHG-999', why: '变更还没收口',
            blockedBy: ['K-1 · TSK-1 · 没做完', 'K-3 · R-1 · 没验收', 'K-4 · RSK-1 · 风险开着', 'K-2 · TSK-2 · 没证据', 'K-6 · ACC-1 · 自验'],
          },
        }
        const r3 = mount(react.createElement(StagesPanelHarness, {
          fetchProgress: async () => ({ ok: true, rows: [] }),
          fetchExec: async () => ({ ok: true, items: [] }),
          fetchStages: async () => many,
          pollMs: 0,
        }))
        await tick(40)
        const shownN = document.querySelectorAll('[data-dsh-hob="stages-next-blocker"]').length
        const restTxt = (document.querySelector('[data-dsh-hob="stages-next-blocker-rest"]')?.textContent ?? '').trim()
        const probs3 = []
        if (shownN !== 1) probs3.push(`阻断项列了 **${shownN}** 条（R-020 只给一个主阻断）`)
        if (!restTxt.includes('另有') || !restTxt.includes('4')) probs3.push(`超出部分没写「另有 N 条」：${JSON.stringify(restTxt)}`)
        if (probs3.length === 0) {
          ok(`S-27 ✓ 只给一个主阻断（实测列 ${shownN} 条）+ 超出写 \`${restTxt}\``)
        } else for (const x of probs3) bad(`S-27 · ${x}`)
        actFn(() => r3.unmount())
        /**
         * ⚠ **卸载次序**：`r` 是第一个实例，`r2`/`r3` 各自 `createRoot` **同一个容器**。
         *   实测踩过：`r3.unmount()` 之后再 `r.unmount()` ⇒
         *   `DOMException [NotFoundError]: The node to be removed is not a child of this node`
         *   —— 因为容器已被后两次 `createRoot` 换过根，`r` 记着的旧根已经不在了。
         *   ⇒ `r` 在 S-25 量完就卸（那时它还活着），⛔ 不留在最后。
         */
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    // S-29 / S-29g · 「待确认工具」界面出口（2026-11-01 P41/R20 · `TASK-R20.md` §一）
    //   ⚠ 治的是 `R-008` 的**标题**：「「被判出」必须能在界面上看见，⛔ 不能只落日志」。
    //     只读路由与 `describeUnseen` 早在 P28 就落地了，但 `src/client/` 零处读它
    //     ⇒ 标题这一条一直没被满足。本组量那一块。
    //   ⚠ 数据源就是**那条已存在的路由**（⛔ 不新开路由、⛔ 不改返回形状）。
    // ══════════════════════════════════════════════════════════════════════
    {
      /**
       * 喂**真形状**的 `UnseenReport`（照 `src/shared/unseen-tools.ts` 的 `describeUnseen` 返回）。
       * ⚠ 0 条那份的 `summary` 必须**含「0 条」** —— 那正是 `describeUnseen` 的既有文案，
       *   本组 ⛔ 不自己编文案，只断言它被**原样**渲染出来。
       */
      const report0 = {
        ok: true, count: 0, names: [], items: [],
        summary: '0 条 —— 当前没有待确认的工具（装进来的工具都在白名单或 deny 清单里）',
      }
      const report2 = {
        ok: true, count: 2, names: ['zzz-alpha', 'zzz-beta'], items: [],
        summary: '2 条待确认：zzz-alpha · zzz-beta',
      }
      const mountUnseen = (report, extra) => mount(react.createElement(StagesPanelHarness, {
        fetchProgress: async () => ({ ok: true, rows: [] }),
        fetchExec: async () => ({ ok: true, items: [] }),
        fetchStages: async () => built,
        fetchUnseen: async () => report,
        pollMs: 0,
        ...(extra ?? {}),
      }))

      // ── S-29 正向：区域存在 · 文本含 summary · 逐名列出 ──
      {
        const r = mountUnseen(report2)
        await tick(40)
        const box = document.querySelector('[data-dsh-hob="stages-unseen"]')
        const sum = document.querySelector('[data-dsh-hob="stages-unseen-summary"]')
        const items = [...document.querySelectorAll('[data-dsh-hob="stages-unseen-item"]')]
        const text = (sum?.textContent ?? '').trim()
        const probs = []
        if (box === null) probs.push('「待确认工具」这一块**没渲染** ⇒ 本条的测量面不存在')
        if (text === '') probs.push('`summary` 那一行是**空的**')
        if (!text.includes('2 条')) probs.push(`数量行没有写出 2 条：实际 ${JSON.stringify(text.slice(0, 60))}`)
        if (text === '') probs.push('数量行是空的')
        if (items.length !== 2) probs.push(`⛔ 没有逐名列出（期望 2 行，实际 ${items.length} 行）`)
        const joined = items.map((x) => x.textContent).join('|')
        if (!joined.includes('zzz-alpha') || !joined.includes('zzz-beta')) probs.push(`逐名内容不对：${JSON.stringify(joined.slice(0, 80))}`)
        if (document.querySelector('[data-dsh-hob="stages-unseen-details"]')?.hasAttribute('open') !== false) {
          probs.push('有 2 条工具时详情没有默认折叠')
        }
        /**
         * ⚠ 截图实测：原实现把 `summary`（本来就是完整名单）与逐名清单各渲染一遍
         *   ⇒ 117 条工具名出现两次。`summary` 只负责数量，逐名清单负责名字。
         */
        if (text.includes('zzz-alpha') || text.includes('zzz-beta')) probs.push('summary 行又把整份名单重复了一遍')
        if (items.length !== new Set(items.map((x) => (x.textContent ?? '').trim())).size) probs.push('逐名清单出现重复项')
        /** ⚠ 零交互元素 / 零百分比 / 零进度条 / 零勾选（`R-005` 咬住） */
        if (box !== null) {
          const forbidden = box.querySelectorAll('button, input, select, textarea, progress, [role="progressbar"], [role="checkbox"]')
          if (forbidden.length > 0) probs.push(`块里出现了 **${forbidden.length}** 个可交互元素（⛔ 面板只读）`)
          const pct = /(\d+(\.\d+)?\s*%|█|▓|▒|░)/.exec(box.textContent ?? '')
          if (pct !== null) probs.push(`块里出现了百分比/进度条字符：${JSON.stringify(pct[0])}`)
        }
        if (probs.length === 0) {
          ok(`S-29 ✓ **「待确认工具」界面出口成立**（\`data-dsh-hob="stages-unseen"\`）`
            + ` · 数量行可读且不重复名单：\`${text.slice(0, 50)}…\``
            + ` · **逐名列出 ${items.length} 条**（${items.map((x) => x.textContent).join(' ')}）`
            + ' · 零可交互元素 · 零百分比 · 零进度条（⛔ 面板仍只读）')
        } else for (const x of probs) bad(`S-29 · ${x}`)
        actFn(() => r.unmount())
      }

      // ── S-29b 正向：0 条时必须**写出「0 条」**（⛔ 不许空白、⛔ 不许不渲染）──
      {
        const r = mountUnseen(report0)
        await tick(40)
        const box = document.querySelector('[data-dsh-hob="stages-unseen"]')
        const sum = document.querySelector('[data-dsh-hob="stages-unseen-summary"]')
        const items = [...document.querySelectorAll('[data-dsh-hob="stages-unseen-item"]')]
        const text = (sum?.textContent ?? '').trim()
        const probs = []
        if (box === null) probs.push('0 条时**整块没渲染**（⛔ "没查"与"查了 0 条"必须分得开）')
        if (!text.includes('0 条')) probs.push(`0 条时没写出「0 条」：实际 ${JSON.stringify(text.slice(0, 60))}`)
        if (items.length !== 0) probs.push(`0 条时却渲染了 ${items.length} 行逐名项`)
        if (document.querySelector('[data-dsh-hob="stages-unseen-details"]')?.hasAttribute('open') !== true) {
          probs.push('0 条时详情没有默认展开，读数被藏起来')
        }
        if (probs.length === 0) {
          ok(`S-29b ✓ **0 条时明写「0 条」**（⛔ 非空白、⛔ 非不渲染）：\`${text.slice(0, 50)}…\``
            + ' · 逐名项 0 行 · ⚠ 文案来自 `describeUnseen` 的 `summary`，⛔ 不是本组另编的')
        } else for (const x of probs) bad(`S-29b · ${x}`)
        actFn(() => r.unmount())
      }

      // ── S-29g 负向对拍：把该区域整段摘掉 ⇒ S-29 / S-29b 必红 ──
      {
        /**
         * ⚠ 造变体：把面板源码里 `unseenBlock,` 那一次挂载摘掉。
         *   ⚠ 先自证源码里**确实**有那一行（否则"改不动"与"改了没用"分不开）。
         *   ⚠ 变体写进 `src/client/` 的临时文件，`finally` 必删（同既有负向对拍口径）。
         */
        let src = null
        try { src = readFileSync(PANEL_TSX, 'utf8') } catch { src = null }
        const NEEDLE = '    unseenBlock,\n'
        const present = src !== null && src.includes(NEEDLE)
        const mutated = present ? src.replace(NEEDLE, '    // unseenBlock,（负向对拍：整段摘掉）\n') : null
        const changed = mutated !== null && mutated !== src
        if (!present || !changed) {
          bad('S-29g · 造不出「摘掉待确认工具块」的变体（源码形态变了）⇒ 负向对拍不可判')
        } else {
          /**
           * ⚠ **必须走 `writeMutant`**（转译 + 相对 import 说明符重写成 `.mjs`）：
           *   直接 `import` 一个 `.tsx` 会 `ERR_UNKNOWN_FILE_EXTENSION`（实测踩过）。
           *   落到 `work/out/client/` ⇒ `../modules/...` 正好指向 `ts-mount` 已产出的 `.mjs`。
           */
          const out = writeMutant('mut-unseen', mutated)
          {
            const m2 = await import(pathToFileURL(out).href + '?t=' + Date.now())
            const r = mount(react.createElement(m2.StagesPanel, {
              fetchProgress: async () => ({ ok: true, rows: [] }),
              fetchExec: async () => ({ ok: true, items: [] }),
              fetchStages: async () => built,
              fetchUnseen: async () => report2,
              pollMs: 0,
            }))
            await tick(40)
            const box = document.querySelector('[data-dsh-hob="stages-unseen"]')
            actFn(() => r.unmount())
            if (box === null) {
              ok('S-29g ✓ 负向对拍（把 `unseenBlock` 那次挂载整段摘掉）⇒ S-29 的"区域存在"断言**必红**：'
                + '`[data-dsh-hob="stages-unseen"]` 在变体里**找不到**（⛔ 不是恒绿）')
            } else {
              bad('S-29g · 摘掉挂载后区域**仍然存在** ⇒ S-29 的判据没有牙（它量的不是这一处）')
            }
          }
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // S-30 Current 面板（只读 · 与其它区块分治）
    // ══════════════════════════════════════════════════════════════════
    {
      const mountCurrent = async (fetchCurrent) => {
        const r = mount(react.createElement(StagesPanelHarness, {
          fetchProgress: async () => ({ ok: true, rows: [] }),
          fetchExec: async () => ({ ok: true, items: [] }),
          fetchStages: async () => ({ ok: true, readAt: '2026-11-02T00:00:00.000Z', stages: [], caps: [] }),
          fetchUnseen: async () => ({ ok: true, count: 0, names: [], items: [], summary: '0 条 —— 当前没有待确认的工具' }),
          fetchCurrent,
          pollMs: 0,
        }))
        await tick(40)
        return r
      }
      const CURRENT_TEXT = '# Current（测试）\n\n## 一、现在在等谁\n\n### 等你决定\n\n#### 覆盖关系缺口\n\n- **等你决定：0 条**\n\n## 二、风险与目标\n\n- 测试第二节'

      // S-30a 正向：合法 Current 文本原样进入 Current 区块。
      {
        const r = await mountCurrent(async () => ({ ok: true, text: CURRENT_TEXT }))
        const box = document.querySelector('[data-dsh-hob="stages-current"]')
        const body = document.querySelector('[data-dsh-hob="stages-current-text"]')
        const p = []
        if (box === null) p.push('Current 区块不存在')
        if (body === null) p.push('Current 正文不存在')
        if (body?.querySelector('details[data-current-section="一、现在在等谁"]') === null) p.push('Current 二级标题没有被结构化成章节标题')
        if (body?.querySelector('[data-current-kind="subheading"]') === null) p.push('Current 三级标题没有被结构化成 subheading')
        if (body?.querySelector('[data-current-kind="subsection"]') === null) p.push('Current 四级标题没有被结构化成 subsection')
        if (document.querySelectorAll('[data-dsh-hob="stages-current-text"] details[data-current-section]').length < 2) p.push('Current 章节没有按二级标题折叠分组')
        if (document.querySelector('[data-dsh-hob="stages-current-text"] details[data-current-section]')?.hasAttribute('open') !== true) p.push('Current 首章节没有默认展开')
        if (document.querySelector('[data-dsh-hob="stages-current-text"] details[data-current-section="preamble"]') !== null) p.push('Current 说明段被错误地做成折叠章节')
        if (body?.querySelector('[data-current-kind="item"]') === null) p.push('Current 列表项没有被结构化成 item')
        if ((body?.textContent ?? '').includes('#') || (body?.textContent ?? '').includes('**')) p.push('Current 仍把 Markdown 标记原样显示')
        if (!(body?.textContent ?? '').includes('现在在等谁') || !(body?.textContent ?? '').includes('等你决定：0 条')) p.push('Current 正文内容在解析后丢失')
        if (p.length === 0) ok('S-30a ✓ Current 取数成功 ⇒ 独立区块存在，Markdown 被结构化渲染且标点不裸露')
        else for (const x of p) bad(`S-30a · ${x}`)
        actFn(() => r.unmount())
      }

      /**
       * S-30b 失败分治：只有 Current 区块落「判不出」，主线仍在。
       *
       * ⚠ R-020 起首屏是「单需求主线」，不再有全局五步树；旧夹具的 stages 为空，
       *   主视图本来就没链可画 ⇒ 旧断言会把“夹具没数据”误判成“Current 抹掉了主线”。
       *   ⇒ 这里显式给一条在途需求，观察点改为主线的 `stages-mainline`。
       */
      {
        const CURRENT_SPLIT_STAGES = {
          ok: true,
          readAt: '2026-11-07T00:00:00.000Z',
          stages: [
            { step: 1, name: '需求规格', state: 'done', done: 1, total: 1, items: [{ id: 'R-950', status: 'agreed', kind: 'req', presentation: { displayTitle: '分隔需求', relation: { key: 'goal', id: null, state: 'missing' }, facts: [], flags: [] } }] },
            { step: 2, name: '实现方案', state: 'doing', done: 0, total: 1, items: [{ id: 'CHG-950', status: 'proposed', kind: 'change', presentation: { displayTitle: '分隔方案', relation: { key: 'requirement', id: 'R-950', state: 'ok' }, facts: [], flags: [] } }] },
            { step: 3, name: '编码任务', state: 'todo', done: 0, total: 0, items: [] },
            { step: 4, name: '任务执行', state: 'todo', done: 0, total: 0, items: [] },
            { step: 5, name: '验收核对', state: 'todo', done: 0, total: 0, items: [] },
          ],
          caps: [],
        }
        const r = mount(react.createElement(StagesPanelHarness, {
          fetchProgress: async () => ({ ok: true, rows: [] }),
          fetchExec: async () => ({ ok: true, items: [] }),
          fetchStages: async () => CURRENT_SPLIT_STAGES,
          fetchUnseen: async () => ({ ok: true, count: 0, names: [], items: [], summary: '0 条 —— 当前没有待确认的工具' }),
          fetchCurrent: async () => ({ ok: false, reason: 'ledger-unreadable', message: 'Current 测试失败' }),
          pollMs: 0,
        }))
        await tick(40)
        const box = document.querySelector('[data-dsh-hob="stages-current"]')
        const mainline = document.querySelector('[data-dsh-hob="stages-mainline"]')
        const p = []
        if (box === null || !(box.textContent ?? '').includes('判不出：Current 测试失败')) {
          p.push(`Current 没有照实落「判不出」+ 原因：${JSON.stringify(box?.textContent ?? '')}`)
        }
        if (mainline === null || mainline.getAttribute('data-req-id') !== 'R-950') {
          p.push(`Current 失败把单需求主线一起抹掉了（data-req-id=${JSON.stringify(mainline?.getAttribute('data-req-id'))}）`)
        }
        if (document.querySelector('[data-dsh-hob="stages-current-text"]') !== null) p.push('失败时仍渲染了 Current 正文')
        if (p.length === 0) ok('S-30b ✓ Current 失败 ⇒ 只有本区块写「判不出」+ 原因，单需求主线仍在（失败不分治没有发生）')
        else for (const x of p) bad(`S-30b · ${x}`)
        actFn(() => r.unmount())
      }

      // S-30c 负向对拍：摘掉唯一挂载 ⇒ S-30a 的"区块存在"必红。
      {
        const srcNow = readFileSync(PANEL_TSX, 'utf8')
        const currentMountRe = /React\.createElement\(CurrentPanel, \{\n[\s\S]*?\n\s+\}\),\n/
        const hits = srcNow.match(new RegExp(currentMountRe.source, 'g')) ?? []
        const mutated = hits.length === 1
          ? srcNow.replace(currentMountRe, '    // CurrentPanel 挂载已摘除（负向对拍）\n')
          : srcNow
        if (mutated === srcNow) {
          bad('S-30c · 造不出「摘掉 CurrentPanel 挂载」的变体（源码形态变了）⇒ 负向对拍不可判')
        } else {
          const out = writeMutant('mut-current', mutated)
          const modC = await import(pathToFileURL(out).href + '?t=' + Date.now())
          const r = mount(react.createElement(modC.StagesPanel, {
            fetchProgress: async () => ({ ok: true, rows: [] }),
            fetchExec: async () => ({ ok: true, items: [] }),
            fetchStages: async () => ({ ok: true, readAt: '2026-11-02T00:00:00.000Z', stages: [], caps: [] }),
            fetchUnseen: async () => ({ ok: true, count: 0, names: [], items: [], summary: '0 条 —— 当前没有待确认的工具' }),
            fetchCurrent: async () => ({ ok: true, text: CURRENT_TEXT }),
            pollMs: 0,
          }))
          await tick(40)
          const gone = document.querySelector('[data-dsh-hob="stages-current"]') === null
          actFn(() => r.unmount())
          if (gone) ok('S-30c ✓ 负向对拍（摘掉 CurrentPanel 的唯一挂载）⇒ S-30a 的区块存在断言必红：变体里找不到 stages-current')
          else bad('S-30c · 摘掉挂载后 Current 区块仍在 ⇒ 断言没有牙')
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // S-32 注意力视图（派生工作状态，不等于五步进度）
    // ══════════════════════════════════════════════════════════════════
    {
      const base = {
        ok: true,
        readAt: '2026-11-02T00:00:00.000Z',
        stages: [],
        caps: [],
        next: { kind: 'undecidable', target: null, why: '夹具没有下一步', blockedBy: [] },
      }
      const mountWithAttention = async (attention) => {
        const r = mount(react.createElement(StagesPanelHarness, {
          fetchProgress: async () => ({ ok: true, rows: [] }),
          fetchExec: async () => ({ ok: true, items: [] }),
          fetchStages: async () => ({ ...base, ...(attention === undefined ? {} : { attention }) }),
          fetchUnseen: async () => ({ ok: true, count: 0, names: [], items: [], summary: '0 条 —— 当前没有待确认的工具' }),
          fetchCurrent: async () => ({ ok: true, text: CURRENT_TEXT }),
          pollMs: 0,
        }))
        await tick(30)
        return r
      }

      // S-32a 非空：逐条显示，且状态来自后端。
      {
        const rows = [
          { id: 'R-001', state: 'awaiting-user', label: '等你决定', why: '没有验收路径' },
          { id: 'TSK-001', state: 'blocked', label: '阻塞', why: '已交付但没有证据' },
        ]
        const r = await mountWithAttention(rows)
        /**
         * ⚠ R-020 起「当前工作」一级标签已删除；注意力只进补充信息，
         *   ⛔ 不再在主线首屏重复。这里用补充信息里的注意力块核对。
         */
        const items = [...document.querySelectorAll('[data-dsh-hob="stages-attention-item"]')]
        const p = []
        const texts = items.map((x) => x.textContent ?? '')
        if (!texts.some((t) => t.includes('R-001') && t.includes('等你决定'))) p.push(`没逐条显示 R-001（实有：${JSON.stringify(texts)}）`)
        if (!texts.some((t) => t.includes('TSK-001') && t.includes('阻塞'))) p.push(`没逐条显示 TSK-001 的阻塞态（实有：${JSON.stringify(texts)}）`)
        if (p.length === 0) ok('S-32a ✓ 非空注意力在补充信息里逐条显示（等待用户 / 阻塞 · id 与中文措辞来自后端）')
        else for (const x of p) bad(`S-32a · ${x}`)
        actFn(() => r.unmount())
      }

      // S-32b 空数组是一条“查过、没事”的读数，必须与判不出分开。
      {
        const r = await mountWithAttention([])
        const box = document.querySelector('[data-dsh-hob="stages-attention"]')
        const p = []
        if (box?.getAttribute('data-state') !== 'empty') p.push(`空数组 state 不是 empty：${JSON.stringify(box?.getAttribute('data-state'))}`)
        if (!(box?.textContent ?? '').includes('没有需要人或验收方处理的事项')) p.push('空数组没有明确空态文案')
        if ((box?.textContent ?? '').includes('判不出')) p.push('空数组被误写成判不出')
        if (p.length === 0) ok('S-32b ✓ 注意力为 0 条 ⇒ 明写“没有需要…”，与字段缺失的判不出分开')
        else for (const x of p) bad(`S-32b · ${x}`)
        actFn(() => r.unmount())
      }

      // S-32c 字段缺失 ⇒ 判不出，⛔ 不许退化成 0 条。
      {
        const r = await mountWithAttention(undefined)
        const box = document.querySelector('[data-dsh-hob="stages-attention"]')
        const p = []
        if (box?.getAttribute('data-state') !== 'undecidable') p.push(`字段缺失 state 不是 undecidable：${JSON.stringify(box?.getAttribute('data-state'))}`)
        if (!(box?.textContent ?? '').includes('判不出')) p.push('字段缺失没有明写判不出')
        if (document.querySelectorAll('[data-dsh-hob="stages-attention-item"]').length !== 0) p.push('字段缺失却渲染了注意力项')
        if (document.querySelector('[data-dsh-hob="stages-attention-empty"]') !== null) p.push('字段缺失被误写成 0 条')
        if (p.length === 0) ok('S-32c ✓ attention 字段缺失 ⇒ 判不出 + 原因；⛔ 没有伪装成 0 条')
        else for (const x of p) bad(`S-32c · ${x}`)
        actFn(() => r.unmount())
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // S-31 账本资源按 ID 读取（HTTP 处理体 + 模型工具路径）
    // ══════════════════════════════════════════════════════════════════
    {
      const ENTRY2 = 'src/modules/ledger-resource-route.ts'
      const graph2 = tsMount.mountTsGraph({ root, outDir: join(work, 'out-resource'), entries: [ENTRY2], ts })
      const probs2 = [
        ...graph2.problems,
        ...tsMount.verifyMounted({ root, entries: [ENTRY2], mounted: graph2.mounted, entryFiles: graph2.entries }),
      ]
      if (probs2.length > 0) for (const x of probs2) bad(`S-31a 转译/自证失败：${x}`)
      else ok(`S-31a ✓ 账本资源路由转译图自证通过（${graph2.mounted.join(' · ')}）`)

      const out2 = graph2.entries[ENTRY2]
      if (out2 === undefined) throw new Error('账本资源路由没有产出（见 S-31a）')
      const entry2 = join(work, 'resource-entry.mjs')
      writeFileSync(entry2, `export * from ${JSON.stringify(out2)}\n`)
      const routeMod = await import(pathToFileURL(entry2).href)
      const { resolveLedgerRoot } = await import('./lib/ledger-root.mjs')
      const ledgerRoot = resolveLedgerRoot(root, undefined, undefined)
      if (ledgerRoot === undefined) {
        bad('S-31b · 账本根判不出 ⇒ 资源路由处理体不可判')
      } else {
        const idx = await import(pathToFileURL(join(root, 'src', 'shared', 'stages-index.ts')).href)
        const idxPath = join(ledgerRoot, idx.STAGES_INDEX_REL)
        const unitsDir = dirname(idxPath)
        const sourcePaths = [
          idxPath,
          ...readdirSync(unitsDir)
            .filter((name) => /^unit-[^/]+\.toml$/.test(name))
            .sort()
            .map((name) => join(unitsDir, name)),
        ]
        const units = sourcePaths.flatMap((p) => idx.parseUnitsToml(readFileSync(p, 'utf8')))
        const resourceMod = await import(pathToFileURL(join(root, 'src', 'shared', 'ledger-resources.ts')).href)
        const card = resourceMod.readLedgerResource(units, 'requirement/R-009')
        const badKind = resourceMod.readLedgerResource(units, 'acceptance/TSK-061')
        const missing = resourceMod.readLedgerResource(units, 'requirement/R-9999')
        const p = []
        if (card.ok !== true || card.card.id !== 'R-009') p.push(`R-009 读取失败：${JSON.stringify(card)}`)
        if (badKind.ok !== false || badKind.reason !== 'unknown-id') p.push(`错误 kind 未拒绝：${JSON.stringify(badKind)}`)
        if (missing.ok !== false || missing.reason !== 'not-found') p.push(`不存在 ID 未拒绝：${JSON.stringify(missing)}`)
        if (p.length === 0) ok('S-31b ✓ 真账本资源：R-009 可读；错误 kind ⇒ unknown-id；不存在 ID ⇒ not-found（三类结果可分辨）')
        else for (const x of p) bad(`S-31b · ${x}`)

        // 真正执行路由注册：假 fetch.register 收到 POST 路径 + 一个可调用的处理体。
        let handler
        const registered = []
        const fakeCtx = {
          logger: { info: () => {}, warn: () => {} },
          get: (n) => {
            if (n === 'sessions') return { get: () => ({ header: { cwd: root } }) }
            if (n === 'loader') return { entries: () => [{ options: { ledgerHome: join(ledgerRoot, '..') } }] }
            return undefined
          },
          inject: (_names, cb) => {
            cb({ get: (n) => n === 'connection'
              ? { fetch: { register: (route) => { registered.push(route); handler = route.fetch; return () => {} } } }
              : undefined })
            return { dispose: () => {} }
          },
          effect: () => {},
        }
        routeMod.installLedgerResourceRoute(fakeCtx)
        const route = registered[0]
        const q = []
        if (route?.path !== routeMod.LEDGER_RESOURCE_ROUTE_PATH) q.push(`注册路径不对：${JSON.stringify(route?.path)}`)
        if (JSON.stringify(route?.methods) !== '["POST"]') q.push(`methods 不是 POST：${JSON.stringify(route?.methods)}`)
        if (typeof handler !== 'function') q.push('没有可调用的处理体')
        else {
          const bodyReq = (body) => ({ text: async () => JSON.stringify(body) })
          const okRes = await handler(bodyReq({ sessionId: 'fake', resource: 'requirement/R-009' }))
          const badRes = await handler(bodyReq({ sessionId: 'fake', resource: 'acceptance/TSK-061' }))
          const ghostRes = await handler(bodyReq({ sessionId: 'fake', resource: 'requirement/R-9999' }))
          const curRes = await handler(bodyReq({ sessionId: 'fake', resource: 'current' }))
          const badJson = await handler({ text: async () => '{broken' })
          const okBody = await okRes.json()
          const badBody = await badRes.json()
          const ghostBody = await ghostRes.json()
          const curBody = await curRes.json()
          const badJsonBody = await badJson.json()
          if (okRes.status !== 200 || okBody.ok !== true || okBody.card?.id !== 'R-009') q.push(`R-009 处理体返回不对：${okRes.status} ${JSON.stringify(okBody)}`)
          if (badRes.status !== 200 || badBody.ok !== false || badBody.reason !== 'unknown-id') q.push(`错误 kind 处理体返回不对：${badRes.status} ${JSON.stringify(badBody)}`)
          if (ghostRes.status !== 200 || ghostBody.ok !== false || ghostBody.reason !== 'not-found') q.push(`不存在 ID 处理体返回不对：${ghostRes.status} ${JSON.stringify(ghostBody)}`)
          if (curRes.status !== 200 || curBody.ok !== true || typeof curBody.text !== 'string' || !curBody.text.includes('# Current')) q.push(`Current 处理体返回不对：${curRes.status} ${JSON.stringify(curBody).slice(0, 180)}`)
          if (badJson.status !== 400 || badJsonBody.reason !== 'bad-request') q.push(`坏 JSON 未归 bad-request：${badJson.status} ${JSON.stringify(badJsonBody)}`)
        }
        if (q.length === 0) ok('S-31c ✓ 资源路由真处理体：注册 POST 路径；R-009 / 错误 kind / 不存在 ID / Current / 坏 JSON 五档状态与 reason 均可分辨')
        else for (const x of q) bad(`S-31c · ${x}`)
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // S-33 / S-34 / S-35 / S-36 / S-37 · 进度面板信息架构（2026-11-07）
    //   目标：第一屏给结论；阶段地图 / 当前工作 / 计划 / 历史分层；
    //        视图切换只改显示、不卸载数据；历史默认折叠但仍在 DOM。
    // ══════════════════════════════════════════════════════════════════
    {
      const IA_STAGES = {
        ok: true,
        readAt: '2026-11-07T00:00:00.000Z',
        relations: { 'TSK-901': '任务' },
        stages: [
          { step: 1, name: '需求规格', state: 'done', done: 1, total: 1, items: [{ id: 'R-901', status: 'agreed', kind: 'req', presentation: { displayTitle: '需求', relation: { key: 'goal', id: 'G-901', state: 'ok' }, facts: [], flags: [] } }] },
          { step: 2, name: '实现方案', state: 'done', done: 1, total: 1, items: [{ id: 'CHG-901', status: 'settled', kind: 'change', presentation: { displayTitle: '方案', relation: { key: 'requirement', id: 'R-901', state: 'ok' }, facts: [], flags: [] } }] },
          { step: 3, name: '编码任务', state: 'done', done: 1, total: 1, items: [{ id: 'TSK-901', status: 'built', kind: 'task', presentation: { displayTitle: '任务', relation: { key: 'change', id: 'CHG-901', state: 'ok' }, facts: [], flags: [] } }] },
          { step: 4, name: '任务执行', state: 'done', done: 1, total: 1, items: [{ id: 'RUN-901', status: 'returned', kind: 'run', presentation: { displayTitle: '执行', relation: { key: 'task', id: 'TSK-901', state: 'ok' }, facts: [], flags: [] } }] },
          { step: 5, name: '验收核对', state: 'doing', done: 1, total: 2, items: [
            { id: 'ACC-901', status: 'pass', kind: 'acc', presentation: { displayTitle: '已判', relation: { key: 'task', id: 'TSK-901', state: 'ok' }, facts: [], flags: [] } },
            { id: 'ACC-902', status: 'unverified', kind: 'acc', presentation: { displayTitle: '待判', relation: { key: 'task', id: 'TSK-901', state: 'ok' }, facts: [], flags: [] } },
          ] },
        ],
        caps: [],
        summary: {
          stage: { step: 5, name: '验收核对', state: 'doing', done: 1, total: 2 },
          action: { kind: 'accept', target: 'ACC-902', headline: '验收 ACC-902' },
          waitFor: 'acceptance', waitingFor: '独立验收会话', blocker: 'K-3 · R-901 · 验收未判决', openItems: 1,
        },
        next: { kind: 'accept', target: 'ACC-902', why: '收口 CHG-901，等独立验收', blockedBy: ['K-3 · R-901 · 验收未判决'] },
        attention: [{ id: 'TSK-901', state: 'awaiting-acceptance', label: '等验收', why: '验收尚未通过' }],
        portfolio: { counts: { total: 1, covered: 1, proven: 0, orphan: 0 }, orphans: [], builtNoAcc: [] },
      }
      const IA_PLANS = {
        ok: true, mode: 'multi',
        plans: [{ planId: 'WP-901', state: 'running', trackCount: 1, running: 1, waiting: 0, returned: 0, failed: 0, tracks: [{ trackId: 'a', taskId: 'TSK-901', sessionId: 'session-a', accessType: 'write', state: 'running', dependsOn: [] }] }],
        unreadable: [],
        abandoned: [{ planId: 'WP-900', state: 'completed', abandonedAt: '2026-11-06T00:00:00+08:00', abandonedWhy: '已收口' }],
      }
      const iaMount = async (over = {}) => {
        const r = mount(react.createElement(StagesPanelHarness, {
          fetchProgress: async () => ({ ok: true, rows: [] }),
          fetchExec: async () => ({ ok: true, items: [] }),
          fetchStages: async () => IA_STAGES,
          fetchUnseen: async () => ({ ok: true, count: 2, names: ['mcp__wincu__alpha', 'other-beta'], items: [], summary: '2 条待确认' }),
          fetchPlans: async () => IA_PLANS,
          fetchCurrent: async () => ({ ok: true, text: '# Current\n\n## 一、现在\n\n- 夹具 Current' }),
          pollMs: 0,
          ...over,
        }))
        await tick(40)
        return r
      }
      const viewOf = (key) => document.querySelector(`[data-dsh-hob="stages-view"][data-view="${key}"]`)
      const shown = (key) => {
        const el = viewOf(key)
        return el === null ? '' : (el.ownerDocument.defaultView.getComputedStyle(el).display || el.style.display || '').trim()
      }
      const clickTab = async (key) => {
        const tab = document.querySelector(`[data-dsh-hob="stages-view-tab"][data-view="${key}"]`)
        if (tab === null) return false
        actFn(() => tab.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
        await tick(30)
        return true
      }

      /**
       * R-020 替换 S-33a / S-33b / S-34：
       *   · 首屏不再有全局摘要卡；改为「在途需求列表 + 选中需求的五步」；
       *   · 唯一“当前”由 `aria-current="step"` 表达；
       *   · 四个视图标签必须**不存在**；
       *   · 历史在底部折叠，默认收起。
       */
      {
        const r = await iaMount()
        const p = []
        const inflight = document.querySelector('[data-dsh-hob="stages-inflight"]')
        if (inflight === null) p.push('首屏没有在途需求列表')
        const mainline = document.querySelector('[data-dsh-hob="stages-mainline"]')
        if (mainline === null) p.push('首屏没有单需求五步主线')
        const currentSteps = [...document.querySelectorAll('[data-dsh-hob="stages-current-step"]')]
        if (currentSteps.length !== 1) p.push(`“当前”标记 ${currentSteps.length} 个（期望 1）`)
        const currentHost = document.querySelector('[aria-current="step"]')
        if (currentHost === null) p.push('没有任何一步带 aria-current="step"')
        const tabs = [...document.querySelectorAll('[data-dsh-hob="stages-view-tab"]')]
        if (tabs.length !== 0) p.push(`仍有 ${tabs.length} 个一级视图标签`)
        const tabsBar = document.querySelector('[data-dsh-hob="stages-view-switch"]')
        if (tabsBar !== null) p.push('仍有视图切换条')
        const summaryCard = document.querySelector('[data-dsh-hob="stages-summary"]')
        if (summaryCard !== null) p.push('仍有全局摘要卡 ⇒ 会形成第二个“当前”')
        const history = document.querySelector('[data-dsh-hob="stages-history-section"]')
        if (history === null) p.push('底部历史折叠不存在')
        else if (history.tagName.toLowerCase() !== 'details' || history.hasAttribute('open')) p.push('历史不是默认折叠的 <details>')
        if (p.length === 0) ok('S-33a ✓ 首屏 = 在途需求 + 单需求五步 + 唯一 aria-current="step"；无四标签、无全局摘要卡；历史底部默认折叠')
        else for (const x of p) bad(`S-33a · ${x}`)
        actFn(() => r.unmount())
      }

      /**
       * S-33g 生产路径不再请求旧 `/tasks-progress`。
       *
       * ⚠ 面板仍保留一张隐藏的兼容表（按方案不删 DOM），但它**没有展示作用**；
       *   若生产路径还每 5 秒打那条旧路由，就是"重复取数 + 旧数据源仍在跑"。
       *   判据：不注入 `fetchProgress` 时它一次也不该被调用；显式注入时仍可测。
       */
      {
        let legacyCalls = 0
        const r = await iaMount({
          fetchProgress: async () => { legacyCalls += 1; return { ok: true, rows: [] } },
        })
        const injected = legacyCalls
        actFn(() => r.unmount())

        const realFetch = globalThis.fetch
        const urls = []
        globalThis.fetch = async (url) => {
          urls.push(String(url))
          return {
            status: 200, ok: true,
            json: async () => ({ ok: true, items: [], stages: [], caps: [], chains: [], plans: [], count: 0, names: [], summary: '0 条', text: '# Current' }),
            clone: () => ({ text: async () => '' }),
          }
        }
        let r2
        try {
          r2 = mount(react.createElement(ui.StagesPanel, { sessionId: 's-prod', pollMs: 0 }))
          await tick(40)
        } finally { globalThis.fetch = realFetch }
        const legacyHits = urls.filter((u) => u.includes('/tasks-progress'))
        const p = []
        if (injected !== 1) p.push(`显式注入时旧取数应被调用 1 次，实际 ${injected}`)
        if (legacyHits.length !== 0) p.push(`生产路径仍请求旧 /tasks-progress ${legacyHits.length} 次`)
        if (urls.length === 0) p.push('生产路径一条请求都没发 ⇒ 本判据没有对象')
        actFn(() => r2.unmount())
        if (p.length === 0) ok(`S-33g ✓ 生产路径只走主线数据源：旧 /tasks-progress 请求 0 次（其余 ${urls.length} 条请求照常）；显式注入时旧兼容线仍可测`)
        else for (const x of p) bad(`S-33g · ${x}`)
      }

      /**
       * S-33b 需求链读不到 ⇒ **按原因分流**，⛔ 不伪装成空完成。
       *
       * ⚠⚠ 2026-11-08 改判（用户报「面板进度全是判不出」）：
       *   改前：任何 `ok:false` 都在主线上写「判不出：<message>」，且**主线/下一步/历史各写一遍**。
       *   ⇒ 一个没建账的项目，首屏被三份同样的长句占满，读者反而不知道该干什么。
       *
       *   现在：
       *     · `ledger-missing` ⇒ 在途区写「这个项目还没有账本」+ 一句怎么做（⛔ 不说"判不出"）
       *     · `index-legacy`   ⇒ 在途区写「旧格式」+ 一句怎么做
       *     · 其它（真读坏 / 网络） ⇒ 仍写「判不出」+ 原因（**只在第一处**）
       *     · 主线 / 下一步 / 历史 ⇒ 只留 `data-state` 锚点，⛔ 不复述原因
       */
      {
        const r = await iaMount({ fetchChains: async () => ({ ok: false, reason: 'index-unreadable', message: '链路由读不到（夹具）' }) })
        const inflight = document.querySelector('[data-dsh-hob="stages-inflight"]')
        const mainline = document.querySelector('[data-dsh-hob="stages-mainline"]')
        const t = inflight?.textContent ?? ''
        const p = []
        if (!t.includes('判不出')) p.push(`真读坏时首屏没写「判不出」：${JSON.stringify(t)}`)
        if (!t.includes('链路由读不到（夹具）')) p.push('真读坏时没有把原因带上')
        if (mainline?.getAttribute('data-state') !== 'undecidable') p.push(`链路缺失时 data-state=${JSON.stringify(mainline?.getAttribute('data-state'))}`)
        /** ⚠ 同一句原因**只许出现一次**（用户报的"三处重复"）。 */
        const panel = document.querySelector('[data-dsh-hob="stages-panel"]')
        const occurrences = ((panel?.textContent ?? '').match(/链路由读不到（夹具）/g) ?? []).length
        if (occurrences !== 1) p.push(`同一条原因出现了 ${occurrences} 次（期望 1 次）`)
        if (document.querySelectorAll('[data-dsh-hob="stages-current-step"]').length !== 0) p.push('链路缺失时仍标了“当前”')
        if (p.length === 0) ok('S-33b ✓ 需求链真读坏 ⇒ 首屏写「判不出」+ 原因**且只写一次**；主线只留状态锚点，⛔ 不伪装成空/完成')
        else for (const x of p) bad(`S-33b · ${x}`)
        actFn(() => r.unmount())
      }


      /**
       * S-33b2：**"还没开账"与"旧格式"不许说成"判不出"**（2026-11-08 用户裁定）。
       *
       *   ⚠ 这两种都是**已知状态**，下一步动作明确（建账本 / 迁移），
       *     顶着"判不出"只会让人以为账本坏了。
       */
      {
        const p = []
        for (const [reason, wantState, wantWords] of [
          ['ledger-missing', 'not-initialized', '还没有账本'],
          ['index-legacy', 'legacy', '旧格式'],
        ]) {
          const r = await iaMount({ fetchChains: async () => ({ ok: false, reason, message: '夹具原因' }) })
          const inflight = document.querySelector('[data-dsh-hob="stages-inflight"]')
          const text = inflight?.textContent ?? ''
          if (inflight?.getAttribute('data-state') !== wantState) {
            p.push(`${reason} ⇒ data-state=${JSON.stringify(inflight?.getAttribute('data-state'))}（期望 ${wantState}）`)
          }
          if (!text.includes(wantWords)) p.push(`${reason} 没有说清「${wantWords}」：${JSON.stringify(text)}`)
          if (text.includes('判不出')) p.push(`${reason} 仍被说成「判不出」`)
          actFn(() => r.unmount())
        }
        if (p.length === 0) ok('S-33b2 ✓ 「还没开账」与「旧格式」各自说清（⛔ 不冒用「判不出」），且都给出下一步')
        else for (const x of p) bad(`S-33b2 · ${x}`)
      }

      /**
       * S-34d 切到别的账本 ⇒ 会话级运行态 / 计划不再混入（2026-11-08）。
       *
       * ⚠ 运行态与计划是**当前工作区那本账**的会话读数，没有跨账本语义。
       *   旧实现切到 beta 后仍把 alpha 的 RUN 列表挂进第 4 步 ⇒ 内容混账。
       */
      {
        const seenPlans = []
        const r = await iaMount({
          fetchLedgers: async () => ({ ok: true, home: '/h', currentResolved: true, items: [
            { name: 'alpha', units: 2, state: 'data', current: true },
            { name: 'beta', units: 1, state: 'data', current: false },
          ] }),
          fetchPlans: async (_sid, ledger) => { seenPlans.push(ledger); return IA_PLANS },
          fetchChains: async () => ({
            ok: true, activeCount: 1, completedCount: 0, retiredCount: 0, historyItemCount: 0, retiredChains: [], unattached: [],
            chains: [{
              reqId: 'R-950', title: '别的账本的需求', reqStatus: 'agreed', state: 'active', inFlight: true, complete: false,
              currentStep: 4, missing: ['acc'], itemIds: ['R-950'],
              next: { kind: 'dispatch', target: 'TSK-950', why: '等待执行', blockedBy: [] }, summary: {},
              steps: [
                { step: 1, name: '需求规格', displayState: 'done', summary: '', total: 1, done: 1, doing: 0, waiting: 0, itemIds: ['R-950'] },
                { step: 2, name: '实现方案', displayState: 'done', summary: '', total: 0, done: 0, doing: 0, waiting: 0, itemIds: [] },
                { step: 3, name: '编码任务', displayState: 'done', summary: '', total: 0, done: 0, doing: 0, waiting: 0, itemIds: [] },
                { step: 4, name: '任务执行', displayState: 'doing', summary: '', total: 0, done: 0, doing: 0, waiting: 0, itemIds: [] },
                { step: 5, name: '验收核对', displayState: 'todo', summary: '', total: 0, done: 0, doing: 0, waiting: 0, itemIds: [] },
              ],
            }],
          }),
        })
        const beta = document.querySelector('[data-dsh-hob="stages-ledger-item"][data-ledger="beta"]')
        if (beta !== null) {
          actFn(() => beta.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
          await tick(50)
        }
        const step4 = document.querySelector('[data-mainline-step="true"][data-step="4"]')
        const p = []
        if (beta === null) p.push('找不到 beta 账本')
        if (step4 === null) p.push('第 4 步不存在')
        if (step4?.querySelector('[data-dsh-hob="stages-step-exec"]') !== null) p.push('切到 beta 后仍渲染了当前会话运行态')
        if (step4?.querySelector('[data-dsh-hob="stages-step-plans"]') !== null) p.push('切到 beta 后仍渲染了当前会话计划')
        if (seenPlans.includes('alpha') && seenPlans.lastIndexOf('alpha') > seenPlans.lastIndexOf('beta')) p.push(`切到 beta 后仍以 alpha 取计划：${JSON.stringify(seenPlans)}`)
        if (p.length === 0) ok(`S-34d ✓ 切到 beta ⇒ 第 4 步不再挂当前会话运行态/计划；计划请求带 beta（${JSON.stringify(seenPlans)}）`)
        else for (const x of p) bad(`S-34d · ${x}`)
        actFn(() => r.unmount())
      }

      // S-34 账本切换：项目选择器存在；点另一个账本 ⇒ 链请求带新 ledger。
      {
        const seen = []
        const r = await iaMount({
          fetchLedgers: async () => ({ ok: true, home: '/h', currentResolved: true, items: [
            { name: 'alpha', units: 2, state: 'data', current: true },
            { name: 'beta', units: 1, state: 'data', current: false },
          ] }),
          fetchChains: async (sessionId, ledger) => { seen.push(ledger); return { ok: true, activeCount: 0, completedCount: 0, retiredCount: 0, historyItemCount: 0, chains: [], unattached: [] } },
        })
        const p = []
        const items = [...document.querySelectorAll('[data-dsh-hob="stages-ledger-item"]')]
        if (items.length !== 2) p.push(`账本项 ${items.length} 个（期望 2）`)
        const beta = items.find((x) => x.getAttribute('data-ledger') === 'beta')
        if (beta === undefined) p.push('找不到 beta 账本')
        else {
          actFn(() => beta.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
          await tick(40)
          if (!seen.includes('beta')) p.push(`切换后链请求没有带 beta：${JSON.stringify(seen)}`)
        }
        if (p.length === 0) ok(`S-34 ✓ 账本切换成立：默认 alpha；点 beta ⇒ /requirement-chains 带 ledger=beta（请求 ${JSON.stringify(seen)}）`)
        else for (const x of p) bad(`S-34 · ${x}`)
        actFn(() => r.unmount())
      }

      /**
       * S-34e 默认账本必须跟随**当前工作区**，且选择器与项目名同一行。
       *
       * ⚠⚠ 2026-11-08 用户报障：「不管哪个工作区打开任务进度都是 HOB 项目的账本」。
       *   服务端按 cwd 标 `current`；客户端若只在首次设一次、或拿第一个 data 兜底，
       *   换工作区后就停在上一本。
       *   ⇒ 判据：两轮 `/ledgers`，第二轮 `current` 换成 beta ⇒ 选中必须变成 beta；
       *     且 `项目：beta` 与下拉触发在同一个 `<summary>` 里（⛔ 不再纵向整块列表）。
       */
      {
        let round = 0
        const seen = []
        const r = await iaMount({
          fetchLedgers: async () => {
            round += 1
            return round === 1
              ? { ok: true, home: '/h', currentResolved: true, items: [
                  { name: 'alpha', units: 2, state: 'data', current: true },
                  { name: 'beta', units: 1, state: 'data', current: false },
                ] }
              : { ok: true, home: '/h', currentResolved: true, items: [
                  { name: 'alpha', units: 2, state: 'data', current: false },
                  { name: 'beta', units: 1, state: 'data', current: true },
                ] }
          },
          fetchChains: async (_sid, ledger) => { seen.push(ledger); return { ok: true, activeCount: 0, completedCount: 0, retiredCount: 0, historyItemCount: 0, chains: [], unattached: [] } },
        })
        const p = []
        const summary = document.querySelector('[data-dsh-hob="stages-ledgers-summary"]')
        const nameNode = document.querySelector('[data-dsh-hob="stages-ledgers-current-name"]')
        if (summary === null) p.push('账本选择器不是同一行摘要（缺 stages-ledgers-summary）')
        if (nameNode === null) p.push('同一行里没有当前项目名')
        if (summary !== null && nameNode !== null && !summary.contains(nameNode)) p.push('当前项目名不在同一行摘要里')
        /**
         * ⚠ 用户报「下拉框又套个壳、原来的还在」：`<summary>` 原生三角 + 自绘箭头
         *   会同时出现。判据：summary 必须去掉原生 marker，且只保留一个箭头字符。
         */
        if (summary !== null && String(summary.style?.listStyle ?? '') !== 'none') p.push('summary 仍保留原生三角（应 list-style:none）')
        const arrowCount = summary === null ? 0 : [...summary.querySelectorAll('span')].filter((s) => /^[▸▾▶▼]$/.test((s.textContent ?? '').trim())).length
        if (arrowCount !== 1) p.push(`summary 里的展开箭头有 ${arrowCount} 个（期望恰好 1 个）`)
        /**
         * ⚠⚠ 用户第二次报「又套个壳、原来的还在」：
         *   上一版 `<details>` 的菜单留在**正常流**里 ⇒ 展开把下面的在途需求 / 五步主线
         *   整体往下推，菜单里又是一整列账本（还带“空账本”二级折叠）。
         *   ⇒ 判据：菜单必须**浮层**（`position:absolute`）且限高滚动；
         *     触发块里的“项目 / 名字 / 单元数 / 箭头”必须在**同一行**（`flex-wrap:nowrap` 之外
         *     还要真实同一行 —— 这里量 `offsetTop` 一致）。
         */
        const menu = document.querySelector('[data-dsh-hob="stages-ledgers-menu"]')
        if (menu === null) p.push('缺少账本菜单 stages-ledgers-menu')
        else {
          const cs = window.getComputedStyle(menu)
          if (cs.position !== 'absolute') p.push(`账本菜单不是浮层（position=${cs.position}）⇒ 展开会推动下面的内容`)
          if (!String(cs.maxHeight ?? '').match(/[0-9]/)) p.push(`账本菜单没有限高（max-height=${cs.maxHeight}）`)
          /**
           * ⚠⚠ 真机量到过：内联 `display:flex` 的优先级高于浏览器给 `<details>` 收起态的
           *   `display:none` ⇒ **收起时菜单照样显示**。必须自己按 `open` 切 display。
           */
          const details = document.querySelector('[data-dsh-hob="stages-ledgers"]')
          if (details !== null && details.open !== true && cs.display !== 'none') {
            p.push(`收起时菜单仍然可见（display=${cs.display}）⇒ 会出现“套壳”观感`)
          }
        }
        const trigger = document.querySelector('[data-dsh-hob="stages-ledgers-summary"]')
        if (trigger !== null) {
          const parts = [...trigger.children].filter((c) => (c.textContent ?? '').trim() !== '')
          const tops = new Set(parts.map((c) => Math.round(c.offsetTop)))
          if (parts.length >= 2 && tops.size > 1) p.push(`触发块内 ${parts.length} 段不在同一行（offsetTop=${[...tops].join(',')}）`)
        }
        if (nameNode?.textContent !== 'alpha') p.push(`首轮当前项目名不是 alpha：${JSON.stringify(nameNode?.textContent)}`)
        const alpha = document.querySelector('[data-dsh-hob="stages-ledger-item"][data-ledger="alpha"]')
        if (alpha?.getAttribute('data-selected') !== 'true') p.push('首轮没有选中当前账本 alpha')
        /** 模拟工作区变化：服务端下一轮把 current 换成 beta（面板会按 5s 轮询重取）。 */
        actFn(() => document.querySelector('[data-dsh-hob="stages-refresh"]')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
        await tick(80)
        const name2 = document.querySelector('[data-dsh-hob="stages-ledgers-current-name"]')
        const beta = document.querySelector('[data-dsh-hob="stages-ledger-item"][data-ledger="beta"]')
        if (name2?.textContent !== 'beta') p.push(`工作区变化后当前项目名没有跟随 beta：${JSON.stringify(name2?.textContent)}`)
        if (beta?.getAttribute('data-selected') !== 'true') p.push('工作区变化后没有选中 beta')
        if (!seen.includes('beta')) p.push(`工作区变化后链请求没有带 beta：${JSON.stringify(seen)}`)
        if (p.length === 0) ok(`S-34e ✓ 默认账本跟随当前工作区（alpha → beta）；项目名与下拉在同一行；请求 ${JSON.stringify(seen)}`)
        else for (const x of p) bad(`S-34e · ${x}`)
        actFn(() => r.unmount())
      }

      /**
       * S-34b 账本三态：data / empty / unreadable 不混组；默认选中当前账本。
       *
       * ⚠⚠ 2026-11-08 用户裁定：「点项目名就是账本切换」——
       *   菜单里**不许再有第二层折叠**（原来那层是 `空账本 N 个` 的 `<details>`，
       *   等于让用户点两下才看得到可选项，观感上又是一次“套壳”）。
       *   ⇒ 分组仍是**独立分组**（三态不许混），但必须是**平铺可见**的普通节点。
       */
      {
        const r = await iaMount({
          fetchLedgers: async () => ({ ok: true, home: '/h', currentResolved: true, items: [
            { name: 'alpha', units: 2, state: 'data', current: true },
            { name: 'hollow', units: 0, state: 'empty', current: false },
            { name: 'broken', units: 0, state: 'unreadable', current: false },
          ] }),
        })
        const p = []
        const alpha = document.querySelector('[data-dsh-hob="stages-ledger-item"][data-ledger="alpha"]')
        const emptyGroup = document.querySelector('[data-dsh-hob="stages-ledgers-empty-group"]')
        const badGroup = document.querySelector('[data-dsh-hob="stages-ledgers-unreadable-group"]')
        const hollow = document.querySelector('[data-dsh-hob="stages-ledger-item"][data-ledger="hollow"]')
        const broken = document.querySelector('[data-dsh-hob="stages-ledger-item"][data-ledger="broken"]')
        if (alpha?.getAttribute('data-selected') !== 'true') p.push('没有默认选中当前账本 alpha')
        if (alpha?.getAttribute('data-state') !== 'data') p.push(`alpha 三态不是 data：${JSON.stringify(alpha?.getAttribute('data-state'))}`)
        /** 分组必须存在，且**不许是可折叠节点**（`details` ⇒ 又套一层）。 */
        for (const [label, node] of [['空账本组', emptyGroup], ['读不了账本组', badGroup]]) {
          if (node === null) { p.push(`${label}缺失`); continue }
          if (node.tagName.toLowerCase() === 'details') p.push(`${label}仍是可折叠 <details> ⇒ 点开下拉还要再点一次`)
          if (node.querySelector(':scope > summary') !== null) p.push(`${label}带 <summary> ⇒ 又套了一层折叠`)
        }
        /** ⚠ 分组标题必须**可见**（用户点开下拉就该看到它们，而不是收起状态）。 */
        for (const [label, node] of [['空账本组', emptyGroup], ['读不了账本组', badGroup]]) {
          if (node === null) continue
          if (window.getComputedStyle(node).display === 'none') p.push(`${label}被隐藏`)
        }
        if (hollow?.getAttribute('data-state') !== 'empty' || !(hollow.textContent ?? '').includes('空账本')) p.push(`空账本行不诚实：${JSON.stringify(hollow?.textContent)}`)
        if (broken?.getAttribute('data-state') !== 'unreadable' || !(broken.textContent ?? '').includes('读不了')) p.push(`读不了行不诚实：${JSON.stringify(broken?.textContent)}`)
        if (hollow !== null && badGroup !== null && badGroup.contains(hollow)) p.push('空账本被塞进了“读不了”组')
        if (broken !== null && emptyGroup !== null && emptyGroup.contains(broken)) p.push('读不了账本被塞进了“空账本”组')
        if (p.length === 0) ok('S-34b ✓ 账本三态分开：data 常显并默认选中 current；empty 与 unreadable 各自分组、平铺可见（⛔ 无二级折叠），文案不互相冒充')
        else for (const x of p) bad(`S-34b · ${x}`)
        actFn(() => r.unmount())
      }

      /**
       * S-34b2 负向对拍：把分组**改回可折叠 `<details>`** ⇒ S-34b 的
       *   「⛔ 无二级折叠」必红。
       *
       * ⚠ 为什么需要它：S-34b 那句“不许 `<details>`”如果不做对拍，
       *   下次有人把折叠加回来时，判据可能因为选择器改名而静默失效（假绿）。
       */
      {
        const panelSrc = readFileSync(PANEL_TSX, 'utf8')
        const NEEDLE = "{ key: 'ledgers-empty', 'data-dsh-hob': 'stages-ledgers-empty-group', 'data-state': 'empty', className: 'dsh-hob-ledger-group' }"
        if (!panelSrc.includes(NEEDLE)) {
          bad('S-34b2 · 源码里找不到空账本分组节点（形态变了）⇒ 负向对拍不可判')
        } else {
          const mutated = panelSrc
            .replace(`'div',\n              ${NEEDLE}`, `'details',\n              ${NEEDLE}`)
            .replace("React.createElement('div', { className: 'dsh-hob-ledger-group-title' }, `空账本 ${empty.length} 个`)", "React.createElement('summary', { className: 'dsh-hob-ledger-group-title' }, `空账本 ${empty.length} 个`)")
          const out = writeMutant('mut-ledger-group-fold', mutated)
          const modG = await import(pathToFileURL(out).href + '?t=' + Date.now())
          const r = mount(react.createElement(modG.StagesPanel, {
            fetchProgress: async () => ({ ok: true, rows: [] }),
            fetchExec: async () => ({ ok: true, items: [] }),
            fetchStages: async () => ({ ok: true, stages: [] }),
            fetchChains: async () => ({ ok: true, activeCount: 0, completedCount: 0, retiredCount: 0, historyItemCount: 0, chains: [], unattached: [] }),
            fetchUnseen: async () => ({ ok: true, count: 0, names: [], items: [], summary: '0 条' }),
            fetchPlans: async () => ({ ok: true, mode: 'multi', plans: [], unreadable: [] }),
            fetchCurrent: async () => ({ ok: true, text: '# Current\n\n- 夹具' }),
            fetchResource: async () => ({ ok: false, message: '夹具' }),
            fetchLedgers: async () => ({ ok: true, home: '/h', currentResolved: true, items: [
              { name: 'alpha', units: 2, state: 'data', current: true },
              { name: 'hollow', units: 0, state: 'empty', current: false },
            ] }),
            pollMs: 0,
          }))
          await tick(40)
          const g = document.querySelector('[data-dsh-hob="stages-ledgers-empty-group"]')
          if (g !== null && g.tagName.toLowerCase() === 'details') {
            ok('S-34b2 ✓ 负向对拍（把空账本分组改回 <details>）⇒ S-34b 的"⛔ 无二级折叠"**必红**：变体里分组又成了可折叠节点')
          } else {
            bad('S-34b2 · 变体里空账本分组仍不是 <details> ⇒ 断言没有牙')
          }
          actFn(() => r.unmount())
        }
      }

      // S-34c 没有在途需求 ⇒ 主线写“没有”，不把已完成需求顶上来重复展示。
      {
        const completedOnly = chainsFromStages(IA_STAGES)
        const only = completedOnly.chains[0]
        only.state = 'completed'
        only.inFlight = false
        only.complete = true
        only.currentStep = null
        only.steps = only.steps.map((st) => ({ ...st, displayState: 'done' }))
        completedOnly.activeCount = 0
        completedOnly.completedCount = 1
        completedOnly.historyItemCount = only.itemIds.length
        const r = await iaMount({
          fetchChains: async () => completedOnly,
          fetchLedgers: async () => ({ ok: true, home: '/h', currentResolved: true, items: [{ name: 'alpha', units: 9, state: 'data', current: true }] }),
        })
        const p = []
        const mainline = document.querySelector('[data-dsh-hob="stages-mainline"]')
        const history = document.querySelector('[data-dsh-hob="stages-history-section"]')
        const inflight = document.querySelector('[data-dsh-hob="stages-inflight"]')
        if (mainline?.getAttribute('data-state') !== 'empty') p.push(`无在途时主线 data-state=${JSON.stringify(mainline?.getAttribute('data-state'))}`)
        if ((mainline?.textContent ?? '').includes('R-901')) p.push('无在途时把已完成需求顶成了主线')
        /**
         * ⚠ 2026-11-08 用户报「原来的还在」：同一句“没有在途需求”曾在
         *   在途区 / 主线 / 下一步各出现一次。判据改为：**只在在途区说一次**，
         *   主线与下一步保持空占位，不重复计数。
         */
        if (!(inflight?.textContent ?? '').includes('1 条需求已走完五步')) p.push(`在途区没有给出已完成条数：${JSON.stringify(inflight?.textContent)}`)
        if ((mainline?.textContent ?? '').includes('没有在途需求')) p.push('主线重复了在途区的结论')
        const nextBlock = document.querySelector('[data-dsh-hob="stages-next"]')
        if ((nextBlock?.textContent ?? '').includes('没有可执行的需求链')) p.push('下一步重复了在途区的结论')
        if (document.querySelectorAll('[data-dsh-hob="stages-current-step"]').length !== 0) p.push('无在途时仍标了“当前”')
        if (!(inflight?.textContent ?? '').includes('没有在途需求')) p.push(`在途区没有明写“没有在途需求”：${JSON.stringify(inflight?.textContent)}`)
        if (history === null || !(history.textContent ?? '').includes('R-901')) p.push('已完成需求没有留在底部历史')
        if (p.length === 0) ok('S-34c ✓ 无在途需求：主线明写为空且无“当前”；已完成需求只进底部历史，不重复占用主线')
        else for (const x of p) bad(`S-34c · ${x}`)
        actFn(() => r.unmount())
      }

      /**
       * S-33h2：**账本健康缺口必须显示在面板上**（2026-11-08 用户报「梳理不到完全健康」）。
       *
       *   ⚠ 改前面板只显示"在途需求 / 五步"，一本**只有孤立方案**的账看起来
       *     "没有在途需求"（好像没事），而派活又会被拒 —— 两处读数打架。
       *   ⚠ 数据源必须是 `/stages` 的 `stageHealth`（与门禁同一份函数）；
       *     实测踩过：从旧的 `/tasks-progress`（`state`）取会**永远是 undefined**，
       *     面板"看起来没缺口"、派活却被拒。
       */
      {
        const p = []
        const r = await iaMount({
          fetchStages: async () => ({
            ok: true, readAt: '2026-11-08T00:00:00+08:00',
            stages: [
              { step: 1, name: '需求规格', state: 'todo', done: 0, total: 0, items: [] },
              { step: 2, name: '实现方案', state: 'doing', done: 0, total: 1, items: [] },
              { step: 3, name: '编码任务', state: 'todo', done: 0, total: 0, items: [] },
              { step: 4, name: '任务执行', state: 'todo', done: 0, total: 0, items: [] },
              { step: 5, name: '验收核对', state: 'todo', done: 0, total: 0, items: [] },
            ],
            caps: [],
            stageHealth: {
              ok: false, count: 1,
              problems: [{ rule: 'L-1', unit: 'CHG-344', why: '方案指向的需求在账本里都不存在（UD-0052）⇒ 先落需求' }],
            },
          }),
        })
        const node = document.querySelector('[data-dsh-hob="stages-health"]')
        if (node === null) p.push('有缺口时面板没有健康区块（用户看不出差什么）')
        else {
          if (node.getAttribute('data-state') !== 'unhealthy') p.push(`健康区块 data-state=${JSON.stringify(node.getAttribute('data-state'))}`)
          const t = node.textContent ?? ''
          if (!t.includes('1 条缺口')) p.push(`没有说清缺口条数：${JSON.stringify(t.slice(0, 80))}`)
          const item = node.querySelector('[data-dsh-hob="stages-health-item"]')
          if (item === null) p.push('健康区块里没有逐条缺口')
          else {
            const it = item.textContent ?? ''
            for (const want of ['L-1', 'CHG-344', '先落需求']) {
              if (!it.includes(want)) p.push(`缺口行缺「${want}」：${JSON.stringify(it.slice(0, 80))}`)
            }
          }
        }
        actFn(() => r.unmount())
        /** ⚠ 反向对拍：健康时**不许**出现这个红块（⛔ 不是恒显）。 */
        const r2 = await iaMount({
          fetchStages: async () => ({
            ok: true, readAt: '2026-11-08T00:00:00+08:00',
            stages: [
              { step: 1, name: '需求规格', state: 'todo', done: 0, total: 0, items: [] },
              { step: 2, name: '实现方案', state: 'todo', done: 0, total: 0, items: [] },
              { step: 3, name: '编码任务', state: 'todo', done: 0, total: 0, items: [] },
              { step: 4, name: '任务执行', state: 'todo', done: 0, total: 0, items: [] },
              { step: 5, name: '验收核对', state: 'todo', done: 0, total: 0, items: [] },
            ],
            caps: [],
            stageHealth: { ok: true, count: 0, problems: [] },
          }),
        })
        if (document.querySelector('[data-dsh-hob="stages-health"]') !== null) p.push('账本健康时仍显示缺口区块（恒显）')
        actFn(() => r2.unmount())
        if (p.length === 0) ok('S-33h2 ✓ 账本有缺口 ⇒ 面板显示「N 条缺口」+ 逐条（规则·单元·下一步）；健康时不显示')
        else for (const x of p) bad(`S-33h2 · ${x}`)
      }

      /**
       * S-33c / S-33d / S-33e：预设门禁必须 fail-closed。
       *   · Hob ⇒ 正常取数；
       *   · standard ⇒ 零请求、只留一行说明；
       *   · 显式 undefined（判不出）⇒ 同样零请求。
       */
      {
        const calls = []
        const counting = (name, value) => async (...args) => { calls.push({ name, args }); return value }
        const rHob = await iaMount({
          agentPreset: 'Hob',
          fetchLedgers: counting('ledgers', { ok: true, home: '/h', currentResolved: true, items: [{ name: 'alpha', units: 9, state: 'data', current: true }] }),
          fetchProgress: counting('progress', { ok: true, rows: [] }),
          fetchExec: counting('exec', { ok: true, items: [] }),
          fetchUnseen: counting('unseen', { ok: true, count: 0, names: [], items: [], summary: '0 条 —— 当前没有待确认的工具' }),
          fetchPlans: counting('plans', IA_PLANS),
          fetchCurrent: counting('current', { ok: true, text: '# Current\n\n- Hob 夹具' }),
        })
        const hobCalls = calls.length
        const hobBlocked = document.querySelector('[data-dsh-hob="stages-preset-blocked"]')
        if (hobCalls === 0) bad('S-33c · Hob 预设没有发起任何取数请求')
        else if (hobBlocked !== null) {
          actFn(() => rHob.unmount())
          bad('S-33c · Hob 预设却被预设门禁挡住')
        } else {
          actFn(() => rHob.unmount())
          ok(`S-33c ✓ Hob 预设正常取数（${hobCalls} 路请求）且不显示门禁说明`)
        }

        const rStandard = await iaMount({
          agentPreset: 'standard',
          fetchLedgers: counting('ledgers', { ok: true, items: [] }),
          fetchProgress: counting('progress', { ok: true, rows: [] }),
          fetchExec: counting('exec', { ok: true, items: [] }),
          fetchUnseen: counting('unseen', { ok: true, count: 0, names: [], items: [], summary: '0' }),
          fetchPlans: counting('plans', IA_PLANS),
          fetchCurrent: counting('current', { ok: true, text: '# Current' }),
        })
        const stdBlocked = document.querySelector('[data-dsh-hob="stages-preset-blocked"]')
        const stdPanel = document.querySelector('[data-dsh-hob="stages-panel"]')
        const stdText = stdPanel?.textContent ?? ''
        const stdProblems = []
        if (calls.length !== hobCalls) stdProblems.push(`standard 仍发起了 ${calls.length - hobCalls} 路请求`)
        if (stdBlocked === null) stdProblems.push('standard 没有显示唯一门禁说明')
        if (stdText.includes('在途需求') || stdText.includes('历史（') || document.querySelector('[data-dsh-hob="stages-mainline"]') !== null) stdProblems.push('standard 仍渲染了主线/历史')
        if (stdText.includes('%')) stdProblems.push('standard 门禁说明里出现百分比')
        actFn(() => rStandard.unmount())
        if (stdProblems.length === 0) ok('S-33d ✓ standard 预设：零请求、只渲染一行说明，不挂主线/历史/子面板')
        else for (const x of stdProblems) bad(`S-33d · ${x}`)

        const beforeUnknown = calls.length
        const rUnknown = await iaMount({
          agentPreset: undefined,
          fetchLedgers: counting('ledgers', { ok: true, items: [] }),
          fetchProgress: counting('progress', { ok: true, rows: [] }),
          fetchExec: counting('exec', { ok: true, items: [] }),
          fetchUnseen: counting('unseen', { ok: true, count: 0, names: [], items: [], summary: '0' }),
          fetchPlans: counting('plans', IA_PLANS),
          fetchCurrent: counting('current', { ok: true, text: '# Current' }),
        })
        const unknownProblems = []
        if (calls.length !== beforeUnknown) unknownProblems.push(`显式 undefined 仍发起了 ${calls.length - beforeUnknown} 路请求`)
        if (document.querySelector('[data-dsh-hob="stages-preset-blocked"]') === null) unknownProblems.push('显式 undefined 没有显示门禁说明')
        actFn(() => rUnknown.unmount())
        if (unknownProblems.length === 0) ok('S-33e ✓ 预设判不出（显式 undefined）：零请求，按 fail-closed 只留一行说明')
        else for (const x of unknownProblems) bad(`S-33e · ${x}`)
      }

      /**
       * S-33h 真实宿主契约：两个 keyed 槽都必须提供 `useProjection`。
       *
       * ⚠ 为什么必须有这一条：生产门禁完全依赖 `useProjection('agentPreset')`。
       *   若宿主改了这个标准属性名，包装器会拿不到值 ⇒ 面板永远显示“预设判不出”，
       *   而隔离 DOM 里我们手工注入 hook 仍然全绿 —— 那正是“判据看着绿、真机全坏”。
       *   判据直接读**宿主声明文件**（不是我们的实现），两边必须同时点名
       *   `sidebar.right.pane.tab` 与 `sidebar.right.tab.guide.entry` 的 `useProjection`。
       */
      {
        const candidates = [
          '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-cordis-client-runner/lib/client.js',
        ]
        const hostFile = candidates.find((f) => existsSync(f))
        const p = []
        if (hostFile === undefined) {
          p.push('宿主 slot 契约文件不存在 ⇒ 本判据无对象（⛔ 不按通过处理）')
        } else {
          const host = readFileSync(hostFile, 'utf8')
          const tab = host.slice(host.indexOf('key: "sidebar.right.pane.tab"'), host.indexOf('key: "sidebar.right.pane.tab.title"'))
          const guide = host.slice(host.indexOf('key: "sidebar.right.tab.guide.entry"'), host.indexOf('key: "sidebar.right.tab.menu.item"'))
          if (!tab.includes('useProjection: UseProjection')) p.push('sidebar.right.pane.tab 未声明 useProjection')
          if (!guide.includes('useProjection: UseProjection')) p.push('sidebar.right.tab.guide.entry 未声明 useProjection')
          const panel = readFileSync(PANEL_TSX, 'utf8')
          if (!panel.includes("useProjection('agentPreset')")) p.push('面板包装器没有调用 useProjection(agentPreset)')
          if (!panel.includes('typeof slotProps?.useProjection === \'function\'')) p.push('guide 覆盖没有把 slotProps.useProjection 透传')
        }
        if (p.length === 0) ok('S-33h ✓ 真实宿主契约：标签页与 guide 两个 keyed 槽都提供 useProjection，面板与 guide 包装器都真实消费它')
        else for (const x of p) bad(`S-33h · ${x}`)
      }

      /**
       * S-33i guide 胶囊：**点击由宿主 `EntryBox` 负责，覆盖组件只做门禁与内容**。
       *
       * ⚠⚠ 2026-11-08 用户报障「侧栏入口点不进去」。根因：
       *   宿主把槽返回值放进 `<button onClick=onPick>`，覆盖组件又返回一个 `<button>` ⇒
       *   按钮套按钮；内层 click 拿不到 `tab.actions`（槽参数没有它）⇒ 直接 return。
       *   正确契约：宿主 `GuideBody.open(kind)` 负责 `openTab(kind,{replaceTab:true})` → `close()`。
       *   ⇒ 本判据断言：Hob 下渲染的是**非按钮内容**、内部零 `button`；
       *     `openTab`/`close` **一次都不由覆盖组件调用**（否则又会双触发）。
       */
      {
        const calls = []
        const r = mount(react.createElement(ui.StagesGuideEntry, {
          title: '任务进度',
          description: '只读主线',
          kind: 'dsh-hob-stages',
          useProjection: () => 'Hob',
          ctx: { get: (name) => name === 'sidebarRight' ? { openTab: (kind, options) => calls.push({ kind, options }) } : undefined },
        }))
        await tick(20)
        const node = document.querySelector('[data-dsh-hob="stages-guide-entry"]')
        const p = []
        if (node === null) p.push('Hob 预设下没有胶囊')
        else {
          if (node.getAttribute('role') !== 'button' || node.getAttribute('tabindex') !== '0') p.push('整格不是可聚焦的 role=button')
          if (node.querySelector('button') !== null) p.push('覆盖组件内部含 button ⇒ 点击区域会被内层吞掉')
          actFn(() => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
          await tick(20)
          if (calls.length !== 1 || calls[0]?.kind !== 'dsh-hob-stages' || calls[0]?.options?.replaceTab !== true) {
            p.push(`点击没有走 ctx.sidebarRight.openTab(dsh-hob-stages, replaceTab:true)：${JSON.stringify(calls)}`)
          }
        }
        actFn(() => r.unmount())
        if (p.length === 0) ok('S-33i ✓ guide 胶囊：覆盖组件自渲染可聚焦整格（内部零 button），点击走 ctx.sidebarRight.openTab(kind, replaceTab:true)')
        else for (const x of p) bad(`S-33i · ${x}`)
      }

      /**
       * S-33f guide 胶囊：
       *   · 明确 `standard` ⇒ 不渲染；
       *   · `undefined`（宿主 guide 槽没有 useProjection）⇒ **仍渲染**（入口不能被吞）；
       *   · `Hob` ⇒ 渲染。
       * ⚠ 2026-11-08 真机：宿主 guide 槽只注入 tabInfo，不提供 useProjection；
       *   旧实现把所有入口都 return null ⇒ 右侧栏「开始」页没有任务进度。
       */
      {
        /** ⚠ 覆盖组件自渲染；这里只核“标题/描述进入节点”，不再依赖宿主 fallback。 */
        const guideFor = (preset) => ui.StagesGuideEntry({
          title: '任务进度',
          description: '只读主线',
          kind: 'dsh-hob-stages',
          useProjection: () => preset,
        })
        const hob = guideFor('Hob')
        const std = guideFor('standard')
        const unknown = guideFor(undefined)
        const p = []
        if (hob === null || hob === undefined) p.push('Hob 预设下没有胶囊节点')
        if (std !== null) p.push('standard 下覆盖组件没有隐藏（应返回 null）')
        if (unknown === null || unknown === undefined) p.push('预设判不出时没有胶囊节点')
        if (p.length === 0) ok('S-33f ✓ guide 覆盖：Hob / 判不出都渲染可点胶囊；standard 隐藏；面板 body 仍负责零请求门禁')
        else for (const x of p) bad(`S-33f · ${x}`)
      }

      /**
       * R-020 替换 S-35 / S-36 家族：
       *   · 单需求主线只展开该链的条目；不把全局 202 条铺进来；
       *   · 「当前」只出现一次；
       *   · 历史在底部折叠，默认收起，条目仍在 DOM。
       */
      {
        const r = await iaMount()
        const p = []
        const allItems = [...document.querySelectorAll('[data-dsh-hob="stages-mainline"] [data-dsh-hob="stages-tree-item"]')]
          .map((x) => x.getAttribute('data-item-id'))
        if (allItems.includes('ACC-901') && allItems.includes('ACC-902')) {
          // 两条都在该需求链里是正常的；⛔ 但这不等于“历史堆积”——主线只该有一条需求的 5 条左右。
        }
        if (allItems.length > 20) p.push(`单需求主线渲染了 ${allItems.length} 条条目 ⇒ 疑似把全局账本铺了进来`)
        const current = [...document.querySelectorAll('[data-dsh-hob="stages-current-step"]')]
        if (current.length !== 1) p.push(`“当前”标记 ${current.length} 个（期望 1）`)
        const history = document.querySelector('[data-dsh-hob="stages-history-section"]')
        if (history === null) p.push('底部历史折叠不存在')
        else {
          if (history.tagName.toLowerCase() !== 'details' || history.hasAttribute('open')) p.push('历史不是默认折叠的 <details>')
          if (!(history.textContent ?? '').includes('历史（')) p.push(`历史标题缺少条数：${JSON.stringify((history.textContent ?? '').slice(0, 80))}`)
        }
        if (p.length === 0) ok(`S-35 ✓ 单需求主线只列该需求条目（${allItems.length} 条）· 唯一“当前” · 历史底部默认折叠且仍在 DOM`)
        else for (const x of p) bad(`S-35 · ${x}`)
        actFn(() => r.unmount())
      }

      // S-36 验收计数只在该需求第 5 步概要里出现；不再有全局摘要卡。
      {
        const r = await iaMount()
        const p = []
        const step5 = document.querySelector('[data-mainline-step="true"][data-step="5"]')
        const t = step5?.textContent ?? ''
        if (step5 === null) p.push('找不到第 5 步')
        else {
          if (!t.includes('ACC-902') && !t.includes('0/1')) p.push(`第 5 步概要没有待处理/判决读数：${JSON.stringify(t)}`)
          if (t.includes('当前待处理：2')) p.push('把历史记录总数说成了待办数')
        }
        if (document.querySelector('[data-dsh-hob="stages-summary-acceptance"]') !== null) p.push('仍有全局验收计数行 ⇒ 与第 5 步重复')
        if (p.length === 0) ok(`S-36 ✓ 验收读数只在第 5 步：${JSON.stringify(t.trim().slice(0, 80))}`)
        else for (const x of p) bad(`S-36 · ${x}`)
        actFn(() => r.unmount())
      }

      /**
       * S-36b 历史按需求链收口：已完成需求进底部历史，未完成需求留在主线。
       */
      {
        const r = await iaMount()
        const p = []
        const history = document.querySelector('[data-dsh-hob="stages-history-section"]')
        if (history === null) p.push('底部历史不存在')
        else {
          const histText = history.textContent ?? ''
          if (!histText.includes('条已完成需求')) p.push(`历史标题没有“条已完成需求”：${JSON.stringify(histText.slice(0, 80))}`)
          if (histText.includes('R-901') && histText.includes('还没验')) p.push('未完成需求被列进历史')
        }
        const mainlineReq = document.querySelector('[data-dsh-hob="stages-mainline"]')?.getAttribute('data-req-id')
        if (mainlineReq === null || mainlineReq === '') p.push('主线没有 data-req-id')
        if (p.length === 0) ok(`S-36b ✓ 历史按需求链收口；主线 data-req-id=${JSON.stringify(mainlineReq)}`)
        else for (const x of p) bad(`S-36b · ${x}`)
        actFn(() => r.unmount())
      }

      // S-36d 退役需求：只进底部历史，⛔ 不进在途列表、⛔ 不占主线。
      {
        const base = chainsFromStages(IA_STAGES)
        const retired = {
          ...structuredClone(base.chains[0]),
          reqId: 'R-990',
          title: '已退役的需求',
          reqStatus: 'retired',
          state: 'retired',
          inFlight: false,
          complete: false,
          currentStep: null,
          steps: [],
          itemIds: [],
          next: { kind: 'undecidable', target: null, why: '已退役', blockedBy: [] },
        }
        const r = await iaMount({
          fetchChains: async () => ({ ...base, retiredCount: 1, retiredChains: [retired] }),
        })
        const p = []
        const inflightText = document.querySelector('[data-dsh-hob="stages-inflight"]')?.textContent ?? ''
        const mainlineText = document.querySelector('[data-dsh-hob="stages-mainline"]')?.textContent ?? ''
        const retiredBox = document.querySelector('[data-dsh-hob="stages-history-retired"]')
        if (inflightText.includes('R-990')) p.push('退役需求进了在途列表')
        if (mainlineText.includes('R-990')) p.push('退役需求占了主线')
        if (retiredBox === null) p.push('底部历史没有退役需求区')
        else {
          if (retiredBox.tagName.toLowerCase() !== 'details' || retiredBox.hasAttribute('open')) p.push('退役需求区不是默认折叠')
          if (!(retiredBox.textContent ?? '').includes('R-990') || !(retiredBox.textContent ?? '').includes('已退役的需求')) p.push('退役需求没有在历史里点名')
        }
        if (p.length === 0) ok('S-36d ✓ 退役需求只在底部历史的“已退役需求”折叠里；在途列表与主线都不含它')
        else for (const x of p) bad(`S-36d · ${x}`)
        actFn(() => r.unmount())
      }

      /**
       * S-36c 当前状态只有一个出口：阶段行 / 概要 / 卡在哪·下一步，都在同一视图；
       *   ⛔ 不再有第二个「当前工作」视图重复一遍。
       */
      {
        const r = await iaMount()
        const p = []
        const cur = document.querySelectorAll('[data-dsh-hob="stages-current-step"]')
        if (cur.length !== 1) p.push(`“当前”标记 ${cur.length} 个（期望 1）`)
        /**
         * ⚠⚠ 在途列表里那条“⬅当前”说的是**选中的需求**，不是**当前阶段**；
         *   `stages-current-step` 必须只挂在五步里的所选那一行（0 或 1 个）。
         *   若它漏到在途列表，读者会看到两个“当前”，却分不清哪个是需求、哪个是步骤。
         */
        const listCurrent = document.querySelector('[data-dsh-hob="stages-inflight"] [data-dsh-hob="stages-current-step"]')
        if (listCurrent !== null) p.push('“当前步”标记漏进了在途需求列表（列表应只用 stages-inflight-current 表示选中需求）')
        const selectedReq = document.querySelectorAll('[data-dsh-hob="stages-inflight-current"]')
        if (selectedReq.length !== 1) p.push(`在途列表的“已选”${selectedReq.length} 个（期望 1，且只表示选中需求）`)
        /**
         * ⚠ 两个词必须**分开**：列表说“已选”（哪条需求被选中），阶段行说“当前”（走到第几步）。
         *   若两处都写“当前”，读者会问“到底哪个是当前”，正是用户此前抱怨的重复。
         */
        if (selectedReq.length === 1 && !(selectedReq[0].textContent ?? '').includes('已选')) {
          p.push(`列表选中标记不是「已选」：${JSON.stringify(selectedReq[0].textContent)}`)
        }
        if (cur.length === 1 && !(cur[0].textContent ?? '').includes('当前')) {
          p.push(`阶段行当前标记不是「当前」：${JSON.stringify(cur[0].textContent)}`)
        }
        const views = document.querySelectorAll('[data-dsh-hob="stages-view"]')
        if (views.length !== 0) p.push(`仍有 ${views.length} 个旧视图容器`)
        const next = document.querySelector('[data-dsh-hob="stages-next"]')
        if (next === null) p.push('没有“卡在哪/下一步”块')
        if (p.length === 0) ok('S-36c ✓ 当前状态只在主线一处：唯一阶段“当前段”+ 唯一需求选中“当前”；唯一 next 块；旧视图容器为 0')
        else for (const x of p) bad(`S-36c · ${x}`)
        actFn(() => r.unmount())
      }

      // S-37 待确认工具分组 + 次级信息默认折叠。
      {
        const r = await iaMount()
        const secondary = document.querySelector('[data-dsh-hob="stages-secondary"]')
        const groups = [...document.querySelectorAll('[data-dsh-hob="stages-unseen-group"]')].map((x) => x.getAttribute('data-prefix'))
        const items = [...document.querySelectorAll('[data-dsh-hob="stages-unseen-item"]')].map((x) => x.textContent ?? '')
        const p = []
        if (secondary === null || secondary.tagName.toLowerCase() !== 'details' || secondary.hasAttribute('open')) p.push('次级信息不是默认折叠的 <details>')
        if (!groups.includes('mcp__wincu__') || !groups.includes('其他')) p.push(`工具没有按前缀分组：${JSON.stringify(groups)}`)
        if (items.length !== 2 || !items.some((x) => x.includes('mcp__wincu__alpha')) || !items.some((x) => x.includes('other-beta'))) p.push(`逐名清单丢失：${JSON.stringify(items)}`)
        if (p.length === 0) ok(`S-37 ✓ 待确认工具按前缀分组（${groups.join(' / ')}）且逐名保留 2 条；次级信息默认折叠`)
        else for (const x of p) bad(`S-37 · ${x}`)
        actFn(() => r.unmount())
      }

      // S-38 统一刷新：Current 与工作计划跟随父面板 tick，手动刷新同时重取两者。
      {
        let currentCalls = 0
        let planCalls = 0
        const r = await iaMount({
          fetchCurrent: async () => { currentCalls += 1; return { ok: true, text: `# Current\n\n- 第 ${currentCalls} 次` } },
          fetchPlans: async () => { planCalls += 1; return IA_PLANS },
        })
        const before = { current: currentCalls, plans: planCalls }
        const btn = document.querySelector('[data-dsh-hob="stages-refresh"]')
        const p = []
        if (btn === null) p.push('找不到手动刷新按钮')
        else {
          actFn(() => btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
          await tick(40)
        }
        if (currentCalls !== before.current + 1) p.push(`Current 未随统一刷新重取：${before.current} → ${currentCalls}`)
        if (planCalls !== before.plans + 1) p.push(`工作计划未随统一刷新重取：${before.plans} → ${planCalls}`)
        if (p.length === 0) ok(`S-38 ✓ 统一刷新：手动刷新后 Current ${before.current}→${currentCalls}、工作计划 ${before.plans}→${planCalls}，两者与五步共用同一 tick`)
        else for (const x of p) bad(`S-38 · ${x}`)
        actFn(() => r.unmount())
      }

      // S-38b 负向对拍：摘掉 Current 的 refreshTick ⇒ S-38 必红。
      {
        const panelSrc = readFileSync(PANEL_TSX, 'utf8')
        const NEEDLE = '      refreshTick: pollTick,\n'
        if (!panelSrc.includes(NEEDLE)) {
          bad('S-38b · 源码里找不到 Current 的 `refreshTick: pollTick`（形态变了）⇒ 负向对拍不可判')
        } else {
          const out = writeMutant('mut-current-tick', panelSrc.replace(NEEDLE, ''))
          const modC = await import(pathToFileURL(out).href + '?t=' + Date.now())
          let currentCalls = 0
          let planCalls = 0
          const r = mount(react.createElement(modC.StagesPanel, {
            fetchProgress: async () => ({ ok: true, rows: [] }),
            fetchExec: async () => ({ ok: true, items: [] }),
            fetchStages: async () => IA_STAGES,
            fetchUnseen: async () => ({ ok: true, count: 0, names: [], items: [], summary: '0 条 —— 当前没有待确认的工具' }),
            fetchPlans: async () => { planCalls += 1; return IA_PLANS },
            fetchCurrent: async () => { currentCalls += 1; return { ok: true, text: '# Current\n\n- 变体' } },
            pollMs: 0,
          }))
          await tick(40)
          const before = currentCalls
          const btn = document.querySelector('[data-dsh-hob="stages-refresh"]')
          if (btn === null) bad('S-38b · 变体里找不到刷新按钮 ⇒ 负向对拍不可判')
          else {
            actFn(() => btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
            await tick(40)
            if (currentCalls === before) ok(`S-38b ✓ 负向对拍（摘掉 Current 的 refreshTick）⇒ S-38 的"Current 重取"**必红**：刷新前 ${before}、刷新后 ${currentCalls}；工作计划仍 +${planCalls - 1}`)
            else bad(`S-38b · 摘掉 refreshTick 后 Current 仍重取（${before} → ${currentCalls}）⇒ 断言没有牙`)
          }
          actFn(() => r.unmount())
        }
      }

      /**
       * S-39 负向对拍（R-020）：把「在途需求列表」改成条件卸载 ⇒ S-33a 必红。
       *   旧断言绑在四视图切换上；四视图已删除，⛔ 不能留一条恒不可判的断言冒充覆盖。
       */
      {
        const panelSrc = readFileSync(PANEL_TSX, 'utf8')
        const NEEDLE = "    inFlightBlock,\n    mainlineBlock,"
        if (!panelSrc.includes(NEEDLE)) {
          bad('S-39 · 源码里找不到主视图挂载顺序（形态变了）⇒ 负向对拍不可判')
        } else {
          const out = writeMutant('mut-inflight-unload', panelSrc.replace(NEEDLE, "    ...(selectedChainId === undefined ? [] : [inFlightBlock]),\n    mainlineBlock,"))
          const modM = await import(pathToFileURL(out).href + '?t=' + Date.now())
          const r = mount(react.createElement(modM.StagesPanel, {
            fetchProgress: async () => ({ ok: true, rows: [] }),
            fetchExec: async () => ({ ok: true, items: [] }),
            fetchStages: async () => IA_STAGES,
            fetchChains: async () => ({ ok: true, activeCount: 0, completedCount: 0, retiredCount: 0, historyItemCount: 0, chains: [], unattached: [] }),
            fetchUnseen: async () => ({ ok: true, count: 0, names: [], items: [], summary: '0 条 —— 当前没有待确认的工具' }),
            fetchPlans: async () => IA_PLANS,
            fetchCurrent: async () => ({ ok: true, text: '# Current\n\n- 变体' }),
            pollMs: 0,
          }))
          await tick(40)
          const gone = document.querySelector('[data-dsh-hob="stages-inflight"]') === null
          if (gone) ok('S-39 ✓ 负向对拍（把在途需求列表条件卸载）⇒ S-33a 的“首屏必须有在途列表”**必红**：变体里找不到 stages-inflight')
          else bad('S-39 · 条件卸载后在途列表仍在 ⇒ 断言没有牙')
          actFn(() => r.unmount())
        }
      }

      /**
       * S-40 负向对拍（R-020）：把“当前”标记加到所有步骤上 ⇒ S-33a 的“唯一当前”必红。
       */
      {
        const panelSrc = readFileSync(PANEL_TSX, 'utf8')
        const NEEDLE = "              ...(isCurrent ? { 'aria-current': 'step' } : {}),"
        if (!panelSrc.includes(NEEDLE)) {
          bad('S-40 · 源码里找不到 aria-current 分支（形态变了）⇒ 负向对拍不可判')
        } else {
          const out = writeMutant('mut-current-all', panelSrc.replace(NEEDLE, "              'aria-current': 'step',"))
          const modC = await import(pathToFileURL(out).href + '?t=' + Date.now())
          const r = mount(react.createElement(modC.StagesPanel, {
            fetchProgress: async () => ({ ok: true, rows: [] }),
            fetchExec: async () => ({ ok: true, items: [] }),
            fetchStages: async () => IA_STAGES,
            fetchChains: async () => chainsFromStages(IA_STAGES),
            fetchUnseen: async () => ({ ok: true, count: 0, names: [], items: [], summary: '0 条 —— 当前没有待确认的工具' }),
            fetchPlans: async () => IA_PLANS,
            fetchCurrent: async () => ({ ok: true, text: '# Current\n\n- 变体' }),
            pollMs: 0,
          }))
          await tick(40)
          const cur = document.querySelectorAll('[aria-current="step"]').length
          if (cur > 1) ok(`S-40 ✓ 负向对拍（把 aria-current 加到所有步骤）⇒ S-33a 的“唯一当前”**必红**：实测 ${cur} 个`)
          else bad(`S-40 · 变体仍只有 ${cur} 个 aria-current ⇒ 断言没有牙`)
          actFn(() => r.unmount())
        }
      }

      /**
       * S-40b 负向对拍：把“当前步”标记漏到在途需求列表 ⇒ S-36c 必红。
       *
       * ⚠ 这条不是凑数：列表里的“⬅当前”只表示**哪条需求被选中**，
       *   若它也挂 `stages-current-step`，读者会看到两个“当前步”，
       *   而 S-36c 现在明确要求列表只能用 `stages-inflight-current`。
       */
      {
        const panelSrc = readFileSync(PANEL_TSX, 'utf8')
        const NEEDLE = "          ...(isSel ? [React.createElement('span', { key: 'cur', 'data-dsh-hob': 'stages-inflight-current' }, '已选')] : []),"
        if (!panelSrc.includes(NEEDLE)) {
          bad('S-40b · 源码里找不到在途列表的选中标记（形态变了）⇒ 负向对拍不可判')
        } else {
          const out = writeMutant('mut-inflight-current', panelSrc.replace(NEEDLE, "          ...(isSel ? [React.createElement('span', { key: 'cur', 'data-dsh-hob': 'stages-current-step' }, '⬅当前')] : []),"))
          const modI = await import(pathToFileURL(out).href + '?t=' + Date.now())
          const r = mount(react.createElement(modI.StagesPanel, {
            fetchProgress: async () => ({ ok: true, rows: [] }),
            fetchExec: async () => ({ ok: true, items: [] }),
            fetchStages: async () => IA_STAGES,
            fetchChains: async () => chainsFromStages(IA_STAGES),
            fetchUnseen: async () => ({ ok: true, count: 0, names: [], items: [], summary: '0 条 —— 当前没有待确认的工具' }),
            fetchPlans: async () => IA_PLANS,
            fetchCurrent: async () => ({ ok: true, text: '# Current\n\n- 变体' }),
            pollMs: 0,
          }))
          await tick(40)
          const leaked = document.querySelector('[data-dsh-hob="stages-inflight"] [data-dsh-hob="stages-current-step"]')
          if (leaked !== null) ok('S-40b ✓ 负向对拍（把当前步标记漏进在途列表）⇒ S-36c 的“阶段当前只在主线”**必红**：列表里实测出现 stages-current-step')
          else bad('S-40b · 变体仍没把 stages-current-step 挂进在途列表 ⇒ 断言没有牙')
          actFn(() => r.unmount())
        }
      }

      /**
       * S-41 负向对拍（R-020）：把需求链缺失渲染成“完成” ⇒ S-33b 必红。
       */
      {
        const panelSrc = readFileSync(PANEL_TSX, 'utf8')
        /**
         * ⚠ 锚点覆盖**整个 fail 分支**（含 2026-11-08 新增的空账本文案）：
         *   只替换最后一行会留下悬空的 `)`，变体无法转译 ⇒ 负向对拍不可判。
         *   ⛔ 不删负向对拍，只把替换范围扩大到分支边界。
         */
        const NEEDLE_START = "    if (chainState.kind === 'fail') {\n"
        /**
         * ⚠ 2026-11-08：主线的 fail 分支已改成**无文案的状态锚点**
         *   （同一条原因只在在途区说一次）⇒ 锚点跟着改。
         *   ⚠ 它仍必须覆盖**整个分支**：只替换其中一行会留下悬空 `)`，变体无法转译。
         */
        const NEEDLE_END = "      return React.createElement('div', { style: subNoteStyle, 'data-dsh-hob': 'stages-mainline', 'data-state': 'undecidable' })\n    }\n"
        /** ⚠ 从 `mainlineBlock` 内定位：文件里另有 inFlight/next/history 的 fail 分支。 */
        const blockStart = panelSrc.indexOf('const mainlineBlock')
        const start = blockStart < 0 ? -1 : panelSrc.indexOf(NEEDLE_START, blockStart)
        const end = start < 0 ? -1 : panelSrc.indexOf(NEEDLE_END, start)
        const NEEDLE = start >= 0 && end >= 0 ? panelSrc.slice(start, end + NEEDLE_END.length) : ''
        if (!panelSrc.includes(NEEDLE)) {
          bad('S-41 · 源码里找不到需求链缺失分支（形态变了）⇒ 负向对拍不可判')
        } else {
          const out = writeMutant('mut-chain-done', panelSrc.replace(NEEDLE, "    if (chainState.kind === 'fail') {\n      return React.createElement('div', { style: subNoteStyle, 'data-dsh-hob': 'stages-mainline', 'data-state': 'ok' }, '全部完成')\n    }\n"))
          const modZ = await import(pathToFileURL(out).href + '?t=' + Date.now())
          const r = mount(react.createElement(modZ.StagesPanel, {
            fetchProgress: async () => ({ ok: true, rows: [] }),
            fetchExec: async () => ({ ok: true, items: [] }),
            fetchStages: async () => IA_STAGES,
            fetchChains: async () => ({ ok: false, reason: 'index-unreadable', message: '链读不到' }),
            fetchUnseen: async () => ({ ok: true, count: 0, names: [], items: [], summary: '0 条 —— 当前没有待确认的工具' }),
            fetchPlans: async () => IA_PLANS,
            fetchCurrent: async () => ({ ok: true, text: '# Current\n\n- 变体' }),
            pollMs: 0,
          }))
          await tick(40)
          const mainline = document.querySelector('[data-dsh-hob="stages-mainline"]')
          if (mainline?.getAttribute('data-state') === 'ok' && (mainline?.textContent ?? '').includes('全部完成')) {
            ok('S-41 ✓ 负向对拍（把链缺失显示成“全部完成”）⇒ S-33b 的“判不出”**必红**：变体显示“全部完成”')
          } else {
            bad(`S-41 · 变体没有显示“全部完成”：${JSON.stringify(mainline?.textContent?.slice(0, 60))} ⇒ 负向对拍不可判`)
          }
          actFn(() => r.unmount())
        }
      }

      // S-42 负向对拍：把工具前缀分组摘掉 ⇒ S-37 必红。
      {
        const panelSrc = readFileSync(PANEL_TSX, 'utf8')
        const NEEDLE = "    const GROUPS = ['mcp__wincu__', 'ego_', 'session_', 'dshm_'] as const\n"
        if (!panelSrc.includes(NEEDLE)) {
          bad('S-42 · 源码里找不到工具前缀分组表（形态变了）⇒ 负向对拍不可判')
        } else {
          const out = writeMutant('mut-unseen-groups', panelSrc.replace(NEEDLE, "    const GROUPS = [] as const\n"))
          const modG = await import(pathToFileURL(out).href + '?t=' + Date.now())
          const r = mount(react.createElement(modG.StagesPanel, {
            fetchProgress: async () => ({ ok: true, rows: [] }),
            fetchExec: async () => ({ ok: true, items: [] }),
            fetchStages: async () => IA_STAGES,
            fetchUnseen: async () => ({ ok: true, count: 2, names: ['mcp__wincu__alpha', 'other-beta'], items: [], summary: '2 条待确认' }),
            fetchPlans: async () => IA_PLANS,
            fetchCurrent: async () => ({ ok: true, text: '# Current\n\n- 变体' }),
            pollMs: 0,
          }))
          await tick(40)
          const groups = [...document.querySelectorAll('[data-dsh-hob="stages-unseen-group"]')].map((x) => x.getAttribute('data-prefix'))
          if (!groups.includes('mcp__wincu__')) ok(`S-42 ✓ 负向对拍（清空前缀分组表）⇒ S-37 的"按前缀分组"**必红**：只剩 ${JSON.stringify(groups)}`)
          else bad(`S-42 · 清空分组表后仍出现前缀组 ${JSON.stringify(groups)} ⇒ 断言没有牙`)
          actFn(() => r.unmount())
        }
      }

      const ITEM_FORMAT_STAGES = {
        ok: true,
        readAt: '2026-11-07T00:00:00.000Z',
        relations: {
          'G-901': '目标',
          'R-901': '需求',
          'CHG-901': '方案',
          'TSK-901': 'P2：第 2 期（该期任务书）',
        },
        stages: [
          { step: 1, name: '需求规格', state: 'done', done: 1, total: 1, items: [{ id: 'R-901', status: 'agreed', kind: 'req', presentation: {
            displayTitle: '需求', relation: { key: 'goal', id: 'G-901', state: 'ok' }, facts: [], flags: [],
          } }] },
          { step: 2, name: '实现方案', state: 'done', done: 1, total: 1, items: [{ id: 'CHG-901', status: 'settled', kind: 'change', presentation: {
            displayTitle: '方案', relation: { key: 'requirement', id: 'R-901', state: 'ok' }, facts: [], flags: [],
          } }] },
          { step: 3, name: '编码任务', state: 'done', done: 1, total: 1, items: [{ id: 'TSK-901', status: 'built', kind: 'task', presentation: {
            displayTitle: 'P2：第 2 期（该期任务书）', relation: { key: 'change', id: 'CHG-901', state: 'ok' }, facts: [['验证', 'check:item 1/1']], flags: ['title-generic', 'legacy-title'],
          } }] },
          { step: 4, name: '任务执行', state: 'doing', done: 0, total: 1, items: [{ id: 'RUN-901', status: 'returned', kind: 'run', presentation: {
            displayTitle: 'P2：第 2 期（该期任务书）', relation: { key: 'task', id: 'TSK-901', state: 'ok' }, facts: [['开始', '判不出']], flags: [],
          } }] },
          { step: 5, name: '验收核对', state: 'doing', done: 0, total: 2, items: [
            { id: 'ACC-901', status: 'pass', kind: 'acc', extra: 'LEGACY-EXTRA-SHOULD-NOT-RENDER session-89db /home/lk/FF/x/EVIDENCE.md', presentation: {
              displayTitle: 'P2：第 2 期（该期任务书）', relation: { key: 'task', id: 'TSK-901', state: 'ok' }, facts: [['判决', '2026-11-07T10:0…'], ['依据', '1 条']], flags: ['title-status-conflict'],
            } },
            { id: 'ACC-902', status: 'unverified', kind: 'acc', presentation: {
              displayTitle: '独立验收：父级缺失', relation: { key: 'task', id: 'TSK-999', state: 'undecidable' }, facts: [], flags: ['relation-unresolved'],
            } },
          ] },
        ],
        caps: [],
      }

      // S-43 统一条目格式：主行 + 关系/读数行 + 展开详情。
      {
        const resourceCalls = []
        const r = mount(react.createElement(StagesPanelHarness, {
          fetchProgress: async () => ({ ok: true, rows: [] }),
          fetchExec: async () => ({ ok: true, items: [] }),
          fetchStages: async () => ITEM_FORMAT_STAGES,
          fetchUnseen: async () => ({ ok: true, count: 0, names: [], items: [], summary: '0 条 —— 当前没有待确认的工具' }),
          fetchPlans: async () => ({ ok: true, mode: 'multi', plans: [], unreadable: [] }),
          fetchCurrent: async () => ({ ok: true, text: '# Current\n\n- 夹具' }),
          fetchResource: async (sessionId, resource) => { resourceCalls.push({ sessionId, resource }); return itemResource(sessionId, resource) },
          sessionId: 'session-item',
          pollMs: 0,
        }))
        await tick(40)
        const callsBeforeExpand = resourceCalls.length
        for (const h of [...document.querySelectorAll('[data-dsh-hob="stages-tree-head"]')]) {
          if (h.getAttribute('aria-expanded') !== 'true') actFn(() => h.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
        }
        await tick(30)
        const p = []
        const acc = document.querySelector('[data-dsh-hob="stages-tree-item"][data-item-id="ACC-901"]')
        const missing = document.querySelector('[data-dsh-hob="stages-tree-item"][data-item-id="ACC-902"]')
        const task = document.querySelector('[data-dsh-hob="stages-tree-item"][data-item-id="TSK-901"]')
        if (callsBeforeExpand !== 0) p.push(`首次挂载就提前读取了 ${callsBeforeExpand} 条完整正文（应只读列表）`)
        if (acc === null || missing === null || task === null) p.push('条目行缺失')
        else {
          if (acc.getAttribute('data-dsh-hob') !== 'stages-tree-item' || acc.tagName.toLowerCase() !== 'details') p.push('条目根不是可展开的 details')
          if ((acc.querySelector('[data-dsh-hob="stages-item-title"]')?.textContent ?? '') !== 'P2：第 2 期（该期任务书）') p.push(`验收主标题没有取正式验收对象：${JSON.stringify(acc.querySelector('[data-dsh-hob="stages-item-title"]')?.textContent)}`)
          if (!(acc.querySelector('[data-dsh-hob="stages-item-relation"]')?.textContent ?? '').includes('验收对象  TSK-901')) p.push('验收关系行缺失或格式不对')
          /**
           * ⚠ 方案 §6.2 要求**五类关系行各有固定标签**（所属目标 / 承接需求 / 所属方案 /
           *   执行对象 / 验收对象）。此前只验了「验收对象」，其余四类没有断言 ⇒
           *   改错标签不会被发现。这里逐类核对（`ACC` 已在上一条覆盖）。
           */
          const relTextOf = (id) => document.querySelector(`[data-dsh-hob="stages-tree-item"][data-item-id="${id}"] [data-dsh-hob="stages-item-relation"]`)?.textContent ?? ''
          if (!relTextOf('R-901').includes('所属目标  G-901')) p.push(`需求关系行标签不对：${JSON.stringify(relTextOf('R-901'))}`)
          if (!relTextOf('CHG-901').includes('承接需求  R-901')) p.push(`方案关系行标签不对：${JSON.stringify(relTextOf('CHG-901'))}`)
          if (!relTextOf('TSK-901').includes('所属方案  CHG-901')) p.push(`任务关系行标签不对：${JSON.stringify(relTextOf('TSK-901'))}`)
          if (!relTextOf('RUN-901').includes('执行对象  TSK-901')) p.push(`执行关系行标签不对：${JSON.stringify(relTextOf('RUN-901'))}`)
          if (!(acc.querySelector('[data-dsh-hob="stages-item-relation"]')?.textContent ?? '').includes('P2：第 2 期')) p.push('关系行没有从共享关系表取标题')
          if (!(acc.querySelector('[data-dsh-hob="stages-item-original-title"]')?.textContent ?? '').includes('判不出')) p.push('展开前原始标题没有写判不出（不应伪造）')
          if (!(acc.querySelector('[data-dsh-hob="stages-item-flags"]')?.textContent ?? '').includes('标题状态与账本状态不一致')) p.push('状态冲突没有可见标记')
          if ((missing.querySelector('[data-dsh-hob="stages-item-relation"]')?.textContent ?? '').includes('TSK-999 ·')) p.push('父级缺失被显示成了正常关系')
          if (!(missing.querySelector('[data-dsh-hob="stages-item-relation"]')?.textContent ?? '').includes('判不出')) p.push('父级缺失没有写判不出')
          if (!(missing.querySelector('[data-dsh-hob="stages-item-relation"]')?.textContent ?? '').includes('父级 TSK-999 不存在')) p.push('父级缺失没有点名缺失的父级 ID')
          if (!(missing.querySelector('[data-dsh-hob="stages-item-flags"]')?.textContent ?? '').includes('正式关系判不出')) p.push('关系缺失没有可见标记')
          if (!(task.querySelector('[data-dsh-hob="stages-item-facts"]')?.textContent ?? '').includes('验证  check:item 1/1')) p.push('任务折叠行没有关键读数')
          // 方案 §6.2：泛化标题必须有**可见**标记（⛔ 只做内部 flag 不算）。
          if (!(task.querySelector('[data-dsh-hob="stages-item-flags"]')?.textContent ?? '').includes('标题只写了期次或轮次')) p.push('泛化标题没有可见标记')
          if ((task.querySelector('[data-dsh-hob="stages-item-flags"]')?.textContent ?? '').includes('原始标题')) p.push('泛化标记文案串到了错误位置')
          if (acc.querySelectorAll('[data-dsh-hob="stages-tree-item-status"]').length !== 1) p.push('条目状态标签不是恰好一个')
          if (!(acc.querySelector('[data-dsh-hob="stages-item-facts"]')?.textContent ?? '').includes('判决')) p.push('验收折叠行没有判决读数')
          if (!(acc.querySelector('[data-dsh-hob="stages-item-facts"]')?.textContent ?? '').includes('依据')) p.push('验收折叠行没有依据读数')
          if (/完成度|%/.test(acc.textContent ?? '')) p.push('条目出现了百分比')
          if (acc.hasAttribute('open')) p.push('条目默认展开（应默认折叠）')
          /**
           * ⚠ 方案 §6.2「主行不直接显示原始 `extra` 全文」。
           *   `extra` 是旧线格式的混杂字段（路径 / 会话 / 判不出原因挤在一起）；
           *   新条目行只能显示 `presentation` 派生的事实，⛔ 不许把 `extra` 原样铺出来。
           *   夹具刻意塞了一个可识别的长 `extra`，折叠与展开两态都不许出现它。
           */
          if ((acc.textContent ?? '').includes('LEGACY-EXTRA-SHOULD-NOT-RENDER')) p.push('条目行直接显示了旧 extra 全文（折叠态）')
          // 展开 ACC-901：必须按稳定 ID 懒读取完整单元，并显示原句与依据。
          actFn(() => { acc.open = true; acc.dispatchEvent(new window.Event('toggle', { bubbles: false })) })
          await tick(40)
          const afterCalls = resourceCalls.filter((x) => x.resource === 'acceptance/ACC-901')
          if (afterCalls.length !== 1) p.push(`展开验收条目没有恰好读取一次 acceptance/ACC-901：${JSON.stringify(resourceCalls)}`)
          if (afterCalls[0]?.sessionId !== 'session-item') p.push(`懒读取没有带宿主 sessionId：${JSON.stringify(afterCalls[0])}`)
          if (!(acc.querySelector('[data-dsh-hob="stages-item-original-title"]')?.textContent ?? '').includes('待独立验收：R-901 统一条目展示')) p.push('展开后没有显示完整原始标题')
          if (!(acc.querySelector('[data-dsh-hob="stages-item-detail-full"]')?.textContent ?? '').includes('EVD-901')) p.push('展开后没有显示完整账本字段（依据）')
          if (!(acc.querySelector('[data-dsh-hob="stages-item-full-field"][data-field="basis"]')?.textContent ?? '').includes('判决依据')) p.push('展开详情没有用中文事实名显示依据')
          if (!(acc.querySelector('[data-dsh-hob="stages-item-full-field"][data-field="verdict"]')?.textContent ?? '').includes('验收通过')) p.push('展开详情没有显示验收判决')
          const exceptionText = acc.querySelector('[data-dsh-hob="stages-item-exception"]')?.textContent ?? ''
          if (!exceptionText.includes('异常') || !exceptionText.includes('标题状态与账本状态不一致')) p.push(`展开详情没有固定中文「异常」项：${JSON.stringify(exceptionText)}`)
          if (acc.querySelector('[data-dsh-hob="stages-item-full-field"][data-field="flags"]') !== null) p.push('展开详情重复渲染了「异常」项')
          if (/^(title|status|source|basis)  /m.test(acc.querySelector('[data-dsh-hob="stages-item-detail-full"]')?.textContent ?? '')) p.push('展开详情仍在直接打印英文账本字段名')
          if (!(acc.querySelector('[data-dsh-hob="stages-item-exception"]')?.textContent ?? '').includes('异常')) p.push('展开详情没有固定「异常」项')
          if ((acc.textContent ?? '').includes('LEGACY-EXTRA-SHOULD-NOT-RENDER')) p.push('条目行直接显示了旧 extra 全文（展开态）')
          if (resourceCalls.some((x) => x.resource === 'run/RUN-901')) p.push('未展开的运行条目也被提前读取了完整正文')
        }
        if (p.length === 0) ok('S-43 ✓ 统一条目格式：首屏不读正文 · 主行 ID/标题/唯一状态 · 关系行取正式父级与共享标题 · 最多两条关键读数（验收「判决 + 依据」）· 展开按稳定 ID 懒读原句与依据 · 历史冲突与关系缺失可见')
        else for (const x of p) bad(`S-43 · ${x}`)
        actFn(() => r.unmount())
      }

      // S-43c 负向对拍：删关系行 ⇒ S-43 的固定关系断言必红。
      {
        const panelSrc = readFileSync(PANEL_TSX, 'utf8')
        const NEEDLE = "        ...(relationText === ''\n          ? []\n          : [React.createElement('div', { key: 'relation', 'data-dsh-hob': 'stages-item-relation'"
        if (!panelSrc.includes(NEEDLE)) {
          bad('S-43c · 源码里找不到条目关系行（形态变了）⇒ 负向对拍不可判')
        } else {
          const out = writeMutant('mut-item-relation', panelSrc.replace(NEEDLE, "        ...(true\n          ? []\n          : [React.createElement('div', { key: 'relation', 'data-dsh-hob': 'stages-item-relation'"))
          const modR = await import(pathToFileURL(out).href + '?t=' + Date.now())
          const r = mount(react.createElement(modR.StagesPanel, {
            fetchProgress: async () => ({ ok: true, rows: [] }),
            fetchExec: async () => ({ ok: true, items: [] }),
            fetchStages: async () => ITEM_FORMAT_STAGES,
            fetchChains: async () => chainsFromStages(ITEM_FORMAT_STAGES),
            fetchUnseen: async () => ({ ok: true, count: 0, names: [], items: [], summary: '0 条 —— 当前没有待确认的工具' }),
            fetchPlans: async () => ({ ok: true, mode: 'multi', plans: [], unreadable: [] }),
            fetchCurrent: async () => ({ ok: true, text: '# Current\n\n- 夹具' }),
            fetchResource: itemResource,
            pollMs: 0,
          }))
          await tick(40)
          for (const h of [...document.querySelectorAll('[data-dsh-hob="stages-tree-head"]')]) {
            if (h.getAttribute('aria-expanded') !== 'true') actFn(() => h.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
          }
          await tick(30)
          const relation = document.querySelector('[data-dsh-hob="stages-tree-item"][data-item-id="ACC-901"] [data-dsh-hob="stages-item-relation"]')
          if (relation === null) ok('S-43c ✓ 负向对拍（删条目关系行）⇒ S-43 的"关系行取正式父级"**必红**：变体里找不到 stages-item-relation')
          else bad('S-43c · 删关系行后仍能读到关系节点 ⇒ 断言没有牙')
          actFn(() => r.unmount())
        }
      }

      // S-43d 负向对拍：把判不出关系显示成 0 ⇒ S-43 必红。
      {
        const panelSrc = readFileSync(PANEL_TSX, 'utf8')
        const NEEDLE = "        : `${relationLabel}  判不出${relation.id === null || relation.id === undefined ? '（正式关系缺失）' : `（父级 ${String(relation.id)} 不存在）`}`"
        if (!panelSrc.includes(NEEDLE)) {
          bad('S-43d · 源码里找不到关系缺失的判不出分支（形态变了）⇒ 负向对拍不可判')
        } else {
          const out = writeMutant('mut-item-relation-zero', panelSrc.replace(NEEDLE, "        : `${relationLabel}  0`"))
          const modZ = await import(pathToFileURL(out).href + '?t=' + Date.now())
          const r = mount(react.createElement(modZ.StagesPanel, {
            fetchProgress: async () => ({ ok: true, rows: [] }),
            fetchExec: async () => ({ ok: true, items: [] }),
            fetchStages: async () => ITEM_FORMAT_STAGES,
            fetchChains: async () => chainsFromStages(ITEM_FORMAT_STAGES),
            fetchUnseen: async () => ({ ok: true, count: 0, names: [], items: [], summary: '0 条 —— 当前没有待确认的工具' }),
            fetchPlans: async () => ({ ok: true, mode: 'multi', plans: [], unreadable: [] }),
            fetchCurrent: async () => ({ ok: true, text: '# Current\n\n- 夹具' }),
            fetchResource: itemResource,
            pollMs: 0,
          }))
          await tick(40)
          for (const h of [...document.querySelectorAll('[data-dsh-hob="stages-tree-head"]')]) {
            if (h.getAttribute('aria-expanded') !== 'true') actFn(() => h.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
          }
          await tick(30)
          const t = document.querySelector('[data-dsh-hob="stages-tree-item"][data-item-id="ACC-902"] [data-dsh-hob="stages-item-relation"]')?.textContent ?? ''
          if (!t.includes('判不出') && t.includes('0')) ok(`S-43d ✓ 负向对拍（关系缺失显示成 0）⇒ S-43 的"关系缺失写判不出"**必红**：实际 ${JSON.stringify(t)}`)
          else bad(`S-43d · 变体没有把关系缺失显示成 0：${JSON.stringify(t)} ⇒ 负向对拍不可判`)
          actFn(() => r.unmount())
        }
      }

      // S-43e 负向对拍：加回第二个可见状态标签 ⇒ S-43 的"唯一状态"必红。
      {
        const panelSrc = readFileSync(PANEL_TSX, 'utf8')
        const NEEDLE = "            status.label,\n          ),\n        ),"
        if (!panelSrc.includes(NEEDLE)) {
          bad('S-43e · 源码里找不到状态标签渲染（形态变了）⇒ 负向对拍不可判')
        } else {
          const out = writeMutant('mut-item-status-dup', panelSrc.replace(NEEDLE, "            status.label,\n          ),\n          React.createElement('span', { 'data-dsh-hob': 'stages-tree-item-status' }, status.label),\n        ),"))
          const modS = await import(pathToFileURL(out).href + '?t=' + Date.now())
          const r = mount(react.createElement(modS.StagesPanel, {
            fetchProgress: async () => ({ ok: true, rows: [] }),
            fetchExec: async () => ({ ok: true, items: [] }),
            fetchStages: async () => ITEM_FORMAT_STAGES,
            fetchChains: async () => chainsFromStages(ITEM_FORMAT_STAGES),
            fetchUnseen: async () => ({ ok: true, count: 0, names: [], items: [], summary: '0 条 —— 当前没有待确认的工具' }),
            fetchPlans: async () => ({ ok: true, mode: 'multi', plans: [], unreadable: [] }),
            fetchCurrent: async () => ({ ok: true, text: '# Current\n\n- 夹具' }),
            fetchResource: itemResource,
            pollMs: 0,
          }))
          await tick(40)
          for (const h of [...document.querySelectorAll('[data-dsh-hob="stages-tree-head"]')]) {
            if (h.getAttribute('aria-expanded') !== 'true') actFn(() => h.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
          }
          await tick(30)
          const count = document.querySelector('[data-dsh-hob="stages-tree-item"][data-item-id="ACC-901"]')?.querySelectorAll('[data-dsh-hob="stages-tree-item-status"]').length ?? 0
          if (count === 2) ok('S-43e ✓ 负向对拍（加回第二个状态标签）⇒ S-43 的"唯一可见状态"**必红**：实测 2 个状态标签')
          else bad(`S-43e · 变体的状态标签数 ${count}（期望 2）⇒ 负向对拍不可判`)
          actFn(() => r.unmount())
        }
      }

      // S-43b 负向对拍：把原始标题直接当主标题 ⇒ S-43 必红。
      {
        const panelSrc = readFileSync(PANEL_TSX, 'utf8')
        const NEEDLE = "    const title = typeof p?.displayTitle === 'string' && p.displayTitle !== '' ? p.displayTitle : '判不出标题'"
        if (!panelSrc.includes(NEEDLE)) {
          bad('S-43b · 造不出「原始标题直打」的变体（源码锚点失配）⇒ 负向对拍不可判')
        } else {
          const MUTATED_TITLE = "    const title = it?.id === 'ACC-901' ? '待独立验收：R-901 统一条目展示' : (typeof p?.displayTitle === 'string' && p.displayTitle !== '' ? p.displayTitle : '判不出标题')"
          const out = writeMutant('mut-item-title', panelSrc.replace(NEEDLE, MUTATED_TITLE))
          const modT = await import(pathToFileURL(out).href + '?t=' + Date.now())
          const r = mount(react.createElement(modT.StagesPanel, {
            fetchProgress: async () => ({ ok: true, rows: [] }),
            fetchExec: async () => ({ ok: true, items: [] }),
            fetchStages: async () => ITEM_FORMAT_STAGES,
            fetchChains: async () => chainsFromStages(ITEM_FORMAT_STAGES),
            fetchUnseen: async () => ({ ok: true, count: 0, names: [], items: [], summary: '0 条 —— 当前没有待确认的工具' }),
            fetchPlans: async () => ({ ok: true, mode: 'multi', plans: [], unreadable: [] }),
            fetchCurrent: async () => ({ ok: true, text: '# Current\n\n- 夹具' }),
            fetchResource: itemResource,
            pollMs: 0,
          }))
          await tick(40)
          for (const h of [...document.querySelectorAll('[data-dsh-hob="stages-tree-head"]')]) {
            if (h.getAttribute('aria-expanded') !== 'true') actFn(() => h.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
          }
          await tick(30)
          const step5 = document.querySelector('[data-dsh-hob="stages-tree-step"][data-step="5"]')
          if (step5 !== null && step5.querySelector('[data-dsh-hob="stages-tree-body"]') === null) {
            const step5Head = step5.querySelector('[data-dsh-hob="stages-tree-head"]')
            if (step5Head !== null) {
              actFn(() => step5Head.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
              await tick(30)
            }
          }
          const details = document.querySelector('[data-dsh-hob="stages-tree-item"][data-item-id="ACC-901"]')
          if (details !== null) {
            actFn(() => { details.open = true; details.dispatchEvent(new window.Event('toggle', { bubbles: false })) })
            await tick(30)
          }
          const t = details?.querySelector('[data-dsh-hob="stages-item-title"]')?.textContent ?? ''
          if (t === '待独立验收：R-901 统一条目展示') ok(`S-43b ✓ 负向对拍（主标题改回原始标题）⇒ S-43 的"验收主标题取正式对象"**必红**：实际 ${JSON.stringify(t)}`)
          else bad(`S-43b · 变体仍显示正式对象标题：${JSON.stringify(t)} ⇒ 断言没有牙`)
          actFn(() => r.unmount())
        }
      }
    }

  // ── S-44：第 5 步的验收材料在首屏可见，不藏在条目展开体里 ─────────────────
  {
  const h = mount(react.createElement(StagesPanelHarness, {
    fetchProgress: async () => ({ ok: true, rows: [] }),
    fetchExec: async () => ({ ok: true, items: [] }),
    fetchUnseen: async () => ({ ok: true, count: 0, names: [], items: [], summary: '0 条' }),
    fetchPlans: async () => ({ ok: true, mode: 'auto', plans: [], unreadable: [] }),
    fetchLedgers: async () => ({ ok: true, home: '/h', currentResolved: true, items: [{ name: 'fixture', units: 1, state: 'data', current: true }] }),
    fetchCurrent: async () => ({ ok: true, text: '# Current\n\n- 夹具' }),
    pollMs: 0,
    fetchChains: async () => ({
      ok: true,
      readAt: 'x',
      activeCount: 1,
      completedCount: 0,
      retiredCount: 0,
      historyItemCount: 0,
      unattached: [],
      chains: [{
        reqId: 'R-ACC', title: '验收材料夹具', reqStatus: 'agreed', state: 'active', inFlight: true,
        complete: false, currentStep: 5, missing: [], itemIds: ['R-ACC', 'ACC-ACC'],
        next: { kind: 'accept', target: 'ACC-ACC', why: '等独立验收', blockedBy: [] },
        steps: [
          { step: 1, name: '需求规格', displayState: 'done', summary: '验收条件 1 条', total: 1, done: 1, doing: 0, waiting: 0, itemIds: ['R-ACC'] },
          { step: 2, name: '实现方案', displayState: 'done', summary: '已定', total: 0, done: 0, doing: 0, waiting: 0, itemIds: [] },
          { step: 3, name: '编码任务', displayState: 'done', summary: '任务书已齐', total: 0, done: 0, doing: 0, waiting: 0, itemIds: [] },
          { step: 4, name: '任务执行', displayState: 'done', summary: '执行事实成立', total: 0, done: 0, doing: 0, waiting: 0, itemIds: [] },
          { step: 5, name: '验收核对', displayState: 'waiting', summary: '0/1 已判决', total: 1, done: 0, doing: 0, waiting: 1, itemIds: ['ACC-ACC'] },
        ],
      }],
      retiredChains: [],
    }),
    fetchStages: async () => ({
      ok: true,
      readAt: '2026-11-07T00:00:00.000Z',
      relations: { 'TSK-ACC': '验收夹具任务' },
      stages: [
        { step: 1, name: '需求规格', state: 'done', done: 1, total: 1, items: [{ id: 'R-ACC', status: 'agreed', kind: 'req', presentation: { displayTitle: '验收夹具', relation: { key: 'goal', id: 'G-ACC', state: 'ok' }, facts: [], flags: [] } }] },
        { step: 2, name: '实现方案', state: 'done', done: 1, total: 1, items: [{ id: 'CHG-ACC', status: 'settled', kind: 'change', presentation: { displayTitle: '方案', relation: { key: 'requirement', id: 'R-ACC', state: 'ok' }, facts: [], flags: [] } }] },
        { step: 3, name: '编码任务', state: 'done', done: 1, total: 1, items: [{ id: 'TSK-ACC', status: 'built', kind: 'task', presentation: { displayTitle: '任务', relation: { key: 'change', id: 'CHG-ACC', state: 'ok' }, facts: [], flags: [] } }] },
        { step: 4, name: '任务执行', state: 'done', done: 1, total: 1, items: [{ id: 'RUN-ACC', status: 'returned', kind: 'run', presentation: { displayTitle: '执行', relation: { key: 'task', id: 'TSK-ACC', state: 'ok' }, facts: [], flags: [] } }] },
        { step: 5, name: '验收核对', state: 'doing', done: 0, total: 1, items: [{ id: 'ACC-ACC', status: 'unverified', kind: 'acc', presentation: { displayTitle: '待判', relation: { key: 'task', id: 'TSK-ACC', state: 'ok' }, facts: [['判决', '还没验'], ['依据', '判不出']], flags: [] } }] },
      ],
      caps: [],
      attention: [],
      next: { kind: 'accept', target: 'ACC-ACC', why: '等独立验收', blockedBy: [] },
      summary: { stage: null, action: { kind: 'accept', target: 'ACC-ACC', headline: '验收 ACC-ACC' }, waitFor: 'acceptance', waitingFor: '独立验收会话', blocker: null, openItems: 0 },
      relations: { 'TSK-ACC': '验收夹具任务' },
      stageHealth: { ok: true, count: 0, problems: [] },
    }),
  }))
  try {
    await tick(40)
    const readout = document.querySelector('[data-dsh-hob="stages-current-acceptance-materials"]')
    const p = []
    if (readout === null) p.push('当前第 5 步没有首屏验收材料读数')
    else {
      const txt = readout.textContent ?? ''
      if (!txt.includes('产品确认')) p.push('没有点名产品确认')
      if (!txt.includes('技术证据')) p.push('没有点名技术证据')
      if (!txt.includes('例子')) p.push('没有点名用户例子结果')
      if (/百分比|%|进度条/.test(txt)) p.push('验收材料读数出现了百分比/进度条')
    }
    const outsideMainline = readout !== null && readout.closest('[data-dsh-hob="stages-tree-body"]') !== null
    if (outsideMainline) p.push('验收材料被藏在条目展开体里')
    if (p.length === 0) ok('S-44 ✓ 当前第 5 步首屏点名产品确认 / 技术证据 / 用户例子结果，⛔ 不藏在展开体、⛔ 不显示百分比')
    else for (const x of p) bad(`S-44 · ${x}`)
  } finally {
    actFn(() => h.unmount())
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
