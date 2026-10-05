// 用**真产物** lib/index.js 跑 host 半边：验证 apply 不抛错、模块登记、schema 校验。
const mod = await import('/home/lk/FF/dsh-hob/lib/index.js')
const log = []
const plugins = []
const fakeCtx = {
  logger: { info: (m) => log.push(['info', m]), debug: (m) => log.push(['debug', m]), warn: (m) => log.push(['warn', m]) },
  plugin: (p) => { plugins.push(p.name ?? '(anon)'); return { then(){} } },
  effect: (fn) => { const d = fn(); return { dispose: () => d?.() } },
}
let fail = 0
const check = (name, ok, extra='') => { console.log(`${ok?'PASS':'FAIL'}  ${name}${extra?'  '+extra:''}`); if(!ok) fail++ }

// 1) 默认配置（无 config）
const cfgDefault = mod.Config(undefined)
check('schema 校验：undefined → 默认值', cfgDefault.modules.tools===true && cfgDefault.modules.preset===false, JSON.stringify(cfgDefault.modules))
check('schema 校验：persona 是 ref（volatile 生效）', typeof cfgDefault.persona?.get==='function', 'get()='+cfgDefault.persona.get())

// 2) 模拟线上 profile 覆盖（未知键）
const cfgLive = mod.Config({ role:'execution', deliveryMode:'execute', autoSend:false, workspaceRoot:'' })
check('schema 兼容：profile 旧配置段（未知键）不导致校验失败', cfgLive.modules.tools===true)
check('未知键被原样保留（不丢用户配置）', cfgLive.role==='execution')

// 3) apply 在默认配置下运行
try { mod.apply(fakeCtx, cfgDefault); check('apply() 执行不抛错', true) }
catch(e){ check('apply() 执行不抛错', false, String(e.message)) }
check('模块登记：默认配置 → tools + settings 两个', plugins.length===2, JSON.stringify(plugins))
check('入口日志如实反映模块数', log.some(([t,m])=>t==='info' && /模块：tools, settings/.test(m)), JSON.stringify(log.filter(([t])=>t==='info')))

// 4) 关掉 tools 模块 ⇒ 只登记 settings（模块可独立启停）
plugins.length = 0
const cfgOff = mod.Config({ modules:{ tools:false } })
mod.apply(fakeCtx, cfgOff)
check('模块可独立启停：tools=false → 只登记 settings', plugins.length===1 && plugins[0]==='dsh-hob-settings', JSON.stringify(plugins))

// 5) name 常量
check('name 常量 = dsh-hob（entry id/路由前缀/settings ns 三契约）', mod.name==='dsh-hob')

console.log(fail===0 ? '\nALL PASS' : `\n${fail} FAILED`)
process.exit(fail===0?0:1)
