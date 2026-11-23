/**
 * 「助手」**发给模型的**工具清单 —— **装配期白名单**（**档1 的显式名字表**（⚠ 名数以 `check:presets` 的判定为准）；
 *   三档的名字集见 {@link PERMISSION_TIERS}，**逐档名数以 `check:presets` 的判定为准**）。
 *
 * ── 为什么是这些 ────────────────────────────────────────────────────
 * 「助手」只干这几件事：**读项目文档 / 读工作区文件 / 写自己的账本**、
 * **查资料**、**打开网页取正文**、**只读查询看板与圆桌**、**安排自己的定时提醒**、
 * **在只有用户能定时向用户提问**、**按需加载技能指引**、**把产出挂成交付卡**。
 * 于是清单（**以下全部为实测**：逐项 `grep` + `MODEL_TOOL_ALLOWLIST.length`）：
 *   · **既有 11 个** = 本插件 2（`read_contracts` / `write_hob`）
 *                    + 检索 5 + 定时 4（`schedule_*`）                          = 11
 *   · **批 9 新增 5 个** = `taskboard_list` / `taskboard_get` / `taskboard_comments`
 *                        + `roundtable_status`[P15 已删] + `web_fetch`              = 16
 *   · **批 11 / 13 新增 3 个** = `ask_user_question` + `skill` + `present`     = 19
 *   · **批 14 新增 2 个** = `hob_sessions` / `hob_send`                         = 21
 *   · **批 16 新增 2 个** = `hob_workspaces` / `hob_spawn`                      = 23
 *   · **批 17 新增 3 个** = `hob_dispatch` / `hob_orch_status` / `hob_orch_control` = **26**
 *   · **P15 删除 1 个** = `roundtable_status`（本机无提供方，调用即 `unknown tool`） = **25**。
 *
 * ⚠⚠ **订正说明（2026-10-21 · 第 337 轮 · 丙-7）**：本条原写作一串从 11 加到 **30** 的加法链，
 *   并声称「批 9 新增 **9** = 20 … 批 16 新增 **2 = 27** … 批 17 新增 **3 = 30**」。
 *   ⚠ **实测真值是 26**（`MODEL_TOOL_ALLOWLIST.length === 26`）。原链有两处错：
 *     ① **批 9 实际新增 5 个**（不是 9）—— 而且 `hob_read_doc` / `hob_glob` / `hob_grep` /
 *        `hob_read_image` **本就不在档1**（它们是档2/档3 的增量）⇒ 原链把"档位增量"
 *        算进了"本清单"；
 *     ② 累加到 **30** 之后**没有纠正** —— 而 **30 恰好是 `workspace` 档的数**
 *        （`PERMISSION_TIERS.workspace.length`），**不是本清单（= `ledger` 档）的数**。
 *   ⚠ 现在的口径（全实测）：本清单 **26** · `project` **27** · `workspace` **30**。
 *     ⚠ **逐档名数一律以 `check:presets` 的判定为准**（那是唯一的实测来源）。
 *
 * ── ⚠ 能力落点 = **声明面 与 白名单 的「与门」**（批 8 审查实测，见 E-86）────
 * 白名单**只**决定"这一项发不发给模型"；工具**还必须在该预设作用域里被注册**——
 * 否则执行时得到的是 `unknown tool "X"`（作用域内根本没有），而不是白名单的拒绝文本。
 * ⇒ 本批两类改动必须**成对**落：
 *   · 编排只读查询 4 个 —— **零声明增量**（它们已在插件平面被继承到本预设作用域）；
 *   · 网页正文 1 个 + 文件只读 4 个 —— **必须同时**在 `preset-dsh-hob.patch.yml` 里
 *     指名增行（`tool-web` / `tool-fs` / `tool-fs-search`），否则只是"放行了名字"；
 *   · **批 13 同理**：`skill` 需 `tool-skill`（且 `skill-filesystem` 供目录）、
 *     `present` 需 `present` 行 —— 两处**都已在**同批的声明面增行里落好。
 *
 * ── 为什么**排除**「改动共享状态 / 拉团队」那一批 ────────────────────────
 * `taskboard_create|move|update|delete` · `taskboard_checklist|comment_add|execution_report` ·
 * `team_task_*` · `spawn_teammate` / `send_message` / `wait_agent` / `interrupt_agent` ·
 * `roundtable_create|speak|next_round|…` 是"**改共享工作状态 / 拉一支团队**"的工具
 * （认领、移卡、开会、拉专家、组队）。
 * ⚠ **批 14 / M3 的口径更正（UD-77）**：本项目原先的理由是"一旦能指挥别的会话，
 *   职责边界当场失效"。用户 2026-10-08 决策 M3 之后，**边界改了口径** ——
 *   「**投递**」是允许的（`hob_sessions` / `hob_send`，见清单末尾），
 *   「**改共享工作状态**」仍不允许：派单不落到看板、不替人认领/移卡。
 *   ⇒ 上面这批**继续排除**，理由从"不许指挥别的会话"改成
 *     "**不许替人改动共享状态**"（`hob_send` 只发一条消息，不改任何卡的状态）。
 *   ⚠ 契约同步改了那句 `You cannot message it`（见 `preset-dsh-hob.patch.yml`）——
 *     它曾是本清单排除该项的**依据**，现在依据变了，注释不能留着旧理由。
 *
 * ── 为什么**排除** `write` / `edit` / `bash`（批 9 的核心取捨）────────────
 * 见 `preset-dsh-hob.patch.yml` 的头部注释「批 9」一节：
 * 白名单的粒度是**工具名**，**无法**用它闸"写到哪个路径 / 写什么类型"（E-87）。
 * ⇒ 只要放行 `write` / `edit`，就等于把"改任意路径（含代码）"的能力给了「助手」。
 * 它们**不在**本清单里；本批不改这条取捨。
 *
 * ── 批 13 为何只增 `skill` / `present`（两个新名字都**不**带写权限）──────────
 * 用户裁定（UD-72）：做 O4 / O3 / O2 / O5 中的 `present`，**不做** O1（`/goal` 目标类）、
 * O6（`/plan` + `exit_plan_mode`）、`todo_write` / `job_*`。
 * ⇒ 那几类**对应工具名一个都没进**本清单（`create_goal` / `get_goal` / `update_goal` /
 * `todo_write` / `job_list` / `job_output` / `job_kill` / `exit_plan_mode` 全部零命中）。
 * ⚠ 注意 **O4（`agent-instructions`）与 O2（`/compact`）本就不产生工具名** ——
 *   前者注入**消息段**、后者是**斜杠命令** ⇒ 它们**只改声明面**，白名单这里**无从体现**。
 *   这一点在回报里单列，免得后来人以为"漏加了名字"。
 *
 * ⚠ **不用通配 / 前缀**：将来新装的插件**不得自动**进入「助手」的清单。
 *   这正是 `restrict({ deny })` 黑名单的反面教训 —— 黑名单每装一个新插件都会漏。
 * ⚠ 本清单是**装配期过滤**（看不见），不是 `restrict` 的硬摘除（拿不到）；
 *   两者的差别与残余风险见 `filterModelToolList` 的注释。
 */
export const MODEL_TOOL_ALLOWLIST: readonly string[] = [
  // ── 本插件的两个工具 ──────────────────────────────────────────────
  'read_contracts',
  'write_hob',
  /**
   * ── **账本先建后推进**（2026-11-08 · 用户裁定）──────────────────────────
   *   `hob_ledger_status` 只读诊断；`hob_ledger_init` 建账 / 补齐（默认演练）。
   *
   *   ⚠ 为什么**三档都要有**：账本没建时**连派活都过不去**（`dispatchGateAtLedger`
   *     的第一道闸门），若建账工具在某档看不见，那一档的会话就**只能等着人手工建** ——
   *     这正是改前"建账只是文档里的规定"的形态。
   *   ⚠ 它们只碰**本账本区**，不扩大任何读 / 写面（落盘仍走 `writeHobFile` 同一道守卫）。
   */
  'hob_ledger_status',
  'hob_ledger_init',
  'hob_ledger_rebuild',
  /**
   * ⚠ 旧账本迁移不是“新建账”；但它只接受内置有限映射，默认只预演，真写需显式确认。
   *   若不给这一项，旧格式 / 旧状态词项目只能靠人工改账，Hob 的“先梳理健康再推进”
   *   在真实存量上就会卡住。三档都可见：它只碰本账本索引，仍走同一写入守卫。
   */
  'hob_ledger_migrate',
  /**
   * User approval for Pipeline v3 G1/G2. The tool records a decision audit
   * from an explicit user receipt; it cannot promote status by itself.
   */
  'hob_pipeline_approve',
  // ── 检索 5 个（既有）──────────────────────────────────────────────
  'advanced_search',
  'multi_search',
  'platform_search',
  'video_search',
  'free_search_test',
  /**
   * ══════════════════════════════════════════════════════════════════════
   * ⚠⚠ **丙-6（2026-10-21 · 第 339 轮）：这 4 个定时工具**已从白名单删除**
   * ══════════════════════════════════════════════════════════════════════
   *
   * ── 定性（**实测**，不是推断）──────────────────────────────────────────
   *   ① 白名单曾列 `schedule_create` / `schedule_list` / `schedule_update` / `schedule_delete` 这四个；
   *   ② **本预设的声明面零命中** —— `preset/dsh-hob/preset-dsh-hob.patch.yml` 里
   *      `grep schedule` = **0**；
   *   ③ 本预设地基 = `dsh-web-app/presets/minimal.patch.yml`，而那份里
   *      只有 `tool-fs` **一行**工具面，**没有 `tool-schedule`**（`grep` = 0）；
   *   ④ 宿主 preset **不支持 `extends`**（`PROJECT.md` §4.3 / F-C3）⇒ 本预设
   *      **不会**从 standard / full 那类预设里继承到 `tool-schedule`；
   *   ⑤ 提供方是 `@deepseek-ai/dsh-tool-schedule`（dsh 主包直接依赖，
   *      `package.json:80`；装配 id = `tool-schedule`，见
   *      `dsh-web-app/presets/cordis.patch.yml:38-39`）—— **它不在本预设的装配面上**。
   *
   *   ⇒ **定性 = 模型面多余**：这几个名字被放行，但作用域里**根本没有注册**，
   *     调用只会得到 `unknown tool`（`E-86` 的"与门"缺一半）。
   *     ⚠ 这是白名单**比实际能力宽**，与"声明面漏行"方向相反 ——
   *     两种定性修法相反，本批按实测的那一种做：**删名字**。
   *
   * ── 代价（如实）─────────────────────────────────────────────────────
   *   ⚠ 名数按实测（**P15 删 `roundtable_status` 后**）：`ledger` **21** · `project` **22** · `workspace` **25**（**以 `check:presets` 的判定为准**）。
   *   ⚠ 受影响的断言（本批已全部跑过）：`P-1`（名数口径）、`⑤h`、`⑤m-3b`、`⑦`、`⑧`。
   *   ⚠ **能力面没有缩水** —— 那几个工具**本来就用不了**；删掉的只是"看起来能用"的假象。
   */
  // ── 批 9 / S1：编排**只读查询** 4 个（声明面零增量，已在继承面）─────
  'taskboard_list',
  'taskboard_get',
  'taskboard_comments',
  // ⚠⚠ **2026-10-30 P15：`roundtable_status` 已删** —— 它在本机**没有提供方**
  //   （`dsh-plugin-roundtable` 包在磁盘上，但**不在 profile 的 bundles / dependencies 里**
  //   ⇒ 宿主不加载它 ⇒ 该名字在模型面里根本不存在，调用即 `unknown tool`）。
  //   ⚠ 这正是 `Q8` 咬过的"白名单比实际能力宽"那类。⚠ 本轮顺手核过"有没有别的同类"：
  //   **只剩它一个**（其余 21 名要么是宿主 100 名里真实存在的，要么是本插件自注册的）。
  // ── 批 9 / S2：打开网页取正文 1 个（需 `tool-web` 指名增行）─────────
  'web_fetch',
  // ── 批 21 / 权限收缩（**2026-10-14 · 用户裁定**）：~~批 9 / S3 只读看工作区文件 4 个~~ ──
  // ⛔ **已收缩**：`read` / `glob` / `grep` / `read_image` **从本清单移除**。
  //   用户原话：「hob 预设……**只能看账本和网络访问权限**，其他的收缩」，
  //   并**明确裁定范围 A** = 只收「工作区文件读取」这一族（编排全家与问用户等**保留**）。
  // ⚠ **同批连带**（否则会红/会漂）：
  //   · 声明面删掉 `tool-fs` + `tool-fs-search` 两行（见 `preset-dsh-hob.patch.yml`）；
  //   · 机检 ⑤h 的"恰好 N 名"断言同步 30 → 26；
  //   · 预设契约（人读版 + 机器读版）里描述"看工作区文件"的段落同步改。
  // ⚠ **副作用（是好事，如实记录）**：`tool-fs` 的 `apply` **同时注册 `write` / `edit`**，
  //   而宿主**没有"只给 read 系"的开关**（见 preset 里「S3 的取捨」那段）——
  //   ⇒ 删该声明行后，`write` / `edit` **连注册面都不再存在**，
  //   原先"拦截器 fail-open ⇒ write/edit 理论上可达"那条**已知残余风险**随之收窄。
  // ── 批 11 / D2：向用户提问 1 个（需 `tool-ask-user` 指名增行）──────────
  // ⚠ 用户裁定 UD-68 / CHG-015：「允许 Hob 提问，但**尽量不问** —— 按项目方案主线
  //   决策推进，除非只能由用户决策才可以提问」。契约里已就地追加「决策自主」条文
  //   （见 `preset-dsh-hob.patch.yml` 的 `Decide on your own.` 一段），
  //   本条只是把"能问"这个**手段**接上；它不是"要多问"的授权。
  // ⚠ **v4 起本插件只剩 `Hob` 一个预设**：原句「只限本预设（Hob）——`Hob-Execute` 侧的
  //   `WORK_MODEL_DENY` 仍禁该工具、一个字未动」是 **v4 之前的现状断言，现已失实**：
  //   实施侧预设 `Hob-Execute` 与 `WORK_MODEL_DENY`（`src/modules/work-deny.ts`）**均已整段删除**
  //   ⇒ 该禁项**随预设一并移除**，现无"另一侧"可言（UD-64 的禁弹窗纪律只在实施侧预设存在时成立）。
  'ask_user_question',
  // ── 批 13 / O3：按需加载技能指引 1 个（需 `tool-skill` + `skill-filesystem`）─
  // ⚠ 与 E-86 的「与门」同款：光放行名字不够，声明面必须同时有那两行
  //   （本批已落，见 `preset-dsh-hob.patch.yml` 的「批 13」一节）。
  // ⚠ **目录可能为空是正常的**：用户裁定要求**收窄技能发现范围**（UD-72②），
  //   本预设把 `skill-filesystem` 配成 `includeDefaultRoots: false` + 空清单
  //   ⇒ 生效技能 **0 个**。此时 `skill` 工具**仍在**（可调用），
  //   只是调用会得到"技能未知或不再可用" ⇒ 这是**有意的收窄态**，不是故障。
  'skill',
  // ── 批 13 / O5：把产出挂成交付卡 1 个（需 `present` 指名增行）──────────
  // ⚠ `present` **不写工作区**：它只声明"这些已存在的文件是交付物"，
  //   让界面给出可预览/可打开的文件卡（`dsh-tool-present`）。⇒ 不撞 UD-13。
  'present',
  // ── 批 14 / M3：会话总线投递 2 个（UD-77）─────────────────────────────
  // ⚠ **这是本项目第一条"能指挥别的会话"的能力** —— 它改的是 PROJECT.md §6.1
  //   那行「派活 / 委派 ❌」。用户 2026-10-08 决策 UD-77 明确要它（方案 B），
  //   并把口径从"绝对没有"改成"**投递 ≠ 完成**：交付是 agent 干的，不是它干的"。
  //   落点仍是**与门**（E-86）：工具定义在 `modules/bus.ts`，注册在下面
  //   `registerBusTools`（预设作用域）；只加名字不加注册 ⇒ `unknown tool`。
  // ⚠ **不收 `inject` 语义**（第三种投递语义"只写上下文不唤醒"）：对派活无意义，
  //   且它的失败是静默的（会话可能一直不读）⇒ 不在枚举里，工具层也拒。
  'hob_sessions',
  'hob_send',
  // ── 批 16：建会话能力 2 个（UD-79）────────────────────────────────────
  // ⚠ 用户 2026-10-09 决策：Hob 派活/编排时**如需新建会话，新建的会话必须注意
  //   工作区归属**。落法是 `hob_workspaces`（看可选工作区）+ `hob_spawn`
  //   （建会话，**强制带 `workspaceId`**）。
  // ⚠ 为什么必须强制：宿主 `sessionController.create` 的 `workspaceId` 是**可选**字段，
  //   不传就建出"不属于任何工作区"的孤儿会话（2026-10-09 实测：只传 cwd 建出的
  //   会话在 workspace.json 里查无归属）。⇒ 本工具**不接受"不指定"**：
  //   要么显式给，要么落到调用方自己的工作区，解析不出就**拒**，绝不造孤儿。
  // ⚠ 与门（E-86）同前：定义在 `modules/bus.ts`，注册在 `registerBusTools`。
  'hob_workspaces',
  'hob_spawn',
  // ── 批 17：闭环编排 3 个（UD-80）──────────────────────────────────────
  // ⚠ 用户 2026-10-09 要求：会话任务完成后**自动回传**给对应的 Hob 会话，Hob 分析后
  //   继续推进并下发下一步；**续用还是新建由 Hob 自己判断**。
  // ⚠ 这条能力**会自己在无人看管时往下转**（用户明确选了"不设上限、只能手动停"）
  //   ⇒ `modules.orch` **缺省关**；开了才有这三个工具。
  // ⚠ 与门（E-86）同前：定义在 `modules/orchestrator.ts`，注册在 `registerOrchTools`。
  'hob_dispatch',
  'hob_orch_status',
  'hob_orch_control',
]

/**
 * **三档「模型面」工具名集**（2026-11-23 · A·拆分，自 `preset/tools.ts` 原样搬出）。
 * ⚠ 逐档名数以 `check:presets` 判定为准；⛔ 与注册面无关（那张表不知道谁真注册了）。
 *
 * @module preset/permission-tiers
 */

/**
 * **权限三档的名字集**（2026-10-14 第 144 轮 · 用户裁定「档3 要真硬机制」+「档2不给，档3的都给」）。
 *
 * ── 三档是什么（包含链）────────────────────────────────────────────────
 *   · `ledger`（账本，**默认**）= **只读自己的账本 + 网络** —— 看不到项目工作区的文件。
 *     ⚠ **与批 21 收缩后的现状逐名一致**（机检 ⑤m-2 用双向差集钉这条）。
 *   · `project`（项目）= 档1 **+** `hob_read_doc`（**只 `.md`** 模式）。
 *   · `workspace`（工作区）= 档2 **+** `hob_glob` + `hob_grep` + `hob_read_image`
 *     （且 `hob_read_doc` 在档3 **不设类型白名单** —— 工作区里的文件都可读取查看）。
 *
 * ── ⛔ 写类 / 命令类名字在三档里**一个都没有** ───────────────────────────
 *   `write` / `edit` / `bash` / `pwsh` / `str_replace_editor` **不在任何一档**
 *   （机检 ⑤m-4 逐个点验）。
 *   ⚠ **这不只是"没放行"** —— 它们**根本不注册**（`tool-fs` / `tool-bash` /
 *     `tool-pwsh` / `str-replace-editor` 在声明面一行都没有）⇒ 结构性不可达。
 *     机检 ⑤m-6 另有一条盯**宿主平面**：那 4 个包必须仍处 `disabled: true`，
 *     否则写类工具会**静默回到注册面**而三档白名单照样 PASS。
 *
 * ── ⚠ 这份表是**唯一**的名字集来源（E-110）──────────────────────────────
 *   `MODEL_TOOL_ALLOWLIST`（档1 的历史常量）与各档必须是**同一份事实**：
 *   ⛔ 不许在别处再抄一份名字清单（机检 ⑤m-2 拿它与那份常量做**双向差集**）。
 *
 * ── 为什么档1 不直接用 `MODEL_TOOL_ALLOWLIST` ────────────────────────────
 *   留那个常量是为了**兼容既有断言与既有语义**（批 21 收缩后的那一档），
 *   而两档之上的档是**同一张表的切片**。二者由机检钉成"逐名相等"而不是"看起来差不多"。
 */
export const PERMISSION_TIERS: Readonly<Record<'ledger' | 'project' | 'workspace', readonly string[]>> = {
  /** 档1 账本 = 批 21 收缩后的现状（只读账本 + 网络 + 编排全家）。 */
  ledger: MODEL_TOOL_ALLOWLIST,
  /** 档2 项目 = 档1 + 只读 `.md`（自注册工具，**不声明 `tool-fs`**）。 */
  project: [
    ...MODEL_TOOL_ALLOWLIST,
    'hob_read_doc',
  ],
  /** 档3 工作区 = 档2 + 目录列举 + 文本搜索 + 图片（全部自注册只读）。 */
  workspace: [
    ...MODEL_TOOL_ALLOWLIST,
    'hob_read_doc',
    'hob_glob',
    'hob_grep',
    'hob_read_image',
  ],
}


/**
 * **档位只管「可读范围」的那批名字**（2026-10-30 P14 · 用户裁定）。
 *
 * ── 用户原话（⛔ 不许改语义）────────────────────────────────────────
 *   「把当前项目自己的工具和其他工具做区分，**档位以及工作推进方式权限控制都是通过当前项目的
 *     工具去控制的不影响其他工具**」
 *   「**档位一直都只是控制 HOB 预设的可读操作权限啊**」
 *
 * ── 结论（这条常量就是那句话的机械形态）────────────────────────────
 *   `PERMISSION_TIERS` 从今往后**只**描述"这一档能读到哪里"：
 *     · `hob_read_doc`（项目内 `.md`）—— 档 2 起；
 *     · `hob_glob` / `hob_grep` / `hob_read_image`（目录/文本/图片）—— 档 3 才有。
 *   ⚠ 其余工具（编排七件、台账两件、检索、网络、`ask_user_question`…）**与档位无关**：
 *     它们的可达性由 deny 清单决定，⛔ 不再由档位开关。
 *
 * ── 为什么单列这张表而不是"档3 − 档1"───────────────────────────────
 *   "档3 − 档1" 在**将来**某档多加一个非读名字时会**静默把那个名字也算成读范围**
 *   （于是被判成"低档看不见"）。⇒ 读范围必须**指名**，⛔ 不许派生。
 *   机检 ⑤n-1 拿它与"档3 − 档1"做**双向点验**，两边一旦漂开就红。
 */
export const READ_SCOPED_TOOLS: readonly string[] = [
  'hob_read_doc',
  'hob_glob',
  'hob_grep',
  'hob_read_image',
]