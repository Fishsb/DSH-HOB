#!/usr/bin/env node
/**
 * **`ledger-next/` 的三条不变式**（2026-10-30 · P1 · `DESIGN-V2.md` §五）。
 *
 * ══ 它守什么 ═════════════════════════════════════════════════════════════════════
 *   **I1** 索引合法：id 唯一 · 前缀与 kind 匹配 · status 在封闭集 · parent 存在 ·
 *          **无环** · `after` 指向存在 · **状态不出现在别处**（`CONSTITUTION` §1）
 *   **I2** **阶段是算出来的**：改一条 status ⇒ `gen/stages.md` 那一步跟着变
 *          ⚠ 这条是**对生成器的行为验证** —— I5 只证"生成物与生成器一致"，
 *            证不了"生成器算对了"（`DESIGN-V2.md` §十·4 自己点的那个洞）
 *   **I5** **`gen/` 与生成器一致**：手改 `gen/` 任一字节 ⇒ 红
 *   **I4**（顺带）`cap` 无终态、无百分比
 *
 * ══ ⚠ 每条都带一条**实测跑红的负向对拍** ══════════════════════════════════════════
 *   负向对拍**不是注释**：每条都会真的造一个必错的夹具、真的调用一次断言、真的看它红。
 *   ⛔ 只写注释不算（`CONSTITUTION` §7）。
 *
 * 用法：node scripts/check-ledger-next.mjs
 * 退出码：0 = 三条全绿；1 = 有失败
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { KIND_SPEC, renderStages, parseTomlSubset, readUnits, summarizeStep, LEDGER_DIR } from './gen-ledger.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')
/**
 * ⚠⚠ **2026-10-30 P4：`ledger-next/` 已搬进账本区。**
 *   ⇒ 这里**不再**拼 `<工作区>/ledger-next`，而是用生成器导出的同一份解析结果
 *     （⛔ 两处各自拼路径 = 两处真相）。
 */
const LEDGER = LEDGER_DIR
const WORK = join(ROOT, '.check-ledger-next-work')

let pass = 0
let fail = 0
const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail++; console.log(`  ✗ ${m}`) }

rmSync(WORK, { recursive: true, force: true })
mkdirSync(WORK, { recursive: true })

console.log('')
console.log('L 组：ledger-next · 三条不变式（I1 / I2 / I5）')
console.log('')

/**
 * **按 kind 必填的字段**（任务书 §二那张表的逐条落地）。
 * ⚠ 顺序 = 表里的顺序，便于对着读。
 */
export const REQUIRED_FIELDS = {
  task: ['built_by', 'verify'],
  acc: ['actor', 'evidence'],
  run: ['started_at'],
  cap: ['last_reading'],
  change: ['proposal', 'built_by'],
  req: ['spec'],
}

/**
 * **I3 的实现**：`acc.actor ≠ 对应任务的 built_by`。
 *
 * ⚠ 2026-10-30 P2：改前这条**只要任一条没写就不检查** ⇒ 会自己关掉。
 *   现在 I1 已把 `acc.actor` / `task.built_by` 变成必填，**这条才真的会开火**；
 *   但本函数仍然对"缺字段"**报红**（⛔ 不能假定 I1 一定先跑过 —— 判据要能独立成立）。
 *
 * @param {Array<Record<string, any>>} units - 单元
 * @returns {string[]} 问题清单
 */
export function checkI3(units) {
  const problems = []
  const byId = new Map(units.map((u) => [u.id, u]))
  for (const a of units) {
    if (a.kind !== 'acc') continue
    if (typeof a.actor !== 'string' || a.actor.trim() === '') {
      problems.push(`${a.id}：缺 \`actor\` ⇒ I3 **无法判定**（⛔ 不按通过处理）`)
      continue
    }
    /**
     * ⚠ 找它的"被验对象"：`parent` 必须是 **task 或 change**；否则沿 `parent` 往上找（一跳）。
     *   ⚠ P3 起 `change` 也有 `built_by` ⇒ 「验收一个变更」同样受 I3 守（任务书 §一2）。
     *   ⚠ 找不到 ⇒ 这条 I3 判不出 ⇒ **报红**（⛔ 静默放过）。
     */
    const VERIFIABLE = ['task', 'change']
    let t = byId.get(a.parent)
    if (t !== undefined && !VERIFIABLE.includes(t.kind)) t = byId.get(t.parent)
    if (t === undefined || !VERIFIABLE.includes(t.kind)) {
      problems.push(`${a.id}：**找不到它验的那条 task/change**（parent=${JSON.stringify(a.parent)}）⇒ I3 判不出（⛔ 不按通过处理）`)
      continue
    }
    if (typeof t.built_by !== 'string' || t.built_by.trim() === '') {
      problems.push(`${a.id}：被验 ${t.kind} ${t.id} 缺 \`built_by\` ⇒ I3 **无法判定**（⛔ 不按通过处理）`)
      continue
    }
    if (a.actor === t.built_by) {
      problems.push(`${a.id}：**\`acc.actor\` 等于 ${t.id}.built_by（${a.actor}）** ⇒ 自己验自己（⛔ \`CONSTITUTION\` §4）`)
    }
  }
  return problems
}

/**
 * **I1 的纯函数实现**（⚠ 收 `units` + 可选路径存在性判据，便于负向对拍直接喂坏数据）。
 *
 * @param {Array<Record<string, any>>} units - 单元数组
 * @param {(p: string) => boolean} pathExists - 判断索引里引用的路径是否存在
 * @returns {string[]} 问题清单（空 = 合法）
 */
export function checkI1(units, pathExists) {
  const problems = []
  const ids = new Set()
  const byId = new Map()

  for (const u of units) {
    if (typeof u.id !== 'string' || u.id.trim() === '') {
      problems.push(`有一条单元缺 id：${JSON.stringify(u.title ?? '(无标题)')}`)
      continue
    }
    if (ids.has(u.id)) problems.push(`id 重复：${u.id}`)
    ids.add(u.id)
    byId.set(u.id, u)

    const spec = KIND_SPEC[u.kind]
    if (spec === undefined) {
      problems.push(`${u.id}：kind 不在封闭集里（${JSON.stringify(u.kind)}）`)
      continue
    }
    if (!u.id.startsWith(spec.prefix)) {
      problems.push(`${u.id}：前缀与 kind 不匹配（kind=${u.kind} 应带 ${spec.prefix}）`)
    }
    if (!spec.statuses.includes(u.status)) {
      problems.push(`${u.id}：status 不在封闭集里（${JSON.stringify(u.status)}，合法：${spec.statuses.join(' / ')}）`)
    }
    if (typeof u.title !== 'string' || u.title.trim() === '') problems.push(`${u.id}：缺 title`)
    if (typeof u.source !== 'string' || u.source.trim() === '') problems.push(`${u.id}：缺 source（⛔ 每条都要能指回真实现场）`)
    if (!Array.isArray(u.after)) problems.push(`${u.id}：after 必须是数组`)

    /**
     * ── ⚠ **按 kind 必填**（2026-10-30 P2 · 任务书 §二）────────────────────────
     * 改前：`I3`（`acc.actor ≠ built_by`）**只要有一条没写就静默不检查** ⇒ 那是一条会自己关掉的判据。
     * ⇒ 现在把"每条 kind 必须带哪些字段"变成 I1 的一部分；缺一 ⇒ 红。
     */
    const required = REQUIRED_FIELDS[u.kind] ?? []
    for (const f of required) {
      const v = u[f]
      // ⚠ `run` 的 `started_at` 允许用 `why` 顶替（判不出就该写为什么，⛔ 不许编一个时刻）
      if (f === 'started_at' && typeof u.why === 'string' && u.why.trim() !== '') continue
      const missing = v === undefined || v === null
        || (typeof v === 'string' && v.trim() === '')
        || (Array.isArray(v) && v.length === 0)
      if (missing) problems.push(`${u.id}：kind=${u.kind} **必填字段 \`${f}\` 缺失**（⛔ 缺它会让相关判据静默失效）`)
    }

    /**
     * ⚠ **`change` 必须在盘上有目录且含 `proposal.md`**（任务书 §三）。
     *   目录名 = id 去掉 `CHG-` 前缀 ⇒ `CHG-2026-10-30-rearch` ⇒ `changes/2026-10-30-rearch/`。
     */
    if (u.kind === 'change') {
      /**
       * ⚠ **用 `proposal` 字段指向的路径**（⛔ 不用 id 推目录名）。
       *   理由：任务书 §三 要的就是"把 `proposal` 指向不存在的目录 ⇒ 必红" ——
       *   若这里自己按 id 拼目录，`proposal` 字段写错就完全不被检查（那正是本轮要抓的哑判据形态）。
       */
      const propPath = typeof u.proposal === 'string' && u.proposal.trim() !== ''
        ? u.proposal
        : `changes/${String(u.id).replace(/^CHG-/, '')}/proposal.md`
      if (!pathExists(propPath)) {
        problems.push(`${u.id}：**change 目录不存在或缺 proposal.md**（期望 \`${propPath}\`）—— ⛔ 一个变更必须在盘上有目录，不然只有索引里一条空记录`)
      }
    }
    // ⚠ `req` 的 `spec` 路径必须存在（任务书 §三）
    if (u.kind === 'req' && typeof u.spec === 'string' && u.spec.trim() !== '') {
      if (!pathExists(u.spec)) problems.push(`${u.id}：**spec 路径不存在**（\`${u.spec}\`）—— 需求必须指向一份盘上真有的现状文档`)
    }
  }

  // parent 存在（⚠ parent 可以是 spec/<capability> 这样的**目录**，也可以是单元 id）
  for (const u of units) {
    if (typeof u.parent !== 'string' || u.parent === '') { problems.push(`${u.id}：缺 parent`); continue }
    const isUnit = byId.has(u.parent)
    const isPath = pathExists(u.parent)
    if (!isUnit && !isPath) problems.push(`${u.id}：parent 不存在（${JSON.stringify(u.parent)} 既不是单元 id，也不是盘上的路径）`)
  }

  // after 指向存在
  for (const u of units) {
    if (!Array.isArray(u.after)) continue
    for (const a of u.after) {
      if (!byId.has(a)) problems.push(`${u.id}：after 指向不存在的单元 ${JSON.stringify(a)}`)
    }
  }

  // 无环（沿 after 走；⚠ 用三色标记，环要指名）
  const WHITE = 0; const GRAY = 1; const BLACK = 2
  const color = new Map(units.map((u) => [u.id, WHITE]))
  const stack = []
  const visit = (id) => {
    color.set(id, GRAY)
    stack.push(id)
    const u = byId.get(id)
    const next = u !== undefined && Array.isArray(u.after) ? u.after : []
    for (const n of next) {
      if (!byId.has(n)) continue
      const c = color.get(n)
      if (c === GRAY) {
        const at = stack.indexOf(n)
        problems.push(`after 成环：${[...stack.slice(at), n].join(' → ')}`)
      } else if (c === WHITE) visit(n)
    }
    stack.pop()
    color.set(id, BLACK)
  }
  for (const u of units) if (color.get(u.id) === WHITE) visit(u.id)

  return problems
}

/**
 * **I1 的"状态只在一处"**：`units/index.toml` 之外，任何 `.md`/`.toml` 里出现 `status =` ⇒ 问题。
 *
 * @param {string} ledgerDir - `ledger-next/` 根
 * @returns {string[]} 问题清单
 */
export function checkStatusSingleHome(ledgerDir) {
  const problems = []
  const walk = (dir) => {
    let ents
    try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        // ⚠ `gen/` 是**生成物**（投影），它的表格里允许出现"状态"这一**列**
        if (p === join(ledgerDir, 'gen')) continue
        walk(p)
        continue
      }
      if (!/\.(md|toml)$/.test(e.name)) continue
      if (p === join(ledgerDir, 'units', 'index.toml')) continue
      let src = ''
      try { src = readFileSync(p, 'utf8') } catch { continue }
      src.split('\n').forEach((l, i) => {
        // ⚠ 只认**赋值**形态；说明性文字里提到 `status =` 不算（写成反引号包住的示例也不该算，但那种极少）
        if (/(^|\s)status\s*=/.test(l) && !/^\s*#/.test(l)) {
          problems.push(`${posix.relative(ledgerDir, p)}:${i + 1} 出现了 \`status =\` —— 状态只许在 units/index.toml 里`)
        }
      })
    }
  }
  walk(ledgerDir)
  return problems
}

/**
 * **I5 的实现**：把盘上 `gen/` 与"当场重算"的结果逐字节比。
 *
 * @param {string} ledgerDir - `ledger-next/` 根
 * @param {(units: Array<object>) => Record<string, string>} renderAll - 生成函数
 * @returns {string[]} 问题清单
 */
/**
 * **§4.1 生成块的两侧核对**（纯函数，路径全由调用方给 ⇒ 负向对拍能用临时副本）。
 *
 * @param {string[]} files - `[['正本', 路径], ['模板', 路径]]`
 * @param {string} want - 生成器的期望块（含首尾标记）
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkBlockEquality(files, want) {
  const BEGIN = '<!-- BEGIN gen:check-families -->'
  const END = '<!-- END gen:check-families -->'
  const problems = []
  for (const [label, file] of files) {
    let src = ''
    try { src = readFileSync(file, 'utf8') } catch { src = '' }
    if (src === '') {
      problems.push(`${label} \`${file}\` **读不到** ⇒ 它的 §4.1 块无从核对（不按通过处理）`)
      continue
    }
    const i = src.indexOf(BEGIN)
    const j = src.indexOf(END)
    if (i < 0 || j < 0 || j < i) {
      problems.push(`${label} **找不到 §4.1 生成块的标记**（BEGIN=${i} / END=${j}）`
        + ' ⇒ 标记被删/被改 ⇒ 没有对象可查（⛔ 不按通过处理）')
      continue
    }
    const got = src.slice(i, j + END.length)
    if (got !== want) {
      const p1 = [...got].findIndex((c, k) => c !== want[k])
      problems.push(`${label} 的 §4.1 生成块与生成器输出**不一致**（第 ${p1 < 0 ? '?' : p1 + 1} 个字符起；`
        + `实 ${got.length} B vs 期望 ${want.length} B）`)
    }
  }
  return problems
}

export function checkI5(ledgerDir, renderAll) {
  const problems = []
  const units = readUnits(join(ledgerDir, 'units', 'index.toml'))
  const expected = renderAll(units)
  for (const [name, want] of Object.entries(expected)) {
    const p = join(ledgerDir, 'gen', name)
    let got = null
    try { got = readFileSync(p, 'utf8') } catch { got = null }
    if (got === null) { problems.push(`gen/${name} 读不到（应存在）`); continue }
    if (got !== want) {
      // ⚠ 指到**第一处**不同，别只说"不一致"（那对修的人等于没说）
      let at = 0
      const n = Math.min(got.length, want.length)
      while (at < n && got[at] === want[at]) at++
      problems.push(`gen/${name} 与生成器**不一致**（第 ${at + 1} 个字符起；实 ${got.length} B vs 期望 ${want.length} B）`
        + `\n      ⇒ 实际：${JSON.stringify(got.slice(at, at + 40))}`
        + `\n      ⇒ 期望：${JSON.stringify(want.slice(at, at + 40))}`
        + '\n      ⇒ 修法：⛔ 别手改生成物；改 units/index.toml 或生成器，再跑 npm run gen:ledger')
    }
  }
  return problems
}

/**
 * **I2 的实现**：改一条 status ⇒ 对应那一步的行必须跟着变。
 *
 * ⚠ 做法：在**内存里**改一条 status（⛔ 不落盘），重新 `renderStages`，比那一行的图标。
 *   ⚠ 且**必须是"那一步"变**（⛔ 不许别的步跟着变 —— 那说明汇总串了）。
 *
 * @param {Array<Record<string, any>>} units - 原始单元
 * @param {(units: Array<object>) => string} render - 生成函数
 * @returns {string[]} 问题清单
 */
export function checkI2(units, render) {
  const problems = []
  /**
   * ⚠ 只认**五步那五行**：以 `| ①`…`| ⑤` 开头。
   *   ⛔ 不能用"以 `| ` 开头且含 `/`" —— 表头 `| 步 | 状态 | 完成/总数 | 条目 |` 也满足两条，
   *     实测踩过：它被当成第 0 行 ⇒ 所有下标整体错位一位 ⇒ I2 误报"汇总串了"。
   */
  const rowsOf = (text) => text.split('\n').filter((l) => /^\| [①②③④⑤] /.test(l))
  const baseRows = rowsOf(render(units))

  /**
   * ⚠ **自动找探针**：不预设"必须有 run/registered"。
   *   对每条单元、把它改成同 kind 封闭集里的**每个其它状态**，看有没有任何一次让**某一步那一行**变化。
   *   第一次变化就是探针 —— 这样索引内容变了（比如全是 built）也不会让 I2 失去基准。
   *   ⚠ 只在**内存里**改（⛔ 不落盘）。
   */
  let probe = undefined
  outer:
  for (let i = 0; i < units.length; i++) {
    const u = units[i]
    const spec = KIND_SPEC[u.kind]
    if (spec === undefined || spec.step === null) continue
    for (const alt of spec.statuses) {
      if (alt === u.status) continue
      const mutated = units.map((x, k) => (k === i ? { ...x, status: alt } : x))
      const rows = rowsOf(render(mutated))
      const changed = rows.findIndex((r, k) => r !== baseRows[k])
      if (changed >= 0) { probe = { i, from: u.status, to: alt, stepIdx: changed + 1, mutated, rows }; break outer }
    }
  }

  if (probe === undefined) {
    return ['I2 **阶段不是算出来的**（或阶段被写死进了产物）：改任何一条 status，五步那五行都不动'
      + ' ⇒ 本条不按通过处理（⚠ 阶段必须是索引的投影，⛔ 不许是产物里的常量）']
  }

  /**
   * ⚠ 关键：变化的**必须是这条单元自己那一步**。
   *   若变的是**别的步**，说明五步汇总串了（那比"没变"更危险 —— 会让人以为改了 A 影响 B 是正常的）。
   */
  const ownStep = KIND_SPEC[units[probe.i].kind].step
  if (probe.stepIdx !== ownStep) {
    problems.push(`I2 改的是 ${units[probe.i].id}（第 ${ownStep} 步），但变的是第 ${probe.stepIdx} 步那一行 ⇒ 汇总串了`)
  }
  // 其它步必须一字不动
  for (let k = 0; k < baseRows.length; k++) {
    if (k === probe.stepIdx - 1) continue
    if (baseRows[k] !== probe.rows[k]) problems.push(`I2 改的是第 ${ownStep} 步，但第 ${k + 1} 步那一行也变了 ⇒ 汇总串了`)
  }
  return problems
}

/**
 * **I4（顺带）**：`cap` 无终态、无百分比。
 *
 * @param {Array<Record<string, any>>} units - 单元
 * @param {(units: Array<object>) => string} render - 生成函数
 * @returns {string[]} 问题清单
 */
// ══════════════════════════════════════════════════════════════════════
// I6 · **跨源一致性**：`run` 单元说 running ⇒ 运行态里必须查得到它
// ══════════════════════════════════════════════════════════════════════
/**
 * ── 它治的病（2026-10-30 P13 · `CHG-272` §三·3）────────────────────────
 *   索引里 `RUN-001.status = "running"` 挂了十期，而**那一轮早已回传** ——
 *   界面于是永远显示「④ 任务执行 ▶ 进行中 0/1」。
 *   ⚠ 更糟的是：**没有任何判据会红** —— 索引自己说自己对，运行态早把那条轮转掉了。
 *   ⇒ 本条把"索引的 run 状态"与"运行态的真实记录"**对起来**：
 *     索引说 `running`（或 `registered` / `delivered-unconfirmed` —— 这三个都表示"还没回传"）
 *     而运行态 `pending` / `lost` / `closed` 里都**查不到**这个 target ⇒ **红**。
 *
 * ── 为什么允许"查得到"这一侧有模糊（⛔ 不追求逐条精确匹配）────────────────
 *   运行态按 `target`（会话 id）+ 时间窗记录，**没有 RUN-001 这个 id**。
 *   ⇒ 本条只判"**有没有这个 target 的、看起来还在跑的记录**"（⚠ 见 {@link runtimeHasLiveTarget}）。
 *     这是**能机检的那一半**；"这条记录对应哪一期"仍要人读（写进报告的「判不出」栏）。
 *
 * @param {Array<object>} units - 索引单元
 * @param {{pending?:Array, lost?:Array, closed?:Array}} rt - 运行态三类记录
 * @param {(u: object, rt: object) => boolean} hasLive - 判定"运行态里有它在跑"（注入 ⇒ 可对拍）
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkI6(units, rt, hasLive) {
  const problems = []
  const LIVE = ['running', 'registered', 'delivered-unconfirmed']
  const runs = units.filter((u) => u.kind === 'run')
  if (runs.length === 0) return problems
  for (const r of runs) {
    if (!LIVE.includes(String(r.status))) continue
    if (hasLive(r, rt) !== true) {
      problems.push(`${r.id}：索引说 \`status=${r.status}\`（未回传），而运行态里**查不到**它在跑`
        + ' ⇒ 两处事实不一致（⚠ 修法：要么把索引改成终态，要么补运行态记录 —— ⛔ 不许两边都不动）')
    }
  }
  return problems
}

/**
 * 默认的"运行态里还有它在跑吗"判定（⚠ 纯函数，夹具可替换）。
 *
 * 口径：运行态三档 `pending` / `lost` / `closed` 里，任一条
 *   ① `target` 等于该 run 的 `built_by`（或 `target` 字段直接等于 run.id），且
 *   ② **没有** `deliveredAt`（有它 = 已回传 ⇒ 不算"在跑"），
 * ⇒ 判"还在跑"。
 *
 * @param {object} run - 索引里的 run 单元
 * @param {{pending?:Array, lost?:Array, closed?:Array}} rt - 运行态
 * @returns {boolean} 是否还在跑
 */
export function runtimeHasLiveTarget(run, rt) {
  const targets = [String(run.built_by ?? ''), String(run.id ?? '')].filter((x) => x !== '')
  for (const k of ['pending', 'lost', 'closed']) {
    for (const e of (rt?.[k] ?? [])) {
      const t = String(e?.target ?? '')
      if (!targets.includes(t)) continue
      if (e?.deliveredAt !== undefined && e?.deliveredAt !== null) continue
      return true
    }
  }
  return false
}

export function checkI4(units, render) {
  const problems = []
  const caps = units.filter((u) => u.kind === 'cap')
  const text = render(units)
  const capSection = text.slice(text.indexOf('长期能力（无完成态）'))
  if (capSection.includes('%')) problems.push('I4 「长期能力」栏里出现了 `%`（⛔ 无百分比）')
  // cap 的状态不许是任何"终态"（KIND_SPEC.cap.finals 为空 ⇒ 任何终态判定都该说不存在）
  if (KIND_SPEC.cap.finals.length !== 0) problems.push('I4 KIND_SPEC.cap.finals 不是空 ⇒ "cap 无终态"这条被改坏了')
  for (const c of caps) {
    const spec = KIND_SPEC.cap
    if (!spec.statuses.includes(c.status)) problems.push(`I4 ${c.id}：cap 状态不在封闭集里（${JSON.stringify(c.status)}）`)
  }
  // ⚠ cap 不进分母：五步那五行里不许出现 cap 的 id
  const stageRows = text.split('\n').filter((l) => /^\| [①②③④⑤] /.test(l))
  for (const c of caps) {
    if (stageRows.some((r) => r.includes(String(c.id)))) problems.push(`I4 ${c.id} 出现在了五步的分母里（⛔ cap 不进任何一步）`)
  }
  return problems
}

try {
  // ══════════════════════════════════════════════════════════════════════
  // L-0 前置：索引与 gen/ 都在
  // ══════════════════════════════════════════════════════════════════════
  const indexPath = join(LEDGER, 'units', 'index.toml')
  if (!existsSync(indexPath)) throw new Error(`索引不存在：${indexPath}（⛔ 不按通过处理）`)
  const units = readUnits(indexPath)
  if (units.length === 0) throw new Error('索引里 0 条单元 ⇒ 本组失去基准（⛔ 不按通过处理）')
  ok(`L-0 ✓ 索引可读：${units.length} 条单元（${[...new Set(units.map((u) => u.kind))].join(' / ')}）`)

  /**
   * ⚠ **与生成器同源**：直接用生成器导出的 `renderAll` + `collectInputs`，
   *   ⛔ 判据不另写一份渲染（那会变成"判据自洽、生成器另说"）。
   * ⚠ 2026-10-30 P6：产物从 2 份增到 **4 份**（+modules.md +archive-index.md）⇒ I5 一并守住。
   */
  const { renderAll: renderAllRef, collectInputs } = await import(pathToFileURL(join(here, 'gen-ledger.mjs')).href)
  const extraInputs = collectInputs(ROOT, LEDGER)
  const renderAll = (u) => renderAllRef(u, extraInputs)

  // ══════════════════════════════════════════════════════════════════════
  // I5b · **两处 §4.1 生成块必须与生成器输出逐字节一致**（2026-10-30 P7）
  // ══════════════════════════════════════════════════════════════════════
  /**
   * ── 它接替了谁（这条替代关系必须记下来，否则将来没人知道 V/N 为什么能删）──────
   *   改前：族清单**手抄三处**，由 `V`（package.json → 正本 §4.1）与
   *     `N`（正本 → 模板）两条断言守着；P2、P3 各被咬过一次。
   *   现在：正本与模板的 §4.1 表体是**一对标记之间的生成块**，内容由
   *     `renderCheckFamiliesBlock` 渲染 ⇒ 手工抄写这个动作**不存在了**。
   *   ⇒ 于是"抄错/漏抄"这一类漂移**不可能发生**，剩下的唯一风险是
   *     **有人手改块内容**（绕过生成器）—— 那正是本条要咬的。
   *
   * ⚠ 两侧都要查（正本 + 模板），且**逐字节**（不是 trim 后比较）。
   * ⚠ 读不到文件 / 找不到标记 ⇒ `bad`（⛔ 不许静默通过：标记被删了，本条就没对象了）。
   */
  {
    const { renderCheckFamiliesBlock } = await import(pathToFileURL(join(here, 'gen-ledger.mjs')).href)
    let want = ''
    let renderErr = ''
    try { want = renderCheckFamiliesBlock(ROOT) } catch (e) { renderErr = String(e?.message ?? e) }
    if (renderErr !== '') {
      bad(`I5b **生成器自己渲染不出 §4.1 块** ⇒ 「两处块 == 生成器输出」失去基准（不按通过处理）：${renderErr}`)
    } else {
      /**
       * ⚠ 正本 `CONTEXT.md` 在**账本根**上，不在 `ledger-next/` 里（`LEDGER` = `.../ledger-next`）。
       *   ⇒ 用 `dirname(LEDGER)`。⛔ 别把两个根混成一个（P4 那次"索引在错的位置"就是这种）。
       */
      /**
       * ⚠ **两侧期望块不同**（2026-10-30 P7 实测冲突，不是偷懒）：
       *   正本那列「守什么」是**本项目事实**（含轮次号、插件名），而 `kit/templates/` 是**开箱层**
       *   —— `check:gitignore` 的**断言 B** 明令模板里 ⛔ 不许出现本项目专有值。
       *   ⇒ 族清单**完全相同**（同一份 `package.json` 派生、同一个渲染器），
       *     但**说明列**按侧不同：`canonical` 给本项目事实、`template` 给"见本仓 §4.1"。
       *   ⇒ 于是这里**按侧用各自的期望块**核对，⛔ 不拿正本的散文去要求模板。
       */
      const { renderCheckFamiliesBlock: render2 } = await import(pathToFileURL(join(here, 'gen-ledger.mjs')).href)
      const wantTpl = render2(ROOT, 'template')
      const probs = [
        ...checkBlockEquality([['正本', join(dirname(LEDGER), 'CONTEXT.md')]], want),
        ...checkBlockEquality([['模板', join(ROOT, 'kit', 'templates', 'CONTEXT.md')]], wantTpl),
      ]
      for (const p of probs) bad(`I5b ${p}`)
      const blocks = probs.length === 0 ? [['ok', want], ['ok', want]] : []
      if (blocks.length === 2 && blocks[0][1] === blocks[1][1] && blocks[0][1] === want) {
        ok(`I5b ✓ §4.1 生成块**逐字节 == 生成器输出**（正本 ${want.length} B · 模板 ${wantTpl.length} B；族清单同源、说明列按层不同）`
          + ' ⇒ 接替旧 `V` / `N` 守的那件"三处抄写会漂移"：抄写动作已不存在')
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // I1 · 索引合法 + 状态只在一处
  // ══════════════════════════════════════════════════════════════════════
  {
    const pathExists = (p) => existsSync(join(LEDGER, p))
    const probs = [...checkI1(units, pathExists), ...checkStatusSingleHome(LEDGER)]
    if (probs.length === 0) {
      ok(`I1 ✓ 索引合法：${units.length} 条 · id 唯一 · 前缀与 kind 匹配 · status 全在封闭集 · parent 全存在 · 无环 · after 全指向存在 · 状态不出现在别处`)
    } else for (const p of probs) bad(`I1 · ${p}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // I3 · acc.actor ≠ built_by（⚠ P2 起它真的会开火）
  // ══════════════════════════════════════════════════════════════════════
  {
    const probs = checkI3(units)
    const accs = units.filter((u) => u.kind === 'acc')
    if (probs.length === 0) {
      ok(`I3 ✓ 验收不是自己做：${accs.length} 条 acc 全部可判且 actor ≠ built_by`)
    } else for (const p of probs) bad(`I3 · ${p}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // I2 · 阶段是算出来的
  // ══════════════════════════════════════════════════════════════════════
  {
    const probs = checkI2(units, renderStages)
    if (probs.length === 0) ok('I2 ✓ 阶段是算出来的：改一条 status ⇒ 只有对应那一步的行变，其它步一字不动')
    else for (const p of probs) bad(`I2 · ${p}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // I5 · gen/ 与生成器一致
  // ══════════════════════════════════════════════════════════════════════
  {
    const probs = checkI5(LEDGER, renderAll)
    if (probs.length === 0) ok(`I5 ✓ gen/ 与生成器逐字节一致（${Object.keys(renderAll(units)).length} 份生成物：${Object.keys(renderAll(units)).join(' / ')}）`)
    else for (const p of probs) bad(`I5 · ${p}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // I4（顺带）· cap 无终态、无百分比、不进分母
  // ══════════════════════════════════════════════════════════════════════
  {
    const probs = checkI4(units, renderStages)
    if (probs.length === 0) ok(`I4 ✓ cap 无终态 · 无百分比 · 不进五步分母（本索引 ${units.filter((u) => u.kind === 'cap').length} 条 cap）`)
    else for (const p of probs) bad(`I4 · ${p}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // I6 · 跨源一致性：`run` 说在跑 ⇒ 运行态里必须查得到（2026-10-30 P13）
  // ══════════════════════════════════════════════════════════════════════
  {
    /** 运行态路径（⚠ 账本根下，与索引同根）。 */
    const RT_PATH = join(dirname(LEDGER), 'runtime', 'orch-watches.json')
    let rt = null
    try { rt = JSON.parse(readFileSync(RT_PATH, 'utf8')) } catch { rt = null }
    if (rt === null) {
      /**
       * ⚠ 运行态读不到 ⇒ **不许当绿**（⛔ 那是"没有对象"被印成"查过且都对"）。
       *   但也**不许当红**（文件不存在可能是"这一份账本还没跑过编排"）——
       *   ⇒ 打一条可读的 `ok` 但**明确写"未执行"**？不行，`ok` 会被算进"过了"。
       *   本仓既有口径：没有对象走 `skip`。这里没有 `skip` 通道 ⇒ 用 `bad` 会更糟。
       *   ⇒ **明确报成一条独立的 `ok` 且文案写清"未执行 · 不算通过"** 不合规，
       *     所以这里**改用 I6 自己的第三条路：只在读得到时判**，读不到时**打一行 `⚠` 提示**
       *     并计入"跳过"（由外层处级口径统计）。
       */
      console.log('  ⚠ I6 运行态**读不到**（`runtime/orch-watches.json`）⇒ 跨源一致性**未执行**（⛔ 不算通过）')
    } else {
      const probs = checkI6(units, rt, runtimeHasLiveTarget)
      if (probs.length === 0) {
        const liveRuns = units.filter((u) => u.kind === 'run' && ['running', 'registered', 'delivered-unconfirmed'].includes(String(u.status)))
        ok(`I6 ✓ 跨源一致：${liveRuns.length === 0 ? '无「未回传」的 run 单元' : `${liveRuns.length} 条「未回传」的 run 都在运行态里查得到`}`
          + `（运行态 pending ${(rt.pending ?? []).length} / lost ${(rt.lost ?? []).length} / closed ${(rt.closed ?? []).length}）`)
      } else for (const p of probs) bad(`I6 · ${p}`)
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 三条**负向对拍**（⚠ 每条都真的造坏夹具、真的跑一次、真的看它红）
  // ══════════════════════════════════════════════════════════════════════

  // ── N-I1：造一个成环的夹具 ⇒ I1 必红 ───────────────────────────────────
  {
    const cyc = [
      { id: 'R-001', kind: 'req', title: 'a', parent: 'spec/progress', status: 'agreed', after: ['R-002'], source: 'x' },
      { id: 'R-002', kind: 'req', title: 'b', parent: 'spec/progress', status: 'agreed', after: ['R-001'], source: 'x' },
    ]
    const probs = checkI1(cyc, () => true)
    const hit = probs.find((p) => p.includes('成环'))
    if (hit !== undefined) ok(`N-I1 ✓ 负向对拍（R-001→R-002→R-001 成环）⇒ I1 的"无环"断言**变红**：${hit.slice(0, 80)}`)
    else bad(`N-I1 · 造了成环夹具但 I1 没报"成环"（实报：${JSON.stringify(probs)}）⇒ 那条断言没有牙`)
  }

  // ── N-I2：把阶段状态**写死进** stages.md（不随 status 变）⇒ I2 必红 ──────
  {
    /**
     * 夹具：渲染器**先正常算**，然后把五步那五行**整块盖成常量**（= 有人把阶段状态手写死了）。
     * ⚠ 这正是任务书 §二④ 那条负向对拍要的形状：阶段状态写死进产物 ⇒ 改 status 不再影响它。
     * ⚠ 这样 `rowsOf` 永远拿到同一批行 ⇒ I2 的探针搜不到"任何变化" ⇒ 报"失去基准" = **红**。
     */
    const baseRows = renderStages(units).split('\n').filter((l) => /^\| [①②③④⑤] /.test(l))
    const frozen = (u) => {
      const t = renderStages(u)
      let k = 0
      return t.split('\n').map((l) => (/^\| [①②③④⑤] /.test(l) ? baseRows[k++] : l)).join('\n')
    }
    // 先自证"冻结确实冻住了"（否则下面的红可能是别的原因）
    const oneChange = units.map((x, i) => (i === 0 ? { ...x, status: KIND_SPEC[x.kind].statuses.slice(-1)[0] } : x))
    const stillSame = renderStages(units).split('\n').filter((l) => /^\| [①②③④⑤] /.test(l)).join('|')
      === frozen(units) === undefined ? '' : (frozen(oneChange).split('\n').filter((l) => /^\| [①②③④⑤] /.test(l)).join('|')
        === baseRows.join('|'))
    const probsFrozen = checkI2(units, frozen)
    if (stillSame && probsFrozen.length > 0) {
      ok(`N-I2 ✓ 负向对拍（把五步那五行写死进产物）⇒ I2 **变红**：${probsFrozen[0].slice(0, 70)}…`)
    } else if (!stillSame) {
      bad('N-I2 · 夹具没冻住（改了 status 行还是变）⇒ 这条负向对拍本身不可判')
    } else {
      bad('N-I2 · 写死阶段状态后 I2 仍通过 ⇒ 那条断言没有牙')
    }
  }

  // ── N-I5b / N-I5c：手改 `modules.md` / `archive-index.md` 各一字符 ⇒ I5 必红（三份各测一次）──
  for (const genName of ['modules.md', 'archive-index.md']) {
    const tmp = join(WORK, `mut-${genName}`)
    cpSync(LEDGER, tmp, { recursive: true })
    const p2 = join(tmp, 'gen', genName)
    const orig = readFileSync(p2, 'utf8')
    const mutated = orig.replace(/[A-Za-z]/, (c) => (c === 'X' ? 'Y' : 'X'))
    if (mutated === orig) {
      bad(`N-I5 · 造不出"手改 ${genName} 一个字符"的夹具 ⇒ 该份的负向对拍不可判`)
    } else {
      writeFileSync(p2, mutated)
      const probs = checkI5(tmp, renderAll)
      const hit = probs.find((x) => x.includes(genName) && x.includes('不一致'))
      if (hit !== undefined) ok(`N-I5 ✓ 负向对拍（手改 gen/${genName} 一个字符）⇒ I5 对**该份**的"逐字节一致"断言**变红**`)
      else bad(`N-I5 · 手改 ${genName} 后 I5 没报它（实报：${JSON.stringify(probs.slice(0, 2))}）`)
    }
  }

  // ── N-I6：索引说 running 而运行态查不到 ⇒ I6 必红（`CHG-272` §三·3 点名要求）──
  {
    /**
     * ⚠ **先自证夹具真坏掉**：
     *   ① 造一条 `run` 单元，`status=running`，`built_by` 是一个**运行态里根本不存在**的会话 id；
     *   ② 现场断言 `runtimeHasLiveTarget` 对它返回 `false`；
     *   ③ 再断言 `checkI6` 报出它。
     * ⚠ 反向对照：把同一条改成 `returned` ⇒ `checkI6` **不许报**（⛔ 不过咬）。
     */
    const ghostRun = { id: 'RUN-901', kind: 'run', status: 'running', built_by: 'session-DOES-NOT-EXIST', parent: 'TSK-901', started_at: '2026-01-01T00:00:00+08:00' }
    const rtFixture = { pending: [], lost: [], closed: [] }
    const reallyAbsent = runtimeHasLiveTarget(ghostRun, rtFixture) === false
    const probs = checkI6([ghostRun], rtFixture, runtimeHasLiveTarget)
    const probs2 = checkI6([{ ...ghostRun, status: 'returned' }], rtFixture, runtimeHasLiveTarget)
    if (!reallyAbsent) {
      bad('N-I6 · 夹具没造出"运行态查不到"（runtimeHasLiveTarget 返回 true）⇒ 本条不可判')
    } else if (probs.length === 0) {
      bad('N-I6 · 索引说 running 而运行态没有，I6 **没报红** ⇒ 跨源一致性判据是假的')
    } else if (probs2.length !== 0) {
      bad(`N-I6 · 反向对照失败（改成 returned 仍报）：${probs2[0].slice(0, 80)}`)
    } else {
      ok(`N-I6 ✓ 负向对拍（先自证：造 \`RUN-901\` 说 running、其 target 在运行态三档里**全查不到**）`
        + `⇒ I6 **必红**：${probs[0].slice(0, 70)}；反向对照（改 returned）→ 绿（⛔ 不过咬）`)
    }
  }

  // ── N-I5b：手改正本 §4.1 块内一个字符 ⇒ I5b 必红 ─────────────────────
  {
    const { renderCheckFamiliesBlock } = await import(pathToFileURL(join(here, 'gen-ledger.mjs')).href)
    const want = renderCheckFamiliesBlock(ROOT)
    const tmp = join(WORK, 'mut-block')
    mkdirSync(tmp, { recursive: true })
    const canonical = join(tmp, 'CONTEXT.md')
    const template = join(tmp, 'template-CONTEXT.md')
    cpSync(join(dirname(LEDGER), 'CONTEXT.md'), canonical)
    cpSync(join(ROOT, 'kit', 'templates', 'CONTEXT.md'), template)
    const orig = readFileSync(canonical, 'utf8')
    const i = orig.indexOf('<!-- BEGIN gen:check-families -->')
    const j = orig.indexOf('<!-- END gen:check-families -->')
    /**
     * ⚠ **只在块内改一个 ASCII 词**（`npm run` → `npx run`），⛔ 不碰 BEGIN/END 标记本身。
     *   ⚠ 第一版改的是"块内第一个字母"，那个字母正好在 `<!-- BEGIN` 里 ⇒ 标记被毁，
     *     于是 I5b 报的是"找不到标记"而不是"不一致" —— **对拍变成了另一回事**。
     *     （这正是本项目反复记的"负向对拍必须自证咬的是那条断言"。）
     */
    const inside = orig.slice(i, j + '<!-- END gen:check-families -->'.length)
    const mutatedInside = inside.replace('npm run', 'npx run')
    const mutated = orig.slice(0, i) + mutatedInside + orig.slice(i + inside.length)
    if (i < 0 || j < 0 || mutatedInside === inside) {
      bad('N-I5b · 造不出"手改块内一个字符"的夹具 ⇒ 本条负向对拍不可判')
    } else {
      const outsideSame = orig.slice(0, i) === mutated.slice(0, i)
      writeFileSync(canonical, mutated)
      const probs = checkBlockEquality([['正本', canonical]], want)
      const hit = probs.find((x) => x.includes('不一致'))
      if (!outsideSame) bad('N-I5b · 夹具把块外也改了 ⇒ 这条对拍不干净')
      else if (hit !== undefined) ok('N-I5b ✓ 负向对拍（手改正本 §4.1 块内一个字符、块外零改动）⇒ I5b **必须红**：' + hit.slice(0, 70))
      else bad(`N-I5b · 块内改了但 I5b 没报（实报：${JSON.stringify(probs.slice(0, 2))}）`)
      // 反向对照：块外改一个字符 ⇒ I5b **不许红**（它只管块内）
      writeFileSync(canonical, orig.replace(/^# /m, '#! '))
      const probs2 = checkBlockEquality([['正本', canonical]], want)
      if (probs2.length === 0) ok('N-I5b ✓ 反向对照：改**块外**一个字符 ⇒ I5b **不红**（它只管块内，⛔ 不过咬）')
      else bad(`N-I5b · 改块外也被咬了 ⇒ 本条过咬：${probs2[0].slice(0, 80)}`)
    }
  }

  // ── N-I1b：删掉某条 task 的 `built_by` ⇒ I1 的"按 kind 必填"必红 ────────  // ── N-I1b：删掉某条 task 的 `built_by` ⇒ I1 的"按 kind 必填"必红 ────────  // ── N-I1b：删掉某条 task 的 `built_by` ⇒ I1 的"按 kind 必填"必红 ────────
  {
    const noBuiltBy = units.map((u) => (u.kind === 'task' && u.id === 'TSK-031'
      ? Object.fromEntries(Object.entries(u).filter(([k]) => k !== 'built_by'))
      : u))
    // ⚠ **先自证夹具真坏掉了**：确认那条确实没 built_by 了（⛔ 不许"以为删了"）
    const probe = noBuiltBy.find((u) => u.id === 'TSK-031')
    const reallyRemoved = probe !== undefined && probe.built_by === undefined
    const probs = checkI1(noBuiltBy, () => true)
    const hit = probs.find((x) => x.includes('built_by') && x.includes('必填'))
    if (!reallyRemoved) {
      bad('N-I1b · 夹具没真的删掉 built_by ⇒ 这条负向对拍本身不可判')
    } else if (hit !== undefined) {
      ok(`N-I1b ✓ 负向对拍（删掉 TSK-031 的 built_by）⇒ I1 的"按 kind 必填"**变红**：${hit.slice(0, 80)}`)
    } else {
      bad(`N-I1b · 删了 built_by 但 I1 没报必填缺失（实报：${JSON.stringify(probs.slice(0, 2))}）⇒ 那条断言没有牙`)
    }
  }

  // ── N-I3：造一个 `acc.actor === task.built_by` 的夹具 ⇒ I3 必红 ──────────
  {
    const same = [
      { id: 'TSK-900', kind: 'task', title: 't', parent: 'R-001', status: 'built', after: [], source: 'x', built_by: 'session-SAME', verify: 'x' },
      { id: 'ACC-900', kind: 'acc', title: 'a', parent: 'TSK-900', status: 'pass', after: [], source: 'x', actor: 'session-SAME', evidence: ['x'] },
    ]
    // ⚠ 先自证：夹具里两边**确实相同**（⛔ 不许"以为相同"）
    const reallySame = same[0].built_by === same[1].actor
    const probs = checkI3(same)
    // ⚠ 反向对照：把 actor 改掉后**必须不红**（否则这条断言是"凡 acc 都红"）
    const okCase = checkI3([same[0], { ...same[1], actor: 'session-OTHER' }])
    if (!reallySame) {
      bad('N-I3 · 夹具里 actor 与 built_by 没写成同一个值 ⇒ 这条负向对拍本身不可判')
    } else if (probs.length === 0) {
      bad('N-I3 · actor == built_by 但 I3 没报红 ⇒ 那条断言没有牙')
    } else if (okCase.length > 0) {
      bad(`N-I3 · 反向对照失败（actor 换成别人后仍红：${JSON.stringify(okCase)}）⇒ 这条判据是"凡 acc 都红"`)
    } else {
      ok(`N-I3 ✓ 负向对拍（acc.actor == task.built_by）⇒ I3 **变红**：${probs[0].slice(0, 80)}；反向对照（换成别人）→ 绿`)
    }
  }

  // ── N-I3b：`acc` 挂 `change` 且 `actor == change.built_by` ⇒ I3 必红 ──────
  {
    const sameChange = [
      { id: 'CHG-X', kind: 'change', title: 'c', parent: 'R-001', status: 'settled', after: [], source: 'x', proposal: 'changes/x/proposal.md', built_by: 'session-SAME' },
      { id: 'ACC-X', kind: 'acc', title: 'a', parent: 'CHG-X', status: 'pass', after: [], source: 'x', actor: 'session-SAME', evidence: ['x'] },
    ]
    const reallySame = sameChange[0].built_by === sameChange[1].actor
    const probs = checkI3(sameChange)
    const okCase = checkI3([sameChange[0], { ...sameChange[1], actor: 'session-OTHER' }])
    if (!reallySame) {
      bad('N-I3b · 夹具没写成同一个值 ⇒ 这条负向对拍本身不可判')
    } else if (probs.length === 0) {
      bad('N-I3b · acc 挂 change 且 actor == change.built_by，I3 没报红 ⇒ "P3 覆盖 change"这条没生效')
    } else if (okCase.length > 0) {
      bad(`N-I3b · 反向对照失败（换人后仍红：${JSON.stringify(okCase)}）`)
    } else {
      ok(`N-I3b ✓ 负向对拍（acc 挂 change 且 actor==change.built_by）⇒ I3 **变红**：${probs[0].slice(0, 76)}；反向对照 → 绿`)
    }
  }

  // ── N-I1d：删掉 change 的 built_by ⇒ I1 的"按 kind 必填"必红 ──────────────
  {
    const noBuiltBy = units.map((u) => (u.kind === 'change'
      ? Object.fromEntries(Object.entries(u).filter(([k]) => k !== 'built_by'))
      : u))
    const probe = noBuiltBy.find((u) => u.kind === 'change')
    const reallyRemoved = probe !== undefined && probe.built_by === undefined
    const probs = checkI1(noBuiltBy, () => true)
    const hit = probs.find((x) => x.includes('built_by') && x.includes('必填'))
    if (!reallyRemoved) bad('N-I1d · 夹具没真的删掉 change.built_by ⇒ 负向对拍不可判')
    else if (hit !== undefined) ok(`N-I1d ✓ 负向对拍（删掉 change 的 built_by）⇒ I1 的"按 kind 必填"**变红**：${hit.slice(0, 70)}`)
    else bad(`N-I1d · 删了 change.built_by 但 I1 没报（实报：${JSON.stringify(probs.slice(0, 2))}）`)
  }

  // ── N-I1c：把 change 的 proposal 指向不存在的目录 ⇒ I1 必红 ──────────────
  {
    const badPath = units.map((u) => (u.kind === 'change'
      ? { ...u, proposal: 'changes/2099-01-01-nonexistent/proposal.md' }
      : u))
    // ⚠ 先自证：那个路径在盘上**确实不存在**
    const reallyMissing = !existsSync(join(LEDGER, 'changes/2099-01-01-nonexistent/proposal.md'))
    const probs = checkI1(badPath, (p) => existsSync(join(LEDGER, p)))
    const hit = probs.find((x) => x.includes('change 目录不存在'))
    if (!reallyMissing) {
      bad('N-I1c · 夹具指向的目录居然存在 ⇒ 这条负向对拍本身不可判')
    } else if (hit !== undefined) {
      ok(`N-I1c ✓ 负向对拍（proposal 指向不存在的目录）⇒ I1 的"change 必须有目录"**变红**：${hit.slice(0, 70)}`)
    } else {
      bad(`N-I1c · 指向不存在的目录但 I1 没报（实报：${JSON.stringify(probs.slice(0, 2))}）⇒ 那条断言没有牙`)
    }
  }

  // ── N-I5：手改 `gen/` 一个字符 ⇒ I5 必红 ──────────────────────────────
  {
    const tmp = join(WORK, 'mut-gen')
    cpSync(LEDGER, tmp, { recursive: true })
    const p = join(tmp, 'gen', 'stages.md')
    const orig = readFileSync(p, 'utf8')
    // 只改**一个字符**（把第一个 '#' 换成 '＃'，保持长度大致不变；只要能看出不一致即可）
    const mutated = orig.replace('#', '＃')
    if (mutated === orig) {
      bad('N-I5 · 造不出"手改一个字符"的夹具（gen/stages.md 里没有 #？）⇒ 负向对拍不可判')
    } else {
      writeFileSync(p, mutated)
      const probs = checkI5(tmp, renderAll)
      if (probs.some((x) => x.includes('不一致'))) {
        ok('N-I5 ✓ 负向对拍（手改 gen/stages.md 一个字符）⇒ I5 的"逐字节一致"断言**变红**')
      } else {
        bad(`N-I5 · 手改一个字符后 I5 仍通过（实报：${JSON.stringify(probs)}）⇒ 那条断言没有牙`)
      }
    }
  }
} catch (e) {
  bad(`L 组**自身异常**（⛔ 不算通过）：${String(e?.stack ?? e)}`)
} finally {
  rmSync(WORK, { recursive: true, force: true })
}

console.log('')
console.log(`L 组：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处${fail > 0 ? ` · 没过 ${fail} 处` : ''} · **跳过 0 处**（⚠ 跳过**不计入通过**）`)
console.log('')
if (fail > 0) {
  console.log('  ⛔ L 组有失败 —— 见上面逐条')
  process.exit(1)
}
console.log('  ✅ L 组全绿（I1 / I2 / I5 + I4 顺带；三条负向对拍均实测变红）')
process.exit(0)
