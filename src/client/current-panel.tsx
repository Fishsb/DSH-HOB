/**
 * 当前工作入口（只读）。
 *
 * 数据源：`POST /api/dsh-hob/ledger-resource { resource:"current" }`。
 * ⚠ 只渲染服务端生成的 Current；前端不自行重算状态。
 */
import * as React from 'react'

export const LEDGER_RESOURCE_PATH = '/api/dsh-hob/ledger-resource'

/** 受限 Markdown 视图的一行：只识别标题 / 列表 / 引用，其余按纯文本处理。 */
export interface CurrentMarkdownLine {
  kind: 'title' | 'section' | 'subheading' | 'subsection' | 'quote' | 'item'
  text: string
}

export interface CurrentSection {
  heading: string
  lines: CurrentMarkdownLine[]
}

/**
 * 把服务端 Current 原文拆成可读行。
 *
 * ⚠ 不引入 HTML / 第三方 Markdown 渲染器：账本是半可信输入，这里只去掉已知的
 *   Markdown 结构标记并把剩余内容当**纯文本**交给 React。未知语法原样保留，
 *   避免“为了好看吞掉账本原文”。
 */
export function currentMarkdownLines(text: string): CurrentMarkdownLine[] {
  return String(text).split(/\r?\n/).flatMap((raw): CurrentMarkdownLine[] => {
    const line = raw.trim()
    if (line === '') return []
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      const depth = heading[1].length
      return [{
        kind: depth === 1
          ? (heading[2].startsWith('Current') ? 'title' : 'section')
          : depth === 2
            ? 'section'
            : depth === 3
              ? 'subheading'
              : 'subsection',
        text: heading[2].trim(),
      }]
    }
    if (/^>\s?/.test(line)) return [{ kind: 'quote', text: line.replace(/^>\s?/, '').trim() }]
    if (/^[-*]\s+/.test(line)) return [{ kind: 'item', text: line.replace(/^[-*]\s+/, '').trim() }]
    return [{ kind: 'item', text: line }]
  })
}

/** 轻量强调：只去掉成对 Markdown 粗体标记，内容仍作为单个文本节点渲染。 */
export function plainCurrentText(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')
}

/** 按二级标题分组；标题前的内容保留在第一组，避免原文被静默丢弃。 */
export function currentSections(lines: readonly CurrentMarkdownLine[]): CurrentSection[] {
  const out: CurrentSection[] = []
  let current: CurrentSection = { heading: '', lines: [] }
  for (const line of lines) {
    if (line.kind === 'section') {
      if (current.heading !== '' || current.lines.length > 0) out.push(current)
      current = { heading: line.text, lines: [] }
    } else if (line.kind !== 'title') {
      current.lines.push(line)
    }
  }
  if (current.heading !== '' || current.lines.length > 0) out.push(current)
  return out
}

export async function fetchCurrent(sessionId?: string): Promise<any> {
  const res = await fetch(LEDGER_RESOURCE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...(sessionId ? { sessionId } : {}), resource: 'current' }),
  })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try { message = (await res.text()).slice(0, 200) || message } catch { /* ignore */ }
    return { ok: false, reason: 'route-error', message }
  }
  try { return await res.json() } catch { return { ok: false, reason: 'invalid-json', message: 'Current 路由没有返回 JSON' } }
}

export interface CurrentPanelProps {
  sessionId?: string
  fetchCurrent?: (sessionId?: string) => Promise<any>
}

export const CurrentPanel: React.FC<CurrentPanelProps> = (props) => {
  const [state, setState] = React.useState<{ kind: 'reading' } | { kind: 'ok'; text: string } | { kind: 'fail'; message: string }>({ kind: 'reading' })
  React.useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await (props.fetchCurrent ?? fetchCurrent)(props.sessionId)
        if (!alive) return
        if (res?.ok === true && typeof res.text === 'string') setState({ kind: 'ok', text: res.text })
        else setState({ kind: 'fail', message: String(res?.message ?? 'Current 读不到（没有可读原因）') })
      } catch (e) {
        if (alive) setState({ kind: 'fail', message: String((e as Error)?.message ?? e) })
      }
    })()
    return () => { alive = false }
  }, [props.fetchCurrent, props.sessionId])
  const lines = state.kind === 'ok' ? currentMarkdownLines(state.text) : []
  const sections = currentSections(lines)
  const firstHeadingIndex = sections.findIndex((section) => section.heading !== '')
  return React.createElement('section', { 'data-dsh-hob': 'stages-current', style: { marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--dsw-alias-border-l4, transparent)', display: 'flex', flexDirection: 'column', gap: 4 } },
    React.createElement('h3', { style: { margin: '0 0 6px', fontSize: '1em' } }, '当前'),
    state.kind === 'reading'
      ? React.createElement('div', { style: { opacity: 0.75 } }, '读取中…')
      : state.kind === 'fail'
        ? React.createElement('div', { style: { color: 'var(--dsw-alias-status-error, #d11)' } }, `判不出：${state.message}`)
        : React.createElement(
            'div',
            { 'data-dsh-hob': 'stages-current-text', style: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 } },
            ...sections.map((section, si) => {
              const body = section.lines.map((line, i) => React.createElement(
                line.kind === 'subheading' ? 'h5' : line.kind === 'subsection' ? 'h6' : 'div',
                {
                  key: `line-${si}-${i}`,
                  'data-current-kind': line.kind,
                  style: line.kind === 'subheading'
                    ? { margin: '6px 0 1px', fontSize: '0.92em', fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' }
                    : line.kind === 'subsection'
                      ? { margin: '4px 0 1px', fontSize: '0.88em', fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' }
                      : line.kind === 'quote'
                        ? { paddingLeft: 8, borderLeft: '2px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35))', color: 'var(--dsw-alias-label-secondary)', fontSize: '0.9em', overflowWrap: 'anywhere' }
                        : { paddingLeft: 10, textIndent: '-10px', overflowWrap: 'anywhere', lineHeight: 1.45 },
                },
                line.kind === 'item' ? '· ' : '',
                plainCurrentText(line.text),
              ))
              /**
               * Current 开头的说明不是章节；不要把它包成 `<details>` 的 summary，
               * 否则截图里会出现“当前 / 说明 / 一、现在在等谁”三层重复标题。
               */
              return section.heading === ''
                ? React.createElement(
                  'div',
                  { key: `section-${si}`, 'data-current-section': 'preamble', style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                  ...body,
                )
                : React.createElement(
                  'details',
                  {
                    key: `section-${si}`,
                    open: si === firstHeadingIndex ? true : undefined,
                    'data-current-section': section.heading,
                    style: { display: 'flex', flexDirection: 'column', gap: 2 },
                  },
                  React.createElement('summary', { style: { cursor: 'pointer', fontWeight: 600, fontSize: '0.95em', overflowWrap: 'anywhere' } }, plainCurrentText(section.heading)),
                  ...body,
                )
            }),
          ),
  )
}
