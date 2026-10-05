/**
 * M2 · 预设声明模块 —— **骨架占位**。
 *
 * 预设（Agent preset）本身住在 `preset/<预设 id>/`（独立包，由 profile 的
 * bundles 装配），**不**由本模块在运行时注册。本模块是留给「需要以编程方式
 * 注册/查询预设」那类需求的挂点 —— 骨架期为空实现。
 *
 * ⚠ 为什么预设不在这里：宿主 preset 行的 `name` 只能解析到**已安装的包**及其包内模块。
 *   把预设声明写在运行时模块里，装配顺序上拿不到（且 profile patch 够不到
 *   preset 内部条目 —— 见 .hob/EXPERIENCE.md E-05）。
 */
export const name = 'dsh-hob-preset'

export function apply(ctx: any): void {
  ctx.logger?.debug?.(`[${name}] 已激活（骨架期无行为）`)
}
