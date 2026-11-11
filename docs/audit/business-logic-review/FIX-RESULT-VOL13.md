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

---

## §170 ✅ T 组核查（一）：T-01 已修，注释精确记录了病与修法

### 170.1 T-01 的缺陷与修复

缺陷（blocker）：`index.toml` 被守卫重复计入 ⇒ 第二条单元永远写不进，且错误原因说谎。

`hob-write.ts:1208-1222` 的注释逐字核对：

```
⚠⚠ 不变量：**每个物理文件在 merged 里最多贡献一次**（T-01）。

旧实现让 index.toml 贡献两次：合并数组第一项 readToml('index.toml')
  ＋ mode==='append' 时的第三项 readToml(rel)（rel==='index.toml'）；
  而 shardNames 只匹配 ^unit-*.toml（**不含** index.toml）⇒ 第二项排不掉它
  ⇒ index 里每条既有单元都命中「合并后的账本出现重复 ID」。

⇒ 正确形状是「rel 是 index.toml 时**第一项不读**」——
  ⛔ **不是**「第三项去掉旧内容」：后者修得了 append、修不了 overwrite
  （02-ledger.md 附录 A-4 实测：overwrite 到 index 仍报重复）。
```

实现：

```ts
const relIsIndex = rel === 'index.toml'
const selfRead = readUnitSource(rel)
/** 关键：rel 是 index 时这里**不读**，否则它与 selfRead 是同一份物理文件。 */
const indexPathRead = relIsIndex ? undefined : readUnitSource('index.toml')
const others = shardNames.filter((n) => n !== rel).map(readUnitSource)
```

⇒ ✅ **已修，且修在根因上**（让同一文件只读一次），⛔ 不是打补丁。

### 170.2 ⚠ 这段注释比修复本身更有价值

它明确排除了一个**看起来更简单但修不干净**的方案：

```
⛔ 「第三项去掉旧内容」 —— 修得了 append、修不了 overwrite
✅ 「rel 是 index 时第一项不读」 —— 两种模式都对
```

⚠ 这类「为什么不用那个显而易见的方案」的记录，是本仓最有价值的部分之一：
   它让下一个读代码的人**不会把已排除的错误方案再试一遍**。

### 170.3 顺带发现的另一条修复（同一函数内）

```
⚠ B0.2b / t22 修复点：旧实现只含 index.toml 与**其它**分片，漏了 rel 自己的旧内容
  ⇒ 目标分片里每一条既有单元都被 pipelineWriteProblems 当成「本次新增」
  ⇒ 对 v2 存量单元触发 C-23「新单元必须登记 pipeline_version=v3」。
  实测：真实账本副本上原样 overwrite unit-01.toml（内容逐字节不变）被 81 条 C-23 拒绝。
```

⚠ 这条不在 REVIEW 的 112 条里 —— 是**修 T-01 时自己发现的相邻问题**，已一并修好。

### 170.4 进度

| 状态 | 条数 |
|---|---|
| ✅ 全量已修 | **42**（+T-01） |
| ⚠ 部分修 | 1（R-01） |
| ⚠ 核心已修 + 规格需修订 | 1（R-02） |
| ⛔ 未修 | 1（S-01） |
| ⬜ 未核 | **67** |

---
