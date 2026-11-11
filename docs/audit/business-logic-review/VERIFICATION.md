# dsh-hob 业务逻辑审计 · 独立复核（VERIFICATION）

> **复核对象**：`docs/audit/business-logic-review/REVIEW.md`（1529 行 / 157 KB，99 条缺陷）
> **复核立场**：**证伪，不是背书**。命中的一律记「成立」；口径夸大、数字错、结论过强的记「需修正」；主文档没提但读码/实测能站住的记「遗漏补充」。
> **纪律**：全程只读。**未修改任何源码 / 配置 / 文档**；唯一写入 = 本文件。未跑 `npm run build` / `check:all` / 任何 git 写操作。`node` 探针一律写到 `/tmp/ver_probe_*.mjs`（25 个），只读 `src/**` 纯函数，或把真实账本复制到 `/tmp` 后只操作副本。
> **日期**：2026-11-10

---

## ① 本域业务职责

本域不产出新结论，只做三件事：**抽样回源**（把主文档的每条断言拆成「文件:行号是否真的存在 / 代码是否真如所述 / 结论是否成立」三问）、**反查遗漏**（每域至少两处主文档没写到的疑点，读码或实测得出）、**判可信度**（有没有把「未验证」写成「已验证」、有没有无位置断言、有没有把设计选择说成缺陷）。

判据只有一条：**能不能被证伪**。凡是「读码就能推翻」的，一律算主文档失准；凡是「我复现不出但主文档声称实测」的，一律要求它降级或改口径。

---

## ② 主链路：本次复核走的路径

| 步 | 动作 | 落点 |
|---|---|---|
| 1 | 通读主文档全文（1529 行，逐节） | `REVIEW.md:1-1529` |
| 2 | 抽出全部缺陷标题与等级，与 §1.2 统计表对账 | `REVIEW.md:491-1100`（R 29 / S 15 / T 24 / O 31） |
| 3 | 抽样回源：**40 条**逐条读码 + 定位行号 | §3.1 |
| 4 | 重跑主文档自称「本次亲自跑过」的探针 | `/tmp/syn_probe_health3.mjs` / `syn_probe_exempt.mjs` / `syn_probe_g45f.mjs`（**三份输出与主文档逐字吻合**） |
| 5 | 自建 25 个只读探针复核「实测」类断言 | `/tmp/ver_probe_*.mjs`（清单见 §5.4） |
| 6 | 反查遗漏：六个业务域各读一轮主文档未覆盖的相邻代码 | §4.2（V-01…V-12） |

---

## ③ 契约与不变量：真正被强制的（复核侧）

### 3.1 抽样回源结果（40 条，按主文档编号）

> 判定口径：**成立** = 行号真实 + 代码如所述 + 结论站得住；**部分成立** = 主体成立但关键量化/理由需改；**不成立** = 读码或实测可推翻。

| # | 主文档条目 | 主文档行号 | 我核到的位置 | 判定 | 证据 |
|---|---|---|---|---|---|
| 1 | **T-01** index.toml 被守卫重复计入 | `REVIEW.md:868-878` | `hob-write.ts:1042-1043`（readToml 吞异常）、`:1051`（rel）、`:1052-1056`（merged）、`:1057-1061`（重复 ID 判定） | **部分成立** | 实测：index 有 R-001 + append DEC-001 ⇒ `{"ok":false,"reason":"ledger-duplicate-id","msg":"拒绝：R-001: 合并后的账本出现重复 ID"}`；index 为空 ⇒ `ok:true`。**但「只能装 0 或 1 条」不成立**：一次写入 **3 条**成功（count=3），第 4 次才被拒 ⇒ 真实形态是「**index.toml 只有第一次写能成功**」 |
| 2 | **S-01** 批准是自证链 | `REVIEW.md:734-744` | `tools.ts:2081`（decided_by 字面量）、`:2052`（回执正则）、`:2107`（豁免）；`pipeline.ts:439`（source 只查非空）；`src/preset/tools.ts:1039`（write_hob 在档 1） | **成立** | 四处行号逐一命中（`grep -n decided_by src/modules/tools.ts` ⇒ :2081） |
| 3 | **T-06** 4 处 validateLedgerStructure:false，3 处不必要 | `REVIEW.md:913-923` | `projection-writer.ts:162,272`；`tools.ts:1929,2107` | **成立** | `grep -rn validateLedgerStructure` 恰为这 4 行；实测向健康账本写 decision 单元**用缺省校验**（无豁免）⇒ `{"ok":true}` ⇒ approve 那处确属不必要 |
| 4 | **T-02** 4 套账本健康、四种结论 | `REVIEW.md:880-886` | `tools.ts:581-591` / `:711-721`；`ledger-readiness.ts:294-303`；`stages-index.ts:445-465` | **成立** | 重跑 `/tmp/syn_probe_health3.mjs`：readiness=unhealthy/[L-2:TSK-001] · stageGateOfLedger=PASS(undefined) · stageHealthOfLedger={ok:true,blockers:[]} · /stages={ok:false,count:1} —— **与主文档逐字一致** |
| 5 | **T-05** repairOf 判据恒空 ⇒ 死锁 | `REVIEW.md:905-911` + §4.7（`REVIEW.md:447`） | `tools.ts:1649-1658`（repairOf 用 stageHealthOfLedger）、`:1660`（forward 用 stageGateOfLedger）；`stage-controls.ts:897-899,989-990` | **部分成立** | 死锁**复现**（只含 L-2 缺口的账：health={ok:true,blockers:[]}，dispatch 门禁=return/L-2）。**但「blockers 结构上恒为空」不成立**：它走 stageControlProblems（字段+审批），**不含闭环**；实测只有字段缺口的账 ⇒ blockers **16 条**（C-5@TSK-1 ×4、RP-9/RP-3…） |
| 6 | **R-01** G4/G5 弱判定 | `REVIEW.md:491-502` | `pipeline-view.ts:145-193`、`:312-327`、`:332-345`、`:442-461` | **成立** | 重跑 `/tmp/syn_probe_g45f.mjs`：activeStage:7、gate:G6-closure、chainCompleted:true，blockedBy **7 条**且 VER-1 的两条**各出现两次**（:325-327 与 :340-344 两个循环）—— 与主文档 §9.4 #1 一致 |
| 7 | **R-03** 步名 7 份字面量已漂 | `REVIEW.md:516-525` | `pipeline-view.ts:33-41` / `stage-controls.ts:22`（**编码任务**）+ `:57`（注释）/ `stages-index.ts:29-37` / `requirement-chain.ts:112-118`（LEGACY）+ `:120-128` / `project-panel.tsx:138` / `gen-ledger.mjs:522` | **部分成立** | 「7 份」**漏了一份**：`src/shared/tasks-progress.ts:67` 的 TASKS_STEP_NAMES 也是五步旧词表（全仓「编码任务」命中 9 处，其中两张是步名表）。「1 份写编码任务」也**不准确**：`stage-controls.ts:22` 与 `requirement-chain.ts:115`（LEGACY_STEP_DEFS，按主文档自述是**有意保留**）共 2 份 |
| 8 | **R-04** 运行时教「五步」、面板七步 | `REVIEW.md:527-538` | `gen/persona.md:364` = `preset-dsh-hob.patch.yml:434`；`gen/contracts.md:200` / `spec/reply.md:84` | **成立** | 三处原文逐字命中；`grep five steps` 在 patch.yml 命中 3 处（:223/:334/:434） |
| 9 | **R-05** G3 不进派活闸门 | `REVIEW.md:540-549` | `pipeline-view.ts:570-648`（pipelineDispatchProblems 全文） | **成立（读码）** | 逐行核对 576-647：taskProblems / riskAssessmentProblems / riskObjectProblems / RP-3 / taskRiskProblems 收尾，**全文无 taskGraphOf** |
| 10 | **R-28** 多轨首次派发绕过门禁 | `REVIEW.md:712-718` | `orchestrator.ts:8837` → `tools.ts:881-888` → `:934-936`（blocked: undefined）；`orchestrator.ts:4816`（写盘在门禁后）；`:4026`（duplicate-plan） | **成立** | 四处行号全部命中；`dispatchPlan`（:4738-4970）内确实**没有任何** pipelineDispatchProblems / stageGateAtLedger 调用 |
| 11 | **T-13** 批准工具不过 proceedGate | `REVIEW.md:972-978` | `tools.ts:1306`（定义）/ `:1582`（唯一调用，在 write_hob 内） | **成立** | `grep -n proceedGate( src/modules/tools.ts` 只有这两处 |
| 12 | **R-22** 工具描述说「只有 ledger 开放」 | `REVIEW.md:672-677` | `bus.ts:2041-2042` vs `read-level-policy.ts:61`（三档全开） | **成立** | 两处原文命中 |
| 13 | **T-04** 面板一次挂起即永久停刷 | `REVIEW.md:897-903` | `project-panel.tsx:1407-1445`、`:3100`；六个 fetch `:323,384,408,531,561,589,608` **均无 AbortController** | **成立** | `grep -n AbortController src/client/project-panel.tsx` ⇒ **零命中**；而 `create-hob-dialog.tsx:372` 的 30000ms 超时 + `:398-399` 的 AbortController 确实存在（对照成立） |
| 14 | **T-09** 账本健康不读 count/truncated | `REVIEW.md:941-948` | `project-panel.tsx:2253`、`:2257`、`:529`（compact:true）；`stages-index.ts:455-462`、`:602-607` | **成立** | 两行客户端代码只用 problems.length；服务端确实给了 count；:2249 的早退是 health.ok === true && problems.length === 0 ⇒ problems=[] && ok=false 会渲染「0 条缺口」并算成 ok |
| 15 | **T-16** 切账本不清 itemDetails | `REVIEW.md:996-1002` | `project-panel.tsx:1150`、`:1154`、`:2217-2221` | **成立** | `grep -n setItemDetails` ⇒ 只在 loadItemDetails 内部，**零处重置** |
| 16 | **S-06** 负控下限 = 0 的族 | `REVIEW.md:779-790`（称 9 个） | `scripts/meta-negative-floor.json` | **部分成立** | 实测 **10 个**（漏 `check:preflight`）；其余断言成立（断言下界 42 = `check-all.mjs:201`；负控 0 = `grep -c 负向对拍` 为 0；:212/:214 只有「负向①/②」注释） |
| 17 | **S-10** FAMILY_FLOOR=45 而可跑 47 族 | `REVIEW.md:821-826` | `check-all.mjs:127`（SELF）、`:152`（=45） | **成立** | node 实测：check:* 共 **50**，SELF = all/preflight/tasks-route-http ⇒ 可跑 **47**，余量 **2** |
| 18 | **R-27** README 的 ledgerHome 与代码相反 | `REVIEW.md:705-710` | `README.md:132` / `:144` / `:131`；`doc-read.ts:139-146` | **成立** | README:144 引的 DEFAULT_LEDGER_DIR 只在注释（doc-read.ts:254）与 README 出现；.hob/INIT.md 不存在（真实 kit/INIT.md） |
| 19 | **R-29** README「不写 ~/.dsh/**（有显式拒绝路径）」 | `REVIEW.md:720-726` | `README.md:166`/`:188` vs `preset-dsh-hob.patch.yml:913` | **成立** | `grep -n .dsh src/server/hob-write.ts` ⇒ **零命中** ⇒ 写面守卫不感知 ~/.dsh |
| 20 | **T-24** ledger.toml 无格式校验 | `REVIEW.md:1054-1059` | `hob-write.ts:767`（白名单直通） | **成立** | 实测写 `this is not a valid activation record` ⇒ `{"ok":true}`，随后 ledgerLifecycleOfRoot ⇒ `{"state":"invalid","active":false}` |
| 21 | **T-18** README 跨实例投递整段描述已删除模块 | `REVIEW.md:1011-1016` | `README.md:162`；`tools.ts:429-432`；`config.ts:139` | **成立** | `grep -rn launcher src/` ⇒ **零命中** |
| 22 | **S-08** CU-5 正则指向已改名常量 ⇒ 恒假面 | `REVIEW.md:802-811` | `check-hob-create-ui.mjs:699` | **成立** | 实测两个正则都是 false：PLANNING_PRESET_ID 在该文件命中 **0**、HOB_PRESET_ID 命中 **1**；stillHasSetPreset 的两个正则实测也**都是 false** ⇒ CU-5 的 else-if 分支同样不可能触发 |
| 23 | **R-10** 覆盖校验读 criteria_refs 而契约是 acceptance_criteria_refs | `REVIEW.md:590-595` | `pipeline-view.ts:692,696` vs `pipeline.ts:157` | **成立** | 全部 criteria_refs 命中点：pipeline-view.ts:692,696,714、stage-controls.ts:648、ledger-projection.ts:607、item-presentation.ts:277 —— 无一处读 acceptance_criteria_refs |
| 24 | **R-18** removeUnitBlock 留孤儿块 | `REVIEW.md:643-649` | `projection-writer.ts:130-150`、`:255-281` | **成立** | 实测（title 在 id 之前的分片 + 一次 dispatch 投影）：返回 {ok:true, applied:3}，分片里变成 **3 个块**，前两块只有 title 无 id |
| 25 | **R-19** 允许 ledger/units/ 任意子路径 | `REVIEW.md:651-656` | `hob-write.ts:163`（LEDGER_PATH_RE 含 /） | **成立** | 实测 ledger/units/sub/unit-x.toml ⇒ ok:true；ledger/units/projection.toml ⇒ ok:true |
| 26 | **T-03** 判不出 ownerWsRoot ⇒ 投影整段静默跳过 | `REVIEW.md:888-895` | `orchestrator.ts:5208`、`:5387`、`:7649`；渲染 `:10008-10017` | **成立（读码）** | 三处条件成立才写 w.ledgerProjection（:5399-5410 / :7662-7672）；渲染层 undefined ⇒ 空数组 |
| 27 | **T-10** Outbox 三重静默 | `REVIEW.md:950-956` | `effects-queue.ts:133`、`:341-349`、`src/preset/tools.ts:209`；`orchestrator.ts:7497` | **成立** | 四处命中；:7497 正是「无收件人 ⇒ 回执不投」那一道 |
| 28 | **S-13** 聚合入口自述「不写任何文件」 | `REVIEW.md:842-847` | `check-all.mjs:47`；`check-preset-contracts.mjs:3781,3856,3892,4055`、`check-stages-route.mjs:1128,1266` | **成立** | `.gitignore` 里 `grep -c negctl` = **0** |
| 29 | **T-21** exit 3 三族与行号全错 | `REVIEW.md:1032-1037` | `check-all.mjs:38-41` / `:70-72` | **成立** | 真实 process.exit(3) 在 check-hob-create-dom.mjs:1517 / check-hob-create-ui.mjs:2392 / check-session-policy.mjs:1859 ⇒ 三个族对、**三个行号全错** |
| 30 | **T-22** 运行时写「第 4 步 acceptor」，实为 verifier | `REVIEW.md:1039-1045` | `preset-dsh-hob.patch.yml:91` = `gen/persona.md:21`；`workflow.toml:71` / `:82`；`gen-preset-contract.mjs:229` | **成立** | 五处命中 |
| 31 | **T-23** TERMINOLOGY kind 表漏 verification/closure | `REVIEW.md:1047-1052` | `TERMINOLOGY.md:51-62`、`:66-67`；`ledger-validation.ts:14-26` | **成立** | 表里确实没有 verification / closure |
| 32 | **T-19** README「三个面」实为五个 | `REVIEW.md:1018-1023` | `README.md:213-219` vs `check-build-sync.mjs:922`（面④）/`:1162`（面⑤）、`:1295`/`:1372` | **成立** | README:214 引的 :52/:69 实际指向「面③语义」与「CHECKER_CRASH_CODE」段；STRICT_FAMILIES 真实在 check-all.mjs:83-101 |
| 33 | **T-20** README「6 类」表只有 5 行 | `REVIEW.md:1025-1030` | `README.md:177` vs `:182-186` | **成立** | 表下确实只有 #1..5 |
| 34 | **T-15** ensurePolicyDirIgnored 返回值三处被丢 | `REVIEW.md:988-994` | `session-policy-service.ts:1290,1478,1529`；`server/session-policy.ts:489-491` | **成立** | 三处都是裸调用；注释原文「返回值有**三处**调用方拿它决定要不要告警」 |
| 35 | **O-21** 面板完全绕过 i18n | `REVIEW.md:1090` | `project-panel.tsx` 全文 | **成立** | node 实测：CJK **12760** 字，t( 调用 **0** |
| 36 | **S-09** 17 处 as any | `REVIEW.md:813-819` | `project-panel.tsx` | **成立** | `grep -c as any` = **17**；`grep -n StagesOk` ⇒ **零命中** |
| 37 | **R-02** 客户端同行并置两个来源 | `REVIEW.md:504-514` | `project-panel.tsx:2599-2603` | **成立** | 同一行内 CHAIN_STATE_TEXT[step.displayState] 与 step.done/total 各一个 span |
| 38 | **R-09** activeStage = 7 + 面板渲染「第 N 步」 | `REVIEW.md:582-588` | `pipeline-view.ts:481`；`project-panel.tsx:2474` | **成立（行号 −1）** | 主文档写 :2473，实际 :2474（:2473 是上一行三元判据） |
| 39 | **S-15** 唤醒兜底是死代码 | `REVIEW.md:856-862` | `orchestrator.ts:603`、`:612-614`；`orch-state.ts:2851-2868` | **成立（读码）** | 两处命中。⚠「唯一调用点被 wakeFallback 门控 ⇒ 零可达」这一句我**未逐层验证**（见 §5.1 U-a） |
| 40 | **T-08** G3–G6 的 blockedBy 到不了面板 | `REVIEW.md:933-939` | `requirement-chain.ts:521-540`、`:547-551`；`project-panel.tsx:95-113`、`:2654-2663` | **成立** | 渲染原文「卡在哪：没有主阻断」在 :2662 |

**结论：抽样 40 条里 36 条完全成立、4 条（T-01 / T-05 / R-03 / S-06）需修正口径**。主文档的行号质量很高（另有两处差 1 行，见 M-07）。

### 3.2 主文档的探针记录可信度（正面证据）

我重跑了它自称「本次亲自跑过」的三个探针，**输出与主文档逐字吻合**：

```
$ node /tmp/syn_probe_health3.mjs
readiness unhealthy / ["L-2:TSK-001"] · stageGateOfLedger PASS(undefined)
stageHealthOfLedger {ok:true,blockers:[]} · stagesRoute {ok:false,count:1}
$ node /tmp/syn_probe_exempt.mjs
normalCount: 4 · exemptCount: 0
$ node /tmp/syn_probe_g45f.mjs
activeStage 7 · gate G6-closure · chainCompleted true · blockedBy 7（含 2 条重复）
```

⇒ 附录 B 的「本次是否亲自跑过」一列**没有虚报**。

### 3.3 主文档**确实**守住的纪律（复核侧确认）

| 纪律 | 复核结果 | 证据 |
|---|---|---|
| 「未验证」单列、不进总表 | **守住** | `REVIEW.md:1104-1159`（§6）单列 C-01（降级）与 P-06（未验证），并明确「不计入 99 条」 |
| 每条给位置 | **守住** | 抽样 40 条，**无一条**缺 文件:行号；仅 2 处行号差 1（M-07） |
| 不把设计选择说成缺陷 | **大体守住，1 处偏严** | O-20 代码注释自陈「选的是『条件化』而不是『撤掉』」，主文档写成「**永远**不可达」（见 §5.2） |
| 「已排除」不再列为缺陷 | **守住** | §9.3 三条在总表里确实没有再出现 |
| 不跑会改仓库状态的命令 | **守住** | 附录 C 声明未跑 build / check:all；我 `git status --porcelain` 看到的 M 项与本次审计无关，?? 项里没有 lib/ 产物 |

---
## ④ 缺陷/风险清单

> 排序口径（团队纪律第 3 条）：**先给「会掩盖其他问题 / 让失败不可观测」的**，再按严重度。
> 本节分两类：`M-x` = 对主文档的**修正项**（主文档说错了 / 说多了 / 说少了）；`V-x` = 主文档**遗漏**的真缺陷。
> 每条给：位置 / 证据（可复现命令或原文）/ 影响 / 建议。

### 4.1 需修正（M 组，按「掩盖性」排序）

#### M-01 · high · 元规则 M-1 会把**被注释掉的负控**算成一条（主文档未提，比 S-06 更根本）

- **位置**：`scripts/check-meta-negctl.mjs:47-56`（`CALL_LIT_RE` + `countLabels`，全文不跳注释）
- **证据**（`/tmp/ver_probe_negctl.mjs`，直接 import `countLabels`）：

```
plain call    => 1
line comment  => 1      #  // bad('负向对拍：被注释掉的对拍', x)
block comment => 1      #  /* ok('负向对拍：块注释') */
inside string => 0
```

- **影响**：主文档 S-06 说「零负控也永远绿」，**准确但不完整**。真实形态是：**把负控注释掉，M-1 仍然数得到它**。⇒ 想临时关掉一条会红的对拍，只要加 `//`；`npm run check:meta-negctl` 照旧全绿（我实跑：退出码 0，合计 571 条）。这是「让失败不可观测」的最短路径，且**不会留下 diff 之外的痕迹**（注释常连 diff review 都会被放过）。
- **建议**：`countLabels` 先剥注释（`src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'')`）再计数；并补一条负向对拍：**把某族一条对拍注释掉 ⇒ M-1 必须红**。主文档 S-06 的描述与修法（抬下限）**不覆盖这条**。

#### M-02 · high · T-05 的「blockers 结构上恒为空」不成立 ⇒ 死锁范围被放大

- **位置**：`REVIEW.md:905-911` 与 §4.7（`REVIEW.md:447`）；代码 `tools.ts:711-721`、`stage-controls.ts:897-899`、`:989-990`
- **证据**（`/tmp/ver_probe_health{3,4,5}.mjs`）：
  - 只含**闭环**缺口（task 的 parent 指向不存在 change）⇒ `stageHealthOfLedger = {ok:true, blockers:[]}`（主文档成立）。
  - 只含**字段**缺口（req 缺 clarify_examples / acceptance_criteria）⇒ `{ok:false, blockers:3}`，规则 `C-1,C-1,C-18`。
  - 只含 **C-5** 缺口（task 缺 task_brief，其余齐全）⇒ blockers **16 条**（@RP-9@CHG-1` ×2、RP-3 ×7、C-5@TSK-1 ×4、RP-4@TSK-1、C-18@R-1、C-19@CHG-1）。
- **正确表述**：`stageHealthOfLedger` 走 project 作用域 ⇒ `evaluateGate` 返回 `stageControlProblems` = **字段 + 审批**，**不含** `ledgerClosureProblems`。所以它的 blockers **不是恒空**，而是「**永不包含 L-1..L-4 闭环缺口**」。
- **影响**：`repairOf` 的死锁**只在缺口是闭环型时成立**（这部分我复现了，成立）；主文档说成「结构上恒空」会让修复方去改一个不需要改的函数，也会让人误以为 repairOf 对所有缺口都失效。**等级不变（blocker 还是 high 应交主控），但理由句必须换。**
- **建议**：`REVIEW.md:909` 改成「它的 blockers 结构上**不含闭环缺口**（evaluateGate 在 project 分支只取 stageControlProblems）⇒ 当且仅当缺口是 L-1..L-4 时恒空」。

#### M-03 · medium · T-01 的容量结论说错（0/1 条 → 「只能写一次」），且漏了更严重的一半

- **位置**：`REVIEW.md:871-873`；代码 `hob-write.ts:1052-1056`
- **证据**（`/tmp/ver_probe_t01{,b,c,d}.mjs`、`ver_probe_mut.mjs`）：
  - 空 index 一次写 **3 条** ⇒ `ok:true`，落盘 **3 个 [[unit]]**；再 append 第 4 条 ⇒ `ledger-duplicate-id`。
  - index 里有 1 条时，**overwrite 改同一个 id 的 title** 也被拒 ⇒ `{"ok":false,"reason":"ledger-duplicate-id"}`。
  - 追加到**分片**（unit-02.toml）正常：`{"ok":true}`。
- **正确表述**：「`index.toml` **只有第一次写能成功**；此后对它的 append 与 overwrite **全部**被 `ledger-duplicate-id` 拒（overwrite 也走同一段 merged）⇒ 落在 index 里的单元**从此既不能新增也不能修改**」。
- **影响**：「只能装 0 或 1 条」与「第二条单元永远写不进」都会被一次 3 条写入推翻；而被漏掉的「overwrite 同样被拒 ⇒ index 内单元不可改」比「写不进」更难绕（任何修正都无法落回原件）。
- **建议**：改容量表述 + 把「overwrite 也拒」补进影响。机检仍用主文档那条（index 有 1 条时 append ⇒ 必须 ok）。

#### M-04 · medium · R-03 的份数与「漂」的份数都少了

- **位置**：`REVIEW.md:516-521`、§2.4（`REVIEW.md:168`）
- **证据**：`grep -rn 编码任务 src/ scripts/` 命中 **9 处**，其中步名表两份：`stage-controls.ts:22` 与 `requirement-chain.ts:115`（LEGACY_STEP_DEFS）；**主文档漏掉的第 8 张表**是 `src/shared/tasks-progress.ts:67` `TASKS_STEP_NAMES = [需求规格, 实现方案, 编码任务, 任务执行, 验收核对]`。
- **影响**：断言覆盖面会漏掉 tasks-progress（它是 `/tasks-progress` 旧路由的解析词典，`check:tasks-progress` 正用同名字面量做正则）。只在 7 份之间加断言，第 8 份仍可漂。
- **建议**：份数改 **8**（§2.4 那张表加一行），把「1 份写编码任务」改「2 份（其中 requirement-chain.ts:115 属 LEGACY，按 §2.4 自述是有意保留）」，并把 `tasks-progress.ts:67` 写进 F-STAGE-NAMES 的比对清单。

#### M-05 · low · S-06 的族数少 1（9 → 10）

- **位置**：`REVIEW.md:783-784`、§9.4 #4（`REVIEW.md:1344`）
- **证据**：node 数 `scripts/meta-negative-floor.json` ⇒ 50 族，==== 0 的 **10 个**；主文档列 9 个，漏 `check:preflight`。
- **建议**：数字改 10 并补 @check:preflight@（它同时是 SELF 三族之一、且 `meta-selfproof-floor.json` 里也没有它 ⇒ 两条元规则都不覆盖它）。

#### M-06 · low · R-20 的「会算成负数」不成立

- **位置**：`REVIEW.md:662`；代码 `ledgers-route.ts:113`
- **证据**：`const legacyUnits = Math.max(0, units - v3Units)` —— **夹住了**，不可能为负。
- **正确表述**：「行计数口径不同 ⇒ v3Units 可能大于 units，被 Math.max(0,…) 夹成 0 ⇒ 表现为**把 v2 单元全部报成 v3**（health='current'），不是负数」。
- **建议**：改这一句；缺陷本身（行计数冒充单元数）成立，等级不变。

#### M-07 · low · 两处行号差 1

| 主文档 | 实际 | 差 |
|---|---|---|
| `REVIEW.md:584` 引 `project-panel.tsx:2473` | `project-panel.tsx:2474` | −1 |
| `REVIEW.md:844` 引 `check-stages-route.mjs:1129` | `:1128`（另一处 `:1266` 未列） | +1 |

- 影响：可忽略（不影响结论），但既然要求「每条给位置」，建议顺手改正。

#### M-08 · medium · T-17 的证据句不成立（「另五个取数函数都有 StaleRouteError 分支」）

- **位置**：`REVIEW.md:1004-1009`
- **证据**：6 个取数函数里，**5 个**抛 StaleRouteError（`defaultFetchProgress:348` / `FetchExec:390` / `FetchStages:537` / `FetchChains:567` / `FetchUnseen:595`），`isStale` 分支 **5 处**（`:1194/1225/1261/1325/1365`）。**没有**抛出也没有分支的是 **2 个**：`defaultFetchResource`（`:604-619`，返回 route-error）与 `defaultFetchPlans`（`:956-966`，同样返回 route-error）。
- **正确表述**：「5 个有、**2 个没有**：资源路由（已报）**与工作计划路由（未报，见 V-10）**」。
- **建议**：改证据句，并把工作计划那一路补成 V-10 一起修。

### 4.2 遗漏补充（V 组 —— 主文档没提，我用读码/实测确认）

> 每域 ≥ 2 处（六域共 12 条）。凡「未跑端到端」的都在影响里注明。

#### V-01 · high · 写前结构校验把「读不出来的既有分片」当空 ⇒ 账本已坏时守卫变静音

- **位置**：`src/server/hob-write.ts:1042-1043`

```ts
const readToml = (name) => {
  try { return parseUnitsToml(readFileSync(join(unitsDir, name), utf8)) } catch { return [] }
}
```

- **证据**（`/tmp/ver_probe_guard.mjs`）：

```
A) 严格解析 index（含 "[meta]" 表头）⇒ THROWS「不支持的 TOML 表头 "[meta]"」
   guard 眼里它是 0 条 ⇒ 追加 DEC-002 到分片 ⇒ {"ok":true}
B) 分片 unit-01.toml 有坏行（严格解析 THROWS「键出现在 [[unit]] 之前」）
   ⇒ 追加 DEC-001 到 unit-02.toml ⇒ {"ok":true}（且与坏行里的 DEC-001 撞号）
```

  另一方向（`/tmp/ver_probe_corrupt2.mjs`）：对**自己就是坏分片**的文件 append ⇒ `{"ok":true}`，坏行原样保留，写入后的文件严格解析仍抛错。
  再一条（`/tmp/ver_probe_corrupt4.mjs`）：坏 index + 坏分片 ⇒ `readiness {state:'unhealthy', gaps:0}`、`stageHealth {ok:true,count:0}`、`stageGateOfLedger = undefined(PASS)`。
- **影响**：`checkLedgerUnitWrite` 的注释写「在落盘前按**合并后的账本全文**校验…不把非法状态写进账本」（`hob-write.ts:1006-1026`）。实际在账本已经坏掉时，**它看到的是「空账本」** ⇒ 校验恒过、错误带 ok:true 进入盘上。这与 T-01「错误原因说谎」是同一族的**反方向**：T-01 把空的说成重复，这里把读不出说成没内容。⇒ 一旦账本因任何原因（投影、手工、迁移）出现一处不可解析的分片，**所有后续写入都会在「看似校验通过」的情况下继续污染它**，而健康面同时报 0 缺口。
- **建议**：`readToml` 的 catch 不能返回 `[]`；应返回 undefined 并让调用方 **refuse（`ledger-unparseable`）**，或至少把「无法解析的分片名」列表回带进 refuse 文案。机检：把某分片改成坏行 ⇒ 任意写入必须被拒。**负向对拍**：把 readToml 改回 `catch { return [] }` ⇒ 断言红。

#### V-02 · high · G3 用「所有计划（含 superseded）」的任务判定「当前计划」的图 ⇒ 第 3 步假完成

- **位置**：`src/shared/pipeline-view.ts:665-670`（taskGraphOf 收集任务）vs `:110-116`（currentTasksOf 只认当前计划）

```ts
const planIds = new Set(plans.map((p) => text(p.id)))   // plans = 该需求下**全部** change
const tasks = units.filter((u) => text(u.kind) === task && (planIds.has(text(u.parent)) || …))
```

- **证据**（`/tmp/ver_probe_graph3.mjs`）：一条需求 + 旧方案 CHG-OLD（**superseded**，下挂 TSK-OLD=built、覆盖 AC-1）+ 新方案 CHG-NEW（settled，**没有任何任务**），G1/G2 均已批准 ⇒

```json
{ "activeStage": 5, "gate": "G4-verification",
  "states": ["1:completed","2:completed","3:completed","4:completed","5:active",…],
  "s3summary": "还没有任务图", "s3items": [], "blockedBy": [] }
```

  ⇒ **第 3 步显示 completed，而同一屏的 summary 是「还没有任务图」、itemIds 是空**，链直接推进到 G4。
- **影响**：这是 R-02「同一屏两个来源」在**服务端内部**的同构形态，也是 R-05 的反面：R-05 说「G3 有洞也放行」，这里说「G3 用**旧方案**的任务算通过」。两件事叠加 ⇒ 换方案后任务图可以「继承」旧方案的任务，从而跳过「把已批准方案拆成自包含任务」这一步。**主文档 §2.4 把「链完成了吗」列了 5 份，但没列「任务图属于谁」这件事有两份口径。**
- **建议**：`taskGraphOf` 的 plans 改用 `currentPlanOf(req, units)`（与 currentTasksOf 同源）；机检：旧方案有 built 任务、当前方案零任务 ⇒ `graph.nodes.length === 0` 且第 3 步必须 active/draft。**负向对拍**：把 plans 改回「全部 change」⇒ 断言红。

#### V-03 · medium · 验收条件的身份落在下标兜底里 ⇒ 插入一条就让 G3 报出不存在的缺口

- **位置**：`src/shared/pipeline-view.ts:692-698`

```ts
const id = /^([A-Za-z]+-[A-Za-z0-9-]+)\s*[:：|]/.exec(c)?.[1] ?? `AC-${i + 1}`
```

- **证据**（`/tmp/ver_probe_cov.mjs`）：同一份账本，只把验收条件数组从 `[AC-1 能跑]` 改成 `[别的条件说明, AC-1 能跑]`（AC-1 从下标 0 移到 1）⇒

```
criteria=[AC-1] at index0 => stage3 blocked, G3 命中 []
同一条 AC-1 在 index1    => stage3 blocked, G3 命中 [G3 · 验收条件 AC-2 没有任务覆盖]
```

- **影响**：真实账本的验收条件**普遍不带 `AC-n:` 前缀**（`prompt-enhancer-release` 的 acceptance_criteria 就是整句中文），所以 id 实际由**数组下标**决定。⇒ 任何一次「在前面插一条 / 调顺序」都会让既有条件**改名**：G3 报出一个不存在的覆盖缺口（假红），而真正没被覆盖的那条被洗成已覆盖（假绿）。acceptance_criteria 参与 digest（`pipeline.ts:149-152`）⇒ 这不是显示问题，是**判定对象随顺序漂移**。
- **建议**：id 只认显式前缀；无前缀时用**内容哈希**（`AC-h(内容)`）而不是下标。机检：在数组头部插一条 ⇒ 既有条件的 coverageGaps **必须不变**。

#### V-04 · medium · hob_ledger_migrate 只重写 index.toml，而现行账本的单元全在分片里

- **位置**：`src/modules/tools.ts:1849-1856`（只读 index.toml）、`:1908-1929`（只 overwrite index.toml）
- **证据**（`/tmp/ver_probe_mig2.mjs`，对真实账本的 /tmp 副本操作）：

```
dsh-hob 账本：index.toml 0 条单元（579 B 注释头）；7 个分片共 292 条；分片里 13 处旧词（status="settled"）
readiness = {"state":"ready","gaps":0}
⇒ migrate 读到 index.toml 0 条 ⇒ 必然 nothing-to-migrate，分片里的 13 处旧词一处也修不到
```

- **影响**：主文档 T-06 把 `:1929` 那处豁免判为「**必要**（它做的就是『把坏行改成好行』）」——**豁免必要这点成立**（我复现了 overwrite index 的迁移写），但「它能修好坏账」这个理由**不成立**：它对现行分片化账本**看不见坏行**。⇒ `hob_ledger_migrate` 在真实存量上是一条**无效的修复通道**，而面板/门禁把「先迁移」当推荐动作（见 V-12 的夹缝）。
- **建议**：改为遍历 `index.toml + unit-*.toml`（与 `readLedgerUnits` 同一份读盘口径），逐文件 overwrite；机检：把旧词写进 unit-01.toml ⇒ migrate(`dryRun:false`) 必须改到它。**负向对拍**：只读 index.toml ⇒ 断言红。

#### V-05 · high · hob_orch_control 的 verify/accept/close-delivery **直接写账本**却不过 proceedGate

- **位置**：`src/modules/orchestrator.ts:10695`（verify 落账）、`:10723`（close-delivery）、`:10886`（accept/send-back）；对照 `:8837`（唯一 proceedGateOf 调用，在 hob_dispatch 内）
- **证据**：`awk 'NR>=10440 && NR<=10980 && /proceedGateOf/' src/modules/orchestrator.ts` ⇒ **零命中**；`grep -n hob_orch_control src/preset/tools.ts` ⇒ `:1170`，在 `MODEL_TOOL_ALLOWLIST` 里 ⇒ **三档都有**。
- **影响**：主文档 T-13（high）说「hob_ledger_init / migrate / rebuild / pipeline_approve 四个写工具全部不过 proceedGate」——**漏了第 5 个，而且是最危险的一个**：verify / accept / send-back / close-delivery 直接把「技术验证通过 / 产品验收通过 / 交付收口」写进账本（走 applyProjection），这正是 S-01（自证批准）**下游**的那一步。被隔离 / 归档 / pending 的会话（mayProceed=false）可以用它把一条链推到 chainCompleted。
- **建议**：把 hob_orch_control 的 4 个写动作纳入 proceedGate（stop / resume / redeliver / watch-wait / archive-stale-plan 保持放行），并写进 T-13 清单。机检：隔离会话调 @control{action:'accept'}@ ⇒ 必须被拒。

#### V-06 · medium · 多轨轨道的 sessionId 与 joinOwnerSessionId 都不校验「该会话存在」

- **位置**：`src/modules/orchestrator.ts:4834-4840`（逐轨用 track.sessionId 派）、`:4530`（推进时用 plan.joinOwnerSessionId 当 self）；`src/shared/work-plan.ts:491`（joinOwner 只判非空）、`:517`（track.sessionId 只判非空）
- **证据**：`validateWorkPlan` 对 joinOwnerSessionId 的唯一判据是 `!nonEmpty(...)`；joinOwnerSessionId 缺省取 self（`orchestrator.ts:8866`），但**显式传值时不核对**。
- **影响**：轨道 sessionId 指向不存在会话 ⇒ dispatch 会在 bus.deliver 处失败并记 failed（可读，这条没问题）；真问题在 joinOwnerSessionId：它决定**谁是汇合责任人、回执投给谁**，而它可以是任意非空串 ⇒ 计划的回执全部投到一个不存在/不相关的会话，advanceWorkPlans 也会以一个假的 self 去派后续轨。**未跑端到端**（需真宿主会话），仅读码 + 结构推断。
- **建议**：dispatchPlan 写盘前核 joinOwnerSessionId 与每条 track.sessionId（`sessions.get(id)` 取不到 ⇒ 拒绝并点名）。机检：传一个不存在的 joinOwner ⇒ 必须拒绝。

#### V-07 · medium · 档位枚举有**第三份**字面量（bus.ts 的入参 enum），且无断言比对

- **位置**：`src/modules/bus.ts:2039`（`enum: [ledger, project, workspace]` 手写）vs 权威 `src/shared/permission-levels.ts:10`（PERMISSION_LEVELS）vs 策略 `src/shared/read-level-policy.ts:61`（OPEN_READ_LEVELS）
- **证据**：`grep -rn permission-levels src/` ⇒ 只有 read-level-policy.ts:46 与 config.ts:626 引用；**bus.ts 不 import PERMISSION_LEVELS**。`grep -rn PERMISSION_LEVELS scripts/*.mjs` ⇒ 只核 config.ts（check-hob-create-dom.mjs:89）与展示面（check-hob-create-ui.mjs:932），**没有一处核 bus.ts 的 enum**。
- **影响**：主文档 R-22 抓的是同一文件里「描述」与常量不符（叙述层）。这里抓的是**入参枚举**：加一档或改名时，hob_spawn 会在参数校验层直接拒绝合法档位（或放行非法档位），且 `check:*` 全绿。与 R-03（步名 7 份）同族、对象不同。
- **建议**：bus.ts 改成 `enum: [...PERMISSION_LEVELS]`；机检：bus.ts 里出现的档位集合 === PERMISSION_LEVELS。**负向对拍**：给 PERMISSION_LEVELS 加一档而不动 bus.ts ⇒ 断言红。

#### V-08 · low · ensurePolicyDirIgnored 的返回值在**定义处所在文件**还有 3 处未接

- **位置**：`src/server/session-policy.ts:464`、`:1121`、`:1216`（都是裸调用）；定义在 `:479`、注释在 `:489-491`
- **证据**：`grep -n ensurePolicyDirIgnored( src/server/session-policy.ts` ⇒ :464（读路径）、:1121（写路径）、:1216（写路径前）+ :479 定义。
- **影响**：主文档 T-15（medium）只点了 session-policy-service.ts 的三处。真实形态更广：**该函数的定义文件自己就有 3 处不接返回值**，其中 :1121/:1216 就在写策略文件之前 —— 「写失败 ⇒ 目录没加 ignore」这个风险在该文件内部同样存在。
- **建议**：T-15 的清单从 3 处扩到 6 处（:464/1121/1216 + service 的 3 处），统一接住 + `ctx.logger.warn`。

#### V-09 · medium · 面板的预设门禁用「属性在不在」判定 ⇒ 宿主不注入该 prop 时门禁整体失效

- **位置**：`src/client/project-panel.tsx:899-902`

```ts
const presetProvided = props !== undefined && Object.prototype.hasOwnProperty.call(props, agentPreset)
const isHobPreset = props?.agentPreset === HOB_PRESET_ID
const blockedByPreset = presetProvided && !isHobPreset
```

- **证据**：`blockedByPreset` 为 false 时，两个取数 effect（`:1001`、`:1186`）与整个渲染（`:3026` 的兜底分支）全部放行；各 state 初值都是 `{kind:'reading'}`，于是**会真的发请求**。
- **影响**：主文档 U-6 记的是「useTabInfo 不被注入 ⇒ effectiveVisible 恒 false ⇒ 一次都不轮询」——那是**偏保守**的失效方向。这里记的是**相反方向**：如果宿主连 agentPreset 这个 prop 都不传（不是传错值，是**不带这个键**），面板会在**非 Hob 会话里**照常渲染并打 6 条账本请求，而代码注释宣称「⛔ 只在渲染层隐藏不够 —— 那仍会打网络、仍会读账本」（:1184-1185）。**未验证宿主是否真的可能不传**（属 U-6 同族的宿主契约未知项）。
- **建议**：改成三态（undefined / other / Hob）：undefined 也按 blocked 处理并显示「判不出」，或至少在 undefined 时只渲染标题一行、不发请求。**需拍板**，见 §5.2 D-3。

#### V-10 · low · 工作计划路由也没有 StaleRouteError 分支（T-17 的第二处）

- **位置**：`src/client/project-panel.tsx:956-966`（defaultFetchPlans 把 404/405 折成 `{ok:false,reason:'route-error'}`）、`:1390-1398`（runPlans 的 catch 无 isStale 分支）
- **证据**：`grep -c 'e instanceof StaleRouteError'` = **5**（`:1194/1225/1261/1325/1365`），覆盖 progress/exec/stages/chains/unseen；runPlans（:1390）与资源路由都没有。
- **影响**：接线故障（路径改名 / 方法不对）在工作计划这一路仍被说成「工作计划读不到（HTTP 404）」——正是 T-17 要治的病，只是换了条路由。工作区面板是「多轨计划的唯一可视面」，这一路读不到会让用户以为「没有计划」而不是「路由没接上」。
- **建议**：defaultFetchPlans 照另 5 个抛 StaleRouteError，runPlans 补 isStale 分支（与 T-17 同批）。

#### V-11 · medium · 存量账本里有一整族「读不见的单元文件」，而文档把两种形态说成一种

- **位置**：`kit/README.md:7`（`units/ ← 唯一机读状态源（index.toml + unit-*.toml）`）vs 真实账本
- **证据**（读盘实测，复制到 /tmp 后读）：

```
/home/lk/.dsh/hob-ledgers/prompt-enhancer-release/ledger/units/
  ACC-001.md ACC-002.md CHG-344.md CHG-345.md CHG-346.md DEC-001.md
  EVD-001.md EVD-002.md EVD-003.md R-001.md R-002.md R-003.md TSK-345.md …
  index.toml          ← 无任何 unit-*.toml 分片
readLedgerUnits(copy) => 19（全部来自 index.toml；19 个 .md 一个都没被读）
```

- **影响**：这是 R-19（能写进 ledger/units/ 子路径但读不见）的**存量版**：真实账本里已有 19 个 `.md` 单元文件，readLedgerUnits / parseUnitsToml / 三处读盘实现**全部只看 index.toml + unit-*.toml** ⇒ 它们是纯幽灵。而这些 .md 的元数据同时也镜像在 index.toml 里（所以读数有 19 条、readiness 报 2 条字段缺口）⇒ 不是数据丢失，而是「**同一单元的正文有两份落点、其中一份永不参与判定**」：正文与索引可以静默分叉。
- **建议**：文档写明「历史账本每个单元一个 .md，其元数据镜像进 index.toml；现行读取面只认 index.toml + unit-*.toml，.md 正文不参与判定」；机检：units/ 下存在 *.md 且同名单元在 index 里 ⇒ 至少给出「正文与索引可能分叉」的读数。

#### V-12 · low · 真实账本的 status 已经越过封闭集（写前校验会把整本账判死）

- **位置**：`src/shared/ledger-validation.ts:14-26`（req: draft/agreed/dropped/retired；change: proposed/settled/superseded；task: todo/doing/built）
- **证据**（`/tmp/ver_probe_status.mjs` 对 10 本真实账本逐单元比对 UNIT_STATUSES）：

```
dsh-hob                          units=292  out-of-set=0
prompt-enhancer-release          units= 19  out-of-set=2   req=proposed@R-003  change=draft@CHG-346
…backup-before-ledger-contract…  units= 13  out-of-set=5   task=settled@TSK-345/346/347  decision=settled@DEC-001
```

  实测（`/tmp/ver_probe_real.mjs`，对 prompt-enhancer-release 的 /tmp 副本）追加一条**完全合法**的 decision ⇒

```
{"ok":false,"reason":"ledger-structure-invalid",
 "msg":"拒绝：账本单元结构不合法（2 条）：R-003: status=\"proposed\" 不属于 kind=req（合法：draft/agreed/dropped/retired）；CHG-346: status=\"draft\" 不属于 kind=change（…）"}
同一份内容加 validateLedgerStructure:false ⇒ {"ok":true}
```

- **影响**：主文档 T-06 说 approve 的豁免「不必要（decision 与封闭契约完全兼容）」——**在健康账本上成立（我复现了）**；但**在真实存量上不成立**：只要这本账里有任何一个旧词状态，write_hob（含模型手工补证据）会被**整本**账的历史缺口拦住，只有走豁免的那几个工具能写。⇒ 豁免的「不必要」是**有条件的**；而「先迁移」这条出路又被 V-04（migrate 只看 index.toml）堵住 ⇒ 这类账本处在「**正文写不进、迁移修不到**」的夹缝里。
- **建议**：给 T-06 的结论加条件（「在封闭集一致的账本上不必要；存量账本上仍是唯一写入口」），并把「封闭集迁移必须先覆盖分片」（V-04）写成 T-06 的前置。

### 4.3 缺陷条数

| 组 | blocker | high | medium | low | 合计 |
|---|---|---|---|---|---|
| **M 组（需修正）** | 0 | 2 | 3 | 3 | **8** |
| **V 组（遗漏补充）** | 0 | 3 | 5 | 4 | **12** |
| 合计 | 0 | 5 | 8 | 7 | **20** |

> 说明：M 组不是「新缺陷」，是对主文档 4 条结论的**口径修正**（其中 M-01/M-02 的修正会改变修复动作，故按 high 计）。
> V 组 12 条里，**V-01 / V-02 / V-05 三条 high** 是我认为**必须补进主文档总表**的（都属「让失败不可观测 / 门禁可绕过」）。

---

## ⑤ 与其他域的边界与疑点

### 5.1 我无法单独判定的（需宿主 / 端到端）

| # | 疑点 | 为什么判不了 | 影响 |
|---|---|---|---|
| **U-a** | S-15 的「rearmWakeFallback 零可达调用」 | 我只核到 `orchestrator.ts:7938` 有调用、且该段在 `:7932-7950` 的分支里，但**没有**逐层证明该分支外层被 wakeFallback 值门控（wakeFallback 是运行态计算值，静态看不出来） | 若该调用其实可达，S-15 的「一半空转一半读数说假话」会变成「两半都在跑」，等级不变但修法不同 |
| **U-b** | V-09 的「宿主不传 agentPreset prop」 | 需宿主 `sidebar.right.pane.tab` 的 slot props 契约（与主文档 U-6 同一未知项） | 若宿主总会传该键，V-09 降为「理论分支」；否则面板预设门禁在非 Hob 会话上 fail-open |
| **U-c** | V-06 的「假 joinOwnerSessionId 会导致回执全丢」 | 需真宿主会话 + bus.deliver 的失败行为 | 读码成立；端到端未验 |
| **U-d** | T-14 的「console.warn 在生产日志是否可见」 | 需真机日志通道（主文档已列 U-1，我采信其「未验证」标注） | 不影响结论 |

### 5.2 与主文档的**判定分歧**（需拍板）

**[建议决策] D-1** 主文档 T-05 / §4.7 的「stageHealthOfLedger.blockers 结构上恒为空」是否改口径 | 选项：**A** 改成「不含闭环缺口 ⇒ L-* 时恒空」（实测支持，见 M-02）/ **B** 保留原文，降级为「经验描述」 | **推荐：A** 理由：实测一本只含字段缺口的账返回 16 条 blockers，「恒空」是可被一次读码推翻的硬结论。

**[建议决策] D-2** 主文档 O-20（入口永远不可达）算缺陷还是设计 | 选项：**A** 保留 medium / **B** 降 low 并改述为「入口只存在于弹窗内 ⇒ 无法充当『打开弹窗』的入口（循环依赖）」 | **推荐：B** 理由：`create-hob-dialog.tsx:1183-1191` 自陈「选的是条件化而不是撤掉」，说成「永远不可达」会把设计选择记成缺陷；真问题是「它不能当入口」，等级低。

**[建议决策] D-3** V-09（blockedByPreset 用属性存在性判定）怎么修 | 选项：**A** 三态化，undefined 也算 blocked 并显示「判不出」/ **B** 保持 fail-open（认为旧宿主不传时不该打死面板） | **推荐：A** 理由：agentPreset 缺失时面板会读账本、打 6 条请求，与「非 Hob 零请求」的注释承诺相反；三态化成本 ≈ 3 行。

**[建议决策] D-4** V-04（migrate 只看 index.toml）修法 | 选项：**A** 遍历全部分片 / **B** 废弃 migrate，改为「报出旧词清单、由人改」 | **推荐：A** 理由：分片化是现行形态（真实账本 292/292 都在分片），不覆盖分片等于这条工具不存在；B 会让存量账本永久卡在 T-06 的夹缝里（见 V-12）。

### 5.3 复核**没有**做到的事（诚实标注）

1. **没有**端到端跑任何工具（hob_dispatch / hob_pipeline_approve / hob_orch_control）——需要真宿主会话与 launch token。所有「工具面」结论都是**读码 + 纯函数探针**。
2. **没有**跑 `npm run typecheck`（避免长时间占用；t5 自陈未跑，主文档 §6.3 已如实标注）。
3. **没有**覆盖全部 99 条 —— 抽样 **40 条**（40.4%），其余 59 条只做了「标题 + 行号存在性」的粗核（全部命中），未逐条读码。
4. **没有**验证 6 份域报告本身（pipeline.md / ledger.md / dispatch.md / policy.md / client.md / docs.md）——本复核只对 REVIEW.md 负责。
5. V-02 / V-03 的夹具是我按 pipeline-view.ts 的入参形状**手写**的（不经过 hob-write），因此它们证明的是「纯函数在该输入下如此」，不是「该输入在真实账本里可存在」——不过 V-12 已证明真实账本里确有类似形状（R-003 的 req.status='proposed'）。

### 5.4 复核用探针清单（全部在 /tmp，只读）

| 探针 | 复核对象 | 关键输出 |
|---|---|---|
| `/tmp/ver_probe_t01{,b,c,d}.mjs` | T-01 / M-03 | index 有 1 条 + append ⇒ ledger-duplicate-id；空 index 一次写 3 条 ⇒ ok:true；overwrite 同 id ⇒ 也拒 |
| `/tmp/ver_probe_guard.mjs` | **V-01** | 坏 index / 坏分片被当 0 条 ⇒ append ok:true |
| `/tmp/ver_probe_corrupt{,2,3,4}.mjs` | **V-01** | 坏账本 ⇒ stageGateOfLedger=undefined(PASS)、stageHealth={ok:true,count:0}、readiness=gaps:0 |
| `/tmp/ver_probe_mig{,2}.mjs` | **V-04** / M-02 | index 0 条 / 分片 292 条 / 13 处旧词；migrate 必然 nothing-to-migrate |
| `/tmp/ver_probe_graph{,2,3}.mjs` | **V-02** | activeStage:5、s3summary:还没有任务图、s3items:[]、第 3 步 completed |
| `/tmp/ver_probe_cov.mjs` | **V-03** | 同一 AC-1 移到下标 1 ⇒ 报 AC-2 没有任务覆盖 |
| `/tmp/ver_probe_health{3,4,5}.mjs` | M-02 / T-02 | L-2-only ⇒ blockers []；字段缺口 ⇒ **3 条**；C-5 缺口 ⇒ **16 条** |
| `/tmp/ver_probe_g3.mjs` / `zero.mjs` | V-02 边界 | 零任务 + 有验收条件 ⇒ 第 3 步 active/G3（**正确**）；零验收条件 ⇒ 第 2 步 blocked |
| `/tmp/ver_probe_r18.mjs` | R-18 | 一次投影后分片出现 2 个无 id 的裸块 |
| `/tmp/ver_probe_status.mjs` | **V-12** | 10 本真实账本逐单元比对封闭集：2 / 5 处越界 |
| `/tmp/ver_probe_negctl.mjs` | **M-01** | 行注释 / 块注释里的「负向对拍」**照样计数** |
| `/tmp/ver_probe_stuck.mjs` | T-07 副作用 | 同 task 第二次 dispatch ⇒ task TSK-900 已有未回传的 RUN ⇒ 不重复建 |
| `/tmp/ver_probe_shard.mjs` / `mut.mjs` | R-18 / M-03 | 分片 append 会把历史缺口一起算进拒绝；index 单元的 overwrite 被拒 |
| `/tmp/ver_probe_misc.mjs` / `real.mjs` | M-03 / V-12 | overwrite index 同 id ⇒ 拒；真实账本追加合法单元 ⇒ 被整本旧词拦 |

---

**文档结束。**
