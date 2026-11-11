# 01-judgment · 分卷 2

> ⚠ 本文件是 `fix/01-judgment.md` 的**分卷**（原文件超 64KB 读上限，
> 按 `check:gitignore` 的 M 判据处置：**整块搬走 + 原位留指针**，⛔ 不是压缩）。
> 主文件：`docs/audit/business-logic-review/fix/01-judgment.md`。

---

## §7 T-05 · blocker · 修复写的命中判据与真正拦它的判据不是同一套 ⇒ 无法自愈的死锁

### 7.1 现状（**口径按 M-02 订正**）

~~~ts
// src/modules/tools.ts:1636-1661
if (args.gateIntent === 'repair') {
  const target = String(args.repairOf ?? '').trim()
  …
  const health = stageHealthOfLedger(root)                       // 走 project 作用域
  if (health.blockers.every((p) => p.unit !== target)) {
    return JSON.stringify({ ok: false, reason: 'repair-target-not-a-blocker', … })
  }
} else {
  stageBlocked = stageGateOfLedger(root)                          // 走 task / 全账本 作用域
}
~~~

**订正（采信 VERIFICATION.md M-02，不采信主文档初稿）**：
- 「`blockers` 结构上恒为空」**不成立**：`stageHealthOfLedger` 的 `blockers = stageControlProblems(units)`（字段 + 审批），实测只含字段缺口的账返回 **2~16 条**。
- 正确表述：**当且仅当缺口是闭环型（L-1..L-4）时恒空** —— `project@@ 作用域的 `blockers` **结构上不含** `ledgerClosureProblems`（`stage-controls.ts:1100-1101` 只调 `stageControlProblems`；闭环那一支在 `:1119` 且被 `scopeIds` 过滤）。
- **死锁结论保留**：一本只有 L-2 缺口的账 ⇒ `health={ok:true,blockers:[]}` ⇒ 修该任务被拒；而派活门禁是 `return/L-2` ⇒ **修不动、也过不去**。

### 7.2 改法：判据改成「本次写入将要消除的那条问题」

**① 缺陷编号与位置**：T-05；`src/modules/tools.ts:1649-1658`（`repairOf` 用 `stageHealthOfLedger`）vs `:1660`（forward 用 `stageGateOfLedger`）。

**② 改什么**：不看「目标 id 是否出现在某个 blocker 列表里」，改看「**本次写入是否真的消除了一条现存问题**」。

**③ 具体改法**：

第一步：新增**统一出口**（同时服务 repair 与 forward，并顺手作为 T-02 的锚点）：

~~~ts
// src/modules/tools.ts —— 新增（保留旧 stageHealthOfLedger 导出以兼容）
export interface LedgerHealthProblem { rule: string; unit: string; why: string }

/**
 * 账本健康唯一出口（T-02 / T-05 共用）。
 *
 * 与改前的区别：闭环缺口（L-*）也在里面。
 *   改前 stageHealthOfLedger 走 project 作用域 ⇒ 结构上不含 L-* ⇒
 *   一本只有 L-2 缺口的账被报成 {ok:true, blockers:[]}（M-02 实测）。
 */
export function ledgerHealthOf(ledgerRoot: string): {
  ok: boolean
  problems: LedgerHealthProblem[]
  /** 判不出（读盘失败）—— 与「没有缺口」严格区分。 */
  undecidable?: { why: string }
} {
  let units: StageControlUnit[]
  try { units = readLedgerUnits(ledgerRoot) as StageControlUnit[] }
  catch (e) { return { ok: false, problems: [], undecidable: { why: String((e as Error)?.message ?? e) } } }
  const problems = [
    ...stageControlProblems(units),
    ...ledgerClosureProblems(units),          // 关键：闭环缺口进来
  ].map((p) => ({ rule: String(p.rule), unit: String(p.unit), why: String(p.why) }))
  return { ok: problems.length === 0, problems }
}
~~~

第二步：`repairOf` 判据改成「目标必须是**现存问题所指的单元**」：

~~~ts
// 替换 tools.ts:1649-1658
const health = ledgerHealthOf(root)
if (health.undecidable !== undefined) {
  return JSON.stringify({ ok: false, reason: 'ledger-unreadable',
    message: '拒绝：修复写要先能判出账本缺口（' + health.undecidable.why + '）⇒ 本次不写。' })
}
const targetProblems = health.problems.filter((p) => p.unit === target)
if (targetProblems.length === 0) {
  return JSON.stringify({
    ok: false, reason: 'repair-target-not-a-blocker',
    message: '拒绝：' + target + ' 不是当前账本的真实缺口 ⇒ repair 不能用来逃闸。'
      + '当前缺口：' + (health.problems.slice(0, 5).map((p) => p.rule + ' · ' + p.unit).join('；') || '无'),
  })
}
/** 可选：把"这条修复写打算消除哪条规则"写明确，防止"沾边就放行"。 */
const rule = String(args.repairRule ?? '').trim()
if (rule !== '' && !targetProblems.some((p) => p.rule === rule)) {
  return JSON.stringify({ ok: false, reason: 'repair-rule-mismatch',
    message: '拒绝：' + target + ' 当前没有 ' + rule + ' 这条缺口 ⇒ 修复目标写错。' })
}
~~~

新增参数 `repairRule` **可选**（缺省不校验，保持向后兼容）。**不设为必填**的理由：设为必填会让所有现存调用立刻失败 —— 那是行为破坏，不是修复。

**④ 依赖与冲突**：

| 关系 | 说明 |
|---|---|
| **必须与 T-02 同批** | T-02 是「4 套账本健康判据」，`ledgerHealthOf` 正是收敛点（§8.1 已列「T-02 + T-05 只改 repairOf ⇒ 它依赖的判据仍是恒空的」） |
| **必须与 S-02 同批（L-C）** | S-02 收紧 `legacy()` 后 `stageControlProblems` 会新增一批缺口 ⇒ 顺序错则命中集合在两次发布间跳变 |
| **与 R-01 不冲突** | R-01 改的是 `pipeline-view` 的完成判定，不动 `stageControlProblems` |
| **与 R-05 的边界** | R-05 新增的 G3 缺口**不并入** `ledgerHealthOf`：G3 是派发判据，不是账本健康判据；混层会让「图有环」把整本账判成"不健康"。若要并入**必须单开规则号** |
| **核心收益** | 以前 L-2 缺口既拦派活又拦修复 ⇒ 死局；现在 L-2 在 `health.problems` 里 ⇒ 可修 |

**⑤ 验证方式 + 负向对拍**：

~~~bash
node /tmp/fix_probe_t05.mjs
# 夹具：一本只有 L-2 缺口的账（task.parent 指向不存在的 change）
# 期望：ledgerHealthOf().problems 含 'L-2 · TSK-X'
#       write_hob({gateIntent:'repair', repairOf:'TSK-X'}) ⇒ ok:true
~~~

- **负向对拍 1**：把 `ledgerHealthOf` 换回只跑 `stageControlProblems`（不含 L-*）⇒ 断言必须红（**复现死锁**）。
- **负向对拍 2（防逃闸）**：对一条**没有任何缺口**的单元调 `repairOf` ⇒ 必须仍被拒。
- **负向对拍 3（判不出 != 健康）**：让 `readLedgerUnits` 抛错 ⇒ 必须返回 `undecidable` 并拒绝，不得返回 `ok:true`。

**⑥ 回退方式**：`ledgerHealthOf` 是**新增导出**；回退把 `repairOf` 那段换回 `stageHealthOfLedger` 即可。**无数据变化**。

**⑦ 改动面等级**：**跨模块**（`modules/tools.ts` + 同批 T-02 的四个出口）。

### 7.3 这条修完之后，REVIEW.md 里哪几条连带消掉

| 连带项 | 原因 |
|---|---|
| **T-05**（本条） | — |
| **T-02**（必须同批） | `ledgerHealthOf` 成为唯一出口，四处改调同函数 |
| **§8.1 的「T-02 + T-05」联动项** | 由本条完成 |
| **O-37**（部分） | migrate 只看 index.toml 的问题不因此消失（不同函数），但「修补不了坏行」的夹缝在 repair 侧打开 |
| **T-06** | **不连带** |

---

## §8 T-13 · high · 批准工具与第 5 个写工具都不过 `proceedGate`

### 8.1 清单（**5 个写工具 + 4 个写动作**，全部实测）

| # | 工具 / 动作 | 位置 | 过 `proceedGate`？ | 为什么危险 |
|---|---|---|---|---|
| 1 | `hob_ledger_init` | `tools.ts:2138+` | 否 | **有明确理由**：它是「开张」不是「推进」（`src/preset/tools.ts:2020-2021`）⇒ **本条不动它** |
| 2 | `hob_ledger_migrate` | `tools.ts:1840-1944` | 否 | 改写整本索引 |
| 3 | `hob_ledger_rebuild` | `tools.ts` | 否 | 重建账本 |
| 4 | `hob_pipeline_approve` | `tools.ts:1994-2117` | 否 | 写「用户批准」 |
| **5** | **`hob_orch_control` 的 verify / accept / send-back / close-delivery** | `orchestrator.ts:10678`（verify）、`:10710`（close-delivery）、`:10756`（accept/send-back） | 否（实测 `awk 'NR>=10440 && NR<=10980 && /proceedGate/'` **零命中**） | 直接投影成 VER / ACC / CLS ⇒ 能把链推到 `chainCompleted` |

> 第 5 个是主文档 T-13 初稿漏掉的（VERIFICATION.md 的 V-05 补入），**也是最危险的**：它是 S-01 的**下游** —— 即使批准链修好了，被隔离的会话仍可自己「验证通过 + 验收通过」。

### 8.2 改法（两处，形状相同）

**① 缺陷编号与位置**：T-13；`tools.ts:1994-2117`（approve）、`orchestrator.ts:10457-10980`（control）。

**② 改什么**：把「写账本的推进类动作」统一纳入 `proceedGate`；只读 / 生命周期类动作保持放行。

**③ 具体改法**：

**8.2.1 `hob_pipeline_approve`** —— 在 `execute` 最前面（参数校验之前，与 `write_hob` 同形）：

~~~ts
// src/modules/tools.ts · ledgerApprove.execute 第一行
/** T-13：批准是"推进项目"的动作，隔离/归档/未激活会话不得写。 */
const gate = proceedGateOf?.(exec)
if (gate !== undefined) {
  return JSON.stringify({ ok: false, reason: 'proceed-not-confirmed', message: gate })
}
~~~

**`dryRun` 的取舍**：与 `write_hob` **不一致是有意的**——
- `write_hob` 的 `dryRun` 是纯演练（不落盘、不主张）；
- `approve` 的 `dryRun` 会**返回一个 decisionId**（`tools.ts:2089`），调用方可能当已批准 ⇒ **连演练也拦**；
- 这需要 **D-SPEC-1 拍板**（§11）。

**8.2.2 `hob_orch_control` 的四个写动作** —— 在 `action@@ 合法性检查之后、分支分发之前插入**一次**判断：

~~~ts
// src/modules/orchestrator.ts · control.execute，:10626 之后
/**
 * T-13 第 5 个写工具（V-05 / O-35）。
 *
 * 只拦写账本的四支；状态 / 生命周期类（stop / resume / redeliver / watch-wait /
 * plan-complete / archive-stale-plan）保持放行 —— 它们不产生 VER/ACC/CLS 单元，
 * 且隔离会话必须能停自己的活（否则成了"越隔离越停不下来"）。
 */
const WRITE_ACTIONS = ['verify', 'accept', 'send-back', 'close-delivery'] as const
if ((WRITE_ACTIONS as readonly string[]).includes(args.action)) {
  const blocked = proceedGateOf?.(exec)
  if (blocked !== undefined) {
    return JSON.stringify({ ok: false, reason: 'proceed-not-confirmed', action: args.action, message: blocked })
  }
}
~~~

**为什么不拦 `plan-complete`**：它把**计划**标为完成（运行态文件），不产生账本判决单元；且由**汇合责任人**调，被隔离的 owner 需要它收尾。**这是有意的边界，必须写进注释**。

**④ 依赖与冲突**：

| 关系 | 说明 |
|---|---|
| **与 S-01 同批（必须）** | 两者都改 `ledgerApprove.execute` ⇒ **同一函数不得改两次**。合并后 approve 只碰一次 |
| **与 T-06 相关** | approve 的 `validateLedgerStructure` 也在同一函数内 ⇒ 三件事（闸门 / 白名单 / 结构校验）**必须一次改完** |
| **与 R-01 相关** | R-01 让 G4/G5 变严后，`hob_orch_control` 反成「绕过强判据写 ACC」的捷径 ⇒ **R-01 不做本节，等于白修** |
| **与 init 的关系** | **不纳入**（有明确理由）；但 migrate / rebuild 要纳入 |

**⑤ 验证方式 + 负向对拍**：

~~~bash
node /tmp/fix_probe_t13.mjs
# 夹具：模拟 verdict.source='archived' / mayProceed=false 的 exec
# 期望 A：approve ⇒ {ok:false, reason:'proceed-not-confirmed'}
# 期望 B：control{action:'accept'} ⇒ 同上
# 期望 C：control{action:'close-delivery'} ⇒ 同上
# 期望 D（对照）：control{action:'stop'} / {'resume'} / {'watch-wait'} ⇒ 仍然放行
~~~

- **负向对拍 1**：把 approve 的 `proceedGateOf` 删掉 ⇒ 期望 A 红。
- **负向对拍 2**：把 `WRITE_ACTIONS` 删剩 1 个 ⇒ 期望 B/C 里必有一个红（**锁「四个都要」**）。
- **负向对拍 3（防过严）**：删掉 `stop` 的放行 ⇒ 期望 D 红（**锁「隔离会话仍能停」**）。

**⑥ 回退方式**：两段都是**新增的早退分支**，删掉即恢复旧行为。**无数据变化**。

**⑦ 改动面等级**：**跨模块**（`modules/tools.ts` + `modules/orchestrator.ts`；与 S-01 同函数 ⇒ 实际是**一次触碰**）。

### 8.3 这条修完之后，REVIEW.md 里哪几条连带消掉

| 连带项 | 原因 |
|---|---|
| **T-13**（本条） | — |
| **O-35** | 主文档把它列为「T-13 清单里漏掉的第 5 个」⇒ 本节正式并入 |
| **S-01**（部分） | 「隔离会话仍能写用户批准」这条支路关闭；但「Hob 自批」仍需 §2 的 C |
| **R-01**（前提） | 强判据生效后，本节堵住最后一条「绕过强判据写判决」的路 |
| **T-03 / T-04** | **不连带** |

---


## §9 合并改动清单（S-01 + S-02 + R-05 + R-01 一次触碰）

### 9.1 为什么必须合并

三条理由，缺一条都不能拆：

1. **同文件**：S-01 / S-02 / R-05 / R-01 全部落在 `pipeline.ts` / `pipeline-view.ts` / `stage-controls.ts` 三个文件上（§9.2 逐行标注）。
2. **同判据面**：S-02 让一批单元从「豁免」变「有缺口」；R-01 让「有缺口」参与完成判定 ⇒ **必须同时生效**，否则中间态是「有缺口但不算数」（= 什么都没修）。
3. **同函数**：S-01(C) 与 R-05 都改 `pipelineDispatchProblems`；S-01(A) 与 T-06 都改 `ledgerApprove.execute`。

### 9.2 合并后的改动清单（**14 个改动点，按文件而非按缺陷组织**）

| # | 文件 | 改动点（函数 / 行） | 服务的缺陷 | 顺序要求 |
|---|---|---|---|---|
| 1 | `src/shared/pipeline.ts` | `ApprovalState` 加 `'unattested'`（`:34-41`） | S-01(C) | 可独立先合（新增联合成员不改行为） |
| 2 | `src/shared/pipeline.ts` | `approvalStateOf` 加凭据检查（`:351-353` 之后） | S-01(C) | 与 3 同批 |
| 3 | `src/shared/pipeline.ts` | 新增 `approvalAttestationProblems(units, resolve)` | S-01(C) | 与 2 同批 |
| 4 | `src/shared/pipeline.ts` | `approvalDecisionProblems` **保持单参数不动** | S-01(B，仅当采纳) | 见 §2.2 B 的 [待拍板] |
| 5 | `src/shared/pipeline-view.ts` | 新增 `taskVerificationProblems` / `taskAcceptanceProblems`；改写 `allTasksVerified` / `allTasksAccepted`（`:175-193`） | **R-01** | 与 6/8 同批 |
| 6 | `src/shared/pipeline-view.ts` | `pipelineDispatchProblems` 末尾追加 G3 段 + `requirementOfTask`（`:642` 之后） | **R-05** | 与 5 同批；若含 S-01(C) 凭据校验也在此 |
| 7 | `src/shared/pipeline-view.ts` | `refsOf` 统一覆盖字段（`:692 / :696 / :714`） | R-10（R-05 的前提） | **必须先于 6** |
| 8 | `src/shared/pipeline-view.ts` | 去掉 `:325-327` / `:340-344` 的重复 push（改为复用 5 的数组） | R-01 附带 | 与 5 同批 |
| 9 | `src/shared/stage-controls.ts` | `legacy()` 三层判据（`:271`）+ `UnitProvenance` / `setProvenanceResolver` | **S-02** | **必须最先**（见 §3.2 ④） |
| 10 | `src/modules/tools.ts` | `provenanceResolverOf` + 在三个出口注入 resolver | S-02 | 随 9 |
| 11 | `src/modules/tools.ts` | `ledgerApprove.execute` 三件事一次改完：①`proceedGate` ②`allowApprovalShard` ③`validateLedgerStructure:true`（`:1994 / :2093 / :2107`） | S-01(A) + **T-13** + **T-06** | 与 12 同批 |
| 12 | `src/server/hob-write.ts` | `APPROVAL_ONLY_SHARDS` / `isApprovalOnlyPath` + `checkLedgerUnitWrite` 首行 `refuse`（`:163 / :1022`） | S-01(A) | 必须先于 11 |
| 13 | `src/modules/tools.ts` | `ledgerHealthOf` 新增 + `repairOf` 换判据（`:711 / :1649`） | **T-05** | 与 9/10 同批（L-C） |
| 14 | `src/server/hob-write.ts` | 冻结分片守卫（可选，`unit-01..06`） | S-02（加固） | 最后 |

> **编号 4 是「不改」**：列出来是为了明确「B 方案若被否 ⇒ 这一格保持不动」，避免下一个人以为漏了。

### 9.3 提交顺序（一个 PR 内 4 个 commit，可分别回退）

~~~text
commit-1  [S-02 地基]  #9 + #10 + #13（provenance + ledgerHealthOf）   <- 行为零变化，存量 177 行仍豁免
commit-2  [S-01 收窄]  #12 + #11（白名单 + 闸门 + 结构校验）            <- 消除自证写入路径
commit-3  [R-05/R-10]  #7 + #6                                          <- G3 进闸门
commit-4  [R-01 强判]  #5 + #8 + #1/#2/#3（若 C 已就绪）                <- 让缺口参与完成判定
~~~

**每个 commit 的退出条件**：
- commit-1：`node /tmp/fix_probe_s02_ledger.mjs` 前后缺口数**相等**；
- commit-2：`write_hob` 写批准分片被拒 + 隔离会话调 approve 被拒；
- commit-3：图有环 / 悬空 / 未覆盖 ⇒ 派活被拒；
- commit-4：独立性违规账本 ⇒ `chainCompleted === false`。

### 9.4 回退粒度

| 回退目标 | 操作 | 影响 |
|---|---|---|
| 回到合并前 | 按 commit 逆序 revert（4 个 commit 互相独立） | 无数据变化 |
| 只回退 R-01 的严格性 | 删 commit-4 | 回到「有缺口但不算数」（旧行为） |
| 只回退 S-02 | 删 commit-1 | 回到「自填豁免」（S-02 复现，但不更坏） |

---
## §10 联动与冲突矩阵（**七条互相之间的全部约束**）

| 关系 | 类型 | 必须同批？ | 冲突点 / 处置 |
|---|---|---|---|
| S-01 × S-02 | 同文件（pipeline.ts / stage-controls.ts） | **是**（L-A） | 无直接冲突；但都让「以前绿的变红」 |
| S-01 × R-05 | **同函数** `pipelineDispatchProblems` | **是** | 若 S-01(C) 也要在此校凭据，必须与 R-05 一次改完 |
| S-01 × T-13 | **同函数** `ledgerApprove.execute` | **是** | 见 §8.2 ④；合并后只碰一次 |
| S-01 × T-06 | 同函数（`validateLedgerStructure`） | **是** | 三件事一次改（闸门 / 白名单 / 结构校验） |
| S-01 × R-15 | 判据去重 | **建议是** | B 方案若采纳，回执正则必须收敛为 `approvalReceiptPattern` 单实现 |
| S-02 × T-05 | 共用 `stageControlProblems` 输出（L-C） | **是** | 顺序：先 S-02 地基（commit-1，行为零变化）再 T-05 |
| S-02 × R-01 | 共用「历史豁免」概念 | **是** | R-01 的宽限期判据**必须复用** S-02 的 provenance，不得另用 `created_at` |
| R-05 × R-28 | 同判据、不同文件（L-B） | **是** | 只做 R-05 = 多轨仍绕过 |
| R-05 × R-10 | 前置 | **是** | 不修 R-10 ⇒ R-05 对按文档写的账本误报 |
| R-05 × O-34 | 放大关系 | **是（或 O-34 先修）** | 图判据接进闸门后，旧方案的任务环会阻断当前任务 |
| R-01 × T-08 | 可见性前提 | **是** | 否则「卡在 5 步但看不到为什么」 |
| R-01 × R-02 | 同源 | **是** | 否则 `summarizeStage` 与 pipeline 立刻分叉 |
| R-01 × S-03 | 放大关系 | **建议是** | S-03 的 fail-open 在强判据下会直接决定 G5 |
| R-01 × T-13 | 互补 | **建议是** | 否则 `hob_orch_control` 成了绕过强判据的捷径 |
| T-05 × T-02 | 共用出口 | **是** | §8.1 已列，拆开则 `repairOf` 依赖恒空判据 |
| T-13 × T-06 | 同函数 | **是** | 见上 |
| R-28 × D-5 | 决策落地 | — | 本条即 D-5 的 A 方案 |

**与未列入本规格的缺陷的边界**（防止下一个人重复修）：

| 缺陷 | 为什么不在本规格 | 去哪修 |
|---|---|---|
| R-02（5 份完成实现） | 它需要「单一真源」整体设计，超出判定链 | 另一份规格（真源层） |
| R-03 / R-04（步名 / 步数） | 纯词表 | 文档契约规格 |
| T-01 / T-06 / T-07（写入守卫 / 投影事务） | 账本写入域 | 账本域规格（T-06 的 approve 那一处已并入 §9 编号 11） |
| T-02（4 套账本健康） | 与 T-05 同批，但出口收敛本身是独立工作 | 账本域规格（本规格只做 `ledgerHealthOf` 这一个出口） |
| T-03 / T-04 / T-09（可观测性） | 客户端 / 投影域 | 客户端域规格 |
| O-35 | 已并入 T-13（§8） | 本规格 |
| R-12（revision 严格性） | 需 D-4 拍板 | 见 §11 D-SPEC-2 |

---

## §11 [待拍板] 清单

> 格式：**问题 | 选项 | 推荐 + 一句话理由**。本规格不替用户决定。

**[待拍板] D-SPEC-1 · `hob_pipeline_approve` 的 `dryRun` 要不要也过 `proceedGate`？**

- 背景：§7.4 的 T-13 建议「`dryRun` 保持放行」；但 `approve` 的 `dryRun` 会返回一个 `decisionId`（`tools.ts:2089`），调用方可能当已批准。
- 选项：
  - **A**：`dryRun` 也拦（与 `write_hob` 不一致，但**语义更安全**）
  - **B**：`dryRun` 放行（与 `write_hob` 一致，纯演练不主张）
- **推荐 A**：演练返回的 `decisionId` 是一个**可被误读为已落账的标识**；要么拦，要么把演练返回值改成不含 id（**那是选项 C，成本更低**）。
- **选项 C（新增，成本最低）**：`dryRun` 保持放行，但返回值**不再给 `decisionId`**，改给 `proposedId` 且文案明写「未落盘、该号未被占用」。

**[待拍板] D-SPEC-2 · `revision` 是否严格等于内容身份（R-12 / D-4）？**

- 背景：首次批准前改内容、不递增 `revision`，当前**不被拦**（`pipelineWriteProblems` 只在「已有决定」时才检查，实测 `writeProblemsNoDecisionYet = []`）。
- 选项：**A** 严格（revision 必须随内容变）/ **B** 允许草稿期原地改
- **推荐 A**：否则「第 N 版」在批准前不唯一，事后无法证明某条 decision 批准的是哪份内容；代价是草稿期频繁升版，需在工具层**自动递增**来抵消。
- ⚠ 本规格**不含**这条的改法（它属于写入守卫），只在 §9 编号 4 标注了它的存在。

**[待拍板] D-SPEC-3 · S-01 的 C 选项若宿主不提供 answerer，接受降级为 A 吗？**

- 选项：
  - **A**：接受降级 + 在 README「已知限制」登记「批准由 Hob 转录，不等于用户操作」
  - **B**：不接受降级，宁可不落 C（继续用 A，并明确记录 I-4 不成立）
- **推荐 A**：有 A 的收窄 + 如实标注，比「假装修好了」好；两者差别只在文案与 S-01 的状态标记。
- ⚠ 无论选哪个，**都不得把 S-01 标成「已根治」**。

**[待拍板] D-SPEC-4 · R-01 的三段式上线，宽限期是否接受「影子模式 ≥1 周」？**

- 选项：**A** 接受（先影子、再宽限、再全量）/ **B** 直接全量（会让存量账本立刻变红且无修复入口）
- **推荐 A**：直接全量会让真实项目的「已完成」翻成「未完成」，而历史 VER/ACC 的证据**补不回来**。
- ⚠ 本规格**未实测**真实账本的 G4/G5 违规数（§4.3.1 的 survey 还没跑）⇒ 影响面**未验证**。

**[待拍板] D-SPEC-5 · R-05 的覆盖缺口是否要「宽限到任务图首次被批准」？**

- 背景：G3 进闸门后，**存量任务图**（在 G3 之前建的）可能因为「验收条件未逐条覆盖」而派不出去。
- 选项：**A** 不宽限（与 R-01 一致的严格）/ **B** 只对 v3 新任务严格，存量任务图仅提示
- **推荐 B**：覆盖缺口是「拆任务没拆干净」，存量任务图**可能已经执行过**；对它们硬拦没有修复路径（任务已经 built）。
- 与 D-SPEC-4 的判据**同源**（都用 provenance），不得各写一套。

---

## §12 逐条验收断言汇总（可直接进 CI）

| 缺陷 | 断言（必须失败得起来） | 负向对拍（改坏哪一行 ⇒ 必红） |
|---|---|---|
| **S-01(A)** | `writeHobFile({file:'ledger/units/unit-pipeline-approval.toml'})` ⇒ `reason==='approval-path-reserved'` | 删 `isApprovalOnlyPath` 调用 |
| **S-01(C)** | 伪造 `approval_request_id` ⇒ `approvalAttestationProblems` 非空 | 删 `approvalStateOf` 里的凭据检查 |
| **S-01(C) 降级** | 无 answerer ⇒ 工具返回 `user-approval-not-granted` 且账本零新增 | 把 `unavailable` 当 `allowed-once` |
| **S-02** | v3 + `pre-control` ⇒ 报 C-11（无论 created_at） | 让 `legacy()` 重新读 `clarify_legacy` |
| **S-02 存量** | 177 行账本改动前后缺口数**相等** | 把 provenance 缺省改 `historic:true` |
| **R-01** | 独立性违规账本 ⇒ `activeStage===5` 且 `chainCompleted===false` | 删 `verificationProblems` 那一行 |
| **R-01 过严对照** | 全合规账本 ⇒ `activeStage===7` | 把强判据写成「有任意一条就全红」 |
| **R-01 重复 push** | `blockedBy` 里 `(rule,unit)` 唯一 | 恢复两个循环各 push 一次 |
| **R-05** | 有环 / 悬空 / 未覆盖 ⇒ 派活被拒 | 删 `taskGraphOf` 那段 |
| **R-05 防误伤** | 别的任务有环、本条干净 ⇒ 本条通过 | 把作用域写宽到整个需求 |
| **R-10 联动** | 用 `acceptance_criteria_refs` 的合规任务 ⇒ 不报覆盖缺口 | `refsOf` 只读 `criteria_refs` |
| **R-28** | 未批准任务的多轨首派 ⇒ 拒且盘上无计划文件 | 把门禁挪到 `writeWorkPlan` 之后 |
| **T-05** | 只有 L-2 缺口的账 ⇒ `repairOf` 成功 | 换回 `stageHealthOfLedger` |
| **T-05 防逃闸** | 无缺口单元 `repairOf` ⇒ 仍拒 | 删 `targetProblems.length===0` 分支 |
| **T-13** | 隔离会话 `approve` / `control{accept}` ⇒ 拒 | 删任意一个 `proceedGateOf` |
| **T-13 防过严** | 隔离会话 `control{stop}` ⇒ 放行 | 把 stop 也纳入 WRITE_ACTIONS |

---

## §13 本规格的局限（**诚实标注**）

1. **真实账本的影响面未实测**：§4.3.1 的 survey 脚本尚未跑；本规格**不声称**「R-01 影响小」。
2. **C 选项的 answerer 是否存在于当前部署：未验证**。本规格给出三条判据（§2.2 C 的降级表），但**没有**做端到端探针。
3. **宿主「会话消息可回读」的具体 API：未验证**（§2.2 C2）。C2 的可行性依赖这一条。
4. **S-02 的 `ledger-generation` 判据**：依赖 `ledger.toml` 的 `created_at`（`ledger-lifecycle.ts:81-92` 已校验可解析），但其**语义**（是"建账时刻"还是"最后一次激活时刻"）我**未确认** ⇒ 实现时必须先核对，否则会误判一批账本。
5. **行号**：本规格的行号在 **2026-11-10** 读码确认；若源码已变，以源码为准。
6. **未给出改法的项**：D-SPEC-2（R-12 revision 严格性）只标了位置与选项，**没有**代码形状 —— 那属于写入守卫规格。

---

## §14 一句话总结

**这七条里，只有 R-01 会让存量账本变红，其余六条都是「零行为变化」的入口级封堵。**
正确的做法的顺序是：**先用 S-02 的地基（provenance）把「历史」变成可核事实 ⇒ 再收窄写入路径与闸门（S-01-A / T-13 / R-28 / T-05）⇒ 再把 G3 接进派发（R-05 + R-10）⇒ 最后让强判据生效（R-01 + T-08 + R-02）⇒ 有余力再上 C。**
