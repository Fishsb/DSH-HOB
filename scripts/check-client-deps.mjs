#!/usr/bin/env node
/**
 * client 半边「宿主服务取用」静态核对 —— 钉住**第 3 轮那个真实故障**的形态，防复发。
 *
 * ══ 它防的是什么（现象 · 根因 · 后果）════════════════════════════════════════
 *   **现象**：设置面板「新建会话默认」卡片里，「候选来源」一行是红字
 *   `cannot get property "remote.agentPresets" without inject`，两个下拉都选不了。
 *
 *   **根因**：`src/client/catalog.ts` 先 `ctx.get('remote')`（这一步**免 inject**，正常），
 *   随后对拿到的服务做**属性访问** `remote.agentPresets` / `remote.session`。
 *   而 `src/client/index.ts` 的**模块级** `export const inject = ['slots']` 未声明这两个
 *   命名空间 ⇒ cordis 的 reflect **get 陷阱**抛错
 *   （`@deepseek-ai/cordis/src/reflect.ts:144` 造错、`:163` 抛出；`lib/index.js:676` / `:691`）。
 *
 *   **为什么不是"宿主没数据"**：第 2 轮读数（5 预设 / 3 组 6 模型）证明的是**宿主侧有数据**，
 *   **不证明面板能取到** —— 两条不是一回事。而**重启也不会有用**：门禁是**声明**问题。
 *
 *   **为什么机检能防住**：这类缺陷**在类型层面完全合法**（`any` 上没有约束）、
 *   在构建层面**静默通过**（tsdown 照常出产物）、在运行时**只表现为红字**。
 *   能抓住它的只有"读代码看有没有**属性访问**"这一层 —— 正是本脚本。
 *
 * ══ 断言口径（**不许静默放宽** —— 改本文件前先读完这一节）══════════════════
 *
 *   **A（核心 · 零命中）** client 代码里**不得出现**对 Remote 命名空间的属性访问：
 *      · `ctx.remote`（任何形态）—— 它是「先拿 remote 再点命名空间」的入口；
 *      · `.agentPresets` / `.session` 这类**紧跟表达式**（非字符串字面量）的属性访问。
 *      判据 = 剥离注释/字符串后，命中数 **0**。
 *      ⚠ 为什么只扫描**代码**（剥离后）：注释里**必须允许**出现这些字（本仓的注释
 *        正是靠写清"不许这么写"来防复发的）。故剥离器本身要有牙 —— 见 §自检。
 *
 *   **B（正向 · 必须走免 inject 读法）** 两个命名空间只能经 `ctx.get(<常量>)` 取：
 *      · `catalog.ts` 必须有 `serviceOf(` 定义，且体内用 `get(`（免 inject 读法）；
 *      · 两个命名空间的**逐字名字**必须收在两个常量里，且值与宿主实际注册名一致。
 *
 *   **C（逐字名锚定）** 常量值必须**恰好**是 `remote.agentPresets` / `remote.session`。
 *      出处（**读出来的，不是猜的**）：
 *        `@deepseek-ai/dsh-api-gateway/lib/client.js:2040-2042`
 *          `function remoteServiceKey(namespace) { return \`remote.${namespace}\` }`
 *        `:1743` `createNamespace()` → `ownerCtx.plugin({ name: remoteServiceKey(name), … })`
 *        `@deepseek-ai/dsh-api-remotes/lib/client.js:4631`（`namespace: "agentPresets"`）
 *        `:11475`（`session/modelCatalog` 描述符，`namespace: "session"`）
 *
 *   **D（禁止的修法）** `index.ts` 的**模块级** `export const inject` 里
 *      **不得**出现 `remote.*` —— 那是**加载门禁**：命名空间缺席时**整个 client 插件
 *      不激活** ⇒ 设置分区**整体消失**，属回归（E-02 / E-41 实测对照）。
 *      同时**必须**仍声明 `slots`（`apply` 里访问 `ctx.slots` 是硬依赖）。
 *
 *   **E（Fiber 用法）** `ctx.inject(...)` 的返回值是 **Fiber 对象**，**不可调用**：
 *      清理必须写 `.dispose?.()`。写成 `off?.()` / `off()` ⇒ FAIL
 *      （实测：`typeof off === 'object'`、`off.constructor.name === 'Fiber'`；
 *       该清理函数挂在 `ctx.effect` 上 ⇒ 卸载/**热重载**时必被调用 ⇒ 每次都抛，
 *       且因发生在卸载期而不易被发现）。
 *
 *   **F（不得静默当空清单）** 命名空间未就绪时**必须**如实把状态置为 `error`
 *      （用户看到红字 + 可点「重新读取」），**不许**默默当空列表 ——
 *      后者会让"加载失败"看起来像"宿主里一个预设都没有"。
 *
 *   **G（重试必须真的能重发）** `inflight` 的复位**不得**写在 async IIFE 体内。
 *      **实测陷阱（本轮真踩到）**：`async` 箭头函数体会**同步**执行到第一个 `await`；
 *      "命名空间缺席"分支在**任何 await 之前**就 return ⇒ 体内 `finally { inflight = null }`
 *      **先**跑，随后 `inflight = (async () => …)()` 的赋值**后**执行、把 `null` 覆盖成
 *      那个已完成的 promise ⇒ `inflight` **永久非 null** ⇒ 用户点「重新读取」**毫无反应**，
 *      命名空间到齐后的自动补读也一起失效（而 `status` 还停在 error，像"重试没生效"）。
 *      判据：`loadCatalog` 体内不得出现 `finally` 形式复位；必须有**守卫式**复位
 *      （`if (inflight === run) inflight = null`）。
 *
 *   **H（`configForms` 是正例，不得被误伤）** `settings.ts` 经
 *      `ctx.inject(['configForms'], cb)` **已声明**依赖 ⇒ **不在** A 的禁止之列。
 *      本脚本须证明"已声明"这条路径**认得出**（否则 A 就成了"凡 ctx.X 一律禁"的错误口径）。
 *      判据：`configForms` 必须出现在某条 `ctx.inject([...])` 里。
 *
 *   ⚠ **每条断言都必须能失败**（E-27：恒真的检查比没有更危险）。
 *      交付时逐条做过负向对拍：见本脚本 §自检 与回报中的原始读数。
 *
 * ══ 与既有脚本的关系（**不得互相影响**）════════════════════════════════════
 *   **只读** `src/client/**` 与 `node_modules/@deepseek-ai/cordis`（后者只用于取
 *   "哪些 ctx 成员本来就免 inject"的**基准**），**不写**任何文件（含"自动修好"）。
 *   与 `check:config`（配置面）、`check:presets`（预设契约）、`check:gitignore`
 *   （入库规则）互不覆盖。
 *
 * 用法：node scripts/check-client-deps.mjs      （或 npm run check:client）
 * 退出码：0 = 全通过；1 = 有违规（逐条打印）
 * ⚠ 零第三方依赖（本仓纪律）：注释/字符串剥离是**逐字符状态机**，不是正则 ——
 *   用正则处理字符串本身就是 E-27 那类"假通过"的温床。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const CLIENT_DIR = join(root, 'src', 'client')
const CORDIS_DIR = join(root, 'node_modules', '@deepseek-ai', 'cordis')
const INDEX_TS = join(CLIENT_DIR, 'index.ts')
const CATALOG_TS = join(CLIENT_DIR, 'catalog.ts')
const SETTINGS_TS = join(CLIENT_DIR, 'settings.ts')

const fail = []
const note = []
const bad = (m) => fail.push(m)
const ok = (m) => note.push(m)

function readOr(path, label) {
  try {
    return readFileSync(path, 'utf8')
  } catch (e) {
    bad(`读不到 ${label}（${path}）：${String(e?.message ?? e)} —— 基准缺失 ⇒ 不按通过处理`)
    return ''
  }
}

// ══════════════════════════════════════════════════════════════════════════
// §1 逐字符剥离器：注释 + 字符串 + 模板串 ⇒ 只留**可执行代码**
// ══════════════════════════════════════════════════════════════════════════
/**
 * 把 TS/TSX 源码里的注释与字符串字面量替换成**等长空格**（保留行列位置便于报行号）。
 *
 * ⚠ **为什么必须逐字符**：`remote.agentPresets` 这个串在本仓的**注释里刻意存在**
 *   （写"不许这么写"就是防复发的手段）。若用正则粗剥，要么误伤注释、要么漏掉
 *   字符串里的真实访问 —— 两个方向都会让断言失真。
 *
 * ⚠ 已知边界（**如实声明，不假装完备**）：正则字面量 `/…/` 不单独识别，
 *   按除法运算符处理。本仓 `src/client/**` 现有代码不含正则字面量；
 *   若将来引入，需在此处补一条状态（脚本会在下方 §自检里对
 *   "剥离是否生效"持续自证，但**不**能证明正则字面量这一条）。
 *
 * @param src - 源码全文。
 * @returns 与 src **等长**的、注释与字符串均被空格覆盖的串。
 */
function stripCommentsAndStrings(src) {
  const out = Array.from(src)
  const n = src.length
  let i = 0
  /** 把 [from, to) 区间覆盖成空格（换行保留，避免报错行号漂移）。 */
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' '
  }
  while (i < n) {
    const c = src[i]
    const c2 = src[i + 1]
    // 行注释
    if (c === '/' && c2 === '/') {
      let j = i + 2
      while (j < n && src[j] !== '\n') j++
      blank(i, j)
      i = j
      continue
    }
    // 块注释
    if (c === '/' && c2 === '*') {
      let j = i + 2
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++
      j = Math.min(j + 2, n)
      blank(i, j)
      i = j
      continue
    }
    // 字符串 '…' / "…"
    if (c === "'" || c === '"') {
      let j = i + 1
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === c) { j++; break }
        if (src[j] === '\n') break // 未闭合：不越过行，避免整份文件被吃掉
        j++
      }
      blank(i, j)
      i = j
      continue
    }
    // 模板串 `…`（含 ${ } 嵌套：按花括号深度跳过，${} **内部仍是代码**⇒只剥字面部分）
    if (c === '`') {
      blank(i, i + 1)
      let j = i + 1
      while (j < n) {
        if (src[j] === '\\') { blank(j, j + 2); j += 2; continue }
        if (src[j] === '`') { blank(j, j + 1); j++; break }
        if (src[j] === '$' && src[j + 1] === '{') {
          // 进入插值：内部是**代码**，保留；按深度找到配对的 }
          let depth = 1
          j += 2
          while (j < n && depth > 0) {
            if (src[j] === '{') depth++
            else if (src[j] === '}') depth--
            j++
          }
          continue
        }
        blank(j, j + 1)
        j++
      }
      i = j
      continue
    }
    i++
  }
  return out.join('')
}

/** 带 1 基行号的命中列表：`[{ line, text }]`。 */
function hitsWithLines(stripped, re) {
  const res = []
  const lines = stripped.split('\n')
  for (let k = 0; k < lines.length; k++) {
    const re2 = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
    let m
    while ((m = re2.exec(lines[k])) !== null) {
      res.push({ line: k + 1, text: m[0].trim() })
      if (m.index === re2.lastIndex) re2.lastIndex++
    }
  }
  return res
}

// ══════════════════════════════════════════════════════════════════════════
// §2 基准：哪些 `ctx.<名字>` **本来就免 inject**（从 cordis 自身派生，不手抄）
// ══════════════════════════════════════════════════════════════════════════
/**
 * 从 cordis 源码派生"免 inject 的 ctx 成员"集合。
 *
 * 判据（**从实现读出来的**，不是猜的）：`ctx.<x>` **不抛**当且仅当
 *   `Reflect.has(target, prop)` 为真（`reflect.ts:140-142` 直接返回，**不过门禁**），
 *   或该 prop 是 `accessor`（`:147-149`）。
 *   · cordis 把核心服务方法 **mixin** 到 ctx 上 ⇒ 它们是**原型上的属性** ⇒ 免 inject。
 *     出处：`src/reflect.ts:219-222` 的四处 `this.mixin(...)`。
 *   · `logger` / `events` / `reflect` / `registry` / `root` / `fiber` 是
 *     `Context` 的**自有属性**（`src/context.ts:76-80`、`:29-33`）⇒ 同样免 inject。
 *
 * ⚠ **基准读不到 ⇒ FAIL**（**不**降级为"跳过这条"）：跳过等于"基准缺失就默认通过"，
 *   正是本仓反复盯防的假通过形态。
 *
 * @returns {Set<string>} 免 inject 的 ctx 成员名。
 */
function deriveCtxFreeMembers() {
  const set = new Set(['logger', 'events', 'reflect', 'registry', 'root', 'fiber'])
  const reflectPath = join(CORDIS_DIR, 'src', 'reflect.ts')
  const contextPath = join(CORDIS_DIR, 'src', 'context.ts')
  if (!existsSync(reflectPath) || !existsSync(contextPath)) {
    bad(`读不到 cordis 源码（${reflectPath} / ${contextPath}）—— "哪些 ctx 成员免 inject"的**基准**缺失 ⇒ 不按通过处理`)
    return set
  }
  const reflectSrc = readFileSync(reflectPath, 'utf8')
  // 抓 `this.mixin('<source>', ['a','b',…])`
  const mixinCalls = reflectSrc.match(/this\.mixin\(\s*'[^']+'\s*,\s*\[[^\]]*\]\s*\)/g) ?? []
  if (mixinCalls.length === 0) {
    bad('cordis reflect.ts 里一条 `this.mixin(...)` 都没解析到（解析口径可能已漂 ⇒ 不按通过处理）')
    return set
  }
  let mixed = 0
  for (const call of mixinCalls) {
    const listPart = call.slice(call.indexOf('['))
    for (const m of listPart.matchAll(/'([A-Za-z_$][\w$]*)'/g)) { set.add(m[1]); mixed++ }
  }
  if (mixed === 0) bad('cordis 的 mixin 名单里一个成员名都没解析到（⇒ 基准为空，不按通过处理）')
  else ok(`免 inject 基准（从 cordis 自身派生）：${mixed} 个 mixin 成员 + ${6} 个自有属性`)
  return set
}

// ══════════════════════════════════════════════════════════════════════════
// §3 读取 client 源码
// ══════════════════════════════════════════════════════════════════════════
const clientFiles = (() => {
  try {
    return readdirSync(CLIENT_DIR).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx')).sort()
  } catch (e) {
    bad(`读不到 ${CLIENT_DIR}：${String(e?.message ?? e)} ⇒ 不按通过处理`)
    return []
  }
})()

if (clientFiles.length === 0) {
  bad('src/client/ 下一个 .ts/.tsx 都没有（基准缺失 ⇒ 不按通过处理）')
}

const indexSrc = readOr(INDEX_TS, 'client 入口（index.ts）')
const catalogSrc = readOr(CATALOG_TS, '候选来源（catalog.ts）')
const settingsSrc = readOr(SETTINGS_TS, '设置绑定（settings.ts）')

/**
 * 每份源码的**两种视图** —— 这是本脚本的关键区分，混用就会造出"假通过/假失败"：
 *   · `rawOf`  = **原始**源码 —— 用于**抽字符串字面量**（inject 名单、常量值、`status:'error'`）。
 *     ⚠ 若用剥离态去抽字面量，字符串**已被空格覆盖** ⇒ 什么都抽不到
 *       （本脚本首版就踩了这个：`declaredModule` 变成空数组而**不报错**）。
 *   · `codeOf` = 注释/字符串/模板串字面量**已剥空** —— 用于**检测属性访问**。
 *     ⚠ 若用原始态去检测，本仓注释里刻意写下的反例（"不许这么写 `remote.agentPresets`"）
 *       会被当成真违规 ⇒ 假失败。
 */
const rawOf = new Map()
const codeOf = new Map()
for (const f of clientFiles) {
  const src = readFileSync(join(CLIENT_DIR, f), 'utf8')
  rawOf.set(f, src)
  codeOf.set(f, stripCommentsAndStrings(src))
}

// ══════════════════════════════════════════════════════════════════════════
// §4 解析「已声明」：模块级 inject + 所有 ctx.inject([...])
// ══════════════════════════════════════════════════════════════════════════
/**
 * 模块级 `export const inject = [...]` 声明的名字。
 *
 * ⚠ 在**剥离态里定位**（避免注释里的示例被当成真声明），但**取字面量必须在原始态**
 *   —— 剥离态把引号内容换成空格了，只能在剥离态拿偏移、回原始态取串。
 */
function moduleInjectList(rawSrc) {
  const code = stripCommentsAndStrings(rawSrc)
  const m = /export\s+const\s+inject\s*=\s*\[([^\]]*)\]/.exec(code)
  if (m === null) return null
  const listText = rawSrc.slice(m.index, m.index + m[0].length)
  return [...listText.matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2])
}
/** 全部 `ctx.inject([...], …)` / `.inject([...], …)` 里声明的名字（正则**字面量**层面）。 */
function allReactiveInjectNames() {
  const names = new Set()
  const lists = []
  const constMap = new Map()
  for (const [f, raw] of rawOf) {
    const code = stripCommentsAndStrings(raw)
    // 定位在剥离态（躲开注释里的示例），取字面量回原始态
    // ⚠ 不能排除 `ctx.` 前缀：真实调用就是 `ctx.inject([...])`。
    //   只排除**标识符续写**（`fooInjct`/`x_inject` 那类），并用**词边界 + 点号**两种合法前缀。
    for (const m of code.matchAll(/(?:^|[^\w$])(?:[A-Za-z_$][\w$]*\s*\.\s*)?inject\s*\(\s*\[[^\]]*\]/gm)) {
      const line = code.slice(0, m.index).split('\n').length
      const rawSlice = raw.slice(m.index, m.index + m[0].length)
      const parts = [...rawSlice.matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2])
      lists.push({ file: f, line, parts })
      for (const p of parts) names.add(p)
    }
    // 常量表：同样"剥离态定位、原始态取值"
    for (const m of code.matchAll(/(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\s*=\s*['"][^'"]*['"]/g)) {
      const rawSlice = raw.slice(m.index, m.index + m[0].length)
      const v = /=\s*['"]([^'"]*)['"]/.exec(rawSlice)
      if (v !== null) constMap.set(m[1], v[1])
    }
  }
  // ⚠ 常量间接（`ctx.inject([NS_AGENT_PRESETS, NS_SESSION], …)`）：把**已知常量**的值也算进来。
  for (const l of lists) for (const p of l.parts) if (constMap.has(p)) names.add(constMap.get(p))
  return { names, lists, constMap }
}

const declaredModule = moduleInjectList(indexSrc)
const reactive = allReactiveInjectNames()

if (declaredModule === null) {
  bad('`src/client/index.ts` 里找不到可解析的 `export const inject = [...]`（解析口径可能已漂 ⇒ 不按通过处理）')
}

// ══════════════════════════════════════════════════════════════════════════
// §5 断言 A —— 不得出现 Remote 命名空间的**属性访问**（核心）
// ══════════════════════════════════════════════════════════════════════════

/**
 * A-2 的**唯一**检测器：Remote 命名空间的链式**属性访问**。
 *
 * ⚠ **必须在这里定义一次、由断言与 §12 自检共用**（本脚本实测教训）：
 *   首版把同一条正则**抄了两份**（断言一份、自检一份）⇒ 把断言那份改坏后，
 *   自检**仍用自己那份完好副本**去测 ⇒ 自检报"通过"而断言已哑 ⇒ **双向失效**。
 *   这正是"检查没牙"的形态，且比单纯漏报更危险（它让人相信检查还在工作）。
 *   现已提为常量：改坏它，§12 的自检**立刻**报 FAIL。
 */
const NS_PROP = /(?:[A-Za-z_$][\w$]*|\)|\])\s*\.\s*(agentPresets|session)\b/g

/** A-1 的**唯一**检测器（`ctx.remote` 任何形态），与 A-2 同理共用。 */
const CTX_REMOTE = /\bctxRef?\.remote\b|\bctx\.remote\b/g

/** E 的**唯一**检测器（把 ctx.inject 返回值当函数调，含可选链 `?.()`）。 */
const FIBER_CALLED = /\b(off|disposer|subscription|sub)\s*\??\.?\s*\(\s*\)/g

const ctxFree = deriveCtxFreeMembers()

{
  // A-1: `ctx.remote`（任何形态）—— "先拿 remote 再点命名空间"的入口
  let total = 0
  for (const [f, code] of codeOf) {
    for (const h of hitsWithLines(code, CTX_REMOTE)) {
      bad(`A-1 · ${f}:${h.line} 出现 \`ctx.remote\` 属性访问（${h.text}）—— 应改为 ctx.get('<逐字名>')`)
      total++
    }
  }
  if (total === 0) ok('A-1 ✓ client 代码零 `ctx.remote` 属性访问')

  // A-2: 对 Remote 命名空间的链式属性访问（`.agentPresets` / `.session` 紧跟**表达式**）
  //      判据：点号前是标识符/右括号/右方括号（⇒ 是表达式），**不是**字符串片段（字符串已剥离）。
  let total2 = 0
  for (const [f, code] of codeOf) {
    for (const h of hitsWithLines(code, NS_PROP)) {
      bad(`A-2 · ${f}:${h.line} 对 Remote 命名空间做了**属性访问**（${h.text}）—— `
        + '会撞 cordis inject 门禁抛 `cannot get property "remote.<ns>" without inject`；应改为 ctx.get(\'<逐字名>\')')
      total2++
    }
  }
  if (total2 === 0) ok('A-2 ✓ client 代码零 Remote 命名空间链式属性访问')

  // A-3: 其余 `ctx.<名字>` 必须在（免 inject 基准 ∪ 已声明）里 —— 防"别处又长出一个"
  let total3 = 0
  for (const [f, code] of codeOf) {
    for (const h of hitsWithLines(code, /\bctx\.([A-Za-z_$][\w$]*)/g)) {
      const name = /\.([A-Za-z_$][\w$]*)/.exec(h.text)?.[1]
      if (name === undefined) continue
      if (ctxFree.has(name)) continue
      if ((declaredModule ?? []).includes(name)) continue
      if (reactive.names.has(name)) continue
      bad(`A-3 · ${f}:${h.line} \`ctx.${name}\` 既不在免 inject 基准里，也未声明依赖`
        + '（模块级 inject 或 ctx.inject）—— 会抛 `cannot get property "…" without inject`')
      total3++
    }
  }
  if (total3 === 0) ok(`A-3 ✓ 其余 \`ctx.<名>\` 访问（免 inject 基准 ∪ 已声明）全部对得上`)

  if (total + total2 + total3 === 0) ok('A ✓ **零裸属性访问**（本轮的原始缺陷形态已不可能再现）')
}

// ══════════════════════════════════════════════════════════════════════════
// §6 断言 B/C —— 免 inject 读法在位 + 逐字名锚定
// ══════════════════════════════════════════════════════════════════════════
{
  const catalogCode = codeOf.get('catalog.ts') ?? ''
  const catalogRaw = rawOf.get('catalog.ts') ?? ''
  // B-1: serviceOf 定义存在且体内用 get(
  const svcDef = /function\s+serviceOf\s*\([^)]*\)\s*:\s*[^{]*\{([\s\S]*?)\n\}/.exec(catalogCode)
  if (svcDef === null) {
    bad('B-1 · catalog.ts 里找不到 `serviceOf()` 定义 —— 免 inject 读法的唯一入口不在了')
  } else if (!/\.get\s*\(/.test(svcDef[1])) {
    bad('B-1 · `serviceOf()` 体内没有 `.get(` —— 免 inject 读法被改掉了（会退回属性访问）')
  } else {
    ok('B-1 ✓ `serviceOf()` 走 `ctx.get(<逐字名>)`（免 inject 读法，不抛）')
  }

  // C: 逐字名常量（值必须与宿主实际注册名一致）
  // ⚠ 取**常量值**必须回原始态（剥离态里引号内容已成空格 ⇒ 抽出空串而静默失真）
  const cAG = /const\s+NS_AGENT_PRESETS\s*=\s*'([^']*)'/.exec(catalogRaw) ?? /const\s+NS_AGENT_PRESETS\s*=\s*"([^"]*)"/.exec(catalogRaw)
  const cSE = /const\s+NS_SESSION\s*=\s*'([^']*)'/.exec(catalogRaw) ?? /const\s+NS_SESSION\s*=\s*"([^"]*)"/.exec(catalogRaw)
  const EXPECT = { NS_AGENT_PRESETS: 'remote.agentPresets', NS_SESSION: 'remote.session' }
  if (cAG === null) bad('C · catalog.ts 里找不到 `NS_AGENT_PRESETS` 常量（逐字名收口点不见了）')
  else if (cAG[1] !== EXPECT.NS_AGENT_PRESETS) {
    bad(`C · NS_AGENT_PRESETS = ${JSON.stringify(cAG[1])}，但宿主实际注册名是 ${JSON.stringify(EXPECT.NS_AGENT_PRESETS)}`
      + '（出处：dsh-api-gateway/lib/client.js:2040-2042 `remoteServiceKey` → `remote.${namespace}`；'
      + 'namespace 见 dsh-api-remotes/lib/client.js:4631）')
  } else ok(`C ✓ NS_AGENT_PRESETS = ${JSON.stringify(cAG[1])}（与宿主 remoteServiceKey 派生名一致）`)
  if (cSE === null) bad('C · catalog.ts 里找不到 `NS_SESSION` 常量（逐字名收口点不见了）')
  else if (cSE[1] !== EXPECT.NS_SESSION) {
    bad(`C · NS_SESSION = ${JSON.stringify(cSE[1])}，但宿主实际注册名是 ${JSON.stringify(EXPECT.NS_SESSION)}`
      + '（同上出处；namespace 见 dsh-api-remotes/lib/client.js:11475 `session/modelCatalog`）')
  } else ok(`C ✓ NS_SESSION = ${JSON.stringify(cSE[1])}（与宿主 remoteServiceKey 派生名一致）`)

  // B-2: 两个常量**真的被用于取服务**（而不是定义了却仍裸访问）
  for (const [constName, want] of Object.entries(EXPECT)) {
    if (constName === 'NS_AGENT_PRESETS' && cAG === null) continue
    if (constName === 'NS_SESSION' && cSE === null) continue
    if (!new RegExp(`serviceOf\\(\\s*${constName}\\s*\\)`).test(catalogCode)) {
      bad(`B-2 · catalog.ts 没有用 \`serviceOf(${constName})\` 取 ${wrap(want)} —— 常量定义了却没走免 inject 读法`)
    } else ok(`B-2 ✓ 经 \`serviceOf(${constName})\` 取 ${wrap(want)}`)
  }
}
function wrap(s) { return '`' + s + '`' }

// ══════════════════════════════════════════════════════════════════════════
// §7 断言 D —— 模块级 inject 不得含 Remote 命名空间（被明令禁止的修法）
// ══════════════════════════════════════════════════════════════════════════
{
  if (declaredModule !== null) {
    const remoteEntries = declaredModule.filter((n) => n.startsWith('remote.') || n === 'remote')
    if (remoteEntries.length > 0) {
      bad(`D · index.ts 的模块级 \`export const inject\` 含 ${remoteEntries.map(wrap).join(' / ')}`
        + ' —— 那是**加载门禁**：dsh-api-remotes 缺席时**整个 client 插件不激活** ⇒ '
        + '设置分区整体消失（回归）。这两个命名空间只能走 ctx.inject 或免 inject ctx.get。')
    } else {
      ok(`D ✓ 模块级 inject = [${declaredModule.map(wrap).join(', ')}] —— 不含 Remote 命名空间（设置分区不会整体消失）`)
    }
    // 正例：slots 必须仍声明（apply 里访问 ctx.slots 是硬依赖）
    if (!declaredModule.includes('slots')) {
      bad('D · 模块级 inject 里缺 `slots` —— apply 里访问 ctx.slots 会抛门禁错（本插件的硬依赖）')
    } else ok('D ✓ 模块级 inject 仍含 `slots`（apply 的 ctx.slots 硬依赖在位）')
  }
}

// ══════════════════════════════════════════════════════════════════════════
// §8 断言 E —— ctx.inject 的返回值按 Fiber 用（`.dispose`），不得写成 `off()`
// ══════════════════════════════════════════════════════════════════════════
{
  let badCount = 0
  /**
   * 判据：`<标识符>(` **或** `<标识符>?.(` —— 即"把某个值当函数调用"。
   *
   * ⚠ **可选链要写成 `\?\.` 而不是 `\??`**（本脚本首版的实测教训）：
   *   `off?.()` 里 `?.` 是**两个字符**，`\??\(` 只允许 0/1 个 `?`、其后必须紧跟 `(`，
   *   ⇒ **匹配不到** `off?.()`，于是负向对拍时**假通过**（注入了 `off?.()` 却仍 PASS）。
   *   这正是本仓 E-27 那类"检查没牙"的形态，故在此写明并纳入 §12 自检。
   */
  for (const [f, code] of codeOf) {
    for (const h of hitsWithLines(code, FIBER_CALLED)) {
      bad(`E · ${f}:${h.line} 把 ctx.inject(...) 的返回值当**函数**调用（${h.text}）—— `
        + '返回值是 **Fiber 对象**（typeof === "object"），实测会抛 `TypeError: … is not a function`；应写 `.dispose?.()`')
      badCount++
    }
  }
  if (badCount === 0) ok('E ✓ 未发现"把 Fiber 当函数调"的清理写法')

  // 正向：至少一处 `.dispose` 清理（证明两处绑定都按 Fiber 收口）
  let disposeSites = 0
  for (const [f, code] of codeOf) {
    for (const h of hitsWithLines(code, /\.dispose\b/g)) { void f; void h; disposeSites++ }
  }
  if (disposeSites === 0) bad('E · 一处 `.dispose` 清理都没有 —— 两处 ctx.inject 绑定的清理路径缺失')
  else ok(`E ✓ ${disposeSites} 处清理走 \`.dispose\``)
}

// ══════════════════════════════════════════════════════════════════════════
// §9 断言 F —— 命名空间未就绪时不得静默当空清单（失败必须如实显示 + 可重试）
// ══════════════════════════════════════════════════════════════════════════
{
  const catalogCode = codeOf.get('catalog.ts') ?? ''
  const catalogRawF = rawOf.get('catalog.ts') ?? ''
  if (!/status:\s*'error'/.test(catalogRawF)) {
    bad("F · catalog.ts 里没有任何 `status: 'error'` —— 失败路径被静默吞成了空清单/正常态")
  } else ok("F ✓ 失败路径如实置 `status: 'error'`（红字 + 可重试，不静默当空清单）")

  // 具体到"命名空间未就绪"这一支：该 `if` 的**语句块内**必须带 status: 'error'
  const missingBranch = /if\s*\(\s*presetsNs\s*===\s*undefined\s*\|\|\s*catalogNs\s*===\s*undefined\s*\)/.exec(catalogCode)
  if (missingBranch === null) {
    bad('F · catalog.ts 里找不到"命名空间未就绪"分支 —— 未就绪的判定被删了（会退化成读到 undefined 后静默）')
  } else {
    // ⚠ 用**花括号配对**取该分支自己的块（不是"接下来 N 个字符"）——
    //   首版用固定窗口 ⇒ 负向对拍假通过（证据来自窗口里**别的**语句）。
    const block = balancedBlock(catalogCode, missingBranch.index)
    if (block === null) {
      bad('F · 「命名空间未就绪」分支的花括号无法配对（源码形态读不准 ⇒ 不按通过处理）')
    } else {
      // 判据在**剥离态**取到块，回**原始态**同位置找字符串字面量：
      //   status: 'error' 里的 'error' 在剥离态已成空格 ⇒ 必须在原始态查。
      const at = catalogCode.indexOf(block)
      const rawBlock = catalogRawF.slice(at, at + block.length)
      if (!/status:\s*'error'/.test(rawBlock)) {
        bad("F · 「命名空间未就绪」分支里没有 `status: 'error'` —— 该失败会被静默吞掉"
          + '（表现为"宿主里一个预设都没有"而不是"读取失败"，且用户无从得知可重试）')
      } else ok("F ✓ 「命名空间未就绪」分支如实报 error（含未挂载的命名空间名，块内配对判定）")
    }
  }
}

/**
 * 从 `startIndex` 处的 `{` 起做**花括号配对**，返回 `{...}`（含花括号）的原文。
 *
 * ⚠ **为什么必须是配对而不是"取接下来 N 个字符"**（本脚本首版的实测教训）：
 *   首版 F 断言用 `slice(idx, idx + 900)` 取窗口，结果**负向对拍时假通过** ——
 *   注入"命名空间缺席 ⇒ 静默当空清单"后仍然 PASS，因为 900 字符窗口越过了该分支的
 *   收尾 `}`，把**后面另一个**（预设读取失败的）`status: 'error'` 当成了证据。
 *   ⇒ 判据必须锚在**本语句块内部**，否则"证据"可以来自别处（E-27 的假通过形态）。
 *
 * @param src - 源码（**剥离态**用，避免注释里的花括号干扰配对）。
 * @param startIndex - 指向某语句起始处；函数会向后找第一个 `{`。
 * @returns 配对到的块文本；找不到 `{` 或**括号不平衡**时返回 `null`（⇒ 调用方须 FAIL，
 *          **不得**降级为"取一段窗口" —— 降级正是上面那个假通过的来源）。
 */
function balancedBlock(src, startIndex) {
  const open = src.indexOf('{', startIndex)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  return null // 不平衡 ⇒ 交给调用方 FAIL，不猜
}

// ══════════════════════════════════════════════════════════════════════════
// §10 断言 G —— inflight 复位必须"在赋值之后"（异步 IIFE 同步段覆盖陷阱）
// ══════════════════════════════════════════════════════════════════════════
{
  const catalogCode = codeOf.get('catalog.ts') ?? ''
  const fnStart = catalogCode.indexOf('export function loadCatalog')
  if (fnStart < 0) {
    bad('G · 找不到 `loadCatalog` —— 重试/去重闸门的落点读不到')
  } else {
    const body = catalogCode.slice(fnStart)
    // 反例：体内 finally 复位（会被同步段执行、随后被赋值覆盖）
    const finallyReset = /finally\s*\{[^}]*inflight\s*=\s*null/.test(body)
    if (finallyReset) {
      bad('G · `inflight = null` 写在 async IIFE 的 `finally` 里 —— 实测陷阱：异步函数体**同步**执行到第一个 await，'
        + '而"命名空间缺席"分支在 await 之前就 return ⇒ finally **先**跑、'
        + '`inflight = (async () => …)()` 的赋值**后**执行并把 null 覆盖成已完成的 promise ⇒ '
        + '`inflight` 永久非 null ⇒ 点「重新读取」毫无反应。复位必须挂在 promise 链上。')
    } else ok('G ✓ `inflight` 复位不在 async IIFE 体的 `finally` 里（避开同步段覆盖陷阱）')

    // 正例：守卫式复位（把赋值结果先存变量，复位时校验"还是我这一笔"）
    if (!/if\s*\(\s*inflight\s*===\s*\w+\s*\)\s*inflight\s*=\s*null/.test(body)) {
      bad('G · 找不到守卫式复位 `if (inflight === <本笔>) inflight = null` —— '
        + '"还是我这一笔才复位"的保护缺失（并发下可能抹掉别人的在飞请求）')
    } else ok('G ✓ 复位是守卫式（`if (inflight === <本笔>) inflight = null`，不抹掉别人的在飞请求）')
  }
}

// ══════════════════════════════════════════════════════════════════════════
// §11 断言 H —— `configForms` 是"已声明"的正例，必须被认得出（防 A 口径过宽）
// ══════════════════════════════════════════════════════════════════════════
{
  const decl = reactive.lists.filter((l) => l.parts.includes('configForms'))
  if (decl.length === 0) {
    bad('H · 没有任何 `ctx.inject([…\'configForms\'…])` —— settings.ts 的依赖声明不见了'
      + '（则 A 的"已声明"这条路径无从体现，且 form 会永远读不到）')
  } else {
    ok(`H ✓ \`configForms\` 经 ctx.inject 已声明（${decl.map((d) => `${d.file}:${d.line}`).join(', ')}）—— 不在 A 的禁止之列`)
  }
  // 并且 settings.ts 里确实用它（正例闭环）
  const settingsCode = codeOf.get('settings.ts') ?? ''
  if (!/configForms/.test(settingsCode)) {
    bad('H · settings.ts 里没用到 configForms —— 绑定路径可能已被改坏')
  } else ok('H ✓ settings.ts 经已声明的 `configForms` 读配置面')
}

// ══════════════════════════════════════════════════════════════════════════
// §12 自检（**让"检查自己"也有牙**）：剥离器与检测器必须能各自证伪
// ══════════════════════════════════════════════════════════════════════════
{
  const selfFail = []
  // ① 剥离器：注释与字符串里的 `ctx.remote` **必须被剥掉**
  const s1 = stripCommentsAndStrings('// ctx.remote.x\nconst a = "ctx.remote.y"\n/* .agentPresets */\n')
  if (/ctx\.remote/.test(s1) || /agentPresets/.test(s1)) selfFail.push('剥离器没剥掉注释/字符串里的 ctx.remote')
  // ② 剥离器：真实**代码**访问**必须保留**
  const s2 = stripCommentsAndStrings('const r = ctx.remote\nconst z = remote.agentPresets\n')
  if (!/ctx\.remote/.test(s2) || !/\.agentPresets/.test(s2)) selfFail.push('剥离器把真实代码访问也剥掉了（会导致漏报）')
  // ③ 检测器 A-1：给的样例必须命中
  if (hitsWithLines(s2, CTX_REMOTE).length !== 1) selfFail.push('A-1 检测器对样例漏报')
  // ④ 检测器 A-2：`remote.agentPresets` 必须命中；而**纯字符串**不得命中
  if (hitsWithLines(s2, NS_PROP).length !== 1) selfFail.push('A-2 检测器对样例漏报/误报')
  const s3 = stripCommentsAndStrings("const NS = 'remote.agentPresets'\n")
  if (hitsWithLines(s3, NS_PROP).length !== 0) selfFail.push('A-2 对字符串常量误报（应当被剥离）')
  // ⑤ 模板串里**插值内的代码**不得被剥掉（否则漏报）
  const s4 = stripCommentsAndStrings('const t = `x ${ctx.get("a").agentPresets} y`\n')
  if (!/\.agentPresets/.test(s4)) selfFail.push('剥离器把模板串插值内的代码也剥掉了（会漏报）')
  // ⑥ `balancedBlock` 必须**只**取到本分支的块，不得越界吞掉后面的兄弟语句。
  //    ⚠ 这条是**本轮负向对拍抓出来的真缺口**：首版 F 断言用固定长度窗口，
  //      于是"命名空间缺席 ⇒ 静默空清单"的注入**假通过**（证据来自窗口里别的语句）。
  const s5 = 'if (a === undefined) { update({ status: 1 }) } else { update({ status: 2 }) }'
  const blk = balancedBlock(s5, 0)
  if (blk === null || /status: 2/.test(blk)) selfFail.push('balancedBlock 越界（把 else 分支也吞进来了）⇒ F 断言会假通过')
  if (blk !== null && !/status: 1/.test(blk)) selfFail.push('balancedBlock 取错了块')
  // ⑦ 花括号不平衡时必须返回 null（**不得**降级成"取一段窗口"）
  if (balancedBlock('if (a) { update({', 0) !== null) selfFail.push('balancedBlock 对不平衡花括号返回了非 null（会静默取一段窗口 ⇒ 假通过）')
  // ⑧ E 的检测器必须认得**可选链**调用 `off?.()`（本轮负向对拍抓出的第二个真缺口：
  //    首版判据 `\??\(` 匹配不到 `?.()` ⇒ 注入 `off?.()` 仍 PASS）
  for (const bad_ of ['off?.()', 'off()', 'disposer?.()']) {
    FIBER_CALLED.lastIndex = 0
    if (!FIBER_CALLED.test(bad_)) selfFail.push(`E 检测器匹配不到 ${JSON.stringify(bad_)}（⇒ 注入该写法会假通过）`)
  }
  for (const good_ of ['off?.dispose()', 'void off.dispose()']) {
    FIBER_CALLED.lastIndex = 0
    if (FIBER_CALLED.test(good_)) selfFail.push(`E 检测器对正确写法 ${JSON.stringify(good_)} 误报`)
  }

  if (selfFail.length > 0) {
    bad(`自检失败（**检查本身不可信** ⇒ 不按通过处理）：${selfFail.join('；')}`)
  } else {
    ok('自检 ✓ 剥离器（注释/字符串/模板串字面量）+ 检测器（A-1/A-2）双向对拍均通过')
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 输出
// ══════════════════════════════════════════════════════════════════════════
console.log('client 半边「宿主服务取用」核对 · dsh-hob')
console.log(`扫描范围：src/client/**（${clientFiles.length} 个文件：${clientFiles.join(' · ')}）`)
console.log('断言：A 零裸属性访问 · B 免 inject 读法在位 · C 逐字名锚定 · D 模块级 inject 不含命名空间 ·')
console.log('      E Fiber 用 dispose · F 失败不静默 · G inflight 复位挂 promise · H configForms 正例')
console.log('')
for (const n of note) console.log('  ✓', n)
console.log('')
if (fail.length === 0) {
  console.log('判定：PASS —— 两个 Remote 命名空间只经免 inject 读法取用，且失败仍如实显示、可重试。')
  process.exit(0)
} else {
  console.log('判定：FAIL')
  for (const f of fail) console.log('  ✗', f)
  process.exit(1)
}
