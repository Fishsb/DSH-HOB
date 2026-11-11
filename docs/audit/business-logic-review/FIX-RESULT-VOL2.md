# FIX-RESULT 分卷 2 · §34–§49

> ⚠ 本文件是 `FIX-RESULT.md` 的**分卷**（原文件超过 64KB 读上限，按 `check:gitignore` 的
> M 判据处置：**整块搬走 + 原位留指针**，⛔ 不是压缩）。
> 主文件：`docs/audit/business-logic-review/FIX-RESULT.md`（§1–§21 + 指针表）。
> ⚠ 分卷只搬**历史章节**；**结论与逐条账仍在主文件**。

---
## §34 逐条复核：账目对齐（**这一步比再修两条更重要**）

### 34.1 为什么必须做

前几轮我按印象挑条目施工，而 `FIX-RESULT` 的剩余清单只有**分类估算**（「死代码 ~8 / 文案 ~10」），
**没有逐条编号**。⇒ 我给出的「还剩 43 条」**无法被核对**。

本轮把 `REVIEW.md` 的**两处编号源**合并，逐条与代码现状比对。

### 34.2 ⚠⚠ 复核结果：此前三个数字**都不准**

| 口径 | 此前声称 | 本轮实算 | 差 |
|---|---|---|---|
| 缺陷总数 | 112 | **111** | −1（`C-01` 在表里出现两次） |
| 已修 | 69 | **58** | **−11** |
| 已排除 | 2 | 2 | ✓ |
| 剩余 | 41 | **53** | **+12** |

⚠ **「已修 69」是虚高的**，成因有两个：

| # | 成因 | 说明 |
|---|---|---|
| ① | **把「已排除」算进「已修」** | `S-08` / `C-01` 是**复核证伪**，不是修好的 |
| ② | **同一编号在多个 § 里被重复计数** | 每次写小结都加一次，越到后面越偏 |

⚠ 这正是本仓反复记的病：**「记账」与「实际」是两个来源**，而我没让它们对过账。

### 34.3 本轮**核实确认已修**但此前没记账的 7 条

| 编号 | 证据 |
|---|---|
| **R-06** | 解析器只剩 `parseUnitsToml` 一份（`stages-index.ts:233`），严格/宽松双实现已合并 |
| **R-27** | `README.md:132` 已写「空串 = 判不出，不是派生（B4.4 更正）」 |
| **R-29** | `README.md:172` 已写「那个『显式拒绝路径』在代码里不存在」 |
| **T-07** | `projection-writer.ts` 已有 `partial` 半完成回带（5 处） |
| **T-18** | `README.md:168` 已写「跨实例投递已整族退场」 |
| **T-19** | `README.md:222` 已写「`check:build` 有五个面」（B4.4 更正） |
| **T-20** | `README.md` 残留清单已写「5 类」并标注更正 |

⚠ 这 7 条**代码/文档里早就是对的**，只是从没进过 FIX-RESULT 的已修清单 ——
⇒ 说明**前几轮的记账是漏的，不是修的少**。

### 34.4 权威剩余清单（**53 条，逐条编号**）

| 等级 | 条数 | 编号 |
|---|---|---|
| **blocker** | **0** | ✅ 全部已修（12 条） |
| **high** | **0** | ✅ 全部已修（26 条） |
| medium | **4** | O-21 O-27 R-09 S-03 |
| low | **7** | O-15 O-20 R-16 R-17 S-14 T-12 T-17 |

⚠⚠ **最重要的结论：blocker 与 high 已经清零。**
此前文档一直说「剩 3 blocker + 1 high，卡决策」—— **那个说法是错的**。
实测 `R-01`（影子判据）、`R-02`（五份实现 → `stageCompletionOf`）、`T-03`、`R-12` 都已有实现落地。

⇒ **「四个决策卡住 4 条」这件事不存在。** 剩余 53 条**全部是 medium / low**，
即：**没有一条是「必须用户拍板才能动」的**。

### 34.5 这 53 条的构成（按能否独立施工）

| 类别 | 条数 | 能否直接修 |
|---|---|---|
| O 组（杂项） | 22 | ✅ 多数是「注释与事实不符」「死代码」「两份来源」 |
| R 组（口径分叉残留） | 8 | ✅ 同族，可用同一手法 |
| S 组（自比自证残留） | 2 | ✅ |
| T 组（出口分裂残留） | 3 | ✅ |

⚠ 与 §33 的判断不同：**没有一条需要用户决策**。

### 34.6 已修 58 条的分布（供核对）

⚠⚠ **口径先说清**：`S-08` 与 `C-01` **不在这 111 条清单里**（实测 `all.has('S-08')` = `false`）。",
它们是**审计过程中被复核证伪**的额外条目 ⇒ 单独记「已排除 2」，**不参与 111 的算术**。

| 等级 | 总数 | 已修 | 剩余 |
|---|---|---|---|
| blocker | 12 | **12** | **0** |
| high | 26 | **26** | **0** |
| medium | 40 | **18** | **22** |
| low | 33 | **2** | **31** |
| **合计** | **111** | **58** | **53** |

✅ **校验：58 + 53 = 111。**

⚠ **此前文档写「已修 69 / 剩余 41」是错的**，成因见 §34.2：
把「已排除」算进「已修」+ 同一编号在多个小结里被重复累加。

### 34.7 下一步

**从 53 条里按「同族批量」施工**，优先级：

| 批次 | 条目 | 理由 |
|---|---|---|
| 1 | `R-07` / `R-11` / `R-14` / `R-20` / `R-24` | R 组残留，与已修的 R-02/R-13 同族，手法已验证 |
| 2 | `O-37` ~ `O-43` | 编号连续，很可能是同一轮审计的同一类问题 |
| 3 | `T-12` / `T-17` | T 组残留 |
| 4 | 其余 O 组 | 逐条 |


---

## §35 本轮修 R-11 · 体检的账本根判据与运行时相反

### 35.1 缺陷本体（已回头实测）

同一件事**三处口径**：

| 位置 | 对「未配 `ledgerHome`」的处理 |
|---|---|
| `doc-read.ts:139-146` | 返回 **`undefined`**（fail-closed，⛔ 不猜） |
| `preflight.mjs:50-51`（改前） | **仍派生** `<工作区父目录>/.hob-ledgers/<工作区名>/` |
| `README.md`（已更正） | 空串 = 判不出 |

⇒ **照 README 配的人会得到「账本落点判不出」的拒绝，而体检说「记录区在位」。**

### 35.2 为什么体检必须跟着收严（⛔ 不是「体检可以宽松点」）

体检的作用是**在动手前告诉你缺什么**。它若按一条**运行时不存在的规则**报「在位」，
那不是「宽松」，是**给了一个假保证** —— 与「跳过不计入通过」是同一条纪律。

⚠ **代价照实记**：本仓历史上确实用过兄弟目录，**存量工作区可能真在那儿**。
⇒ 不静默删掉那一档，而是**把它降为提示**（`how: 'legacy-sibling'`），在体检行里明说
「这是历史布局，运行时不认，请显式配 `ledgerHome`」。⛔ 不许把它当 `present: true`。

### 35.3 修法

| # | 改动 |
|---|---|
| ① | 删掉「兄弟目录 ⇒ `how: 'preset'`」那一档 |
| ② | 历史布局单列 `how: 'legacy-sibling'`，体检行**明说运行时不认** |
| ③ | `present` **只认 `preset`** |
| ④ | `dir` 在 missing 时给「本该在哪」的示意（预设父目录 + 工作区名），⛔ 不再给兄弟目录 |

### 35.4 ⚠ 又踩了两次老坑

**坑 ①（第六次）：模板串里的反引号。**

```
SyntaxError: Unexpected identifier 'resolveLedgerRoot'
```
我在体检文案里写了 `` `resolveLedgerRoot` `` ⇒ 提前闭合模板串。⇒ 改单引号拼接。

**坑 ②（第五次）：插在 `note` 打印点之后。**

`check-config-face.mjs` 的 `ok()` 只 `note.push()`，而 `note.join()` 在 **2116 行**打印；
我把 R-11 插在 **2122 行** ⇒ 断言跑了但**看不到输出**。

⚠ **这已是第 5 次**（§26 `selfTest()` / §27 打印点 / §31 脚本崩溃 / §33 库模块+作用域 / 现在）。
⇒ **纪律（升级为硬规矩）：新增断言后，必须先 `grep` 该族的输出通道，确认它真的会打印。**

### 35.5 验证

```
check:config  64/64   （新增 R-11，原 63）
check:preflight —— 体检族，无「查了/过了」计数（恒 exit 0）
check:pipeline 26/26 · check:stage-controls 106/106 · check:stages-dom 140/140
check:meta-negctl 5/5 · typecheck exit 0 · build OK
```

**负向对拍（实测）**：把 `legacy-sibling` 改回 `'preset'` ⇒

```
✗ R-11 · `preflight` 把兄弟目录返回成 `how: 'preset'` ⇒ 体检会说「在位」而运行时判不出
```

⇒ 63/64。恢复后 64/64。

下界同步：`check:config` 63→**64**；meta floor 5→**7**。

### 35.6 累计（按 §34 校正后的权威口径）

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 58 | **59** |
| 剩余 | 53 | **52** |
| 其中 medium | 22 | **21** |

✅ 校验：59 + 52 = 111。


---

## §36 复核补记：R-07 / R-14 / R-20 / R-24 **四条已修**（此前漏记）

### 36.1 本轮做了什么

按 §34 立的规矩（**先复核再施工**），把第 1 批 R 组残留逐条回源验证。结果：

| 编号 | REVIEW 说的 | 实测 | 结论 |
|---|---|---|---|
| **R-07** | 三条读盘实现，失败语义各不相同 | 两处实现**都**区分 `ENOENT`（还没开账）与其它（读不出来） | ✅ **已修** |
| **R-14** | `nextAction` 与 `activeStage` 两个独立算法 | `requirement-chain.ts:492` **已注入 `convergence`** | ✅ **已修** |
| **R-20** | `ledgers-route` 用行计数冒充单元数 | `:121` 已是 `parsedUnits.filter(isPipelineV3).length` | ✅ **已修** |
| **R-24** | `/stages` 三个字段取回即弃 | `next`/`portfolio`/`relations`/`truncated` **全有读取点** + R-24 标注 | ✅ **已修** |

⚠ **这四条我此前都记成「未修」** —— 与 §34 发现的「记账比实际落后」是同一个问题。

### 36.2 R-07 的实质澄清（值得单独说）

REVIEW 说「**三条**实现」，实测**两条**（`requirement-chains-route.ts:41` / `tools.ts:206`）。
而且它们的**失败语义已经一致**：

| 场景 | 两处各自的处理 |
|---|---|
| 目录不存在（`ENOENT`） | 都判 **「还没开账」**（`STAGES_REASON_LEDGER_MISSING`） |
| 其它错误（`EACCES` / `EISDIR`…） | 都判 **「读不出来」**（`STAGES_REASON_INDEX_UNREADABLE`） |

**唯一差异是返回方式**：一处返回 `{units, error}`，一处抛 `LedgerUnitsReadError`。
⚠ 这是**调用方形态不同**（路由要序列化给 HTTP；工具要 throw 给上层 catch），
⛔ **不是「两套口径」**。

⇒ REVIEW 那条判据「同一本坏账，三条路由的 `reason` 必须同值」**已成立**（`reason` 同值，只是携带方式不同）。

### 36.3 ⚠ 一个反复出现的模式（值得写进纪律）

这是**连续第二轮**发现「文档说未修、实际已修」：

| 轮次 | 发现 |
|---|---|
| §34 | 账目总数/已修/剩余三个数全错 |
| §36 | 第 1 批 R 组残留 **4 条全部已修** |

⇒ **根因**：`FIX-RESULT` 的进度是**按轮累加**的，
而「已修」的事实来自**代码**。两者**从未做过一次全量对账**。

⚠ **已修的真值判定标准**（本轮确立，供后续沿用）：

> 一条缺陷算「已修」，当且仅当：
> ① **代码里能指到那处改动**（文件:行号）；
> ② **有一条断言钉住它**（`grep` 得到编号）；
> ③ **负向对拍能让它变红**（实测或已有记录）。

⚠ 只满足 ① 不算 —— 那是「改了但守不住」（本仓反复记的形态）。
⚠ 满足 ①③ 但缺 ② 的（如 `R-18` 本轮补的 LP-14），本轮按「已修」计，但**必须补断言**。

### 36.4 累计（§34 校正后的权威口径）

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 59 | **63** |
| 剩余 | 52 | **48** |
| 其中 medium | 21 | **17** |

✅ 校验：63 + 48 = 111。

⚠ 本轮**未改任何源码**（只做复核与记账）。


---

## §37 本轮修 O-40 · 档位枚举的第三份手写字面量

### 37.1 缺陷本体

同一组档位在**三处**各自写了一份：

| 位置 | 形态 |
|---|---|
| `permission-levels.ts:10` | `PERMISSION_LEVELS = ['ledger','project','workspace']` |
| `read-level-policy.ts:61` | `OPEN_READ_LEVELS = ['ledger','project','workspace']` |
| **`bus.ts:2039`** | `enum: ['ledger','project','workspace']` ← **手写** |

⚠ **三份同时正确只是当下巧合**。而 `enum` 是**建会话的入参契约** ——
漏改一处就是「模型能选、服务端拒」或反之，**两种都是静默失败**。

⚠ 注意 `R-22`（上一批修的）只改了**描述文案**，让它从 `OPEN_READ_LEVELS` 派生；
**`enum` 数组本身仍是手写** —— 这两件事看起来像同一处，其实是两个字段。

### 37.2 修法：选**语义最近**的常量，⛔ 不因「现在值相同」随便挑

```ts
enum: [...OPEN_READ_LEVELS],   // ⛔ 不是 PERMISSION_LEVELS
```

⚠ **为什么是 `OPEN_READ_LEVELS` 而不是 `PERMISSION_LEVELS`**：
本字段是「**读**开放面」（决定这个会话能读哪些路径），语义上就是读面；
`PERMISSION_LEVELS` 是更宽的权限枚举。**两者将来可能分叉**（读面窄于权限面是正常的），
⇒ 选语义最近的那个，否则将来分叉时会**改错地方**。

### 37.3 ⚠ 施工踩了三个坑（第 3/4/7 次重演）

| # | 坑 | 表现 | 累计 |
|---|---|---|---|
| ① | 用**未导入**的 `readFileSync` | `ReferenceError` | **第 3 次** |
| ② | 用**未导入**的 `join` | 同上 | 同次 |
| ③ | 变量名大小写（`root` vs **`ROOT`**） | `ReferenceError: root is not defined` | 新坑 |
| ④ | 断言缺「**负向对拍**」标签 | `M-1 · 实测 2 < 下限 3` | **第 2 次** |

⚠ **①②③ 的症状都是 `ReferenceError`**，而 `check:modules` 是**跑到最后才崩** ——
前面 16 条 `PASS` 都正常打印，**看起来像「已经全过了」**。
⇒ 与 §31「脚本崩溃但输出为空」同类：**必须看 `tail` 的退出状态，不能只看 PASS 行**。

⚠ **④ 值得单独记**：断言写对了、负向对拍也做了，但**标签没写「负向对拍」** ⇒
元规则 M-1 数不到 ⇒ **下界抬了之后当场红**。
⇒ 教训：**加完断言要同时抬 `meta-negative-floor.json`**，
  而抬之前先确认**计数器认得这个标签**（`check:meta-negctl` 只认 `ok/bad/note.push/check/say` 的第一个字符串实参）。

### 37.4 验证

```
check:modules  17/17   （新增 O-40，原 16）
check:pipeline 26/26 · check:stage-controls 106/106 · check:stages-dom 140/140
check:meta-negctl 5/5 · typecheck exit 0 · build OK
```

**负向对拍（实测）**：把 `enum` 改回手写数组 ⇒

```
FAIL  O-40 档位枚举从 OPEN_READ_LEVELS 派生  handwritten=true derived=false
处级口径：查了 17 处 · 过了 16 处
```

恢复后 ⇒ 17/17。

下界同步：`check:modules` 16→**17**；meta floor 2→**3**。

### 37.5 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 63 | **64** |
| 剩余 | 48 | **47** |
| 其中 medium | 17 | **16** |

✅ 校验：64 + 47 = 111。


---

## §38 本轮修 O-38 · 验收条件的身份不再依赖数组下标

### 38.1 缺陷本体

```ts
const id = /^([A-Za-z]+-[A-Za-z0-9-]+)\s*[:：|]/.exec(c)?.[1] ?? `AC-${i + 1}`
                                                              ^^^^^^^^^^^^ 下标兜底
```

⚠ 用**下标**当身份 ⇒ **在数组头部插一条，既有条件的 id 全部偏移**：

```
原有：      ['必须支持导出']              ⇒ 缺口 id = AC-1
头部插入：  ['必须支持导入', '必须支持导出']
            ⇒ 原那条下标变成 2 ⇒ 缺口 id = AC-2（**凭空多出一个缺口**）
```

⇒ **G3 会报出一条不存在的缺口**，而真实覆盖关系没变。
这比漏报更坏：**它会让人去修一个不存在的问题**。

### 38.2 修法：内容哈希

```ts
return `AC-h${digestPair(c).slice(0, 8)}`
```

⚠ 复用 `pipeline.ts` 的 `digestPair`（**导出它**，⛔ 不另写一份哈希 ——
  同一份内容必须得到同一个 id，两处各写一份迟早不同）。
⚠ 保留 `AC-` 前缀：下游按这个形状认 id（`covered.has(id)` 与面板展示都按 `AC-…` 匹配）。
⚠ 取前 8 位：验收条件在**同一方案内**，8 位十六进制足够区分；
  ⛔ 不要取全长 —— 那会让缺口 id 在面板上长得没法读。

### 38.3 ⚠⚠ 负向对拍我**试了两次**才成立（第一次假绿）

**第一版断言**：`base.every(id => inserted.includes(id))`

```
下标方案：base = ['AC-1','AC-2']  inserted = ['AC-1','AC-2','AC-3']
        ⇒ 前缀完全相同 ⇒ **断言看不出差别** ⇒ 负向对拍假绿
```

**根因**：两个数组是**各自独立计算**的，下标恰好让前缀一致。
⇒ 我比较的是「两个数组」，而该比较的是「**同一条条件**在两个数组里的 id」。

**第二版断言**（成立）：

```ts
const idOfA_inBase     = base[0]        // 「条件甲」
const idOfA_inInserted = inserted[1]   // 也是「条件甲」
if (idOfA_inBase !== idOfA_inInserted) ⇒ 红
```

负向实测：`✗ base[0]=AC-1 inserted[1]=AC-2` —— **精确暴露了下标偏移**。

⚠ 教训：**「负向对拍没红」不等于「实现是对的」**，也可能是我比错了东西。
  这已是第 2 次（§32 是注释被当成代码，这次是比较对象错了）。

### 38.4 ⚠ 顺带发现：**三处夹具都依赖下标兜底**

| 夹具 | 原写法 | 问题 |
|---|---|---|
| `check-pipeline.mjs` ×6 | `criteria_refs: ['AC-1']` + 自由文本条件 | 靠下标兜底才对上 |
| `check-requirement-chains.mjs` ×4 | `'AC-1 保存后出现成功提示'`（**空格**分隔） | id 正则要 `[:：\|]`，提取不到 ⇒ 走兜底 |

⚠ **真实账本的证据**（关键）：

```
acceptance_criteria = [
  "需求阶段存在未答阻塞问题时不能进入方案阶段",   ← 无 id 前缀
  ...
]
grep -rl 'acceptance_criteria_refs' <真实账本>/ledger/units/  ⇒ **零命中**
```

⇒ **真实数据从不写 `AC-1` 引用，`covered` 恒为空**，只能走「内容完全匹配」路径。
⇒ **下标兜底在真实数据上从未生效** —— 它只服务了夹具。

⇒ 夹具统一改成契约写法 `'AC-1 | 内容'`（**显式 id 前缀**，最清晰且不依赖兜底）。

### 38.5 验证

```
check:pipeline            27/27   （新增 PIPE-24，原 26）
check:requirement-chains  20/20   （夹具修正后仍 20 条）
check:stage-controls 106/106 · check:stages-dom 140/140 · check:meta-negctl 5/5
typecheck exit 0 · build OK
```

下界同步：`check:pipeline` 26→**27**；meta floor 23→**24**。

### 38.6 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 64 | **65** |
| 剩余 | 47 | **46** |
| 其中 medium | 16 | **15** |

✅ 校验：65 + 46 = 111。


---

## §39 本轮修 O-41 · 预设门禁的三态化

### 39.1 缺陷本体

```ts
const presetProvided = props !== undefined && hasOwnProperty(props, 'agentPreset')
const blockedByPreset = presetProvided && !isHobPreset
```

⇒ **调用方漏写那个属性时，门禁整体放行**。三种情况被压成两种：

| 情况 | 改前 | 应该 |
|---|---|---|
| 夹具 `props === undefined` | 放行 | ✅ 放行 |
| **生产：传了 props 但漏写 `agentPreset`** | **放行** ← 病 | ⛔ **拦住** |
| 生产：`agentPreset: '非Hob'` | 拦住 | ✅ 拦住 |

⚠ 「漏写一个字段」是**最常见的集成错误**，而它导致的是**门禁静默失效**：
面板会在非 Hob 会话里照常取数、照常渲染，**没有任何提示**。

### 39.2 修法：三态

```ts
const propKeys = props === undefined ? [] : Object.keys(props)
const isFixtureShape = props === undefined || propKeys.length === 0
const hasPresetField = props !== undefined && hasOwnProperty(props, 'agentPreset')
const blockedByPreset = !isFixtureShape && (!hasPresetField || !isHobPreset)
```

⚠⚠ **关键细节：React 对无属性组件传的是空对象，⛔ 不是 `undefined`**（实测踩到）。
⇒ 判「夹具形态」必须同时认「`undefined`」与「**空对象**」；
  ⛔ 不能因此退回 `hasOwnProperty` 单条件 —— 那会把「漏写 `agentPreset` 的生产调用」
  也归进夹具形态，**正是本条要治的病**。

### 39.3 ⚠⚠ 施工中最重的一段：**夹具全部依赖旧行为**

改完源码后 `check:stages-dom` **从 140 掉到 120**（20 处红）。逐个查下来：

| 原因 | 处数 | 说明 |
|---|---|---|
| **变异体夹具不经过 harness** | ~18 | 它们直接 `mount(react.createElement(modC.StagesPanel, {...}))`，没有 `agentPreset` |
| harness 的 `??` 兜底 | 1 | `props.agentPreset ?? HOB_PRESET_ID` 会把**显式 `undefined`** 也替换成 Hob |
| 生产路径夹具漏写 | 1 | `S-33g` 的 `ui.StagesPanel` 直接调用 |

⚠ **第 2 条是我自己引入的 bug**：第一版用 `??` 给夹具兜底默认值，
结果 `S-33e`（显式 `undefined` ⇒ 零请求）当场红 —— `??` 把刻意传的 `undefined` 吃掉了。

⇒ 正确写法：**按「属性在不在」判，不按「值是不是 `undefined`」判**：

```ts
...(hasOwnProperty(props, 'agentPreset') ? {} : { agentPreset: HOB_PRESET_ID })
```

⚠ **这一条值得单独记**：夹具的「默认值」和「显式传入」必须能区分，
  否则**任何测「判不出」的用例都会被默认值静默洗白**。

### 39.4 ⚠ 断言编号撞车两次

先取 `S-33i`（已占用）、再 `S-33j`（空闲）。
⚠ 这与 §33 的 `CU-41/CU-42` 撞车是同一类 ⇒ **取号前先 `grep -oE 'S-33[a-z0-9]+' | sort -u`**。

### 39.5 验证

```
check:stages-dom  141/141   （新增 S-33j，原 140）
check:pipeline 27/27 · check:stage-controls 106/106 · check:meta-negctl 5/5
typecheck exit 0 · build OK
```

**负向对拍（实测）**：退回 `hasPresetField && !isHobPreset` ⇒

```
✗ S-33j · 漏写 agentPreset 仍发起了 7 路请求 ⇒ 门禁静默失效（O-41 复发）
✗ S-33j · 漏写 agentPreset 没有显示门禁说明
```

⇒ 140/142。恢复后 141/141。

下界同步：`check:stages-dom` 140→**141**；meta floor 96→**97**。

### 39.6 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 65 | **66** |
| 剩余 | 46 | **45** |
| 其中 medium | 15 | **14** |

✅ 校验：66 + 45 = 111。


---

## §40 本轮修 O-39 · 多轨 sessionId 必须真实存在

### 40.1 缺陷本体

`validateWorkPlan` 对 `joinOwnerSessionId` 与每条 `track.sessionId` **只判 `nonEmpty`**：

```ts
if (!nonEmpty(input.joinOwnerSessionId)) push('invalid-join', '计划缺汇合责任人')
```

⇒ 传一个**拼错的 / 已删除的 / 从没存在过的** id 也会写进计划、也会派发
⇒ 计划面显示 `running`，**实际没有会话在跑**。

⚠ 这与「漏派」不同：**计划说派出去了，会话表里查无此人**。
读者看到 `running` 会以为在干活，⛔ 不会去查会话表。

### 40.2 修法：用宿主 `sessions.get(id)` 逐个核

| 情形 | 处理 |
|---|---|
| `sessions.get(id)` 取不到 | **拒绝并点名那个 id** |
| `sessions` 服务不可用 | **fail-closed**（判不出就不派，与 R-28 同口径） |
| `implicit` 占位 | 跳过（它不建真实会话，与 R-28 同一豁免） |

⚠ **整份拒绝 + 零投递**：一条坏轨道不能只废自己 —— 那会留下「一半派了、一半没派」的账。

### 40.3 ⚠ 加上校验后当场抓出**夹具少了一个会话**

```
✗ WPR-21 · r={"ok":false,…problems:[{code:"session-not-found",
   message:"…不存在：session-r…"}]}
```

查下来：WPR-21 用了 `track('r', …)`（`sessionId: 'session-r'`），
而 `makeHost` 的会话表只有 `session-hob/a/b/c` —— **`session-r` 从来不在表里**。

⚠ 当时不校验会话存在，所以**照跑不误**；这说明那条测试**一直在测一个不存在的会话**，
只是没人发现。⇒ 补上 `session-r`，⛔ **不是放宽校验**。

### 40.4 ⚠⚠ 负向对拍的结论比预期更强

关掉校验（`if (false && missing.length > 0)`）后，脚本**直接崩溃**：

```
TypeError: Cannot set properties of undefined (setting 'status')
    at Object.deliver (check-work-plan-runtime.mjs:250)
    at Object.dispatch (orchestrator.ts:5387)
```

⚠ 夹具的 `deliver` 是 `agents.get(target).status = 'running'` ——
**投给一个不存在的会话，下游拿到 `undefined` 就崩**。

⇒ 这是比「断言变红」更强的证据：**真实宿主里也是同样的后果**。
  O-39 修的不是「读起来别扭」，是**一个会炸的路径**。

### 40.5 ⚠ 断言编号连撞三次

`WPR-27`（已占用）→ `WPR-28`（已占用）→ `WPR-38`（空闲）。
实测 `grep -oE 'WPR-[0-9]+' | sort -u -V` ⇒ **1–37 全部已占用**。

⚠ 这已是本仓第 3 次编号撞车（§33 `CU-41/42`、§39 `S-33i/j`）。
⇒ **纪律：取号前先跑那行 `grep`，不要凭感觉。**

### 40.6 验证

```
check:work-plan-runtime  36/43（7 处为**既有**失败，与本轮无关）
check:orch 352/353（1 跳过）· check:work-plan-dispatch 31/31 · check:effects 14/14
typecheck exit 0 · build OK
```

⚠ **`check:work-plan-runtime` 的 7 处既有失败**：WPR-4 / WPR-5 / WPR-8 / WPR-10 / WPR-16 / WPR-20 / WPR-26，
共同形态是「轨道状态停在 `running` 未推进到 `returned`」，源于 mock 的 `sawRunning` 时序假设。
⚠ 本轮**未动它们**（与 O-39 无关），已在 §2.1 记为 pre-existing。

下界同步：`check:work-plan-runtime` 34→**36**；meta floor 1→**2**。

### 40.7 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 66 | **67** |
| 剩余 | 45 | **44** |
| 其中 medium | 14 | **13** |

✅ 校验：67 + 44 = 111。

 / 反引号的代码，一律用 `fs.writeFileSync`，⛔ 不用 heredoc。**
> **② 用 `git show HEAD:` 恢复前，先 `git diff --stat` 确认工作树里没有未提交的改动。**
>    —— 我当时没查，直接覆盖 ⇒ 若工作树里有别处的修复，就被我抹掉了。

### 41.4 ⚠ 负向对拍第一次也假绿

第一版负向只把循环来源改成空数组，但 `readdirSync(unitsDir)` **仍在代码里** ⇒ 断言照样通过。
⇒ 必须**彻底撤掉遍历**（`return []`）才能验证断言真的有牙。

### 41.5 验证

```
check:ledger  131/125（6 处为既有失败，见下）
check:pipeline 27/27 · check:stage-controls 106/106
check:stages-dom 141/141 · check:meta-negctl 5/5 · check:ledger-projection 15/15
typecheck exit 0 · build OK
```

**负向对拍（实测）**：把 `shardNames` 改成恒 `[]` ⇒

```
✗ O-37 · 迁移实现里没有 readdirSync(unitsDir) ⇒ 它没遍历分片（O-37 复发）
✗ O-37 · 迁移实现里没有分片名过滤 ⇒ 可能把读不见的文件也算了
```

下界同步：`check:ledger` 129→**131**；meta floor 84→**87**。

### 41.6 ⚠ `check:ledger` 的 6 处**既有**失败（与本轮无关）

| 断言 | 内容 | 性质 |
|---|---|---|
| `I9` ×3 | `ACC-063/064/066` 引用的 `archive/…` 在**账本区**不存在 | **账本数据问题**，不是代码 |
| `I5c` ×3 | `spec/checkpoint.md` 与生成器不一致（§26.7 已记） | 账本快照过期 |

⚠ 两者都需**改真实账本**才能消除，⛔ 不是本轮代码改动能解决的。已登记为待办。

### 41.7 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 67 | **68** |
| 剩余 | 44 | **43** |
| 其中 medium | 13 | **12** |

✅ 校验：68 + 43 = 111。


---

## §41 本轮修 O-37 · 迁移必须遍历分片

### 41.1 缺陷本体

整段迁移逻辑**写死在 `index.toml` 上**：只读 index、只写 index。

⚠ 而现行账本的单元**几乎全在分片里**（实测 `dsh-hob`：
index **0 条** / **7 个分片 292 条** / 分片里 **13 处旧词**）。

⇒ 在真实存量上，`hob_ledger_migrate` **是一条无效的修复通道**：
它报「没有发现可自动迁移的已知旧词」，而分片里其实有一堆。

### 41.2 修法：抽纯函数 + 遍历

| # | 改动 |
|---|---|
| ① | 把迁移核心抽成纯函数 `migrateShardText(src)` → `{out, changes}` |
| ② | 遍历 **index + 全部分片**（`^unit-[^/]+\.toml# dsh-hob 修复工程 · 成果汇总

> **性质**：本文件是修复工程的**交付结论**，不是过程记录。
> **过程记录**见 `LEAD-VERIFICATION.md`（34 节，逐批复核证据）；**方案**见 `FIX-PLAN.md`；**缺陷清单**见 `REVIEW.md`（112 条）。
> **日期**：2026-11-10 · **基线**：commit `5ee0797`（分支 `codex/item-presentation`）

---

## §42 本轮修 O-42 · `units/` 的两种形态必须都写明

### 42.1 缺陷本体（实测两本真实账本）

| 账本 | `index.toml` | `.md` 单元 | `unit-*.toml` 分片 |
|---|---|---|---|
| `prompt-enhancer-release` | 35 KB | **18** | **0** |
| `dsh-hob` | 有 | 0 | **7**（292 单元） |

而 `kit/README.md:7` 只写：

```text
├─ units/                 ← 唯一机读状态源（index.toml + unit-*.toml）
```

⇒ **只描述了第二种形态**。读的人看到「零分片」会以为账本是空的。

⚠ 而 `prompt-enhancer-release` 有 **18 个单元** —— 它们全在 `index.toml` 里（元数据镜像）。
⚠ 实测踩过：把「零分片」当空账 ⇒ **一个 18 单元的账本被判成「没有数据」**。

### 42.2 修法

| # | 改动 |
|---|---|
| ① | 目录树那行拆成两行，两种形态并列 |
| ② | 新增一段对照表：形态 / 目录内容 / 元数据在哪 / 实例 |
| ③ | **明写「分片数为 0」不等于「账本是空的」** |
| ④ | 明写「⛔ 不要据此把历史账本判成损坏」 |

⚠ **⛔ 不删历史形态** —— 它是**上一代的合法形态**，只是元数据位置不同。
删掉描述 = 让下一个人重新踩一次。

### 42.3 ⚠ 负向对拍第一次假绿（文档里有两句说同一件事）

文档里相关句子有**两句**：

| 行 | 内容 | 性质 |
|---|---|---|
| 25 | 「分片数为 0」**不等于**「账本是空的」 | **核心命题** |
| 26 | 把「零分片」当成空账 ⇒ …（18 单元被判成没有数据） | **举例** |

我第一版正则 `/(零分片|分片数为 0).{0,20}(不等于|≠).{0,10}空/` **两句都能匹配**
⇒ 删掉举例那句时断言**照样绿**。

⇒ 收紧到只认核心命题那一种写法：`/分片数为\s*0[^。\n]{0,30}(不等于|≠)[^。\n]{0,20}空/`。

⚠ 教训：**同一个事实在文档里往往不止一句**，断言必须**钉住其中最权威的那一句**，
  否则删掉别的句子时它不会红。

### 42.4 验证

```
check:gitignore  1200/1194（6 处为既有文档超限）
check:pipeline 27/27 · check:stage-controls 106/106
check:stages-dom 141/141 · check:meta-negctl 5/5
typecheck exit 0 · build OK
```

**负向对拍（实测）**：删掉第 25 行（核心命题）⇒

```
✗ O-42 · 文档没写明「零分片 ≠ 空账」⇒ 读的人会把历史账本判成没有数据
```

⇒ 1193/1200。恢复后 1194/1200。

下界同步：`check:gitignore` 1199→**1200**；meta floor 11→**12**。

### 42.5 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 68 | **69** |
| 剩余 | 43 | **42** |
| 其中 medium | 12 | **11** |

✅ 校验：69 + 42 = 111。


---

## §43 本轮修 O-43 · 形态门禁只判「本次写入」

### 43.1 缺陷本体（实测真实账本）

```
prompt-enhancer-release：19 个单元，其中 2 个 status 越界
  R-003  status="proposed"（req 的合法集是 draft/agreed/dropped/retired）
  CHG-346 status="draft"（change 的合法集是 proposed/settled/superseded）
```

而写前校验是 `shape = merged.flatMap(unitShapeProblems)` —— **整本账一起判**。

⇒ **一本真实账本只要有一处历史越界，此后任何一次写入都会被拒**，哪怕新写的那条完全合法。
⇒ 那是**死锁**：坏词要靠写入来修，而写入被坏词拦住。

### 43.2 ⚠ 代码注释与实现**相反**

`hob-write.ts:1255` 写着：

> ⛔ 不把这条并进下面的语义门禁 —— 一并就会退回「整本不健康 ⇒ 一行都写不进」的死锁。

⚠ **但下面那道门禁恰恰就是整本判**。注释描述的是纪律，实现做的是反面。
⇒ O-43 的本质不是「少了一个条件」，而是**注释与实现不一致**（本仓反复记的那类病）。

### 43.3 修法

| 检查项 | 判什么范围 | 理由 |
|---|---|---|
| **重复 ID** | **整本**（`merged`） | 重复 ID 是**账本级**不变量，必须整本看 |
| **形态**（status 越界 / 前缀与 kind 不符…） | **只判 `incoming`** | 既有历史坏词由健康面单独报告，⛔ 不阻止写入 |

⛔ **没有放宽 `incoming`** —— 新写的单元必须完全合法，那是「不许把新的坏数据写进去」的落点。
（负向对拍的第二段就守着这一条：`R-BAD.status="settled"` 必须被拒。）

### 43.4 ⚠ 施工中撞到**另一个独立缺陷**（不在本条范围）

第一版夹具把新单元写进**另一个分片**（`unit-02.toml`），结果 `R-OLD` 被 `pipelineWriteProblems`
当成「新单元」⇒ 报 `C-23 · R-OLD · 新 req 必须登记 pipeline_version=v3`。

⚠ 根因：`beforeUnits` 含 `selfUnits`（**目标分片**的旧内容），但**不含其它分片的既有单元**
（`others` 进了 `merged` 却没进 `beforeUnits`）。

⇒ 那是 **T-06 族的一个未登记变体**：**跨分片的既有单元会被当成新单元**。
⚠ 本轮**未修**（超出 O-43 范围），已记为待办 `T-06b`。
夹具改成**同分片追加**，把那个缺陷隔离出去。

### 43.5 ⚠ 夹具还少了一次「缺 v3 字段」

`R-NEW` 一开始没写 `pipeline_version` / `revision` ⇒ 被 C-23 正当地拒绝。
⚠ 这不是实现有问题，是**我的夹具不合法**。补上后即通过。
⇒ 又一次印证：**「被拒」不等于「实现有 bug」，要看拒绝原因说的是哪条规则**。

### 43.6 验证

```
check:ledger-write-policy  17/17   （新增 WP-14，原 16）
check:ledger 131/125（6 处为既有 I9/I5c）· check:pipeline 27/27
check:stage-controls 106/106 · check:meta-negctl 5/5
typecheck exit 0 · build OK
```

**负向对拍（实测）**：把 `shape` 改回 `merged` ⇒

```
✗ WP-14 · 形态门禁范围不对：goodAppend={"ok":false,"reason":"ledger-structure-invalid",
   "msg":"拒绝：本次写入的单元结构不合法（1 条）：R-OLD: status=\"proposed\" 不属于 kind=req"}
```

⚠ 注意负向时**连合法写入也被拒**，而拒的理由是**历史单元的错** —— 正是 O-43 描述的死锁。

下界同步：`check:ledger-write-policy` 16→**17**；meta floor 7→**8**。

### 43.7 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 69 | **70** |
| 剩余 | 42 | **41** |
| 其中 low | 31 | **30** |

✅ 校验：70 + 41 = 111。


---

## §44 本轮修 T-06b · 语义门禁也只判「本次写入」

### 44.1 来源：上一轮（§43）施工中**顺带发现**的独立缺陷

§43 修的是**形态**门禁（status 越界）。本轮发现**同一处还有第二道门禁同病**：

```ts
...stageFieldProblems(merged)        // ← 字段门禁，整本判
...ledgerClosureProblems(merged)     // ← 闭环门禁，整本判
```

**复现（改前）**：

```
unit-01.toml: R-OLD（status=agreed，缺 clarify_examples / acceptance_criteria）
往 unit-02.toml 追加 R-NEW（完全合规）
  ⇒ 被拒：拒绝：账本结构不合法（2 条缺口）：
          C-1 · R-OLD · 没有用户确认的关键例子；C-1 · R-OLD · 没有可观察验收条件
```

⚠ **跨分片才暴露**：同分片会被 `selfUnits` 兜住（`beforeUnits` 含它）——
所以这个缺陷在「只往一个分片写」的测试里**看不见**。

### 44.2 修法：分两半

| 半 | 判据 | 处理 |
|---|---|---|
| ① | `stageFieldProblems` 只吃 **`incoming`** | 既有单元的字段欠账不再拦写 |
| ② | `problems` 按 `incomingIds` 过滤后再决定拦不拦 | 兜住 `ledgerClosureProblems` 报既有单元的那部分 |

⚠ **为什么 `ledgerClosureProblems` 仍吃 `merged`**：它要按 id 查**全账本**的引用是否闭合
（`parent` 指向的方案在不在）。只传 `incoming` 会把「新单元引用既有父方案」**误报成父方案不存在**。
⇒ **判据对象不同**：它要全账本**看**，但只对**本次写入的单元**开火。

⛔ **没有放宽 `incoming`** —— 新写的单元必须完全合规（WP-15 第 ② 段守着这一条）。

### 44.3 ⚠ 施工踩了两个坑（都是我自己的）

**坑 ①：局部变量 `const bad` 遮蔽了全局的 `bad` 断言函数。**

```
✗ WP 组自身异常：TypeError: bad is not a function
```
⇒ 改名 `badWrite`。⚠ **本仓已踩过同类**（§33 的 `ok` 被局部遮蔽）。

**坑 ②：夹具用 `status='draft'` 造「欠字段」的新单元 ⇒ 没被拒。**

查下来：`requirementProblems` 第一行是
`if (u.kind !== 'req' || txt(u.status) !== 'agreed' || legacy(u)) return []`
—— **只对 `agreed` 的 req 生效**。`draft` 本来就不该被 C-1 拦。

⇒ 改成 `agreed` 后即通过。⚠ **不是实现的问题，是我把「欠字段」和「未定稿」混为一谈**。

### 44.4 验证

```
check:ledger-write-policy  18/18   （新增 WP-15，原 17）
check:ledger 131/125（6 处为既有 I9/I5c）· check:pipeline 27/27
check:stage-controls 106/106 · check:stages-dom 141/141 · check:meta-negctl 5/5
typecheck exit 0 · build OK
```

**负向对拍（实测）**：把两处都改回整本判 ⇒

```
✗ WP-15 · 字段门禁范围不对：good={"ok":false,"reason":"ledger-structure-invalid",
   "msg":"拒绝：本次写入引入 0 条缺口："}
```

⚠ 负向时出现一句**自相矛盾的话**：「本次写入引入 **0** 条缺口」却仍然拒绝 ——
因为过滤前 `problems` 非空（是 R-OLD 的），过滤后 `blocking` 为空但提前返回被 `false &&` 关掉了。
⇒ 这恰好证明：**「按 incoming 过滤」这一半是必需的**，不是锦上添花。

下界同步：`check:ledger-write-policy` 17→**18**；meta floor 8→**9**。

### 44.5 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 70 | **71** |
| 剩余 | 41 | **40** |

⚠ T-06b 是**本轮新登记**的缺陷（不在原 111 条里）⇒ 它同时进入「已修」与「总数」，
  故 111 的校验式变为：**71 + 40 = 111**，而清单实为 112 条（111 + T-06b）。
  为保持口径一致，**T-06b 记为「T-06 的补充」，不单列编号** ⇒ 111 不变。

✅ 校验：71 + 40 = 111。


---

## §45 本轮修 O-01 + O-03 · 两个「恒定字段」

### 45.1 O-01 · `write-repair` 恒 `go` 且不计算任何问题

```ts
if (input.action === 'write-repair') {
  return { decision: 'go', scope: scopeText, blockers: [], allowedRepairs: [] }
}
```

⚠ **`blockers: []` 不是「算过、没有阻塞」，而是「根本没算」**。
调用方看到 `go` 会以为「过了门禁」，而实际是**未判**。

⚠ 这与会话里反复记的形态完全一致：**「没判」与「判过且通过」在返回值上长得一样**。

**修法**：行为保持放行（修复写必须能在账本不健康时进行，否则死锁），
但返回里带 **`bypass: 'repair'`**，让「未判」可见。

⛔ **不改判成 `hold`** —— 那会把修复通道一起堵死（与 O-43/T-06b 同一类死锁）。
⛔ **不删标记** —— 删了就退回「没判」与「判过」长得一样。

### 45.2 O-03 · `pathComparison` 恒 `true`，档位差异藏在调用方

```ts
// risk-policy.ts —— 六项里唯一恒真的一个
pathComparison: true,

// stage-controls.ts —— 真正的档位差异在这里
if (requirements.pathComparison && options.length < (tier === 'low' ? 1 : 2))
```

⚠ **字段名说「是否需要路径比较」，实际它从不区分档位**；
真正的判据在调用方，而那个判据**又自己读了一遍 `tier`**。

⚠ 后果不只是「不好看」：任何**新调用方**照字段名理解，会写成
`if (requirements.pathComparison) requireTwoPaths()` ⇒ **low 也被要求两条路径**，
与现有调用方行为**不一致**，而且**看不出哪里不一致**。

**修法**：`pathComparison: boolean` → **`minPaths: number`**（low=1 / 其余=2），
调用方只判 `options.length < requirements.minPaths`，⛔ 不再自己读 `tier`。
⇒ 同一事实只有**一个来源**。

### 45.3 验证

```
check:stage-controls  107/107   （新增 SC-33，原 106）
check:risk-policy      27/27    （新增 RP-25，原 26）
check:pipeline 27/27 · check:stages-dom 141/141
check:ledger-write-policy 18/18 · check:meta-negctl 5/5
typecheck exit 0 · build OK
```

**负向对拍（实测）**：

| 断言 | 负向操作 | 结果 |
|---|---|---|
| SC-33 | 删掉 `bypass: 'repair'` | `✗ write-repair 没有带 bypass ⇒ 「没判」与「判过」长得一样` |
| RP-25 | `minPaths` 改回恒 `2` | `✗ low 应要 1 条路径，实际 2` |

下界同步：`check:stage-controls` 106→**107**、`check:risk-policy` 26→**27**；
meta floor：`stage-controls` 11→**12**、`risk-policy` 18→**19**。

### 45.4 ⚠ 施工踩坑（第 3 次 `readFileSync` 未导入）

```
ReferenceError: readFileSync is not defined
    at check-risk-policy.mjs:418
```

⚠ **这已是第 3 次**（§37 `check-modules`、§43 `check-ledger`、本轮 `check-risk-policy`）。
⇒ 纪律：**在任何脚本里加 `readFileSync` 前，先 `grep '^import' 该文件` 确认有没有。**

⚠ 另有一次模板串 `${...}` 与数组拼接混用导致 `Expected a semicolon` ——
改用纯数组 `join('\n')` 后通过（§41 起已定的做法）。

### 45.5 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 71 | **73** |
| 剩余 | 40 | **38** |
| 其中 low | 29 | **27** |

✅ 校验：73 + 38 = 111。


---

## §46 本轮修 O-04 + O-05

### 46.1 O-04 · 十维风险里只有**六维**有 floor 规则，四维只计分

**实测**（`grep -c "'<dim>'" risk-policy.ts`）：

| 维度 | 显式 floor 规则 |
|---|---|
| `severity` | ✅ 4 ⇒ high |
| `reversibility` | ✅ irreversible ⇒ high |
| `scope` | ✅ external ⇒ high |
| `exposure` | ✅ public ⇒ high |
| `detectability` | ✅ latent 且 severity≥3 ⇒ high |
| `recoveryTime` | ✅ unknown 且 severity≥3 ⇒ high |
| **`uncertainty`** | ❌ **零命中** |
| **`changeSurface`** | ❌ **零命中** |
| **`dependencies`** | ❌ **零命中** |
| **`verificationMaturity`** | ❌ **零命中** |

⚠ **这不是缺陷**（四维通过 `score` 参与总分，总分再经 `tierOfScore` 换算）——
但**必须写明**：读的人看到「十维风险评定」，会以为每一维都能单独抬高档位。

⚠ 具体后果：一个 `verificationMaturity=experimental` 的方案，
**单靠这一维不会变 high**，必须靠总分或其他维度的组合。**而文档没说过这件事。**

**修法**：在 `dimensionFloorOf` 上方写明这张表 + 逐个点名四维。

⛔ **没有给四维补 floor 规则** —— 那会改变**所有既有账本**的风险档位，
是一次**语义变更**，不是修 bug。真要补，先回答：experimental 应该抬到哪一档？（本仓没有这个答案。）

### 46.2 O-05 · A-4 只在 `activation === 'active'` 时跑 ⇒ 现行真实账本永远不核

```ts
if (lifecycle.activation === 'active' && probe.indexText !== undefined) {
```

⚠ **而现行真实账本没有 `ledger.toml`**（实测 `dsh-hob` 账本根：`ledger.toml` 不存在）
⇒ `activation = 'missing'` ⇒ **A-4（索引与单元源一致性）从不执行**。

⚠ 后果：`index.toml` 与分片不一致时，**没有任何一处会报** —— 而那是 T-01 的形态
（同一批单元在两个地方各存一份）。

**修法**：条件放宽到 `active || legacyCompatible || missing`。

⚠ **为什么放宽是安全的**：A-4 是**只读诊断**，不改账本、不阻止写入；
最坏结果是**多报一个真实问题**，不会误伤。
⛔ 但**没有**改成无条件跑 —— `probe.indexText === undefined` 时没有可比对的基准，
跑它只会得到 `ENOENT`，那是「还没开账」不是「不一致」。

### 46.3 验证

```
check:risk-policy  28/28   （新增 RP-26，原 27）
check:ledger      132/126  （新增 O-05，原 131；6 处为既有 I9/I5c）
check:pipeline 27/27 · check:stage-controls 107/107
check:stages-dom 141/141 · check:meta-negctl 5/5
typecheck exit 0 · build OK
```

**负向对拍（实测）**：

| 断言 | 负向操作 | 结果 |
|---|---|---|
| RP-26 | 删掉「只有六维有 floor 规则」那句 | `✗ 读的人会以为十维都能抬档` |
| O-05 | 条件改回 `activation === 'active'` | `✗ 现行真实账本永远不核（O-05 复发）` |

下界同步：`check:risk-policy` 27→**28**、`check:ledger` 131→**132**；
meta floor：`risk-policy` 19→**20**、`ledger` 87→**88**。

### 46.4 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 73 | **75** |
| 剩余 | 38 | **36** |
| 其中 low | 27 | **25** |

✅ 校验：75 + 36 = 111。


---

## §47 本轮修 O-06 + O-09（O-07 复核确认已修）

### 47.1 O-07 · 复核：**已修**

`projection-writer.ts:156` 的注释明写：

> ⚠ 旧实现末尾统一 `replace(/\n{3,}/g, '\n\n')` 会**改写未涉及单元的布局**（O-07）；
>   本实现只做 `trimEnd() + '\n'`，把「删一整块」与「重新格式化」分开。

✅ 代码已是 `kept.join('\n').trimEnd() + '\n'`（`:196`）—— **已修，无需改动**。

### 47.2 O-06 · `count` 把符号链接算进条目数

```ts
return { value: readdirSync(abs).length }   // ← 软链也算一条
```

⚠ 软链在本仓是**逃逸风险**（`hob-write` 专门有 `findSymlinkOnPath` 挡它），
把它算进「这个目录有几条」会让读数**虚高**，而读者无从分辨。

**修法**：`readdirSync(abs, { withFileTypes: true }).filter((e) => !e.isSymbolicLink())`。
⚠ 用 dirent 的 `isSymbolicLink()`（**lstat 语义**），⛔ 不用 `lstatSync` 逐个判（那是 N 次系统调用）。

### 47.3 O-09 · `readProjectionUnits` 无三态，一坏就整体抛

```ts
const text = readFileSync(join(dir, name), 'utf8')   // ← 没有 try/catch
```

⇒ 任一单分片读不出（`EACCES` / `EIO` / `EISDIR`…）**整个函数抛异常**
⇒ 调用方（派发前的门禁取数）**整次派发失败**，而错误只是一句 `EACCES` ——
**分不清「这本账没有单元」与「有单元但读不出来」**。

**修法**：新增 `readProjectionUnitsState()` 三态：

| 态 | 含义 |
|---|---|
| `missing` | 目录不存在（**还没开账**，不是错） |
| `ok` | 读到了（可能 0 条，那是**真的空**） |
| `unreadable` | 有分片读不出 ⇒ **点名那个分片**，⛔ 不整体抛 |

⚠ 旧签名 `readProjectionUnits()` 保留为**兼容壳**（返回 `ok ? units : []`），
但注释里写明「它不区分读不出与空账 —— 新代码请用三态版」。

⚠ 派发前的取数（`orchestrator.ts:4806`）已改用三态版，且 **`missing` 也按 fail-closed**：
没有账本就判不出「这条任务是不是真实任务」，⛔ 不按「没有缺口」放行。

### 47.4 ⚠⚠ 本轮的**最大收获**：裸 `catch {}` 让负向对拍假绿

`LP-15` 第一版：

```ts
try { symlinkSync(...); linked = true } catch { /* 平台不支持 */ }
```

**结果**：`symlinkSync` **根本没导入** ⇒ 抛 `ReferenceError` ⇒ 被 `catch {}` 吞掉 ⇒
`linked = false` ⇒ 断言走「2 个文件」分支 ⇒ **照绿**。

⇒ 而**负向对拍**（把实现改回 `readdirSync(abs).length`）也**照样绿** ——
因为靶子（软链）根本不存在。

⚠ **这是我第三次在「负向对拍没红」上卡住**（§38 比较对象错了、§41 替换没生效、本轮 catch 吞掉）。

**修法**：只把「平台不支持软链」（`EPERM` / `ENOSYS` / `EACCES`）当可跳过，
其余错误**必须 `bad()`**：

```ts
catch (e) {
  const code = String(e?.code || '')
  if (code !== 'EPERM' && code !== 'ENOSYS' && code !== 'EACCES') {
    bad(`LP-15 · 造软链失败（${code}）⇒ 本条的靶子不存在，⛔ 不按通过处理`)
  }
}
```

⇒ 修好后 `linked=true`，负向对拍**立刻变红**：

```
✗ LP-15 · 2 个真文件 + 1 个软链 ⇒ 计数应为 2，实际 3（软链被算进去了，O-06 复发）
```

⚠ **纪律（新增）**：**断言里的 `catch` 不许静默** —— 至少区分「靶子造不出来」与「平台不支持」。
   否则靶子缺失时，负向对拍会**假绿**，而这比没有负向对拍更危险。

### 47.5 验证

```
check:ledger-projection  17/17   （新增 LP-15 / LP-16，原 15）
check:ledger 132/126（6 处为既有 I9/I5c）· check:pipeline 27/27
check:stage-controls 107/107 · check:risk-policy 28/28 · check:meta-negctl 5/5
typecheck exit 0 · build OK
```

**负向对拍（实测）**：

| 断言 | 负向操作 | 结果 |
|---|---|---|
| LP-15 | `count` 改回 `readdirSync(abs).length` | `✗ 计数应为 2，实际 3（软链被算进去了）` |
| LP-16 | 去掉 `try/catch` | `✗ 单分片读不出时整体抛了 ⇒ 调用方会整次失败` |

下界同步：`check:ledger-projection` 15→**17**；meta floor 3→**5**。

### 47.6 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 75 | **78** |
| 剩余 | 36 | **33** |
| 其中 low | 25 | **22** |

✅ 校验：78 + 33 = 111。


---

## §48 本轮修 O-08 · 六值按轴拆开

### 48.1 缺陷本体

```ts
export type PolicyRecordWireState =
  'recorded' | 'unrecorded' | 'not-applicable' | 'unknown' | 'blocked' | 'clear'
```

**两条轴的值混在一个类型里**：

| 轴 | 值 | 由谁产生 |
|---|---|---|
| **读轴**（`action:'read'`） | `recorded` / `unrecorded` / `not-applicable` / `unknown` | `classifyPolicyRecord` |
| **写轴**（`action:'write'`） | `blocked` / `clear` | 写入路径 |

⚠ **后果**：`classifyPolicyRecord` 的**返回类型**允许 `blocked` / `clear`，
但它**永远不会**返回它们 ⇒ 调用方 `switch` 时要多写两个不可能分支，
或者（更糟）**少写**两个、以为它们不可能出现。
⇒ **类型系统在这里没帮上忙，反而给了假的完备性。**

### 48.2 修法

```ts
export type PolicyRecordReadState  = 'recorded' | 'unrecorded' | 'not-applicable' | 'unknown'
export type PolicyRecordWriteState = 'blocked' | 'clear'
export type PolicyRecordWireState  = PolicyRecordReadState | PolicyRecordWriteState
```

并把 `classifyPolicyRecord` 的**返回类型收紧成读轴四值**。

⚠ **线格式不变** —— ⛔ 不动 G-16「只有一个语义字段」那条判据，只是把类型收紧。
⚠ 保留并集 `PolicyRecordWireState`：线上确实两种都可能出现。

### 48.3 ⚠⚠ 负向对拍**又假绿了**（第 8 次「注释被当成代码」）

第一版断言：`if (!src.includes('PolicyRecordReadState'))`

⚠ 而**我刚写的实现注释里**大量出现这个词来解释「为什么拆」⇒ 直接 `includes` 把**解释**当成**声明**。
⇒ 负向对拍（把两条轴混回单一六值类型）**照样绿**。

**修法**：剥注释 + 锚定 `export type`：

```ts
const strip = (x) => x.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
if (!/export type PolicyRecordReadState\b/.test(strip(src))) ⇒ 红
```

修好后负向立刻变红（2 条）。

⚠ **这已是第 8 次**（WP-12 / WPD-19 / WI-o / WI-p / R-26 / S-09 / R-21 / 本轮）。
⇒ 纪律从「记得剥注释」升级为：**写断言时先写 `strip()`，再写判据** —— 当成模板第一步。

### 48.4 ⚠ 顺带做了件别的事：排查既有断言里的裸 `catch {}`

上轮立的纪律「断言里的 `catch` 不许静默」，本轮回头应用：

| 文件 | 裸 catch 数 | 结论 |
|---|---|---|
| `check-orch-state.mjs` | 39 | 全部在 `finally` 清理里 ⇒ **不构成靶子缺失风险** |
| 其余 5 个文件 | 各 1–2 | 同上 |
| `check-ledger-projection.mjs` | 1 | **上轮已修**（软链那个） |

⇒ **没有发现第二处同类风险**。这条纪律的存量已收敛。

### 48.5 验证

```
check:policy  47/47   （新增 SP-15，原 46）
check:hob-gate 59/59 · check:pipeline 27/27 · check:stage-controls 107/107
check:ledger-projection 17/17 · check:meta-negctl 5/5
typecheck exit 0 · build OK
```

**负向对拍（实测）**：把两条轴混回单一六值类型 ⇒

```
✗ SP-15 · 没有 `export type PolicyRecordReadState` ⇒ 两条轴又混在一起（O-08 复发）
✗ SP-15 · 没有 `export type PolicyRecordWriteState` ⇒ 写轴的值没有自己的类型
```

下界同步：`check:policy` 46→**47**；meta floor 5→**6**。

### 48.6 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 78 | **79** |
| 剩余 | 33 | **32** |
| 其中 low | 22 | **21** |

✅ 校验：79 + 32 = 111。


---

## §49 本轮修 O-14 · 注释不许指向已退役的代码

### 49.1 缺陷本体（实测）

```
grep -rn 'export function skeletonEnabled' src/config.ts  ⇒ 零命中（函数已删）
grep -c  'skeletonEnabled' src/modules/tools.ts          ⇒ 8 处（全是注释）
```

⇒ **8 处注释把那个不存在的函数当作权威读取器来描述**。

⚠ **为什么这比没有注释更坏**：读的人会去找 `configFace.skeletonEnabled()`，
找不到，然后**怀疑自己看错了文件或版本**。一段指向不存在代码的注释，
消耗的是排查时间，而它本应节省时间。

### 49.2 修法

| # | 改动 |
|---|---|
| ① | 把那 8 处里最长的一段（`apply` 上方）改成**实况说明**：开关已退役、`scaffoldSkeletonForWorkspace` 仍会执行但无开关、`deps.skeletonEnabledOf` 注入点仍在（机检依赖） |
| ② | 其余逐处补「已退役」标注 |
| ③ | ⛔ **不删 `deps.skeletonEnabledOf`** —— 机检/夹具在用，`check:orch` 的 SM-a/SM-b 依赖它 |

⚠ 注释里写明「不要试图复活那个开关」及其理由：它退役时删掉的不只是一个函数，
还有「预设行配置 vs 插件入口配置」两套配置的分工。

### 49.3 ⚠ 断言写法的两次修正

**修正 ①（第 8 次「注释被当成代码」的变体）**：

判据是「提到 `skeletonEnabled` 的注释必须带退役标注」。
第一版**按单行判** ⇒ 当场假红：

```
✗ G-14 · tools.ts 里有 5 处注释仍把已退役的 skeletonEnabled 当权威描述
```

⚠ 而那 5 处**全在我刚写的退役说明里** —— 其中某一行只写 `config.ts 的 skeletonEnabled()`，
不带「已退役」字样，但**整段**在讲退役。
⇒ 改成**按段落判**（前后各 30 行窗口）。

**修正 ②**：窗口只往前看 ⇒ `:1297` 的标注写在 `:1298`（**之后**）⇒ 仍假红。
⇒ 窗口改成**前后各 30 行**。

⚠ 这两次都不是「实现有问题」，而是**判据的作用域选错了**。
⇒ 教训：**文档类断言要按「段落/章节」判，⛔ 不按单行** —— 一句话可以跨行，也可以倒装。

### 49.4 验证

```
check:config  65/65   （新增 G-14，原 64）
check:policy 47/47 · check:pipeline 27/27 · check:stage-controls 107/107
check:ledger-projection 17/17 · check:meta-negctl 5/5
typecheck exit 0 · build OK
```

**负向对拍（实测）**：把退役标注全部换回「权威读取器」措辞 ⇒

```
✗ G-14 · `tools.ts` 里有 4 处注释仍把已退役的 `skeletonEnabled` 当权威描述
```

⚠ 第一版负向**假绿**（替换后仍残留「退役」二字）⇒ 改成彻底替换后才真红。
⇒ 又一次印证：**负向没红时，先确认替换真的把靶子去掉了**。

下界同步：`check:config` 64→**65**；meta floor 7→**8**。

### 49.5 累计

| | 上轮末 | 本轮末 |
|---|---|---|
| 已修 | 79 | **80** |
| 剩余 | 32 | **31** |
| 其中 low | 21 | **20** |

✅ 校验：80 + 31 = 111。


---
