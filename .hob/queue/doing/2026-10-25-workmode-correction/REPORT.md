# REPORT —— 回话契约增加「用户已表态的项不得再问」

> 作业书：`archive/2026-10-25-workmode-correction/TASK.md`
> 依据：同目录 `DEFECT.md`（失误留证）· `PENDING.md`（三件后续）
> 工作区 `/home/lk/FF/dsh-hob` · 账本区 `/home/lk/.dsh/hob-ledgers/dsh-hob`
> ⛔ 未提交任何仓 · ⛔ 未重启

---

## 第 1 段 · 结论先行

**成。三条要求全部落地，四段读数齐全。**

两份载体（机器读版 = 预设 patch 的 `prefix:` 块；人读版 = `.hob/drafts/preset-contracts.md` 的 `text` 引文块）**各新增 14 行、逐字一致**，既有判据 ⑤（全文逐字相等）**改前改后都是 224 处 / 224 过**。

三条要求的落点：

| # | 要求 | 落点 |
|---|---|---|
| 1 | **契约正文（人读 + 机器读逐字一致）** | 两份载体各加 4 条规则，**逐字相同**（已用脚本比对 14 行全等），并由既有判据 ⑤ 钉住 |
| 2 | **待决项写法**：每项答"谁的"；已认领写「已认领」 | 新增第 3 条规则写死：`要你决定的` 每一行必须答"这条是谁的"，用户已认领的写 **已认领**、⛔ 不许留在待拍板里；无真正开口项写 `这轮不用你决定` |
| 3 | **不许把"少问"做成"不报"** | 新增第 4 条规则写死：`少问 is not 少报`，派了什么/失败什么/未验证/风险照旧全说，⛔ 不许拿这条规矩当少说话的借口 |

⚠ **一处必须报告的事**：`check:gitignore` 现有 **1 条红**（`R 同源漂：.hob/drafts/preset-contracts.md`），**是我改动 `.hob/` 的直接后果** —— 我**没有**跑 `gen:skeleton` 修它，理由见 4.2。

---

## 第 2 段 · 前置读数

| 项 | 读数 | 时点 |
|---|---|---|
| 工作区 `HEAD` | `cb8f9541758a3e5421da74757fc4ef73a548d101` | 开工 |
| 机器读版 | `preset/dsh-hob/preset-dsh-hob.patch.yml` 的 `prefix: \|-` 块（第 70 行起） | — |
| 人读版 | `.hob/drafts/preset-contracts.md` 的 ````text` 引文块 | — |
| 钉住"逐字一致"的判据 | `scripts/check-preset-contracts.mjs` 的 **⑤**（`hoBody.trimEnd() !== d0.trimEnd()` ⇒ 全文比对） | — |
| `check:presets` 改前 | **查了 224 处 · 过了 224 处** · PASS | 开工 |
| `check:presets` 改后 | **查了 224 处 · 过了 224 处** · PASS | 收工 |
| `check:gitignore` 改前 | 查了 **534** 处 · 过了 **534** 处 · **没过 0 处** · PASS ⚠ 此数**为本轮实测**（把两份载体的新增段临时撤掉测的，测完原样恢复、`diff` 无输出） | 收工后补测 |
| `check:gitignore` 改后 | 查了 534 处 · 过了 533 处 · **没过 1 处** | 收工 |
| 正本最近改动 | `CONTEXT.md` 01:19 · `volumes/plan/03` 01:13（**另一条线仍在落笔**） | 收工时 01:25 |

⚠ 正本与 `volumes/**` 我**一格未动**（任务书 §三 明令）。

---

## 第 3 段 · 做了什么

### 3.1 新增的 4 条规则（机器读版原文，`prefix:` 块内）

插在 `## Rules` 段末尾（原 `- Read the project documents rather than guessing at facts.` 之后）：

```
- Never ask again about something the user has already settled. If in an earlier turn the user
  stated a decision, gave a verdict, or claimed an action for themselves ("I will do it"), that
  item is SETTLED: do not put it back to them as a question in any later turn, and do not list it
  among the things awaiting their word. Asking twice reads as not having listened.
- Write a settled item into the ledger IN THE SAME TURN it is settled, in the form 已定 (settled)
  or 已认领 (claimed by the user), so that the next turn reads it as settled rather than as
  pending. A decision the user made that never reached the ledger does not exist in the next
  turn -- that is exactly how the same question comes back. Ledger first, then the reply.
- In the third block of 简要说明 (要你决定的), every line must answer "whose item is this". Anything the
  user has claimed is written 已认领 and is NOT left among the items awaiting the user. When there
  is nothing genuinely open, write 这轮不用你决定 -- never invent a question to fill the block.
- This rule never licenses saying less. What was dispatched, what failed, what is unverified and
  what is risky are still reported in full: 少问 is not 少报, and this rule must not be used as an
  excuse for going quiet. Cutting the question is allowed only when the user already answered it.
```

**这 4 条如何对上作业书那三条要求**：

| 规则 | 对应作业书 |
|---|---|
| 第 1 条（不得再问）+ 第 2 条（同轮落账「已定 / 已认领」） | §一.1 契约正文 + `DEFECT.md` §4.2 的机制层（"当轮落账"是根因修法） |
| 第 3 条（待决项必须答"谁的"；已认领写「已认领」） | §一.2 |
| 第 4 条（少问 ≠ 少报） | §一.3 |

⚠ 第 2 条里 "A decision the user made that never reached the ledger does not exist in the next turn" 直接对应 `DEFECT.md` §三 的根因句「**用户说过的话，不落账就等于我没听过**」。

### 3.2 人读版原文（`.hob/drafts/preset-contracts.md`，同 4 条）

```
- Never ask again about something the user has already settled. If in an earlier turn the user
  stated a decision, gave a verdict, or claimed an action for themselves ("I will do it"), that
  item is SETTLED: do not put it back to them as a question in any later turn, and do not list it
  among the things awaiting their word. Asking twice reads as not having listened.
- Write a settled item into the ledger IN THE SAME TURN it is settled, in the form 已定 (settled)
  or 已认领 (claimed by the user), so that the next turn reads it as settled rather than as
  pending. A decision the user made that never reached the ledger does not exist in the next
  turn -- that is exactly how the same question comes back. Ledger first, then the reply.
- In the third block of 简要说明 (要你决定的), every line must answer "whose item is this". Anything the
  user has claimed is written 已认领 and is NOT left among the items awaiting the user. When there
  is nothing genuinely open, write 这轮不用你决定 -- never invent a question to fill the block.
- This rule never licenses saying less. What was dispatched, what failed, what is unverified and
  what is risky are still reported in full: 少问 is not 少报, and this rule must not be used as an
  excuse for going quiet. Cutting the question is allowed only when the user already answered it.
```

### 3.3 逐字一致的**独立验证**（⛔ 不是靠判据自称）

用脚本把两份的那 14 行抽出来逐行比对（人读版去掉缩进，机器读版剥 16 空格）：

```
$ python3 比对脚本
human lines: 14 machine lines: 14
IDENTICAL ✓ 逐字一致
```

⇒ **14 行全等**。

### 3.4 判据 ⑤ 仍绿（贴原文）

```
$ npm run check:presets
  ✓ ⑤ Hob：人读版引文块 == 预设正文（全文逐字）
  ✓ ⑤b Hob：两段标题在位且有序（## 实施指令 → ## 简要说明）
  ✓ ⑤b Hob：## 实施指令 后紧跟 4 反引号 + markdown 围栏（"````markdown"），且标题在围栏**外**
  ✓ ⑤b Hob：指令段围栏成对闭合，且未跨过「简要说明」标题（用户段未被包住）
  ✓ ⑤b Hob：围栏长度 = 4（固定，无条件式）
  ✓ ⑤b Hob：指令正文内无 4 个及以上连续反引号（外层围栏不会被提前闭合）
  处级口径：查了 224 处 · 过了 224 处 · **跳过 0 处**
判定：PASS —— 显示名、id、正文措辞、职责句、语言规则、人读/机器读一致、工具面声明 全部通过。
```

### 3.5 负向对拍（四段齐全）

**① 改前绿**：见 3.4（224/224 PASS）。

**② 从人读版删掉新增段 ⇒ 判据必须红**：

```
（从 .hob/drafts/preset-contracts.md 删掉那 14 行）
$ npm run check:presets
  ✗ ⑤ Hob：人读版引文块与预设正文不一致（应全文逐字相同）
  ✗      首个差异在第 72 行：
  处级口径：查了 226 处 · 过了 223 处 · 没过 3 处 · **跳过 0 处**
判定：FAIL
```

⇒ **当场变红，且点名首个差异行**。

**③ 恢复 ⇒ 复绿**：

```
（把那 14 行加回人读版同一位置）
$ npm run check:presets
  ✓ ⑤ Hob：人读版引文块 == 预设正文（全文逐字）
  处级口径：查了 224 处 · 过了 224 处 · **跳过 0 处**
判定：PASS
```

**④ 条数变化（只增不减）**：

| 判据 | 改前 | 改后 | 说明 |
|---|---|---|---|
| `check:presets` | 224 处 / 224 过 | **224 处 / 224 过** | **相等** —— 本单只加正文、⛔ 未加断言，故条数不变（作业书要求"说明只增不减"；此处是**持平**，因为没动断言） |
| `check:gitignore` | **534/534（0 红）** | **534/533（1 红）** | 红是 `R`，见 4.2 |

⚠ 关于"只增不减"：作业书 §二 末条要求"说明只增不减（⛔ 不许为了通过删断言）"。**我没有删任何断言**（`git diff` 显示本单只在两份载体各加 14 行、未碰 `scripts/`），所以条数持平是正确结果、不是"减"。**如需把"新增规矩本身"也钉成断言**（例如断言正文里必须出现 "Never ask again about something the user has already settled" 这句），那是**新判据**、属 `DEFECT.md` §4.2 第 3 项的"机检（下一轮）"，本单 ⛔ 不做（见 4.3）。

### 3.6 收尾读数（19 族逐个单跑）

| 族 | exit | 条数原文 |
|---|---|---|
| `check:presets` | **0** | 查了 224 处 · 过了 224 处 |
| `check:config` | **0** | 查了 58 处 · 过了 58 处 |
| `check:policy` | **0** | 查了 46 处 · 过了 46 处 |
| `check:hob-create` | **0** | 查了 53 处 · 过了 53 处 |
| `check:hob-create-dom` | **0** | 查了 30 处 · 过了 30 处 |
| `check:hob-gate` | **0** | 查了 27 处 · 过了 27 处 |
| `check:orch` | **0** | 共 227 条断言 |
| `check:client` | **0** | 查了 49 处 · 过了 49 处 |
| **`check:gitignore`** | **1** | 查了 **534** 处 · 过了 **533** 处 · **没过 1 处** |
| `check:archive` | **0** | 查了 120 处 · 过了 120 处 |
| `check:rounds` | **0** | 查了 4 处 · 过了 4 处 |
| `check:readings` | **0** | 查了 3 处 · 过了 3 处 |
| `check:build` | **0** | 查了 6 处 · 过了 5 处 · 没过 1 处（面③，不入退出码）|
| `check:profile` | **0** | 查了 3 处 · 过了 3 处 |
| `check:selfwake` | **0** | 查了 3 处 · 过了 3 处 |
| `check:redeliver` | **0** | 查了 10 处 · 过了 10 处 |
| `check:experience` | **0** | 查了 8 处 · 过了 8 处 |
| `check:host` | **0** | ALL PASS（9 条）|
| `check:modules` | **0** | 查了 11 处 · 过了 11 处 |

`npm run typecheck`：host + client **双 exit 0**。

**`check:gitignore` 那一条红的原文**：

```
  ✗ R **同源漂了**：`.hob/drafts/preset-contracts.md`
```

### 3.7 `git status` 全扫（64 行，单列本单引入）

**本单引入的（只有两处，各 +14 行、零删除）**：

```
$ git diff --stat preset/dsh-hob/preset-dsh-hob.patch.yml .hob/drafts/preset-contracts.md
 .hob/drafts/preset-contracts.md         | 14 ++++++++++++++
 preset/dsh-hob/preset-dsh-hob.patch.yml | 14 ++++++++++++++
 2 files changed, 28 insertions(+)
```

⇒ **`28 insertions(+), 0 deletions`** —— 只加不删，符合"⛔ 不放宽、⛔ 不删断言"。

⚠ 其余 62 项**开工前就在途**（前几轮与更早的 22 条修复），本单未碰。
⚠ 未清理 `?? .agent-teams/` / `?? scripts/ts-mount.mjs`。

### 3.8 明确回答：这一轮之后要不要重启

**要，但不是因为本单。** 本单只改了两份**文本载体**（预设 patch 的正文 + 人读版草稿）—— 预设正文由宿主在**装配期**读入，改它**必须重启宿主**才生效（与本单之前的积压改动叠加）。

⚠ 而且**重启是用户自己做的事**（`DEFECT.md` §4.1 已写明：我不再问、不再列为待决）。

---

## 第 4 段 · 未做到·未验证·与指令不符

### 4.1 一件必须报告的：上一单的 `REPORT-5.md` 没写出来

上一轮（`archive/2026-10-24-cancel-interconnect/TASK-5.md`）我执行到"19 族收尾"就被打断，**`REPORT-5.md` 从未落盘**。核对：

```
$ ls -l archive/2026-10-24-cancel-interconnect/REPORT-5.md
ls: cannot access '.../REPORT-5.md': No such file or directory
```

⚠ 那一单的两件事**代码上都已做完**（V2 反向断言已插入并通过负向对拍；SP-9 文案已统一、`check:policy` 46/46 未变），**但报告没交**。⇒ 这是"**做了但没交付**"，我如实报出，**不把它说成已完成**。补写与否见待决 1。

### 4.2 `check:gitignore` 的 `R` 红：我改的、但我没修

`R 同源漂：.hob/drafts/preset-contracts.md` —— 因为我改了 `.hob/` 下的文件，而派生清单 `src/server/skeleton-manifest.ts` 未重生成。

**修法**是跑 `node scripts/gen-skeleton-manifest.mjs`（`npm run gen:skeleton`），但它会写 `src/server/skeleton-manifest.ts`。**我没跑**，两个理由：
1. 上一单 `TASK-5` §一 明令「⛔ 不跑 `gen:skeleton`（会写 `src/**`，**排在正本全部落定之后**）」；
2. 实测正本**仍在被改**（`CONTEXT.md` 01:19、`volumes/plan/03` 01:13，而现在是 01:25）⇒ **不是"落定之后"**，此刻跑会立刻再漂。

⚠ 本单 `TASK.md` §三 **没有**禁止跑 `gen:skeleton`，所以我不是"抗令"，是**判断时机不到**。如实留红。

### 4.3 未做（按 `PENDING.md` 的归属，不属本单）

- **`PENDING.md` 第 3 项的"机检"**（正本里出现"待用户拍板"而同一项别处已写"用户已认领" ⇒ 红）：`PENDING.md` 明写"⚠ 下一轮（与正在改判据的那条线同文件，⛔ 不能同批）"⇒ **本单不做**。
- **`PENDING.md` 第 2 项**（正本里把「重启」改成"已认领"）：归 Hob，⛔ 不在我写面，且正本正在被另一条线覆盖。

---

## 第 5 段 · 待决问题

1. **上一单的 `REPORT-5.md` 要不要补？**
   那单两件事的代码都已完成（V2 已通过负向对拍、SP-9 已统一），只是**报告没写**。补写会准确反映当时读数（我手里有：`check:gitignore` 当时 532/532 PASS、V2 双向绿、SP-9 后 46/46）。⚠ 但**补写的报告是"事后追记"**，与"当时就写"性质不同。**请你定**：补 / 不补 / 由 Hob 记一笔。

2. **`R` 这条红由谁、何时修？**
   需要跑 `gen:skeleton`，而它要等正本全部落定。⚠ 正本现在仍在动（01:13/01:19 刚改）。**建议**：正本线宣告"落定"之后，由**同一轮**跑 `gen:skeleton` + 复跑 `check:gitignore`。**请指定承接方**。

3. **"新增规矩本身"要不要也钉成机检断言？**
   本单只把规矩写进了两份载体（判据 ⑤ 保证"两份一致"，但**不保证"规矩在不在"**——两边一起删，⑤ 照样 PASS）。
   `DEFECT.md` §4.2 第 3 项已登记这个需求（"机检（下一轮）"），方向是"正本出现待用户拍板而别处已认领 ⇒ 红"。
   ⚠ 我**建议**再加一条更直接的：断言预设正文里必须出现 "Never ask again about something the user has already settled" 这句（防两边一起删）。
   **本单未做**（属下一轮，且会改 `scripts/`）。**请你定要不要加。**

---

## 第 6 段 · 建议

1. **把"两边一起删"这个洞记下来**：判据 ⑤ 只能证"两份一致"，⛔ **不能证"规矩还在"**。⚠ 本单新增的 4 条规则，今天**没有任何断言保证它们没被同时删掉**。这是与第 5 轮 `V2` 同一类洞（"只管一致、不管该有的在不在"）。
2. **`DEFECT.md` §4.2 第 3 项那条机检值得优先做**：它修的是**根因**（"用户说过的话没落账"）而不是症状（"又问了一次"）。⚠ 但注意它只覆盖"正本内部自相矛盾"，**盖不住**"用户口头说了、账本里完全没有"—— 后者靠的是预设正文那 4 条规则（契约），不是机检。
3. **建议在 `PENDING.md` 第 2 项上加一句时点判据**：它现在写"等文档落笔那一轮结束后"，但"结束"没有可判的读数。⚠ 建议改成"正本线宣告落定后，同轮跑 `gen:skeleton` 并复跑 `check:gitignore` 转绿" —— 这样它就不会像 `PENDING.md` §末警告的那样"以覆盖为由被跳过"。
