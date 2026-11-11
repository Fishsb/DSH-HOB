## §189 ✅ O 组最后 11 条全部有修复痕迹 —— **112 条核对完毕**

### 189.1 逐条

| 编号 | 证据位置 |
|---|---|
| **O-04** | `risk-policy.ts:215`「十维里只有六维有 floor 规则，另外四维只计分」 |
| **O-08** | `policy-record-state.ts:46`「六值必须**按轴拆开**，⛔ 不混在一个类里」 |
| **O-09** | `projection-writer.ts:124`「但它**不区分「读不出」与「空账」**」 |
| **O-12** | `session-policy.ts:197`「⚠⚠ **仅供显示** —— ⛔ 本字段不参与任何判定（O-12）」 |
| **O-20** | `create-hob-dialog.tsx:1188`「**不是**「打开弹窗」」 |
| **O-26** | `check-workflow.mjs:7`「**O-26 更正**：原文写「五步齐（`order` = 1..5）」」 |
| **O-27** | `check-stages-route.mjs:3`「七阶段汇总路由 · 服务端行为判据」 |
| **O-28** | `check-gitignore.mjs:437`「**O-29 / O-28**：`kit/` 活规矩层的路径与术语必须指向存在的实体」 |
| **O-29** | 同上（同一条断言覆盖两条） |
| **O-40** | `bus.ts:2040`「档位枚举必须从常量派生，⛔ 不手写」 |
| **O-42** | `check-gitignore.mjs:472`「`units/` 的**两种形态**必须在文档里都写明」 |

### 189.2 ⚠ 抽查两条确认不是误报

**O-12**：

```
session-policy.ts:197  「⚠⚠ 仅供显示 —— ⛔ 本字段不参与任何判定（O-12）」
⇒ 它把「这个字段只显示不判定」写死在字段旁 ⇒ 正是 O-12 的修法
```

**O-26**：

```
check-workflow.mjs:7  「O-26 更正：原文写「五步齐（order = 1..5）」，
                       实为七步（order = 1..7）」
⇒ 与 T-22 同族：**文档写的步数与代码不符**，已更正
```

### 189.3 ✅ 112 条核对完毕

| 状态 | 条数 |
|---|---|
| **已修** | **103**（92 + 11） |
| 部分修 | 2（R-01 · T-13） |
| 核心已修 + 规格需修订 | 1（R-02） |
| 按设计处理 | 1（T-07） |
| 未修 | 1（S-01） |
| 未核 | **4** |

```
103 + 2 + 1 + 1 + 1 + 4 = 112 ✅
```

⚠ **还差 4 条没核到** —— 不把它凑掉，下一轮查清是哪 4 条。

---

---

## §189 R-01 段 2 已实现（并连带纠正我一次误判）

### 189.1 实现（`pipeline-view.ts:534-554`）

```ts
/**
 * ── R-01 段 2：宽限期（按 provenance 豁免历史单元）（2026-11-11）──────
 * 段 1 是「只报不拦」。段 2 的区别只有**前缀**：
 *   历史单元标「宽限」、新单元标「影子」
 * ⚠ 本段仍不改 verified / accepted —— 段 3 才真的拦。
 * ⚠ 判定口径：provenanceOf(u) === 'legacy-migrated' ⇒ 历史单元。
 */
const legacyTag = (unitId: string): string => {
  const u = units.find((x) => text(x.id) === unitId.split(' · ')[0])
  return u !== undefined && provenanceOf(u as StageControlUnit) === 'legacy-migrated'
    ? '[宽限]' : '[影子]'
}
for (const g of strongVerificationGaps(tasks, verifications, units).slice(0, 5)) {
  blockedBy.push(`${legacyTag(g)} 技术验证强判据 · ${g}`)
}
for (const g of strongAcceptanceGaps(accs, units).slice(0, 5)) {
  blockedBy.push(`${legacyTag(g)} 产品验收强判据 · ${g}`)
}
```

### 189.2 ⚠ 我一次误判：grep 关键词不对就判「未实现」

```bash
grep -n 'legacyTag|宽限|影子' src/shared/pipeline-view.ts
→  只有 :194-221 的段 1 注释，没有 legacyTag
⇒ 我判「段 2 没落进文件」

实际：代码在 :534-554，我 grep 的三个词里「宽限」「影子」确实在、
     但 legacyTag **在注释之后**，而我的 grep 输出被 head 截断了。
```

⚠ 这与 §128（grep 只看到前两个分支）**同一个错**：`head` 截断导致漏看。
   ⇒ 教训：**判断「某段代码在不在」，⛔ 不能用 `head` 截断的 grep**。

### 189.3 ⚠ 但段 2 的标签在实际输出里**看不到**

实测（构造「验证者=实现者」夹具）：

```
blockedBy 6 条：
  R-1 · G1 需求未批准
  C-1 · G2 方案未批准
  V-1 · 技术验证缺可复核证据
  V-1 · C-25 · 技术验证结论缺依据
  V-1 · C-25 · 技术验证缺可解析的 verified_at
  V-1 · C-25 · 技术验证缺独立会话 verification_session
⇒ **没有一条来自 strongVerificationGaps**
```

原因：`strongVerificationGaps` 只对**已经 pass 的验证**看强判据：

```ts
if (latest === undefined || latest.status !== 'pass') continue
```

⚠ 而我的夹具里那条 VER 虽然 `status='pass'`，但**缺 `basis`/`verified_at`/`verification_session`**
   ⇒ `verificationProblems` 报了 4 条 C-25，但 `strongVerificationGaps` 仍然通过（因为它只看独立性，不看这些字段）。

⇒ **段 2 的代码是对的，只是我的夹具没触发它**。
   要触发需要「验证者=实现者」这一个条件 —— 我的夹具里 `verifier='dev-A'` 且 `built_by='dev-A'`，**应该触发**。

⚠ 可能原因：`latestVerificationOf` 取到的不是 V-1，或 `strongVerificationGaps` 的 `units` 参数路径不同。
   ⇒ **本轮未查清**，⛔ 不声称「已验证段 2 生效」。

### 189.4 状态

| 项 | 状态 |
|---|---|
| 段 2 代码 | ✅ 已实现（`:534-554`） |
| 段 2 行为 | ⚠ **未验证**（夹具未触发标签输出） |
| 段 3 | ⛔ 需产品决策（存量账本会大面积变红） |

```
check:all  47/47 · EXIT=0 · 105 秒
typecheck  EXIT=0
```

⚠ R-01 记账改为「段 2 已实现，行为待验证」。⛔ 不记为「2/3 完成」。

---

---

## §190 段 2 行为验证：**本轮未能构造出到达该分支的夹具**，如实记录

### 190.1 已查明的事实

```
① 代码已实现：pipeline-view.ts:534-554（cat -A 逐字确认）
② 它所在的 else 分支条件是：
     :510  if (tasks.some(t => t.status !== 'built') || returned.length < tasks.length) { … }
     :520  else { … ← 段 2 的 legacyTag / push 在这里
③ 但在 pipelineViewOf 的流程里，要先过 :498 的 graphReady，
   再过 :506 的第 5 步判断，才会走到 :520
```

### 190.2 ⚠ 我尝试了 3 次夹具，都没到达

| 尝试 | 夹具 | activeStage | 带标签 |
|---|---|---|---|
| ① | `T-1.status='done'` | — | 0（没进分支） |
| ② | `T-1.status='built'` + VER pass | **1** | 0 |
| ③ | ③ + decision 单元 + 全部必需字段 | **1** | 0 |

⇒ 三次都卡在 `activeStage = 1`（G1），说明**批准链的判定口径我没对上**。

### 190.3 ⚠ 为什么不再继续查

```
再查下去需要读 pipelineViewOf 的完整批准链（:440-506 约 66 行）；
而**该行为已有更强的保障**：
  · check:stages-route 的 S-1 断言（148 条）覆盖 pipelineViewOf 的输出
  · check:all 47/47 全绿
⇒ 「段 2 的 push 会不会在真实路径上执行」这件事，**真实账本会证明它**，
   而不是靠我硬造夹具。
```

⚠ **这不等于「已验证」**。准确说法是：

```
段 2 代码在位（逐字确认）；
行为**未由独立夹具验证**；
但代码路径依赖的 :510 分支与 47 族判据全绿不冲突。
```

### 190.4 记账

| 项 | 状态 |
|---|---|
| 段 2 代码 | ✅ 在位（`:534-554`） |
| 段 2 行为 | ⚠ **未独立验证**（3 次夹具未到达分支） |
| 段 3 | ⛔ 需产品决策 |

⇒ R-01 记为「**段 2 代码在位，行为未独立验证**」。
   ⛔ 不记为「2/3 完成」，⛔ 也不记为「未实现」。

---

---

## §191 ⛔ 段 2 的代码路径**在真实账本中同样不可达**

### 191.1 用真实账本验证（⛔ 不是自造夹具）

```
账本：/home/lk/.dsh/hob-ledgers/dsh-hob/ledger/units/
  4 个分片 · 292 个单元 · 20 条需求
  status 分布：built 50 · pass 55 · agreed 17 · active 6 …

对 20 条需求逐条跑 pipelineViewOf：
  带 [宽限] / [影子] 标签的 blockedBy：**0 条**
```

⚠ 这比上一轮的自造夹具**强得多**：292 个真实单元、50 个 built 任务、55 个 pass 验证，
   条件全都满足，却一条标签都没产生。

### 191.2 为什么不可达

段 2 的 push 在 `:520` 的 `else` 分支里，而进入该分支需要：

```ts
// :510
if (tasks.some((t) => text(t.status) !== 'built') || returned.length < tasks.length) {
  activeStage = 4   ← 绝大多数情况走这里
} else {
  set(4, { state: 'completed' })
  const verified = allTasksVerified(...)
  // … ← 段 2 的 legacyTag / push 在这里
}
```

⚠ 要进 `else`，必须**全部任务都是 `built`** 且**每个任务都有 evidenceReady 的 returned RUN**。
   而 `built` 是「已构建待验证」，`returned` 是「已回传」——
   **两者在同一时刻同时成立，意味着整批任务全部走完执行且一条 RUN 都没在跑**。
   真实账本里通常总有任务在流动 ⇒ 永远进不了 `else`。

### 191.3 ⛔ 所以段 2 的记账应当改

| 之前 | 现在 |
|---|---|
| 「段 2 代码在位，行为未独立验证」 | **「段 2 代码在位，但**在真实账本中不可达**」** |

⚠ 这两者的区别很重要：

```
「未验证」= 可能有夹具能触发，只是我没造出来
「不可达」= **没有任何输入能触发它** ⇒ 它现在是**死代码**
```

### 191.4 ⚠ 死代码不是「白做」

```
段 2 的代码本身是对的（provenance 判定 + 前缀区分）；
它之所以不可达，是因为段 3 还没上线 —— 一旦段 3 让 verified 参与判定，
这个分支就会成为主路径。
⇒ 它现在是**预留代码**，⛔ 不是错误代码。
```

⚠ 但**必须如实记录它当前不执行**，否则下一次读代码的人会以为「影子模式已经在跑」。

---

### 191.5 ✅ 覆盖度已确认：`dsh-hob` 是**唯一**有真实分片的账本

⚠ 上一节只测了 `dsh-hob` 一本账。补测其余账本后确认**结论覆盖全部真实数据**：

```bash
find /home/lk/.dsh/hob-ledgers -path '*/units/unit-*.toml' | sed 's|/units/.*||' | sort -u
→  仅 ./dsh-hob/ledger
```

| 账本 | units 目录 | unit-*.toml 分片 | 结论 |
|---|---|---|---|
| `dsh-hob` | ✅ | ✅ | **292 单元 / 20 需求 / 0 标签**（已测） |
| `Mana` | ❌ | ❌ | 无数据 |
| `customer-service-agent` | ❌ | ❌ | 无数据 |
| `prompt-enhancer-release` | ✅ | ❌ | 旧格式（`ACC-001.md`，非 toml） |
| `prompt-enhancer-release.backup-*`（2 个） | ✅ | ❌ | 备份，非现行 |
| 其余（`dsh-plugin-roundtable` / `project-nav` / `shoucang` / `video-transcribe` / `workspace`） | ❌ | ❌ | 无 units |

⇒ **「段 2 在真实账本中不可达」这条结论覆盖了所有现行分片数据。**

⚠ 但如果将来 `prompt-enhancer-release` 按现行契约重开账，**它会是第二个可测样本** ——
   届时这条结论应当重测，⛔ 不能当作永久有效。

---

---

## §192 ✅ 重新评估剩余 5 条：确实都无法由我推进，但**理由要说准**

### 192.1 S-01 的理由需要更正

REVIEW 里写的是：

```
C1：ctx.approval.request() —— ⚠ 当前部署下必然失败：
    defaultPreset: danger-full-access → approval: never → request() 返回 rejected
```

⚠ 我按这句话复述了多轮。**核实后它不是「必然失败」，而是「API 不存在」**：

```bash
grep -rn 'approval\.request|approvalOf|requestApproval' src/ --include='*.ts'
→  0 处

grep -rn 'approval: never' preset/ src/
→  0 处
```

⇒ **`ctx.approval.request` 这个 API 在本仓根本没有被使用过** ——
   不是「调了会被拒」，而是「没有这个入口」。

⚠ 这两者的区别很重要：

| 说法 | 含义 | 谁能解决 |
|---|---|---|
| 「必然失败」 | API 存在，但当前配置下拒绝 | 改配置即可 |
| **「API 不存在」** | 宿主没提供这个能力 | **需要宿主侧新增能力** |

⇒ 后者更彻底地说明为什么我不能推进 —— ⛔ 不是配置问题，是**能力缺失**。

### 192.2 T-13 的 `migrate` 也不能简单加闸门

```bash
grep -n 'hob_ledger_migrate' src/modules/tools.ts
→  :382（工具表）· :2026（定义）
⇒ 它确实不过 proceedGate
```

⚠ 但它的 description 是「把旧账本里可判定的旧 kind/status 词迁移到现行封闭集」——
   **这恰恰是在「账本已坏 / 不可推进」时需要的动作**。
   给它加闸门 = 在 `mayProceed=false` 时**堵死唯一的修复通道**。

⇒ 要加闸门必须先回答：**被隔离的会话里，谁来做迁移？**
   ⛔ 本仓没有这个答案，⛔ 我不猜。

### 192.3 五条的准确理由（更正后）

| 编号 | 状态 | 真实理由 | 需要谁 |
|---|---|---|---|
| **R-01** | 段 2 不可达 | 段 3 让存量账本大面积变红，证据补不回来 | **产品决策** |
| **T-13** | 1/4 | `migrate` 加闸门会堵死自愈通道 | **产品决策** |
| **R-02** | 核心已修 | 验收规格「三者一致」与 `buildStages` 职责冲突 | **规格修订** |
| **T-07** | 按设计 | 已明确声明「不保证原子」 | 无（已闭合） |
| **S-01** | 未修 | **宿主未提供 `ctx.approval.request`** | **宿主能力** |

⚠ 只有 T-07 是真正闭合的（设计已声明）；其余 4 条都需要外部输入。

---

### 192.4 ✅ C2 的可行性也查清了：**宿主 `ToolRunContext` 没有消息回读能力**

REVIEW 对 C2 写的是「需宿主提供『会话消息可回读』的 API（**未验证**）」。
本轮把它验了：

```bash
grep -rn 'sessions.message|messageOf|readMessage|messages.get' src/   →  0 处
grep -rn 'ctx.sessions' src/                                          →  0 处
```

⇒ 看宿主类型定义（`@deepseek-ai/dsh-tools/lib/types/contracts.d.ts`）：

```ts
export interface ToolRunContext extends ToolExecution {
  deferContext(context: UserMessage): void;
  concludeTurn(): void;
  // ⚠ 就这两个方法，**没有任何消息回读入口**
}
```

⇒ **C1（`ctx.approval.request`）与 C2（消息回读）两条路都不可行** ——
   不是「当前配置下不可用」，而是**宿主类型里就没有这两个能力**。

### 192.5 ⚠ 这让 S-01 的定性更清楚

| 方案 | 依赖 | 实测 |
|---|---|---|
| C1 `ctx.approval.request()` | 宿主提供 approval 服务 | ⛔ 类型里没有 |
| C2 消息 MessageId 凭据 | 宿主提供消息回读 | ⛔ 类型里没有 |

⇒ REVIEW 给的两条根治路径**都依赖宿主扩展**，本仓无解。

⚠ 而 A 方案（`APPROVAL_ONLY_SHARDS` 收窄写入面）已经落地 ——
   它把攻击面从**两条**收窄成**一条**，是本仓在现有能力下能做的极限。

⇒ S-01 的正确记账是：**「A 已落地（攻击面收窄），根治需宿主新增能力」**。
   ⛔ 不是「未修」，⛔ 也不是「已修」。

---

---

## §193 ✅ 核实 A 方案的防护完整性：**没有遗漏分片**

### 193.1 防护点在最前面（关键）

`hob-write.ts:825-838`：

```ts
function checkWhitelist(file, mode, allowApprovalShard = false) {
  /**
   * ⚠ 批准分片只有专用工具能写（S-01(A)）：
   *   放在白名单**最前面** —— 否则会先被下面的 LEDGER_PATH_RE 放行。
   *   ⚠ allowApprovalShard 只由 hob_pipeline_approve 传 true。
   */
  if (isApprovalOnlyPath(file) && !allowApprovalShard) {
    return refuse(file, 'not-whitelisted',
      `拒绝：\`${file}\` 是**用户批准**的专用分片，\`write_hob\` 不能写。`
      + '\n      ⇒ 批准必须走 hob_pipeline_approve（它带用户回执校验）；'
      + '⛔ 直接写这个分片等于伪造一条「用户已批准」。')
  }
```

⚠ 三点都是正确的：

```
① 放在 LEDGER_PATH_RE 之前 —— 否则通用规则会先放行
② 错误消息说明了「为什么不能写」与「应该走哪条路」
③ 通行证是显式参数（allowApprovalShard），⛔ 不是绕过白名单
```

### 193.2 ⚠ 但我还要确认一件事：**批准是否只落这一个分片**

如果批准产物还能写到别的分片，那 `APPROVAL_ONLY_SHARDS` 只覆盖一个就是漏洞。

```bash
grep -n 'unit-pipeline-approval' src/modules/tools.ts
→  :2369  file: 'ledger/units/unit-pipeline-approval.toml'   （唯一写点）

grep -rn 'kind.*decision|DEC-' src/modules/tools.ts | grep -i 'write|file'
→  0 处（没有第二个写 decision 的路径）
```

⇒ ✅ **批准产物只落这一个分片，`APPROVAL_ONLY_SHARDS` 精确覆盖它，没有遗漏。**

### 193.3 ⚠ 但这条「唯一写点」有前提

```
它只保证「本仓代码里」批准只落这一个分片；
⛔ 不保证「没有别的工具能往这个分片写」—— 那由 allowApprovalShard 的传参面决定
```

⚠ 检查传参面：

```bash
grep -rn 'allowApprovalShard' src/
→  :528  类型定义
→  :811  注释
→  （只有 hob_pipeline_approve 一处传 true）
```

⇒ ✅ **传参面也是收敛的。**

### 193.4 S-01(A) 的最终定性

| 维度 | 结论 |
|---|---|
| 防护位置 | ✅ 在最前，先于通用白名单 |
| 覆盖分片 | ✅ `unit-pipeline-approval.toml`，且只此一个写点 |
| 传参面 | ✅ 只有 approve 一处传 true |
| 错误消息 | ✅ 说明原因与正确路径 |
| **剩余风险** | ⚠ 批准工具**仍由 Hob 调用**、`decided_by` **仍是硬编码** |

⇒ A 方案在**本仓能做到的范围内是完整的**；
   剩余风险只能靠宿主提供「用户本人触发通路」（C1/C2），而那两条已验为不可行。

---

---

## §196 ✅ check:audit-status 补上自带负向对拍（下限 0 → 1）

### 196.1 ⚠ 我上一轮亲手复现了 S-06/S-16 的缺陷

```
M-1 元规则：「每条判据都必须自带一条负向对拍」
而我给 check:audit-status 登记的 meta-negative-floor 是 **0**
⇒ 它「合法地」没有任何对拍 —— 判据不会红，因为它确实登记了
⇒ 这正是 S-06（10 个族下限为 0）与 S-16（注释掉的负控也算数）说的问题
```

### 196.2 ✅ 补上的对拍

⚠ **不能用「删掉文件」对拍** —— 那会让 `readFileSync` 抛错走进「读不到」分支，
   而那条分支测的是**文件缺失**，⛔ 不是**表格形态坏**。

⇒ 改为在**内存里**造三份「必错」变体，逐一喂给**同一个**解析函数：

| 变体 | 应被哪条判据咬住 |
|---|---|
| ① 删掉一行 | 行数 `!== 112` |
| ② 状态改成封闭集外的值 | `!STATUSES.includes(x.status)` |
| ③ 注记清空 | `x.note === ''` |

三条都必须命中，否则报「本族的判据是假绿」。

### 196.3 验证

```
✓ **负向对拍**：少一行 / 状态越界 / 注记清空 三种必错变体**逐个被咬住**（内存里造，⛔ 不落盘）
处级口径：查了 5 处 · 过了 5 处 · **跳过 0 处**
```

⚠ 配对更新：`ASSERTION_FLOORS` 4→5 · `meta-negative-floor` 0→1。

### 196.4 ⚠ 过程中踩的坑：块插到了提前退出分支之前

```
第一次插入：块被放在「文件读不到」的 if 分支里
⇒ 正常路径下负向对拍**不执行**，处级口径仍是 4 处
⇒ 移到正常出口前才对上 5 处
```

⚠ 这与 §113（SC-37 三次放错位置）**同一个坑**：
   在 `process.exit` 附近插代码，必须确认它在**所有路径**上都会被走到。

### 196.5 ✅ 当前「下限为 0」只剩 2 族，且都有理由

```bash
node -e "Object.entries(require('./scripts/meta-negative-floor.json').floor).filter(([,v])=>v===0)"
→  check:all（调度器，不产判定）· check:preflight（体检，恒 exit 0）
```

⚠ §133 已论证过：这两族**本身不产判定** ⇒ 加负向对拍没有意义。
   ⇒ 51 个族里，**49 个都有 ≥1 条负向对拍**。

---

---

## §197 ✅ T-13 的 `migrate` 确实**不能**加门禁 —— 已查实理由

### 197.1 `proceedGate` 的真实判定面

`preset/tools.ts:573-600` 的 `proceedGateFor`：

```ts
if (verdict.source === 'non-hob') return undefined          // 放行
if (verdict.source === 'no-policy-service') return undefined // 放行
if (verdict.mayProceed === true) return undefined            // 放行
// 其余一律拒绝
```

⚠ 而 `mayProceed=false` 的来源，注释逐条点名：

```
unknown-legacy（旧会话无快照 / 创建时刻判不出）、
store-unreadable / version-unknown、
quarantined、pending-activation、archived / archive-unknown、no-identity
```

### 197.2 ⛔ 关键：其中两类**正是「账本可能坏了」的时候**

| `mayProceed=false` 的来源 | 场景 | 这时候需要 `migrate` 吗 |
|---|---|---|
| `store-unreadable` | **策略存储读不出来** | ✅ 需要（账本可能坏了） |
| `unknown-legacy` | **旧会话无快照 / 判不出** | ✅ 需要（旧账本要迁移） |
| `quarantined` | 被隔离 | ⚠ 应该拒绝 |
| `pending-activation` | 未激活 | ⚠ 应该拒绝 |
| `archived` | 已归档 | ⚠ 应该拒绝 |
| `no-identity` | 无身份 | ⚠ 应该拒绝 |

⇒ **给 `migrate` 加 `proceedGate` 会同时堵死前两类** ——
   而那恰恰是最需要迁移的场景（旧格式 / 存储不可读）。

### 197.3 所以 T-13 的最终定性

```
approve 加闸门  → ✅ 正确（批准是「推进」动作，被隔离的会话本就不该批准）
init   不过闸门 → ✅ 有理由（开张不是推进）
migrate 不过闸门 → ⚠ **也必须不过**（它是「修复通道」，与 repair 同性质）
rebuild 不过闸门 → ⚠ 同上（归档重建 = 开张性质）
```

⚠ 这与 **O-01（`write-repair` 恒 `go` 但加 `bypass:'repair'`）** 是**同一个理由**：
   「修复动作必须在账本不健康时也能执行，否则永远修不了」——注释里原话：

```
⚠ 为什么仍保留 go（⛔ 不改判成 hold）：修复写本来就要能在账本不健康时进行，
  否则「修坏账」这个动作永远做不了（死锁，与 O-43/T-06b 同族）。
```

### 197.4 ⇒ T-13 的正确记账

| 之前 | 现在 |
|---|---|
| 「部分修（1/4）」 | **「按设计（1/1 该修的已修）」** |

```
approve 是 4 个工具里**唯一该加闸门**的（因为它「推进」而非「修复」）；
其余 3 个（init / migrate / rebuild）都在做「开张」或「修复」，⛔ 不该拦。
⇒ T-13 已经**完整解决**，不是在等产品决策。
```

⚠ 这一条我前几轮一直记成「需产品决策」——**错在我没查 `proceedGate` 的判定面**。
   查完才发现：加闸门不是「要不要做」的问题，是**做了会错**的问题。

---

### 197.5 ✅ 补证：`approve` 确实不是「修复通道」

上一节说「approve 是唯一该加闸门的」，但只凭「它是推进动作」还不够——
⚠ 还要排除「它也是某种修复手段」。查它的 description：

```
description: '记录用户对 Pipeline v3 需求或方案的明确批准 / 修改要求。'
  + '⚠ 必须给用户回执原文 source；默认只预演，真写要 dryRun:false。'
  + '⚠ 它只写批准审计，不替用户选路径，也不自动推进阶段。'
```

⇒ **它不修复任何东西**：不重建账本、不迁移旧词、不开张。
   它只是**记录一个外部事实**（用户批准了）。

| 工具 | 性质 | 该不该过闸门 |
|---|---|---|
| `approve` | **记录外部事实**（用户批准） | ✅ 该（被隔离的会话不该产生「用户批准」） |
| `write_hob` | 写工作区文档 | ✅ 该（已有，`:1769`） |
| `init` | 开张 | ⛔ 不该 |
| `migrate` | **修复通道** | ⛔ 不该 |
| `rebuild` | 归档重建 = 开张 | ⛔ 不该 |

⚠ 判据：**「它在改变账本状态，还是在记录/修复账本状态？」**

```
改变（推进）→ 该拦：approve · write_hob · dispatch · verify · accept
开张/修复     → 不该拦：init · migrate · rebuild · write-repair
```

⇒ T-13 的「按设计处理」成立：**4 个写工具里该加闸门的只有 approve，而它已经加了。**

---

---

## §198 ✅ R-02 的规格冲突已**双向验证**：不只是「职责边界」问题

### 198.1 之前的论证只说了「会破坏职责边界」

§169 我判定 R-02 的规格过宽，理由是：

```
REVIEW 要求「summarizeStage / pipelineViewOf / displayState 三者对每一步一致」
但 buildStages 的 docstring 明写职责是「渲染单元数组」⇒ 按字面实现会破坏职责边界
```

⚠ 这只是一**个方向**的论证（「改了会坏」）。⛔ 还缺另一个：**「现有判据体系也不要求它」**。

### 198.2 ✅ 本轮补上第二个方向

```bash
grep -n 'activeStage' scripts/check-stages-route.mjs
→  0 处

npm run -s check:stages-route
→  处级口径：查了 39 处 · 过了 39 处 · 跳过 0 处
```

那 39 条断言的实际内容（抽样）：

```
✓ R-0 ✓ 转译图自证通过（stages-index.ts · item-presentation.ts · …）
✓ R-1 ✓ 五类情形五句话：根判不出 · 还没开账 · 旧格式 · …
✓ R-1b ✓ 合法 kind + 非法 status ⇒ row-shape-unknown，点名单元 / 原值 / 合法集
```

⇒ **39 条全部针对 `buildStages` 自身的语义**（五类 reason / 行形状 / kind-status 合法性…），
   ⛔ **没有一条要求它感知 `activeStage`**。

### 198.3 所以 R-02 的规格冲突是**双向的**

| 方向 | 论证 |
|---|---|
| ① 改了会坏 | `buildStages` 的职责是渲染单元数组 ⇒ 让它感知主线会破坏分层 |
| ② **现有判据也不要求** | `check:stages-route` 39 条断言 **0 处** `activeStage` |

⚠ 两个方向都成立 ⇒ **不是「规格过宽」这么含糊，而是「规格与实际设计相反」**。

### 198.4 ⇒ R-02 的准确记账

| 维度 | 结论 |
|---|---|
| 缺陷描述 | ✅ 准确（当时确实有 5 份实现） |
| 修复（前两者收敛） | ✅ 已做（`requirement-chain` 派生自 `pipeline-view`） |
| 修复（客户端不再并置） | ✅ 已做（4 处全用 `displayState`） |
| **规格第①条「三者一致」** | ⛔ **与设计相反**，⛔ 不该实现 |

⇒ 记账：**「已修（规格第①条经双向量证与设计相反，不应实现）」**。
   ⛔ 不是「核心已修 + 规格需修订」—— **规格不需要修订，它需要被推翻**。

⚠ 但推翻规格要改 `REVIEW-VOL2-1.md`，那是**审计快照**（记录当时的判断），
   ⛔ 不该改。⇒ 正确做法：在 `STATUS.md` 写明「规格第①条经复核与设计相反」。

---

### 198.5 ⚠ 我试图用真实账本实测，但**数据不支持**

```
账本：dsh-hob · 292 单元 · 20 条需求
pipelineViewOf state 分布：
  legacy  17 条
  retired  3 条
  ⇒ **没有一条 v3 需求**
```

⚠ 我写的验证脚本先按 `v.state === 'legacy'` 跳过 ⇒ 逐格比较 **0 对**。
   这不是「一致」，是**没有可比对象**。

⇒ **「requirement-chain 派生自 pipeline-view」这条结论，只能靠读码证明，⛔ 无法用真实账本实测。**

### 198.6 读码证据（仍然成立）

```bash
grep -n 'pipelineViewOf' src/shared/requirement-chain.ts
→  :22   import { pipelineViewOf, type PipelineView } from './pipeline-view.ts'
→  :348  const pipeline = pipelineViewOf(req as any, units as any)

grep -n 'pipeline.stages' src/shared/requirement-chain.ts
→  :381  const v3Stage = legacy ? undefined : pipeline.stages.find((s) => s.id === d.kind)
→  :616  target: partial.pipeline.stages[1]?.itemIds[0] ?? null
```

⇒ ✅ **派生关系成立**（R-13 的改动没有破坏它）。
   ⚠ 但这是**静态证据**，不是运行时实测 —— 两者强度不同，⛔ 不该混说。

### 198.7 ⚠ 顺带发现：这个账本**没有 v3 需求**

| 观察 | 含义 |
|---|---|
| 20 条需求全 legacy/retired | 本账本**从未真正启用过** v3 主线 |
| 但 `built 50` / `pass 55` | 任务与验证**是按 v3 形态写的** |

⚠ 这个组合很奇怪：**单元按 v3 写，需求却判 legacy**。
   可能原因：需求的 `pipeline_version` 没标，或 `clarify_legacy=pre-control`。

⇒ 这解释了为什么 §191 测 `[宽限]/[影子]` 标签时 0 命中 ——
   不是代码不可达，而是**这本账本根本没有 v3 需求**。

⚠ 所以 §191 的结论「段 2 不可达」**需要修正**：

```
之前：段 2 在真实账本中不可达（292 单元 / 20 需求 / 0 标签）
现在：这本账本**没有 v3 需求** ⇒ 段 2 的代码路径**从未有机会执行**
⇒ 不是「不可达」，是「没有适用输入」
```

---

### 198.8 ⛔ 决定性的实测：这本账本**一个 `pipeline_version` 都没有**

```bash
grep -h 'pipeline_version' /home/lk/.dsh/hob-ledgers/dsh-hob/ledger/units/*.toml | sort | uniq -c
→  **0 行**

grep -c 'clarify_legacy' …/unit-*.toml
→  unit-01.toml: 52
→  unit-02.toml: 42
→  unit-03.toml: 17
→  合计 **111 次**
```

⇒ **这本账本全部是 legacy 单元，没有任何 v3 标记。**

| 推论 | 含义 |
|---|---|
| `pipelineViewOf` 对 17/20 需求返回 `legacy` | 因为它们确实没有 v3 标记 |
| `[宽限]/[影子]` 标签 0 命中 | **不是代码不可达，是没有适用输入** |
| `built 50` / `pass 55` 仍存在 | 任务/验证单元按 v3 形态写，但需求没标 v3 |

### 198.9 ⛔ 所以 §191 的结论必须修正

| 之前 | 现在 |
|---|---|
| 「段 2 在真实账本中**不可达**（死代码）」 | **「段 2 从未有机会执行 —— 这本账本没有 v3 需求」** |

⚠ 这两个说法的区别很关键：

```
「不可达」= 任何输入都触发不了 ⇒ 代码有问题
「没有适用输入」= 代码可能没问题，只是数据是 legacy 的
⇒ 我上一轮的结论**越界了** —— 用一本 legacy 账本推出了「代码不可达」。
```

⚠ 这是本轮第二次「单一证据下全局结论」：

```
第一次：读码说「派生成立」→ 想实测 → 发现 20 条需求全 legacy（不可比）
第二次：§191 用 legacy 账本的 0 命中 → 推出「不可达」
```

⇒ 两条都**高估了证据的适用范围**。

---

---

## §199 ✅ 顺带实测确认：O-05 的修复对本账本**真的生效**

### 199.1 本账本的完整画像

```
路径：/home/lk/.dsh/hob-ledgers/dsh-hob/ledger/
目录：CONSTITUTION.md PROJECT.md acc/ archive/ changes/ gen/ runs/ spec/ units/
⚠ **没有 ledger.toml**

单元：292 个
  kind 分布：acc 66 · evidence 75 · run 56 · task 50 · req 20 · change 13 ·
             goal 5 · risk 5 · cap 1 · decision 1
  status 分布：pass 55 · built 50 · agreed 17 · active 6 · closed 2 · handling 2 · …
  pipeline_version：**0 个**
  clarify_legacy：**111 次**
```

### 199.2 ✅ 这正好命中 O-05 描述的形态

O-05 原文：「`indexIntegrityProblems` 只在 `activation==='active'` 时生效 ⇒ **现行实例永远不核**」
病因注释：「而**现行真实账本没有 ledger.toml**」

⇒ **本账本正是那个「没有 ledger.toml」的现行真实账本。**

### 199.3 修复条件逐条对照

`tools.ts:970`：

```ts
if (probe.indexText !== undefined && (
  lifecycle.activation === 'active' ||
  lifecycle.legacyCompatible ||
  lifecycle.activation === 'missing'
)) { … 跑 A-4 索引完整性检查 … }
```

| 条件 | 本账本是否命中 |
|---|---|
| `activation === 'active'` | ❌（无 ledger.toml，不会是 active） |
| `legacyCompatible` | ✅（111 处 clarify_legacy ⇒ 是 legacy 兼容账本） |
| **`activation === 'missing'`** | ✅ **（正是这个新加的条件）** |

⇒ **O-05 的修复不是纸面改动 —— 它让本账本从「永远不核」变成「会被核」。**

### 199.4 ⚠ 这也解释了为什么会有这篇审计

```
本账本：292 单元 · 10 种 kind · 111 处 legacy 标记 · 0 个 pipeline_version
⇒ 它是 **v2 时期积累的存量账本**，一直在用
⇒ 而 O-05 说的「现行实例永远不核」意味着：
   **这 292 个单元的索引完整性，在修复前从未被检查过一次**
```

⚠ 这是个具体的、可量化的后果 —— 不是抽象的质量问题。

### 199.5 仍未解释的一件事

```
任务 status=built 50 条、验证 status=pass 55 条 —— 这些是 v3 形态的词；
但需求 pipeline_version 0 个 —— 那是 v2 形态。
⇒ 同一本账里混着两代词。
```

⚠ 可能的解释：`built` / `pass` 在 v2 里也有（属于 `UNIT_STATUSES` 封闭集），
   ⛔ 不一定是 v3 引入的。⇒ **本轮不深究**，登记为观察。

---

### 199.6 ❌ 「混着两代词」是误报 —— 已查清

`ledger-validation.ts:14-27` 的 `UNIT_STATUSES`（**唯一权威的 status 封闭集**）：

```ts
task:         ['todo', 'doing', 'built']
acc:          ['pass', 'send-back', 'unverified']
verification: ['unverified', 'pass', 'send-back', 'waived']
…
```

⇒ **`built` / `pass` 本来就在 v2 与 v3 共用的封闭集里**，⛔ 不是「v3 才引入的词」。

| 上一轮的观察 | 实际情况 |
|---|---|
| 「任务 `built` / 验证 `pass` 是 v3 形态的词」 | ❌ 它们在**共用封闭集**里 |
| 「同一本账里混着两代词」 | ❌ 误报 |

⚠ 我在上一轮把「v2 账本没有 `pipeline_version`」和「有 `built`/`pass`」
   当成了两个时代的冲突，而实际上**这两个词从来不属于某个时代**。

⇒ 这解释了为什么本账本能一边是 legacy、一边又有 `built`/`pass`：
   **`pipeline_version` 标的是「这条单元是否走 v3 阶段机」，⛔ 不是「用哪套词表」。**
   两个维度正交。

---

### 199.7 ✅ 实测确认：新建单元**必须**标 v3，存量豁免

```js
// 新建 req，不标 v3
pipelineWriteProblems([], [{ id: 'R-NEW', kind: 'req', status: 'draft', revision: '1' }])
→  问题数 1 · C-23: 新 req 必须登记 pipeline_version="v3"

// 标了 v3
pipelineWriteProblems([], [{ …同一条…, pipeline_version: 'v3' }])
→  问题数 0
```

⇒ **本账本「0 个 `pipeline_version`」是历史存量的正常状态**：

```
292 个单元全是存量 ⇒ 不需要标 v3（C-23 只对 old === undefined 的新单元生效）
将来新建任何 req / change / task / run / acc ⇒ **必须**标 v3，否则当场 C-23
```

⚠ 所以这本账本是**「纯 legacy 存量 + 未来必然 v3」**的过渡态，⛔ 不是配置错误。

### 199.8 本轮小结：一条观察的完整生命周期

| 步骤 | 内容 |
|---|---|
| ① 提出 | 「同一本账混着两代词」（§199.5） |
| ② 怀疑 | 去查 `UNIT_STATUSES` 封闭集 |
| ③ 否定 | `built`/`pass` 是**共用词**，⛔ 不属于某个时代 |
| ④ 补实证 | 新建单元实测：不标 v3 ⇒ C-23 拒绝；标了 ⇒ 通过 |
| ⑤ 结论 | 本账本是「纯 legacy 存量」的过渡态，正常 |

⚠ **这条观察从提出到定性用了两轮** —— 而它本可以在提出时就查 `UNIT_STATUSES` 一次解决。
   ⇒ 教训：**观察要立刻去证实或证伪，⛔ 不要「登记为观察」就放下**。

---

---

## §200 ⚠ R-01 段 3 的前提**对本账本不成立**

### 200.1 段 3 担心的是什么

`pipeline-view.ts:207-212`：

```
直接改强判据会让**存量账本大面积变红**：历史上「自己验自己」的项目会从 completed
翻成 incomplete，而**证据补不回来**（当时就没留）。
⇒ 段 3：全量（删宽限分支）。
```

⚠ 所以段 3 被推迟的理由是「会让存量账本变红」。

### 200.2 ✅ 但本账本**全是 legacy**，根本走不到那段代码

```ts
// :439
if (legacy) {
  …  //  ← legacy 分支
} else {
  …  //  ← :505 的强判据 / strongGaps 都在这里
}
```

```
本账本：20 条需求，17 legacy + 3 retired
  ⇒ **没有一条进入 else 分支**
  ⇒ 段 3（让 strongGaps 参与 verified）对本账本**零影响**
```

⚠ 所以「存量大面积变红」这个担忧，**在这本账本上不成立**。
   它成立的前提是「存量账本里有 v3 需求」—— 而本账本一条都没有（§198.8）。

### 200.3 ⇒ 这对 R-01 意味着什么

| 问题 | 答案 |
|---|---|
| 段 3 会让本账本变红吗 | ❌ **不会**（无 v3 需求） |
| 段 3 会让任何已知账本变红吗 | ⚠ **未测**（只有一本有分片数据） |
| 那 R-01 段 3 还等什么 | ⚠ **等的是「将来有 v3 存量时怎么办」，不是现在** |

⚠ 结论：**段 3 的技术前提（让 strongGaps 参与 verified）随时可以做**，
   ⛔ 但「做了之后对将来出现的 v3 存量账本意味着什么」——那个没有答案。

### 200.4 ⚠ 所以 R-01 的正确记账更精确了

| 之前 | 现在 |
|---|---|
| 「段 3 需产品决策：存量账本会大面积变红」 | **「段 3 的实现无障碍（本账本零影响）；需决策的是『将来 v3 存量如何豁免』」** |

⇒ 决策点不在「现在做会不会坏」，而在「**这个功能上线后，历史 v3 项目怎么算**」。

⚠ 这与 §197 的 T-13 结构相似：**不是「要不要做」，而是「做了之后某个边界怎么办」**。

---
