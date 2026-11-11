# 02-ledger · 分卷 2

> ⚠ 本文件是 `fix/02-ledger.md` 的**分卷**（原文件超 64KB 读上限，
> 按 `check:gitignore` 的 M 判据处置：**整块搬走 + 原位留指针**，⛔ 不是压缩）。
> 主文件：`docs/audit/business-logic-review/fix/02-ledger.md`。

---

## 4.3 具体改法（代码形状）

**块级实现**（不再用行级状态机）：

```ts
/**
 * 从分片文本里删掉指定 id 的整段 [[unit]]（只删那一段，其余逐字节原样）。
 *
 * 必须按块处理，不能按行：id 不是首键时（手改账本很常见），
 *   行级实现会把 id 之前的行留成没有 id 的孤儿块，而解析器照样把它算一条单元，
 *   且那次写入返回 ok:true（R-18）。
 *
 * 保留原文件的空行与缩进：本函数只做「删一整块」，不做重新格式化。
 */
function removeUnitBlock(text: string, id: string): string {
  const lines = text.split('\n')
  const HEAD = '[[unit]]'
  const blocks: Array<{ head: number; end: number }> = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() !== HEAD) continue
    const prev = blocks.length > 0 ? blocks[blocks.length - 1]! : undefined
    if (prev !== undefined && prev.end > i) prev.end = i
    blocks.push({ head: i, end: lines.length })
  }
  /** 取该块的 id（该块内第一个 id = "…" 行）。 */
  const idOfBlock = (b: { head: number; end: number }): string => {
    for (let i = b.head + 1; i < b.end; i++) {
      const m = /^id\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(lines[i]!.trim())
      if (m !== null) return m[1]!
    }
    return ''
  }
  const target = blocks.find((b) => idOfBlock(b) === id)
  /** 找不到 ⇒ 原样返回（不静默返回空串 —— 那会让调用方写出空分片）。 */
  if (target === undefined) return text
  /** 连同块前的空行一起删（避免删完留下三连空行）。 */
  let from = target.head
  while (from > 0 && lines[from - 1]!.trim() === '') from--
  const kept = [...lines.slice(0, from), ...lines.slice(target.end)]
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}
```

⚠ **三个必须保留的行为**（与旧实现逐条对齐，避免引入新回归）：

| 行为 | 旧实现 | 新实现 |
|---|---|---|
| 找不到 id | 原样返回（所有行都 push 了） | 原样 `return text` |
| 连续空行压成两行 | `.replace(/\n{3,}/g, "\n\n")` | 同 |
| 末尾补一个换行 | `+ "\n"` | 同 |

### 4.3.1 顺带修：`appendUnit` / transition 的豁免（与 `T-06` 重叠）

`:162` 与 `:272` 都传 `validateLedgerStructure: false`。
`T-06` 已判定**两处都不必要**；本节不重复设计，只登记：
**`R-18` 修好后，`:272` 的豁免必须一起删**（否则 `removeUnitBlock` 若再次写坏，仍不会被自拦）。
⚠ 这是 `R-18` 的**验收前提**之一，见 §4.6 的 `R18-3`。

## 4.4 依赖与冲突

| 关系 | 说明 |
|---|---|
| **必须先做** | 无（可独立先修；但**建议**在 §1 之后，因为 §1 让投影路径能真正跑通） |
| **必须同批** | `T-06` 对 `projection-writer.ts:272` 的豁免删除 —— 见 §4.3.1 |
| **最省事的同批** | `T-07`（投影事务化）：两者都改 `applyProjectionLocked` 的失败语义 |
| **会打架** | `T-07`：若 `T-07` 先做（事务化后分片要么全改要么不改），`R-18` 的后果**减轻**但**根因仍在**（写坏一次就回滚 ⇒ 用户看不到问题，但投影永远失败）⇒ **`R-18` 必须独立修，不能靠 `T-07` 掩盖** |
| **被本改动解锁** | `T-02` 的 `LH-3`（重复 / 孤儿单元检测）需要分片不被自己写坏 |

## 4.5 测试夹具（任务书要求「id 非首键」的夹具）

**最小夹具（必须进机检，不能只写注释）**：

```toml
# 分片 unit-01.toml —— 三块，目标块的 id 在第三行
[[unit]]
id = "TSK-001"
kind = "task"
status = "doing"

[[unit]]
title = "第二块：id 写在 kind 之后"
kind = "task"
id = "TSK-002"
status = "todo"

[[unit]]
id = "TSK-003"
kind = "task"
status = "todo"
```

**断言（四个变体，全部必须成立）**：

| 变体 | 目标 | 断言 |
|---|---|---|
| **V1** `id` 在第三行（如上） | 删 `TSK-002` | 剩余单元 = `[TSK-001, TSK-003]`，**共 2 条**；`grep -c "^\[\[unit\]\]"` = 2 |
| **V2** `id` 在第二行（`[[unit]]` 后紧跟 `title`） | 删 `TSK-002` | 同上 |
| **V3** `[[unit]]` 与 `id` 之间有空行 | 删该块 | 同上（**这一变体行级实现会留下空 `[[unit]]`**，附录 A-10 变体） |
| **V4** 目标块是**最后一块**（三块夹具：TSK-001 / TSK-002 / TSK-003，删第三者） | 删 `TSK-003` | 剩余 2 条，且文件**以单个换行结尾**（不是两个） |

**负向对拍**：把 `removeUnitBlock` 改回行级实现 ⇒ **V1/V2/V3 必须红**。
（V4 可能仍绿，因为它的 `id` 在首行 —— 这正是要保留 V4 的原因：证明夹具能分辨。）

> **本节代码形状已实测**（附录 A-14）：把 §4.3 的块级实现逐字复制进探针，
> V1 / V2 / V3 / V3b（多空行）/ V4 五个变体**全部 PASS**；
> 同一夹具下**旧的行级实现**在 V1 上产出 `units=3 / orphans=1` ⇒ **负向对拍确实会红**。
> 另验：找不到 id ⇒ 输出与输入**逐字节相同**；连删两次同一 id ⇒ 幂等。

## 4.6 验证方式

```
R18-1  V1..V4 四个夹具：删目标块后单元数 = 原数 - 1
R18-2  V1..V4 之后：parseUnitsToml 结果里没有 unit 对象缺 id
R18-3  端到端：applyProjection 一次 dispatch（目标 TSK 的 id 非首键）⇒
         且 validateLedgerStructure 不再被豁免（T-06 已删）⇒ 仍必须 ok:true
R18-4  分片里出现孤儿块（手工构造）⇒ 下一次 writeHobFile 必须 ok:false（守卫生效）
```

### 负向对拍

| 对拍 | 把实现改坏成 | 期望 |
|---|---|---|
| **N-R18-1** | `removeUnitBlock` 改回行级删除 | `R18-1` / `R18-2` 必须红（V1/V2/V3） |
| **N-R18-2** | `:272` 加回 `validateLedgerStructure: false` | `R18-3` 必须红 |
| **N-R18-3** | 把 `removeUnitBlock` 找不到 id 时改成 `return ""` | 新增断言：删不存在的 id ⇒ 输出与输入**逐字节相同**，必须红 |

## 4.7 回退方式

**纯函数替换**，无数据影响。回退 = `git revert`。
⚠ **但已被写坏的分片不会自动恢复**：回退后仍需按 §1.5 的人工步骤清理孤儿块。
⇒ 建议在修 `R-18` 的同批里跑一次全账本**孤儿块清查**：

```bash
# 每份分片：[[unit]] 行数 必须 === 有 id 行的块数
for f in "$LEDGER"/ledger/units/*.toml; do
  h=$(grep -c "^\[\[unit\]\]" "$f"); i=$(grep -c "^id = " "$f")
  [ "$h" = "$i" ] || echo "ORPHAN: $f head=$h id=$i"
done
```

## 4.8 改动面等级

**局部**（`src/server/projection-writer.ts` 单函数 + `:272` 一行豁免）。

---

# 5. `O-34` · `taskGraphOf` 用「该需求下全部 change（含 superseded）」

## 5.1 缺陷编号与位置

| 项 | 位置（源码实测） | REVIEW.md |
|---|---|---|
| `taskGraphOf` 收集 tasks | `src/shared/pipeline-view.ts:664-670` | `:665-670` |
| 对照：`currentPlanOf` | `src/shared/pipeline-view.ts:101-108` | `:101-108` |
| 对照：`currentTasksOf` | `src/shared/pipeline-view.ts:110-116` | `:110-116` |
| 唯一调用点 | `src/shared/pipeline-view.ts:222`（`pipelineViewOf`） | 未标 |

## 5.2 改什么

`taskGraphOf` 的 `plans` 从「全部 `change`」改为**只认当前方案**（与 `currentTasksOf` 同源）。

### 5.2.1 缺陷的精确形态

```ts
// :666 —— 全部 change，不筛 status
const plans = units.filter((u) => text(u.kind) === 'change' && changeRequirementIds(u).includes(reqId))
// :668-670 —— 只要 parent 命中任一 plan 就算
const tasks = units.filter((u) => text(u.kind) === 'task' && (planIds.has(text(u.parent)) || listOf(u.req_ids).includes(reqId)))
```

而同一文件里 `currentTasksOf`（`:110-116`）**只认 `currentPlanOf` 选出的那一条**。
⇒ **同一个 `pipelineViewOf` 里，「第 3 步任务图」与「当前任务列表」用的是两套 plan 集合。**

**实测（附录 A-11）**：

```
夹具：R-001 + CHG-OLD(superseded) + CHG-NEW(proposed, 当前)
      CHG-OLD 下有 TSK-OLD(status=built)
      CHG-NEW 下零任务

taskGraphOf(req, units).nodes        = ["TSK-OLD:built"]
taskGraphOf(req, units).ready        = []
taskGraphOf(req, units).coverageGaps = []        <- 因为 TSK-OLD.criteria_refs 覆盖了 AC-1

对照（把 CHG-OLD 从 units 里去掉，= 修好后的口径）：
taskGraphOf(...).nodes        = []
taskGraphOf(...).coverageGaps = ["AC-1"]          <- 当前方案确实没覆盖
```

**后果链**：`pipelineViewOf:412-417` 的 `graphReady` 判据是
`graph.nodes.length > 0 && ... && coverageGaps.length === 0`。
⇒ 旧方案有 built 任务时 `nodes.length > 0` 且 `coverageGaps` 空 ⇒ **`graphReady = true`**
⇒ 第 3 步被判 `completed`，而当前方案 `CHG-NEW` **一条任务都没有**。这就是「第 3 步假完成」。

## 5.3 具体改法（代码形状）

```ts
/** Deterministic requirement task graph. `depends_on` is a task DAG edge. */
export function taskGraphOf(req: Record<string, unknown>, units: readonly Record<string, unknown>[]): TaskGraphView {
  const reqId = text(req.id)
  /**
   * 只认当前方案（与 currentTasksOf 同源）：
   *   改前这里收集「该需求下全部 change」，包含 superseded，
   *   ⇒ 旧方案下的 built 任务会让第 3 步假完成（O-34）。
   *   legacy 兼容：currentPlanOf 在「全部方案都 superseded」时会回落到最后一条，
   *     与 currentTasksOf 行为一致 —— 两处必须一起看。
   */
  const plan = currentPlanOf(req as unknown as Unit, units as readonly Unit[])
  const planIds = new Set(plan === undefined ? [] : [text(plan.id)])
  /**
   * req_ids 直挂分支保留：历史任务允许直接挂在需求下（与 L-2 的 historicalDirectReq 同口径）。
   * 但它必须只在该任务不属于任何已被取代的方案时才生效。
   */
  const supersededPlanIds = new Set(
    units.filter((u) => text(u.kind) === 'change'
      && changeRequirementIds(u).includes(reqId)
      && text(u.status) === 'superseded')
      .map((p) => text(p.id)))
  const tasks = units
    .filter((u) => {
      if (text(u.kind) !== 'task') return false
      const parent = text(u.parent)
      if (planIds.has(parent)) return true
      if (supersededPlanIds.has(parent)) return false          // 旧方案下的任务不算
      return listOf(u.req_ids).includes(reqId)                 // 历史直挂需求的任务仍算
    })
    .sort(byCreated)
  // …其余不变
}
```

⚠ **`currentPlanOf` 的回落语义必须一起理解**（`:101-108`）：

```ts
const active = plans.filter((u) => !['superseded'].includes(text(u.status)))
return active.at(-1) ?? plans.at(-1)          // <- 全被取代时回落到最后一条
```

⇒ **「方案被取代」的两种场景结果不同**，规格必须写明：

| 场景 | `currentPlanOf` 返回 | `taskGraphOf`（修后）的任务集 | 评价 |
|---|---|---|---|
| 有 active 方案 + 有 superseded 方案 | **active 那条**（按 `created_at` 取最新） | 只含 active 方案下的任务 | ✅ 正确：第 3 步按当前方案判 |
| **全部方案都 superseded** | 回落到 `plans.at(-1)`（最后一条 superseded） | 含该 superseded 方案下的任务 | ⚠ `supersededPlanIds` 会把它们全排除 ⇒ 图变空 ⇒ 第 3 步 `active` |
| 零方案 | `undefined` | 只剩 `req_ids` 直挂的历史任务 | ✅ 与现状一致（现状也是靠 `req_ids` 分支） |

⚠ **第 2 行是本次改动引入的行为变化，必须显式决定**：

### 5.3.1 `[待拍板]` D-O34-1 · 全部方案都被取代时，任务图该为空还是沿用最后一条

**问题**：`currentPlanOf` 在「全 superseded」时**故意**回落到最后一条（`:107`，注释未说明理由）；
若 `taskGraphOf` 严格排除 superseded 方案下的任务，两处又**不一致**（这次方向相反）。

| 选项 | 内容 | 影响 |
|---|---|---|
| **A** | `taskGraphOf` 与 `currentTasksOf` **完全同源**：都用 `currentPlanOf` 的回落结果，**不再单独排除** superseded | 两处 100% 一致；「全 superseded」时第 3 步会按那条旧方案判（**可能是假完成**，但**两处读数一致**） |
| **B** | 严格排除 superseded 方案下的任务（本节代码形状） | 「全 superseded」时图变空 ⇒ 第 3 步 `active`（更保守）；但与 `currentTasksOf` 在那一档**不一致** |
| **C** | 先改 `currentPlanOf`（全 superseded 时返回 `undefined`），两处一起变 | 最一致且最保守；但改动面从 1 个函数扩到 2 个 + 可能影响 `pipelineViewOf` 的第 2 步判定 |

**推荐：A**（最小改动，且 `O-34` 的原始症状——「旧方案有 built 任务、当前方案零任务」——在「有 active 方案」的常见场景下已完全修好）。
**理由**：`O-34` 要治的是**「有当前方案却去看旧方案」**；「全 superseded」是**没有当前方案**的另一种情形，
把它一并改严会顺手改变第 2/3 步的状态机，超出本修复范围。
⚠ **若选 A**，本节代码形状里的 `supersededPlanIds` 整段删掉，只保留 `currentPlanOf` 一行替换。

## 5.4 依赖与冲突

| 关系 | 说明 |
|---|---|
| **必须先做** | §3（`T-02`）：否则新入口会把「全部 change」的旧口径固化进健康判据 |
| **必须同批** | `currentTasksOf` / `currentPlanOf` **一起看**（`REVIEW.md` 要求「同源」）；若选 A 则只改一行，同源天然成立 |
| **会打架** | `R-05`（G3 不进派活闸门）：本改动**不**把 G3 接进闸门（那是 `R-05`），只是让图算对。两者独立 |
| **会打架** | `R-02`（完成 5 处实现）：`graphReady` 是其中一处；本改动会让第 3 步在「旧方案有任务、当前方案零任务」时**从 completed 变 active** ⇒ **面板会有可见变化**，属预期 |
| **风险** | 「全 superseded」账本会因此让第 3 步退回 active（若选 B）；实测现存账本无此形态（附录 A-9：全部 4 本都有 active 或唯一方案） |

## 5.5 验证方式

```
O34-1  夹具：R + CHG-OLD(superseded, 有 built 任务) + CHG-NEW(proposed, 零任务)
       ⇒ taskGraphOf.nodes.length === 0
       ⇒ taskGraphOf.coverageGaps.length === 1（AC-1 未被覆盖）
O34-2  同一夹具 ⇒ pipelineViewOf 的第 3 步 state 必须是 active 或 blocked（不是 completed）
O34-3  对照（回归）：单一方案 + 有 built 任务 ⇒ nodes.length 仍为 1、第 3 步仍 completed
O34-4  legacy 兼容：零方案、任务直挂 req_ids ⇒ 任务仍在图里（与现状一致）
```

### 负向对拍

| 对拍 | 把实现改坏成 | 期望 |
|---|---|---|
| **N-O34-1** | `plans` 改回「全部 change」 | `O34-1` / `O34-2` 必须红 |
| **N-O34-2** | 把 `req_ids` 直挂分支删掉 | `O34-4` 必须红 |

## 5.6 回退方式

**纯判定，一行改动**（选 A 时一行；选 B 时约 8 行）。回退 = `git revert`，无数据影响。
⚠ 唯一可见面：第 3 步状态可能从 `completed` 变 `active` ⇒ 若用户已按旧读数收口，回退会恢复旧读数。

## 5.7 改动面等级

**局部**（`src/shared/pipeline-view.ts` 单函数）。

---

# 6. 汇总：依赖图、合并批次、未验证清单

## 6.1 依赖图

```
        ┌──────────────────────────────────────────┐
        │ 批次 A（一次提交，同一函数体）             │
        │   T-01 + O-33                             │
        │   hob-write.ts:1030-1093                  │
        └───────────────┬──────────────────────────┘
                        │ 解锁：写入不再恒拒 + 坏分片不再当空
                        ▼
        ┌──────────────────────────────────────────┐
        │ 批次 B（一次提交）                         │
        │   L-04 解析器合并                          │
        │   tools.ts:159-220 / :788-790             │
        │   + ledger-resource-route.ts:100-105      │
        └───────────────┬──────────────────────────┘
                        │ 解锁：读侧 / 写侧同口径
                        ▼
        ┌──────────────────────────────────────────┐
        │ 批次 C（4 步，见 §3.6）                    │
        │   T-02 唯一入口 ledgerHealthOf            │
        │   + T-05 repairOf（必须同批）              │
        └───────────────┬──────────────────────────┘
                        │ 解锁：四出口同结论，修好了可判定
                        ▼
        ┌──────────────────────────────────────────┐
        │ 批次 D（可与 E 并行）                      │
        │   R-18 removeUnitBlock + 删 :272 豁免      │
        │   （T-06 的 :272 那一条同批）               │
        └──────────────────────────────────────────┘

        ┌──────────────────────────────────────────┐
        │ 批次 E（必须在 C 之后）                     │
        │   O-34 taskGraphOf 只认当前方案            │
        └──────────────────────────────────────────┘
```

**为什么 E 必须在 C 之后**：`T-02` 的 `LH-2`（四出口同结论）在 C 完成后才开始生效；
若先改 E，`pipelineViewOf` 的第 3 步状态会变，而此时的「健康」判据还是四套 ⇒ **无法判断 E 是修对了还是碰巧**。

## 6.2 合并批次表

| 批次 | 内容 | 为什么必须同批 | 涉及文件 |
|---|---|---|---|
| **A** | `T-01` + `O-33` | 同一函数体；分开会在中间留下「读得出重复、读不出解析失败」的半修态 | `hob-write.ts` |
| **B** | `L-04` + `O-33` 第二处（`tools.ts:789`） | `O-33` 的两处实例必须一起修，否则「严格解析」在另一条路上被绕过 | `tools.ts`、`ledger-resource-route.ts` |
| **C** | `T-02` + `T-05` | `REVIEW.md §8.1` 已列：只改 `repairOf` 会让它依赖的判据继续恒空 | `ledger-health.ts`（新）、`stages-index.ts`、`ledger-readiness.ts`、`stage-controls.ts`、`tools.ts` |
| **D** | `R-18` + `T-06`（`:272` 那一条） | `R-18` 修好后若豁免还在，写坏仍不自拦 | `projection-writer.ts` |
| **E** | `O-34` | 独立 | `pipeline-view.ts` |

⚠ **批次 D 与 `T-07`（投影事务化）的关系**：可同批，但**不得互相替代**（§4.4）。

## 6.3 `[待拍板]` 汇总

| 编号 | 问题 | 选项 | 推荐 |
|---|---|---|---|
| **D-T02-1** | `readiness` 的 `ready` 是否要求「已获用户批准」 | A 含审批 / B 不含 / **C 拆两个字段** | **C**（见 §3.7） |
| **D-O34-1** | 全部方案都被取代时任务图该为空还是沿用最后一条 | **A 与 currentTasksOf 完全同源** / B 严格排除 / C 改 currentPlanOf | **A**（见 §5.3.1） |

## 6.4 未验证清单（诚实标注）

| 项 | 为什么未验证 | 需要什么才能定 |
|---|---|---|
| `scripts/unfreeze-units-index.mjs` 的实际行为 | 脚本**未做**（尚未实现）；本规格只给了形状与断言 | 实现后按 §1.5.4 在 `prompt-enhancer-release` 副本上跑一遍 |
| `hob_ledger_init` 在「有单元未批准」时的实际落点 | 我只读到 `tools.ts:2139+` 用到 `before.state`，**未逐行核**它遇到 `unhealthy` 时走哪一支 | 需要读 `:2139-2230` 全文（属 `T-02` 步骤 2 的前置调查） |
| `acceptanceGateOfLedger`（`tools.ts:955`）的 catch 返回形状 | 只看到外层 `try`，**未读到 catch 分支** | 读 `:955-985` 全文（属 `L-04` 的影响面确认） |
| 「全 superseded」账本在真机上是否存在 | 现存 4 本账本都无此形态，但**样本只有 4 本** | 需要更大样本或用户确认 |
| `O-37`（`hob_ledger_migrate` 覆盖分片）的具体改法 | 属另一条修复项，本规格只登记依赖 | 另开规格 |

## 6.5 本规格没有做的事（诚实标注）

1. **没有提供任何补丁文件**（`.patch`）——按任务要求只给「可落地到代码形状」的规格；
2. **没有改任何源码**；全部探针都在 `/tmp` 下用 `mkdtempSync` + 真实账本副本跑（附录 A）；
3. **没有设计 `T-07`（投影事务化）** —— 它与 `R-18` 相邻但属另一条；本规格只在 §4.4 标注「不得互相替代」；
4. **没有设计 `S-01`/`S-02`（批准链 / legacy 豁免）** —— 那两条在 `REVIEW.md` 属于 P0，不同域；
5. **没有给出工作量估算** —— 任务书未要求，且估算容易变成空话。

---

# 附录 A · 探针清单与原始输出

> 全部探针在 `/tmp` 下运行，**只读仓库**、写盘目标一律 `mkdtempSync(tmpdir())` 或真实账本副本。
> 运行方式：`cd /home/lk/FF/dsh-hob && node /tmp/<name>.mjs`（Node 24，直接 import `src/**/*.ts`）。
> ⚠ 这些脚本**不在仓库里**（`/tmp` 会被清）；下方逐条留了**原始输出**作为证据。
> 若要复现，把对应代码块另存为 `.mjs` 即可——它们只依赖 Node 内置模块与 `src/` 源码。

## A-1 · T-01 在真实账本上的三条写入路径

夹具：`/home/lk/.dsh/hob-ledgers/prompt-enhancer-release` 的 `ledger/` 副本（19 条单元全在 `index.toml`）。

```
A) append index.toml            -> {"ok":false,"reason":"ledger-duplicate-id",
                                  "msg":"拒绝：R-001: 合并后的账本出现重复 ID ⇒ 一个 ID 只能有一个单元。"}
B) append 新分片 unit-new.toml  -> {"ok":false,"reason":"ledger-structure-invalid",
                                  "msg":"拒绝：账本单元结构不合法（2 条）：R-003: status=\"proposed\" 不属于 kind=req
                                  （合法：draft / agreed / dropped / retired）；CHG-346: status=\"draft\" 不属于
                                  kind=change（合法：proposed / settled / superseded）"}
C) 同上但豁免结构校验     -> {"ok":true}
```

⇒ 结论：**这本账三条正常路径全断**（T-01 冻 index、S-0 拦分片、只剩豁免路）。

## A-2 · 手工搬迁路线（存量解冻 R1）

```
1) 纯 fs 手工搬迁后：index 单元数 = 0 · 分片 = index.toml,unit-legacy.toml
2) 此后写一条新单元（结构校验开）: {"ok":false,"reason":"ledger-structure-invalid",
   "msg":"拒绝：账本单元结构不合法（1 条）：CHG-344: status=\"draft\" 不属于 kind=change"}
   ⇒ 手工搬迁能解 T-01 的冻，但解不了 O-33 / 坏 status（结构门禁）
```

## A-3 · 读侧也重复计入 + readiness 查不出

夹具：同一条单元**同时**留在 `index.toml` 与 `unit-01.toml`。

```
readLedgerUnits    : ["R-001","R-001"] ⇒ 条数 = 2
readProjectionUnits: ["R-001","R-001"] ⇒ 条数 = 2
readiness          : {"s":"ready","n":2,"gaps":[]}      <- 说"就绪"
⇒ readiness 用 unitShapeProblems 时没有传 seenIds（ledger-readiness.ts:284），所以查不出重复 ID
```

## A-4 · 三种 merged 补丁形状对照（T-01 的关键）

夹具：`index.toml` 有 2 条（R-001, CHG-001），`unit-01.toml` 有 1 条（TSK-001）。

较弱的对照（早期三变体）：

```
variant=none        | append index dups=["R-001"] | overwrite index dups=["R-001"]
variant=drop-item1  | append index dups=[]        | overwrite index dups=[]
variant=drop-item3  | append index dups=[]        | overwrite index dups=["R-001"]   <- overwrite 仍重复
```

正确不变量（「每文件只读一次」+ 保持 index 在前）：

```
场景                                          | 现状 dups        | 补丁 dups | 补丁 ids
append index（新增 DEC）                        | ["R-001","CHG-001"] | []     | ["R-001","CHG-001","DEC-001","TSK-001"]
overwrite index（改 R-001 标题、保留 CHG-001）   | ["R-001","CHG-001"] | []     | ["R-001","CHG-001","TSK-001"]
overwrite index（把 CHG-001 搬走 = 解冻迁移）     | ["R-001"]        | []     | ["R-001","TSK-001"]
append 分片                                    | []               | []     | ["R-001","CHG-001","TSK-001","DEC-002"]
overwrite 分片                                 | []               | []     | ["R-001","CHG-001","TSK-001"]
```

⇒ **`drop-item3`（= 任务书描述的那种修法）能修 append 但修不了 overwrite**，这是本节给出不同形状的原因。

## A-5 · `hob_ledger_migrate` 够不到分片（`O-37` 依赖）

```
1) 迁移前 readiness: {"s":"unhealthy","g":["S-0:CHG-344","L-1:CHG-344"]}
2) migrate 式写入（豁免结构校验）: {"ok":true}
   迁移后 readiness: {"s":"unhealthy","g":["L-1:CHG-344"]}        <- index 内的坏词修好了
3) 坏 status 在分片里 → migrate 只读 index.toml，够不到 ⇒
   {"s":"unhealthy","g":["S-0:CHG-346","L-1:CHG-346"]}            <- 分片里的坏词还在
```

## A-6 · 两份解析器的实质差异（`L-04`）

```
== legacy [meta] header
  strict  (stages-index.parseUnitsToml): THROW: 第 1 行：不支持的 TOML 表头 "[meta]"
  lenient (tools.parseLedgerUnitsText): [{"id":"R-001","kind":"req","status":"agreed"}]
== bad string value
  strict : THROW: 第 4 行：只支持 "字符串" 与 ["数组"]："123"
  lenient: [{"id":"TSK-001","kind":"task","status":"todo"}]      <- title 字段被丢弃
== stray line before unit
  strict : THROW: 第 1 行：键出现在 [[unit]] 之前
  lenient: [{"id":"R-002","kind":"req","status":"draft"}]
== unclosed array
  strict : THROW: 文件末尾有多行数组没有闭合：basis
  lenient: [{"id":"R-003","kind":"req","status":"draft"}]
```

两条读路径对同一份坏分片：

```
A) readLedgerUnits（宽松）      : ["R-001"]                       <- 坏分片被静默丢弃
B) readProjectionUnits（严格）  : THROW: 第 1 行：不支持的 TOML 表头 "[meta]"
```

## A-7 · 旧格式账本在 `/ledger-resource` 上被报成「不存在」

```
2) 旧格式账本 readLedgerUnits = []
   readLedgerResource(requirement/R-001) = {"ok":false,"resource":"requirement/R-001",
                                            "reason":"not-found","message":"账本里没有 R-001"}
```

⇒ 「账本读不进来」与「这条单元不存在」在 `/ledger-resource` 上**不可分辨**（§2.5.1）。

## A-8 · 四出口分歧矩阵（`T-02`）

```
夹具                 readiness                    stageGateOfLedger stageHealth            /stages.stageHealth
F1 只有闭环缺口(L-2)   unhealthy/1[L-2]             PASS             ok:true n=0[]          ok:false count=1[L-2]
F2 只有字段缺口(C-5)   unhealthy/6[C-5,C-5,C-5,C-5,RP-4,L-2] BLOCK  ok:false n=5[C-5,...]  ok:false count=6[...]
F3 只有形状缺口(S-0)   unhealthy/2[S-0,L-2]         PASS             ok:true n=0[]          ok:false count=1[L-2]
F4 只有审批缺口(C-18)  ready/0[]                    BLOCK            ok:false n=1[C-18]     ok:false count=1[C-18]
F5 无缺口             ready/0[]                    PASS             ok:true n=0[]          ok:true count=0[]
```

## A-9 · 统一入口的真实影响面（全部现存账本）

```
账本                                        units  形状  字段  审批  闭环  解析失败分片
hob-ledgers/dsh-hob                          292    0     0     0     0     -
hob-ledgers/prompt-enhancer-release           19    2     0     1     0     -
...backup-before-ledger-contract-20261108     13    8     0     0     0     -
...backup-before-ledger-contract-20261108b    16    2     0     0     0     -
```

⇒ **主账本 0 缺口**，统一入口对它是零行为变化；变 BLOCK 的两本都在 `backup` 命名下。

## A-10 · `R-18` 孤儿块（行级删除）

`removeUnitBlock` 在「`id` 非首键」分片上的行为：

```
--- removeUnitBlock(TSK-002) 结果 ---
"[[unit]]\nid = \"TSK-001\"\nkind = \"task\"\nstatus = \"doing\"\n\n[[unit]]\ntitle = \"second block: id after kind\"\nkind = \"task\"\n[[unit]]\nid = \"TSK-003\"..."
解析后的单元：[{"id":"TSK-001",...},{"title":"second block: id after kind","kind":"task"},{"id":"TSK-003",...}]
                                                                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                                                    孤儿块（无 id），仍被算作一条单元
```

空行变体（`[[unit]]` 与 `id` 之间有空行）：

```
结果："[[unit]]\nid = \"TSK-001\"\n...\n\n[[unit]]\n\n[[unit]]\nid = \"TSK-003\"..."
解析：[{"id":"TSK-001",...},{},{"id":"TSK-003",...}]        <- 出现**空对象**单元
```

端到端（`applyProjection` 一次 dispatch，目标 TSK 的 `id` 在第二行）：

```
A) 投影（transition TSK todo->doing）: {"ok":true,"applied":3}
   分片内容：
     [[unit]]
     title = "任务一（id 写在第二行）"        <- 孤儿块 1
     [[unit]]
     title = "任务一（id 写在第二行）"        <- 孤儿块 2（每次迁移复制一份）
     [[unit]]
     id = "TSK-001" ... status = "doing"
   ⇒ ok:true 但账本已被写坏
```

## A-11 · `O-34` 旧方案泄漏进任务图

```
=== O-34：旧方案（superseded）有一条 built 任务，当前方案零任务 ===
  graph.nodes      = ["TSK-OLD:built"]
  graph.ready      = []
  coverageGaps     = []                    <- 因为旧任务的 criteria_refs 覆盖了 AC-1

=== 修好后（把 units 里的旧方案去掉）===
  graph.nodes = []
  coverageGaps= ["AC-1"]                   <- 当前方案确实没覆盖
```

## A-12 · `ledger.toml` 无格式校验（旁证，不属本规格范围）

```
B) write_hob 写坏 ledger.toml: {"ok":true}
   之后的 lifecycle: {"state":"invalid","integrity":"invalid","active":false,"activation":"invalid",
                     "headline":"账本激活记录格式不合法", ...}
```

⇒ 写入侧接受、读侧立刻判 `invalid`。**这是 `T-06` 家族的旁证**，本规格不展开。

---

## A-13 · 探针脚本清单（可复现）

| 脚本 | 覆盖 | 是否改盘上数据 |
|---|---|---|
| `/tmp/fix_probe1.mjs` | A-1 | 否（副本到 `mkdtemp`） |
| `/tmp/fix_probe8.mjs` | A-2 | 否 |
| `/tmp/fix_probe10/11.mjs` | A-3 | 否 |
| `/tmp/fix_probe2/3.mjs` | A-4 | 否（纯内存） |
| `/tmp/fix_probe9.mjs` | A-5 | 否 |
| `/tmp/fix_probe2/6.mjs`（早期） | A-6 | 否 |
| `/tmp/fix_probe13.mjs` | A-7 | 否 |
| `/tmp/fix_probe14.mjs` | A-8 | 否 |
| `/tmp/fix_probe16.mjs` | A-9 | 否（只读真实账本） |
| `/tmp/fix_probe1/12.mjs`、`fix_probe20.mjs` | A-10 | 否 |
| `/tmp/fix_probe7.mjs` | A-11 | 否 |
| `/tmp/fix_probe20.mjs` | A-12 | 否 |

## A-14 · `R-18` 块级实现的实测（规格 §4.3 的代码形状已验证）

把 §4.3 的块级实现**逐字复制**进探针，跑 V1..V4 + 两个附加变体：

```
V1  (id 在第三行)            units=2(exp 2) heads=2 orphans=0 ids=[TSK-001,TSK-003]  PASS
V2  (id 在第二行)            units=2(exp 2) heads=2 orphans=0 ids=[TSK-001,TSK-003]  PASS
V3  ([[unit]] 与 id 间有空行)  units=2(exp 2) heads=2 orphans=0 ids=[TSK-001,TSK-003]  PASS
V4  (删最后一块)              units=2(exp 2) heads=2 orphans=0 ids=[TSK-001,TSK-002]  PASS
V3b (多个连续空行)            units=2(exp 2) orphans=0 ids=[TSK-001,TSK-003]          PASS
not-found (删不存在的 id)     -> 与输入逐字节相同                                      PASS
幂等 (连删两次同一 id)        第二次原样返回                                           PASS
```

**负向对拍对照**（同一夹具 V1，换成旧的行级实现）：

```
对照（旧行级）V1: units=3 orphans=1   => 负向对拍应当红: true
```

=> 规格 §4.3 的形状**可落地**，且 §4.6 的 `N-R18-1` 对拍**确实有效**。

## A-15 · `T-01` 规格 §1.3.2 的形状实测（含一次自我纠错）

> ⚠ **本附录记录规格自身的一次纠错**：初稿写的形状是「`indexPathRead = relIsIndex ? selfRead : …`」，
> 实测**不成立**（仍让 index 贡献两次）。下面是纠错前后的对照。

**纠错前（初稿形状）**：

```
场景                                  | 现状-重复ID            | 初稿形状-重复ID
append index (加 DEC-001)             | R-001: 合并后出现重复 ID | R-001: 合并后出现重复 ID   <- 初稿没修好
overwrite index (改 title + 保留两条)   | R-001: 合并后出现重复 ID | R-001: 合并后出现重复 ID   <- 初稿没修好
append 分片 (回归)                     | (none)                | (none)
overwrite 分片 (回归)                  | (none)                | (none)
```

**纠错后（§1.3.2 现行形状：`relIsIndex ? undefined : readUnitSource(index.toml)`）**：

```
场景                                | 现状    | 规格形状
append index（+DEC-001）            | DUP     | (none)
overwrite index（保留两条、改 title） | DUP     | (none)
overwrite index（解冻：只留 R-001）    | DUP     | (none)
append 分片（回归）                  | (none)  | (none)
overwrite 分片（回归）               | (none)  | (none)

现状报 DUP 的场景数: 3 / 5   （期望 3）
规格形状报 DUP 的场景数: 0 / 5   （期望 0）
=> VERIFIED
```

**这次纠错同时确认了 §1.3.2 的那条警告**：
「从第三项里排除旧内容」这一种写法（早期变体 `drop-item3`）在 overwrite 上**仍会重复**，
── 下面那次三变体对照就是证据（同一夹具）：

```
variant=none        | append index dups=["R-001"] | overwrite index dups=["R-001"]
variant=drop-item1  | append index dups=[]        | overwrite index dups=[]        <- 这个才对
variant=drop-item3  | append index dups=[]        | overwrite index dups=["R-001"]  <- 任务书描述的写法
```

⇒ **任务书里「merged 第三项在 rel==='index.toml' 时排除旧内容」的修法只能修一半**；
最终规格采用「**第一项不读**」的等价形式（`drop-item1`），并已在 §1.3.2 写明理由。

