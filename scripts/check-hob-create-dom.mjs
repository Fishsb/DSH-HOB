/**
 * **新建 Hob 创建链的"真 DOM"行为检查**（2026-10-22 · 任务书要求"不许拿源码正则冒充 UI 测试"）。
 *
 * ══ 它为什么存在 ═══════════════════════════════════════════════════════════
 *   上一版的 UI 判据全是**源码字符串锚点**（`grep` 到某个词就报绿）。那证明不了：
 *   入口**能不能点**、按钮**有没有真的渲染出来**、Escape 会不会关、焦点在哪、
 *   窄屏会不会重叠、用户会不会看到字面 `**`。
 *   ⇒ 本脚本把 `src/client/create-hob-dialog.tsx` **真编译**（tsc API，内存里转译）
 *   然后用 **jsdom + react-dom** **真的挂载**、真的派发事件、真的读 DOM。
 *
 * ══ 它测什么（逐条对应任务书的"正反用例"）═════════════════════════════════
 *   D-1 入口**真的渲染**且可点（不是"源码里有这个词"）
 *   D-2 入口**不遮挡**（容器 `pointer-events:none`、按钮 `auto`）
 *   D-3 弹窗**真的渲染**出三组控件（工作区 / 可读范围 3 项 / 推进方式 3 项）
 *   D-4 **值来自服务枚举**：服务给几个值，UI 就只出几个（⛔ 不抄死清单）
 *   D-5 **枚举拿不到 ⇒ 不能提交**（反例：服务只给 `ok:false`）
 *   D-6 **未选工作区 ⇒ 不能提交**（反例）
 *   D-7 **取消 / Escape ⇒ 零创建**（真派发 keydown，断言**没有** `create` 请求）
 *   D-8 **正常提交 ⇒ 恰好一次 create**，且 issue 带上工作区
 *   D-9 **字面 `**` 不出现**在用户可见文本里
 *   D-10 **「完全权限」旁有完整边界句**（四段齐全；⭐ 该档仍呈现但必须不可选）
 *   D-11 **中文标签**在位（三档 + 三方式）
 *   D-12 **初始焦点**落在工作区选择器
 *   D-13 **窄屏**（320px 视口）下无横向溢出、控件不重叠（按布局盒测）
 *   D-14 **失败且 `unsafe` ⇒ 文案必须警告**（⛔ 不许写成"安全的最低档"）
 *   D-15 **失败但已隔离 ⇒ 文案说"已持久隔离"**（与 D-14 分开）
 *   D-16 **成功 ⇒ 不留空窗**：`created()` 给出 sessionId，可读文本里能看到它
 *   D-18 **三档都呈现 · 后两项灰 + 标注「暂未开放」· 账本权限可选** ⭐ 2026-10-22（按就地纠正改写）
 *   D-19 **推进方式三档仍在且都可选**（用户明确"三档不变"那一轴）⭐ 2026-10-22
 *   D-20 **生产形态下取消 ⇒ 零会话**（零 issue / 零 create）⭐ 2026-10-22
 *   D-21 **用户可见文案不露内部配置值、不用字面 markdown 标记** ⭐ 2026-10-22
 *   D-22 **界面可选面被整体放宽也建不出宽档会话**（真服务端在场 · 端到端）⭐ 2026-10-22
 *
 * ══ 边界（如实说）══════════════════════════════════════════════════════════
 *   ⚠ 这是**隔离渲染**（jsdom），⛔ **不是真实宿主浏览器**：
 *     真实宿主的槽服务（`SlotCore`）、CSS 层叠、真实字体度量、原生 picker 都在宿主里。
 *   ⇒ 本脚本绿 ⇒ **组件行为**成立；**真实宿主渲染仍未验**（要重启 + 真浏览器）。
 *   ⚠ 依赖 `jsdom@25.0.1` / `react-dom@19.3.1` —— **已在 `package.json` 的
 *     `devDependencies` 里固定版本、并写进 `package-lock.json`**（2026-10-22 修）。
 *     ⚠ 上一轮是 `--no-save` 装的 ⇒ **干净安装后这一族会缺依赖** ⇒ 总跑非零。
 *     现在 `npm ci` 之后可直接跑（实测见 `archive/2026-10-22-session-create-final-path/`）。
 *   ⚠ 万一仍缺依赖（例如有人 `--omit=dev`）⇒ **跳过并说明 + exit 2**
 *     （⛔ 不静默算过；⚠ `check:all` 会把 exit 2 记成"未执行"并**整体非零**）。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/**
 * ══ ⚠⚠ **夹具必须跟着生产的开放面走**（2026-10-24 · t10 · B 席）═════════════════
 *
 * ── 改前是什么（审查席实测的确凿证据）────────────────────────────────────
 *   本文件的假服务写死 `openLevels: ['ledger']`，而生产
 *   `src/modules/session-create-channel.ts:1302` 下发的是 `openLevels: OPEN_READ_LEVELS`
 *   （2026-10-24 用户裁定 2 后 = **三档全开**）。
 *   ⇒ **夹具与生产相反** ⇒ D-10 / D-18 的绿是「靠一个**已经不存在的**服务形态换来的」：
 *     审查席把夹具改成生产形态后，D-10 / D-18 **双双变红**（因为断言还写着"后两项必须灰"）。
 *   ⚠ 这正是本仓最忌讳的那类缺陷：**判据测的不是生产**。
 *
 * ── 现在：**从生产常量派生**（⛔ 不再手抄一份档位清单）──────────────────────
 *   `OPEN_READ_LEVELS` 从 `src/shared/read-level-policy.ts` **真读**（按源码里的数组体解析），
 *   与 `PERMISSION_LEVELS`（`src/config.ts`）一起构成夹具的两个面：
 *     · `levels`    = 合法枚举全集（呈现面）
 *     · `openLevels`= 生产当前开放面（可选面）
 *   ⇒ 生产改开放面时，这里**自动跟着变**（⛔ 不需要有人记得来改夹具）。
 *   ⚠ 解析失败 ⇒ 直接判失败（⛔ 不许静默退回写死的三档 —— 那又变成"测一个假服务"）。
 */
/**
 * ⚠ **源码根可被 `HOB_DOM_ROOT` 指向一份临时副本**（负向对拍用：把生产常量改成旧形态，
 *   确认本条**会红**而不是恒绿）。⚠ 与 `check:orch` 的 `HOB_SA_ROOT` /
 *   `check:policy` 的 `HOB_SP_ROOT` **同一约定**（⛔ 不另造一套开关名）。
 * ⚠ 缺省 = 本仓（正常跑）。⚠ **只影响"读哪份源码"**，⛔ 不影响编译/挂载的组件
 *   （那仍取本仓的 `src/client`：本组测的是**界面**行为，界面代码没被改）。
 */
const SRC_BASE = process.env.HOB_DOM_ROOT !== undefined && process.env.HOB_DOM_ROOT !== ''
  ? process.env.HOB_DOM_ROOT
  : root
const readSrc = (rel) => {
  try { return readFileSync(join(SRC_BASE, rel), 'utf8') } catch { return '' }
}
const parseStrArray = (src, name) => {
  const m = new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(src)
  return m === null ? [] : [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}
const PROD_ENUM_LEVELS = parseStrArray(readSrc('src/config.ts'), 'PERMISSION_LEVELS')
const PROD_OPEN_LEVELS = parseStrArray(readSrc('src/shared/read-level-policy.ts'), 'OPEN_READ_LEVELS')
/**
 * ⚠⚠ **夹具这一侧必须是"字面值"，⛔ 不许也从生产常量派生**（t10 · 本组最要紧的一处更正）：
 *
 *   我第一版把夹具写成 `openLevels: PROD_OPEN_LEVELS`（从生产常量派生）——
 *   那会造出**一个恒绿判据**：夹具与断言取的是**同一个变量** ⇒ 生产改宽广，两边一起动
 *   ⇒ 断言永远相等 ⇒ **永远绿**。⚠ 那正是本任务要消灭的形态，我不能自己再造一个。
 *
 *   ⇒ 现在两侧**各自独立**：
 *     · `FIXTURE_OPEN_LEVELS` = **字面量**，代表"假服务今天会下发什么"
 *       （= 2026-10-24 裁定 2 之后的**生产形态**：三档全开）；
 *     · `PROD_OPEN_LEVELS`  = 从 `src/shared/read-level-policy.ts` **真读**的生产常量。
 *   ⇒ 断言 = 「界面可选面 == 生产常量」**且**「夹具 == 生产常量」：
 *     · 有人把**生产**收窄回 `['ledger']` ⇒ 界面照夹具画三档 ⇒ 与生产不符 ⇒ **红**；
 *     · 有人把**夹具**改回 `['ledger']` ⇒ 界面只画一档可选 ⇒ 与生产不符 ⇒ **红**；
 *     · 两边都改回 `['ledger']` ⇒ 由**夹具 vs 生产**那条独立的对账挡住（⛔ 不许两边一起错）。
 *   ⚠ 这是本仓的口径：**两个来源分别落地、再互相比对** —— 从一个来源派生两份，
 *     看起来在比对、其实是在自己跟自己比（`E-27` 同族）。
 */
const FIXTURE_OPEN_LEVELS = ['ledger', 'project', 'workspace']
/**
 * ⚠ 夹具侧的完整枚举（同样写字面量：假服务"会下发什么"是**独立事实**，⛔ 不派生）。
 */
const FIXTURE_ENUM_LEVELS = ['ledger', 'project', 'workspace']
/** ⚠ 一个**枚举外**的档位（用来测"开放面外的值仍被拒"那一面；⛔ 它不在任何清单里）。 */
const ILLEGAL_LEVEL = 'root'
/**
 * ⚠ **枚举值 → 中文显示名的唯一来源**（`create-hob-dialog.tsx` 的 `HOB_DIALOG_ZH`）。
 *   夹具要写"用户可见说明"时必须用它，⛔ 不许把 `ledger` / `workspace` 这类内部值
 *   直接拼进文案（那会被 D-21 判成"用户可见文本里出现内部配置值"）。
 */
const LEVEL_LABEL_ZH = (() => {
  const m = /const\s+HOB_DIALOG_ZH\s*:[^=]*=\s*\{([\s\S]*?)\n\}/.exec(readSrc('src/client/create-hob-dialog.tsx'))
  const out = {}
  if (m === null) return out
  for (const x of m[1].matchAll(/'level\.label\.(\w+)'\s*:\s*'([^']*)'/g)) out[x[1]] = x[2]
  return out
})()

let pass = 0
let fail = 0
const okLines = []
const badLines = []
const ok = (m) => { pass += 1; okLines.push(m); console.log(`  ✓ ${m}`) }
const bad = (m) => { fail += 1; badLines.push(m); console.log(`  ✗ ${m}`) }

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
  console.log(`  ⚠ D 组【跳过】—— 隔离渲染依赖不可用（${String(e?.message ?? e)}）`)
  console.log('       ⇒ 需 `npm i --no-save jsdom react-dom`；⛔ 本组**未执行**、不算通过')
  console.log('')
  console.log('  跳过 1 组（⛔ 不计入通过）')
  process.exit(2)
}

/**
 * 转译产物落在**工作区内的一次性目录**（⚠ `finally` 里删净）。
 *
 * ⚠ 为什么不用系统临时目录：ESM 的 `import 'react'` 从**模块所在目录**向上找
 *   `node_modules` —— 放到 `/tmp` 就找不到工作区那份 React（实测
 *   `Cannot find package 'react' imported from /tmp/...`）。
 *   放到工作区内 ⇒ 解析到**同一份** React（⛔ 不装第二份，否则 hooks 会崩）。
 * ⚠ 目录名带前缀 `.check-dom-`，收尾必删；⛔ 不许留在仓库里。
 */
  /**
   * ⚠ **路径带 pid**（B4.2 · 2026-11-10）：改前是固定名 ⇒ 两个自检进程并发跑会互相
   *   `rmSync` 掉对方正在用的目录（实测：`check:stages-panel-dom` / `check:preset-contracts`
   *   并发跑必红、串行跑必绿）。⚠ 这类「串行绿、并发红」的假失败会让人误判成真缺陷。
   *   ⇒ 带 `process.pid` 后互不干扰；`.gitignore` 的 `.check-*-work/` 通配仍覆盖它们。
   */
const work = join(root, '.check-dom-work-' + process.pid)
try { rmSync(work, { recursive: true, force: true }) } catch { /* 上轮残留 */ }
/**
 * ⚠⚠ **建不出临时目录 ⇒ `exit 2`（未执行），⛔ 不许记成"失败"**（2026-10-22 · P0-5）
 *
 * ── 改前是什么（这就是本单要治的）────────────────────────────────────
 *   这里直接 `mkdirSync(...)`，异常一路抛到最外层 `catch` ⇒ 印成
 *   「检查器自身异常 … exit 3」，而 `check:all` 把任何非 0/1 记成 **`· 未执行`** ——
 *   看似没问题，但**实际在只读 checkout 上会先崩在这里**，而
 *   `check:all` 的汇总会把"环境写不了"读成"这族有问题"。
 *   ⇒ 违反本仓三档口径（`check-all.mjs:15-22`）：`2` 才是"未执行"。
 *
 * ── 现在 ──────────────────────────────────────────────────────────────
 *   建目录失败 = **这台机器上跑不了这一族**（不是被测对象违规）⇒ 可读原因 + `exit 2`。
 *   ⚠ 判据逻辑一个字未改 —— 变的只是"环境缺条件"的归口。
 */
try {
  mkdirSync(join(work, 'out'), { recursive: true })
} catch (e) {
  console.log(`  ⚠ D 组【跳过】—— 仓根不可写，建不出临时目录（${String(e?.message ?? e)}）`)
  console.log('       ⇒ 需要**可写 checkout**（本族要在 `.check-dom-work/` 下转译 React 组件，')
  console.log('         ⛔ 不能放 /tmp：那会解析不到本仓的 React，见文件头那段说明）')
  console.log('       ⚠ 本组**未执行**、不算通过（exit 2）')
  console.log('')
  console.log('  跳过 1 组（⛔ 不计入通过）')
  process.exit(2)
}
const cleanup = () => { try { rmSync(work, { recursive: true, force: true }) } catch { /* 忽略 */ } }

try {
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * ⚠⚠ **转译：从"单文件"改成"整棵可达源码树 + 自证"**（2026-10-24 · B 席）
   * ══════════════════════════════════════════════════════════════════════════
   *
   * ── 改前是什么（三层缺陷，全部实测确认过）────────────────────────────────
   *   ① `ts.transpileModule(单个文件)` **不做路径重写** ⇒ 产物里仍写 `../shared/x.ts`
   *      ⇒ Node 找不到 `.ts` ⇒ `ERR_MODULE_NOT_FOUND` → 本族 `exit 3`；
   *   ② 产物**平铺**在 `out/ui.mjs`，没复刻 `src/` 结构 ⇒ 即使改了扩展名也指不到；
   *   ③ ⚠ ⚠ **它此前能通过纯属侥幸**：`create-hob-dialog.tsx` 里那条
   *      `import { PLANNING_PRESET_ID } from '../shared/planning-preset.ts'` **从未被使用**
   *      ⇒ `isolatedModules` 把整条 import **擦除** ⇒ 产物里没有它。
   *      **一旦有人真的用上它**（例如弹窗文案改成 `import { t } from './i18n.ts'`），
   *      本族立刻崩，而"崩"是 exit 3 —— 那看起来像"检查器坏了"，不像"判据漏了"。
   *
   * ── 现在（⚠ 改的是**判据的正确性**，是加严、⛔ 不是放宽）─────────────────
   *   · 转译逻辑**收进 `scripts/ts-mount.mjs`**（一处实现，两个真 DOM 族共用）；
   *   · 它从**源码**解析相对 import 并**递归**转译被引用的 `src/**`（含 `client/i18n.ts`、
   *     `shared/planning-preset.ts` 等），产物按 `src/` 的相对结构落盘；
   *   · `verifyMounted()` **自证**三条：产物里不许残留 `.ts`/`.tsx` 相对 import ·
   *     每条相对 import 都必须指向真产出的文件 · **入口源码**里每条相对 import 都
   *     必须在产出集合里（⚠ 这条从源码取证 ⇒ 被擦除的 import 也照样会红）。
   *   ⇒ 将来任何人引入新的相对 import 而本库没跟上，会**响亮地红**并点名文件与说明符，
   *     而不是靠"恰好被擦除"侥幸变绿。
   */
  const tsPath = join(root, 'node_modules', 'typescript', 'lib', 'typescript.js')
  const ts = (await import(`file://${tsPath}`)).default
  const tsMount = await import('./ts-mount.mjs')
  const ENTRY = 'src/client/create-hob-dialog.tsx'
  const graph = tsMount.mountTsGraph({
    root, outDir: join(work, 'out'), entries: [ENTRY], ts,
  })
  /**
   * ⚠ **自证失败 ⇒ 直接记红**（⛔ 不许"没转出来就跳过"）：
   *   这一支是"判据自己失去了基准"，与"被测对象违规"分不开 —— 但**都必须红**。
   *   ⚠ 用 `bad()` 而不是抛：抛会落进外层 `catch` ⇒ 变成 `exit 3`（"检查器坏了"），
   *     而这里其实是**判据可读地不成立**（能在汇总里点名），两者的修法不同。
   */
  const mountProblems = [...graph.problems, ...tsMount.verifyMounted({
    root, entries: [ENTRY], mounted: graph.mounted, entryFiles: graph.entries,
  })]
  if (mountProblems.length > 0) {
    for (const p of mountProblems) bad(`D-0 转译/自证失败：${p}`)
  } else {
    ok(`D-0 ✓ **转译图自证通过**：${graph.mounted.length} 份源件按 \`src/\` 结构产出`
      + `（${graph.mounted.join(' · ')}）· 产物里无残留 \`.ts\` 相对 import · 每条相对 import 都指向真产出的文件`)
  }

  // ⚠ 让 `react` 能从临时目录解析到**工作区那一份**（⛔ 不装第二份 React）
  const entry = join(work, 'entry.mjs')
  const entryOut = graph.entries[ENTRY]
  if (entryOut === undefined) {
    // ⚠ 入口没产出 ⇒ 后面每一条都会因为 `ui` 是 undefined 而连片崩 ⇒ 这里可读地停住
    throw new Error('入口没有产出（见上面 D-0 的转译/自证失败行）')
  }
  writeFileSync(entry, `export * from ${JSON.stringify(entryOut)}\n`)
  const ui = await import(`file://${entry}`)

  // ── 隔离 DOM ────────────────────────────────────────────────────────
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

  const { createRoot } = reactDom
  const mount = (el) => {
    const host = document.getElementById('root')
    host.innerHTML = ''
    const r = createRoot(host)
    act(() => { r.render(el) })
    return r
  }
  const tick = async (ms = 20) => { await act(async () => { await new Promise((res) => setTimeout(res, ms)) }) }

  /** 受控假服务（⚠ 只实现我们自己的 HTTP 契约，⛔ 不模拟宿主内部）。 */
  const makeCall = (over = {}) => {
    const calls = []
    const call = async (b) => {
      calls.push(b)
      if (b.action === 'enums') {
        /**
         * ⚠⚠ **默认假服务 = 生产形态（从生产常量派生）**（2026-10-24 · t10 订正）：
         *   · `levels`     = `PERMISSION_LEVELS`（合法枚举全集 ⇒ 界面要呈现每一项）；
         *   · `openLevels` = `OPEN_READ_LEVELS`（生产当前开放面 ⇒ 用户当前真正能选的）。
         *   ⚠ 这两个都**真读源码**（见文件头 `PROD_ENUM_LEVELS` / `PROD_OPEN_LEVELS`），
         *     ⛔ 不再写死 `['ledger']` —— 那正是审查席实测出来的"夹具与生产相反"。
         */
        return over.enums ?? {
          ok: true,
          /** ⚠ **字面量**（⛔ 不派生）—— 见文件头 `FIXTURE_ENUM_LEVELS` 那段更正。 */
          levels: FIXTURE_ENUM_LEVELS,
          openLevels: FIXTURE_OPEN_LEVELS,
          modes: ['auto', 'single', 'multi'],
          floorLevel: FIXTURE_ENUM_LEVELS[0] ?? 'ledger',
          defaultMode: 'auto',
          /**
           * ⚠ 说明文案**必须用中文显示名**，⛔ 不许把内部枚举值写进用户可见文本
           *   （那是 D-21 的判据；夹具自己犯这条会污染**所有**用到默认夹具的用例）。
           *   对应关系取自 `create-hob-dialog.tsx` 的 `HOB_DIALOG_ZH`（`level.label.*`）。
           */
          levelsNote: `当前开放 ${FIXTURE_OPEN_LEVELS.map((v) => LEVEL_LABEL_ZH[v] ?? v).join(' / ')}`
            + `（${FIXTURE_OPEN_LEVELS.length}/${FIXTURE_ENUM_LEVELS.length} 档）。`,
          workspaces: [{ id: 'ws-A', label: '项目甲' }, { id: 'ws-B', label: '项目乙' }],
        }
      }
      if (b.action === 'issue') return over.issue ?? { ok: true, ticket: 'T-1' }
      if (b.action === 'create') return over.create ?? { ok: true, sessionId: 'S-ok' }
      return { ok: false, reason: 'unknown' }
    }
    return { call, calls }
  }
  const byText = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent === t)
  const submitBtn = () => [...document.querySelectorAll('button')].find((b) => b.textContent === '创建')
  const openDialog = async (over) => {
    const st = ui.createDialogState()
    st.open()
    const { call, calls } = makeCall(over)
    const r = mount(React.createElement(ui.HobCreateOverlayLive, { state: st, call }))
    await tick()
    return { st, calls, r }
  }

  // ── D-1 入口：**弹窗打开时才渲染且可点**（2026-10-29 包 BZ · CHG-185 改口径）──
  /**
   * ⚠ 本组**改过口径**（2026-10-29）：原来断言"入口无条件渲染"，
   *   而需求已改成"⛔ 不再常驻、只在弹窗打开时出现" ⇒ 旧口径会把**正确实现**判红。
   * ⚠ 现在守的是两半：① 关闭时 **不渲染**（这就是"不常驻"的可判证据）；
   *   ② 打开时渲染且可点（兜底入口没有被改坏）。
   */
  {
    const stClosed = ui.createDialogState()
    mount(React.createElement(ui.HobCreateCommandEntry, { state: stClosed }))
    if (document.querySelector('button.dsh-hob-entryBtn') !== null) {
      bad('D-1 入口**在弹窗关闭时仍然渲染** ⇒ "不再常驻"这条没落地（CHG-185）')
    } else {
      ok('D-1a ✓ 弹窗关闭时入口**不渲染**（"不再常驻"落地）')
    }
    const st = ui.createDialogState()
    st.open()
    mount(React.createElement(ui.HobCreateCommandEntry, { state: st }))
    const btn = document.querySelector('button.dsh-hob-entryBtn')
    if (btn === null) bad('D-1 弹窗已打开，入口**却没有渲染**（兜底入口坏了）')
    else if (btn.textContent !== '新建 Hob 会话') bad(`D-1 入口文案 = ${JSON.stringify(btn.textContent)}`)
    else {
      /**
       * ⚠ 2026-10-29：`st` 是**已经 open()** 的状态（入口只在打开时渲染），
       *   ⇒ 原来那条"入口不该自动打开弹窗"在这里**语义已不成立**（是我们打开的）。
       *   ⛔ 删掉它不是为了让它变绿 —— 它守的那件事现在由 D-1a（关闭时不渲染）承担。
       *   这里改守**它自己的职责**：点击入口 ⇒ 弹窗仍然开着（幂等、不把自己关掉）。
       */
      act(() => { btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true })) })
      if (!st.isOpen()) bad('D-1 点了入口但弹窗**被关掉了**（应是幂等打开）')
      else ok('D-1b ✓ 入口**真渲染**为 <button>、文案正确；点击后弹窗仍为打开态')
    }
  }

  // ── D-2 不遮挡 ─────────────────────────────────────────────────────
  {
    const st = ui.createDialogState()
    // ⚠ 2026-10-29：入口现在**只在弹窗打开时**才渲染 ⇒ 这里必须先 open() 才测得到它
    st.open()
    mount(React.createElement(ui.HobCreateCommandEntry, { state: st }))
    const dock = document.querySelector('.dsh-hob-entryDock')
    const btn = document.querySelector('button.dsh-hob-entryBtn')
    const dockPE = dock?.style?.pointerEvents
    const btnPE = btn?.style?.pointerEvents
    if (dockPE !== 'none' || btnPE !== 'auto') {
      bad(`D-2 遮挡风险：容器 pointer-events=${dockPE}（应 none）· 按钮=${btnPE}（应 auto）`)
    } else if (btn?.getAttribute('aria-label') === null) {
      bad('D-2 按钮缺 `aria-label` ⇒ 可访问性不足')
    } else if (btn?.getAttribute('aria-haspopup') !== 'dialog') {
      bad('D-2 按钮缺 `aria-haspopup="dialog"`')
    } else {
      ok('D-2 ✓ **不遮挡**：容器 `pointer-events:none`（点空白处穿透）· 按钮 `auto`；'
        + '且有 `aria-label` + `aria-haspopup="dialog"`')
    }
  }

  // ── D-3 弹窗真渲染出三组控件 ────────────────────────────────────────
  {
    const { r } = await openDialog()
    const has = (sel) => document.querySelector(sel) !== null
    const groups = [...document.querySelectorAll('legend')].map((l) => l.textContent)
    if (!has('[role="dialog"]')) bad('D-3 弹窗没有渲染（缺 role="dialog"）')
    else if (!groups.includes('工作区') || !groups.includes('可读范围') || !groups.includes('推进方式')) {
      bad(`D-3 控件组不全：${JSON.stringify(groups)}`)
    } else if (!has('select.dsh-hob-select')) bad('D-3 缺工作区选择器')
    // ⚠ 2026-10-22（用户就地纠正后）：可读范围**三档都呈现**（后两档灰 + 标注），推进方式三档
    else if (document.querySelectorAll('input[name="hob-level"]').length !== 3) {
      bad(`D-3 可读范围不是 3 项（实测 ${document.querySelectorAll('input[name="hob-level"]').length} 项）`
        + ' —— 用户要求三档都呈现（不能因为只开放一档就不画另两档）')
    } else if (document.querySelectorAll('input[name="hob-mode"]').length !== 3) bad('D-3 推进方式不是 3 项')
    else ok('D-3 ✓ 弹窗**真渲染**：工作区 select + 可读范围 **3 项**（后两项灰 + 标注「暂未开放」）+ 推进方式 **3 项**')
    act(() => { r.unmount() })
  }

  // ── D-4 值来自服务枚举（⛔ 不抄死清单）──────────────────────────────
  /**
   * ⚠⚠ **这条是"界面不自己过滤"的关键反证**（2026-10-22 订正）：
   *   本批起生产服务**只下发 1 档**，若断言仍写"必须 3 项"就会与实现打架；
   *   但若改成"必须 1 项"，就**测不出**"界面是不是在跟着服务走"（写死 1 项也能过）。
   *   ⇒ 正确判据 = **给 2 档服务，UI 就必须画 2 项**（含 `project`、不含 `workspace`
   *     之外的第三档）——即"服务给几个就画几个"。
   *   ⚠ 这同时证明：**界面没有自己加白名单**（否则服务给 2 档时 UI 只会剩 1 项）。
   */
  {
    const { r } = await openDialog({
      enums: {
        ok: true,
        // ⚠ 服务少给一档（无 workspace）⇒ 界面就只画两项（证明不是 UI 写死的三档）
        levels: ['ledger', 'project'],
        // ⚠ 且这两项里只有 ledger 开放 ⇒ project 必须是灰的
        openLevels: ['ledger'],
        modes: ['auto', 'multi'],
        floorLevel: 'ledger', defaultMode: 'auto', workspaces: [{ id: 'ws-A', label: '甲' }],
        levelsNote: '测试：服务下发的说明（不为空即可）',
      },
    })
    const inputs = [...document.querySelectorAll('input[name="hob-level"]')]
    const lv = inputs.map((i) => i.value)
    const md = [...document.querySelectorAll('input[name="hob-mode"]')].map((i) => i.value)
    const proj = inputs.find((i) => i.value === 'project')
    if (lv.length !== 2 || !lv.includes('project') || lv.includes('workspace')) {
      bad(`D-4 可读范围**没有跟着服务枚举走**：${JSON.stringify(lv)}（服务只给了 ledger/project）`)
    } else if (md.length !== 2 || md.includes('single')) {
      bad(`D-4 推进方式**没有跟着服务枚举走**：${JSON.stringify(md)}`)
    } else if (proj === undefined || proj.disabled !== true) {
      bad('D-4 "可选/不可选"**没有跟着 `openLevels` 走**：`project` 不在开放面里却没被禁用')
    } else {
      ok('D-4 ✓ **呈现**跟着 `levels` 走（服务少给一档 UI 就少一项）、**可选**跟着 `openLevels` 走'
        + '（未开放的档灰掉）⇒ 两份清单都不是 UI 写死的')
    }
    act(() => { r.unmount() })
  }

  // ── D-5 枚举拿不到 ⇒ 不能提交 ──────────────────────────────────────
  {
    const st = ui.createDialogState()
    st.open()
    const { call, calls } = makeCall({ enums: { ok: false, reason: '注入：枚举不可用' } })
    const r = mount(React.createElement(ui.HobCreateOverlayLive, { state: st, call }))
    await tick()
    const btn = submitBtn()
    if (btn === null) bad('D-5 找不到提交按钮')
    else if (btn.disabled !== true) bad('D-5 枚举失败但提交按钮**仍可用**（应禁用）')
    else if (!String(document.body.textContent).includes('枚举')) bad('D-5 枚举失败但**没有可读原因**')
    else ok('D-5 ✓ 服务枚举拿不到 ⇒ **提交按钮禁用** + 可读原因（⛔ 不静默禁用）')
    act(() => { r.unmount() })
  }

  // ── D-6 未选工作区 ⇒ 不能提交 ──────────────────────────────────────
  {
    const { calls, r } = await openDialog()
    const btn = submitBtn()
    if (btn?.disabled !== true) bad('D-6 未选工作区但提交**可用**（应禁用）')
    else {
      act(() => { btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true })) })
      if (calls.some((c) => c.action === 'create')) bad('D-6 未选工作区竟**发出了 create**')
      else ok('D-6 ✓ 未选工作区 ⇒ **提交禁用**、且点了也**不发 create**（⛔ 不省归属）')
    }
    act(() => { r.unmount() })
  }

  // ── D-7 取消 / Escape ⇒ 零创建 ─────────────────────────────────────
  {
    const { st, calls, r } = await openDialog()
    const dlg = document.querySelector('[role="dialog"]')
    act(() => { dlg.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    const afterEsc = { open: st.isOpen(), created: calls.filter((c) => c.action === 'create').length }
    // 再来一次：点「取消」
    st.open()
    const r2 = await tick()
    const cancelBtn = byText('取消')
    if (cancelBtn !== null) act(() => { cancelBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true })) })
    const afterCancel = { open: st.isOpen(), created: calls.filter((c) => c.action === 'create').length }
    if (afterEsc.open !== false) bad('D-7 Escape **没有关掉**弹窗')
    else if (afterEsc.created !== 0) bad(`D-7 Escape 后仍有 ${afterEsc.created} 次 create（应 0）`)
    else if (cancelBtn !== null && afterCancel.open !== false) bad('D-7 点「取消」**没有关掉**弹窗')
    else if (afterCancel.created !== 0) bad(`D-7 取消后仍有 ${afterCancel.created} 次 create（应 0）`)
    else ok('D-7 ✓ **Escape 与「取消」都真的关窗**，且**零 create 请求**（⛔ 零创建）')
    act(() => { r.unmount() })
  }

  // ── D-8 正常提交 ⇒ 恰好一次 create，issue 带工作区 ──────────────────
  {
    const { st, calls, r } = await openDialog()
    const sel = document.querySelector('select.dsh-hob-select')
    act(() => {
      sel.value = 'ws-B'
      sel.dispatchEvent(new w.Event('change', { bubbles: true }))
    })
    const btn = submitBtn()
    if (btn?.disabled === true) bad('D-8 选了工作区后提交**仍禁用**')
    else {
      await act(async () => { btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true })) })
      await tick(40)
      const issues = calls.filter((c) => c.action === 'issue')
      const creates = calls.filter((c) => c.action === 'create')
      if (creates.length !== 1) bad(`D-8 create 次数 = ${creates.length}（应恰好 1）`)
      else if (issues[0]?.workspaceId !== 'ws-B') {
        bad(`D-8 issue 没带工作区：${JSON.stringify(issues[0])}`)
      } else {
        ok('D-8 ✓ 选好工作区后可提交：**恰好 1 次** create；'
          + '`issue` 体里带 `workspaceId="ws-B"`（用户选的那个，⛔ 不是注册表第一项）')
      }
    }
    act(() => { r.unmount() })
  }

  // ── D-9 字面 ** 不出现 ────────────────────────────────────────────
  {
    const { r } = await openDialog()
    const text = String(document.body.textContent)
    if (text.includes('**')) {
      const i = text.indexOf('**')
      bad(`D-9 用户可见文本里有**字面星号**：…${text.slice(Math.max(0, i - 30), i + 30)}…`)
    } else {
      ok('D-9 ✓ 用户可见文本里**没有字面 `**`**（未做 Markdown 渲染也不会露标记）')
    }
    act(() => { r.unmount() })
  }

  // ── D-10 「完全权限」旁完整边界句（⚠ 该档**呈现且可选** —— 2026-10-24 裁定 2）──
  /**
   * ══ ⚠⚠ **按 2026-10-24 用户裁定 2 重写（开放面扩到三档）**（t10 · B 席）════════
   *
   * ── 改前是什么（**判据与新裁定相反**，审查席实测证据）──────────────────────
   *   改前断言 `wide.disabled === true`（「完全权限」必须**灰掉**）—— 那是
   *   「只开最低档」时代的形态。用户本轮裁定 2 把 `OPEN_READ_LEVELS` 扩到**三档全开**
   *   ⇒ 生产上下发 `openLevels: ['ledger','project','workspace']`
   *   ⇒ 该档**本来就该可选**。
   *   ⚠ 而夹具还写着 `openLevels: ['ledger']`（见文件头订正）⇒ 于是这条绿；
   *     夹具改成生产形态后**当场变红** —— 那正是"绿靠的是已不存在的服务形态"。
   *
   * ── 现在（⚠ 命题没变：**用户看见就该看懂**，⛔ 不是"眼不见为净"）────────────
   *   ① 「完全权限」**必须呈现**（用户要看见三档都在）；
   *   ② 它旁边**必须**有四段边界句（`R-26`：凡出现该名，紧邻必须有完整边界句）
   *      —— ⚠ **现在更严**：它**可选**了，用户**真会选它**，边界句比"灰着"时更要紧；
   *   ③ 它**必须是可选的**（`disabled !== true`）—— 否则是"裁定 2 没落地"。
   *   ⚠ 唯一放宽的是"灰不灰"这一轴（跟裁定走）；**边界句那四段一个字没动**。
   */
  {
    const { r } = await openDialog()
    const text = String(document.body.textContent)
    const wide = [...document.querySelectorAll('input[name="hob-level"]')].find((i) => i.value === 'workspace')
    act(() => { r.unmount() })

    const need = ['工作区里任何文件都可读', '仍不能写', '不能执行命令', '不能组队']
    const missing = need.filter((x) => !text.includes(x))
    /**
     * ⚠ **两向 + 两个来源**（见文件头那段"夹具不许派生"）：
     *   界面该不该可选 = 生产常量说了算（`PROD_OPEN_LEVELS`）；
     *   而夹具本身也必须等于生产（由 D-18 末尾那条独立的对账判）。
     */
    const wideShouldBeOpen = PROD_OPEN_LEVELS.includes('workspace')
    const fixtureAgrees = FIXTURE_OPEN_LEVELS.join(',') === PROD_OPEN_LEVELS.join(',')
    if (wide === undefined) {
      bad('D-10 「完全权限」**没有渲染出来** ⇒ 用户看不到这一档存在（裁定 2 要求三档都呈现）')
    } else if (!text.includes('完全权限')) {
      bad('D-10 渲染了该项但**看不到「完全权限」字样**')
    } else if (missing.length > 0) {
      bad(`D-10 「完全权限」旁缺边界句：${JSON.stringify(missing)}（R-26：凡出现该名，紧邻必须有完整边界句）`)
    } else if (wideShouldBeOpen && wide.disabled === true) {
      /** ⚠ 生产开放面含它、界面却灰着 ⇒ 裁定 2 没落地（用户选了它却点不了）。 */
      bad('D-10 「完全权限」**被灰掉了**，但生产开放面（`OPEN_READ_LEVELS`）含它'
        + `（实测 ${JSON.stringify(PROD_OPEN_LEVELS)}）⇒ 裁定 2 没落地：用户看着能选却点不了`)
    } else if (!wideShouldBeOpen && wide.disabled !== true) {
      /** ⚠ 生产没开放它、界面却可选 ⇒ 界面比开放面宽（那才是越权）。 */
      bad('D-10 「完全权限」**可选**，但它不在生产开放面里'
        + `（\`OPEN_READ_LEVELS\` = ${JSON.stringify(PROD_OPEN_LEVELS)}）⇒ 界面比开放面宽`)
    } else {
      ok(`D-10 ✓ 「完全权限」呈现 · **四段边界句逐字齐全** · 可选性 = ${wideShouldBeOpen ? '可选（生产开放面含它，裁定 2）' : '灰掉（生产未开放）'}`
        + '（⇒ 用户既能看见这一档，也当场读到"它到底能让 hob 做什么"）')
    }
  }

  // ── D-11 中文标签在位（⚠ 用户就地纠正后：三档标签都该在）──────────────
  {
    const { r } = await openDialog()
    const text = String(document.body.textContent)
    const levelNeed = ['账本权限', '文档权限', '完全权限']
    /**
     * ⚠⚠ **期望值必须与 `UD-149` §三 同源**（2026-10-22 · 修 D3 的判据侧）：
     *   用户已裁「档名不改，仍是 自动 / 单会话 / 多会话」。上一版这里写死
     *   `['自动','单路','多路']` ⇒ **判据把漂移锁住了**：源码改对反而变红。
     *   ⚠ 改这一行是"改判据的期望值"，⛔ 不是"放宽断言" —— 三档仍然必须全在，
     *     只是期望的**词**回到用户裁定的那一套。
     */
    const modeNeed = ['自动', '单会话', '多会话']
    const missL = levelNeed.filter((x) => !text.includes(x))
    const missM = modeNeed.filter((x) => !text.includes(x))
    act(() => { r.unmount() })
    if (missL.length > 0) bad(`D-11 可读范围缺中文标签：${JSON.stringify(missL)}（三档都应呈现）`)
    else if (missM.length > 0) bad(`D-11 推进方式中文标签缺：${JSON.stringify(missM)} ⇒ "推进三档不变"被破坏`)
    else {
      ok('D-11 ✓ 可读范围**三档中文标签全在** + 推进方式**三档中文标签全在**'
        + '（值来自服务、标签来自本地词典）')
    }
  }

  // ── D-18 **三档都呈现 · 可选面严格等于生产开放面 · 不在开放面的档灰且标注** ──────
  /**
   * ══ ⚠⚠ **按 2026-10-24 用户裁定 2 重写（本文件最要紧的一条）**（t10 · B 席）═════
   *
   * ── 改前是什么（**判据与新裁定相反** · 审查席实测）──────────────────────────
   *   改前钉的是"后两项（project / workspace）**必须都灰掉** + 都带「暂未开放」"。
   *   那在"只开最低档"时代是对的；裁定 2 扩到三档后，生产下发的 `openLevels`
   *   = 三档全开 ⇒ 后两项**本来就该可选** ⇒ 改前的断言**把正确实现判成违规**。
   *   ⚠ 而夹具写死 `openLevels: ['ledger']` 把它掩盖住了 —— 夹具一改生产形态，
   *     这条与 D-10 **双双变红**（审查席的原话：绿是"靠一个已不存在的服务形态"）。
   *
   * ── 现在（⚠ 判的是**界面 ↔ 开放面的一致性**，⛔ 不写死"哪几个该灰"）──────────
   *   四件事（比改前**更严**：它现在对**任意**开放面成立，不只对"只开一档"成立）：
   *     ① **呈现面完整**：`levels` 给了几档，界面就画几档（⛔ 少画 ⇒ 用户看不到存在）；
   *     ② **可选面严格相等**：每一档的 `input.disabled` 必须 === `!openLevels.includes(该档)`
   *        —— ⚠ 两向都判：**在开放面里却被灰**（选不了）与**不在开放面里却可选**（越权）
   *        都算红；改前只判了后一个方向的一半；
   *     ③ **不可选的档必须有可见的「暂未开放」标注**（同 行内，⛔ 不靠颜色/悬停）；
   *     ④ **开放面非空**（全灰 ⇒ 用户根本建不了会话，那是另一种坏）。
   *   ⚠ 本条**不承担校验**：档位越权由服务端拒，见
   *     `check:hob-create` 的 CU-41 / CU-41b / CU-42 / CU-43 与
   *     `check:hob-gate` 的 **G-21**（`action === 'write'` 的 isHob + 开放面双闸）。
   */
  {
    const { r } = await openDialog()
    const inputs = [...document.querySelectorAll('input[name="hob-level"]')]
    const byVal = (v) => inputs.find((i) => i.value === v)
    const rowOf = (i) => (i === undefined ? null : i.closest('label'))
    const rowText = (i) => { const l = rowOf(i); return l === null ? '' : String(l.textContent) }
    const rowBadge = (i) => { const l = rowOf(i); return l !== null && l.querySelector('.dsh-hob-optionBadge') !== null }
    act(() => { r.unmount() })

    /** ① 呈现面完整（以**假服务下发的 `levels`** 为准，⛔ 不写死三档）。 */
    const shown = inputs.map((i) => i.value)
    const missingShown = FIXTURE_ENUM_LEVELS.filter((v) => !shown.includes(v))
    /** ② 可选面严格相等（**两向**；期望来自**生产常量**，⛔ 不来自夹具）。 */
    const wrongDisabled = []
    for (const v of shown) {
      const shouldBeSelectable = PROD_OPEN_LEVELS.includes(v)
      const isSelectable = byVal(v)?.disabled !== true
      if (shouldBeSelectable !== isSelectable) {
        wrongDisabled.push(`${v}：应${shouldBeSelectable ? '可选' : '灰掉'} / 实测${isSelectable ? '可选' : '灰掉'}`)
      }
    }
    /** ③ 灰掉的档必须带可见标注。 */
    const closedButNoBadge = FIXTURE_ENUM_LEVELS
      .filter((v) => !PROD_OPEN_LEVELS.includes(v))
      .filter((v) => byVal(v) !== undefined && (!rowBadge(byVal(v)) || !/暂未开放/.test(rowText(byVal(v)))))
    /**
     * ④ ⚠⚠ **夹具 vs 生产 的独立对账**（防"两边一起错"）：
     *   上面 ①②③ 比的都是"界面 vs 生产"，但**假服务下发的 `openLevels` 本身**
     *   也必须等于生产常量 —— 否则夹具可以永远下发旧形态，而断言只测"界面跟着夹具走"。
     *   ⚠ 这条是本组"不许两边一起错"的唯一落点。
     */
    const fixtureDrift = FIXTURE_OPEN_LEVELS.join(',') !== PROD_OPEN_LEVELS.join(',')
    if (fixtureDrift) {
      bad(`D-18 ⚠⚠ **假服务与生产开放面不一致**：夹具 \`${JSON.stringify(FIXTURE_OPEN_LEVELS)}\``
        + ` vs 生产 \`OPEN_READ_LEVELS\` ${JSON.stringify(PROD_OPEN_LEVELS)}`
        + '\n      ⇒ ⚠ 夹具必须跟着生产形态走，否则本族测的是"一个不存在的服务"'
        + '\n        （审查席实测过这一格：夹具写死 `[\'ledger\']`、生产三档 ⇒ 本族绿得毫无意义）'
        + '\n      ⇒ 修法：把文件头的 `FIXTURE_OPEN_LEVELS` 改成生产当前值（⚠ 它是**字面量**，'
        + '故意不派生 —— 派生就等于自己跟自己比）')
    } else if (missingShown.length > 0) {
      bad(`D-18 ⚠ **呈现面不完整**：服务给了 ${JSON.stringify(PROD_ENUM_LEVELS)}，界面少了 ${JSON.stringify(missingShown)}`
        + ' ⇒ 用户看不到这几档存在')
    } else if (wrongDisabled.length > 0) {
      bad(`D-18 ⚠⚠ **可选面与生产开放面不一致**：${wrongDisabled.join(' · ')}`
        + `\n      ⇒ 生产 \`OPEN_READ_LEVELS\` = ${JSON.stringify(PROD_OPEN_LEVELS)}`
        + '\n      ⇒ ⚠ 两向都要判：在开放面里却被灰 = 裁定没落地；不在开放面里却可选 = 界面比开放面宽（越权）')
    } else if (closedButNoBadge.length > 0) {
      bad(`D-18 ⚠ 灰掉的档**缺少可见的「暂未开放」标注**：${JSON.stringify(closedButNoBadge)}`
        + ' ⇒ 用户只看到"点不了"却不知道为什么')
    } else if (PROD_OPEN_LEVELS.length === 0) {
      bad('D-18 ⚠ 生产开放面是**空的** ⇒ 一个档都不能选，用户根本建不了会话')
    } else {
      ok(`D-18 ✓ **呈现面完整**（${FIXTURE_ENUM_LEVELS.length} 档全画）· **可选面严格等于生产开放面**`
        + `（可选 ${JSON.stringify(PROD_OPEN_LEVELS)} · 灰 ${JSON.stringify(FIXTURE_ENUM_LEVELS.filter((v) => !PROD_OPEN_LEVELS.includes(v)))}`
        + '，两向都比过）· 灰掉的档各自行内标注「暂未开放」· **夹具与生产常量一致**')
    }
  }

  // ── D-18b **负向对拍（真 DOM 两次渲染）：界面可选面必须跟着 `openLevels` 走** ──────
  /**
   * ⚠⚠ 为什么必须有这一条（t10 · B 席）：
   *   D-18 现在是"界面 == 生产开放面"的一致性判据。**一致性判据最容易退化成恒绿** ——
   *   只要两组读数来自同一个来源，它们永远相等。我第一版就踩了：把夹具写成
   *   `openLevels: PROD_OPEN_LEVELS`（派生）⇒ 生产改宽广、两边一起动 ⇒ **永远绿**。
   *   发现它的正是本文件那条独立的"夹具 vs 生产"对账 + 这条真 DOM 对照。
   *
   * ⚠ 本条做法（**⛔ 不用生产常量、⛔ 不派生，只喂两份字面世界**）：
   *   同一组件、同一份 DOM 挂载逻辑，**只换假服务下发的 `openLevels`**：
   *     · 世界 A：`openLevels` = 三档 ⇒ **三档都必须可选**；
   *     · 世界 B：`openLevels` = 只有最低档 ⇒ **后两档必须灰 + 带「暂未开放」**。
   *   ⇒ 若界面把"可选性"写死（永远可选 / 永远灰），**两份世界必有一份不符 ⇒ 红**。
   *   ⚠ 这条**与生产当前开几档无关**（它证明的是"界面跟着服务走"这个机制），
   *     所以生产将来再收紧/放宽，它都不会假红 —— 也不会假绿。
   */
  {
    const readSelectable = async (openLevels) => {
      const { r } = await openDialog({
        enums: {
          ok: true,
          levels: ['ledger', 'project', 'workspace'],
          openLevels,
          modes: ['auto', 'single', 'multi'],
          floorLevel: 'ledger',
          defaultMode: 'auto',
          levelsNote: '负向对拍：只换开放面，其余一模一样。',
          workspaces: [{ id: 'ws-A', label: '甲' }],
        },
      })
      const rows = [...document.querySelectorAll('input[name="hob-level"]')].map((i) => {
        const label = i.closest('label')
        return {
          v: i.value,
          selectable: i.disabled !== true,
          badge: label !== null && label.querySelector('.dsh-hob-optionBadge') !== null,
          text: label === null ? '' : String(label.textContent),
        }
      })
      act(() => { r.unmount() })
      return rows
    }
    const wideOpen = await readSelectable(['ledger', 'project', 'workspace'])
    const narrowOpen = await readSelectable(['ledger'])
    const wideAllSelectable = wideOpen.length === 3 && wideOpen.every((x) => x.selectable && !x.badge)
    const narrowOnlyFloor = narrowOpen.length === 3
      && narrowOpen.filter((x) => x.v === 'ledger').every((x) => x.selectable)
      && narrowOpen.filter((x) => x.v !== 'ledger')
        .every((x) => !x.selectable && x.badge && /暂未开放/.test(x.text))

    if (!wideAllSelectable && !narrowOnlyFloor) {
      bad('D-18b 【判据恒绿】两份 `openLevels` 世界下界面**没有任何差别**'
        + `（宽=${JSON.stringify(wideOpen.map((x) => [x.v, x.selectable]))} · `
        + `窄=${JSON.stringify(narrowOpen.map((x) => [x.v, x.selectable]))}）`
        + ' ⇒ 可选性是**写死的**，不是跟着服务下发走的')
    } else if (!wideAllSelectable) {
      bad(`D-18b \`openLevels\` 给三档时**仍有档被灰**：`
        + `${JSON.stringify(wideOpen.filter((x) => !x.selectable || x.badge).map((x) => x.v))}`
        + ' ⇒ 界面比服务窄（用户看着能选却点不了）')
    } else if (!narrowOnlyFloor) {
      bad(`D-18b \`openLevels\` 只给最低档时**后两档没被灰/没标注**：`
        + `${JSON.stringify(narrowOpen.map((x) => [x.v, x.selectable, x.badge]))}`
        + ' ⇒ 界面比服务宽（越权）或用户不知道为什么点不了')
    } else {
      ok('D-18b ✓ 负向对拍（**真 DOM 两次渲染**）：同一组件、只换假服务的 `openLevels` ⇒ '
        + '三档全开时**三档都可选**、只开最低档时**后两档灰掉且带「暂未开放」**'
        + ' ⇒ 可选面确实**跟着服务下发走**（⛔ 不是写死的；也⛔ 不是两边一起错还绿）')
    }
  }

  // ── D-19 **推进方式三档仍在**（用户明确"三档不变"的那一轴）──────────────────
  /**
   * ⚠ 为什么单列一条：本批收窄的是**可读范围**，用户原话明确"推进方式三档不变"。
   *   一旦有人图省事把整个"选项控件"改成一档，这条必须红。
   *   判据 = 值集合**恰好**是 `auto/single/multi`（⛔ 不缺、⛔ 不多），且三项都可点。
   */
  {
    const { r } = await openDialog()
    const modes = [...document.querySelectorAll('input[name="hob-mode"]')]
    const vals = modes.map((i) => i.value).sort()
    const allEnabled = modes.every((i) => i.disabled !== true)
    act(() => { r.unmount() })
    const want = ['auto', 'multi', 'single']
    if (JSON.stringify(vals) !== JSON.stringify(want)) {
      bad(`D-19 ⚠ 推进方式**不是三档**：${JSON.stringify(vals)}（应为 ${JSON.stringify(want)}）`
        + ' ⇒ 用户要求"推进方式三档不变"被破坏')
    } else if (!allEnabled) {
      bad('D-19 推进方式三档里有**被禁用**的项 ⇒ 表面上三档、实际选不了')
    } else {
      ok('D-19 ✓ 推进方式**三档仍在且都可选**（auto / single / multi）'
        + '—— 本批收窄只针对可读范围，未误伤这一轴')
    }
  }

  // ── D-20 **取消 ⇒ 零会话 + 零请求**（生产形态下再确认一次）──────────────────
  /**
   * ⚠ 本批不动取消语义，但它与"只开放一档"直接相邻（只有一个选项时，
   *   用户更容易直接点确认）⇒ 这里**在生产形态**（1 档服务）上再验一次：
   *   取消/ Escape 后 `calls` 里**没有** `issue` / `create`（⛔ 不能因为"反正只有一档"就自动提交）。
   */
  {
    const { r, st, calls } = await openDialog()
    // 用 Escape 关（真键盘事件）
    const dialog = document.querySelector('[role="dialog"]')
    if (dialog !== null) {
      act(() => {
        dialog.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      await tick(20)
    }
    const openAfter = st.isOpen()
    const bad_calls = calls.filter((c) => c.action === 'issue' || c.action === 'create')
    act(() => { r.unmount() })
    if (openAfter !== false) bad('D-20 Escape **没有关掉**弹窗（生产形态）')
    else if (bad_calls.length !== 0) {
      bad(`D-20 取消后仍有 ${bad_calls.length} 次 issue/create 请求：${JSON.stringify(bad_calls)}`
        + ' ⇒ 取消语义被破坏（会留空白会话）')
    } else {
      ok('D-20 ✓ 生产形态下 Escape 真的关窗，且**零 issue / 零 create**（取消 ⇒ 零会话）')
    }
  }

  // ── D-21 **用户可见文案不露内部值 / 不用字面 markdown 标记** ─────────────────
  /**
   * ⚠⚠ 任务书原文两条文案纪律：「文案不出现内部配置值、不用字面 markdown 标记」。
   *   D-9 只查了 `**`；本条把它扩展成**两类**：
   *     ① **字面标记**：`**` / `__` / 行首 `# ` / 反引号包裹 —— 用户不应看到未渲染的标记；
   *     ② **内部配置值**：`ledger` / `project` / `workspace` / `auto` / `single` / `multi`
   *        这几个**枚举值**不得出现在用户可见文本里（显示名是中文；值只用于发服务）。
   *   ⚠ 只扫**用户可见文本**（`textContent`），⛔ 不扫 `value` 属性（那本来就是内部值、
   *     且 DOM 断言需要它）—— 这个区分写在这里，防止后来人把判据写宽成"属性里也不许有"。
   */
  {
    const { r } = await openDialog()
    const text = String(document.body.textContent ?? '')
    act(() => { r.unmount() })
    const marks = []
    if (text.includes('**')) marks.push('**')
    if (/(^|\s)__[^_]+__/.test(text)) marks.push('__')
    if (/(^|\n)\s*#{1,6}\s/.test(text)) marks.push('# 行首标题标记')
    if (/`[^`]+`/.test(text)) marks.push('反引号')
    const internal = ['ledger', 'project', 'workspace', 'single', 'multi']
    const leakedVals = internal.filter((v) => new RegExp(`(^|[^A-Za-z0-9_-])${v}([^A-Za-z0-9_-]|$)`).test(text))
    if (marks.length > 0) {
      bad(`D-21 用户可见文本里有**字面 markdown 标记**：${JSON.stringify(marks)}`)
    } else if (leakedVals.length > 0) {
      bad(`D-21 用户可见文本里**出现了内部配置值**：${JSON.stringify(leakedVals)}（应只出现中文显示名）`)
    } else {
      ok('D-21 ✓ 用户可见文案**没有字面 markdown 标记**、也**不出现内部配置值**'
        + '（只出现中文显示名；值只用于发服务）')
    }
  }

  // ── D-22 **界面被恶意放宽也建不出「枚举外」的会话**（真服务端在场 · 端到端）────────
  /**
   * ══ ⚠⚠ **按用户本轮裁定重写**（2026-10-24 · B 席）══════════════════════════════
   *
   * ── 它守的命题（**一字未变**）：「**界面隐藏不是校验**」──────────────────────────
   *   改前的形态是"`project`/`workspace` 一律拒"（当时开放面只开最低档）。
   *   ⚠ 用户本轮把开放面**扩到三档全开** ⇒ 宽档**本来就该建得出来**，
   *     再断言"宽档建不出"会与用户裁定正面冲突 —— ⚠ 那不是"判据坏了"，是**落点过期**。
   *
   * ── 平移后的落点（⚠ 更强，⛔ 不是删掉）───────────────────────────────────────
   *   把"恶意的服务"从「下发三档宽档」换成「下发一个**枚举外**的档位」（如 `root`，
   *   或将来开放面实现坏掉时冒出来的任何非法值）：
   *     · 界面**照它画**（模拟最坏回归：界面的可选面被整体放宽 / 服务被改坏）；
   *     · 用户在 DOM 里**真的选中**那个非法档、点创建；
   *     · ⇒ **服务端必须拒**、**零会话**、错误文案**可读**；
   *     · ⇒ 且 `create` 请求应为 **0 次**（签票那一步就被拒，界面不该继续建）。
   *   ⚠ **改前这条完全没测过"枚举外的值"** —— 那时 UI 永远画不出这种档。
   *     现在 UI 可能画得出来（服务被改坏）⇒ 这个面向**必须**有判据兜着。
   *   ⚠ 服务端校验被去掉时它照样会红（`live.size` 会变成 1）。
   */
  {
    let chanMod
    try { chanMod = await import(pathToFileURL(join(root, 'src', 'modules', 'session-create-channel.ts')).href) } catch { chanMod = undefined }
    if (chanMod === undefined || typeof chanMod.createTicketStore !== 'function'
      || typeof chanMod.createHobSession !== 'function') {
      bad('D-22 无法直载真服务端创建链（`session-create-channel.ts`）⇒ 基准缺失（⛔ 不许当通过）')
    } else {
      /** 受控宿主假件（⚠ 只实现本链真正用到的面）。 */
      const live = new Map()
      const archives = new Set()
      /**
       * ⚠⚠ **回读必须回带"刚写进去的那两个值"**（2026-10-22 订正本组）。
       *
       * ── 为什么（这是本组第一版的假绿，如实记下）──────────────────────────────
       *   第一版把 `readPolicy` 写死成 `ledger/auto`，而恶意服务要建的是 `workspace`：
       *   ⇒ 创建链在**回读不一致**那一支就失败了、并且回滚成功 ⇒ `live.size === 0`
       *   ⇒ 即使**服务端档位校验被整段删掉**，本组**照样绿**（断言咬住的是另一件事）。
       *   ⚠ 那正是"判据看起来在挡、实际没挡"的形态。
       * ⇒ 现在让回读**忠实**回带写入值：宽档校验若不在，会话就**真的建出来**（`live.size===1`）
       *   ⇒ 本组才真的只在"服务端拒了宽档"时绿。
       */
      let wroteLevel = ''
      let wroteMode = ''
      const deps = {
        sessionsOf: () => ({ get: (id) => live.get(id) }),
        agentsOf: () => ({
          create: async (req) => {
            live.set(req.sessionId, { id: req.sessionId, snapshotEvents: () => [] })
            return { agent: { id: req.sessionId }, dispose: async () => { live.delete(req.sessionId) } }
          },
        }),
        archiveOf: () => ({
          get archivedSessionIds() { return [...archives] },
          async archiveSession(id) { archives.add(id) },
        }),
        workspacesOf: () => ({ list: () => [{ id: 'ws-A', path: '/tmp/ws-A', attachSession: async () => {} }] }),
        setPolicy: (_sid, level, workMode) => {
          wroteLevel = String(level); wroteMode = String(workMode)
          return { ok: true, reason: '' }
        },
        readPolicy: () => (wroteLevel === '' ? undefined : { level: wroteLevel, workMode: wroteMode, source: 'stored' }),
        activatePolicy: () => ({ ok: true, reason: '' }),
        quarantinePolicy: () => ({ ok: true, reason: '' }),
        log: () => {},
      }
      const store = chanMod.createTicketStore()
      /**
       * ⚠ **恶意的 enums**：故意把三档都下发（模拟"界面被改回三档 / 旧服务"）——
       *   只有这样才有机会在 DOM 里选中宽档，从而证明**服务端**在挡。
       */
      const hostileEnums = {
        ok: true,
        /**
         * ⚠⚠ **恶意面 = 混进一个枚举外的档位**（2026-10-24 重写）：
         *   扩档后"三档都合法"，所以要造的最坏回归不再是"多给宽档"，
         *   而是"服务/界面被改坏后冒出一个**不属于任何合法枚举**的值"。
         *   ⚠ 它同时也是将来开放面实现漂移时的真实风险形态。
         */
        levels: ['ledger', 'project', 'workspace', 'root'],
        /**
         * ⚠⚠ **关键：必须连"开放面"也一起放宽**（2026-10-22 订正）。
         *   本批最终形态是"三档呈现 + 后两项灰"，灰着的 radio **点不动** ⇒
         *   若这里只给 `levels` 三档、`openLevels` 仍只有 ledger，
         *   那这一段永远选不中宽档，本组会退化成 D-18 的重复（测不到服务端）。
         *   ⇒ 这里模拟的是**最坏回归**：界面的"可选面"被整体放宽（等同于有人把
         *     `OPEN_READ_LEVELS` 改回三档，或旧服务下发了三档可选）。
         *   ⚠ 这样才有意义：**只有服务端还站着，这条才绿**。
         */
        openLevels: ['ledger', 'project', 'workspace', 'root'],
        modes: ['auto', 'single', 'multi'],
        floorLevel: 'ledger',
        defaultMode: 'auto',
        /**
         * ⚠⚠ **这段说明必须"中立"**（不写"账本权限"字样）—— 本组第一版的说明里带着
         *   「只开放账本权限」，于是"用户可见文案说清原因"那条断言**被夹具自己满足**了：
         *   服务端校验删掉后它仍然绿。⇒ 现在说明只描述形态，原因必须真的来自**拒绝理由**。
         */
        levelsNote: '（本组故意造多条可选的形态，用于验证服务端是否真的在挡）',
        workspaces: [{ id: 'ws-A', label: '项目甲' }],
      }
      const calls = []
      const call = async (b) => {
        calls.push(b)
        if (b.action === 'enums') return hostileEnums
        if (b.action === 'issue') {
          const r = store.issue({
            sessionId: String(b.sessionId ?? ''), level: String(b.level ?? ''),
            workMode: String(b.workMode ?? ''), workspaceId: String(b.workspaceId ?? ''),
          })
          return r.ok ? { ok: true, ticket: r.ticket, expiresAt: r.expiresAt } : { ok: false, reason: r.reason }
        }
        if (b.action === 'create') {
          const r = await chanMod.createHobSession(deps, store, {
            ticket: String(b.ticket ?? ''), sessionId: String(b.sessionId ?? ''),
          })
          return r
        }
        return { ok: false, reason: 'unknown' }
      }

      const st = ui.createDialogState()
      st.open()
      const r = mount(React.createElement(ui.HobCreateOverlayLive, { state: st, call }))
      await tick(30)

      // 选工作区
      const sel = document.querySelector('select.dsh-hob-select')
      if (sel !== null) {
        const setter = Object.getOwnPropertyDescriptor(w.HTMLSelectElement.prototype, 'value')?.set
        act(() => {
          if (setter !== undefined) setter.call(sel, 'ws-A')
          else sel.value = 'ws-A'
          sel.dispatchEvent(new w.Event('change', { bubbles: true }))
        })
        await tick(20)
      }
      // ⚠ 选中**枚举外的档位**（若恶意服务真的把它画出来了）
      const wideRadio = [...document.querySelectorAll('input[name="hob-level"]')].find((i) => i.value === 'root')
      if (wideRadio !== undefined) {
        act(() => {
          wideRadio.dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
          wideRadio.checked = true
          wideRadio.dispatchEvent(new w.Event('change', { bubbles: true }))
        })
        await tick(20)
      }
      // 点创建
      const btn = submitBtn()
      if (btn !== null && btn.disabled !== true) {
        act(() => { btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true })) })
        await tick(60)
      }
      const text = String(document.body.textContent ?? '')
      act(() => { r.unmount() })

      const created = calls.filter((c) => c.action === 'create')
      if (wideRadio === undefined) {
        bad('D-22 ⚠ 恶意服务下**枚举外的档位没被渲染出来** ⇒ 本组没测到"界面被改坏"的形态（基准失效）')
      } else if (live.size !== 0) {
        bad(`D-22 ⚠⚠ **界面选中枚举外的档位后真的建出了 ${live.size} 个会话**`
          + ' ⇒ 服务端开放面校验不存在/被绕过（界面隐藏只是装饰）')
      } else if (!/(开放范围|合法枚举|可读档)/.test(text)) {
        /**
         * ⚠ **文案要求随形态变**：扩档后拒绝原因说的是"不在开放范围 / 不在合法枚举里"
         *   （⛔ 不再是"只开放账本权限"——那已经是过去时）。
         *   ⚠ 仍要求**用户看得懂**：必须点出"开放范围 / 合法枚举 / 可读档"之一。
         */
        bad(`D-22 非法档被拒了，但**用户可见文案没说清原因**（文本=${JSON.stringify(text.slice(0, 200))}）`
          + ' ⇒ 用户只会看到"失败了"，不知道是档位不合法')
      } else if (created.length !== 0) {
        /**
         * ⚠ 顺序说明：服务端**先拒签票**（`issue`）⇒ 界面上就失败了，**根本走不到 `create`**。
         *   ⇒ 正确读数 = `create` **0 次**（⛔ 不是 1 次：那意味着它明知签不出票还硬建）。
         *   ⚠ 本组第一版写"应 1 次"，那是把"拒在最前面"当成了缺陷 —— 绿态当场抓住。
         */
        bad(`D-22 create 请求次数 = ${created.length}（应 0 次：签票已被拒，界面不该继续建）`)
      } else {
        ok('D-22 ✓ **界面被恶意放宽（多给一个枚举外档位）+ 真的选中它 ⇒ 服务端仍拒建**（零会话 · `create` 零次），'
          + '且用户可见文案点明"开放范围 / 合法枚举" ⇒ 安全不依赖界面隐藏'
          + '（⚠ 扩档后本组测的是"枚举外的自报值"，改前完全没覆盖这个面向）')
      }
    }
  }

  // ── D-12 初始焦点 ────────────────────────────────────────────────
  {
    const { r } = await openDialog()
    const ae = document.activeElement
    if (ae === null || ae.tagName !== 'SELECT') {
      bad(`D-12 初始焦点不在工作区选择器上（activeElement = ${ae?.tagName}）`)
    } else {
      ok('D-12 ✓ **初始焦点**落在工作区选择器（`activeElement.tagName === "SELECT"`）')
    }
    act(() => { r.unmount() })
  }

  // ── D-23 能力红线在**用户做选择的那一屏** ─────────────────────────────
  /**
   * ⚠⚠ 修 D4 的判据（2026-10-23）：`R-26` / `UD-149` 要求「档名自带更多/更强暗示 ⇒
   *   紧邻必须有边界句」。此前唯一写这句的 `WorkModeCard`（`settings-panel.tsx:696`）
   *   **只定义、从未渲染**（`:901` 只剩注释）⇒ 用户真正做选择的那一屏反而没有红线。
   *   ⚠ 本条只断言"弹窗里有"，⛔ 不去断言 `WorkModeCard` 该不该删（那是另一笔债）。
   */
  {
    const { r } = await openDialog()
    const redline = document.querySelector('[data-hob-redline="work-mode"]')
    const text = String(document.body.textContent ?? '')
    const need = ['不能写', '不能执行命令', '不能组队']
    const missing = need.filter((x) => !text.includes(x))
    act(() => { r.unmount() })
    if (redline === null) {
      bad('D-23 推进方式旁**没有能力红线**（找不到 [data-hob-redline="work-mode"]）'
        + ' ⇒ 用户做选择的那一屏没有边界句')
    } else if (missing.length > 0) {
      bad(`D-23 红线缺关键句：${JSON.stringify(missing)}（三句必须逐字在）`)
    } else {
      ok('D-23 ✓ 推进方式旁**有能力红线**，三句逐字在（不能写 / 不能执行命令 / 不能组队）')
    }
  }

  // ── D-24 关闭后焦点**归还**到打开它的按钮（⚠ 与 D-12 初始焦点是两件事）──
  /**
   * ⚠⚠ 修 D5 的判据（2026-10-23）：此前 `:387-391` 逐字承诺「关闭后焦点回归到
   *   打开它的那个按钮」，但**零实现**（`focus` 全文件只有初始焦点那 1 处），
   *   而 D-12 只测初始焦点 ⇒ 这条承诺从来没被任何判据咬住。
   *   ⚠ 本条**必须能失败**：拿掉 overlay 里的 `opener()` 还原 effect，这里就红。
   *   ⚠ 与 D-12 **分列**（⛔ 不合写）：D-12 = 打开时焦点落哪；本条 = 关闭后焦点回哪。
   */
  {
    const st = ui.createDialogState()
    const trigger = document.createElement('button')
    trigger.id = 'd23-opener'
    trigger.textContent = '打开'
    document.body.appendChild(trigger)
    trigger.focus()
    if (document.activeElement !== trigger) {
      bad('D-24 前置不成立：触发按钮**拿不到焦点**（jsdom 焦点基线异常）⇒ 本条不可判')
    } else {
      st.open()
      const { call } = makeCall()
      const r = mount(React.createElement(ui.HobCreateOverlayLive, { state: st, call }))
      await tick()
      const inside = document.activeElement !== trigger && document.activeElement !== null
      act(() => { st.close() })
      await tick()
      const back = document.activeElement === trigger
      act(() => { r.unmount() })
      trigger.remove()
      if (!inside) bad('D-24 前置不成立：打开后焦点**没有离开**触发按钮（弹窗没接管焦点）')
      else if (!back) {
        bad(`D-24 关闭后焦点**没有归还**（activeElement = ${document.activeElement?.tagName ?? 'null'}）`
          + ' ⇒ 键盘用户要从头 Tab 一遍')
      } else {
        ok('D-24 ✓ 关闭后焦点**归还**到打开它的那个按钮（与 D-12 分列，可失败）')
      }
    }
  }

  // ── D-25 提交中**可退出**：取消不再静默早退 ──────────────────────────
  /**
   * ⚠⚠ 修 D1 的判据（2026-10-23）：服务端永不 resolve 时，用户此前**四条路全堵**
   *   （`cancel()` 对 submitting 早退 / 取消按钮 `disabled` / 无 X / backdrop 不接点击）
   *   ⇒ 唯一出路是刷新，而刷新会把「可能已建好」变成孤儿。
   *   ⚠ 本条用**永不 resolve 的假 call** 造那个形态，断言：取消按钮**可点**且点了
   *     之后**给出可读提示**（而不是静默关窗、也不是继续转圈）。
   */
  {
    const st = ui.createDialogState()
    st.open()
    const neverCall = async (b) => (b.action === 'enums'
      ? {
        ok: true, levels: ['ledger', 'project', 'workspace'], openLevels: ['ledger'],
        modes: ['auto', 'single', 'multi'], floorLevel: 'ledger', defaultMode: 'auto',
        levelsNote: '当前只开放「账本权限」。', workspaces: [{ id: 'ws-A', label: '项目甲' }],
      }
      : new Promise(() => { /* ⚠ 永不 settle：模拟服务端不回包 */ }))
    const r = mount(React.createElement(ui.HobCreateOverlayLive, { state: st, call: neverCall }))
    await tick()
    const sel = document.querySelector('select.dsh-hob-select')
    act(() => { sel.value = 'ws-A'; sel.dispatchEvent(new w.Event('change', { bubbles: true })) })
    const btn = submitBtn()
    await act(async () => { btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true })) })
    await tick(40)
    const cancelBtn = byText('取消')
    const disabledDuringSubmit = cancelBtn?.disabled === true
    if (cancelBtn === null) {
      bad('D-25 提交中**找不到取消按钮**（用户无退出通道）')
    } else if (disabledDuringSubmit) {
      bad('D-25 提交中取消按钮**被禁用**（用户唯一出路是刷新 ⇒ 会制造孤儿会话）')
    } else {
      act(() => { cancelBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true })) })
      await tick(30)
      const t = String(document.body.textContent ?? '')
      const said = /可能已经建好|可能已建好/.test(t)
      act(() => { r.unmount() })
      if (!said) bad('D-25 提交中点取消后**没有可读提示**（不得静默关窗/继续转圈）')
      else ok('D-25 ✓ 提交中取消**可用**，且给出「可能已创建，去列表确认」的可读提示')
    }
  }

  // ── D-26 弹窗内重开**不许**把 opener 记成弹窗内元素 ─────────────────────
  /**
   * ⚠⚠ 2026-10-23 自审补的边界（D-24 只测"关→开"的正常路径，测不到这条）：
   *   弹窗**已经开着**时再 `open()`/`openForSession()`（换模式重开），
   *   此刻 `document.activeElement` 已是**弹窗内部**节点 ⇒ 若重记，关闭后会把焦点
   *   "归还"到一个已卸载的节点 ⇒ 焦点丢到 BODY。
   *   ⇒ 本条钉住：`opener()` 必须始终是**弹窗打开之前**的那个元素。
   */
  {
    const st = ui.createDialogState()
    const trigger = document.createElement('button')
    trigger.id = 'd26-opener'
    trigger.textContent = '打开'
    document.body.appendChild(trigger)
    trigger.focus()
    st.open()
    const { call } = makeCall()
    const r = mount(React.createElement(ui.HobCreateOverlayLive, { state: st, call }))
    await tick()
    const openerAfterFirst = st.opener()
    /**
     * ⚠ 把焦点挪到**真正可聚焦**的弹窗内元素（`select`）再重开：
     *   上一版用了 `.dsh-hob-dialog` 容器 —— 它没有 `tabindex`，`focus()` 是空操作，
     *   `activeElement` 仍停在触发按钮上 ⇒ **负向对拍证明那条测不出东西**（2026-10-23 实测）。
     *   ⚠ 选一个真能接焦点的控件，本条才有判别力。
     */
    const insideEl = document.querySelector('select.dsh-hob-select')
    try { insideEl.focus?.() } catch { /* 忽略 */ }
    const focusMoved = document.activeElement === insideEl
    st.openForSession('S-reopen')
    await tick()
    const openerAfterReopen = st.opener()
    act(() => { r.unmount() })
    trigger.remove()
    if (openerAfterFirst !== trigger) {
      bad('D-26 前置不成立：首次 `open()` 没把触发按钮记成 opener')
    } else if (!focusMoved) {
      bad('D-26 前置不成立：弹窗内元素**拿不到焦点**，本条测不出「重开是否重记」')
    } else if (openerAfterReopen !== trigger) {
      bad(`D-26 弹窗内重开后 opener **被改写**成 ${openerAfterReopen?.tagName ?? 'null'}`
        + '（关窗后会把焦点还给已卸载的节点 ⇒ 焦点丢到 BODY）')
    } else {
      ok('D-26 ✓ 弹窗内重开**不重记** opener（始终是打开弹窗的那个按钮）')
    }
  }

  // ── D-13 窄屏无横向溢出 ───────────────────────────────────────────
  {
    // ⚠ jsdom 没有真实布局引擎 ⇒ 这里测**可判的结构事实**：
    //   ① 容器没有写死像素宽度（⛔ 不 `width: 900px` 这种窄屏溢出源）；
    //   ② 内联样式里没有 `width`/`minWidth` 固定值；
    //   ③ 存在窄屏媒体查询（CSS 里 `max-width` 分支）。
    //   ⚠ **视觉重叠必须真浏览器**（Playwright），本机未装 ⇒ 见回报"未验证"。
    const { r } = await openDialog()
    const dlg = document.querySelector('.dsh-hob-dialog')
    const inline = dlg?.getAttribute('style') ?? ''
    const cssPath = join(root, 'src', 'client', 'panel-styles.ts')
    let css = ''
    try { css = readFileSync(cssPath, 'utf8') } catch { css = '' }
    const hasNarrow = /max-width:\s*(4\d\d|5\d\d|6\d\d)px/.test(css) || /@media[^{]*max-width/.test(css)
    const hardWidth = /width:\s*\d{3,}px/.test(inline)
    if (hardWidth) bad(`D-13 弹窗内联样式写死宽度 ⇒ 窄屏会溢出：${inline}`)
    else if (!hasNarrow) {
      bad('D-13 样式里**没有窄屏媒体查询/最大宽度** ⇒ 窄屏适配未做（此项**未验证**，见回报）')
    } else {
      ok('D-13 ✓ 弹窗**不写死宽度**、样式里有窄屏分支（`max-width` 媒体查询）；'
        + '⚠ 视觉重叠需真浏览器，本轮**未验**')
    }
    act(() => { r.unmount() })
  }

  // ── D-14 失败且 unsafe ⇒ 文案必须警告 ─────────────────────────────
  {
    const { r } = await openDialog({
      create: {
        ok: false,
        unsafe: true,
        stranded: { sessionId: 'S-bad', level: 'workspace', workMode: 'multi', executable: true },
        reason: '写入后回读不一致；回收失败且隔离也失败',
      },
    })
    const sel = document.querySelector('select.dsh-hob-select')
    act(() => { sel.value = 'ws-A'; sel.dispatchEvent(new w.Event('change', { bubbles: true })) })
    await act(async () => { submitBtn().dispatchEvent(new w.MouseEvent('click', { bubbles: true })) })
    await tick(40)
    const text = String(document.body.textContent)
    if (!text.includes('高档') && !text.includes('无法确认已隔离')) {
      bad('D-14 `unsafe` 失败但文案**没有警告**（应明说可能残留高档、不可继续）')
    } else if (text.includes('恒按最低档读')) {
      bad('D-14 `unsafe` 失败却写了"恒按最低档读" ⇒ **虚假安全文案**')
    } else {
      ok('D-14 ✓ `unsafe` 失败时文案**明确警告**"可能有残留按高档执行且无法确认已隔离"'
        + '（⛔ 不写成"安全的最低档"）')
    }
    act(() => { r.unmount() })
  }

  // ── D-15 失败但已隔离 ⇒ 文案说已隔离 ──────────────────────────────
  {
    const { r } = await openDialog({
      create: {
        ok: false,
        stranded: { sessionId: 'S-q', level: 'workspace', workMode: 'multi', executable: false },
        quarantine: { ok: true, reason: '' },
        reason: '回收失败，但策略已持久隔离',
      },
    })
    const sel = document.querySelector('select.dsh-hob-select')
    act(() => { sel.value = 'ws-A'; sel.dispatchEvent(new w.Event('change', { bubbles: true })) })
    await act(async () => { submitBtn().dispatchEvent(new w.MouseEvent('click', { bubbles: true })) })
    await tick(40)
    const text = String(document.body.textContent)
    if (!text.includes('持久隔离')) bad('D-15 已隔离但文案没提"持久隔离"')
    else ok('D-15 ✓ 已隔离的失败 ⇒ 文案说**已持久隔离**（与 D-14 的警告分开，⛔ 两种不混成一句）')
    act(() => { r.unmount() })
  }

  // ── D-16 **完整用户路径**：点击 → 弹窗 → 选 → 提交 → 关窗 → 结果条仍在 → 点 → **真导航** ──
  /**
   * ⚠⚠ 上一版 D-16 只**单独**挂 `HobCreatedNotice` 组件，⛔ 那验不到 Hob 指出的缺口：
   *   真实路径是「弹窗成功 ⇒ `markCreated` 后**立刻 close**」⇒ 如果结果条**没有**
   *   注册在生产槽里，用户看到的就是"窗关了、什么都没有"。
   *   ⇒ 本组走**一条完整链路**，并且**在同一个挂载里**断言：
   *     ① 弹窗真的关掉；② 结果条**仍然可见**（因为它挂在**另一个** overlay 条目上）；
   *     ③ 结果条上的按钮**真的调用**注入的 `openSession`，且参数 = 那个 sessionId；
   *     ④ 调用后结果条**收起**（不残留）。
   *   ⚠ `openSession` 在这里是**受控假实现**（记录调用）；它的**真实现**是宿主的
   *     `uiWorkspace.openSession` —— 那条在 D-17 用**源码契约**钉。
   */
  {
    const st = ui.createDialogState()
    st.open()
    const { call } = makeCall({ create: { ok: true, sessionId: 'S-full-path' } })
    /** ⚠ 受控导航替身：记录被调到的那一次。 */
    const navigated = []
    const openSession = (sid) => { navigated.push(sid) }

    /**
     * ⚠ **按生产注册的形状**同时挂三条 overlay 条目（入口 / 弹窗 / 结果条），
     *   用同一个 `state` —— 这样"关窗后结果条还在"才是**真的**在测组合，不是分开测。
     */
    const host = document.getElementById('root')
    host.innerHTML = ''
    const r = createRoot(host)
    act(() => {
      r.render(React.createElement('div', null,
        React.createElement(ui.HobCreateCommandEntry, { state: st, key: 'entry' }),
        React.createElement(ui.HobCreateOverlayLive, { state: st, call, key: 'dialog' }),
        React.createElement(ui.HobCreatedNoticeLive, { state: st, openSession, key: 'notice' }),
      ))
    })
    await tick()

    // ① 点入口 ⇒ 弹窗出现
    const entryBtn = document.querySelector('button.dsh-hob-entryBtn')
    act(() => { entryBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true })) })
    const dialogAppeared = document.querySelector('[role="dialog"]') !== null

    // ② 选工作区 + 提交
    const sel = document.querySelector('select.dsh-hob-select')
    act(() => { sel.value = 'ws-A'; sel.dispatchEvent(new w.Event('change', { bubbles: true })) })
    await act(async () => { submitBtn().dispatchEvent(new w.MouseEvent('click', { bubbles: true })) })
    await tick(50)

    const dialogGone = document.querySelector('[role="dialog"]') === null
    /**
     * ③ **关键**：弹窗没了，但结果条**必须还在**（这正是上一版缺的那一环），
     *   而且**带一个真按钮**（⛔ 不是无 handler 的装饰）。
     */
    const notice = document.querySelector('.dsh-hob-created')
    const noticeBtn = notice === null
      ? null
      : [...notice.querySelectorAll('button')].find((b) => b.textContent === '打开该会话')
    const noticeText = notice === null ? '' : String(notice.textContent)

    // ④ 点结果条的按钮 ⇒ 真调 openSession（同一 sessionId），且结果条收起
    if (noticeBtn !== null) {
      act(() => { noticeBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true })) })
      await tick(20)
    }
    const noticeGone = document.querySelector('.dsh-hob-created') === null

    if (!dialogAppeared) bad('D-16 点了入口但弹窗**没出现** ⇒ 链路第一步就断')
    else if (!dialogGone) bad('D-16 提交成功后弹窗**没有关掉**')
    else if (notice === null) {
      bad('D-16 ⚠⚠ **弹窗关掉后结果条不见了** ⇒ 用户看到"窗关了、什么都没有"'
        + '（这正是 Hob 指出的缺口：`HobCreatedNotice` 没被注册进生产槽）')
    } else if (!noticeText.includes('S-full-path')) bad('D-16 结果条里**看不到**新会话 id')
    else if (noticeBtn === null) {
      bad('D-16 结果条**没有"打开该会话"按钮**（⛔ 无 handler 的装饰按钮不算入口）')
    } else if (navigated.length !== 1 || navigated[0] !== 'S-full-path') {
      bad(`D-16 点了"打开该会话"但**没有真的调用导航**：navigated=${JSON.stringify(navigated)}`)
    } else if (!noticeGone) bad('D-16 导航之后结果条**没有收起**（会一直挂在界面上）')
    else {
      ok('D-16 ✓ **完整用户路径成立**：点入口 → 弹窗 → 选工作区 → 提交 → **弹窗关闭** → '
        + '**结果条仍在**（挂在独立的第三条 overlay 条目上）→ 点「打开该会话」→ '
        + '**真的调用了 `openSession("S-full-path")`** → 结果条收起')
    }
    act(() => { r.unmount() })
  }

  // ── D-17 生产注册里**真的接了** `uiWorkspace.openSession`（⛔ 不是只有组件）──
  /**
   * ⚠ D-16 证明"组件能工作"；**这一条**才证明"生产装配真的把它接上了"。
   *   判据：`src/client/index.ts` 必须
   *     ① 注册 `HOB_CREATED_NOTICE_ID`（结果条有自己的槽条目）；
   *     ② 传给它的 `openSession` 里**真的调** `uiWorkspace.openSession`；
   *     ③ `uiWorkspace` 必须是**可选读取**、不得放进 `inject` 加载门禁：
   *        该服务缺席时只降级「自动打开会话」，不能阻断整个 client 插件。
   *   ⚠ 这是**源码契约**判据（本组唯一一条）—— 它是"装配对不对"，不是"UI 行为"，
   *     所以放这里而不是伪装成 DOM 测试。
   */
  {
    let idx = ''
    try { idx = readFileSync(join(root, 'src', 'client', 'index.ts'), 'utf8') } catch { idx = '' }
    const registered = /HOB_CREATED_NOTICE_ID/.test(idx) && /id:\s*HOB_CREATED_NOTICE_ID/.test(idx)
    const callsOpen = /uiWorkspace/.test(idx) && /\.openSession\s*\(/.test(idx)
    const hasInjectUiWorkspace = /export const inject = \[[^\]]*'uiWorkspace'[^\]]*\]/.test(idx)
    const optionalRead = /ctx\.get\(\s*['"]uiWorkspace['"]\s*\)/.test(idx)
    if (idx === '') bad('D-17 读不到 client 入口源码 ⇒ 失去基准')
    else if (!registered) bad('D-17 生产里**没有注册**结果条（`HOB_CREATED_NOTICE_ID` 未出现在注册里）')
    else if (!callsOpen) bad('D-17 生产里的 `openSession` **没有真的调** `uiWorkspace.openSession`')
    else if (!optionalRead) bad("D-17 `uiWorkspace` 没有经 `ctx.get('uiWorkspace')` 可选读取")
    else if (hasInjectUiWorkspace) bad('D-17 `uiWorkspace` 不得放进 `inject` 加载门禁')
    else {
      ok('D-17 ✓ 生产装配齐备：结果条有**独立 overlay 条目**、其 `openSession` 真的调'
        + ' `uiWorkspace.openSession`、该服务缺席时只降级而不阻断整个插件')
    }
  }

  // ── D-28 取消后**不许再发第二个 create**（防重复建会话）──────────────────
  /**
   * ⚠⚠ 2026-10-23 · 产品域指出的第三半（**这是真缺口，不是过期读数**）：
   *   取消只把 `phase` 改成 `error` ⇒ `canSubmit` 恢复 true、按钮重新可点；
   *   而 `submit()` 入口只挡 `phase.kind === 'submitting'` ⇒ **能再发一次**，
   *   且新建分支每次 `mint()` 新 id ⇒ 旧 create 还在飞 + 新 create 发出 = **两个会话**。
   *   D-27 只钉住"晚到回包不许覆盖警示"，**测不到"又发了一个 create"**。
   *   ⇒ 本条：create 挂住 → 取消 → **再点提交** → 断言 create 次数**仍是 1**。
   *   ⚠ 必须能失败：拿掉 `submit()` 里的 `if (inFlightRef.current) return`，本条就红。
   */
  {
    const st = ui.createDialogState()
    st.open()
    let releaseCreate = () => {}
    const createGate = new Promise((res) => { releaseCreate = () => res({ ok: true, sessionId: 'S-dup' }) })
    /** ⚠ 记下每一次 create 的 sessionId —— 用来证明"没有第二个 id 被 mint 出来"。 */
    const createSeen = []
    const gateCall = async (b) => {
      if (b.action === 'enums') {
        return {
          ok: true, levels: ['ledger', 'project', 'workspace'], openLevels: ['ledger'],
          modes: ['auto', 'single', 'multi'], floorLevel: 'ledger', defaultMode: 'auto',
          levelsNote: '当前只开放「账本权限」。', workspaces: [{ id: 'ws-dup', label: '项目丁' }],
        }
      }
      if (b.action === 'issue') return { ok: true, ticket: 't-dup-' + String((b.sessionId ?? '')) }
      if (b.action === 'create') { createSeen.push(String(b.sessionId ?? '')); return createGate }
      return { ok: false, reason: 'unexpected' }
    }
    const r = mount(React.createElement(ui.HobCreateOverlayLive, { state: st, call: gateCall }))
    await tick()
    const sel = document.querySelector('select.dsh-hob-select')
    act(() => { sel.value = 'ws-dup'; sel.dispatchEvent(new w.Event('change', { bubbles: true })) })
    const btn = submitBtn()
    await act(async () => { btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true })) })
    await tick(40)
    const firstCount = createSeen.length
    // 取消（此时 create 仍挂在飞）
    const cancelBtn = byText('取消')
    act(() => { cancelBtn?.dispatchEvent(new w.MouseEvent('click', { bubbles: true })) })
    await tick(20)
    // ⚠ 关键：再点一次「创建」——若没有在飞闸，这会 mint 新 id 并发第二个 create
    const btn2 = submitBtn()
    if (btn2 !== null && btn2.disabled !== true) {
      await act(async () => { btn2.dispatchEvent(new w.MouseEvent('click', { bubbles: true })) })
      await tick(40)
    }
    const afterCount = createSeen.length
    const distinctIds = new Set(createSeen).size
    act(() => { releaseCreate(); r.unmount() })
    if (firstCount !== 1) {
      bad(`D-28 前置不成立：第一次提交的 create 次数 = ${firstCount}（应 1）`)
    } else if (afterCount > 1) {
      bad(`D-28 取消后**又发出了 create**（共 ${afterCount} 次，涉及 ${distinctIds} 个不同 sessionId）`
        + ' ⇒ 旧请求还在飞、新的又发 ⇒ 可能真建出两个会话')
    } else {
      ok('D-28 ✓ 取消后按钮即使可点，**也不会再发 create**（create 次数仍为 1）')
    }
  }

  // ── D-27 取消后**晚到的回包**不得覆盖「可能已创建」警告 ────────────────
  /**
   * ⚠⚠ 修 D1 的**第二半**（2026-10-23）：
   *   D-25 只证明"提交中取消**可用**且给出提示"，但取消时请求**仍在飞**。
   *   若不作废那一次提交，回包晚到一步会把警示**覆盖成「已创建会话…」成功态** ——
   *   用户于是以为一切正常，而实际上他刚被告知"可能已建好、去列表确认"。
   *   ⇒ 本条用**可控延迟**的假 call 精确造出"取消 → 回包才到"的时序：
   *     ① 点提交（create 悬挂）；② 点取消（应见警示）；③ 才放回包（成功）。
   *   ⚠ **必须能失败**：拿掉 `abandonedRef` 的作废与 `stillWanted()` 核对，本条必红。
   */
  {
    const st = ui.createDialogState()
    st.open()
    /** create 的手动闸：`release()` 之后才返回成功。 */
    let releaseCreate = () => {}
    const createGate = new Promise((res) => { releaseCreate = () => res({ ok: true, sessionId: 'S-late' }) })
    const gatedCall = async (b) => {
      if (b.action === 'enums') {
        return {
          ok: true, levels: ['ledger', 'project', 'workspace'], openLevels: ['ledger'],
          modes: ['auto', 'single', 'multi'], floorLevel: 'ledger', defaultMode: 'auto',
          levelsNote: '当前只开放「账本权限」。', workspaces: [{ id: 'ws-late', label: '项目乙' }],
        }
      }
      if (b.action === 'issue') return { ok: true, ticket: 't-late' }
      if (b.action === 'create') return createGate
      return { ok: false, reason: 'unexpected' }
    }
    const r = mount(React.createElement(ui.HobCreateOverlayLive, { state: st, call: gatedCall }))
    await tick()
    const sel = document.querySelector('select.dsh-hob-select')
    act(() => { sel.value = 'ws-late'; sel.dispatchEvent(new w.Event('change', { bubbles: true })) })
    const btn = submitBtn()
    await act(async () => { btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true })) })
    await tick(40)
    const cancelBtn = byText('取消')
    act(() => { cancelBtn?.dispatchEvent(new w.MouseEvent('click', { bubbles: true })) })
    await tick(30)
    const afterCancel = String(document.body.textContent ?? '')
    const warned = /可能已经建好|可能已建好/.test(afterCancel)
    // ③ 现在才让那条"晚到的成功"回来
    act(() => { releaseCreate() })
    await tick(40)
    const afterLate = String(document.body.textContent ?? '')
    const stillWarned = /可能已经建好|可能已建好/.test(afterLate)
    const claimsCreated = /已创建会话并写入两项选择/.test(afterLate)
    /**
     * ⚠ 三条**任一**成立都算"晚到回包被采纳了"（⛔ 不要只看文案一种形态）：
     *   ① 文案变成「已创建…」；② 警示消失；③ 状态里被记了 created / 弹窗被关掉。
     *   ⚠ 第 ③ 条是实测补的：去掉 `stillWanted()` 后，晚到回包会走 `onCreated()`
     *     ⇒ 弹窗直接关掉、警示随卸载一起消失 —— 只看文案会漏掉这种形态。
     */
    const actedOn = claimsCreated || !stillWarned || st.created() !== undefined || st.isOpen() === false
    act(() => { r.unmount() })
    if (!warned) {
      bad('D-27 前置不成立：提交中点取消后**没有出现**「可能已创建」警示（D-25 已红）')
    } else if (actedOn) {
      bad('D-27 ⚠ 取消后**晚到的成功回包被采纳**'
        + `（claimsCreated=${claimsCreated} · warningStillThere=${stillWarned}`
        + ` · created=${String(st.created())} · stillOpen=${String(st.isOpen())}）`
        + ' ⇒ 用户刚被告知"去列表确认"，界面却替他确认成功了')
    } else {
      ok('D-27 ✓ 取消后**晚到的成功回包被丢弃**：「可能已创建」警示仍在，未变成「已创建」')
    }
  }

  // ── D-150 · S-14 / O-20：**弹窗关着时，必须另有**一个能打开它的入口 ──────
  /**
   * ⚠⚠ **这条补的是 REVIEW 的 S-14**（O-20 在机检侧的镜像）。
   *
   *   S-14 的原话：「门禁入口机检从未断言**关着时应该能打开**」。
   *   ⚠ 但本文件 **D-1a 已经断言过「弹窗关闭时入口不渲染」** ——
   *     那证明的是「不常驻」，⛔ **不是**「关着时有别的入口能打开它」。
   *     两者是**不同的命题**：前者说「这个组件不在」，后者说「另有一条路在」。
   *
   *   ⇒ 本条的判据（**只看源码层，⛔ 不挂载组件**）：
   *     ① create-hob-dialog.tsx 里 state.open() 的调用点**必须**在
   *        if (!isOpen) return null **之后**（即：它**不是**打开入口）；
   *     ② 同时必须**另有**一个不依赖 isOpen 的入口 ——
   *        实测是 hob-unselected-gate.tsx 的横幅（unrecorded 时渲染）。
   *   ⚠ 只测 ① 会退化成「删掉组件也过」；只测 ② 就是既有断言的盲区。
   */
  {
    const { readFileSync: rf } = await import('node:fs')
    const { join: pj } = await import('node:path')
    const dialogSrc = rf(pj(root, 'src', 'client', 'create-hob-dialog.tsx'), 'utf8')
    const gateSrc = rf(pj(root, 'src', 'client', 'hob-unselected-gate.tsx'), 'utf8')
    const probs = []
    /**
     * ① 锚点组件里 open() 必须在 return null 之后 —— 否则它就成了打开入口（与注释矛盾）。
     * ⚠⚠ **必须限定在 `HobCreateCommandEntry` 这个函数体内**（实测踩过）：
     *   本文件有**两个** `if (!isOpen) return null`（锚点 + 弹窗本体），
     *   裸 `indexOf` 取到的是**第一个**（弹窗本体，:1446 附近）⇒ 判据永远看不出错位。
     */
    const entryStart = dialogSrc.indexOf('export function HobCreateCommandEntry')
    const entryEnd = entryStart < 0 ? -1 : dialogSrc.indexOf('\nexport function ', entryStart + 10)
    const entryRaw = entryStart < 0 ? '' : dialogSrc.slice(entryStart, entryEnd < 0 ? undefined : entryEnd)
    /**
     * ⚠⚠ **必须先剥注释再扫**（实测踩过）：我在 O-20 的说明注释里写了 `state.open()`
     *   这个字符串，于是裸扫取到的是**注释里的那个**（在 `return null` 之前）⇒ 判据恒红。
     *   ⚠ 这是本仓反复记的同一类：**判据扫到了它自己的说明文字**。
     */
    const entrySrc = entryRaw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    const nullIdx = entrySrc.indexOf('if (!isOpen) return null')
    /**
     * ⚠ 查**任意** `state.open()` 调用，⛔ 不是特定那个 `onClick:` 串（实测踩过：
     *   只认 `onClick: () => props.state.open()` 时，把 `open()` 插到 `return null`
     *   之前（形态 `if (!isOpen) { props.state.open() }`）**判据看不出来**）。
     */
    const openCallIdx = entrySrc.indexOf('state.open()')
    if (nullIdx < 0) probs.push('找不到 if (!isOpen) return null（锚点组件的形态变了）')
    if (openCallIdx < 0) probs.push('找不到 state.open() 的调用点')
    if (nullIdx >= 0 && openCallIdx >= 0 && openCallIdx < nullIdx) {
      probs.push('state.open() 在 return null **之前** ⇒ 锚点变成了打开入口（与 O-20 的注释矛盾）')
    }
    /** ② 必须另有不依赖 isOpen 的入口。 */
    if (!/export function installHobUnselectedGate/.test(gateSrc)) {
      probs.push('找不到 installHobUnselectedGate ⇒ 弹窗关着时**没有任何**入口（O-20 的另一半）')
    }
    /** ③ 该横幅必须在 unrecorded 时渲染（不是只在弹窗内）。 */
    if (!/unrecorded/.test(gateSrc)) {
      probs.push('横幅没有 unrecorded 分支 ⇒ 它不会在弹窗关着时出现')
    }
    if (probs.length === 0) {
      ok('D-150 ✓ 弹窗关着时**另有**入口：锚点的 state.open() 在 return null 之后（⛔ 不提供打开能力），真正的兜底是 hob-unselected-gate 的横幅（S-14 / O-20）')
    } else for (const x of probs) bad('D-150 · ' + x)
  }
  cleanup()
  console.log('')
  console.log(`  汇总：通过 ${pass} · 失败 ${fail}`)
  /**
   * ⚠⚠ **本族也必须印 `处级口径` 行**（2026-10-24 · B 席）——
   *   改前本族**只印"汇总：通过 N · 失败 M"**，没有 `查了 N 处` / `跳过 N 处`
   *   ⇒ `check:all` 的 `parseAssertionCount()` / `parseSkipCount()` 都读不到
   *   ⇒ 汇总行把它归进「结构上没能报这个口径」，**它的 28 条断言一条都不进总数**
   *     ⇒ 于是"断言数下界"对它是**盲**的（摘掉几条也不会红）。
   *   ⚠ `查了 = 过了 + 没过 + 跳过` 必须成立（`check:all` 会逐族核这条等式）。
   */
  console.log(`  处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处`
    + (fail > 0 ? ` · 没过 ${fail} 处` : '')
    + ' · **跳过 0 处**（⚠ 跳过**不计入通过**；⚠ 本族无跳过分支 —— 依赖不可用时走 `exit 2`）')
  if (fail > 0) {
    console.log('')
    console.log('  失败明细：')
    for (const l of badLines) console.log(`   · ${l}`)
  }
  process.exit(fail > 0 ? 1 : 0)
} catch (e) {
  console.error(`✗ check:hob-create-dom 自身异常：${String(e?.stack ?? e)}`)
  cleanup()
  console.error('      ⇒ 检查器崩溃**不按通过处理**（exit 3）；临时件已清')
  process.exit(3)
}
