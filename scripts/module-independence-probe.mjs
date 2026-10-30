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
 *   · 默认 `modules` 开关（解 ref）=== `{tools:true, bus:true, orch:false, settings:true}`
 *     ⚠ 2026-10-24：自研跨实例投递退场 ⇒ 少了那一格
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

/**
 * **负向对拍（N-MOD · 2026-10-30 P7）**：`registryNames` 必须把**取数面塌了**与
 * ⚠ 先自证夹具坏掉：5 种坏 root 逐个断言 `ok === false && why !== ''`，再拿好 root 做反向对照。
 * 「正常且为空」分开 —— 否则 `ok=false` 的三种成因会被静默当成"没有模块"。
 * ⚠ 本族此前 0 条负向对拍（M-1 实测）。成对：坏 root ⇒ `ok=false`；好 root ⇒ `ok=true`。
 */
{
  const bads = [
    ['root 缺席', undefined],
    ['registry 不是对象', {}],
    ['values 不是函数', { registry: { values: 1 } }],
    ['values 抛错', { registry: { values: () => { throw new Error('boom') } } }],
    ['读完为空', { registry: { values: () => [] } }],
  ]
  const badResults = bads.map(([label, r]) => [label, registryNames(r)])
  const allBad = badResults.every(([, x]) => x.ok === false && x.why !== '')
  const good = registryNames({ registry: { values: () => [{ name: 'tools' }] } })
  const reallyBites = good.ok === true && good.names.length === 1
  if (!allBad) {
    const leaked = badResults.filter(([, x]) => x.ok !== false).map(([l]) => l)
    check('N-MOD · 负向对拍**没咬住**', false, `这些坏 root 被当成"正常"了：${leaked.join(' / ')}`)
  } else if (!reallyBites) {
    check('N-MOD · 反向对照失败', false, `好 root 却报 ok=${good.ok} names=${JSON.stringify(good.names)}（判据过咬）`)
  } else {
    check('N-MOD ✓ 负向对拍（5 种坏 root：缺席 / 非对象 / values 非函数 / values 抛错 / 读完为空）⇒ **全部 ok=false 且给了成因**；好 root ⇒ ok=true（成对）', true)
  }
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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 路径 C：「没起」的两种成因必须在**生产日志通道**上分得开（2026-10-25 · 本单）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── 这一组守的是什么（作业书 §一-1 那个洞）──────────────────────────────
 *   四个模块**全关**时印「模块：无」；四个模块**都打开但都挂了**时——**也**印「模块：无」。
 *   而本该区分两者的那句 warn，在**生产日志通道里结构性看不见**：
 *   `Logger._method` 的过滤是
 *   `(exporter.levels?.[name] ?? exporter.levels?.default ?? this.level ?? 1) < level ⇒ continue`
 *   （`cordis/lib/index.js:474`），内存 buffer / 文件 exporter **都不配 `levels`** ⇒ 阈值落回 `1`，
 *   而 `warn` 的 level 是 **2** ⇒ **永远被滤掉**（真机实测：111 条里 warn 一条没有）。
 *   ⇒ 于是"四个都挂了"在日志上与"四个都关了"**长得一模一样** ⇒ "让失败不可观测"。
 *
 * ── 为什么必须用**生产日志通道**来测（⛔ 不许用假 logger 糊过去）──
 *   本探针前面几组用的是手搓 `logger.info = (...) => logs.push(...)`，那**根本不过滤**，
 *   所以 warn 也会被收进 `logs` ⇒ **在这个夹具上，改前的缺陷根本复现不出来**
 *   （旧的 warn 照样能被看见）。⇒ 本组必须挂一个**与生产同构的 exporter**：
 *   `ctx.logger.exporter({ colors, export })`（⚠ **不配 `levels`**，与宿主一致）。
 *   ⚠ 这是本组与前面几组**刻意不同**的地方，不是风格不一致。
 *
 * ── 三条断言（各自都有负向对拍，⛔ 不许只判"有那行"）────────────────────
 *   ① 四都在 ⇒ 那一行**一个字都不许多打**（判"没有任何『没启动』行"，⛔ 只判长度不够）；
 *   ② 全关 ⇒ 成因写的是**配置**（且**⛔ 不许**出现"环境"/"没起来"这种归因于故障的说法）；
 *   ③ 全挂 ⇒ 成因写的是**环境**（且**⛔ 不许**出现"配置所致"）；
 *   ⚠ ② 与 ③ 还要求**两段原文不同** —— 这是本组的靶心（作业书 §一-3 末句）。
 */
console.log('\n=== 路径 C：「没起」的两种成因在生产日志通道上必须分得开 ===')
{
  /** 挂一个与宿主同构的 exporter（⚠ 不配 levels ⇒ 与生产通道同阈值）。 */
  const withProdChannel = (root) => {
    const buf = []
    root.logger.exporter({ colors: 3, export: (m) => buf.push(m) })
    return buf
  }
  const visible = (buf) => buf.filter((m) => m.type === 'info' || m.type === 'error')
    .map((m) => (m.args || []).map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  /** 那行"没启动"的判据词（⚠ 与实现里的字面量一致；改实现必须同批改这里，见注释）。 */
  const MARK = '模块未启动'
  const notStartedLines = (buf) => visible(buf).filter((l) => l.startsWith('[dsh-hob]') && l.includes(MARK))

  // ① 四都在 ⇒ 一个字都不许多打
  const r1 = new Context()
  r1.provide?.('tools', {}); r1.provide?.('settings', { describe: () => [] })
  r1.provide?.('sessions', {}); r1.provide?.('agents', {}); r1.provide?.('connection', {})
  const b1 = withProdChannel(r1)
  const f1 = r1.plugin(mod, { modules: { tools: true, bus: true, orch: true, settings: true } })
  await f1
  await sleep(80)
  const loadLines1 = visible(b1).filter((l) => l.includes('已加载（模块'))
  check(
    '四都在 ⇒ **只印"已加载"那一行**，⛔ 一条"没启动"都不多打',
    notStartedLines(b1).length === 0 && loadLines1.length === 1,
    `没启动行=${notStartedLines(b1).length}（期望 0）· 已加载行=${loadLines1.length}（期望 1）`,
  )

  // ② 全关 ⇒ 成因 = 配置；③ 全挂 ⇒ 成因 = 环境
  /** 造"全都打开了但都没起来"：把四个模块的静态 inject 指向不存在的服务（只改门禁，不改日志）。 */
  const allDeadLines = await (async () => {
    // ⚠ 用临时目录 + 符号链接回 node_modules：ESM 按真实路径解析依赖，
    //   而**仓库内建临时目录会污染 `git status`**（本仓有硬规定，见 check:gitignore）。
    const { mkdtempSync, writeFileSync, symlinkSync, readFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const tmp = mkdtempSync(join(tmpdir(), 'hob-probe-dead-'))
    try {
      // 逐个文件复制到临时根（⚠ 只复制一层 + modules 子目录：本探针只用到这两层）
      const { cpSync } = await import('node:fs')
      cpSync(LIB_ROOT, tmp, { recursive: true })
      writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'hob-probe-dead', type: 'module' }))
      /**
       * ⚠ **只在副本里没有 `node_modules` 时才链接**：`LIB_ROOT` 若被 `HOB_PROBE_LIB`
       *   指向一份**自带 node_modules 符号链接**的对比副本（负向对拍就是这么用的），
       *   `cpSync` 会连那个链接一起搬过来 ⇒ 再建一次就 `EEXIST`。
       *   ⛔ 不 `try/catch` 吞掉：那会把"链接真的失败"也变静默。
       */
      if (!existsSync(join(tmp, 'node_modules'))) {
        symlinkSync(resolve(ROOT, 'node_modules'), join(tmp, 'node_modules'), 'dir')
      }
      for (const file of ['tools.js', 'bus.js', 'orchestrator.js', 'settings.js']) {
        const fp = join(tmp, 'modules', file)
        const src = readFileSync(fp, 'utf8')
        const patched = /^export const inject = \[[^\]]*\];?$/m.test(src)
          ? src.replace(/^export const inject = \[[^\]]*\];?$/m, "export const inject = ['__probe_no_such_service__'];")
          : `export const inject = ['__probe_no_such_service__'];\n${src}`
        writeFileSync(fp, patched)
      }
      const deadMod = await import(pathToFileURL(join(tmp, 'index.js')).href)
      const r = new Context()
      r.provide?.('tools', {}); r.provide?.('settings', { describe: () => [] })
      r.provide?.('sessions', {}); r.provide?.('agents', {}); r.provide?.('connection', {})
      const b = withProdChannel(r)
      const f = r.plugin(deadMod, { modules: { tools: true, bus: true, orch: true, settings: true } })
      await f
      await sleep(120)
      return { lines: notStartedLines(b), fiberStates: (() => {
        const out = []
        for (const rt of (r.registry?.values?.() ?? [])) for (const x of (rt.fibers ?? [])) {
          if (String(x.name).startsWith('dsh-hob-')) out.push({ name: String(x.name), state: x.state })
        }
        return out
      })() }
    } finally { rmSync(tmp, { recursive: true, force: true }) }
  })()

  // 全关（配置成因）
  const r2 = new Context()
  r2.provide?.('tools', {}); r2.provide?.('settings', { describe: () => [] })
  r2.provide?.('sessions', {}); r2.provide?.('agents', {}); r2.provide?.('connection', {})
  const b2 = withProdChannel(r2)
  const f2 = r2.plugin(mod, { modules: { tools: false, bus: false, orch: false, settings: false } })
  await f2
  await sleep(80)
  const offLines = notStartedLines(b2)
  const deadLines = allDeadLines.lines

  check(
    '全关（成因=配置）⇒ 印一行"没启动"，且**说清是配置所致**（⛔ 不许归因于环境故障）',
    offLines.length === 1 && offLines[0].includes('关掉') && !/环境不满足|没起来/.test(offLines[0]),
    `行数=${offLines.length} · 原文=${JSON.stringify(offLines)}`,
  )
  check(
    '全挂（成因=环境）⇒ 印一行"没启动"，且**说清是环境所致**（⛔ 不许说成"配置所致"）',
    deadLines.length === 1 && deadLines[0].includes('没起来') && !deadLines[0].includes('这是配置所致'),
    `行数=${deadLines.length} · 模块 fiber=${JSON.stringify(allDeadLines.fiberStates)} · 原文=${JSON.stringify(deadLines)}`,
  )
  /**
   * ⚠⚠ **本组的靶心**：两段原文**必须不一样**。
   *   改前它们**都不存在**（都只有「模块：无」+ 被滤掉的 warn）⇒ 这一条在改前是 FAIL，
   *   而且 FAIL 的方式正好是"两段都是空" —— ⛔ 不是"要求它们不同"这种弱判据。
   */
  check(
    '**靶心**：全关那段 与 全挂那段 **原文不同**，且各自能看懂（这是本单要治的那条）',
    offLines.length === 1 && deadLines.length === 1 && offLines[0] !== deadLines[0],
    `different=${offLines[0] !== deadLines[0]}`,
  )
}

console.log(`\n  处级口径：查了 ${checked} 处 · 过了 ${checked - fail} 处`
  + ` · **跳过 ${skip.length} 处**（⚠ 跳过**不计入通过**）`)
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
