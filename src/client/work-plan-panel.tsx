/**
 * **工作计划（WorkPlan）面板** —— 只读。
 *
 * 回答三个问题（方案第五波）：
 *   · 当前有几份计划、各自到哪一步；
 *   · 每条轨道**给了谁**、正在跑还是等谁；
 *   · 为什么只有一路（单轨原因 / 写轨串行化的真实重叠）。
 *
 * ── 边界 ───────────────────────────────────────────────────────────────
 *   · ⛔ 零按钮、零勾选、零百分比：这里显示的是**计数与状态**，不是"完成度"；
 *   · ⛔ 不自己推断状态：服务端 `status()` 给什么就显示什么；
 *   · 三态必须各自可读：读取中 / 有数据 / 判不出（⛔ 不把读不到显示成 0 个计划）。
 */
import * as React from 'react'

export const WORK_PLANS_ROUTE_PATH = '/api/dsh-hob/work-plans'

/** 轨道状态 → 人读。⚠ 只翻译**已知**状态，未知值原样显示（不猜）。 */
const TRACK_STATE_LABEL: Readonly<Record<string, string>> = {
  pending: '待启动',
  running: '运行中',
  returned: '已回传',
  failed: '失败',
  cancelled: '已取消',
}

const PLAN_STATE_LABEL: Readonly<Record<string, string>> = {
  planned: '已计划',
  running: '执行中',
  joining: '汇合中',
  completed: '已收口',
  failed: '失败',
}

const MODE_LABEL: Readonly<Record<string, string>> = {
  auto: '自动',
  single: '单会话',
  multi: '多会话',
  unknown: '判不出',
}

/** 单轨原因的封闭集 → 人读（⚠ 未知值原样显示，不吞）。 */
const SINGLE_REASON_LABEL: Readonly<Record<string, string>> = {
  'same-file': '写同一批文件',
  'shared-contract': '共享契约',
  'strict-order': '必须按顺序',
  'single-acceptance-unit': '只有一个验收单元',
  'insufficient-independent-scope': '独立范围不足',
}

const trackStateLabel = (state: unknown): string =>
  TRACK_STATE_LABEL[String(state)] ?? String(state ?? '判不出')

const planStateLabel = (state: unknown): string =>
  PLAN_STATE_LABEL[String(state)] ?? String(state ?? '判不出')

const modeLabel = (mode: unknown): string =>
  MODE_LABEL[String(mode)] ?? String(mode ?? '判不出')

const reasonLabel = (reason: unknown): string =>
  SINGLE_REASON_LABEL[String(reason)] ?? String(reason ?? '')

/**
 * 默认取数：`POST /api/dsh-hob/work-plans { sessionId }`。
 *
 * @param sessionId - 宿主给标签页的会话 id
 * @returns 线格式（`{ok,plans,unreadable}` 或 `{ok:false,reason,message}`）
 */
export async function fetchWorkPlans(sessionId?: string): Promise<any> {
  const res = await fetch(WORK_PLANS_ROUTE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sessionId === undefined || sessionId === '' ? {} : { sessionId }),
  })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try { message = (await res.text()).slice(0, 200) || message } catch { /* 忽略 */ }
    return { ok: false, reason: 'route-error', message }
  }
  try { return await res.json() } catch {
    return { ok: false, reason: 'invalid-json', message: '工作计划路由没有返回 JSON' }
  }
}

export interface WorkPlanPanelProps {
  sessionId?: string
  /** 取数注入点（⚠ 生产路径省略 ⇒ 用真 HTTP；机检注入假函数）。 */
  fetchPlans?: (sessionId?: string) => Promise<any>
}

type PanelState =
  | { kind: 'reading' }
  | { kind: 'ok'; plans: any[]; unreadable: any[]; mode: string }
  | { kind: 'fail'; message: string }

export const WorkPlanPanel: React.FC<WorkPlanPanelProps> = (props) => {
  const [state, setState] = React.useState<PanelState>({ kind: 'reading' })
  React.useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await (props.fetchPlans ?? fetchWorkPlans)(props.sessionId)
        if (!alive) return
        if (res?.ok === true && Array.isArray(res.plans)) {
          setState({
            kind: 'ok',
            plans: res.plans,
            unreadable: Array.isArray(res.unreadable) ? res.unreadable : [],
            mode: String(res.mode ?? 'unknown'),
          })
        } else {
          setState({ kind: 'fail', message: String(res?.message ?? res?.reason ?? '工作计划读不到（没有可读原因）') })
        }
      } catch (e) {
        if (alive) setState({ kind: 'fail', message: String((e as Error)?.message ?? e) })
      }
    })()
    return () => { alive = false }
  }, [props.fetchPlans, props.sessionId])

  const body = (() => {
    if (state.kind === 'reading') return React.createElement('div', { style: { opacity: 0.75 } }, '读取中…')
    if (state.kind === 'fail') {
      return React.createElement('div', {
        style: { color: 'var(--dsw-alias-status-error, #d11)' },
        'data-dsh-hob': 'work-plan-reason',
      }, `判不出：${state.message}`)
    }
    const { plans, unreadable, mode } = state
    if (plans.length === 0 && unreadable.length === 0) {
      return React.createElement('div', {
        style: { opacity: 0.75 },
        'data-dsh-hob': 'work-plan-empty',
      }, `表里是空的（当前工作方式：${modeLabel(mode)}）—— 没有活动计划，不代表没有活。`)
    }
    return React.createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      ...plans.map((plan, i) => {
        const tracks: any[] = Array.isArray(plan?.tracks) ? plan.tracks : []
        const counts = [
          `轨道 ${Number(plan?.trackCount ?? tracks.length)}`,
          `运行 ${Number(plan?.running ?? 0)}`,
          `等待 ${Number(plan?.waiting ?? 0)}`,
          `返回 ${Number(plan?.returned ?? 0)}`,
          `失败 ${Number(plan?.failed ?? 0)}`,
        ].join(' · ')
        const serialized = plan?.serialized
        const reasonLine = (() => {
          if (plan?.singleTrackReason === undefined && serialized === undefined) return undefined
          const base = plan?.singleTrackReason === undefined ? '' : reasonLabel(plan.singleTrackReason)
          const paths: string[] = Array.isArray(serialized?.sharedPaths) ? serialized.sharedPaths : []
          const groups: string[][] = Array.isArray(serialized?.groups) ? serialized.groups : []
          const chain = groups.filter((g) => Array.isArray(g) && g.length > 1)
            .map((g) => g.join(' → ')).join(' / ')
          return [
            base === '' ? '' : `单轨原因：${base}`,
            chain === '' ? '' : `串行链：${chain}`,
            paths.length === 0 ? '' : `重叠路径：${paths.join(', ')}`,
          ].filter((x) => x !== '').join(' · ')
        })()
        return React.createElement(
          'div',
          {
            key: String(plan?.planId ?? i),
            'data-dsh-hob': 'work-plan-row',
            style: { display: 'flex', flexDirection: 'column', gap: 3 },
          },
          React.createElement('div', { style: { fontWeight: 600, overflowWrap: 'anywhere' } },
            `${String(plan?.planId ?? '（判不出编号）')} · ${planStateLabel(plan?.state)}`),
          React.createElement('div', {
            style: { fontSize: '0.9em', color: 'var(--dsw-alias-label-secondary)', overflowWrap: 'anywhere' },
          }, `${counts} · 档位 ${modeLabel(plan?.modeSnapshot ?? mode)}`),
          reasonLine === undefined
            ? null
            : React.createElement('div', {
                'data-dsh-hob': 'work-plan-single-reason',
                style: { fontSize: '0.9em', overflowWrap: 'anywhere' },
              }, reasonLine),
          typeof plan?.rationale === 'string' && plan.rationale !== ''
            ? React.createElement('div', {
                style: { fontSize: '0.88em', color: 'var(--dsw-alias-label-tertiary)', overflowWrap: 'anywhere' },
              }, `依据：${plan.rationale}`)
            : null,
          ...tracks.map((track, k) => React.createElement(
            'div',
            {
              key: String(track?.trackId ?? k),
              'data-dsh-hob': 'work-plan-track-row',
              'data-track-state': String(track?.state ?? ''),
              style: { paddingLeft: 10, fontSize: '0.9em', overflowWrap: 'anywhere' },
            },
            `· ${String(track?.trackId ?? '?')}（${String(track?.taskId ?? '?')}）`
            + ` → ${String(track?.sessionId ?? '?')}`
            + ` · ${trackStateLabel(track?.state)}`
            + (track?.accessType === 'write' ? ' · 写' : ' · 读')
            + (Array.isArray(track?.dependsOn) && track.dependsOn.length > 0
              ? ` · 等 ${track.dependsOn.join(', ')}`
              : ''),
          )),
        )
      }),
      ...unreadable.map((row, i) => React.createElement('div', {
        key: `unreadable-${i}`,
        'data-dsh-hob': 'work-plan-reason',
        style: { color: 'var(--dsw-alias-status-error, #d11)', fontSize: '0.9em', overflowWrap: 'anywhere' },
      }, `⚠ ${String(row?.planId ?? '(判不出 planId)')} 读不出：${String(row?.reason ?? 'unreadable')}`)),
    )
  })()

  return React.createElement(
    'section',
    {
      'data-dsh-hob': 'work-plan-panel',
      style: {
        marginTop: 12,
        paddingTop: 10,
        borderTop: '1px solid var(--dsw-alias-border-l4, transparent)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      },
    },
    React.createElement('h3', { style: { margin: '0 0 6px', fontSize: '1em' } }, '工作计划'),
    body,
  )
}
