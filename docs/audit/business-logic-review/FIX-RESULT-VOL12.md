## §153 ✅ 四批提交完成 + 提交后全量验证通过

### 153.1 提交结果

```
分支： fix/business-logic-review-2026-11-11（从 codex/item-presentation 新建）
提交： 4 个
  5cc08d4  chore(gitignore): 补两条临时目录模式
  0616d4c  docs: 骨架契约、模板、预设文档与审查记录        （72 文件）
  90b5dbc  feat: 业务逻辑审查修复 + 自检体系增强            （110 文件）
  50b5386  feat(shared): 新增 8 个纯逻辑模块                （3323 行）

变更： 191 files changed, +50330 / -2197
工作区：git status --short = 0（干净）
```

### 153.2 ✅ 提交后全量验证

```
npm run build        →  BUILD=0
npm run typecheck    →  TYPECHECK=0（双 tsconfig）
npm run check:all    →  CHECKALL=0 · 47/47 · 123 秒
```

⚠ **提交没有引入任何回归** —— 三个入口全绿。

### 153.3 ✅ 完整性核对

| 检查 | 结果 |
|---|---|
| 工作区干净 | ✅ 0 条 |
| 新分支领先 4 个提交 | ✅ |
| `docs/audit` 入库 | ✅ 41 个文件 |
| 8 个新模块入库 | ✅ 8/8 |

### 153.4 ⚠ 提交时发现的一个隐患（已避开）

```
第①批我执行 git add 时发现：暂存区里**原本就有 17 个文件处于已暂存状态**
  （live-protocol.ts / live-hub.ts 等，HEAD 里不存在）
  ⇒ 之前的会话 git add 过但从未 commit

⚠ 若直接 commit，第①批会变成 9 个模块 + 8 个 live 文件，
   而按 §130 的验证，只有那 8 个模块能独立编译 ⇒ **依赖顺序会乱**。

✅ 处置：git reset 清空暂存区 → 重新精确 add 那 8 个 → 才提交。
```

⚠ 这是「**未提交工作**」的**第三个来源**，前两个是 §139 记的：

```
① git status（工作区）        ← 一直在看
② git stash list（存档栈）    ← 第 72 轮补查
③ git 暂存区（index）         ← 本轮才发现
```

### 153.5 本轮未做的

```
⛔ 未 push —— 用户只批了「新建分支再提交」，没提 push
⛔ 未合并回 master —— 同上
⛔ 未删 .agent-teams/ 下的团队状态（那是另一件事）
```

---

---

## §154 ✅ O-19 **真正修好**（不是改记账）—— 6 vs 18 双向验证

### 154.1 修法

`src/client/hob-unselected-gate.tsx` 轮询 effect 里加一行：

```ts
// ⚠⚠ O-19：轮询只由「专职那一份」跑
// 三个槽（hero.options / header.actions / input.right）各有一份 effect
// ⇒ 只有 showBanner === false 的那份（会话常驻）负责轮询
if (props.showBanner !== false) return undefined
```

⚠ 依赖数组同步补上 `props.showBanner`。

### 154.2 ⚠ 连带必须改的 6 处测试

那些测试挂的是**会渲染横幅的实例**，按新设计它们不该轮询 ⇒ 补 `showBanner: false`。

⚠ 这**不是**为了迁就实现而放宽判据 —— 它们的语义本来就是「测轮询行为」，
   而轮询按设计就该由专职实例做。⇒ 补参数是**修正夹具**，不是削弱断言。

### 154.3 ⚠⚠ 最关键的一步：证明原判据**测不到**这个缺陷

```bash
# 去掉修复（把那一行删掉），跑 check:hob-gate
→  处级口径：查了 59 处 · 过了 59 处 · 跳过 0 处     ← ⚠ 全绿！
```

⇒ **O-19 的 59 条断言里，没有一条在数轮询次数。**
   这就是它 80 轮没被发现的原因 —— 不是「忘了修」，是「**修没修都测不出来**」。

### 154.4 ✅ 因此补了一条新断言（G-24 B3）

```js
// 同一份 memory 下挂三个实例（两个横幅 + 一个专职轮询），数 readBlocked 调用次数
// 单实例 ≈ 5~8 次；三实例各跑 ≈ 15~24 次。阈值取 12。
```

### 154.5 ✅✅ 双向验证

| 状态 | `readBlocked` 调用 | 结果 |
|---|---|---|
| **修复后** | **6 次** | ✓ `G-24 B3 ✓ 轮询只由专职实例跑 —— 三实例挂载 100ms 内 readBlocked 仅 6 次` |
| **去掉修复** | **18 次** | ✗ `G-24 B3 · O-19 复发：… 被调 18 次 ⇒ 三个槽各自轮询（实际频率是注释的 3 倍）` |

⚠ **6 : 18 = 1 : 3**，与 O-19 原文「实际频率是注释的 **3 倍**」**精确吻合**。

### 154.6 配套改动

| 文件 | 改动 |
|---|---|
| `src/client/hob-unselected-gate.tsx` | 加 `showBanner` 判断 + 依赖数组 |
| `scripts/check-hob-unselected-gate.mjs` | 6 处夹具补 `showBanner:false`；新增 G-24 B3 |
| `scripts/check-all.mjs` | `check:hob-gate` 下界 **59 → 60** |

### 154.7 ✅ 验证

```
check:hob-gate   60/60（原 59，+1）
typecheck        EXIT=0
```

### 154.8 ⚠ 这轮与前几轮的区别

```
第 84 轮：发现 O-19 记为已修、实为未修  → 只是【记录】
第 88 轮：真正修好 + 证明原判据测不到 + 补上能测的断言  → 【修复】
```

⚠ 第 2 步最重要：**只修代码不补断言，下次有人改回去仍然没人知道**。

---

---

## §154 ✅ R-03 真正修好：步名派生 + 判据跟上

### 154.1 修了什么

```ts
// 改前（project-panel.tsx:164）—— 独立字面量
export const STAGES_STEP_NAMES = ['需求规格','实现方案','任务图','任务执行','技术验证','产品验收','交付收口'] as const

// 改后 —— 派生自唯一权威
import { STAGE_NAMES } from '../shared/stage-controls.ts'
export const STAGES_STEP_NAMES = [
  STAGE_NAMES.requirements, STAGE_NAMES.plan, STAGE_NAMES.tasks,
  STAGE_NAMES.execution, STAGE_NAMES.verification, STAGE_NAMES.acceptance,
  STAGE_NAMES.closure,
] as const
```

⇒ 落实 `stage-controls.ts:44` 自己的规则：
   「这张表是**唯一权威**：其余位置必须 import 或派生，⛔ 不许再写字面量。」

### 154.2 ⚠⚠ 我预估的 100 KB 代价**完全错了**

§151 我写：客户端引用 `stage-controls.ts`（73 KB）+ `pipeline.ts`（26 KB）
        ⇒ 「会让客户端体积涨约 15%，为 7 个字符串不划算」。

实测：

| 指标 | 结果 |
|---|---|
| `client.js` | 448307 → **448355 字节（+48）** |
| 包内 `isPipelineV3` / `approvalStateOf` | **0 次命中** |
| 包内 `需求规格` | 2 次（原本数组已删，只剩 STAGE_NAMES 一处） |

⇒ **tree-shaking 把服务端逻辑全裁掉了**，只留下那 7 个字符串。

⚠ 这个错误很典型：我按**源码体积**估算，而打包器按**实际引用**裁剪。
   两者可以差三个数量级。

### 154.3 ⚠ 改完后 2 条断言变红 —— 判据挡住了正解

| 断言 | 症状 | 根因 |
|---|---|---|
| **S-1** | 「抽不到 `STAGES_STEP_NAMES`（7 项）⇒ 判据失去基准」 | 正则只认字面量形态 |
| **S-7** | 「造不出改步骤名的变体 ⇒ 负向对拍不可判」 | 同上 |

⚠ 这正是 §151 预判的「断言只认字面量，不认派生」。
   ⇒ **判据不该阻止正解**，该跟上。

### 154.4 ✅ 两条断言都改成双形态支持

**S-1**：

```js
// 字面量分支（原逻辑不变）
const stepNamesMatch = /STAGES_STEP_NAMES\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(src)

// 派生分支（新增）：从 stage-controls.ts 读 STAGE_NAMES 真值，按顺序取
// ⚠ 这比原来更严格 —— 它顺带能咬 STAGE_NAMES 自己漂移
```

**S-7**：

```js
const mutantA = buildMutant('steps', (s) => {
  const byLit = s.replace(`'${prodSteps[0]}'`, `'被改坏的步骤'`)
  if (byLit !== s) return byLit;                          // 字面量形态
  return s.replace(/STAGE_NAMES\.\w+/, 'STAGE_NAMES.__mutatedStep__');  // 派生形态
})
```

### 154.5 ✅ 验证

```
check:stages-dom  →  EXIT=0 · 148/148
  ✓ S-1 ✓ 抽出 7 个步骤名（需求规格/实现方案/任务图/任务执行/技术验证/产品验收/交付收口）
  ✓ S-7a ✓ 负向对拍（改步骤名）⇒ S-6 判据变红：第 1 行里没有「需求规格」，实际「1」
  ✓ S-7b ✓ 负向对拍（guide order 50⇒51）⇒ S-11 必红

typecheck  →  EXIT=0
check:all  →  EXIT=0 · 47/47 · 121 秒
```

⚠ **S-7a 在派生形态下仍然咬得住** —— 变体真的被造出来并让 S-6 变红了。

### 154.6 剩余字面量核查（2 处，都有正当理由）

```bash
grep -rn "'需求规格'" src/ --include='*.ts' --include='*.tsx' | grep -v stage-controls.ts
→  tasks-progress.ts:67      TASKS_STEP_NAMES（LEGACY 五步）
→  requirement-chain.ts:115  LEGACY_STEP_DEFS（LEGACY 五步）
```

⚠ 两者都是 **LEGACY 五步**（需求规格/实现方案/**编码任务**/任务执行/**验收核对**），
   与 v3 七步**本就不同**，且注释写明「图例用，定死的常量」。
   ⇒ ⛔ 不该派生，⛔ 也不是漏网。

⚠ 顺带确认：`requirement-chain.ts:128` 的 **v3 七步**早已派生
   （`{ step: 1, name: STAGE_NAMES.requirements, … }`）—— 那是更早修好的。

### 154.7 提交

```
49bb738  fix(stages): R-03 步名从 STAGE_NAMES 派生，建立单一真源
e91fb4c  fix(gate): O-19 轮询只由专职实例跑，并补上能测的断言
工作区干净（0 条）
```

### 154.8 两条记账偏差均已闭环

| 编号 | 级别 | 原记账 | 本轮结果 |
|---|---|---|---|
| **O-19** | medium | 记为已修（实为未修） | ✅ §87 真正修好 + 补断言（6 vs 18） |
| **R-03** | **blocker** | 记为已修（实为部分修） | ✅ **本节真正修好** + 判据跟上 |

⚠ 但「112 条全部已修」这个结论**仍缺逐条复核** ——
   我只验了 2 条，就发现 2 条偏差。剩下 110 条里可能还有。

---
