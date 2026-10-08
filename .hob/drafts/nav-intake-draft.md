# dsh-hob · project-nav 接入草案（**待用户确认**）

> **性质**：**草案，尚未登记**。本文件只做两件事：定前缀、列功能清单。
> **依据**：arch-view 技能「项目接入」节拍 —— **草案先行 → 用户确认 → 才 `nav_node` 登记**。
> **日期**：2026-10-08 ｜ **出具**：助手（只读盘点，未改任何源码）

---

## 0. 现状：本项目**尚未接入** project-nav 治理（实测）

### 0.1 ⚠ 先说一个**影响面最大**的发现：治理根在 Windows 侧，本项目在 WSL 侧

本项目路径 `/home/lk/FF/dsh-hob`（**WSL 原生 ext4**，`stat` 设备号 `2096`）；
而 project-nav 的**治理根**在 `/mnt/d/FF/.internal`（**Windows 侧 drvfs**，设备号 `71`）。

| 事实 | 读数 |
|---|---|
| `/home/lk/FF` 与 `/mnt/d/FF` **不是同一目录** | inode 设备号 `2096` vs `71`；`/mnt/d/FF/dsh-hob` **不存在** |
| 治理根（`events.jsonl` / `arch/`）**只在 Windows 侧** | `/mnt/d/FF/.internal` 存在；`/home/lk/FF/.internal` **不存在** |
| 项目两处同名不同物 | `/home/lk/FF/project-nav` 与 `/mnt/d/FF/project-nav` **都存在**，是两份 |

**含义**：本项目与已有四个项目（`PN` / `PE` / `SC` / `VT`，从路径看都在 `/mnt/d/FF` 系）
**不在同一个物理根**上。⇒ 接入前**必须先定**：治理根是继续用 Windows 侧的 `/mnt/d/FF/.internal`，
还是给本项目单开一个。

⚠ **诚实边界**：插件源码里治理根是**按工作区动态求**的（`core/workspace.js:69`、
`host/index.js:77-92` 的注释说 `config.root` **只剩"收窄"语义、不再提供根**）
⇒ **理论上 WSL 侧项目也能被治理**；但**我没实测跨文件系统**这件事，只做了路径/inode 核对。

### 0.2 事件日志现状

| 读数 | 值 |
|---|---|
| `/mnt/d/FF/.internal/events.jsonl` | **420** 条 |
| 已有前缀 | `PN` 62 · `PE` 45 · `SC` 38 · `ACT` 55 · `DOC` 14 · `ADR` 6 · `VT` 6 · `DD` 1 |
| **是否含 `dsh-hob`** | ❌ **否** |
| **是否含 `DH-`** | ❌ **否** |

⇒ **本项目是"存量中途接入"**，按技能模板走：
盘点 → 出草案 → **用户确认** → 登记 + `nav_set` → `mode=coverage` 验收。

---

## 1. 建议前缀：**`DH`**

（`DH` = **D**sh-**H**ob，2 个大写字母，与现有 `PN`/`PE`/`SC`/`VT` 不冲突。
⚠ 若你更倾向 3 字母，可改 `HSH` / `HOB`，**请指定**。）

---

## 2. 分层建议（对齐本项目「插件化模块化」的既有结构）

⚠ **不改现有代码结构**，只按**磁盘实存的层次**登记：

```
DH-P01  dsh-hob（项目）
 ├── DH-M01  Host 半边（Node 侧，src/modules + src/server + src/config + src/index）
 ├── DH-M02  Client 半边（浏览器侧，src/client）
 ├── DH-M03  预设声明（preset/dsh-hob，两个 agent preset）
 └── （预留）DH-M04  账本与治理（.hob/，非代码交付物）
```

---

## 3. 功能清单草案（**按"用户可感知的功能"切分**）

> 依据技能：「按用户可感知的功能切分，带一句话 userView 与代表性文件；
> 没把握的文件标『暂不登记』」

| 码 | 功能名 | userView（一句话） | 代表性文件（磁盘实存） |
|---|---|---|---|
| **DH-F01** | **预设装配** | 选择器里能看到并用上 `Hob` / `Hob-Execute` 两个预设 | `src/modules/preset.ts`(16 行) · `preset/dsh-hob/preset-dsh-hob.patch.yml`(407 行) · `preset/dsh-hob/preset-dsh-hob-work.patch.yml`(239 行) |
| **DH-F02** | **工具面收敛（与门）** | Hob 只拿到被允许的工具，写/命令类拿不到 | `src/preset/tools.ts`(456 行) · `src/modules/tools.ts`(366 行) |
| **DH-F03** | **实施侧收窄** | Hob-Execute 的提问弹窗被摘掉，模型面按名单收窄 | `src/modules/work-deny.ts`(121 行) |
| **DH-F04** | **账本读写** | Hob 能读项目文档、写自己的 `.hob/` 账本（带越界/软链守卫） | `src/server/doc-read.ts`(155 行) · `src/server/hob-write.ts`(546 行) |
| **DH-F05** | **设置面板** | 设置页能看到并改动本插件的配置项 | `src/client/index.ts`(79 行) · `src/client/settings-panel.tsx`(225 行) · `src/client/settings.ts`(99 行) · `src/modules/settings.ts`(115 行) |
| **DH-F06** | **配置 schema** | 模块开关与字段的定义面（含 volatile 形状规则） | `src/config.ts`(201 行) |
| **DH-F07** | **模块装载** | 四个模块可独立启停，缺依赖不报错 | `src/index.ts`(77 行) |
| **DH-F08** | **会话总线（M3）** | ⚠ **骨架、已挂起**（UD-11）；不承载功能 | `src/modules/bus.ts`(37 行) · **状态标 `frontier/挂起`** |

**暂不登记**（没把握，按技能要求标出）：

| 文件 | 为什么不登记 |
|---|---|
| `src/client/panel-styles.ts`(133 行) | 纯样式常量，无独立功能语义；归 DH-F05 的内部实现 |
| `.hob/**`（账本、模板、角色、方法） | **非代码交付物**，属过程产物；是否登记待你定（见 §5） |
| `scripts/*.mjs`(6 个) | 机检脚本；是否单列一个功能（`DH-F09 机检`）待你定 |
| `cordis.patch.yml` · `package.json` | 装配声明，归 DH-F07 内部实现 |

---

## 4. ⚠ 盘点中发现的一处**真实架构问题**（必须先报）

**`src/modules/tools.ts` ↔ `src/modules/work-deny.ts` 是循环依赖**（实测，非推断）：

| 方向 | 证据 |
|---|---|
| `tools.ts` → `work-deny.ts` | `tools.ts:58` `import { installWorkPresetDeny } from './work-deny.ts'`（调用点 `:363`） |
| `work-deny.ts` → `tools.ts` | `work-deny.ts:50` `import { WORK_MODEL_DENY, WORK_PRESET_ID, presetIdOf } from './tools.ts'`（用到 `:62`/`:74`/`:100`） |

**被交换的符号**：

| 符号 | 定义处 | 消费处 |
|---|---|---|
| `WORK_PRESET_ID` | `tools.ts:162` | work-deny `:74`/`:100`/`:118` |
| `WORK_MODEL_DENY` | `tools.ts:187` | work-deny `:62`/`:119` |
| `presetIdOf()` | `tools.ts:212` | work-deny `:74`/`:100` |
| `installWorkPresetDeny()` | `work-deny.ts` | tools `:363` |

**为什么这是问题**（对齐本项目 R-3 / §3.3 的"灵活扩展"纪律）：
- 两个模块**无法各自独立理解**——改一个必须同时理解另一个；
- 违反「**单向依赖**」这一模块化基本要求；
- ⚠ **诚实边界**：ESM 循环 import 若**不在模块顶层求值**（只在 `apply()` 内调用）**运行时可能正常工作**——
  故这是**结构性**问题，不是"现在崩了"。**我没有实测运行时行为**，只做静态判定。

**建议（不在本草案动手）**：把那 3 个被共享的符号（`WORK_PRESET_ID` / `WORK_MODEL_DENY` / `presetIdOf`）
下沉到**第三个文件**（如 `src/modules/work-contract.ts`），使依赖变成单向：
`tools.ts → work-contract.ts ← work-deny.ts`。

---

## 5. 需要你拍板的四项（**每件都带选项，不做开放式提问**）

| # | 事项 | 选项 |
|---|---|---|
| **1** | **前缀** | **`DH`**（推荐）/ `HSH` / `HOB` / 你指定 |
| **2** | **`.hob/**` 是否登记进 nav 索引** | **不登记**（推荐：它是过程产物，非代码交付物）/ 登记为 `DH-M04` |
| **3** | **§4 那个循环依赖** | **本轮只登记、不动手**（推荐）/ 纳入重构方案（新增一条 CHG）/ 立即修 |
| **4** | **（新增）治理根用哪个** | **继续 `/mnt/d/FF/.internal`**（推荐：与前四个项目同根、事件流统一）/ 给本项目单开一个 WSL 侧治理根 / **先只读验证跨文件系统是否可行**（最稳） |

---

## 6. 我**不能**做的事（已查明根因 + **有确定解锁路径**）

### 6.1 现象

⚠ **本会话的工具面里没有 `nav_*` 五件套**（`nav_graph` / `nav_node` / `nav_set` / `nav_commit` / `nav_decide`）。

### 6.2 根因（实测，非推断）

`project-nav` 插件**按工作区**决定是否放出这 5 个工具：

| 证据 | 位置 |
|---|---|
| 5 个工具名 | `host/index.js:47` `TOOL_NAMES = ['nav_graph','nav_commit','nav_decide','nav_node','nav_set']` |
| **未启用 ⇒ 收回工具面** | `host/index.js:241-257`：`if (rec.enabled) {...return}` 否则 `tools.restrict({ deny: TOOL_NAMES })` |
| 为什么"按工作区" | 同处注释：「装配期是**进程级**的，而'启不启用'是**每工作区**的」 |

### 6.3 启用判据（**这是解锁路径**）

插件自己的回执写明（`host/index.js` 的 `NO_GOVERNANCE_HOWTO`）：

> **在该工作区建一个项目级 skill 目录**
> —— `<工作区>/.dsh/skills/<名>/SKILL.md` **或** `.agents/skills/…`，重启会话即可。

**实测本项目现状**：

| 路径 | 状态 |
|---|---|
| `/home/lk/FF/dsh-hob/.dsh/` | ❌ **不存在** |
| `/home/lk/FF/dsh-hob/.agents/` | ❌ **不存在** |

⇒ **这就是 `nav_*` 不可见的直接原因**：本项目从未声明过项目级 skill ⇒ 判定为"未启用" ⇒ 工具面被收回。

### 6.4 三条解锁选项（**都要你拍板，因为会往项目里加目录**）

| 选项 | 做法 | 代价 |
|---|---|---|
| **A（推荐）** | 建 `.dsh/skills/arch-view/SKILL.md`（把 arch-view 技能声明为本项目级 skill） | 新增一个目录；**语义正确**——本项目确实要用 arch-view |
| **B** | 建 `.agents/skills/` 同名声明 | 同上，路径风格不同 |
| **C** | 不建，改用其他通道登记（技能 §4 的 `core/log.js` `appendEvents`） | 需写脚本；且**每次都绕开正常通道** |

⚠ **诚实边界**：另有一种"降级"成因（`NO_GOVERNANCE_REASON.DEGRADED` / `NO_WORKSPACE`）也会让工具不可见 ——
但我实测本项目**在 git 仓内**（有 `.git`）且 **cwd 完整**，故**排除**这两类，锁定为"**未启用**"。

**本草案已完成的、不受阻塞的部分**：前缀建议 · 分层建议 · 8 个功能清单（含 userView 与代表文件）·
循环依赖实测 · 三个待拍板项 · **以及本条解锁路径**。

---

## 7. 确认后我会做什么（草案 → 落地）

1. `nav_node` 登记：`DH-P01` → `DH-M01..M03` → `DH-F01..F08`（**`files=` 用一等参数**，见技能坑 1）
2. `nav_set` 四字段主线向量（`doing` / `next` / `notDoing` / `exitCondition`）
3. `nav_graph mode="coverage"` 验收并复述登记结果
4. 之后再按技能 §1/§2 出 **L1 总览档**（依赖边来自 `nav_graph mode="impact"`，过 `arch-check.mjs l1` 门）
   与 **L2 特征主链**（建议先做 **DH-F01 预设装配链**，它是本项目最关键的贯通链）

---

## 8. 一句话交接

**要让我开工，回四项就够**（每项一个字母/词）：

| 项 | 选项 |
|---|---|
| **前缀** | `DH`（推荐）/ `HSH` / `HOB` / 你指定 |
| **`.hob/**` 登记** | `不登记`（推荐）/ `登记为 DH-M04` |
| **循环依赖** | `只登记不改`（推荐）/ `纳入重构方案` / `立即修` |
| **治理根** | `沿用 /mnt/d/FF/.internal`（推荐）/ `单开 WSL 侧` / `先只读验证` |

**推荐组合**：**`DH · 不登记 .hob · 只登记不改 · 沿用现有治理根`**

⚠ 但在回这四项**之前**，还有一个**前置动作**（§6.4）：
**本项目的 `nav_*` 工具当前不可见**（因从未声明项目级 skill）。
要么选 §6.4 的 **A/B**（建 `.dsh/skills/` 或 `.agents/skills/`，重启后 `nav_*` 出现），
要么选 **C**（绕道登记）。**这三条是"能否开工"的前置**，与上面四项并行决定即可。
