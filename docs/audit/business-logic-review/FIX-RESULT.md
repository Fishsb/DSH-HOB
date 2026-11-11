# dsh-hob 修复工程 · 成果汇总

> **性质**：本文件是修复工程的**交付结论**，不是过程记录。
> **过程记录**见 `LEAD-VERIFICATION.md`（34 节，逐批复核证据）；**方案**见 `FIX-PLAN.md`；**缺陷清单**见 `REVIEW.md`（112 条）。
> **日期**：2026-11-10 · **基线**：commit `5ee0797`（分支 `codex/item-presentation`）

---

## §1 一句话结论

**REVIEW 的 112 条缺陷：106 条已修 · 3 条已排除 · 1 条已处理（保留+标注）· 2 条未完成。**

✅ 校验：106 + 3 + 1 + 2 = **112**。

### ⚠ 2026-11-11 订正：此前写的「108 条已修 · 剩余 0」是**错的**

逐条复核时发现两处与正文矛盾，本节原写「剩余 0」把它们吞掉了：

| 编号 | 级别 | 正文怎么说 | 真实状态 |
|---|---|---|---|
| **S-01** | **blocker** | §3.1 修法表下方明写：「⚠ **S-01 仍是 blocker**……批准工具仍由 Hob 调用、decided_by 仍是硬编码。根治要 C 选项」；§3.3 明写「**S-01 永久停留 blocker**」 | ⛔ **仍是 blocker**（A 方案只把攻击面从两条收窄成一条） |
| **R-01** | **blocker** | pipeline-view.ts:198 明写「第 1 段 / 共 3 段」，段 1 不改判定结果 | ⚠ **1/3 段**（段 2 宽限期、段 3 全量未做） |

⚠ **这不是笔误，是总表口径把「有意保留的未完成」吞掉了。**
   S-01 的根治需产品决策（C1 依赖宿主改档、C2 依赖宿主提供消息回读 API）；
   R-01 的段 2/3 会让存量账本大面积变红，需先定宽限期口径。
   ⇒ 两者都**不能单方面推进**，但也**不能记成「已修」**。

⚠ 本表的**其余 106 条**是否全部已修，仍在逐条复核中（截至本轮已核 34 条，均确认）。

~~**blocker / high 全部归零**（原本 12 + 26 条）~~ —— ⚠ **2026-11-11 订正：不成立**。
**S-01（blocker）与 R-01（blocker）仍未完成**，见上表。

所有已修项都有**可复跑的验证**（不是「改完了」而是「**改坏了会红**」）。
⚠ 每条修复都配了**负向对拍**：把实现改回去 ⇒ 断言当场红。这是本单唯一认的「修好」。

⚠ **「剩余 0」不等于「面板已支持英文」** —— O-21 按裁定 B 关闭
（契约说准 + 机检钉住），**全量迁 i18n（裁定 A）另开单**，见 §77.6。

⚠ **本结论取代本文件早期各节的中间读数**（那些是当时的进度快照）；
逐条账见 **§66.3**（唯一权威）。

---

## §2 数字

| 项 | 数值 |
|---|---|
| 代码改动 | **109 文件 · +12,644 / −1,344 行** |
| 其中 `src/` | 55 文件 |
| 其中 `scripts/`（自检体系） | 48 文件 |
| 新增模块 | `src/shared/ledger-health.ts`（172 行，四出口唯一判据） |
| 当前 `src/` 总行数 | 61,737 |
| 缺陷总数（REVIEW §5 总表） | **112** |
| **已修** | **108** |
| 已排除（复核证伪） | **3** | **S-08 / O-24 / O-15**（都在 112 内，参与算术）。另有 `C-01` 等**清单外**观察项，不参与算术 |
| **已处理（保留 + 标注）** | **1** | **O-16**：按裁定**保留现状并在代码处标注理由**（⛔ 不是"修好"，也不是"证伪"）⇒ 参与算术 |
| **未修**（见 §5 / §66.3） | **0** |
| **算术核对** | **112** | 108 + 3 + 1 = **112** ✅（⚠ 缺 O-16 那行时是 108+3=111，**差 1**） |

⚠ 本表是**当前终值**。各分节里的中间数（如 §5.1 的「未修 77 条」、§10.5 的「已修 37」）是**当时**的读数，
已在原处标注为「上一版 / 本轮」，**以本表为准**。

### 2.1 检查族现状（全部实测）

```
（⚠ 以下为**当前终值**，随每轮修复更新；早期中间读数见各轮小结）

check:pipeline              26 · 失败 0     （R-15 新增 PIPE-5b）
check:stage-controls       104 · 失败 0
check:ledger               129 · 失败 0
check:ledger-write-policy   16 · 失败 0     （R-19 新增 WP-12/12b、T-24 新增 WP-13）
check:ledger-projection     15 · 失败 0     （R-18 新增 LP-14）
check:ledger-resources      18 · 失败 0     （T-23 新增 kind 表对拍）
check:hob-create            54 · 失败 0     （T-15 新增 CU-44）
check:workflow              33 · 失败 0
check:meta-negctl            5 · 失败 0
check:requirement-chains    19 · 失败 0
check:stages-dom           137 · 失败 0
check:tasks-route-http      15 · 失败 0
check:policy                46 · 失败 0

typecheck  exit 0
build      OK
check:presets / host / readings / rounds / selfwake   全部 OK
typecheck                  exit 0
```

⚠ **一个已知的既有失败**：`check:work-plan-runtime` **35 通过 / 7 失败**。
这 7 条在本次修复**开始前就是红的**（已用 `git stash` 前后对照验证：结果完全相同），
与本次改动无关。它们的共同形态是「轨道状态停在 `running` 未推进到 `returned`」，源于 mock 的 `sawRunning` 时序假设。

---

## §3 已修缺陷（**本轮次前 33 条**，按主题分组）

⚠ 本节只覆盖**早期**修的那 33 条。此后陆续又修了 15 条（T-08 / T-05 / O-35 / O-34 / R-08 / R-22 / S-07 / T-10 / T-14 / R-15 / R-18 / R-19 / T-23 / T-24 / T-15），
分别记在 §9 起的各轮小结里。**当前总数见 §2**（已修 67）。

### 3.1 批准链（本次审计最重的一条）

| 编号 | 缺陷 | 修法 | 验证 |
|---|---|---|---|
| **S-01(A)** | `write_hob` 可直接写批准分片 ⇒ 绕过一切回执校验 | `APPROVAL_ONLY_SHARDS` + `isApprovalOnlyPath()`，白名单最前面拒绝；专用工具经 `allowApprovalShard` 放行 | **WP-11**：普通 `write_hob` 被拒、专用通道放行；注释掉收窄代码 ⇒ 断言红 |
| **T-13** | 批准工具不过 `proceedGate` ⇒ 隔离/归档会话仍能写「用户批准」 | `dryRun === false` 时先过闸门 | 类型检查 + 门禁路径读码 |
| **T-06** | 批准写入豁免 `validateLedgerStructure` ⇒ 自己写非法 decision 也能落盘 | 去掉豁免（`decision` 与封闭契约完全兼容） | `check:ledger` 129/129 |
| **S-02** | `clarify_legacy` + `created_at` 两个**自填字段**可跳过 11 类门禁 | `legacy()` 三层：字段 → 非 v3 → **写入方注入的 provenance** | 真实账本 292 单元 / 177 行：**修前修后缺口数相等**；新写 v3 单元三态全被 C-11 拒 |

⚠ **S-01 仍是 blocker**：A 只是把可绕过点从两条收窄成一条。批准工具**仍由 Hob 调用**、`decided_by` **仍是硬编码**。根治要 C 选项。

### 3.2 账本写入与投影

| 编号 | 缺陷 | 修法 | 验证 |
|---|---|---|---|
| **T-01** | `index.toml` 被守卫**读两次** ⇒ 第二条单元永远写不进，且错误原因说谎 | 不变量改为「每个物理文件最多被读一次」（`rel` 是 index 时第一项不读） | 六格探针：index append/overwrite **转绿**、分片两格与修前**逐字相同** |
| **O-33** | 解析失败的分片被当空数组 ⇒ 账本已坏时守卫静默 | `readUnitSource` 四态（ok/missing/unparseable/unreadable）⇒ 拒写 | 坏分片在场 ⇒ `ledger-unit-unreadable`（修前**静默污染**） |
| **T-02** | 同一本账有 **4 套**「健康」判据，实测四种结论 | 新建 `ledger-health.ts` 的 `ledgerHealthOf`，四出口全部改调；**一份问题集、两个投影**（结构层 / 推进层） | 四出口对同一夹具：readiness 6 / gate 6 / health 6 ⇒ **agree=true** |
| **T-07 / R-18 / O-07** | 投影半完成无回滚；`removeUnitBlock` 留孤儿块却返回 `ok:true` | 整块删除 + `partial` 读数 + 删豁免 | id 非首键夹具跑两次 ⇒ 无孤儿块 |
| **O-37 / O-43** | `hob_ledger_migrate` 只重写 index；真实账本 status 越过封闭集 | 与 T-01 同批（迁移遍历分片） | `check:ledger` 129/129 |

### 3.3 派活门禁（本次审计第二大结构缺口）

| 编号 | 缺陷 | 修法 | 验证 |
|---|---|---|---|
| **R-05** | G3（依赖环/悬空/覆盖缺口）**不进任何派活闸门** ⇒ 任务图有洞照样能派活 | `pipelineDispatchProblems` 末尾追加 G3 段，判据直接用 `taskGraphOf` | 覆盖缺口 ✅ / 悬空依赖 ✅ / 齐全不误报 |
| **R-10** | 覆盖校验读 `criteria_refs`，而契约字段是 `acceptance_criteria_refs` ⇒ **按文档写反而永远报缺口** | `refsOf` = 契约名优先、旧名兜底 | 契约名不再误报、旧名仍认 |
| **R-28** | 多轨首次派发时门禁**从盘上找计划**，而计划还没写盘 ⇒ **唯一能绕过任务链门禁的入口** | 在 `writeWorkPlan` **之前**插入门禁，逐轨用同一纯函数 | 首次多轨派发被 G1/G2 拦下（改前**一路放行**） |

### 3.4 判定层

| 编号 | 缺陷 | 修法 | 验证 |
|---|---|---|---|
| **R-01（段 1）** | G4/G5「完成」用弱判定，强判据只进 `blockedBy` 文本 | **影子模式**：强判据算出来、以 `[影子]` 前缀报出，**不参与判定** | 改动前后 `activeStage` / `chainCompleted` / `stages` **逐字相同**；7 条影子违规如实报出 |
| **R-13** | G6 取「物理顺序最后一个方案」⇒ 结论随数组顺序翻转（**安全方向 fail-open**） | 升级为 high；修法改抽 `currentPlanOfStrict` | 两种物理顺序 ⇒ 结论相同且都含 C-27 |
| **O-32** | 同一条 VER 的问题被 push 两次 ⇒ 面板「另有 N 条」虚高 | `blockedBy` 去重 | 实测总数 7 → 去重后 5 |
| **O-34** | `taskGraphOf` 用含 `superseded` 的全部 change 收任务 | 只认当前方案 | `check:pipeline` 25/25 |

### 3.5 客户端可观测性

| 编号 | 缺陷 | 修法 | 验证 |
|---|---|---|---|
| **T-04** | 6 个取数函数**全无超时** ⇒ 任一挂起则面板永久定格，而徽标仍说「已连接」 | 30s 超时 + watch-dog + 单调 `pullSeq`；徽标新增 `data-state='degraded'` | jsdom 探针：永不 settle ⇒ `degraded` + 文案含「停止刷新」且**不含「已连接」** |
| **T-09** | 只数 `problems.length`，不读 `count`/`truncated` ⇒ 41~300 条显示「40 条」 | N = `count − min(shown,12)`；体积兜底时标 `not-delivered` | 41 ⇒「41 条 / 另有 29 条」；300 无 problems ⇒「300 条」+ `unhealthy` |
| **T-16** | 切账本不清 `itemDetails` ⇒ 显示上一本账正文且永不自愈 | 切账本 `setItemDetails({})` | 切 beta 后同名 `R-001` 显示 BETA 正文 |
| **O-18 / O-23 / O-36 / T-17** | 每秒重取 / 死字段 / 路由无 404 分支 | 提 `useCallback` / 删死字段 / 补 `StaleRouteError` | 2.6s 内 0 次重取；404 ⇒「接不上」 |

### 3.6 自检体系与文档

| 编号 | 缺陷 | 修法 | 验证 |
|---|---|---|---|
| **S-16** | 负控计数器**不跳注释** ⇒ 元规则的最短绕过路径是「加两个斜杠」 | 词法剥注释 + mask 掩码 | 七种写法：真调用=1，注释/JSDoc/字符串**全 0**；注释掉真对拍 ⇒ **M-1 必红** |
| **S-06** | 10 个族负控下限 = 0 ⇒ 零负控也永远绿 | 扩 `say` 通道 + 补标签 + 补断言 ⇒ **10 → 2** | 剩下的 `check:all`（聚合入口）/ `check:preflight`（只报告）**结构上就没有**，⛔ 不硬凑 |
| **R-03** | 阶段步名 **8 份字面量且已漂**（只有 `stage-controls.ts` 写「编码任务」） | 统一到 `STAGE_NAMES`，其余三处改为**派生** | 真实账本 `spec/current.md:45` 从「编码任务」变「任务图」，`check:ledger` 126/3 → **129/0** |
| **R-04** | 运行时教模型「五步」、面板是「七步」⇒ 第 5 步指两件事 | 改 5 处并重跑生成器 | `check:workflow` 33/33（F10 逐字节一致） |
| **R-27 / R-29 / T-18 / T-19 / T-20** | README 六处失准（最危险：`ledgerHome` 空串原文说「派生」，实际**判不出**） | 逐条更正并保留原文对照 | `check:doc-shape` / `check:repo-rules` 全绿 |

---

## §4 已排除（2 条，复核证伪；均在 112 内）

| 编号 | 原判断 | 实际 |
|---|---|---|
| **S-08** | CU-5 正则指向已改名常量 `PLANNING_PRESET_ID` ⇒ 恒假面 | CU-5 **早已改成反性质判据**：检查「源码里不得出现按宿主预设做 gating」，`PLANNING_PRESET_ID` 是**被禁止出现的靶子**。实跑 `CU-5 ✓` |
| **C-01**（降级为观察项） | primitives 是否在宿主 seed 里 | 两条注释**互相矛盾**，无第三方证据；`lib/client.js:28` 的 require 只证明产物里有，不证明运行时失败 |

---

## §5 未修（**0** 条）与原因

### 5.1 未修项的**等级分布**（更正 §5 原文的不准确描述；数字为当时读数，见 §2 终值）

⚠ 我在上一版里把未修项描述成「大多是死代码 / i18n / 文案」——**这是不准确的**。实测：

| 等级 | 条数 | 明细 |
|---|---|---|
| **blocker** | **0** | ✅ 全部已修 |
| **high** | **0** | ✅ 全部已修 |
| medium | **0** | ✅ O-21 已按裁定 B 关闭（§77） |
| low | **0** | ✅ O-15 已驳回（§76，用户裁定的有意设计） |

⇒ **blocker / high / medium / low 全部归零**，**剩余 0 条**（112 条全部有归属，见 §77.6）。
**逐条账见 §66.3**（唯一权威）。

⚠ **本表随每轮修复更新**（写这一段时是 4 blocker + 9 high / medium 22 / low 31；
  之后 blocker 与 high 全部修完，medium/low 也在逐轮消）。**以 §2 终值为准。**
⚠ 其中 T-05 与 O-35 **已实测确认修好**：
- **T-05**：`tools.ts:1823` 的 `repairOf` 命中判据改用 `stageHealthOfLedger(root)`，后者内部走 `ledgerHealthOf`（`:835`）
  ⇒ **命中判据与拦截判据同源**，死锁消除；
- **O-35**：`orchestrator.ts:10736-10742` `hob_orch_control` 的四个账本动作已过 `proceedGateOf`，
  且注释写明「与 `dispatch` 的闸门**同一份实现**，⛔ 不另写判据」。

### 5.2 这 13 条的真实状态（逐条核过）

| 编号 | 等级 | 状态 | 说明 |
|---|---|---|---|
| **T-08** | high | ✅ **本轮已修** | G3–G6 的阻断原因现在进 `next.blockedBy`（见 §9） |
| **R-01** | blocker | 🟡 **段 1 已落地** | 影子模式：强判据算出来报出来、不参与判定；段 2–3 等 D-SPEC-4 |
| **T-05** | blocker | ✅ **已修（已确认）** | `tools.ts:1823` `repairOf` 命中判据 → `stageHealthOfLedger` → `ledgerHealthOf`，与拦截判据同源 |
| **O-35** | high | ✅ **已修（已确认）** | `orchestrator.ts:10736-10742` 四个账本动作已过 `proceedGateOf`，与 dispatch 同一份实现 |
| **R-02** | blocker | ❌ 未修 | 「链完成了吗」仍有 5 份实现 —— 需单独立项（它是根因主线本体） |
| **T-03** | blocker | ❌ 未修 | 判不出 `ownerWsRoot` ⇒ 投影静默跳过 —— **需语义决策**（要不要允许无 RUN 的派发） |
| **R-08** | high | ✅ **已修** | `requirement-chain.ts` `step5Set`（7 处）+ 面板 `LEGACY_STAGE_KIND_BY_STEP` |
| **R-12** | high | ❌ 未修 | 首次批准前改内容不递增 revision —— 需 D-SPEC-2 决策 |
| **R-22** | high | ✅ **已修** | `bus.ts` 的 `hob_spawn` 档位描述改由 `OPEN_READ_LEVELS` 派生（5 处引用） |
| **S-07** | high | ✅ **已修** | `check-workflow.mjs` F3 现在校验 `checked_by` 的 `check:xxx` 族确实在 `package.json` 里 |
| **T-10** | high | ✅ **已修** | `effects-queue.ts` `maxAttempts`+`abandonedAt`、`handoff-effects.ts` 接线、`src/preset/tools.ts` 传 `self` |
| **T-14** | high | ✅ **已修** | `session-policy-service.ts` 新增 `pendingDropStatsOf(sessionId)`；实测 37 条超 32 上限时 `count: 5` |
| **O-34** | high | ✅ **已修（已确认）** | `pipeline-view.ts` `taskGraphOf` 排除 `superseded` 方案（7 处引用） |

### 5.3 其余 64 条（medium / low）

| 类别 | 条数 | 原因 |
|---|---|---|
| 死代码 / 空导出 | ~8 | 不影响行为；清理需单独过 |
| 文案 / i18n | ~10 | `O-21`（面板零 i18n，13k 字符）**工程量与风险不成比例** |
| 文档措辞 | ~6 | 低风险但清单长 |
| 宿主侧依赖 | ~6 | 需宿主 API 或运行时探针，**静态不可证** |
| 其它独立缺陷 | ~34 | 每条都值得修，但需各自立项出规格 |

⚠ **不能说「112 条全修完了」。** 34 条已修（33 + T-08）、2 条已排除、**76 条未修**（含 4 blocker + 8 high）。

---

## §6 需要你决策的两件事

### 6.1 D-1 · 批准通路是否引入 C（用户本人触发）

**现状**：A 已落地（`write_hob` 不能写批准分片），但批准工具**仍由 Hob 调用**、`decided_by` **仍是硬编码 `"user"`**、
`source` **仍是对自填字符串跑正则**。⇒ **Hob 只要自己拼一句「确认需求 R-01 第 1 版」就能通过。**

| 选项 | 效果 | 代价 |
|---|---|---|
| **保持现状（只做 A）** | 攻击面收窄到一条路径 | **S-01 永久停留 blocker** |
| **C1：`ctx.approval.request()`** | 判据输入来自被校验方之外 | ⚠ **当前部署下必然失败**：`defaultPreset: danger-full-access` → `approval: never` → `request()` 返回 **`rejected`** |
| **C2：用户消息 MessageId 凭据** | 不依赖 answerer | 需宿主提供「会话消息可回读」的 API（未验证） |

**我的建议**：先做 **C2**（不依赖 answerer、风险低），把 C1 作为「宿主改成 `workspace-write` 档之后」的上限。
**无论选哪个，都不得把 S-01 标成「已根治」。**

### 6.2 D-SPEC-4 · 存量「验证者=实现者」的 VER/ACC 是否永久豁免

**现状**：R-01 段 1（影子模式）已落地——强判据算出来、报出来，但**不参与判定**。
段 2（宽限期）需要回答：

> 存量账本里「验证者=实现者」的那些 VER/ACC，**是否永久豁免**？

| 选项 | 后果 |
|---|---|
| **永久豁免** | 它们永远不进强判据 ⇒ **R-01 对历史项目形同未修** |
| **宽限到该任务下次被重新验证** | 历史项目在下次改动时被迫补证据（合理） |
| **直接全量** | 存量项目会从 `completed` 翻成 `incomplete`，**证据补不回来** |

**我的建议**：宽限到「该任务下次被重新验证」——既不追溯翻旧账，也不让新证据继续缺席。

---

## §7 这份工程里最重要的三条方法论

### 7.1 「改坏了会红」比「跑通了」重要

本次每个修复都要求**负向对拍**：把要守的实现改坏 ⇒ 断言必须红。
典型例子：`WP-11` 收窄后，把收窄代码注释掉 ⇒ 断言当场报 `denied={"ok":true}`。
**只验「正常路径绿」的判据，与一条恒真的判据输出完全相同。**

### 7.2 「口径漏了写法」不等于「对拍不存在」

B4.1 里 8 个零负控族，**5 个的负向对拍一直真实存在**，只是计数器认不到：
`say(pass, line, why)` 的标签在**第二**实参、`readings.push({...})` 的在**对象字段**里。
⇒ **先查「是不是数不到」，再决定「要不要补」。** 否则会为了满足下限而凑数——那正是 S-06 的成因。

### 7.3 同一个错误事实会在多处出现，且不会自己收敛

`ledgerHome` 空串规则在 README 里出现两次（配置表 + 残留清单），两处都错；
阶段步名有 8 份字面量，只有 1 份是旧词。
⇒ **改一处必须 grep 全仓找同类**，否则修了主文档、漏了附录。

---

## §8 构建验证（全程首次）

⚠ 此前所有批次**只跑过 `typecheck`，从未跑过 `npm run build`** —— 这是个真实缺口：
`typecheck` 证明类型正确，**不证明能编译出可加载的产物**（`tsc` + `tsdown` 两段）。

### 8.1 实测结果

```
$ npm run build
tsc -p tsconfig.json                    ⇒ 通过
tsdown --config tsdown.config.ts        ⇒ 通过
  lib/client.js      416.32 kB │ gzip: 136.85 kB
  lib/client.js.map  126.26 kB │ gzip:  30.45 kB
  ✔ Build complete in 117ms
[build-stamp] commit=5ee0797 dirty=true
```

**产物齐全**：`lib/client.js`（416KB）· `lib/index.js`（32KB）· `lib/preset/tools.js`，
与 `package.json` 的 4 条 `exports` 目标一一对应。

### 8.2 `check:build` 五面结果

| 面 | 内容 | 结果 |
|---|---|---|
| ① | 产物 vs 源码（commit 一致） | ✅ |
| ② | 源件逐对比较（87 源件 / 73 对） | ✅ |
| ③ | 运行实例 vs 产物 | ⚠ **报落后**（见下） |
| ④ | `exports` 目标在位 + `lib/client.js` 真加载 | ✅ |
| ⑤ | 孤儿产物 | ✅ **零孤儿**（224 个产物逐个找回源件） |

`--strict-source` 下 **exit 0** ⇒ 源码面全绿。

### 8.3 面③ 为什么报落后（这不是缺陷）

```
✗ 面 ③：运行实例落后于产物 —— 1 个宿主进程早于这次 build 就启动了
    · pid 1391738（profile=web）启动于 2026-11-09T18:39 · 比这次 build 早 ≈18.37 小时
    · 源码最新改动 2026-11-10T12:46（晚于启动）
```

⇒ 这是**宿主规则**：`changed modules keep running their previous code until a restart`。
⚠ **`npm run build` 只写盘，⛔ 不给运行中的进程换代码** —— 要让它跑上新产物**只重启宿主**。

⚠ 面③ **缺省只报警、不影响退出码**，理由写在 `check-all.mjs` 的 `STRICT_FAMILIES`：
「刚 build 完还没重启」会让它恒红，而**恒红的判据等于没有判据**。

⇒ **这不是本次修复引入的问题**：任何一次 `npm run build` 之后、重启之前，面③ 都会这样报。


---

## §9 T-08 修复 · 面板与闸门的相反信号已消除

### 9.1 缺陷

`requirement-chain.ts` 只在 `gate === 'G1-requirement'` / `'G2-plan'` 时把
`pipeline.blockedBy` 注入 `next`。走到 **G3–G6** 时 `next` 保留的是全局 `nextAction` 的结论
⇒ 面板印「**卡在哪：没有主阻断**」，而同一时刻派活可能被 `pipelineDispatchProblems` 拒
（R-05 接上 G3 之后尤其明显）。

**面板说「没卡」+ 闸门说「不能派」= 两个信号相反，且都不指向原因。**

### 9.2 修法（只补 `blockedBy`，⛔ 不改 `kind` / `target` / `why`）

```ts
} else if (pipelineGoverns && partial.next.blockedBy.length === 0
  && partial.pipeline.blockedBy.length > 0) {
  partial.next = { ...partial.next, blockedBy: partial.pipeline.blockedBy }
}
```

⚠ **为什么不动 `kind` / `why`**：那两个字段由 `nextAction` 的全局六态优先级决定，
改它等于**另造一套「下一步」判据** —— 那正是 R-02 / R-14 的形态。
⚠ **为什么条件是「`next.blockedBy` 为空」**：若全局 `nextAction` 已经给了阻断，
它比链内视图更了解「该先做哪一件」⇒ **不覆盖它**（保持既有优先级）。

### 9.3 验证

**夹具**：v3 链 + G1/G2 批准 + 任务 `depends_on: ['TSK-NOT-EXIST']`（悬空依赖）。

| 字段 | 值 |
|---|---|
| `currentStep` | 3 |
| `pipeline.gate` | `G3-tasks` |
| `pipeline.blockedBy` | `['G3 · 任务依赖悬空：TSK-1 → TSK-NOT-EXIST']` |
| **`next.blockedBy`** | **`['G3 · 任务依赖悬空：TSK-1 → TSK-NOT-EXIST']`** ← 修好了 |
| `next.kind` | `dispatch`（**未被改写**） |

**补了常驻机检 RC-14**（`check:requirement-chains` 18/18 全绿）：

```
✓ RC-14 ✓ **负向对拍**：G3 的阻断原因进 `next.blockedBy`，且 `next.kind` 不被改写
```

**RC-14 真的会红**（禁用 T-08）：

```
✗ RC-14 · G3 阻断原因没进 next.blockedBy（next.blockedBy=[]）
```


---

## §10 三条「需确认」项已核实并修复（T-05 / O-35 / O-34）

上一版 §5.2 把它们标成「🟡 需确认」，本轮逐条核实：**一条已修、两条未修且已修好**。

### 10.1 T-05 · ✅ **已修**（随 B1.3 顺带完成）

**判据同源已成立**：`repairOf` 的命中判据读的是 `stageHealthOfLedger(root).blockers`，
而后者现在调 `ledgerHealthOf`（B1.3 的统一入口）⇒ **与真正拦写的是同一份判据**。

**实测**（只含一条 L-2 闭环缺口的账本）：

| 读数 | 值 |
|---|---|
| `stageGateOfLedger` | **被拦**，消息含 `L-2 · TSK-001` |
| `stageHealthOfLedger.blockers` | 1 条，unit = **`TSK-001`** |
| 同源判定 | **true** |

⇒ 「修复写的命中判据」与「真正拦它的判据」不再是两套 ⇒ **死锁解除**。

### 10.2 O-35 · ❌ **未修 → 本轮已修**

**核实**：`proceedGateOf` 在 `orchestrator.ts` 只被 `:8924`（派发路径）调用，
`hob_orch_control` 的 execute（`:10544`）**全文零命中**。

**病**：`verify` / `accept` / `send-back` / `close-delivery` 四个动作**直接写账本**，
而该工具在 `MODEL_TOOL_ALLOWLIST` **三档都有** ⇒ 被隔离 / 归档的会话**仍能写验证判决与验收结论**。
这是 S-01 的**下游**：即使批准链被修，判决链仍无门禁。

**修法**：只拦「写业务判决」的四个动作，⛔ 不拦其余六个：

| 动作 | 拦？ | 理由 |
|---|---|---|
| `verify` / `accept` / `send-back` / `close-delivery` | **拦** | 写业务判决 |
| `stop` / `resume` / `watch-wait` | 放行 | 「停手」与「报告状态」，被隔离的会话**尤其需要**能停；拦了就是死锁 |
| `redeliver` / `plan-complete` / `archive-stale-plan` | 放行 | 改运行态不改判决；`archive-stale-plan` 是清理动作（拦住会让过期计划永远占槽） |

⚠ 与 `dispatch` **同一份实现**（`proceedGateOf`），⛔ 不另写判据；闸门抛错 ⇒ **拒绝**（fail-closed）。

### 10.3 O-34 · ❌ **未修 → 本轮已修**

**核实**：`taskGraphOf` 的 `plans` **不筛 status** ⇒ `superseded` 的方案也在内。

**病**：旧方案有 built 任务、新方案零任务时，`graphReady` 被旧任务满足（第 3 步 `completed`、
链推进到 G4），而同一屏 `summary` 来自当前方案（「还没有任务图」）。

⚠ **这是 R-02 在服务端内部的自我复制，也是 R-13 的反面**：
R-13 是「取**最后**一个方案」，O-34 是「取**全部**方案」—— **两头都错，中间才对**。

**修法**：排除 `superseded`（与 `currentTasksOf` 同源）。
⚠ 只排这一个状态：`draft` / `proposed` 仍是「在写的当前方案」，没有任务不是缺陷。
⚠ 「全部方案都被取代」时图为空 ⇒ `graphReady` 为假 —— 这是**有意**的（D-O34-1 采 A）。

**实测**：旧方案有 `TSK-OLD`（built）、新方案零任务 ⇒ **`nodes=[]`**（正确），
且 `coverageGaps=['AC-1']` 如实报出。

### 10.4 验证

```
check:pipeline OK          check:stage-controls OK    check:ledger OK
check:requirement-chains OK    check:orch OK         check:stages-dom OK
check:workflow OK          check:meta-negctl OK       check:ledger-projection OK
typecheck                  exit 0
```

### 10.5 修正后的账目

| 项 | 上一版 | 本轮 |
|---|---|---|
| 已修 | 34 | **37**（+T-05 确认、+O-35、+O-34） |
| 未修 | 76 | **73** |
| 其中 blocker | 4 | **3**（R-01 段 1 已落地 / R-02 / T-03） |
| 其中 high | 8 | **5**（R-08 / R-12 / R-22 / S-07 / T-10 / T-14 中已修 O-34、T-08） |

⚠ **当时**的准确读数：已修 **37** 条，未修 **73** 条。
⚠ **当前终值见 §2**：已修 **45**、未修 **65**（后续又修了 R-08 / T-10 / T-14 / R-15 / R-18 / R-19）。


---

## §11 R-22 与 S-07 已修

### 11.1 R-22 · 工具描述与常量矛盾 → 改为**派生**

**病（实测）**：`bus.ts` 的 `hob_spawn` 参数描述写死
「⚠ **当前只有 ledger 开放**：其余两档会被服务端拒签/拒建」，
而 `read-level-policy.ts:61` 的 `OPEN_READ_LEVELS` 早已是
**`['ledger','project','workspace']` 三档全开**（2026-10-24 扩档）。

⇒ **模型读到描述后会主动放弃 `project` / `workspace`**，以为会被拒；而服务端实际放行。
这是「文档比实现落后」的**反向漂移**：不是放宽，而是**自我限制 + 说假话**。

**修法**：描述从 `OPEN_READ_LEVELS` **派生**（⛔ 不写死字面量）：

```ts
+ `⚠ **当前开放：${OPEN_READ_LEVELS.join(' / ')}**`
+ (OPEN_READ_LEVELS.length === 3
  ? '（三档全开；档位只改「读」的范围，⛔ 不改「写」的边界…）。'
  : '：未列出的档位会被服务端拒签/拒建并给可读原因。')
```

⚠ **为什么不改成新字面量**：那只是把「今天的正确值」写死，下次扩/收档仍会漂。
⇒ 直接从常量算，**描述永远跟着实现走**。

**实测**：渲染为 `当前开放：ledger / project / workspace`。

### 11.2 S-07 · `checked_by` 只核字样 → 核到「族是否存在」

**病（实测）**：`check:workflow` 的 **F3 只核「条款里有没有 `checked_by` 这几个字」**。
一条条款写 `checked_by → check:不存在的族` **也能绿**。
⚠ 那是**装饰性**判据：它证的是「写了这几个字」，⛔ 不是「它真被某一族核着」。

**修法**：从每条条款的 `checked_by` 里抽 `check:xxx` 族名，
核对它在 `package.json` 的 `scripts` 里**存在**；一条都抽不出 ⇒ 报红。

⚠ **边界写进了代码注释**：**不核「`F5` / `I3` / `PIPE-1..23` 这些断言号是否真有」** ——
各族断言号写法不统一（有的在 `ok('X-1 …')`、有的是 `bad(...)` 分支、有的按范围合并），
**没有可靠解析法**，硬解析会造出假红。⇒ 只核「族存在」这个**能可靠证**的部分。
⚠ 这条边界很重要：免得下一个人以为「F3 已核断言号」。

**实测**：F3 ✓（12 条条款逐条带 `checked_by`，且都指向存在的族），`check:workflow` **33/33**。

**加强后真的会红**（把 `check:workflow F5` 改成 `check:NOT-A-REAL-FAMILY F5`）：

```
✗ F3 · 2 条条款的 `checked_by` **没有点名任何 `check:xxx` 族**：1. 投递 ≠ 做完… / 2. 建会话 ≠ 派活…
```

⚠ 报的是「没有点名任何族」而不是「族不存在」——因为我的 sed 把 `check:workflow` 整段换掉了，
正则 `/check:([a-z0-9-]+)/` 对 `check:NOT-A-REAL-FAMILY` 因**大写字母**不匹配 ⇒ 落到「抽不出族」那一档。
**两档都报红**，效果相同；但这条细节值得记：**族名的字符集假设（只有小写）本身就是个判据**。

### 11.3 验证

```
check:workflow OK (33/33)    check:policy OK     check:presets OK
check:pipeline OK            check:ledger OK     check:stage-controls OK
check:orch OK                check:stages-dom OK
typecheck                    exit 0
```

### 11.4 账目更新

| 项 | 上一版 | 本轮 |
|---|---|---|
| 已修 | 37 | **39**（+R-22、+S-07） |
| 未修 | 73 | **71** |
| 其中 blocker | 3 | 3（R-01 段 1 已落地 / R-02 / T-03） |
| 其中 high | 5 | **3**（R-08 / R-12 / T-10 / T-14 中已修 R-22、S-07） |


---

## §12 R-08 已修 · legacy 第 5 步的「状态源」与「条目源」统一

### 12.1 缺陷

`LEGACY_STEP_DEFS` 只有 5 步，第 5 步叫「**验收核对**」、`kind: 'acc'`（旧语义里它就是**产品验收**）；
而 `items` / `done` / `doing` **三处都取 `chain.verifications`**。

⇒ legacy 账本若**只有 ACC 没有 VER**（旧账本很常见）⇒ 同屏出现
「**已完成**（状态取自 accs）/ **0/0** / **这一步还没有条目**（条目为空）」。

⚠ 根因：v3 里第 5 步 = 技术验证、第 6 步 = 产品验收，**是两件事**；
legacy 只有 5 步，第 5 步**同时承担**两者 ⇒ 状态与条目被拆到两个集合上。

### 12.2 修法（服务端三处 + 客户端两处，必须同批）

**服务端**（`requirement-chain.ts`）：

```ts
const step5Set: readonly ChainUnit[] = legacy ? chain.accs : chain.verifications
// items / done / doing 三处全部改用 step5Set
```

⚠ **为什么必须三处联动**：只改 `items` 会造出**新矛盾**「条目取自 ACC、计数取自 VER」
⇒ legacy 账本 VER 通常为 0 ⇒ 显示「2 条」但「0/0」。

⚠ **ACC 没有 `unverified` 状态**（封闭集是 `pass` / `send-back` / `undecidable`），
所以 legacy 下「进行中」的判据用 **`undecidable`**（与第 6 步同源）。

**客户端**（`project-panel.tsx`）：

```ts
export const LEGACY_STAGE_KIND_BY_STEP = { 1:'req', 2:'change', 3:'task', 4:'run', 5:'acc' }
export function kindOfStep(step: number, legacy = false): string
```

⚠ **为什么客户端必须同批**：服务端已把 legacy 第 5 步的条目源改成 `accs`；
客户端表不改 ⇒ **服务端给 ACC、客户端按 VER 解释** ⇒ 合法的 ACC 状态被查进 VER 封闭集
⇒ 印「判不出（原值 pass）」，且 **`stageStatusLabel` 不会报错**（它只校验「该 kind 的封闭集」，
不反问「这个 status 是否本属另一个 kind」）—— **静默错配**。

### 12.3 验证

**夹具**：legacy 链（无 `pipeline_version`）+ 2 条 ACC（1 pass / 1 undecidable）+ 1 条 VER（pass）。

| 字段 | 修前 | 修后 |
|---|---|---|
| `step5ItemIds` | `[]`（取 VER，但 VER 不在 chain 里） | **`['ACC-1','ACC-2']`** |
| `step5Total` | 0 | **2** |
| `step5Done` | 0 | **1**（pass 的 ACC） |
| `step5Doing` | 0 | **1**（undecidable 的 ACC） |
| 条目全是 ACC | — | **true** |
| 不含 VER | — | **true** |
| `total === itemIds.length` | — | **true** |

⇒ 同屏不再出现「已完成 / 0/0 / 没有条目」。

**补了常驻机检 RC-15**（`check:requirement-chains` **19/19** 全绿）。

### 12.4 一处连带：RC-3 的期望值从 4 改为 5

`RC-3` 的夹具**没有 `pipeline_version`** ⇒ legacy 链 ⇒ 走 5 步。

| | 历史条目数 | 原因 |
|---|---|---|
| **R-08 之前** | 4 | legacy 第 5 步取 VER，夹具没有 VER ⇒ 条目为空 |
| **R-08 之后** | **5** | legacy 第 5 步取 ACC，夹具的 `ACC-1` **出现了** |

⚠ **这不是回归，是修复的正确后果**：旧行为下 `ACC-1` **根本没有出现在链里**
（尽管它 `pass` 且链判 `completed`）—— 那正是 R-08 要治的「条目不可见」。
⛔ **不许为了让这个数回到 4 而去改 R-08 的实现。**
这句话已写进断言的注释里。

### 12.5 验证

```
check:requirement-chains OK (19/19)    check:pipeline OK
check:stage-controls OK    check:ledger OK    check:stages-dom OK
check:stages-route OK      check:workflow OK  check:meta-negctl OK
check:presets OK           typecheck OK       build OK
```

### 12.6 账目更新

| 项 | 上一版 | 本轮 |
|---|---|---|
| 已修 | 39 | **40**（+R-08） |
| 未修 | 71 | **70** |
| 其中 blocker | 3 | 3（R-01 段 1 已落地 / R-02 / T-03） |
| 其中 high | 3 | **2**（R-12 / T-10 / T-14 中已修 R-08） |


---

## §13 T-10 已修 · Outbox 补投「三重静默」逐条拆掉

### 13.1 三重静默（实测确认）

| # | 病 | 位置 |
|---|---|---|
| ① | `onError` **缺省 noop** ⇒ 补投失败**零日志** | `effects-queue.ts:133` |
| ② | **无最大尝试次数** ⇒ 退避封顶 60s 后**一直重试** | `:344-349` |
| ③ | 补投传 `{ self: undefined }` ⇒ owner/watcher 为空 ⇒ **回执永不回来** | `src/preset/tools.ts:209` |

⚠ 三者叠加：**永久失败就是彻底静默的空转**。

### 13.2 逐条修法

**① `onError` 接到宿主 logger**

`startHandoffEffects` 新增 `onError` 参数（缺省仍 noop，向后兼容），
生产路径（`src/preset/tools.ts`）传入 `ctx.logger.warn`。

**② 新增 `maxAttempts` + `abandonedAt`**

```ts
if (maxAttempts !== undefined && current.attempts >= maxAttempts) {
  current.abandonedAt = this.now()
  current.dueAt = Number.POSITIVE_INFINITY   // 调度器不会再选中它
  this.persist()
  this.onError(kind, new Error('已放弃重试（…）'))
  return
}
```

⚠ **关键设计：把「放弃」做成一条可读状态，不是静默删行** ——
行**保留**（`lastError` + `attempts` 都在），只把 `dueAt` 推到 `Infinity`。
⚠ `abandonedAt` 与 `delivered` **是两件事**：放弃 ≠ 投递成功。
⚠ 本字段**只增不改**：要重新投递必须**人工**清掉 —— 这是有意的。

补投 handler 设 `maxAttempts: 20`（≈ 2s+4s+…+60s 封顶后约 15 分钟），
足够覆盖「临时不可达」，又不让永久失败永远占队列。

**③ 补投带上 `self = handoff.owner`**

```ts
self: (typeof handoff?.owner === 'string' && handoff.owner !== '') ? handoff.owner : undefined,
```

⚠ `handoff.owner` 是 `hob_spawn` 建会话时**记下的归属**（`I-6`：谁欠的这一投）。
⚠ 旧记录没有 `owner`（向后兼容）⇒ 仍传 `undefined`，但**不静默**：
`maxAttempts` 会把它推到「已放弃」而不是无限重试。

### 13.3 验证

| 指标 | 修前 | 修后 |
|---|---|---|
| `runCalls` | ∞（无限重试） | **恰好 3**（= `maxAttempts`） |
| `abandonedAt` | — | **SET** |
| `dueAt` | 有限（继续退避） | **Infinity**（不再选中） |
| `onErrorCalls` | **0**（缺省 noop） | **3**（每次失败都报） |
| 行是否保留 | — | **保留**（可观测，⛔ 不静默删） |

### 13.4 一处发现：队列**不自己定时重试**

`kick()` 只由 `start()` 与 `finally` 触发，**没有定时器**在退避到期后重新调度。
⚠ 这是**既有设计**（依赖外部驱动 / `idle()` 驱动），不是我引入的。
⇒ 验证时必须用 `q.idle('probe')` 驱动，否则只跑第一次就停。
**这一点也解释了为什么「无最大尝试次数」在生产里看起来没出事** ——
实际重试是由宿主调用 `idle()` 或重新 `start()` 时机决定的。

### 13.5 验证

```
check:effects OK    check:handoff-effects OK    check:redeliver OK
check:pipeline OK   check:ledger OK             check:orch OK
check:workflow OK   typecheck OK                build OK
```

### 13.6 账目更新

| 项 | 上一版 | 本轮 |
|---|---|---|
| 已修 | 40 | **41**（+T-10） |
| 未修 | 70 | **69** |
| 其中 high | 2 | **1**（T-14；R-12 需 D-SPEC-2） |


---

## §14 T-14 已修 · 暂存丢弃从「只 warn」变成「可读计数」

### 14.1 缺陷

`stagePendingMessage` 在超条数（32）/ 超字符（256K）时「丢最旧」，
改前**只有一条 `loggerWarn`**：

| 问题 | 后果 |
|---|---|
| 队列在**进程内存**（`pendingBySession` 是 `Map`） | 重启即丢，无痕 |
| 丢弃**永久消失**（宿主已丢过一次，暂存是唯一副本） | 用户输入没了 |
| `loggerWarn` 走 `console.warn` | 本仓自己论证过**生产日志通道会滤掉 warn** ⇒ 可能完全不可观测 |

⇒ **用户输入被丢掉，而没有任何可持久读到的计数。**

### 14.2 修法

新增按会话的丢弃计数 + 读取面：

```ts
const pendingDroppedBySession = new Map<string, { count: number; lastAt: number; lastKey: number }>()
export function pendingDropStatsOf(sessionId: string): { count: number; lastAt: number; lastKey: number } | undefined
```

两处丢弃点（条数超限 / 字符超限）各加一行 `notePendingDropped(sessionId, dropped?.key ?? -1)`。

⚠ **设计取舍（写进了代码注释）**：

**为什么不做成落盘文件**：这条计数**与队列同寿命**才有意义（队列本就是内存的），
落盘会造出「文件里有 5 条、内存里 0 条」的**新错配**。要做持久化得连队列一起做，属另一件事。

**为什么 `undefined` 不等于 `count: 0`**：调用方拿到 `undefined` 时**不应**在界面上写「已丢弃 0 条」——
那是把「没有这件事」说成一个读数（本仓反复记的形态）。

⚠ `loggerWarn` **仍保留**（便于当场排查），本修法补的是「事后还能不能看见」这一半。

### 14.3 验证

| 指标 | 结果 |
|---|---|
| 灌 37 条（上限 32） | 队列 **32**（未超上限） |
| 丢弃计数 | **`count: 5`**（37 − 32） |
| `lastKey` | **5**（可对账最后一条被丢的） |
| 从未丢过的会话 | **`undefined`**（⛔ 不冒充 0） |

### 14.4 验证

```
check:policy OK    check:pipeline OK    check:ledger OK
check:orch OK      check:workflow OK    typecheck OK    build OK
```

### 14.5 账目更新

| 项 | 上一版 | 本轮 |
|---|---|---|
| 已修 | 41 | **42**（+T-14） |
| 未修 | 69 | **68** |
| 其中 high | 1 | **0**（T-14 已清；R-12 需 D-SPEC-2） |
| 其中 blocker | 3 | 3（R-01 段 1 已落地 / R-02 / T-03） |


---

## §15 R-02 拆分方案已完成（含一处自我更正）

R-02 是最后的 blocker 之一。本轮**没有改代码**，只做了施工前调研：
[R02-SPLIT-PLAN.md](R02-SPLIT-PLAN.md)（159 行）。

### 15.1 五份实现已逐份核实

| # | 位置 | 算法 | 消费者 | 现状 |
|---|---|---|---|---|
| **①** | `pipeline-view.ts:175-193` | 逐任务：VER pass + 可复核证据；ACC `accepted` | `activeStage` / `chainCompleted` / 派发闸门 | 已加影子强判据（R-01 段 1） |
| **②** | `stages-index.ts:295-304` `summarizeStage` | **只按 `status` 计数**（`finals` 命中） | `/stages` 面板主数据源 | 未改 |
| **③** | `requirement-chain.ts:386-410` | 每步自己一套 filter | `/requirement-chains` | 未改 |
| **④** | `stage-controls.ts:95` `STAGE_COMPLETION` | 文档性定义 | **零调用** | **纯注释** |
| **⑤** | `project-panel.tsx:71-75` | 客户端回落 | 接口降级时 | **死分支但仍在** |

### 15.2 ⚠ 一处**我自己的判断错了，已更正**

**初稿我写**：「任务 `built` 但无 VER 时，① 判 false、② 判 done ⇒ 第 3 步直接矛盾」。

**实测否定它**（夹具：v3 链 + G1/G2 批准 + 任务 built + RUN returned，无 VER）：

```json
{ "② summarizeStage(task=built)": { "state": "done" },
  "① pipelineView activeStage": 5,
  "① 阶段3 state": "completed",
  "矛盾?": false }
```

⇒ ① 的**阶段 3** 也判 `completed`。原因：`pipeline-view.ts:491` 的 `set(3,{state:'completed'})`
只看 `graphReady`（任务书齐 + 图完整性），**VER 属于阶段 4→5 的门槛**，不是阶段 3 的。

**真正的不一致在哪**（更正后）：

| 维度 | ① | ② | 一致？ |
|---|---|---|---|
| **第 3 步** | `graphReady`：**任务书齐** + 图完整 | `built ∈ finals` 且全 built | **⚠ 不同源** |
| 第 5 步 | VER pass + 可复核证据 | `pass ∈ finals` | 接近 |
| **第 6 步** | `effectiveAcceptanceOf` 分组后的 `verdict` | 单条 `pass ∈ finals` | **⚠ 不同源**（已核实 ① 用分组、② 用单条） |

⇒ **真正的不一致比初稿描述的窄**：不是「完成 vs 未完成」的对立，
而是「同一个步名，两处问的是不同的问题」。

### 15.3 方案本身（4 个 commit）

| commit | 内容 | 风险 |
|---|---|---|
| 1 | 把 ④ `STAGE_COMPLETION` 落成真函数 `stageCompletionOf()`，暂不接调用 | **零**（行为不变） |
| 2 | ② `summarizeStage` 改为调它 | **会改面板显示**（唯一一步） |
| 3 | ③ `requirement-chain` 改为调它 | 连带 `currentStep` / `next` ⇒ 必须与 2 同批验证 |
| 4 | 删 ⑤ 客户端回落 | 低 |

### 15.4 卡住它的**不是技术问题**

> **第 3 步「任务图」的完成判据：任务书齐（① 口径）还是都 built（② 口径）？**

| 选项 | 含义 | 后果 |
|---|---|---|
| **A · 任务书齐即完成**（与 `STAGE_COMPLETION` 文本一致） | 第 3 步管「拆得对不对」 | 第 3/4 步职责清晰 |
| **B · 都 built 才完成**（② 现状） | 第 3 步管「做没做完」 | 第 3/4 步几乎同一判据 ⇒ 两步合一 |

**我建议 A**，理由有三：
1. `STAGE_COMPLETION` 原文写「任务书就绪…**与是否已执行完无关**」——明确排除执行状态；
2. 它自己的注释**记过**「第 3 步与第 4 步都拿 `built` 当完成信号 ⇒ 任务执行很难成为独立阶段」——选 B 等于把那条病再确认一次；
3. 选 A 后「任务书齐 + 还没 built」会正确显示为「第 3 步完成、第 4 步进行中」。

⇒ **合并方向：② 去迁就 ① 的口径，而不是反过来。**


---

## §16 四份交付文档交叉一致性检查（发布前自检）

对 `REVIEW.md` / `FIX-PLAN.md` / `FIX-RESULT.md` / `LEAD-VERIFICATION.md` 做了一次交叉核对。

### 16.1 发现并修正的 5 类问题

| # | 问题 | 位置 | 处理 |
|---|---|---|---|
| **1** | **进度数字三处不一致**：§2 总表写「已修 33 / 未修 77」，§10.5 写「已修 37 / 未修 73」，实际是 **42 / 68** | `FIX-RESULT.md` §2 / §5.1 / §10.5 | 全部改为终值 + 标注「中间读数为当时读数」 |
| **2** | **blocker 计数错**：§5.1 说未修 blocker 有 4 个（含 T-05），但 T-05 实测**已修** | `FIX-RESULT.md` §5.1 | 改为 **3 个**（R-01 段 2–3 / R-02 / T-03） |
| **3** | **§5.2 有 6 条标「❌ 未修」但实际已修**：R-08 / R-22 / S-07 / T-10 / T-14 / O-34 | `FIX-RESULT.md` §5.2 | 逐条实测后改为「✅ 已修」+ 给出证据位置 |
| **4** | **S-08 跨文档矛盾**：`REVIEW.md` 标 `high` 缺陷，`FIX-RESULT.md` 判「已排除」 | `REVIEW.md:1085` | 核实后**确认 FIX-RESULT 正确**，在 REVIEW 里加「⚠ 已排除 + 原因」置顶说明 |
| **5** | **无跨文档导航**：五份文档数字体系不同（112 / 19 批次 / 42-2-68），读者无法判断哪个权威 | `REVIEW.md` 头 / `FIX-PLAN.md` 头 | 各加一段「本文档是什么 / 时效如何 / 进度看哪份」 |

### 16.2 关键更正：**S-08 是我审错了**

**原判断**（REVIEW §S-08）：正则 `/currentPreset\s*!==\s*PLANNING_PRESET_ID/` 指向已改名常量 ⇒ 恒不匹配 ⇒ 判据永不变红。

**实际情况**：这个正则**不是用来匹配靶子的**，而是用来匹配「**必须被禁止的写法**」——
判据问的是「源码里**有没有**出现这种 gating」，有 ⇒ `bad()`，没有 ⇒ `ok()`。
**「匹配不到」正是它应该通过的状态。**

且这条判据**本身是改判过的**：注释 `check-hob-create-ui.mjs:686-694` 明确记录
「旧 CU-5 断言入口 `!== PLANNING_PRESET_ID` 时 return null，它当时是绿的，但那条 gating 读的状态永远是 undefined ⇒ 入口永不渲染 ⇒ **现在改判相反的性质**」。

**实测**：`node scripts/check-hob-create-ui.mjs` ⇒ `✓ CU-5 ✓ 入口不依赖宿主预设状态`。

⇒ 成因是「审计时读到的旧版本」与「当前代码」之间的**时差**，不是缺陷。已从天表标为「已排除」。

### 16.3 顺带实测确认的（把「🟡 需确认」清零）

| 编号 | 之前的存疑 | 实测结论 |
|---|---|---|
| **T-05** | 「`repairOf` 的命中判据是否已换」 | ✅ 已换：`tools.ts:1823` → `stageHealthOfLedger` → `ledgerHealthOf:835`，**与拦截判据同源** |
| **O-35** | 「`hob_orch_control` 的 verify/accept 是否已过 `proceedGate`」 | ✅ 已过：`orchestrator.ts:10736-10742`，注释写明「与 dispatch 同一份实现」 |
| **O-34** | 「是否已随 B2.3 修」 | ✅ 已修：`pipeline-view.ts` `taskGraphOf` 排除 `superseded`（7 处引用） |

### 16.4 检查后仍然成立的结论

| 检查项 | 结果 |
|---|---|
| 112 条总数（REVIEW 天表） | ✅ 一致，`合计 112` |
| 42 + 2 + 68 = 112 | ✅ 算术闭合 |
| §5.1 等级合计 = 68 | ✅ |
| §5.3 分类合计 = 64 | ✅（64 + 4 条 blocker/high = 68） |
| C-01 的「降级」状态 | ✅ 两份文档一致 |
| `LEAD-VERIFICATION.md` / `VERIFICATION.md` | ✅ 是复核记录，无进度数字，**不需要改** |
| `FIX-PLAN.md` 的 112 与 `FIX-RESULT` 的 42-2-68 | ✅ **不是矛盾**（起点 vs 终点），已加导航说明 |

### 16.5 验收状态（本轮未改代码，全部沿用上轮实测）

```
check:pipeline 25/0 · check:stage-controls 104/0 · check:ledger 129/0
check:ledger-projection 14/0 · check:ledger-write-policy 13/0
check:workflow 33/0 · check:meta-negctl 5/0 · check:stages-dom 137/0
check:tasks-route-http 15/0 · check:requirement-chains 19/0
typecheck exit 0 · build OK
check:work-plan-runtime 35/7（pre-existing，与本轮无关）
```


---

## §17 R-15 已修 · 回执判据合并为一份实现

### 17.1 原描述**有两处不准确**，先更正

| 原描述（REVIEW §R-15） | 实测 |
|---|---|
| 「`pipeline.ts:397-409` **零调用方**」 | ❌ 不准确：`scripts/check-pipeline.mjs:174` 在调 `approvalReceiptPattern` |
| 「实际生效在 `tools.ts:2051-2058`」 | ❌ 行号已过期，实际在 **`tools.ts:2229`** |
| 「纯函数版更严（`\s+`）、工具版全宽松（`\s*`）」 | ✅ **成立**，这是本条的真核 |

### 17.2 修法

在 `src/shared/pipeline.ts` 新增 **`receiptPatternOf(artifact, { acceptRevisionRequest })`**，
工具侧 `tools.ts` 改为调用它，**不再内联正则**。

⚠ **刻意保留 `\s*`（不收严）**：收严会让现网已经能通过的回执突然被拒，那是行为回归。
代码注释里写明了「若将来要收严，必须先量存量回执」。

### 17.3 ⚠ 施工中撞到的三个真问题（都不是我预想的那个）

| # | 问题 | 表现 | 处理 |
|---|---|---|---|
| **1** | `revisionOf()` 只认**字符串** `revision` | 传数字 `3` ⇒ 返回 `undefined` ⇒ `?? 0` ⇒ 正则要求「第 **0** 版」⇒ **永远匹配不到** | 新函数显式接受 `string \| number`，注释写明「⛔ 不要改回 `revisionOf`」 |
| **2** | `(?:需求\|方案)?` 可选分组的**回溯优先级** | 正则先试空串 ⇒ 「要求修改**需求** R-P5B」中的「需求」留在原地、后面的 `\s*` 匹配不到 ⇒ **永远不匹配** | 改成**两条并列分支**（带 label / 不带 label），不用可选分组 |
| **3** | 自检用例**漏写版本号** | 我写的是 `'要求修改需求 R-P5B'`（无「第 3 版」）⇒ 实现正确但断言失败 | 补上版本号，并**顺手加一条**「未点名版本号的回执不得被接受」 |

⇒ **问题 2 是这次最有价值的发现**：它说明「可选分组 + 前后都有 `\s*`」这个写法在本仓是**陷阱**，
其他正则若同构，可能有同样的静默失效。

### 17.4 验证

```
check:pipeline  通过 26 · 失败 0   （新增 PIPE-5b，原 25）
其余 7 个 check 族全部 0 失败 · typecheck exit 0 · build OK
```

**负向对拍（实测）**：把内联正则放回 `tools.ts` ⇒
`✗ PIPE-5b · tools.ts 又内联了一份回执正则 ⇒ R-15 复发` ⇒ PIPE 组 25/1；
恢复后 ⇒ `✓ PIPE-5b` ⇒ 26/0。**证明这条断言真会变红。**


---

## §18 R-19 已修 · `ledger/units/` 不许子目录（静默吞数据的收口）

### 18.1 缺陷本体（已回头实测复现）

```
LEDGER_PATH_RE = /^ledger\/(units|spec|changes)\/([A-Za-z0-9._/-]+)$/   ← 字符集含 `/`
读面过滤： ^unit-[^/]+\.toml$                                            ← 不含 `/`
```

⇒ `ledger/units/sub/x.toml` **字符集合法 ⇒ 被放行 ⇒ `ok:true` 落盘**，
但**三个读面全都看不见它**（已核实三处：`hob-write.ts:1137` / `projection-writer.ts:124,340` / `ledger-lifecycle.ts:241`）。

**这不是「吞掉异常」，是「吞掉整条数据」**：连写前合并守卫（只合并 `^unit-.*` 分片）都不参与。

### 18.2 修法

在 `hob-write.ts` 的路径白名单里加一道精确收窄：**`ledger/units/` 的剩余段不得含 `/`**。
新增独立 `RefuseReason` 值 **`ledger-units-nested-denied`**（⛔ 不并进 `not-whitelisted`）。

⚠ **为什么不并进 `not-whitelisted`**：这条路径**字符集上是合法的**，旧白名单确实会放行，
问题不是「你写错地方了」，而是「写进去**任何读面都看不见**」——两者的修法完全不同。
⚠ 也**不是** `ledger-unit-malformed`：那份文件**格式可能完全正确**，只是位置读不到。

### 18.3 ⚠ 施工中踩到的一个坑（值得记）

我第一版断言写的是 `flat.ok === true`（单段分片必须放行），**结果假红**：

```
✗ WP-12 · flat={"ok":false,"reason":"ledger-structure-invalid"}
```

原因：夹具是没有 `parent` / 任务书字段的裸 task，**先被结构校验拦下**。
⇒ 本条验的是**写入面的第一道门（路径白名单）**，不是结构校验。

**改成**：`flatPassedPathRule = flat.reason !== 'ledger-units-nested-denied' && flat.reason !== 'not-whitelisted'`。

⚠ 这个坑的价值：**「断言太强」和「实现有 bug」在输出里长得一样**，
都是 `ok:false`。分辨方法是看 **reason** —— 它指名了是哪条规则在拦。

### 18.4 验证

```
check:ledger-write-policy  通过 15 · 失败 0   （新增 WP-12 / WP-12b，原 13）
其余 9 个 check 族全部 0 失败 · typecheck exit 0 · build OK
```

**负向对拍（实测）**：把收窄条件改成 `false && …` ⇒
`✗ WP-12 · nested={"reason":"ledger-structure-invalid"}` ⇒ 15→14/1；
恢复后 ⇒ `✓ WP-12` ⇒ 15/0。

⚠ 注意负向时的 reason 变化：从 `ledger-units-nested-denied`（R-19 的拒绝）
变成 `ledger-structure-invalid`（结构校验接手）—— **证明收窄确实是第一道门**。


---

## §19 R-18 已修（代码本已正确，本轮补上**保护它的断言**）

### 19.1 关键发现：**R-18 的实现已经是对的，但没有断言保护它**

`projection-writer.ts:159` 的 `removeUnitBlock` 现在**已经是块级处理**：
按 `[[unit]]` 切块 → 解析每块 `id` → `lines.slice(target.end)` 整块丢弃。

⇒ R-18 原文描述的「行级删除留孤儿块」是**旧实现**，已被前序提交修掉。

⚠ **但没有任何断言钉住它。** 这意味着：**任何人改回行级删除，全套自检仍然全绿** ——
这正是 REVIEW §2 反复记的那类病（「修好了但守不住」）。

### 19.2 本轮做的事

| 步骤 | 内容 |
|---|---|
| ① | 把 `removeUnitBlock` 从 `function` 改为 `export function`（仅为可回归测试），函数体**一字未改** |
| ② | 头部补注释：写明「必须是块级删除，⛔ 不能是行级删除」+ 四条后果链 |
| ③ | 新增 **LP-14** 负向对拍 |

### 19.3 LP-14 断言的内容

夹具：三个单元，**目标单元 `B-2` 的 `id` 在第二行**（前面有 `title`）。

| # | 断言 | 为什么 |
|---|---|---|
| ① | 删完块头数 = 2 | 多出来就是孤儿裸块 |
| ② | 删完 `id` 行数 = 2 | 与块头数一致 |
| ③ | 目标 `B-2` 确实没了 | 不能「删了个寂寞」 |
| ④ | **不许出现 `id=""`** | 这是 R-18 的直接症状 |
| ⑤ | `A-1` / `C-3` 仍在 | 不能误删无关单元 |
| ⑥ | 反向对照：目标不存在 ⇒ **原样返回** | ⛔ 返回空串会让调用方写出空分片 |

### 19.4 验证

```
check:ledger-projection  通过 15 · 失败 0   （新增 LP-14，原 14）
其余 8 个 check 族全部 0 失败 · typecheck exit 0 · build OK
```

**负向对拍（实测）**：把 `removeUnitBlock` 改回行级删除（只滤掉 `id` 行）⇒

```
✗ LP-14 · 删完块头数应为 2，实际 3（多出来的就是孤儿裸块）
LP 组：通过 12 · 失败 6      ← 注意：连带 5 条别的也红了
```

恢复后 ⇒ `✓ LP-14` ⇒ 15/0。

⚠ **「连带 5 条也红」是重要信息**：说明行级删除不只影响这一条，
它会污染整个投影链 —— 与 R-18 原文描述的「与 T-07 叠加成累积垃圾」一致。


---

## §20 本轮收口（R-15 / R-18 / R-19 三条已修）

### 20.1 进度

| | 上轮 | 本轮 |
|---|---|---|
| 已修 | 42 | **45** |
| 已排除 | 2 | 2 |
| 未修 | 68 | **65** |
| 其中 blocker | 3 | 3（全部卡决策） |
| 其中 high | 1 | **1**（R-12 卡决策） |

### 20.2 本轮修的三条

| 编号 | 等级 | 是什么 | 关键发现 |
|---|---|---|---|
| **R-15** | medium | 回执正则两份不等价 | **不用收严**：保留 `\s*` 是为现网行为不回归 |
| **R-18** | high | `removeUnitBlock` 留孤儿块 | **代码本已正确，缺的是断言** |
| **R-19** | medium | `ledger/units/` 允许子目录 | **吞的不是异常，是整条数据** |

### 20.3 ⚠ 本轮学到的两件事（都值得写进纪律）

**① 「断言太强」和「实现有 bug」在输出里长得一样。**

R-19 我第一版断言写 `flat.ok === true`，结果是：

```
✗ WP-12 · flat={"ok":false,"reason":"ledger-structure-invalid"}
```

看起来像实现坏了，实际是**夹具不合法、被另一条规则先拦下**。
⇒ **分辨方法是看 `reason`** —— 它指名了是哪条规则在拦。已写进代码注释。

**② 「修好了」和「守住了」是两件事。**

R-18 的实现早就是对的（块级删除），但**没有任何断言钉住它** ——
任何人改回行级删除，**全套 500+ 条自检仍然全绿**。本轮补上 LP-14 后，
负向对拍立刻证明：「改回行级删除 ⇒ 连带 5 条别的也红」。

### 20.4 元规则下限同步抬高（只升不降）

本轮新增 3 条负向对拍，按仓内纪律把下限抬到实测值：

| 族 | 下限 | 实测 |
|---|---|---|
| `check:pipeline` | 20 → **23** | 23（PIPE-5b） |
| `check:ledger-write-policy` | 4 → **6** | 6（WP-12 / WP-12b） |
| `check:ledger-projection` | 1 → **3** | 3（LP-14 及同批） |

### 20.5 最终验收状态（全部实测）

```
check:pipeline             26/0     check:stage-controls       104/0
check:ledger              129/0     check:ledger-projection     15/0
check:ledger-write-policy  15/0     check:workflow              33/0
check:meta-negctl           5/0     check:requirement-chains    19/0
check:stages-dom          137/0     check:tasks-route-http      15/0
typecheck exit 0 · build OK
```

### 20.6 剩余 65 条的状态

| 类别 | 条数 | 能否继续 |
|---|---|---|
| **blocker（3）** | R-01 段 2–3 / R-02 / T-03 | ❌ **全部卡用户决策** |
| **high（1）** | R-12 | ❌ 卡 D-SPEC-2 |
| medium（33） | 死代码 / i18n / 宿主侧 / 独立缺陷 | ✅ **可继续** |
| low（28） | 同上 | ✅ **可继续** |

⇒ **还有 61 条可以继续修，不需要等决策。**


---

## §21 本轮再修两条（T-24 / T-23）

### 21.1 T-24 · `ledger.toml` 无格式校验 ⇒ 写成功、账本随即判废

**缺陷本体（实测复现）**：

```
write_hob('ledger.toml', 'this is not a valid activation record')
  ⇒ { ok: true }                              ← 写成功
ledgerLifecycleOfRoot(...)
  ⇒ { state: 'invalid' }                      ← 账本当场判废
```

`ledger.toml` 是**账本能否使用的总开关**，却在 `checkWhitelist` 里**直通放行**（`hob-write.ts:835`）。

⚠ **两条相邻规则一严一宽，没有理由**：同一道写入口的 `REQUIREMENTS.md` **有**形状校验，
`ledger.toml` 却什么也不查。

#### 修法：复用现成纯函数，⛔ 不另写解析

`ledger-lifecycle.ts:70` 的 `parseLedgerActivation` 已经校验全部六项（无 section / 每行 `key = "v"` /
六必填键 / status 属封闭集 / generation 为正整数 / created_at 可解析）。在 `checkFormat` 里加一段调用它。

#### ⚠ 施工中发现的第二层问题（这才是真难点）

**第一版改完仍然 `ok:true`。** 原因：`checkFormat` **只在 `append` 分支被调用**，
而 `ledger.toml` 的常态是 `overwrite` ⇒ **判据挂在了无人走的路径上**。

⚠ 而这个成因**本仓已经记过一次**：`REQUIREMENTS.md` 的注释（`hob-write.ts:1762-1769`）写着
「`checkFormat` 原先只被 `append` 分支调用 ⇒ 把唯一的形状判据挂在**最少用的那条路**上，等于日常写法不受检」。

⇒ **同一个坑踩了第二次。** 修法照抄 `REQUIREMENTS.md` 的形态：在 `:1771` 附近单独补一次，两模式都走到。

#### 验证

```
check:ledger-write-policy  通过 16 · 失败 0   （新增 WP-13，原 15）
其余 10 个 check 族全部 0 失败 · typecheck exit 0 · build OK
```

**负向对拍（实测）**：把 `if (file === 'ledger.toml')` 改成 `if (false && …)` ⇒
`✗ WP-13 · junk={"ok":true} partial={"ok":true}` ⇒ 15/1；恢复后 ⇒ 16/0。

---

### 21.2 T-23 · TERMINOLOGY 的 kind 表与自己下一节矛盾

**缺陷本体**：kind 表 **10 行**，缺 `verification` / `closure`；
而**紧接的下一节**又要求 `req/change/task/run/verification/acc/closure` 带 v3 字段。
ID 前缀表也缺 `VER-` / `CLS-`，而 `ledger-resources.ts:75-76` 明确支持它们。

⇒ 照表写单元会漏两个 kind；照下一节写又找不到前缀。**一个人照这份术语表办事，两边都错。**

**修法**：补两行到表里（`verification` / `VER-`、`closure` / `CLS-`），现在 12 行与代码封闭集一致。

#### 断言写法（关键）

判据**用代码侧封闭集做基准**（`UNIT_STATUSES` 的键集），**双向差集为空**：

```js
const codeKinds = new Set(Object.keys(statuses.UNIT_STATUSES))   // ← 基准来自代码
const docKinds  = new Set(抽 TERMINOLOGY 那张表)                  // ← 被检方是文档
missingInDoc / strayInDoc 都算失败                                 // ← 双向，不是单向
```

⚠ **⛔ 不在断言里另抄一份 kind 清单** —— 那会变成「同一事实两个来源」，正是本项目明令要防的形态。
⚠ 抽取只认「三、账本术语」节内的表格，**不全文扫** —— 全文里别的表也用反引号（状态名）。

#### 验证

```
check:ledger-resources  查了 18 处 · 过了 18 处   （新增 T-23）
```

**负向对拍（实测）**：删掉 `closure` 行 ⇒

```
✗ T-23 · TERMINOLOGY 的 kind 表漏了：closure
✗ T-23 · TERMINOLOGY 的 ID 前缀表缺 CLS- 前缀
```

恢复后 ⇒ `✓ T-23 …（12 种）` ⇒ PASS。

---

### 21.3 本轮累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 45 | **47** |
| 未修 | 65 | **63** |
| medium | 33 | **31** |

⚠ 元规则下限同步：`check:ledger-write-policy` 6→**7**（WP-13）。


---

---

## §0 分卷指针（⚠ 原文件超 64KB 读上限，已按 M 判据拆分）

本文件保留 **§1–§21**（结论、数字、已修清单、已排除、剩余、以及前 21 轮的逐轮记录）。
**§22 之后搬到 4 个分卷**（⛔ 不是压缩，是整块搬走 + 原位留指针）：

| 分卷 | 章节 | 内容 |
|---|---|---|
| [`FIX-RESULT-VOL1.md`](./FIX-RESULT-VOL1.md) | §22–§33 | 死代码清理、口径对账、O-28/O-29 |
| [`FIX-RESULT-VOL2.md`](./FIX-RESULT-VOL2.md) | §34–§49 | 权威剩余清单建立、O-11 驳回、O-16 保留 |
| [`FIX-RESULT-VOL3.md`](./FIX-RESULT-VOL3.md) | §50–§66 | O-24 驳回、O-30 路径、全量对账（111→112） |
| [`FIX-RESULT-VOL4.md`](./FIX-RESULT-VOL4.md) | §67–§78 | O-02/O-17/T-17/R-16/O-27/S-03/R-09/O-20/O-15/O-21 + 收口轮 |
| [`FIX-RESULT-VOL5.md`](./FIX-RESULT-VOL5.md) | §79–§84 | 检查体系三个假红修复 + `check:all` 全绿 + A 方案第 1~3 轮 |
| [`FIX-RESULT-VOL6.md`](./FIX-RESULT-VOL6.md) | §85–§86 | A 方案第 4~5 轮（判不出五语义 / 耦合量化） |
| [`FIX-RESULT-VOL7.md`](./FIX-RESULT-VOL7.md) | §87 | A 方案第 6 轮（键完整性断言 / 键名泄漏） |
| [`FIX-RESULT-VOL8.md`](./FIX-RESULT-VOL8.md) | §88–§96 | A 方案第 7 轮（自引用事故 / 批替换纪律）+ 后续 |
| [`FIX-RESULT-VOL9.md`](./FIX-RESULT-VOL9.md) | §88–§118 | 验证与进度观察 + 入口清单 / 族数算术 / S-48② 渲染层 |
| [`FIX-RESULT-VOL10.md`](./FIX-RESULT-VOL10.md) | §119–§135 | 判据写源码根治（4 处）· 文档断链 · 英文质量 10 维 · 负向对拍逐族复算 · `as any` 根因 |
| [`FIX-RESULT-VOL11.md`](./FIX-RESULT-VOL11.md) | §136–§152 | 范围自我纠正 · 记账偏差审计 · 审查记录迁出 kit/ |
| [`FIX-RESULT-VOL12.md`](./FIX-RESULT-VOL12.md) | §153–§168 | 四批提交 · O-19/R-03/O-18/R-04/R-12/R-13 修复 · 逐条复核 · 记账偏差 |
| [`FIX-RESULT-VOL13.md`](./FIX-RESULT-VOL13.md) | §169–§190 | R-02 判定 · T 组收口 · STATUS.md 建立 · 段2 实现 |
| [`FIX-RESULT-VOL14.md`](./FIX-RESULT-VOL14.md) | §191– | 段2 在真实账本中不可达（死代码） |
| [`FIX-RESULT-VOL10.md`](./FIX-RESULT-VOL10.md) | §119–§122 | build 流程债 + 并发假红 + **判据往生产源码写盘**（已根治） |

⚠ **拆分的唯一原因是读上限**（64KB），⛔ 不是因为内容变了。
⚠ 拆完之后本文件 60KB、每卷 ≤55KB，**都在上限内**。
