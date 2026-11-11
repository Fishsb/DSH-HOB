# 账本契约与投影 · 业务逻辑审查（t2 · ledger-auditor）

> 审查范围（只读）：`src/shared/{ledger-validation,ledger-lifecycle,ledger-catalog,ledger-resources,ledger-relations,ledger-write-policy,policy-record-state,item-presentation,portfolio,ledger-readiness}.ts`、
> `src/server/{ledger-projection,projection-writer,hob-write,doc-read,workspace-read,hob-render,board-cards}.ts`、
> `src/modules/{ledgers-route,ledger-resource-route,requirement-chains-route}.ts`。
> 交叉读取（只为定位调用点/判据，不作为本域结论的独立依据）：`src/modules/tools.ts`、`src/modules/orchestrator.ts`、
> `src/shared/{stage-controls,pipeline,stages-index,convergence}.ts`、`src/preset/tools.ts`。
> 取证方式：逐文件读码 + 在 `/tmp` 用 `node` 直接 import 本仓 `src/**` 跑只读探针（不改仓库、不跑 build、不写 lib/）。
> 每条结论都带 `文件:行号`；跑过的探针在附录 A 逐条列出输入与输出。

---

## ① 本域业务职责（3 句内）

账本（`<ledgerHome>/<workspaceName>/ledger/units/` 的 `index.toml` + `unit-*.toml` 分片）是整个 dsh-hob 的**唯一机读事实源**：单元（req/change/task/run/acc/verification/closure/…）的 kind/status 封闭契约、结构校验、字段与关系门禁、写入守卫全部围绕它展开。
本域负责四件事：**谁能写、写到哪、写完算不算合法**（`hob-write.ts` + `ledger-validation.ts` + `ledger-write-policy.ts`）；**账本当前能不能用来推进**（`ledger-readiness.ts` + `ledger-lifecycle.ts`）；**运行态事实如何确定性地落成账本事实**（`ledger-projection.ts` 纯函数 + `projection-writer.ts` I/O）；**只读面如何把账本投影给面板**（`ledger-resources.ts` / `item-presentation.ts` / `portfolio.ts` + 三条 `*-route.ts`）。
它刻意不做的事：不投递、不改运行态、不判断业务语义对错——语义归 `stage-controls.ts` / `pipeline.ts`。

---

## ② 主链路：入口 → 状态 → 落盘 → 出口

### 2.1 写入主链（模型面 `write_hob`）

| # | 步骤 | 位置 |
|---|---|---|
| 1 | 工具入口：先过「推进闸」`proceedGate`（dryRun 放行） | `src/modules/tools.ts:1581-1588` |
| 2 | 由路径反推写操作类型 `classifyHobWritePath`（`replace-current`/`write-active-change`/`write-ledger-source`/…） | `src/shared/ledger-write-policy.ts:44-51`；调用 `src/modules/tools.ts:1589-1597` |
| 3 | 当前正文三份（`CONTEXT/PROJECT/DECISIONS`）只许 `overwrite` + 必须带 `reason` | `src/modules/tools.ts:1598-1618`；`ledger-write-policy.ts:8` |
| 4 | 解析账本根 `ledgerRootOf` → `resolveLedgerRoot(cfg.ledgerRoot, cfg.ledgerHome, workspaceRoot)` | `src/modules/tools.ts:567-573` → `src/server/doc-read.ts:95-147` |
| 5 | 作用域门禁：`gateIntent=repair` 走 `repairOf` 命中检查，否则 `stageGateOfLedger(root)`（**全账本**） | `src/modules/tools.ts:1636-1664` |
| 6 | 进 `writeHobFile`：进程内**按目标绝对路径**串行排队 | `src/server/hob-write.ts:1454-1455`（`withFileQueue` `:734-750`） |
| 7 | 静态守卫：`resolveInside` 越界 → 扩展名 → 白名单（骨架/备份/`ledger/gen` 拒写）→ 软链逐段 lstat → 归档禁 overwrite | `src/server/hob-write.ts:1482-1536`；白名单 `:765-887` |
| 8 | 读数渲染：把 `<!-- hob:count | bytes | 目标 -->` 换成当场实测值（**先于**幂等比对） | `src/server/hob-render.ts:401-498`；调用 `hob-write.ts:1545` |
| 9 | **账本单元结构校验**（唯一的「写前合并校验」入口）`checkLedgerUnitWrite` | `src/server/hob-write.ts:1569-1572` → `:1022-1093` |
| 10 | 大小上限 → 读存量三态（`ok`/`missing`/`error`）→ 当前正文禁 append → 编号/幂等 → 缩水守卫 → 幂等跳过 | `hob-write.ts:1574-1664` |
| 11 | 当前正文替换前**不可变归档快照** | `hob-write.ts:1671-1682` → `:1225-1279` |
| 12 | 写前备份（`wx` 独占 + 递增后缀 + 回读逐字节比对 + 保留 N 份按 mtime 排序） | `hob-write.ts:1750-1767` → `:1281-1420` |
| 13 | 原子写：同目录 tmp → write → **fsync 文件** → chmod → rename → fsync 目录 | `hob-write.ts:1796-1802` → `:645-680` |
| 14 | 回读逐字节校验，不符则**原子回滚 + 回读确认** | `hob-write.ts:1828-1876` |
| 15 | 悬空引用只提示不拒写 → `publishLiveChange` → 返回读数 | `hob-write.ts:1881-1940` |
### 2.2 运行态 → 账本投影主链

| # | 步骤 | 位置 |
|---|---|---|
| 1 | 编排器在某事件后调用 `applyProjection(ledgerRoot, fact)` | 派发前 `src/modules/orchestrator.ts:5215`；拒收 `:5317`；派发成功后 `:5391`；回传 `:7654`；判决 `src/preset/tools.ts:896` |
| 2 | 按账本根进**整场投影**串行队列（不是按文件） | `src/server/projection-writer.ts:70-81,177-183` |
| 3 | 读全账本（`index.toml` + `unit-*.toml`，按名排序合并） | `projection-writer.ts:100-112` |
| 4 | 纯函数出操作清单 `projectFact`（dispatch/refuse/return/verdict/verify/close 六个事实） | `src/server/ledger-projection.ts:706-713` |
| 5 | 幂等键去重（`projection_key`） | `ledger-projection.ts:247-249,265-272` |
| 6 | 编号分配 `nextIdOf`（扫描全账本取同前缀最大序号 +1，补零 3 位） | `ledger-projection.ts:231-244` |
| 7 | 逐条落盘：`create-unit` → 追加到固定分片 `unit-projection.toml`；`transition-unit`/`link-unit` → 在**原分片**里删段重写 | `projection-writer.ts:224-281` |
| 8 | 全部走 `writeHobFile`（白名单/备份/原子写/回读），**但传 `validateLedgerStructure:false`** | `projection-writer.ts:162,272` |
| 9 | 发布 `runtime` 信号 | `projection-writer.ts:287` |

### 2.3 只读出口主链

| 出口 | 读什么 | 位置 |
|---|---|---|
| `POST /api/dsh-hob/stages` | `index.toml` + `unit-*.toml` → `parseUnitsToml` → 形态核 → `buildStages` | `src/modules/stages-route.ts` → `src/shared/stages-index.ts:691-798` |
| `POST /api/dsh-hob/ledger-resource` | `readLedgerUnits`（**宽松解析器**）→ `readLedgerResource` | `src/modules/ledger-resource-route.ts:100-105` → `src/modules/tools.ts:213-220` → `src/shared/ledger-resources.ts:145-206` |
| `POST /api/dsh-hob/requirement-chains` | `readUnitsOfLedger`（**第三份读盘实现**）→ `buildRequirementChains` | `src/modules/requirement-chains-route.ts:41-135` |
| `POST /api/dsh-hob/ledgers` | 只 `readdirSync` + 数 `[[unit]]` 行数，**不解析 TOML** | `src/modules/ledgers-route.ts:40-117` |
| 面板条目投影 | `presentationOf` / `listPresentationOf` | `src/shared/item-presentation.ts:537-580` |
| 组合层 | `portfolioOf` | `src/shared/portfolio.ts:116-201` |

---

## ③ 契约与不变量清单（**当前代码里真正被强制的**）

### C-1 单元 kind/status 封闭契约

- **唯一状态表**：`src/shared/ledger-validation.ts:14-27`（12 个 kind）。
- **唯一形状判定**：`unitShapeProblems`（`ledger-validation.ts:36-53`）——判 `缺 id` / `重复 ID` / `kind 不在封闭集` / `status 不属于 kind`。
- **调用方仅三处**：`src/server/hob-write.ts:1058`、`src/shared/ledger-readiness.ts:284`、`src/shared/stages-index.ts:26+795`（`export { UNIT_STATUSES, unitShapeProblems }` 只是转出口，`stages-index.ts:25`）。
- 实测三份状态表**逐值一致**（`UNIT_STATUSES` / `STAGE_KIND_STATUSES` `stages-index.ts:40-88` / `KIND_SPEC` `scripts/gen-ledger.mjs:153-…`）：12 个 kind、0 处差异（附录 A-1）。

### C-2 写前「合并后全账本」结构校验

- 入口唯一：`hob-write.ts:1569`（`opts.validateLedgerStructure !== false`）→ `checkLedgerUnitWrite` `:1022-1093`。
- 合并口径：`index.toml` + 其它全部分片 + 本次新内容（append 时把本分片旧内容也算上），`:1052-1056`。
- 它同时跑：`unitShapeProblems` + `stageFieldProblems` + `ledgerClosureProblems` + `pipelineWriteProblems` + `pipelineRevisionProblems` + `verificationRevisionProblems`（`:1058-1084`）。
- 只对 `ledger/units/*.toml` 生效（`:1028` 前置过滤）。

### C-3 写入守卫（谁能写 / 写到哪 / 超限怎么办）

- **路径白名单**：`ledger.toml`、`ledger.templates.toml`、`ledger/units/index.toml`、`LEDGER_PATH_RE = ^ledger/(units|spec|changes)/[A-Za-z0-9._/-]+$`（`hob-write.ts:157,163,799-831`）；`ledger/gen/**` 与 `ledger/spec/**` 显式拒写（`:803-810`）。
- **越界**：`resolveInside` 用 `path.relative`（`doc-read.ts:321-326`）；**软链**逐段 lstat（`doc-read.ts:346-362`，写侧 `hob-write.ts:1528-1531`）。
- **超限**：`maxFileBytes`（缺省 262144，`src/modules/tools.ts:410`）对 content 与写入后总量各判一次（`hob-write.ts:1574-1577,1720-1723`）；超限 `too-large` 拒绝。
- **缩水守卫**：`overwrite` 且旧文件存在时，新内容 < 旧 × 0.5 ⇒ `shrinking` 拒绝（`hob-write.ts:1648-1655`）。
- **归档只增不改**：`archive/` + `overwrite` ⇒ `archive-overwrite-denied`（`:1534-1536`）。
- **串行**：同进程按目标绝对路径排队（`:734-750,1454-1455`）；**跨进程明确不防**（`:718-726` 自陈）。

### C-4 就绪度 / 生命周期契约

- `assessLedgerReadiness` 六档（`unresolved/missing/legacy/empty/unhealthy/ready`），顺序即优先级（`ledger-readiness.ts:149-344`）。
- `assessLedgerLifecycle` 先看 `ledger.toml`（缺 = 兼容模式 `legacyCompatible`），再看 readiness（`ledger-lifecycle.ts:101-208`）。
- `admitWork` 是「工作准入唯一表」（`ledger-lifecycle.ts:372-416`）。
- **实际接线**：`admitWork` 全仓只被 `src/modules/bus.ts:1932`（`action:'notify'`）调用；`WORK_ACTIONS` 里 `dispatch`/`write-*`/`verify`/`accept`/`close` 六行**没有任何运行时调用方**（附录 A-2）。

### C-5 投影契约

- **只投影真实 task**：`implicit` 与空一律 `skipped`（`ledger-projection.ts:251-256,286-293,374-381,451-459`）。
- **幂等**：稳定事件键 `projectionKeyOf`（`:265-272`）+ 落盘 `projection_key` 字段 + 读侧 `projectedUnitOf`（`:247-249`）。
- **判不出就不写**：三档结果 `ops`/`skipped`/`undecidable`（`:212-224`），`describeProjection` 给可读原因（`:716-721`）。
- **按账本根串行**：`withProjectionQueue`（`projection-writer.ts:70-81`），注释里给了实测证据（两并发各建 `RUN-001`）。
- **一个 id 一个单元**：迁移必须改原分片而非追加（`projection-writer.ts:9-24,254-271`）。
- **投影失败不回滚投递/回传**：`orchestrator.ts:5384-5386,7650-7652` 明写；失败读数进 `w.ledgerProjection` 并在状态行渲染（`orchestrator.ts:10008-10018`）。

### C-6 只读面契约

- `readLedgerResource` 只回摘要 + `read` 指针，展开才回正文（`ledger-resources.ts:90-102,200-205`）。
- 客户端与服务端共用 `RELATION_LABELS` / `relationLabelOf`，⛔ 不各写一份（`item-presentation.ts:35-53`）。
- 判不出统一写「判不出」，⛔ 不写 0 / 空串（`item-presentation.ts:124-129`；`portfolio.ts:191-198`）。

---
## ④ 缺陷/风险清单

> 排序口径：先「会掩盖其他问题 / 让失败不可观测」（静默吞错、双实现口径、门禁可绕过、状态不同步），再按严重度。

### L-01【blocker】写前结构校验把 `index.toml` 自身重复计入，导致「往 `index.toml` 写第二条单元」永久不可能

- **位置**：`src/server/hob-write.ts:1044-1056`（合并口径）+ `:1057-1061`（重复 ID 判定）
- **证据**：`merged` 的第一项是 `readToml('index.toml')`，而 `rel = file.slice('ledger/units/'.length)`（`:1051`）。当 `file === 'ledger/units/index.toml'` 时 `rel === 'index.toml'`，`shardNames`（`:1044-1050` 只匹配 `^unit-[^/]+\.toml$`）**不含** `index.toml`，于是 `index.toml` 的旧内容既在 `:1053` 被算一次，又在 `:1055` 的 `readToml(rel)` 被算第二次 ⇒ 每一个既有单元都命中「重复 ID」。
- **探针**（附录 A-3）：`index.toml` 里有 1 条 `R-001`，append 一条**合法**的 `DEC-001` ⇒
  `{"ok":false,"reason":"ledger-duplicate-id","message":"拒绝：R-001: 合并后的账本出现重复 ID ⇒ 一个 ID 只能有一个单元。"}`
  `index.toml` 为空时同一次写入 `{"ok":true}`。
- **影响**：
  1. `index.toml` 只能容纳 **0 或 1** 条单元。任何「把 `index.toml` 当导航入口 + 在其后追加单元」的写法在第二次就死。
  2. 更糟的是**错误原因说谎**：用户/模型看到的是「你写了重复 ID」，而真实原因是守卫自己数了两遍 ⇒ 会去改内容而不是改路径，**缺陷被伪装成用户错误**。
  3. `hob_ledger_migrate` 用 `mode:'overwrite'` 整份重写 `index.toml`（`src/modules/tools.ts:1929` 附近）时走 `incoming` 分支（`hob-write.ts:1055` 的 `mode === 'append' ? … : incoming`），不触发本 bug；但**任何 append 到 index 的路径都死**。
- **建议**：`rel` 为 `index.toml` 时从 `merged` 第三项里排除旧 `index.toml`；并补一条机检：往有 N≥1 条单元的 `index.toml` append 一条合法单元必须 `ok:true`。

### L-02【blocker】「修复写」`gateIntent=repair` 的命中判据与真正拦它的判据不是同一套 ⇒ 存在无法自愈的死锁

- **位置**：`src/modules/tools.ts:1649-1658`（`repairOf` 用 `stageHealthOfLedger`）vs `:1660`（forward 用 `stageGateOfLedger`）
- **证据**：`stageHealthOfLedger`（`:711-721`）调 `stageGateAtLedger(root,{action:'write-forward',scope:{kind:'project'}})`；`stageGateAtLedger` 的 `project` 分支直接 `return evaluateGate(...)`，而 `evaluateGate` 对 `project` 作用域**只报健康不产出 blockers**（`src/shared/stage-controls.ts:990` `if (scope.kind === 'project') return []`）。`stageGateOfLedger`（`:581-591`）用的却是 `stageControlProblems`（字段+审批），**不含** `ledgerClosureProblems`。
- **探针**（附录 A-4）：一本账里唯一缺口是 `L-2`（task 的 parent 指向不存在的 change，字段全齐）：
  - `ledgerReadinessOfRoot` ⇒ `unhealthy` / `gapCount=1`
  - `stageGateOfLedger` ⇒ `undefined`（**放行**）
  - `stageHealthOfLedger` ⇒ `{"ok":true,"blockers":[]}`（**说健康**）
  - `/stages` 的 `stageHealth` ⇒ `{"ok":false,"count":1,"problems":["L-2:TSK-001"]}`
- **影响**：
  1. 同一本账，**四个出口给出四种结论**（详见 L-03）。面板说「有 1 条缺口」，写前门禁说「没问题」，`repairOf` 的依据说「健康」⇒ 用户永远不知道该信哪个。
  2. 一旦某条单元真的因 `stageFieldProblems` 被拦，`repairOf=<该单元>` 会因 `health.blockers.every(p => p.unit !== target)`（`:1650`）恒为真而**永远被拒**（`repair-target-not-a-blocker`）⇒ 这正是注释 `:1628-1630` 声称要避免的死锁，只是换了个成因。
  3. 反向：`L-*` 闭环缺口**不拦任何写入**，但会被 readiness 判成 `unhealthy` ⇒ `dispatchGateAtLedger` 放行派活（`:835` 只查 `lifecycle.active`），而面板显示账本不健康。
- **建议**：让 `stageGateOfLedger` / `stageHealthOfLedger` / `ledgerReadinessOfRoot` / `/stages.stageHealth` 共用**同一个** `problems` 计算；`repairOf` 改用「本次写入将要消除的那条问题」作为判据，而不是「目标单元 id 是否出现在某个 blocker 列表里」。

### L-03【high】同一本账有 **4 套互不相同的「账本健康」判据**，且没有任何一处承认其他三处

- **位置**：
  - `src/modules/tools.ts:581-591`（`stageGateOfLedger`：`stageControlProblems`）
  - `src/modules/tools.ts:711-721` + `src/shared/stage-controls.ts:990`（`stageHealthOfLedger`：project 作用域恒无 blocker）
  - `src/shared/ledger-readiness.ts:294-303`（readiness：`unitShapeProblems` + `stageFieldProblems` + `ledgerClosureProblems`）
  - `src/shared/stages-index.ts:445-465`（`/stages.stageHealth`：`stageControlProblems` + `ledgerClosureProblems`）
- **证据**：探针 A-4 一次跑出四份不同结论（见上）。代码注释里三处都自称「与派活门禁同一个纯函数」（`ledger-readiness.ts:262`、`stages-index.ts:436`、`tools.ts:579`），但**实际组合各不相同**：readiness 有 `unitShapeProblems` 无 `stageApprovalProblems`；`stageControlProblems` = 字段 + 审批；`/stages` = 字段 + 审批 + 闭环。
- **影响**：这是本域最典型的「双实现口径」——**失败被不同出口翻译成不同结论**，用户与模型都无法判断账本到底能不能推进。也直接制造 L-02 的死锁。
- **建议**：抽出唯一入口（例如 `ledgerHealthOf(units)` 返回 `{problems, canProceed}`），四处全部改调；并在 `check:*` 里加一条「四出口对同一夹具必须同结论」的断言。

### L-04【high】两份 TOML 解析器：严格的那份做门禁，宽松的那份做读取 ⇒ 坏账本在读取面「看起来正常」

- **位置**：严格 `src/shared/stages-index.ts:222-250`（`parseUnitsToml`，遇不认识的写法**抛错**）；宽松 `src/modules/tools.ts:159-206`（`parseLedgerUnitsText`，`if (eq < 0) continue`、`if (cur === null) continue`、值不是字符串/数组就**静默丢弃该字段**）
- **证据**（附录 A-5，同一份输入喂两个解析器）：

  | 输入 | 严格 | 宽松 |
  |---|---|---|
  | 旧格式 `[meta]` 头 | `THROW: 第 1 行：不支持的 TOML 表头 "[meta]"` | `[{id:"R-001",kind:"req",status:"agreed"}]` |
  | `title = 123` | `THROW: 第 4 行：只支持 "字符串" 与 ["数组"]` | `[{id:"TSK-001",…}]`（title 被丢掉） |
  | `[[unit]]` 之前有杂行 | `THROW: 第 1 行：键出现在 [[unit]] 之前` | `[{id:"R-002",…}]` |
  | 数组未闭合 | `THROW: 文件末尾有多行数组没有闭合：basis` | `[{id:"R-003",…}]` |

- **谁用哪份**：严格 → `/stages`（`stages-index.ts:766`）、写前校验（`hob-write.ts:1031`）、readiness（`ledger-readiness.ts:231`）、`requirement-chains-route.ts:111`；宽松 → `readLedgerUnits`（`tools.ts:213-220`）⇒ `/ledger-resource`（`ledger-resource-route.ts:101`）、全部门禁（`tools.ts:583,621,859,891,955,1189,2007`）、`ledgerLifecycleOfRoot` 的 index/shard 一致性核（`tools.ts:789`）。
- **影响**：
  1. **门禁与读取看的是两份不同的账本**。一份 `title = 123` 的坏单元：`/stages` 整本拒绝（`row-shape-unknown`），但 `/ledger-resource` 能正常列出它（title 显示为空），派活门禁也照常判它。
  2. `ledgerLifecycleOfRoot` 的 A-4「索引与分片一致性」核（`tools.ts:785-808`）**也用宽松解析器** ⇒ 它核的是一个被静默修复过的视图，永远发现不了「分片里有解析不了的坏行」。
  3. 旧格式账本在 `/ledger-resource` 上表现为**空账本**而不是「格式旧」：探针 A-6 里 `readLedgerUnits` 返回 `[]`，`readLedgerResource(…,'requirement/R-001')` 回 `{reason:'not-found', message:'账本里没有 R-001'}` —— 而 `R-001` **确实在盘上**，只是旧格式。这是本项目反复记的「读不到 ≠ 不存在」的镜像错误。
- **建议**：删掉宽松解析器，`readLedgerUnits` 改调 `parseUnitsToml` 并把异常作为 `index-malformed`/`index-legacy` 向上抛（`/stages` 已经是这个口径）；`/ledger-resource` 需要新增 `index-legacy` / `index-malformed` 两个 reason，⛔ 不能继续用 `not-found`。
### L-05【high】投影「整场事务」不成立：`create-unit` 已落盘、`transition-unit` 失败后**无回滚**，且重入时幂等键把整条投影判成「已完成」

- **位置**：`src/server/projection-writer.ts:218-281`（逐条执行，任一失败即 `return {ok:false, applied, …}`）+ `src/server/ledger-projection.ts:283-284`（幂等判据）
- **证据**（附录 A-7，用真实 `applyProjection`）：
  1. 造一个「分片是软链」的账本（写侧必拒），派发一次：
     `{"ok":false,"applied":1,"reason":"更新 TSK-001 失败：symlink（…write_hob 不跟随软链。）","files":["ledger/units/unit-projection.toml"]}`
     盘上 `unit-projection.toml` 里**确实留下了 `RUN-001`**，而 `TSK-001.status` 仍是 `todo`、`run_ids` 也没写。
  2. 同一事实**再投一次**：`{"ok":false,"applied":0,"reason":"未落账：同一派发已投影为 RUN-001 ⇒ 不重复建"}`
     ⇒ 重试**不会**补上失败的 `transition`，因为幂等键命中的是**第一步已落盘的 RUN**。
- **影响**：
  1. **半完成态永久固化**：账本里 `RUN-001 = registered`、`TSK-001 = todo`、`TSK.run_ids` 为空。而 `returnOps` 找 RUN 的兜底是 `runs.filter(registered|running).sort(id)[0]`（`ledger-projection.ts:403`），会在后续回传时**抓到这条孤儿 RUN** 并把它标成 `returned` —— 一条从未真正执行过的 RUN 被记成执行完毕。
  2. `dispatchOps` 的幂等分支（`:308-310`「已有未回传的 RUN ⇒ 不重复建」）让**后续所有派发**都 `skipped`：探针 A-8 里，只要账本里有一条 `registered` 的 RUN 挂在 TSK 上（哪怕是半完成态留下的），第二次、第三次派发全部 `{"ok":false,"reason":"未落账：task TSK-001 已有未回传的 RUN ⇒ 不重复建"}` ⇒ 该任务**再也派不出去**，除非有人手工改账本。
  3. 失败确实被回带（`ok:false` + `reason`）并被 `orchestrator` 记进 `w.ledgerProjection` 渲染出来（`orchestrator.ts:10008-10018`）——**这一点是好的**；但**回滚与重试语义缺失**，读数说「失败了」却不说「账本现在是半截的、且重试不会修」。
- **建议**：把 `ProjectionOp[]` 做成可回滚事务（失败时按 `files` + 备份反向恢复，`writeHobFile` 已自带备份）；或至少把「半完成」写进返回值（`partial: {created:['RUN-001'], failed:'transition TSK-001'}`）并在状态行点名「需人工修账」；幂等判据应从「`projection_key` 命中」升级为「`projection_key` 命中的**那组 op 全部 applied**」。

### L-06【high】分片改写 `removeUnitBlock` 会**把目标单元的非 id 字段留成孤儿**，写回后变成一条新的空单元

- **位置**：`src/server/projection-writer.ts:130-150`（`removeUnitBlock`）+ `:265-271`（`without` + `renderUnit(next)` 拼接）
- **证据**（附录 A-9，直接跑真实 `applyProjection`，分片里 `id` 不是首键）：

  改前分片：
  ```
  [[unit]]
  title = "任务一（id 写在第二行）"
  id = "TSK-001"
  kind = "task"
  status = "todo"
  …
  ```
  改后分片：
  ```
  [[unit]]
  title = "任务一（id 写在第二行）"          ← 孤儿

  [[unit]]
  title = "任务一（id 写在第二行）"          ← 孤儿（再跑一次又多一条）

  [[unit]]
  id = "TSK-001"
  kind = "task"
  status = "doing"
  …
  ```
  返回 `{"ok":true,"applied":3}`（**一切正常**）。
- **机理**：`removeUnitBlock` 只在遇到 `id = ` 行时才进入 `skipping`（`:138-145`），并回退紧邻的 `[[unit]]` 行；`id` **之前**的行已被 push 进 `out`，且 `[[unit]]` 已被 `:142` 的 `while` 弹出 ⇒ 留下无 `id` 的裸块。解析器（`parseUnitsToml`）照样把它算作一条单元。
- **影响**：
  1. 账本里长出 `id = ''` 的单元。`unitShapeProblems` 只在传 `seenIds` 时判「缺稳定 id」（`ledger-validation.ts:43-47`），而 `hob-write.ts:1058` **确实传了** `seenIds`，所以**下一次任意写入都会被拒**；但 `projection-writer` 自己传 `validateLedgerStructure:false`（`:272`），**它写坏的那一次不会被自己拦下**。
  2. 每次投影迁移都会**再复制一份**孤儿块（探针里一次多 1 条）。
  3. 与 L-05 叠加：一个健康的任务只要被投影迁移过一次，账本就开始累积垃圾，且后续所有写入被自己制造的垃圾拦死。
- **建议**：`removeUnitBlock` 改成**块级**处理——先按 `[[unit]]` 切块，解析每块的 `id`，整块丢弃目标块；或直接「重写整个分片」而不是「删段+拼接」。

### L-07【high】`hob_pipeline_approve` 的 `validateLedgerStructure:false` 豁免**不必要且不充分**；批准回执的校验可以被 `write_hob` 完全绕过

> 本节即 captain 转来的 pipeline-auditor 交叉确认项 (c)。

- **全仓 `validateLedgerStructure:false` 完整清单**（`grep -rn validateLedgerStructure src/ scripts/`，附录 A-10）：

  | # | 位置 | 写什么 | 理由（代码自陈） | 我的判定 |
  |---|---|---|---|---|
  | 1 | `src/server/projection-writer.ts:162` | 新 RUN/ACC/VER/CLS → `unit-projection.toml`（append） | `:47-52`「纯函数刚校验过自己的操作；账本里可能还留着历史缺口」 | **不必要**：见下 |
  | 2 | `src/server/projection-writer.ts:272` | 迁移原分片（overwrite） | 同上 | **不必要**，且是 L-06 的放大器 |
  | 3 | `src/modules/tools.ts:1929` | `hob_ledger_migrate` 重写 `index.toml` | `:1925-1928`「迁移前这本账按定义还不合法」 | **必要**（它做的就是「把坏行改成好行」） |
  | 4 | `src/modules/tools.ts:2107` | `hob_pipeline_approve` 写 `unit-pipeline-approval.toml`（decision） | `:2102-2106`「Approval units are valid v2 decisions even when other legacy rows in the ledger are not yet migrated」 | **不必要**：见下 |

- **第 4 处（批准）豁免不必要**：
  - `decision` 的结构与封闭契约**完全兼容**——`UNIT_STATUSES.decision = ['active','superseded']`（`ledger-validation.ts:24`），而该工具写的正是 `status = "active"`（`tools.ts:2072`）。
  - 探针 A-11：一本**健康**账本（只有一条 draft `R-001`）上，同一份 decision 内容走统一校验 ⇒ `{"ok":true}`。即「decision 单元在健康账本上根本不需要豁免」。
  - 豁免真正放过的只有一件事：**跳过「合并后全账本」的其余缺口**。而这恰恰是它想达到的效果（别让历史坏行拦住批准）——但代价是**它自己写坏也不会被发现**：探针 A-12 里 `status="settled"` 的非法 decision 在豁免下 `{"ok":true}`，随后 readiness 立刻报 `S-0:DEC-001`。同一份内容走统一校验则 `{"ok":false,"reason":"ledger-structure-invalid"}`。
  - **结论**：豁免的**目的**（不因历史缺口而写不进批准）是正当的，但**手段**（关掉整条校验）过宽。正确做法是把校验拆成「**本次写入新增/改动的行**必须合法」+「既有行缺口只报不拦」两档——代码注释 `hob-write.ts:1019-1020` 已经写着这个意图（「只拒绝"这次新写入了另一处非法结构"」），但实现没有这么做（`hob-write.ts:1058` 对 `merged` **整体**跑 `unitShapeProblems`）。

- **P-05 路径可达性确认：真实可达，属于「守卫可绕过」**：
  - **谁有权限**：`write_hob` 就在 `PERMISSION_TIERS.ledger` 里（`src/preset/tools.ts:1211-1213`，档1 = `MODEL_TOOL_ALLOWLIST`，注释 `:971` 明写「本插件 2（`read_contracts` / `write_hob`）」）⇒ **最低档就能写账本**，不需要任何提权。
  - **写到哪**：`ledger/units/<任意名>.toml` 落在 `LEDGER_PATH_RE`（`hob-write.ts:163`）白名单内，`unit-approval.toml` / `unit-pipeline-approval.toml` 都能写。
  - **探针 A-13 端到端**：空账本 → 写 `R-001`（`ok:true`）→ 用 `clarify_legacy=pre-control` + `created_at=2026-01-01` 把 req 改成 `agreed`（`ok:true`，见 L-08）→ `write_hob` 直接写一份 `source="继续"` 的 `DEC-001`（`ok:true`）→
    `approvalStateOf(R-001, units)` = `{"state":"approved","approvalId":"DEC-001","revision":1,"reason":"用户已批准当前修订"}`
  - 即：**`hob_pipeline_approve` 的三道校验（`revisionOf` 比对 `tools.ts:2031-2039`、回执正则 `:2051-2059`、`approvalStateOf` `:2059-2062`）在 `write_hob` 路径上全部不存在**。`pipelineWriteProblems` 只核 `decision` 的**形状**（`pipeline.ts:415-440`：`artifact_revision` 是正整数、`artifact_digest` 非空、`decided_by='user'`、`source` 非空），**不核 source 内容是否真的是一句用户回执**——探针里 `source="继续"` 通过了。`approvalStateOf` 也只比对 `artifact_digest`（`pipeline.ts:365`），而 digest 是 **FNV-1a 双 32 位**（`pipeline.ts:199-210`，注释自陈「integrity fingerprint, not a password hash」）⇒ **任何人写这份 decision 都能算出正确的 digest**。
  - **判定**：这是「守卫可绕过」，等级 **high**。它不是「模型会不小心做」，而是「**唯一的批准语义只存在于一个工具的入参校验里，而同一份数据可以用更通用的写入工具直接落盘**」。同一事实两个写入口、只有一个入口有校验，正是本项目明令要治的形态。
  - **建议**：[建议决策] 批准单元是否只允许由 `hob_pipeline_approve` 写 | 选项：A) 在 `hob-write.ts` 白名单层把 `unit-pipeline-approval.toml` 设为**仅该工具可写**（该路径从 `LEDGER_PATH_RE` 排除，改由专用函数写）；B) 保持现状，改为在门禁侧核 `source` 必须匹配 `approvalReceiptPattern`（`pipeline.ts:398-403`）| 推荐：**A** 理由：门禁侧补正则只是把同一个判据抄第二份（P-04 同类病），而 A 让「批准」这件事只有一条写入路径。

### L-08【high】`clarify_legacy='pre-control'` 是**单元自填字段**，新单元可以给自己发历史豁免，一次性跳过 11 类字段门禁（交叉引用 pipeline-auditor 的 P-04）

> 本节即 captain 转来的交叉确认项（P-04 的账本层判定）。

- **判定依据**：`src/shared/stage-controls.ts:271` —— `const legacy = (u) => txt(u.clarify_legacy) === 'pre-control'`。**只看单元自己的字段，不看任何外部事实**。
- **豁免面（12 处 `legacy(u)`，附录 A-14）**：`:290`(C-1..C-4 需求契约)、`:329`(方案契约)、`:422`(任务字段)、`:443`(任务字段全量)、`:521`(验收契约)、`:613`(执行记录)、`:630`(技术验证)、`:702`(交付收口)、`:779`(标题诊断)、`:831`(证据契约)、`:932`(闭环 L-1..L-4 整体 `continue`)、`:953`(L-2 历史直挂 req)。
- **唯一的反制**：`legacyMisuse`（`:275-287`）—— 要求 `created_at` 存在且 `created_at.slice(0,10) < '2026-11-06'`，否则报 `C-11`。
- **探针 A-15（关键）**：
  - 新写 `TSK-900`（`status=built`、`parent=CHG-404` 不存在、**除 v3 标记外一个字段都不填**），带 `clarify_legacy=pre-control` + `created_at=2026-01-01` ⇒ **`{"ok":true}`**，写入成功。
  - 同一单元**去掉** `clarify_legacy` ⇒ `{"ok":false,"reason":"ledger-structure-invalid"}`，报 6 条缺口（C-5×4 + RP-4 + L-2）。
  - `stageControlProblems(sneaky)` = `[]`、`ledgerClosureProblems(sneaky)` = `[]` ⇒ 这道门禁对它是**完全透明**的。
  - `legacyMisuse(sneaky)` = `[]`（因为 `created_at` 早于 cutoff）；把 `created_at` 改成 `2026-11-07` 才报 `C-11`。
- **影响**：
  1. **`created_at` 也是自填字段** ⇒ `C-11` 只是把「填一个字段」升级成「填两个字段」，**不是**不可伪造的证明。真正的不可伪造事实是 `git log` / 文件 mtime / 账本 `generation`，代码一个都没用。
  2. 一个 `legacy` 标记同时关掉**字段门禁（11 类）+ 闭环门禁（L-1..L-4）**：一条 `pre-control` 的 task 可以挂在**不存在的 change** 下、没有任何 `task_brief`/`counterexamples`/`stop_conditions`/`return_to`/`task_risk`，写前校验与 readiness 都放行。
  3. 与 L-07 叠加后完整攻击链：伪造 legacy 标记 → 把 req 改成 `agreed`（跳过 C-1..C-4）→ 伪造 `DEC-001`（`source="继续"`）→ `approvalStateOf = approved`。**全程只用档1 就有的 `write_hob`**。
- **建议**：`legacy` 判据改用**不可自填**的事实（账本 `ledger.toml` 的 `created_at` / `generation`，或单元在 `unit-01..unit-06` 这类历史分片里），并把 `clarify_legacy` 降级为「展示用标记」；`C-11` 保留但不再是唯一防线。

### L-09【medium】`ledger.toml` 走白名单直通，**没有任何格式校验**；写坏它会把整本账判成 `invalid`

- **位置**：`src/server/hob-write.ts:767`（`if (file === 'ledger.toml' || file === 'ledger.templates.toml') return null`）+ `:799-801`（同一豁免的第二份）+ `:1505-1506`（扩展名放行）。`checkLedgerUnitWrite` 只处理 `ledger/units/*.toml`（`:1028`），`checkFormat` 只处理 `REQUIREMENTS.md`/`DECISIONS.md`（`:982-1002`）。
- **证据**（附录 A-16）：`write_hob('ledger.toml', 'this is not a valid activation record')` ⇒ `{"ok":true}`；随后 `ledgerLifecycleOfRoot` ⇒ `{"state":"invalid","integrity":"invalid","active":false,"activation":"invalid","headline":"账本激活记录格式不合法"}`。
- **影响**：激活记录是**账本能否使用**的总开关（`ledger-lifecycle.ts:113-129`）。`write_hob` 的语义是「如实写」，但这里缺的是「至少是合法激活记录」这一档最小形状校验——而同一文件里的 `REQUIREMENTS.md` 恰恰**有**形状校验（`hob-write.ts:982-997`）。两条相邻规则一严一宽，没有理由。
- **建议**：为 `ledger.toml` / `ledger.templates.toml` 加 `parseLedgerActivation`（`ledger-lifecycle.ts:70-94` 已有现成纯函数）校验，不合法则 `bad-format` 拒绝；或在白名单里改为只允许 `hob_ledger_init` 内部写。

### L-10【medium】白名单允许 `ledger/units/` 下的**任意子路径**，写进去的单元所有读取面都看不见

- **位置**：`src/server/hob-write.ts:163`（`^ledger/(units|spec|changes)/[A-Za-z0-9._/-]+$` 允许 `/`）+ `:814-821`（只额外挡 `..` 与 `//`）；读取面过滤：`^unit-[^/]+\.toml$`（`projection-writer.ts:104`、`tools.ts:216`、`stages-index.ts:445`、`ledger-readiness.ts:445`、`hob-write.ts:1047`）
- **证据**（附录 A-17，全部 `{"ok":true}` 写入成功）：

  | 写入路径 | 写入结果 | `readProjectionUnits` | `readLedgerUnits` |
  |---|---|---|---|
  | `ledger/units/sub/unit-x.toml` | ok | 看不见 | 看不见 |
  | `ledger/units/projection.toml`（不以 `unit-` 开头） | ok | 看不见 | 看不见 |
  | `ledger/units/UNIT-01.toml`（大写） | ok | 看不见 | 看不见 |
  | `ledger/units/unit-01.toml`（对照） | ok | 看得见 | 看得见 |

- **影响**：
  1. 写成功、**所有读面都不报**——账本里存在一条「幽灵单元」。这正是「静默吞错」的另一种形态：不是吞掉异常，而是**吞掉整条数据**。
  2. 反过来：`checkLedgerUnitWrite` 的 `merged`（`hob-write.ts:1052-1056`）也只合并 `^unit-.*` 的分片 ⇒ 幽灵单元**连写前校验都不参与**，不会与真实单元撞 ID。
  3. `hob_ledger_migrate` 只重写 `index.toml`（`tools.ts:1861`），幽灵单元永远留在盘上。
- **建议**：白名单把 `ledger/units/` 收窄成「只允许单段 `unit-*.toml` 与 `index.toml`」；或在 `hob-write.ts` 里加一条 `isReadableLedgerUnitPath` 与读取面的过滤正则**同源**（当前是两处各写一份正则，又是一处双实现）。

### L-11【medium】`requirement-chains-route` 是**第三份**读盘实现，与另外两份的失败语义不同

- **位置**：`src/modules/requirement-chains-route.ts:41-135`（自建 `readUnitsOfLedger`）vs `src/shared/stages-index.ts:691-798`（`handleStages`）vs `src/modules/tools.ts:213-220`（`readLedgerUnits`）
- **证据**：
  - 三处都按 `index.toml` + `unit-*.toml` 合并，但：`stages-route` 走严格解析器 + `shapeProblemsOf` 形态核；`ledger-resource-route` 走宽松解析器 + 无形态核；`requirement-chains-route` 走严格解析器 + **无形态核**（`:110-134` 只捕获解析异常）。
  - 三者对「`index.toml` 不存在」的 reason 也不同：`STAGES_REASON_LEDGER_MISSING`（`stages-index.ts:745-749`、`requirement-chains-route.ts:83-90`）vs `index-unreadable`（`ledger-resource-route.ts:97` 直接 `not-found`）。
- **影响**：同一本账，面板三个接口给出三种「能不能读」的结论；形态非法的单元在 `/requirement-chains` 上会被 `buildRequirementChains` 当作正常单元处理（它不做 kind/status 核）。
- **建议**：三处统一走 `parseUnitsToml` + `unitShapeProblems`，把「读 + 核」做成一个共享函数（`stages-index.ts` 已有 `handleStages` 的完整逻辑，可抽出 `readLedgerUnitsStrict`）。

### L-12【medium】账本根按「目录名」派生的兼容档，在隔离 worktree 里会指向**不存在的另一本账**

- **位置**：`src/server/doc-read.ts:95-147`（`resolveLedgerRoot`）+ `:220-245`（`workspaceNameOf` 的 fallback `basename(ws)`）
- **证据**（附录 A-18）：
  - `resolveLedgerRoot('', '/home/lk/.dsh/hob-ledgers', '/home/lk/FF/dsh-hob/.dsh-worktrees/t-mvcz497n-kn8juw')` ⇒ `"/home/lk/.dsh/hob-ledgers/t-mvcz497n-kn8juw"`
  - 主工作区 ⇒ `"/home/lk/.dsh/hob-ledgers/dsh-hob"`
  - 该 worktree 下**确实没有** `dsh-hob.workspace.json`（实测 `ls`：`(no workspace.json)`），而同目录下另外几个 worktree 有 ⇒ 一旦某张卡的分支早于 `783b3c9`（引入 workspace.json 的那个提交），它就会派生到 `<ledgerHome>/<卡 id>/`。
- **影响**：`doc-read.ts:71-79` 的注释**自己写明了这个风险**（「隔离 worktree 里目录名 = 卡 id ⇒ 读写到一个不该存在的账本区」），但**兜底行为仍是静默 fallback**（`:227,234,240,243` 四处 `return fallback`）。后果：账本根**存在但为空** ⇒ readiness = `missing` ⇒ `hob_ledger_init` 会在那里**新建一本空账**，而真正的账在 `dsh-hob/` 下。这是本项目反复记的「两份账各自漂」。
- **建议**：`workspaceNameOf` 在「配置文件不存在」时**不要静默 fallback**——至少返回 `{name, source:'fallback'}`，由 `resolveLedgerRoot` 在 worktree 形态下（路径含 `.dsh-worktrees`）**fail-closed** 并要求显式 `ledgerRoot`；`ledgerRootWhy` 增加 `kind:'name-fallback'` 一档。

### L-13【medium】`ledgers-route` 用**行计数**冒充单元数，`legacyUnits` 由「行数差」推出，与真实单元数不是同一件事

- **位置**：`src/modules/ledgers-route.ts:86-116`
- **证据**：`units` = `line.trim() === '[[unit]]'` 的行数（`:88-91`）；`v3Units` = 文本里匹配 `^\s*pipeline_version\s*=\s*"v3"\s*$` 的行数（`:104-107`）；`legacyUnits = Math.max(0, units - v3Units)`（`:109`）。
- **影响**：
  1. 这两个计数**不是同一层级**：`units` 数的是单元头，`v3Units` 数的是**任意位置**的字段行（包括一条单元里出现两次的情况）。一条单元里出现两行 `pipeline_version` ⇒ `legacyUnits` 被算成负数再夹到 0。
  2. `health` 三档由 `v3Units > 0` 决定（`:113`）：一本 **100 条单元里只有 1 条 v3** 的账会被标成 `current`，而不是 `outdated`。
  3. 与 `ledger-readiness` / `stages-index` 的「单元」定义（解析后对象）不同 ⇒ 面板项目列表显示的单元数与点进去看到的条数可以不一致。
- **建议**：改用 `parseUnitsToml` + `isPipelineV3`（`pipeline.ts` 已有）逐单元判定；读不动就 `unreadable`（这条已做对，`:92-95`）。

### L-14【low】`indexIntegrityProblems`（A-4）只在 `activation.status === 'active'` 时生效 ⇒ 现行实例（无 `ledger.toml`）永远不核

- **位置**：`src/modules/tools.ts:785`（`if (lifecycle.active && lifecycle.activation === 'active' && …)`）+ `src/shared/ledger-lifecycle.ts:203`（无 `ledger.toml` 时 `activation: 'missing'`）
- **证据**（附录 A-19）：`/home/lk/.dsh/hob-ledgers/dsh-hob` 的 lifecycle = `{"state":"active","integrity":"valid","active":true,"activation":"missing","headline":"账本就绪（兼容模式：尚无 ledger.toml）"}` ⇒ 一致性核（A-4）**不跑**。
- **影响**：`index.toml` 与 `unit-*.toml` 出现同 ID 不同状态时，唯一的检测器（`indexIntegrityProblems`，`ledger-lifecycle.ts:269-297`）在本机现行账本上处于关闭状态。而 `index.toml` 在现行实例里**已经是纯注释导航**（实测 `grep -c '^\[\[unit\]\]'` = 0），所以 A-4 实际上长期是死判据。
- **建议**：让 A-4 在 `legacyCompatible` 账本上也跑（无 index 单元时天然通过，代价为零）；或明确登记「A-4 只服务于双写过渡期」并从 headline 里去掉「结构有效」的暗示。

### L-15【low】`hob-render` 的 `count` 渲染会把目录里的符号链接算进条目数

- **位置**：`src/server/hob-render.ts:376-385`（`count` 用 `readdirSync(abs).length`）
- **证据**：`decideOne` 对**目标本身**做了软链检查（`:356-363`），但对**目录内容**没有；`readdirSync` 会把软链、隐藏文件一并计入。
- **影响**：`<!-- hob:count | some/dir -->` 渲染出的数字可能大于「真实条目数」，而本机制的立身之本正是「值是当场实测、不是手抄」（`:1-45`）。等级 low：这是读数口径的瑕疵，不是安全面。
- **建议**：改用 `readdirSync(abs,{withFileTypes:true}).filter(e => !e.isSymbolicLink()).length`，或把口径写进 `renderReadingsNote` 的输出。

### L-16【low】`removeUnitBlock` 的 `replace(/\n{3,}/g,'\n\n')` 会改写**未涉及单元**的原始空行布局

- **位置**：`src/server/projection-writer.ts:149`
- **证据**：整份分片被 `.replace(/\n{3,}/g, '\n\n')` 压缩后再写回（`:266-267`）。附录 A-9 的探针输出里，原本 `[[unit]]` 后的空行被吞掉。
- **影响**：`writeHobFile` 的缩水守卫（`hob-write.ts:1648`）与幂等比对（`:1658`）都按字节判；这种「顺手格式化」会让**下一次**对同一分片的写入多出一次无谓备份，并让 `bytesBefore/bytesAfter` 读数失真。等级 low（不影响语义）。
- **建议**：删掉这行 replace，只做 `trimEnd() + '\n'`。

### L-17【low】`policy-record-state.ts` 的 `okState` 与 `badRequest` 在 `state` 字段上不对称，`blocked`/`clear` 两值没有对应的构造器

- **位置**：`src/shared/policy-record-state.ts:45`（`PolicyRecordWireState` 六值）+ `:147-158`（`okState` 接受全部六值）+ `:168-170`（`badRequest` 不带 `state`）
- **证据**：类型允许 `'blocked'`/`'clear'` 经 `okState` 出门，但 `classifyPolicyRecord`（`:118-123`）**永远不会返回这两个值**（它只回四态）。两个新值的产生点在本文件之外，且没有 `classifyXxx` 与之配对。
- **影响**：这是「同一字段承载两条轴」（注释 `:41-43` 自陈）留下的口子：调用方拿到 `state='blocked'` 时无法从本模块得知「这是读轴还是写轴」。等级 low（当前两值由调用方显式构造，未发现误用）。
- **建议**：拆成两个字段或两个构造器（`okReadState` / `okBlockedState`），让「哪条轴」在类型上就分开。

### L-18【low】`readProjectionUnits` 用同步 `readFileSync` 读**全部**分片，且读失败直接抛（无三态）

- **位置**：`src/server/projection-writer.ts:100-112`
- **证据**：`:108` `const text = readFileSync(join(dir, name), 'utf8')` 没有 try/catch；`parseUnitsToml` 抛错也不捕获（`:109`）。对比 `hob-write.ts:573-602` 的三态 `TargetRead`（读不出来 ≠ 不存在）。
- **影响**：任一分片读失败/格式坏 ⇒ `applyProjection` 整体抛错，被调用方 catch 成「投影抛错：…」（`orchestrator.ts:5408-5411`）。失败**是可见的**（这点没问题），但原因被压成一句话，且**整场投影放弃**——即使其它分片完好、本可以落账。等级 low。
- **建议**：复用 `TargetRead` 三态；单分片坏时按 `undecidable` 返回并点名分片，而不是整体抛。

---

## ⑤ 与其他域的边界与疑点（含我无法单独判断的）

1. **与 pipeline-auditor（t1）的交叉确认**：
   - 其 P-04（legacy/pre-control 让 v3 条目跳过 11 类字段门禁）**在账本层确认成立**，且我进一步确认它是**自填字段自证**（本报告 L-08），并给出了完整攻击链（L-08 + L-07）。
   - 其 P-05（直接写 decision 绕过 `hob_pipeline_approve` 回执校验）**路径真实可达**（L-07），且我补上了「为什么可达」：`write_hob` 在档1（`PERMISSION_TIERS.ledger`）就有，`ledger/units/*.toml` 在白名单内，digest 是可自行计算的 FNV 指纹。
   - 其「全仓唯一 `validateLedgerStructure:false`」说法**不成立**：实际有 **4 处**（本报告 L-07 表格）。其中 `projection-writer.ts` 的两处**不必要**、`hob_pipeline_approve` 的那处**不必要**，只有 `hob_ledger_migrate` 的那处**必要**。

2. **与 orchestrator 域的边界（我无法单独判断）**：
   - 投影失败后，编排器**只把失败写进 `w.ledgerProjection` 并在状态行渲染**（`orchestrator.ts:10008-10018`）。这个渲染是否**每次** `hob_orch_status` 都会带出来、还是会随 watch 结算被清掉，取决于 `flushWatches` / watch 生命周期——**不在本域范围，未验证**。若会被清掉，则 L-05 的「半完成账本」最终对用户不可见。
   - `w.ledgerProjection` 的类型（`orchestrator.ts:807`）只保留 `{ok, applied, reason}`，**丢掉了 `ProjectionApplyResult.files`**（`projection-writer.ts:96`）⇒ 即使渲染出来，也说不清「改了哪几个分片」。这是可观测性缺口，建议转给主链域。

3. **与「策略/客户端」域的边界**：
   - `policy-record-state.ts` 的六值线格式（L-17）会被客户端 `hob-unselected-gate.tsx` 消费；**客户端如何渲染 `blocked`/`clear` 我未验证**（不在本域范围）。
   - `item-presentation.ts` 的 `flagsOf`（`:366-534`）里有大量「为历史数据特判」的白名单扩展（`:418-517` 约 10 段）。这些特判**只影响展示、不影响门禁**，但它们的存在说明账本里有相当比例的单元其正式关系无法从字段直接判定——**这是否意味着账本的「关系」字段本身不够用，需要问需求/方案域**，我无法单独判断。

4. **`admitWork` 的实际接线缺口（需主链域确认）**：
   - `ledger-lifecycle.ts:324-416` 自称「唯一的工作准入表」，但全仓只有 `bus.ts:1932`（`notify`）调用它；`dispatch`/`write-*`/`verify`/`accept`/`close` 六行**没有运行时调用方**（附录 A-2）。
   - 实际拦派活的是 `dispatchGateAtLedger`（`tools.ts:812-…`），它**不经过** `admitWork`。⇒ 这张表目前是**文档性契约**，不是强制契约。**是否算缺陷取决于团队对「唯一表」的定位**——我倾向记为 medium，但因跨域（编排）暂列此处，不占本域缺陷编号。

5. **`ledgerHome` 缺省为空**（`src/modules/tools.ts:408` `ledgerHome: ''`）：
   - 一旦预设行没配 `ledgerHome`，`resolveLedgerRoot` 返回 `undefined` ⇒ `ledgerRootOf` 返回 `undefined` ⇒ `write_hob` 直接 `no-ledger-root`（`tools.ts:1621-1623`）。**行为是 fail-closed 的（正确）**，但现行实例靠 `preset/dsh-hob/preset-dsh-hob.patch.yml:913` 的硬编码绝对路径 `/home/lk/.dsh/hob-ledgers` 撑着——**换机器必须改这一行**，而 `doc-read.ts:80-84` 的注释明说「硬编码会把插件绑死在本机路径上」是**已被否掉**的做法。这条属于配置/部署域，我在此登记为疑点。

---

## 附录 A · 探针清单（全部在 `/tmp`，只读仓库、不写 lib/）

| 编号 | 目的 | 命令 | 关键输出 |
|---|---|---|---|
| A-1 | 三份状态表逐值比对 | `node /tmp/cmp.mjs` | 12 kind，`UNIT_STATUSES`/`STAGE_KIND_STATUSES`/`KIND_SPEC` 全等，0 处 DIFF |
| A-2 | `admitWork` 调用方 | `grep -rn "admitWork\|WORK_ACTIONS" src/` | 仅 `src/modules/bus.ts:1932`；`WORK_ACTIONS` 只有定义处 |
| A-3 | `index.toml` 重复计入 | `node /tmp/probe4.mjs` | 1) index 已有 1 条 → append 合法 decision：`ledger-duplicate-id`；2) index 为空 → `ok:true` |
| A-4 | 四出口结论不一致 | `node /tmp/probe22.mjs` | readiness `unhealthy/1`；`stageGateOfLedger` `undefined`；`stageHealthOfLedger` `{ok:true,blockers:[]}`；`/stages.stageHealth` `{ok:false,count:1}` |
| A-5 | 两份解析器分叉 | `node /tmp/probe2.mjs` | 4 组输入：严格全 THROW，宽松全返回单元 |
| A-6 | 旧格式账本在 `/ledger-resource` 的表现 | `node /tmp/probe13.mjs` §2 | `readLedgerUnits = []`；`readLedgerResource('requirement/R-001') = {reason:'not-found'}` |
| A-7 | 投影半完成 + 重入 | `node /tmp/probe5.mjs` | 首次 `{ok:false, applied:1, reason:'更新 TSK-001 失败：symlink…'}`，盘上留有 `RUN-001`；重入 `{ok:false, applied:0, reason:'同一派发已投影为 RUN-001 ⇒ 不重复建'}` |
| A-8 | 半完成态卡死后续派发 | `node /tmp/probe6.mjs` | 派发B / 半完成后再派发 均 `{ok:false, reason:'task TSK-001 已有未回传的 RUN ⇒ 不重复建'}` |
| A-9 | `removeUnitBlock` 孤儿块 | `node /tmp/probe20.mjs` §A | 投影 `{ok:true, applied:3}`；分片里出现 2 条只有 `title` 的裸块 |
| A-10 | `validateLedgerStructure` 全量清单 | `grep -rn validateLedgerStructure src/ scripts/` | 4 个 `:false` 调用点：`projection-writer.ts:162,272`；`tools.ts:1929,2107` |
| A-11 | 健康账本上批准单元不需要豁免 | `node /tmp/probe18.mjs` | `write_hob` 写 decision：`{ok:true}`（统一校验） |
| A-12 | 豁免放过非法 decision | `node /tmp/probe23.mjs` | 统一校验 `ledger-structure-invalid`；豁免 `{ok:true}`；随后 readiness `S-0:DEC-001` |
| A-13 | 伪造批准端到端 | `node /tmp/probe19.mjs` | 写 req `ok` → legacy 改成 agreed `ok` → 写 `source="继续"` 的 DEC-001 `ok` → `approvalStateOf = {"state":"approved"}` |
| A-14 | `legacy(u)` 豁免面 | `grep -n "legacy(u)" src/shared/stage-controls.ts` | 12 处（`:290,329,422,443,521,613,630,702,779,831,932,953`） |
| A-15 | 自填豁免完全透明 | `node /tmp/probe9.mjs` | 带 `clarify_legacy+created_at` ⇒ `{ok:true}`；不带 ⇒ 6 条缺口；`stageControlProblems/ledgerClosureProblems` 均 `[]` |
| A-16 | `ledger.toml` 无格式校验 | `node /tmp/probe20.mjs` §B | `write_hob` `{ok:true}`；随后 lifecycle `state:invalid` |
| A-17 | 幽灵单元路径 | `node /tmp/probe11.mjs` | `sub/unit-x.toml` / `projection.toml` / `UNIT-01.toml` 全 `ok:true` 且两套读取面都看不见；`unit-01.toml` 看得见 |
| A-18 | worktree 账本根派生 | `node /tmp/probe13.mjs` §3 | worktree → `/home/lk/.dsh/hob-ledgers/t-mvcz497n-kn8juw`；主工作区 → `…/dsh-hob`；该 worktree 无 `dsh-hob.workspace.json` |
| A-19 | 现行实例的 activation | `node /tmp/probe15.mjs` | `dsh-hob`：`state:active, activation:missing, integrity:valid` ⇒ A-4 不跑 |
| A-20 | 修复写死锁 | `node /tmp/probe16.mjs` | 只修 TSK-001 ⇒ `ledger-structure-invalid`（因 TSK-002 与 TSK-001 的 L-2 仍在） |

### 复现说明

所有探针都用 `node <file>` 直接跑（Node v24.22.2，原生 TS strip-types），
import 的是 `/home/lk/FF/dsh-hob/src/**` 的**真源码**，写入目标是 `mkdtempSync(join(tmpdir(),…))` 的临时目录。
**未修改仓库内任何文件、未跑 `npm run build`、未写 `lib/`。**
