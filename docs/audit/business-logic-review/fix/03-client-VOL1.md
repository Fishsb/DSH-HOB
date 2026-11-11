# 03-client · 分卷 1

> ⚠ 本文件是 `fix/03-client.md` 的**分卷**（原文件超 64KB 读上限，
> 按 `check:gitignore` 的 M 判据处置：**整块搬走 + 原位留指针**，⛔ 不是压缩）。
> 主文件：`docs/audit/business-logic-review/fix/03-client.md`。

---

# 修复规格 03 · 客户端可观测性与视图出口（T-04 / T-09 / T-08 / T-16 / R-08）

> **输入底稿**：`REVIEW.md`（§1.3 优先级 / §3.3 / §3.4 / §5.3 T-系列 / §5.4 O-系列 / §7.4 D-12·D-13 / §8.1 联动项 / §8 P1 路线图）、`client.md`（t5 域报告 19 条）、`VERIFICATION.md`、`LEAD-VERIFICATION.md`。
> **本文件只出规格，不改代码**。全部行号已于本次读码逐条复核；与 REVIEW.md 有出入处**就地标注**「⚠ 行号漂移」并给源码实测值。
> 证据等级沿用 `01-judgment.md` §0.1 的四档（**实测** / **读码** / **推断** / **未验证**）。

## §0 编号对齐（先读这一节，编号有一处错位）

| 任务书给的 | REVIEW.md 实际编号 | 说明 |
|---|---|---|
| T-04 / T-09 / T-08 / T-16 | 同名 | 一致 |
| **O-31**（legacy 第 5 步状态源与条目源分裂） | **`R-08`** | ⚠ **编号错位**：REVIEW.md 的 `O-31` 是另一条缺陷——「`check:profile --fix` 会写盘」（§5.4，low，`check-profile-assembly.mjs:71,732`）。legacy 第 5 步在 REVIEW 里记为 **`R-08`**（§5.1，high，联动修复项）+ 专章 **§3.4 链 D**。本文件按 `R-08` 写，附录 B 登记错位。 |
| T-14 | 同名 | 但**不属于本域**：T-14 是 `session-policy-service.ts` 的「被拦消息超限丢最旧只有一条 `console.warn`」（§5.3，high）。**见 §7.1 的转出裁定。** |

**结论**：本文件覆盖 **T-04 / T-09 / T-08 / T-16 / R-08** 五条 + §7 的并入/转出裁定（T-14 / O-18 / O-36 / O-41）。

---

## §1 全景：改动落在哪些文件、哪些必须同批

| 批次 | 内容 | 文件 | 能否独立合入 |
|---|---|---|---|
| **A** | T-04 + T-09 + O-18 + O-36（+ §7.5 死字段） | `src/client/project-panel.tsx` | ✅ |
| **B** | T-16 | `src/client/project-panel.tsx` | ✅ |
| **C** | R-08（服务端三点 + 客户端表） | `src/shared/requirement-chain.ts` + `src/client/project-panel.tsx` | ⚠ 必须同批 |
| **D** | T-08 + O-32 | `src/shared/requirement-chain.ts` + `src/shared/pipeline-view.ts` + `src/client/project-panel.tsx` | ✅（与 C 同批更省一次基线） |

### 1.1 六条联动约束（拆开就会静默错）

| # | 联动 | 拆开的后果 |
|---|---|---|
| **L-1** | T-04 + T-09（同文件同函数族） | 任务书已点名「必须合并成一次改动」。T-04 给 `defaultFetch*` 加 `signal`、T-09 改 `healthBlock` 的读法；两者都在 `project-panel.tsx`，分两次合入会让第一次的机检基线失真（超时引起的 `fail` 态与健康块的 `data-state` 判据互相干扰）。 |
| **L-2** | T-04 超时 ↔ `pulling` 复位 | 只加超时、不加复位兜底：超时抛错后 `Promise.allSettled` 会 settle，理论上 `pulling` 会复位；但**`AbortController` 不可用的宿主**下超时根本没机会触发 ⇒ 必须有独立的 watch-dog 复位（§2 ③3.3）。 |
| **L-3** | T-08 + T-09（同屏） | 两者都往「另有 N 条」这个文案槽写字，且 `healthBlock` 与 `selectedNextBlock` 相邻渲染（`:3059-3062` 实测顺序 `healthBlock → inFlightBlock → mainlineBlock → selectedNextBlock`）。分开改会出现**两个「另有 N 条」上下相邻**、读者无法区分。排版口径见 §5 ③3.4。 |
| **L-4** | R-08 服务端 + 客户端 | **两个方向都是静默的**，详见 §4 ③3.3 的表。只改服务端 ⇒ ACC 状态查 verification 表，`pass` 印「技术验证通过」，且 `stageStatusLabel` **不会返回 `known:false`**；只改客户端 ⇒ VER 被打上 ACC 标签，`waived` 落进「判不出（原值 waived）」。 |
| **L-5** | R-08 ↔ T-08 | 两者都改 `buildRequirementChain` 的同一次返回（前者改 `steps[].itemIds`，后者改 `next.blockedBy`）。技术**不冲突**，可分开合；同批可少一次基线重跑。**建议同批，不强制**。 |
| **L-6** | T-04 ↔ O-18 | T-04 给 `loadResource` 加 `signal`，而 `CurrentPanel` 是它唯一的超额调用方（`:3011` 内联 ⇒ 每秒一次）。若 T-04 修完而 O-18 未修 ⇒ 每秒一次带超时的请求 ⇒ `stalled` 反复置位、徽标反复闪「取数超时」⇒ **T-04 的修复效果被 O-18 掩盖**。⇒ 必须同批。 |

---
## §2 T-04 · 面板永久停刷（blocker）

### ① 缺陷编号与位置

- `T-04`（REVIEW §5.3，blocker）
- 位置（**本次实测**）：
  - `src/client/project-panel.tsx:1407-1447`（`pulling` 闸）。**复核结论：REVIEW 的 `:1407-1445` 准确**，实测 `let pulling = false` @**1407**、`pull` 定义 @**1410**、`Promise.allSettled` @**1430**、`setPollTick` @**1446**、`pull()` 首调 @**1447**（区块末）。
  - **8 个 `fetch` 调用点**（实测 `grep -n 'await fetch(' src/client/project-panel.tsx`）：`:323` progress、`:384` ledgers、`:408` exec、`:531` stages、`:561` chains、`:589` unseen、`:608` resource、`:957` work-plans（内联）。⚠ REVIEW 说「六个」，实测 **7 个 defaultFetch 函数 + 1 个内联 = 8 个调用点**。
  - 徽标渲染：`:3093-3104`
  - 传输层状态封闭集：`src/client/live-client.ts:18`（connecting / live / reconnecting / fallback）——**没有「数据通道已降级」这一档**，这是徽标只能说「已连接」的结构原因。
- 证据等级：**实测**（8 个 fetch 行号、pulling 三处赋值、四档类型全部 sed 确认）

### ② 改什么

| 文件 | 改动 |
|---|---|
| `src/client/project-panel.tsx` | ① 新增 FETCH_TIMEOUT_MS + timeoutSignal()；② 7 个 defaultFetch* 与内联 loadPlans、loadResource 全部接 signal；③ pull() 加 watch-dog 复位 + pullSeq；④ 徽标增「已降级」语义（本地 state，**不动** LiveConnectionState 封闭集） |

### ③ 具体改法

#### 3.1 超时常量与取值依据（任务书要求「定超时时长取值依据」）

```ts
// src/client/project-panel.tsx —— 放在 STAGES_POLL_MS（:249）附近
/**
 * 单次取数超时。取值依据（三条，逐条可核）：
 *  ① 与同仓既有的浏览器 fetch 超时同值：create-hob-dialog.tsx:373 的
 *     DEFAULT_CALL_TIMEOUT_MS = 30000，注释（:370-372）写「30s 与宿主侧同类通道口径一致」。
 *     ⛔ 不新造第二个数字 —— 同一浏览器、同一类只读 RPC，两条通道两个超时是无理由的分叉。
 *  ② 必须相对最长安全轮询间隔（LIVE_SAFETY_POLL_MS = 60_000，shared/live-protocol.ts:25）
 *     留出余量：一次请求必须在下一个周期排上之前结束，否则就是在堆积。
 *     30s 给单次请求 30s 预算、留 30s 给下一轮 ⇒ 语义正确。
 *     ⚠ 若取 >= 60s，则「卡死」与「慢轮询」在观感上无法区分（都是每分钟一次）。
 *  ③ 必须远大于一次快照的真实耗时：六条只读路由都是「读 index.toml + 纯函数投影」，
 *     无网络外呼；夹具 <50ms，最坏情况（compact 线 64KB 上限 / 体积兜底）也在百毫秒级。
 *     30s 给了约 100 倍余量 ⇒ 不会误杀「慢而正常」的请求。
 */
export const FETCH_TIMEOUT_MS = 30_000
```

**[待拍板] D-A** —— 超时值：

| 选项 | 说明 |
|---|---|
| **A（推荐）** | `FETCH_TIMEOUT_MS = 30_000`，与 `create-hob-dialog.tsx:373` 同值 |
| B | `15_000`（更早暴露卡死）；代价：与既有 30s 分叉，且对极慢宿主更易误杀 |
| C | 移到 `shared/live-protocol.ts`，与 `LIVE_SAFETY_POLL_MS` 放一起（跨端共享，但服务端不用它） |

> 推荐 A 一句话理由：**同一浏览器里两条 fetch 通道用两个超时，就是又一处口径分叉——本仓的主线问题正是分叉。**

#### 3.2 timeoutSignal() 与每个取数函数接 signal

```ts
/**
 * 生成一个带超时的 signal。超时后 fetch 抛 AbortError（与 fetch 自身的 abort 同形），
 * 所以调用方现有的 catch 分支（:1194/1225/1261/1325/1365 五处）原样生效，无需改结构。
 *
 * ⚠ 为什么包 fetch 而不是包整个 defaultFetch*：
 *   包 fetch 才能把 signal 传到底层（真正取消连接）；包外层只能「放弃等待」，
 *   连接会留在宿主里直到自然结束 —— 那只是把「面板卡住」换成「连接泄漏」。
 * ⚠ AbortController 不可用时（裁剪宿主 / 老 jsdom）：退化为「只计时不取消」，
 *   返回的 timedOut() 仍可为 true ⇒ 供 3.3 的 stall 判据使用。
 */
function timeoutSignal(ms: number): { signal?: AbortSignal; done: () => void; timedOut: () => boolean } {
  const AC = (globalThis as any).AbortController
  if (typeof AC !== 'function') {
    let fired = false
    const timer = setTimeout(() => { fired = true }, ms)
    return { done: () => clearTimeout(timer), timedOut: () => fired }
  }
  const ctrl = new AC()
  const timer = setTimeout(() => { try { ctrl.abort() } catch { /* 忽略 */ } }, ms)
  return { signal: ctrl.signal, done: () => clearTimeout(timer), timedOut: () => ctrl.signal.aborted }
}
```

**每个 defaultFetch 的改法（以 defaultFetchStages 为例，逐个照抄）**：

```ts
export async function defaultFetchStages(sessionId?: string, ledger?: string, signal?: AbortSignal): Promise<any> {
  const body = { /* 原样不动 */ }
  const res = await fetch(STAGES_ROUTE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),   // ← 唯一新增
  })
  /* 其余 404/405 与 json 解析分支一个字不改 */
}
```

**signal 的插入位置（逐个给死，避免参数错位）**：

| 函数（实测行） | 现签名 | 改后签名 |
|---|---|---|
| defaultFetchProgress (:310) | (sessionId?) | (sessionId?, signal?) |
| defaultFetchLedgers (:382) | (sessionId?) | (sessionId?, signal?) |
| defaultFetchExec (:403) | (sessionId?, ledger?) | (sessionId?, ledger?, signal?) |
| defaultFetchStages (:524) | (sessionId?, ledger?) | (sessionId?, ledger?, signal?) |
| defaultFetchChains (:556) | (sessionId?, ledger?) | (sessionId?, ledger?, signal?) |
| defaultFetchUnseen (:587) | (sessionId?) | (sessionId?, signal?) |
| defaultFetchResource (:604) | (sessionId?, resource?, ledger?) | (sessionId?, resource?, ledger?, signal?) |
| loadPlans 内联 (:955-969) | (sessionId?, ledger?) | (sessionId?, ledger?, signal?) |
| loadResource (:970-973) | (resource) | (resource, signal?) |

⚠ 所有注入型 props（fetchStages / fetchChains / …）的类型也要加可选尾参，否则 loadXxx 的 useMemo 里调用会 TS 报错。这类改动**编译期可见**，不会静默。#### 3.3 pull() 的 watch-dog 与「复位后如何避免重复拉取」

```ts
let pulling = false
let pullAgain = false
let followUpsLeft = LIVE_MAX_FOLLOW_UP_PULLS
/** 本轮 pull 的单调序号：watch-dog 与正常结算都靠它判断「是不是我这一轮」。 */
let pullSeq = 0
/** 数据通道降级（任一取数超时）。⚠ 与 liveState 正交，⛔ 不合进 LiveConnectionState。 */
const [stalled, setStalled] = React.useState(false)
/** 最近一次「全部取数成功」的时刻；undefined = 从未成功（⛔ 不许用 Date.now() 冒充）。 */
const [lastOkAt, setLastOkAt] = React.useState<number | undefined>(undefined)

const pull = (runStagesAgain = true): void => {
  if (pulling) {
    if (followUpsLeft > 0) { pullAgain = true; followUpsLeft -= 1 }
    return
  }
  pulling = true
  const mySeq = ++pullSeq
  /** 本轮的超时标记（每个 run* 在 finally 里写进来）；用于区分「超时降级」与「业务失败」 */
  const timedOut: boolean[] = []

  /**
   * ⚠⚠ watch-dog：无论下面怎么结算，超过 FETCH_TIMEOUT_MS + 5s 必须放开闸。
   *   ＋5s 是给 abort 传播留的余量（abort 后 fetch 的 reject 是下一个 microtask，
   *   某些宿主 polyfill 会慢一拍）。
   *   ⚠ 这层兜底存在的理由：Promise.allSettled 只在**每个 promise 都 settle** 时 resolve；
   *     任何一条永久 pending（宿主打桩 / 某个 defaultFetch 内部自己串行化到死）
   *     ⇒ allSettled 永不 resolve ⇒ 闸永不放 ⇒ 面板定格（T-04 的原病，超时也救不了）。
   */
  const watchdog = setTimeout(() => {
    if (pullSeq !== mySeq || !pulling) return
    pulling = false
    setStalled(true)                            // ← 徽标据此降级（3.4）
    followUpsLeft = LIVE_MAX_FOLLOW_UP_PULLS    // 卡死后归还配额，避免「卡一次就永久丢后续失效帧」
    if (!alive) return
    /**
     * ⚠ 复位后补拉一次，而不是等下一个 tick：否则面板会停在「旧数据 + 已降级徽标」
     *   最长一个轮询周期（live 健康时是 60s）。
     * ⚠ **必须让出一轮宏任务**：watch-dog 自己就在定时器回调里，同步调 pull() 会立刻看到
     *   pulling=false 再次启动 ⇒ 在「服务端持续不回包」时形成不受 setInterval 节制的自旋。
     *   用 setTimeout(0) 明确让出 ⇒ 重试节奏仍由 poll 节拍主导。
     */
    setTimeout(() => { if (alive) pull() }, 0)
  }, FETCH_TIMEOUT_MS + 5_000)

  const requests: Array<Promise<void>> = []
  if (props?.fetchProgress !== undefined) requests.push(run())
  requests.push(runExec(), runChains(), runUnseen(), runPlans())
  if (runStagesAgain) requests.push(runStages())
  void Promise.allSettled(requests).then(() => {
    clearTimeout(watchdog)
    if (pullSeq !== mySeq) return      // ← 已被 watch-dog 判过 ⇒ ⛔ 不二次结算
    pulling = false
    if (!alive) return
    /**
     * ⚠ 只有「全部无超时」才清 stalled。
     *   判据用 timedOut[]（由 timeoutSignal().timedOut() 写入），⛔ 不掺业务性 fail：
     *   {ok:false, reason:'ledger-missing'} 是**正常读数**，不是降级；
     *   让它点亮降级徽标 = 把「账本还没建」说成「面板坏了」。
     */
    if (!timedOut.some(Boolean)) { setStalled(false); setLastOkAt(Date.now()) }
    if (pullAgain) {
      pullAgain = false
      pull()
    } else {
      followUpsLeft = LIVE_MAX_FOLLOW_UP_PULLS
    }
  })
  setPollTick((n) => n + 1)
}
```

**「复位后如何避免重复拉取」——四条约束，逐条可核**：

1. **pullSeq 单调**：watch-dog 与正常结算都先比 `pullSeq === mySeq`；晚到的一方直接 return ⇒ 不会二次 `pulling = false`、更不会二次 `pull()`。
2. **watch-dog 被正常结算 clearTimeout**：正常路径下它根本不会执行。
3. **补拉走 setTimeout(…, 0)**：不在定时器回调里同步重入 `pull()`（避免自旋），且补拉本身仍受 `pulling` 闸约束 ⇒ 最坏只排队一次。
4. **followUpsLeft 在卡死后归还**：否则「卡死一次 → 后续 3 次失效帧全丢」会让面板在服务端恢复后仍不刷新。

**每个 run* 怎么写 timedOut（以 runStages 为例）**：

```ts
const runStages = async (): Promise<void> => {
  const t = timeoutSignal(FETCH_TIMEOUT_MS)
  timedOut.push(false)                       // 预留槽位；finally 里覆盖
  const slot = timedOut.length - 1
  let res: any
  try {
    res = await loadStages(t.signal)         // ← loadStages 已改为透传 signal
  } catch (e) {
    if (!alive) return
    const isStale = e instanceof StaleRouteError
    /** ⚠ 超时必须落成**可读的 fail 态**，且文案要能区分「超时」与「网络错」（T-04 的可观测性要求） */
    const isTimeout = t.timedOut()
    setStageState({
      kind: 'fail',
      reason: isStale ? 'stale-route' : isTimeout ? 'timeout' : 'network',
      message: isStale ? '接不上：' + String((e as Error)?.message ?? e)
        : isTimeout ? '取数超时（' + Math.round(FETCH_TIMEOUT_MS / 1000) + ' 秒无响应）⇒ 面板本次未能刷新'
          : '请求失败：' + String((e as Error)?.message ?? e),
    })
    return
  } finally {
    timedOut[slot] = t.timedOut()
    t.done()
  }
  /* 其余形状校验原样不动 */
}
```

⚠ 同一形状套用到 run() / runExec / runChains / runUnseen / runPlans 五处。**六个 catch 分支现在有五处已有 isStale 三分支**（`:1194/1225/1261/1325/1365`），加 timeout 后变四分支。⚠ runPlans（`:1390-1398`）原本没有 isStale 分支 —— 由 O-36（§7.3）一并补上。

#### 3.4 徽标如何反映「已降级」（不能再显示「已连接」）

**问题定位（实测）**：徽标文案只由 `liveState` 决定（`:3100-3103`），`liveState` 只有四档（`live-client.ts:18`）。**「数据通道卡死」与「SSE 传输层状态」是两个正交维度**——SSE 可以健康（live）而快照取数全部超时。当前代码把两者混为一谈 ⇒ 「已连接」+「数据定格」能同时成立。

**改法（不动 LiveConnectionState）**：

```tsx
// :3093-3104 区块
React.createElement(
  'span',
  {
    'data-dsh-hob': 'stages-live-state',
    'data-state': stalled ? 'degraded' : liveState,   // ← 降级优先
    'data-transport': liveState,                       // ← 传输层原值保留，便于机检分开断言
    'data-stalled': stalled ? 'true' : 'false',
    style: {
      color: (stalled || liveState === 'fallback') ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-tertiary)',
      fontSize: '0.85em',
    },
  },
  stalled
    /**
     * ⚠ 这一句必须**同时**说清三件事（缺一句就还是「说不清」）：
     *   ① 数据没刷新；② 最后一次成功是何时；③ 有没有在重试。
     * ⛔ 不许出现「已连接」字样（T-04 的核心观感：不能一边定格一边说连着）。
     */
    ? '取数已超时：面板数据停止刷新（最后一次成功：' + lastOkLabel + '）—— 正在按 ' + Math.round(interval / 1000) + ' 秒间隔重试'
    : liveState === 'live' ? '实时更新已连接（断线自动重连；另有定时兜底）'
      : liveState === 'fallback' ? '实时连接不可用，已降级为定时刷新'
        : liveState === 'reconnecting' ? '实时连接断开，正在重连（同时保留定时刷新）'
          : liveState === 'unknown' ? '实时状态判不出（宿主未提供可见性 / 连接读数）—— 下方数据可能未在刷新'
            : '正在连接实时更新…',
)
```

`lastOkLabel`：

```ts
const lastOkLabel = lastOkAt === undefined
  ? '从未成功'
  : Math.max(1, Math.round((Date.now() - lastOkAt) / 1000)) + ' 秒前'
```

⚠ **渲染期读 Date.now() 的取舍**：这里**接受静止**（面板本来就有 5s/60s 刷新节拍，下次渲染自校正），⛔ **不为这一行再加一个定时器**——那正是 O-18 的病（1s 时钟驱动父组件重渲染）。

**为什么新增 unknown 档**（与 REVIEW §7.4 D-12 的「A + 补可见态」对齐）：
- `StagesPanelLive`（`:3142`）把 `effectiveVisible` 算成 `tabVisible === true && sidebarExpanded !== false`，`tabVisible` 来自 `useTabInfo()`。**若宿主不注入 useTabInfo**（REVIEW §6.3 U-6 明确列为未验证），`tabVisible` 恒 undefined ⇒ `effectiveVisible` 恒 false ⇒ 面板**一次都不轮询、不连流**，而 `liveState` 初值 `connecting`（`:1109`）⇒ 徽标永远停在「正在连接实时更新…」。这是**与 T-04 同类但成因不同的静默冻结**。
- ⇒ 徽标需要第五句话区分「判不出可见性」与「正在连接」。**本规格只给观感出口，不给根因修复**（根因属宿主契约，需 host-probe；见 §10）。

### ④ 依赖与冲突

- **必须先做**：无（P1 首项）。
- **必须同批**：T-09（L-1）、O-18（L-6）。
- **建议同批**：O-36（§7.3，同一内联函数要改）、§7.5 的死字段清理（同片代码）。
- **会打架的地方**：
  - **S-13d 轮询断言**（`check-stages-panel-dom.mjs:936-965`）：用 `pollMs=40` 跑真 setInterval，断言「可见期 ≥2 次 / 隐藏后 0 次」。加 watch-dog **不影响**（只在 pulling 卡住时动手），但新断言要用同样的小 pollMs。
  - **S-16h / S-16k / S-16l**（`:2005-2210`）的负向对拍依赖源码字面量 `return tabVisibleRef.current === false` ⇒ **不动该行**（本规格不改 isHidden）。
  - **setPollTick 的位置**（`:1446`）：现在在 pull() 尾部同步执行；watch-dog 复位**不**补发 setPollTick（否则 Current 面板会多拉一次）。保持现状。

### ⑤ 验证方式（含**负向对拍**）

**V-T04-a（超时真的会中止 + 徽标降级）** — check-stages-panel-dom.mjs 新增：

```js
let calls = 0
const r = await iaMount({
  fetchStages: () => new Promise(() => {}),                    // 永不 settle
  fetchExec: async () => { calls += 1; return { ok: true, items: [] } },   // 健康的一路，用来证明闸没焊死
  pollMs: 40,
  fetchTimeoutMs: 120,          // ← 测试 seam，见下方说明
})
await tick(60)                  // 首个 tick
const afterFirst = calls
await tick(200)                 // 让 watch-dog 跑过
const badge = document.querySelector('[data-dsh-hob="stages-live-state"]')
assert(badge.getAttribute('data-stalled') === 'true')
assert(badge.getAttribute('data-state') === 'degraded')
assert(/停止刷新/.test(badge.textContent))
assert(!/已连接/.test(badge.textContent ?? ''))       // ← T-04 的核心观感断言
assert(calls > afterFirst)                            // ← 闸已复位、后续 tick 仍在推进
```

⚠ **测试 seam**：FETCH_TIMEOUT_MS 是模块常量 ⇒ jsdom 里无法等 30s。**本规格采用「可注入 props」**：新增 `Props.fetchTimeoutMs?: number`（与既有 `pollMs` 同款注入惯例，见 `:872-875` 注释），生产缺省用常量。机检传 `fetchTimeoutMs: 120` 即可测**生产路径**（而不是测变体）。

**V-T04-b（负向对拍 A：去掉超时 ⇒ 必须红）**：

```js
const mutant = buildMutant('t04-no-timeout', (t) => t.replace(
  'export const FETCH_TIMEOUT_MS = 30_000',
  'export const FETCH_TIMEOUT_MS = Number.POSITIVE_INFINITY',
))
// 夹具：同一个「永不 settle」的 fetchStages，且**不传** fetchTimeoutMs（用常量）
// ⇒ 断言必须红：data-stalled 永远 'false'，且 calls 在首个 tick 后不再增长
// ⚠ 先自证：断言 mutant 源码里确实出现 POSITIVE_INFINITY（否则记「造不出变体」红）
```

**V-T04-c（负向对拍 B：删 watch-dog ⇒ 必须红）**：

```js
const mutant = buildMutant('t04-no-watchdog', (t) => t.replace(
  /const watchdog = setTimeout\(\(\) => \{[\s\S]*?\}, FETCH_TIMEOUT_MS \+ 5_000\)/,
  'const watchdog = setTimeout(() => {}, 0)',
))
// 夹具：**所有** fetch 永不 settle（连 AbortController 那条路也走不通）
// ⇒ 无 watch-dog 时 pulling 永不放 ⇒ calls 在首个 tick 后零增长 ⇒ 断言必须红
```

**V-T04-d（负向对拍 C：徽标仍说「已连接」⇒ 必须红）**：

```js
const mutant = buildMutant('t04-badge-lying', (t) => t.replace(
  "'data-state': stalled ? 'degraded' : liveState,",
  "'data-state': liveState,",
))
// 挂起夹具 ⇒ mutant 下 data-state 仍是 'connecting'（或 live）⇒ 断言必须红
```

**V-T04-e（肉眼可见，写进 PR 说明）**：

```
① 面板徽标：「实时更新已连接（断线自动重连；另有定时兜底）」
② devtools → Network → 对 /api/dsh-hob/stages 设 Block request URL（或在 Sources 里给该路由打断点挂住）
③ 30s 后：徽标变红并说「取数已超时：面板数据停止刷新（最后一次成功：N 秒前）—— 正在按 5 秒间隔重试」
   ⇒ 用户第一次能看见「面板不刷新」这件事（修前：永远绿色 + 永远旧数据）
④ 解除封锁：下一个 tick 成功 ⇒ 徽标自动回「已连接」，N 秒前归零
```

### ⑥ 回退方式

- 单一提交（project-panel.tsx）⇒ git revert 即可，**零写盘副作用**。
- 只关超时：`FETCH_TIMEOUT_MS = Number.POSITIVE_INFINITY`（watch-dog 随之失效）——**这是降级开关，不是第二套实现**。
- 只关徽标降级：`stalled` 恒 false（保留超时与 watch-dog，只去掉观感）——用于「宿主超时误报」现场止血。

### ⑦ 改动面等级

**局部**（单文件 `src/client/project-panel.tsx`；live-client.ts 与 live-protocol.ts 都不动）。---

## §3 T-09 · 账本健康读 count / truncated（high）

### ① 缺陷编号与位置

- `T-09`（REVIEW §5.3，high）
- `src/client/project-panel.tsx:2236-2268`（healthBlock IIFE）。关键行实测：`:2244` `if (stageState.kind !== 'ok') return null`、`:2249` `const problems = …`、`:2250` `if (health.ok === true && problems.length === 0) return null`、`:2253` `'data-state': problems.length === 0 ? 'ok' : 'unhealthy'`、`:2257` 头部文案用 problems.length、`:2264-2266`「另有 problems.length - 12 条」
- 服务端契约：`src/shared/stages-index.ts:455-462`（cap = compact ? 40 : all.length；count 恒为全量）、`:602-607`（体积兜底把 problems **整段丢弃**、只留 count/truncated）、`:453`（注释：「truncated=true 时面板必须说『另有 N 条』」）
- 固定 compact:true：`project-panel.tsx:529`
- 证据等级：**实测**（服务端两段 + 客户端五处全部 sed 确认）

### ② 改什么

只改 healthBlock 一个 IIFE（`:2236-2268`）：**三处判据 + 一处文案**。**不动**服务端、不动 StagesOk 类型。

### ③ 具体改法

```tsx
const healthBlock = ((): React.JSX.Element | null => {
  if (blockedByPreset) return null
  if (stageState.kind !== 'ok') return null
  const health = (stageState as any).stageHealth as {
    ok?: boolean; count?: number; truncated?: boolean
    problems?: Array<{ rule?: string; unit?: string; why?: string }>
  } | undefined
  if (health === undefined) return null

  /**
   * ⚠⚠ 三件事必须分开判（T-09 的全部内容）：
   *   ① count（全量条数）与 problems.length（本次随响应回来的条数）**不是同一个数**；
   *   ② problems 缺席 ≠ 没有缺口 —— 体积兜底会把它整段丢掉（stages-index.ts:602-607）；
   *   ③ 「健康」= ok === true，⛔ 不是 problems.length === 0。
   */
  const total = typeof health.count === 'number' && Number.isFinite(health.count) ? health.count : undefined
  const problems = Array.isArray(health.problems) ? health.problems : []
  const shown = problems.length
  /** ⚠ truncated 有**两个来源**：服务端置位（>40 条），或「回来的比全量少」（体积兜底丢了全文） */
  const truncated = health.truncated === true || (total !== undefined && shown < total)

  /** 真空：健康且确实是 0 条 ⇒ 整块不渲染（保持现状，⛔ 不新增噪音） */
  if (health.ok === true && total === 0) return null
  /** ok 但没给 count：按健康处理（⛔ 不把「上游没给读数」渲染成红块） */
  if (health.ok === true && total === undefined) return null

  return React.createElement(
    'details',
    {
      'data-dsh-hob': 'stages-health',
      /**
       * ⚠ **不能再用 problems.length === 0 判 ok**：那会把「problems 被丢空」算成健康
       *   —— 正是 T-09 的原病（300 条缺口印成「0 条缺口」且 data-state=ok）。
       */
      'data-state': health.ok === true ? 'ok' : 'unhealthy',
      'data-count': total === undefined ? '' : String(total),
      'data-shown': String(shown),
      'data-truncated': truncated ? 'true' : 'false',
      style: { fontSize: '0.9em' },
    },
    React.createElement(
      'summary',
      { style: { cursor: 'pointer', color: 'var(--dsw-alias-state-error-primary)' } },
      /**
       * ⚠ 文案口径（T-09 的唯一验收面，逐字给死，免得下一个人改成「约 N 条」）：
       *   · 全量已知 ⇒「账本健康：<total> 条缺口（先补齐才能派活）」
       *   · 全量判不出 ⇒「账本健康：判不出（本次响应未带缺口计数）」
       *   · ⛔ 任何情况下都不许把 problems.length 当总数列在这一行。
       */
      total === undefined
        ? '账本健康：' + STAGES_UNDECIDABLE_TEXT + '（本次响应未带缺口计数）'
        : '账本健康：' + total + ' 条缺口（先补齐才能派活）',
    ),
    ...problems.slice(0, 12).map((p, i) => React.createElement(
      'div',
      { key: 'health-' + i, 'data-dsh-hob': 'stages-health-item', style: { paddingLeft: '1.2em', overflowWrap: 'anywhere' } },
      String(p.rule ?? '?') + ' · ' + String(p.unit ?? '?') + ' · ' + String(p.why ?? ''),
    )),
    /**
     * ⚠⚠ 「另有 N 条」的口径（T-09 要求的那条文案口径，三条给死）：
     *   ① N = 全量 − 本次已渲染条数。⛔ **不是** problems.length − 12：
     *      problems 本身可能已被服务端截到 40 ⇒ 「另有」必须把**两段截断一起算**。
     *   ② problems 缺席而 count > 0 ⇒ 明写「未随本次返回（响应超体积上限）」——
     *      ⛔ 不许写成「另有 N 条」：那会让人以为只是折叠了，实际是**没下发**。
     *   ③ 已全部渲染（rest <= 0）⇒ 这一行不出现。
     */
    ...(() => {
      if (total === undefined) return []
      if (shown === 0 && total > 0) {
        return [React.createElement('div', {
          key: 'health-more',
          'data-dsh-hob': 'stages-health-more',
          'data-kind': 'not-delivered',
          style: { paddingLeft: '1.2em', color: 'var(--dsw-alias-label-tertiary)' },
        }, '另有 ' + total + ' 条未随本次返回（响应超体积上限，可按 ID 读全文）')]
      }
      const rendered = Math.min(shown, 12)
      const rest = total - rendered
      return rest > 0
        ? [React.createElement('div', {
            key: 'health-more',
            'data-dsh-hob': 'stages-health-more',
            /** ⚠ 机检要能区分「折叠了」与「没下发」⇒ 用 data-kind 而不是靠文案 */
            'data-kind': truncated ? 'truncated' : 'folded',
            style: { paddingLeft: '1.2em', color: 'var(--dsw-alias-label-tertiary)' },
          }, '另有 ' + rest + ' 条')]
        : []
    })(),
  )
})()
```

**⚠ 与现状的两处行为变化（必须写进 PR，否则会被当成回归）**：

1. `:2250` 的判据从 `health.ok === true && problems.length === 0` 改成 `health.ok === true && total === 0`。差别：**ok:true 但 count 缺失**时，旧码渲染一个「0 条缺口」的红块（假读数），新码不渲染。
2. 「另有 problems.length − 12」改成「total − min(shown, 12)」。差别：**41~300 条缺口**时，旧码说「另有 28 条」（40−12），新码说「另有 288 条」（300−12）。

### ④ 依赖与冲突

- **必须同批**：T-04（L-1）、T-08（L-3，同屏排版）。
- **冲突点（已核对，结论是「不用改」）**：`check-stages-panel-dom.mjs:4631-4666` 的 **S-33h2**：
  - 正证夹具 `{ ok: false, count: 1, problems: [1 条] }` ⇒ 断言「1 条缺口」。新码用 count 算仍是 `1` ⇒ **通过**。
  - 反向对拍 `{ ok: true, count: 0, problems: [] }` ⇒ 断言不渲染。新码 `ok===true && total===0` ⇒ 不渲染 ⇒ **通过**。
  - ⇒ **S-33h2 不需要改**；需**新增**两条覆盖 41+ 与 problems 缺席（见 ⑤）。
- **不动** StagesOk / StageItem 类型（服务端已有 count/truncated，只是客户端不读）。

### ⑤ 验证方式（含**负向对拍**）

**V-T09-a（41 条缺口 ⇒ 说 41，不是 40）**：

```js
const r = await iaMount({
  fetchStages: async () => ({
    ok: true, readAt: '…',
    stages: [/* 7 步占位 */], caps: [],
    stageHealth: {
      ok: false, count: 41, truncated: true,
      problems: Array.from({ length: 40 }, (_, i) => ({ rule: 'L-2', unit: 'TSK-' + i, why: 'x' })),
    },
  }),
})
const node = document.querySelector('[data-dsh-hob="stages-health"]')
assert(node.getAttribute('data-count') === '41')
assert(/41 条缺口/.test(node.textContent))            // ← 旧码是 40
assert(/另有 29 条/.test(node.textContent))           // 41 - min(40,12) = 29（旧码 28）
assert(node.querySelectorAll('[data-dsh-hob="stages-health-item"]').length === 12)
assert(node.getAttribute('data-truncated') === 'true')
```

**V-T09-b（problems 被体积兜底丢掉 ⇒ 说 count，且不说 0）**：

```js
fetchStages: async () => ({ ok: true, …, stageHealth: { ok: false, count: 300 } })   // 无 problems
assert(node.getAttribute('data-state') === 'unhealthy')       // ← 旧码这里算成 'ok'
assert(/300 条缺口/.test(node.textContent))
assert(!/0 条缺口/.test(node.textContent))                     // ← 旧码的病
const more = node.querySelector('[data-dsh-hob="stages-health-more"]')
assert(more.getAttribute('data-kind') === 'not-delivered')     // ← 区分「没下发」与「折叠」
assert(/未随本次返回/.test(more.textContent))
```

**V-T09-c/d/e（三条负向对拍，每条都改成会重现旧病的那种实现）**：

```js
// c · 头部改回 problems.length ⇒ V-T09-a 必须红（40 条缺口）
buildMutant('t09-by-problems', (t) => t.replace(
  "        : '账本健康：' + total + ' 条缺口（先补齐才能派活）',",
  "        : '账本健康：' + problems.length + ' 条缺口（先补齐才能派活）',",
))
// d · data-state 改回按 problems 判 ⇒ V-T09-b 必须红（变成 'ok'）
buildMutant('t09-ok-by-problems', (t) => t.replace(
  "'data-state': health.ok === true ? 'ok' : 'unhealthy',",
  "'data-state': problems.length === 0 ? 'ok' : 'unhealthy',",
))
// e · 「另有 N」改回 shown - 12 ⇒ V-T09-a 必须红（变成「另有 28 条」）
buildMutant('t09-more-by-problems', (t) => t.replace('const rest = total - rendered', 'const rest = shown - 12'))
// ⚠ 三条都先自证 mutated !== src，否则记「造不出变体」红
```

**V-T09-f（肉眼可见）**：

```
① 造一本 50 条缺口的账（或夹具）
② 修后：「账本健康：50 条缺口」+ 展开 12 行 + 「另有 38 条」
   修前：「账本健康：40 条缺口」+「另有 28 条」（少数 10 条）
③ 模拟体积兜底（响应裁到只剩 count:300）
   修后：「账本健康：300 条缺口」+「另有 300 条未随本次返回」，data-state=unhealthy
   修前：「账本健康：0 条缺口（先补齐才能派活）」+ data-state=ok —— **把 300 条缺口说成健康**
```

### ⑥ 回退方式

单文件单 IIFE 内回退；**零写盘**。若只想去掉「判不出」分支：把头部文案的 undefined 分支改回 `String(problems.length)`（退回旧行为，但请同时在 PR 里写明「已退回假读数」）。

### ⑦ 改动面等级

**局部**（单文件单 IIFE；服务端不动）。

---

## §4 R-08 · legacy 第 5 步状态源与条目源分裂（high，联动修复项）

> ⚠ **编号更正**：任务书称此条为 `O-31`，REVIEW.md 实际编号是 **`R-08`**（`O-31` 是 check:profile --fix 那条 low）。见 §0 与附录 B。

### ① 缺陷编号与位置

- `R-08`（REVIEW §5.1 high / 专章 §3.4 链 D / 联动清单 §8.1）；主控裁定：**legacy 第 5 步以 acc 为准**。
- **服务端（全部本次实测）**：
  - 声明：`src/shared/requirement-chain.ts:117`（`{ step: 5, name: '验收核对', kind: 'acc' }`）← **不改**
  - 状态源：`:307-311`（chain.accs / groups）← **不改（本来就是 acc）**
  - **条目源**：`:349`（`d.step === 5 ? chain.verifications`）← **必改**
  - **计数 done**：`:367-368`（`chain.verifications.filter(v => statusOf(v) === 'pass')`）← **必改（REVIEW 未点，本规格补齐）**
  - **计数 doing**：`:380-381`（`chain.verifications.filter(v => statusOf(v) === 'unverified')`）← **必改（同上）**
  - 计数 total：`:391`（`items.length`）← **自动跟随，不改**
- **客户端**：`src/client/project-panel.tsx:148-156`、`:159-161`、`:1744`（唯一消费点）、`:1714`（签名）、`:2613` / `:2689`（两处调用点）
- 证据等级：**实测**（六处服务端 + 五处客户端逐一 sed 确认）

### ② 改什么

服务端**三点**（条目源 + done + doing，都是 `legacy ? … : …` 分支）+ 客户端**一处函数族**（两张 kind 表 + kindOfStep 的 legacy 参数 + 两处调用点）。

⚠ **比 REVIEW §3.4 多出的两处**：§3.4 只点了 `:349`（条目源）。但 `:367-368` 与 `:380-381` 的 done/doing **也取 verifications** —— 只改 `:349` 会出现新的自相矛盾：**条目取自 ACC、计数取自 VER**（legacy 账本 VER 通常 0 ⇒ 「2 条」但 `0/0`）。⇒ **本规格把 done/doing 一并列为必改项。**

### ③ 具体改法

#### 3.1 服务端（三处，全部 `legacy ? … : …`，⛔ 不许直接换成 accs）

```ts
// ① 条目源（原 :349）
const items = d.step === 1 ? [req]
  : d.step === 2 ? chain.changes
    : d.step === 3 ? chain.tasks
      : d.step === 4 ? chain.runs
        /**
         * ⚠⚠ legacy 第 5 步装 acc（R-08 · 主控裁定 §3.4）：
         *   旧语义里「验收核对」这一步**就是产品验收**（verification 是 v3 才独立出来的）。
         *   ⛔ 不能写成 `d.step === 5 ? chain.accs` 直接替换 —— v3 的第 5 步是技术验证，
         *      无条件换成 accs 会把 v3 也改坏（v3 的 ACC 在第 6 步）。
         */
        : d.step === 5 ? (legacy ? chain.accs : chain.verifications)
          : d.step === 6 ? chain.accs
            : chain.closures

// ② 计数 done（原 :367-368）
: d.step === 5
  /**
   * ⚠ 必须与 ① 同源；只改 ① 会让「条目 2 条、done 0」（done 还在数 VER）。
   * ⚠ 用 groups 而不是 chain.accs：与 stateOfStep:311 的判据
   *   （groups.every(g => g.verdict.verdict === 'accepted')）保持**同一函数族**。
   *   ⛔ 不要在这里另写 accs.filter(a => a.status === 'pass') ——
   *   那是「有效判决」的第二份实现（effectiveAcceptanceOf 才认 send-back / revision 归并）。
   */
  ? legacy
    ? groups.filter((g) => g.verdict.verdict === 'accepted').length
    : chain.verifications.filter((v) => statusOf(v) === 'pass').length
  : d.step === 6
    ? groups.filter((g) => g.verdict.verdict === 'accepted').length
    : chain.closures.filter((c) => ['closed', 'skipped'].includes(statusOf(c))).length

// ③ 计数 doing（原 :380-381）
: d.step === 5
  /** ⚠ 与 ② 同源；undecidable 是 groups 里「还没判」的那一档（与 stateOfStep:310 一致） */
  ? legacy
    ? groups.filter((g) => g.verdict.verdict === 'undecidable').length
    : chain.verifications.filter((v) => statusOf(v) === 'unverified').length
  : d.step === 6
    ? groups.filter((g) => g.verdict.verdict === 'undecidable').length
    : chain.closures.filter((c) => statusOf(c) === 'open').length
```

**不用改的四处（逐条说明，免得下一个人「顺手也改了」）**：

- `stepSummaryOf`（`:273-276`）按**步号**走，legacy 第 5 步输出验收口径摘要（`if (chain.accs.length === 0) return '还没有验收'`）⇒ 与改后一致。
- `stateOfStep`（`:307-311`）本来就是 acc 源。
- `missing`（`:403`）`if (chain.accs.length === 0) missing.push('acc')` 与 ACC 源一致。
- `:411` 的 `complete`（accepted && steps.every(displayState === 'done')）：displayState 来自 `:307-311`（acc 源，不变）⇒ complete 不变 ⇒ **安全**。

#### 3.2 客户端（STAGE_KIND_BY_STEP 变成「按链类型取表」）

**问题**：`kindOfStep(step)`（`:159-161`）只看步号，不知道链是 legacy 还是 v3。R-08 改完后 legacy 第 5 步装 ACC，而 `kindOfStep(5)` 返回 `'verification'` ⇒ **每条 ACC 被拿去查 verification 标签表**。

```ts
/** **v3 的「步号 → kind」**（7 步）。⚠ 与 stages-index.ts:29-37 的 STAGE_DEFS 同序。 */
export const STAGE_KIND_BY_STEP_V3: Readonly<Record<number, string>> = {
  1: 'req', 2: 'change', 3: 'task', 4: 'run',
  5: 'verification', 6: 'acc', 7: 'closure',
}

/**
 * **legacy 的「步号 → kind」**（5 步）。⚠ 与 requirement-chain.ts:112-118 的 LEGACY_STEP_DEFS 同序。
 *
 * ⚠⚠ **第 5 步是 acc**（R-08 主控裁定：「验收核对」在旧语义里就是产品验收）。
 *   改这三行**必须**与服务端 requirement-chain.ts 的 items / done / doing 三处同批，
 *   否则 ACC 状态会被拿去查 verification 表，而 stageStatusLabel **不会**返回 known:false：
 *   ACC 的状态集 pass/send-back/unverified 是 verification 状态集
 *   unverified/pass/send-back/waived 的**真子集**（stages-index.ts:49-50）
 *   ⇒ 界面安静换词、**不报「判不出」**。这是本仓最难查的一类失败。
 */
export const STAGE_KIND_BY_STEP_LEGACY: Readonly<Record<number, string>> = {
  1: 'req', 2: 'change', 3: 'task', 4: 'run', 5: 'acc',
}

/** 兼容别名（等价于 v3 表；⛔ 新代码不要用它去取 legacy 的 kind） */
export const STAGE_KIND_BY_STEP = STAGE_KIND_BY_STEP_V3

/**
 * 取某一步的 kind。
 * @param step - 步号
 * @param legacy - 这条链是不是 legacy。**渲染路径必须显式传**
 *   （来源：chain.pipeline.state === 'legacy'）。
 * ⚠ 缺省 false 只为不破坏既有调用点；⛔ 不要依赖缺省值渲染 legacy 链。
 */
export function kindOfStep(step: number, legacy = false): string {
  const table = legacy ? STAGE_KIND_BY_STEP_LEGACY : STAGE_KIND_BY_STEP_V3
  return table[step] ?? ''
}

// renderStageItem 签名 + 两处调用点（:1714 / :2613 / :2689）
// :1714 原：const renderStageItem = (it: any, step: number, keyPrefix: string, index: number)
const renderStageItem = (it: any, step: number, legacy: boolean, keyPrefix: string, index: number): React.JSX.Element => {
  // :1744 原：const status = stageStatusLabel(kindOfStep(step), String(it?.status ?? ''))
  const status = stageStatusLabel(kindOfStep(step, legacy), String(it?.status ?? ''))
}
// :2613（主线树，链来自 selectedChain）
// items.map((it, i) => renderStageItem(it, step.step, selectedChain.pipeline?.state === 'legacy', 'chain-' + step.step, i))
// :2689（历史链，链来自闭包变量 c）
// items.map((it, k) => renderStageItem(it, s.step, c.pipeline?.state === 'legacy', 'h-' + c.reqId + '-' + s.step, k))
```#### 3.3 「若只改一边会静默错配」的具体表现（任务书逐字要求）

| 只改 | 现象（**两者都静默**） | 为什么静默 |
|---|---|---|
| **只改服务端** | legacy 第 5 步条目变 ACC；每条 ACC 的 `unverified` 印「**待技术验证**」、`pass` 印「**技术验证通过**」、`send-back` 印「**技术验证退回**」。修前它们是「还没验 / 验收通过 / 已退回」—— **词换了一个层级，界面上看不出任何异常** | `stageStatusLabel`（`stage-status-labels.ts:136-160`）只校验「该 kind 的封闭集」，**不会反问「这个 status 是不是本来属于另一个 kind」**。pass / send-back / unverified 在两张表里都有 ⇒ `known:true` ⇒ **不报判不出** |
| **只改客户端** | `kindOfStep(5)='acc'` 而条目仍是 VER：每条技术验证被打上 ACC 标签 ⇒ `waived`（合法 VER 状态）**不在 ACC 封闭集** ⇒ 每条 waived 印「**判不出（原值 waived）**」；`pass` 印「验收通过」（但从「技术验证通过」漂成「产品验收通过」—— **把验证说成验收**，恰是本仓最忌的冒充） | 同上：表命中了、不报错；且 `waived` 那条会**看起来像「账本有脏数据」**，把人引到错误方向排查 |

**⇒ 联动断言（任务书要求的那一条，写死）**：

```
legacy 链第 5 步的「状态源」与「条目源」必须是同一个集合。
```

落成两条机检：V-R08-a（服务端，源集合相等）与 V-R08-b（客户端，kind 表）。

### ④ 依赖与冲突

- **必须先做**：无（可独立于 A/B 合入）。
- **必须同批**：服务端三点 + 客户端（L-4，硬约束）。
- **建议同批**：T-08（L-5，同一函数）。
- **会打架的地方（已逐条核对）**：
  1. `check-requirement-chains.mjs` 的 `auditChains`（`:59-62`）断言 `s.total === s.itemIds.length`：改 `:349` 后 legacy 第 5 步 total 从 0 变成 accs.length，但 total 由 `items.length` 派生（`:391`）⇒ **仍成立**。
  2. `auditChains` 的 `:51-56` 断言「currentStep 在 1..5」+「必须是第一个未完成步」。legacy 的 currentStep 由 `:422-423` 从 steps 派生 ⇒ 改后第 5 步的 displayState 是**真值**（本来就对）而 itemIds 变了 ⇒ currentStep **不变**。⚠ 实测 `grep -n 'legacy' scripts/check-requirement-chains.mjs` ⇒ **零命中**，即该脚本**目前没有任何 legacy 夹具** ⇒ 需**新增**（V-R08-a 就是）。
  3. 客户端 `renderStageItem` 签名多一个参数 ⇒ 两处调用点必须同步；漏一处是 **TS 报错**（参数错位），**编译期可见**（与 3.3 那两种静默错配不同）。
  4. `STAGE_KIND_BY_STEP` 保留为别名 ⇒ `check:stages-route` 的 R-10 与 `check-stages-panel-dom` 的 S-1（`:207`）**都不受影响**（实测 `grep -rn 'kindOfStep|STAGE_KIND_BY_STEP' scripts/` ⇒ **NONE**）。

### ⑤ 验证方式（含**负向对拍**）

**前置：先存基线（改前跑，输出存档）**

```bash
npm run check:requirement-chains 2>&1 | tee /tmp/rc-before.txt
npm run check:stages-route       2>&1 | tee /tmp/sr-before.txt
npm run check:stages-dom         2>&1 | tee /tmp/dom-before.txt
```

**V-R08-a（服务端：状态源 === 条目源）** — check-requirement-chains.mjs 新增：

```js
/**
 * R-08：legacy 第 5 步的「状态源」与「条目源」必须是同一个集合。
 * 夹具要点：不带 pipeline_version ⇒ isPipelineV3 为 false ⇒ legacy。
 *          第 5 步给 2 条 pass 的 ACC + 1 条 waived 的 VER（干扰项，改后不该进第 5 步）。
 */
{
  const units = [
    U('R-L1', 'req', 'agreed', { acceptance_criteria: ['a'] }),
    U('CHG-L1', 'change', 'settled', { addresses: ['R-L1'], path_decision: 'A' }),
    U('TSK-L1', 'task', 'built', { parent: 'CHG-L1', req_ids: ['R-L1'], ...BRIEF }),
    U('RUN-L1', 'run', 'returned', { parent: 'TSK-L1', report: 'ok', progress_refs: ['EVD-L1'] }),
    U('ACC-L1', 'acc', 'pass', { parent: 'TSK-L1', actor: 's-b', basis: ['EVD-L1'], example_results: ['x'] }),
    U('ACC-L2', 'acc', 'pass', { parent: 'TSK-L1', actor: 's-b', basis: ['EVD-L1'], example_results: ['y'] }),
    U('VER-L1', 'verification', 'waived', { parent: 'TSK-L1' }),   // ← 干扰项
  ]
  const c = mod.buildRequirementChains(units, 'x').chains.find((x) => x.reqId === 'R-L1')
  const step5 = c.steps.find((s) => s.step === 5)
  const p = []
  if (c.pipeline.state !== 'legacy') p.push('夹具不是 legacy（state=' + c.pipeline.state + '）⇒ 本断言不成立，先修夹具')
  if (step5.total !== 2) p.push('第 5 步 total=' + step5.total + '（期望 2 ⇒ 条目源必须是 accs）')
  if (step5.itemIds.includes('VER-L1')) p.push('第 5 步仍装着 VER-L1 ⇒ 条目源没改成 accs')
  if (!step5.itemIds.includes('ACC-L1')) p.push('第 5 步没有 ACC-L1')
  if (!step5.itemIds.includes('ACC-L2')) p.push('第 5 步没有 ACC-L2')
  if (step5.done !== 2) p.push('第 5 步 done=' + step5.done + '（期望 2 ⇒ done 源必须与条目源同集合）')
  if (step5.displayState !== 'done') p.push('第 5 步 displayState=' + step5.displayState + '（期望 done）')
  if (p.length === 0) ok('R-08a ✓ legacy 第 5 步：状态源 === 条目源 === accs（2 条 ACC，done=2，waived VER 不掺入）')
  else for (const x of p) bad('R-08a · ' + x)
}
```

**V-R08-b（客户端：kindOfStep 必须按链类型返回）** — 放 check-stages-panel-dom.mjs（已 import panel 模块，`:266` 的 ui）：

```js
const p = []
if (ui.kindOfStep(5, false) !== 'verification') p.push('v3 第 5 步应为 verification，实际 ' + ui.kindOfStep(5, false))
if (ui.kindOfStep(5, true) !== 'acc')          p.push('legacy 第 5 步应为 acc，实际 ' + ui.kindOfStep(5, true))
if (ui.kindOfStep(6, true) !== '')             p.push('legacy 只有 5 步，第 6 步不该有 kind')
if (p.length === 0) ok('R-08b ✓ kindOfStep：v3 第5步=verification / legacy 第5步=acc（联动约束已落地）')
else for (const x of p) bad('R-08b · ' + x)
```

**V-R08-c（负向对拍 A：服务端改回 verifications ⇒ V-R08-a 必须红）**：

```js
const src = readFileSync(join(root, 'src/shared/requirement-chain.ts'), 'utf8')
const mutated = src.replace(
  'd.step === 5 ? (legacy ? chain.accs : chain.verifications)',
  'd.step === 5 ? chain.verifications',
)
if (mutated === src) bad('R-08c · 造不出变体（源码形态已变）⇒ 负向对拍不可判')
// else：写临时文件 → dynamic import → 跑同一份 V-R08-a 判据 ⇒ 必须红
```

**V-R08-d（负向对拍 B：客户端 kind 表不改 ⇒ V-R08-b 必须红）**：

```js
const mutant = buildMutant('r08-kind-unchanged', (t) => t.replace(
  "  1: 'req', 2: 'change', 3: 'task', 4: 'run', 5: 'acc',",
  "  1: 'req', 2: 'change', 3: 'task', 4: 'run', 5: 'verification',",
))
// ⇒ mutant 的 kindOfStep(5,true) 返回 verification ⇒ V-R08-b 第 2 条必须红
```

**V-R08-e（端到端：标签词必须对）** — check-stages-panel-dom.mjs：

```js
// 挂一个 legacy 链夹具：pipeline.state==='legacy'，第 5 步 1 条 ACC status='unverified'
// 展开第 5 步 ⇒ 断言状态文本 === '还没验'
const statusEl = document.querySelector('[data-dsh-hob="stages-tree-item-status"]')
if (!/还没验/.test(statusEl.textContent))     bad('legacy 第5步 ACC(unverified) 应印「还没验」，实际 ' + statusEl.textContent)
if (/待技术验证/.test(statusEl.textContent))  bad('仍印着 verification 表的词「待技术验证」⇒ 联动没做全')
if (/判不出/.test(statusEl.textContent))      bad('印成「判不出」⇒ kind 取不到（客户端表没接 legacy）')
```

**V-R08-f（肉眼可见）**：

```
① 打开一本 legacy 账本（无 pipeline_version 的旧账）→ 主线「5 验收核对」那一行
② 修前：状态「✅ 已完成」/ 计数「0/0」/ 展开「这一步还没有条目」（三件互相矛盾）
③ 修后：状态 = ACC 判决真值 / 计数「2/2」/ 展开见 2 条 ACC，状态印「验收通过」或「还没验」
   ⇒ **ACC 的判决、残余风险、接受人第一次在 legacy 链上可见**
```

### ⑥ 回退方式

- 服务端三处都是 `legacy ? A : B` 三元 ⇒ 回退 = 去掉 `legacy ? … :` 留 B（改回 verifications）。**三处必须一起回退**。
- 客户端 `STAGE_KIND_BY_STEP` 保留为 V3 别名 ⇒ 回退 = `kindOfStep` 忽略 legacy 参数、恒用 V3 表。
- **零账本副作用**（纯投影）。回退后历史显示回到旧形态 —— 但**旧形态本身就是缺陷**，PR 里要写明。

### ⑦ 改动面等级


**跨模块**（`src/shared/requirement-chain.ts` + `src/client/project-panel.tsx`）。**必须同批合入。**

---
