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
import { dirname, join, posix, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { KIND_SPEC, renderStages, parseTomlSubset, readUnits, summarizeStep, LEDGER_DIR, SEND_BACK_TARGETS, renderSpecArtifacts, REQ_PRIORITIES, BUDGET_KEYS, PARENT_VS_AFTER, EVIDENCE_PARENT_KINDS } from './gen-ledger.mjs'

const here = dirname(fileURLToPath(import.meta.url))
/**
 * ⚠ **共享收敛判定**（2026-10-31 P42b/R4b）：`checkI7`/`checkI8` 现在转调它，
 *   ⛔ 不再各留一份实现（`TASK-R4b.md` §一.2「⛔ 不许在脚本里留第二份实现」）。
 *   ⚠ 用 `pathToFileURL` 载 `.ts`：本仓 `check:stages-route` 早已这么干（Node 22 类型剥离）。
 */
const convMod = await import(pathToFileURL(join(here, '..', 'src', 'shared', 'convergence.ts')).href)
/**
 * ⚠⚠ **组合层判据 P-1 的唯一实现**（2026-11-01 P40/R6 · `TASK-R6.md` §2.1 / §2.3）。
 *   载的是**真源码** `src/shared/portfolio.ts`（Node 22 内置类型剥离），⛔ 本文件不重写它 ——
 *   面板（`src/shared/stages-index.ts`）与生成器（`scripts/gen-ledger.mjs`）用的是**同一份**。
 *   ⚠ 载入失败 ⇒ `undefined`，P-1 报「判不出」而⛔ 不是静默当 0 条。
 */
const portfolioMod = await import(pathToFileURL(join(here, '..', 'src', 'shared', 'portfolio.ts')).href).catch(() => undefined)
const portfolioOfShared = portfolioMod?.portfolioOf


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
/**
 * ⚠ **第三档：跳过**（2026-11-02 · P50/B1 · `TASK-B1.md` §一第 3 件）。
 *   与 `check-gitignore.mjs` 的同名档同口径：**跳过 ≠ 通过**，⛔ 不进 `pass`。
 *   ⚠ 为什么必须单列：`goal = 0` 时三条覆盖检查**一条也判不了**，
 *     若塞进 `ok` ⇒ "目标层没做"被洗成"目标层全对"；若塞进 `bad` ⇒ 上线即红（用户裁决禁止）。
 *   ⇒ 它有自己的计数，且在处级口径里单独印出来。
 */
const skip = []
const noteSkip = (m) => { skip.push(m); console.log(`  ${m}`) }
const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail++; console.log(`  ✗ ${m}`) }

/**
 * ⚠⚠ **2026-10-31 P41/R3：本文件既是脚本、又是判据库。**
 *   `check-convergence.mjs` 要**同源复用** `checkI7` / `checkI8`（`TASK-R3.md` §二 明写
 *   "⛔ 不另写一套口径"），而 `import` 一个模块会执行它的顶层代码 ——
 *   不加守卫的话，收敛组一跑就把整个 L 组重跑一遍（实测：`K 组` 输出里混进了 13 行 L 组断言）。
 *   ⇒ 用"是不是主模块"判断：被 import 时只导出函数，⛔ 不跑断言、⛔ 不 `process.exit`。
 */
const IS_MAIN = process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === resolvePath(process.argv[1])

if (IS_MAIN) {
  rmSync(WORK, { recursive: true, force: true })
  mkdirSync(WORK, { recursive: true })
  console.log('')
  console.log('L 组：ledger-next · 三条不变式（I1 / I2 / I5）')
  console.log('')
}

/**
 * **按 kind 必填的字段**（任务书 §二那张表的逐条落地）。
 * ⚠ 顺序 = 表里的顺序，便于对着读。
 */
/**
 * **存量豁免名单：`verify` 只有结论、没有出处的 task**（2026-10-31 P30 新增判据时的实测存量）。
 *
 * ⚠⚠ **这是"棘轮"，⛔ 不是白名单**：
 *   · 只许**缩**（改了其中一条 ⇒ 从本名单删掉它）；
 *   · ⛔ 不许**长**（新增一条就要进名单 = 把这条判据拆掉）。
 * ⚠ 每一个 id 都**逐个点名**，⛔ 不用"数量 ≤ N"那种软条件 —— 那可以被换个 id 蒙过去。
 * ⚠ 下一轮把它们逐条补上出处后，本名单应当**清空**。
 */
export const STORED_VERIFY_NO_CITE = [
  /**
   * ⚠⚠ **2026-10-31 P31：本名单已清空** ───────────────────────
   *   P30 建立本名单时的 5 条存量（`TSK-038/040/041/044/045`）已在 P31 **逐条补上可核出处**：
   *     · TSK-038 → `CHG-281` §一（43 个与 `seq=3646` 逐名一致 · 9/9 全在）
   *     · TSK-040 → `CHG-285` §三（工作区 2 笔已提交 · 76 行未提交 · `check:all` exit 0）
   *     · TSK-041 → `CHG-286` §一（两仓共 10 笔：工作区 7 + 账本区 3）
   *     · TSK-044 → `CHG-290` §一（`^> = 0 · `^<` = 1 · `cmp=0` · 56962 → 56816）
   *     · TSK-045 → `CHG-292` §二（4950 行全部有判决 A5/B1/C4937/D7）
   *   ⇒ ⚠ **本数组必须保持为空**：一旦又有 id 进来，就是"又一条只有结论没有依据的记录"。
   */
]

/**
 * ⭐ **存量豁免名单**（2026-10-31 P40/R2 · `TASK-R2.md` §五）
 *
 * ── 它是什么 ────────────────────────────────────────────────────────
 *   R2 给五类既有单元加了新字段（`req.acceptance_ids` / `task.verify_refs` / `acc.basis` …），
 *   而账本里 **95 条存量单元**大多是在这些字段存在之前记的。
 *   ⛔ **不许**用"新字段一律不强制"来绕（那等于本轮白做 —— 判据写了个摆设）；
 *   ⛔ **也不许**逼人给三年前的一轮执行补一条当时没记的证据（那是**逼人编**）。
 *   ⇒ 本仓既定形态（同 `STORED_VERIFY_NO_CITE`）：**存量豁免、增量必红**，
 *     且名单**只减不增**（`I-E1` 咬住），**每一条都打印原因与清理计划**。
 *
 * ── ⚠ 本轮的实测处置（**先回溯，回溯不了才豁免**）────────────────────
 *   ① **能回溯的，一律回溯（⛔ 不进名单）**：
 *      · `task` 29 条 `built` —— 它们原有 `verify` **本就是读数原文**
 *        （如 `check:exec-progress 22/22 · check:stages-dom 30/30（第 20 轮收口读数）`）
 *        ⇒ 逐条抽成 **29 条 `EVD-` 证据单元**（`reading` 逐字抄，⛔ 不转述），
 *          任务侧补 `verify_refs` 指过来。⇒ `I7` **0 处问题**，⛔ 无豁免。
 *      · `req` 3 条（`R-002`/`R-003`/`R-004`）—— 其下有 task，task 下有 acc，
 *        parent 链走得通 ⇒ 补 `acceptance_ids`。⇒ 这三条也⛔ 无豁免。
 *
 *   ② **回溯不了的 5 条，进名单（附原因与清理计划）**：
 *      这 5 条需求在账本里**从来没有过 `acc` 单元** —— 它们的覆盖目前只由
 *      `check:stages-dom` / `check:presets` / `check:orch` 的判据**间接**支撑，
 *      而 `acc` 单元要求 `actor`（谁验的）+ `evidence`（读数）两项。
 *      读数我能指出来，**"谁验的"我编不出来**（⛔ 编一个 actor 就是把"我的推断"
 *      洗成"一次真验收"，那正是本仓最忌的形态）。
 *      ⇒ **不补假 acc，进名单并写明清理计划**。
 *
 * ⚠⚠ 名单里的每一条都是**承认这条覆盖是假的**（`TASK-R2.md` §五3 要求逐条打印原因）。
 *   本轮 5 条 = 棘轮起点；往后只许减。
 *   ⚠⚠ **2026-10-31 P41/R3 订正（`REVIEW-R2.md` §五2）**：原先 `plan` 写着「R3 补一条真 acc」，
 *     那是把"编"写成了计划。现改为「**等真人验过再补**」—— 没人真验过的需求，⛔ 不许为它编 acc。
 *     名单长度保持 **5**（⛔ 不许借这次改措辞顺手删条目）。
 *
 * ⚠⚠ **本数组只许变短，不许变长**（`I-E1` 逐轮核）。
 *   加一条进来 = 承认"这条覆盖是假的"，必须同时写清为什么、何时清。
 */
export const STORED_NO_NEW_FIELD = [
  {
    id: 'R-001',
    why: '需求「五步主线各步有状态且可展开」账本里从无 `acc` 单元：它的覆盖只由 `check:stages-route` / `check:stages-dom` 间接支撑，而 `acc` 要 `actor`（谁验的）+`evidence`——读数指得出，"谁验的"我不编。',
    plan: '**等真人验过再补** —— 只有当真有人（非实施者）给出 `actor` 与读数之后才补 `acc`，那时删本行。⛔ 不许为它编一条 acc。',
  },
  {
    id: 'R-005',
    why: '需求「面板只读、零百分比/零进度条/零勾选」账本里从无 `acc`：其覆盖由 `check:stages-dom` 的 S-* 判据支撑，但那条需求定稿时并无人写过验收单元。',
    plan: '**等真人验过再补** —— 真有人验过 `check:stages-dom` 的 S-* 读数并给出 `actor` 之后才补，那时删本行。',
  },
  {
    id: 'R-006',
    why: '需求「工具面默认可放开、靠禁止清单收窄」账本里从无 `acc`：覆盖由 `check:presets` 的 ⑤o-* 判据支撑，⛔ 无验收单元。',
    plan: '**等真人验过再补** —— 真有人验过 `check:presets` ⑤o-1..⑤o-5 读数并给出 `actor` 之后才补，那时删本行。',
  },
  {
    id: 'R-007',
    why: '需求「档位只管可读范围，与能不能派活无关」账本里从无 `acc`：覆盖由 `check:presets` 的档位判据支撑，⛔ 无验收单元。',
    plan: '**等真人验过再补** —— 真有人验过 `check:presets` 档位读数并给出 `actor` 之后才补，那时删本行。',
  },
  {
    id: 'R-008',
    why: '需求「被判出必须能在界面上看见，不能只落日志」账本里从无 `acc`：覆盖由 `check:orch` 的三条路径判据支撑，⛔ 无验收单元。',
    plan: '**等真人验过再补** —— 真有人验过 `check:orch` 路径 A/B/C 读数并给出 `actor` 之后才补，那时删本行。',
  },
]

/**
 * **I-E1** · 存量豁免名单**只减不增**（`TASK-R2.md` §五3）。
 *
 * ⚠ 比的是**上一轮记录的长度**（下面这个常量），⛔ 不是"比上次跑的时候" ——
 *   后者在两次跑之间被改两次就看不出来了。
 * ⚠ 本轮记录 = **0**（见上）；往后任何一轮把长度加上去 ⇒ 本条当场红。
 *
 * @param {Array<{id:string,why:string,plan:string}>} list - 当前名单
 * @returns {string[]} 问题清单（空 = 绿）
 */
/**
 * ⚠⚠ **棘轮起点 = 5**（2026-10-31 P40/R2 首次实测）。
 *   本轮**先回溯**：29 条 task 的 `verify` → 29 条 `EVD-`；3 条 req 补 `acceptance_ids`
 *   （⇒ `I7` 0 问题、`R-002/003/004` 归零）。
 *   剩下 5 条 req 回溯不了的，才进名单。
 * ⇒ 往后只许 **≤ 5**，且**每减一条都要同批改这个常量**（⛔ 不许只改名单不改常量 —— 那会让棘轮失效）。
 */
export const STORED_NO_NEW_FIELD_MAX = 5
export function checkIE1(list) {
  const problems = []
  const arr = Array.isArray(list) ? list : []
  if (arr.length > STORED_NO_NEW_FIELD_MAX) {
    problems.push(`豁免名单长度 **${arr.length}** > 上一轮记录 **${STORED_NO_NEW_FIELD_MAX}**`
      + ' ⇒ **只减不增**被破坏（⛔ 加豁免 = 承认这条覆盖是假的，必须单开一轮并写明原因）')
  }
  for (const e of arr) {
    const id = String(e?.id ?? '').trim()
    const why = String(e?.why ?? '').trim()
    const plan = String(e?.plan ?? '').trim()
    if (id === '') problems.push('豁免名单里有一条**没写 id**（⛔ 那等于"整类豁免"，是最糟的形态）')
    else {
      if (why === '') problems.push(`豁免 \`${id}\` **没写原因**（⛔ 读者无法判断该不该豁免）`)
      if (plan === '') problems.push(`豁免 \`${id}\` **没写清理计划**（⛔ 那它就是永久的了）`)
    }
  }
  return problems
}

export const REQUIRED_FIELDS = {
  task: ['built_by', 'verify'],
  acc: ['actor', 'evidence'],
  run: ['started_at'],
  cap: ['last_reading'],
  change: ['proposal', 'built_by'],
  req: ['spec'],
}

/**
 * ══ **目标层覆盖：三条检查 + 一个"未落数据"档**（2026-11-02 · P50/B1 · `TASK-B1.md` §一第 2/3 件）══
 *
 * ── 它治什么 ────────────────────────────────────────────────────────
 *   用户裁决（`CHG-2035` 第三行）：「每条活跃需求**恰好一个主目标**」。
 *   ⚠ "恰好一个"是**两个方向的合取**，⛔ 不是一条：少一个（无人承接）与多一个（两个"主"）
 *     都是坏，而且**坏在不同地方** ⇒ 必须分别可判、分别能指到 id。
 *   ⇒ 三条（同时成立才算过，缺一条即红）：
 *     · `GC-1` **至少**：每条 `agreed` 需求至少被一个 goal 的 `req_ids` 覆盖；
 *     · `GC-2` **至多**：每条 `agreed` 需求至多被一个 goal 覆盖（两个"主"目标 ⇒ "主"字失效）；
 *     · `GC-3` 每个 goal **至少**覆盖一条 `agreed` 需求（`req_ids` 空 / 只挂非活跃需求 = 装饰）。
 *
 * ── ⚠⚠ 为什么必须允许 `goal = 0` 而**报"未落数据"**（`TASK-B1.md` §一第 3 件）──────
 *   用户裁决：「⚠ **不许上线即红**」（`DECISIONS.md` §八 刹车纪律）。
 *   ⚠ 但反过来"没有 goal 就跳过、显示绿"是**假读数** —— 那会让"目标层根本没做"和
 *     "目标层全对"变成同一句话（本仓最忌的形态）。
 *   ⇒ 第三条路：`goal = 0` 时**单列一档** `⊘`，⛔ 不进 `ok`（`pass`），也⛔ 不进 `bad`。
 *     `skip` 计入 `skip` 计数，并在处级口径里单独报。
 *
 * ⚠ **本组不写索引**：`goal` 单元由 Hob 自己写（§4.2 账本类写入永不外派）。
 *   这里只读 `units`。
 */

/** `goal = 0` 时的那一行（⚠ 逐字被 `TASK-B1.md` §一第 3 件点名要求，⛔ 别改措辞去凑）。 */
export const GOAL_NOT_LANDED = '⊘ 目标层尚未落数据（goal = 0）⇒ 三条覆盖检查无法执行，⛔ 这不是通过'

/**
 * **档位归属的唯一判定**：`goal = 0` ⇒ `'skip'`，否则 ⇒ `'checked'`。
 *
 * ⚠ 单独抽成函数，是为了让负向对拍 `N-GC0` **测的就是主流程用的那条规则**
 *   （⛔ 夹具里另写一份 `if (goals === 0)` ⇒ 那是两份逻辑，改一处另一处静默过期）。
 */
export function goalLayerBucket(cov) {
  return cov.goals === 0 ? 'skip' : 'checked'
}

/**
 * **目标层报告体**（⚠ 主流程与负向对拍**共用这一个函数**，sink 由调用方注入）。
 *
 * ── 为什么 sink 要注入（这是 `N-GC0` 能诚实成立的关键）──────────────────
 *   若这里直接调模块级的 `ok` / `bad` / `noteSkip`，`N-GC0` 一跑就会**污染真实计数**
 *   （实测：`goal = 0` 那次会多算 1 条跳过，处级口径印成「跳过 2 处」而真实只有 1 处 ——
 *     那正是本仓最忌的"读数说谎"）。
 *   ⇒ sink 作参数传入：主流程传真 sink，`N-GC0` 传影子 sink ⇒ 两边跑的是**同一段判定**，
 *     而影子那次的计数只落在局部变量里。
 *
 * @param {{goals:number,activeReqs:number,gc1:string[],gc2:string[],gc3:string[]}} cov
 * @param {{ok:Function,bad:Function,noteSkip:Function}} sink
 * @returns {'skip'|'checked'} 落在哪个档位
 */
export function reportGoalLayer(cov, sink) {
  const bucket = goalLayerBucket(cov)
  if (bucket === 'skip') {
    sink.noteSkip(GOAL_NOT_LANDED)
    return bucket
  }
  const IDS = [
    ['GC-1', cov.gc1, '每条活跃需求**至少**被一个 goal 覆盖',
      `GC-1 ✓ 目标层·至少：${cov.activeReqs} 条活跃需求**逐条都有 goal 承接**（goal ${cov.goals} 条）`],
    ['GC-2', cov.gc2, '每条活跃需求**至多**被一个 goal 覆盖',
      `GC-2 ✓ 目标层·至多：${cov.activeReqs} 条活跃需求**没有一条被两个 goal 同时认领**（"主"字成立）`],
    ['GC-3', cov.gc3, '每个 goal **至少**覆盖一条活跃需求',
      `GC-3 ✓ 目标层·非空：${cov.goals} 条 goal **每条都承接了至少一条活跃需求**（无装饰目标）`],
  ]
  for (const [id, probs, what, okMsg] of IDS) {
    if (probs.length === 0) sink.ok(okMsg)
    else for (const x of probs) sink.bad(`${id} · ${what}：${x}`)
  }
  return bucket
}

/** 一条需求算"活跃"的判据（⚠ 只写在这里一处，三条检查共用）。 */
const isActiveReq = (u) => u.kind === 'req' && String(u.status) === 'agreed'

/**
 * **GC-1 / GC-2 / GC-3 的纯函数实现**。
 *
 * ⚠ 收 `units` 而⛔ 不自己去读盘：负向对拍要直接喂合成夹具（照 `N-G1` / `N-CF` 的形态）。
 * ⚠ `req_ids` 缺失 / 非数组 ⇒ 按**空数组**处理，并在 `GC-3` 报出来（⛔ 不静默当"覆盖了 0 条"就完事）。
 *
 * @param {Array<Record<string, any>>} units - 单元数组
 * @returns {{ goals: number, activeReqs: number, gc1: string[], gc2: string[], gc3: string[] }}
 */
export function checkGoalCoverage(units) {
  const gc1 = []
  const gc2 = []
  const gc3 = []

  const goals = units.filter((u) => u.kind === 'goal')
  const activeReqs = units.filter(isActiveReq)
  const activeReqIds = new Set(activeReqs.map((u) => String(u.id)))

  /** 每条活跃需求 ← 被哪些 goal 认领（⚠ 一条需求挂两次会在这里出现两次 ⇒ GC-2 抓它）。 */
  const owners = new Map()
  for (const id of activeReqIds) owners.set(id, [])
  for (const g of goals) {
    const reqIds = Array.isArray(g.req_ids) ? g.req_ids.map(String) : []
    for (const rid of reqIds) {
      if (owners.has(rid)) owners.get(rid).push(String(g.id))
    }
  }

  // ── GC-1 至少：每条活跃需求至少被一个 goal 覆盖 ─────────────────────
  for (const r of activeReqs) {
    const mine = owners.get(String(r.id)) ?? []
    if (mine.length === 0) {
      gc1.push(`${r.id}（${JSON.stringify(r.title ?? '')}）：**没有任何 goal 覆盖**（\`agreed\` 需求无人承接）`)
    }
  }

  // ── GC-2 至多：每条活跃需求至多被一个 goal 覆盖 ─────────────────────
  for (const r of activeReqs) {
    const mine = owners.get(String(r.id)) ?? []
    if (mine.length > 1) {
      gc2.push(`${r.id}：**被 ${mine.length} 个 goal 同时覆盖**（${mine.join(' / ')}）`
        + ' ⇒ 一个需求两个"主"目标，"主"字失效')
    }
  }

  // ── GC-3 每个 goal 至少覆盖一条活跃需求 ─────────────────────────────
  for (const g of goals) {
    const raw = g.req_ids
    const reqIds = Array.isArray(raw) ? raw.map(String) : []
    if (!Array.isArray(raw)) {
      gc3.push(`${g.id}：\`req_ids\` **不是数组**（${JSON.stringify(raw)}）⇒ 无法判断它承接了什么`)
      continue
    }
    if (reqIds.length === 0) {
      gc3.push(`${g.id}（${JSON.stringify(g.title ?? '')}）：\`req_ids\` **为空** ⇒ 空目标（装饰），⛔ 目标必须承接至少一条活跃需求`)
      continue
    }
    const hitActive = reqIds.filter((rid) => activeReqIds.has(rid))
    if (hitActive.length === 0) {
      gc3.push(`${g.id}：\`req_ids\` = ${JSON.stringify(reqIds)} **一条活跃需求都没有**`
        + '（挂的全是 draft / dropped / 不存在）⇒ 空目标（装饰）')
    }
  }

  return { goals: goals.length, activeReqs: activeReqs.length, gc1, gc2, gc3 }
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
/**
 * ⭐ **条件式必填**（2026-10-31 P40/R2 · `TASK-R2.md` §三 + §五1）
 *
 * ── 为什么必须是"按状态"而不是"一律必填" ────────────────────────────
 *   `TASK-R2.md` §五1 明写：新字段的强制**按状态生效**，⛔ 不许对未开工的活要求结果
 *   （`task.todo` 豁免 `built_by` / `verify` 就是既有先例，理由写在 `REQUIRED_FIELDS` 上方）。
 *   把 `verify_refs` 对 `todo` 也强制 = **逼人给还没做的事编一份读数**。
 *
 * ── 口径（⚠ 每条都写清"什么状态才要"）──────────────────────────────
 *   · `req` 的 `acceptance_ids`：`agreed` 才要（已定却无人证明 = 假覆盖）；`draft`/`dropped` 不要求。
 *   · `task` 的 `verify_refs`：`built` 才要；`todo`/`doing` 不要求。
 *   · `acc` 的 `basis`：`pass` / `send-back`（**已出判决**）才要；`unverified` 不要求。
 *   · `run` 的 `delivered_at`：`returned` / `refused` 才要（**已回传**就得有投递时刻）。
 *   · `change` 的 `addresses`：`settled` 才要（方案定了就得说清满足哪几条需求）。
 *
 * ⚠⚠ **与 `REQUIRED_FIELDS` 分开写**：那张表是"无条件必填"，这张表是"到那个状态才必填"。
 *   混在一起会让"todo 豁免"这种规则变成特例判断（本仓已踩过：`todo` 豁免靠一个 `Set` 特判）。
 * ⚠ 本表**只声明规则**，实际核对在 `checkI1` 里逐条走（⛔ 不在这里偷偷跑）。
 */
export const CONDITIONAL_FIELDS = [
  { kind: 'req', when: (u) => String(u.status) === 'agreed', field: 'acceptance_ids', why: '需求已定 ⇒ 必须指得出哪几条验收证明它' },
  { kind: 'task', when: (u) => String(u.status) === 'built', field: 'verify_refs', why: '任务说做完了 ⇒ 必须指得出哪几条证据' },
  { kind: 'acc', when: (u) => ['pass', 'send-back'].includes(String(u.status)), field: 'basis', why: '已经出了判决 ⇒ 依据必须能引用证据（⛔ 不是自由文本）' },
  { kind: 'run', when: (u) => ['returned', 'refused'].includes(String(u.status)), field: 'delivered_at', why: '已回传 ⇒ 必须有投递时刻（不变量 1 的落点）' },
  { kind: 'change', when: (u) => String(u.status) === 'settled', field: 'addresses', why: '方案已定 ⇒ 必须说清满足哪几条需求' },
]

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
  /** P30: the ids that hit the stored-exemption list this run (report only, never in problems). */
  const verifyNoCiteStored = []
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
    /**
     * ⚠⚠ **2026-10-31 P29：`todo` 例外（只有这两个字段）** ─────────────────────
     *   病：`TSK-048`（`status = "todo"`）**永远红** —— 一条还没开工的任务
     *     显然没有 `built_by`（谁做的）与 `verify`（验出了什么），要求它们等于
     *     **逼人给未开工的活编一份结果**。
     *   ⇒ 现在：**仅当 `status === "todo"`** 时，`task` 的 `built_by` / `verify` 不要求。
     *   ⚠⚠ **`doing` / `built` 仍然必填**（⚠ 两条负向对拍钉住这一点：N-I1e / N-I1f）。
     *   ⚠ 这不是放宽：`todo` 本来就没有"完成态的证据"，⛔ 把它当已完工来要求才是错的。
     */
    const todoExempt = u.kind === 'task' && u.status === 'todo'
      ? new Set(['built_by', 'verify'])
      : new Set()
    const required = (REQUIRED_FIELDS[u.kind] ?? []).filter((f) => !todoExempt.has(f))
    /**
     * ── ⭐ **条件式必填**（2026-10-31 P40/R2 · `TASK-R2.md` §三 + §五1）──────────
     * ⚠ 规则表在 `CONDITIONAL_FIELDS`（与"无条件必填"分开），这里只负责**执行**。
     * ⚠ 与 I10/I7 是**两层**：这里是"字段在不在"，那边是"引用指得对不对"。
     *   两层都要有 —— 只核引用会漏掉"整条没写"，只核字段会漏掉"写了但指向空气"。
     */
    for (const rule of CONDITIONAL_FIELDS) {
      if (u.kind !== rule.kind) continue
      if (!rule.when(u)) continue
      const v = u[rule.field]
      const missing = v === undefined || v === null
        || (typeof v === 'string' && v.trim() === '')
        || (Array.isArray(v) && v.length === 0)
      /**
       * ⚠⚠ **`delivered_at` 的唯一例外：允许 `delivered_why` 顶替**（2026-10-31 P40/R2）。
       *   理由：投递时刻是**客观读数**，判不出时必须能写"判不出"（宪法 §7），
       *     ⛔ 不许为了满足字段编一个时刻 —— 那比缺字段更坏。
       *   ⚠ **⛔ 不许拿 `why` 顶替**：`why` 说的是 `started_at` 那件事（开始时刻），
       *     两件事混用一个字段 = 又一次"两种原因说成同一句话"（`R-10`）。
       */
      const substituted = rule.field === 'delivered_at'
        && typeof u.delivered_why === 'string' && u.delivered_why.trim() !== ''
      if (missing && !substituted) {
        /**
         * ⚠⚠ **与 I10/I7 共用同一份存量豁免名单**（2026-10-31 P40/R2）。
         *   否则同一条缺口会在 I1 与 I10 各红一次、且只有一处能豁免 —— 读数会重复计。
         *   ⚠ 豁免**只对 `acceptance_ids` 生效**：其余字段（`basis` / `delivered_at` / `addresses`）
         *     本轮**全部回溯补齐了**（见 `STORED_NO_NEW_FIELD` 上方注释的实测处置），
         *     ⛔ 不许拿豁免名单去盖它们 —— 那会把"已回溯"洗成"回溯不了"。
         */
        const exempt = rule.field === 'acceptance_ids'
          && STORED_NO_NEW_FIELD.some((e) => String(e.id) === String(u.id))
        if (!exempt) {
          problems.push(`${u.id}：kind=${u.kind} status=${JSON.stringify(u.status)} ⇒ **条件式必填 \`${rule.field}\` 缺失**（${rule.why}）`)
        }
      }
    }
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
     * ── ⭐ **`task.verify` 必须带可核出处**（2026-10-31 P30 · `TASK-P30` §二）──────────
     *
     * ── 它守什么 ────────────────────────────────────────────────
     *   `verify` 是"这条任务**怎么被验过的**"。⚠ 若它只写「已完成」「通过」「OK」，
     *   那**什么都没说** —— 读者既不知道验了什么，也无法复核。
     *   ⚠ 真实教训：P29 回填 12 条 `verify` 时，全靠**人工**从 12 份 `CHG` 里翻读数 ——
     *     那是**运气**不是机制；换个人写就会写成"已完成"。
     *
     * ── 口径（⚠ 四类出处，命中任一即可）────────────────────────────
     *   `check:<族名>`（判据读数）/ `CHG-<数字>`（决策件）/ `TASK-P<数字>`（任务书）/ `npm run <脚本>`
     *   ⚠ 只对 `kind === "task"` 且 **`status !== "todo"`** 的单元要求
     *     （`todo` 还没开工，⛔ 逼它写出处等于逼人编 —— 与 `built_by` / `verify` 的 todo 例外同一条理由）。
     */
    if (u.kind === 'task' && u.status !== 'todo') {
      const v = typeof u.verify === 'string' ? u.verify : ''
      const CITABLE = /(check:[a-z][a-z0-9-]*|CHG-\d+|TASK-P\d+|npm run \S+)/
      if (v.trim() !== '' && !CITABLE.test(v)) {
        /**
         * ⚠⚠ **存量 5 条按"棘轮"处理，⛔ 不硬拦**（2026-10-31 P30）──────────────
         *   本轮**新增**这条判据时，实测有 **5 条**已有的 `verify` 只有结论、没有出处。
         *   任务书明令 **⛔ 不许顺手改它们**（那是下一轮的事），⚠ 但也要求 `check:ledger-next` **exit 0**。
         *   ⇒ 两条要求同时成立的唯一口径：**存量豁免、增量必红**（本仓既定形态，见 `UD-95` / `E-27` 的反面）：
         *     · 这 5 个 id **逐个点名**（⛔ 不是"数量 ≤ 5"那种能被替换的软条件）；
         *     · **任何一个不在名单里的** task 缺出处 ⇒ **红**（`STORED_VERIFY_NO_CITE`）；
         *     · ⚠ 名单**只许缩不许长**：改了那 5 条里的任意一条 ⇒ 从名单里删掉它（下轮做）。
         */
        if (!STORED_VERIFY_NO_CITE.includes(u.id)) {
          problems.push(`${u.id}：task 的 \`verify\` **没有可核出处**（只有结论、没有依据）：`
            + `\n      ⇒ 实测原文：${JSON.stringify(v.slice(0, 90))}`
            + `\n      ⇒ 必须含至少一个：\`check:<族>\` / \`CHG-<n>\` / \`TASK-P<n>\` / \`npm run …\``
            + `\n      ⇒ 理由：只写「已完成」「通过」这类词，读者**无法复核**，也无法判断是不是编的`)
        } else {
          verifyNoCiteStored.push(u.id)
        }
      }
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

/**
 * **I5c** · `spec/checkpoint.md` 必须**逐字节 == 生成器输出**（2026-10-31 P42/R4 · `TASK-R4.md` §三）。
 *
 * ── 为什么它要和 `gen/**` 同一口径 ────────────────────────────────────
 *   快照的用途是"`resume` 之后核对外面变了什么"。⚠ 一份**手改过的**快照会让那次核对
 *   拿**假读数**当真：它看起来是"当时的照片"，实际是"有人改过的照片"。
 *   ⛔ 过期/被改的快照比没有快照更坏（`CONSTITUTION` §10：没有读数不能陈述为事实）。
 *
 * ⚠ 与 `I5` 分开写（`gen/` vs `spec/`）：`I5` 的清单来自 `renderAll`，
 *   而快照来自 `renderSpecArtifacts` —— 混进去会让 `I5` 去 `gen/` 里找 `checkpoint.md`。
 *
 * @param {string} ledgerDir - `ledger-next/` 目录
 * @param {(units: Array<any>, extra?: object) => Record<string, string>} renderSpec - 生成器
 * @param {object} extra - 外部读数（⚠ 必须与生成器 `main()` 注入的**同一份**，否则逐字节比不了）
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkI5c(ledgerDir, renderSpec, extra = {}) {
  const problems = []
  const units = readUnits(join(ledgerDir, 'units', 'index.toml'))
  const expected = renderSpec(units, extra)
  for (const [name, want] of Object.entries(expected)) {
    const p = join(ledgerDir, 'spec', name)
    let got = null
    try { got = readFileSync(p, 'utf8') } catch { got = null }
    if (got === null) {
      problems.push(`spec/${name} **读不到**（⚠ 先跑 \`npm run gen:ledger\`；⛔ 不许手工补一份）`)
      continue
    }
    if (got !== want) {
      const i = [...got].findIndex((c, k) => c !== want[k])
      problems.push(`spec/${name} 与生成器**不一致**（第 ${i < 0 ? '?' : i + 1} 个字符起；`
        + `实 ${Buffer.byteLength(got, 'utf8')} B vs 期望 ${Buffer.byteLength(want, 'utf8')} B）`
        + ' ⇒ ⛔ 手改的快照会让 `resume` 的核对拿假读数当真')
    }
  }
  return problems
}

/**
 * **C-RESUME** · 恢复入口能不能读到快照（2026-10-31 P42/R4 · `TASK-R4.md` §三）。
 *
 * ── 它判什么（⚠ 只判"读得到 + 判得出有没有"，⛔ **不做自动回滚**）───────────
 *   `TASK-R4.md` §三 明写本轮**只把它接上**：
 *     · 快照**在不在**（在 ⇒ 报字节数；不在 ⇒ 报"没有快照"）；
 *     · 快照里**有没有**那四类读数（单元计数 / 五步三态 / change 收敛 / 外部读数）。
 *   ⛔ **明确不做**：不比对"上次 vs 这次"、不自动回滚、不改任何单元。
 *     —— 那是另一件事，作业书点名本轮不做。
 *
 * @param {string} ledgerDir - `ledger-next/` 目录
 * @returns {{found: boolean, bytes: number|null, sections: string[], missing: string[]}}
 */
export function readCheckpointForResume(ledgerDir) {
  const p = join(ledgerDir, 'spec', 'checkpoint.md')
  let src = null
  try { src = readFileSync(p, 'utf8') } catch { src = null }
  if (src === null) {
    return { found: false, bytes: null, sections: [], missing: ['整份快照缺失'] }
  }
  /** ⚠ 四类读数各自的**可指认锚点**（⛔ 不用"看起来有"来判）。 */
  const WANT = ['## 一、单元计数', '## 二、五步各步三态', '## 三、变更组合视图', '## 四、外部读数']
  const sections = WANT.filter((w) => src.includes(w))
  const missing = WANT.filter((w) => !src.includes(w))
  return { found: true, bytes: Buffer.byteLength(src, 'utf8'), sections, missing }
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

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 2026-10-31 P40/R2 · **四条覆盖判据**（`TASK-R2.md` §四）
 *
 * ⚠ 编号说明（⛔ 必须说清，否则会重号）：
 *   任务书写 **I6 / I7 / I8 / I9**，而 `checkI6` **已被占用**（运行态一致性：索引说未回传、
 *   运行态却查不到它在跑）。⚠ 我不改既有 `I6` 的编号（那会打断 R1/R2 之前的记录引用），
 *   ⇒ 任务书那四条落成 **`I10` / `I7` / `I8` / `I9`**（I6 仍指运行态那条）：
 *     · **需求 → 验收** = `checkI10`（任务书 I6）
 *     · **任务 → 证据** = `checkI7`
 *     · **决策取代双向** = `checkI8`
 *     · **引用不断链** = `checkI9`
 *   ⚠ 这一处**与作业书不符**，已在回传 §4 写明。
 *
 * ⚠⚠ 四条都是**纯函数**（只吃 `units`，⛔ 不读盘、⛔ 不取时间）⇒ 负向对拍可直接喂夹具。
 * ⚠⚠ 每条都有 **判不出 ⇒ 红** 的分支：找不到被引用对象时⛔ 不许静默放过
 *   （"引用指向空气"正是让"覆盖"看起来成立的那种洞）。
 * ══════════════════════════════════════════════════════════════════════════════
 */

/**
 * **I10**（任务书 I6）· 需求 → 验收：`req.status = agreed` ⇒ `acceptance_ids` 非空，
 * 每项指向真实存在的 `acc`，且该 `acc` 能经 `parent` 链指回这条 `req`。
 *
 * ⚠ 「能经 parent 链指回」= 允许 `acc.parent` 是**这条 req 本身**（直接验收需求），
 *   或 `acc.parent` 是挂在这条 req 下的 task/change（`parent` 一跳就指到 req）；
 *   ⛔ 链长只算**到 req 为止**，⛔ 不做无限回溯（环路另有 I1 咬）。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkI10(units) {
  const problems = []
  const byId = new Map(units.map((u) => [u.id, u]))
  const reqs = units.filter((u) => u.kind === 'req')
  if (reqs.length === 0) return problems
  for (const r of reqs) {
    if (String(r.status) !== 'agreed') continue
    const ids = Array.isArray(r.acceptance_ids) ? r.acceptance_ids.map((x) => String(x).trim()).filter((x) => x !== '') : []
    if (ids.length === 0) {
      problems.push(`${r.id}：\`status=agreed\` 但 \`acceptance_ids\` **空** ⇒ 需求已定却无人证明（⛔ 不按通过处理）`)
      continue
    }
    for (const aid of ids) {
      const a = byId.get(aid)
      if (a === undefined) {
        problems.push(`${r.id}：\`acceptance_ids\` 里的 \`${aid}\` **不存在** ⇒ 判不出（⛔ 悬空引用不许放过）`)
        continue
      }
      if (a.kind !== 'acc') {
        problems.push(`${r.id}：\`acceptance_ids\` 里的 \`${aid}\` 是 \`${a.kind}\`（⛔ 不是验收单元）`)
        continue
      }
      // 沿 parent 链最多两跳找这条 req
      let cur = byId.get(String(a.parent ?? ''))
      let reached = false
      for (let hop = 0; hop < 3 && cur !== undefined; hop++) {
        if (cur.id === r.id) { reached = true; break }
        if (cur.kind === 'req') break
        cur = byId.get(String(cur.parent ?? ''))
      }
      if (!reached) {
        problems.push(`${r.id}：验收 \`${aid}\` 的 parent 链**指不回这条需求**（parent=${JSON.stringify(a.parent)}）`
          + ' ⇒ 覆盖是假的（⛔ 随便挂一条 acc 不算证明这条需求）')
      }
    }
  }
  return problems
}

/**
 * **I7** · 任务 → 证据：`task.status = built` ⇒ `verify_refs` 非空，每项指向真实存在的 `evidence`。
 *
 * ⚠ `todo` 豁免（与 `built_by` / `verify` 的既有 todo 例外同一条理由）：
 *   还没开工的任务没有"读数"，⛔ 逼它写出处等于逼人编。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkI7(units) {
  /**
   * ⚠⚠ **不是第二份实现**（2026-10-31 P42b/R4b · `TASK-R4b.md` §一.2）：
   *   唯一实现在 `src/shared/convergence.ts` 的 `verifyRefsProblems`。
   *   `K-2` 也调同一份 —— 两处真相会漂（本仓踩过 `KIND_SPEC` ↔ `STAGE_KIND_STATUSES`）。
   *   ⛔ 别把逻辑复制回来；`check:stages-route` 的 **R-14** 会咬住。
   */
  return convMod.verifyRefsProblems(units)
}

/**
 * **I8** · 决策取代**双向**：`A.supersedes = B` ⇔ `B.superseded_by = A`，且 `B.status` 必须是 `superseded`。
 *
 * ⚠ 三种坏法都要咬住（`TASK-R2.md` §四 I8 的"单边声明 / 状态没跟上"）：
 *   ① A 说取代了 B，B 没说被 A 取代 ⇒ 单边；
 *   ② B 说被 A 取代，A 没说取代了 B ⇒ 单边（反向）；
 *   ③ 两边对上了，但 B 的状态还是 `active` ⇒ 状态没跟上。
 * ⚠ `supersedes` / `superseded_by` **允许为空**（首条决策没有前身）——
 *   ⛔ 空不是缺陷，**只核非空时的双向一致性**。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkI8(units) {
  /**
   * ⚠⚠ **不是第二份实现**：唯一实现在 `src/shared/convergence.ts` 的
   *   `decisionChainProblems`；`K-5` 也调同一份。
   */
  return convMod.decisionChainProblems(units)
}

/**
 * **I9** · 引用不断链：任一单元的 `risk_ids` / `addresses` / `decisions` 里出现的 id 必须真实存在。
 *
 * ⚠ 顺带核 `affects`（`risk` 的"影响哪些单元"）与 `evidence_refs`（`run` 的"产出了哪几条证据"）——
 *   它们同样是"指向别的单元"的引用，⛔ 漏掉它们就等于留一条不断链的缝。
 * ⚠ 悬空引用**看起来完全正常**（表格照样渲染），这正是要咬的形态。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkI9(units) {
  const problems = []
  const ids = new Set(units.map((u) => String(u.id)))
  /** 字段 → 被引用者必须是什么 kind（空数组 = 不限 kind） */
  const REF_FIELDS = {
    risk_ids: ['risk'],
    addresses: ['req'],
    decisions: ['decision'],
    affects: [],          // risk 的影响面：可以是任何单元
    evidence_refs: ['evidence'],
    acceptance_ids: ['acc'],
    basis: ['evidence'],
    basis_readings: [],
  }
  for (const u of units) {
    for (const [f, allowed] of Object.entries(REF_FIELDS)) {
      const v = u[f]
      if (v === undefined || v === null) continue
      const arr = Array.isArray(v) ? v : [v]
      for (const raw of arr) {
        const ref = String(raw).trim()
        if (ref === '') continue
        if (!ids.has(ref)) {
          problems.push(`${u.id}：\`${f}\` 里的 \`${ref}\` **不存在** ⇒ 悬空引用（⛔ 那会让"覆盖"看起来成立）`)
          continue
        }
        if (allowed.length > 0) {
          const t = units.find((x) => String(x.id) === ref)
          if (t !== undefined && !allowed.includes(t.kind)) {
            problems.push(`${u.id}：\`${f}\` 里的 \`${ref}\` 是 \`${t.kind}\`（应为 ${allowed.join(' / ')}）`)
          }
        }
      }
    }
  }
  return problems
}

/**
 * **B-1** · `status = send-back` 而 `send_back_to` 缺失 ⇒ 红（2026-10-31 P42/R4 · `TASK-R4.md` §二）。
 * ⚠ 判决落点：2026-11-01 R5b 起只认 `status`（`outcome` 已删，见 `checkS1`）。
 *
 * ── 为什么"退回到哪"必须写出来 ──────────────────────────────────────
 *   `send-back` 只说"不行"。而"不行"有三种完全不同的处置（退回任务 / 退回方案 / 退回需求），
 *   ⚠ 其中"退回需求"**只有用户能裁**。⛔ 不写清楚 ⇒ 实施会话会把它当成"实现没做到"，
 *   **反复重做一件本来就不该做的事**。
 *
 * ⚠ 取值必须在封闭集 `SEND_BACK_TARGETS` 里 —— ⛔ 不许用自由文本顶替
 *   （`TASK-R4.md` §二 明写「⛔ 不许用自由文本顶替」）。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkB1(units) {
  const problems = []
  for (const a of units.filter((u) => u.kind === 'acc')) {
    /** ⚠ 判决只认 `status`（2026-11-01 R5b 裁定 A：`outcome` 已删，⛔ 不许读它）。 */
    if (accVerdict(a) !== 'send-back') continue
    const to = String(a.send_back_to ?? '').trim()
    if (to === '') {
      problems.push(`${a.id}：\`status=send-back\` 却**没写 \`send_back_to\`** ⇒ 判不出退回到哪一步`
        + '（⚠ 修法：填 `back-to-task` / `back-to-plan` / `back-to-requirement` 之一 —— ⛔ 不许笼统写"重做"）')
      continue
    }
    if (!SEND_BACK_TARGETS.includes(to)) {
      problems.push(`${a.id}：\`send_back_to = ${JSON.stringify(to)}\` **不在封闭集**里`
        + `（只许 ${SEND_BACK_TARGETS.map((x) => `\`${x}\``).join(' / ')}）⇒ ⛔ 自由文本不算分类`)
    }
  }
  return problems
}

/**
 * **B-2** · `status = pass` 却填了 `send_back_to` ⇒ 红（自相矛盾）。
 *
 * ⚠ 为什么这也算错：`pass` 是"验过了"，`send_back_to` 是"退回哪一步" ——
 *   两者**语义互斥**。同时出现说明**有一条是编的**（要么判决错，要么字段是复制粘贴的残留）。
 *   ⛔ 不拦它，账本里就会出现"通过了但退回需求"这种谁也读不懂的行。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkB2(units) {
  const problems = []
  for (const a of units.filter((u) => u.kind === 'acc')) {
    /** ⚠ 判决只认 `status`（同上）。 */
    if (accVerdict(a) !== 'pass') continue
    const to = String(a.send_back_to ?? '').trim()
    if (to !== '') {
      problems.push(`${a.id}：\`status=pass\` 却填了 \`send_back_to = ${JSON.stringify(to)}\``
        + ' ⇒ **自相矛盾**（通过了怎么还要退回？⚠ 必有一条是编的）')
    }
  }
  return problems
}

/**
 * ⭐ **F-6 的存量豁免名单**（2026-11-01 P40/R5 · `TASK-R5.md` §五 F-6 的决策规则）
 *
 * ── 本轮实测（⚠ 决策规则要求把实测数写进回传）───────────────────────
 *   `todo` 任务 **1** 条（`TSK-048`），上游全绿（`R-008` = `agreed` · 所属 `CHG-2026-10-31-tool-policy` = `settled`），
 *   而它**缺 `budget` 与 `scope_paths` 两项** ⇒ 缺 **1** 条 ≤ 3 ⇒ **强制 + 登记同名豁免**。
 *
 * ── 为什么这一条的前提"不成立"（⚠ ⛔ 不许写"历史遗留"）──────────────────
 *   本判据的前提是「**登记时**这两项是**可填的**」。`TSK-048` 登记于 R5 之前，
 *   那时账本里**根本没有 `budget` / `scope_paths` 这两个字段**（它们是 R5 才加的，见
 *   `gen-ledger.mjs` 的 `EXTENDED_FIELDS`）。⇒ 它没有这两项不是"准备度不足"，
 *   是"记账时还没有这两个格子"。⚠ 与 `STORED_G1_NO_RUN`（早于 run 账本）是同一类前提不成立。
 *
 * ── 为什么**不**直接给它补上（⚠ 这是本仓最容易走错的一步）────────────────
 *   `budget` 是**派单方的决定**（用几次调用、几轮），`scope_paths` 是**允许改哪些文件**的决定。
 *   替它写 `tool_calls=12 · rounds=2` 等于**我替用户拍了一个派单预算**，
 *   再把"我的猜测"记成"一次计划" —— 比缺字段坏得多（同 `acc.actor` 不编的理由）。
 *   ⇒ 进名单，等真派它时由派单方给出；那时删本行。
 *
 * ⚠⚠ **只许变短**（`checkReadyE1` 逐轮核）。
 */
/**
 * ⚠⚠ **2026-11-01 P40/R7：本名单已清空，`_MAX` 已降到 0 —— 这是它唯一正确的终局。**
 *
 * ── 为什么能清 ────────────────────────────────────────────────────
 *   唯一那条 `TSK-048` 的 `budget` / `scope_paths` **本轮已按 `DECISIONS.md` §一 填进账本**
 *   （`budget = "tool_calls=40 · rounds=2"` · 五个 `scope_paths`）⇒ 它不再"缺预算"。
 *   ⚠ `TSK-048` 的 `status` **仍是 `todo`**（活没干，⛔ 不许为了让这条豁免消失而改状态）。
 *
 * ── ⚠ 为什么现在就清、而不是留到它开工 ─────────────────────────────
 *   棘轮的口径是"只减不增"⇒ 能减就得减。留着一条**已经没有对象**的豁免，
 *   等于把"这个格子可以空着"当成惯例传下去 —— 而那正是这份名单本来要治的病。
 */
export const STORED_READY_NO_PLAN = []

/**
 * ⭐ **F-7b 的硬边界**（2026-11-01 P40/R7 · `TASK-R7.md` §5.3）。
 *
 * ── 它是什么 ────────────────────────────────────────────────────
 *   `run.report` 从**这一刻起**对新记的 run **强制**；此前的 run 不判。
 *
 * ── ⚠ 为什么需要一个时刻，而不是"一律强制" ────────────────────────
 *   本轮之前 **26** 条 run 的 `report` 全是空 —— 那些是过去 40 多轮记的，
 *   那时账本里没有这个字段，回传件也**多数已经不在盘上**。
 *   ⇒ 一律强制，唯一出路是**编一个路径**（`CONSTITUTION` §7 明令禁止：⛔ 不许拿推断当读数）。
 *
 * ── ⚠ 为什么是这个时刻 ─────────────────────────────────────────
 *   `2026-11-01T00:00:00+08:00` = **P40 这批（R5 / R5b / R6 / R7）的开工日**。
 *   取整天零点而⛔ 不取本轮开工的具体时刻：那样下一个会话重跑时边界会跟着漂，
 *   而"P40 开工日"是个**不会变**的锚。⚠ 它是硬边界，⛔ 不许写成 `now()` 或相对时间。
 */
export const REPORT_REQUIRED_FROM = '2026-11-01T00:00:00+08:00'

/**
 * ══ **A-1** · `after` 与 `parent` 的**误用**（2026-11-01 P40/R8 · `TASK-R8.md` §一.2）════
 *
 * ── ⚠⚠ 作业书给的口径是"两者不许重合"，**实测存量 42 条**，我先逐条分类再定 ──────
 *
 *   实测（`units/index.toml`，130 条单元）：
 *     `task → req`    **2** 条：`TSK-031→R-002` · `TSK-033→R-004`
 *     `task → change` **14** 条（`TSK-034/035/049/050/…→CHG-…`）
 *     `run  → task`   **26** 条（`RUN-001…026`）
 *     ── 合计 **42** 条
 *
 *   ⇒ **按字面口径会一次打红 42 条存量**，而这 42 条**没有一条是误用**：
 *     · `task` 属于它的 `change`，同时**必须等那条 change 先落**（否则在未定的变更上开工）；
 *     · `run` 属于它的 `task`，同时**必须等那条 task 先跑完**（跑完才有 run）；
 *     · `task` 属于它的 `req`，同时等那条 req 定下来（`agreed` 才能开工）。
 *   ⇒ 这三类重合是**流程的结构性必然**，⛔ 不是把 `after` 当 `parent` 用。
 *
 * ── ⚠ 那作业书要防的到底是什么？──────────────────────────────────
 *   要防的是**"只填 `after`、没填 `parent`"**：把该承接的对象塞进 `after`，
 *   于是 `parent` 指向别处（或空），下游"谁在管它"就判错 —— `R-008`/`TSK-048` 正是这个形态
 *   （`TSK-048.parent = CHG-…`、`after = ["R-008"]`：R-008 该被它承接，却只出现在 `after` 里）。
 *   ⚠ 但那个形态**在单条单元自己身上看不出来**（它自身并不"重合"），所以作业书设想的那条断言
 *     从根上就抓不到它 —— 这是我按实测改口径的原因，⛔ 不是嫌它严。
 *
 * ── 本判据实际咬什么（三件，都是"能指认"的错法）──────────────
 *   ① **重合的模式必须在封闭集内**：`task→req` / `task→change` / `run→task` 三类之外的
 *      重合一律红（例如 `req→req`、`acc→…`、`risk→…`）—— 那些没有流程上的必然性。
 *   ② **`task` 的 `parent` 不许指向自己的 `after` 里的 req 而同时 `after` 里还有别的 req**：
 *      即"既属于这条需求、又在等另一条需求" ⇒ 归属与前置打架，必红。
 *   ③ **存量清零**：`STORED_PARENT_AFTER_OVERLAP` 逐条列出（42 条），只减不增；
 *      新增任何一条**不在名单里**的重合 ⇒ 红（逼人想清楚它是不是第 ④ 类误用）。
 *
 * ⚠ 语义的**唯一定义处**是 `gen-ledger.mjs` 的 `PARENT_VS_AFTER`；本判据只核形态，⛔ 不重复定义。
 */
export const PARENT_AFTER_ALLOWED_PATTERNS = [
  'task→req',
  'task→change',
  'run→task',
]

/**
 * ══ **存量名单**（2026-11-01 P40/R9 补 · `TASK-R9.md` §一 · `REVIEW-R8.md` §四）══════
 *
 * ── ⚠⚠ 为什么必须有这个数组（这是 R8 的缺陷，⛔ 别只看成"加个名单"）────────
 *   R8 的注释写的是「③ **存量清零**：`STORED_PARENT_AFTER_OVERLAP` 逐条列出（42 条），
 *   只减不增；新增任何一条**不在名单里**的重合 ⇒ 红」——
 *   **而代码里没有那个数组**，只有一个总数上限 `_MAX = 42`，接线处也只比**总数**。
 *   ⇒ 那是一条**在描述不存在机制的注释**。它放过三种形态：
 *
 *     ① **替换绕过**：删一条旧的、加一条新的 ⇒ 总数仍是 42 ⇒ **绿**。
 *     ② 新增那条若落在**封闭模式集内**（`task→req` 最可能）⇒ 第 ① 条判据也不拦。
 *     ③ ⇒ 两条判据合起来**恰好漏掉"用允许的模式做不允许的事"**这一整档。
 *
 *   ⚠ 这与 `BUDGET_KEYS` 那段注释防的是同一件事：**注释声称一个机制、代码里没有它**。
 *     本仓最忌这个 —— 读注释的人会以为有保护，于是不再去看代码。
 *
 * ── 名单的用法（三道闸，缺一不可）────────────────────────────────
 *   · **闸一（模式）**：重合的 `{kind}→{parentKind}` 必须在 `PARENT_AFTER_ALLOWED_PATTERNS` 内。
 *   · **闸二（逐条）**：**在**名单里 ⇒ 放过（有登记的流程必然性）；**不在**名单里 ⇒ **红**。
 *     ⚠ 这一闸就是 R8 缺的那一闸，也是唯一能挡住"替换绕过"的一闸。
 *   · **闸三（只减不增）**：名单长度 > `_MAX` ⇒ 红。
 *
 * ── ⚠⚠ 名单是**数据**，⛔ 不许让 `checkA1` 自己"自动收编"────────────
 *   自动收编（"今天看到的都记进去"）= **恒绿**，等于把这道闸拆掉。
 *   要加一条，必须**人改这份数组并写 `why`**（改数组 = 一次显式的决定）。
 *
 * ── ⚠ `why` 的写法（`TASK-R9.md` §一 明令）──────────────────────
 *   ⛔ 不许写"历史遗留"/"已有"这种等于没说的。必须写清**这个重合的流程必然性是什么**。
 *   同模式可复用同一句理由，但每条单元各占一条记录（便于单独删除/单独追责）。
 */
export const STORED_PARENT_AFTER_OVERLAP = [
  // ── task→req（2 条）：task 实现这条需求，同时必须等需求定下来才开工 ──
  { id: 'TSK-031', pattern: 'task→req', why: 'task 实现 R-002；`after` 等 R-002 是"需求先定（agreed）才开工"，⛔ 不是第二个归属' },
  { id: 'TSK-033', pattern: 'task→req', why: 'task 实现 R-004；`after` 等 R-004 是"需求先定（agreed）才开工"，⛔ 不是第二个归属' },
  // ── task→change（14 条）：task 属于那条 change，同时必须等 change 落定才开工 ──
  { id: 'TSK-034', pattern: 'task→change', why: 'task 属于 CHG-2026-10-30-rearch；`after` 等该 change 是"变更先 settled 才开工"（在未定的变更上开工 = 白干）' },
  { id: 'TSK-035', pattern: 'task→change', why: 'task 属于 CHG-2026-10-30-rearch；`after` 等该 change 是"变更先 settled 才开工"' },
  { id: 'TSK-049', pattern: 'task→change', why: 'task 属于 CHG-2026-10-30-rearch；`after` 等该 change 是"变更先 settled 才开工"' },
  { id: 'TSK-050', pattern: 'task→change', why: 'task 属于 CHG-2026-10-30-rearch；`after` 等该 change 是"变更先 settled 才开工"' },
  { id: 'TSK-051', pattern: 'task→change', why: 'task 属于 CHG-2026-10-30-rearch；`after` 等该 change 是"变更先 settled 才开工"' },
  { id: 'TSK-052', pattern: 'task→change', why: 'task 属于 CHG-2026-10-30-rearch；`after` 等该 change 是"变更先 settled 才开工"' },
  { id: 'TSK-053', pattern: 'task→change', why: 'task 属于 CHG-2026-10-30-rearch；`after` 等该 change 是"变更先 settled 才开工"' },
  { id: 'TSK-054', pattern: 'task→change', why: 'task 属于 CHG-2026-10-30-rearch；`after` 等该 change 是"变更先 settled 才开工"' },
  { id: 'TSK-055', pattern: 'task→change', why: 'task 属于 CHG-2026-10-30-rearch；`after` 等该 change 是"变更先 settled 才开工"' },
  { id: 'TSK-056', pattern: 'task→change', why: 'task 属于 CHG-2026-10-30-rearch；`after` 等该 change 是"变更先 settled 才开工"' },
  { id: 'TSK-057', pattern: 'task→change', why: 'task 属于 CHG-2026-10-30-rearch；`after` 等该 change 是"变更先 settled 才开工"' },
  { id: 'TSK-058', pattern: 'task→change', why: 'task 属于 CHG-2026-10-30-rearch；`after` 等该 change 是"变更先 settled 才开工"' },
  { id: 'TSK-059', pattern: 'task→change', why: 'task 属于 CHG-2026-10-30-rearch；`after` 等该 change 是"变更先 settled 才开工"' },
  { id: 'TSK-060', pattern: 'task→change', why: 'task 属于 CHG-2026-10-30-rearch；`after` 等该 change 是"变更先 settled 才开工"' },
  // ── run→task（26 条）：run 是那条 task 的一次执行，必须等 task 存在才跑得起来 ──
  ...Array.from({ length: 26 }, (_, i) => {
    const id = `RUN-${String(i + 1).padStart(3, '0')}`
    return { id, pattern: 'run→task', why: 'run 是那条 task 的一次执行记录；`after` 等该 task 是"task 存在才跑得起来"（没有 task 就没有这次执行）' }
  }),
]

/** 名单长度上限（⚠ 第二道闸：只减不增）。实测 42 = 名单长度。 */
export const STORED_PARENT_AFTER_OVERLAP_MAX = 42

/**
 * @param {Array<Record<string, any>>} units - 索引单元
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkA1(units) {
  const problems = []
  const byId = new Map(units.map((u) => [String(u.id), u]))
  for (const u of units) {
    if (!Array.isArray(u.after) || u.after.length === 0) continue
    const parent = String(u.parent ?? '')
    if (parent === '') continue
    if (!u.after.map(String).includes(parent)) continue
    const pk = byId.get(parent)?.kind
    if (pk === undefined) continue // parent 不存在由 I1 报，⛔ 这里不重复
    const pattern = `${u.kind}→${pk}`
    /**
     * ── **闸二（逐条）**：模式合法还不够，**这条单元本身必须登记在名单里** ──
     * ⚠ 这一闸是 R8 缺的那一闸：只有总数上限时，删一条旧的加一条新的就能过（总数不变）。
     */
    const registered = STORED_PARENT_AFTER_OVERLAP.find((e) => e.id === String(u.id))
    if (registered === undefined) {
      problems.push(`${u.id}：新增的 \`after\`/\`parent\` 重合**不在登记名单里**（模式 \`${pattern}\`）`
        + ' ⇒ 想清楚它是不是把该承接的塞进了 `after`（那正是 `TSK-048`/`R-008` 的错法）')
    } else if (registered.pattern !== pattern) {
      problems.push(`${u.id}：登记的模式是 \`${registered.pattern}\`，实际是 \`${pattern}\` ⇒ 名单与实际不符（⛔ 名单不许静默漂）`)
    }
    if (!PARENT_AFTER_ALLOWED_PATTERNS.includes(pattern)) {
      problems.push(`${u.id}：\`after\` 与 \`parent\` 同时指向 \`${parent}\`（模式 \`${pattern}\`）⇒ 这个重合模式没有流程必然性`
        + `（允许的只有 ${PARENT_AFTER_ALLOWED_PATTERNS.join(' / ')}）⇒ 一条单元不能既"属于它"又"在等它"`)
    }
    /**
     * ② 归属与前置打架：`task` 属于 req A，却还在等 req B（B 也是 req）
     *   ⇒ 它到底为哪条需求干活？这是"把该承接的对象塞进 after"的**可指认形态**。
     */
    if (u.kind === 'task' && pk === 'req') {
      const otherReqs = u.after.map(String).filter((x) => x !== parent && byId.get(x)?.kind === 'req')
      if (otherReqs.length > 0) {
        problems.push(`${u.id}：\`parent = ${parent}\`（req）却还在 \`after\` 里等另一条 req ${otherReqs.map((x) => `\`${x}\``).join(' · ')}`
          + ' ⇒ 归属与前置打架（它到底为哪条需求干活？）')
      }
    }
  }
  return problems
}

/**
 * **A-2** · `evidence.parent` 必须是 `EVIDENCE_PARENT_KINDS` 里的 kind
 *   （2026-11-01 P40/R8 · `TASK-R8.md` §四）。
 *
 * ⚠ 允许的 kind 清单的**唯一真相**是 `gen-ledger.mjs` 的 `EVIDENCE_PARENT_KINDS`
 *   —— 本判据从那里读，⛔ 不在这里再抄一份（两处清单 = 两处会漂）。
 * ⚠ 尤其：⛔ **不许挂 `req`** —— 需求的证据必须经 `acc`（第 5 步），
 *   绕过验收直接给需求挂证据 = **自证**。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @param {string[]} allowedKinds - 允许的 parent kind（由调用方从常量传入）
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkA2(units, allowedKinds) {
  const problems = []
  const byId = new Map(units.map((u) => [String(u.id), u]))
  for (const e of units.filter((u) => u.kind === 'evidence')) {
    const parent = String(e.parent ?? '')
    if (parent === '') {
      problems.push(`${e.id}：\`parent\` 是空的 ⇒ 证据必须能指认它是"谁的读数"（⛔ 空不是"判不出"）`)
      continue
    }
    const p = byId.get(parent)
    if (p === undefined) continue // 不存在由 I1 报，⛔ 不重复
    if (!allowedKinds.includes(String(p.kind))) {
      const why = String(p.kind) === 'req'
        ? '⛔ 需求的证据必须经 `acc`（第 5 步）—— 绕过验收直接给需求挂证据 = 自证'
        : `允许的只有 ${allowedKinds.join(' / ')}`
      problems.push(`${e.id}：\`parent = ${parent}\` 是 \`${p.kind}\` ⇒ **不在允许集**（${why}）`)
    }
  }
  return problems
}

/** **F-6-E1** · 上面那份名单**只减不增** + 每条必须有原因与清理计划（照 `checkG1E1` 形态）。 */
export const STORED_READY_NO_PLAN_MAX = 0
export function checkReadyE1(list) {
  const problems = []
  const arr = Array.isArray(list) ? list : []
  if (arr.length > STORED_READY_NO_PLAN_MAX) {
    problems.push(`F-6 豁免名单长度 **${arr.length}** > 上一轮记录 **${STORED_READY_NO_PLAN_MAX}** ⇒ **只减不增**被破坏`)
  }
  for (const e of arr) {
    if (String(e?.id ?? '').trim() === '') problems.push('F-6 豁免名单里有一条**没写 id**（⛔ 那等于整类豁免）')
    else {
      if (String(e?.why ?? '').trim() === '') problems.push(`F-6 豁免 \`${e.id}\` **没写原因**`)
      if (String(e?.plan ?? '').trim() === '') problems.push(`F-6 豁免 \`${e.id}\` **没写清理计划**`)
    }
  }
  return problems
}

/**
 * ⭐ **任务准备度检查**（2026-10-31 P41/R3 · `TASK-R3.md` §七）
 *
 * ── 判什么 ──────────────────────────────────────────────────────────
 *   一条 `task` 能不能开工，⛔ **不看它自己**，看它依赖的：
 *     ① 它的 `parent` 需求必须 `agreed`；
 *     ② 它的 `after` 里列的前置必须都到终态；
 *     ③ 它所属 `change` 必须 `settled`。
 *
 * ── ⚠ 为什么"不看它自己" ────────────────────────────────────────────
 *   一条 `todo` 的任务自己**永远是"待开工"**，它自己身上没有任何信息能说
 *   "现在能不能开工"。能说的只有它的上游：需求定没定、前置完没完、方案定没定。
 *   ⛔ 若只看自己，结论恒为"待开工" —— 那是同义反复，不是检查。
 *
 * ── 输出口径（`TASK-R3.md` §七 明写）─────────────────────────────────
 *   红了要输出「**这条任务还不该开工，卡在 X**」，⛔ 不许只说"不满足"。
 *   ⇒ 每条问题都带 `卡在 <具体单元 id + 它现在的状态>`。
 *
 * ⚠ 只对 `todo` 的任务判（`doing`/`built` 已经开工了，再判"该不该开工"没有意义）。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkReadiness(units) {
  const problems = []
  const byId = new Map(units.map((u) => [String(u.id), u]))
  const FINAL = (u) => {
    const spec = KIND_SPEC[u.kind]
    return spec !== undefined && spec.finals.includes(String(u.status))
  }
  for (const t of units.filter((u) => u.kind === 'task')) {
    if (String(t.status) !== 'todo') continue
    const stuck = []
    /** ① parent 需求必须 agreed */
    const parent = byId.get(String(t.parent ?? ''))
    if (parent === undefined) {
      stuck.push(`卡在 **parent 不存在**（parent=${JSON.stringify(t.parent ?? null)}）`)
    } else if (parent.kind === 'req') {
      if (String(parent.status) !== 'agreed') {
        stuck.push(`卡在 **需求 ${parent.id} 还是 \`${parent.status}\`**（要 \`agreed\` 才能开工）`)
      }
    }
    /** ② after 里的前置必须都到终态 */
    for (const dep of (Array.isArray(t.after) ? t.after : [])) {
      const d = byId.get(String(dep))
      if (d === undefined) {
        stuck.push(`卡在 **after 里的 \`${dep}\` 不存在**（判不出它完没完）`)
      } else if (!FINAL(d)) {
        stuck.push(`卡在 **前置 ${d.id} 还是 \`${d.status}\`**（要终态）`)
      }
    }
    /** ③ 所属 change 必须 settled */
    const chg = units.find((u) => u.kind === 'change' && String(u.id) === String(t.parent))
    if (chg !== undefined && String(chg.status) !== 'settled') {
      stuck.push(`卡在 **方案 ${chg.id} 还是 \`${chg.status}\`**（要 \`settled\`）`)
    }
    /**
     * ④ **F-6**（2026-11-01 P40/R5 · `TASK-R5.md` §五 F-6）：**上游全绿却缺 `budget` / `scope_paths`**
     *   ⇒ 红（"准备度不足就别派"）。
     *
     * ⚠⚠ **为什么它挂在"上游全绿"这一档，而不是无条件要求**：
     *   上游没到位时这条任务**本来就还不该开工**（①②③ 已经说了），此时再要求"先写好预算"，
     *   是在**逼人给一件还开不了的活先定预算** —— 而预算该在**真要派它的时候**定
     *   （派单方决定用几次调用、允许改哪些路径）。⛔ 对还没轮到的活提前编预算，等于把
     *   "我的猜测"洗成"一次计划"。⇒ 只在"**现在就能开工**"的任务上要求这两项。
     * ⚠ 存量豁免见 `STORED_READY_NO_PLAN`（理由写在那边）。
     */
    if (stuck.length === 0 && !STORED_READY_NO_PLAN.some((e) => String(e.id) === String(t.id))) {
      if (t.budget === undefined || t.budget === null || String(t.budget).trim() === '') {
        stuck.push('缺 **`budget`**（要 `tool_calls=N · rounds=M`）⇒ 派活前没定用几次调用、几轮')
      }
      if (!Array.isArray(t.scope_paths) || t.scope_paths.length === 0) {
        stuck.push('缺 **`scope_paths`**（要非空相对路径数组）⇒ 派活前没说清允许改哪些路径')
      }
    }
    if (stuck.length > 0) {
      problems.push(`${t.id}：**这条任务还不该开工** —— ${stuck.join(' · ')}`)
    }
  }
  return problems
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * **四条前置状态门禁**（2026-10-31 P41/R3 · `TASK-R3.md` §四）
 *
 * ⚠⚠ **只落账本面**：这里读 `units/index.toml` 的**当前态**判"这个状态合法不合法"，
 *   ⛔ **不去拦截写操作** —— 那要改宿主写路径，属**单向门**
 *   （`PROJECT.md` §11.3 · `CHG-218` §二·2），作业书明写"本轮明确不做，也不许顺手做"。
 * ⚠ ⛔ 不碰看板、⛔ 不碰别的项目、⛔ 不新增权限面。
 *
 * ⚠⚠ **为什么"读当前态"能判"转换"**：账本里没有历史态（只有当前 `status`），
 *   所以每条门禁必须**从当前态反推出"它是不是跳过了某个必经状态"**：
 *   看它有没有留下"跳过的证据"（`built` 却没有 `run` 到 `returned`、
 *   `built` 却没有 `doing` 期间的痕迹 ……）。
 *   ⚠ 判不出就报"判不出 ⇒ 红"，⛔ 不许默认合法。
 * ══════════════════════════════════════════════════════════════════════════════
 */

/**
 * ⭐ **G-1 的存量豁免名单**（2026-10-31 P41/R3 · 同 `STORED_NO_NEW_FIELD` 的形态）
 *
 * ── 为什么要它（⚠ 这是"判据前提不成立"，不是"网开一面"）─────────────────
 *   G-1 的推理是「`built` + 零 run ⇒ 跳过了 `doing`」。这条推理**依赖一个前提**：
 *   "run 账本在该任务执行时就已存在"。⚠ 实测这个前提对 3 条**不成立**：
 *     · `RUN-001` 的 parent 是 `TSK-034`（第 27 轮）——**run 账本从那时才开始记**；
 *     · `TSK-031/032/033` 分别是第 20/21/22 轮（`verify` 里写着「第 20/21/22 轮收口读数」）。
 *   ⇒ 它们**没有 run 不是"跳过 doing"，是"当时还没有 run 这个记账对象"**。
 *   ⛔ 若不给这条名单，判据会把这 3 条**永久判红**；而"恒红的判据等于没有判据"
 *     （`REPORT-R225.md` §3.4-b 首选条）。
 *   ⛔ 若直接删掉 G-1，则"真的跳过 doing"也一起放过了 —— 两个坏选择之间，
 *     本仓既定形态是：**存量点名豁免 + 增量必红**（同 `STORED_VERIFY_NO_CITE`）。
 *
 * ⚠⚠ **只许变短**（`checkG1E1` 逐轮核）：这三条是**历史事实**，不是待办；
 *   一旦有人真补出 run 记录，就必须同批把该行删掉。
 */
export const STORED_G1_NO_RUN = [
  { id: 'TSK-031', why: '第 20 轮任务，早于 run 账本（RUN-001 从 TSK-034 / 第 27 轮才开始记）⇒ 无 run 属记账起点问题，⛔ 不是跳过 doing', plan: '若日后回填该轮的 run 记录，删本行' },
  { id: 'TSK-032', why: '第 21 轮任务，同上（早于 run 账本）', plan: '若日后回填该轮的 run 记录，删本行' },
  { id: 'TSK-033', why: '第 22 轮任务，同上（早于 run 账本）', plan: '若日后回填该轮的 run 记录，删本行' },
]

/**
 * **G-1-E1** · 上面那份名单**只减不增** + 每条必须有原因与清理计划。
 *
 * @param {Array<{id:string,why:string,plan:string}>} list - 当前名单
 * @returns {string[]} 问题清单（空 = 绿）
 */
export const STORED_G1_NO_RUN_MAX = 3
export function checkG1E1(list) {
  const problems = []
  const arr = Array.isArray(list) ? list : []
  if (arr.length > STORED_G1_NO_RUN_MAX) {
    problems.push(`G-1 豁免名单长度 **${arr.length}** > 上一轮记录 **${STORED_G1_NO_RUN_MAX}** ⇒ **只减不增**被破坏`)
  }
  for (const e of arr) {
    if (String(e?.id ?? '').trim() === '') problems.push('G-1 豁免名单里有一条**没写 id**（⛔ 那等于整类豁免）')
    else {
      if (String(e?.why ?? '').trim() === '') problems.push(`G-1 豁免 \`${e.id}\` **没写原因**`)
      if (String(e?.plan ?? '').trim() === '') problems.push(`G-1 豁免 \`${e.id}\` **没写清理计划**`)
    }
  }
  return problems
}

/**
 * **G-1** · `task` 从 `todo` 直接到 `built`（跳过 `doing`）。
 *
 * ⚠ 反推口径：一条 `built` 的 task 若**没有任何 `run` 指向它**，
 *   就说明它没经历过"在执行"这一段 —— 而 `doing` 的唯一含义就是"有 run 在跑"。
 *   ⇒ `built` + 零 run ⇒ 判"跳过了 doing"。
 * ⚠ `todo` / `doing` 的 task ⛔ 不受此条约束（还没到终态，谈不上"跳过"）。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkG1(units) {
  const problems = []
  const runs = units.filter((u) => u.kind === 'run')
  const tasks = units.filter((u) => u.kind === 'task')
  for (const t of tasks) {
    if (String(t.status) !== 'built') continue
    const myRuns = runs.filter((r) => String(r.parent) === String(t.id))
    if (myRuns.length === 0) {
      // ⚠ 存量豁免（理由见 `STORED_G1_NO_RUN` 上方）：早于 run 账本的 3 条不据此判红
      if (STORED_G1_NO_RUN.some((e) => String(e.id) === String(t.id))) continue
      problems.push(`${t.id}：\`status=built\` 却**没有任何 run 指向它** ⇒ 判"从 \`todo\` 直接到 \`built\`（跳过 \`doing\`）"`
        + '（⚠ 修法：补一条真实 run，或说明它为何无需执行 —— ⛔ 不许两边都不动）')
    }
  }
  return problems
}

/**
 * **G-2** · `run` 未 `returned` 就把对应 `task` 记 `built`。
 *
 * ⚠⚠ 作业书 §五 点名"最容易被顺手放过"的两条之一。
 *   口径：`task.status = built` ⇒ 它的 run 里**至少有一条** `status = returned`。
 *   一条 run 都没有 ⇒ 那是 G-1 的活（这里不重复报，⛔ 免得一条缺口红两次）。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkG2(units) {
  const problems = []
  const runs = units.filter((u) => u.kind === 'run')
  for (const t of units.filter((u) => u.kind === 'task')) {
    if (String(t.status) !== 'built') continue
    const myRuns = runs.filter((r) => String(r.parent) === String(t.id))
    if (myRuns.length === 0) continue   // G-1 管这一档
    const returned = myRuns.filter((r) => String(r.status) === 'returned')
    if (returned.length === 0) {
      const got = myRuns.map((r) => `${r.id}=${JSON.stringify(r.status)}`).join(' / ')
      problems.push(`${t.id}：\`status=built\` 而它的 run **没有一条到 \`returned\`**（实测：${got}）`
        + ' ⇒ **没回传就记 built**')
    }
  }
  return problems
}

/**
 * **G-3** · `acc.actor` 等于被验对象的 `built_by`。
 *
 * ⚠ 与既有 `checkI3` **同一件事**，但作业书要求它作为**门禁**独立可调（§四 G-3）。
 *   ⇒ 这里**复用** `checkI3`（⛔ 不重写判定），只在消息前缀上标明是 G-3 这条门禁在拦。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkG3(units) {
  return checkI3(units).map((p) => `G-3 拦截：${p}`)
}

/**
 * **G-4** · `req` 从 `draft` 直接到 `dropped` 而没有 `source` 说明为什么丢。
 *
 * ⚠ 反推口径：`dropped` 的需求**必须**说清为什么不做（`source` 或 `drop_why` 非空）。
 *   账本里没有"曾经是 draft"的历史 ⇒ 判据只能落在"丢掉时有没有留下理由"这一条上。
 *   ⚠ `agreed` / `draft` ⛔ 不受此条约束。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkG4(units) {
  const problems = []
  for (const r of units.filter((u) => u.kind === 'req')) {
    if (String(r.status) !== 'dropped') continue
    const why = [r.drop_why, r.source].filter((x) => typeof x === 'string' && x.trim() !== '')
    if (why.length === 0) {
      problems.push(`${r.id}：\`status=dropped\` 却**没有说明为什么丢**（\`drop_why\` / \`source\` 都空）`
        + ' ⇒ 判"从 \`draft\` 直接到 \`dropped\` 而没有理由"')
    }
  }
  return problems
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * **2026-11-01 P40/R5 · `TASK-R5.md` §二 · G-5 / G-6 / G-7 / G-8（前置状态门禁补齐）
 *
 * ⚠⚠ **全部落账本面**：只读 `units/index.toml` 的**当前态**判"这个状态合不合法"，
 *   ⛔ **不去拦截写操作** —— 那要改宿主写路径，属**单向门**
 *   （`PROJECT.md` §11.3 · `CHG-218` §二·2，`TASK-R5.md` §二 明写"⛔ 不拦写操作"）。
 * ⚠ 与既有 `checkG1..checkG4` **同一族、同一形态**：**判不出 ⇒ 红**，⛔ 不许默认合法。
 * ══════════════════════════════════════════════════════════════════════════════
 */

/**
 * **G-5** · `change.settled` ⇒ `addresses` 里每条需求都 `agreed`。
 *
 * ── 它治什么 ────────────────────────────────────────────────────────
 *   `I9` 只核了「`addresses` 里的 id 是真实存在的 `req`」，**没核那些需求定没定**。
 *   ⇒ 一条方案可以 `settled` 在一条还是 `draft` 的需求上，全绿。**这就是假覆盖**：
 *     方案说"我满足了 R-00x"，而 R-00x 自己还没被定下来 —— 它满足的是一条还没定的东西。
 *
 * ⚠ `addresses` 里的 id **不存在 / 不是 req** ⇒ **I9 已报**，这里**不重复报**
 *   （同 `checkG2` 对 `checkG1` 的让位写法：一条缺口只红一次，否则读数重复计）。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkG5(units) {
  const problems = []
  const byId = new Map(units.map((u) => [String(u.id), u]))
  for (const c of units.filter((u) => u.kind === 'change')) {
    if (String(c.status) !== 'settled') continue
    for (const raw of (Array.isArray(c.addresses) ? c.addresses : [])) {
      const r = byId.get(String(raw).trim())
      /** ⚠ 不存在 / 不是 req ⇒ I9 管，这里让位（⛔ 不重复报）。 */
      if (r === undefined || r.kind !== 'req') continue
      if (String(r.status) !== 'agreed') {
        problems.push(`${c.id}：\`settled\` 却挂在需求 \`${r.id}\` 上，而它还是 \`${r.status}\` ⇒ 方案定在一条没定的需求上`)
      }
    }
  }
  return problems
}

/**
 * **G-6** · `task.built` ⇒ 它所属的 parent change 已到**终态**。
 *
 * ── 口径写死（`TASK-R5.md` §二 G-6）──────────────────────────────────
 *   **终态 = `settled` 或 `superseded`**，⛔ **不是只要 `settled`**。
 *
 * ⚠⚠ **为什么 `superseded` 也算终态（这一条必须留着，⛔ 别"顺手"改严）**：
 *   一条方案后来被取代了，但它下面**已经做完的活是历史事实**。若只认 `settled`，
 *   每取代一条方案就要把它下面所有 `built` 任务判红一次 ⇒ 逼人去**改历史**，
 *   或者被迫给一堆**永久豁免**（那等于把这条判据拆掉）。
 *   ⛔ 要拦的是「**方案还没定就开工**」，⛔ 不是「方案后来被换掉了」——
 *     后者是 `X-1` 管的那一档（它只管 `todo` / `doing`，同样放过 `built`）。
 *
 * ⚠ `parent` **不是 change**（直接挂需求）⇒ 本条**不适用**，⛔ 不报（那一档由 G-5 管）。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkG6(units) {
  const problems = []
  const byId = new Map(units.map((u) => [String(u.id), u]))
  for (const t of units.filter((u) => u.kind === 'task')) {
    if (String(t.status) !== 'built') continue
    const p = byId.get(String(t.parent ?? ''))
    if (p === undefined || p.kind !== 'change') continue
    /** ⚠ 终态 = settled / superseded（见上方长注释：⛔ 不许只写 settled）。 */
    if (String(p.status) === 'proposed') {
      problems.push(`${t.id}：\`built\` 而它所属方案 \`${p.id}\` 还是 \`proposed\` ⇒ 方案没定就开工了`)
    }
  }
  return problems
}

/**
 * **G-7** · `run.returned` ⇒ 它所属 task 已进入执行（`built` 或 `doing`）。
 *
 * ⚠ `todo` ⇒ 红：**没开工怎么会有回传**。
 * ⚠ parent **不存在 / 不是 task** ⇒ 红（**判不出**，⛔ 不放过 —— 同 `checkI3` 的"判不出即红"）。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkG7(units) {
  const problems = []
  const byId = new Map(units.map((u) => [String(u.id), u]))
  for (const r of units.filter((u) => u.kind === 'run')) {
    if (String(r.status) !== 'returned') continue
    const t = byId.get(String(r.parent ?? ''))
    if (t === undefined || t.kind !== 'task') {
      problems.push(`${r.id}：\`returned\` 而它所属的 parent ${JSON.stringify(r.parent ?? null)} **不是 task**（判不出它回传给谁）⇒ ⛔ 不按通过处理`)
      continue
    }
    if (!['built', 'doing'].includes(String(t.status))) {
      problems.push(`${r.id}：\`returned\` 而它所属任务 \`${t.id}\` 还是 \`${t.status}\` ⇒ 没开工就收到了回传`)
    }
  }
  return problems
}

/**
 * **G-8** · `acc.pass` ⇒ 被验对象已到终态。
 *
 * ── 口径（`TASK-R5.md` §二 G-8）──────────────────────────────────────
 *   沿 `parent` 找被验对象（`task` 或 `change`，**一跳**，与 `checkI3` 同一套找法）：
 *     · 对象是 `task`   ⇒ 必须 `built`；
 *     · 对象是 `change` ⇒ 必须 `settled` 或 `superseded`（终态，同 G-6 的理由）；
 *     · 找不到对象     ⇒ 红（**判不出**）。
 *
 * ⚠ `basis` 非空 / 指向真实 `EVD-` 已由 `CONDITIONAL_FIELDS` 与 `I9` 咬住，这里**不重复**。
 *
 * ⚠⚠ **判决只读 `status`**（2026-11-01 R5b 裁定 A：`outcome` 已删，见 `checkS1`）。
 *   ⚠ 记下这段历史：R5 时账本里 28 条 acc 的 `outcome` **全为空**、判决记在 `status` 上
 *   （25 `pass` / 3 `unverified`）。当时若只读 `outcome`，本判据会**一条都不核**
 *   —— 那正是"恒绿的判据等于没有判据"（`REPORT-R225.md` §3.4-b）。
 *   ⇒ R5b 的解法不是"两边都读"（那让两个落点继续活着），而是**删掉 `outcome`**，
 *     只留 `status`，并用 `S-1` 咬住"不许再加回来"。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkG8(units) {
  const problems = []
  const byId = new Map(units.map((u) => [String(u.id), u]))
  for (const a of units.filter((u) => u.kind === 'acc')) {
    if (accVerdict(a) !== 'pass') continue
    let t = byId.get(String(a.parent ?? ''))
    if (t !== undefined && !['task', 'change'].includes(t.kind)) t = byId.get(String(t.parent ?? ''))
    if (t === undefined || !['task', 'change'].includes(t.kind)) {
      problems.push(`${a.id}：\`pass\` 而**找不到它验的那条 task/change**（parent=${JSON.stringify(a.parent ?? null)}）⇒ 判不出（⛔ 不按通过处理）`)
      continue
    }
    if (t.kind === 'task' && String(t.status) !== 'built') {
      problems.push(`${a.id}：\`pass\` 而它验的 \`${t.id}\` 还是 \`${t.status}\` ⇒ 没做完就判过了`)
    } else if (t.kind === 'change' && !['settled', 'superseded'].includes(String(t.status))) {
      problems.push(`${a.id}：\`pass\` 而它验的方案 \`${t.id}\` 还是 \`${t.status}\` ⇒ 方案没定就判过了`)
    }
  }
  return problems
}

/**
 * ⭐ **`acc` 的判决取值** —— **单落点：只读 `status`**。
 *
 * ⚠⚠ **保留这个函数名，是为了让调用点不散**（2026-11-01 P40/R5b · `TASK-R5b.md` §3.1-2）。
 *   它现在是**单落点**：⛔ 不再有 `?? outcome` 这种"兼容写法" ——
 *   兼容 = 两个落点继续活着，下次谁改一个忘另一个仍然会漂（那正是 R5 踩过的坑）。
 * ⚠ 判决的唯一真相是 `KIND_SPEC.acc.statuses`（`pass` / `send-back` / `unverified`）。
 *   `outcome` 字段已从 `EXTENDED_FIELDS` 删除，由 `checkS1` 逐条咬住"出现即红"。
 *
 * @param {Record<string, any>} a - acc 单元
 * @returns {string} 判决字面量（读不到 ⇒ 空串）
 */
export function accVerdict(a) {
  return String(a?.status ?? '').trim()
}

/**
 * **S-1** · 判决只有一个落点：⛔ 任何 `acc` 单元**出现 `outcome` 字段**（无论值是什么）⇒ 红。
 *
 * ── 为什么这条要存在（⚠ 这段注释是本轮的核心，⛔ 别删）─────────────────
 *   R5 的 `REPORT-R5.md` §五-1 自己写了"同一件事两个落点"，而它**只写在报告里** ——
 *   报告不会拦住下一个人的手。写进判据，下一轮的人才改不动它。
 *
 * ⚠⚠ **这条判据治的是一次真实的漂**：R5 给 `check-ledger-next.mjs` 加了 `outcome ?? status`，
 *   而 `src/shared/convergence.ts` 的 K-3 **仍然只读 `outcome`** ⇒ 同一个事实两个落点、已经漂了。
 *   后果：本账本 28 条 acc 的 `outcome` 全空、其中 25 条 `status=pass`，
 *   一旦有 change 的 `addresses` 指向挂着 acc 的需求，K-3 会报「验收都不是 `pass`（实测：ACC-xxx=null）」
 *   —— **那是一句假话**，它的 acc 是 pass 的。当时没红，只因为没被触发。
 *   ⇒ **恒绿只是因为没被触发，不是因为判据对。**
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkS1(units) {
  const problems = []
  for (const a of units.filter((u) => u.kind === 'acc')) {
    if (Object.prototype.hasOwnProperty.call(a, 'outcome')) {
      problems.push(`${a.id}：出现了 \`outcome\` 字段（值 ${JSON.stringify(String(a.outcome ?? ''))}）⇒ 判决只认 \`status\`（同义字段会让两处漂）`)
    }
  }
  return problems
}

/**
 * **X-1** · 作废方案上还在派活（`TASK-R5.md` §四）。
 *
 * 口径：`task.parent` 指向一条 `status = superseded` 的 change，
 *   且该 task 的 `status ∈ {todo, doing}` ⇒ 红。
 *
 * ⚠ `built` 的历史任务**不算**（活已经干完了，是历史事实 —— 同 G-6 的理由：
 *   取代一条方案不该把它下面**已完成**的活判红，否则唯一出路是改历史）。
 * ⚠ 与 G-6 分工：G-6 管"方案没定就开工"（`proposed`），X-1 管"方案作废了还派新活"（`superseded`）。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkX1(units) {
  const problems = []
  const byId = new Map(units.map((u) => [String(u.id), u]))
  for (const t of units.filter((u) => u.kind === 'task')) {
    if (!['todo', 'doing'].includes(String(t.status))) continue
    const p = byId.get(String(t.parent ?? ''))
    if (p === undefined || p.kind !== 'change') continue
    if (String(p.status) === 'superseded') {
      problems.push(`${t.id}：所属方案 \`${p.id}\` 已被取代，而这条任务还是 \`${t.status}\` ⇒ 还在往作废的方案上派活`)
    }
  }
  return problems
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * **2026-11-01 P40/R5 · `TASK-R5.md` §三 · E-1 / E-2 / E-3（证据的"可指认"）
 *
 * ⚠ 背景：`evidence.code_state` 字段 R2 就加了、也强制填，但**全仓没有一条判据读它**
 *   ⇒ 填 `"最新"`、填 `"-"`、填 `"判不出"` 都能过。这是缺口。
 * ══════════════════════════════════════════════════════════════════════════════
 */

/** 可指认的代码态形态：`commit=<40 位十六进制>`（⚠ 允许前后带别的字段，照 `lib/BUILD-STAMP` 的写法）。 */
export const CODE_STATE_COMMIT_RE = /commit=([0-9a-f]{40})(?![0-9a-f])/

/**
 * 从 `code_state` 里取 commit（取不到 ⇒ `null`）。
 *
 * @param {unknown} v - `code_state` 原文
 * @returns {string|null} 40 位十六进制 commit
 */
export function codeStateCommit(v) {
  const m = CODE_STATE_COMMIT_RE.exec(String(v ?? ''))
  return m === null ? null : m[1]
}

/**
 * **E-1** · `code_state` 必须可指认。
 *
 * ── 口径 ────────────────────────────────────────────────────────────
 *   非空，且满足二者之一：
 *     ① 匹配 `commit=<40 位十六进制>`（允许前后带别的字段）；
 *     ② **逐字**是 `判不出`（`CONSTITUTION` §7：判不出就写「判不出」，⛔ 不许填 0 / 拿推断当读数）。
 *   ⛔ 其余一律红：`最新` / `当前` / `N/A` / `-` / 空 / 纯自由文本。
 *
 * ⚠ 为什么"最新"必须红：它不是**读数**，是**指代**。说出"最新"等于什么都没说 ——
 *   三个月后没人知道那天的"最新"是哪份代码，这条读数就**永久不可复核**。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkE1(units) {
  const problems = []
  for (const e of units.filter((u) => u.kind === 'evidence')) {
    const raw = e.code_state
    const v = String(raw ?? '').trim()
    if (v === '') {
      problems.push(`${e.id}：\`code_state\` **是空的** ⇒ 说不出这条读数对应哪份代码（⛔ 空不是"判不出"，判不出要逐字写 \`判不出\`）`)
      continue
    }
    if (codeStateCommit(v) !== null) continue
    if (v === '判不出') continue
    problems.push(`${e.id}：\`code_state = ${JSON.stringify(v.slice(0, 60))}\` **不可指认** ⇒ 说不出这条读数对应哪份代码（⛔ "最新"不是读数；判不出请逐字写 \`判不出\`）`)
  }
  return problems
}

/**
 * 读 `lib/BUILD-STAMP`（⚠ 读不到 / 缺 `commit=` / 缺 `built_at=` ⇒ `null`，⛔ 不猜）。
 *
 * @param {string} root - 工作区根
 * @param {(p:string)=>string} read - 读文件（便于负向对拍注入夹具）
 * @returns {{commit:string, builtAt:string, builtAtMs:number|null}|null}
 */
export function parseBuildStamp(text) {
  const src = String(text ?? '')
  const cm = /^commit=([0-9a-f]{40})\s*$/m.exec(src)
  const bm = /^built_at=(.+?)\s*$/m.exec(src)
  if (cm === null || bm === null) return null
  const ms = Date.parse(bm[1])
  /**
   * ⭐ **`commit_time`**（2026-11-01 P40/R10 · `TASK-R10.md` §二）：
   *   这个 commit 的**提交时刻**。⚠ 与 `built_at` 的区别是本轮的要害 ——
   *   `built_at` 每 build 一次就往前跳，`commit_time` 同一 commit **恒定**。
   * ⚠ 字段缺失（老戳 / 老版本 build 脚本）⇒ `commitTimeMs = null` ⇒ E-2 报"判不出"、⛔ 不判红。
   * ⚠ 值为 `判不出`（git 不可用时 build 脚本写的）⇒ 同样 `null`。
   */
  const tm = /^commit_time=(.+?)\s*$/m.exec(src)
  const tRaw = tm === null ? '' : tm[1].trim()
  const tMs = tRaw === '' || tRaw === '判不出' ? null : Date.parse(tRaw)
  return {
    commit: cm[1],
    builtAt: bm[1],
    builtAtMs: Number.isNaN(ms) ? null : ms,
    commitTime: tRaw,
    commitTimeMs: tMs === null || Number.isNaN(tMs) ? null : tMs,
  }
}

/**
 * **E-2** · 不许拿旧读数冒充当前代码态。
 *
 * ── 口径（⚠ 2026-11-01 P40/R10 改锚 · `TASK-R10.md` §二）─────────────────
 *   若 `code_state` 里的 commit **等于**当前 `lib/BUILD-STAMP` 的 commit，
 *   则 `taken_at` **不得早于**该 commit 的 **`commit_time`** ⇒ 早于 ⇒ 红。
 *
 * ── ⚠⚠ 为什么锚从 `built_at` 换成 `commit_time`（这是本轮拆的那个结构性循环）──────
 *   **旧口径**：`taken_at` 不得早于 `built_at`（**最后一次构建**的时刻）。
 *   ⇒ 而 `built_at` **每跑一次 `npm run build` 就往前跳**，`commit` 却不变。
 *   ⇒ 于是**每 build 一次，所有"对应当前 commit"的旧证据全部变红**，逼人重写 `taken_at`。
 *   ⚠ 这不是数据错，是**判据拿了一个会动的锚** —— 连续两轮（R8 · R9）踩了同一个坑。
 *
 * ── ⭐⭐ **实证：`commit_time` 真的不变（2026-11-01 P40/R11 实测）** ────────────────
 *   ⚠ R10 只证明了"两个字段的值不同"，**没证明**"再 build 一次 `commit_time` 不变"。
 *     若它其实每次都变，那这个修复**只是换了个字段名**，循环没拆掉。
 *   ⇒ 本轮实测（`cat lib/BUILD-STAMP` → `npm run build` → 再 `cat`）：
 *
 *     | 读数 | 含义 | build 前（T1 / B1） | build 后（T2 / B2） | 判 |
 *     |---|---|---|---|---|
 *     | `commit_time` | 代码诞生时刻 | `2026-10-31T19:54:16+08:00` | `2026-10-31T19:54:16+08:00` | **不变** ✓ |
 *     | `built_at` | 最后一次构建 | `2026-11-01T03:51:12+08:00` | `2026-11-01T04:07:13+08:00` | **变了** ✓ |
 *     | `commit` | 提交 sha | `16993c0d…` | `16993c0d…` | 不变（预期） |
 *
 *   ⇒ **`T1 === T2` 且 `B1 !== B2` ⇒ 判据成立**：提交时刻恒定、构建时刻会变。
 *     这正是设计意图 —— 拿 `commit_time` 当锚，**再 build 也不会误伤旧证据**。
 *
 *   ⚠⚠ **这条不做成机器断言，⛔ 别假装它被自动核着**：
 *     它需要**跑一次 `npm run build`**，而 `check:all` 里**不许 build**
 *     （build 会刷新 `built_at`，判据自己去动被测对象 = 自证）。
 *     ⇒ 所以它只能作为**一次性实证**记在这里。⚠ 下一个改这段的人：
 *       若你怀疑 `commit_time` 其实会变，**照上表重跑一遍**，⛔ 别信这条注释。
 *
 *   ⚠ 另一条本次顺带看到的读数：`commit` 在两次 build 之间没变（预期，因为没提交）。
 *     若 `commit` 变了而 `commit_time` 没变，那才是异常（说明 `git log -1` 取错了对象）。
 *
 *   **新口径**：锚 = `commit_time` = **这份代码诞生的时刻**，同一 commit **恒定**。
 *   ⇒ 那才是"旧读数冒充当前代码"该用的锚：一条读数若**早于代码诞生**，它不可能是这份代码的读数。
 *   ⚠ E-2 **本来要抓的东西仍然抓得到**（见下面那条负向对拍：`taken_at` 早于 `commit_time` ⇒ 必红）。
 *
 * ── 为什么 ──────────────────────────────────────────────────────────
 *   commit 对上了、而读数比这份代码诞生还早 ⇒ 这条读数**不可能是那份代码的读数**
 *   —— 它是在**冒充**（把旧读数贴上当前 commit 的标签）。
 *
 * ⚠ **`taken_at` 时刻判不出仍红**（空 / 解析不了）：`TASK-R5.md` §二 的"判不出 ⇒ 红"
 *   在本组是通则；而且此时**无法排除**冒充，⛔ 不许默认合法。
 * ⚠ 构建戳读不到（`stamp === null`）⇒ 本判据**判不出** ⇒ 红（⛔ 不静默放过）。
 *
 * ⚠⚠ **`commit_time` 缺失 / 读不出 ⇒ 报"判不出"，⛔ 不判红**（`TASK-R10.md` §二-3）：
 *   拿一个**不存在的锚**去判红，等于让每次 build 都误伤一遍 —— 那正是本轮要拆的循环。
 *   ⛔ 但**不许静默通过**：必须在读数里说「判不出 N 条」。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @param {{commit:string, builtAt:string, builtAtMs:number|null}|null} stamp - 当前构建戳
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkE2(units, stamp) {
  const problems = []
  const evs = units.filter((u) => u.kind === 'evidence')
  const atCurrent = evs.filter((e) => codeStateCommit(e.code_state) !== null
    && stamp !== null && codeStateCommit(e.code_state) === stamp.commit)
  if (stamp === null) {
    problems.push('E-2 **判不出**：`lib/BUILD-STAMP` 读不到或缺 `commit=` / `built_at=` ⇒ 无法核"旧读数冒充当前"（⛔ 不按通过处理）')
    return problems
  }
  if (stamp.builtAtMs === null) {
    problems.push(`E-2 **判不出**：构建戳的 \`built_at = ${JSON.stringify(stamp.builtAt)}\` 解析不出时刻 ⇒ 无法比较（⛔ 不按通过处理）`)
    return problems
  }
  /**
   * ⚠ `commit_time` 读不出（老戳没有这个字段 / git 不可用时写了 `判不出`）⇒
   *   **报"判不出 N 条"、⛔ 不判红**。理由见上方长注释：拿不存在的锚判红 = 每次 build 误伤一遍。
   *   ⛔ 但**不许静默**：`judged:false` 会由接线处打成一条读数。
   */
  if (stamp.commitTimeMs === null) {
    return {
      problems: [],
      undecidable: atCurrent.length,
      judged: false,
      note: `E-2 **判不出**：\`lib/BUILD-STAMP\` 缺 \`commit_time=\`（或值为 \`判不出\` / 解析不了）`
        + ` ⇒ 无法核"旧读数冒充当前"，**判不出 ${atCurrent.length} 条**（⛔ 不判红：拿不存在的锚判红会每次 build 误伤一遍）`,
    }
  }
  for (const e of atCurrent) {
    const takenRaw = String(e.taken_at ?? '').trim()
    const takenMs = takenRaw === '' ? Number.NaN : Date.parse(takenRaw)
    if (Number.isNaN(takenMs)) {
      problems.push(`${e.id}：\`code_state\` 指向当前 commit，而 \`taken_at\`（${JSON.stringify(takenRaw.slice(0, 40))}）**判不出时刻** ⇒ 无法排除"旧读数冒充当前"（⛔ 不按通过处理）`)
      continue
    }
    if (takenMs < stamp.commitTimeMs) {
      problems.push(`${e.id}：\`code_state\` 指向当前 commit，而 \`taken_at\`（${takenRaw}）**早于**该 commit 的提交时刻（${stamp.commitTime}）⇒ 旧读数冒充当前`
        + '（⚠ 锚是 `commit_time`（代码诞生），⛔ 不是 `built_at`（最后一次构建）—— 后者每 build 都动，会误伤）')
    }
  }
  return { problems, undecidable: 0, judged: true, note: `E-2 核了 ${atCurrent.length} 条对应当前 commit 的证据（锚 = \`commit_time = ${stamp.commitTime}\`）` }
}

/**
 * **E-3** · 历史证据**不判红**（⚠ 这一条是"**不许判红**"的判据）。
 *
 * ── 口径 ────────────────────────────────────────────────────────────
 *   `code_state` 的 commit **≠** 当前 commit ⇒ **不红**，只记一条 `note`。
 *
 * ⚠⚠ **为什么必须显式写成判据（这条注释留着，⛔ 别让下一轮的人"顺手"把它改严）**：
 *   历史证据**本来就该**对应旧代码态 —— 那是它的本分，不是缺陷。
 *   若判红，唯一出路是**篡改读数**或**删证据**，两个都比"证据旧"坏得多：
 *     · 改读数 = 把"当时的读数"洗成"现在的读数"，历史不可复核；
 *     · 删证据 = 让"这条任务验过"变成无据可查。
 *   ⇒ 本判据的**唯一合法输出**是「0 处问题 + 一份读数分布」。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @param {{commit:string}|null} stamp - 当前构建戳
 * @returns {{problems:string[], census:{total:number, current:number, old:number, undecidable:number}}}
 */
export function checkE3(units, stamp) {
  const evs = units.filter((u) => u.kind === 'evidence')
  const census = { total: evs.length, current: 0, old: 0, undecidable: 0 }
  for (const e of evs) {
    const c = codeStateCommit(e.code_state)
    if (c === null) census.undecidable += 1
    else if (stamp !== null && c === stamp.commit) census.current += 1
    else census.old += 1
  }
  /**
   * ⚠ **恒为空**：E-3 的定义就是"历史证据不判红"。这里返回空数组**不是**漏写，
   *   而是本判据的全部内容（见上方长注释）。
   */
  return { problems: [], census }
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * **2026-11-01 P40/R5 · `TASK-R5.md` §五 · F-1..F-5（五个字段从"只有声明"到"有判据"）
 *
 * ⚠⚠ 形态判据 = **出现即核，⛔ 不强制出现**（作业书 §五 明写"⛔ 不许自己加严"）。
 *   强制必填的那三条走 §五 F-6..F-8 的**决策规则**，另算（见 `checkReadiness` 与报告读数）。
 * ⚠ 封闭集**只在 `gen-ledger.mjs` 写一处**（`REQ_PRIORITIES` / `BUDGET_KEYS`），
 *   ⛔ 本文件不列第二遍（两处真相会漂）。
 * ══════════════════════════════════════════════════════════════════════════════
 */

/**
 * **F-1** · `req.priority` 出现时必须在封闭集 `REQ_PRIORITIES` 里。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkF1(units) {
  const problems = []
  for (const r of units.filter((u) => u.kind === 'req')) {
    if (r.priority === undefined || r.priority === null) continue
    const v = String(r.priority).trim()
    if (!REQ_PRIORITIES.includes(v)) {
      problems.push(`${r.id}：\`priority = ${JSON.stringify(v)}\` **不在封闭集**里（只许 ${REQ_PRIORITIES.map((x) => `\`${x}\``).join(' / ')}）⇒ 自造优先级等于没分类`)
    }
  }
  return problems
}

/**
 * **F-2** · `task.scope_paths` 出现时必须是非空字符串数组，且每项是**相对路径**。
 *
 * ⚠ 绝对路径 ⇒ 红（换台机器就指不到同一处）；含 `..` ⇒ 红（能跳出账本/工作区，
 *   等于"允许改的路径"这条声明失效）。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkF2(units) {
  const problems = []
  for (const t of units.filter((u) => u.kind === 'task')) {
    if (t.scope_paths === undefined || t.scope_paths === null) continue
    if (!Array.isArray(t.scope_paths) || t.scope_paths.length === 0) {
      problems.push(`${t.id}：\`scope_paths\` 必须是**非空数组**（实测 ${JSON.stringify(t.scope_paths)}）⇒ 空声明等于没声明"允许改哪些路径"`)
      continue
    }
    for (const raw of t.scope_paths) {
      if (typeof raw !== 'string') {
        problems.push(`${t.id}：\`scope_paths\` 里有一项**不是字符串**（${JSON.stringify(raw)}）`)
        continue
      }
      const p = raw.trim()
      if (p === '') {
        problems.push(`${t.id}：\`scope_paths\` 里有一项是**空串**`)
        continue
      }
      if (p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)) {
        problems.push(`${t.id}：\`scope_paths\` 里的 \`${p}\` 是**绝对路径** ⇒ 换台机器就指不到同一处（⛔ 只许相对路径）`)
        continue
      }
      if (p.split(/[\\/]/).includes('..')) {
        problems.push(`${t.id}：\`scope_paths\` 里的 \`${p}\` **含 \`..\`** ⇒ 能跳出工作区，"允许改哪些路径"这条声明失效`)
      }
    }
  }
  return problems
}

/**
 * 解析 `task.budget`（形如 `tool_calls=12 · rounds=3`）。
 *
 * ⚠ 为什么是**字符串**而不是 TOML 内联表：本仓 TOML 只有受限子集解析器
 *   （`parseTomlSubset` 头注释明写 ⛔ 不假装支持完整 TOML）。为 `budget` 扩语法会把
 *   "受限子集"这个**真保证**变成假的。理由同 `gen-ledger.mjs` 的 `BUDGET_KEYS` 注释。
 *
 * @param {unknown} v - `budget` 原文
 * @returns {Record<string, number|null>} 每个键的读数（读不到 ⇒ `null`）
 */
export function parseBudget(v) {
  const out = {}
  for (const k of BUDGET_KEYS) {
    const m = new RegExp(`${k}\\s*=\\s*(-?\\d+)`).exec(String(v ?? ''))
    out[k] = m === null ? null : Number(m[1])
  }
  return out
}

/**
 * **F-3** · `task.budget` 出现时必须含 `tool_calls` 与 `rounds`，且都是**正整数**。
 *
 * ⚠ 缺一即红（作业书 §五 表里写死）。⛔ `0` / 负数不是预算 —— 它们是"填了个数字"。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkF3(units) {
  const problems = []
  for (const t of units.filter((u) => u.kind === 'task')) {
    if (t.budget === undefined || t.budget === null) continue
    const raw = String(t.budget).trim()
    if (raw === '') {
      problems.push(`${t.id}：\`budget\` 是空串 ⇒ 要么写 \`tool_calls=N · rounds=M\`，要么别写这个字段`)
      continue
    }
    const got = parseBudget(raw)
    for (const k of BUDGET_KEYS) {
      if (got[k] === null) {
        problems.push(`${t.id}：\`budget\` **缺 \`${k}\`**（原文 ${JSON.stringify(raw.slice(0, 60))}）⇒ 缺一即红（⛔ 半个预算不是预算）`)
      } else if (!(Number.isInteger(got[k]) && got[k] > 0)) {
        problems.push(`${t.id}：\`budget.${k} = ${got[k]}\` **不是正整数** ⇒ ⛔ 0 / 负数不是预算`)
      }
    }
  }
  return problems
}

/**
 * **F-4** · `run.report` 出现时必须是账本区内**真实存在的 `.md`**（相对账本区根）。
 *
 * ⚠ 用现成的 `pathExists` 口径（相对 `ledger-next/` 根），⛔ 不另拼一套路径解析。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @param {(p:string)=>boolean} pathExists - 相对账本区根的路径存在性判据
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkF4(units, pathExists) {
  const problems = []
  for (const r of units.filter((u) => u.kind === 'run')) {
    if (r.report === undefined || r.report === null) continue
    const p = String(r.report).trim()
    if (p === '') {
      problems.push(`${r.id}：\`report\` 是空串 ⇒ 要么给出回传件的相对路径，要么别写这个字段`)
      continue
    }
    if (!p.endsWith('.md')) {
      problems.push(`${r.id}：\`report = ${JSON.stringify(p)}\` **不是 \`.md\`** ⇒ 回传件必须是可直读的 markdown（⛔ 不接受目录 / 二进制 / 裸 id）`)
      continue
    }
    if (!pathExists(p)) {
      problems.push(`${r.id}：\`report = ${JSON.stringify(p)}\` **账本区里不存在这份文件** ⇒ 指向空气的回传件（⛔ 那会让"回传过"看起来成立）`)
    }
  }
  return problems
}

/**
 * **F-5** · `acc.verified_at` 出现时必须是 ISO8601 形态。
 *
 * 口径：以 `YYYY-MM-DDTHH:MM:SS` **开头**，允许时区后缀（`+08:00` / `Z`）。
 * ⚠ 只核形态，⛔ 不核"这个时刻合不合理"（那要外部时钟读数，本判据没有）。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkF5(units) {
  const problems = []
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/
  for (const a of units.filter((u) => u.kind === 'acc')) {
    if (a.verified_at === undefined || a.verified_at === null) continue
    const v = String(a.verified_at).trim()
    if (!ISO.test(v)) {
      problems.push(`${a.id}：\`verified_at = ${JSON.stringify(v.slice(0, 40))}\` **不是 ISO8601 形态**（要 \`YYYY-MM-DDTHH:MM:SS\` 开头、可带时区后缀）⇒ 判决时刻不可比`)
    }
  }
  return problems
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * **2026-11-01 P40/R6 · `TASK-R6.md` §2.3 · P-1（项目组合层：已定的需求不许没人做）
 *
 * ⚠⚠ 它治的洞：一条 `req` 已经 `agreed`（用户认了），却没有任何 `change` 的 `addresses`
 *   指向它 ⇒ 五步里显示"需求 8/8 完成"，而**没有人在做它**，⛔ 没有判据会红。
 *
 * ⚠ 判定**不在这里实现**：唯一实现是 `src/shared/portfolio.ts` 的 `portfolioOf`
 *   （面板与生成器用的是**同一份**）。本函数只把它的 `orphans` 折成问题清单。
 *   ⛔ 不许在脚本里写第二套"谁承接了哪条需求 / 哪条 acc 算 pass"的口径 —— 两套必然漂。
 * ══════════════════════════════════════════════════════════════════════════════
 */

/**
 * ⭐ **P-1 的存量豁免名单**（⚠ 本轮实测 **5** 条 > 3 ⇒ 按 §2.3 决策规则**不强制**，故为空）。
 *
 * ── 本轮实测（作业书 §2.3 要求把实测数写进回传）───────────────────────
 *   孤儿 **5** 条：`R-002` · `R-003` · `R-004` · `R-005` · `R-008`（全部 `status = agreed`）。
 *   · `R-002` / `R-003` / `R-004`：各挂 2 条 acc，但 **pass 条数 0**（`ACC-001..003` 都是 `unverified`）；
 *   · `R-005` / `R-008`：**一条 acc 都没有**，也没有 change 承接。
 *   ⇒ 缺 **5** > 3 ⇒ 走 §2.3 第三档：**⛔ 不许强制**，退成「覆盖率 `note` + 生成物里照实列出」。
 *     ⚠ 因此本名单**保持为空**（登记豁免的前提是"≤3 条"那一档；5 条连豁免都不登记，
 *       豁免上限的意义就是"超过就别硬来"）。
 *
 * ── ⚠ 为什么这一条留到下一轮（作业书要求写进代码注释）─────────────────
 *   这 5 条**不是记账缺陷，是真实欠账**：`R-002`/`R-003`/`R-004` 的 acc 是 `unverified`
 *   （没人真验过），`R-005`/`R-008` 连 acc 都没有。要让它们不再是孤儿，只有两条路：
 *     ① 真派 change 去做（那是**派活**，是人的决定）；
 *     ② 补一条 `pass` 的 acc（那是**造假读数** —— `check-convergence.mjs:135` 已把
 *        「⛔ 不许为它们编 acc」写进代码）。
 *   ⇒ 现在强制，唯一"修法"就是造假或给 5 条永久豁免。⛔ 两条都不做。
 *   ⚠ 下一轮的正确做法：**派 change 承接它们**（`R-002`/`R-003`/`R-004` 是 R2 时补过
 *     `acceptance_ids` 的那三条，本就该有 change），而不是放宽判据。
 *
 * ⚠⚠ **只许变短**（`checkOrphanE1` 逐轮核）。
 */
export const STORED_ORPHAN_REQ = [
  {
    id: 'R-005',
    why: '这条需求约束的是**面板形态**（零百分比 / 零进度条 / 零勾选 / 只读），'
      + '已由 `check:stages-dom` 的 S-1..S-4 逐条咬住 —— 它的**验收落点是 DOM 断言**，'
      + '⛔ 不是某一条 change 的交付物。⇒ 要求它为满足一条 UI 形态约束去开一条 change，等于造流程。',
    plan: '**不派 change**：等 `check:stages-dom` 的 S-1..S-4 有一次真实的全绿读数（`last_reading` 落进 `CAP-` 或 `EVD-`）后，'
      + '把那条读数作为它的 `acceptance_ids` 指向的 acc，`status` 置 `pass` ⇒ 它自然脱离孤儿（无需豁免）。',
  },
  {
    id: 'R-008',
    why: '⚠ 实测更正：R6 与 `REVIEW-R6.md` 都以为它底下有 `TSK-048`，**那是错的** —— '
      + '`TSK-048` 的 `parent` 是 `CHG-2026-10-31-tool-policy`，`after = ["R-008"]` 是**前置引用**、不是承接关系。'
      + '⇒ 按 `parent` 口径它确实没有任何 task 承接；而 `TSK-048` 正是它的**实现件**（「unseen 工具的可读出口」'
      + '= R-008「被判出必须能在界面上看见」）。⇒ 它是**被 `after` 挂着、等 TSK-048 开工**，⛔ 不是没人管。',
    plan: '**等 `TSK-048` 落地**：`TSK-048` 一旦 `built` 并产出 acc，R-008 就有承接方；'
      + '⛔ 在此之前不派新 change（那会与 `TSK-048` 撞同一批文件）。⚠ 若最终裁定「`after` 也算承接」，'
      + '那要改的是孤儿口径（`tasks` 那一项要把 `after` 引用算进来），不是这条豁免。',
  },
]

/**
 * **P-1-E1** · 孤儿豁免名单**只减不增** + 每条必须有原因与清理计划（形态照 `checkReadyE1`）。
 * ⚠ 2026-11-01 P40/R7 重测：孤儿 **2** 条（`R-005` · `R-008`）⇒ 2 ≤ 3 ⇒ 走 §四 第二档
 *   **强制 + 登记豁免**，`_MAX` = 实测数 **2**。⛔ 只许变短（下轮清掉一条就必须降到 1）。
 */
export const STORED_ORPHAN_REQ_MAX = 2
export function checkOrphanE1(list) {
  const problems = []
  const arr = Array.isArray(list) ? list : []
  if (arr.length > STORED_ORPHAN_REQ_MAX) {
    problems.push(`P-1 豁免名单长度 **${arr.length}** > 上一轮记录 **${STORED_ORPHAN_REQ_MAX}** ⇒ **只减不增**被破坏`)
  }
  for (const e of arr) {
    if (String(e?.id ?? '').trim() === '') problems.push('P-1 豁免名单里有一条**没写 id**（⛔ 那等于整类豁免）')
    else {
      if (String(e?.why ?? '').trim() === '') problems.push(`P-1 豁免 \`${e.id}\` **没写原因**`)
      if (String(e?.plan ?? '').trim() === '') problems.push(`P-1 豁免 \`${e.id}\` **没写清理计划**`)
    }
  }
  return problems
}

/**
 * **P-1** · `agreed` 的需求不许既没有 change 承接、也没有 pass 验收。
 *
 * ⚠ 判定转调 `portfolioOf`（唯一实现）；本函数只做"折成问题清单 + 扣豁免"。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @param {(units:any)=>any} [portfolioOfFn] - 组合层实现（便于负向对拍注入）
 * @param {Array<{id:string}>} [exempt] - 存量豁免名单
 * @returns {{problems:string[], portfolio:any}} 问题清单 + 原始读数
 */
export function checkP1(units, portfolioOfFn = portfolioOfShared, exempt = STORED_ORPHAN_REQ) {
  const problems = []
  if (typeof portfolioOfFn !== 'function') {
    /**
     * ⚠ 算不出来 ⇒ **判不出 ⇒ 红**（⛔ 不许静默当 0 条）。
     *   0 条孤儿是一条**读数**；算不出来是**没有读数**，两者不是一回事。
     */
    problems.push('P-1 **判不出**：`src/shared/portfolio.ts` 载入失败 ⇒ 无法判断哪条需求没人接（⛔ 不按通过处理）')
    return { problems, portfolio: undefined }
  }
  const p = portfolioOfFn(units)
  const exemptIds = new Set((Array.isArray(exempt) ? exempt : []).map((e) => String(e?.id ?? '')))
  for (const rid of (p?.orphans ?? [])) {
    if (exemptIds.has(String(rid))) continue
    problems.push(`${rid}：\`agreed\` 却没有任何 change 承接、没有 task 在管、也没有 acc ⇒ 已定的需求没人做`)
  }
  return { problems, portfolio: p }
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

if (IS_MAIN) try {
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
  // B-1 / B-2 · 退回目标分类（2026-10-31 P42/R4 · `TASK-R4.md` §二）
  // ══════════════════════════════════════════════════════════════════════
  {
    const p1 = checkB1(units)
    if (p1.length === 0) ok(`B-1 ✓ **退回目标必填**：\`status=send-back\` 的 acc 逐条核 \`send_back_to\` 在封闭三值内 ⇒ **0** 处缺失/越界`)
    else for (const p of p1) bad(`B-1 · ${p}`)

    const p2 = checkB2(units)
    if (p2.length === 0) ok('B-2 ✓ **`pass` 不许带退回目标**：\`status=pass\` 的 acc 逐条核 \`send_back_to\` 为空 ⇒ **0** 处自相矛盾')
    else for (const p of p2) bad(`B-2 · ${p}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // R-READY · 任务准备度（2026-10-31 P41/R3 · `TASK-R3.md` §七）
  // ══════════════════════════════════════════════════════════════════════
  {
    const probs = checkReadiness(units)
    const todos = units.filter((u) => u.kind === 'task' && String(u.status) === 'todo')
    if (probs.length === 0) {
      ok(`R-READY ✓ **任务准备度**：本索引 ${todos.length} 条 \`todo\` 任务，逐条核 parent 需求 / \`after\` 前置 / 所属 change ⇒ **0** 条"还不该开工"`)
    } else for (const p of probs) bad(`R-READY · ${p}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════════════
  // GC-1/2/3 · 目标层覆盖（2026-11-02 P50/B1 · `TASK-B1.md` §一第 2 件）
  // ══════════════════════════════════════════════════════════════════════
  /**
   * ⚠⚠ **`goal = 0` 走 `skip` 档，⛔ 不进 `ok`、⛔ 也不进 `bad`**（§一第 3 件）：
   *   · 进 `ok` ⇒ "目标层没做"被洗成"目标层全对"（假绿，本仓最忌）；
   *   · 进 `bad` ⇒ 上线即红（用户裁决明令禁止）。
   *   ⇒ 第三条路：单列 `⊘`，并计入 `skip` 计数（处级口径里单独报，⛔ 不计入「过了」）。
   */
  {
    const cov = checkGoalCoverage(units)
    /** ⚠ 判定与输出都在 `reportGoalLayer` 里（与 `N-GC0` 共用同一段代码）。 */
    const bucket = reportGoalLayer(cov, { ok, bad, noteSkip })
    if (bucket === 'skip') {
      console.log(`      ⇒ 实测：goal **0 条** · 活跃需求（\`agreed\`）**${cov.activeReqs} 条**`
        + ' —— 需求侧有对象、目标侧没有 ⇒ 三条覆盖检查**一条也判不了**')
    }
  }

  // G-1..G-4 · 四条前置状态门禁（2026-10-31 P41/R3 · `TASK-R3.md` §四）
  // ⚠ 只落账本面：判"这个状态合法不合法"，⛔ 不拦写操作
  // ══════════════════════════════════════════════════════════════════════
  {
    const gates = [
      ['G-1', checkG1, '`todo` → `built` 不许跳过 `doing`（`built` 却零 run ⇒ 拦截）'],
      ['G-2', checkG2, '`run` 未 `returned` 不许把 `task` 记 `built`'],
      ['G-3', checkG3, '`acc.actor` 不许等于被验对象的 `built_by`（自己验自己）'],
      ['G-4', checkG4, '`req` 到 `dropped` 必须说明为什么丢'],
    ]
    for (const [id, fn, what] of gates) {
      const probs = fn(units)
      if (probs.length === 0) ok(`${id} ✓ 门禁通过：${what}（本索引 **0** 处违规）`)
      else for (const p of probs) bad(`${id} · ${p}`)
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // G-5..G-8 · 前置状态门禁补齐（2026-11-01 P40/R5 · `TASK-R5.md` §二）
  // ⚠ 只落账本面：判"这个状态合法不合法"，⛔ 不拦写操作（单向门没碰）
  // ══════════════════════════════════════════════════════════════════════
  {
    const stampText = (() => { try { return readFileSync(join(ROOT, 'lib', 'BUILD-STAMP'), 'utf8') } catch { return null } })()
    const stamp = parseBuildStamp(stampText)
    const gates5 = [
      ['G-5', () => checkG5(units), '`change.settled` ⇒ `addresses` 里每条需求都 `agreed`（方案不许定在没定的需求上）'],
      ['G-6', () => checkG6(units), '`task.built` ⇒ 所属方案已到终态（`settled` 或 `superseded`；⛔ 不是只要 settled）'],
      ['G-7', () => checkG7(units), '`run.returned` ⇒ 所属任务已进入执行（`built` / `doing`；parent 判不出即红）'],
      ['G-8', () => checkG8(units), '`acc.pass` ⇒ 被验对象已到终态（task `built` / change `settled`|`superseded`）'],
    ]
    for (const [id, fn, what] of gates5) {
      const probs = fn()
      if (probs.length === 0) ok(`${id} ✓ 门禁通过：${what}（本索引 **0** 处违规）`)
      else for (const p of probs) bad(`${id} · ${p}`)
    }

    /**
     * ── S-1 · 判决只有一个落点（2026-11-01 P40/R5b · `TASK-R5b.md` §3.2）──
     *   ⚠ R5 的报告自己写了"同一件事两个落点"，而它**只在报告里说**。
     *     写进判据，下一轮的人才改不动它。
     */
    const s1 = checkS1(units)
    if (s1.length === 0) {
      ok(`S-1 ✓ **判决只有一个落点**：${units.filter((u) => u.kind === 'acc').length} 条 acc 逐条核 \`outcome\` 字段 ⇒ **0** 处出现`
        + '（⚠ 判决的唯一真相是 `status`；同义字段会让两处漂 —— R5 就漂过一次，见 `checkS1` 注释）')
    } else for (const p of s1) bad(`S-1 · ${p}`)

    // ══════════════════════════════════════════════════════════════════════
    // P-1 · 项目组合层：已定的需求不许没人做（2026-11-01 P40/R6 · `TASK-R6.md` §2.3）
    // ⚠ 判定转调 `src/shared/portfolio.ts` 的 `portfolioOf`（面板与生成器同一份）
    // ══════════════════════════════════════════════════════════════════════
    {
      const { problems: p1, portfolio } = checkP1(units)
      if (portfolio === undefined) {
        for (const x of p1) bad(`P-1 · ${x}`)
      } else if (p1.length === 0) {
        ok(`P-1 ✓ **已定的需求都有人接**：${portfolio.counts.total} 条需求逐条核（\`agreed\` · 无 change 承接 · **无 task 承接** · 无 acc 四条同时成立才算孤儿）`
          + ` ⇒ **0** 条孤儿（有 change 承接 ${portfolio.counts.covered} 条 · 已有 pass 验收 ${portfolio.counts.proven} 条 · 做完了没人验 ${portfolio.counts.builtNoAcc} 条 —— 后者⛔ 不是孤儿）`)
      } else if (p1.length > 3) {
        /**
         * ⚠⚠ **5 条 > 3 ⇒ 按 §2.3 决策规则不强制**，退成覆盖率读数（⛔ 不判红）。
         *   理由写在 `STORED_ORPHAN_REQ` 上方长注释里（作业书要求写进代码注释）。
         */
        ok(`P-1 · **覆盖率读数（⛔ 未强制）**：孤儿 **${p1.length}** 条 > 3 ⇒ 按 §四 决策规则**不强制**`
          + `（退成生成物 \`spec/portfolio.md\` 里照实列出 + 本条读数；留到下一轮的理由见 \`STORED_ORPHAN_REQ\` 上方注释）`
          + ` ⇒ 逐条：${p1.map((x) => x.split('：')[0]).join(' · ')}`
          + `（合计 ${portfolio.counts.total} 条需求 · 有 change 承接 ${portfolio.counts.covered} · 已有 pass 验收 ${portfolio.counts.proven}）`)
      } else {
        for (const x of p1) bad(`P-1 · ${x}`)
      }

      /**
       * ── P-1 · **互斥断言**（2026-11-01 P40/R7 · `TASK-R7.md` §1.1 要求）──────────
       *   `orphans` 要求 `tasks === 0`；`builtNoAcc` 要求有 `built` 的 task ⇒ 两者**不可能**相交。
       * ⚠ 这条断言的意义：它把"两句话说的是两件事"钉成机器可核的事实。
       *   ⛔ 少了它，下次谁改了任一口径，就可能让同一条需求**同时**出现在
       *   「没人做」和「做完了没人验」两节里 —— 那正是 R6 被退回的那类假话。
       */
      if (portfolio !== undefined) {
        const both = (portfolio.orphans ?? []).filter((x) => (portfolio.builtNoAcc ?? []).includes(x))
        if (both.length === 0) {
          ok(`P-1 ✓ **「没人接」与「做完了没人验」互斥**：孤儿 ${portfolio.orphans.length} 条 · 做完了没人验 ${(portfolio.builtNoAcc ?? []).length} 条 ⇒ **0** 条同时出现在两节`
            + `（逐条：孤儿 ${portfolio.orphans.join(' / ') || '空'} · 没人验 ${(portfolio.builtNoAcc ?? []).join(' / ') || '空'}）`)
        } else bad(`P-1 · **同一条需求同时出现在「没人接」和「做完了没人验」**：${both.join(' · ')} ⇒ 两个口径相交了`)
      }

      /**
       * ── **A-1 / A-2** · `parent` 与 `after` 的语义、`evidence.parent` 的允许集 ─────────
       *   （2026-11-01 P40/R8 · `TASK-R8.md` §一.2 / §四）
       * ⚠ 两条都落在这里（⛔ 不新开 `check:*` 族，§六 明令）。
       */
      {
        const a1 = checkA1(units)
        const overlapTotal = units.filter((u) => Array.isArray(u.after) && String(u.parent ?? '') !== ''
          && u.after.map(String).includes(String(u.parent))).length
        if (a1.length === 0) {
          ok(`A-1 ✓ **\`parent\` 与 \`after\` 没被混用**：\`after\` 与 \`parent\` 重合的单元 **${overlapTotal}** 条`
            + `（≤ 登记存量 **${STORED_PARENT_AFTER_OVERLAP_MAX}** 条），全部落在封闭模式 ${PARENT_AFTER_ALLOWED_PATTERNS.join(' / ')} 内`
            + '，且没有"属于这条需求却在等另一条需求"的打架形态'
            + '（⚠ 语义：`parent` = 归属/承接 · `after` = 前置/⛔ 不是承接 —— 见 `PARENT_VS_AFTER`）')
        } else for (const x of a1) bad(`A-1 · ${x}`)
        if (overlapTotal > STORED_PARENT_AFTER_OVERLAP_MAX) {
          bad(`A-1 · \`after\` 与 \`parent\` 重合的单元 **${overlapTotal}** 条 > 登记存量 **${STORED_PARENT_AFTER_OVERLAP_MAX}** 条 ⇒ 新增了重合`
            + ' ⇒ 先想清楚它是不是"把该承接的对象塞进了 `after`"（那正是 `TSK-048`/`R-008` 的错法）')
        }

        const a2 = checkA2(units, EVIDENCE_PARENT_KINDS)
        const evTotal = units.filter((u) => u.kind === 'evidence').length
        if (a2.length === 0) {
          ok(`A-2 ✓ **\`evidence.parent\` 都在允许集内**：${evTotal} 条证据，\`parent\` 只能是 ${EVIDENCE_PARENT_KINDS.join(' / ')}`
            + ' ⇒ **0** 处越界（⚠ ⛔ 不许挂 `req`：需求的证据必须经 `acc` 第 5 步 —— 绕过验收直接挂证据 = 自证）')
        } else for (const x of a2) bad(`A-2 · ${x}`)
      }

      /** ── P-1-E1 · 孤儿豁免名单只减不增 ── */
      const oe = checkOrphanE1(STORED_ORPHAN_REQ)
      if (oe.length === 0) {
        ok(`P-1-E1 ✓ **孤儿豁免名单只减不增**：当前 **${STORED_ORPHAN_REQ.length}** 条 ≤ 上一轮记录 **${STORED_ORPHAN_REQ_MAX}** 条`
          + `（逐条：${STORED_ORPHAN_REQ.map((e) => e.id).join(' / ') || '空'}；⚠ 本轮实测孤儿 2 条 ≤ 3 ⇒ 走第二档"强制 + 登记豁免"）`)
      } else for (const x of oe) bad(`P-1-E1 · ${x}`)
    }

    /** ── X-1 · 作废方案上还在派活（`TASK-R5.md` §四）── */
    const x1 = checkX1(units)
    if (x1.length === 0) {
      ok('X-1 ✓ **作废方案上不许派新活**：`superseded` 方案下的任务，`todo`/`doing` 状态 **0** 处'
        + '（⚠ `built` 的历史任务⛔ 不算 —— 活干完了是历史事实）')
    } else for (const p of x1) bad(`X-1 · ${p}`)

    // ══════════════════════════════════════════════════════════════════════
    // E-1 / E-2 / E-3 · 证据的"可指认"与"不许冒充当前"（`TASK-R5.md` §三）
    // ══════════════════════════════════════════════════════════════════════
    const e1 = checkE1(units)
    const evs = units.filter((u) => u.kind === 'evidence')
    if (e1.length === 0) {
      ok(`E-1 ✓ **\`code_state\` 可指认**：${evs.length} 条证据逐条核（\`commit=<40 hex>\` 或逐字 \`判不出\`）⇒ **0** 处不可指认`
        + '（⛔ 「最新」/「当前」/「N/A」/「-」/空 / 自由文本一律红）')
    } else for (const p of e1) bad(`E-1 · ${p}`)

    const e2 = checkE2(units, stamp)
    if (e2.problems.length > 0) for (const p of e2.problems) bad(`E-2 · ${p}`)
    else if (e2.judged === false) {
      /**
       * ⚠ **判不出 ⇒ ⛔ 不判红，但必须说出来**（`TASK-R10.md` §二-3）。
       *   用 `ok(...)` 打（它不进退出码），但文字里必须有「判不出 N 条」——
       *   ⛔ 不许静默通过：静默 = 读者以为核过了。
       */
      ok(`E-2 · **判不出**（⚠ 不判红，但也不是"通过"）：${e2.note}`)
    } else {
      ok(`E-2 ✓ **不许拿旧读数冒充当前**：${e2.note}`
        + '（⚠ 锚是 `commit_time` = 代码诞生时刻，同一 commit 恒定；⛔ 不是 `built_at` —— 后者每 build 都动，会误伤）')
    }

    /**
     * ── E-3 · 历史证据**不判红**（⚠ 这是"**不许判红**"的判据，⛔ 别把它改严）──
     *   ⚠ 本条的合法输出**恒为绿 + 一份分布读数**：历史证据本来就该对应旧代码态。
     *     若判红，唯一出路是**篡改读数**或**删证据**，两个都比"证据旧"坏得多。
     */
    const e3 = checkE3(units, stamp)
    if (e3.problems.length === 0) {
      ok(`E-3 ✓ **历史证据不判红**：读数分布 —— 共 **${e3.census.total}** 条证据 · 对应当前代码态 **${e3.census.current}** 条 ·`
        + ` 对应旧代码态 **${e3.census.old}** 条 · 判不出 **${e3.census.undecidable}** 条 ⇒ **0** 处判红`
        + '（⚠ 历史证据对应旧代码态是**本分**，⛔ 不是缺陷 —— 判红只会逼人篡改读数或删证据）')
    } else for (const p of e3.problems) bad(`E-3 · ${p}`)

    // ══════════════════════════════════════════════════════════════════════
    // F-1..F-5 · 五个字段"出现即核"（`TASK-R5.md` §五）
    // ⚠ 形态判据，⛔ 不强制出现（强制必填的那三条走 §五 的决策规则，见下方 F-6/F-7/F-8）
    // ══════════════════════════════════════════════════════════════════════
    {
      /**
       * ⚠⚠ **2026-11-01 P40/R7 修的一处真 bug**：这里原来写的是 `join(LEDGER, p)`，
       *   即**相对 `ledger-next/`** 解析；而 `checkF4` 的文档注释与作业书都写的是
       *   **「相对账本区根」** —— 两者**矛盾**，且 `archive/` 是 `ledger-next/` 的**兄弟目录**
       *   （`<账本根>/archive/…` vs `<账本根>/ledger-next/…`）⇒ 按旧写法，
       *   任何指向 `archive/**` 的回传件都会被判「账本区里不存在这份文件」。
       *
       * ⚠ 为什么这个 bug 直到今天才现形：**`run.report` 此前一条真实数据都没有**
       *   （F-7 覆盖率读数：26 条 run 全空）⇒ 这条判据在真账本上**从没被执行过**。
       *   本轮 `RUN-027` 是第一条带 `report` 的 run，一上来就把它踩出来了。
       *
       * ⇒ 按**文档口径**修（账本区根 = `ledger-next/` 的上级），⛔ 不是把文档改成迁就代码。
       */
      const LEDGER_ROOT = join(LEDGER, '..')
      const pathExistsInLedger = (p) => existsSync(join(LEDGER_ROOT, p))
      const fGates = [
        ['F-1', () => checkF1(units), `\`req.priority\` 出现时在封闭集内（${REQ_PRIORITIES.join(' / ')}）`, units.filter((u) => u.kind === 'req' && u.priority !== undefined).length],
        ['F-2', () => checkF2(units), '`task.scope_paths` 出现时是非空字符串数组、每项为相对路径（⛔ 绝对路径 / ⛔ 含 `..`）', units.filter((u) => u.kind === 'task' && u.scope_paths !== undefined).length],
        ['F-3', () => checkF3(units), `\`task.budget\` 出现时含 ${BUDGET_KEYS.join(' 与 ')} 且均为正整数`, units.filter((u) => u.kind === 'task' && u.budget !== undefined).length],
        ['F-4', () => checkF4(units, pathExistsInLedger), '`run.report` 出现时是账本区内真实存在的 `.md`', units.filter((u) => u.kind === 'run' && u.report !== undefined).length],
        ['F-5', () => checkF5(units), '`acc.verified_at` 出现时是 ISO8601 形态', units.filter((u) => u.kind === 'acc' && u.verified_at !== undefined).length],
      ]
      for (const [id, fn, what, present] of fGates) {
        const probs = fn()
        if (probs.length === 0) ok(`${id} ✓ **形态判据**：${what} —— 本索引该字段出现 **${present}** 处，**0** 处不合形态（⛔ 不强制出现）`)
        else for (const p of probs) bad(`${id} · ${p}`)
      }

      /**
       * ── F-7 / F-8 · 两条"该必填"按 §五 的**决策规则**处置 ⇒ **退成覆盖率 note** ──
       *
       * ⚠⚠ **实测（本轮）**：
       *   · F-7（`run.report` 对 `returned` 的 run 必填）：`returned` run **26** 条，有 `report` **0** 条 ⇒ 缺 **26** > 3；
       *   · F-8（`acc.verified_at` 对已出判决的 acc 必填）：已出判决 **25** 条（按 `status` 取），
       *     有 `verified_at` **0** 条 ⇒ 缺 **25** > 3。
       * ⇒ 按 `TASK-R5.md` §五 决策规则第三档：**⛔ 不许强制**，退成「形态判据（F-4 / F-5 已在上方）+ 覆盖率 note」。
       *
       * ── ⚠ **为什么这一条留到下一轮（写进代码注释，作业书要求）** ──────────
       *   这两项都要求**当时的作业现场留下读数**：`report` 是回传件的落点、`verified_at` 是判决时刻。
       *   26 条 run / 25 条 acc 是**过去 40 多轮**记的，那时账本里没有这两个字段，
       *   而那些回传件与时刻**多数已经不在盘上/不在记录里**。
       *   ⇒ 现在强制，唯一出路是**编一个路径**或**编一个时刻** —— 那正是 `CONSTITUTION` §7 明令禁止的
       *     「⛔ 不许拿推断当读数」。⇒ 与 `STORED_NO_NEW_FIELD` 同类判断，但**超过 3 条豁免上限**，
       *     所以连豁免都不登记（豁免上限的意义就是"超过就别硬来"）。
       *   ⚠ 下一轮的正确做法：**不是**回头补这两项，而是让**新记的** run / acc 必须带
       *     （那时缺的条数自然 ≤ 3）。⛔ 本轮不擅自改口径。
       */
      const returnedRuns = units.filter((u) => u.kind === 'run' && String(u.status) === 'returned')
      const withReport = returnedRuns.filter((r) => r.report !== undefined && String(r.report).trim() !== '')
      const judgedAccs = units.filter((u) => u.kind === 'acc' && ['pass', 'send-back'].includes(accVerdict(u)))
      const withVerified = judgedAccs.filter((a) => a.verified_at !== undefined && String(a.verified_at).trim() !== '')
      ok(`F-7 · **覆盖率读数（⛔ 未强制）**：\`returned\` 的 run **${returnedRuns.length}** 条 · 有 \`report\` **${withReport.length}** 条`
        + ` ⇒ 缺 **${returnedRuns.length - withReport.length}** 条 > 3 ⇒ 按 §五 决策规则**不强制**（形态判据见 F-4；留到下一轮的理由见代码注释）`)
      ok(`F-8 · **覆盖率读数（⛔ 未强制）**：已出判决的 acc **${judgedAccs.length}** 条 · 有 \`verified_at\` **${withVerified.length}** 条`
        + ` ⇒ 缺 **${judgedAccs.length - withVerified.length}** 条 > 3 ⇒ 按 §五 决策规则**不强制**（形态判据见 F-5；留到下一轮的理由见代码注释）`)

      /**
       * ── **F-7b** · `run.report` **只对 `delivered_at` 晚于硬边界的 run 强制** ──────────
       *   （2026-11-01 P40/R7 · `TASK-R7.md` §5.3）
       *
       * ⚠ 它与上方 F-7（覆盖率读数、⛔ 不强制）**不是二选一**：F-7 说的是**存量**（26 条历史 run，
       *   补不了），F-7b 说的是**增量**（从 P40 开工日起新记的 run，必须带）。
       *   ⇒ 两条并存，才既不给历史编路径、也不让"下一轮起必须带"变成一句空话。
       *
       * ⚠⚠ 判据依赖 `delivered_at` 这个**硬边界**：`delivered_at` 缺失 ⇒ **不判**
       *   （判不出它是不是新 run ⇒ ⛔ 不许按"旧"放行、也⛔ 不许按"新"判红 —— 那都是拿推断当读数）。
       *   这正是历史那 26 条的情形（它们写的是 `delivered_why = 判不出`）。
       */
      const parseTs = (v) => {
        const t = String(v ?? '').trim()
        if (t === '') return undefined
        const ms = Date.parse(t)
        return Number.isFinite(ms) ? ms : undefined
      }
      const fromMs = parseTs(REPORT_REQUIRED_FROM)
      const newRuns = units.filter((u) => {
        if (u.kind !== 'run') return false
        const ms = parseTs(u.delivered_at)
        return ms !== undefined && fromMs !== undefined && ms >= fromMs
      })
      const newRunsNoReport = newRuns.filter((r) => String(r.report ?? '').trim() === '')
      if (newRunsNoReport.length === 0) {
        ok(`F-7b ✓ **新记的 \`run\` 都带 \`report\`**：\`delivered_at\` ≥ \`${REPORT_REQUIRED_FROM}\`（P40 开工日）的 run **${newRuns.length}** 条`
          + ` ⇒ 缺 \`report\` **0** 条（⚠ 存量 ${returnedRuns.length} 条旧 run 的 \`report\` 仍为空 —— 那是 F-7 的覆盖率读数，⛔ 本条不管，补不了也不许编）`)
      } else {
        for (const r of newRunsNoReport) {
          bad(`F-7b · \`${r.id}\`：\`delivered_at\` = ${JSON.stringify(r.delivered_at)} ≥ 硬边界 \`${REPORT_REQUIRED_FROM}\`，`
            + '但 `report` **为空** ⇒ 新记的 run 必须留回传件落点（⛔ 不许只写"已回传"）')
        }
      }

      /** ── F-6-E1 · 准备度豁免名单只减不增 ── */
      const pe = checkReadyE1(STORED_READY_NO_PLAN)
      if (pe.length === 0) {
        ok(`F-6-E1 ✓ **准备度豁免名单只减不增**：当前 **${STORED_READY_NO_PLAN.length}** 条 ≤ 上一轮记录 **${STORED_READY_NO_PLAN_MAX}** 条；每条都有原因与清理计划`
          + `（逐条：${STORED_READY_NO_PLAN.map((e) => e.id).join(' / ') || '空'}）`)
      } else for (const p of pe) bad(`F-6-E1 · ${p}`)
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // I10 / I7 / I8 / I9 · 四条覆盖判据（2026-10-31 P40/R2 · `TASK-R2.md` §四）
  // ══════════════════════════════════════════════════════════════════════
  {
    /**
     * ⚠⚠ **存量棘轮**（`TASK-R2.md` §五）：本轮新增字段，账本里 95 条存量单元大多没有。
     *   ⛔ 不许用"新字段一律不强制"来绕（那等于本轮白做）；⛔ 也不许逼人给存量的活编结果。
     *   ⇒ 口径：**新字段的强制按状态生效**（见 `CONDITIONAL_FIELDS`），
     *     确实回溯不了的存量逐条进 **`STORED_NO_NEW_FIELD`**，且该名单**只减不增**。
     *   ⚠ 这里打印名单**每一条的原因**（`TASK-R2.md` §五3）—— ⛔ 不许只报个数。
     */
    const gate = (id, fn) => {
      const probs = fn(units)
      const stored = new Set(STORED_NO_NEW_FIELD.map((e) => e.id))
      const hard = probs.filter((p) => ![...stored].some((sid) => p.startsWith(sid)))
      const exempted = probs.length - hard.length
      if (hard.length === 0) {
        return { ok: true, msg: `**${probs.length}** 处引用问题${exempted > 0 ? `（其中 **${exempted}** 处落在存量豁免名单里，逐条见下）` : ''}` }
      }
      return { ok: false, probs: hard }
    }

    const i10 = gate('I10', checkI10)
    if (i10.ok) ok(`I10 ✓ **需求 → 验收**：本索引 ${units.filter((u) => u.kind === 'req' && String(u.status) === 'agreed').length} 条 \`agreed\` 需求，每条 \`acceptance_ids\` 非空、`
      + `逐个指向真实 \`acc\` 且 parent 链指得回来（${i10.msg}）`)
    else for (const p of i10.probs) bad(`I10 · ${p}`)

    const i7 = gate('I7', checkI7)
    if (i7.ok) ok(`I7 ✓ **任务 → 证据**：本索引 ${units.filter((u) => u.kind === 'task' && String(u.status) === 'built').length} 条 \`built\` 任务，每条 \`verify_refs\` 非空、`
      + `逐个指向真实 \`evidence\`（${i7.msg}）`)
    else for (const p of i7.probs) bad(`I7 · ${p}`)

    const i8 = gate('I8', checkI8)
    if (i8.ok) ok(`I8 ✓ **决策取代双向**：\`supersedes\` ⇔ \`superseded_by\` 双向对上、被取代者 \`status=superseded\`（本索引 ${units.filter((u) => u.kind === 'decision').length} 条决策 · ${i8.msg}）`)
    else for (const p of i8.probs) bad(`I8 · ${p}`)

    const i9 = gate('I9', checkI9)
    if (i9.ok) ok(`I9 ✓ **引用不断链**：\`risk_ids\` / \`addresses\` / \`decisions\` / \`affects\` / \`evidence_refs\` / \`acceptance_ids\` / \`basis\` 里的 id 全部真实存在（${i9.msg}）`)
    else for (const p of i9.probs) bad(`I9 · ${p}`)

    /** ── I-E1 · 存量豁免名单只减不增 + 每条必须有原因与清理计划 ── */
    {
      const probs = checkIE1(STORED_NO_NEW_FIELD)
      if (probs.length === 0) {
        ok(`I-E1 ✓ **豁免名单只减不增**：当前 **${STORED_NO_NEW_FIELD.length}** 条 ≤ 上一轮记录 **${STORED_NO_NEW_FIELD_MAX}** 条`
          + `${STORED_NO_NEW_FIELD.length > 0 ? '；每条都有原因与清理计划' : '（空名单：本轮没有"回溯不了"的存量）'}`)
      } else for (const p of probs) bad(`I-E1 · ${p}`)
    }

    /** ⚠ 存量豁免名单：**每一条都打印原因**（⛔ 不许只报个数）。 */
    if (STORED_NO_NEW_FIELD.length === 0) {
      ok('I-E0 ✓ 存量豁免名单**为空**（新字段全部有真出处，⛔ 没有"先豁免再说"的条目）')
    } else {
      ok(`I-E0 · 存量豁免名单 **${STORED_NO_NEW_FIELD.length}** 条（⚠ 只减不增，由 I-E1 咬住）：`)
      for (const e of STORED_NO_NEW_FIELD) console.log(`         · ${e.id} —— ${e.why}（计划：${e.plan}）`)
    }
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
        // ── I5c · spec/checkpoint.md 手改即红（2026-10-31 P42/R4 · `TASK-R4.md` §三）──
        {
          /**
           * ⚠ 外部读数必须与生成器 `main()` 注入的**同一份**（否则逐字节比不了）：
           *   `constitutionBytes` 读盘数、`buildStamp` 压成一行。
           *   ⚠ 收敛判定**两边都不注入** ⇒ 快照里写"判不出"，⛔ 不在生成器里造第二份判据。
           */
          let cb = null
          try { cb = Buffer.byteLength(readFileSync(join(ROOT, 'preset', 'dsh-hob', 'CONSTITUTION.md'), 'utf8'), 'utf8') } catch { cb = null }
          let bs = null
          try {
            bs = readFileSync(join(ROOT, 'lib', 'BUILD-STAMP'), 'utf8')
              .split('\n').map((x) => x.trim()).filter((x) => x !== '').join(' · ')
          } catch { bs = null }
          /**
           * ⚠⚠ **`convergence` 必须与生成器 `main()` 注入的同一份**（2026-10-31 P42b/R4b）——
           *   漏注入 ⇒ 生成器写 1913 B（带收口判定）、本判据算 1543 B（「判不出」）⇒ 假红。
           *   实测踩过：`I5c · 实 1913 B vs 期望 1543 B`。
           *   ⇒ 两边都调 `src/shared/convergence.ts` 的**同一个** `convergenceOf`。
           */
          const convFn = (chg) => {
            const r = convMod.convergenceOf(chg, units)
            return { converged: r.converged, blockedBy: r.blockedBy }
          }
          const p5c = checkI5c(LEDGER, renderSpecArtifacts, { constitutionBytes: cb, buildStamp: bs, convergence: convFn })
          if (p5c.length === 0) {
            /**
             * ⚠⚠ **2026-11-01 P40/R6**：`renderSpecArtifacts` 现在返回**两份**
             *   （`checkpoint.md` + `portfolio.md`）⇒ 本条的文案必须**逐份报**，
             *   ⛔ 不许再只写 `spec/checkpoint.md` —— 那会让读者以为只核了一份，
             *   而实际漏核的那份**不会红**（"文案少说一份"正是本仓最忌的假覆盖形态）。
             */
            const specNames = Object.keys(renderSpecArtifacts(units, { constitutionBytes: cb, buildStamp: bs, convergence: convFn }))
            const sizes = specNames.map((n) => `${n} ${Buffer.byteLength(readFileSync(join(LEDGER, 'spec', n), 'utf8'), 'utf8')} B`).join(' · ')
            ok(`I5c ✓ **${specNames.length} 份 spec 快照逐字节 == 生成器输出**（${sizes}）`
              + ' ⇒ 快照不可能被手改而不被发现')
          } else for (const x of p5c) bad(`I5c · ${x}`)

          // ── C-RESUME · 恢复入口读得到快照（⚠ 只读，⛔ 不自动回滚）──
          const rc = readCheckpointForResume(LEDGER)
          if (rc.found && rc.missing.length === 0) {
            ok(`C-RESUME ✓ 恢复入口**读得到快照**：\`spec/checkpoint.md\` ${rc.bytes} B · 四类读数全在（${rc.sections.length}/4）`
              + '；⚠ 本轮只接"读得到 + 判得出有没有"，⛔ 不做自动回滚（作业书 §三 明写）')
          } else if (!rc.found) {
            bad('C-RESUME · **没有快照** ⇒ 恢复时无法核对外面变了什么（⚠ 先跑 `npm run gen:ledger`）')
          } else {
            bad(`C-RESUME · 快照**缺读数段**：${rc.missing.join(' / ')} ⇒ 恢复核对会漏项`)
          }
        }

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

  // ── N-I1e：`built` 缺 `built_by` ⇒ 必红（⚠ P29 的 todo 例外**不许**波及 built）──
  /**
   * ⚠⚠ **这条是 P29 `todo` 例外的护栏**（`TASK-P29` §一 明确要求两条，缺一条不算做完）：
   *   例外只给 `status === "todo"`；⚠ **`built` 仍然必填** ——
   *   没有这条，"加个 todo 例外"与"把手禁拆了"在读数上**分不开**（`E-27` 的形态）。
   */
  {
    const fx = [
      { id: 'TSK-901', kind: 'task', title: 't', parent: 'R-001', status: 'built', after: [], source: 'x', verify: 'v' },
    ]
    // ⚠ 先自证夹具真的缺字段（⛔ 不许"以为删了"）
    const reallyMissing = fx[0].built_by === undefined && fx[0].status === 'built'
    const probs = checkI1(fx, () => true)
    const hit = probs.find((x) => x.includes('TSK-901') && x.includes('built_by') && x.includes('必填'))
    if (!reallyMissing) {
      bad('N-I1e · 夹具不是"built 且缺 built_by" ⇒ 这条负向对拍本身不可判')
    } else if (hit !== undefined) {
      ok(`N-I1e ✓ 负向对拍（\`status="built"\` 且缺 \`built_by\`）⇒ I1 **必红**：${hit.slice(0, 80)}`
        + ' ⇒ **todo 例外没有波及 built**')
    } else {
      bad(`N-I1e · \`built\` 缺 \`built_by\` 却**没红** ⇒ todo 例外把手禁拆了（实报：${JSON.stringify(probs.slice(0, 2))}）`)
    }
  }

  // ── N-I1f：`doing` 缺 `built_by` ⇒ 必红（⚠ 同上，中间态也不许免）──
  {
    const fx = [
      { id: 'TSK-902', kind: 'task', title: 't', parent: 'R-001', status: 'doing', after: [], source: 'x', verify: 'v' },
    ]
    const reallyMissing = fx[0].built_by === undefined && fx[0].status === 'doing'
    const probs = checkI1(fx, () => true)
    const hit = probs.find((x) => x.includes('TSK-902') && x.includes('built_by') && x.includes('必填'))
    if (!reallyMissing) {
      bad('N-I1f · 夹具不是"doing 且缺 built_by" ⇒ 这条负向对拍本身不可判')
    } else if (hit !== undefined) {
      ok(`N-I1f ✓ 负向对拍（\`status="doing"\` 且缺 \`built_by\`）⇒ I1 **必红**：${hit.slice(0, 80)}`
        + ' ⇒ **todo 例外没有波及 doing**')
    } else {
      bad(`N-I1f · \`doing\` 缺 \`built_by\` 却**没红** ⇒ todo 例外把手禁拆了（实报：${JSON.stringify(probs.slice(0, 2))}）`)
    }
  }


  // ── N-I1g：把某条 task 的 verify 改成「已完成」（无出处）⇒ 必红 ──
  /**
   * ⚠ P30 §二 要求的负向对拍：把一条 **不在存量豁免名单里** 的 task 的 `verify`
   *   改成只有结论的「已完成」 ⇒ 必须红。
   *   ⚠⚠ **先自证夹具真的坏了**（改完后那条的 verify 确实不含出处）。
   */
  {
    const target = units.find((u) => u.kind === 'task' && u.status !== 'todo'
      && !STORED_VERIFY_NO_CITE.includes(String(u.id)))
    if (target === undefined) {
      bad('N-I1g · 找不到一条"不在存量名单里的已完工 task"⇒ 负向对拍不可判')
    } else {
      const fx = units.map((u) => (u.id === target.id ? { ...u, verify: '已完成' } : u))
      const reallyChanged = fx.find((u) => u.id === target.id)?.verify === '已完成'
      const probs = checkI1(fx, () => true)
      const hit = probs.find((x) => x.includes(String(target.id)) && x.includes('没有可核出处'))
      if (!reallyChanged) {
        bad('N-I1g · 夹具没真的把 verify 改成「已完成」⇒ 负向对拍本身不可判')
      } else if (!hit) {
        bad(`N-I1g · 把 ${target.id} 的 verify 改成「已完成」却没报缺出处 ⇒ 那条断言没牙（实报：${JSON.stringify(probs.slice(0, 2))}）`)
      } else {
        ok(`N-I1g ✓ 负向对拍（把 ${target.id} 的 \`verify\` 改成「已完成」）⇒ 必红：${String(hit).slice(0, 80)}`)
      }
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
  // ══════════════════════════════════════════════════════════════════════
  // 2026-10-31 P40/R2 · 四条覆盖判据的负向对拍（`TASK-R2.md` §六）
  // ⚠ 每条都：① 先自证夹具真的坏了 ② 再断言**判红那行是它自己的编号** ③ 不只测通过路径
  // ══════════════════════════════════════════════════════════════════════

  // ── N-I10：`agreed` 需求的 `acceptance_ids` 置空 ⇒ I10 必红 ──
  {
    const target = units.find((u) => u.kind === 'req' && String(u.status) === 'agreed'
      && !STORED_NO_NEW_FIELD.some((e) => e.id === u.id))
    if (target === undefined) {
      bad('N-I10 · 找不到一条不在豁免名单里的 agreed 需求 ⇒ 本条不可判')
    } else {
      const mut = units.map((u) => (u.id === target.id ? { ...u, acceptance_ids: undefined } : u))
      const reallyBroken = mut.find((u) => u.id === target.id).acceptance_ids === undefined
      const probs = checkI10(mut)
      const hit = probs.find((x) => x.startsWith(target.id) && x.includes('acceptance_ids'))
      if (!reallyBroken) bad('N-I10 · 夹具没真的清掉 acceptance_ids ⇒ 本条不可判')
      else if (hit !== undefined) ok(`N-I10 ✓ 负向对拍（先自证：清掉 \`${target.id}\` 的 \`acceptance_ids\` ⇒ 该字段 undefined）⇒ I10 的"需求已定却无人证明"**必红**：${hit.slice(0, 90)}`)
      else bad('N-I10 · 清掉了 acceptance_ids 而 I10 没报 ⇒ 判据哑了')
    }
  }

  // ── N-I10b：验收 acc 的 parent 链指不回该需求 ⇒ I10 必红（⚠ 只测"挂了一条错 acc"，不只测空）──
  {
    const target = units.find((u) => u.kind === 'req' && String(u.status) === 'agreed'
      && Array.isArray(u.acceptance_ids) && u.acceptance_ids.length > 0)
    /**
     * ⚠⚠ **夹具必须真挑一条"指不回 target"的 acc**（实测踩过）：
     *   第一版随手取 `units.find(kind==='acc')` = `ACC-001`，而它**正好就是 R-002 的验收**
     *   ⇒ 换上去仍然指得回 ⇒ I10 绿灯 ⇒ 对拍报"判据哑了"（**假哑**，实为夹具选错）。
     *   ⇒ 现在**显式挑一条 parent 链走不到 target 的 acc**，并自证它确实走不到。
     */
    const reachTo = (acc) => {
      const byId = new Map(units.map((x) => [x.id, x]))
      let cur = byId.get(String(acc.parent ?? ''))
      for (let hop = 0; hop < 3 && cur !== undefined; hop++) {
        if (cur.id === target?.id) return true
        if (cur.kind === 'req') return false
        cur = byId.get(String(cur.parent ?? ''))
      }
      return false
    }
    const otherAcc = target === undefined
      ? undefined
      : units.find((u) => u.kind === 'acc' && u.parent !== undefined && !reachTo(u))
    if (target === undefined || otherAcc === undefined) {
      bad('N-I10b · 找不到「有 acceptance_ids 的需求」或「一条 parent 链真指不回它的 acc」⇒ 本条不可判')
    } else {
      // 把该需求的 acceptance_ids 换成一个**真实存在但 parent 链指不回来**的 acc
      const mut = units.map((u) => (u.id === target.id ? { ...u, acceptance_ids: [otherAcc.id] } : u))
      const reallyBroken = JSON.stringify(mut.find((u) => u.id === target.id).acceptance_ids) === JSON.stringify([otherAcc.id])
      const probs = checkI10(mut)
      const hit = probs.find((x) => x.startsWith(target.id) && x.includes('指不回'))
      if (!reallyBroken) bad('N-I10b · 夹具没真的换掉 acceptance_ids ⇒ 本条不可判')
      else if (hit !== undefined) ok(`N-I10b ✓ 负向对拍（先自证：把 \`${target.id}\` 的验收改成 \`${otherAcc.id}\`（真实存在但 parent 指不回它））⇒ I10 的"覆盖是假的"**必红**：${hit.slice(0, 90)}`)
      else bad('N-I10b · 挂了条指不回需求的 acc，I10 却绿灯 ⇒ 只核了"有没有"，没核"指得回"')
    }
  }

  // ── N-I10c：acceptance_ids 指向**不存在**的 id ⇒ I10 必红（判不出 ⇒ 红）──
  {
    const target = units.find((u) => u.kind === 'req' && String(u.status) === 'agreed'
      && Array.isArray(u.acceptance_ids) && u.acceptance_ids.length > 0)
    if (target === undefined) {
      bad('N-I10c · 找不到有 acceptance_ids 的需求 ⇒ 本条不可判')
    } else {
      const ghost = 'ACC-9999'
      const mut = units.map((u) => (u.id === target.id ? { ...u, acceptance_ids: [ghost] } : u))
      const reallyBroken = !units.some((u) => u.id === ghost)
      const probs = checkI10(mut)
      const hit = probs.find((x) => x.startsWith(target.id) && x.includes(ghost))
      if (!reallyBroken) bad('N-I10c · 夹具用的 ghost id 居然存在 ⇒ 本条不可判')
      else if (hit !== undefined) ok(`N-I10c ✓ 负向对拍（先自证：\`${ghost}\` 在索引里不存在）⇒ I10 的"悬空引用不许放过"**必红**：${hit.slice(0, 90)}`)
      else bad('N-I10c · 指向不存在的 acc 却绿灯 ⇒ 悬空引用被静默放过了（正是 §四 要堵的洞）')
    }
  }

  // ── N-I7：`built` 任务的 `verify_refs` 置空 ⇒ I7 必红 ──
  {
    const target = units.find((u) => u.kind === 'task' && String(u.status) === 'built')
    if (target === undefined) {
      bad('N-I7 · 找不到 built 任务 ⇒ 本条不可判')
    } else {
      const mut = units.map((u) => (u.id === target.id ? { ...u, verify_refs: [] } : u))
      const reallyBroken = Array.isArray(mut.find((u) => u.id === target.id).verify_refs)
        && mut.find((u) => u.id === target.id).verify_refs.length === 0
      const probs = checkI7(mut)
      const hit = probs.find((x) => x.startsWith(target.id) && x.includes('verify_refs'))
      if (!reallyBroken) bad('N-I7 · 夹具没真的清空 verify_refs ⇒ 本条不可判')
      else if (hit !== undefined) ok(`N-I7 ✓ 负向对拍（先自证：清空 \`${target.id}\` 的 \`verify_refs\`）⇒ I7 的"做完了却指不出读数"**必红**：${hit.slice(0, 90)}`)
      else bad('N-I7 · 清空了 verify_refs 而 I7 没报 ⇒ 判据哑了')
    }
  }

  // ── N-I7b：`verify_refs` 指向不存在的 evidence ⇒ I7 必红；且 `todo` **不**被要求（豁免仍生效）──
  {
    const builtOne = units.find((u) => u.kind === 'task' && String(u.status) === 'built')
    const todoOne = units.find((u) => u.kind === 'task' && String(u.status) === 'todo')
    if (builtOne === undefined) {
      bad('N-I7b · 找不到 built 任务 ⇒ 本条不可判')
    } else {
      const ghost = 'EVD-9999'
      const mut = units.map((u) => (u.id === builtOne.id ? { ...u, verify_refs: [ghost] } : u))
      const probs = checkI7(mut)
      const hitGhost = probs.find((x) => x.startsWith(builtOne.id) && x.includes(ghost))
      // ⚠ 同时自证 todo 豁免没被这条新判据带坏
      const todoProbs = todoOne === undefined ? [] : checkI7(units).filter((x) => x.startsWith(todoOne.id))
      if (!units.some((u) => u.id === ghost) && hitGhost !== undefined && todoProbs.length === 0) {
        ok(`N-I7b ✓ 负向对拍（先自证：\`${ghost}\` 不存在）⇒ I7 的"悬空证据引用"**必红**：${hitGhost.slice(0, 80)}`
          + `${todoOne === undefined ? '' : `；⚠ 且 \`todo\` 任务 \`${todoOne.id}\` **仍被豁免**（0 条问题）`}`)
      } else if (hitGhost === undefined) {
        bad('N-I7b · 指向不存在的 evidence 却绿灯 ⇒ 悬空引用被放过')
      } else {
        bad(`N-I7b · \`todo\` 豁免被带坏了：${JSON.stringify(todoProbs.slice(0, 2))}`)
      }
    }
  }

  // ── N-I8：只写单边 `supersedes` ⇒ I8 必红（⚠ 覆盖"单边声明"这一种坏法）──
  {
    const fake = [
      { id: 'DEC-001', kind: 'decision', status: 'superseded', title: '旧决策', supersedes: '', superseded_by: 'DEC-002' },
      { id: 'DEC-002', kind: 'decision', status: 'active', title: '新决策', supersedes: 'DEC-001', superseded_by: '' },
    ]
    const reallyBroken = fake[1].supersedes === 'DEC-001' && fake[0].superseded_by === 'DEC-002'
      && fake[0].status === 'superseded'
    const probs = checkI8(fake)
    const hit = probs.find((x) => x.includes('状态没跟上'))
    if (!reallyBroken) bad('N-I8 · 夹具没造出"双向对上了但状态没跟上"的形态 ⇒ 本条不可判')
    else if (hit !== undefined) ok(`N-I8a ✓ 负向对拍（先自证：\`DEC-002.supersedes = DEC-001\` 且 \`DEC-001.superseded_by = DEC-002\` 双向对上，但 \`DEC-001.status = "superseded"\` 之外还留旧态）⇒ I8 的"状态没跟上"**必红**：${hit.slice(0, 80)}`)
    else {
      // 这条夹具恰好是"全对"的形态 ⇒ 反过来证明 I8 不误报，再换一个真坏的
      const bad1 = [
        { id: 'DEC-001', kind: 'decision', status: 'active', title: '旧', supersedes: '', superseded_by: '' },
        { id: 'DEC-002', kind: 'decision', status: 'active', title: '新', supersedes: 'DEC-001', superseded_by: '' },
      ]
      const p2 = checkI8(bad1)
      const h2 = p2.find((x) => x.includes('单边声明'))
      if (h2 !== undefined) ok(`N-I8b ✓ 负向对拍（先自证：\`DEC-002.supersedes = DEC-001\` 而 \`DEC-001.superseded_by\` 为空 ⇒ 单边）⇒ I8 的"单边声明"**必红**：${h2.slice(0, 80)}`)
      else bad('N-I8 · 单边声明却绿灯 ⇒ I8 哑了')
    }
  }

  // ── N-I8b：反向单边（B 说被 A 取代、A 没写）⇒ 必红 ──
  {
    const fake = [
      { id: 'DEC-001', kind: 'decision', status: 'superseded', title: '旧', supersedes: '', superseded_by: 'DEC-002' },
      { id: 'DEC-002', kind: 'decision', status: 'active', title: '新', supersedes: '', superseded_by: '' },
    ]
    const probs = checkI8(fake)
    const hit = probs.find((x) => x.includes('反向'))
    if (hit !== undefined) ok(`N-I8c ✓ 负向对拍（先自证：\`DEC-001.superseded_by = DEC-002\` 而 \`DEC-002.supersedes\` 为空）⇒ I8 的"反向单边"**必红**：${hit.slice(0, 90)}`)
    else bad('N-I8c · 反向单边却绿灯 ⇒ I8 只核了一个方向（⛔ "双向"名不副实）')
  }

  // ── N-I9：`risk_ids` 指向不存在的 id ⇒ I9 必红 ──
  {
    const anyUnit = units.find((u) => u.kind === 'task')
    if (anyUnit === undefined) {
      bad('N-I9 · 找不到可挂引用的单元 ⇒ 本条不可判')
    } else {
      const ghost = 'RSK-9999'
      const mut = units.map((u) => (u.id === anyUnit.id ? { ...u, risk_ids: [ghost] } : u))
      const probs = checkI9(mut)
      const hit = probs.find((x) => x.startsWith(anyUnit.id) && x.includes(ghost))
      if (!units.some((u) => u.id === ghost) && hit !== undefined) {
        ok(`N-I9 ✓ 负向对拍（先自证：\`${ghost}\` 不存在）⇒ I9 的"悬空引用"**必红**：${hit.slice(0, 90)}`)
      } else bad('N-I9 · 悬空 risk_ids 却绿灯 ⇒ "覆盖看起来成立"的洞还在')
    }
  }

  // ── N-I9b：把 `addresses` 指向一个**真实存在但 kind 不对**的单元 ⇒ 必红 ──
  {
    const chg = units.find((u) => u.kind === 'change')
    const wrongKind = units.find((u) => u.kind === 'acc')
    if (chg === undefined || wrongKind === undefined) {
      bad('N-I9b · 找不到 change 或 acc ⇒ 本条不可判')
    } else {
      const mut = units.map((u) => (u.id === chg.id ? { ...u, addresses: [wrongKind.id] } : u))
      const probs = checkI9(mut)
      const hit = probs.find((x) => x.startsWith(chg.id) && x.includes('应为'))
      if (hit !== undefined) ok(`N-I9b ✓ 负向对拍（先自证：把 \`${chg.id}.addresses\` 指向 \`${wrongKind.id}\`（acc，⛔ 不是 req））⇒ I9 的"kind 不对"**必红**：${hit.slice(0, 90)}`)
      else bad('N-I9b · 指向了 kind 不对的单元却绿灯 ⇒ I9 只核了存在性')
    }
  }

  // ── N-I-E1：豁免名单加一条（超过棘轮上限）⇒ I-E1 必红 ──
  {
    const over = [...STORED_NO_NEW_FIELD, { id: 'R-999', why: '夹具', plan: '夹具' }]
    const reallyOver = over.length === STORED_NO_NEW_FIELD.length + 1 && over.length > STORED_NO_NEW_FIELD_MAX
    const probs = checkIE1(over)
    const hit = probs.find((x) => x.includes('只减不增'))
    if (!reallyOver) bad('N-I-E1 · 夹具没造出"超上限"的名单 ⇒ 本条不可判')
    else if (hit !== undefined) ok(`N-I-E1 ✓ 负向对拍（先自证：名单 ${STORED_NO_NEW_FIELD.length} → ${over.length} 条，超过棘轮上限 ${STORED_NO_NEW_FIELD_MAX}）⇒ I-E1 的"只减不增"**必红**：${hit.slice(0, 90)}`)
    else bad('N-I-E1 · 名单超上限却绿灯 ⇒ 棘轮失效（那这条名单就只会长）')
  }

  // ══════════════════════════════════════════════════════════════════════
  // 2026-10-31 P41/R3 · 门禁的「必须拒绝」负向对拍（`TASK-R3.md` §五）
  // ⚠ 每条：① 先自证夹具真造出了那个非法状态 ② 断言判红那行是**它自己的编号**
  //   ③ **反面也要有**：合法状态必须绿（⛔ 只测红 ⇒ 判据可能恒红，那也是坏的）
  // ══════════════════════════════════════════════════════════════════════

  // ── N-I5c：手改快照一个字符 ⇒ 必红；恢复入口读得到 ⇒ 绿 ──
  {
    const tmp = join(WORK, 'mut-checkpoint')
    cpSync(LEDGER, tmp, { recursive: true })
    const cp = join(tmp, 'spec', 'checkpoint.md')
    const orig = readFileSync(cp, 'utf8')
    // ⚠ 自证：改的确实是**快照正文**里的一个字符
    const mutated = orig.replace('阶段快照', '阶段快照X')
    const reallyChanged = mutated !== orig
    writeFileSync(cp, mutated)
    /**
     * ⚠ 外部读数必须用**与主流程同源的那一份**（真读盘）：
     *   传 `null` 会让"写回原文"也对不上（实测 1475 B vs 1543 B）⇒ 反面夹具假红。
     *   这条坑本身是 N-I5c 抓出来的 —— 夹具不真，判据的绿也是假的。
     */
    const realExtra = () => {
      let cb = null
      try { cb = Buffer.byteLength(readFileSync(join(ROOT, 'preset', 'dsh-hob', 'CONSTITUTION.md'), 'utf8'), 'utf8') } catch { cb = null }
      let bs = null
      try {
        bs = readFileSync(join(ROOT, 'lib', 'BUILD-STAMP'), 'utf8')
          .split('\n').map((x) => x.trim()).filter((x) => x !== '').join(' · ')
      } catch { bs = null }
      const convFn2 = (chg) => {
        const r = convMod.convergenceOf(chg, readUnits(join(LEDGER, 'units', 'index.toml')))
        return { converged: r.converged, blockedBy: r.blockedBy }
      }
      return { constitutionBytes: cb, buildStamp: bs, convergence: convFn2 }
    }
    const probs = checkI5c(tmp, renderSpecArtifacts, realExtra())
    const hit = probs.find((x) => x.includes('spec/checkpoint.md') && x.includes('不一致'))
    // 反面：原样写回 ⇒ 绿
    writeFileSync(cp, orig)
    const probs2 = checkI5c(tmp, renderSpecArtifacts, realExtra())
    rmSync(tmp, { recursive: true, force: true })
    if (!reallyChanged) bad('N-I5c · 夹具没改到快照正文 ⇒ 本条不可判')
    else if (hit === undefined) bad('N-I5c · 手改快照却绿灯 ⇒ I5c 哑了（那 resume 会拿假读数当真）')
    else if (probs2.length !== 0) bad(`N-I5c · 写回原文后仍红 ⇒ 恒红（${JSON.stringify(probs2)}）`)
    else ok(`N-I5c ✓ 负向对拍（先自证：把 \`spec/checkpoint.md\` 里的「阶段快照」改成「阶段快照X」）⇒ I5c **必红**：${hit.slice(0, 80)}`
      + '；**反面**：写回原文 ⇒ **转绿**')
  }

  // ── N-RESUME：快照缺失 / 缺读数段 ⇒ 恢复入口**判得出**（⛔ 不许静默当"有"）──
  {
    const tmp = join(WORK, 'mut-resume')
    cpSync(LEDGER, tmp, { recursive: true })
    const cp = join(tmp, 'spec', 'checkpoint.md')
    const orig = readFileSync(cp, 'utf8')
    // ① 缺整份 ⇒ found=false
    rmSync(cp, { force: true })
    const gone = readCheckpointForResume(tmp)
    // ② 缺一段 ⇒ missing 非空
    /**
     * ⚠ 自证陷阱（实测抓到过）：原来把锚点改成「## 四、外部读数（被删）」——
     *   `includes('## 四、外部读数')` **仍然为真** ⇒ 夹具没真造出"缺段"。
     *   ⇒ 必须**整行删掉**，而不是在锚点后面追加字。
     */
    writeFileSync(cp, orig.split('\n').filter((l) => l !== '## 四、外部读数').join('\n'))
    const partial = readCheckpointForResume(tmp)
    // ③ 原样 ⇒ 全在
    writeFileSync(cp, orig)
    const full = readCheckpointForResume(tmp)
    rmSync(tmp, { recursive: true, force: true })
    const okGone = gone.found === false && gone.missing.length > 0
    const okPartial = partial.found === true && partial.missing.length > 0
    const okFull = full.found === true && full.missing.length === 0
    if (okGone && okPartial && okFull) {
      ok(`N-RESUME ✓ 负向对拍（先自证：① 删掉整份快照 ② 改掉"## 四、外部读数"这个锚点）⇒ 恢复入口**三态都判得出**：`
        + `① 缺 ⇒ found=false + missing=${JSON.stringify(gone.missing)} ② 缺段 ⇒ missing=${JSON.stringify(partial.missing)} ③ 原样 ⇒ 4/4 全在`)
    } else bad(`N-RESUME · 判不出（gone=${okGone} partial=${okPartial} full=${okFull}）`)
  }

  // ── N-B1：`send-back` 缺 `send_back_to` / 填自由文本 ⇒ 都必红；填对 ⇒ 绿 ──
  {
    const missing = [{ id: 'ACC-901', kind: 'acc', status: 'send-back', parent: 'TSK-901', after: [] }]
    const freeText = [{ id: 'ACC-901', kind: 'acc', status: 'send-back', send_back_to: '重做一下', parent: 'TSK-901', after: [] }]
    const good = [{ id: 'ACC-901', kind: 'acc', status: 'send-back', send_back_to: 'back-to-plan', parent: 'TSK-901', after: [] }]
    const pMissing = checkB1(missing)
    const pFree = checkB1(freeText)
    const pGood = checkB1(good)
    const okMissing = pMissing.some((x) => x.includes('没写 `send_back_to`'))
    const okFree = pFree.some((x) => x.includes('不在封闭集'))
    if (okMissing && okFree && pGood.length === 0) {
      ok(`N-B1 ✓ 负向对拍（先自证：① \`ACC-901.status="send-back"\` 且无 \`send_back_to\` ② 填自由文本 \`"重做一下"\`）`
        + `⇒ B-1 **两种坏法都必红**：①${pMissing[0].slice(0, 40)}… ②${pFree[0].slice(0, 40)}…；**反面**：填 \`back-to-plan\` ⇒ **转绿**`)
    } else bad(`N-B1 · 判据没咬住（缺=${okMissing} 自由文本=${okFree} 合法绿=${pGood.length === 0}）`)
  }

  // ── N-B2：`pass` 却带 `send_back_to` ⇒ 必红；清空 ⇒ 绿 ──
  {
    const contradictory = [{ id: 'ACC-902', kind: 'acc', status: 'pass', send_back_to: 'back-to-task', parent: 'TSK-902', after: [] }]
    const good = [{ id: 'ACC-902', kind: 'acc', status: 'pass', parent: 'TSK-902', after: [] }]
    const p = checkB2(contradictory)
    const hit = p.some((x) => x.includes('自相矛盾'))
    if (hit && checkB2(good).length === 0) {
      ok(`N-B2 ✓ 负向对拍（先自证：\`ACC-902.outcome="pass"\` 却带 \`send_back_to="back-to-task"\`）⇒ B-2 的"自相矛盾"**必红**：${p[0].slice(0, 60)}`
        + '；**反面**：清空 `send_back_to` ⇒ **转绿**')
    } else bad(`N-B2 · 自相矛盾却绿灯（hit=${hit}）`)
  }

  // ── N-G1：`built` 却零 run（且不在豁免名单）⇒ 必红；补一条 run ⇒ 转绿 ──
  {
    const fake = [
      { id: 'TSK-901', kind: 'task', status: 'built', parent: 'R-001', after: [] },
    ]
    const probs = checkG1(fake)
    const hit = probs.find((x) => x.startsWith('TSK-901') && x.includes('跳过'))
    // 反面：给它一条 returned 的 run ⇒ 必须绿
    const okCase = checkG1([...fake, { id: 'RUN-901', kind: 'run', status: 'returned', parent: 'TSK-901', after: [] }])
    const reallyBroken = fake[0].status === 'built' && !fake.some((u) => u.kind === 'run')
    if (!reallyBroken) bad('N-G1 · 夹具没造出"built 且零 run"的形态 ⇒ 本条不可判')
    else if (hit === undefined) bad('N-G1 · built 且零 run 却绿灯 ⇒ G-1 哑了')
    else if (okCase.length !== 0) bad(`N-G1 · 补了 run 之后仍红 ⇒ G-1 恒红（${JSON.stringify(okCase)}）`)
    else ok(`N-G1 ✓ 负向对拍（先自证：\`TSK-901\` 是 \`built\` 且索引里零 run）⇒ G-1 的"跳过 \`doing\`"**必红**：${hit.slice(0, 70)}`
      + '；**反面**：补一条 `returned` 的 run ⇒ **转绿**（⛔ 不是恒红）')
  }

  // ── N-G2：`run` 没到 `returned` 就记 `built` ⇒ 必红（⚠ 作业书点名要专测）──
  {
    const fake = [
      { id: 'TSK-902', kind: 'task', status: 'built', parent: 'R-001', after: [] },
      { id: 'RUN-902', kind: 'run', status: 'running', parent: 'TSK-902', after: [] },
    ]
    const probs = checkG2(fake)
    const hit = probs.find((x) => x.startsWith('TSK-902') && x.includes('没回传'))
    const okCase = checkG2([fake[0], { ...fake[1], status: 'returned' }])
    const reallyBroken = fake[1].status === 'running' && fake[0].status === 'built'
    if (!reallyBroken) bad('N-G2 · 夹具没造出"run 在跑 + task 已 built" ⇒ 本条不可判')
    else if (hit === undefined) bad('N-G2 · 没回传就记 built 却绿灯 ⇒ **这正是最容易被顺手放过的那条**')
    else if (okCase.length !== 0) bad(`N-G2 · run 改成 returned 后仍红 ⇒ 恒红（${JSON.stringify(okCase)}）`)
    else ok(`N-G2 ✓ 负向对拍（先自证：\`RUN-902.status = "running"\` 而 \`TSK-902.status = "built"\`）⇒ G-2 的"没回传就记 built"**必红**：${hit.slice(0, 70)}`
      + '；**反面**：run 改 `returned` ⇒ **转绿**')
  }

  // ── N-G3：`acc.actor == built_by` ⇒ 必红；换个人 ⇒ 绿 ──
  {
    const fake = [
      { id: 'TSK-903', kind: 'task', status: 'built', parent: 'R-001', after: [], built_by: 'session-SAME', verify: 'check:x 1/1' },
      { id: 'ACC-903', kind: 'acc', status: 'pass', parent: 'TSK-903', after: [], actor: 'session-SAME', evidence: ['check:x 1/1'] },
    ]
    const probs = checkG3(fake)
    const hit = probs.find((x) => x.startsWith('G-3') && x.includes('自己验自己'))
    const okCase = checkG3([fake[0], { ...fake[1], actor: 'session-OTHER' }])
    if (hit === undefined) bad('N-G3 · actor == built_by 却绿灯 ⇒ G-3 哑了')
    else if (okCase.length !== 0) bad(`N-G3 · 换人后仍红 ⇒ 恒红（${JSON.stringify(okCase)}）`)
    else ok(`N-G3 ✓ 负向对拍（先自证：\`ACC-903.actor\` 与 \`TSK-903.built_by\` 同为 \`session-SAME\`）⇒ G-3 的"自己验自己"**必红**：${hit.slice(0, 70)}`
      + '；**反面**：actor 换 `session-OTHER` ⇒ **转绿**')
  }

  // ── N-G4：`dropped` 却没写为什么 ⇒ 必红；写了理由 ⇒ 绿 ──
  {
    const fake = [{ id: 'R-901', kind: 'req', status: 'dropped', parent: 'spec/progress', after: [], source: '' }]
    const probs = checkG4(fake)
    const hit = probs.find((x) => x.startsWith('R-901') && x.includes('为什么丢'))
    const okCase = checkG4([{ ...fake[0], drop_why: '用户 2026-10-31 裁定不做' }])
    if (hit === undefined) bad('N-G4 · dropped 且无理由却绿灯 ⇒ G-4 哑了')
    else if (okCase.length !== 0) bad(`N-G4 · 写了理由后仍红 ⇒ 恒红（${JSON.stringify(okCase)}）`)
    else ok(`N-G4 ✓ 负向对拍（先自证：\`R-901.status = "dropped"\` 且 \`source\` 为空）⇒ G-4 的"没有理由就丢"**必红**：${hit.slice(0, 70)}`
      + '；**反面**：补 `drop_why` ⇒ **转绿**')
  }

  // ── N-G1E1：G-1 豁免名单超上限 / 缺原因 ⇒ 必红 ──
  {
    const over = [...STORED_G1_NO_RUN, { id: 'TSK-999', why: '夹具', plan: '夹具' }]
    const pOver = checkG1E1(over)
    const pNoWhy = checkG1E1([{ id: 'TSK-999', why: '', plan: '夹具' }])
    if (pOver.some((x) => x.includes('只减不增')) && pNoWhy.some((x) => x.includes('没写原因'))) {
      ok(`N-G1E1 ✓ 负向对拍（先自证：名单 ${STORED_G1_NO_RUN.length} → ${over.length} 条超上限 ${STORED_G1_NO_RUN_MAX}；另一夹具 \`why\` 为空）`
        + '⇒ G-1-E1 的"只减不增"与"必须写原因"**两条都必红**')
    } else bad(`N-G1E1 · 超上限或缺原因却绿灯 ⇒ 棘轮失效（${JSON.stringify([pOver, pNoWhy])}）`)
  }

  // ── N-G5：`settled` 方案挂 `draft` 需求 ⇒ 必红；需求转 `agreed` ⇒ 绿 ──
  {
    const fake = [
      { id: 'CHG-905', kind: 'change', status: 'settled', parent: 'spec/progress', after: [], addresses: ['R-905'], proposal: 'p.md', built_by: 's' },
      { id: 'R-905', kind: 'req', status: 'draft', parent: 'spec/progress', after: [], source: 'x' },
    ]
    const probs = checkG5(fake)
    const hit = probs.find((x) => x.startsWith('CHG-905') && x.includes('方案定在一条没定的需求上'))
    const okCase = checkG5([fake[0], { ...fake[1], status: 'agreed' }])
    const reallyBroken = fake[1].status === 'draft' && fake[0].addresses.includes('R-905')
    if (!reallyBroken) bad('N-G5 · 夹具没造出"settled 挂在 draft 需求上" ⇒ 本条不可判')
    else if (hit === undefined) bad('N-G5 · settled 挂在 draft 需求上却绿灯 ⇒ G-5 哑了（假覆盖照样全绿）')
    else if (okCase.length !== 0) bad(`N-G5 · 需求转 agreed 后仍红 ⇒ 恒红（${JSON.stringify(okCase)}）`)
    else ok(`N-G5 ✓ 负向对拍（先自证：\`CHG-905.addresses = ["R-905"]\` 而 \`R-905.status = "draft"\`）⇒ G-5 的"方案定在没定的需求上"**必红**：${hit.slice(0, 80)}`
      + '；**反面**：需求转 `agreed` ⇒ **转绿**')
  }

  // ── N-G6：`built` 任务挂在 `proposed` 方案下 ⇒ 必红；方案 `settled`/`superseded` ⇒ 都绿 ──
  {
    const mk = (chgStatus) => [
      { id: 'CHG-906', kind: 'change', status: chgStatus, parent: 'spec/progress', after: [], proposal: 'p.md', built_by: 's' },
      { id: 'TSK-906', kind: 'task', status: 'built', parent: 'CHG-906', after: [], built_by: 's', verify: 'v' },
    ]
    const probs = checkG6(mk('proposed'))
    const hit = probs.find((x) => x.startsWith('TSK-906') && x.includes('方案没定就开工了'))
    const okSettled = checkG6(mk('settled'))
    const okSuperseded = checkG6(mk('superseded'))
    const reallyBroken = mk('proposed')[1].status === 'built' && mk('proposed')[0].status === 'proposed'
    if (!reallyBroken) bad('N-G6 · 夹具没造出"built 挂在 proposed 方案下" ⇒ 本条不可判')
    else if (hit === undefined) bad('N-G6 · built 挂在 proposed 方案下却绿灯 ⇒ G-6 哑了')
    else if (okSettled.length !== 0) bad(`N-G6 · 方案 settled 后仍红 ⇒ 恒红（${JSON.stringify(okSettled)}）`)
    else if (okSuperseded.length !== 0) bad(`N-G6 · 方案 **superseded** 后仍红 ⇒ 口径写错（终态必须含 superseded，⛔ 不是只要 settled）：${JSON.stringify(okSuperseded)}`)
    else ok(`N-G6 ✓ 负向对拍（先自证：\`TSK-906\` 是 \`built\` 而 \`CHG-906.status = "proposed"\`）⇒ G-6 的"方案没定就开工了"**必红**：${hit.slice(0, 80)}`
      + '；**正向对照两条**：方案 `settled` ⇒ 绿 · 方案 **`superseded`** ⇒ **也绿**（⛔ 取代一条方案不该把它下面已做完的活判红）')
  }

  // ── N-G7：`returned` 的 run 挂在 `todo` 任务下 ⇒ 必红；任务 `doing` ⇒ 绿 ──
  {
    const fake = [
      { id: 'TSK-907', kind: 'task', status: 'todo', parent: 'R-001', after: [] },
      { id: 'RUN-907', kind: 'run', status: 'returned', parent: 'TSK-907', after: [] },
    ]
    const probs = checkG7(fake)
    const hit = probs.find((x) => x.startsWith('RUN-907') && x.includes('没开工就收到了回传'))
    const okCase = checkG7([{ ...fake[0], status: 'doing' }, fake[1]])
    const reallyBroken = fake[1].status === 'returned' && fake[0].status === 'todo'
    if (!reallyBroken) bad('N-G7 · 夹具没造出"returned 挂在 todo 任务下" ⇒ 本条不可判')
    else if (hit === undefined) bad('N-G7 · returned 挂在 todo 任务下却绿灯 ⇒ G-7 哑了')
    else if (okCase.length !== 0) bad(`N-G7 · 任务转 doing 后仍红 ⇒ 恒红（${JSON.stringify(okCase)}）`)
    else ok(`N-G7 ✓ 负向对拍（先自证：\`RUN-907.status = "returned"\` 而 \`TSK-907.status = "todo"\`）⇒ G-7 的"没开工就收到了回传"**必红**：${hit.slice(0, 80)}`
      + '；**反面**：任务转 `doing` ⇒ **转绿**')
  }

  // ── N-G8：`pass` 的 acc 验的 task 还在 `doing` ⇒ 必红；task `built` ⇒ 绿 ──
  {
    const fake = [
      { id: 'TSK-908', kind: 'task', status: 'doing', parent: 'R-001', after: [], built_by: 's', verify: 'v' },
      { id: 'ACC-908', kind: 'acc', status: 'pass', parent: 'TSK-908', after: [], actor: 'other', evidence: ['e'], basis: ['EVD-001'] },
    ]
    const probs = checkG8(fake)
    const hit = probs.find((x) => x.startsWith('ACC-908') && x.includes('没做完就判过了'))
    const okCase = checkG8([{ ...fake[0], status: 'built' }, fake[1]])
    const reallyBroken = fake[1].status === 'pass' && fake[0].status === 'doing'
    if (!reallyBroken) bad('N-G8 · 夹具没造出"pass 而 task 还在 doing" ⇒ 本条不可判')
    else if (hit === undefined) bad('N-G8 · pass 而 task 还在 doing 却绿灯 ⇒ G-8 哑了')
    else if (okCase.length !== 0) bad(`N-G8 · task 转 built 后仍红 ⇒ 恒红（${JSON.stringify(okCase)}）`)
    else ok(`N-G8 ✓ 负向对拍（先自证：\`ACC-908.outcome/status = "pass"\` 而 \`TSK-908.status = "doing"\`）⇒ G-8 的"没做完就判过了"**必红**：${hit.slice(0, 80)}`
      + '；**正向对照**：task 转 `built` ⇒ **转绿**（⛔ 不是恒红）')
  }

  // ── N-A1：`after` 与 `parent` 混用 ⇒ 必红；正常 ⇒ 不红 ──
  {
    /**
     * ⚠ 作业书 §一.2 给的形态是"`parent === after[0]` 就红"。**实测存量 42 条会全红**
     *   （`task→change` 14 条 · `run→task` 26 条 · `task→req` 2 条，全是结构性必然）⇒
     *   已改成"封闭模式 + 存量清零"，理由见 `checkA1` 上方长注释。
     * ⇒ 本条负向对拍要覆盖**改后口径真正咬的两件事**：
     *   ① 重合模式不在封闭集内（造 `req→req`）⇒ 必红；
     *   ② `task` 属于 req A 却在等 req B ⇒ 必红（这才是"把该承接的塞进 after"的可指认形态）。
     */
    const badPattern = [
      { id: 'R-961', kind: 'req', status: 'agreed', parent: 'R-960', after: ['R-960'] },
      { id: 'R-960', kind: 'req', status: 'agreed', parent: 'spec/progress', after: [] },
    ]
    const pBad = checkA1(badPattern)
    /** ⚠ 先自证：夹具真的造出了 `req→req` 重合。 */
    const selfProvenA = badPattern[0].parent === badPattern[0].after[0]

    const fight = [
      { id: 'R-962', kind: 'req', status: 'agreed', parent: 'spec/progress', after: [] },
      { id: 'R-963', kind: 'req', status: 'agreed', parent: 'spec/progress', after: [] },
      { id: 'TSK-961', kind: 'task', status: 'todo', parent: 'R-962', after: ['R-962', 'R-963'] },
    ]
    const pFight = checkA1(fight)

    /**
     * 正向对照：合法的三类重合 ⇒ **一条都不许红**。
     * ⚠⚠ **R9 起必须用登记名单里的真 id**：闸二（逐条）加进来之后，
     *   造一批假 id（`TSK-962` 之类）会被判"不在登记名单里" ⇒ 正向对照自己先红。
     *   ⇒ 直接拿账本里**真实存在**的三类各一条来核（`TSK-034` / `RUN-001` / `TSK-031`）。
     */
    const good = [
      { id: 'R-002', kind: 'req', status: 'agreed', parent: 'spec/progress', after: [] },
      { id: 'CHG-2026-10-30-rearch', kind: 'change', status: 'settled', parent: 'spec/progress', after: [] },
      { id: 'TSK-034', kind: 'task', status: 'built', parent: 'CHG-2026-10-30-rearch', after: ['CHG-2026-10-30-rearch'] },
      { id: 'TSK-031', kind: 'task', status: 'built', parent: 'R-002', after: ['R-002'] },
      { id: 'RUN-001', kind: 'run', status: 'returned', parent: 'TSK-034', after: ['TSK-034'] },
    ]
    const pGood = checkA1(good)

    if (!selfProvenA) bad('N-A1 · 夹具没造出 `req→req` 重合 ⇒ 本条不可判')
    else if (pBad.length === 0) bad('N-A1 · 封闭集外的重合（`req→req`）**没被判红** ⇒ A-1 的封闭模式白写了')
    else if (pFight.length === 0) bad('N-A1 · `task` 属于 R-962 却在 `after` 里等 R-963 ⇒ **没被判红** ⇒ "归属与前置打架"没咬住')
    else if (pGood.length !== 0) bad(`N-A1 · **合法的三类重合被判红了** ⇒ ⛔ 会把 42 条存量结构性地打红（${JSON.stringify(pGood.slice(0, 2))}）`)
    else {
      ok('N-A1 ✓ 负向对拍（先自证：夹具真的造出 `R-961.parent === R-961.after[0]` 的 `req→req` 重合）'
        + `⇒ 封闭集外的重合**必红**：${pBad[0].slice(0, 70)}…`
        + `；**第二种坏法**（\`TSK-961\` 属于 \`R-962\` 却在 \`after\` 里等 \`R-963\`）**也必红**：${pFight[0].slice(0, 60)}…`
        + '；**正向对照**：`task→change` / `run→task` / `task→req` 三类**合法且已登记**的重合（`TSK-034` · `RUN-001` · `TSK-031`）⇒ **一条都不红**'
        + '（⚠ 实测存量 42 条全在这三类里、且全在名单里，⛔ 不许把它们判红）')
    }
  }

  // ── N-A1b：**替换绕过**（删一条旧的 + 加一条新的，总数不变）⇒ 必红 ──
  {
    /**
     * ⚠⚠ **这条是 R9 的核心负向对拍**（`TASK-R9.md` §一）。
     *
     * ── 它复现的正是 R8 旧判据放过的形态 ──────────────────────────────
     *   旧判据只有两道闸：① 模式在封闭集内；② 总数 ≤ `_MAX`。
     *   ⇒ 删掉名单里的一条（总数 41）、再加一条**同模式**的新重合（总数回到 42）
     *     ⇒ ①② 都满足 ⇒ **旧判据在它上面是绿的**。
     *   ⚠ 这条断言必须把"旧判据会放过"这件事**在消息里点明**，
     *     否则下一个人会以为"这本来就该红"，看不到闸二存在的理由。
     *
     * ── 构造（⚠ 全部用真实 id，才能证明它真的是"替换"而非"假 id 撞红"）──
     *   拿 `TSK-034`（`task→change`，已登记）删掉，换成 `TSK-035`…
     *   ⚠ 不行：`TSK-035` 也在名单里。⇒ 换一个**不在名单里、但模式合法**的：
     *     造 `TSK-039`（`task` 属于 `CHG-2026-10-30-rearch`、`after` 也指向它）——
     *     它不在名单里，模式 `task→change` 合法 ⇒ 正是"用允许的模式做不允许的事"。
     */
    const replaced = [
      { id: 'CHG-2026-10-30-rearch', kind: 'change', status: 'settled', parent: 'spec/progress', after: [] },
      // ⚠ 删掉一条已登记的（TSK-034 不在这个夹具里），换成一条**未登记但同模式**的
      { id: 'TSK-039', kind: 'task', status: 'todo', parent: 'CHG-2026-10-30-rearch', after: ['CHG-2026-10-30-rearch'] },
    ]
    const pReplaced = checkA1(replaced)
    /** ⚠ 先自证：夹具真的是"模式合法 + 不在名单里 + 总数没变"三件同时成立。 */
    const selfProvenB = replaced[1].parent === replaced[1].after[0]
      && PARENT_AFTER_ALLOWED_PATTERNS.includes('task→change')
      && STORED_PARENT_AFTER_OVERLAP.find((e) => e.id === 'TSK-039') === undefined
      && STORED_PARENT_AFTER_OVERLAP.length === STORED_PARENT_AFTER_OVERLAP_MAX
    /** 旧判据（只有闸一 + 总数）在这个夹具上的结论：**绿**（⚠ 这就是缺陷本体）。 */
    const oldVerdictGreen = PARENT_AFTER_ALLOWED_PATTERNS.includes('task→change')
      && STORED_PARENT_AFTER_OVERLAP.length <= STORED_PARENT_AFTER_OVERLAP_MAX

    if (!selfProvenB) bad('N-A1b · 夹具没造出"模式合法 + 不在名单里 + 总数不变" ⇒ 本条不可判')
    else if (!oldVerdictGreen) bad('N-A1b · 夹具没复现出"旧判据会放过"这一形态 ⇒ 证明不了闸二补的是真缺口')
    else if (pReplaced.length === 0) bad('N-A1b · **替换绕过没被判红** ⇒ 闸二哑了（删一条旧的加一条新的，总数不变就绿）')
    else {
      ok('N-A1b ✓ 负向对拍（先自证：夹具是"模式 `task→change` 合法 + `TSK-039` 不在名单里 + 名单长度仍 = `_MAX` 42"三件同时成立）'
        + `⇒ **替换绕过必红**：${pReplaced[0].slice(0, 78)}…`
        + '；⚠ **旧判据在这个夹具上是绿的**（它只比"模式"与"总数"，删一条旧的加一条新的总数不变 ⇒ 过）'
        + ' ⇒ 这就是 `REVIEW-R8.md` §四 那个缺陷的活体标本，⛔ 不是"加个名单好看"')
    }
  }

  // ── N-A1c：名单变长 ⇒ 必红（`_MAX` 那道闸）──
  {
    const grown = [...STORED_PARENT_AFTER_OVERLAP, { id: 'TSK-999', pattern: 'task→req', why: '夹具' }]
    const pGrown = grown.length > STORED_PARENT_AFTER_OVERLAP_MAX
    /** ⚠ 先自证：名单原本正好等于 `_MAX` ⇒ 加一条必然超。 */
    const selfProvenC = STORED_PARENT_AFTER_OVERLAP.length === STORED_PARENT_AFTER_OVERLAP_MAX
    if (!selfProvenC) bad(`N-A1c · 名单长度（${STORED_PARENT_AFTER_OVERLAP.length}）≠ \`_MAX\`（${STORED_PARENT_AFTER_OVERLAP_MAX}）⇒ 本条不可判`)
    else if (!pGrown) bad('N-A1c · 名单变长却**没超上限** ⇒ 棘轮哑了')
    else {
      ok(`N-A1c ✓ 负向对拍（先自证：名单长度 ${STORED_PARENT_AFTER_OVERLAP.length} = \`_MAX\` ${STORED_PARENT_AFTER_OVERLAP_MAX}）`
        + `⇒ 加一条（${grown.length} 条）**必超上限** ⇒ 名单只减不增这道闸有牙`)
    }
  }

  // ── N-A2：`evidence.parent` 指 `req` ⇒ 必红；指 `DEC-` ⇒ 不红 ──
  {
    const unitsA2 = [
      { id: 'R-965', kind: 'req', status: 'agreed', parent: 'spec/progress', after: [] },
      { id: 'DEC-961', kind: 'decision', status: 'active', parent: 'spec/progress', after: [] },
      { id: 'TSK-964', kind: 'task', status: 'built', parent: 'R-965', after: [] },
    ]
    const badEv = [...unitsA2, { id: 'EVD-961', kind: 'evidence', parent: 'R-965', status: 'recorded' }]
    const okEv = [...unitsA2, { id: 'EVD-962', kind: 'evidence', parent: 'DEC-961', status: 'recorded' }]
    const okEvTask = [...unitsA2, { id: 'EVD-963', kind: 'evidence', parent: 'TSK-964', status: 'recorded' }]
    const pBadEv = checkA2(badEv, EVIDENCE_PARENT_KINDS)
    const pOkEv = checkA2(okEv, EVIDENCE_PARENT_KINDS)
    const pOkTask = checkA2(okEvTask, EVIDENCE_PARENT_KINDS)
    /** ⚠ 先自证：夹具里那条 evidence 的 parent 真的是 `req`。 */
    const selfProvenA2 = badEv[3].parent === 'R-965' && badEv[0].kind === 'req'
    if (!selfProvenA2) bad('N-A2 · 夹具没造出"`evidence.parent` 指 `req`" ⇒ 本条不可判')
    else if (pBadEv.length === 0) bad('N-A2 · `evidence.parent` 指 `req` **没被判红** ⇒ ⛔ 那等于允许"需求自证"')
    else if (pOkEv.length !== 0) bad(`N-A2 · 指 \`DEC-\` 却被判红 ⇒ ⛔ 会逼人把决策依据挂到无关 task 上（${JSON.stringify(pOkEv)}）`)
    else if (pOkTask.length !== 0) bad(`N-A2 · 指 \`TSK-\` 却被判红 ⇒ 常规形态被咬（${JSON.stringify(pOkTask)}）`)
    else {
      ok('N-A2 ✓ 负向对拍（先自证：夹具里 `EVD-961.parent = R-965` 而 `R-965.kind = req`）'
        + `⇒ 指 \`req\` **必红**：${pBadEv[0].slice(0, 80)}…`
        + '；**正向对照两条**：① 指 `DEC-961`（决策依据）⇒ **不红** ② 指 `TSK-964`（常规形态）⇒ **不红**')
    }
  }

  // ── N-F7b：新 run 缺 `report` ⇒ 必红；旧 run 缺 ⇒ **不红** ──
  {
    /**
     * ⚠ 这条判据最容易写错的地方是**把边界写反**（把旧 run 也判红 ⇒ 26 条历史全红，
     *   等于逼人给过去 40 轮编 26 个路径）。⇒ 负向对拍与正向对照**必须成对**：
     *   ① 新 run（`delivered_at` 晚于硬边界）缺 `report` ⇒ **必红**；
     *   ② 旧 run（`delivered_at` 早于硬边界）缺 `report` ⇒ **⛔ 不红**；
     *   ③ `delivered_at` **判不出** ⇒ **不判**（⛔ 不许猜它是新是旧）。
     */
    const parseTs = (v) => {
      const t = String(v ?? '').trim()
      if (t === '') return undefined
      const ms = Date.parse(t)
      return Number.isFinite(ms) ? ms : undefined
    }
    const fromMs = parseTs(REPORT_REQUIRED_FROM)
    const fresh = { id: 'RUN-931', kind: 'run', status: 'returned', parent: 'TSK-931', delivered_at: '2026-11-01T10:00:00+08:00', started_at: '2026-11-01T09:00:00+08:00' }
    const freshWithReport = { ...fresh, id: 'RUN-932', report: 'archive/x/REPORT-R7.md' }
    const stale = { id: 'RUN-933', kind: 'run', status: 'returned', parent: 'TSK-933', delivered_at: '2026-10-20T10:00:00+08:00', started_at: '2026-10-20T09:00:00+08:00' }
    const undecidable = { id: 'RUN-934', kind: 'run', status: 'returned', parent: 'TSK-934', delivered_why: '判不出：原始投递时刻未留档' }
    const needReport = (u) => {
      const ms = parseTs(u.delivered_at)
      return ms !== undefined && fromMs !== undefined && ms >= fromMs && String(u.report ?? '').trim() === ''
    }
    /** ⚠ 先自证：夹具的新 run 真的过了边界、旧 run 真的没过。 */
    const selfProven = parseTs(fresh.delivered_at) >= fromMs
      && parseTs(stale.delivered_at) < fromMs
      && parseTs(undecidable.delivered_at) === undefined
    if (!selfProven) bad('N-F7b · 夹具没造出"一新一旧一判不出"三种情形 ⇒ 本条不可判')
    else if (!needReport(fresh)) bad('N-F7b · 新 run 缺 `report` 却**没被判红** ⇒ F-7b 哑了（"从本轮起必须带"变成空话）')
    else if (needReport(freshWithReport)) bad('N-F7b · 新 run **带了** `report` 仍被判红 ⇒ 判据把好的也咬了')
    else if (needReport(stale)) bad('N-F7b · **旧 run 缺 `report` 被判红** ⇒ ⛔ 等于逼人给过去 26 条历史编 26 个路径（拿推断当读数）')
    else if (needReport(undecidable)) bad('N-F7b · `delivered_at` **判不出**却按"新 run"判红 ⇒ 拿推断当读数')
    /**
     * ── **多条新 run 混合**（2026-11-01 P40/R8 · `TASK-R8.md` §三）────────────────
     *   真账本只有 `RUN-027` **一条**新 run ⇒ 判据的正确性几乎全靠夹具。
     *   本条造**六条**：三条新（两条带 `report`、一条不带）+ 两条旧（都不带）+ 一条判不出。
     *
     * ⚠⚠ 作业书要求：**逐条核报出的 id**，⛔ 不许只核"问题数 > 0" ——
     *   后者证明不了它**没误报旧 run**（"报了 1 条"可能是"漏了新的那条、误报了旧的那条"）。
     */
    const mixed = [
      { id: 'RUN-941', kind: 'run', status: 'returned', parent: 'TSK-941', delivered_at: '2026-11-01T11:00:00+08:00', report: 'archive/a/REPORT-1.md' },
      { id: 'RUN-942', kind: 'run', status: 'returned', parent: 'TSK-942', delivered_at: '2026-11-01T12:00:00+08:00' },
      { id: 'RUN-943', kind: 'run', status: 'returned', parent: 'TSK-943', delivered_at: '2026-11-02T09:00:00+08:00', report: 'archive/a/REPORT-2.md' },
      { id: 'RUN-944', kind: 'run', status: 'returned', parent: 'TSK-944', delivered_at: '2026-10-20T10:00:00+08:00' },
      { id: 'RUN-945', kind: 'run', status: 'returned', parent: 'TSK-945', delivered_at: '2026-09-15T10:00:00+08:00' },
      { id: 'RUN-946', kind: 'run', status: 'returned', parent: 'TSK-946', delivered_why: '判不出：原始投递时刻未留档' },
    ]
    const reported = mixed.filter(needReport).map((r) => r.id)
    const expectOnly = ['RUN-942']
    /** ⚠ 先自证：混合夹具真的同时包含"新缺"、"新带"、"旧缺"、"判不出"四种。 */
    const mixSelfProven = mixed.filter((r) => parseTs(r.delivered_at) >= fromMs).length === 3
      && mixed.filter((r) => parseTs(r.delivered_at) < fromMs).length === 2
      && mixed.filter((r) => parseTs(r.delivered_at) === undefined).length === 1
    if (!mixSelfProven) {
      bad('N-F7b-mix · 夹具没造出"三新 + 两旧 + 一判不出" ⇒ 本条不可判')
    } else if (JSON.stringify(reported) !== JSON.stringify(expectOnly)) {
      bad(`N-F7b-mix · 混合形态下报出的 id 不对：期望**只有** \`${expectOnly.join(' / ')}\`，实际 \`${reported.join(' / ') || '空'}\``
        + ' ⇒ ⚠ 多报了 = 误伤旧 run（⛔ 逼人给历史编路径）；少报了 = 漏掉新 run（⛔ "从本轮起必须带"成空话）')
    } else {
      ok('N-F7b ✓ 负向对拍（先自证：`RUN-931` 的 `delivered_at` 2026-11-01T10:00 ≥ 硬边界、`RUN-933` 的 2026-10-20 < 硬边界、`RUN-934` 的 `delivered_at` 判不出）'
        + '⇒ 新 run 缺 `report` **必红**；**正向对照三条**：① 新 run 带了 ⇒ **不红** ② **旧 run 缺 ⇒ ⛔ 不红**（存量 27 条不逼人编路径）③ `delivered_at` 判不出 ⇒ **不判**'
        + `；**多条混合**（三新 + 两旧 + 一判不出，逐条核 id）⇒ 报出的**恰好只有** \`${reported.join(' / ')}\``
        + '（新·缺）⇒ ⛔ 没误报 `RUN-944`/`RUN-945`（旧·缺）、⛔ 没误报 `RUN-946`（判不出）、⛔ 没漏 `RUN-942`')
    }
  }

  // ── N-P1：`agreed` 且无 change 无 pass acc ⇒ 必红；有 pass acc ⇒ 必绿 ──
  {
    /**
     * ⚠ 夹具 ①（孤儿）：需求 `agreed`、没有 change 的 `addresses` 指向它、挂着一条 `unverified` 的 acc。
     * ⚠ 夹具 ②（已交付）：同样没有 change，但 acc 是 **`pass`** ⇒ **必须不报**。
     *   ⚠⚠ ② 是这条判据最要紧的一面：**⛔ 不许把已交付的活报成孤儿**
     *     （那会逼人给一件做完的事补一条 change = 造假读数）。
     */
    /**
     * ⚠⚠ **夹具随口径改（2026-11-01 P40/R7）**：新口径要求 `tasks === 0` **且** `accs === 0`，
     *   旧夹具（挂一条 `unverified` 的 acc、其 parent 是个不存在的 task）在新口径下
     *   `tasks` 仍是 0（task 单元不存在）、但 `accs` 是 1 ⇒ **不再判孤儿**。
     *   ⇒ 夹具改成"真·完全没人碰"：无 change 指向、无 task、无 acc。
     */
    const orphan = [
      { id: 'R-921', kind: 'req', status: 'agreed', acceptance_ids: [] },
      { id: 'CHG-921', kind: 'change', status: 'settled', addresses: ['R-999'] },
    ]
    const delivered = [
      { id: 'R-922', kind: 'req', status: 'agreed', acceptance_ids: ['ACC-922'] },
      { id: 'CHG-922', kind: 'change', status: 'settled', addresses: ['R-999'] },
      { id: 'ACC-922', kind: 'acc', status: 'pass', parent: 'TSK-922' },
    ]
    /** ⚠ 第三条路：acc 挂在 req 下的 **task** 上（间接找法），也必须认。 */
    const deliveredIndirect = [
      { id: 'R-923', kind: 'req', status: 'agreed', acceptance_ids: [] },
      { id: 'TSK-923', kind: 'task', status: 'built', parent: 'R-923' },
      { id: 'ACC-923', kind: 'acc', status: 'pass', parent: 'TSK-923' },
    ]
    const rOrphan = checkP1(orphan, portfolioOfShared, [])
    const rDelivered = checkP1(delivered, portfolioOfShared, [])
    const rIndirect = checkP1(deliveredIndirect, portfolioOfShared, [])
    const hit = rOrphan.problems.find((x) => x.startsWith('R-921') && x.includes('已定的需求没人做'))
    /**
     * ⚠ 先自证：夹具真的"坏了" —— 三条同时成立（agreed · 无 change 承接 · 无 pass acc）。
     */
    const selfProven = orphan[0].status === 'agreed'
      && !orphan.some((u) => u.kind === 'change' && Array.isArray(u.addresses) && u.addresses.includes('R-921'))
      && orphan.filter((u) => u.kind === 'task' && String(u.parent) === 'R-921').length === 0
      && orphan.filter((u) => u.kind === 'acc').length === 0
    const notOrphanByDelivery = delivered[2].status === 'pass'
    const notOrphanByIndirect = deliveredIndirect[2].parent === 'TSK-923' && deliveredIndirect[1].parent === 'R-923'
    /**
     * ⚠⚠ **第三条正向对照（R7 新增，最要紧的一条）**：需求底下有一条 **`todo`** 的 task
     *   ⇒ **⛔ 不许报成孤儿** —— "有 task 就说明有人在管，哪怕它还没开工"。
     *   ⚠ 这条正是 R6 被退回的那条错的正向对照：当时口径没有 `tasks === 0`，
     *     于是把"活做完了没人验"与"还没开工"全都写成"没人做"。
     */
    const managed = [
      { id: 'R-924', kind: 'req', status: 'agreed', acceptance_ids: [] },
      { id: 'TSK-924', kind: 'task', status: 'todo', parent: 'R-924' },
    ]
    const rManaged = checkP1(managed, portfolioOfShared, [])
    const notOrphanByTodoTask = managed[1].status === 'todo' && managed[1].parent === 'R-924'

    if (!selfProven) bad('N-P1 · 夹具没造出"agreed 且无 change 无 pass acc" ⇒ 本条不可判')
    else if (hit === undefined) bad('N-P1 · 已定的需求没人做却绿灯 ⇒ P-1 哑了')
    else if (!notOrphanByDelivery || rDelivered.problems.length !== 0) {
      bad(`N-P1 · **已交付的需求被报成孤儿** ⇒ ⛔ 最坏的一种误报（会逼人给做完的事补 change）：${JSON.stringify(rDelivered.problems)}`)
    } else if (!notOrphanByIndirect || rIndirect.problems.length !== 0) {
      bad(`N-P1 · acc 挂在 req 下的 task 上时没被认（找 acc 的两条路必须与 \`k3\` 一致）：${JSON.stringify(rIndirect.problems)}`)
    } else if (!notOrphanByTodoTask || rManaged.problems.length !== 0) {
      bad(`N-P1 · **有 \`todo\` 的 task 却被报成孤儿** ⇒ ⛔ 把"还没开工"说成"没人做"（R6 被退回的那条错）：${JSON.stringify(rManaged.problems)}`)
    } else {
      ok(`N-P1 ✓ 负向对拍（先自证：\`R-921\` 是 \`agreed\`、没有任何 change 的 \`addresses\` 指向它、**没有 task**、**没有 acc** —— 四条同时成立）`
        + `⇒ P-1 的"已定的需求没人做"**必红**：${hit.slice(0, 70)}`
        + '；**正向对照三条**：① 同样无 change 但 acc 是 **`pass`** ⇒ **不报**（⛔ 已交付的活不许报成孤儿）'
        + ' ② acc 挂在 req 下的 **task** 上（间接找法）⇒ **也认**（与 `k3` 同一套口径）'
        + ' ③ 底下有一条 **`todo`** 的 task ⇒ **不报**（⛔ 不许把"还没开工"说成"没人做"）')
    }
  }

  // ── N-P1E1：孤儿豁免名单超上限 / 缺原因 ⇒ 必红 ──
  {
    /** ⚠ `_MAX` 现在是 2 ⇒ 夹具要造 **3** 条才超限（R7 把上限从 0 抬到实测数 2）。 */
    const over = [
      { id: 'R-997', why: '夹具', plan: '夹具' },
      { id: 'R-998', why: '夹具', plan: '夹具' },
      { id: 'R-999', why: '夹具', plan: '夹具' },
    ]
    const pOver = checkOrphanE1(over)
    const pNoPlan = checkOrphanE1([{ id: 'R-999', why: '夹具', plan: '' }])
    if (pOver.some((x) => x.includes('只减不增')) && pNoPlan.some((x) => x.includes('没写清理计划'))) {
      ok(`N-P1E1 ✓ 负向对拍（先自证：名单 ${STORED_ORPHAN_REQ.length} → ${over.length} 条超上限 ${STORED_ORPHAN_REQ_MAX}；另一夹具 \`plan\` 为空）`
        + '⇒ P-1-E1 的"只减不增"与"必须写清理计划"**两条都必红**')
    } else bad(`N-P1E1 · 超上限或缺计划却绿灯 ⇒ 棘轮失效（${JSON.stringify([pOver, pNoPlan])}）`)
  }

  // ── N-S1：`acc` 出现 `outcome` 字段 ⇒ 必红；正常 acc ⇒ 不出现 ──
  {
    const withOutcome = [{ id: 'ACC-911', kind: 'acc', status: 'pass', outcome: 'pass', parent: 'TSK-911', after: [] }]
    const clean = [{ id: 'ACC-912', kind: 'acc', status: 'pass', parent: 'TSK-912', after: [] }]
    const probs = checkS1(withOutcome)
    const hit = probs.find((x) => x.startsWith('ACC-911') && x.includes('判决只认 `status`'))
    const okCase = checkS1(clean)
    /**
     * ⚠ 先自证夹具真的"坏了"：字段**确实存在**，而且值**与 status 完全相同**
     *   —— 这正是"同一个事实两个落点"的最小形态（不是随便塞个字段）。
     */
    const reallyBroken = Object.prototype.hasOwnProperty.call(withOutcome[0], 'outcome')
      && withOutcome[0].outcome === withOutcome[0].status
    if (!reallyBroken) bad('N-S1 · 夹具没造出"`outcome` 与 `status` 同值并存" ⇒ 本条不可判')
    else if (hit === undefined) bad('N-S1 · acc 出现了 `outcome` 字段却绿灯 ⇒ S-1 哑了（同义字段可以继续漂）')
    else if (okCase.length !== 0) bad(`N-S1 · 正常 acc（无 outcome）也判红 ⇒ 恒红（${JSON.stringify(okCase)}）`)
    else ok(`N-S1 ✓ 负向对拍（先自证：\`ACC-911.outcome = "pass"\` 与 \`status = "pass"\` **同值并存** —— 这就是"一个事实两个落点"的最小形态）`
      + `⇒ S-1 的"判决只认 \`status\`"**必红**：${hit.slice(0, 90)}；**正向对照**：无 \`outcome\` 的 \`ACC-912\` ⇒ **不出现**`)
  }

  // ── N-X1：`superseded` 方案下的 `todo` 任务 ⇒ 必红；`built` 的历史任务 ⇒ 绿 ──
  {
    const fake = [
      { id: 'CHG-909', kind: 'change', status: 'superseded', parent: 'spec/progress', after: [], proposal: 'p.md', built_by: 's' },
      { id: 'TSK-909', kind: 'task', status: 'todo', parent: 'CHG-909', after: [] },
      { id: 'TSK-910', kind: 'task', status: 'built', parent: 'CHG-909', after: [], built_by: 's', verify: 'v' },
    ]
    const probs = checkX1(fake)
    const hit = probs.find((x) => x.startsWith('TSK-909') && x.includes('还在往作废的方案上派活'))
    const okCase = checkX1(fake)
    const reallyBroken = fake[0].status === 'superseded' && fake[1].status === 'todo'
    const builtNotReported = okCase.every((x) => !x.startsWith('TSK-910'))
    if (!reallyBroken) bad('N-X1 · 夹具没造出"superseded 方案下的 todo 任务" ⇒ 本条不可判')
    else if (hit === undefined) bad('N-X1 · superseded 方案下还在派活却绿灯 ⇒ X-1 哑了')
    else if (!builtNotReported) bad('N-X1 · `built` 的历史任务也被判红 ⇒ 口径写错（活干完了是历史事实，⛔ 不许逼人改历史）')
    else ok(`N-X1 ✓ 负向对拍（先自证：\`CHG-909.status = "superseded"\` 而 \`TSK-909.status = "todo"\`）⇒ X-1 的"还在往作废的方案上派活"**必红**：${hit.slice(0, 80)}`
      + '；**正向对照**：同方案下的 `TSK-910`（`built`）**不红**')
  }

  // ── N-E1：`code_state` 写「最新」/ 空 ⇒ 必红；写 commit 或逐字「判不出」⇒ 绿 ──
  {
    const SHA = 'a'.repeat(40)
    const badOnes = [
      { id: 'EVD-951', kind: 'evidence', code_state: '最新' },
      { id: 'EVD-952', kind: 'evidence', code_state: '' },
      { id: 'EVD-953', kind: 'evidence', code_state: '判不出（没记 commit）' },
    ]
    const probs = checkE1(badOnes)
    /**
     * ⚠ 空串走的是**另一句**话（"是空的" —— 空不是"判不出"，两者要分开说），
     *   所以这里按「命中该 id 且给出了不可指认的理由」判，⛔ 不要求三句字面相同。
     */
    const hits = ['EVD-951', 'EVD-952', 'EVD-953'].filter((id) => probs.some((x) => x.startsWith(id)
      && (x.includes('不可指认') || x.includes('是空的'))))
    const okCase = checkE1([
      { id: 'EVD-954', kind: 'evidence', code_state: `commit=${SHA} · dirty=false` },
      { id: 'EVD-955', kind: 'evidence', code_state: '判不出' },
    ])
    if (hits.length !== 3) bad(`N-E1 · 「最新」/空/带理由的判不出 没有全部判红（命中 ${hits.length}/3）⇒ E-1 哑了`)
    else if (okCase.length !== 0) bad(`N-E1 · \`commit=<40hex>\` 或逐字 \`判不出\` 仍红 ⇒ 恒红（${JSON.stringify(okCase)}）`)
    else ok('N-E1 ✓ 负向对拍（先自证：夹具三条分别是 `code_state="最新"` / `""` / `"判不出（没记 commit）"`）'
      + '⇒ E-1 的"不可指认"**三种坏法都必红**；**正向对照**：`commit=<40 hex>` 与**逐字** `判不出` ⇒ **转绿**')
  }

  // ── N-E2：`taken_at` 早于 **`commit_time`** ⇒ 必红；⚠ 早于 `built_at` 但晚于 `commit_time` ⇒ **绿**（§二-5 要害）──
  {
    const SHA = 'b'.repeat(40)
    const CT = '2026-11-01T08:00:00+08:00'   // 代码诞生
    const BA = '2026-11-01T10:00:00+08:00'   // 最后一次构建（⚠ 会动）
    const stamp = {
      commit: SHA, builtAt: BA, builtAtMs: Date.parse(BA),
      commitTime: CT, commitTimeMs: Date.parse(CT),
    }
    const fake = [{ id: 'EVD-956', kind: 'evidence', code_state: `commit=${SHA}`, taken_at: '2026-11-01T07:00:00+08:00' }]
    const rBad = checkE2(fake, stamp)
    const hit = rBad.problems.find((x) => x.startsWith('EVD-956') && x.includes('旧读数冒充当前'))
    const noStamp = checkE2(fake, null)

    /**
     * ⚠⚠ **§二-5 那条正向对照 = 本轮的要害**：
     *   `taken_at` = 09:00 ⇒ **晚于** `commit_time` 08:00，但**早于** `built_at` 10:00。
     *   这正是"重建了但代码没变"的形态 —— **旧判据在这里必红**，新判据必须绿。
     */
    const rebuiltCase = checkE2([{ ...fake[0], taken_at: '2026-11-01T09:00:00+08:00' }], stamp)
    const oldWouldRed = Date.parse('2026-11-01T09:00:00+08:00') < stamp.builtAtMs
    const newIsGreen = rebuiltCase.problems.length === 0 && rebuiltCase.judged === true

    /** ⚠ `commit_time` 缺失 ⇒ 判不出、⛔ 不判红（§二-3）。 */
    const noCt = checkE2(fake, { commit: SHA, builtAt: BA, builtAtMs: Date.parse(BA), commitTime: '', commitTimeMs: null })

    const reallyBroken = Date.parse(fake[0].taken_at) < stamp.commitTimeMs
    if (!reallyBroken) bad('N-E2 · 夹具没造出"taken_at 早于 commit_time" ⇒ 本条不可判')
    else if (hit === undefined) bad('N-E2 · 早于 `commit_time` 却绿灯 ⇒ E-2 哑了（§二-4：改完不许变成恒绿）')
    else if (!oldWouldRed) bad('N-E2 · 夹具没复现出"旧判据会红"这一形态 ⇒ 证明不了循环被拆掉')
    else if (!newIsGreen) bad(`N-E2 · **重建了但代码没变**（09:00 晚于 commit_time 08:00、早于 built_at 10:00）仍红 ⇒ 循环没拆掉（${JSON.stringify(rebuiltCase.problems)}）`)
    else if (noCt.judged !== false || noCt.problems.length !== 0) bad('N-E2 · `commit_time` 缺失时**判红了** ⇒ 每次 build 仍会误伤一遍')
    else if (!String(noCt.note).includes('判不出')) bad('N-E2 · `commit_time` 缺失时没说「判不出 N 条」⇒ 静默通过')
    else if (!noStamp.some((x) => x.includes('判不出'))) bad('N-E2 · 构建戳读不到时没报「判不出」⇒ 静默放过')
    else ok(`N-E2 ✓ 负向对拍（先自证：\`code_state\` commit == 戳 commit，而 \`taken_at\` 07:00 **早于** \`commit_time\` 08:00）`
      + `⇒ "旧读数冒充当前"**必红**：${hit.slice(0, 70)}…`
      + '；⚠⚠ **§二-5 要害（正向）**：`taken_at` 09:00 —— **晚于** `commit_time` 08:00 但**早于** `built_at` 10:00'
      + ' ⇒ 新判据**绿**，而⚠ **旧判据在这个夹具上必红**（这就是"重建了但代码没变"的形态，连续两轮踩的坑）'
      + '；⚠ **§二-3**：`commit_time` 缺失 ⇒ 报「判不出 1 条」而⛔ **不判红**'
      + '；**另一面**：构建戳读不到 ⇒ 报「判不出」而⛔ 不是静默通过')
  }

  // ── N-E3：历史证据**必不判红**（⚠ 这条测的是"不许红"）──
  {
    const SHA = 'c'.repeat(40)
    const stamp = { commit: SHA, builtAt: '2026-11-01T10:00:00+08:00', builtAtMs: Date.parse('2026-11-01T10:00:00+08:00'),
      commitTime: '2026-11-01T08:00:00+08:00', commitTimeMs: Date.parse('2026-11-01T08:00:00+08:00') }
    const r = checkE3([
      { id: 'EVD-957', kind: 'evidence', code_state: `commit=${'d'.repeat(40)}`, taken_at: '2020-01-01T00:00:00+08:00' },
      { id: 'EVD-958', kind: 'evidence', code_state: '判不出', taken_at: '判不出' },
    ], stamp)
    if (r.problems.length !== 0) bad(`N-E3 · 历史证据被判红 ⇒ ⛔ 违反"不许判红"（唯一出路会变成篡改读数 / 删证据）：${JSON.stringify(r.problems)}`)
    else if (r.census.old !== 1 || r.census.undecidable !== 1 || r.census.current !== 0) bad(`N-E3 · 分布读数不对（${JSON.stringify(r.census)}）`)
    else ok(`N-E3 ✓ **"不许判红"的判据自证**（先自证：夹具里一条对应**旧** commit、一条**判不出**，都不是当前 commit）`
      + `⇒ E-3 **0 处问题**，且给出分布读数 ${JSON.stringify(r.census)}（⚠ 历史证据对应旧代码态是本分，⛔ 判红只会逼人篡改读数或删证据）`)
  }

  // ── N-F1..N-F5：五个形态判据各一条负向对拍 + 一条正向对照 ──
  {
    const p1 = checkF1([{ id: 'R-951', kind: 'req', priority: 'urgent' }])
    const o1 = checkF1([{ id: 'R-952', kind: 'req', priority: 'must' }])
    const p2 = checkF2([{ id: 'TSK-951', kind: 'task', scope_paths: ['/abs/path', '../escape', ''] }])
    const o2 = checkF2([{ id: 'TSK-952', kind: 'task', scope_paths: ['src/shared/convergence.ts'] }])
    const p3 = checkF3([{ id: 'TSK-953', kind: 'task', budget: 'tool_calls=12' }])
    const o3 = checkF3([{ id: 'TSK-954', kind: 'task', budget: 'tool_calls=12 · rounds=3' }])
    const p4 = checkF4([{ id: 'RUN-951', kind: 'run', report: 'nope/missing.md' }], () => false)
    const o4 = checkF4([{ id: 'RUN-952', kind: 'run', report: 'spec/checkpoint.md' }], () => true)
    /**
     * ⚠⚠ **F-4 的正向对照必须用"真的解析"**（2026-11-01 P40/R7）：上面 `o4` 注入的是
     *   `() => true`，它只证明"给了 true 就不红"，⛔ 证明不了**路径基准对不对**。
     *   而本轮修的正是基准（相对 `ledger-next/` → 相对账本区根）。
     *   ⇒ 用**真文件 + 真基准**再核一遍：一份真存在、一份真不存在。
     */
    const realBase = join(LEDGER, '..')
    const realReportPath = 'archive/2026-11-01-p40-gap-close/REPORT-R7.md'
    const realExists = existsSync(join(realBase, realReportPath))
    const p4real = checkF4([{ id: 'RUN-954', kind: 'run', report: realReportPath }], (p) => existsSync(join(realBase, p)))
    const p4wrongBase = checkF4([{ id: 'RUN-955', kind: 'run', report: realReportPath }], (p) => existsSync(join(LEDGER, p)))
    const p5 = checkF5([{ id: 'ACC-951', kind: 'acc', verified_at: '2026/11/01 10:00' }])
    const o5 = checkF5([{ id: 'ACC-952', kind: 'acc', verified_at: '2026-11-01T10:00:00+08:00' }])
    const cases = [
      ['F-1', p1.some((x) => x.includes('不在封闭集')), o1.length, '`priority="urgent"`（封闭集外）', '`priority="must"`'],
      ['F-2', p2.some((x) => x.includes('绝对路径')) && p2.some((x) => x.includes('含 `..`')) && p2.some((x) => x.includes('空串')), o2.length, '`scope_paths=["/abs/path","../escape",""]`（三种坏法）', '`["src/shared/convergence.ts"]`'],
      ['F-3', p3.some((x) => x.includes('缺 `rounds`')), o3.length, '`budget="tool_calls=12"`（缺 rounds）', '`tool_calls=12 · rounds=3`'],
      ['F-4', p4.some((x) => x.includes('不存在这份文件')), o4.length, '`report` 指向不存在的 `.md`', '`report` 指向真实存在的 `.md`'],
      ['F-5', p5.some((x) => x.includes('不是 ISO8601')), o5.length, '`verified_at="2026/11/01 10:00"`', '`2026-11-01T10:00:00+08:00`'],
    ]
    /**
     * ⚠ **F-4 的基准自证**（R7 加）：
     *   ① 真文件 + 真基准 ⇒ **必须绿**（⛔ 否则修完恒红）；
     *   ② 同一份文件 + **旧基准**（相对 `ledger-next/`）⇒ **必须红** ——
     *      这条是**这个 bug 的活体标本**：它证明"基准写错就会把真文件判成空气"。
     */
    const baseProof = realExists && p4real.length === 0 && p4wrongBase.length > 0
    if (!baseProof) {
      bad(`N-F1..N-F5 · F-4 的路径基准自证失败（真文件存在=${realExists} · 真基准问题数=${p4real.length} · 旧基准问题数=${p4wrongBase.length}）`
        + ' ⇒ ⛔ 要么修完恒红、要么旧基准也能过（那就没修到）')
    }
    const broken = cases.filter(([, hit, okLen]) => hit !== true || okLen !== 0)
    if (broken.length > 0) bad(`N-F1..N-F5 · 有形态判据没开火或恒红：${JSON.stringify(broken.map(([id]) => id))} ⇒ 见 ${JSON.stringify(cases)}`)
    else ok(`N-F1..N-F5 ✓ 负向对拍（先自证：五个夹具分别是 ${cases.map(([, , , b]) => b).join(' · ')}）`
      + `⇒ 五条形态判据**各必红一条**；**正向对照**：${cases.map(([, , , , g]) => g).join(' · ')} ⇒ **全绿**（⛔ 不是恒红）`
      + `；⚠ **F-4 另加基准自证**：真文件 \`${realReportPath}\` 用**账本区根**基准 ⇒ **绿**（${p4real.length} 条问题）`
      + `，用**旧基准**（相对 \`ledger-next/\`）⇒ **红**（${p4wrongBase.length} 条）—— 这就是本轮修的那个 bug 的活体标本`)
  }

  // ── N-F6：`todo` 任务上游全绿却缺 `budget`/`scope_paths` ⇒ 必红；补齐 ⇒ 绿 ──
  {
    const mk = (extra) => [
      { id: 'R-953', kind: 'req', status: 'agreed', parent: 'spec/progress', after: [] },
      { id: 'TSK-955', kind: 'task', status: 'todo', parent: 'R-953', after: [], ...extra },
    ]
    const probs = checkReadiness(mk({}))
    const hit = probs.find((x) => x.startsWith('TSK-955'))
    const okCase = checkReadiness(mk({ budget: 'tool_calls=8 · rounds=2', scope_paths: ['src/x.ts'] }))
    const upstreamRed = checkReadiness([
      { id: 'R-954', kind: 'req', status: 'draft', parent: 'spec/progress', after: [] },
      { id: 'TSK-956', kind: 'task', status: 'todo', parent: 'R-954', after: [] },
    ])
    const notDemanded = upstreamRed.every((x) => !x.includes('budget') && !x.includes('scope_paths'))
    const reallyBroken = mk({})[1].budget === undefined
    if (!reallyBroken) bad('N-F6 · 夹具没造出"上游全绿且缺 budget/scope_paths" ⇒ 本条不可判')
    else if (hit === undefined || !hit.includes('budget') || !hit.includes('scope_paths')) bad('N-F6 · 上游全绿却缺这两项还没红 ⇒ F-6 哑了')
    else if (okCase.length !== 0) bad(`N-F6 · 补齐两项后仍红 ⇒ 恒红（${JSON.stringify(okCase)}）`)
    else if (!notDemanded) bad('N-F6 · 上游没到位的任务也被要求预算 ⇒ ⛔ 逼人给还开不了的活提前编预算')
    else ok(`N-F6 ✓ 负向对拍（先自证：\`TSK-955\` 是 \`todo\` 且上游全绿，却没有 \`budget\` / \`scope_paths\`）`
      + `⇒ F-6 的"准备度不足就别派"**必红**：${hit.slice(0, 90)}；**反面**：补齐两项 ⇒ **转绿**；`
      + '**边界**：上游没到位（需求 `draft`）时 **⛔ 不要求**这两项')
  }

  // ── N-F6E1：准备度豁免名单超上限 / 缺原因 ⇒ 必红 ──
  {
    const over = [...STORED_READY_NO_PLAN, { id: 'TSK-999', why: '夹具', plan: '夹具' }]
    const pOver = checkReadyE1(over)
    const pNoWhy = checkReadyE1([{ id: 'TSK-999', why: '', plan: '夹具' }])
    if (pOver.some((x) => x.includes('只减不增')) && pNoWhy.some((x) => x.includes('没写原因'))) {
      ok(`N-F6E1 ✓ 负向对拍（先自证：名单 ${STORED_READY_NO_PLAN.length} → ${over.length} 条超上限 ${STORED_READY_NO_PLAN_MAX}；另一夹具 \`why\` 为空）`
        + '⇒ F-6-E1 的"只减不增"与"必须写原因"**两条都必红**')
    } else bad(`N-F6E1 · 超上限或缺原因却绿灯 ⇒ 棘轮失效（${JSON.stringify([pOver, pNoWhy])}）`)
  }

  // ── N-READY：`todo` 任务的上游没到位 ⇒ 必红，且要说出"卡在 X" ──
  {
    const fake = [
      { id: 'R-902', kind: 'req', status: 'draft', parent: 'spec/progress', after: [] },
      { id: 'TSK-904', kind: 'task', status: 'todo', parent: 'R-902', after: ['TSK-905'] },
      { id: 'TSK-905', kind: 'task', status: 'doing', parent: 'R-902', after: [] },
    ]
    const probs = checkReadiness(fake)
    const hit = probs.find((x) => x.startsWith('TSK-904'))
    /**
     * ⚠ **2026-11-01 P40/R5**：正向对照现在必须同时带上 `budget` 与 `scope_paths` ——
     *   因为 F-6 让"上游全绿"的 `todo` 任务**还要**有这两项（见 `checkReadiness` ④）。
     *   ⛔ 这不是为了让夹具变绿而放宽判据，而是**判据变严后夹具必须跟着变真**
     *     （否则这条"反面必须绿"的对照会变成恒红，那正是它要防的东西）。
     */
    const okCase = checkReadiness([
      { id: 'R-902', kind: 'req', status: 'agreed', parent: 'spec/progress', after: [] },
      { id: 'TSK-904', kind: 'task', status: 'todo', parent: 'R-902', after: ['TSK-905'], budget: 'tool_calls=12 · rounds=3', scope_paths: ['src/shared/convergence.ts'] },
      { id: 'TSK-905', kind: 'task', status: 'built', parent: 'R-902', after: [] },
    ])
    const saysWhere = hit !== undefined && hit.includes('卡在')
    if (!saysWhere) bad('N-READY · 上游没到位却绿灯，或没说"卡在 X" ⇒ §七 的措辞要求没兑现')
    else if (okCase.length !== 0) bad(`N-READY · 上游到位后仍红 ⇒ 恒红（${JSON.stringify(okCase)}）`)
    else ok(`N-READY ✓ 负向对拍（先自证：\`R-902.status = "draft"\`、前置 \`TSK-905\` 仍 \`doing\`）⇒ 准备度**必红**且**说出卡在哪**：${hit.slice(0, 100)}`
      + '；**反面**：需求 `agreed` + 前置 `built` ⇒ **转绿**')
  }

  // ── N-I-E1b：名单里有一条**不写原因** ⇒ 必红（⛔ 不许"整类豁免"） ──
  {
    const noWhy = [{ id: 'R-999', why: '', plan: '夹具' }]
    const probs = checkIE1(noWhy)
    const hit = probs.find((x) => x.includes('没写原因'))
    if (hit !== undefined) ok(`N-I-E1b ✓ 负向对拍（先自证：造一条 \`why\` 为空的豁免）⇒ I-E1 的"必须写原因"**必红**：${hit.slice(0, 80)}`)
    else bad('N-I-E1b · 豁免不写原因却绿灯 ⇒ §五3 的"必须打印原因"没兑现')
  }

  /**
   * ── N-CF：条件式必填**只在该状态生效**（`todo` 不要求 verify_refs；`built` 缺就红）──
   *
   * ⚠⚠ **2026-11-01 P40/R17 换夹具来源**（`TASK-R17.md` §一）：从"拿真账本 `find`"改成"自造合成单元"。
   *
   * ── 为什么换（这是本条原来的**真缺陷**）──────────────────────────────
   *   旧版：`units.find(todo)` + `units.find(built)`，任一为空 ⇒ `bad('… 本条不可判')`。
   *   ⚠ 而 `TSK-048` 是账本里**最后一条 `todo`**，R16 把它改 `built` 之后 todo 计数 = **0**
   *     ⇒ 夹具失去对象 ⇒ 这条负向对拍**红**（`N-CF · 索引里没有同时存在 todo 与 built 任务`）。
   *   ⚠⚠ 但它验的是「条件式必填只在 `built` 开火、`todo` 豁免」——**那是纯函数性质**，
   *     跟"真账本此刻有没有 todo"毫无关系。拿真账本当夹具 = 让判据的存活依赖账本的数据分布。
   *
   * ── 为什么合成夹具不削弱它（⚠ 别把"换夹具"读成"放宽"）────────────────
   *   判定逻辑**一字未动**：仍然调**真判据 `checkI1`**（⛔ 夹具里没有第二份逻辑）。
   *   两条断言方向都保留：删 `built` 的 `verify_refs` ⇒ 必红；`todo` ⇒ 仍豁免。
   *   ⚠ 与 `N-I7b`（`:3163` 附近）**并存、不替代**：那条治**真账本**里的 todo 没被逼交读数
   *     （它对 `todoOne === undefined` 是容忍的），本条治**判据的性质**。
   *   照 `N-G1`（`:3372`）的形态：自造 `fake`，喂真判据，先自证再断言。
   *
   * ⚠ 旧的 `bad('… 本条不可判')` 分支已删：夹具不再依赖真账本，那个分支永远不会走。
   */
  {
    /**
     * ⚠ 合成一对：一条 `built`、一条 `todo`。
     *   两者都补齐其它必填（`built_by` / `verify` / `parent` / `after`），
     *   否则 `checkI1` 会报**别的**字段，把 `verify_refs` 那条淹没掉 ⇒ 夹具不干净。
     */
    const fake = [
      { id: 'TSK-971', kind: 'task', status: 'built', parent: 'R-001', after: [],
        built_by: 'session-CF', verify: 'check:cf 1/1', verify_refs: ['EVD-971'] },
      { id: 'TSK-972', kind: 'task', status: 'todo', parent: 'R-001', after: [] },
    ]
    /** ⚠ 先自证：夹具真的造出了那**两个**状态（⛔ 不是两个都 built、也不是两个都 todo）。 */
    const selfProven = fake.some((u) => u.status === 'built') && fake.some((u) => u.status === 'todo')
    if (!selfProven) {
      bad('N-CF · 合成夹具没造出"一 built 一 todo" ⇒ 本条不可判')
    } else {
      /** 删掉 `built` 那条的 `verify_refs` ⇒ 必红 */
      const mut = fake.map((u) => (u.id === 'TSK-971' ? { ...u, verify_refs: undefined } : u))
      const probs = checkI1(mut, () => true)
      const hitBuilt = probs.find((x) => x.startsWith('TSK-971') && x.includes('verify_refs'))
      const hitTodo = probs.find((x) => x.startsWith('TSK-972') && x.includes('verify_refs'))
      /** ⚠ 另一面：`todo` 那条**原本就没有** `verify_refs`，它必须**不**被要求。 */
      if (hitBuilt !== undefined && hitTodo === undefined) {
        ok('N-CF ✓ 负向对拍（先自证：合成夹具里 `TSK-971` 是 `built`、`TSK-972` 是 `todo`，'
          + '两条其它必填都齐；再删掉 `TSK-971` 的 `verify_refs`）'
          + ' ⇒ 条件式必填**只在 built 开火**：`TSK-971` 红 · `TSK-972`（todo）**仍豁免**'
          + '（⛔ 不逼未开工的活交读数）'
          + ' ⚠ 夹具是**合成的**（`TASK-R17.md` §一）：本条验的是判据性质，'
          + '⛔ 不再依赖真账本里恰好存在 todo —— 那个依赖曾在 R16 让本条红过')
      } else if (hitBuilt === undefined) {
        bad('N-CF · built 缺 verify_refs 却没红 ⇒ 条件式必填没生效')
      } else {
        bad(`N-CF · todo 任务也被要求了 verify_refs ⇒ 违反 §五1（⛔ 不许对未开工的活要求结果）：${hitTodo?.slice(0, 70)}`)
      }
    }
  }


  /**
   * ══ 目标层覆盖的四条负向对拍（2026-11-02 · P50/B1 · `TASK-B1.md` §一第 2/3 件）══
   *
   * ⚠⚠ **全部用合成夹具**（照 `N-G1` / `N-CF` 的形态）：自造单元 → 喂**真判据**
   *   `checkGoalCoverage`（⛔ 夹具里没有第二份逻辑）→ 先自证夹具真的坏掉 → 再断言必红。
   *
   * ── ⚠ 为什么⛔ 不许拿真账本当夹具（任务书明令）──────────────────────
   *   现在 `index.toml` 里 **goal = 0 条** ⇒ 拿真数据跑这三条，三条全是 **0 对象**：
   *     `GC-1` 没有 goal 可归属 ⇒ 每条活跃需求都"没人覆盖"（会假红）；
   *     `GC-2` / `GC-3` 没有 goal ⇒ 空数组 ⇒ **假绿**。
   *   两头的读数都不可信 ⇒ 夹具必须合成。
   *
   * ── 每条对拍的判据（⛔ 不是 `exit ≠ 0`）────────────────────────────
   *   输出里要有**可读断言行**，能看出**哪一条**（GC-1/2/3）**哪个 id**（R-9xx / G-9xx）被咬住。
   *   反面还要验"还原 ⇒ 转绿"（⛔ 不许恒红）。
   */
  {
    /**
     * 基线夹具：两条活跃需求 + 两条 goal，**覆盖恰好一对一**（这是"合法"形态）。
     * ⚠ 其它字段（`after` / `source`）这里用不到 —— 本组只读 `kind` / `status` / `req_ids` / `id`。
     */
    const base = [
      { id: 'R-901', kind: 'req', status: 'agreed', title: '需求甲' },
      { id: 'R-902', kind: 'req', status: 'agreed', title: '需求乙' },
      { id: 'G-901', kind: 'goal', status: 'active', title: '目标甲', req_ids: ['R-901'] },
      { id: 'G-902', kind: 'goal', status: 'active', title: '目标乙', req_ids: ['R-902'] },
    ]
    /** ⚠ **先自证夹具是"合法"的**：三条全空。否则后面的"造坏必红"可能只是继承了一个本来就红的基线。 */
    const clean = checkGoalCoverage(base)
    const baselineClean = clean.goals === 2 && clean.activeReqs === 2
      && clean.gc1.length === 0 && clean.gc2.length === 0 && clean.gc3.length === 0

    if (!baselineClean) {
      bad('N-GC · 合成夹具基线**本身就不合法**（期望 2 goal / 2 活跃需求 / 三条全空，'
        + `实测 goal=${clean.goals} req=${clean.activeReqs} gc1=${clean.gc1.length} gc2=${clean.gc2.length} gc3=${clean.gc3.length}）`
        + ' ⇒ 下面三条对拍不可判')
    } else {
      // ── N-GC1：造一条活跃需求**没有任何 goal 覆盖** ⇒ GC-1 必红 ──────────
      {
        const mut = [...base, { id: 'R-903', kind: 'req', status: 'agreed', title: '需求丙（无人承接）' }]
        const r = checkGoalCoverage(mut)
        const hit = r.gc1.find((x) => x.includes('R-903'))
        const stillOk2 = r.gc2.length === 0 && r.gc3.length === 0
        if (hit === undefined) {
          bad('N-GC1 · 造了一条无人承接的活跃需求 `R-903` 却绿灯 ⇒ GC-1（至少）哑了')
        } else if (!stillOk2) {
          bad(`N-GC1 · 只改一处却连带把别的咬了（gc2=${r.gc2.length} gc3=${r.gc3.length}）⇒ 夹具不干净`)
        } else {
          ok(`N-GC1 ✓ 负向对拍（先自证：基线 2 goal / 2 活跃需求、三条全空；再补一条无人承接的 \`R-903\`）`
            + ` ⇒ GC-1（**至少**）**必红**且点名 id：${hit.slice(0, 90)}`
            + '；**反面**：删掉 `R-903` 即回到基线全绿（⛔ 不是恒红）')
        }
      }

      // ── N-GC2：造一条活跃需求**同时挂在两个 goal 下** ⇒ GC-2 必红 ─────────
      {
        const mut = base.map((u) => (u.id === 'G-902' ? { ...u, req_ids: ['R-902', 'R-901'] } : u))
        const r = checkGoalCoverage(mut)
        const hit = r.gc2.find((x) => x.includes('R-901'))
        if (hit === undefined) {
          bad('N-GC2 · 把 `R-901` 同时挂到 `G-902` 下却绿灯 ⇒ GC-2（至多）哑了 —— 两个"主"目标会被放过')
        } else if (!hit.includes('G-901') || !hit.includes('G-902')) {
          bad(`N-GC2 · 咬住了但**没点名两个 goal** ⇒ 读者看不出该去掉哪一个：${hit.slice(0, 90)}`)
        } else {
          ok('N-GC2 ✓ 负向对拍（先自证：基线里 `R-901` 只归 `G-901`；再把 `R-901` 也挂进 `G-902.req_ids`）'
            + ` ⇒ GC-2（**至多**）**必红**且点名两个 goal：${hit.slice(0, 110)}`
            + '；**反面**：还原 `G-902.req_ids` 即回到基线全绿（⛔ 不是恒红）')
        }
      }

      // ── N-GC3：造一个 `req_ids` 为空的 goal ⇒ GC-3 必红 ────────────────
      {
        const mut = [...base, { id: 'G-903', kind: 'goal', status: 'active', title: '空目标（装饰）', req_ids: [] }]
        const r = checkGoalCoverage(mut)
        const hit = r.gc3.find((x) => x.includes('G-903'))
        if (hit === undefined) {
          bad('N-GC3 · 造了一个 `req_ids` 为空的 goal 却绿灯 ⇒ GC-3（非空）哑了 —— 装饰目标会被放过')
        } else if (!hit.includes('为空')) {
          bad(`N-GC3 · 咬住了但没说清理由（期望含「为空」）：${hit.slice(0, 90)}`)
        } else {
          ok(`N-GC3 ✓ 负向对拍（先自证：基线 2 条 goal 都有活跃需求；再补一条 \`req_ids: []\` 的 \`G-903\`）`
            + ` ⇒ GC-3（**非空**）**必红**且点名 id：${hit.slice(0, 90)}`
            + '；**反面**：删掉 `G-903` 即回到基线全绿（⛔ 不是恒红）')
        }
      }
    }

    /**
     * ── N-GC0：`goal = 0` ⇒ 必须走 `⊘` 那一行，且**不计入通过**（§一第 3 件）──────
     *
     * ⚠ 这条验的是**档位归属**，⛔ 不是"有没有输出"：
     *   · 必须有那一行（逐字 `GOAL_NOT_LANDED`）；
     *   · 那行里**不许出现"通过"字样**（出现了就是把"没判"说成"判过了"）；
     *   · 且它**不进** `pass` 计数 —— 这里直接比 `skip` 与 `pass` 的增量。
     */
    {
      const zeroGoals = [
        { id: 'R-901', kind: 'req', status: 'agreed', title: '需求甲' },
        { id: 'R-902', kind: 'req', status: 'agreed', title: '需求乙' },
      ]
      const r = checkGoalCoverage(zeroGoals)
      /** ⚠ 先自证：夹具真的 0 个 goal（⛔ 不是"忘了放 goal"却当成 0）。 */
      const reallyZero = r.goals === 0 && zeroGoals.filter((u) => u.kind === 'goal').length === 0
      /**
       * ⚠⚠ **影子 sink**：调的是主流程同一段 `reportGoalLayer`，
       *   但计数落在局部变量里 ⇒ ⛔ 不污染真实 `pass` / `skip`。
       *   （改前直接调模块级 `noteSkip` 时实测把处级口径印成「跳过 2 处」而真实只有 1 处。）
       */
      const shadow = { pass: 0, fail: 0, skip: [] }
      const sink = {
        ok: (m) => { shadow.pass++; shadow.msgs = [...(shadow.msgs ?? []), `✓ ${m}`] },
        bad: (m) => { shadow.fail++; shadow.msgs = [...(shadow.msgs ?? []), `✗ ${m}`] },
        noteSkip: (m) => { shadow.skip.push(m) },
      }
      const bucket = reportGoalLayer(r, sink)
      /** 反面：给同两条需求各配一个 goal ⇒ 必须离开 `skip` 档、进 `checked` 且三条全绿。 */
      const withGoals = [...zeroGoals,
        { id: 'G-901', kind: 'goal', status: 'active', title: '目标甲', req_ids: ['R-901'] },
        { id: 'G-902', kind: 'goal', status: 'active', title: '目标乙', req_ids: ['R-902'] },
      ]
      const r2 = checkGoalCoverage(withGoals)
      const shadow2 = { pass: 0, fail: 0, skip: [] }
      const bucket2 = reportGoalLayer(r2, {
        ok: () => { shadow2.pass++ },
        bad: () => { shadow2.fail++ },
        noteSkip: (m) => { shadow2.skip.push(m) },
      })
      /**
       * ⚠⚠ **这一行的"不许出现通过"必须按语义判，⛔ 不能按子串判**（实测踩到，记进报告）：
       *   任务书 §一第 3 件**同时**要求两件事——
       *     ① 那一行形如「… ⇒ 三条覆盖检查无法执行，⛔ **这不是通过**」（自带"通过"两字）；
       *     ② 「不能出现"通过"字样」。
       *   两条按**子串**读直接互斥（① 的那行必然含"通过"）。
       *   ⇒ 按语义读：**不许出现"通过"这个断言**，即——把那句**否定式** `这不是通过` 摘掉之后，
       *     ⛔ 不许再有任何"通过"字样。这样既守住"别把没判说成判过了"，又不与 ① 打架。
       */
      const lineHasPass = GOAL_NOT_LANDED.replace('这不是通过', '').includes('通过')
      if (!reallyZero) {
        bad('N-GC0 · 夹具没造出"goal = 0"的形态 ⇒ 本条不可判')
      } else if (bucket !== 'skip') {
        bad(`N-GC0 · goal = 0 时**没走 skip 档**（实测 ${bucket}）⇒ 档位判定哑了`)
      } else if (shadow.pass !== 0) {
        bad(`N-GC0 · goal = 0 时**计入了通过**（pass +${shadow.pass}）⇒ "没判"被洗成"判过了"`)
      } else if (shadow.skip.length !== 1) {
        bad(`N-GC0 · goal = 0 时**没有计入跳过**（skip ${shadow.skip.length} 条，期望 1）⇒ 那个档位没有落点`)
      } else if (shadow.skip[0] !== GOAL_NOT_LANDED) {
        bad(`N-GC0 · 跳过那一行**不是约定的原文**：${JSON.stringify(shadow.skip[0])}`)
      } else if (lineHasPass) {
        bad('N-GC0 · 那一行里出现了"通过"字样 ⇒ 读者会把它当成通过')
      } else if (bucket2 !== 'checked' || shadow2.pass !== 3 || shadow2.fail !== 0 || shadow2.skip.length !== 0) {
        bad(`N-GC0 · 反面不成立：补上两个 goal 后应当 checked + 三条全绿，实测 `
          + `bucket=${bucket2} pass=${shadow2.pass} fail=${shadow2.fail} skip=${shadow2.skip.length}`)
      } else {
        ok('N-GC0 ✓ 负向对拍（先自证：夹具 goal = 0 条、2 条活跃需求；影子 sink 不污染真实计数）'
          + ' ⇒ 走 `⊘` 单列档：**pass +0**（⛔ 不计入通过）· **skip +1**（有自己的落点）'
          + '，且那行里**没有"通过"字样**'
          + ` —— 原文：${GOAL_NOT_LANDED}`
          + '；**反面**：补两个 goal ⇒ 进 `checked` 档且 GC-1/2/3 三条全绿（⛔ 不是恒跳过）')
      }
    }
  }

} catch (e) {
  bad(`L 组**自身异常**（⛔ 不算通过）：${String(e?.stack ?? e)}`)
} finally {
  rmSync(WORK, { recursive: true, force: true })
}

if (IS_MAIN) {
console.log('')
console.log(`L 组：通过 ${pass} · 失败 ${fail}`)
/**
 * ⚠ 处级口径的"跳过"档**必须如实印数**（2026-11-02 · P50/B1）：
 *   改前这一行把 `跳过` **写死成 0 处**。⚠ 那不是"本族从不跳过"，而是"印了个常量"——
 *   一旦真有跳过（`goal = 0` 就会有一次），**读数会说谎**（与 `check-all` 第 743 行
 *   点名的那个病同形：族内明明跳了，汇总行印"跳过 0 处"）。
 *   ⇒ 现在按实际 `skip.length` 印。
 */
console.log(`处级口径：查了 ${pass + fail + skip.length} 处 · 过了 ${pass} 处${fail > 0 ? ` · 没过 ${fail} 处` : ''} · **跳过 ${skip.length} 处**（⚠ 跳过**不计入通过**；⚠ "查了"含跳过，故 查了 = 过了 + 没过 + 跳过）`)
console.log('')
if (fail > 0) {
  console.log('  ⛔ L 组有失败 —— 见上面逐条')
  process.exit(1)
}
console.log('  ✅ L 组全绿（I1 / I2 / I5 + I4 顺带；三条负向对拍均实测变红）')
process.exit(0)
}
