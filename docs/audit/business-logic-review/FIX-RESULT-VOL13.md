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

---

## §171 ✅ T-02 与 T-05 **同批修复**（正如注释所说「必须同批」）

### 171.1 T-02：4 套账本健康判据 → **收敛成 1 套**

`tools.ts:124-128`：

```
// ── 账本健康的**唯一判据**（B1.3 / T-02 / T-05）────────────────────────
//   ⚠ 四个出口（readiness / stageGateOfLedger / stageHealthOfLedger / /stages.stageHealth）
//     必须共用它；⛔ 任何出口都不得自己再拼一份判据集（那正是 T-02 的病）。
import { describeLedgerHealth, ledgerHealthOf, type LedgerHealthProblem } from '../shared/ledger-health.ts'
```

**四个出口实测**：

| 出口 | 调用点 | 证据 |
|---|---|---|
| `stageGateOfLedger` | `:695` | `withLedgerProvenance(ledgerRoot, () => ledgerHealthOf(units))` |
| `stageHealthOfLedger` | `:837` | 同上；`:828` 注释「现在直接调唯一判据 `ledgerHealthOf`，⛔ 不再经 project 分支」 |
| `/stages.stageHealth` | `stages-index.ts:459` | 「**B1.3（T-02）：唯一判据 = `ledgerHealthOf`**（⛔ 不在这里再拼一份）」 |
| `readiness` | `:944` | 「`ledgerHealthOf` 现在**带 `seenIds`** 查重复 ID」 |

⚠ 改前 `stageHealthOfLedger` 走的是 `stageGateAtLedger({ scope: 'project' })`，
   拿的是 `stageControlProblems`（**field + approval**，⛔ 无 closure、⛔ 无 shape）
   ⇒ 与 readiness / `/stages` 对同一本账给出不同结论。

### 171.2 T-05：`repairOf` 与 forward 的判据**已同源**

`tools.ts:831-833` 的注释直接点明了这条耦合：

```
── 与 T-05 的关系（必须同批）──────────────────────────────
  `repairOf` 命中判据读的正是本函数的 `blockers`：只改它、不改 ① 会让
  「修复写认的 blocker」与「推进门禁认的 blocker」继续分叉 ⇒ 死锁换个方向。
```

⇒ 因为 `stageHealthOfLedger`（`repairOf` 读它）与 `stageGateOfLedger`（forward 读它）
   **现在都调 `ledgerHealthOf`** ⇒ 两者看到的是**同一份 blockers** ⇒ 死锁的成因消失。

### 171.3 ⚠ 这段注释点出了一件重要的事

```
「只改它、不改 ① 会让死锁换个方向」

⇒ 修 T-02（统一判据）而不修 T-05（让两处都读统一判据），
  死锁不会消失，只会从「repair 认 A、forward 认 B」变成别的形态。
⇒ 所以 REVIEW 把它们列为两条，但**修复必须同批**。
```

⚠ 这是「缺陷之间的耦合」的典型例子：**分开看是两条，合起来是一个病**。

### 171.4 进度

| 状态 | 条数 |
|---|---|
| ✅ 全量已修 | **44**（+T-02 +T-05） |
| ⚠ 部分修 | 1（R-01） |
| ⚠ 核心已修 + 规格需修订 | 1（R-02） |
| ⛔ 未修 | 1（S-01） |
| ⬜ 未核 | **65** |

---

---

## §172 T-04 已修（7/7 取数函数有超时）；T-03 **仍未修**（跳过仍静默）

### 172.1 ✅ T-04：一次挂起的 HTTP 不再让面板永久停止刷新

| 证据 | 实测 |
|---|---|
| `timeoutSignal(ms)` 实现 | `:726-748`「`AbortController` 不可用时退化为「只计时不取消」」 |
| `timeoutMessage(ms)` | `:749` |
| 接收 `signal` 的取数函数 | **7 个**：`defaultFetchProgress` / `Ledgers` / `Exec` / `Stages` / `Chains` / `Unseen` / `Resource` |
| `timeoutSignal(` 调用处 | **7 次**（与上表**一一对应**） |
| `pulling` 闸 | `:2162-2190` |

⇒ ✅ **REVIEW 所述「六个取数函数全都没有超时」已经不成立。**

⚠ 而且实现考虑了一致性边界：「`AbortController` 不可用时退化为只计时不取消」——
   即**耗时上限仍然生效**（不会被挂起的 promise 卡死），只是不真取消请求。

### 172.2 ⛔ T-03：`ownerWsRoot` 判不出时**仍然静默跳过**

`orchestrator.ts:5610-5630`：

```ts
if (ownerWsRoot !== undefined && typeof w.taskId === 'string' && w.taskId !== '') {
  try {
    const ledgerRoot = resolveLedgerRoot('', declaredLedgerHome(svcCtx), ownerWsRoot)
    if (ledgerRoot !== undefined) {          // ← 第二层跳过
      const projection = await applyProjection(...)
      w.ledgerProjection = { dispatch: { ok: projection.ok, ... } }
      ...
    }
    // ⚠ ledgerRoot === undefined ⇒ 什么都不写（w.ledgerProjection 保持 undefined）
  } catch (e) { ... }
}
// ⚠ ownerWsRoot === undefined ⇒ 整段跳过，同样什么都不写
```

⇒ **REVIEW 描述的症状仍在**：

```
「判不出 ownerWsRoot ⇒ 账本投影整段静默跳过，工具仍报 ok:true」
```

⚠ **`ledgerProjectionFailures`（T-12 加的）挡不住这一条**：

```
它记录的是 return.ok === false / dispatch.ok === false —— 那是【失败】；
而 T-03 是【跳过】：applyProjection 根本没被调用，没有 ok 可言。
⇒ 「跳过」与「失败」是两种不同的静默形态，前者至今没有可见信号。
```

### 172.3 进度

| 状态 | 条数 |
|---|---|
| ✅ 全量已修 | **45**（+T-04） |
| ⚠ 部分修 | 1（R-01） |
| ⚠ 核心已修 + 规格需修订 | 1（R-02） |
| ⛔ 未修 | **2**（S-01 · **T-03**） |
| ⬜ 未核 | **63** |

---

---

## §173 ✅ T-03 已修（提交）+ T-06 已修（实测只剩必要的 1 处）

### 173.1 T-03 的修复（本轮提交 `1c0d2e6`）

```ts
const cannotProject = ownerWsRoot === undefined
  ? '判不出派活方工作区根 ⇒ 未预登记 RUN'
  : (typeof w.taskId !== 'string' || w.taskId === '')
    ? '这条 watch 没有真实 taskId（implicit / 缺省）⇒ 不创建 RUN'
    : undefined
if (cannotProject !== undefined) {
  w.ledgerProjection = { ...(w.ledgerProjection ?? {}), dispatch: { ok: false, applied: 0, reason: cannotProject } }
}
```

验证：

```
check:orch  357 处（原 356，+1）· 下界同步
✓ TP-r ✓ T-03：判不出 ownerWsRoot / 无真实 taskId ⇒ dispatch = { ok:false, applied:0, reason }

负向对拍（删掉显式读数）：
✗ TP-r · cannotProject 分支没有写成 { ok:false, applied:0, reason }
         ⇒ 读数面仍分不清「失败」与「没发生」
```

### 173.2 ✅ T-06：4 处 `validateLedgerStructure:false` → **只剩 1 处，且是必要的那处**

```bash
grep -rn 'validateLedgerStructure: *false' src/ scripts/
→  实际传 false 的只有 1 处：
   tools.ts:2173（hob_ledger_migrate）

其余命中全是：类型定义（hob-write.ts:519）、判断语句（:1856）、
              以及**记录「不再传」的注释**（projection-writer.ts:240、tools.ts:2378）
```

REVIEW 原文：「4 处 `validateLedgerStructure:false`，其中 **3 处不必要**」

⇒ ✅ **那 3 处已删除，剩下的正是 REVIEW 承认必要的一处**，且注释写明理由：

```
⚠ 迁移前这本账按定义还不合法，必须允许「把坏行改成合法行」；
  写入后由 ledgerReadinessOfRoot(root) 重新核全账，若仍坏就如实回报。
```

⚠ 这个理由本身是**可验证的**：迁移完会重核全账（`ledgerReadinessOfRoot`），
   ⛔ 不是「开放豁免然后不管」。

### 173.3 进度

| 状态 | 条数 |
|---|---|
| ✅ 全量已修 | **48**（+T-03 +T-06） |
| ⚠ 部分修 | 1（R-01） |
| ⚠ 核心已修 + 规格需修订 | 1（R-02） |
| ⛔ 未修 | **1**（S-01） |
| ⬜ 未核 | **61** |

---

---

## §174 T-07：半完成**已可见**，但「幂等键不让重试补迁移」是**明确记录的取舍**

### 174.1 ✅ 第一半已修：半完成不再是「没有变化」

`projection-writer.ts:279-292`（失败结果的**唯一构造点**）：

```
⚠ 半完成不是「没有变化」：applied 条操作已经写进分片，账本停在
  「RUN 有了、TSK 没迁 / 没 link」这种状态，下一次写会被这次留下的半成品拦死。
  ⇒ 有半完成时：
  · 返回 partial: {created, failed}（机读，供调用方 / 面板点名）；
  · reason 里点名「需人工修账」（人读，⛔ 不把半完成压成一句「失败」）。

⚠ 第一步就失败（applied === 0）**不给 partial**：盘上什么都没变，
  报半完成会让调用方去修一本没被动的账。
```

⇒ ✅ 这个区分是**对的**：半完成与「什么都没发生」必须分开报。

### 174.2 ⚠ 第二半仍是原样：幂等键命中就跳过

`ledger-projection.ts:283-284`：

```ts
const already = projectedUnitOf(units, key)
if (already !== undefined) return { key, ops: [], skipped: `同一派发已投影为 ${already.id} ⇒ 不重复建` }
```

⇒ 若第一次投影**半完成**（RUN 建了、TSK 没迁），重试会因幂等键命中而**直接跳过**，
   TSK 永远补不上。这正是 REVIEW 说的「幂等键让重试不会补迁移」。

### 174.3 ⚠ 但这是**明确记录的取舍**，⛔ 不是遗漏

`projection-writer.ts:89`：

```
它保证不并发、不保证原子。⇒ **本批只把半完成如实回带，由调用方 / 人工修账**。
```

⇒ 「不保证原子」是有意声明，配套措施是「如实回带 + 人工修账」。

| 维度 | 状态 |
|---|---|
| 半完成是否可见 | ✅ 已修（`partial: {created, failed}`） |
| 是否自动补迁移 | ⛔ 不做（明确声明「不保证原子」） |
| 补救方式 | 如实回带 + `reason` 点名「需人工修账」 |

### 174.4 所以 T-07 记为什么

```
✅ 第一半（半完成无回滚）—— 已修：回滚不做，但**可见**
⚠ 第二半（幂等键不补迁移）—— 有意不修：与「不保证原子」的声明一致

⇒ 记为「按设计处理」，⛔ 不记为「已修」，也⛔ 不记为「未修」。
```

⚠ 这与 R-01/R-02 是**同一类第三方状态**：不是没修，是「修的方式与规格不同」。

### 174.5 进度

| 状态 | 条数 |
|---|---|
| ✅ 全量已修 | **48** |
| ⚠ 部分修 | 1（R-01） |
| ⚠ 核心已修 + 规格需修订 | 1（R-02） |
| ⚠ 按设计处理（半完成可见，不做原子性） | **1**（T-07） |
| ⛔ 未修 | 1（S-01） |
| ⬜ 未核 | **60** |

---

---

## §175 ✅ T-09 已修：`count` 与 `truncated` 都读了，且注释记下**改前的两个假读数**

### 175.1 修复

`project-panel.tsx:3085-3098`：

```ts
const total = typeof health.count === 'number' && Number.isFinite(health.count) ? health.count : undefined
const problems = Array.isArray(health.problems) ? health.problems : []
const shown = problems.length
/**
 * ⚠ truncated 有**两个来源**：服务端置位（>40 条），或「回来的比全量少」
 *   （体积兜底丢了全文）⇒ 两个都要算。
 */
const truncated = health.truncated === true || (total !== undefined && shown < total)
```

并落成 DOM 属性：`:3116` `'data-truncated': truncated ? 'true' : 'false'`，
`:3162` `'data-kind': truncated ? 'truncated' : 'folded'`。

### 175.2 ⚠ 注释记下的两个假读数（这是最值得留的部分）

```
⚠ 改前的两个假读数（必须写进 PR，否则会被当成回归）：
  · 41~300 条缺口时，「另有 N 条」用的是 problems.length - 12 ⇒ **少数 10 条**；
  · 体积兜底把 problems 丢空而 count=300 时，旧码印「0 条缺口」+ data-state='ok'
    —— **把 300 条缺口说成健康**。
```

⇒ ✅ 第二条尤其严重：**300 条缺口被显示成健康**，
   而这正是 T-09 标题「账本健康假报 0 条」的准确描述。

⚠ 「必须写进 PR，否则会被当成回归」这句话点出了另一件事：
   修好后读数会**变大**（从假 0 变成 300），不知情的人会以为修坏了。
   ⇒ 记录改动前后的读数变化，是修复的一部分。

### 175.3 进度

| 状态 | 条数 |
|---|---|
| ✅ 全量已修 | **49**（+T-09） |
| ⚠ 部分修 | 1（R-01） |
| ⚠ 核心已修 + 规格需修订 | 1（R-02） |
| ⚠ 按设计处理 | 1（T-07） |
| ⛔ 未修 | 1（S-01） |
| ⬜ 未核 | **59** |

---

---

## §176 ✅ T-08 已修（我上一轮差点误判为未修）

### 176.1 我上一轮的错在哪

```
我 grep 'G1-requirement|G2-plan|blockedBy' 只看到前两个分支：
  :603  if (gate === 'G1-requirement')
  :613  else if (gate === 'G2-plan')
⇒ 据此判「只处理 G1/G2，T-08 未修」

⚠ 漏掉了第三个 else if（:625-627）—— 它才是 T-08 的修复点。
```

### 176.2 ✅ 真正的修复

`requirement-chain.ts:625-659`：

```ts
} else if (pipelineGoverns && partial.next.blockedBy.length === 0
  && partial.pipeline.blockedBy.length > 0) {
  /**
   * **T-08：G3–G6 的阻断原因也要进 next**（2026-11-10）
   *
   * ── 修法：只补 blockedBy，⛔ 不改 kind / target / why ─────────────
   *   ⚠ 那两个字段由 nextAction 的全局六态优先级决定，改它等于另造一套
   *     「下一步」判据（正是 R-02 / R-14 的形态）。
   *   ⇒ 只在 next.blockedBy 为空、而 pipeline 有阻断时**补进去**；kind / why 一个字不动。
   *   ⚠ 为什么条件是「next.blockedBy 为空」：若全局 nextAction 已经给了阻断，
   *     它比链内视图更了解「该先做哪一件」⇒ **不覆盖它**（保持既有优先级）。
   */
  partial.next = { ...partial.next, blockedBy: partial.pipeline.blockedBy }
}
```

⇒ ✅ **已修**，而且修复范围**精确**：只补 `blockedBy`，不动 `kind`/`target`/`why`。

### 176.3 ⚠ 这段注释的价值

```
「改 kind/target/why 等于另造一套「下一步」判据（正是 R-02 / R-14 的形态）」
⇒ 它明确说明了【为什么只改最小面】—— 那不是偷懒，是避免复发 R-02。
```

⚠ 这与 §171（T-02/T-05 必须同批）是**同一种思维方式**：
   修一处时必须想「改大了会撞上哪条既有判据」。

### 176.4 进度

| 状态 | 条数 |
|---|---|
| ✅ 全量已修 | **50**（+T-08） |
| ⚠ 部分修 | 1（R-01） |
| ⚠ 核心已修 + 规格需修订 | 1（R-02） |
| ⚠ 按设计处理 | 1（T-07） |
| ⛔ 未修 | 1（S-01） |
| ⬜ 未核 | **58** |

---

---

## §177 ✅ T-10 三重静默全部处理（其中一条是误判）

### 177.1 三重静默的逐条核实

| # | 原缺陷 | 现状 | 判定 |
|---|---|---|---|
| ① | `onError = opts.onError ?? (() => {})` 默认空函数 | 仍原样 | ⚠ **不是缺陷**（见 177.2） |
| ② | 失败只记 `attempts/lastError`，**无上限** | `:364-382` 到 `maxAttempts` ⇒ 记 `abandonedAt`、`dueAt = Infinity`、调 `onError` | ✅ 已修 |
| ③ | 补投传 `{ self: undefined }` ⇒ 三处整段静默跳过 | `tools.ts:210-220` 改为用 `handoff.owner` | ✅ 已修 |

### 177.2 ⚠ ①「默认空函数」我判错了

我一开始按 REVIEW 的描述把「`opts.onError ?? (() => {})`」当成静默通道。查证后**不是**：

```bash
grep -n 'this.onError(' src/server/effects-queue.ts
→  :381  this.onError(kind, new Error('已放弃重试（…）：' + String(error)))
→  :387  this.onError(kind, error)
→  :404  this.onError('persist', error)

grep -n 'lastError' src/server/effects-queue.ts
→  :29   lastError?: string        （行结构里）
→  :362  current.lastError = String(error)   （失败时落）
→  :371  「行**保留**（⛔ 不删）⇒ 状态面仍看得到它，lastError 与 attempts 都在」
```

⇒ **`onError` 只是回调，不是唯一可见通道** ——
   `lastError` 与 `attempts` 落在**队列行**上，即使调用方不传 `onError`，状态面也能读到。

⚠ **REVIEW 这条写的是「三重静默」，但第①重其实不构成静默** ——
   真正让错误不可见的是②③（无上限 ⇒ 永久空转；`self: undefined` ⇒ 三处跳过），
   而那两条都已修。

### 177.3 ✅ ② 的修法值得记

```
改前：只增 attempts 且**从不判上限** ⇒ 退避封顶 60s 后**一直重试**
      对「目标已归档」这类**永久失败** ⇒ **永久空转**，而状态面只看到 attempts 在涨

修法：把「放弃」做成一条**可读状态**，不是静默消失
  · 行保留（⛔ 不删）⇒ 状态面仍看得到它
  · dueAt 推到 Infinity ⇒ 调度器不会再选中它（dueAt <= now 永假）
  · 记 abandonedAt ⇒ 读的人能区分「还在退避」与「已放弃」
  ⚠ 它**不是**「投递成功」：delivered 从未置位，回执也不会回来
```

⚠ 最后那句尤其重要：**「已放弃」与「投递成功」必须在读数上区分开**。
   否则又回到 T-09 的形态（把 300 条缺口说成健康）。

### 177.4 进度

| 状态 | 条数 |
|---|---|
| ✅ 全量已修 | **51**（+T-10） |
| ⚠ 部分修 | 1（R-01） |
| ⚠ 核心已修 + 规格需修订 | 1（R-02） |
| ⚠ 按设计处理 | 1（T-07） |
| ⛔ 未修 | 1（S-01） |
| ⬜ 未核 | **57** |

---

---

## §178 ✅ T-11 / T-13 / T-16 三条全部已修

### 178.1 T-11：`writeWorkPlan` 返回值不再被丢弃

REVIEW 说「三处被丢弃」（`:4878` / `:5437` / `:5478`）。实测**四处调用全部检查了返回值**：

```
:4605  const written = writeWorkPlan(...)          → 检查 .ok
:5017  const stored = writeWorkPlan(...)           → 检查 .ok
:5094  const firstWaveWritten = writeWorkPlan(...) → 检查 .ok
:5690  const attachWritten = writeWorkPlan(...)     → 检查 .ok
```

⇒ ✅ 已修，且比 REVIEW 要求的多覆盖了一处（`:4605` 就是 REVIEW 提到的 `:4556-4564` 那处「有检查」的）。

### 178.2 T-13：批准工具已过 `proceedGate`

`tools.ts:2345-2369`，注释完整记录了病与边界：

```
── 病（实测）────────────────────────────────────────
  hob_pipeline_approve / hob_ledger_init / hob_ledger_migrate / hob_ledger_rebuild
  四个写工具**都不过 proceedGate**（grep 只命中 :1306 定义与 :1582 的 write_hob）。
  ⇒ archived / quarantined / pending-activation / unknown-legacy 的会话（mayProceed=false）
    **仍能写「用户批准」落账** —— 「被隔离的会话不能推进」在写路径上有一个旁路。

⚠ dryRun 保持放行（纯预演不改变任何东西，与 write_hob 一致）。
⚠ hob_ledger_init 不过闸门是**有理由的**（它是开张而不是推进），本批不动它；
  approve 没有这个理由。
```

```ts
if (args.dryRun === false) {
  const blocked = proceedGate(exec)
  if (blocked !== undefined) return { ok: false, reason: 'proceed-not-confirmed', message: blocked }
}
```

⚠ **注意它是「四个工具里只修 approve」** —— 并说明了为什么其余三个不动：
   `init` 是开张（有理由）；`migrate` / `rebuild` 未提，可能仍待处理。
   ⇒ 本条只对 `approve` 的判定成立。

### 178.3 T-16：切换账本时 `itemDetails` 一起清

`project-panel.tsx:3043`：

```
⚠⚠ **必须一起清 itemDetails**（T-16）。
```

⇒ ✅ 已修：改前只重置另外两样，展开详情的缓存会串到另一本账。

### 178.4 进度

| 状态 | 条数 |
|---|---|
| ✅ 全量已修 | **54**（+T-11 +T-13 +T-16） |
| ⚠ 部分修 | 1（R-01） |
| ⚠ 核心已修 + 规格需修订 | 1（R-02） |
| ⚠ 按设计处理 | 1（T-07） |
| ⛔ 未修 | 1（S-01） |
| ⬜ 未核 | **54** |

⚠ **已核 58 / 112，正好过半。**

---

---

## §179 ⛔ T-13 只修了 4 个工具里的 1 个 —— `migrate` 是真实残留

### 179.1 实测：`proceedGate` 全仓只有 2 个调用点

```bash
grep -n 'proceedGate(exec)' src/modules/tools.ts
→  :1769   write_hob
→  :2363   hob_pipeline_approve
⇒ hob_ledger_migrate / hob_ledger_rebuild / hob_ledger_init 都不过闸门
```

⚠ T-13 的注释自己写着「四个写工具**都不过** `proceedGate`」，
   而修复只加了 `approve` 一处。

### 179.2 三个未过闸门的工具逐个定性

| 工具 | description | 该不该过闸门 | 现状 |
|---|---|---|---|
| `hob_ledger_init` | 开张（建新账本） | ⛔ 不该 | ✅ **注释已说明理由** |
| `hob_ledger_rebuild` | 「**归档旧账并新建当前账本**：仅用于账本已失效 / 旧格式」 | ⛔ 不该（开张性质） | ⚠ **无说明，但有理由** |
| **`hob_ledger_migrate`** | 「把旧账本里可判定的旧 kind/status 词迁移到现行封闭集」 | ✅ **该过**（改账本内容 = 推进动作） | ⛔ **既无闸门也无说明** |

⇒ **`migrate` 是真实缺口**：它在**已存在的账本上改内容**，与 `approve` 同类。

### 179.3 ⚠ 为什么这条之前没人发现

```
T-13 的记账是「已修」——修复记录里写了 approve 过了闸门，
而注释里「四个写工具都不过」那句是**描述改前状态**，读的人容易以为是历史注记。
⇒ 「修了一组 N 个里的 1 个」这种形态，从「已修」这两个字上完全看不出来。
```

⚠ 这与 §128 的 T-13 记录（我上轮判「已修」）**不矛盾但也不完整**：
   approve 确实修好了；**但同一句注释点出的另外三个里，`migrate` 仍需处理**。

### 179.4 本轮未改代码

```
只读：grep proceedGate / 读三个工具的 description
⛔ 未改 —— 给 migrate 加闸门会改变它的可用性（迁移常在「账本已坏」时执行，
   而那正是 mayProceed 可能为 false 的场景）⇒ 需先确认不会把「唯一的修复通道」堵死。
```

⚠ 这与 T-06 的 `hob_ledger_migrate` 保留 `validateLedgerStructure:false` **是同一个矛盾**：
   迁移必须在「账本不合法 / 不可推进」时也能跑，否则无法自愈。
   ⇒ 加闸门前必须先回答「账本坏了但会话被隔离时，谁来做迁移」。

### 179.5 进度（T-13 改为「部分修」）

| 状态 | 条数 |
|---|---|
| ✅ 全量已修 | **53**（T-13 移出） |
| ⚠ 部分修 | **2**（R-01 · **T-13**） |
| ⚠ 核心已修 + 规格需修订 | 1（R-02） |
| ⚠ 按设计处理 | 1（T-07） |
| ⛔ 未修 | 1（S-01） |
| ⬜ 未核 | **54** |

---
