# REVIEW 分卷 2-3

> ⚠ 本文件是 `REVIEW.md` 的分卷（§4 裁定 + §5 缺陷总表按小节再拆）。
> 原文件 210KB 超 64KB 读上限，按 M 判据处置：**整块搬走 + 原位留指针**。

---

### 5.4 形态 ④ 其它独立缺陷（O · 43 条）

> 保留这一组是为了**不把不相干的缺陷硬塞进根因叙事**——那样会让根因失真。它们不属三种形态，但仍是真问题。
> 为控制篇幅，每条给：位置 / 等级 / 一句话 / 怎么证明修好了。证据等级统一为「读码或实测，见域报告对应编号」。

| 编号 | 等级 | 一句话 | 位置 | 怎么证明修好了 |
|---|---|---|---|---|
| **O-01** | low | `write-repair` 动作恒 `go` 且不参与任何问题计算 | `stage-controls.ts:1097-1099` | 在 `GateDecision` 加显式标记（`bypass:'repair'`），让调用方与日志能看出「本次未过门禁」；机检：repair 动作的返回值必须含该标记。**负向对拍**：删掉标记 ⇒ 断言红 |
| **O-02** | low | `isPipelineV2` 是 `isPipelineV3` 的别名，但调用方文案仍说「v2」 | `pipeline.ts:113-116`、`tools.ts:2019-2021,2056`、`src/preset/tools.ts:1059` | 统一文案为 v3；机检：`grep -rn 'v2 需求'` 与 `grep -rn 'Pipeline v2'` 均应为 0（除 `LEGACY_PIPELINE_VERSIONS` 的定义处） |
| **O-03** | low | `riskGateRequirements.pathComparison` 恒 `true`，档位差异藏在三元表达式里 | `risk-policy.ts:697` vs `stage-controls.ts:386-390` | 删掉该字段，或改为按档位返回最小路径数（`minPaths` = 1 或 2）；机检：该字段的返回值必须随档位变化 |
| **O-04** | low | 十维风险里 4 个维度不参与任何推导 | `risk-policy.ts:67-78` vs `:201-235` | 要么给这四维补 floor 规则（`uncertainty=unknown` ⇒ 至少 medium），要么在注释里写明「四维只计分」；机检：十维的每一维必须至少在一条 floor 规则或注释声明里出现 |
| **O-05** | low | `indexIntegrityProblems` 只在 `activation==='active'` 时生效 ⇒ 现行实例永远不核 | `tools.ts:785`、`ledger-lifecycle.ts:203` | 让 A-4 在 `legacyCompatible` 账本上也跑；机检：无 `ledger.toml` 的账本上，A-4 必须执行（可用注入坏 index 验证） |
| **O-06** | low | `hob-render` 的 `count` 把目录里的符号链接算进条目数 | `hob-render.ts:376-385` | 改用 `readdirSync(abs,{withFileTypes:true}).filter(e=>!e.isSymbolicLink())`；机检：目录里放一个软链 ⇒ 计数不变 |
| **O-07** | low | `removeUnitBlock` 的空行压缩会改写未涉及单元的布局 | `projection-writer.ts:149` | 删掉 `replace(/\n{3,}/g,'\n\n')`，只做 `trimEnd()+'\n'`；机检：改写一个单元后，其余单元的字节**逐字节不变** |
| **O-08** | low | `policy-record-state` 的六值在两条轴上不对称 | `policy-record-state.ts:45, 147-158, 168-170` | 拆成两个字段或两个构造器（`okReadState`/`okBlockedState`）；机检：`classifyPolicyRecord` 的返回值域必须 ⊆ `okState` 接受的域 |
| **O-09** | low | `readProjectionUnits` 同步读全部且失败直接抛，无三态 | `projection-writer.ts:100-112` | 复用 `TargetRead` 三态；机检：单个分片坏 ⇒ 返回 `undecidable` 并点名分片，不整体抛 |
| **O-10** | medium | 推进器的重入守卫会吞掉一次推进请求 | `orchestrator.ts:4441, 4453-4456`；调用点 `:7620, 7701` | `advancingWorkPlans` 改存 `{running, dirty}`，`finally` 里再跑一遍；机检：同一次 settle 的两次调用必须都产生推进效果 |
| **O-11** | low | 首波部分失败即把整份计划置 `failed`，与「仍有 running 轨」并存 | `orchestrator.ts:4870-4878` | 首波部分失败不直接置 `failed`，仍按 `trackStates` 派生；机检：3 轨 1 失败 2 在跑 ⇒ 计划 `state` 不得为 `failed` |
| **O-12** | medium | `canReadWorkspace` 是「看起来像判据」但零消费方的字段 | `session-policy.ts:607, 622`；`session-policy-service.ts:288, 1238` | 要么删字段，要么在注释里钉死「仅供显示」并加机检；机检：`SessionPolicyView` 的每个字段必须在判定点被读，或在白名单里登记为「仅显示」 |
| **O-13** | medium | `runLegacyMigration` 是死函数，且会假报「已迁移」 | `session-policy-service.ts:659-692` | 删除，或改成 `throw new Error('not implemented')`；机检：`grep -c 'runLegacyMigration'` 应为 0 或 1（仅定义处带 throw） |
| **O-14** | low | `skeleton.enabled` 已退役，三处注释仍描述它为权威旋钮 | `tools.ts:108-126, 1079-1118, 2433-2464`、`config.ts:450` | 删两段 skeleton 注释；机检：`grep -c 'skeletonEnabled'` 与 `grep -c 'scaffoldSkeleton'` 均应为 0 |
| **O-15** | low | `ledger` 档仍可跨项目读看板与全部工作区路径 | `src/preset/tools.ts:1036-1171`、`tools.ts:435-552`、`bus.ts:1217-1262` | 见 §7.4 的 D-2；机检：`ledger` 档的可见工具集必须与 README 的档位描述逐名相等 |
| **O-16** | low | 客户端四个配置读写函数零调用方，但机检钉着它们 | `client/settings.ts:327, 363, 405, 440` | `check:config` 的 G-7/G-8 目标从「函数存在」改成「schema 字段存在」，然后删四个函数 |
| **O-17** | low | 其余死代码 / 空导出（`allowFor` ×2、`policyFileExists`、`capabilityRedLine`） | `src/preset/tools.ts:1613,1729`；`server/session-policy.ts:1276-1279`；`capability-red-line.ts:40-44` | 删除；机检：新增一条「导出但零引用的符号」扫描（可先用白名单） |
| **O-18** | medium | `Current` 面板在运行态下**每秒**重取一次 `/ledger-resource` | `project-panel.tsx:3011`（内联 `fetchCurrent`）、`:1124-1129`（1s 时钟）、`current-panel.tsx:97-110` | 用 `React.useCallback` 或让 effect 依赖 `refreshTick`；机检：运行态下 10 秒内 `/ledger-resource` 请求数必须 ≤ 2。**负向对拍**：改回内联 ⇒ 断言红（这是本仓 `settings-panel.tsx:59-62` 自己记录的反模式） |
| **O-19** | medium | 门禁轮询被**三个实例**同时跑，实际频率是注释的 2~3 倍 | `hob-unselected-gate.tsx:771-822`（三个槽）、`:628-674`（各自 `setInterval`） | 轮询收进一个实例，或在 `installHobUnselectedGate` 里共享一个轮询器；机检：`recorded==='unrecorded'` 时每分钟 POST 数 ≤ 15 |
| **O-20** | low | 「想手动补选档位」的入口**只存在于弹窗内** ⇒ 无法充当「打开弹窗」的入口（循环依赖）（V-驳 D-2B） | `create-hob-dialog.tsx:1192`（`if (!isOpen) return null`）vs 注释 `:1183-1191` | **定为设计选择而非缺陷**：`:1185` 自陈「选的是『条件化』而**不是『撤掉』**」。修法二选一：恢复常驻入口，或把注释改成「本入口仅为弹窗打开时的可见锚点，不提供手动打开」；机检见 **S-14** |
| **O-21** | medium | 面板（3.3k 行、全仓最大的一屏）**完全绕过 i18n** | `project-panel.tsx` 全文（12760 CJK / `t()`=0）；`i18n.ts:342-343` 的契约 | 见 §7.4 的 D-3；机检：`grep -c 't(' src/client/project-panel.tsx` 必须与契约声明一致（或契约改成「面板仅中文」） |
| **O-22** | medium | 两条词条已定义却被硬编码中文顶替 | `create-hob-dialog.tsx:1202`（aria-label）、`:1376-1378` vs 词典 `:213, 216, 281, 284` | 改成 `d('entry.aria')`/`d('created.noNav')`；机检：本文件内出现中文字符串字面量即红（对已接 i18n 的四个文件生效）。**负向对拍**：加一条硬编码中文 ⇒ 断言红 |
| **O-23** | low | 多处「存了不读」的死字段，一处导致完成数被算两遍 | `project-panel.tsx:1135, 1013, 1341-1345`；`:2176` 自己数一遍 | 删死 ref/死字段；完成数统一取服务端 `completedCount`；机检：`RequirementChainsOk` 的每个字段必须有读取点 |
| **O-24** | low | `t()` 缺键时把**键名本身**当文案返回 | `i18n.ts:353-357` | 开发构建 `console.warn` 一次并返回键名；或加机检：源码里 `t('x')` 的 x 必须在三层词典并集里。**负向对拍**：用一个不存在的键 ⇒ 断言红 |
| **O-25** | low | 门禁用 `globalThis.alert` 做「入口不可用」说明 | `hob-unselected-gate.tsx:699-708` | 删 alert，改放 `title`/`aria-describedby`（`:694` 已有 `aria-label`）；机检：`grep -rn 'alert(' src/client` 应为 0 |
| **O-26** | medium | `check:workflow` 文件头四条描述里**两条与实现不符** | `check-workflow.mjs:6`（说「五步齐」）、`:13-14`（F4 旧口径）vs `:148`（要 7 步）、`:508-565`（F4 三条 origin 判定） | 头注释同步成 7 步 + F4 三条 origin 口径；机检：脚本头注释里的数字必须与实现常量一致（可做一条「注释数字 vs 常量」的扫描） |
| **O-27** | medium | `check:stages-route` 的 R-2 自称「五步」实比 **7 步** | `check-stages-route.mjs:3,7,191,199` vs `:197`（`want` 有 7 项） | 全文「五步」→「七步」（**注意**：`check-tasks-progress.mjs` 守的确实是五步旧接口，不要一起改） |
| **O-28** | medium | TERMINOLOGY 明令「不称记录区」，README 全篇用了 **8 次** | `TERMINOLOGY.md:44`；`README.md:132,166,177,182,186,208` | 见 §7.4 的 SD-1；机检：术语表里的禁用词在 README 里出现次数为 0（或登记为别名） |
| **O-29** | medium | `kit/drafts` 两份文档仍指向**不存在**的 `.hob/drafts/preset-contracts.md` | `growth-registry.md:33,57,74`、`contract-verification-notes.md:4,13` | 统一改 `kit/drafts/preset-contracts.md`；`growth-registry.md:33/57` 的字节数（56754/8782）也需重测。机检：文档里出现的仓库内路径必须 `fs.existsSync` |
| **O-30** | low | `check:hob-unselected-gate` 硬编码本机绝对路径（fail-closed 正确，但换机必红） | `check-hob-unselected-gate.mjs:1830, 1835` | 路径从 `DSH_HOME` + `dsh-hob.workspace.json` 派生，取不到再 fail-closed；机检：`grep -rn '/home/lk' scripts/` 应为 0 |
| **O-31** | low | `check:profile --fix` 会写盘，聚合入口目前不带但缺一道保险 | `check-profile-assembly.mjs:71, 732`；`package.json:70` | 加 `if (process.env.CHECK_ALL === '1' && FIX) bad(...)`，或在 `STRICT_FAMILIES` 注释里显式写「⛔ 不许给 check:profile 传 --fix」 |
| **O-33** | high | 写前结构校验把「读不出来的既有分片」当空集 ⇒ 账本已坏时守卫变静音（V-01） | `hob-write.ts:1042-1043`（`readToml` 的 `catch { return [] }`） | `readToml` 的 catch 不能返回 `[]`；应返回 `undefined` 并让调用方 refuse（`ledger-unparseable`），或至少回带「无法解析的分片名」列表。机检：把某分片改成坏行 ⇒ 任意写入必须被拒。**负向对拍**：把 readToml 改回 `catch { return [] }` ⇒ 断言红 |
| **O-34** | high | G3 用「该需求下全部 change（含 superseded）」的任务判定「当前计划」的图 ⇒ 第 3 步假完成（V-02），是 R-02 在服务端内部的自我复制 | `pipeline-view.ts:665-670`（`taskGraphOf` 收集任务）vs `:110-116`（`currentTasksOf` 只认当前计划） | `taskGraphOf` 的 plans 改用 `currentPlanOf(req, units)`（与 `currentTasksOf` 同源）；机检：旧方案有 built 任务、当前方案零任务 ⇒ `graph.nodes.length === 0` 且第 3 步必须 active/draft。**负向对拍**：把 plans 改回「全部 change」⇒ 断言红 |
| **O-35** | high | `hob_orch_control` 的 verify / accept / send-back / close-delivery **直接写账本**却不过 `proceedGate`（V-05）——是 T-13 清单里漏掉的**第 5 个**，且是 S-01 的下游 | `orchestrator.ts:10695`（verify）`:10723`（close-delivery）`:10886`（accept/send-back）；`awk 'NR>=10440 && NR<=10980 && /proceedGateOf/'` ⇒ **零命中**；`src/preset/tools.ts:1170` 在 `MODEL_TOOL_ALLOWLIST` ⇒ 三档都有 | 把四个写动作（verify/accept/send-back/close-delivery）纳入 `proceedGate`（stop / resume / redeliver / watch-wait / archive-stale-plan 保持放行），并写进 T-13 清单。机检：隔离会话调 `control{action:'accept'}` ⇒ 必须被拒。**负向对拍**：去掉闸门 ⇒ 断言红 |
| **O-36** | low | 工作计划路由也没有 `StaleRouteError` 分支（V-10，T-17 的第二处） | `project-panel.tsx:956-966`（`defaultFetchPlans` 把 404/405 折成 `route-error`）、`:1390-1398`（`runPlans` 的 catch 无 isStale 分支） | `defaultFetchPlans` 照另 5 个抛 `StaleRouteError`，`runPlans` 补 isStale 分支（与 T-17 同批）。**负向对拍**：mock 404 ⇒ 必须抛 `StaleRouteError` |
| **O-37** | medium | `hob_ledger_migrate` 只重写 index.toml，而现行账本的单元全在分片里 ⇒ 在真实存量上是一条**无效的修复通道**（V-04；主控拍板采 A） | `tools.ts:1849-1856`（只读 index.toml）、`:1908-1929`（只 overwrite index.toml）；实测：dsh-hob 账本 index 0 条 / 7 个分片共 292 条 / 分片里 13 处旧词 | **采 A：遍历 `index.toml + unit-*.toml`**（与 `readLedgerUnits` 同一份读盘口径）逐文件 overwrite。机检：把旧词写进 unit-01.toml ⇒ `migrate({dryRun:false})` 必须改到它。**负向对拍**：只读 index.toml ⇒ 断言红 |
| **O-38** | medium | 验收条件的身份落在**下标兜底**里 ⇒ 插一条就让 G3 报出不存在的缺口（V-03） | `pipeline-view.ts:692-698`（`?? `AC-${i+1}``） | id 只认显式前缀；无前缀时用**内容哈希**（`AC-h(内容)`）而不是下标。机检：在数组头部插一条 ⇒ 既有条件的 coverageGaps **必须不变**。**负向对拍**：改回下标 ⇒ 断言红 |
| **O-39** | medium | 多轨轨道的 `sessionId` 与 `joinOwnerSessionId` 都不校验「该会话存在」（V-06；**未跑端到端**） | `orchestrator.ts:4834-4840`、`:4530`；`work-plan.ts:491`、`:517`（均只判非空） | `dispatchPlan` 写盘前核 `joinOwnerSessionId` 与每条 `track.sessionId`（`sessions.get(id)` 取不到 ⇒ 拒绝并点名）。机检：传一个不存在的 joinOwner ⇒ 必须拒绝 |
| **O-40** | medium | 档位枚举有**第三份**字面量（`bus.ts` 的入参 `enum`），且无断言比对（V-07） | `bus.ts:2039`（`enum: [ledger, project, workspace]` 手写）vs `permission-levels.ts:10`（`PERMISSION_LEVELS`）vs `read-level-policy.ts:61` | `bus.ts` 改成 `enum: [...PERMISSION_LEVELS]`；机检：`bus.ts` 里出现的档位集合 === `PERMISSION_LEVELS`。**负向对拍**：给 `PERMISSION_LEVELS` 加一档而不动 `bus.ts` ⇒ 断言红 |
| **O-41** | medium | 面板的预设门禁用「**属性在不在**」判定 ⇒ 宿主不注入该 prop 时门禁整体失效（V-09；主控拍板采 A） | `project-panel.tsx:899-902`（`presetProvided && !isHobPreset`）；`hasOwnProperty` 为 false 时 `blockedByPreset=false` ⇒ 两个取数 effect（`:1001`/`:1186`）与整个渲染全部放行 | **采 A：三态化**（`undefined` / 其他 / Hob），`undefined` 也按 blocked 处理并显示「判不出」。机检：传一个不带 `agentPreset` 键的 props ⇒ 断言**零请求**。**负向对拍**：改回 `hasOwnProperty` 判法 ⇒ 断言红 |
| **O-42** | medium | 存量账本里有一整族「**读不见的单元文件**」，而文档把两种形态说成一种（V-11） | `kit/README.md:7`（`units/ ← 唯一机读状态源 (index.toml + unit-*.toml)`）vs 真实`prompt-enhancer-release` 账本：19 个 `.md` 单元 + 零个 `unit-*.toml` 分片 | 文档写明「历史账本每个单元一个 .md，元数据镜像进 index.toml；现行读取面只认 index.toml + unit-*.toml」；机检：units/ 下存在 `*.md` 且同名单元在 index 里 ⇒ 至少给出「正文与索引可能分叉」的读数 |
| **O-43** | low | 真实账本的 `status` 已经越过封闭集 ⇒ 写前校验会把整本账判死（V-12） | `ledger-validation.ts:14-26`；实测 10 本真实账本：`prompt-enhancer-release` out-of-set=2、`…backup-before-ledger-contract…` out-of-set=5 | 见 **T-06 的条件附加**（已写入）；本行作为独立来源登记。机检：对含旧词的账本追加合法单元 ⇒ 必须能写入（或给出显式「先迁移」指引） |
| **O-32** | medium | `blockedBy` 里同一条 VER 的问题被 push 两次（`:326` 全量循环 + `:341` built 任务循环）⇒ 面板「另有 N 条」的 N 被虚高 | `pipeline-view.ts:322-327` 与 `:340-344` | 对 `blockedBy` 做一次 `Array.from(new Set(...))` 去重（保留首次出现顺序），或把 `:340-344` 的 G4 completeness 循环改为复用 `:325-327` 的结果；机检：造一条「既是某 v 又是某任务最新验证」的 VER ⇒ 断言 `blockedBy` 里该条只出现一次。**负向对拍**：去掉去重 ⇒ 断言红。与 `T-04`/`T-09` 同族（**读数不准**） |

---
