# dsh-hob 现行架构

> 本图只表达稳定层次和依赖方向，不写会漂移的文件数。
> ⚠ **本文件里有几处是机检的**（`check:architecture`，五组）：
>   · §2.1 的分层规则与 §2 的分层图方向（A 组）；
>   · C 组登记的文件规模（只准降不准升）；
>   · **本文件里每一处 `文件:行号 符号` 形态的引用**（E 组）—— 行号漂了会红。
>   ⚠ 改了这些规则**必须同批改判据**，否则文档与判据会各说各话。
>   其余（§三 主链路叙述、§六 文档生命周期）仍是人读约定，⛔ 没有机检覆盖。
> 旧 v4 图已移至账本区
> `archive/2026-11-03-architecture-refresh/legacy/`，只作历史参考。

## 一、全局关系

```mermaid
flowchart TB
  User[用户] <--> Hob[Hob 项目总代理]
  Hob <--> Ledger[(项目账本)]
  Hob --> Dispatch[会话调度与闭环编排]
  Dispatch <--> Dev[开发 / 实施会话]
  Dev --> Result[运行记录与回传]
  Result --> Hob
  Hob --> Acceptance[独立验收]
  Acceptance --> Ledger
  Ledger --> Views[Current / 六阶段进度（1..6） / 风险与收口（G6） / 注意力 / 资源视图]
  Views --> Hob
```

“总代理”是用户授权范围内的项目协调权。Hob 不实现业务代码、不执行命令；
开发会承担实施，验收由独立于实施者的判决产生。

委托关系里，用户始终保留目标、产品取舍、可接受代价与不可逆动作的决定权。Hob 只在
这份授权内组织项目；它不能扩大自己的权限，也不能代替用户接受自己的实现。

## 二、代码分层

```mermaid
flowchart TB
  Host[DSH 宿主]
  Entry[src/index.ts · dsh-hob 入口]
  Modules[src/modules · 宿主模块与只读路由]
  PresetScope[src/preset · Hob 预设作用域]
  Server[src/server · 落盘 / 守卫 / 编排 / Effects]
  Shared[src/shared · 纯函数与线协议]
  Client[src/client · 浏览器 UI]
  Ledger[(ledger/units/ · index + unit-*.toml shards)]

  Host --> Entry
  Entry --> Modules
  Entry --> PresetScope
  Modules --> Server
  Modules --> Shared
  PresetScope --> Server
  PresetScope --> Shared
  Client --> Shared
  Modules --> Ledger
  Client --> Ledger
```

### 2.1 层职责与禁止事项（⚠ 由 `check:architecture` 机检）

| 层 | 职责 | **禁止** |
|---|---|---|
| `src/shared/` | 纯函数与线协议：**给定输入必得同一输出** | ⛔ 不许依赖 `server/` `modules/` `preset/` `client/`（可用 `node:` 内置，但只有当消费方在服务端时） |
| `src/server/` | 落盘 · 守卫 · 编排 · 投影 · Effects | ⛔ 不许依赖 `client/` |
| `src/preset/` | Hob 预设作用域：装配与降级 | ⛔ 不许被 `modules/` 依赖（反向） |
| `src/modules/` | 宿主模块与只读路由 | ⛔ 不许依赖 `client/` |
| `src/client/` | 浏览器 UI | ⛔ 不许依赖 `server/` `modules/`（**实测可达性分析：0 处**） |
| `src/*.ts`（根） | `index.ts` 入口 · `config.ts` **全层共用契约** | 不作业务层；改动等于改对外契约 |

**四组机检断言**（`check:architecture`，每族自带负向对拍）：

```
A 分层方向   shared 无反向依赖 · client 不碰 server/modules · server 不碰 client
B 依赖成环   import 图零环（⚠ 含 import type 的环 —— 类型环同样让分层失真）
C 文件规模   8 个重点文件不超登记上限，**只准降不准升**（零余量）
D 单源权威   ledgerHealthOf / proceedGateFor 全仓**各有唯一实现**
E 文档引用   本文件里每处 `文件:行号 符号` 都必须在该行真实出现（行号漂了会红）
```

⚠ **为什么 B 组连类型环也禁**：`stages-index ↔ panel-summary` 曾经只有一个 `import type` 在往回走，
看起来无害；但类型环会让「谁是这一层的上游」变得说不清，且绕过任何只查运行时的判据。
⇒ 2026-11-11 把共享的行类型提到 `panel-row-types.ts`，环从图上**真正消失**，而不是加白名单豁免。

⚠ **拆分 `orchestrator.ts` 的唯一安全顺序**（2026-11-11 实测）：

```
① 先搬「零闭包状态依赖」的（readHandoffs / closedForTrack / targetPresetOf / wsRootOfSession …）
   ⇒ 只依赖模块级导入或注入的服务对象 ⇒ 移动是行为等价的。
② 再谈「碰 watches 的」（84 处引用）—— 那要先把这些共享可变状态改成显式 context 对象，
   属行为等价性重构，⛔ 不能与 ① 混在一批做。
```

⚠ **反例（实测）**：把 `targetPresetOf` 的总线调用整个搬走，会让 `check:orch` 的 **J3** 报
  `经总线入口=false` —— 那条判据的锚点就是本文件里的 `.presetOf(` 调用式。
  ⇒ 正确做法：**归约搬走、取值留下**，并在包装器上写清「这个调用点是判据锚点」。

⚠ **为什么 D 组只登记 2 个符号**：它们各自代表一类**唯一判据** ——
`ledgerHealthOf`（账本健康，4 个出口都调它）与 `proceedGateFor`（执行层闸门，3 个工具都调它）。
REVIEW 的 R-02（「链完成了吗」曾有 5 份实现）就是这条纪律被违反的后果。
新增「必须唯一」的符号时，同批加进 `SINGLE_SOURCE`，⛔ 不要等到出问题才补。

## 三、两条主链路

### 1. 创建 Hob 会话

```text
UI 新建入口
  → session-create 一次性票据
  → 建空白会话
  → 写入逐会话可读档与工作方式
  → 隔离回读确认
  → 用户进入会话
```

### 2. 推进项目

```text
用户需求
  → Requirement（v3，内容完成）
  → G1 用户确认需求当前修订
  → Change（v3，内容完成 + 风险评定）
  → G2 用户确认方案当前修订并选择路径
  → Task graph（v3，DAG + 覆盖）
  → Dispatch（任务、父方案、承接需求全部过闸）
  → Run / 回传（运行态事实自动投影成账本 RUN / TSK 状态）
  → Acceptance / Evidence
  → Current 与下一步
```

运行态与账本是**两个事件源、一条事实链**：派发 / 回传 / 判决先在运行态发生，
再由 `ledger-projection.ts` 的纯函数算出确定性账本操作，最后由 `projection-writer.ts`
经 `writeHobFile` 同一道守卫落盘。投影失败**不回滚**已发生的运行态事实，
但必须在 `hob_orch_status` 与工具返回值里如实报出「账本未落」。

阶段字段与完成口径仍在 `stage-controls.ts` 定义；单条需求的「当前阶段」、
当前闸门与责任方**只由 `pipeline-view.ts` 提供**。`/stages` 的 `pipelines` 与
`/requirement-chains` 的 `pipeline` 都是这份视图的投影，面板不得另算一套。
第 3 步要求任务图无环、无悬空依赖且每个验收条件都有任务覆盖（G3/C-5）；
第 4 步要求 `RUN returned + TSK built` 同时成立；第 5 步是独立技术验证（G4/C-25）；
第 6 步是产品验收（G5）；第 7 列是按风险启用的交付收口（G6/C-27）。全局 `stages`
数组只作为账本清单与历史展开，不回答「当前在第几步」。

### 3. Pipeline v3 · 六阶段 + G6 交付收口门（⚠ `STAGE_NAMES` 是 7 项，不是 6 项）

```
src/shared/stage-controls.ts:46  STAGE_NAMES = {
  requirements 需求规格 · plan 实现方案 · tasks 任务图 · execution 任务执行 ·
  verification 技术验证 · acceptance 产品验收 · closure 交付收口
}
```

⚠ **「六阶段」与「7 项」不矛盾，但必须说清**（此前本节标题只写「六阶段」，读者看不出到底几项）：

| 说法 | 指什么 | 谁的权威 |
|---|---|---|
| **六阶段** | **业务阶段**：需求 → 方案 → 任务图 → 执行 → 技术验证 → 产品验收 | `pipeline-view.ts` 的 `activeStage` 只落到 1..6 |
| **第 7 项 `closure`** | **交付收口**，是产品验收之后的**风险启用门**（G6），⛔ 不冒充第七个业务阶段 | 按风险启用，`closurePending` 与 `activeStage` 互斥 |

⇒ 读法：**业务阶段 6 个 + 收口门 1 个 = `STAGE_NAMES` 7 项**。
  ⚠ 任何「六阶段已走完」的文案（如面板 `stages.sixStagesDone`）指的都是 1..6，
    ⛔ 不含 `closure` —— 别把它读成「第 7 步没做」。

- 正式六阶段：需求 → 方案 → 任务图 → 执行 → 技术验证 → 产品验收。
- 交付收口是产品验收后的风险启用门，不冒充第七个业务阶段。
- 第 1、2 步各有独立用户闸门：`G1-requirement` / `G2-plan`。
- 内容完成、状态写成 `agreed/settled`、或用户只说「继续 / 可以」，
  都**不构成批准**。批准必须是一条独立的 `decision` 审计单元：
  `decision_kind=stage-approval`、当前 `artifact_revision`、内容摘要、
  `decided_by=user`、用户回执原文与时刻。
- `draft/proposed` 属于 Hob 仍在起草，允许保存但不能表达成“等用户确认”；
  内容写到 `agreed/settled` 后才进入 G1/G2 等用户回执。
- 需求或方案内容改变必须递增正整数 `revision`；旧批准随即因版本或摘要不符而
  `stale`，必须重新确认。方案批准还必须选中当前 `path_options` 中的路径。
- v3 是 clean cut：新 `req/change/task/run/verification/acc/closure` 必须带
  `pipeline_version="v3"` 与 `revision`。v2 旧条目保留只读展示，不回填、不伪造批准，
  也不得进入 v3 派发。
- 风险由 `risk-policy.ts` 唯一推导：硬触发与单维下限取最高档，不允许平均降档；
  固有风险决定评审深度和 G6 档位，残余风险决定验收/交付是否可接受。
- 每条硬触发必须有六段式事实（事实 / 影响 / 证据 / 控制 / 残余），并与方案事实摘要绑定；
  任务执行风险（`task_risk`）独立决定拆小、隔离、独立复核与串行，同路径任务不得并行。
- G6 必须绑定 G5 接受、所用风险评定与残余风险决定；`skipped` 也留下理由与决定者。
- 派发门禁同时检查任务、父方案、方案承接的每条需求、方案未被取代与任务书完整；
  任一闸门未过即拒绝，并返回可读原因。

跨进程副作用使用 Effects/Outbox；运行态落在账本区 `runtime/`，不进入 Git。

### 4. 账本契约与投影边界

账本单元的 `kind/status` 是封闭契约。结构校验只有 `ledger-validation.ts` 一份，
阶段接口、就绪度门禁和写入守卫都调用它；字段与关系门禁仍在 `stage-controls.ts`。
方案承接需求统一读取 `req_ids / addresses / requirement_coverage`，
不允许各视图只认其中一种字段。

运行态投影按**账本根**串行：一次投影包含“读全账本 → 分配编号 → 写多分片”，
单个文件队列不足以保护它。回传只迁 `RUN.returned`；只有带小步验证读数时才把
`TSK` 迁到 `built`。单目标派活必须给真实 `TSK-*`，自由描述不能代替账本对象。

## 四、权威入口

### 4.1 核心对象

| 对象 | 权威位置 |
|---|---|
| 插件与模块入口 | `src/index.ts`（**只做登记**，一模块一行） |
| 配置 schema | `src/config.ts`（全层共用的契约面） |
| Hob 工作流 | `preset/dsh-hob/workflow.toml` + `spec/` |
| 预设生成物 | `preset/dsh-hob/gen/` |
| 项目账本 | `<ledgerHome>/<workspaceName>/ledger/units/` |
| 当前视图 | `<ledgerHome>/<workspaceName>/ledger/spec/current.md` |
| **业务判定索引** | `kit/drafts/judgement-index.md`（由 `check:judgement-index` 机检） |
| 权威阶段接口 | `POST /api/dsh-hob/stages` |
| 按 ID 资源接口 | `POST /api/dsh-hob/ledger-resource` |
| 运行态 | `<ledgerHome>/<workspaceName>/runtime/` |

### 4.2 模块清单（⚠ 此前只列了 2 个路由，实际 18 项）

⚠ **本节由 `src/index.ts` 的登记顺序派生**。加模块 = 加文件 + 入口登记一行，
  然后**同批**把这一行补上（⛔ 别让它长期落后于代码）。

| # | 模块 | `name` / 服务 | 形态 |
|---|---|---|---|
| 1 | `session-policy-service.ts` | `SESSION_POLICY_SERVICE` | 入口直接 `install`（两侧作用域都要用） |
| 2 | `modules/tools.ts` | `dsh-hob-tools` / `hobTools` | 可开关业务模块（`MODULE_REGISTRY`） |
| 3 | `modules/bus.ts` | `dsh-hob-bus` / `hobBus` | 可开关业务模块 |
| 4 | `modules/orchestrator.ts` | `dsh-hob-orchestrator` / `hobOrchestrator` | 可开关业务模块（⚠ `apply()` 闭包 6800 行；**无状态读数**已拆到 `orchestrator-phase-readings.ts`） |
| 5 | `modules/settings.ts` | `dsh-hob-settings` | 可开关业务模块 |
| 6 | `modules/session-create-channel.ts` | `dsh-hob-create-channel` | 原子入口（无独立开关） |
| 7 | `modules/session-policy-route.ts` | `dsh-hob-session-policy-route` | 只读路由 |
| 8 | `modules/tasks-progress-route.ts` | `dsh-hob-tasks-progress-route` | 只读路由（旧进度表兼容） |
| 9 | `modules/exec-progress-route.ts` | `dsh-hob-exec-progress-route` | 只读路由 |
| 10 | `modules/stages-route.ts` | `dsh-hob-stages-route` | **权威**阶段接口 |
| 11 | `modules/ledgers-route.ts` | `dsh-hob-ledgers-route` | 只读路由 |
| 12 | `modules/requirement-chains-route.ts` | `dsh-hob-requirement-chains-route` | 只读路由 |
| 13 | `modules/ledger-resource-route.ts` | `dsh-hob-ledger-resource-route` | 只读路由（按 ID 取全文） |
| 14 | `modules/work-plans-route.ts` | `dsh-hob-work-plans-route` | 只读路由（计划/轨道/等待关系） |
| 15 | `modules/unseen-tools-route.ts` | `dsh-hob-unseen-tools-route` | 只读路由 |
| 16 | `modules/live-route.ts` | `dsh-hob-live-route` | 只读路由（SSE 推送） |
| 17 | `server/live-hub.ts` | `LiveHub` | 被 16 引用，非独立模块 |
| 18 | `client/*` | 浏览器半边（`lib/client.js`） | 独立产物，不进服务端模块表 |

⚠ **准入规则**（`src/index.ts` 头注释的三条架构性质）：
```
① 一个模块一个文件，各自 apply(ctx, config)；
② 依赖靠 inject 声明 ⇒ 依赖不在就不激活，不报错、不阻塞整插件；
③ 资源靠 ctx.effect 挂 ⇒ 卸载自动清理。
```
这三点由 `check:modules`（真产物启停探针）守着。

## 五、命名原则

- `dsh-hob`：包、插件 entry、设置 namespace、HTTP 路由前缀。
- `Hob`：项目总代理预设和角色。
- `hob_*`：Hob 对外行为工具。
- `G- / R- / CHG- / TSK- / RUN- / ACC- / EVD- / RSK- / DEC- / CAP-`：账本稳定 ID。
- `Current`：当前工作入口。
- `stages`：权威阶段清单与七列汇总面；`tasks-progress` 仅保留兼容。

完整术语见项目根 `TERMINOLOGY.md`。

## 六、文档生命周期

文档按职责分层，同一事实只允许一个权威落点：

| 文档层 | 权威位置 | 写什么 | 不写什么 |
|---|---|---|---|
| 用户入口 | `README.md` | 安装、使用、限制 | 当前项目状态 |
| 术语契约 | `TERMINOLOGY.md` | 固定名称与边界 | 实现细节 |
| 架构说明 | `kit/drafts/architecture-overview.md` | 稳定层次与依赖方向 | 会漂移的文件数 |
| **业务判定索引** | `kit/drafts/judgement-index.md` | 41 个判定函数**在哪 / 判什么 / 在哪一层** | 判定依据的论证过程（在源码注释里） |
| 行为规格 | `preset/dsh-hob/spec/` · `ledger/spec/` | 当前可观察行为 | 历史过程 |
| 机器状态 | `ledger/units/` 索引分片 | 唯一状态与正式关系 | 长篇说明 |
| 派生视图 | `ledger/gen/` · `ledger/spec/current.md` · `REQUIREMENTS.md` | 从索引生成的人读汇总 | 手工状态更新 |
| 方案变更 | `ledger/changes/` | 提案、差异、任务边界 | 长期现状 |
| 历史追溯 | `volumes/` · `archive/` | 已退役正文与原始证据 | 当前执行依据 |

更新规则：

1. 当前事实变化时**替换原正文**，旧版本归档；⛔ 不在末尾持续追加“补充说明”。
2. 同一主题只允许一份现行文档；被替代文档必须标明 `superseded_by` 或归档位置。
3. `gen/`、`Current`、`requirements.md`、`portfolio.md`、`stages.md` 只读生成物，⛔ 手改。
4. `PROJECT.md` 只做 ≤200 行薄地图；状态与计数留在索引或生成视图。
5. 新文档增加前先回答“能否更新现有同主题文档”；只有职责不同才拆新文件。
6. 历史文档可以保留旧称和旧路径，但必须明确标为只读追溯，⛔ 不再作为当前判断依据。

需求变更沿 `Goal → Requirement → Change → Task → Run → Acceptance` 回流；
任何一层缺失由账本判据点名，而不是靠新增一份说明文档补洞。