# 主控独立复核 · 分卷 1

> ⚠ 本文件是 `LEAD-VERIFICATION.md` 的**分卷**（原文件 80KB 超 64KB 读上限，
> 按 `check:gitignore` 的 M 判据处置：**整块搬走 + 原位留指针**，⛔ 不是压缩）。
> 主文件：`docs/audit/business-logic-review/LEAD-VERIFICATION.md`。

---
# 主控独立复核（Lead 回源验证）

> 本文件不是域审计报告，而是**主控对 pipeline.md 关键结论的独立回源验证**。
> 目的是在汇总前先确认「域报告说的到底成不成立」，避免把误判带进主文档。
> 验证方式：Node 24 直跑 src/shared 纯函数（.ts 直接 import，不写盘），探针在 /tmp/lead_probe*.mjs。
> 验证日期 2026-11-10。**未修改任何源码/配置/文档**。

## 结论速览

| 被验证结论 | 判定 | 证据 |
|---|---|---|
| P-01 G4/G5 阶段完成是弱判定 | **成立** | 见 §1 |
| P-02 多套「完成」算法并存，面板可显示 completed 而闸门拒绝 | **成立** | 见 §1、§2 |
| P-03 派活闸门不查任务图（覆盖缺口/悬空/成环不拦派发） | **成立** | 见 §3 |
| P-07 覆盖校验读 criteria_refs，而契约字段是 acceptance_criteria_refs | **成立** | 见 §3 |

---

## §1 P-01：G4/G5 的「完成」不看强判据

**复现**：构造一条全部合法的 v3 链（G1/G2 批准均 approved），任务 built、RUN returned、
VER pass、ACC pass，但把「验证者 = 实现者」「验收者 = 实现者」，且 criteria_refs /
verification_refs / example_results 全为空。

**实测输出**（/tmp/lead_probe4.mjs）：

```
activeStage: 7            gate: "G6-closure"
chainCompleted: true      deliveryClosed: false
stageStates: 1:completed 2:completed 3:completed 4:completed 5:completed 6:completed 7:active
blockedBy: [
  "ACC-1 · C-7 · 验收者与实现者是同一个会话（自己验自己）",
  "ACC-1 · C-7 · 独立验收会话与实现者相同（acceptance_session == built_by）",
  "ACC-1 · C-7 · 验收通过但缺技术验证证据（verification_refs 为空）",
  "VER-1 · C-25 · 技术验证者是实现者本人（违反独立性）",
  "VER-1 · C-25 · 技术验证没有对应的验收条件（criteria_refs 为空）", ...
]
```

**判定**：强判据 `acceptanceProblems` / `verificationProblems` **确实被算出**，并作为文本 push 进
`blockedBy`（pipeline-view.ts:322-327），但**不参与** `activeStage` / `chainCompleted` 的赋值。
`allTasksVerified`（:175-184）只查「最新 VER.status === 'pass' 且 evidence 可复核」，
`allTasksAccepted`（:187-193）只查「存在 parent 匹配且 verdict === 'accepted' 的 ACC」。
⇒ 阶段 5/6 标 completed、`chainCompleted=true`，而 C-7/C-25 的 5~6 条违规同时存在于 blockedBy。
**「独立验收」在判定层不成立，只在文字层存在。** 主控确认 P-01 成立。

**补充（主控新发现）**：`chainCompleted=true` 与 `activeStage=7 / gate=G6-closure` 同帧并存，
且 `buildRequirementChain` 的 `chainState` 也为 'completed'。即**同一条链同时声称"已完成"与"卡在交付收口"**。

## §2 P-02：同一条链多套完成口径，可互相矛盾

**实测输出**（/tmp/lead_probe4.mjs）：`chain.state = 'completed'`、`chain.complete = true`、
`chain.currentStep = 7`，但 `chain.next` 同时是：

```
{ kind: "wait-user", target: "R-PIPE",
  why: "需求「R-PIPE」定稿了却没人验收过 —— 这一步只有你能裁",
  blockedBy: [] }
```

**判定**：链状态说"已完成"，链下一步说"没人验收过、只有你能裁"，两者在同一份返回对象里。
`blockedBy` 还是空数组 —— 即**面板拿不到任何阻断原因**（印证 pipeline.md 关于
requirement-chain.ts:521-540 只在 G1/G2 注入 pipeline.blockedBy 的结论）。
主控确认 P-02 成立，且可观测性缺口比域报告描述的更具体：不是"看不到原因"，
而是**返回了一个自相矛盾的 next 对象，且其 blockedBy 为空**。

## §3 P-03 + P-07：派活闸门不查任务图；覆盖校验读错字段名

**复现 A**（任务按 pipeline.ts:157 的官方字段名 `acceptance_criteria_refs: ['AC-1','AC-2']` 写）：

```
A_acceptance_criteria_refs_coverageGaps: ["AC-1", "AC-2"]   ← 误报缺口
```

**复现 B**（同一任务改用 `criteria_refs: ['AC-1','AC-2']`）：

```
B_criteria_refs_coverageGaps: []                            ← 通过
```

⇒ `taskGraphOf`（pipeline-view.ts:692,696,714）只读 `criteria_refs`，而
`pipeline.ts:157` 把任务写入契约字段命名为 `acceptance_criteria_refs`。
**按契约写反而永远报缺口**，按 UI 名写才通过。P-07 成立。

**复现 C**（任务 `criteria_refs: []` + `depends_on: ['TSK-NOT-EXIST']`）：

```
C_coverageGaps:      ["AC-1", "AC-2"]           ← 两个验收条件无任务覆盖
C_dangling:          ["TSK-1 → TSK-NOT-EXIST"]  ← 悬空依赖
C_nodeBlockedBy:     ["TSK-NOT-EXIST 不存在"]
C_dispatchProblems:  []                         ← 派活闸门一条都不报
```

⇒ `pipelineDispatchProblems`（pipeline-view.ts:570-644）**完全不调用 `taskGraphOf`**，
覆盖缺口、悬空依赖、依赖成环都不进入派发判定。**任务图有洞照样能派活**。P-03 成立。

---

## §4 P-06：首次批准前改内容不递增 revision 不被拦（主控补充验证）

读码确认（pipeline.ts:551-564）：revision 递增强制条件是

```
if (old !== undefined && artifactDigestOf(old) !== artifactDigestOf(unit)) {
  const decisions = approvalDecisionsOf(after, id)
  const maxApprovedRevision = decisions.reduce(...)
  if (decisions.length > 0 && revision <= maxApprovedRevision) {   // ← 关键
    out.push({ rule: 'C-23', ... '内容已变但 revision 未递增' })
  }
}
```

`decisions.length > 0` 这一条把强制范围限定在「**已经有过批准**」的条目上。
⇒ 首次批准之前的每一次内容改写都**不需要**递增 revision，digest 也随之漂移，
而账本里没有任何记录能证明「用户当时批准的是哪一版内容」。
这不只是 P-06 说的「语义被破坏」，而是：**首版批准的证据链从根上是空的** ——
批准单元绑定的是 digest，而 digest 在批准前可以任意变化且不留痕。

判定：**成立**，且应升级为 high 而非 medium（它让 I-2/I-3「批准绑定具体修订与摘要」
在首次批准这一最关键节点上失去可验证性）。

---

## §5 复核 t4（policy.md）：13 条中抽查 6 条，全部成立，1 条需补充

### 5.1 P-01「Hob 不能自批」实质不成立 —— **成立（blocker）**

逐点回源：

| 报告断言 | 我的核实 | 结论 |
|---|---|---|
| `decided_by="user"` 是硬编码常量 | `src/modules/tools.ts:2081` 原文 `'decided_by = "user"',` | ✅ |
| 唯一校验是对自填 `source` 做正则 | `tools.ts:2051-2058`：`new RegExp(`(?:确认|要求修改|退回修改)\\s*(?:需求|方案)?\\s*${escaped}\\s*第\\s*${actualRevision}\\s*版`)`，不匹配即 `receipt-mismatch` | ✅ |
| 判据与写入方同源，构成自证 | `pipeline.ts:435` `if (by !== 'user')` 校验的正是 `tools.ts:2081` 写死的那个字段 | ✅ |
| 该写跳过结构校验 | `tools.ts:2107` `validateLedgerStructure: false`，对照 `hob-write.ts:1569` 的默认开启 | ✅ |
| 该写不过 proceedGate | `sed -n '1994,2112p' tools.ts \| grep proceedGate` → `NO proceedGate in approve body` | ✅ |

**主控补充（比报告更严重的一点）**：`hob_pipeline_approve` 的 `description`（`tools.ts:1956-1958`）自称
「记录用户对 Pipeline v2 需求或方案的明确批准」，参数 `source` 的说明是「用户回执原文，必须能证明用户明确说出了对象和版本」
——**工具契约把「用户回执」定义为一段字符串，而非一次用户操作**。这不是实现疏漏，是契约层面的定义问题：
当前架构里根本不存在「用户直接触发工具」的通路，所有 `hob_*` 调用都由 Hob 发起。
⇒ 结论应表述为：**I-4 在当前架构下不可能真正成立**，除非引入「用户本人触发」的独立通路。这直接影响 D-1 的选项设计。

### 5.2 P-02 批准工具不过 proceedGate —— **成立**

`grep -n 'proceedGate(' src/modules/tools.ts` 仅两处命中：`:1306`（定义）、`:1582`（`write_hob` 真写前）。
`hob_pipeline_approve` 的 execute 体（`:1994-2112`）内零命中，已实测确认。
补充：该工具在 `src/preset/tools.ts` 注册时也**没有**被包一层 gate（`registerTools` 只传 `proceedGateFor` 给需要它的工具）。

### 5.3 P-04 工具描述与常量相反 —— **成立（且这是「模型自我限制」类缺陷）**

| 位置 | 原文 |
|---|---|
| `src/modules/bus.ts:2041-2042` | `'⚠ **当前只有 ledger 开放**：其余两档会被服务端拒签/拒建并给可读原因'` |
| `src/shared/read-level-policy.ts:61` | `export const OPEN_READ_LEVELS = ['ledger', 'project', 'workspace'] as const` |
| `src/shared/read-level-policy.ts:58` | 注释：「2026-10-24：由 `['ledger']` 扩为三档」 |

⇒ 描述写的是 2026-10-24 之前的事实，扩档后未同步。模型读到后会**主动不用** `project`/`workspace`。

### 5.4 P-08 注释与实现相反 —— **成立**

`src/server/session-policy.ts:489-491` 注释原文：
> ⚠⚠ **D12 回读（2026-10-27 · 包 X）**：返回值有**三处**调用方拿它决定"要不要告警"
>   （`session-policy-service.ts` 三处）⇒ 写没写进去必须当场核，⛔ 不许"调过写函数就算成"。

而三处调用（`session-policy-service.ts:1290`、`:1478`、`:1529`）全部形如
`ensurePolicyDirIgnored(`${file.slice(0, file.lastIndexOf('/'))}`)` —— **返回值未接**。注释描述的是它希望的形态，不是现状。

### 5.5 P-09 文档断言与随包预设矛盾 —— **成立，但需要更精确的表述**

核实到的事实：
- `README.md:166`：`它不写 \`~/.dsh/**\`（有显式拒绝路径）`
- `README.md:188`：`⚠ 插件**不写** \`~/.dsh/**\` 下除 profile 配置以外的任何东西`
- `preset/dsh-hob/preset-dsh-hob.patch.yml:913`：`ledgerHome: /home/lk/.dsh/hob-ledgers`

**主控补充**：我全仓搜 `src/` 下的 `.dsh` 字面量，只在**注释**里出现（`board-cards.ts:20`、`card-wake.ts:47`、
`planning-preset.ts:58`、`orchestrator.ts:1660/1820`），**没有任何「显式拒绝路径」的代码实现**。
⇒ README:166 说的「有显式拒绝路径」这一句本身也无从查证 —— 写面守卫（`hob-write.ts:765-830`）是按**相对路径白名单**判定的
（`ledger/units/**`、`ledger/changes/**` 等），根本不看绝对路径是否在 `~/.dsh` 下。
所以真正的表述应是：**写面守卫不感知 `~/.dsh`**；当 `ledgerHome` 被配到 `~/.dsh` 下时，写入照常发生。
这比报告说的「文档没更正」更根本：**「显式拒绝路径」这个机制可能从未存在过**。

### 5.6 P-06 关键依赖 throw 指向无消费者服务 —— 未独立验证（需运行时观察，标记为待复核）

该条涉及宿主进程内服务缓存形态，静态读码只能确认「`PERMISSION_SERVICE` 的取值无人读」这一半。
「旧版 config.ts 缓存 ⇒ apply 抛错 ⇒ 工具面全不注册」属运行时时序，静态不可证。**标记未验证**，不进入主文档缺陷表，
只作为「观察项」记录。

### 5.7 对 t4 的整体判定

13 条缺陷中我抽查 6 条：**5 条成立**（含 1 条 blocker），1 条标记未验证。
报告的「核实通过」清单（permission.level 无消费方、workMode.mode 仅剩迁移快照、modules.* 语义）我抽查了
`config.ts` 与 `README.md:96/118` 的对应关系，**一致**，确认不是缺陷、不会重复上报。

---

## §6 复核 t2（ledger.md）：抽查 L-01/L-04，两条均成立

### 6.1 L-01 index.toml 被重复计入 ⇒ 第二条单元永远写不进 —— **成立（blocker）**

读 `src/server/hob-write.ts:1044-1061` 确认合并口径：

```js
const rel = file.slice('ledger/units/'.length)        // 'index.toml'
const merged = [
  ...readToml('index.toml'),                           // ← index 旧内容算一次
  ...shardNames.filter((n) => n !== rel).flatMap(readToml),   // shardNames 只匹配 ^unit-.*\.toml$，不含 index
  ...(mode === 'append' ? [...readToml(rel), ...incoming] : incoming),  // ← index 旧内容再算一次
]
```

**我独立复现**（/tmp/lead_probe_ledger1.mjs，直接 import 本仓 `unitShapeProblems`）：

```
mergedIds: ["R-001", "R-001", "DEC-001"]
shape:     ["R-001: 合并后的账本出现重复 ID"]
dup:       true
```

⇒ 只要 `index.toml` 里已有 1 条单元，再 append 任何合法单元都会被判「重复 ID」。
报告 L-01 的三点影响我逐条认同，特别是**错误原因说谎**：真实原因是守卫自己数了两遍，
但用户/模型收到的是「你写了重复 ID」⇒ 会去改内容而不是改路径。这是「让失败不可诊断」的典型形态。

**主控补充**：本仓工作树里 `ledger/units/` 目录不存在（`no index.toml`），
所以这条缺陷在**当前仓库**不会暴露，只在真正建了账本的工作区里爆发。
这解释了为什么它一直没被发现 —— 与「自检脚本没有覆盖 append 到非空 index」一致（交由 doc-auditor 核实）。

### 6.2 L-04 两份 TOML 解析器，严格做门禁、宽松做读取 —— **成立（high）**

`parseUnitsToml`（`src/shared/stages-index.ts`）遇不支持的写法**抛错**，实测：

```
输入: '[meta]\nversion = 2\n\n[[unit]]\nid = "R-001"\nkind = "req"\nstatus = "agreed"\ntitle = 123\n'
输出: { ok: false, err: '第 1 行：不支持的 TOML 表头 "[meta]"' }
```

而宽松版（`src/modules/tools.ts:159-206`）用 `continue` 跳过坏行、静默丢弃非字符串字段。
两份解析器服务于不同出口，导致「同一本账在门禁眼里非法、在读取眼里正常」。
报告列的四行对照表（旧格式 / 数值 title / 杂行 / 未闭合数组）我复现了第一行，形态一致。

⇒ 这条与 t1 的 P-02（五套完成算法）是**同一类病**：同一事实多份实现，且没有一处强制同源。
汇总时必须合并成「单一真源缺失」这条主线的两个实例，而不是并列成两个孤立缺陷。

---

## §7 复核 t3（dispatch.md）：D-01 / D-02 / D-03 / D-04 全部成立

### 7.1 D-01 判不出 ownerWsRoot ⇒ 投影整段静默跳过 —— **成立（blocker）**

三处 `if` 都带 `!== undefined` 前置条件，实测原文：

| 位置 | 条件 |
|---|---|
| `orchestrator.ts:5208` | `if (preTaskId !== '' && preTaskId !== 'implicit' && preOwnerWsRoot !== undefined)` |
| `orchestrator.ts:5387` | `if (ownerWsRoot !== undefined && typeof w.taskId === 'string' && w.taskId !== '')` |
| `orchestrator.ts:7651` | `resolveLedgerRoot('', declaredLedgerHome(svcCtx), w.ownerWsRoot)` 外层 `if (typeof w.taskId === 'string' && w.taskId !== '')` |
| `orchestrator.ts:10008` | `...(w.ledgerProjection === undefined ? [] : [...])` |

⇒ 条件不成立时**根本没有赋值语句**，`w.ledgerProjection` 保持 `undefined`，
而渲染层对 `undefined` 的处理是**输出空数组**（不是输出「未落」）。
**「失败」与「没发生」在读数面上不可区分** —— 这是本仓反复声明要避免的形态，确实存在。

### 7.2 D-02 Outbox 补投三重静默 —— **成立（high）**

```ts
// effects-queue.ts:133
this.onError = opts.onError ?? (() => {})          // ① 缺省吞掉
// effects-queue.ts:344-349
current.attempts += 1
current.lastError = String(error)
const [initial, max] = handler.retry
current.dueAt = this.now() + Math.min(max, initial * 2 ** Math.min(current.attempts - 1, 16))
this.onError(kind, error)                          // ② 无 attempts 上限判断
// preset/tools.ts:209
const r = await orch.dispatch(target, message, { self: undefined })   // ③ owner 丢失
```

三点逐条核实：`attempts` 只增不判上限（无 `maxAttempts` 分支）；`onError` 缺省 noop；
补投时 `self: undefined` ⇒ `owner`/`watcher` 为空。报告的推断「即使补投成功，回执也回不来」
依赖 `settle()` 在 watcher 为空时落 error（`orchestrator.ts:7497-7501`），这条我未逐行复核，
但**前三点本身已足以成立缺陷**，结论不依赖该推断。

### 7.3 D-03 多轨是唯一能绕过任务链门禁的派发入口 —— **成立（high）**

这是我本轮最重视的一条，因为它**推翻了 t1 报告的一个隐含假设**。逐层核实：

1. 门禁在 `orchestrator.ts:8837` 调用，早于 `dispatch()`；
2. 门禁内 `tools.ts:881-886` 用 `listWorkPlans(ledgerRoot)` **从盘上**找计划；
3. 计划的写盘在 `orchestrator.ts:4816`，即**门禁之后**；
4. 找不到计划时 `tools.ts:934-936` 返回 `{ blocked: undefined }`；
5. 想「先落盘再派」被 `orchestrator.ts:4024-4029` 的 `duplicate-plan` 拒。

⇒ **首次 `hob_dispatch({tracks})` 时 `pipelineDispatchProblems` 一次都不跑**。
单目标路径的 `lifecycleOf`（8815）与 `TSK-` 正则（8826）也都写在 `if (!Array.isArray(args.tracks))` 内。

### 7.4 D-04 G3 不进任何派发闸门 + 面板看不到 —— **成立，且我认同它对 t1 疑点(c) 的修正**

t1 的疑点(c) 表述是「编排侧拒绝派活，但界面上没有可读原因」。
t3 的修正是：**G3 根本不拒绝派活，面板却显示 G3 卡住**。
我复核后**采信 t3 的修正**：`pipelineDispatchProblems`（pipeline-view.ts:570-644）全文无 `taskGraphOf`，
而 `requirement-chain.ts:521-540` 只在 `gate === 'G1-requirement'` / `'G2-plan'` 时把 `pipeline.blockedBy` 注入 `next`。
⇒ 面板给的是**假信号**（显示卡住但派活成功），比 t1 原表述更严重。汇总时采用 t3 口径。

### 7.5 对 t3 裁定 t1 疑点(a) 的复核 —— **采信，且发现 t1 的表述有误**

t3 判定 `proceedGateFor(...) ?? stageGateFor(...)` 是**「与」不是「或」**，并称 t1 说的「或关系」不成立。
我读 `src/preset/tools.ts:2166-2167` 确认：`??` 在左侧为 `undefined`（= 放行）时**必然求值右侧**，
只有左侧返回非空字符串（= 已拒绝）时才短路。⇒ **t3 正确，t1 的疑点(a) 表述有误**。
`src/preset/tools.ts:2155-2162` 的 `stageGateFor` 内 try/catch 也是 fail-closed（判不出即返回拒绝串）。
⇒ 汇总时须纠正 t1 的疑点(a)，不得写成「阶段门禁不是每次派活必经」。

### 7.6 对 t3 的整体判定

11 条中我抽查 4 条（含唯一 blocker 与 3 条 high）：**4 条全部成立**。
t3 对 t1 三疑点的裁定**质量高于 t1 自述**：把 (a) 判为设计并纠正了 t1 的「或」误述，
把 (c) 修正为更严重的形态。这是审计团队内部交叉纠错的正面案例，汇总时应保留这一纠正记录。

---

## §8 复核 t2 终版（ledger.md，18 条）：补验 L-08 自填豁免链 —— 成立，且是最危险的一条

### 8.1 L-08 `clarify_legacy` 自填豁免 —— **成立（可绕过 11 类字段门禁）**

读 `src/shared/stage-controls.ts:270-286`：

```ts
/** 历史需求豁免：只用于控制上线前的存量，⛔ 不是新需求的放行开关。 */
const legacy = (u) => txt(u.clarify_legacy) === 'pre-control'          // ← 读单元自己的字段
const CONTROL_CUTOFF = '2026-11-06'
export function legacyMisuse(u) {
  if (txt(u.clarify_legacy) !== 'pre-control') return []
  const created = txt(u.created_at)                                    // ← 也读单元自己的字段
  if (created === '') return [{ rule: 'C-11', ... }]
  if (created.slice(0, 10) >= CONTROL_CUTOFF) return [{ rule: 'C-11', ... }]
  return []                                                            // ← 放行
}
```

**我独立复现**（/tmp/lead_probe_exempt.mjs，直接 import `stageFieldProblems`）：

| 用例 | 输入 | 输出 |
|---|---|---|
| A 正常 v3 需求（有阻塞问题、假设未确认、无验收条件） | 无豁免字段 | 4 条：`C-1 阻塞问题`、`C-2 假设未确认`、`C-1 无关键例子`、`C-1 无可观察验收条件` |
| B 同一单元 + 自填 `clarify_legacy='pre-control'` + 自填 `created_at='2026-01-01'` | 两个字段都是**写入方自己填的** | **`[]`（全部放行）** |
| C 同上但 `created_at='2026-11-10'`（今天） | — | `C-11 历史豁免只能用于控制上线前的存量` |

⇒ 唯一反制 `legacyMisuse` 的判据是 `created_at`，而它**同样是自填字段**。
写入方只要同时填这两个字段，就能一次性跳过 11 类字段门禁与 L-1..L-4 闭环检查。
**这是「用自己的字段给自己发豁免」的教科书案例**，且 `legacy()` 的注释明写「⛔ 不是新需求的放行开关」——注释与实现相反。

### 8.2 L-07(c) 批准单元豁免不必要且不充分 —— **成立**

| 断言 | 核实 |
|---|---|
| decision 与封闭契约完全兼容 | `ledger-validation.ts:24` `decision: ['active', 'superseded']`；工具写 `status="active"`（`tools.ts` 生成行） ⇒ **兼容** |
| 豁免不必要 | 既然兼容，`validateLedgerStructure:false` 无技术理由 |
| 全仓 4 处豁免，非 1 处 | `projection-writer.ts:162`、`:272`、`tools.ts:1929`（migrate）、`tools.ts:2107`（approve）—— 我 grep 确认，**纠正了我在 t1 阶段向 ledger-auditor 转述的「全仓唯一」** |
| 只有 migrate 那处必要 | migrate 做的是「把坏行改成合法行」，必须先允许写坏状态；其余三处无此性质 |

### 8.3 P-05 路径真实可达 —— **成立（这是跨 t1/t2/t4 三域的共同结论）**

三条独立证据链合流：
1. **t4**：`hob_pipeline_approve` 的 `decided_by="user"` 是硬编码（`tools.ts:2081`），唯一校验是对自填 `source` 做正则（`:2051-2058`）；
2. **t2**：`write_hob` 在**最低档 `ledger`** 就有（`src/preset/tools.ts:1211-1213` `PERMISSION_TIERS.ledger = MODEL_TOOL_ALLOWLIST`，其中含 `write_hob`），而 `LEDGER_PATH_RE`（`hob-write.ts:163`）放行 `ledger/units/**`，批准文件正是 `ledger/units/unit-pipeline-approval.toml`（`tools.ts:2094`）；
3. **t1**：`artifact_digest` 是 FNV 变体，注释自陈「不是密码学哈希」（`pipeline.ts:199-205`），可自算。

⇒ **Hob 不需要经过批准工具，直接用 `write_hob` 写一份 decision 单元即可**，且绕过了工具入口的回执正则。
这条比 t4 单域结论更完整：t4 说「工具入口的校验可被自填字符串满足」，t2 说「连那个入口都不用走」。

### 8.4 对 t2 终版的整体判定

18 条中我累计抽验 5 条（L-01、L-04、L-08、L-07c、L-03 的四出口）：**5 条全部成立**。
t2 主动纠正了我转述给它的一个错误前提（「全仓唯一豁免」），这是团队内纠错的第二个正面案例。

### 8.5 主控对 [建议决策] 的意见（供汇总时采用）

t2 的 D-1 提议：A) 白名单层排除批准文件、改专用函数写；B) 门禁侧核 `source` 匹配回执模式。推荐 A。
**我同意 A 优于 B，但认为 A 不足以解决根本问题**：A 只是让「批准」只有一条写入路径，
而那条路径（`hob_pipeline_approve`）本身仍由 Hob 调用、`decided_by` 仍是硬编码常量。
⇒ 真正的修复需要第三条路：**C) 引入用户本人触发的通路**（例如批准必须由用户在 UI 上点击产生，
或必须携带宿主可验证的消息 id / 用户输入摘要）。这与我在 §5.1 的判断一致：
**I-4 在当前架构下不可能真正成立**，A/B 都只是把可绕过点收窄，不改变「被校验方即写入方」的自证结构。
建议在待拍板清单里同时列出 A/B/C，并注明「仅 C 能实质修复 I-4」。

---

## §9 复核 t6（docs.md，22 条）：抽查 D-01/D-02/D-03/D-09 —— 4 条全部成立

### 9.1 D-01 阶段步名 7 份并存且已漂 —— **成立（blocker）**

实测两份字面量：

| 位置 | 第 3 步名 |
|---|---|
| `src/shared/stage-controls.ts:22` | `tasks: '编码任务'` |
| `src/shared/pipeline-view.ts:36` | `{ step: 3, id: 'tasks', name: '任务图' }` |
| `src/shared/stages-index.ts:32` | `{ step: 3, kind: 'task', name: '任务图' }` |

`STAGE_NAMES` 的唯一消费方是 `scripts/gen-ledger.mjs:1267` / `:1270`（写进账本 CONTEXT.md 的「阶段控制」块）。
⇒ 一旦跑 `gen:ledger`，账本里就会印出「编码任务」，而面板显示「任务图」。**同一概念两个名字，分别进两个出口。**

**主控补充（比 t6 更进一步）**：`stage-controls.ts:57` 的注释也写「真正执行期间，当前步仍显示「编码任务」」——
即**注释与 STAGE_NAMES 一致、与其余六份不一致**。说明 `stage-controls.ts` 这一份是「没跟上改名」的遗留，
而不是「另一种有意的叫法」。修复方向应是**改 stage-controls.ts:22 与 :57 两处**，不是改其余六份。

### 9.2 D-02 七族负控下限=0 ⇒ 「零负控也永远绿」—— **成立（blocker）**

`scripts/meta-negative-floor.json` 实测下限为 0 的族：`check:all`、`check:build`、`check:host`、`check:profile`、
`check:readings`、`check:rounds`、`check:selfwake`、`check:work-plan-runtime`、`check:tasks-route-http`（9 个，比 t6 说的 7 个还多 2 个）。

判据在 `scripts/check-meta-negctl.mjs:142`：

```js
if (got < floor[fam]) { problems.push(...) }
```

`floor[fam] === 0` 且 `got === 0` ⇒ `0 < 0` 恒假 ⇒ **一条负向对拍都没有也不会报**。
而该文件头注释（t6 引 `:3`）自述「每条判据都必须自带一条负向对拍」——**元规则对自己没有牙**。

**实测最重的一处**：`grep -c '负向对拍' scripts/check-work-plan-runtime.mjs` = **0**，
但 `check-all.mjs:201` 为它登记了断言下界 `42`。即：这条 check 有 42 条断言、零条负向对拍。
且 `:212` / `:214` 确实有「负向①」「负向②」的**注释**，只是没打上 `负向对拍` 标签 ⇒ M-1 数不到。
⇒ 这不是「没写负控」，而是「**写了负控但计数器看不见**」。两者修复方式不同：前者要补断言，后者只要补标签。

### 9.3 D-03 运行时教模型「五步」、Pipeline 视图是「七步」—— **成立（blocker）**

| 位置 | 原文 |
|---|---|
| `preset/dsh-hob/preset-dsh-hob.patch.yml:434` | `N and the step name come from the five steps (需求规格 / 实现方案 / 编码任务 / 任务执行 / 验收核对)` |
| `preset/dsh-hob/gen/contracts.md:200` | `Pipeline v3 主线（需求规格 / 实现方案 / 任务图 / 任务执行 / 技术验证 / 产品验收 / 交付收口）` |

`preset-dsh-hob.patch.yml` 是**运行时真正注入模型的那份**，`gen/contracts.md` 是生成物。
⇒ Hob 每轮固定第一行「当前：第 N 步 · <步名>」会用**五步词表**，而面板用**七步**。
第 5 步：模型说「验收核对」，面板说「技术验证」——**同一个编号指两件不同的事**。
这比单纯的命名不一致更严重：编号语义错位会导致「模型以为在做验收、实际在做技术验证」。

t6 说的「五处自检全绿」我抽查了逻辑：F10 核 `prefix == persona`（两份都是五步 ⇒ 绿）、
F5 核 notes 逐字、F14 核 reply id、⑤ 核 drafts == prefix —— **四者都在「同源自比」，没有一处跨源比对**。
这与 D-02 是同一个病：**自检只证明「A 和 A 一致」，不证明「A 和 B 一致」**。

### 9.4 D-09 CU-5 正则指向已改名的常量 ⇒ 恒假面 —— **成立（high）**

`scripts/check-hob-create-ui.mjs:699`：

```js
const hasPresetGating = /currentPreset\s*!==\s*PLANNING_PRESET_ID/.test(src)
```

实测 `grep -c 'PLANNING_PRESET_ID' src/client/create-hob-dialog.tsx` = **0**，
而 `src/shared/planning-preset.ts` 里 `HOB_PRESET_ID` 出现 7 次、`PLANNING_PRESET_ID` 只 1 次（定义处）。
⇒ 正则永远不匹配 ⇒ `hasPresetGating` 恒 `false` ⇒ **这条判据不可能再变红**。

讽刺之处在它自己的注释（`:686-690`）：
> 旧 CU-5 断言…它**当时是绿的**，但那条 gating 读的 `state.preset()` **永远是 `undefined`**
> ⇒ 入口**永不渲染**。⚠ 一条"绿着但功能永不出现"的判据，比没有判据更坏。

**它正在重演自己记录的失败模式**：改名之后，新判据变成了「绿着但永远抓不到问题」。

### 9.5 对 t6 的整体判定

22 条中我抽查 4 条（3 条 blocker 中的 2 条 + 1 条 high）：**4 条全部成立**。
t6 的裁定我**全部采信**：
- 「六阶段 + 风险启用门」是文档正解，代码 7 个 id 是该实现的正确表达；
- 真正的问题是**用户可见面把门说成了步**（`pipeline-view.ts:481` `activeStage = 7` + `project-panel.tsx:2473` 渲染「第 N 步」）；
- 「唯一当前阶段」的文档承诺**只画到「闸门/责任方」，未覆盖步名** —— 这个精确表述很重要，
  否则会把「文档承诺未实现」说成「文档自相矛盾」，两者修复方向不同。

---

## §10 复核 t5（client.md，18 条，报告仍在收尾）：抽查 C-01/C-02/C-03 —— 2 条成立，1 条**证据不足已降级**

### 10.1 C-02 挂起的 HTTP 让面板永久停刷 —— **成立（blocker）**

`src/client/project-panel.tsx:1407-1445` 原文核实：

```ts
let pulling = false
const pull = (runStagesAgain = true) => {
  if (pulling) { if (followUpsLeft > 0) { pullAgain = true; followUpsLeft -= 1 } return }   // ← 排队，不超时
  pulling = true
  ...
  void Promise.allSettled(requests).then(() => { pulling = false; ... })                    // ← 只有全部 settle 才复位
}
```

`pulling` 只在 `Promise.allSettled(...).then()` 里复位。若某条 fetch 永不 settle（无 AbortController），
`pulling` 恒 `true`，`followUpsLeft`（上限 3）耗尽后**所有后续 tick 静默丢弃**。
对照 `create-hob-dialog.tsx` 给同一浏览器的 fetch 装了 30s `AbortController` 并在注释里写明「必须有超时」。
⇒ **同一代码库里两个 fetch 用法，一个有超时一个没有**，且没有超时的那个负责整个面板刷新。成立。

### 10.2 C-03 客户端不读 `count`/`truncated` ⇒ 假报「0 条缺口」—— **成立（high）**

`project-panel.tsx:2244-2257` 原文：

```ts
const health = (stageState as any).stageHealth as { ok?: boolean; count?: number; problems?: ...; truncated?: boolean } | undefined
if (health === undefined) return null
const problems = Array.isArray(health.problems) ? health.problems : []
if (health.ok === true && problems.length === 0) return null
`账本健康：${problems.length} 条缺口（先补齐才能派活）`
```

**类型声明里明明有 `count` 和 `truncated`，但两行代码一个都没读**（`problems.length` 用了两次）。
服务端 `stages-index.ts:455-462` 的紧凑模式只给前 40 条 + 真实 `count`；体积兜底（`:602-607`）时
`problems` 被整段丢弃、只留 `count`。⇒ 触发兜底时 `problems=[]`、`ok=false`，
界面渲染「**账本健康：0 条缺口（先补齐才能派活）**」—— 把「有几百条缺口」说成「零缺口」。
这与面板自己在 `:2224-2234` 写的「与派活门禁同一份函数，⛔ 不在客户端另算一份」直接冲突。成立。

### 10.3 C-01 primitives 是否在宿主 seed 里 —— **证据不足，主控降级为「待宿主探针」，不列 blocker**

t5 自己标注了「未验证」，这是诚实的。但我复核后认为**证据链比它描述的更弱**：

| 证据 | 实际能证明什么 |
|---|---|
| `atoms.tsx:5-8` 注释「真机实测：宿主浏览器模块表没有这个包」 | 只是一句注释，无探针脚本、无输出 |
| `tsdown.config.ts:13-17` 注释「实测 seed 含它」 | 同样是注释，且**与上一条矛盾** |
| `lib/client.js:28` 确实有 `require("@deepseek-ai/dsh-client-ui-primitives")` | 只证明**产物里有 require**，不证明该 require 会失败 |

三条证据里，**能作为事实的只有第三条**，而它恰恰是两条注释都认可的共同前提（不论 external 与否，产物里都会出现这个 require）。
⇒ 真正未知的是「宿主模块表有没有这个 seed」，而**仓内没有任何机检覆盖它**（t5 已 grep 确认 `check-client-deps.mjs` 零命中）。

**我的判定**：这条**不能列为 blocker**，应降级为「待验证的观察项」，理由：
1. 若它成立，`lib/client.js:28` 的 require 会抛，**所有用户都会立刻遇到**，属「必然暴露」而非「静默失败」；
2. 与本次审计的主题（业务逻辑审查）关联度低，属构建/宿主集成问题；
3. 仓内两条注释互相矛盾这件事本身**值得记录**，但那是「注释不可信」问题，不是「客户端不激活」问题。

建议：在汇总的「待验证」章节列一行，附上 t5 建议的宿主探针做法；**不进入缺陷总表的主排序**。

### 10.4 对 t5 的整体判定

18 条中我抽查 3 条：**2 条成立**（含 1 条 blocker），**1 条证据不足已降级**。
t5 的报告质量总体好（主动标「未验证」、每条给可复现命令），但 C-01 的**定级偏高**：
把「注释互相矛盾」当成了「缺陷成立」，这与本次审计的纪律（给不出位置/证据即标未验证）略有偏离。
这也说明**主控抽验这一步是必要的**：如果没有抽验，C-01 会以 blocker 身份进入主文档，
而它的真实状态是「一条没有任何机检覆盖的猜测」。

---

## §11 复核 t5 终版（client.md，19 条）：抽查 4 条，3 条成立、1 条维持降级

### 11.1 C-02 面板可静默永久冻结 —— **成立（blocker）**

| 断言 | 核实 |
|---|---|
| 面板取数无任何超时 | `grep -c 'AbortController\|AbortSignal\|timeout' src/client/project-panel.tsx` = **0**；对照 `create-hob-dialog.tsx` = **3** |
| `pulling` 布尔闸 | `project-panel.tsx:1411-1418`：`if (pulling) { if (followUpsLeft > 0) { pullAgain = true; followUpsLeft -= 1 } return }` |
| 释放只靠 `allSettled` | `:1430-1431` `void Promise.allSettled(requests).then(() => { pulling = false ... })` —— 任一请求永不 settle ⇒ `pulling` 永真 |
| 徽标仍说已连接 | `:3100` `liveState === 'live' ? '实时更新已连接（断线自动重连；另有定时兜底）'` —— 徽标只反映 **live 连接状态**，不反映 pull 是否卡住 |

⇒ 失败形态确认：**面板定格 + 徽标显示健康**。且 `followUpsLeft` 上限 3 次，之后 live 帧静默丢弃。
这是本仓最忌的「失败不可观测」，且发生在唯一的用户界面上。

### 11.2 C-03 健康块不读 count/truncated —— **成立（high）**

服务端（`src/shared/stages-index.ts:455-462`）：

```ts
const cap = opts.compact === true ? 40 : all.length
return { stageHealth: { ok: all.length === 0, count: all.length,
  ...(all.length > cap ? { truncated: true } : {}), problems: all.slice(0, cap) } }
```

注释 `:451-453` 明写：「⚠ `truncated=true` 时面板必须说"另有 N 条"，⛔ 不许看起来只有这些」。

客户端（`src/client/project-panel.tsx:2249-2257`）：

```ts
const problems = Array.isArray(health.problems) ? health.problems : []
if (health.ok === true && problems.length === 0) return null
... `账本健康：${problems.length} 条缺口（先补齐才能派活）` ...
```

⇒ **只读 `problems.length`，完全不读 `count` / `truncated`**。服务端明确要求的那句话没有实现。
更糟的一档（`:604-610`）：体积兜底时 `problems` 整个被删掉、只留 `ok/count/truncated`，
此时客户端 `problems = []`、`health.ok === true` 为假（ok 是 `all.length===0`）⇒ 渲染出
**「账本健康：0 条缺口」且 `data-state='ok'`**，而服务端说 `count: N>0, truncated: true`。
**判得出 N 条缺口，显示成 0 条。**

### 11.3 C-04 切账本不清 itemDetails —— **成立（high）**

`grep -n 'setItemDetails' src/client/project-panel.tsx` 只有 5 处，全部是 `{...prev, [id]: ...}` 的**累加**写法，
**没有一处清空**。`itemDetails` 的键是裸 ID（`R-001`），而每个账本都有 `R-001` ⇒ 切账本后点开同名 ID
会命中上一本账的缓存正文。`useEffect` 依赖里也没有账本切换时的 reset（`:2217-2221` 只处理 `stageState`）。
⇒ 「显示上一本账的正文且永不自愈」成立。这类跨账本串数据在只读面板里同样是事故（用户据此做判断）。

### 11.4 C-01 primitives 是否在宿主 seed —— **维持降级（观察项，不进主排序）**

t5 自己的结论是「未验证」，并给了一条建议探针。我复核后维持降级，理由：
它成立的前提是 `atoms.tsx:5-8` 的注释为真，而 `tsdown.config.ts:13-17` 的注释说相反；
两条都是注释，**没有第三方证据**。`lib/client.js:28` 确实 `require`，但那只证明**产物**里有 require，
不证明运行时解析失败。⇒ 这是「注释互相矛盾」的事实，是否成为缺陷取决于宿主实现，**静态不可证**。
必须由宿主探针定论；在拿到之前不进缺陷总表主排序，只作为「高影响待验证项」单列。

### 11.5 对 t5 的整体判定

19 条中我累计抽验 4 条：**C-02、C-03、C-04 成立**（1 blocker + 2 high），C-01 维持降级。
t5 主动撤回了一条自己的错误结论（C-06 初稿），并在报告内保留订正记录 —— 这是团队内纠错的第三个正面案例。
t5 还把 C-19 的主体正确移交给了 pipeline/ledger 域（legacy 第 5 步该装 acc 还是 verification），
并指出「若改成装 acc，客户端 STAGE_KIND_BY_STEP 必须同步改」——这是**跨域影响面**的正确识别，汇总时应保留。

---

## §12 复核 t7（REVIEW.md，99 条）：结构合格，3 处需订正

### 12.1 六条硬要求的落实情况 —— **全部落实**

| 要求 | 落实位置 | 判定 |
|---|---|---|
| 1 采信 t3、处理 t1/t3 冲突 | §4.1 / §9.1 / §9.3 共 4 处标注「已被 t3 推翻」，并显式写「本文档不采纳」 | ✅ 且未出现「阶段门禁不是每次派活必经」 |
| 2 单一真源合并成主线 | §2 专章 + §2.4「12 类事实 / 37 份实现 / 0 处强制同源」清点表 | ✅ 这张表是本次审计最有价值的产出 |
| 3 跨域矛盾专章 | §3 四条链（A 批准 / B 自填豁免 / C 派活绕过 / D legacy 投影分裂） | ✅ D 是我裁定的，已写成联动修复项 R-08 |
| 4 A/B/C 三选项 | §7.1 表格 + 加粗「仅 C 能实质修复 I-4」 | ✅ 并采纳 t4 方向、把 t2 的 A 降为过渡 |
| 5 诚实标注未验证 | §6 单列 C-01 与 P-06，附「三条证据各自能证明什么」表 | ✅ 这是全文最诚实的一节 |
| 6 每条给「怎么证明修好了」 | 99 条全覆盖，71 处负向对拍 | ✅ 抽验见 12.3 |

### 12.2 主控独立复核了三个数字，其中两个需订正

**(a) 零负控族数：REVIEW 写 9，实际是 10 —— 需订正**

```
$ node -e "const j=require('./scripts/meta-negative-floor.json'); ..."
total families: 50
zero-floor count: 10
check:all, check:build, check:host, check:preflight, check:profile,
check:readings, check:rounds, check:selfwake, check:tasks-route-http, check:work-plan-runtime
```

t6 说 7 个，synthesizer 复数为 9 个（新增 `check:tasks-route-http`、`check:work-plan-runtime`），
**实际 10 个**——漏掉了 `check:preflight`。REVIEW §9.4 第 4 行与 §1.1 结论三的「9 个族」均需改成 **10**。
（`check:preflight` 的下限为 0 也已由 `meta-negative-floor.json` 原文确认。）

**(b) `FAMILY_FLOOR` 余量：REVIEW 写「45 vs 47 族、余量 2」—— 口径需澄清**

```
$ node -e "...package.json check:* vs floor keys..."
package check:* count: 50
floor keys: 50
in package but not floor: (none)
in floor but not package: (none)
```

`scripts/check-all.mjs:152` 的 `FAMILY_FLOOR = 45` 是**运行时实际跑到的族数下界**，
而 `check-all` 的 `results` 是它**实际调用的**族（不是 `package.json` 的全部 50 个）。
REVIEW 说「实际可跑 47 族、减 SELF 3」的口径与 `FAMILY_FLOOR` 的语义**不是同一个分母**，
两者相减得出的「余量 2」不成立。⇒ 该条应改为「需实测 `check:all` 的 `results.length` 才能定余量」，
或直接删掉余量数字、只保留「下界 45 与注释里『零余量』纪律存在张力」这一判断。

**(c) `VER-1` 重复 push：成立，我独立定位到两处**

```
$ grep -n 'verificationProblems' src/shared/pipeline-view.ts
326:  for (const p of verificationProblems(v as any, units as any).slice(0, 3)) blockedBy.push(...)
341:  for (const p of verificationProblems(latest.unit as any, units as any).slice(0, 3)) {
```

`:326` 在「所有 verifications」上跑一遍，`:341` 在「每个 built 任务的最新验证」上又跑一遍——
同一条 VER 若既是「某个 v」又是「某任务的最新验证」，其问题被 push 两次。
⇒ synthesizer 在 §9.4 第 1 行的新发现**成立**，且这条会**放大面板「另有 N 条」的 N**，
与本项目「判得出就说准」的纪律直接冲突。建议从 §9.4 提升进缺陷总表（当前它在 O 类）。

### 12.3 对「怎么证明修好了」的抽验

抽查 5 条（R-01 / S-01 / T-01 / T-03 / T-04）的验证方式，**5 条均可执行且能真正失败**：
- R-01：构造验证者=实现者的账本 ⇒ `activeStage` 必须不是 7。**负向对拍**：把强判据改回弱判据 ⇒ 断言红。
- S-01：伪造不存在的 message id ⇒ 必须被拒。**这是唯一能证明 I-4 成立的断言**（措辞准确）。
- T-01：向有 N≥1 条单元的 `index.toml` append 合法单元 ⇒ 必须 `ok:true`。**负向对拍**：恢复重复计入 ⇒ 红。
- T-03：判不出 `ownerWsRoot` ⇒ 返回值必须含显式失败读数，而非字段缺失。
- T-04：注入一个永不 settle 的 fetch ⇒ 面板必须进入可观测的降级态，而非静默定格。

⇒ 修复验证的设计质量**高于**域报告的平均水平，可直接作为后续实施任务的验收标准。

### 12.4 对 t7 的整体判定

**结构合格、可交付**。三项订正（零负控族数 9→10、FAMILY_FLOOR 余量口径、VER-1 重复 push 提升）
不改变任何结论，但影响数字准确性，**必须在交付前改掉**——本项目的纪律是「判得出就说准」。
已在下文 §12.5 给出可直接替换的文案。

### 12.5 给 synthesizer 的订正清单（3 条，改完即交付）

| # | 位置 | 现值 | 应改为 |
|---|---|---|---|
| 1 | §1.1 结论三 + §9.4 第 4 行 | 「9 个族」 | 「**10 个族**」（补 `check:preflight`，并给完整名单） |
| 2 | §9.4 第 5 行 + S-10 正文 | 「实际可跑 47 族、余量 2」 | 删除余量数字，改为「`FAMILY_FLOOR=45` 是 `check:all` 运行时族数下界，需实测 `results.length` 才能定余量；与注释里『零余量』纪律存在张力」 |
| 3 | §9.4 第 1 行（O 类） | `VER-1` 重复 push 仅作新发现 | **提升进缺陷总表**（建议编号 O-24），并注明它放大了面板「另有 N 条」的 N |

---

## §13 主控端到端复现批准链（本轮新做，不是采信）

REVIEW.md §3.1 写「主控端到端复现（/tmp/probe19.mjs，本次汇总未重跑，采信主控记录）」。
**我在本轮独立重跑了一遍完整链路**，以确认该断言不是转述。探针：`/tmp/lead_probe_e2e4.mjs`。

### 13.1 复现步骤（全部只用档 1 就有的 `write_hob`）

```js
// ① 建一本空账本，写一条需求；用两个自填字段给自己发豁免
req = [[unit]] id="R-001" kind="req" status="agreed" pipeline_version="v3" revision="1"
      clarify_legacy="pre-control" created_at="2026-01-01T00:00:00Z"
      acceptance_criteria=["AC-1"]
writeHobFile(root, { file: 'ledger/units/unit-req.toml', mode: 'append' })

// ② 自己算 digest（FNV-1a，非密码学哈希）
const digest = artifactDigestOf(units1[0])   // 'fnv64:0bf94771de4924fb'

// ③ 用 write_hob 直接写一条 decision 单元 —— ⛔ 完全不经过 hob_pipeline_approve
dec = [[unit]] id="DEC-001" kind="decision" status="active"
      decision_kind="stage-approval" artifact_id="R-001" artifact_revision="1"
      artifact_digest=<自算> decision="approve" decided_by="user"
      decided_at="2026-11-10T00:00:00Z" source="继续"
      approval_stage="requirements" pipeline_version="v3" revision="1"
writeHobFile(root, { file: 'ledger/units/unit-pipeline-approval.toml', mode: 'append' })
```

### 13.2 实测输出

```json
{
  "writeReq":                  { "ok": true },
  "writeDecisionViaWriteHob":  { "ok": true, "reason": null },
  "source": "继续",
  "approvalState": {
    "state": "approved",
    "approvalId": "DEC-001",
    "revision": 1,
    "decidedAt": "2026-11-10T00:00:00Z",
    "reason": "用户已批准当前修订"
  }
}
```

### 13.3 判定

**批准链端到端成立，且比域报告描述的更容易利用**。三点补充：

1. **`source="继续"` 这一条最关键**。`hob_pipeline_approve` 的工具契约（`tools.ts:2047-2058`）明写
   「只写『继续 / 可以』不算批准」，并对 `source` 跑正则 `确认<对象> 第 N 版`。
   但**绕过工具直接写账本时，这个正则根本不执行**——`approvalDecisionProblems`（`pipeline.ts:439`）
   对 `source` 只要求「非空字符串」。⇒ **同一条账本事实，走工具会被拒、走 `write_hob` 会被接受**。
   这正是「两份判据、一处强制」的又一实例，且它把「用户批准」这个词彻底架空。

2. **`decision_kind="stage-approval"` 是唯一需要的额外字段**，而它同样由写入方自填。
   （我第一次探针漏了它，`approvalStateOf` 返回 `missing`；补上后立即 `approved`。）
   ⇒ 不存在任何「不知道格式」的障碍，账本模板里就写着这个字段名。

3. **全过程零门禁**：不过 `proceedGate`、不过 `validateLedgerStructure`、不过回执正则。
   `writeHobFile` 的路径白名单（`hob-write.ts:163` `LEDGER_PATH_RE`）放行 `ledger/units/**`，
   而批准文件正是 `ledger/units/unit-pipeline-approval.toml`。

### 13.4 对 REVIEW.md 的一处措辞订正

REVIEW.md §3.1 的「主控端到端复现」标注为「本次汇总未重跑，采信主控记录」。
现在**已有本轮的独立复现**（§13.2 输出），该注记可改为「主控于 2026-11-10 独立复现，探针 /tmp/lead_probe_e2e4.mjs」。
这不影响结论，只是让证据链从「转述」升级为「当场可复跑」。

---

## §14 复核 t8（VERIFICATION.md，20 条）：M-01/M-02/M-03/V-02/V-05 全部成立，且 M-01 是本次最狠的一条

verifier 的判定是「需修正」（不是通过、不是推翻）。我逐条回源验证了它最关键的 5 条，**全部成立**。

### 14.1 M-01 负控计数器不跳注释 —— **成立，且比 verifier 说的更容易触发**

`scripts/check-meta-negctl.mjs:48` 的正则：

```js
const CALL_LIT_RE = /(?:ok|bad|note\.push|check)\(\s*(?:`([^`]*)`|'([^']*)')/gs
```

`countLabels`（`:56-63`）对 `src.matchAll(CALL_LIT_RE)` 的每个命中判 `includes('负向对拍')` ——
**纯文本匹配，完全没有词法分析、不跳过注释、也不区分字符串字面量**。

**我独立复现**（/tmp/lead_probe_negctl.mjs）：

| 输入 | countLabels 计数 |
|---|---|
| `bad('负向对拍：改坏实现 ⇒ 必须红')` | **1** |
| `// bad('负向对拍：改坏实现 ⇒ 必须红')` | **1** |
| `/* ok('负向对拍：改坏实现 ⇒ 必须红') */` | **1** |
| `/**\n * bad('负向对拍：改坏实现 ⇒ 必须红')\n */`（JSDoc） | **1** |
| `const s = "bad('负向对拍：注释里的假标签')"`（字符串里） | **1** |

⇒ 元规则 M-1 的最短绕过路径是**加两个斜杠**。而且它比 verifier 报的范围更大：
不只是行注释与块注释，**JSDoc 与字符串字面量里的假标签同样计数**。
这是「自比式自检」的极端形态：**检查器与被检查对象共享同一段文本，且检查器不懂语法**。
S-06（抬下限）完全不覆盖这条 —— 抬下限只会让「用注释凑数」更有利可图。

### 14.2 M-02 `stageHealthOfLedger.blockers` 并非「结构上恒空」 —— **成立，主文档措辞必须改**

`src/shared/stage-controls.ts:1100-1101`：

```ts
if (input.scope.kind === 'project') {
  return { decision: 'go', scope: scopeText, blockers: stageControlProblems(input.units), allowedRepairs: [] }
}
```

而 `stageControlProblems`（`:897-899`）= `stageFieldProblems` + `stageApprovalProblems` ——
**它会返回字段缺口与审批缺口**。`gateScopeUnits` 对 project 返回 `[]`（`:990`）只影响**闭环**判定，不影响字段/审批。

**我独立复现**（/tmp/lead_probe_health2.mjs）：
- 只含字段缺口（task 缺 title/task_brief/test_plan/acceptance_criteria_refs/task_risk）⇒ `stageControlProblems` 返回 **5 条**（4×C-5 + C-19）
- 只含闭环缺口（字段全齐、parent 指向不存在的方案）⇒ 返回 **3 条**（都是 C-5）

⇒ 正确表述是 **「结构上不含 L-1..L-4 闭环缺口 ⇒ 仅当缺口是闭环型时恒空」**。
verifier 的数字（3 条 / 16 条）与我的（5 条 / 3 条）不同，是因为夹具不同，但**结论方向一致**：
blockers 不是恒空。**死锁（L-02）本身仍成立**，只是主文档给的理由句错了。

### 14.3 M-03 「index.toml 只能装 0 或 1 条」 —— **成立，真实形态是「只有第一次写能成功」**

**我独立复现**（/tmp/lead_probe_m03.mjs）：

```
① 空 index.toml 一次性写 3 条 → ok:true
② 再 append 第 4 条          → ok:false  ledger-duplicate-id  「R-1: 合并后的账本出现重复 ID」
③ overwrite 改 R-1 的内容     → ok:false  ledger-duplicate-id  「R-1: 合并后的账本出现重复 ID」
```

⇒ 主文档 T-01 的「只能装 0 或 1 条」**不准确**。真实形态更糟：
**第一次写成功，此后 index.toml 内的单元既不能追加也不能修改**（overwrite 也撞同一处重复计入）。
这比「容量 1」更严重 —— 它意味着 `index.toml` 一旦写入就**冻结**，任何修正都必须改分片或手工编辑。

### 14.4 V-02 `taskGraphOf` 用全部 change（含 superseded）收任务 —— **成立**

`src/shared/pipeline-view.ts:666-669`：

```ts
const plans = units.filter((u) => text(u.kind) === 'change' && changeRequirementIds(u).includes(reqId))
const planIds = new Set(plans.map((p) => text(p.id)))          // ← 不筛 status，superseded 也在内
const tasks = units.filter((u) => text(u.kind) === 'task' && (planIds.has(text(u.parent)) || ...))
```

而 `currentTasksOf` 只认当前方案。⇒ 旧方案有 built 任务、新方案零任务时，
`graphReady` 会被旧任务满足（`activeStage` 推进到 5），但同一屏的 `summary` 来自当前方案（「还没有任务图」）。
**这是 R-02（口径分叉）在服务端内部的一次自我复制**，也解释了为什么面板会「显示已完成却提示没有任务图」。

---

## §15 最终验收（t7 第三轮补全景与主链）

| 项 | 要求 | 实测 |
|---|---|---|
| 文件行数 | — | **1804 行**（补全景前 1632，+172） |
| § 级章节 | 完整、正常收尾 | 52 个 `###`、以「**文档结束。**」结尾 |
| 缺陷计数 | 112 = R29 + S16 + T24 + O43 | 逐前缀实测 **R29 / S16 / T24 / O43**，无断号无重号 |
| 新增 §1.4 业务全景 | 图 + 表 + 用法 | 117-179 行；图 `:124-153`（①–⑪），表 `:157-169`（**11 行五列**） |
| 新增 §1.5 六条主链 | 四段式 + 单一真源判定 | 183-281 行；汇总表 `:270-277` |

### 15.1 六条主链的单一真源判定（采信，且与我的独立观察一致）

| 链 | 判定 | 我的独立核实 |
|---|---|---|
| 1 创建会话 | ✅ 未破坏 | 票据流程读码确认；仅 `bus.ts:2039` enum 为第三份字面量（O-40） |
| 2 双闸门 | ❌ 自证 | §13 端到端复现证实：`write_hob` 可直接写 approved 的 decision |
| 3 任务图与派活 | ⚠ 部分破坏 | §7.3 核实多轨绕门禁（R-28）、复现 G3 不进闸门（R-05） |
| 4 运行态投影 | ❌ 三处独立 | t2 L-05 无事务 + t2 L-06 写坏不自拦 + t8 V-01 读侧静默吞 |
| 5 验证与验收 | ❌ 结构性不参与 | §1 复现：C-7/C-25 六条违规、阶段 5/6 仍 completed（R-01） |
| 6 视图与下一步 | ❌ 下游各算一遍 | §2 复现：同帧 `chainCompleted=true` +「没人验收过」 |

## §16 主控被判错 · 「门形态预测等级」这个洞察是我错了

我提出：「门是真的还是假的」比「缺陷数量」更能预测严重度，并给出三分组。
synthesizer **没有照写**，而是用交叉统计证明我的假设不成立：

| 分组 | 环节 | 命中 | blocker | high | high+ |
|---|---|---|---|---|---|
| 有真闸门 | ①②③⑤ | 14 | 4 | 4 | **57%** |
| 门只写文字 | ④⑧⑨⑩ | 11 | 2 | 4 | **55%** |
| 无门只有出口 | ⑥⑦⑪ | 12 | 1 | 8 | **75%** |

⇒ **57% / 55% / 75%，不单调**。换成「判据可不可信」后：A/C 组 **0%**、B 组 **86%**。

**我错在把 ① 建会话 与 ② G1/G2 并进同一组**——前者判据可信、后者判据自证，并组后信号互相抵消。
⇒ **正确变量是「门后面站的是不是真判据」**，而非「有没有门」。

## §17–§18 C1 路径：我判错了失败值与成因

我在 §17 断言「服务包在，answerer 不在 ⇒ `request()` 返回 `unavailable`」。synthesizer 反驳，我逐条回源，**它全对**：

| 我的断言 | 实际 |
|---|---|
| answerer 不存在 | `dsh-client-ui-approval/lib/client.js:475` `ctx.remote.$on("approval/request",…)`；`:181` `answer("allowed-once")` |
| 未装配进 profile | `dsh-web-app/cordis.patch.yml:325-326` `- id: ui-approval` |
| 失败值 = `unavailable` | `decide()`：`if (effectivePolicy(session) === "never") return "rejected"` |
| 成因 = answerer 缺席 | `web/cordis.patch.yml:30-31` `danger-full-access: approval: never` + `defaultPreset: danger-full-access` |

**我错在两处**：① 在 dsh-hob 项目根跑 `ls node_modules/`，而 dsh-hob **不是宿主**（把目录当成已成立的假设）；
② 把 waterfall 的**终端兜底**当成实际返回值，忽略了它前面 `policy === 'never'` 的短路。

⇒ **关键后果**：`defaultPreset: danger-full-access` ⇒ **降级不是边缘情况而是默认情况**。

## §19 T-01 三方复现对齐

| variant | append | overwrite |
|---|---|---|
| none | dups=[R-001,R-002] | dups=[R-001,R-002] |
| **drop-item1** | **dups=[]** | **dups=[]** |
| drop-item3（我派单时写的） | dups=[] | dups=[R-001,R-002] |

⇒ 采 `drop-item1`，不变量是「**每个物理文件最多被读一次**」。并验证**不误伤分片写入**（四格中分片两格完全相同）。

## §20–§21 R-13：我要求新增编号，但 R-13 已存在

我判定 `plans.at(-1)` 是新缺陷、应新增编号（112 → 113）。synthesizer 指出 **R-13 已在 `REVIEW.md:833`**。
⇒ **总条数仍是 112**。我这一轮做的是**复现强化**（把 medium 升为 high），不是新发现。

**它同时复核出两个我漏掉的真增量**：
1. **`currentPlanOf` 本身也不可信**：`created_at` 自填、`active` 判「不是 superseded」、全 superseded 时回落 `at(-1)`。
   ⇒ 修法不能是「复用 `currentPlanOf`」，要抽 `currentPlanOfStrict`。
2. **顺序来源的机制层**：`units` = `[...index, ...分片]` ⇒ 即使 T-01 修好，「方案 A 在 index、方案 B 在分片」仍会让 `at(-1)` 取错。
   ⇒ **`O-37` 从「T-01 硬前置」升级为「同时是 R-13 硬前置」**。

### 21.1 我三次被判错的类型

| 次 | 错误类型 | 被什么纠正 |
|---|---|---|
| §16 | 分析错误（并组抵消信号） | 交叉统计 |
| §18 | 取证错误（查错目录 + 误读兜底） | 更完整的代码链路 |
| §21 | **记忆错误（忘了已核过的结论）** | 指向原文行号 |

⇒ **任何「我发现了新缺陷」的结论，必须先 grep 一遍总表确认它不是已有编号的复现。**

## §22–§24 实施阶段复核（B0.2 / B0.3 / B0.1 / B1.2 / B1.4）

| 批次 | 判定 | 主控验证方式 |
|---|---|---|
| **B0.2**（T-01/O-33） | ✅ | 六格行为探针：index append/overwrite 转绿、分片两格与修前**逐字相同**、坏分片报 `ledger-unit-unreadable` |
| **B0.3**（S-16） | ✅ | `countLabels` 七种写法：真调用=1，行注释/块注释/JSDoc/字符串/代码后注释**全 0**；实跑 check 由绿转红（4→3） |
| **B0.1**（S-02 地基） | ✅ | 真实账本 292 单元 / 177 行 `clarify_legacy`：**修前修后缺口数相等**；新写 v3 单元三态全被 C-11 拒 |
| **B1.2**（R-06/O-09） | ✅ | 四场景：旧格式→`index-legacy`、坏行→`index-malformed`、正常→ok、无 index→`ledger-missing`；`stageGateOfLedger` **fail-closed** |
| **B1.4**（R-18/T-07） | ✅ 代码对，但暴露跨批阻塞 | 见下 |

### 24.1 B1.4 暴露的阻塞（我独立复现）

```
cp -r 真实账本 → /tmp；原样 overwrite ledger/units/unit-01.toml
⇒ { ok:false, reason:'ledger-structure-invalid',
     msg:'账本结构不合法（81 条缺口）：C-23 · R-001 · 新 req 必须登记 pipeline_version="v3"；…' }
```

**成因**：`checkLedgerUnitWrite` 交给 `pipelineWriteProblems` 的 `before` 集合**不含目标分片自己的旧单元**
⇒ 该分片所有既有单元都被当成「本次新增」。

⚠ **不是 B1.4 写错了，而是它把一条一直存在的错误判据暴露出来**（以前被 `validateLedgerStructure:false` 掩盖）。
