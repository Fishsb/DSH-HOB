/**
 * 面板行的**纯类型**：`StageItem` / `StageRow` / `CapRow`。
 *
 * ── 为什么单独成文件（2026-11-11 · 架构健康化）──────────────────────────
 *   `panel-summary.ts` 需要 `StageRow`，而 `stages-index.ts` 需要 `panelSummaryOf` ⇒
 *   **两个文件互相 import**，形成 `stages-index ↔ panel-summary` 的环。
 *   该环的真相是：**只有类型在往回走**（`panel-summary` 用的是 `import type`）。
 *
 *   ⚠ 不能靠"类型环不算环"来豁免 —— 那需要判据维护一条白名单，
 *     而白名单本身就是漂移源（本项目反复吃过的亏）。
 *   ⇒ 把**共享的类型**提到这里：两边都从本文件 import，环从图上**真正消失**。
 *
 * ⚠ 本文件**只有类型**，编译后不产生任何运行时代码。⛔ 不要在这里加函数。
 */
import type { ItemListPresentation } from './item-presentation.ts'

/** 一步里的一条条目。 */
export interface StageItem {
  id: string
  /** 旧客户端兼容字段：默认线格式原样返回；紧凑模式省略。 */
  title?: string
  /** 旧客户端兼容字段：默认线格式原样返回；紧凑模式省略。 */
  extra?: string
  status: string
  kind: string
  /**
   * 紧凑列表投影：自包含主标题、正式关系 ID、最多一条短读数、诊断代码。
   * ⚠ 不含原句、详情或重复的父标题；完整字段由 `/ledger-resource` 按 ID 读取。
   */
  presentation: ItemListPresentation
}

/** 一步。 */
export interface StageRow {
  step: number
  name: string
  state: 'done' | 'doing' | 'todo'
  done: number
  total: number
  items: StageItem[]
}

/** 长期能力（⚠ 无终态、不进分母、无百分比）。 */
export interface CapRow {
  id: string
  title: string
  status: string
  lastReading: string
}