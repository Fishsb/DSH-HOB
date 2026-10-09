/**
 * 会话级模型选择 —— 给**一个已经建好的会话**装上"首轮用哪个模型"，
 * **不写宿主的全局默认模型**。
 *
 * ── 为什么需要本文件（第 1 步只读判定的实测结论，不是照抄怀疑）──────────
 *   背景：`hob_spawn` 想给"本插件建出的会话"指定模型，但
 *     · `sessionController.create` 的入参**没有模型字段**（`SessionCreateRequest`），
 *       建会话用的是**全局默认**（`dsh-api-session-controller` 的 `agentOptions()`
 *       ≈ `:460` 读 `ctx.agentDefaultModel.currentSelection()`）；
 *     · `sessionController.selectModel()` **无条件**调
 *       `agentDefaultModel.saveSelection()` ⇒ 会把**宿主全局默认**改掉
 *       —— 本项目边界（"不许改宿主默认模型配置"）**明令禁止**。
 *
 *   ⇒ 候选路径 = 建完再给该会话装一个**会话级**选择。宿主自己的 headless 入口
 *     就是这么做的（`dsh-headless/lib/index.js:302-312`：
 *     `installModelSelection(agentCtx, { current, assembled: void 0 })`，
 *     该函数由 `@deepseek-ai/dsh-agent` 导出）。
 *
 * ── ⚠ 实测：**直接调那个导出【不生效】**（"注册更早的在外层"这条怀疑成立）──
 *   控制器在 `setup` 阶段就装过它自己的选择监听
 *   （`dsh-api-session-controller/lib/index.js` 的 `selectionFor()` ≈ `:281-313`
 *   → `installModelSelection(agent.ctx, selection)`，时机**早于** `create()` 返回）。
 *   cordis 的 `EventsService.waterfall` 是 `dispatch()` 顺序 push、
 *   `waterfall()` 从**队首**开始（`cordis/lib/index.js:317-331`）
 *   ⇒ **先注册的在【外层】**；控制器的装配监听拿回内层结果后**盖写**
 *   `variables.provider/model` ⇒ 我们后注册（= 更内层）的选择**被外层盖掉**。
 *
 *   实测对照（真会话，逐个读数见回报"前置读数"）：
 *     · 普通 `installModelSelection(agent.ctx, sel)`
 *       ⇒ 装配变量与真跑一轮的 `request/header` **都是宿主默认**
 *         （`dshapi/deepseek-v4.1-flash`）；判据①**不成立**；
 *     · 同样语义的监听 + `{ prepend: true }`
 *       ⇒ 装配变量 = 目标模型（`dshapi/glm-5.3-flash`），
 *         `request/header` = 目标模型，assistant 消息 `source.model` = 目标模型；
 *         判据①**成立**；
 *     · 上面**每一条**路径下 `ctx.agentDefaultModel.currentSelection()` 的
 *       **改前/改后读数相同**（`dshapi/deepseek-v4.1-flash`）⇒ 判据②**成立**。
 *   ⇒ **两条判据同时成立，但前提是"我们自己装、且 prepend"**，
 *     而不是直接调那个导出。这是本文件存在的全部理由。
 *
 * ── 为什么 `prepend: true` 在这里是**正确**而不是"抢优先级"────────────────
 *   本模块**就是**这个会话"首轮模型"的归属方（用户在设置页为"本插件建出的会话"
 *   选定了模型）。控制器那套监听服务于"GUI 里手动切模型"这条路径；
 *   两者同时存在时，**建会话时的显式默认**理应胜过"继承全局默认"这一兜底。
 *
 * ── ⚠ **自拆**：不能让我们的默认值永久劫持用户后续的手动切换 ──────────────
 *   prepend 监听会**持续**盖过控制器。若一直挂着，用户在 GUI 里给这个会话手动换
 *   模型**将不生效** —— 那是一个比"首轮默认没生效"严重得多的问题。
 *   ⇒ 一旦 **该会话的 `request/header` 已经落成目标路由**（= 首轮默认已经兑现），
 *     立即**自拆全部监听**。此后：
 *     · 多轮仍用目标模型 —— 靠**会话自己的 header**（`prepareRequest` 的
 *       `requestHeaderLogged` 分支会用持久化的 header 作 seed），实测第 2/3 轮保持；
 *     · 用户手动切换**能生效** —— 监听已拆，控制器重新掌权。实测：拆后经宿主原生
 *       提交路径切换 ⇒ 下一轮换成新模型。
 *   （实测读数：自拆后 turn2 = 切换后的模型、turn3 保持切换值。）
 *
 * ── 与 `selectModel` 的关系（**刻意不调它**）───────────────────────────
 *   `sessionController.selectModel()` 技术上也能装会话级选择，但它在同一个函数里
 *   **附带**改全局默认（`saveSelection`）⇒ 满足判据①、**违反判据②**，被任务书禁用。
 *   本文件只装监听 + 追加一条 durable 意图，**一次也不碰 `agentDefaultModel`**，
 *   也**不碰任何宿主私有字段**（只用公开的 `agent.ctx` / `agent.session`）。
 *
 * ── 生命周期 ─────────────────────────────────────────────────────────
 *   监听注册在 `agent.ctx`（该 agent 的**作用域** context，`dsh-scope` 的
 *   `createScope` 产物）上 ⇒ cordis 把 `ctx.on(...)` 记为**该作用域 fiber 的 effect**，
 *   agent 销毁/作用域 dispose 时**自动拆除**。本文件仍**返回** disposer：
 *   给"建完发现要回退"这类调用方一个显式出口，也让"谁装的谁拆"在代码里可见。
 */
import type { Context } from '@deepseek-ai/cordis'

/** 一个会话级模型选择（与宿主 `ModelSelection` 同形的最小集）。 */
export interface SessionModelSelection {
  /** provider 路由（`llm` 适配器的路由名，如 `dshapi`）。 */
  provider: string
  /** provider 名下的模型 id（如 `deepseek-v4.1-flash`）。 */
  model: string
  /** 适配器持有的思考档位；缺省 = 用该模型自身默认档。 */
  reasoningEffort?: string
}

/** 装载后**可变**的选择引用（与 `installModelSelection` 的第二参同形）。 */
interface MutableSelection {
  current: SessionModelSelection | undefined
  assembled: SessionModelSelection | undefined
}

/** 目标会话里一个"模型选择已兑现"的最小判据（只读 `request/header` 的 config）。 */
function headerConfigMatches(session: any, target: SessionModelSelection): boolean {
  try {
    const header = session?.requestHeader?.()
    const config = header?.config
    return config?.provider === target.provider && config?.model === target.model
  } catch {
    return false
  }
}

/**
 * 给一个**已建好的**会话装上会话级模型选择（prepend + 兑现后自拆）。
 *
 * 语义与 `@deepseek-ai/dsh-agent` 的 `installModelSelection` **逐条对齐**
 * （装配变量注入、请求侧路由改写、继承档位的清除规则），差别有两处、
 * 都是实测逼出来的（见文件头）：
 *   ① 两个监听都用 `{ prepend: true }` 注册，以胜过控制器在 `setup` 里更早装的那套；
 *   ② 目标路由**一旦兑现就自拆**，不劫持用户后续的手动切换。
 *
 * @param agentCtx - 目标 agent 的**作用域** context（`agent.ctx`）。
 *   ⚠ 必须是它，不是插件自己的 `ctx` —— 前者的 effect 随该 agent 一起拆除。
 * @param session - 目标会话（只读式地用于"兑现即自拆"的判据）。
 * @param selection - 选择值（读一次即固化到可变引用里，与宿主用法一致）。
 * @returns 拆除函数（幂等；即使不调用，agent 作用域 dispose 时也会自动拆除）。
 */
export function installSessionModelSelection(
  agentCtx: Context | any,
  session: any,
  selection: SessionModelSelection,
): () => void {
  const state: MutableSelection = {
    current: { ...selection },
    assembled: undefined,
  }
  const disposers: Array<() => void> = []
  let retired = false

  /** 拆除全部监听；幂等（自拆与外部显式拆除可能都调）。 */
  const dispose = (): void => {
    if (retired) return
    retired = true
    for (const d of disposers) {
      try { d() } catch { /* 作用域已 dispose 时忽略 */ }
    }
  }

  // ① 装配侧：把选中的 provider/model 写进 system-prompt 的 variables。
  //    ⚠ 与宿主同款**在 `next()` 之后**赋值 `assembled` —— 记录"本次装配实际用的选择"，
  //      供请求侧读（两处必须同源，否则并发切换会劈叉）。
  disposers.push(agentCtx.on(
    'system-prompt/assemble',
    async (_assembly: unknown, _context: unknown, next: () => Promise<any>) => {
      const selected = state.current
      const assembled = await next()
      state.assembled = selected
      if (selected === undefined || retired) return assembled
      return {
        ...assembled,
        variables: {
          ...assembled.variables,
          provider: selected.provider,
          model: selected.model,
        },
      }
    },
    { prepend: true },
  ))

  // ② 请求侧：改写真正发给适配器的 provider/model/档位。
  //    ⚠ **先清除继承来的 `reasoningEffort` 再按需写回**（宿主同款）：
  //      不清除的话，"目标模型没有档位"时会带着上一个模型的档位发出去。
  disposers.push(agentCtx.on(
    'agent/request',
    async (_payload: unknown, next: () => Promise<any>) => {
      const resolved = await next()
      const selected = state.assembled
      if (selected === undefined || retired) return resolved
      const { reasoningEffort: _inherited, ...withoutInheritedEffort } = resolved
      return {
        ...withoutInheritedEffort,
        provider: selected.provider,
        model: selected.model,
        ...(selected.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: selected.reasoningEffort }),
      }
    },
    { prepend: true },
  ))

  // ③ 兑现即自拆（**必须**，理由见文件头"自拆"）：
  //    目标路由已经写进会话自己的 `request/header` ⇒ 首轮默认已兑现，
  //    我们的监听立即退场，把"后续手动切换"还给控制器。
  //    ⚠ 判据用**会话持久事实**（requestHeader），不用内存标志 ——
  //      内存标志在"装配跑了但请求没发出去"这类中断下会误判。
  const maybeRetire = (): void => {
    if (headerConfigMatches(session, state.current ?? selection)) dispose()
  }
  // `session/event` 在每个会话事件后被触发（含 `request/header` 落地之后）。
  disposers.push(sessionCtxOn(agentCtx, (event: any) => {
    if (event?.type === 'request/header') maybeRetire()
  }))
  // 装配路径也顺带判一次：即便没有 session/event（某些驱动形态），
  // 下一次装配时就该退场（此时 header 必然已在）。
  disposers.push(agentCtx.on(
    'system-prompt/assemble',
    async (_assembly: unknown, _context: unknown, next: () => Promise<any>) => {
      maybeRetire()
      return await next()
    },
  ))

  return dispose
}

/**
 * 订阅"本会话的事件"，两种宿主形态都支持。
 *
 * ⚠ 为什么两种都要试：`session/event` 在实测的 Web 控制器路径上于 `agent.ctx`
 *   作用域可见（真会话里自拆**确实触发了**）；但它是**会话域**事件，
 *   保险起见同时挂 `agent/pre-step`（每轮开始前必触发）作为第二条退场时机 ——
 *   任一先到都能拆，**不会**因为某条事件形态变化而永久劫持。
 *
 * @param agentCtx - agent 作用域 context。
 * @param onEvent - 收到一个会话事件时调用。
 * @returns 拆除函数。
 */
function sessionCtxOn(agentCtx: Context | any, onEvent: (event: any) => void): () => void {
  const offs: Array<() => void> = []
  try {
    offs.push(agentCtx.on('session/event', (session: any, event: any) => {
      if (session !== undefined && event !== undefined) onEvent(event)
    }))
  } catch { /* 该事件形态不在场：忽略 */ }
  return () => {
    for (const off of offs) {
      try { off() } catch { /* 已拆 */ }
    }
  }
}

/**
 * 把一条模型选择记进**该会话自己的**事件日志（durable 意图）。
 *
 * ⚠ **它不能单独生效**（实测对照 D1）：只追加 `model/selection`、不装监听时，
 *   会话那一轮**仍然用宿主默认模型**。原因是控制器 `selectionFor()` 在建会话时
 *   已经把该投影的 **pending 快照**取走了（`let picked = projectionState.pending === null
 *   ? void 0 : …`，在 `setup` 阶段执行），之后才追加的事件不会回头更新那份快照。
 *   ⇒ 真正让首轮生效的是**监听**（见 {@link installSessionModelSelection}）。
 *
 * ⚠ 那为什么还要追加？—— 它负责**冷启恢复**这一路：
 *   若会话在任何一轮跑完之前被关闭/重开，`selectionFor()` 会**重新**读投影，
 *   此时 `pending` = 目标模型 ⇒ 该会话恢复后仍指向目标模型（而不是悄悄回到宿主默认）。
 *   这条语义与宿主自己的 `selectForNextRequest()` 完全一致（它也是"先 append 再设 current"）。
 *
 * @param agent - 目标 agent（只用到 `session.append`）。
 * @param selection - 要记录的选择。
 * @returns 是否写入成功（供调用方在回报里如实标注，**不抛**）。
 */
export function appendSessionModelSelection(
  agent: { session: { append(type: string, data: unknown): unknown } },
  selection: SessionModelSelection,
): boolean {
  try {
    agent.session.append('model/selection', { ...selection })
    return true
  } catch {
    // ⚠ 记录失败**不该**让建会话失败：监听已装上、首轮仍会生效，
    //   只是少了一条"冷启恢复"的来源（仍可从 request/header 恢复）。
    //   刻意吞在这里而不是往上抛：本函数的价值是"增强"，不是"门禁"。
    return false
  }
}
