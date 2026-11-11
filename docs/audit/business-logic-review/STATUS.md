# REVIEW 112 条 · 逐条状态总表

> ⚠ **本文件是唯一可直接查询的「第 N 条修没修」来源。**
> 此前状态散在 13 卷 `FIX-RESULT` 里，而**一行可能并列多个编号**，
> 导致按编号统计会得出 112 / 93 / 73 三个不同答案（见 `FIX-RESULT-VOL13.md` §186）。
> ⇒ 本表**一行一编号**，可直接 `grep`。

> ⚠⚠ **本表是人工维护的，没有机检覆盖。**
> 它在 `docs/audit/`（不在 `kit/templates|roles|drafts` 三个扫描根内）⇒ `check:*` 不读它。
> ⇒ **代码改动后本表可能失同步，而这个失同步不会被任何判据发现。**

> ⚠⚠ **证据位置必须手工填，⛔ 不要用 `grep` 首个命中自动生成。**
> 2026-11-11 实测：我用首个命中自动填了 101 条，**12 条指错**（12%）——
> 它们指向的是「第一次出现该编号的地方」，而不是「修复点」。
> 例：`O-34` 自动填到 `pipeline-view.ts:816`（内容是 `blockedBy: string[]`），
>     真正的修复在 `:834`（「任务图只认当前方案」）。
> ⇒ 自动生成会让表看起来完整、实际不可核 —— **比留空更糟**。
>
> ⚠ **证据类型有两种，都必须写清是哪一种**：
> · **注释证据**：某文件某行写着「O-XX：…」⇒ 可直接核；
> · **逻辑推断 / 实测推断**：代码里没有编号，结论来自读实现或造夹具 ⇒ 必须注明「代码无编号」；
> · **「某段文字已不存在」**：如 T-18/19/20 的证据是「错表述 0 命中」⇒ 这也是证据，⛔ 不要求出现编号。

> ✅ **它已有形态机检**：`check:audit-status`（4 条普通断言 + 1 条负向对拍）。
> ⚠ 但它只守**形态**（行数 / 编号唯一 / 状态封闭集 / 每行有注记），
>   **守不住「证据位置是否指对」** —— 那只能靠人抽查（见上）。

> ⚠ **留档：我曾以为加一族只要 3 处，实际是 8 处。**
> 2026-11-11 我先写下「成本 = package.json + ASSERTION_FLOORS + 族数下界」，
> 实测发现还有：`check-family-catalog.json` · `meta-negative-floor.json` · `gen:ledger` 重跑 ·
> `check-repo-rules` 的 mustTrack · 以及 `check:gitignore` 自己的断言下界。⇒ **共 8 处**。
> 完整清单已写进 `check-all.mjs` 的 `FAMILY_FLOOR` 上方，⛔ 不要靠记忆。

## 汇总

| 状态 | 条数 |
|---|---|
| ✅ 已修 | **106** |
| ⛔ 已排除（复核证伪） | **3** | S-08 · O-24 · O-15 |
| ⚠ 按设计处理 | **2** | T-07（不保证原子，但半完成可见）· T-13（给 `migrate` 加门会堵死修复通道） |
| ⛔ 未修 | **1** | S-01（需宿主改档或 API） |
| **合计** | **112** | ✅ 闭合（106 + 3 + 2 + 1） |

> ⚠ **本表已于 2026-11-11 与逐条行对齐**：此前写「104 已修 + 2 部分修 + R-02」，
> 但逐条行早已是 R-01/R-02 → 已修、T-13 → 按设计处理 ⇒ 两处口径不一致（§207）。

## 范围边界（⚠ 必读）

本清单 **112 项只含「业务逻辑缺陷」**。

六份域报告共产出约 27+ 条原始发现，汇总时**按性质分流**：

| 来源 | 条数 | 是否进 112 | 理由 |
|---|---|---|---|
| pipeline / ledger / dispatch / policy / client 五域 | 约 25 条 | ✅ 进（归并为 R/S/T/O） | 属于运行时行为缺陷 |
| **docs 域（`docs.md`）** | **22 条（D-01..D-22）** | ❌ **不进** | ⚠ 见下方拆分：10 条在文档侧、**12 条在 `src/` 或 `scripts/` 侧** |

### 这意味着什么

```
✅ 112 项全部有归属：106 已修 · 3 排除 · 2 按设计 · 1 未修
⚠ 但 docs 域 22 条**没有逐条复核**，也不在本清单的修复范围内
⛔ 不能说「全项目缺陷已清空」—— 只能说「业务逻辑缺陷已清空」
```

### 一处需要说明的边界案例

`docs.md` 的 **D-01**（阶段词表 7 份并存且已漂）看起来像运行时问题，实测核实后：

```
v3 七阶段（stage-controls.ts:46 STAGE_NAMES）：任务图 / 技术验证 / 产品验收
旧五步（tasks-progress.ts:67 TASKS_STEP_NAMES）：编码任务 / 验收核对
```

⚠ 这不是「同概念两个名字」，而是**两套语义并存**，且 `project-panel.tsx:190` 已注明：

```
R-08：legacy 链的第 5 步「验收核对」= 产品验收
      （verification 是 v3 才独立出来的）
```

⇒ D-01 指责的是「文档承诺唯一、实际多套」⇒ 属**文档准确性**，仍不进 112。

### ✅ 22 条的实际状态（2026-11-11 逐条核实）

**不是「未复核」——它们在此前批次已全部修过**，本轮只补了 D-22。

```
D-01 阶段词表     pipeline-view.ts 从 STAGE_NAMES 派生（11 处引用）
D-02 零负控       只剩 check:all / check:preflight —— note 明写「结构上就没有，⛔ 不应抬」
D-03 两套步名     check:workflow 4 处 contracts.md 核对
D-04 宪法         checked_by 已修
D-05 聚合写盘     :47 改成「⛔ 它自己不写任何文件——但这不是『整轮检查不写盘』」
                  + .gitignore 3 处 negctl 兜底
D-06 ledgerHome   README:132「空串 = 判不出，不是派生（B4.4 更正）」
D-07 跨实例       README:168「已整族退场（B4.4 更正）」
D-08 三个面       README:222「有五个面（B4.4 更正）」
D-09 CU-5         PLANNING_PRESET_ID 已不在
D-10 6 类 5 行    已修
D-11 余量         FAMILY_FLOOR = 48 零余量
D-12 exit3        :85 写明「三个全错（实测应为 :1523/:1859/:2459）」
D-13 workflow 头  :7 有「O-26 更正」
D-14 五步         10 处 O-27 标注
D-15 actor_role   preset 里 0 命中
D-16 记录区       0 命中
D-17 kind 表      已补 verification/closure
D-18 旧路径       check-gitignore.mjs:458 有 O-29 判据守着
D-19 族名唯一     已修（22 处检测）
D-20 STRICT_FROM  6 处，含说明
D-21 硬编码       '/home/lk/ 0 命中，注释写「改前写死」
D-22 --fix 保险   ✅ 本轮修：check-profile-assembly 加 CHECK_ALL 门禁
                  负向对拍：CHECK_ALL=1 + --fix ⇒ 真实 EXIT=1
```

⚠ 我此前写「12 条位置在 src/scripts 侧 ⇒ 自检体系判据缺陷 ⇒ 未复核」，
  那是**用间接指标（位置字段）代替直接核实**。逐条查过磁盘后：
  **22 条全部有归属，其中 21 条早于本轮已修，1 条本轮修**。

---
### docs 域 22 条的真实状态

```
✅ 22 条全部核实：21 条此前已修 · 1 条（D-22）本轮修
✅ 原文完整保留在 docs.md ④ 节
```

---
## 逐条

| 编号 | 状态 | 注记 |
|---|---|---|
| O-01 | 已修 | `src/shared/stage-controls.ts:274` |
| O-02 | 已修 | `scripts/check-pipeline.mjs:601` |
| O-03 | 已修 | `src/shared/risk-policy.ts:740` |
| O-04 | 已修 | `src/shared/risk-policy.ts:215` |
| O-05 | 已修 | `src/modules/tools.ts:954` |
| O-06 | 已修 | `src/server/hob-render.ts:382` |
| O-07 | 已修 | `src/server/projection-writer.ts:194` |
| O-08 | 已修 | `src/shared/policy-record-state.ts:46` |
| O-09 | 已修 | `src/server/projection-writer.ts:124` |
| O-10 | 已修 | `src/modules/orchestrator.ts:4467` |
| O-11 | 已修 | ⚠ **逻辑推断**（代码无编号）：`src/modules/orchestrator.ts:3998` 明写「轨道状态只从 trackStates 派生」⇒ 旧形态不可表达（§160） |
| O-12 | 已修 | `src/server/session-policy.ts:197` |
| O-13 | 已修 | `src/session-policy-service.ts:707` |
| O-14 | 已修 | `src/modules/tools.ts:146` |
| O-15 | 已排除 | ⚠ 复核证伪（§150） |
| O-16 | 已修 | ⚠ 保留 + 标注（不是删掉） |
| O-17 | 已修 | `src/preset/tools.ts:1744` |
| O-18 | 已修 | `src/client/project-panel.tsx:1560` |
| O-19 | 已修 | `src/client/hob-unselected-gate.tsx:633` |
| O-20 | 已修 | `src/client/create-hob-dialog.tsx:1188` |
| O-21 | 已修 | ⚠ 按裁定 B 关闭（面板仅中文） |
| O-22 | 已修 | `src/client/create-hob-dialog.tsx:1215` |
| O-23 | 已修 | `src/client/project-panel.tsx:1677` |
| O-24 | 已排除 | ⚠ 复核证伪；`t()` 兜底行为是有意设计（§150） |
| O-25 | 已修 | `src/client/hob-unselected-gate.tsx:725` |
| O-26 | 已修 | `scripts/check-workflow.mjs:7` |
| O-27 | 已修 | `scripts/check-stages-route.mjs:3` |
| O-28 | 已修 | `scripts/check-gitignore.mjs:437` |
| O-29 | 已修 | `scripts/check-gitignore.mjs:437` |
| O-30 | 已修 | `scripts/check-hob-unselected-gate.mjs:1892` |
| O-31 | 已修 | `scripts/check-profile-assembly.mjs:1245` |
| O-32 | 已修 | ⚠ **实测推断**（代码无编号）：`src/shared/pipeline-view.ts` 的 blockedBy 两来源分别处理 plan 与 task，集合不重叠；造夹具实测重复 0（§161） |
| O-33 | 已修 | `src/server/hob-write.ts:386` |
| O-34 | 已修 | `src/shared/pipeline-view.ts:834`（任务图只认当前方案） |
| O-35 | 已修 | `src/modules/orchestrator.ts:10954` |
| O-36 | 已修 | `src/client/project-panel.tsx:265` |
| O-37 | 已修 | `src/modules/tools.ts:2051` |
| O-38 | 已修 | `src/shared/pipeline.ts:261` |
| O-39 | 已修 | `src/modules/orchestrator.ts:4929` |
| O-40 | 已修 | `src/modules/bus.ts:2040` |
| O-41 | 已修 | `src/client/project-panel.tsx:1434` |
| O-42 | 已修 | `scripts/check-gitignore.mjs:472` |
| O-43 | 已修 | `src/server/hob-write.ts:1273` |
| R-01 | 已修 | ✅ **段 1/2/3 全部完成，且宽限豁免已有判据**。段 3：`allTasksVerified`→`verificationProblems`、`allTasksAccepted`→`acceptanceProblems`；**宽限分支在判据函数内部**（`stage-controls.ts` 两处 `legacy(u)) return []` 提前返回）。判据：SC-38（运行时分辨力）+ SC-39（源码层调用）+ **SC-40（宽限豁免位置）**，三者负向对拍均成立。⚠ 原先误判为「删宽限分支未做」，实为豁免就在 `verificationProblems`/`acceptanceProblems` 第一行（§204） |
| R-02 | 已修 | ⚠ **规格第①条经双向量证与设计相反，不应实现**（§198）：① `buildStages` 职责是「渲染单元数组」，让它感知主线会破坏分层；② `check:stages-route` 39 条断言 **0 处** `activeStage`，现有判据也不要求。缺陷本身已修：`requirement-chain` 派生自 `pipeline-view`（`:348/:381`），客户端 4 处全用 `displayState` |
| R-03 | 已修 | `src/shared/stages-index.ts:32` |
| R-04 | 已修 | `preset/dsh-hob/spec/notes-handover.md:244` + `preset-dsh-hob.patch.yml:434`（已改七步，§107） + `patch.yml:434` 已改七步（§107） |
| R-05 | 已修 | `src/shared/pipeline-view.ts:760`（G3 无环/无悬空/覆盖缺口已进 pipelineDispatchProblems） |
| R-06 | 已修 | `src/modules/tools.ts:97` |
| R-07 | 已修 | 读盘实现已收敛（§146 分类） |
| R-08 | 已修 | `src/client/project-panel.tsx:190` |
| R-09 | 已修 | `src/client/project-panel.tsx:3377` |
| R-10 | 已修 | `src/client/project-panel.tsx:176` |
| R-11 | 已修 | `scripts/check-work-plan-runtime.mjs:559` |
| R-12 | 已修 | `src/shared/pipeline.ts:672` |
| R-13 | 已修 | `src/shared/pipeline.ts:114` |
| R-14 | 已修 | `src/shared/convergence.ts:19` |
| R-15 | 已修 | `src/modules/tools.ts:2296` |
| R-16 | 已修 | `src/server/hob-write.ts:103` |
| R-17 | 已修 | `src/server/hob-write.ts:196` |
| R-18 | 已修 | `src/server/orch-state.ts:599` |
| R-19 | 已修 | `src/server/hob-write.ts:394` |
| R-20 | 已修 | `src/modules/ledgers-route.ts:23` |
| R-21 | 已修 | `src/shared/work-plan.ts:142` |
| R-22 | 已修 | `src/modules/bus.ts:2056` |
| R-23 | 已修 | `src/shared/risk-policy.ts:469` |
| R-24 | 已修 | `src/client/project-panel.tsx:63` |
| R-25 | 已修 | `src/modules/orchestrator.ts:5896` |
| R-26 | 已修 | `src/client/project-panel.tsx:82` |
| R-27 | 已修 | `scripts/check-work-plan-runtime.mjs:976` |
| R-28 | 已修 | `src/modules/orchestrator.ts:4834` |
| R-29 | 已修 | `scripts/check-work-plan-runtime.mjs:1012` |
| S-01 | 未修 | ⚠ A 方案已落地（攻击面收窄）；C1/C2 两条根治路径依赖的宿主 API **类型里都不存在**（`ToolRunContext` 只有 `deferContext`/`concludeTurn`），需宿主扩展 |
| S-02 | 已修 | `src/modules/tools.ts:260` |
| S-03 | 已修 | `src/server/hob-write.ts:1331` |
| S-04 | 已修 | `src/shared/stage-controls.ts:1343` |
| S-05 | 已修 | `src/shared/stage-controls.ts:922` |
| S-06 | 已修 | `scripts/meta-negative-floor.json`（现只剩 2 族为 0 且合理，§133） 只剩 2 族为 0 且合理（§131） |
| S-07 | 已修 | `scripts/check-workflow.mjs:404` |
| S-08 | 已排除 | ⚠ 复核证伪：CU-5 正则指向的常量已改名（§150） |
| S-09 | 已修 | `src/client/project-panel.tsx:56` |
| S-10 | 已修 | `src/client/project-panel.tsx:20` |
| S-11 | 已修 | `scripts/check-all.mjs:785`（同批新增 S-11 纪律） |
| S-12 | 已修 | `scripts/check-all.mjs:787`（14 → 16） |
| S-13 | 已修 | `scripts/check-all.mjs:48` |
| S-14 | 已修 | `src/client/create-hob-dialog.tsx:1200` |
| S-15 | 已修 | `src/server/orch-state.ts:2852` |
| S-16 | 已修 | ⚠ **实测**：负控计数已做词法安全的注释剥离（`check-meta-negctl.mjs` 的 `stripComments`），「注释掉的负控」不再被算作一条 |
| T-01 | 已修 | `src/server/hob-write.ts:1210` |
| T-02 | 已修 | `src/modules/tools.ts:124` |
| T-03 | 已修 | `src/modules/orchestrator.ts:5611` |
| T-04 | 已修 | `src/client/project-panel.tsx:1499` |
| T-05 | 已修 | `src/modules/tools.ts:124` |
| T-06 | 已修 | `src/server/hob-write.ts:1252` |
| T-07 | 按设计处理 | ⚠ `projection-writer.ts:89` 明写「保证不并发、**不保证原子**」；半完成已可见（`partial{created,failed}`），不做回滚是设计取舍 |
| T-08 | 已修 | `src/shared/requirement-chain.ts:636` |
| T-09 | 已修 | `src/client/project-panel.tsx:63` |
| T-10 | 已修 | `src/server/handoff-effects.ts:40` |
| T-11 | 已修 | `src/modules/orchestrator.ts:5087` |
| T-12 | 已修 | `src/modules/orchestrator.ts:1023` |
| T-13 | 按设计处理 | ✅ **已完整**：4 个写工具里 `approve` 是**唯一该加闸门**的（已加）；`init`（开张）· `migrate`（修复通道）· `rebuild`（归档重建）**都不该拦** —— 它们正是「账本坏了」时要用的（§197 查实 `proceedGate` 判定面含 `store-unreadable`/`unknown-legacy`） |
| T-14 | 已修 | `src/session-policy-service.ts:148` |
| T-15 | 已修 | `src/server/session-policy.ts:417` |
| T-16 | 已修 | `src/client/project-panel.tsx:3043` |
| T-17 | 已修 | `src/client/project-panel.tsx:265` |
| T-18 | 已修 | `kit/README.md` 中「跨实例」0 命中（§163） |
| T-19 | 已修 | `kit/README.md` 中「三个面」0 命中（§163） |
| T-20 | 已修 | `kit/README.md` 中「6 类」0 命中（§163） |
| T-21 | 已修 | `scripts/check-all.mjs:84` |
| T-22 | 已修 | `scripts/gen-preset-contract.mjs:230` |
| T-23 | 已修 | `scripts/check-ledger-resources.mjs:216` |
| T-24 | 已修 | `src/server/hob-write.ts:39` |

## 怎么复核本表

```bash
# 条目总数
grep -cE '^\| [RSTO]-[0-9]{2} \|' STATUS.md          # 应为 112

# 各状态计数
grep -oE '\| (已修|已排除.*|部分修.*|核心已修.*|按设计处理|未修.*) \|$' STATUS.md | sort | uniq -c

# 某一条
grep '^| R-13 |' STATUS.md
```

## 与旧文档的关系

```
FIX-RESULT.md + VOL1~VOL13   诊断过程、病因、修法、验证证据（人读）
STATUS.md（本文件）          逐条结论（机读，可 grep）

⚠ 两者必须一致。若发现不一致，**以本表为准并回改旧卷**。
```
