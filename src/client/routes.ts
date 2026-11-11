/**
 * **客户端路由路径的唯一来源**（R-26）。
 *
 * ⚠ 为什么要单独一个文件：改前同一条路由在**多个文件里各写一份字面量**，
 *   典型是 `/api/dsh-hob/session-policy` —— 写了 **3 份**
 *   （`create-hob-dialog.tsx` 的常量 + `hob-unselected-gate.tsx` 的两处内联）。
 *   ⇒ 服务端改一次路径，客户端**三处都要改**，漏一处就是「这个路径没有处理体」。
 *
 * ⚠ 这里**只放路径字符串**，⛔ 不放取数函数：
 *   取数要带 `credentials` / 错误分支 / `StaleRouteError`，各面板的语义不同，
 *   强行合并会把三种失败翻译成同一种（本仓反复记过的病）。
 */

export const SESSION_CREATE_PATH = '/api/dsh-hob/session-create'
/** 会话策略读写（`action: read | write | blocked`）。⚠ 改前这条写了 3 份。 */
export const SESSION_POLICY_PATH = '/api/dsh-hob/session-policy'
export const STAGES_PATH = '/api/dsh-hob/stages'
export const TASKS_PROGRESS_PATH = '/api/dsh-hob/tasks-progress'
export const REQUIREMENT_CHAINS_PATH = '/api/dsh-hob/requirement-chains'
export const LEDGERS_PATH = '/api/dsh-hob/ledgers'
export const LEDGER_RESOURCE_PATH = '/api/dsh-hob/ledger-resource'
export const WORK_PLANS_PATH = '/api/dsh-hob/work-plans'
