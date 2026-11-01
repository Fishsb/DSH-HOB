/**
 * **`nextAction`** —— 由账本单元算出「下一步该干什么」（2026-10-31 · P42/R4 · `TASK-R4.md` §一）。
 *
 * ══ 它解决什么 ═════════════════════════════════════════════════════════════
 *   账本里有五步状态、有阻断项、有验收判决，但**没有人把它们折成一句"现在该干什么"**。
 *   读者要自己把 `req.status` / `task.status` / `acc.status` / `change` 的阻断项
 *   在脑子里拼一遍 —— 那正是"状态都有了，决策还得靠猜"。
 *
 * ══ ⚠ 六态封闭集（⛔ 不许自造第七种）═══════════════════════════════════════
 *   `dispatch`    有活该派/在跑
 *   `accept`      有东西做完等验收
 *   `wait-user`   要人裁（需求没定/没人验收）
 *   `blocked`     卡在阻断项上，⛔ 不能往前
 *   `converge`    任务都完了但变更没收口
 *   `undecidable` **判不出** —— ⚠ 这一档**必须真实存在**（见下）
 *
 * ══ ⚠⚠ 为什么优先级是这个序（`TASK-R4.md` §一 钉死，⛔ 不许自行调整）══════════
 *   排序的唯一口径：**先答"手上这条活的下一步"，再答"下一步接哪条活"**。
 *   ① `doing` 优先 —— 有活在跑时，任何别的建议都是**干扰**（人手上就那一条，先把它跑完）；
 *   ② `built` 无 `acc` —— 活做完了，**不验就等于没做**（`CONSTITUTION` §3），这是第二急；
 *   ③ `change` 未收敛 —— 任务都完了但变更没收口，说明**还有账没结**（`CONSTITUTION` §8）；
 *   ④ `agreed` 需求无 `acceptance_ids` —— **要人裁**，机器做不了，所以排在能自动推进的后面；
 *   ⑤ 取依赖上可开工的第一条 `todo` —— 前面都清了，才轮到"接新活"；
 *   ⑥ 一条都不匹配 ⇒ `undecidable`。
 *
 * ⚠⚠ **⑥ ⛔ 绝不许回 `dispatch` 硬凑一条**（`TASK-R4.md` §一 明写）：
 *   那会让"没活可干"看起来像"有活"，是**最坏的一种错** —— 它把"空"伪装成"忙"。
 *
 * ══ ⚠ 纯函数 ═══════════════════════════════════════════════════════════════
 *   ⛔ 不读环境、⛔ 不取当前时间、⛔ 不写文件。同输入 ⇒ 同输出（**逐字节**相同，
 *   由 `check:stages-route` 的一条断言钉住）。
 */

/**
 * ⚠⚠ **一处本轮仍不做**（2026-10-31 · `TASK-R4.md` §七）────────────────────
 *   **`product-acceptance` 输入入口，本轮不加。**
 *
 * ── 为什么（理由与 R2 的 `risk-report` 同源）────────────────────────────
 *   新增入口必须能指回**用户原话**（`check:workflow` 的 F1/F4 都咬这一点），
 *   而 `spec/origin-user-2026-10-31.txt` 是 **R1 的冻结件、⛔ 不许编辑**，
 *   里面**没有**一句是在描述"产品验收"作为一个**入口类型**的。
 *
 *   ⚠⚠ 那句「检查通过证明技术条件满足，用户是否接受产品行为和取舍仍然是另一件事」
 *     已经**被不变量 9 用掉**了；再拿它当入口出处 = **一句话顶两个身份**，
 *     ⛔ 那会让 F1 的核对变成**形式**（同一句原话既证明不变量 9、又证明新入口 —— 谁都没法反驳）。
 *
 * ── 现状：对象先有，前门待补 ──────────────────────────────────────────
 *   · `acc.status`（判决，唯一落点）+ `send_back_to`（退回目标，§二）**已经覆盖它的实质**；
 *   · 缺的只是"一个能声明'我要做产品验收'的输入入口"。
 *   ⇒ **待补**：等出现一句**新的**、未被占用的用户原话描述这个入口时再加。
 *     ⛔ 不许复用不变量 9 那一句，⛔ 不许自己编一句当出处。
 */

/** 六态封闭集（⚠ 只在这里写一次；⛔ 判据脚本里不许再列一遍）。 */
export const NEXT_ACTION_KINDS = ['dispatch', 'accept', 'wait-user', 'blocked', 'converge', 'undecidable'] as const

/** 一条「下一步」。⚠ 四项**都要有**（`TASK-R4.md` §一 的 `形状`，⛔ 缺一算未做到）。 */
export interface NextAction {
  kind: typeof NEXT_ACTION_KINDS[number]
  /** 目标单元 id；判不出时为 `null`（⛔ 不许拿空串冒充）。 */
  target: string | null
  /** 一句话，**用户看得懂**（⛔ 不许写内部术语）。 */
  why: string
  /** 阻断项：`<判据编号> · <单元 id> · <原因>`。⚠ 空数组 ≠ 缺字段。 */
  blockedBy: string[]
}

/** 一条账本单元的**最小形状**（⚠ 只要这几个字段，⛔ 不要整个 `any`）。 */
export interface LedgerUnitLike {
  id: string
  kind: string
  status?: string
  parent?: string
  after?: string[]
  built_by?: string
  actor?: string
  /**
   * ⚠ 判决的唯一落点是 `status`（2026-11-01 R5b：`outcome` 已删，`S-1` 咬「出现即红」）。
   *   ⛔ 不许加回 `outcome?: string`。
   */
  acceptance_ids?: string[]
  addresses?: string[]
  verify_refs?: string[]
  supersedes?: string
  superseded_by?: string
  affects?: string[]
}

/** 取字符串数组（缺 ⇒ 空数组）。 */
const arrOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter((x) => x !== '') : []

/**
 * 各 kind 的**终态集**（⚠ 与 `ledger-next` 的 `KIND_SPEC` 同值；这里是 client 侧，
 * 不能 import 脚本目录 ⇒ 只能重列一次。**两处不一致由 `check:stages-route` 的 R-9 交叉验证咬住**）。
 */
const FINALS: Readonly<Record<string, string[]>> = {
  req: ['agreed', 'dropped'],
  change: ['settled', 'superseded'],
  task: ['built'],
  run: ['returned', 'refused', 'stuck'],
  acc: ['pass', 'send-back'],
  risk: [],
  decision: [],
  evidence: [],
  cap: [],
  /**
   * ⚠ **2026-11-02 P50/M10**：B 轨加 `goal` 时漏了本表（同 `STAGE_KIND_STATUSES` 那次）。
   *   值照 `gen-ledger.mjs` 的 `KIND_SPEC.goal.finals`：`['done','retired']`。
   *   ⚠ 与上面 `risk`/`decision`/`evidence`/`cap` 的 `[]` **不同** —— `goal` 真有终态。
   */
  goal: ['done', 'retired'],
}

/**
 * 判一条单元的 `after` 依赖是否**全部到终态**。
 *
 * @param unit - 要判的任务
 * @param byId - id → 单元
 * @returns {{ok: boolean, stuckAt: string[]}} 是否可开工 + 卡在哪
 */
function depsSatisfied(unit: LedgerUnitLike, byId: Map<string, LedgerUnitLike>): { ok: boolean; stuckAt: string[] } {
  const stuckAt: string[] = []
  for (const dep of arrOf(unit.after)) {
    const d = byId.get(dep)
    if (d === undefined) {
      stuckAt.push(`${dep}（不存在）`)
      continue
    }
    const finals = FINALS[d.kind] ?? []
    if (!finals.includes(String(d.status ?? ''))) stuckAt.push(`${dep}（${d.kind}·${String(d.status ?? '?')}）`)
  }
  return { ok: stuckAt.length === 0, stuckAt }
}

/**
 * **算出下一步**（纯函数）。
 *
 * @param units - 账本单元集合
 * @param opts - 可选项：`convergenceOf` 注入的收敛判定（⚠ 缺省则跳过第 ③ 步，⛔ 不猜）
 * @returns {NextAction} 一条「下一步」
 */
export function nextAction(
  units: readonly LedgerUnitLike[],
  opts: {
    /** 判定某个 change 收没收口（⚠ 注入 ⇒ 可对拍；返回 `converged` 与 `blockedBy`）。 */
    convergence?: (chg: LedgerUnitLike) => { converged: boolean; blockedBy: string[] }
    /** 豁免名单里的需求 id（⚠ 第 ④ 步要跳过它们 —— 那是"已认下的账"，⛔ 不是"要人裁"）。 */
    exemptReqIds?: readonly string[]
  } = {},
): NextAction {
  const byId = new Map(units.map((u) => [String(u.id), u]))
  const exempt = new Set((opts.exemptReqIds ?? []).map((x) => String(x)))

  // ── ① 有 task 在 doing ⇒ dispatch（在跑，等它）──
  const doing = units.filter((u) => u.kind === 'task' && String(u.status) === 'doing')
  if (doing.length > 0) {
    return {
      kind: 'dispatch',
      target: String(doing[0].id),
      why: `「${String(doing[0].id)}」正在做，等它回传`,
      blockedBy: [],
    }
  }

  // ── ② 有 task 到 built 但无 acc ⇒ accept（该验收了）──
  const accs = units.filter((u) => u.kind === 'acc')
  const accParents = new Set(accs.map((a) => String(a.parent ?? '')))
  const builtNoAcc = units.filter((u) => u.kind === 'task' && String(u.status) === 'built'
    && !accParents.has(String(u.id)))
  if (builtNoAcc.length > 0) {
    return {
      kind: 'accept',
      target: String(builtNoAcc[0].id),
      why: `「${String(builtNoAcc[0].id)}」做完了还没人验收 —— 不验就等于没做`,
      blockedBy: [],
    }
  }

  // ── ③ change 全部 task 到终态但未 converged ⇒ converge ──
  if (opts.convergence !== undefined) {
    const changes = units.filter((u) => u.kind === 'change')
    for (const chg of changes) {
      const mine = units.filter((u) => u.kind === 'task' && String(u.parent) === String(chg.id))
      if (mine.length === 0) continue                       // 没活的 change 不在这里判
      const allFinal = mine.every((t) => FINALS.task.includes(String(t.status)))
      if (!allFinal) continue
      const res = opts.convergence(chg)
      if (!res.converged) {
        return {
          kind: 'converge',
          target: String(chg.id),
          why: `「${String(chg.id)}」的任务都做完了，但变更还没收口（${res.blockedBy.length} 条阻断）`,
          blockedBy: res.blockedBy,
        }
      }
    }
  }

  // ── ④ req 是 agreed 但 acceptance_ids 空且不在豁免名单 ⇒ wait-user（要人裁）──
  const nakedReq = units.filter((u) => u.kind === 'req' && String(u.status) === 'agreed'
    && arrOf(u.acceptance_ids).length === 0 && !exempt.has(String(u.id)))
  if (nakedReq.length > 0) {
    return {
      kind: 'wait-user',
      target: String(nakedReq[0].id),
      why: `需求「${String(nakedReq[0].id)}」定稿了却没人验收过 —— 这一步只有你能裁`,
      blockedBy: [],
    }
  }

  // ── ⑤ 取依赖上可开工的第一条 todo ⇒ dispatch ──
  const todos = units.filter((u) => u.kind === 'task' && String(u.status) === 'todo')
  for (const t of todos) {
    const d = depsSatisfied(t, byId)
    if (d.ok) {
      return {
        kind: 'dispatch',
        target: String(t.id),
        why: `可以开工：「${String(t.id)}」的前置都完成了`,
        blockedBy: [],
      }
    }
  }
  /** 有 todo 但**全被卡住** ⇒ 那是 `blocked`，⛔ 不是"没活"。 */
  if (todos.length > 0) {
    const stuck = depsSatisfied(todos[0], byId)
    return {
      kind: 'blocked',
      target: String(todos[0].id),
      why: `「${String(todos[0].id)}」还不能开工 —— 卡在 ${stuck.stuckAt.join('、')}`,
      blockedBy: stuck.stuckAt.map((s) => `READY · ${String(todos[0].id)} · 前置 ${s} 未到终态`),
    }
  }

  // ── ⑥ 一条都不匹配 ⇒ undecidable（⛔ 绝不许硬凑 dispatch）──
  return {
    kind: 'undecidable',
    target: null,
    why: '账本里没有在跑的活、没有等验收的、没有未收口的变更、也没有可开工的任务 ⇒ 判不出下一步该干什么',
    blockedBy: [],
  }
}

/**
 * **渲染「下一步」一行**（面板与 CLI 共用；⛔ 不许两处各写一份措辞）。
 *
 * ⚠ `undecidable` **必须明写判不出**（`TASK-R4.md` §四）：⛔ 不许显示成空、⛔ 不许显示成"已完成"。
 *
 * @param a - `nextAction` 的结果
 * @returns 一行文本
 */
export function renderNextActionLine(a: NextAction): string {
  const label: Readonly<Record<NextAction['kind'], string>> = {
    'dispatch': '派活',
    'accept': '验收',
    'wait-user': '等你裁',
    'blocked': '卡住了',
    'converge': '收口',
    'undecidable': '判不出',
  }
  return `下一步（${label[a.kind]}）：${a.why}`
}
