# FIX-RESULT 分卷 8

> ⚠ `FIX-RESULT.md` 的分卷（§88：A 方案第 7 轮）。
> ⚠ **拆分的唯一原因是读上限**（64KB）。

---
## §88 A 方案 **第 7 轮** · 4 组重复文案 + 一次**自引用**事故

### 88.1 迁了什么

| 词条 | 原文 | 原处数 |
|---|---|---|
| `stages.noRouteReason` | 「（路由没有给出原因）」 | **5** |
| `stages.noReadableSummary` | 「路由没给出可读的 summary」 | 1 |
| `stages.missingRelation` | 「（正式关系缺失）」 | 1 |
| `stages.maxElapsedPrefix` | 「已跑（最长）：」 | 1 |

词条总数：35 → **39**。

### 88.2 ⚠⚠ 事故：**批量替换把词典自己也改了**

我用 `s.split("'（路由没有给出原因）'").join("stageText(...)")` 全局替换 ——
而**词典条目的值本身就是那个字面量** ⇒ 变成了：

```
'stages.noRouteReason': stageText('stages.noRouteReason'),   // ← 自引用
```

⇒ 模块加载时 `STAGES_DICT_ZH` **尚未初始化**就被读 ⇒
  `ReferenceError: Cannot access 'STAGES_DICT_ZH' before initialization`。

⚠ **这是「批量替换」的经典陷阱**：词条的值与被替换的字面量**是同一个串**。

⇒ 纪律：**批量替换前必须先把词典区排除**（按行号区间跳过），
  ⛔ 不许对整文件做无差别的 `split/join`。

⚠ 已被 `check:stages-dom` 当场咬住（模块加载即崩），**没有漏到下一轮**。

### 88.3 S-43d 又一次因字号绑定失效

```
✗ S-43d · 源码里找不到关系缺失的判不出分支（形态变了）⇒ 负向对拍不可判
```

它的 `NEEDLE` 是**整行硬编码**（含「（正式关系缺失）」），而那个串已抽成词条。

**修法**：改成**按行首结构定位**：

```
const NEEDLE_RE = /^\s*: `\$\{relationLabel\}.*$/m
```

⚠ **第一版结构正则还是错的**：写成 `/[\s\S]{0,240}?父级/` —— 非贪婪但**跨行**，
  匹配到的片段**不含行尾**，替换后留下残句 ⇒ `SyntaxError: Missing initializer in const declaration`。

⇒ 第二次改成 `^….*# FIX-RESULT 分卷 5

> ⚠ 本文件是 `FIX-RESULT.md` 的分卷（§79–§81：检查体系三个假红的修复 + A 方案评估）。
> 原 `FIX-RESULT-VOL4.md` 涨到 62KB 逼近 64KB 上限 ⇒ 按 M 判据再拆一卷。
> ⚠ **拆分的唯一原因是读上限**，⛔ 不是内容变了。

---

## §88 A 方案 **第 7 轮** · 4 组重复文案 + 一次**自引用**事故

> ⚠ 本节 §88.1–88.3 曾在一次拆卷中被误删，**已按原始记录重建**（2026-11-11）。
> 后续小节见 [`FIX-RESULT-VOL9.md`](./FIX-RESULT-VOL9.md)。

### 88.1 迁了什么

| 词条 | 原文 | 原处数 |
|---|---|---|
| `stages.noRouteReason` | 「（路由没有给出原因）」 | **5** |
| `stages.noReadableSummary` | 「路由没给出可读的 summary」 | 1 |
| `stages.missingRelation` | 「（正式关系缺失）」 | 1 |
| `stages.maxElapsedPrefix` | 「已跑（最长）：」 | 1 |

词条总数：35 → **39**。

### 88.2 ⚠⚠ 事故：**批量替换把词典自己也改了**

我用 `s.split("'（路由没有给出原因）'").join("stageText(...)")` 全局替换 ——
而**词典条目的值本身就是那个字面量** ⇒ 变成了：

```
'stages.noRouteReason': stageText('stages.noRouteReason'),   // ← 自引用
```

⇒ 模块加载时 `STAGES_DICT_ZH` **尚未初始化**就被读 ⇒
  `ReferenceError: Cannot access 'STAGES_DICT_ZH' before initialization`。

⚠ **这是「批量替换」的经典陷阱**：词条的值与被替换的字面量**是同一个串**。

⇒ 纪律：**批量替换前必须先把词典区排除**（按行号区间跳过），
  ⛔ 不许对整文件做无差别的 `split/join`。

⚠ 已被 `check:stages-dom` 当场咬住（模块加载即崩），**没有漏到下一轮**。

### 88.3 S-43d 又一次因字号绑定失效

```
✗ S-43d · 源码里找不到关系缺失的判不出分支（形态变了）⇒ 负向对拍不可判
```

它的 `NEEDLE` 是**整行硬编码**（含「（正式关系缺失）」），而那个串已抽成词条。

**修法**：改成**按行首结构定位**：

```
const NEEDLE_RE = /^\s*: `\$\{relationLabel\}.*$/m
```

⚠ **第一版结构正则还是错的**：写成 `/[\s\S]{0,240}?父级/` —— 非贪婪但**跨行**，
  匹配到的片段**不含行尾**，替换后留下残句 ⇒ `SyntaxError: Missing initializer in const declaration`。

⇒ 第二次改成 `^….*$`（**整行**匹配，`m` 标志）才稳。

⚠ 这与 §84.4 那次（`{0,200}` 吃掉后面的 `export class`）是**同一个病**：
  **跨行模糊量词做源码变异 = 高风险**。两轮里栽了两次。
  **纪律**：源码变异一律用 **`^…$` 整行锚定**，⛔ 不用 `[\s\S]{0,N}`。

---

## §89 一次**差点毁掉工作区**的 `.gitignore` 事故

### 89.1 起因（诊断是对的）

`git status` 里有条 `??`：`.check-stages-work-117324/`（`check-stages-panel-dom.mjs` 的临时根）。
实测 `git check-ignore`：

```
.check-stages-work-117324/  => 未忽略      ← 以 pid 结尾
.check-dom-work/           => 被忽略
.check-gate-work/          => 被忽略
```

根因：`.gitignore` 写 `.check-*-work/`（以 `work` 结尾），实际名是 `.check-*-work-<pid>` ⇒ 不匹配。

### 89.2 ⚠⚠ 然后我犯了一个极危险的错误

我往 `.gitignore` 里写：

```
/**
 * ⚠⚠ 上面那条匹配不到「带 pid 后缀」的形态…
 */
.check-*-work-*/
```

⚠ **`/**` 那一行不是注释，它是 gitignore 的「忽略一切」通配符。**
  我把它当成 JS 的块注释开头写进了 `.gitignore`。

**后果（实测）**：

```
git check-ignore -v src/shared/pipeline.ts  =>  .gitignore:136:/**
git status --short | wc -l  =>  从 139 变成 0
git ls-files src/shared/pipeline.ts  =>  空
```

⚠⚠ **152 个文件在同一瞬间全部「消失」** —— 它们**并没有被删**，只是被 `.gitignore` 挡住了。
  如果当时我**先 commit**、或者**用 `git add -A`**，就会得到一个**空提交**，而看起来一切正常。

### 89.3 是怎么发现的

下一步本来要「核实工作区状态」，跑的是：

```
git ls-files src/shared/pipeline.ts   => 无输出
git status --short <那些文件>          => 无输出
```

⚠ **「无输出」如果被当成「这些文件没问题」就完了。**
  我觉得不对（它们明明是未跟踪的新文件，不该无输出）⇒ 去 `git check-ignore -v` ⇒ `/**` 立刻现形。

### 89.4 修复（已验证无损失）

把 `/** … */` 块改成 `#` 行注释。实测：

```
git check-ignore src/shared/pipeline.ts  => 不被忽略  ✅
git status --short | wc -l               => 151         ✅
src/shared/pipeline.ts      26199 字节   在
src/shared/risk-policy.ts   37022 字节   在
src/shared/pipeline-view.ts 46247 字节   在
src/shared/ledger-health.ts  8481 字节   在
src/client/atoms.tsx         3406 字节   在
```

⚠ **没有任何数据损失** —— 文件从头到尾都在盘上，只是被忽略了。

### 89.5 三条纪律（硬性）

**① `.gitignore` 里⛔ 不许出现 `/**`** —— 它是「忽略一切」，不是注释。写注释只能 `#`。

**② 改 `.gitignore` 后必须立刻验「本该被跟踪的文件还在不在」**：
  `git check-ignore -v <src/ 下任一文件>` ⇒ 必须**无输出**。

**③ `git status` 突然变空 = 事故信号，⛔ 不是「一切干净」**：
  本项目长期有 100+ 未提交改动，突然归零**必然是配置问题**。
  ⚠ 与 §78 那条「管道 `$?` 是 `tail` 的」同类：**读数异常先怀疑读数，再怀疑事实**。

### 89.6 顺带修好的真问题

`.gitignore` 补上 `.check-*-work-*/` —— 崩溃残留（`SyntaxError` 时没走到 `cleanup()`）
现在会被忽略，⛔ 不再污染 `git status`。

### 89.7 同一轮里的**第二起**文档事故

拆卷时把 `VOL8` 重建错了 —— 只剩文件头（2389 字节），**§88.1–88.3 的内容丢了**。

⚠ 发现方式：写 §89 时找不到 `--- 文档结束 ---` 那个锚点 ⇒ 一看文件只剩 2.3KB。
  ⇒ 已按原始记录**重建 §88.1–88.3**（VOL8 现 4808 字节，88.1–88.3 齐全；88.4–88.6 在 VOL9）。

⚠ 教训：**拆卷 / 重建之后必须立刻 `wc -c` + `grep '^## §'` 核一遍**，
  ⛔ 不能只看「写盘成功」。本轮两起事故（`/**`、VOL8 丢内容）都是**写盘成功但内容错**。

### 89.8 验证

```
check:gitignore exit=0 · check:client exit=0 · check:stages-dom exit=0
build OK · git status 151 项（与事故前 139+12 一致）
```

---

## §90 收口前的安全复核与 commit 分组方案

### 90.1 `.gitignore` 事故后的安全复核（全过）

§89 那次 `/**` 事故之后，本轮先做了一次**逐文件复核**：

```
git check-ignore -q <f>  ⇒ 必须非零（= 不被忽略）
```

| 文件 | 结果 |
|---|---|
| `src/shared/pipeline.ts` | ok |
| `src/shared/risk-policy.ts` | ok |
| `src/client/atoms.tsx` | ok |
| `src/client/project-panel.tsx` | ok |
| `scripts/check-all.mjs` | ok |
| `package.json` | ok |
| `README.md` | ok |

工作区：**151 项改动 · 12 个未跟踪**（与事故前 139 + 12 一致）。

### 90.2 新模块**全部被引用**（不是死代码）

| 模块 | 被引用处数 |
|---|---|
| `shared/pipeline` | **8** |
| `shared/pipeline-view` | 4 |
| `shared/ledger-lifecycle` | 4 |
| `shared/ledger-health` | 3 |
| `shared/risk-policy` | 2 |
| `client/routes` | 5 |
| `shared/dispatch-preset` | 1 |
| `client/atoms` | 1 |

⚠ 这 8 个是**整个审计修复工程的新底座**，此前从未进过 git。
  ⇒ 提交时**必须与引用它们的改动同一批**，⛔ 不可单独提交（那会得到一个**编译不过的提交**）。

### 90.3 commit 分组方案（⚠ 待用户确认，本轮**未执行**）

| 批次 | 内容 | 数 |
|---|---|---|
| **1** | `src/shared/` 新模块 + 引用它们的 `src/` 改动 | 8 新 + ~52 改 |
| **2** | `scripts/` 断言（含本会话新增的 PIPE-25/26、S-12c~f、S-48、J-21、R-31/32、SC-34~36 等） | 46 |
| **3** | `kit/` 与 `preset/` 文档 | ~21 |
| **4** | 配置文件（`package.json` / `.gitignore` / `tsdown.config.ts` 等） | ~5 |

⚠ **为什么必须先第 1 批**：`pipeline.ts` / `risk-policy.ts` 等被 8 处 import，
  单独提交 `scripts/` 会让那批**引用不存在的模块** ⇒ `check:all` 在中间提交上是红的。

⚠ **为什么本轮不执行**：
  · `git commit` 是**不可逆的工作区状态变更**（尤其在上轮 `.gitignore` 事故之后）；
  · 提交信息怎么说、是否要拆这么细，**属于用户的判断**；
  · 本仓有「作业书与报告随轮入库」的纪律，但那条针对账本区，⛔ 不覆盖代码仓。

### 90.4 本轮验证

```
check:ignore 逐文件复核：7/7 ok
新模块引用：8/8 有引用
build OK · typecheck OK
（完整 check:all 见下一节）
```

---

## §91 `check:all` 里的 `check:archive` **跑不完**（未解决，如实记）

### 91.1 现象

| 跑法 | 耗时 | 结果 |
|---|---|---|
| **单独** `npm run check:archive` | **73 秒** | **PASS**（①246 对 · ②8969 对 · 均齐备） |
| 在 `check:all` 里 | **>240 秒**（被 `timeout 240` 截断） | **输出只有 2 行就断**，无判定行 |

⚠ 同一个脚本、同一份数据，**放进 `check:all` 就慢到跑不完**。

### 91.2 已排除的假设

| 假设 | 实测 | 结论 |
|---|---|---|
| `STRICT_FAMILIES` 传了额外参数 | `check:all` 只给 `check:build` 传 `--strict-source`；archive 无参数 | ❌ 排除 |
| `/tmp` 被前序族的残留撑满 | `df -h /tmp` 用 1%（5.9G 里 17M） | ❌ 排除 |
| 前序族留下的进程干扰 | `ps` 无 `check-*` 残留（我 kill 过一轮，之后无新增） | ❌ 排除 |
| git 调用在循环里（数百次 spawn） | `tryGit`/`tryGitBuf` 全文只有 **10 处**，循环内仅 `:171` 一处 `for (const r of repos)` | ⚠ **不足以解释 240 秒** |

### 91.3 ⚠ 一个我自己的错判，必须记

第一次测 archive 时我看到 `ELAPSED=73.33 / EXIT=0` 就以为**它跑完了**。
紧接着 `ps aux` 显示 **PID 177089 仍在跑**（CPU 21.5%）。

⚠ 根因：我第一次启动的是一次**独立后台任务**，后来又启动了一次计时任务 ——
  **两次运行的输出我混在了一起**：看到 `EXIT=0` 的是 A 次，仍在跑的是 B 次。
  ⇒ 我据此得出过「73 秒能跑完」的结论，**那个结论当时是错的**（直到第三次干净测量才成立）。

⚠ 教训：**同时有多个后台任务在跑同一个族时，输出会串**。
  测量前必须先 `ps`/`job_list` 确认没有同名进程，⛔ 不能凭「看到一行 EXIT=0」就下结论。
  ⚠ 这与 §78「管道 `$?` 是 tail 的」同类：**读数来源必须唯一且可追溯**。

### 91.4 当前状态

```
check:archive 单独跑：PASS（73 秒）
check:all（含 archive）：archive 超时 ⇒ 整体 exit=1
其余 46 族：逐个实测，见 §92
```

⚠ **这不是「check:all 全绿」**。如实记为**未解决**。

### 91.5 顺带修好的下界（2 处）

`check:all` 报了两条下界落后，都是我这两轮加断言没同批抬：

| 族 | 原下界 | 实测 | 已改为 |
|---|---|---|---|
| `check:client` | 52 | **54** | 54 |
| `check:stages-dom` | 146 | **147** | 147 |

⚠ 这两条正是**下界机制在正常工作**的证据 —— 它咬住了我自己的疏漏。

---

## §92 `check:archive` 慢的**真根因**：5000+ 次 git 子进程

### 92.1 根因（实测，不是推测）

探针插在 `tryGit()` 入口，计数打印每 50 次一条。实测输出：

```
[git#3300] --git-dir /home/lk/.dsh/hob-ledgers/dsh-hob/archive/2026-10-…
[git#3750] rev-parse 10673216d2ebed970aaaca85eb4d4842954bfea0:src/clien…
[git#5350] …（仍在增长，被主动终止）
```

⇒ **单次 `check:archive` 要起 5000+ 个 git 子进程**。
  `execFileSync('git', …)` 每次都是 **fork + exec**，这就是 73 秒的来源 ——
  ⚠ **73 秒其实已经是快的**（约 70 次 fork/秒，接近这台机器的上限）。

### 92.2 那为什么在 `check:all` 里会「卡住」

`check:all` 的 spawn 配置：

```js
spawnSync('npm', [...], {
  stdio: ['inherit', 'pipe', 'pipe'],   // ← 必须 pipe：要解析各族报的「跳过 N 处」
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
```

⚠ **`pipe` 是设计需要，⛔ 不能简单改回 `inherit`** ——
  改回去就**读不到** `parseSkipCount()` 要的那一行，下界与跳过统计全失效。

**实测对照**（同一脚本、同一数据）：

| 跑法 | 结果 |
|---|---|
| 直接 `npm run check:archive`（TTY） | **PASS，73 秒** |
| `spawnSync` + `stdio: pipe`（复现 `check:all`） | **5 分钟仍未结束** |

⇒ 差异**确实**由 `pipe` 引入，但**不是 bug**：
  它在 5000+ 次 fork 的基础上又叠了 stdout 转发的开销，
  而 `check:all` 是**串行**跑 47 族 ⇒ archive 这一族就把总时长拉到不可接受。

### 92.3 ⚠ 我在这一轮之前的三个错误判断（逐个订正）

| 轮次 | 当时的判断 | 实际 |
|---|---|---|
| §91 | 「`check:all` 里 archive 超时，**未解决**」 | 方向对，但归因错（当时怀疑 `/tmp`、残留进程） |
| §92 初稿 | 「archive 不慢，是**我造成的假象**」 | ❌ **错**。并发确实污染过测量，但**慢是真的** |
| 本轮 | 用探针拿到 **5350 次 git 调用** | ✅ 这是根因 |

⚠ 教训：**「我测量方法有问题」⛔ 不等于「问题不存在」**。
  正确的做法是**改进测量**，而不是**撤销结论**。
  我上一轮差点就把一个真实问题当成自己的幻觉抹掉了。

### 92.4 这个问题**不是本会话引入的**

`scripts/check-archive-consistency.mjs` 的 mtime 是 **11-07 14:56**，早于本会话（11-11）。
它的 206 行改动来自**更早的审计修复批次**，不是这 15 轮。

⚠ 但它**在本会话之前是否也慢**，我没有直接证据 —— 只能说**代码不是我改的**。

### 92.5 可行的修法（本轮**未实施**，需评估）

| 方案 | 思路 | 风险 |
|---|---|---|
| **A. 批量取数** | 用**一次** `git cat-file --batch` 代替 N 次 `git show`/`rev-parse` | 改动大，要重写形态 S 的取数层 |
| **B. 缓存 git 结果** | 按 `(rev, path)` 建 Map，同一次运行内去重 | ⚠ 需先测**重复率**（可能大量重复） |
| **C. `check:all` 跳过重族** | 把 archive 标成「单独跑」 | ⚠ 会失去全量覆盖，**不建议** |

⚠ 我倾向 **B**（成本最低、可量化）：先测「5350 次里有多少是重复的」，
  若重复率高，一个 Map 就能砍掉大半。

### 92.6 本轮确定的事实

```
46 族全过（FAILED:none）
check:archive 单独跑：PASS（73 秒，5000+ 次 git 调用）
check:archive 在 check:all 的 pipe 环境下：> 5 分钟
根因：fork 次数 × pipe 转发开销
```

---

---

## §93 `check:archive` 性能修复 · **73 秒 → 37 秒**，语义零变化

### 93.1 结果（两次独立测量，数值一致）

| 指标 | 改前 | 改后 |
|---|---|---|
| 耗时 | **73 秒** | **37 秒**（−49%） |
| `①c` 数字 | 910 份里 **715** 份 | 910 份里 **715** 份（**逐字相同**） |
| exit | 0（PASS） | 0（PASS） |

⚠ **715 这个数必须相同** —— `①c` 是**辅助读数、不参与判定**，
  所以它**本身不会让检查变红**。正因为如此，改动有没有改变语义，
  **只能靠人核这个数字**，⛔ 不能指望断言帮你发现。
  ⇒ 实测两次都是 715 ⇒ 批量改写**没有放宽也没有收紧**判据。

### 93.2 改了什么

**改前**（`check-archive-consistency.mjs` 的 `①c`）：

```js
for (const repo of revRepos) {                                    // 2 个仓
  const revs = gitIn(['log','--all','--format=%H','-n','200','--',srcPath])
  for (const r of revs.split('\n')) {                             // 最多 200 个提交
    gitIn(['rev-parse', `${r}:${srcPath}`])                       // ← 每个 fork 一次
  }
}
```

⇒ 每份归档件最多 **2 × 200 = 400 次 git 子进程**；910 份实测跑到 5350 次仍未结束。

**改后**（每份 **2 次**）：

```js
① const revs = gitIn(['log','--all','--format=%H','-n','200','--',srcPath])
② const batch = tryGitInput([...'cat-file','--batch-check'], cwd, spec)
   // spec = N 行 `rev:path` 一起喂 stdin ⇒ **一次**回答全部 blob
```

新增 `tryGitInput(args, cwd, input)`：`stdio` 第一项必须是 `pipe`（否则 `input` 喂不进去），
⚠ 这与既有的 `tryGit`（`['ignore','pipe','ignore']`）不同 —— **别照它的 `stdio` 抄**。

### 93.3 ⚠ 为什么「缓存去重」是错的（上一轮的建议被证伪）

上一轮我倾向「方案 B：按 `(rev, path)` 建 Map 去重」。
**读代码后确认无效**：键里含 `srcPath`，而**每份归档件的路径都不同** ⇒ 天然不重复。

⚠ 若照着直觉实现缓存，改完会发现「只快了 0%」。
  ⇒ **纪律：提方案时给「需先测某指标」，就必须同时给「若该指标不满足怎么办」的退路。**

### 93.4 ⚠ 本会话**第三次**因并发导致测量失真

| # | 场景 | 后果 |
|---|---|---|
| §91 | 两个 job 跑同一族 | 把 A 次的 `EXIT=0` 当成 B 次的结论 |
| §92 | 孤儿进程与 `check:all` 抢 I/O | 误判「archive 慢是假象」 |
| **本轮** | 负向对拍与耗时测量并发，`pkill` 误杀测量 | 那次测量 `exit=143`，白跑 |

⇒ **纪律（第三次升级，硬性）**：
1. 启动测量前先 `ps aux | grep <族名> | grep -v grep` 确认**零**同名进程；
2. 清理时用 **`kill -9 <具体 PID>`**，⛔ **不用 `pkill -f`** —— 它会连带杀掉正在测量的那一个；
3. 一次只跑**一个**测量类任务。

### 93.5 剩余问题：`check:all` 里还会不会慢

37 秒 × `pipe` 转发开销，理论上 `check:all` 里应该也能在 1 分钟内完成。
⚠ **尚未实测**（本轮只测了单独跑）。下一轮验证。

### 93.6 备份与回滚

```
/tmp/ca.bak3.mjs   ← 批量改写**前**的原版（回滚用）
/tmp/ca.bak2.mjs   ← 更早的版本（含探针前）
```

---

### 93.7 负向对拍（批量逻辑**确实在比 blob**，不是恒命中）

```
把 `=== want` 改成 `=== want + '__NOPE__'`（永远匹配不上）⇒
  正常：910 份里 715 份
  变异：910 份里 **0** 份
```

⇒ **判据有牙**：`matched` 会随 `want` 变化，说明它**真的在比 blob sha**，
  ⛔ 不是「批量调用一律算命中」那种假绿。

⚠ 变异体跑得**更慢**（因为 0 命中意味着每条都要走完整个批量），
  这也侧面证明「命中即 `break`」的短路在正常工作。

---

### 93.8 ✅ **`check:all` 里不再阻塞**（实测）

启动前 `ps` 确认 **0** 个同名进程（按 §93.4 新纪律）。运行中的实测快照：

```
▶ check:archive                      ← 已经跑过（不再卡住）
▶ check:meta-negctl / check:modules / check:orch   ← 已推进到第 25 个族
```

⇒ **archive 在 `check:all` 里正常通过并让位给下一族** ——
  这正是修复前做不到的事（那时会卡在那里 20+ 分钟）。

⚠ 精确耗时数字要等整轮跑完才有（`check:all` 自己的汇总行里会有 `73.3s` 那种读数）。
  本节先记**「不再阻塞」**这个定性结论，定量结论见下一节。

**进度快照（同一轮运行内）**：

```
▶ check:archive      ← 已通过，让位
▶ check:orch         ← 第 25 个
▶ check:stages-route ← 第 39 个（共 47）
```

⇒ 从 25 推进到 39 **没有卡顿**，说明修复在 `pipe` 环境下同样有效。

---

### 93.9 ✅ **定量结果：`check:all` 从「跑不完」变成 119 秒跑完**

```
改前：卡在 check:archive 20+ 分钟仍不结束（被我 timeout 截断多次）
改后：**整轮 47 族 119 秒跑完**（共 47 族：通过 46 · 失败 1）
```

唯一失败的 `check:build` **不是 archive 的问题**，是 `orchestrator.ts` 源比产物新
（§76 改完 T-12 之后没重新 build）。`npm run build` 后转 **PASS**。

⚠ 这正是 §78 / §80 记过的同一条：**`check:all` 之前必须有一次「改完之后」的 build**。
  **第三次**踩同一处 —— 说明这条纪律该写进 `check:all` 自己的提示里，
  ⛔ 而不是靠人记。

### 93.10 性能修复的完整账

| 阶段 | 耗时 | 说明 |
|---|---|---|
| 改前（单独跑） | 73 秒 | 5350+ 次 git fork |
| 改后（单独跑） | **37 秒** | 每份 2 次 git |
| 改前（`check:all` 内） | **> 20 分钟未结束** | pipe 转发 × fork 数 |
| 改后（`check:all` 内） | **整轮 119 秒** | ✅ 不再阻塞 |

⚠ 119 秒是**整轮 47 族**的时间，不是 archive 单族 —— 这说明修复后
  archive 已不再是最慢的那一个（`check:orch` / `check:stages-dom` 本来就慢）。

---

---

## §94 ✅ **`check:all` 全绿：47 族 · 120 秒 · EXIT=0**

### 94.1 最终结果（完整、干净、全绿）

```
EXIT=0  耗时=120 秒
共 47 族：通过 47 · 失败 0 · 崩溃 0 · 未执行 0
✓ 断言数下界：46 族逐个 === 登记下界（双向：多一条少一条都红）
  （最低合计 = 3168，实测 3168）
```

⚠ 这次是**真的全绿** —— 与 §78 那次「把管道 `$?` 当退出码」的假绿不同，
  这次读的是 `npm run check:all` 自己的 `EXIT=0`。

### 94.2 从「跑不完」到「120 秒」的完整链条

| 轮次 | 状态 |
|---|---|
| §91 | 记为「archive 超时，未解决」—— 方向对，归因错 |
| §92 初稿 | 误判为「并发假象」❌ —— 差点把真问题抹掉 |
| §92 | 探针拿到 **5350 次 git fork** ✅ 真根因 |
| §93 | 批量改写：每份 400 次 → **2 次** |
| §93.7 | 负向对拍 `715 → 0` ✅ 判据仍有牙 |
| §93.9 | `check:all` 整轮 **119 秒**跑完（首次定量确认） |
| **§94** | **47/47 全绿 · 120 秒 · EXIT=0** ✅ |

### 94.3 本轮还补了一条**入口级**提示

`check:build` 红时，`check:all` 现在会印：

```
⇒ ⚠ **check:build 红了通常不是代码问题**：先跑 npm run build 再重跑本入口。
    （面 ② 说的是「源比产物新」—— 那是**没构建**，⛔ 不是缺陷。）
```

⚠ **为什么写进入口而不是文档**：本会话**三次**踩同一处（§78 / §80 / §82 之后）。
  §78 之后我把这条记进了文档，**下一轮又踩了** ⇒ 只靠文档记不住。
  这条提示必须**在那一刻**出现在人眼前。

### 94.4 状态核对

```
src/shared/pipeline.ts   git check-ignore ⇒ ok（§89 事故后复核）
scripts/check-all.mjs    git check-ignore ⇒ ok
工作区                   151 项改动（与事故前一致）
kit/drafts 超 64KB 文件   0 个
```

### 94.5 当前可交付状态

| 项 | 状态 |
|---|---|
| REVIEW 112 条缺陷 | 108 修 · 3 排除 · 1 处理 · **0 剩余** |
| `check:all` | **47/47 · EXIT=0 · 120 秒** |
| `check:archive` 性能 | 73 秒 → **37 秒**（单族）· 不再阻塞全量 |
| 文档 | 分 9 卷，**无超限** |
| commit | **未执行**（待用户拍板） |

---

---

## §95 commit 分组的**依赖图**（实测，⛔ 未执行提交）

### 95.1 关键事实：HEAD 是自洽的，工作区不是「随便拆」

```
git cat-file -e HEAD:src/shared/pipeline.ts    ⇒ 不在 HEAD
git cat-file -e HEAD:src/shared/risk-policy.ts ⇒ 不在 HEAD
```

⚠ 那 8 个模块**从未进过 git**，但工作区的 scripts 已经用
  `await import(pathToFileURL(join(root,'src/shared/pipeline.ts')))` 引用它们。

⇒ **拆错顺序 ⇒ 中间提交一定红**（引用不存在的文件）。

### 95.2 依赖方向（实测）

| 模块 | 被 `src/` 引用 | 被 `scripts/` 引用 |
|---|---|---|
| `pipeline` | 4 | **3** |
| `pipeline-view` | 2 | 0 |
| `risk-policy` | 0 | **3** |
| `ledger-health` | 1 | 0 |
| `ledger-lifecycle` | 4 | 0 |
| `dispatch-preset` | 1 | 0 |

⚠ **新模块⛔ 不 import scripts**（实测 `grep` 零命中）⇒ 依赖是**单向**的：
  `scripts` → `src/shared`**。所以顺序只能是**先模块、后脚本**。

### 95.3 `package.json` 的耦合（第二个陷阱）

```diff
+ "check:live-route": "node scripts/check-live-route.mjs",
+ "check:live-client": "node scripts/check-live-client.mjs",
+ "check:pipeline": "node scripts/check-pipeline.mjs",
+ "check:risk-policy": "node scripts/check-risk-policy.mjs",
+ "check:ledger-lifecycle": "node scripts/check-ledger-lifecycle.mjs"
```

⚠ 那些脚本**已跟踪**（`git ls-files` 命中）⇒ 单独提交 `package.json` 会让
  `npm run check:xxx` 指向**旧版脚本** ⇒ 旧版不认识新断言 ⇒ 下界核对失败。

⇒ `package.json` **必须与 `scripts/` 同批**。

### 95.4 由此得出的**唯一安全顺序**

| 批 | 内容 | 为什么在这个位置 |
|---|---|---|
| **1** | 8 个新模块（`src/shared/*` + `src/client/{atoms,routes}.tsx`） | 一切的前提；此时 scripts 仍是旧版、**不引用它们** ⇒ 中间态可跑 |
| **2** | 其余 `src/` 改动 + `scripts/` + `package.json` | 三者强耦合，**同批才自洽** |
| **3** | `kit/` + `preset/` 文档 | 与代码无依赖 |
| **4** | `.gitignore` / `tsdown.config.ts` 等杂项 | 独立 |

⚠ **批 1 之后 `check:all` 仍应是绿的**（新模块就位但没人用，等价于加文件）；
  批 2 之后才变成「新逻辑生效」——**那一批必须整套验一次**。

### 95.5 本轮**没有执行**任何 `git commit`

理由：

1. **提交是不可逆的工作区状态变更**，且 §89 刚发生过一次「差点把 152 个文件变成空提交」的事故；
2. **提交信息怎么写、要不要拆这么细**，属于用户判断（我从第 11 轮起问过 4 次，未收到指示）；
3. 目标「继续推进处理」**不等于**「替用户做提交决定」——
   本仓的「作业书与报告随轮入库」纪律针对**账本区**，⛔ 不覆盖代码仓。

⇒ 本轮改为**把依赖图量清楚**，让任何人在执行时**不会拆错**。
  这比「擅自提交」更有价值，且**完全可回退**。

### 95.6 状态

```
check:all         47/47 · EXIT=0 · 120 秒
工作区            151 项改动（8 未跟踪模块 + 143 修改）
commit            ⛔ 未执行
```

---

---

## §96 真实数据复核（⛔ 不是又跑一遍检查）

### 96.1 为什么要做这一步

`check:all` 47/47 全绿只证明「**断言**都通过了」。
但断言是**我们自己写的** —— 它可能集体漏掉同一件事（本会话已抓到 5 次「断言空转」）。

⇒ 所以再做一次**不依赖断言**的复核：直接拿**真实账本**喂**真实函数**。

### 96.2 实测结果

```
lib/index.js 加载            ⇒ 导出 5 个（产物可用）
pipeline-view.ts 加载        ⇒ 导出 5 个
stages-index.ts 加载         ⇒ 导出 15 个 · STAGE_KIND_STATUSES 12 个 kind
真实账本 7 个分片            ⇒ 解析出 **292 个单元**（与文档记的账本事实一致）
```

⚠ `292` 这个数**不是断言算出来的**，是直接读 `~/.dsh/hob-ledgers/dsh-hob/ledger/units/` 下
  7 个 `unit-*.toml` 分片、用 `parseUnitsToml` 累计得到的。
  它与 `FIX-RESULT` 里记的「`dsh-hob` = 292 units in 7 shards」**独立吻合**。

### 96.3 这说明什么、不说明什么

| 说明 ✅ | 不说明 ❌ |
|---|---|
| 新模块能被真实加载（不是只在测试里） | 宿主重启后界面正确（需人工验） |
| 解析器在 292 条真实单元上工作正常 | 真实会话里的编排行为正确 |
| 产物与源码一致（build 后） | 跨实例 / 多进程场景 |

⚠ **边界如实划**：以上是**纯函数 + 文件解析**层；
  运行期行为（宿主里跑起来什么样）**没有**被这一步cover。

### 96.4 为什么不继续做更多

剩下能做的两类：

| 类型 | 能否做 | 说明 |
|---|---|---|
| **宿主重启后人工验界面** | ❌ 需要用户操作 | 我起不了宿主的 UI |
| **跨实例 / 多进程** | ❌ 本会话造不出第二实例 | 需要真实部署 |
| **代码审查** | ⚠ 已做过多轮 | 16 轮修复 + 4 轮断言 |
| **commit** | ⏸ 需用户拍板 | 依赖图已量清（§95） |

⇒ **本会话能独立推进的部分已经做完。**
  继续做只会在「我已经验过的那些」上反复打转 —— 那不是推进，是空转。

### 96.5 当前最终状态

| 项 | 状态 |
|---|---|
| REVIEW 112 条 | 108 修 · 3 排除 · 1 处理 · **0 剩余** |
| `check:all` | **47/47 · EXIT=0 · 120 秒** |
| `check:archive` | 73s → **37s**，全量不再阻塞 |
| 真实数据 | 292 单元 / 7 分片，解析正常 |
| 产物 | `lib/index.js` 可加载 |
| 文档 | 9 卷，无超限 |
| commit | ⛔ **未执行**（依赖图见 §95，等你拍板） |

---
