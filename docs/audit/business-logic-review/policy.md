# 会话策略与配置 · 业务逻辑审查（t4 / policy-auditor）

> 审查范围（只读）：`src/session-policy-service.ts`、`src/config.ts`、`src/model-selection.ts`、`src/index.ts`、
> `src/modules/session-policy-route.ts`、`src/modules/settings.ts`；`src/server/session-policy.ts`、
> `policy-block-log.ts`、`model-face.ts`；`src/shared/read-level-policy.ts`、`capability-red-line.ts`、
> `permission-levels.ts`、`policy-record-state.ts`。
> 为追消费方，另只读引用了 `src/preset/tools.ts`、`src/modules/tools.ts`、`src/modules/bus.ts`、
> `src/modules/orchestrator.ts`、`src/server/hob-write.ts`、`src/shared/pipeline.ts`、`src/client/*`、
> `README.md`、`preset/dsh-hob/preset-dsh-hob.patch.yml`。
> 全部结论按「文件:行号 + 代码片段」给证据；给不出的一律标「未验证」。**未修改任何源码/配置/文档。**

---

## ① 本域业务职责

本域定义「一个 Hob 会话被允许看什么、被允许推进到什么程度、以及插件自身的配置面到底有几个真旋钮」。
它把可读档（ledger / project / workspace）与推进方式（auto / single / multi）从**实例级全局值**改成**逐会话策略**，
落盘在 `<账本>/runtime/session-policy.json`，并在四条闸门（装配过滤 / 预执行 / 单调哨兵 / 工具 execute）与发送时
`agent/pre-step` 上强制；同时以 `DEFAULT_DENY` + 声明面裁剪实现「不可写、不可执行、不可组队」红线。
配置面（`config.ts` 的 Schemastery）只负责三件事：模块开关、新建会话默认值、以及两个**历史遗留字段**的兼容面。

---

## ② 主链路：入口 → 状态 → 落盘 → 出口

### 2.1 配置面（schema → 消费方）

| 步骤 | 位置 | 证据 |
|---|---|---|
| schema 声明 | `src/config.ts:169-493` | 四个顶层组：`modules` / `spawn` / `permission` / `workMode`，父对象均**不**标 volatile、子字段各标 |
| 模块开关解 ref | `src/config.ts:570-590` | `moduleSwitches()` 逐字段 `deref()`，兜底 tools=true / bus=true / orch=false / settings=true |
| 开关消费 | `src/index.ts:151`、`:239-245` | `const switches = moduleSwitches(config)` → `if (!entry.enabled(switches)) { skippedBySwitch.push(...); continue }` |
| spawn 默认值解 ref | `src/config.ts:518-531` | `spawnDefaults()` 把「空串 / 缺席 / ref 读不出来」三种归一到空串 |
| spawn 默认值消费 | `src/index.ts:91` → `src/modules/bus.ts:697-699`、`:1410-1486` | `configFor: (c) => ({ spawnDefaults: () => spawnDefaults(c) })`；`spawn()` 每次现读 |
| 旧全局档 | `src/config.ts:654-665` → `src/index.ts:162` | `ctx.provide(PERMISSION_SERVICE, () => permissionLevel(config))`；**取值方为零**（见 P-06） |
| 工作方式 | `src/config.ts:721-732` → `src/index.ts:172`、`:194` | `ctx.provide(WORK_MODE_SERVICE, ...)` 与 `installSessionPolicy(ctx, { workMode: () => workMode(config) })` |
| 模块自检 | `src/modules/settings.ts:144-193`、`:201-237` | `probeSettingsVisibility()` 纯函数 + `apply` 只打日志 |

实测 schema 形状（只读探针，`node --experimental-strip-types` 直读 `src/config.ts`）：

```
modules:    { tools:true, bus:true, orch:true, settings:true }   ← 4 个子字段全 volatile
spawn:      { agentPreset, provider, model, reasoningEffort }    ← 4 个子字段全 volatile
permission: { level }                                            ← 1 个子字段 volatile
workMode:   { mode }                                             ← 1 个子字段 volatile
```

### 2.2 策略读链路（状态）

| 步骤 | 位置 | 证据 |
|---|---|---|
| 唯一解析入口 | `src/server/session-policy.ts:597-862` | `resolveSessionPolicy(o)`；判定顺序 non-hob → no-identity → 坏存储 → 归档 → 隔离 → pending → stored → 新旧会话 |
| 服务层包装 | `src/session-policy-service.ts:991-1191` | `resolveFor(session)`：算 sessionId → 触发迁移 → 读投影判 isHob → 读归档三态 → `resolveSessionPolicy` → 拼 reason |
| isHob 判据 | `src/session-policy-service.ts:349-378` | 只认 `sessionProjections.stateOf(session,'agentPreset')`，**不退回 header**（`:377 return { preset: undefined, source: 'none' }`） |
| 归档三态 | `src/session-policy-service.ts:1044-1060` | 只有「读到有效数组且 id 明确不在」才给 `'not-archived'`；其余一律 `'unknown'` |
| 落点派生 | `src/session-policy-service.ts:399-407` | `policyFileFor` = `resolveLedgerRoot('', declaredLedgerHome(ctx), session.header.cwd)` + `policyStateFileOf` |
| 读盘 | `src/server/session-policy.ts:313-371` | 四档可达性 `ok/absent/unreadable/version-unknown`；记录逐字段白名单收窄 `asRecord`（`:270-303`） |

### 2.3 落盘（写路径）

| 步骤 | 位置 | 证据 |
|---|---|---|
| 原子写 + 回读 | `src/server/session-policy.ts:378-414` | `tmp → rename`，随后 `readFileSync` 与 `expect` **逐字节比**，不符即 `ok:false` |
| 纪元落盘 | `src/server/session-policy.ts:444-476` | `ensurePolicyStoreEpoch`：无合法纪元才写，用 `fallbackEpoch`（安装时刻）；回读确认 |
| 自忽略 | `src/server/session-policy.ts:479-498` | 写 `runtime/.gitignore`（内容 `# dsh-hob …\n*\n`）并逐字节回读 |
| 显式写 | `src/server/session-policy.ts:870-959` | 枚举校验 + 坏文件拒写 + **隔离标记闸门**（`:921-928`）+ 回读比对 + pending 必须真落成 pending |
| 确认生效 | `src/server/session-policy.ts:972-1014` | `pending → active`；回读仍是 pending 即失败；且校验档位/方式未被改 |
| 隔离 | `src/server/session-policy.ts:1029-1079` | 无记录也写地板记录 + `quarantined:true`；回读不到标记即失败 |
| 服务层写入口 | `src/session-policy-service.ts:1276-1316` | 会话不在实例 ⇒ 拒写；`ensurePolicyDirIgnored` + `ensureEpochOnce` 后 `setSessionPolicy` |

### 2.4 出口（强制点）

| 层 | 位置 | 证据 |
|---|---|---|
| ① 装配期过滤（看不见） | `src/preset/tools.ts:1599-1686` | `await next()` 后逐名 `decideToolFace(name, level, DEFAULT_DENY_OF(), knownToolNames())`，`kept` 回填 |
| ② 预执行拦截 | `src/preset/tools.ts:1719-1785` | `ctx.on('tools/pre-execute', ...)` 同一纯函数判决；异常 ⇒ `next()`（**fail-open**，见 `:1777-1781`） |
| ③ 单调哨兵 | `src/preset/tools.ts:1845-1922` | `ctx.tools.guard`：先判名短路（`:1858-1859`），名单内异常收敛为「拒」（`:1913-1918`） |
| ④ 工具 execute 自门 | `src/modules/tools.ts:1251-1294` | `workspaceGate`：先判身份（`:1267-1276`），再判名字是否在该档名字集（`:1287-1292`） |
| ⑤ 读工具类型门 | `src/server/workspace-read.ts:74-78`、`:170-172` | `isAllowedForLevel`：project 只 `.md`、workspace 恒真、ledger 恒假 |
| ⑥ 发送时选档闸 | `src/session-policy-service.ts:1642-1791` | Hob ∧ 盘上无记录 ⇒ `stagePendingMessage` + `markBlocked` + `{kind:'reject'}`；判不出 ⇒ `next()`（fail-open） |
| ⑦ 红线（不可写/不可执行/不可组队） | `src/modules/tools.ts:435-552` + `src/preset/tools.ts:1351-1372` | `DEFAULT_DENY` 列 40+ 名；`SHARED_FORBIDDEN_TOOLS` = write/edit/bash/pwsh/str_replace_editor 由哨兵**无条件拒**（`:1867-1869`） |
| ⑧ 写面白名单 | `src/server/hob-write.ts:765-887` | 生成物/骨架/备份/活跃 change 逐类拒；其余落 `LEDGER_WRITABLE_DIRS`/`LEDGER_FILES` |

---

## ③ 契约与不变量清单（当前代码里**真正被强制**的）

| # | 不变量 | 强制点 | 判定 |
|---|---|---|---|
| I-1 | 无身份 / 坏存储 / 版本不认识 / 归档 / 隔离 / pending ⇒ 读档最低且 `mayProceed=false` | `server/session-policy.ts:641-661`、`:700-741` | ✅ 真强制（`base()` 统一出口） |
| I-2 | 三档只放宽「读」，**任何一档都不注册写/命令/组队工具** | `src/preset/tools.ts:1351-1357`、`modules/tools.ts:435-552`、`preset-dsh-hob.patch.yml:730-754` | ✅ 真强制（声明面 + deny + 哨兵三层） |
| I-3 | `quarantined` 不能被一次普通写抹掉 | `server/session-policy.ts:921-928`（set 拒）、`:993-995`（activate 拒） | ✅ 真强制 |
| I-4 | 「Hob 不能自批」：`decided_by` 必须是 `user` | `shared/pipeline.ts:351-353`、`:435` | ⚠ **形式上成立、实质可被 Hob 单方面满足**（见 P-01） |
| I-5 | 写盘必须回读确认，不许「调过写函数就算成功」 | `server/session-policy.ts:405-413`、`:468-474`、`policy-block-log.ts:131-139` | ✅ 真强制 |
| I-6 | 非 Hob 会话不落「未选档」分支 | `shared/policy-record-state.ts:118-123`（② 步先判 isHob） | ✅ 真强制 |
| I-7 | 开放面校验是**服务端唯一门**，四处共用同一常量 | `read-level-policy.ts:61/108-110`；消费：`session-create-channel.ts:219/412`、`bus.ts:2137`、`session-policy-route.ts:321` | ✅ 真强制（但常量已三档全开，见 P-04） |
| I-8 | 模块开关是**拓扑型**（改了要重启），`spawn.*` 是值型（下次现读） | `modules/settings.ts:40-70` 表 + `index.ts:239-245`（只在 apply 期读一次） | ✅ 与文档一致 |
| I-9 | `permission.level` 无任何消费方、也不是迁移来源 | `config.ts:348-364`、`:654-665`；`src/preset/tools.ts:337-340`（只取名字） | ✅ 与 README:96/118 一致（核实通过） |
| I-10 | 发送闸门 fail-open，读档闸门 fail-closed | `session-policy-service.ts:1633-1636`（注释）、`:1711-1717`（实现） | ✅ 方向正确且注释与实现一致 |

---

## ④ 缺陷 / 风险清单

> 排序口径：先「会让失败不可观测 / 门禁可绕过 / 双实现口径」，再按严重度。

### P-01 · **blocker** · 「用户批准」可由 Hob 单方面转录满足，I-4 实质失效

- **位置**：`src/modules/tools.ts:1954-2118`（`hob_pipeline_approve`）；`src/shared/pipeline.ts:351-353`、`:414-444`。
- **证据**（关键三行）：
  - `src/modules/tools.ts:2081`：`'decided_by = "user"',` —— 这个字段是**工具自己写死的常量**，不是从任何用户侧事实推导出来的。
  - `src/modules/tools.ts:2051-2058`：唯一校验是正则
    `new RegExp(`(?:确认|要求修改|退回修改)\\s*(?:需求|方案)?\\s*${escaped}\\s*第\\s*${actualRevision}\\s*版`)`
    对**调用方自填的字符串** `source` 做匹配；匹配通过即视为「用户回执」。
  - `src/modules/tools.ts:1976-1980`：`source` 的 description 只写「用户回执原文，必须能证明用户明确说出了对象和版本」——**没有任何来源校验**。
  - 全仓 `grep` 无任何「读会话消息 / 比对 message id / 读 transcript」的实现（`grep -n "session\.events|events\(\)|readMessages|history" src/modules/tools.ts` 零命中）。
  - `src/modules/tools.ts:2107`：`validateLedgerStructure: false` —— 连 `checkLedgerUnitWrite` 的 C-22 字段校验都被跳过（对照 `src/server/hob-write.ts:1569-1572`）。
- **影响**：Hob 只要自己拼一句 `确认需求 R-01 第 1 版`，`receipt-mismatch` 闸门即通过，盘上出现一条 `decided_by="user"` 的 decision 单元；
  随后 `approvalStateOf` 返回 `state:'approved'`（`shared/pipeline.ts:386-393`），G1/G2 用户门打开 ⇒ 可建任务、可派活。
  **I-4 因此是「自证」**：它校验的字段由被校验方写入。
- **与红线的关系**：不违反「不可写/不可执行/不可组队」的**字面**（decision 单元属 `write_hob` 族允许的账本写面），
  但它违反更根本的「用户批准必须由用户给出」。**需要独立编号**（本编号 P-01）。
- **建议**：见文末 [建议决策] D-1。

### P-02 · **high** · 批准工具不过 `proceedGate`：状态机说「不推进」，写门禁却没拦

- **位置**：`src/modules/tools.ts:1954-2118`（`ledgerApprove.execute` 内**没有** `proceedGate` 调用）；
  对照 `src/modules/tools.ts:1581-1588`（`write_hob` 有）。
- **证据**：`grep -n "proceedGate(" src/modules/tools.ts` 只命中两处：`:1306`（定义）、`:1582`（write_hob）。
  `hob_ledger_init` / `hob_ledger_migrate` / `hob_ledger_rebuild` / `hob_pipeline_approve` 四个写工具**全部不过该闸门**。
  其中 init 有明确理由（`src/preset/tools.ts:2020-2021`「它是开张而不是推进」），**approve 没有**。
- **影响**：`archived` / `quarantined` / `pending-activation` / `unknown-legacy` 的会话（`mayProceed=false`）仍能写「用户批准」落账。
  「被隔离的会话不能推进」这条不变量在**写路径**上出现一个旁路。
- **建议**：`ledgerApprove` 的真写分支（`dryRun:false` 之后、`writeHobFile` 之前）加与 `write_hob` 同一道 `proceedGate`；`dryRun` 保持放行。

### P-03 · **high** · 被拦消息超限时「丢最旧」只有一条 console.warn，且队列在进程内存

- **位置**：`src/session-policy-service.ts:131-132`（上限）、`:159-169`（丢最旧）、`:104`（`Map` 在进程内存）、`:190-192`（`console.warn`）。
- **证据**：
  - `session-policy-service.ts:159-162`：`while (next.length > PENDING_MAX_PER_SESSION) { const dropped = next.shift(); loggerWarn(...) }`
  - `session-policy-service.ts:165-169`：总字符超限同样 `shift()` + warn。
  - `session-policy-service.ts:127-129` 自承：「**代价（如实写）**：被丢掉的那条**永久消失**」。
  - 观测面：`index.ts:369-378` 本仓自己论证过「warn 在生产日志通道**结构上永远被滤掉**（实测 111 条里 warn 一条没有）」。
    该论证针对 `ctx.logger` 的 in-memory exporter；本文件走 `console.warn`（`:191`）——**console 是否被同一阈值滤掉：未验证**。
- **影响**：宿主已把被 reject 的消息丢弃，我们的暂存是唯一副本。超限丢最旧 ⇒ 用户输入永久丢失；
  若 console.warn 也不可见，则这次丢失**完全不可观测**（正是本域最该防的形态）。
- **建议**：① 丢弃计数进 `session-policy-blocks.json`（已有落盘面），让它可被面板读到；
  ② 或把上限触发的丢弃改成「拒绝新消息并回一条可见提示」而不是静默丢旧。

### P-04 · **high** · 工具描述里的开放面与实际常量相反（模型被误导）

- **位置**：`src/modules/bus.ts:2037-2043`（`hob_spawn` 的 `level` 参数描述）；`src/client/create-hob-dialog.tsx:167`（兜底文案）。
- **证据**：
  - `bus.ts:2041-2042`：`'⚠ **当前只有 ledger 开放**：其余两档会被服务端拒签/拒建并给可读原因'`
  - 实际常量：`src/shared/read-level-policy.ts:61`：`export const OPEN_READ_LEVELS = ['ledger', 'project', 'workspace'] as const`
  - 同文件 `:17-27` 明确记录「2026-10-24 本轮变更：开放面从只开最低档扩到三档全开（ledger + project + workspace）」。
  - 客户端兜底 `create-hob-dialog.tsx:167`：`'当前只开放「账本权限」：其余档位待宿主具备可靠的持久清理能力后开放。'`（仅服务缺席时使用，`:772-774`）。
- **影响**：模型读到 `hob_spawn` 描述后会**主动放弃** `project`/`workspace`，以为会被拒；而服务端实际放行。
  这是「文档比实现落后」方向的反向漂移：不是放宽，而是**自我限制 + 说假话**。
- **建议**：把 `bus.ts:2041-2042` 改成引用 `OPEN_READ_LEVELS` 现算的句子（或直接引用 `readLevelNotOpenReason` 的口径），
  与 `read-level-policy.ts:87-88` 的 `OPEN_READ_LEVELS_NOTE` 同源。

### P-05 · **medium** · `canReadWorkspace` 是「看起来像判据」但零消费方的字段

- **位置**：`src/server/session-policy.ts:607`（`const canRead = (level) => o.levels.includes(level) && level !== floor`）、`:622`（`canReadWorkspace: isHob && canRead(level)`）；
  `src/session-policy-service.ts:288`、`:1238`（`get()` 回带）。
- **证据**：`grep -rn "canReadWorkspace" src/` 只命中上述定义/注释；**没有任何判定点读它**。
  真正的读门是 `src/modules/tools.ts:1287-1292`：`const names = deps.tierNamesOf?.(level) ?? []; if (!names.includes(toolName)) return '拒绝…'`。
- **影响**：与 P-06 同族——一个「安全形状」的字段无人消费。将来若有人只改 `canReadWorkspace` 以为收紧了读面，**不会有任何效果**。
- **建议**：要么删字段（连带 `SessionPolicyView.canReadWorkspace`），要么在注释里钉死「仅供显示，不参与判定」并加机检。

### P-06 · **medium** · 关键依赖 throw 指向一个无消费者的服务

- **位置**：`src/preset/tools.ts:360-372`（`PERMISSION_SERVICE` 缺席 ⇒ `throw`）；`src/config.ts:613`、`src/index.ts:162`。
- **证据**：
  - `src/preset/tools.ts:361-371`：`if (permissionServiceName === undefined) { ... throw new Error('dsh-hob preset: 关键依赖 "PERMISSION_SERVICE" 取不到…') }`
  - 但该服务的**取值**无人读：`src/preset/tools.ts:405-415` 之后，档位判定全部走 `policyService()`（`hobSessionPolicy`）；
    `config.ts:598-606` 自承「唯一消费者是 `serviceNameOf('PERMISSION_SERVICE')`，取到的档位值从不参与判定」。
- **影响**：一旦宿主进程里存在**旧版 `config.ts` 缓存**（本仓 `EXPERIENCE` E-* 反复记录的形态），整个预设 `apply` 抛错 ⇒
  工具面**全部不注册**；而它「保护」的东西根本不从它取值 ⇒ 这次停摆**换不到任何安全收益**。
- **建议**：把 `throw` 降级为 `degrade(...)`（与 `WORK_MODE_SERVICE` 同档），或直接删掉对 `PERMISSION_SERVICE` 的依赖。
  若机检 G-11 钉着「缺席 ⇒ throw」，需要同批改判据并写明理由。

### P-07 · **medium** · `runLegacyMigration` 是死函数，且它返回的报告会「假报成功」

- **位置**：`src/session-policy-service.ts:659-692`；对照真正的迁移 `:813-988`（`migrateAsync`）。
- **证据**：
  - `grep -rn "runLegacyMigration" src/` 只有 `:659` 一处定义，**零调用**。
  - 函数体：查 `sessionQuery` 是否存在，不存在则返回 `ok:false`；**存在则直接** `return report`，
    而 `report` 初始化是 `{ ran: true, ok: true, migrated: [], perFile: [], failed: [], reason: '' }`（`:660`）——
    **一条都没迁，却报 `ran:true, ok:true`**。
  - 同时 `ensureLegacyMigrated`（`server/session-policy.ts:1088`）被 import 进服务层（`:33`）但**从未使用**（只用 `ensureLegacyMigratedByFile`，`:969`）。
- **影响**：双实现口径。当前不影响运行（死代码），但任何人「接上这个更简单的入口」就会拿到一份**声称已迁移的报告**。
- **建议**：删除 `runLegacyMigration` 与未使用的 import；若保留则改成 `throw new Error('not implemented')`。

### P-08 · **medium** · `ensurePolicyDirIgnored` 的返回值被三处丢弃，注释与事实相反

- **位置**：`src/session-policy-service.ts:1290`、`:1478`、`:1529`；对照 `src/server/session-policy.ts:489-491` 的注释。
- **证据**：
  - 三处调用形如 `ensurePolicyDirIgnored(`${file.slice(0, file.lastIndexOf('/'))}`)` —— **返回值未接**。
  - 而该函数的注释（`server/session-policy.ts:490-491`）写：「返回值有**三处**调用方拿它决定『要不要告警』
    （`session-policy-service.ts` 三处）⇒ 写没写进去必须当场核」——**与实现相反**。
  - 同族函数 `ensureRuntimeIgnored` 在别处是**被接住并告警**的（`modules/bus.ts:1710-1711`、`orchestrator.ts:2584-2586`）。
- **影响**：`runtime/.gitignore` 写失败 ⇒ `session-policy.json` / `session-policy-blocks.json`（含 sessionId）
  可能被账本 git 收进历史，且**没有任何告警**。注释还宣称这件事已被处理 ⇒ 下一个人不会去查。
- **建议**：三处接住返回值，失败时打一条可读 warn（用 `ctx.logger`，不是 console）。

### P-09 · **medium** · 文档声称「不写 `~/.dsh/**`」，随包预设却把账本指到 `~/.dsh` 下

- **位置**：`README.md:166`、`:188`；`preset/dsh-hob/preset-dsh-hob.patch.yml:913`。
- **证据**：
  - `README.md:166`：`| **记录区在工作区之外** | … 它不写 \`~/.dsh/**\`（有显式拒绝路径） |`
  - `README.md:188`：`⚠ 插件**不写** \`~/.dsh/**\` 下除 profile 配置以外的任何东西`
  - `preset-dsh-hob.patch.yml:913`：`ledgerHome: /home/lk/.dsh/hob-ledgers`
  - 落点推导：`src/server/session-policy.ts:238-240`（`<ledgerRoot>/runtime/session-policy.json`）、
    `policy-block-log.ts:47-49`（同目录 `session-policy-blocks.json`）、`server/orch-state.ts:1248-1249`（`orch-watches.json`）。
- **影响**：所有运行态（含 sessionId、派发 watch）实际落在 `~/.dsh/hob-ledgers/<ws>/runtime/` 下。
  README §3.2:141-147 已提示 `ledgerHome` 是绝对路径「换机必须改」，但**没有更正 166/188 那两句绝对断言**。
  用户按 166/188 理解「插件不碰 ~/.dsh」⇒ 备份/清理/审计都会漏掉这个目录。
- **建议**：改 166/188 为「除 `<ledgerHome>`（随包缺省为 `~/.dsh/hob-ledgers`）与 profile 配置外，不写 `~/.dsh/**`」。

### P-10 · **low** · `skeleton.enabled` 已退役，但三处注释仍描述它为「已修好的权威旋钮」

- **位置**：`src/modules/tools.ts:108-126`、`:1079-1118`、`:2433-2464`；`src/config.ts:450`。
- **证据**：
  - schema 里**没有** `skeleton` 组（只读探针实测：顶层键仅 `modules/spawn/permission/workMode`）。
  - `scripts/check-all.mjs:259-262`：`skeleton.enabled` 配置段按 `UD-159` 退役，「`config.ts` 的 schema 少了那个子字段」。
  - 但 `tools.ts:124-126` 仍写「一律经 `config.ts` 的 `skeletonEnabled()` 解」——`config.ts` **没有这个导出**（`grep "^export"` 实测）。
  - `tools.ts:2438` 引用 `scaffoldSkeletonForWorkspace(wsRoot, …)`——全仓零命中（`grep -rn scaffold src/` 只有这一条注释）。
  - `tools.ts:2458-2461` 讨论 `deps.skeletonEnabledOf`——`HobToolsDeps`（`:994-1064`）里**没有这个字段**。
- **影响**：这正是本仓反复声明的「文档比实现多走一步」。注释把一件**已删除**的能力写成「本轮已修好、有权威读取器」，
  下一个读代码的人会去找一个不存在的消费方。
- **建议**：删除 `tools.ts:1079-1118` 与 `:2433-2464` 两段关于 skeleton 的注释，`config.ts:450` 的「与 skeleton 同形」改成「与 spawn 同形」。

### P-11 · **low** · `ledger` 档仍可跨项目读看板与全部工作区路径（与「只读自己的账本」口径不符）

- **位置**：`src/preset/tools.ts:1036-1171`（`MODEL_TOOL_ALLOWLIST` 含 `taskboard_list/get/comments`）；
  `src/modules/tools.ts:435-552`（`DEFAULT_DENY` 只 deny 看板的**写**六件，`:516-523`）；
  `src/modules/bus.ts:1217-1262`（`list()` 返回所有活会话的 `cwd`）。
- **证据**：`DEFAULT_DENY` 的注释明写「只读的三个（`taskboard_list`/`get`/`comments`）**不在本清单** —— 读看板是合法的」（`:516`）。
  而 `taskboard_list` 的 `workspaceId` 是可选过滤（工具描述：「Filter by project (workspaceId)」），不传即全量。
- **影响**：`ledger` 档被文档定义为「只读自己的账本 + 网络」（`README.md:96`、`config.ts:367`），
  实际还能读到**别的项目**的卡、所有工作区的绝对路径、所有会话的 cwd。这是**口径**问题，不是越权漏洞（都属只读）。
- **建议**：见文末 [建议决策] D-2。

### P-12 · **low** · 客户端四个配置读写函数零调用方，但机检钉着它们

- **位置**：`src/client/settings.ts:327`（`writePermissionLevel`）、`:363`（`readPermissionLevel`）、`:405`（`writeWorkMode`）、`:440`（`readWorkMode`）。
- **证据**：`grep -rn "writePermissionLevel|writeWorkMode" src/` 只命中定义与 `settings-panel.tsx:658` 的注释；
  面板卡已删（`settings-panel.tsx:644-668`），注释自承「写入函数仍在 `settings.ts`（`check:config` 的 G-7/G-8 钉着它们）」。
- **影响**：死代码 + 判据钉死代码 ⇒ 想删要先改判据。不影响运行。
- **建议**：在 `check:config` 里把 G-7/G-8 的目标从「函数存在」改成「schema 字段存在」，然后删四个函数。

### P-13 · **low** · 其余死代码 / 空导出

| 位置 | 现象 | 证据 |
|---|---|---|
| `src/preset/tools.ts:1613`、`:1729` | `allowFor` 定义了**两次**，且两处都**未被使用**（两函数实际用 `decideToolFace` + `visibleNamesFor`） | `grep -n "allowFor" src/` 只有定义与 `shared/work-mode.ts:218` 的注释 |
| `src/server/session-policy.ts:1276-1279` | `policyFileExists` 导出，零消费 | `grep -rn "policyFileExists" src/` 只有定义 |
| `src/shared/capability-red-line.ts:40-44` | `capabilityRedLine(lang)` 零调用；host 侧两处（`modules/tools.ts:1324`、`config.ts:429`）仍自行模板拼接 | `grep -rn "capabilityRedLine(" src/` 只有定义 |
| `src/session-policy-service.ts:33` | `ensureLegacyMigrated` import 后未使用 | 同 P-07 |

---

## ⑤ 与其他域的边界与疑点

### 5.1 跨域确认请求的判定（来自 pipeline-auditor / t1）

**问：`hob_pipeline_approve` 写 `decided_by=user` 时，这是「用户真实操作」还是「Hob 转录」？I-4 在权限层成立吗？**

**答（结论 + 证据）：**

1. **定位 = Hob 的工具调用（转录），不是用户本人的操作。**
   - 工具在预设作用域注册：`src/preset/tools.ts:2029-2031`；在三档白名单里：`src/preset/tools.ts:1062`（`MODEL_TOOL_ALLOWLIST`），
     而 `PERMISSION_TIERS.ledger = MODEL_TOOL_ALLOWLIST`（`:1213`）⇒ **三档都能调**。
   - `decided_by = "user"` 是**硬编码字符串**：`src/modules/tools.ts:2081`。
   - 唯一的「用户证据」是调用方自填的 `source` 字符串，只做正则匹配：`src/modules/tools.ts:2051-2058`。
   - **没有任何来源校验**：不读会话消息、不比对 message id、不读 `session/event`（全仓 grep 零命中）。
   - ⇒ `decided_by=user` 是**用户回执原文的转录**，而且连「原文」都不需要是真的 —— 只要形如
     `确认需求 R-01 第 1 版` 即可。它**不是**用户真实操作的证明。

2. **I-4 的判定：形式上成立但实质可被 Hob 单方面满足。**
   - `src/shared/pipeline.ts:351-353`：`if (text(latest.decided_by) !== 'user') { return { state: 'invalid', … '批准者不是 user，禁止 Hob 自批' } }`
   - `src/shared/pipeline.ts:435`（C-22）：`if (by !== 'user') out.push({ rule: 'C-22', …, why: 'decided_by 必须是 user（Hob 不能自批）' })`
   - 两处校验的都是**同一个字段**，而该字段由 `hob_pipeline_approve` 自己写入（`tools.ts:2081`）。
     ⇒ 判据与写入方同源，构成自证。**结论：形式上成立、实质可被 Hob 单方面满足。**
   - 加重项：写这条 decision 时 `validateLedgerStructure: false`（`tools.ts:2107`）⇒ 连 C-22 的字段校验都不跑；
     且不过 `proceedGate`（见 P-02）⇒ 归档/隔离会话也能写。

3. **与红线清单的关系：不冲突，但需独立编号。**
   - 「不可写」在本仓的语义是「不可写工作区文件 / 代码 / 任意路径」，账本写入走 `write_hob` 族是被允许的
     （`DEFAULT_DENY` 只 deny 通用 `write`/`edit`，见 `modules/tools.ts:474-479`；账本写入收口到 `write_hob`）。
     decision 单元属 `ledger/units/*.toml`，在 `LEDGER_WRITABLE_DIRS` 内（`server/hob-write.ts:150`）⇒ **不违反字面红线**。
   - 但它违反「用户批准必须由用户给出」这条更根本的不变量（`CONSTITUTION` G1/G2、`pipeline.ts:307-393` 的整套 approval 语义）。
   - ⇒ **已独立编号 P-01（blocker）**，并在文末给出决策项 D-1。

### 5.2 与 orchestration / dispatch 域的边界

- **执行预设核对**：唯一实现点是 `hobBus.resolveDispatchTarget`（`src/modules/bus.ts:1133-1216`），
  判定纯函数在 `src/shared/dispatch-preset.ts:59-75`。orchestrator 的两个派活入口都过它：
  `dispatch()`（`orchestrator.ts:4908-4931`）与 `dispatchPlan()`（经 `orch.dispatch` 间接过，`:4834-4841`）。
  - ✅ 一致：`target-hob` 分支只给「新建 / 取消」两选项（`bus.ts:1153-1157`），用户选 `active` 也按取消处理（`:1176-1187`）。
  - ⚠ 疑点（**我判不了**）：`hob_send`（纯通知）**不过** `resolveDispatchTarget`，只给 `presetNotice` 预警（`bus.ts:1000-1038`）。
    这是有意设计（`bus.ts:1008-1011` 明写「拦投递会误伤合法用法」），但意味着**通知路径可以把指令投给 Hob 会话**。
    与「Hob 永不作为实施会话」的硬口径是否冲突，需 orchestration 域定。

- **模块开关的拓扑型语义**：`modules.orch` 关 ⇒ `hobOrchestrator` 不 provide ⇒ 三个编排工具不注册（`src/preset/tools.ts:861-905`）。
  但 `src/preset/tools.ts:843-849` 在 `hob_send` 里 **`busCtx.get('hobOrchestrator')` 现取**做对账 —— M5 关掉时这段静默跳过（`catch {}`）。
  ✅ 与「关掉一个模块只影响它自己」一致；⚠ 但「对账」这件事在 M5 关闭时**无声消失**，属可观测性边界。

### 5.3 我无法单独判断的疑点（标「未验证」）

| # | 疑点 | 为什么判不了 |
|---|---|---|
| U-1 | `console.warn`（`session-policy-service.ts:191`）在真机生产日志里是否可见 | 需要真机日志通道读数；本仓只论证过 `ctx.logger` 的 warn 被滤（`index.ts:369-378`），**未验证** console 是否同待遇 |
| U-2 | `web_fetch` 是否可被 Hob 用来访问本机 `/api/dsh-hob/session-policy`（带 cookie 的越权写策略） | 需要确认宿主的 SSRF/私网拦截；本会话无真机，**未验证** |
| U-3 | `restrict({deny})` 对「尚未注册」的名字失败后，`tools/change` 是否**一定**会再次触发 | 依赖宿主时序；代码只保证「再试一次」（`src/preset/tools.ts:949-959`），**未验证**「一定」 |
| U-4 | 迁移 `legacyModeSnapshot` 在「安装时 config 还没解析完」的极端时序下是否真能取到值 | 需要真机 apply 期读数；代码注释自承曾是缺陷（`session-policy-service.ts:533-545`），修复后**未在本会话验证** |
| U-5 | `hob_pipeline_approve` 的 decision 单元被 `ledgerReadiness` 读取时，是否会把「转录批准」标成健康 | 属 ledger 域；本域只确认写入面，**未验证**读侧口径 |

---

## [建议决策]

- **D-1** 用户批准是否允许 Hob 转录 | 选项：A 保持转录（要求 Hob 附 message id 并在 UI 显示「由 Hob 转录」）/ B 改为用户本人操作（Hob 只能「请求批准」，由界面/宿主回执落账） | **推荐：B** 理由：`decided_by=user` 由被批准方写入时，任何字段级校验都无法区分转录与伪造，I-4 只能是自证。

- **D-2** 看板跨项目只读是否属于 `ledger` 档 | 选项：A 允许（现状）/ B 收紧（`taskboard_*` 只在 `project` 档起可见，或强制 project 过滤） | **推荐：A + 改口径文案** 理由：只读看板是诊断必需，但「只读自己的账本」这句话当前不成立，应改成「只读自己的账本与全局只读看板」。

- **D-3** `PERMISSION_SERVICE` 的 `throw` 是否降级 | 选项：A 保持 throw（现状，机检 G-11 钉着）/ B 降为 `degrade`（与 `WORK_MODE_SERVICE` 同档） | **推荐：B** 理由：它保护的是一个零消费方服务，旧缓存会让整个工具面消失却换不到任何安全收益。

- **D-4** `skeleton.enabled` 残留注释的处理 | 选项：A 只删注释（低风险）/ B 同时给 `config.ts` 补一个「已退役」的说明行 | **推荐：A** 理由：schema 已无该字段，补说明反而会让人以为还有东西可配。

---

## 附：核实通过的「声明了但无消费方」清单（与 README 自承同族）

| 配置项 / 字段 | 真实消费方 | 结论 |
|---|---|---|
| `permission.level` | 仅 `index.ts:162` provide；`src/preset/tools.ts:360` 只取**名字** | ✅ README:96/118 与 `config.ts:348-364` **准确**，非新缺陷 |
| `workMode.mode` | ① `index.ts:194` → `captureLegacyModeSnapshot`（迁移快照）；② `index.ts:172` provide 的**值无人读** | ⚠ 只有一条真实用途（迁移），`config.ts:686-689` **描述准确**；但面板 `writeWorkMode` 无 UI 调用方（P-12） |
| `modules.*` | `index.ts:151/239-245` | ✅ 真消费（拓扑型，需重启） |
| `spawn.*` | `index.ts:91` → `bus.ts:697-699` / `:1410-1486` | ✅ 真消费（值型，每次现读） |
| `skeleton.enabled` | **无（schema 已无该字段）** | ❌ 见 P-10（残留注释） |
| `SessionPolicyView.canReadWorkspace` | **无** | ❌ 见 P-05 |
| `SessionPolicyView.level/workMode` | `session-policy-route.ts` 只用 `isHob/recorded/source`；档位值**不出网** | ✅ 与「只回一个语义字段」的设计一致 |
| `migrationStatus()` / `migrateNow()` | 仅 `scripts/check-session-policy.mjs` | ✅ 诊断用途，`session-policy-service.ts:1216-1217` 注释自承 |
| `enums()` | `session-create-channel.ts:1330` | ✅ 真消费 |
| `readRawPolicy()` | `session-create-channel.ts:1201-1205` | ✅ 真消费（回读确认） |
