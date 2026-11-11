# REVIEW 分卷 2-1

> ⚠ 本文件是 `REVIEW.md` 的分卷（§4 裁定 + §5 缺陷总表按小节再拆）。
> 原文件 210KB 超 64KB 读上限，按 M 判据处置：**整块搬走 + 原位留指针**。

---

# REVIEW · 分卷 2

> ⚠ 本文件是 `REVIEW.md` 的**分卷**（原文件超 64KB 读上限，
> 按 `check:gitignore` 的 M 判据处置：**整块搬走 + 原位留指针**，⛔ 不是压缩）。
> 主文件：`docs/audit/business-logic-review/REVIEW.md`。

---

## §4 域间冲突与裁定

> 六份域报告不是互相独立的——它们彼此引用、彼此纠正。本节逐条记录**冲突、采信哪一方、以及为什么**。
> 保留这一节的理由：它是审查质量的证据。一份把所有分歧都抹平的报告，无法判断它是「已经收敛」还是「没看见分歧」。

### 4.1 冲突 1 · `proceedGateFor ?? stageGateFor` 是「与」还是「或」

| 方 | 主张 |
|---|---|
| **t1（pipeline-auditor）疑点 (a)**<br>⚠ **已被 t3 推翻 · 并列存档，勿引用** | 「`??` 短路意味着只要推进工作方式闸门返回非空，就不会再跑阶段门禁；反之若它返回 `undefined` 才进入 `stageGateFor`。两者是**或**关系而非**与**关系……结果是**阶段门禁不是每次派活的必经之路**。」<br>**↑ 此结论已被 t3 推翻，本文档不采纳。** |
| **t3（dispatch-auditor）§5.1(a)** | 「`??` 只在左侧**非空**时短路。左侧非空 = **已经拒绝**；此时跳过 stage 门不改变结论（照样拒）。左侧为 `undefined`（放行）时 **stage 门必被求值**，且 `root` 判不出时它返回「阶段门禁判不出…⇒ 本次不派单」（fail-closed）。⇒ **不存在「proceed 放行导致 stage 被跳过」的路径。这是「先策略、后阶段」的「与」语义，不是「或」。** |

**主控复核结论（§7.5）**：**采信 t3，t1 表述有误。**

**本次汇总独立回源**（`src/preset/tools.ts:2155-2172`）：
```ts
2155: const stageGateFor = (exec, scope = {}) => {
2156:   try {
2157:     const root = ledgerRootFor(exec)
2158:     if (root === undefined) return '阶段门禁判不出：无法确定本会话的账本目录 ⇒ 本次不派单。'
2159:     return dispatchGateAt(root, scope)
2160:   } catch (e) {
2161:     return `阶段门禁判不出（...）⇒ 本次不派单。`      // ← fail-closed
2162:   }
2163: }
2166:     (exec, scope) => proceedGateFor(exec?.agent ?? exec) ?? stageGateFor(exec, scope),
```

**裁定**：`??` 的语义是「左侧为 `null`/`undefined` 时取右侧」。`proceedGateFor` 的返回值域是 `string | undefined`：
- 返回 `string` ⇒ **已经拒绝**，短路后结论仍是拒；
- 返回 `undefined` ⇒ **放行**，此时 `stageGateFor` **必被求值**，且它自己 fail-closed。

⇒ **不存在「阶段门禁被跳过」的路径**。t1 的表述在语义上把「短路」误读成了「跳过」。

**⚠ 主文档明确不采纳的表述**：~~「阶段门禁不是每次派活必经」~~。本文档全文不出现该结论。
**t1 疑点 (a) 的原始表述在此并列存档，标注「已被 t3 推翻」**，以便溯源时不被再次引用。

**但 t3 同时指出一个真绕过点**（这也是它为什么有价值）：多轨（`tracks`）路径下 stage 门的**计划分支实际空转**（见 `R-28` / §3.3 ①）——那才是真正的绕过，且**与 `proceedGateFor` 无关**。所以：
- 「`??` 造成跳过」→ **不成立**；
- 「多轨首次派发时门禁不跑」→ **成立**（t3 D-03，本次已回源 `orchestrator.ts:4771/4816` 与 `tools.ts:881-936`）。

### 4.2 冲突 2 · 面板是否存在「第五套完成算法」

| 方 | 主张 |
|---|---|
| **t1 P-02** | 五套「完成」算法之一是「`project-panel.tsx:71-75`（`selectedChartStepOf`，pipeline 缺失时回落 `chain.currentStep`）」 |
| **t5（ui-auditor）⑤.A.1** | 「`RequirementChain.pipeline` 在类型上是**必填**（`requirement-chain.ts:56`），而服务端 `:519-520` 已把 `currentStep` 强制等于 `pipeline.activeStage`。⇒ `?? chain.currentStep` 这条回落是**死分支**（类型上不可达），**面板侧没有第五套完成算法**。」 |

**本次汇总独立回源**：
- `src/shared/requirement-chain.ts:56`：`pipeline: PipelineView`（**无 `?`**）⇒ 类型上必填 ✓
- `src/client/project-panel.tsx:73`：`if (chain.pipeline !== undefined) return chain.pipeline.activeStage` ⇒ 运行时仍留了防御分支
- `requirement-chain.ts:520`：`if (pipelineGoverns) partial.currentStep = partial.pipeline.activeStage` ⇒ `currentStep` 是 `activeStage` 的副本

**裁定**：**采信 t5**。面板侧不构成「第五套算法」，`:74` 的回落是**类型上不可达的防御分支**（对滚动升级期间的旧宿主仍可能触发，因为客户端不校验服务端返回）。
**但 t1 P-02 的核心主张成立**，只是「五套」应改述为「**4 套服务端实现 + 1 处客户端消费两套并排显示**」。
t5 给了更精确的落点：`project-panel.tsx:2600-2603` **同一行**既有 `CHAIN_STATE_TEXT[displayState]`（来自 pipeline）又有 `${step.done}/${step.total}`（来自 `summarizeStage` 计数）——「状态=已完成、计数=2/3」的自相矛盾就落在这一行。

⇒ 主文档记 `R-02` 时采用 t5 的精确表述：**5 份实现 = 4 份服务端 + 1 处客户端同屏并置**，并注明 `:74` 是死分支（不是第五套算法）。

### 4.3 冲突 3 · `validateLedgerStructure:false` 是「全仓唯一」还是「4 处」

| 方 | 主张 |
|---|---|
| **主控（转述给 t2 的前提）** | 「全仓唯一一处」 |
| **t2（ledger-auditor）L-07 附录 A-10** | `grep -rn validateLedgerStructure src/ scripts/` ⇒ **4 个 `:false` 调用点**：`projection-writer.ts:162,272`；`tools.ts:1929,2107`。其中只有 `hob_ledger_migrate`（`:1929`）那一处**必要**。 |

**裁定**：**采信 t2**，主控转述的前提有误。这是**团队内纠错的第二个正面案例**（第一个是 t3 纠正 t1 的「或/与」）。
**主文档据此修正**：`T-06` 的表述从「批准写入是唯一豁免」改为「**批准写入是 4 处豁免之一，且其中 3 处不必要**」。

### 4.4 冲突 4 · G3 到底是「拒绝派活但看不到原因」还是「根本不拒绝派活」

| 方 | 主张 |
|---|---|
| **t1 疑点 (c)** | 「编排侧拒绝派活，但界面上没有可读原因」 |
| **t3 §5.1(c)** | 「**前提修正**：不是「编排侧拒绝派活、但界面没有可读原因」。G3 **根本不拒绝派活** ⇒ 真实形态是**「面板说 G3 卡住、却说不出卡在哪；而派活照样放行」**。」 |

**主控复核（§7.4）**：**采信 t3 的修正**。
**本次汇总独立回源**：`pipelineDispatchProblems`（`pipeline-view.ts:570-644`）逐行核对 576-643，**确认无 `taskGraphOf`、无 `depends_on`、无 `acceptance_criteria` 覆盖校验** ✓

**裁定**：采信 t3。主文档采用「面板给假信号 + 系统放行」的表述（§3.3）。

### 4.5 冲突 5 · t5 的 C-06 初稿（legacy ACC 标签错配）是否成立

| 阶段 | 内容 |
|---|---|
| 初稿 | 「legacy 第 5 步的 ACC 被套上技术验证标签表 ⇒ 还没验印成待技术验证」 |
| 反证（t5 自查） | `requirement-chain.ts:349` 让 legacy 第 5 步装的是 `chain.verifications`（**不是 accs**），而 `kindOfStep(5)='verification'` 恰好与之相符 ⇒ **标签查表是对的**，不会出现该错配。原稿把「步骤名字叫验收核对」误读成「装的是 ACC」。 |
| 终版 | 撤回该结论，改写为「kind 由客户端按步号硬编码、与服务端实装是两条独立事实（当前恰好一致，属侥幸）」的**潜在陷阱** |

**裁定**：**采信 t5 的撤回**。**主文档不把「legacy ACC 标签错配」列为缺陷**，只在 §9.3「已排除」里记一行。
**保留 C-06 的改写版**为 `R-08` 的联动风险（因为它恰恰是「若按 §3.4 修 legacy 第 5 步，就会立刻踩中」的那个陷阱）——**这是撤回后的价值，不是原结论的价值**。

### 4.6 冲突 6 · 「六阶段」还是「七阶段」

| 方 | 主张 |
|---|---|
| **t1 疑点 (d)** | 「代码里 `PIPELINE_STAGE_IDS` 是 7 个……**「六阶段」与「七步」是同一件事的两种说法，还是一处未更新的表述**——我在代码里找不到唯一裁决点，需文档契约域确认。」 |
| **t6（doc-auditor）§5.1(b)** | 五份文档口径一致（六阶段 + 风险启用门），两份用「七」但说的是「编号」与「单元种类」，**不构成互相矛盾**。代码用 7 个 id 是「六阶段 + 门」的实现，**但代码在用户可见面上把门说成了步**（`pipeline-view.ts:481` `activeStage = 7` + `project-panel.tsx:2474` 渲染「第 N 步」）。 |

**裁定**：**采信 t6**，且这是本次审计里表述最精确的一条裁定。
**关键区分**（主文档沿用）：
- **不是**「文档自相矛盾」——五份文档写「六阶段 + 门」是一致的；
- **是**「文档承诺未覆盖到步名这一层，而步名恰恰是用户与模型都能看到的那一层」；
- 修复面最小：`pipeline-view.ts:481`（`activeStage = 7` → `6` + 新增 `closurePending`）+ `project-panel.tsx:2474`（改「门」的措辞），共 **2 行**；不建议改 5 份文档。

⇒ 记为 `R-04`（词表）+ `R-09`（六阶段/七步的用户可见面），两条同源但修复面不同。

### 4.7 冲突 7 · 账本健康的「四套判据」是否真的四套

| 方 | 主张 |
|---|---|
| **t2 L-03** | 4 套：`stageGateOfLedger`（字段+审批）/ `stageHealthOfLedger`（project 作用域恒无 blocker）/ `ledgerReadinessOfRoot`（字段+形状+闭环）/ `/stages.stageHealth`（字段+审批+闭环） |
| **t1 P-02 附** | 把 `stages-index.ts:284-293` 的 `summarizeStage` 也算作一套「完成」判据 |

**本次汇总独立复现**（`/tmp/syn_probe_health3.mjs`，同一夹具：一条字段齐全、`parent` 指向不存在 change 的 task）：

```
readiness:            unhealthy / gaps: ["L-2:TSK-001"]
stageGateOfLedger:    PASS(undefined)          ← 放行
stageHealthOfLedger:  { ok: true, blockers: [] }   ← 说健康
/stages.stageHealth:  { ok: false, count: 1, problems: ["L-2:TSK-001"] }
```

**裁定**：**采信 t2，且实测确认四份结论互不相同**。`summarizeStage` 是另一件事（步计数），不与这四套并列。
**补充**：这四套的组合差异是**实质性的**，不是写法差异——
- readiness 有 `unitShapeProblems` 但**无** `stageApprovalProblems`；
- `stageControlProblems` = 字段 + 审批，**无**闭环；
- `/stages` = 字段 + 审批 + 闭环；
- `stageHealthOfLedger` 走 `project` 作用域：`evaluateGate` 的 project 分支（`stage-controls.ts:1100-1101`）返回 `blockers: stageControlProblems(units)`，而 `stageControlProblems`（`:897-899`）= `stageFieldProblems` + `stageApprovalProblems` ⇒ **它的 `blockers` 结构上不含 L-1..L-4 闭环缺口**（`gateScopeUnits` 对 `project` 返回 `[]`（`:990`）只影响闭环那一支）⇒ **当且仅当缺口是闭环型时恒空**。
  **本次实测（M-02 订正）**（`/tmp/syn_m02.mjs`）：只含闭环缺口的账 ⇒ `{ok:true, blockers:[]}`；只含字段缺口的账 ⇒ `{ok:false, blockers:2, rules:['C-1']}`（主控另测到 C-5 夹具为 16 条）⇒「恒空」不成立。

⇒ 记为 `T-02`（形态 ③：失败被不同出口翻译成不同结论）。

### 4.8 冲突 8 · t1 的 P-01 在本次复核中的独立确认

t1 的 P-01（G4/G5 弱判定）是本次最重的判定类缺陷。主控已复核（`/tmp/lead_probe4.mjs`），**本次汇总再次独立复现**（`/tmp/syn_probe_g45f.mjs`）：

```
构造：一条全字段合法的 v3 链（G1/G2 批准均 approved、风险维度十维齐全、
      task built、RUN returned、VER pass、ACC accepted），但
      · 验证者 = 实现者（verifier/verification_session == built_by = 'dev'）
      · 验收者 = 实现者（actor/acceptance_session == 'dev'）
      · VER.criteria_refs = []、ACC.verification_refs = []、ACC.example_results = []

实测输出：
  activeStage: 7        gate: "G6-closure"     state: "active"
  chainCompleted: true  deliveryClosed: false
  stageStates: 1:completed 2:completed 3:completed 4:completed 5:completed 6:completed 7:active
  blockedBy (7 条)：
    ACC-1 · C-7 · 验收者与实现者是同一个会话（自己验自己）
    ACC-1 · C-7 · 独立验收会话与实现者相同（acceptance_session == built_by）
    ACC-1 · C-7 · 验收通过但缺技术验证证据（verification_refs 为空）
    VER-1 · C-25 · 技术验证者是实现者本人（违反独立性）
    VER-1 · C-25 · 技术验证没有对应的验收条件（criteria_refs 为空）
    VER-1 · C-25 · 技术验证者是实现者本人（违反独立性）      ← 重复
    VER-1 · C-25 · 技术验证没有对应的验收条件（criteria_refs 为空）  ← 重复
```

**裁定**：**P-01 成立**，且本次复现发现**两处 t1 未报告的细节**：
1. `blockedBy` 里 `VER-1` 的两条 **重复出现**（`:322-327` 的 `accs` 循环与 `verifications` 循环各 push 一次，`:325-327` 的循环与 `:340-344` 的 G4 completeness 循环又各 push 一次）⇒ 面板「另有 N 条」的 N 也被虚高；
2. `chainCompleted=true` 与 `activeStage=7 / gate=G6-closure` **同帧并存**——同一条链同时声称「已完成」与「卡在交付收口」。这一点主控在 §1 已记录，本次独立复现确认。

⇒ `R-01` 的严重度维持 **blocker**，并在描述中加入这两处新细节。

---

## §5 缺陷总表（按根因形态归类）

> 排序口径（沿用团队纪律）：先「会掩盖其他问题 / 让失败不可观测」的，再按严重度；不按显眼度。
> 每条给：**位置** / **证据等级** / **是什么** / **怎么证明修好了**。
> 「怎么证明修好了」一律给**可执行**形式：一条命令、一个探针、或一条该加的机检断言；凡新增机检，附**负向对拍**（把它要守的实现改坏 ⇒ 它必须当场红）。

### 5.1 形态 ① 口径分叉（R · 29 条）

#### R-01 · blocker · G4/G5「阶段完成」用弱判定，强判据只进 blockedBy 不参与计算

- **位置**：`src/shared/pipeline-view.ts:175-193`（`allTasksVerified` / `allTasksAccepted`）、`:442-461`（G4/G5 分支）、`:322-327`（强判据只 push 进 blockedBy）
- **证据等级**：**实测**（`/tmp/syn_probe_g45f.mjs`，本次独立复现）
- **是什么**：`allTasksVerified` 只查「最新 VER.status==='pass' 且 `verificationReady` 为真」，而 `verificationReady`（`:151-172`）只查 `task_revision` / 证据单元存在 / `command` 有 `exit_code`，**完全不查** `verifier`/`verification_session` ≠ `built_by`、`criteria_refs`、`nonconformance_refs`。`allTasksAccepted` 同理不查 `acceptanceProblems`。
- **实测**：验证者=实现者、验收者=实现者、无 criteria_refs/verification_refs/example_results 的账本 ⇒ **7 条 C-7/C-25 违规同时在列**，而 `activeStage=7`、`gate=G6-closure`、`chainCompleted=true`、阶段 5/6 均 `completed`。
- **新发现（本次复核补充，t1 未报）**：`blockedBy` 里 `VER-1` 的两条**重复出现两次**（`:325-327` 与 `:340-344` 两个循环各 push 一次）⇒ 面板「另有 N 条」的 N 被虚高。
- **为什么是 blocker**：「独立验收」是产品承诺，而它在**判定层**不参与。不是偶尔漏，是结构性不参与。
- **怎么证明修好了**：
  1. 探针：`node /tmp/syn_probe_g45f.mjs` 必须输出 `activeStage: 5`（或 6）且 `chainCompleted: false`；
  2. 机检（建议加进 `check:pipeline`）：构造「VER/ACC 齐备但独立性全违规」夹具 ⇒ 断言 `pipelineViewOf().chainCompleted === false`；
  3. **负向对拍**：把 `allTasksVerified` 改回 `return latest.status === 'pass'`（去掉 `verificationReady` 之后的强判据）⇒ 该断言必须红。

#### R-02 · blocker ·「链完成了吗」有 5 份实现（4 份服务端 + 1 处客户端同屏并置）

- **位置**：`stage-controls.ts:289-767`（字段门禁）/ `pipeline-view.ts:354-503`（if-else 链）/ `stages-index.ts:284-293`（`summarizeStage` 只按 status 计数）/ `requirement-chain.ts:359-397`（done/doing 再算一遍）/ `project-panel.tsx:2600-2603`（客户端把前两套**并排印在同一行**；`:71-75` 的回落是死分支，见下）
- **证据等级**：**读码 + 实测**（`summarizeStage` 判 done 的唯一依据是 status ∈ finals，`:287-291`）
- **是什么**：四份服务端实现各自回答「这一步完成了吗」，答案可以不同；客户端把其中两份**印在同一行**。
- **为什么是 blocker**：用户可以在同一屏看到「✅ 已完成」和「2/3」，或「面板说已完成」而「闸门拒绝派活」。这不是显示 bug，是**没有任何一处强制计数与判定同源**。
- **补充裁定（§4.2）**：`project-panel.tsx:74` 的 `?? chain.currentStep` 是**类型上不可达的死分支**（`RequirementChain.pipeline` 必填），不算第五套算法。故本文档表述为「4 份服务端 + 1 处客户端同屏并置」。
- **怎么证明修好了**：
  1. 机检：对同一夹具同时调 `summarizeStage` / `pipelineViewOf().stages[i].state` / `requirement-chain.steps[i].displayState` ⇒ 断言**三者对每一步一致**；
  2. **负向对拍**：把 `summarizeStage` 的 `done === total` 改成 `done >= total - 1` ⇒ 断言必须红；
  3. 命令：`grep -rn 'summarizeStage\|displayState' src/client/project-panel.tsx` 确认同一行不再并置两个来源。

#### R-03 · blocker · 阶段步名 8 份字面量且已漂

- **位置**：`pipeline-view.ts:33-41`（`PIPELINE_STAGES`，权威）/ `stage-controls.ts:19-27`（`STAGE_NAMES`，**`tasks: '编码任务'`**）/ `stages-index.ts:29-37` / `requirement-chain.ts:112-128`（两份）/ `project-panel.tsx:138` / `gen-ledger.mjs:522` / **`tasks-progress.ts:67`**
- **证据等级**：**实测**（本次 `sed` 原文确认 `stage-controls.ts:22: tasks: '编码任务'`）
- **是什么**：**8 份**字面量，第 3 步 **6 份写「任务图」、2 份写「编码任务」**（`stage-controls.ts:22` 与 `requirement-chain.ts:115` 的 `LEGACY_STEP_DEFS`，后者按本文自述属有意保留）。第 8 份是 **`src/shared/tasks-progress.ts:67` 的 `TASKS_STEP_NAMES`**（`/tasks-progress` 旧路由的解析词典，`check:tasks-progress` 正用同名字面量做正则）——初稿漏了这一份，已订正。而 `STAGE_NAMES` 的**唯一消费方**是 `gen-ledger.mjs:1267/1270`，它把名字写进**账本 `CONTEXT.md`**。⇒ 跑一次 `npm run gen:ledger`，账本里印「编码任务」而面板显示「任务图」。
- **补充（主控 §9.1）**：`stage-controls.ts:57` 的注释也写「当前步仍显示『编码任务』」——说明这一份是**没跟上改名的遗留**，修复方向是**改 `stage-controls.ts:22` 与 `:57` 两处**，不是改其余六份。
- **怎么证明修好了**：
  1. 机检（建议 `check:pipeline` 新增 F-STAGE-NAMES）：逐 kind 断言 `STAGE_NAMES[k] === PIPELINE_STAGES.find(s=>s.id===k).name`，且 `STAGE_DEFS`/`STEP_DEFS`/`STAGES_STEP_NAMES`/`STEP_NAMES`/`TASKS_STEP_NAMES` 与它逐项相等（⚠ `TASKS_STEP_NAMES` 守的是五步旧接口，比对时只比前三项）；
  2. **负向对拍**：把 `stage-controls.ts:22` 改回 `'编码任务'` ⇒ 该断言必须红；
  3. 命令：`grep -rn "'编码任务'" src/ scripts/` 应只剩 `LEGACY_STEP_DEFS`（第 3 步的旧词，属有意保留）与注释。

#### R-04 · blocker · 运行时教模型「五步」、面板与文档是「七步」

- **位置**：`preset/dsh-hob/preset-dsh-hob.patch.yml:434` = `gen/persona.md:364`（运行时，五步）/ `gen/contracts.md:200` = `spec/reply.md:84`（人读版，七步）/ 代码真值 `pipeline-view.ts:33-41`
- **证据等级**：**实测**（本次 `grep` 四份原文）
- **是什么**：运行时注入的那份写 `the five steps (需求规格 / 实现方案 / **编码任务** / 任务执行 / **验收核对**)`；人读版写七步（含技术验证/产品验收/交付收口）。
  **第 5 步：模型说「验收核对」，面板说「技术验证」——同一个编号指两件不同的事。**
- **为什么比命名不一致更严重**：Hob 每轮固定第一行「当前：第 N 步 · <步名>」，编号语义错位会导致「模型以为在做验收、实际在做技术验证」——恰好踩宪法第 8 条「测试通过 ≠ 产品验收」的反面。
- **为什么五处自检全绿**：F10 核 `prefix`==`persona.md`（两份都是五步 ⇒ 一致）；F5 核 notes 逐字在 prefix 里（`notes-handover.md:244` 就是那句五步 ⇒ 也绿）；F14 核 reply id；⑤ 核 drafts==prefix（也是五步）。**五处都在「同源自比」，没有一处跨源比对。**
- **怎么证明修好了**：
  1. 机检（建议 `check:workflow` 新增 F15）：抽 `spec/reply.md` 与 `prefix` 正文里的「步名清单」，逐项相等；
  2. **负向对拍**：只改一侧（把 `notes-handover.md:244` 的五步改成七步、不改 prefix）⇒ F15 必须红；
  3. 命令：`grep -c 'five steps' preset/dsh-hob/preset-dsh-hob.patch.yml` 应为 0。

#### R-05 · blocker · G3（依赖环/悬空/覆盖缺口）不进任何派活闸门

- **位置**：`src/shared/pipeline-view.ts:570-644`（`pipelineDispatchProblems`）
- **证据等级**：**实测**（主控 `/tmp/lead_probe*.mjs` 复现 C；本次逐行核对 576-643 确认无 `taskGraphOf`）
- **是什么**：该函数逐项检查了 task 是否 v3、父方案是否存在/已批准、需求是否已批准、`taskProblems`、`riskAssessmentProblems`、`riskObjectProblems`、`risk_binding_digest`、`taskRiskProblems`——**完全没有调用 `taskGraphOf`**。而 G3 的推进判定（`:411-417`）确实用了 `graph.cycles`/`dangling`/`coverageGaps`。
- **逐项排除三处兜底**（t3 §5.1(b) 已做，本次采信）：`stageFieldProblems` 里唯一与图相关的是 `taskGraphRiskProblems`（只判 RP-5 写范围重叠）；`ledgerClosureProblems` L-1..L-4 只查 `parent`/`req_ids` 存在性；就绪度只看账本能否推进。**没有间接兜住。**
- **怎么证明修好了**：
  1. 探针：任务 `criteria_refs: []` + `depends_on: ['TSK-NOT-EXIST']` ⇒ `pipelineDispatchProblems` 必须非空；
  2. 机检（`check:pipeline` 新增）：构造「图有环但字段齐全」的任务 ⇒ 断言派活被拒；
  3. **负向对拍**：把 `taskGraphOf` 那一段从 `pipelineDispatchProblems` 删掉 ⇒ 断言必须红。

#### R-06 · high · 两份 TOML 解析器：严格的做门禁、宽松的做读取

- **位置**：严格 `stages-index.ts:222-250`（`parseUnitsToml`，遇不认识的写法**抛错**）；宽松 `tools.ts:159-206`（`parseLedgerUnitsText`，坏行 `continue`、非字符串字段**静默丢弃**）
- **证据等级**：**实测**（主控 `/tmp/lead_probe_ledger1.mjs`；t2 附录 A-5 四组输入）
- **是什么**：严格版 → `/stages`、写前校验、readiness、`requirement-chains-route`；宽松版 → `/ledger-resource`、**全部门禁**、`ledgerLifecycleOfRoot` 的 index/shard 一致性核。
- **后果**：① 门禁与读取看的是两份不同的账本；② 一致性核用的是被静默修复过的视图，**永远发现不了坏行**；③ 旧格式账本在 `/ledger-resource` 上表现为**空账本**而不是「格式旧」（`readLedgerResource` 回 `not-found`，而 R-001 确实在盘上）——「读不到 ≠ 不存在」的镜像错误。
- **怎么证明修好了**：
  1. 命令：`grep -rn 'parseLedgerUnitsText' src/` 应为 0（删掉宽松版）；
  2. 机检：同一份「`title = 123`」的坏单元，`/stages` 与 `/ledger-resource` 必须**同结论**（都判非法）；
  3. **负向对拍**：把 `readLedgerUnits` 改回宽松解析 ⇒ 该断言必须红。

#### R-07 · medium · 三条读盘实现，失败语义各不相同

- **位置**：`stages-index.ts:691-798`（严解析 + 形态核）/ `tools.ts:213-220`（宽解析 + 无形态核）/ `requirement-chains-route.ts:41-135`（严解析 + 无形态核）
- **证据等级**：读码
- **是什么**：三者对「`index.toml` 不存在」的 reason 都不同（`STAGES_REASON_LEDGER_MISSING` vs `index-unreadable` vs `not-found`）。形态非法的单元在 `/requirement-chains` 上会被当正常单元处理（它不做 kind/status 核）。
- **怎么证明修好了**：抽出 `readLedgerUnitsStrict` 供三处共用；机检：同一本坏账，三条路由的 `reason` 必须同值。**负向对拍**：让其中一处改回宽松 ⇒ 断言红。

#### R-08 · high · legacy 第 5 步状态源与条目源是两个集合（联动修复项）

- **位置**：`requirement-chain.ts:117`（声明 `kind:'acc'`）/ `:307-311`（状态取 `accs`）/ `:349`（条目取 `verifications`）/ `:391`（计数用 items.length）/ 客户端 `project-panel.tsx:148-156, 1744, 2600-2612`
- **证据等级**：**实测**（本次 `sed` 原文确认四处）
- **是什么**：见 §3.4。legacy 5 步的「验收核对」**同时承担**产品验收与技术验证，于是状态按 ACC 算、条目按 verification 取。
- **后果**：面板同屏「✅ 已完成」+「0/0」+「这一步还没有条目」，且 **ACC 全文（判决、残余风险、接受人）在 legacy 链上无处可见**。
- **主控裁定**：**legacy 第 5 步应以 acc 为准**，条目改取 `accs`。
- **联动约束（不可单做）**：若改装 acc，客户端 `STAGE_KIND_BY_STEP` 必须同批改，否则 ACC 状态被拿去查 verification 标签表，且 `stageStatusLabel` **不会返回 `known:false`**（ACC 状态集是 verification 的**真子集**，`stages-index.ts:49-50`）⇒ 界面安静地换成另一个词，**不报「判不出」**。
- **怎么证明修好了**：
  1. 机检（`check:requirement-chains` 新增）：对 legacy 夹具断言 **第 5 步的 `displayState` 源集合 === `itemIds` 源集合**（即 `chain.accs`）；
  2. 机检（`check:client` 新增）：legacy 链第 5 步装 acc 时，`kindOfStep(5)` 必须返回 `'acc'`；
  3. **负向对拍**：把 `:349` 改回 `chain.verifications` ⇒ 断言 1 必须红；把 `STAGE_KIND_BY_STEP[5]` 保持 `'verification'` ⇒ 断言 2 必须红。

#### R-09 · medium ·「六阶段」与「第 7 步」：门在用户可见面上被说成了步

- **位置**：`pipeline-view.ts:481`（`activeStage = 7`）、`project-panel.tsx:2474`（渲染「当前阶段：第 N 步」）、文案 `:2319, 3338`（写「六阶段」）
- **证据等级**：**读码 + 主控/t6 裁定**（§4.6）
- **是什么**：五份文档 + `pipeline.ts:44-47` 的代码注释都说 closure 是**风险启用门**、不是第七个业务阶段；但 UI 把它当第 7 步显示。
- **精确表述（采信 t6，避免误说成「文档自相矛盾」）**：不是文档矛盾，是「**文档承诺的边界画在步名之外，而步名恰恰是用户与模型都能看到的那一层**」。
- **怎么证明修好了**：`pipeline-view.ts:481` 改 `activeStage = 6` + 新增 `closurePending: true`；`project-panel.tsx:2474` 改成门的措辞（「第 6 步 · 产品验收（已过）· 待交付收口」）。机检：`activeStage` 的取值域断言 ⊆ 1..6。**负向对拍**：改回 7 ⇒ 断言红。

#### R-10 · high · 覆盖校验读 `criteria_refs`，而契约字段是 `acceptance_criteria_refs`

- **位置**：`pipeline-view.ts:692,696`（读 `criteria_refs`）vs `pipeline.ts:157`（契约字段 `acceptance_criteria_refs`，且参与 digest）
- **证据等级**：**实测**（主控 `/tmp/lead_probe*.mjs` 复现 A/B：按契约写 ⇒ 误报缺口；按 UI 名写 ⇒ 通过）
- **是什么**：**按契约写反而永远报缺口**。而 `criteria_refs` 不参与 digest（`pipeline.ts:155-160`），改它不会让批准失效——于是「改字段名」是一个无成本的绕过。
- **怎么证明修好了**：覆盖校验改读 `acceptance_criteria_refs`（`criteria_refs` 作兼容别名同时读）；机检：任务用契约字段 `acceptance_criteria_refs: ['AC-1']` ⇒ `coverageGaps` 必须为空。**负向对拍**：只读 `criteria_refs` ⇒ 断言红。

#### R-11 · medium · 账本根派生：运行时 fail-closed，体检脚本仍走已删除的兄弟目录档

- **位置**：`doc-read.ts:139-146`（空串 ⇒ `undefined`）/ `tools.ts:399-400` 注释（说「退到兄弟目录」）/ `preflight.mjs:48-50`（**仍实现**兄弟目录派生）/ `README.md:132`（说「空串 = 派生」）
- **证据等级**：**实测**（本次 `sed` 三处原文）
- **是什么**：同一件事三处口径：代码说「判不出」、两处注释与一个脚本说「派生」。**体检与运行不同口径**——照 README 做的人会得到「账本落点判不出」的拒绝，而 preflight 说「记录区在位」。
- **怎么证明修好了**：`preflight` 的兄弟目录档删掉或标注「仅体检用」；机检：`resolveLedgerRoot('', home, ws)` 与 `preflight` 的派生结果必须**同值**。**负向对拍**：让 preflight 返回兄弟目录 ⇒ 断言红。

#### R-12 · high · 首次批准前改内容不递增 revision 不被拦

- **位置**：`pipeline.ts:551-564`（`if (decisions.length > 0 && revision <= maxApprovedRevision)`）
- **证据等级**：**实测**（t1 `/tmp/pa_probe4.mjs`：无 decision 时改内容 ⇒ `[]`；有 decision ⇒ C-23）
- **是什么**：`decisions.length > 0` 把强制范围限定在「**已经有过批准**」的条目上。⇒ 首次批准前的每一次内容改写都**不需要**递增 revision，digest 随之漂移，而账本里**没有任何记录能证明「用户当时批准的是哪一版内容」**。
- **主控裁定（§4）**：应**升级为 high**（t1 原为 medium）——它让「批准绑定具体修订与摘要」在**首次批准这一最关键节点**上失去可验证性。
- **怎么证明修好了**：条件改为「`artifactDigestOf` 变化 ⇒ 必须 `revision > oldRevision`」，与是否有 decision 解耦；探针：无 decision 时改内容不升版 ⇒ 必须报 C-23。**负向对拍**：保留 `decisions.length > 0` ⇒ 断言红。

#### R-13 · **high** · G6 收口档位取「物理顺序最后一个方案」，结论随数组顺序翻转（**安全方向 fail-open**）

> ⚠ **等级由 medium 升为 high**（主控第三轮复核座实，02-ledger 施工卡阶段发现）：原描述「结论随顺序翻转」读起来像一致性瑕疵，实际是**该拦的没拦**，且**迁移动作会翻转结论**。

- **位置**：`src/shared/stage-controls.ts:711-714`（`closureProblems` 里的 `const plan = plans.at(-1)`）；对照 `src/shared/pipeline-view.ts:101-108`（`currentPlanOf`）
- **证据等级**：**实测**（三方独立复现：t1 `/tmp/pa_probe8.mjs` 原始发现；主控 `/tmp/lead_probe_order5.mjs`；本次汇总 `/tmp/syn_r13_probe.mjs`，三份逐格一致）

**代码事实**：
```ts
// stage-controls.ts:711-714
const plans = units.filter((u) => txt(u.kind) === 'change' && changeRequirementIds(u).includes(parentReqId))
const plan = plans.at(-1)                      // ← 取数组最后一个
const assessed = riskAssessmentOf(riskFactsOf(plan))
```
`plans` 的顺序 = `units` 顺序 = `readLedgerUnits` 的 `[...index.toml, ...分片]` 拼接顺序。
⇒ **`at(-1)` 取的是「物理存储最后一个方案」，不是「当前方案」。**

**实测（一份账本、两种物理顺序）**：夹具 = `R-001` 下两个方案，`CHG-001`（superseded，十维全最坏 ⇒ 推导 closure=`strict`）、`CHG-002`（agreed，十维全最好 ⇒ closure=`standard`），加 `CLS-001`（skipped）：
```
A old-first  [req, CHG-001, CHG-002, closure] ⇒ at(-1)=CHG-002
   ['C-29: 交付收口缺 chain_acceptance_ref',
    'C-29: 交付收口缺 risk_assessment_ref',
    'C-29: 交付收口缺 residual_risk_decision_ref']            ← 只剩 3 条 C-29，**没有 C-27**

B new-first  [req, CHG-002, CHG-001, closure] ⇒ at(-1)=CHG-001
   ['C-27: 风险要求 strict 收口，不能标记 skipped',
    'C-29: 交付收口缺 chain_acceptance_ref', ...]                    ← **报出了 C-27**
```
⇒ **同一份账本，只因物理顺序不同，闭合判定结论就不同**。

**危害（为什么是 high，不是 medium）**：A 序**漏报**了「风险要求 strict 收口，不能标记 skipped」。换言之：
**一个极高风险方案可以被 `skipped` 收口而不报错**（只要它碰巧不是物理顺序里最后一个）。这是安全方向的 **fail-open**：该拦的没拦，且不会有任何读数提示。
叠加 **`O-37`（migrate 只重写 index.toml）**：迁移动作会**移动单元的物理位置** ⇒ **迁移前后 G6 结论可能翻转**。⇒ `O-37` 不仅是 `T-01` 的硬前置，**同时也是本条的硬前置**。

**为什么不能“复用 `currentPlanOf`”——它自己也不可信**（本次复核新发现，已主控确认）：
```ts
// pipeline-view.ts:101-108
const plans = units.filter(...).sort(byCreated)
const active = plans.filter((u) => !['superseded'].includes(text(u.status)))
return active.at(-1) ?? plans.at(-1)
```
| # | 洞 | 说明 |
|---|---|---|
| **(a)** | `byCreated` 读的是单元自己的 `created_at` | **自填字段**，与 `S-02` 同类自证（写者可以给旧方案写更新的 `created_at`） |
| **(b)** | `active` 判的是「**不是** superseded」 | 而不是「**是** agreed/settled」 ⇒ `draft` / `proposed` / `dropped` 都会被当成当前方案 |
| **(c)** | 全 superseded 时回落 `plans.at(-1)` | 又回到物理顺序 |
⇒ **修法不能写「复用 `currentPlanOf`」**——那只是把「不排序的 at(-1)」换成「排序的 at(-1)」，三个洞一个没堵。

**顺序依赖的三个消费方（回答「修 `T-01` 能不能顺带解决」）**：
| 依赖顺序的部分 | `T-01` 修好后 | 依据 |
|---|---|---|
| `units.find()` 取同 id 的哪一个 | **归零**（同 id 不再重复，`find` 不再有歧义） | `tools.ts:213-220` 拼接 + 多处 `find` |
| `closureProblems` 的 `plans.at(-1)` | **仍然存在**（一需求多方案是正常业务状态，superseded 就是为此存在） | `stage-controls.ts:713` |
| `currentPlanOf` 的 `sort().at(-1)` | **仍然存在**（且 `created_at` 自填） | `pipeline-view.ts:101-108` |

⚠ **本条独立于 `T-01`**：即使 `T-01` 完全修好，「方案 A 在 index、方案 B 在分片」这种布局仍会让 `at(-1)` 取到分片里那个。

- **怎么证明修好了**：
  1. **抽新函数 `currentPlanOfStrict(req, units)`**，放 `src/shared`（与 `T-02` 的 `ledger-health.ts` 同层，**纯函数、不 import server 侧**）；
     判据：`status ∈ {agreed, settled}` 优先 → 同级按 `revision` 最大 → 再按 `created_at` → **全无则返回 `undefined` 并报「判不出当前方案」，不得回落 `at(-1)`**；
  2. `closureProblems`（`stage-controls.ts:711`）与 `pipelineViewOf`（`pipeline-view.ts:216` 的 `currentPlanOf` 调用点）**都改为调它**，旧 `currentPlanOf` 删除；
  3. 机检（`check:stage-controls` 新增）：同一份账本两种物理顺序 ⇒ `closureProblems` 结论**必须相同**，且必须都含 `C-27`；
  4. **负向对拍**：把取法改回 `at(-1)` 并对调两方案在文件里的位置 ⇒ 断言必须红；
  5. 另一条负向对拍：把 `currentPlanOfStrict` 的 `status ∈ {agreed,settled}` 改回「不是 superseded」 ⇒ 用 `draft` 方案做夹具的断言必须红。

#### R-14 · medium · nextAction 与 activeStage 是两个独立算法，链内用三段补丁硬对齐

- **位置**：`next-action.ts:143-243` / `requirement-chain.ts:430`（**不注入 convergence**）/ `:451-461`、`:472-491`（两段补丁）/ `:519-550`（gate 覆盖）
- **证据等级**：读码（`:451-461` 的注释自承「TSK-080 标 built 之后全局 nextAction 给不出」）
- **怎么证明修好了**：`nextAction` 增加 `currentStage` 入参，由 `pipeline.activeStage` 驱动优先级；机检：`next` 与 `pipeline.nextAction` 在 G1/G2 之外也必须一致。**负向对拍**：删掉补丁段 ⇒ 断言红（证明补丁确有必要，或证明可删）。

#### R-15 · medium · 回执校验正则有两份，纯函数那份是死代码且更严

- **位置**：`pipeline.ts:397-409`（**零调用方**）vs `tools.ts:2051-2058`（实际生效）
- **证据等级**：**实测**（`grep -rn 'approvalReceiptPattern' src` 只命中定义处）
- **是什么**：纯函数版用 `\s+`（强制至少一个空格）、工具版用 `\s*`（全宽松）。**两份不等价**，将来谁去调纯函数版行为会变。
- **怎么证明修好了**：删掉 `pipeline.ts:397-409`，或把工具版替换为纯函数版（与 `S-01` 的下沉方案同批）。命令：`grep -c 'approvalReceiptPattern' src/modules/tools.ts` 应为 1（被引用）。

#### R-16 · low · 阶段状态标签表与三份状态封闭集靠人眼维持

- **位置**：`stage-status-labels.ts:35-115` vs `stages-index.ts:40-88` / `ledger-validation.ts:14-27` / `stage-controls.ts` 里的状态字面量
- **证据等级**：读码
- **怎么证明修好了**：`UNIT_STATUSES` 由 `STAGE_KIND_STATUSES` 派生；机检：新增一个 kind 时不改标签表 ⇒ 必须红（当前只在有真实数据时红）。

#### R-17 · low · `STAGE_COMPLETION` 零调用；`gateProblemsAt` 只喂生成物且用弱判据

- **位置**：`stage-controls.ts:68-102`（全仓零调用）、`:1130-1140`（`tasks` 分支用 `taskProblems` 而非 `taskFullProblems`）
- **证据等级**：**实测**（`grep STAGE_COMPLETION src` 只有定义）
- **怎么证明修好了**：`gateProblemsAt` 与 `stageFieldProblems` 合并（前者按 stage 过滤后者）；机检：`ledger/gen/stages.md` 的缺口数 === 闸门的缺口数。**负向对拍**：改回弱分支 ⇒ 断言红。

#### R-18 · high · `removeUnitBlock` 把非 id 字段留成孤儿块，返回 `ok:true`

- **位置**：`projection-writer.ts:130-150`（`removeUnitBlock`）、`:265-271`（`without` + `renderUnit` 拼接）
- **证据等级**：**实测**（t2 附录 A-9：`{ok:true, applied:3}`，分片里出现 2 条只有 `title` 的裸块）
- **是什么**：`id` 不是首键时，`id` 之前的行已 push 进 `out`，`[[unit]]` 已被弹出 ⇒ 留下无 `id` 的裸块。解析器照样算一条单元。
- **后果**：① 账本长出 `id=''` 的单元，**下一次任意写入都会被拒**；② 每次投影迁移**再复制一份**；③ 与 `T-07` 叠加：健康任务被投影迁移一次，账本开始累积垃圾，后续写入被自己制造的垃圾拦死。
- **怎么证明修好了**：`removeUnitBlock` 改成块级处理（按 `[[unit]]` 切块、解析每块 `id`、整块丢弃）；探针：`id` 写在第二行时分片改写后**单元数不变**。**负向对拍**：改回行级删除 ⇒ 断言红。

#### R-19 · medium · 白名单允许 `ledger/units/` 任意子路径，写进去的单元所有读面看不见

- **位置**：`hob-write.ts:163`（`LEDGER_PATH_RE` 允许 `/`）、`:814-821`（只挡 `..` 与 `//`）；读取面过滤 `^unit-[^/]+\.toml$`
- **证据等级**：**实测**（t2 附录 A-17：`sub/unit-x.toml` / `projection.toml` / `UNIT-01.toml` 全 `ok:true` 且两套读取面都看不见）
- **是什么**：「静默吞错」的另一种形态——**不是吞掉异常，而是吞掉整条数据**。幽灵单元连写前校验都不参与（`merged` 也只合并 `^unit-.*` 的分片）。
- **怎么证明修好了**：白名单收窄成「只允许单段 `unit-*.toml` 与 `index.toml`」；机检：写 `ledger/units/sub/x.toml` ⇒ 必须被拒。**负向对拍**：放开子路径 ⇒ 断言红。

#### R-20 · medium · `ledgers-route` 用行计数冒充单元数

- **位置**：`ledgers-route.ts:86-116`
- **证据等级**：读码
- **是什么**：`units` 数 `[[unit]]` 行数；`v3Units` 数**任意位置**的 `pipeline_version` 行数；`legacyUnits = units - v3Units`。两者不是同一层级（`v3Units` 数的是**行**，可多于 `units` 数的**单元头**），而 `legacyUnits = Math.max(0, units - v3Units)`（`ledgers-route.ts:113`）把它**夹到 0** ⇒ 表现为**把 v2 单元全部报成 v3**（`health='current'`），**不是负数**（初稿「会算成负数」不成立，已订正）。
- **怎么证明修好了**：改用 `parseUnitsToml` + `isPipelineV3` 逐单元判定；机检：100 条单元里 1 条 v3 ⇒ `health` 必须是 `outdated` 而非 `current`。**负向对拍**：改回行计数 ⇒ 断言红。

#### R-21 · low · `modeSnapshot` 冻结只有「写 + 读」，没有复验，不驱动推进

- **位置**：`work-plan.ts:1002-1010`（**只有注释、没有函数体**）、`work-plan-state.ts:333`（写快照）、`work-plan-panel.tsx:233-238`（显示）
- **证据等级**：**实测**（本次 `sed` 确认注释后直接结束、无 `export function`）
- **是什么**：`modeSnapshot` 的实际作用只有状态面显示与面板提示；**推进与派发全部用「当前档」**。用户建计划后改档，旧计划的依赖轨接力会被新档位拦。
- **怎么证明修好了**：二选一并写清——`advanceWorkPlans` 的 `dispatch` 带 `workMode: planModeOf(plan)` 并让 `dispatch` 用传入值判档位闸（同时补上缺失的复验函数）；或把面板那句改成「只影响显示」。机检：注释里提到的函数名必须能 `grep` 到 `export function`。

#### R-22 · high · 工具描述说「只有 ledger 开放」，常量已三档全开

- **位置**：`bus.ts:2041-2042`（描述）/ `read-level-policy.ts:61`（`OPEN_READ_LEVELS = ['ledger','project','workspace']`）/ `create-hob-dialog.tsx:167`（客户端兜底文案）
- **证据等级**：**实测**（主控 §5.3 已回源）
- **是什么**：描述写的是 2026-10-24 之前的事实，扩档后未同步。**模型读到后会主动不用 project/workspace**——这是「自我限制 + 说假话」，比单纯文档落后更坏。
- **怎么证明修好了**：描述改成引用 `OPEN_READ_LEVELS` 现算的句子；机检：工具描述里出现的档位集合 === `OPEN_READ_LEVELS`。**负向对拍**：把常量改回 `['ledger']` ⇒ 断言必须红（证明这条断言真的在比对常量，不是比对文案）。

#### R-23 · low · 高风险「评审者 ≠ 作者」两份实现：一份用声明值、一份用推导值

- **位置**：`stage-controls.ts:341-359`（`u.risk_tier` 声明值）vs `risk-policy.ts:441-451`（`derived.tier` 推导值）
- **证据等级**：读码
- **是什么**：当前无害（RP-2 已保证 declared ≥ derived），但判据来源不同，将来 RP-2 放宽或推导规则变化会分叉。
- **怎么证明修好了**：删掉 `stage-controls.ts:341-359`，改读 `riskAssessmentProblems` 已覆盖的 RP-4/RP-5 结论；机检：两处对同一夹具必须同结论。

#### R-24 · medium · `/stages` 的权威字段（next / pipelines / summary）取回即弃

- **位置**：`project-panel.tsx:1703`（`next` 存了不用）、`:1284`（`pipelines`）、`:1296`（`summary`）；实际渲染 `:2654`
- **证据等级**：**实测**（t5 `grep` 确认 1703 之后全文无引用）
- **是什么**：服务端把 `next`/`pipelines`/`summary` 当权威产出（`stages-index.ts:147-155` 的注释明写「consumers must not derive another 'current stage'」），客户端取了、存了、不用。后果：面板的「下一步」**只**来自需求链，项目级 `next`（全账本口径）在界面上不存在。
- **怎么证明修好了**：明确二选一——删掉三项下发，或给项目级 `next` 一个位置。机检：`StagesOk` 的每个字段必须在客户端有读取点（或标注「仅为兼容保留」）。**负向对拍**：新增一个未读取的字段 ⇒ 断言红。

#### R-25 · low · 同一 handoff 两套清账判据

- **位置**：`orchestrator.ts:5629-5633`（时间窗 `h.at <= w.at`）vs `write-delivery.ts:262-266`（`ref` 精确匹配）
- **证据等级**：读码（`write-delivery` 的注释已写明「时间窗一刀切会清掉别人」）
- **怎么证明修好了**：收敛到 `ref` 精确匹配；机检：同工作区多个 handoff ⇒ 两处清账结果必须相同。

#### R-26 · low · 同一条路由字符串写两份（`work-plans`）

- **位置**：`work-plan-panel.tsx:16`（`WORK_PLANS_ROUTE_PATH`）vs `project-panel.tsx:957`（内联同 URL）
- **证据等级**：**实测**（t5 `grep`）
- **怎么证明修好了**：`project-panel` 改为 import `fetchWorkPlans`；机检：`grep -c '/api/dsh-hob/work-plans' src/client/` 应为 1。

#### R-27 · high · README 的 `ledgerHome` 缺省规则与代码相反，且引用已删除常量

- **位置**：`README.md:132`（「空串 = 派生」）/ `:144`（引用 `DEFAULT_LEDGER_DIR`，**该常量已删除**）/ `:131`（指向不存在的 `.hob/INIT.md`，真实路径 `kit/INIT.md`）/ `doc-read.ts:139-146`（空串 ⇒ `undefined`）
- **证据等级**：**实测**（本次 `sed` 三处；`grep -rn DEFAULT_LEDGER_DIR` 只在注释里出现）
- **是什么**：README 明确写「**除非你确知在做什么，否则留空**」——而**留空的真实后果是工具拒绝**（`tools.ts:2161`「账本落点判不出」）。**照 README 做的人会得到拒绝，而 README 说这条路是推荐的。**
- **怎么证明修好了**：`README.md:132` 改成「空串 = 判不出（工具拒绝并给原因）；随包预设已显式给 `ledgerHome`，换机必须改」；删掉 `:144` 的常量引用；`:131` 改 `kit/INIT.md`。机检：README 里出现的每个 `src/**` 常量名必须能 `grep` 到 `export`。**负向对拍**：引用一个不存在的常量 ⇒ 断言红。

#### R-28 · high · 多轨首次派发时任务链门禁不跑

- **位置**：`orchestrator.ts:8837`（门禁）→ `tools.ts:881-886`（从盘上找计划）→ `tools.ts:934-936`（找不到 ⇒ `blocked: undefined`）；计划写盘在 `orchestrator.ts:4816`（**门禁之后**）；`duplicate-plan` 在 `:4024-4030`
- **证据等级**：**实测**（本次 `sed` 确认 `writeWorkPlan` 在 4816、`planConflictProblems` 在 4771）
- **是什么**：`hob_dispatch({tracks})` 传的 `planId` 是**新**计划号 ⇒ `listWorkPlans` 里没有它 ⇒ 落到 `blocked: undefined` ⇒ **`pipelineDispatchProblems` 对 tracks 一次都不跑**。单目标路径的两道校验（lifecycle 8815、TSK 正则 8826）也都写在 `if (!Array.isArray(args.tracks))` 内。
- **⇒ 多轨是当前唯一能绕过任务链门禁的派发入口。**
- **怎么证明修好了**：在 `dispatchPlan` 内、`writeWorkPlan` **之前**，用 `normalized.tracks` 的 `taskId` 逐个跑 `pipelineDispatchProblems`（与单目标同源，⛔ 不另写一份）。机检：多轨首派一个父方案未批准的任务 ⇒ 必须被拒。**负向对拍**：把门禁调用移到 `writeWorkPlan` 之后 ⇒ 断言红。

#### R-29 · high · README 称「不写 `~/.dsh/**`（有显式拒绝路径）」，该机制在代码里不存在

- **位置**：`README.md:166`、`:188` vs `preset/dsh-hob/preset-dsh-hob.patch.yml:913`（`ledgerHome: /home/lk/.dsh/hob-ledgers`）；写面守卫 `hob-write.ts:765-830`
- **证据等级**：**实测**（主控 §5.5 全仓搜 `src/` 下的 `.dsh` 字面量，只在**注释**里出现，无任何拒绝实现）
- **是什么**：写面守卫是按**相对路径白名单**判定的（`ledger/units/**` 等），**根本不看绝对路径是否在 `~/.dsh` 下**。所以真正的表述应是：**写面守卫不感知 `~/.dsh`**；当 `ledgerHome` 被配到 `~/.dsh` 下时，写入照常发生。
- **比 t4 原表述更根本**：「显式拒绝路径」这个机制**可能从未存在过**——不是「文档没更正」，是「文档描述了一个不存在的机制」。
- **怎么证明修好了**：README 改成「除 `<ledgerHome>`（随包缺省为 `~/.dsh/hob-ledgers`）与 profile 配置外，不写 `~/.dsh/**`」。若确要实现拒绝路径：机检 `write_hob('<绝对路径在 ~/.dsh 下>')` ⇒ 必须被拒。**负向对拍**：去掉拒绝逻辑 ⇒ 断言红。

---