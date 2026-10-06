/**
 * host-probe —— 用**真产物** `lib/index.js` 跑 host 半边的手工探针。
 *
 * ⚠ **本脚本是手工运行的，不在任何自动检查路径上**
 *   —— 它**未**登记在 `package.json` 的 `scripts` 里，`npm run check:*` 与 CI 都不会跑到它。
 *   收尾四条命令（build / typecheck / check:presets / check:gitignore）的「全绿」**不覆盖本脚本**。
 *   改动 `src/index.ts` / `src/config.ts` 的配置面后，请**手动**跑一次：
 *
 *       node scripts/host-probe.mjs      # 期望退出码 0（全部 8 条 PASS）
 *
 * ⚠ **何时该跑**：`Config` 的 schema（尤其 `modules.*` 的形态）或 `apply()` 的模块登记行为变更时。
 *
 * ⚠ **为什么每条断言各自 try/catch**（E-27 教训）：
 *   本脚本曾因第 1 条 FAIL 后、第 2 条在**构造实参**时抛异常（`cfgDefault.persona?.get()` 在
 *   `undefined` 上取 `.get`；`?.` 只护变量、不护方法）而**整体中断** —— 8 条只跑到 1 条、
 *   后 7 条从未执行 ⇒ 观测器反而成了盲区。现在每条断言独立捕获：
 *   **任何一条失败都不得阻止后续各条运行**，且每条都**必须能失败**（E-27：不许恒真）。
 *
 * 断言口径的实测出处（2026-10-06 实测 `lib/index.js`，非推断）：
 *   · `Config(undefined).modules` === `{tools:{}, preset:{}, bus:false, settings:{}}`
 *     ⇒ `tools` / `preset` / `settings` 是 **volatile ref**（默认形态为 `{}`，须 `.get()` 取布尔）；
 *       **`bus` 是布尔 `false`，不是 ref** —— 对它调 `.get()` 会抛错（不要按 ref 断言）。
 *   · `Config(undefined)` 的顶层键**只有** `['modules']`。
 *   · 未知键（profile 旧配置段）被原样保留在**顶层**（`role` / `deliveryMode` …），不并入 `modules`。
 *   · 默认配置 `apply` ⇒ 登记 `dsh-hob-tools` + `dsh-hob-settings`，日志含「模块：tools, settings」。
 *   · `modules:{tools:false}` ⇒ 只登记 `dsh-hob-settings`，日志含「模块：settings」。
 *   · 四开关全关 ⇒ 登记 0 个，日志含「模块：无」。
 */
const mod = await import('/home/lk/FF/dsh-hob/lib/index.js')

let fail = 0
/**
 * 跑一条断言。`fn` 返回 `true` 表示通过；返回**字符串**表示失败并附原因；
 * 抛异常也算失败（附异常信息）。**任何情况都不中断后续断言。**
 */
function check(name, fn) {
  let ok = false
  let extra = ''
  try {
    const r = fn()
    if (r === true) {
      ok = true
    } else if (r === false || r === undefined) {
      ok = false
      extra = '返回非 true（断言未给出原因）'
    } else {
      ok = false
      extra = String(r)
    }
  } catch (e) {
    ok = false
    extra = '抛异常：' + String(e?.message ?? e)
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
  if (!ok) fail++
}

/** 造一份最小 fakeCtx（与 module-independence-probe.mjs 同款），返回登记到的插件名与 info 日志。 */
function fakeCtx() {
  const plugins = []
  const logs = []
  const ctx = {
    logger: { info: (m) => logs.push(String(m)), debug: () => {}, warn: () => {} },
    plugin: (p) => { plugins.push(p.name ?? '(anon)'); return { then() {} } },
    effect: (fn) => { const d = fn(); return { dispose: () => d?.() } },
  }
  return { ctx, plugins, logs }
}

/** 实测的默认 modules 形状（四处引用，收口成常量）。 */
const DEFAULT_MODULES_JSON = '{"tools":{},"preset":{},"bus":false,"settings":{}}'

// ── 1) 默认配置：modules 的形状 ────────────────────────────────────────
check('schema 校验：undefined → modules 形状 = {tools:{}, preset:{}, bus:false, settings:{}}', () => {
  const got = JSON.stringify(mod.Config(undefined).modules)
  return got === DEFAULT_MODULES_JSON ? true : `got=${got} want=${DEFAULT_MODULES_JSON}`
})

// ── 2) 三个开关是 volatile ref（须 .get()），默认值实测 ──────────────────
check('schema 校验：tools / preset / settings 是 volatile ref（{} 且 .get() 返回布尔）', () => {
  const c = mod.Config(undefined)
  const shape = {}
  for (const k of ['tools', 'preset', 'settings']) {
    const v = c.modules[k]
    const isRef = v !== null && typeof v === 'object' && typeof v.get === 'function'
    shape[k] = `${isRef ? 'ref' : 'NOT-ref'}:${isRef ? JSON.stringify(v.get()) : '?'}`
  }
  // 实测默认值：tools=true, preset=false, settings=true（volatile ⇒ 取 .get() 才是真值）
  const ok = c.modules.tools.get() === true && c.modules.preset.get() === false && c.modules.settings.get() === true
  return ok ? true : `形状/默认值不符：${JSON.stringify(shape)}`
})

// ── 3) bus 是布尔，不是 ref（纠正"volatile 一律 ref"的误记）────────────
check('schema 校验：bus 是布尔 false（**不是** ref；无 .get）', () => {
  const v = mod.Config(undefined).modules.bus
  if (typeof v !== 'boolean') return `bus 不是布尔：typeof=${typeof v} value=${JSON.stringify(v)}`
  if (v !== false) return `bus 默认值变了：${JSON.stringify(v)}`
  if (typeof v?.get === 'function') return 'bus 竟带有 .get（与实测相反）'
  return true
})

// ── 4) 未知键原样保留在顶层；modules 形状不受污染 ───────────────────────
check('schema 兼容：未知键（profile 旧配置段）不导致校验失败且原样保留在顶层', () => {
  const c = mod.Config({ role: 'execution', deliveryMode: 'execute', autoSend: false, workspaceRoot: '' })
  if (!(c.role === 'execution' && c.deliveryMode === 'execute' && c.autoSend === false && c.workspaceRoot === ''))
    return `未知键未原样保留：${JSON.stringify({ role: c.role, deliveryMode: c.deliveryMode, autoSend: c.autoSend, workspaceRoot: c.workspaceRoot })}`
  const got = JSON.stringify(c.modules)
  if (got !== DEFAULT_MODULES_JSON) return `modules 被污染：${got}`
  return true
})

// ── 5) apply 默认配置：登记 tools + settings（且不抛错）────────────────
check('apply：默认配置 ⇒ 登记 tools + settings，日志含「模块：tools, settings」', () => {
  const { ctx, plugins, logs } = fakeCtx()
  mod.apply(ctx, mod.Config(undefined))
  const namesOk = plugins.length === 2 && plugins[0] === 'dsh-hob-tools' && plugins[1] === 'dsh-hob-settings'
  if (!namesOk) return `plugins=${JSON.stringify(plugins)}`
  if (!logs.some((m) => m.includes('模块：tools, settings'))) return `logs=${JSON.stringify(logs)}`
  return true
})

// ── 6) 模块可独立启停：tools=false ⇒ 只剩 settings ──────────────────────
check('apply：modules.tools=false ⇒ 只登记 settings（模块可独立启停）', () => {
  const { ctx, plugins, logs } = fakeCtx()
  mod.apply(ctx, mod.Config({ modules: { tools: false } }))
  if (!(plugins.length === 1 && plugins[0] === 'dsh-hob-settings')) return `plugins=${JSON.stringify(plugins)}`
  if (!logs.some((m) => m.includes('模块：settings'))) return `logs=${JSON.stringify(logs)}`
  return true
})

// ── 7) 四开关全关 ⇒ 不登记任何模块 ─────────────────────────────────────
check('apply：四个开关全关 ⇒ 不登记任何子模块（日志「模块：无」）', () => {
  const { ctx, plugins, logs } = fakeCtx()
  mod.apply(ctx, mod.Config({ modules: { tools: false, preset: false, bus: false, settings: false } }))
  if (plugins.length !== 0) return `仍登记了=${JSON.stringify(plugins)}`
  if (!logs.some((m) => m.includes('模块：无'))) return `logs=${JSON.stringify(logs)}`
  return true
})

// ── 8) name 常量（entry id / 路由前缀 / settings ns 三契约）─────────────
check('name 常量 = dsh-hob（entry id / 路由前缀 / settings ns 三契约）', () => {
  return mod.name === 'dsh-hob' ? true : `name=${JSON.stringify(mod.name)}`
})

console.log(fail === 0 ? '\nALL PASS（8 条）' : `\n${fail} FAILED（共 8 条）`)
process.exit(fail === 0 ? 0 : 1)
