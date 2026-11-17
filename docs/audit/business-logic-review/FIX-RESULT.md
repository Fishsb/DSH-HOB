# dsh-hob 修复工程 · 成果汇总

> **性质**：本文件是修复工程的**交付结论**，不是过程记录。
> **过程记录**见 `LEAD-VERIFICATION.md`（34 节，逐批复核证据）；**方案**见 `FIX-PLAN.md`；**缺陷清单**见 `REVIEW.md`（112 条）。
> **日期**：2026-11-10 起 · **最后订正**：2026-11-11 · **基线**：commit `5ee0797`（分支 `codex/item-presentation`）
> **现状核验**：`npm run check:all` ⇒ **48 族全通过**（可复跑，见 §2.1）
> **逐条权威**：`STATUS.md`（`npm run check:audit-status` 机检形态，含「主卷与本表同口径」断言）

---

## §1 一句话结论

**REVIEW 的 112 条缺陷：47 条已修 · 59 条已修-未机器化 · 3 条已排除 · 2 条按设计处理 · 1 条未修。**

> ⚠ **2026-11-17（批次 3）**：`已修` 这一档从「代码改过了」收紧为「**有指名它的断言**」——即注记里要有一个能命中 `scripts/**` 的断言标识（形如 `⟦check:stage-controls#SC-38⟧`）。
> 存量 106 条**先整批迁到 `已修-未机器化`**（那不是在说「没修」，是说「没人会在它复发时开火」），
> 再由 `check:audit-status` 的棘轮逼着**逐卷往上迁**。

✅ 校验：106 + 3 + 2 + 1 = **112**。

### ⚠ 2026-11-11 订正（三轮）：这一节先后错过三次

| 轮次 | 当时写的 | 错在哪 |
|---|---|---|
| 初版 | 「108 已修 · 剩余 0」 | 把 S-01 的未修与 T-07/T-13 的「按设计」一起吞掉 |
| 二版 | 「106 已修 · 1 已处理 · 2 未完成」 | ① 把 T-07/T-13 两条**按设计处理**压成「1 条已处理」；② 把 R-01 记成「1/3 段未做」——**已过期**，段 2/3 早在 VOL13/VOL14 落地 |
| **本版** | 见上 | 与 `STATUS.md` 汇总表逐字对齐 |

⚠ **R-01 的过期标记要说清**（这是二版最误导的一处）：

```
段 1  影子模式（只报不拦）          ✅ pipeline-view.ts:194
段 2  宽限期（按 provenance 豁免）  ✅ 代码在位；⚠ 真实账本中不可达（VOL14 §191）
段 3  删宽限分支                    ✅ 豁免在 stage-controls.ts 判据函数内部（VOL14 §204）
```

⇒ R-01 **不是「1/3 段」**。段 3 的宽限豁免**在判据函数内部**（不是删掉 `legacy()`），
由 **SC-38 / SC-39 / SC-40** 三条断言守着，负向对拍均成立。
⚠ 仍然未独立验证的只有「段 2 的代码路径在真实账本中可达」——VOL14 §191 实测**不可达**，
但那是「没有存量 v3 坏账」造成的，⛔ 不是实现缺失。

### 已排除 3 条 · 按设计 2 条 · 未修 1 条

| 编号 | 归属 | 一句话 |
|---|---|---|
| S-08 · O-24 · O-15 | **已排除**（复核证伪） | 缺陷描述与实际不符，见 §4 |
| T-07 · T-13 | **按设计处理** | 见 §5.4 |
| **S-01** | **未修**（唯一一条） | 宿主 `ToolRunContext` 没有审批入口，见 §5.5 |

所有已修项都有**可复跑的验证**（不是「改完了」而是「**改坏了会红**」）。
⚠ 每条修复都配了**负向对拍**：把实现改回去 ⇒ 断言当场红。这是本单唯一认的「修好」。

⚠ **「剩余 0」不等于「面板已支持英文」** —— O-21 按裁定 B 关闭
（契约说准 + 机检钉住），**全量迁 i18n（裁定 A）另开单**，见 §77.6。

⚠ **本结论取代本文件早期各节的中间读数**（那些是当时的进度快照）；
逐条账以 **`STATUS.md`** 为准（§66.3 是 STATUS.md 建立**之前**的那版基线，已被取代）。

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
| **已修** | **106** |
| **已排除**（复核证伪） | **3** | **S-08 / O-24 / O-15**（都在 112 内，参与算术）。另有 `C-01` 等**清单外**观察项，不参与算术 |
| **按设计处理** | **2** | **T-07**：不保证原子，但半完成可见（`LP-17` 守）。**T-13**：给 `migrate` 加门会堵死唯一修复通道 —— 见 §5.4 |
| **未修** | **1** | **S-01**：宿主 `ToolRunContext` 只有 `deferContext`/`concludeTurn`，**没有**审批入口；`ToolDefinition` 也没有 `approval` 字段 ⇒ 仓内够不到，见 §5.5 |
| **算术核对** | **112** | 106 + 3 + 2 + 1 = **112** ✅（⚠ 2026-11-11 三订：原表 108+3+1 漏记 S-01 未修与 T-07/T-13 归属；二版把两条「按设计」压成一条） |

> ⚠ **唯一权威是 `STATUS.md`**（112 行逐条，脚本可核 `npm run check:audit-status`）。 |

⚠ 本表是**当前终值**。各分节里的中间数（如 §5.1 的「未修 77 条」、§10.5 的「已修 37」）是**当时**的读数，
已在原处标注为「上一版 / 本轮」，**以本表为准**。

### 2.1 检查族现状（全部实测）

```
（⚠ 以下为**当前终值**，随每轮修复更新；早期中间读数见各轮小结）

check:pipeline              31 · 失败 0     （R-15 新增 PIPE-5b）
check:stage-controls       114 · 失败 0
check:ledger               130 · 失败 0
check:ledger-write-policy   18 · 失败 0     （R-19 新增 WP-12/12b、T-24 新增 WP-13）
check:ledger-projection     18 · 失败 0     （R-18 新增 LP-14）
check:ledger-resources      18 · 失败 0     （T-23 新增 kind 表对拍）
check:hob-create            55 · 失败 0     （T-15 新增 CU-44）
check:workflow              34 · 失败 0
check:meta-negctl            5 · 失败 0
check:requirement-chains    20 · 失败 0
check:stages-dom           149 · 失败 0
check:tasks-route-http      15 · 失败 0
check:policy                49 · 失败 0

typecheck  exit 0
build      OK
check:presets / host / readings / rounds / selfwake   全部 OK
typecheck                  exit 0
```

> ⚠ **2026-11-11 订正：上面那张表已是过期读数。**
> 现状（实测 `npm run check:all`）：**48 族全通过 · 失败 0 · 崩溃 0 · 未执行 0**，
> 处级口径 47 族 **跳过 3 处**（不计入通过），族数下界 48 / 断言下界 47 **双向对齐**（多一条少一条都红）。
>
> ⚠ **具体处数不抄在这里**：它每加一条断言就变（本轮加第⑥条后是 3186）。
> 要看数以 `check:all` 的汇总行为准 —— 抄进文档就会**下一轮失同步**，而这正是本文件此前出错的方式。

⚠ **同批订正一处过期结论**：本节此前写「`check:work-plan-runtime` 35 通过 / 7 失败（既有失败，与本次改动无关）」。
  **实测现在是 43 通过 / 0 失败**（`ASSERTION_FLOORS` 登记值也是 43）。
  ⇒ 那 7 条**已经修好了**（VOL5 §79 记录：「7 处夹具修好（36→43）」）。
  ⛔ 不要再把它当「已知既有失败」引用 —— 那会让后来者以为有一族永远是红的。

---

## §3 已修缺陷（**本轮次前 33 条**，按主题分组）

⚠ 本节只覆盖**早期**修的那 33 条。此后陆续又修了 15 条（T-08 / T-05 / O-35 / O-34 / R-08 / R-22 / S-07 / T-10 / T-14 / R-15 / R-18 / R-19 / T-23 / T-24 / T-15），
分别记在 §9 起的各轮小结里。**当前总数见 §2**（已修 **106**）。

⚠ **「已修 67」是过期读数**（2026-11-11 订正）：那之后又修了几十条，终值以 §2 与 `STATUS.md` 为准。
  ⛔ 不要把本节的分节小计相加当总数 —— 各轮小结里一个条目可能出现在多节。

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

## §4 已排除（**3** 条，复核证伪；均在 112 内）

⚠ 标题此前写「2 条」，而 `STATUS.md` 汇总表与逐条行都是 **3 条**（S-08 · O-24 · O-15）。
  表里原来列的第二行是 **`C-01`**，它是**清单外**观察项（不参与 112 的算术）⇒ 已挪到本节末尾。
  这是 §207 同族的口径不一致：**汇总表改了、本节标题没跟上**。

| 编号 | 原判断 | 实际 |
|---|---|---|
| **S-08** | CU-5 正则指向已改名常量 `PLANNING_PRESET_ID` ⇒ 恒假面 | CU-5 **早已改成反性质判据**：检查「源码里不得出现按宿主预设做 gating」，`PLANNING_PRESET_ID` 是**被禁止出现的靶子**。实跑 `CU-5 ✓` |
| **O-24** | `t()` 的兜底回退掩盖了「词条缺失」 | 复核证伪：`t()` 兜底是**有意设计**（缺失时回退原文，不让面板变白）⇒ 缺陷不成立（VOL11 §150） |
| **O-15** | 某处降级处理是缺陷 | 复核证伪：用户裁定为**有意设计**，⛔ 不按 REVIEW 改（§76） |

**清单外观察项**（⛔ 不参与 112 的算术）：

| 编号 | 观察 | 结论 |
|---|---|---|
| **C-01**（已降级） | primitives 是否在宿主 seed 里 | 两条注释**互相矛盾**，无第三方证据；`lib/client.js:28` 的 require 只证明产物里有，不证明运行时失败 |

---

## §5 未修的 1 条 · 按设计的 2 条

⚠ **本节此前写成「未修（0 条）」，而同一节 5.2 表里 3 行标着「❌ 未修」、5.3 又写「76 条未修」** ——
  同一节里三个互相矛盾的口径（§207 同族）。已按 `STATUS.md` 重写。

| 等级 | 条数 | 明细 |
|---|---|---|
| **blocker** | **1** | **S-01**（宿主能力缺失，见 §5.5） |
| **high** | **0** | ✅ 全部已修 |
| medium | **0** | ✅ O-21 按裁定 B 关闭（§77，⛔ 不等于面板已支持英文） |
| low | **0** | ✅ O-15 已排除（复核证伪 + 用户裁定为有意设计，§76） |

⇒ **不是「剩余 0 条」**：112 条 = 106 已修 + 3 已排除 + 2 按设计 + **1 未修（S-01）**。

### 5.1 为什么 5.2 / 5.3 那两张表已经作废

那两张表是 **2026-11-10 的进度快照**，其中标「❌ 未修」的三条**此后都已修好**：

| 编号 | 5.2 当时写的 | 现在（已核实） |
|---|---|---|
| **R-02** | ❌ 未修：链完成仍有 5 份实现 | ✅ 已修：`requirement-chain.ts:348` 起派生自 `pipeline-view`，客户端 4 处全用 `displayState`；规格第①条经双向量证**与设计相反**，⛔ 不应实现（VOL14 §198） |
| **T-03** | ❌ 未修：判不出 `ownerWsRoot` 就静默跳过 | ✅ 已修：`orchestrator.ts:5611` 起改为**显式「未投影」读数**，⛔ 不再静默 |
| **R-12** | ❌ 未修：首次批准前改内容不递增 revision | ✅ 已修：`pipeline.ts:672` 起判据与 decision **解耦** ——「digest 变了 ⇒ revision 必须递增」 |

⚠ **「5.3 其余 64 条」同样是过期读数**：那批 medium/low 已在后续各卷逐条修完，
  以 `STATUS.md` 逐条行为准。⛔ 不要再用旧表的「76 条未修」做分母。

### 5.4 按设计处理 2 条（⛔ 不是未修）

| 编号 | 为什么不修 | 证据 |
|---|---|---|
| **T-07** | 投影**保证不并发、但不保证原子**；半完成已可见（`partial{created,failed}`），不做回滚是设计取舍 | `projection-writer.ts:89` 明写；`LP-17` 守 |
| **T-13** | 4 个写工具里 `approve` 是**唯一该加闸门**的（已加）；`init`（开张）· `migrate`（修复通道）· `rebuild`（归档重建）**都不该拦** —— 它们正是「账本坏了」时要用的 | VOL14 §197 查实 `proceedGate` 判定面含 `store-unreadable`/`unknown-legacy` |

⚠ **为什么单列而不并进「已修」**：它们的行为**没有改**，只是确认了「现状即正确」。
  并进已修会让「已修 106」这个数字失去意义（§207 同族）。

### 5.5 未修 1 条：S-01（唯一 blocker）

```
攻击面：A 方案已落地 —— write_hob 不能写批准分片（APPROVAL_ONLY_SHARDS + isApprovalOnlyPath）
        ⇒ 从「两条可绕过路径」收窄成「一条」
根治路：两条都够不到 ——
        C1  工具内主动请求审批   需 ctx.approval.request   ⇒ ToolRunContext 没有
        C2  用户消息 MessageId   需宿主消息回读 API       ⇒ ToolRunContext 没有
```

⚠ **定性要准**（VOL14 §210）：宿主**有**审批接缝（`ToolExecutionPipeline` 的 `serviceAsk`，
  语义完整：allowed-once 放行、其余三种拒绝且理由各不相同）。
  但它是 **private 方法**，工具实现体与工具声明层（`ToolDefinition` 无 `approval` 字段）**都够不到**。
  ⇒ 不是「宿主没有审批机制」，是「**接缝在 pipeline 内部，工具侧没有入口**」。

⇒ 仓内无解，需宿主侧二选一：给 `ToolRunContext` 加 `requestApproval()`，或给 `ToolDefinition` 加 `approval?: 'never' | 'ask'`。
  ⚠ 在此之前**不得**把 S-01 标成「已根治」，也**不得**标成「已修」。

---

## §6 需要你决策的两件事（⚠ 一条已被证伪、一条已有实现）

### 6.1 D-1 · 批准通路 —— ⛔ 「选 C1 还是 C2」这个问法本身已作废

**现状**：A 已落地（`write_hob` 不能写批准分片），但批准工具**仍由 Hob 调用**、`decided_by` **仍是硬编码 `"user"`**、
`source` **仍是对自填字符串跑正则**。⇒ Hob 只要自己拼一句「确认需求 R-01 第 1 版」就能通过。

⚠ **原表第二行「C1 当前部署下必然失败」是错的**（VOL14 §192 / §210 核实）：

```
REVIEW 原写：defaultPreset: danger-full-access → approval: never → request() 返回 rejected
实测：      grep 'approval: never' preset/ src/   →  0 处
            ⇒ 不是「调了会被拒」，是「根本没有这个入口」
```

| 选项 | 真实情况 | 需要谁 |
|---|---|---|
| **保持现状（只做 A）** | 攻击面已从两条收窄成一条 | 无 |
| **C1：`ctx.approval.request()`** | ⛔ `ToolRunContext` **没有**这个方法（只 `deferContext`/`concludeTurn`）；宿主 `serviceAsk` 是 private | **宿主加 API** |
| **C2：用户消息 MessageId** | ⛔ 宿主**没有**会话消息回读能力（`ctx.sessions` 0 命中） | **宿主加 API** |

⇒ **不是二选一的产品决策，是宿主能力缺口**。仓内两条路都够不到（详见 §5.5）。
**无论选哪个，都不得把 S-01 标成「已根治」。**

### 6.2 D-SPEC-4 · 存量「验证者=实现者」的 VER/ACC 是否永久豁免 —— ✅ 已有实现，问题被证伪

**现状**：R-01 **段 1/2/3 都已落地**（原写「段 1 已落地、段 2–3 等 D-SPEC-4」是过期的）：

```
段 1  影子模式（只报不拦）                    ✅ pipeline-view.ts:194
段 2  宽限期（按 provenance 豁免历史单元）      ✅ 代码在位；⚠ 真实账本中不可达（VOL14 §191）
段 3  强判据参与判定 + 豁免在判据函数内部      ✅ VOL14 §204，SC-38/39/40 三条断言守
```

⚠ **关键发现（VOL14 §204）**：「删宽限分支」**不是**删掉 `legacy()` ——
  后者是**豁免的凭据**（三层他证：自报 + 非 v3 + provenance），
  真正要删的是「整段跳过」的分叉。⚠ 我此前读漏了 3 轮，把它记成「未做」。

⚠ **§191 的「段 2 不可达」是什么意思**：进入段 2 的 push 分支需要「存在 v3 存量账本且单元缺证据」，
  而现行分片数据里**没有这种单元** ⇒ 不是实现缺失，是**当前没有对象**。
  等真有存量 v3 账本时它会自然生效；在那之前**无法造夹具证明**。

⇒ **不需要你再拍板「永久豁免 / 宽限到下次验证 / 直接全量」**：实现已经选定「宽限到 provenance 判定」，
  且历史单元的豁免有断言守着。如果你想改成「直接全量」，那才是新的决策。

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