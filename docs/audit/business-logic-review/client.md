# 客户端与视图域 · 业务逻辑审查（只读）

> 审查对象：`src/client/**`（14 个文件，约 10.5k 行）。
> 方法：只读读码 + 精确 grep 计数 + 与 `src/shared/**` 权威视图逐字段对照；**未运行任何写仓库的命令**（未跑 `npm run build`，未跑会写 `lib/` 的脚本）。
> 证据形式：`相对路径:行号` + 关键代码片段 / 命令输出。
> 无法在本域内判定的结论一律标「未验证」，不冒充已确认。

---

## ① 本域业务职责

客户端域把**服务端已经算好的账本事实**投影成一块只读的右侧栏面板（七步阶段主线 / 执行态 / 工作计划 / Current / 待确认工具 / 账本健康），外加三个非面板面：设置分区（唯一有写的地方，走宿主 `configForms.mutate`）、新建 Hob 会话弹窗（一次性票据流）、未选档门禁横幅（含 4s 轮询）。它**不拥有任何业务口径**：阶段、门禁、责任方、下一步、健康缺口全部由 `/api/dsh-hob/*` 六条只读路由下发；客户端只允许做**展示映射**与**失败三态化**（读取中 / 有数据 / 判不出）。

---

## ② 主链路：入口 → 状态 → 落盘 → 出口

### 2.1 入口（槽注册，全部在 `apply()` 里）

| 面 | 槽 | 位置 |
|---|---|---|
| 阶段面板类型 | `sidebarRightTabs.register` | `src/client/project-panel.tsx:3314-3346` |
| 面板 body / 标题 | `sidebar.right.pane.tab`(keyed) / `…tab.title` | `src/client/index.ts:325-341` |
| 侧边栏胶囊（预设门禁） | `sidebar.right.tab.guide.entry`(keyed) | `src/client/index.ts:350` + `project-panel.tsx:3271-3302` |
| 新建弹窗 / 命令入口 / 成功结果条 | `shell.overlay`(list × 3) | `src/client/index.ts:164-232` |
| 未选档横幅（3 个实例） | `conversation.hero.options` / `conversation.session.header.actions` / `conversation.input.right` | `src/client/hob-unselected-gate.tsx:771-822` |
| 设置分区 | `settings.section` | `src/client/index.ts:282-291` |

`sessionId` 的来路只有一条：keyed/session 槽的 inject 第一参（`index.ts:334`），面板把它塞进每个请求体（`project-panel.tsx:322, 383, 405-407, 526-529, 557-560, 588, 612`）。缺它服务端 `resolveLedgerRoot` 返回 `undefined` ⇒ 面板只能显示「判不出」。

### 2.2 取数（面板数据全部来自这 6 条路由，无第七处）

| 路由 | 客户端封装 | 服务端 |
|---|---|---|
| `POST /api/dsh-hob/stages` | `defaultFetchStages` `project-panel.tsx:524-548`（固定 `compact:true`） | `src/modules/stages-route.ts:81` → `buildStages` |
| `POST /api/dsh-hob/requirement-chains` | `defaultFetchChains` `:556-578` | `requirement-chains-route.ts:167` |
| `POST /api/dsh-hob/exec-progress` | `defaultFetchExec` `:403-425`（路径取自 `shared/exec-protocol.ts`） | `exec-progress-route.ts` |
| `POST /api/dsh-hob/ledgers` | `defaultFetchLedgers` `:382-401` | `ledgers-route.ts:184` |
| `POST /api/dsh-hob/ledger-resource` | `defaultFetchResource` `:604-619`（`current` 与按 ID 读共用） | `ledger-resource-route.ts:92-116` |
| `POST /api/dsh-hob/work-plans` / `…/unseen-tools` | `project-panel.tsx:955-969`（内联）/ `defaultFetchUnseen` `:587-601` | `work-plans-route.ts:22` / `unseen-tools-route.ts` |
| 实时失效 | `createLiveClient` `src/client/live-client.ts:105-242` → `POST /api/dsh-hob/live` | `src/modules/live-route.ts:72-187` |
| 门禁三态 | `defaultPolicyRecordReader` / `defaultPolicyBlockReader` `hob-unselected-gate.tsx:154-173, 203-220` | `POST /api/dsh-hob/session-policy` |
| 创建会话 | `defaultCall` `create-hob-dialog.tsx:389-427`（按 action 选路由 `:379-381`） | `session-create` / `session-policy` |

### 2.3 状态（六路分治，互不遮蔽）

`ledgerState`(`:907-911`) / `state`(`:979-983`) / `stageState`(`:1064-1068`) / `chainState`(`:1070-1074`) / `execState`(`:1083-1087`) / `unseenState`(`:1095-1099`) / `plansState`(`:1101-1105`)，另有 `selectedLedger`(`:928`) 与 `defaultLedger`/`pickedLedger` 双 state 拆解（`:917-928`，注释 `:1016-1024` 记录「换工作区仍停在上一本账」的旧病）。

默认账本跟随服务端 `current:true`（`:1025-1038`），用户手选优先；目录里消失则清掉选择回落默认（`:1034-1038`）。

### 2.4 落盘（本域唯一的三个写面，且都不在面板里）

1. **设置**：`writeSpawnFields` / `writePermissionLevel` / `writeWorkMode`（`src/client/settings.ts:273-301, 327-353, 405-428`）——全部走宿主 `form.mutate`，且先判 `snapshot.writable === true`，非回环访问一律拒写并给原因。
2. **建会话**：`issue` → `create`（`create-hob-dialog.tsx:651-677`），票据 TTL 2 分钟、消费即删、票据内 sessionId 必须与请求一致（`session-create-channel.ts:71, 257-269, 397-401`）。
3. **给已存在会话写两项**：`action:'write'` → `session-policy`（`create-hob-dialog.tsx:620-643`），该分支**零 create**。

面板本身零写：所有 `fetch` 都是 `POST` 到只读路由（把 POST 当读通道用），`:3106-3110` 的「⚠ 只读：本面板没有任何写操作」与实际一致。

### 2.5 出口（刷新三通道）

```
live 失效帧 ─┐
5s 定时器 ───┼─► pull()  ──► 6 路取数 ──► setState ──► 重渲染
手动「刷新」─┘   (project-panel.tsx:1410-1448)
```

- 节拍随连接态切换：`live` ⇒ 60s 安全轮询；`reconnecting` ⇒ ≤30s；其余 ⇒ 5s（`:1497-1502`，常量在 `shared/live-protocol.ts:22-26`）。
- 标签页不可见 ⇒ 停流 + 停表；可见 ⇒ 立刻 `pull()` 再启流（`:1543-1550`）。
- 卸载清理齐全：`stop()` + `offLiveState()` + `live.stop()`（`:1553-1559`）。
- 实时帧只做失效信号，revision 缺口 / 账本不符 / hello 一律强制全量重读（`live-client.ts:180-205`）。

---

## ③ 契约与不变量清单（**当前代码里真正被强制的**）

| # | 不变量 | 强制点 | 强制方式 |
|---|---|---|---|
| I-1 | 非 Hob 会话零请求 | `project-panel.tsx:899-902, 1001, 1186`；`gate:536, 630` | 取数层早退（不只是渲染层隐藏） |
| I-2 | 每个请求必须带 `sessionId`（可选 `ledger`） | 七个取数函数逐个拼 body | 缺 ⇒ 服务端 `ledger-unreadable` |
| I-3 | 404/405 必须与「读不到」分开 | `StaleRouteError` `:347-351, 389-393, 413-417, 536-540, 566-570, 594-598` | 抛类型化错误，界面按类型分支（`:1194-1200`） |
| I-4 | 任一路失败不遮蔽其他路 | 六个独立 `setXxxState` + `Promise.allSettled` `:1430` | 无共享 fail 态 |
| I-5 | 失败三态必须字面不同 | `STAGES_EMPTY_TEXT`/`STAGES_UNDECIDABLE_TEXT` `:176-177` | 各区块 `data-state` 独立 |
| I-6 | 票据一次性 + TTL + 绑定 sessionId | `session-create-channel.ts:257-269, 397-401` | 先删再判；不一致直接拒 |
| I-7 | 开放档位在**两处**服务端各校验一次 | `session-create-channel.ts:219-221, 412-415` | 与界面置灰无关（置灰不是校验，`create-hob-dialog.tsx:982-987` 自述） |
| I-8 | 已有会话模式零 `issue`/`create` | `create-hob-dialog.tsx:620-643`（分支互斥） | 分支结构，不是运行时判断 |
| I-9 | 取消不得被晚到的成功覆盖 | `abandonedRef` `:475, 601-602, 629, 652, 658` | 每个 await 后核令牌 |
| I-10 | 在飞闸（取消后仍不许再发） | `inFlightRef` `:485-486, 569, 603, 687` | 只有真正结算才放开 |
| I-11 | 会话切换后旧回包不许写 state | gate 令牌 `hob-unselected-gate.tsx:510, 530-539, 570` | 代际比较 |
| I-12 | 同会话只自动弹一次 | `memory.takeAutoOpen` `:257-261, 665` | 原子记号，三个实例共用一份 |
| I-13 | 不可见即停流停表 | `:1491-1493, 1535, 1543-1550` | `tabVisible === false` 早退 |
| I-14 | 账本名白名单，客户端不接受路径 | 服务端 `live-route.ts:91-99`、`ledger-resource-route.ts:76-84` | 客户端只传名字 |
| I-15 | 值必须来自服务枚举（UI 不新增值） | `create-hob-dialog.tsx:743-760, 456-457` | `enums === undefined` ⇒ 禁提交（`:576-579`） |
| I-16 | 状态词只从共享表取 | `execStateLabel` `:433-437`、`stageStatusLabel` `:1744`、`relationLabelOf` `:1735` | 本地不写中文状态词（`:427-432` 自述） |

**没被强制的（声明了但没有判据）**见 ④ 的 C-12、C-13。

---

## ④ 缺陷 / 风险清单

> 排序口径：先「会掩盖其他问题 / 让失败不可观测」，再按严重度。
> 编号是稳定标识、不是排序位：C-19 实际排在 C-05 之后（high 组末尾），编号保留以方便交叉引用。

---

### C-01 · blocker（**未验证**：需宿主侧确认）· 产物仍 require 宿主可能不提供的模块，一旦成立则整个客户端半边不激活

- **位置**：`src/client/atoms.tsx:5-8` vs `tsdown.config.ts:13-17` vs `lib/client.js:28`
- **证据**：
  ```
  atoms.tsx:5-8
    真机实测：宿主浏览器模块表**没有**这个包（它不是 __DSH_BOOT__ 的静态 seed）。
    旧构建把它 external ⇒ 产物里留 require(...) ⇒ factory 在 materialize 时抛
    「missed the module table」⇒ exports 为空、apply 不存在 ⇒ 客户端半边不激活

  tsdown.config.ts:13-17
    ⚠ @deepseek-ai/dsh-client-ui-primitives 是**平台 seed**，必须 external：
      实测浏览器模块表的 seed 含它（__dshSidebarModuleSystem__.seed）

  $ sed -n '28p' lib/client.js
    let __deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
  ```
- **影响**：两处注释对同一事实给出**相反**结论。`atoms.tsx` 因此把两个展示原子本地化，但 `settings-panel.tsx:66-70` 仍 import `Menu / SegmentedControl / 图标` ⇒ 产物第 28 行照样 require。若 atoms 的说法成立，则设置分区、阶段面板、门禁横幅、创建弹窗**全部消失**，且失败点在 factory materialize 阶段，界面上没有任何提示——这是最彻底的一种「失败不可观测」。反之若 tsdown 的说法成立，则 atoms 的本地化是多余动作，无害。
- **判定边界**：本仓内无法裁决——`grep -rn primitives scripts/check-client-deps.mjs scripts/check-build-sync.mjs` **零命中**，即没有任何机检断言这一条。
- **建议**：加一条宿主探针（`scripts/host-probe.mjs` 已有骨架）实读 `__DSH_BOOT__`/`__dshSidebarModuleSystem__.seed` 的键集合，把「primitives 在不在 seed 里」变成可复现读数；在结论出来前，两处注释至少要有一处被标为「未验证」。

---

### C-02 · blocker · 一次挂起的 HTTP 会让面板**永久停止刷新**，且没有任何错误状态

- **位置**：`src/client/project-panel.tsx:1407-1445`（`pulling` 闸）+ 六个取数函数**全都没有超时**：`:323, 384, 408, 531, 561, 589, 608`
- **证据**：
  ```ts
  1407|    let pulling = false
  1408|    let pullAgain = false
  1409|    let followUpsLeft = LIVE_MAX_FOLLOW_UP_PULLS
  1410|    const pull = (runStagesAgain = true): void => {
  1411|      if (pulling) {
  1412|        /** A change landed mid-pull; coalesce it into one queued follow-up. */
  1413|        if (followUpsLeft > 0) { pullAgain = true; followUpsLeft -= 1 }
  1414|        return
  1415|      }
  1416|      pulling = true
  ...
  1430|      void Promise.allSettled(requests).then(() => { pulling = false; ... })
  ```
  对照：`create-hob-dialog.tsx:373, 398-404` 给同一个浏览器的 `fetch` 装了 30s `AbortController`，注释（`:392-397`）明写「必须有超时……否则按钮永远停在『创建中…』」。**面板这 6 条请求没有这层保护**。
- **影响**：只要有一条请求永不回包（服务端卡死 / 代理挂起 / 网络黑洞），`pulling` 永远为 `true`：后续 5s tick 与每一次 live 失效帧都只在 `followUpsLeft` 里排队（上限 3），排完即**静默丢弃**。面板从此定格，徽标仍显示「实时更新已连接（断线自动重连；另有定时兜底）」(`:3100`)——UI 在**声称自己在刷新**。这正好是本域最该先修的一类：让失败不可观测。
- **建议**：给六个取数函数统一加 `AbortController` + 超时（复用 `DEFAULT_CALL_TIMEOUT_MS` 口径），超时落成可读的 `fail` 态；`pulling` 闸加「超过 N 秒强制复位」兜底，并在复位时把该路置为「判不出（上一次取数超时）」。

---

### C-03 · high · 账本健康读数会**假报 0 条 / 少报 N 条**：服务端专门为此给的 `count`、`truncated` 客户端一个都不读

- **位置**：`src/client/project-panel.tsx:2244-2257`；服务端 `src/shared/stages-index.ts:455-462, 602-607`
- **证据**：
  ```ts
  // 客户端（project-panel.tsx）
  2248|    if (health === undefined) return null
  2249|    const problems = Array.isArray(health.problems) ? health.problems : []
  2250|    if (health.ok === true && problems.length === 0) return null
  ...
  2257|        `账本健康：${problems.length} 条缺口（先补齐才能派活）`,

  // 服务端（stages-index.ts）—— 紧凑模式只给前 40 条，count 才是全量
  455|         const cap = opts.compact === true ? 40 : all.length
  457|           stageHealth: { ok: all.length === 0, count: all.length,
  460|             ...(all.length > cap ? { truncated: true } : {}),
  461|             problems: all.slice(0, cap) },

  // 体积兜底时 problems 被**整段丢掉**，只留 count/truncated
  602|      if (out.stageHealth !== undefined) {
  603|        out.stageHealth = { ok: ..., count: out.stageHealth.count,
  605|          ...(out.stageHealth.truncated === true ? { truncated: true } : {}) }
  ```
  面板**固定以 `compact:true` 取数**（`:529`），所以永远走上面这条路径。
- **影响**：两种假读数都会出现：
  1. 缺口 41~300 条 ⇒ 界面写「账本健康：40 条缺口」，且 `:2264-2266` 的「另有 N 条」只减 12，读者永远不知道还有几百条；
  2. 触发体积兜底（problems 被丢空）而 `ok===false` ⇒ 界面写「**账本健康：0 条缺口（先补齐才能派活）**」，且 `data-state` 被算成 **`'ok'`**（`:2253` 的判据是 `problems.length === 0`，不是 `health.ok`）——把「有几百条缺口」说成「零缺口」，还挂上「健康」的机器可读标记。这与面板自己 `:2224-2234` 声称的「与派活门禁同一份函数，⛔ 不在客户端另算一份」直接冲突。
  服务端注释 `:453` 已经点名这条要求：「⚠ `truncated=true` 时面板必须说『另有 N 条』，⛔ 不许看起来只有这些」——客户端没实现。
- **建议**：头部计数改用 `health.count`；`health.truncated` 或 `count > problems.length` 时追加「另有 ${count - problems.length} 条未随本次返回」；`problems` 缺席且 `count > 0` 时显示「判不出（本次响应未带缺口全文）」，绝不显示 0。

---

### C-04 · high · 切换账本不清展开详情缓存 ⇒ 同名 ID（`R-001` 每本账都有）显示**上一本账**的正文

- **位置**：`src/client/project-panel.tsx:1150-1169`（缓存 + 早退）、`:2217-2221`（切换账本只重置另外两样）、`:972`（取数其实带 `selectedLedger`）
- **证据**：
  ```ts
  1150|  const [itemDetails, setItemDetails] = React.useState<Record<string, …>>({})
  1152|  const loadItemDetails = React.useCallback((it: any) => {
  1153|    const id = String(it?.id ?? '')
  1154|    if (id === '' || itemDetails[id]?.kind === 'ok' || itemDetails[id]?.kind === 'reading') return
  ...
  1169|  }, [itemDetails, loadResource])

  2217|  React.useEffect(() => {          // ← 只清这两样
  2218|    setSelectedReqId(undefined)
  2219|    defaultAppliedRef.current = false
  2220|    setExpanded(new Set())
  2221|  }, [selectedLedger])
  ```
  ```
  $ grep -n 'setItemDetails({})' src/client/project-panel.tsx
  NO RESET FOUND
  ```
- **影响**：`itemDetails` 以**裸 ID** 为键（`R-001`/`TSK-001` 这类编号在每本账里都从 001 起）。在账本 A 展开过 `R-001` 后切到账本 B，B 的 `R-001` 展开体命中 `:1154` 的 `kind==='ok'` 早退 ⇒ 显示 A 的标题与全部详情字段，且**永远不会自愈**（早退在每次展开时都成立）。这是「状态不同步/陈旧渲染」里最难被用户识别的一种：界面有内容、格式正确、内容属于另一个项目。`loadResource` 本身是带 `selectedLedger` 的（`:970-973`），说明作者知道要按账本隔离——只是缓存这一层漏了。
- **建议**：在 `:2217-2221` 的 effect 里加 `setItemDetails({})`；或把缓存键改成 `${selectedLedger}/${id}`。

---

### C-05 · high · `Current` 面板在运行态下**每秒**重取一次 `/ledger-resource`（内联函数 + 1s 时钟）

- **位置**：`src/client/project-panel.tsx:3011`（每次渲染新建 `fetchCurrent`）、`:1124-1129`（1s 时钟）、`src/client/current-panel.tsx:97-110`（effect 依赖 `props.fetchCurrent`）
- **证据**：
  ```tsx
  // project-panel.tsx:3008-3013
  React.createElement(CurrentPanel, {
    sessionId: props?.sessionId,
    refreshTick: pollTick,
    fetchCurrent: async (sessionId?: string) => loadResource('current'),   // ← 每次渲染新引用
    ...(props?.fetchCurrent === undefined ? {} : { fetchCurrent: props.fetchCurrent }),
  })

  // project-panel.tsx:1124-1129（有 running 执行项时）
  React.useEffect(() => {
    if (!hasRunningExec) return
    setClockNow(Date.now())
    const timer = setInterval(() => { setClockNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [hasRunningExec])

  // current-panel.tsx:110
  }, [props.fetchCurrent, props.sessionId, props.refreshTick])
  ```
- **影响**：只要 `execState` 里有 `state==='running'` 的项，`clockNow` 每秒更新 ⇒ 父组件重渲染 ⇒ `fetchCurrent` 是新函数 ⇒ `CurrentPanel` 的 effect 依赖变化 ⇒ **每秒一次 `POST /ledger-resource {resource:'current'}`**，每次读 `current.md` 全文。这与本仓自己写在 `settings-panel.tsx:59-62` 的反模式一字不差：「别把 promise 内联进渲染回调……内联会每渲染一次新建一个引用，被 `useEffect` 依赖捕获后形成自持循环（旧项目实测 8 秒 13420 次请求，把浏览器连接池打满）」。而 Current 面板在 `<details>` 里默认折叠（`:3004-3007, current-panel.tsx:115`），**用户根本看不到**。
- **建议**：把 `fetchCurrent` 提到组件外或用 `React.useCallback`（依赖 `loadResource`），或干脆让 `CurrentPanel` 的 effect 依赖 `refreshTick` 而不依赖函数引用。

---

### C-19 · high · 旧版链（5 步）的第 5 步「验收核对」**状态来自 ACC、条目却取技术验证** ⇒ 状态显示「已通过」，展开体写「这一步还没有条目」，且 ACC 全文**无处可见**

> ⚠ 编号是稳定标识，不是排序位：本条排在 C-05 之后（high 组末尾），编号保留以方便交叉引用。

- **位置**：`src/shared/requirement-chain.ts:307-311`（状态）vs `:345-351`（条目）vs `:391-395`（计数）；客户端消费点 `src/client/project-panel.tsx:2574, 2600-2603, 2611-2612`
- **证据**：
  ```ts
  // ① 状态：第 5 步读的是 chain.accs —— 对 legacy 的 'acc' 步是对的
  307|  if (chain.accs.length === 0) return 'todo'
  309|  if (groups.some((g) => g.verdict.verdict === 'send-back')) return 'blocked'
  311|  return groups.every((g) => g.verdict.verdict === 'accepted') ? 'done' : 'waiting'

  // ② 条目：第 5 步取的却是 chain.verifications —— legacy 账本通常一条都没有
  345|    const items = d.step === 1 ? [req]
  ...
  349|            : d.step === 5 ? chain.verifications      // ← 与 ① 的数据源不是同一个

  // ③ 计数直接来自 items
  391|      total: d.step === 1 ? 1 : items.length,
  395|      itemIds: v3Stage !== undefined && v3Stage.itemIds.length > 0 ? v3Stage.itemIds : items.map(idOf)…

  // ④ LEGACY_STEP_DEFS 只有 5 步，没有第 6 步 ⇒ ACC 在 legacy 链里没有任何一步承载
  112|  const LEGACY_STEP_DEFS = [ … { step: 5, name: '验收核对', kind: 'acc' } ]
  ```
  客户端如实渲染这个矛盾：
  ```tsx
  2600|  … `${CHAIN_STATE_ICON[step.displayState]} ${CHAIN_STATE_TEXT[step.displayState]}`   // 「✅ 已完成」
  2602|  … `${step.done}/${step.total}`                                                // 「0/0」
  2611|  …(items.length === 0
  2612|    ? [React.createElement('div', …, '这一步还没有条目')]
  ```
- **影响**：对一个走完验收的 legacy 需求，面板第 5 行同时显示三件互相矛盾的事实：**状态「已完成」+ 计数「0/0」+ 展开体「这一步还没有条目」**。更严重的是 **ACC 条目（含判决、残余风险、接受人）在 legacy 链上完全不可见**——第 5 步不承载它，第 6 步不存在。用户能读到「验收完成了」，但读不到**是谁、依据什么、残余风险几级**。这与本域反复强调的「判得出不许显示成判不出、更不许显示成空」是同一类失败，只是发生在服务端投影层、由客户端如实放大了。
- **建议**：`items` 改成按 `d.kind` 而不是按步号取（`d.step === 5 && legacy ? chain.accs : …`），或直接给 `ChainStep` 加 `kind` 字段由服务端下发（同 C-06 的建议）。**注意这条的主体在 `requirement-chain.ts`（pipeline/ledger 域）**，客户端只是消费方——修之前需要该域确认 legacy 第 5 步到底该装 acc 还是 verification。
- **为什么我没把它算作客户端缺陷**：客户端的两处行为（`displayState`→标签、`items`→列表）都是「服务端给什么显示什么」，没有自行推导。但它是**本域用户最先看到**的那一屏，所以必须在本报告里点名。

---

### C-06 · medium · 「第几步 → 什么 kind」由客户端**按步号硬编码**，与服务端实际装进那一步的单元类型是**两条独立事实**（当前恰好一致，属侥幸）

> ⚠ **订正记录（自查）**：本条初稿写成「legacy 第 5 步的 ACC 被套上技术验证标签表 ⇒ 还没验印成待技术验证」，**该结论错误**，已撤回。
> 反证：`requirement-chain.ts:349` 让 legacy 第 5 步装的是 `chain.verifications`（不是 accs），而 `kindOfStep(5)='verification'` 恰好与之相符 ⇒ 标签查表是**对的**，不会出现该错配。`d.kind` 在服务端只用于 v3 查询（`:352`，legacy 时 `v3Stage===undefined`），从未参与 legacy 的条目选取。原稿把「步骤名字叫验收核对」误读成「装的是 ACC」。

- **位置**：`src/client/project-panel.tsx:148-160`（`STAGE_KIND_BY_STEP` / `kindOfStep`）、`:1744`（唯一消费点）；`src/shared/requirement-chain.ts:112-118, 344-352`
- **证据**：
  ```ts
  // 客户端：kind 只由「第几步」推出来
  148|  export const STAGE_KIND_BY_STEP = { 1:'req', 2:'change', 3:'task', 4:'run',
  152|                                     5:'verification', 6:'acc', 7:'closure' }
  159|  export function kindOfStep(step: number): string { return STAGE_KIND_BY_STEP[step] ?? '' }
  1744|    const status = stageStatusLabel(kindOfStep(step), String(it?.status ?? ''))

  // 服务端：装进哪一步由 step 号决定，而**声明**的 kind 在 legacy 下并不参与
  344|    const items = d.step === 5 ? chain.verifications : …
  352|    const v3Stage = legacy ? undefined : pipeline.stages.find((s) => s.id === d.kind)
  // legacy 的声明与实装已经不一致：
  117|  { step: 5, name: '验收核对', kind: 'acc' }      // ← 声明 acc
  349|  : d.step === 5 ? chain.verifications            // ← 实装 verification
  ```
- **影响**：今天**没有可见错配**（两套硬编码恰好对上了），但它是一个**触发即静默**的陷阱：只要有人按 C-19 的建议把 legacy 第 5 步改成装 `chain.accs`（那是让 ACC 重新可见的最自然修法），`kindOfStep(5)` 会立刻把每条 ACC 的状态拿去查 `verification` 表 ⇒ `pass` 印成「技术验证通过」、`send-back` 印成「技术验证退回」，而 ACC 的合法状态集 `['pass','send-back','unverified']` 是 verification 的 `['unverified','pass','send-back','waived']` 的**真子集**（`stages-index.ts:49-50`），**`stageStatusLabel` 不会返回 `known:false`**（`:136-160` 只校验「该 kind 的封闭集」，不会反问「这个 status 是不是本来属于另一个 kind」）⇒ 界面上不会出现「判不出」，只会安静地换成另一个词。这正是本文件 `:43-47` 记下的「表命中了，但命中的是另一张表」那种最难查的形态——只是今天还没被触发。
- **建议**：把 `kind` 变成**服务端下发的事实**（`ChainStep` 加 `kind` 字段），客户端不再按步号猜；在此之前，若采纳 C-19 的修法，必须同步改 `STAGE_KIND_BY_STEP` 并加一条「legacy 第 5 步装 acc 时标签正确」的判据。

---

### C-07 · medium · 门禁轮询被**三个实例**同时跑，实际频率是注释宣称的 2~3 倍

- **位置**：`src/client/hob-unselected-gate.tsx:771-822`（三个槽各挂一个实例）、`:628-674`（每个实例各自 `setInterval`）、注释 `:194-196`
- **证据**：
  ```
  $ grep -n "ctx.slots.inject('conversation" src/client/hob-unselected-gate.tsx
  771:  ctx.slots.inject('conversation.hero.options', …
  791:  ctx.slots.inject('conversation.session.header.actions', …
  810:  ctx.slots.inject('conversation.input.right', …

  hob-unselected-gate.tsx:194-196（注释）
    ⚠ 频率取 4 秒：… 4s 下每会话每分钟 15 次 POST，且只在该会话是 Hob 且尚未选档时才轮询
  ```
- **影响**：`recorded === 'unrecorded'` 时三个实例都会进 `:628` 的 effect 并各自起 4s 定时器（`showBanner:false` 只影响渲染，`:676` 在 effect 之后）。空会话：hero + header + input.right；有消息后：header + input.right（注释 `:785-790` 说 hero/header 由宿主生命周期互斥，但 **input.right 永远在**）。实际 ≈ 30~45 次/分，而非 15 次。去重只保护「开窗」，不保护「请求」。作者在 `:622-626` 明写「⛔ 不整页轮询」，但没意识到三实例等于三份。
- **建议**：把轮询收进一个实例（例如只由 `input.right` 承担，hero/header 传 `readBlocked: null`），或在 `installHobUnselectedGate` 里共享一个轮询器 + 订阅。

---

### C-08 · medium · 「想手动补选档位」的入口**永远不可达**：入口组件以「弹窗已打开」为渲染前提

- **位置**：`src/client/create-hob-dialog.tsx:1192`（`if (!isOpen) return null`）vs 注释 `:1183-1191`；注册点 `src/client/index.ts:164-169`
- **证据**：
  ```tsx
  1174|   * ⚠ **2026-10-29（包 BZ · CHG-185）：不再常驻。**
  1185|   *   ⚠ 选的是「条件化」而**不是「撤掉」**：撤掉会让"想手动补选档位"的用户
  1186|   *     完全没有入口（闸门只在**发送时**拦，用户若不发消息就永远弹不出来）。
  1187|   *   ⇒ 留它当**兜底入口**，但⛔ 不再常驻。
  1192|   if (!isOpen) return null
  1205|     onClick: () => props.state.open(),
  ```
- **影响**：这个「兜底入口」的渲染条件恰恰是 `state.isOpen`，而它唯一的点击动作就是 `state.open()`。于是：弹窗开着才渲染按钮 → 按钮的唯一用途是打开已经开着的弹窗。它**不能**满足注释宣称的场景（用户不发消息时手动打开）。实际可达路径只剩两条，都不受用户主动控制：门禁横幅的按钮（需要该会话是 Hob 且 `recorded` 已知，`gate:679-708`），以及 4s 轮询读到 `blocked`（需要先发一条被拦的消息）。机检也被这个形态带偏了——`check-hob-create-dom.mjs:318, 362-366` 每次都先 `st.open()` 再断言按钮存在，**没有任何一条断言「关着时应该能打开」**。
- **建议**：二选一并写清：要么恢复「在 Hob 会话里常驻一个入口」（按 `agentPreset` 投影门禁），要么把 `:1183-1191` 的注释改成「本入口仅为弹窗打开时的可见锚点，不提供手动打开」，并把 `gate` 横幅作为唯一手动入口写进文档。

---

### C-09 · medium · 面板（3.3k 行、全仓最大的一屏）**完全绕过 i18n**，与 `i18n.ts` 的契约相反

- **位置**：`src/client/project-panel.tsx` 全文；`src/client/i18n.ts:1-56`（文件头）、`:342-357`（`t()` 契约）
- **证据**：
  ```
  $ for f in src/client/*.tsx; do … echo "$f cjkchars=… t()=…"; done
  src/client/project-panel.tsx   cjkchars=12760   t()=0    d()=0
  src/client/settings-panel.tsx  cjkchars=6386    t()=68
  src/client/create-hob-dialog.tsx cjkchars=10500 t()=10   d()=48
  src/client/hob-unselected-gate.tsx cjkchars=5475 t()=8
  src/client/work-plan-panel.tsx cjkchars=793     t()=0
  src/client/current-panel.tsx   cjkchars=266     t()=0
  ```
  `i18n.ts:342-343` 写的是「面板取词入口（**所有面向用户的文案都经它**）」。
- **影响**：宿主切英文后，设置分区、弹窗、横幅都会变，唯独**用户看得最多的那块面板**（阶段主线、下一步、历史、账本健康、执行态、Current、工作计划）仍是中文；`work-plan-panel` / `current-panel` 同样。这不是「漏译几条」，是三层文件（12760+793+266 CJK 字符）零接入，且 `i18n.ts` 的分层词典机制（`addDictionaryLayer`）正是为这类文件设计的。
- **建议**：见 ⑤ 的 [建议决策] D-3。

---

### C-10 · medium · 两条词条已定义却被硬编码中文顶替 ⇒ 英文界面里出现中文

- **位置**：`src/client/create-hob-dialog.tsx:1202`（aria-label）、`:1376-1378`（无导航提示）vs 词典 `:213`、`:216`（及英文 `:281`、`:284`）
- **证据**：
  ```tsx
  1202|    'aria-label': '新建 Hob 会话：选择可读范围与推进方式',     // ← 硬编码，未用 d('entry.aria')
  1376|    ? h('span', { className: 'dsh-hob-createdHint' },
  1377|      '（⚠ 该会话在收到第一条消息之前被宿主从会话列表过滤，现在看不到；'   // ← 未用 d('created.noNav')
  1378|      + '请从宿主的会话创建面板继续，或先给它发一条消息）')
  ```
  ```
  $ node … 键集核对
  src/client/create-hob-dialog.tsx  zh=59 en=59 onlyZh=[] onlyEn=[]
    used=44  MISSING=[]
    unused=["entry.aria","created.noNav", …]     ← 这两条恰好是被硬编码顶掉的
  ```
- **影响**：`entry.aria` 是按钮的**无障碍名**——读屏用户在英文界面听到中文；`created.noNav` 是「会话建好了但看不见」的唯一解释句——英文用户读到中文。两条都有现成的英文译文，纯粹是漏替换。这也说明该文件的 i18n 覆盖没有机检（`grep 'CJK|硬编码' scripts/check-client-deps.mjs` 只有 J-2 预设名那一族，不查硬编码文案）。
- **建议**：改成 `d('entry.aria')` / `d('created.noNav')`；并加一条「本文件内出现中文字符串字面量即红」的机检（对本域四个已接 i18n 的文件生效）。

---

### C-11 · medium · `/stages` 的权威字段**取回即弃**：全局 `next`、`pipelines`、`summary` 一个都不渲染

- **位置**：`src/client/project-panel.tsx:1703`（`next`）、`:1284`（`pipelines`）、`:1296`（`summary`）、`:2654`（实际渲染的下一步）
- **证据**：
  ```
  $ grep -n 'next' src/client/project-panel.tsx | sed -n '…'
  1703:  const next = stageState.kind === 'ok' ? (stageState as any).next : undefined
  （此后全文再无对 1703 这个 next 的引用）

  $ grep -n 'pipelines' src/client/project-panel.tsx
  1066:    | { kind: 'ok'; stages: any[]; caps: any[]; pipelines?: any[] }
  1284:          pipelines: Array.isArray(res.pipelines) ? res.pipelines : [],

  $ grep -n 'stageState as any).summary|stageState.summary' … → summary NEVER READ
  ```
  实际渲染的是 `:2654`：`const a = selectedChainNext ?? selectedChain.next`。
- **影响**：服务端 `stages-index.ts:423-434` 明确把 `next`/`pipelines`/`summary` 当作该路由的权威产出（`pipelines` 的注释还是「single authority for a requirement's active stage, user gate and next actor; **consumers must not derive another** 'current stage'」）。客户端取了、存了、不用。后果：面板的「下一步」**只**来自需求链（`/requirement-chains`），而项目级 `next`（全账本口径，含「没有在途需求但账本有活」的情形）在界面上不存在。`summary` 同理——`panelSummaryOf` 在服务端算了两次（`stages-index.ts:431`、`requirement-chain.ts:504, 565`），客户端一次都没用。
- **建议**：明确二选一并写进契约：要么删掉这三项的下发（省带宽、去掉「有权威视图但没人读」的假象），要么在面板上给项目级 `next` 一个位置（例如「没有在途需求」时用它）。

---

### C-12 · medium · 阶段词表**至少四份副本**；`STAGE_KIND_BY_STEP` 自称被 R-10 咬住，实际没有任何判据引用（C-06 的根因）

- **位置**：`src/client/project-panel.tsx:138`、`:141-156`；`src/shared/pipeline-view.ts:33-41`；`src/shared/requirement-chain.ts:120-128`
- **证据**：
  ```ts
  // project-panel.tsx:138
  export const STAGES_STEP_NAMES = ['需求规格','实现方案','任务图','任务执行','技术验证','产品验收','交付收口'] as const
  // project-panel.tsx:141-147（注释）
  ⚠ 与账本侧 src/shared/stages-index.ts 的 STAGE_DEFS **同序**…
    一致性由 check:stages-route 的 R-10 咬住（它逐 kind 点验标签表，
    若这张表与 STAGE_DEFS 漂开，那一步的条目就会全变「判不出」⇒ DOM 断言必红）

  // 实际至少四份（$ grep -rn "'需求规格'" src/shared src/client）：
  stages-index.ts:30       STAGE_DEFS        = [{step:1, kind:'req', name:'需求规格'}, …]
  pipeline-view.ts:34      PIPELINE_STAGES   = [{step:1, id:'requirements', name:'需求规格'}, …]
  requirement-chain.ts:113/121  LEGACY_STEP_DEFS / STEP_DEFS（同一文件里两份）
  project-panel.tsx:138    STAGES_STEP_NAMES = ['需求规格', …]
  （另有 stage-controls.ts:20 的中文名映射、tasks-progress.ts:67 的五步旧表）
  ```
  ```
  $ grep -rn 'kindOfStep|STAGE_KIND_BY_STEP' scripts/ → NONE
  $ grep -n 'R-10' -A 6 scripts/check-stages-route.mjs → 只遍历 STAGE_KIND_STATUSES 的 kind×status，不读 STAGE_KIND_BY_STEP
  ```
- **影响**：注释承诺的交叉校验不存在，四份词表靠人眼维持同序。`:141` 的注释写「步号 → kind（`1..5`）」，实际表有 7 项——注释与数据已漂。C-06 是同一根因的另一面：`STAGE_KIND_BY_STEP` 既没有判据保护、又没有任何机制保证它和「服务端实际装进那一步的单元类型」一致。
- **建议**：客户端直接 import `PIPELINE_STAGES`（`pipeline-view.ts` 是 shared，且已被 client 间接依赖），删掉 `STAGES_STEP_NAMES`；`STAGE_KIND_BY_STEP` 要么删（由服务端下发 `kind`），要么补一条真判据把它和 `STAGE_DEFS` 逐项对拍。

---

### C-13 · medium · 17 处 `as any` 把 `/stages` 线格式的契约漂移藏起来（写侧类型缺字段、读侧全靠断言）

- **位置**：`src/client/project-panel.tsx:1064-1068`（state 类型）vs `:1280-1306`（写入）vs `:1703-1709`（读取）
- **证据**：
  ```ts
  // 声明只有三个字段
  1064|  const [stageState, setStageState] = React.useState<
  1066|    | { kind: 'ok'; stages: any[]; caps: any[]; pipelines?: any[] }

  // 写入时塞了九个字段，整体 as any 关掉检查
  1280|        setStageState({
  1281|          kind: 'ok', stages: res.stages, caps: …,
  1285|          next: res.next,
  1294|          portfolio: (res as any).portfolio,
  1295|          attention: (res as any).attention,
  1296|          summary: (res as any).summary,
  1302|          truncated: (res as any).truncated,
  1303|          relations: (res as any).relations,
  1305|          stageHealth: (res as any).stageHealth,
  1306|        } as any)

  // 读侧同样靠断言
  1703|  const next = stageState.kind === 'ok' ? (stageState as any).next : undefined
  ```
  ```
  $ grep -c 'as any' src/client/project-panel.tsx → 17
  ```
- **影响**：`StagesOk` 在 `shared/stages-index.ts:142-204` 有完整类型（`pipelines`/`next`/`summary`/`portfolio`/`attention`/`stageHealth`/`relations`/`truncated`），客户端一个都不 import，改用 `any` + 断言。于是：服务端改字段名 ⇒ **TypeScript 全绿**、面板静默显示「判不出」。C-03（`count`/`truncated` 不读）与 C-11（`next` 不用）都是在这层断言后面躲着的——如果用的是真类型，编辑器会直接标出「声明了但未使用」。
- **建议**：`import type { StagesOk }` 并让 state 直接用 `StagesOk`（或 `Pick<…>`），删掉 `:1306` 的 `as any`。

---

### C-14 · low · 多处「存了不读」的死字段，其中一处导致完成数被算两遍

- **位置与证据**：
  - `liveStateRef`：`:1135` 声明，`:1472`/`:1537` 写入，**零读取**（节拍实际读 `live?.state()` `:1511, 1529, 1548`）。
  - `currentResolved`：`:1013` 存，渲染用 `current === undefined` 判断（`:2960-2962`），字段从未读。
  - `activeCount/completedCount/retiredCount/unattached`：`:1341-1345` 存；`grep 'chainState.activeCount|completedCount|retiredCount|unattached'` → 零命中；面板在 `:2176` 用 `chains.filter(c => c.state === 'completed')` 自己数一遍。
- **影响**：死字段本身无害，但第二类有风险——服务端 `completedCount`（`requirement-chain.ts:584, 601`）与客户端 `completed.length` 今天同口径，将来任一侧改口径就变成「两个完成数」。这正是本仓反复禁止的「双实现口径」的雏形。
- **建议**：删掉死 ref/死字段；完成数统一取服务端 `completedCount`。

---

### C-15 · low · `t()` 缺键时把**键名本身**当文案返回，与 `i18n.ts` 自己的红线相反

- **位置**：`src/client/i18n.ts:353-357`
- **证据**：
  ```ts
  353|  export function t(key: string, params?: Params): string {
  354|    const viaService = translateVia(LOCALE_NS, key, params)
  355|    if (viaService !== undefined) return viaService
  356|    return interpolate(localLookup(key) ?? key, params)      // ← 键名兜底
  ```
  文件头 `:36-40` 的纪律 ①：「**绝不许把键名当名字显示**……`translateVia` 把『返回值 === 键』判成取不到」。这条纪律只在 `presetDisplayName`（`:374-389`）里被贯彻，`t()` 本体没有。
- **影响**：今天所有用到的键都在（三份词典 138 键，逐键核对 `MISSING=[]`），所以不触发。但只要新增一处 `t('foo.bar')` 而忘加词条，用户界面上就会出现 `foo.bar`——静默、且看起来像产品文案。
- **建议**：`t()` 在开发构建下 `console.warn` 一次并返回键名（保留可诊断性），生产构建下返回空串由调用方兜底；或加一条机检：源码里 `t('x')` 的 x 必须在三层词典的并集里。

---

### C-16 · low · 门禁用 `globalThis.alert` 做「入口不可用」说明

- **位置**：`src/client/hob-unselected-gate.tsx:699-708`
- **证据**：
  ```ts
  699|      onClick: () => {
  700|        if (!canOpen || sessionId === undefined) {
  701|          try {
  702|            // ⚠ 如实说明，⛔ 不假装已经打开
  703|            globalThis.alert?.(`${gateText(selected)}\n${gateButtonUnavailableText()}：${t('gate.alert.unavailable')}`)
  704|          } catch { /* 无 alert 环境 ⇒ 静默（横幅文案已可见） */ }
  ```
- **影响**：阻塞式原生弹窗，在宿主 shell 里会打断用户；且 `:683-689` 已经把同一句话渲染成可见横幅文本（`gateText(selected)`），弹窗是**重复**的。另外该分支只在 `openForSession` 缺席时触发，而生产注册（`index.ts:276-278`）总是提供它 ⇒ 生产不可达，只影响机检与将来接线缺失的场景。
- **建议**：删掉 alert，改为把 `gateButtonUnavailableText()` 放进按钮的 `title`/`aria-describedby`（`:694` 已有 `aria-label`）。

---

### C-17 · low · 资源路由把 404/405 也吞成业务失败，违反同文件刚立的「打错门 vs 读不到」纪律

- **位置**：`src/client/project-panel.tsx:604-619` vs `:347-351`（纪律正文 `:328-346`）
- **证据**：
  ```ts
  604|  export async function defaultFetchResource(…) {
  …
  617|    if (!res.ok) return { ok: false, reason: 'route-error', message: `HTTP ${res.status}：${STAGES_RESOURCE_PATH}` }
  618|    try { return await res.json() } catch { return { ok: false, reason: 'invalid-json', … } }
  ```
  同一文件另外五个取数函数：`if (res.status === 404 || res.status === 405) throw new StaleRouteError(…)`（`:347, 389, 413, 536, 566, 594`）。
- **影响**：资源路由被改名/方法不对时，展开详情显示「资源读不到（HTTP 404）」而不是「这个路径没有处理体（接线问题）」——把接线故障说成数据故障，正是 `:328-346` 那段注释要治的病。
- **建议**：照另五个的形态补 404/405 分支。

---

### C-18 · low · 同一条路由字符串写两份（`work-plans`）

- **位置**：`src/client/project-panel.tsx:957` vs `src/client/work-plan-panel.tsx:16`
- **证据**：`work-plan-panel.tsx:16` `export const WORK_PLANS_ROUTE_PATH = '/api/dsh-hob/work-plans'`；`project-panel.tsx:956-967` 内联了一个同 URL 的匿名取数函数，未 import 该常量（`work-plan-panel.tsx:69-83` 已有等价的 `fetchWorkPlans`）。
- **影响**：改路径时必然漏一处；且两处的错误处理已略不同（一处 `!res.ok` 直接 `ok:false`，一处先判 404/405——见 C-17 同族）。本仓对路由常量的纪律是「客户端要与服务端逐字一致；⛔ 不许各写一份」（`project-panel.tsx:179` 自述）。
- **建议**：`project-panel` 改为 import `fetchWorkPlans`。

---

## ⑤ 与其他域的边界与疑点

### A. 已确认的边界（我这边看到的接口面）

1. **与 pipeline 域**：面板**不重算**阶段口径——`selectedChartStepOf`（`project-panel.tsx:71-75`）优先取 `chain.pipeline.activeStage`，`RequirementChain.pipeline` 在类型上是**必填**（`requirement-chain.ts:56`），而服务端 `requirement-chain.ts:519-520` 已把 `currentStep` 强制等于 `pipeline.activeStage`。⇒ 代码里 `?? chain.currentStep` 这条回落是**死分支**（类型上不可达），面板不存在「另一套阶段口径」。这点与 `pipeline.md` P-02 的说法需要对齐：**面板侧没有第五套完成算法**，但它**消费**了服务端两套（`chain.steps[].displayState` 来自 pipeline、`step.done/total` 来自 `summarizeStage` 计数）并排显示（`project-panel.tsx:2600-2603`：同一行既有 `CHAIN_STATE_TEXT[displayState]` 又有 `${step.done}/${step.total}`）。**「状态=已完成、计数=2/3」这种自相矛盾的同屏并置，落点在这一行。**
2. **与 ledger 域**：条目标题/关系/读数全部来自 `presentation`（`item-presentation.ts` 的服务端投影），客户端只在 `relationLabelOf`（`project-panel.tsx:1735`）取共享函数，不另写映射（`:1730-1734` 记录了旧病）。展开详情走 `/ledger-resource` 按 ID 读（`ledger-resources.ts:145-206`），客户端不拼路径、只传 `readPathOf`（`:1158`）。
3. **与 policy 域**：门禁三态完全由 `session-policy` 路由决定，客户端把 `'unknown'`/`'not-applicable'`/`任何意外值` 一律归 `'unknown'`（`gate:165-169`）并 fail-closed；`blocked` 与 `recorded` 是两根独立的轴（`gate:176-198`），没有合并。
4. **与编排域**：`work-plans` 只调 `orch.status()`（`work-plans-route.ts:120` 起），零写、零派单；面板对 `state.plans` 只做计数与标签映射（`work-plan-panel.tsx:117-131, 186-296`），不推断计划状态。

### B. 我无法在本域内单独判定的疑点

- **B1（阻塞性，需宿主）**：`@deepseek-ai/dsh-client-ui-primitives` 是否在宿主模块表 seed 里 —— 见 C-01。两条注释互相否定，产物选择了「require」。需宿主探针给读数。
- **B2（跨域，服务端侧 · 已升级为 C-19）**：`requirement-chain.ts:307-311` 用 `chain.accs` 判第 5 步状态、`:349` 却用 `chain.verifications` 取第 5 步条目；而 `LEGACY_STEP_DEFS`（`:112-118`）只有 5 步、没有第 6 步 ⇒ **legacy 链的 ACC 条目没有任何一步承载**。后果是面板同屏出现「已完成 / 0/0 / 这一步还没有条目」，且验收判决与残余风险全文不可见（见 C-19）。**主体在 pipeline/ledger 域**：请确认 legacy 第 5 步该装 acc 还是 verification，以及 ACC 该不该在 legacy 链上可见。⚠ 若该域选择「改成装 acc」，客户端侧 C-06 的 `STAGE_KIND_BY_STEP` 必须同步改，否则 ACC 的状态会被拿去查 verification 表（`pass`→「技术验证通过」），且**不会**出现「判不出」提示。
- **B3（产品口径）**：紧凑模式截断时「账本健康」该显示哪个数（全量 `count` 还是响应里实际带的 `problems.length`），以及 `problems` 被整体丢弃时该显示什么 —— 见 C-03 与 D-2。
- **B4（宿主契约，未验证）**：`useTabInfo` 是否真的由宿主注入到 `sidebar.right.pane.tab` 的 slot props。全仓唯一出现处是机检自造的假实现（`check-stages-panel-dom.mjs:2143-2144`），生产侧无任何断言。若宿主不注入，`StagesPanelLive` 的 `effectiveVisible` 恒为 `false`（`:3142`），面板**一次都不轮询、不连流**，而徽标永远停在「正在连接实时更新…」（`:1109, 3103`）——**这会是本域最严重的静默冻结**，且与 C-02 是同一类后果。我无法在本仓内证明宿主行为，故未列为已确认缺陷；但它与 C-01 一样，是「一条探针就能定论」的高杠杆项。
- **B5（文档口径）**：「六阶段」与「七步」：面板文案里三处写「六阶段」（`project-panel.tsx:2319, 2473, 3338`），而 `STAGES_STEP_NAMES` 是 7 项、`PIPELINE_STAGES` 是 7 项、`STAGE_DEFS` 是 7 项。若「G6 交付收口按风险启用」是权威口径，则 `:2473` 的「当前阶段：六阶段已走完」在 `activeStage === null` 时是**对的**（七步全完成），但用户数着上面 7 行会困惑。需文档契约域给唯一说法（`pipeline.md` 已提出同一疑点，此处从客户端侧补上落点）。

### C. [建议决策]

- **D-1** `tabVisible` 缺失时面板该怎么办 | 选项：A 保持 fail-closed（不可见即不刷新），但必须把「判不出可见性」渲染成可见告警；B 把 `undefined` 当可见（宁可多轮询也不冻结） | 推荐：**A + 补可见态** 理由：fail-closed 本身是对的（避免后台白烧请求），真正的问题是「冻结了却不告诉用户」，而 `:1109` 的初始 `'connecting'` 让徽标永远像在连——加一个 `'unknown'` 档即可，不必改门禁方向。
- **D-2** 紧凑截断时「账本健康」显示什么 | 选项：A 显示 `count`（全量）+「另有 N 条未随本次返回」；B `truncated` 时整块显示「判不出（本次响应已截断）」 | 推荐：**A** 理由：`count` 服务端在任何模式下都保证给（`stages-index.ts:167-168` 明写），用它不增加成本；而 B 会把「已知有 300 条缺口」降级成「没有读数」，与本仓「判得出不许显示成判不出」的红线冲突。
- **D-3** 面板要不要接 i18n | 选项：A 把 project-panel / work-plan-panel / current-panel 全量迁到 `t()`（约 13.8k 字符文案、需新增 ~150 键）；B 明确声明「面板仅中文」并改 `i18n.ts:342` 的契约措辞，把例外写进文档 | 推荐：**B 先落地、A 另开单** 理由：当前的问题不是「没翻译」而是「文档说全都走 t()、实际最大一屏零接入」——先把契约说准，翻译工作再按优先级排；否则任何一次「i18n 已覆盖」的复核都会被这一条推翻。

---

## 附：本次审查做过的可复现命令（均为只读）

```
wc -l src/client/*.ts src/client/*.tsx
grep -rn 'pipelineViewOf|pipelineViewsOf|pipelineDispatchProblems|taskGraphOf' src --include=*.ts --include=*.tsx
grep -rn 'panelSummaryOf|attentionAfterMainAction' src
grep -c 'as any' src/client/project-panel.tsx                       # 17
grep -rn 'kindOfStep|STAGE_KIND_BY_STEP' scripts/                   # NONE
grep -n 'setItemDetails({})' src/client/project-panel.tsx           # 无
grep -n 'health\.count|health\.truncated' src/client/project-panel.tsx   # 无
grep -n 'stageState as any).summary' src/client/project-panel.tsx   # 无
sed -n '28p' lib/client.js                                          # require primitives
node --input-type=module …   # 三层词典键集核对：zh=en、跨层无同名键、MISSING=[]
```

**未做**：`npm run build`（会写 `lib/`）、`npm run typecheck`（未跑，避免长时间占用；C-13 的结论来自读码而非编译输出）、任何 `git` 写操作。