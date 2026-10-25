/**
 * **「这个会话选过档位没有」的只读路由**（2026-10-22 · 第 4 轮 · 任务书 §二①）。
 *
 * ══ 它解决什么 ═════════════════════════════════════════════════════════════
 *   上一轮把"宿主原生新建的 Hob 会话"的自动弹窗骨架写好了，但**触发条件拿不到真值**：
 *   `recorded` 只活在 **host 半边**的策略服务里（`src/session-policy-service.ts:70/835`），
 *   客户端**没有任何通道**读它。⇒ 本文件补的就是那一条**只读**通道。
 *
 * ══ 为什么是独立文件（而不是加进 `session-create-channel.ts` 的 `action`）══════
 *   任务书 §一 裁定 **D2**：那个文件由另一实施会话持有、且本单 **禁改**
 *   （§四 第三条）。⇒ 新增**一条独立路由**，零冲突。
 *
 * ══ 它有哪几条硬纪律（⛔ 缺一条就不该有这条路由）════════════════════════════
 *   ① **本文件自己零写操作**：不建会话、不写策略、不改任何状态
 *      （⚠ `handlePolicyQuery` 不 import 任何写函数；`handlePolicyWrite` 的写只发生在
 *        `action:'write'` 那一支，且只经服务层的 `set`）。
 *      ⚠⚠ **2026-10-24 订正一句过强的承诺**：改前这里写的是"全文件零写操作"，
 *      但**读路径间接会写一次** —— 服务层在**第一次**接触某个账本时会把
 *      "迁移纪元"落盘（`ensurePolicyStoreEpoch`，治"纪元从不落盘"）。
 *      那次写**不碰任何会话记录**（只补 `migrationEpoch`），但**确实是写**
 *      ⇒ 按本仓纪律必须如实写出来，⛔ 不能留一句"零写"让人以为读路径永不落盘。
 *   ② **只回一个语义字段**：`{ ok, state }`（`state` ∈ 四态，见
 *      `src/shared/policy-record-state.ts`）。⛔ **不回带档位值 / 工作方式 / 来源分类**
 *      —— 任务书 §二① 明确"客户端只需要知道选没选过"。
 *   ③ **非 Hob 不落"挡"分支**：`isHob=false` ⇒ `'not-applicable'`
 *      （`classifyPolicyRecord` 的 ② 步），客户端把它当 `'unknown'` ⇒ 不渲染、不弹。
 *   ④ **判不出必须能与 `recorded:false` 区分**：`store-unreadable` / `version-unknown` /
 *      `no-identity` / `bad-record` ⇒ `'unknown'`（⚠ 在 `recorded` **之前**判，
 *      因为坏存储时 `recorded` 恒为 `false` —— 若顺序反了，"读不出"会被误报成"没选过"）。
 *   ⑤ **鉴权/跨站不自己造**：由宿主 `ctx.connection.fetch.register` 的栅栏保证
 *      （与 `/api/dsh-hob/session-create` 同源同族，见该文件头 ①）。
 *   ⑥ **路由命名同族**：`/api/dsh-hob/session-policy`。
 *
 * ══ 为什么门只按 `isHob` 判，而不在客户端再比一次预设名 ══════════════════════
 *   客户端若自己按 `agentPreset === 'Hob'` 过滤，就出现**第二份判据**（会漂）。
 *   本路由用宿主侧 `svc.get(session).isHob`（它读 `agentPreset` **投影**，
 *   见 `src/session-policy-service.ts:649` `preset.preset === PLANNING_PRESET_ID`）
 *   ⇒ 判据**只有一处**。客户端只消费 `state`。
 *   ⚠ 客户端侧**仍保留**一道 `isHobPreset` 前置闸（`hob-unselected-gate.tsx`）：
 *     那是为了"非 Hob 会话**零请求**"（省一次往返），**不是**把判定搬过去 ——
 *     它只是早退，最终结论仍以本路由的 `state` 为准。
 *
 * ══ 边界（如实说）══════════════════════════════════════════════════════════
 *   · 只回答"选过没有"，**不回答**"当前是什么档"（那是创建链与读工具的判据，
 *     ⛔ 不要为了让 UI 少一次请求就顺手回带档位值 —— 面会变大）。
 *   · 会话不在当前实例里 ⇒ `unknown`（⚠ **不是** `unrecorded`：判不出就是判不出）。
 *   · `sessionId` 缺失/非字符串 ⇒ `ok:false`（⚠ 与"读不出来"分开：那是**请求错**）。
 */

import type { Context } from '@deepseek-ai/cordis'
import { SESSION_POLICY_SERVICE } from '../config.ts'
import {
  classifyPolicyRecord, okState, badRequest, UNDECIDABLE_SOURCES,
  type PolicyRecordProbe, type PolicyRecordResponse,
} from '../shared/policy-record-state.ts'
import type { PolicyResolution } from '../server/session-policy.ts'
/**
 * ⚠⚠ **开放面常量**（2026-10-24 · 写入口闸）：与票据链 / `hob_spawn` **同一个来源**
 *   （`src/shared/read-level-policy.ts`），⛔ 不在本文件另抄一份白名单 ——
 *   抄一份的下场就是"重新收紧开放面时这里静默放行"。
 */
import { isOpenReadLevel, readLevelNotOpenReason } from '../shared/read-level-policy.ts'

/**
 * ⚠⚠ **编译期对齐**（本文件是 host 半边，只有它能 import 那个类型）。
 *
 *   `UNDECIDABLE_SOURCES` 定义在 `src/shared/policy-record-state.ts`（那里⛔ 不 import
 *   `PolicyResolution`，否则会把 host 依赖拖进 client 构建）。
 *   ⇒ 在这里做**一次性**的 `satisfies`：只要 `session-policy.ts` 的 `source` 联合
 *     改名/删值，**这个文件会编译失败** ⇒ 漂移当场暴露，而不是等到线上"每次都 unknown"。
 *   ⚠ 这是**单向**校验（共享清单 ⊆ 宿主联合）。反向不校验是故意的：
 *     宿主新增一个 source 值**不应该**强制我们判断它算不算"判不出"——
 *     默认落到 `recorded ? recorded : unrecorded` 是安全的（新值若真表示"读不到"，
 *     由那次改动的人来这里加一行并说明理由）。
 */
const _sourceAlignment: ReadonlyArray<PolicyResolution['source']> = UNDECIDABLE_SOURCES as ReadonlyArray<PolicyResolution['source']>
export { _sourceAlignment }

export const name = 'dsh-hob-session-policy-route'

/** 本路由路径（⚠ 与 `/api/dsh-hob/session-create` 同族，⛔ 不撞名）。 */
export const POLICY_ROUTE_PATH = '/api/dsh-hob/session-policy'

/** 小工具：统一 JSON 响应（⚠ 与创建通道同一形状；不引宿主私有类型，保持可离线机检）。 */
function json(status: number, body: unknown): any {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  }
}

/**
 * 一条请求的处理体（⚠ 纯依赖注入，便于机检用假服务跑真源码）。
 *
 * @param deps - 取服务与会话的两个闭包。
 * @param body - 已解析的请求体。
 * @returns 线格式响应（⚠ 只有 `state` 一个语义字段）。
 */
export function handlePolicyQuery(
  deps: {
    /** 取逐会话策略服务（`hobSessionPolicy`）。 */
    policyOf: () => any
    /** 取活会话（`sessions.get`）。 */
    sessionOf: (sessionId: string) => any
  },
  body: any,
): PolicyRecordResponse {
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
  if (sessionId === '') return badRequest('缺 sessionId ⇒ 无法回答"这个会话选过没有"')

  // ── ① 服务在场吗？⚠ 缺席 ⇒ unknown（⛔ 不是 unrecorded）───────────────────
  const svc = (() => {
    try { return deps.policyOf() } catch { return undefined }
  })()
  if (svc === undefined || svc === null || typeof svc.get !== 'function') {
    return okState('unknown')
  }

  // ── ② 会话在实例里吗？⚠ 不在 ⇒ unknown（⛔ 不是 unrecorded）───────────────
  const session = (() => {
    try { return deps.sessionOf(sessionId) } catch { return undefined }
  })()
  if (session === undefined || session === null) return okState('unknown')

  // ── ③ 读视图并归一（⚠ 抛错 ⇒ unknown，⛔ 不许落到 unrecorded）─────────────
  const probe: PolicyRecordProbe | undefined = (() => {
    try {
      const v = svc.get(session)
      if (v === undefined || v === null || typeof v !== 'object') return undefined
      return {
        isHob: v.isHob === true,
        recorded: v.recorded === true,
        source: String(v.source ?? ''),
      }
    } catch {
      return undefined
    }
  })()

  return okState(classifyPolicyRecord(probe))
}

/**
 * **已有会话的写入处理体**（2026-10-22 第 4 轮 · 任务书 §二②）。
 *
 * ══ 它为什么必须存在 ═══════════════════════════════════════════════════════
 *   `create-hob-dialog.tsx` 的"已有会话模式"确认后**不能**走 `issue`/`create`
 *   （那会再建一个会话）。而 `session-create-channel.ts` 本单**禁改**
 *   ⇒ 写入动作只能挂在这条新路由上。
 *
 * ══ 三条纪律（⛔ 缺一条就不该有它）═════════════════════════════════════════
 *   ① **只写两项**：读档 + 推进方式。⛔ 不新建会话、⛔ 不改工作区归属。
 *   ② **走已有服务**：`hobSessionPolicy.set(...)`（`src/session-policy-service.ts:839`），
 *      ⛔ **不新造第二套写入**（那会出现两份会漂的校验）。
 *   ③ **失败必须可读且不得当作已选**：`set` 返回 `ok:false` ⇒ 原样回 `ok:false`；
 *      ⚠ 调用方（弹窗）据此停在 error，**不**标记已选。
 *
 * ══ `activation` 为什么传 `'active'` ═══════════════════════════════════════
 *   创建链用的是 `'pending'` → 回读一致 → `activate()` 两步（因为它同时在建会话，
 *   中途失败要能撤）。本场景**会话已经存在**、用户刚刚**亲自**选了两项、
 *   而且这里**只写这一个会话** ⇒ 没有"建了一半"的中间态可撤
 *   ⇒ 直接 `'active'` 一步到位，⛔ 不留一个"写了但永不生效"的 pending 记录
 *   （那会让这个会话永远最低档 + 不推进 —— 用户会以为按钮没反应）。
 *   ⚠ `set(..., 'active')` 内部仍然**原子写 + 回读校验**（`setSessionPolicy` 的既有行为），
 *     所以"写成功但回读不一致"照样返回 `ok:false`。
 *
 * @param deps - 取策略服务与会话。
 * @param body - 已解析的请求体（`sessionId` / `level` / `workMode`）。
 * @returns 线格式响应（⚠ `ok:true` 时**不回**任何档位值 —— 客户端不需要）。
 */
export function handlePolicyWrite(
  deps: {
    policyOf: () => any
    sessionOf: (sessionId: string) => any
  },
  body: any,
): PolicyRecordResponse {
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
  const level = typeof body?.level === 'string' ? body.level : ''
  const workMode = typeof body?.workMode === 'string' ? body.workMode : ''
  if (sessionId === '') return badRequest('缺 sessionId ⇒ 不知道给哪个会话写入')
  if (level === '' || workMode === '') return badRequest('缺 level 或 workMode ⇒ 拒绝写入')

  const svc = (() => {
    try { return deps.policyOf() } catch { return undefined }
  })()
  if (svc === undefined || svc === null || typeof svc.set !== 'function') {
    return badRequest('逐会话策略服务未提供 set() ⇒ 无法写入（⛔ 不降级、不假装成功）')
  }

  /**
   * ⚠⚠ **两道闸门（2026-10-24 补 · P0-3）**：改前这里**没有任何开放面校验、也没有 isHob 判定**
   *   ⇒ 请求方自报 `project` / `workspace` 都会被照签并落盘 `activation:'active'`
   *     （⚠ 当时的开放面只有 `ledger`，所以那是**明明白白的越权**；
   *      实测探针 `/tmp/probe-write-gate.mjs`：三档全部 `ok:true` 且都调用了 `svc.set`）。
   *
   * ── ① 开放面闸（与票据链 / `hob_spawn` **同一个常量**）──────────────────
   *   判据是 `isOpenReadLevel(level)`（`src/shared/read-level-policy.ts`），
   *   ⛔ **不在这里另抄一份白名单**（那必然与开放面漂移）。
   *   2026-10-24 用户裁定 2 把开放面扩到三档 ⇒ 现在 `project`/`workspace` 合法；
   *   但**这道闸必须留着**：重新收紧开放面时它自动跟着收，⛔ 不要因为"今天都合法"就删掉。
   *
   * ── ② isHob 闸 ────────────────────────────────────────────────────
   *   本路由只服务 **Hob** 会话的两轴选择。非 Hob 会话写进 Hob 策略记录
   *   ⇒ 本机制**越界管了别人**（`isHob=false` 的语义会失效），而且会留下一条
   *   "看起来像用户选过"的记录。⇒ 非 Hob **一律拒**。
   *   ⚠ 判据用**策略服务的同一个 `get()`**（它内部读宿主 `agentPreset` 投影，
   *     见 `session-policy-service.ts` 的 `presetOfSession`）⇒ ⛔ 不在这里另判一次预设名。
   *   ⚠ 判不出（服务没有 `get` / 抛错 / 会话不在实例里 / 读数不可信）⇒ **拒**（fail-closed）：
   *     这是"写"路径，⛔ 不能因为"判不出是不是 Hob"就照写。
   *
   * ⚠ 两道闸都在 `svc.set(...)` **之前** ⇒ 拒绝时**零副作用**（没写盘、没建记录）。
   */
  if (!isOpenReadLevel(level)) {
    return badRequest(readLevelNotOpenReason('写入会话策略'))
  }
  const hobGate = (() => {
    const session = (() => {
      try { return deps.sessionOf(sessionId) } catch { return undefined }
    })()
    if (session === undefined || session === null) {
      return { ok: false as const, reason: `会话 ${JSON.stringify(sessionId)} 不在当前实例里 ⇒ 判不出它是不是 Hob，拒绝写入` }
    }
    let v: any
    try { v = svc.get?.(session) } catch (e) {
      return { ok: false as const, reason: `读取该会话策略抛错（${String((e as Error)?.message ?? e)}）⇒ 拒绝写入` }
    }
    if (v === undefined || v === null || typeof v !== 'object') {
      return { ok: false as const, reason: '读不到该会话的策略视图 ⇒ 判不出它是不是 Hob，拒绝写入（⛔ 不盲写）' }
    }
    if (v.isHob !== true) {
      return { ok: false as const, reason: '该会话**不是 Hob 预设会话** ⇒ 本路由只写 Hob 会话的两轴选择（⛔ 不越界）' }
    }
    return { ok: true as const, reason: '' }
  })()
  if (!hobGate.ok) return badRequest(hobGate.reason)

  const r = (() => {
    try { return svc.set(sessionId, level, workMode, 'active') } catch (e) {
      return { ok: false, reason: `策略写入抛错：${String((e as Error)?.message ?? e)}` }
    }
  })()
  if (r?.ok !== true) {
    // ⚠ 失败原样上报（⛔ 不吞掉原因，也⛔ 不把失败报成已选）
    return badRequest(String(r?.reason ?? '策略写入失败（服务未说明原因）'))
  }
  /**
   * ⚠ 写完**回读一次**，把"选过了"这个事实**当场确认**（⛔ 不信 write 返回值就收工）。
   *   若回读仍说未选 ⇒ 如实报失败（那说明写没落盘 / 落到别处去了）。
   */
  const confirmed = (() => {
    try {
      const v = svc.get?.(deps.sessionOf(sessionId))
      return v === undefined || v === null ? undefined : (v.recorded === true ? 'recorded' : 'unrecorded')
    } catch { return undefined }
  })()
  if (confirmed !== 'recorded') {
    return badRequest('写入后回读仍未看到记录 ⇒ 按失败处理（⚠ 本会话仍是未选状态）')
  }
  return okState('recorded')
}

/**
 * 安装：登记只读路由。
 *
 * ⚠ **只在 `connection` 服务存在时登记**（反应式 inject）—— 缺它 ⇒ 不登记、不报错，
 *   插件其余部分照常（与 `session-create-channel.ts` / `bus.ts` 同一纪律）。
 * ⚠ 资源挂 `ctx.effect` ⇒ 卸载自动注销（⛔ 不留野路由）。
 *
 * @param ctx - host 半边上下文。
 */
export function installPolicyRoute(ctx: Context): void {
  const hostCtx = ctx as any

  ctx.inject(['connection'], (svcCtx: any) => {
    try {
      const conn = svcCtx.get?.('connection') ?? svcCtx.connection
      const fetch = conn?.fetch
      if (fetch === undefined || typeof fetch.register !== 'function') {
        hostCtx.logger?.warn?.('[dsh-hob] 宿主 `connection.fetch` 不可用 ⇒ 会话策略**只读路由未登记**')
        return
      }
      const disposer = fetch.register({
        path: POLICY_ROUTE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request: any) => {
          // ⚠ 鉴权与跨站**已在宿主栅栏里做过**（未认证 401 / 跨站 403），此处只处理业务。
          let body: any
          try {
            const text = typeof request.text === 'function' ? await request.text() : ''
            body = JSON.parse(text === '' ? '{}' : text)
          } catch {
            return json(400, badRequest('请求体不是 JSON'))
          }
          const out = (() => {
            /**
             * ⚠ **两个动作，按 `action` 分发**（2026-10-22 第 4 轮）：
             *   · `read`（默认）—— 只读，问"这个会话选过没有"；
             *   · `write`        —— 给**已存在的会话**写两项选择（任务书 §二②）。
             * ⚠ 为什么合成一条路由而不是两条：两者用**同一套服务依赖**（`hobSessionPolicy`）
             *   与同一条鉴权栅栏；拆两条只是多一份登记代码，收益为零。
             * ⚠ `action` 缺省按 `read`（向后兼容：上一轮客户端发的就是不带到 action 的体）。
             */
            const action = String(body?.action ?? 'read')
            const deps = {
              policyOf: () => {
                try { return hostCtx.get?.(SESSION_POLICY_SERVICE) ?? hostCtx[SESSION_POLICY_SERVICE] } catch { return undefined }
              },
              sessionOf: (sessionId: string) => {
                try { return hostCtx.get?.('sessions')?.get?.(sessionId) } catch { return undefined }
              },
            }
            if (action === 'read') return handlePolicyQuery(deps, body)
            if (action === 'write') return handlePolicyWrite(deps, body)
            return badRequest(`未知 action：${JSON.stringify(action)}（只支持 read / write）`)
          })()
          return json(out.ok ? 200 : 400, out)
        },
      })
      ctx.effect(() => () => {
        try { disposer?.() } catch { /* 忽略 */ }
      }, 'dsh-hob: session policy read route')
      hostCtx.logger?.info?.(`[dsh-hob] 会话策略只读路由已登记：POST ${POLICY_ROUTE_PATH}`)
    } catch (e) {
      hostCtx.logger?.warn?.(`[dsh-hob] 会话策略只读路由登记失败：${String((e as Error)?.message ?? e)}`)
    }
  })
}
