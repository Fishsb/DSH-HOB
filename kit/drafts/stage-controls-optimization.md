# HOB 项目控制优化方案 v1

> 日期：2026-11-06 ｜ 性质：**实施方案**（可执行、可验收），不是历史沿革记录。
> 依据：用户 2026-11-06 对五阶段内部控制的裁定（`preset/dsh-hob/spec/origin-user-2026-11-06-stage-controls.txt`）
> 当前基线：`tsc --noEmit` exit 0；`check:stage-controls` **39 通过 / 5 失败**；工作区有在途修改（不覆盖）。

## 一、一句话

HOB 的价值不在多写几段提示词，而在**每个阶段的出口都有一道可核对的门**：需求不清不进方案，
方案没比较不拆任务，任务不自足不派单，回传不等于验收，任何后段推不动都能指回**最早失效的阶段**。
本轮只做这件事，并把“账本越写越厚”从依赖自觉改成**结构上写不进去**。

## 二、当前真实状态

### 2.1 已经成立

| 能力 | 事实 |
|---|---|
| 五阶段骨架 | `workflow.toml` 的 `order = 1..5`，第 4/5 步 `actor_role` 不同 |
| 七类输入 + 不变量 | 7 条 intake 各带 `test` / `first_move` / `source`；6 条不变量（3 原 + 3 新） |
| 阶段控制纯函数 | `src/shared/stage-controls.ts` 覆盖 C-1…C-11，纯函数、零 I/O |
| 历史豁免 | `clarify_legacy = "pre-control"` + `created_at` 早于 2026-11-06；新单元借用即 C-11 |
| 作用域门禁雏形 | `evaluateGate({ action, scope, units })` 已存在，`write-repair` 直接放行 |
| 工作计划 | `WorkPlan` + `dispatchPlan` 逐轨真派发；单轨/多轨/自动有校验器 |
| 看护意图 | `guardIntentOf` / `guardIntentForOwner` 从**计划事实**派生，不读模型自述 |
| 用户停止 | `stop` 落盘 `runtime/orch-stopped.json`，跨重载读回；界面停止也由日志派生 |

### 2.2 还没接上（本轮对象）

| # | 缺口 | 证据 |
|---|---|---|
| G1 | 运行时仍是**全局**门禁：任一缺口阻塞全部写入与派单 | `src/modules/tools.ts` 的 `stageGateOfLedger` 用全量 `stageControlProblems` |
| G2 | `ACC-062` 缺 `acceptance_session` / `verification_refs` / `example_results`，卡住全账本 | 3 条 C-7 失败 + SC-10 真实账本被拒 |
| G3 | `accept` / `send-back` 只校验 `taskId` + `basis`，不读验收单元 | `orchestrator.ts` 判决分支 |
| G4 | `plan-complete` 不校验轨道终态与汇合验收 | `closePlan` 只查 `joining` |
| G5 | 契约仍写 `acceptance.who = "Hob"`，与独立验收口径不一致 | `workflow.toml` 的 `acceptance.judged_by` |
| G6 | 修复写与推进写共用同一闸门：补 blocker 反被 blocker 拦住 | 所有真写都走 `stageGateOfLedger` |
| G7 | 测试夹具没跟新判据 | `check-stage-controls.mjs` 的 `accGood` 缺新字段 |

### 2.3 明确不做

- 不加第六阶段；回流只落五阶段 + 环境单列。
- 不加工具名；控制参数挂在 `hob_orch_control` 上。
- 不批量回填历史证据，不伪造 `verification_refs` / `example_results`。
- 不用全局健康度阻塞无关任务。

## 三、目标态

1. **门禁按作用域生效**：派 `TSK-080` 只看这条链；别处的缺口只进健康报告。
2. **修复与推进分开**：`write-repair` 可补当前 blocker；`write-forward` 仍被拦，修复不能变成绕闸。
3. **验收有独立证据**：独立会话 + 技术读数 + 用户例子逐条结果 + 产品确认；验收者 ≠ 实现者。
4. **收口有终态判据**：还有 running 轨道时 `plan-complete` 必须拒绝。
5. **契约同源**：`workflow.toml`、生成物、判据三处口径一致。
6. **历史只读豁免**：旧数据不阻塞也不作新证据；新数据必须过门。

## 四、分波实施

### Wave 1 · 门禁能放行、也能拦住

| 任务 | 落点 | 验收判据 |
|---|---|---|
| W1-1 结构化门禁 | `src/modules/tools.ts` 增 `stageGateAtLedger(root, { action, scope })` | 无关 task 作用域不被别的需求缺口阻塞 |
| W1-2 修复写分离 | `write_hob` 增 `gateIntent` / `repairOf` | 有 blocker 时 `write-repair` 可写；`write-forward` 仍拒 |
| W1-3 判决接门禁 | `orchestrator.ts` 的 accept / send-back | 无 ACC、父不对、自己验自己、缺证据 ⇒ 拒，且不改运行态 |
| W1-4 收口接终态 | `plan-complete` | 有 running / pending 轨 ⇒ 拒；全终态才收 |
| W1-5 历史验收迁移 | `ACC-062` + 检查脚本 | 只按真实报告补字段；无证据则显式历史豁免 |
| W1-6 夹具补全 | `check-stage-controls.mjs` | `accGood` 带全字段；补 5 条负向 |

**出口**：`check:stage-controls` 全绿、`tsc --noEmit` exit 0、真实账本不被历史条目全局卡死。

### Wave 2 · 账本卫生与证据结构

| 任务 | 落点 | 验收判据 |
|---|---|---|
| W2-1 结构化证据 | `verification_refs` / `example_results` / `validation_refs` 的最小字段 | 缺字段的新 ACC 不能 pass |
| W2-2 归档规则 | 摘要 / 任务书 / 报告进 `archive/<日期>-<slug>/` | 活跃区只留当前方案；引用缺失即 C-9 / C-10 红 |
| W2-3 需求根收敛 | `REQUIREMENTS.md` 为派生视图；退役留六项 | 根上不再两份需求清单；退役项不作活跃依据 |
| W2-4 文档分层 | 需求 → 方案 → 任务 → 证据 → 归档，一层一处 | 同一事实只有一个权威位置 |

### Wave 3 · 工作方式与看护

| 任务 | 落点 | 验收判据 |
|---|---|---|
| W3-1 真实多轨 | `dispatchPlan` + 面板 | 多会话档确实派出 ≥2 条互斥轨；单会话档第二条写轨失败 |
| W3-2 看护三态 | `guardIntentOf` | 完成 / 等用户 / 未结算可分；stop 后重启仍 stopped |
| W3-3 轮末自检 | `workflow.toml` 三条 guard 规则 | 模型结论与系统事实冲突时，以系统事实为准 |

### Wave 4 · 发布与回归

| 任务 | 落点 | 验收判据 |
|---|---|---|
| W4-1 全量检查 | `check:all` | 全族通过，计数下界同步 |
| W4-2 构建与实例 | `npm run build` + WSL DSH 重启 | 实例加载新产物，冒烟通过 |
| W4-3 独立验收 | 独立会话 | 验收者 ≠ 实现者；逐条对需求 |

## 五、需要拍板的三件事

1. **`ACC-062` 怎么处理**：报告已有独立会话与五项复验读数。
   - 推荐：按报告补真实字段（`acceptance_session = session-independent-1793906283`，`verification_refs = ["EVD-071"]`，`example_results` 逐条取自报告）。
   - 备选：给 ACC 增 `acceptance_protocol = "pre-independent"`，只读豁免、不补字段。
2. **独立验收的边界**：同一模型、不同会话是否算独立。
   - 推荐：算。判据是**会话不同 + 证据可复核**，不是模型不同。
3. **多会话档无互斥范围时**：是否自动降单轨并显示原因。
   - 推荐：是，且面板必须显示降级原因，不许静默。

## 六、风险与取舍

| 风险 | 处理 |
|---|---|
| 放宽后“谁都能过” | 只放宽作用域，不放宽判据；`write-repair` 必须指向真实 blocker |
| 历史豁免被新数据借用 | C-11 用 `created_at` 挡住；豁免只读 |
| 多轨并行写坏同一文件 | 首版串行化写轨，`serialized` 留依据，面板显示原因 |
| 看护把用户停止当“没完成” | `stopped` 优先级最高，跨重启持久化 |
| 文档继续堆积 | 活跃区只留当前方案；过程件进 archive；引用缺失即红 |

## 七、本轮完成定义

- [x] `stageGateAtLedger` / `stageGateOfTask` / `stageHealthOfLedger` 存在；作用域门禁有负向测试
- [x] `dispatchGateAtLedger` 接入 `hob_send` / `hob_spawn` / `hob_dispatch`：按任务或活动计划判定；无任务无计划时只报健康、不硬拦
- [x] `write_hob` 增加 `gateIntent` / `repairOf`，修复写可区分且必须命中真实 blocker
- [x] `accept` 接 `acceptanceGateOfLedger`：无 ACC / 缺独立证据 / 自己验自己 ⇒ 拒
- [x] `closePlanProblems` 接入 `closePlan`：有 running 轨或 failed 轨 ⇒ 拒
- [x] `ACC-062` 按真实验收报告补 `acceptance_session` / `verification_refs` / `example_results`
- [x] `workflow.toml` 的验收/任务判据与生成物、判据三处一致
- [x] `check:stage-controls` 56/56、`check:work-plan` 42/42、`check:orch` 347 通过
- [x] `check:all` 39 族全通过（2716 处，2714 通过、2 处设计内跳过）
- [x] WSL 3080 实例已重启，`check:build` 面③「同步」，页面与两条路由冒烟通过

### 本轮顺带修掉的一个真缺陷

`check:orch` 打印 PASS 后**不退出**：SG / SH 两组的假宿主打开了看板 SSE 订阅，
测试收尾只关了服务端、没执行模块 effect 的清理函数，留下 `TCPSocketWrap`。
修法是在测试宿主里收集 `effect` 返回的清理函数，并在每个用例的 `finally` 调用；
⛔ 未改生产代码的 SSE 实现。修复后 `check:orch` 正常退出（exit 0，17 秒）。

## 八、下一轮建议（Wave 2 起）

1. **账本卫生**：现有 `checkDocLifecycle` 已守“现行正文不堆日期标题 / 生命周期指针可核 /
   活跃 change 只留 proposal.md”，I12 已守退役六项与不可复活。下一步不是再加规则，
   而是把「何时退役」写进五阶段出口：需求被替代时同一轮必须写退役六项并更新 `REQUIREMENTS.md` 视图。
2. **文档分层**：需求 → 方案 → 任务 → 证据 → 归档，每层只留一个权威位置；
   活跃区出现过程件即红（已有 `checkActiveChangeZone` 可复用）。
3. **阶段小步验证**：执行侧每个子任务完成即跑对应检查，验收侧只做独立复核（借鉴 ChatDev）。
4. **任务书自包含**：派单包携带目标、上下文、工作区、交付物、验证方式，减少执行会话读全账本。

### 第二波已落地（2026-11-06）

- **C-12 证据可逐条回溯**：`example_results` 必须是 `EX-id | 结果 | 证据` 三段式；
  非 `pass` 的例子必须带 `EVD-` / `archive/` / URL 引用。⛔ `["都通过了"]` 不再算证据。
- **C-13 有条件通过**：`release_ready=no` 必须有非空 `liens`，整改项格式含负责人 / 期限 / 影响 / 关闭证据。
- **C-14 发布子门禁**：`release_ready=yes` 必须同时给出构建、重启、冒烟三类证据；
  插件类交付光有单测不算可交付。
- **账本字段字典**补齐 `acceptance_session` / `verification_refs` / `validation_refs` /
  `example_results` / `nonconformance_refs` / `residual_risks` / `liens` / `release_ready` /
  `release_refs`，以及 change / task 的评审、测试策略、CI 字段。

### 第三波已落地（2026-11-06）

- **自动档真并行必须证明独立**：`auto` 档声明多条写轨并行（`serializeWrites=false`）⇒ 拒绝；
  默认的串行化路径照旧放行，⛔ 不误伤既有已验收行为。
- 看护持久化与重启语义此前已有真实验证（WPR-27/29/30/35/36），本轮未改动。

### 第四波已落地（2026-11-06）

- **C-14 发布子门禁**：`release_ready=yes` 必须同时给出构建、重启、冒烟证据；
  插件类交付不能只凭单测声明可交付。
- **独立验收两个交接件**：新增 `kit/templates/ACCEPTANCE-PACKET.md`（Hob 写，自包含验收包）
  与 `kit/templates/ACCEPTANCE-REPORT.md`（独立会话写，逐条例子结果 + 退回目标）；
  已登记进 `check-repo-rules` 必入库清单与 `kit/INIT.md` 说明。
- **机检守住交接件**：`SC-16` 逐段核两个模板，缺段即红。
- **C-15 高风险独立评审**：`risk_tier=high` 的变更必须有 `reviewer`（≠ `built_by`）与 `review_refs`；
  风险等级只收 `low / medium / high`。
- **C-16 证据可复跑**：`evidence_kind=command` 必须带 `command` 与整数 `exit_code`；
  `artifact` 必须带 `artifact_ref`；⛔ "我看过了"不再算证据。

### 本轮最终读数（2026-11-06）

- `npm run typecheck` / `npm run build`：exit 0
- `npm run check:all`：**39 族全通过**，2745 处断言，2743 通过、2 处设计内跳过
- `check:stage-controls`：**80/80**
- `check:work-plan`：45/45 · `check:work-plan-runtime`：37/37 · `check:orch`：347 通过
- WSL 3080：页面 200、`session-policy` 与 `work-plans` 路由正常、插件加载错误 0、
  `check:build` 面③「同步」

## 九、长期机制（2026-11-06 建立）

这一节回答的不是"这次修了什么"，而是**同类问题下次怎么被自动发现并阻止**。

### 9.1 账本分片增长

| 层 | 机制 | 触发点 |
|---|---|---|
| 诊断 | `SHARD` 断言：任一分片 > 读取上限的 **75%** 即红 | `check:gitignore`（每次 `check:all`） |
| 处置 | `npm run rebalance:ledger-shards --apply`：按 `[[unit]]` 边界重切，逐字节自证、写前备份 | 手动，一条命令 |
| 自证 | `SHARD-负向`：把某片抬到 90% ⇒ 同一阈值判定必报 | 同族 |

⚠ 目标片宽 44 000 B ⇒ 正常增长下离 65 536 B 上限仍有 33% 余量。

### 9.2 文档状态自相矛盾

| 层 | 机制 |
|---|---|
| 诊断 | `STATE0` / `STATE`：同一张状态表里，**同一事项编号**不得同时出现"待用户拍板"与"已认领/已定" |
| 口径 | 按表行首编号对齐，⛔ 不是"出现一个词就红"；只在同文件内对齐 |
| 自证 | `STATE0` 四组样本：矛盾必咬、单态放过、不同编号放过 |

### 9.3 计划长期滞留

| 层 | 机制 |
|---|---|
| 读数 | `workPlans()` 每条计划带 `ageHours` / `occupiesSlot` / `stale`（≥24h 非终态） |
| 界面 | 面板显示"已存在 Nh · 不占执行槽 · ⚠ 超过 24h 未收口" |
| 处置 | `hob_orch_control { action: "archive-stale-plan", planId, note }`：只收超时 + 责任人 + 原因，**不改 state**，原件移入 `abandoned/` |
| 自证 | `WPR-3c` / `WPR-3d`：字段真实产生；非责任人 / 无原因 / 未超时都拒绝；`state` 原样保留 |

⚠ 过期归档**不是** `completed` / `failed`：那两个是业务结果，没人管了不是任何业务结果。

### 9.4 检索与回流

| 层 | 机制 |
|---|---|
| 契约 | `research-before-return` / `research-records-finding` / `research-not-a-gate` 三条规则进模型面 |
| 要求 | 回流前先检索；每条检索写「来源 | 结论 | 适用判据 | 访问时间」；低风险有先例可直推但要点名先例 |
| 判据 | `check:workflow` F1 核 `source`；`check:stage-controls` C-10 核 `research_refs` 文件存在，C-16 核命令类证据可复跑 |

### 9.5 工作区根判不出

| 层 | 机制 |
|---|---|
| 兜底 | 工作计划路由：显式 `workspaceRoot` → `workspaceRegistry.sessionPaths` → 会话 cwd |
| 原因 | 历史会话已结束时 `wsRootOfSession` 读不到；空数组会被误读成"没有计划" |
| 自证 | 真实实例上 5 个历史会话逐个复核，均能读到各自归档 |
