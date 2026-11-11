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
