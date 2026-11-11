# 编排派活与回传闭环 · 业务逻辑审查（t3 · dispatch-auditor）

> 审查范围（只读）：`src/modules/orchestrator.ts` / `tools.ts` / `bus.ts` / `session-create-channel.ts` /
> `exec-progress-route.ts` / `tasks-progress-route.ts` / `stages-route.ts` / `work-plans-route.ts` /
> `unseen-tools-route.ts` / `live-route.ts`；`src/server/card-wake.ts` / `orch-state.ts` / `effects-queue.ts` /
> `handoff-effects.ts` / `work-plan-state.ts` / `write-delivery.ts` / `live-hub.ts`；`src/shared/work-plan.ts` /
> `exec-progress.ts` / `exec-protocol.ts` / `work-state.ts` / `tasks-progress.ts` / `live-protocol.ts` /
> `live-signal.ts` / `unseen-tools.ts` / `work-mode.ts`。
> 未改任何源码；本文件是本次唯一写入。
> 行号口径：`文件:行号`，均取自本次实际读到的源码；给不出位置的结论一律标「未验证」。

---

## ① 本域业务职责（3 句内）

把「一句话的工作」变成**可结算的一次派发**：`hob_dispatch` 过门禁 → 投递给执行会话 → 登记 watch → 等它 `running→idle` → 自动把回执送回派活方，并把「派发/回传」投影成账本 `RUN`/`TSK` 事实。
它同时是**多轨计划**的唯一推进器（`dispatchPlan` + `advanceWorkPlans`）：首波扇出、依赖轨按 `returned` 接力、全轨终态后汇合。
它还负责**跨进程副作用**（handoff 补投走 Effects/Outbox）与**看护唤醒**（被派会话跑完后叫醒派活方，而不是让派活方空等）。

---

## ② 主链路：入口 → 状态 → 落盘 → 出口

### 2.1 入口：`hob_dispatch`

| 步 | 位置 | 说明 |
|---|---|---|
| 工具定义 | `src/modules/orchestrator.ts:8702-9005` | 参数 `sessionId/message/taskId/tracks/singleTrackReason/singleTrackEvidence` |
| 单目标 taskId 硬校验 | `orchestrator.ts:8805-8836` | 无 `tracks` 时：`lifecycleOf` 判账本可用（8815）、`taskId` 必须匹配 `/^TSK-[A-Za-z0-9-]+$/`（8826） |
| 门禁调用 | `orchestrator.ts:8837-8849` | `proceedGateOf?.(exec, {taskId, planId})`，非空即拒（`returnRegistered:false`） |
| 门禁装配 | `src/preset/tools.ts:2164-2172` | `proceedGateFor(exec?.agent ?? exec) ?? stageGateFor(exec, scope)` |
| 策略闸 | `src/preset/tools.ts:545-592` | `non-hob` / `no-policy-service` ⇒ 放行（559/561）；`mayProceed===true` ⇒ 放行（562）；其余按 source 给可读拒绝 |
| 阶段/管线闸 | `src/preset/tools.ts:2155-2163` → `src/modules/tools.ts:812-937` | 账本就绪度+生命周期（831-847）→ 单任务：`stageGateAtLedger` + `pipelineDispatchProblems`（849-879）→ 多轨：按 planId 找盘上计划再逐轨判（881-932）→ 都没有：只报健康（934-936） |
| 单目标档位校验 | `orchestrator.ts:8937-8966` + `shared/work-plan.ts:375-405` | 自动档要 `singleTrackReason`；多会话档还要 `candidatePieces` 且不得存在独立对 |

### 2.2 派发：`dispatch()` 的闸门顺序（`orchestrator.ts:4894-5231`）

1. **执行预设硬校验**（4908-4931）→ 未通过直接 `ok:false`（`preset-gate-unavailable`/`preset-gate-refused`）。
2. **stop 闸**（4941-4950，按 `(owner, wsRoot)`）。
3. 拒投自己（4953-4955）、空消息（4956-4958）。
4. **档位/写轨闸**（4966-5023）：单会话档禁止第二条活动轨；`accessType==='write'` 时同工作区只许一条写轨。判据读 `activePlansAt()` 的盘上计划（3981-4011，`stoppedPlanOccupiesSlot` 让「已 stop 的派活方」不占槽）。
5. **同目标重复派发闸**（5043-5052）：内存 `watches.get(target)` 且 `!reported` ⇒ 拒。
6. **同目标盘上闸**（5085-5138）：扫 `<ledgerHome>/<name>/runtime/orch-watches.json` 的 `pending`，同 `wsRoot` 且无 `deliveredAt` ⇒ 拒（跨工作区同 id 不互相阻塞）。
7. **首派即绑定**（5162-5196）：`bindSession(... via:'dispatch')`，已归别人 ⇒ 拒（不猜、不改绑）。
8. **RUN 预登记**（5202-5230）：`taskId` 真实且判得出 `ownerWsRoot` ⇒ `applyProjection(kind:'dispatch')`；`!ok` 或拿不到 `createdRunId` ⇒ **不投递**（`run-intent-failed`）。
9. 投递：`bus.deliver(resolvedTarget, message, 'followup'|'steer')`（5231）；失败按 `classifyDeliveryFailure` 三分类落 `closed`（5256-5311）+ RUN `refuse`（5313-5328）。
10. 登记 watch（5332-5374）：`owner/watcher = self`、`ownerWsRoot = wsRootOfSession(owner)`、`sawRunning = (agents.get(target).status==='running')`。
11. 投递后投影（5387-5414）：失败只写 `w.ledgerProjection.dispatch` + warn，**不回滚投递**。
12. 计划附着 / 隐式计划（5419-5482）。
13. 落盘 + 看护登记（5486-5644）：按 `(file, owner)` 分区写 `pending`（5568-5576），`registerWatchEntry`（5596-5620），`clearHandoffs`（5629-5633）。

### 2.3 多轨：`dispatchPlan()` → `advanceWorkPlans()`

| 步 | 位置 |
|---|---|
| 校验 | `orchestrator.ts:4751-4753` → `shared/work-plan.ts:477-719`（含写轨串行化 619-704、串行化后再查环 712-716） |
| 跨计划冲突 | `orchestrator.ts:4017-4059`（重复 planId / 单会话已有轨 / 同工作区已有写轨 / 同会话两轨） |
| 拒绝「永远不动」 | `orchestrator.ts:4785-4802`（首波为空且全有前置 ⇒ 拒） |
| 落盘（全 pending） | `orchestrator.ts:4807-4819` |
| 首波扇出 | `orchestrator.ts:4832-4869`，每轨复用 `orch.dispatch()`（4834） |
| 回写 trackStates | `orchestrator.ts:4873-4878`（`plan.state = failed>0 ? 'failed' : 'running'`） |
| 推进器 | `orchestrator.ts:4447-4611`：合并回传态（`mergeTrackStates` 4240-4294）→ `workPlanProgress().ready`（`work-plan.ts:962-984`）→ 逐轨 `dispatch` → 写回 → 终态失败自动归档（4574-4581）→ 汇合/终态切 `waiting`（4592-4605） |
| 触发点 | 回传结算 `advanceWorkPlansForWatch`（4614-4633，由 7620/7701 调）、读计划（5683）、就绪扫描（8355-8366） |

### 2.4 回传：`agent/status` → `settle()` → 投影

| 步 | 位置 |
|---|---|
| 事件入口 | `orchestrator.ts:8385-8464`：`running` ⇒ `sawRunning`；`idle && sawRunning && before==='running'` ⇒ `settle(w,'event')`（8442-8451） |
| 唯一结算点 | `orchestrator.ts:7423-7779` |
| 幂等①（内存） | 7425/7438 `reported`；**在任何 await 之前置位**（7503） |
| 幂等②（盘上） | 7457-7460 `deliveredAt` ⇒ 只清账不重发；7461-7476 `deliveryAttemptAt` 且非本代投递中 ⇒ 落「结果未知」、不自动重投 |
| stop 闸 | 7488-7495：命中 ⇒ `relaysBlocked++` 并 `return false`（**不改状态、不删 watch**） |
| 无收件人 | 7497-7501：`watcher === ''` ⇒ 落 error，不投 |
| 先写后发 | 7503-7512：`reported=true` + `deliveryAttemptAt` 先落盘 |
| 回执正文 | `buildReceipt` 1609-1636（结论 + 改动文件 + 「这不是验收」） |
| 投递 | 7610-7615 走 `deliverInternal`（跳过「拒投自己」） |
| 回传投影 | 7649-7677：`kind:'return'` + `progressRefs = receiptProgressRefsOf(lastAssistantText(session))`（1595-1607） |
| 要澄清 | 7694-7698：回传正文「待决问题」非空 ⇒ `clarifyAt` |
| 清账 | 7700-7708 `finalizeDelivery`，失败返回 `false`（「账没清掉就是没结算完」） |

### 2.5 投影到账本（`server/projection-writer.ts` + `shared/ledger-projection.ts`）

- 串行化：整场投影按账本根排队（`projection-writer.ts:68-81`，注释记了实测「两次都写 RUN-001」的现场）。
- 幂等键：`dispatch:<task>:<target>:<at>` / `return:<task>:<target>:<at>`（`ledger-projection.ts:265-272`）。
- 派发 ⇒ `RUN registered` + `TSK todo→doing` + `link run_ids`（281-339）；已有未回传 RUN ⇒ `skipped`（305-310）。
- 回传 ⇒ `RUN registered/running→returned`（409-419）；**只有 `progressRefs` 非空才 `TSK doing→built`**（429-437，注释写明与 LP-3 对齐）。
- 失败三档：`ops.length===0 ⇒ ok:false`（`projection-writer.ts:207-217`），`describeProjection` 区分 skipped/undecidable（716-721）。

### 2.6 唤醒

| 步 | 位置 |
|---|---|
| 唯一 `awake` 入口 | 派发路径内 `registerWatchEntry`（`orch-state.ts:2562-2601`；调用点 `orchestrator.ts:5598`） |
| 判定 | `judgeWatchGuards`（`orchestrator.ts:466-696`）：意图必须 `expecting-return`（562-566）；任一读数判不出 ⇒ `undecidable` 不叫（655-660） |
| 武装 | `armWatchTimer`（6986-7019）：`hasAwakeWatch()` → `watchNeedsTimer`（`orch-state.ts:2851-2867`）→ 单次 `setTimeout(30s)`，跑完再评估 |
| 复查 | `reviewWatchGuards`（7832-8010） |
| 投递链 | `deliverWakeOnce`（2772-2844）：`markWakeLogged`（先落盘）→ `deliverInternal(owner)` → `markWakeDelivered` → 成功则 `setWatchState(..., keepWakeAttempts:true)` 回 `waiting` |

### 2.7 跨进程副作用：Effects/Outbox

`write_hob(dispatchTo)` 记账后失败 ⇒ `enqueueHandoff`（`tools.ts:1726-1739`）→ 队列（`handoff-effects.ts:35-71`）→ 后台重试 `orch.dispatch`（`src/preset/tools.ts:204-213`）→ 成功清同一条 handoff（`handoff-effects.ts:53`）。
队列实现：单写者文件锁（`effects-queue.ts:149-208`）、同 `(kind,key)` 合并 + generation（228-245）、指数退避封顶（344-348）、`ordered/limit` 调度（299-325）。

---

## ③ 契约与不变量清单（当前代码里**真正被强制**的）

| # | 不变量 | 强制点 | 强度 |
|---|---|---|---|
| I-1 | 一次派发 = 一条 watch；同 target 同时只许一条未结算 | 内存 `watches.get(target) && !reported`（`orchestrator.ts:5043-5052`）+ 盘上同 `wsRoot` 扫描（5103-5138） | 强（含跨重载） |
| I-2 | **同一 task 同时只许一条未回传 RUN**（因此同 task 不能并发派给两个会话） | RUN 预登记 `!ok` 或拿不到 `createdRunId` ⇒ 不投递（5208-5230）+ `dispatchOps` 的 `existingRuns.some(registered/running) ⇒ skipped`（`ledger-projection.ts:305-310`）⇒ `ops=[] ⇒ ok:false`（`projection-writer.ts:207-217`） | 强（**仅当判得出 ownerWsRoot**，见 D-01） |
| I-3 | 单会话档第二条活动轨必拒；同工作区写轨串行 | `orchestrator.ts:4999-5021`（派发侧）+ `work-plan.ts:505-507/607-704`（计划侧，写轨自动串行化） | 强 |
| I-4 | 回传**至多投一次**（D4） | `reported`（7425/7438/7503）+ 盘上 `deliveryAttemptAt`/`deliveredAt`（7457-7476）+ `delivering` 集合（7469） | 强（有「未知结果不重投」的保守分支） |
| I-5 | 回传 ≠ 验收；**只有小步验证读数才迁 TSK built** | `ledger-projection.ts:429-437` | 强 |
| I-6 | 收件人只来自记录自己的 `owner/watcher`，判不出就不投 | `7497-7501`、`card-wake.ts:2634-2648`、`DispatchWake.register` 拒 `owner===sessionId`（2184-2194） | 强 |
| I-7 | 唤醒 at-most-once + 顺序 落盘→投递→标记 | `markWakeLogged`（`orch-state.ts:2913-2949`，幂等 2932）→ `markWakeDelivered`（2961-3019，缺 `wakeLoggedAt` 直接拒 2983-2985，已投则 `skipped` 2987） | 强 |
| I-8 | 只有 `expecting-return` 允许唤醒 | `work-plan.ts:1033` + `orchestrator.ts:562-566` | 强 |
| I-9 | 计划档位冻结：`modeSnapshot` 优先 | `work-plan-state.ts:333`（写）、`work-plan.ts:993-995`（唯一读法） | **弱**：见 D-10 |
| I-10 | 同一账本一个 Effects writer | `effects-queue.ts:149-178`（`open(...,'wx')`）+ 陈旧锁按 pid 判活接管（187-208） | 强（跨进程 fail-closed） |
| I-11 | 回传只迁 `RUN.returned`，不建 ACC、不写 pass | `ledger-projection.ts:364-439`（`verdictOps` 单独一支） | 强 |
| I-12 | 验收必须账本里有 `pass` ACC 且过 `acceptanceProblems` | `tools.ts:950-973` + `orchestrator.ts:10791-10819`（未注入即 fail-closed） | 强 |

**投递语义（Effects/Outbox）的准确表述**：**至少一次**。
- 去重键 = `(kind, key)`，其中 key = `handoffEffectKey(h)` = `h.kind + ':' + h.ref`（`handoff-effects.ts:13-15`）；
- handler 先 `deliver` 再 `clearHandoffs`（`handoff-effects.ts:50-54`）⇒ 进程死在两步之间会**重投**；
- 队列侧没有「消息已投」的标记，只有「行还在不在」（`effects-queue.ts:335-339` 成功才 splice 掉行）。

---

## ④ 缺陷/风险清单（先「掩盖其他问题」，再按严重度）

> 排序口径：能**让失败不可观测 / 门禁可绕过 / 状态不同步**的在前。

### D-01 · blocker · 判不出派活方工作区根时，**账本投影整段静默跳过**，工具仍报 `ok:true`，状态面一个字不提

**位置**：`src/modules/orchestrator.ts:5208`（`preTaskId !== '' && preTaskId !== 'implicit' && preOwnerWsRoot !== undefined`）、`orchestrator.ts:5387`（`if (ownerWsRoot !== undefined && ...)`）、`orchestrator.ts:7651`（`resolveLedgerRoot(..., w.ownerWsRoot)`）、`orchestrator.ts:10008-10017`（渲染只在 `w.ledgerProjection !== undefined` 时出行）。

**证据**：
```ts
// orchestrator.ts:5202-5211
const preTaskId = typeof opts?.taskId === 'string' ? opts.taskId.trim() : ''
const preOwnerWsRoot = typeof self === 'string' && self !== '' ? wsRootOfSession(self) : undefined
let preRunId: string | undefined
...
if (preTaskId !== '' && preTaskId !== 'implicit' && preOwnerWsRoot !== undefined) {
```
```ts
// orchestrator.ts:5387
if (ownerWsRoot !== undefined && typeof w.taskId === 'string' && w.taskId !== '') {
```
```ts
// orchestrator.ts:10008-10017
...(w.ledgerProjection === undefined
  ? []
  : [ ...dispatch?.ok === false ? [...] : [], ...return?.ok === false ? [...] : [] ]),
```

**影响**：`wsRootOfSession(self)` 判不出（会话不在本实例 / 宿主没给 cwd）时，**既不预登记 RUN、也不做投递后投影、也不做回传投影**，而 `w.ledgerProjection` 恒 `undefined` ⇒ 状态面那三行「账本投影未落」**永远不会出现**。于是：工具返回 `ok:true`、watch 正常落盘、回执正常回来，但账本里没有 RUN、TSK 不动、面板第 4 步永远「无独立执行记录」——**失败长得和「没派过活」一样**，正是本仓最忌的形态。同时 I-2（同 task 互斥）在这一档也**整段失效**（没有 RUN 预登记就没有互斥判据）。

**建议**：把「判不出 `ownerWsRoot`」落成**显式失败读数**而不是「字段不出现」：写 `w.ledgerProjection = { dispatch: { ok:false, applied:0, reason:'判不出派活方工作区根 ⇒ 未预登记 RUN' } }`，并让 `hob_dispatch` 的返回值回带该字段（现在 8986-9004 完全不回带）。要么就按「没有 RUN 就不是派发」直接拒绝（与 5197-5199 的注释口径一致）。

---

### D-02 · high · Outbox 补投链**三重静默**：`onError` 缺省 noop、无最大尝试次数、且补投的 dispatch **丢了 owner**（回执永远回不来）

**位置**：`src/server/handoff-effects.ts:45-56`、`src/server/effects-queue.ts:133`（`this.onError = opts.onError ?? (() => {})`）、`effects-queue.ts:340-349`（失败只记 `attempts/lastError`，无上限）、`src/preset/tools.ts:204-213`（`{ self: undefined }`）。

**证据**：
```ts
// preset/tools.ts:204-213
const q = start(
  ledgerRoot,
  async (target, message) => {
    const orch = ctx.get?.('hobOrchestrator') as HobOrchestrator | undefined
    if (orch === undefined || typeof orch.dispatch !== 'function') throw new Error('orchestrator unavailable')
    const r = await orch.dispatch(target, message, { self: undefined })   // ← owner 丢失
    if (r?.ok !== true) throw new Error(r?.reason ?? 'delivery failed')
  },
  join(ledgerRoot, 'runtime', 'orch-watches.json'),
)
```
```ts
// effects-queue.ts:344-348
current.attempts += 1
current.lastError = String(error)
const [initial, max] = handler.retry
current.dueAt = this.now() + Math.min(max, initial * 2 ** Math.min(current.attempts - 1, 16))
```
```ts
// orchestrator.ts:7497-7501（无 owner 的后果）
if (w.watcher === '') {
  w.error = 'no recipient (watcher empty): receipt NOT delivered'
```

**影响**：
1. 补投失败**零日志**（`startHandoffEffects` 未传 `onError`，队列默认吞掉）；
2. 补投**永不放弃**（无 `maxAttempts`，退避封顶 60s 后一直重试）——对「目标已归档」这类永久失败就是永久空转；
3. 即使补投**成功**，那次 `dispatch` 的 `self` 是 `undefined` ⇒ `owner/watcher` 都是空 ⇒ 执行会话跑完时 `settle()` 在 7497 直接落 `error`、**回执永不回来**。补投只完成了「把指针送到」，闭环仍然是断的。

**建议**：`deliver` 里传 `self: h.owner`（`PersistedHandoff` 已带 owner，见 `write-delivery.ts:186`）；`startHandoffEffects` 传入 `onError`（至少 `logger.warn` + 一条状态读数）；给 handler 加最大尝试数，到顶落一档「补投放弃，需人工」而不是无限重试。

---

### D-03 · high · 多轨派活的**任务链门禁在首次派发时形同虚设**（planId 指向的计划此刻还没落盘）

**位置**：`src/modules/tools.ts:881-935`（按 planId 从盘上找计划）、`src/modules/orchestrator.ts:4771-4816`（计划在门禁**之后**才写盘）、`orchestrator.ts:4024-4030`（同 planId 复用在计划侧被拒）。

**证据**：
```ts
// tools.ts:881-887
let plans: Array<{ plan?: { planId?: string; tracks?: Array<{ taskId?: string }> } }> = []
try { plans = listWorkPlans(ledgerRoot).filter((row) => row.state === 'ok') } catch { plans = [] }
const wantedPlan = String(opts.planId ?? '').trim()
const plan = wantedPlan === ''
  ? plans[0]
  : plans.find((row) => String(row.plan?.planId ?? '') === wantedPlan)
```
```ts
// tools.ts:934-936（找不到计划时的唯一出路）
/** ③ 无任务、无活动计划 ⇒ 只报健康，⛔ 不拿全局缺口当拒绝理由。 */
const h = stageHealthOfLedger(ledgerRoot)
return { blocked: undefined, health: { ok: h.ok, blockers: h.blockers } }
```
```ts
// orchestrator.ts:4771-4774（冲突检查）→ 4816（才写盘）
const conflict = planConflictProblems(ledgerRoot, normalized, self)
if (conflict.length > 0) return { ok:false, ... }
...
const stored = writeWorkPlan(ledgerRoot, plan)      // ← 门禁早已跑完
```

**影响**：`hob_dispatch({tracks})` 时传的 `planId` 是**新**计划号 ⇒ `listWorkPlans` 里没有它 ⇒ 落到 934-936 ⇒ `blocked: undefined` ⇒ **`pipelineDispatchProblems`（G1/G2/v3/C-20）对 tracks 一次都不跑**。而想「先落盘再派」也不行：同一 `planId` 第二次进入会被 `duplicate-plan` 拒（4024-4030）。单目标路径的两道校验（lifecycle 8815、TSK 正则 8826）也都写在 `if (!Array.isArray(args.tracks))` 里（8806/8826），对 tracks 一并跳过。⇒ **多轨是当前唯一能绕过任务链门禁的派发入口**。

**建议**：在 `dispatchPlan` 内、`writeWorkPlan` **之前**，用 `normalized.tracks` 的 `taskId` 逐个跑 `pipelineDispatchProblems`（与单目标同源，⛔ 不另写一份判据），任一非空即整份拒绝并原样带出 blockers。

---

### D-04 · high · G3（依赖环/悬空/覆盖缺口）**只进 blockedBy 文本，不进任何派发闸门**；且 G3–G6 的 blockedBy **到不了面板** ⇒「面板说卡住、却说不出卡在哪，而派活照样放行」

> 本条同时是对 pipeline-auditor 报告 P-03 与疑点 (b)(c) 的独立复核，**同源编号 P-03**。

**位置**：`src/shared/pipeline-view.ts:570-644`（`pipelineDispatchProblems` 全文不调 `taskGraphOf`）、`pipeline-view.ts:412-425`（G3 判定只在视图里）、`pipeline-view.ts:664-724`（`taskGraphOf` 定义）、`src/shared/stage-controls.ts:421-439`（`taskProblems` 不看 `depends_on`）、`stage-controls.ts:454-479`（`taskGraphRiskProblems` 只判「写同一路径却无串行依赖」=RP-5）、`src/shared/requirement-chain.ts:519-540`、`src/client/project-panel.tsx:95-113`、`project-panel.tsx:2654-2663`。

**证据（门禁侧，逐行核对 576-643）**：
```ts
// pipeline-view.ts:576-622（全部判据）
if (text(task.kind) !== 'task') return [{ rule:'C-20', ... }]
if (!isPipelineV3(task)) return [...]
const plan = units.find(...); if (plan === undefined || text(plan.kind) !== 'change') ...
if (!isPipelineV3(plan)) ...
if (text(plan.status) === 'superseded') ...
const planApproval = approvalStateOf(plan, units) ...
const reqIds = changeRequirementIds(plan) ... for (const rid of reqIds) { ... }
for (const p of taskProblems(task as any)) out.push(...)
for (const p of riskAssessmentProblems(plan)) ...
for (const p of riskObjectProblems(units)) ...
const bound = text(plan.risk_binding_digest) ...
out.push(...taskRiskProblems(task))
```
→ **没有 `taskGraphOf`、没有 `depends_on` 校验、没有 `acceptance_criteria` 覆盖校验**。

**证据（视图侧才有）**：
```ts
// pipeline-view.ts:412-417
const graphReady = graph.nodes.length > 0
  && graph.cycles.length === 0
  && graph.dangling.length === 0
  && graph.coverageGaps.length === 0
  && graph.nodes.every(...taskFullProblems...)
  && taskGraphRiskProblems(tasks).length === 0
```

**证据（面板侧）**：
```ts
// requirement-chain.ts:521-540 —— 只有 G1/G2 把 pipeline.blockedBy 搬进 next
if (pipelineGoverns && partial.pipeline.gate === 'G1-requirement') { partial.next = { ..., blockedBy: partial.pipeline.blockedBy } }
else if (pipelineGoverns && partial.pipeline.gate === 'G2-plan') { partial.next = { ..., blockedBy: partial.pipeline.blockedBy } }
```
```ts
// project-panel.tsx:95-113 —— G3~G6 一律回落到 chain.next
if (chain.pipeline.gate === 'G1-requirement' || chain.pipeline.gate === 'G2-plan') return { ..., blockedBy: chain.pipeline.blockedBy }
if (chain.pipeline.state === 'legacy') return { ..., blockedBy: chain.pipeline.blockedBy }
return chain.next
```
```ts
// project-panel.tsx:2662-2663
React.createElement('div', ...,
  blockers.length === 0 ? '卡在哪：没有主阻断' : '卡在哪：' + blockers[0])
```

**影响**：
- 派发侧：任务图成环 / `depends_on` 指向不存在的 id / 某条 `acceptance_criteria` 没有任何任务覆盖 ⇒ **照常派得出去**。唯一被拦住的是 RP-5（写范围重叠且无串行依赖），因为它挂在 `stageFieldProblems`（`stage-controls.ts:882`）里。
- 可观测侧：G3 时面板的「下一步」来自 `chain.next`（`nextAction()` 或第 4 步覆盖，`requirement-chain.ts:472-491`），`blockedBy` 多半是 `[]` ⇒ 渲染成 **「卡在哪：没有主阻断」**，而 `pipeline.blockedBy` 里明明写着「G3 · 任务依赖成环：…」（`pipeline-view.ts:305-307`）。
- 两者叠加：**面板显示「G3 卡住」+「没有主阻断」，派活却成功** —— 用户拿不到任何可核对的原因，下一个读面板的人会得出「系统说没问题」的结论。

**建议**：①把 `graph.cycles/dangling/coverageGaps` 纳入 `pipelineDispatchProblems`（按任务所属需求算，规则号沿用 G3）；②`requirement-chain.ts` 在 G3–G6 也把 `pipeline.blockedBy` 注入 `next.blockedBy`（至少让「卡在哪」那一行有话说）。

---

### D-05 · medium · 唤醒兜底链是**死代码**，但「该不该武装」的判据仍认为它活着 ⇒ 一次唤醒后 30 秒定时器**永不解除**，每轮全账本扫盘

**位置**：`src/modules/orchestrator.ts:603`（`const fallbackEligible = false`）、`orchestrator.ts:612-614`、`orchestrator.ts:7932-7950`（`rearmWakeFallback` 分支）、`src/server/orch-state.ts:2851-2867`（`watchNeedsTimer`）、`orchestrator.ts:6986-7019`（`armWatchTimer`）。

**证据**：
```ts
// orchestrator.ts:603-614
const fallbackEligible = false
...
if (!fallbackEligible) {
  return { ...withAct, shouldWake: false, reason: 'waiting', wakeFallback: false, wakeGaveUp }
}
```
```ts
// orch-state.ts:2862-2864
if (e.state === 'waiting'
  && (e.wakeLoggedAt !== undefined || e.wakeDeliveredAt !== undefined)
  && (e.wakeAttempts ?? 0) < limit) return true
```
```ts
// orchestrator.ts:7010-7013（跑完再看账决定续不续）
} finally {
  armWatchTimer(selfId)
}
```

**影响**：`deliverWakeOnce` 成功后会 `setWatchState(..., { keepWakeAttempts: true })` 回 `waiting` 并保留两枚 D16 时刻（2829、`orch-state.ts:2684-2701`）⇒ `watchNeedsTimer` 恒为真 ⇒ 30 秒定时器**永远续排**，每轮 `scanStateFiles` + 逐 owner `guardIntentContextOf`（含 `awaitingUserOf` 读会话 log）。而判定侧因 `fallbackEligible=false` **永远不会再叫**。⇒ 一半是空转（IO + 会话日志扫描），一半是**读数说假话**：注释（630-641）、`wakeAttempts`、「叫满 3 次转 stuck」（`orch-state.ts:2884-2891`）都描述了一个**不可能发生**的行为。`rearmWakeFallback`（`orch-state.ts:2765-2831`）在全仓唯一调用点是 7938，而它被 `wakeFallback` 门控 ⇒ **零可达调用**。

**建议**（二选一，⛔ 不要「留着不动」）：要么按 2026-11-04 的裁定（「唤醒一次就够」）**删掉兜底**并让 `watchNeedsTimer` 只认 `awake`，同时删掉 `wakeFallback/wakeGaveUp` 的文案；要么恢复兜底（去掉硬编码 false）并让 `rearm` 可达。现状是「两套说法并存，且空转那一套在跑」。

---

### D-06 · medium · 计划写盘失败被吞（`writeWorkPlan` 返回值丢弃 ×3）

**位置**：`src/modules/orchestrator.ts:4878`（首波派发后）、`orchestrator.ts:5437`（单目标附挂计划）、`orchestrator.ts:5478`（隐式计划）；对照 `orchestrator.ts:4556-4564`（推进器**有**检查）。

**证据**：
```ts
// orchestrator.ts:4873-4878
plan.state = failed > 0 ? 'failed' : 'running'
plan.trackStates = Object.fromEntries(rows.map((row) => [...])) as Record<string, WorkTrackState>
writeWorkPlan(ledgerRoot, plan)          // ← 返回值丢弃，无 warn
```
```ts
// orchestrator.ts:4556-4564（同一仓库里正确的那一份）
const written = writeWorkPlan(ledgerRoot, plan)
if (!written.ok) { svcCtx.logger?.warn?.(...) }
```

**影响**：首波写失败 ⇒ 盘上计划停在「全 pending」（4816 那一次写的）。推进器的 `persistedProgress`（4521-4524）为假 ⇒ `ready=[]` ⇒ **依赖轨永不接力**；而内存里那几条 watch 照常收尾，最终表现为「计划面一直 running / 全 pending，而实际活都跑完了」。隐式计划写失败（5478）更隐蔽：`listed.length === 0` 分支（5439）会**每派一次生成一份新隐式计划**。

**建议**：三处都读 `ok` 并落 warn + 计入 `status()` 读数（与 4556-4564 同款），失败时不要静默继续。

---

### D-07 · medium · 推进器的重入守卫会**吞掉一次推进请求**（同一 owner 的两处结算触发）

**位置**：`src/modules/orchestrator.ts:4441`（`advancingWorkPlans` Set）、`4453-4456`（key 占用即 `continue`）、`4614-4633`（`advanceWorkPlansForWatch`）、`7620` 与 `7701`（settle 内两次调用）。

**证据**：
```ts
// orchestrator.ts:4453-4456
for (const ledgerRoot of ledgerRoots) {
  const key = ledgerRoot + '\u0000' + (owner ?? '')
  if (advancingWorkPlans.has(key)) continue      // ← 直接跳过，没有「稍后再跑」标记
```
```ts
// orchestrator.ts:7620 与 7701 —— 同一次 settle 里先后触发
advanceWorkPlansForWatch(w, 'relay-settled')
...
if (finalizeDelivery(w, id, 'delivered')) {
  advanceWorkPlansForWatch(w, 'relay-finalized')
```

**影响**：第二次调用看到 key 仍被占 ⇒ 直接返回；依赖轨的启动要等下一次触发（`workPlans()` 读取 5683 / 下次 `agent/status` 8460）。不是永久丢（读计划会补推），但在「回传后立刻等下一轨」的现场表现为**「回传了、下一轨没动」**，而日志里两条 `relay-settled/relay-finalized` 都像执行过。

**建议**：把 `continue` 换成「置 pending 标记，当前这轮 `finally` 里再跑一遍」（`advancingWorkPlans` 改存 `{running, dirty}`）。

---

### D-08 · low · 首波部分失败即把整份计划置 `failed`，与「仍有 running 轨」并存

**位置**：`src/modules/orchestrator.ts:4870-4878`；`orchestrator.ts:3981-3985`（`failed` 仍算活动计划）；`orchestrator.ts:4574-4581`（只有 `terminal && failed` 才归档）；`src/shared/work-plan.ts:967/982`。

**证据**：
```ts
// orchestrator.ts:4870-4873
const accepted = rows.filter((row) => row.ok).length
const failed = rows.filter((row) => row.state === 'failed').length
const waiting = rows.filter((row) => row.state === 'waiting').length
plan.state = failed > 0 ? 'failed' : 'running'
```

**影响**：3 轨里 1 轨投递失败、2 轨已在跑 ⇒ 计划 `state=failed`，但 `progress.terminal` 为假 ⇒ 不归档 ⇒ 状态面同时显示「计划 failed」与「running 1/returned 0」；`activePlansAt` 继续把它算作占槽计划（3983 含 `failed`），单会话档会被这份「已失败但还在跑」的计划继续挡。

**建议**：首波部分失败不直接置 `failed`，仍按 `trackStates` 派生（`workPlanProgress`），把「有轨派发失败」作为**独立读数**而不是整计划状态。

---

### D-09 · low · 至少一次语义没有任何读数面说明；同一 handoff 可能被投两次；清账判据有两套

**位置**：`src/server/effects-queue.ts:335-339`、`src/server/handoff-effects.ts:50-54`、`src/server/write-delivery.ts:262-266`、`src/modules/orchestrator.ts:5629-5633`。

**证据**：handler 成功路径 `await deliver(...)` 之后才 `clearHandoffs`（`handoff-effects.ts:52-53`）；队列侧「成功才 splice 行」（`effects-queue.ts:338`）。⇒ 崩溃窗口内会重投。
另：`dispatch()` 的 `clearHandoffs` 用**时间窗**判据（`orchestrator.ts:5629-5633`：`h.at <= w.at`），而 `write-delivery` 已改成按 `ref` 精确匹配（`write-delivery.ts:262-266`，注释里写明「时间窗一刀切会清掉别人」）——**同一件事两套清账判据**。

**影响**：目标可能收到两份指针消息（内容幂等，代价是可读性）；两套清账口径会在「同工作区多个 handoff」时给出不同结果（一处清掉、一处留着），读数面上表现为「待投递忽有忽无」。

**建议**：状态面/文档明写「补投是至少一次」；把 `orchestrator.ts:5629-5633` 的时间窗判据收敛到 `ref` 精确匹配（与 `write-delivery` 同源），或把差异写成两条独立读数。

---

### D-10 · low · `modeSnapshot` 冻结只有「写 + 读」，**没有复验**（注释声称的那条函数不存在）

**位置**：`src/shared/work-plan.ts:1002-1010`（只有注释、**没有函数体**）、`work-plan.ts:993-995`（`planModeOf`）、`src/server/work-plan-state.ts:333`（写快照）、`src/client/work-plan-panel.tsx:233-238`（显示快照与当前档位差异）。

**证据**：
```ts
// work-plan.ts:1002-1010 —— 注释后直接结束，没有 export function
/**
 * 用**计划自己的档位快照**复验计划（`WM-8`）。
 * ...
 * @returns 按快照复验的结果；旧计划缺快照时用 `mode`。
 */

/** 看护意图（⚠ 与 `PersistedWatchEntry.state` 的 `waiting|awake` 正交）。 */
```
```ts
// work-plan-state.ts:328-336
export function newWorkPlan(input: WorkPlanInput, now = Date.now()): WorkPlan {
  return { version: WORK_PLAN_VERSION, ...input, modeSnapshot: input.mode, state: 'planned', createdAt: now }
}
```

**影响**：`modeSnapshot` 的**实际作用**只有两处：状态面显示（`orchestrator.ts:4102/4655`）与面板提示（`work-plan-panel.tsx:233-238`）。**推进与派发全部用「当前档」**：`advanceWorkPlans` 调 `dispatch()` 不传 mode（4529-4536），`dispatch()` 的档位闸自己现读 `svc.of(session).workMode`（4966-4979）。⇒ 用户建计划后改成单会话档，**旧计划的依赖轨接力会被新档位拦**（「计划按快照推进」这句话在运行时没有实现点）。这不是「冻结坏了」，而是**冻结只影响显示**——属「旋钮看起来在、实际不驱动」的一类。

**建议**：要么在 `advanceWorkPlans` 的 `dispatch` 调用里带 `workMode: planModeOf(plan)` 并让 `dispatch` 用传入值判档位闸（同时补上缺失的复验函数），要么把面板那句「之后改档只影响下一份计划」改成「只影响显示」。⛔ 不要让注释承诺一个不存在的实现。

---

### D-11 · low · 回传正文不含「账本投影未落」的信号（派活方在回执里看不到）

**位置**：`src/modules/orchestrator.ts:1609-1636`（`buildReceipt`）、`orchestrator.ts:7649-7677`（投影在 `buildReceipt` **之后**、`deliverInternal` 之后才跑）。

**影响**：回执先发、投影后落 ⇒ 回执正文里不可能带投影结果；`ledgerProjection` 只在 `hob_orch_status` 的 watch 行里出现（10008-10017）。派活方读回执时看到的是「活干完了」，账本里 RUN 却可能仍是 `registered`。

**建议**：不改投递语义（先写后发是对的），但把 `w.ledgerProjection.return.ok === false` 也带进**下一次** `hob_orch_status` 的头行（现在只在逐条 watch 行里），或让 `buildReceipt` 在「上一轮投影失败」时附一句。

---

## ⑤ 与其他域的边界与疑点（含无法单独判断的）

### 5.1 对 pipeline-auditor 三条疑点的判定（带位置）

**(a) 阶段门禁是否每次派活必经 —— 判定：是设计，不是漏洞（但多轨入口有一个真绕过点）**

- `proceedGateFor` 定义在 `src/preset/tools.ts:545-592`；返回**非空串**仅在三类：策略解析抛错（552-556）、`mayProceed !== true` 且 source 不是 `non-hob`/`no-policy-service`（573-591）。其余（`non-hob` 559、`no-policy-service` 561、`mayProceed===true` 562）返回 `undefined`。
- `stageGateFor` 定义在 `src/preset/tools.ts:2155-2163`，装配成 `proceedGateFor(...) ?? stageGateFor(...)`（2166-2167）。
- **`??` 只在左侧「非空」时短路**。左侧非空 = **已经拒绝**；此时跳过 stage 门不改变结论（照样拒）。左侧为 `undefined`（放行）时 **stage 门必被求值**，且 `root` 判不出时它返回「阶段门禁判不出…⇒ 本次不派单」（2157-2158，fail-closed）。
- ⇒ **不存在「proceed 放行导致 stage 被跳过」的路径**。这是「先策略、后阶段」的**与**语义，不是**或**。
- **但**：多轨（`tracks`）路径下 stage 门的计划分支**实际空转**（见 D-03）—— 那才是真正的绕过点，且与 `proceedGateFor` 无关。
- 附带一条（属策略域，不在本域裁定）：`no-policy-service` 返回放行（561）与 `mayProceed` 的 fail-closed 方向相反，是有注释的既有取舍。

**(b) G3 覆盖校验不拦派发 —— 判定：属实，独立复核确认；门禁里没有别处兜住**

- `pipelineDispatchProblems`（`src/shared/pipeline-view.ts:570-644`）**全文无 `taskGraphOf` 调用**（已逐行核对 576-643）。
- 派活闸门链（`src/modules/tools.ts:812-937`）里可能兜住的三处，逐一排除：
  - `stageGateAtLedger` → `evaluateGate` → `stageControlProblems(scopeUnits)`（`stage-controls.ts:1117-1120`）→ `stageFieldProblems`（861-886）里**唯一与依赖/图相关的是 `taskGraphRiskProblems`（882）**，它只判 RP-5「同一方案下两个任务写同一路径且无串行依赖」（454-479），**不看环、不看悬空、不看覆盖**；
  - `ledgerClosureProblems`（`stage-controls.ts:923-986`）L-1..L-4 只查 `parent/req_ids` **存在性**，不看 `depends_on`；
  - 就绪度/生命周期（`tools.ts:831-847`）只看「账本能不能推进」，与任务图无关。
- ⇒ **结论：P-03 成立，且没有间接兜住**。本域编号 **D-04（与 P-03 同源）**。
- 补充一处 P-03 未覆盖的**相反方向**矛盾（供其作者参考，本域不裁定）：`taskGraphOf` 的 `dangling` 把「在账本里存在但不是 task 的 id」排除（`pipeline-view.ts:672`：`&& !units.some(...)`），而同一节点的 `blockedBy` 却写「`<dep>` 不存在」（704-707）——同一事实两处结论相反；G3 的 `nextAction` 又按 `dangling` 出文案（422-424）。这正是「两种口径」的典型，但归属 pipeline 域。

**(c) 面板看不到 G3–G6 的 blockedBy —— 判定：属实，但 pipeline-auditor 的前提要改一个字**

- 确认：`requirement-chain.ts:521-540` 只在 `G1-requirement` / `G2-plan` 把 `pipeline.blockedBy` 搬进 `next`；`project-panel.tsx:95-113` 的 `nextOfPipeline` 对 G3–G6 一律 `return chain.next`；`chain.next` 的 `blockedBy` 多来自 `nextAction()` 或第 4 步覆盖（`requirement-chain.ts:472-491`，两处都是 `[]`）。渲染点 `project-panel.tsx:2654-2663`。
- **前提修正**：不是「编排侧拒绝派活、但界面没有可读原因」。G3 **根本不拒绝派活**（见 (b)）⇒ 真实形态是**「面板说 G3 卡住、却说不出卡在哪；而派活照样放行」**。这比「拒绝但看不到原因」更坏：面板给出的是一句**假信号**（「没有主阻断」），而系统实际放行。
- 归入 **D-04 的可观测性一半**。它如何掩盖其他缺陷：①它让 P-01/P-02 那类「强判据只进 blockedBy」的缺口在界面上**不可见**（用户看不到就没有压力修）；②它让「派活成功」与「面板说卡住」长期并存，读面板的人会先怀疑面板、而不是怀疑门禁，从而**推迟发现 D-03/D-04 这类真绕过**；③`blockedBy` 是唯一把「为什么不能派」变成人话的通道，它断在 G3–G6 就等于**门禁的拒绝理由没有出口**。

### 5.2 与账本域（t-ledger）的边界

- **RUN/TSK 迁移口径由 `shared/ledger-projection.ts` 单方面定义**（本域只负责「调用 + 回带 ok」）。其中 `dispatchOps` 要求 `task.revision` 为正整数（295-297），`returnOps` 要求同样（385-387）——**`revision` 缺失会让派发/回传投影直接 `undecidable`**，而 `dispatch()` 会因此 `run-intent-failed` 拒绝投递（5221-5227）。这意味着「账本里 TSK 缺 revision」会表现为「派活被拒，理由是一条账本投影原因」。是否应把这条判据前移到门禁（`pipelineDispatchProblems`）给出更早、更可读的拒绝？**需要与账本域一起定**。
- `refuseOps` 的回退选 RUN 逻辑（350-355：`byKey` 找不到就取该 task 下最早一条 `registered/running`）在「同 task 有历史 RUN」时可能把**旧 RUN** 标成 `refused`。当前有 I-2 互斥（D-01 之外成立），风险低；但一旦 D-01 成立（无 RUN 预登记），这条回退就会误伤历史 RUN。**需账本域确认这是否可接受**。
- `projection-writer.ts` 的并发串行是**同进程**的（68-81，注释明说「不冒充文件锁」）；跨进程单写者由 `doc-read.ts` 的 Single Writer Principle 承担。**跨进程并发投影是否会写出两条同号 RUN，本域无法单独判定**（需要宿主进程模型）。

### 5.3 与客户端域的边界

- 面板只渲染 `next.blockedBy` 的第一条 + 「另有 N 条」（`project-panel.tsx:2662-2664`）⇒ **即使修好 (c)，G3 的多条缺口也只显示第一条**。是否需要展开？**建议客户端域定**。
- `exec-progress` 路由（`modules/exec-progress-route.ts`）在客户端有消费（`project-panel.tsx:408` 用 `STAGES_EXEC_PATH`），但 `ok:false` 时返回 400（143）——客户端如何区分「三类 reason」？**未验证**（未读客户端错误分支全文）。
- `work-plans-route.ts` 明确「零写、只调同步 `status()`」（文件头 6-9），实际 `status()` 只读（`orchestrator.ts:4125-4191`），`advanceWorkPlans` 只在异步 `workPlans()`（5683）里。**这条边界是干净的**。

### 5.4 与策略域的边界（`work-mode`）

- 三档的**运行时**约束真正被强制的只有：单会话档的 `maxActiveTracks===1`（`orchestrator.ts:4999-5008` + `work-plan.ts:505-507`）、写轨串行（`work-plan.ts:607-704`）、多会话档的候选证据（`work-plan.ts:754-784`）。**`modeSnapshot` 冻结不参与运行时**（D-10）。
- `workModePolicy` 的 `allowParallelWrite: false` 是类型层面的常量（`work-mode.ts:110`），实际执行靠 `multiple-write-tracks`/`planConflictProblems`，**不是**读这个字段。⇒ 字段与执行是两处，本域只能确认「执行存在」，**不能确认二者永续同源**（无断言钉住）。

### 5.5 无法单独判断的

1. **`agent/status` 的语义是否真的只在「一轮结束」时发一次 `idle`**（`orchestrator.ts:8442` 依赖 `before === 'running'`）。若宿主在同一轮内多次 `running→idle`，`reported` 只能挡第二次投递，挡不住「第二轮被误判成新一轮」。**未验证**（需宿主源码）。
2. **`bus.deliver` 对冷会话的 `resolveAgent` 代价**（`bus.ts:989` 一带）：唤醒一个冷会话可能装配 agent、烧 token；回传路径每次都走 `deliverInternal`。在「派活方会话已关」的常见现场，这是**每次回传都叫醒一次**。是否为设计，**需产品裁定**。
3. **`DispatchWake` 与 `watches` 是否可能对同一会话双叫**：`DispatchWake.register` 的准入只挡 `owner===sessionId`（`card-wake.ts:2184`），不挡「这个会话同时也在 `watches` 里」。`hob_dispatch` 派出去的会话**没有**被 `dispatchWake.register`（唯一调用点 2195/5964 都是 `via:'taskboard-card'`）⇒ 目前不重叠。但若将来把 dispatch 的 target 也登记进去，就会双叫。**当前不成立，登记为边界风险**。

---

## 附：建议决策

- **Outbox 语义** | 选项：A 明确「至少一次」并在状态面写清 / B 改成「至多一次」（投前先标已投） | 推荐：**A** 理由：现状已是至少一次，改 B 会在崩溃窗口里丢补投，而补投正是这条链存在的理由。
- **多轨门禁（D-03）** | 选项：A 在 `dispatchPlan` 内写盘前用 `tracks` 逐个跑 `pipelineDispatchProblems` / B 先落一份临时计划再让 tools 层判 | 推荐：**A** 理由：B 会污染 `active/` 且与 `duplicate-plan` 直接冲突。
- **唤醒兜底（D-05）** | 选项：A 删掉兜底、承认「叫一次就够」 / B 恢复兜底 | 推荐：**A** 理由：用户 2026-11-04 已裁定「唤醒一次就够」，保留死代码只会让读数继续描述一个不存在的行为。
- **G3 是否进派发闸门（D-04）** | 选项：A 进（环/悬空/覆盖任一非空即拒派） / B 只进面板不拦派 | 推荐：**A** 理由：G3 是「任务拆得对不对」，派一个图上有环的任务等于把返工直接派出去。
