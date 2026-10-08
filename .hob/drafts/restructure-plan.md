# Hob 重构方案 v4（人读版 · 待用户过目）

> **出具方**：助手（Hob 侧）｜ **日期**：2026-10-08 ｜ **依据**：UD-73 · UD-75 · CHG-018 · CHG-019（本次）
> **性质**：**方案文档**。本文件**不改任何代码、不改任何预设、不改 PROJECT.md**。
> **落笔前状态**：HEAD `d755bde`，四命令全 exit 0，**待重启批次 = 空**。
>
> ## ⭐ v4 与 v3 的根本差别
>
> | | v3 | **v4（本次）** |
> |---|---|---|
> | Hob-Execute | **保留**，收缩为"薄适配层" | **删掉** |
> | 执行者 | 仍是 Hob-Execute | **任意会话** |
> | 账本位置 | 工作区内 `<项目>/.hob/` | **工作区外** `/home/lk/FF/.hob-ledgers/<工作区名>/` |
> | 账本边界 | 防"执行侧写账本"（协议约束） | **物理边界**（不靠协议） |
> | `read_contracts` | 读工作区内 `.md`（含项目文档） | **只读自己的账本** |
>
> **一句话**：**v3 靠"协议"约束边界，v4 把边界做成"物理位置"** —— 删掉第二个角色后，
> 协议约束失去对象；把账本搬到工作区外，隔离由**文件系统**保证，比任何契约都硬。

---

## 0. 一句话方案

**Hob 从"两个预设的规划侧"变成"唯一的规划侧 + 账本管理员"；执行交给任意会话；
账本按工作区派生到工作区之外的独立目录，物理隔离。**

---

## 1. 决定清单（逐条对应你的原话）

| # | 决定 | 你的原话 |
|---|---|---|
| **D1** | **删掉 Hob-Execute** | 「我就是觉得不需要保留 Hob-Execute 了」 |
| **D2** | **执行交给任意会话** | 「2 任意会话」 |
| **D3** | **账本外置，按工作区派生** | 「按工作区做区分就行了」 |
| **D4** | **父目录共用**（`/home/lk/FF/.hob-ledgers/` 下各工作区独立子目录） | 「确认」 |
| **D5** | **`read`/`glob`/`grep` 不限读** | 「Ai」 |
| **D6** | **放弃"读项目文档"** | 「这个可以不需要不读不影响」 |
| **D7** | **边界挂在账本目录**（不是工作区根） | 「在哪里调整边界就可以了」 |

---

## 2. 事实地基（全部实测）

| # | 事实 | 证据 |
|---|---|---|
| **F1** | **写侧结构本来就正确** | [hob-write.ts:375-379](src/server/hob-write.ts#L375-L379)：先算 `hobRoot = resolveInside(root, hobDir).abs`（**只取 `.abs`，丢弃 inside**），再判 `file` 在其内 ⇒ **边界已是账本目录，一行不用改** |
| **F2** | **读侧边界画错了位置** | [doc-read.ts:118-119](src/server/doc-read.ts#L118-L119)：`resolveInside(root, relPath)` 的 `root` 传的是**工作区根** ⇒ 换成**账本目录**即可（**逻辑不动，只换传参**） |
| **F3** | **静态 `hobDir` 做不到按工作区区分** | 实测三个项目 `resolve(工作区根, '../.hob')` **全落到同一目录** ⇒ 必须**按工作区名派生** |
| **F4** | **删 Hob-Execute 顺带消灭循环依赖** | [tools.ts:58](src/modules/tools.ts#L58) ↔ [work-deny.ts:50](src/modules/work-deny.ts#L50)；`work-deny.ts` 唯一消费者 [tools.ts:363](src/modules/tools.ts#L363) ⇒ 删它则**两条边同时消失** |
| **F5** | **三个机检脚本全部依赖 `.hob/` 内文件** | 三者 `root = join(here,'..')`；`check:presets` 读 [`.hob/drafts/preset-contracts.md`:73](scripts/check-preset-contracts.mjs#L73) · `check:experience` 读 [`.hob/EXPERIENCE.md`:59](scripts/check-experience.mjs#L59) · `check:gitignore` 断言 14 项 [`:98-104`](scripts/check-gitignore.mjs#L98-L104) ⇒ **账本一搬，三条全 exit 1** |
| **F6** | **账本目录不能用软链** | [hob-write.ts:386-391](src/server/hob-write.ts#L386-L391)：`lstat(hobRoot).isSymbolicLink()` ⇒ 拒绝写入 |

---

## 3. D1 + D2：删掉 Hob-Execute，执行交给任意会话

### 3.1 删除清单（实测引用）

| 物件 | 规模 | 处置 |
|---|---|---|
| `preset/dsh-hob/preset-dsh-hob-work.patch.yml` | **239 行** | 删文件 |
| [package.json](package.json) 的 `dsh.bundle.patch[2]` | 1 项 | 删该数组项 |
| `src/modules/work-deny.ts` | **121 行** | 删文件 |
| `WORK_PRESET_ID` / `WORK_MODEL_DENY` / `presetIdOf()` | 3 导出 | 删（消费者全在 work-deny 或 Hob-Execute 路径） |
| [tools.ts:58](src/modules/tools.ts#L58) import + [:363](src/modules/tools.ts#L363) 调用 | 2 处 | 删 |

✅ **顺带修复**：循环依赖消失（F4）。

⚠️ **`WORK_MODEL_DENY` 在 [preset/tools.ts](src/preset/tools.ts) 有消费者**（`grep` 实测）
⇒ **实施前必须逐个确认引用点**，不能整文件删。

### 3.2 交接协议保留（改为"对任意会话的约定"）

`TASK.md` → 用户搬运 → `REPORT.md` 的**格式约定保留**（否则回来的报告不可读），
但从"对 Hob-Execute 预设的约束"变成"**写在指令里的明确要求**"。
⇒ **需要新载体**：`.hob/templates/TASK.md` + `.hob/templates/REPORT.md`（v3 已列待建）。

---

## 4. D3 + D4：账本外置 + 按工作区派生

### 4.1 目标布局

```
/home/lk/FF/
├── dsh-hob/                          ← 插件本体（**不含账本了**）
│   ├── src/  preset/  scripts/  lib/
│   └── （.hob/ 已移出）
│
└── .hob-ledgers/                     ← 账本父目录（🆕 单独一个 git 仓）
    ├── dsh-hob/                      ← 工作区「dsh-hob」的账本
    │   ├── FACTS.md / DECISIONS.md / USER-DECISIONS.md / CONTEXT.md
    │   ├── EXPERIENCE.md / README.md
    │   ├── templates/  roles/  drafts/  backups/
    │   └── archive/<日期>-<slug>/{TASK.md, REPORT.md}
    └── <其它工作区>/                  ← 各自独立，零配置自动派生
```

### 4.2 派生规则（**必须按工作区名算，不能静态**）

```
账本目录 = <父目录>/<工作区目录名>
例：/home/lk/FF/dsh-hob → /home/lk/FF/.hob-ledgers/dsh-hob/
```

⚠️ **F3 已实测证明**：静态 `hobDir`（如 `../.hob`）会让**所有项目撞进同一目录**。
⇒ **必须新增派生逻辑**（v4 唯一的代码新增点）。

### 4.3 新增配置项

| 配置 | 含义 | 缺省 |
|---|---|---|
| **`ledgerHome`** | 账本父目录（绝对路径） | `/home/lk/FF/.hob-ledgers` |
| **`ledgerRoot`**（可选） | 直接指定本工作区账本目录（覆盖派生） | 空 = 按 `ledgerHome` + 工作区名派生 |

⚠️ **`hobDir` 去留**：建议**保留但降级为"账本目录名"**（默认 = 工作区目录名），避免二次迁移。
**实施时须逐个确认 `hobDir` 的 5 个引用点**：[tools.ts:95](src/modules/tools.ts#L95)/[:130](src/modules/tools.ts#L130)/[:233](src/modules/tools.ts#L233)/[:326](src/modules/tools.ts#L326) + [patch.yml:433](preset/dsh-hob/preset-dsh-hob.patch.yml#L433)。

---

## 5. D7 + D6：读侧边界改为账本目录

### 5.1 改动（**只换传参，不动逻辑**）

| 位置 | 现在 | 改成 |
|---|---|---|
| [tools.ts](src/modules/tools.ts) 的 `readContracts.execute` | `rootOf(cfg, exec)` → 工作区根 | **账本目录** |
| [doc-read.ts:118-119](src/server/doc-read.ts#L118-L119) | `resolveInside(root, relPath)` | **不动**（逻辑通用） |

✅ **F2 已确认**：这是 v4 里**最小的改动**。

### 5.2 ⚠️ 连带：**5 处契约文字会变失实**（必须同批改）

依据你项目的既有纪律（[EXPERIENCE](.hob/EXPERIENCE.md) 的"**契约不得挂着失效内容**"，
批 9 修过三处失实句）：

| 位置 | 原文 | 问题 |
|---|---|---|
| [patch.yml:73](preset/dsh-hob/preset-dsh-hob.patch.yml#L73) | `reading project documents, looking at workspace files, ...` | ❌ 读不到项目文档了 |
| [patch.yml:125](preset/dsh-hob/preset-dsh-hob.patch.yml#L125) | `Read the project documents rather than guessing at facts.` | ❌ **直接冲突** |
| [patch.yml:145](preset/dsh-hob/preset-dsh-hob.patch.yml#L145) | `reading -- project documents (.md), ...` | ❌ 失实 |
| [patch.yml:182](preset/dsh-hob/preset-dsh-hob.patch.yml#L182) | `or by reading the project documents you already have` | ❌ 失实 |
| [patch.yml:209](preset/dsh-hob/preset-dsh-hob.patch.yml#L209) | `read PROJECT.md and the ledgers, ...` | ⚠️ 半失实（账本仍可读） |

⚠️ **其中 2 处被机检钉住**，不同批改会 FAIL：
[check-preset-contracts.mjs:717](scripts/check-preset-contracts.mjs#L717)（`reading project documents (.md) and writing your own`）
· [:816](scripts/check-preset-contracts.mjs#L816)（`read PROJECT.md and the ledgers`）。

**⇒ 处置**：把"读项目文档"改为"**读自己的账本**"，并同步更新这 2 条断言期望值。

### 5.3 D5：`read`/`glob`/`grep` **不限读**（你选 i）

依据你的判据「**只动能改账本、不动其他的**」——防的是**改**，不是**读**。
⇒ 这三个通用工具**保持原样**。**本条为显式记录，避免将来被误当漏洞。**

---

## 6. 保留的现存守卫（逐条说明）

| 守卫 | 现状 | v4 后 |
|---|---|---|
| 写白名单 [hob-write.ts:152-175](src/server/hob-write.ts#L152-L175) | 只允许四本账本 + `archive/<日期>-<slug>/*.md` | ✅ 保留 |
| 骨架拒写（`README.md` / `templates/`） | 工具不可写骨架 | ✅ 保留 |
| `backups/` 工具自管 | 模型不可写 | ✅ 保留 |
| 软链守卫（读+写双侧） | 逐段 `lstat`，命中即拒 | ✅ 保留（F6） |
| 归档不可 overwrite | `archive/` 只增不改 | ✅ 保留 |

---

## 7. 影响面（**实测引用计数**）

| 文件 | `.hob` 引用 | 影响 |
|---|---|---|
| `scripts/check-gitignore.mjs` | **32 处** | MUST-TRACK/MUST-EXCLUDE 重构 |
| `.gitignore` | **25 处** | 账本不在仓库内 ⇒ 大批排除规则可删 |
| `scripts/check-preset-contracts.mjs` | **39 处**（+9 处 `.hob/`） | 路径字面值 + Hob-Execute 断言整组删除 |
| `.hob/drafts/preset-contracts.md` | **70 处** | 人读版镜像同步 |
| `PROJECT.md` | **45 处** | §3/§4.3/§5/§6/§9/§12 多节 |
| `.hob/README.md` | **17 处** | 目录树 + §1 二分表 |
| `scripts/check-experience.mjs` | **3 处** | 经验库路径 |

### 7.1 ⚠️ 三个机检脚本的出路（F5：账本一搬全断）

| 脚本 | 现在读 | v4 后的建议 |
|---|---|---|
| `check:presets` | `.hob/drafts/preset-contracts.md` | 人读版**留在仓库**（它是契约镜像，不是运行数据）⇒ 脚本路径**不用大改** |
| `check:experience` | `.hob/EXPERIENCE.md` | `EXPERIENCE.md` 是"跨项目经验库"（可分发）⇒ **建议留在仓库**，改路径常量 |
| `check:gitignore` | 断言 14 项 `.hob/*` | 账本外置后**大部分断言失去对象** ⇒ 见 §9 Q1 |

**⇒ 关键洞察**：**"账本"与"骨架"可以分开搬** ——
`drafts/`（契约镜像）、`EXPERIENCE.md`（经验库）、`templates/`、`roles/` 属**可分发骨架**，
**建议留仓库**；只有**运行数据**（四本账本 + `archive/` + `backups/` + `CONTEXT`）**外置**。

⚠️ **但这条与你的原话有出入**（你要的是"账本搬出去"）⇒ 见 §9 Q2。

### 7.2 账本单独 git 仓

外置的部分**不再受本仓版本控制** ⇒ 需在 `/home/lk/FF/.hob-ledgers/` **单独 `git init`**。

---

## 8. 未验证项（如实标注）

1. **`WORK_MODEL_DENY` 在 [preset/tools.ts](src/preset/tools.ts) 的引用点未定位** —— `grep` 显示有消费者，**实施前必须逐个确认**，否则编译失败。
2. **`spawn_teammate` 未真跑** —— 但 v4 **不再依赖它**（执行交任意会话），**风险降低**。
3. **派生逻辑实现方式未定** —— "`ledgerHome` + 工作区 basename" 还是 "配置显式指定"，实施时定。
4. **账本外置后目录名是否仍叫 `.hob`** —— 建议保留（减少迁移），新目录名可另取。
5. **未测跨工作区并发写** —— 物理隔离理论上无竞争，**未实测**。

---

## 9. 需要你拍板（**2 项**）

**Q1：`check:gitignore` 怎么处置？**

| 选项 | 做法 |
|---|---|
| **a** ⭐ | **重构**：断言改为"仓库内骨架仍在库"（保留防漂移能力） |
| **b** | **删除**（排除漂移问题消失）—— ⚠️ 丢掉 E-70/E-73 那类静默坑的防线 |
| **c** | 保留不改（会 FAIL，不可行） |

**Q2：搬多少？（§7.1 的洞察）**

| 选项 | 搬什么 | 留什么 |
|---|---|---|
| **x** ⭐ | **只搬运行数据**（四本账本 + `archive/` + `backups/`） | 骨架（`drafts/` `EXPERIENCE.md` `templates/` `roles/` `README.md`）**留仓库** |
| **y** | **整个 `.hob/` 全搬**（你原话的字面意思） | 仓库不再有 `.hob/`；骨架进账本仓 |

⚠️ **x 的好处**：三个机检脚本**基本不用改**（它们读的都是骨架），`check:gitignore` 也还能用。
⚠️ **y 的好处**：更彻底的隔离；**代价**：三个脚本全要改路径 + `.gitignore` 25 处重写。

---

## 10. 实施顺序（**9 步**）

| 步 | 内容 | 状态 |
|---|---|---|
| **1** | 抽取角色簇与门禁 → `ROLES.md` / `GATES.md` / `roles/methods/` | ✅ 已完成（`97bcf0e`） |
| **2** | 隔离实测 `dsh-expert-mode` | ✅ 已完成（`F-J119`） |
| **3** | 建账本父目录 + 迁移（按 Q2 的范围）+ 单独 `git init` | ⏳ 待办 |
| **4** | 写派生逻辑（`ledgerHome` + 工作区名）+ 读侧换根 | ⏳ 待办 |
| **5** | 删 Hob-Execute（patch + package.json + work-deny + 3 符号 + 循环依赖） | ⏳ 待办 |
| **6** | 5 处失实句改正 + 2 处机检断言同步 + 三脚本路径 | ⏳ 待办 |
| **7** | 建 `TASK.md` / `REPORT.md` 模板 | ⏳ 待办 |
| **8** | 文档同步（§7 的 7 个文件）+ 四命令全 exit 0 + 一次提交 | ⏳ 待办 |
| **9** | **由你重启** ⇒ 真机复核 | ⏳ 待办 |

⚠️ **第 9 步前，一切"已生效"的说法都不成立**（R-1 / R-5）。

---

<!-- v1 · 初版（Hob-Execute 升级为项目组）
     v2 · §3/§4 改为引用 ROLES.md / GATES.md（UD-75）
     v3 · 反转为「薄适配层」；F1b/F5（F-J119）
     v4 · 删 Hob-Execute + 账本按工作区派生外置 + 读侧换根（用户 D1–D7） -->
