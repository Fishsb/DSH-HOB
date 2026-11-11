/**
 * **面板自带的两个纯展示原子**（2026-11-08）。
 *
 * ── 为什么不再 require `@deepseek-ai/dsh-client-ui-primitives` ─────────────
 *   真机实测：宿主浏览器模块表**没有**这个包（它不是 `__DSH_BOOT__` 的静态 seed）。
 *   旧构建把它 external ⇒ 产物里留 `require('@deepseek-ai/dsh-client-ui-primitives')`
 *   ⇒ dsh-hob 的 factory 在 materialize 时抛「missed the module table」
 *   ⇒ `exports` 为空、`apply` 不存在 ⇒ 客户端半边不激活、侧栏入口消失。
 *
 *   整包内联也不合适：它的入口同时拉入 Markdown / shiki / katex 等，
 *   会留下更多宿主不提供的裸 require。面板只用到两个纯展示原子，
 *   因此在本地实现等价组件，⛔ 不新增任何运行时依赖。
 *
 * ⚠ 只做展示：无状态、无副作用、零 I/O；`aria-hidden` 的圆点配文字使用。
 */
import * as React from 'react'

/** 状态点：`done / warning / ongoing / error / idle`。⚠ 只读展示，不承载状态源。 */
export function StateDot(props: {
  state?: 'done' | 'warning' | 'ongoing' | 'error' | 'idle'
  size?: number
}): React.ReactElement {
  const state = props.state ?? 'idle'
  const edge = props.size ?? (state === 'ongoing' ? 14 : 10)
  const color = state === 'done'
    ? 'var(--dsw-alias-state-success-primary, #16a34a)'
    : state === 'warning'
      ? 'var(--dsw-alias-state-warn-primary, #d97706)'
      : state === 'error'
        ? 'var(--dsw-alias-state-error-primary, #dc2626)'
        : 'var(--dsw-alias-state-idle-primary, #94a3b8)'
  return React.createElement('span', {
    /** ⚠ 与宿主 primitives 的标记一致：机检按 `[data-primitive="StateDot"]` 认圆点。 */
    'data-primitive': 'StateDot',
    'data-state': state,
    'aria-hidden': 'true',
    style: {
      display: 'inline-block',
      flex: 'none',
      width: edge,
      height: edge,
      borderRadius: '50%',
      background: state === 'ongoing' ? 'transparent' : color,
      border: state === 'ongoing' ? `2px solid ${color}` : undefined,
      boxSizing: 'border-box',
    },
  })
}

/** 只读标签：胶囊外观；`tone` 只换配色，不改内容。 */
export function Tag(props: {
  tone?: 'outline' | 'solid' | 'neutral' | 'quiet'
  children?: React.ReactNode
}): React.ReactElement {
  const tone = props.tone ?? 'outline'
  const palette = tone === 'solid'
    ? { background: 'var(--dsw-alias-label-primary, #111827)', color: 'var(--dsw-alias-bg-layer-3, #fff)', border: 'none' }
    : tone === 'neutral'
      ? { background: 'var(--dsw-alias-bg-module-platform, rgba(127,127,127,.12))', color: 'var(--dsw-alias-label-secondary, inherit)', border: 'none' }
      : tone === 'quiet'
        ? { background: 'transparent', color: 'var(--dsw-alias-label-tertiary, inherit)', border: 'none' }
        : { background: 'transparent', color: 'var(--dsw-alias-label-tertiary, inherit)', border: '0.5px solid var(--dsw-alias-border-l4, rgba(127,127,127,.35))' }
  return React.createElement('span', {
    'data-primitive': 'Tag',
    'data-tone': tone,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      borderRadius: 999,
      padding: '1px 8px',
      fontSize: 11,
      lineHeight: '17px',
      fontWeight: 500,
      whiteSpace: 'nowrap',
      ...palette,
    },
  }, props.children)
}
