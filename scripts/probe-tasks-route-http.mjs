#!/usr/bin/env node
/**
 * **HOB 只读路由 · 真机 HTTP 探针（按需档）** —— 2026-10-29 · 第 10 轮。
 * 2026-11-02 增补 Current / 按 ID 资源 / 五步注意力字段。
 *
 * ══ ⚠⚠ **按需档：不在 `check:all` 的必跑套件里，也不是 `check:*` 的常规族** ═════
 *   理由：它**需要一个活着的宿主机进程 + 一个有效 launch token**。CI / 干净 clone /
 *   无 GUI 的环境里这两样都没有 ⇒ 若放进必跑，结果只能是"永远 exit 2"，
 *   那会把"没对象"污染成"判据没跑"，久了就没人看它了（本仓 `E-122` 那类失效）。
 *   ⇒ 手工按需跑：`npm run check:tasks-route-http`。
 *
 * ══ 它守什么（两条边界，都是真机上真踩过的）═══════════════════════════════════
 *   ① `POST /api/dsh-hob/tasks-progress`（带 cookie）⇒ 期望 **200 + JSON**
 *      （`ok:true` 带 `rows`，或 `ok:false` 带三选一 `reason` —— 两者都算"处理体在"）。
 *   ② 同一路径 **`GET`** ⇒ 期望 **404 + 纯文本 `not found`**。
 *      ⚠ 这条不是"缺陷"，是宿主**既有语义**：
 *        `dsh-client-connection/lib/index.js:828-835` —— 方法不在 `route.methods` 里时
 *        落到 RPC 拦截器，最终 `new Response("not found", { status: 404 })`。
 *      ⇒ 探针钉住它，是为了让"错门回 404 纯文本"这个**已知边界**保持可观测：
 *        哪天它变成 405 或变成 JSON，说明宿主语义变了，要重新评估客户端的 404 分支。
 *
 * ══ 它守什么（后两条是 2026-11-02 增补）═══════════════════════════════════
 *   ③ `POST /api/dsh-hob/ledger-resource`：
 *      `resource:"current"` ⇒ 200 + Current 文本；
 *      `resource:"requirement/R-009"` ⇒ 200 + 稳定 ID 卡片（⛔ 不内联正文）；
 *   ④ `POST /api/dsh-hob/stages` ⇒ 200 + 五步顺序与 `attention` 字段，且列表 ≤ 64 KB、
 *      条目只带紧凑投影与共享关系标题（完整正文走按 ID 读取）。
 *
 * ══ 退出码三档（⚠ 三档必须可分辨，⛔ 不许把 2 当 0）══════════════════════════
 *   0 = 所有有对象断言都符合预期
 *   1 = **有对象但不符合**（真缺陷：路由没注册 / 方法白名单不对 / 响应形状变了）
 *   2 = **拿不到活宿主或 token** ⇒ `noObject`，明说"没对象"，⛔ 不算通过
 *
 * ══ 参数 ═══════════════════════════════════════════════════════════════════
 *   `--session <id>` —— 指定 POST 用的会话 id。
 *   `--catalog` —— 只跑不需要活会话的账本目录 + 实时通道边界断言（活宿主 + cookie 即可，⛔ 不伪造会话）。
 *   ⚠ **不给才退回"最新会话"启发式**：从 `~/.dsh/sessions/<cwd 编码>/` 里先按持久件
 *     活宿主当前打开的 `session.lock`（`/proc/<pid>/fd` 可见），再按持久件
 *     `session.v4.jsonl.zstd` 的 `header.cwd` 校验，最后才退回目录 mtime。
 *     ⚠ **那仍是启发式，不是权威来源** —— 多会话并行、旧会话已从宿主内存
 *     淘汰时都可能取错（取到已不在实例里的 id ⇒ 服务端按设计回 `ledger-unreadable`，
 *     看起来像真缺陷）。⇒ 需要硬结论时请显式给 `--session`。
 *
 * ══ 它怎么拿凭据（⛔ 不写死任何 token）════════════════════════════════════════
 *   宿主启动时会把 `dsh web: http://127.0.0.1:<port>/?token=<token>` 打进日志
 *   （实测出自 `~/.dsh/logs/web-manual.log`）。本脚本：
 *     ① 从日志里捞最后一次 `token=…`；
 *     ② 用它打 `/connect?token=` 换 `dsh-auth-*` cookie（宿主回 302 + `set-cookie`）；
 *     ③ 带 cookie 打那两条。
 *   ⚠ 任何一步拿不到 ⇒ exit 2，并把"卡在哪一步"写清楚。
 *
 * ══ 零第三方依赖（本仓纪律）════════════════════════════════════════════════
 *   只用 Node 内置 `fetch`（Node 22）与 `node:fs`。
 *
 * 用法：npm run check:tasks-route-http   （或 node scripts/probe-tasks-route-http.mjs）
 */

import { existsSync, readFileSync, readdirSync, readlinkSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROUTE = '/api/dsh-hob/tasks-progress'
const RESOURCE_ROUTE = '/api/dsh-hob/ledger-resource'
const STAGES_ROUTE = '/api/dsh-hob/stages'
const WORK_PLANS_ROUTE = '/api/dsh-hob/work-plans'
const LEDGERS_ROUTE = '/api/dsh-hob/ledgers'
const CHAINS_ROUTE = '/api/dsh-hob/requirement-chains'
const LIVE_ROUTE = '/api/dsh-hob/live'
const DEFAULT_PORT = 3080

/**
 * 命令行参数：`--session <id>`（可省）。
 * ⚠ 解析刻意极简：只认这一个旗标，别的参数一律忽略（⛔ 不引第三方解析器）。
 */
const argv = process.argv.slice(2)
const sessionArgIndex = argv.indexOf('--session')
const SESSION_OVERRIDE = sessionArgIndex >= 0 ? (argv[sessionArgIndex + 1] ?? '') : ''

/**
 * 显式日志覆盖：`--log <file>`。
 *
 * ⚠ 为什么需要：宿主常被 `... 2>&1 | tee <file>` 启动，此时 `/proc/<pid>/fd/1`
 *   指向的是**管道**，不是日志文件；旧启发式会因此判成 `noObject`。
 *   给一个显式读入口，既不猜，也能让重启后的验收直接使用启动输出原文。
 */
const logArgIndex = argv.indexOf('--log')
const LOG_OVERRIDE = logArgIndex >= 0 ? (argv[logArgIndex + 1] ?? '') : ''
const CATALOG_ONLY = argv.includes('--catalog')

/**
 * 日志候选（按顺序试）。
 *
 * ⚠⚠ **2026-10-29 第 10 轮实测教训**：只认 `~/.dsh/logs/web-manual.log` **不够** ——
 *   本机那次活宿主是用 `> /tmp/dsh-market-restart-…out.log` 起的，
 *   于是"日志里找不到 token"被我错报成 `noObject`（其实是**有对象、只是凭据找错地方**）。
 *   ⇒ 现在先走**最可靠的一步**：从 `/proc/<pid>/fd/1` 找到活进程**自己的 stdout 文件**。
 *     ⚠ 这不是"猜"：`ps` 里那个 `dsh web` 进程的 fd/1 就是它写 token 的那一处。
 */
const LOG_CANDIDATES = [
  join(homedir(), '.dsh', 'logs', 'web-manual.log'),
  join(homedir(), '.dsh', 'logs', 'web.log'),
]

let pass = 0
let fail = 0
const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail++; console.log(`  ✗ ${m}`) }

console.log('')
console.log('H 组：HOB 只读路由 · 真机 HTTP 探针（**按需档**，不在 check:all 必跑里）')
console.log('')

/**
 * 从日志捞最后一次 launch token 与端口。
 *
 * @returns `{ token, port, from }` 或 `undefined`（明说"没对象"）
 */
function liveHostStdoutLogs() {
  /** 从 /proc 找 `dsh web` 进程，读它 fd/1 指向的文件。⚠ 只读，不做任何写。 */
  const out = []
  let pids = []
  try { pids = readdirSync('/proc').filter((n) => /^\d+$/.test(n)) } catch { return out }
  for (const pid of pids) {
    let cmd = ''
    try { cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ') } catch { continue }
    if (!/dsh\b.*\bweb\b/.test(cmd)) continue
    try {
      const link = readlinkSync(`/proc/${pid}/fd/1`)
      if (link === '' || !existsSync(link)) continue
      /**
       * ⚠⚠ **只收普通文件**（2026-11-08 独立验收实测）：
       *   宿主用 PTY 启动时 `fd/1 -> /dev/pts/N`，`existsSync` 为真，
       *   但 `readFileSync('/dev/pts/N')` 会**永久阻塞**（TTY 没有 EOF）。
       *   ⇒ 探针会停在“凭据就绪”之前，既不通过也不报错。
       *   ⛔ 管道 / socket / 设备同样不是可读日志；跳过它们，继续试候选文件。
       */
      if (!statSync(link).isFile()) continue
      out.push(link)
    } catch { /* 忽略 */ }
  }
  return out
}

function readLaunch() {
  const candidates = [...(LOG_OVERRIDE === '' ? [] : [LOG_OVERRIDE]), ...liveHostStdoutLogs(), ...LOG_CANDIDATES]
  for (const p of candidates) {
    if (!existsSync(p)) continue
    let text = ''
    try { text = readFileSync(p, 'utf8') } catch { continue }
    const hits = [...text.matchAll(/dsh web:\s*(https?:\/\/[^\s]*\?token=([A-Za-z0-9_-]+))/g)]
    if (hits.length === 0) continue
    const last = hits[hits.length - 1]
    const portMatch = /:(\d+)\//.exec(last[1])
    return { token: last[2], port: portMatch === null ? DEFAULT_PORT : Number(portMatch[1]), from: p }
  }
  return undefined
}

/**
 * 从活 `dsh web` 进程的文件描述符里找它**当前打开的会话**。
 *
 * ⚠⚠ 这是比"最新会话"强得多的证据：宿主真的持有 `session.lock`。
 *   ⇒ 优先选这些会话；若一个都拿不到，再退回持久件 header / mtime。
 *   ⚠ 这只证明"宿主打开了它"，不证明面板当前正显示哪一页；错误仍要如实报。
 */
function liveSessionIds() {
  const found = new Map()
  let pids = []
  try { pids = readdirSync('/proc').filter((n) => /^\d+$/.test(n)) } catch { return [] }
  for (const pid of pids) {
    let cmd = ''
    try { cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ') } catch { continue }
    if (!/dsh\b.*\bweb\b/.test(cmd)) continue
    let fds = []
    try { fds = readdirSync(`/proc/${pid}/fd`) } catch { continue }
    for (const fd of fds) {
      let link = ''
      try { link = readlinkSync(`/proc/${pid}/fd/${fd}`) } catch { continue }
      const m = /\/sessions\/[^/]+\/(session-[^/]+)\/session\.lock$/.exec(link)
      if (m === null) continue
      found.set(m[1], link)
    }
  }
  return [...found.entries()].map(([id, lockPath]) => ({ id, lockPath }))
}

/**
 * 找一个**本工作区的真 sessionId**。
 *
 * ⚠⚠ 为什么必须有它（2026-10-29 第 10 轮实测）：
 *   服务端用 `session.header.cwd` 派生账本根。**body 不带 sessionId** ⇒ 没有 cwd
 *   ⇒ `resolveLedgerRoot` 返回 undefined ⇒ 路由**按设计**回
 *     `400 {"ok":false,"reason":"ledger-unreadable",…"没给工作区根…"}`
 *   —— 那是**我们的 JSON**，但**不是"数据通了"的凭据**。
 *   ⇒ 探针必须像真面板那样带上 sessionId，才能验到 `200 + rows`。
 * ⚠ 拿不到 ⇒ 明说 `noObject`（exit 2），⛔ 不许拿 400 当"通过"、⛔ 也不许当"真缺陷"。
 *
 * 目录命名的口径：宿主按 cwd 编码成 `--<路径把 / 换成 -->--`（本机实测：
 *   `/home/lk/FF/dsh-hob` → `--home-lk-FF-dsh-hob--`）。
 */
function findWorkspaceSessionId() {
  const cwd = process.cwd()
  /**
   * 编码口径（本机实测）：`/home/lk/FF/dsh-hob` → `--home-lk-FF-dsh-hob--`
   *   = `'-'` + 把每个 `/` 换成 `'-'` 的结果 + `'--'`
   *   ⚠ 别写成 `'--'` 前缀 —— 那会得到三个连字符，目录根本不存在（本轮实测踩过一次）。
   */
  const encoded = `-${cwd.replace(/\//g, '-')}--`
  const dir = join(homedir(), '.dsh', 'sessions', encoded)
  if (!existsSync(dir)) return undefined
  let names = []
  try { names = readdirSync(dir).filter((n) => n.startsWith('session-')) } catch { return undefined }
  if (names.length === 0) return undefined
  /** 取最新修改的那个（`statSync` 会抛就退回名字序）。 */
  let best
  let bestAt = -1
  for (const n of names) {
    let at = 0
    try { at = statSync(join(dir, n)).mtimeMs } catch { at = 0 }
    if (at > bestAt) { bestAt = at; best = n }
  }
  /**
   * ⚠ 先取一次活锁快照，再只在这个快照内选择。
   *   旧实现先收 live，再跑可能阻塞的 zstd；宿主若在这期间打开/关闭会话，
   *   会得到自相矛盾的候选集。
   */
  const live = liveSessionIds()
  /**
   * ⚠ 锁路径本身携带工作区编码目录，是*同一时刻*的权威证据：
   *   `/sessions/<encoded>/<session>/session.lock`。
   *   session.v4.jsonl.zstd 只作为崩溃恢复的持久件，不能在宿主已打开时
   *   反向否定活锁；也不能用“最新会话”替代它。
   */
  const liveWorkspace = live
    .filter(({ id, lockPath }) => names.includes(id)
      && lockPath.startsWith(`${dir}/`) && lockPath.endsWith('/session.lock'))
    .map(({ id }) => id)
  let bestLive
  let bestLiveAt = -1
  for (const n of liveWorkspace) {
    let at = 0
    try { at = statSync(join(dir, n)).mtimeMs } catch { at = 0 }
    if (at > bestLiveAt) { bestLiveAt = at; bestLive = n }
  }
  /**
   * ⚠ 只有**当前宿主真的持有 session.lock** 的会话才能作为“有对象”的探针输入。
   *   header.cwd / 目录最新只能证明“这是本工作区的持久会话”，不能证明它仍在
   *   宿主内存里；拿它去测路由会稳定得到 `ledger-unreadable`，把环境问题伪装成产品红。
   */
  if (bestLive === undefined) return undefined
  return {
    id: bestLive,
    source: '活宿主持有 session.lock（锁路径工作区匹配；单次快照）',
  }
}

const launch = readLaunch()
if (launch === undefined) {
  console.log('  ⚠ **noObject**：日志里找不到 `dsh web: http://…/?token=…` 那一行')
  console.log(`       ⇒ 试过这些日志：${[...liveHostStdoutLogs(), ...LOG_CANDIDATES].join(' · ')}`)
  console.log('       ⇒ 宿主没起来 / 不是 `dsh web` 启的 / 日志被轮转 ⇒ **本条未执行、不算通过**')
  console.log('')
  console.log('H 组：通过 0 · 失败 0')
  console.log('处级口径：查了 0 处 · 过了 0 处 · **跳过 2 处**（noObject）')
  console.log('')
  console.log('  ⛔ exit 2 —— 没对象（⛔ 不是通过）')
  process.exit(2)
}

const base = `http://127.0.0.1:${launch.port}`
console.log(`  读数：token 来自 ${launch.from}（长度 ${launch.token.length}）· 目标 ${base}`)

// ── 换 cookie ────────────────────────────────────────────────────────────
let cookie = ''
try {
  const res = await fetch(`${base}/connect?token=${encodeURIComponent(launch.token)}`, { redirect: 'manual' })
  const sc = res.headers.getSetCookie?.() ?? []
  const raw = sc.length > 0 ? sc.join(';') : (res.headers.get('set-cookie') ?? '')
  const m = /(dsh-auth-[^=]+=[^;]+)/.exec(raw)
  if (m === null) {
    console.log(`  ⚠ **noObject**：/connect 没回 dsh-auth cookie（HTTP ${res.status}）`)
    console.log('       ⇒ 可能 token 已过期 / 宿主已重启 ⇒ **本条未执行、不算通过**')
    console.log('')
    console.log('  ⛔ exit 2 —— 没对象（⛔ 不是通过）')
    process.exit(2)
  }
  cookie = m[1]
  ok(`凭据就绪：/connect 回了 dsh-auth cookie（HTTP ${res.status}）`)
} catch (e) {
  console.log(`  ⚠ **noObject**：连不上 ${base}（${String(e?.message ?? e)}）`)
  console.log('       ⇒ 宿主没在跑 / 端口不对 ⇒ **本条未执行、不算通过**')
  console.log('')
  console.log('  ⛔ exit 2 —— 没对象（⛔ 不是通过）')
  process.exit(2)
}

// ── ① POST ⇒ 200 + JSON ──────────────────────────────────────────────────
/**
 * ⚠ 显式 `--session` 优先；不给才走**启发式**（见头注释）。
 * 来源会打进读数行，⛔ 不许让"猜的"和"给的"看起来一样。
 */
/**
 * ⚠ 显式 `--session` 时**不再跑启发式**：那条启发式会扫 `/proc/<pid>/fd` 与
 *   全部会话目录；在 WSL / 管道启动等环境下可能长时间阻塞，而结果又会被
 *   显式值覆盖 ⇒ 等于白扫。这里按调用方给的值直接用，来源仍照实打印。
 */
const foundSession = SESSION_OVERRIDE !== '' ? undefined : findWorkspaceSessionId()
const sessionId = SESSION_OVERRIDE !== '' ? SESSION_OVERRIDE : foundSession?.id
const sessionSource = SESSION_OVERRIDE !== ''
  ? '显式 --session'
  : (foundSession?.source ?? '启发式（本工作区最新会话）')
/**
 * Missing a workspace session is not grounds to skip authentication and
 * negative-path checks. Those checks do not need a live session; only the
 * positive snapshot/stream assertions do. Probe them before deciding noObject.
 */
const hasSession = sessionId !== undefined
if (hasSession) console.log(`  读数：sessionId = ${sessionId}（来源：${sessionSource}）`)
else console.log('  ⚠ **noObject（正向快照/流）**：本工作区找不到 sessionId ⇒ 正向路由断言无对象；先跑不依赖会话的边界断言')

// ── 边界断言（不需要活会话；在 noObject 退出之前跑）─────────────────────
{
  const cases = [
    ['缺 sessionId', { ledger: 'dsh-hob' }, 400, 'no-session'],
    ['路径穿越账本', { sessionId: sessionId ?? 'session-boundary-probe', ledger: '../dsh-hob' }, 400, 'ledger-not-allowed'],
  ]
  const seen = []
  const problems = []
  for (const [label, body, wantStatus, wantReason] of cases) {
    const res = await fetch(`${base}${LIVE_ROUTE}`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body),
    })
    const text = await res.text()
    let parsed
    try { parsed = JSON.parse(text) } catch { parsed = undefined }
    seen.push(`${label}=${res.status}/${parsed?.reason ?? 'no-json'}`)
    if (res.status !== wantStatus) problems.push(`${label} 状态码 ${res.status}（期望 ${wantStatus}）`)
    else if (parsed?.ok !== false || parsed?.reason !== wantReason) {
      problems.push(`${label} reason=${JSON.stringify(parsed?.reason)}（期望 ${wantReason}）`)
    }
  }
  if (problems.length === 0) ok(`H-0b ✓ 实时通道边界可判（不需要活会话）：${seen.join(' · ')}`)
  else for (const p of problems) bad(`H-0b · ${p}`)
}

if (!hasSession && CATALOG_ONLY) {
  /**
   * Catalog-only mode needs no live session: list the real ledgers directly and
   * prove the realtime route's authentication boundary. It is still opt-in so
   * a normal `check:tasks-route-http` remains an honest noObject without one.
   */
  const ledgerRes = await fetch(`${base}${LEDGERS_ROUTE}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({}),
  })
  const ledgerText = await ledgerRes.text()
  let ledgerBody
  try { ledgerBody = JSON.parse(ledgerText) } catch { ledgerBody = undefined }
  console.log(`  ── POST ${LEDGERS_ROUTE}（catalog-only）⇒ HTTP ${ledgerRes.status}`)
  console.log(`     响应体前 300 字：${ledgerText.slice(0, 300)}`)
  if (ledgerRes.status !== 200 || ledgerBody?.ok !== true || !Array.isArray(ledgerBody.items)) {
    bad(`H-cat · 账本目录不可达：status=${ledgerRes.status} reason=${JSON.stringify(ledgerBody?.reason)}`)
  } else {
    const names = ledgerBody.items.map((x) => String(x?.name ?? ''))
    ok(`H-cat ✓ 账本目录可达：${ledgerBody.items.length} 个（${names.slice(0, 6).join(' · ')}${names.length > 6 ? ' …' : ''}）`)
  }
  /**
   * A fake session id with a ledger selected is expected to establish a
   * whitelisted ledger stream: the ledger name, not the session, selects the
   * watched root. Do not hang on its body; read the hello then abort.
   */
  const liveCtl = new AbortController()
  const liveTimer = setTimeout(() => liveCtl.abort(), 1500)
  let liveHello = ''
  let liveStatus = 0
  let liveType = ''
  try {
    const liveRes = await fetch(`${base}${LIVE_ROUTE}`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ sessionId: 'session-probe-no-session', ledger: 'dsh-hob' }),
      signal: liveCtl.signal,
    })
    liveStatus = liveRes.status
    liveType = liveRes.headers.get('content-type') ?? ''
    if (liveRes.body !== null) {
      const reader = liveRes.body.getReader()
      const first = await reader.read()
      liveHello = first.done === true ? '' : new TextDecoder().decode(first.value)
      liveCtl.abort()
      await reader.cancel().catch(() => {})
    }
  } catch (e) {
    if (!(liveCtl.signal.aborted && liveHello !== '')) {
      bad(`H-cat-live · 实时通道请求失败：${String(e?.message ?? e)}`)
    }
  } finally {
    clearTimeout(liveTimer)
  }
  if (liveStatus === 200 && liveType.includes('text/event-stream') && liveHello.startsWith('event: hello\n')) {
    ok('H-cat-live ✓ 实时通道路由已登记：带白名单账本返回 SSE hello；读取首帧后主动断开（不等待无限流）')
  } else {
    bad(`H-cat-live · status=${liveStatus} type=${liveType} hello=${JSON.stringify(liveHello.slice(0, 80))}`)
  }
  let helloBody
  try { helloBody = JSON.parse(liveHello.split('\n').find((l) => l.startsWith('data: '))?.slice(6) ?? '') } catch { helloBody = undefined }
  if (helloBody?.ledger === 'dsh-hob') {
    ok('H-cat-live2 ✓ 显式选择 dsh-hob ⇒ hello.ledger 逐字为 dsh-hob（项目切换不串账本）')
  } else {
    bad(`H-cat-live2 · 显式 dsh-hob 的 hello.ledger=${JSON.stringify(helloBody?.ledger)}`)
  }
  /**
   * Verify the live subscription limit through the real authenticated route:
   * 8 per ledger is accepted, the 9th gets a readable error frame. Abort every
   * stream afterwards and open one more to prove teardown released the slots.
   */
  const opened = []
  const openOne = async () => {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 1500)
    try {
      const res = await fetch(`${base}${LIVE_ROUTE}`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ sessionId: 'session-probe-limit', ledger: 'dsh-hob' }), signal: ctl.signal,
      })
      if (res.body === null) return { ctl, text: '' }
      const reader = res.body.getReader()
      const first = await reader.read()
      return { ctl, reader, text: first.done === true ? '' : new TextDecoder().decode(first.value) }
    } finally {
      clearTimeout(timer)
    }
  }
  for (let i = 0; i < 8; i++) opened.push(await openOne())
  const ninth = await openOne()
  const accepted = opened.filter((s) => s.text.startsWith('event: hello\n')).length
  const limited = ninth.text.startsWith('event: error\n') && ninth.text.includes('subscriber-limit')
  if (accepted === 8 && limited) {
    ok('H-cat-live3 ✓ 真路由订阅上限：同一账本 8 条 hello 成功，第 9 条返回可读 subscriber-limit 错误帧')
  } else {
    bad(`H-cat-live3 · accepted=${accepted} ninth=${JSON.stringify(ninth.text.slice(0, 120))}`)
  }
  for (const s of [...opened, ninth]) {
    s.ctl.abort()
    await s.reader?.cancel().catch(() => {})
  }
  await new Promise((resolve) => setTimeout(resolve, 100))
  const afterRelease = await openOne()
  if (afterRelease.text.startsWith('event: hello\n')) {
    ok('H-cat-live4 ✓ 全部断开后槽位已释放：第 10 次连接重新拿到 hello（没有泄漏订阅）')
  } else {
    bad(`H-cat-live4 · 断开后仍拿不到 hello：${JSON.stringify(afterRelease.text.slice(0, 120))}`)
  }
  afterRelease.ctl.abort()
  await afterRelease.reader?.cancel().catch(() => {})
  console.log('')
  console.log(`H 组：通过 ${pass} · 失败 ${fail}`)
  console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处${fail > 0 ? ` · 没过 ${fail} 处` : ''} · 跳过 0 处（catalog-only）`)
  if (fail > 0) process.exit(1)
  process.exit(0)
}

/**
 * A no-session run still proved the realtime security boundary. If that
 * boundary is correct we can exit 2 only after reporting the noObject result,
 * never by silently skipping the checks.
 */
if (!hasSession) {
  console.log('  ⚠ **noObject**：本工作区的会话目录里找不到任何 session（拿不到 sessionId）')
  console.log('       ⇒ 正向快照/流断言未执行；H-0b 的鉴权与白名单边界已真实通过')
  console.log('')
  if (fail > 0) {
    console.log(`H 组：通过 ${pass} · 失败 ${fail}`)
    console.log('  ⛔ 有对象但不符合预期 ⇒ 真缺陷（exit 1）')
    process.exit(1)
  }
  console.log(`H 组：通过 ${pass} · 失败 0`)
  console.log(`处级口径：查了 ${pass} 处 · 过了 ${pass} 处 · **跳过 2 处**（noObject）`)
  console.log('  ⛔ exit 2 —— 正向对象缺失（⛔ 不是通过）')
  process.exit(2)
}

/**
 * ⚠ **宿主重启后内存里没有旧会话**：显式 `--session` 只是把 id 塞进请求体，
 *   不证明它仍在当前实例的 `sessions` 服务里。此时服务端按设计回
 *   `no-ledger-root` / `ledger-unreadable`。探针要把这种情形报成 `noObject`（exit 2），
 *   ⛔ 不许把它当成产品缺陷，也⛔ 不许把 400 当成通过。
 *   判据：本工作区**当前确实有活锁**，且显式 id 与它一致。
 */
if (SESSION_OVERRIDE !== '') {
  const liveNow = findWorkspaceSessionId()
  if (liveNow === undefined) {
    console.log('  ⚠ **noObject**：本工作区当前**没有任何活会话**（宿主重启后旧会话不在内存里）')
    console.log('       ⇒ 显式 `--session` 只给 id，不证明它在当前实例里；服务端会按设计回 400')
    console.log('       ⇒ 请先在 3080 里打开本工作区的一个会话，再复跑')
    console.log('')
    console.log('  ⛔ exit 2 —— 没对象（⛔ 不是通过）')
    process.exit(2)
  }
  if (liveNow.id !== SESSION_OVERRIDE) {
    console.log(`  ⚠ 显式 id 与当前活会话不一致：显式 ${SESSION_OVERRIDE} · 活 ${liveNow.id}`)
    console.log('       ⇒ 下面仍用显式 id 请求；若返回 400 需先核对是不是旧会话')
  }
}
{
  const res = await fetch(`${base}${ROUTE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ sessionId }),
  })
  console.log(`     请求体：${JSON.stringify({ sessionId })}`)
  const status = res.status
  const text = await res.text()
  const ctype = res.headers.get('content-type') ?? ''
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = undefined }
  console.log(`  ── POST ${ROUTE} ⇒ HTTP ${status} · content-type=${ctype}`)
  console.log(`     响应体前 200 字：${text.slice(0, 200)}`)
  const problems = []
  const retired = status === 410 && parsed !== undefined && parsed.ok === false && parsed.reason === 'route-retired'
  if (status !== 200 && !retired) problems.push(`状态码 ${status}（期望 200 或退役 410）`)
  if (parsed === undefined) problems.push('响应体不是 JSON')
  else if (typeof parsed !== 'object' || parsed === null) problems.push('JSON 不是对象')
  else if (retired) {
    if (!String(parsed.message ?? '').includes('/api/dsh-hob/stages')) problems.push('退役响应没有把调用方指向 /api/dsh-hob/stages')
  }
  else if (parsed.ok === true) {
    if (!Array.isArray(parsed.rows)) problems.push('ok:true 但 rows 不是数组')
    if (parsed.source !== 'volumes/tasks/INDEX.md') problems.push(`source 不对：${JSON.stringify(parsed.source)}`)
  } else if (parsed.ok === false) {
    const reasons = ['ledger-unreadable', 'table-missing', 'row-shape-unknown']
    if (!reasons.includes(parsed.reason)) problems.push(`ok:false 但 reason 不是三选一：${JSON.stringify(parsed.reason)}`)
  } else problems.push('JSON 里既没有 ok:true 也没有 ok:false')
  if (problems.length === 0 && retired) ok('H-1 ✓ POST 旧接口 ⇒ 410 route-retired 且指向新接口（⛔ 不冒充账本损坏）')
  else if (problems.length === 0) ok(`H-1 ✓ POST ⇒ 200 + 我们的 JSON（ok=${parsed.ok}${parsed.ok === false ? ` · reason=${parsed.reason}` : ` · rows=${parsed.rows.length}`}）`)
  else for (const p of problems) bad(`H-1 · ${p}`)
}

// ── ② GET ⇒ 404 + 纯文本 not found（宿主既有语义，钉住它）────────────────
{
  const res = await fetch(`${base}${ROUTE}`, { method: 'GET', headers: { cookie } })
  const status = res.status
  const text = await res.text()
  const ctype = res.headers.get('content-type') ?? ''
  console.log(`  ── GET  ${ROUTE} ⇒ HTTP ${status} · content-type=${ctype}`)
  console.log(`     响应体前 200 字：${text.slice(0, 200)}`)
  const problems = []
  if (status !== 404) problems.push(`状态码 ${status}（期望 404 —— 宿主对"方法不匹配"回 404 而不是 405）`)
  if (text.trim() !== 'not found') problems.push(`响应体不是纯文本 "not found"：${JSON.stringify(text.slice(0, 60))}`)
  if (!/text\/plain/.test(ctype)) problems.push(`content-type 不是 text/plain：${JSON.stringify(ctype)}`)
  if (problems.length === 0) ok(`H-2 ✓ GET ⇒ 404 + 纯文本 "not found"（⛔ 不是 405、不是 JSON —— 这条边界被钉住了）`)
  else for (const p of problems) bad(`H-2 · ${p}`)
}

// ── ③ 不存在的 sessionId ⇒ ok:false 且 reason **必须恰好**是 ledger-unreadable ──
{
  /**
   * ⚠⚠ **不许接受"任何 ok:false 都算过"**（任务书 §2 明确）。
   *   理由：`ok:false` 有三类可分辨 reason（`ledger-unreadable` / `table-missing` /
   *   `row-shape-unknown`）。拿"是 ok:false"当通过 ⇒ 这条断言对"reason 归类坏了"
   *   完全瞎。⇒ 本断言钉死 **`reason === 'ledger-unreadable'`**，并把实际值印出来。
   * ⚠ 用一个**不可能存在**的 id（带随机后缀，与任何真会话都不撞）。
   */
  const ghostId = `session-nonexistent-${Date.now().toString(36)}`
  const res = await fetch(`${base}${ROUTE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ sessionId: ghostId }),
  })
  const status = res.status
  const text = await res.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = undefined }
  console.log(`  ── POST ${ROUTE}（不存在的 sessionId=${ghostId}）⇒ HTTP ${status}`)
  console.log(`     响应体前 200 字：${text.slice(0, 200)}`)
  const problems = []
  /**
   * ⚠ 旧接口现在**先判退役、再判会话**：任何 sessionId 都应得到
   *   `route-retired`。这里保留“不存在的会话不猜账本”的语义，
   *   但把它改成能识别的退役档，⛔ 不把旧接口的 410 说成 ledgers 读坏。
   */
  const retiredGhost = status === 410 && parsed?.ok === false && parsed?.reason === 'route-retired'
  if (parsed === undefined) problems.push('响应体不是 JSON')
  else if (retiredGhost) {
    if (!String(parsed.message ?? '').includes('/api/dsh-hob/stages')) problems.push('退役响应没有指向 /api/dsh-hob/stages')
  }
  else {
    if (parsed.ok !== false) problems.push(`ok 不是 false：${JSON.stringify(parsed.ok)}`)
    // ⚠ 这一条是**精确值**断言，⛔ 不是"三选一"、⛔ 不是"只要 ok:false"
    if (parsed.reason !== 'ledger-unreadable') problems.push(`reason 不是恰好 ledger-unreadable：${JSON.stringify(parsed.reason)}`)
    if (typeof parsed.message !== 'string' || parsed.message.trim() === '') problems.push('没有给 message（"判不出"必须带一句原因）')
  }
  if (problems.length === 0 && retiredGhost) ok('H-3 ✓ 退役旧接口对不存在会话也先回 route-retired（⛔ 不猜账本、不冒充读坏）')
  else if (problems.length === 0) ok('H-3 ✓ **负向对拍**：不存在的 sessionId ⇒ ok:false · reason **恰好** ledger-unreadable（⛔ 不是"任何 ok:false 都算过"）')
  else for (const p of problems) bad(`H-3 · ${p}`)
}

// ── ④ Current 资源 ⇒ 可判定的三种结果（材料不存在 ≠ 接口坏）──────────────
{
  const res = await fetch(`${base}${RESOURCE_ROUTE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ sessionId, resource: 'current' }),
  })
  const status = res.status
  const text = await res.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = undefined }
  console.log(`  ── POST ${RESOURCE_ROUTE}（resource=current）⇒ HTTP ${status}`)
  console.log(`     响应体前 200 字：${text.slice(0, 200)}`)
  const problems = []
  const materialsMissing = parsed !== undefined && parsed.ok === false && parsed.reason === 'not-found'
    && /Current 页不存在|先运行 npm run gen:ledger/.test(String(parsed.message ?? ''))
  if (status !== 200 && !(status === 400 && materialsMissing)) problems.push(`状态码 ${status}（期望 200；账本未生成 Current 时允许 400/not-found）`)
  if (parsed === undefined || typeof parsed !== 'object' || parsed === null) problems.push('响应体不是 JSON 对象')
  else if (!materialsMissing) {
    if (parsed.ok !== true) problems.push(`ok 不是 true：${JSON.stringify(parsed.ok)}（${String(parsed.reason ?? '')}）`)
    if (parsed.resource !== 'current') problems.push(`resource 不是 current：${JSON.stringify(parsed.resource)}`)
    if (typeof parsed.text !== 'string' || parsed.text.trim() === '') problems.push('没有返回 Current 文本')
    if (typeof parsed.bytes !== 'number' || parsed.bytes <= 0) problems.push(`bytes 不是正数：${JSON.stringify(parsed.bytes)}`)
  }
  if (problems.length === 0 && materialsMissing) {
    ok('H-4 ✓ Current 资源路由可达；当前账本没有生成 Current ⇒ 400/not-found 可辨（⛔ 不冒充成可读文本）')
  } else if (problems.length === 0) {
    ok(`H-4 ✓ Current 资源可达（${parsed.bytes} bytes；响应不含本机绝对路径=${!(text.includes('/home/') || text.includes('\\\\wsl'))}）`)
  }
  else for (const p of problems) bad(`H-4 · ${p}`)
}

// ── ⑤ 按 ID 读取需求 ⇒ 当前账本里真实存在的需求 ─────────────────────────
{
  /**
   * ⚠ 不许拿历史账本的固定 ID 当探针对象：当前工作区账本可以没有 R-009。
   *   先按当前账本列表取一条真实 requirement；取不到 ⇒ noObject（⛔ 不伪造通过）。
   */
  const listRes = await fetch(`${base}${RESOURCE_ROUTE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ sessionId, resource: 'requirements' }),
  })
  const listText = await listRes.text()
  let listParsed
  try { listParsed = JSON.parse(listText) } catch { listParsed = undefined }
  const reqId = Array.isArray(listParsed?.children)
    ? String(listParsed.children.find((c) => typeof c?.id === 'string' && c.id.startsWith('R-'))?.id ?? '')
    : (Array.isArray(listParsed?.cards)
      ? String(listParsed.cards.find((c) => typeof c?.id === 'string' && c.id.startsWith('R-'))?.id ?? '')
      : (Array.isArray(listParsed?.items) ? String(listParsed.items[0]?.id ?? '') : ''))
  if (reqId === '') {
    console.log('  ⚠ **noObject**：当前账本读不到任何 requirement ⇒ H-5 无对象（不算通过）')
  } else {
  const resource = `requirement/${reqId}`
  const res = await fetch(`${base}${RESOURCE_ROUTE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ sessionId, resource }),
  })
  const status = res.status
  const text = await res.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = undefined }
  console.log(`  ── POST ${RESOURCE_ROUTE}（resource=${resource}）⇒ HTTP ${status}`)
  console.log(`     响应体前 240 字：${text.slice(0, 240)}`)
  const problems = []
  if (status !== 200) problems.push(`状态码 ${status}（期望 200）`)
  if (parsed === undefined || typeof parsed !== 'object' || parsed === null) problems.push('响应体不是 JSON 对象')
  else {
    if (parsed.ok !== true) problems.push(`ok 不是 true：${JSON.stringify(parsed.ok)}（${String(parsed.reason ?? '')}）`)
    if (parsed.resource !== resource) problems.push(`resource 回显不对：${JSON.stringify(parsed.resource)}`)
    if (parsed.card?.id !== reqId) problems.push(`card.id 不是 ${reqId}：${JSON.stringify(parsed.card?.id)}`)
    if (parsed.card?.read !== resource) problems.push(`card.read 不是稳定读取指针：${JSON.stringify(parsed.card?.read)}`)
    if (!Array.isArray(parsed.children)) problems.push('children 不是数组')
    if (text.includes('/home/') || text.includes('\\\\wsl')) problems.push('响应泄露了本机绝对路径')
  }
  if (problems.length === 0) ok(`H-5 ✓ 按 ID 读取 ${resource} ⇒ 200 + 摘要卡与 ${parsed.children.length} 个正式关联项（⛔ 不内联正文）`)
  else for (const p of problems) bad(`H-5 · ${p}`)
  }
}

// ── ⑤b 旧 `/tasks-progress` 已退役：必须给可辨的退役原因，⛔ 不许伪装成账本读坏 ──
{
  const res = await fetch(`${base}${ROUTE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ sessionId }),
  })
  const status = res.status
  const text = await res.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = undefined }
  console.log(`  ── POST 旧 ${ROUTE}（退役兼容）⇒ HTTP ${status}`)
  console.log(`     响应体前 240 字：${text.slice(0, 240)}`)
  const p = []
  if (status !== 410) p.push(`状态码=${status}（期望 410）`)
  if (parsed === undefined || typeof parsed !== 'object' || parsed === null) p.push('响应体不是 JSON 对象')
  else {
    if (parsed.ok !== false) p.push(`退役接口仍报 ok:true：${JSON.stringify(parsed.ok)}`)
    if (parsed.reason !== 'route-retired') p.push(`reason=${JSON.stringify(parsed.reason)}（期望 route-retired）`)
    if (!String(parsed.message ?? '').includes('/api/dsh-hob/stages')) p.push('没有把调用方指向新接口 /api/dsh-hob/stages')
  }
  if (p.length === 0) ok('H-1b ✓ 旧 /tasks-progress ⇒ 可辨的 route-retired，并指向 /api/dsh-hob/stages（⛔ 不冒充账本损坏）')
  else for (const x of p) bad(`H-1b · ${x}`)
}

// ── ⑥ 五步汇总 ⇒ 200 + 固定顺序 + attention 字段 ───────────────────────
{
  /**
   * ⚠ 新面板显式请求紧凑模式；默认请求仍保留旧 `title` / `extra` 供旧消费方读取。
   *   本探针验的是新面板这条线，因此必须发同一个 `compact:true`。
   */
  const res = await fetch(`${base}${STAGES_ROUTE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ sessionId, compact: true }),
  })
  const status = res.status
  const text = await res.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = undefined }
  console.log(`  ── POST ${STAGES_ROUTE}（compact=true）⇒ HTTP ${status}`)
  console.log(`     响应体前 240 字：${text.slice(0, 240)}`)
  const problems = []
  if (status !== 200) problems.push(`状态码 ${status}（期望 200）`)
  if (parsed === undefined || typeof parsed !== 'object' || parsed === null) problems.push('响应体不是 JSON 对象')
  else if (parsed.ok !== true) {
    problems.push(`ok 不是 true：${JSON.stringify(parsed.reason ?? parsed.ok)}`)
  } else {
    const want = [
      [1, '需求规格'], [2, '实现方案'], [3, '任务图'], [4, '任务执行'],
      [5, '技术验证'], [6, '产品验收'], [7, '交付收口'],
    ]
    const got = Array.isArray(parsed.stages) ? parsed.stages.map((s) => [s.step, s.name]) : []
    if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`七阶段顺序/名字不对：${JSON.stringify(got)}`)
    if (!('attention' in parsed)) problems.push('响应里没有 attention 字段（算不出也应为 undefined，但键必须可被路由层观测）')
    else if (parsed.attention !== undefined && !Array.isArray(parsed.attention)) problems.push('attention 存在但不是数组')
    const bytes = Buffer.byteLength(text, 'utf8')
    if (bytes > 65536) problems.push(`响应体 ${bytes} B > 65536 B`)
    if (typeof parsed.relations !== 'object' || parsed.relations === null) problems.push('响应里没有共享关系标题表 relations')
    const items = Array.isArray(parsed.stages) ? parsed.stages.flatMap((s) => Array.isArray(s.items) ? s.items : []) : []
    if (items.length === 0) problems.push('七阶段条目为空 ⇒ 体积/投影断言没有对象')
    for (const item of items) {
      if ('title' in item || 'extra' in item) { problems.push(`${item.id} 仍重复返回旧 title/extra`); break }
      const pr = item.presentation
      if (pr === null || typeof pr !== 'object') { problems.push(`${item.id} 缺列表投影`); break }
      if ('originalTitle' in pr || 'details' in pr) { problems.push(`${item.id} 列表内联了原句或详情`); break }
      if (Array.isArray(pr.facts) && pr.facts.length > 2) { problems.push(`${item.id} 折叠读数超过两条`); break }
      if (pr.relation !== null && typeof pr.relation.title === 'string') { problems.push(`${item.id} 关系行内联了父标题`); break }
    }
    /**
     * ⚠ 关系标题表是**按当前账本现算**，⛔ 不许拿某一天的真账本编号当“永远必须存在”：
     *   当前工作区是 `prompt-enhancer-release` 时，`TSK-078` 与 `ACC-064` 当然不在。
     *   本探针要证明的是“关系表与当前条目逐项可回指”，不是“某个历史 ID 永恒存在”。
     */
    const relationItems = items.filter((x) => x?.presentation?.relation?.id !== null
      && x?.presentation?.relation?.id !== undefined)
    const missingRelations = relationItems
      .filter((x) => parsed.relations?.[x.presentation.relation.id] === undefined)
      .map((x) => `${x.id}→${x.presentation.relation.id}`)
    if (missingRelations.length > 0) {
      problems.push(`共享关系标题表缺当前条目的父标题：${missingRelations.slice(0, 5).join(' / ')}`)
    }
    if (problems.length === 0) {
      const acc = items.find((x) => x.kind === 'acc')
      if (acc === undefined) problems.push('当前账本没有 acc 条目 ⇒ 验收投影断言没有对象')
      else {
        if (typeof acc.presentation?.displayTitle !== 'string' || acc.presentation.displayTitle === '') {
          problems.push(`当前 ACC 没有可读主标题：${JSON.stringify(acc.presentation?.displayTitle)}`)
        }
        if (acc.presentation?.relation?.id === null || acc.presentation?.relation?.id === undefined) {
          problems.push(`当前 ACC 的正式关系判不出：${JSON.stringify(acc.presentation?.relation)}`)
        }
        if (acc.presentation?.facts?.length !== 2) problems.push(`当前 ACC 没有两条关键读数：${JSON.stringify(acc.presentation?.facts)}`)
        if (acc.presentation?.facts?.[0]?.[0] !== '判决' || acc.presentation?.facts?.[1]?.[0] !== '依据') {
          problems.push(`当前 ACC 折叠读数不是固定的「判决 + 依据」：${JSON.stringify(acc.presentation?.facts)}`)
        }
      }
    }
    if (problems.length === 0) ok(`H-6 ✓ 七阶段汇总 ⇒ 200 + 阶段顺序固定 + attention ${parsed.attention === undefined ? '判不出（字段缺省）' : `${parsed.attention.length} 条`} + ${bytes} B ≤ 65536 B + 条目紧凑投影（${items.length} 条 · 关系标题 ${Object.keys(parsed.relations).length} 个）`)
  }
  if (problems.length > 0) for (const p of problems) bad(`H-6 · ${p}`)
}

// ── ⑥b 默认五步响应仍保留旧字段（兼容面）─────────────────────────────────
{
  const res = await fetch(`${base}${STAGES_ROUTE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ sessionId }),
  })
  const status = res.status
  const text = await res.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = undefined }
  console.log(`  ── POST ${STAGES_ROUTE}（默认兼容）⇒ HTTP ${status}`)
  const problems = []
  const items = parsed !== undefined && typeof parsed === 'object' && parsed !== null && Array.isArray(parsed.stages)
    ? parsed.stages.flatMap((s) => Array.isArray(s.items) ? s.items : [])
    : []
  if (status !== 200) problems.push(`状态码 ${status}（期望 200）`)
  if (parsed === undefined || typeof parsed !== 'object' || parsed === null || parsed.ok !== true) problems.push('默认响应不是 ok:true JSON 对象')
  else {
    const acc = items.find((x) => x.kind === 'acc')
    if (acc === undefined) problems.push('默认响应缺 acc 条目 ⇒ 兼容断言没有对象')
    else {
      if (typeof acc.title !== 'string' || acc.title === '') problems.push(`默认响应丢了 ${acc.id}.title：${JSON.stringify(acc.title)}`)
      if (typeof acc.extra !== 'string') problems.push(`默认响应丢了 ${acc.id}.extra：${JSON.stringify(acc.extra)}`)
      if (typeof acc.presentation?.displayTitle !== 'string' || acc.presentation.displayTitle === '') {
        problems.push(`默认响应缺 ${acc.id} 新投影：${JSON.stringify(acc.presentation?.displayTitle)}`)
      }
    }
  }
  if (problems.length === 0) {
    const acc = items.find((x) => x.kind === 'acc')
    ok(`H-6b ✓ 默认 /stages 保持兼容：${acc?.id ?? '(无 acc)'} 同时有旧 title/extra 与新 presentation（${Buffer.byteLength(text, 'utf8')} B）`)
  }
  else for (const p of problems) bad(`H-6b · ${p}`)
}

// ── ⑦ 工作计划只读路由 ⇒ 200 + 计划读数（⛔ 不推进、不写盘）──────────────
{
  const res = await fetch(`${base}${WORK_PLANS_ROUTE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ sessionId }),
  })
  const status = res.status
  const text = await res.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = undefined }
  console.log(`  ── POST ${WORK_PLANS_ROUTE} ⇒ HTTP ${status}`)
  console.log(`     响应体前 240 字：${text.slice(0, 240)}`)
  const problems = []
  if (status !== 200) problems.push(`状态码 ${status}（期望 200；404/405 说明路由没登记）`)
  if (parsed === undefined || typeof parsed !== 'object' || parsed === null) problems.push('响应体不是 JSON 对象')
  else {
    if (parsed.ok !== true) problems.push(`ok 不是 true：${JSON.stringify(parsed.reason ?? parsed.ok)}`)
    if (!Array.isArray(parsed.plans)) problems.push('plans 不是数组（⛔ 空表也必须是 []）')
    if (!Array.isArray(parsed.unreadable)) problems.push('unreadable 不是数组')
    if (typeof parsed.mode !== 'string') problems.push('mode 不是字符串')
    if (text.includes('/home/') || text.includes('\\\\wsl')) problems.push('响应泄露了本机绝对路径')
  }
  if (problems.length === 0) {
    ok(`H-7 ✓ 工作计划只读路由可达（${parsed.plans.length} 份活动计划 · 工作方式=${parsed.mode} · 读不出 ${parsed.unreadable.length}）`)
  } else for (const p of problems) bad(`H-7 · ${p}`)
}

// ── ⑧ 账本目录 ⇒ 200 + 三态 + 当前账本 ──────────────────────────────────
{
  const res = await fetch(`${base}${LEDGERS_ROUTE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ sessionId }),
  })
  const status = res.status
  const text = await res.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = undefined }
  console.log(`  ── POST ${LEDGERS_ROUTE} ⇒ HTTP ${status}`)
  console.log(`     响应体前 300 字：${text.slice(0, 300)}`)
  const problems = []
  if (status !== 200) problems.push(`状态码 ${status}（期望 200）`)
  if (parsed === undefined || typeof parsed !== 'object' || parsed === null) problems.push('响应体不是 JSON 对象')
  else {
    if (parsed.ok !== true) problems.push(`ok 不是 true：${JSON.stringify(parsed.reason ?? parsed.ok)}`)
    if (!Array.isArray(parsed.items)) problems.push('items 不是数组')
    /**
     * ⚠ `home` 是方案 §7.1 写定的回显字段（便于诊断），⛔ 不算泄露；
     *   这里只要求 `items` 不含路径。其他只读路由仍按零绝对路径断言。
     */
    const items = Array.isArray(parsed.items) ? parsed.items : []
    if (items.some((x) => JSON.stringify(x).includes('/home/') || JSON.stringify(x).includes('\\\\wsl'))) {
      problems.push('账本条目里泄露了绝对路径')
    }
    if (items.length === 0) problems.push('items 为空 ⇒ 账本目录路由没有可判对象')
    const valid = ['data', 'empty', 'unreadable']
    for (const it of items) {
      if (!valid.includes(it?.state)) { problems.push(`${it?.name} 的 state 非法：${JSON.stringify(it?.state)}`); break }
      if (it.state === 'unreadable' && (it.units !== 0 || it.readable !== false)) { problems.push(`${it.name} 读不了却不是 0 单元 / readable=false`); break }
      if (it.state === 'data' && it.units <= 0) { problems.push(`${it.name} 标 data 但 units=${it.units}`); break }
    }
    const cur = items.filter((x) => x.current === true)
    const hob = items.find((x) => x.name === 'dsh-hob')
    if (hob === undefined) problems.push('找不到真实账本 dsh-hob')
    else if (hob.state !== 'data') problems.push(`dsh-hob state=${JSON.stringify(hob.state)}（期望 data）`)
    if (parsed.currentResolved === true && cur.length !== 1) problems.push(`currentResolved=true 但 current 标记 ${cur.length} 个`)
    if (parsed.currentResolved === false && cur.length !== 0) problems.push('currentResolved=false 却仍标了 current')
  }
  if (problems.length === 0) {
    const counts = ['data', 'empty', 'unreadable'].map((k) => `${k} ${parsed.items.filter((x) => x.state === k).length}`).join(' · ')
    ok(`H-8 ✓ 账本目录可达：${parsed.items.length} 个（${counts}）· dsh-hob ${parsed.items.find((x) => x.name === 'dsh-hob').units} 单元 · currentResolved=${parsed.currentResolved}`)
  } else for (const p of problems) bad(`H-8 · ${p}`)
}

// ── ⑨ 需求链 ⇒ 200 + 唯一当前步 + 历史收口 ──────────────────────────────
{
  const res = await fetch(`${base}${CHAINS_ROUTE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ sessionId, ledger: 'dsh-hob' }),
  })
  const status = res.status
  const text = await res.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = undefined }
  console.log(`  ── POST ${CHAINS_ROUTE}（ledger=dsh-hob）⇒ HTTP ${status}`)
  console.log(`     响应体前 300 字：${text.slice(0, 300)}`)
  const problems = []
  if (status !== 200) problems.push(`状态码 ${status}（期望 200）`)
  if (parsed === undefined || typeof parsed !== 'object' || parsed === null) problems.push('响应体不是 JSON 对象')
  else if (parsed.ok !== true) problems.push(`ok 不是 true：${JSON.stringify(parsed.reason ?? parsed.ok)} ${String(parsed.message ?? '')}`)
  else {
    if (!Array.isArray(parsed.chains)) problems.push('chains 不是数组')
    const chains = Array.isArray(parsed.chains) ? parsed.chains : []
    const active = chains.filter((c) => c?.inFlight === true)
    const completed = chains.filter((c) => c?.state === 'completed')
    const retired = Array.isArray(parsed.retiredChains) ? parsed.retiredChains : []
    if (parsed.activeCount !== active.length) problems.push(`activeCount=${parsed.activeCount} 与活跃链 ${active.length} 不一致`)
    if (parsed.completedCount !== completed.length) problems.push(`completedCount=${parsed.completedCount} 与完成链 ${completed.length} 不一致`)
    if (parsed.retiredCount !== retired.length) problems.push(`retiredCount=${parsed.retiredCount} 与退役链 ${retired.length} 不一致`)
    if (active.length === 0) problems.push('当前真实账本没有在途需求 ⇒ 本条无法验证唯一当前步')
    for (const c of active) {
      const open = c.steps.filter((s) => s.displayState !== 'done')
      const currents = c.steps.filter((s) => s.step === c.currentStep)
      if (currents.length !== 1) problems.push(`${c.reqId} 当前步不是恰好一个：${JSON.stringify(c.currentStep)}`)
      if (open.length > 0 && open[0].step !== c.currentStep) problems.push(`${c.reqId} 当前步不是第一个未完成步`)
      if (!Number.isInteger(c.currentStep) || c.currentStep < 1 || c.currentStep > 5) problems.push(`${c.reqId} currentStep 越界：${JSON.stringify(c.currentStep)}`)
    }
    if (typeof parsed.historyItemCount !== 'number' || parsed.historyItemCount <= 0) problems.push(`historyItemCount 不是正数：${JSON.stringify(parsed.historyItemCount)}`)
  }
  if (problems.length === 0) {
    const r020 = parsed.chains.find((c) => c.reqId === 'R-020')
    ok(`H-9 ✓ 需求链可达：活跃 ${parsed.activeCount} · 完成 ${parsed.completedCount} · 退役 ${parsed.retiredCount} · 历史条目 ${parsed.historyItemCount}`
      + (r020 === undefined ? '' : ` · R-020 当前第 ${r020.currentStep} 步 → ${String(r020.next?.target ?? '—')}`))
  } else for (const p of problems) bad(`H-9 · ${p}`)
}

// ── ⑩ 非法账本名 ⇒ 400 ledger-not-allowed（四路同一白名单）──────────────
{
  const routes = [
    [STAGES_ROUTE, { sessionId, ledger: '../dsh-hob', compact: true }],
    [CHAINS_ROUTE, { sessionId, ledger: '../dsh-hob' }],
    [WORK_PLANS_ROUTE, { sessionId, ledger: '../dsh-hob' }],
    [RESOURCE_ROUTE, { sessionId, ledger: '../dsh-hob', resource: 'current' }],
  ]
  const problems = []
  const seen = []
  for (const [route, body] of routes) {
    const res = await fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    let parsed
    try { parsed = JSON.parse(text) } catch { parsed = undefined }
    seen.push(`${route.replace('/api/dsh-hob/', '')}=${res.status}/${parsed?.reason ?? 'no-json'}`)
    if (res.status !== 400) problems.push(`${route} 状态码 ${res.status}（期望 400）`)
    else if (parsed?.ok !== false || parsed?.reason !== 'ledger-not-allowed') {
      problems.push(`${route} 没有回 ledger-not-allowed：${JSON.stringify(parsed?.reason)}`)
    }
  }
  if (problems.length === 0) ok(`H-10 ✓ 路径穿越账本名被四路一致拒绝（${seen.join(' · ')}）`)
  else for (const p of problems) bad(`H-10 · ${p}`)
}

// ── ⑪ 实时失效通道 ⇒ SSE 首帧 + 超时断开清理 ─────────────────────────────
{
  const ctl = new AbortController()
  const timeout = setTimeout(() => ctl.abort(), 1500)
  const problems = []
  let status = 0
  let type = ''
  let helloText = ''
  try {
    const res = await fetch(`${base}${LIVE_ROUTE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ sessionId, ledger: 'dsh-hob' }),
      signal: ctl.signal,
    })
    status = res.status
    type = res.headers.get('content-type') ?? ''
    if (res.body === null) problems.push('响应没有 body')
    else {
      const reader = res.body.getReader()
      const first = await reader.read()
      helloText = first.done === true ? '' : new TextDecoder().decode(first.value)
      ctl.abort()
      await reader.cancel().catch(() => {})
    }
  } catch (e) {
    if (ctl.signal.aborted && helloText !== '') {
      // Abort after a successful hello is the expected teardown path.
    } else {
      problems.push(`请求失败：${String(e?.message ?? e)}`)
    }
  } finally {
    clearTimeout(timeout)
  }
  console.log(`  ── POST ${LIVE_ROUTE} ⇒ HTTP ${status} · content-type=${type}`)
  console.log(`     首帧前 240 字：${JSON.stringify(helloText.slice(0, 240))}`)
  if (status !== 200) problems.push(`状态码 ${status}（期望 200；404/405 说明实时路由没登记）`)
  if (!type.includes('text/event-stream')) problems.push(`content-type=${type}（期望 text/event-stream）`)
  if (!helloText.startsWith('event: hello\n')) problems.push('首帧不是 hello')
  else {
    let frame
    try { frame = JSON.parse(helloText.split('\n').find((l) => l.startsWith('data: '))?.slice(6) ?? '') } catch { frame = undefined }
    if (frame === undefined || typeof frame !== 'object') problems.push('hello 没有 JSON data')
    else {
      if (frame.ledger !== 'dsh-hob') problems.push(`hello.ledger=${JSON.stringify(frame.ledger)}（期望 dsh-hob）`)
      if (!Number.isSafeInteger(frame.revision)) problems.push(`hello.revision 不是整数：${JSON.stringify(frame.revision)}`)
      if (frame.heartbeatMs !== 20000) problems.push(`hello.heartbeatMs=${JSON.stringify(frame.heartbeatMs)}（期望 20000）`)
    }
  }
  if (problems.length === 0) ok('H-11 ✓ 实时通道可达：200 + text/event-stream，首帧 hello 带账本名 / 序号 / 心跳；断开后探针关闭连接')
  else for (const p of problems) bad(`H-11 · ${p}`)
}

console.log('')
console.log(`H 组：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处`
  + (fail > 0 ? ` · 没过 ${fail} 处` : '')
  + ' · **跳过 0 处**（⚠ 本档要活宿主 + token；无对象走 exit 2）')
console.log('')
if (fail > 0) {
  console.log('  ⛔ 有对象但不符合预期 ⇒ 真缺陷（exit 1）')
  process.exit(1)
}
console.log('  ✅ H 组全绿（⚠ 按需档：只在有活宿主时才有意义）')
process.exit(0)
