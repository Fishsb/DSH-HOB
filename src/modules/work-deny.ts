/**
 * M1b · **实施侧专属收窄**（Host 半边）—— 2026-10-07 批 6 · UD-64 / CHG-012。
 *
 * ── 这一节解决什么 ──────────────────────────────────────────────────
 *   Hob-Execute **对接的是 Hob，不是用户**（见它契约的 `## Your duties`）。
 *   「弹出问题、等真人当场回答」这类工具会让它**在任务中途停下来等人** ——
 *   而它等的那个"人"根本不是它的上游 ⇒ 结果是**任务堵塞**，不是被澄清。
 *   用户裁定（UD-64）：需要决策 ⇒ **不含糊的部分照做、问题记录下来、随完成回报一并交回**；
 *   整件事被卡住 ⇒ **停在安全状态**并把卡点写进回报。
 *
 * ── 为什么**不复用** `src/preset/tools.ts` 那套挂点（关键，别改回去）──────
 *   那里两处收敛挂在**本预设自己的 scope** 上，只能覆盖"scope 链里含该预设 scope"的装配
 *   ⇒ 结构化地**只作用于 Hob**。而 Hob-Execute 的预设行**不引用本插件任何模块**
 *   （它的 20 个工具行与宿主创造模式逐字节一致，见 `PROJECT.md` §4.3）
 *   ⇒ 那里够不到 Hob-Execute，且**不得为了够到它而给预设行加行**
 *   （会破坏"与创造模式逐字节一致"，并牵动机检 ⑥）。
 *   ⇒ 本节挂在**插件平面**（宿主平面行 `id: dsh-hob` 的 ctx）。
 *
 * ── 机制依据（为什么"插件平面挂上去就能覆盖每个 agent"）──────────────
 *   · `tools/pre-execute` 的派发点：`dsh-tools/lib/index.js:3224-3225`
 *     `const carrier = scopeTarget(this, exec.agent)`，
 *     事件可返回 `{kind:'deny'}`（类型：`dsh-tools/lib/types/index.d.ts:47`）；
 *   · `scopeTarget`（`dsh-scope/lib/index.js:327-338`）的准入规则里明写
 *     `if (tag === void 0) return true` —— **无 scope 标记的监听器全局准入**
 *     ⇒ 插件平面挂的监听器能收到每一个 agent 的调用；
 *   · 同一形状的**宿主先例**：`dsh-experimental-auto-review/lib/index.js:462`
 *     `ctx.on("tools/pre-execute", async (exec, next) => …)`（真机 profile 正装此 bundle）；
 *     装配期过滤的同款先例：`dsh-session-reference/lib/index.js:457`
 *     `ctx.on("system-prompt/assemble", async (_assembly, context, next) => …)`
 *     ——它**正是从 `context.agent` 读出主体的**，即"回调能拿到 agent"有宿主实证。
 *
 * ── 作用面**收窄**靠什么（这是本模块唯一的判据）──────────────────────
 *   两处监听器都先问 {@link presetIdOf}：**只有** `Hob-Execute` 才动手，其余一律
 *   `await next()` **原样放行**。所以：
 *     · Hob（11）**零回归**；
 *     · 宿主自带 standard / minimal / cordis 与其它自建预设**逐名集合不变**。
 *   （隔离实例逐预设对照读数见 `.hob/archive/2026-10-07-orchestration/evidence/`。）
 *
 * ── ⚠⚠ 失败方向：宿主这里是 **fail-CLOSED**，所以本模块**必须自己兜住一切** ──
 *   实测（阶段 D）：`tools/pre-execute` 的监听器**抛异常**时，
 *   `dsh-tools/lib/index.js` 的 catch 把异常变成 `toolErrorResult` ⇒ **工具不执行**
 *   （连白名单里的都失败）。⇒ 本拦截器**不是安全边界**，而是收窄措施：
 *   **把实施侧弄瘫比漏一个工具更糟**。故任何异常 / 不认识的 exec 形状 ⇒ **一律 `next()` 放行**。
 *
 * ── 与 CHG-003「Hob-Execute 工具全给」的关系（如实标注，不美化）────────
 *   这是那条约定的**定点例外**：`ask_user_question` 一项不再适用"全给"。
 *   代价：实施侧的模型面由 104 ⇒ 103（隔离实例读数）；`模块行一行未裁` 这一条**不受影响**
 *   （本模块改的是**模型面与执行面**，**不动任何预设声明行**）。
 */
import { WORK_MODEL_DENY, WORK_PRESET_ID, presetIdOf } from './tools.ts'

/** 模块名（fiber 显示名；本模块**不被** `MODULE_REGISTRY` 单独登记 —— 由 `modules/tools.ts` 调用）。 */
export const name = 'dsh-hob-work-deny'

/**
 * 挂上两处收窄：**装配期过滤**（模型面看不见）+ **执行路径拦截**（绕过清单也拿不到）。
 *
 * @param ctx - **插件平面**的 ctx（宿主平面行 `id: dsh-hob` 的落点）。
 * @param log - 诊断输出（沿用 `modules/tools.ts` 的调用方日志，不新开日志文件）。
 */
export function installWorkPresetDeny(ctx: any, log: (m: string) => void): void {
  const denied = new Set<string>(WORK_MODEL_DENY)

  // ── ① 装配期过滤：把 Hob-Execute **发给模型的**清单里摘掉这些名字 ──────────
  //    ⚠ 只挂一次、只认 presetIdOf == Hob-Execute 的装配。
  //    ⚠ 资源走 `ctx.effect`（§3.3 第 3 条）：模块卸载/热重载时监听器自动拆除。
  ctx.effect(() => ctx.on('system-prompt/assemble', async (assembly: any, context: any, next: any) => {
    const assembled = await next()
    try {
      // ⚠ 必须**先 await next()** 再过滤：后面的监听器可能还会往清单里加东西
      //   （与 `preset/tools.ts` 的白名单同款纪律）。
      const agent = context?.agent
      if (agent === undefined) return assembled
      if (presetIdOf(ctx, agent) !== WORK_PRESET_ID) return assembled
      const all: any[] = Array.isArray(assembled?.tools) ? assembled.tools : []
      const kept = all.filter((t) => !denied.has(t?.name))
      if (kept.length !== all.length) {
        log(`实施侧装配期收窄：模型面工具 ${all.length} ⇒ ${kept.length}`)
      }
      return { ...assembled, tools: kept }
    } catch (e) {
      // fail-open：过滤这一步出问题**绝不能**让装配失败（装配失败 = 会话失去全部工具）。
      log('实施侧装配期收窄异常（已放行）：' + String((e as Error)?.message ?? e))
      return assembled
    }
  }), 'dsh-hob modules/tools: work-preset model-facing deny')

  // ── ② 执行路径拦截：让这些名字**拿不到**，而不只是**看不见** ──────────────
  //    依据：装配期过滤只改"发给模型的清单"，执行路径不看清单
  //    （`dsh-tools/lib/index.js:2995` 的 `get()` 读 `view(scope).visible`）——
  //    绕过清单直接点名，被滤掉的工具**照常执行**（阶段 C 实测）。
  ctx.effect(() => ctx.on('tools/pre-execute', async (exec: any, next: any) => {
    try {
      const execName = exec?.name
      if (typeof execName !== 'string') return await next()
      if (!denied.has(execName)) return await next()
      // 嵌套子派发（`exec.parent` 存在）⇒ 放行：那是 PTC 的 `run_code` 内部调用，
      // 不是"模型直接点名"（同 `preset/tools.ts` 的同款判定）。
      if (exec?.parent !== undefined) return await next()
      if (presetIdOf(ctx, exec.agent) !== WORK_PRESET_ID) return await next()
      log('实施侧执行路径拦截：拒绝 ' + execName)
      return {
        kind: 'deny',
        reason:
          `"${execName}" is not available in this session: this session answers to Hob, not to the user, `
          + 'so a question that waits for a live human would block the work. Do the unambiguous part, '
          + 'record the question, and hand it back with the completion report.',
        info: { name: 'ToolDeniedError', code: 'TOOL_NOT_ALLOWED' },
      }
    } catch (e) {
      // ⚠ fail-open：**绝不**因为本拦截器自身的问题让工具失败（宿主对它自己的 catch 是 fail-closed）。
      log('实施侧执行路径拦截器异常（已放行）：' + String((e as Error)?.message ?? e))
      return await next()
    }
  }), 'dsh-hob modules/tools: work-preset pre-execute deny')

  log(
    '已挂实施侧收窄（预设 ' + WORK_PRESET_ID + '；'
    + WORK_MODEL_DENY.length + ' 个显式名字：' + WORK_MODEL_DENY.join(', ') + '）',
  )
}
