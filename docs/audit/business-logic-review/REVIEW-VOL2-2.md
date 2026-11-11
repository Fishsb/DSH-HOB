# REVIEW 分卷 2-2

> ⚠ 本文件是 `REVIEW.md` 的分卷（§4 裁定 + §5 缺陷总表按小节再拆）。
> 原文件 210KB 超 64KB 读上限，按 M 判据处置：**整块搬走 + 原位留指针**。

---

### 5.2 形态 ② 自比式自检 / 自证（S · 16 条）

> 这一组是本次审计**最独特**的发现：判据校验的是「A 声称自己是 A」，而不是「A 与外部事实 B 一致」。
> 它们分两层：**运行态自证**（S-01…S-05）与**机检自比**（S-06…S-15）。两层是同一件事的不同尺度。

#### S-01 · blocker ·「用户批准」是自证链：被校验方即写入方

- **位置**：`tools.ts:2081`（`decided_by = "user"` 硬编码）、`:2051-2058`（自填 `source` 正则）、`:2107`（`validateLedgerStructure:false`）；`pipeline.ts:351-353`、`:435`（校验同一个字段）；`src/preset/tools.ts:1211-1213`（档 1 含 `write_hob`）；`hob-write.ts:163`（路径白名单）；`pipeline.ts:199-205`（FNV digest）
- **证据等级**：**实测**（主控端到端 `/tmp/probe19.mjs`；本次回源 `tools.ts:2070-2085` 原文确认 `decided_by` 是字面量）
- **是什么**：见 §3.1 链 A。三段证据合起来 = Hob 可单方面制造一条合法的「用户批准」。
- **关键洞察（主控 §5.1）**：`hob_pipeline_approve` 的 `description` 自称「记录用户对 Pipeline v2 需求或方案的明确批准」，`source` 的说明是「用户回执原文」——**工具契约把「用户回执」定义为一段字符串，而非一次用户操作**。这不是实现疏漏，是**契约层面的定义问题**：当前架构里根本不存在「用户直接触发工具」的通路。
- **⇒ I-4（Hob 不能自批）在当前架构下不可能真正成立**，除非引入「用户本人触发」的独立通路。
- **怎么证明修好了**（分三档，见 §7.1）：
  - **若采纳 A**：机检 `write_hob('ledger/units/unit-pipeline-approval.toml', …)` ⇒ 必须被拒（白名单排除）；**负向对拍**：放开该路径 ⇒ 断言红。
  - **若采纳 B**：机检：写一条 `source="继续"` 的 decision ⇒ `approvalDecisionProblems` 必须非空；**负向对拍**：把正则放宽成「非空即可」⇒ 断言红。
  - **若采纳 C（推荐）**：机检：decision 单元必须携带 `decided_by_message_id`，且该 id 能在**宿主会话事件流**里查到、且内容匹配回执模式；**负向对拍**：伪造一个不存在的 message id ⇒ 必须被拒。**这是唯一能证明 I-4 成立的断言**。

#### S-02 · blocker · `clarify_legacy` + `created_at` 两个自填字段可跳过 11 类门禁

- **位置**：`stage-controls.ts:271`（`legacy` 只看单元自己的字段）、`:275-286`（`legacyMisuse` 的反制也读自填 `created_at`）、12 处 `legacy(u)` 豁免
- **证据等级**：**实测**（本次独立复现 `/tmp/syn_probe_exempt.mjs`：正常 4 条 → 加两字段 0 条；主控 `/tmp/lead_probe_exempt.mjs` 同结论）
- **是什么**：见 §3.2 链 B。注释明写「⛔ 不是新需求的放行开关」（`:270`），**注释与实现相反**。
- **怎么证明修好了**：
  1. `legacy` 判据改用**不可自填**的事实（账本 `ledger.toml` 的 `created_at`/`generation`，或单元位于 `unit-01..unit-06` 这类历史分片）；
  2. 机检：一条 `pipeline_version='v3'` 的单元写 `clarify_legacy='pre-control'` ⇒ 必须报 C-11，**无论 `created_at` 是什么**；
  3. **负向对拍**：把 `legacy` 判据改回读 `clarify_legacy` ⇒ 断言必须红；
  4. 命令：`node /tmp/syn_probe_exempt.mjs` 的 `exemptCount` 必须等于 `normalCount`（4）。

#### S-03 · medium · 验收「自己验自己」依赖 `built_by`，`built_by` 缺失时静默放行

- **位置**：`stage-controls.ts:528-536`
- **证据等级**：**实测**（t1 `/tmp/pa_probe2.mjs`：父任务无 `built_by` ⇒ `acceptanceProblems` 返回 `[]`；补上 `built_by:'dev'` ⇒ 立刻 2 条 C-7）
- **是什么**：`if (builder !== '' && acceptor === builder)` —— **缺失反而让检查更容易通过**，这是 fail-open。
- **对照**：`convergence.ts:378-381`（K-6）对同一件事是 fail-closed（`builder === ''` 会报红「没法判是不是自己验自己」）。**同一语义、两个模块、一 fail-open 一 fail-closed。**
- **怎么证明修好了**：与 K-6 对齐，`builder === ''` 时报「无法判定独立性」；机检：父任务无 `built_by` + 验收者 = 实现者 ⇒ `acceptanceProblems` 必须非空。**负向对拍**：改回 `builder !== '' &&` ⇒ 断言红。

#### S-04 · medium · `evaluateGate` 对不存在的作用域 id 返回 `go`

- **位置**：`stage-controls.ts:989-992`（`gateScopeUnits` 找不到 root ⇒ 空集）、`:1115-1121`（空集 ⇒ `blockers=[]` ⇒ `go`）
- **证据等级**：**实测**（t1 `/tmp/pa_probe4.mjs`：`evaluateGate({scope:{kind:'task',id:'NOPE'}, units:[]})` ⇒ `{decision:'go'}`）
- **是什么**：**已被调用方补掉**（`tools.ts:640-660` 在 `stageGateAtLedger` 里先做存在性核对，注释 `:622-639` 记录了这次实测事故）。所以**当前不构成可利用漏洞**，但 `evaluateGate` 本身仍是 fail-open 的纯函数，**任何新调用方会直接踩中**。
- **怎么证明修好了**：把「root 不存在 ⇒ hold」下沉进 `evaluateGate`；机检：`evaluateGate({scope:{kind:'task',id:'NOPE'}})` ⇒ `decision === 'hold'`。**负向对拍**：改回空集即 go ⇒ 断言红。

#### S-05 · low · C-29 收口绑定引用只查非空，从不解析目标

- **位置**：`stage-controls.ts:755-765`
- **证据等级**：**实测**（`grep -rn 'chain_acceptance_ref'` 全部是「写入」或「展示」，无一处做引用解析）
- **是什么**：填一个**不存在的 id** 即可满足 C-29。「G6 不得静默改写 G5」这条注释（`:750-754`）退化为「三个字符串非空」。与 `convergence.ts` 里 K-2/K-3/K-5 那种「悬空引用即红」的口径不一致。
- **怎么证明修好了**：三项都加存在性 + kind 校验；机检：`chain_acceptance_ref='ACC-NOT-EXIST'` ⇒ 必须报 C-29。**负向对拍**：改回只查非空 ⇒ 断言红。

#### S-06 · blocker · 元规则 M-1 的 10 个族负控下限 = 0 ⇒ 零负控也永远绿

- **位置**：`scripts/meta-negative-floor.json:4-53`（下限为 0 的族）；判据 `scripts/check-meta-negctl.mjs:142-144`（`if (got < floor[fam])`）
- **证据等级**：**实测**（本次 `cat` 该 json 与 `sed` 判据；`grep -c '负向对拍' scripts/check-work-plan-runtime.mjs` = **0**，而 `check-all.mjs:201` 为它登记断言下界 **42**）
- **是什么**：`floor[fam] === 0` 且 `got === 0` ⇒ `0 < 0` 恒假 ⇒ **一条负向对拍都没有也不会报**。
- **完整名单（实测 10 个）**：`check:all` / `check:build` / `check:host` / `check:preflight` / `check:profile` / `check:readings` / `check:rounds` / `check:selfwake` / `check:tasks-route-http` / `check:work-plan-runtime`。
  复核命令：`node -e "const j=require('./scripts/meta-negative-floor.json');const z=Object.keys(j.floor).filter(k=>j.floor[k]===0);console.log(z.length, z.join(', '))"` ⇒ **10**（`meta-negative-floor.json` 共 50 族，与 `package.json` 的 `check:*` 50 个键双向无缺失）。
  ⚠ 演进轨迹：t6 报 7 个 → 本次首轮复数为 9 个 → **主控终核为 10 个（漏了 `check:preflight`）**。本文档采用终核值。
- **最重的一处**：`check:work-plan-runtime` **42 条断言、0 条负向对拍**。且 `:212`/`:214` 确实有「负向①」「负向②」的**注释**，只是没打 `负向对拍` 标签 ⇒ M-1 数不到。**这不是「没写负控」，而是「写了负控但计数器看不见」。**
- **元规则的自我否定**：`check-meta-negctl.mjs:3` 自述「每条判据都必须自带一条负向对拍」——**元规则对自己没有牙**。
- **怎么证明修好了**：
  1. 把上述 10 族的 `meta-negative-floor.json` 下限从 0 抬到 ≥1；
  2. 在 `check-meta-negctl.mjs` 加一条：**有断言下界（`ASSERTION_FLOORS`）的族，负控下限不得为 0**——把两张表焊起来；
  3. M-1 口径补上「注释里的『负向①』不算」，并在输出里**点名**哪几族是 0（现在只在合计行里隐含）；
  4. **负向对拍（这条机检自己的对拍）**：临时把某一族的负控下限改回 0 ⇒ 新断言必须红。

#### S-07 · high · CONSTITUTION 的 `checked_by` 指向不存在的断言，机检只核字样

- **位置**：`preset/dsh-hob/CONSTITUTION.md:5/6/10/14`；判据 `check-workflow.mjs:398`（只判「含 `checked_by` 字样」）
- **证据等级**：**实测**（主控 §9 / t6 D-04：`:5`/`:6` 指向 F5，而 F5 只管附注卷；`:10` 指向 F1，`grep budget check-workflow.mjs` 只命中文件名、零条 budget 断言；`:14` 指向 `check:readings`，而它 `STRICT_FROM = 208` 只覆盖 R208 之后）
- **是什么**：F3 的判定只有三样：`bytes <= 2048`、`clauses.length > 0`、每组含 `checked_by` 字样。**指向的断言是否存在、是否真的在守那一条，完全不核。** ⇒「宪法每条都有机检」在**形式上**成立、**实质上**不成立。
- **怎么证明修好了**：
  1. `checked_by` 加**可解析格式**（如 `check:workflow#F5`），`check-workflow` 新增一条：逐个 `check:X#Y` 去该族源码里找 `Y` 标签，找不到 ⇒ 红；
  2. **负向对拍**：把 F5 改成 F99 ⇒ 必须红；
  3. 第 6 条要么补一条 budget 断言，要么改成「无机检（仅提示词约束）」——**如实写比假指针好**。

#### S-08 · ~~high~~ **已排除** · CU-5 断言正则指向已改名常量 ⇒ 恒假面

> ⚠⚠ **本条经后续复核判定为「不成立」，已移出缺陷清单**（2026-11-10 · 实施阶段复核）。
>
> **原判断**：正则 `/currentPreset\s*!==\s*PLANNING_PRESET_ID/` 永不匹配 ⇒ `hasPresetGating` 恒 `false`
> ⇒ 这条判据不可能再变红。
>
> **复核结论**：**这个理解是错的。** 那个正则**不是**「用来匹配靶子的」，
> 而是用来匹配「**必须被禁止的写法**」的 —— 判据问的是
> 「源码里**有没有**出现 `currentPreset !== PLANNING_PRESET_ID` 这种 gating」，
> 有 ⇒ `bad()`；没有 ⇒ `ok()`。**「匹配不到」正是它应该通过的状态。**
>
> **实测**：`node scripts/check-hob-create-ui.mjs` ⇒ `✓ CU-5 ✓ 入口不依赖宿主预设状态`。
> 且这条判据**本身是改判过的**：注释 `:686-694` 明确记录「旧 CU-5 断言入口 `!== PLANNING_PRESET_ID` 时
> return null，它当时是绿的，但那条 gating 读的状态永远是 undefined ⇒ 入口永不渲染
> ⇒ **现在改判相反的性质**：入口**不得**依赖那个读不到的状态」。
>
> ⇒ **本条的成因是「审计时读到的旧版本」与「当前代码」之间的时差**，不是缺陷。
> ⛔ 不计入 112 条的有效缺陷数；⛔ 不要按它去改 `check-hob-create-ui.mjs`。
>
> 以下为**原始记录**（保留以便对照）：

- **位置**：`scripts/check-hob-create-ui.mjs:699`（`/currentPreset\s*!==\s*PLANNING_PRESET_ID/`）
- **证据等级**：**实测**（主控 §9.4：`grep -c 'PLANNING_PRESET_ID' src/client/create-hob-dialog.tsx` = **0**，实际是 `HOB_PRESET_ID`）
- **是什么**：正则永远不匹配 ⇒ `hasPresetGating` 恒 `false` ⇒ **这条判据不可能再变红**。
- **讽刺之处**：它自己的注释（`:686-690`）写着「⚠ 一条『绿着但功能永不出现』的判据，比没有判据更坏」——**它正在重演自己记录的失败模式**。
- **怎么证明修好了**：
  1. 正则改成 `/(?:currentPreset|preset)\s*[!=]==?\s*(?:PLANNING_PRESET_ID|HOB_PRESET_ID)/`；
  2. **先自证靶子存在**：抽不到 `HOB_PRESET_ID` 就 `bad('CU-5 的靶子不见了')`（本仓已有 `N-F1e`/`N-R-10` 的先例）；
  3. **负向对拍**：删掉 `create-hob-dialog.tsx` 里的 gating ⇒ CU-5 必须红。

#### S-09 · medium · 17 处 `as any` 把 `/stages` 线格式的契约漂移藏起来

- **位置**：`project-panel.tsx:1064-1068`（state 类型只声明 3 个字段）vs `:1280-1306`（写入 9 个字段 + `as any`）vs `:1703-1709`（读侧全靠断言）
- **证据等级**：**实测**（`grep -c 'as any' src/client/project-panel.tsx` = **17**）
- **是什么**：`StagesOk` 在 `stages-index.ts:142-204` 有完整类型，客户端一个都不 import。⇒ 服务端改字段名 ⇒ **TypeScript 全绿**、面板静默显示「判不出」。
- **它是 `T-09` 与 `R-24` 的「藏身之处」**：如果用的是真类型，编辑器会直接标出「声明了但未使用」。
- **怎么证明修好了**：`import type { StagesOk }`，state 直接用 `StagesOk`，删掉 `:1306` 的 `as any`；机检：`grep -c 'as any' src/client/project-panel.tsx` 必须下降，且 `npm run typecheck` 仍 exit 0。**负向对拍**：把 `StagesOk.stageHealth` 改名 ⇒ typecheck 必须红。

#### S-10 · medium · `FAMILY_FLOOR` 的分母不是族总数，余量无法由族总数推出；与「零余量」纪律存在张力

- **位置**：`check-all.mjs:143`（注释「为什么是 20」）、`:152`（`FAMILY_FLOOR = 45`）、`:154-157`（「19 = 零余量，再少一族立刻红」）
- **证据等级**：**实测**（本次 `sed` 原文 + `node -e`：`package.json` 的 `check:*` = 50 个，`meta-negative-floor.json` 也是 50 个键，两边**双向无缺失**）
- **是什么**：`FAMILY_FLOOR=45` 是 `check:all` **运行时实际跑到的族数**（`results.length`，判据在 `:1162` `results.length < FAMILY_FLOOR`）下界；`results` 是它**实际调用的**族，**不等于** `package.json` 的全部 50 个。
  ⇒ **「族总数 − SELF 数」与 `FAMILY_FLOOR` 不是同一个分母，余量不能由族总数做减法得出**；需实测 `results.length` 才能定余量。
  ⇒ 可确认的是：该值与同一文件 `:156-157`「⚠ 只准升不准降」、`:263-287`「零余量」的纪律**存在张力**，且与 `check-all.mjs:594` 自述的「下界**零余量**（345 = 实测通过数）」口径不一致——同一份文件里两种「下界」哲学。
- **怎么证明修好了**：先跑一次 `npm run check:all` 记下真实 `results.length`，再把它设为 `FAMILY_FLOOR`（零余量），并把 `:143` 的「为什么是 20」改成「为什么是 <实测值>」+ 本轮读数；同时在 `:154-157` 注明「本值 = 运行时族数，不是 `package.json` 的 `check:*` 总数」。**负向对拍**：从 `package.json` 删一族 ⇒ `check:all` 必须红（当前若余量 >0 则可能仍绿——这正是本条要消除的）。

#### S-11 · medium · `ASSERTION_FLOORS` 的「同族名只许出现一次」纪律无机检

- **位置**：`check-all.mjs:288-304`（整段纪律，自陈「本行曾经有两行 `['check:experience', 9]`」）
- **证据等级**：**实测**（本次按行锚定解析：46 条、dups = `[]`——**当前无重复，纪律被执行过**）
- **是什么**：`ASSERTION_FLOORS` 是 `new Map([...])`，重复 key 后者覆盖前者，运行期等价 ⇒ **不会红**。纪律靠人守 = 迟早复发。
- **怎么证明修好了**：`printSummary` 开头解析自身源码的 `ASSERTION_FLOORS` 条目，重复 key ⇒ 记 `floorViolations`。**负向对拍**：临时复制一行 ⇒ 必须红。

#### S-12 · low · `check:readings` 强制范围只从 R208 起、3 条断言、0 条负控

- **位置**：`check-readings-citable.mjs:108`（`STRICT_FROM = 208`）、`check-all.mjs:691`（`['check:readings', 3]`）、`meta-negative-floor.json` = 0
- **证据等级**：**实测**
- **是什么**：宪法第 9 条「没有读数不能陈述为事实」是本项目最核心的不变量之一，其机检强度 = **3 条正例 + 0 条反证 + 只覆盖 R208 之后**，而 `CONSTITUTION.md:14` 把它标成有 `checked_by`（见 S-07）。
- **怎么证明修好了**：与 S-06/S-07 合并处理；至少把 `STRICT_FROM` 的历史豁免在宪法条款里写明。

#### S-13 · medium · 聚合入口自述「不写任何文件」，实际写仓库根与 `src/`

- **位置**：`check-all.mjs:47`（自述「⛔ 不写任何文件」）；反例 `check-ledger.mjs:54`、`check-stages-route.mjs:27`、`check-exec-progress.mjs:38`、`check-tasks-progress.mjs:35`、`check-work-plan-panel.mjs:32`（仓库根 `.check-*-work/`）；`check-preset-contracts.mjs:3781,3856,3892,4055`、`check-stages-route.mjs:1129`（**写进 `src/`**）
- **证据等级**：**实测**（t6 `grep`；本次 `.gitignore` 有 `.check-*-work/` 但 `grep -c negctl .gitignore` = 0）
- **是什么**：① 判据进程被 Ctrl-C / OOM ⇒ `src/**/__negctl_*.ts` **未被 ignore**；② `tsconfig.json` 的 `include: ["src"]` ⇒ 残留文件会被 `npm run build` 编进 `lib/`，而 `check:build` 面 ⑤ 会因此报红——**判据自己污染被测对象**。
- **怎么证明修好了**：`check-all.mjs:47` 改成实况；`.gitignore` 补 `src/**/__*__negctl_*.ts`；更好的做法是把变异体改写到 `mkdtempSync(tmpdir())` 下的镜像树（`check-orch-state.mjs:14518-14522` 已这么做，照抄即可）。**负向对拍**：让一个族在 `src/` 留一个文件 ⇒ 新加的「工作区必须干净」断言必须红。

#### S-14 · low · 门禁入口机检从未断言「关着时应该能打开」

- **位置**：`check-hob-create-dom.mjs:318, 362-366`（每次都先 `st.open()` 再断言按钮存在）
- **证据等级**：**实测**（t5 `grep`）
- **是什么**：这是 `O-20`（入口永远不可达）**在机检侧的同构镜像**——判据照着实现的形态写，于是实现的形态错误也一起被固化。
- **怎么证明修好了**：补一条断言「弹窗关闭时，Hob 会话里应存在一个可打开它的入口」；**负向对拍**：把入口改回 `if (!isOpen) return null` ⇒ 必须红。

#### S-15 · medium · 唤醒兜底链是死代码，但判定侧仍认为它活着

- **位置**：`orchestrator.ts:603`（`const fallbackEligible = false`）、`:612-614`、`:7932-7950`（`rearmWakeFallback` 分支）、`orch-state.ts:2851-2867`（`watchNeedsTimer`）、`orchestrator.ts:6986-7019`（`armWatchTimer`）
- **证据等级**：读码（t3 逐行核对）
- **是什么**：`deliverWakeOnce` 成功后会 `setWatchState(..., keepWakeAttempts: true)` 回 `waiting` 并保留两枚 D16 时刻 ⇒ `watchNeedsTimer` 恒真 ⇒ **30 秒定时器永远续排**，每轮全账本扫盘 + 逐 owner 读会话日志。而判定侧因 `fallbackEligible=false` **永远不会再叫**。`rearmWakeFallback` 唯一调用点被 `wakeFallback` 门控 ⇒ **零可达调用**。
- **两半**：一半空转（IO + 会话日志扫描），一半**读数说假话**（注释 `:630-641`、`wakeAttempts`、「叫满 3 次转 stuck」都描述了一个不可能发生的行为）。
- **怎么证明修好了**：二选一——删掉兜底并让 `watchNeedsTimer` 只认 `awake`（同时删掉 `wakeFallback/wakeGaveUp` 文案）；或恢复兜底（去掉硬编码 false）并让 `rearm` 可达。机检：`grep -c 'fallbackEligible = false'` 与「是否存在可达的 `rearmWakeFallback` 调用」必须一致。

---

#### S-16 · high · 元规则 M-1 把**被注释掉的负控**照样算成一条（比 S-06 更根本）

- **位置**：`scripts/check-meta-negctl.mjs:47-63`（`CALL_LIT_RE` + `countLabels`）
- **证据等级**：**实测**（`/tmp/syn_m01.mjs`，直接 import `countLabels`）

```
plain          => 1
lineComment    => 1      #  // bad('负向对拍：被注释掉的对拍')
blockComment   => 1      #  /* ok('负向对拍：块注释') */
jsdoc          => 1      #  /** * bad('负向对拍：JSDoc 里的假标签') */
insideString   => 1      #  const s = "bad('负向对拍：字符串里的假标签')"
```

- **是什么**：`countLabels` 用 `src.matchAll(CALL_LIT_RE)` 直接扫**原始源文本**，**不剔注释、不区分字符串字面量**。⇒ 元规则 M-1 的最短绕过路径是**加两个斜杠**：想临时关掉一条会红的对拍，只要 `//` 掉，`npm run check:meta-negctl` 照旧全绿。
- **为什么比 S-06 更根本**：S-06 说「下限 = 0 ⇒ 零负控也永远绿」，**准确但不完整**；真实形态还包括「**有负控但把它注释掉，M-1 照样数得到**」。⇒ **S-06 的修法（抬下限）完全覆盖不到这条，反而让「用注释凑数」更有利可图**（下限抬高后，往注释里写标签成了成本最低的「补齐」手段）。这是「让失败不可观测」的最短路径，且留下的痕迹只有 diff（注释常连 diff review 都会被放过）。
- **为什么不并入 S-06**：不同层。S-06 是「**下限设定**」错了（改一行数字）；S-16 是「**计数器实现**」错了（改剥注释那一步）。只修 S-06 不修 S-16，负控仍可被注释掉而不被发现。
- **怎么证明修好了**：
  1. `countLabels` 先剥注释再计数：`src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')`；
  2. 机检断言：对上表五个用例，`countLabels` 必须分别返回 `1/0/0/0/0`；
  3. **负向对拍**：**注释掉某族一条真实对拍 ⇒ M-1 必须红**（即计数器必须先剥注释再数）；反向对拍：把 `countLabels` 改回直接扫原文 ⇒ 上述五个用例的断言必须红。
- **与 t6 D-02 的关系**：t6 D-02 定义的 S-06 是「它的对拍被删光也不会红」；本条是「**它的对拍被注释掉也不会红**」。两条同族、不同层。

---

### 5.3 形态 ③ 失败被不同出口翻译成不同结论（T · 24 条）

#### T-01 · blocker · `index.toml` 被守卫重复计入 ⇒ 第二条单元永远写不进，且错误原因说谎

- **位置**：`hob-write.ts:1044-1056`（合并口径）、`:1057-1061`（重复 ID 判定）
- **证据等级**：**实测**（主控 `/tmp/lead_probe_ledger1.mjs`：`mergedIds: ["R-001","R-001","DEC-001"]`、`shape: ["R-001: 合并后的账本出现重复 ID"]`；t2 附录 A-3 用真实 `writeHobFile` 复现）
- **是什么**：`merged` 第一项是 `readToml('index.toml')`，而 `rel = file.slice('ledger/units/'.length)` ⇒ `file === 'ledger/units/index.toml'` 时 `rel === 'index.toml'`，而 `shardNames` 只匹配 `^unit-.*\.toml$`、**不含** `index.toml` ⇒ `index.toml` 的旧内容**被算两次**。
- **影响**：① `index.toml` **只有第一次写能成功**——本次实测（`/tmp/syn_m03.mjs`）：空 index 一次写 3 条 ⇒ `ok:true`（落盘 3 个 `[[unit]]`）；此后 append 第 4 条 ⇒ `ledger-duplicate-id`；**overwrite 改同一个 id 的 title 同样被拒** ⇒ 落在 index 里的单元**从此既不能新增也不能修改**（比「容量 1」更硬的冻结）；② **错误原因说谎**——用户/模型看到的是「你写了重复 ID」，真因是**守卫自己数了两遍** ⇒ 会去改内容而不是改路径，**缺陷被伪装成用户错误**；③ 追加到**分片**（`unit-02.toml`）正常 ⇒ `ok:true`（对照项，说明问题只在 index）。
- **为什么一直没被发现**：本仓工作树里 `ledger/units/` 目录不存在（主控 §6.1 确认），只在真正建了账本的工作区爆发。
- **怎么证明修好了**：
  1. 修法：`rel === 'index.toml'` 时从 `merged` 第三项里排除旧 `index.toml`；
  2. 机检（`check:ledger` 新增）：`index.toml` 有 1 条单元时 append 一条合法单元 ⇒ 必须 `ok:true`；
  3. **负向对拍**：把排除逻辑删掉 ⇒ 断言必须红。

#### T-02 · high · 同一本账有 4 套「账本健康」判据，实测四种结论

- **位置**：`tools.ts:581-591`（`stageGateOfLedger`）/ `tools.ts:711-721` + `stage-controls.ts:990`（`stageHealthOfLedger`，project 作用域恒无 blocker）/ `ledger-readiness.ts:294-303` / `stages-index.ts:445-465`
- **证据等级**：**实测**（本次独立复现 `/tmp/syn_probe_health3.mjs`，见 §4.7）
- **是什么**：四份结论：`unhealthy/1` · `PASS(undefined)` · `{ok:true,blockers:[]}` · `{ok:false,count:1}`。**代码注释里三处都自称「与派活门禁同一个纯函数」**（`ledger-readiness.ts:262`、`stages-index.ts:436`、`tools.ts:579`），但实际组合各不相同。
- **直接后果**：`T-05` 的死锁。
- **怎么证明修好了**：抽出唯一入口 `ledgerHealthOf(units)` 返回 `{problems, canProceed}`，四处全部改调；机检：四出口对同一夹具必须同结论。**负向对拍**：把其中一处改回自己的组合 ⇒ 断言红。

#### T-03 · blocker · 判不出 `ownerWsRoot` ⇒ 账本投影整段静默跳过，工具仍报 `ok:true`

- **位置**：`orchestrator.ts:5208`（`preOwnerWsRoot !== undefined`）、`:5387`（`ownerWsRoot !== undefined`）、`:7651`、`:10008-10017`（渲染只在 `w.ledgerProjection !== undefined` 时出行）
- **证据等级**：**实测**（主控 §7.1 逐条核实四处条件；本次采信）
- **是什么**：条件不成立时**根本没有赋值语句**，`w.ledgerProjection` 保持 `undefined`，而渲染层对 `undefined` 的处理是**输出空数组**（不是输出「未落」）。
- **⇒「失败」与「没发生」在读数面上不可区分。**
- **后果链**：工具返回 `ok:true`、watch 正常落盘、回执正常回来，但账本里没有 RUN、TSK 不动、面板第 4 步永远「无独立执行记录」——**失败长得和「没派过活」一样**。同时 I-2（同 task 互斥）在这一档**整段失效**（没有 RUN 预登记就没有互斥判据）。
- **怎么证明修好了**：把「判不出 `ownerWsRoot`」落成**显式失败读数**（`w.ledgerProjection = { dispatch: { ok:false, applied:0, reason:'判不出派活方工作区根 ⇒ 未预登记 RUN' } }`）并让 `hob_dispatch` 回带该字段；或按「没有 RUN 就不是派发」直接拒绝。机检：构造 `wsRootOfSession` 返回 `undefined` 的会话 ⇒ `hob_dispatch` 必须 `ok:false`。**负向对拍**：改回静默跳过 ⇒ 断言红。

#### T-04 · blocker · 一次挂起的 HTTP 让面板永久停刷，徽标仍说在刷新

- **位置**：`project-panel.tsx:1407-1445`（`pulling` 闸）+ 六个取数函数**全都没有超时**（`:323, 384, 408, 531, 561, 589, 608`）
- **证据等级**：**实测**（主控 §10.1 原文核实）
- **是什么**：`pulling` 只在 `Promise.allSettled(...).then()` 里复位。若某条 fetch 永不 settle（无 `AbortController`），`pulling` 恒 `true`，`followUpsLeft`（上限 3）耗尽后**所有后续 tick 静默丢弃**。
- **对照**：`create-hob-dialog.tsx:373, 398-404` 给**同一个浏览器**的 fetch 装了 30s `AbortController`，注释明写「必须有超时」⇒ **同一代码库里两个 fetch 用法，一个有超时一个没有，而没有超时的那个负责整个面板刷新**。
- **怎么证明修好了**：六个取数函数统一加 `AbortController` + 超时；`pulling` 闸加「超过 N 秒强制复位」兜底并在复位时把该路置为「判不出（上一次取数超时）」。机检（`check:stages-panel-dom` 新增）：注入一个永不 resolve 的 fetch ⇒ 断言 5s 内 `data-state` 变成 `fail`/`unknown` 且 `pulling` 已复位。**负向对拍**：去掉超时 ⇒ 断言红（面板会定格）。

#### T-05 · blocker · 修复写的命中判据与真正拦它的判据不是同一套 ⇒ 无法自愈的死锁

- **位置**：`tools.ts:1649-1658`（`repairOf` 用 `stageHealthOfLedger`）vs `:1660`（forward 用 `stageGateOfLedger`）
- **证据等级**：**实测**（t2 附录 A-4/A-20；本次独立复现 `/tmp/syn_probe_health3.mjs` 确认 `stageHealthOfLedger` 对 L-2 缺口说 `{ok:true,blockers:[]}`）
- **是什么**：`stageHealthOfLedger` 走 `project` 作用域：`evaluateGate` 的 project 分支（`stage-controls.ts:1100-1101`）返回 `blockers: stageControlProblems(units)`，而 `stageControlProblems`（`:897-899`）= `stageFieldProblems` + `stageApprovalProblems` ⇒ **它的 `blockers` 结构上不含 L-1..L-4 闭环缺口**（`gateScopeUnits` 对 `project` 返回 `[]`（`:990`）只影响闭环那一支）⇒ **当且仅当缺口是闭环型时恒空**（M-02 订正；实测只含字段缺口的账返回 2~16 条）。于是 `repairOf=<该单元>` 会因 `health.blockers.every(p => p.unit !== target)` 恒为真而**永远被拒**（`repair-target-not-a-blocker`）⇒ **这正是注释 `:1628-1630` 声称要避免的死锁，只是换了个成因**。
- **反向**：`L-*` 闭环缺口**不拦任何写入**，但会被 readiness 判成 `unhealthy` ⇒ 面板显示账本不健康而派活放行。
- **怎么证明修好了**：`repairOf` 改用「本次写入将要消除的那条问题」作为判据，而不是「目标单元 id 是否出现在某个 blocker 列表里」；机检：造一本只有 L-2 缺口的账，修该任务 ⇒ 必须 `ok:true`。**负向对拍**：改回 `stageHealthOfLedger` 判据 ⇒ 断言红（复现死锁）。

#### T-06 · high · 4 处 `validateLedgerStructure:false`，其中 3 处不必要

- **位置**：`projection-writer.ts:162,272`；`tools.ts:1929`（migrate）、`:2107`（approve）
- **证据等级**：**实测**（`grep -rn validateLedgerStructure src/ scripts/`；t2 附录 A-10/A-11/A-12）
- **是什么**：
  - `projection-writer` 两处**不必要**（且 `:272` 是 `R-18` 的放大器）；
  - `approve` 那处**不必要**——探针 A-11 证明「decision 单元在健康账本上根本不需要豁免」；
  - 只有 `migrate` 那处**必要**（它做的就是「把坏行改成好行」）。
- **豁免的代价**：探针 A-12：`status="settled"` 的非法 decision 在豁免下 `{ok:true}`，随后 readiness 立刻报 `S-0:DEC-001`；同一份内容走统一校验则 `{ok:false, reason:'ledger-structure-invalid'}`。
- **正确做法**（代码注释 `hob-write.ts:1019-1020` 已写着这个意图，但实现没这么做）：把校验拆成「**本次写入新增/改动的行必须合法**」+「既有行缺口只报不拦」两档。
- **条件附加（V-12 订正）**：「豁免不必要」**在健康账本上成立**（探针 A-11 复现），**但在真实存量账本上不成立**：对 10 本真实账本逐单元比对封闭集，`prompt-enhancer-release` 有 2 处越界（req=`proposed`@R-003、change=`draft`@CHG-346）⇒ 对它追加一条**完全合法**的 decision 依然被整本旧词拦住；而「先迁移」这条出路又被 `O-37`（migrate 只看 index.toml）堵住 ⇒ 这类账本处在「**正文写不进、迁移修不到**」的夹缝里。
- **怎么证明修好了**：删掉 3 处不必要的豁免；机检：`grep -rn 'validateLedgerStructure: false' src/` 必须只剩 `tools.ts:1929`（migrate）。**负向对拍**：给 approve 加回豁免 ⇒ 断言红。

#### T-07 · high · 投影半完成无回滚，且幂等键让重试不会补迁移

- **位置**：`projection-writer.ts:218-281`（逐条执行，任一失败即 return）+ `ledger-projection.ts:283-284`（幂等判据）
- **证据等级**：**实测**（t2 附录 A-7/A-8：首次 `{ok:false, applied:1}` 且盘上留 `RUN-001`；重入 `{ok:false, applied:0, reason:'同一派发已投影为 RUN-001 ⇒ 不重复建'}`）
- **是什么**：① **半完成态永久固化**——`RUN-001=registered`、`TSK-001=todo`、`run_ids` 空；而 `returnOps` 的兜底会**抓到这条孤儿 RUN** 并标成 `returned` ⇒ **一条从未真正执行过的 RUN 被记成执行完毕**；② `dispatchOps` 的幂等分支让**后续所有派发**都 `skipped` ⇒ 该任务**再也派不出去**。
- **好的部分**：失败确实被回带（`ok:false` + `reason`）并渲染出来——**这点是好的**；缺的是回滚与重试语义。
- **怎么证明修好了**：把 `ProjectionOp[]` 做成可回滚事务；或至少把「半完成」写进返回值（`partial: {created:['RUN-001'], failed:'transition TSK-001'}`）并在状态行点名「需人工修账」；幂等判据从「`projection_key` 命中」升级为「命中的**那组 op 全部 applied**」。机检：注入一个必失败的 transition ⇒ 断言返回值含 `partial`。**负向对拍**：改回只看幂等键 ⇒ 断言红。

#### T-08 · high · 面板对 G3–G6 印「卡在哪：没有主阻断」，而派活照样放行

- **位置**：`requirement-chain.ts:521-540`（只在 G1/G2 注入 blockedBy）、`project-panel.tsx:95-113`（G3–G6 回落 `chain.next`）、`:2662-2663`（渲染）
- **证据等级**：**实测**（t3 逐行核对三处；本次回源 `requirement-chain.ts:519-541` 确认）
- **是什么**：见 §3.3 ③。**面板给出假信号**——它说「卡在哪：没有主阻断」，而 `pipeline.blockedBy` 里明明写着「G3 · 任务依赖成环：…」。
- **它如何掩盖其他缺陷**（t3 的分析，本次采信）：① 让 `R-01`/`R-02` 那类「强判据只进 blockedBy」的缺口在界面上**不可见**；② 让「派活成功」与「面板说卡住」长期并存，读面板的人会先怀疑面板；③ `blockedBy` 是唯一把「为什么不能派」变成人话的通道，它断在 G3–G6 就等于**门禁的拒绝理由没有出口**。
- **怎么证明修好了**：`requirement-chain.ts` 在 G3–G6 也把 `pipeline.blockedBy` 注入 `next.blockedBy`；机检（`check:stages-panel-dom` 新增）：G3 有环时面板「卡在哪」必须显示该环。**负向对拍**：改回只注入 G1/G2 ⇒ 断言红。

#### T-09 · high · 账本健康假报 0 条 / 少报 N 条：`count` 与 `truncated` 一个都不读

- **位置**：`project-panel.tsx:2244-2257`；服务端 `stages-index.ts:455-462`（紧凑模式只给前 40 条 + 真实 `count`）、`:602-607`（体积兜底时 `problems` 整段丢弃、只留 `count`）
- **证据等级**：**实测**（主控 §10.2 原文核实；本次 `sed` 确认客户端两行都用 `problems.length`）
- **是什么**：**类型声明里明明有 `count` 和 `truncated`，但两行代码一个都没读**。面板固定以 `compact:true` 取数（`:529`），所以永远走这条路径。
- **两种假读数**：① 缺口 41~300 条 ⇒ 写「40 条缺口」，且 `:2264-2266` 的「另有 N 条」只减 12；② 触发体积兜底 ⇒ `problems=[]`、`ok=false` ⇒ 写「**账本健康：0 条缺口**」，且 `data-state` 被算成 **`'ok'`**（`:2253` 的判据是 `problems.length === 0`，不是 `health.ok`）。
- **与自己的契约冲突**：面板 `:2224-2234` 声称「与派活门禁同一份函数，⛔ 不在客户端另算一份」；服务端 `:453` 明写「⚠ `truncated=true` 时面板必须说『另有 N 条』」。
- **怎么证明修好了**：头部计数改用 `health.count`；`truncated` 或 `count > problems.length` 时追加「另有 N 条」；`problems` 缺席且 `count > 0` 时显示「判不出」。机检：造 100 条缺口的夹具 ⇒ 断言渲染文本含「100」且 `data-state !== 'ok'`。**负向对拍**：改回 `problems.length` ⇒ 断言红。

#### T-10 · high · Outbox 补投三重静默

- **位置**：`effects-queue.ts:133`（`this.onError = opts.onError ?? (() => {})`）、`:344-349`（失败只记 `attempts/lastError`，**无上限**）、`src/preset/tools.ts:209`（`{ self: undefined }`）
- **证据等级**：**实测**（主控 §7.2 逐点核实三点）
- **是什么**：① 补投失败**零日志**；② 补投**永不放弃**（退避封顶 60s 后一直重试）；③ 即使补投**成功**，`self` 是 `undefined` ⇒ `owner/watcher` 都是空 ⇒ 执行会话跑完时 `settle()` 在 `:7497` 直接落 `error`、**回执永不回来**。
- **⇒ 补投只完成了「把指针送到」，闭环仍然是断的。**
- **怎么证明修好了**：`deliver` 里传 `self: h.owner`（`PersistedHandoff` 已带 owner）；`startHandoffEffects` 传入 `onError`；handler 加最大尝试数，到顶落一档「补投放弃，需人工」。机检：让补投成功一次 ⇒ 断言回执能回来。**负向对拍**：把 `self` 改回 `undefined` ⇒ 断言红。

#### T-11 · medium · `writeWorkPlan` 返回值在三处被丢弃

- **位置**：`orchestrator.ts:4878`（首波派发后）、`:5437`（单目标附挂）、`:5478`（隐式计划）；对照 `:4556-4564`（推进器**有**检查）
- **证据等级**：读码（t3 逐处对照）
- **是什么**：首波写失败 ⇒ 盘上计划停在「全 pending」⇒ 推进器 `ready=[]` ⇒ **依赖轨永不接力**，而内存里那几条 watch 照常收尾 ⇒ 表现为「计划面一直 running / 全 pending，而实际活都跑完了」。隐式计划写失败更隐蔽：`:5439` 会**每派一次生成一份新隐式计划**。
- **怎么证明修好了**：三处都读 `ok` 并落 warn + 计入 `status()` 读数（与 `:4556-4564` 同款）。机检：让 `writeWorkPlan` 必失败 ⇒ 断言 `status()` 里有可读读数。**负向对拍**：改回丢弃 ⇒ 断言红。

#### T-12 · low · 回传正文不含「账本投影未落」的信号

- **位置**：`orchestrator.ts:1609-1636`（`buildReceipt`）、`:7649-7677`（投影在 `buildReceipt` **之后**）
- **证据等级**：读码
- **是什么**：回执先发、投影后落 ⇒ 回执正文里不可能带投影结果。派活方读回执看到「活干完了」，账本里 RUN 却可能仍是 `registered`。
- **怎么证明修好了**：不改投递语义（先写后发是对的），但把 `w.ledgerProjection.return.ok === false` 带进**下一次** `hob_orch_status` 的头行。机检：投影失败后下一次 status 必须含该信号。

#### T-13 · high · 批准工具不过 `proceedGate`：隔离/归档会话仍能写「用户批准」

- **位置**：`tools.ts:1954-2118`（`ledgerApprove.execute` 内**没有** `proceedGate`）；对照 `:1581-1588`（`write_hob` 有）
- **证据等级**：**实测**（主控 §5.2：`grep -n 'proceedGate(' src/modules/tools.ts` 仅 `:1306`/`:1582`；`sed -n '1994,2112p' tools.ts | grep proceedGate` ⇒ 无）
- **是什么**：`hob_ledger_init` / `hob_ledger_migrate` / `hob_ledger_rebuild` / `hob_pipeline_approve` 四个写工具**全部不过该闸门**；另有**第 5 个、也是最危险的一个**：`hob_orch_control` 的 verify / accept / send-back / close-delivery 直接写账本（`orchestrator.ts:10695 / :10723 / :10886`），`awk 'NR>=10440 && NR<=10980 && /proceedGateOf/'` 零命中，而它在 `MODEL_TOOL_ALLOWLIST` 三档都有（详见 `O-35`）。其中 init 有明确理由（`src/preset/tools.ts:2020-2021`「它是开张而不是推进」），**approve 没有**。
- **后果**：`archived`/`quarantined`/`pending-activation`/`unknown-legacy` 的会话（`mayProceed=false`）仍能写「用户批准」落账。「被隔离的会话不能推进」这条不变量在**写路径**上出现一个旁路。
- **怎么证明修好了**：`ledgerApprove` 的真写分支加与 `write_hob` 同一道 `proceedGate`（`dryRun` 保持放行）。机检：隔离会话调 approve ⇒ 必须被拒。**负向对拍**：删掉该闸门 ⇒ 断言红。

#### T-14 · high · 被拦消息超限时「丢最旧」只有一条 `console.warn`，队列在进程内存

- **位置**：`session-policy-service.ts:131-132`（上限）、`:159-169`（丢最旧）、`:104`（`Map` 在进程内存）、`:190-192`（`console.warn`）
- **证据等级**：**实测**（t4 原文；`:127-129` 自承「被丢掉的那条**永久消失**」）
- **是什么**：宿主已把被 reject 的消息丢弃，我们的暂存是**唯一副本**。超限丢最旧 ⇒ 用户输入永久丢失。而本仓 `index.ts:369-378` 自己论证过「warn 在生产日志通道**结构上永远被滤掉**（实测 111 条里 warn 一条没有）」。
- **未验证的一半**：该文件走的是 `console.warn`（`:191`），**console 是否被同一阈值滤掉：未验证**（t4 U-1，本文档不冒充已确认）。
- **怎么证明修好了**：① 丢弃计数进 `session-policy-blocks.json`（已有落盘面），让它可被面板读到；② 或把上限触发的丢弃改成「拒绝新消息并回一条可见提示」而不是静默丢旧。机检：造 11 条超限消息 ⇒ 断言 blocks 文件里有 `dropped` 计数。

#### T-15 · medium · `ensurePolicyDirIgnored` 返回值被**六处**丢弃（含定义文件自己 3 处），注释与事实相反

- **位置**：`session-policy-service.ts:1290, 1478, 1529`；**另有定义文件自己的 3 处**：`server/session-policy.ts:464`（读路径）、`:1121`、`:1216`（均在写策略文件之前）；对照 `:489-491` 的注释（V-08 补充，共 **6 处**）
- **证据等级**：**实测**（主控 §5.4：三处全部形如 `ensurePolicyDirIgnored(...)`，**返回值未接**）
- **是什么**：注释写「返回值有**三处**调用方拿它决定『要不要告警』⇒ 写没写进去必须当场核」——**与实现相反**。同族函数 `ensureRuntimeIgnored` 在别处是**被接住并告警**的。
- **后果**：`runtime/.gitignore` 写失败 ⇒ `session-policy.json`/`session-policy-blocks.json`（含 sessionId）可能被账本 git 收进历史，且**没有任何告警**。注释还宣称这件事已被处理 ⇒ 下一个人不会去查。
- **怎么证明修好了**：**六处**都接住返回值，失败时打一条可读 warn（用 `ctx.logger`，不是 console）。机检：`grep -c 'ensurePolicyDirIgnored('` 减去定义处 ⇒ 所有调用都必须在 `if (...)` 或 `const r = ` 形式；让它返回失败 ⇒ 断言有 warn 读数。**负向对拍**：改回裸调用 ⇒ 断言红。

#### T-16 · high · 切换账本不清展开详情缓存 ⇒ 显示上一本账的正文

- **位置**：`project-panel.tsx:1150-1169`（缓存 + 早退）、`:2217-2221`（切换账本只重置另外两样）、`:972`（取数其实带 `selectedLedger`）
- **证据等级**：**实测**（t5 `grep -n 'setItemDetails({})'` ⇒ NO RESET FOUND）
- **是什么**：`itemDetails` 以**裸 ID** 为键（`R-001`/`TSK-001` 这类编号在每本账里都从 001 起）。在账本 A 展开过 `R-001` 后切到账本 B，B 的 `R-001` 命中 `:1154` 的 `kind==='ok'` 早退 ⇒ 显示 A 的标题与全部详情字段，且**永远不会自愈**。
- **为什么最难识别**：界面有内容、格式正确、内容属于另一个项目。
- **怎么证明修好了**：`:2217-2221` 的 effect 里加 `setItemDetails({})`，或把缓存键改成 `${selectedLedger}/${id}`。机检：切换账本后展开同名 ID ⇒ 断言渲染文本属于新账本。**负向对拍**：删掉重置 ⇒ 断言红。

#### T-17 · low · 资源路由把 404/405 吞成业务失败

- **位置**：`project-panel.tsx:604-619` vs 同文件 `:347-351`（纪律正文 `:328-346`）
- **证据等级**：**实测**（`grep -n 'StaleRouteError(' src/client/project-panel.tsx` ⇒ 6 处抛出：`:348/390/414/537/567/595`；`grep -c 'instanceof StaleRouteError'` ⇒ **5 处分支**（`:1194/1225/1261/1325/1365`））。**6 个取数函数里 5 个有、2 个没有**：资源路由（`:604-619`，本条已报）**与工作计划路由（`:956-966`，见 V-10 / `O-36`）**。初稿「另五个都有、只有资源路由没有」不准确，已订正。
- **是什么**：资源路由被改名/方法不对时，展开详情显示「资源读不到（HTTP 404）」而不是「这个路径没有处理体（接线问题）」——**把接线故障说成数据故障**，正是 `:328-346` 那段注释要治的病。
- **怎么证明修好了**：照另五个的形态补 404/405 分支；机检：mock 一个 404 ⇒ 断言抛 `StaleRouteError`。

#### T-18 · high · README「跨实例投递当前不可用」整段描述已删除的模块

- **位置**：`README.md:162`（§4 已知限制表第 1 行）
- **证据等级**：**实测**（`src/modules/tools.ts:429-432` 注释「2026-10-24 · 本项目自研的跨实例投递模块已整体删除」；`config.ts:139`「已整族退场」；`grep -rn 'launcher' src` **零命中**）
- **是什么**：README 教用户配一个**不存在**的配置项（`名字=<启动器路径>`）、并声明「投递能力代码里已经有」——**用户会照着配、配不上、然后怀疑自己的环境**。
- **怎么证明修好了**：改成实况（可直接从代码注释取，已是准确表述）；机检：README 里提到的配置键必须能在 `config.ts` 的 schema 里找到。**负向对拍**：写一个不存在的键 ⇒ 断言红。

#### T-19 · high · README 的 `check:build`「三个面」实为五个面，行号全错

- **位置**：`README.md:213-219`
- **证据等级**：**实测**（t6 逐面对照：`check-build-sync.mjs` 有 ①:77 ②:80 ③:25 ④:85 ⑤:1368 五个面；`check-all.mjs` 真实行号是 `:100` 不是 `:52`/`:69`）
- **是什么**：`--strict-source` 管的是 **①②④⑤ 四个面**，不是 README 说的「①②两个面」。⇒ 读者会以为「只差面 ③ 没验」，实际**面 ④（产物能不能加载）与面 ⑤（孤儿产物）也在 strict-source 里**——这两条恰好是「装了跑不起来」与「删了源没删产物」的守门员。
- **怎么证明修好了**：改成「**五个面**：①②④⑤ 由 `--strict-source` 管、③ 需显式 `--strict-instance`」；行号改成 `:100`/`:87`，或干脆**不写行号**只写符号名（行号会漂，符号名不会）。

#### T-20 · medium · README 残留清单「6 类」但表只有 5 行，编号错位

- **位置**：`README.md:177` vs `:182-186`
- **证据等级**：**实测**
- **是什么**：「6 类」实为 **5 行**；「（第 2 类，记录区）」实为**第 1 行**。
- **怎么证明修好了**：改「5 类」+「（第 1 行，记录区）」；机检：README 里「N 类」的 N 与紧随的表格行数相等。

#### T-21 · medium · `check-all` 对 `exit 3` 的族数与行号两处自相矛盾且全错

- **位置**：`check-all.mjs:38-41`（说「三个族」）与 `:70-72`（说「四个族」，只列三个文件名 + 三个行号）
- **证据等级**：**实测**（`grep -rn 'process.exit(3)' scripts/*.mjs` ⇒ 实际 **3 个族**，行号应为 `:1517`/`:1859`/`:2392`，而文件里写的是 `:1223`/`:1651`/`:2005`，**三个全错**）
- **是什么**：`exit 3` 的读法（「检查器坏了，结论不可信，⛔ 不是跑 preflight」）是这套体系里**最重要的一条分档**（`:25-42` 整段在讲这个）。指路的行号错 ⇒ 真出事时按图索骥找不到栈。
- **怎么证明修好了**：统一成「三个族」+ 正确行号；或**不写行号**，写 `grep -rn 'process.exit(3)' scripts/` 自查。

#### T-22 · medium · 运行时提示词写「第 4 步 `actor_role` = `acceptor`」，实为 `verifier`

- **位置**：`preset-dsh-hob.patch.yml:91` = `gen/persona.md:21`
- **证据等级**：**实测**（`workflow.toml:60/71/82`：第 4 步 `executor`、第 5 步 `verifier`、第 6 步 `acceptor`）
- **是什么**：括号里的**理由错**（第 5 步是 verifier），结论「不是同一个人」仍成立。F1 核的是 `s4.actor_role === s5.actor_role` ⇒ **结论对，机检不报**。
- **为什么重要**：这句话会**原样进模型上下文**。模型若照它推理「第 5 步是验收人」，会把「技术验证」当成「产品验收」——恰好踩宪法第 8 条的反面。
- **怎么证明修好了**：改成「`actor_role` 一为 `executor`、一为 `verifier`（第 6 步才是 `acceptor`）」；来源在 `gen-preset-contract.mjs:229`（生成器硬编码这句），改那里 + 重跑生成器。机检：`prefix` 里出现的 `actor_role` 值必须与 `workflow.toml` 的 step 表一致。

#### T-23 · medium · TERMINOLOGY 的 kind 表漏掉 `verification` 与 `closure`，下一节又要求它们

- **位置**：`TERMINOLOGY.md:51-62`（10 行 kind 表）vs `:66-67`（要求 7 种带 v3 字段）；代码 `ledger-validation.ts:14-26`（12 个 kind）
- **证据等级**：**实测**
- **是什么**：同一份术语表**自己内部矛盾**：表里没有 `verification`/`closure`，下一节又要求它们带 v3 字段；ID 前缀表缺 `VER-`/`CLS-`，而代码明确支持。
- **怎么证明修好了**：补两行；机检：`TERMINOLOGY` 的 kind 表与 `UNIT_STATUSES` 的键集**双向差集为空**。**负向对拍**：删掉一个 kind ⇒ 断言红。

#### T-24 · medium · `ledger.toml` 无格式校验：写成功、账本随即判 `invalid`

- **位置**：`hob-write.ts:767, 799-801`（白名单直通）、`:1505-1506`（扩展名放行）；对照 `REQUIREMENTS.md` **有**形状校验（`:982-997`）
- **证据等级**：**实测**（t2 附录 A-16：`write_hob('ledger.toml', 'this is not a valid activation record')` ⇒ `{ok:true}`；随后 `ledgerLifecycleOfRoot` ⇒ `state:'invalid'`）
- **是什么**：激活记录是**账本能否使用**的总开关（`ledger-lifecycle.ts:113-129`）。**两条相邻规则一严一宽，没有理由。**
- **怎么证明修好了**：为 `ledger.toml` 加 `parseLedgerActivation`（`ledger-lifecycle.ts:70-94` **已有现成纯函数**）校验，不合法则 `bad-format` 拒绝。机检：写一段非法内容 ⇒ 必须被拒。**负向对拍**：去掉校验 ⇒ 断言红。

---
