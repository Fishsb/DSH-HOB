/**
 * **新建 Hob 会话的双轴弹窗**（2026-10-22 · `REQ-04` UI 源码阶段）。
 *
 * ══ 它挂在哪儿、为什么 ═══════════════════════════════════════════════════
 *   宿主在会话空态渲染一个**单槽** `conversation.hero.agentPreset`
 *   （证据：`dsh-client-ui-conversation/lib/client.js:19762-19765`
 *    `{ kind: "single", scope: "session-maybe" }`，渲染点 `:17812`）。
 *   本插件**不抢**这一槽（那是宿主与别的预设插件的位子），而是：
 *     ① 用 `ctx.slots.inject` **等槽位声明之后再注册**（宿主先声明，我们后注册）；
 *     ② 注册时带**很低的 `order`**（= 排最后），**不覆盖**原有选择器；
 *     ③ 用**自有 overlay id** 承载弹窗（`shell.overlay`，`kind: "list"`、`scope: "root"`，
 *        证据：`dsh-client-ui-layout/lib/client.js:643-646`）。
 *   ⚠ 这是**候选方案**：真机行为（槽单槽冲突规则、inject 时序）**未验**（实例未重启）。
 *
 * ══ 关键安全点（⛔ 缺一条就不该有这个 UI）══════════════════════════════════
 *   · **只有选 Hob 才出现**：本弹窗的触发判据是"用户在本插件的入口里点了'新建 Hob 会话'"
 *     或"当前 hero 预设已是 Hob"；**普通预设一律不弹**（⛔ 不抢别人的创建流程）。
 *   · **取消 ⇒ 不创建任何东西**（⛔ 不留空白孤儿）。
 *   · **重复点确认 ⇒ 不重复创建**：`submitting` 闸门 + 票据一次性
 *     （服务端 `ticket` 消费即删）。
 *   · **两个控件**：可读范围 + 推进三档，**枚举从服务同源取**（`action: 'enums'`），
 *     ⛔ UI 侧不抄一份清单。
 *   · ⚠⚠ **可读范围当前只显示一档**（2026-10-22 · 用户裁定「安全优先」）：
 *     服务只下发开放面（最低档），界面**照旧"服务给几个就画几个"**、旁边写明原因。
 *     ⛔ **隐藏不是校验**：宽档由服务端 `issue()`/`createHobSession()`/`hob_spawn` 拒
 *     （见 `src/shared/read-level-policy.ts`）。
 *   · **「完全权限」旁边必须完整说明**："工作区里任何文件都可读，仍<能力红线>"——
 *     那句能力红线**不在本文件写死**（见 `src/shared/capability-red-line.ts` 的单源常量）。
 *     ⚠ 该档当前**不在开放面**（界面上不出现）；词典里的这一条与边界句**保留** ——
 *     重新开放时它必须一字不改地回到界面（判据族也一并覆盖）。
 *
 * ══ 边界（如实说）════════════════════════════════════════════════════════
 *   弹窗**只覆盖从本 UI 新建 Hob** 这一条路。宿主直接建（`session/create` / CLI）**拦不住** ——
 *   那种会话没有记录 ⇒ 按最低档读（见 `session-policy.ts` 的无记录分支）。
 *   ⛔ 不说"所有 API 都有弹窗"。
 */
import * as React from 'react'
import { SESSION_CREATE_PATH, SESSION_POLICY_PATH } from './routes.ts'
// ⚠ 预设 id 唯一来源（⛔ 不在这里写那个字面值 —— `check:presets` ⑦ 组钉着全仓只有一处）
import { HOB_PRESET_ID } from '../shared/planning-preset.ts'
// ⚠ 红线句的**单一来源**（2026-10-24 · 修复单第 9 条）：⛔ 不在这里再抄一份中文。
import { CAPABILITY_RED_LINE_EN, CAPABILITY_RED_LINE_ZH } from '../shared/capability-red-line.ts'
// ⚠ 取词**只有一个入口**（`t()`，与设置面板同一条管线）：本文件只把自己这一屏的
//   中英词条当作**入参**灌进去（`addDictionaryLayer`），⛔ 不自建第二套查表。
import { addDictionaryLayer, getLocaleSnapshot, subscribeLocale, t } from './i18n.ts'

const h = React.createElement

/** 本插件自有 overlay 槽 id（⛔ 不复用宿主/他插件的 id）。 */
export const HOB_CREATE_OVERLAY_ID = 'dsh-hob.create-hob-dialog'

/**
 * ⚠ **命令入口的 id**（`shell.overlay` 槽里的一个 list 条目）。
 *   ⚠ 2026-10-22 起**不再有 "hero" 入口** —— 我们**不注册** `conversation.hero.agentPreset`
 *   （那槽是 `single`，第二条目会 shadow 宿主预设选择器；见文件头"改道"一节）。
 */
export const HOB_CREATE_ENTRY_ID = 'dsh-hob.create-hob-command'

/**
 * `shell.overlay` 里的**排序**（list 槽）。
 *   ⚠ 它**只影响 list 内部先后**，⛔ 与 single 槽的"胜出规则"无关 ——
 *   上一版把它写成 `HOB_HERO_ORDER=900` 并声称"低优先级不抢位"是**误读**。
 *   ⚠ 取 900：排在宿主自己的 overlay（通常 < 100）**之后**，不抢先但不致消失。
 */
export const HOB_OVERLAY_ORDER = 900

/**
 * ⚠ **成功结果条的 overlay id**（第三个自有 id · 2026-10-22 新增）。
 *   ⚠ 必须与入口/弹窗**分成三条**：它们是三个独立注册点、独立生命周期
 *   （入口常驻、弹窗按开关渲染、结果条按 `created()` 渲染）。
 *   ⛔ 合成一条会让"弹窗关闭"把"结果条"一起带走 —— 那正是上一版的缺口。
 */
export const HOB_CREATED_NOTICE_ID = 'dsh-hob.create-hob-created-notice'

/**
 * 显示名（⚠ 经 `t()` 取词；⛔ 不显示内部值）。枚举**值**只用于发给服务。
 *
 * ── 2026-10-24 · 修复单第 6 条 ─────────────────────────────────────────
 *   上一版这里写死**中文字面量**，整个文件不 import 语言服务 ⇒ 切英文后这一屏
 *   仍是中文（"语言跟随"在这一屏是**空的**）。现在只留**键**，文案进词典
 *   （`HOB_DIALOG_ZH` / `HOB_DIALOG_EN`），渲染期经 `t()` 现读 ⇒ 切语言当场变。
 *   ⚠ 键按 `level` / `mode` 的**内部值**拼（`level.label.ledger` 一类）：
 *     值本身是稳定标识，⛔ 不进用户可见文本（那由文案卫生判据钉住）。
 */
const LEVEL_KEYS: ReadonlyArray<{ value: string; labelKey: string; hintKey: string }> = [
  { value: 'ledger', labelKey: 'level.label.ledger', hintKey: 'level.hint.ledger' },
  { value: 'project', labelKey: 'level.label.project', hintKey: 'level.hint.project' },
  // ⚠ 任务书逐字要求：邻近「完全权限」必须**完整说明**（那句在词典里，且由
  //   `CAPABILITY_RED_LINE_ZH` 拼进来 —— 单一来源，⛔ 不是又抄一份）。
  { value: 'workspace', labelKey: 'level.label.workspace', hintKey: 'level.hint.workspace' },
]

/**
 * 服务没带原因说明时的**兜底文案**（⚠ 与服务端 `CLOSED_READ_LEVEL_NOTE` 同口径）。
 *
 * ── 为什么 UI 也要有一份（⛔ 不是重复权威）────────────────────────────────
 *   **选项值**必须来自服务（⛔ UI 不新增值）；但这句**说明**是"为什么只有一项"的
 *   用户可见解释 —— 服务缺席/旧服务不带该字段时，界面**不能一声不响地只剩一项**
 *   （那看起来像坏了）。⇒ 兜底只用于**文案**，⛔ 绝不用于"自己决定显示哪几档"。
 * ⚠ 措辞纪律：**无 markdown 标记、不出现内部配置值**（`ledger` 这类标识不进文案）。
 * ⚠ 2026-10-24（第 6 条）：文案进词典（`levels.note.fallback`），中英各一份。
 */
const DEFAULT_LEVELS_NOTE_KEY = 'levels.note.fallback'

/**
 * 推进方式三档：**只留键**，档名与说明进词典。
 *
 * ⚠ 档名 = `WORK_MODE_DISPLAY`（`src/shared/work-mode.ts`）：`UD-149` §三「档名不改，
 *   仍是 自动 / 单会话 / 多会话」。⛔ 不许在这里造第三套词（2026-10-23 修 D3：
 *   面板写「单会话/多会话」、本弹窗曾写「单路/多路」，同一组三档两个屏两套名字）。
 *   ⇒ 词典里的 `mode.label.*` 必须与 `WORK_MODE_DISPLAY` **逐字相同**（机检钉住）。
 */
const MODE_KEYS: ReadonlyArray<{ value: string; labelKey: string; hintKey: string }> = [
  { value: 'auto', labelKey: 'mode.label.auto', hintKey: 'mode.hint.auto' },
  { value: 'single', labelKey: 'mode.label.single', hintKey: 'mode.hint.single' },
  { value: 'multi', labelKey: 'mode.label.multi', hintKey: 'mode.hint.multi' },
]

/**
 * ── ⚠ 能力红线（2026-10-23 · 修 D4；2026-10-24 第 9 条收成单一来源）────────
 *   `R-26` / `UD-149`：档名自带「更多/更强」暗示 ⇒ **紧邻必须有边界句**。
 *   此前唯一写这句的 `WorkModeCard`（`settings-panel.tsx` 里那张**零渲染点的死卡**，
 *   2026-10-24 · 第 8 条已删除）⇒ 用户做选择的那一屏反而没有红线。
 *   ⇒ 红线**必须出现在弹窗**（⛔ 不是去救活那张卡）。
 *
 * ⚠ 2026-10-24：那句能力红线原先是**九处字面副本**之一，现已从
 *   `src/shared/capability-red-line.ts` 的 `CAPABILITY_RED_LINE_ZH` / `_EN` 取（第 9 条）。
 *   本文件只在词典里**引用常量拼句**（见 `HOB_DIALOG_ZH/EN` 的 `redline.workMode`），
 *   ⛔ 不再出现原句字面量 ⇒ 全仓只有 `capability-red-line.ts` 一处持有那句话。
 *   ⚠ 这里**没有**独立的"前缀常量"：整句就是词典里那一条（渲染点读 `d('redline.workMode')`）。
 */

/**
 * 一句区分"宿主沙箱审批预设"与"本次可读范围"（任务书第 1 条要求）。
 *
 * ⚠ 为什么必须写：用户很容易把"权限"混成一件事。宿主的沙箱/审批是**执行面**
 *   （能不能跑命令、要不要批准），本弹窗选的是**可读面**（能读哪些文件）。
 *   两者**互不替代**。
 * ⚠ 2026-10-24（第 6 条）：文案进词典（`note.distinction`），中英各一。
 */

// ══════════════════════════════════════════════════════════════════════════
// 本屏的**词条数据**（中 / 英，键集必须完全一致）
// ══════════════════════════════════════════════════════════════════════════
/**
 * ⚠ 这份表**不是**一套查表实现，只是灌进 `i18n.ts` 的**入参**
 *   （`addDictionaryLayer('hob-dialog', …)`）—— 取词入口始终只有 `t()` 一个
 *   （2026-10-24 · 修复单第 6 条：⛔ 不许在弹窗里自建第二个 t()）。
 *
 * ⚠ 两份键集必须完全一致（键集不一致 = 某语言下静默显示键名）。
 * ⚠ 值里**不得含 markdown 标记**（词典值按纯文本渲染，`**` 会字面显形）。
 * ⚠ 那句能力红线**只在这里出现一次**：用 `CAPABILITY_RED_LINE_ZH/EN` 拼进去
 *   （第 9 条 —— 全仓唯一来源在 `src/shared/capability-red-line.ts`）。
 */
const HOB_DIALOG_ZH: Record<string, string> = {
  'shell.title.create': '新建 Hob 会话',
  'shell.title.existing': '为本会话选择可读范围',
  'shell.lead.create': '这两项只作用于这一个新建会话，不会影响已开的别的 Hob 会话。',
  'shell.lead.existing': '这两项只作用于当前这个会话，不会影响已开的别的 Hob 会话，也不会新建会话。',
  'legend.workspace': '工作区',
  'legend.level': '可读范围',
  'legend.mode': '推进方式',
  'note.workspace': '请选择这个新会话所属的工作区。本插件不使用"注册表第一项"作为你的当前工作区。',
  'aria.workspace': '选择工作区',
  'opt.workspace.placeholder': '— 请选择 —',
  'err.workspaceList.unavailable': '无法取得工作区清单（{reason}）⇒ 不能创建',
  'err.workspaceList.empty': '工作区清单为空 ⇒ 不能创建（请先在宿主里建一个工作区）',
  'levels.note.fallback': '当前只开放「账本权限」：其余档位待宿主具备可靠的持久清理能力后开放。',
  'badge.notOpen': '暂未开放',
  'note.distinction': '⚠ 这里的「可读档」只决定 Hob 能读哪些文件，与宿主的沙箱 / 审批预设（能不能执行、要不要批准）是两件事，互不替代。',
  // ⚠ 这段是**原先死卡 `WorkModeCard` 的 `wm.redline` 的等价物**（第 8 条删卡后
  //   不能把红线一起丢掉）。四条具体边界逐条保留：看板 / 别人项目的卡 / 判据 / 权限。
  'redline.workMode': '⚠ 推进方式只改「活怎么拆成几路」，不改任何能力：哪一档都' + CAPABILITY_RED_LINE_ZH
    + '。多会话不等于权限更大、也不解除任何既有规则：看板照样不许改、别人项目的卡照样不许碰、'
    + '判据一条都不放宽。自动档同理：不再先问就派出去不是权限 —— 不解除任何规则、不越过权限档位。',
  'level.label.ledger': '账本权限',
  'level.label.project': '文档权限',
  'level.label.workspace': '完全权限',
  'level.hint.ledger': '只读自己的账本与网络。不读工作区文件。',
  'level.hint.project': '另可读工作区里的 .md 文档；不可读代码。',
  'level.hint.workspace': '工作区里任何文件都可读，仍' + CAPABILITY_RED_LINE_ZH + '。',
  'mode.label.auto': '自动',
  'mode.label.single': '单会话',
  'mode.label.multi': '多会话',
  'mode.hint.auto': 'Hob 在已批准范围内自行判断最少必要轨数；可以只开一轨，但要说明原因；读轨可并行，写轨串行；派完报告路数、去向和下一门槛。',
  'mode.hint.single': '固定一条执行轨；第二条活动轨会被运行时拒绝；大任务在同一轨内分阶段推进。',
  'mode.hint.multi': '显式扇出；列出两个以上独立工作单元时必须拆轨；每轨独立范围和验收；读轨可并行，写轨仍串行；只开一轨必须给出候选证据和合并原因。',
  'blocked.enumsUnavailable': '服务枚举不可用：{reason}',
  'blocked.enumsLoading': '正在获取可选项…',
  'blocked.workspace': '请选择工作区',
  'note.enumsMissing': '⚠ 枚举尚未从服务取到；提交时以服务端校验为准。',
  'phase.done.create': '已创建会话并写入两项选择（{id}）。',
  'phase.done.existing': '已为这个会话写入两项选择（{id}）。',
  'btn.retry': '重试',
  'btn.cancel': '取消',
  'btn.create': '创建',
  'btn.confirm': '确认',
  'btn.creating': '创建中…',
  'btn.writing': '写入中…',
  'err.enumsMissing': '服务枚举尚未取到 ⇒ 不能提交（请稍候或检查服务）',
  'err.workspaceMissing': '请先选择一个工作区（本插件不使用"注册表第一项"作为你的当前工作区）',
  'err.selectionMissing': '两项选择尚未就绪 ⇒ 不能提交',
  'cancel.submitting': '已停止等待服务端回应。⚠ 这个会话可能已经建好了——请先到会话列表确认，确认没有再来一次；⛔ 不要反复提交（会产生重复会话）。',
  'err.writeFailed': '写入失败：{reason}（⚠ 本会话仍是未选状态）',
  'err.writeThrew': '请求失败：{message}（⚠ 本会话仍是未选状态）',
  'err.ticket': '无法签发票据',
  'err.createFailed': '建会话失败',
  'err.createUnsafe': '（⚠ 可能有残留会话按高档执行且无法确认已隔离；会话 {id}。请勿让该会话继续推进，并在设置里检查/删除它。）',
  'err.createStranded': '（⚠ 留下会话 {id}，其策略已持久隔离：读档恒最低、且不推进）',
  'err.requestFailed': '请求失败：{message}',
  'err.timeout': '请求超过 {seconds} 秒没有回应 ⇒ 已中止。⚠ 服务端可能已经建好了这个会话，请先到会话列表确认，再决定是否重试。',
  'err.notJson': '响应不是 JSON（HTTP {status}）',
  'entry.label': '新建 Hob 会话',
  'entry.aria': '新建 Hob 会话：选择可读范围与推进方式',
  'created.prefix': '已创建 Hob 会话：',
  'created.aria': '已创建 Hob 会话 {id}',
  'created.noNav': '（⚠ 该会话在收到第一条消息之前被宿主从会话列表过滤，现在看不到；请从宿主的会话创建面板继续，或先给它发一条消息）',
  'created.open': '打开该会话',
}

const HOB_DIALOG_EN: Record<string, string> = {
  'shell.title.create': 'New Hob session',
  'shell.title.existing': 'Choose the readable range for this session',
  'shell.lead.create': 'These two choices apply to this new session only; other Hob sessions are unaffected.',
  'shell.lead.existing': 'These two choices apply to this session only; other Hob sessions are unaffected, and no session is created.',
  'legend.workspace': 'Workspace',
  'legend.level': 'Readable range',
  'legend.mode': 'How work gets split',
  'note.workspace': 'Choose the workspace this new session belongs to. This plugin does not use the first registry entry as your current workspace.',
  'aria.workspace': 'Choose a workspace',
  'opt.workspace.placeholder': '— Choose —',
  'err.workspaceList.unavailable': 'Could not read the workspace list ({reason}) — cannot create',
  'err.workspaceList.empty': 'The workspace list is empty — cannot create (create a workspace in the host first)',
  'levels.note.fallback': 'Only the ledger level is open for now: the other levels wait until the host can clean up reliably and persistently.',
  'badge.notOpen': 'Not open yet',
  'note.distinction': '⚠ The readable range here only decides which files Hob can read; it is a different matter from the host sandbox and approval preset (whether it may run, whether approval is needed). Neither replaces the other.',
  // ⚠ Same content as the Chinese one: the four specific boundaries of the deleted
  //   `WorkModeCard` are carried over, not dropped with the dead code.
  'redline.workMode': '⚠ How work gets split only changes the number of tracks; it changes no capability: '
    + 'under every mode ' + CAPABILITY_RED_LINE_EN + '. Many sessions means no more power and relaxes no rule: '
    + 'the board is still off-limits, another project\'s cards are still off-limits, and no acceptance '
    + 'criterion is relaxed. Automatic works the same way: handing over without asking first is not '
    + 'permission — it relaxes no rule and crosses no permission level.',
  'level.label.ledger': 'Ledger permission',
  'level.label.project': 'Document permission',
  'level.label.workspace': 'Full permission',
  'level.hint.ledger': 'Reads only its own ledger and the web. It does not read workspace files.',
  'level.hint.project': 'Also reads .md documents in the workspace; it does not read code.',
  'level.hint.workspace': 'Every file in the workspace can be read; ' + CAPABILITY_RED_LINE_EN + '.',
  'mode.label.auto': 'Automatic',
  'mode.label.single': 'One session',
  'mode.label.multi': 'Many sessions',
  'mode.hint.auto': 'Hob decides the minimum necessary track count within the approved scope; one track is allowed but needs a reason; reads may run in parallel, writes stay serial; report track count, owners and the next gate after dispatch.',
  'mode.hint.single': 'One execution track, enforced by the runtime: a second active track is refused; large work is sequenced inside that track.',
  'mode.hint.multi': 'Explicit fan-out: two or more genuinely independent pieces must become separate tracks with independent scope and acceptance; reads may run in parallel, writes stay serial; a single track needs candidate evidence and a merge reason.',
  'blocked.enumsUnavailable': 'Service options unavailable: {reason}',
  'blocked.enumsLoading': 'Reading the available options…',
  'blocked.workspace': 'Choose a workspace',
  'note.enumsMissing': '⚠ The options have not arrived from the service yet; the server-side check decides when you submit.',
  'phase.done.create': 'Session created and both choices written ({id}).',
  'phase.done.existing': 'Both choices written for this session ({id}).',
  'btn.retry': 'Retry',
  'btn.cancel': 'Cancel',
  'btn.create': 'Create',
  'btn.confirm': 'Confirm',
  'btn.creating': 'Creating…',
  'btn.writing': 'Writing…',
  'err.enumsMissing': 'The service options have not arrived yet — cannot submit (wait a moment or check the service)',
  'err.workspaceMissing': 'Choose a workspace first (this plugin does not treat the first registry entry as your current workspace)',
  'err.selectionMissing': 'Both choices are not ready yet — cannot submit',
  'cancel.submitting': 'Stopped waiting for the server. ⚠ This session may already have been created — check the session list first, and only try again if it is not there; do not submit repeatedly (that creates duplicate sessions).',
  'err.writeFailed': 'Write failed: {reason} (⚠ this session is still unselected)',
  'err.writeThrew': 'Request failed: {message} (⚠ this session is still unselected)',
  'err.ticket': 'Could not issue the ticket',
  'err.createFailed': 'Creating the session failed',
  'err.createUnsafe': '(⚠ a leftover session may be running at a high level and cannot be confirmed isolated; session {id}. Do not let it continue, and check or delete it in the settings.)',
  'err.createStranded': '(⚠ session {id} was left behind; its policy is persistently isolated: the readable level stays the lowest and it does not advance)',
  'err.requestFailed': 'Request failed: {message}',
  'err.timeout': 'No response after {seconds} seconds — aborted. ⚠ The server may already have created this session; check the session list before deciding whether to retry.',
  'err.notJson': 'The response was not JSON (HTTP {status})',
  'entry.label': 'New Hob session',
  'entry.aria': 'New Hob session: choose the readable range and how work gets split',
  'created.prefix': 'Hob session created: ',
  'created.aria': 'Hob session created {id}',
  'created.noNav': '(⚠ the host filters this session out of the session list until it receives its first message, so it is not visible now; continue from the host session panel, or send it a message first)',
  'created.open': 'Open that session',
}

/**
 * 把本屏词条**灌进 i18n 的唯一词典管线**（模块加载时一次）。
 *
 * ⚠ 为什么在模块顶层而不是 `apply()` 里：`i18n.ts` 的 inject 回调可能在任何时刻触发，
 *   而它读的是**已经合并好的**词典 ⇒ 晚登记会让语言服务那条路径看不到本屏词条
 *   （症状：面板跟随语言、弹窗永远中文）。
 */
addDictionaryLayer('hob-dialog', { zh: HOB_DIALOG_ZH, en: HOB_DIALOG_EN })

/** 取本屏文案（⚠ 唯一入口是 i18n 的 `t()`；本别名只为让 diff 更紧凑，⛔ 不是第二实现）。 */
const d = (key: string, params?: Record<string, string | number>): string => t(key, params)

/**
 * 订阅语言变化**只为触发重渲染**（⚠ 用的是 i18n 已有的 `subscribeLocale`，
 * ⛔ 不是第二套订阅/第二个 locale 信号 —— 2026-10-24 · 第 6 条）。
 *
 * ── 为什么弹窗必须自己订阅 ────────────────────────────────────────────
 *   `t()` 在**渲染期现读**语言，前提是"语言变了 ⇒ 本组件重渲染"。
 *   设置面板早就订阅了（`SettingsPanel` 里那次 `useSyncExternalStore`），
 *   但弹窗/结果条/入口**不在**那个组件的子树里（它们挂在 `shell.overlay`）
 *   ⇒ 不自己订阅的话，切语言后面板变了、弹窗仍是旧语言。
 *   ⚠ 快照本身不参与渲染（语言通过 `t()` 现读），它只用来当"变化信号"。
 */
function useLocaleSignal(): void {
  React.useSyncExternalStore(subscribeLocale, getLocaleSnapshot, getLocaleSnapshot)
}

/** 弹窗状态（⚠ 单一状态机，⛔ 不用散落的布尔）。 */
type Phase =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; sessionId: string }

/** 组件属性（⚠ 全部注入，便于机检用假实现跑真逻辑）。 */
export interface HobCreateDialogProps {
  /** 当前 hero 槽的预设（⚠ 只有规划侧预设才显示本入口/弹窗）。 */
  currentPreset?: string
  /**
   * ⚠⚠ **目标会话**（2026-10-22 第 4 轮 · 任务书 §一 E 项）：
   *   · **缺席** ⇒ **新建模式**（现状，完全不动）：走 `issue` → `create`，取消 = 零会话；
   *   · **给了** ⇒ **已有会话模式**：⚠ **不调 `issue`、不调 `create`**（那会**再建一个会话**），
   *     改为调一条**写入**动作把两项落到**这个已存在的会话**上。
   *   ⚠ 为什么必须分开：宿主原生新建的 Hob 会话**已经存在**，
   *     "为它选档位"与"新建一个会话"是**两件不同的事**；
   *     混用会让用户在确认后**多出一个重复会话**（上一轮点出的风险，本单机检钉住）。
   */
  targetSessionId?: string
  /** 调服务的通道（⚠ 默认走同源 HTTP；机检可注入假实现）。 */
  call?: (body: unknown) => Promise<any>
  /** 生成预分配 sessionId（⚠ 注入以便测试确定化）。 */
  mintSessionId?: () => string
  /** 关闭弹窗（取消 / 完成）。 */
  onClose?: () => void
  /** 成功后的回调（⚠ 宿主侧用它切到新会话）。 */
  onCreated?: (sessionId: string) => void
}

/**
 * 本插件自定义路由（⚠ 两条，**各管各的动作**；⛔ 不要合并成一个入口）。
 *
 * ── 为什么是两条（2026-10-23 · P0-3 修复的落点）───────────────────────────
 *   改前：本函数只会 POST `/api/dsh-hob/session-create`，而**已有会话模式**发的
 *   `{action:'set-policy'}` 并不在那条路由的 `action` 分支里（它只认 `issue` /
 *   `create` / `enums`）⇒ 服务端落到 `json(400, 未知 action)` ⇒ **已有会话选档必 400**，
 *   而当时的判据用的是**假 call**（写死 `if (body?.action === 'set-policy') return writeResult`），
 *   于是这条死路在机检里是**绿的**。
 *
 * ── 选的是「A · 客户端按动作选路由」（⛔ 不是 B · 服务端补别名）──────────
 *   ① 写入语义**已经存在**：`/api/dsh-hob/session-policy` 的 `action:'write'`
 *      （`src/modules/session-policy-route.ts`，`handlePolicyWrite`）就是"给已存在的会话
 *      写两项"的正牌实现，且它自己**回读确认**后才回成功。
 *   ② 补别名意味着在 `session-create-channel.ts` 里再造一条写入路径 —— 那个文件在本仓
 *      被明确裁定由另一实施会话持有、本单**禁改**（见 `session-policy-route.ts` 文件头
 *      「任务书 §一 裁定 D2」），且等于给同一件事**造第二套写**（两份会漂的校验）。
 *   ③ 路由名与语义对齐：建会话走 `session-create`，写已存在会话的策略走 `session-policy`。
 *
 * ⚠ 动作名也要跟着改：写入口只认 `action:'write'`。**`set-policy` 这个名字已不再存在于
 *   任何产品路径**（它只活在旧的假 call 判据里）。
 * ⚠ 其余动作（`issue` / `create` / `enums`）**一个字都不改**，仍走 `session-create`。
 */
/**
 * ⚠ 单次调用超时（2026-10-23 · 修 D1）：超时必须**可读地失败**，⛔ 不许让「创建中…」永久转圈。
 *   ⚠ 取值只影响「等多久算卡住」，不影响任何校验；30s 与宿主侧同类通道口径一致。
 */
const DEFAULT_CALL_TIMEOUT_MS = 30000

const CREATE_ROUTE = SESSION_CREATE_PATH
const POLICY_ROUTE = SESSION_POLICY_PATH

/** 按 `action` 选路由（⚠ 默认落到创建路由，保持既有动作行为不变）。 */
function routeOf(action: string): string {
  return action === 'write' ? POLICY_ROUTE : CREATE_ROUTE
}

/**
 * 默认通道：**同源** POST 到本插件对应路由（⚠ 凭据由浏览器自动带，⛔ 不手工塞 token）。
 *
 * ⚠ 路由由 `action` 决定（见 `routeOf`）；⛔ 不在这里写死单一路径 ——
 *   那正是本单要修的死路（写动作被发到只认 issue/create/enums 的路由上 ⇒ 400）。
 */
async function defaultCall(body: unknown): Promise<any> {
  const action = typeof (body as any)?.action === 'string' ? String((body as any).action) : ''
  /**
   * ⚠⚠ **必须有超时**（2026-10-23 · 修 D1）：此前 `fetch` 裸调用、无 timeout、无
   *   `AbortController` ⇒ 服务端不回包时按钮永远停在「创建中…」，用户唯一出路是刷新，
   *   而刷新会把「可能已建好」的会话变成看不见的孤儿。
   *   ⚠ 超时是**可读的失败**，不是静默：返回 `ok:false` + 明确文案，由弹窗渲染成
   *     `role="alert"`；用户据此去会话列表确认。
   */
  const ctrl: any = typeof (globalThis as any).AbortController === 'function'
    ? new (globalThis as any).AbortController()
    : null
  let timer: any = null
  if (ctrl !== null) {
    timer = setTimeout(() => { try { ctrl.abort() } catch { /* 忽略 */ } }, DEFAULT_CALL_TIMEOUT_MS)
  }
  try {
    const res = await fetch(routeOf(action), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(ctrl !== null ? { signal: ctrl.signal } : {}),
    })
    let parsed: any
    try { parsed = await res.json() } catch { parsed = { ok: false, reason: d('err.notJson', { status: res.status }) } }
    return parsed
  } catch (e: any) {
    const aborted = e?.name === 'AbortError' || ctrl?.signal?.aborted === true
    return {
      ok: false,
      reason: aborted
        ? d('err.timeout', { seconds: Math.round(DEFAULT_CALL_TIMEOUT_MS / 1000) })
        : d('err.requestFailed', { message: String(e?.message ?? e) }),
    }
  } finally {
    if (timer !== null) { try { clearTimeout(timer) } catch { /* 忽略 */ } }
  }
}

/** 生成预分配 sessionId（⚠ 只为定位，**不构成授权** —— 授权靠一次性票据）。 */
function defaultMint(): string {
  try {
    const c = (globalThis as any).crypto
    if (c?.randomUUID !== undefined) return `hob-${c.randomUUID()}`
  } catch { /* 退化 */ }
  return `hob-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 弹窗本体。
 *
 * ⚠ **提交顺序**（与服务端同一契约，⛔ 不可换）：
 *   ① `issue`（把两值 + 预分配 id 钉进一次性票据）
 *   ② `create`（带票建会话 → 服务端建空白 → 写策略 → 回读）
 *   ⇒ 任何一步失败 ⇒ 显示可读错误、**不开第一轮**（本组件不触发任何首轮）。
 */
export function HobCreateDialog(props: HobCreateDialogProps): any {
  useLocaleSignal()
  const call = props.call ?? defaultCall
  const mint = props.mintSessionId ?? defaultMint
  /**
   * ⚠⚠ **值来自服务枚举**（2026-10-22）：
   *   初值**不写死**（上一版写死 `'ledger'`/`'auto'`）；服务枚举到齐后取
   *   `floorLevel` / `defaultMode` 作为初值。⛔ 枚举没到 ⇒ 下面 `enumReady=false`
   *   ⇒ **提交按钮禁用**（任务书："服务枚举拿不到时不可提交"）。
   */
  const [level, setLevel] = React.useState<string | undefined>(undefined)
  const [mode, setMode] = React.useState<string | undefined>(undefined)
  /**
   * ⚠ **工作区必须用户显式选**（2026-10-22）：宿主没有可信"当前工作区"读取服务，
   *   ⇒ ⛔ 不取注册表第一项、⛔ 不省略归属。空串 = 还没选 ⇒ 不可提交。
   */
  const [workspaceId, setWorkspaceId] = React.useState<string>('')
  const [phase, setPhase] = React.useState<Phase>({ kind: 'idle' })
  /** ⚠ 服务端下发的枚举（⚠ 唯一值来源；⛔ UI 不另抄一份权威清单）。 */
  const [enums, setEnums] = React.useState<any>(undefined)
  const [enumError, setEnumError] = React.useState<string>('')
  /**
   * ⚠⚠ **放弃令牌**（2026-10-23 · 修 D1 的补漏）：提交中点取消只改 `phase`，**请求仍在飞**。
   *   若不作废，晚到的回包会把「已停止等待、可能已创建」这条警告**覆盖成「已创建」** ——
   *   用户于是以为一切正常，那比没有取消更糟（提示被静默抹掉）。
   *   ⇒ 取消时 `abandonedRef.current += 1`；`submit()` 在**每个 await 之后**核对令牌，
   *     不一致 ⇒ **一个 state 都不写**（⛔ 不许用"晚到的成功"覆盖用户的退出意图）。
   *   ⚠ 用 ref 不用 state：它要在**同一次提交的闭包里**读到最新值，且不该触发重渲染。
   */
  const abandonedRef = React.useRef(0)
  /**
   * ⚠⚠ **在飞闸**（2026-10-23 · 补 D1 的第三半 · 产品域指出）：
   *   取消只把 `phase` 改成 `error` ⇒ `canSubmit` 恢复 true、按钮重新可点、
   *   而 `submit()` 入口只挡 `phase.kind === 'submitting'` ⇒ **能再发一次**；
   *   新建分支每次 `mint()` 新 id ⇒ **两个会话**（旧的仍在飞）。
   *   ⇒ 用 ref 记"有请求在飞"，请求**真正结算**（成功/失败/异常）才放开；
   *     取消**不放开**（那正是重复建的窗口）。
   *   ⚠ 逃逸口：弹窗卸载（关窗再开）时复位 —— 否则服务端永不回包会把按钮焊死。
   */
  const inFlightRef = React.useRef(false)
  React.useEffect(() => () => { inFlightRef.current = false }, [])

  /**
   * ⚠⚠ **重试计数**（2026-10-24 · 修复单第 7 条）。
   *
   * ── 修的是什么 ────────────────────────────────────────────────────────
   *   枚举/创建失败时此前**只有一行红字 + 一个禁用按钮**：用户唯一出路是关掉弹窗
   *   再打开（枚举那条）或者刷新页面 —— 而"服务端抖一下"这种最常见的失败，
   *   本该一次点击就能重来（对比：设置面板的候选来源那一行一直有「重新读取」）。
   *   ⇒ ① 枚举失败 ⇒ 错误行旁给「重试」，点了重新拉枚举（自增下面的计数，effect 重跑）；
   *     ② 提交失败 ⇒ 错误行旁给「重试」，点了重新走同一份提交逻辑（在飞闸照旧挡重复建）。
   *   ⚠ 重试**不改变**任何校验：它只是再发一次同样的请求（服务端仍是唯一门槛）。
   */
  const [enumRetry, setEnumRetry] = React.useState(0)

  // ⚠ 拉一次枚举（⚠ 与服务同源：⛔ 不在 UI 里写死一份清单作为"权威"）
  React.useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const r = await call({ action: 'enums' })
        if (!alive) return
        if (r?.ok === true) {
          setEnums(r)
          // ⚠ 初值取**服务给的**缺省（⛔ 不写死字面量）
          setLevel((cur) => cur ?? String(r.floorLevel ?? ''))
          setMode((cur) => cur ?? String(r.defaultMode ?? ''))
        } else {
          setEnumError(String(r?.reason ?? '-'))
        }
      } catch (e) {
        if (alive) setEnumError(String((e as Error)?.message ?? e))
      }
    })()
    return () => { alive = false }
  }, [call, enumRetry])

  /**
   * ⚠ 取消：**什么都不创建**（⛔ 不发请求、⛔ 不留孤儿）。
   *
   * ⚠⚠ **提交中也要能退出**（2026-10-23 · 修 D1）：此前这里对 `submitting` **静默早退**，
   *   而取消按钮同时被 `disabled` ⇒ 服务端不回包时用户**四条路全堵**（取消早退 / 按钮禁用 /
   *   无 X / backdrop 不接点击），唯一出路是刷新页面；而刷新会把「可能已建好」的会话
   *   变成看不见的孤儿。
   *   ⇒ 现在：提交中点取消 = **停止等待 + 明确告诉用户「可能已创建，去列表确认」**，
   *     对话框**留在原地**（`phase` 从 `submitting` 退出，按钮随即恢复可用），
   *     用户看完提示可以再点一次取消关掉。⛔ 不静默关闭（那才是真孤儿）。
   */
  /**
   * 「重试」的统一入口（⚠ 一个按钮管两种失败面，按**当前失败的是哪一面**分流）：
   *   · 枚举没拿到（`enumError` 或 `enums === undefined`）⇒ 重新拉枚举；
   *   · 否则（提交/写入失败）⇒ 重走 `submit()`（在飞闸与幂等闸都在 `submit()` 里）。
   * ⚠ 清掉旧的错误行再重试：否则用户点了按钮、界面上还挂着上一次的红字，
   *   分不清"又失败了"还是"按钮没反应"。
   */
  const retry = () => {
    if (enumError !== '' || enums === undefined) {
      setEnumError('')
      setEnumRetry((n) => n + 1)
      return
    }
    setPhase({ kind: 'idle' })
    void submit()
  }

  const cancel = () => {
    if (phase.kind === 'submitting') {
      // ⚠ 作废这一次在飞的提交：晚到的回包**不许**覆盖下面这条警告（见 `abandonedRef`）
      abandonedRef.current += 1
      setPhase({ kind: 'error', message: d('cancel.submitting') })
      return
    }
    setPhase({ kind: 'idle' })
    props.onClose?.()
  }

  const submit = async () => {
    // ⚠ 幂等：submitting 期间再点无效（⛔ 不重复建）
    if (phase.kind === 'submitting') return
    /**
     * ⚠⚠ **在飞闸**：取消后 `phase` 是 `error`（不是 `submitting`）⇒ 上面那条挡不住。
     *   若上一次的 create 还在飞，这里必须拒绝 —— 否则 mint 新 id 就**多建一个会话**。
     */
    if (inFlightRef.current) return
    /**
     * ⚠⚠ **提交前的三道硬闸**（2026-10-22）：
     *   ① 服务枚举没到 ⇒ **不可提交**（值没有权威来源）；
     *   ② 工作区没选 ⇒ **不可提交**（⛔ 不取注册表第一项、⛔ 不省略归属）；
     *   ③ 两个值必须**在服务给的枚举内**（⛔ 不把本地字面量发给服务）。
     */
    if (enums === undefined) {
      setPhase({ kind: 'error', message: d('err.enumsMissing') })
      return
    }
    /**
     * ⚠⚠ **工作区闸只在「新建模式」需要**（2026-10-22 第 4 轮）：
     *   已有会话模式下，工作区**已经定了**（那个会话本来就有归属）——
     *   再要求用户选一次是**无意义的重复劳动**，而且我们**不该**用一个新的工作区
     *   去覆盖一个已存在会话的归属（那会改它的账本落点）。
     *   ⇒ 该模式**完全不读 `workspaceId`**，选档位只写两项：读档 + 推进方式。
     */
    const isExisting = typeof props.targetSessionId === 'string' && props.targetSessionId !== ''
    if (!isExisting && workspaceId === '') {
      setPhase({ kind: 'error', message: d('err.workspaceMissing') })
      return
    }
    if (level === undefined || mode === undefined) {
      setPhase({ kind: 'error', message: d('err.selectionMissing') })
      return
    }
    setPhase({ kind: 'submitting' })
    /**
     * ⚠ 记下**本次**提交的令牌（见 `abandonedRef`）：取消会把令牌 +1 ⇒ 之后每次
     *   await 回来都要核对，**不一致就一个 state 都不写**（晚到的成功不许覆盖退出意图）。
     */
    const myToken = abandonedRef.current
    const stillWanted = () => abandonedRef.current === myToken
    inFlightRef.current = true
    try {

    /**
     * ⚠⚠ **两条分支，⛔ 不许交叉**（任务书 §一 E 项 + §二②）：
     *
     *   ① **已有会话模式**（`targetSessionId` 给了）：
     *      ⛔ **绝不**调 `issue` / `create` —— 那会再建一个会话（本单机检钉住"零 create"）。
     *      ⇒ 只调一条**写入**动作 `write`（⚠ 2026-10-23 起；它不是创建路由的动作，见
     *        `defaultCall` 上面的路由说明 —— 旧名 `set-policy` 在两条路由上都没有处理分支），
     *        把两项落到**那个已存在的会话**上。
     *      ⚠ 写入走**已有的策略写入服务**（服务端 `hobSessionPolicy.set`），⛔ 不造第二套写。
     *      ⚠ 取消 ⇒ 什么都不写（见 `cancel()`）⇒ 保持未选。
     *      ⚠ 写入失败 ⇒ 可读失败，且**不得**把会话当成已选（`phase` 停在 error）。
     *
     *   ② **新建模式**（`targetSessionId` 缺席）：**完全维持现状**（issue → create）。
     */
    if (isExisting) {
      const targetId = String(props.targetSessionId)
      try {
        /**
         * ⚠ 动作名是 `write`（= `session-policy` 路由认的那个），⛔ 不是 `set-policy`。
         *   路由由 `defaultCall` 按动作选（`routeOf`）⇒ 这条请求会打到
         *   `POST /api/dsh-hob/session-policy` 的 `handlePolicyWrite`。
         */
        const r = await call({ action: 'write', sessionId: targetId, level, workMode: mode })
        if (!stillWanted()) return
        if (r?.ok !== true) {
          setPhase({ kind: 'error', message: d('err.writeFailed', { reason: String(r?.reason ?? '-') }) })
          return
        }
        setPhase({ kind: 'done', sessionId: targetId })
        // 2026-11-05 WSL 真机缺陷：成功必须就地关窗，不能只依赖父级 onCreated 链。
        // DialogState.close() 幂等，overlay 再关闭一次没有副作用。
        props.onClose?.()
        props.onCreated?.(targetId)
      } catch (e) {
        if (!stillWanted()) return
        setPhase({ kind: 'error', message: d('err.writeThrew', { message: String((e as Error)?.message ?? e) }) })
      }
      return
    }

    const sessionId = mint()
    try {
      // ⚠ 票据**绑定工作区**（服务端会独立核它是否已登记）
      // ⚠ 变量名**不能**叫 `t`：本轮起本文件 import 了 i18n 的 `t()`（取词入口），
      //   同名局部变量会把它遮蔽掉 ⇒ 那一屏的文案会全部退回键名（静默失败）。
      const ticketRes = await call({ action: 'issue', sessionId, level, workMode: mode, workspaceId })
      if (!stillWanted()) return
      if (ticketRes?.ok !== true) {
        setPhase({ kind: 'error', message: String(ticketRes?.reason ?? d('err.ticket')) })
        return
      }
      const r = await call({ action: 'create', ticket: String(ticketRes.ticket), sessionId })
      if (!stillWanted()) return
      if (r?.ok !== true) {
        /**
         * ⚠ 失败文案要**分清三种**（⛔ 不许都说成"留了空白会话但它是安全的最低档"）：
         *   · `unsafe: true` ⇒ 可能留下**可执行高档**残留且无法证明已隔离 ⇒ **必须警告**；
         *   · `stranded` 但 `quarantine.ok` ⇒ 残留已被**持久隔离**（最低档 + 不推进）；
         *   · 其余 ⇒ 通用失败。
         */
        const extra = r?.unsafe === true
          ? d('err.createUnsafe', { id: String(r?.stranded?.sessionId ?? '?') })
          : r?.stranded !== undefined
            ? d('err.createStranded', { id: String(r.stranded.sessionId) })
            : ''
        setPhase({ kind: 'error', message: String(r?.reason ?? d('err.createFailed')) + extra })
        return
      }
      setPhase({ kind: 'done', sessionId: String(r.sessionId ?? sessionId) })
      // 同已有会话模式：成功即关闭，父级回调可能缺失或延迟。
      props.onClose?.()
      props.onCreated?.(String(r.sessionId ?? sessionId))
    } catch (e) {
      if (!stillWanted()) return
      setPhase({ kind: 'error', message: d('err.requestFailed', { message: String((e as Error)?.message ?? e) }) })
    }
    } finally {
      /**
       * ⚠ 只有**真正结算**才放开在飞闸（成功 / 失败 / 异常都会走到这里）。
       *   ⛔ 不要在 `cancel()` 里放开 —— 那正是"旧的还在飞、新的又发出"的窗口。
       */
      inFlightRef.current = false
    }
  }

  /**
   * ⚠ **提交按钮的可用性**（三条闸的可视化）：
   *   枚举未到 / 工作区未选 / 两值未就绪 ⇒ 禁用 + 可读原因（⛔ 不静默禁用）。
   *
   * ⚠⚠ **已有会话模式下"工作区"这一闸不存在**（2026-10-22 第 4 轮）：
   *   那个会话的工作区归属**已经定了**，再要求选一次既无意义、又会诱导用户
   *   以为能改归属（那会动它的账本落点 —— 本插件⛔ 不做）。
   *   ⇒ `needsWorkspace` 只在新建模式为 true；`canSubmit` 与 `blockedReason`
   *     都按它分支（⛔ 不许让已有会话模式卡在"请选择工作区"上，那样按钮永远点不了）。
   */
  const isExistingMode = typeof props.targetSessionId === 'string' && props.targetSessionId !== ''
  const needsWorkspace = !isExistingMode
  const enumReady = enums !== undefined && level !== undefined && mode !== undefined
  const canSubmit = enumReady && (!needsWorkspace || workspaceId !== '') && phase.kind !== 'submitting'
  /**
   * 按钮为什么不可点（⛔ 不许只有一个灰掉的按钮）。
   * ⚠ 枚举失败那一条**不在这里重复**：它由下面的错误框（带「重试」）承载
   *   —— 同一句话在屏幕上出现两次会让用户以为出了两个问题。
   */
  const blockedReason = enumError !== ''
    ? ''
    : enums === undefined
      ? d('blocked.enumsLoading')
      : needsWorkspace && workspaceId === ''
        ? d('blocked.workspace')
        : ''
  const disabled = phase.kind === 'submitting'

  /**
   * ⚠⚠ **选项 = 服务枚举 × 本地中文标签**（2026-10-22 · 任务书"值由服务枚举决定、
   *   中文标签独立映射"）。
   *   · **值**只来自服务（`enums.levels` / `enums.modes`）⇒ ⛔ UI 不新增值；
   *   · **标签/说明**来自本文件的词典（`LEVEL_LABELS` / `MODE_LABELS`）；
   *   · ⚠ 服务给了个我们**没有标签**的值 ⇒ 用值本身兜底（⛔ 不隐藏它、⛔ 不假装有中文名）。
   */
  /**
   * ⚠⚠ **"呈现"与"可选"是两件事**（2026-10-22 · 用户就地纠正后）：
   *   · **呈现哪几项** = 服务的 `levels`（全枚举三档）—— 用户要**看见**另两档存在；
   *   · **哪几项可选** = 服务的 `openLevels`（= 开放面，只含账本权限）。
   *   ⇒ 未列入 `openLevels` 的档：**渲染出来但置灰**，并标注「暂未开放」。
   * ⚠ 缺 `openLevels`（旧服务）⇒ **全部不可选**（fail-closed）：
   *   宁可让用户点不了并看到说明，也⛔ 不在拿不到"哪些开放"时**猜**成可选。
   * ⚠ ⚠ **置灰不是校验**：请求方自报一个开放面外的值，一律由服务端拒 ——
   *   而且这条闸在**四处**写入路径上都存在（2026-10-24 订正：原文写"三处"，漏了第四条）：
   *     ① `session-create-channel.ts` 的 `issue()`（签发票据）；
   *     ② 同文件的 `createHobSession()`（建会话）；
   *     ③ `modules/bus.ts` 的 `hob_spawn`（无界面建会话）；
   *     ④ `session-policy-route.ts` 的 `handlePolicyWrite()`（给**已存在**会话写两项
   *        —— 即本弹窗"已有会话模式"走的那条，以前不在"三处"的名单里）。
   *   四处都按**同一个**开放面常量判（`shared/read-level-policy.ts` 的
   *   `OPEN_READ_LEVELS` / `isOpenReadLevel`）⇒ ⛔ 没有哪一处各写一份白名单。
   */
  const openLevels = Array.isArray((enums as any)?.openLevels)
    ? (enums as any).openLevels as string[]
    : []
  const levelOptions = (Array.isArray((enums as any)?.levels) ? (enums as any).levels as string[] : [])
    .map((v) => {
      const hit = LEVEL_KEYS.find((x) => x.value === v)
      // ⚠ 服务给了个我们没有标签的值 ⇒ 用值本身兜底（⛔ 不隐藏它、⛔ 不假装有名字）。
      const label = hit === undefined ? v : d(hit.labelKey)
      const hint = hit === undefined ? '' : d(hit.hintKey)
      return { value: v, label, hint, selectable: openLevels.includes(v) }
    })
  const modeOptions = (Array.isArray((enums as any)?.modes) ? (enums as any).modes as string[] : [])
    .map((v) => {
      const hit = MODE_KEYS.find((x) => x.value === v)
      return hit === undefined
        ? { value: v, label: v, hint: '' }
        : { value: v, label: d(hit.labelKey), hint: d(hit.hintKey) }
    })

  /**
   * ⚠⚠ **"暂未开放"的原因说明**（2026-10-22 · 用户裁定「安全优先」）。
   *
   * ── 判据的分工（⛔ 不许把两件事混起来）──────────────────────────────────
   *   · **呈现几项** = 服务下发的 `levels`（⛔ UI **不**过滤、不新增值）；
   *   · **哪几项可选** = 服务下发的 `openLevels`；
   *   · **说明为什么** = 服务下发的 `levelsNote`（旧服务缺席时用本地兜底文案）。
   *   ⚠ 这里只负责**把原因说清 + 把未开放的置灰**，⛔ 不承担校验
   *     （校验在 `issue()` / `createHobSession()` / `hob_spawn`）。
   */
  const levelsNote = typeof (enums as any)?.levelsNote === 'string' && (enums as any).levelsNote !== ''
    ? String((enums as any).levelsNote)
    : d(DEFAULT_LEVELS_NOTE_KEY)

  /**
   * ── 键盘 / 焦点（2026-10-22 · 任务书要求真实可验，⛔ 不是"写了 onKeyDown 就算"）──
   *   ① **Escape 关闭**（并调用 `onClose` ⇒ 宿主侧关掉弹窗、**零创建**）；
   *   ② **初始焦点**落在标题后的第一个可操作控件（工作区选择）；
   *   ③ **关闭后焦点回归**到打开它的那个按钮（由 `onClose` 后的 effect 负责）。
   *   ⚠ 实现用 ref 而不是 `document.activeElement` 猜测 —— 便于在隔离 DOM 里断言。
   */
  const boxRef = React.useRef<any>(null)
  const firstFieldRef = React.useRef<any>(null)
  /**
   * ⚠⚠ **初始焦点的时机**（2026-10-22 实测修正）：
   *   依赖**必须**是"枚举到齐"（`enums`）—— 因为工作区 `select` 是
   *   **枚举到达之后才渲染的**：挂载时它还不存在 ⇒ `firstFieldRef.current` 是 `null`
   *   ⇒ 上一版用 `[]` 依赖，effect 只跑一次、当时拿不到元素 ⇒ **焦点永远不落**
   *   （实测 `activeElement === BODY`）。
   *   ⚠ 仍未"抢"用户焦点：只在**第一次**枚举到齐时聚焦一次（`didFocus` 闸门）。
   */
  const didFocusRef = React.useRef(false)
  React.useEffect(() => {
    if (didFocusRef.current) return
    const el = firstFieldRef.current
    if (el === null || el === undefined) return
    didFocusRef.current = true
    try { el.focus?.() } catch { /* 环境无 focus ⇒ 忽略 */ }
  }, [enums])
/** 弹窗内**可聚焦**元素（按 Tab 顺序，⚠ 跳过 disabled / tabindex=-1 / 隐藏）。 */
function focusablesIn(root: any): any[] {
  if (root === null || root === undefined || typeof root.querySelectorAll !== 'function') return []
  const nodes = Array.from(root.querySelectorAll(
    'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )) as any[]
  return nodes.filter((el) => {
    if (el?.disabled === true) return false
    if (el?.getAttribute?.('aria-hidden') === 'true') return false
    // ⚠ jsdom 没有布局 ⇒ `offsetParent` 恒为 null；这里只排除 `display:none` 的显式标记。
    if (el?.hidden === true) return false
    return true
  })
}

/**
 * 把弹窗**以外**的兄弟节点标成 `inert`（⚠ 焦点圈的"另一半"）。
 *
 * ── 为什么光有 Tab 圈不够（2026-10-24 · 修复单第 5 条）──────────────────
 *   `aria-modal="true"` 只是**对读屏软件的声明**，浏览器**不会**因此阻止键盘焦点
 *   走到背景；只拦 Tab 也只挡住"按键"这一条路（鼠标点击、程序化 `focus()`）
 *   照样能落到背景控件上。⇒ 两层都要：
 *     ① **Tab 循环**（在 `onKeyDown` 里，见下）—— 保证键盘不会走到背景；
 *     ② **背景 `inert`** —— 让背景元素**根本不可聚焦/不可交互**（连 `focus()` 都无效）。
 *   ⚠ `inert` 在旧环境可能不支持：那就在文档层面只当"多一层"——**不依赖它**，
 *     判据的落点是 Tab 循环那条（jsdom 实测支持 attribute，但 `focus()` 语义未必）。
 *
 * @param box - 弹窗根节点（`boxRef.current`）。
 * @returns 还原函数（卸载时**必须**调用 —— ⛔ 不留一片永久点不动的界面）。
 */
function markBackgroundInert(box: any): () => void {
  const doc: any = box?.ownerDocument ?? (globalThis as any).document
  if (doc === null || doc === undefined) return () => {}
  const touched: any[] = []
  const mark = (el: any) => {
    if (el === null || el === undefined || el.nodeType !== 1) return
    if (el.contains?.(box) === true) return
    if (el.getAttribute?.('inert') === '') return
    try { el.setAttribute('inert', '') } catch { return }
    touched.push(el)
  }
  // 从弹窗往上逐层把**兄弟**标掉（祖先链上的兄弟也要标，否则能 Tab 到外部区域）。
  let node: any = box
  while (node !== null && node !== undefined && node !== doc.body && node.parentElement !== null) {
    const parent: any = node.parentElement
    for (const sibling of Array.from(parent.children ?? []) as any[]) mark(sibling)
    node = parent
  }
  return () => {
    for (const el of touched) {
      try { el.removeAttribute('inert') } catch { /* 忽略 */ }
    }
  }
}

  const onKeyDown = (e: any) => {
    if (e?.key === 'Escape') {
      e.preventDefault?.()
      e.stopPropagation?.()
      cancel()
      return
    }
    /**
     * ⚠⚠ **焦点圈**（2026-10-24 · 修复单第 5 条）。
     *
     * ── 修的是什么 ────────────────────────────────────────────────────
     *   `aria-modal="true"` 只是声明；实测 `Tab` 能一路走到背景控件（键盘用户
     *   在弹窗开着时把焦点丢到看不见的界面上，`Escape` 也没人收）。
     *   ⇒ 在**第一个/最后一个**可聚焦元素上把 Tab 绕回另一端（标准 trap 行为）。
     *   ⚠ 只在"确实有可聚焦元素"时介入 —— 空弹窗里不吞掉 Tab（那会让键盘彻底走不动）。
     */
    if (e?.key !== 'Tab') return
    const box = boxRef.current
    const list = focusablesIn(box)
    if (list.length === 0) return
    const first = list[0]
    const last = list[list.length - 1]
    const active = (box?.ownerDocument ?? (globalThis as any).document)?.activeElement
    // ⚠ 用 `shiftKey` 区分反向；边界处绕回。
    if (e.shiftKey === true) {
      if (active === first || active === box || box?.contains?.(active) !== true) {
        e.preventDefault?.()
        try { last.focus?.() } catch { /* 忽略 */ }
      }
      return
    }
    if (active === last) {
      e.preventDefault?.()
      try { first.focus?.() } catch { /* 忽略 */ }
    }
  }

  /**
   * ⚠⚠ **「第一个可选档」只挂一次 ref**（2026-10-22 第 4 轮）。
   *
   *   为什么需要这个可变标记：React 的 `ref` 回调在重渲染时会**先 null 再赋值**，
   *   若多个元素共用同一个 `firstFieldRef`，最终指向的是**最后一个赋值的那个**
   *   （实测会落到最后一档，而不是第一档）。⇒ 用一次性标记把它钉在第一个。
   *   ⚠ 这是渲染期写入的普通变量（不是 state）—— 它只影响**本次渲染内**谁挂 ref，
   *     不触发重渲染，也不参与组件对外行为。
   */
  let firstSelectableAssigned = false

  /**
   * ⚠ 背景 `inert` 的挂载/还原（见 {@link markBackgroundInert}）。
   *   依赖 `[enums]`：工作区 `select` 是枚举到齐后才出现的 —— 但 inert 标的是**背景**，
   *   与弹窗内部节点无关，故只需挂一次（`[]`）。⚠ 卸载必须还原，否则宿主界面永久点不动。
   */
  React.useEffect(() => {
    const box = boxRef.current
    if (box === null || box === undefined) return undefined
    const restore = markBackgroundInert(box)
    return () => { restore() }
  }, [])

  return h('div', {
    className: 'dsh-hob-dialogBackdrop',
    role: 'dialog',
    'aria-modal': 'true',
    // ⚠ 机检锚（⛔ 不靠猜 class 名判断"有没有焦点圈"）
    'data-hob-focus-trap': 'true',
    'aria-labelledby': 'dsh-hob-dialog-title',
    // ⚠ 机检用：模式断言不靠标题文字猜（⛔ 不把语义藏在文案里）
    'data-hob-dialog-mode': isExistingMode ? 'existing' : 'create',
    onKeyDown,
    ref: boxRef,
    // ⚠ 让 dialog 自己可聚焦（Escape 在没有可聚焦子元素时也能收到）
    tabIndex: -1,
  },
  h('div', { className: 'dsh-hob-dialog' },
    /**
     * ⚠⚠ **标题与说明按模式分**（2026-10-22 第 4 轮 · 任务书 §一.4）：
     *   · 新建模式 ⇒ "新建 Hob 会话"（现状，⛔ 一字不改）；
     *   · 已有会话模式 ⇒ "为本会话选择可读范围" —— ⛔ **不许**再写"新建"，
     *     否则用户会以为点确认会建一个新会话（那正是要防的误解）。
     *   ⚠ 两种模式共用同一个 `data-hob-dialog-mode` 便于机检断言（⛔ 不靠标题文字猜）。
     */
    h('h2', { id: 'dsh-hob-dialog-title', className: 'dsh-hob-dialogTitle' },
      isExistingMode ? d('shell.title.existing') : d('shell.title.create')),
    h('p', { className: 'dsh-hob-dialogLead' },
      isExistingMode ? d('shell.lead.existing') : d('shell.lead.create')),

    /**
     * ── 控件①：**工作区**（⚠ 必须用户显式选；⛔ 不取注册表第一项）──────────
     * ⚠⚠ **已有会话模式整块不渲染**（2026-10-22 第 4 轮）：
     *   那个会话的归属**已经定了**；在这里再让用户选一个工作区，等于暗示
     *   "可以改它的归属" —— 而改归属会动它的账本落点，本插件⛔ 不做，
     *   也不该让 UI 制造这种期待。⇒ 该模式下这一整块 `null`。
     *   ⚠ 仍然**不抢初始焦点**：焦点改由下面的读档单选接（见 `ref` 分支）。
     */
    isExistingMode ? null : h('fieldset', { className: 'dsh-hob-fieldset', disabled },
      h('legend', { className: 'dsh-hob-legend' }, d('legend.workspace')),
      h('p', { className: 'dsh-hob-note' }, d('note.workspace')),
      Array.isArray((enums as any)?.workspaces) && (enums as any).workspaces.length > 0
        ? h('select', {
          className: 'dsh-hob-select',
          // ⚠ **初始焦点落点**（任务书要求"初始焦点"可验）：第一个可操作控件。
          //   ⚠ 用 ref 而不是"猜 activeElement"，便于隔离 DOM 里直接断言。
          ref: firstFieldRef,
          // ⚠ 可访问：显式 label 关联（见 legend 已给组名）
          'aria-label': d('aria.workspace'),
          value: workspaceId,
          disabled,
          onChange: (e: any) => setWorkspaceId(String(e?.target?.value ?? '')),
        },
        h('option', { value: '' }, d('opt.workspace.placeholder')),
        ...((enums as any).workspaces as Array<{ id: string; label: string }>).map((w) =>
          h('option', { key: w.id, value: w.id }, w.label)))
        : h('p', { className: 'dsh-hob-error', role: 'alert' },
          (enums as any)?.workspacesUnavailable !== undefined
            ? d('err.workspaceList.unavailable', { reason: String((enums as any).workspacesUnavailable) })
            : d('err.workspaceList.empty')),
    ),

    // ── 控件②：可读范围（⚠ 三档**都呈现**；未开放的两档**置灰 + 标注「暂未开放」**）──
    /**
     * ⚠⚠ **布局口径**（2026-10-22 · 用户就地纠正后）：
     *   · **三档都渲染出来**（用户要看见另两档存在，⛔ 不是"只画一项"）；
     *   · 未列入 `openLevels` 的档：`input.disabled = true` + 整行 `data-unavailable` +
     *     行内可见「**暂未开放**」标注；
     *   · **账本权限**（开放面里的那一档）**可选**。
     *   ⚠ ⚠ **置灰不是校验** —— 绕过界面直接 POST 一个开放面外的档，仍由服务端拒；
     *     这条闸在**四处**写入路径上都有（票据签发 / 建会话 / `hob_spawn` /
     *     策略写入 `action:'write'`），四处共用 `OPEN_READ_LEVELS` 一个常量
     *     （2026-10-24 订正：原文写"三处"，漏了策略写入那条 —— 而它正是本弹窗
     *      "已有会话模式"走的路径）。
     *     本控件只负责"看得见 + 点不了 + 说明为什么"。
     */
    h('fieldset', { className: 'dsh-hob-fieldset', disabled },
      h('legend', { className: 'dsh-hob-legend' }, d('legend.level')),
      /**
       * ⚠⚠ **原因说明紧挨控件**（⛔ 不许只在别处提一句）：
       *   用户会先看到两项灰掉的选项 —— 说明必须就在同组里回答"为什么灰"。
       * ⚠ 该段由服务下发（`enums.levelsNote`）⇒ 与服务端拒绝理由**同一口径**，⛔ 不改写成另一套说法。
       */
      h('p', { className: 'dsh-hob-note' }, levelsNote),
          ...levelOptions.map((o: any) => {
        /**
         * ⚠ **禁用的三处都要给**（只给 `disabled` 不够）：
         *   ① `input.disabled` —— 真点不了（不只是样式）；
         *   ② 行上 `data-unavailable="true"` —— 便于机检与样式（⛔ 不靠颜色表达语义）；
         *   ③ 行内可见文字「暂未开放」—— 读屏与肉眼都能知道（⛔ 不靠 title 悬停）。
         */
        const selectable = o.selectable === true
        return h('label', {
          key: o.value,
          className: 'dsh-hob-option',
          ...(selectable ? {} : { 'data-unavailable': 'true' }),
          // ⚠ 「完全权限」选中/未选中都要能看到完整说明 ⇒ 一直显示（不只 hover）
          'data-emphasis': o.value === 'workspace' ? 'strict' : undefined,
          ...(selectable ? {} : { title: d('badge.notOpen') }),
        },
        h('input', {
          type: 'radio',
          name: 'hob-level',
          value: o.value,
          checked: level === o.value,
          disabled: !selectable,
          /**
           * ⚠ **已有会话模式的初始焦点落点**（2026-10-22 第 4 轮）：
           *   该模式下工作区控件**不渲染** ⇒ 上面那个 `firstFieldRef` 永远拿不到元素
           *   ⇒ 焦点会停在 `BODY`（上一版就踩过这个坑，见文件里那段"实测修正"）。
           *   ⇒ 这里给**第一个可选的档**挂同一个 ref 作为兜底。
           *   ⚠ 只在 `isExistingMode` 时挂，且只挂第一个可选档
           *     （⛔ 不要多个元素共用一个 ref —— 后者会覆盖前者，焦点落到最后一个）。
           *   ⚠ `didFocusRef` 闸门保证只聚焦一次，所以即使枚举迟到也不会反复抢焦点。
           */
          ...(isExistingMode && selectable && firstSelectableAssigned === false
            ? { ref: (el: any) => { firstSelectableAssigned = true; firstFieldRef.current = el } }
            : {}),
          ...(selectable ? { onChange: () => setLevel(o.value) } : {}),
        }),
        h('span', { className: 'dsh-hob-optionLabel' }, o.label),
        h('span', { className: 'dsh-hob-optionHint' }, o.hint),
        selectable ? null : h('span', { className: 'dsh-hob-optionBadge' }, d('badge.notOpen')))
      }),
    ),

    // ── 控件③：推进方式三档（⚠ 同上：选项来自服务枚举）────────────────────
    h('fieldset', { className: 'dsh-hob-fieldset', disabled },
      h('legend', { className: 'dsh-hob-legend' }, d('legend.mode')),
          ...modeOptions.map((o: any) => h('label', { key: o.value, className: 'dsh-hob-option' },
        h('input', {
          type: 'radio',
          name: 'hob-mode',
          value: o.value,
          checked: mode === o.value,
          onChange: () => setMode(o.value),
        }),
        h('span', { className: 'dsh-hob-optionLabel' }, o.label),
        h('span', { className: 'dsh-hob-optionHint' }, o.hint))),
      // ⚠ 能力红线：紧挨推进方式三档（用户做选择的那一屏）。
      //   ⛔ 不是去救活设置面板里那张零渲染点的死卡（第 8 条已把它整段删掉）。
      h('p', { className: 'dsh-hob-note', role: 'note', 'data-hob-redline': 'work-mode' },
        d('redline.workMode')),
    ),

    h('p', { className: 'dsh-hob-note' }, d('note.distinction')),

    // ⚠ **为什么不能提交**必须可读（⛔ 不许只有一个灰掉的按钮）
    blockedReason !== ''
      ? h('p', { className: 'dsh-hob-note', role: 'note' }, blockedReason)
      : null,

    // ── 状态区 ──────────────────────────────────────────────────────────
    /**
     * ⚠⚠ **失败时必须给重试入口**（2026-10-24 · 修复单第 7 条）：
     *   此前失败只有红字 + 一个禁用按钮 ⇒ 用户唯一出路是关窗重开 / 刷新页面。
     *   对比参照：设置面板的「候选来源」那一行一直有「重新读取」。
     *   ⚠ 重试按钮**只在失败时出现**（成功/提交中不出现 —— 那会诱导重复提交）。
     *   ⚠ 提交中失败的那条**也走这里**：`phase.kind === 'error'` 就是结算态，
     *     `submit()` 的在飞闸已放开，重试是安全的（重复建由服务端票据一次性挡）。
     */
    phase.kind === 'error'
      ? h('div', { className: 'dsh-hob-errorBox' },
        h('p', { className: 'dsh-hob-error', role: 'alert' }, phase.message),
        h('button', {
          type: 'button',
          className: 'dsh-hob-btn',
          onClick: retry,
          'data-hob-retry': 'submit',
        }, d('btn.retry')))
      : null,
    /**
     * ⚠ **枚举失败的重试**：错误行 + 重试按钮（⛔ 不是只有一行红字等用户自己发现
     *   "关掉再打开"）。⚠ 枚举失败时提交按钮是禁用的，所以这里的重试是**唯一**出路。
     */
    enumError !== ''
      ? h('div', { className: 'dsh-hob-errorBox' },
        h('p', { className: 'dsh-hob-error', role: 'alert' }, d('blocked.enumsUnavailable', { reason: enumError })),
        h('button', {
          type: 'button',
          className: 'dsh-hob-btn',
          onClick: retry,
          'data-hob-retry': 'enums',
        }, d('btn.retry')))
      : null,
    phase.kind === 'done'
      ? h('p', { className: 'dsh-hob-success', role: 'status' },
        // ⚠ 两种模式的成功文案**必须分开**（2026-10-22 第 4 轮）：
        //   已有会话模式**没有新建任何东西** ⇒ ⛔ 不许写"已创建会话"（那是谎报）。
        isExistingMode
          ? d('phase.done.existing', { id: phase.sessionId })
          : d('phase.done.create', { id: phase.sessionId }))
      : null,
    enums === undefined
      ? h('p', { className: 'dsh-hob-note' }, d('note.enumsMissing'))
      : null,

    // ── 动作 ────────────────────────────────────────────────────────────
    h('div', { className: 'dsh-hob-actions' },
      h('button', {
        type: 'button',
        className: 'dsh-hob-btn',
        onClick: cancel,
        // ⚠ 提交中**不禁用**（2026-10-23 · 修 D1）：禁用会让「服务端不回包」变成永久卡死。
        //   ⛔ 不要为了"防误点"把唯一的退出通道也关掉。
        'data-hob-cancel': 'always-enabled',
      }, d('btn.cancel')),
      h('button', {
        type: 'button',
        className: 'dsh-hob-btn dsh-hob-btnPrimary',
        onClick: () => { void submit() },
        // ⚠ 三道闸没全满足 ⇒ 禁用（⛔ 不静默禁用：下方 note 给可读原因）
        disabled: !canSubmit || phase.kind === 'done',
        'aria-disabled': (!canSubmit || phase.kind === 'done') ? 'true' : undefined,
        // ⚠ 便于 DOM 测试断言"为什么不能提交"（⛔ 不靠猜）
        title: blockedReason,
      }, phase.kind === 'submitting'
        // ⚠ 已有会话模式⛔ 不写"创建中"（没有创建这回事）
        ? (isExistingMode ? d('btn.writing') : d('btn.creating'))
        : (isExistingMode ? d('btn.confirm') : d('btn.create'))),
    ),
  ))
}

/**
 * ── **本插件独立的「新建 Hob 会话」命令**（2026-10-22 · 按 Hob 裁决改道）──────
 *
 * ── 为什么不再挂在 `conversation.hero.agentPreset` 上 ─────────────────────
 *   ① **那槽是 `single`**：官方类型文档原话是「a second entry does not sit beside
 *      the frame — it **shadows** it, and a **dynamically registered** entry is
 *      assigned a **lower priority** than the shipped one, which makes it
 *      **the winner**」⇒ 我们**再注册一个就是顶掉宿主的预设选择器**。
 *      `order`/`id` 都改不了这件事（`order` 只影响 `list` 槽的排序）。
 *   ② **那槽的"当前预设"读不出来**：宿主**没有**暴露"当前预设"的服务
 *      （`agentPresetSeat` 只活在它自己那个槽的组件私有状态里）⇒ 上一版用
 *      `state.preset()` 做 gating，而它**永远是 `undefined`** ⇒ 入口**永不出现**。
 *      ⚠ 全 client 搜 `setPreset(` **零调用**也印证了这一点。
 *   ⇒ **改道**：本插件提供**自己的入口**，不依赖宿主预设状态、不占他人槽位。
 *
 * ── 为什么是 `shell.overlay` ────────────────────────────────────────────
 *   · 它是 `kind: "list"` / `scope: "root"`（证据：`dsh-client-ui-layout/lib/client.js`
 *     的槽声明 + `AppFrame` 里 `renderSlot("shell.overlay", {})` **无条件渲染**）
 *     ⇒ **可叠加**（list 加条目不影响别人）、**空态也在**；
 *   · ⚠ 另一个候选 `conversation.hero.options` 虽是 list，但空态被
 *     `sessionId === void 0 ? null` **整块挡掉** ⇒ **新会话空态看不到**；
 *   · ⚠ 宿主 `commandUi`（slash 命令）**需要已有会话**才能唤起（`ui.run(session)`）
 *     ⇒ 空态用不上。
 *   ⇒ `shell.overlay` 是**唯一**满足"空态可见 + 可叠加 + 不抢他人槽"的位置。
 *
 * ── 不遮挡、可访问的约束（⚠ 逐条落实，⛔ 缺一条就是"假入口"）─────────────
 *   · **不遮挡导航**：只占右下角一小块、**默认 `pointer-events: none` 的容器里
 *     放一个 `pointer-events: auto` 的按钮**（点空白处能穿透到下面的界面）；
 *   · **可访问**：真 `<button type="button">`、有可读 `aria-label`、**Tab 可达**、
 *     弹窗用 `role="dialog"` + `aria-modal` + 标题关联；
 *   · **不自动弹窗**：只有**点了按钮**才打开 ⇒ 普通预设、其他流程一概不受影响。
 */
export function HobCreateCommandEntry(props: { state: DialogState }): any {
  useLocaleSignal()
  const isOpen = React.useSyncExternalStore(props.state.subscribe, props.state.isOpen, props.state.isOpen)
  /**
   * ══════════════════════════════════════════════════════════════════════
   * ⚠ **2026-10-29（包 BZ · `CHG-185`）：不再常驻。**
   * ══════════════════════════════════════════════════════════════════════
   *
   * ── 为什么改（`CHG-184` §二 的实测结论）────────────────────────────────
   *   它原先裸挂在一个绝对定位的 `div` 里、**无条件渲染** ⇒ 用户在任何页面、
   *   任何会话下都看见它。而 `shell.overlay` **没有布局语义**（根级浮层 list 槽），
   *   "右下角"是**本仓自己选的坐标**，不是宿主安排的 —— 也就是说
   *   **常驻是本仓没写条件，⛔ 不是宿主强制。**
   *
   * ── 现在什么时候出现 ──────────────────────────────────────────────────
   *   **只在弹窗已打开时**（那一下由发送时闸门或未选横幅触发）。
   *   ⚠ 选的是「条件化」而**不是「撤掉」**。
   *
   * ── ⚠⚠ O-20（2026-11-11）：它**不是**「打开弹窗」的入口 ────────────────
   *   本组件唯一的 `state.open()` 调用在 `if (!isOpen) return null` **之后**
   *   ⇒ 弹窗关着时它**根本不存在**，因此**无法**充当「手动打开弹窗」的入口。
   *   旧注释写「留它当**兜底入口**」—— 那是**错的**（自相矛盾：兜底入口必须先于弹窗存在）。
   *
   *   ⇒ 准确说法：**本入口是「弹窗打开时的可见锚点」，不提供手动打开能力。**
   *     · 想**新建** Hob 会话：走宿主自己的入口（`createDialogState().open()` 的宿主侧调用方）。
   *     · 想给**已有会话补选档位**：走 `hob-unselected-gate.tsx` 的横幅
   *       （它在弹窗**关着**时也渲染，那才是真正的兜底入口）。
   *
   *   ⚠ 为什么保留它而不删：弹窗开着时用户需要看到「这个入口在这儿」，
   *     否则会以为功能消失了。⛔ 但**不要**再把它描述成「能打开弹窗」。
   *   ⚠ 机检见 `check:hob-create-dom` 的 **S-14**（断言「弹窗关着时横幅入口在、本锚点不在」）。
   *
   * ⚠ 判据只用 `state.isOpen`（弹窗自己的开关），⛔ 不新读会话/策略
   *   —— 那会让这个纯展示组件多一条会漂的判据。
   */
  if (!isOpen) return null
  return h('div', {
    className: 'dsh-hob-entryDock',
    // ⚠ 容器不接指针事件 ⇒ **不遮挡**下面界面；只有按钮自己接
    style: { pointerEvents: 'none' },
  }, h('button', {
    type: 'button',
    className: 'dsh-hob-entryBtn',
    // ⚠ 按钮接指针事件（容器是 none）
    style: { pointerEvents: 'auto' },
    /** ⚠ **O-22**：词典里早有 `entry.aria`（中英双语），⛔ 不硬编码中文。 */
    'aria-label': d('entry.aria'),
    'aria-haspopup': 'dialog',
    'aria-expanded': isOpen ? 'true' : 'false',
    onClick: () => props.state.open(),
  }, d('entry.label')))
}

/**
 * 跨槽共享的"弹窗开关"状态（⚠ 最小实现：一个值 + 一组订阅者）。
 *
 * ── 为什么不用 React context ═══════════════════════════════════════
 *   hero 槽与 overlay 槽是**两个独立的注册点**，宿主分别渲染它们
 *   （`renderSlot('conversation.hero.agentPreset')` 与 `renderSlot('shell.overlay')`，
 *    见 `dsh-client-ui-conversation/lib/client.js:17812` 与
 *   `dsh-client-ui-layout/lib/client.js:313`）⇒ **没有共同的 React 父组件**
 *   可以挂 context。⇒ 用模块内订阅（`useSyncExternalStore` 的标准用法）。
 *   ⚠ 这也让"取消"真的能关掉弹窗（⛔ 不是永不刷新的 ref 快照）。
 */
export interface DialogState {
  /**
   * ⚠⚠ **没有 `preset()` / `setPreset()`**（2026-10-22 删）。
   *
   * ── 为什么删 ──────────────────────────────────────────────────────
   *   上一版用它们做"只有当前预设是 Hob 才显示入口"的 gating。但它们
   *   **没有任何可信来源**：`createDialogState()` 不传实参 ⇒ 初值 `undefined`；
   *   全 client **零处调用 `setPreset(`** ⇒ 它永远停在 `undefined`
   *   ⇒ 入口**永不渲染**（这是上一版"UI 已完成"报告里最大的错）。
   *   ⚠ 宿主也**没有**"当前预设"可读服务 ⇒ 这个 gating **无法**接真值。
   *   ⇒ 现在的入口是**插件自己的命令**（`shell.overlay` 里的按钮），
   *     **不需要**知道宿主当前选的是哪个预设，也就**不需要**这两个死状态。
   */
  isOpen(): boolean
  open(): void
  /**
   * ⚠⚠ **为某个已存在的会话打开选档窗**（2026-10-22 第 4 轮 · 任务书 §一 E 项）。
   *
   * ── 它与 `open()` 的区别（⛔ 别混用）──────────────────────────────────
   *   · `open()`               ⇒ **新建**模式：确认后会 `issue` → `create`，**多出一个会话**；
   *   · `openForSession(id)`   ⇒ **已有会话**模式：确认后只写两项，**零 create**。
   *   ⇒ 自动弹窗（宿主原生新建的 Hob 会话）**必须**用后者：
   *     那个会话**已经存在**了，用 `open()` 会让用户确认后平白多一个重复会话。
   *
   * ⚠ `sessionId` 为空/空白 ⇒ **忽略**（⛔ 不开一个没有目标的窗 —— 那会退回新建语义）。
   * @param sessionId - 要选档位的**已存在**会话 id。
   */
  openForSession(sessionId: string): void
  /** 当前要选档位的**已存在**会话（⚠ 新建模式下为 `undefined`）。 */
  target(): string | undefined
  close(): void
  /**
   * ⚠ **成功后的可见结果**（2026-10-22 新增）：最近一次创建成功的 sessionId。
   *   宿主侧读它给出**可点击的准确入口**（`HobCreatedNoticeLive`），
   *   ⛔ 不是"悄悄把弹窗关掉"。
   */
  created(): string | undefined
  /**
   * ⚠⚠ **打开弹窗时被聚焦的那个元素**（2026-10-23 · 修 D5）。
   *
   * ── 修的是什么 ────────────────────────────────────────────────────
   *   文件头 `③ 关闭后焦点回归到打开它的那个按钮（由 onClose 后的 effect 负责）`
   *   是**逐字承诺**，但**零实现**（全文件 `focus` 此前只出现在初始焦点那 1 处）。
   *   ⇒ 键盘用户关窗后焦点落回 `BODY`，要从头 Tab 一遍才能回到原按钮。
   *   ⇒ 现在：打开时记下 `document.activeElement`，关闭后由 overlay 的 effect 还原。
   *   ⚠ 记的是**元素本身**而不是"再查一次"：宿主可能在关窗期间改过焦点。
   */
  opener(): any
  /** 记录一次成功创建（⚠ 只改状态，不发请求）。 */
  markCreated(sessionId: string): void
  /** 清掉成功结果（⚠ 用户已经通过结果条进入会话之后调）。 */
  clearCreated(): void
  subscribe(fn: () => void): () => void
}

/** 造一份弹窗状态（⚠ 每次 `apply` 一份，⛔ 全局单例 —— 热重载时跟着本 fiber 走）。 */
export function createDialogState(): DialogState {
  let open = false
  /** ⚠ 最近一次**成功**创建出来的 sessionId（用于给用户可见、可点的准确入口）。 */
  let created: string | undefined
  /**
   * ⚠ 本次弹窗要选档位的**已存在**会话（`undefined` = 新建模式）。
   *   ⚠ 它是**模式开关**：`HobCreateOverlayLive` 读它决定给弹窗传不传 `targetSessionId`。
   */
  let target: string | undefined
  /** ⚠ 打开弹窗时被聚焦的元素（关闭后把焦点还回去；见 `opener()` 的注释）。 */
  let openerEl: any = null
  const rememberOpener = () => {
    try {
      const doc = (globalThis as any).document
      const el = doc?.activeElement
      openerEl = el?.tagName === 'BODY' ? null : (el ?? null)
    } catch { openerEl = null }
  }
  const subs = new Set<() => void>()
  const emit = () => { for (const f of subs) { try { f() } catch { /* 订阅者出错不影响别人 */ } } }
  return {
    isOpen: () => open,
    // ⚠ **新建模式必须清掉 target**：否则上一次"为已有会话选档"的目标会漏到新建模式里，
    //   导致用户点"新建"却写到了另一个会话上（那是数据串台，比不弹严重）。
    open: () => {
      const changed = !open || target !== undefined
      /**
       * ⚠ 只在**关→开**这一次记 opener（2026-10-23 自审修正）：
       *   弹窗已开着时再调 `open()`（例如换模式重开）**不能**重记 —— 那一刻
       *   `document.activeElement` 已经是**弹窗内部**的元素，记下来就会把
       *   焦点"归还"到弹窗里一个已卸载的节点上 ⇒ 焦点丢到 BODY。
       */
      if (!open) rememberOpener()
      open = true
      target = undefined
      if (changed) emit()
    },
    openForSession: (sessionId) => {
      const id = typeof sessionId === 'string' ? sessionId.trim() : ''
      // ⚠ 空 id ⇒ 忽略（⛔ 不许退回新建语义 —— 那会平白多建一个会话）
      if (id === '') return
      const changed = !open || target !== id
      if (!open) rememberOpener()   // ⚠ 同上：只在关→开时记，⛔ 不在弹窗内重记
      open = true
      target = id
      if (changed) emit()
    },
    target: () => target,
    opener: () => openerEl,
    // ⚠ 关闭**只改状态**：⛔ 不发任何请求、⛔ 不创建任何东西（取消语义）
    //   ⚠ 同时清 target：下次打开必须是**显式**决定模式，⛔ 不沿用上次的目标。
    close: () => { if (open) { open = false; target = undefined; emit() } },
    created: () => created,
    markCreated: (sessionId) => { if (sessionId !== '') { created = sessionId; emit() } },
    clearCreated: () => { if (created !== undefined) { created = undefined; emit() } },
    subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn) } },
  }
}

/**
 * **成功后的可见结果条**（2026-10-22）：显示"已创建会话 <id>" + 一个**可点**入口。
 *
 * ⚠ 为什么需要它：任务书要求"成功后导航到新会话或给**可点击的准确入口**，
 *   不能只悄悄关闭弹窗"。宿主侧没有注入式的"切到某会话"API（`uiWorkspace.startSession`
 *   是**创建**，不是**跳转**）⇒ 这里给**可见 + 可聚焦**的会话 id 与一句可操作说明，
 *   ⛔ 不假装已经跳转。
 */
export function HobCreatedNotice(props: {
  state: DialogState
  /**
   * **真实导航**（⚠ 必填语义：生产注册时由 `index.ts` 接 `uiWorkspace.openSession`）。
   *
   * ── 2026-10-22 订正（Hob 指出上一版的假入口）──────────────────────────
   *   上一版这里在 `onNavigate` 缺席时渲染一句"（可在会话列表里按此 id 找到它）"，
   *   ⛔ 那是**假入口**：空白会话在收到第一条消息之前被宿主**有意**从会话列表过滤
   *   （本仓 `bus.ts` 同口径），⇒ 用户**按 id 也找不到**。
   *   ⇒ 现在：`onNavigate` 缺席时**不渲染任何"能打开"的暗示**，
   *     而是**如实说它现在看不见**（并说明怎么让它出现）。
   *   ⚠ 生产路径（`index.ts`）**必须**注入 `onNavigate`；`check:hob-create-dom`
   *     有一条断言钉住"生产注册里有 handler"。
   */
  onNavigate?: (sessionId: string) => void
}): any {
  useLocaleSignal()
  const created = React.useSyncExternalStore(props.state.subscribe, props.state.created, props.state.created)
  if (created === undefined) return null
  return h('div', {
    className: 'dsh-hob-created',
    role: 'status',
    tabIndex: 0,
    'aria-label': d('created.aria', { id: created }),
  },
  h('span', { className: 'dsh-hob-createdText' }, d('created.prefix')),
  h('code', { className: 'dsh-hob-createdId' }, created),
  props.onNavigate === undefined
    /**
     * ⚠ **没有导航能力时的诚实文案**（⛔ 不说"去列表按 id 找"）：
     *   空白会话不可见是宿主的既定行为 ⇒ 唯一让它变成可见的办法是
     *   **给它投第一条消息**（那需要一个受支持的入口，见 `hintNoNav`）。
     */
    /** ⚠ **O-22**：词典里早有 `created.noNav`（中英双语），⛔ 不硬编码中文。 */
    ? h('span', { className: 'dsh-hob-createdHint' }, d('created.noNav'))
    : h('button', {
      type: 'button',
      className: 'dsh-hob-btn dsh-hob-btnPrimary',
      onClick: () => props.onNavigate?.(created),
    }, d('created.open')))
}

/**
 * **生产用的成功结果条**（2026-10-22 新增）：把 `DialogState` 与**真实导航**接起来。
 *
 * ⚠ 为什么单独一个组件：`state` 要订阅、`openSession` 要注入 —— 两者都在
 *   `apply()` 那个前端作用域里，包一层最省事且便于 DOM 测试注入假实现。
 * ⚠ 传进来的 `openSession` **必须**是真实现（`uiWorkspace.openSession`）；
 *   本组件不判断它真假，由 `index.ts` 负责接对（`check:hob-create-dom` 钉住）。
 */
export function HobCreatedNoticeLive(props: {
  state: DialogState
  openSession: (sessionId: string) => void
}): any {
  return h(HobCreatedNotice, {
    state: props.state,
    onNavigate: (sessionId: string) => {
      /**
       * ⚠ 先**收起结果条**再导航：否则用户进到会话里还会看到那条"已创建"提示。
       *   ⚠ 只清 `created`，⛔ 不动弹窗状态（弹窗此时已关）。
       */
      props.state.clearCreated()
      props.openSession(sessionId)
    },
  })
}

/**
 * overlay 槽的**活组件**：订阅状态，打开时渲染弹窗。
 * ⚠ 关闭时渲染 `null`（⛔ 不留空壳 DOM）。
 */
export function HobCreateOverlayLive(props: {
  state: DialogState
  call?: HobCreateDialogProps['call']
  onCreated?: (sessionId: string) => void
}): any {
  const isOpen = React.useSyncExternalStore(props.state.subscribe, props.state.isOpen, props.state.isOpen)
  /**
   * ⚠ **目标会话也要订阅**（2026-10-22 第 4 轮）：
   *   它决定弹窗是"新建"还是"为已有会话选档位" —— 两者行为完全不同（零 create vs 建会话），
   *   所以它必须是 `useSyncExternalStore` 的一员（⛔ 不许在渲染里直接读可变闭包 ——
   *   那样状态变了组件不重渲染，用户会看到一个"标题写着新建"但其实在写已有会话的窗）。
   */
  const target = React.useSyncExternalStore(props.state.subscribe, props.state.target, props.state.target)
  /**
   * ⚠⚠ **关闭后焦点归还**（2026-10-23 · 修 D5，即文件头 `③` 那条此前只有注释的承诺）。
   *
   *   ⚠ 为什么放在 overlay 而不是弹窗内部：弹窗关掉时它自己已经卸载了，
   *     "卸载之后再聚焦"只能由**活着的父级**做。
   *   ⚠ 只在 `isOpen` 由 true → false 时还焦点（`wasOpen` 闸门）：
   *     ⛔ 不许在首次挂载（本来就是关着）时抢用户焦点。
   */
  const wasOpenRef = React.useRef(false)
  React.useEffect(() => {
    if (isOpen) { wasOpenRef.current = true; return }
    if (!wasOpenRef.current) return
    wasOpenRef.current = false
    const el = props.state.opener()
    if (el === null || el === undefined) return
    try { el.focus?.() } catch { /* 环境无 focus ⇒ 忽略 */ }
  }, [isOpen, props.state])
  if (!isOpen) return null
  return h(HobCreateDialog, {
    ...(props.call === undefined ? {} : { call: props.call }),
    ...(target === undefined ? {} : { targetSessionId: target }),
    onClose: () => props.state.close(),
    onCreated: (sid: string) => {
      /**
       * ⚠ 已有会话模式只是“写档位”，⛔ 没有创建任何会话。
       * 旧实现在这里无条件 markCreated ⇒ 界面误报“已创建 Hob 会话”并多出一个
       * “打开该会话”入口。新建模式才写创建结果条；已有会话模式只关窗并广播已选。
       */
      if (target === undefined) props.state.markCreated(sid)
      props.state.close()
      props.onCreated?.(sid)
    },
  })
}
