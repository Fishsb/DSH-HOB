/**
 * **`portfolioOf`** —— 项目组合层：跨 change 看「哪条需求根本没人接」
 * （2026-11-01 · P40/R6 · `TASK-R6.md` §二）。
 *
 * ══ 它治什么（⚠ 这是本层唯一的活）═══════════════════════════════════════════
 *   账本里已经有三处"组合"信息，但**没有一处做跨 change 的判断**：
 *     · `spec/checkpoint.md` §三 —— 每个 change **各自**收没收口；
 *     · `src/shared/next-action.ts` —— 全局**下一步**是哪一件；
 *     · `src/shared/convergence.ts` K-1..K-6 —— **一条** change 内部收不收口。
 *   ⇒ 真正的洞：**一条 `req` 已经 `agreed`（用户认了），却没有任何 `change` 的
 *     `addresses` 指向它** ⇒ 阶段清单里显示"需求 8/8 完成"，而**没有人在做它**，⛔ 没有判据会红。
 *   ⚠⚠ 这就是本层要治的**唯一**一件事。⛔ 不是看板、⛔ 不是甘特/里程碑/百分比。
 *
 * ══ ⚠⚠ 硬约束（与 `convergence.ts` 同一条）═════════════════════════════════
 *   本文件**零 import**：⛔ 不许 import `node:fs` / `node:path` / `scripts/` 下任何东西。
 *   理由：它要被 `scripts/gen-ledger.mjs`（Node）与 `src/client/project-panel.tsx`（浏览器）
 *   **同时**调用 —— 一份实现，两个消费者。⚠ 先例：`gen-ledger.mjs` 用
 *   `import(pathToFileURL('src/shared/convergence.ts'))` 载真源码，照它做。
 *   （判据：`check:stages-route` 的 R-13/R-14 会咬。）
 *
 * ══ ⚠ 纯函数 ═══════════════════════════════════════════════════════════════
 *   ⛔ 不读环境、⛔ 不取当前时间、⛔ 不写文件。同输入 ⇒ 同输出（逐字节）。
 */

/** 账本单元的最小形状（⚠ 只要用到的字段，⛔ 不要整个 `any`）。 */
export interface PortfolioUnit {
  id?: string
  kind?: string
  status?: string
  parent?: string
  /** `req`：哪几条 acc 直接挂在它上面。 */
  acceptance_ids?: string[]
  /** `change`：满足哪几条需求。 */
  addresses?: string[]
  /** `task`：正式承接哪几条需求。 */
  req_ids?: string[]
}

/** 一条需求的覆盖读数。 */
export interface ReqCoverage {
  id: string
  status: string
  /** 承接它的 change id（按 `addresses` 反查，⚠ 可多条）。 */
  changes: string[]
  /** 挂在它上面的 acc 条数（直挂 + 经 task 间接，找法与 `k3` **完全一致**）。 */
  accs: number
  /** 其中 `status = pass` 的条数。 */
  passAccs: number
  /** `parent` 是这条 req 的 task 条数（⚠ 有 task 就说明**有人在管**）。 */
  tasks: number
}

/** 组合层读数。 */
export interface Portfolio {
  reqs: ReqCoverage[]
  /** `agreed` 且无 change 承接且无 pass acc 的需求 id。 */
  orphans: string[]
  /** 给人看的一行；⚠ 0 条时写「0 条」，⛔ 不许空串。 */
  orphanNote: string
  /**
   * **做完了但没人验收**（2026-11-01 P40/R7 · `TASK-R7.md` §1.1）：
   * 有 `status = built` 的 task、但一条 `pass` acc 都没有的需求。
   *
   * ⚠⚠ **⛔ 不判红、⛔ 不进 P-1、⛔ 不算百分比** —— 它只是把「做完了没人验」这句话
   *   **单独说出来**，让面板/生成物不再需要靠"没人做"来表达它（那正是 R6 被退回的原因）。
   * ⚠ 与 `orphans` **互斥**（`orphans` 要求 `tasks === 0`，本项要求有 built 的 task）——
   *   `check-ledger` 的 P-1 里有一条断言逐轮核这个互斥。
   */
  builtNoAcc: string[]
  /** 任务 → 需求的正式承接边（⚠ 不含 `after` 前置）。 */
  taskLinks: Array<{ task: string; reqs: string[] }>
  counts: { total: number; covered: number; proven: number; orphan: number; builtNoAcc: number }
}

/** 取字符串数组（缺 ⇒ 空数组）。⚠ 与 `convergence.ts` 的 `arr` 同语义。 */
const arrOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter((x) => x !== '') : []

/**
 * 算组合层读数。
 *
 * ── `orphans` 的口径（⚠ **四条**同时成立 · 2026-11-01 P40/R7 改正）─────────
 *   ① `status = agreed`；② `changes.length === 0`；③ `tasks === 0`；④ `accs === 0`。
 *
 * ⚠⚠⚠ **口径改正史（⛔ 这段注释不许删 —— 它是"我错过"的唯一现场）** ──────────
 *   R6 时口径是三条：`agreed` · 无 change 承接 · **`passAccs === 0`**。
 *   ⇒ 生成物与面板写出了一句**假话**：「5 条已定却没人做：R-002 · R-003 · R-004 · R-005 · R-008」。
 *   `REVIEW-R6.md`（判决 `back-to-plan`）逐条核出其中**四条是假的**：
 *     · `R-002`/`R-003`/`R-004` 底下各有一条 **`built`** 的 task（`TSK-031`/`TSK-032`/`TSK-033`）
 *       ⇒ 真名是「**活做完了，没人验收**」，⛔ 不是「没人做」；
 *     · `R-008` 我当时说它底下有 `TSK-048` —— **那也是错的**：`TSK-048` 的 `parent` 是
 *       `CHG-2026-10-31-tool-policy`，`after = ["R-008"]` 是**前置引用**、不是承接关系
 *       ⇒ 按 `parent` 口径 `R-008` 底下**确实没有 task**（⚠ 这条已写进 `REPORT-R7.md` 待决问题）。
 *   ⇒ 缺的那一条是 **`tasks === 0`**：**有 task 就说明有人在管**，哪怕它还是 `todo`。
 *
 * ── ③ `tasks === 0`（新增的主判据）──────────────────────────────────
 *   有 task ⇒ 有人在管 ⇒ ⛔ 不是孤儿。⛔ 少了它就会把「做完没人验」说成「没人做」，
 *   而那会逼人去给一件**已经做完**的事补一条 change = 造假读数。
 *
 * ── ④ `accs === 0`（⚠ **冗余，是保险，不是主判据**）──────────────────
 *   `acc` 只可能挂在 `req.acceptance_ids` 或某条 **task** 上 ⇒
 *   `accs > 0` **必然**意味着 `changes` 或 `tasks` 非空（acc 的 `parent` 不是 task 就是被
 *   `acceptance_ids` 指着，两条路都要么经 task、要么是需求自己声明）。
 *   ⇒ 加了 ③ 之后 ④ 已经**恒真**，写它只是把"一条完全没有验收痕迹的需求"这件事**显式说出来**。
 *   ⚠⚠ **⛔ 别为了"看起来更严"把它写成 `passAccs === 0`** —— 那正是 R6 的错：
 *     它会把「验收存在但没过」的需求和「完全没人碰」的需求混成同一句假话。
 *
 * ⚠ **找 acc 的两条路必须与 `convergence.ts` 的 `k3` 完全一致**（⛔ 不许自己写第二套）：
 *   · 直挂：`req.acceptance_ids` 里指向真实 `acc` 的那些；
 *   · 间接：`parent` 是该 req 的 `task` 底下的 acc。
 *   ⚠ 两套口径必然漂 —— 那正是 R5b 刚治过的病。
 *
 * @param {ReadonlyArray<PortfolioUnit>} units - 账本单元
 * @returns {Portfolio} 读数（⚠ ⛔ 没有百分比、⛔ 没有完成度）
 */
export function portfolioOf(units: readonly PortfolioUnit[]): Portfolio {
  const list = Array.isArray(units) ? units : []
  const byId = new Map(list.map((u) => [String(u.id), u]))
  const changes = list.filter((u) => u.kind === 'change')
  const accs = list.filter((u) => u.kind === 'acc')
  const tasks = list.filter((u) => u.kind === 'task')
  const tksOfReq = (rid: string): PortfolioUnit[] => tasks.filter((t) => {
    if (String(t.parent) === rid) return true
    return arrOf(t.req_ids).includes(rid)
  })

  const reqs: ReqCoverage[] = []
  for (const r of list.filter((u) => u.kind === 'req')) {
    const rid = String(r.id)
    /** ① 被哪几条 change 承接（反查 `addresses`）。 */
    const changesOf = changes
      .filter((c) => arrOf(c.addresses).includes(rid))
      .map((c) => String(c.id))
    /** ② 找 acc：直挂 + 经 task 间接（⚠ 与 `k3` 同一套）。 */
    const direct = arrOf(r.acceptance_ids)
      .map((x) => byId.get(x))
      .filter((x): x is PortfolioUnit => x !== undefined && x.kind === 'acc')
    /**
     * ⚠ 这条 req 底下的 task：
     *   · 直接归属：`task.parent === req.id`；
     *   · 正式承接：`task.req_ids` 含 req.id（⚠ 任务仍可归在 change 下）。
     * `after` 只是前置关系，**不参与**这里的承接反查。
     */
    const tks = tksOfReq(rid)
    const taskIdsOfReq = new Set(tks.map((t) => String(t.id)))
    const indirect = accs.filter((a) => taskIdsOfReq.has(String(a.parent)))
    const candidates = [...direct, ...indirect]
    /** ⚠ 单落点：判决只认 `status`（2026-11-01 R5b 裁定 A，`outcome` 已删）。 */
    const passAccs = candidates.filter((a) => String(a.status ?? '') === 'pass').length
    reqs.push({
      id: rid,
      status: String(r.status ?? ''),
      changes: changesOf,
      accs: candidates.length,
      passAccs,
      tasks: tks.length,
    })
  }

  /**
   * ⚠ 四条同时成立才算孤儿（口径见上方长注释 · R7 改正）。
   *   ⛔ 尤其**不许**把 ③ 去掉 —— 那是 R6 被退回的那条错。
   */
  const orphans = reqs
    .filter((r) => r.status === 'agreed' && r.changes.length === 0 && r.tasks === 0 && r.accs === 0)
    .map((r) => r.id)

  /**
   * **做完了但没人验收**（`TASK-R7.md` §1.1）：
   *   有 `status = built` 的 task，但一条 `pass` acc 都没有。
   * ⚠ 只报，⛔ 不判红；⚠ 与 `orphans` 天然互斥（本项要求有 built 的 task，孤儿要求 `tasks === 0`）。
   */
  const builtNoAcc = reqs
    .filter((r) => r.passAccs === 0
      && tksOfReq(r.id).some((t) => String(t.status ?? '') === 'built'))
    .map((r) => r.id)

  /** 正式的任务 → 需求承接边；`after` 只是前置，⛔ 不在此列。 */
  const taskLinks = tasks
    .filter((t) => arrOf(t.req_ids).length > 0)
    .map((t) => ({ task: String(t.id), reqs: arrOf(t.req_ids) }))

  const counts = {
    total: reqs.length,
    covered: reqs.filter((r) => r.changes.length > 0).length,
    proven: reqs.filter((r) => r.passAccs > 0).length,
    orphan: orphans.length,
    builtNoAcc: builtNoAcc.length,
  }

  /**
   * ⚠ 0 条时**写「0 条」+ 一句"这是查过的读数"**，⛔ 不许空串、⛔ 不许留空行 ——
   *   空字符串会被读成"没有这一项"，而"没有孤儿"是一条**读数**，两者不是一回事
   *   （`CONSTITUTION` §7：判不出要写判不出；同理，查过且是 0 要写 0）。
   */
  const orphanNote = orphans.length === 0
    ? `0 条 —— ${counts.total} 条需求逐条查过（有 change 承接 ${counts.covered} 条 · 有 task 在管 ${reqs.filter((r) => r.tasks > 0).length} 条 · 已有 pass 验收 ${counts.proven} 条），没有已定却完全没人接的需求`
    : `${orphans.length} 条已定却完全没人接：${orphans.join(' · ')}`

  return { reqs, orphans, orphanNote, builtNoAcc, taskLinks, counts }
}
