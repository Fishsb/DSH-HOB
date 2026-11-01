#!/usr/bin/env node
/**
 * **生成器**：`ledger-next/units/index.toml` ⇒ `ledger-next/gen/stages.md` + `ledger-next/gen/index.md`
 * （2026-10-30 · P1 · `DESIGN-V2.md` §四 / §八 M2）。
 *
 * ══ 三条硬要求 ═══════════════════════════════════════════════════════════════════
 *   ① **确定性**：同样的输入两次跑，输出**逐字节相同**。
 *      ⚠ 所以⛔ **不写时间戳、不写"生成于…"**、不遍历 `Object.keys` 之外的顺序 —— 一律按索引里的声明顺序。
 *   ② **纯函数化**：`render()` 只吃字符串、只吐字符串（`check-ledger-next.mjs` 的 I2 直接调它，
 *      不需要落地文件就能验"改一条 status ⇒ 阶段跟着变"）。
 *   ③ **⛔ 零第三方依赖**：TOML 只用一个**受限子集解析器**（见 `parseTomlSubset`）——
 *      只认本索引用到的那几种写法；⛔ 不假装支持完整 TOML（那会是一个假的保证）。
 *
 * 用法：node scripts/gen-ledger.mjs            （写文件）
 *       node scripts/gen-ledger.mjs --stdout   （只打印，不写）
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ledgerHomeOf, resolveLedgerRoot } from './lib/ledger-root.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const ROOT = join(here, '..')

/**
 * ⚠⚠ **2026-10-30 P4：`ledger-next/` 已搬进账本区**（Hob 只能写账本区 ⇒ 索引必须住那儿）。
 *   解析走**脚本侧唯一实现** `scripts/lib/ledger-root.mjs`（⛔ 不在这里再拼一套）。
 *   ⚠ 判不出账本根 ⇒ **抛错**（⛔ 不落回工作区根 —— 那会两处真相）。
 *
 * @returns 账本区里 `ledger-next/` 的绝对路径
 */
export function resolveLedgerNextDir() {
  // ⚠ 签名是 `(root, cliLedger, homeOverride)` —— 顺序错会把工作区根当 cliLedger。
  const ledgerRoot = resolveLedgerRoot(ROOT, undefined, ledgerHomeOf(ROOT))
  if (ledgerRoot === undefined || ledgerRoot === '') {
    throw new Error('账本根判不出 ⇒ 不知道 ledger-next/ 在哪（⛔ 不猜、⛔ 不回退到工作区根）')
  }
  return join(ledgerRoot, 'ledger-next')
}

export const LEDGER_DIR = resolveLedgerNextDir()

/**
 * ⚠ **共享收敛判定**（2026-10-31 P42b/R4b · `TASK-R4b.md` §一.4）。
 *   唯一实现在 `src/shared/convergence.ts`；本文件**不重写**它（⛔ 两处真相会漂）。
 *   ⚠ 用 `pathToFileURL` 载 `.ts`：与 `check:stages-route` 同一套办法
 *     （Node 22 内置类型剥离），⛔ 不引入构建步骤。
 *   ⚠ 顶层 await 在本文件可用（ESM）；失败时**不抛**，让 `convergence` 保持 `undefined`
 *     ⇒ `checkpoint` 会写「判不出（未注入收敛判定）」，⛔ 不静默给假读数。
 */
let convergenceOfShared
try {
  const convUrl = new URL('../src/shared/convergence.ts', import.meta.url)
  convergenceOfShared = (await import(convUrl.href)).convergenceOf
} catch { convergenceOfShared = undefined }

/**
 * ⚠ **组合层**（2026-11-01 P40/R6 · `TASK-R6.md` §2.1）：唯一实现在
 *   `src/shared/portfolio.ts`；本文件**不重写**它（⛔ 两处真相会漂）。
 *   同一份实现还被 `src/shared/stages-index.ts`（浏览器半边）调用 —— 一份实现，两个消费者。
 *   ⚠ 载入失败 ⇒ `undefined`，`spec/portfolio.md` 照实写「判不出」，⛔ 不静默当 0 条。
 */
let portfolioOfShared
try {
  const portUrl = new URL('../src/shared/portfolio.ts', import.meta.url)
  portfolioOfShared = (await import(portUrl.href)).portfolioOf
} catch { portfolioOfShared = undefined }
export const INDEX_PATH = join(LEDGER_DIR, 'units', 'index.toml')
export const GEN_DIR = join(LEDGER_DIR, 'gen')

/**
 * 封闭状态集（`DESIGN-V2.md` §3.3）—— ⚠ 唯一真源，⛔ 不许在别处再列一遍。
 * `init` = 初始态（"一条非初始态都没有" ⇒ 步显示「未开始」）；`final` = 终态。
 */
/**
 * ══ **`parent` 与 `after` 的语义，写死一次**（2026-11-01 P40/R8 · `TASK-R8.md` §一）════
 *
 * ⚠⚠ **本批为这一件事判错了两次**，两次都是同一个病：把 `after`（等它）当成 `parent`（属于它）。
 *
 * | 字段 | 语义 | 一句话 |
 * |---|---|---|
 * | `parent` | **归属**：这条单元属于谁 | 「它属于我」⇒ **承接**关系 |
 * | `after`  | **前置**：开工前必须等谁 | 「我在等它」⇒ ⛔ **不是承接** |
 *
 * ── 两次判错的具体形态（⚠ 别只写"两者不同"——那等于没说）──────────────
 *   ① **R6 的孤儿口径**：`TASK-R6.md` §2.1 把孤儿定成"`agreed` · 无 change 承接 · 无 pass 验收"，
 *      **漏了"有没有 task 在管它"**。而"task 在管它"只能看 `parent`（`task.parent === req.id`），
 *      ⛔ 看 `after` 是看不到的。⇒ 结果：`R-002`/`R-003`/`R-004`（各有一条 `built` 的 task）
 *      被写成「没人做」，而它们真正的名字是「**活做完了，没人验收**」。
 *
 *   ② **`REVIEW-R6.md` §三 与 `TASK-R7.md` §一**：两份文件都说「`R-008` 底下有 `TSK-048`」，
 *      据此断定它"有人在管、不是孤儿"。**实际账本里是**：
 *          `TSK-048.parent = "CHG-2026-10-31-tool-policy"`   ← 它属于那条 **change**
 *          `TSK-048.after  = ["R-008"]`                      ← 它**在等** R-008
 *      ⇒ `R-008` 底下 **task 0 条**，它是孤儿。⚠ 这条错在验收方（Hob）自己，R7 用生成物的
 *        覆盖表读数把它核了出来（`R-008` 那行 `task 条数 = 0`）。
 *
 * ── ⚠ 混用会错成什么样（一句话）──────────────────────────────────────
 *   把「在等它」读成「属于它」⇒ **"有人在管"这句话会失真**：一条根本没人接的需求，
 *   只要被某条无关 task 的 `after` 提了一下，就会被当成"已经有人管了"。
 *
 * ── ⚠ 为什么这里只是"写死语义"而不是"禁止重合"──────────────────────
 *   见 `check-ledger-next.mjs` 的 `checkA1`：**`after` 与 `parent` 重合是合法的、而且是常态**
 *   （task 属于它的 change，同时要等那条 change 先落；run 属于它的 task，同时要等那条 task 先跑完）。
 *   ⇒ 真正要防的不是"重合"，而是"**只有 `after` 没有 `parent`**"那种误用。
 */
/**
 * ⭐ **`evidence.parent` 允许指哪些 kind**（2026-11-01 P40/R8 · `TASK-R8.md` §四 · 只写这一处）。
 *
 * ── 为什么允许 5 类、而不是只允许 `task` ────────────────────────────
 *   证据是**一条读数**：它可以是"某个任务的收口读数"，也可以是"某条决策的依据"。
 *   硬要它只挂 `task`，会逼人把决策依据挂到一条**无关 task** 上 —— 那才是假话。
 *   （本轮 `EVD-030/031/032` 就是 `DEC-001` 的依据，挂 task 无处可挂。）
 *
 * ── ⛔ 为什么**不许**挂 `req`（这条是本节的重点）─────────────────────
 *   需求的证据必须**经 `acc`**（五步的第 5 步）。绕过验收直接给需求挂证据，
 *   等于**自证**：需求自己声明"我有证据"，而没有任何人验过。
 *   ⇒ 正确的路已经存在：`acc.basis` 指向 `EVD-`，那条路才让"证据"与"判决"分开。
 *
 * ⚠ 判据在 `check-ledger-next.mjs` 的 **A-2**（读本常量，⛔ 不另写一份清单）。
 */
export const EVIDENCE_PARENT_KINDS = ['task', 'change', 'decision', 'risk', 'cap']

export const PARENT_VS_AFTER = {
  parent: '归属：这条单元属于谁（承接关系）',
  after: '前置：开工前必须等谁（⛔ 不是承接）',
}

export const KIND_SPEC = {
  req: { step: 1, statuses: ['draft', 'agreed', 'dropped'], init: 'draft', finals: ['agreed', 'dropped'], prefix: 'R-' },
  /**
   * ⚠⚠ **2026-10-31 P41/R3：`change` 的「聚合态」（`TASK-R3.md` §三）──────────────
   *
   * ── 与 `status` 的关系（⚠ 必须写清，否则会被当成第十种 status）────────────
   *   `status`（`proposed`/`settled`/`superseded`）是**人填的**：这条方案本身处在哪个阶段。
   *   **聚合态**是**算出来的**：把这条 change 下面的 task / acc / risk / decision 汇总一遍，
   *   得出"它到底收口了没有"。⇒ 它 **⛔ 不进 `statuses` 封闭集**（进了就变成人能手填的值），
   *   也 ⛔ 不许让 I1 把它当 status 核（I1 只核 `status` 字段）。
   *
   * ── 取值（⚠ 封闭集，只有这三种）──────────────────────────────────
   *   `converged`        —— K-1..K-6 全绿；
   *   `not-converged`    —— 有阻断项（**必须同时给出 `blocked_by`**）；
   *   `undecidable`      —— 判不出（没有 task / 没有 acc / 引用悬空）。
   *   ⚠ **⛔ 没有"进行中"这一档**：聚合态回答的是"收没收口"，不是"做了几成"——
   *     后者是五步的 `完成数/总数` 在答的，⛔ 不要在这里再答一遍。
   */
  change: { step: 2, statuses: ['proposed', 'settled', 'superseded'], init: 'proposed', finals: ['settled', 'superseded'], prefix: 'CHG-' },
  task: { step: 3, statuses: ['todo', 'doing', 'built'], init: 'todo', finals: ['built'], prefix: 'TSK-' },
  run: { step: 4, statuses: ['registered', 'running', 'returned', 'refused', 'stuck'], init: 'registered', finals: ['returned', 'refused', 'stuck'], prefix: 'RUN-' },
  acc: { step: 5, statuses: ['pass', 'send-back', 'unverified'], init: 'unverified', finals: ['pass', 'send-back'], prefix: 'ACC-' },
  /** ⚠ `cap` **不进任何一步**（`step: null`），且**无终态**。 */
  cap: { step: null, statuses: ['live', 'degraded', 'down'], init: 'live', finals: [], prefix: 'CAP-' },
  /**
   * ══ 2026-10-31 P40/R2 · 三个**受控对象**入库（`TASK-R2.md` §二）════════════════
   *
   * ⚠⚠ **它们不占五步**：`step: null`，⛔ 不进任何一步的「完成数 / 总数」分母
   *   （`cap` 已是这个先例）。理由：风险、决策、证据都**没有"做完"这回事** ——
   *   一条风险是**开着还是已处置**，一条决策是**有效还是已被取代**，一条证据是**一条读数**。
   *   ⛔ 给它们套"做完/没做完"会让五步的分母虚增，也会诱导人把"记了一条风险"当成"解决了风险"。
   *
   * ⚠ 前缀是**硬约束**（`TASK-R2.md` §二）：
   *   · `risk` → **`RSK-`** —— ⚠ **`R-` 已被 `req` 占用**，用 `R-` 会与需求撞名（实测撞法：`R-001`）；
   *   · `decision` → `DEC-`；· `evidence` → `EVD-`。
   *
   * ⚠ 状态是**封闭集**，且**只写在这里一处**（⛔ 不许在 check 脚本里再列一遍 —— 两处真相会漂）。
   *   `finals: []` 对三者都成立：它们**无终态**（同 `cap`）。
   *   · `risk` 的 `open`/`handling`/`closed` 是**处置进度**，⛔ 不是"完成度"；
   *   · `decision` 的 `active`/`superseded` 由 I8 双向咬住（单边声明 ⇒ 红）；
   *   · `evidence` 的 `recorded` 是唯一态 —— 一条读数记下来就是记下来了，没有"进行中的读数"。
   */
  risk: { step: null, statuses: ['open', 'handling', 'closed'], init: 'open', finals: [], prefix: 'RSK-' },

  /**
   * ⚠⚠ **待补（`TASK-R2.md` §七 · 本轮明确不做）─────────────────────────────
   *   `risk` **对象**入库了，而它的**前门** `risk-report`（输入入口）⛔ **本轮不加**。
   *
   *   ── 为什么不加（理由已定，⛔ 不要顺手补）──────────────────────────
   *     新增入口必须能**指回用户原话**（`check:workflow` 的 F1/F4 都咬这一点），
   *     而 `spec/origin-user-2026-10-31.txt` 是 **R1 的冻结件，⛔ 不许编辑**，
   *     它里面**没有**可冻的 `risk-report` 逐字原话。
   *   ⇒ 两个选择都不许做：① 改冻结件（越界）；② **替用户编一句他没说过的话**
   *     （那会把"我的转述"洗成"用户原话" —— 本仓最忌的形态，比缺失坏得多）。
   *
   *   ⇒ 所以：**对象先有，前门待补**。等用户**亲口**说过一段可作 `risk-report` 的
   *     逐字原话，再新建一份冻结件（⛔ 不许改 10-31 那份）+ 同批加 `[[intake]]`。
   *   ⚠ 这条**必须留在代码里**：只写在报告里，下一轮的人看不见。
   */
  decision: { step: null, statuses: ['active', 'superseded'], init: 'active', finals: [], prefix: 'DEC-' },
  evidence: { step: null, statuses: ['recorded'], init: 'recorded', finals: [], prefix: 'EVD-' },
  /**
   * ══ 2026-11-02 P50/B1 · **`goal` 成为第 10 个 kind**（`TASK-B1.md` §一第 1 件）══════════
   *
   * ── 它治什么 ────────────────────────────────────────────────────────
   *   账本链条的顶端此前**直接是 `req`** —— 没有目标层。用户方案的主链是
   *   `Vision → Goal → Requirement → Change → Task → Run → Acceptance`，
   *   而「每条活跃需求**恰好一个主目标**」是要被机检的三条读数（见 `check-ledger-next.mjs`
   *   的 `GC-1` / `GC-2` / `GC-3`）。
   *
   * ── ⚠ 为什么 `step: null`（与 `cap` / `risk` 同档）──────────────────────
   *   目标是**链顶**，不是流程里的一步：它回答"要做成什么"，⛔ 不回答"走到第几步"。
   *   ⇒ ⛔ 不进五步分母。⚠ 若它占了分母，五步计数会从 `8/3/30/28` 变成别的数 ——
   *     那是**读数被机制改坏**，不是进展。
   *
   * ── 状态封闭集（三档，⚠ 只写在这里一处）──────────────────────────────
   *   · `active`  —— 正在追这个成果（`init`）；
   *   · `done`    —— 成果已达成（终态）；
   *   · `retired` —— 不追了（终态；⛔ 不是"失败"，是"不再是要做的事"）。
   *   `finals: ['done', 'retired']` ⇒ 有终态（与 `cap` / `risk` 的 `finals: []` 不同：
   *   那两类没有"做完"这回事，而一个成果**是能达成的**）。
   *
   * ── ⚠ 前缀 `G-`，且**没有 parent / after 语义** ──────────────────────────
   *   它是链顶 ⇒ 没有上游。⚠ `after` 仍是 I1 的通用必填（数组，可为空），
   *   ⛔ 但不许拿它编"目标之间的先后"（那会造出一条没有依据的甘特线）。
   *   ⚠ 必填的 `req_ids`（承接哪些需求）由 `check-ledger-next.mjs` 的
   *   `REQUIRED_FIELDS` 之外的**覆盖检查**核（理由见那里的注释：避免同一条缺口红两次）。
   */
  goal: { step: null, statuses: ['active', 'done', 'retired'], init: 'active', finals: ['done', 'retired'], prefix: 'G-' },
}

/**
 * ⭐ **受控对象的必填字段**（2026-10-31 P40/R2 · `TASK-R2.md` §二）
 *
 * ⚠⚠ **为什么放在这里而不是 `check-ledger-next.mjs`**：本表是"这三类各要哪些字段"的
 *   **唯一定义处**；判据（I1）从这里读。⛔ 在两处各列一遍 = 两处真相，改一处另一处静默过期。
 *   （既有五类的必填仍在 `check-ledger-next.mjs` 的 `REQUIRED_FIELDS` —— 那是 R2 之前就有的，
 *    本轮**不搬**它，⛔ 避免顺手重构；新增的这三类按任务书要求收在同一处。）
 *
 * ⚠ **语义**（判据按这个核，⛔ 不是"有字段就算"）：
 *   · `risk`：这条风险**是什么**（`title`）· **影响哪些单元**（`affects`，引用）·
 *     **当前处置**（`disposition`）· **谁在盯**（`owner`）· **还开着没有**（`status`）。
 *   · `decision`：**决定了什么**（`title`）· **取代了谁**（`supersedes`）·
 *     **被谁取代**（`superseded_by`）· **依据哪几条读数**（`basis_readings`）。
 *     ⚠ `supersedes` / `superseded_by` **允许为空**（首条决策没有前身）；但**非空时**必须双向对上（I8）。
 *   · `evidence`：读数**原文**（`reading`）· **取自何时**（`taken_at`）·
 *     **对应哪个代码态**（`code_state`，commit / 构建戳 / 或明确写「判不出」）。
 */
export const CONTROLLED_FIELDS = {
  risk: ['affects', 'disposition', 'owner'],
  decision: ['basis_readings'],
  evidence: ['reading', 'taken_at', 'code_state'],
}

/**
 * ⭐ **五类既有单元的新增字段**（2026-10-31 P40/R2 · `TASK-R2.md` §三）
 *
 * ⚠ 与上面那张表分开写，是因为它们的**强制性按状态生效**（见 `check-ledger-next.mjs` 的
 *   `CONDITIONAL_FIELDS`）：`built` 才要 `verify_refs`，`agreed` 才要 `acceptance_ids` …
 *   ⛔ 对未开工的活要求结果 = 逼人编结果（`todo` 豁免是既有先例）。
 * ⚠ 本表只描述"有哪些新字段、语义是什么"，**不描述何时强制**（那是判据的事）。
 */
/**
 * ⭐ **退回目标**（2026-10-31 P42/R4 · `TASK-R4.md` §二）。
 *
 * ── 为什么需要它 ─────────────────────────────────────────────────────
 *   `acc.status = send-back` 只说"不行"，⛔ **没说退回到哪一步**。而"重做"这个词
 *   盖住了三种完全不同的处置：
 *     · 实现没做到       ⇒ 退回**任务**，实施会话改；
 *     · 方案本身不成立   ⇒ 退回**方案**，Hob 重出；
 *     · 需求本身错了/没说清 ⇒ 退回**需求**，⚠ 这一步**只有用户能裁**。
 *   ⛔ 不分类的后果：把"需求错了"当成"实现错了"，会让实施会话**反复重做一件本来就不该做的事**。
 *
 * ⚠ 封闭集**只在这里写一次**（⛔ 判据脚本里不许再列一遍 —— 两处真相会漂）。
 * ⚠⚠ `send_back_to` **只在 `status = send-back` 时必填**；`pass` 却填了它 ⇒ 自相矛盾 ⇒ 红。
 *   ⚠ 判决的唯一落点是 `status`（2026-11-01 R5b 裁定 A：`outcome` 已删）。
 *   （判据在 `check-ledger-next.mjs` 的 `checkB1`/`checkB2`。）
 */
export const SEND_BACK_TARGETS = ['back-to-task', 'back-to-plan', 'back-to-requirement']

/** 每个退回目标**谁去做**（⚠ 与上面同一张表的两列，⛔ 不另开一处真相）。 */
export const SEND_BACK_ACTOR = {
  'back-to-task': '实施会话（实现没做到）',
  'back-to-plan': 'Hob 重出方案（方案本身不成立）',
  'back-to-requirement': '用户（需求本身错了 / 没说清）',
}

export const EXTENDED_FIELDS = {
  req: { acceptance_ids: '哪几条验收证明这条需求', risk_ids: '涉及哪几条风险', priority: '优先级' },
  change: { addresses: '满足哪几条需求', decisions: '依哪几条决策', supersedes: '取代哪条旧方案', risk_ids: '涉及哪几条风险' },
  task: { verify_refs: '该由哪几条证据证明', scope_paths: '允许改的路径', budget: '预算（几条调用 / 几轮）' },
  run: { delivered_at: '投递时刻（不变量 1 的落点）', report: '回传件在哪', evidence_refs: '产出了哪几条证据' },
  /**
   * ⚠⚠ **`acc` 没有 `outcome` 字段**（2026-11-01 P40/R5b · `TASK-R5b.md` §一 裁定走 A）。
   *   判决的**唯一落点**是 `KIND_SPEC.acc.statuses`（`['pass','send-back','unverified']`）——
   *   `outcome` 的取值与它**完全相同**，那就是同一个事实的两个落点，正是本仓一直在治的病。
   *   ⛔ **不许再加回任何同义字段**（`verdict` / `result` / `decision` 一律不许）：
   *     判据 `S-1` 逐条咬这一点，出现即红。
   *   ⚠ 为什么不是"保留 + 回填"：回填等于把空字段填成它旁边那个字段已有的值，
   *     填完仍然是两个落点，只是两个都非空 —— 下次谁改一个忘另一个，仍然会漂。
   */
  acc: { basis: '依据哪几条证据（引用 EVD-，⛔ 不是自由文本）', verified_at: '判决时刻', send_back_to: '退回目标（⛔ 只在 `status=send-back` 时必填；封闭三值）' },
}

/**
 * ⭐ **`req.priority` 的封闭集**（2026-11-01 P40/R5 · `TASK-R5.md` §五 F-1）
 *
 * ⚠⚠ **只写在这里一处**（⛔ 判据脚本里不许再列一遍 —— 两处真相会漂，`TASK-R5.md` §五 点名要求）。
 *   判据（`check-ledger-next.mjs` 的 `checkF1`）从这里读。
 * ⚠ 语义：`must` = 不做就不成立 · `should` = 该做 · `could` = 有余力才做。
 *   ⛔ 它不是"完成度"，⛔ 不许派生百分比。
 */
export const REQ_PRIORITIES = ['must', 'should', 'could']

/**
 * ⭐ **`task.budget` 的两项**（2026-11-01 P40/R5 · `TASK-R5.md` §五 F-3）
 *
 * ⚠⚠ **为什么是"一个字符串"而不是 TOML 内联表**：
 *   本仓 TOML 只有**受限子集解析器**（`parseTomlSubset`，头注释明写 ⛔ 不假装支持完整 TOML），
 *   它只认 `"字符串"` 与 `["数组"]`。⇒ 为了 `budget` 去扩语法，会把"受限子集"这个**真保证**
 *   变成假的（那正是本仓最忌的形态：写了一个看起来支持、实际只覆盖用到的那几种的解析器）。
 *   ⇒ `budget` 落成字符串，形如 `tool_calls=12 · rounds=3`，判据按下面两个键名解析。
 * ⚠ 两项都必须是**正整数**（⛔ 缺一即红；⛔ 0 或负数不是"预算"）。
 */
export const BUDGET_KEYS = ['tool_calls', 'rounds']

/**
 * ⭐ **`change` 的聚合态**（2026-10-31 P41/R3 · `TASK_R3.md` §三）。
 *
 * ⚠ 封闭集**只在这里写一次**（⛔ 判据脚本里不许再列一遍 —— 两处真相会漂）。
 * ⚠ 这是**算出来的**值，⛔ 不是 `status`、⛔ 不进 `KIND_SPEC.change.statuses`。
 */
export const CHANGE_AGGREGATE = ['converged', 'not-converged', 'undecidable']

/**
 * ⭐ **`blocked_by` 的形状**（`TASK-R3.md` §三）。
 *
 * ⚠⚠ **必须是结构化的**，⛔ 不许写成自由文本 —— 理由（作业书原话）：
 *   "那没法逐轮比对阻断项是变多还是变少"。自由文本每轮措辞都会变，
 *   diff 出来全是噪声，于是"阻断项在减少"这件事**永远判不出**。
 *
 * 每项 = `{ rule, unit, why }`：
 *   · `rule` —— 判据编号（`K-1`…`K-6` / `G-1`…`G-4`），⚠ 必须能一眼看出是哪条判据拦的；
 *   · `unit` —— 被卡住/肇事的单元 id；
 *   · `why`  —— 一句话原因。
 *
 * ⚠ **有序**（`TASK-R3.md` §三 明写"一个**有序**列表"）：同一组输入必须产出同一顺序，
 *   ⛔ 不许用 `Set`/对象键序那种"看起来稳定、换引擎就变"的顺序。
 */
export const BLOCKED_BY_SHAPE = { rule: 'string', unit: 'string', why: 'string' }

/** 五步的名字（渲染顺序）。 */
export const STEP_NAMES = ['需求规格', '实现方案', '编码任务', '任务执行', '验收核对']

/** 三态图标（照 SDD Dashboard 的 `circle / play / check`；⛔ 无百分比）。 */
export const STAGE_ICON = { notStarted: '○', doing: '▶', done: '✓' }

/**
 * **受限 TOML 子集解析器**。
 *
 * 只认本仓 `units/index.toml` 用到的那几种写法：
 *   · `[[unit]]` 数组表；
 *   · `key = "字符串"`；
 *   · `key = ["a", "b"]`（字符串数组，可跨行）；
 *   · `#` 行注释、空行。
 * ⚠ 遇到不认识的写法 ⇒ **抛错**（⛔ 静默忽略 —— 那会让"写错了"表现为"少了一条"，正是本仓最忌的形态）。
 *
 * @param {string} src - 文件全文
 * @returns {{ unit: Array<Record<string, string|string[]>> }} 解析结果
 */
export function parseTomlSubset(src) {
  const out = { unit: [] }
  let cur = null
  /** 正在读的多行数组的累积缓冲。 */
  let pendingKey = null
  let pendingBuf = ''

  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue

    if (line === '[[unit]]') {
      cur = {}
      out.unit.push(cur)
      continue
    }
    if (line.startsWith('[')) {
      throw new Error(`第 ${i + 1} 行：不支持的 TOML 表头 ${JSON.stringify(line)}（本解析器只认 [[unit]]）`)
    }
    if (cur === null) throw new Error(`第 ${i + 1} 行：键出现在 [[unit]] 之前：${JSON.stringify(line)}`)

    // 多行数组续读
    if (pendingKey !== null) {
      pendingBuf += ' ' + line
      if (line.includes(']')) {
        cur[pendingKey] = parseArray(pendingBuf, i + 1)
        pendingKey = null
        pendingBuf = ''
      }
      continue
    }

    const eq = line.indexOf('=')
    if (eq < 0) throw new Error(`第 ${i + 1} 行：不是 key = value：${JSON.stringify(line)}`)
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()

    if (val.startsWith('[') && !val.includes(']')) {
      pendingKey = key
      pendingBuf = val
      continue
    }
    if (val.startsWith('"')) {
      cur[key] = parseString(val, i + 1)
    } else if (val.startsWith('[')) {
      cur[key] = parseArray(val, i + 1)
    } else {
      throw new Error(`第 ${i + 1} 行：只支持 "字符串" 与 ["数组"]，实际 ${JSON.stringify(val)}`)
    }
  }
  if (pendingKey !== null) throw new Error(`文件末尾有多行数组没有闭合：${pendingKey}`)
  return out
}

function parseString(v, lineNo) {
  const m = /^"((?:[^"\\]|\\.)*)"\s*$/.exec(v)
  if (m === null) throw new Error(`第 ${lineNo} 行：字符串格式不对：${JSON.stringify(v)}`)
  return m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

function parseArray(v, lineNo) {
  const m = /^\[(.*)\]\s*$/s.exec(v)
  if (m === null) throw new Error(`第 ${lineNo} 行：数组格式不对：${JSON.stringify(v)}`)
  const body = m[1].trim()
  if (body === '') return []
  const items = []
  const re = /"((?:[^"\\]|\\.)*)"\s*(?:,|$)/g
  let hit
  let consumed = 0
  while ((hit = re.exec(body)) !== null) {
    items.push(hit[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'))
    consumed = re.lastIndex
  }
  // ⚠ 检查"除了空白与逗号，没剩下别的东西" —— 否则会被静默吞掉
  if (body.slice(consumed).replace(/[,\s]/g, '') !== '') {
    throw new Error(`第 ${lineNo} 行：数组里有解析不了的内容：${JSON.stringify(body.slice(consumed))}`)
  }
  return items
}

/**
 * 汇总某一步的三态 + `完成数/总数`。
 *
 * ⚠ 规则（`DESIGN-V2.md` §四，逐条照做）：
 *   · 一条都没有，或全是初始态 ⇒ `notStarted`；
 *   · 有非初始态、但未全部到终态 ⇒ `doing`；
 *   · 全部到终态 ⇒ `done`。
 *
 * @param {Array<object>} units - 该步的单元（⚠ 调用方已按 kind 过滤）
 * @param {object} spec - {@link KIND_SPEC} 里该 kind 的条目
 * @returns {{ state: 'notStarted'|'doing'|'done', finals: number, total: number }}
 */
export function summarizeStep(units, spec) {
  const total = units.length
  const finals = units.filter((u) => spec.finals.includes(u.status)).length
  if (total === 0) return { state: 'notStarted', finals: 0, total: 0 }
  const nonInit = units.filter((u) => u.status !== spec.init).length
  if (nonInit === 0) return { state: 'notStarted', finals, total }
  if (finals === total) return { state: 'done', finals, total }
  return { state: 'doing', finals, total }
}

/**
 * 生成 `gen/stages.md`。
 *
 * ⚠ **纯函数**：只吃 `units` 数组，只吐字符串。⛔ 不读盘、⛔ 不取当前时间
 * （确定性要求：同输入两次跑必须逐字节相同）。
 *
 * @param {Array<Record<string, any>>} units - 索引里的全部单元
 * @returns {string} markdown 全文
 */
export function renderStages(units) {
  const lines = []
  lines.push('# 五步阶段（**生成物** · ⛔ 手改即红）')
  lines.push('')
  lines.push('> 由 `npm run gen:ledger` 从 `units/index.toml` 算出（依据 `DESIGN-V2.md` §四）。')
  lines.push('> ⚠ ⛔ 不许手改本文件：改索引，再重新生成（`CONSTITUTION` §2 / I5）。')
  lines.push('')
  lines.push('| 步 | 状态 | 完成/总数 | 条目 |')
  lines.push('|---|---|---|---|')
  for (const [kind, spec] of Object.entries(KIND_SPEC)) {
    if (spec.step === null) continue
    const unitsOfStep = units.filter((u) => u.kind === kind)
    const { state, finals, total } = summarizeStep(unitsOfStep, spec)
    const label = state === 'done' ? `${STAGE_ICON.done} 完成`
      : state === 'doing' ? `${STAGE_ICON.doing} 进行中`
        : `${STAGE_ICON.notStarted} 未开始`
    const ids = unitsOfStep.map((u) => String(u.id)).join(' ')
    lines.push(`| ${['①', '②', '③', '④', '⑤'][spec.step - 1]} ${STEP_NAMES[spec.step - 1]} | ${label} | ${finals}/${total} | ${ids === '' ? '—' : ids} |`)
  }
  lines.push('')
  lines.push('## 长期能力（无完成态）')
  lines.push('')
  lines.push('> ⚠ `cap` 单元**不进任何一步的分母**，⛔ 无终态、⛔ 无百分比（`CONSTITUTION` §6 / I4）。')
  lines.push('> 只写**最近一次真实读数 + 时间**；判不出就写「判不出」，⛔ 不许填 0。')
  lines.push('')
  const caps = units.filter((u) => u.kind === 'cap')
  if (caps.length === 0) {
    lines.push('（本索引里没有 `cap` 单元）')
  } else {
    lines.push('| 条目 | 最近一次真实读数 |')
    lines.push('|---|---|')
    for (const c of caps) {
      // ⚠ 缺 `last_reading` ⇒ 明说"判不出"，⛔ 不编
      const reading = typeof c.last_reading === 'string' && c.last_reading.trim() !== ''
        ? c.last_reading
        : '判不出（索引里没有 `last_reading`）'
      lines.push(`| ${c.id} ${c.title ?? ''} | ${reading} |`)
    }
  }
  lines.push('')
  lines.push(...renderWraparound(ROOT))
  return lines.join('\n')
}

/**
 * **「收尾必跑」一节** —— 由 `package.json` 的 `check:*` 族生成（2026-10-30 P6 · B0）。
 *
 * ⚠ 它是**将来 `V` / `N` 删段后的替代**：那两段守的是"同一份族清单抄在 §4.1 / 模板 §4.1"，
 *   而这一节**由 `package.json` 直出** ⇒ 清单不可能与来源漂移。
 * ⚠ 纯函数：只吃 `package.json` 文本，⛔ 不取当前时间。
 *
 * @param {string} root - 工作区根
 * @returns {string[]} markdown 行
 */
export function renderWraparound(root) {
  const lines = []
  lines.push('## 收尾必跑（由 `package.json` 的 `check:*` 直出，⛔ 手改即红）')
  lines.push('')
  let pkg
  try { pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) } catch { pkg = { scripts: {} } }
  const fams = Object.keys(pkg.scripts ?? {}).filter((k) => k.startsWith('check:')).sort()
  if (fams.length === 0) {
    lines.push('（`package.json` 里没有任何 `check:*` 族 —— ⚠ 这本身是个异常，⛔ 不当作"没有要跑的"）')
  } else {
    lines.push(`共 **${fams.length}** 族（⚠ 顺序 = 字典序，⛔ 不是重要性；\`check:build\` 按读数行计，⛔ 不与逐条断言相加）：`)
    lines.push('')
    lines.push('| # | 族 | 命令 |')
    lines.push('|---|---|---|')
    fams.forEach((f, i) => lines.push(`| ${i + 1} | \`${f}\` | \`npm run ${f}\` |`))
  }
  lines.push('')
  return lines
}

/**
 * **§4.1「收尾必跑」生成块** —— 由 `package.json` + `scripts/check-family-catalog.json` 渲染。
 *
 * ── 它替换掉什么（`TASK-P7.md` §一）────────────────────────────────────────
 *   改前：同一份族清单**手抄三处**（`package.json` · 正本 `CONTEXT.md` §4.1 · 模板 §4.1），
 *     由断言 `V`（package.json → 正本）与 `N`（正本 → 模板）两条守着。
 *     ⚠ 而这两处在 P2、P3 **各被咬过一次**（新族加了、§4.1 忘了补）。
 *   ⇒ 现在：族清单**只从 `package.json` 派生**，写进一对标记之间的块；
 *     正本与模板**各一份、内容逐字节相同**（同一个渲染器）。
 *
 * ── 为什么还要 `check-family-catalog.json` ─────────────────────────────
 *   `package.json` 只有命令，**没有"守什么"那句话**。那句是人类文字，必须有个手写落点。
 *   ⇒ 这个 JSON 是**唯一手写源**；⚠ 它只提供说明列，**族清单仍派生自 `package.json`**，
 *     少一族 / 多一族 / 次序不符 ⇒ {@link renderCheckFamiliesBlock} **当场抛错**（⛔ 不静默补/删）。
 *
 * @param {string} root - 工作区根（读 `package.json` 与 catalog）
 * @returns {string} 带 BEGIN/END 标记的整块（含首尾标记行）
 */
export function renderCheckFamiliesBlock(root, flavor = 'canonical') {
  const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'))
  const fams = Object.keys(pkg.scripts ?? {}).filter((k) => k.startsWith('check:')).sort()
  const cat = JSON.parse(readFileSync(`${root}/scripts/check-family-catalog.json`, 'utf8'))
  const self = new Set(cat.self ?? [])
  const rows = cat.rows ?? []
  const byCmd = new Map(rows.map((r) => [r.cmd, r.what]))

  // ⚠ 逐族核对（⚠ 这是 V 组原有的保护，改由生成器承担 —— 少一族/多一族都当场抛错）
  const wantFams = fams.filter((f) => !self.has(f))
  const gotFams = rows.map((r) => r.cmd).filter((c) => c.startsWith('check:') && !self.has(c))
  const missing = wantFams.filter((f) => !byCmd.has(f))
  if (missing.length > 0) {
    throw new Error(`§4.1 生成块：\`package.json\` 里有、而 catalog 里**没有说明**的族：${missing.join(' / ')}`
      + '（⚠ 新增一族必须同批在 scripts/check-family-catalog.json 里补一行「守什么」）')
  }
  const extra = gotFams.filter((f) => !wantFams.includes(f))
  if (extra.length > 0) {
    throw new Error(`§4.1 生成块：catalog 里有、而 \`package.json\` 里**已经没有**的族：${extra.join(' / ')}`
      + '（⚠ 删族必须同批删掉 catalog 里那一行 —— ⛔ 否则是"照着表跑一个不存在的命令"）')
  }

  const out = []
  out.push('<!-- BEGIN gen:check-families -->')
  out.push('<!-- ⚠ 本块由 `npm run gen:ledger` 写入，⛔ 不许手改；族清单派生自 `package.json`，'
    + '「守什么」那列的唯一手写源是 `scripts/check-family-catalog.json` -->')
  out.push('')
  out.push('| 命令 | 守什么 |')
  out.push('|---|---|')
  if (flavor === 'template') {
    /**
     * ⚠⚠ **模板侧为什么不是同一份散文**（2026-10-30 P7 实测冲突）：
     *   正本那列的「守什么」是**本项目的事实**（含"第 4 轮"、本插件名、具体编号 …），
     *   而 `kit/templates/` 是**开箱层** —— `check:gitignore` 的**断言 B** 明令
     *   ⛔ 模板里不许出现本项目专有值（否则新项目开箱即错）。
     *   ⇒ 于是两侧**族清单完全相同**（同一个 `package.json` 派生、同一个渲染器），
     *     但**说明列不同**：正本给本项目的事实，模板给"去本仓 §4.1 看"。
     *   ⚠ 这不是"为了绿而弱化"：模板行**原本就是 `| ... |` 占位**，P7 之前也没有真说明。
     */
    for (const r of rows) out.push(`| \`npm run ${r.cmd}\` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |`)
  } else {
    for (const r of rows) out.push(`| \`npm run ${r.cmd}\` | ${r.what} |`)
  }
  out.push('')
  out.push(`⚠ 本块共 **${rows.filter((r) => r.cmd.startsWith('check:')).length}** 个 \`check:*\` 族`
    + `（另有 \`build\` / \`typecheck\` 两个非判据命令）；`
    + `\`check:all\` 与 \`check:preflight\` 是调度器与体检，⛔ 不入本块（与 \`SELF\` 同口径）。`)
  out.push('<!-- END gen:check-families -->')
  return out.join('\n')
}

/**
 * 把生成块**就地写进**某个文件的标记之间（⚠ 只动标记之间，块外一个字不碰）。
 *
 * @param {string} filePath - 目标文件
 * @param {string} block - {@link renderCheckFamiliesBlock} 的输出
 * @returns {{changed: boolean, why: string}} 是否真的改了
 */
export function writeBlockInto(filePath, block) {
  const BEGIN = '<!-- BEGIN gen:check-families -->'
  const END = '<!-- END gen:check-families -->'
  let src = ''
  try { src = readFileSync(filePath, 'utf8') } catch {
    return { changed: false, why: `读不到：${filePath}` }
  }
  const i = src.indexOf(BEGIN)
  const j = src.indexOf(END)
  if (i < 0 || j < 0) {
    return { changed: false, why: `没有找到标记（BEGIN=${i} / END=${j}）：${filePath}` }
  }
  if (j < i) return { changed: false, why: `标记次序颠倒：${filePath}` }
  const next = src.slice(0, i) + block + src.slice(j + END.length)
  if (next === src) return { changed: false, why: 'already-up-to-date' }
  writeFileSync(filePath, next)
  return { changed: true, why: 'written' }
}

/**
 * **`gen/modules.md`** —— 由 `src/modules/` 目录实测生成（2026-10-30 P6 · B0）。
 *
 * ⚠ 它是**将来 `W` 删段后的替代**：`W` 守的是"`volumes/plan/03` 的模块表行数 = `src/modules/` 文件数"，
 *   而本文件**由目录直出** ⇒ 表不可能与目录漂移。
 * ⚠ 纯函数：吃文件列表，⛔ 不取时间戳、⛔ 不读 mtime。
 *
 * @param {string[]} stems - `src/modules/` 下的文件名主干（不含 `.ts`），调用方已排序
 * @returns {string} markdown 全文
 */
export function renderModules(stems) {
  const lines = []
  lines.push('# 宿主模块（由 `src/modules/` 目录实测生成 · ⛔ 手改即红）')
  lines.push('')
  lines.push('> 由 `npm run gen:ledger` 从目录直出（依据 `DESIGN-V2.md` §七「模块表由目录生成」）。')
  lines.push('> ⚠ ⛔ 不许手改：改了 `src/modules/` 就重跑生成器（`CONSTITUTION` §2 / I5）。')
  lines.push('')
  lines.push(`共 **${stems.length}** 个模块文件：`)
  lines.push('')
  lines.push('| # | 模块文件 |')
  lines.push('|---|---|')
  stems.forEach((s, i) => lines.push(`| ${i + 1} | \`src/modules/${s}.ts\` |`))
  lines.push('')
  lines.push('⚠ 本表只回答"**目录里有哪些文件**"，⛔ 不回答"哪个进 `MODULE_REGISTRY`" —— ')
  lines.push('   后者是代码事实，读 `src/index.ts` / `src/modules/orchestrator.ts`，⛔ 不在这里复写。')
  lines.push('')
  return lines.join('\n')
}

/**
 * **`gen/archive-index.md`** —— 由账本区 `archive/` 目录实测生成（2026-10-30 P6 · B0）。
 *
 * ⚠ 它是**将来 `check:archive` ① 清单部分的替代**：那份清单是手写的，
 *   而本文件**由目录直出** ⇒ 条目不可能与盘上漂移。
 * ⚠⚠ **它不替代 `check:archive` ② （成员完整性核）** —— 那条没有新家。
 * ⚠ 纯函数：吃"归档目录名 + 每目录文件数"的数组，⛔ 不取时间、⛔ 不读 mtime。
 *
 * @param {Array<{name: string, files: string[]}>} dirs - 归档目录（调用方已排序）
 * @returns {string} markdown 全文
 */
export function renderArchiveIndex(dirs) {
  const lines = []
  lines.push('# 归档索引（由账本区 `archive/` 目录实测生成 · ⛔ 手改即红）')
  lines.push('')
  lines.push('> 由 `npm run gen:ledger` 从目录直出。⚠ ⛔ 不许手改（`CONSTITUTION` §2 / I5）。')
  lines.push('> ⚠ 本文件只回答"**盘上有哪些归档目录、各几件**"，⛔ 不替代 `check:archive` ② 的成员完整性核。')
  lines.push('')
  lines.push(`共 **${dirs.length}** 个归档目录：`)
  lines.push('')
  lines.push('| # | 归档目录 | 文件数 |')
  lines.push('|---|---|---|')
  dirs.forEach((d, i) => lines.push(`| ${i + 1} | \`archive/${d.name}/\` | ${d.files.length} |`))
  lines.push('')
  return lines.join('\n')
}

/**
 * 生成 `gen/index.md`（全量索引，按 kind 分组，⚠ 顺序 = 索引里的声明顺序）。
 *
 * @param {Array<Record<string, any>>} units - 索引里的全部单元
 * @returns {string} markdown 全文
 */
export function renderIndex(units) {
  const lines = []
  lines.push('# 全量索引（**生成物** · ⛔ 手改即红）')
  lines.push('')
  lines.push('> 由 `npm run gen:ledger` 从 `units/index.toml` 算出。⚠ 状态只在索引里，本文件是**读数投影**。')
  lines.push('')
  for (const [kind, spec] of Object.entries(KIND_SPEC)) {
    const group = units.filter((u) => u.kind === kind)
    if (group.length === 0) continue
    const stepLabel = spec.step === null ? '长期能力（无完成态）' : `第 ${spec.step} 步 · ${STEP_NAMES[spec.step - 1]}`
    lines.push(`## ${kind} · ${stepLabel}（${group.length} 条）`)
    lines.push('')
    lines.push('| id | 标题 | 状态 | after | 来源 |')
    lines.push('|---|---|---|---|---|')
    for (const u of group) {
      const after = Array.isArray(u.after) && u.after.length > 0 ? u.after.join(', ') : '—'
      lines.push(`| ${u.id} | ${u.title ?? ''} | ${u.status} | ${after} | ${u.source ?? '—'} |`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** 读索引并解析（供生成器与判据共用 —— ⚠ 单一入口）。 */
export function readUnits(indexPath = INDEX_PATH) {
  const src = readFileSync(indexPath, 'utf8')
  const parsed = parseTomlSubset(src)
  return parsed.unit
}

/**
 * 生成**全部**产物（不写盘）。
 *
 * ⚠ 2026-10-30 P6：从 2 份增到 **4 份** —— 新增 `modules.md`（`src/modules/` 直出）与
 *   `archive-index.md`（账本区 `archive/` 直出）。三份新生成端一律纳入 **I5**（手改即红）。
 * ⚠ 纯函数：只吃"已在参数里递进来的数据"，⛔ 不在渲染层读盘取时间。
 *
 * @param {Array<object>} units - 索引单元
 * @param {{stems?: string[], archiveDirs?: Array<{name:string,files:string[]}>}} [extra]
 *   - `stems`：`src/modules/` 的文件主干（已排序）
 *   - `archiveDirs`：账本区 `archive/` 的目录（已排序）
 * @returns {Record<string,string>} 文件名 → 全文
 */
/**
 * ⭐ **`checkpoint`** —— 一份**只读的阶段快照**（2026-10-31 P42/R4 · `TASK-R4.md` §三）。
 *
 * ── ⚠⚠ 它**不是**第六步（这条必须说清，否则一定有人把它当进度）──────────────
 *   · ⛔ 不进任何一步的分母；· ⛔ 不给它"完成/未完成"语义；· ⛔ 不做"上次比这次"的趋势判断
 *     （趋势在 `check:convergence` 的 `K-TREND`，那是判据的事，不是快照的事）。
 *   它就是**一张某一刻的读数照片**：把"当时账本长什么样"固定下来，
 *   好让 `resume` 之后能回答"外面变了什么、盘上还对得上吗、悬着的事还算数吗"。
 *
 * ── ⚠ 为什么它必须**由生成器直出**（⛔ 不许手写）───────────────────────
 *   同 `gen/**` 的理由：手写的快照会**悄悄过期**，而"过期但看起来正常"的读数
 *   比没有读数更坏（`CONSTITUTION` §10：没有读数不能陈述为事实）。
 *   ⇒ 它落在 `ledger-next/spec/`，由 `npm run gen:ledger` 写；手改 ⇒ `I5c` 当场红。
 *
 * ⚠ 纯函数：吃单元 + 若干"外部读数"，⛔ 不取时间戳（否则同一输入两次输出不同，
 *   那会让 `I5c` 的逐字节比对变成假红）。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @param {{constitutionBytes?: number|null, buildStamp?: string|null, convergence?: (chg: any) => {converged: boolean, blockedBy: string[]}}} extra - 外部读数
 * @returns {string} markdown 全文
 */
export function renderCheckpoint(units, extra = {}) {
  const L = []
  L.push('# 阶段快照（checkpoint · 由 `npm run gen:ledger` 直出 · ⛔ 手改即红）')
  L.push('')
  L.push('> ⚠ **这不是第六步**：不进任何一步的分母、没有"完成/未完成"语义、不做趋势判断。')
  L.push('> 它就是某一刻账本长什么样的**读数照片**，供 `resume` 之后核对"外面变了什么"。')
  L.push('')

  // ── 一、单元计数（按 kind）──
  const byKind = new Map()
  for (const u of units) byKind.set(String(u.kind), (byKind.get(String(u.kind)) ?? 0) + 1)
  L.push('## 一、单元计数')
  L.push('')
  L.push('| kind | 条数 |')
  L.push('|---|---:|')
  for (const k of Object.keys(KIND_SPEC)) L.push(`| \`${k}\` | ${byKind.get(k) ?? 0} |`)
  L.push(`| **合计** | **${units.length}** |`)
  L.push('')

  // ── 二、五步各步三态 ──
  L.push('## 二、五步各步三态')
  L.push('')
  L.push('| 步 | 名称 | done | doing | todo |')
  L.push('|---:|---|---:|---:|---:|')
  for (const [kind, spec] of Object.entries(KIND_SPEC)) {
    if (spec.step === null) continue
    const ofStep = units.filter((u) => u.kind === kind)
    const st = summarizeStep(ofStep, spec)
    const finalsN = ofStep.filter((u) => spec.finals.includes(u.status)).length
    const doingN = ofStep.filter((u) => u.status !== spec.init && !spec.finals.includes(u.status)).length
    const todoN = ofStep.filter((u) => u.status === spec.init).length
    L.push(`| ${spec.step} | ${STEP_NAMES[spec.step - 1]} | ${finalsN} | ${doingN} | ${todoN} |`)
    void st
  }
  L.push('')

  // ── 三、change 的收敛态 + 阻断项（⚠ 这就是 §五 要的组合视图）──
  L.push('## 三、变更组合视图（每个 change 一行 · ⛔ 只读表，不做排序/甘特/协作）')
  L.push('')
  L.push('| change | 状态 | 满足哪几条需求 | 收口 | 阻断项 |')
  L.push('|---|---|---|---|---|')
  const changes = units.filter((u) => u.kind === 'change')
  for (const chg of changes) {
    const addr = Array.isArray(chg.addresses) ? chg.addresses.map(String) : []
    let conv = '判不出（未注入收敛判定）'
    let blockers = '—'
    if (typeof extra.convergence === 'function') {
      const r = extra.convergence(chg)
      conv = r.converged ? '**已收口**' : '**未收口**'
      blockers = r.blockedBy.length === 0 ? '0 条' : r.blockedBy.map((b) => `· ${b}`).join('<br>')
    }
    L.push(`| \`${String(chg.id)}\` | \`${String(chg.status)}\` | ${addr.length === 0 ? '—' : addr.map((x) => `\`${x}\``).join(' ')} | ${conv} | ${blockers} |`)
  }
  if (changes.length === 0) L.push('| — | — | — | — | — |')
  L.push('')

  // ── 四、外部读数（⚠ 判不出就写"判不出"，⛔ 不许填 0）──
  L.push('## 四、外部读数')
  L.push('')
  L.push('| 项 | 读数 |')
  L.push('|---|---|')
  const cb = extra.constitutionBytes
  L.push(`| \`CONSTITUTION.md\` 字节 | ${typeof cb === 'number' ? `${cb} B` : '**判不出**（未注入）'} |`)
  const bs = extra.buildStamp
  L.push(`| 构建戳 | ${typeof bs === 'string' && bs !== '' ? `\`${bs}\`` : '**判不出**（未注入）'} |`)
  L.push('')
  L.push('> ⚠ 「判不出」是**读数**，不是错误：`CONSTITUTION` §7 明令 ⛔ 不许填 0、⛔ 不许拿推断当读数。')
  L.push('')
  return L.join('\n')
}

export function renderAll(units, extra = {}) {
  return {
    'stages.md': renderStages(units),
    'index.md': renderIndex(units),
    'modules.md': renderModules(extra.stems ?? []),
    'archive-index.md': renderArchiveIndex(extra.archiveDirs ?? []),
  }
}

/**
 * **`spec/` 下的生成物**（与 `gen/**` 分开：`gen/` 是"账本的渲染"，
 * `spec/` 这份是**快照**，它要能被 `resume` 读到、且由 `I5c` 逐字节咬住）。
 *
 * ⚠ 单独一个函数而不是塞进 `renderAll`，因为 `renderAll` 的返回值被 `I5` 当成
 *   "`gen/` 里应有哪几个文件"的**清单**用 —— 混进去会让 `I5` 去找 `gen/checkpoint.md`。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @param {object} extra - 外部读数（同 {@link renderCheckpoint}）
 * @returns {Record<string, string>} 文件名 → 内容
 */
export function renderSpecArtifacts(units, extra = {}) {
  return {
    'checkpoint.md': renderCheckpoint(units, extra),
    /**
     * ⚠⚠ **组合层单独一份生成物**（2026-11-01 P40/R6 · `TASK-R6.md` §2.2）。
     *   ⛔ **别塞进 `renderAll`** —— 那个返回值被 `I5` 当成「`gen/` 里应有哪几个文件」的清单用。
     *   ⚠ 它由 `checkI5c` **逐字节**核（因为 `I5c` 拿的就是本函数的返回值）⇒
     *     生成器一改，`spec/portfolio.md` 必须同批重生成。
     */
    'portfolio.md': renderPortfolio(units, extra),
  }
}

/**
 * **`spec/portfolio.md`** —— 项目组合层读数（2026-11-01 P40/R6 · `TASK-R6.md` §2.2）。
 *
 * ⚠⚠ **四块缺一即未做完**（作业书点名）：
 *   ① 需求覆盖表 · ② 孤儿需求 · ③ 跨 change 需求 · ④ 读数边界。
 * ⚠ 头部必须写明「⛔ 手改即红 · 由 `npm run gen:ledger` 直出」。
 * ⚠⛔ **不算百分比、不算完成度、不做趋势、不进五步分母** —— 它只回答"哪条需求没人接"。
 *
 * @param {Array<Record<string, any>>} units - 索引单元
 * @param {object} extra - 外部读数（`portfolio` 可注入，便于负向对拍）
 * @returns {string} markdown 正文
 */
export function renderPortfolio(units, extra = {}) {
  const L = []
  L.push('# 项目组合层（**生成物** · ⛔ 手改即红 · 由 `npm run gen:ledger` 直出）')
  L.push('')
  L.push('> ⚠ **这不是第六步**：不进五步分母、没有"完成度"、不做趋势、⛔ 没有百分比。')
  L.push('> 它只回答一件事：**哪条已定的需求没有任何 change 承接、也没有 pass 的验收**。')
  L.push('> ⚠ 唯一实现是 `src/shared/portfolio.ts`（零 import 的纯函数，Node 与浏览器共用一份）。')
  L.push('')

  const p = extra.portfolio !== undefined ? extra.portfolio : (typeof portfolioOfShared === 'function' ? portfolioOfShared(units) : undefined)

  if (p === undefined || p === null) {
    /**
     * ⚠ 算不出来 ⇒ **判不出**（⛔ 不许当 0 条、⛔ 不许留空）。
     *   那正是 `CONSTITUTION` §7：判不出就写「判不出」。
     */
    L.push('## 一、需求覆盖表')
    L.push('')
    L.push('**判不出** —— `src/shared/portfolio.ts` 没能载入（或注入的读数缺失）⇒ 本表不产出读数。')
    L.push('')
    L.push('## 二、孤儿需求')
    L.push('')
    L.push('**判不出** —— 同上。⚠ ⛔ 不许把"算不出来"写成「0 条」：那会把一次故障伪装成一次干净的读数。')
    L.push('')
    L.push('## 三、跨 change 需求')
    L.push('')
    L.push('**判不出** —— 同上。')
    L.push('')
    L.push('## 四、读数边界')
    L.push('')
    L.push('- 本表**不判断完成度**、**不做趋势**、**不进五步分母**；⛔ 没有百分比。')
    L.push('- 「有 change 承接」≠「做完了」：承接只说明有人在管它，收口由 `check:convergence` 的 K-1..K-6 判。')
    L.push('- 「已有 pass 验收」才说明它被证明满足过（判决唯一落点是 `acc.status`）。')
    return L.join('\n')
  }

  // ── ① 需求覆盖表 ──
  L.push('## 一、需求覆盖表')
  L.push('')
  L.push('| 需求 | 状态 | 被哪几条 change 承接 | task 条数 | acc 条数 | pass 条数 |')
  L.push('|---|---|---|---:|---:|---:|')
  for (const r of p.reqs) {
    const chg = r.changes.length === 0 ? '—' : r.changes.join(', ')
    L.push(`| ${r.id} | ${r.status} | ${chg} | ${r.tasks} | ${r.accs} | ${r.passAccs} |`)
  }
  L.push('')
  L.push(`合计 **${p.counts.total}** 条需求：有 change 承接 **${p.counts.covered}** 条 · 已有 pass 验收 **${p.counts.proven}** 条 · **完全没人接 ${p.counts.orphan}** 条 · 做完了没人验 ${p.counts.builtNoAcc} 条。`)
  L.push('')

  // ── ② 孤儿需求（⚠ 0 条时也要写「0 条」，⛔ 不许留空）──
  L.push('## 二、孤儿需求（`agreed` · 无 change 承接 · 无 task 承接 · 无 acc）')
  L.push('')
  L.push(`**${p.orphanNote}**`)
  L.push('')
  if (p.orphans.length > 0) {
    L.push('⚠ 以下**四条条件同时成立**才算孤儿（`agreed` · 无 change 承接 · **无 task 承接** · 无 acc）；')
    L.push('⚠⚠ **有 task 就说明有人在管**（哪怕它还是 `todo`）⇒ ⛔ 不在此列；')
    L.push('**有 acc 但没过** ⇒ ⛔ 也不在此列 —— 那是「做完了没人验」，见下一节。')
    L.push('')
    for (const id of p.orphans) {
      const r = p.reqs.find((x) => x.id === id)
      L.push(`- \`${id}\`：状态 \`${r === undefined ? '判不出' : r.status}\` · task ${r === undefined ? '判不出' : r.tasks} 条 · acc ${r === undefined ? '判不出' : r.accs} 条（pass ${r === undefined ? '判不出' : r.passAccs} 条） · 承接它的 change：无`)
    }
    L.push('')
  }

  /**
   * ── 二·B · 做完了但没人验收（2026-11-01 P40/R7 · `TASK-R7.md` §二）────────
   * ⚠⚠ **这一节就是 R6 被退回的那条错的正解**：R6 把这些需求写进了「没人做」，
   *   而它们的真名是「活做完了，缺的是第 5 步」。⇒ 单独一节说出来，⛔ 不判红。
   */
  L.push('## 二·B 做完了但没人验收（有 `built` 的 task · 无 pass acc）')
  L.push('')
  L.push(`**${(p.builtNoAcc ?? []).length === 0
    ? `0 条 —— ${p.counts.total} 条需求逐条查过，没有"有 built 的 task 却一条 pass acc 都没有"的`
    : `${(p.builtNoAcc ?? []).length} 条：${(p.builtNoAcc ?? []).join(' · ')}`}**`)
  L.push('')
  if ((p.builtNoAcc ?? []).length > 0) {
    L.push('⚠ **这不是孤儿**：活做完了，缺的是第 5 步（验收）。⛔ 本表不判它红。')
    L.push('⚠ 它与上一节**互斥**（孤儿要求无 task，本节要求有 `built` 的 task）—— 判据 `check:ledger-next` 有断言逐轮核这一点。')
    L.push('')
    for (const id of (p.builtNoAcc ?? [])) {
      const r = p.reqs.find((x) => x.id === id)
      L.push(`- \`${id}\`：task ${r === undefined ? '判不出' : r.tasks} 条（其中有 \`built\`） · acc ${r === undefined ? '判不出' : r.accs} 条 · **pass 0 条**`)
    }
    L.push('')
  }

  // ── ③ 跨 change 需求（⚠ 不判红，只提示）──
  const multi = p.reqs.filter((r) => r.changes.length >= 2)
  L.push('## 三、跨 change 需求（被 ≥2 条 change 同时承接）')
  L.push('')
  if (multi.length === 0) {
    L.push(`**0 条** —— ${p.counts.total} 条需求逐条查过，没有被两条以上 change 同时承接的。`)
  } else {
    L.push('⚠ **不判红**，只提示：一条需求被多条 change 同时承接时，"谁负责收口"要人来定。')
    L.push('')
    for (const r of multi) L.push(`- \`${r.id}\`：${r.changes.join(' · ')}`)
  }
  L.push('')

  // ── ④ 读数边界 ──
  L.push('## 四、读数边界')
  L.push('')
  L.push('- 本表**不判断完成度**、**不做趋势**、**不进五步分母**；⛔ 没有百分比、⛔ 没有进度条。')
  L.push('- 「有 change 承接」≠「做完了」：承接只说明有人在管它；收口由 `check:convergence` 的 K-1..K-6 判。')
  L.push('- 「已有 pass 验收」才说明它被证明满足过（判决唯一落点是 `acc.status`，2026-11-01 R5b 起 `outcome` 已删）。')
  L.push('- 找 acc 的两条路（`req.acceptance_ids` 直挂 + 经 task 间接）与 `convergence.ts` 的 `k3` **完全一致** —— ⛔ 两套口径会漂。')
  L.push('- 判据是 `check:ledger-next` 的 **P-1**（⛔ 不是新族）。「二·B」**不进任何判据** —— 它是读数，⛔ 不是红项。')
  L.push('- `parent` = **归属**（承接）· `after` = **前置**（⛔ 不是承接）—— 混用会让"有人在管"这句话失真。')
  L.push('  ⚠ 本批为这件事判错过两次（R6 的孤儿口径 · `REVIEW-R6.md` 的 `R-008`）；语义写死在 `scripts/gen-ledger.mjs` 的 `PARENT_VS_AFTER`。')
  L.push('- ⚠ 口径改正史：R6 的孤儿口径少了一条「无 task 承接」，把 `R-002`/`R-003`/`R-004`（活做完了没人验）')
  L.push('  写成了「没人做」⇒ 被 `REVIEW-R6.md` 判 `back-to-plan`。现口径四条同时成立，见 `src/shared/portfolio.ts` 的长注释。')
  return L.join('\n')
}

/**
 * 采集"外部输入"（目录实测）—— ⚠ **读盘但不取时间**，所以仍然确定性。
 *
 * @param {string} root - 工作区根（取 `src/modules/`）
 * @param {string} ledgerDir - 账本区 `ledger-next/` 的**上级**（= 账本根；取 `archive/`）
 * @returns {{stems: string[], archiveDirs: Array<{name:string, files:string[]}>}}
 */
export function collectInputs(root, ledgerDir) {
  /** `src/modules/` 的文件主干（⚠ 只 `.ts`，排除 `.d.ts`）。 */
  let stems = []
  try {
    stems = readdirSync(join(root, 'src', 'modules'))
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
      .map((f) => f.slice(0, -3))
      .sort()
  } catch { stems = [] }
  /** 账本区 `archive/` 的子目录 + 每目录文件数。 */
  const ledgerRoot = dirname(ledgerDir)
  const archiveRoot = join(ledgerRoot, 'archive')
  let archiveDirs = []
  try {
    archiveDirs = readdirSync(archiveRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        let files = []
        try {
          files = readdirSync(join(archiveRoot, e.name), { withFileTypes: true })
            .filter((x) => x.isFile())
            .map((x) => x.name)
            .sort()
        } catch { files = [] }
        return { name: e.name, files }
      })
      .sort((a, b) => (a.name < b.name ? -1 : 1))
  } catch { archiveDirs = [] }
  return { stems, archiveDirs }
}

/** 主入口（仅在直接执行时写盘）。 */
function main() {
  const units = readUnits()
  const inputs = collectInputs(ROOT, LEDGER_DIR)
  const out = renderAll(units, inputs)

  /**
   * ── `spec/checkpoint.md`（2026-10-31 P42/R4 · `TASK-R4.md` §三）─────────────
   * ⚠ 外部读数在这里**实测**（⛔ 不取时间戳）：
   *   · `CONSTITUTION.md` 字节 —— 直接读盘数；
   *   · 构建戳 —— 读 `lib/BUILD-STAMP`；读不到就传 `null` ⇒ 快照里写「判不出」。
   * ⚠ 收敛判定**本轮不注入**（`renderCheckpoint` 会写「判不出（未注入）」）：
   *   注入需要 `check-convergence.mjs` 的 `convergenceOf`，而那会把**判据**拖进**生成器**
   *   ⇒ 生成器就开始"判对错"了，那不是它的事。⛔ 宁可写判不出，也不在生成器里造第二份判据。
   */
  let constitutionBytes = null
  try { constitutionBytes = Buffer.byteLength(readFileSync(join(ROOT, 'preset', 'dsh-hob', 'CONSTITUTION.md'), 'utf8'), 'utf8') } catch { constitutionBytes = null }
  let buildStamp = null
  try {
    /**
     * ⚠ 构建戳是**多行**的（commit / dirty / built_at / builder）⇒ 直接塞进 markdown 表格
     *   会把表格撑断（实测：`| 构建戳 | \`commit=…` 后面几行掉出表格）。
     *   ⇒ 压成一行、用 ` · ` 连。⛔ 不丢字段（那会让快照少读数）。
     */
    buildStamp = readFileSync(join(ROOT, 'lib', 'BUILD-STAMP'), 'utf8')
      .split('\n').map((x) => x.trim()).filter((x) => x !== '').join(' · ')
  } catch { buildStamp = null }
  /**
   * ⚠ **注入收敛判定**（`TASK-R4b.md` §一.4）：不注入 ⇒ checkpoint 的「收口」列
   *   恒为「判不出（未注入收敛判定）」—— 那正是 R4 验收指出的那一半缺口。
   */
  const convFn = typeof convergenceOfShared === 'function'
    ? (chg) => {
        const r = convergenceOfShared(chg, units)
        return { converged: r.converged, blockedBy: r.blockedBy }
      }
    : undefined
  const specOut = renderSpecArtifacts(units, { ...inputs, constitutionBytes, buildStamp, convergence: convFn })
  const stdoutOnly = process.argv.includes('--stdout')
  if (!stdoutOnly) mkdirSync(GEN_DIR, { recursive: true })
  for (const [name, text] of Object.entries(out)) {
    if (stdoutOnly) { process.stdout.write(`===== ${name} =====\n${text}\n`); continue }
    writeFileSync(join(GEN_DIR, name), text)
    console.log(`  写出 gen/${name}（${Buffer.byteLength(text, 'utf8')} 字节）`)
  }
  // ── spec/checkpoint.md（⚠ 与 gen/** 同批写，⛔ 不许分两次跑）──
  const SPEC_DIR = join(LEDGER_DIR, 'spec')
  for (const [name, text] of Object.entries(specOut)) {
    if (stdoutOnly) { process.stdout.write(`===== spec/${name} =====\n${text}\n`); continue }
    mkdirSync(SPEC_DIR, { recursive: true })
    writeFileSync(join(SPEC_DIR, name), text)
    console.log(`  写出 spec/${name}（${Buffer.byteLength(text, 'utf8')} 字节）`)
  }
  if (!stdoutOnly) console.log(`\n  ✅ 已生成 ${Object.keys(out).length} 份 + ${Object.keys(specOut).length} 份快照（来源：units/index.toml · ${units.length} 条单元）`)
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main()
