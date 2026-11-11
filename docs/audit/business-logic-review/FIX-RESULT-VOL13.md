## §169 R-02 最终判定：**核心已修**（3 份收敛），但规格「三者一致」未能满足且**不该满足**

### 169.1 实测（构造夹具真跑三个投影）

```
同一份账本（1 需求 + 1 已批方案 + 1 done 任务 + 1 doing 任务）:

pipeline-view     阶段3 = draft          ← 整条链还在方案阶段，第 3 步未轮到
buildStages       阶段3 = doing  0/1     ← 只数本阶段单元状态
requirement-chain 阶段3 = todo           ← 派生自 pipeline-view，再降成粗粒度
```

### 169.2 ✅ 关键收敛：`requirement-chain` **派生自** `pipeline-view`

`requirement-chain.ts:348` 与 `:381`：

```ts
const pipeline = pipelineViewOf(req, units)                    // :348 单一来源
const v3Stage = pipeline.stages.find((s) => s.id === d.kind)   // :381 从它派生
```

⚠ `ChainDisplayState`（`done/doing/waiting/todo`）是
   `PipelineStageState`（`draft/awaiting-user/active/completed`）的**粗粒度映射**，
   ⛔ 不是第二套判定。

⇒ **R-02 所说的「4 份服务端实现各自回答」在这一对上已经收敛。**

### 169.3 ⚠ `buildStages` 与 `pipeline-view` 确实不一致 —— 但那是**设计如此**

`buildStages` 的 docstring（`stages-index.ts`）：

```
把单元数组渲染成线格式（⚠ 阶段**顺序固定**，空步也要出现且给 `todo`）
```

⇒ 它的职责是「**渲染单元数组**」，⛔ 不是「判断当前主线」。
   它**不需要**知道 `activeStage` —— 那正是 `/stages` 与 `/pipeline` 两个投影的分工。

| 投影 | 回答什么 | 需要 activeStage 吗 |
|---|---|---|
| `pipelineViewOf` | 这条链现在走到哪、下一步谁动 | ✅ 需要 |
| `buildStages` | 每一类单元各自完成了几分之几 | ⛔ 不需要 |
| `requirement-chain` | 面板主线视图（派生自 pipeline-view） | ✅ 派生 |

### 169.4 ⚠ 所以 R-02 的验收规格**写得过宽**

REVIEW 原文：「同时调 `summarizeStage` / `pipelineViewOf().stages[i].state` /
`requirement-chain.steps[i].displayState` ⇒ 断言**三者对每一步一致**」

```
⚠ 若真按这条实现断言，会让 buildStages 被迫感知 activeStage ⇒ 破坏它的职责边界
⇒ 正确口径应当是：
   ① pipelineViewOf 与 requirement-chain 一致（派生关系）✅ 已满足
   ② buildStages 的 done/total 必须是**本阶段单元的真实计数**（与它自己一致）
   ③ 三者**不得**对「同一步的单元状态」给出互相矛盾的读数
```

### 169.5 R-02 的记账结论

| 维度 | 结论 |
|---|---|
| 「4 份服务端实现各自回答」 | ❌ 已不成立：`requirement-chain` 已派生 |
| 客户端同屏并置两个来源 | ⚠ 未核（`project-panel.tsx:2600-2603`） |
| REVIEW 的「三者一致」验收 | ⚠ **规格本身写得过宽**，按字面实现会破坏职责边界 |

⇒ **R-02 记为「核心已修」**，并注明验收规格需修订。⛔ 不记为「已修」，也⛔ 不记为「未修」。

### 169.6 本轮未改代码

```
只读：构造夹具跑三个投影、读 docstring 与派生点
⛔ 未改 —— 改 buildStages 让它感知 activeStage 会破坏职责边界
```

---

### 169.7 ✅ 规格③「客户端不再并置两个来源」—— **已满足**

```bash
grep -n 'summarizeStage|displayState' src/client/project-panel.tsx
→  4 处，**全部只用 displayState**（即 requirement-chain 的派生值）：
   :3253  `${step.name} · ${CHAIN_STATE_TEXT[step.displayState]}`
   :3488  由 displayState 映射出 legacyState
   :3513  `data-mainline-state` 用 CHAIN_STATE_ICON[step.displayState]
   :3603  `${s.step} ${s.name} · ${CHAIN_STATE_TEXT[s.displayState]}`
→  summarizeStage 命中 **0 处**
```

⚠ 改前是「客户端把前两套**并排印在同一行**」；现在只剩一套。
   ⇒ **R-02 规格③ 满足**。

### 169.8 R-02 的**最终记账**

| 规格 | 要求 | 结果 |
|---|---|---|
| ① | 三者对每一步一致 | ⚠ **规格过宽**（见 169.4）；但其中「pipeline-view ↔ requirement-chain」**已一致**（派生） |
| ② | 负向对拍：`done === total` 改 `done >= total - 1` ⇒ 断言红 | ⚠ 未单独验证 |
| ③ | `grep` 确认同一行不再并置两个来源 | ✅ **已满足**（4 处全用 displayState，summarizeStage 0 命中） |

⇒ **R-02 记为「核心已修」**：

```
✅ 客户端同屏并置两个来源 —— 已消除（规格③，实测）
✅ pipeline-view 与 requirement-chain —— 同源派生（实测 :348/:381）
⚠ buildStages 与另两者不一致 —— 设计如此（docstring 明写「渲染单元数组」）
⚠ 规格①「三者一致」按字面实现会破坏 buildStages 的职责边界
```

### 169.9 当前严格账（本批终值）

| 状态 | 条数 | 编号 |
|---|---|---|
| ✅ 全量已修 | **41** | |
| ⚠ 部分修 | **1** | R-01（段 2/3） |
| ⚠ 核心已修 + 规格需修订 | **1** | R-02 |
| ⛔ 未修 | **1** | S-01（需宿主改档或 API） |
| ⬜ 未核 | **68** | |

---
