# 增长表登记册 —— 每张表「到顶怎么办」

> ⚠ **本件是「会增长的表 / 文档」的实测登记册**（**第 212 轮**按 `UD-115` 立）。
> ⚠ **为什么放在 `drafts/`**：⚠ 本件含**本项目专有**的文件名与读数 ⇒ ⚠ 按 `.hob/README.md` §1.2，
>   `drafts/` 是**本项目自己的**契约正文（⛔ 不是拿给别项目用的模板）⇒ 允许专有内容。
> ⚠ **可复用的那一半**（"会增长的表要设计期就写到顶动作"这条规矩）在 **`.hob/INIT.md` §3.2.2**。
> ⚠ **本册的读数是"某一刻"的**：⚠ 要现读数 ⇒ 跑 `stat -c%s <件>` 或 `wc -c`（⛔ 别照抄本表）。

| 侧 | 文件 | 节 | 增长源（什么事件使它 +1） | 现读数（字节） | 余量 | 到顶动作 | 谁执行 |
|---|---|---|---|---|---|---|---|
| 账本 | `CONTEXT.md` | §5.1 轮次与落点 | 每轮 +1 行 | 48743 | 16793 | **一轮一文件**（⚠ 已落地：`volumes/context/rounds/`）—— ⛔ 本表已不持有行 | `check:rounds` |
| 账本 | `CONTEXT.md` | §0.6 收口表 | 每批 +1 行 | 48743 | 16793 | **滚动窗口**：只留当期未收口项；⚠ **先归档再截**（R-17）；⚠ 到期项整行移进 `volumes/context/` | `check:doc-shape`（M 读上限） |
| 账本 | `CONTEXT.md` | §2.4 在途 / 待决表 | 每立案 +1 行 | 48743 | 16793 | **滚动窗口**：结项即移出（⚠ 先归档再截）；⚠ 长期项整行移进 `volumes/context/05-known-boundaries.md` | `check:doc-shape`（M 读上限） |
| 账本 | `CONTEXT.md` | §2.3 未验证表 | 每项 +1 行 | 48743 | 16793 | **滚动窗口**（同上）；⚠ 已收口项整行移出 | `check:doc-shape`（M 读上限） |
| 账本 | `PROJECT.md` | 文件头「归档指针」列 | 每次归档 +1 行 | 11059 | 54477 | **另起一册**：整块搬进 `volumes/plan/` 的新件，原位留指针（⚠ 先归档、再留指针） | `check:doc-shape`（D：具名归档引用须存在） |
| 账本 | `PROJECT.md` | §正文各表 | 每加一块 +1 行 | 11059 | 54477 | **分区**：按主题切进 `volumes/plan/`（⚠ 已在进行中：`volumes/plan/` 即其分区） | `check:doc-shape`（M 读上限） |
| 账本 | `DECISIONS.md` | §一 规约表 / §八 决策表 | 每条 +1 行 | 14569 | 50967 | ⚠ **本单 ⛔ 不动**（边界：改方案须用户批准）⇒ ⚠ **只登记**：建议 **分区**（按 CHG 编号段分册） | `check:doc-shape`（M 读上限） |
| 账本 | `USER-DECISIONS.md` | §一 约束表 + 其它分节 | 每条 +1 行 | 8161 | 57375 | ⚠ **本单 ⛔ 不动**（边界同 DECISIONS）⇒ ⚠ **只登记**：卷侧已用「一条一个文件」（`volumes/user-decisions/`（一条一个文件））⇒ ⚠ **建议本件也改成"索引 + 指向卷"** | `check:doc-shape`（M 读上限） |
| 账本 | `volumes/context/08-round-table.md` | §5.1 | 每轮 +1 行 | 5440 | 60096 | ⚠ **已改为指针**（本表已整表搬进 `volumes/context/rounds/`）⇒ ⚠ **本件不再增长** | `check:rounds` |
| 账本 | `volumes/context/06-checklist.md` | §二 移出行 → 槽位对照表 | 每次移出 +1 行 | 8247 | 57289 | **另起一册**：该表按"每次移出一批加一行"增长 ⇒ ⚠ 余量足（`8247 / 65536`）；⚠ **到顶动作 = 把历史批次整块搬进 `volumes/context/` 的新件并留指针** | `check:doc-shape`（M 读上限） |
| 账本 | `volumes/context/07-discipline.md` | 全文（逐条纪律） | 每立一条纪律 +1 段 | 24382 | 41154 | **另起一册**（⚠ 照该件自己的口径：「再移出 ⇒ 另起新件，⛔ 不往旧移出件里塞第二批」） | `check:doc-shape`（M 读上限） |
| 账本 | `volumes/user-decisions/INDEX.md` | 各分节表 | 每条用户决策 +1 行 | 10220 | 55316 | **派生**：卷里每份 `UD-nn.md` 就是实体 ⇒ ⚠ 到顶动作 = **索引按编号段分节 + 老段搬进 `volumes/user-decisions/` 的分册件** | `check:doc-shape`（L 索引两向完整） |
| 账本 | `volumes/decisions/INDEX.md` | 各分节表 | 每条决策 +1 行 | 8583 | 56953 | **分区**（同 INDEX 手法）；⚠ 先归档再截 | `check:doc-shape`（L） |
| 账本 | `volumes/plan/10-risks-and-discipline.md` | 风险表 | 每记一个风险 +1 行 | 22270 | 43266 | **另起一册**：已收口风险整行搬进 `archive/`，原位留指针 | `check:doc-shape`（M） |
| 账本 | `volumes/plan/12-glossary.md` | 术语表 | 每加一个术语 +1 行 | 7749 | 57787 | **分区**：按首字母 / 主题切进 `volumes/plan/` 的分册件 | `check:doc-shape`（M） |
| 骨架 | `.hob/README.md` | §5.1 纪律登记表 | 每立一条纪律 +1 行 | 59643 | 5893 | **整块搬走**（⚠ **本单已办过一次**：§3 归档索引 7382 字节整块搬进 `.hob/drafts/archive-index.md`）⇒ ⚠ 到顶动作 = **把 §5.2 详细说明整块搬进 `drafts/`** | `check:gitignore`（F：该表第 3 列须合法） |
| 骨架 | `.hob/README.md` | §5.2 各条纪律的详细说明 | 每立一条纪律 +1 段 | 59643 | 5893 | **整块搬走**进 `.hob/drafts/`（⚠ 照 §3 先例） | `check:doc-shape`（M 不扫骨架 ⇒ 未机器化） |
| 骨架 | `.hob/README.md` | §3 归档索引 | 每次归档 +1 行 | 59643 | 5893 | ✅ **本单已办**：整块搬进 `.hob/drafts/archive-index.md`（`cmp` 无输出） | `check:repo-rules`（断言 A） |
| 骨架 | `.hob/README.md` | §6.1 实况 | 每批改 +1 行 | 59643 | 5893 | **滚动窗口**：只留当前实况；⚠ 历史读数进 `archive/` | `未机器化`（⚠ 照实登记） |
| 骨架 | `.hob/EXPERIENCE.md` | 索引表（两个分节） | 每踩一个坑 +1 行 | 31550 | 33986 | **派生 + 另起一册**：⚠ 条目实体在 `.hob/experience/<编号>.md` ⇒ 索引到顶时按编号段分册；⚠ 另有 `exp:next-id` 取号 | `check:experience`（编号唯一连续 + 索引两向完整） |
| 骨架 | `.hob/INIT.md` | 全文 | 每加一条初始化口径 +1 段 | 20916 | 44620 | **另起一册**：⚠ 本件即"初始化清单"，到顶时按步骤分段搬进 `.hob/drafts/` | `check:doc-shape`（M 不扫骨架 ⇒ 未机器化） |
| 骨架 | `.hob/drafts/preset-contracts.md` | 全文 | 每加一条契约 +1 段 | 56754 | 8782 | **另起一册**：按契约族分册（`preset-contracts-*.md`）；⚠ 消费方路径须同批改 | `check:presets`（⑤k 等逐条断言） |
| 骨架 | `.hob/drafts/check-gitignore-guide.md` | 全文 | 每加一条机检口径 +1 段 | 19714 | 45822 | **另起一册**（同 preset-contracts 手法）；⚠ 到顶时须留指针回 `README §1.4` | `未机器化` |
| 骨架 | `.hob/drafts/archive-index.md` | 归档去向表 | 每次归档 +1 行 | 7967 | 57569 | **另起一册**：按年份 / 批次段分册（⚠ 本件自身即 §3 的到顶产物） | `check:archive`（形态 M/S 比对） |
| 骨架 | `.hob/templates/ROLES.md` | 角色表 | 每加一个角色 +1 行 | 14476 | 51060 | **分区**：按角色族拆分（⚠ 该件是**模板**，到顶时先看是否该只留格式、把实体移出） | `check:presets`（角色面断言） |

⚠ **上限从哪读**：⚠ 上述"余量"一栏按 **65536 字节**算（⚠ 该值**从预设行读**：`preset/dsh-hob/preset-dsh-hob.patch.yml` 的 `maxFileBytes`，⛔ 本册不硬编码为判据）。
⚠ **一处口径（据实说明）**：⚠ `M ✓ 读上限` 那条断言的分母是**账本侧**（根上的正本 + `volumes/**`）⇒ ⚠ **`.hob/**` 不在它的扫描面里** —— 骨架侧那些"余量"是**按同一上限人工读的**，⛔ 不是那条断言报出来的。
⚠ **未机器化的那几行**：⚠ 按 `E-120` 第 ④ 条，**照实写 `未机器化`**（⚠ 不是失败，是如实登记）。
