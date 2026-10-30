#!/usr/bin/env node
/**
 * **任务进度路由 · 真机 HTTP 探针（按需档）** —— 2026-10-29 · 第 10 轮。
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
 * ══ 退出码三档（⚠ 三档必须可分辨，⛔ 不许把 2 当 0）══════════════════════════
 *   0 = 两条都符合预期
 *   1 = **有对象但不符合**（真缺陷：路由没注册 / 方法白名单不对 / 响应形状变了）
 *   2 = **拿不到活宿主或 token** ⇒ `noObject`，明说"没对象"，⛔ 不算通过
 *
 * ══ 参数 ═══════════════════════════════════════════════════════════════════
 *   `--session <id>` —— 指定 POST 用的会话 id。
 *   ⚠ **不给才退回"最新会话"启发式**：从 `~/.dsh/sessions/<cwd 编码>/` 里挑 mtime 最新的
 *     那个目录名。⚠ **那是启发式，不是权威来源** —— 多会话并行、旧会话已从宿主内存
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

const ROUTE = '/api/dsh-hob/tasks-progress'
const DEFAULT_PORT = 3080

/**
 * 命令行参数：`--session <id>`（可省）。
 * ⚠ 解析刻意极简：只认这一个旗标，别的参数一律忽略（⛔ 不引第三方解析器）。
 */
const argv = process.argv.slice(2)
const sessionArgIndex = argv.indexOf('--session')
const SESSION_OVERRIDE = sessionArgIndex >= 0 ? (argv[sessionArgIndex + 1] ?? '') : ''

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
console.log('H 组：任务进度路由 · 真机 HTTP 探针（**按需档**，不在 check:all 必跑里）')
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
      if (link !== '' && existsSync(link)) out.push(link)
    } catch { /* 忽略 */ }
  }
  return out
}

function readLaunch() {
  const candidates = [...liveHostStdoutLogs(), ...LOG_CANDIDATES]
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
  return best
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
const sessionId = SESSION_OVERRIDE !== '' ? SESSION_OVERRIDE : findWorkspaceSessionId()
const sessionSource = SESSION_OVERRIDE !== '' ? '显式 --session' : '启发式（本工作区最新会话）'
if (sessionId === undefined) {
  console.log('  ⚠ **noObject**：本工作区的会话目录里找不到任何 session（拿不到 sessionId）')
  console.log(`       ⇒ 服务端会按设计回 400 ledger-unreadable（"没给工作区根"），那不是"数据通了"`)
  console.log('       ⇒ **本条未执行、不算通过**')
  console.log('')
  console.log('  ⛔ exit 2 —— 没对象（⛔ 不是通过）')
  process.exit(2)
}
console.log(`  读数：sessionId = ${sessionId}（来源：${sessionSource}）`)
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
  if (status !== 200) problems.push(`状态码 ${status}（期望 200）`)
  if (parsed === undefined) problems.push('响应体不是 JSON')
  else if (typeof parsed !== 'object' || parsed === null) problems.push('JSON 不是对象')
  else if (parsed.ok === true) {
    if (!Array.isArray(parsed.rows)) problems.push('ok:true 但 rows 不是数组')
    if (parsed.source !== 'volumes/tasks/INDEX.md') problems.push(`source 不对：${JSON.stringify(parsed.source)}`)
  } else if (parsed.ok === false) {
    const reasons = ['ledger-unreadable', 'table-missing', 'row-shape-unknown']
    if (!reasons.includes(parsed.reason)) problems.push(`ok:false 但 reason 不是三选一：${JSON.stringify(parsed.reason)}`)
  } else problems.push('JSON 里既没有 ok:true 也没有 ok:false')
  if (problems.length === 0) ok(`H-1 ✓ POST ⇒ 200 + 我们的 JSON（ok=${parsed.ok}${parsed.ok === false ? ` · reason=${parsed.reason}` : ` · rows=${parsed.rows.length}`}）`)
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
  if (parsed === undefined) problems.push('响应体不是 JSON')
  else {
    if (parsed.ok !== false) problems.push(`ok 不是 false：${JSON.stringify(parsed.ok)}`)
    // ⚠ 这一条是**精确值**断言，⛔ 不是"三选一"、⛔ 不是"只要 ok:false"
    if (parsed.reason !== 'ledger-unreadable') problems.push(`reason 不是恰好 ledger-unreadable：${JSON.stringify(parsed.reason)}`)
    if (typeof parsed.message !== 'string' || parsed.message.trim() === '') problems.push('没有给 message（"判不出"必须带一句原因）')
  }
  if (problems.length === 0) ok('H-3 ✓ 不存在的 sessionId ⇒ ok:false · reason **恰好** ledger-unreadable（⛔ 不是"任何 ok:false 都算过"）')
  else for (const p of problems) bad(`H-3 · ${p}`)
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
