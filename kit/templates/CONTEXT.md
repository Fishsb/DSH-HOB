# CONTEXT.md —— 当前工作上下文

> 每轮开工先读这一份。它只写现行状态、仍欠事项和当前判断依据。
> 三份现行真相：`REQUIREMENTS.md` 回答用户现在要什么；`PROJECT.md` 回答项目现在按什么方案推进；本文件回答现在在推进什么、下一步等谁。
> 重写前整份必须归档到 `archive/<日期>-<名>/sources/CONTEXT.md`，并在同目录 `README.md` 登记字节数与 SHA-256。

---

## 0. 防漂移摘要

### 项目定位

[项目]是什么、为谁解决什么问题、最终结果责任由谁承担。

### 当前架构

- 推进循环：[步骤]。
- 状态数据源：[唯一状态载体]。
- 当前入口：[只读入口]。
- 历史与运行区：[历史区 / 运行区]。

### 当前阶段

- [已完成的当前基线]。
- [仍欠的活]。
- [待决定或待验收事项]。

---

## 1. 文档面现状

| 文档 | 位置 | 管什么 | 谁写 |
|---|---|---|---|
| `REQUIREMENTS.md` | [位置] | [当前需求] | [写者] |
| `PROJECT.md` | [位置] | [当前方案] | [写者] |
| `CONTEXT.md` | [位置] | [当前状态] | [写者] |
| `DECISIONS.md` | [位置] | [当前决策与规约] | [写者] |
| [生成视图] | [位置] | [只读汇总] | [生成器] |
| `ledger/spec/current.md` | [位置] | [当前入口生成视图] | [生成器] |
| `ledger/spec/requirements.md` | [位置] | [需求链生成视图] | [生成器] |
| `ledger/changes/<CHG>/proposal.md` | [位置] | [一个方案的现行正文] | [写者] |
| `ledger/changes/<CHG>/tasks.md` | [位置] | [当前方案任务] | [写者] |
| `ledger/volumes/` | [位置] | [旧账本卷] | [只读] |
| `ledger/runtime/` | [位置] | [持久运行态] | [运行时] |
| `ledger/archive/` | [位置] | [历史原文] | [只增不改] |

---

## 2. 还欠的活

| 项 | 状态 | 一句话 |
|---|---|---|
| [事项] | [状态] | [在等谁 / 下一步] |

### 2.1 状态登记

| 事项编号 | 状态 | 说明 |
|---|---|---|
| **1** | 待用户拍板 | [事项或 0 条说明] |
| **2** | 已认领 | [正在推进的事项] |

---

## 3. 关键约束速查

| 约束 | 内容 |
|---|---|
| [约束] | [后果与边界] |

---

## 4. 开工检查单

1. 先读本文件。
2. 读需求根。
3. 读方案与对应提案。
4. 查经验与判据，先核实前提。
5. 只把产品方向、取舍、范围和代价接受度交给用户决定。
6. 派活必须给预算、边界、判据、可执行要点和回传格式。
7. 收工前重跑判据、更新账本、生成视图并由独立验收人判决。

### 4.1 收尾必跑

<!-- BEGIN gen:check-families -->
<!-- ⚠ 本块由 `npm run gen:ledger` 写入，⛔ 不许手改；族清单派生自 `package.json`，「守什么」那列的唯一手写源是 `scripts/check-family-catalog.json` -->

| 命令 | 守什么 |
|---|---|
| `npm run build` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run typecheck` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:presets` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:skeleton` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:config` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:orch` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:redeliver` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:client` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:gitignore` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:archive` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:experience` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:host` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:modules` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:profile` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:selfwake` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:rounds` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:readings` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:policy` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:hob-create` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:hob-create-dom` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:hob-gate` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:stages-dom` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:tasks-progress` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:tasks-route-http` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:exec-progress` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:build` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:audit-status` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:meta-negctl` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:stages-route` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:requirement-chains` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:ledgers-route` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:ledger` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:convergence` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:workflow` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:ledger-resources` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:ledger-write-policy` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:effects` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:handoff-effects` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:work-state` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:work-plan` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:work-plan-state` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:work-plan-dispatch` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:work-plan-runtime` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:work-plan-panel` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:stage-controls` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:live-route` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:live-client` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:pipeline` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:risk-policy` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:ledger-projection` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |
| `npm run check:ledger-lifecycle` | 见本仓 §4.1 的说明（⚠ 开箱层不搬项目专有值） |

⚠ 本块共 **49** 个 `check:*` 族（另有 `build` / `typecheck` 两个非判据命令）；`check:all` 与 `check:preflight` 是调度器与体检，⛔ 不入本块（与 `SELF` 同口径）。
<!-- END gen:check-families -->

---

## 5. 本批登记

| 轮 | 内容 | 落点 |
|---|---|---|
| [批次] | [本批改变] | [提交或未提交] |

---

## 6. 账本生命周期

| 文档类型 | 现行正文 | 归档与退役 |
|---|---|---|
| 用户需求 | [现行需求载体] | [退役规则] |
| 项目方案 | [现行方案载体] | [被取代规则] |
| 编码任务 | [任务载体] | [执行与验收保留规则] |
| 当前状态 | [状态载体] | [重写前归档规则] |
| 决策 | [决策载体] | [取代双向规则] |
| 运行与验收 | [记录载体] | [只增不改规则] |

生命周期规则：

- 一个对象只有一个活跃正文，不并存“最终版”“修订版”“最新版”。
- 草案可原位修改；正式状态边界才留下历史版本。
- 归档记录必须可追溯到原编号、原正文、时间、原因、替代者和归档位置。
- 超过读取上限时先归档旧版，再合并有效结论；压缩不能替代归档。

---

## 7. 独立验收与判决

| 对象 | 当前状态 | 依据 |
|---|---|---|
| [任务或方案] | [built / settled / ACC] | [直属证据或验收] |

---

## 8. 当前读数

| 项 | 读数 |
|---|---|
| [代码或账本版本] | [实测值] |
| [数据规模] | [实测值] |
| [判据结果] | [实测值] |
| [运行实例] | [实测值] |
| [当前风险] | [实测值] |
