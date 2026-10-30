# Hob 重构方案 v4（人读版 · 待用户过目）

> ## ⚠⚠ **【历史方案 · 现状已变】—— 读之前先看这段**
>
> ⚠ **本文件是 2026-10-08 的方案原稿，文中"账本位置"那一整套结论已经被推翻。**
>
> | 本文件写的（2026-10-08） | **现行做法（2026-10-25 起）** |
> |---|---|
> | 账本在**工作区之外**：`/home/lk/FF/.hob-ledgers/<工作区名>/` | **各工作区自己的 `<工作区>/.hob/`** |
> | 父目录**共用**，一个父目录下各工作区独立子目录 | **不共用**：由工作区**路径**直接拼，⛔ 不经过工作区名 |
> | 账本目录**自己是一个独立 git 仓根** | **不是**：它在工作区仓内（`.gitignore` 只窄排除 `runtime/` `backups/`） |
>
> ⚠ **所以本文件里的 7 处 `/home/lk/FF/.hob-ledgers` 路径、以及 `ledgerHome` 那个键的语义，都不要照抄。**
> ⚠ **现行的口径在哪**：`kit/README.md` §1（骨架 vs 运行数据）、`kit/INIT.md` §2（派生规则）、
> 以及 `src/server/doc-read.ts` 的 `resolveLedgerRoot`（**唯一实现点**）。
>
> ⚠ **为什么不直接改这份文件**：它是**2026-10-08 的决策原稿**，7 处路径是它**论证的一部分**
> （"为什么要把账本搬出工作区"那一整段逻辑就架在这些路径上）。
> ⇒ 改成实况会**制造一份"当时就这么想"的假文件**；⛔ 历史文件不改，只加这段声明。

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
| **F5** | **三个机检脚本都从 `.hob/` 读文件；但读的**全是骨架** | 三者 `root = join(here,'..')`；`check:presets` 读 [`.hob/drafts/preset-contracts.md`:73](scripts/check-preset-contracts.mjs#L73) · `check:experience` 读 [`.hob/EXPERIENCE.md`:59](scripts/check-experience.mjs#L59) · `check:gitignore` 断言 14 项 [`:98-104`](scripts/check-gitignore.mjs#L98-L104)。⚠️ **Q2=x 后这三处都属骨架、全部留库** ⇒ 前两个脚本**完全不受影响**，只有 `check:gitignore` 里**四本账本**那几条要动（§7.1） |
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
├── dsh-hob/                          ← 插件本体（**保留骨架 `.hob/`**）
│   ├── .hob/                         ← **骨架**（README / templates / roles / drafts / EXPERIENCE.md）
│   ├── src/  preset/  scripts/  lib/
│
└── .hob-ledgers/                     ← 账本父目录（🆕 单独一个 git 仓）
    ├── dsh-hob/                      ← 工作区「dsh-hob」的**账本数据**
    │   ├── FACTS.md / DECISIONS.md / USER-DECISIONS.md / CONTEXT.md
    │   ├── backups/
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

### 5.2 ✅ 修正：**那 5 处契约文字并未失实**（实施时实测推翻，**不改**）

> ⚠ **本节初稿判断错误，已按实测定正**（教训同 §9：**先查再断言，不要自己发明判据**）。

初稿声称放弃 `read_contracts` 读项目文档后，契约里 5 处「read the project documents」
会失实、且 2 处被机检钉住必须同批改。**实测推翻了这个判断**：

| 事实 | 读数 |
|---|---|
| Hob 白名单里**仍有**通用 `read` / `glob` / `grep` / `read_image` | 实测（`MODEL_TOOL_ALLOWLIST` 抽取） |
| 通用 `read` 按**会话 cwd** 解析路径 | `dsh-tool-fs` 的 `session-cwd` 段 |
| 会话 cwd = 工作区根 ⇒ **项目文档照样读得到** | `PROJECT.md` 实测存在且可读 |

**⇒ 结论**：`read_contracts` 改为只读账本，**只是那条专用通道收窄**；
Hob 读项目文档的能力**由通用 `read` 承担，并未消失**（这正是 D5「不限读」的结果）。
⇒ **那 5 句无需改动**；`check-preset-contracts.mjs:692` 与 `:791` 两条断言**本来就 PASS**，一条未动。

⚠ **诚实边界**：本修正依据的是**静态事实链**（白名单 + 路径解析 + 文件存在），
**未做真机调用验证**（需重启后由 Hob 实际读一次 `PROJECT.md`）。

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

### 7.1 ✅ Q2 = x 已定：三个机检脚本的实际影响（**修正版**）

**关键**：三个脚本读的都是**留库骨架**（不是账本数据）⇒ `check:presets` / `check:experience` **完全不受影响**。

| 脚本 | 读什么 | 归属 | Q2=x 后 |
|---|---|---|---|
| `check:presets` | `.hob/drafts/preset-contracts.md` | **骨架（留库）** | ✅ **完全不受影响** |
| `check:experience` | `.hob/EXPERIENCE.md` | **骨架（留库）** | ✅ **完全不受影响** |
| `check:gitignore` | 断言 14 项 `.hob/*` | **混合** | ⚠️ 只需改**四本账本**相关断言 |

**`check:gitignore` 的具体改法**（Q1 = a，**重构而非删除**）：

| 现有断言 | 归属 | 处置 |
|---|---|---|
| `.hob/README.md` · `templates/*` · `roles/**` · `drafts/**` · `.hob/EXPERIENCE.md` | **骨架** | ✅ **保留**（仍在库，仍需防漂移 E-70/E-73） |
| 四本账本（`FACTS`/`DECISIONS`/`USER-DECISIONS`/`CONTEXT`） | **数据，外置** | ⚠️ **断言方向反转**：从"必须入库"改为"**必须不在库**"（防回迁）· 或逐条标注理由后删 |

⚠️ **诚实修正**：§7 表里的 **`check:gitignore` 32 处**是**文件内 `.hob` 字符串出现次数**，
**不等于都要改** —— 实际要动的只有**四本账本**那几条。**上表是"最大估计"，本表是实际范围。**

### 7.2 账本单独 git 仓

外置的**数据**不再受本仓版本控制 ⇒ 需在 `/home/lk/FF/.hob-ledgers/` **单独 `git init`**。
（资产仍在原仓，**遗产版本历史不丢**。）

---

## 8. 未验证项（如实标注）

1. **`WORK_MODEL_DENY` 在 [preset/tools.ts](src/preset/tools.ts) 的引用点未定位** —— `grep` 显示有消费者，**实施前必须逐个确认**，否则编译失败。
2. **`spawn_teammate` 未真跑** —— 但 v4 **不再依赖它**（执行交任意会话），**风险降低**。
3. **派生逻辑实现方式未定** —— "`ledgerHome` + 工作区 basename" 还是 "配置显式指定"，实施时定。
4. **账本外置后目录名是否仍叫 `.hob`** —— 建议保留（减少迁移），新目录名可另取。
5. **未测跨工作区并发写** —— 物理隔离理论上无竞争，**未实测**。

---

## 9. 决策已定（用户授权「你来决策」）

### Q1 = **a（重构 `check:gitignore`）**

**理由**：b（删除）会丢掉 **E-70 / E-73** 那类**静默漂移**的防线 —— 那两次是**实测踩过的真坑**
（69 条经验不入库 / 已入库文件被静默排除）。本项目纪律是「**改判据，不放宽**」（§6）；
删掉一个**已经抓过两次真问题**的守卫，属于拆东墙。

### Q2 = **x（数据外置、骨架留库）**

| 搬什么（**数据**） | 留什么（**骨架**） |
|---|---|
| 四本账本（`FACTS` / `DECISIONS` / `USER-DECISIONS` / `CONTEXT`）· `archive/` · `backups/` | `README.md` · `templates/` · `roles/` · `drafts/` · **`EXPERIENCE.md`** |

**理由三条**：
1. **判据来自你项目自己的分类**（不是我发明的）：`.hob/README.md` §1 的两栏表已明写
   「**骨架** = 格式契约 / 可复用、可分发、新建工作区时用它初始化 ⇒ **进 git**」
   （[README.md:14](.hob/README.md#L14)），并把 `EXPERIENCE.md` / `templates/` / `drafts/` / `roles/`
   明确列在**骨架**栏；[check-gitignore.mjs:99](scripts/check-gitignore.mjs#L99) 亦称其为「**骨架 · 经验库**」。
2. **边界即代码**：`write_hob` 能写的**只有**四本账本 + `archive/` + 自管的 `backups/`
   （[hob-write.ts:32-41](src/server/hob-write.ts#L32-L41)），且 `SKELETON_FILES`/`SKELETON_DIRS`
   **显式拒绝**写骨架 ⇒ **「工具能写的 = 数据 / 工具拒写的 = 骨架」**，与 README §1 完全一致。
3. **副作用最小**：三个机检脚本读的都是**骨架** ⇒ `check:presets` **完全不受影响**；
   `check:experience`（读 `EXPERIENCE.md`，属骨架）**也不受影响**；
   只有 `check:gitignore` 中**四本账本**的断言需要反转。

**⇒ 结果**：`<仓库>/.hob/` **保留**（放骨架）；账本数据在 `<ledgerHome>/<工作区名>/`。两边**物理分开**。

⚠️ **修正记录（诚实标注）**：本决策**初稿**曾把 `EXPERIENCE.md` 划入"数据（外置）"，
并声称判据是"`write_hob` 能写什么就搬什么"。**该判据不适用于 `EXPERIENCE.md`**
（grep 实测：它在 `hob-write.ts` 里 **0 命中**，本就不由 `write_hob` 写）；
按项目既有分类它是**骨架**。初稿的分类**已修正**。
⇒ 教训：**分类前先查项目自己的二分表，不要自己发明判据。**

⚠️ **一个已知的命名困扰（非阻塞）**：`<仓库>/.hob/` 仍在，但它**不再是账本**
⇒ 处置：在 `.hob/README.md` **首段写明**「本目录只放骨架；账本数据在 `<ledgerHome>/<工作区>/`」。
**本轮不改目录名**（改名会牵动 100+ 处引用）。

---

## 10. 实施顺序（**9 步**）

| 步 | 内容 | 状态 |
|---|---|---|
| **1** | 抽取角色簇与门禁 → `ROLES.md` / `GATES.md` / `roles/methods/` | ✅ 已完成（`97bcf0e`） |
| **2** | 隔离实测 `dsh-expert-mode` | ✅ 已完成（`F-J119`） |
| **3** | 建 `/home/lk/FF/.hob-ledgers/dsh-hob/` + 迁移**数据**（四本账本 + `archive/` + `backups/`）+ 单独 `git init` | ⏳ 待办 |
| **4** | 写派生逻辑（`ledgerHome` + 工作区名）+ 读侧换根 | ⏳ 待办 |
| **5** | 删 Hob-Execute（patch + bundle 项 + work-deny + 3 符号 + 循环依赖）⚠ **先确认 `WORK_MODEL_DENY` 的其余引用点** | ⏳ 待办 |
| **6** | 5 处失实句改正 + 2 处机检断言同步 + `check:gitignore` 四本账本断言反转 | ⏳ 待办 |
| **7** | 建 `TASK.md` / `REPORT.md` 模板 + `.hob/README.md` 首段写明"只放骨架、账本在 ledgerHome" | ⏳ 待办 |
| **8** | 文档同步（`PROJECT.md` / `preset-contracts.md` 等）+ 四命令全 exit 0 + 一次提交 | ⏳ 待办 |
| **9** | **由你重启** ⇒ 真机复核 | ⏳ 待办 |

⚠️ **第 9 步前，一切"已生效"的说法都不成立**（R-1 / R-5）。

### 10.1 🔒 实施时必须守住的三条（防拆东墙）

1. **不删强于"改"**：`check:gitignore` 是重构（Q1=a），**不许为省事而删**；
   若实施中发现某条断言**确实无对象**，逐条标注理由后删除，**不得整脚本删除**。
2. **数据迁移必须逐文件校验**：迁移 = 复制 + **比对字节数** + 确认新路径可读 + **才**删旧文件；
   迁移前后各跑一次四命令。**不许"搬完再看"**。
3. ⚠️ **本方案的实施动作不去改 `~/.dsh` 的内容** —— 这是一条**谨慎习惯**，**不是项目红线**。
   ⛔ **不得**用它去否决**别的插件**在 `~/.dsh` 下建立自己的状态目录
   （那是 DSH 生态的**常规做法**：`~/.dsh/` 本就是放扩展状态的地方）。
   ⚠ **本项目不设**"不准碰 `~/.dsh/**`"这类跨环境约束（**UD-76**）。

⚠️ **回滚路径**：迁移步骤若失败，旧 `.hob/` 数据**尚未删除**（因第 2 条是"先复制后删"）⇒
直接删掉新目录即可回到现状，**不产生不可逆状态**。

> ⚠️ **第三方插件的取舍口径（UD-76）**：本项目对 `dsh-expert-mode` 这类插件的取舍依据是
> **可移植性 + 零外部依赖**，**不是**"它碰了 `~/.dsh` 所以有毒"。按真实代价看：
>
> | 它的行为 | 真实性质 |
> |---|---|
> | `apply()` 在 `$DSH_HOME/router-standard/` 建目录 + 写 3 个小文件 | 🟢 **生态常规**（`~/.dsh/` 本就是放扩展状态的地方；`profiles/`、`skills/` 都在此） |
> | `rmSync` 递归清理 | 🟡 只清**它自己的**预设目录（`lib/index.js:61-64`，**跳过 `.git`**），且**只在安装动作**里跑 |
> | 改写 `?v=` 查询号 | 🟡 动的也是**它自己预设**的文件；且是**按需调用**的工具 |
>
> ⇒ **它基本上只动自己的东西。**
> **真实约束**是 **UD-73③ 可移植性**（外部插件换环境就没有 ⇒ 只能作**可选增强层** +
> 必须有**降级路径**）—— 那条是用户原话，**继续有效**。

---

> ⚠️ **本方案的实施状态**：第 1–9 步均已落地；**生效判据以实测为准**（`git log` / 四命令退出码 /
> 实例加载后的行为读数）。⚠ 本文件是**方案文档**，其"待办"列是**书写时刻**的读数 ——
> 要最新值一律命令实测。
