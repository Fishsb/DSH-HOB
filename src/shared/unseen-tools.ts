/**
 * **「当前哪些工具是待确认的」· 只读读数面**（2026-10-31 P28 · `TSK-048` / `R-008`）。
 *
 * ══ 它治的病（`CHG-281` §六·1）════════════════════════════════
 *   `DEFAULT_DENY` 改成黑名单之后，**没见过的工具按"默认放开"放行** ——
 *   这是用户裁定的（新装插件自动可用）。⚠ 但放行**不等于"我确认过它安全"**，
 *   所以每个没见过的名字都会 `degrade('unseen-tool', …)` 留一条记录。
 *   ⚠⚠ 问题：那些记录只进**内存** `DEGRADED_CAPABILITIES` + 宿主 `warn` 日志，
 *     而 `debugLog` 默认 `false` ⇒ **重启即丢，用户永远看不到"系统抓到了什么"**。
 *   ⇒ 本模块是那条**唯一的只读出口**：把"待确认清单"读出来给人看。
 *
 * ══ 三条硬纪律（⛔ 缺一条就不该有这个出口）══════════════════════
 *   ① **只读**：本模块**零写操作**（不 import 任何写函数、不碰任何状态）。
 *      真正的状态源在 `src/preset/tools.ts` 的 `UNSEEN_SEEN`，本模块只**接收**它。
 *   ② **0 条也要能说出来**：`count = 0` ⇒ 文案明确写「0 条」，
 *      ⛔ **不是空数组 / 空白 / 不打印** —— "空"（没查）与"没有"（查了、确实 0）必须分得开
 *      （本仓 `E-172`：取数为 0 时先分清「真的没有」与「有、但不合格」）。
 *   ③ **逐个点名**：有名字时**逐名列出**（⛔ 只给个数字 —— 那样人还得去翻日志）。
 *
 * ⚠ 本文件是**纯函数**（零 IO），所以判据可以拿任意输入喂它、不需要真宿主。
 */

/** 一条待确认工具记录（⚠ 字段封闭：`name` + `why`）。 */
export interface UnseenTool {
  /** 工具名（⚠ 原样，⛔ 不改写、⛔ 不排序前的名字就是模型面里那个）。 */
  name: string
  /** 为什么会出现在这里（⚠ 给人看的一句；⛔ 参与判定）。 */
  why: string
}

/** 读数结果（⚠ `count` 与 `names.length` 恒等 —— 见下方 `describeUnseen`）。 */
export interface UnseenReport {
  ok: true
  /** 待确认条数（0 是**合法读数**，⛔ 不是"判不出"）。 */
  count: number
  /** 逐名清单（去重后按字典序 —— 输出稳定才可比对）。 */
  names: string[]
  /** **给人看的一行**：0 条时明确写「0 条」，⛔ 不许是空串。 */
  summary: string
  /** 明细（与 `names` 同序，`why` 原样带出）。 */
  items: UnseenTool[]
}

/**
 * 把「待确认工具名 + 各自原因」整理成**可读读数**。
 *
 * @param raw - 原始记录（⚠ 允许重复名；⚠ 允许空数组）
 * @returns 读数（`count === names.length`；`summary` 永不为空串）
 */
export function describeUnseen(raw: readonly UnseenTool[]): UnseenReport {
  /** ⚠ 按名去重（同名多条 ⇒ 只留第一条原因），再按名字典序 ⇒ 输出稳定。 */
  const byName = new Map<string, string>()
  for (const r of raw) {
    const n = String(r?.name ?? '').trim()
    if (n === '') continue
    if (!byName.has(n)) byName.set(n, String(r?.why ?? ''))
  }
  const names = [...byName.keys()].sort()
  const items: UnseenTool[] = names.map((n) => ({ name: n, why: byName.get(n) ?? '' }))
  /**
   * ⚠⚠ **0 条时的文案是本模块的判据点**（`TASK-P28` §二·2）：
   *   必须能一眼看出"查过了、确实没有"，⛔ 不是留白。
   */
  const summary = names.length === 0
    ? '0 条 —— 当前没有待确认的工具（⚠ 这是**查过的读数**，⛔ 不是"没查"）'
    : `${names.length} 条待确认：${names.join(' · ')}`
  return { ok: true, count: names.length, names, summary, items }
}
