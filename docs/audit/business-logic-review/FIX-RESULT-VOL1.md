# FIX-RESULT 分卷 1 · §22–§33

> ⚠ 本文件是 `FIX-RESULT.md` 的**分卷**（原文件超过 64KB 读上限，按 `check:gitignore` 的
> M 判据处置：**整块搬走 + 原位留指针**，⛔ 不是压缩）。
> 主文件：`docs/audit/business-logic-review/FIX-RESULT.md`（§1–§21 + 指针表）。
> ⚠ 分卷只搬**历史章节**；**结论与逐条账仍在主文件**。

---
## §22 T-15 已修 · 6 处丢弃返回值收成 1 处，且注释不再说谎

### 22.1 缺陷本体（实测复现）

```
grep -rn 'ensurePolicyDirIgnored(' src/   ⇒ 6 处调用，全部裸调用（返回值未接）
   session-policy.ts:464 / :1121 / :1216
   session-policy-service.ts:1337 / :1525 / :1576
```

而它的注释（`session-policy.ts:490-491`）写着：

> 返回值有**三处**调用方拿它决定「要不要告警」（`session-policy-service.ts` 三处）⇒ 写没写进去必须当场核

**—— 与实现完全相反。** 连它自己点名的三处也没接。

⚠ **这条的危害不在 `.gitignore` 本身，而在注释**：它宣称这件事已被处理 ⇒ **下一个人不会去查**。
后果是 `runtime/.gitignore` 写失败 ⇒ `session-policy.json`（含 **sessionId**）可能被 git 收进历史，零告警。

### 22.2 修法：**不是 6 处各加一个 `if`，而是收进 1 处**

施工前的关键观察：

| 函数 | 调用点 |
|---|---|
| `ensurePolicyDirIgnored` | `:464` `:1121` `:1216` + service 3 处 |
| `writePolicyStore` | `:465` `:947` `:1002` `:1066` `:1122` `:1217` |

**6 处 `ensurePolicyDirIgnored` 与 6 处 `writePolicyStore` 一一对应，且本文件内三处紧邻**
（`:464→465` / `:1121→1122` / `:1216→1217`）。

⇒ 把它移进 `writePolicyStore` 内部 = **一处守住 6 条写路径**，
且天然复用已有的 `ok` / `reason` 通道 —— ⛔ 不必在 `session-policy.ts` 里凭空加一套日志设施
（该文件**没有任何 logger**，只有 service 侧有 `ctx.logger`）。

### 22.3 ⚠ 一个必须回答的语义问题

> **`.gitignore` 写失败，算不算「策略写失败」？**

**算。** 理由：`writePolicyStore` 返回的是「这次写入是否**安全地**落盘」。
策略文件里有 sessionId，没有 `.gitignore` 护着就可能进 git 历史 ——
那不是「写成功但有瑕疵」，而是**这次写入不安全**。

⚠ 顺带把**顺序**也钉住了：**先写 `.gitignore`，再写正文**。
反过来的话，正文已落盘、`.gitignore` 没落，中间那一瞬策略文件是**裸露**的
（哪怕只几毫秒，也够一个并发 `git add` 抓到）。

### 22.4 删除的 6 处与修正的注释

| 位置 | 处理 |
|---|---|
| `session-policy.ts:464/1121/1216` | **删掉**（已收进 `writePolicyStore`） |
| `session-policy-service.ts:1337/1525/1576` | **删掉** + 删掉未使用的 import |
| `session-policy.ts:490` 的错误注释 | 改成实况：写明「原文说三处接住，实际一处都没有」+ 现在收在哪 |

**剩余调用点：1 处**（`session-policy.ts:419` `const ignored = ensurePolicyDirIgnored(...)`）。

### 22.5 验证

```
check:hob-create-ui  汇总：通过 54 · 失败 0   （新增 CU-44）
其余 11 个 check 族全部 0 失败 · typecheck exit 0 · build OK
```

**负向对拍（实测）**：把守卫改成 `if (false && !ignored)` ⇒

```
✗ CU-44 · 拒绝原因没点名 .gitignore：策略写入失败：ENOTDIR: not a directory, mkdir '…'
```

⚠ **这个负向结果本身很有信息量**：关掉守卫后，失败**仍然发生**（目录写不进），
但原因退化成一句笼统的 `mkdir` 报错 —— **分不清是策略写不进还是 .gitignore 写不进**。
这正是 T-15 的核心：**不是「没有失败」，而是「失败说不清是谁的」**。

### 22.6 ⚠ 施工中踩的坑：断言编号撞车两次

我先用了 `CU-41`、又改 `CU-42`，**两次都撞已有断言**（该族已用到 CU-43）。
⇒ 纪律：**新增断言前先 `grep -oE 'CU-[0-9]+' | sort -u` 看最大编号**，不要凭感觉取号。


---

## §22b T-11 已修 · `writeWorkPlan` 返回值一处都不许丢

### 22.1 缺陷本体（已回头核实）

```
4559:  const written = writeWorkPlan(...)   ← 接了，且落 warn（正确范例）
4896:  const stored  = writeWorkPlan(...)   ← 接了，且直接返回失败（更强的用法）
4965:  writeWorkPlan(ledgerRoot, plan)      ← ❌ 裸调用（首波派发后）
5524:  writeWorkPlan(ledgerRoot, attached)  ← ❌ 裸调用（单目标附挂）
5565:  writeWorkPlan(ledgerRoot, implicit)  ← ❌ 裸调用（隐式计划）
```

⚠ **后两处还在 `catch {}` 里**（`catch { /* 计划可见性是附加读数 */ }`）⇒ 写失败**连一行日志都没有**。

### 22.2 三个静默症状（不是「报错」，是「看起来正常」）

| # | 失败点 | 表现 |
|---|---|---|
| ① | 首波派发后 | 盘上计划停在「全 pending」⇒ 推进器 `ready=[]` ⇒ **依赖轨永不接力**；而内存里的 watch 照常收尾 ⇒ 「计划面一直 running，实际活都跑完了」 |
| ② | 单目标附挂 | 内存里这条轨 `running`、盘上还是 `pending` ⇒ 重启后该轨**凭空消失** |
| ③ | 隐式计划 | 判据依赖「盘上有没有 active」⇒ 盘上永远没有 ⇒ **每派一次多一份新的隐式计划** |

⇒ 三个症状**都没有任何报错**，用户只会说「计划面好像不对」。

### 22.3 修法

三处都接住返回值并落 `logger.warn`，措辞**点名该处的具体后果**（不是一句笼统的「写盘失败」）。

### 22.4 ⚠ 断言写法的两处修正（都是我自己写错）

**修正 ①**：第一版断言用**正则字面量** `/^\s*writeWorkPlan\(ledgerRoot/gm`，
但 `new RegExp` 与字面量混用导致 `Unterminated group` ⇒ 改成纯静态扫描 + `String.includes`。

**修正 ②（更重要）**：第一版要求「每个接收点之后必须有 `logger.warn`」⇒

```
✗ WPD-19 · const stored = writeWorkPlan(ledgerRoot 之后 2000 字符内没有 logger.warn
```

**这是假红。** `:4896` 的 `stored` 用的是**更强的**用法 —— 直接 `return { ok:false, problems:[…] }` 给调用方。

⇒ 判据改成「**读了这个变量的 `.ok`**」，⛔ 不要求「必须是 warn」：

```js
const used = new RegExp(`\\b${varName}\\.ok\\b`).test(after)
```

⚠ **这和第二十二轮 WP-12 的坑是同一类**：「断言太强」与「实现有 bug」在输出里长得一样。
两次都是靠**看清 reason / 变量名**才分辨出来。

### 22.5 验证

```
check:work-plan-dispatch  查了 31 处 · 过了 31 处   （新增 WPD-19，原 30）
其余 12 个 check 族全部 0 失败 · typecheck exit 0 · build OK
```

**负向对拍（实测）**：把首波那处改回裸调用 ⇒

```
✗ WPD-19 · 还有 1 处裸调用 writeWorkPlan（返回值被丢弃）⇒ T-11 复发
✗ WPD-19 · 只找到 4 个接收点，预期 ≥5
```

恢复后 ⇒ 31/0。

⚠ 注意负向时**同时红了三条**（裸调用 + 接收点数不足）—— 两条判据互相印证，不是重复。

### 22.6 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 48 | **49** |
| 未修 | 62 | **61** |
| medium | 30 | **29** |

元规则下限：`check:work-plan-dispatch` 2→**3**。


---

## §23 本轮修四条（S-04 / T-21 / T-22 / S-13）

### 23.1 S-04 · `evaluateGate` 对不存在的作用域返回 `go`（fail-open 的纯函数）

**缺陷**：`gateScopeUnits` 找不到 root ⇒ 返回空集 ⇒ `stageControlProblems([])` = []
⇒ `blockers=[]` ⇒ **`go`**。

⚠ 当时**已被调用方补掉**（`tools.ts` 先做存在性核对），所以不构成可利用漏洞；
但它是**纯函数**，**任何新调用方会直接踩中** —— 而且踩中时看到的是「通过」，不会去怀疑参数写错。

**修法**：把「root 不存在 ⇒ hold」下沉进 `evaluateGate`。用 `hold` 而非 `return`，
因为 `return` 的 `allowedRepairs` 会被当成「可修单元」，而「根不存在」**没有可修单元**。

#### ⚠⚠ 施工中我**造成了一次真回归**（值得完整记下来）

第一版没做占位号豁免，结果：

```
✗ SC-13 真实账本被派单门禁拦下：阶段门禁判不出（task:implicit）
✗ SC-22 · 真实账本被误拦：阶段门禁判不出（task:implicit）
✗ SC-23 · 占位号 implicit 被误拦：阶段门禁判不出（task:implicit）
```

**根因**：`hob_dispatch` 不给 `task` 时，编排器用 `taskId: 'implicit'` 占位 —— 它**不是真实 TSK**。

⚠ **这个坑 `tools.ts:753-763` 已经记过一次**，原文写着：
「`implicit`：…它不是真实 TSK，⛔ 不能按『账本里没有 ⇒ hold』处理 —— 那会把**所有『没写 task 的老计划』一起判死**（真机当场就红：`task:implicit`）」。

⇒ **同一句话、同一个症状、同一个 `task:implicit`，我重演了一遍。**
教训：**改判定逻辑前，先 grep 这个判据有没有前科**（`grep -rn 'implicit' src/` 就能看到）。

#### 验证

```
check:stage-controls  查了 105 处 · 过了 105 处   （新增 SC-31，原 104）
```

**负向对拍（实测）**：把 `rootExists` 改成 `true` ⇒
`✗ SC-31 · 不存在的作用域根 ⇒ 判成 go（应为 hold）` ⇒ 104/2；恢复后 105/105。

⚠ SC-31 有三段：① 不存在 ⇒ hold；② **占位号 `implicit` 必须豁免**；③ 真实根不许误拦。
第 ② 段就是把我这次踩的坑钉住 —— **下次谁再忘，它当场红**。

---

### 23.2 T-21 · `check-all` 对 `exit 3` 的族数自相矛盾且行号全错

**实测**：`grep -rn 'process.exit(3)' scripts/*.mjs` ⇒ 三个族，行号 `:1523` / `:1859` / `:2459`；
而文件里写的是 `:1223` / `:1651` / `:2005` —— **三个全错**，且 `:81` 还写着「四个族」却只列三个。

**修法**：统一成「三个族」+ **⛔ 不再写行号**。

⚠ 理由写在代码里：「行号会随任何一次编辑漂移，而**族名不会**。这条契约的价值在于
『哪些族会吐 3』，不在于『第几行吐』—— 真要行号请自查 `grep -rn 'process.exit(3)' scripts/`」。

---

### 23.3 T-22 · 运行时提示词把第 5 步写成 `acceptor`（实为 `verifier`）

**缺陷**：`actor_role` 一为 `executor`、一为 **`acceptor`** —— 括号里的理由错。
第 5 步是**技术验证**（`verifier`），第 6 步才是产品验收（`acceptor`）。

⚠ 结论「不是同一个人」仍成立（F1 核的是 `s4.actor_role !== s5.actor_role` ⇒ 机检不报），**所以一直没被发现**。

⚠ **为什么必须改**：这句话会**原样进模型上下文**。模型若照它推理「第 5 步是验收人」，
会把「技术验证」当成「产品验收」—— 恰好踩宪法第 8 条的反面（通过测试 ≠ 产品接受）。

**修法**：改生成器 `gen-preset-contract.mjs:229` + 重跑生成器 + 同步 `patch.yml` + 同步 `kit/drafts/preset-contracts.md`。

⚠ **四处都要改**（生成器 / `gen/persona.md` / `patch.yml` / `kit/` 人读版），漏一处 `check:presets` 就红。

---

### 23.4 S-13 · 聚合入口自述「不写任何文件」与事实相反

**实测**：`check-all.mjs` 原文写「⛔ 不写任何文件（各族的临时件…都在系统临时目录里）」，
但多个族在**仓库根**写 `.check-*-work-<pid>/`，`check-preset-contracts` 还会**写进 `src/`**。

⚠ `.gitignore` 那一半**已经修好**（`:143-144` 的 `*__negctl_*.ts` / `*__negctl_*.mjs`）。

**本轮做两件事**：

| # | 内容 |
|---|---|
| ① | 把自述改成实况（列出两处落点 + 各自由哪条 `.gitignore` 兜底 + Ctrl-C/OOM 时不自动删） |
| ② | 新增 `findNegctlLeftovers()`：在**全部族跑完后**扫仓库根与 `src/`，发现残留就**醒目报告** |

⚠ ② **只报告、不改判**（不参与三档判定），因为「有残留」≠「判据不过」；
⚠ 也**不自动删** —— 残留可能正是某族崩溃的现场证据。

**验证**：造残留后 `findNegctlLeftovers()` ⇒
`['.check-test-work-99999/','src/shared/zzz.__negctl_99999.ts']`；清理后 ⇒ `[]`。

---

### 23.5 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 49 | **53** |
| 未修 | 61 | **57** |
| medium | 29 | **25** |

元规则下限：`check:stage-controls` 6→**10**。

```
check:pipeline 26/26 · check:stage-controls 105/105 · check:ledger 129/129
check:ledger-projection 15/15 · check:ledger-write-policy 16/16
check:ledger-resources 18/18 · check:presets 281/281 · check:policy 46/46
check:workflow 33/33 · check:meta-negctl 5/5 · check:requirement-chains 19/19
check:stages-dom 137/137 · check:work-plan-dispatch 31/31 · check:hob-create 54/54
typecheck exit 0 · build OK
```


---

## §24 本轮修两条（S-05 / R-20）· 都是「判据看着在、实际没在判」

### 24.1 S-05 · C-29 的三个绑定引用只查非空，从不解析目标

**缺陷**：`closureProblems` 只判 `txt(ref) === ''` ⇒ **填一个不存在的 id 即可满足 C-29**。
那条注释写着「G6 may not silently rewrite G5」，实际退化成「三个字符串非空」。

⚠ 与 `convergence.ts` 的 K-2/K-3/K-5（悬空引用即红）**口径不一致** ——
同一套体系里两套口径 ⇒ 用户学到的规则取决于他碰巧在看哪条判据。

**修法**：三项都加 **存在性 + kind** 校验：

| 字段 | 必须指向 |
|---|---|
| `chain_acceptance_ref` | `acc` |
| `risk_assessment_ref` | `risk` |
| `residual_risk_decision_ref` | `decision` |

⚠ **只查存在不够**：指向一个 `task` 也能通过，那同样证明不了 G5 已接受。

#### ⚠ 改完立刻暴露：SC-28 的夹具**一直是悬空的**

```
✗ SC-28 · 合法 strict 收口被拒：chain_acceptance_ref 指向不存在的单元 ACC-1…
✗ SC-28 · 合法 standard 收口被拒：risk_assessment_ref 指向不存在的单元 RSK-ASSESS-1…
```

`ACC-1` / `RSK-ASSESS-1` / `DEC-RISK-1` **一个都不在夹具里** ——
而当时 C-29 只查非空 ⇒ 照样绿 ⇒ **这条断言从未真正验过引用**。

⇒ 给夹具补上三个真实单元。**这不是「改测试迁就实现」，是测试原本就没在测它宣称要测的东西。**

### 24.2 R-20 · `ledgers-route` 用行计数冒充单元数

**缺陷**：两个不同层级的东西相减：

| 量 | 改前怎么算 |
|---|---|
| `units` | 数 `[[unit]]` **行** |
| `v3Units` | 数**任意位置**的 `pipeline_version = "v3"` **行**（可多于单元头） |
| `legacyUnits` | `Math.max(0, units - v3Units)` —— 把它**夹到 0** |

⇒ 100 条 v2 单元里只要有 1 行 v3 标记，`legacyUnits` 就被夹到 0，`health` 报 `current` ——
**把整本 v2 报成 v3**。

⚠ **报错方向正好是最危险的那一侧**：该迁移的说不用迁移。

**修法**：改用 `parseUnitsToml` + `isPipelineV3` 逐单元判定，保证 `units === v3Units + legacyUnits`。

#### ⚠⚠ 负向对拍我试了三次才真正成立

| 尝试 | 结果 | 原因 |
|---|---|---|
| 第 1 次：夹具 3 单元、1 条 v3 | **假绿** | 行计数与逐单元判定**答案相同** ⇒ 测不出差别 |
| 第 2 次：给 R-M2 加一行 `pipeline_version` | **假红** | 那行是**单元字段**，`parseUnitsToml` 正确地把它算进 R-M2 ⇒ 逐单元判定才是对的 |
| 第 3 次：在 unit-02 里放**注释行** `# pipeline_version = "v3"` | ✅ **真红** | 行计数数它（v3Units 1→2），逐单元判定不数 |

⚠ **第 2 次的假红特别值得记**：它看起来像「实现有 bug」，实际是**夹具写错了** ——
我往单元里加了一个真实字段，然后责怪实现把它算进去了。

⚠ 还有个操作坑：前两次用 `python3` heredoc 做替换，**转义层层嵌套导致替换根本没生效**，
而我看到「没变红」就以为断言没牙。最后改成**直接用 `fs.writeFileSync` 写**才生效。
⇒ 教训：**负向对拍没红时，先确认「替换真的发生了」，再怀疑断言。**

### 24.3 验证

```
check:stage-controls  106/106   （新增 SC-32，原 105）
check:ledgers-route    11/11    （新增 L8，原 10）
其余 11 个 check 族全部 0 失败 · typecheck exit 0 · build OK
```

**负向对拍（实测）**：

| 断言 | 负向操作 | 结果 |
|---|---|---|
| SC-32 | 把引用解析改回「只查非空」 | `✗` 4 条全红（三条悬空 + 一条 kind 不对） |
| L8 | 把 `v3Units` 改回行计数 | `✗ v3 单元数应为 1，实际 2` |

### 24.4 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 53 | **55** |
| 未修 | 57 | **55** |
| medium | 25 | **23** |

元规则下限：`check:stage-controls` 10→**11**、`check:ledgers-route` 1→**2**。


---

## §25 本轮修两条元规则缺口（S-10 / S-11）

两条都是**元规则自身没被守住** —— 与 §24 的两条同族（「判据看着在、实际没在判」），
但更危险：它们守的是**其他所有判据的下界**。

### 25.1 S-11 · `ASSERTION_FLOORS` 同族名重复 ⇒ 静默覆盖、永不报错

**缺陷**：`ASSERTION_FLOORS` 是 `new Map([...])` —— **重复 key 后者覆盖前者**，
运行期**完全等价** ⇒ 不会红。于是「同族名只许出现一次」这条纪律**只能靠人守**。

⚠ 历史：本文件**曾经真有两行** `['check:experience', 9]`（值相同），某轮编辑多带的。
⚠ 若两行**值不同**（如 9 和 13），后者的覆盖会让真实下界变成 13 而注释仍写着 9
⇒ 下一次「删掉一条断言」时，判据比人以为的松。

**修法**：新增 `findDuplicateAssertionFloors()`，**解析本文件自己的源码**
（⛔ 不读运行期 Map —— 读 Map 只能看到「覆盖之后」的样子，重复已被抹掉）。
结果**参与判定**（计入 exit 1）。

#### ⚠⚠ 我第一版写了个**会漏检的检测器**

| | 解析条数 | `Map.size` |
|---|---|---|
| 第一版 | **41** | **46** |

漏掉 5 条 —— 它们**带行尾注释**：

```js
['check:client', 51],   // 2026-11-06：项目总代理在设置页两套文案…
['check:hob-create-dom', 31],  // t10 新增 D-18b…
```

而我的正则要求整行以 `],` 结尾 ⇒ 那 5 条一个都没匹配到，**检测器却仍报 `ok: true`**。

⚠ **一个会漏检的检测器比没有检测器更坏**：它给出的是「已检查且没问题」的**假保证**。

**修法**：正则容忍行尾注释 + **自校验「解析数 === `Map.size`」**，不等就报失败。
⛔ 不许把「解析数 ≠ Map.size」当成「格式差异，忽略」。

**验证**：现在 46 = 46。**负向对拍**：注入一行重复 ⇒
`{"ok":false,"dups":[{"name":"check:work-plan","first":55,"second":55}]}`。

---

### 25.2 S-10 · `FAMILY_FLOOR` 有**余量 2** ⇒ 删掉一族仍全绿

**实测**：

| 量 | 实测 |
|---|---|
| `package.json` 的 `check:*` | **50** |
| 其中不进聚合的 | **3**（`check:all` 自身 / `check:preflight` 只体检 / `check:tasks-route-http` 需活宿主） |
| `listFamilies()` 实际 | **47** |
| `FAMILY_FLOOR`（改前） | **45** |
| **余量** | **2** |

⇒ **从 `package.json` 删掉一族（连带脚本文件），`check:all` 仍然全绿 `exit 0`。**

⚠ 这恰恰是本段开头点名的那个盲区（「派生解决了清单会漂，但解决不了**派生源自己少了**」）——
  下界本该堵住它，**却因余量而形同虚设**。

⚠ 同一处注释还写着「**为什么是 20**」而常量已是 45 —— **注释与值差了 25**。

**修法**：

| # | 内容 |
|---|---|
| ① | `FAMILY_FLOOR` 45 → **47**（零余量） |
| ② | 把「为什么是 20」改成**分母说明表**（50 / 3 / 47），并写明「余量无法由族总数做减法得出」 |
| ③ | 补记历史：45→47 的理由 + 那次「余量 2」的具体后果 |

**验证**：删掉 `check:ledgers-route` ⇒ 族数 46 < 下界 47 ⇒ **会红**。恢复后 47 = 47。

---

### 25.3 两条的共同点（值得单独说）

它们守的都是**下界**：S-11 守「下界清单本身不许被静默改写」，S-10 守「族数不许静默缩水」。

⇒ **下界类判据一旦自己有缺口，它保护的所有判据都会跟着失守，而且没有人会发现** ——
  因为「一切正常」和「判据已失效」在输出上长得一模一样。

这也是为什么本轮的 S-11 那条「解析数 ≠ Map.size」必须**报失败**而不是**忽略**：
那正是同一个病的最后一层。

---

### 25.4 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 55 | **57** |
| 未修 | 55 | **53** |
| medium | 23 | **21** |


---

## §26 本轮修 S-12 · 宪法第 9 条只有 3 处断言、0 条分支负控

### 26.1 缺陷本体（已回头实测）

宪法第 9 条「没有读数不能陈述为事实」是本项目最核心的不变量之一。改前它的机检强度：

| 项 | 改前 |
|---|---|
| 断言数 | **3 处**（`ASSERTION_FLOORS` 登记也是 3） |
| 负向对拍 | **1 条**（只验「空归档 ⇒ 退出码 2」） |
| 强制范围 | 只从 **R208** 起（更早 108 份只统计不 FAIL） |
| **判据分支** | **甲/乙/丙 三个分支一个都没被负向验证过** |

⚠ 最后一行的后果最重：**谁把 `INLINE_OUT` 改成恒真，或把「纯注释行不算输出」那条加严改回去，
本族照样全绿，而整条判据已经哑了。**

### 26.2 修法：逐分支正反双向验证

新增 `auditBranchNegctl()`，**直接测 `auditReadings` 纯函数**（⛔ 不依赖 archive 语料 ——
否则会随历史报告增减而变，变成「会自己漂的判据」）。8 条断言：

| # | 分支 | 期望 | 验的是什么 |
|---|---|---|---|
| ① | 甲档 | 放行 | 贴了真实输出 |
| ② | 甲档 | **咬** | **只有注释行**冒充输出（这是加严过的那条，最容易被改回去） |
| ③ | 甲档 | **咬** | 读数命令后什么都没有 |
| ④ | 乙档 | 放行 | 内联给了结果（`→ 3`） |
| ⑤ | 乙档 | 放行 | 内联给了 `EXIT=0` |
| ⑥ | 丙档 | 放行 | 块内显式声明（`（空）`） |
| ⑦ | 丙档 | **咬** | **声明写在块外**（窗口只认块内，这是刻意收窄过的） |
| ⑧ | — | 放行 | 动作命令块（不含读数命令，本条不管） |

⚠ **每条都成对**：只验「该咬的」会漏掉「判据恒红」，只验「该放的」会漏掉「判据恒绿」。

### 26.3 ⚠ 施工中踩的坑：接错了函数

第一版把分支检查插进了 **`selfTest()`**，而 `npm run check:readings` **不带 `--self-test`**
⇒ 走的是另一条路径 ⇒ **代码根本没执行**，我却以为「已经加上了」。

⚠ 发现方式：跑完发现输出里**没有**那行 `判据分支负向对拍` ⇒ 才回头查入口分支。
⇒ 教训：**加完断言要看到它真的打印出来**，不能只看「代码在文件里」。

第二版接进主路径后又发现**退出码没接上** —— 分支失败只打印不影响 `process.exit`。
再补 `branchFails` 计入「没过」处数并驱动退出码。

### 26.4 负向对拍（三档全部实测变红）

| 破坏 | 结果 |
|---|---|
| 去掉「纯注释行」过滤 | `✗ 甲档·该咬（只有注释行冒充输出）不符 —— 期望咬 · 实测 miss=0` |
| `INLINE_OUT` 改恒真 | `✗` **3 条同时红**（甲②、甲③、丙⑦） |
| 声明窗从「块内」放宽到全文 | `✗ 丙档·该咬（声明在块外）不符 —— 期望咬 · 实测 miss=0` |

⚠ 第二档「一条改动红三条」证明这三条不是重复：它们分别锁住不同的放行路径。

### 26.5 另一半：把 `STRICT_FROM` 豁免写进宪法

改前宪法第 9 条只写 `checked_by → check:readings · check:convergence K-2`，
**没说强制范围只从 R208 起**。⇒ 读者会以为它管全部历史报告。

补一句（**照实写、⛔ 不夸大**）：

> （机检只判「读数块可指认」，不判对错；⚠ 强制自 R208 起，更早只统计不 FAIL —— 追改历史即伪造历史。）

⚠ **为什么必须写**：不写就等于让读者以为覆盖面比实际大 —— 而「覆盖面静默缩水」正是本仓反复记的病。

⚠ 施工细节：第一版写了 4 行、宪法涨到 **2055 B**，超了 `check:workflow` F3 的 **2048 B** 上限。
压到 2 行（2025 B）后 33/33 恢复。**「没人会读完的宪法」这个上限是有道理的，说明必须短。**

### 26.6 验证

```
check:readings  查了 4 处 · 过了 4 处   （原 3 处；分支负控 8/8）
check:workflow  33/33   （宪法 2025 B < 2048 B）
check:presets   281/281
其余 11 个 check 族 0 失败 · typecheck exit 0 · build OK
```

下界同步：`ASSERTION_FLOORS` 的 `check:readings` 3→**4**、`meta-negative-floor.json` 1→**2**。

### 26.7 ⚠ 一个**既有**失败（不是本轮引入）

`check:ledger` 的 **I5c** 报「`spec/checkpoint.md` 与生成器不一致」：

```
✗ I5c · spec/checkpoint.md 与生成器不一致（第 1878 个字符起）
```

**核实是本轮之前就有的**：该文件时间戳 `2026-11-10 20:04`，而我最早的改动是 `22:33`。
⚠ 它是**账本区**（`~/.dsh/hob-ledgers/dsh-hob/`）的快照，重生成要跑 `gen:ledger` 写真实账本 ——
⛔ 本轮**不动它**（那是用户的真实数据，且与本次修复无关）。已登记为待办。

### 26.8 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 57 | **58** |
| 未修 | 53 | **52** |
| low | 28 | **27** |


---

## §27 本轮修 S-15 · 兜底唤醒链是死代码，但判定侧仍认为它活着

### 27.1 缺陷本体（已回头核实）

`orchestrator.ts` 里 `fallbackEligible = false` **硬编码**，其后 **41 行全是死代码**：

| 位置 | 内容 | 状态 |
|---|---|---|
| `orchestrator.ts:604` | `const fallbackEligible = false` | 恒假 |
| `:613-643` | 三个 `return` 分支 + 一段「删了 5 分钟门之后靠什么不连叫」的长注释 | **永不可达** |
| `orch-state.ts:2765` | `rearmWakeFallback` | **零可达调用** |
| `orch-state.ts:2851` | `watchNeedsTimer` 第②分支 | **恒真** |

### 27.2 两半危害（缺一都不足以说明为什么必须删）

| # | 危害 | 具体 |
|---|---|---|
| ① | **空转** | `deliverWakeOnce` 成功后 `setWatchState(..., keepWakeAttempts: true)` 回 `waiting` 并保留两枚 `D16` 时刻 ⇒ `watchNeedsTimer` 第②分支恒真 ⇒ **30 秒定时器永远续排**，每轮全账本扫盘 + 逐 owner 读会话日志。而判定侧**永远不会再叫** ⇒ 纯烧 IO |
| ② | **读数说假话** | 原注释、`wakeAttempts`、「叫满 3 次转 stuck」都描述了一个**不可能发生的行为** ⇒ 下一个人会照着它推理 |

### 27.3 修法（REVIEW 的方案 A：删掉兜底）

| 改动 | 内容 |
|---|---|
| 删 | `orchestrator.ts` 的 41 行死代码 + `fallbackEligible` 开关 |
| 改 | `watchNeedsTimer` 只认 `awake`（删掉「叫过之后回 waiting 也武装」的第②分支） |
| 留 | **读数三道闸**（`undecidable` / `still-running` / `active`）—— ⚠ **见下** |

### 27.4 ⚠⚠ 我第一版**删过头了**，`WI-m` 当场红

```
✗ WI-m 读数**判不出**时兜底却叫我（reason=waiting）
  ⇒ ⚠ "判不出"必须落 `undecidable` 且**不叫**（R-10：不许当成"没在跑"）
```

**根因**：我把「兜底要不要叫」和「读数怎么报」当成了一件事，**一起删了**。

⚠ 但 `WI-m` 守的是另一条（`TASK` §六）：「**我派出去的会话还在跑**时看护本来就不该叫」。
那条与兜底**无关** —— 即使不再自动重叫，**读数面也必须如实说「目标还在跑」/「判不出」**，
否则用户看到的是一个笼统的 `waiting`，**分不清「没人应」和「人家正在干」**。

⇒ **删兜底 ≠ 删读数。这是两件事。** 已把三道闸恢复（代码注释里记了这次失误）。

### 27.5 断言写法：必须**剥离注释**再判

第一版 `WI-o` 用 `src.includes('fallbackEligible')` ⇒ **当场假红**：

```
WI-o · `orchestrator.ts` 里又出现了 `fallbackEligible` ⇒ 兜底链被恢复了
```

而我**刚在注释里写了一大段解释「为什么删掉 `fallbackEligible`」** —— 判据把**解释**当成了**代码**。

⇒ 加 `stripComments()`（块注释 + 行注释），只在**代码**上判。

⚠ 这与前几轮的坑同族（WP-12 / WPD-19）：「断言太强」与「实现有 bug」在输出里长得一样。

### 27.6 ⚠ 还有一个位置坑：`ok()` 攒在 `note` 里，**打印点在块之前**

`check-orch-state.mjs` 的 `ok()` 只 `note.push(...)`，而 `note.join()` 在 **16177 行**打印。
我第一版把 `WI-o` 插在 **16206 行** ⇒ **在打印之后才执行** ⇒ 输出里**看不到它**，
而它其实**已经跑了**。

⇒ 教训：**这个族的 `ok()` 不是立即打印**，插入位置必须在 `note.join()` 之前。
⚠ 与 §26 那个「插进 `selfTest()` 所以根本没执行」是同一类：**要看到它真的打印出来**。

### 27.7 验证

```
check:orch  查了 352 处 · 过了 351 处 · 跳过 1 处   （新增 WI-o，原 351）
check:selfwake 3/3 · check:work-state 25/25
check:pipeline 26/26 · check:stage-controls 106/106
typecheck exit 0 · build OK
```

**负向对拍（实测）**：把第②分支加回 `watchNeedsTimer` ⇒

```
WI-o · `watchNeedsTimer` 的代码里又出现了「叫过之后回 waiting 也武装」的分支
⇒ 348/352（3 处红）
```

恢复后 ⇒ 351/352（1 处跳过）。⚠ 「一条改动红 3 处」说明它连带影响了定时器武装判据。

下界同步：`ASSERTION_FLOORS` 的 `check:orch` 351→**352**、meta floor 165→**166**。

### 27.8 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 58 | **59** |
| 未修 | 52 | **51** |
| medium | 21 | **20** |


---

## §28 本轮修 R-21 + 复核 S-16（已修）

### 28.1 S-16 · 元规则 M-1 把被注释掉的负控也算一条 —— **复核确认已修好**

`check-meta-negctl.mjs` 已有完整的**词法扫描**实现（`stripCommentsKeepLines`），
注释换成等量空格（**保留行号与偏移**），单引号 / 双引号 / 模板串 / 正则字面量整段 mask=0。

**实测六种形态**（直接 import `countLabels`）：

| 形态 | 期望 | 实测 |
|---|---|---|
| 真标签 | 1 | **1** ✓ |
| 行注释 `// bad('负向对拍：…')` | 0 | **0** ✓ |
| 块注释 `/* ok(…) */` | 0 | **0** ✓ |
| JSDoc | 0 | **0** ✓ |
| 双引号串里的假调用 | 0 | **0** ✓ |
| 模板串里的假调用 | 0 | **0** ✓ |

且**有负向对拍**（`N-M1d`，实测）：

```
✓ N-M1d 注释掉真对拍 ⇒ 计数必降：把 check:build 的 check-build-sync.mjs:302 那条真对拍注释掉，
  计数 2 -> 1（实测 1 < 下限 2）⇒ M-1 必红
```

⇒ **S-16 已修好**，本轮只做复核，**未改代码**。

---

### 28.2 R-21 · `modeSnapshot` 冻结只有注释没有函数体

**缺陷本体**：`work-plan.ts` 里有一段**带 `@param` / `@returns` 的完整 JSDoc**，
**下面直接接下一个定义** —— 注释描述的函数**从来没有函数体**。

而它宣称「本计划按创建时的快照**推进**」也是**假的**：

```
advanceWorkPlans()  →  orch.dispatch(track.sessionId, track.message, { … })   ← 不传 workMode
                    ⇒  dispatch 落到 workModeOf(exec) 现读**当前档位**
```

⇒ 注释说「冻结驱动推进」，实际是「冻结只影响显示与 `modeSnapshot` 字段」。

#### 修法：**删掉假注释，照实写**（REVIEW 的方案二）

⚠ **不是补一个复验函数** —— 那会造出一个**没人调用的死函数**，正是本条要修的形态。

补写的是「要让它驱动推进，得先回答三个问题」：

| # | 问题 |
|---|---|
| ① | 旧计划用旧档位推进时，**新档位的限制还算不算**（比如从多会话降成单会话）？ |
| ② | 计划跑到一半改档，**已派出的轨怎么办**（按旧档继续？还是按新档收回）？ |
| ③ | 面板该显示哪个档位（当前档？计划档？两个都显示？） |

⚠ 在这三个问题有答案之前，「补实现」只是把一个**假宣称**换成另一个**未设计的真行为**。

#### ⚠ 断言顺带抓出**第二处孤儿注释**

`WM-34` 第一版就红：

```
✗ WM-34 · 发现一段**没有函数体**的 JSDoc：「证据文本归一：全半角折叠（NFKC）…」
```

核实：那段注释**悬空**在 `EVIDENCE_INVISIBLE` 上方，而它描述的其实是 `normalizeEvidenceText`
—— 两段 JSDoc 背靠背，第一段没挂任何东西。

⇒ 把注释**挂回它真正描述的函数**（⛔ 不是删信息）。

### 28.3 断言 WM-34 的写法

只查三件可静态判定的事：

| # | 判据 |
|---|---|
| ① | 找「JSDoc 之后**紧接着**又是 `/**` 或 EOF」的形态 ⇒ 无函数体的孤儿注释 |
| ② | `planModeOf` 必须仍是 `return plan.modeSnapshot ?? plan.mode`（WM-8 的读侧基准） |
| ③ | ⛔ 不许再出现「按计划自己的档位快照复验计划」这种宣称 |

⚠ ①**放行一类**：带 `@deprecated` 且明写「不存在这个函数」的记录性注释 ——
那是**刻意保留的历史说明**，不是疏忽。

### 28.4 验证

```
check:work-plan  查了 56 处 · 过了 56 处   （新增 WM-34，原 55）
check:work-plan-state 17/17 · check:work-plan-dispatch 31/31
check:orch 351/352（1 跳过）· check:meta-negctl 5/5
typecheck exit 0 · build OK
```

**负向对拍（实测）**：插回一段「按快照复验计划」的孤儿 JSDoc ⇒

```
✗ WM-34 · 发现一段没有函数体的 JSDoc：「计划的有效档位：新计划用创建时快照…」
✗ WM-34 · 又出现了「按计划自己的档位快照复验计划」的宣称
```

⇒ 55/56（2 条红）。恢复后 56/56。

下界同步：`ASSERTION_FLOORS` 的 `check:work-plan` 55→**56**、meta floor 2→**7**。

### 28.5 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 59 | **61** |
| 未修 | 51 | **49** |
| medium | 20 | **19** |
| low | 27 | **26** |


---

## §29 本轮修 R-14 + R-24

### 29.1 R-14 · `nextAction` 从未注入 `convergence` ⇒ 最常见状态被判成「判不出」

**病因（不是症状）**：`requirement-chain.ts` 调的是 `nextAction(chainUnits, {})`
⇒ `nextAction` 的第 ③ 步（`converge`）**整段不执行**
⇒「任务都 built 了、但方案还没收口」这个**最常见**状态，全局算法**匹配不上** ⇒ `undecidable`。

**实测**（任务 built + 未判决 ACC）：

```
不注入 convergence: {"kind":"undecidable","target":null}
注入   convergence: {"kind":"converge","target":"CHG-1"}
```

⇒ 注入后「判不出」消失。**补丁治的是症状，病因是注入缺失。**

#### 修法

注入 `convergenceOf`（**唯一实现**，⛔ 不另写判据），并把 `converge` 加进补丁的触发条件：

```ts
next = nextAction(chainUnits, {
  convergence: (chg) => { const r = convergenceOf(chg, units); return { converged: r.converged, blockedBy: r.blockedBy } },
})
```

⚠ `units` 传**全账本**（`convergenceOf` 要按 id 查全账）—— 传链内会让「父方案指向链外任务」判不出。

#### ⚠ 注入后立刻暴露：补丁**仍需要**，但作用变了

```
✗ RC-11 · next.kind="converge"（期望 accept）
✗ RC-11 · next.target="CHG-1"（期望 ACC-1）
```

`converge / target=CHG-…`（「方案还没收口」）**比 `undecidable` 好，但仍不是用户要的** ——
用户要的是「**该验收哪一条 ACC**」。⇒ 把 `converge` 加进补丁条件。

⚠ **不要因为「注入后不该有 undecidable」就把 `undecidable` 从条件里删掉** ——
注入函数本身可能抛错，那时仍需要这层兜底。

#### ⚠ 一次失败的负向对拍（值得记）

我第一版负向是「把 convergence 改成恒 `converged: true`」⇒ **RC-11 仍然绿**。

**为什么**：补丁本身就能兜住（`currentStep===5` + 有 `unverified` ACC ⇒ 补 `accept`）。
⇒ 这说明：**注入是改进，补丁是必要条件**。两者不是替代关系。

⇒ 改用 `RC-16` 专门验**注入存在且来自唯一实现**（⛔ 不复述补丁行为，那是 RC-11 的事）。
负向：删掉注入 ⇒ `✗ RC-16 · 调用点没有传 convergence 回调` + `✗ 没有调用 convergenceOf` ⇒ 19/21。

---

### 29.2 R-24 · `/stages` 的三个字段「取回即弃」——**复核后结论需要更正**

REVIEW 原文说 `next` / `pipelines` / `summary` 三项**都**取回即弃。**实测更正**：

| 字段 | 实际 | 结论 |
|---|---|---|
| `next` | ✅ **有完整读取+渲染**（`:2016` 取出 → `:3045-3069` 渲染成 `stages-next` 块，含阻断原因） | **不是缺陷** |
| `pipelines` | ❌ 零读取 | ⚠ 但与 `/requirement-chains` 的 `chain.pipeline` **同源**（都是 `pipelineViewsOf(units)`）⇒ **等价重复下发** |
| `summary` | ❌ 零读取 | ⚠ 服务端**已声明退役**（`stages-index.ts:186-193` 明写「字段保留是为了不破坏旧消费者」） |

⇒ **真正的缺陷只有「存了不用却没有任何说明」这一件事**，不是「三个字段都是死代码」。

#### 修法：**标注清楚，⛔ 不删字段**

在客户端存储点写一张三行表（每个字段的读取点状态 + 为什么保留）。

⚠ **为什么不删**：它们是**线格式**的一部分，删了会破坏旧消费者；
而「保留但标注清楚」正是服务端注释已经采取的做法 —— 客户端侧照抄同一口径。
⛔ **不要为了「消掉未读取」而删字段**：那是把兼容性当洁癖。

#### 断言 S-R24（两条都要成立）

| # | 判据 |
|---|---|
| ① | `pipelines`/`summary` 的存储点附近**必须有 R-24 标注** |
| ② | `next` **必须真有读取点 + 渲染点**（⛔ 不许被一起当成「没用的」删掉） |

**负向对拍（实测）**：删掉标注 ⇒ `✗ S-R24 · 存储点附近没有 R-24 标注 ⇒ 下一个人会以为「存了不用」是遗漏` ⇒ 137/138。

---

### 29.3 验证

```
check:requirement-chains 20/20   （新增 RC-16，原 19）
check:stages-dom        138/138  （新增 S-R24，原 137）
check:pipeline 26/26 · check:stage-controls 106/106 · check:convergence 35/36（1 跳过）
check:presets 281/281 · check:meta-negctl 5/5
typecheck exit 0 · build OK
```

⚠ `check:ledger` **126/129** —— 那是 §26.7 记的**既有** `I5c`（`checkpoint.md` 时间戳 20:04，早于本轮），**不是本轮引入**。

### 29.4 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 61 | **63** |
| 未修 | 49 | **47** |
| medium | 19 | **17** |


---

## §30 本轮修 R-23 + R-25

### 30.1 R-23 · 高风险评审用**声明值**还是**推导值**？两处结论相反

**实测分叉**（声明 `high` / 事实推导 `low`，无评审者、无证据）：

| 判据 | 用哪个 tier | 结果 |
|---|---|---|
| `stage-controls` C-15 | **声明值** `u.risk_tier` | **2 条**（缺评审者 / 缺证据） |
| `risk-policy` RP-4/RP-5 | **推导值** `derived.tier` | **0 条** |

⚠ **松的那一处正好是「用户自己声明高风险」的情形** ——
「我声明这是 high」却按 low 要求评审，等于把用户的保守声明当成噪音。

#### 根因（比 REVIEW 描述的更具体）

`riskAssessmentProblems` 在 `:416` 传的是 `declaredTier: undefined` ⇒ 拿到**纯推导值**。
但 `riskAssessmentOf` 自己的 `tier` 是 `maxTier(derivedTier, declaredTier)`
——「**声明的档位只能更保守，不能更松**」。

⇒ RP-4/RP-5 用了**比实际档位更松**的那个值。

#### 修法：分开命名，⛔ 不合并

```ts
const effectiveTier = isRiskTier(declared) && tierAtLeast(declared, derived.tier) ? declared : derived.tier
```

⚠ **为什么不直接把 `derived` 换成含 declared 的**：
RP-2 的「声明不得低于推导」必须继续用**纯推导值** —— 否则声明 `low` 时会拿 low 跟 low 比 ⇒ **恒真**。
⇒ 两个值各有各的用途，**分开命名**。

**验证（四档全一致）**：

```
declared=low      | C-15=0 | RP-4/5=0 | 一致? true
declared=medium   | C-15=0 | RP-4/5=0 | 一致? true
declared=high     | C-15=2 | RP-4/5=2 | 一致? true
declared=critical | C-15=3 | RP-4/5=3 | 一致? true
```

---

### 30.2 R-25 · 同一 handoff 两套清账判据 ——**结论需要更正**

REVIEW 说这是「两套判据」。**实测复核后要分开看**：

| 位置 | 场景 | 能用的判据 |
|---|---|---|
| `write-delivery.ts:264` | **写文件后派发** —— 知道是哪个文件 | `h.ref === input.ref`（精确） |
| `orchestrator.ts:5758` | **派发** —— 只知道派给谁、什么时候 | 改前用时间窗（无 ref 可用） |

⇒ **不是「两套判据」,是「两个不同场景」**。但由此暴露了**真正的缺陷**：

> `orchestrator.ts` 的 `return h.at <= w.at` 会**误清别人刚写的、还没投递的记录**。

**具体场景**：同一工作区里，

```
A 写了 archive/x/TASK-A.md（at 较早、还没投递）
B 此刻投递成功（w.at 较晚）
  ⇒ A 那条被 B 的成功投递清掉 ⇒ 真漏派被抹掉
```

⚠ 而「抹掉真漏派」正是本仓最忌的失败形态（`写盘失败` 与 `没有待投递` 长得一样）。

#### 修法：`task-file` 本处不清，交给知道 `ref` 的那条路

```ts
const cleared = clearHandoffs(file, (h) => {
  if (h.wsRoot !== undefined && ws !== undefined && h.wsRoot !== ws) return false
  if (h.kind === 'spawned-session') return h.ref === resolvedTarget
  return false          // ← task-file 由 write-delivery / bus 自己清
})
```

⚠ **保守方向**：宁可少清（多报一条待投递 = 多一句提示，无害），**不清错**。

---

### 30.3 ⚠ 又踩了同一个坑：注释被当成代码

`WI-p` 第一版用 `orch.includes('h.at <= w.at')` ⇒ **当场假红** ——
而我**刚在注释里写了一大段「为什么不能按时间窗清」**，里面逐字包含那个表达式。

⇒ 加 `stripComments`（**与 §27 的 `WI-o` 是同一个坑**，那里的词是 `fallbackEligible`）。

⚠ **这已经是第三次**（WP-12 / WPD-19 / WI-o / 现在 WI-p）。
⇒ **纪律：凡「扫源码找某写法」的断言，一律先剥注释。**

### 30.4 ⚠ 还有位置坑（第二次）

`check-orch-state.mjs` 的 `ok()` 只 `note.push()`，而 `note.join()` 在 **16220 行**打印。
我把 `WI-p` 插在 **16292 行** ⇒ 执行了但**打印不出来**。

⚠ 与 §27 完全一样的位置坑。⇒ 已移到打印点之前。

### 30.5 验证

```
check:risk-policy  26/26   （新增 RP-24，原 25）
check:orch        352/353（1 跳过）   （新增 WI-p，原 352）
check:stage-controls 106/106 · check:pipeline 26/26
check:effects 14/14 · check:redeliver 10/10 · check:meta-negctl 5/5
typecheck exit 0 · build OK
```

**负向对拍（实测）**：

| 断言 | 负向操作 | 结果 |
|---|---|---|
| RP-24 | 评审要求改回纯推导值 | `✗` 3 条红（high / critical 两处相反 + 恒不报） |
| WI-p | `return false` 改回 `return h.at <= w.at` | `✗ orchestrator.ts 又按时间窗清 task-file 了` |

下界同步：`check:risk-policy` 25→**26**、`check:orch` 352→**353**；
meta floor：`risk-policy` 14→**18**、`orch` 166→**167**。

### 30.6 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 63 | **65** |
| 未修 | 47 | **45** |
| medium | 17 | **16** |
| low | 26 | **25** |


---

## §31 本轮修 R-26 · 客户端路由字符串的唯一来源

### 31.1 缺陷本体（比 REVIEW 描述的更广）

REVIEW 只点了 `work-plans` 一条。**实测发现 `work-plans` 那处已经修好了**
（`project-panel.tsx:57` 已 import `WORK_PLANS_ROUTE_PATH`）——
**但同类问题在别处更严重**：

| 路由 | 改前份数 | 位置 |
|---|---|---|
| `/api/dsh-hob/session-policy` | **3 份** | `create-hob-dialog.tsx` 的常量 + `hob-unselected-gate.tsx` 的**两处内联** |
| `/api/dsh-hob/ledger-resource` | 2 份 | `current-panel.tsx` + `project-panel.tsx`（**两个不同的导出名**） |
| `stages` / `tasks-progress` / `requirement-chains` / `ledgers` | 各 1 份（在 `project-panel`） | 正常 |

⚠ **`session-policy` 那 3 份是真隐患**：服务端改一次路径，客户端三处都要改，
漏一处就是「**这个路径没有处理体**」——而那种失败**看起来像数据问题（HTTP 404）**，
不像接线问题。这正是本仓反复记的病。

⚠ 而 `ledger-resource` 那份更隐蔽：两个文件各导出**同名不同源**的常量，
将来只改一处 ⇒ 另一个面板静默读旧路径。

### 31.2 修法：新建 `src/client/routes.ts` 作为唯一来源

| 内容 | 说明 |
|---|---|
| 8 个路径常量 | `SESSION_CREATE` / `SESSION_POLICY` / `STAGES` / `TASKS_PROGRESS` / `REQUIREMENT_CHAINS` / `LEDGERS` / `LEDGER_RESOURCE` / `WORK_PLANS` |
| **⛔ 不放取数函数** | 取数要带 `credentials` / 错误分支 / `StaleRouteError`，各面板语义不同；强行合并会把三种失败翻译成同一种 |

**改造点**（7 处）：

| 文件 | 改动 |
|---|---|
| `hob-unselected-gate.tsx` | 2 处内联 → `SESSION_POLICY_PATH` |
| `create-hob-dialog.tsx` | 2 个本地常量 → 引用共享模块 |
| `project-panel.tsx` | 5 个本地常量 → 引用共享模块 |
| `work-plan-panel.tsx` | 1 个 → 引用共享模块 |
| `current-panel.tsx` | 1 个 → 引用共享模块（**解决了同名不同源**） |

**结果**：`grep -rc "'/api/dsh-hob/" src/client/` ⇒ **只剩 `routes.ts` 一处（8 条）**。

### 31.3 ⚠ 断言里的两个坑（都是重演）

**坑 ①（第四次）**：注释被当成代码。

`routes.ts` 之外的注释里大量引用路由名（如「数据源：`POST /api/dsh-hob/ledger-resource`」）⇒
直接 `includes` 会假红。⇒ 加 `stripComments`。

⚠ 这已是 **WP-12 / WPD-19 / WI-o / WI-p / 现在 R-26** 第五次。
⇒ **纪律（写进本节，下次直接查）：凡「扫源码找某写法」的断言，一律先剥注释。**

**坑 ②（第三次）：脚本崩溃但输出为空，看起来像「断言没跑」。**

```
ReferenceError: relative is not defined
    at walk (check-stages-panel-dom.mjs:5784)
```

我漏了 `import { relative } from 'node:path'`。
⚠ **症状是「grep 不到输出」**，而不是一条红 —— 与 §26「插进 `selfTest()` 所以没执行」、
§27「插在打印点之后所以看不到」是**同一类观测失败**。

⇒ **纪律：断言没输出时，先看脚本有没有崩（`tail` 完整输出），不要先怀疑断言。**

### 31.4 验证

```
check:stages-dom  139/139   （新增 R-26，原 138）
check:stages-route 36/36 · check:client 51/51
check:hob-create 54/54 · check:hob-create-dom 31/31
check:meta-negctl 5/5 · check:pipeline 26/26
typecheck exit 0 · build OK
```

**负向对拍（实测）**：把 `current-panel.tsx` 改回内联字面量 ⇒

```
✗ R-26 · 这些文件里还有内联路由字面量（应改为从 `routes.ts` 引入）：src/client/current-panel.tsx
S 组：通过 138 · 失败 1
```

恢复后 ⇒ 139/0。

下界同步：`check:stages-dom` 137→**139**；meta floor 83→**95**
（⚠ 83 **落后实测 12 条** —— 这正是 §25 记过的「下界低到守不住」）。

### 31.5 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 65 | **66** |
| 未修 | 45 | **44** |
| low | 25 | **24** |


---

## §32 本轮修 S-09 · `/stages` 线格式的 `as any` 从 18 降到 4

### 32.1 缺陷本体

`project-panel.tsx` 的 `stageState` 类型**只声明 3 个字段**，而写入时实际放 **10 个**：

```ts
| { kind: 'ok'; stages: any[]; caps: any[]; pipelines?: any[] }   ← 声明
setStageState({ kind:'ok', stages, caps, pipelines, next, portfolio,
                attention, summary, truncated, relations, stageHealth } as any)   ← 实际
```

⇒ 服务端改字段名时 **TypeScript 全绿**，面板静默显示「判不出」。

⚠ **它比看上去重要**：`as any` 是 `T-09`（取回即弃）与 `R-24`（存了不用）的**藏身之处** ——
用真类型后，编辑器会直接标出「声明了但未使用」。

### 32.2 修法

| # | 改动 |
|---|---|
| ① | `import type { StagesOk }`（⚠ 只 import type，不引入运行期依赖） |
| ② | state 类型改成 `({ kind: 'ok' } & Omit<StagesOk, 'ok'>)` |
| ③ | 写入点去掉 7 处 `as any`（`res.portfolio` 等直接取） |
| ④ | 读取点去掉 7 处 `as any`（`stageState.next` 等直接取） |

⚠ **为什么用 `Omit<StagesOk, 'ok'>` 而不是直接用 `StagesOk`**：
本 state 用 `kind: 'ok'` 表达成功，而线格式用 `ok: true` —— 两个判别式**不能混用**
（混了会让 `kind === 'ok'` 与 `ok === true` 各判一半，正是「同一事实两份来源」）。

**结果**：`as any` **18 → 4**，剩余 4 处全是宿主访问（`globalThis as any`）与第三方组件转型，
与 `/stages` 线格式无关。⛔ **不要为了「数字好看」去动它们。**

### 32.3 ⚠⚠ 负向对拍我试了**三次**才成立（每次都是同一个病）

| 尝试 | 做法 | 结果 |
|---|---|---|
| 1 | 判「文件里有没有 `Omit<StagesOk,'ok'>`」 | **假绿** —— 我把这句话也写进了**注释** |
| 2 | 锚定 `useState` 声明 + 600 字符窗口 | **仍假绿** —— 注释在声明**上方**，被窗口框进去了 |
| 3 | **先剥注释**再取 400 字符窗口 | ✅ **真红** |

```
✗ S-S09 · state 的 **useState 声明**没有引用 `StagesOk` ⇒ 又变回本地手抄字段（注释里写了不算）
```

⚠ **这已是本仓第 6 次踩「注释被当成代码」**（WP-12 / WPD-19 / WI-o / WI-p / R-26 / S-09）。
⇒ 教训升级：**不是「记得剥注释」，而是「凡扫源码的断言，先写 `stripComments` 再写判据」** ——
  把它当成模板的第一步，而不是每次想起来才加。

⚠ 更值得记的是**第 1 次的失败方式**：断言**通过了**，我差点以为「负向对拍不需要做」。
⇒ **负向对拍没红时，先怀疑断言太弱，不要先怀疑实现是对的。**

### 32.4 ⚠ 顺带修了一处断言耦合

`S-R24` 原来判 `src.includes('(stageState as any).next')` ⇒ **S-09 改完后它当场红**：

```
✗ S-R24 · `next` 没有读取点 ⇒ 项目级「下一步」在界面上消失了
```

⚠ **实际上 `next` 好好的**，只是写法从 `(stageState as any).next` 变成了 `stageState.next`。
⇒ 判据改成**接受两种写法**（正则 `\(stageState as any\)\.next|stageState\.next\b`）。

⚠ 这暴露一类通病：**断言写死实现细节**，实现一改就假红。
⇒ 写断言时问一句：「这条判的是**行为**还是**写法**？」判行为就别锚写法。

### 32.5 验证

```
check:stages-dom  140/140   （新增 S-S09，原 139）
check:stages-route 36/36 · check:client 51/51
check:pipeline 26/26 · check:stage-controls 106/106 · check:meta-negctl 5/5
typecheck exit 0 · build OK
```

下界同步：`check:stages-dom` 139→**140**；meta floor 95→**96**。

### 32.6 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 66 | **67** |
| 未修 | 44 | **43** |
| medium | 16 | **15** |


---

## §33 本轮修 O-28 + O-29 · 文档指向不存在的实体

### 33.1 先做了一件更重要的事：**把剩余清单算准**

前几轮我一直在「按印象挑条目」，因为 `FIX-RESULT` §5.3 只有**分类估算**（「死代码 ~8 / 文案 ~10 / …」），
**没有逐条编号** ⇒ 无法据此施工。本轮先补这一步。

把 `REVIEW.md` 两处编号源合并（§4 各节的 `#### X-NN` + 天表的 `| **X-NN** |`）得到 **111 条**，
与已修清单做差集。

⚠⚠ **结果与文档记录不符，且是文档错了**：

| 来源 | blocker | high | medium | low | 合计 |
|---|---|---|---|---|---|
| `FIX-RESULT` §5.1 声称 | 3 | 1 | 15 | 24 | **43** |
| 本轮实算 | 3 | 3 | 21 | 27 | **54** |

⚠ 差额来自**几条实际已修但没记账的**（如 `T-07` 的 `partial` 机制、`R-06` 的解析器统一 ——
实测代码里都在）。⇒ **§5.1 的 43 是低报的**，真实剩余更多。

⚠ 这也是「已修 67」这个数**不可全信**的旁证：**记账与代码不同步**。
⇒ 已在本轮记入待办：**下次施工前先逐条复核 §5.1 的 43 条**，而不是继续累加。

---

### 33.2 O-28 · README 用了术语表明令禁止的「记录区」

`TERMINOLOGY.md:44` 写：正式账本「**不称**文档堆、**记录区**或缓存」。
而 `README.md` 全篇用了 **9 次**（REVIEW 记的是 7 次，**实测更多**）。

**修法**：统一改成术语表规定的「项目账本」/「账本父目录」。

⚠ **有一处刻意不动**：`:172` 那句「原文写『它不写 `~/.dsh/**`（有显式拒绝路径）』」——
那是**引用旧文本**作证据，改掉就毁了更正的可追溯性。✅ 实测确认该句**不含**「记录区」三字，无需特殊处理。

---

### 33.3 O-29 · `kit/drafts` 指向不存在的 `.hob/drafts/preset-contracts.md`

| 文件 | 处数 | 处理 |
|---|---|---|
| `contract-verification-notes.md` | 2 | 改成 `kit/drafts/preset-contracts.md` |
| `growth-registry.md` | 1 处路径 + 2 处字节数 | 路径改对；`56754` → **`65421`**（实测当前大小） |

⚠⚠ **`restructure-plan.md` 里还有 3 处同类路径，本轮刻意不改**：
该文件头部自带「**【历史方案 · 现状已变】**」横幅，它的旧路径是**证据**。
改掉 = 伪造历史（与「记录层写一次固定」的纪律直接冲突）。

⇒ 断言用**显式清单**只查两份活规矩层文档，并在注释里写明豁免理由。

---

### 33.4 ⚠⚠ 断言施工踩了**四个**坑（都是老坑重演）

| # | 坑 | 表现 | 教训 |
|---|---|---|---|
| ① | 插进了**库模块** | `ReferenceError: ok is not defined` —— `check-doc-shape.mjs` 是库，没有全局 `ok`/`bad` | 先确认目标文件**有没有断言通道** |
| ② | 插进了**子函数作用域** | `✗ 读不到 kit/drafts/… ⇒ 失去基准` —— 那里 `root` 不可见 | 先确认插入点在**顶层作用域** |
| ③ | 用了**未导入的 `join`** | 同上症状（`join` 在该文件是 `pjoin`） | 先确认别名 |
| ④ | 插在 **`note` 打印点之后** | 断言**跑了但看不到输出** | ⚠ **第四次**（§26/§27/§31 各一次） |

⚠ **①②③ 的症状完全相同**：`✗ 读不到 X ⇒ 失去基准`。
⇒ 那句话是**断言自己写的**，它分不清「文件真不在」和「我拿不到路径」。

⚠ **改进**：这类「失去基准」的提示应当**带上实际解析出的绝对路径**，
否则排查成本全落在人身上。（本轮未改，记为待办。）

---

### 33.5 验证

```
check:gitignore  1199/1193（6 处为既有文档超限，非本轮引入）
check:presets 281/281 · check:pipeline 26/26 · check:stages-dom 140/140
check:meta-negctl 5/5 · typecheck exit 0 · build OK
```

**负向对拍（实测）**：把「记录区」塞回 README ⇒

```
✗ O-29/O-28 · README 用了 1 次「记录区」—— TERMINOLOGY.md:44 明令正式账本「不称文档堆、记录区或缓存」
```

恢复后 ⇒ `✓`。

下界同步：`check:gitignore` 1193→**1199**；meta floor 7→**11**。

### 33.6 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 67 | **69** |
| 未修（按 §5.1 口径） | 43 | **41** |
| ⚠ 实算剩余 | 54 | **52** |


---
