# 修复方案独立复核（FIX-VERIFICATION）

> **复核对象**：`FIX-PLAN.md`（673 行）。**原定由 verifier 执行，因该成员所属 provider 额度耗尽（403）中断，由主控接管复核。**
> **本文件不改 FIX-PLAN 的判定，只做三件事**：证伪可执行性、检查内部一致性、反查遗漏。
> **纪律**：只读源码；复核期间对 FIX-PLAN 做过 3 处修正（见 §7），均已落盘并在此登记。

---

## §1 总体判定

**可执行（附 6 项需修正，其中 3 项已由复核方就地修正）**。

| 维度 | 结论 |
|---|---|
| 验收总表完整性 | ✅ **112 条唯一、无重号、无缺号**；等级分布 12/27/40/33 与 REVIEW 一致 |
| 批次覆盖 | ✅ 51 条有施工卡、61 条明确标未出规格（不冒充全覆盖） |
| 依赖图拓扑 | ✅ **无环**（对 12 组硬依赖做 DFS 检测）；可并行组与硬依赖无矛盾（除 B2.2，见 §6-3） |
| 抽验结论正确性 | ⚠ 12 条抽验：**11 条成立、1 条机制描述需更正** |
| 负向对拍可证伪性 | ⚠ 抽 6 条：**5 条真会红、1 条不是真负控** |
| 迁移策略可行性 | ✅ 四条迁移均有可执行步骤与退出条件 |

---

## §2 验收总表与结构校验（机器校验，非人眼）

| 检查 | 方法 | 结果 |
|---|---|---|
| 112 条唯一 | 正则抽 `^\| ID \| level \| batch \|`，计数去重 | **112 行 / 112 唯一 / 0 重复** |
| 等级分布 | 分组计数 | blocker 12 · high 27 · medium 40 · low 33 = **112**，与 REVIEW §1.2 声明值逐项相等 |
| 批次求和 | 分组计数 | B0.1(1)+B0.2(4)+B0.3(1)+B1.1(4)+B1.2(2)+B1.3(3)+B1.4(3)+B2.1(2)+B2.2(1)+B2.3(4)+B3.1(6)+B3.2(1)+B3.3(1)+B3.4(1)+B3.5(1)+B4.1(1)+B4.2(5)+B4.3(4)+B4.4(6)+B5(61) = **112** |
| 依赖成环 | 对 §3.1 的硬依赖做 DFS | **无环** |

---

## §3 抽验明细（12 条，均回源）

| # | 被验内容 | 方法 | 判定 |
|---|---|---|---|
| 1 | B0.2 `drop-item1` 三变体对照 | 复刻 `hob-write.ts:1052-1056` 合并口径，四格对比 | ✅ **成立**：`drop-item1` 在 index 的 append/overwrite 两格 dups=∅；分片两格与 `none` **完全相同**（不误伤） |
| 2 | B2.1 `refsOf` 读 `criteria_refs` 而契约字段是 `acceptance_criteria_refs` | 读 `pipeline-view.ts:692/696/714` + `pipeline.ts:157` | ✅ **成立** |
| 3 | B3.4 服务端**三处**（:349 / :367-368 / :380-381） | 读 `requirement-chain.ts` 原文 | ✅ **成立**：`:349` 是 `items` 取 `chain.verifications`；`:367-368` 是 `done` 用 `verifications.filter(pass)`；`:380-381` 是 `doing` 用 `verifications.filter(unverified)`。**只改 :349 会造出「条目取自 ACC、计数取自 VER」的新矛盾** |
| 4 | B4.2 CU-5 正则指向已改名常量 | `grep -c PLANNING_PRESET_ID scripts/check-hob-create-ui.mjs` = **2**；`grep -c HOB_PRESET_ID src/client/create-hob-dialog.tsx` = **1** | ✅ **成立**：脚本仍引用旧名，判据不可能再变红 |
| 5 | B1.3 「`ledgerHealthOf` 必须放 `src/shared` 且纯函数」 | 追 client 的 import 链 | ✅ **结论成立，但机制描述需更正**（见 V-1） |
| 6 | B1.1 `validateLedgerStructure: true` 对 decision 可行 | 读 `ledger-validation.ts` 的 `UNIT_STATUSES.decision = ['active','superseded']`，工具写 `status="active"` | ✅ **成立**：与封闭契约完全兼容，豁免无技术理由 |
| 7 | §7 D-1「仅 C 能实质修复 I-4」 | 复核宿主 answerer 与 policy | ✅ **成立**；且默认档 `approval: never` ⇒ **C1 必然 `rejected`** ⇒ 主路径实际是 A+C2 |
| 8 | B0.1「存量 177 行行为零变化」 | `grep -rc clarify_legacy` 全账本 | ✅ **成立**：52+42+17+32+23+11 = 177，全在 `unit-01..06`；全仓 v3 仅 1 条 ⇒ **豁免与 v3 不重叠** |
| 9 | §6.3「`prompt-enhancer-release` 19 条全在 index.toml」 | `grep -c '^\[\[unit\]\]' index.toml` | ✅ **成立**：19；分片为零 ⇒ 搬迁脚本是必须的 |
| 10 | B2.3 `currentPlanOfStrict` 不得回落 `at(-1)` | 读 `pipeline-view.ts:101-108` | ✅ **成立**：`active.at(-1) ?? plans.at(-1)` 的回落分支确实存在 |
| 11 | B3.1 面板取数无超时 | `grep -c 'AbortController\|timeout' project-panel.tsx` | ✅ **成立**：**0**；对照 `create-hob-dialog.tsx` = 3 |
| 12 | B1.1「`write_hob` 在最低档就有」 | 读 `src/preset/tools.ts` 的 `PERMISSION_TIERS.ledger` | ✅ **成立**：`MODEL_TOOL_ALLOWLIST` 含 `write_hob` |

**12 条中 11 条成立，1 条（#5）结论成立但机制描述需更正。**

---

## §4 需要更正的一处（V-1：硬约束的理由写错了，结论仍对）

FIX-PLAN §3 与 B1.3 卡都写「出口④在 `stages-index.ts`，**该文件被 client 半边 import**」。
实测：`src/client/*` 的 import 清单里 **没有** `stages-index.ts`。真正的链路是：

```
client/project-panel.tsx
  → shared/stage-status-labels.ts:25   import { STAGE_KIND_STATUSES } from './stages-index.ts'   ← 值导入
  → shared/stages-index.ts             （及其传递闭包：stage-controls / pipeline-view / portfolio /
                                        work-state / convergence / panel-summary / item-presentation /
                                        ledger-validation / next-action …）
```

（`requirement-chain.ts:18` 对 `stages-index` 是 `import { type StageRow }` —— **类型导入，构建时擦除**，不构成链路。）

⇒ **结论不变且更强**：`stages-index` 的**整条传递闭包**都在 client 产物里，所以 B1.3 新建的
`ledger-health.ts` 若 import 任何 `node:fs` 或 `src/server/**`，**构建就会失败**——这比「被 import」严重。
⇒ **已就地更正 FIX-PLAN 的表述**。

---

## §5 负向对拍抽样（6 条，判断「改坏了真会红吗」）

| # | 批次 | 负向对拍设计 | 会真红吗 | 说明 |
|---|---|---|---|---|
| 1 | B0.2 | 「改回 `none` ⇒ 两格都报重复」 | ✅ 会 | 实测 `none` 在 append/overwrite 两格 dups 都非空 |
| 2 | B1.1 | 「放开批准分片路径 ⇒ 断言红」 | ✅ 会 | 该断言测的正是「`write_hob` 写批准分片必须被拒」，放开即失败 |
| 3 | B2.3 | 「改回弱判定 ⇒ `chainCompleted` 变 true」 | ✅ 会 | 同一夹具实测当前行为就是 `true`，改回即回到该行为 |
| 4 | B3.2 | 「头部改回 `problems.length` ⇒ 变 40」 | ✅ 会 | 41 条夹具下 `problems.length` = 40（cap），`count` = 41 |
| 5 | B0.3 | 「注释掉某族一条真实对拍 ⇒ M-1 必须红」 | ✅ 会（**修好后**） | 当前计数器会误计注释，故这条负控**只有 B0.3 完成后才有牙**——顺序正确 |
| 6 | B4.4 | 「文档类无对拍，改为跑 `check:doc-shape` 必须绿」 | ❌ **不是负控** | 「跑另一个检查绿」不能证明「本条的断言会红」→ §7 必改 1 |

⇒ **5/6 是真负向对拍，1 条是伪负控。** 这条伪负控出现在 README 类改动上，风险最低，但仍应修。

---

## §6 反查遗漏（4 条）

| # | 遗漏 | 依据 | 建议 |
|---|---|---|---|
| 1 | **`T-06` 有两个落点，总表只归了 B1.1** | `01-judgment.md` §9 #11 改 `tools.ts:2107`（approve）；`02-ledger.md` 批次 D 改 `projection-writer.ts:162/272` | 总表该行加脚注「另见 B1.4」，否则做完 B1.1 会以为 T-06 已完成 |
| 2 | **B3.1 的 `unknown` 徽标档依赖 `O-41`（在 B5）** | `03-client.md` §2 ③3.4 新增该档，用于「宿主未提供 `useTabInfo`」的静默冻结 | 若 `O-41` 不做，该档无真值可说 ⇒ **在 B3.1 卡里注明「本档为占位」** |
| 3 | **`B2.2`（R-28）标「可并行」但改 `tools.ts`** | `01-judgment.md` §6 改 `tools.ts:881-936` + `orchestrator.ts:4771-4816` | 与 B1.1/B1.2 同文件 ⇒ **不能真并行**，应在可并行组里剔除或注明「需 rebase」 |
| 4 | **§9.1 的「~31 条其它独立缺陷」没有点名** | 只给条数、未列 ID | 低优先，但验收时会问「哪 31 条」⇒ 可由总表 B5 行反查 |

---

## §7 必须修正的清单

| # | 严重度 | 问题 | 状态 |
|---|---|---|---|
| 1 | **medium** | `B4.4` 的「负向对拍」不是真负控 | **未修**。建议补一条机检：「`README.md` 出现『有显式拒绝路径』⇒ 必须红」（`R-29` 的机器可验证形态）—— 这条本身就是「机制不存在却被文档宣称」的最佳断言 |
| 2 | **medium** | `V-1` B1.3 硬约束理由写成「被 client import」，实际是**传递闭包** | **已修**（FIX-PLAN §3 + B1.3 卡） |
| 3 | **low** | 总表把 7 条 B5 的 blocker/high 与普通条目混排 | **已修**（改为 `⚠ 未出规格（重点）`） |
| 4 | **low** | `T-06` 双落点未在总表标注 | 未修（文档级，建议加脚注） |
| 5 | **low** | `B2.2` 声明可并行但与 B1.x 同文件 | 未修（建议剔出可并行组） |
| 6 | **low** | §7 待拍板有 4 条编号在 03/04 规格中重名（`D-A`/`D-B` 各两次） | **已修**（改为 `D-CLI-A/B`、`D-SC-A/B/C`） |

---

## §8 复核方对「可执行性」的三条保留意见（不是缺陷，是上线风险）

1. **B2.3 是唯一一个「改完会让现有项目变红」的批次**。R-01 的强判据一旦参与判定，
   历史上「自己验自己」的项目会从 `completed` 翻成 `incomplete`，而证据补不回来。
   §6.1 的三段式是**必需项，不是可选项**。

2. **B1.3 的改动面被低估**。规格写「5 文件 ~300 行」，但它要建的 `ledger-health.ts`
   会被 `stages-index` 的传递闭包拉进 client 产物 ⇒ **纯函数约束是构建级硬约束**，不是风格建议。

3. **C1 路径在默认配置下不可用**。`defaultPreset: danger-full-access` → `approval: never` → `request()` 返回 `rejected`。
   FIX-PLAN §7 D-1 已写明，但施工时若有人「先接 C1 试试」，用户会看到「批准按钮点了没反应」。
   ⇒ **B1.1 必须先把 A 做完再造 C1**，且 C1 接通后必须让「answerer 缺席 / policy=never」时**明确拒绝并说明原因**。

---

## §9 复核过程说明

原定由 `verifier` 执行本复核（t14）。实际发生：`verifier` 与 `synthesizer`、`doc-auditor` 同属一个 provider，
在 2026-11-10 上午连续遭遇 `403 insufficient_user_quota` 中断 ⇒ **t12/t13/t14 均由主控接管**。

⇒ 这意味着本轮复核**不是独立第三方**：复核方同时是 FIX-PLAN 的编写者。
这是本次交付的**结构性局限**，应当如实告知：

| 补偿措施 | 效果 |
|---|---|
| 验收总表与依赖图用**脚本校验**（计数、去重、DFS 环检测）而非人眼 | 结构错误可被发现 |
| 12 条抽验**全部回源码**（`grep`/`sed`/探针），不采信规格自述 | 事实错误可被发现 |
| 负向对拍按「改坏了会不会红」逐条推演 | 伪负控可被发现（本轮发现 1 条） |
| **未补偿的**：无法自己证伪自己的选材偏好（例如会不会恰好避开了某些缺陷） | ⚠ 需要**另一人或额度恢复后的 verifier** 重跑一遍 |

**复核结束。**