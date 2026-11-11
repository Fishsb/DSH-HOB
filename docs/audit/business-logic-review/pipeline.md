# Pipeline v3 主链审查：六/七阶段、G1–G6 闸门与风险推导

> 审查范围（只读）：src/shared/ 下 pipeline.ts / pipeline-view.ts / stage-controls.ts / stages-index.ts /
> stage-status-labels.ts / risk-policy.ts / requirement-chain.ts / convergence.ts / ledger-readiness.ts /
> acceptance-verdict.ts / next-action.ts / work-mode.ts / dispatch-preset.ts / planning-preset.ts / panel-summary.ts，
> 以及为确认「谁真正调用了闸门」而必须读到的调用方：src/modules/tools.ts、src/server/hob-write.ts、
> src/preset/tools.ts、src/modules/orchestrator.ts、src/client/project-panel.tsx。
> 审查日期 2026-11-10。**未修改任何源码/配置/文档**；唯一写入的文件是本报告。
>
> 证据方式：除逐行读码外，对纯函数做了**真实执行验证**（Node 24 直接执行 .ts，只 import 纯函数、不写盘，
> 脚本落在 /tmp/pa_probe1..8.mjs）。凡标「实测」的结论都有可复现输出；凡无法用代码证明的标「未验证」。

---

## ① 本域业务职责（3 句内）

本域把「需求→方案→任务图→执行→技术验证→产品验收→（风险启用）交付收口」这条链的**判定**做成一组纯函数：
pipeline.ts 定义 v3 契约与「用户批准当前修订」的证明方式（只认 decision 审计单元），
stage-controls.ts 定义每阶段「什么算完成」与字段/关系门禁，risk-policy.ts 把风险事实推导成风险档位、
评审深度与 G6 收口档位，pipeline-view.ts 把它们折成「当前第几步 / 下一步谁做」的唯一投影。
本域的输出被三类消费者读取：**派活闸门**（tools.ts:dispatchGateAtLedger）、**写账守卫**（hob-write.ts）、
**面板/路由投影**（stages-index.ts → requirement-chain.ts → project-panel.tsx）。

---

## ② 主链路：入口 → 状态 → 落盘 → 出口

### 2.1 入口：谁定义阶段、谁能推进

| 环节 | 位置 | 事实 |
|---|---|---|
| 阶段词表 #1（契约） | src/shared/pipeline.ts:48-51 | PIPELINE_STAGE_IDS 7 个：requirements/plan/tasks/execution/verification/acceptance/closure |
| 阶段词表 #2（视图） | src/shared/pipeline-view.ts:33-41 | PIPELINE_STAGES 7 项，自带 step/name，**独立字面量** |
| 阶段词表 #3（闸门） | src/shared/stage-controls.ts:16-27 | STAGE_IDS + STAGE_NAMES 7 项，**又一份字面量** |
| 阶段词表 #4（路由） | src/shared/stages-index.ts:29-37 | STAGE_DEFS 7 项，按 **kind** 而非 id 组织 |
| 阶段词表 #5（链投影） | src/shared/requirement-chain.ts:120-128 | STEP_DEFS 7 项 + LEGACY_STEP_DEFS 5 项（旧管线仍是「验收核对」一步） |
| 阶段词表 #6（客户端） | src/client/project-panel.tsx:138,148-156 | STAGES_STEP_NAMES + STAGE_KIND_BY_STEP |
| 「什么算完成」口径 | src/shared/stage-controls.ts:68-102 | STAGE_COMPLETION（只有定义文本 + judgedBy 字符串，**不被任何代码执行**） |
| 当前步唯一投影 | src/shared/pipeline-view.ts:354-503 | activeStage/gate/nextActor/nextAction 的**唯一**赋值点 |
| 派活闸门 | src/modules/tools.ts:812-937 | dispatchGateAtLedger：readiness → lifecycle → 作用域门禁 → pipelineDispatchProblems |
| 写账守卫 | src/server/hob-write.ts:1070-1092 | stageFieldProblems + ledgerClosureProblems + pipelineWriteProblems + pipelineRevisionProblems + verificationRevisionProblems |
| 用户批准落盘 | src/modules/tools.ts:1954-2118 | hob_pipeline_approve：**全仓唯一**写 decision_kind=stage-approval 的地方 |

**结论**：阶段词表有 **6 份独立字面量**，且不存在「唯一真源」被强制引用（详见缺陷 P-02）。
唯一真正的「当前步」权威是 pipelineViewOf，但**派活闸门不读它**——闸门走 pipelineDispatchProblems，
是另写的一套（缺陷 P-03）。

### 2.2 状态：批准如何产生、如何失效

   写 req/change 内容 ──► 写账守卫(hob-write.ts:1076) ──► 允许（未批准也能存草稿，注释见 :1071-1075）
           │
           ▼
   hob_pipeline_approve(tools.ts:1954)
     ├─ artifact 存在 / kind ∈ {req,change}            :2011-2018
     ├─ isPipelineV2(artifact)  ← 实为 isPipelineV3     :2019-2021（pipeline.ts:114-116）
     ├─ revision 与账本完全一致                          :2022-2028
     ├─ source 非空                                      :2029-2032
     ├─ 方案必须从 path_options 选一条                    :2038-2046
     ├─ source 必须匹配「确认<对象> <ID> 第 N 版」        :2051-2058
     └─ 写 unit-pipeline-approval.toml（append）         :2093-2108（validateLedgerStructure:false）
           │
           ▼
   approvalStateOf(pipeline.ts:307-394) 按以下顺序判定：
     legacy(非 v3) → invalid(无 revision) → awaiting-user(status=draft/proposed)
     → missing(无 decision) → invalid(decision.status≠active) → invalid(decision 不在封闭集)
     → request-changes → invalid(decided_by≠user) → **stale(artifact_revision≠当前)**
     → **stale(artifact_digest≠当前)** → invalid(selected_option 不在 path_options) → approved

失效判定**确实存在且有效**（artifact_revision 与 artifact_digest 双重绑定，pipeline.ts:354-373），
但有两处结构性缺口：**digest 绑定的是旧批准，内容变化时由写守卫反向要求「revision 必须递增」**，
而这条反向要求只在「已存在 decision」时才触发（pipeline.ts:551-564，见缺陷 P-06）。

### 2.3 落盘：v2 旧条目如何被隔离

- isLegacyPipeline（pipeline.ts:118-121）：pipeline_version 为空或 ∈ ['v2'] ⇒ legacy。
- legacy 条目在 pipelineViewOf 里被降为 state='legacy'、activeStage=null、gate=null（pipeline-view.ts:274,359-363），
  且 pipelineDispatchProblems 对非 v3 任务直接返回 C-20（pipeline-view.ts:579-581）⇒ **不能派发**。
- 但 **legacy 条目绕过的是「所有」字段门禁**（stage-controls.ts:290,329,422,521,613,630,702,779,831 等 11 处），
  且 approvalStateOf 对 legacy 返回 legacy 而 requirementApprovalProblems 把 legacy 视为通过
  （stage-controls.ts:317-319）⇒ legacy 需求**不需要任何用户批准**即可通过 G1。

### 2.4 出口：视图/面板如何读

   ledger/units/*.toml
      └─► stages-index.buildStages(:316-343)   ← 按 kind 数完成度（STAGE_KIND_STATUSES:40-88）
            ├─► nextAction(:375-378)           ← 全账本六态优先级（next-action.ts:143-243）
            ├─► panelSummaryOf({stages: []})(:431)  ← 项目级摘要**故意不给当前步**
            └─► pipelineViewsOf(:425)          ← 每条需求一份 PipelineView
      └─► requirement-chain.buildRequirementChain(:337-567)
            ├─ pipeline = pipelineViewOf(:341) ← 当前步权威
            ├─ next = nextAction(chainUnits, {})(:430)  ← **不注入 convergence**
            ├─ 链内补丁(:451-461 / :472-491)   ← 覆盖全局 next
            └─ currentStep = pipeline.activeStage(:520) ← 覆盖 legacy 推导
      └─► project-panel(:71-75, :2653-2666)    ← 读 pipeline.activeStage + chain.next.blockedBy

---

## ③ 契约与不变量清单（当前代码里**真正被强制**的）

| # | 不变量 | 强制点 | 强制强度 |
|---|---|---|---|
| I-1 | 用户批准只认 decision_kind=stage-approval 的 decision 单元；status=agreed/settled 不算 | pipeline.ts:330-333 | 强（缺 decision ⇒ missing ⇒ G1/G2 不通过） |
| I-2 | 批准绑定**具体 revision**，版本不符 ⇒ stale | pipeline.ts:354-363 | 强 |
| I-3 | 批准绑定**内容摘要**，内容变 ⇒ stale | pipeline.ts:364-373（artifactDigestOf） | 强 |
| I-4 | 批准者必须是 user，Hob 不能自批 | pipeline.ts:351-353 + :435 | 强 |
| I-5 | 方案批准必须记录 selected_option，且必须在当前 path_options 内 | pipeline.ts:374-385,440-442 + tools.ts:2038-2046 | 强 |
| I-6 | 只回「继续 / 可以」不构成批准 | tools.ts:2051-2058 | **只在工具入口强**；直接写 decision 单元则完全不查（P-05） |
| I-7 | 内容变更必须递增 revision（否则旧批准被静默复用） | pipeline.ts:551-564 | **弱**：无 decision 时不触发（P-06） |
| I-8 | RUN/ACC 必须绑定 task_revision，父任务升版 ⇒ 旧记录失效 | pipeline.ts:453-478 | 强 |
| I-9 | VER 必须绑定 task_revision，父任务升版 ⇒ 旧验证失效 | pipeline.ts:484-507 | 强 |
| I-10 | 派活对象必须是 v3 task，父方案与全部需求必须已批准 | pipeline-view.ts:576-619 | 强 |
| I-11 | 派活对象必须真实存在于账本，且 kind=task | tools.ts:640-690 | 强（含 implicit 白名单豁免，tools.ts:652） |
| I-12 | 风险档位由事实推导，声明值只能抬高不能压低 | risk-policy.ts:298-301,416-421 | 强（RP-2） |
| I-13 | 硬触发必须逐条给六段式事实，未知/缺失/孤儿/重复都红 | risk-policy.ts:371-398 | 强（RP-1） |
| I-14 | 十维必须齐全且值在封闭集内 | risk-policy.ts:404-414 | 强（RP-9） |
| I-15 | 风险评定绑定方案事实摘要，事实变 ⇒ stale | stage-controls.ts:367-372（RP-3） | 强 |
| I-16 | 高/极高风险方案必须有「评审者 ≠ 作者」的独立评审 | risk-policy.ts:443-448 | 强（RP-4） |
| I-17 | 任务执行风险必须声明，并据此要求隔离/串行/复核 | risk-policy.ts:605-642 | 强（RP-4） |
| I-18 | 同方案下两个任务写同一路径必须串行或拆分 | stage-controls.ts:454-479 | 强（RP-5），但**只判同 parent** |
| I-19 | 验收通过必须有独立会话、独立 actor、技术证据、例子逐条结果 | stage-controls.ts:524-564 | **只在 acceptanceProblems 内强**；G5 完成判定**不读它**（P-01） |
| I-20 | 技术验证必须有 basis、独立会话、criteria_refs、关闭非符合项 | stage-controls.ts:635-657 | 同上（P-01） |
| I-21 | G6 收口档位由风险推导，skipped 不能用于 strict | stage-controls.ts:715-726 | 强（但方案选取顺序不稳，P-09） |
| I-22 | 账本结构：kind/status 必须在封闭集，ID 不得重复 | ledger-validation.ts:36-53 + hob-write.ts:1057-1069 | 强 |
| I-23 | 账本必须存在且 lifecycle.active 才能派活 | tools.ts:835-847 | 强 |
| I-24 | 空账本可落第一条需求，但**不能派活** | tools.ts:842-847 | 强 |

**未被强制的「契约」**（写了但没人执行）：
- STAGE_COMPLETION（stage-controls.ts:68-102）：全仓零调用方，只是注释性常量。
- evaluateGate 的 allowedRepairs（stage-controls.ts:1121）：只返回、无人消费。
- pipeline.ts:397-409 的 approvalReceiptPattern / requestChangesReceiptPattern：**零调用方**，
  真正的回执校验是 tools.ts:2051-2058 另写的一份正则（P-10）。
- riskAssessment.needsIndependentReview / needsDualReview / needsUserAcceptance / needsResidualAcceptance
  （risk-policy.ts:324-327）：只被面板文案读（project-panel.tsx:2558-2559），**不参与任何闸门**。

---

## ④ 缺陷 / 风险清单

> 排序口径：先「会掩盖其他问题 / 让失败不可观测」的缺陷（P-01…P-03），再按严重度。
> 等级定义：blocker = 主链可被无证据通过或失败不可观测；high = 关键判定可被绕过或双口径给出相反结论；
> medium = 判定存在但覆盖不全/不稳定；low = 可读性、重复实现、死代码。

### P-01 · blocker · G4/G5 的「阶段完成」用的是弱判定，强判据只写进不显示的黑板

- **位置**：src/shared/pipeline-view.ts:175-184（allTasksVerified）、:187-193（allTasksAccepted）、:442-461（G4/G5 分支）
- **证据**：allTasksVerified 只要求「最新 VER 的 status==='pass' 且 verificationReady() 为真」；
  verificationReady（:151-172）只查 task_revision、证据单元存在、command 有 exit_code，
  **完全不查** verifier/verification_session ≠ built_by、criteria_refs、nonconformance_refs、risk_review_refs。
  allTasksAccepted 只要求 effectiveAcceptanceOf(...).verdict === 'accepted'，**完全不查** acceptanceProblems。
  强判据（verificationProblems / acceptanceProblems）只被 push 进 blockedBy（:322-327），
  而 blockedBy **不参与** activeStage / chainCompleted 的计算。
- **实测**（/tmp/pa_probe5.mjs）：构造「验证者=实现者、无 criteria_refs、验收者=实现者、无 verification_refs、无 example_results」的账本：

      verificationProblems: ["C-25:技术验证者是实现者本人（违反独立性）", "C-25:技术验证没有对应的验收条件（criteria_refs 为空）"]
      acceptanceProblems:   ["C-7:验收者与实现者是同一个会话", "C-7:独立验收会话与实现者相同",
                             "C-7:验收通过但缺技术验证证据", "C-7:验收通过但缺用户例子逐条结果"]
      view.stageStates: 1:completed 2:completed 3:completed 4:completed 5:completed 6:completed 7:active
      view.chainCompleted: true

- **影响**：**6 条独立性/证据违规，阶段 5、6 仍判 completed，链仍判 chainCompleted=true。**
  这是本次审查最重的缺陷：它让「独立验收」这条产品承诺在**判定层**失效——不是"偶尔漏"，是**结构上不参与判定**。
  面板顶部的当前步会直接走到「交付收口」，而用户看不到任何一条 C-7/C-25。
- **建议**：把 allTasksVerified / allTasksAccepted 改为「弱判定 ∧ 强判据为空」，即
  tasks.every(t => latest.status==='pass' && verificationProblems(latest, units).length===0)；
  allTasksAccepted 同理接 acceptanceProblems。或者更彻底：activeStage 的推进条件统一改为
  「gateProblemsAt(stage, units).length === 0」，删掉这组平行弱判定。
- **另附**：pipeline-view.ts:332-346 那段「G4 completeness」**是**强判据，但它同样只 push 到 blockedBy。
  同一文件里同时存在弱判定（决定状态）与强判定（只做提示），是这条缺陷的直接成因。

### P-02 · blocker · 阶段「完成」口径有 5 套实现，面板显示的那套与闸门用的那套不是同一套

- **位置**：
  - 闸门/字段：stage-controls.ts:289-310（req）、:328-403（plan）、:421-439（task）、:519-609（acc）、:626-695（ver）、:698-767（closure）
  - 视图状态：pipeline-view.ts:354-503（G1→G6 的 if/else 链）
  - 路由计数：stages-index.ts:284-293（summarizeStage，只按 finals 计数，**不看任何字段**）
  - 链计数：requirement-chain.ts:359-397（done/doing 各步**再算一遍**，与 pipeline.stages 并存）
  - 客户端：project-panel.tsx:71-75（selectedChartStepOf，pipeline 缺失时回落 chain.currentStep）
- **证据**：summarizeStage 判 done 的唯一依据是「该 kind 的所有条目 status ∈ finals」（:287-291）。
  实测（/tmp/pa_probe5.mjs）：stageHealth/summarizeStage 会认为 acc 全 pass ⇒ 第 6 步 done，
  而 acceptanceProblems 同时报 4 条 C-7。**同一条账本，两个「完成」。**
  requirement-chain.ts:359-397 又独立算出 done/doing，然后在 :551-564 被 pipeline.stages **覆盖 displayState 但不覆盖 done/doing**——
  于是面板同一行里可能出现「状态=已完成，计数=2/3」。
- **影响**：用户在面板上看到「已完成」，闸门却拒绝派活；或反过来，面板显示「进行中」，chainCompleted=true。
  这是「状态不同步」类缺陷的根：**没有任何一处强制「计数」与「判定」同源**。
- **建议**：summarizeStage 不要只看 status，改成接收「该步的 gate 问题数」；或明确降级为「条目计数」并改名
  （如 itemCompletion），在面板上**不与阶段状态并排显示**。requirement-chain.ts:359-397 的 done/doing 应删除，
  全部从 pipeline.stages[i] 派生。

### P-03 · blocker · 派活闸门不检查任务图：覆盖缺口、依赖环、悬空引用都不拦派发

- **位置**：src/shared/pipeline-view.ts:570-644（pipelineDispatchProblems）
- **证据**：该函数逐项检查了 task 是否 v3、父方案是否存在/已批准、需求是否已批准、taskProblems、
  riskAssessmentProblems、riskObjectProblems、risk_binding_digest、taskRiskProblems——
  **完全没有调用 taskGraphOf**。而 G3 的推进判定（:411-417）确实用了 graph.cycles/dangling/coverageGaps。
  实测（/tmp/pa_probe1.mjs）：一个 depends_on:['CHG-1']（指向方案而非任务）的任务，
  taskGraphOf 的 dangling=[]（因为该 id 在账本里存在），但 node.blockedBy=['CHG-1 不存在']、
  ready=false——**这两份判定互相矛盾**。
- **影响**：G3 只是**展示**层面的门（进 blockedBy 文本），不是**派发**层面的门。
  一条任务即使所属需求的任务图有环、有未覆盖的验收条件，只要它自己字段齐全、上游已批准，就能被派出去执行。
  「先拆清任务图再开工」这条契约在派活路径上**不存在**。
- **建议**：pipelineDispatchProblems 内加一段：找到该 task 所属 req，跑 taskGraphOf(req, units)，
  cycles/dangling/coverageGaps 任一非空即拒（规则号建议 C-21/G3）。同时把 dangling 的判据从
  「id 在账本里存在」收紧为「id 是 task」（:672）。

### P-04 · high · legacy（clarify_legacy=pre-control）是**自证豁免**，可跳过 11 类门禁

- **位置**：src/shared/stage-controls.ts:271-286（legacy + legacyMisuse）
- **证据**：legacy(u) 只读一个**由写者自己填的**字段 clarify_legacy === 'pre-control'（:271）。
  唯一的反制是 legacyMisuse（:275-286）：要求 created_at 非空且 < 2026-11-06。
  而 created_at **同样是写者自填**，全仓没有任何写入侧校验它会等于真实落盘时间
  （grep created_at src/shared src/server 只命中 ledger-lifecycle.ts 的账本级字段与 stage-controls.ts:277 的读取）。
  实测（/tmp/pa_probe2.mjs）：一个 2026-11 新写的 v3 需求，只要写
  clarify_legacy:'pre-control' + created_at:'2020-01-01'，requirementProblems 返回 []、
  planProblems 返回 []、stageFieldProblems 返回 []。
- **影响**：被跳过的门禁包括 C-1（需求澄清）、C-2（假设确认）、C-3/C-4（方案路径与映射）、
  C-5（任务书/反例/停手条件）、C-6（运行读数）、C-7/C-12/C-13/C-14（验收独立性/例子/整改/发布证据）、
  C-25/C-26（技术验证）、C-27/C-28/C-29（交付收口）、C-16（证据可复核）、C-17（标题）、L-1..L-4（闭环）。
  即**整条主链的字段门禁可被两个自填字段一次性关闭**。
  注意 G1/G2 的用户批准**仍会拦**（stageApprovalProblems 里 legacy 需求报 C-18，实测已确认），
  所以危害是「内容质量门禁全关」，不是「批准门禁全关」。
- **建议**：① clarify_legacy 只允许在 pipeline_version != 'v3' 的条目上生效（v3 条目一律不许豁免）；
  ② 或在写入侧记录 created_at 为**服务端时间戳**并加校验和；③ 至少把 C-7/C-25 从 legacy 豁免里拿掉——
  独立性是「证据是否可信」的前提，不该因条目新旧而免除。

### P-05 · high · 批准单元可被直接写入账本绕过「回执原文」校验

- **位置**：src/shared/pipeline.ts:414-444（approvalDecisionProblems）、src/server/hob-write.ts:1022-1092
- **证据**：hob_pipeline_approve 会强制回执正则（tools.ts:2051-2058），但账本写入的**通用路径**
  （write_hob → checkLedgerUnitWrite）只跑 unitShapeProblems + stageFieldProblems +
  ledgerClosureProblems + pipelineWriteProblems（hob-write.ts:1070-1084）。
  approvalDecisionProblems 对 source 只要求**非空**（pipeline.ts:439），不要求匹配回执格式。
  实测（/tmp/pa_probe2.mjs）：直接构造一条 source:'继续' 的 decision 单元，
  approvalDecisionProblems 返回 []、approvalStateOf 返回 {state:'approved'}、
  pipelineWriteProblems 返回 []——**三道检查全绿**。
- **影响**：「只回继续不算批准」这条核心契约（CONSTITUTION 第 4 条）**只在工具入口成立，在账本层不成立**。
  Hob 有 write_hob 能力，理论上可以自己写一条 decision 单元把自己批准掉。
  decided_by='user' 也只是字符串（pipeline.ts:351），没有任何签名/会话身份校验。
- **建议**：把回执正则下沉到 approvalDecisionProblems（对 decision==='approve' 要求 source 匹配
  「确认<对象> <artifact_id> 第 <artifact_revision> 版」），使**任何写入路径**都过同一道校验；
  并复用 pipeline.ts:397-409 那两个已存在但零调用的函数（顺带解决 P-10）。

### P-06 · high · 「内容改了但 revision 没递增」在**首次批准之前**完全不被拦

- **位置**：src/shared/pipeline.ts:551-564
- **证据**：

      if (old !== undefined && artifactDigestOf(old) !== artifactDigestOf(unit)) {
        const decisions = approvalDecisionsOf(after, id)
        const maxApprovedRevision = decisions.reduce(...)
        if (decisions.length > 0 && revision <= maxApprovedRevision) { /* C-23 */ }
      }

  实测（/tmp/pa_probe4.mjs）：
  - 无 decision 时改内容不升版 ⇒ writeProblemsNoDecisionYet: []（**放行**）
  - 有 decision 时同样改法 ⇒ ["C-23:内容已变但 revision 未递增（已有决定最高第 1 版，当前第 1 版）"]（拦住）
- **影响**：这是批准失效机制的一个**时间窗漏洞**。流程上是：写草稿 → 反复改 → 首次批准。
  在「首次批准」之前，作者可以把 revision 一直保持 1 而内容随意变；
  批准之后内容变会触发 stale（pipeline.ts:364-373）——所以**批准本身仍然安全**。
  真正的危害在**历史可追溯性**：账本里会出现「第 1 版」对应多个不同内容，
  artifactCanonicalText 的语义（pipeline.ts:176-197：revision 是内容身份）被破坏，
  事后无法判断某条 decision 当初批准的是哪份内容。
- **建议**：把条件从 decisions.length > 0 && ... 改为「artifactDigestOf 变化 ⇒ 必须 revision > oldRevision」，
  与是否有 decision 解耦。注意这条会与「草稿频繁小改」冲突，需产品拍板（见 [建议决策] D-1）。

### P-07 · high · 任务图覆盖校验与任务字段名**不同源**，且 ready 与 dangling 互相矛盾

- **位置**：src/shared/pipeline-view.ts:691-698（覆盖）、:672（悬空）、:704-708（ready 判定）；
  字段名来源 src/shared/pipeline.ts:157
- **证据**：
  - 覆盖校验读 t.criteria_refs（:692,696），而 pipeline.ts 把任务写入契约字段命名为
    acceptance_criteria_refs（pipeline.ts:157，且在 ARTIFACT_FIELDS.task 里参与 digest）。
    实测（/tmp/pa_probe1.mjs）：任务用官方名 acceptance_criteria_refs:['AC-1','AC-2'] ⇒ coverageGaps=["AC-1","AC-2"]（**误报**）；
    改用 UI 名 criteria_refs ⇒ coverageGaps=[]。
  - 悬空判定（:672）的条件是「!byId.has(d) && !units.some(id===d)」——只要该 id 在**全账本**存在就不算悬空。
    实测：depends_on:['CHG-1'] ⇒ dangling=[] 但 node.blockedBy=['CHG-1 不存在']、ready=false。
- **影响**：① 按文档写字段的人永远拿不到覆盖通过，会去改成 UI 名——而 UI 名不参与 digest，
  改它不会让批准失效（pipeline.ts:155-160 不含 criteria_refs）。② dangling 与 blockedBy 对同一事实给相反结论，
  下游读者（G3 的 nextAction 文案）会挑错那个用。
- **建议**：① 覆盖校验改读 acceptance_criteria_refs，并把 criteria_refs 作为兼容别名同时读；
  ② dangling 改为「目标不是 task」也算悬空（与 :706 的 blockedBy 同源）。

### P-08 · medium · 验收「自己验自己」的检查依赖 built_by，而 built_by 缺失时**静默放行**

- **位置**：src/shared/stage-controls.ts:528-536
- **证据**：

      const builder = txt(parent?.built_by)
      if (builder !== '' && acceptor === builder) out.push({ rule:'C-7', ... })
      if (session === '') out.push({ rule:'C-7', ... })
      else if (session === builder) out.push({ rule:'C-7', ... })

  实测（/tmp/pa_probe2.mjs）：父任务无 built_by 时，actor='dev'、acceptance_session='dev'（同一个人）
  ⇒ acceptanceProblems 返回 []；给父任务补上 built_by:'dev' ⇒ 立刻报 2 条 C-7。
- **影响**：built_by 缺失反而让检查更容易通过——这是 fail-open。
  对照 convergence.ts:378-381（K-6）的同一件事：那里 builder === '' 会**报红**（「没法判是不是自己验自己」）。
  同一语义，两个模块，一 fail-open 一 fail-closed。
- **建议**：与 K-6 对齐：builder === '' 时报「无法判定独立性」。

### P-09 · medium · G6 收口档位取「最后一个方案」，与视图的「当前方案」不是同一选取规则，结论随数组顺序翻转

- **位置**：src/shared/stage-controls.ts:711-714（plans.at(-1)）vs src/shared/pipeline-view.ts:101-108（currentPlanOf：按 created_at 排序、跳过 superseded、取最新）
- **证据**：closureProblems 用 units.filter(...) 的**原始数组顺序**取 at(-1)，没有排序、没有跳过 superseded。
  实测（/tmp/pa_probe8.mjs）：同一份账本，两条方案（CHG-OLD: low/skipped，CHG-NEW: high/standard）+ 一条 closure_mode='standard' 的收口：
  - 数组顺序 [req, old, new, closure]（NEW 在后）⇒ closureProblems = []（**通过**）
  - 数组顺序 [req, new, old, closure]（OLD 在后）⇒ ["C-27:closure_mode standard 与风险推导 skipped 不一致"]（**拒绝**）
- **影响**：G6 的判定结果取决于账本分片的读取顺序。同时视图 pipelineViewOf 报 closureMode='standard'
  （因为它用 currentPlanOf 取到 CHG-NEW），与 closureProblems 的推导源**不是同一个方案**。
- **建议**：closureProblems 复用 currentPlanOf 的选取逻辑（建议把它从 pipeline-view.ts 提到
  ledger-relations.ts 或 stage-controls.ts，两边都 import 同一个函数）。

### P-10 · medium · 回执校验正则有两份，纯函数那份是死代码

- **位置**：src/shared/pipeline.ts:397-409（approvalReceiptPattern / requestChangesReceiptPattern，**零调用方**）
  vs src/modules/tools.ts:2051-2058（实际生效的那份）
- **证据**：grep -rn "approvalReceiptPattern\|requestChangesReceiptPattern" src 只命中定义处（pipeline.ts:397,405）。
  两份正则还不等价：pipeline.ts:401 用 确认{label}\s+{id}\s+第\s*{revision}\s*版（\s+ 强制至少一个空格），
  tools.ts:2052 用 (?:确认|要求修改|退回修改)\s*(?:需求|方案)?\s*{id}\s*第\s*{rev}\s*版（全 \s*）。
  即**纯函数版更严、工具版更松**，且纯函数版把「要求修改」也算进 approvalReceiptPattern 的语义之外。
- **影响**：典型「两套口径」——将来谁去调纯函数版，行为会与现状不同。
- **建议**：删掉 pipeline.ts:397-409，或把工具版替换为纯函数版（配合 P-05 下沉）。

### P-11 · medium · nextAction 与 activeStage 是两个独立算法，链内用三段补丁硬对齐

- **位置**：src/shared/next-action.ts:143-243（六态优先级）、src/shared/requirement-chain.ts:430（nextAction(chainUnits, {})，**不注入 convergence**）、:451-461、:472-491（两段补丁）、:519-550（gate 覆盖）
- **证据**：nextAction 的第 ② 步（next-action.ts:167-178）是「有 task 到 built 但**没有任何 acc** ⇒ accept」——
  它不区分「acc 尚未创建」与「acc 已创建但未判决」，也不看 task_revision 是否过期。
  实测（/tmp/pa_probe1.mjs）：只有 run 没有 acc 时，nextAction 返回 accept:TSK-1。
  requirement-chain.ts:451-461 的注释自己承认了这个洞（「TSK-080 标 built 之后全局 nextAction 给不出」），
  用「currentStep===5 且有 unverified 的 ACC ⇒ 补一条 accept」来打补丁；
  :472-491 又为「第 4 步零 RUN」打了第二个补丁。
- **影响**：三个算法（pipelineViewOf / nextAction / 链内补丁）都要对同一件事表态，靠**补丁顺序**保证一致。
  任何一处新增阶段条件，另外两处不会自动跟随。目前至少 :451 的条件里有 next.kind === 'accept'——
  意味着当 nextAction 给出一个**指向错误任务的** accept 时，会被静默覆盖成链内那条，读者无从知道原判定是什么。
- **建议**：nextAction 增加 currentStage 入参，由 pipeline.activeStage 驱动优先级；
  或直接删掉链内两段补丁，让 nextAction 接收 activeStage + gate 后自行给出。

### P-12 · medium · evaluateGate 对「作用域 id 不存在」返回 go（空集即无缺口）

- **位置**：src/shared/stage-controls.ts:989-992（gateScopeUnits 找不到 root 时只返回空集）、:1115-1121
- **证据**：gateScopeUnits 在 root === undefined 时，ids 只有那个不存在的 id，最终 filter 出空数组；
  evaluateGate 对空集跑门禁 ⇒ blockers=[] ⇒ go。
  实测（/tmp/pa_probe4.mjs）：evaluateGate({action:'dispatch', scope:{kind:'task',id:'NOPE'}, units:[]}) ⇒ {decision:'go'}。
- **影响**：**已被调用方补掉**——tools.ts:640-660 在 stageGateAtLedger 里先做存在性核对并返回 hold，
  注释（:622-639）明确记录了这次实测事故。所以**当前不构成可利用漏洞**，
  但 evaluateGate 本身仍是 fail-open 的纯函数，任何新调用方（例如将来的批处理或脚本）会直接踩中。
- **建议**：把「root 不存在 ⇒ 返回 hold」下沉进 evaluateGate 本身，而不是靠每个调用方各自补。

### P-13 · medium · write-repair 动作恒 go，且不参与任何问题计算

- **位置**：src/shared/stage-controls.ts:1097-1099
- **证据**：if (input.action === 'write-repair') return { decision:'go', blockers:[], allowedRepairs:[] }。
  实测（/tmp/pa_probe4.mjs）：evaluateGate({action:'write-repair', scope:{kind:'task',id:'NOPE'}, units:[]}) ⇒ go。
- **影响**：这是**有意设计**（修账必须能写进去），但意味着「repair 路径」在语义上等同于无门禁。
  风险在于调用方可能误用该动作来「推进」而非「修复」——代码里没有区分两者的证据。
- **建议**：在 GateDecision 上加一个显式标记（如 bypass: 'repair'），让调用方与日志都能看出「本次未过门禁」。

### P-14 · low · isPipelineV2 是 isPipelineV3 的别名，但调用方文案仍说「v2」

- **位置**：src/shared/pipeline.ts:113-116、src/modules/tools.ts:2019-2021, 2056、src/preset/tools.ts:1059
- **证据**：export function isPipelineV2(unit) { return isPipelineV3(unit) }（pipeline.ts:114-116，注释写「Compatibility name」）。
  tools.ts:2020 的拒绝文案是「请新建 v2 需求」，:1956 的工具描述是「Pipeline v2 需求或方案的明确批准」，
  preset/tools.ts:1059 也写「Pipeline v2 G1/G2」——而 PIPELINE_VERSION = 'v3'（pipeline.ts:20）。
- **影响**：用户按提示「新建 v2 需求」，实际得到的是 v3 语义；LEGACY_PIPELINE_VERSIONS=['v2']（:22）
  意味着**真按 v2 写会变成 legacy 而被拒绝**。文案与行为相反。
- **建议**：统一文案为 v3；若需兼容，把 isPipelineV2 改名为 isEnrolledPipeline。

### P-15 · low · 阶段状态标签表与状态封闭集是两份维护，靠机检而非类型保证

- **位置**：src/shared/stage-status-labels.ts:35-115 vs src/shared/stages-index.ts:40-88（STAGE_KIND_STATUSES）/ ledger-validation.ts:14-27（UNIT_STATUSES）
- **证据**：STAGE_STATUS_LABELS_ZH 是手写表；stageStatusLabel（:136-158）在「合法但缺标签」时返回
  {known:false, why:'标签表缺 X'}。文件注释（:130）说明由 check:stages-route 的 R-10 咬住。
  另：状态集本身有**三份**——UNIT_STATUSES（写入守卫用）、STAGE_KIND_STATUSES（面板用）、
  requirement-chain 的 STEP_DEFS/判据里的硬编码（stage-controls.ts:323 ['draft','proposed']、
  :422 ['todo','doing','built'] 等）。
- **影响**：新增一个 kind/status 需要同时改 3~4 处，漏一处只在**有真实数据时**才红（stages-index.ts:69-87 的注释
  记录了 goal 漏表导致 R-9 延迟暴露的实例）。
- **建议**：把 UNIT_STATUSES 与 STAGE_KIND_STATUSES 合并为一份（前者可由后者派生），
  stage-controls.ts 里的状态字面量改为读该表。

### P-16 · low · planProblems 对 low 风险也要求路径比较，但 riskGateRequirements.pathComparison 恒 true

- **位置**：src/shared/risk-policy.ts:697（pathComparison: true，无分档）、src/shared/stage-controls.ts:386-390
- **证据**：riskGateRequirements 的 pathComparison 对所有档位都返回 true，但 planProblems 里
  真正使用的阈值是 options.length < (tier === 'low' ? 1 : 2)（:388）——即 low 只要 1 条路径。
  实测（/tmp/pa_probe1.mjs）：gateReqLow = {pathComparison: true, verificationStrategy: false, ...}。
- **影响**：riskGateRequirements.pathComparison 是个**恒真常量**，读它的人会以为「所有档位都需要路径比较」。
  实际的档位差异藏在 stage-controls.ts 的三元表达式里，不在策略表里。
- **建议**：删掉 pathComparison 字段，或改为按档位返回最小路径数（minPaths: 1|2）。

### P-17 · low · 高风险「评审者 ≠ 作者」判据有两份实现，其中一份用声明值、一份用推导值

- **位置**：src/shared/stage-controls.ts:341-359（用 u.risk_tier **声明值**）
  vs src/shared/risk-policy.ts:441-451（用 derived.tier **推导值**）
- **证据**：stage-controls.ts:341 const tier = txt(u.risk_tier).toLowerCase()，然后 :353 ['high','critical'].includes(tier)；
  risk-policy.ts:416-421 先算 derived = riskAssessmentOf({...facts, declaredTier: undefined})，
  :441 用 derived.tier 决定是否需要独立评审。
  两者结果相同（因为 RP-2 已保证 declared ≥ derived，取 declared 只会更严），但**判据来源不同**。
- **影响**：当前无害（声明值恒 ≥ 推导值），但若将来 RP-2 放宽或推导规则变化，两处会给出不同的「需不需要评审」。
  重复实现也是 P-02 同类问题的种子。
- **建议**：stage-controls.ts:341-359 整段删除，改为读 riskAssessmentProblems 已覆盖的 RP-4/RP-5 结论。

### P-18 · low · 收口绑定引用（C-29）只查非空，从不解析目标

- **位置**：src/shared/stage-controls.ts:755-765
- **证据**：chain_acceptance_ref / risk_assessment_ref / residual_risk_decision_ref 三项都只做
  if (txt(u.X) === '') push(C-29)，**不检查该 id 是否存在、是否指向正确 kind、是否与本次收口的对象匹配**。
  grep -rn "chain_acceptance_ref" src 的命中全部是「写入」或「展示」，无一处做引用解析。
- **影响**：填一个不存在的 id 即可满足 C-29。「G6 不得静默改写 G5」这条注释（:750-754）在实现上退化为
  「三个字符串非空」。与 convergence.ts 里 K-2/K-3/K-5 那种「悬空引用即红」的口径不一致。
- **建议**：三项都加存在性 + kind 校验（chain_acceptance_ref 必须是本链的 acc 且 status=pass）。

### P-19 · low · 十维风险里 4 个维度不参与任何推导

- **位置**：src/shared/risk-policy.ts:67-78（定义）vs :201-235（实际使用）
- **证据**：dimensionFloorOf 只读取 severity、reversibility、scope、exposure、detectability、recoveryTime
  六个键；uncertainty、changeSurface、dependencies、verificationMaturity 四个维度
  **只参与加权分数**（:293 score = entries.reduce(...)）与完整性检查（:413-414），
  不进任何 floor 规则。
- **影响**：不是缺陷，但注释（:11-13「Hard triggers, dimension floors and the weighted score are combined with max」）
  容易被读成「十维都有 floor」。实际上 uncertainty=unknown（最差档）单独不会抬高任何档位。
- **建议**：要么给这四维补 floor 规则（例如 uncertainty=unknown ⇒ 至少 medium），要么在注释里写明「四维只计分」。

### P-20 · low · STAGE_COMPLETION、gateProblemsAt 的调用面与注释不符

- **位置**：src/shared/stage-controls.ts:68-102、:1130-1140
- **证据**：STAGE_COMPLETION 全仓零调用（grep STAGE_COMPLETION src 只有定义）。
  gateProblemsAt 只被 scripts/gen-ledger.mjs:1265 调用（生成物），**不在**任何运行时闸门路径上。
  而它的 tasks 分支（:1134）用的是 taskProblems（弱），主闸门 stageFieldProblems（:873）用的是
  taskFullProblems（强，含 taskRiskProblems）——**生成物与闸门对同一阶段给出不同缺口数**。
- **影响**：ledger/gen/stages.md 里的阶段缺口统计与面板/闸门不一致，读者会以为「生成物说 0 缺口但派活被拒」。
- **建议**：gateProblemsAt 与 stageFieldProblems 合并（前者按 stage 过滤后者），删掉弱分支。

---

### [建议决策]

- **D-1** · 草稿期内容变更是否必须递增 revision？ | 选项：**A** 必须（revision 严格等于内容身份，任何内容变化即升版）/ **B** 允许草稿期原地改，只在首次批准后强制升版（现状） | **推荐：A** 理由：现状让「第 N 版」在批准前不唯一，事后无法证明某条 decision 批准的是哪份内容，而这正是 v3 契约存在的理由；代价是草稿期要频繁升版，需在工具层自动递增来抵消。
- **D-2** · clarify_legacy=pre-control 是否还允许用于 v3 条目？ | 选项：**A** 完全禁止（v3 一律不豁免）/ **B** 保留但把 C-7/C-25 从豁免里拿掉 | **推荐：A** 理由：豁免靠两个自填字段自证（P-04），而 v3 是「新管线」，不该继承旧管线的豁免机制；存量迁移可由一次性的 pipeline_version 标注代替。
- **D-3** · G4/G5 完成判定是否改为「强判据为空」？ | 选项：**A** 改为强判据（会显著提高门槛，现有账本可能大面积变红）/ **B** 保留弱判定但把强判据违规升格为「阻断当前步」而非仅文本 | **推荐：A** 理由：独立性是产品承诺，弱判定等于承诺不成立（P-01 实测 6 条违规仍 completed）；B 只是把问题从「静默通过」变成「显示但不拦」，仍是可绕过。

---

## ⑤ 与其他域的边界与疑点

1. **与「账本域」的边界**：本域的所有判定都以 Record<string, unknown> 读取单元，**不校验字段类型**
   （大量 Array.isArray(v) ? ... : []，例如 stage-controls.ts:248-250、risk-policy.ts:136-138）。
   数组写成字符串会被静默当成空数组 ⇒ 「缺字段」与「格式错」不可区分。
   真正的类型校验在 ledger-validation.ts:36-53，但它**只查 kind/status/id**，不查其余字段。
   **无法单独判断**：账本域是否有意把「字段类型」留给写入方（write_hob 的 TOML 解析器）保证——需账本域审查确认。

2. **与「编排域」的边界**：hob_dispatch 的门禁是 proceedGateFor(exec) ?? stageGateFor(exec, scope)
   （preset/tools.ts:2166-2167）——**?? 短路**意味着只要「推进工作方式」闸门返回非空，就不会再跑阶段门禁；
   反之若它返回 undefined 才进入 stageGateFor。两者是**或**关系而非**与**关系。
   这是否有意的「先挡最外层」设计，我从本域无法判断；但结果是**阶段门禁不是每次派活的必经之路**。
   另：preset/tools.ts:291-303 在 dispatchGateAtLedger 导出缺席时**回落到全局门禁**（stageGateOfLedger），
   回落本身是 fail-closed 的（更严），但会让「作用域」语义静默失效。

3. **与「客户端域」的边界**：面板只渲染 next.blockedBy（project-panel.tsx:2653-2666），
   而 pipeline.blockedBy 仅在 G1/G2/legacy 时被搬进 next（requirement-chain.ts:521-540）。
   ⇒ **G3~G6 阶段，pipelineViewOf 算出的全部缺口（含 P-01 那 6 条）在界面上完全不可见**。
   叠加 P-01，违规不但不拦，也不显示。这是我在本域内能确认的最严重的**可观测性**问题，
   但「面板该显示哪些缺口」属于产品口径，需客户端域与产品共同拍板。

4. **与「文档契约域」的边界**：preset/dsh-hob/workflow.toml 声明 7 个阶段（requirements…closure），
   CONSTITUTION.md:8 写「正式六阶段固定」+「G6 交付收口按风险启用」。
   代码里 PIPELINE_STAGE_IDS 是 7 个（含 closure），stage-controls.ts 的 STAGE_IDS 也是 7 个，
   但 STAGE_COMPLETION 的注释（:51-67）把 tasks/execution 的完成语义单独钉了一遍。
   **「六阶段」与「七步」是同一件事的两种说法，还是一处未更新的表述**——我在代码里找不到唯一裁决点，
   需文档契约域确认；若确认是「六阶段 + 条件式 G6」，则代码里所有把 closure 当第 7 步的地方
   （activeStage: 7、PipelineStageId 含 closure、STAGE_DEFS 第 7 项）都需说明其「条件式」性质。

5. **与「策略/权限域」的边界**：hob_pipeline_approve 写盘时传 validateLedgerStructure: false
   （tools.ts:2107），注释说明是为了「不让整本迁移阻塞单条批准」。这意味着**批准单元是唯一一种
   绕过 checkLedgerUnitWrite 全量校验的写入**。这是否构成权限域关心的「守卫旁路」，需策略域判断。

---

## 附：本次实测脚本与关键输出（可复现）

| 脚本 | 验证的结论 |
|---|---|
| /tmp/pa_probe1.mjs | P-03（派发不看图）、P-07（字段名/悬空矛盾）、P-11（nextAction 给 accept）、P-16 |
| /tmp/pa_probe2.mjs | P-04（legacy 自证豁免）、P-05（伪造 decision 三道检查全绿）、P-08（built_by 缺失放行） |
| /tmp/pa_probe3.mjs | G5 无任何用户验收批准仍 completed、acceptanceApprovalState='missing' |
| /tmp/pa_probe4.mjs | P-06（首次批准前改内容放行）、P-12（evaluateGate 空集 go）、P-13（write-repair 恒 go） |
| /tmp/pa_probe5.mjs | **P-01（6 条 C-7/C-25 违规下 G4/G5 仍 completed、chainCompleted=true）** |
| /tmp/pa_probe6.mjs | P-07（覆盖校验对无编号验收条件的行为、自环检测正常） |
| /tmp/pa_probe7/8.mjs | P-09（G6 档位随方案数组顺序翻转） |

复现方式（只读，不写仓库）：

    cd /home/lk/FF/dsh-hob && node /tmp/pa_probe5.mjs

（Node 24 原生剥离 TS 类型，直接 import src/shared/*.ts；这些模块都是纯函数、零 I/O。）

---

## 缺陷统计

| 等级 | 条数 | 编号 |
|---|---|---|
| blocker | 3 | P-01, P-02, P-03 |
| high | 4 | P-04, P-05, P-06, P-07 |
| medium | 6 | P-08, P-09, P-10, P-11, P-12, P-13 |
| low | 7 | P-14, P-15, P-16, P-17, P-18, P-19, P-20 |
| **合计** | **20** | |

## 三条最重要的结论

1. **G4/G5 的「阶段完成」用弱判定，强判据（C-7 验收独立性、C-25 验证独立性）只写进不参与计算、界面上也不显示的 blockedBy。**
   实测：验证者=实现者、验收者=实现者、无 criteria_refs、无 verification_refs、无 example_results 的账本，
   阶段 5/6 仍判 completed、chainCompleted=true（pipeline-view.ts:175-193 vs :322-327）。
   这是「独立验收」这条产品承诺在判定层的结构性失效，也是本次唯一达到 blocker 的判定类缺陷。

2. **同一条链有 5 套「完成」算法（字段门禁 / 视图 if-else / summarizeStage 计数 / 链内 done-doing / 客户端回落），
   没有任何一处强制它们同源**，因此「面板显示已完成」与「闸门拒绝派活」可以同时成立（stages-index.ts:284-293
   vs stage-controls.ts:519-609）。这是所有「状态不同步」表象的共同根因。

3. **v2/legacy 的隔离只隔离了「派发」，没有隔离「门禁」。**
   clarify_legacy='pre-control' + 自填的 created_at 可让一条 2026-11 新写的 v3 条目跳过 11 类字段门禁（P-04）；
   而 decision 单元可以绕过 hob_pipeline_approve 的回执校验直接写入账本（P-05，source:'继续' 三道检查全绿）。
   两者叠加，意味着「v3 契约」在**账本层**是可以被自己声明的字段绕过的。
