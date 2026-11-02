/**
 * 可读权限档位的**纯值来源**。
 *
 * ⚠ 本文件刻意**零依赖**：host 侧的 `config.ts` 需要它构造 schemastery，
 *   client / 共享策略侧也需要同一套枚举。若共享模块直接 import `config.ts`，
 *   浏览器包会把整个服务端 schema 和 schemastery 一起打进去。
 *
 * ⚠ 枚举顺序是语义的一部分：首项 = 最低档 / fail-closed 兜底。
 */
export const PERMISSION_LEVELS = ['ledger', 'project', 'workspace'] as const

export type PermissionLevel = (typeof PERMISSION_LEVELS)[number]

/** 缺省档位 = `ledger`（与 schema 的 `.default('ledger')` 一致）。 */
export const DEFAULT_PERMISSION_LEVEL: PermissionLevel = 'ledger'
