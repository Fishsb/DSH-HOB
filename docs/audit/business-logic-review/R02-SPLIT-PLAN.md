# R-02 拆分方案 · 「链完成了吗」的五份实现

> **性质**：这是 R-02（blocker）的**施工前调研**，不是实施记录。
> **目的**：把「哪五份、各自被谁消费、合并的最小步骤是什么」写清，让拍板后可直接施工。
> **日期**：2026-11-10 · **基线**：已修 42 条后的工作树

---

## §1 为什么 R-02 是 blocker 而不是「一堆小不一致」

同一个问题「**这条需求链完成了吗**」，在代码里有 **5 处独立实现**，
且**没有任何一处强制同源**。后果不是「显示不一致」，而是：

> **面板说「已完成」与闸门说「拒绝派活」可以同时成立。**

这是本次审计里「所有状态不同步表象」的**共同根因**（REVIEW §2 的主线）。

---

## §2 五份实现（逐份核实）

### 2.1 清点

| # | 位置 | 算法 | 消费者 | 现状 |
|---|---|---|---|---|
| **①** | `pipeline-view.ts:175-193` `allTasksVerified` / `allTasksAccepted` | 逐任务：最新 VER `pass` 且 `verificationReady`；存在 `accepted` 的 ACC | `activeStage` / `chainCompleted` / `pipelineDispatchProblems` | **已加影子强判据**（R-01 段 1），但判定仍用弱条件 |
| **②** | `stages-index.ts:295-304` `summarizeStage` | **只按 `status` 计数**：`done = finals 命中数`，`done===total` ⇒ done | `/stages` 的 `stages[].state`（面板主数据源） | 未改；**不看任何字段** |
| **③** | `requirement-chain.ts:386-410` `done` / `doing` 逐 step 计算 | 每步自己一套 filter（如第 3 步数 `taskBriefReady`，第 5 步数 `pass`） | `/requirement-chains` 的 `steps[].done` / `doing` | 未改；**与 ① 完全不同源** |
| **④** | `stage-controls.ts:95` `STAGE_COMPLETION` | 文档性定义（文本 + `judgedBy` 字符串） | **零调用** | **纯注释**，从未被执行 |
| **⑤** | `project-panel.tsx:71-75` 客户端回落 | 服务端 `chain.state` 缺失时，自己按 `step.displayState` 数一遍 | 面板在接口降级时 | 未改；**是死分支但仍在** |

### 2.2 ⚠ 一处**我需要更正**的判断

**初稿我写过**：「任务 `built` 但无 VER 时，① 判 false、② 判 done ⇒ 第 3 步直接矛盾」。

**实测否定它**（夹具：v3 链 + G1/G2 批准 + 任务 built + RUN returned，**无 VER**）：

```json
{
  "② summarizeStage(task=built)": { "state": "done", "done": 1, "total": 1 },
  "① pipelineView activeStage": 5,
  "① 阶段3 state": "completed",
  "矛盾?": false
}
```

⇒ ① 的**阶段 3** 也判 `completed`。原因：`pipeline-view.ts:491` 的 `set(3,{state:'completed'})`
只看 `graphReady`（任务书齐 + 图无环/无悬空/无覆盖缺口），**VER 属于阶段 4→5 的门槛**，不是阶段 3 的。

⚠ **所以 ①② 在「第 3 步是否完成」上其实一致**（都只看任务书与图完整性）。

### 2.2bis 那真正的不一致在哪（实测）

| 维度 | ① `pipeline-view` | ② `summarizeStage` | 一致？ |
|---|---|---|---|
| 第 3 步（tasks） | `graphReady`：任务书齐 + 图完整 | `built ∈ finals` 且全 built | **⚠ 不同源**（一个看任务书，一个看执行状态） |
| 第 5 步（verification） | `allTasksVerified`：最新 VER pass + 可复核证据 | `pass ∈ finals` | 语义接近，但 ① 多了「可复核证据」 |
| 第 6 步（acceptance） | `allTasksAccepted`：存在 `verdict==='accepted'` | `pass ∈ finals` | **⚠ 不同源**（`verdict` 来自 `effectiveAcceptanceOf` 分组，② 只看单条 status） |

⇒ **真正的不一致是「第 3 步看什么」**：
- ① 看**任务书是否齐**（与是否执行无关）—— 与 `STAGE_COMPLETION` 的文本一致；
- ② 看**是否都 built**（执行状态）。

同一屏里，① 会说「第 3 步完成」而 ② 说「第 3 步还在做」（任务书齐但还没 built）。

⚠ **这仍然值得修**，但**比我初稿描述的窄**：不是「完成 vs 未完成」的对立，
而是「同一个步名，两处问的是不同的问题」。

---

## §3 合并的最小步骤（四个 commit，可分别回退）

### commit-1 · 把 ④ 变成真函数（**行为零变化**）

`STAGE_COMPLETION` 是纯文档。把它落成 `stageCompletionOf(stage, units)` 纯函数，
**先在代码里存在但不接任何调用**。

⚠ 价值：让「完成的口径」第一次有**可执行定义**，而不是散在五个 if-else 里。
⚠ 退出条件：新增函数 + 单测，`check:pipeline` / `check:stage-controls` 全绿（零行为变化）。

### commit-2 · ② 改为调 commit-1 的函数

`summarizeStage` 不再只看 `status`，改为 `stageCompletionOf(kind, units)`。

⚠ **这是本方案里唯一会改变面板显示的一步**：
「任务 `built` 但无 VER」时第 3 步会从 `done` 变 `doing`。
⚠ 退出条件：`check:stages-dom` / `check:stages-route` 全绿 + **真实账本前后对照**（记录哪些项目会变）。

### commit-3 · ③ 改为调 commit-1 的函数

`requirement-chain` 的 `done` / `doing` 不再各写一套 filter。

⚠ 这一步会连带影响 `currentStep` 与 `next` 的判据（它们读 `done`/`doing`）⇒
**必须与 commit-2 同批验证**，否则会造出「`/stages` 与 `/requirement-chains` 又分叉」。

### commit-4 · 删 ⑤ 与 ④ 的旧文本

客户端回落（`project-panel.tsx:71-75`）删掉；`STAGE_COMPLETION` 的**文本定义**保留（它是文档），
但标注「已由 `stageCompletionOf` 实现」。

---

## §4 施工前必须先回答的一个问题（**已按实测更正**）

> **第 3 步「任务图」的完成判据是什么：任务书齐（① 口径）还是都 built（② 口径）？**

⚠ 初稿我把它写成「built 但无 VER 算不算完成」——**那个设问建立在错误的对比上**（见 §2.2）。

| 选项 | 含义 | 影响 |
|---|---|---|
| **A · 任务书齐即完成**（① 口径，与 `STAGE_COMPLETION` 文本一致） | 第 3 步 = 「任务图已定稿且可执行」，**与执行状态无关** | 面板要在任务书齐时就把第 3 步标 done；② 现在要求全 built ⇒ **会提前变绿** |
| **B · 都 built 才完成**（② 口径） | 第 3 步 = 「任务都做完了」 | 面板不变；但 ① 的「任务书齐⇒completed」要改，且第 3/4 步会**高度重叠**（这正是 `STAGE_COMPLETION` 注释里记的那条病） |

⚠ 这不是技术选择，是**产品口径**：
- 选 A ⇒ 第 3 步管「拆得对不对」，第 4 步管「做没做完」——**职责清晰**；
- 选 B ⇒ 第 3 步与第 4 步几乎同一个判据（都看 built/returned）——**两步合一**。

**我的建议：A。** 理由：
1. `STAGE_COMPLETION` 的原文写「**任务书就绪**：至少一条 `task` 且 C-5 通过；⚠ 与「是否已执行完」**无关**」——
   它**明确排除了执行状态**，而 ② 与之相反；
2. `STAGE_COMPLETION` 的注释里**自己记过**「第 3 步与第 4 步都拿 `built` 当完成信号 ⇒ 任务执行很难成为独立阶段」——
   选 B 等于把那条病再确认一次；
3. 选 A 后，「任务书齐 + 还没 built」会正确地显示为「第 3 步完成、第 4 步进行中」，
   而不是现在这种「第 3 步还在做」。

⇒ **合并方向：② 改为调 ① 的口径（任务书齐 + 图完整），而不是 ① 去迁就 ②。**

---

## §5 与其它缺陷的关系

| 编号 | 关系 |
|---|---|
| **R-13** | 「取最后一个方案」—— 与本条**同族**（G6 档位取值），R-13 已修（`currentPlanOfStrict` 待抽） |
| **O-34** | 「取全部方案」—— **已修**（排除 `superseded`） |
| **R-01** | 影子模式已落地；段 2–3 与本条**共用** commit-1 的函数 |
| **R-14** | `nextAction` 与 `activeStage` 两个独立算法 —— 与本条**同源**（都是「谁说了算」） |

⇒ **R-02 / R-13 / R-14 / O-34 是同一个病**：同一事实多份实现。
修 R-02 时**必须同时**看 R-14（`nextAction` 也该读同一份完成判定）。

---

## §6 风险与不建议现在做的事

| 风险 | 说明 |
|---|---|
| **改完会让现有项目显示变化** | commit-2 会改面板；commit-3 会改 `currentStep` |
| **不能一次全改** | 五个实现跨 4 个文件，一次改会让「哪个变化是谁引起的」不可归因 |
| **不建议现在就动** | 它需要先回答 §4 的产品口径；而 §4 的答案取决于「第 3 步对用户意味着什么」 |

---

## §7 一句话

**R-02 的施工路径已经清楚（4 个 commit），但它卡在 §4 的一个产品口径问题上，不是技术问题上。**
回答「任务 built 但无 VER 算不算第 3 步完成」，就能开工。

**文档结束。**
