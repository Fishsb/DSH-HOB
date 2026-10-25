/**
 * **「这个会话选过档位没有」的纯判定与线格式**（2026-10-22 · 第 4 轮）。
 *
 * ══ 它为什么单独一个文件 ═══════════════════════════════════════════════════
 *   同一个判定有**两个消费方、分属两个编译单元**：
 *     · host 半边 —— 只读路由（`src/modules/session-policy-route.ts`）用它把
 *       `SessionPolicyView` 归一成**线格式**；
 *     · client 半边 —— 未选横幅/自动弹（`src/client/hob-unselected-gate.tsx`）用它
 *       把线格式归一回三态。
 *   两边必须**同一套语义**（否则"服务说 recorded、UI 说 unknown"这种漂移没人发现），
 *   所以放 `src/shared/`（与 `planning-preset.ts` / `read-level-policy.ts` / `work-mode.ts` 同款位置）。
 *
 *   ⚠⚠ **本文件零运行时 import**（只有 type）—— 这样 client 半边（tsdown）
 *     与 host 半边（tsc）都能直接 import，不会把任何一侧的依赖拖到另一侧。
 *
 * ══ 为什么是**四态**而不是 `{ recorded: boolean }` ══════════════════════════
 *   任务书 §二① 写的是出参 `{ recorded: boolean }`，但它同时提了两条硬要求：
 *     · 「判不出 … **必须能与 `recorded:false` 区分**」（否则"没选过"与"读不出来"
 *       会被当成同一件事 ⇒ UI 会在**已选**的会话上误弹，或把**坏存储**当成"没选"）；
 *     · 「**非 Hob** 一律按'不适用'处理（⛔ 不得让非 Hob 会话落进'未选 ⇒ 挡'的分支）」。
 *   ⇒ 一个 boolean 装不下这两条区分。本文件用**一个**语义字段承载四态：
 *     `recorded` / `unrecorded` / `not-applicable` / `unknown`。
 *   ⚠ 仍然**只回一个字段**（⛔ 不回带档位值、工作方式、来源分类）——
 *     任务书"不泄档位值"那条不走样，见 {@link toWireState}。
 *
 * ══ 三态（客户端侧）与四态（线格式）的关系 ═════════════════════════════════
 *   客户端只需要三态：`'recorded' | 'unrecorded' | 'unknown'`。
 *   线格式多出的 `'not-applicable'`（非 Hob）**映射到 `'unknown'`**：
 *   对 gate 来说"这个会话不归我管"与"我判不出"的行为**必须一样** ——
 *   都是"不渲染、不弹、不打扰"。⚠ 二者语义不同，但**行为**必须同为不动，
 *   所以客户端侧不新增第四态（少一个能被写错的分支）。
 */

/** 线格式的四态（⚠ 只有这四个值，⛔ 不许扩成"带档位"的复合对象）。 */
export type PolicyRecordWireState = 'recorded' | 'unrecorded' | 'not-applicable' | 'unknown'

/** 客户端用的三态（⚠ 与 `hob-unselected-gate.tsx` 的 `PolicyRecordState` 同义）。 */
export type PolicyRecordClientState = 'recorded' | 'unrecorded' | 'unknown'

/** 线格式（⚠ **一个**语义字段；`ok:false` 只用于请求本身不合法）。 */
export interface PolicyRecordResponse {
  ok: boolean
  /** ⚠ 唯一语义字段。`ok:false` 时可缺席。 */
  state?: PolicyRecordWireState
  /** ⚠ 只在请求不合法时给（如缺 sessionId）；⛔ 不含任何内部配置值。 */
  reason?: string
}

/**
 * `SessionPolicyView.source` 里**表示"判不出"**的那几只。
 *
 * ⚠ 取值来自 `src/server/session-policy.ts` 的 `PolicyResolution['source']` 联合
 *   （`:143-179`）。⚠ 本文件**不 import 那个类型**（它会拖 host 依赖），
 *   改为显式列字符串 + 由 host 侧的路由模块做**编译期对齐**（见那边的 `satisfies`）。
 *
 * ⚠ 为什么这几只算"判不出"（逐条，别合并）：
 *   · `no-identity`      —— 拿不到可信 sessionId ⇒ 不知道在问谁；
 *   · `store-unreadable` —— 策略文件读不出来 ⇒ 连"有没有记录"都不知道；
 *   · `version-unknown`  —— 文件版本不认识 ⇒ 同上；
 *   · `bad-record`       —— 记录本身坏了 ⇒ 不能当"没有记录"。
 * ⚠ **故意不含** `non-hob`（那是"不适用"，不是"判不出"）、
 *   `archive-unknown`（那是**归档**状态读不到，与"选没选过"是两件事：
 *   记录可能好端端地在，只是我们不知道它是否被归档 ⇒ 用 `recorded` 判据照旧可信）。
 *   若把 `archive-unknown` 也算进来，会让"已选但归档状态读不到"的会话被当成
 *   未选 ⇒ 每次都弹 —— 那正是任务书⛔ 禁止的"拿判不出当没选"。
 */
export const UNDECIDABLE_SOURCES: readonly string[] = [
  'no-identity',
  'store-unreadable',
  'version-unknown',
  'bad-record',
] as const

/**
 * 一次策略读数的**最小输入**（⚠ 只取判定需要的两个字段，⛔ 不把整条 view 传进来）。
 *
 * ⚠ 这样设计是为了让本函数在**没有宿主**的环境里也能被机检直接调用
 *   （夹具传普通对象即可），⛔ 不必造一个假 Cordis 容器。
 */
export interface PolicyRecordProbe {
  /** 该会话是否 Hob（⚠ 由 host 侧 `svc.get()` 的 `isHob` 提供，⛔ 不由客户端自己猜预设名）。 */
  isHob: boolean
  /** `SessionPolicyView.recorded`。⚠ **只在 `source` 可信时才有意义**（见下）。 */
  recorded: boolean
  /** `SessionPolicyView.source`。 */
  source: string
}

/**
 * 把一次读数归一成线格式四态（⚠ 顺序有意义，⛔ 别重排）。
 *
 * 判定顺序：
 *   ① `probe === undefined` ⇒ `'unknown'`（没读到任何视图）；
 *   ② `isHob !== true` ⇒ `'not-applicable'`（⚠ 非 Hob **先**判，这样它永远不会落进"挡"的分支）；
 *   ③ `source` 属于 {@link UNDECIDABLE_SOURCES} ⇒ `'unknown'`（⚠ 在 `recorded` **之前**判：
 *      store 读不出来时 `recorded` 恒为 `false`，若不先判就会把"读不出"误报成"没选过"）；
 *   ④ 其余 ⇒ `recorded ? 'recorded' : 'unrecorded'`。
 *
 * @param probe - host 侧读到的视图（可缺席）。
 * @returns 线格式四态。
 */
export function classifyPolicyRecord(probe: PolicyRecordProbe | undefined): PolicyRecordWireState {
  if (probe === undefined) return 'unknown'
  if (probe.isHob !== true) return 'not-applicable'
  if (UNDECIDABLE_SOURCES.includes(String(probe.source))) return 'unknown'
  return probe.recorded === true ? 'recorded' : 'unrecorded'
}

/**
 * 线格式 ⇒ 客户端三态（⚠ `'not-applicable'` 与 `'unknown'` 都落 `'unknown'`）。
 *
 * ⚠ 为什么"不适用"也落 `'unknown'`：见文件头 —— 对 gate 而言两者**行为必须一样**
 *   （不渲染、不弹、不打扰），差别只在语义，而客户端不需要那个语义。
 * @param state - 线格式四态（可缺席 ⇒ 按 `'unknown'`）。
 * @returns 客户端三态。
 */
export function toClientState(state: PolicyRecordWireState | undefined): PolicyRecordClientState {
  if (state === 'recorded') return 'recorded'
  if (state === 'unrecorded') return 'unrecorded'
  return 'unknown'
}

/**
 * 造一条**合法的**线格式响应（⚠ 唯一构造点，防漂移）。
 *
 * ⚠ **只有 `state` 一个语义字段** —— 任务书"⛔ 不泄档位值"的落点就在这：
 *   本函数**不接受**任何 level / workMode / reason 之外的业务值。
 * @param state - 四态之一。
 * @returns 线格式响应（`ok:true`）。
 */
export function okState(state: PolicyRecordWireState): PolicyRecordResponse {
  return { ok: true, state }
}

/**
 * 造一条**请求不合法**的响应。
 *
 * ⚠ `reason` 是给开发者/排查看的一句人话，⛔ **不许**包含内部配置值
 *   （本仓既有纪律：用户可见文案不露配置值；这条响应面同样照办）。
 * @param reason - 一句可读原因。
 * @returns 线格式响应（`ok:false`，⚠ **不带 `state`** —— 以免调用方把失败读成某种状态）。
 */
export function badRequest(reason: string): PolicyRecordResponse {
  return { ok: false, reason }
}
