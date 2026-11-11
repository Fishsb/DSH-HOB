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
import { WORK_PLANS_PATH } from './routes.ts'

export const WORK_PLANS_ROUTE_PATH = WORK_PLANS_PATH

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
  /** 外部刷新信号；值变化时重取（缺省 0 = 只取一次）。 */
  refreshTick?: number
  /**
   * 投影范围：
   *   · `all`（缺省）= 活动计划 + 过期归档；
   *   · `archived` = 只显示已归档计划（供「历史」视图使用）。
   * ⚠ 只改变同一份读数的显示范围，⛔ 不新增状态源。
   */
  only?: 'all' | 'archived'
  /** 面板标题（缺省「工作计划」）。 */
  title?: string
  /** 根节点数据属性；历史投影用独立名字，避免与主计划面板重复。 */
  dataRole?: 'work-plan-panel' | 'work-plan-history-panel'
  /**
   * 受控读数：父面板统一取一次后，把同一份 `work-plans` 响应交给活动/历史两个投影。
   * ⚠ 传入后本组件不再自行取数，避免同一路由产生两份会漂的状态。
   */
  source?: { kind: 'reading' } | { kind: 'ok'; report: any } | { kind: 'fail'; message: string }
}

type AbandonedRow = { planId?: string; state?: string; abandonedAt?: string; abandonedWhy?: string }

type PanelState =
  | { kind: 'reading' }
  | { kind: 'ok'; plans: any[]; unreadable: any[]; abandoned: AbandonedRow[]; mode: string; modeSource: string }
  | { kind: 'fail'; message: string }

/** 把只读路由响应收成面板状态；坏形状仍落「判不出」，⛔ 不兜底成空表。 */
const normalizeReport = (res: any): PanelState => {
  if (res?.ok === true && Array.isArray(res.plans)) {
    return {
      kind: 'ok',
      plans: res.plans,
      unreadable: Array.isArray(res.unreadable) ? res.unreadable : [],
      abandoned: Array.isArray(res.abandoned)
        ? res.abandoned.filter((x: unknown): x is AbandonedRow => typeof x === 'object' && x !== null)
        : [],
      mode: String(res.mode ?? 'unknown'),
      modeSource: String(res.modeSource ?? 'unknown'),
    }
  }
  return { kind: 'fail', message: String(res?.message ?? res?.reason ?? '工作计划读不到（没有可读原因）') }
}

export const WorkPlanPanel: React.FC<WorkPlanPanelProps> = (props) => {
  const [ownState, setOwnState] = React.useState<PanelState>({ kind: 'reading' })
  React.useEffect(() => {
    if (props.source !== undefined) return
    let alive = true
    void (async () => {
      try {
        const res = await (props.fetchPlans ?? fetchWorkPlans)(props.sessionId)
        if (!alive) return
        setOwnState(normalizeReport(res))
      } catch (e) {
        if (alive) setOwnState({ kind: 'fail', message: String((e as Error)?.message ?? e) })
      }
    })()
    return () => { alive = false }
  }, [props.fetchPlans, props.sessionId, props.refreshTick, props.source])

  const state: PanelState = props.source === undefined
    ? ownState
    : props.source.kind === 'ok'
      ? normalizeReport(props.source.report)
      : props.source

  const body = (() => {
    if (state.kind === 'reading') return React.createElement('div', { style: { opacity: 0.75 } }, '读取中…')
    if (state.kind === 'fail') {
      return React.createElement('div', {
        style: { color: 'var(--dsw-alias-status-error, #d11)' },
        'data-dsh-hob': 'work-plan-reason',
      }, `判不出：${state.message}`)
    }
    const { unreadable, abandoned, mode, modeSource } = state
    /** 来源只翻已知值；未知值原样显示（⛔ 不猜成「本会话策略」）。 */
    const sourceLabel = modeSource === 'stored' ? '本会话策略'
      : modeSource === 'legacy-migrated' ? '旧会话迁移'
        : modeSource === 'unknown' ? '判不出' : modeSource
    /** 过期归档（移出 active、原状态保留）；⚠ 单独一档，⛔ 不并进活动计划。 */
    const plans = props.only === 'archived' ? [] : state.plans
    if (props.only === 'archived' && abandoned.length === 0 && unreadable.length === 0) {
      return React.createElement('div', {
        style: { opacity: 0.75 },
        'data-dsh-hob': 'work-plan-history-empty',
      }, '表里是空的 —— 没有已归档计划。')
    }
    if (plans.length === 0 && unreadable.length === 0 && abandoned.length === 0) {
      return React.createElement('div', {
        style: { opacity: 0.75 },
        'data-dsh-hob': 'work-plan-empty',
      }, `表里是空的（当前推进方式：${modeLabel(mode)} · ${sourceLabel}）—— 没有活动计划，不代表没有活。`)
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
        /**
         * **过期读数**（2026-11-06）：计划不能"看起来还在跑"而实际没人管。
         * ⚠ 只显示事实（多久、是否占槽），⛔ 不在这里做自动删除。
         */
        const healthLine = (() => {
          const parts: string[] = []
          if (typeof plan?.ageHours === 'number') parts.push(`已存在 ${plan.ageHours}h`)
          if (plan?.occupiesSlot === false && plan?.state !== 'completed' && plan?.state !== 'failed') {
            parts.push('不占执行槽（派活方已停）')
          }
          if (plan?.stale === true) parts.push('⚠ 超过 24h 未收口，需人工处置')
          return parts.length === 0 ? undefined : parts.join(' · ')
        })()
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
          }, `${counts} · 计划创建时：${modeLabel(plan?.modeSnapshot ?? mode)} · 当前会话：${modeLabel(mode)}`),
          /**
           * 计划快照与当前会话档位不同时必须说明“为什么改档后本计划没变”。
           * ⚠ 相同则不多说一句（⛔ 不制造常驻噪声）。
           */
          plan?.modeSnapshot !== undefined && plan.modeSnapshot !== mode && mode !== 'unknown'
            ? React.createElement('div', {
                'data-dsh-hob': 'work-plan-mode-note',
                style: { fontSize: '0.88em', color: 'var(--dsw-alias-label-tertiary)', overflowWrap: 'anywhere' },
              }, '本计划按创建时档位推进；改档只影响下一份计划。')
            : null,
          healthLine === undefined
            ? null
            : React.createElement('div', {
                'data-dsh-hob': 'work-plan-health',
                style: {
                  fontSize: '0.88em',
                  overflowWrap: 'anywhere',
                  ...(plan?.stale === true ? { color: 'var(--dsw-alias-status-warning, #b26a00)' } : {}),
                },
              }, healthLine),
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
      ...abandoned.map((row, i) => React.createElement('div', {
        key: `abandoned-${String(row?.planId ?? i)}`,
        'data-dsh-hob': 'work-plan-abandoned',
        style: { fontSize: '0.88em', opacity: 0.85, overflowWrap: 'anywhere' },
      }, `${String(row?.planId ?? '(判不出 planId)')} · 已过期归档（原状态 ${String(row?.state ?? '?')}）`
        + `${String(row?.abandonedAt ?? '') === '' ? '' : ` · ${String(row.abandonedAt)}`}`
        + `${String(row?.abandonedWhy ?? '') === '' ? '' : ` · ${String(row.abandonedWhy)}`}`)),
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
      'data-dsh-hob': props.dataRole ?? 'work-plan-panel',
      'data-only': props.only ?? 'all',
      style: {
        marginTop: 12,
        paddingTop: 10,
        borderTop: '1px solid var(--dsw-alias-border-l4, transparent)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      },
    },
    React.createElement('h3', { style: { margin: '0 0 6px', fontSize: '1em' } }, props.title ?? '工作计划'),
    body,
  )
}
