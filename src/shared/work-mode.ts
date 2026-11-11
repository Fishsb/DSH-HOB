/**
 * 「Hob 推进项目的工作方式」—— **三档的唯一事实源**（2026-10-19 · `UD-97` 推进优先）。
 *
 * ── 它管什么（⚠ 一句话，别扩大）────────────────────────────────────────
 *   **Hob 怎么拆活、拆成几路** —— ⛔ **不改权限档位**、⛔ **不改谁能写什么**、
 *   ⛔ **不改验收口径**。它与 `permission`（能读什么）是**两个正交的旋钮**：
 *   档位管「看得见什么」，本项管「**把活拆成几份、交给几个会话**」。
 *
 * ── 三档（显示名给人看 · 配置值是内部标识，⛔ 不进对话文本）─────────────
 *   | 配置值 | 显示名 | 含义 |
 *   |---|---|---|
 *   | `auto`   | 自动   | 监督者按任务判**最少必要**路数；单轨要给原因 |
 *   | `single` | 单会话 | **恒定一路**，运行时拒绝第二条活动执行轨 |
 *   | `multi`  | 多会话 | **显式扇出**；存在独立候选必须拆轨，单轨要给候选证据 |
 *
 * ── ⚠⚠ 一处必须写死的红线（派单方判定，⛔ 不是用户加的）──────────────────
 *   **「多会话」的"无限制"只到"费用与时间不设上限"这一层，⛔ 不解除任何既有红线** ——
 *   ⛔ 不许改看板 · ⛔ 不许碰别人项目的卡 · ⛔ 不许放宽任何判据 ·
 *   ⛔ 不许把"多"理解成"每个会话都能干任意事"。
 *
 *   ⚠ **档位今天有两类消费者**：
 *     ① 给模型看的口径（{@link workModeInstruction}，决定它怎么规划）；
 *     ② 运行时的策略表（{@link workModePolicy}，决定计划校验与派发门禁）。
 *   ⇒ 只改文案不改策略表 = 模型说要拆、运行时却按同一套规则放行/拒绝，
 *     那仍是「空旋钮」；两处必须同源、且由机检钉住。
 *   ⚠ 红线本身仍是**文本约束**（它不改变权限机制），所以红线继续只放在口径与界面里；
 *     但“拆几路”已经不是纯文本：单会话硬限制、多会话候选必拆都由策略表执行。
 *
 * ── ⚠ 产品口径：用户已裁定「全自动」= (乙)（`UD-149`）────────────────────
 *   「自动」档有多自动，曾有两种读法：(甲) 只自动选路（**动手前仍先跟用户报一句**）；
 *   (乙) 选路 + 派活都自动（判完**直接派出去**，用户在收到结果时看见）。
 *   ⇒ ⚠ **用户裁定为 (乙)「全自动」**（原话只有三个字：「全自动」）。
 *   ⇒ 落到代码上：`auto` 档**不再要求"动手前先报"**，而是**判完即派**，
 *     且**派完之后**必须在给用户的回复里说清三件（见 {@link workModeInstruction} 的 `auto` 分支）：
 *     **拆成了几路 · 每路给了谁 · 哪一路先回来才能定下一步**。
 *   ⚠ **"不再先报"≠"不报"**：只是把"说清路数"这件事从**派之前**挪到**派之后**
 *     （`UD-149` §二）；⛔ 不许把它读成"闷头派、用户看不见"。
 *   ⚠ **另两档（单会话 / 多会话）的口径 ⛔ 不动** —— 用户只裁了「自动」档。
 *   ⚠ **档名不改**：仍是 自动 / 单会话 / 多会话（`UD-149` §三：档名属用户已裁的命名）。
 *
 * ── 为什么单独一个文件（而不是写在 `config.ts` 里）──────────────────────
 *   与 `planning-preset.ts` 同一条理由：**两个编译单元**都要它 ——
 *   · host 半边（`src/config.ts` 的收口函数 + `src/preset/tools.ts` 的注入）经 tsc 编译；
 *   · client 半边（设置面板的控件与词典）经 tsdown 打包。
 *   ⛔ 三档的**取值与顺序只许在这里写一次**（防漂移）；机检钉住这一点。
 */

/**
 * 「工作方式」三档的**配置值**（内部标识，⛔ **不进任何用户可见文本**）。
 *
 * ⚠ 顺序即**面板渲染顺序**（= 从"最少干预"到"最多并行"，与语义强弱同向）。
 * ⚠ ⛔ 不许在这里加第四档而不改 `config.ts` 的 schema（`z.union` 的 const 列表
 *   必须与它逐值相等 —— `check:config` 的 G 组双向比对钉住）。
 */
export const WORK_MODE_VALUES = ['auto', 'single', 'multi'] as const

/** 「工作方式」的档位类型。 */
export type WorkMode = (typeof WORK_MODE_VALUES)[number]

/** 缺省档 = `auto`（与 schema 的 `.default('auto')` 一致）。 */
export const DEFAULT_WORK_MODE: WorkMode = 'auto'

/**
 * 档位的**显示名**（给人看的，⛔ 不是配置值）。
 *
 * ⚠ 只有**一处**（面板词典与 schema `.description()` 都从这里派生用途上的同一组词）：
 *   ⛔ 别在别处再抄一份中文（改一处漏一处 = 界面与配置说明两套说法）。
 * ⚠ 显示名里**不含配置值**（⛔ 不写 `auto` / `single` / `multi` 的原文）：
 *   配置值是内部标识，用户看到的是「自动 / 单会话 / 多会话」。
 */
export const WORK_MODE_DISPLAY: Readonly<Record<WorkMode, string>> = {
  auto: '自动',
  single: '单会话',
  multi: '多会话',
}

/**
 * 档位的**英文名**（⚠ 与 {@link WORK_MODE_DISPLAY} 是同一组概念的两种语言，⛔ 不是第二套取值）。
 *
 * ── 为什么要单列一份（⛔ 不是复制中文）──────────────────────────────────
 *   · 给**模型看**的口径正文是英文契约（与本预设 `prefix` 全文一致）——
 *     往里塞中文显示名会让英文契约里出现中英混杂的一段，而那段话是给模型当**规则**读的；
 *   · 面板的英文词典（`PANEL_EN` 的 `wm.mode.*`）也要这一组词 ⇒ 三处（模型面 / 面板英文 /
 *     面板中文）各自的语言来源都收在这里，⛔ 不在别处再写一份英文。
 *   ⚠ **同源由机检钉住**（`check:config` 的 G-3：面板英文词典必须与这里逐字相等，
 *     与中文词典对 `WORK_MODE_DISPLAY` 的那条判据对称）。
 */
export const WORK_MODE_LABEL_EN: Readonly<Record<WorkMode, string>> = {
  auto: 'Automatic',
  single: 'One session',
  multi: 'Many sessions',
}

/**
 * 三档的**运行时策略表**（唯一事实源）。
 *
 * ⚠ 这张表只描述“怎么拆、允不允许并行、单轨需要什么证据”，
 *   ⛔ 不改权限、⛔ 不改验收口径、⛔ 不承诺并行写。
 * ⚠ `validateWorkPlan()` / `dispatchPlan()` / `dispatch()` / 面板文案都必须读它，
 *   ⛔ 不许在各处再写一套 `if (mode === ...)`。
 */
export interface WorkModePolicy {
  /** 拓扑：固定单轨 / 监督者动态判路 / 显式扇出。 */
  topology: 'single' | 'adaptive' | 'fanout'
  /** 同一 owner 同时允许的活动执行轨上限。 */
  maxActiveTracks: number
  /** 是否允许只读轨并行。 */
  allowParallelRead: boolean
  /** 是否允许写轨并行。⚠ 当前恒为 false：没有 worktree 隔离。 */
  allowParallelWrite: false
  /** 是否接受单轨原因字段。 */
  acceptsSingleTrackReason: boolean
  /** 单轨证据强度：无 / 基本（same-file、strict-order）/ 候选表。 */
  singleTrackEvidence: 'none' | 'basic' | 'candidates'
  /** 存在独立候选时是否必须拆轨。 */
  mustSplitIndependentCandidates: boolean
  /** 派完后是否要求报告路数、去向与下一门槛。 */
  requiresPostDispatchReport: boolean
}

/**
 * 读取某档的运行时策略。
 *
 * @param mode - 当前档位（调用方须现读，⛔ 不缓存）。
 */
export function workModePolicy(mode: WorkMode): WorkModePolicy {
  if (mode === 'single') {
    return {
      topology: 'single',
      maxActiveTracks: 1,
      allowParallelRead: false,
      allowParallelWrite: false,
      acceptsSingleTrackReason: false,
      singleTrackEvidence: 'none',
      mustSplitIndependentCandidates: false,
      requiresPostDispatchReport: false,
    }
  }
  if (mode === 'multi') {
    return {
      topology: 'fanout',
      maxActiveTracks: Number.POSITIVE_INFINITY,
      allowParallelRead: true,
      allowParallelWrite: false,
      acceptsSingleTrackReason: true,
      singleTrackEvidence: 'candidates',
      mustSplitIndependentCandidates: true,
      requiresPostDispatchReport: false,
    }
  }
  return {
    topology: 'adaptive',
    maxActiveTracks: Number.POSITIVE_INFINITY,
    allowParallelRead: true,
    allowParallelWrite: false,
    acceptsSingleTrackReason: true,
    singleTrackEvidence: 'basic',
    mustSplitIndependentCandidates: false,
    requiresPostDispatchReport: true,
  }
}

/**
 * 给人读的**一句策略摘要**（工具返回值用；⚠ 不是第二套语义）。
 *
 * ⚠ 只从 {@link workModePolicy} 派生，⛔ 不在这里另写一份档位判断：
 *   否则“工具说允许并行、校验器却拒绝”这种漂移无法被机检发现。
 */
export function workModePolicySummary(mode: WorkMode): string {
  const policy = workModePolicy(mode)
  if (policy.topology === 'single') return '单会话 · 单轨硬限制（第二条活动轨会被拒绝）'
  if (policy.topology === 'fanout') {
    return '多会话 · 独立候选必须拆轨；读轨可并行，写轨串行；单轨需候选证据'
  }
  return '自动 · 判最少必要轨数；单轨需原因；读轨可并行，写轨串行'
}

/**
 * ⚠⚠ **那条红线**（派单方判定；⛔ **逐字**，改一个字都要先回去问）──────────────
 *
 * 用途：**注入给 Hob 的那段口径里必须有它**，且设置面板上**紧邻**控件也要有它
 * （用户看不到就等于没有 —— `PROJECT.md` §5.3）。
 * ⚠ 位置选择与理由见 {@link WORK_MODE_SECTIONS} 上方注释。
 *
 * ── ⚠ 2026-10-19 第 3 轮（`UD-149`）扩写：**两段边界并列** ────────────────
 *   ① 「多会话」的"无限制"只到"费用与时间不设上限"；
 *   ② **「自动」档的「全自动」只到"不再先问用户就派出去"** —— 它⛔ **不解除任何红线**、
 *      ⛔ **不越过权限档位**、⛔ 不许读成"每个会话能干任意事"。
 *   ⚠ **为什么并列而不各写一份**：两条的**适用面都是三档共同的**
 *     （单会话档照样不许碰别人的卡；多会话档也不因为不自动就放宽判据）——
 *     各写一份必然漂移（本项目已多次踩「一处口径抄三份」）。
 *   ⚠ 名字里带「全」的那一档**最容易**被读成"权限更大"（与「完全权限」同族，`R-26`），
 *     所以界面上**紧邻控件**就有它，⛔ 不能只写在给模型的口径里。
 */
export const WORK_MODE_RED_LINE = '「多会话」的"无限制"只到"费用与时间不设上限"这一层，'
  + '不解除任何既有红线 —— 不许改看板、不许碰别人项目的卡、不许放宽任何判据、'
  + '不许把"多"理解成"每个会话都能干任意事"。'
  + '「自动」档的「全自动」同样只到"不再先问用户就派出去"这一层：'
  + '它不解除任何既有红线、不越过权限档位，也不等于"每个会话能干任意事"。'

/**
 * 三档各自**注入给模型**的口径正文（⚠ **本项的唯一真实消费者**）。
 *
 * ── 为什么注入点选 `system-prompt` 的一个 section（而不是新工具 / 新工具参数）──
 *   ① **它不是一次调用，而是一直生效的规划口径** —— 做成工具参数只有"被调用那一次"
 *      才生效，而"Hob 拆几路"发生在**它每次规划的时候**，与工具调用无关；
 *   ② 本项目的「约束 ⑥」（`.hob/` 与账本都记着）：⚠ **Hob 的工具面一个都不多** ——
 *      每多一个工具名都占白名单一个位置、也稀释模型注意力；
 *   ③ 宿主已提供**官方**的 scoped section 机制（`ctx.systemPrompt.section({...})`，
 *      注册在**预设作用域** ⇒ 只有本预设受影响，宿主自带的 minimal/standard 零影响），
 *      与 `src/preset/tools.ts` 的装配期过滤**同一个作用域**（实测同一 ctx）。
 *
 * ── ⚠ 为什么要用**函数式 text**（而不是注册时算一次字符串）──────────────
 *   档位带 `.volatile()` ⇒ 宿主写入走 volatile-only 通道、**不重挂载**
 *   ⇒ 注册时若把正文算成常量，用户改完档位**已开的会话仍按旧档**走到重挂载为止
 *   （正是「设置页改了但行为没变」那个静默失败）。
 *   ⇒ `text` 用 `(context) => …`，**每次装配现读档位**（与 `filterModelToolList`
 *   的 `allowFor()` 同一条纪律：⛔ 不许在装配外做快照）。
 *
 * @param mode - 当前档位（调用方须**现读**，见 `src/config.ts` 的 `workMode()`）。
 * @returns 该档的口径正文（Markdown 段落）。
 *
 * ⚠ **订正说明**（2026-10-21 第 333 轮 · **丁-8**）：原句写「⛔ 保证长度为 0 的唯一情形是
 *   非法档位」—— ⚠ **那个情形不存在**：本函数三个出口（`single` / `multi` / 兜底 `auto`）
 *   全部返回非空正文，而 `WorkMode` 是**闭合联合类型** ⇒ 编译期就不存在"非法档位"这种入参。
 *   ⚠ 更关键的是：那个兜底分支**不是"报错出口"**，而是「`auto` = 缺省档」这一条**正常路径**
 *   （见下面 `// auto（缺省）` 那段）⇒ 把它说成"非法档位"会把**默认行为**读成**异常**。
 *   ⇒ 现在只陈述事实：**本函数不返回空串**（实测三个分支的 `.join('\n')` 都非空）。
 */
export function workModeInstruction(mode: WorkMode): string {
  const head = [
    '## How work is split',
    '',
    // ⚠⚠ **显式作废声明**（2026-10-19 第 3 轮 · `UD-149` 裁定 ②）。
    //   为什么必须有：本通路是**快照替换语义**，但宿主是"新快照顶旧"而**不是编辑历史**
    //   ⇒ 用户改过档位后，会话史里**旧的同名段落仍然在**（只是被后来的快照压住）。
    //   模型读到的是一串消息，旧段落照样在它的视野里 —— 两段并同时，它可能照旧那段走。
    //   ⇒ 在**正文里**写明"以本段为准、忽略此前任何同名段落"，⛔ 纯文本、⛔ 不加机制。
    '**This section supersedes any earlier snapshot of the same section.** If a previous message',
    'in this conversation also carries a "How work is split" section, ignore it entirely: only the',
    'one you are reading now applies. The same holds for any earlier wording of what this setting',
    'does or does not relax.',
    '',
    `The user has set how this project\'s work should be split into sessions. The current setting is`,
    `**${WORK_MODE_LABEL_EN[mode]}**. Apply it every time you turn a need into tasks.`,
    '',
  ]

  if (mode === 'single') {
    return [
      ...head,
      '**One track, always.** Whatever the task looks like, plan it as a single thread carried by',
      'one developer session, one directive at a time. Do not split it into parallel tracks even',
      'when it clearly could be split — that possibility is exactly what this setting overrides.',
      'If the work is large, sequence it in that one thread (stage by stage), rather than opening',
      'more sessions. Reuse the same session across stages while the thread is still the same work.',
      'The runtime enforces this as a hard limit: a second independent execution track is refused.',
      '',
    ].join('\n')
  }

  if (mode === 'multi') {
    return [
      ...head,
      '**Split as finely as the work honestly allows, and run as many tracks as that gives.**',
      'Cost and time are explicitly not a constraint here: do not merge two pieces of work into',
      'one track merely to save a session or a round trip. Before splitting, work out which pieces',
      'are genuinely independent — nothing shared, nothing ordered, no piece needing the other\'s',
      'result — and give each such piece its own session and its own directive. Pieces that are',
      'NOT independent still belong together: splitting them would make them wait on each other',
      'and produce rework, which is not finer work, only more of it.',
      '',
      'Then combine them: name what runs beside what, and what must come back before the next',
      'step can be taken. Favour acceptance clarity over track count — a track whose result you',
      'cannot judge on its own is split too finely. If only one track is legitimate, give one of',
      'these reasons: same-file, shared-contract, strict-order, single-acceptance-unit, or',
      'insufficient-independent-scope — and supply candidatePieces in singleTrackEvidence:',
      'the candidate pieces you considered, each with pieceId, scopePaths and acceptance.',
      'The runtime checks those candidates for a genuinely independent pair (disjoint scope,',
      'no dependency, different acceptance). If one exists, a single track is refused and you',
      'must dispatch the pieces as separate tracks. Overlapping write scope or a dependency',
      'cycle is still refused before anything is dispatched.',
      '',
    ].join('\n')
  }

  // auto（缺省）—— ⚠ 用户裁定「全自动」= (乙)：判完**直接派**，派完**必须报**（`UD-149`）
  return [
    ...head,
    '**Decide for yourself how many tracks this task needs** — one when the work is one thread,',
    'several when it genuinely divides — and let the count follow the task rather than any fixed',
    'target. Settle first what the pieces are and in what order they depend on each other, then',
    'choose the split that lets each piece be judged on its own.',
    '',
    '**Within the already agreed requirement and plan, judge and dispatch.** This setting means',
    'fully automatic for work that is already authorised: do not ask again merely because the',
    'next step splits into tracks. A new requirement, a change of scope, an irreversible action,',
    'or extra budget still needs the user first. For authorised work, record your split and',
    'hand it over; for unagreed work, negotiate against the current plan first. The runtime',
    'records your chosen track count and rationale, and refuses a silent collapse into one track',
    'when the plan claims more.',
    '',
    '**When you do hand it over under this setting, the report is not optional.** Say three',
    'things in your reply to the user: how many tracks you split the work into, who each track',
    'was given to, and which one has to come back before the next step can be decided. "No',
    'longer asks first" is not "does not say": a hand-over the user cannot see is one they',
    'cannot steer.',
    '',
  ].join('\n')
}

/**
 * ⚠ **红线那一段的正文**（与 {@link workModeInstruction} **分开**给调用方拼）。
 *
 * ── 为什么单列而不并进每一档的正文 ────────────────────────────────────
 *   红线的**适用面是三档共同的**（不是"只有多会话才要守"）：单会话档照样
 *   不许碰别人的卡、不许放宽判据。并进各档正文就会变成三份各写一遍
 *   （→ 必然漂移，本项目已多次踩过「一处口径抄三份」）。
 *   ⇒ 结构上是「**档位正文 + 恒定红线**」两段拼接，且**红线恒定**这一点本身
 *   可机检（见 `scripts/check-config-face.mjs` 的 G 组）。
 *
 * ⚠ 措辞是**给模型看的英文契约**（与本预设 `prefix` 全文一致）；
 *   中文原文留在 `src/shared/work-mode.ts` 的 {@link WORK_MODE_RED_LINE} 与面板词典里。
 */
export function workModeRedLine(): string {
  return [
    '## What this setting does NOT relax',
    '',
    '**More sessions never means more power.** "Cost and time are not a constraint" is the whole',
    'of what the multi-session setting lifts, and it lifts nothing else. No setting here changes',
    'any existing rule: you still do not change the board, you still do not touch another',
    'project\'s cards, no acceptance criterion is relaxed, and "more" never means "each session may',
    'do whatever it likes". A session created for a track has exactly the reach its own preset and',
    'permission level give it — creating more of them is not a way around either.',
    '',
    '**Fully automatic never means fully authorised.** Handing over without asking first lifts',
    'exactly one thing: the question ahead of the hand-over. It is not permission, and it is not',
    'a wider reach for anyone. No rule above is relaxed by it, and the permission level of this',
    'session still bounds what this session may ever do — a split into more tracks is never a way',
    'around either of them.',
    '',
  ].join('\n')
}
