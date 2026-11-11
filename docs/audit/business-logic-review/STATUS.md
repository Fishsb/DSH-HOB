# REVIEW 112 条 · 逐条状态总表

> ⚠ **本文件是唯一可直接查询的「第 N 条修没修」来源。**
> 此前状态散在 13 卷 `FIX-RESULT` 里，而**一行可能并列多个编号**，
> 导致按编号统计会得出 112 / 93 / 73 三个不同答案（见 `FIX-RESULT-VOL13.md` §186）。
> ⇒ 本表**一行一编号**，可直接 `grep`。

## 汇总

| 状态 | 条数 |
|---|---|
| ✅ 已修 | **104** |
| ⛔ 已排除（复核证伪） | **3** | S-08 · O-24 · O-15 |
| ⚠ 部分修 | **2** | R-01（1/3 段）· T-13（1/4 工具） |
| ⚠ 核心已修 + 规格需修订 | **1** | R-02 |
| ⚠ 按设计处理 | **1** | T-07 |
| ⛔ 未修 | **1** | S-01（需宿主改档或 API） |
| **合计** | **112** | ✅ 闭合 |

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
| O-11 | 已修 | `orchestrator.ts` 首波失败不再整体置 failed（§160） |
| O-12 | 已修 | `src/server/session-policy.ts:197` |
| O-13 | 已修 | `src/session-policy-service.ts:707` |
| O-14 | 已修 | `src/modules/tools.ts:146` |
| O-15 | 已排除 | |
| O-16 | 已修 | ⚠ 保留 + 标注（不是删掉） |
| O-17 | 已修 | `src/preset/tools.ts:1744` |
| O-18 | 已修 | `src/client/project-panel.tsx:1560` |
| O-19 | 已修 | `src/client/hob-unselected-gate.tsx:633` |
| O-20 | 已修 | `src/client/create-hob-dialog.tsx:1188` |
| O-21 | 已修 | ⚠ 按裁定 B 关闭（面板仅中文） |
| O-22 | 已修 | `src/client/create-hob-dialog.tsx:1215` |
| O-23 | 已修 | `src/client/project-panel.tsx:1677` |
| O-24 | 已排除 | |
| O-25 | 已修 | `src/client/hob-unselected-gate.tsx:725` |
| O-26 | 已修 | `scripts/check-workflow.mjs:7` |
| O-27 | 已修 | `scripts/check-stages-route.mjs:3` |
| O-28 | 已修 | `scripts/check-gitignore.mjs:437` |
| O-29 | 已修 | `scripts/check-gitignore.mjs:437` |
| O-30 | 已修 | `scripts/check-hob-unselected-gate.mjs:1892` |
| O-31 | 已修 | `scripts/check-profile-assembly.mjs:1245` |
| O-32 | 已修 | `pipeline-view.ts` blockedBy 两来源处理不同对象（§161 实测） |
| O-33 | 已修 | `src/server/hob-write.ts:386` |
| O-34 | 已修 | `src/shared/pipeline-view.ts:816` |
| O-35 | 已修 | `src/modules/orchestrator.ts:10954` |
| O-36 | 已修 | `src/client/project-panel.tsx:265` |
| O-37 | 已修 | `src/modules/tools.ts:2051` |
| O-38 | 已修 | `src/shared/pipeline.ts:261` |
| O-39 | 已修 | `src/modules/orchestrator.ts:4929` |
| O-40 | 已修 | `src/modules/bus.ts:2040` |
| O-41 | 已修 | `src/client/project-panel.tsx:1434` |
| O-42 | 已修 | `scripts/check-gitignore.mjs:472` |
| O-43 | 已修 | `src/server/hob-write.ts:1273` |
| R-01 | 部分修 | ⚠ 只做了第 1/3 段 |
| R-02 | 核心已修 | ⚠ 验收规格本身过宽，需修订 |
| R-03 | 已修 | `src/shared/stages-index.ts:32` |
| R-04 | 已修 | `spec/notes-handover.md:244` + `patch.yml:434` 已改七步（§107） |
| R-05 | 已修 | `src/shared/pipeline-view.ts:742` |
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
| S-01 | 未修 | ⚠ 需宿主改档或提供 API |
| S-02 | 已修 | `src/modules/tools.ts:260` |
| S-03 | 已修 | `src/server/hob-write.ts:1331` |
| S-04 | 已修 | `src/shared/stage-controls.ts:1343` |
| S-05 | 已修 | `src/shared/stage-controls.ts:922` |
| S-06 | 已修 | `meta-negative-floor.json` 只剩 2 族为 0 且合理（§131） |
| S-07 | 已修 | `scripts/check-workflow.mjs:404` |
| S-08 | 已排除 | |
| S-09 | 已修 | `src/client/project-panel.tsx:56` |
| S-10 | 已修 | `src/client/project-panel.tsx:20` |
| S-11 | 已修 | `scripts/check-all.mjs:756` |
| S-12 | 已修 | `scripts/check-all.mjs:758` |
| S-13 | 已修 | `scripts/check-all.mjs:48` |
| S-14 | 已修 | `src/client/create-hob-dialog.tsx:1200` |
| S-15 | 已修 | `src/server/orch-state.ts:2852` |
| S-16 | 已修 | `scripts/check-all.mjs:793` |
| T-01 | 已修 | `src/server/hob-write.ts:1210` |
| T-02 | 已修 | `src/modules/tools.ts:124` |
| T-03 | 已修 | `src/modules/orchestrator.ts:5611` |
| T-04 | 已修 | `src/client/project-panel.tsx:1499` |
| T-05 | 已修 | `src/modules/tools.ts:124` |
| T-06 | 已修 | `src/server/hob-write.ts:1252` |
| T-07 | 按设计处理 |
| T-08 | 已修 | `src/shared/requirement-chain.ts:636` |
| T-09 | 已修 | `src/client/project-panel.tsx:63` |
| T-10 | 已修 | `src/server/handoff-effects.ts:40` |
| T-11 | 已修 | `src/modules/orchestrator.ts:5087` |
| T-12 | 已修 | `src/modules/orchestrator.ts:1023` |
| T-13 | 部分修 | ⚠ 4 个工具只修了 1 个 |
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
