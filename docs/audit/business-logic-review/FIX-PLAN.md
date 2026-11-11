# dsh-hob 修复方案（FIX-PLAN）

> **性质**：本文件是 REVIEW.md（112 条缺陷审查）的**施工方案**，不是又一次审查。
> **依据**：四份域级修复规格 `fix/01-judgment.md`（1327 行）· `fix/02-ledger.md`（1737 行）· `fix/03-client.md`（1319 行）· `fix/04-selfcheck.md`（954 行），以及 `REVIEW.md`（1914 行）。
> **纪律**：本方案与四份规格**全部只读产出**——未修改任何源码 / 配置 / 文档。所有「改后会通过」都是**规格**，不是**结果**。
> **日期**：2026-11-10
>
> ---
>
> ⚠ **本文件是「计划」，不是「结果」。** 实际施工情况看 **[FIX-RESULT.md](FIX-RESULT.md)**：
>
> | | 本文件（FIX-PLAN） | FIX-RESULT.md |
> |---|---|---|
> | 内容 | 19 个批次怎么修、依赖图、施工卡 | 实际修了哪些、怎么验的、还剩什么 |
> | 数字 | 112 条**待修** | 已修 **42** / 已排除 **2** / 未修 **68** |
> | 状态 | ⛔ **不会随施工更新**（保持方案原貌） | ✅ **唯一权威的进度来源** |
>
> ⇒ 两者数字「对不上」是**正常的**：本文件的 112 是**起点**，FIX-RESULT 的 42/2/68 是**终点**。
> ⛔ 不要拿本文件的批次完成情况去核对进度，那些勾选只记录了方案侧的确认。

---

## §0 怎么用这份文档

| 你想做的事 | 读哪一节 |
|---|---|
| 决定先修什么 | **§1 排序** + **§2 批次总表** |
| 判断两件事能不能并行 | **§3 依赖图** |
| 开一个 PR 动手 | **§4 施工卡**（按批次） |
| 我该先拍哪些板 | **§7 待拍板**（12 条，按影响面排序） |
| 改完怎么验收 | **§8 验收总表**（112 行）+ **§4** 每卡的负向对拍 |
| 哪些这次不做 | **§9 不在本次范围** |

**三条必须先读的结论**：

1. **只有 51 条（45%）出了可执行规格**，其余 61 条在 §9 明确列为「未出规格」。不要以为这份方案覆盖了全部 112 条。
2. **批准链（S-01）在默认配置下无法根治**：宿主默认 `approval: never` ⇒ `ctx.approval.request()` 必然返回 `rejected`。本方案的主路径实际是 **A（白名单收窄）+ C2（消息凭据）**，C1 是上限。**不得把 S-01 标成「已根治」。**
3. **R-01 改强判据会让存量账本大面积变红**，且历史 VER/ACC 的证据补不回来 ⇒ 必须走 §6 的三段式迁移。

---

## §1 排序：按什么顺序修

### 1.1 排序判据（不是「有没有门」，是「判据可不可信」）

REVIEW.md §1.4.4 做过一次交叉统计，结论是：

| 环节的判据状态 | 命中缺陷 | blocker | high | high+ 占比 |
|---|---|---|---|---|
| 可信且真执行（①③） | 6 | 0 | 0 | **0%** |
| **被绕过 / 不参与判定**（②④⑤⑧⑨） | 14 | **5** | 7 | **86%** |
| 门在但只有弱判定（⑩） | 3 | 0 | 0 | **0%** |
| 无门只有出口（⑥⑦⑪） | 12 | 1 | 8 | 75% |

⇒ **「判据可不可信」预测严重度，「有没有门」不预测**（主控曾提出后一种说法，被统计推翻，见 LEAD-VERIFICATION §16）。

本方案据此把「封堵可绕过面」排在「让失败可观测」之前：前者 86% 命中 high+，后者 75%。

### 1.2 五个阶段

| 阶段 | 主题 | 批次 | 条数 | 为什么在这一阶段 |
|---|---|---|---|---|
| **0** | 地基（行为零变化） | B0.1–B0.3 | 6 | 后续所有判定改动都依赖它们，且本身不改变任何结果 ⇒ 可安全先合 |
| **1** | 封堵可绕过面 + 统一判据 | B1.1–B1.4 | 12 | 86% 的 high+ 在这里；不封堵，后面改强判据都是给旁路加固 |
| **2** | 判定改强 | B2.1–B2.3 | 7 | 依赖阶段 1 的单一判据；改早了会出现「两套判据都变严」的假象 |
| **3** | 让失败可观测 | B3.1–B3.5 | 10 | 不改判定，只改出口；用来**看见**阶段 1/2 的效果 |
| **4** | 自检与文档装牙 | B4.1–B4.4 | 16 | 让上面所有改动「改坏了会红」；必须最后做，否则无法自证 |
| **5** | 未出规格 | B5 | 61 | 见 §9，本方案不含施工卡 |

⚠ **阶段 3 与阶段 1/2 可并行**（不同文件、不同层）；**阶段 4 必须最后**（它给前面所有改动装断言）。

---

## §2 批次总表

| 批次 | 名称 | 缺陷 | 触及文件 | 可并行 |
|---|---|---|---|---|
| **B0.1** | S-02 地基：provenance + resolver | S-02 | `stage-controls.ts` `pipeline.ts` `modules/tools.ts` | ❌ 必须最先 |
| **B0.2** | 写前校验：重复计入 + 吞解析失败 | T-01 O-33 O-37 O-43 | `hob-write.ts` `tools.ts` | ✅ 与 B0.1 并行 |
| **B0.3** | 负控计数器剥注释 | S-16 | `check-meta-negctl.mjs` | ✅ |
| **B1.1** | 批准收窄：白名单 + 闸门 + 结构校验 | S-01 T-13 T-06 R-12 | `hob-write.ts` `tools.ts` `pipeline.ts` | ❌ 依赖 B0.1 |
| **B1.2** | 解析器合并 + 读侧三态 | R-06 O-09 | `tools.ts` `ledger-resource-route.ts` | ❌ 依赖 B0.2 |
| **B1.3** | 四出口统一 `ledgerHealthOf` | T-02 T-05 O-05 | 新建 `ledger-health.ts` + 四处出口 | ❌ 依赖 B1.2 |
| **B1.4** | 投影写坏不自拦 | R-18 T-07 O-07 | `projection-writer.ts` | ✅ 依赖 B0.2 |
| **B2.1** | G3 进派活闸门 | R-05 R-10 | `pipeline-view.ts` | ❌ 依赖 B1.3 |
| **B2.2** | 多轨门禁前移 | R-28 | `orchestrator.ts` `tools.ts` | ✅ 与 B2.1 |
| **B2.3** | 强判据参与判定 + 当前方案 | R-01 R-13 O-32 O-34 | `pipeline-view.ts` `stage-controls.ts` 新建 `current-plan.ts` | ❌ 依赖 B2.1 |
| **B3.1** | 面板停刷 + 取数可观测 | T-04 O-18 O-36 R-26 O-23 T-17 | `project-panel.tsx` | ✅ 与阶段 1/2 并行 |
| **B3.2** | 健康读数读 count/truncated | T-09 | `project-panel.tsx` | ✅ 与 B3.1 同批更省 |
| **B3.3** | 切账本清详情缓存 | T-16 | `project-panel.tsx` | ✅ |
| **B3.4** | legacy 第 5 步单一集合 | R-08 | `requirement-chain.ts` + `project-panel.tsx` | ❌ 两端同批 |
| **B3.5** | G3–G6 阻断原因进面板 | T-08 | `project-panel.tsx` `requirement-chain.ts` | ❌ 依赖 B2.3 + O-32 |
| **B4.1** | 负控下限抬到 ≥1 | S-06 | `meta-negative-floor.json` | ❌ **必须在 B0.3 之后** |
| **B4.2** | 恒假面 + 族数口径 | S-08 S-10 S-11 S-13 T-21 | `check-meta-negctl.mjs` `package.json` `check-all.mjs` | ✅ |
| **B4.3** | 词表收敛（步名 + 提示词） | R-03 R-04 T-22 O-40 | `stage-controls.ts` `preset/**` `bus.ts` | ✅ |
| **B4.4** | README 与文档契约 | R-27 T-18 T-19 T-20 T-23 R-29 | `README.md` `TERMINOLOGY.md` | ✅ 零风险 |

---

## §3 依赖图

```
                          ┌──────── B0.1 (S-02 provenance) ────────┐
                          │                                        ▼
  B0.3 (S-16 计数器) ─► B4.1 (S-06 下限)              B1.1 (S-01 收窄)
                          │                                        │
                          │                                        ▼
  B0.2 (T-01/O-33) ─► B1.2 (R-06 解析器) ─► B1.3 (T-02 四出口) ─► B2.1 (R-05 G3)
        │                                     │                    │
        ▼                                     ▼                    ▼
  B1.4 (R-18/T-07)                      B2.3 (R-01 强判 + R-13)  B2.2 (R-28 多轨)
                                            │
                                            ▼
              B3.1 ─ B3.2 ─ B3.3 ─ B3.4 ─ B3.5 (须在 O-32 之后)
  B4.2 / B4.3 / B4.4（独立，可与任意阶段末并行）
```

### 3.1 硬依赖（顺序颠倒会出什么问题）

| 依赖 | 颠倒的后果 |
|---|---|
| **S-16 → S-06** | 先抬下限 ⇒ 「用注释凑数」变得有利可图，且改完计数器后要重算所有族的下限 |
| **B0.1（provenance）→ B1.1 / B2.3** | 没有 provenance，R-01 的宽限判据只能回落到 `created_at`（自填）⇒ **把刚删掉的自证结构换个名字请回来** |
| **O-37 → T-01**（同批） | T-01 修好后账本从「全冻结」变成「能追加但历史单元仍挤在 index」，而 `hob_ledger_migrate` 够不到分片 ⇒ 存量永远搬不出去 |
| **R-10 → R-05** | 覆盖校验读错字段名（`criteria_refs` vs `acceptance_criteria_refs`），先接闸门 ⇒ 按文档写反而永远报缺口 |
| **T-02 → T-05** | `repairOf` 的命中判据来自 `ledgerHealthOf`；四出口不统一就换判据 ⇒ 死锁换个方向继续存在 |
| **B1.3 → B2.1** | `stageHealthOfLedger` 用的还是 `stageControlProblems`，先接 G3 闸门会造出「闸门更严但健康面说没问题」 |
| **O-32 → T-08** | 同条 VER 被 push 两次；先修面板 ⇒ 「另有 N 条」立刻虚高（实测 7 条里去重后是 5 条） |
| **R-08 服务端 ↔ 客户端同批** | 只改服务端 ⇒ ACC 印「技术验证通过」；只改客户端 ⇒ `waived` 印「判不出（原值 waived）」。**两者都静默** |

### 3.2 可并行组

| 组 | 成员 | 依据 |
|---|---|---|
| **P-A** | B0.1 ‖ B0.2 ‖ B0.3 | 三处不相交文件 |
| **P-B** | B1.4 ‖ B1.2 | 前者 `projection-writer.ts`，后者 `tools.ts` |
| **P-C** | B2.2 ‖ B2.1 | 前者 `orchestrator.ts`，后者 `pipeline-view.ts` |
| **P-D** | 阶段 3 全部 ‖ 阶段 1/2 | 客户端 vs 服务端，不同文件 |
| **P-E** | B4.2 ‖ B4.3 ‖ B4.4 | 互不相交 |

---

## §4 施工卡

> 每卡七要素：①位置 ②改什么 ③具体改法 ④依赖 ⑤验证+负向对拍 ⑥回退 ⑦改动面。
> **详细代码形状见对应规格的章节**，本表只给施工必需项；具体到函数签名与逐行改法请直接翻规格。

### B0.1 · S-02 地基：provenance + resolver

| 要素 | 内容 |
|---|---|
| **①位置** | `stage-controls.ts:271`（`legacy()`）、`pipeline.ts`、`modules/tools.ts` |
| **②改什么** | 把「历史豁免」的判据从**单元自填字段**改为**写入方注入的 provenance** |
| **③具体改法** | `legacy()` 三层：① `clarify_legacy==='pre-control'` 仍读，但②必须 `provenanceOf(id)==='legacy-migrated'` ③且 `created_at < CONTROL_CUTOFF`。新增 `UnitProvenance` 类型 + `setProvenanceResolver()`，由 `tools.ts` 的三个出口注入。**行为零变化**：存量 177 行仍豁免 |
| **④依赖** | 无（最先做） |
| **⑤验证 + 负向对拍** | 存量 177 行豁免数**前后相等**；`/tmp/fix_probe_s02_ledger.mjs` 缺口数不变。负向对拍：把 resolver 换成「恒返回 legacy-migrated」⇒ 新写 v3 单元也能豁免 ⇒ 断言红 |
| **⑥回退** | 删 commit-1，回到「自填豁免」 |
| **⑦改动面** | 中（3 文件，~120 行） |
| **详规** | `01-judgment.md` §3.2、§9 #9/#10 |

### B0.2 · 写前校验：重复计入 + 吞解析失败

| 要素 | 内容 |
|---|---|
| **①位置** | `hob-write.ts:1040-1093`（`checkLedgerUnitWrite`） |
| **②改什么** | ① `index.toml` 被读两次 ⇒ 第二条单元永远写不进 ② 解析失败的分片被当空数组 ⇒ 账本已坏时守卫静音 |
| **③具体改法** | ①**不变量改为「每个物理文件最多被读一次」**：`rel==='index.toml'` 时合并数组第一项不读（**不是**排除第三项——那只修 append，不修 overwrite）。②`readToml` 不再 `catch { return [] }`，解析失败 ⇒ 拒写并报 `ledger-unit-unreadable`。③`O-37`：`hob_ledger_migrate` 遍历 `index.toml + unit-*.toml` 逐文件 overwrite |
| **④依赖** | 无 |
| **⑤验证 + 负向对拍** | 三变体对照：`drop-item1` 在 append/overwrite 两格 `dups` 都为 ∅；分片写入行为与修前**完全相同**（实测四格）。负向对拍：改回 `none` ⇒ 两格都报重复 |
| **⑥回退** | 单 commit 可整体 revert（无数据格式变化） |
| **⑦改动面** | 小（1 文件，~15 行） |
| **详规** | `02-ledger.md` §1.3/§1.3.2、A-4 |

### B0.3 · 负控计数器剥注释

| 要素 | 内容 |
|---|---|
| **①位置** | `check-meta-negctl.mjs:48`（`CALL_LIT_RE`）、`:56`（`countLabels`） |
| **②改什么** | 计数器是纯文本匹配，行注释 / 块注释 / JSDoc / 字符串字面量里的假标签**全部计数** |
| **③具体改法** | `countLabels` 先剥注释再计数：`src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'')`，并新增 `regexLiterals` 处理（字符串里的 `//`）。⚠ **必须是独立一批**：改完 `check:meta-negctl` 会从 4 掉到 3 ⇒ **M-1 必然自红一次**，这是正确性证据 |
| **④依赖** | 无 |
| **⑤验证 + 负向对拍** | `N-M1c` / `N-M1d` 两条断言 ✓；M-1 因 3<4 而红（**预期**）。负向对拍：在任一族注释掉一条真实对拍 ⇒ M-1 必须红（这才是有牙的判据） |
| **⑥回退** | 单脚本改动，revert 即恢复 |
| **⑦改动面** | 小（1 脚本，~40 行） |
| **详规** | `04-selfcheck.md` §1 ③ |

### B1.1 · 批准收窄 + 闸门 + 结构校验

| 要素 | 内容 |
|---|---|
| **①位置** | `tools.ts:1994/2093/2107`（`ledgerApprove.execute`）、`hob-write.ts:163/1022`、`pipeline.ts:34-41/351` |
| **②改什么** | ① `write_hob` 可直接写 `unit-pipeline-approval.toml` ⇒ 绕过一切回执校验 ② approve 不过 `proceedGate` ③ 该写还跳过结构校验 |
| **③具体改法** | ①`hob-write.ts` 新增 `APPROVAL_ONLY_SHARDS` + `isApprovalOnlyPath()`，`checkLedgerUnitWrite` 首行 `refuse`（**白名单层收窄，方案 A**）②`ledgerApprove.execute` 真写分支加 `proceedGate`（dryRun 走 D-SPEC-1）③`validateLedgerStructure: true`（decision 与封闭契约完全兼容，实测走统一校验 `ok:true`）④`R-12`：`revision` 与内容身份解耦（D-SPEC-2 待拍板） |
| **④依赖** | B0.1 |
| **⑤验证 + 负向对拍** | `write_hob('ledger/units/unit-pipeline-approval.toml',…)` ⇒ **必须被拒**；隔离会话调 approve ⇒ 被拒。负向对拍：放开该路径 ⇒ 断言红（这条是本次审计的旗舰断言） |
| **⑥回退** | 按 commit-2 整体 revert；已写入的 decision 单元不受影响 |
| **⑦改动面** | 中（3 文件，~80 行） |
| **详规** | `01-judgment.md` §2.2、§9 #11/#12 |

### B1.2 · 解析器合并 + 读侧三态

| 要素 | 内容 |
|---|---|
| **①位置** | `tools.ts:159-220`（宽松解析器）、`:788-790`、`ledger-resource-route.ts:100-105` |
| **②改什么** | 严格解析器做门禁、宽松解析器做读取 ⇒ 同一本账在门禁眼里非法、在读取眼里正常 |
| **③具体改法** | 删掉宽松解析器，`readLedgerUnits` 改调 `parseUnitsToml` 并把异常作为 `index-malformed` / `index-legacy` 向上抛；`/ledger-resource` 新增三族 reason（复用 `STAGES_REASON_*` 常量，⛔ 不复制字面量） |
| **④依赖** | B0.2 |
| **⑤验证 + 负向对拍** | 旧格式账本 ⇒ `/ledger-resource` 报 `index-legacy` 而非 `not-found`。负向对拍：保留宽松解析器 ⇒ 断言红 |
| **⑥回退** | 单独 revert；与新 reason 一并回滚 |
| **⑦改动面** | 中（3 文件，~90 行） |
| **详规** | `02-ledger.md` §2.3/§2.5 |

### B1.3 · 四出口统一 `ledgerHealthOf`

| 要素 | 内容 |
|---|---|
| **①位置** | 新建 `src/shared/ledger-health.ts`；`stages-index.ts`、`ledger-readiness.ts`、`stage-controls.ts`、`tools.ts:581/711` |
| **②改什么** | 同一本账有 4 套「健康」判据，实测四种结论（如「只有审批缺口」时 readiness 报 ready/0，另三处全 BLOCK） |
| **③具体改法** | 抽唯一入口 `ledgerHealthOf(units)` 返回 `{problems, canProceed}`，四处全部改调；`repairOf` 换判据（`T-05` 同批）。**硬约束**：必须放 `src/shared` 且纯函数（⛔ 不 import `node:fs`）——出口④在 `stages-index.ts`，而该文件的**传递闭包**在 client 产物里（client → `stage-status-labels.ts:25` 值导入 `STAGE_KIND_STATUSES` → `stages-index`），所以纯函数约束是**构建级硬约束**。分步 0-4 见规格 §3.6 |
| **④依赖** | B1.2 |
| **⑤验证 + 负向对拍** | 四出口对同一夹具**必须同结论**。负向对拍：只切三处、留一处 ⇒ 断言红 |
| **⑥回退** | 步骤 0 只新增（零行为）⇒ 可先合；步骤 1-4 需整体 revert |
| **⑦改动面** | 大（5 文件，~300 行） |
| **详规** | `02-ledger.md` §3.3/§3.6 |

### B1.4 · 投影写坏不自拦

| 要素 | 内容 |
|---|---|
| **①位置** | `projection-writer.ts:130-150/162/265-272` |
| **②改什么** | ① `removeUnitBlock` 在 id 非首键的分片上留孤儿块，仍返回 `ok:true` ② 半完成无回滚且幂等键让重试不补迁移 ③ 该写还跳过结构校验 |
| **③具体改法** | ①块级删除（整 `[[unit]]` 块，非行级）②失败时回带 `partial:{created,failed}` 并在状态行点名「需人工修账」③删 `validateLedgerStructure:false`（与 `T-06` 的 `:272` 同批） |
| **④依赖** | B0.2 |
| **⑤验证 + 负向对拍** | id 非首键夹具跑两次 ⇒ 单元数不变、无孤儿块。负向对拍：改回行级删除 ⇒ 实测 `units=3/orphans=1` |
| **⑥回退** | 单独 revert |
| **⑦改动面** | 中（1 文件，~60 行） |
| **详规** | `02-ledger.md` §4.3、A-14 |

### B2.1 · G3 进派活闸门

| 要素 | 内容 |
|---|---|
| **①位置** | `pipeline-view.ts:570-644`（`pipelineDispatchProblems`）、`:692/696/714`（`refsOf`） |
| **②改什么** | ① 覆盖缺口 / 依赖环 / 悬空依赖**不进任何派活闸门**，任务图有洞照样能派活 ② 覆盖校验读 `criteria_refs`，而契约字段是 `acceptance_criteria_refs` |
| **③具体改法** | ①先把 `refsOf` 统一覆盖字段（`R-10`，**必须先做**）②`pipelineDispatchProblems` 末尾追加 G3 段 + `requirementOfTask` |
| **④依赖** | B1.3 |
| **⑤验证 + 负向对拍** | 任务 `criteria_refs:[]` + `depends_on:['TSK-NOT-EXIST']` ⇒ 派活必须被拒并带出缺口清单。负向对拍：删 G3 段 ⇒ 实测返回 `[]`（当前行为） |
| **⑥回退** | 按 commit-3 revert |
| **⑦改动面** | 中（1 文件，~70 行） |
| **详规** | `01-judgment.md` §5 |

### B2.2 · 多轨门禁前移

| 要素 | 内容 |
|---|---|
| **①位置** | `orchestrator.ts:4771-4816`、`tools.ts:881-936` |
| **②改什么** | `hob_dispatch({tracks})` 带新 `planId` 时 `listWorkPlans` 找不到它 ⇒ 门禁落到「只报健康」⇒ **多轨是唯一能绕过任务链门禁的入口** |
| **③具体改法** | 在 `dispatchPlan` 内、`writeWorkPlan` **之前**，用 `normalized.tracks` 的每个 `taskId` 逐个跑 `pipelineDispatchProblems`（与单目标同源，⛔ 不另写一份） |
| **④依赖** | 可与 B2.1 并行 |
| **⑤验证 + 负向对拍** | 首次多轨派活传不存在的 `planId` ⇒ 必须被拒。负向对拍：门禁留在写盘之后 ⇒ 断言红 |
| **⑥回退** | 单独 revert |
| **⑦改动面** | 小（2 文件，~40 行） |
| **详规** | `01-judgment.md` §6 |

### B2.3 · 强判据参与判定 + 当前方案

| 要素 | 内容 |
|---|---|
| **①位置** | `pipeline-view.ts:175-193/322-344`、`stage-controls.ts:711-714`、`pipeline-view.ts:664-669/101-108` |
| **②改什么** | ① G4/G5「完成」用弱判定，强判据只进 `blockedBy` ② G6 取「物理顺序最后一个方案」③ 同条 VER 被 push 两次 ④ 任务图用含 superseded 的全部 change |
| **③具体改法** | ①新增 `taskVerificationProblems`/`taskAcceptanceProblems`，并入 `allTasksVerified`/`allTasksAccepted` ②抽 `currentPlanOfStrict`（`status∈{agreed,settled}` → `revision` 最大 → `created_at`，**全无则 undefined 并报判不出，⛔ 不回落 `at(-1)`**），`closureProblems` 与 `pipelineViewOf` 同调 ③`blockedBy` 去重 ④`taskGraphOf` 只认当前方案 |
| **④依赖** | B2.1 |
| **⑤验证 + 负向对拍** | 验证者=实现者 + 缺 criteria_refs ⇒ `chainCompleted === false`；两种物理顺序 ⇒ G6 结论相同且都含 C-27。负向对拍：改回弱判定 / 改回 `at(-1)` 并对调位置 ⇒ 断言红 |
| **⑥回退** | commit-4 可单独删（回到「有缺口但不算数」） |
| **⑦改动面** | 大（3 文件，~200 行） |
| **详规** | `01-judgment.md` §4/§9 #5/#7/#8、REVIEW R-13 |

### B3.1 · 面板停刷 + 取数可观测

| 要素 | 内容 |
|---|---|
| **①位置** | `project-panel.tsx:1407-1445`（`pulling` 闸）、`:3100`（徽标）、`:3011`/`:956-967`/`:1390-1398` |
| **②改什么** | 6 个取数函数**全无超时**，任一挂起 ⇒ `pulling` 永真 ⇒ 面板定格，而徽标仍说「实时更新已连接」 |
| **③具体改法** | 超时 30s（D-A 待拍板）+ 独立 watch-dog（超时+5s）+ 单调 `pullSeq`（晚到者 return）+ 复位后 `setTimeout(0)` 补拉 + `followUpsLeft` 归还；徽标新增 `data-state='degraded'`/`data-stalled`，文案**机检断言不含「已连接」**。并入 `O-18`（`fetchCurrent` 提 `useCallback`，否则降级徽标被反复点亮）、`O-36`/`R-26`（工作路由常量改 import + 补 404/405 分支）、`O-23`（删死字段） |
| **④依赖** | 可与阶段 1/2 并行 |
| **⑤验证 + 负向对拍** | 挂起一路 fetch ⇒ `data-state='degraded'` 且文案含「停止刷新」。负向对拍：①`FETCH_TIMEOUT_MS=Infinity` ⇒ 面板定格、徽标停 connecting；②徽标改回只看 `liveState` ⇒ 仍宣称已连接 |
| **⑥回退** | 单独 revert（纯客户端） |
| **⑦改动面** | 中（1 文件，~150 行） |
| **详规** | `03-client.md` §2/§7.2/§7.3/§7.5 |

### B3.2 · 健康读数读 count/truncated

| 要素 | 内容 |
|---|---|
| **①位置** | `project-panel.tsx:2249-2257` |
| **②改什么** | 只数 `problems.length`，不读服务端给的 `count`/`truncated` ⇒ 41~300 条显示「40 条」，体积兜底时显示「0 条缺口」且 `data-state='ok'` |
| **③具体改法** | N = 全量 `count − min(shown,12)`（⛔ 不是 `problems.length−12`）；`problems` 被体积兜底丢空时写「未随本次返回（响应超体积上限）」并带 `data-kind='not-delivered'`；`data-state` 改用 `health.ok` |
| **④依赖** | 与 B3.1 同批更省 |
| **⑤验证 + 负向对拍** | 41 条 ⇒ 「41 条缺口 / 另有 29 条」；300 条无 problems ⇒ 「300 条缺口 / 未随本次返回」+ `data-state='unhealthy'`。负向对拍：头部改回 `problems.length` ⇒ 变 40；`data-state` 改回按 problems 判 ⇒ 变 ok |
| **⑥回退** | 单独 revert |
| **⑦改动面** | 小（1 文件，~30 行） |
| **详规** | `03-client.md` §3 |

### B3.3 · 切账本清详情缓存

| 要素 | 内容 |
|---|---|
| **①位置** | `project-panel.tsx:1150-1169` / `:2217-2221` |
| **②改什么** | `itemDetails` 的键是裸 ID（`R-001` 每本账都有）⇒ 切账本后显示上一本账的正文且永不自愈 |
| **③具体改法** | 方案 A（推荐）：切账本时 `setItemDetails({})` 一行 reset；方案 B：键带账本前缀（但 5 处拼接漏一处就静默变「每次请求」） |
| **④依赖** | 无 |
| **⑤验证 + 负向对拍** | 切账本后展开同名 ID ⇒ 显示新账本正文。负向对拍：删 reset ⇒ 仍显示旧正文 |
| **⑥回退** | 一行 revert |
| **⑦改动面** | 小（1 文件，1-5 行） |
| **详规** | `03-client.md` §6 |

### B3.4 · legacy 第 5 步单一集合

| 要素 | 内容 |
|---|---|
| **①位置** | `requirement-chain.ts:349/367-368/380-381` + `project-panel.tsx`（`STAGE_KIND_BY_STEP`） |
| **②改什么** | legacy 第 5 步的状态源取 `accs`、条目源取 `verifications` ⇒ 同屏「已完成 / 0/0 / 这一步还没有条目」 |
| **③具体改法** | **服务端三处**（条目源 :349、done :367-368、doing :380-381）统一改取 `accs`；**客户端** `STAGE_KIND_BY_STEP` 拆成 V3 / LEGACY 两张表 + `kindOfStep(step, legacy)`。⚠ 只改一处会产生**新的静默矛盾** |
| **④依赖** | 两端同批 |
| **⑤验证 + 负向对拍** | legacy 链第 5 步的状态源与条目源**必须是同一个集合**（V-R08-a 服务端 + V-R08-b 客户端）。负向对拍：只改服务端 ⇒ ACC 印「技术验证通过」；只改客户端 ⇒ `waived` 印「判不出」 |
| **⑥回退** | 两端必须一起 revert |
| **⑦改动面** | 中（2 文件，~60 行） |
| **详规** | `03-client.md` §4 |

### B3.5 · G3–G6 阻断原因进面板

| 要素 | 内容 |
|---|---|
| **①位置** | `requirement-chain.ts:519-540`、`project-panel.tsx:95-113` |
| **②改什么** | 面板对 G3–G6 印「卡在哪：没有主阻断」，而派活照样放行（因为 G3 根本不拒派活） |
| **③具体改法** | `requirement-chain` 在 G3–G6 也把 `pipeline.blockedBy` 注入 `next`；面板渲染 `data-blocker-count`。**必须先做 O-32 去重**，否则 N 虚高 |
| **④依赖** | B2.3（含 O-32） |
| **⑤验证 + 负向对拍** | 有环任务图 ⇒ `data-blocker-count > 0` 且「卡在哪」含该环。负向对拍：删 G3–G6 分支 ⇒ `blockedBy` 空 |
| **⑥回退** | 单独 revert |
| **⑦改动面** | 小（2 文件，~40 行） |
| **详规** | `03-client.md` §5 |

### B4.1 · 负控下限抬到 ≥1

| 要素 | 内容 |
|---|---|
| **①位置** | `scripts/meta-negative-floor.json:4-53`、`check-meta-negctl.mjs:142` |
| **②改什么** | 10 个族的负控下限 = 0 ⇒ 判据 `0 < 0` 恒假 ⇒ **零负控也永远绿** |
| **③具体改法** | 分三类处理（⛔ 不许混在一起抬）：①有断言下界却零负控的族 ⇒ 先补对拍再抬 ②本就无断言的族 ⇒ 标豁免并在输出里点名 ③其余 ⇒ 抬到 ≥1 |
| **④依赖** | **必须在 B0.3 之后** |
| **⑤验证 + 负向对拍** | `check:meta-negctl` 全绿且 2 个豁免族被点名。负向对拍：把某族下限改回 0 并删掉其负控 ⇒ 必须红 |
| **⑥回退** | 配置文件改动，revert 即恢复 |
| **⑦改动面** | 小（2 文件，~20 行） |
| **详规** | `04-selfcheck.md` §2 |

### B4.2 · 恒假面 + 族数口径

| 要素 | 内容 |
|---|---|
| **①位置** | `check-hob-create-ui.mjs:699`、`check-all.mjs:152/1162`、`meta-negative-floor.json` |
| **②改什么** | ① CU-5 正则指向已改名常量 `PLANNING_PRESET_ID`（现为 `HOB_PRESET_ID`）⇒ **判据不可能再变红** ② `FAMILY_FLOOR` 的分母不是族总数 ③ 聚合入口自述「不写任何文件」实际写仓库根与 `src/` |
| **③具体改法** | ①正则改 `(?:currentPreset|preset)\s*[!=]==?\s*(?:PLANNING_PRESET_ID|HOB_PRESET_ID)` 且**先自证靶子存在** ②`FAMILY_FLOOR` 按实测 `results.length` 设零余量 ③`__negctl_*` 改写到系统临时目录 + `.gitignore` 补条目 |
| **④依赖** | 无 |
| **⑤验证 + 负向对拍** | `npm run check:all` 全绿且族数与 `FAMILY_FLOOR` 一致。负向对拍：把 `HOB_PRESET_ID` 改回 `PLANNING_PRESET_ID` 之外的名字 ⇒ 断言必须红（这正是 S-08 的教训） |
| **⑥回退** | 单独 revert |
| **⑦改动面** | 中（4 文件，~80 行） |
| **详规** | `04-selfcheck.md` §5/附录 A |

### B4.3 · 词表收敛（步名 + 提示词）

| 要素 | 内容 |
|---|---|
| **①位置** | `stage-controls.ts:16-27`、`pipeline-view.ts:33-41`、`preset/dsh-hob/**` |
| **②改什么** | ① 阶段步名 8 份字面量且已漂（`stage-controls.ts:22` 写 `'编码任务'`，其余六份写 `'任务图'`）② 运行时教模型「五步」、面板是「七步」 |
| **③具体改法** | ①留 `stage-controls.ts` 一份权威，其余 7 处改 import/派生（`PIPELINE_STAGES` 从 `as const` 降级为 `.map()`，D-C 待拍板）②改 `preset-dsh-hob.patch.yml:434` 的 `the five steps` → `the Pipeline v3 stages`，清单换 7 项，重跑 `gen:preset-contract` + `sync:preset-draft` |
| **④依赖** | 同批（同一件事两面） |
| **⑤验证 + 负向对拍** | `npm run typecheck` exit 0；`grep -c '验收核对' preset/*.yml` = 0；`check:workflow` F15 ✓。负向对拍：只改词表不改提示词 ⇒ F15 必须红 |
| **⑥回退** | 词表与提示词必须一起 revert |
| **⑦改动面** | 中（8+ 文件，~100 行） |
| **详规** | `04-selfcheck.md` §3/§4 |

### B4.4 · README 与文档契约

| 要素 | 内容 |
|---|---|
| **①位置** | `README.md:132/162/166/188/213`、`TERMINOLOGY.md:67`、`kit/drafts/**` |
| **②改什么** | ① `ledgerHome` 缺省规则与代码相反且引用已删除常量 ② 「跨实例投递」整段描述已删除的模块 ③ `check:build`「三个面」实为五个面、行号全错 ④ 「不写 `~/.dsh/**`（有显式拒绝路径）」——**该机制在代码里不存在** ⑤ 残留清单「6 类」表只有 5 行 |
| **③具体改法** | 逐条改文案；删掉「有显式拒绝路径」这句（或改成「写面守卫按相对路径白名单判定，不感知 `~/.dsh`」） |
| **④依赖** | 无 |
| **⑤验证 + 负向对拍** | `git diff --stat README.md` 只有文案；`grep -c '启动器路径' README.md` = 0。负向对拍：文档类无对拍，改为「改完跑 `check:doc-shape` 必须绿」 |
| **⑥回退** | 纯文档，revert 即恢复 |
| **⑦改动面** | 小（3 文件，~30 行） |
| **详规** | `04-selfcheck.md` §6 |

---

## §5 跨域冲突裁定

四份规格来自四个域，有 **6 组实质冲突**。逐条裁定，写明采信哪一方与理由。

| # | 冲突 | 甲方主张 | 乙方主张 | 裁定 | 理由 |
|---|---|---|---|---|---|
| 1 | **T-05 归哪批** | `01-judgment.md` §9 #13：`ledgerHealthOf` + `repairOf` 与 B0.1 同批 | `02-ledger.md` §6.2 批次 C：T-02 + T-05 同批 | **采信 02** | `repairOf` 的命中判据必须来自统一后的 `ledgerHealthOf`。若在 B0.1 只改 `repairOf` 而四出口仍分裂 ⇒ 死锁换个方向继续存在（这正是 T-05 的原病）。**`ledgerHealthOf` 的「新增」可以留在 B0.1，但 `repairOf` 换判据必须在 B1.3** |
| 2 | **O-32 归哪批** | `01` #8：随 R-01 同批 | `03` §8 批次 D：随 T-08 同批 | **采信 01**（放 B2.3） | O-32 是 `pipeline-view.ts` 的**服务端去重**，T-08 是**客户端渲染**。放 B2.3 天然满足 03 的「必须先于 T-08」。若放 B3.5 则与 T-08 同批，会同时引入去重与渲染两处改动，难判断谁生效 |
| 3 | **T-01 的修补位置** | 主控派单描述：`merged` 第三项排除旧内容（= `drop-item3`） | `02-ledger.md` §1.3：不读第一项（= `drop-item1`） | **采信 02** | 实测三变体：`drop-item3` 只修 append、overwrite 仍报重复；`drop-item1` 两格都清。**不变量是「每个物理文件最多被读一次」**，不是补丁位置 |
| 4 | **R-13 的修法** | REVIEW 原稿：`closureProblems` 复用 `currentPlanOf` | `REVIEW` 修订版（经主控第三轮复核）：抽 `currentPlanOfStrict` | **采信修订版** | `currentPlanOf` 本身有三个洞：`created_at` 自填、`active` 判「不是 superseded」、全 superseded 时回落 `at(-1)`。复用它等于把三个洞换个位置 |
| 5 | **C1 的失败成因** | 主控 §17：answerer 缺席 ⇒ `unavailable` | synthesizer：默认档 `approval: never` ⇒ `rejected` | **采信后者** | 实测：`dsh-client-ui-approval` 存在于宿主 bundle 且已 compose 进 web profile；`decide()` 在 waterfall 之前就有 `if policy==='never' return 'rejected'` |
| 6 | **S-16 的字符串字面量期望值** | REVIEW 初稿：五用例 1/0/0/0/0（字符串算 1） | `04-selfcheck.md` §9 D-A：期望 0 | **采信 04**（D-A 待用户确认） | 期望 1 等于「把标签塞进任意字符串字面量仍能凑数」—— **同一个漏洞换个壳** |

---

## §6 迁移与兼容策略

这一节回答「改完之后，**存量数据怎么办**」。四条迁移彼此独立，但共用同一条原则：

> **宽限判据必须来自被判定对象之外。** 任何「靠单元自己声明」的宽限（`created_at` / `clarify_legacy` / `status`）
> 都会把刚删掉的自证结构换个名字请回来。

### 6.1 R-01 改强判据：三段式上线

| 段 | 时长 | 行为 | 退出条件 |
|---|---|---|---|
| **影子模式** | ≥1 周 | 强判据照算，但**只写进 `blockedBy` 与状态行**，不参与 `activeStage` / `chainCompleted` | 连续 7 天无「同一账本两次运行结论不同」 |
| **宽限期** | 至存量清零 | 参与判定，但 `provenanceOf(unit) === 'legacy-migrated'` 的 VER/ACC **免于强判据**（它们是在规则之前产生的） | `basis==='unknown'` 的单元数降到 0 |
| **全量** | — | 无豁免 | 删掉宽限分支，同时删掉它的机检豁免 |

⚠ **宽限判据是 provenance，不是 `created_at`**（见 B0.1）。若 B0.1 没做就上 R-01，等于把自证结构复活。

⚠ **影响面未验证**：真实账本的 G4/G5 违规数没有 survey 过。`01-judgment.md` §4.3.1 明确标了这一点——**不要假设影响面小**。

### 6.2 S-02 禁止 v3 用 `pre-control` 之后，存量 177 行怎么办

实测：`clarify_legacy` 的存量 **177 行，全部在 `dsh-hob` 的 `unit-01..06`**，`unit-07` 为 0。
而全仓 `pipeline_version = "v3"` 只有 **1 条**（在 `prompt-enhancer-release`）。

⇒ 结论：**存量豁免与 v3 完全不重叠**。所以 B0.1 的做法是「豁免只对 provenance 为 `legacy-migrated` 的单元生效」，
存量 177 行**行为零变化**，新写的 v3 单元**一律不给豁免**。不需要逐条改存量数据。

### 6.3 T-01 / O-33 修好后，已经写坏的账本怎么诊断与修复

**实测的存量坏账**：`prompt-enhancer-release` 的 **19 条单元全在 `index.toml`**，分片为零。

修好 T-01 后它从「写不进」变成「能追加但历史单元仍挤在 index」，而 `hob_ledger_migrate` 够不到分片（`O-37`）
⇒ **必须同时给搬迁脚本**，否则等于把「全冻结」换成「半冻结」。

**搬迁路线（`02-ledger.md` §1.5，三个坑必须写进脚本断言）**：

| 步骤 | 做什么 | 必须的断言 |
|---|---|---|
| 1 | 落副本（先把整本账复制到临时目录） | 副本能被 `readLedgerUnits` 读出与原件相同的单元数 |
| 2 | **纯 fs 搬迁**（不调 `writeHobFile`） | ⚠ **必须「移」不能「复制」**——否则两套读路径各返回两份，而 readiness 报 `ready/0`（因为 `ledger-readiness.ts:284` 调 `unitShapeProblems` 没传 `seenIds`） |
| 3 | 修坏词（`R-003 status=proposed` / `CHG-346 status=draft`） | 搬迁后 `unitShapeProblems` 零命中 |
| 4 | 验（`ledgerReadinessOfRoot` + `/stages`） | 两处结论一致且 `gaps: 0` |

⚠ **不要调低常驻 `shrinkGuard`**：搬迁走纯 fs，不是 `overwrite`，所以不触发缩水守卫。若为了搬迁临时调低守卫，
事后忘了恢复，就变成「以后每次覆盖都能缩水」。

### 6.4 兼容性：三处「改完必须重启/重跑」

| 改动 | 为什么 | 何时做 |
|---|---|---|
| `preset-dsh-hob.patch.yml`（B4.3） | 预设半边改完要重装：`npm run build` → `dsh plugin install` | 合并后**立即**，否则模型侧话术照旧 |
| `gen/persona.md` / `gen/contracts.md`（B4.3） | 生成物，必须重跑 `gen:preset-contract` + `sync:preset-draft` | 与词表改动同一次提交 |
| `lib/`（所有源码改动） | `lib/` 是编译产物且不入版本库 | 每次合并后 `npm run build` |

---

## §7 待拍板清单（12 条）

> 格式：**问题 | 选项 | 推荐 + 一句话理由**。按「不拍板就不能动工」的程度排序。

| # | 编号 | 问题 | 选项 | 推荐 | 理由 |
|---|---|---|---|---|---|
| 1 | **D-1**（REVIEW §7.1） | 用户批准是否允许由 Hob 转录 | **A** 白名单收窄 / **B** 门禁核 source / **C** 用户本人触发通路 | **C**（但需先验前置） | **仅 C 能实质修复 I-4**；A/B 只是把可绕过点收窄，不改变「被校验方即写入方」。⚠ **当前默认档 `approval: never` ⇒ C1 必然 `rejected`，所以实际主路径是 A + C2** |
| 2 | **D-SPEC-3** | C 选项若宿主不给 answerer/policy，接受降级为 A 吗 | A 接受降级 + README 登记 / B 不落 C | **A** | 有 A 的收窄 + 如实标注，比「假装修好了」好。⚠ **无论选哪个，都不得把 S-01 标成已根治** |
| 3 | **D-SPEC-4** | R-01 三段式宽限是否接受「影子模式 ≥1 周」 | A 接受 / B 直接全量 | **A** | 直接全量会让真实项目的「已完成」翻成「未完成」，而历史 VER/ACC 证据**补不回来** |
| 4 | **D-SPEC-5** | R-05 覆盖缺口是否宽限到「任务图首次被批准」 | A 不宽限 / **B** 只对 v3 新任务严格、存量仅提示 | **B** | 存量任务图**可能已经执行过**（任务已 `built`），硬拦没有修复路径。判据须与 D-SPEC-4 **同源**（都用 provenance） |
| 5 | **D-SPEC-2** | `revision` 是否严格等于内容身份 | **A** 严格（内容变必升版）/ B 允许草稿期原地改 | **A** | 否则「第 N 版」在批准前不唯一，事后无法证明某条 decision 批准的是哪份内容。代价（草稿期频繁升版）由工具层自动递增抵消 |
| 6 | **D-SPEC-1** | `hob_pipeline_approve` 的 `dryRun` 要不要过 `proceedGate` | A 拦 / B 放行 / **C** 放行但返回值不给 `decisionId`（改 `proposedId` 并明写「未落盘」） | **C** | 演练返回的 `decisionId` 会被误读成「已落账」；改返回值比加闸门更省且语义更准 |
| 7 | **D-T02-1** | `readiness` 的 `ready` 是否要求「已获用户批准」 | A 含审批 / B 不含 / **C** 拆两个字段 `structurallyReady` + `canProceed` | **C** | `ready` 现在同时承担「结构可用」与「可推进」两个含义，这正是 T-02 的病根 |
| 8 | **D-O34-1** | 全部方案都被取代时任务图该为空还是沿用最后一条 | **A** 与 `currentTasksOf` 完全同源 / B 严格排除 superseded / C 改 `currentPlanOf` | **A** | O-34 要治的是「有当前方案却看旧方案」；「全 superseded」是另一情形，一并改严会顺带改第 2/3 步状态机 |
| 9 | **D-CLI-A**（03） | 面板取数超时值 | A 30s / B 15s / C 60s | **A（30s）** | 与 `create-hob-dialog.tsx:373` 同值；相对 `LIVE_SAFETY_POLL_MS=60s` 留余量；远大于真实快照耗时。⚠ **没有真机量过最慢响应** |
| 10 | **D-CLI-B**（03） | T-16 用哪个方案 | **A** 切账本 1 行 reset / B 键带账本前缀 | **A** | B 有 5 处拼接，漏一处就静默变「每次请求」；A 一行的失效方式是「没生效」，B 的失效方式是「每请求都重取」——后者更贵且更难发现 |
| 11 | **D-SC-A**（04） | S-16 的字符串字面量期望值 | **A** 0 / B 1 | **A** | B 等于「把标签塞进任意字符串仍能凑数」——同一漏洞换个壳 |
| 12 | **D-SC-B / D-SC-C**（04） | E-1 落地方式 / `PIPELINE_STAGES` 类型降级 | A 报告模式+白名单 / B 只扫 diff；A 接受降级 / B 保元组 | **A / A** | E-1 用 B 抓不到存量里已经坏了的（CU-5 就是）；元组类型在本仓**没有消费方**，typecheck 会兜住意外破损 |

---

## §8 验收总表（112 条，一条不漏）

**用法**：每条改完把状态从 `待做` 改成 `已做`，并填上验证证据。负向对拍见 §4 对应施工卡。

**分档说明**：`已出规格` = §4 有施工卡；`未出规格` = 见 §9，本方案不含改法。

| 编号 | 等级 | 批次 | 标题 | 状态 |
|---|---|---|---|---|
| S-02 | blocker | B0.1 | `clarify_legacy` + `created_at` 两个自填字段可跳过 11 类门禁 | ⬜ 待做 |
| O-33 | high | B0.2 | 写前结构校验把「读不出来的既有分片」当空集 ⇒ 账本已坏时守卫变静音（V-01） | ⬜ 待做 |
| O-37 | medium | B0.2 | `hob_ledger_migrate` 只重写 index.toml，而现行账本的单元全在分片里 | ⬜ 待做 |
| O-43 | low | B0.2 | 真实账本的 `status` 已经越过封闭集 ⇒ 写前校验会把整本账判死（V-12） | ⬜ 待做 |
| T-01 | blocker | B0.2 | `index.toml` 被守卫重复计入 ⇒ 第二条单元永远写不进，且错误原因说谎 | ⬜ 待做 |
| S-16 | high | B0.3 | 元规则 M-1 把被注释掉的负控照样算成一条（比 S-06 更根本） | ⬜ 待做 |
| R-12 | high | B1.1 | 首次批准前改内容不递增 revision 不被拦 | ⬜ 待做 |
| S-01 | blocker | B1.1 | 「用户批准」是自证链：被校验方即写入方 | ⬜ 待做 |
| T-06 | high | B1.1 | 4 处 `validateLedgerStructure:false`，其中 3 处不必要 | ⬜ 待做 |
| T-13 | high | B1.1 | 批准工具不过 `proceedGate`：隔离/归档会话仍能写「用户批准」 | ⬜ 待做 |
| O-09 | low | B1.2 | `readProjectionUnits` 同步读全部且失败直接抛，无三态 | ⬜ 待做 |
| R-06 | high | B1.2 | 两份 TOML 解析器：严格的做门禁、宽松的做读取 | ⬜ 待做 |
| O-05 | low | B1.3 | `indexIntegrityProblems` 只在 `activation==='active' | ⬜ 待做 |
| T-02 | high | B1.3 | 同一本账有 4 套「账本健康」判据，实测四种结论 | ⬜ 待做 |
| T-05 | blocker | B1.3 | 修复写的命中判据与真正拦它的判据不是同一套 ⇒ 无法自愈的死锁 | ⬜ 待做 |
| O-07 | low | B1.4 | `removeUnitBlock` 的空行压缩会改写未涉及单元的布局 | ⬜ 待做 |
| R-18 | high | B1.4 | `removeUnitBlock` 把非 id 字段留成孤儿块，返回 `ok:true` | ⬜ 待做 |
| T-07 | high | B1.4 | 投影半完成无回滚，且幂等键让重试不会补迁移 | ⬜ 待做 |
| R-05 | blocker | B2.1 | G3（依赖环/悬空/覆盖缺口）不进任何派活闸门 | ⬜ 待做 |
| R-10 | high | B2.1 | 覆盖校验读 `criteria_refs`，而契约字段是 `acceptance_criteria_refs` | ⬜ 待做 |
| R-28 | high | B2.2 | 多轨首次派发时任务链门禁不跑 | ⬜ 待做 |
| O-32 | medium | B2.3 | `blockedBy` 里同一条 VER 的问题被 push 两次（`:326` 全量循环 + `: | ⬜ 待做 |
| O-34 | high | B2.3 | G3 用「该需求下全部 change（含 superseded）」的任务判定「当前计划」的图 ⇒ 第 | ⬜ 待做 |
| R-01 | blocker | B2.3 | G4/G5「阶段完成」用弱判定，强判据只进 blockedBy 不参与计算 | ⬜ 待做 |
| R-13 | high | B2.3 | G6 收口档位取「物理顺序最后一个方案」，结论随数组顺序翻转（安全方向 fail-open） | ⬜ 待做 |
| O-18 | medium | B3.1 | `Current` 面板在运行态下**每秒**重取一次 `/ledger-resource` | ⬜ 待做 |
| O-23 | low | B3.1 | 多处「存了不读」的死字段，一处导致完成数被算两遍 | ⬜ 待做 |
| O-36 | low | B3.1 | 工作计划路由也没有 `StaleRouteError` 分支（V-10，T-17 的第二处） | ⬜ 待做 |
| R-26 | low | B3.1 | 同一条路由字符串写两份（`work-plans`） | ⬜ 待做 |
| T-04 | blocker | B3.1 | 一次挂起的 HTTP 让面板永久停刷，徽标仍说在刷新 | ⬜ 待做 |
| T-17 | low | B3.1 | 资源路由把 404/405 吞成业务失败 | ⬜ 待做 |
| T-09 | high | B3.2 | 账本健康假报 0 条 / 少报 N 条：`count` 与 `truncated` 一个都不读 | ⬜ 待做 |
| T-16 | high | B3.3 | 切换账本不清展开详情缓存 ⇒ 显示上一本账的正文 | ⬜ 待做 |
| R-08 | high | B3.4 | legacy 第 5 步状态源与条目源是两个集合（联动修复项） | ⬜ 待做 |
| T-08 | high | B3.5 | 面板对 G3–G6 印「卡在哪：没有主阻断」，而派活照样放行 | ⬜ 待做 |
| S-06 | blocker | B4.1 | 元规则 M-1 的 10 个族负控下限 = 0 ⇒ 零负控也永远绿 | ⬜ 待做 |
| S-08 | high | B4.2 | CU-5 断言正则指向已改名常量 ⇒ 恒假面 | ⬜ 待做 |
| S-10 | medium | B4.2 | `FAMILY_FLOOR` 的分母不是族总数，余量无法由族总数推出；与「零余量」纪律存在张力 | ⬜ 待做 |
| S-11 | medium | B4.2 | `ASSERTION_FLOORS` 的「同族名只许出现一次」纪律无机检 | ⬜ 待做 |
| S-13 | medium | B4.2 | 聚合入口自述「不写任何文件」，实际写仓库根与 `src/` | ⬜ 待做 |
| T-21 | medium | B4.2 | `check-all` 对 `exit 3` 的族数与行号两处自相矛盾且全错 | ⬜ 待做 |
| O-40 | medium | B4.3 | 档位枚举有**第三份**字面量（`bus.ts` 的入参 `enum`），且无断言比对（V-07） | ⬜ 待做 |
| R-03 | blocker | B4.3 | 阶段步名 8 份字面量且已漂 | ⬜ 待做 |
| R-04 | blocker | B4.3 | 运行时教模型「五步」、面板与文档是「七步」 | ⬜ 待做 |
| T-22 | medium | B4.3 | 运行时提示词写「第 4 步 `actor_role` = `acceptor`」，实为 `verifier` | ⬜ 待做 |
| R-27 | high | B4.4 | README 的 `ledgerHome` 缺省规则与代码相反，且引用已删除常量 | ⬜ 待做 |
| R-29 | high | B4.4 | README 称「不写 `~/.dsh/`（有显式拒绝路径）」，该机制在代码里不存在 | ⬜ 待做 |
| T-18 | high | B4.4 | README「跨实例投递当前不可用」整段描述已删除的模块 | ⬜ 待做 |
| T-19 | high | B4.4 | README 的 `check:build`「三个面」实为五个面，行号全错 | ⬜ 待做 |
| T-20 | medium | B4.4 | README 残留清单「6 类」但表只有 5 行，编号错位 | ⬜ 待做 |
| T-23 | medium | B4.4 | TERMINOLOGY 的 kind 表漏掉 `verification` 与 `closure`，下一节又要求它们 | ⬜ 待做 |
| O-01 | low | B5 | `write-repair` 动作恒 `go` 且不参与任何问题计算 | ⛔ 未出规格 |
| O-02 | low | B5 | `isPipelineV2` 是 `isPipelineV3` 的别名，但调用方文案仍说「v2」 | ⛔ 未出规格 |
| O-03 | low | B5 | `riskGateRequirements.pathComparison` 恒 `true`，档位差 | ⛔ 未出规格 |
| O-04 | low | B5 | 十维风险里 4 个维度不参与任何推导 | ⛔ 未出规格 |
| O-06 | low | B5 | `hob-render` 的 `count` 把目录里的符号链接算进条目数 | ⛔ 未出规格 |
| O-08 | low | B5 | `policy-record-state` 的六值在两条轴上不对称 | ⛔ 未出规格 |
| O-10 | medium | B5 | 推进器的重入守卫会吞掉一次推进请求 | ⛔ 未出规格 |
| O-11 | low | B5 | 首波部分失败即把整份计划置 `failed`，与「仍有 running 轨」并存 | ⛔ 未出规格 |
| O-12 | medium | B5 | `canReadWorkspace` 是「看起来像判据」但零消费方的字段 | ⛔ 未出规格 |
| O-13 | medium | B5 | `runLegacyMigration` 是死函数，且会假报「已迁移」 | ⛔ 未出规格 |
| O-14 | low | B5 | `skeleton.enabled` 已退役，三处注释仍描述它为权威旋钮 | ⛔ 未出规格 |
| O-15 | low | B5 | `ledger` 档仍可跨项目读看板与全部工作区路径 | ⛔ 未出规格 |
| O-16 | low | B5 | 客户端四个配置读写函数零调用方，但机检钉着它们 | ⛔ 未出规格 |
| O-17 | low | B5 | 其余死代码 / 空导出（`allowFor` ×2、`policyFileExists`、`capa | ⛔ 未出规格 |
| O-19 | medium | B5 | 门禁轮询被**三个实例**同时跑，实际频率是注释的 2~3 倍 | ⛔ 未出规格 |
| O-20 | low | B5 | 「想手动补选档位」的入口**只存在于弹窗内** ⇒ 无法充当「打开弹窗」的入口（循环依赖）（V-驳 | ⛔ 未出规格 |
| O-21 | medium | B5 | 面板（3.3k 行、全仓最大的一屏）**完全绕过 i18n** | ⛔ 未出规格 |
| O-22 | medium | B5 | 两条词条已定义却被硬编码中文顶替 | ⛔ 未出规格 |
| O-24 | low | B5 | `t()` 缺键时把**键名本身**当文案返回 | ⛔ 未出规格 |
| O-25 | low | B5 | 门禁用 `globalThis.alert` 做「入口不可用」说明 | ⛔ 未出规格 |
| O-26 | medium | B5 | `check:workflow` 文件头四条描述里**两条与实现不符** | ⛔ 未出规格 |
| O-27 | medium | B5 | `check:stages-route` 的 R-2 自称「五步」实比 **7 步** | ⛔ 未出规格 |
| O-28 | medium | B5 | TERMINOLOGY 明令「不称记录区」，README 全篇用了 **8 次** | ⛔ 未出规格 |
| O-29 | medium | B5 | `kit/drafts` 两份文档仍指向**不存在**的 `.hob/drafts/preset-c | ⛔ 未出规格 |
| O-30 | low | B5 | `check:hob-unselected-gate` 硬编码本机绝对路径（fail-closed | ⛔ 未出规格 |
| O-31 | low | B5 | `check:profile --fix` 会写盘，聚合入口目前不带但缺一道保险 | ⛔ 未出规格 |
| O-35 | high | B5 | `hob_orch_control` 的 verify / accept / send-back / | ⚠ **未出规格（重点）** |
| O-38 | medium | B5 | 验收条件的身份落在**下标兜底**里 ⇒ 插一条就让 G3 报出不存在的缺口（V-03） | ⛔ 未出规格 |
| O-39 | medium | B5 | 多轨轨道的 `sessionId` 与 `joinOwnerSessionId` 都不校验「该会话存 | ⛔ 未出规格 |
| O-41 | medium | B5 | 面板的预设门禁用「**属性在不在**」判定 ⇒ 宿主不注入该 prop 时门禁整体失效（V-09；主 | ⛔ 未出规格 |
| O-42 | medium | B5 | 存量账本里有一整族「**读不见的单元文件**」，而文档把两种形态说成一种（V-11） | ⛔ 未出规格 |
| R-02 | blocker | B5 | 「链完成了吗」有 5 份实现（4 份服务端 + 1 处客户端同屏并置） | ⚠ **未出规格（重点）** |
| R-07 | medium | B5 | 三条读盘实现，失败语义各不相同 | ⛔ 未出规格 |
| R-09 | medium | B5 | 「六阶段」与「第 7 步」：门在用户可见面上被说成了步 | ⛔ 未出规格 |
| R-11 | medium | B5 | 账本根派生：运行时 fail-closed，体检脚本仍走已删除的兄弟目录档 | ⛔ 未出规格 |
| R-14 | medium | B5 | nextAction 与 activeStage 是两个独立算法，链内用三段补丁硬对齐 | ⛔ 未出规格 |
| R-15 | medium | B5 | 回执校验正则有两份，纯函数那份是死代码且更严 | ⛔ 未出规格 |
| R-16 | low | B5 | 阶段状态标签表与三份状态封闭集靠人眼维持 | ⛔ 未出规格 |
| R-17 | low | B5 | `STAGE_COMPLETION` 零调用；`gateProblemsAt` 只喂生成物且用弱判据 | ⛔ 未出规格 |
| R-19 | medium | B5 | 白名单允许 `ledger/units/` 任意子路径，写进去的单元所有读面看不见 | ⛔ 未出规格 |
| R-20 | medium | B5 | `ledgers-route` 用行计数冒充单元数 | ⛔ 未出规格 |
| R-21 | low | B5 | `modeSnapshot` 冻结只有「写 + 读」，没有复验，不驱动推进 | ⛔ 未出规格 |
| R-22 | high | B5 | 工具描述说「只有 ledger 开放」，常量已三档全开 | ⚠ **未出规格（重点）** |
| R-23 | low | B5 | 高风险「评审者 ≠ 作者」两份实现：一份用声明值、一份用推导值 | ⛔ 未出规格 |
| R-24 | medium | B5 | `/stages` 的权威字段（next / pipelines / summary）取回即弃 | ⛔ 未出规格 |
| R-25 | low | B5 | 同一 handoff 两套清账判据 | ⛔ 未出规格 |
| S-03 | medium | B5 | 验收「自己验自己」依赖 `built_by`，`built_by` 缺失时静默放行 | ⛔ 未出规格 |
| S-04 | medium | B5 | `evaluateGate` 对不存在的作用域 id 返回 `go` | ⛔ 未出规格 |
| S-05 | low | B5 | C-29 收口绑定引用只查非空，从不解析目标 | ⛔ 未出规格 |
| S-07 | high | B5 | CONSTITUTION 的 `checked_by` 指向不存在的断言，机检只核字样 | ⚠ **未出规格（重点）** |
| S-09 | medium | B5 | 17 处 `as any` 把 `/stages` 线格式的契约漂移藏起来 | ⛔ 未出规格 |
| S-12 | low | B5 | `check:readings` 强制范围只从 R208 起、3 条断言、0 条负控 | ⛔ 未出规格 |
| S-14 | low | B5 | 门禁入口机检从未断言「关着时应该能打开」 | ⛔ 未出规格 |
| S-15 | medium | B5 | 唤醒兜底链是死代码，但判定侧仍认为它活着 | ⛔ 未出规格 |
| T-03 | blocker | B5 | 判不出 `ownerWsRoot` ⇒ 账本投影整段静默跳过，工具仍报 `ok:true` | ⚠ **未出规格（重点）** |
| T-10 | high | B5 | Outbox 补投三重静默 | ⚠ **未出规格（重点）** |
| T-11 | medium | B5 | `writeWorkPlan` 返回值在三处被丢弃 | ⛔ 未出规格 |
| T-12 | low | B5 | 回传正文不含「账本投影未落」的信号 | ⛔ 未出规格 |
| T-14 | high | B5 | 被拦消息超限时「丢最旧」只有一条 `console.warn`，队列在进程内存 | ⚠ **未出规格（重点）** |
| T-15 | medium | B5 | `ensurePolicyDirIgnored` 返回值被六处丢弃（含定义文件自己 3 处），注释与事实相反 | ⛔ 未出规格 |
| T-24 | medium | B5 | `ledger.toml` 无格式校验：写成功、账本随即判 `invalid` | ⛔ 未出规格 |

**合计 112 = blocker 12 · high 27 · medium 40 · low 33**；
其中 **51 条已出规格**（B0.1–B4.4），**61 条未出规格**（B5）。

> ⚠ REVIEW.md §6 的两条**降级观察项**（`C-01` primitives 宿主 seed、`P-06` PERMISSION_SERVICE 缺席即 throw）**不在本表**，
> 它们是「未验证」而不是「待修」——定论需要宿主侧探针，见 §9。

---

## §9 不在本次范围（61 条 + 2 条观察项）

### 9.1 为什么有 61 条没出规格

四份规格是按「P0 止血 + P1 可观测 + 主线单一真源」的优先级出的，**不是全覆盖**。
61 条集中在 `O` 类（medium/low）与少数 `R`/`T` 类，特征是：**改动面小但数量多、彼此独立、不影响主链判定**。

| 类别 | 条数 | 典型 | 为什么排后 |
|---|---|---|---|
| 死代码 / 空导出 | ~8 | `O-12` `O-13` `O-17` | 不影响行为，清理即可，但**每次清理都可能碰掉别人正在用的东西**，需单独过 |
| 文案 / 命名 / i18n | ~10 | `O-21`（面板零 i18n，13k 字符）| 翻译工程量与风险不成比例，**必须单独排期** |
| 文档措辞 | ~6 | `O-28` `O-29` `T-23` | 低风险但清单长，可随 B4.4 的后继 PR 一起 |
| 宿主侧依赖 | ~6 | `T-03` `T-10` `T-14` | 需宿主 API 或运行时探针，**静态不可证** |
| 其它独立缺陷 | ~31 | `R-02` `R-07` `R-11`–`R-17` 等 | 每条都值得修，但需各自立项出规格 |

### 9.2 三条需要**单独立项**的重点（不在 B5 的一堆小事里）

| 编号 | 为什么不能随手带 |
|---|---|
| **R-02**（blocker，5 份完成算法） | 它是整个审查的根因主线本体。B2.3 只统一了服务端 2 份，客户端回落（`project-panel.tsx:71-75`）与 `stages-index` 的 status 计数**仍在**。需单独立项「完成判定的单一真源」 |
| **T-03**（blocker，投影静默跳过） | 修法要求「判不出 `ownerWsRoot` ⇒ 显式失败读数」或「直接拒绝派发」。**这是一次语义决策**（要不要允许无 RUN 的派发），不是纯技术修复 |
| **S-06 之后的 S-07/S-11/S-12**（自检体系装牙） | B4.1/B4.2 只覆盖了下限与恒假面；`CONSTITUTION.checked_by` 指向假落点、`ASSERTION_FLOORS` 无同族唯一性机检、`check:readings` 零负控——这三条需要一次性重排自检体系的度量口径 |

### 9.3 两条降级观察项（未验证，不是待修）

| 编号 | 内容 | 为什么不定论 | 怎么定论 |
|---|---|---|---|
| `C-01` | `@deepseek-ai/dsh-client-ui-primitives` 是否在宿主 seed 里 | `atoms.tsx:5-8` 与 `tsdown.config.ts:13-17` 两条注释**互相矛盾**，无第三方证据。`lib/client.js:28` 的 require 只证明产物里有，不证明运行时解析失败 | 宿主侧探针：在宿主进程里 `require.resolve` 该包 |
| `P-06` | `PERMISSION_SERVICE` 缺席即 `throw` 导致工具面全不注册 | 属运行时时序（需旧版 `config.ts` 缓存在场），静态不可证 | 在宿主进程注入旧版缓存，观察 `apply` 是否抛错 |

---

## §10 这份方案没做到的事（诚实标注）

| # | 没做 | 影响 |
|---|---|---|
| 1 | **没改任何代码** | 所有改法都是规格，未实施、未验证「改完真的绿」 |
| 2 | **没跑 `npm run build` / `check:all`** | `lib/` 与仓库根的改动面都是推理，不是实测 |
| 3 | **没 survey 真实账本的 G4/G5 违规数** | R-01 的迁移影响面**未验证**——不要假设它小 |
| 4 | **没验 `ctx.approval.request()` 真机返回值** | 这条**必须由用户在一次性环境执行**（会弹窗）。静态结论是「默认档 `never` ⇒ `rejected`」 |
| 5 | **61 条未出规格** | 见 §9，不能说「方案已覆盖全部缺陷」 |
| 6 | **61 条里没有一条验证过负向对拍** | 只有出规格的 51 条有负向对拍设计 |

---

## 附录 · 本方案与四份规格的对应

| 批次 | 规格 | 规格章节 |
|---|---|---|
| B0.1 | `01-judgment.md` | §3.2、§9 #9/#10 |
| B0.2 | `02-ledger.md` | §1.3、§1.3.2、A-4 |
| B0.3 | `04-selfcheck.md` | §1 ③ |
| B1.1 | `01-judgment.md` | §2.2、§9 #11/#12 |
| B1.2 | `02-ledger.md` | §2.3、§2.5 |
| B1.3 | `02-ledger.md` + `01` §9 #13 | §3.3、§3.6 |
| B1.4 | `02-ledger.md` | §4.3、A-14 |
| B2.1 | `01-judgment.md` | §5 |
| B2.2 | `01-judgment.md` | §6 |
| B2.3 | `01-judgment.md` + `REVIEW` R-13 | §4、§9 #5/#7/#8 |
| B3.1 | `03-client.md` | §2、§7.2、§7.3、§7.5 |
| B3.2 | `03-client.md` | §3 |
| B3.3 | `03-client.md` | §6 |
| B3.4 | `03-client.md` | §4 |
| B3.5 | `03-client.md` | §5 |
| B4.1 | `04-selfcheck.md` | §2 |
| B4.2 | `04-selfcheck.md` | §5、附录 A |
| B4.3 | `04-selfcheck.md` | §3、§4 |
| B4.4 | `04-selfcheck.md` | §6 |

**文档结束。**