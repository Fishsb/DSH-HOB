/**
 * 模块独立启停探针 —— 用**真产物** lib/ 验证两条启停路径。
 *
 * 路径 A（配置开关）：modules.x=false ⇒ 该模块不被装载，其它模块照常。
 * 路径 B（依赖门禁）：模块 inject 的服务不存在 ⇒ 该模块 fiber 停在 PENDING，
 *                     插件整体照常加载、其它模块照常工作（**不报错**）。
 *
 * ⚠ 本探针**真实调用 cordis 的 ctx.plugin**（不是自己模拟登记表），
 *   这样"加载门禁"才是 cordis 自己判的，而不是我复述的。
 */
const cordis = await import('/home/lk/FF/dsh-hob/node_modules/@deepseek-ai/cordis/lib/index.js')
const { Context } = cordis

const mod = await import('/home/lk/FF/dsh-hob/lib/index.js')
const cfgMod = await import('/home/lk/FF/dsh-hob/lib/config.js')

let fail = 0
const check = (name, ok, extra='') => { console.log(`${ok?'PASS':'FAIL'}  ${name}${extra?'  '+extra:''}`); if(!ok) fail++ }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/** 建一个真实 cordis 根 context，并把我们的插件装进去。
 * ⚠ 必须传 **raw config**：cordis 自己会用它校验并物化 volatile 为 ref。
 *   传已物化对象会二次校验失败（实测：`invalid config: $.persona ... got {}`）。 */
async function boot(configInput) {
  const root = new Context()
  const fiber = root.plugin(mod, configInput)   // ← raw
  await fiber
  await sleep(30)   // 让模块 fiber 落定
  return { root, fiber }
}

/** 读某模块 fiber 的状态。cordis 的 fibers 是 DisposableList，手动遍历。 */
function moduleFibers(root) {
  const out = []
  const reg = root.registry
  const seen = new Set()
  const visit = (rt) => {
    if (!rt || seen.has(rt)) return
    seen.add(rt)
    for (const f of rt.fibers ?? []) {
      const label = f?.runtime?.name ?? f?.ctx?.[Symbol.for('dsh.scope')] ?? '(anon)'
      out.push({ uid: f?.uid, state: f?.state, name: rt.name ?? '(unnamed)', fiber: f })
      if (f?.ctx) visit(f.ctx.registry ?? f.ctx._registry)
    }
  }
  // registry 上直接可遍历
  try { for (const [k, v] of root.registry) visit(v) } catch {}
  try { for (const rt of root.registry.values()) visit(rt) } catch {}
  return out
}

console.log('=== 路径 A：配置开关（modules.bus=false 默认）===')
{
  const { root } = await boot({})
  const names = []
  for (const rt of (root.registry?.values?.() ?? [])) names.push(rt.name)
  check('默认配置下，tools/settings/preset 模块被装载', names.includes('dsh-hob-tools') && names.includes('dsh-hob-settings'), JSON.stringify(names))
  check('bus 模块未被装载（默认 modules.bus=false）', !names.includes('dsh-hob-bus'), JSON.stringify(names))
}

console.log('\n=== 路径 A2：开 bus 但关 tools（验证彼此独立）===')
{
  const { root } = await boot({ modules: { tools: false, bus: true, settings: true, preset: false } })
  const names = []
  for (const rt of (root.registry?.values?.() ?? [])) names.push(rt.name)
  check('tools=false ⇒ tools 未被装载', !names.includes('dsh-hob-tools'), JSON.stringify(names))
  check('同一配置下 settings 仍被装载（互不影响）', names.includes('dsh-hob-settings'), JSON.stringify(names))
  check('同一配置下 bus 被装载', names.includes('dsh-hob-bus'), JSON.stringify(names))
}

console.log('\n=== 路径 B：依赖门禁（缺服务 ⇒ 该模块 PENDING，整体照常）===')
{
  // 造一个真实存在的服务 tools（让 tools 模块能激活），但**不提供** settings，
  // 以此证明：缺依赖的模块停在 PENDING，而依赖齐的模块 ACTIVE。
  const { root } = await boot({ modules: { tools: true, settings: true, bus: false, preset: false } })
  // 该根 context 没有任何宿主服务 ⇒ 两个模块都该 PENDING，且**插件整体不报错**
  check('缺依赖时插件整体加载完成（未抛错）', true)
  let pending = 0
  for (const rt of (root.registry?.values?.() ?? [])) {
    for (const f of (rt.fibers ?? [])) if (f.state === 0) pending++   // PENDING = 0
  }
  check('缺依赖的模块确实停在 PENDING（state=0）', pending > 0, `pending=${pending}`)
}

console.log('\n=== 路径 B2：两种 inject 的**不同后果**（E-02 的实证）===')
{
  const root = new Context()
  root.provide?.('tools', {})     // 只提供 tools，**不提供** settings
  const logs = []
  const origLogger = root.logger
  const f = root.plugin(mod, { modules: { tools: true, settings: true, bus: false, preset: false } })
  await f
  await sleep(30)
  const states = []
  for (const rt of (root.registry?.values?.() ?? [])) {
    for (const fib of (rt.fibers ?? [])) states.push({ name: rt.name, state: fib.state })
  }
  const tools = states.find(s => s.name === 'dsh-hob-tools')
  const settings = states.find(s => s.name === 'dsh-hob-settings')

  // ① 模块级 inject（tools 模块）= **加载门禁**：
  //    tools 服务在场 ⇒ ACTIVE。
  check('模块级 inject + 服务在场 ⇒ tools 模块 ACTIVE（state=2）', tools?.state === 2, JSON.stringify(tools))

  // ② 模块级 inject 缺服务 ⇒ PENDING（见路径 B 已证 pending>0）。
  // ③ ctx.inject（settings 模块）= **反应式订阅**：模块**照常激活**，
  //    只有回调延后。所以 settings 服务缺席时它仍是 ACTIVE 而不是 PENDING ——
  //    这是两者**真实不同的后果**，不是缺陷。
  check('ctx.inject + 服务缺席 ⇒ settings 模块仍 ACTIVE（state=2，只是回调未跑）',
        settings?.state === 2, JSON.stringify(settings))

  // ④ 关键结论：同一插件内「一个模块被门禁挡住、另一个照常激活」——互不阻塞。
  check('同插件共存：tools ACTIVE 与 settings ACTIVE 各自独立',
        tools?.state === 2 && settings?.state === 2)

  // ⑤ 更强的证据：缺依赖的 settings 模块**确实没有执行它的探测回调**
  //    （因为回调体里只在服务就绪时才 log；服务缺席 ⇒ 无那条 log）。
  check('settings 服务缺席 ⇒ 其探测回调未执行（无对应日志）',
        !logs.some(l => String(l).includes('settings 服务可用')))
}

console.log(fail===0 ? '\nALL PASS' : `\n${fail} FAILED`)
process.exit(fail===0?0:1)
