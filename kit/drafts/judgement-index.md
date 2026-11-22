# 业务判定索引 · 42 个判定函数在哪、判什么、被谁调

> **性质**：这是「业务逻辑清晰」的**唯一地图**。想知道某条规则在哪判，查本表。
> **权威**：函数签名与行号以源码为准，本表由 `check:judgement-index` 机检（位置漂了会红）。
> **不写**：会漂移的调用次数、行数统计。

---

## 一、判定的四层结构（必须先理解这个，否则 40 个函数全是散的）

```
第 4 层  闸门（Gate）      evaluateGate ── 按 action + scope 决定「这次动作能不能做」
                              └─ 出口：GateDecision（ok / blockers / bypass）

第 3 层  聚合（Aggregate） stageControlProblems = stageFieldProblems + stageApprovalProblems
                              ├─ 字段层：每条单元自己有没有问题
                              └─ 审批层：需求/方案的用户批准是否有效

第 2 层  单元（Unit）      每类单元一个 Problems 函数
                              requirementProblems / planProblems / taskFullProblems /
                              runProblems / evidenceProblems / acceptanceProblems /
                              verificationProblems / closureProblems / titleProblems

第 1 层  字段与形态（Shape） unitShapeProblems（结构）· stageFileProblems（文件级）
                              indexIntegrityProblems（索引）· ledgerHealthOf（健康）
```

⚠ **为什么必须分层看**：`StageControlProblem[]` 是这个体系里**唯一的输出类型**，
  四层都产出它。分不清「这条问题来自哪一层」，就会出现在错误的位置加判据
  （历史教训：R-17 —— `gateProblemsAt` 用 `taskProblems`（弱判据）而
  `stageFieldProblems` 用 `taskFullProblems`（含风险），同一个任务两个闸门结论不同）。

---

## 二、逐层清单

### 第 1 层 · 字段与形态

| 函数 | 位置 | 判什么 |
|---|---|---|
| `unitShapeProblems` | `ledger-validation.ts:36` | 单个单元的 `kind/status` 是否在**封闭集**内、必填字段是否齐 |
| `indexIntegrityProblems` | `ledger-lifecycle.ts:282` | `index.toml` 与分片是否一致（缺条目 / 多条 / 悬空） |
| `ledgerHealthOf` | `ledger-health.ts:102` | **账本健康唯一判据**（4 个出口都调它） |
| `describeLedgerHealth` | `ledger-health.ts:163` | 把健康问题翻成**人读一句话**（只描述，不判定） |
| `stageFileProblems` | `stage-controls.ts:1436` | 账本**文件级**问题（缺失 / 不可读 / 形态不认识） |

### 第 2 层 · 单元判定（每类单元一个入口）

| 函数 | 位置 | 判什么 |
|---|---|---|
| `requirementProblems` | `stage-controls.ts:437` | 需求内容是否完整（验收条件 / 对象 / 边界） |
| `planProblems` | `stage-controls.ts:476` | 方案是否完整 + 风险绑定摘要是否与承接需求一致 |
| `taskProblems` | `stage-controls.ts:574` | 任务**弱判据**：必填字段。⚠ 派活路径要用 `taskFullProblems` |
| `taskFullProblems` | `stage-controls.ts:595` | 任务**强判据** = 基础字段 + 风险 |
| `runProblems` | `stage-controls.ts:779` | 运行记录是否成立（`returned` + 时间 + 归属） |
| `evidenceProblems` | `stage-controls.ts:1040` | 证据是否可追溯（引用能否解析到真实单元） |
| `acceptanceProblems` | `stage-controls.ts:672` | **C-7**：`pass` 必须有产品确认 · 验收者 ≠ 实现者（⚠ **`built_by` 缺 ⇒ fail-closed**，S-03 对齐 K-6）· 独立验收会话 ≠ 实现者 · 有技术证据 · 例子结果**逐条三段式** |
| `verificationProblems` | `stage-controls.ts:793` | **C-6/C-8**：技术验证独立性 + `criteria_refs` + 例子结果 |
| `closureProblems` | `stage-controls.ts:871` | **C-27**：`closure_mode` 封闭集 · `skipped` 须写理由与决定者 · `closed` 须绑定风险推导档位 + 发布证据（R-13：**不按物理顺序取方案**） |
| `titleProblems` | `stage-controls.ts:988` | 标题是否说明**实际对象**（不只是编号 / 状态词） |

### 第 3 层 · 聚合

| 函数 | 位置 | 判什么 |
|---|---|---|
| `requirementApprovalProblems` | `stage-controls.ts:461` | G1：需求是否被**当前修订**的用户批准覆盖 |
| `planApprovalProblems` | `stage-controls.ts:559` | G2：方案是否被批准 + 是否选中合法路径 |
| `stageApprovalProblems` | `stage-controls.ts:1118` | G1 + G2 的合并（用户闸门） |
| `stageFieldProblems` | `stage-controls.ts:1071` | 全部单元的字段层判定（⚠ 两个参数：`units` 判谁 / `context` 查引用） |
| `stageControlProblems` | `stage-controls.ts:1126` | **字段 + 审批**的完整推进健康 |
| `ledgerClosureProblems` | `stage-controls.ts:1152` | 账本闭环缺口（任务图 / 覆盖 / 风险对象） |
| `taskGraphRiskProblems` | `stage-controls.ts:607` | 任务图整体风险（同路径并行 / 串行依赖） |
| `taskRiskAgainstPlanProblems` | `stage-controls.ts:639` | 任务风险是否与方案的风险评定矛盾 |
| `sendBackRoundProblems` | `stage-controls.ts:1486` | **C-30**：回炉轮数上限 —— 当前 task 修订上 `acc`/`verification` 的 `send-back` 条数 ≥3 ⇒ 越界（⇒ 回头改方案，⛔ 不是再修一轮）；⚠ 历史修订不计 · 父任务缺 revision ⇒ 单列「判不出」，⛔ 不当作 0 轮 |

### 第 4 层 · 闸门

| 函数 | 位置 | 判什么 |
|---|---|---|
| `evaluateGate` | `stage-controls.ts:1320` | **唯一闸门入口**：`action` + `scope` ⇒ `GateDecision` |
| `gateScopeUnits` | `stage-controls.ts:1218` | 把 `scope` 解析成要判的单元集合 |
| `gateProblemsAt` | `stage-controls.ts:1408` | 某一阶段的闸门问题（⚠ R-17：必须与字段层用**同一强度**的判据） |
| `returnStageOf` | `stage-controls.ts:1403` | 阻断原因 ⇒ 该退回到哪一步 |

---

## 三、跨切面判定（不属于单元生命周期，但同样影响推进）

| 函数 | 位置 | 判什么 |
|---|---|---|
| `pipelineDispatchProblems` | `pipeline-view.ts:738` | 派活门禁：任务图无环 / 无悬空 / 覆盖无缺口（G3） |
| `pipelineRevisionProblems` | `pipeline.ts:629` | 内容变了但 `revision` 没递增 |
| `pipelineWriteProblems` | `pipeline.ts:698` | 写入前的管线形态校验 |
| `approvalDecisionProblems` | `pipeline.ts:590` | 批准单元本身是否合法（`decided_by` / 回执 / 修订绑定） |
| `verificationRevisionProblems` | `pipeline.ts:660` | 技术验证绑定的修订是否仍有效 |
| `selectedOptionValid` | `pipeline.ts:397` | 选中的路径是不是方案里真实存在的选项 |
| `verifyRefsProblems` | `convergence.ts:117` | 验证引用能否解析（I7 唯一实现） |
| `decisionChainProblems` | `convergence.ts:151` | 决策链是否完整（I8 唯一实现） |

### 风险判定（`risk-policy.ts`，5 个）

| 函数 | 位置 | 判什么 |
|---|---|---|
| `riskAssessmentProblems` | `risk-policy.ts:391` | 风险评定是否完整（硬触发六段式 / 单维下限 / 档位不降） |
| `riskObjectProblems` | `risk-policy.ts:513` | 风险对象引用是否有效 |
| `taskRiskProblems` | `risk-policy.ts:656` | 任务执行风险是否声明完整 |
| `residualRiskProblems` | `risk-policy.ts:718` | 残余风险决定是否合法 |
| `riskGateRequirements` | `risk-policy.ts:738` | 某风险档要求哪些门禁（**查询**，不判定） |

### 工作计划判定（`work-plan.ts`）

| 函数 | 位置 | 判什么 |
|---|---|---|
| `closePlanProblems` | `work-plan.ts:932` | 计划能否收口（只有 `joining` 才可 `completed`） |

---

## 四、改判定时的三条纪律

```
① 先问「这条属于哪一层」——层错了，判据会漏或会误报（R-17 的教训）。
② 弱判据与强判据并存时（taskProblems vs taskFullProblems），
   必须确认**两个闸门用的是同一个**。
③ 同一个问题只许有一个产生点：一个出口产出，其余只读。
   `StageControlProblem[]` 是唯一输出类型 —— 不要在别处另造一个。
④ **搬判定逻辑时，先看清判据的锚点在哪**（2026-11-11 实测教训）：
   `check:orch` 的 J3 判的是「**编排侧**的预设读数经总线单点进入」，
   它扫的是 `orchestrator.ts` 的源码文本。把 `.presetOf(` 调用整个搬进辅助文件 ⇒
   J3 直接报 `经总线入口=false`。⚠ 那不是缺陷，**是判据的锚点被搬走了**。
   ⇒ 正确做法：**归约搬走、取值留下**，并在包装器上写明「这个调用点是判据锚点」。
```

⚠ **「判什么」那列里的 `C-xx` / `RP-xx` 是规则号**：它在函数体里以 `rule:` 字段出现，
  可直接 `grep 'C-27' src/shared/stage-controls.ts` 定位到具体那一条 push。
  ⛔ 本表不复制规则全文 —— 规则一改，两处必然漂。

⚠ **判定函数搬家时**：本表的位置列必须**同批**改（`check:judgement-index` 的 ② 会红），
  而 ③ 会同时要求「新位置的那个函数也在表里」⇒ 一次搬迁通常要改两行。
  ⚠ 实测：把 `targetPresetOf` / `wsRootOfSession` 搬出 `orchestrator.ts` 时，
    这两个**不是**判定函数（不以 Problems/Gate 结尾），所以不触发本表；
    但若搬的是 `acceptanceProblems` 这类，就**必须**同批改。

⚠ **本表只写「在哪」和「判什么」**。想知道「为什么这么判」，读该函数上方的注释块 ——
  那里才是判定依据的原文（每条都带 `R-xx` / `O-xx` 的来路）。