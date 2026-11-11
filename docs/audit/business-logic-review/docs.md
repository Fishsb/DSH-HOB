# 文档契约与自检覆盖 · 只读审查（t6 / doc-auditor）

> 范围：`README.md` · `TERMINOLOGY.md` · `kit/**` · `preset/dsh-hob/**` · `scripts/*.mjs`（62 份）
> 口径：只读。所有结论给「相对路径:行号」+ 证据（代码片段或实跑输出）。
> 实跑清单（均为只读，未改仓库）：`npm run typecheck`（exit 0）· `check:workflow`(33/33) · `check:pipeline`(25/25) · `check:risk-policy`(25/25) · `check:config`(63/63) · `check:client`(51/51) · `check:skeleton`(7/7) · `check:ledger`(129/129) · `check:gitignore`(1193/1193) · `check:convergence`(36 查/35 过/1 跳) · `check:meta-negctl`(3/3) · `check:presets`(281/281) · `check:hob-create`(53/53) · `check:work-plan-runtime`(42/42) · `check:archive`(7 查/6 过/1 跳) · `check:readings`(3/3) · `check:rounds`(4/4) · `check:experience`(9/9) · `check:build`(报警模 exit 0)

---

## ① 本域业务职责

本域守的是**「对外承诺」与「代码实际行为」之间的一致性**：README/TERMINOLOGY 承诺给用户的规则（阶段/闸门/风险/权限/账本落点），`preset/dsh-hob/**` 承诺给模型的规则（workflow.toml + spec/ → gen/ → prefix 正文），以及 `scripts/*.mjs` 这套**用来证明上述两者没漂**的自检体系本身是否可信。
它的产出不是功能，而是**可核验性**：任何一条承诺都必须能被一条会失败的断言指出来。
本域最坏的缺陷形态不是「写错了」，而是**「判据永远绿」与「同一事实两处口径」**——前者让错误不可见，后者让修一处漏一处。

---

## ② 主链路：文档源 → 生成 → 落盘 → 运行时 → 判据

| # | 步骤 | 落点 | 证据 |
|---|---|---|---|
| 1 | **唯一机读源** | `preset/dsh-hob/workflow.toml`（7 `[[step]]` · 10 `[[intake]]` · 4 `[[reply]]` · 9 `[[invariant]]` · 34 `[[rule]]`） | `workflow.toml:18-93`；实测 `grep -c '^\[\[step\]\]'` = 7 / intake = 10 / reply = 4 / invariant = 9 / rule = 34 |
| 2 | **散文源** | `preset/dsh-hob/spec/*.md`（intake / reply / handover / risk-policy / notes-*） | `gen-preset-contract.mjs:69-71`（附注四卷）；`check-workflow.mjs:729-735`（F5 逐段可追溯） |
| 3 | **渲染（纯函数、零时间戳）** | `scripts/gen-preset-contract.mjs:449-475` | `:449` 超预算即抛（`MODEL_FACE_CHAR_BUDGET`）；`:473-475` `mkdirSync(GEN_DIR)` + `writeFileSync` |
| 4 | **落盘（生成物）** | `preset/dsh-hob/gen/persona.md`（43365 字符 / 49628 字节 / SHA-256 `0068713a…`）· `gen/contracts.md` | `sha256sum` 与 `contracts.md:6` 自述值逐字相同（实测） |
| 5 | **运行时出口（⚠ 手工环节）** | `preset/dsh-hob/preset-dsh-hob.patch.yml` 的 `prefix: \|-` 块（`yml:70-724`） | `gen-preset-contract.mjs:10-11` 明写「⛔ **不写进** preset-dsh-hob.patch.yml」⇒ 第 4→5 步**靠人手**，只有事后判据 |
| 6 | **人读镜像** | `kit/drafts/preset-contracts.md`（`⑤` 逐字比对）+ `scripts/sync-draft-block.mjs` | `check-preset-contracts.mjs:96` `const DRAFT = join(root,'kit','drafts','preset-contracts.md')` |
| 7 | **判据（两层）** | 内容层 `check:workflow` F1–F14 · 逐字层 `check:presets` ⑤ | `check-workflow.mjs:339/356/377/508/646/729/776/806/859/897/1130`；`check-preset-contracts.mjs` ⑤ 组 |
| 8 | **聚合门** | `scripts/check-all.mjs`（50 个 `check:*`，SELF 排除 3 ⇒ **47 族必跑**） | 实测 `check:*` = 50、SELF = {check:all, check:preflight, check:tasks-route-http}（`:127`） |

**这条链上唯一没有机检的一步是 4→5**（`gen/persona.md` → `prefix`）。F10 只做**事后**逐字节比对（`check-workflow.mjs:859-895`），并没有「生成器直接写 prefix」或「prefix 从 persona 派生」的机制。这正是 D-03 能发生的地形。

---

## ③ 契约与不变量清单（当前代码里**真正被强制**的）

| # | 契约 | 强制点 | 是否真会红（负控证据） |
|---|---|---|---|
| C1 | 生成物 == 源（手改 `gen/*.md` 必红） | `check-workflow.mjs:356-374`（F2 逐字节） | 是（N-F3 `:1027-1046`；F2 由 F10/N-F10 反向证明） |
| C2 | `prefix` 正文 == `gen/persona.md` | `check-workflow.mjs:859-895`（F10） | 是（N-F10/N-F11「两面同删仍绿 ⇒ ② 必红」实测贴过） |
| C3 | 宪法每条条款带 `checked_by` 字样 | `check-workflow.mjs:398`（F3） | 是（N-F3 `:1027-1046`）**但只核字样存在，不核指向是否有效** → D-04 |
| C4 | `workflow.toml` 的 invariant.text 逐字在宪法里、条数恰好相等 | `check-workflow.mjs:897-957`（F11 三条） | 是（F11 ③ 反向核 + 两面同核） |
| C5 | 人读版引文块 == `prefix` 正文 | `check-preset-contracts.mjs` ⑤ 组 | 是（自陈「两面一起删 ⑤ 仍绿 ⇒ ⑤p 当场红」） |
| C6 | 工作区名口径两侧逐字相同（运行时 ↔ 判据侧） | `check-code-face.mjs:1718-1815`（S1/S2/S3 + 自带样本） | 是（SHOULD_BITE / SHOULD_NOT_BITE 成对样本） |
| C7 | 账本根解析两侧逐组同值 | `check-orch-state.mjs:14457-14556`（SV-n + 反证） | 是（`:14508-14556` 真改行为造不一致 ⇒ 必红） |
| C8 | 每条判据自带负向对拍 | `check-meta-negctl.mjs:168-187`（M-1）+ `scripts/meta-negative-floor.json` | **部分**：7 族下限 = 0 ⇒ 恒真 → D-02 |
| C9 | 族数 ≥ `FAMILY_FLOOR` | `check-all.mjs:152/1162-1172` | 是，但**余量 = 2**（45 vs 47）→ D-11 |
| C10 | 每族断言数 == 登记下界（双向） | `check-all.mjs:1323-1334` | 是（`>` 与 `<` 都红）；实测 6 族逐一对齐 |
| C11 | 跑绿却不报 `处级口径` ⇒ 违规 | `check-all.mjs:1298/1335-1341` | 是 |
| C12 | 工作区名配置 `dsh-hob.workspace.json` 缺失 ⇒ 落回目录名 | `doc-read.ts:229-247`；`scripts/workspace-name.mjs:48-77` | 是（S3 断言 + 实测本仓文件内容 `{"workspaceName":"dsh-hob"}`） |

**未被强制（但被文档宣称）的**：阶段名唯一（D-01）· 宪法 `checked_by` 指向有效（D-04）· 聚合入口不写文件（D-05）· 负控覆盖（D-02）。

---
## ④ 缺陷 / 风险清单

> 排序口径：先「会掩盖其他问题 / 让失败不可观测」，再按严重度。**不按显眼度**。

### D-01 · blocker · 阶段词表 7 份并存且已漂（「任务图」vs「编码任务」），文档承诺「唯一」但只承诺到闸门层

**位置**
- 承诺：`TERMINOLOGY.md:81-82`「**唯一当前阶段**：由 `pipeline-view.ts` 生成的 Pipeline 视图。面板、阶段接口和派发门禁都消费它，不从全局账本另算一套。」；`TERMINOLOGY.md:107`；`kit/drafts/architecture-overview.md:88-89`；`kit/drafts/preset-contracts.md:170`
- 实现（7 份步名字面量）：
  1. `src/shared/pipeline-view.ts:33-41` `PIPELINE_STAGES`（权威）→ `tasks: '任务图'`
  2. `src/shared/stage-controls.ts:16-28` `STAGE_IDS` + `STAGE_NAMES` → **`tasks: '编码任务'`**
  3. `src/shared/stages-index.ts:29-37` `STAGE_DEFS` → `'任务图'`
  4. `src/shared/requirement-chain.ts:120-128` `STEP_DEFS` → `'任务图'`；`:112-118` `LEGACY_STEP_DEFS` 另有**五步旧表**（含「验收核对」）
  5. `src/client/project-panel.tsx:138` `STAGES_STEP_NAMES` → `'任务图'`；`:148-156` `STAGE_KIND_BY_STEP`
  6. `scripts/gen-ledger.mjs:522` `STEP_NAMES` → `'任务图'`
  7. `src/shared/pipeline.ts:48-51` `PIPELINE_STAGE_IDS`（只有 id，无 name）

**证据（实测）**
```
$ sed -n '19,28p' src/shared/stage-controls.ts
export const STAGE_NAMES: Readonly<Record<StageId, string>> = {
  requirements: '需求规格',  plan: '实现方案',
  tasks: '编码任务',          <-- 与其余六份不同
  execution: '任务执行', verification: '技术验证', acceptance: '产品验收', closure: '交付收口',
}
$ sed -n '32p' src/shared/stages-index.ts    ->  { step: 3, kind: 'task', name: '任务图' },
$ sed -n '36p' src/shared/pipeline-view.ts   ->  { step: 3, id: 'tasks', name: '任务图' },
$ sed -n '138p' src/client/project-panel.tsx ->  ... '任务图' ...
```
且 `STAGE_NAMES` 的**唯一消费方**是 `scripts/gen-ledger.mjs:1267/1270`，它把名字写进**账本 `CONTEXT.md` 的「阶段控制」块**。
实测真账本**尚无该块**（`grep -n '### 阶段控制' /home/lk/.dsh/hob-ledgers/dsh-hob/CONTEXT.md` ⇒ 零命中）⇒ **矛盾目前不可见，跑一次 `npm run gen:ledger` 就会在账本里印出「编码任务」而面板显示「任务图」**。

**没有任何判据比对这 7 份**：`grep -rn 'STAGE_NAMES|PIPELINE_STAGES|STAGE_DEFS|STAGES_STEP_NAMES' scripts/*.mjs` 只命中 `check-pipeline.mjs:320-325`（只核 id 与存在性）与 `gen-ledger.mjs:22`（消费，非比对）；`check-stages-panel-dom.mjs:207-227` 只把 `STAGES_STEP_NAMES` 与**它自己**的 7 项硬基准比。

**影响**
文档承诺「面板、阶段接口、派发门禁都消费同一份」，实际只做到「**闸门与责任方**一份」（`check-pipeline.mjs:320` 钉住 `PIPELINE_STAGES` 的 id 序）；**步名**这一层 7 份并存、已有一份漂了。用户看到的面板、账本生成的 `CONTEXT.md`、模型上下文里的「步名」可能三处不同名。

**建议**
① 把 `STAGE_NAMES` 改为从 `PIPELINE_STAGES` 派生（或反向：让 pipeline-view 从 stage-controls 派生 id→name），只留**一处字面量**；
② 新增一条交叉断言：`STAGE_NAMES[k] === PIPELINE_STAGES.find(s=>s.id===k).name` 逐 kind 相等，且 `STAGE_DEFS` / `STEP_DEFS` / `STAGES_STEP_NAMES` / `STEP_NAMES` 与它逐项相等（带负向对拍：改一处 ⇒ 必红）；
③ 文档侧把承诺写全：把 `TERMINOLOGY.md:81` 的「唯一当前阶段」扩成「唯一阶段**定义**（含步名）」。

---

### D-02 · blocker · 元规则 M-1 的「0 下限」让 7 个族「零负控也永远绿」，其中 `check:work-plan-runtime` 有 42 条断言却 0 条负控

**位置**
- `scripts/meta-negative-floor.json:4-53`：`check:build` / `check:host` / `check:profile` / `check:readings` / `check:rounds` / `check:selfwake` / `check:work-plan-runtime` 七族下限 = **0**
- `scripts/check-meta-negctl.mjs:142-144`：判据是 `if (got < floor[fam])`
- `scripts/check-all.mjs:201`：`['check:work-plan-runtime', 42]`（断言下界 42）

**证据（实测）**
```
$ grep -c "负向对拍" scripts/check-work-plan-runtime.mjs
0
$ node -e '...'   # 交叉：断言下界 vs 负控下限
check:host              | 9  | 0
check:profile           | 3  | 0
check:readings          | 3  | 0
check:rounds            | 4  | 0
check:selfwake          | 3  | 0
check:work-plan-runtime | 42 | 0
$ npm run check:work-plan-runtime
WorkPlan 运行态：通过 42 · 失败 0
```
`check-meta-negctl.mjs:3` 自述「**每条判据都必须自带一条负向对拍**（造必错夹具 ⇒ 它必须当场红）」；`:21`「若 M-1 不红，就说明它数的是『登记表』而不是『实测』」。但 `0 < 0` 为假 ⇒ 这 7 族**把对拍删光也不会红**。

`check:work-plan-runtime` 里只有两行**注释**写着「负向①/②」（`:212`/`:214`），没有打 `负向对拍` 标签 ⇒ M-1 口径（`:48` 只认 `ok|bad|note.push|check` 第一个字面量含「负向对拍」）数不到它。42 条断言里**没有一条能证明它会红**。

**影响**
这是本域最典型的「**让失败不可观测**」：`check:work-plan-runtime` 守的是「计划落盘 / 真实 status / 失败归档 / 重启恢复」，一旦实现退化成恒真，42 条断言照样全绿，而 `check:all` 的断言下界（42）只保证**条数没少**、不保证**每条有牙**。

**建议**
① 把 7 族的 `meta-negative-floor.json` 下限从 0 抬到 ≥1（`check:work-plan-runtime` 按现有 `archiveStalePlan` 的「别人不能替它清 / 无原因不能清」两条**真造夹具**，正是现成的对拍素材）；
② 在 `check-meta-negctl.mjs` 加一条：**有断言下界（`ASSERTION_FLOORS`）的族，负控下限不得为 0** —— 把两张表焊起来，否则「加族时忘了登记负控」永远是静默口子；
③ M-1 的口径补上「注释里的 `负向①` 不算」，并在脚本输出里**点名**哪几族是 0（现在只在合计行里隐含）。

---

### D-03 · blocker · 人读版 `gen/contracts.md` 与运行时 `prefix` 给出**两套步名**（七步 vs 五步旧词），且无任何判据核这一句

**位置**
- 运行时（模型真正读到的）：`preset/dsh-hob/preset-dsh-hob.patch.yml:434` = `gen/persona.md:364`
  `N and the step name come from the five steps (需求规格 / 实现方案 / **编码任务** / 任务执行 / **验收核对**)`
- 人读版（用户过目）：`gen/contracts.md:200` 与 `spec/reply.md:84`
  `N 与 <步名> 取自 Pipeline v3 主线（需求规格 / 实现方案 / **任务图** / 任务执行 / 技术验证 / 产品验收 / 交付收口）`
- 代码真值：`src/shared/pipeline-view.ts:33-41`（7 步，`activeStage` 取值 1..7，见 `:481`）

**证据（实测）**
```
$ grep -n "需求规格 / 实现方案" preset/dsh-hob/gen/contracts.md preset/dsh-hob/spec/reply.md \
      preset/dsh-hob/gen/persona.md preset/dsh-hob/preset-dsh-hob.patch.yml
gen/contracts.md:200      ... Pipeline v3 主线（需求规格 / 实现方案 / 任务图 / 任务执行 / 技术验证 / 产品验收 / 交付收口）
spec/reply.md:84          ... 同上（七步）
gen/persona.md:364        ... the five steps (需求规格 / 实现方案 / 编码任务 / 任务执行 / 验收核对)   <-- 五步旧词
preset-dsh-hob.patch.yml:434  ... 同上（五步旧词）
```

**为什么判据抓不到**
`F10`（`check-workflow.mjs:859`）只核 `prefix` 正文 == `gen/persona.md`（两者都是五步旧词 ⇒ 一致 ⇒ 绿）；
`F5`（`:729`）只核 `spec/notes-*.md` 每段逐字在 `prefix` 里（`notes-handover.md:244` 就是五步旧词那句 ⇒ 也绿）；
`F14`（`:441-505`）只核 reply id 与两条硬话（`the first sentence must be the answer` / `In a question turn these never appear`）；
`⑤`（`check-preset-contracts.mjs`）只核 `kit/drafts/preset-contracts.md` 的引文块 == `prefix`（`kit/drafts/preset-contracts.md:440` 也是五步旧词 ⇒ 绿）。
⇒ **五处都绿，而运行时告诉模型「按五步报阶段」**。

**影响**
Hob 每轮回复的固定第一行是 `当前：第 N 步 · <步名>`（`prefix` 同段），它会被要求「与 Pipeline 视图的 `activeStage` 一致」，而模型手里只有**五步词表**（第 5 步叫「验收核对」），视图给的是**七步**（第 5 步是「技术验证」、第 6 步「产品验收」）。⇒ 用户会看到「第 5 步 · 验收核对」而面板显示「第 5 步 · 技术验证」。这是**跨域**（编排/客户端/文档）最直接的可见不一致，且**当前全部判据为绿**。

**建议**
① 把 `spec/notes-handover.md:242-244` 与 `spec/reply.md:79-84` 对齐成**同一套七步词**（`reply.md` 已是对的，改 `notes-handover.md` 那一处即可；`prefix`/`gen/persona.md` 由生成器重跑同步）；
② 新增一条断言（建议落在 `check:workflow` 的 F14 组，或新开 F15）：**`spec/reply.md` 与 `prefix` 正文里的「步名清单」逐项相等**，负向对拍 = 只改一侧 ⇒ 必红；
③ 顺带：`F14` 已建立「三处互核」的形态，把它扩到「步名清单」是同一套机制，成本低。

---

### D-04 · high · `CONSTITUTION.md` 的 `checked_by` 指向不存在的断言，而 F3 只核「这几个字在不在」

**位置**
- `preset/dsh-hob/CONSTITUTION.md:5` 第 1 条「投递 ≠ 做完」→ `check:workflow F5`
- `:6` 第 2 条「建会话 ≠ 派活」→ `check:workflow F5`
- `:10` 第 6 条「无预算不派活」→ `check:workflow F1`
- `:14` 第 9 条「没有读数不能陈述为事实」→ `check:readings · check:convergence K-2`
- 判据：`scripts/check-workflow.mjs:398` `const noCb = grouped.filter((g) => !g.join('`\n`').includes('`checked_by`'))`

**证据（实测）**
```
$ sed -n '729,735p' scripts/check-workflow.mjs
  // F5 · 附注卷每一段都在 `prefix` 正文里真实存在（2026-10-30 P9）
  ... 它守的是 spec/notes-*.md 是否逐字搬进 prefix —— 与「投递≠做完 / 建会话≠派活」无关

$ grep -n "budget" scripts/check-workflow.mjs
323:      'notes-mechanism.md', 'notes-evidence.md', 'notes-handover.md', 'notes-budget.md',
741:    const files = ['notes-mechanism.md', 'notes-evidence.md', 'notes-handover.md', 'notes-budget.md'],
  ⇒ 只有文件名命中，零条 budget 断言

$ grep -n "STRICT_FROM" scripts/check-readings-citable.mjs
108:export const STRICT_FROM = 208      ⇒ 只对 R208 及以后强制
```
F3 的判定只有三样：`bytes <= 2048`、`clauses.length > 0`、每组含 `checked_by` 字样（`:389-402`）。**指向的断言是否存在、是否真的在守那一条，完全不核**。

**影响**
宪法是「不可协商条款 + 机检落点」的对外承诺（`CONSTITUTION.md:1`「≤2 KB · 不可协商」）。现在**三条条款的落点是假的**：第 1/2 条指向一条只管附注卷的断言，第 6 条指向一条零 budget 断言的族，第 9 条指向一个只管 R208 之后报告格式的族。⇒ 「宪法每条都有机检」在**形式上**成立、**实质上**不成立，属于「门禁可绕过」。

**建议**
① 给 `CONSTITUTION.md` 的 `checked_by` 加**可解析格式**（如 `check:workflow#F5`），并在 `check-workflow` 新增一条：**逐个 `check:X#Y` 去该族源码里找 `Y` 这个标签，找不到 ⇒ 红**（负向对拍：把 F5 改成 F99 ⇒ 必红）；
② 第 1/2 条应改指向真正守它的族（`check:presets` ⑤k 职责边界块 / `check:workflow` F1 的「delivering-is-not-doing」invariant 存在性）；
③ 第 6 条要么补一条 budget 断言（`work-plan.ts:529-530` 已有 `missing-budget` 规则，可直接做成断言），要么把 `checked_by` 改成「无机检（仅提示词约束）」——**如实写比假指针好**。

---
### D-05 · high · 聚合入口自述「不写任何文件」，实际多个族把工作目录建在**仓库根**、把变异体写进 `src/`

**位置**
- 自述：`scripts/check-all.mjs:47`「⛔ 不写任何文件（各族的临时件仍由各族自己管，且都在系统临时目录里）」
- 反例（仓库根工作目录）：
  - `scripts/check-ledger.mjs:54` `const WORK = join(ROOT, '.check-ledger-work')`
  - `scripts/check-stages-route.mjs:27` `const WORK = join(root, '.check-stages-route-work')`
  - `scripts/check-exec-progress.mjs:38` `const work = join(root, '.check-exec-progress-work')`
  - `scripts/check-tasks-progress.mjs:35` `const work = join(root, '.check-tasks-progress-work')`
  - `scripts/check-work-plan-panel.mjs:32` `mkdirSync(WORK, ...)`
- 反例（写进**产品源码树**）：
  - `scripts/check-preset-contracts.mjs:3781` `join(root,'src','shared', 'unseen-tools.__negctl_' + process.pid + '.ts')`
  - `scripts/check-preset-contracts.mjs:3856 / :3892 / :4055` `join(root,'src','preset', 'tools.__negctl_p14_' + pid + '.ts')`
  - `scripts/check-stages-route.mjs:1129` `join(root,'src','shared', 'stage-status-labels.__negctl_' + pid + '.ts')`

**证据（实测）**
```
$ grep -n "check-\*" .gitignore
133:.check-dom-work/
134:.check-gate-work/
135:.check-*-work/
$ grep -c "negctl" .gitignore
0                          <-- src/** 的 __negctl_*.ts 没有任何 ignore 兜底
$ find . -name '*__negctl*' -not -path './node_modules/*'
(none)                     <-- 当前干净（finally rmSync 生效）
```

**影响**
① 判据进程被 Ctrl-C / OOM / 断言抛在 `finally` 之前 ⇒ 仓库根留下 `.check-*-work/`（已被 ignore，无害）**与 `src/**/__negctl_*.ts`（未被 ignore）**；
② 更糟：`tsconfig.json` 的 `include: ["src"]` ⇒ 残留的 `__negctl_*.ts` 会被 `npm run build` 编进 `lib/`，而 `check:build` 面 ⑤（孤儿产物）会因此报红 —— 判据自己污染被测对象；
③ `check-all.mjs:47` 的「都在系统临时目录里」是**给读者的安全承诺**，现在不成立。

**建议**
① 把 `check-all.mjs:47` 改成实况：「本入口不写文件；**各族自己**会写 `.check-*-work/`（仓库根，已 ignore）与 `src/**/__negctl_*.ts`（临时，finally 清理，⚠ 异常中断会残留）」；
② `.gitignore` 补一条 `src/**/__*__negctl_*.ts`（或统一命名族），让残留至少**不会进 git**；
③ 更好的做法：`check-preset-contracts` / `check-stages-route` 的变异体改写到 `mkdtempSync(tmpdir())` 下的镜像树（`check-orch-state.mjs` 的 SV-n 反证已经这么做：`:14518-14522` `mkdtempSync(join(svTmp,'mut-svn-'))` + `cpSync(src)`），照抄即可。

---

### D-06 · high · README 的 `ledgerHome` 缺省规则与代码**相反**，且引用了已删除的常量

**位置**
- `README.md:132`「`ledgerHome` … **空串 = 派生**：`<工作区父目录>/.hob-ledgers/<工作区名>/`」
- `README.md:144`「（`src/server/doc-read.ts` 的 `DEFAULT_LEDGER_DIR = '.hob-ledgers'`，该档不含任何本机绝对路径）」
- `README.md:131`「建工作区时请照 `.hob/INIT.md` §2.1 建上」
- 实现：`src/server/doc-read.ts:139-146` `const home = ledgerHome.trim(); if (home !== '') return resolve(home, base); … return undefined`
- `src/server/doc-read.ts:254` 只在注释里提到旧常量 `DEFAULT_LEDGER_DIR`（**常量已删除**）
- `src/modules/tools.ts:399-400` 注释仍写「留空时由 `resolveLedgerRoot` 退到『工作区的**兄弟目录**』」
- 体检脚本仍实现兄弟目录派生：`scripts/preflight.mjs:48-50` `const fallback = join(dirname(resolve(root)), '.hob-ledgers', wsName)`

**证据（实测）**
```
$ grep -rn "DEFAULT_LEDGER_DIR" src scripts
src/server/doc-read.ts:254: * 与它替代掉的旧常量 DEFAULT_LEDGER_DIR = '.hob-ledgers' 的区别
src/modules/orchestrator.ts:3291: *   （resolve(dirname(ws), DEFAULT_LEDGER_DIR, base)）⇒ 读的是另一个位置
README.md:144:（src/server/doc-read.ts 的 DEFAULT_LEDGER_DIR = '.hob-ledgers'，
  ⇒ 三处都只在**注释/文档**里出现，没有任何一处是活的常量定义

$ ls .hob/INIT.md
ls: cannot access '.hob/INIT.md': No such file or directory
$ ls kit/INIT.md
kit/INIT.md                 <-- 真实路径
```

**影响**
README 明确写「**除非你确知在做什么，否则留空**」——而**留空的真实后果是 `resolveLedgerRoot` 返回 `undefined`（判不出，工具拒绝）**，不是「自动派生到兄弟目录」。照 README 做的人会得到「账本落点判不出」的拒绝（`src/modules/tools.ts:2161`「拒绝：账本落点判不出（会话没有工作区根，或 `ledgerHome` 没配）⇒ 不知道该在哪儿建。」），而 README 说这条路是推荐的。**同时 `preflight` 会报「记录区在位（按缺省规则派生）」，与运行时相反 —— 体检与运行不同口径**。

**建议**
① `README.md:132` 改成「**空串 = 判不出**（`resolveLedgerRoot` 返回 `undefined`，工具拒绝并给原因）；本仓库随包发出的预设行已显式给 `ledgerHome`，**换机必须改**」；
② 删掉 `README.md:144` 对 `DEFAULT_LEDGER_DIR` 的引用（常量已不存在）；
③ `README.md:131` 的 `.hob/INIT.md` → `kit/INIT.md`；
④ `src/modules/tools.ts:399-400` 的注释同步改（它现在描述的是一个**不存在**的兜底档）；`scripts/preflight.mjs:48-50` 的兄弟目录档要么删、要么标注「仅体检用，运行时已无此档」。

---

### D-07 · high · README「跨实例投递当前不可用」整段描述的是**已整体删除**的模块

**位置** `README.md:162`（§4 已知限制表第 1 行）

**证据（实测）**
```
README.md:162  「投递能力**代码里已经有**，但：① 缺省关闭；② 对端白名单**缺省为空**；
                ③ 缺省启动器路径是**某台机器的实测取值** … 自己配 名字=<启动器路径>」
src/modules/tools.ts:429-432
  * ⚠⚠ **2026-10-24 · 本项目自研的跨实例投递模块已整体删除，与本常量无关**
  *   这里屏蔽的 interconnect_* 是**第三方插件 dsh-interconnect** 注册的工具名
src/config.ts:139  「**2026-10-24 起那个自研跨实例投递模块已整族退场** ⇒ 现在 modules 是 **4 个键**」
src/config.ts:195/244/558  同样标注「已退场」

$ grep -rn "launcher" src --include=*.ts
(零命中)
```

**影响**
README 教用户配一个**不存在**的配置项（`名字=<启动器路径>`）、并声明「投递能力代码里已经有」——实际该模块已删。用户会照着配、配不上、然后怀疑自己的环境。这是「文档承诺但代码未实现」的直接形态，且是**对外**的（README 是唯一入口）。

**建议**
把该行改成实况：「跨实例投递：本插件**不提供**（自研模块已于 2026-10-24 整族删除）。若你另装了第三方 `dsh-interconnect`，Hob 会话会**屏蔽**它的四个 `interconnect_*` 工具（`src/modules/tools.ts:436-444`）。」（这句可直接从代码注释取，已是准确表述。）

---

### D-08 · high · README §6 的 `check:build`「三个面」实为**五个面**，且三个行号引用**全错**

**位置** `README.md:213-219`

**证据（实测）**
```
README.md:213  「check:build 有**三个面**，只有两个面在这个入口里是判据
                （scripts/check-all.mjs 的 STRICT_FAMILIES，:52 / :69）」
README.md:216  「聚合入口**不传** --strict-instance（:56 明文「⚠ 不加」）」

实际 check-build-sync.mjs 的面对照：
:77   **面 ①：提交面**（BUILD-STAMP 的 commit=）
:80   **面 ②：内容面**（源 ↔ 产物逐对 mtime）
:25   **面 ③：运行实例落后于产物**
:85   **面 ④：产物可加载 / 包装面**（2026-10-24 新增）
:1368 **面 ⑤：孤儿产物**（失败行同样进 lag，由 --strict-source 管）

$ sed -n '100p' scripts/check-all.mjs
  ['check:build', ['--strict-source']],      <-- 真实行号是 :100，不是 :52 / :69
$ sed -n '83,101p' scripts/check-all.mjs | grep -c "不加"    -> 1（在注释里，行号约 :87，不是 :56）
```
且 `--strict-source` 管的是 **①②④⑤ 四个面**（`check-build-sync.mjs:99` / `:1295` / `:1346` / `:1372` 逐条自陈），不是 README 说的「①②两个面」。

**影响**
`npm run check` 全绿到底验了什么，README 说错了两个数量级：读者会以为「只差面 ③ 没验」，实际**面 ④（产物能不能加载）与面 ⑤（孤儿产物）也在 strict-source 里**——这两条恰好是「装了跑不起来」与「删了源没删产物」的守门员。行号全错则让想核对的人**照着跳转看到的是无关注释**。

**建议**
① 改成「**五个面**：①②④⑤ 由 `--strict-source` 管（`npm run check` 会传）、③ 需显式 `--strict-instance`」；
② 行号改成 `:100`（`STRICT_FAMILIES` 的条目）/ `:87`（注释里「⚠ 不加」那一段），或干脆**不写行号**只写符号名（行号会漂，符号名不会）。

---

### D-09 · high · `check:hob-create-ui` 的 CU-5 断言正则**永远不匹配**（恒假面）

**位置** `scripts/check-hob-create-ui.mjs:699`

**证据（实测）**
```
$ sed -n '699,700p' scripts/check-hob-create-ui.mjs
    const hasPresetGating = /currentPreset\s*!==\s*PLANNING_PRESET_ID/.test(src)
    const stillHasSetPreset = /\.setPreset\s*\(/.test(idx) || /setPreset:\s*\(v\)/.test(src)

$ grep -c "PLANNING_PRESET_ID" src/client/create-hob-dialog.tsx
0                                        <-- 只有 HOB_PRESET_ID（:39 import）
$ grep -rn "currentPreset" src/client/*.tsx
src/client/create-hob-dialog.tsx:325:  currentPreset?: string      <-- 只有类型声明，无比较
$ grep -c "setPreset" src/client/index.ts
0
```
⇒ `hasPresetGating` 恒 `false`、`stillHasSetPreset` 恒 `false` ⇒ CU-5 **恒走 else 分支打 ✓**。

**影响**
这条断言的**整个存在理由**是「防止重演『入口永不渲染』」（`:686-693` 自陈：「旧 CU-5 断言…**当时是绿的**，但那条 gating 读的 `state.preset()` 永远是 `undefined` ⇒ 入口**永不渲染**。⚠ 一条『绿着但功能永不出现』的判据，比没有判据更坏」）。修完之后**仍是同一个形态**：正则指向一个不存在的标识符，删掉它、换成别的 gating 写法，CU-5 都不会红。

**建议**
① 正则改成 `/(?:currentPreset|preset)\s*[!=]==?\s*(?:PLANNING_PRESET_ID|HOB_PRESET_ID)/`，并加一条**自证**：抽不到 `HOB_PRESET_ID` 就 `bad('CU-5 的靶子不见了')`；
② 或按本仓既有纪律（`N-F1e` / `N-R-10`）**先自证靶子存在**再断言。

---
### D-10 · medium · README 残留清单「6 类」但表只有 5 行，且「第 2 类不能删」与表内编号错位

**位置** `README.md:177` vs `README.md:182-186`

**证据**
```
README.md:177  「**残留一共 6 类**…⚠ 其中**只有 1 类不能删**（第 2 类，记录区）」
README.md:182  | 1 | **记录区**（在工作区之外） | … | ⛔ 这一条不能删 …
README.md:183  | 2 | **profile 依赖** | …
README.md:184  | 3 | profile 的 id 定向覆盖条目
README.md:185  | 4 | node_modules 里的符号链接
README.md:186  | 5 | 运行态
```
⇒ ①「6 类」实为 **5 行**；②「第 2 类 = 记录区」实为**第 1 行**。

**建议** 把「6 类」改「5 类」，把「（第 2 类，记录区）」改「（第 1 行，记录区）」。低风险、纯文案。

---

### D-11 · medium · `FAMILY_FLOOR` 余量 = 2（45 vs 47），与「零余量」纪律自相矛盾；同文件注释仍写「为什么是 20」

**位置** `scripts/check-all.mjs:143`（注释「为什么是 20」）、`:152`（`FAMILY_FLOOR = 45`）、`:154-157`（「19 = 零余量，再少一族立刻红」）

**证据（实测）**
```
$ node -e '...'   # package.json check:* 50，SELF 3 ⇒ 47
runnable families: 47
FAMILY_FLOOR: 45   slack: 2
```
⇒ **静默删掉 2 族仍然全绿**，而 `check-all.mjs:156-157` 自己写着「抬下界是本次改动的**一部分**、不是顺手改：新族若将来被人从 scripts 里删掉，下界仍停在 19 ⇒ 『少一族』无人发现（E-160 同族）。⚠ 只准升不准降」。

**影响**
这条下界存在的唯一理由就是「防静默少族」（`:129-143` 的实测案例：改名成 `gen:redeliver` ⇒ 族数 20→19，`check:gitignore` 仍 PASS）。余量 2 等于**公开容许 2 次静默少族**——与 `ASSERTION_FLOORS` 那段（`:263-287`）反复强调的「零余量」纪律**同一份文件里互相打脸**。

**建议** 把 `FAMILY_FLOOR` 抬到 47（零余量），并把 `:143` 的「为什么是 20」改成「为什么是 47」+ 本轮实测值。

---

### D-12 · medium · `check-all.mjs` 对 `exit 3` 的族数与行号**两处自相矛盾且全错**

**位置** `scripts/check-all.mjs:38-41`（说「三个族」，列 `check:hob-create-dom` / `check:policy` / `check:hob-create`）与 `:70-72`（说「四个族」，只列三个文件名 + 三个行号）

**证据（实测）**
```
$ grep -rn "process.exit(3)" scripts/*.mjs
scripts/check-hob-create-dom.mjs:1517:  process.exit(3)
scripts/check-session-policy.mjs:1859:  process.exit(3)
scripts/check-hob-create-ui.mjs:2392:  process.exit(3)
```
⇒ ① 实际 **3 个族**，`:70` 说「四个」；② 行号 `:1223` / `:1651` / `:2005` **三个全错**（应为 `:1517` / `:1859` / `:2392`）；③ 族名与文件名对不上：`check:policy` → check-session-policy.mjs、`check:hob-create` → check-hob-create-ui.mjs。

**影响**
`exit 3` 的读法（「检查器坏了，结论不可信，⛔ 不是跑 preflight」）是这套体系里**最重要的一条分档**（`:25-42` 整段在讲这个）。指路的行号错 ⇒ 真出事时按图索骥找不到栈。

**建议** 统一成「三个族」+ 正确行号；或**不写行号**，写 `grep -rn 'process.exit(3)' scripts/` 自查。

---

### D-13 · medium · `check:workflow` 文件头四条描述里**两条与实现不符**

**位置** `scripts/check-workflow.mjs:6`（F1 描述）、`:13-14`（F4 描述）

**证据（实测）**
```
:6   **F1** workflow.toml 合法：**五步齐**（order = 1..5 且 4/5 的 actor_role 不同）
:148 if (steps.length !== 7) probs.push('v3 阶段只有 ' + steps.length + ' 条（期望 7）')
$ grep -c '^\[\[step\]\]' preset/dsh-hob/workflow.toml
7
⇒ 头注释说五步，实现要 7 步

:13-14 **F4** 覆盖度：workflow.toml 的 intake 数 = prefix 正文里 ### 级**输入节**数
:508-565  F4 实际是三条 origin 判定（原文节数 == original 条数 / 无发明 / new 有出处）
:512-516 文件内注释自己说明「改前口径 = intake 数 == 输入节数 … 入口 7→10 之后这个等式恒红」
⇒ 头注释仍是改前口径
```

**影响** `check:workflow` 是本域最核心的族（33 条断言），文件头是「它守什么」的对外说明。头注释与实现不符 ⇒ 读者会按五步去理解，而实际是七步。

**建议** 头注释同步成 7 步 + F4 三条 origin 口径。

---

### D-14 · medium · `check:stages-route` 的 R-2 自称「五步」实比 **7 步**

**位置** `scripts/check-stages-route.mjs:3`（文件头「五步汇总路由」）、`:7`、`:191`（`// ── R-2 五步顺序固定 + 名字逐字`）、`:199`（错误文案「五步顺序/名字不对」）

**证据（实测）**
```
:197  const want = [[1,'需求规格'],[2,'实现方案'],[3,'任务图'],[4,'任务执行'],
                  [5,'技术验证'],[6,'产品验收'],[7,'交付收口']]      <-- 7 项
:199  probs.push('五步顺序/名字不对：' + JSON.stringify(got))          <-- 文案说五步
```

**影响** 红的时候文案说「五步」，读的人会去数 5 项、找错对象。与 D-01 同族（词表漂移的语言残留）。

**建议** 全文「五步」→「七步」（本文件与 `check-tasks-progress.mjs` 不同：后者守的**确实是**五步旧接口 `TASKS_STEP_NAMES`（`tasks-progress.ts:67`），不要一起改）。

---

### D-15 · medium · 运行时提示词写「第 4 步 actor_role = `acceptor`」，实际第 5 步是 `verifier`

**位置** `preset/dsh-hob/preset-dsh-hob.patch.yml:91` = `preset/dsh-hob/gen/persona.md:21`（生成物）

**证据（实测）**
```
patch.yml:91  ⚠ **第 4 步与第 5 步不是同一个人**（actor_role 一为 executor、一为 acceptor）。
workflow.toml:60  actor_role = "executor"     # 第 4 步 execution
workflow.toml:71  actor_role = "verifier"     # 第 5 步 verification
workflow.toml:82  actor_role = "acceptor"     # 第 6 步 acceptance
⇒ 括号里的理由错（第 5 步是 verifier，acceptor 是第 6 步）；结论「不是同一个人」仍成立
```
F1 核的是 `s4.actor_role === s5.actor_role`（`check-workflow.mjs:154`）⇒ 结论对，机检不报。

**影响** 这句话会**原样进模型上下文**。模型若照它推理「第 5 步是验收人」，会把「技术验证」当成「产品验收」—— 恰好踩了宪法第 8 条「测试通过 ≠ 产品验收」的反面。

**建议** 改成「`actor_role` 一为 `executor`、一为 `verifier`（第 6 步才是 `acceptor`）」；来源在 `scripts/gen-preset-contract.mjs:229`（生成器硬编码这句），改那里 + 重跑生成器。

---

### D-16 · medium · `TERMINOLOGY.md` 明令「不称记录区」，README 全篇用了 **8 次**

**位置** `TERMINOLOGY.md:44`「| 正式账本 | `项目账本` | **不称文档堆、记录区或缓存** |」；`README.md:132 / :166 / :177 / :182 / :186 / :208`

**证据（实测）**
```
$ grep -o '记录区' README.md | wc -l
8
$ grep -rn '记录区' scripts/*.mjs
(零命中)                    <-- 没有任何机检扫术语
```

**影响** 术语表是「对外定位的单一说明」（`TERMINOLOGY.md:3`），它自己立的规矩在**唯一对外入口**里被违反 8 次，且无机检。

**建议** ① README 的「记录区」统一改「账本区」或「项目账本」；② 或把 `TERMINOLOGY.md:44` 的禁令缩到「不称『文档堆』『缓存』」（`记录区` 作为内部实现词保留，但要在术语表里**显式登记为别名**）。**这条需要用户拍板** → 见文末 [建议决策]。

---

### D-17 · medium · `TERMINOLOGY.md` 的账本 kind 表**漏掉 `verification` 与 `closure`**，而同文件下一节又要求它们

**位置** `TERMINOLOGY.md:51-62`（10 行 kind 表）vs `TERMINOLOGY.md:66-67`

**证据（实测）**
```
TERMINOLOGY.md:51-62  goal/req/change/task/run/acc/evidence/risk/decision/cap
                      （10 个，ID 前缀 G-/R-/CHG-/TSK-/RUN-/ACC-/EVD-/RSK-/DEC-/CAP-）
TERMINOLOGY.md:66-67  「新 req/change/task/run/verification/acc/closure 必须带 pipeline_version="v3"」
                      （要求 7 种，含 verification/closure）

src/shared/ledger-validation.ts:14-26  UNIT_STATUSES 共 12 个 kind（含 verification / closure）
src/shared/ledger-resources.ts:75-76   /^VER-\d+$/ → verification · /^CLS-\d+$/ → closure
```

**影响** 同一份术语表**自己内部矛盾**：表里没有 `verification` / `closure`，下一节又要求它们带 v3 字段。且 ID 前缀表缺 `VER-` / `CLS-`，而代码明确支持。用户/新人查术语表会以为 v3 只有 10 类单元。

**建议** 表里补两行（`verification` | 技术验证 | `VER-` | 独立技术验证单元；`closure` | 交付收口 | `CLS-` | 风险启用的交付门），并在 `TERMINOLOGY.md:44` 附近注明「v3 新增两类」。

---

### D-18 · medium · `kit/drafts/` 两份文档仍指向**不存在**的 `.hob/drafts/preset-contracts.md`

**位置** `kit/drafts/growth-registry.md:33 / :57 / :74`、`kit/drafts/contract-verification-notes.md:4 / :13`

**证据（实测）**
```
growth-registry.md:33  | 骨架 | .hob/drafts/preset-contracts.md | 全文 | … |
contract-verification-notes.md:4  人读版 = .hob/drafts/preset-contracts.md。
$ ls .hob/drafts
ls: cannot access '.hob/drafts': No such file or directory
真实路径：kit/drafts/preset-contracts.md（check-preset-contracts.mjs:96  const DRAFT）
```

**影响** `growth-registry.md` 是「下一层该拆什么」的决策依据（`:69-74` 有明确的字节数阈值与动作），路径错 ⇒ 照它做会找不到对象。`contract-verification-notes.md` 是契约来历的说明件，路径错 ⇒ 溯源断。

**建议** 两份统一改 `kit/drafts/preset-contracts.md`；`growth-registry.md:33/57` 的字节数（56754 / 8782）也需重测（当前文件 838 行）。

---

### D-19 · medium · `check-all.mjs` 自述的「同一族名只许出现一次」纪律**无机检**

**位置** `scripts/check-all.mjs:288-304`（整段纪律，自陈「本行曾经有两行 `['check:experience', 9]`」）

**证据（实测）**
```
$ node -e '...'   # 按行锚定解析 ASSERTION_FLOORS
floor entries (line-anchored): 46
dups: []                      <-- 当前无重复（纪律被执行过）
```
但**没有任何断言检查重复**：`ASSERTION_FLOORS` 是 `new Map([...])`（`:177`），重复 key 后者覆盖前者，运行期等价 ⇒ 不会红。同一段注释里说的「⚠ 发现别处也有重复项时，只报不顺手删」也没有对应实现。

**影响** 这正是注释自己描述的失败形态：「改上面那行 ⇒ 被下面那行覆盖 ⇒ **改动静默失效**；而改的人看着 diff 里确实『改了一行』，会以为生效了」。纪律靠人守 = 迟早复发。

**建议** 在 `check-all.mjs` 的 `printSummary` 开头加一条：解析自身源码的 `ASSERTION_FLOORS` 条目，**重复 key ⇒ 记 `floorViolations`**（几行代码，零依赖）。负向对拍：临时复制一行 ⇒ 必红。

---
### D-20 · low · `check:readings` 的强制范围从 R208 起、仅 3 条断言、0 条负控，却承载宪法第 9 条

**位置** `scripts/check-readings-citable.mjs:108` `export const STRICT_FROM = 208`；`scripts/check-all.mjs:691` `['check:readings', 3]`；`meta-negative-floor.json:24` = 0

**证据（实测）** `npm run check:readings` ⇒「查了 3 处 · 过了 3 处 · 跳过 0 处」

**影响** 宪法第 9 条「没有读数不能陈述为事实」是本项目最核心的不变量之一，其机检强度 = 3 条正例 + 0 条反证 + 只覆盖 R208 之后。`CONSTITUTION.md:14` 却把它标成有 `checked_by`（见 D-04）。

**建议** 与 D-02 / D-04 合并处理；至少把 `STRICT_FROM` 的历史豁免在宪法条款里写明（「R208 前为历史豁免」），别让读者以为全覆盖。

---

### D-21 · low · `check:hob-unselected-gate` 硬编码本机绝对路径（fail-closed 正确，但换机必红）

**位置** `scripts/check-hob-unselected-gate.mjs:1830` `const REAL_STORE = '/home/lk/.dsh/hob-ledgers/dsh-hob/runtime/session-policy.json'`；`:1835` `const REAL_ZSTD = '/home/lk/.dsh/sessions/--home-lk-FF-dsh-hob--/session-e6dfdf31-…/session.v4.jsonl.zstd'`

**证据（实测）**
```
:1853-1855  if (realEpoch === undefined || realCreatedAt === undefined) {
              bad('G-25 基准 ⚠ 取不到真盘输入… ⇒ 不按通过处理（⛔ 不写常数顶替）') }
```
fail-closed 正确（不拿常数顶替），但**换机器/换会话 id 必红**，且 `README.md:132` 明令「缺省不含任何本机绝对路径」——判据侧自己违反了这条口径。

**建议** 路径从环境变量（`DSH_HOME` + `dsh-hob.workspace.json` 派生）取，取不到再 fail-closed；这样「不按通过处理」的语义不变、但换机不再必红。

---

### D-22 · low · `check:profile --fix` 会写盘，聚合入口目前不带 `--fix`（安全，但缺一道保险）

**位置** `scripts/check-profile-assembly.mjs:71` `const FIX = ARGV.includes('--fix')`；`:732` `writeFileSync(manifestPath, plan.text, 'utf8')`；`package.json:70` `check:profile` 不带 `--fix`

**影响** 当前安全。但 `check-all.mjs` 的 `STRICT_FAMILIES`（`:83-101`）是**唯一**给族传参的地方，将来若有人把 `check:profile` 加进去并传 `--fix`，聚合入口就会写用户 profile。

**建议** 在 `check-profile-assembly.mjs` 加一条：`if (process.env.CHECK_ALL === '1' && FIX) bad('--fix 不许在聚合入口里跑')`，或在 `check-all.mjs` 的 `STRICT_FAMILIES` 注释里显式写「⛔ 不许给 check:profile 传 --fix」。

---

## ⑤ 与其他域的边界与疑点

### 5.1 跨域确认请求（来自 `pipeline-auditor` 的 t1 报告）

#### (b) 「六阶段还是七阶段」的裁定

**多处文档的表述 —— 结论：文档面内部一致，不矛盾。**

| 文档 | 原话 | 阶段数表述 |
|---|---|---|
| `preset/dsh-hob/CONSTITUTION.md:8` | 「**正式六阶段固定**，需求与方案两步须用户批准当前修订…**G6 交付收口按风险启用**」 | 六 + 门 |
| `TERMINOLOGY.md:42` | 「Pipeline v3 \| 需求、方案、任务图、执行、技术验证、产品验收；**交付收口按风险启用**」 | 六 + 门 |
| `kit/drafts/architecture-overview.md:95-97` | 「正式六阶段…**交付收口是产品验收后的风险启用门，不冒充第七个业务阶段**」 | 六 + 门（**最明确**） |
| `kit/templates/GATES.md:30` | 「## 2. Pipeline v3 **正式六阶段与 G6 交付门**」 | 六 + 门 |
| `kit/drafts/preset-contracts.md:63` | 「**B3 · 正式六阶段** … 其后 G6 交付收口按风险启用」 | 六 + 门 |
| `preset/dsh-hob/workflow.toml:18-93` | 7 个 `[[step]]`，order=1..7，closure 是 order=7 | **七步编号** |
| `TERMINOLOGY.md:66-67` | 「新 req/change/task/run/**verification**/acc/**closure** 必须带 pipeline_version」 | **七类单元** |

⇒ **五份文档口径一致**（六阶段 + 风险启用门），**两份文档用七**（`workflow.toml` 的 step 表、`TERMINOLOGY.md:67` 的单元清单）—— 但这两处说的是「**编号**」与「**单元种类**」，不是「业务阶段数」。**不构成互相矛盾**。

**代码用 7 个 id 是「六阶段 + 一个风险启用门」的实现，还是真多了一个业务阶段？—— 裁定：是「六阶段 + 门」的实现，但代码在**用户可见面上把门说成了步**。**

证据：
- `src/shared/pipeline.ts:44-47` 的注释是权威口径：「`closure` is a risk-gated delivery stage, **not a replacement for product acceptance**: a chain may be product-accepted while delivery remains closed.」⇒ 代码作者自己也把它定义成「门」；
- `closureProblems`（`pipeline-view.ts:328-329`）只核三件事：`skipped` 有理由 / `standard` 有证据 / `strict` 有回滚监控 —— 它**没有独立的产出物类型**（不像 req 有规格、change 有方案、task 有任务书）；
- **但**：`pipeline-view.ts:481` `activeStage = 7`、`:492` `activeStage = null`，且 `src/client/project-panel.tsx:2473` 直接渲染 `当前阶段：第 ${selectedPipeline.activeStage} 步` ⇒ 用户看到的是「第 7 步」。这就是「门被说成步」。

**应以哪份为准、需要改哪一句（建议，不真改）：**

- **以「六阶段 + 风险启用门」为准**。理由：五份文档一致 + `pipeline.ts:44-47` 的代码注释同口径 + `closure` 无独立产出物。
- **建议改动（两处，最小）**：
  1. `src/shared/pipeline-view.ts:481`：把 `activeStage = 7` 改成 `activeStage = 6` + 新增 `closurePending: true`（`PipelineView` 接口已有 `closureMode`（`:69`），加一个同族布尔即可）；
  2. `src/client/project-panel.tsx:2473`：把 `当前阶段：第 ${activeStage} 步` 改成「第 6 步 · 产品验收（已过）· 待交付收口」这类**门**的措辞。
  - 这样「六阶段」在代码里**成立**，G6 仍是门，`PIPELINE_STAGES` 保留 7 项（它只是清单，不是 activeStage 的值域）。
- **不建议改** `CONSTITUTION.md:8` / `architecture-overview.md:96` / `TERMINOLOGY.md:42` / `GATES.md:30` —— 它们已经写对了。
- **另需改（独立于本裁定）**：`src/shared/stage-controls.ts:5` 的注释写「正式六阶段由 `pipeline-view.ts` 统一投影」是对的，但同文件 `:22` 的 `tasks: '编码任务'` 与其余六份「任务图」冲突（见 D-01）—— 这是**步名**问题，不是阶段数问题，不要混。

#### (补充) 六份阶段词表：**文档里有「唯一」承诺，但承诺只到「闸门/责任方」这一层，没覆盖「步名」**

**承诺确实存在（四处）**：
- `TERMINOLOGY.md:81-82`「**唯一当前阶段**：由 `pipeline-view.ts` 生成的 Pipeline 视图。**面板、阶段接口和派发门禁都消费它，不从全局账本另算一套**。」
- `TERMINOLOGY.md:107`「`src/shared/pipeline-view.ts` \| **唯一当前阶段 / 闸门 / 责任方投影**」
- `kit/drafts/architecture-overview.md:88-89`「当前闸门与责任方**只由 `pipeline-view.ts` 提供**。`/stages` 的 `pipelines` 与 `/requirement-chains` 的 `pipeline` 都是这份视图的投影，**面板不得另算一套**。」
- `kit/drafts/preset-contracts.md:170`「## Pipeline v3（唯一当前阶段）」

**代码的实况**：
- 「闸门 / 责任方」**确实只有一份**：`pipelineViewOf()` 是唯一入口（`requirement-chain.ts:341`、`stages-index.ts:425` 都调它），`check-pipeline.mjs:320-325` 钉住 `PIPELINE_STAGES` 的 id 序；
- 「**步名**」有 **7 份字面量**（见 D-01 列表），且**已有一份漂了**（`stage-controls.ts:22` 的 `'编码任务'`）；
- **没有任何断言比对步名**（`grep -rn 'STAGE_NAMES|STAGE_DEFS|STAGES_STEP_NAMES|STEP_NAMES' scripts/*.mjs` ⇒ 只有 `gen-ledger.mjs:22` 的消费与 `check-stages-panel-dom.mjs:207` 的自比）。

**判定：属于「文档承诺未实现」，但需要精确表述** —— 承诺的字面是「唯一当前阶段 / 闸门 / 责任方」，代码**做到了**；承诺**没写到**「步名唯一」，而步名实际有 7 份且已漂。⇒ 这不是「文档说了 A 代码做了 B」的严格形态，而是「**文档的承诺边界画在了步名之外，而步名恰恰是用户/模型都能看到的那一层**」。**编号 D-01**（按「文档承诺未覆盖但实际已漂」处理，等级 blocker，因为它同时影响账本生成、面板、模型上下文三处）。

**建议的文档修订（一处，最小）**：把 `TERMINOLOGY.md:81` 的「唯一当前阶段」扩成「**唯一阶段定义（含 id / 步号 / 步名）**：`pipeline-view.ts` 的 `PIPELINE_STAGES` 是唯一步名来源，其余模块必须 import 或派生，不得另立字面量」，并同批加机检（D-01 建议 ②）。

### 5.2 我无法单独判断的（需其他域确认）

| # | 疑点 | 需要谁 |
|---|---|---|
| Q1 | `src/shared/stage-controls.ts:22` 的 `'编码任务'` 是**有意保留的旧词**（对应 `LEGACY_STEP_DEFS`）还是**漏改**？它被 `gen-ledger.mjs:1267` 写进账本 `CONTEXT.md`，若是有意，需要在文档里说明「账本阶段控制块用旧词」 | 账本域 / 编排域 |
| Q2 | `pipeline-view.ts:481` 的 `activeStage = 7` 改动会牵动 `/stages`、`/requirement-chains`、面板 DOM 断言（`check:stages-dom` 137 条）—— 是否值得？需要客户端域评估改动面 | 客户端域 |
| Q3 | `src/modules/tools.ts:399-400` 的注释说「留空时退到兄弟目录」，`doc-read.ts:139-146` 说「留空 ⇒ undefined」，`preflight.mjs:48-50` 又实现了兄弟目录 —— 三者谁是**设计意图**？（代码行为是 undefined，但两处注释与一个脚本仍是旧档） | 主链域 / 策略域 |
| Q4 | `check:readings` 的 `STRICT_FROM = 208` 历史豁免，是否应在 `CONSTITUTION.md:14` 的第 9 条 `checked_by` 里显式写明？（否则读者以为全覆盖） | 主链域 / 用户裁定 |
| Q5 | `kit/parts/*.md`（6 份）被 `kit/README.md:50-63` 索引，但 `scripts/*.mjs` **零引用**（`grep -rn 'kit/parts' scripts` = 0）⇒ 这 6 份是否属于「骨架内容、按设计不入机检」，还是漏了？ | 骨架/kit 归属（可能无主） |

---

## [建议决策]（需用户拍板，只给选项与推荐，不擅自改）

**SD-1** 术语「记录区」是否保留 \| 选项：**A** 全面改「账本区」（改 README 8 处 + 术语表登记为禁用词）；**B** 保留「记录区」作为内部实现词、在 `TERMINOLOGY.md:44` 显式登记为别名 \| **推荐：B** 理由：「记录区」在 README 里指的是**磁盘落点**（`<ledgerHome>/<工作区名>/`），与「项目账本」（内容对象）不是同一件事，硬改会让「记录区在工作区之外」这句话失去主语；但必须在术语表里登记，否则 D-16 会反复复发。

**SD-2** 阶段数在**用户可见面**怎么显示 \| 选项：**A** 保持「第 7 步 · 交付收口」（现状，与文档「六阶段」冲突）；**B** 改成「第 6 步 · 产品验收（已过）· 待交付收口」（文档为准，代码改 2 处）\| **推荐：B** 理由：五份文档 + `pipeline.ts:44-47` 的代码注释都写「门不是阶段」，只有 UI 投影把门说成步；B 的改动面是 2 行（`pipeline-view.ts:481` + `project-panel.tsx:2473`），而 A 需要改 5 份文档。

**SD-3** 宪法 `checked_by` 的真假 \| 选项：**A** 补机检（新增「指针必须解析到真实断言标签」一条 + 负向对拍）；**B** 把三条假指针改成「无机检（仅提示词约束）」如实标注 \| **推荐：A 先做、B 兜底** 理由：A 是本仓一贯纪律（「判据恒绿比没有判据更坏」），但 A 需要先把第 1/2/6 条接到**真实存在**的断言上——若一时接不上，按 B 如实写「无机检」也比现在的假指针好。

---

## 附：本域缺陷计数

| 等级 | 条数 | 编号 |
|---|---|---|
| blocker | **3** | D-01 · D-02 · D-03 |
| high | **6** | D-04 · D-05 · D-06 · D-07 · D-08 · D-09 |
| medium | **10** | D-10 · D-11 · D-12 · D-13 · D-14 · D-15 · D-16 · D-17 · D-18 · D-19 |
| low | **3** | D-20 · D-21 · D-22 |
| **合计** | **22** | |

**未发现**（查过但没有真问题，如实登记）：
- `scripts/*.mjs` 62 份**没有孤儿**：48 份 `check-*.mjs` 中 45 份被 `check:*` 直接调用，3 份（`check-code-face` / `check-doc-shape` / `check-repo-rules`）是纯库、已在 `check-repo-rules.mjs:711-734` 的 `SCRIPT_LANDING_EXEMPT` 逐条登记理由，且该白名单有「幽灵条目 / 自相矛盾条目」双向自检（`:762-771`）；
- `typecheck` **可离线跑通**（`npm run typecheck` ⇒ exit 0，无需网络）；`check:build` 面 ② 实测 73 对逐对核过、面 ④ `lib/client.js` 真加载（10 个槽条目）、面 ⑤ 224 个产物零孤儿；
- `ASSERTION_FLOORS` 当前**无重复 key**（46 条、逐行锚定解析、dups = []），`meta-negative-floor.json` 50 族全覆盖无 MISSING；
- `gen/persona.md` 与 `prefix` 正文**逐字节一致**（实测：prefix body 654 行 / 43364 字符，gen 655 行 / 43365 字符，唯一差异是末尾换行）；
- `gen/contracts.md:6` 自述的 SHA-256 `0068713a…` 与 `sha256sum` **逐字相同**，字符数 43365 / 字节数 49628 也相同；
- `dsh-hob.workspace.json` 内容 `{"workspaceName":"dsh-hob"}`，与 `doc-read.ts:198` / `scripts/workspace-name.mjs:37` 的字段名一致，且 `check-code-face.mjs` 的 S1/S2 逐字比对通过。
