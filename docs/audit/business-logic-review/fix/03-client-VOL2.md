# 03-client · 分卷 2

> ⚠ 本文件是 `fix/03-client.md` 的**分卷**（原文件超 64KB 读上限，
> 按 `check:gitignore` 的 M 判据处置：**整块搬走 + 原位留指针**，⛔ 不是压缩）。
> 主文件：`docs/audit/business-logic-review/fix/03-client.md`。

---

## §5 T-08 · G3–G6 的 blockedBy 到不了面板（high）

### ① 缺陷编号与位置

- `T-08`（REVIEW §5.3，high）；
- `src/shared/requirement-chain.ts:519-550`（`pipelineGoverns` + 只在 G1/G2 注入 blockedBy 的两个分支）。⚠ **行号漂移**：REVIEW 写 `:521-540`；实测 `const pipelineGoverns = !legacy` @**519**、G1 分支 **521-530**、G2 分支 **531-540**、legacy 分支 **541-550**；
- `src/client/project-panel.tsx:82-113`（`nextOfPipeline`：G1/G2 覆盖、legacy 覆盖、其余**回落 chain.next**）、`:2654-2666`（渲染「卡在哪」）；
- 证据等级：**实测**（服务端三分支 + 客户端 nextOfPipeline 全文 sed 确认）。


### ② 改什么

**服务端一处**（requirement-chain.ts 的 G3–G6 也注入 pipeline.blockedBy）+ **客户端排版一处**（与 T-09 的「另有 N 条」区分）。

⚠ **与 REVIEW §5.3 的差异**：REVIEW 只写「在 G3–G6 也把 pipeline.blockedBy 注入 next.blockedBy」。本规格补一条**必须一起考虑的**：`pipeline-view.ts` 的 blockedBy 有**重复项**（`O-32`：`:322-327` 全量循环 + `:340-344` built 任务循环，同一条 VER 的问题被 push 两次）⇒ 若不同批去重，T-08 修好后**面板会把「另有 N 条」的 N 说大**（REVIEW §9.4 实测：总数 7、去重后 5）。

### ③ 具体改法

**3.1 服务端（requirement-chain.ts）**

```ts
const pipelineGoverns = !legacy
if (pipelineGoverns) partial.currentStep = partial.pipeline.activeStage

/**
 * ⚠⚠ G1/G2 是「用户闸门」，**覆盖式注入**（保持现状：用户闸门优先级最高）。
 *   ⛔ 不改这两个分支的语义。
 */
if (pipelineGoverns && partial.pipeline.gate === 'G1-requirement') {
  partial.next = { kind: 'wait-user', target: partial.pipeline.reqId, why: partial.pipeline.nextAction, blockedBy: partial.pipeline.blockedBy }
  partial.state = 'active'; partial.inFlight = true; partial.complete = false
} else if (pipelineGoverns && partial.pipeline.gate === 'G2-plan') {
  partial.next = { kind: 'wait-user', target: partial.pipeline.stages[1]?.itemIds[0] ?? null, why: partial.pipeline.nextAction, blockedBy: partial.pipeline.blockedBy }
  partial.state = 'active'; partial.inFlight = true; partial.complete = false
} else if (partial.pipeline.state === 'legacy') {
  // 保持现状：legacy 分支已有兜底 blockedBy，⛔ 不改
} else if (pipelineGoverns) {
  /**
   * ⚠⚠ G3–G6：**不覆盖** kind / target / why（沿用链自己的动作），只把管线缺口补进 blockedBy
   *   （T-08）。改前这里什么都不做 ⇒ pipeline.blockedBy 里明明写着
   *   「G3 · 任务依赖成环：…」，面板却印「卡在哪：没有主阻断」。
   *
   * ⚠ 为什么**不**整体覆盖 next（像 G1/G2 那样）：
   *   G1/G2 的 nextAction 是「请用户确认」，覆盖是**对的**；
   *   但 G3–G6 的 nextAction 是 Hob/developer 的动作建议，而 chain.next（nextAction() 算的）
   *   可能已经在说更具体的事（例如「派发 TSK-003」）。覆盖会**丢掉那个 target**。
   *   ⇒ 只**合并 blockedBy**：链自己的在前、管线缺口在后，去重后保序。
   *   ⚠ 这与 pipeline-view.ts:5-6 的契约（pipeline 是 active stage / gate / next actor 的
   *     单一来源）不冲突：这里合并的是**阻断原因**，不是「当前在第几步」。
   */
  const merged = [...(Array.isArray(partial.next.blockedBy) ? partial.next.blockedBy : []), ...partial.pipeline.blockedBy]
  partial.next = { ...partial.next, blockedBy: dedupePreservingOrder(merged) }
}
```

**dedupePreservingOrder**（放本文件顶部工具区，与 arr / text 同族）：

```ts
/**
 * 去重并保留首次出现顺序。
 * ⚠ 用 Set 即可（ES2015 的 Set 保插入序）；⛔ 不要 [...new Set(x)].sort() —— 排序会打乱
 *   「主阻断在第一个」这条既有契约（面板 :2663 只印 blockers[0] 作为主阻断）。
 */
function dedupePreservingOrder(items: readonly string[]): string[] {
  return [...new Set(items)]
}
```

**3.2 与 O-32 同批（否则 T-08 修好后 N 会虚高）**

```ts
// pipeline-view.ts:322-344 区块，两个循环的产物去重（O-32）
/**
 * ⚠ O-32：同一条 VER 的问题会被 push 两次（:326 全量循环 + :341 built 任务循环）⇒
 *   面板「另有 N 条」的 N 虚高（REVIEW §9.4 实测：总数 7、去重后 5）。
 *   ⇒ **与 T-08 同批**：否则 T-08 一修好，「另有 N 条」立刻开始说大话。
 */
// blockedBy 是 const string[] ⇒ 用 splice 原地去重（不动声明，diff 更小）：
blockedBy.splice(0, blockedBy.length, ...dedupePreservingOrder(blockedBy))
```


**3.3 客户端排版（与 T-09 的「另有 N 条」区分开）**

```tsx
const a = selectedChainNext ?? selectedChain.next
const blockers = Array.isArray(a.blockedBy) ? a.blockedBy.map(String).filter((x) => x !== '') : []
const why = typeof a.why === 'string' && a.why !== '' ? a.why : STAGES_UNDECIDABLE_TEXT
return React.createElement('div', {
  style: subNoteStyle, 'data-dsh-hob': 'stages-next',
  'data-state': a.kind === 'undecidable' ? 'undecidable' : 'ok',
  'data-next-kind': a.kind,
  'data-blocker-count': String(blockers.length),      // ← 新增：机检可直接读条数
},
  React.createElement('div', { style: { fontWeight: 600, overflowWrap: 'anywhere' }, 'data-dsh-hob': 'stages-next-line' },
    a.kind === 'undecidable' ? STAGES_UNDECIDABLE_TEXT + '：' + why : '下一步：' + why),
  /**
   * ⚠⚠ **空态文案必须区分「确实没有阻断」与「没有读数」**（T-08 的验收面之一）：
   *   改前两种情况都印「卡在哪：没有主阻断」—— 而 T-08 说的正是「这条 0 条阻断是假的」。
   *   改后：a.blockedBy **不是数组** ⇒ 判不出；是空数组 ⇒ 真的没有。
   */
  React.createElement('div', { 'data-dsh-hob': 'stages-next-blocker', style: { overflowWrap: 'anywhere' } },
    !Array.isArray(a.blockedBy) ? '卡在哪：' + STAGES_UNDECIDABLE_TEXT + '（响应未带阻断清单）'
      : blockers.length === 0 ? '卡在哪：没有主阻断'
        : '卡在哪：' + blockers[0]),
  ...(blockers.length > 1 ? [React.createElement('div', {
    key: 'more', 'data-dsh-hob': 'stages-next-blocker-rest',
    /** ⚠ 与健康块的 stages-health-more 用不同 data-dsh-hob，避免机检串台（L-3） */
  }, '另有 ' + (blockers.length - 1) + ' 条阻断（不是健康缺口）')] : []),
)
```

**3.4 同屏排版口径（任务书要求「与 T-09 同屏，必须一起考虑排版」）**

渲染顺序（`:3059-3062` 实测）：`healthBlock → inFlightBlock → mainlineBlock → selectedNextBlock`

| 位置 | 修后文本 | data 属性 | 读者该理解为 |
|---|---|---|---|
| healthBlock（顶部，红） | 「账本健康：50 条缺口（先补齐才能派活）」+「另有 38 条」 | `data-dsh-hob="stages-health"` / `data-count` / `data-truncated` | **账本层面的缺口**（跟「哪条需求走到哪」无关） |
| selectedNextBlock（下方） | 「下一步：…」+「卡在哪：G3 · 任务依赖成环：A → B」+「另有 2 条阻断（不是健康缺口）」 | `data-dsh-hob="stages-next"` / `data-blocker-count` | **这条需求此刻推进不下去的原因** |

**两条硬约束**：

1. 两个「另有」必须**字面不同**（一个「另有 N 条」、一个「另有 N 条阻断（不是健康缺口）」）——否则读者会以为是同一件事拆成两处。
2. 两个块**不合并**：健康块回答「账本缺什么」（全局），next 块回答「这条卡在哪」（单链）。合并会把两个口径塞进一行 —— 那正是 `:2224-2234` 注释里反复强调「不许在客户端另算一份」的邻居错误。

### ④ 依赖与冲突

- **必须先做**：**O-32 去重**（pipeline-view.ts，否则 N 虚高）。
- **建议同批**：R-08（L-5，同一函数 buildRequirementChain）、T-09（L-3，同屏）。
- **会打架的地方**：
  1. **既有断言** `check-stages-panel-dom.mjs:3611-3640`（`stages-next-blocker-rest` 的条数断言）。改后：主阻断仍只印 `blockers[0]`、rest 文案从「另有 N 条」变「另有 N 条阻断（不是健康缺口）」⇒ **若断言匹配宽松正则仍通过；若匹配精确串则要改**。⚠ **实现时必须读那段再定**（本规格没有逐字抄那 30 行）。
  2. **`selectedNextBlock` 的空态**：改后「响应未带阻断清单」是**新分支**，既有断言若在「无阻断」夹具上匹配「没有主阻断」⇒ 需确保夹具给了 `blockedBy: []`（而不是缺字段）⇒ 否则会红。⚠ 这是一处**有意的收紧**（缺字段 vs 空数组必须分开），PR 里要写明。
  3. **`nextOfPipeline`（`:82-113`）**：它的 `return chain.next` 兜底会让服务端合并好的 blockedBy **被保留**（因为 partial.next 就是 chain.next）⇒ **客户端这里不用改**。⚠ 但 `:105-110` 的 legacy 分支是覆盖式（`blockedBy: chain.pipeline.blockedBy`）—— 保留。


### ⑤ 验证方式（含**负向对拍**）

**V-T08-a（G3 有环 ⇒ next.blockedBy 必须非空）** — check-requirement-chains：

```js
const units = [
  U('R-1', 'req', 'agreed', { acceptance_criteria: ['a'] }),
  U('CHG-1', 'change', 'settled', { addresses: ['R-1'], path_decision: 'A' }),
  U('TSK-1', 'task', 'todo', { parent: 'CHG-1', ...BRIEF }),
  U('TSK-2', 'task', 'todo', { parent: 'CHG-1', ...BRIEF, after: ['TSK-2'] }),  // 自环
]
const c = mod.buildRequirementChains(units, 'x').chains[0]
assert(c.pipeline.gate === 'G3-tasks')
assert(Array.isArray(c.next.blockedBy) && c.next.blockedBy.length > 0, 'next.blockedBy 为空 ⇒ T-08 没修')
assert(c.next.blockedBy.some((x) => /依赖成环/.test(x)), 'blockedBy 里没有环的说明')
```

**V-T08-b（DOM 层：面板「卡在哪」显示该环）** — check-stages-panel-dom：

```js
const blk = document.querySelector('[data-dsh-hob="stages-next-blocker"]')
if (!/依赖成环/.test(blk.textContent)) bad('面板「卡在哪」没有显示任务依赖成环')
const box = document.querySelector('[data-dsh-hob="stages-next"]')
if (box.getAttribute('data-blocker-count') === '0') bad('data-blocker-count 为 0 ⇒ 阻断没进面板')
```

**V-T08-c（负向对拍 A：删掉 G3–G6 合并分支 ⇒ 必须红）**：

```js
const src = readFileSync(join(root, 'src/shared/requirement-chain.ts'), 'utf8')
const mutated = src.replace(/} else if \(pipelineGoverns\) \{\n[\s\S]*?\n\}/, '}')
if (mutated === src) bad('T-08c · 造不出变体（源码形态已变）')
// ⇒ 跑 V-T08-a：next.blockedBy 为空 ⇒ 必须红
```

**V-T08-d（负向对拍 B：O-32 去重删掉 ⇒ N 虚高，断言必须红）**：

```js
// 造一条「既是某 VER 又是某任务最新验证」的 VER（pipeline-view.ts:326 与 :341 两次 push）
// 断言 blockedBy 里该条**只出现一次**
if (new Set(c.next.blockedBy).size !== c.next.blockedBy.length) bad('blockedBy 仍有重复项 ⇒ O-32 没修')
```

**V-T08-e（肉眼可见）**：

```
① 造一条任务图有环的需求（TSK-2 的 after 指向自己）
② 修前：面板「下一步：派发已就绪任务…」+「卡在哪：**没有主阻断**」← 假信号
   而 pipeline.blockedBy 里写着「G3 · 任务依赖成环：TSK-2 → TSK-2」
③ 修后：面板「卡在哪：G3 · 任务依赖成环：TSK-2 → TSK-2」+「另有 N 条阻断（不是健康缺口）」
   ⇒ 用户第一次能读到「为什么派不出去」
```

### ⑥ 回退方式

- 服务端：删掉新增的 `else if (pipelineGoverns)` 分支（回到只注入 G1/G2）。
- 客户端：文案改回「另有 N 条」、空态改回单一「没有主阻断」（**但请同时接受「假信号」回来**）。
- 零账本副作用。

### ⑦ 改动面等级

**跨模块**（`src/shared/requirement-chain.ts` + `src/shared/pipeline-view.ts`（O-32）+ `src/client/project-panel.tsx`）。

---


## §6 T-16 · 切账本清 itemDetails（high）

### ① 缺陷编号与位置

- `T-16`（REVIEW §5.3，high）；
- `src/client/project-panel.tsx:1150-1169`（itemDetails state + loadItemDetails，早退在 `:1154`）—— **实测与 REVIEW 一致**；
- `src/client/project-panel.tsx:2217-2221`（切换账本 effect，只重置 3 样）—— **实测一致**（`setSelectedReqId` @2218、`defaultAppliedRef` @2219、`setExpanded` @2220、依赖 `[selectedLedger]` @2221）；
- `src/client/project-panel.tsx:970-973`（loadResource 已带 selectedLedger）、`:1720`（renderStageItem 读缓存：`const loaded = itemDetails[String(it?.id ?? '')]`）；
- 证据等级：**实测**（`grep -n 'setItemDetails({})' src/client/project-panel.tsx` ⇒ **零命中**）。

### ② 改什么

project-panel.tsx：切换账本 effect 与 loadItemDetails 的缓存键。**二选一**（见 ③ 的 D-B）。

### ③ 具体改法

**方案 A（推荐，最小）：在切换账本的 effect 里 reset**

```ts
/** 切换账本 ⇒ 清掉上一本的需求选择、展开态**与展开详情缓存**，⛔ 不把上一本的内容带过来。 */
React.useEffect(() => {
  setSelectedReqId(undefined)
  defaultAppliedRef.current = false
  setExpanded(new Set())
  /**
   * ⚠⚠ **必须一起清 itemDetails**（T-16）。
   *   它按**裸 ID** 为键（R-001 / TSK-001 每本账都从 001 起）⇒ 不清的话，
   *   账本 A 里展开过的 R-001，切到账本 B 后命中 loadItemDetails 的
   *   `itemDetails[id]?.kind === 'ok'` 早退（:1154）⇒ **显示 A 的正文**，
   *   且早退在每次展开时都成立 ⇒ **永远不会自愈**。
   *   ⚠ 这是「界面有内容、格式正确、内容属于另一个项目」—— 最难被用户识别的一类。
   */
  setItemDetails({})
}, [selectedLedger])
```

**方案 B（更彻底）：缓存键带账本前缀**

```ts
// loadItemDetails 内
const key = (selectedLedger ?? '') + '/' + id
if (id === '' || itemDetails[key]?.kind === 'ok' || itemDetails[key]?.kind === 'reading') return
// 三处 setItemDetails 都用 key
// renderStageItem（:1720）读的时候同样拼前缀
const loaded = itemDetails[(selectedLedger ?? '') + '/' + String(it?.id ?? '')]
// ⇒ 此时**不再需要** :2217 的 setItemDetails({})（旧账本条目自然 miss）
```

**[待拍板] D-B** —— A 还是 B：

| 选项 | 优点 | 缺点 |
|---|---|---|
| **A（推荐）** | 1 行；改动面最小；与现有三样 reset 同一语义（「换账本 = 换上下文」） | 切回原账本时**重新拉一次**（可接受：loadResource 本来就按账本取） |
| B | 切回原账本命中缓存、不重复请求 | 键拼接散落 **5 处**（load 1 + set 3 + render 1），任一处漏拼就变成「永远 miss」⇒ **静默变成每次都请求**（不报错）；`selectedLedger === undefined` 时前缀是空串，两本「未解析」账会共享键 |

> **推荐 A 的理由**：B 的失败模式（漏拼前缀 ⇒ 每次展开都重请求）恰好是本仓最忌的「静默降级」；A 的代价（切回重拉一次）是**可观测的少量流量**。T-16 的核心要求是「不许串台」，A 用最小改动面达成。**若将来要加 B 的缓存优化，必须先加一条「键必须含账本」的机检**（否则漏拼无人发现）。

⚠ **本规格不动的相邻问题**：`loadItemDetails` 的 `useCallback` 依赖是 `[itemDetails, loadResource]`（`:1169`）—— itemDetails 在依赖里意味着每次缓存变化都重建回调。影响面比 O-18 小（loadItemDetails 只在 onToggle（`:1753`）里调），属 `O-23` 的死字段/依赖清理面，**不属 T-16**。


### ④ 依赖与冲突

- **必须先做**：无。
- **建议同批**：O-18（若改动 A 未带上）、O-23（死字段，同片 effect 区）。
- **冲突点**：
  - `check-stages-panel-dom.mjs` 的逐 ID 懒读取断言（`ITEM_RESOURCE_UNITS`，`:295-303`）**不受影响**（单账本场景不跑切换 effect）。
  - 切换账本的既有断言需复用现有 `stages-ledger-item` 点击写法（`:2774-2795` 附近）。**本规格未逐字抄那段**，实现时以源码为准。

### ⑤ 验证方式（含**负向对拍**）

**V-T16-a（切账本后同名 ID 显示新账本正文）**：

```js
const books = {
  alpha: { 'requirement/R-001': { id: 'R-001', kind: 'req', title: 'ALPHA-标题', status: 'agreed' } },
  beta:  { 'requirement/R-001': { id: 'R-001', kind: 'req', title: 'BETA-标题',  status: 'agreed' } },
}
const fetchResource = async (_sid, resource) => {
  const unit = books[currentBook][resource]
  return unit === undefined
    ? { ok: false, resource, reason: 'not-found', message: '没有' }
    : { ok: true, resource, card: { unit, presentation: { displayTitle: unit.title, relation: null, facts: [], flags: [], details: [] } }, children: [] }
}
// ① alpha 下展开 R-001 ⇒ 断言含 ALPHA-标题
// ② 点 ledger 切到 beta
// ③ 展开 R-001 ⇒ **断言含 BETA-标题、且不含 ALPHA-标题**
```

**V-T16-b（负向对拍：删掉 reset ⇒ 必须红）**：

```js
const mutant = buildMutant('t16-no-reset', (t) => t.replace('  setItemDetails({})\n', '\n'))
// ⚠ 先自证：mutant 源码里 setItemDetails({}) 出现次数为 0
// ⇒ 跑 V-T16-a：第 ③ 步仍显示 ALPHA-标题 ⇒ 断言必须红
```

**V-T16-c（肉眼可见）**：

```
① 面板顶部「项目：dsh-hob」下拉切到第二本账（如 prompt-enhancer-release）
② 展开第二本账的 R-001 ⇒ 标题 / 状态 / 详情必须属于第二本
   修前：这里是第一本 dsh-hob 的 R-001 全文，且**无论怎么点都不会变**
③ 切回第一本 ⇒ 展开体短暂「读取中…」再出内容（方案 A 的预期代价）
```

### ⑥ 回退方式

删掉那一行 `setItemDetails({})`（A）/ 把键改回裸 id（B）。**零数据副作用**。

### ⑦ 改动面等级

**局部**（单文件；A = 1 行 + 注释，B = 5 处键拼接）。

---


## §7 其余 high 与 T-14 的并入/转出裁定（按 REVIEW §5 核对）

### 7.1 T-14 —— **转出本域**（不并入）

- REVIEW §5.3 `T-14`（high）：`session-policy-service.ts:131-132`（上限）、`:159-169`（丢最旧）、`:104`（Map 在进程内存）、`:190-192`（console.warn）。
- **本次实测复核**：`PENDING_MAX_PER_SESSION = 32`、`PENDING_MAX_TOTAL_CHARS = 256*1024`（`:131-132`）；丢最旧两个 while 在 `:159-169`；`loggerWarn` 定义在 `:190-192` 且走 console.warn。
- **判定**：**宿主侧**的落盘/可观测问题，与客户端取数链路**无交集**。客户端唯一能做的是「把 dropped 计数显示出来」，而那**依赖服务端先落盘**（REVIEW §7.4 已把「丢弃计数进 session-policy-blocks.json」列为方向）。
- ⇒ **规格归 policy 域**。本文件只留一句交接：**若服务端把 dropped 写进 blocks 文件，客户端可在 hob-unselected-gate 横幅上加一行「已丢弃 N 条超限消息」**（新增 i18n 键 2 个；改动面：局部；**属 P4，不阻塞本批**）。

### 7.2 O-18（Current 面板每秒重取）—— **并入改动 A**

- REVIEW §5.4 `O-18`（medium）：`project-panel.tsx:3011`（内联 fetchCurrent）、`:1124-1129`（1s 时钟）、`current-panel.tsx:97-110`。
- **实测复核**：`:3011` 是 `fetchCurrent: async (sessionId?: string) => loadResource('current')`（**每次渲染新引用**）；`current-panel.tsx:110` 的依赖数组含 `props.fetchCurrent`；`:1124-1129` 的 1s 时钟只在 hasRunningExec 为真时跑。
- **为什么并入**：见 L-6。不并 ⇒ T-04 的降级徽标被 O-18 反复点亮。

**改法（与 T-04 同一提交）**：

```ts
// project-panel.tsx：把内联函数提成 useCallback
const fetchCurrentResource = React.useCallback(
  (signal?: AbortSignal) => loadResource('current', signal),
  [loadResource],
)
// :3008-3013 改成
React.createElement(CurrentPanel, {
  sessionId: props?.sessionId,
  refreshTick: pollTick,
  ...(props?.fetchCurrent === undefined ? { fetchCurrent: fetchCurrentResource } : { fetchCurrent: props.fetchCurrent }),
}),
```

⚠ CurrentPanel 侧**不需要改**（effect 依赖引用稳定后，只在 refreshTick 变化时重跑）。

**负向对拍**：改回内联 ⇒ 在 hasRunningExec=true 的夹具里跑 10 秒，断言 /ledger-resource 请求数 **≤ 2**（REVIEW 给的判据）。修前 ≈10。

### 7.3 O-36（工作计划路由也没有 404/405 分支）—— **并入改动 A（顺手）**

- REVIEW §5.4 `O-36`（low，V-10）：`project-panel.tsx:956-966`（内联 defaultFetchPlans）、`:1390-1398`（runPlans 的 catch 无 isStale 分支）。
- **实测复核**：`:956-967` 里 `if (!res.ok) return { ok: false, reason: 'route-error', … }`（无 404/405 特判）；runPlans 的 catch（`:1394-1398`）只 `setPlansState({ kind:'fail', message })`。
- **为什么并入**：T-04 要给这个内联函数加 signal，**同一个函数要改**；顺手补 4 行，避免三次触碰同一段。

**改法**：

```ts
// loadPlans 内联函数体（:956-967）加两处（照 defaultFetchStages 的形态）：
if (res.status === 404 || res.status === 405) {
  throw new StaleRouteError('这个路径没有处理体（可能是方法或前缀不对）：' + WORK_PLANS_ROUTE_PATH + ' · HTTP ' + res.status)
}
// ⚠ 需 import WORK_PLANS_ROUTE_PATH（work-plan-panel.tsx:16 已导出）——
//   同时消掉「同一路由字符串写两份」那条（§7.5）
// runPlans（:1390-1398）的 catch 补 isStale：
} catch (e) {
  if (!alive) return
  const isStale = e instanceof StaleRouteError
  setPlansState({ kind: 'fail', message: (isStale ? '接不上：' : '请求失败：') + String((e as Error)?.message ?? e) })
  return
}
```

**负向对拍**：mock 404 ⇒ 断言抛 StaleRouteError（而非返回 `{ok:false,reason:'route-error'}`）。改回 `!res.ok` 直返 ⇒ 断言红。

### 7.4 O-41（预设门禁按「属性在不在」判）—— **不在本批，但与本批的徽标联动**

- REVIEW §5.4 `O-41`（medium，V-09，**主控已拍板采 A：三态化**）：`project-panel.tsx:899-902`。
- **实测复核**：`presetProvided = props !== undefined && Object.prototype.hasOwnProperty.call(props, 'agentPreset')`；`blockedByPreset = presetProvided && !isHobPreset`。
- **为什么不并入**：它改的是**门禁判据**（blockedByPreset 的真值表），属 P0「入口封堵」，已由 `01-judgment.md` 一类规格覆盖。**但** T-04 的 §2 ③3.4 新增 `unknown` 徽标档**正好是 O-41 的观感出口**。
- ⇒ **本文件只登记依赖，不展开改动**：标 `[依赖 O-41]`。O-41 落地后，StagesPanelLive 应把「宿主未提供 useTabInfo」作为 visibilityUnknown 传给面板，徽标才有真值可说。

### 7.5 低优先同批项（建议随改动 A 一起，不单开）

| 编号 | 位置（实测） | 一行改法 |
|---|---|---|
| `O-23`（low） | liveStateRef：`:1135` 声明、`:1472`/`:1537` 写、**零读** | 删掉该 ref 及两处赋值（节拍实际读 `live?.state()`，`:1511/1529/1548`） |
| 同 `O-23` | activeCount / completedCount / retiredCount / unattached：`:1341-1345` 存、**零读**；面板 `:2176` 自己 filter 数一遍 | 渲染改用 `chainState.completedCount`；state 里其余三项删 |
| `O-36` 姊妹 | work-plans 路由常量写两份（`:957` 字面量 vs `work-plan-panel.tsx:16` 导出） | 改 import（已在 §7.3 里） |

⚠ **不建议同批**：`O-21`（面板零 i18n，12760 CJK / t()=0）—— 13k 字符翻译工程，与可观测性无关，**必须单独排期**。

---


## §8 执行顺序（按「让失败不可观测 → 缺陷本身」）

| 批次 | 内容 | 为什么排这里 | 能否独立合入 |
|---|---|---|---|
| **A** | **T-04 + T-09 + O-18 + O-36**（+ §7.5 死字段） | 「让失败不可观测」的四条之首；四条同文件同函数族 ⇒ **一次触碰**。修完**不需要任何账本变化**就能演示 | ✅ |
| **B** | **T-16** | 独立缺陷，与 A 无耦合；同文件不同区域 | ✅ |
| **C** | **R-08**（服务端三点 + 客户端表） | 跨模块，**必须同批**；会改变 legacy 链的可见输出（属「缺陷本身」而非可观测性） | ⚠ 需先存基线（§4 ⑤ 前置） |
| **D** | **T-08 + O-32** | 依赖 C 的同一次返回；同屏排版与 T-09 已对齐（L-3）；O-32 必须先于 T-08（否则 N 虚高） | ✅（与 C 同批更省一次基线） |

**A 与 B 之间无依赖**，可并行；**C 是唯一必须「同一个人一次做完」的**（跨模块联动 L-4）。

---

## §9 验证面汇总（每条改动怎么证明有牙）

| 改动 | 正证 | 负向对拍 | 肉眼可见 |
|---|---|---|---|
| **A · T-04** | 挂起一路 fetch ⇒ `data-stalled='true'` / `data-state='degraded'` / 文案含「停止刷新」且**不含「已连接」** / 其他路调用数继续增长 | ①FETCH_TIMEOUT_MS=Infinity ⇒ 面板定格、徽标停 connecting；②删 watch-dog ⇒ 全挂起时零新增；③徽标改回只看 liveState ⇒ 仍宣称已连接 | devtools Block URL ⇒ 徽标变红并说「N 秒前」 |
| **A · T-09** | 41 条 ⇒「41 条缺口 / 另有 29 条」；count:300 无 problems ⇒「300 条缺口 / 未随本次返回」/ `data-state='unhealthy'` | ①头部改回 problems.length ⇒ 变 40；②data-state 改回按 problems 判 ⇒ 变 ok；③「另有」改回 shown-12 ⇒ 变 28 | 50 缺口账：修前少报 10 条、修后全量 |
| **A · O-18** | 运行态 10s 内 /ledger-resource ≤ 2 次 | 改回内联 ⇒ ≈10 次 | devtools Network 不再每秒一条 |
| **A · O-36** | mock 404 ⇒ 抛 StaleRouteError | 改回 `!res.ok` 直返 ⇒ 断言红 | 路由改名后面板说「接不上：这个路径没有处理体」而非「资源读不到」 |
| **B · T-16** | 切账本后同名 ID 显示新账本正文 | 删 `setItemDetails({})` ⇒ 仍显示旧正文 | 切账本展开 R-001 内容跟着变 |
| **C · R-08** | 服务端 total=2/done=2/itemIds=ACC；客户端 kindOfStep(5,true)='acc' | ①服务端改回 verifications ⇒ total=0；②客户端表不改 ⇒ kind 返回 verification；③E2E 标签仍印「待技术验证」 | legacy 第 5 行从「已完成/0/0/没有条目」变「2/2 + 两条 ACC」 |
| **D · T-08** | G3 有环 ⇒ `data-blocker-count > 0` 且「卡在哪」含该环 | ①删 G3–G6 分支 ⇒ blockedBy 空；②O-32 去重删掉 ⇒ 有重复项 | 造有环任务图 ⇒ 面板首次说出环 |

---

## §10 未验证与不做的事（诚实标注）

| 项 | 状态 | 说明 |
|---|---|---|
| 30s 超时是否对所有宿主都够 | **未验证** | 依据是「同仓既有出口 + 三条推理」（§2 ③3.1）。**没有真机量过最慢响应**。若上线后误报，D-A 的 B（15s）也不解决 —— 那要按实测分布定值。 |
| `useTabInfo` 是否由宿主注入（REVIEW U-6） | **未验证** | 决定 effectiveVisible 恒 false 的静默冻结是否真实存在。本规格给 `unknown` 档让它**一旦发生就可观测**，但**没有**修根因（宿主契约，需 host-probe）。 |
| R-08 会让多少存量 legacy 账本改变显示 | **未验证** | 需对真实 ledgerHome 下的账本跑前后对比。方法（先存基线）已给，**没有实跑**。 |
| T-09 的超长文案在窄侧栏的排版 | **未验证** | 「另有 N 条未随本次返回（响应超体积上限，可按 ID 读全文）」未做宽度度量。可缩短但不建议（信息量比美观重要）。 |
| T-08 与既有 DOM 断言的冲突面 | **部分未验证** | `check-stages-panel-dom.mjs:3611-3640` 只读了行号与作用，**没有逐字核**它匹配的是「另有 N 条」原文还是正则 ⇒ 实现时必须读那段再定（§5 ④ 已标）。 |
| 面板零 i18n（O-21） | **不做** | 13k 字符翻译工程，与可观测性无关，**单独排期**。 |
| O-41 三态化 | **不在本批** | 属 P0 门禁判据；只登记 T-04 徽标与它的对齐依赖（§7.4）。 |
| T-14 | **转出** | 宿主侧（session-policy-service.ts），归 policy 域（§7.1 给了交接）。 |
| **本次未运行任何脚本** | — | 全部结论来自读码 + grep/sed；**没有**执行 `check:*` / `typecheck` / `build`（纪律：只读）。⇒ 所有「改后会通过」都是**规格**，不是**结果**。 |

---

## 附录 A · 行号漂移对照（REVIEW.md vs 本次实测）

| 引用 | REVIEW.md | 本次实测 | 结论 |
|---|---|---|---|
| `pulling` 闸 | `:1407-1445` | `:1407-1447`（`let pulling` @1407 / `pull` @1410 / `allSettled` @1430 / `setPollTick` @1446 / 首调 @1447） | ✅ 一致（区块尾延到 1447，属首调那一行） |
| 取数函数个数 | 「六个」 | **7 个 defaultFetch + 1 个内联 work-plans = 8 个 fetch 调用点**（`:323/384/408/531/561/589/608/957`） | ⚠ 计数不准；本规格按 8 处覆盖 |
| `healthBlock` | `:2244-2257` | IIFE `:2236-2268`；关键行 2244 / 2249 / 2250 / 2253 / 2257 / 2264-2266 | 关键行一致，区块范围更宽 |
| `itemDetails` | `:1150-1169` | 一致（早退 @1154，deps @1169） | ✅ |
| 切账本 effect | `:2217-2221` | 一致 | ✅ |
| `STAGE_KIND_BY_STEP` | `:148-156` | 表体 `:148-156`；`kindOfStep` @159-161；消费点 @1744；签名 @1714；调用点 @2613 / @2689 | ✅（并补出 4 处关联点） |
| R-08 服务端 | `:117` / `:307-311` / `:349` / `:391` | 全部一致；**另发现 `:367-368` 与 `:380-381` 也取 verifications**（REVIEW 未点） | ⚠ 漏两处，本规格补齐 |
| `pipelineGoverns` 三分支 | `:521-540` | `:519` 起（`const pipelineGoverns` @519）；G1 @**521**、G2 @**531**、legacy @**541** | ✅ 两分支起点与 REVIEW 一致（511-540 覆盖 G1+G2）；legacy 分支在 541 起，REVIEW 未列 |
| `liveState` 四档 | 未列 | `live-client.ts:18` | 新增证据 |

## 附录 B · 编号错位登记（供主控核对）

| 任务书 | REVIEW.md | 处置 |
|---|---|---|
| 「O-31 legacy 第 5 步」 | **`R-08`**（high，§5.1）+ 专章 §3.4 链 D | 本文件按 `R-08` 写（§4） |
| （REVIEW 的 `O-31` 本体） | `check:profile --fix` 会写盘（low，`check-profile-assembly.mjs:71,732`） | **不属本域**，未处理 |
| 「T-14」 | `T-14`（high，§5.3）但属 policy 域 | §7.1 转出 |
| 「O-32」（本规格新增依赖） | `O-32`（medium，blockedBy 同条重复 push） | **必须与 T-08 同批**（§5 ③3.2） |

