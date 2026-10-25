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
/**
 * ⚠ **产物根可被 `HOB_PROBE_LIB` 指向一份临时副本**（负向对拍用：把 settings 模块的
 *   探测日志改哑，确认第 ⑤ 条**会红**而不是恒绿）。
 * ⚠ 与 `check:orch` 的 `HOB_SA_ROOT` / `check:policy` 的 `HOB_SP_ROOT` / `HOB_DOM_ROOT` /
 *   `HOB_GATE_ROOT` / `HOB_CF_ROOT` **同一约定**（⛔ 不另造开关名）。
 */
const LIB_ROOT = process.env.HOB_PROBE_LIB !== undefined && process.env.HOB_PROBE_LIB !== ''
  ? process.env.HOB_PROBE_LIB
  : resolve(ROOT, 'lib')
const ENTRY = resolve(LIB_ROOT, 'index.js')
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
/**
 * ── ⚠⚠ **处级计数**（2026-10-21 · 第 350 轮 · 甲-1 收尾）──────────────────
 *   `checked` = 真跑过的处数（每条 `check()` 一次）；`fail` = 其中不符的。
 *   ⚠ 本族**没有**"跳过"分支（每条 check 都有对象）⇒ `skip` 恒 0，
 *     但口径行必须印（"没有跳过"是读数，⛔ 不许因为 0 就不印）。
 *   ⚠ `查了 = 过了 + 跳过`：过了 = `checked - fail`。⛔ 不许把 `fail` 塞进"过了"。
 */
let checked = 0
const skip = []
const check = (name, ok, extra = '') => {
  checked++
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

/**
 * 取根 registry 上**已登记**的模块名（`apply` 走 `ctx.plugin` ⇒ 登记名进 registry）。
 *
 * ⚠⚠ **2026-10-21 · 第 330 轮 · 乙-1**：本函数现在**同时**回带"取数面在不在"。
 *
 * ── 改前的病灶（`PROJECT-SURVEY-3` §6.2 乙-1）────────────────────────
 *   它返回 `[]` 时，下面两条**否定式**断言（`!names.includes('dsh-hob-tools')` 等）
 *   **恒真** ⇒ ⚠「**取数面塌了**」与「**取数面正常、且确实没有那个模块**」
 *   印出**逐字相同**的 `PASS`。这正是本项目最忌的"两种原因说成同一句话"。
 *   ⚠ `[]` 的成因**不止一种**：`root.registry` 缺席 / `values()` 不是函数 /
 *     `values()` 抛错 / 真的一个都没登记 —— ⛔ 它们必须与"正常且为空"分开。
 *
 * ⇒ 返回值改成 `{ names, ok, why }`：
 *   · `ok === true`  ⇒ 取数面**真的读到了**（`values()` 正常返回，可能是空数组）；
 *   · `ok === false` ⇒ **取数面塌了**（`why` 给成因）⇒ 调用方必须落失败。
 */
function registryNames(root) {
  const names = []
  const reg = root?.registry
  if (reg === undefined || reg === null) {
    return { names, ok: false, why: '`root.registry` 缺席（拿不到登记表）' }
  }
  if (typeof reg.values !== 'function') {
    return { names, ok: false, why: '`root.registry.values` 不是函数（登记表形状变了）' }
  }
  try {
    for (const rt of reg.values()) names.push(rt.name)
  } catch (e) {
    return { names, ok: false, why: `\`registry.values()\` 抛错（${String(e?.message ?? e)}）` }
  }
  /**
   * ⚠ **读完却是空 ⇒ 也判"取数面塌了"**：本探针**必然**会登记至少一个模块
   *   （路径 A 就断言了 tools/bus/settings 被装载）⇒ 空表只可能是"没读到"，
   *   ⛔ 不是"确实什么都没有"。
   *   ⚠ 这一条是**关键**：不加它，`names` 为空时下面两条否定式仍然恒真。
   */
  if (names.length === 0) {
    return { names, ok: false, why: '`registry.values()` 读完**一条登记都没有**（本探针至少该有 3 条）' }
  }
  return { names, ok: true, why: '' }
}

console.log('=== 路径 A：配置开关（默认 modules.bus=true，自 M3 / UD-77 起）===')
{
  const { root } = await boot({})
  const r = registryNames(root)
  /**
   * ⚠⚠ **取数面塌了 ⇒ 两条否定式断言一律不许再判**（乙-1 要求 2）——
   *   改前它们只看 `!names.includes(...)`，`names === []` 时**恒真** ⇒ 假绿。
   *   ⚠ 现在**先判取数面**：不是"跳过"，是**落 FAIL**（`exit 1`）；
   *     ⛔ 不许落 `ok`、⛔ 不许让"塌了"与"确实没有"印成同一句。
   */
  if (!r.ok) {
    check(`默认配置：**取数面塌了** ⇒ 下面两条否定式断言一条都没跑（${r.why}）`, false)
  } else {
    const names = r.names
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
}

console.log('\n=== 路径 A2：开 bus 但关 tools（验证彼此独立）===')
{
  const { root } = await boot({ modules: { tools: false, bus: true, settings: true } })
  const r = registryNames(root)
  /** ⚠ 同路径 A：取数面塌了 ⇒ 这一组三条（含两条否定式）一条都不许判成通过。 */
  if (!r.ok) {
    check(`路径 A2：**取数面塌了** ⇒ 本组三条断言一条都没跑（${r.why}）`, false)
  } else {
    const names = r.names
    check('tools=false ⇒ tools 未被装载', !names.includes('dsh-hob-tools'), JSON.stringify(names))
    check('同一配置下 settings 仍被装载（互不影响）', names.includes('dsh-hob-settings'), JSON.stringify(names))
    check('同一配置下 bus 被装载', names.includes('dsh-hob-bus'), JSON.stringify(names))
  }
}

console.log('\n=== 路径 B：依赖门禁（缺服务 ⇒ 该模块 PENDING，整体照常）===')
{
  // 该根 context 没有任何宿主服务 ⇒ 有模块级 inject 的模块都该 PENDING，
  // 且**插件整体不报错**（boot() 没抛错就已经证明了后者）。
  /**
   * ⚠⚠ **这条原先恒真**（乙-1 要求 1）——原文是 `check('缺依赖时插件整体加载完成（未抛错）', true)`
   *   字面量 `true`。⚠ 它的本意是"boot() 没抛错"，而 `boot()` 若抛错，**上面那行 `await`
   *   就会把整个脚本打成堆栈** ⇒ 走到这里时"没抛错"**必然为真** ⇒ 判据**恒真、零分辨力**。
   *
   * ── 现在读什么（⛔ 不是"只打印"）──────────────────────────────────────
   *   它读 **`boot()` 之后这个根 context 的真实状态**：`boot()` 现在把 fiber 一起返回，
   *   而"整体加载完成"的可判形态 = **根 fiber 没有停在 PENDING/FAILED**（`state` 不是 0/3）**且**
   *   登记表**读得到**（`registryNames().ok`）。⚠ 这两条任一条不成立 ⇒ 插件整体没起来。
   *   ⚠ 失败时印什么：`root.state` / `registryNames` 的成因 —— 读的人据此知道是"没起来"
   *     还是"起来了但登记表读不到"（⛔ 两种原因不合并）。
   */
  const { root, fiber } = await boot({ modules: { tools: true, settings: true, bus: false } })
  const rB = registryNames(root)
  const rootState = (() => {
    const st = (fiber?.fibers ?? []).find((f) => f !== undefined && typeof f.state === 'number')
    return typeof fiber?.state === 'number' ? fiber.state : (typeof st?.state === 'number' ? st.state : undefined)
  })()
  /**
   * ⚠ `state` 语义（cordis）：`0 = PENDING` · `1 = LOADING` · `2 = ACTIVE` · `3 = FAILED`。
   *   ⚠ 判据 = **不是 0（仍在等依赖）也不是 3（加载失败）** ——
   *     注意这里**不能要求 `=== 2`**：插件的根 fiber 允许停在"已装好、有子模块在等"的状态，
   *     而本探针要证的是"**插件整体没有因为缺依赖而失败**"。
   * ⚠ `rootState === undefined` ⇒ **判不出** ⇒ 落失败（⛔ 不按通过处理 —— `E-112` 同族）。
   */
  const overallLoaded = rB.ok && rootState !== undefined && rootState !== 0 && rootState !== 3
  check(
    '缺依赖时插件整体加载完成（根 fiber 既没停在 PENDING、也没 FAILED，且登记表读得到）',
    overallLoaded,
    `root.state=${String(rootState)}（0=PENDING · 3=FAILED 均判失败）`
    + ` · registry=${rB.ok ? `读到 ${rB.names.length} 条` : `塌了（${rB.why}）`}`,
  )
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

  /**
   * ── ⑤ ⚠⚠ **恒绿判据订正**（2026-10-24 · t10 · B 席）══════════════════════════
   *
   * ── 改前是什么（审查席实测：**恒真**）──────────────────────────────────
   *   改前判据词是 `'settings 服务可用'`，而在 `src/` 与 `lib/` 里 `grep -rn` **零命中**
   *   —— 这个模块**从来不会**打这句话 ⇒ `!logs.some(...)` **恒为 true** ⇒ 本条**恒绿**。
   *   它守的命题（"缺依赖的 settings 模块确实没跑探测回调"）于是**完全没有被判**。
   *
   * ── 现在（⚠ 判据词换成模块**真的会打**的字符串）──────────────────────────
   *   `src/modules/settings.ts` 的 `runProbe()` 在四态里各打一句话，其中
   *   **可见**那一支打的是 `设置页可见：namespace=…`（实测输出见下"正控"）。
   *   ⇒ 判据 = 缺依赖时**没有**这一句（= 回调确实没跑）。
   *   ⚠ **必须有正控**：另起一个**给了 settings 服务**的同构场景，断言那**真的会出现**
   *     —— 否则"这句从不存在"和"回调没跑"两种情况读起来一样（又回到恒绿）。
   */
  const PROBE_MARK = '设置页可见：namespace='
  const noProbeRan = !logs.some((l) => String(l).includes(PROBE_MARK))
  /**
   * ⚠ **正控**：同一插件、同样配置，只把 settings 服务**提供出来** ⇒ 那一句必须出现。
   *   ⚠ 这同时证明 `settings` 模块的 `ctx.inject` 回调**确实会跑**（不是"它从不跑"）。
   */
  const posRoot = new Context()
  posRoot.provide?.('tools', {})
  posRoot.provide?.('settings', {
    describe: () => [{
      ns: 'dsh-hob', autoGenerate: true, revision: 3, schema: { dict: { probeField: {} } },
    }],
  })
  const posLogs = []
  posRoot.logger = {
    ...posRoot.logger,
    info: (...a) => posLogs.push(a.join(' ')), warn: (...a) => posLogs.push(a.join(' ')),
    error: () => {}, debug: () => {},
  }
  const posF = posRoot.plugin(mod, { modules: { tools: true, settings: true, bus: false } })
  await posF
  await sleep(80)
  const probeRan = posLogs.some((l) => String(l).includes(PROBE_MARK))
  check(
    `settings 服务缺席 ⇒ 其探测回调未执行（正控：有服务时**确实**打了「${PROBE_MARK}…」）`,
    noProbeRan && probeRan,
    `缺依赖时无该句=${noProbeRan} · 有依赖时该句${probeRan ? '出现' : '**未出现**（判据词或回调对不上）'}`,
  )
}

console.log(`\n  处级口径：查了 ${checked} 处 · 过了 ${checked - fail} 处`
  + ` · **跳过 ${skip.length} 处**（⚠ 跳过**不计入通过**）`)
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
