# 主控独立复核 · 分卷 2

> ⚠ 本文件是 `LEAD-VERIFICATION.md` 的**分卷**（原文件 80KB 超 64KB 读上限，
> 按 `check:gitignore` 的 M 判据处置：**整块搬走 + 原位留指针**，⛔ 不是压缩）。
> 主文件：`docs/audit/business-logic-review/LEAD-VERIFICATION.md`。

---
## §25 B2.1（R-05 + R-10）完成

| 编号 | 修法 | 实测 |
|---|---|---|
| **R-10** | 新增 `refsOf` = 契约名 `acceptance_criteria_refs` 优先、旧名 `criteria_refs` 兜底 | 契约名不再误报、旧名仍认 |
| **R-05** | `pipelineDispatchProblems` 末尾追加 G3 段，判据直接用 `taskGraphOf` | 覆盖缺口 ✅ / 悬空依赖 ✅ / 齐全不误报 |

**连带 A**：计划派发把 `taskId` 当 RUN 标题 ⇒ C-17 判「标题只有编号」⇒ 整条派发被拒。
修法 `task: track.goal` ⇒ `check:work-plan-runtime` **9 → 35 通过**。

**连带 B**：两个自检夹具是契约前形态 ⇒ `check:ledger-projection` **10/20 → 14/0 全绿**。

**G3 健壮性修正**：算图前显式补齐本任务（幂等）——**判据不能依赖调用方守约定**。

## §26 B4.1 / B4.2 部分完成

**B4.1**：`check:meta-negctl` 下限 **4 → 3**（B0.3 的正确性证据）。
关键发现：10 个零下限族里 **7 个其实有断言但无负向对拍标签**；`check-all.mjs` 的 48 处「负向对拍」**全在注释里**
⇒ B0.3 之后不再计数（**这同时验证了 B0.3 的修法是对的**）。

**B4.2**：`__negctl` 临时件未被忽略 ⇒ 已在 `.gitignore` 补 `*__negctl_*.ts` / `*.mjs`。

**❌ S-08 经复核不成立**：CU-5 早已改成**反性质判据**（检查「源码里不得出现按宿主预设做 gating」），
`PLANNING_PRESET_ID` 是**被禁止出现的靶子**，不是失效引用。⇒ **S-08 应降级为「已排除」**。

## §27 B2.2（R-28）完成 · 多轨门禁前移

**缺陷**：`dispatchGateAtLedger` 多轨分支**从盘上找计划**，而写盘在 `writeWorkPlan`（更下面）
⇒ 首次派发找不到 ⇒ 落到「只报健康」⇒ `blocked: undefined` ⇒ **多轨是唯一能绕过任务链门禁的入口**。

**修法**：在 `writeWorkPlan` 之前插入门禁，逐轨用 `pipelineDispatchProblems`（与单目标同源）。

两处决策：
1. **用 `readProjectionUnits` 而非 `readLedgerUnits`** —— 后者在 `tools.ts` 里，反向引用会**循环依赖**。
2. **不注入 provenance** —— 多轨入口拿不到 `withLedgerProvenance` ⇒ `unknown` ⇒ 走老逻辑。
   ⚠ **不是放宽**：新写 v3 单元在 `legacy()` 第二层就被拒（`isPipelineV3`），与注入无关。

**门禁生效的直接证据**：第一次跑 `check:work-plan-runtime` 时报
`pipeline-gate-blocked：轨道 a：G2 · 方案当前修订未获用户批准`——改前这种夹具会**一路放行**。

⚠ **digest 必须由「盘上会解析出来的对象」算**：渲染时空数组/空串不写，直接用 JS 对象算会得到不同 digest ⇒ G2 报「批准后内容发生了变化」。

## §28 B4.3（R-03 + R-04）完成

**R-03**：8 份步名字面量，**只有 `stage-controls.ts:22` 写「编码任务」、其余 7 份写「任务图」**。
而 `STAGE_NAMES` 的唯一消费方是 `gen-ledger.mjs:1267`（写进账本 `CONTEXT.md`）
⇒ **跑一次 `gen:ledger` 就把错的步名印进账本**。

**修法**：`STAGE_NAMES.tasks` 改「任务图」；`PIPELINE_STAGES` / `STEP_DEFS` / `STAGE_DEFS` 改为**派生**。
`tasks-progress.ts` 与 `LEGACY_STEP_DEFS` **保留「编码任务」**（五步旧管线专用，两套语义）。

**可观测实证**：真实账本 `spec/current.md:45` 原写「编码任务：可推进」，重跑 `gen:ledger` 后变「任务图：可推进」，
`check:ledger` 从 126/3 变 **129/0 全绿**。⇒ **这不是纯代码整理，它改的是用户能看到的账本正文。**

**R-04**：`preset-dsh-hob.patch.yml:434` 原写 `the five steps (…编码任务…验收核对)`，而 `spec/reply.md:84` 写七步
⇒ **第 5 步模型说「验收核对」，面板说「技术验证」**。改了 5 处并重跑生成器 ⇒ `check:workflow` **33/33**。

⚠ **操作事故**：`git stash push` / `pop` 报「entry is kept」= **没有干净恢复**：
`stage-controls.ts` 改动还在，但 `preset/dsh-hob/` 改动被回滚。已重新应用。
⇒ **验证「是否既有失败」应该用 `git show HEAD:path` 对比，⛔ 不要动工作树。**

## §29 B4.4 完成 · README 六处失准

| 编号 | README 原文 | 代码实际 | 判定 |
|---|---|---|---|
| **R-27a** | `ledgerHome` 空串 = 派生 | `resolveLedgerRoot` 返回 `no-ledger-home` ⇒ **判不出**，工具直接拒绝 | ❌ **完全相反** |
| **R-27b** | 引用 `DEFAULT_LEDGER_DIR` | 该常量**已不存在** | ❌ 引用已删除符号 |
| **R-29** | 「不写 `~/.dsh/**`（有显式拒绝路径）」 | grep 全仓**零命中**该机制 | ❌ **机制不存在** |
| **R-29b** | 「不写 `~/.dsh/**` 除 profile 配置以外」 | 随包预设 `ledgerHome: /home/lk/.dsh/hob-ledgers` | ❌ **事实相反** |
| **T-18** | 整段描述「跨实例投递」 | `config.ts` 四处注释写明「**2026-10-24 整族退场**」 | ❌ **描述已删除模块** |
| **T-19** | `check:build` 「三个面」 | 实为**五个面** | ❌ 数量错 |
| **T-20** | 「残留一共 6 类」 | 表里只有 **5 行** | ❌ 数字不符 |

⚠ **最危险的是 R-27**：原文让读者**留空**，而代码里留空**直接判不出账本根**——「照文档做会坏」。

**连带发现**：残留清单第 1 行原写「或派生出的兄弟目录 `.hob-ledgers/`」，与 R-27 更正**直接矛盾**。
⇒ 印证 R-02：**同一个错误事实会在文档里出现多次，且不会自己收敛**。

## §30 B4.2 后半完成 · 自检并发缺陷已修 + 两处自我纠错

**缺陷**：7 个自检脚本用**固定临时目录**（`.check-stages-work` 等），并发跑会互相 `rmSync` 掉对方目录。

**修法**：7 处统一改成带 `process.pid` 的唯一路径。

**验证**：`check:stages-dom` 与 `check:presets` 并发跑，**双双 exit 0**（修复前必有一个 FAIL）。

### 30.1 自我纠错一：我前几轮报的「并发 FAIL」一半是假警报

| 我报的名字 | 实际存在？ | 真实名字 |
|---|---|---|
| `check:stages-panel-dom` | ❌ **不存在** | `check:stages-dom` |
| `check:hob-unselected-gate` | ❌ **不存在** | `check:hob-gate` |
| `check:preset-contracts` | ❌ **不存在** | `check:presets` |

`npm run` 对**不存在的脚本**返回 **exit 1** ⇒ 我看到的「FAIL」全是**脚本名不存在**，
而 `node scripts/xxx.mjs` 直跑能过，正因为**文件本身存在**。

⇒ **并发缺陷是真实的，但我把「名字错」误读成「并发冲突」**，且用「直跑 OK」去解释它
——**用错误的证据支持正确的结论**。

⚠ 教训：**`npm run -s <name>` 失败时必须先确认该 name 在 `package.json` 里存在。**

### 30.2 自我纠错二：`.gitignore` 覆盖的推断也错了

我判断「带 pid 后 `.check-*-work/` 不再匹配、需补规则」。**实测证明覆盖**：

```
$ mkdir -p .check-ledger-work-12345
$ git status --porcelain --untracked-files=all .check-ledger-work-12345
(无输出)
```

⇒ gitignore 的 `*` 匹配任意字符（含 `-12345`），规则末尾 `/` 只要求是目录。**无需补规则。**

### 30.3 验证（全部用真实脚本名）

```
check:stages-dom OK    check:pipeline OK    check:stages-route OK
check:presets OK       check:stage-controls OK    check:tasks-progress OK
check:hob-gate OK      check:meta-negctl OK
check:exec-progress OK check:ledger-projection OK
check:hob-create-dom OK    check:workflow OK
check:ledger OK        typecheck exit 0
```

---

**本文件结束。**

---

## §31 B4.1 续 · 负控口径扩展（say 通道）+ 两族抬下限

### 31.1 根因：口径漏了第三种输出函数

`CALL_LIT_RE` 原来只认四种写法：`ok(` / `bad(` / `note.push(` / `check(`，
**标签取第一个实参**。

但实测发现三族用的是 **`say(pass, line, why)`** —— **标签在第二个实参**：

| 族 | 断言函数 | `ok/bad` 计数 | `say` 计数 |
|---|---|---|---|
| `check:build`（`check-build-sync.mjs`） | `say(pass, line, why)` | **0** | 8 |
| `check:profile`（`check-profile-assembly.mjs`） | `say(pass, line, why)` | 25 | 10 |
| `check:selfwake`（`probe-selfwake-e2e.mjs`） | `say(pass, line, why)` | **0** | 6 |

⇒ 这正是 `check-meta-negctl.mjs:41-47` 注释里写过的那类病：
**「口径漏了写法，不是补的对拍不存在」**。

### 31.2 修法：扩口径（⛔ 不是把对拍改写成 `ok()` 去迎合）

新增 `SAY_LIT_RE`，**跳过第一个实参再取第二个字符串字面量**：

```js
const SAY_LIT_RE = /\bsay\(\s*[^,()]*(?:\([^()]*\))?[^,()]*,\s*(?:`([^`]*)`|'([^']*)')/gs
```

⚠ **为什么不能只把 `say` 加进 `CALL_LIT_RE` 的备选分支**：那会取**第一个实参**（通常是布尔表达式
`ok` / `stillUndecidable && positive.verdict === 'lagging'`）⇒ 仍然数不到标签。
⚠ 第一个实参可能含嵌套逗号（如 `f(a, b)`）⇒ 正则允许一层括号，匹配不到再退回宽松写法。

`countLabelsOnCode` 与「逐条对拍演示」两处**都改成跑两条正则**（⛔ 不去重：一条调用只可能命中其一）。

### 31.3 连带：`check:profile` 的两条负向对拍没打标签

它们的标签写的是 `P-2 ✓ 反向（…）` / `P-3 ✓ 反向（…）`——**是负向对拍，但没写「负向对拍」四个字**。
⇒ 按仓内既有规范改成 `P-2 ✓ **负向对拍**（钉事故形态）…` / `P-3 ✓ **负向对拍**（本单 A 改判）…`。

### 31.4 结果

| 族 | 改前 | 改后 | 下限 |
|---|---|---|---|
| `check:build` | 0 | **2** | 0 → **2** |
| `check:profile` | 0 | **1** | 0 → **1** |
| 其余 8 族 | 0 | 0（各自用自定义输出或确实无负向对拍） | 保持 0 |

⚠ **其余 8 族不能凭空抬**：实测就是 0，抬到 ≥1 会**立刻红**。已在 `meta-negative-floor.json` 的
`note` 里点名，避免下一个人以为「已经全绿了」。

### 31.5 验证：负向对拍**真的会红**（这是本批最关键的验证）

把 `check-build-sync.mjs` 里那条真对拍**注释掉**：

```
✗ M-1 · check:build：负向对拍 **实测 1 条 < 登记下限 2 条** ⇒ 有对拍被删/被注释掉了
    check:build                     1 条（1 文件）
```

⇒ **改坏即红，恢复即绿**。这条验证比「计数变高」重要得多 ——
它证明新口径不是把计数做高，而是**让注释绕过这条路真的被堵住**。
（恢复后实测 `check:build` 回到 2 条、M 组 5/5 全绿。）

### 31.6 全量验证

```
check:meta-negctl OK   check:build OK      check:profile OK
check:pipeline OK      check:stage-controls OK    check:ledger OK
check:workflow OK      check:stages-dom OK        check:presets OK
check:ledger-projection OK    typecheck exit 0
```

---

**本文件结束。**

---

## §32 B2.3 第 1 段（影子模式）完成 · R-01 强判据算出来但不参与判定

### 32.1 为什么要分三段（不是拖延）

R-01 直接改强判据会让**存量账本大面积变红**：历史上「自己验自己」的项目会从 `completed`
翻成 `incomplete`，而**证据补不回来**（当时就没留）。

| 段 | 做什么 | 风险 |
|---|---|---|
| **段 1（本轮）** | **算出来、报出来，⛔ 不参与判定**（影子模式） | **零**：判定逐字不变 |
| 段 2 | 宽限期（按 provenance 豁免历史单元） | 中：需 B0.1 的 provenance 已就位（✅ 已完成） |
| 段 3 | 全量（删宽限分支） | 高：存量项目会变红 |

### 32.2 实现（严格可验证）

新增两个纯函数：
- `strongVerificationGaps(tasks, verifications, units)` —— 对**已 pass** 的 VER 跑 `verificationProblems`；
- `strongAcceptanceGaps(accs, units)` —— 对**已 pass** 的 ACC 跑 `acceptanceProblems`。

⚠ **只对已 pass 的看强判据**：没有验证是「还没做」，不是「做得不对」——
否则会把「阶段 5 还没开始」误报成「验证做得不合规」。

然后在 `set(4, {state:'completed'})` 之后 push 进 `blockedBy`，**带 `[影子]` 前缀**：

```ts
for (const g of strongVerificationGaps(tasks, verifications, units).slice(0, 5)) {
  blockedBy.push(`[影子] 技术验证强判据 · ${g}`)
}
for (const g of strongAcceptanceGaps(accs, units).slice(0, 5)) {
  blockedBy.push(`[影子] 产品验收强判据 · ${g}`)
}
```

⛔ **不改** `allTasksVerified` / `allTasksAccepted` 的返回值 ⇒ `activeStage` / `chainCompleted` 逐字不变。

### 32.3 验收（本段唯一的验收标准）

**夹具**：全合法 v3 链 + G1/G2 批准，但**验证者=实现者、验收者=实现者**、缺 `criteria_refs` /
`verification_refs` / `example_results` —— 正是 R-01 的典型场景。

**改动前后逐字对比**：

| 指标 | 改动前 | 改动后 |
|---|---|---|
| `activeStage` | **5** | **5** |
| `chainCompleted` | **false** | **false** |
| `stages` 序列 | `1:completed 2:completed 3:completed 4:completed 5:active 6:draft 7:draft` | **逐字相同** |

⇒ **判定层零变化**，符合段 1 的设计。

**影子判据确实报出来了**（7 条）：

```
[影子] 技术验证强判据 · VER-1 · C-25 · 技术验证者是实现者本人（违反独立性）
[影子] 技术验证强判据 · VER-1 · C-25 · 技术验证没有对应的验收条件（criteria_refs 为空）
[影子] 产品验收强判据 · ACC-1 · C-7 · 验收者与实现者是同一个会话（自己验自己）
[影子] 产品验收强判据 · ACC-1 · C-7 · 验收通过但缺技术验证证据（verification_refs 为空）
[影子] 产品验收强判据 · ACC-1 · C-7 · 验收通过但缺用户例子逐条结果（example_results 为空）
…（共 7 条）
```

⚠ 这正是 REVIEW §1 里复现的那批违规 —— 现在它们**出现在返回值的结构化字段里**，
而不再只是「算出来丢掉」。

### 32.4 全量验证

```
check:pipeline OK          check:stage-controls OK
check:ledger OK            check:requirement-chains OK
check:stages-dom OK        check:workflow OK
check:meta-negctl OK       check:ledger-projection OK
typecheck                  exit 0
```

⚠ `check:work-plan-runtime` 仍 **35/7** —— 与 §24.1 / §25 记录的**既有基线完全相同**（7 条 WPR 时序问题），
与本轮改动无关。

### 32.5 下一步（段 2 需要用户确认）

段 2（宽限期）要回答一个**产品决策**：
> 存量账本里「验证者=实现者」的那些 VER/ACC，**是否永久豁免**？

- 若**豁免**：它们永远不进强判据 ⇒ R-01 对历史项目形同未修；
- 若**不豁免**：需给出一个宽限窗口（如「宽限到下一次该任务被重新验证」）。

⇒ 这正是 FIX-PLAN §7 的 **D-SPEC-4**（「R-01 三段式宽限是否接受影子模式 ≥1 周」）。
**段 1 已就位，段 2 等这个决定。**

---

**本文件结束。**

---

## §33 B1.1 的 A 方案完成 · 批准分片收窄 + T-13 + T-06

### 33.1 为什么这一半不需要等 D-1

FIX-PLAN §7 的 **D-1** 给的是 A / B / C 三个选项，但 **A 是无论选哪个都要做的前置**：
- 选 A ⇒ 它就是全部；
- 选 C ⇒ A 是过渡（先收窄攻击面，再引入用户触发通路）。

⇒ **A + T-13 + T-06 都是纯收窄改动，不引入任何新语义**，可以先做。

### 33.2 A：`write_hob` 不能写批准分片

**攻击链（本次审计最重的一条）**：
```
Hob（任意会话，哪怕已被隔离）
  └─ write_hob('ledger/units/unit-pipeline-approval.toml', <一条 decision 单元>)
        · decided_by = "user"        ← 自己写
        · artifact_digest = <自算 FNV> ← 自己算
        · source = "继续"             ← 自己编
  └─ 三道检查全绿 ⇒ approvalStateOf → approved ⇒ G1/G2 打开
```

**修法**：`hob-write.ts` 新增 `APPROVAL_ONLY_SHARDS` + `isApprovalOnlyPath()`，
在白名单**最前面**拒绝（⛔ 不能放后面，否则先被 `LEDGER_PATH_RE` 放行）。
专用写入者通过 `WriteHobOptions.allowApprovalShard` 显式放行 ——
**不是绕过白名单，而是「白名单里有一个只有它能拿到的通行证」**。

### 33.3 T-13：批准工具补 `proceedGate`

`grep 'proceedGate('` 原来只命中 `:1306`（定义）与 `:1582`（`write_hob`），
而 `hob_pipeline_approve` / `hob_ledger_init` / `hob_ledger_migrate` / `hob_ledger_rebuild` 四个写工具**都不过闸门**
⇒ `archived` / `quarantined` / `pending-activation` 的会话（`mayProceed=false`）**仍能写「用户批准」落账**。

**修法**：`args.dryRun === false` 时先过 `proceedGate`。
⚠ `hob_ledger_init` 不过闸门**有理由**（它是开张而不是推进），本批不动它；`approve` 没有这个理由。

### 33.4 T-06：去掉 `validateLedgerStructure: false`

原注释的理由是「approval units are valid v2 decisions even when other legacy rows are not migrated」——
**这个理由不成立**：
- `decision` 与封闭契约**完全兼容**（`UNIT_STATUSES.decision = ['active','superseded']`，本工具写的正是 `status="active"`）；
- 实测在健康账本上走统一校验 ⇒ `ok:true`；
- 而豁免的**实际后果**是「连 C-22 字段校验都跳过」⇒ **这个工具自己写出非法 decision 也能落盘**。

⇒ 去掉豁免，与其余三个写入口同一道校验。

### 33.5 验证

**① A 方案的核心断言**（`/tmp/v_a.mjs`）：

| 场景 | 结果 |
|---|---|
| 普通 `write_hob` 写批准分片 | **被拒**，`reason='not-whitelisted'`，消息明写「是用户批准的专用分片，write_hob 不能写」 |
| 专用通道（`allowApprovalShard: true`） | **放行** |
| 普通分片 | 不受影响 |

**② 补了常驻机检 WP-11**（此前**没有任何自检覆盖 `hob_pipeline_approve`**，这本身是个缺口）：

```
✓ WP-11 ✓ **负向对拍**：write_hob 写批准分片 ⇒ 被拒（not-whitelisted）；
          专用通道 ⇒ 放行（S-01(A)：批准只有一条写入路径）
```

**③ WP-11 的负向对拍真的会红**（把收窄代码注释掉）：

```
✗ WP-11 · 批准分片收窄不成立：denied={"ok":true} allowed={"ok":false,"reason":"ledger-duplicate-id"}
WP 组：通过 12 · 失败 1
```

⇒ 恢复后 13/13 全绿。**「改坏即红」这条验证比「跑通」重要。**

### 33.6 全量验证

```
check:pipeline OK      check:stage-controls OK    check:ledger OK
check:ledger-write-policy OK (13/13)              check:workflow OK
check:meta-negctl OK   check:stages-dom OK        check:presets OK
check:ledger-projection OK    typecheck exit 0
```

### 33.7 ⚠ 这一半**不能根治** S-01

必须说清：**A 只是把「可绕过点」从两条收窄成一条**。
批准工具本身**仍由 Hob 调用**、`decided_by` **仍是硬编码常量**、`source` **仍是对自填字符串跑正则**。
⇒ **S-01 仍是 blocker**，根治要 **C 选项**（用户本人触发通路）。
⚠ 因此**不得**把 S-01 标成「已修复」。

**C 的落地还有一个前置**（§18 实测）：`defaultPreset: danger-full-access` ⇒ `approval: never`
⇒ `ctx.approval.request()` 必然返回 **`rejected`** ⇒ **降级不是边缘情况而是默认情况**。

---

**本文件结束。**

---

## §34 B4.1 完成 · 零负控族从 10 个降到 2 个

### 34.1 逐族处置（不是一刀切抬下限）

| 族 | 实测 | 处置 | 依据 |
|---|---|---|---|
| `check:build` | 0 → **2** | 扩 `SAY_LIT_RE`（§31） | `say(pass, line, why)` 标签在第二实参 |
| `check:profile` | 0 → **1** | 扩口径 + 改标签 | 两条「反向」断言按规范改标「负向对拍」 |
| `check:work-plan-runtime` | 0 → **1** | 补标签 | `WPR-2`（单会话+两轨被拒）本身就是负向对拍 |
| `check:tasks-route-http` | 0 → **1** | 补标签 | `H-3`（不存在 sessionId ⇒ 恰好 ledger-unreadable） |
| `check:selfwake` | 0 → **1** | 补标签 | `S-3`（摘掉那道闸 ⇒ 探针当场 FAIL）本身就是负向对拍 |
| `check:readings` | 0 → **1** | 补 `ok()` 断言 | 原三档用 `readings.push({...})`，口径认不到 |
| `check:rounds` | 0 → **1** | 补 `ok()` 断言 | 同上，`readings.push({...})` 形态 |
| `check:host` | 0 → **1** | 补标签 | 「全关开关 ⇒ 不登记任何子模块」是排除性断言 |
| `check:all` | **0** | **不抬** | **聚合入口，不产生独立断言**（`ok/bad` 只在注释里） |
| `check:preflight` | **0** | **不抬** | **只报告不判定**（纯 `console.log`，无断言结构） |

⇒ **10 → 2**。剩下两个是**结构上就没有**负向对拍，⛔ 抬了会红。

### 34.2 一个反复出现的模式

这 8 个族里，**5 个的负向对拍一直真实存在**，只是**计数口径认不到**：
- `say(pass, line, why)` —— 标签在**第二**实参（3 族）；
- `readings.push({ label, expect, got, pass })` —— 标签在**对象字段**里（2 族）；
- 排除性断言写成正向文案（「全关 ⇒ 不登记」）—— 语义是负向，标签没写（1 族）。

⇒ 这正是 `check-meta-negctl.mjs:41-47` 注释里写过的那类病：
**「口径漏了写法，不是补的对拍不存在」**。

⚠ 但**本轮的处置不是一味扩口径**：
- `say` 通道 ⇒ 扩正则（因为形态统一，可安全识别）；
- `readings.push({...})` ⇒ **不扩**（对象字面量的 label 位置不稳定，扩正则易误伤），
  改为在该文件里补一条**同语义、符合计数口径**的 `ok()` 断言 —— ⛔ 不是新造判据，是把已有事实说出来；
- `check:all` / `check:preflight` ⇒ **承认它们没有**，⛔ 不硬凑。

### 34.3 验证

```
check:meta-negctl OK（M 组 5/5）    check:host OK
check:readings OK                  check:rounds OK
check:selfwake OK                  check:tasks-route-http OK
check:pipeline OK                  check:ledger OK
check:workflow OK                  check:stages-dom OK
check:presets OK                   typecheck exit 0
```

⚠ `check:work-plan-runtime` 仍 **35/7**（既有基线，见 §24.1）。

### 34.4 剩余两族的说明（写进 floor note）

`meta-negative-floor.json` 的 `note` 已写明：
> 仍为 0 的族：`check:all`（聚合入口，不产生独立断言）、`check:preflight`（只报告不判定）
> —— 这两个**结构上就没有**负向对拍，⛔ 不应抬。

⚠ 这条说明很重要：否则下一个人看到「2 个族仍是 0」会以为**还没做完**，
去硬凑两条对拍 —— 那正是 S-06 当初的成因（为了满足下限而凑数）。

---

**本文件结束。**
