# 01-judgment · 分卷 1

> ⚠ 本文件是 `fix/01-judgment.md` 的**分卷**（原文件超 64KB 读上限，
> 按 `check:gitignore` 的 M 判据处置：**整块搬走 + 原位留指针**，⛔ 不是压缩）。
> 主文件：`docs/audit/business-logic-review/fix/01-judgment.md`。

---

# 修复规格 01 · 判定链与派活闸门（S-01 / S-02 / R-01 / R-05 / R-28 / T-05 / T-13）

> 输入底稿：`REVIEW.md`（§1.3 优先级 / §5 缺陷明细 / §7 待拍板 / §8 路线图 §8.1 联动项）、`VERIFICATION.md`（t8 复核，含 M-02 对 T-05 的口径订正）、`LEAD-VERIFICATION.md`、六份域报告（本文件的 `pipeline.md` 为 S-01/S-02/R-01/R-05 的一手来源）。
> 本文件**只出规格，不改代码**。行号以源码实测为准；与 REVIEW.md 漂移处就地标注「⚠ 行号漂移」。

## §0 阅读约定

### 0.1 证据等级用词

| 标记 | 含义 |
|---|---|
| **实测** | 本次读码或执行探针得到，附文件:行号或命令 |
| **读码** | 逐行核对确认，未执行 |
| **推断** | 有间接证据，但未做端到端验证（不得当作已确认） |
| **未验证** | 给不出可落地改法或无法核实，**不许写成已定方案** |

### 0.2 「改动面等级」

- **局部**：单函数 / 单文件，可独立合入、可独立回退。
- **跨模块**：≥2 个文件且存在调用关系，必须同批合入（否则中间态不一致）。
- **需宿主配合**：依赖本仓之外的能力（宿主服务 / 事件流 / UI 组件），**本仓无法单方面完成**。

### 0.3 排序（按「让失败不可观测 → 缺陷本身」）

1. **第一批（可观测性 + 入口封堵，不改判定语义）**：T-13 / T-05 / R-28 / S-02
2. **第二批（合并改动，一次触碰 pipeline.ts + pipeline-view.ts）**：S-01(A) + S-02(根治) + R-05 + R-01
3. **第三批（需宿主配合，可独立推迟）**：S-01(C)

> 理由：T-13/T-05/R-28/S-02 都是「有洞但看不见 / 修不动」的入口级问题，修完不改变任何既有判定结果，**不会让现有账本变红**，可以先落地。R-01 会让存量账本变红，必须最后做并配迁移（见 §3）。

---

## §1 全景：这七条之间的依赖图

```
        ┌─────────────────────────── 同一文件 = 必须一次改动 ───────────────────────────┐
        │  S-01(A 收窄写入路径) ──┐                                                    │
        │  S-02(legacy 判据换源) ─┼─► pipeline.ts + pipeline-view.ts + stage-controls.ts │
        │  R-05(G3 进闸门) ───────┘                      + hob-write.ts + tools.ts       │
        │       ▲                                                                      │
        │       └── 与 R-01 共用 pipeline-view.ts 的「强弱判据」结构 ──────────────────┘
        └──────────────────────────────────────────────────────────────────────────────┘
                                   │
   T-05(repairOf 换判据) ─────────┼──► 与 S-02 共用 stageControlProblems 的输出
   R-28(多轨门禁前移) ────────────┼──► 与 R-05 共用 pipelineDispatchProblems（但分属两个文件）
   T-13(approve/control 补闸门) ──┘──► 与 S-01 共用「谁有权写批准」这条主线
```

**三条不可拆的联动**（与 §8.1 一致并新增两条）：

| 联动 | 涉及 | 拆开后的后果 |
|---|---|---|
| **L-A** | S-01(A) + S-02 + R-05 + R-01（同批，§4） | 中间态会出现「批准只能走工具、但工具写的单元又不受校验」的更糟组合 |
| **L-B** | R-05 + R-28 | 只把 G3 接进 `pipelineDispatchProblems` 而多轨仍不调它 ⇒ 攻击面没变（多轨是唯一绕过入口） |
| **L-C** | T-05 + S-02 | S-02 改 `legacy()` 判据后会新增一批以前被豁免的缺口 ⇒ `repairOf` 的命中集合变化，两者必须同批核对 |

---

## §2 S-01 · blocker · 「用户批准」是自证链：被校验方即写入方

### 2.1 现状回源（先对齐事实，再谈改法）

| 事实 | 位置 | 证据 |
|---|---|---|
| `decided_by = "user"` 是**字面量**，由写方自己填 | `src/modules/tools.ts:2081` | 读码，原文 `'decided_by = "user"',` |
| 唯一校验是**对自填 `source` 做正则** | `src/modules/tools.ts:2051-2058` | 读码，回执正则要求「确认/要求修改/退回修改 + id + 第 N 版」 |
| 绕过工具入口后，回执正则**根本不执行** | `src/server/hob-write.ts:1070-1084`（写守卫只跑 `stageFieldProblems` / `ledgerClosureProblems` / `pipelineWriteProblems` / `pipelineRevisionProblems` / `verificationRevisionProblems`） | 读码；与主控 `/tmp/lead_probe_e2e4.mjs` 结论一致：档 1 的 `write_hob` 直接写 decision，`source="继续"` 也 `approved` |
| 账本层对 `source` **只要求非空** | `src/shared/pipeline.ts:439` | 读码 |
| 批准写入**跳过结构校验** | `src/modules/tools.ts:2107`（`validateLedgerStructure: false`） | 读码 |
| 门禁判据读的正是这个自填字段 | `src/shared/pipeline.ts:351-353`、`:435` | 读码 |
| 仓内**零处**使用宿主 approval 服务 | `grep -rn "ctx.approval" src/` ⇒ 0 命中 | 实测 |

**结论**：I-4（Hob 不能自批）在**当前架构**下不成立。不是实现漏了一行，是**契约把「用户回执」定义成了一段字符串**。

### 2.2 三个选项各自的具体改法

#### 选项 A · 写入路径收窄（可独立落地，**不足以根治**）

**① 缺陷编号与位置**：S-01；`src/server/hob-write.ts:163`（`LEDGER_PATH_RE`）、`:814`（正则使用点）、`:150-157`（可写目录/文件清单）；`src/preset/tools.ts:1039`（档 1 可见 `write_hob`）。

**② 改什么**：让 `ledger/units/unit-pipeline-approval.toml` **不再**是通用 `write_hob` 的可写路径，只允许由专用写入函数产生。

**③ 具体改法**：

```ts
// src/server/hob-write.ts —— 新增常量与判据（与 LEDGER_WRITABLE_FILES 同风格）
/** 批准审计的独占落点：⛔ 通用 write_hob 不得写这份分片。 */
export const APPROVAL_ONLY_SHARDS = ['ledger/units/unit-pipeline-approval.toml'] as const

export function isApprovalOnlyPath(file: string): boolean {
  return (APPROVAL_ONLY_SHARDS as readonly string[]).includes(file.replace(/^\/+/, ''))
}
```

在 `checkLedgerUnitWrite`（`hob-write.ts:1022`）**入口第一行**加：

```ts
if (isApprovalOnlyPath(file)) {
  return refuse(file, 'approval-path-reserved',
    '拒绝：批准审计只能通过 hob_pipeline_approve 写入（通用写通道不得产生「用户批准」）。')
}
```

并在 `writeHobFile` 的**调用方**（`src/modules/tools.ts:2093-2108`）改用内部选项 `{ allowApprovalShard: true }`，该选项**不进工具参数**（不可被模型指定），只在 `ledgerApprove.execute` 内部传：

```ts
const w = await writeHobFile(root, { file: 'ledger/units/unit-pipeline-approval.toml', content, mode: 'append' },
  { hobDir: '', /* …既有… */ allowApprovalShard: true, validateLedgerStructure: true })
```

> ⚠ `validateLedgerStructure` 同时由 `false` 改 `true`：与 **T-06** 的结论一致（探针 A-11 证明健康账本上该豁免不必要）。这条与 T-06 同批，见 §2.4。

**④ 依赖与冲突**：
- **无前置**，可独立落地。
- 与 **T-06** 直接相关（同一处 `validateLedgerStructure:false`），**必须同批**改，否则 A 收窄了路径却仍放过非法行。
- 与 **T-01** 无关（不同分片）。
- ⚠ **与 S-02 不冲突**，但**不能替代**它：A 只让「批准只有一条写入路径」，那条路径仍由 Hob 触发、`decided_by` 仍是常量。

**⑤ 验证方式 + 负向对拍**：

```bash
# 正向：通用写通道被拒
node -e "…writeHobFile({file:'ledger/units/unit-pipeline-approval.toml'})…"   # 期望 {ok:false, reason:'approval-path-reserved'}
# 反向：专用通道仍可写
node -e "…ledgerApprove dryRun:false…"                                        # 期望 {ok:true}
```
- **负向对拍**：把 `isApprovalOnlyPath` 的调用从 `checkLedgerUnitWrite` 删掉 ⇒ 上面第一条必须变红（`ok:true`）。
- 机检建议（`check:pipeline` 新增 `PIPE-A1`）：断言 `isApprovalOnlyPath('ledger/units/unit-pipeline-approval.toml') === true` 且 `refuse` 分支可达。

**⑥ 回退方式**：删除 `APPROVAL_ONLY_SHARDS` / `isApprovalOnlyPath` 与那一行 `refuse`；`allowApprovalShard` 选项保留无害（不传即旧行为）。**回退是纯删除，无数据迁移**。

**⑦ 改动面等级**：**跨模块**（`server/hob-write.ts` + `modules/tools.ts`，2 文件 + 1 常量 + 1 选项）。

---

#### 选项 B · 门禁侧核 `source`（**不推荐单独做**）

**① 位置**：`src/shared/pipeline.ts:414-444`（`approvalDecisionProblems`，已对 `source` 只查非空）；`stage-controls.ts:313-325` / `:406-418`（C-18/C-19）。

**② 改什么**：把「`source` 必须匹配回执模式」下沉到纯函数，成为**所有写入路径**的判据。

**③ 具体改法**：

```ts
// pipeline.ts，approvalDecisionProblems 内，替换 line 439 那一条
if (text(unit.source) === '') {
  out.push({ rule: 'C-22', unit: id, why: '缺用户回执原文 source' })
} else {
  const artifact = units?.find?.(…)           // ⚠ 纯函数当前拿不到全账本 ⇒ 需扩签名
  if (artifact !== undefined && !approvalReceiptPattern(artifact).test(text(unit.source))) {
    out.push({ rule: 'C-22', unit: id, why: `source 不匹配回执模式（须点名 ${text(artifact.id)} 与第 N 版）` })
  }
}
```
⚠ **该改法要求 `approvalDecisionProblems` 增加 `units` 参数**（现在签名是单参数 `unit`），调用点 `pipeline.ts:566` 与 `hob-write.ts:1078` 需同步。

**④ 依赖与冲突**：
- **必须与 R-15 同批**：`R-15` 指出回执正则**有两份**（`tools.ts:2052` 内联 + `pipeline.ts:397-409` 纯函数），纯函数那份是死代码且更严（它要求「需求/方案」标签）。B 若直接用纯函数那份，会把工具当前接受的 `确认 R-1 第 1 版`（无标签）变成拒绝 ⇒ **行为变更，需 [待拍板]**。
- **与 A 冲突点**：A 之后写路径只剩一条，B 在那条路径上**重复**同一判据 ⇒ 两处会漂（正是 `R-15` 的病因）。

**⑤ 验证 + 负向对拍**：写 `source="继续"` 的 decision ⇒ `approvalDecisionProblems` 非空；负向对拍：把正则放宽成「非空即可」⇒ 断言红。

**⑥ 回退**：还原 `source` 那一分支。

**⑦ 改动面**：**跨模块**（签名变更波及 3 个调用点）。

---

#### 选项 C · 引入「用户本人触发」通路（**根治，需宿主配合**）

**先说清一件事：「用户本人触发」在本架构里有三种可落地的形态，强度依次递减。**

**现有事实（本次核实，附出处）**：
- 宿主提供 `ApprovalService`：`request(req): Promise<ApprovalOutcome>`，结果封闭集 `'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`，并且**每次询问都会往请求方会话日志追加一对 `approval/asked` + `approval/decided` 审计事件**（`node_modules/@deepseek-ai/dsh-user-approval/lib/types/index.d.ts:120-160`、`types.d.ts:50-95`）。
- 宿主每条消息有稳定身份 `MessageBase.id: MessageId`（`node_modules/@deepseek-ai/dsh-llm/lib/types/message.d.ts:144`）。
- `'allowed-once'` 是**唯一授予**；`'unavailable'` 表示无 answerer ⇒ **必须 fail-closed**。
- `request()` **要求有打开的 turn**，空闲时 ask 会直接 reject（同文件 `request()` 注释）。
- 本仓**当前零处**使用 `ctx.approval`（实测 grep 0 命中）。

---

##### C1 · 宿主 approval 服务（**最强，推荐**）

**「用户本人触发」长什么样**：Hob 调 `hob_pipeline_approve` 时，**工具自己**向宿主 `ctx.approval.request({ agent, toolName, reason })` 发起一次裁决；宿主把问题路由到用户（UI 弹确认），用户点「允许」⇒ 返回 `'allowed-once'`；**只有拿到 `allowed-once` 才写 decision 单元**，并把 `approval_request_id` 写进单元。

**需要宿主提供什么**：

| 能力 | 现状 | 依据 |
|---|---|---|
| `ctx.approval` 服务可注入 | ✅ 存在（`declare module '@deepseek-ai/cordis' { interface Context { approval: ApprovalService } }`） | `dsh-user-approval/lib/types/index.d.ts:25-30` |
| 有 UI answerer 实际弹窗 | ⚠ **未验证**：取决于部署是否 compose 了 answerer；无 answerer 时恒 `'unavailable'` | 同文件 `request()` 注释「a missing or throwing answerer yields `'unavailable'` (fail closed)」 |
| 审计事件可回读（用于事后核验） | ✅ `approval/asked` / `approval/decided` 落在**请求方会话日志** | `types.d.ts:50-75` |
| 需要打开 turn | ✅ 工具调用本身就在 turn 内 | 同 `request()` 注释 |

**具体改法（代码形状）**：

```ts
// src/modules/tools.ts · ledgerApprove.execute 内，在「校验 revision/option/receipt」之后、
// 「组装 TOML」之前插入。⚠ 位置在 dryRun 分支之前，保证演练也走同一判定。
const outcome = await ctx.approval.request({
  agent: exec.agent,
  toolName: 'hob_pipeline_approve',
  reason: `批准 ${id} 第 ${actualRevision} 版（${kind === 'req' ? '需求' : '方案'}）`,
})
if (outcome !== 'allowed-once') {
  return JSON.stringify({
    ok: false, reason: 'user-approval-not-granted', outcome,
    message: outcome === 'unavailable'
      ? '拒绝：宿主没有可用的用户裁决通道（approval answerer 缺席）⇒ 本次不写批准。⛔ 不用「Hob 转述」替代。'
      : `拒绝：用户未批准（${outcome}）⇒ 本次不写批准。`,
  })
}
// 落盘时再写两个字段：
//   approval_request_id = "<ApprovalRequestId>"
//   decided_by = "user"
```

纯函数侧（**关键：判据不能读宿主**）：

```ts
// src/shared/pipeline.ts · ApprovalState 增加 'unattested'
// approvalStateOf 内，在 decided_by 检查之后插入：
if (text(latest.approval_request_id) === '') {
  return { state: 'unattested', approvalId, revision,
           reason: '批准记录缺宿主裁决凭据 approval_request_id，无法证明是用户本人触发' }
}
```

而**凭据是否真实**由注入式解析器核（沿用本仓既有模式 `stageFileProblems(units, exists)`，`stage-controls.ts:1150` 就是同一个套路）：

```ts
// src/shared/pipeline.ts（纯函数，可测）
export function approvalAttestationProblems(
  units: readonly Record<string, unknown>[],
  resolve: (requestId: string) => { found: boolean; outcome?: string },
): Array<{ rule: string; unit: string; why: string }> { … }
```

```ts
// src/server/approval-attestation.ts（唯一做 I/O 的适配器）
export const resolverOf = (session: Session) => (requestId: string) => {
  // 在 session 的 approval/decided 事件里按 id 找，返回 { found, outcome }
}
```

**④ 依赖与冲突**：
- **必须与 A 同批**（A 收窄路径 + C 加凭据，缺 A 则凭据可被伪造写入）。
- **与 B 不兼容**：B 核 `source` 字符串，C 核宿主凭据；两者并存会出现「字符串过了但凭据没有」的双口径。**建议 B 并入 C 后删除**（与 §7.1「B 可并入 C 的校验下沉」一致）。
- **前置**：需确认部署侧 compose 了 answerer，否则 C1 上线即全员 `unavailable` ⇒ 批准功能整体不可用（这是**必须演练**的点，见⑤）。

**⑤ 验证 + 负向对拍**：
- 正向：有 answerer 且用户点允许 ⇒ decision 单元含 `approval_request_id`，`approvalStateOf === 'approved'`。
- **负向对拍 1（伪造 id）**：手写 `approval_request_id = "AR-不存在"` 的 decision ⇒ `approvalAttestationProblems` 必须非空。
- **负向对拍 2（无 answerer）**：移除 answerer ⇒ `hob_pipeline_approve` 必须返回 `user-approval-not-granted/unavailable`，**且账本零新增**。
- **负向对拍 3（自证回归）**：把 `approvalStateOf` 里 `approval_request_id` 检查删掉 ⇒ 断言 1 必须红。

**⑥ 回退**：`approval_request_id` 检查放在**独立返回值档位** `'unattested'` 而非 `'invalid'`；回退只需把该分支返回 `'awaiting-user'`/放行 + 删掉工具内 `ctx.approval.request` 调用。**存量 decision 单元不含该字段 ⇒ 回退后立即恢复旧行为，无需改数据。**

**⑦ 改动面**：**需宿主配合**（approval 服务 + UI answerer + 会话事件回读）。

---

##### C2 · 用户消息 id 凭据（**中等，宿主已有能力**）

**「用户本人触发」长什么样**：用户在会话里发的那条消息有稳定 `MessageId`。Hob 转录批准时，必须附上**那条用户消息的 id**；门禁侧用注入式解析器去会话日志里取该消息，核对 ①`role === 'user'`、②正文匹配回执模式、③**消息产生时刻早于 decision 的 `decided_at`**。

**需要宿主提供什么**：会话消息读取（事件回放），以及 `MessageId` 的稳定性。**这两项宿主都已提供**（`dsh-llm` 的 `MessageBase.id`；`dsh-session` 的事件日志）。⚠ 但「从当前 `exec` 拿到**可回放**的完整消息列表」的具体 API **未验证**（本仓现有代码只用 `selfSessionIdOf(exec)`，未读消息体）。

**具体改法**：与 C1 同形，只换字段与解析器：

```ts
// decision 单元新增
decided_by_message_id = "<MessageId>"
// 纯函数检查（同 C1 的 unattested 档）
if (text(latest.decided_by_message_id) === '') return { state: 'unattested', … }
// 解析器（server 侧）
const resolve = (msgId: string) => messagesOf(session)
  .filter(m => m.role === 'user' && String(m.id) === msgId)
  .map(m => ({ text: contentTextOf(m), at: atOf(m) }))[0]
```

**④ 依赖与冲突**：与 C1 互斥（二选一，不要同时要求两个凭据）；与 A 同批；**与 R-15 联动**（回执模式应复用 `approvalReceiptPattern` 单一实现）。

**⑤ 验证 + 负向对拍**：伪造一个不存在的 message id ⇒ 解析器 `found:false` ⇒ 必须拒；把 `role === 'user'` 判定去掉 ⇒ 用 assistant 消息 id 也能过 ⇒ **必须红**（这是 C2 最容易被自证攻破的口子）。

**⑥ 回退**：同 C1（独立档位 + 存量无字段即恢复）。

**⑦ 改动面**：**需宿主配合**（弱于 C1：不要求 UI 弹窗，只要求消息可回读）。

---

##### C3 · UI 点击产生的一次性令牌（**最弱，本质是 C1 的手工版**）

**「用户本人触发」长什么样**：面板上的「确认需求/方案」按钮点下去，由**客户端**调一条专用路由，服务端生成一次性令牌（绑定 `artifactId` + `revision` + `digest` + TTL），把令牌作为参数交给 `hob_pipeline_approve`。

**需要宿主提供什么**：客户端 → 服务端的专用路由（本仓已有 `modules/*-route.ts` 模式）+ 宿主侧「路由调用者是不是用户」的判别能力。

**⚠ 该路径的最大风险**：**令牌一旦落进模型可读的上下文，Hob 就能自己用**——它退化成「一次性口令」，只是把 `source` 字符串换成了 `source` + `token`，**自证结构没变**。故 C3 **只有在令牌对模型不可见时才成立**（即由宿主在投递链路里注入，而非模型参数）。

**结论**：C3 **不推荐作为主路径**；若要做，必须满足「令牌不经模型参数」这一条，否则等同 B。

---

##### C 的降级判据（**回答「若宿主不提供是否降级为 A」**）

| 探针结果 | 结论 |
|---|---|
| 部署有 answerer，且 `request()` 能返回 `allowed-once` | 落 **C1** |
| 无 answerer（恒 `unavailable`），但消息可回读 | 落 **C2** |
| 两者都没有 | **降级为 A + 显式标注**：在 `hob_pipeline_approve` 的返回与 README 里如实写「本部署无用户裁决通道，批准由 Hob 转录，**不等于用户操作**」，并把 `approvalStateOf` 的 `reason` 带上该事实 |

> ⚠ **降级为 A 时必须同时做一件事**：把 `S-01` 从「已修」改成「**已知限制**」并在 README 的「已知限制」表登记。否则「修了 S-01」会变成新的假读数。

**① 缺陷编号与位置**（C 的总）：S-01；`tools.ts:1994-2117`（`ledgerApprove.execute`）、`pipeline.ts:307-394`（`approvalStateOf`）、`pipeline.ts:34-41`（`ApprovalState` 联合类型）。
**② 改什么**：给批准引入**外部凭据**，并把「无凭据」变成**独立可辨状态**（不是 `invalid`，避免与「伪造」混为一谈）。
**③ 具体改法**：见 C1/C2/C3 三小节。
**④ 依赖与冲突**：前置 A；与 B 互斥；C1 需部署侧 answerer 演练。
**⑤ 验证 + 负向对拍**：见各小节（C 的验收断言是「伪造不存在凭据必须被拒」）。
**⑥ 回退方式**：独立状态档位 + 存量无字段即回退，不改数据。
**⑦ 改动面**：**需宿主配合**。

### 2.3 落地顺序（三选项）

```
A（1 个 PR，可独立回退）
  └─► C 的形态探针（0.5 天：确认 answerer 是否存在）
        ├─ 有 ⇒ C1（+ 删除 B 的字符串校验）
        ├─ 无但有消息回读 ⇒ C2
        └─ 都没有 ⇒ 降级 A + README 登记「已知限制」
B：仅作为 C1 落地前的临时护栏（可选，不单独发布）
```

### 2.4 这条修完之后，REVIEW.md 里哪几条连带消掉

| 连带项 | 为什么 |
|---|---|
| **T-13** | 同一主线：批准写入通道与 `proceedGate`。C 落地时 approve 必然重写，顺手补闸门（§8） |
| **T-06**（部分） | `approve` 那处 `validateLedgerStructure:false` 随 A 一起改 `true` ⇒ T-06 的 4 处里消掉 1 处 |
| **R-15** | A/C 落地时回执正则必须收敛到 `approvalReceiptPattern` 单实现 ⇒ R-15 的「两份正则」消失 |
| **R-12**（部分） | `artifact_digest` 的语义在 C 下被「凭据 + digest 双绑」强化，但 **R-12（草稿期 revision 不递增）仍需 D-4 单独修**，不自动消失 |
| **S-02** | **不连带**：S-02 是门禁侧的豁免，与写入通道无关，必须单独修（§3） |

---

## §3 S-02 · blocker · `clarify_legacy` + `created_at` 两个自填字段可跳过 11 类门禁

### 3.1 现状与「存量事实」（这条的难点不是改法，是**不改坏存量**）

**判据链**（读码确认）：

~~~ts
// src/shared/stage-controls.ts:271
const legacy = (u: StageControlUnit): boolean => txt(u.clarify_legacy) === 'pre-control'
// :274-286 —— 唯一的反制，但它读的 created_at 同样是**单元自填**
const CONTROL_CUTOFF = '2026-11-06'
export function legacyMisuse(u) {
  if (txt(u.clarify_legacy) !== 'pre-control') return []
  const created = txt(u.created_at)
  if (created === '') return [{ rule: 'C-11', … }]
  if (created.slice(0, 10) >= CONTROL_CUTOFF) return [{ rule: 'C-11', … }]
  return []
}
~~~

**被豁免的门禁（12 处 `legacy(u)`）**：`requirementProblems`(:290)、`planProblems`(:329)、`taskProblems`(:422)、`taskFullProblems`(:443)、`acceptanceProblems`(:521)、`runProblems`(:613)、`verificationProblems`(:630)、`closureProblems`(:702)、`titleProblems`(:779)、`evidenceProblems`(:831)、`ledgerClosureProblems`(:932)、以及 `ledgerClosureProblems` 里两处「历史直挂 req」兼容(:953/:976)。

**存量事实（本次实测，决定改法边界）**：

| 事实 | 命令/位置 | 结果 |
|---|---|---|
| 真实账本里 `clarify_legacy` 的用量 | `grep -rc clarify_legacy ~/.dsh/hob-ledgers/*/ledger/units/*.toml` | **只有 `dsh-hob` 一本，共 177 行**，分布 `unit-01..unit-06` 六个分片 |
| 带 `pipeline_version = "v3"` 的单元 | 同目录 grep | 全仓只有 **1 条**（在 `prompt-enhancer-release`） |
| 分片命名 | `ls ~/.dsh/hob-ledgers/dsh-hob/ledger/units/` | `index.toml + unit-01..unit-07` |

⇒ **关键结论**：`clarify_legacy = pre-control` 的存量**全部集中在 `unit-01..06`**，且**没有一条是 v3**。这让「按分片判定历史」有一个**可核实的依据**。

> ⚠ **但分片名也不是不可伪造的**：`write_hob` 能写 `ledger/units/unit-99.toml`。所以「按分片」只能作为**辅助**，主判据必须是「**单元自己无法声明的外部事实**」。

### 3.2 改法：三层判据（**不是替换一个字段，是把「豁免」从自证改成他证**）

**① 缺陷编号与位置**：S-02；`src/shared/stage-controls.ts:271`（`legacy()`）、`:274-286`（`legacyMisuse`）、12 处 `legacy(u)` 调用点。

**② 改什么**：把「是不是历史条目」的判据从「单元自填 `clarify_legacy`」换成「**外部可核事实**」，并让 v3 条目**结构上不可能**获得豁免。

**③ 具体改法**（三层）：

**第 1 层（必须，纯函数层，无 I/O）**：v3 条目一律不豁免。

~~~ts
// src/shared/stage-controls.ts · 替换 line 271
/**
 * 历史豁免的判据（2026-11-10 修订）。
 *
 * ⚠ 改前只读 clarify_legacy，而它由写入方自己填 ⇒ 新条目可自证豁免（S-02）。
 * ⚠ 新判据：v3 条目结构上不豁免；只有非 v3 且带外部凭据的条目才豁免。
 */
const legacy = (u: StageControlUnit): boolean => {
  /** ① v3 一律不豁免 —— 与 REVIEW §7.2 D-2(A) 一致。 */
  if (isPipelineV3(u as any)) return false
  /** ② 非 v3 仍需自报标记（它只是"申请"，不是"批准"）。 */
  if (txt(u.clarify_legacy) !== 'pre-control') return false
  /** ③ 由注入的 provenance 决定是否真的属于历史；缺 provenance ⇒ 不豁免（fail-closed）。 */
  return provenanceOf(u).historic === true
}
~~~

**第 2 层（必须，注入式 provenance）**：把「历史性」变成**账本级事实**，由 I/O 适配器注入 —— 完全沿用本仓已有的 `stageFileProblems(units, exists)` 模式（`stage-controls.ts:1150`）。

~~~ts
// src/shared/stage-controls.ts —— 新增类型与注入器（纯函数，零 I/O）
export interface UnitProvenance {
  /** 该单元所在分片是否是"历史分片"（由 I/O 侧按账本 ledger.toml 的 generation/created_at 判定）。 */
  historic: boolean
  /** 判据来源，供 C-11 的 why 引用（可复核）。 */
  basis: 'shard-frozen' | 'ledger-generation' | 'unknown'
}

/** 缺省：无 provenance ⇒ 不 historic（fail-closed）。 */
let provenanceResolver: (u: StageControlUnit) => UnitProvenance =
  () => ({ historic: false, basis: 'unknown' })

export function setProvenanceResolver(fn: (u: StageControlUnit) => UnitProvenance): void {
  provenanceResolver = fn
}
const provenanceOf = (u: StageControlUnit): UnitProvenance => provenanceResolver(u)
~~~

⚠ **这与本仓「纯函数、零 I/O」的纪律不冲突**：注入点与 `stageFileProblems` 的 `exists` 回调同构；缺省值必须 fail-closed（`historic: false`），**任何忘记注入的调用方只会更严格，不会更宽松**。

I/O 侧的 resolver（`src/modules/tools.ts`，与 `readLedgerUnits` 同处）：

~~~ts
export function provenanceResolverOf(ledgerRoot: string) {
  const gen = readLedgerGeneration(ledgerRoot)          // 读 ledger.toml 的 generation / created_at
  const historicShards = new Set(['index.toml'])        // 约定：历史分片号段（见第 3 层）
  return (u: StageControlUnit): UnitProvenance => {
    const shard = shardOfUnit(ledgerRoot, txt(u.id))    // 该单元实际所在分片（I/O 侧知道）
    if (shard === undefined) return { historic: false, basis: 'unknown' }
    if (gen !== undefined && gen.activatedAt < CONTROL_CUTOFF) {
      return { historic: true, basis: 'ledger-generation' }
    }
    return historicShards.has(shard)
      ? { historic: true, basis: 'shard-frozen' }
      : { historic: false, basis: 'unknown' }
  }
}
~~~

**第 3 层（加固，可选）**：把 `unit-01..06` 设为**冻结分片**（拒绝新写，只允许原地修正），把历史性变成**路径事实**：

~~~ts
// src/server/hob-write.ts
const FROZEN_SHARDS = /^ledger\/units\/unit-0[1-6]\.toml$/
if (FROZEN_SHARDS.test(file) && mode !== 'overwrite') {
  return refuse(file, 'historic-shard-append-denied',
    '拒绝：历史分片只允许原地修正（overwrite），不得追加新单元 —— 新单元请写 unit-07 之后的号段。')
}
~~~

**④ 依赖与冲突**：

| 关系 | 说明 |
|---|---|
| **与 S-01 同批（L-A）** | 都改 `stage-controls.ts` / `pipeline.ts` 判定面；分开做会让「批准可自证」与「豁免可自证」两条路交替存活 |
| **与 T-05 同批（L-C）** | S-02 收紧后，以前被豁免的旧条目会**新增**一批缺口 ⇒ `repairOf` 的命中集合变化。必须与 §7 一起验收 |
| **与 R-01 同批** | 两者都让「以前绿的变红」；若分两批，用户会经历两次变红、两次怀疑 |
| ⚠ **必须先做第 2 层再做第 1 层** | 若先只做第 1 层而不做 provenance，**存量 177 行的非 v3 条目会因「没有 provenance ⇒ 不豁免」全部变红**。**正确顺序：先接 provenance（默认仍豁免历史分片）⇒ 再开 v3 禁令 ⇒ 再收紧到「缺 provenance 不豁免」** |

**⑤ 验证方式 + 负向对拍**：

~~~bash
# 正向 1：v3 + pre-control ⇒ 必须报 C-11（无论 created_at）
node /tmp/fix_probe_s02.mjs
#   夹具 { id:'R-9', kind:'req', status:'agreed', pipeline_version:'v3', revision:'1',
#          clarify_legacy:'pre-control', created_at:'2020-01-01' }
#   期望 requirementProblems 含 C-11

# 正向 2：存量 177 行的账本不得因本改动新增缺口
node /tmp/fix_probe_s02_ledger.mjs ~/.dsh/hob-ledgers/dsh-hob
#   期望：改动前后 stageControlProblems 的条数**相等**
~~~

- **负向对拍 1**：把 `legacy()` 改回只读 `clarify_legacy`（去掉 v3 禁令）⇒ 正向 1 必须变红。
- **负向对拍 2**：把 `provenanceResolver` 缺省值改成 `historic: true` ⇒ 正向 2 必须变红（存量 177 行立刻全绿 = 豁免被扩大，这是「更宽松」的错误方向）。
- **负向对拍 3**：把 `created_at` 检查删掉 ⇒ **正向 1 不受影响**（刻意：created_at 从此不再是判据，只保留为 C-11 的说明性引用）。
- 机检建议（`check:stage-controls` 新增）：
  ~~~ts
  assert(stageFieldProblems([v3UnitWithPreControl]).some(p => p.rule === 'C-11'))
  assert(stageFieldProblems([nonV3HistoricShardUnit]).length === 0)
  ~~~

**⑥ 回退方式**：`legacy()` 三行判据**按层可独立回退** —— 删掉第 ① 行即恢复「v3 也可豁免」（回到现状）；删掉第 ③ 行即恢复「只看自报字段」。**无需迁移数据**：`clarify_legacy` 字段保持存在，只是不再单独生效。

**⑦ 改动面等级**：**跨模块**（`shared/stage-controls.ts` + `modules/tools.ts` + 可选 `server/hob-write.ts`）。

### 3.3 存量兼容方案（**这是本条能否落地的前提**）

| 阶段 | 动作 | 存量影响 | 可回退 |
|---|---|---|---|
| **S-02-a** | 接 provenance 注入（默认 fail-closed，但 I/O 侧已实现「历史分片 ⇒ historic」） | **零**：177 行仍然豁免 | ✅ 删注入即回旧 |
| **S-02-b** | 开 v3 禁令（第 1 层第 ① 行） | **零**：现存 v3 单元只有 1 条，且不在 `dsh-hob` | ✅ 删一行 |
| **S-02-c** | 冻结 `unit-01..06` 只允许 overwrite | **零**：不阻止修正 | ✅ 删守卫 |
| **S-02-d** | C-11 的 why 引用 `basis`（可复核来源） | 文本变化 | ✅ |

> ⚠ **不建议**「一次性把 177 行的 `clarify_legacy` 清掉」：那是**改写历史数据**，且会让「历史条目为什么当时被豁免」从账本里消失。本仓纪律（`O-37` / `T-06` 的教训）是**保留历史、只收紧判据**。

### 3.4 这条修完之后，REVIEW.md 里哪几条连带消掉

| 连带项 | 为什么 |
|---|---|
| **S-02**（本条） | — |
| **O-20**（部分） | 历史条目的「无阻断」显示不再依赖自填字段，展示层不必再解释「为什么这条没缺口」 |
| **T-05**（部分） | 与 L-C 联动：`repairOf` 的命中集合稳定后才好换判据（§7） |
| **T-06**（部分） | 真实存量账本（`prompt-enhancer-release` 那 2 处越界）在「历史分片 ⇒ historic」下仍可被豁免写入，**但这只对历史单元成立**；新单元不再享受 ⇒ T-06 的「正文写不进、迁移修不到」夹缝**缩小但不消失**（仍需 T-06 本身修） |

---

## §4 R-01 · blocker · G4/G5「阶段完成」用弱判定，强判据只进 `blockedBy`

### 4.1 现状（三个函数，两套标准）

| 函数 | 位置 | 读什么 | 不读什么 |
|---|---|---|---|
| `verificationReady` | `pipeline-view.ts:151-172` | `status==='pass'` / `task_revision` / 证据单元存在 / `command` 有 `exit_code` | `verifier`、`verification_session`、`criteria_refs`、`nonconformance_refs`、`verified_at`、风险控制证据 |
| `allTasksVerified` | `pipeline-view.ts:175-184` | 上面那个 + 最新判决优先 | `verificationProblems()` 全量 |
| `allTasksAccepted` | `pipeline-view.ts:187-193` | `effectiveAcceptanceOf` 的 `accepted` | `acceptanceProblems()` 全量 |

而**强判据确实存在并且被算了**（`pipeline-view.ts:322-327`、`:332-345`），只是结果被 push 进 `blockedBy`，**不参与 `activeStage` / `chainCompleted` 的决定**。

**复现基线（沿用 t1 探针 /tmp/pa_probe5.mjs，本次核对行号未漂）**：验证者=实现者、验收者=实现者、无 `criteria_refs`/`verification_refs`/`example_results` ⇒ C-7/C-25 共 6 条违规，而 `activeStage=7`、`chainCompleted=true`、阶段 5/6 均 `completed`。

### 4.2 改法：把「强判据为空」并入完成条件（**单一入口，不改强判据本身**）

**① 缺陷编号与位置**：R-01；`src/shared/pipeline-view.ts:175-193`（两个 all 函数）、`:442-461`（G4/G5 分支）、`:322-345`（重复 push）。

**② 改什么**：
1. 两个 `all*` 函数改为**同时**要求「弱条件成立」∧「强判据为空」；
2. **强判据只算一次**，结果同时用于 ①完成判定 ②`blockedBy` 渲染（消掉当前重复 push）；
3. 完成判定与渲染**共用同一个数组**，这是「同源」的落地方式。

**③ 具体改法**：

~~~ts
// src/shared/pipeline-view.ts —— 新增两个"唯一判据入口"
/** 一个任务的当前验证问题（弱判定 + 强判据，唯一入口）。 */
function taskVerificationProblems(
  task: Unit, latest: LatestVerdict, units: readonly Unit[],
): StageControlProblem[] {
  const out: StageControlProblem[] = []
  /** 弱判定：没到 pass 就没有讨论余地。 */
  if (latest.status !== 'pass') {
    out.push({ rule: 'G4', unit: latest.id, why: '最新技术验证是 ' + latest.status })
    return out
  }
  if (!verificationReady(latest.unit, units)) {
    out.push({ rule: 'G4', unit: latest.id, why: '技术验证缺可复核证据（task_revision / 证据单元 / 命令读数）' })
  }
  /** 强判据：完整跑一遍 verificationProblems（含独立性 / criteria_refs / 非符合项 / RP-6）。 */
  out.push(...verificationProblems(latest.unit as any, units as any))
  return out
}

/** 一个任务的当前验收问题（弱判定 + 强判据，唯一入口）。 */
function taskAcceptanceProblems(
  task: Unit, own: readonly Unit[], units: readonly Unit[],
): StageControlProblem[] {
  const out: StageControlProblem[] = []
  const verdict = effectiveAcceptanceOf(own as AcceptanceVerdictLike[])
  if (verdict.verdict !== 'accepted') {
    out.push({ rule: 'G5', unit: verdict.latest_id ?? text(task.id), why: '有效验收判决是 ' + verdict.verdict })
    return out
  }
  /** 强判据：对每一条 pass 的 ACC 跑 acceptanceProblems（含独立性 / 例子逐条结果 / 发布证据 / 残余风险）。 */
  for (const a of own) {
    if (text(a.status) !== 'pass') continue
    out.push(...acceptanceProblems(a as any, units as any))
  }
  return out
}
~~~

两个 `all*` 改成：

~~~ts
function allTasksVerified(tasks, verifications, units): boolean {
  if (tasks.length === 0) return false
  return tasks.every((task) => {
    const latest = latestVerificationOf(verifications, text(task.id))
    if (latest === undefined) return false
    return taskVerificationProblems(task, latest, units).length === 0
  })
}

function allTasksAccepted(tasks, groups, accs, units): boolean {
  if (tasks.length === 0 || groups.length === 0) return false
  return tasks.every((task) => {
    const id = text(task.id)
    if (!groups.some((g) => g.parent === id && g.verdict.verdict === 'accepted')) return false
    const own = accs.filter((a) => text(a.parent) === id)
    return taskAcceptanceProblems(task, own, units).length === 0
  })
}
~~~

> ⚠ **签名变化**：`allTasksAccepted` 需要 `accs` 与 `units`（`groups` 里只有 verdict、没有原始 ACC）。调用点 `:443`、`:529`（`chainCompletedOf`）、`:543` 三处同步。

**④ 依赖与冲突**：

| 关系 | 说明 |
|---|---|
| **必须与 S-01/S-02/R-05 同批（L-A）** | 同文件 `pipeline-view.ts`，且 S-02 会让一批单元从「豁免」变成「有缺口」；分开合入会先红一次再红一次 |
| **与 T-08 同批（强烈建议）** | 判定变严后若 `blockedBy` 仍不出现在面板（`requirement-chain.ts:521-540` 只在 G1/G2 注入），用户会看到「阶段卡在 5」但**看不到为什么** —— 这正是「让失败不可观测」。**R-01 与 T-08 必须同批**，否则修完比修前更难排查 |
| **与 S-03 联动** | S-03 是 `acceptanceProblems` 内的 fail-open（`built_by` 缺失即放行）。R-01 把强判据接进判定后，**S-03 的漏洞会直接决定 G5 能否通过** ⇒ 建议同批修（`builder === ''` 时报「无法判定独立性」） |
| **与 R-02 同批** | R-01 改完后「完成」的权威值变了，而 `stages-index.ts:284-293` 的 `summarizeStage` 仍只按 status 计数 ⇒ 会立刻出现「面板 3/3 done、pipeline 说没完成」的新一代分叉。**R-02 不是可选项** |
| **与 R-09 无冲突** | R-09 改的是 `activeStage=7→6`，与本条正交 |

**⑤ 验证方式 + 负向对拍**：

~~~bash
node /tmp/fix_probe_r01.mjs
# 夹具：VER.verifier === TSK.built_by、ACC.actor === TSK.built_by、无 criteria_refs/verification_refs/example_results
# 期望：activeStage === 5、gate === 'G4-verification'、chainCompleted === false
#       stages[4].state === 'active'、stages[5].state === 'draft'
~~~

- **负向对拍 1**：把 `taskVerificationProblems` 里的 `verificationProblems(...)` 删掉（退回弱判定）⇒ 断言必须红。
- **负向对拍 2**：把 `taskAcceptanceProblems` 里的 `acceptanceProblems(...)` 删掉 ⇒ 断言必须红。
- **负向对拍 3（防"过严"回归）**：构造一条**完全合规**的账本（独立性、证据、例子结果齐全）⇒ 必须 `activeStage=7 / chainCompleted=true`。**这条是防「为了修红而把闸门焊死」的对照**。
- **负向对拍 4（重复 push 已消）**：断言 `blockedBy` 里同一 `(rule,unit)` 只出现一次（当前 `VER-1` 的 C-25 出现两次，见 `:325-327` 与 `:340-344`）。

**⑥ 回退方式**：两个新函数是**新增**，回退只需把 `allTasksVerified` / `allTasksAccepted` 的函数体换回旧实现（各 6 行）。**无数据变化**，可随时回退。

**⑦ 改动面等级**：**跨模块**（`pipeline-view.ts` + 同批的 `requirement-chain.ts`/`stages-index.ts` 口径同步）。

### 4.3 迁移策略：**存量账本会大面积变红，必须分批 + 只读宽限**

这是本条最现实的阻力。三层策略：

#### 4.3.1 先量化（不改代码就能做）

~~~bash
# 对每本真实账本跑一次"新判据"体检，产出变红清单（只读）
node /tmp/fix_probe_r01_survey.mjs ~/.dsh/hob-ledgers/*
# 输出：<ledger>  G4违规数 / G5违规数 / 受影响 task 数 / 是否会翻成 chainCompleted=false
~~~

⚠ **本规格不预设结论**：真实账本里 G4/G5 的违规数量我**没有实测**（本机账本大多没有 verification/acc 单元，全量体检会得到 0 违规的假象）。**在拿到 4.3.1 的输出之前，不得声称「影响面很小」**。这是本条的**未验证项**。

#### 4.3.2 三段式上线

| 段 | 代码状态 | 用户可见结果 | 时长 |
|---|---|---|---|
| **① 影子模式** | 新判据照算，但 `activeStage`/`chainCompleted` **仍用旧值**；只把「新判据会怎么说」写进 `pipelineView.shadow` 字段 | 面板多一栏「按强判据：G4 还差 N 条」；**不拦任何人** | ≥1 周 |
| **② 宽限期** | 新判据生效，但**仅对 `pipeline_version='v3'` 且 provenance 为「非历史」的单元**硬拦；历史单元继续影子 | 新账本立刻严；旧账本只提示 | 至用户确认 |
| **③ 全量** | 去掉历史条件 | 全部严格 | — |

**为什么必须分三段**（而不是直接上 ③）：
- 直接上 ③ 会让**已经在跑的真实项目**（`dsh-hob` / `prompt-enhancer-release` 等）从「已完成」翻成「未完成」，且**没有修复入口**（历史 VER/ACC 的证据补不回来，补 = 改历史）；
- 而 `②` 的历史条件是**自填字段就危险**——这与 S-02 同一个陷阱。⚠ **所以 ② 的判据必须用 S-02 的 provenance（不可自填），不能用单元自己的 created_at**。这是 R-01 与 S-02 的强耦合点。

#### 4.3.3 宽限期的「出口」定义（**不许无限期**）

~~~ts
// 宽限判据（唯一实现，随 S-02 的 provenanceResolver 注入）
const exemptFromStrongGate = (u: Unit): boolean =>
  provenanceOf(u).historic === true && provenanceOf(u).basis !== 'unknown'
~~~
**出口条件（写进 CI，不靠人记）**：当 `~/.dsh/hob-ledgers` 下所有账本的 `provenance.basis === 'unknown'` 的单元数降到 0 时，删除该分支。机检：`check:pipeline` 断言 `exemptFromStrongGate` 的调用点数 ≤ 1（防止它被复制成多处豁免）。

### 4.4 这条修完之后，REVIEW.md 里哪几条连带消掉

| 连带项 | 为什么 |
|---|---|
| **R-01**（本条） | — |
| **S-03**（若同批） | 强判据接进判定后，`built_by` 缺失的 fail-open 会**直接放大成 G5 通过** ⇒ 同批修即消 |
| **T-08**（若同批） | 判定变严后必须有出口，T-08 是本条的可见性前提 |
| **R-02**（若同批） | `summarizeStage` 的同源化；否则本条会**制造**新的「两套完成口径」 |
| **O-35**（部分） | 「被隔离会话能把链推到 chainCompleted」在强判据下**更难**，但不消失（它走的是 `hob_orch_control` 直接投影，见 §8） |
| **S-01** | **不连带**：S-01 管批准，R-01 管验收完成，不同面 |
| **R-05** | **不连带**：G3（任务图）与 G4/G5 是不同阶段 |

---

## §5 R-05 · blocker · G3（依赖环/悬空/覆盖缺口）不进任何派活闸门

### 5.1 现状（闸门里没有图）

```ts
// src/shared/pipeline-view.ts:570-644 —— pipelineDispatchProblems 全函数
// 逐行核对（本次复核）：
//   :576 task.kind 检查 → :579 isPipelineV3 → :584 父方案存在且是 change → :587 父方案 v3
//   → :590 superseded → :593 planApproval → :601 reqIds 非空 → :605-619 逐 req 审批
//   → :620 taskProblems → :623 riskAssessmentProblems(plan) → :630 riskObjectProblems
//   → :638 risk_binding_digest → :642 taskRiskProblems
//   ⇒ 全文 0 次 taskGraphOf
```

而 G3 的**推进**判定确实用了图（`pipeline-view.ts:411-417`）：

```ts
const graphReady = graph.nodes.length > 0
  && graph.cycles.length === 0
  && graph.dangling.length === 0
  && graph.coverageGaps.length === 0
  && graph.nodes.every((n) => taskFullProblems(...).length === 0)
  && taskGraphRiskProblems(tasks).length === 0
```

⇒ **同一个判据，视图用它决定「第几步」，派活用它之外的一切决定「能不能派」**。

### 5.2 改法：把图判据接进 `pipelineDispatchProblems`

**① 缺陷编号与位置**：R-05；`src/shared/pipeline-view.ts:570-644`。

**② 改什么**：在 `pipelineDispatchProblems` 里，对该任务所属需求的**任务图**跑一次 `taskGraphOf`，把与本任务相关的图问题升级为派发阻断。

**③ 具体改法**（关键：**作用域必须限定到本任务**，否则一个需求下的任何环都会阻断所有任务，会误伤）：

~~~ts
// src/shared/pipeline-view.ts · pipelineDispatchProblems 末尾（:642 之后）新增
/**
 * G3 图判据（R-05）。
 *
 * ⚠ 作用域：只报**与本任务相关**的图问题 ——
 *   ① 本任务自己参与的环；
 *   ② 本任务的 dangling 出边；
 *   ③ 本任务自己声明的 criteria_refs 未覆盖的验收条件。
 * ⛔ 不把「同需求下别的任务有环」算到这一条头上（那是它们的派发被拦，不是这一条）。
 */
const graph = taskGraphOf(requirementOfTask(units, task) ?? {}, units)
for (const cycle of graph.cycles) {
  if (cycle.includes(taskId)) {
    out.push({ rule: 'G3', unit: taskId, why: '任务依赖成环：' + cycle.join(' → ') + ' ⇒ 派出去也跑不完' })
  }
}
for (const d of graph.dangling) {
  if (d.startsWith(taskId + ' → ')) {
    out.push({ rule: 'G3', unit: taskId, why: '任务依赖悬空：' + d + ' ⇒ 先补上依赖对象或删掉这条边' })
  }
}
for (const g of graph.coverageGaps) {
  const mine = task.criteria_refs
  if (Array.isArray(mine) && mine.includes(g)) continue          // 我已声明覆盖
  out.push({ rule: 'G3', unit: taskId, why: '验收条件 ' + g + ' 没有任何任务覆盖 ⇒ 先拆任务' })
}
~~~

其中 `requirementOfTask` 是**新增的极小纯函数**（沿 `parent@@ 上溯到 req，复用 `gateScopeUnits` 已经在做的爬链写法，`stage-controls.ts:1028-1036`）：

~~~ts
function requirementOfTask(units: readonly Unit[], task: Unit): Unit | undefined {
  let cur: Unit | undefined = task
  const seen = new Set<string>()
  while (cur !== undefined) {
    const id = text(cur.id)
    if (id !== '' && seen.has(id)) return undefined
    if (id !== '') seen.add(id)
    if (text(cur.kind) === 'req') return cur
    const up = text(cur.parent)
    if (up === '') return undefined
    cur = units.find((u) => text(u.id) === up)
  }
  return undefined
}
~~~

⚠ **必须同时修 R-10**（否则覆盖校验读的是 `criteria_refs` 而契约字段是 `acceptance_criteria_refs`，本条的 §③ 会把**合规写法的任务判成未覆盖**）：

~~~ts
// pipeline-view.ts:692 / :696 / :714 —— 三个读取点统一成"契约字段 ∪ 展示字段"
const refsOf = (t: Unit): string[] => [
  ...listOf(t.acceptance_criteria_refs),
  ...listOf(t.criteria_refs),          // ⚠ 兼容存量：真实账本/脚本用的是这个
]
~~~

**④ 依赖与冲突**：

| 关系 | 说明 |
|---|---|
| **必须与 R-10 同批** | 见上：不修 R-10，R-05 会对**按文档写**的账本产生误报 |
| **必须与 R-28 同批（L-B）** | 只把 G3 接进 `pipelineDispatchProblems` 而多轨仍不调它 ⇒ **攻击面完全没变**（多轨是唯一绕过入口，见 §6） |
| **与 S-01 同函数、不同段落** | 同一函数 `pipelineDispatchProblems`：S-01(A) 改的是**写入路径**、R-05 改的是**函数体末尾**。⚠ 若 S-01(C) 也要在此函数校验凭据，**必须与 R-05 同批**，否则同一函数被改两次（正是「同一文件不得多次触碰」） |
| **与 O-34 联动** | `taskGraphOf` 收集任务用「该需求下**全部** change（含 superseded）」，而 `currentTasksOf` 只认当前方案 ⇒ 同一需求两份任务集。**R-05 把图判据接进闸门后，O-34 从「显示不一致」升级为「派发被旧方案的任务环阻断」** ⇒ O-34 必须同批或提前修 |
| **与 R-09 无冲突** | — |

**⑤ 验证方式 + 负向对拍**：

~~~bash
node /tmp/fix_probe_r05.mjs
# 夹具 A：TSK-1.depends_on = ['TSK-NOT-EXIST']  ⇒ pipelineDispatchProblems 必须含 G3 悬空
# 夹具 B：TSK-1.depends_on = ['TSK-2'], TSK-2.depends_on = ['TSK-1']  ⇒ 必须含 G3 成环
# 夹具 C：req.acceptance_criteria = ['AC-1: x']，无任务声明覆盖  ⇒ 必须含 G3 AC-1
# 夹具 D（对照，防过严）：图干净 + 字段齐全  ⇒ pipelineDispatchProblems 必须为空
~~~

- **负向对拍 1**：把 `taskGraphOf` 那段删掉 ⇒ 夹具 A/B/C 必须变红（变成空数组）。
- **负向对拍 2（防误伤）**：构造「同需求下 **TSK-9** 有环，但派的是 **TSK-1**」⇒ TSK-1 的 `pipelineDispatchProblems` **必须为空**。这条防止把作用域写宽。
- **负向对拍 3**：把 `refsOf` 改回只读 `criteria_refs` ⇒ 用 `acceptance_criteria_refs` 的合规夹具必须变红（锁定 R-10 的联动）。

**⑥ 回退方式**：新增段落是**纯追加**（:642 之后），回退即删掉该段与 `requirementOfTask`。**无数据变化**。

**⑦ 改动面等级**：**跨模块**（`pipeline-view.ts` + 同批 `requirement-chain.ts`/@stages-index` 无改动，但与 R-28 跨文件）。

### 5.3 这条修完之后，REVIEW.md 里哪几条连带消掉

| 连带项 | 原因 |
|---|---|
| **R-05**（本条） | — |
| **D-6** | §7.4 的 D-6「G3 是否进派发闸门」由本条落地为「进」 |
| **O-34**（必须同批） | 若不同批，本条会把 O-34 放大成派发误伤 |
| **R-10**（必须同批） | 覆盖字段口径 |
| **T-08**（部分） | G3 的拒绝理由第一次有出口（`pipelineDispatchProblems` 的 why 会被 `dispatchGateAtLedger` 拼进 blocked 文案） |
| **R-28** | **不连带**：多轨是另一条路径（§6） |

---

## §6 R-28 · high · 多轨首次派发时任务链门禁不跑（**唯一能绕过任务链的入口**）

### 6.1 现状（顺序问题，不是判据问题）

~~~text
hob_dispatch({ tracks, planId: 'PLAN-NEW' })
  └─► orchestrator.ts:8806  if (!Array.isArray(args.tracks)) { …lifecycle + TSK 正则… }   ← 多轨整段跳过
  └─► :8837                 proceedGateOf?.(exec, { taskId, planId })
  └─► :8905                 orch.dispatchPlan(input, …)
        └─► :4771  planConflictProblems(…)
        └─► :4816  writeWorkPlan(ledgerRoot, plan)        ← 计划**在这里**才落盘
        └─► （之后 dispatch 才看见这份计划）
  而 tools.ts:881-886  listWorkPlans(ledgerRoot) 找 planId
      tools.ts:934-936  找不到 ⇒ return { blocked: undefined }   ← **门禁空转**
~~~

⇒ **多轨首派的轨道从不经过 `pipelineDispatchProblems`**。这是当前唯一能绕过「父方案未批准 / 任务书不齐 / 风险评定缺失」的派发入口。

### 6.2 改法（**按 D-5 的 A 方案：在写盘前用 tracks 逐个判**）

**① 缺陷编号与位置**：R-28；`src/modules/orchestrator.ts:4816`（`writeWorkPlan`）、`:4771`（`planConflictProblems`）、`src/modules/tools.ts:881-886` / `:934-936`。


**② 改什么**：在 `dispatchPlan` 内、`writeWorkPlan` **之前**，用 `normalized.tracks` 的每个 `taskId` 跑一次 `pipelineDispatchProblems`（与单目标**同一函数**）；任一轨不通过 ⇒ **整单拒绝，且不落盘**。

**③ 具体改法**：

第一步：把判据做成可注入的依赖（`orchestrator` 不能直接 import tools 的闭包，本仓已有「注入而不是直接 import」的注释 `:8640`）：

~~~ts
// src/modules/orchestrator.ts · HobOrchestratorDeps（与 acceptanceGateFor 同一注入面）
/** 逐轨任务链门禁：返回 undefined = 通过；返回字符串 = 拒绝理由（不抛异常）。 */
taskChainGateOf?: (exec: any, taskId: string) => string | undefined
~~~

第二步：接在 `planConflictProblems` **之后**、`firstWave` **之前**：

~~~ts
// orchestrator.ts · dispatchPlan 内，:4774 之后插入
/**
 * 多轨门禁（R-28）：必须在 writeWorkPlan 之前跑。
 *   用 normalized.tracks（已校验过的轨道），不是 rawTracks。
 *   不在这里自己判 v3/审批：那是 pipelineDispatchProblems 的职责。
 */
const blockedTracks = normalized.tracks
  .map((t) => ({ taskId: String(t.taskId ?? '').trim(), why: deps.taskChainGateOf?.(exec, String(t.taskId ?? '').trim()) }))
  .filter((x) => x.why !== undefined)
if (blockedTracks.length > 0) {
  return {
    ok: false, accepted: 0,
    tracks: normalized.tracks.map((t) => ({
      trackId: t.trackId, sessionId: t.sessionId, ok: false, state: 'blocked' as const,
    })),
    problems: blockedTracks.map((x) => ({ code: 'task-chain-gate', message: x.why! })),
    note: '多轨门禁未通过 ⇒ 本次计划未落盘、没有任何轨道被派出。',
  }
}
~~~

第三步：注入点（`src/preset/tools.ts:2164-2172` 已是同一处注入面）：

~~~ts
const { dispatch, status, control } = createOrchTools(orch,
  (exec, scope) => proceedGateFor(exec?.agent ?? exec) ?? stageGateFor(exec, scope),
  workModeFor, acceptanceGateFor, lifecycleForExec, ledgerProjectionOf,
  /** 新增：逐轨任务链门禁，与单目标同源（同一 dispatchGateAtLedger 的 task 分支）。 */
  (exec: any, taskId: string) => {
    const root = ledgerRootFor(exec)
    if (root === undefined) return '任务链门禁判不出：无法确定账本目录 ⇒ 本次不派单。'
    return dispatchGateAt(root, { taskId })
  },
)
~~~

**④ 依赖与冲突**：

| 关系 | 说明 |
|---|---|
| **必须与 R-05 同批（L-B）** | R-05 把 G3 接进 `pipelineDispatchProblems`，但只有本节让多轨真正**调用**它；只做 R-05 = 攻击面不变 |
| **与 T-03 相关** | `dispatchPlan` 内已有两处「判不出 ledgerRoot ⇒ invalid-join」（`:4761-4767`），本节判据在其后 ⇒ 不重复判 |
| **失败如何回滚** | **本方案不需要回滚**：门禁在 `writeWorkPlan` 之前，失败时**盘上零写入**。这正是选 A 不选 B 的理由（D-5 已裁定：B 会污染 `active/` 且与 `duplicate-plan` 冲突） |
| **与 dispatch 幂等** | 门禁拒绝时**不登记** watch / RUN（与单目标路径 `:8841-8849` 的「本次没有登记回传」同形） |

**⑤ 验证方式 + 负向对拍**：

~~~bash
node /tmp/fix_probe_r28.mjs
# 夹具：tracks=[{taskId:'TSK-UNAPPROVED'}]，其父 change 未获 G2 批准
# 期望：ok:false、problems[0].code === 'task-chain-gate'、盘上无该 planId 的计划文件
~~~

- **负向对拍 1**：把注入的 `taskChainGateOf` 换成 `() => undefined` ⇒ 断言必须红。
- **负向对拍 2（顺序断言）**：把该段**移到** `writeWorkPlan` 之后 ⇒ 断言「盘上无计划文件」必须红（**专锁顺序**）。
- **负向对拍 3（防误伤）**：全部轨道合规 ⇒ 必须 `ok:true` 且计划文件存在。

**⑥ 回退方式**：删掉注入参数与那段 if。**盘上无残留**（拒绝时零写入）。

**⑦ 改动面等级**：**跨模块**（`orchestrator.ts` + `src/preset/tools.ts`）。

### 6.3 这条修完之后，REVIEW.md 里哪几条连带消掉

| 连带项 | 原因 |
|---|---|
| **R-28**（本条） | — |
| **D-5** | §7.4 的 D-5 由本条落地为 A |
| **R-05**（前提） | 两条合并后「多轨不再能绕过任务链」 |
| **O-35**（部分） | 多轨曾能把任意任务推去执行；门禁后该路径收窄（但 `hob_orch_control` 仍是另一条，见 §8） |

---
