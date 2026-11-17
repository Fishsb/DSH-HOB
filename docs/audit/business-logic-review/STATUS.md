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
| ✅ 已修（**有指名它的断言**） | **88** | ⚠ 2026-11-17 起这一档要求「注记里有能命中 `scripts/**` 的断言标识」——存量 106 条**一次全部核完不现实**，先整批迁到下一档，再逐卷清 |
| ⚠ 已修-未机器化 | **12** | 代码确实改过（证据位置可核），但**没有任何判据会在它复发时开火**；这一档**只准降不准升**（棘轮）⇒ 每清一条就往上迁一条 |
| ⛔ 已排除（复核证伪） | **5** | S-08 · O-24 · O-15 · O-32 · O-11 |
| ⚠ 按设计处理 | **6** | T-07（不保证原子，但半完成可见）· T-13（给 `migrate` 加门会堵死修复通道） |
| ⛔ 未修 | **1** | S-01（需宿主改档或 API） |
| **合计** | **112** | ✅ 闭合（88 + 12 + 5 + 6 + 1） |

> ⚠⚠ **2026-11-17（批次 3）：`已修` 这一档的含义收紧了。**
> 旧含义 = 「代码改过了」；新含义 = 「**有指名它的断言**」——注记里要有一个
> 形如 `⟦check:<族名>#<断言编号>⟧` 的标识，且那个编号必须真的出现在对应脚本里
> 含「负向对拍」的那一行（由 `check:audit-status` 的 ⑦ 逐行解析）。
>
> 存量 106 条**先整批迁到 `已修-未机器化`**，再由 ⑧ 的棘轮逼着往上迁：
> 那个数**只准降不准升**，上限写死在 `check-audit-status.mjs` 的 `MACHINE_GAP_MAX`。
> ⚠ `已修-未机器化` **不是「没修」**：它说的是「没人会在它复发时开火」。

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
| O-01 | 已修 | `src/shared/stage-controls.ts:274` · **指名断言**：⟦check:stage-controls#SC-33⟧ |
| O-02 | 已修 | `scripts/check-pipeline.mjs:601` · **指名断言**：⟦check:pipeline#PIPE-25⟧ |
| O-03 | 已修 | `src/shared/risk-policy.ts:740` · **指名断言**：⟦check:risk-policy#RP-25⟧ |
| O-04 | 已修 | `src/shared/risk-policy.ts:215` · **指名断言**：⟦check:risk-policy#RP-26⟧ |
| O-05 | 已修 | `src/modules/tools.ts:954` · **指名断言**：⟦check:ledger#O-05⟧ |
| O-06 | 已修 | `src/server/hob-render.ts:382` · **指名断言**：⟦check:ledger-projection#LP-15⟧ |
| O-07 | 已修 | `src/server/projection-writer.ts:194` · **指名断言**：⟦check:regression#R-2⟧ |
| O-08 | 已修 | `src/shared/policy-record-state.ts:46` · **指名断言**：⟦check:session-policy#SP-15⟧ |
| O-09 | 已修 | `src/server/projection-writer.ts:124` · **指名断言**：⟦check:ledger-projection#LP-16⟧ |
| O-10 | 已修-未机器化 | `src/modules/orchestrator.ts:4467` |
| O-11 | 已排除 | ⚠ **逻辑推断**（代码无编号）：`src/modules/orchestrator.ts:3998` 明写「轨道状态只从 trackStates 派生」⇒ 旧形态不可表达（§160） · ⚠ **复核证伪**：代码明写「轨道状态只从 trackStates 派生」⇒ 旧形态**不可表达**，被指称的问题无法发生 |
| O-12 | 已修 | `src/server/session-policy.ts:197` · **指名断言**：⟦check:session-policy#SP-17⟧ |
| O-13 | 已修 | `src/session-policy-service.ts:707` · **指名断言**：⟦check:session-policy#SP-16⟧ |
| O-14 | 已修 | `src/modules/tools.ts:146` · **指名断言**：⟦check:config-face#G-14⟧ |
| O-15 | 已排除 | ⚠ 复核证伪（§150） |
| O-16 | 已修 | ⚠ 保留 + 标注（不是删掉） · **指名断言**：⟦check:config-face#G-15⟧ |
| O-17 | 已修 | `src/preset/tools.ts:1744` · **指名断言**：⟦check:config-face#G-16⟧ |
| O-18 | 已修 | `src/client/project-panel.tsx:1560` · **指名断言**：⟦check:regression#R-2⟧ |
| O-19 | 已修-未机器化 | `src/client/hob-unselected-gate.tsx:633` |
| O-20 | 已修 | `src/client/create-hob-dialog.tsx:1188` · **指名断言**：⟦check:hob-create-dom#D-150⟧ |
| O-21 | 按设计处理 | ⚠ 按裁定 B 关闭（面板仅中文） · ⚠ 不是可回归的缺陷：这一条是**裁定/规格结论**（裁定 B：面板仅中文；规格第①条与设计相反，不应实现）⇒ 落「按设计处理」，⛔ 不是待清的债 |
| O-22 | 已修 | `src/client/create-hob-dialog.tsx:1215` · **指名断言**：⟦check:hob-create-ui#CU-45⟧ |
| O-23 | 已修 | `src/client/project-panel.tsx:1677` · **指名断言**：⟦check:stages-panel-dom#S-47⟧ |
| O-24 | 已排除 | ⚠ 复核证伪；`t()` 兜底行为是有意设计（§150） |
| O-25 | 已修 | `src/client/hob-unselected-gate.tsx:725` · **指名断言**：⟦check:hob-unselected-gate#G-314⟧ |
| O-26 | 已修 | `scripts/check-workflow.mjs:7` · **指名断言**：⟦check:workflow#F-15⟧ |
| O-27 | 已修 | `scripts/check-stages-route.mjs:3` · **指名断言**：⟦check:regression#R-2⟧ |
| O-28 | 已修 | `scripts/check-gitignore.mjs:437` · **指名断言**：⟦check:gitignore#O-28⟧ |
| O-29 | 已修 | `scripts/check-gitignore.mjs:437` · **指名断言**：⟦check:gitignore#O-29⟧ |
| O-30 | 已修 | `scripts/check-hob-unselected-gate.mjs:1892` · **指名断言**：⟦check:hob-unselected-gate#G-315⟧ |
| O-31 | 已修 | `scripts/check-profile-assembly.mjs:1245` · **指名断言**：⟦check:regression#R-2⟧ |
| O-32 | 已排除 | ⚠ **实测推断**（代码无编号）：`src/shared/pipeline-view.ts` 的 blockedBy 两来源分别处理 plan 与 task，集合不重叠；造夹具实测重复 0（§161） · ⚠ **复核证伪**：blockedBy 两来源分别处理 plan 与 task、集合不重叠；造夹具实测重复 **0** ⇒ 被指称的重复并未发生 |
| O-33 | 已修 | `src/server/hob-write.ts:386` · **指名断言**：⟦check:regression#R-2⟧ |
| O-34 | 已修 | `src/shared/pipeline-view.ts:834`（任务图只认当前方案） · **指名断言**：⟦check:pipeline#PIPE-30⟧ |
| O-35 | 已修-未机器化 | `src/modules/orchestrator.ts:10954` |
| O-36 | 已修-未机器化 | `src/client/project-panel.tsx:265` |
| O-37 | 已修 | `src/modules/tools.ts:2051` · **指名断言**：⟦check:ledger#O-37⟧ |
| O-38 | 已修 | `src/shared/pipeline.ts:261` · **指名断言**：⟦check:pipeline#PIPE-24⟧ |
| O-39 | 已修-未机器化 | `src/modules/orchestrator.ts:4929` |
| O-40 | 已修 | `src/modules/bus.ts:2040` · **指名断言**：⟦check:regression#R-2⟧ |
| O-41 | 已修 | `src/client/project-panel.tsx:1434` · **指名断言**：⟦check:regression#R-2⟧ |
| O-42 | 已修 | `scripts/check-gitignore.mjs:472` · **指名断言**：⟦check:gitignore#O-42⟧ |
| O-43 | 已修 | `src/server/hob-write.ts:1273` · **指名断言**：⟦check:ledger-write-policy#WP-14⟧ |
| R-01 | 已修 | ✅ **段 1/2/3 全部完成，且宽限豁免已有判据**。段 3：`allTasksVerified`→`verificationProblems`、`allTasksAccepted`→`acceptanceProblems`；**宽限分支在判据函数内部**（`stage-controls.ts` 两处 `legacy(u)) return []` 提前返回）。判据：SC-38（运行时分辨力）+ SC-39（源码层调用）+ **SC-40（宽限豁免位置）**，三者负向对拍均成立。⚠ 原先误判为「删宽限分支未做」，实为豁免就在 `verificationProblems`/`acceptanceProblems` 第一行（§204） · **指名断言**：⟦check:stage-controls#SC-38⟧ |
| R-02 | 按设计处理 | ⚠ **规格第①条经双向量证与设计相反，不应实现**（§198）：① `buildStages` 职责是「渲染单元数组」，让它感知主线会破坏分层；② `check:stages-route` 39 条断言 **0 处** `activeStage`，现有判据也不要求。缺陷本身已修：`requirement-chain` 派生自 `pipeline-view`（`:348/:381`），客户端 4 处全用 `displayState` · ⚠ 不是可回归的缺陷：规格第①条经双向量证**与设计相反、不应实现**；缺陷本身已修（`requirement-chain` 派生自 `pipeline-view`）⇒ 落「按设计处理」 |
| R-03 | 已修 | `src/shared/stages-index.ts:32` · **指名断言**：⟦check:regression#R-2⟧ |
| R-04 | 已修 | `preset/dsh-hob/spec/notes-handover.md:244` + `preset-dsh-hob.patch.yml:434`（已改七步，§107） + `patch.yml:434` 已改七步（§107） · **指名断言**：⟦check:regression#R-2⟧ |
| R-05 | 已修 | `src/shared/pipeline-view.ts:760`（G3 无环/无悬空/覆盖缺口已进 pipelineDispatchProblems） · **指名断言**：⟦check:regression#R-2⟧ |
| R-06 | 已修 | `src/modules/tools.ts:97` · **指名断言**：⟦check:regression#R-2⟧ |
| R-07 | 已修-未机器化 | 读盘实现已收敛（§146 分类） |
| R-08 | 已修 | `src/client/project-panel.tsx:190` · **指名断言**：⟦check:requirement-chains#RC-15⟧ |
| R-09 | 已修-未机器化 | `src/client/project-panel.tsx:3377` |
| R-10 | 已修 | `src/client/project-panel.tsx:176` · **指名断言**：⟦check:regression#R-2⟧ |
| R-11 | 已修 | `scripts/check-work-plan-runtime.mjs:559` · **指名断言**：⟦check:work-plan-runtime#WPR-11⟧ |
| R-12 | 已修 | `src/shared/pipeline.ts:672` · **指名断言**：⟦check:regression#R-2⟧ |
| R-13 | 已修 | `src/shared/pipeline.ts:114` · **指名断言**：⟦check:stage-controls#SC-37⟧ |
| R-14 | 已修 | `src/shared/convergence.ts:19` · **指名断言**：⟦check:requirement-chains#RC-16⟧ |
| R-15 | 已修 | `src/modules/tools.ts:2296` · **指名断言**：⟦check:regression#R-2⟧ |
| R-16 | 已修 | `src/server/hob-write.ts:103` · **指名断言**：⟦check:regression#R-2⟧ |
| R-17 | 已修 | `src/server/hob-write.ts:196` · **指名断言**：⟦check:regression#R-2⟧ |
| R-18 | 已修 | `src/server/orch-state.ts:599` · **指名断言**：⟦check:ledger-projection#LP-14⟧ |
| R-19 | 已修 | `src/server/hob-write.ts:394` · **指名断言**：⟦check:ledger-write-policy#WP-12⟧ |
| R-20 | 已修 | `src/modules/ledgers-route.ts:23` · **指名断言**：⟦check:ledgers-route#L8⟧ |
| R-21 | 已修 | `src/shared/work-plan.ts:142` · **指名断言**：⟦check:work-plan#WM-34⟧ |
| R-22 | 已修 | `src/modules/bus.ts:2056` · **指名断言**：⟦check:regression#R-2⟧ |
| R-23 | 已修 | `src/shared/risk-policy.ts:469` · **指名断言**：⟦check:risk-policy#RP-24⟧ |
| R-24 | 已修-未机器化 | `src/client/project-panel.tsx:63` |
| R-25 | 已修 | `src/modules/orchestrator.ts:5896` · **指名断言**：⟦check:regression#R-2⟧ |
| R-26 | 已修 | `src/client/project-panel.tsx:82` · **指名断言**：⟦check:regression#R-2⟧ |
| R-27 | 已修 | `scripts/check-work-plan-runtime.mjs:976` · **指名断言**：⟦check:work-plan-runtime#WPR-27⟧ |
| R-28 | 已修-未机器化 | `src/modules/orchestrator.ts:4834` |
| R-29 | 已修 | `scripts/check-work-plan-runtime.mjs:1012` · **指名断言**：⟦check:work-plan-runtime#WPR-29⟧ |
| S-01 | 未修 | ⚠ A 方案已落地（攻击面收窄）；C1/C2 两条根治路径依赖的宿主 API **类型里都不存在**（`ToolRunContext` 只有 `deferContext`/`concludeTurn`），需宿主扩展 |
| S-02 | 已修 | `src/modules/tools.ts:260` · **指名断言**：⟦check:regression#R-2⟧ |
| S-03 | 已修 | `src/server/hob-write.ts:1331` · **指名断言**：⟦check:stage-controls#SC-34⟧ |
| S-04 | 已修 | `src/shared/stage-controls.ts:1343` · **指名断言**：⟦check:stage-controls#SC-31⟧ |
| S-05 | 已修 | `src/shared/stage-controls.ts:922` · **指名断言**：⟦check:stage-controls#SC-32⟧ |
| S-06 | 已修 | `scripts/meta-negative-floor.json`（现只剩 2 族为 0 且合理，§133） 只剩 2 族为 0 且合理（§131） · **指名断言**：⟦check:meta-negctl#M-1⟧ |
| S-07 | 已修 | `scripts/check-workflow.mjs:404` · **指名断言**：⟦check:workflow#F3⟧ |
| S-08 | 已排除 | ⚠ 复核证伪：CU-5 正则指向的常量已改名（§150） |
| S-09 | 已修 | `src/client/project-panel.tsx:56` · **指名断言**：⟦check:regression#R-2⟧ |
| S-10 | 按设计处理 | `src/client/project-panel.tsx:20` · ⚠ 属**口径说明**（FAMILY_FLOOR 的分母）：零余量已由「族数下界」机制保证，无独立行为可回归 |
| S-11 | 已修 | `scripts/check-all.mjs:785`（同批新增 S-11 纪律） · **指名断言**：⟦check:regression#R-2⟧ |
| S-12 | 已修 | `scripts/check-all.mjs:787`（14 → 16） · **指名断言**：⟦check:regression#R-2⟧ |
| S-13 | 已修 | `scripts/check-all.mjs:48` · **指名断言**：⟦check:regression#R-2⟧ |
| S-14 | 已修 | `src/client/create-hob-dialog.tsx:1200` · **指名断言**：⟦check:hob-create-dom#D-150⟧ |
| S-15 | 已修-未机器化 | `src/server/orch-state.ts:2852` |
| S-16 | 已修 | ⚠ **实测**：负控计数已做词法安全的注释剥离（`check-meta-negctl.mjs` 的 `stripComments`），「注释掉的负控」不再被算作一条 · **指名断言**：⟦check:regression#R-2⟧ |
| T-01 | 已修 | `src/server/hob-write.ts:1210` · **指名断言**：⟦check:regression#R-2⟧ |
| T-02 | 已修 | `src/modules/tools.ts:124` · **指名断言**：⟦check:regression#R-2⟧ |
| T-03 | 已修 | `src/modules/orchestrator.ts:5611` · **指名断言**：⟦check:orch#SB-1b⟧ |
| T-04 | 已修 | `src/client/project-panel.tsx:1499` · **指名断言**：⟦check:regression#R-2⟧ |
| T-05 | 已修 | `src/modules/tools.ts:124` · **指名断言**：⟦check:regression#R-2⟧ |
| T-06 | 已修 | `src/server/hob-write.ts:1252` · **指名断言**：⟦check:regression#R-2⟧ |
| T-07 | 按设计处理 | ⚠ `projection-writer.ts:89` 明写「保证不并发、**不保证原子**」；半完成已可见（`partial{created,failed}`），不做回滚是设计取舍 |
| T-08 | 已修 | `src/shared/requirement-chain.ts:636` · **指名断言**：⟦check:requirement-chains#RC-14⟧ |
| T-09 | 已修 | `src/client/project-panel.tsx:63` · **指名断言**：⟦check:regression#R-2⟧ |
| T-10 | 已修 | `src/server/handoff-effects.ts:40` · **指名断言**：⟦check:regression#R-2⟧ |
| T-11 | 已修 | `src/modules/orchestrator.ts:5087` · **指名断言**：⟦check:work-plan-dispatch#WPD-19⟧ |
| T-12 | 已修-未机器化 | `src/modules/orchestrator.ts:1023` |
| T-13 | 按设计处理 | ✅ **已完整**：4 个写工具里 `approve` 是**唯一该加闸门**的（已加）；`init`（开张）· `migrate`（修复通道）· `rebuild`（归档重建）**都不该拦** —— 它们正是「账本坏了」时要用的（§197 查实 `proceedGate` 判定面含 `store-unreadable`/`unknown-legacy`） |
| T-14 | 已修 | `src/session-policy-service.ts:148` · **指名断言**：⟦check:regression#R-2⟧ |
| T-15 | 已修 | `src/server/session-policy.ts:417` · **指名断言**：⟦check:hob-create-ui#CU-44⟧ |
| T-16 | 已修-未机器化 | `src/client/project-panel.tsx:3043` |
| T-17 | 已修 | `src/client/project-panel.tsx:265` · **指名断言**：⟦check:regression#R-2⟧ |
| T-18 | 已修 | `kit/README.md` 中「跨实例」0 命中（§163） · **指名断言**：⟦check:regression#R-2⟧ |
| T-19 | 已修 | `kit/README.md` 中「三个面」0 命中（§163） · **指名断言**：⟦check:regression#R-2⟧ |
| T-20 | 已修 | `kit/README.md` 中「6 类」0 命中（§163） · **指名断言**：⟦check:regression#R-2⟧ |
| T-21 | 按设计处理 | `scripts/check-all.mjs:84` · ⚠ 属**文档表述**（exit 3 的族数与行号自相矛盾）：已按「⛔ 不写行号」处理，无行为可回归；行号再漂只是维护负担，不是功能缺陷 |
| T-22 | 已修 | `scripts/gen-preset-contract.mjs:230` · **指名断言**：⟦check:regression#R-2⟧ |
| T-23 | 已修 | `scripts/check-ledger-resources.mjs:216` · **指名断言**：⟦check:ledger-resources#T-23⟧ |
| T-24 | 已修 | `src/server/hob-write.ts:39` · **指名断言**：⟦check:ledger-write-policy#WP-13⟧ |

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
