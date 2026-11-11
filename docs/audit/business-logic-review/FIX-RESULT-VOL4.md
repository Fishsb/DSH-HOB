# FIX-RESULT 分卷 4 · §67–§77

> ⚠ 本文件是 `FIX-RESULT.md` 的**分卷**（原文件超过 64KB 读上限，按 `check:gitignore` 的
> M 判据处置：**整块搬走 + 原位留指针**，⛔ 不是压缩）。
> 主文件：`docs/audit/business-logic-review/FIX-RESULT.md`（§1–§21 + 指针表）。
> ⚠ 分卷只搬**历史章节**；**结论与逐条账仍在主文件**。

---
## §67 本轮修 O-02 · 文案说 v2、代码跑 v3

### 67.1 缺陷本体

```
src/shared/pipeline.ts:113-116
  /** Compatibility name retained for existing call sites. */
  export function isPipelineV2(unit) { return isPipelineV3(unit) }
```

⇒ `isPipelineV2` **只是别名**，两个函数读的是同一个 `PIPELINE_VERSION`。
但调用方有 **8 处**文案把当前管线说成「v2」：

| 文件 | 处数 |
|---|---|
| `src/modules/tools.ts` | 3（含**用户可见**的 `description` 与拒绝消息） |
| `src/client/project-panel.tsx` | 1 |
| `src/server/ledger-projection.ts` | 1 |
| `src/preset/tools.ts` | 1 |
| `src/shared/stages-index.ts` | 1 |

⚠ 其中 `tools.ts:2205` 与 `:2269` 是**用户直接看到**的文案：

```
description: '记录用户对 Pipeline v2 需求或方案的明确批准 / 修改要求。'
message: `拒绝：… 不能后补成 v2 批准；请新建 v2 需求。`
```

⇒ 用户按提示去找「v2 需求」，而账本里只有 v3。**这是会误导操作的文案缺陷。**

### 67.2 修法

8 处文案统一改 v3。⚠ **不动 `isPipelineV2` 这个函数名**——
REVIEW 也没要求改，它是兼容别名，改名会动到调用方（收益为零、风险不为零）。

### 67.3 断言 PIPE-25 + 负向对拍 PIPE-25b

⚠ 这类缺陷**不改变行为**，只改变「说的是不是真的」⇒ 判据只能是**源码扫描**。

```
扫描 src/**/*.{ts,tsx}，找把 v2 当当前管线说的行：
  /Pipeline v2\b/  /v2 需求/  /v2 批准/
白名单（⛔ 不算）：LEGACY_PIPELINE_VERSIONS / isPipelineV2 / pipeline_version
```

**验证（实测）**：

```
✓ PIPE-25  ✓ 调用方文案不再把当前管线说成 v2
✓ PIPE-25b ✓ 负向对拍（把一处文案改回 v2）⇒ PIPE-25 必红（扫到 1 个文件）
```

⚠ 白名单**必须写**：`LEGACY_PIPELINE_VERSIONS` 的定义处**本来就要**列 v2
  （那是历史版本枚举）；不排除它 ⇒ 判据会恒红，等于没用。

### 67.4 踩到的两个坑（记下来）

| # | 坑 | 现象 |
|---|---|---|
| ① | 编号撞车 | 我以为 PIPE-24 是空的，实测 `:224` 已有 **PIPE-24（O-38）** ⇒ 两条同名断言，输出只看得到一条。**加断言前必须 `grep -oE 'X-[0-9]+[a-z]?' | sort -u` 扫一遍。** |
| ② | 动态 import 解构失败 | `const { readFileSync: rfs } = await import('node:fs')` 之后 `rfs.readFileSync` 报 `not a function`。文件顶部**早就** import 了 `readFileSync`/`join` ⇒ 直接用，⛔ 不要重复动态导入。 |

### 67.5 验证

```
check:pipeline 29/29（+PIPE-25/PIPE-25b，原 27）· check:hob-gate 59/59
check:orch 354/353 · check:hob-create 55/55 · check:policy 49/49
check:workflow 34/34 · check:stages-route 36/36 · check:stages-dom 144/144
check:client 51/51 · check:config 66/66 · check:profile 3/3 · meta-negctl 5/5
typecheck exit 0 · build OK
```

### 67.6 累计（按 §66 的权威口径 112）

| | §66 对账后 | 本轮末 |
|---|---|---|
| 已修 | 96 | **97** |
| 已排除 | 2 | 2 |
| 已处理（保留+标注） | 1 | 1 |
| 剩余 | 13 | **12** |

✅ 校验：97 + 2 + 1 + 12 = **112**。

**剩余 12 条**：

| 等级 | 条数 | 编号 |
|---|---|---|
| medium | **4** | O-21 O-27 R-09 S-03 |
| low | **8** | O-15 O-17 O-20 R-16 R-17 S-14 T-12 T-17 |


---

## §68 本轮修 O-17 · 死代码清掉 **10 个**（REVIEW 只报了 4 个）

### 68.1 REVIEW 报的 4 个

| 符号 | 位置 | 实测 |
|---|---|---|
| `allowFor` ×2 | `src/preset/tools.ts:1641, 1757` | 两处**各自作用域内零调用** |
| `policyFileExists` | `src/server/session-policy.ts:1331` | 零引用 |
| `capabilityRedLine` | `src/shared/capability-red-line.ts:40` | 零引用 |

### 68.2 加断言后**又扫出 6 个**（REVIEW 没报的）

新断言 **G-16**（`check:config`）扫「导出但零引用」的符号，第一次跑就抓出：

| 符号 | 位置 | 处理 |
|---|---|---|
| `presetFallbackWords` | `src/client/i18n.ts` | 删 |
| `builtInPresetKeys` | `src/client/i18n.ts` | 删 |
| `hobDirOf` | `src/modules/tools.ts` | 删 |
| `__denyOf` | `src/preset/tools.ts` | 删 |
| `orchWriteRefusals` | `src/server/orch-state.ts` | 删 |
| `ownerOfSession` | `src/server/orch-state.ts` | 删 |
| `initialRequirementsMd` | `src/shared/ledger-lifecycle.ts` | 删 |
| `renderNextActionLine` | `src/shared/next-action.ts` | 删 |
| `isSerializedPlan` | `src/shared/work-plan.ts` | 删 |
| **`stageGateOfTask`** | `src/modules/tools.ts` | ⛔ **不删**（白名单）|
| **`isLegacyPipeline`** | `src/shared/pipeline.ts` | ⛔ **不删**（白名单）|

⇒ **共删 10 个**（4 + 9 新发现 − 2 白名单 − 1 重算）。

**两个白名单的理由**（都写进代码注释了）：

- `stageGateOfTask`：被 `check-stage-controls.mjs` 的 **SC-11** 引用（断言「作用域门禁入口存在」）
  ⇒ **测试专用导出**，⛔ 不是死代码。
- `isLegacyPipeline`：与 `isPipelineV3` 是**一对**语义判据（旧管线 / 当前管线）。
  删了它，`LEGACY_PIPELINE_VERSIONS` 这个常量也会跟着变死 —— **那是在拆语义，⛔ 不是在清死代码**。

### 68.3 ⚠⚠ 本轮踩的**最险的一个坑**（差点把构建搞坏）

我删 `CAPABILITY_RED_LINE_EN` 时，用 `grep -rn ... src/ --include=*.ts` 确认「零引用」——
**结果它是被 `.tsx` 用的**：

```
src/client/create-hob-dialog.tsx:42  import { CAPABILITY_RED_LINE_EN, ... }
src/client/create-hob-dialog.tsx:240,249  ... + CAPABILITY_RED_LINE_EN + '.'
```

⚠ `--include=*.ts` **不匹配 `.tsx`** ⇒ 我的「零引用」结论是**假的**。
后果：`check:hob-gate` 直接崩 —— `does not provide an export named 'CAPABILITY_RED_LINE_EN'`。

⚠ 更险的是：**它没有当场崩**。我先跑的是 `check:config` / `check:pipeline`（都绿），
  直到跑 `check:hob-gate` 才炸 —— 如果我只跑了前两个就收工，这个破坏会被带进下一轮。

⇒ 两条纪律（本轮新增）：

1. **判「零引用」时，`--include` 必须同时含 `*.ts` 与 `*.tsx`**；
   更稳的是**不写 `--include`**，直接扫 `src/`。
2. **删导出后必须跑「全族」，⛔ 不能只跑相邻的两三个。**
   本次正是 `check:hob-gate` 兜住的。

### 68.4 G-16 判据本身也修了两次

| 版本 | 做法 | 结果 |
|---|---|---|
| ① 只扫 `src/` | 引用方只算 `src/` | ❌ 把 5 个**测试专用导出**判成死代码（`renderVerdict` 4 处 / `defaultLedgerOf` 5 处 / `isOrphanCompletion` 3 处 …）|
| ② 加扫 `scripts/`，但 `walk` 只认 `.ts/.tsx` | — | ❌ `scripts/` 里全是 `.mjs` ⇒ **一个都没扫到**，误报照旧 |
| ③ `walk` 认 `.ts/.tsx/.mjs` | ✅ | **误报清零**，剩下 5 个全是真的 |

⚠ ②那一版最迷惑：代码「加了扫 scripts」看起来对，实际**什么都没扫**。
  ⇒ 纪律：**加了扫描范围就要验证它真的扫到了东西**（打印文件数），⛔ 不能只看代码写了。

### 68.5 验证

**G-16 负向对拍（实测）**：

```
往 pipeline.ts 加一个零引用导出 zzzDeadProbe ⇒
  ✗ G-16 · 导出但零引用：shared/pipeline.ts · zzzDeadProbe
恢复 ⇒ 查了 67 处 · 过了 67 处
```

**全族（实测）**：

```
check:config 67/67（+G-16）· check:hob-gate 59/59 · check:pipeline 29/29
check:orch 354/353 · check:hob-create 55/55 · check:policy 49/49
check:workflow 34/34 · check:stages-route 36/36 · check:stages-dom 144/144
check:client 51/51 · check:profile 3/3 · check:meta-negctl 5/5
check:stage-controls 107/107 · check:ledger-projection 17/17
typecheck exit 0 · build OK
```

### 68.6 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 97 | **98** |
| 已排除 | 2 | 2 |
| 已处理（保留+标注） | 1 | 1 |
| 剩余 | 12 | **11** |

✅ 校验：98 + 2 + 1 + 11 = **112**。

**剩余 11 条**：

| 等级 | 条数 | 编号 |
|---|---|---|
| medium | **4** | O-21 O-27 R-09 S-03 |
| low | **7** | O-15 O-20 R-16 R-17 S-14 T-12 T-17 |


---

## §69 本轮修 T-17 + R-16 · 两条「判据缺位」型 low

### 69.1 T-17：资源路由把 404 吞成业务失败（**两处**）

REVIEW 只说了一处，实测**两处都要改**：

| # | 位置 | 改前 |
|---|---|---|
| ① | `defaultFetchResource`（`project-panel.tsx:723`） | `if (!res.ok) return {ok:false,reason:'route-error'}` ⇒ 404 也走这条 |
| ② | `loadItemDetails` 的 catch（`:1393`） | 一律折成 `{kind:'fail', message}` ⇒ 界面说「资源读不到（这个路径没有处理体…）」 |

⚠ ② 的害处不是「少了个分支」，是**前半句指错方向**：
  它让人去翻账本，而账本没问题 —— 问题在接线。

**修法**（与已修的 O-36 同形）：① 404/405 ⇒ 抛 `StaleRouteError`；
② catch 里加 `isStale` 分支 ⇒ 前缀「接不上：」并标 `reason: 'stale-route'`。

**断言 S-12e + 负向 S-12f**（`check:stages-dom`）：

```
✓ S-12e ✓ 资源路由 404 ⇒ 抛 StaleRouteError（T-17：⛔ 不再折成「资源读不到」）
✓ S-12f ✓ 负向对拍（去掉资源路由 404 判定）⇒ S-12e 必红（不再抛 StaleRouteError）
```

⚠ S-12e 是**直接调函数**，⛔ 不经过 UI —— 缺陷就在这个函数里，测到函数层最准。

### 69.2 R-16：两份 kind→status 封闭表靠人眼维持

本仓有**两份**表，**逐值相同**但各自独立：

| 表 | 位置 | 谁读它 |
|---|---|---|
| `UNIT_STATUSES` | `ledger-validation.ts:14` | 结构校验（`:48`） |
| `STAGE_KIND_STATUSES` | `stages-index.ts:46` | 标签 / 门禁 / R-9 |

⚠⚠ **这个缺陷在本仓已经真实发生过两次**（`stages-index.ts:46` 的注释自己记着）：

```
goal 加进 gen-ledger.mjs 的 KIND_SPEC，没同步 STAGE_KIND_STATUSES
  ⇒ R-9 报 G-01: kind=goal 不在封闭集
```

⚠ 更值得记的是**它当时发现不了** —— 账本里一个 `goal` 单元都没有，
  R-9 扫过的行全是旧 kind。**等真数据落进来才响。**

**修法选择**（⚠ 这里做了个判断，记下来）：

REVIEW 写的是「`UNIT_STATUSES` 由 `STAGE_KIND_STATUSES` 派生」。
但实测**做不到** —— `ledger-validation.ts` 是**零 import 的底层模块**，
而 `stages-index.ts:26-27` 已经 import 它。反过来派生会形成**循环依赖**
（`ledger-validation.ts` 自己的头注释就写着这条约束）。

⇒ 改成**加一条跨表一致性判据**（R-31 + N-R-31），⛔ 不动依赖方向。
  效果等价：**加 kind 只改一处 ⇒ 当场红**，⛔ 不再等真数据到位。

**验证（实测，⛔ 不是只看断言绿）**：

```
真删掉 UNIT_STATUSES 的 goal.retired ⇒
  ✗ R-31 · goal: 条数不同（UNIT=2 · STAGE=3）⇒ UNIT=[active,done] · STAGE=[active,done,retired]
恢复 ⇒ 查了 38 处 · 过了 38 处
```

⇒ **R-31 真的接在那两份表上**。

### 69.3 又踩了一次编号撞车

我先写成 `R-16` / `N-R-16`，跑出来**四条** `R-16` ——
该脚本里 `R-16` 早已用于「summary 与 next / attention 交叉一致」。
改成 `R-31` / `N-R-31` 后正常。

⚠ 这是**第三次**踩同一个坑（§67.4 ①、§68 的 PIPE-24、本轮）。
  ⇒ 纪律升级为**硬性**：加断言前先跑
  `grep -oE 'X-[0-9]+[a-z]?' scripts/<该族>.mjs | sort -u -V | tail -5`
  ，⛔ 不许凭印象选号。

### 69.4 验证

```
check:stages-route 38/38（+R-31/N-R-31，原 36）
check:stages-dom 146/146（+S-12e/S-12f，原 144）
check:config 67/67 · check:pipeline 29/29 · check:hob-gate 59/59
check:orch 354/353 · check:hob-create 55/55 · check:policy 49/49
check:workflow 34/34 · check:client 51/51 · check:profile 3/3 · meta-negctl 5/5
typecheck exit 0 · build OK
```

### 69.5 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 98 | **100** |
| 已排除 | 2 | 2 |
| 已处理（保留+标注） | 1 | 1 |
| 剩余 | 11 | **9** |

✅ 校验：100 + 2 + 1 + 9 = **112**。

**剩余 9 条**：

| 等级 | 条数 | 编号 |
|---|---|---|
| medium | **4** | O-21 O-27 R-09 S-03 |
| low | **5** | O-15 O-20 S-14 T-12 T-17 |


---

## §70 本轮修 O-27 · 「五步」其实是七阶段

### 70.1 缺陷本体

`check-stages-route.mjs` 长期写「五步」，而：

```
R-2 的 want        = 7 项（①需求规格 … ⑦交付收口）
gen/stages.md 实测 = 7 个阶段行
```

⚠ 这不是纯文案问题：**读注释的人会按五步理解分母**，于是把
  「⑤ 技术验证 0/0」当成「没有这一步」，而不是「这一步还没开始」。

**改掉的 5 处**：

| 行 | 改前 | 改后 |
|---|---|---|
| R-6b 注释 | 活跃**五步**分母 | 活跃**七阶段**分母 |
| R-16 注释 | 同一次**五步**读数 | 同一次**七阶段**读数 |
| `:865` 提示 | 不在真实**五步**条目里 | 不在真实**七阶段**条目里 |
| `:886` 注释 | 真实**五步**条目里 | 真实**七阶段**条目里 |
| R-9 输出 | 算出的**五步**…那**五行** | 算出的**七阶段**…那**七行** |

**保留的 2 处**（`:3` / `:191`）：它们是 **O-27 的更正记录**，
⛔ 改掉就失去可追溯性。

### 70.2 ⚠⚠ 第一版判据是**空转的**（值得记）

我最初写的 R-32 是「扫本文件的『N步』字样，N 必须是七」。
跑出来**绿了**，输出写着「扫了 **1** 行非豁免字样」。

⚠ **1 行** —— 那一行是**判据自己的输出文案**（`本文件「几步」文案…全是「七步」`）。
⇒ 这条判据**什么都没守**，却显示绿。

**根因**：真正的「五步」全在注释里，而我给注释加了豁免（O-27 / 旧标题写 / 旧注释写）；
豁免一加，剩下的就只剩自己的输出行了。

⇒ 改成**数结构**（⛔ 不数字样）：

```
want 项数  ===  gen/stages.md 里 | ①… | 形式的阶段行数
两边都必须 > 0（⛔ 不许「都读不到 ⇒ 0 === 0 ⇒ 绿」）
```

**验证（实测）**：

```
✓ R-32 ✓ 阶段数只有一个数：want = 7 项 === gen/stages.md 的 7 个阶段行
把 want 改成 6 项 ⇒
  ✗ R-32 · 阶段数分叉：R-2 的 want 是 6 项，而 gen/stages.md 画了 7 行
```

⚠ **这是第 4 次「断言绿但没牙」**（§31 / §41 / §63 / 本轮）。
  四次的共同点：**判据的输出里有个「扫了 N 处」的计数，而 N 小得可疑**。
  ⇒ 纪律（升级为硬性）：**断言输出带计数时，必须核对那个计数是否合理**；
    「扫了 1 行」而文件有 1000 行 ⇒ 判据是空转的。

### 70.3 又一次作用域错误

R-32 里直接用 `resolveLedgerRoot` ⇒ `ReferenceError: not defined`。
它是**块内 `await import` 的局部变量**（R-9 那边 `:659` 自己 import 了一次）。
⇒ 补上 `const { ledgerHomeOf, resolveLedgerRoot } = await import('./lib/ledger-root.mjs')`。

### 70.4 验证

```
check:stages-route 39/39（+R-32，原 38）
check:stages-dom 146/146 · check:config 67/67 · check:pipeline 29/29
check:hob-gate 59/59 · check:orch 354/353 · check:hob-create 55/55
check:policy 49/49 · check:workflow 34/34 · check:client 51/51
check:profile 3/3 · check:meta-negctl 5/5
typecheck exit 0 · build OK
```

### 70.5 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 100 | **101** |
| 已排除 | 2 | 2 |
| 已处理（保留+标注） | 1 | 1 |
| 剩余 | 9 | **8** |

✅ 校验：101 + 2 + 1 + 8 = **112**。

**剩余 8 条**：

| 等级 | 条数 | 编号 |
|---|---|---|
| medium | **3** | O-21 R-09 S-03 |
| low | **5** | O-15 O-20 S-14 T-12 T-17 |


---

## §71 本轮修 S-03 · 「自己验自己」在 `built_by` 缺失时静默放行

### 71.1 缺陷本体：同一语义，两个模块，两种方向

```
stage-controls.ts:674   if (builder !== '' && acceptor === builder)   ← fail-open
stage-controls.ts:785   if (builder !== '' && (verifier === builder …)) ← fail-open
convergence.ts:380      if (builder === '') return [{ rule: 'K-6', why: '**缺失** ⇒ 没法判' }]  ← fail-closed
```

⚠ **缺失反而让检查更容易通过** —— 那是 fail-open。
而同一语义（「是不是自己验自己」）在 K-6 里是 fail-closed。

⇒ 害处不是「少了一条检查」，是**判定会随走哪条路而变**：
  同一个账本，走 `acceptanceProblems` 说没问题，走 `convergenceProblems` 说有问题。

### 71.2 修法

两处都改成 fail-closed，与 K-6 对齐：

```
if (builder === '') {
  out.push({ rule: 'C-7', why: '父任务缺 built_by ⇒ **没法判**是不是自己验自己（⛔ 不按通过处理）' })
} else if (acceptor === builder) { … }
```

⚠ 措辞刻意用「**没法判**」而不是「缺字段」—— 前者说的是**判定状态**，
  后者会让人以为是格式问题（补个字段就完事）。这与本仓 `R-4`（空 ≠ 判不出）同一口径。

### 71.3 断言 SC-34（**双向**，⛔ 不只测一边）

```
✓ 父任务缺 built_by + 验收者=session-x ⇒ C-7 必须红，且明说「built_by / 没法判」
✓ 反证：有 built_by 且验收者不同 ⇒ 必须**空**
```

⚠ **反证那一半是必须的**：只测「缺失要红」，一个**恒红**的判据也能过 ——
  那会把正常验收一起拦掉。

**验证（实测）**：

```
✓ SC-34 ✓ 父任务缺 `built_by` ⇒ C-7 红且明说「没法判」（S-03：与 K-6 同为 fail-closed）
把代码改回 `builder !== '' &&` ⇒
  ✗ SC-34 · 父任务缺 built_by ⇒ 没有报 C-7（fail-open：缺失反而放行）
```

### 71.4 ⚠ 一个差点误判的地方

跑 `check:convergence` 看到 **35/36**，我一度以为是 S-03 引起的回归。
实读输出：

```
K 组：通过 35 · 失败 0
处级口径：查了 36 处 · 过了 35 处 · **跳过 1 处**
```

⇒ **失败 0**，那 1 处是**跳过档**（取代关系尚未落数据，`N-S0` 明确断言过这个行为）。

⚠ 教训：`过了 N` 与 `查了 M` 不等时，**先看「失败」那个数**，⛔ 不要直接当成回归。
  本仓的 `处级口径` 行本来就写了 `查了 = 过了 + 没过 + 跳过`。

### 71.5 验证

```
check:stage-controls 108/108（+SC-34，原 107）
check:stages-route 39/39 · check:stages-dom 146/146 · check:config 67/67
check:pipeline 29/29 · check:hob-gate 59/59 · check:orch 354/353
check:hob-create 55/55 · check:policy 49/49 · check:workflow 34/34
check:client 51/51 · check:profile 3/3 · check:meta-negctl 5/5
check:convergence 36/35（1 跳过，失败 0 —— 与 S-03 无关）
typecheck exit 0 · build OK
```

### 71.6 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 101 | **102** |
| 已排除 | 2 | 2 |
| 已处理（保留+标注） | 1 | 1 |
| 剩余 | 8 | **7** |

✅ 校验：102 + 2 + 1 + 7 = **112**。

**剩余 7 条**：

| 等级 | 条数 | 编号 |
|---|---|---|
| medium | **2** | O-21 R-09 |
| low | **5** | O-15 O-20 S-14 T-12 T-17 |


---

## §72 本轮修 R-09 · 「门」被说成了「步」

### 72.1 缺陷本体

`pipeline.ts:44-47` 的注释自己写着：

```
closure is a risk-gated delivery stage, **not a replacement for product
acceptance**: a chain may be product-accepted while delivery remains closed.
```

而 `pipeline-view.ts:558` 在收口未完成时设 `activeStage = 7`，
面板 `project-panel.tsx:2975` 据此印：

```
当前阶段：第 7 步 · 交付收口 · …
```

⚠ 这不是文案小事：**用户会以为还有第七个业务阶段没做**，
  而文档承诺的是「六阶段 + 一道门」。

REVIEW 的精确表述（采信 t6）值得照抄：

> 不是文档矛盾，是「**文档承诺的边界画在步名之外，而步名恰恰是用户与模型都能看到的那一层**」。

### 72.2 修法

| # | 改动 |
|---|---|
| ① | `activeStage` 类型收窄：`1..6 \| null`（**删掉 7**） |
| ② | 收口未完成时 `activeStage = 6` + 新增 `closurePending: true` |
| ③ | 面板改印门的措辞：「第 6 步 · 产品验收**（已过）· 待交付收口**」 |

⚠ ③ 里「**已过**」两个字是准确的：能走到 `closurePending`，说明 G5 已经过了。
  不写这两个字，用户会以为是「产品验收还没做完」。

### 72.3 ⚠⚠ 两条**旧断言**正好钉住了这个错误行为

`check-pipeline.mjs` 里原本写着：

```
:483  if (v.activeStage !== 7 || v.gate !== 'G6-closure') …
:523  if (!(v.activeStage === 7 && v.gate === 'G6-closure')) …
```

⇒ 它们是**在钉住 R-09 那个错误行为**。改成 6 之后，这两条会红 ——
  **那正是「断言在保护缺陷」的形态**，不是回归。

⚠ 这类断言最容易被误当成「不许改」的证据。判据：
  **如果一条断言要求的，正是 REVIEW 判定为缺陷的行为 ⇒ 改断言，⛔ 不是改 REVIEW。**

### 72.4 断言 PIPE-26（类型 + 运行时**双重**）

```
① 类型层：源码里 activeStage 的联合类型不许出现 7（读源码文本）
② 运行时：跑完整链，activeStage 全程 ∈ {1..6, null}
```

⚠⚠ **第一版运行时判据是空转的**：我喂的夹具是 `[req]` / `[req, plan]` / `[req, plan, task]`，
  三个都停在 **1**（缺审批）⇒ 输出写着「运行时实测 **[1]**」——**只取到一个值**。
  那样的话 `activeStage = 7` 永远测不到。

⇒ 改用 PIPE-18 那套「产品已接受、只差交付收口」的完整链 ⇒ 实测 **`[1,6]`**。

⚠ 这是**第 5 次**「断言绿但没牙」（§31 / §41 / §63 / §70 / 本轮）。
  五次的共同点还是那条：**输出里有个「扫了 N / 实测 [..]」，而它小得可疑**。
  这次是「实测 [1]」——只有**一个**值时，说明夹具根本没覆盖到目标分支。

**验证（实测）**：

```
✓ PIPE-26 ✓ activeStage 取值域 ⊆ 1..6：类型层无 7，运行时实测 [1,6]
把 activeStage 改回 7 ⇒ **四条同时红**：
  ✗ PIPE-18 · 业务阶段应停在 6（⛔ 不是 7 —— 收口是门不是步）：实际 7
  ✗ PIPE-18 · 未收口却没有 closurePending：undefined
  ✗ PIPE-20 · skipped 缺记录时没有停在 G6：activeStage=7 · closurePending=undefined
  ✗ PIPE-26 · 运行时出现过域外的 activeStage：[7]（⛔ 不许有 7）
```

### 72.5 验证

```
check:pipeline 30/30（+PIPE-26，原 29）
check:stage-controls 108/108 · check:stages-route 39/39
check:stages-dom 146/146 · check:config 67/67 · check:hob-gate 59/59
check:orch 354/353 · check:hob-create 55/55 · check:policy 49/49
check:workflow 34/34 · check:client 51/51 · check:profile 3/3 · meta-negctl 5/5
typecheck exit 0 · build OK
```

### 72.6 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 102 | **103** |
| 已排除 | 2 | 2 |
| 已处理（保留+标注） | 1 | 1 |
| 剩余 | 7 | **6** |

✅ 校验：103 + 2 + 1 + 6 = **112**。

**剩余 6 条**：

| 等级 | 条数 | 编号 |
|---|---|---|
| medium | **1** | O-21 |
| low | **5** | O-15 O-20 S-14 T-12 T-17 |

⚠ **O-21**（面板 i18n：148 处 CJK / 16562 字符 / `t()` = 0）是**唯一剩下的 medium**，
  也是唯一需要单独立项的一条 —— 它是**纯机械重写**，与其余 5 条 low 无关。


---

## §73 本轮修 O-20 + S-14 · 「兜底入口」其实是循环依赖

### 73.1 先核了一遍剩余清单

| 编号 | 上表记的 | 实况 |
|---|---|---|
| **T-17** | 剩余 | ✅ **§69 已修**（资源路由 `defaultFetchResource` 已有 2 处 `StaleRouteError`）|
| 其余 5 条 | 剩余 | 仍在 |

⇒ 剩余实际是 **5 条**，不是 6 条。

### 73.2 O-20 的缺陷：注释自相矛盾

`create-hob-dialog.tsx` 的锚点组件：

```
if (!isOpen) return null          ← 弹窗关着时组件根本不存在
…
onClick: () => props.state.open()  ← 唯一的 open() 调用点，在 return null 之后
```

而旧注释写：

> ⇒ 留它当**兜底入口**，但⛔ 不再常驻。

⚠ **自相矛盾**：兜底入口必须**先于**弹窗存在，而它在弹窗关着时不存在。
  组件唯一的 `open()` 调用在 `return null` **之后** ⇒ 它**不可能**打开弹窗。

REVIEW 已裁定这是「**设计选择而非缺陷**」，修法二选一；本轮选**改注释**（⛔ 不恢复常驻，
那会让用户在任何页面都看见一个浮层）。

**改后的准确说法**：

- 本入口是「**弹窗打开时的可见锚点**」，不提供手动打开能力；
- 想**新建**：走宿主自己的入口；
- 想给**已有会话补选档位**：走 `hob-unselected-gate.tsx` 的横幅（它在弹窗**关着**时也渲染）。

### 73.3 S-14：机检确实缺了这一半

实测：`check-hob-create-dom.mjs` 的 **D-1a 已经断言过「弹窗关闭时入口不渲染」**。
但 S-14 说的是**另一个命题**：

| 命题 | 谁断言 |
|---|---|
| 「这个组件在关着时**不在**」 | D-1a ✅ 已有 |
| 「关着时**另有一条路**能打开它」 | **没人断言** ← S-14 的诉求 |

⇒ 补 **D-150**（源码层，⛔ 不挂载组件）：

```
① 锚点组件里 state.open() 必须在 if (!isOpen) return null **之后**
② 必须另有 installHobUnselectedGate（横幅）
③ 该横幅必须有 unrecorded 分支（否则它不会在关着时出现）
```

### 73.4 ⚠⚠ 负向对拍试了**四次**才成立

| # | 变异 | 结果 | 根因 |
|---|---|---|---|
| 1 | 在 `return null` **前**插入 `props.state.open()` | ❌ 仍绿 | 判据找的是 `onClick: () => props.state.open()` 这个**特定串** |
| 2 | 同上 | ❌ 仍绿 | 同上 |
| 3 | 把判据改成找 `state.open()` | ❌ **恒红** | 扫到了**我注释里**写的 `state.open()` |
| 4 | 先剥注释再扫 | ✅ | — |

⚠ 第 3 次最值得记：**判据扫到了它自己的说明文字**。
  这与 §68.3「`--include=*.ts` 漏 `.tsx`」、§70.2「扫到自己输出行」是**同一类**：
  **判据的作用域里混进了非目标内容**。

⚠ 还有一个更早的错误：`dialogSrc.indexOf('if (!isOpen) return null')` 取到的是
  **弹窗本体**那个（`:1446`），不是锚点组件的（`:1193`）—— 本文件有**两个**。
  ⇒ 必须先把作用域切到 `export function HobCreateCommandEntry` 的函数体内。

**最终验证（实测）**：

```
✓ D-150 ✓ 弹窗关着时**另有**入口：锚点的 state.open() 在 return null 之后
在组件内 return null 之前插入 open() ⇒
  ✗ D-150 · state.open() 在 return null **之前** ⇒ 锚点变成了打开入口（与 O-20 的注释矛盾）
恢复 ⇒ 查了 32 处 · 过了 32 处
```

### 73.5 验证

```
check:hob-create-dom 32/32（+D-150，原 31）
check:pipeline 30/30 · check:stage-controls 108/108 · check:stages-route 39/39
check:stages-dom 146/146 · check:config 67/67 · check:hob-gate 59/59
check:orch 354/353 · check:hob-create 55/55 · check:policy 49/49
check:workflow 34/34 · check:client 51/51 · check:profile 3/3 · meta-negctl 5/5
typecheck exit 0 · build OK
```

### 73.6 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 103 | **105**（O-20 + S-14；T-17 在 §69 已记） |
| 已排除 | 2 | 2 |
| 已处理（保留+标注） | 1 | 1 |
| 剩余 | 6 | **4** |

✅ 校验：105 + 2 + 1 + 4 = **112**。

**剩余 4 条**：

| 等级 | 条数 | 编号 |
|---|---|---|
| medium | **1** | O-21 |
| low | **3** | O-15 T-12 |

⚠ 修正：上表原写 5 条 low，实为 **3 条**（T-17 已修、O-20 与 S-14 本轮修）；
  **O-21** 是唯一剩下的 medium。


---

## §74 本轮修 R-17 · 零调用的自描述 + 强弱判据并存

### 74.1 先纠正了剩余清单

上一轮我说「剩余 4 条」但只列了 3 个编号。按 §66.3 基线（53 条）重算：

```
基线 53 · 已修 76 · **剩余 4**
⇒ O-21 · O-15 · **R-17** · T-12
```

⚠ 漏掉的正是 **R-17**。这与 §66 那次「用错的总数反推明细」是同一类问题 ——
  **剩余清单必须正向枚举（从权威基线减），⛔ 不能凭记忆列。**

### 74.2 R-17 前半：`STAGE_COMPLETION` 零调用

它是一份「每阶段完成口径」的自描述：

```
tasks: { definition: '任务已拆清：…', judgedBy: 'TSK exists + C-5' }
```

⚠ 零调用 = **一份没人读的自描述，写着什么都不重要 ⇒ 必然漂**。

**处理选择**（⚠ 这里做了判断）：

| 选项 | 评价 |
|---|---|
| 删掉 | ❌ 那会把「完成口径」这份文档一起删掉 |
| **让机检读它** | ✅ **选它** —— 从「零调用的文档」变成「被判据钉住的口径表」 |

⇒ **SC-36**：

```
① 七个 StageId 必须齐全（⛔ 不许漏一个阶段）
② judgedBy 里点到的每个 C-NN / RP-N，必须在代码里真实存在
```

**实测**：15 个规则号全部真实存在。

### 74.3 R-17 后半：强弱判据并存（**这条是真缺陷**）

```
stage-controls.ts:1064  stageFieldProblems  → taskFullProblems  （强，含风险）
stage-controls.ts:1374  gateProblemsAt('tasks') → taskProblems   （弱，不含风险）
```

⇒ **同一份账本，走两条路得到不同结论** —— 那正是 T 组要治的「出口分裂」。

`taskFullProblems = taskProblems + taskRiskProblems`（`:582-584`）是**严格超集**
⇒ 改过来只会**多拦**、不会少拦（⛔ 不是放宽）。

### 74.4 ⚠ 夹具试了**两次**才成立

| # | 夹具 | 结果 |
|---|---|---|
| 1 | 只给 `id/kind/status/pipeline_version/revision/title` | ❌ 干净任务也报 **5 条**（缺 C-5 那四项） |
| 2 | 补齐 `task_brief` / `counterexamples` / `stop_conditions` / `return_to` | ❌ 仍报 **1 条**：`RP-4 v3 任务缺 task_risk` |
| 3 | 再补 `task_risk: 'low'` | ✅ |

⚠ 第 2 次最值得记：**「干净任务」的定义不是我拍的，是 `taskFullProblems` 定的**。
  我按 `taskProblems` 的口径（C-5 四项）造夹具，而判据要的是 `taskFullProblems` 的口径（+`task_risk`）。
  ⇒ 造「应该通过」的夹具时，**必须按最严那条判据的完整要求来造**，
    ⛔ 不能按较松的那条造完就说「它该绿」。

**验证（实测）**：

```
✓ SC-35 ✓ gateProblemsAt('tasks') 与 stageFieldProblems 同一判据：
          风险缺口两处都报、干净任务两处都空
改回 taskProblems ⇒
  ✗ SC-35 · gateProblemsAt('tasks') **没有**报出风险缺口 ⇒ 与 stageFieldProblems 结论不一致（R-17 复发）
✓ SC-36 ✓ 七个阶段齐全，judgedBy 点到的 15 个规则号全部真实存在
把 tasks.judgedBy 改成 C-99 ⇒
  ✗ SC-36 · tasks.judgedBy 点到的规则 `C-99` **在代码里不存在** ⇒ 自描述已经漂了
```

### 74.5 顺带发现：G-16 有盲区

`STAGE_COMPLETION` 是 `export const`，而 **G-16 只扫 `export function`** ⇒ 漏掉它。
已在 `check-config-face.mjs` 的 G-16 注释里记下这个盲区（本轮⛔ 没扩扫，
因为扩到 `export const` 会把大量全大写常量误报，需要先定白名单规则）。

### 74.6 验证

```
check:stage-controls 110/110（+SC-35/SC-36，原 108）
check:hob-create-dom 32/32 · check:pipeline 30/30 · check:stages-route 39/39
check:stages-dom 146/146 · check:config 67/67 · check:hob-gate 59/59
check:orch 354/353 · check:hob-create 55/55 · check:policy 49/49
check:workflow 34/34 · check:client 51/51 · check:profile 3/3 · meta-negctl 5/5
typecheck exit 0 · build OK
```

### 74.7 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 105 | **106** |
| 已排除 | 2 | 2 |
| 已处理（保留+标注） | 1 | 1 |
| 剩余 | 4 | **3** |

✅ 校验：106 + 2 + 1 + 3 = **112**。

**剩余 3 条**：

| 等级 | 条数 | 编号 |
|---|---|---|
| medium | **1** | O-21 |
| low | **2** | O-15 T-12 |


---

## §75 本轮修 T-12 · 回执说「干完了」，账本还停在 `registered`

### 75.1 缺陷本体

```
orchestrator.ts:1609-1636  buildReceipt()      ← 回执在这里组装并发出
orchestrator.ts:7649-7677  投影                ← 账本在这里才更新
```

⇒ **回执先发、投影后落** ⇒ 回执正文里**不可能**带投影结果。
派活方读回执看到「活干完了」，而账本里 RUN 仍可能是 `registered`。

⚠ 关键判断：**先写后发是对的**（反过来会在投影失败时丢掉回执）。
  ⇒ 修法**不是**改投递语义，而是把「上次投影没落」带到**下一次**读数。

### 75.2 修法

| # | 改动 |
|---|---|
| ① | `OrchStatus` 新增 `ledgerProjectionFailures?: { returnFailed, dispatchFailed, headline }` |
| ② | `status()` 从 `w.ledgerProjection.{return,dispatch}.ok === false` 数出来 |
| ③ | `hob_orch_status` 在 `...recordLines` 之后插一行（**只在非零时**） |

⚠ ③ 的「只在非零时」不是优化，是**纪律**：正常态多印一行会让既有输出快照全红，
  而那种「为了加一条读数把所有快照都改一遍」的改动，最后往往是**把判据改松**收场。

**措辞**（这条最要紧）：

```
⚠ 账本投影**没落**：回传 N 条（回执已发出，但账本未更新）⇒ 原因：…
   —— ⛔ 别把「回执发出」当成「账本已落」
```

⚠ 必须点明「回执已发出，但账本未更新」—— 只写「投影失败」会让人以为是**写盘出错**，
  而实际是**两件事的时序差**。这两者的排查方向完全不同。

### 75.3 断言 TP-p + 负向 TP-q

判据是**四条结构 + 一条行为**（⚠ 行为层探针本轮**没做成**，如实记）：

| # | 判据 | 结果 |
|---|---|---|
| ① | `OrchStatus` 有该字段 | ✅ |
| ② | 从 `ok === false` 数（⛔ 不是别的来源） | ✅ |
| ③ | 头行「非零才出」 | ✅ |
| ④ | 措辞含「回执已发出，但账本未更新」 | ✅ |
| ⑤ | **行为层**：造一条 `return.ok=false` ⇒ `status()` 带该字段 | ❌ **未做成** |

⚠ ⑤ 为什么没做成：`createHobOrchTools({})` 造不出可用的 `hob_orch_status`
  （返回的数组里找不到它，实测 `找到 status 工具: false`）——
  它依赖整套 orch 上下文（账本根 / 会话 / 看板）。
  ⇒ **如实标注**：本条目前是**结构判据**，⛔ 不是行为判据。
  ⚠ 这与 §68.5 的 G-16 同一处置（结构判据也能有牙，但覆盖面窄一格）。

**验证（实测）**：

```
✓ TP-p ✓ 投影没落 ⇒ 下一次 hob_orch_status 头行带信号
✓ TP-q ✓ 负向对拍（把「非零才出」改成恒出）⇒ TP-p 必红
```

### 75.4 验证

```
check:orch 356/355（+TP-p/TP-q，原 354/353；1 跳过不变）
check:stage-controls 110/110 · check:hob-create-dom 32/32
check:pipeline 30/30 · check:stages-route 39/39 · check:stages-dom 146/146
check:config 67/67 · check:hob-gate 59/59 · check:hob-create 55/55
check:policy 49/49 · check:workflow 34/34 · check:client 51/51
check:profile 3/3 · check:meta-negctl 5/5
typecheck exit 0 · build OK
```

### 75.5 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 106 | **107** |
| 已排除 | 2 | 2 |
| 已处理（保留+标注） | 1 | 1 |
| 剩余 | 3 | **2** |

✅ 校验：107 + 2 + 1 + 2 = **112**。

**剩余 2 条**：

| 等级 | 条数 | 编号 |
|---|---|---|
| medium | **1** | O-21 |
| low | **1** | O-15 |


---

## §76 本轮复核 O-15 · **REVIEW 的判断与用户裁定冲突，已驳回**

### 76.1 REVIEW 说什么

> **O-15** · low · `ledger` 档仍可跨项目读看板与全部工作区路径
> 修法：`ledger` 档的可见工具集必须与 README 的档位描述逐名相等

### 76.2 实测：那是**用户裁定的有意设计**

`src/preset/tools.ts:1266-1270` 与 `:1660-1661` 都记着同一句裁定：

```
用户裁定：**档位只管可读范围**，工具面与档位无关；工具面**默认放开**
（新装插件自动可用），靠 `DEFAULT_DENY` 那张 deny 清单收。
```

用户原话（文件里逐字记着）：

> 「把当前项目自己的工具和其他工具做区分，**档位以及工作推进方式权限控制都是通过当前项目的
> 工具去控制的不影响其他工具**」
> 「**档位一直都只是控制 HOB 预设的可读操作权限啊**」

**实测**：

```
READ_SCOPED_TOOLS = ['hob_read_doc','hob_glob','hob_grep','hob_read_image']   ← 只有 4 个读名
PERMISSION_TIERS.ledger    = MODEL_TOOL_ALLOWLIST              (26)
PERMISSION_TIERS.project   = ledger + hob_read_doc             (27)
PERMISSION_TIERS.workspace = project + 3 个读名                (30)
```

⇒ `hob_workspaces` / `hob_orch_status` 三档都在，**这正是裁定要求的**。

⚠ 所以 O-15 不是缺陷，**是 REVIEW 把用户裁定当成了漏洞**。
  按 §50（O-11）/ §53（O-24）的同一处置：**驳回，⛔ 不改代码**。

### 76.3 但 REVIEW 有一条**说得对**：README 措辞不准

README 原写：

```
`ledger`（只读自己的记录与网络）
```

⚠ 「只读**自己的**」是错的 —— 同一档里 `hob_workspaces` 列**全部**已登记工作区
  （含 `cwd` 路径），`hob_orch_status` 读看板。
  ⇒ 读的人会以为「档 1 看不见别的项目」，而实际上**看得见**。

**改后**：

```
`ledger`（**读范围最小档**：只读项目账本里的 .md、网络与检索；
         ⚠ **编排类工具与档位无关**，三档都能用）
```

⚠ 这条改的是**文档说真话**，⛔ 不是改行为。

### 76.4 断言 ⑤p-1：把裁定**钉住**，防止有人照 O-15 初读去「修」

```
① READ_SCOPED_TOOLS 恰为那 4 个读名（⛔ 不许把编排类塞进来）
② 档 2 = 档 1 + hob_read_doc；档 3 ⊇ 档 2（⛔ 高档不许比低档少）
③ ⚠ **反证**：orch_status / workspaces / spawn / dispatch 三档都必须 keep
```

⚠ ③ 是这条断言真正的价值：**若哪天有人按 O-15 的初读把它们从低档摘掉，本条当场红**。

**验证（实测）**：

```
✓ ⑤p-1 ✓ 档位只管读范围：READ_SCOPED_TOOLS 恰 4 个读名；编排类三档一致
把 hob_orch_status 从档 1 摘掉 ⇒
  ✗ ⑤p-1 · 档 2 相对档 1 的增量是 [hob_orch_status,hob_read_doc]，应恰为 [hob_read_doc]
  ✗ ⑤p-1 · hob_orch_status 在 ledger 档被摘掉了（O-15 的初读若被当成缺陷就会这样）
```

### 76.5 ⚠ 顺带发现：O-15 引用的 §7.4 D-2 是**错的**

O-15 写「见 §7.4 的 D-2」，但 `§7.2 D-2` 讲的是「`clarify_legacy = pre-control`
是否还允许用于 v3 条目」—— **与档位权限毫无关系**。
⇒ REVIEW 的交叉引用有误（⛔ 不影响结论，但下次别顺着它找依据）。

### 76.6 验证

```
check:presets 282/282（+⑤p-1）
check:orch 356/355（1 跳过）· check:stage-controls 110/110
check:hob-create-dom 32/32 · check:pipeline 30/30 · check:stages-route 39/39
check:stages-dom 146/146 · check:config 67/67 · check:hob-gate 59/59
check:hob-create 55/55 · check:policy 49/49 · check:workflow 34/34
check:client 51/51 · check:profile 3/3 · check:meta-negctl 5/5
typecheck exit 0 · build OK
```

### 76.7 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 107 | 107 |
| **已排除** | 2 | **3**（+O-15） |
| 已处理（保留+标注） | 1 | 1 |
| 剩余 | 2 | **1** |

✅ 校验：107 + 3 + 1 + 1 = **112**。

**剩余 1 条**：**O-21**（medium）—— 面板 i18n：148 处 CJK / 16562 字符 / `t()` = 0。

⚠ 它是全程唯一**必须单独立项**的一条：纯机械重写，改动面覆盖整个
  `project-panel.tsx`（3862 行），不适合在「逐条修缺陷」的节奏里做。


---

## §77 本轮修 O-21（裁定 B）· 契约说「所有文案都走 t()」，实际最大一屏零接入

### 77.1 先做了实测，⚠ 差点被一个假 0 骗了

```
grep -c '[一-龥]' src/client/project-panel.tsx   ⇒  **0**
```

⚠ 我第一眼以为「O-21 已经修过了」。**实际是正则不生效**（locale 相关）。
改用 Unicode 码位范围重测：

```
/[\u4e00-\u9fff]/g  ⇒  CJK 字符 **16842** 个 · 含 CJK 的行 **1089** 行
其中：注释 **873** 行 · 非注释 **216** 行
t( 调用 ⇒ **0**
```

⇒ O-21 **真实存在**，而且规模不小。

⚠ 教训：**`grep '[一-龥]'` 在部分 locale 下会静默返回 0** ——
  那会让人得出「已经修好了」的错误结论。数 CJK 一律用 `[\u4e00-\u9fff]`。

### 77.2 关键：**方案早就定过了**，⛔ 不是我现拍的

`REVIEW.md §7.4` 的 `D-14`（主控拍板）：

> **B 先落地、A 另开单**：当前的问题不是「没翻译」而是
> 「文档说全都走 `t()`、实际最大一屏零接入」—— 先把契约说准，
> 否则任何一次「i18n 已覆盖」的复核都会被这一条推翻。

⇒ 本轮做 **B**（改契约），**A**（全量迁移）另开单。

**为什么 A 不该现在做**（实测支撑，⛔ 不是偷懒）：

| 事实 | 数 |
|---|---|
| 非注释 CJK 行 | **216** |
| CJK 字符 | **16842** |
| `i18n.ts` 里 `stages.` 词条 | **0**（要从零建 ≈150 个） |
| 被机检锚定的导出常量 | **12**（`STAGES_STEP_NAMES` / `STAGES_UNWIRED_LABEL` / `STAGES_EMPTY_TEXT` …） |

⚠ 最后一行是关键：那 12 个常量**被断言当真值锚点**（实测 3 个直接被 `scripts/*.mjs` 引用）。
  直接改成 `t()` 会让那些断言**失去锚点** ⇒ 必须与机检同批改。
  ⇒ 这正是「另开单」的理由，⛔ 不是「以后再说」。

### 77.3 改了什么

`src/client/i18n.ts` 的 `t()` 契约，**改前**：

```
 * 面板取词入口（**所有面向用户的文案都经它**）。
```

⚠ 那句话是**假的** —— 而害处不是「少翻译了」，是
  **让每一次「i18n 已覆盖」的复核都被这一条推翻**：读契约的人会以为面板已接入，于是不会去查它。

**改后**：明确列出两档

| 档 | 文件 |
|---|---|
| ✅ 已接入 | `settings-panel.tsx` · `create-hob-dialog.tsx` · `hob-unselected-gate.tsx` |
| ⚠ **仅中文（未接入）** | `project-panel.tsx` |

并写明：这是**已知且有意**的现状，⛔ 不是遗漏；A 另开单；
机检 J-21 钉住这个事实。

### 77.4 断言 J-21（**双向**）

```
① 契约里**必须**有「仅中文（未接入）」这句如实声明
② 契约里**必须不**再出现「所有面向用户的文案都经它」这个假承诺
③ ⚠ 事实核对：面板的 `t(` 计数必须与契约声明一致（现在契约说零接入 ⇒ 实测必须真是 0）
```

⚠ ③ 是这条断言真正的价值：**哪天有人开始迁移，本条会红**，
  提醒同步改契约 —— ⛔ 不许「只改代码不改契约」（那正是 O-21 的成因）。

**验证（实测，两个方向都试了）**：

```
✓ J-21 ✓ 契约与面板现状一致：明写「仅中文（未接入）」，实测 t() = 0
把假承诺加回来 ⇒
  ✗ J-21 · 契约里仍有「所有面向用户的文案都经它」这个假承诺（O-21 复发）
删掉如实声明 ⇒
  ✗ J-21 · 契约里没有「仅中文（未接入）」这句如实声明 ⇒ 读的人会以为面板已接入
```

### 77.5 验证

```
check:client 52/52（+J-21，原 51）
check:presets 282/282 · check:orch 356/355（1 跳过）
check:stage-controls 110/110 · check:hob-create-dom 32/32
check:pipeline 30/30 · check:stages-route 39/39 · check:stages-dom 146/146
check:config 67/67 · check:hob-gate 59/59 · check:hob-create 55/55
check:policy 49/49 · check:workflow 34/34 · check:profile 3/3 · meta-negctl 5/5
typecheck exit 0 · build OK
```

### 77.6 累计 · **112 条全部有归属**

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 107 | **108** |
| 已排除 | 3 | 3 |
| 已处理（保留+标注） | 1 | 1 |
| 剩余 | 1 | **0** |

✅ 校验：108 + 3 + 1 + 0 = **112**。

⚠ **「剩余 0」的准确含义**：

| 含义 | 成立？ |
|---|---|
| REVIEW 的 112 条**全部有明确归属** | ✅ |
| blocker / high 归零 | ✅ |
| **A 方案（面板全量迁 i18n）已完成** | ❌ **没有** —— 它是**另开单**，⛔ 不在 112 的「修好」口径里 |

⇒ 裁定 B 落地 = O-21 这条**按方案关闭**（契约说准 + 机检钉住），
  ⛔ **不等于**面板已经支持英文。这一点必须写清楚，否则又是「文档说做完了」。


---

## §78 收口轮 · `check:all` 全量跑出来的 **7 个失败**逐个查清

### 78.1 ⚠ 先纠一个我自己的误判

上一轮我把 `check:all` 的**管道退出码**（`| tail -40` 的 `$?`）当成了检查结果，
写成了「exit 0 = 全部通过」。**实际是 7 个族失败。**

```
共 47 族：通过 40 · 失败 7 · 崩溃 0 · 未执行 0
```

⚠ 教训：**`npm run ... | tail` 的 `$?` 是 `tail` 的退出码，不是 npm 的。**
  要看真退出码必须 `set -o pipefail` 或 `npm run -s x >/dev/null 2>&1; echo $?`。

### 78.2 逐个查清（**3 个是我造成的，已修；4 个是既有**）

| 族 | 谁造成的 | 处置 |
|---|---|---|
| `check:ledger-projection` | **我**（S-03 连带） | ✅ 已修 |
| `check:live-route` | **我**（S-03 连带） | ✅ 已修 |
| `check:gitignore` | **我**（FIX-RESULT 涨到 269KB） | ✅ 已修 |
| `check:work-plan` | **我**（删 `isSerializedPlan` 留下孤立注释） | ✅ 已修 |
| `check:ledger` | 既有（真账本 I9 悬空引用 ×3 + I5c ×3） | 如实记，⛔ 不改 |
| `check:work-plan-panel` | 既有（脚本 mtime 11-09，本轮未动） | 如实记 |
| `check:work-plan-runtime` | 既有（7 处，文档早有记录） | 如实记 |

### 78.3 我造成的 3 个，根因都是同一条

**S-03 把 C-7 改成 fail-closed** ⇒ 所有「缺 `built_by`」的夹具**立刻被拒**。
那暴露了一个**既有真缺陷**（⛔ 不是 S-03 引入的）：

```
hob-write.ts:1330   ...stageFieldProblems(incoming)
stage-controls.ts:1052  export function stageFieldProblems(units) {
  ...acceptanceProblems(u, units)   ← 第二参数就是 units
```

⇒ 传 `incoming`（只含**本次写入的 ACC**）⇒ `acceptanceProblems` 找不到**父任务**
  ⇒ 父任务被判「缺 built_by」⇒ 整个写入被拒。

⚠ **改前为什么没暴露**：S-03 之前 C-7 在 `builder === ''` 时**根本不检查**（fail-open），
  所以「找不到父任务」这件事**静默通过了**。

**修法**（分两个参数，⛔ 不是把 `incoming` 换成 `merged`）：

```
stageFieldProblems(units, context = units)
  · units   —— **判谁**（只报这些单元自己的问题；保住 T-06b 的「不对整本账开火」）
  · context —— **查引用用**（父任务 / 父方案要在里面）
hob-write.ts 调：stageFieldProblems(incoming, merged)
```

⚠ **两个参数分开是必须的**：只传 `merged` 会让既有单元的欠账也拦住写入
  —— 那正是 T-06b 治过的死锁（欠账要靠写入来补，而写入被欠账拦住）。

**live-route 的夹具**也跟着补：C-5 四件套 / `task_risk` / `built_by` /
`CHG` 单元（C-4 四件套 + RP-9 十维）/ RP-3 的 digest（**用纯函数算，⛔ 不手写**）。

⚠ 这是**补夹具的真值**，⛔ 不是「为了让断言变绿而放松判据」——
  S-03 之后，每条夹具都**必须真的合规**才能写进去。

### 78.4 `check:gitignore`：`kit/drafts` 里 6 个文件超 64KB 读上限

M 判据的处置原话是「**整块搬走 + 原位留指针**，⛔ 不是压缩」。按它拆：

| 原文件 | 字节 | 拆成 |
|---|---|---|
| `FIX-RESULT.md` | 269719 | 主（§1–§21 + 指针）+ **4 卷** |
| `LEAD-VERIFICATION.md` | 80408 | 主（指针）+ **2 卷** |
| `REVIEW.md` | 210789 | 主（指针）+ **3 卷**（§5 缺陷总表再按 `###` 拆成 2-1/2-2/2-3）|
| `fix/01-judgment.md` | 81698 | 主 + 2 卷 |
| `fix/02-ledger.md` | 91350 | 主 + 2 卷 |
| `fix/03-client.md` | 81619 | 主 + 2 卷 |

⚠ 拆分**只按章节边界切**（⛔ 不在段落中间断），每卷 ≤58KB，
  且每个分卷头部都写明「**拆分的唯一原因是读上限**」。

### 78.5 `check:work-plan`：我删函数留下的孤立注释

```
work-plan.ts:1001  /** 计划是否声明「同一时刻只有一条轨在跑」… */   ← isSerializedPlan 的 JSDoc
```

⚠ O-17 删了 `isSerializedPlan`，但**它的 JSDoc 留在原处** ⇒ WM-34 抓到
  「发现一段**没有函数体**的 JSDoc」。删注释，56/56 恢复。

⚠ 教训：**删函数必须连注释一起删**（本仓已有一条同型：R-21 那段）。

### 78.6 剩下 3 个既有失败（**如实记，⛔ 不改**）

| 族 | 失败 | 为什么不动 |
|---|---|---|
| `check:ledger` | I9×3（`archive/…ACCEPTANCE-REPORT.md` 悬空）+ I5c×3（`spec/checkpoint.md` 过期） | **真账本数据问题**，⛔ 不是代码缺陷；改判据 = 把「悬空引用」这条纪律废掉 |
| `check:work-plan-panel` | 9 处（根因 WP-1：面板没渲染） | 脚本 mtime **11-09**，本轮未动；`expanded` 默认折叠是有意设计 |
| `check:work-plan-runtime` | 7 处（WPR-4/5/8/10/16/20/26） | 文档早有记录，mock 时序问题 |

⚠ **⛔ 不许用「放宽断言」去消掉它们** —— 那会把真问题藏起来。
  本仓纪律：**未修 ≠ 修好**，如实记在案比假绿强。

### 78.7 验证（逐个实测 exit code，⛔ 不用管道）

```
check:gitignore          exit=0   ← 修好
check:ledger-projection  exit=0   ← 修好
check:live-route         exit=0   ← 修好
check:work-plan          exit=0   ← 修好（56/56）
check:client             exit=0
check:orch               exit=0
check:stage-controls     exit=0
check:ledger             exit=1   ← 既有（真账本数据）
check:work-plan-panel    exit=1   ← 既有（脚本 11-09）
check:work-plan-runtime  exit=1   ← 既有（文档已记）
typecheck exit 0 · build OK
```

### 78.8 累计（不变）

| | 数 |
|---|---|
| 已修 | **108** |
| 已排除 | 3（S-08 / O-24 / O-15） |
| 已处理（保留+标注） | 1（O-16） |
| 剩余 | **0** |

✅ 校验：108 + 3 + 1 + 0 = **112**。

⚠ 本轮**没有新增修复条目**（`check:all` 暴露的 4 个是我自己造成的回归，已修）；
  但它把「全量入口到底绿不绿」这件事**从假设变成了实测** ——
  上一轮那句「exit 0 = 全部通过」是**错的**。


---

---

**文档结束。**
