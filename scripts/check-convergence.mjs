#!/usr/bin/env node
/**
 * **`check:convergence`** —— 一个**变更**收没收口（2026-10-31 · P41/R3 · `TASK-R3.md` §二）。
 *
 * ══ 它判什么（⚠ 先把边界钉死）═══════════════════════════════════════════════
 *   判的是 **"一个 change 收没收口"**，⛔ **不是**"某个 task 做没做完"。
 *   任务做完了 ≠ 变更收口了：变更收口还要求**需求被证明满足**（K-3）、
 *   **风险不开着**（K-4）、**依据的决策还有效**（K-5）、**不是自己验自己**（K-6）。
 *   ⚠ 这正是 `CONSTITUTION` 第 8/9/10 条要的"机制"——R2 时那三条只核"在册"，现在有判据了。
 *
 * ══ 六条判据（K-1..K-6）════════════════════════════════════════════════════
 *   K-1 该 change 下所有 task 都到终态（`built`）
 *   K-2 每个 `built` 的 task 的 `verify_refs` 都指向真实 `evidence`
 *       ⚠ **与 I7 同源**：直接调 `checkI7`，⛔ 不另写一套口径（两套口径 = 两处真相）
 *   K-3 该 change 的 `addresses` 里每条需求都有 `acc` 且 `outcome = pass`
 *   K-4 相关 `risk` 里**没有** `status = open`（`handling` 允许，但**必须列出**）
 *   K-5 相关 `decision` 里没有"已被取代却没指向继任者"的
 *       ⚠ **与 I8 同源**：直接调 `checkI8`
 *   K-6 该 change 的 `built_by` 与它下所有 `acc.actor` **不同一个人**
 *
 * ══ 输出（⛔ 不许只给布尔）═════════════════════════════════════════════════
 *   `converged` 或 `not-converged: N 阻断项` + **逐条列出**阻断项编号与原因。
 *   ⚠ 只给 true/false 等于"判不出"（`TASK-R3.md` §二 明写）。
 *
 * ══ 判不出 ⇒ 红 ═══════════════════════════════════════════════════════════
 *   任何一条找不到对象（没有 task / 没有 acc / 引用悬空）⇒ ⛔ 不许跳过，必须报阻断项。
 *
 * 用法：node scripts/check-convergence.mjs
 * 退出码：0 = 每个 change 都收口；1 = 有 change 未收口（或判不出）
 */

import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { KIND_SPEC, readUnits, LEDGER_DIR } from './gen-ledger.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const LEDGER = LEDGER_DIR

let pass = 0
let fail = 0
/**
 * ⚠ **第三档：跳过**（2026-11-02 · P50/D1 · `TASK-D1.md` §一第 3 件）。
 *   与 `check:ledger-next` 的同名档同口径：**跳过 ≠ 通过**，⛔ 不进 `pass`。
 *   ⚠ 为什么必须单列：0 条取代关系时三条双向核**一条也判不了**，
 *     塞进 `ok` ⇒ "没落数据"被洗成"全对"；塞进 `bad` ⇒ 上线即红。
 */
const skip = []
const noteSkip = (m) => { skip.push(m); console.log(`  ${m}`) }
const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail++; console.log(`  ✗ ${m}`) }

/**
 * 一条阻断项。⚠ 形状是**结构化**的（`TASK-R3.md` §三 对 `blocked_by` 的要求）：
 *   `{ rule, unit, why }` —— ⛔ 不许写成自由文本，否则没法逐轮比对"阻断项是变多还是变少"。
 *
 * @typedef {{ rule: string, unit: string, why: string }} Blocker
 */

/** 取数组字段（缺 ⇒ 空数组）。 */
/**
 * ══ ⚠⚠ **K-1..K-6 的实现不在这里**（2026-10-31 P42b/R4b · `TASK-R4b.md` §一.2）═══════
 *   唯一实现在 **`src/shared/convergence.ts`**（纯函数、零 I/O、client 半边也能跑）。
 *   本脚本只做：**读账本 · 遍历 change · 调 `convergenceOf` · 打印 · 豁免名单 · 趋势**。
 *
 *   ⛔ **不许在这里留第二份实现** —— 两处真相会漂（本仓踩过 `KIND_SPEC` ↔
 *     `STAGE_KIND_STATUSES` 那次）。这条由 `check:stages-route` 的 **R-14** 咬住
 *     （含负向对拍：把实现复制回本文件 ⇒ 必红）。
 *
 *   ⚠ 为什么能直接 import `.ts`：本仓 `check:stages-route` / `check:stages-dom`
 *     早已用 `import(pathToFileURL(...'.ts'))` 载真源码（Node 22 内置类型剥离）。
 *     ⇒ 同一套办法，⛔ 不引入新的构建步骤。
 */
const CONV_TS = join(here, '..', 'src', 'shared', 'convergence.ts')
const convMod = await import(pathToFileURL(CONV_TS).href)

/** ⚠ re-export：本文件对外仍导出这些名字（判据与负向对拍都还在用）。 */
export const relatedOf = convMod.relatedOf
export const k1 = convMod.k1
export const k2 = convMod.k2
export const k3 = convMod.k3
export const k4 = convMod.k4
export const k5 = convMod.k5
export const k6 = convMod.k6
export const renderVerdict = convMod.renderVerdict

/**
 * **一个 change 的完整收敛判定** —— 转调 `src/shared/convergence.ts` 的唯一实现。
 *
 * ⚠ 参数顺序：本脚本历史上是 `(units, chg, deps)`；共享模块是 `(chg, units, deps)`
 *   （`TASK-R4b.md` §一.1 钉死那个顺序）。⇒ 这里做**一次**适配，⛔ 不改判据口径。
 *
 * @param units - 全部单元
 * @param chg - 要判的 change
 * @param deps - 可选注入 `i7`/`i8`（⚠ 只为对拍）
 * @returns 收敛判定
 */
export function convergenceOf(units, chg, deps = {}) {
  return convMod.convergenceOf(chg, units, deps)
}

/**
 * ⭐ **K 组的存量豁免名单**（2026-10-31 P41/R3）
 *
 * ── 为什么需要它（⚠ 这是"判据判对了，但账本确实是那样"）──────────────
 *   实测两条 change **都没收口**，阻断项全是**真实**的：
 *     · `CHG-2026-10-30-rearch` → K-3 卡在 `R-001`（该需求账本里从无 `acc`，
 *       已在 `STORED_NO_NEW_FIELD` 里点名，理由相同：没人真验过，⛔ 不许编 `acc`）；
 *     · `CHG-2026-10-31-tool-policy` → K-1 卡在 `TSK-048`（`todo`，**真的没做完**，
 *       它是 `CHG-281` §六·1 登记的欠账）+ K-3 卡在 `R-006`/`R-007`（同样无 `acc`）。
 *
 *   ⇒ 两条路都坏：⛔ 让判据报红 ⇒ `check:all` **永久红**（"恒红的判据等于没有判据"）；
 *     ⛔ 把判据改成沉默 ⇒ 那条需求/那个欠账**从此没人看得见**。
 *   ⇒ 本仓既定形态：**点名豁免 + 逐轮打印 + 只减不增**。
 *
 * ⚠⚠ **这不是"通过"**：`K-ALL` 仍会打印 `not-converged: N 阻断项` 与每一条原因，
 *   只是**不计入退出码**。⚠ 读者一眼能看到"这两条没收到口、卡在哪"。
 * ⚠⚠ **只许变短**（`checkKE1` 咬住）：每一条都是**真实欠账**，清掉它的唯一方式是
 *   **真把它做完/真有人验过**，⛔ 不是改这份名单。
 *
 * ⚠⚠ **`_MAX` 的抬升口径**（2026-11-01 P40/R10 · `TASK-R10.md` §三 裁定）──────────
 *   **本数只许因"清旧债新开的承接变更"临时抬，⛔ 不许因新发现的缺陷抬。**
 *   ── 为什么这条要写在这里（⛔ 不是多余）──────────────────────────
 *     棘轮的语义是"只减不增"；抬一次就是破了它一次。若不区分**为什么**抬，
 *     那么"发现新缺陷 ⇒ 加进名单 ⇒ 抬 `_MAX`"会变成一条**合法路径**
 *     ⇒ 名单迟早变成"所有未收口的 change 都在里面"，`K-ALL` 从此恒绿。
 *   ⇒ 允许的抬升只有一种：**为了清掉已有欠账而主动开的承接变更**
 *     （活是别人做完的，它只负责验收 —— 所以它必然"未收口"，但那不是新债）。
 *   ⚠ 且这类抬升**自带清账条件**（见该条的 `plan`）：旧债清完，本数必须降回去。
 */
export const STORED_NOT_CONVERGED = [
  {
    id: 'CHG-2026-10-30-rearch',
    why: 'K-3 卡在 R-001：该需求账本里从无 `acc`（同 `STORED_NO_NEW_FIELD` 的 R-001 条，理由相同 —— 没人真验过，⛔ 不许编 acc）。其余 K-1/K-2/K-4/K-5/K-6 全绿。',
    /**
     * ⚠⚠ `plan` 的可判定口径（`TASK-R3b.md` §二 B-1）：
     *   **什么时候清** = 出现一条 `acc`，其 `parent` 链指回 R-001 且 `outcome = "pass"` 且
     *   `actor` 是**真人**（⛔ 不是实施者自己 —— 那就是 K-6 要拦的自验）。
     *   **靠什么清** = 那条 acc 一入库，K-3 当轮就绿 ⇒ 本条自动从名单消失。
     * ⛔ 不写成「R4 补 acc」：没人真验过的需求，⛔ 不许为它编 acc（R2 验收已裁）。
     */
    plan: '**等真人验过再补**：当出现一条 `acc`（parent 链指回 R-001 · `outcome=pass` · `actor` 为真人而非实施者）时，K-3 当轮转绿，本条即从名单移除。⛔ 不许为它编 acc。',
  },
  {
    id: 'CHG-2026-11-01-accept-backlog',
    /**
     * ⚠⚠ **这条与上面两条不同**：它不是"历史欠账"，它是**本轮刚立的 change 的正常初态**。
     *   `TASK-R9.md` §三 明确只做第 1/2 步（提议 + 定案），⛔ 不做第 5 步（验收）——
     *   因为验收要的是**真机读数**，本轮拿不到（§四）。
     *   ⇒ 它**必然**未收口，且 5 条阻断项**全是真实的**：
     *     · K-1：零 task（活早在 `TSK-031/032/033` 做完，⛔ 不许补假 task）
     *     · K-3 ×3：`ACC-001/002/003` 全 `unverified`（真机没验）
     *     · K-4：`RSK-001` `status=open`（⛔ 不许为了好看改成 closed）
     *   ⚠ 这与"判据误报"是两件事 —— 判据**判对了**，账本确实是那样。
     */
    /**
     * ── ⚠⚠ **本条是唯一一处"抬棘轮"，按 `TASK-R10.md` §三 的写法记账** ──────────
     *   ⛔ **这不是新缺陷**，是**为清旧债而故意开的承接变更**（`builtNoAcc` 那三条）。
     *   它的「未收口」是**过程态**：`ACC-001/002/003` 变 `pass` 的那一轮，本数**必须降回 2**。
     *
     *   ⚠ 与另外两条（`rearch` / `tool-policy`）的区别：
     *     那两条是**历史欠账**（做完就清）；本条是**主动开的账**（清完旧债就清）。
     *     ⛔ 但两者在名单里**一视同仁**地逐轮打印 —— 豁免不等于不看见。
     *
     *   ⚠ R10 后阻断项从 5 条变 **4** 条（K-1 因 R10 裁定让位给 K-3，见 `k1` 上方注释）。
     */
    why: '⚠ **这不是新缺陷，是为清旧债（builtNoAcc 那三条：R-002/003/004）而故意开的承接变更**。它的「未收口」是**过程态**：ACC-001/002/003 变 pass 的那一轮，本数**必须降回 2**。现有 4 条阻断全真实：K-3 ×3（ACC-001/002/003 全 unverified，真机读数未到）+ K-4（RSK-001 status=open，⛔ 不许为好看改它）。⚠ R10 前是 5 条，少的 K-1 是 R10 裁定让位给 K-3（零 task 但 addresses 非空 ⇒ 判得出，见 k1 注释）。',
    plan: '**清账条件（可判定）**：ACC-001/002/003 各自 `status = "pass"` 且 `basis` 指真实 `EVD-`、`actor` 是真人而非实施者（否则 K-6 拦自验）⇒ K-3 ×3 转绿；同时 `RSK-001.disposition` 若随之处置完（`closed`）⇒ K-4 转绿。**两条都满足的那一轮，本条必须从名单移除、`_MAX` 降回 2**（⚠ 这是本数的清账口径：写明了等谁做什么、靠什么触发）。⛔ 不许为清本条而编 acc / 编 EVD- / 补假 task / 改 RSK-001.disposition。',
  },
  {
    id: 'CHG-2026-10-31-tool-policy',
    why: 'K-1 卡在 TSK-048（`todo`，CHG-281 §六·1 登记的真欠账）+ K-3 卡在 R-006/R-007（两条需求均无 `acc`）。⚠ 这条 change 本来就**还没收口**，不是判据误报。',
    /**
     * ⚠ 两个条件**都**满足才清（缺一不收）：
     *   ① `TSK-048.status = "built"` 且它的 `verify_refs` 指向真实 `evidence`（K-1 + K-2）；
     *   ② `R-006` / `R-007` 各自出现**真人**验收的 `acc`（`outcome=pass`）。
     * ⚠ 若这两条需求**本身要重新裁**（不做了），那就走 G-4：`status=dropped` + `drop_why`，
     *   并把它们从本条 change 的 `addresses` 里移出 —— 那也是"清掉本条"的合法路径。
     */
    plan: '**两条同时满足才清**：① `TSK-048` 真做到 `built` 且 `verify_refs` 指真实 evidence；② `R-006`/`R-007` 各有真人验收的 `acc`（`outcome=pass`）。⚠ 另一条合法路径：若这两条需求本身要重新裁，走 G-4 置 `dropped` + `drop_why` 并从 `addresses` 移出。⛔ 不许为它们编 acc。',
  },
]

/**
 * ⭐ **上一轮的阻断项总数**（`TASK-R3b.md` §二 B-2 要求的"趋势"基线）。
 *
 * ── ⚠ 这个数**存在哪**、怎么来的（作业书要求说清，⛔ 不许含糊）─────────────
 *   **存在这里**（一个显式常量），**来源** = 2026-10-31 R3 那一轮 `check:convergence` 的
 *   实测输出原文（两条 change 的阻断项条数相加：`1` + `3` = **4**）。
 *   ⛔ 不从 `gen/**` 读：`gen/` 里没有阻断项历史（它是"当下状态"的渲染物，不存趋势）。
 *   ⛔ 不取"上次跑的时候"：两次跑之间被改两次就看不出来了（同 `STORED_NO_NEW_FIELD_MAX` 的理由）。
 *
 * ⚠⚠ **每轮必须同批更新**：本轮实测数写进来，下一轮才有得比。
 *   ⛔ 若某轮**判不出**上一轮的数 ⇒ 写 `null`，并在输出里打「判不出」（⛔ 不许拿本轮数充当对比）。
 */
export const LAST_ROUND_BLOCKERS = 8

/**
 * **K-TREND** · 打印本轮 vs 上一轮的阻断项趋势（`TASK-R3b.md` §二 B-2）。
 *
 * ⚠ 口径：
 *   · `delta > 0` ⇒ 「多了 N 条」；`delta < 0` ⇒ 「少了 N 条」；`delta === 0` ⇒ 「未变」；
 *   · 上一轮的数**判不出**（`null`）⇒ 打「判不出」，⛔ **不拿本轮数充当对比**。
 *
 * @param {number} now - 本轮阻断项总数
 * @param {number|null} last - 上一轮总数（`null` = 判不出）
 * @returns {string} 一行趋势文本
 */
export function renderTrend(now, last) {
  if (last === null || last === undefined) {
    return `K 组趋势：本轮 ${now} 条阻断项 —— ⚠ **上一轮判不出**（未登记基线）⇒ ⛔ 不做对比`
  }
  const d = now - last
  const word = d === 0 ? '未变' : d > 0 ? `多了 ${d} 条` : `少了 ${-d} 条`
  return `K 组趋势：本轮 ${now} 条阻断项（上轮 ${last} 条）—— ${word}`
}

/**
 * **K-E1** · 上面那份名单**只减不增** + 每条必须有原因与清理计划。
 *
 * @param {Array<{id:string,why:string,plan:string}>} list - 当前名单
 * @returns {string[]} 问题清单（空 = 绿）
 */
export const STORED_NOT_CONVERGED_MAX = 3

/**
 * ⭐ **「不可判定」词表**（2026-10-31 P42/R4 · `TASK-R4.md` §六）。
 *
 * ── 为什么它必须活在这里（⛔ 不许只活在夹具里）──────────────────────────
 *   R3b 时它只写在 `N-PLAN` 的**夹具侧** —— 于是真有人往名单里写「以后再说」，
 *   `checkKE1` **不会红**。⚠ 一条规则**只活在夹具里**就是**不会开火的规则**：
 *   夹具证明"如果写了这种词，判据能抓到"，而真账本里**没有任何东西**在检查它。
 *   ⇒ 移进本体（Hob 在 R3b 验收时裁定）。
 *
 * ⚠ 匹配口径：**子串**（⛔ 不做分词 —— 中文没有空格，分词会漏）。
 * ⚠ 词表**只许加、不许减**（减一条 = 放宽一条已认下的规则）。
 */
export const VAGUE_PLAN_WORDS = ['以后再说', '待定', '再说吧', '回头再', 'TODO', 'todo', 'TBD', '暂缓']

/**
 * ── ⚠⚠ **接受误伤，⛔ 不加否定句白名单**（2026-11-01 P40/R11 裁定 · `TASK-R11.md` §三）──
 *   背景：R10 实测 —— 我在 `plan` 里写「⛔ 不是"以后再说"」⇒ **被判红**（子串命中）。
 *   R10 §五-4 问：这个误伤要不要治？
 *
 *   **裁定：接受误伤，⛔ 不许加白名单。**
 *
 *   ── 为什么（⚠ 别只记结论）──────────────────────────────────
 *     ① 判据要拦的是**含糊的计划**。而「**不是**以后再说」这句**本身就是含糊的** ——
 *        它说的是"**不是**什么"，**没说什么**。⇒ **误伤方向是对的**：
 *        它逼人把"**是什么**"写出来（R10 的修法就是改成"等谁做什么、靠什么触发"）。
 *     ② ⛔ 加否定句白名单会开一个**洞**：任何含糊计划只要补一句"不是以后再说"就能过。
 *        ⚠ 这与 `BUDGET_KEYS` 那段注释防的是同一件事：
 *        **让判据去猜语义，它一定会被绕过。**
 *     ③ ⚠ 代价是"别在 `plan` 里引用那个词" —— 极小，且**有教育作用**
 *        （写的人会想"我为什么想写这句？因为我的计划还没说清是什么"）。
 *
 *   ⚠ 若将来有人提"只匹配句末/独立成句的出现"：那会漏掉「以后再说吧，先这样」
 *     （含逗号续句），且仍然可绕（"先这样吧，以后再说"）。⇒ ⛔ 别走那条路。
 */

/**
 * **K-E1** · 上面那份名单**只减不增** + 每条必须有原因与**可判定**的清理计划。
 *
 * @param {Array<{id:string,why:string,plan:string}>} list - 当前名单
 * @returns {string[]} 问题清单（空 = 绿）
 */
export function checkKE1(list) {
  const problems = []
  const arr = Array.isArray(list) ? list : []
  if (arr.length > STORED_NOT_CONVERGED_MAX) {
    problems.push(`K 组豁免名单长度 **${arr.length}** > 上一轮记录 **${STORED_NOT_CONVERGED_MAX}** ⇒ **只减不增**被破坏`)
  }
  for (const e of arr) {
    if (String(e?.id ?? '').trim() === '') problems.push('K 组豁免名单里有一条**没写 id**（⛔ 等于整类豁免）')
    else {
      if (String(e?.why ?? '').trim() === '') problems.push(`K 组豁免 \`${e.id}\` **没写原因**`)
      const plan = String(e?.plan ?? '').trim()
      if (plan === '') {
        problems.push(`K 组豁免 \`${e.id}\` **没写清理计划**`)
      } else {
        /**
         * ⚠ 非空还不够 —— 还必须**可判定**（`TASK-R4.md` §六 的裁定）。
         *   「以后再说」这类话**看着像计划，实际判不了**：没人知道"以后"是什么时候、
         *   靠什么触发。⛔ 让它通过 = 这条豁免可以永久挂着。
         */
        const vague = VAGUE_PLAN_WORDS.find((w) => plan.includes(w))
        if (vague !== undefined) {
          problems.push(`K 组豁免 \`${e.id}\` 的 \`plan\` 含 **"${vague}"** ⇒ **判不了什么时候清、靠什么清**`
            + '（⚠ 修法：写成"等谁做什么、触发条件是什么" —— ⛔ "以后再说"不是计划）')
        }
      }
    }
  }
  return problems
}

/**
 * ══ **S 组 · 取代关系双向核（扩到全部 kind）**（2026-11-02 · P50/D1 · `TASK-D1.md` §一第 1/3 件）══
 *
 * ── 它治什么 ────────────────────────────────────────────────────────
 *   改前「A 取代 B」只在 **`decision`** 一类上被双向核过（`decisionChainProblems` ⇒ I8 / K-5）。
 *   `req` / `change` / 其它 kind 就算写了 `supersedes`，**没人查对面有没有 `superseded_by`**
 *   ⇒ 一条被取代的需求可以同时被当成"现行"，而账本不红。
 *
 * ── ⚠⚠ 与既有判据的分工（`TASK-D1.md` §一第 1 件：⛔ 不重复报同一处红）──────────
 *   先查过：谁已经在管这件事？
 *     · **`decision`** 的「单边 / 悬空 / 只能取代决策」已由
 *       `src/shared/convergence.ts` 的 `decisionChainProblems` 管（`I8` 在
 *       `check:ledger-next`、`K-5` 在本族各调一次）。
 *       ⇒ 本组对 `decision` **⛔ 不重报**这三类，只在输出里**明说让位给谁**（⛔ 不静默漏）。
 *     · **自指**：`decisionChainProblems` **管不住** —— 实测 `A.supersedes = A` 且
 *       `A.superseded_by = A` 且 `status = superseded` 时它三条全不报（双向"对上了"、
 *       状态也"对上了"）⇒ 一个自吞的环被判成绿的。⇒ 自指**所有 kind 都由本组核**（含 `decision`）。
 *     · **悬空**：`checkI9` 的 `REF_FIELDS` **没有** `supersedes` / `superseded_by`
 *       ⇒ 除 `decision` 外**没有任何判据**在管这两个字段的引用存在性。
 *       ⇒ 本组对非 `decision` 补上（⚠ 不是重复，是真空白）。
 *
 * ── ⚠ 本组只核"已写出来的关系对不对" ──────────────────────────────────
 *   ⛔ 不要求"每条 req 都必须有 supersedes"（那是 `gen-ledger.mjs` 的 `EXTENDED_FIELDS` 的事）。
 */

/** `supersedes` 一条都没落时的那一行（⚠ 逐字被 `TASK-D1.md` §一第 3 件点名要求）。 */
export const SUPERSEDE_NOT_LANDED = '⊘ 取代关系尚未落数据（supersedes = 0 条）⇒ 双向核无法执行，⛔ 这不是通过'

/** 取一个"单值引用字段"的字符串值（缺 / 非字符串 ⇒ 空串）。 */
const refOne = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : '')

/**
 * **S-1 / S-2 / S-3 的纯函数实现**。
 *
 * ⚠ 收 `units` 而⛔ 不自己读盘：负向对拍要直接喂合成夹具（照 `N-GC1/2/3` 的形态）。
 *
 * @param {Array<Record<string, any>>} units - 单元数组
 * @returns {{ relations:number, s1:string[], s2:string[], s3:string[] }}
 *   `relations` = 真账本里**已写出来的取代关系条数**（0 ⇒ 走 ⊘ 档，⛔ 不判）
 */
export function supersedeBilateralProblems(units) {
  const s1 = []   // 正向单向：A.supersedes ∋ B 而 B.superseded_by ∌ A
  const s2 = []   // 反向单向：A.superseded_by ∋ B 而 B.supersedes ∌ A
  const s3 = []   // 自指
  const byId = new Map(units.map((u) => [String(u.id), u]))

  /** 已写出来的取代关系条数（⚠ 一个字段非空 = 一条关系；用来判 ⊘ 档）。 */
  let relations = 0
  for (const u of units) {
    if (refOne(u.supersedes) !== '') relations++
    if (refOne(u.superseded_by) !== '') relations++
  }

  for (const a of units) {
    const aid = String(a.id)
    const sup = refOne(a.supersedes)
    const by = refOne(a.superseded_by)

    // ── S-3 自指：**所有 kind**（含 decision —— 见上方分工说明，那里 I8 管不住）──
    if (sup === aid) {
      s3.push(`${aid}：\`supersedes\` **指向它自己** ⇒ 自吞的环（⛔ 取代关系必须指向另一个单元）`)
    }
    if (by === aid) {
      s3.push(`${aid}：\`superseded_by\` **指向它自己** ⇒ 自吞的环（⛔ 取代关系必须指向另一个单元）`)
    }

    /**
     * ⚠ `decision` 让位给 `decisionChainProblems`（I8 / K-5）：
     *   单边与悬空那两类它已经在报 ⇒ 这里⛔ 再报一遍（两处红同一件事 = 噪音掩盖真缺陷）。
     *   自指**不**让位（上面已说明它管不住）。
     */
    if (a.kind === 'decision') continue

    // ── S-1 正向单向 ──────────────────────────────────────────────
    if (sup !== '' && sup !== aid) {
      const b = byId.get(sup)
      if (b === undefined) {
        s1.push(`${aid}：\`supersedes = ${JSON.stringify(sup)}\` 指向的单元**不存在** ⇒ 判不出（⛔ 悬空引用不许放过）`)
      } else if (refOne(b.superseded_by) !== aid) {
        s1.push(`${aid} 说取代了 \`${sup}\`，而 \`${sup}.superseded_by = ${JSON.stringify(b.superseded_by ?? null)}\``
          + ' ⇒ **单边声明**（⛔ 取代必须双向对上）')
      }
    }

    // ── S-2 反向单向 ──────────────────────────────────────────────
    if (by !== '' && by !== aid) {
      const b = byId.get(by)
      if (b === undefined) {
        s2.push(`${aid}：\`superseded_by = ${JSON.stringify(by)}\` 指向的单元**不存在** ⇒ 判不出（⛔ 悬空引用不许放过）`)
      } else if (refOne(b.supersedes) !== aid) {
        s2.push(`${aid}：\`superseded_by = ${by}\` 而 \`${by}.supersedes = ${JSON.stringify(b.supersedes ?? null)}\``
          + ' ⇒ **单边声明**（⛔ 反向也要对上）')
      }
    }
  }

  return { relations, s1, s2, s3 }
}

/**
 * **档位归属的唯一判定**：0 条关系 ⇒ `'skip'`，否则 ⇒ `'checked'`。
 * ⚠ 抽成函数，好让负向对拍 `N-S0` 测的就是主流程用的那条规则（⛔ 夹具里另写一份）。
 */
export function supersedeBucket(cov) {
  return cov.relations === 0 ? 'skip' : 'checked'
}

/**
 * **S 组报告体**（⚠ 主流程与负向对拍**共用这一个函数**，sink 由调用方注入）。
 *
 * ── 为什么 sink 要注入（`TASK-D1.md` §一第 3 件点名要求）────────────────
 *   若这里直接调模块级 `ok` / `bad` / `noteSkip`，`N-S0` 一跑就**污染真实计数**。
 *   ⇒ sink 作参数传入：主流程传真 sink，对拍传影子 sink ⇒ 两边跑**同一段判定**，
 *     影子那次的计数只落在局部变量里。（这条坑 B 轨实测踩过：处级口径印成「跳过 2 处」而实际 1 处。）
 *
 * @param {{relations:number,s1:string[],s2:string[],s3:string[]}} cov
 * @param {{ok:Function,bad:Function,noteSkip:Function}} sink
 * @returns {'skip'|'checked'} 落在哪个档位
 */
export function reportSupersedeLayer(cov, sink) {
  const bucket = supersedeBucket(cov)
  if (bucket === 'skip') {
    sink.noteSkip(SUPERSEDE_NOT_LANDED)
    return bucket
  }
  const RULES = [
    ['S-1', cov.s1, '正向：`A.supersedes ∋ B` ⇒ `B.superseded_by ∋ A`',
      `S-1 ✓ 取代关系·正向双向：${cov.relations} 条已写出的关系里，\`supersedes\` 一侧**全部**在对面写回了 \`superseded_by\`（decision 让位 I8/K-5，⛔ 不重报）`],
    ['S-2', cov.s2, '反向：`A.superseded_by ∋ B` ⇒ `B.supersedes ∋ A`',
      `S-2 ✓ 取代关系·反向双向：\`superseded_by\` 一侧**全部**在对面写回了 \`supersedes\`（⛔ 不是只核一个方向）`],
    ['S-3', cov.s3, '自指：`A` 指向自己 ⇒ 红',
      `S-3 ✓ 取代关系·无自指：${cov.relations} 条关系里**没有一条指向自己**（含 decision —— 那里 I8 管不住全对上的自指）`],
  ]
  for (const [id, probs, what, okMsg] of RULES) {
    if (probs.length === 0) sink.ok(okMsg)
    else for (const x of probs) sink.bad(`${id} · ${what}：${x}`)
  }
  return bucket
}

try {
  console.log('')
  console.log('K 组：收敛检查 —— 一个**变更**收没收口（K-1..K-6）')
  console.log('')

  const units = readUnits(join(LEDGER, 'units', 'index.toml'))
  if (units.length === 0) throw new Error('索引 0 条单元 ⇒ K 组失去基准（⛔ 不按通过处理）')
  const changes = units.filter((u) => u.kind === 'change')
  ok(`K-0 ✓ 索引可读：${units.length} 条单元 · 其中 **${changes.length}** 条 change`)

  const { checkI7, checkI8 } = await import(pathToFileURL(join(here, 'check-ledger-next.mjs')).href)
  const deps = { i7: checkI7, i8: checkI8 }

  /** ⚠ 本轮阻断项总数（`TASK-R3b.md` §二 B-2 的趋势要用）。 */
  let blockerTotal = 0
  for (const chg of changes) {
    const res = convergenceOf(units, chg, deps)
    blockerTotal += res.blockers.length
    const text = renderVerdict(String(chg.id), res)
    const exempt = STORED_NOT_CONVERGED.find((e) => String(e.id) === String(chg.id))
    if (res.converged) {
      ok(`K-ALL ✓ ${text}`)
    } else if (exempt !== undefined) {
      /**
       * ⚠⚠ **存量未收口**：判据**照样把阻断项逐条打印**（⛔ 不沉默、⛔ 不粉饰），
       *   只是**不计入退出码**。理由见 `STORED_NOT_CONVERGED` 上方。
       */
      ok(`K-ALL · **存量未收口（点名豁免，不计退出码）**\n${text}\n    ⚠ 为什么豁免：${exempt.why}\n    ⚠ 清理计划：${exempt.plan}`)
    } else {
      bad(`K-ALL · ${text}`)
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // S 组 · 取代关系双向核（2026-11-02 P50/D1 · `TASK-D1.md` §一第 1/3 件）
  // ══════════════════════════════════════════════════════════════════════
  /**
   * ⚠⚠ **0 条关系走 `skip` 档，⛔ 不进 `ok`、⛔ 也不进 `bad`**：
   *   · 进 `ok` ⇒ "取代关系根本没落数据"被洗成"双向全对"（假绿）；
   *   · 进 `bad` ⇒ 上线即红。
   *   ⇒ 单列 `⊘`，计入 `skip`（处级口径单独报，⛔ 不计入「过了」）。
   */
  {
    const cov = supersedeBilateralProblems(units)
    const bucket = reportSupersedeLayer(cov, { ok, bad, noteSkip })
    if (bucket === 'skip') {
      console.log(`      ⇒ 实测：\`supersedes\` / \`superseded_by\` **两个字段合计 0 条非空**`
        + `（索引 ${units.length} 条单元里一条取代关系都没写）⇒ 三条双向核**一条也判不了**`)
    }
  }

  /**
   * ── K-TREND · 本轮 vs 上一轮的阻断项趋势（`TASK-R3b.md` §二 B-2）──
   * ⚠ 阻断项**条数**要能对上；上一轮那个数的来源见 `LAST_ROUND_BLOCKERS` 上方注释。
   */
  {
    const trend = renderTrend(blockerTotal, LAST_ROUND_BLOCKERS)
    /**
     * ⚠ 这里**不算通过/失败**：趋势本身不是"对/错"，它是**读数**。
     *   但它必须**每轮都打**（⛔ 不许只在变化时打 —— 那会让"一直没收口"看不出来）。
     */
    ok(`K-TREND ✓ ${trend}`)
  }

  /** ── K-E1 · 豁免名单只减不增 ── */
  {
    const probs = checkKE1(STORED_NOT_CONVERGED)
    if (probs.length === 0) {
      ok(`K-E1 ✓ **豁免名单只减不增**：当前 **${STORED_NOT_CONVERGED.length}** 条 ≤ 上一轮记录 **${STORED_NOT_CONVERGED_MAX}** 条；每条都有原因与清理计划`)
    } else for (const p of probs) bad(`K-E1 · ${p}`)
  }

  /**
   * ⚠ 一条 change 都没有 ⇒ **判不出 ⇒ 红**（⛔ 不许"没东西可判"就当通过）。
   */
  if (changes.length === 0) bad('K-0 · 索引里**一条 change 都没有** ⇒ 收敛判据无从判定（⛔ 不按通过处理）')

  // ══════════════════════════════════════════════════════════════════════
  // 2026-10-31 P41/R3 · K-1..K-6 的「必须拒绝」负向对拍（`TASK-R3.md` §五）
  // ⚠ 每条：① 先自证夹具真造出了非法状态 ② 断言判红那行是**它自己的编号**
  //   ③ **反面也要有**：合法状态必须绿
  // ══════════════════════════════════════════════════════════════════════

  /** 一个"完全收口"的基线夹具（⚠ 各条负向对拍都从它出发，只破坏一处）。 */
  const base = () => ([
    { id: 'R-900', kind: 'req', status: 'agreed', parent: 'spec/progress', after: [], acceptance_ids: ['ACC-900'] },
    { id: 'CHG-900', kind: 'change', status: 'settled', parent: 'spec/progress', after: [], built_by: 'session-BUILDER',
      addresses: ['R-900'], decisions: [], supersedes: '', risk_ids: [] },
    { id: 'TSK-900', kind: 'task', status: 'built', parent: 'CHG-900', after: [], built_by: 'session-BUILDER',
      verify_refs: ['EVD-900'], verify: 'check:x 1/1', risk_ids: [] },
    { id: 'EVD-900', kind: 'evidence', status: 'recorded', parent: 'TSK-900', after: [],
      reading: 'check:x 1/1', taken_at: '判不出', code_state: '判不出' },
    { id: 'ACC-900', kind: 'acc', status: 'pass', parent: 'TSK-900', after: [],
      actor: 'session-VERIFIER', basis: ['EVD-900'], evidence: ['check:x 1/1'] },
  ])
  const stubI7 = (us) => {
    const ids = new Set(us.filter((u) => u.kind === 'evidence').map((u) => String(u.id)))
    return us.filter((u) => u.kind === 'task' && String(u.status) === 'built')
      .flatMap((t) => (Array.isArray(t.verify_refs) ? t.verify_refs : [])
        .filter((r) => !ids.has(String(r)))
        .map((r) => `${t.id}：\`verify_refs\` 里的 \`${r}\` **不存在**`))
  }
  const stubI8 = () => []

  // ── N-K0：基线夹具**必须收口**（⛔ 不先证绿，后面的"必红"没有意义）──
  {
    const res = convergenceOf(base(), base()[1], { i7: stubI7, i8: stubI8 })
    if (res.converged) ok('N-K0 ✓ 正向对照：一个**完全收口**的夹具（需求已定 · 任务全 built · 证据齐 · acc pass · 无风险 · 不是自己验）⇒ `converged`（⛔ 判据不是恒红）')
    else bad(`N-K0 · 收口夹具却判未收口 ⇒ 判据过咬（阻断项：${JSON.stringify(res.blockers)}）`)
  }

  // ── N-K1：有 task 没到终态 ⇒ K-1 必红 ──
  {
    const u = base()
    u[2] = { ...u[2], status: 'doing' }
    const res = convergenceOf(u, u[1], { i7: stubI7, i8: stubI8 })
    const hit = res.blockers.find((b) => b.rule === 'K-1' && b.unit === 'TSK-900')
    if (u[2].status !== 'doing') bad('N-K1 · 夹具没把 task 改成 doing ⇒ 本条不可判')
    else if (hit !== undefined) ok(`N-K1 ✓ 负向对拍（先自证：\`TSK-900.status = "doing"\`）⇒ K-1 的"还有活没做完"**必红**：${hit.why.slice(0, 70)}`)
    else bad('N-K1 · task 没到终态却绿灯 ⇒ K-1 哑了')
  }

  /**
   * ── N-K1b：零 task 档（2026-11-01 P40/R10 裁定 · `TASK-R10.md` §一 三条对拍）──────
   *   ⚠ 旧版这条夹具用的是 `base()`，而 `base()` 的 change **有** `addresses = ['R-900']`
   *     ⇒ 按 R10 新口径它**不该再红**（K-3 会判）。所以本条必须**分成三支**：
   *
   *   ① **零 task + 零 addresses** ⇒ **必红**（⚠⚠ 这是新改法唯一的洞：真空收口）
   *   ② 零 task + 非空 addresses + 有 pass acc ⇒ **不红**
   *   ③ 零 task + 非空 addresses + acc 是 `unverified` ⇒ **K-1 不报、K-3 报**
   *      （⚠ 断言消息里**不含** `K-1`、**含** `K-3` —— 这是 §一-3 的原话要求）
   */
  {
    /** ① 真空收口那道：零 task + **零 addresses** ⇒ K-1 必红 */
    const u1 = base()
      .filter((x) => x.id !== 'TSK-900' && x.id !== 'EVD-900' && x.id !== 'ACC-900')
      .map((x) => (x.id === 'CHG-900' ? { ...x, addresses: [] } : x))
    const res1 = convergenceOf(u1, u1[1], { i7: stubI7, i8: stubI8 })
    const hit1 = res1.blockers.find((b) => b.rule === 'K-1')
    /** ⚠ 先自证：夹具真的是"零 task + 零 addresses"两件同时成立。 */
    const self1 = u1.filter((x) => x.kind === 'task' && String(x.parent) === 'CHG-900').length === 0
      && (u1[1].addresses ?? []).length === 0

    /** ② 零 task + 非空 addresses + **pass** acc ⇒ K-1 不红 */
    const u2 = base()
      .filter((x) => x.id !== 'TSK-900' && x.id !== 'EVD-900')
      .map((x) => (x.id === 'ACC-900' ? { ...x, status: 'pass', outcome: 'pass' } : x))
    const res2 = convergenceOf(u2, u2[1], { i7: stubI7, i8: stubI8 })
    const hit2 = res2.blockers.find((b) => b.rule === 'K-1')

    /**
     * ③ 零 task + 非空 addresses + acc 是 `unverified` ⇒ K-1 不报、K-3 报
     * ⚠ `base()` 里 `ACC-900` 本来是 `pass` ⇒ 必须**显式改成 `unverified`**，
     *   否则 K-3 本来就绿，这条测的是空气（我第一次就这么错了）。
     */
    const u3 = base()
      .filter((x) => x.id !== 'TSK-900' && x.id !== 'EVD-900')
      .map((x) => (x.id === 'ACC-900' ? { ...x, status: 'unverified' } : x))
    const res3 = convergenceOf(u3, u3[1], { i7: stubI7, i8: stubI8 })
    const hit3 = res3.blockers.find((b) => b.rule === 'K-1')
    const k3hit = res3.blockers.find((b) => b.rule === 'K-3')

    if (!self1) bad('N-K1b · 夹具没造出"零 task + 零 addresses" ⇒ ① 不可判')
    else if (hit1 === undefined) bad('N-K1b · **零 task + 零 addresses 却绿灯** ⇒ ⛔ 真空收口（K-1 不报、K-3 无对象 = 全绿），这是本改法唯一的洞')
    else if (hit1.why.includes('判不出收没收口') === false) bad(`N-K1b · 零 addresses 时消息没说"判不出收没收口"：${hit1.why.slice(0, 60)}`)
    else if (hit2 !== undefined) bad(`N-K1b · 零 task + 非空 addresses + pass acc 仍报 K-1 ⇒ 新口径哑了（${hit2.why.slice(0, 60)}）`)
    else if (hit3 !== undefined) bad(`N-K1b · 零 task + 非空 addresses 但 acc 是 unverified，K-1 仍报 ⇒ 让位没生效（${hit3.why.slice(0, 60)}）`)
    else if (k3hit === undefined) bad('N-K1b · ③ 里 K-3 **没报** ⇒ 让位给了个不会开火的判据（"让位的前提是 K-3 真的会跑"被破坏）')
    else {
      ok('N-K1b ✓ **零 task 档三条对拍**（⚠ 先自证 ① 夹具是"零 task + 零 addresses"两件同时成立）'
        + `① **零 task + 零 addresses ⇒ 必红**（真空收口那道）：${hit1.why.slice(0, 62)}…`
        + ' ② 零 task + 非空 addresses + pass acc ⇒ **K-1 不红**'
        + ` ③ 零 task + 非空 addresses + acc \`unverified\` ⇒ **K-1 不报、K-3 报**：${k3hit.why.slice(0, 56)}…`
        + '（⚠ 让位的前提是 K-3 真的会跑 —— ③ 就是证明这一点的）')
    }
  }

  // ── N-K2：`verify_refs` 指向不存在的 evidence ⇒ K-2 必红（与 I7 同源）──
  {
    const u = base()
    u[2] = { ...u[2], verify_refs: ['EVD-9999'] }
    const res = convergenceOf(u, u[1], { i7: stubI7, i8: stubI8 })
    const hit = res.blockers.find((b) => b.rule === 'K-2')
    if (u[2].verify_refs[0] === 'EVD-9999' && hit !== undefined) {
      ok(`N-K2 ✓ 负向对拍（先自证：\`TSK-900.verify_refs = ["EVD-9999"]\` 且该 id 不存在）⇒ K-2 的"做完了指不出读数"**必红**：${hit.why.slice(0, 70)}`)
    } else bad('N-K2 · 悬空 verify_refs 却绿灯 ⇒ K-2 没接上 I7')
  }

  // ── N-K3：需求没有 acc ⇒ K-3 必红；acc 不是 pass ⇒ 也必红 ──
  {
    const u1 = base().filter((x) => x.id !== 'ACC-900')
    u1[0] = { ...u1[0], acceptance_ids: [] }
    const r1 = convergenceOf(u1, u1[1], { i7: stubI7, i8: stubI8 })
    const h1 = r1.blockers.find((b) => b.rule === 'K-3' && b.why.includes('没有任何 acc'))

    const u2 = base()
    u2[4] = { ...u2[4], status: 'send-back' }
    const r2 = convergenceOf(u2, u2[1], { i7: stubI7, i8: stubI8 })
    const h2 = r2.blockers.find((b) => b.rule === 'K-3' && b.why.includes('不是 `pass`'))

    if (h1 !== undefined && h2 !== undefined) {
      ok(`N-K3 ✓ 负向对拍（先自证：① 删掉 \`ACC-900\` 且 \`acceptance_ids\` 清空 ② \`ACC-900.status = "send-back"\`）`
        + `⇒ K-3 两种坏法**都必红**：①${h1.why.slice(0, 50)} ②${h2.why.slice(0, 50)}`)
    } else bad(`N-K3 · 缺验收或验收未过却绿灯（h1=${JSON.stringify(h1)} · h2=${JSON.stringify(h2)}）`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // N-K3b · **K-3 的漂修复回归证明**（2026-11-01 P40/R5b · `TASK-R5b.md` §3.3）
  //
  // ⚠⚠ 这一条治的是一次**真实的漂**：R5 给 `check-ledger-next.mjs` 加了 `outcome ?? status`，
  //   而本文件的 `k3` **仍然只读 `outcome`** ⇒ 同一事实两个落点。
  //   后果：本账本 28 条 acc 的 `outcome` 全空、其中 25 条 `status=pass`，
  //   一旦 change 的 `addresses` 指向挂着 acc 的需求，K-3 会报
  //   「验收都不是 `pass`（实测：ACC-xxx=null）」—— **那是一句假话**。
  //   当时没红，只因为两条 change 的 `addresses` 恰好指向没有 acc 的需求。
  //   ⇒ **恒绿只是因为没被触发，不是因为判据对。**
  //
  // ⚠ 本条用的是**自造夹具**（⛔ 没有改真账本）：`CHG-901.addresses = ["R-901"]`，
  //   `R-901.acceptance_ids = ["ACC-901"]`，`ACC-901` 的判决记在 **`status`** 上。
  // ══════════════════════════════════════════════════════════════════════
  {
    /** ⚠ 关键：acc **只有 `status`**，**⛔ 没有 `outcome`** —— 这就是真账本的形状。 */
    const mk = (accStatus) => ([
      { id: 'R-901', kind: 'req', status: 'agreed', parent: 'spec/progress', after: [], acceptance_ids: ['ACC-901'] },
      { id: 'CHG-901', kind: 'change', status: 'settled', parent: 'spec/progress', after: [], built_by: 'session-BUILDER',
        addresses: ['R-901'], decisions: [], supersedes: '', risk_ids: [] },
      { id: 'TSK-901', kind: 'task', status: 'built', parent: 'CHG-901', after: [], built_by: 'session-BUILDER',
        verify_refs: ['EVD-901'], verify: 'check:x 1/1', risk_ids: [] },
      { id: 'EVD-901', kind: 'evidence', status: 'recorded', parent: 'TSK-901', after: [],
        reading: 'check:x 1/1', taken_at: '判不出', code_state: '判不出' },
      { id: 'ACC-901', kind: 'acc', status: accStatus, parent: 'TSK-901', after: [],
        actor: 'session-VERIFIER', basis: ['EVD-901'], evidence: ['check:x 1/1'] },
    ])
    const us = mk('pass')
    /** 先自证：夹具真的"只有 status、没有 outcome"，且 status 是 pass。 */
    const acc = us.find((u) => u.id === 'ACC-901')
    const selfProven = acc !== undefined
      && !Object.prototype.hasOwnProperty.call(acc, 'outcome')
      && acc.status === 'pass'

    const res = convergenceOf(us, us[1], { i7: stubI7, i8: stubI8 })
    const k3Hit = res.blockers.find((b) => b.rule === 'K-3')
    const converged = res.converged

    const us2 = mk('send-back')
    const res2 = convergenceOf(us2, us2[1], { i7: stubI7, i8: stubI8 })
    const k3Hit2 = res2.blockers.find((b) => b.rule === 'K-3' && b.why.includes('不是 `pass`'))

    if (!selfProven) bad('N-K3b · 夹具没造出"acc 只有 status=pass、没有 outcome" ⇒ 本条不可判（那正是真账本的形状）')
    else if (k3Hit !== undefined) bad(`N-K3b · **K-3 仍然读不到 \`status\`**（漂没修好）：acc 是 pass 却报 ${JSON.stringify(k3Hit.why)}`)
    else if (!converged) bad(`N-K3b · 夹具完全收口却 \`converged=false\` ⇒ K-3 之外还有阻断（${JSON.stringify(res.blockers.map((b) => b.rule))}）`)
    else if (k3Hit2 === undefined) bad('N-K3b · 反证失败：acc 改 `status=send-back` 后 K-3 没报"不是 `pass`" ⇒ 判据恒绿')
    else ok(`N-K3b ✓ 负向对拍 **K-3 的漂已修好**（先自证：夹具的 \`ACC-901\` **只有 \`status="pass"\`、⛔ 没有 \`outcome\`** —— 与真账本 28 条 acc 同形）`
      + ` ⇒ K-3 **0 阻断 · \`converged=true\`**（⛔ 不再报"验收都不是 \`pass\`（实测：ACC-901=null）"那句假话）；`
      + ` **反证**：\`status\` 改 \`send-back\` ⇒ K-3 **必红**：${k3Hit2.why.slice(0, 60)}`)
  }

  // ── N-K4：**开着风险就宣布收口** ⇒ K-4 必红（⚠ 作业书点名要专测这条）──
  {
    const u = base()
    u.push({ id: 'RSK-900', kind: 'risk', status: 'open', parent: 'spec/progress', after: [],
      affects: ['CHG-900'], disposition: '还没处置', owner: 'session-HOB' })
    const res = convergenceOf(u, u[1], { i7: stubI7, i8: stubI8 })
    const hit = res.blockers.find((b) => b.rule === 'K-4' && b.unit === 'RSK-900')
    if (hit === undefined) bad('N-K4 · **开着风险却绿灯** ⇒ 这正是作业书点名"最容易被顺手放过"的那条')
    else {
      // 反面①：改成 closed ⇒ 绿
      const u2 = base()
      u2.push({ id: 'RSK-900', kind: 'risk', status: 'closed', parent: 'spec/progress', after: [],
        affects: ['CHG-900'], disposition: '已处置', owner: 'session-HOB' })
      const r2 = convergenceOf(u2, u2[1], { i7: stubI7, i8: stubI8 })
      // 反面②：改成 handling ⇒ 不阻断，但**必须列出**
      const u3 = base()
      u3.push({ id: 'RSK-900', kind: 'risk', status: 'handling', parent: 'spec/progress', after: [],
        affects: ['CHG-900'], disposition: '在处置', owner: 'session-HOB' })
      const r3 = convergenceOf(u3, u3[1], { i7: stubI7, i8: stubI8 })
      const okClosed = r2.converged
      const okHandling = r3.converged && r3.noted.some((n) => n.includes('RSK-900'))
      if (okClosed && okHandling) {
        ok(`N-K4 ✓ 负向对拍（先自证：\`RSK-900.status = "open"\` 且 \`affects\` 点了 \`CHG-900\`）⇒ K-4 的"开着风险就宣布收口"**必红**：${hit.why.slice(0, 60)}`
          + '；**反面**：`closed` ⇒ 收口绿 · `handling` ⇒ 不阻断但**被列出**（⛔ 不是静默放过）')
      } else bad(`N-K4 · 反面不成立（closed 绿=${okClosed} · handling 列出=${okHandling}）`)
    }
  }

  // ── N-K5：依据的决策已被取代却没指向继任者 ⇒ K-5 必红（与 I8 同源）──
  {
    const u = base()
    u[1] = { ...u[1], decisions: ['DEC-900'] }
    u.push({ id: 'DEC-900', kind: 'decision', status: 'active', parent: 'spec/progress', after: [],
      supersedes: '', superseded_by: 'DEC-901', basis_readings: [] })
    const i8 = (us) => {
      // ⚠ 用**真的** I8 口径：这里注入一个会报 DEC-900 的实现（同源验证在 `convergenceOf` 的调用方）
      return ['DEC-900：`superseded_by` 非空而 `supersedes` 没对上的反向单边']
    }
    const res = convergenceOf(u, u[1], { i7: stubI7, i8 })
    const hit = res.blockers.find((b) => b.rule === 'K-5')
    if (hit !== undefined) ok(`N-K5 ✓ 负向对拍（先自证：\`DEC-900.superseded_by = "DEC-901"\` 而 \`supersedes\` 为空 ⇒ 反向单边）⇒ K-5 的"依据的决策已经作废"**必红**：${hit.why.slice(0, 70)}`)
    else bad('N-K5 · 决策作废却绿灯 ⇒ K-5 没接上 I8')
  }

  // ── N-K6：change.built_by 与 acc.actor 同一人 ⇒ K-6 必红 ──
  {
    const u = base()
    u[4] = { ...u[4], actor: 'session-BUILDER' }
    const res = convergenceOf(u, u[1], { i7: stubI7, i8: stubI8 })
    const hit = res.blockers.find((b) => b.rule === 'K-6' && b.why.includes('自己验自己'))
    if (u[4].actor === u[1].built_by && hit !== undefined) {
      ok(`N-K6 ✓ 负向对拍（先自证：\`ACC-900.actor\` 与 \`CHG-900.built_by\` 同为 \`session-BUILDER\`）⇒ K-6 的"自己验自己"**必红**：${hit.why.slice(0, 70)}`)
    } else bad('N-K6 · 自己验自己却绿灯 ⇒ K-6 哑了')
  }

  // ── N-K6b：`built_by` 缺失 ⇒ 判不出 ⇒ 必红（⛔ 不许当通过）──
  {
    const u = base()
    u[1] = { ...u[1], built_by: undefined }
    const res = convergenceOf(u, u[1], { i7: stubI7, i8: stubI8 })
    const hit = res.blockers.find((b) => b.rule === 'K-6' && b.why.includes('缺失'))
    if (hit !== undefined) ok(`N-K6b ✓ 负向对拍（先自证：删掉 \`CHG-900.built_by\`）⇒ K-6 的"判不出 ⇒ 红"**必红**：${hit.why.slice(0, 60)}`)
    else bad('N-K6b · built_by 缺失却绿灯 ⇒ 判不出被当成通过了')
  }

  // ── N-TREND：趋势三态 + "上一轮判不出"不许拿本轮充数（`TASK-R3b.md` §二 B-2）──
  {
    const same = renderTrend(4, 4)
    const fewer = renderTrend(3, 4)
    const more = renderTrend(5, 4)
    const unknown = renderTrend(4, null)
    const okSame = same.includes('未变') && same.includes('上轮 4')
    const okFewer = fewer.includes('少了 1 条')
    const okMore = more.includes('多了 1 条')
    const okUnknown = unknown.includes('判不出') && !unknown.includes('上轮 4')
    if (okSame && okFewer && okMore && okUnknown) {
      ok(`N-TREND ✓ 趋势四态实测：\`${same}\` · \`${fewer}\` · \`${more}\` · \`${unknown}\``)
    } else {
      bad(`N-TREND · 趋势口径不对（same=${okSame} fewer=${okFewer} more=${okMore} unknown=${okUnknown}）`)
    }
  }

  // ── N-PLAN：`plan` 必须**可判定** —— 空 / "以后再说" 两类都必红（`TASK-R4.md` §六）──
  {
    const empty = [{ id: 'X', why: 'x', plan: '' }]
    const vague = [{ id: 'X', why: 'x', plan: '以后再说' }]
    const pEmpty = checkKE1(empty)
    const pVague = checkKE1(vague)
    const okEmpty = pEmpty.some((x) => x.includes('没写清理计划'))
    const okVague = pVague.some((x) => x.includes('以后再说') && x.includes('判不了'))
    /**
     * ⚠ 自证两件事：
     *   ① 两类坏 plan **都**被 `checkKE1` 本体咬住（⛔ 不是靠夹具外面的词表）；
     *   ② 真名单那 2 条**不含任何**不可判定词（⛔ 不是"判据只拦别人不拦自己"）。
     */
    const selfClean = !STORED_NOT_CONVERGED.some((e) => VAGUE_PLAN_WORDS.some((w) => String(e.plan).includes(w)))
    if (okEmpty && okVague && selfClean) {
      ok(`N-PLAN ✓ 负向对拍（先自证：① \`plan=""\` ② \`plan="以后再说"\`，两者都过 \`checkKE1\` 本体）`
        + `⇒ **两类都必红**：①${pEmpty[0].slice(0, 40)}… ②${pVague[0].slice(0, 50)}…`
        + `；**反面**：真名单 ${STORED_NOT_CONVERGED.length} 条 plan 全部不含 ${VAGUE_PLAN_WORDS.length} 个禁用词 ⇒ 绿`)
    } else {
      bad(`N-PLAN · 不可判定 plan 没被咬住（空=${okEmpty} 以后再说=${okVague} 真名单干净=${selfClean}）`
        + ' ⚠ 词表若只活在夹具里就是不会开火的规则')
    }
  }

  // ── N-KR：`renderVerdict` ⛔ 不许只给布尔 —— 必须逐条列出阻断项编号与原因 ──
  {
    const u = base()
    u[2] = { ...u[2], status: 'doing' }
    u.push({ id: 'RSK-900', kind: 'risk', status: 'open', parent: 'spec/progress', after: [],
      affects: ['CHG-900'], disposition: 'x', owner: 'x' })
    const res = convergenceOf(u, u[1], { i7: stubI7, i8: stubI8 })
    const text = renderVerdict('CHG-900', res)
    const hasCount = text.includes('not-converged:') && text.includes('阻断项')
    const listsRules = text.includes('K-1') && text.includes('K-4')
    const listsUnits = text.includes('TSK-900') && text.includes('RSK-900')
    if (hasCount && listsRules && listsUnits) {
      ok(`N-KR ✓ 输出不是布尔：\`${text.split('\n')[0]}\` —— 逐条列出 **${res.blockers.length}** 个阻断项，各带判据编号 + 单元 id + 原因`)
    } else bad(`N-KR · 输出缺项（计数=${hasCount} 编号=${listsRules} 单元=${listsUnits}）：${text.slice(0, 120)}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // S 组的四条负向对拍（2026-11-02 P50/D1 · `TASK-D1.md` §一第 2/3 件）
  // ⚠ 全部**合成夹具**（⛔ 不拿真账本当夹具：真账本 supersedes = 0 条 ⇒ 0 对象假绿）
  // ⚠ 每条：① 先自证基线全绿 ② 改坏 ⇒ 必红且点名 id ③ 还原 ⇒ 回绿
  // ══════════════════════════════════════════════════════════════════════
  {
    /**
     * 基线夹具：**非 decision** 的一对（`change` 取代 `change`）+ 一对 `req`，
     * 双向都写对 ⇒ 三条全绿。⚠ 故意用 `change` / `req` 而不是 `decision`：
     * 本条要证的正是"**扩到全部 kind**"（decision 那类改前就已经被 I8 管着）。
     */
    const baseSup = () => ([
      { id: 'CHG-950', kind: 'change', status: 'settled', parent: 'spec/progress', after: [], supersedes: '', superseded_by: 'CHG-951' },
      { id: 'CHG-951', kind: 'change', status: 'settled', parent: 'spec/progress', after: [], supersedes: 'CHG-950', superseded_by: '' },
      { id: 'R-950', kind: 'req', status: 'dropped', parent: 'spec/progress', after: [], supersedes: '', superseded_by: 'R-951' },
      { id: 'R-951', kind: 'req', status: 'agreed', parent: 'spec/progress', after: [], supersedes: 'R-950', superseded_by: '' },
    ])
    const clean = supersedeBilateralProblems(baseSup())
    const baselineClean = clean.relations === 4
      && clean.s1.length === 0 && clean.s2.length === 0 && clean.s3.length === 0

    if (!baselineClean) {
      bad(`N-S · 合成夹具基线**本身就不合法**（期望 4 条关系 / 三条全空，实测 relations=${clean.relations} `
        + `s1=${clean.s1.length} s2=${clean.s2.length} s3=${clean.s3.length}）⇒ 下面三条对拍不可判`)
    } else {
      // ── N-1 正向单向：A.supersedes=[B] 而 B.superseded_by 空 ⇒ 必红，点名两个 id ──
      {
        const mut = baseSup().map((u) => (u.id === 'CHG-950' ? { ...u, superseded_by: '' } : u))
        const r = supersedeBilateralProblems(mut)
        /** ⚠ 自证：真的只破坏了"正向"这一面（`CHG-951.supersedes` 仍在，对面没写回）。 */
        const reallyBroken = mut.find((u) => u.id === 'CHG-951').supersedes === 'CHG-950'
          && mut.find((u) => u.id === 'CHG-950').superseded_by === ''
        const hit = r.s1.find((x) => x.includes('CHG-951') && x.includes('CHG-950'))
        if (!reallyBroken) bad('N-1 · 夹具没造出"正向单向"形态 ⇒ 本条不可判')
        else if (hit === undefined) bad(`N-1 · \`CHG-951.supersedes = CHG-950\` 而 \`CHG-950.superseded_by\` 空却绿灯 ⇒ S-1（正向）哑了`)
        else if (r.s2.length !== 0 || r.s3.length !== 0) bad(`N-1 · 只改一处却连带咬了别的（s2=${r.s2.length} s3=${r.s3.length}）⇒ 夹具不干净`)
        else ok(`N-1 ✓ 负向对拍（先自证：基线 4 条关系全绿；再清空 \`CHG-950.superseded_by\` 而 \`CHG-951.supersedes = CHG-950\` 仍在）`
          + ` ⇒ S-1（**正向**）**必红**且**点名两个 id**：${hit.slice(0, 110)}`
          + '；**反面**：写回 `CHG-950.superseded_by = CHG-951` ⇒ 回到基线全绿（⛔ 不是恒红）')
      }

      // ── N-2 反向单向：B.superseded_by=[A] 而 A.supersedes 空 ⇒ 必红，点名两个 id ──
      {
        const mut = baseSup().map((u) => (u.id === 'CHG-951' ? { ...u, supersedes: '' } : u))
        const r = supersedeBilateralProblems(mut)
        const reallyBroken = mut.find((u) => u.id === 'CHG-950').superseded_by === 'CHG-951'
          && mut.find((u) => u.id === 'CHG-951').supersedes === ''
        const hit = r.s2.find((x) => x.includes('CHG-950') && x.includes('CHG-951'))
        if (!reallyBroken) bad('N-2 · 夹具没造出"反向单向"形态 ⇒ 本条不可判')
        else if (hit === undefined) bad(`N-2 · \`CHG-950.superseded_by = CHG-951\` 而 \`CHG-951.supersedes\` 空却绿灯 ⇒ S-2（反向）哑了`)
        else if (r.s1.length !== 0 || r.s3.length !== 0) bad(`N-2 · 只改一处却连带咬了别的（s1=${r.s1.length} s3=${r.s3.length}）⇒ 夹具不干净`)
        else ok(`N-2 ✓ 负向对拍（先自证：基线全绿；再清空 \`CHG-951.supersedes\` 而 \`CHG-950.superseded_by = CHG-951\` 仍在）`
          + ` ⇒ S-2（**反向**）**必红**且**点名两个 id**：${hit.slice(0, 110)}`
          + '；**反面**：写回 `CHG-951.supersedes = CHG-950` ⇒ 回到基线全绿（⛔ 不是恒红）')
      }

      // ── N-3 自指：A.supersedes = [A] ⇒ 必红，点名该 id ──
      {
        /**
         * ⚠ 用 `req` 造自指：证明**自指也是全 kind** 生效。
         * ⚠ 且**双向都写上**（`superseded_by` 也指向自己）——
         *   这样"双向一致性"那一面是**对上的** ⇒ 红的只可能是自指那一条
         *   （否则这条对拍证明不了 S-3 存在，只证明了 S-1 在响）。
         */
        const mut = [...baseSup(), { id: 'R-952', kind: 'req', status: 'agreed', parent: 'spec/progress',
          after: [], supersedes: 'R-952', superseded_by: 'R-952' }]
        const r = supersedeBilateralProblems(mut)
        const reallyBroken = mut.find((u) => u.id === 'R-952').supersedes === 'R-952'
        const hit = r.s3.find((x) => x.includes('R-952'))
        if (!reallyBroken) bad('N-3 · 夹具没造出"自指"形态 ⇒ 本条不可判')
        else if (hit === undefined) bad('N-3 · `R-952.supersedes = R-952` 却绿灯 ⇒ S-3（自指）哑了')
        else if (r.s1.length !== 0 || r.s2.length !== 0) bad(`N-3 · 自指却连带报了单边（s1=${r.s1.length} s2=${r.s2.length}）⇒ 夹具不干净，红的不是自指那条`)
        else ok(`N-3 ✓ 负向对拍（先自证：基线全绿；再补一条 \`R-952\` 的 \`supersedes\` 与 \`superseded_by\` **都指向自己** ⇒ 双向"对上了"、只剩自指）`
          + ` ⇒ S-3（**自指**）**必红**且点名该 id：${hit.slice(0, 100)}`
          + '；**反面**：清空那两个字段 ⇒ 回到基线全绿（⛔ 不是恒红）')
      }
    }

    /**
     * ── N-S0：0 条关系 ⇒ 必须走 `⊘` 那一行、且**不计入通过**（§一第 3 件）──
     * ⚠ **影子 sink**（照 `N-GC0` 的改法）：调主流程**同一段** `reportSupersedeLayer`，
     *   但计数落在局部变量 ⇒ ⛔ 不污染真实 `pass` / `skip`。
     */
    {
      const zeroRel = [
        { id: 'R-960', kind: 'req', status: 'agreed', parent: 'spec/progress', after: [] },
        { id: 'CHG-960', kind: 'change', status: 'settled', parent: 'spec/progress', after: [] },
      ]
      const r = supersedeBilateralProblems(zeroRel)
      const reallyZero = r.relations === 0
      const shadow = { pass: 0, fail: 0, skip: [] }
      const sink = {
        ok: () => { shadow.pass++ },
        bad: () => { shadow.fail++ },
        noteSkip: (m) => { shadow.skip.push(m) },
      }
      const bucket = reportSupersedeLayer(r, sink)
      /** 反面：补一条合法关系 ⇒ 必须离开 `skip`、进 `checked` 且三条全绿。 */
      const withRel = [...zeroRel,
        { id: 'R-961', kind: 'req', status: 'dropped', parent: 'spec/progress', after: [], superseded_by: 'R-960' },
      ].map((u) => (u.id === 'R-960' ? { ...u, supersedes: 'R-961' } : u))
      const r2 = supersedeBilateralProblems(withRel)
      const shadow2 = { pass: 0, fail: 0, skip: [] }
      const bucket2 = reportSupersedeLayer(r2, {
        ok: () => { shadow2.pass++ },
        bad: () => { shadow2.fail++ },
        noteSkip: (m) => { shadow2.skip.push(m) },
      })
      /** ⚠ 语义判（与 B 轨 `N-GC0` 同口径，`VERDICT-B1.md` §2.1 已裁定按语义）：摘掉否定式后再查。 */
      const lineHasPass = SUPERSEDE_NOT_LANDED.replace('这不是通过', '').includes('通过')
      if (!reallyZero) {
        bad('N-S0 · 夹具没造出"0 条关系"的形态 ⇒ 本条不可判')
      } else if (bucket !== 'skip') {
        bad(`N-S0 · 0 条关系时**没走 skip 档**（实测 ${bucket}）⇒ 档位判定哑了`)
      } else if (shadow.pass !== 0) {
        bad(`N-S0 · 0 条关系时**计入了通过**（pass +${shadow.pass}）⇒ "没判"被洗成"判过了"`)
      } else if (shadow.skip.length !== 1) {
        bad(`N-S0 · 0 条关系时**没有计入跳过**（skip ${shadow.skip.length} 条，期望 1）⇒ 那个档位没有落点`)
      } else if (shadow.skip[0] !== SUPERSEDE_NOT_LANDED) {
        bad(`N-S0 · 跳过那一行**不是约定的原文**：${JSON.stringify(shadow.skip[0])}`)
      } else if (lineHasPass) {
        bad('N-S0 · 那一行里出现了"通过"字样（非否定式）⇒ 读者会把它当成通过')
      } else if (bucket2 !== 'checked' || shadow2.pass !== 3 || shadow2.fail !== 0 || shadow2.skip.length !== 0) {
        bad(`N-S0 · 反面不成立：补一条合法关系后应当 checked + 三条全绿，实测 `
          + `bucket=${bucket2} pass=${shadow2.pass} fail=${shadow2.fail} skip=${shadow2.skip.length}`)
      } else {
        ok('N-S0 ✓ 负向对拍（先自证：夹具 \`supersedes\`/\`superseded_by\` 合计 0 条非空；影子 sink 不污染真实计数）'
          + ' ⇒ 走 `⊘` 单列档：**pass +0**（⛔ 不计入通过）· **skip +1**（有自己的落点）'
          + `，且那行里**没有非否定式的"通过"** —— 原文：${SUPERSEDE_NOT_LANDED}`
          + '；**反面**：补一条合法关系 ⇒ 进 `checked` 档且 S-1/S-2/S-3 三条全绿（⛔ 不是恒跳过）')
      }
    }
  }

  console.log('')
  console.log(`K 组：通过 ${pass} · 失败 ${fail}`)
  console.log(`处级口径：查了 ${pass + fail + skip.length} 处 · 过了 ${pass} 处${fail > 0 ? ` · 没过 ${fail} 处` : ''} · **跳过 ${skip.length} 处**（⚠ 跳过**不计入通过**；⚠ "查了"含跳过，故 查了 = 过了 + 没过 + 跳过）`)
  process.exit(fail === 0 ? 0 : 1)
} catch (e) {
  bad(`K 组**自身异常**（⛔ 不算通过）：${String(e?.stack ?? e)}`)
  console.log(`K 组：通过 ${pass} · 失败 ${fail}`)
  console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处 · **跳过 ${skip.length} 处**`)
  process.exit(1)
}
