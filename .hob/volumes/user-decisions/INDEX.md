# 卷索引 · user-decisions

> 一条一个文件（`<编号>.md`），**写一次固定**；要改就写新的一条去取代。
> ⚠ **两向完整**由收尾的「索引两向完整」那条断言盯着：索引点到的必须在、卷里的必须被点到。
> ⚠ **状态**写条目内「状态」行的**首段词**（如 active / superseded）；判不出来写 `—` 并列入回报，⛔ 不猜。
> ⚠ ⚠ **★ 加行必须用 `overwrite`，⛔ 不许用 `append`**：本文件是"表 + 板块"结构，`append` 会把新行写到文件末尾、
> 与所属表之间隔空行 ⇒ 成"孤立表行" ⇒ 判据 `P2` 当场红。正确做法 = **把该行插进它所属板块的表内**。
> ⚠ ⚠ **★ 写完一条决策 ⇒ 同一轮必须把索引行也写上**（已连漏两次，主干留过红）。

## 一、定位与形态

| 编号 | 标题 | 状态 | 文件 |
|---|---|---|---|
| UD-01 | 形态：装在 profile 内的插件 | — | `volumes/user-decisions/UD-01.md` |
| UD-03 | 通信范围：先做同实例 | — | `volumes/user-decisions/UD-03.md` |
| UD-04 | 旧项目归档，新项目用原路径同名 | — | `volumes/user-decisions/UD-04.md` |
| UD-09 | 方案落笔为正式基线 | — | `volumes/user-decisions/UD-09.md` |
| UD-73 | 授权助手自行决定重构方案 + 可移植性约束 | active（方案已出并实施） | `volumes/user-decisions/UD-73.md` |
| UD-76 | 本项目只管自己的账本，不替整个环境立规矩 | active | `volumes/user-decisions/UD-76.md` |
| UD-155 | **（现行）** 本项目**本身就是管理项目的插件** ⇒ 规则 / 判据口径 / 框架骨架凡属"任何被协助项目都该遵守"的，**必须做成可复用层随插件分发**，⛔ 不许只落在本项目账本；⚠ 本项目专属的东西仍只属于本项目；⚠ 每项账本改动须同批回答"这条要不要跟着走、走到哪件载体" | active | `volumes/user-decisions/UD-155.md` |
| UD-159 | **（现行）** **骨架材料（骨架说明 / 模板 / 角色方法论 / 契约）不每工作区一份** —— 它们是**插件自用的工作材料**，插件自带一份即可；⚠ **只针对骨架材料**：账本不是骨架材料、每个项目必须各有一份；⚠ 由此**骨架清单 / 生成器 / 逐件审查 / 首次使用铺骨架 的存在前提消失大半**，可退役（⚠ 会改写 `UD-118` 的范围） | active | `volumes/user-decisions/UD-159.md` |
| UD-160 | **（现行）** **账本目录定为 `<工作区>/.hob`**（用户拍板，取代 `CHG-073` 选的 `ledger/`）；**骨架模板等工具材料改放插件自己那份**（"项目本身的一部分"），**具体落点授权 Hob 自决**（已落 `CHG-074`：插件仓 `kit/`）；⚠ 本条**拆掉了 `CHG-073`"⛔ 不许进 `.hob/`"的前提** —— 骨架不再往工作区放 ⇒ `.hob/` 空出来 ⇒ 从此只有一层含义 = 项目自己的账本 | active | `volumes/user-decisions/UD-160.md` |

## 二、范围：做什么、不做什么

| 编号 | 标题 | 状态 | 文件 |
|---|---|---|---|
| UD-02 | 只做核心沟通能力，Orb 与悬浮球挂起 | — | `volumes/user-decisions/UD-02.md` |
| UD-14 | 产出显示：就在会话里 | — | `volumes/user-decisions/UD-14.md` |
| UD-56 | 助手不要代码开发类工具 | — | `volumes/user-decisions/UD-56.md` |
| UD-67 | 能力扩展范围定稿（只做三项） | — | `volumes/user-decisions/UD-67.md` |
| UD-72 | 能力补足多选裁定 | — | `volumes/user-decisions/UD-72.md` |
| UD-94 | 先集中精力收口"账本可读性"，暂不进 M6 | — | `volumes/user-decisions/UD-94.md` |

## 三、角色与分工

| 编号 | 标题 | 状态 | 文件 |
|---|---|---|---|
| UD-08 | 助手职责边界：只梳理，不写代码 | — | `volumes/user-decisions/UD-08.md` |
| UD-10 | 预设分工：一个做规划、一个干活；用预设做权限隔离 | — | `volumes/user-decisions/UD-10.md` |
| UD-13 | 权限：尽可能完全收敛，但助手要能维护自己的文档 | — | `volumes/user-decisions/UD-13.md` |
| UD-59 | 授权助手自行推进项目完善 + 收尾时做一次全项目审查 | — | `volumes/user-decisions/UD-59.md` |
| UD-157 | **（现行）** **已给的常设授权不是一次性的**：技术判断 / 工程取舍 / 口径细节 **一律自决、⛔ 不再问**；只能问用户的**四类**＝产品方向 · 两条**都真能走**的路之间的取舍 · 范围（做不做）· 代价风险承受度。⚠ **硬闸**：写进"要你决定的"之前必须点名它属于哪一类，**点不出来就是我的**；⚠ 伪分类警报：「要不要一起做」多数是**顺序与成本**（我的），⛔ 不是范围 | active | `volumes/user-decisions/UD-157.md` |

## 四、账本与文档

| 编号 | 标题 | 状态 | 文件 |
|---|---|---|---|
| UD-74 | 每个被协助项目各建自己的账本 | active | `volumes/user-decisions/UD-74.md` |
| UD-83 | 账本 = 当前状态，不堆历史 | — | `volumes/user-decisions/UD-83.md` |
| UD-84 | 账本结构改为「方案 + 三本」：删掉事实账 | — | `volumes/user-decisions/UD-84.md` |
| UD-88 | 文档归属：项目方案与三本账本同置账本区（工作区之外） | ⚠ **已被 UD-160 取代（落点改回工作区内）** | `volumes/user-decisions/UD-88.md` |
| UD-89 | 账本区根目录只放"当前状态"：遗留一律归入 `archive/` | — | `volumes/user-decisions/UD-89.md` |
| UD-86 | 账本区搬到 `~/.dsh` 之下 | ⚠ **已被 UD-160 取代（落点改回工作区内）** | `volumes/user-decisions/UD-86.md` |
| UD-87 | 搬迁方式改判（方向不变） | — | `volumes/user-decisions/UD-87.md` |
| UD-32 | README 未定义的 4 类文件显式写进二分表 | — | `volumes/user-decisions/UD-32.md` |
| UD-33 | 新增 `check:gitignore` 断言脚本 | — | `volumes/user-decisions/UD-33.md` |
| UD-34 | `check:gitignore` 纳入每轮收尾必跑 | — | `volumes/user-decisions/UD-34.md` |
| UD-35 | 「入库物不得依赖不入库文件」写成通用纪律 | — | `volumes/user-decisions/UD-35.md` |
| UD-36 | `drafts/` 不改名 | — | `volumes/user-decisions/UD-36.md` |
| UD-22 | 读侧软链口径：一律拒 | — | `volumes/user-decisions/UD-22.md` |
| UD-95 | 账本与方案改为「地图＋分卷、一事一文件」；骨架侧同批做 | active | `volumes/user-decisions/UD-95.md` |
| UD-96 | 指令以方案为准：回传只是参考、不是新一轮的需求来源（缺口先登记，挡住目标才开轮） | active | `volumes/user-decisions/UD-96.md` |
| UD-97 | 推进优先：以方案为参考底色、以用户当前会话任务为核心（回传只能作为参考） | active | `volumes/user-decisions/UD-97.md` |
| UD-98 | 地图标准三条：按板块分区 · 每板块一句话说明是什么 · 读完知道整体与去哪读 | active | `volumes/user-decisions/UD-98.md` |
| UD-99 | 账本要干净：分卷之前的账本须有完整概况 + 完整分卷表；**每次改账本 = 一次整体重构** | active | `volumes/user-decisions/UD-99.md` |
| UD-101 | 用户提出的项目改动：必须审方案落点、落到方案本体；方案改动一律整份重构 | active | `volumes/user-decisions/UD-101.md` |
| UD-104 | 只读检查出 4 处偏差 ⇒ 裁定按「A 方案」最小收口（只改正本自身，⛔ 不动机检 / 不改版本号 / 不改记录类原文） | active | `volumes/user-decisions/UD-104.md` |
| UD-105 | 方案 §11 收口：按「推荐」规模做（删已定稿 6 条 · 两份清单归一 · 补"卡在哪"；skill 侧已收窄 / AGENTS.md 未做） | active | `volumes/user-decisions/UD-105.md` |
| UD-106 | 「全部授权」：15 条待定项全交 Hob 处置（Hob 按刹车纪律筛出 Tier 1 先行落地：新增 P 组机检 + 修净 5 处） | active | `volumes/user-decisions/UD-106.md` |
| UD-107 | 项目终态澄清：Hob = 总助理（只沟通 + 管账本 + 检索网络 + 派任务给其他会话）；设计公理入方案 §1.3 | active | `volumes/user-decisions/UD-107.md` |
| UD-108 | `CONTEXT.md` 分卷腾预算：裁定取 (a) 只移 §5.1 四行（⛔ 不并归 §0.6 · ⛔ 不整节移出 §0.7） | active | `volumes/user-decisions/UD-108.md` |
| UD-109 | 实际审查"预设是否真按方案工作" ⇒ 裁定 A+B：修另一项目账本（261806→5330）+ 立编年体陷阱防线 | active | `volumes/user-decisions/UD-109.md` |
| UD-110 | 权限收缩裁定：只收「工作区文件读取」一族（白名单 30→26；skill/present 保留） | active | `volumes/user-decisions/UD-110.md` |
| UD-111 | §5.1 口径收紧裁定：只留 3 轮（原 5 轮实测不够；UD-108 的预测应验） | active | `volumes/user-decisions/UD-111.md` |
| UD-112 | 「先对照方案」：收到任何输入后的第一个动作固定为对照方案与账本 | active | `volumes/user-decisions/UD-112.md` |
| UD-114 | 轮次登记改「一轮一文件」：⛔ 不再往同一张表里逐行追加（滚出行丢失的根治） | active | `volumes/user-decisions/UD-114.md` |
| UD-115 | 会增长的表与文档：**设计之初就写明「到顶怎么办」** + 默认形态「一轮/一条一文件」+ 可搬运性 | active | `volumes/user-decisions/UD-115.md` |
| UD-116 | 换载体留缝的收口：**把「一轮一文件」的记录目录收进写入侧白名单** + 成对断言 + 写明"下次新目录怎么办" | active | `volumes/user-decisions/UD-116.md` |
| UD-117 | 「全部批准」：第 218 轮 §2.4 里七项**新增机制档待办全部放行**（拆两单：检查侧六组 + 落地面四组） | active | `volumes/user-decisions/UD-117.md` |
| UD-118 | 装机链路承担骨架：**由插件在「首次使用」时自动铺骨架**（裁定「C」；Hob 同批自定六条硬约束） | ⚠ **范围已被 UD-159 / UD-160 大幅缩小（只起空账本）** | `volumes/user-decisions/UD-118.md` |
| UD-119 | 「根据方案你自己决策」：Hob 据此裁定那五件待决 + **放行方案 §8 第 7 步（M6）** | active | `volumes/user-decisions/UD-119.md` |
| UD-120 | 重启已完成 + 其余按方案由 Hob 自行决策 | active | `volumes/user-decisions/UD-120.md` |
| UD-121 | 再次重启已执行 + 第 34 项裁定：**账本自动新建保持现状**（⛔ 不改成拒绝 / ⛔ 不要求确认；"看得见"那一半⛔ 不许回退） | active | `volumes/user-decisions/UD-121.md` |
| UD-122 | 派活口径：指令须说清"做什么 / 用什么技术方案 / 怎么做 / 最终效果"；**实施方发现与指令不符 ⇒ 立即停手汇报**（⛔ 不许自己找办法）；Hob 收到后**回方案核**（方案有问题改方案 / 指令有问题改指令，⛔ 不打补丁） | active | `volumes/user-decisions/UD-122.md` |
| UD-123 | 跨系统（M6b）**暂时不做**：⛔ 不开那两处放行（非回环监听 / 跨机文件面）· ⛔ 实施不动；⚠ 设计件留盘、将来从它继续；⚠ 连带的"实例真调用补测"同批挂起 | active | `volumes/user-decisions/UD-123.md` |
| UD-124 | **保留**「纯读数过期」的豁免（= `UD-122` 的甲/乙两档分界成立）：**做法/可行性不符 ⇒ 停手**；**纯读数过期 ⇒ 按实测办 + 登记**；⚠ 判据 = "要不要换一个做法"，**判不出 ⇒ 按停手办** | active | `volumes/user-decisions/UD-124.md` |
| UD-125 | Hob 自己写坏的账本件**由自己修**（⛔ 不必先报）；照既有纪律（备份 + 当轮记录件写清改了什么、凭什么） | active | `volumes/user-decisions/UD-125.md` |
| UD-126 | **派活口径修正**：作业书**只写三件**（**要落实什么 / 怎么验收 / 不许碰什么**），⛔ 不再写做法与步骤；⚠ **不影响方案主线的细节 ⇒ 开放给实施会话自定**；⚠ **全部提示词类信息须简单明确、⛔ 不许逻辑交叉** | active | `volumes/user-decisions/UD-126.md` |
| UD-127 | **存量厚重文本要精简**：范围 = 全项目提示词类文本；⚠ 先**只读体检出压缩方案**、再分批动手；⛔ **不许丢判据面 / 红线 / 停手口径** | active | `volumes/user-decisions/UD-127.md` |
| UD-128 | **整体提示词优化（⚠ 性质优化、⛔ 非只压体量）**：先**只读审计**、按四类归条；⚠ ⚠ **删除建议须先证明"没有任何机检读它"**；⛔ **本单不做 A/B 评估闭环** | active | `volumes/user-decisions/UD-128.md` |
| UD-129 | ⚠ ⚠ **会离开本项目的件（模板 / 骨架）须做逐字节审查**：⚠ **分发面 = 最高优先面**；⚠ **审查须逐跳给字节读数**；⚠ **逐件做"开箱即错"扫描**；⚠ **本面内 ⛔ 不许用"删后无变化即删"** | active | `volumes/user-decisions/UD-129.md` |
| UD-130 | ⚠ **放行"动判据脚本"**（放宽那道闸）：已放行四项；⚠ ⚠ **改判据面只许新增或加严，⛔ 不许放宽分辨力**（要放宽 ⇒ 停手报上来） | active | `volumes/user-decisions/UD-130.md` |
| UD-131 | **看板「待验收」卡收尾 = 状态整理**（用户已点头）：⚠ **把本项目 `in_review` 的卡标 `done`**；⛔ **不改代码 / 文档内容 / 项目本体**；⛔ **别的项目的卡 / 其它状态的卡 / `t-mvbeirov-5jkpst` 不许动** | active | `volumes/user-decisions/UD-131.md` |
| UD-136 | 项目定位升级：**按开源商用项目标准做规划**（对外可装 / 可升可卸 / 可配 / 可诊断 / 可贡献 / 不泄漏内部）；⚠ License / 版本号 / 发不发公共包仓 / 对外名称 **四件待用户裁** | active | `volumes/user-decisions/UD-136.md` |
| UD-137 | 派发/回传根治的三处裁定：**读数改「目标 + 登记时刻」**（⛔ 不给 `write_hob` 加轮次参数）· **档位取 D1 扩文件集改 `orch-state.ts`**（⛔ 不许 sidecar / ⛔ 借 `error` 字段）· **D2 成对收窄**（仍在跑⇒必须重挂 / 已空闲⇒必须不重挂 / 反证必须 FAIL） | active | `volumes/user-decisions/UD-137.md` |
| UD-138 | 对外交付面审计后的修复裁定（用户：「有问题就修复啊」）：**删空旋钮 `modules.preset`** · **`.hob/drafts/**` 不许整目录随包** · **`ledgerHome` 默认改相对派生** · **`DEFAULT_LAUNCHER` 不写死宿主路径** · **读工具失败带结构化原因**（对外文案可仍同一句）· **补齐对外最小面**（README / LICENSE / 元数据 / 聚合入口）；⚠ **三批串行，⛔ 不并行** | active | `volumes/user-decisions/UD-138.md` |
| UD-142 | 第三批收口三条裁定：**`ledgerHome` 取 A（值不动，只写"本实例取值、换机须改"）** · **`draft:77` 回归必须修（⛔ 不许用豁免让它变绿）** · **worktree 账本解析已另开卡** | active | `volumes/user-decisions/UD-142.md` |
| UD-143 | 第四张卡收口四条裁定：**合并** · **运行时口径必须同批接同一来源**（⛔ 不许判据绿、运行时认错）· **`dsh-hob.workspace.json` 必须进初始化清单**（否则新项目照旧落回猜名字）· **两条仓规登记不算动判据** | active | `volumes/user-decisions/UD-143.md` |
| UD-144 | 提示词压缩开工三裁定 + **新铁律「全绿 ≠ 可删」**：F9 格式张力**改我们这侧**（⛔ 不排除宿主注入）· F10 `/tmp` 矛盾**改 `INIT.md`**（⛔ 不动纪律）· 人读版 §三/四/五 **移出**（⛔ 不删）；⚠ **红线/停手条件/安全边界一类文本，不受"判据全绿"支持删除**；执行序改为 **批 0 = 先修 8 条失实文案** | active | `volumes/user-decisions/UD-144.md` |
| UD-145 | 重启前收口：**批 0–3 已落、到此是收尾点**（⛔ 批 4–7 不做）；⚠ **`check` PASS 只证明"机检不依赖它"，从不证明"它没价值"**（实例：540 B 安全告警段被救回）；⛔ **禁用 `git add -A`**（只许逐路径点名）· ⛔ **`/tmp` 判据是"有没有写"**；重启后按**五项清单**验 | active | `volumes/user-decisions/UD-145.md` |
| UD-146 | 判据漏洞五裁定：**`roles/` 覆盖缺口改用骨架清单双向量** · **嵌套注释单列**（⛔ 不混批 4）· **审计 `§3.5` 另起更正件**（⛔ 不改原件）· **`lcs.mjs` 虚报 ⇒ 沾过的那两节降级"待复核"**（⚠ 探针输出不是判据）· **变异工具只测删行 ⇒ 登记不修** | ⚠ **裁定一已被 UD-147 更正** | `volumes/user-decisions/UD-146.md` |
| UD-147 | **（现行）** 更正 UD-146 裁定一：**「16 份无牙」不成立** —— `roles/**` **18/18 全在骨架清单**，反向完整性有牙；假读数成因 = **「删文件 → `regen` → 跑判据」**，`regen` 按盘面重算把证据吃掉 ⇒ **⛔ 验"删文件会不会被发现"不许在 regen 之后跑判据**；**"零输出 + exit=0"是可疑信号**；该项待办**撤销**（⛔ 不扩 `mustTrack`） | active | `volumes/user-decisions/UD-147.md` |
| UD-148 | 两处读数口径 + **本轮停手**：**`dirty` 三句口径**（`false` 可信用 / `true` ≠ 缺陷要去看 `git status` / ⛔ 从不表示"实例用的是这一版"）⚠ 并入批 4 才写 · **`.hob/` 的 `!` 放行面是真缺口但 ⛔ 本轮不动**（要动判据面，且 R 组已有部分兜底）· ⛔ **不再派任何功能改动**，等重启验完再续 | active | `volumes/user-decisions/UD-148.md` |
| UD-149 | **（现行）** 「全自动」= **「自动」档连派活也自动**（判完直接派、不再先问）；⚠ **两条边界**：⛔ **不解除任何既有红线**（看板 / 别人项目的卡 / 判据 / 权限档位）· ⚠ **"不再先报"≠"不报"**（派完必须在回复里说清路数与去向）；⚠ 档名不改（仍是 自动 / 单会话 / 多会话） | active | `volumes/user-decisions/UD-149.md` |
| UD-152 | **（现行）** **用户已表态的事不许再问**；「工作模式有问题就优化调整」= 授权改载体（契约 / 判据 / 账本写法），⛔ 不停在"下次注意"；⚠ **重启已由用户认领**，⛔ 不再列为待决、⛔ 不再重问；⚠ 四条修法：当轮落账 · 待决项须写清"是谁的" · 回话契约加一条 · 机检补一条 | active | `volumes/user-decisions/UD-152.md` |
| UD-153 | **（现行）** **`PROJECT.md` 唯一事实源的任何变更 = 整份重构重写**：⛔ 禁止逐处修改 · ⛔ 禁止插入/追加 · ⛔ 任何补丁形态；旧版按 `R-17` 进归档；变更信息写进 `CHG-nn` 变更记录表（条目 + 卷索引同批）；⚠ **"重写"不是"精简"**：⛔ 不许以"更干净"为由删信息 | active | `volumes/user-decisions/UD-153.md` |
| UD-154 | **（现行）** **在途任务书单独放一个地方**（⛔ 不再与已完成件同处一目录）；⚠ 落点/命名/迁移/判据 **授权 Hob 自决**（已落 `CHG-068`：`queue/doing` / `queue/todo` 两档、⛔ 不设 `done/`、完成即 `mv` 进 `archive/`） | active | `volumes/user-decisions/UD-154.md` |
| UD-156 | **（现行）** **账本只给 Hob 用，⛔ 不为人读而写**：用户要什么直接问 ⇒ 账本里为"人读"服务的部分是没有读者的成本。⛔ 不许再写「人读版 / 机器读版」双版本 · 「人话一页 / 给不懂代码的人写」一类说明件 · 为让人看懂而加的解释性铺垫。⚠ **判别法：删掉之后有没有一条机检会红？** 会 ⇒ 它其实是机器读的，⛔ 不能删（只可改名）；不会 ⇒ 才是"为人写"的，可删。⚠ ⛔ 不解除 `UD-135`（回复要用常人语言）—— 那条管**回复**、⛔ 不管账本 | active | `volumes/user-decisions/UD-156.md` |
| UD-158 | **（现行）** **回复加第三种形态「问答轮」**：用户提问、且本轮没有活要派 ⇒ ⛔ 不套四小块、⛔ 不出现「这轮做了什么」；**第一句直接回答**；只在答案本身没验过时末尾补一句。**判别法：用户问句 → 第一句必须是答案**；⛔ 开头若是"这轮做了什么 / 你说得对 / 我先说明"就不是问答轮。⛔ 问答轮里不许有：自我复盘 / 自我检讨 / 把自己的行为当主题 / 用派活回避问题 | active | `volumes/user-decisions/UD-158.md` |

## 五、回复格式

| 编号 | 标题 | 状态 | 文件 |
|---|---|---|---|
| UD-58 | 回复格式定稿（现行口径） | — | `volumes/user-decisions/UD-58.md` |
| UD-16 | 语种跟随用户语言 | — | `volumes/user-decisions/UD-16.md` |
| UD-17 | 「用户自建预设的显示名不参与界面本地化」写进方案与账本 | — | `volumes/user-decisions/UD-17.md` |
| UD-134 | 回复格式 v7：板块改名 **实施指令** / **简要说明** + 精简（⛔ 不重复账本 / ⛔ 不复述报告 / ⛔ 不堆叠警告；**保留"要不要你决定"与"未验证"**） | active | `volumes/user-decisions/UD-134.md` |
| UD-135 | 回复格式 v8：`简要说明` 必须用常人的语言写（⛔ 不许堆路径 / 行号 / 提交号 / 命令名 / 检查名 / 退出码 / 英文标识符）；四小块 + 唯一判据（读完能答三问） | active | `volumes/user-decisions/UD-135.md` |
| UD-139 | ~~`实施指令` 只在"无活会话、需用户手工转达"时出现~~ | **已被 UD-141 取代** | `volumes/user-decisions/UD-139.md` |
| UD-140 | ~~`实施指令` 永不出现在给用户的回复里~~ | **已被 UD-141 取代** | `volumes/user-decisions/UD-140.md` |
| UD-141 | **（现行）** 指令块**只在真正派活给实施会话的那一轮**出现（两段：实施指令 + 简要说明）；**讨论 / 决策 / 汇报轮次 ⛔ 无代码块**，只出 `简要说明`；三种反例一律不许再出现 | active | `volumes/user-decisions/UD-141.md` |

## 六、预设与设置界面

| 编号 | 标题 | 状态 | 文件 |
|---|---|---|---|
| UD-62 | 预设名称与 id 字面值 | — | `volumes/user-decisions/UD-62.md` |
| UD-24 | 设置分区标题就叫 `dsh-hob` | — | `volumes/user-decisions/UD-24.md` |
| UD-40 | 设置 UI 按 DSH 本身的样式做 | — | `volumes/user-decisions/UD-40.md` |
| UD-43 | 清掉三个"空旋钮"，只留真开关 | — | `volumes/user-decisions/UD-43.md` |
| UD-68 | 四项答复（提问许可 / 推理强度归属 / 两个小工具） | — | `volumes/user-decisions/UD-68.md` |
| UD-113 | 权限三档（账本 / 项目 / 工作区）：档3 真硬机制 · 档2 不给 · 档3 都给 · 任意文件可读可看 | active | `volumes/user-decisions/UD-113.md` |
| UD-133 | 权限档位改名：功能名「可读权限控制」· 三档「账本权限 / 文档权限 / 完全权限」· 内部取值与字段名不变 · 「完全权限」须带限定句 | active | `volumes/user-decisions/UD-133.md` |

## 七、通信与派活

| 编号 | 标题 | 状态 | 文件 |
|---|---|---|---|
| UD-77 | 推进会话总线投递 | — | `volumes/user-decisions/UD-77.md` |
| UD-78 | 清孤儿会话 + 归档会话不再出现在投递面 | — | `volumes/user-decisions/UD-78.md` |
| UD-79 | 给 Hob 加建会话能力，且必须注意工作区归属 | — | `volumes/user-decisions/UD-79.md` |
| UD-80 | 闭环派活：跑完自动回传 + 自主判断续用/新建 | — | `volumes/user-decisions/UD-80.md` |
| UD-81 | 派单消息必须自带要点（路径只作补充） | — | `volumes/user-decisions/UD-81.md` |
| UD-82 | 本项目不碰第三方插件的状态 | — | `volumes/user-decisions/UD-82.md` |
| UD-85 | 禁弹窗只走"指令文本"，不做硬机制 | — | `volumes/user-decisions/UD-85.md` |
| UD-90 | 排查并优化"忘记派发任务"：漏派必须可被观测 | — | `volumes/user-decisions/UD-90.md` |
| UD-91 | 批准四条根因结构改造，全部实施 | — | `volumes/user-decisions/UD-91.md` |
| UD-92 | ④ 的实施方式：值由写入工具渲染，且必须考虑跨实例 | — | `volumes/user-decisions/UD-92.md` |
| UD-93 | 拆分 `check:gitignore` 检查脚本 | — | `volumes/user-decisions/UD-93.md` |
| UD-100 | 并行隔离推进：两条实现方式按推荐裁定（Hob 不建卡 · 合并派会话做） | active | `volumes/user-decisions/UD-100.md` |
| UD-132 | 采纳「派单可靠性」三条（三级办法 + 放行一处读数 + 放行一轮探针） | active | `volumes/user-decisions/UD-132.md` |
| UD-150 | 看板卡的观察 / 确认 / 关闭归 Hob 预设自己（⛔ 不再要用户点）：只限**本工作区**的卡 · 只限 `in_review`→`done` · 逐卡判据 · 没干完不许关 | **已被 UD-151 收手** | `volumes/user-decisions/UD-150.md` |
| UD-151 | **看板就此收手**（用户裁定）：⛔ 不放行 `taskboard_move` · ⛔ 不改预设 patch / 禁项判据 · ⛔ 不碰看板插件；✅ **仍照旧读卡与给建议**，"关"仍由用户在界面点 | active | `volumes/user-decisions/UD-151.md` |

## 八、环境与运维

| 编号 | 标题 | 状态 | 文件 |
|---|---|---|---|
| UD-37 | Windows 侧 profile 只保留 `desktop` 与 `web` | — | `volumes/user-decisions/UD-37.md` |
| UD-38 | WSL 侧清理：只删 `headless`，`web` 保留 | — | `volumes/user-decisions/UD-38.md` |
| UD-75 | 方法论层：抽取，不安装插件 | — | `volumes/user-decisions/UD-75.md` |
| UD-102 | 收尾「把问题全部处理了」+ 拿本次任务测并行推进（要如实的可行性判断） | active | `volumes/user-decisions/UD-102.md` |
| UD-103 | 预设必须自带「职责边界」；改动须连账本与可复用层一并照顾（为了以后管别的项目） | active | `volumes/user-decisions/UD-103.md` |
