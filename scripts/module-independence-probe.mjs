/**
 * 模块独立启停探针 —— 用**真产物** `lib/` 验证两条启停路径。
 *
 * 路径 A（配置开关）：`modules.x=false` ⇒ 该模块不被装载，其它模块照常。
 * 路径 B（依赖门禁）：模块 `inject` 的服务不存在 ⇒ 该模块 fiber 停在 PENDING，
 *                     插件整体照常加载、其它模块照常工作（**不报错**）。
 *
 * ⚠ 本探针**真实调用 cordis 的 `ctx.plugin`**（不是自己模拟登记表），
 *   这样"加载门禁"才是 cordis 自己判的，而不是我复述的。
 *
 * ⚠ **何时该跑**：模块的 `inject` / 开关口径 / `apply()` 登记行为变更时。
 *   ⚠ 自 2026-10-11（第 51 轮）起它**已登记进 `package.json`**（`check:modules`）
 *   ⇒ 是收尾必跑命令之一，不再是"躺在库里没人跑"的脚本（**E-122**）。
 *
 * ── 用法与环境 ────────────────────────────────────────────────────────────
 *       npm run check:modules      # 期望退出码 0（全部 PASS）
 *       npm run build              # ⚠ 先决条件：本探针用**真产物** `lib/`
 *   ⚠ 根由 `import.meta.url` 推导（**不再硬编码绝对路径** —— 换目录不会断）；
 *     `lib/` 不存在时**可读地报告并 exit 2**（不裸抛，见下）。
 *
 * ── 为什么退出码分三档（0 / 1 / 2）────────────────────────────────────────
 *   `0` = 全部 PASS；`1` = **有断言 FAIL**（探针跑起来了，是被测对象不对）；
 *   `2` = **探针本身跑不起来**（没 build / 产物缺失）——
 *   ⚠ 这时**什么都没测到**，绝不能算"通过"。
 *   出处：`PROJECT.md` **R-10**「静默 skipped ⇒ exit 2，不是成功」。
 *
 * ── 断言口径的实测出处（2026-10-11 第 51 轮 · 用**真产物** `lib/` 复测，非推断）──
 *   · 默认 `modules` 开关（解 ref）=== `{tools:true, bus:true, orch:false, settings:true, interconnect:false}`
 *     ⚠ `bus` **自 M3（`a89111f` · 2026-10-08 · UD-77）起默认 `true`** ——
 *       本探针原先写在基线期（`a850ae6` · 2026-10-05），那时默认是 `false`
 *       ⇒ 本条期望**已过期**，第 51 轮按实测订正（⛔ **不是放宽，是订正事实**）。
 */

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 脚本所在目录 = `<root>/scripts` ⇒ 上跳一级即仓库根。 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = resolve(ROOT, 'lib', 'index.js')
const CORDIS = resolve(ROOT, 'node_modules', '@deepseek-ai', 'cordis', 'lib', 'index.js')

// ── 退出码 2：探针本身跑不起来（**不是**断言失败）────────────────────────────
if (!existsSync(ENTRY)) {
  console.error(`未构建：找不到产物 ${ENTRY}`)
  console.error('  ⇒ 先跑 `npm run build`（本探针用的是**真产物** `lib/`，不是 `src/`）。')
  console.error('  ⇒ 本次**未测到任何东西**（不是通过）—— 退出码 2 与"断言失败(1)"有意区分。')
  process.exit(2)
}
if (!existsSync(CORDIS)) {
  console.error(`依赖缺失：找不到 cordis ${CORDIS}`)
  console.error('  ⇒ 先跑 `npm install`。本次**未测到任何东西**（不是通过）。')
  process.exit(2)
}

let cordis
let mod
try {
  cordis = await import(pathToFileURL(CORDIS).href)
  mod = await import(pathToFileURL(ENTRY).href)
} catch (e) {
  console.error(`无法加载产物：${String(e?.message ?? e)}`)
  console.error('  ⇒ 本次**未测到任何东西**（不是通过）—— 退出码 2 与"断言失败(1)"有意区分。')
  process.exit(2)
}
const { Context } = cordis

let fail = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
  if (!ok) fail++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 建一个真实 cordis 根 context，并把我们的插件装进去。
 * ⚠ 必须传 **raw config**：cordis 自己会用它校验并物化 volatile 为 ref。
 *   传已物化对象会二次校验失败（实测：`invalid config: $.persona ... got {}`）。
 */
async function boot(configInput) {
  const root = new Context()
  const fiber = root.plugin(mod, configInput) // ← raw
  await fiber
  await sleep(30) // 让模块 fiber 落定
  return { root, fiber }
}

/** 取根 registry 上**已登记**的模块名（`apply` 走 `ctx.plugin` ⇒ 登记名进 registry）。 */
function registryNames(root) {
  const names = []
  for (const rt of (root.registry?.values?.() ?? [])) names.push(rt.name)
  return names
}

console.log('=== 路径 A：配置开关（默认 modules.bus=true，自 M3 / UD-77 起）===')
{
  const { root } = await boot({})
  const names = registryNames(root)
  check(
    '默认配置下，tools / bus / settings 三个模块被装载（orch 默认关）',
    names.includes('dsh-hob-tools') && names.includes('dsh-hob-bus') && names.includes('dsh-hob-settings'),
    JSON.stringify(names),
  )
  check(
    '默认配置下，orch 模块**未**被装载（默认 modules.orch=false）',
    !names.includes('dsh-hob-orchestrator'),
    JSON.stringify(names),
  )
}

console.log('\n=== 路径 A2：开 bus 但关 tools（验证彼此独立）===')
{
  const { root } = await boot({ modules: { tools: false, bus: true, settings: true } })
  const names = registryNames(root)
  check('tools=false ⇒ tools 未被装载', !names.includes('dsh-hob-tools'), JSON.stringify(names))
  check('同一配置下 settings 仍被装载（互不影响）', names.includes('dsh-hob-settings'), JSON.stringify(names))
  check('同一配置下 bus 被装载', names.includes('dsh-hob-bus'), JSON.stringify(names))
}

console.log('\n=== 路径 B：依赖门禁（缺服务 ⇒ 该模块 PENDING，整体照常）===')
{
  // 该根 context 没有任何宿主服务 ⇒ 有模块级 inject 的模块都该 PENDING，
  // 且**插件整体不报错**（boot() 没抛错就已经证明了后者）。
  const { root } = await boot({ modules: { tools: true, settings: true, bus: false } })
  check('缺依赖时插件整体加载完成（未抛错）', true)
  let pending = 0
  for (const rt of (root.registry?.values?.() ?? [])) {
    for (const f of (rt.fibers ?? [])) if (f.state === 0) pending++ // PENDING = 0
  }
  check('缺依赖的模块确实停在 PENDING（state=0）', pending > 0, `pending=${pending}`)
}

console.log('\n=== 路径 B2：两种 inject 的**不同后果**（E-02 的实证）===')
{
  const root = new Context()
  root.provide?.('tools', {}) // 只提供 tools，**不提供** settings
  const logs = []
  root.logger = { ...root.logger, info: (...a) => logs.push(a.join(' ')), warn: () => {}, error: () => {}, debug: () => {} }
  const f = root.plugin(mod, { modules: { tools: true, settings: true, bus: false } })
  await f
  await sleep(30)
  const states = []
  for (const rt of (root.registry?.values?.() ?? [])) {
    for (const fib of (rt.fibers ?? [])) states.push({ name: rt.name, state: fib.state })
  }
  const tools = states.find((s) => s.name === 'dsh-hob-tools')
  const settings = states.find((s) => s.name === 'dsh-hob-settings')

  // ① 模块级 inject（tools 模块）= **加载门禁**：tools 服务在场 ⇒ ACTIVE。
  check('模块级 inject + 服务在场 ⇒ tools 模块 ACTIVE（state=2）', tools?.state === 2, JSON.stringify(tools))

  // ② 模块级 inject 缺服务 ⇒ PENDING（见路径 B 已证 pending>0）。
  // ③ `ctx.inject`（settings 模块）= **反应式订阅**：模块**照常激活**，
  //    只有回调延后。所以 settings 服务缺席时它仍是 ACTIVE 而不是 PENDING ——
  //    这是两者**真实不同的后果**，不是缺陷。
  check(
    'ctx.inject + 服务缺席 ⇒ settings 模块仍 ACTIVE（state=2，只是回调未跑）',
    settings?.state === 2,
    JSON.stringify(settings),
  )

  // ④ 关键结论：同一插件内「一个模块被门禁挡住、另一个照常激活」——互不阻塞。
  check('同插件共存：tools ACTIVE 与 settings ACTIVE 各自独立', tools?.state === 2 && settings?.state === 2)

  // ⑤ 更强的证据：缺依赖的 settings 模块**确实没有执行它的探测回调**。
  check(
    'settings 服务缺席 ⇒ 其探测回调未执行（无对应日志）',
    !logs.some((l) => String(l).includes('settings 服务可用')),
  )
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
