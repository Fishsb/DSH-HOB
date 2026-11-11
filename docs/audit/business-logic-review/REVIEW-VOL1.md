# REVIEW · 分卷 1

> ⚠ 本文件是 `REVIEW.md` 的**分卷**（原文件超 64KB 读上限，
> 按 `check:gitignore` 的 M 判据处置：**整块搬走 + 原位留指针**，⛔ 不是压缩）。
> 主文件：`docs/audit/business-logic-review/REVIEW.md`。

---

# dsh-hob 业务逻辑主审查（REVIEW）

> **审查对象**：dsh-hob 插件全部业务逻辑（主链 / 账本 / 编排 / 策略 / 客户端 / 文档契约六域）
> **审查方式**：六域只读审计 → 主控回源复核 → 本文档汇总（重跑关键探针）→ **t8 第二轮独立复核**（`VERIFICATION.md`）→ 本文档按复核结论订正（§9.6）
> **产出**：本文件是**唯一主审查文档**。六份域报告（`pipeline.md` / `ledger.md` / `dispatch.md` / `policy.md` / `client.md` / `docs.md`）与 `LEAD-VERIFICATION.md` 是它的**证据底稿**，不是它的章节。
> **纪律**：本次审查全程只读。**未修改任何源码 / 配置 / 文档**。唯一写入 = 本文件与各域报告。
> **日期**：2026-11-10
>
> ---
>
> ⚠ **本文件是「审计快照」，不是「修复进度」。** 修复看 **[FIX-RESULT.md](FIX-RESULT.md)**。
>
> | 文档 | 是什么 | 时效 |
> |---|---|---|
> | **REVIEW.md**（本文件） | 112 条缺陷的**审计实录** + 证据 | ⛔ 快照，**不随修复更新** |
> | [FIX-PLAN.md](FIX-PLAN.md) | 19 个批次怎么修 | ⛔ 方案，不随施工更新 |
> | **[FIX-RESULT.md](FIX-RESULT.md)** | **实际修了什么、还剩什么** | ✅ **唯一权威进度** |
> | [LEAD-VERIFICATION.md](LEAD-VERIFICATION.md) | 主控回源复核记录 | 快照 |
> | [VERIFICATION.md](VERIFICATION.md) | t8 第二轮独立复核 | 快照 |
> | [R02-SPLIT-PLAN.md](R02-SPLIT-PLAN.md) | R-02 的五份实现拆分方案 | 待决策 |
>
> **读本文件的正确方式**：把它当「当时的判断 + 证据」，不是「现在的状态」。
> 个别条目已被后续复核**证伪或降级**（如 **S-08** 已排除、**C-01** 已降为观察项）——
> 那类条目在正文里都有「⚠ 已排除 / 已降级」的置顶说明，**以说明为准**。
>
> **当前进度**：已修 **42** / 已排除 **2** / 未修 **68**（其中 blocker 3、high 1）。

---

## §0 怎么读这份文档

### 0.1 编号体系

域报告的编号（`P-xx` / `L-xx` / `D-xx` / `C-xx`）是**发现编号**，保留用于溯源；本文档用**归并编号**，按「根因形态」而非「域」重排：

| 前缀 | 含义 | 条数 |
|---|---|---|
| **R-xx** | 形态 ① 口径分叉（同一事实多份实现，无一处强制同源） | 29 |
| **S-xx** | 形态 ② 自比式自检 / 自证（只证明 A==A，不证明 A==B） | 16 |
| **T-xx** | 形态 ③ 失败被不同出口翻译成不同结论 | 24 |
| **O-xx** | 形态 ④ 不属于上述三形态的独立缺陷（性能 / 可达性 / 死代码 / 文案 / 读数不准） | 43 |

**归并口径**：原始 103 条域发现 → 剔除 2 条降级（§6）→ 在范围 101 条 → 合并 4 组（共 **−5**，其中一组 3 并 1）、拆分 2 条（**+2**）⇒ **98 条**；另有 1 条由域报告的**边界疑点**提升为独立缺陷（`R-09`），加 1 条**首轮复核新增**（`O-32`）；再加 **第二轮独立复核（t8/VERIFICATION.md）的 13 条**——M-01 新增为 `S-16`，V 组 12 条中 10 条新增为 `O-33`…`O-42`、其余 2 条并入已有编号（V-08→`T-15`、V-12→`T-06` 条件附加）⇒ **总表 112 条**。
完整映射见**附录 A**（逐条可溯源）。

### 0.2 证据等级（本文档对每条结论都标了等级）

| 等级 | 含义 | 本次如何取得 |
|---|---|---|
| **实测** | 有可复现的探针输出 / 命令输出 | `node /tmp/syn_probe_*.mjs` 直跑 `src/**` 纯函数；或 `grep` / `sed` 原文 |
| **读码** | 逐行读到源码，但无运行时证据 | 带 `文件:行号` |
| **未验证** | 静态不可证，需宿主 / 运行时探针 | 单列 §6，不进总表主排序 |
| **已排除** | 曾提出，经反证不成立 | 见 §9.3 |

### 0.3 本文档与域报告的差异（不是拼接）

1. **重排**：缺陷不再按域并列，改按根因形态归类（§2、§5）。
2. **合并**：同一事实的多域发现合并为一条（例如 `t1 P-04`+`t2 L-08` → `S-02`）。
3. **裁决**：域间冲突逐条裁定并写明采信哪一方（§4，共 8 组）。
4. **重写结论**：新增跨域矛盾专章（§3），四条链各自跨两域以上。
5. **补验证方式**：每条缺陷都给「怎么证明修好了」，含负向对拍（§5）。
6. **新增**：本次汇总独立复跑 4 个探针，发现 6 处域报告未报的细节（§9.4）。
7. **全景与主链**（§1.4 / §1.5）：**您如果只想知道这个系统怎么跑，读这两节就够**；它们也是 §2 根因主线的具体载体。

---

## §1 结论摘要

### 1.1 三条最重要结论

**结论一：本次审计的根因只有一个——「同一个事实存在多份实现，且没有任何一处强制同源」。**

不是某一处写错，而是**整个系统没有单一真源机制**。实测清点：**13 类事实、38 份实现、0 处强制同源断言**（§2.4）。它派生出三种可观测形态：口径分叉（同名不同义）、自比式自检（判据只证明 A==A）、失败被不同出口翻译成不同结论。
**最直接的后果**：面板可以同时显示「已完成」和「2/3」；同一本账四个出口给出四种健康结论；运行时的「五步」与面板的「七步」把同一个编号指向两件事。

**结论二：「用户批准」在当前架构下是一条自证链，I-4（Hob 不能自批）实质不成立。**

三个域各自发现一段、合起来才完整：
- 批准工具的 `decided_by = "user"` 是**硬编码常量**（`src/modules/tools.ts:2081`），唯一校验是对**自填字符串** `source` 做正则（`:2051-2058`）；
- 连那个工具都不必走——`write_hob` 在**最低档 `ledger`** 就能写同一份 decision 单元（`src/preset/tools.ts:1211-1213` + `src/server/hob-write.ts:163`），而 `approvalDecisionProblems` 只要求 `source` 非空（`src/shared/pipeline.ts:439`）；
- 绑定用的 `artifact_digest` 是 FNV 变体，注释自陈「不是密码学哈希」（`pipeline.ts:199-205`），**任何人都能自算**。
⇒ **Hob 可以单方面制造一条形式上完全合法的「用户批准」**。主控已端到端复现（`/tmp/probe19.mjs`）：写 req → 自填豁免改成 agreed → 写 `source="继续"` 的 DEC-001 → `approvalStateOf` 返回 `{state:'approved'}`。
**这一条只有「引入用户本人触发的通路」能实质修复**（§7.1 的 C 选项），A/B 都只是把可绕过点收窄。

**结论三：门禁与判定大面积「有判据但不算数」，且失败在多数出口上不可观测。**

- G4/G5 的「阶段完成」用弱判定，C-7/C-25 的独立性违规**只进 `blockedBy` 文本、不参与 `activeStage`/`chainCompleted`**。本次复核实测：验证者=实现者、验收者=实现者、无 criteria_refs/verification_refs/example_results 的账本，**7 条违规同时在列，而 `activeStage=7`、`chainCompleted=true`**（`/tmp/syn_probe_g45f.mjs`）。
- 判不出派活方工作区根时，账本投影**整段静默跳过**，工具仍报 `ok:true`，状态面一个字不提（`orchestrator.ts:5208, 5387, 10008`）。
- 面板的一次挂起请求会让刷新**永久停止**，而徽标仍显示「实时更新已连接」（`project-panel.tsx:1407-1445, 3100`）。
- 元规则 M-1 的计数器**不剥注释**：把一条会红的负向对拍加上 `//` 就能让 M-1 照样数得到、`check:meta-negctl` 照旧全绿（`S-16`，**比 `S-06` 更根本**；实测行注释 / 块注释 / JSDoc / 字符串四种写法均计 1）。
- 元规则 M-1 有 **10 个族**的负控下限 = 0（`check:all` / `check:build` / `check:host` / `check:preflight` / `check:profile` / `check:readings` / `check:rounds` / `check:selfwake` / `check:tasks-route-http` / `check:work-plan-runtime`），其中 `check:work-plan-runtime` **42 条断言、0 条负向对拍**——「一条负控都没有也永远绿」。

### 1.2 缺陷总表

| 等级 | 条数 | R（口径分叉） | S（自比自证） | T（出口分裂） | O（其它） |
|---|---|---|---|---|---|
| **blocker** | **12** | 5 | 3 | 4 | 0 |
| **high** | **27** | 9 | 3 | 11 | 4 |
| **medium** | **40** | 9 | 7 | 7 | 17 |
| **low** | **33** | 6 | 3 | 2 | 22 |
| **合计** | **112** | **29** | **16** | **24** | **43** |

**另有 2 条不进总表**（降级为观察项，见 §6）：
- `t5 C-01`（primitives 是否在宿主 seed 里）——主控复核后**从 blocker 降级**，理由见 §6.1；
- `t4 P-06`（`PERMISSION_SERVICE` 缺席即 throw 导致工具面全不注册）——**未验证**，理由见 §6.2。

**12 条 blocker 一览**：

| 编号 | 一句话 |
|---|---|
| `R-01` | G4/G5「阶段完成」用弱判定，独立性违规不参与判定 |
| `R-02` | 「链完成了吗」有 5 份实现，客户端同屏并置两个来源 |
| `R-03` | 阶段步名 8 份字面量且已漂（「编码任务」vs「任务图」） |
| `R-04` | 运行时教模型「五步」、面板与文档是「七步」 |
| `R-05` | G3（依赖环/悬空/覆盖缺口）不进任何派活闸门 |
| `S-01` | 「用户批准」是自证链：被校验方即写入方 |
| `S-02` | 两个自填字段可跳过 11 类门禁 |
| `S-06` | 元规则 M-1 的 10 个族负控下限 = 0 ⇒ 零负控也永远绿 |
| `T-01` | `index.toml` 被守卫重复计入 ⇒ 第二条单元永远写不进，且错误原因说谎 |
| `T-03` | 判不出 `ownerWsRoot` ⇒ 账本投影整段静默跳过，工具仍报 `ok:true` |
| `T-04` | 一次挂起的 HTTP 让面板永久停刷，徽标仍说在刷新 |
| `T-05` | 修复写的命中判据与真正拦它的判据不是同一套 ⇒ 无法自愈的死锁 |

### 1.3 一页纸的修复优先级

| 序 | 动作 | 对应 | 为什么排这里 |
|---|---|---|---|
| 1 | **批准链引入用户本人触发通路（C 选项）** | `S-01` | 它让「用户批准」这个产品承诺从根上不成立 |
| 2 | **G4/G5 改强判据；G3 进派活闸门；多轨补门禁** | `R-01` / `R-05` / `R-28` | 三条独立的「有洞照样放行」 |
| 3 | **建立单一真源：阶段定义 + 账本健康 + 解析器** | `R-02`/`R-03`/`R-06`/`T-02` | 不做这一层，后面每修一处都会漏一处 |
| 4 | **把「判不出」与「没发生」在所有出口上分开** | `T-01`/`T-03`/`T-04`/`T-08`/`T-09` | 让失败可观测，否则修完也验证不了 |
| 5 | **给元规则装上牙（负控下限 + 指针解析 + 恒假面自查）** | `S-06`/`S-07`/`S-08` | 自检体系本身不可信，前面四条都守不住 |

---

### 1.4 业务全景：这个系统本来是怎么跑起来的

> ⚠ 本节与 §1.5 放在 §2「根因模式」**之前**，是刻意的：读者要先知道**系统本来怎么跑**，才看得懂后面「哪里坏了」。
> 本节内容来自六份域报告的 §2「主链路：入口 → 状态 → 落盘 → 出口」，只做**重组与串联**，不新造事实；凡域报告标「未验证」的，这里也不写成已确认。

#### 1.4.1 一张图：从用户到下一步

```
  用户（人）
    │  ① 选可读档 / 推进方式（一次性票据，TTL 2 分钟）
    ▼
  Hob 会话（项目总代理；DEFAULT_DENY 红线内：不可写代码 / 不可执行 / 不可组队）
    │
    │  ② 需求 req ────────[G1 用户批准：decision 单元 + artifact_revision + artifact_digest]
    │        │
    │        ▼  ③ 方案 change ─[G2 用户批准 + selected_option 必须在 path_options 内]
    │        │
    │        ▼  ④ 任务图 task ─[G3 无环 / 无悬空 / 验收条件全覆盖 / RP-5 写范围串行]
    │        │
    │        ▼  ⑤ 派活 hob_dispatch
    │        │      ├ proceedGate      （推进方式：auto / single / multi）
    │        │      ├ stageGate        （账本就绪度 + 生命周期 + 作用域门禁）
    │        │      └ pipelineDispatchProblems（v3 登记 + G1/G2 已批准 + 任务书齐）
    │        ▼
    │     执行会话（developer）
    │        │  ⑥ 回传：running → idle ⇒ settle()（唯一结算点）⇒ 回执投给 owner
    │        ▼
    │     账本投影 projection-writer（按账本根整场串行）⇒ RUN.returned
    │        │  ⑦ 技术验证 VER ─[G4 独立于实现者：verifier / verification_session ≠ built_by]
    │        ▼  ⑧ 产品验收 ACC ─[G5 独立会话 + 例子逐条结果]
    │        ▼  ⑨ 交付收口 CLS ─[G6 风险启用：skipped / standard / strict]
    ▼
  视图 pipelineViewOf（唯一「当前第几步 / 闸门 / 责任方」赋值点）
    ├ POST /stages             （全账本清单 + pipelines + stageHealth + next）
    ├ POST /requirement-chains （每条需求一条链 + pipeline + next）
    └ 面板 project-panel       （七步主线 / 下一步 / 卡在哪）
```

#### 1.4.2 一张表：11 个环节的权威位置 / 账本读写 / 守它的闸门

| # | 环节 | 权威代码位置 | 写 / 读账本的什么 | 守它的闸门 | 对应 §5 的缺陷 |
|---|---|---|---|---|---|
| ① | **建 Hob 会话** | `session-create-channel.ts:257-269`（票据一次性，先删再判）、`:397-401`（票据绑定 sessionId）、`server/session-policy.ts:378-414`（原子写 + 逐字节回读）、`:1029-1079`（隔离回读） | 写 `<ledgerRoot>/runtime/session-policy.json` —— **不是账本单元，是运行态文件** | 开放档位校验（`read-level-policy.ts:61`）+ 票据一次性 + 回读确认 | `O-19`、`O-22`、`O-41` |
| ② | **需求 req（G1）** | `pipeline.ts:307-394`（`approvalStateOf`）、`modules/tools.ts:1954-2118`（`hob_pipeline_approve`） | 写 `ledger/units/unit-pipeline-approval.toml`（decision 单元）；读 `artifact_revision` / `artifact_digest` | G1：`stage-controls.ts:313-325`（C-18）+ 写守卫 `hob-write.ts:1070-1084` | **`S-01`**、`T-13`、`R-12`、`S-02` |
| ③ | **方案 change（G2）** | `stage-controls.ts:328-403`（`planProblems`）、`:406-418`（C-19）、`modules/tools.ts:2038-2046`（选路径校验） | 写 change 的 `path_options` / `path_decision` / `risk_*`；读 decision 的 `selected_option` | G2：批准 + `selected_option` 必须在当前 `path_options` 内（`pipeline.ts:374-385`） | `R-13`、`R-23`、`O-04` |
| ④ | **任务图（G3）** | `pipeline-view.ts:664-724`（`taskGraphOf`）、`:412-417`（graphReady 判定） | 读 task 的 `depends_on` / `acceptance_criteria_refs` / `parent` | G3：`cycles` / `dangling` / `coverageGaps` + RP-5（`stage-controls.ts:454-479`） | **`R-05`**、**`O-34`**、`R-10`、`O-38` |
| ⑤ | **派活 `hob_dispatch`** | `orchestrator.ts:8702-9005`（工具）、`:8837`（门禁调用点）、`src/preset/tools.ts:2166-2167`（`??` 组合）→ `modules/tools.ts:812-937`（`dispatchGateAtLedger`） | **预登记 RUN**（`orchestrator.ts:5202-5230`）+ 写 watch 到 `runtime/orch-watches.json`（`:5332-5374`） | 三道**串联**：`proceedGate` → `stageGate`（就绪度 + 生命周期 + 作用域）→ `pipelineDispatchProblems`。`??` 是「与」不是「或」（§4.1 已回源） | **`R-28`**、`R-05`、`T-03`、`O-35` |
| ⑥ | **执行 → 回传** | `orchestrator.ts:7423-7779`（`settle()`，**唯一结算点**）、`:1609-1636`（`buildReceipt`） | 回执正文不落账；`return` 事实交给投影 | 至多投一次（`reported` + `deliveredAt`）、stop 闸、无收件人不投（`:7497-7501`） | **`T-10`**、`T-12`、`R-25` |
| ⑦ | **账本投影** | `ledger-projection.ts:706-713`（`projectFact` 纯函数）→ `projection-writer.ts:68-81`（按账本根串行）→ `writeHobFile` | 建 `RUN` / 迁 `TSK` / `link run_ids`；**投影写入传 `validateLedgerStructure:false`**（`:162, 272`） | 幂等键 `projection_key`（`:265-272`）+ `ops=[] ⇒ ok:false`（`:207-217`） | **`T-07`**、**`R-18`**、`T-06`、**`O-33`** |
| ⑧ | **技术验证（G4）** | `stage-controls.ts:626-695`（`verificationProblems`）、`pipeline-view.ts:175-184`（`allTasksVerified`）、`orchestrator.ts:10695`（`verify` 落账） | 写 verification 单元（`verifier` / `criteria_refs` / `basis` / `verified_at`） | G4：独立性 + 证据可复核 —— **但只进 `blockedBy`，不参与 `activeStage`** | **`R-01`**、`S-03`、`O-35` |
| ⑨ | **产品验收（G5）** | `stage-controls.ts:519-609`（`acceptanceProblems`）、`pipeline-view.ts:187-193`（`allTasksAccepted`）、`src/preset/tools.ts:313`（`acceptanceGateFor`） | 写 acc 单元（`verdict` / `actor` / `acceptance_session` / `example_results`） | G5：独立会话 + 例子逐条结果 —— **同上只进 `blockedBy`** | **`R-01`**、`O-35`、`R-08` |
| ⑩ | **交付收口（G6）** | `stage-controls.ts:698-767`（`closureProblems`）、`pipeline-view.ts:476-479`（`closureReady`） | 写 closure 单元（`closure_mode` / 回滚 / 监控 / 残余风险） | G6：风险启用 —— `skipped` 必须有理由、`strict` 必须有回滚监控 | `R-13`、`S-05`、`O-01` |
| ⑪ | **视图与下一步** | `pipeline-view.ts:210-535`（`pipelineViewOf`，`activeStage` 在 `:354-503`）→ `stages-index.ts:316-343` + `:425`（`pipelineViewsOf`）→ `requirement-chain.ts:337-567`（`:519-540` gate 注入）→ `project-panel.tsx:2654-2663`（渲染） | **只读**（不写账本） | 无闸门（纯投影） | **`R-02`**、`T-02`、`T-08`、`T-09`、`R-24` |

#### 1.4.3 这张表的三个用法

**它的价值在「定位」**：任何一条缺陷都能在表里找到**挂在哪一步、被哪道门守着、本该由谁负责**。

1. **从缺陷反查环节**：§5 每条都标了位置（如 `pipeline-view.ts:570-644`），对表即可定位到「⑤ 派活」；
2. **从环节反查门禁**：想知道「第 ④ 步为什么没拦住」→ 看「守它的闸门」列 → 发现 G3 判据只在视图 `:412-417`、**不在** `pipelineDispatchProblems` 里 → 这就是 `R-05`；
3. **看哪一步的「门」是假的**：⑧⑨ 两行的门禁列写着「只进 `blockedBy`，不参与 `activeStage`」——**这两步是整条链上唯一「有判据但不算数」的地方**，也是 `R-01` 为什么是 blocker。

**一句话总结**：11 个环节里，**①②③⑤ 有真闸门**（拒绝会真的拦住）；**④⑧⑨⑩ 的门只写文字**（`R-05` / `R-01`）；**⑥⑦⑪ 没有门、只有出口**（靠读数可见性兜底，而 `T-03` / `T-07` / `T-09` 说明这个兜底并不牢）。
#### 1.4.4 「门形态」与「缺陷等级」的实测对应（⚠ 与一个直觉假设相反）

> 这一小节回答一个自然的问题：**「门是真的还是假的」能不能预测缺陷等级？**
> 我用 §1.4.2 表里已经标好的「环节 → 缺陷」对应关系做了一次交叉统计（112 条缺陷全部有等级，无遗漏），结论是：**原假设不成立，但换一个变量就成立**。

**先看被否掉的假设**（「真闸门 / 只写文字 / 无门」三分组）：

| 分组 | 环节 | 命中缺陷 | blocker | high | medium | low | high+ 占比 |
|---|---|---|---|---|---|---|---|
| 有真闸门 | ①②③⑤ | 14 | 4 | 4 | 4 | 2 | **57%** |
| 门只写文字 | ④⑧⑨⑩ | 11 | 2 | 4 | 3 | 2 | **55%** |
| 无门只有出口 | ⑥⑦⑪ | 12 | 1 | 8 | 1 | 2 | **75%** |

⇒ **三组占比 57% / 55% / 75%，不是单调关系**：最低的反而是「门只写文字」那一组，最高的反而是「无门」那一组。
「门是真的还是假的」**预测不了等级**。原因也很清楚：**① 和 ② 都是「真闸门」，但它们完全不同**——① 的门判据可信、② 的门判据自证（`S-01` 就挂在这里，两个 blocker）；把它们并进同一组，信号就互相抵消了。

**再看真正有区分度的变量**：「**判据可不可信 / 参不参与判定**」：

| 分组 | 环节 | 判据状态 | 命中缺陷 | blocker | high | medium | low | high+ 占比 |
|---|---|---|---|---|---|---|---|---|
| **A** | ①③ | 判据可信、**真执行** | 6 | 0 | 0 | 4 | 2 | **0%** |
| **B** | ②④⑤⑧⑨ | **判据被绕过 / 不参与判定** | 14 | **5** | 7 | 2 | 0 | **86%** |
| **C** | ⑩ | 门存在但只有弱判定（G6 三项） | 3 | 0 | 0 | 1 | 2 | **0%** |
| **D** | ⑥⑦⑪ | 无门，只有出口 | 12 | 1 | 8 | 1 | 2 | **75%** |

⇒ **A / C 组 0%、B 组 86%**，区分度是干净的两极。**12 条 blocker 里有 6 条落在 B 组或 D 组**（B 组 5 条 + D 组 1 条；另 6 条不挂在 11 步主链上，见表下注）：

| blocker | 落在 | 属于 |
|---|---|---|
| `S-01` `S-02` | ② | **B（判据自证）** |
| `R-05` | ④⑤ | **B（判据不进闸门）** |
| `R-01` | ⑧⑨ | **B（判据不参与判定）** |
| `T-03` | ⑤ | **B（判据静默跳过）** |
| `R-02` | ⑪ | **D（无门，口径分叉）** |
| `R-03` `R-04` `S-06` `T-01` `T-04` `T-05` | 不在 11 步内 | 见下注 |

> **注**：`R-03`（步名 7/8 份）、`R-04`（五步/七步）、`S-06`（元规则负控下限）、`T-01`（index.toml 冻结）、`T-04`（面板停刷）、`T-05`（修复写死锁）这 6 条 blocker **不挂在这 11 个业务环节上**——它们分别属于「阶段词表」「自检体系」「账本写入守卫」「客户端刷新」「修复写通道」。
> 这本身是个结论：**blocker 不全在业务主链上，有一半在「支撑设施」上**。所以下面的优先级判据只覆盖主链那 6 条，不覆盖全部 12 条。

**因此本表不仅能定位缺陷，还能预测等级——但判据是「判据本身可不可信」，不是「有没有门」。**

可操作的读法是三句话：

1. **有门且判据可信（A：①③）→ 预期 0% high+**。这两步的缺陷都是 medium/low（可达性、文案、性能），修不修都不影响主链行为；
2. **有判据但被绕过 / 不参与（B：②④⑤⑧⑨）→ 预期 86% high+，且集中了 12 条 blocker 里的 5 条**。这是**唯一的「修一条能同时消掉多条」的区域**——因为问题不在缺少检查，而在**已有的检查不生效**；
3. **无门只有出口（D：⑥⑦⑪）→ 预期 75% high+，但几乎全是 high 不是 blocker**。这类问题的形态是「读数不准 / 出口分裂」，修法是**加读数**而不是加门禁，成本低、但不会自己变好。

⇒ 一句话：**「有没有门」不重要，「门后面站的是不是真判据」才重要**。这也正是 §2 根因（单一真源缺失）在等级分布上的投影——B 组的 5 个环节（②④⑤⑧⑨）恰好就是 §1.5 里「单一真源被破坏」的**链 2、链 3、链 5**（②→链 2，④⑤→链 3，⑧⑨→链 5）。

---

### 1.5 六条主链的贯通式梳理

> 每条链统一四段：**触发点 → 关键判定 → 落盘 → 可观测出口**，末尾给一行 **「单一真源」判定**。
> 那行判定的意义是把「梳理」和「审查」接起来：**每条链本应有一个唯一权威点，判定就是看它有没有被破坏**。

#### 链 1 · 创建 Hob 会话

- **触发点**：用户在「新建 Hob 会话」弹窗里选可读档（`ledger` / `project` / `workspace`）与推进方式（`auto` / `single` / `multi`），点创建。
- **关键判定**：① `issue` 发一次性票据（`session-create-channel.ts:71`，TTL 2 分钟）→ ② `consume` **先删再判**（`:257-269`，重放必拒）→ ③ **票据里的 sessionId 必须与请求一致**（`:397-401`，防「拿 A 的票建 B 的会话」）→ ④ **建会话前第二道档位校验**（`:412-415`，与界面置灰无关）。
- **落盘**：写 `<ledgerRoot>/runtime/session-policy.json`（`server/session-policy.ts:378-414`，**原子写 + 逐字节回读**），并写 `runtime/.gitignore`（`:479-498`）。**注意：这不是账本单元，是运行态文件。**
- **可观测出口**：`POST /api/dsh-hob/session-policy` 的 `isHob` / `recorded` / `source` 三字段；「未选档」门禁横幅（`hob-unselected-gate.tsx`）；设置分区（唯一有写的面，走宿主 `configForms.mutate`）。
- **单一真源**：✅ **未破坏**。档位常量 `OPEN_READ_LEVELS`（`read-level-policy.ts:61`）是唯一权威，四处消费（`session-create-channel.ts:219/412`、`bus.ts:2137`、`session-policy-route.ts:321`）**共用同一常量**；票据流三道校验也是单一实现。
  ⚠ 下游有一处泄漏：`bus.ts:2039` 的 `hob_spawn` 入参 `enum` 是**手写的第三份档位字面量**，不 import `PERMISSION_LEVELS` ⇒ `O-40`。**链本身干净，接线处不干净。**

#### 链 2 · 需求与方案的双闸门（G1 / G2）

- **触发点**：Hob 写完 req / change 内容后调 `hob_pipeline_approve` 请求确认；用户在会话里回一句「确认需求 R-01 第 1 版」。
- **关键判定**：`approvalStateOf`（`pipeline.ts:307-394`）按固定顺序判：legacy → invalid(无 revision) → awaiting-user(draft/proposed) → missing(无 decision) → invalid(status≠active) → invalid(decision 不在封闭集) → request-changes → **invalid(decided_by≠user)** → **stale(artifact_revision≠当前)** → **stale(artifact_digest≠当前)** → invalid(selected_option 不在 path_options) → approved。
- **落盘**：`ledger/units/unit-pipeline-approval.toml`（decision 单元），写时传 `validateLedgerStructure:false`（`modules/tools.ts:2107`）。
- **可观测出口**：`pipelineViewOf().requirementApproval` / `.planApproval`（含 `state` + `reason`）；面板 G1/G2 的 `blockedBy`（**这是唯一被注入面板的两个 gate**，`requirement-chain.ts:521-540`）。
- **单一真源**：❌ **已破坏——本次审计最严重的一处**。
  - 权威点是 `approvalStateOf` 的 `decided_by === 'user'`（`pipeline.ts:351-353`）与 C-22（`:435`）——**两处校验同一个字段**；
  - 而那个字段由 `hob_pipeline_approve` **自己写死**（`modules/tools.ts:2081` 的字符串常量）⇒ **判据的输入来自被校验方**；
  - 更短的绕过路径存在：`write_hob` 在**最低档**就能写同一份 decision（`src/preset/tools.ts:1211-1213` + `hob-write.ts:163`），而账本层 `approvalDecisionProblems` 对 `source` **只要求非空**（`pipeline.ts:439`）⇒ `S-01`；
  - 绑定用的 `artifact_digest` 是 FNV 变体、**可自算**（`pipeline.ts:199-205`）。
  ⇒ **名义上有单一真源（`approvalStateOf`），实质不成立**——它是自证。

#### 链 3 · 任务图与派活

- **触发点**：Hob 调 `hob_dispatch({taskId})`（单目标）或 `hob_dispatch({tracks})`（多轨）。
- **关键判定**（三道**串联**，缺一不可）：
  1. `proceedGateFor(exec) ?? stageGateFor(exec, scope)`（`src/preset/tools.ts:2166-2167`）——**这是「与」不是「或」**：左侧 `undefined`（放行）时右侧必被求值，左侧非空（已拒绝）才短路；`stageGateFor` 内部 try/catch **fail-closed**（`:2155-2162`）。
  2. `dispatchGateAtLedger`（`modules/tools.ts:812-937`）：**第一道**账本就绪度 + 生命周期（任何派活都先过）→ 单任务 `stageGateAtLedger` + `pipelineDispatchProblems`（`:849-879`）→ 多轨按 `planId` **从盘上**找计划再逐轨判（`:881-932`）→ 都没有只报健康（`:934-936`）。
  3. `dispatch()` 内部还有：执行预设硬校验 → stop 闸 → 档位/写轨闸 → 同目标重复派发闸 → 同目标盘上闸 → 首派即绑定 → **RUN 预登记**（`orchestrator.ts:5202-5230`，拿不到 `createdRunId` 就**不投递**）。
- **落盘**：预登记 `RUN`（经投影）+ watch 写 `runtime/orch-watches.json`（`orchestrator.ts:5332-5374`，按 `(file, owner)` 分区写 `pending`）。
- **可观测出口**：工具返回 `ok` / `reason` / `message`；`hob_orch_status` 的 watch 行（`:10008-10017`）；面板第 4 步「已回传 N/M」。
- **单一真源**：⚠ **部分破坏**。
  - **有的部分**：派活闸门是单一实现（`dispatchGateAtLedger`），且 `??` 的「与」语义保证「阶段门必被求值」（§4.1 已回源）——这一半是好的；
  - **被破坏的三处**：① **任务图有两个收集口径**——`taskGraphOf` 用「该需求下全部 change（含 superseded）」（`pipeline-view.ts:665-670`），而 `currentTasksOf` 只认当前方案（`:110-116`）⇒ `O-34`；② **G3 判据根本不进派活闸门**（`pipelineDispatchProblems` 全文无 `taskGraphOf`）⇒ `R-05`；③ **多轨首次派发门禁空转**（计划在门禁**之后**才写盘，`orchestrator.ts:4816`）⇒ `R-28`。
  ⇒ 权威点**存在且正确**，但**它管的范围被三处缩水**。

#### 链 4 · 运行态 → 账本投影

- **触发点**：编排器在六个事实点调 `applyProjection(ledgerRoot, fact)`——派发前（`:5215`）、拒收（`:5317`）、派发成功后（`:5391`）、回传（`:7654`）、判决（`src/preset/tools.ts:896`），以及 `hob_orch_control` 的 verify / close-delivery / accept（`:10695` / `:10723` / `:10886`）。
- **关键判定**：① 按账本根**整场串行**（`projection-writer.ts:68-81`，不是按文件）；② 纯函数 `projectFact`（`ledger-projection.ts:706-713`）出 `ProjectionOp[]`，六个事实各一支（dispatch / refuse / return / verdict / verify / close）；③ **幂等键** `projection_key`（`:265-272`）去重；④ 三档结果 `ops` / `skipped` / `undecidable`（`:212-224`）；⑤ **只投影真实 task**（`implicit` 与空一律 `skipped`）。
- **落盘**：`create-unit` 追加到固定分片 `unit-projection.toml`；`transition-unit` / `link-unit` 在**原分片**里删段重写（`projection-writer.ts:224-281`）；全部走 `writeHobFile`（白名单 / 备份 / 原子写 / 回读），**但传 `validateLedgerStructure:false`**（`:162, 272`）。
- **可观测出口**：`ProjectionApplyResult{ok, applied, reason, files}`（`:96`）；`w.ledgerProjection` 在状态行渲染（`orchestrator.ts:10008-10018`）——⚠ 但该类型**丢掉了 `files`**（`orchestrator.ts:807`），说不清改了哪几个分片。
- **单一真源**：❌ **已破坏——而且是三处独立的破坏**。
  - 权威点应是「`projectFact` 出的 op 清单 = 实际落盘的内容」，并且**要么全落要么全不落**；
  - ① **不是事务**：`create-unit` 已落盘、`transition` 失败后无回滚，且重入时幂等键命中的是**第一步已落盘的 RUN** ⇒ 重试不会补迁移（`T-07`）；
  - ② **写坏的不会被自己拦下**：`removeUnitBlock` 在 `id` 非首键时留下孤儿块（`R-18`），而它传 `validateLedgerStructure:false`；
  - ③ **读侧也坏了**：`readToml` 的 `catch { return [] }`（`hob-write.ts:1042-1043`）把**解析失败的分片当空数组** ⇒ 账本已坏时写前校验看到「空账本」，写入照旧 `ok:true` 继续污染，而同一刻 `stageGateOfLedger=PASS`、`stageHealth={ok:true,count:0}`、`readiness=gaps:0`（`O-33`）。
  ⇒ 权威点（`projectFact` 纯函数）**本身是对的**，但**它的输出、落盘、读回三者之间没有一致性保证**。

#### 链 5 · 验证与验收（G4 / G5）

- **触发点**：执行会话回传后，Hob 派独立验证者写 VER；再派独立验收会话写 ACC；也可由 `hob_orch_control` 的 `verify` / `accept` / `send-back` 直接落账。
- **关键判定**：
  - G4：`verificationProblems`（`stage-controls.ts:626-695`）——独立性（`verifier` / `verification_session` ≠ `built_by`）、`criteria_refs` 非空、`basis` 可解析、`verified_at` 可解析、非符合项已关闭；
  - G5：`acceptanceProblems`（`:519-609`）——`product_confirmation` 非空、`actor` ≠ `built_by`、`acceptance_session` ≠ `built_by`、`verification_refs` 非空、`example_results` 逐条三段式且非 pass 必须给证据；
  - **但推进用的是另一套弱判定**：`allTasksVerified`（`pipeline-view.ts:175-184`）只查「最新 VER.status==='pass' 且 `verificationReady` 为真」；`allTasksAccepted`（`:187-193`）只查「存在 parent 匹配且 `verdict==='accepted'` 的 ACC」。
- **落盘**：VER / ACC 单元（经投影 `verifyOps`（`ledger-projection.ts:553`）/ `verdictOps`（`:447`））；判决动作本身也写账本。
- **可观测出口**：`pipelineViewOf().blockedBy`（强判据**只在这里**出现）+ `stageStates[4]` / `[5]`（由**弱判定**决定）。
- **单一真源**：❌ **已破坏——本次唯一「结构性不参与」的破坏**。
  - 强判据与弱判定**是两份实现**，且**弱的那份决定状态、强的那份只做文字提示**（`:322-327` 只 push 进 `blockedBy`）；
  - 本次实测（`/tmp/syn_probe_g45f.mjs`）：验证者=实现者、验收者=实现者、无 `criteria_refs` / `verification_refs` / `example_results` 的账本，**7 条 C-7/C-25 违规同时在列，而 `activeStage=7`、`chainCompleted=true`** ⇒ `R-01`；
  - 另有一处 fail-open：`if (builder !== '' && acceptor === builder)`（`stage-controls.ts:534`）⇒ **`built_by` 缺失反而更容易通过**（`S-03`）；
  - 且这两个写入口都**不过 `proceedGate`**（`O-35`）。
  ⇒ 权威点**名义上存在**（`verificationProblems` / `acceptanceProblems`），**但被排除在判定之外**——比「写错了」更坏。

#### 链 6 · 视图与下一步

- **触发点**：面板 5s tick / live 失效帧 / 手动刷新；三个只读路由：`POST /stages`、`POST /requirement-chains`、`POST /ledger-resource`。
- **关键判定**：`pipelineViewOf`（`pipeline-view.ts:210-535`）是**唯一**的「当前第几步 / 闸门 / 责任方」赋值点（`activeStage` 在 `:354-503` 的 if-else 链里）；`requirement-chain.ts:519-540` 在 **G1/G2 时**把 `pipeline.blockedBy` 注入 `next`，并把 `currentStep` 强制等于 `pipeline.activeStage`（`:520`）。
- **落盘**：**无**（纯投影，零写）。
- **可观测出口**：`/stages` 的 `pipelines` + `stageHealth` + `next`（`stages-index.ts:425-431`）；`/requirement-chains` 的 `pipeline` + `next`；面板七步主线（`project-panel.tsx:2600-2603`，**同一行既有 `displayState` 又有 `done/total`**）+「下一步 / 卡在哪」（`:2654-2663`）。
- **单一真源**：❌ **已破坏——本链是「同一个事实最多份实现」的集中地**。
  - **权威点确实只有一份**：`pipelineViewOf`（`TERMINOLOGY.md:81-82` 明写「面板、阶段接口和派发门禁都消费它」）；
  - **但「完成」有 5 份实现**：字段门禁 / `pipelineViewOf` 的 if-else / `summarizeStage` 只按 status 计数 / `requirement-chain.ts:359-397` 的 done-doing / 客户端同屏并置（`R-02`）；
  - **「账本健康」有 4 套判据**，实测同一夹具四种结论（`T-02`）；
  - **G3–G6 的 `blockedBy` 到不了面板**（只在 G1/G2 注入）⇒ 面板印「卡在哪：没有主阻断」而 `pipeline.blockedBy` 里写着「G3 · 任务依赖成环」（`T-08`）；
  - **`/stages` 的权威字段取回即弃**：`next` / `pipelines` / `summary` 客户端一个都不渲染（`R-24`）；
  - **`stageHealth` 的 `count` / `truncated` 不读** ⇒ 有 300 条缺口时显示「0 条缺口」（`T-09`）。
  ⇒ 权威点是**全项目最像「单一真源」的地方**（`pipelineViewOf` 确实是唯一入口），**但它下游每个消费方各自重算了一遍**。

#### 六条链的「单一真源」判定汇总

| 链 | 权威点 | 是否被破坏 | 破坏形态 | 主要缺陷 |
|---|---|---|---|---|
| **1 创建会话** | `OPEN_READ_LEVELS` + 票据流 | ✅ **未破坏**（接线处 `bus.ts` enum 例外） | — | `O-40` |
| **2 双闸门 G1/G2** | `approvalStateOf` | ❌ **破坏（最严重）** | **自证**：判据的输入来自被校验方 | **`S-01`**、`R-12`、`S-02` |
| **3 任务图与派活** | `dispatchGateAtLedger` | ⚠ **部分破坏** | **范围缩水**：G3 不进闸门 / 多轨空转 / 图口径两份 | **`R-05`**、`R-28`、`O-34` |
| **4 运行态投影** | `projectFact` | ❌ **破坏（三处独立）** | **无事务 + 写坏不自拦 + 读侧静默吞** | **`T-07`**、`R-18`、**`O-33`** |
| **5 验证与验收** | `verificationProblems` / `acceptanceProblems` | ❌ **破坏（结构性不参与）** | **强判据被排除在判定之外** | **`R-01`**、`S-03`、`O-35` |
| **6 视图与下一步** | `pipelineViewOf` | ❌ **破坏（下游各算一遍）** | **口径分叉**：完成 5 份 / 健康 4 份 | **`R-02`**、`T-02`、`T-08`、`T-09` |

**这张表的结论**：六条链里 **5 条被破坏、1 条完好**，且 5 条的破坏形态**互不相同**（自证 / 范围缩水 / 无事务 / 排除在判定外 / 口径分叉）。
⇒ 这正是 §2 的根因「单一真源缺失」在**六条链上的具体载体**：它不是一个抽象判断，而是**六次不同方式的失守**。
⇒ 也解释了 §8 的 P2「建单一真源」为什么必须**逐链做**——不能靠「加一条通用断言」一次性解决。

---

## §2 根因模式：单一真源缺失

### 2.1 论点

本次审计跨六域、103 条发现，其中**真正同构的只有一件事**：

> **同一个业务事实在系统里有多份独立实现，且没有任何一处强制它们同源。**

这不是「重复代码」这种风格问题。判断标准有三条，三条全中才算：
1. **同一语义**：几份实现回答的是同一个问题（「这条链完成了吗」「这本账健康吗」「第三步叫什么」）；
2. **多份独立**：不是 import 同一常量，而是各自写字面量 / 各自组合判据 / 各自选数据源；
3. **无强制同源**：没有任何断言、类型或运行时检查会在它们分歧时变红。

按这三条清点，**13 类事实、38 份实现、0 处强制同源断言**。

### 2.2 三种表现形态（本文档的归类轴）

**形态 ① · 口径分叉（同名不同义）**
同一名字在不同出口指不同东西，或同一问题有多份答案。
- 例：「完成」有 5 处实现（`R-02`）；「账本健康」有 4 套判据（`T-02`）；「第三步」有 7 个名字且已漂（`R-03`）；「五步 / 七步」两套词表（`R-04`）；同一份 TOML 两份解析器（`R-06`）。
- 后果：**两个都「对」的读数可以同时为真**，用户被迫在矛盾里选一个信。

**形态 ② · 自比式自检 / 自证（只证明 A==A，不证明 A==B）**
判据校验的是「A 声称自己是 A」，而不是「A 与外部事实 B 一致」。
- 机检侧：元规则数的是「登记表」而不是「实测」（`S-06`）；`checked_by` 只核字样存在不核指向有效（`S-07`）；正则指向已改名常量 ⇒ 恒假面（`S-08`）；机检照着实现的形态写，于是实现的形态错误也被固化（`S-14`）。
- 运行态侧：`decided_by` 由被批准方写入、再由自己校验（`S-01`）；豁免字段由写入方自己填、再由自己判是否豁免（`S-02`）。
- 后果：**判据越绿，越可能是它根本没在看**。

**形态 ③ · 失败被不同出口翻译成不同结论**
同一件失败，在工具返回、门禁、面板、日志、账本里得到不同的表述，其中至少一个出口把它说成「没事」或「没发生」。
- 例：守卫自己数了两遍，报的是「你写了重复 ID」（`T-01`）；判不出 ownerWsRoot ⇒ 投影字段干脆不出现（`T-03`）；面板冻结但徽标说在刷新（`T-04`）；G3 卡住但「卡在哪：没有主阻断」（`T-08`）；有 300 条缺口却显示「0 条缺口」（`T-09`）。
- 后果：**失败不可诊断**——用户会去改内容而不是改路径，会怀疑面板而不是怀疑门禁。

**形态 ④ · 其它**
不属上述三形态的独立缺陷（性能、可达性、死代码、文案口径）。保留这一类是为了**不把不相干的缺陷硬塞进根因叙事**——那样反而会让根因失真。

### 2.3 为什么它是「根因」而不是「一类缺陷」

因为三条因果链都从它出发，且都指向「其他缺陷难以被发现/修复」：

**链 1 · 它让缺陷互相掩护。**
`pipeline-view.ts` 里同时存在弱判定（决定状态，`:175-193`）与强判定（只做提示，`:322-327`）。任何只读一处的人都会得出相反结论；而两处都在同一个文件里、都「看起来是对的」。**同源缺失给了每个缺陷一个合法的邻居。**

**链 2 · 它让修复无法收敛。**
`stages-index.ts:284-293` 的 `summarizeStage` 只按 status 计数，`requirement-chain.ts:359-397` 又独立算一遍 done/doing。修好一处不会影响另一处，而用户看到的是两处并排（`project-panel.tsx:2600-2603` 同一行既有「已完成」又有「2/3」）。**修一处漏一处，是结构性必然，不是执行力问题。**

**链 3 · 它让验证失效。**
`check:meta-negctl` 的判据是「实测负控数 < 登记下限 ⇒ 红」。下限为 0 时 `0 < 0` 恒假——**元规则对自己没有牙**（`S-06`）。当自检体系本身也是「A==A」时，上面两条链就没有任何外部约束。

### 2.4 本次清点：13 类事实 / 38 份实现 / 0 处强制同源

| # | 事实 | 实现份数 | 位置（摘要） | 是否有同源断言 | 归属 |
|---|---|---|---|---|---|
| 1 | 阶段步名 | **8** | `pipeline-view.ts:33-41` / `stage-controls.ts:19-27` / `stages-index.ts:29-37` / `requirement-chain.ts:112-128`（两份） / `project-panel.tsx:138` / `gen-ledger.mjs:522` / **`tasks-progress.ts:67`** | ❌ 无 | R-03 |
| 2 | 「链完成了吗」 | **5** | `stage-controls.ts:289-767`（字段门禁） / `pipeline-view.ts:354-503`（if-else） / `stages-index.ts:284-293`（计数） / `requirement-chain.ts:359-397`（done/doing） / `project-panel.tsx:2600-2603`（同屏并置） | ❌ 无 | R-02 |
| 3 | 「账本健康吗」 | **4** | `tools.ts:581-591` / `tools.ts:711-721`+`stage-controls.ts:990` / `ledger-readiness.ts:294-303` / `stages-index.ts:445-465` | ❌ 无 | T-02 |
| 4 | TOML 解析 | **2** | `stages-index.ts:222-250`（严） / `tools.ts:159-206`（宽） | ❌ 无 | R-06 |
| 5 | 读盘实现 | **3** | `stages-index.ts:691-798` / `tools.ts:213-220` / `requirement-chains-route.ts:41-135` | ❌ 无 | R-07 |
| 6 | 单元状态封闭集 | **3** | `ledger-validation.ts:14-27` / `stages-index.ts:40-88` / `gen-ledger.mjs:153+` | ❌ 无（实测逐值一致，但无断言） | R-16 |
| 7 | 回执正则 | **2** | `pipeline.ts:397-409`（零调用） / `tools.ts:2051-2058`（生效） | ❌ 无 | R-15 |
| 8 | 清账判据 | **2** | `orchestrator.ts:5629-5633`（时间窗） / `write-delivery.ts:262-266`（ref 精确） | ❌ 无 | R-25 |
| 9 | 路由字符串 | **2** | `work-plan-panel.tsx:16` / `project-panel.tsx:957` | ❌ 无 | R-26 |
| 10 | 步号→kind 映射 | **2** | `requirement-chain.ts:120-128`（`STEP_DEFS.kind`） / `project-panel.tsx:148-156`（`STAGE_KIND_BY_STEP`） | ❌ 无 | R-08 |
| 11 | 账本根派生 | **2** | `doc-read.ts:95-147`（运行时） / `preflight.mjs:48-50`（体检，仍实现已删除的兄弟目录档） | ❌ 无 | R-11 |
| 12 | 风险评审判据 | **2** | `stage-controls.ts:341-359`（声明值） / `risk-policy.ts:441-451`（推导值） | ❌ 无 | R-23 |

**合计：8+5+4+2+3+3+2+2+2+2+2+2 = 37 份**（第 1 项含两份 `requirement-chain` 表，故记 8）。加上 `O-23` 的完成数两份，共 **38**。

> ⚠ 这张表本身就是本次审计的**主要产出**：它把「一堆零散缺陷」变成了**一张可以逐行加断言消除的清单**。修复路线图 §8 的 P2 就是逐行消灭它。

### 2.5 一个可复用的判据（建议写进团队纪律）

> **同名即同源**：两个地方出现同一个业务名词（「完成」「健康」「第 5 步」「v3」），必须有一处是唯一定义、其余 import 或派生；否则必须有一条断言在它们分歧时变红。
> **判据自己也要有对拍**：任何新加的断言，必须附一条「把它要守的实现改坏 ⇒ 它当场红」的负向对拍；否则它只是装饰。

---

## §3 跨域矛盾专章：两域各自自洽，合起来不成立

> 本章是本文档与六份域报告**最本质的区别**。每条链都至少涉及两个域，每个域单独看都成立、都有证据，只有把它们的结论接起来才暴露出更大的问题。
> 四条链的严重度都高于其组成部分：**组成部分各自是 high，合起来是 blocker 或结构性缺陷**。

### 3.1 链 A · 批准链：Hob 可以单方面制造一条合法的「用户批准」

| 环节 | 来自 | 证据（已回源） | 单独看是什么 |
|---|---|---|---|
| ① 工具入口的回执校验可被自填 `source` 满足 | t4 P-01 | `tools.ts:2081` `'decided_by = "user"'` 是硬编码；`:2051-2058` 唯一校验是对自填字符串做正则；全仓无「读会话消息 / 比对 message id」的实现 | 「回执校验形同虚设」——high |
| ② 连那个入口都不必走 | t2 L-07 | `write_hob` 在**最低档** `ledger` 就有（`src/preset/tools.ts:1211-1213` `PERMISSION_TIERS.ledger = MODEL_TOOL_ALLOWLIST`）；`LEDGER_PATH_RE`（`hob-write.ts:163`）放行 `ledger/units/**`；而 `approvalDecisionProblems` 对 `source` 只要求非空（`pipeline.ts:439`） | 「守卫可绕过」——high |
| ③ digest 可自算 | t1 P-05 | `artifactDigestOf` 是 FNV-1a 双 32 位，注释自陈「integrity fingerprint, not a password hash」（`pipeline.ts:199-205`） | 「指纹不是签名」——high |
| ④ 写这条时还跳过结构校验 | t4 P-01 补 | `tools.ts:2107` `validateLedgerStructure: false` | 放大器 |
| ⑤ 还不过 `proceedGate` | t4 P-02 | `grep -n 'proceedGate(' src/modules/tools.ts` 仅 `:1306`（定义）/`:1582`（write_hob）；approve 体内零命中 ⇒ **归档 / 隔离 / pending 会话也能写「用户批准」** | 放大器 |

**合起来**：
```
Hob（任意会话，哪怕已被隔离）
  └─ write_hob('ledger/units/unit-x.toml', <一条 decision 单元>)
        · decided_by = "user"            ← 自己写
        · artifact_digest = <自算 FNV>    ← 自己算
        · source = "继续"                 ← 自己编
  └─ 三道检查全绿（approvalDecisionProblems / approvalStateOf / pipelineWriteProblems）
  └─ approvalStateOf → { state: 'approved' }
  └─ G1/G2 用户门打开 → 可建任务 → 可派活
```

**主控端到端复现**（`/tmp/probe19.mjs`，本次汇总未重跑，采信主控记录）：空账本 → 写 `R-001`（`ok:true`）→ 用 `clarify_legacy=pre-control`+`created_at=2026-01-01` 把 req 改成 `agreed`（`ok:true`）→ `write_hob` 写 `source="继续"` 的 `DEC-001`（`ok:true`）→ `approvalStateOf(R-001)` = `{"state":"approved"}`。**全程只用档 1 就有的 `write_hob`。**

**为什么这比三个 high 更严重**：
三个域各自只看到自己那一段，因此各自给的是「校验不严」「守卫可绕过」「指纹弱」。但**「被校验方即写入方」**这个结构一旦成立，任何字段级校验都救不回来：
- 加签名？签名密钥也在 Hob 手里。
- 加 message id？Hob 一样能读到消息内容。
- 加强正则？正则在被绕过的那条路径上根本不跑。

⇒ 它是一条**架构级**缺陷，等级 **blocker**，且只有 §7.1 的 **C 选项**能实质修复。

**归属**：`S-01`（自证形态）为主条；`S-02`（自填豁免）是它的前置条件，`T-06`（批准写入豁免不必要）是放大器。

---

### 3.2 链 B · 自填豁免链：新写的 v3 条目可以给自己发豁免

| 环节 | 来自 | 证据 | 单独看是什么 |
|---|---|---|---|
| ① `legacy` 判据只看单元自己的字段 | t1 P-04 / t2 L-08 | `stage-controls.ts:271` `const legacy = (u) => txt(u.clarify_legacy) === 'pre-control'` | 「豁免判据是自填字段」——high |
| ② 唯一反制也是自填字段 | t2 L-08 | `legacyMisuse`（`:275-286`）要求 `created_at` 非空且 < `2026-11-06`；而 `created_at` **同样是写者自填** | 同上 |
| ③ 豁免面是 12 处、覆盖 11 类门禁 + L-1..L-4 闭环 | t2 L-08 | `grep -n 'legacy(u)' src/shared/stage-controls.ts` ⇒ `:290,329,422,443,521,613,630,702,779,831,932,953` | 放大器 |
| ④ legacy 隔离的是「派发」，不是「门禁」 | t1 §2.3 | `pipeline-view.ts:579-581` 对非 v3 任务返回 C-20（不能派）；但字段门禁对 legacy 直接 `return []` | 「隔离不彻底」——medium |

**本次汇总独立复现**（`/tmp/syn_probe_exempt.mjs`，直跑本仓 `stageFieldProblems`）：

| 用例 | 输入 | 输出 |
|---|---|---|
| A · 正常 v3 需求（有阻塞问题、假设 pending、无例子、无验收条件） | 无豁免字段 | **4 条**：`C-1 阻塞问题`、`C-2 假设 pending`、`C-1 无关键例子`、`C-1 无验收条件` |
| B · 同一单元 + 自填 `clarify_legacy='pre-control'` + 自填 `created_at='2026-01-01'` | 两个字段都是写入方自己填的 | **`[]`（全部放行）** |

**合起来**：
一条 **2026-11 新写的 v3 需求**，只要多写两个字段，就能一次性关掉：C-1/C-2/C-3/C-4/C-5/C-6/C-7/C-12/C-13/C-14/C-16/C-17/C-25/C-26/C-27/C-28/C-29 + L-1..L-4。
**「v3 契约」在账本层是可以被自己声明的字段绕过的。**

**关键澄清（防止误读）**：G1/G2 的**用户批准**仍会拦（`stageApprovalProblems` 里 legacy 需求报 C-18，t1 已实测确认）。所以危害的准确表述是「**内容质量门禁全关**」，不是「批准门禁全关」。与链 A 叠加后，批准门禁也可被绕——两条链接起来才是完整的攻击面。

**归属**：`S-02`。

---

### 3.3 链 C · 派活绕过链：任务图有洞照样能派活，且面板显示「卡住」但说不出卡在哪

| 环节 | 来自 | 证据 | 单独看是什么 |
|---|---|---|---|
| ① 多轨首次派发时门禁不跑 | t3 D-03 | 门禁在 `orchestrator.ts:8837`；门禁内 `tools.ts:881-886` **从盘上**找计划；计划写盘在 `orchestrator.ts:4816`（**门禁之后**）；找不到计划 ⇒ `tools.ts:934-936` 返回 `{blocked: undefined}`；想「先落盘再派」被 `duplicate-plan`（`:4024-4029`）拒 | 「多轨是唯一能绕过任务链门禁的入口」——high |
| ② G3 不进任何派活闸门 | t1 P-03 / t3 D-04 | `pipelineDispatchProblems`（`pipeline-view.ts:570-644`）**全文无 `taskGraphOf`**；逐项排除 `stageFieldProblems` / `ledgerClosureProblems` / 就绪度三处兜底，均不看 `depends_on` 的环与悬空 | 「任务图只是展示层」——blocker |
| ③ 面板看不到 G3–G6 的 blockedBy | t3 D-04 | `requirement-chain.ts:521-540` 只在 `G1-requirement`/`G2-plan` 把 `pipeline.blockedBy` 注入 `next`；`project-panel.tsx:95-113` 对 G3–G6 一律 `return chain.next`；渲染点 `:2654-2663` 在 `blockers.length===0` 时印「**卡在哪：没有主阻断**」 | 「拒绝理由没有出口」——high |

**合起来的三段式**：
```
任务图有环 / depends_on 指向不存在的 id / 某条 acceptance_criteria 没有任务覆盖
  ├─ 单目标派活：pipelineDispatchProblems 不查图 ⇒ 放行
  ├─ 多轨首次派活：门禁根本没跑 ⇒ 放行
  └─ 面板：显示「G3 卡住」（pipeline.blockedBy 里有），但「卡在哪」那行写「没有主阻断」
⇒ 系统既放行了，又给出了一个自相矛盾的读数
```

**为什么这比 t1 原表述更严重**：t1 的疑点 (c) 写的是「编排侧拒绝派活，但界面上没有可读原因」。t3 的复核证明**前提错了**——G3 根本不拒绝派活。所以真实形态是「**面板给出假信号（说卡住、说不出卡哪）+ 系统实际放行**」，比「拒绝但看不到原因」更坏：读面板的人会先怀疑面板，从而**推迟发现真绕过**。

**归属**：`R-05`（G3 不进闸门）+ `T-08`（面板假信号）+ `R-28`（多轨门禁空转）。三条必须**同批修**，单修任一条都不改变攻击面。

---

### 3.4 链 D（主控裁定）· legacy 投影的语义分裂：同一「第 5 步」的状态源与条目源是两个集合

> 本条由主控在补充指令中裁定，t5 已正确把主体移交给 pipeline/ledger 域。

| 事实 | 位置 | 内容 |
|---|---|---|
| 声明 | `requirement-chain.ts:117` | `{ step: 5, name: '验收核对', kind: 'acc' }` |
| 状态源 | `requirement-chain.ts:307-311` | 第 5 步的 `displayState` 取 `chain.accs` / `groups`（ACC 的判决） |
| 条目源 | `requirement-chain.ts:349` | `d.step === 5 ? chain.verifications`（技术验证） |
| 计数 | `:391` | `total = items.length` ⇒ 条目源是 verifications ⇒ legacy 账本通常 0 |
| 客户端渲染 | `project-panel.tsx:2600-2612` | 同一行同时印「✅ 已完成」+「0/0」+「这一步还没有条目」 |

**为什么是「语义分裂」而不是「客户端 bug」**：
- 在 v3 里，第 5 步 = 技术验证（verification）、第 6 步 = 产品验收（acc）——**两者是不同的东西**；
- 在 legacy 5 步里，「验收核对」这一步**同时承担**这两者（旧语义里它就是产品验收，verification 是 v3 才独立出来的）；
- 于是状态源和条目源被拆到了两个不同的集合上：**状态按 acc 算，条目按 verification 取**。

**主控裁定**：**legacy 第 5 步应以 acc 为准**（「验收核对」在旧语义里就是产品验收），条目也改取 `accs`。
**但这条不能单独做**：t5 已正确指出，若改成装 acc，客户端 `STAGE_KIND_BY_STEP`（`project-panel.tsx:148-156`）必须同步改——否则 ACC 状态会被拿去查 verification 标签表，且 `stageStatusLabel` **不会返回 `known:false`**（ACC 的状态集是 verification 的**真子集**，`stages-index.ts:49-50`），界面上不会出现「判不出」，只会**安静地换成另一个词**。

⇒ 记为一条**联动修复项 `R-08`**：服务端（`requirement-chain.ts` 两处）+ 客户端（`STAGE_KIND_BY_STEP`）必须**同批改**。
⇒ 「怎么证明修好了」给一条断言（§5.1 `R-08`）：**legacy 链第 5 步的状态源与条目源必须是同一个集合**。

---

### 3.5 四条链的共同结构

| 链 | 被绕过的承诺 | 自证点 | 出口分裂点 |
|---|---|---|---|
| A 批准 | 「用户批准必须由用户给出」 | `decided_by` 由被批准方写 | 工具入口有校验 / 账本层无校验 |
| B 豁免 | 「v3 条目必须满足 v3 契约」 | `clarify_legacy`+`created_at` 都由写入方填 | 派发隔离 / 门禁不隔离 |
| C 派活 | 「先拆清任务图再开工」 | G3 判据只喂给视图，不喂给闸门 | 面板说卡住 / 系统放行 |
| D legacy 投影 | 「一步只装一类单元」 | 状态与条目各选一个集合 | 状态按 acc / 条目按 verification |

**共同结构一句话**：**判据的输入、判据的消费方、判据的出口，三者互不同源**——正好是 §2 三种形态在跨域尺度上的重演。

---
