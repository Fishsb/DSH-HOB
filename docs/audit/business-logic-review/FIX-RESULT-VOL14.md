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

---

## §201 ❌ R-01 段 3 的断言**没能写出来**（已回滚，如实记录）

### 201.1 我尝试了什么

给 R-01 段 3 加一条 `PIPE-32`：

```
① 「验证者=实现者」的 pass 验证 ⇒ 阶段 5 不能算 completed
② 「验收者=实现者」的 accepted 验收 ⇒ 阶段 6 不能算 completed
③ 基准：验证者为他人时阶段 5 应当 completed（证明夹具到达判定点）
```

### 201.2 ⛔ 失败了：基准到不了判定点

```
✗ PIPE-32 · 验证者是别人时阶段 5 也没 completed ⇒ 夹具没到达判定点，本条不可判："draft"
```

**排查过程（3 轮）**：

| 轮 | 问题 | 修正 |
|---|---|---|
| ① | `TypeError: bad is not a function` | 我把局部变量叫 `bad`，遮蔽了 `bad()` 函数 ⇒ 改名 `viewBad` |
| ② | `activeStage = 1`（卡在 G1） | `DEC.status` 必须是 `'active'`，我写的 `'agreed'` |
| ③ | 仍 `activeStage = 1` | **`APPROVAL_DECISIONS = ['approve', ...]`**，我写的 `'approved'`（多一个 d） |

⚠ 第③条查出来时，`approvalStateOf` 返回 `missing`（「还没有用户批准记录」）——
   原因是 `decision: 'approved'` 不在封闭集里，那条 DEC 被当成「格式不对」丢掉了。

修正后**仍卡在 `activeStage = 1`**，未查明剩余原因。

### 201.3 ✅ 判据本身的行为是正确的

⚠ 它**没有**在我造错夹具时假装通过，而是明确报：

```
✗ 夹具没到达判定点，本条不可判
```

⇒ 这正是负向对拍应有的行为：**「不可判」必须与「通过」区分开**。
   我在 §189/§190 遇到过同样的情况（段 2 的夹具也造不出来）。

### 201.4 ⛔ 但保留它会让 check:all 变红

```bash
npm run -s check:pipeline   →  EXIT=1
```

⇒ **不能保留一条永远红的判据**（那是「恒红判据等于没有判据」）。
   ⇒ 已回滚 `PIPE-32`，`check:pipeline` 恢复 EXIT=0。

### 201.5 ⇒ R-01 段 3 的准确状态

| 项 | 状态 |
|---|---|
| 实现（验证侧 `allTasksVerified`） | ✅ 已改（§170） |
| 实现（验收侧 `allTasksAccepted`） | ✅ 已改（§171） |
| **断言** | ⛔ **没写出来**（夹具造不出「到达阶段 5」的场景） |
| `check:all` | ✅ 48/48（不含这条断言） |

⚠ 这与 §158 的教训正面冲突：**「代码改了但没断言」正是我反复批评的形态**。
   而这次我**确实没做到**——只能如实记，⛔ 不假称「已加断言」。

### 201.6 为什么夹具这么难造

`pipelineViewOf` 的判定链有 **7 步门禁**，要到达阶段 5 必须依次通过：

```
G1 需求批准（DEC.status='active' + decision 在封闭集 + decided_by='user' + 版本匹配）
G2 方案批准（同上）
G3 任务图（无环 / 无悬空 / 覆盖缺口 = 0）
G4 执行（全部 task 都 'built' + 每个都有 evidenceReady 的 'returned' RUN）
⇒ 才轮得到阶段 5 的 verified 判定
```

⚠ 我逐层修到第 3 层就卡住（`activeStage` 仍是 1），说明**前面还有没对齐的条件**。
   而 `check-pipeline.mjs` 里既有的 31 条断言**没有一条走到阶段 5**——
   ⇒ 它们用的是更浅的场景，⛔ 不能直接复用。

---

---

## §202 ⚠ R-01 段 3 的夹具攻坚：G1 ✅ G2 部分 ✅，但没走到阶段 5

### 202.1 已查清的三层条件（都是我之前不知道的）

| 层 | 条件 | 我原来写的 | 正确形态 |
|---|---|---|---|
| ① `decision` 单元形状 | 必须 `decision_kind: 'stage-approval'` + `artifact_id` | 写 `parent` | `artifact_id: 'R-9'` |
| ② `decision` 的封闭集 | `APPROVAL_DECISIONS = ['approve', 'request-changes']` | 写 `'approved'`（多一个 d） | `decision: 'approve'` |
| ③ `artifact_digest` 必须**基于带 revision 的完整单元** | — | 用无 revision 的对象算 ⇒ `revision: ""` ⇒ digest 不同 | 先 `{...base, kind, ...o}` 再 `artifactDigestOf(u)` |
| ④ 方案批准必须带 `selected_option` | — | 没写 ⇒ `invalid`（「批准选中的路径 (空)」） | `selected_option: 'A'` |

⚠ 第③条最隐蔽：`artifactCanonicalText` 里 `revision: revisionOf(u) ?? text(u.revision)`——
   而 `revisionOf` **只认数字字符串**，无 revision 时得 `""` ⇒ digest 与带 revision 的算出来不同。

### 202.2 ✅ 已拿到的关键信号：强判据确实生效了

```
同一夹具，只改验证者：
  自己（dev-A）→ blockedBy **13** 条
  他人（dev-B）→ blockedBy **11** 条
                  ─────
                  差 2 条
```

⚠ 那 2 条正是 **验证侧 + 验收侧** 的强判据缺口。
   ⇒ **R-01 段 3 的代码确实在生效** —— 这是本轮最有价值的证据。

### 202.3 ⛔ 但 `activeStage` 仍停在 2

```
自己   activeStage=2 | stage5=draft
他人   activeStage=2 | stage5=draft
```

⇒ G2 之后的门禁还没通过（`blocked=13` 说明还有别的问题）。
   **本轮未查完**，⛔ 不继续耗时。

### 202.4 ⇒ 断言的正确写法应当**不依赖完整链**

⚠ 我一直在试图让夹具走完 7 步。但那不是这条判据的必要条件——
   **「强判据是否参与判定」可以直接从 `blockedBy` 的差值看出来**：

```js
const selfGaps = viewOf('dev-A').blockedBy.filter(x => /强判据/.test(x))
const otherGaps = viewOf('dev-B').blockedBy.filter(x => /强判据/.test(x))
// ① selfGaps.length > otherGaps.length  ⇒ 强判据对「自己验自己」多报了缺口
// ② 且 selfGaps 里的第一条含「影子」或「宽限」前缀
```

⚠ 但这只证明它**报了缺口**，⛔ 不证明它**参与了 verified**（前者是段 1 就能做到的）。
   ⇒ **要证明段 3，必须看到 `stage5 !== 'completed'`** —— 而那需要走完整链。

⇒ **本轮结论：夹具攻坚到第 4 层，仍未到达阶段 5。断言仍未写出。**

---

### 202.5 ⛔ 更根本的问题：强判据**一条都没产出**

```
自己（dev-A）强判据缺口: 0 | 首条: (无)
他人（dev-B）强判据缺口: 0 | 首条: (无)
```

⇒ `strongVerificationGaps` **根本没产出内容** —— 连**段 1 的影子模式**都测不到，
   更不用说段 3 的「参与判定」。

⚠ 上一轮我说「blockedBy 差 2 条 ⇒ 强判据生效」——**那个判断是错的**：

```
13 vs 11 的差，来自别的东西，不是 [影子]/[宽限] 前缀的强判据行。
本轮按 /强判据/ 精确过滤 ⇒ **两边都是 0**。
```

⇒ 这又是一次「用近似证据下精确结论」。

### 202.6 ⇒ 最终的诚实结论

| 项 | 状态 |
|---|---|
| R-01 段 3 实现（两侧） | ✅ 已改并提交 |
| 强判据在本夹具上是否产出 | ⛔ **0 条，未触发** |
| 断言 | ⛔ **仍未写出** |
| 夹具的 4 个已知条件 | ✅ 已写进源码注释（供后人） |

⚠ 我花了 3 轮（§201–§202）试图给 R-01 段 3 写断言，**没成功**。
   期间查清了 4 个夹具条件并写进注释，但**断言本身没有**。

### 202.7 ⚠ 为什么收手

```
① 继续需要理解 pipelineViewOf 的完整 7 步判定链（约 300 行）；
② 而这条断言的收益是「防止段 3 被改回去」——
③ 但 now 它连「强判据是否会产出」都测不到，说明**我还没找到正确的触发点**；
④ 硬造一个「碰巧通过」的夹具比没有断言更糟。

⇒ 停在这里，把已知条件写进注释，比继续摸黑更负责。
```

---

---

## §203 ❌ 「断言插入位置」无法机检 —— 试过，6 个候选全是误报

### 203.1 我想做什么

我在 4 个不同脚本里犯过同一个错：**断言块插到了 `process.exit(0)` 之后 ⇒ 从不执行**。
（§113 SC-37 三次、§197、§202 LP-17）

⇒ 想加一条机检：`process.exit(0)` 不能在 `处级口径` 之前。

### 203.2 实测：50 个脚本有 `处级口径`，6 个「可疑」

```
scripts/check-build-sync.mjs        (exit:404 < 口径:1380)
scripts/check-config-face.mjs       (exit:1352 < 口径:2061)
scripts/check-experience.mjs        (exit:356 < 口径:547)
scripts/check-gitignore.mjs         (exit:99 < 口径:532)
scripts/check-profile-assembly.mjs  (exit:1294 < 口径:1348)
scripts/probe-selfwake-e2e.mjs      (exit:277 < 口径:305)
```

### 203.3 ⛔ 逐个核实后：**6 个全是误报**

查 `check-build-sync.mjs:404`：

```js
if (ARGV.includes('--self-check')) process.exit(0)
```

⇒ 它在**条件分支**里（只在 `--self-check` 模式下退出），⛔ 不是主路径。

```bash
npm run -s check:build | grep -c '处级口径'   →  1   ✅ 正常打印
```

⚠ 其余 5 个同理（都是 `--xxx` 模式分支或提前返回）。

### 203.4 ⇒ 结论：这条机检**做不了**

```
行号顺序 ≠ 执行顺序。
`process.exit(0)` 可能在 if 分支里、可能在箭头函数里、可能被 return 挡住。
要判「某段代码是否可达」需要**控制流分析**，而那不是一条 grep 能做的。
```

⚠ 这与 §139 的教训一致：**「看起来像的问题」必须先验证，⛔ 不能直接当缺陷报**。
   如果我当时写了这条判据，它会**让 6 个正常的族变红**。

### 203.5 那这个错怎么防

```
✅ 可做：跑完检查后**看完整输出**，确认 ✓ 文案真的出现了、处级口径数字变了。
⛔ 不可做：靠静态规则判断「这段代码会不会执行到」。
```

⚠ 所以本轮的净产出是：**证明了这条机检不可行**，并留下 6 个误报的分析。
   这比写一条会让 6 个族假红的判据要好。

---

---

## §204 ✅ R-01 收口 —— 「删宽限分支」原来早就做了，是我读漏了

### 204.1 我之前怎么判的

> 「段 3 唯一剩余缺口：REVIEW 定义含「删宽限分支」，未删——因为「将来出现 v3 存量账本时如何豁免」无答案」

⚠ 这条判断**错了**，而且错了 3 轮。错因：只读 `pipeline-view.ts` 的 `legacyTag`，
   看到它「只加前缀、不影响 verified」，就认定「宽限还在」。

### 204.2 真正的豁免位置

```js
// src/shared/stage-controls.ts:784  verificationProblems
if (u.kind !== 'verification' || legacy(u)) return []   ← 宽限在此

// src/shared/stage-controls.ts:661  acceptanceProblems
if (legacy(u)) return []                                ← 宽限在此
```

⇒ **段 3 的语义是**：`verificationProblems` / `acceptanceProblems` **无条件**参与判定；
   历史单元的豁免由 `legacy()` 在**函数内部**完成（三层他证：自报 + 非 v3 + provenance）。
   ⇒ 「删宽限分支」= 删掉 `pipeline-view.ts:439` 那种**整段跳过**的分叉，
     ⛔ 不是删掉 `legacy()` —— 后者是**豁免的凭据**，不是豁免的分支。

### 204.3 ⚠ 但没有任何断言在守这个豁免

```bash
grep 'legacy(u)\|宽限' scripts/check-stage-controls.mjs   →  0 处
```

| 断言 | 测什么 | 删掉 `|| legacy(u)` 会红吗 |
|---|---|---|
| SC-38 | 判据有没有**分辨力** | ❌ 不红 |
| SC-39 | `allTasksVerified` 有没有**调**判据 | ❌ 不红 |
| **SC-40**（新） | 豁免式**在不在、在不在前半段** | ✅ 红 |

### 204.4 ✅ SC-40

```
✓ SC-40 ✓ R-01 段 3 的宽限豁免在判据函数内部（源码层）：
        verificationProblems / acceptanceProblems 都在函数体前部
        以 `legacy(u)) return` 提前返回
```

两条检查：

```
① 两个函数体里都要有 `legacy(u)) return` 的豁免式；
② 位置必须在函数体**前半段** —— 防止有人把它挪到末尾兜底，
   那样已 push 进 out[] 的问题仍然算数，豁免等于失效。
```

### 204.5 ✅ 负向对拍

```
删掉 `|| legacy(u)`
→ ✗ SC-40 · `verificationProblems` 里没有 `legacy(u)) return` 的提前返回
           ⇒ 技术验证侧的历史单元豁免没了（R-01 段 3 会拦死存量）
```

### 204.6 验证

```
check:stage-controls   114/114（原 113，+1）· 下界 113 → 114
grep 'legacy(u)) return' src/shared/stage-controls.ts   →  10 处
```

### 204.7 ⚠ 教训

```
「某段文字还在」≠「那个缺陷还在」。
我看到 `legacyTag` 里写着「宽限」，就以为宽限分支没删。
实际上：`legacyTag` 是**显示层**（加 [宽限] 前缀），
        `legacy(u)` 是**判定层**（要不要豁免）—— 两者同名不同层。
```

⚠ 这与 §155（grep 命中数 ≠ 缺陷还在）、§137（按编号 grep 不可靠）同族：
   **变量名/文案相似的两个东西，可能处于完全不同的层次。**

---

---

## §205 ⚠ 负向对拍自己会出错 —— 三次才造对变异体

### 205.1 起因

补 `SC-40`（守 R-01 宽限豁免的位置）后，我做了 3 次负向对拍，**前两次都报 ✓**。
当时的结论会是「判据无效」，但真相是**变异体造错了**。

### 205.2 三次尝试

```
第 1 次：读的是 /tmp/sc_bak2.ts（备份），不是磁盘上的变异体
        ⇒ 看到的是原始代码 ⇒ 假绿

第 2 次：变异体把豁免挪到 @356，而首个 out.push 在 @454
        ⇒ 豁免仍在 push 之前 ⇒ 语义上没变异 ⇒ 假绿

第 3 次：挪到 @518（首个 out.push @426 之后）
        ⇒ ✗ SC-40 · 豁免式在首个 out.push 之后（豁免 518 > push 426）✅ 真红
```

### 205.3 顺带修正了判据本身

原判据：「豁免须在函数体**前半段**」（`m.index > b.length / 2`）

⚠ 这个判据**语义不对**：

```
函数体 3931 字，前半段 = 1965。
豁免在 @356（前半段内）✅ 判据放行
但首个 out.push 在 @454 ⇒ @356 确实在 push 之前，这次是对的。

换个例子：豁免在 @1900（仍在前半段），push 在 @500 ⇒ 已被 push，末尾 return 撤不回。
⇒ 「前半段」既不充分也不必要。
```

**正确判据**：豁免必须早于**任何** `out.push`。已改：

```js
const firstPush = b.indexOf('out.push')
if (firstPush >= 0 && m.index > firstPush) {
  p.push('豁免式在首个 out.push 之后 ⇒ 末尾兜底挡不住已 push 的问题')
}
```

### 205.4 另一条：负向对拍会弄脏构建

做完变异体后我只 `cp` 恢复了源码（`git diff` = 0），**没重新 build**。
结果 `check:all` 报 `check:build` 失败：

```
✗ 面 ②：src/shared/stage-controls.ts 比产物 lib/shared/stage-controls.js 新
✗ 面 ①：产物落后于当前提交
```

⚠ **这不是产线缺陷，是对拍的副作用。** `npm run build` 后 `check:build` 恢复 PASS。

⇒ **规矩：改了 `src/` 做对拍，恢复后必须 `npm run build`**，否则下一轮 `check:all` 会假红。

### 205.5 面 ③ 只报不影响退出码（设计如此）

build 后仍打印：

```
✗ 面 ③：运行实例落后于产物 —— 1 个宿主进程早于这次 build 就启动了
```

⚠ 但它**不影响退出码**（`EXIT=0`）。理由在脚本里：

```
`npm run check` 只传 --strict-source，不传 --strict-instance
理由："刚 build 完还没重启"会让面 ③ 恒红
```

⇒ 要重启宿主才会真正转绿，那是外部动作。

---

---

## §206 ✅ 找到了 `check:build` 反复变红的真正机制：**build 必须在最后一次 commit 之后**

### 206.1 现象

本会话中 `check:build` **红了 4 次**（v46 / v50 / v51 等），每次都是同一句：

```
✗ 面 ①：产物落后于当前提交 —— 戳 commit=xxx · HEAD=yyy
```

⚠ 其中**有一次我只改了文档**（`FIX-RESULT.md`），它照样红。

### 206.2 根因

`check-build-sync.mjs` 的面① 判的是「**产物戳的 commit 是否等于当前 HEAD**」，
⛔ 不是「有没有编译过」。

```
我在 ea19aa5 上 build  → 戳记下 commit=ea19aa5
之后提交文档改动       → HEAD 变成 7cc896c
⇒ 戳 ≠ HEAD ⇒ 面① 红（与改动内容无关，改文档也一样）
```

### 206.3 ✅ 验证

```
npm run build
→ STRICT_EXIT=0
→ 戳 commit=7cc896c（= HEAD）· dirty=false
```

### 206.4 ⇒ 正确顺序

```
❌ 我之前：  改代码 → build → 验证 → commit     （戳永远落后一步）
✅ 正确：    改代码 → commit → build → 验证     （戳与 HEAD 对齐）
```

⚠ **跑完 `check:all` 之后不要再提交**；要提交就再 build 一次。

### 206.5 这与 `--strict-source` 的设计一致

```
STRICT_FAMILIES 加 --strict-source，不加 --strict-instance
理由：面①② 的恒红风险（改完没 build）**可以立刻消掉**；
      面③  的恒红风险（刚 build 完还没重启）**消不掉**。
```

⇒ 我遇到的红灯**是这套设计在正确工作**，⛔ 不是缺陷。
   要做的是按正确顺序操作，⛔ 不是去改判据。

---

---

## §207 ⚠「断言守护」⛔ 不等于「逐条对应」—— 我此前的一个无依据断言

### 207.1 我说过的话

前几轮我反复写：「106 条已修，**每条都有断言守护**」。

### 207.2 实测：不成立

```
已修条目                              106
证据列里提到断言 ID（SC-/LP-/PIPE-…）    2
证据列只有「文件:行号」                 94
⇒ 「每条都有断言」对 104 条不成立
```

例：

```
O-01: src/shared/stage-controls.ts:274     ← 只有位置，没有断言 ID
O-02: scripts/check-pipeline.mjs:601       ← 这是断言文件，但不是「守这一条」的断言
O-03: src/shared/risk-policy.ts:740        ← 只有位置
```

### 207.3 ⛔ 但这**不是遗留缺口** —— 文档头早已写明

STATUS.md 文件头：

```
⚠⚠ **本表是人工维护的，没有机检覆盖。**
   代码改动后本表可能失同步，而这个失同步不会被任何判据发现。

⚠ 证据类型有两种，都必须写清是哪一种：
  · 注释证据 · 逻辑推断 / 实测推断 · 「某段文字已不存在」
```

⇒ 这张表承诺的是「**位置可核查**」，⛔ **不是**「每条都有断言」。
   真正的行为守护在 48 个 `check:*` 族里，**与 112 条不是一一对应关系**。

### 207.4 ⇒ 准确的说法

```
❌ 「106 条已修，且每项有断言守护」
✅ 「106 条已修，每项有可核位置；整体行为由 48 个检查族守护」
```

⚠ 两者的区别：

```
位置    证「改在哪」        —— 逐条，可 grep
断言    证「没改坏」        —— 按行为，不是按缺陷 ID
```

⚠ 这与 §155（「grep 命中数 = 缺陷还在」是错的）同源：**位置 ≠ 行为**。

### 207.5 顺带修正：STATUS 文件内自相矛盾

```
文件头汇总表：  104 已修 + 2 部分修 + R-02 + T-07 + S-01 = 112
逐条行实际：    106 已修 + 3 排除 + 2 按设计 + 1 未修     = 112
```

⚠ 两处都合计 112，**所以验算通不出错**。`git log` 确认：
最近一次提交 `d270f81` 的说明写「STATUS 收口 106 已修」，但头表没跟着改。

已修正为 106 + 3 + 2 + 1，并加注说明。

⚠⚠ **这条更值得记**：合计正确 ⛔ 不能证明分类正确。
   我此前每轮都在验「112 是否闭合」，但**闭合是必要条件，不是充分条件**。

---

---

## §208 ⚠ 又一次「grep 错文件 ⇒ 报出不存在的风险」（stages 容量）

### 208.1 我报了什么

宿主重启后 `check:tasks-route-http` 首次真跑通（15/15），其中：

```
H-6：七阶段汇总 61664 B ≤ 65536 B（202 条 · 关系标题 80 个）
```

我据此报了一个「真实风险」：余量只有 3872 B（5.9%），而 `stages` 路由
**不做任何截断/分页**，完全靠探针的 65536 B 硬闸 ⇒ 面板坏掉前 48 族里没有一条会红。

### 208.2 ⛔ 前提是错的

我 grep 的是 `src/modules/stages-route.ts`：

```bash
grep -nE 'max|cap|limit|bytes|truncat|slice|64' src/modules/stages-route.ts
# (无任何上限相关代码)
```

⚠ 但**上限机制不在那个文件里**，在 `src/shared/stages-index.ts:502`：

```js
if (opts.compact === true) {
  const LIMIT = 65536
  if (bytesOf(out) > LIMIT) { /* ① 压 relations 标题表 */ }
  if (bytesOf(out) > LIMIT) { /* ② 删普通条目的纯计数格 */ }
  if (bytesOf(out) > LIMIT) { /* ③ 非验收条目压到一格 */ }
  /* ④ 最后才截断条目 */
}
```

### 208.3 现有机制比我建议的方案更细

我建议「照 `doc-read.ts:431` 加 maxBytes + 尾部标注」。
实际已有的是**四级确定性降级**，且有保护格：

```
⚠ 判决格永不删：验收条目没有判决就等于没给结论
⚠ 验收的「判决 + 依据」是固定两格，⛔ 不在第②档删
⚠ 确定性降级：同一输入同输出；不超预算时线格式与以前逐字节一致
```

⚠ 降级顺序在 2026-11-07 / 11-08 **两轮实测调过**（旧顺序先删「依据」⇒ 66 条验收只剩判决）。
⇒ 这比我从零提的方案成熟得多。

### 208.4 ✅ 它确实在工作

```
探针发 compact: true（probe:714 / :940）
→ buildStages:814 按 body.compact 触发降级
→ 实测 61664 B，落在 65536 以内
```

⇒ 61664 B 是**降级之后**的结果，⛔ 不是「危险地贴着上限」。

### 208.5 教训

```
「在 A 文件里没找到」≠「系统里没有这个机制」。
必须先确认「这个机制应该属于哪个文件」，再去查。
```

⚠ 这是本会话第 N 次同类错误（此前：grep 首个命中当修复位置、按编号 grep 找不到就报未修、
   把「前半段」当位置判据）。**共同点是：把「我没查到」当成「不存在」。**

### 208.6 一个仍然成立的观察

降级是**静默**的：超预算时自动压字段，调用方拿不到任何标记。

```
若哪天降到第 ④ 档（截断条目），面板会悄悄少几条，
而响应里没有 degraded: true 之类的读数。
```

⚠ 这不是缺陷（H-6 保证不超限），但「降了多少」**不可观测**。
   是否加标记取决于对面板可解释性的要求 —— 记录待决策，⛔ 不擅自改。

---

---

## §209 ✅ `active/` 里的 `joining` 计划**不是缺陷**：`closePlan()` 是人工动作

### 209.1 我一开始怀疑什么

重启宿主后查真实账本，发现：

```
/home/lk/.dsh/hob-ledgers/dsh-hob/runtime/work-plans/
  active     1 个   （createdAt 2026-11-07，挂了 4 天）
  completed  7 个
  abandoned  5 个
```

那个 active 计划的读数：

```json
state:       "joining"
trackStates: { "single": "returned" }   ← 唯一轨道已返回
implicit:    true
joinPolicy:  "all"
joinOwnerSessionId: "session-4471675a-…"
```

⇒ 我当时怀疑：「轨道全返回了，计划却停在 joining ⇒ 漏判」。

### 209.2 ⛔ 查实现后否定

`orchestrator.ts:1484`：

```ts
/** 汇合责任人**显式**把 `joining` 计划收成 `completed`；失败计划不接受收口。 */
closePlan(planId: string, self: string | undefined): Promise<...>
```

`orchestrator.ts:4640`：

```ts
if (progress.terminal || plan.state === 'joining') {
  ... plan.state === 'joining' ? '计划已汇合，等待收口'
```

⇒ **`joining → completed` 只由 `closePlan()` 触发，⛔ 不自动。**
   这个计划停在那里是**设计**：等 `joinOwnerSessionId` 那个人收口。

### 209.3 那为什么挂了 4 天

```
joinOwnerSessionId = session-4471675a-…（2026-11-07 的会话）
那个会话早就结束了 ⇒ 没人调 closePlan()
⇒ 这是**孤儿计划**，⛔ 不是**逻辑缺陷**
```

### 209.4 ⚠ 我一度以为这是「没有清理机制」的可用性问题

```
我当时的判断：implicit 计划 + 责任人会话结束 ⇒ 永远停在 active/joining
              ⇒ 没有自动清理 ⇒ active/ 会持续堆积孤儿
```

⛔ **查完实现后发现：机制早就有了。**

### 209.5 ✅ `STALE_PLAN_HOURS` 已实现「标记 stale、⛔ 不自动删」

`orchestrator.ts:4004`：

```ts
const STALE_PLAN_HOURS = 24
/**
 * 计划多久算"没人管了"：24 小时。
 * ⚠ 只用于**读数标记**，⛔ 不触发自动删除 ——
 *   删除活动计划是不可逆动作，必须由人确认（agent 不替用户做这个决定）。
 */
```

`orchestrator.ts:4124`：

```ts
stale: !terminal && ageHours !== null && ageHours >= STALE_PLAN_HOURS,
```

`orchestrator.ts:7047`（人工归档入口，同样要求超时）：

```ts
if (ageHours < STALE_PLAN_HOURS) {
  reason: `计划只存在 ${...}h（< 24h）=> 未超时，不归档`
}
```

### 209.6 ✅ 那个孤儿确实会被标记

```
createdAt:  2026-11-07T04:30:28Z
ageHours:   101.1
stale:      true   （>= 24h）
```

⇒ 它**不是不可见的**：`activePlansAt` 会带 `stale: true` 读数，归档入口也已就位。

### 209.7 ⇒ 结论：现有机制完整，⛔ 无需改动

```
✅ joining 是设计（closePlan 人工触发）
✅ 超 24h 会标记 stale（读数可见）
✅ 归档需人工确认（不可逆动作，agent 不替用户决定）
```

⚠ **本节的净产出是「否证我自己的怀疑」**，⛔ 不是「新增一个待办」。

---

---

## §210 S-01 的定性精确化：不是「宿主缺 API」，是「审批接缝在 pipeline 内部」

### 210.1 此前的说法

```
S-01 未修 —— 宿主 ToolRunContext 只有 deferContext / concludeTurn，
            没有 ctx.approval.request ⇒ 仓内无解
```

⚠ 这个说法**结论对，理由不完整**：宿主其实**有**审批机制。

### 210.2 宿主确实有审批接缝

```ts
// node_modules/@deepseek-ai/dsh-tools/lib/types/pipeline.d.ts:110
/**
 * Resolve an `ask` decision to allow/deny through the approval seam. The
 * seam is consumed opportunistically with `ctx.get('approval')` — a
 * deployment that composes no ApprovalService keeps the historical degrade
 * to deny, and an unmount mid-session degrades the same way on the next ask.
 *
 * `allowed-once` proceeds; the three non-grants deny with distinct reasons
 * so the model can tell a human "no" from an absent approval channel.
 */
private serviceAsk;
```

⇒ 语义完整：allowed-once 放行；其余三种拒绝且**理由各不相同**（让模型能区分
   「人说不」与「审批通道不存在」）；无 agent / 未装配 ⇒ 降级拒绝。

### 210.3 ⛔ 但工具侧够不到

```
· serviceAsk 是 ToolExecutionPipeline 的 private 方法
· 工具实现体拿到的是 ToolRunContext，成员只有：
    deferContext(context: UserMessage): void
    concludeTurn(): void
  ⇒ 没有 requestApproval
```

### 210.4 ⛔ 工具声明层也没有

逐字段读过 `ToolDefinition`（`contracts.d.ts:23`），全部字段：

```
output: ToolOutputDefinition            必填
execute(args, exec): Promise<unknown>   必填
projectContent?(...)                    内容投影
finalizeContent?(...)                   末尾内容变换
timeoutMs?                              超时预算
isConcurrencySafe?(args)                并发分类
```

⇒ **没有** `requiresApproval` / `ask` / `approval` 之类的声明字段。

### 210.5 ⇒ 两条路径都不通

```
路径 A  工具内主动请求审批
        需 ctx.approval.request  ⇒ ToolRunContext 没有        ❌

路径 B  声明「本工具需要审批」，让策略自动走审批
        需 ToolDefinition 的 approval 字段  ⇒ 没有            ❌
```

### 210.6 ⇒ 宿主需要做什么（明确到可执行）

```
二选一：
① 在 ToolRunContext 暴露
     requestApproval(reason: string): Promise<'allowed-once' | 'denied' | ...>
② 在 ToolDefinition 加
     approval?: 'never' | 'ask'
   声明字段，让 pipeline 的 serviceAsk 能按声明触发
```

### 210.7 ⇒ 结论

```
✅ S-01 仓内无解 —— 结论不变
✅ 但理由是「审批接缝在 pipeline 内部，工具实现体与声明层都够不到」
   ⛔ 不是「宿主没有审批机制」
```

⚠ 这个区别重要：前者说明**宿主已有一半**（机制在、入口没开），
   后者会让人以为要从零设计审批系统。

---
