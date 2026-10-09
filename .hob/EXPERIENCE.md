# dsh-hob · 经验库（EXPERIENCE.md）

> **这是什么**：旧 `dsh-hob` 项目（2026-10-01 → 2026-10-05，8 个批次）的**已实测踩坑提炼**。
> 旧项目已整体归档到 `/home/lk/FF/dsh-hob-archive-20261005/`，新项目用原路径从零开始。
> 账本里有 40+ 条实测记录——**这是新项目最值钱的资产**，故抽出来单独成册带进新项目。
>
> **这不是账本副本，是提炼。** 每条含 **现象 / 根因 / 正确做法 / 出处**。
> 出处编号 = 旧账本 `FACTS.md` 的条目号（另有 `README.md` 第 N 坑、`batchN-report.md`）。
> 复核原文：`/home/lk/FF/dsh-hob-archive-20261005/.hob/FACTS.md`（217 条）、`README.md`、`batch1..8-report.md`。
>
> ⚠ **提炼纪律（用户明确要求）**：**不许丢「根因」**。只留现象等于没留——
> 现象会随环境变化，根因才是可迁移的判据。

---

## 0. 怎么用这一份

- **动手前**：按主题扫一遍相关条目。凡标 🔴 的是「会让你静默失败」的那类，代价最高。
- **出问题时**：先查本文有没有现成的根因，再决定是排查还是重复踩。
- **做完改动**：对照 §6「工程纪律」自检（失败可观测 / 备份 / 拆东墙）。
- **本文不是规格**：新项目要做什么、边界在哪，看新项目自己的 `PROJECT.md` 与账本。

**编号规则**：`E-nn`。新增经验续编，**不要重排**（会被别处引用）。

---

## 1. 加载与装配（宿主契约层）

### 🔴 E-01 · 路由静默不注册：`ctx.inject` 反应式 vs 一次性 `ctx.get`

**现象**：插件在组合里、`apply` 也跑了，但 `/plugins/<name>/config` 返回 **404**（不是 401），
**且没有任何报错**。用户看到的只是「界面元素不出现」，日志一片干净。

**根因**：`apply()` 执行时 `webServer` 服务**尚未就绪**（cordis 的 fiber 是**并行激活**的，
宿主起 web 服务与插件激活之间没有顺序保证）。旧代码在 `apply` 里一次性
`ctx.get('webServer')`，拿不到就走 else 打一句 warn——而 warn 级别不显示 ⇒ 彻底静默。
后果是**路由永不注册**。

**决定性证据（同进程对照实验）**：同一插件内注册两条路由——一次性 `ctx.get` 的那条 **404**，
`ctx.inject(['webServer'], cb)` 的那条 **200**。唯一变量是注册时机 ⇒ 排除插件/profile/bundle/依赖全部嫌疑。

**正确做法**：路由注册一律写成 `ctx.inject(['webServer'], (webCtx) => { webCtx.effect(() => webServer.register(...)) })`；
**工具注册留在回调外**（headless/CLI profile 没有 webServer，工具必须照常可用）。

**出处**：`README.md` 第五个坑；`F-D3`；`src/index.ts` 的对应注释。

### 🔴 E-02 · 两种 `inject` 是**不同层级**，不可互相替代

| | 模块级 `export const inject = ['tools']` | `ctx.inject(['webServer'], cb)` |
|---|---|---|
| 语义 | **加载门禁** | **反应式订阅** |
| 服务缺失时 | 插件**整个不激活** | 插件照常激活，cb 等就绪后再跑 |
| 取用 | `ctx.tools`（未声明会**直接抛错** `cannot get property "tools" without inject`） | 从回调参数取 |

**正确做法**：硬依赖（没有它插件没意义）→ 模块级 `inject`；可选依赖（没有它应降级但照常工作）→ `ctx.inject`。

**出处**：`README.md` 第六个坑；实测对照（声明了 = PRESENT，不声明 = UNDEFINED/抛错）。

### E-03 · `name` 常量一改，同时动**三条对外契约**

**现象**：改一个常量会让宿主按旧名找包、client 按新名请求路由，两边对不上。

**根因**：插件名同时是 ① 加载器 **entry id** ② RPC **路由前缀**（`/plugins/<name>/*`）
③ **settings namespace**。三者必须与 `package.json` / `cordis.patch.yml` / client 侧 `PACKAGE_NAME` / `SETTINGS_NS` 同批改。

**正确做法**：把插件名收敛成**单一常量**，并在注释里点明它同时是三条契约；改名时列清单一起改。

**出处**：`src/index.ts` 的 `name` 注释。

### E-04 · `Config` inspect 的 `status: absent` **不等于** disabled

**现象**：单看一个读数会把正常运行的功能误判成被禁用。

**根因**：`absent` 表示**无 Config schema**；`include:llm` / `include:agent` 同为 `absent` 却正常运行。
判 disabled 要看 `dev_plugin_status` 的 `[disabled]` 标注。

**正确做法**：判定禁用状态必须**交叉比对两处读数**，不用单点结论。

**出处**：`F-R18`。

### E-05 · profile patch **够不到 preset 内部的条目**

**现象**：在 profile 的 `cordis.patch.yml` 里写 `- id: tool-hob-contracts`（preset 内的一行）
被宿主拒绝：`dsh: patch: entry "tool-hob-contracts" not found`。

**根因**：`dsh-app-boot` 的 `applyEntryPatches` 建 `entryMap` 时**只索引顶层条目 +
带 `group` 的 `group.config`**，而 preset 的 `config.plugins` 是普通数组 ⇒ 不在索引里。

**正确做法**：要改 preset 行内的 config，**只能改 preset 包本身**（那会破坏两端一致 ⇒ 慎用）；
否则把可变项设计成 preset 行的**顶层配置**。

**出处**：`F-B8-3`（含 `dsh-app-boot/lib/index.js:61-71`）。

### E-06 · 装配入口 id 必须是包名（否则 settings 命名空间对不上）

**现象**：设置页报「宿主未提供本插件的配置命名空间」，`status='unavailable'`。

**根因**：走动态注入路径时 `loader.create({name, config:{}})` **不传 id** ⇒ entry id 变成随机 uid
（实测 `dafdb868`），而 client 侧 `SETTINGS_NS='dsh-hob'` ⇒ 宿主 `describe()` 出的条目键 ≠ 插件期望的命名空间。

**正确做法**：**走正式装配**（profile 的 `dependencies` + `dsh.profile.bundles` + 同名 `node_modules` 链接），
让 entry id 恒等于包名。不要用"能加载就行"的旁路注入做交付形态。

**出处**：`F-R14` / `F-R15` / `F-R16` / `CHG-002`；`dsh-settings/lib/index.js:432`（`ns: entry.options.id`）。

### 🔴 E-07 · 软链**删不掉，且不该删**（`healProfileLinks()`）

**现象**：手工删掉 profile 里的 `node_modules/<pkg>` 软链，下次启动又被建回来。

**根因**：`healProfileLinks()` 在启动时读 profile `dependencies`，**凡 `link:` 开头的依赖，
链接不健康即自动重建**。软链同时是 bundles 条目的解析目标与"改源码即时生效"的载体。

**正确做法**：要"去掉链接"，**只能改 `dependencies`**，不是删链。
另：**不要用卸载类工具（`dev_uninject_plugin`）做清理**——它会删 junction + 写 `disabled` patch 条目，
删链会直接打断 bundles 的解析路径，而 `disabled` 条目有把 bundles 里的包标停用的风险。

**出处**：`F-R53` / `F-R56`；`DECISIONS.md:225,234`；super-injector `lib/index.js:9990-10018`。

---

## 2. 配置与设置页

### 🔴 E-08 · volatile 陷阱：不带 `.volatile()` 设置页**完全不可见**

**现象**：`configForms.get('<ns>')` 永远拿不到 `value`；原生设置页里没有该插件的页。

**根因**：`SettingsForms.describe()` 对每个 entry 先跑 `volatileForm(schema)`，
**返回 `undefined` 就 `return []`** ⇒ 该 entry 不出现在 describe 结果里。
而 `volatileForm` 的规则是：**schema 里至少要有一个字段带 `.volatile()` 标记**。

**正确做法**：要出现在设置页的字段一律标 `.volatile()`；且 volatile **不能嵌套**
（固定对象路径、无 volatile 父对象——父对象标了再标子字段会抛 `ValidationError`）。

**⚠ 副作用（同一根因的另一面）**：标了 volatile 的字段**运行时是 ref 对象而非真值**。
读取必须 `config.<field>.get()`；直读会**静默**得到 `{}`。

**⚠ 类型必须写 `Volatile<T>` 而不是裸类型**——这不是严谨，是**防反向指引**：
写裸类型时 TS 会**拒绝正确的 `.get()`** 却**接受错误的直读**。写上 `Volatile<>` 后 TS 才站到正确一边。

**⚠ 第二道防线**：类型挡不住 `config.ball.right` 这类**越层直读**（类型合法、运行时 undefined）⇒
配一个静态检查脚本扫描。

**出处**：`README.md`「设置同步的两层」；`F-F4` / `F-R64` / `F-R65`；`src/config.ts` 顶部说明。

### E-09 · 非回环访问时设置写入**不落盘**

**现象**：跨机（另一台机器用浏览器访问本实例）改设置，**进程内有效、重启即失**。

**根因**：`dsh-client-ui-settings/lib/client.js` 硬编码一行：
`const persistence = ctx.remote.$host.isLoopback ? "host" : "memory"`。
`isLoopbackHostname()` 只认 `localhost` / `[::1]` / `127.0.0.0/8`。

**正确做法**：跨机场景**不要依赖 client 侧 `configForms` 写盘**；
应由 host 侧直接调 `ctx.settings.update()` / `ctx.configEditor.edit()`。

**出处**：`F-D5`；`README.md`「跨机硬伤」（含实测对照表）。

### E-10 · 「A 路径拿不到」**不等于**「能力不存在」

**现象**：曾据「client 收不到插件 config」推断「读写都必须走自建 HTTP 路由」，
并按此设计了一整套自建 `POST /config` 写入口——**全部不必要**。

**根因**：把**一条路径**的结论**外推成全部路径**。挂载参数（`loader.create({name})`）
收不到 config 是真的，但 `configForms` 走的是 **Remote RPC（`settings.describe`）**，
与挂载路径**毫无关系**，本来就不依赖它。另一半错误：参考实现（orb）确实有 POST 写入口，
但它写的是**自己的 profile JSON**（`ball-enabled.json`），**不是 DSH 插件 config**——
**「形式像」不代表解决的是同一个问题**。

**正确做法**：下结论前**穷举路径**；引用参考实现时**先核对它写的是哪个对象**。

**出处**：`README.md`「为什么旧结论是错的」对照表。

---

## 3. 预设与会话

### 🔴 E-11 · preset **在会话首个 turn 之后锁定**

**现象**：想在同一个会话里"切模式"，报 `agent-preset/locked`「This session has already started」。

**根因**：`select()` 检查 `turnBoundary`——一旦 `openTurnStartSeq !== null` 或 `lastTurn > 0` 即抛。

**正确做法**：**换模式 = 换会话**。这是机制决定，不是妥协；
把"新建会话"作为唯一的模式切换入口（UI 上的 `+` 新建按钮天然就是它）。

**出处**：`F-Y4`；`agent-preset-registry/src/index.ts:325-336`。

### 🔴 E-12 · `meta.agentPreset` **单独不挂预设**，必须 `mount`

**现象**：建会话时只传 `meta.agentPreset`，结果**工具面与默认预设完全一致**——
得到一个"看起来有 preset、实际是 default"的会话，**且不报错**。

**根因**：`meta.agentPreset` 只是**标注**。真正挂载需要由创建方在 `setup` 回调里
显式 `await ctx.agentPresets.mount(agentCtx, resolvedId)`。

**正确做法**：**任何绕过宿主 API 自行 `agents.create` 的代码都必须自己 mount**。
验证方式不能只看返回值里的 `agentPreset` 字段，要**实际 dump 会话的工具面**。

**出处**：`batch3-behavior-log.md:77`；`batch3-report.md:357-375`（含正确写法）；
宿主正规路径 `dsh-api-session-controller/lib/index.js:358-371` 的 `composeAgent`。

### E-13 · 宿主平面工具行 `disabled` 后，工具面**由 preset 拥有**

**现象**：以为"我的 preset 只声明两个工具"就等于"会话只有两个工具"——**不成立**。

**根因**：宿主平面（`dsh-web-app/cordis.patch.yml`）把 `tool-bash` / `tool-fs` /
`tool-fs-search` / `tool-pwsh` / `tool-jobs` / `tool-skill` … 一批标了 `disabled: true`
（**24 处**，已复核 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml`）。
**被 disabled 的行不注册工具**，于是每个会话的工具面由**它自己的 preset** 决定。

**正确做法**：权限收敛靠"**preset 只声明需要的**" + 依赖宿主平面那批 disabled 行；
**不要**以为"不声明"就能摘掉宿主平面上的工具（见 E-14）。

**出处**：`README.md` 第七个坑相关；`preset/hob-translate/cordis.patch.yml` 顶部说明；
实测 `grep -c "disabled: true"` = 24。

### 🔴 E-14 · `tools.restrict()` **摘不掉宿主平面注册的全局工具**

**现象**：翻译会话的 4 个 `interconnect_*` 工具，在 preset 侧"不挂"**摘不掉**——
未加 restrict 时会话工具面 = 6 个（2 个自己的 + 4 个继承来的）。

**根因**：这些工具由 `dsh-interconnect` **自己的 bundle patch** 声明为
**宿主平面行**（`- id: tool-interconnect`），注册进**全局层**，**被每个 agent 继承**。

**正确做法**：必须在**运行期** `ctx.tools.restrict({ deny })` 显式摘。

**⚠ 副产物（同源发现）**：`DEFAULT_DENY` 只列了 `interconnect_*` 是**不够的**——
在装了更多 bundle 的 profile 里，**别的 bundle 注册的全局工具会漏进来**
（真机 desktop profile 实测：会话工具面 **38 个**，多出 `dev_*` 19 个 / 子代理团队 9 个 /
定时 4 个 / 网络检索 4 个；危险类别仍是 0，但收敛目标没达成）。
⇒ **"收敛到 N 个"这个结论与 profile 装了哪些 bundle 强相关**，换 profile 必须重新实测。

**出处**：`F-Z5` / `F-Z13`；`batch4-report.md:64-75`。

**⚠ 2026-10-06 实测更正（结论对、理由错）**：本条原称"`tools.restrict()` **摘不掉**
宿主平面注册的全局工具"。实测（阶段 A/C）显示：**摘得掉"继承来的全局工具"**；
真正摘不掉的是「**本作用域自己注册的（`own`）**」——`own` 层无条件可见，
且**不进可限制名单**（`dsh-tools` 的 `view()` / `restrictableNames`）。
⇒ **战略结论（允许清单思维）成立**，理由应改为「**封禁名单追不上新装的插件**」。
另：`restrict` 的**落点**决定能摘到哪一层 —— 预设行 scope 只能摘继承来的；
agent 席位 ctx 才会把预设行注册的工具也算作"继承来的"（见 `FACTS.md` F-J24 / F-J31 / F-J36）。

### 🔴 E-15 · `restrict()` 的**时序坑**

**现象**：在 preset 行自己的 `apply()` 里直接 `restrict({deny:['interconnect_send']})` **必抛**：
`names unknown global tool ...; known global tools: read_contracts, write_hob`。

**根因**：`restrictableNames` 是**调用当刻**的继承面**快照**，而宿主平面行与本 preset 行是
**并行激活**（顺序不保证——与 E-01 同源）。

**正确做法**：订阅 `tools/change`（`dsh-tools/lib/types/index.d.ts:102`），
**等目标工具出现再摘**。

**出处**：`F-Z6`。

### 🔴 E-16 · `restrict()` 的**重入坑**（会爆栈）

**现象**：`Maximum call stack size exceeded` + 上万行重复日志。

**根因**：`restrict()` 成功时**同步 emit `tools/change`**。
若"先调 restrict、后记 settled"，则 emit 触发自己的监听器 ⇒ **重入自身**，无限递归。

**正确做法**：**先记 settled，再调 `restrict()`**；失败再撤回记录。
配套做法：诊断日志**带上限**（否则日志本身成为打爆内存的元凶）。

**出处**：`F-Z6`。

### E-17 · 「一个模块一个文件 + 各自 `apply`」的两条硬纪律

**现象**：resource 泄漏、卸载留下定时器/监听器。

**根因**：资源（定时器、watcher、事件订阅）若不挂 `ctx.effect`，热重载/卸载时不会被清理。

**正确做法**：① **一切资源挂 `ctx.effect`**（`ctx.effect(() => dispose, '描述')`）；
② **依赖靠 `inject` 声明** ⇒ 依赖不在就**不激活，不报错、不阻塞整插件**。

**出处**：`src/index.ts` 多处 `ctx.effect(...)`；项目"模块可独立启停"的架构要求。

---

## 4. 跨 OS / 跨进程

### 🔴 E-18 · Windows 侧**必须先复制到本地，再 link**

**现象**：在 Windows profile 的 `node_modules` 里建 junction 指向 WSL 的 UNC 路径
（`\\wsl.localhost\...`），**创建"成功"但列目录为空**；用 symlink 则报「此操作需要管理员权限」。

**根因**：`New-Item -ItemType Junction -Target '<UNC>'` 与 `symlink → UNC` 在 Windows 侧均不可用。

**正确做法**：把构建产物**复制到 Windows 本地目录**，再在该 profile 的 `node_modules`
里建**指向 Windows 本地目录**的相对软链（junction 或 symlink 均可，目标必须是本地）。

**⚠ 适用范围修正**：`link:` 装的软链**不会**被 `removeLinkProjections` 摘掉——
该函数**只摘**指向 `<profile>/.dsh-module-fallback/node_modules` 的软链，
pnpm 装的包与**指向别处的其它软链一律保留**。

**出处**：`F-C14` / `F-C15` / `F-C16` / `F-Z2` / `F-Z3`（修正）；`F-Y7`（原措辞过宽）。

### 🔴 E-19 · UNC/9p 上的**原子写**：失败的是 `link()`，不是 `rename()`

**现象一**：DSH 原生 `write` 工具在 UNC 路径上**必失败**：
`ENOTSUP: operation not supported on socket, link '<...>.tmpdir/...' -> '<目标>'`。

**现象二**：曾经用 `fs.renameSync` 复测**成功**，一度以为结论矛盾。

**根因**：**失败的是 `link()`，不是 `rename()`**——两者是不同的原子替换实现，**不可互相推断**。
DSH 的 `write` 工具走的是"临时文件 + 硬链接式替换"；Node 的 `fs.writeFileSync` 直写、
以及 `fs.writeFileSync(tmp)` + `fs.renameSync(tmp, final)` 在 UNC 上**都可用**。

**正确做法**：跨 OS 写文件时**不要用 DSH 原生 `write` 工具**，
用「单次打开写入」或「tmp → rename」；**不要**用"临时文件 + `link()`"。

**⚠ 未验证（不要当成已知）**：`fs.watch` 在 UNC/9p 上的**丢事件率仍未测**（只测过单次写是通的）
⇒ **不能只靠 watch**，必须配轮询兜底；但兜底周期内的延迟也**未量化**。

**出处**：`F-N1` / `F-N2` / `F-N3` / `F-R70`（修正，含"两步都成功"的实测）；
`F-R72`（watch 单次写通，丢事件率未测）；`F-O1`（**`edit` 工具在 UNC 上是否同样触发 `link()`——仍未验证**）。

### E-20 · `interconnect` 的 `peers` 是**启动时读一次的静态表**

**现象**：想让执行端在运行时"发现"助手端的 instanceId，做不到。

**根因**：`dsh-interconnect/lib/interconnect/index.js:966-971`，类型注释原话
**"only the constructor reads it"** ⇒ 运行时无法新增对端。

**正确做法**：对端 `instanceId` **必须落在配置里**（不能靠发现）。
配置缺失时**返回可读的失败原因**（如 `not-configured`），**不要**给一个"看起来合理的默认值"——
那会让"没配对"表现成"投递到不存在的对端"，**把配置缺失伪装成网络故障**。

**出处**：`F-J6`；`batch2-report.md:289`；`plan-phase1-config-and-send-button.md:36`。

### E-21 · 双实例共享同一个 `DSH_HOME`

**现象**：`pkill -f "dsh --profile system"` 会**一锅端**多个实例。

**根因**：同一 `DSH_HOME` 下多实例并存是常态（本机实测过 3088 + 3089 同时跑）。

**正确做法**：**停实例按端口取 PID**，不用 `pkill -f`。
另：并发写同一批文件有**静默覆盖**窗口。

**出处**：`F-F2`；`README.md` R-2。

### E-22 · `desktop` 是 CLI 的**保留 profile 名**

**现象**：`dsh --profile desktop --dump-config` 报
`error: profile "desktop" is managed exclusively by the Electron application`。

**根因**：`dsh/lib/bin.js:35-37` 的 `rejectElectronProfile`（boot 与 plugin 两条路径都拒）。

**正确做法**：Electron 应用的 profile **只能手工改 `package.json` + 建软链**；
且**离线验证必须把配置复制到另一个 profile 名**（如 `desktop-verify`）。

**出处**：`F-C18` / `F-Z4`。

---

## 5. 构建与验收

### ⭐ E-23 · `--dump-config` 是**离线验证**手段

**做法**：`dsh --profile <名> --dump-config` 产出一份完整的组合树，
**exit=0 + 零 warn** 即可判定"插件能被打包进组合"。
配 `--from-default-profile <模板>` 可在**独立 `DSH_HOME`** 里离线建 profile（不联网、秒级）。

**判据**：
- **exit code**（0 = 通过）
- **warn 计数**（必须逐条看明文，不能只数条数）
- **目标条目在树里**（`- id: <你的 entry id>`，证明 id 正确而不只是"没报错"）

**⚠ 它证明什么、不证明什么**：只证明**静态装配**正确；
**不证明运行时就绪顺序、不证明路由注册成功、不证明 client 半边加载**（见 E-01 / E-25）。

**出处**：`F-C19` / `F-R41` / `F-R80`；`batch4-report.md:189` / `batch6-report.md:379` / `batch8-report.md:225`。

### 🔴 E-24 · `src` → `lib` → profile 的**三级链**：改了不等于生效

**现象**：改了 `src`，运行时行为没变，`git status` 也**看不出来**（`lib/` 被 gitignore）。

**根因**：插件**运行时装的是 `lib/`**（`package.json` 的 `main` / `exports` 都指 `lib/`），
而 profile 的 `node_modules` 软链指向**仓库根**。所以链路是：
**改 `src` → 必须 build 出 `lib` → profile 软链才拿到新代码**。
三个静默断点：① 忘了 build ② build 了但 profile 指向的是**另一份副本**（跨 OS 场景常见）
③ 改的是 A 端、验的是 B 端。

**正确做法**：每次声称"生效"前，先回答三个问题：
**① 我改的是哪一份源码？② 编译到哪一份 `lib`？③ 运行时实例实际解析的是哪一份？**
回答不了就标「未验证」。跨端场景必须 `diff -rq` 两端产物。

**出处**：`F-R21` / `F-R46` / `F-R48`；`.gitignore` 顶部注释（原文明说这条漂移在 git status 里看不见）；
`F-R4`（"从未进入 lib"的实例）。

### 🔴 E-25 · 构建-运行耦合：本仓一次编译**会即时上到活跃实例**

**现象**：正在运行的实例（用户日常在用的那个）会在你编译的瞬间拿到新代码。

**根因（三环串联）**：
- **TD-3（脚本层）**：`npm run build` 默认装配目标是本机**日常实例**的 profile。
- **TD-1（文件系统层）**：profile 的 `node_modules/<pkg>` 是指向**开发仓**的软链
  ⇒ `lib/` 一写，正在运行的实例刷新即拿到新代码。
- **TD-2（运行时层）**：`dsh-client-hmr` 每 **500ms** stat 轮询每个 bundle
  （mtime/ctime/size），变化即经 SSE 推给浏览器 ⇒ **无隔离带**。

**打断任一环即可防住。**

**正确做法**：① 编译到**另一棵树**（独立 verify 工作树），
② 脚本内置断言：若 profile 软链指向本仓则**拒绝运行**，
③ `--build-only` **不是**隔离保护（它只跳过装配步骤，**不删除已存在的软链**）。

**出处**：`F-R21` / `F-R22` / `F-R23` / `F-R46` / `F-R47` / `F-R49`；`CHG-007`（隔离带 A+C 组合）。

### E-26 · 插件有「两个半边」，只验一个 = 假成功

**现象**：安装脚本打印「✅ 安装完成，界面右下角出现悬浮球」，用户打开界面**什么都没有**。

**根因**：插件是 **host + client 两个半边**，各自独立挂载。只验 host（配置在、路由在）
**证明不了** client 半边加载成功。

**正确做法**：验收必须**两个半边各一条判据**。host 侧可判
`GET /plugins/<name>/config` → **401 = 已挂载**（对照不存在的包名 → 404）；
client 侧要**在真产物上跑槽位探针**，不能只看配置文件。

**出处**：`README.md` 第七个坑；`F-J9`（401/404 判据校准）。

### 🔴 E-27 · 验收判据必须能**证伪**：新写的检查要做**负向对拍**

**现象**：一个新写的检查脚本"永远 PASS"，看起来一切正常——**它其实什么都没检查**。

**根因（实测两次）**：
① 初版双向比对导致大量误报，把项目专有内容误判为结构漂移 ⇒ 改成"**模板 ⊆ 实例**"单向；
② 不做的后果是**「永远 PASS 的检查」比没有检查更危险**——它提供虚假的安全感。

**正确做法**：**每个新检查都必须做一次负向对拍**：
故意破坏被测对象 → 确认它**报警且 exit≠0** → 还原 → 确认回到 PASS。
**只验正例的检查不算通过验收。**

**出处**：`F-R37`（模板检查双向对拍）/ `F-Z8`（收敛检查负向对拍）/ `F-R42`（自省记录）。

### E-28 · 运行时验证优先"跑真的"，不要只做静态推理

**现象**：靠读代码 + 仿真推断出的结论，在真机上不成立。

**根因**：并行激活的时序、模块解析的实际落点、client 端真实产物，
都不是静态读码能穷尽的。

**正确做法（可复用的探针方法学）**：
① 用**独立 `DSH_HOME`** + 独立 profile **离线**搭一个隔离实例（秒级、不联网）；
② 把待验插件挂进去；
③ **一次性跑完即退出**的方式做无侧效应探针；
④ 探针**写在临时目录**，随环境一并删除，**不污染仓库**。

**出处**：`F-R80`（方法学四条）；`教训 A：仿真不能替代真实运行`（`README.md`）。

---

## 6. 工程纪律（失败可观测 / 不拆东墙）

### 🔴 E-29 · **零日志不是证据**——先修可观测性，再谈定位

**现象**：grep 自己插件的日志行数 = 0，于是下了「`apply` 没执行」的结论。**错的。**
实际是 `apply` 跑了、走了 else 分支、那句 warn 因日志级别没显示。

**根因**：**日志的缺席不是证据**。判据设计不当比结论错误更危险。

**正确做法**：
① 让失败**可观测**——写标记文件、或故意插桩一个不存在的函数名（宿主立刻报调用栈，一眼看穿）；
② 通用教训：**当一个失败无声时，先修「可观测性」，再谈定位。**

**⚠ 同族互指（三条 · 批 7 整理）**：本条是「**判据本身失效**」家族的第一条。
另两条为 **E-44**（管道 `$?` 指向错误对象 ⇒ 误判命令失败）
与 **E-84**（多帧 zstd 只解首帧 ⇒ 误判"数据里没有那个事件"）。
三条的共同修法：**先证明观测器活着，再读观测值**。
（本段为批 7 追加的互指；本条原有内容未改。）

**出处**：`README.md` 第五个坑的「我在这轮排查里犯的两个方法错误」；`F-P19`（口径声明："仅能证明此刻无此文件"）。

### 🔴 E-30 · **静态行序 ≠ 运行时激活顺序**

**现象**：拿 `--dump-config` 里 `webServer` 在第 480 行、插件在第 1261 行，
推断「服务已就绪」——**错的**。

**根因**：并行激活下，**静态行序与运行时时序无关**。

**正确做法**：不要在并行系统里用静态顺序推时序，**要用对照实验**。

**出处**：`README.md` 第五个坑的第二个方法错误。

### E-31 · 降级链**不能提前 return**（否则"降级但不崩"变成"根本不渲染"）

**现象**：设置页报配置命名空间错误；同时悬浮球**整个不渲染**——**同一个根因**。

**根因**：配置降级 `useEffect` 中 `settingsForm !== null` 时**提前 `return`**
⇒ 后续的 HTTP 兜底与 `FALLBACK_CONFIG` 均不执行 ⇒ `configReady` 永不置位
⇒ 定位 effect 早退 ⇒ `state` 恒 `null` ⇒ **组件返回 null**。
注释承诺的「降级但不崩」**没有兑现**。

**正确做法**：降级路径**平铺，不早退**；用**一次性闩锁**（`settled`）保证幂等，
防请求风暴。验证方式：**差分对照**（同故障态下旧逻辑 vs 新逻辑各跑一次，
看 `{configReady, httpCalls}`）——这才是**因果证明**，不是"看着对"。

**出处**：`F-R8` / `F-R9` / `F-R10` / `F-R11` / `F-R12` / `F-R13`（12/12 场景验证）。

### E-32 · 日志**自己失真**比没有日志更糟

**现象**：日志里打出 `persona=[object Object]`。

**根因**：volatile 字段忘了 `.get()`（见 E-08），模板字符串把 **ref 对象** stringify 了。

**正确做法**：日志里消费 volatile 字段**同样必须 `.get()`**。
理由：日志是排查工具，它自己失真会让你"以为配置读到了正常值"，**误导后续排查**。

**出处**：`src/index.ts` 的对应注释（该处是静态检查脚本的**阳性对照**抓出来的，非人工发现）。

### E-33 · 改前先备份 + 留**明确回退点**

**做法（全部实测过）**：
① 改配置前 `cp -p` 出带时间戳的 `.bak-<理由>-<YYYYMMDD-HHMMSS>`；
② 记录**改前的 md5/sha**，回退后比对；
③ 账本里**写明回退方式**（哪几个文件、怎么还原）；
④ 归档/删除前**先 `du -sh` + 记清单**，归档后**核对"东西都在"**。

**出处**：`F-B8-10`（回退路径）；`F-R16`（装配前备份）；`F-Z1`（改前备份）；
`F-B8-6`（自带备份逐字节还原，sha 与备份同值）。

### 🔴 E-34 · 「拆东墙自检」：改了 A 必须回答"B 还成立吗"

**现象**：修 A 顺带弄坏了 B，但没人发现——因为**没人问过 B**。

**根因**：改动的影响面**不会自己浮现**；"我认为没影响"与"实测没影响"是两回事。

**正确做法**：
① 每条改动都问：**这条改动可能碰坏哪些既有行为/文件/判据？凭什么确认没碰坏？**
② 纯读取类的改动也要**显式写「无回归面（只读）」**，不要留空——留空不可见，写了才可查；
③ **把这条要求写进任务文本本身**（"改这个功能时同时说明你碰了哪些既有行为、以及凭什么确认它们仍然成立"）；
④ 收口时**报告任何越界的改动，附证据**。**静默结束比大声失败更糟。**

**出处**：用户全局指令（宿主注入）；`F-R50`（"发现第二个链着本仓的 profile"——目标本是一个，影响面是两个）。

### 🔴 E-35 · 「自产自审」结构上无效

**现象**：改动方自己审查自己，**报"已修好"**——但它只能知道"我打算做什么"，
**结构上看不见自己的改动砸掉了哪面墙**。

**正确做法**：产出席与审查席必须**不同席位**；且审查席**当轮不得也是改动方**
（否则它会一边审同级、一边自己的改动正被审查）。
**选审查席按任务类型**：结构性改动 → 会判结构的席位；"这个断言是真的吗" → 会复跑复现的席位；
碰凭据/权限 → 有安全视角的席位；碰存储数据/迁移 → 有数据视角的席位。

**出处**：用户全局指令（宿主注入，2026-09-23 规则）。

### E-36 · 隔离实例**隔离不了工作区**

**现象**：以为在隔离实例（独立 `DSH_HOME`）里跑探针就不会污染真项目——
结果探针的写入**真真切切落进了真项目**。

**根因**：隔离的只是 `DSH_HOME`（配置/会话存储），**工作区是共享的**（本机场景下经 UNC 直指真项目目录）。

**正确做法**：**承认隔离边界在哪**：`DSH_HOME` 隔离 ≠ 工作区隔离。
探针若会写盘，要么把工作区也指向临时目录，要么**只跑 `dryRun`**，
要么**写好恢复脚本**（自带备份是写入前快照，`cp -a` 回去即逐字节还原，回读 sha 比对）。

**⚠ 同一条边界的第二面（批 7 追加的互指）**：见 **E-85** ——
**`<DSH_HOME>/profiles/<name>/node_modules` 也是共享的真实存储**：
隔离 profile 若把它**整目录软链**到真机 profile，则往该路径**新建条目**会**穿透**落到真机 profile
（`git status` 看不见）。⇒ 本条说"**工作区**共享"，E-85 说"**依赖目录**也共享"；
隔离时两者都要单独处理。本条原有内容未改。

**出处**：`F-B8-6`（实测：隔离实例的 `write_hob(dryRun:false)` 真的追加进了真 `.hob/FACTS.md`，事后从自带备份还原，sha 同值）。

### E-37 · 模型输出侧的误差要**归因到层**，不要归因给配置

**现象**：契约里的 `<<<CMD>>>` 在模型输出里变成 `<<<<<CMD>>>`（**5 个尖括号**），两个独立会话都复现。

**归因（这是本条的价值）**：会话事件里 `system/message` 含 **3 个**（契约文本本身正确），
`assistant/message` 含 **5 个** ⇒ **是模型输出侧的复现误差**，
**不是**配置/加载/转义问题。**层归对了，才不用去改配置。**

**正确做法**：解析器要**容忍**（正则匹配 3 个即可命中，代价是残留少量 spill）；
但在**有消费者**之前必须处理掉（否则 spill 会显示给用户）。
**归因方法**：对比"输入侧的原文"与"输出侧的原文"，差在哪一层就清楚了。

**出处**：`F-B8-5`。

### E-38 · 改动要**可回退**，且回退点要**可验证**

**做法**：回退后**逐字节比对 sha**，并做**阴性对照**
（如 `grep -c <探针标记>` = 0），证明污染真的清干净了，而不是"我觉得清了"。

**出处**：`F-B8-6`；`F-R63`（备份回退精确还原 53370 字节）。

---

---

## 6b. 第 2 步新增（2026-10-05 · 清旧配置 + 搭模块骨架）

### 🔴 E-39 · profile 层同 id 条目**整体覆盖** bundle 层 config（不是合并）

**现象**：插件自带的 `cordis.patch.yml` 里写了 `config.modules.*` 与 `persona`，
但 `dsh --profile system --dump-config` 里**只看到 profile 层写的那几个键**，
插件自带的那份**凭空消失** —— 而插件本身没问题（隔离 profile 里同样配置正常显示）。

**根因**：profile 的 `cordis.patch.yml` 写 `- id: <同名>` 是 **id 定向覆盖**，
而覆盖是**整体替换**：profile 那份 `config` 直接顶掉 bundle 那份，
**不是逐键合并**。实测对照（同一插件、同一 profile，只改 patch）：

| profile 层写的 config | dump 里看到的 config |
|---|---|
| `{role, deliveryMode, autoSend, workspaceRoot}` | **只有**这 4 个键；`modules`/`persona` **不见** |
| `[]`（不写） | `{modules:{...}, persona:mentor}` —— 插件自带的回来了 |

**正确做法**：
① **不要**在 profile 里重复声明插件的 `config`，否则插件自带的整份配置面被遮蔽；
② 要改单点配置，就在 profile 层**写全**所有字段（因为不合并）；
③ 排查"配置没生效"时，**先比 bundle 层与 profile 层谁在说话** ——
   这与 E-24 的「三级链」是同源问题，都是"你改的那份不是跑的那份"。

**出处**：第 2 步实测（`system` profile 旧配置段清理）；
`.hob/archive/2026-10-05-step2/`；旧项目 `F-B8-3` 是同一机制的另一面。

### 🔴 E-40 · `ctx.plugin(plugin, config)` 必须传 **raw config**，不能传已物化的对象

**现象**：探针里先 `Config(input)` 拿到校验后的配置对象，再 `ctx.plugin(mod, thatObject)`，
cordis 抛 `ValidationError: invalid config: $.persona expected "mentor" | "executor" but got {}`。

**根因**：`ctx.plugin()` 会**自己**用插件的 `Config` schema 校验并物化配置
（volatile 字段在这一步变成带 `.get()` 的 ref 对象）。
传入一个**已经物化过**的对象 ⇒ 再校验一次时，那个 ref 对象形状**不再是** schema 期望的
字面量（它 stringify 成 `{}`）⇒ 校验失败。**这是"双重校验"的必然结果，不是插件 bug。**

**正确做法**：给 `ctx.plugin` 传**原始配置值**（raw），让 cordis 去校验与物化。
写探针/测试时尤其容易踩：**别把 `Config(x)` 的返回值再喂进去**。

**出处**：第 2 步实测（探针第一次运行时直接崩在 `_resolveConfig`）；
`@deepseek-ai/cordis/lib/index.js:960` 的 `resolveConfig`。

### 🔴 E-41 · `export const inject`（模块级）与 `ctx.inject()` 的**后果不同**，不只"写法不同"

**现象**：以为"用 ctx.inject 的模块，服务缺席时会像模块级 inject 一样不激活" —— **错**。

**根因（实测对照）**：

| | 模块级 `export const inject = [...]` | `ctx.inject([...], cb)` |
|---|---|---|
| 服务缺席时**模块自身** | fiber 停在 **PENDING（state=0）**，apply 整个不跑 | 模块**照常 ACTIVE（state=2）**，只有**回调**不跑 |
| 粒度 | 整个模块 | 单个能力/回调 |
| 语义 | **加载门禁** | **反应式订阅**（可选依赖降级） |

实测（同插件、同进程、只提供 `tools` 不提供 `settings`）：
```
{"name":"dsh-hob-tools","state":2}      ← 模块级 inject 且服务在场 ⇒ ACTIVE
{"name":"dsh-hob-settings","state":2}   ← ctx.inject 且服务缺席 ⇒ 仍 ACTIVE（回调未跑）
```

**正确做法**：选择依据是**你想要哪种降级**——
· 「没有这个服务，本模块就毫无意义」→ 模块级 `inject`（整块不激活）；
· 「没有这个服务，本模块其它部分照常，只是这一项不工作」→ `ctx.inject`。
**验证"独立启停"时，判据要按这条区分**：查 PENDING 只看模块级 inject 的模块，
拿 `ctx.inject` 的模块去查 PENDING 会得到"永远 ACTIVE"的假结论。

**出处**：第 2 步实测（`scripts/module-independence-probe.mjs` 路径 B / B2）；
`@deepseek-ai/cordis/lib/types/fiber.d.ts:60-68`（`PENDING` = waiting for required services）；
本条是 E-02 的**运行时实证**，E-02 只说了"不同层级"，本条补上"不同后果"。

### E-42 · `sessions` / `agents` 是可直接 `inject` 的宿主服务，且缺失时**返回 undefined 不抛错**

**现象（Q3 的答案）**：从插件里能不能拿到本实例的 sessions / agents？——**能**。

**证据（运行时，隔离实例实测）**：
```json
{"ev":"apply","has_sessions":true,"has_agents":true}
{"ev":"session/created","id":"session-744b9594-…","cwd":"/tmp"}
{"ev":"agents.get","got":"agent","followup":"function","steer":"function","inject":"function"}
```
即：`export const inject = ['sessions','agents']` 之后，`ctx.sessions` / `ctx.agents` 可用；
`ctx.agents.get(sessionId)` 对**真会话**返回 agent（带三个投递方法）。

**阴性对照**（有牙）：
```
{"ev":"agents.get(missing)","result":"undefined(不抛错)"}
{"ev":"sessions.get(missing)","result":"undefined(不抛错)"}
```
⇒ 查不存在的会话**返回 undefined**，**不抛错** ⇒ 调用方必须自己判 `undefined`，
不能靠 try/catch 兜底。

**作用域**：`session/event` 的签名是 `(this: Scoped<Session>, session, event)`，
而 `dsh-scope` 的规则是 **"events flow UP the chain, never down"**
（未打 tag 的 listener 全局可用；打了 tag 的只收**自己 + 祖先**的事件）。
⇒ **一个站在顶层（未打 tag）的插件能收到所有会话的事件** —— 这正是"总线"可行的机制依据。

**出处**：第 2 步实测（隔离 profile `m3probe`，探针插件）；
`dsh-session/lib/index.js:1621`（服务名）、`dsh-agent/lib/index.js:332,594`、
`dsh-scope/lib/index.js:322`（dispatch 规则）、`dsh-session/lib/types/index.d.ts:64`（事件签名）。

### E-43 · `followup` / `steer` / `inject` 的**真实区别** = 两个参数

**现象（Q1 的核心）**：三者看着像三种能力，其实是**同一个 `send` 的三种参数组合**。

**证据（源码，一行对照）**：
```js
// @deepseek-ai/dsh-agent-loop/lib/index.js:806-812
followup(input) { this.send(input, "next-turn", true); }   // 排到 next-turn，唤醒
steer(input)    { this.send(input, "next-step", true); }   // 排到 next-step，唤醒
inject(input)   { this.send(input, "next-step", false); }  // 排到 next-step，**不唤醒**
```
`InboxTarget = 'next-turn' | 'next-step'`
（`dsh-agent/lib/types/types.d.ts:31`）。

**语义差异（JSDoc 原文要点）**：
· `followup` — "Queue an ordinary follow-up turn and wake the driver.
  The item becomes the **sole ordinary message of its own turn**."（独占一个新 turn）
· `steer` — "Submit steering for the nearest step. An idle driver starts a turn;
  a running driver consumes it at its **next step boundary**."（插进当前 turn 的下一步；
  若 driver 空闲则会**起一个新 turn**）
· `inject` — "Queue model-facing context for the next pre-step **without waking the driver**.
  … idle drivers leave it pending until follow-up or steering wakes them."
  （**不唤醒**；空闲时它就一直挂着；且可能**错过**已经 claim 过 pre-step 的那次请求）

**正确做法**：要"对方一定会处理"⇒ `followup`（唤醒）；
要"塞进正在跑的那一轮的下一步"⇒ `steer`；
要"只加背景、别打扰它"⇒ `inject`（但要接受它可能一直不被消费）。

**⚠ 投递内容必须是完整 `UserMessage`**（不是字符串）：
`{ id: MessageId, content: readonly ContentBlock[], source: MessageSource, role: 'user' }`
（`dsh-llm/lib/types/message.d.ts:124-146`）。

**出处**：第 2 步只读核实（未投递）；`dsh-agent-loop/lib/index.js:806-812`；
`dsh-agent/lib/types/runtime-types.d.ts:186-209`（三条 JSDoc）。

### 🔴 E-44 · 判据里的 `cmd | grep | head` 会**吞掉真退出码**（本轮又踩一次）

**现象**：`npx tsc -p tsconfig.json 2>&1 | grep -v UNDICI` 打出 `exit=1`，
我据此以为编译失败 —— **实际 tsc 的退出码是 0**，`1` 是 **`grep` 没匹配到任何行**的退出码。

**根因**：管道的 `$?` 是**最后一个命令**的退出码。用 `grep -v`（排除噪音）时，
若过滤后无输出，`grep` 以 `1` 退出 ⇒ **判据指向了错误的对象**。

**正确做法**：取管道里**目标命令**的退出码：
```bash
npx tsc -p tsconfig.json > out.txt 2>&1; echo "exit=$?"      # 首选：不接管道
# 或： ${PIPESTATUS[0]}
```
**同类教训**：这与 E-29「零日志不是证据」是同一族 —— **判据本身错了，
比结论错了更危险**。任何"用管道加工输出再判成败"的地方都要问一句：
**我现在读到的是谁的退出码？**

**⚠ 同族第三条（批 7 追加的互指）**：本族另有 **E-84** ——
多帧 zstd 只解首帧（`zstdDecompressSync()` 静默截断）⇒ 误判"数据里没有该事件"。
三条（E-29 / **本条** / E-84）的共同修法：**先证明观测器活着，再读观测值**。
本条原有内容未改。

**出处**：第 2 步实测（本轮真实踩到，报表前后各一次）；与旧项目 `README.md`
第五个坑的「两个方法错误」同源。


---

## 6c. 第 3 步新增（2026-10-05 · M2 预设声明：两个 Agent 预设）

### E-45 · 宿主 preset **不能**从包外声明：patch 必须由 `dsh.bundle.patch` **数组**列入本包

**现象**：把 `preset/dsh-hob/` 当一个独立包去装（旧项目的形态），用户要**额外装一次**；
而 `PROJECT.md` §4.3 要求「装插件 = 两个预设就位」。

**根因 / 机制**：`dsh-app-boot` 的 `bundlePatchFiles(bundle)` 接受
**字符串或字符串数组**（`dsh-app-boot/lib/index.js:495-497`，`bundlePatchPaths:507-509` 按
`join(packageDir, file)` 逐个解析）。宿主 `dsh-web-app` 自己就是这么挂
标准/ptc/minimal/cordis 四个预设的（它的 `dsh.bundle.patch` 是 5 项数组）。
⇒ **一个包可以声明任意多个 preset 行**，只要把各自的 patch 文件列进自己的数组。

**正确做法**：本插件根 `package.json` 写
```json
"dsh": { "bundle": { "patch": [
  "./cordis.patch.yml",
  "./preset/dsh-hob/preset-dsh-hob.patch.yml",
  "./preset/dsh-hob/preset-dsh-hob-work.patch.yml" ] } }
```
两个预设随插件一次装好（实测 `--dump-config` 里两行都在）。

**⚠ 反面提醒**：`preset/dsh-hob/package.json` **不要**再声明 `dsh.bundle.patch`，
也**不要**把该目录另加进 profile 的 `dsh.profile.bundles` —— 否则同 id 的 preset 行
（`preset-dsh-hob` / `preset-dsh-hob-work`）会被挂载两次，落在宿主 loader 的
"duplicate loader entry id" 上。**该失败形态本轮未实测**（没构造该场景），
故只是规避建议，不作为已验证结论。

**出处**：第 3 步实测（`--dump-config` 两行俱在）；`dsh-app-boot/lib/index.js:495-509`；
宿主样例 `dsh-web-app/package.json` 的 `dsh.bundle.patch`（5 项数组）。

### 🔴 E-46 · 预设的选择器只读**运行时注册表**，`--dump-config` 通过**不等于**预设可用

**现象**：`--dump-config` exit=0 且预设行都在装配树里，但预设未必能被会话选中 ——
装配层（YAML 树）与运行时（`agentPresets` 注册表）是**两条判据**。

**根因**：`AgentPresetRegistry.register()`（`dsh-agent-preset-registry/lib/index.js:521-547`）
把每个声明 `mountPreset` 起来，失败写进 `record.broken`；`list()` 把 `broken` 带出来，
而**客户端的 `presetOptions()` 会静默过滤掉 `broken !== undefined` 的项**
（旧项目 `preset-picker-investigation.md` 的 Q1 已定位）⇒ 加载失败的预设在选择器里
**连卡片都不显示**，只在设置页有红标。

**正确做法**：验收必须**在运行时**读注册表：
```js
const roster = await ctx.agentPresets.list()   // 每行带 broken
```
判据 = 目标 id 出现 **且 `broken === undefined`**。本步实测（隔离实例，探针插件）：
`ROSTER: standard | ptc | minimal | cordis | dsh-hob | dsh-hob-work`，两行均 `broken=NO`。

**出处**：第 3 步实测（`.hob/archive/2026-10-05-step3-evidence/probe-runtime.log`）；
`dsh-agent-preset-registry/lib/index.js:521-597`。

### 🔴 E-47 · `ctx.tools.schemas(scope)` 的 scope **必须是 `scopeOf(agent.ctx)`**，传 `agent` 得到空数组

**现象**：探针里 `ctx.tools.schemas(agent)` 永远返回 **`[]`**，
连宿主自带的 `cordis` 预设也是 0 个 —— 差点据此写出"工具面为空"的错结论。

**根因**：`schemas(scope)` 把 scope 透传给 `view()` → `this.layers.chainLayers(scope)`
→ `scopeChainOf(key)`，而 `scopeChainOf` 只接受 **scope key 对象本身**；
传 `agent`（或其 `.ctx`）时 `scopeParents` 里查不到 ⇒ 链条为空 ⇒ 只剩 global 层 ⇒
`visible` 为空。（`dsh-tools/lib/index.js:3023`、`dsh-scope/lib/index.js:162-168,276-280,312-314`。）

**正确做法**：`import { scopeOf } from '@deepseek-ai/dsh-scope'` 后
`ctx.tools.schemas(scopeOf(agent.ctx))`。

**⚠ 探针自身的阴性对照不可省**：先用 `ctx.tools.schemas(undefined)`（全局视图）确认
探针能读出非空 —— 本步在加 `interconnect` 后读到 **4 个** `interconnect_*`，
这才排除了"探针失效"。**没有这个对照，`TOOLS(0)` 会被当成"收敛得很干净"。**

**出处**：第 3 步实测（踩到并修正，见 `probe-runtime.log` 前后两版）；
`dsh-tool-subagent/lib/invariant.js:35` 用的是 `ctx.tools.schemas(agent)` ——
**注意：那里传的是 agent，因为 `ScopeKey` 就是 object，agent 对象本身**也可能是 key**
（宿主内部把 agent 当 scope 载体）；探针里没有那个载体身份，故必须走 `scopeOf`。**

### 🔴 E-48 · `complete: true` 的落点判据 = `assemble().sections.length === 1` 且 `contexts.length === 0`

**现象**：契约文本很长，"它真的成了**唯一** prompt 段吗"这句话用读 YAML 是答不了的。

**根因 / 机制**（读源码得到确定答案，不是推断）：
`dsh-system-prompt/lib/index.js:335-360` —— 先算 `completeSections`，
**多于一个直接抛** `multiple complete prompt sections are active`；
存在则把 `sections` 替换成 `[completeSection]`。
`includeRuntimeContext: false` 走 `persona` 的 `suppressRuntimeContext()`
（`dsh-persona/lib/index.js:47`）⇒ `contexts` 也被清成 `[]`。

**正确做法**：判据写成一个可直接跑的断言：
```js
const asm = await ctx.systemPrompt.assemble({ scope: scopeOf(agent.ctx) })
// 规划预设：sections=1 contexts=0 names=[deployment:persona-prefix]
```
本步实测：`dsh-hob` = **1 段 / 0 上下文**（len 3361）；
对照 `cordis` = **22 段 / 2 上下文** ⇒ 证明 `complete` 确实压住了其余段，
而不是"恰好只有一段"。

**出处**：第 3 步实测（`probe-runtime.log`）；`dsh-system-prompt/lib/index.js:305-360`；
`dsh-persona/lib/index.js:35-47`。

### E-49 · 搬来的 `DEFAULT_DENY` 不是装饰：**清空它，工具面从 2 变 6**

**现象**：规划预设"恰好 2 个工具"这个结论，读 YAML 只能得到**上界**
（我声明了什么），得不到"宿主平面没漏进来"。

**根因**：宿主平面的工具行（如 `dsh-interconnect` 的 `- id: tool-interconnect`）
注册进**全局层**、被每个 agent 继承；`restrict()` 才是唯一能摘掉它们的机制
（E-14/E-15 已记）。**"我的 preset 不声明它"拦不住。**

**正确做法 / 本步做法**：造一个**负向对照副本** —— 复制整包，
只把 `lib/preset/tools.js` 的 `const DEFAULT_DENY = [...]` 清成 `[]`，
同实例、同探针、同 profile 一起跑：
```
TOOLSET dsh-hob     (2): read_contracts,write_hob
TOOLSET dsh-hob-nc  (6): interconnect_list,interconnect_ping,interconnect_reply,interconnect_send,read_contracts,write_hob
```
⇒ **"2" 是守卫的实际效果，不是探针失效**。

**出处**：第 3 步实测（同实例三预设对照，`probe-runtime.log`）；
`src/preset/tools.js` 的 `DEFAULT_DENY` / `attemptDeny`。

### E-50 · 干活预设的"工具全给"要**用集合相等**证明，不要用行数

**现象**：说"与创造模式一致"很容易变成一句口头保证。

**正确做法**：同一实例同一探针，取两个预设的工具名**排序集合**做相等比较：
```
TOOLSET dsh-hob-work (33) == TOOLSET cordis (33)   →  SET-EQ true
```
另给**行级对照**（`grep '^- id:'` 计数）：干活预设 34 行 / 宿主创造模式 34 行，
逐行 diff 只多一行 `name: dsh-hob 干活方`（显示名），**工具行零差异**。

**出处**：第 3 步实测（`probe-runtime.log` + 行级 diff 脚本）。

### E-51 · 改插件的 `dsh.bundle.patch` 为数组后，**老 profile 的生效条件是重启**（本轮未重启）

**现象**：`system` profile 的软链指向本仓 ⇒ **磁盘改动立刻反映在 `--dump-config` 里**
（本步实测：真机 dump 里两个预设行都在），但**运行中的 3088 不会重读**。

**根因**：host 半边没有 hmr（与 UD-05 同一条事实）；`--dump-config` 是**离线**组合，
读的是磁盘上的 `package.json` + patch 文件，与运行中进程的内存组合无关。

**正确做法**：把"装配层已验"与"真机已生效"分开写。
本步如实记：**装配层（`--dump-config` exit=0、两行俱在、零新增 warn）已验证；
运行时（真机 3088 上出现两个预设）未验证 —— 需重启，用户已定"等有第一批能力后再重启"（UD-05）。**

**出处**：第 3 步实测（`system-dump-config.txt` 的 preset 行）；方案 §9.1 / UD-05。

### E-52 · 复制整包做对照时，`node_modules` **软链**比复制省事且不会失真

**做法**：把要对照的产物目录 `cp -r` 出来后，只需 `ln -s <原包>/node_modules <副本>/node_modules`，
`@deepseek-ai/*` 的解析路径即与原件一致（本步靠它让 `hob-step3-nc` 副本无需再装依赖）。
副本**必须**有独立的 `package.json`（`name` 改成别的）+ 独立 patch 文件，
否则与原件同 id 撞车 ⇒ 宿主的 `register()` 会抛
`Duplicate agent preset: <id>`（`dsh-agent-preset-registry/lib/index.js:527-529`）。

**⚠ 成立前提（批 7 追加的限定）**：软链的**安全性依赖一个前提**：
**只在副本自己的目录内读写，绝不往软链路径里创建新条目**。
违反它就会**穿透写入目标**（真机 profile）—— 实测后果与修法见 **E-85**。
⇒ 做"整目录软链"这类省事写法前，先问一句：**我会往这个被链接的路径里写吗？**
本条原有内容未改，只是补上了它的适用边界。

**出处**：第 3 步实测（`hob-step3-nc` 负向对照副本）。


## 6d. 第 3 步修订新增（2026-10-05 · 预设显示名与语言规则）

### 🔴 E-53 · 用户自建预设的**显示名/说明不参与界面本地化** —— 声明里写什么，界面就显示什么

**现象（预期管理）**：想"让预设名跟随界面语言自动切换"（中文界面显示中文名、英文界面显示英文名）
—— **做不到**，且**不会报错**，只会静默地永远显示声明里的那个字面值。

**根因**（读源码得到确定答案）：`dsh-client-ui-agent-preset/lib/client.js:249-266`
```js
function isBuiltInPreset(preset) {
    return preset.name === void 0 && BUILT_IN_PRESET_KEYS[preset.id] !== void 0;
}
function presetDisplayText(preset, t) {
    const keys = isBuiltInPreset(preset) ? BUILT_IN_PRESET_KEYS[preset.id] : void 0;
    if (keys !== void 0) return { name: t(keys.name), description: t(keys.description) };
    return { name: preset.name ?? preset.id,
             ...preset.description === void 0 ? {} : { description: preset.description } };
}
```
`BUILT_IN_PRESET_KEYS` 只登记宿主自带的四个（`standard` / `ptc` / `minimal` / `cordis`），
其文案来自 locale 包（`presetStandardName` 等，中文=「标准模式」/「创造模式」…）。
**两个条件的合取**才走本地化：`name === undefined` **且** id 在登记表里。
自建预设一旦**声明了 `name`**（本项目就必须声明，否则显示成 id），第一个条件即不成立。

**正确做法 / 本项目落法**：把这条当作**已知约束**接受 ——
显示名用**固定中文字面值**（`助手` / `开发`），**不要**去追"界面文案跟随语言"。
真正能"跟随"的是**模型的输出**：在两份 persona 正文里加 `## Language` 规则
（"Reply in the language the user is currently using"）—— 那才是有机制的落点。

**⚠ 同族的一条（顺带核实）**：选择器只显示**未 broken** 的预设
（`presetOptions()` = `presets.filter(p => p.broken === void 0)`，`client.js:1139`），
所以"显示名写对了"这件事，必须先保证预设**没 broken** 才看得见（见 E-46）。

**出处**：第 3 步修订实测（真机 `--dump-config` + 源码核对）；UD-15/UD-16；CHG-004。

### 🔴 E-54 · 中文 `description` **不要用 `>-` 折叠块** —— 会在句间夹一个空格

**现象**：`description: >-` 分两行写中文，界面上显示成
`「…维护自己的账本。 它读代码文档…」` —— 句号后多一个空格。中文不用空格分词，看着是错字。

**根因**：YAML 折叠标量（`>` / `>-`）把**换行折成一个空格**（这是它的定义行为，
英文散文正好需要它）。中文句子不需要，于是那个空格变成可见的杂质。

**正确做法**：中文多句文案用**单行双引号标量**：
```yaml
description: "第一句。第二句。第三句。"
```
长度不是问题（描述本就一到两句）。需要真换行时用 `|-`（literal，保留换行），
但那在 UI 里也是换行，不是折行 —— 中文短文案不必。

**同类提醒**：persona 的 `prefix` 用 `|-`（literal）**是对的** —— 契约正文靠空行分段，
必须保留换行（用 `>-` 会把整篇压成一行，段落结构全丢）。

**出处**：第 3 步修订实测（先把 `>-` 写出来，dump 出 `账本。 它读…` 后改单行）。

### E-55 · 契约正文有**两份载体**（机器读版 / 人读版）时，用脚本核对"不许漂移"

**问题**：预设里那份（YAML `|-` 块）是**宿主真正加载**的；`.hob/drafts/preset-contracts.md`
是**用户过目与将来改动**的地方。两份手工同步**必然漂移** ——
与"守卫写两遍必然漂移"（E-22 同类）是同一条纪律。

**做法**：`scripts/check-preset-contracts.mjs`（已挂 `npm run check:presets`），
机检 6 项：① 显示名 ② **id 未变** ③ **正文不拿 id 指代对方**（只允许 `Never print a preset id`
那条禁令句）④ 两份都含语言规则 ⑤ 人读版引文块与机器读版**逐字一致**
⑥ `complete:true` 与工具面声明未变（助手=1 行工具模块；开发行数 == 宿主创造模式）。

**⚠ 写这个脚本时自己踩的坑**：第一版用 `^\s{6}` 抓 `config` 下的 `name`，
抓到的却是 6 空格层的 `name: '@deepseek-ai/dsh-agent-preset'`（**preset 行的插件名**），
于是脚本自己报"显示名应为「助手」，实测「@deepseek-ai/dsh-agent-preset」"。
⇒ 行级 YAML 解析**必须锚定缩进层级**；本文件的层级是
`- insert:`(0) → `- id: preset-…`(4) → `config:`(6) → `id/name/description`(8)。

**⚠ 脚本必须自证有牙**：改坏显示名 → FAIL；把 id 写回正文 → FAIL；恢复 → PASS。
三步都跑过（见 `.hob/STEP3-REV-REPORT.md`）。

**出处**：第 3 步修订实测（三步负向对照 + PASS）。

### E-56 · 改文件前先备份 —— 本轮**先改后备份**，靠宿主的编辑捕获救回

**现象（我犯的错）**：本轮先 `edit` 了两个预设文件，**之后**才 `cp` 备份 ——
备份到的是**改后**的内容，回退点无效。

**怎么救回的**：宿主（DSH 编辑器/写入路径）在**每次写入前**会把原文件快照进
`/tmp/dsh-workspace-changes-*/captures/<sha1>`。按**字节数**与内容特征
（是否含旧显示名 `dsh-hob 规划方`）认出改前版本，并核对它的 sha256
**等于我在上一批报告里记过的改前值**（`995e2210…` / `74e946b0…`）⇒ 确认无误后留作回退点。

**正确做法**：`cp -p <目标> <备份>` **必须在第一次 `edit` 之前**。
若要事后补救，捕获目录可用，但**必须用 sha256/特征串证明它就是改前版本**，
不能凭文件名或时间戳假定（这次能救回是因为上一批恰好在报告里留了改前 sha256）。

**出处**：第 3 步修订实测（`/tmp/dsh-workspace-changes-OKrvTx/captures/`）；
`.hob/STEP3-REPORT.md` §三「判据 7」记的改前 sha256。



## 6e. 第 4 步新增（2026-10-05 · M1 工具接真实逻辑 + 称呼统一）

### 🔴 E-57 · 插件作用域注册的工具会**漏进每一个预设**（含宿主自带的那几个）

**现象**：在插件（宿主平面）作用域的 `apply` 里 `ctx.tools.register(...)` 一个工具，
它会出现在**所有**预设的工具面里，不只是本插件的那两个：

| 预设 | 注册前 | 注册后 |
|---|---|---|
| `minimal` | 5 | **6** |
| `standard` | 30 | **31** |
| `dsh-hob`（助手） | 2 | **3** |
| `dsh-hob-work`（开发） | 33 | **34** |

**根因**：插件作用域注册进的是**全局层**，而 `view()`/`schemas(scope)` 对每个 agent
都把 `chainLayers(scope)`（全局层 + 祖先层 + 本 scope 层）合并（`dsh-tools/lib/index.js:2960`）。
所以全局层的工具**被每个 agent 继承** —— 与 E-14（宿主平面行摘不掉）是**同一条机制的两面**。

**正确做法**：要"只给某一个预设的工具"，**必须在预设作用域注册**
（`preset/<id>/` 的 patch 里挂一个模块，模块的 `apply` 跑在 `dsh-agent-preset` 为每个
预设建好的独立 scope 里）。实测：预设作用域注册**不漏** —— 助手恰好 2 个、`minimal` 不变。

**⚠ 本步的架构结论**：本插件的两个工具因此**不能**在 `src/modules/tools.ts` 里注册，
只能由 `src/preset/tools.ts`（preset 行引用）在预设作用域注册。
`modules/tools.ts` 的职责收缩为**工具定义（唯一一份）+ 门禁服务**。
这与 `PROJECT.md` §3.4 的目录示意（`modules/tools.ts` 像"工具模块"）有张力 ——
**以本实测为准**（§5.2「只有规划预设挂本插件的工具」是硬要求）。

**⚠ 一处探针教训**：第一次测"会不会漏"时，我在 spike 里写了个**不合法的工具定义**
（缺 `output: { schema, render }`），`register` **抛错**了，于是四个预设的工具面**都没变** ——
差点据此得出"不漏"的错误结论。**报错必须看**：spike 的自查日志明写
`register 抛错: tool "spike_plugin_scope_tool" must declare output { schema, render, presentationMeta? }`。
⇒ 任何"没变化"的测量，先问一句**"我的探针真的动了吗"**（与 E-29「零日志不是证据」同族）。

**出处**：第 4 步实测 `--dump-config` + 运行时逐预设 dump；
`.hob/archive/2026-10-05-step4-evidence/spike-leak-measurement.log`（含 selfcheck 的 register 成功行）。

### 🔴 E-58 · 门禁走**静态 `inject`** 会把预设标成 `broken`（在选择器里静默消失）

**现象（反例，先撞的）**：想让"`modules.tools` 关掉 ⇒ 预设不注册工具"，
最自然的写法是把门禁服务写进预设行的**静态 `inject`**：
```js
export const inject = ['tools', 'hobToolsGate']   // ← 这么写会出事
```
门禁不在时，该 fiber 停在 `PENDING`，预设被标 **`broken`**：
```
ROSTER: … | spike2 [BROKEN: probe (hob-spike/modules/tools): waiting for hobToolsGate]
SESSION spike2: FAIL probe (hob-spike/modules/tools): waiting for hobToolsGate
```
而 `broken` 的预设**在选择器里被静默过滤掉**（`presetOptions()` 只留 `broken === undefined`，
`client.js:1139`）⇒ 用户视角是"预设不见了"，且**宿主零告警**（不读注册表就发现不了）。

**正确做法**：门禁走**反应式** `ctx.inject([...], (child) => …)` ——
依赖缺席时**只是不跑回调**，预设照常可用。实测对比：

| 写法 | 门禁在 | 门禁不在 |
|---|---|---|
| 静态 `inject` | 注册工具 ✅ | 预设 **`broken`** ❌ |
| 反应式 `ctx.inject` | 注册工具 ✅ | 不注册；**不 broken、零告警**、插件整体照常 ✅ |

**⚠ 顺带的正确用法**：反应式回调给的**子 ctx**（`(child) => child.effect(...)`）才是注册落点 ——
子 ctx 继承依赖 API 且**拥有它自己的注册** ⇒ 门禁消失时注册随之拆除，
不用手写卸载（宿主自己的用法见 `dsh-agent-preset-registry/lib/index.js:485`）。

**出处**：第 4 步实测两版对照；
`.hob/archive/2026-10-05-step4-evidence/spike-gate-broken.log`（静态 inject 的反例）
与 `spike-reactive-gate.log`（反应式的正例）。

### 🔴 E-59 · 读侧**真的能读穿符号链接** —— 实测确认，不是"理论上"

**现象**：`doc-read.ts` 原先自己记着"已知限制：未跟随符号链接……当前不处理；如需收紧再加"。
第 4 步按任务书造违规场景时**实测确认它是真漏洞**：
工作区里放一个 `escape.md -> /tmp/hob-step4-escape/secret.md`（指向区外），
`read_contracts` 把**区外文件内容原样读了出来**：
```
V7 真·逃逸软链(指向工作区外): [{"type":"text","text":"工作区外的私密文档\n"}]
```
**根因**：`resolveInside()` 只做**字符串层**的越界判断（`path.relative`）——
软链的**路径字符串**仍在 root 内，但真实目标在区外，字符串层看不出来。

**正确做法（本步落法，守卫只写一份）**：走链检查实现**上提到 `doc-read.ts`** 并导出
（`findSymlinkOnPath`），**读侧与写侧共用同一份** ——
`hob-write.ts` 已经 import `doc-read.ts`，放这边**不成环**；反过来会成环。
读前逐段 `lstat`，命中软链即拒绝（话术沿用 `DENIED`，不泄露存在性）。
修后实测：逃逸软链 **`reason=symlink` 被拦**，同目录的正常 `.md` **照常可读**（无误伤）。

**⚠ 写侧本来就是对的**（同一时刻实测）：`.hob/` 里的软链被拒
（`拒绝：路径中存在符号链接（…），write_hob 不跟随软链。`）。
**真正的教训**：两侧都写了"不跟随符号链接"的**注释**，但只有写侧有**实现**；
"记在注释里的限制"不会自己变成守卫 —— 必须**造场景验一次**。

**出处**：第 4 步实测；`.hob/archive/2026-10-05-step4-evidence/e2e-tool-calls.log`
（修前的 V7 读数）与修后复测（同目录 `reason=symlink`）。

### E-60 · 编辑 YAML 时 `old_string` 已含新行 ⇒ **键被写两遍**，宿主解析直接失败

**现象（我犯的错）**：给预设的 `tool-hob-contracts` 行补 `enableWrite: true` 时，
`edit` 的 `old_string` 尾部**已经**包含了上一轮加进去的 `enableWrite: true`，
于是同一把键出现两次。宿主加载时报：
```
YAMLException: duplicated mapping key (155:15)
 154 |               enableWrite: true
 155 |               enableWrite: true
```
后面的链路是**静默降级**：该 bundle 被跳过（`dsh: skipping profile bundle "dsh-hob"`），
**两个预设一起消失**，探针只报 `Unknown agent preset: dsh-hob` ——
看起来像"预设没注册"，其实是**YAML 根本没解析成功**。

**正确做法**：① 改 YAML 后**必须**跑一次解析（哪怕只 `python3 -c "yaml.safe_load"`）
或用 `--dump-config` 看 bundle 是否被 skip；② 探针报"preset 不存在"时，
**先看宿主的 stderr**（`skipping profile bundle` 一行就指出真因），
不要一头扎进注册表代码。

**出处**：第 4 步实测（`/tmp/p8.err`）；与 E-44「判据指向错误对象」同族 ——
**报错信息里的那一行才是判据**。



## 6f. 第 6 步新增（2026-10-05 · M4 + C1 设置界面）

### 🔴 E-61 · client 半边的 `dsh.client.inject` 只能列**有 client 半边的包**（列错被静默忽略）

**现象**：插件的 `package.json` → `dsh.client.inject` 里列了一个包名，
但它**没有 client 半边**（没有 `exports["./client"]`、没有 `dsh.client` 声明）——
**没有任何报错**，只是那条依赖在客户端被跳过。于是"我以为声明了依赖，其实没等到"。

**根因**（读实现得到确定答案）：`dsh-client-modules/lib/client.js:656-659`
```js
for (const packageName of row.inject) {
  const dependency = this.graphRows.get(packageName);
  if (dependency !== void 0) await this.arriveDependency(row.id, dependency, [], visited);
}
```
`graphRows` 只登记**图里有的**包，而图只收声明了 `dsh.client` 且 `exports["./client"]`
可解析的包（`clientExportOf()`，`lib/index.js:171-181`）。**找不到就 `continue` 语义**，
不 throw、不 warn。

**本项目的具体踩法**：`@deepseek-ai/dsh-client-ui-slots` **只有 host 半边** ——
它是 slots 的**类型/契约**包（`lib/index.js` 里只有 `SlotCore` 等，无 client 入口）。
而真正 `provide("slots")` 的是 **`@deepseek-ai/dsh-client-ui-renderer`**
（`super(ctx, "slots")`）。原骨架把前者写进了 inject ⇒ 一直是**空声明**。

**正确做法**：`inject` 里写**服务的提供者**，不是写类型包。本插件最终为：
```json
"inject": ["@deepseek-ai/dsh-client-ui-renderer", "@deepseek-ai/dsh-client-ui-settings"]
```
（`slots` ← renderer；`configForms` ← ui-settings。两者都实测有 `dsh.client` + `./client` 导出。）

**判据（可机检、别再靠肉眼）**：对每个 inject 目标查
`package.json` 的 `dsh.client` 是否存在 **且** `exports["./client"]` 能否解析出字符串
（`clientExportOf` 的规则：字符串，或对象里的 `.default` 字符串）。

**出处**：第 6 步实测；`dsh-client-modules/lib/client.js:656`、`lib/index.js:171-181`；
`dsh-client-ui-renderer/lib/client.js:1323`（`super(ctx,"slots")`）。

### 🔴 E-62 · `volatile` 的**对象**形状：标父对象（不是给子字段各标一个）

**现象**：`modules`（一个含四个布尔开关的对象）**整块从设置页消失**，
而 `persona` / `showEntry` / `delivery` 三个顶层叶子都在。设置页**没有任何报错**。

**根因**：宿主 `SettingsForms.describe()` 先跑 `volatileForm(schema)`
（`dsh-settings/lib/index.js:122-131`）：
```js
function volatileForm(schema) {
  if (schema.meta.volatile) return plainSchema(schema);
  if (schema.type === "object") {
    const dict = Object.fromEntries(Object.entries(schema.dict ?? {}).flatMap(([key, child]) => {
      const field = volatileForm(child);
      return field === void 0 ? [] : [[key, field]];
    }));
    return Object.keys(dict).length === 0 ? void 0 : z.object(dict);
  }
}
```
**object 只保留"有 volatile 叶子"的子键**；子键全无 volatile ⇒ `volatileForm` 返回
`undefined` ⇒ 该键被 `flatMap` **丢掉**。`modules` 的四个子字段都没标 ⇒ 整块消失。

**为什么不能"给四个子字段各标一个"**（这是最容易想到的修法，但会抛）：
schemastery 的 `validateVolatileSchema`（`schemastery/src/index.ts:488-509`）规定
**volatile 字段不能在另一个 volatile 字段内部**：
```
volatile fields require a fixed object path without an enclosing volatile field
```
父子同时标 ⇒ 直接 `ValidationError`。**实测三种形状**：
| 形状 | 结果 |
|---|---|
| 都不标 | 不报错，但设置页**丢掉整块** |
| 父+子都标 | `ValidationError`（抛） |
| **只标父对象** | ✅ 设置页显示 `modules.{tools,preset,bus,settings}` |

**⚠ 代价（必须一起记）**：`modules` 标 volatile 后，运行时它是 **ref 对象** ——
`config.modules.tools` **静默**变成 `undefined`（不报错！），四个模块开关会**全部失效**。
取值必须 `config.modules.get().tools`。
⇒ 本项目把这件事**收口到一个函数** `moduleSwitches(config)`（`src/config.ts`），
同时容忍 ref 与普通对象；调用方（`src/index.ts`）不必知情。
宿主自己的写法同此：`this.config.selectedDefault.get() ?? this.config.default`
（`dsh-agent-preset-registry/lib/index.js:494`）。

**出处**：第 6 步实测（隔离实例 `describe()` 的原始 schema + 三个候选形状的抛错对照）；
`.hob/archive/2026-10-05-step6-evidence/{volatileform,volatile-shape,volatile-nesting}-check.mjs`。

### 🔴 E-63 · 设置里改**值**当场生效；改**模块开关**要重载 —— 这不是缺陷

**现象**：经设置页把 `modules.tools` 改成 `false` 后：
`describe()` 里 value 已是 `false`、profile 的 `cordis.patch.yml` 也已落盘，
**但工具仍然注册着**（门禁还在、助手仍是 2 个工具）。

**根因**（读实现得到确定答案）：宿主写入后只做
`resolveConfig(fiber.runtime, resolved)`（`dsh-config-editor/lib/index.js:83`）——
它**重新校验配置对象**（`cordis/lib/index.js:956-962`），
**不会重新执行 `apply()`**。而模块的装载/卸载发生在 `apply()` 里
（本项目 `src/index.ts` 的 `MODULE_REGISTRY` 循环）
⇒ 开关值变了，**已装载的模块不会被卸载**。

**⚠ 这**不是**缺陷**：宿主的 `volatile` 定义就是
  *"Select fields whose nearest volatile ancestor makes them editable **without remounting**"*
  （`dsh-settings/lib/types/schema.d.ts:7`）。
  volatile 的语义是"**值**可热改"，**不是**"挂载拓扑可热改"。要改拓扑本来就要重挂。

**实测的完整对照**：
| 字段 | 写后运行时 config | 是否即时生效 |
|---|---|---|
| `persona` / `showEntry` / `delivery` | 当场变（实测 `mentor→executor` 等） | ✅ **即时** |
| `modules.tools=false` | 运行时 config 当场变 `false`，**但门禁还在、工具仍注册** | ❌ **需重载** |
| 重载之后再看 `modules.tools=false` | 门禁**不在**、助手 **0** 工具、预设仍在 roster、**零告警** | ✅ 生效 |

**正确做法（对本项目）**：把这条语义**写进用户可见的地方**
（C1 面板里明写"值型当场生效 / 开关需重启实例"），
不要试图让开关热生效 —— 那要自建模块热插拔，属另一件事。

**出处**：第 6 步实测（同一实例内"写前/写后"对照 + 重启后复核）；
`.hob/archive/2026-10-05-step6-evidence/settings-e2e.log`。

### 🔴 E-64 · 槽位组件必须返回**真 React 元素**，手写 `{type, props}` 不是 ReactNode

**现象（潜在缺陷，本步扫到并修）**：骨架期的 `SettingsPanel` 返回
`{ type: 'div', props: { children: [...] } }` 这种**普通对象**。
它在骨架期没被注册（`client/index.ts` 不挂槽位），所以**一直没暴露**。

**根因**：槽位组件的类型是
`SlotComponent<P> = (props: P) => ReactNode`（`dsh-client-ui-slots/lib/types/index.d.ts:343`）。
React 元素需要 `$$typeof` 标记，**普通对象不是合法 ReactNode** —— 渲染时
要么报错、要么显示 `[object Object]`。

**正确做法**：写 **JSX**（本项目 `tsconfig.client.json` 已设 `jsx: "react-jsx"`，
`react/jsx-runtime` 已在 `tsdown.config.ts` 的 external 列表里，无需改构建面）。
注意组件函数**不能声明返回 `unknown`** —— 那样 TS 报
`TS2786: 'Row' cannot be used as a JSX component`；应声明 `ReactElement`。

**判据**：产物 `lib/client.js` 里应出现 `jsx(...)` / `jsxs(...)` 调用
（本步实测：`jsx` 28 处、`jsxs` 4 处，且 require 列表含 `react/jsx-runtime`）。

**出处**：第 6 步实测（`npm run typecheck` 的 TS2786 → 改 JSX → 产物核对）。

### E-65 · `describe()` 返回的 `schema` 是**引用图**，不是嵌套对象

**现象**：探针里写 `row.schema.dict` 得到 `undefined` / `{}`，
看起来像"设置页没有任何字段" —— 而实际上字段都在。

**根因**：`describe()` 给的 `schema` 是 schemastery 的
`toJSON()` 产物，形状为 `{ uid, refs: { "<id>": node } }` ——
节点之间靠 **refs 表 + uid 数字引用**串起来，**不是**嵌套的 `dict`。正确读法是
`refs[String(schema.uid)]` 取根，再 `refs[String(root.dict[key])]` 逐层下钻。

**正确做法**：探针/工具读 schema 时走 refs 表；
或者干脆**别读 schema**，改用 `volatileForm(schema)` 的等价投影来回答
"设置页会显示哪些字段"（本步两种都用了，结论一致）。

**同类提醒**：这与"判据指向了错误的对象"（E-44）同族 ——
**读到了 `undefined` 先怀疑自己的读法**，别直接下"没有"的结论。

**出处**：第 6 步实测（探针第一版读到 `[]`，改用 refs 后字段齐全）。



## 6g. 第 6 步收尾新增（2026-10-05 · 隐藏单个子字段 / 分区标题）

### 🔴 E-66 · 在 volatile 的 object 里**隐藏某一个子字段**：只能"父不标 + 要显示的各自标"

**需求**：`modules` 四个开关里要**只显示三个**（`bus` 隐藏，UD-25），
但 `modules.bus` 这个**配置键必须保留**（M3 将来要用）。

**为什么这不是"改一行"**：前几轮已实测两条机制事实（E-62）——
① 父对象整体标 `.volatile()` ⇒ 宿主 `volatileForm` 走 `plainSchema`，
**整块原样呈现，子字段一个不漏**（⇒ 无法在 schema 层单独藏一个）；
② 父子同标 ⇒ schemastery `validateVolatileSchema` **直接抛**。

**两种候选方案与实测结论**：

| 方案 | 做法 | 设置页 | `bus` 键是否保留 |
|---|---|---|---|
| **E** | 父**标** volatile + schema 里**不声明** `bus` | `tools/preset/settings` ✅ | ❌ **一次 UI 写入就被抹掉** |
| **D** | 父**不标**；要显示的三个子字段**各标**；`bus` 不标 | `tools/preset/settings` ✅ | ✅ **写入后仍在** |

**为什么 E 会丢 `bus`**（复刻宿主写入路径实测）：父整体 volatile ⇒
宿主 `strip()` 对整块返回 `{}`（**连同 `bus` 一起**从旧值删掉），
再 merge 进 `projectForm` 投影后的新值 —— 而投影只含三个 volatile 子键，
**里面没有 `bus`** ⇒ 被静默抹除。
D 的形状下 `strip()` **只删三个 volatile 子键**，`bus` 不是 volatile ⇒ **被保留**。

**采用方案 D**。落点：`src/config.ts` 的 `modules`（父不标；`tools`/`preset`/`settings`
各自 `.volatile()`；`bus` 是普通字段）。

**⚠ 代价（形态混合，更隐蔽）**：同一层里**两种形态并存** ——
`tools`/`preset`/`settings` 是 **ref 对象**（**恒 truthy**，直接当布尔用会**永远为真**），
`bus` 是**普通布尔**。任何"直接读"的写法都会在**其中一半**上静默出错。
⇒ 只能由 `moduleSwitches()` 逐字段 `deref()` 收口（第 6 步已建，本轮改为逐字段解）。

**判定"隐藏是否成功"的判据**：`describe()` 返回的 schema 是**引用图**
（`{uid, refs}`，见 E-65）—— 读 `refs[String(refs[String(schema.uid)].dict.modules)].dict`
的键名，看 `bus` 是否缺席。

**出处**：第 6 步收尾实测；
`.hob/archive/2026-10-05-step6rev-evidence/{方案D-形状验证,方案E-丢bus验证,写入路径复刻}.mjs`。

### 🔴 E-67 · 验证"某个配置键还在"时，**测值别用默认值** —— 会掩盖"被重置"

**现象（我差点漏判）**：验证"隐藏 `bus` 后配置键是否保留"，
第一次把 `bus` 的**默认值 `false`** 当作观测值 ⇒ 写入后读到 `bus=false`，
看起来"没变"，但**这说明不了任何事**：如果写入把 `bus` 抹掉、
schema 默认值再补一个 `false`，读数**完全一样**。

**正确做法**：把被测字段设成**与默认值相反的值**（这里是 `bus: true`），
再执行会触发写入的操作，然后看它**是否仍是那个反默认值**。
实测（`bus=true` ⇒ 经 UI 改 `tools` ⇒ 复查）：
```
写入前 bus = true
写入后 bus = true          ← true 保住了 ⇒ 键确实未被抹除
落盘 patch 里 bus: true 仍在
```

**同类教训**：这与 E-44「判据指向错误对象」、E-65「读到 undefined 先怀疑读法」同族 ——
**判据必须能区分"成功"与"恰好看起来像成功"**。
用默认值验证"字段是否保留"，等于用一个**恒真**的断言。

**出处**：第 6 步收尾实测（先跑 `bus=false` 无结论，改 `bus=true` 后得定性结论）。



## 6h. 第 6 步二次修订新增（2026-10-05 · 摘要行掩底隐藏 / volatile 形状规则纠正）

### 🔴 E-68 · volatile 形状规则的**精确边界**：抛错的是「父子同标」，不是「子各标」

**背景（一条被写错过的规则）**：本项目早期把 volatile 的形状规则记成
"给子字段各标 `.volatile()` 会抛 `ValidationError`"，并据此选了"父整体标"。
**这条是错的**，且**错得很贵** —— 它正是"某个子字段藏不住"那个问题的根源：
按这条错规则做，只能父整体标，而父整体标 ⇒ `volatileForm` 走 `plainSchema`
⇒ **子字段一个不漏**，想藏的那个藏不住。

**实测（构造与解析两阶段分开验，三种形状逐一复现）**：

| 写法 | 构造 | **解析** | 效果 |
|---|---|---|---|
| 只标父对象 | OK | OK | 整块呈现，**子字段全显示**（藏不住） |
| **父不标 + 子各标** | OK | **OK** | **未标的子字段被滤掉** ⇒ **能隐藏** ✅ |
| 父子同标 | OK | ❌ 抛 `volatile fields require a fixed object path without an enclosing volatile field` | 不可用 |

**根因**：schemastery 的 `validateVolatileSchema`（`schemastery/src/index.ts:488-509`）
只在 `schema.meta.volatile && blocked` 时抛 —— `blocked` 表示"某个**祖先**已经是 volatile"。
⇒ 受限的只是 **"volatile 里面再套 volatile"**。

**⚠ 连带纠正第二条错表述**：早期注释还写过"volatile 字段必须是**顶层叶子**"。
**也是错的** —— 嵌在**非 volatile** 父对象里的 volatile 叶子**完全合法**
（实测构造/解析都 OK），本项目的 `modules.tools` 就是这种。
"顶层"只是**布局选择**，不是 volatile 的硬要求。

**正确做法（本项目现行形状，`src/config.ts` 的 `modules`）**：
**父不标 + 要显示的三个子字段各自标 + 要隐藏的那个（`bus`）不标**。
⇒ 既藏住了 `bus`，又保住了它的配置键（见 E-66）。

**⚠ 一条关于"注释为什么也要改对"的教训**：
错误注释**比没注释更糟** —— 它会把下一个人（或下一轮的我）引向错误的规避方案。
本轮把 `src/config.ts` 里两处错表述都按实测改正，并注明"曾被写错"以免有人改回去。

**出处**：第 6 步二次修订实测（构造/解析分阶段）；
`.hob/archive/2026-10-05-step6rev2-evidence/volatile-三形状复现.mjs` 与
`volatileForm-呈现对照.mjs`；`PROJECT.md` §5.3.1（主持人按同一实测重写）。

### 🔴 E-69 · 摘要/列表类 UI 要**白名单**，不能"遍历对象的键"

**现象**：把 `bus` 从设置页表单隐藏后，**我自建的只读摘要行里还露着"会话总线"** ——
因为它当时是这么写的：`Object.entries({tools, preset, bus, settings})`
（白名单常量里塞了四个），再 `.filter(([k]) => k in m)`。

**根因**：只要"呈现哪些字段"**跟着数据走**（遍历对象的键 / 把字段表写成全量），
那么"在别处隐藏了某个字段"**不会**同步到这个 UI ——
两处各有一份"该显示什么"的真相，必然漂移。

**正确做法**：UI 侧用**显式白名单**（只列**真的想显示**的），
数据里多出来的键**自然不呈现**。本项目落为
`VISIBLE_SWITCHES = { tools, preset, settings }`（`src/client/settings-panel.tsx`），
并在注释里写明"**不能用遍历 m 的所有键**，否则会把它又漏出来"。

**⚠ 判据要选对粒度**：本轮先 `grep "会话总线" lib/client.js` 得到 **2 处命中** ——
但它们是**我自己的 JSDoc 注释**（client 产物**保留注释**），不是渲染文本。
⇒ 更硬的判据是**执行层**：把编译后的 `moduleSummary` 抽出来**真喂一次含 `bus=true` 的数据**
（实测输出 `"工具开 · 预设关 · 设置开"`，零"总线"），
而不是数产物里的字符串。**grep 产物 ≠ 渲染结果**。

**出处**：第 6 步二次修订实测（UD-27）；
`.hob/archive/2026-10-05-step6rev2-evidence/摘要函数-执行层验证.mjs`。



## 6i. 收尾新增（2026-10-05 · git 初始化 / .gitignore 不一致 / 注释自相矛盾）

### 🔴 E-70 · `.gitignore` 的 `!` 例外**少列一项** ⇒ 文件静默不入库（无任何提示）

**现象**：`.hob/README.md` §1 明确规定 `.hob/EXPERIENCE.md` 是**骨架（进 git）**，
但 `.gitignore` 只有：
```
.hob/*
!.hob/README.md
!.hob/templates/
!.hob/templates/**
```
⇒ `.hob/*` **排除整个 `.hob/`**，而 `EXPERIENCE.md` **没有对应的 `!` 规则**
⇒ 一旦 `git init`，**经验库（当时 69 条实测踩坑）不会入库，且 git 不报任何错**。

**根因（三处不一致，缺一不可）**：
① `.gitignore` 的注释当时只写"`README.md` + `templates/` 是格式契约"，
   **漏了 `EXPERIENCE.md` 这个"特殊骨架"**（它是后加的，README 里有专节，
   但 `.gitignore` 的注释与规则**都没跟着更新**）；
② `.gitignore` **按路径匹配、读不到文件内容**（README §1 自己写明了这条限制），
   所以"这条是不是骨架"无法由内容判断，**只能靠人把清单列全**；
③ 排除是**静默**的 —— `git status` 不会提"某文件被忽略了"。

**正确做法**：**`!` 例外必须与"骨架清单"逐项对齐**，且**逐条注明依据的行号**
（本项目落为：把 3 个骨架文件对到 `README.md` §1 表格第 1 行 + 第 23-33 行的专节，
四个账本与 `archive/` 对到第 2 行）。
**验证手段（可机检，别靠肉眼）**：`git check-ignore -v <路径>` 会**指出是哪一条规则命中的** ——
修前它指向 `.hob/*`，修后 `EXPERIENCE.md` 不再被命中。
⚠ 还要**反向验证**：确认那些文件**确实存在于磁盘**（不是"不存在所以没出现在 status 里"）。

**同类提醒**：这是"**清单漏一项**"家族的坑 —— 与 E-69（UI 白名单）同源：
**凡是"列一份清单去覆盖另一份清单"的地方，就必然有漂移风险**，
必须逐项对齐 + 机检，而不是靠"我记得加过了"。

**出处**：收尾实测（`git check-ignore -v` 逐条验证；`git ls-tree -r HEAD` 确认最终入库）。

### 🔴 E-71 · 注释**自己说自己"刻意不写"、却在上一行写了** ⇒ 判据被自己破坏

**现象**：`src/client/settings-panel.tsx` 里一段注释写着
"本注释也刻意不把它的**界面显示名**写进来"，**但上一行就写了那个中文名**。
后果：client 产物**保留注释** ⇒ `grep '<该字样>' lib/client.js` **命中 1 处**，
于是"产物里该字样零命中"这条判据**失效** —— 判据本身被注释破坏了。

**根因**：把"**实现约定**"写进注释时，**注释本身变成了内容的一部分**
（client 产物保留注释 ⇒ 注释会出现在被 grep 的对象里）。
"我声明我不写 X"这句话，**只要同时出现 X 就自相矛盾**。

**正确做法**：让注释**自洽** —— 只写**配置键**（`bus`）来指代，不写它的界面显示名；
并把"为什么不写"讲清（判据是**渲染文本**零命中，注释不是渲染文本，
混在一起就说不清）。**本轮只改注释，渲染逻辑一字未动**（逐字节比对确认）。

**⚠ 判据的"层级"要选对**（同一轮踩到的）：
`grep lib/client.js` 数到的命中**可能是注释**，不等于**渲染结果**。
更硬的判据是**执行层**：把编译后的 `moduleSummary` 抽出来，
**真喂一次含该字段的数据**，看它输出什么（实测输出 `"工具开 · 预设关 · 设置开"`，零该字样）。

**出处**：收尾实测（源码 `grep` 0 命中 + `tsdown` 重建后产物 0 命中 + 执行层验证）。

### E-72 · `lib/` 被 gitignore ⇒ **源码与产物漂移 git 看不见**（本项目已知代价，须显式声明）

**事实**：`.gitignore` 排除 `lib/`（它是 `src/` 的编译产物），
但**插件运行时装的正是 `lib/`**。

**后果**：改了 `src/` 却忘了重新 build ⇒ `git status` **完全看不出来**，
仓库里源码是新的、磁盘上产物是旧的，**运行时用的是旧产物**。
版本保护**不覆盖这条**。

**正确做法**：把这条**写进入库物本身**（本项目落为初始提交的 message 里显式声明
"已知代价"，见 `git log -1`），并固化纪律：
**改完 `src/` 必须 `npm run build`（host）并 `npx tsdown`（client）。**
（旧项目实测踩过，见 E-24 / E-25；本条是"让代价可见"，不是新坑。）

**出处**：收尾实测；`.gitignore` 第 1-9 行（构建产物段）与 README 的对照。



## 6j. 收尾第二轮新增（2026-10-05 · 排除清单补齐 / gitignore 断言脚本）

### 🔴 E-73 · 入库脚本依赖**不入库**文件 ⇒ 新 clone 跑不了自己声明的命令

**现象**：`scripts/check-preset-contracts.mjs`（**已入库**，挂在 `package.json` 的
`npm run check:presets`）**无条件读取** `.hob/drafts/preset-contracts.md` ——
而 `.hob/drafts/` 当时被 `.gitignore` 排除。
⇒ **新 clone 里那条命令直接崩**（实测）：
```
$ git clone . /tmp/x && cd /tmp/x && node scripts/check-preset-contracts.mjs
Error: ENOENT: no such file or directory, open '.../.hob/drafts/preset-contracts.md'
EXIT=1
```

**根因（归类时漏了一个判据）**：判断"某文件该不该进 git"时，
只用了"**是不是可复用的格式契约**"这一个尺子 —— `drafts/preset-contracts.md`
是**本项目专有**的契约正文，按那把尺子自然被判成"运行数据"。
**但漏了第二条尺子：有没有入库物依赖它。**
一个入库脚本要能跑，它的输入就必须也在库里；
"**入库物依赖不入库文件**"本身是自相矛盾的状态。

**正确做法**：
① 归类时必须问两个问题 ——「**它是可复用的格式契约吗**」**以及**
   「**有入库物（脚本/配置/测试）依赖它吗**」；任一为真 ⇒ 进 git。
② 本项目把 `.hob/drafts/` 归**骨架**并加 `!` 放行，同时把「骨架」的判定标准
   从"格式契约"**扩写**为"格式契约 **/** 被机检脚本消费的规范源"，让归类有明文依据。
③ **机检**：`scripts/check-gitignore.mjs` 的 MUST-TRACK 清单里显式包含
   `scripts/check-preset-contracts.mjs` 与它读的 `drafts/preset-contracts.md`
   —— 以后再出现"脚本入库、输入没入库"，断言直接 FAIL。

**⚠ 与 E-70 是同一族**：E-70 是"`!` 例外少列一项 ⇒ 静默不入库"；
本条是"归类尺子少了一把 ⇒ 静默断链"。共同点：**错误都表现为"文件不出现"，没有任何报错。**

**出处**：收尾第二轮实测（`git clone` 后跑命令得 ENOENT exit 1）；
`scripts/check-gitignore.mjs`；`.hob/README.md` §1.2。

### 🔴 E-74 · 用 `git check-ignore` 做断言**必须带 `--no-index`**，否则断言恒真

**现象（我自己的脚本写错了，且写错了还看不出来）**：
`check-gitignore.mjs` 第一版用 `git check-ignore -q <path>` 断言"某文件未被排除"。
自证时**故意删掉 `!.hob/EXPERIENCE.md`**，脚本**仍然 PASS** —— 断言**没有牙**。

**根因**：`git check-ignore` **默认优先信任 index** ——
一个**已被跟踪**的文件**永远不会**被报告为 "ignored"，
**即使 `.gitignore` 里确实有规则排除它**。实测：
```
  git check-ignore -q            .hob/README.md  →  exit 1（"未被排除"）← 漏报
  git check-ignore -q --no-index .hob/README.md  →  exit 0（"被排除"）  ← 抓到
```
⇒ 而本脚本要断言的恰恰是**规则本身**（"清单是否与 README §1 一致"），
不是"index 当前是否看得见它"。**第一批要保护的文件恰恰都已入库** ⇒
用默认行为时，断言对**最需要保护的那批文件**完全失效（恒真）。

**正确做法**：
① 断言"**规则是否排除某路径**"时**一律加 `--no-index`**（纯规则匹配、
   不看 index、也**不要求路径存在**）。
② **判据要三连**，任一条单独用都有假通过：
   · 未被规则排除（`check-ignore --no-index` != 0）
   · 磁盘上存在（`existsSync`）
   · **确实在 index 里**（`git ls-files --error-unmatch`）
   —— 只查前两条会把"文件在、规则也放行，但**从未 `git add`**"判成通过，
   而"文件不在 git 里"正是 E-70 的失效模式。
③ **反向同理**：断言"被排除"时，还要查它**没有**躺在 index 里 ——
   规则对**已跟踪**文件不生效（加了 `.gitignore` git 也不会停止跟踪），
   必须 `git rm --cached`（实测 `git add -f .hob/FACTS.md` 后脚本正确 FAIL 并提示这一点）。

**⚠ 这条的教训最值得记**：**"断言没报错"不等于"断言在起作用"** ——
自证（故意弄坏 ⇒ 必须 FAIL）才是唯一能发现"恒真断言"的手段。
这与 E-67（用默认值测"保留"）同族：**判据必须能区分成功与"恰好看起来像成功"。**

**出处**：收尾第二轮自证实测（4 个 FAIL 场景 + 恢复后 PASS）；
`scripts/check-gitignore.mjs` 的 `ignoreExitCode()` 注释。



### 🔴 E-75 · `grep -A<n> | grep <关键字>` 的**空输出** ≠ 字段不存在（窗口太窄会吞行）

**现象（同一轮内误读两次）**：核对 `--dump-config` 里本插件的 `modules` 段时用
```bash
dsh --profile system --dump-config | grep -A6 "^# == dsh-hob" | grep -E "bus:|settings:"
```
输出**空** ⇒ 我一度以为 `bus` 键不见了（那正是判据 4/判据 2 的核心断言）。
换宽窗口后字段其实**都在**：
```
modules:
  tools: true
  preset: false
  bus: false        ← 一直在
  settings: true
```

**根因**：`grep -A6` 只带出**匹配行之后的 6 行**，而 `bus:` / `settings:` 落在
第 7、8 行 ⇒ **被窗口切掉**。第二段 `grep` 于是在**被截断的子集**里搜，
没找到就**静默输出空**。

**与 E-44 是同一族但不同层**：E-44 是"**退出码指向错误对象**"（管道 `$?`），
本条是"**判据的输入被前一步截断**" —— 都是**判据本身错了**，
且**都表现为"看起来像否定的空结果"**，比结论错更危险。

**正确做法**：
① **不要用固定行数的 `-A<n>` 去截一个结构化段落**。
   取段落用**起止锚点**：`sed -n '/^# == dsh-hob/,/^# == /p'`，
   或 `awk '/^# == dsh-hob/{f=1} f&&/^# == /&&!/dsh-hob/{exit} f'`。
② **空输出必须先自问"是它不在，还是我的窗口把它切了"** ——
   在把"空"当结论前，用**无条件的方式**（全量打一遍）复核一次。
③ 拿不准时**先打印完整目标段**（`grep -A20`／`sed` 区段），确认了再下结论。

**判据设计通则（E-44 / E-67 / E-74 / E-75 四条共享）**：
**"没报错 / 没输出 / 默认值通过"** 都**不等于**"事实成立"。
凡是要断言"存在 / 保留 / 未被排除"，判据必须**能区分**
"确实成立"与"恰好看起来像成立"，并对此**自证一次**。

**出处**：收尾提交轮实测（同一轮内两次误读，均已当场发现并改用宽窗口复核）；
与 E-44（管道退出码）、E-67（用默认值测"保留"）、E-74（断言恒真）同族。



## 6k. UI 优化轮新增（2026-10-05 · 宿主样式复用 / tsdown CSS / npm install 剪枝）

### 🔴 E-76 · 同名"设置"组件有两个，**槽位决定用哪一个**：`SettingsForm` 是 `plugins.item` 的壳，不是 `settings.section` 的

**现象（差点照着错判据做）**：要给「我们自己的设置分区」套上"宿主统一壳"，
很自然会选 primitives 的 `SettingsForm`（它的文档标题就是"One plugin's settings form
as its page on the Plugins page shows it"）。**但宿主自己的实践是否证的**。

**根因（实测，逐包统计 `lib/client.js`）**：

| 宿主包 | `settings.section` | `plugins.item` | 用 `SettingsForm` |
|---|---|---|---|
| ui-settings-subagent | 0 | **1** | **是** |
| ui-settings-web-search | 0 | **1** | **是** |
| ui-settings-agent-loop | 0 | **1** | **是** |
| ui-settings-shell | 0 | **1** | **是** |
| ui-settings-general | **1** | 0 | 否 |
| ui-settings-models | **1** | 0 | 否 |
| ui-settings-account | **1** | 0 | 否 |
| ui-settings-plugins | **1** | 0 | 否 |

⇒ **两个槽位是两套形态**：`plugins.item`（插件管理页的卡片，有 staged 编辑 + Save）
用 `SettingsForm`；`settings.section`（独立设置页）**没有**统一壳，各页自己画布局
（models 用 `.zGbnIq_*`、account 用 `.LcmJYa_*`、plugin-inventory 用 `.qSYn7G_*`）。

**正确做法**：先确定自己在哪个槽位，再看"该槽位的既有页怎么做"。
本项目注册的是 `settings.section`，且面板是**只读摘要** ⇒ 挂 `SettingsForm`
只会凭空多出一个**永远禁用**的 Save（`blocked = !dirty || invalid || saving` 恒真）。
故按 `settings.section` 各页的同一做法自己组织布局，
但**组件与令牌全部复用宿主**（`StateDot` / `Tag` + `--dsw-*` 令牌）。

**⚠ 可迁移的判据**：**"宿主提供了 X"不等于"X 用在我这个场景"** ——
一个组件的**文档标题**可能比它的**实际归属**更显眼。
判据要落在"宿主自己在**同一槽位**里怎么做"，而不是"这个组件看起来最合适"。

**出处**：UI 优化轮实测（逐包 `grep -c 'slots.inject("…")'` 与 `SettingsForm` 命中统计）；
`.hob/UI-REV-REPORT.md` 判据 5。

### 🔴 E-77 · tsdown 0.15 **不能**编译 `.module.css`：吐出独立 CSS 文件 + 空映射，而插件路由**只服务 client.js**

**现象**：client 半边若照常规写 `import css from './X.module.css'`，
**构建成功、零报错**，但样式在页面上**完全没有**。

**根因（复现，两步都有实证）**：
① **tsdown 0.15.12 的实测输出**（`/tmp/cssprobe`，最小复现）：
   ```
   ℹ lib/client.js   0.15 kB
   ℹ lib/client.css  0.05 kB      ← CSS 被拆成**独立文件**
   ```
   且模块里拿到的默认导出是 **`{}`**（class 名映射全丢）：
   ```js
   var x_module_default = {};        // ← 不是 { a: 'x_a1b2c' }
   ```
② **插件路由不服务它**：DSH 的 `/plugins` 路由只认
   `<id>/client.js` 与 `client.<name>.js` 分片
   （`dsh-client-modules/lib/index.js:169` 的
   `CLIENT_CHUNK = /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/`）
   ⇒ `lib/client.css` **根本送不到浏览器**（实测产物目录里它确实生成了，但无人请求）。

**正确做法**：采用宿主自己产物的**同一形态** —— CSS 作为**字符串**打进 JS、
运行时建 `<style>` 注入。宿主 `dsh-client-ui-theme` 的 `base.css`、
`ui-settings-general` / `ui-settings-models` / `@linxin666/dsh-remote-web-ui`
的产物都是 `const css = "…"` + 运行时 append。

**两条注入约定（不遵守会静默出问题）**：
· `style.dataset.plugin = <包名>` —— `client-modules` 的 `removeOwnedStyles(id)`
  按它清理（`lib/client.js:194-196`）；不标 ⇒ 热重载后新旧样式**叠加**成孤儿标签。
· `style.dataset.pluginCss = <唯一 id>` —— 幂等键，`querySelector` 命中即跳过。

**⚠ 附带发现（同类）**：`--dump-config` 通过 ≠ 运行时可 import。
`ConfigField` 在 primitives 的 `lib/types/ConfigField.d.ts` 里**有**，
但**既不在**运行时 seed 导出表、**也不在** `lib/index.js` 里
（实测：seed 顶层导出 **281** 项，`ConfigField` 不在其中）
⇒ 只照 `.d.ts` 写会构建通过、运行时 `undefined`。

⚠ **数这个导出表时别用"按逗号 split"**：导出值里有带逗号的表达式
（函数调用、对象字面量），朴素 split 会把 **281** 数成 **2167**。
必须按**括号深度**切分顶层条目（本轮的首次统计就是这么错的，当场复核纠正）。

**出处**：UI 优化轮实测（tsdown 最小复现 + 前端产物 seed 导出表解析 + 路由正则原文）；
`.hob/UI-REV-REPORT.md` 判据 4/5。

### 🔴 E-78 · `npm install <新依赖>` 会**剪掉** lockfile 里没有、但磁盘上存在的包（本项目 typecheck 直接崩）

**现象**：为拿 types 跑了一次
`npm install --save-dev @deepseek-ai/dsh-client-ui-primitives@0.2.0-rc.2`，
npm 输出 `added 1 package, removed 5 packages`。随后
**`npm run typecheck` 从 exit 0 变成 exit 2**：
```
src/modules/tools.ts(49,28): error TS2307: Cannot find module '@deepseek-ai/dsh-tools'
src/modules/tools.ts(50,37): error TS2307: Cannot find module '@deepseek-ai/dsh-tools'
```

**根因**：本项目的 `package.json` **没有声明** `@deepseek-ai/dsh-tools` 等
（它们靠 DSH 运行时提供），但**磁盘 `node_modules/@deepseek-ai/` 下确实装着**
`dsh-tools / dsh-agent / dsh-llm / dsh-scope / dsh-session` 五个包
（是宿主同版本的传递/既往安装残留，**不在 lockfile 里**）。
`npm install` 会按 lockfile **对齐**依赖树 ⇒ 把这五个"孤儿"当冗余**剪掉**。

⇒ 于是"装一个 devDependency"这一个动作，**顺带把 typecheck 的隐式依赖拆了**。
危险性在于：**npm 报的是 added/removed 计数，不会告诉你哪个源文件会因此编不过**。

**正确做法**：
① 加依赖前**先备份 `package-lock.json`**，装完**逐包 diff** 确认"只多了预期的那一个"
   （本项目实测：REMOVED 为空、ADDED 只有一个 ⇒ 说明这五个包本来就不在库里，
   不是本次删的，而是"从未被声明"）。
② 被剪掉的用 `--no-save` 装回来（**不动 `package.json`**，避免把运行时依赖
   固化成开发依赖）：
   `npm install --no-save @deepseek-ai/dsh-tools@… @deepseek-ai/dsh-agent@… …`
③ 装完**必须重跑 `npm run typecheck`** —— 这是唯一能发现"被剪"的判据。

**⚠ 可迁移的判据**：**"磁盘上有" ≠ "依赖树里有"**。
本项目真正的依赖清单是**三处**的并集：`package.json` + lockfile + 磁盘残留，
而 `npm install` 只尊重前两者 ⇒ 任何一次 install 都可能动到第三类的包。
**检查脚本（typecheck）是这件事唯一的报警器**，所以它必须每轮都跑。

**出处**：UI 优化轮实测（`npm install` 后 typecheck exit 2；
`--no-save` 装回后 exit 0；lockfile 逐包 diff 复核）。



## 6l. 配置面清理轮新增（2026-10-06 · 空旋钮 / 可见性依赖 / 残留声明）

### 🔴 E-79 · 删掉"最后一个顶层 volatile"**不会**让分区消失 —— 可见性可以由**嵌套的** volatile 子字段单独支撑

**背景（本轮要判的风险）**：按 UD-43 删掉三个"空旋钮"字段
（`persona` / `showEntry` / `delivery`）后，schema 里**再没有任何顶层 volatile**，
只剩 `modules.tools` / `modules.preset` / `modules.settings` 三个**嵌套**的 volatile 子字段。
宿主的规则是「一个 live 字段都没有 ⇒ `volatileForm` 返回 undefined ⇒
`describe()` 对该 entry `return []` ⇒ **分区静默消失**」——
那么"**父不标 + 子各标**"这个形状**单独**够不够？

**结论：够。分区仍可见。**

**证据（不靠推断，跑宿主自己的实现）**：
判据脚本从 `dsh-settings/lib/index.js` **抽出 `volatileForm`/`plainSchema` 原文**
（不自己按文档重写 —— 重写只能证明"我的理解"，不能证明"宿主的实现"），
再喂**我们真产物** `lib/config.js` 的 `Config`：
```
volatileForm(schema) → 非 undefined
form 顶层键 = ["modules"]；其子字段 = ["tools","preset","settings"]
```
（脚本：`.hob/archive/2026-10-06-config-cleanup-evidence/分区可见性验证.mjs`）

**⚠ 判据必须自己带"牙"** —— 同脚本里有两条对照，缺了它们这条 PASS 没有意义：
· **阴性对照**：全无 volatile 的 schema ⇒ `volatileForm` **返回 undefined**
  （证明这条判据**能**判出"不可见"，不是恒真）；
· **形状对照**：只写 `z.object({modules: z.object({tools: z.boolean().volatile()})})`
  （即"父不标+子各标"的最小形状）⇒ 同样生成 form。

**可迁移结论**：**volatile 的可见性由"路径上最近的 volatile 祖先"决定，与它是不是顶层无关。**
⇒ 清理顶层字段时，**不必**为了"保住可见性"而保留一个空字段；
但要**逐个确认**剩下的 volatile 子字段还在 —— 三个全摘才会真的消失（且**不报错**）。

**余量实测（阈值）**：同一脚本另跑了"剩几个 volatile 才消失"：

| volatile 子字段剩 | 结果 |
|---|---|
| 3 个 | 可见 |
| 2 个 | 可见 |
| **1 个** | **仍可见** |
| **0 个** | **`undefined` ⇒ 分区消失** |

⇒ 精确规则：**只要 ≥1 个 volatile 叶子（哪怕嵌套在非 volatile 父里）分区就可见；
全摘才消失**。⚠ 但**别依赖"还剩一个"** —— 那等于**没有余量**，
下一个删除动作就会让整个分区静默消失。

这条已写进 `src/config.ts:71-83` 的 `modules` 注释（防后人误删那三个 `.volatile()`）。

**出处**：配置面清理轮实测（抽宿主原文执行 + 三条对照 + 阈值四档）；
`src/config.ts:71-83`（可见性依赖唯一支撑 + "不许摘 volatile"的告警）；本报告判据 2。

### 🔴 E-80 · 删了 schema 字段，**配置里那份值还在** —— 它不会报错，但会"看起来还生效"

**现象**：删掉 `persona` 后跑 `--dump-config`，`dsh-hob` 段里**仍然**有：
```yaml
    modules: { tools: true, preset: false, bus: false, settings: true }
    persona: mentor          # ← schema 里已经没这个字段了
```
一眼看过去像是"没删干净"。**实测它无害，但成因值得记**。

**根因（两件事叠加）**：
① **schema 不校验未知键**：schemastery 对未声明的键**原样保留**（本项目
   `config.ts` 早就写明这条，是有意的兼容性）；
② **声明来自插件包的 `cordis.patch.yml`**（仓库根，`dsh.bundle.patch` 指向它），
   那里手写了 `persona: mentor`。**删 schema 不会去改 patch 文件**。

**于是产生一个"假象"**：`describe()` 的投影是**按 schema 走**的
（`projectForm(form, …)` 只取 form 里声明的字段）⇒ 残留键
**既不出现在设置页、也不影响读取**，但它在 `--dump-config` 里**肉眼可见**。

**正确做法**：
① 判"字段是否真删掉"要用 **schema / 渲染产物**做判据，
   **不要**用 `--dump-config` 里"这个键还在不在" —— 那是 **composition 层的原始值**，
   不是"设置页会呈现什么"（与 PROJECT.md §5.3.2b 同一条纪律：
   `describe().value` 是投影视图，不是原始 config）。
② 顺手把 `cordis.patch.yml` 里的残留声明**清掉**（本轮**未做**：它不在任务书
   允许改动的文件清单里 —— 见本报告 §未验证/待确认第 1 条，
   已作为 `[建议决策]` 上报，不擅自扩大改动面）。

**⚠ 一个必须同时说清的边界**：残留键本身**不会**被"写入"路径清掉或放大 ——
宿主 `write()` 里 `strip()` 只处理 **form 声明过的**路径
（`dsh-settings/lib/index.js:524-533`），未声明的键在 `strip` 循环里**根本走不到**，
故它既不会被自动删除、也不会造成冲突。**但它会一直留在 profile 的落盘配置里**，
直到有人手工清 —— 属于"技术债可见但不致命"。

**出处**：配置面清理轮实测（`--dump-config` 残留 + `projectForm` 投影复核 +
`Config({persona:'mentor'})` 构造不抛错）；
`cordis.patch.yml` 末段。

### 🔴 E-81 · 删 schema 字段后，**声明该字段的 bundle patch 不会跟着变** —— 它是第二处真相源

**现象（E-80 的收尾动作暴露的）**：清了 `cordis.patch.yml` 里的
`persona: mentor` 之后，**`--dump-config` 的输出真的变了**
（`dsh-hob` entry 块从 6 行变 5 行）。
⇒ 这说明：**`src/config.ts` 的 schema 与 `cordis.patch.yml` 是两个都要改的地方**，
只改 schema 会留下"声明了但 schema 不认"的键。

**根因**：本插件的配置有**两处真相源**，职责不同：
| 位置 | 作用 | 改了谁生效 |
|---|---|---|
| `src/config.ts` 的 `Config` | **schema**（类型/默认值/volatile/设置页呈现） | 决定"哪些字段存在、谁能编辑" |
| `cordis.patch.yml` 的 `config:` | **打包时随插件分发的初始值** | 决定"这个 profile 初始拿到什么值" |

宿主加载时按 `join(packageDir, file)` 读 patch（见该文件头部注释），
**它随包分发到每一个装了本插件的 profile** ⇒ 残留键的**影响面是"所有实例"**，
不是"本机这一次"。

**为什么这次没在上一轮被发现**：上一轮的判据是
「schema 里零命中 + 设置页零命中 + 渲染零命中」，三条**都不经过 patch 文件**
⇒ 判据全过，脏声明却留着。
（上一轮报告里把它记为"发现 1/未验证"，本轮才修 —— **这是判据覆盖面不足，不是执行失误**。）

**正确做法（可迁移）**：
① **删 schema 字段时，必须同时 grep 声明面**：`grep -rn "<字段名>" cordis.patch.yml
   package.json preset/` —— **凡是能声明 config 的地方都要查**，
   而不只是查 `src/`。
② **判据要覆盖"配置的实际来源"**，不能只查"代码 + 界面"。
   最直接的一条：**清完之后跑一次 `--dump-config`，看输出真的变了** ——
   输出没变就说明你改的文件不是被加载的那一份（本轮正是这样确认 patch 确实生效的）。
③ **别把"随包分发的声明文件"当注释无关**：它比注释危险，
   注释不生效，**它会生效**。

**⚠ 顺带一条（判据自伤的写法，与 E-71 同族）**：
本轮给 patch 加解释注释时，差点把被删的三个键名**写进注释** ——
那样 `grep -n "persona" cordis.patch.yml`（任务书判据 1 明写"应 0 命中"）
就会被**我自己的注释**打中，判据再次被自伤。
⇒ 修法是：**说明写在别处（EXPERIENCE/报告），文件里只写通用纪律、不点名**。
"判据要求某文件对某字符串零命中"时，**该文件自己的注释也要受这条约束**。

**出处**：提交轮实测（`grep -n persona cordis.patch.yml` → EXIT=1 零命中；
`--dump-config` 前后 dsh-hob entry 块对比；YAML 解析复核 + stderr 归一化对照）；
`cordis.patch.yml:17-41`。



## 7. 待核实（**不要当成已知**）

以下条目在旧项目里**从未被验证**，带到新项目时**必须重新验证**，不许当既有结论引用：

| # | 未验证项 | 出处 |
|---|---|---|
| U-1 | `edit` 工具在 UNC 上是否同样触发 `link()`（决定能否用它改跨 OS 文件） | `F-O1` |
| U-2 | `fs.watch` 在 UNC/9p 上的**丢事件率**；轮询兜底的**延迟未量化** | `F-R72`；`batch3-report.md:446` |
| U-3 | 从 **Orb 界面**新建会话时，预设**会不会自动生效** | `F-Z9`（用户明确选择接受此风险，未做 spike） |
| U-4 | Windows → WSL 反向的 UNC 原子写、大文件/高并发场景 | `F-R70` 的"未测反向" |
| U-5 | 某端若**收不到任何投递**，它永远学不到工作区根 ⇒ 此时 `workspaceRoot` 才需显式配 | `F-Z11` |
| U-6 | `hob-translate` 预设的完整工具面**未做全量 dump**（判据只是"模型实际调了哪些"） | `F-Z9` / `batch8-report.md` 风险节 |

---

## 8. 可搬资产清单（**本轮只登记，不搬**）

> 用户明确要求：本轮只做"归档 + 新骨架占位"，**不写业务代码**。
> 以下是**供后续批次决策**的资产登记，全部在归档目录里可查。

| 资产 | 归档位置 | 价值 |
|---|---|---|
| **工具模块**：读文档（清单阈值 + 单文件字节上限 + 目录排除） | `archive/src/tools/read-contracts.ts` + `archive/src/server/doc-read.ts` + `doc-index.ts` | 守卫/截断已实测，含阴性对照 |
| **工具模块**：写账本（守卫 / 备份 / 缩水守卫 / 原子写 / 幂等跳过） | `archive/src/server/hob-write.ts` + `archive/src/tools/write-hob.ts` | 39 项模块断言 + 8 项宿主内验收全过 |
| **路由模式**：`ctx.inject(['webServer'])` 反应式注册 + `ctx.effect` 释放 | `archive/src/index.ts` | 含 E-01 的对照实验证据 |
| **预设声明结构**：`persona(complete:true)` + 单行工具模块 | `archive/preset/hob-translate/cordis.patch.yml` | 权限收敛的实际载体 |
| **设置面板**：`volatile` schema + `configForms` 读写 | `archive/src/config.ts` + `archive/src/client/settings.ts` | 含 E-08 的完整踩坑记录 |
| **槽位探针**：用真产物验证 client 半边实际注册了哪些槽位 | `archive/scripts/role-gate-probe.mjs` | 解决 E-26"只验一个半边" |
| **装配探针**：`--dump-config` 断言脚本 | `archive/scripts/build-sync.sh` / `verify.sh` | 可复制成新项目的验收脚本 |
| **收敛检查**：预设工具面的静态回归 + 负向对拍 | `archive/preset/hob-translate/check-convergence.mjs` | E-27 的示范实现 |

**归档目录**：`/home/lk/FF/dsh-hob-archive-20261005/`（`mv` 原地改名，`.git` 与 37 项未提交改动完整保留）。

---

## 维护规则

1. **新坑进本册，编号续编不重排**；出处写清（能复核）。
2. **每条必须有「根因」**——只写现象等于没写。
3. **未验证的进 §7**，不许混进正文当已知。
4. **本文是经验，不是规格**；新项目要做什么看新项目自己的账本。

### 🔴 E-82 · 判断"要不要重启"时，**按半边分类**：client 半边有 hmr、**host 半边没有**，bundle patch 两者都不算

**现象（本轮差点又报错答案）**：提交轮里我用 `client-hmr` 的证据（SSE 图 rev
跟着产物变）得出"**不需要重启**" —— 这对 **client 半边**成立，
但本轮同时还改了 **host 半边**（`config.ts` / `index.ts` / `modules/settings.ts`）
与 **bundle patch**（`cordis.patch.yml`），**这两类都不受 client-hmr 影响**。

**三类的生效机制完全不同（本轮逐一查证）**：

| 改的是哪类 | 谁负责热更新 | 生效条件 |
|---|---|---|
| **client 半边**（`src/client/**` → `lib/client.js`） | `dsh-client-hmr`（500ms 轮询 mtime/ctime/size，经 `/plugins/events` 推 `rebuilt`） | **免重启**（刷新页面即可） |
| **host 半边**（`src/*.ts` `src/modules/**` → `lib/*.js`） | **无** —— `hmr` 插件虽在装配树里，但其 `config.root: []`（实测 dump 原文）⇒ **不监视任何模块根** | **需重启** |
| **bundle patch**（`cordis.patch.yml`） | **无** —— `dsh-hmr` 只 `watchConfig` 两个文件：`profile.patchPath`（`$DSH_HOME/profiles/<name>/cordis.patch.yml`）与 `$DSH_HOME/cordis.patch.yml`（`dsh-hmr/lib/index.js:354`） | **需重启** |

⚠ **本项目早已记过这条**（**E-51** 的"根因"段，第 3 步实测）：
"host 半边没有 hmr（UD-05）；`--dump-config` 是**离线**组合，读磁盘，
**与运行中进程的内存组合无关**"。
⇒ 本轮的错误正是"**把 client 半边的结论套到了 host 半边**"。

**正确做法（可迁移判据）**：
① 报"是否需要重启"**前**，先把改动**按半边归类**（client / host / patch / 其它），
   逐类给出它的热更新机制与证据 —— **不要用一个半边的证据回答整批改动**。
② **别用 `--dump-config` 证明"运行中已生效"**：它是**离线**读盘，
   磁盘改了它就变，**与进程内存无关**（本轮实测：改 patch 后 dump 立刻变，
   但进程仍是 10-05 19:06 启动的旧内存）。
③ 判"运行中到底有没有"只能靠**运行时观测**（日志 / 接口 / 界面）；
   观测不到就如实写"**未验证**"，别拿离线证据顶着。

**出处**：提交轮实测（`dsh-hmr/lib/index.js:354` 的 `patchFiles`；
dump 里 `hmr` 的 `config.root: []`；
**E-51** 的同一结论）。

---

### 🔴 E-83 · 机检脚本的断言"只覆盖尾部"时，对**未覆盖的那部分**是「**缺席的 PASS**」—— 改了也不 FAIL

**现象（本轮实测）**：助手契约的 A 段（`## Two output shapes` / `### INSTRUCTION shape` / `## Rules`）
在**人读版里根本没有载体** —— `.hob/drafts/preset-contracts.md` 只贴了 B+C 段。
而 `check-preset-contracts.mjs` 的第 ⑤ 条断言当时写的是
"**人读版引文块 == 预设正文的尾部**"（`hoBody.endsWith(d0)`）。

⇒ 对照实验（本轮真跑）：**只改机器读版 A 段的一句话、人读版一动不动**
⇒ `npm run check:presets` **仍然 PASS**（exit 0）。
即：**A 段的任何改动都没有机检覆盖**，而这个项目的两条硬约束之一正是
"两份载体必须同步，check:presets 是它的机检证据"。
用户实测反馈的那个缺陷（"给开发的指令没有完全在代码块内"）恰好就在 A 段。

**根因**：把"人读版是正文的**子串/尾部**"当成了"两份一致"。
**子串相等比整体相等弱** —— 未纳入比对的那部分，改与不改读数完全一样。
这与 §5.3.4「用默认值测"键是否还在"」是**同一类错误**：判据的**分辨力**没覆盖被测对象。

**正确做法（可迁移判据）**：
① 写"两份载体一致"的断言时，**比整体、不比子串**；
   若某段暂不纳入比对，**要在脚本里写明"这段没有机检覆盖"**，别让它看起来=已覆盖。
② **每个新写的断言必须配一次负向对照**：故意破坏被测对象，确认它**真的会 FAIL**。
   本轮就是这么发现旧断言漏掉 A 段的（改一句 → 期望 FAIL → 实测 PASS）。
③ 区分两类断言：**"一致性"断言**证明不了"规则本身还在"（两份一起改回裸分隔符照样 PASS）；
   要害规则要另加**语义断言**（本轮新增 ⑤b：`<<<CMD>>>` 前必须有围栏 +
   `## Rules` 必含三条条文 + `<<<NOTE>>>` 不得被围栏包住）。
④ ⚠ **Markdown 围栏可以嵌套**：人读版引文块里出现了 ``` 示例围栏 ⇒
   外层必须用 **4 个反引号**，解析要**按"同长度围栏闭合"**（CommonMark 规则），
   不能用 `/?```text...```/` 那种"任意 3 个反引号即闭合"的懒惰正则。

**出处**：本轮实测（负向对照 3 次：A 段改一句 → PASS 暴露漏检；
去掉示例围栏 → ⑤ PASS 而 ⑤b FAIL；两份一起改 → ⑤ 无法发现规则消失）。
`scripts/check-preset-contracts.mjs` 的 ⑤ / ⑤b。

---

## 6m. 批 7 新增（2026-10-07 · 复核方法学两条：会话日志多帧 zstd / 隔离 profile 的 node_modules）

### 🔴 E-84 · 会话日志 `session.v4.jsonl.zstd` 是**多帧 zstd**：用 `zstdDecompressSync()` **只解首帧** ⇒ **静默取到空**，并据此误判"契约未生效"

**现象（本轮实测）**：合并复核对要取 `request/header.tools` 与 `system/message`。
用 Node 内置的 `zlib.zstdDecompressSync()` 解 `~/.dsh/sessions/<cwd>/<session>/session.v4.jsonl.zstd`：

```
文件字节            = 2142533   （2.14 MB）
首帧解压字符数      = 194        ← 只有 194 个字符！
zstd 帧数(魔数计数) = 839        ← 同一文件里实际有 839 个 zstd 帧
zstdcat -q <file> | wc -l = 1450  ← 正确路径取到 1450 行
```

⇒ 那 194 字符里**没有任何** `request/header` 事件；照它取读数会得到 **0 条**，
而 `0 条` 最容易被解释成「**契约没有生效**」——
即**一个纯粹的读法错误，被读成了被测对象的问题**。

**根因**：`session.v4.jsonl.zstd` 不是"一个 zstd 流"，而是**逐事件追加、多帧拼接**的容器
（每写一批就追加一个新帧）。`zstdDecompressSync()` 的语义是**解一个帧**，
它**不报错、不警告**，只把首帧解出来就返回 ⇒ 失败方向是**静默截断**。
（对比：`gzip`/`zlib` 的同类 API 也是单流语义；但 `.gz` 里通常只有一个流，
所以同样的写法在别处"碰巧能用"，迁移到这个文件上就变成陷阱。）

**正确做法**：取会话日志**一律走逐帧路径**——
```bash
zstdcat -q <file>            # 多帧自动串接；推荐
```
或 Node 流式：`zlib.createZstdDecompress()` 接 `fs.createReadStream()` 收集全部输出。
本轮的三个读数（文件字节 / 首帧字符数 / 帧数）与 1450 行就是这条路径产出的。

**可迁移判据（本条最值钱的部分）**：
① **"取到 0 条"和"确实没有"必须分开证明** —— 报 0 之前，先证明**探针真的读通了**：
   拿一个**必然存在**的事件（如 `session` 首事件、或已知条数）当对照；读不到它，就是读法坏了。
② 解压/解析类调用**一律检查"读了多少"**：本文件"2.14 MB ⇒ 194 字符"这种**量级不符**，
   本身就是判据失效的信号（不是数据的信号）。
③ 与 **E-29「零日志不是证据」**、**E-44「管道吞退出码」** **同族**：
   三条都是「**判据本身失效，却给出一个看起来正常的结论**」——
   · E-29：**没有日志** ⇒ 误以为"什么都没发生"（其实是日志没开）；
   · E-44：`cmd | grep | head` 的 `$?` 是**管道最后一个命令**的退出码 ⇒ 误以为命令失败；
   · **E-84（本条）**：单帧解压**静默截断** ⇒ 误以为数据里"没有那个事件"。
   ⇒ 三者的共同修法是同一条：**先证明观测器活着，再读观测值**（本条即"帧数与行数"）。

**出处**：批 7 实测（合并复核取 `request/header` / `system/message` 时踩到）：
`stat -c %s` = 2142533；`zstdDecompressSync` 首帧 = 194 字符；
魔数计数帧数 = 839；`zstdcat -q | wc -l` = 1450。
与 E-29 / E-44 同族，三条**互相指认**。

### 🔴 E-85 · 构造隔离 profile 时**不可软链整个 `node_modules`**：写入会**穿透到真机 profile**，且 `git status` **完全看不见**

**现象（本轮实测）**：为做逐预设工具面对照，我在 `/tmp` 下建隔离 profile，
把它的 `node_modules` **整个目录**软链到真机 profile 的 `node_modules`：

```bash
ln -s /home/lk/.dsh/profiles/system/node_modules /tmp/<iso>/profiles/<p>/node_modules   # ← 错
mkdir -p /tmp/<iso>/profiles/<p>/node_modules/hob-probe   # ← 以为建在"隔离"里
```

结果探针包 `hob-probe` 的 `index.js` / `package.json` / `cordis.patch.yml`
**真真切切落在了真机 profile 里**：`/home/lk/.dsh/profiles/system/node_modules/hob-probe/`。
而 `git status` **一行都不显示** —— 真机 profile 在 `<DSH_HOME>` 下，**不在本仓**。

**根因**：整目录软链把该路径上的**一切写入重定向到链接目标**。
隔离 profile 隔离的只是 **`DSH_HOME`**（配置 / 会话存储），**没有隔离这份目录**——
`node_modules` 是**共享的真实存储**，隔离实例与真机共用同一份。
（⇒ 与 **E-36「隔离实例隔离不了工作区」** 是**同一条边界的两面**：
E-36 说的是**工作区**共享，本条说的是 **`<DSH_HOME>/profiles/<name>/node_modules`** 共享。
再往前一步，也与 **E-52** 相关但**方向相反**：E-52 说"复制整包做对照时软链 `node_modules` 省事"——
那条**成立的前提是**：只在**副本目录内**读写，**绝不往软链路径里创建新条目**。
本条就是**违反了这个前提**的实测后果，故两条须**并读**。）

**正确做法**：隔离 profile 的 `node_modules` **必须是真实目录 + 逐项软链**：
```bash
mkdir -p "$ISO/profiles/$P/node_modules"                      # 真实目录
for e in "$REAL/node_modules"/*; do
  ln -s "$e" "$ISO/profiles/$P/node_modules/$(basename "$e")"  # 逐项链接
done
```
⇒ 这样"新建条目"落在**真实目录**里（隔离），只有"读既有依赖"才穿到真机 —— 边界正确。
**判据**：`test -L "$ISO/profiles/$P/node_modules"` 必须为**假**（是真实目录，不是软链）。

**发现方式（值得记：为什么没有酿成错误结论）**：
那一次探针读数**与其它各次明显不一致**（`Hob` = **6**、`Hob-Execute` = **75**、`minimal` = **51**，
而各次一致读数是 **11 / 103 / 79**）⇒ 我**没有把这次异常读数当结论**，
而是回头追"为什么这次不一样"，才追到目录穿透。
⇒ **可迁移判据**：同一被测对象多次测量**读数显著不一致**时，
**先怀疑测量装置，再怀疑被测对象**（与 E-29 / E-44 / E-84 同族：**先证明观测器活着**）。
⚠ 反面：如果那次异常读数恰好"看起来合理"，就会被当成结论收下 —— 所以**重复测量 + 一致性检查**
本身就是判据的一部分。

**复原与核验（写入穿透后必须做）**：
`rm -rf` 那个误落的目录（**删除前核对绝对路径**）；
随后三项核验 —— `ls <真机 profile>/node_modules | grep -icE '<探针名>'` = **0**、
`bundles` 数组**不含**探针（`false`）、原有软链（`dsh-hob -> <repo>`）**完好未重建**（mtime 未变）。
另需判"对运行中实例有无影响"：该实例**启动早于**这次写入，且 profile `bundles` **从未包含**探针
⇒ 探针**没有**进入运行中实例的装配树（同 **E-82** 口径：装配读的是**启动时**的组合）。

**出处**：批 6 实测（`.hob/archive/2026-10-07-orchestration/REPORT.md` 第 4 段（七），
该轮如实记了失误与复原；F-J91）。与 **E-36** 同一条边界、与 **E-52** 并读。

---

## 6n. 批 9 新增（2026-10-07 · 能力落点与白名单粒度：Hob 能力扩展 S1+S2+S3）

### 🔴 E-86 · **能力落点 = 声明面 与 白名单 的「与门」** —— 只换基座不增能力、只扩白名单得 `unknown tool`，**两件一起才可达**

**现象（四格活体对照坐实，不是推理）**：同一个隔离实例、同一个探针、同一份 bundle 构成，
只变「声明面（该预设作用域里挂了哪些插件行）」与「白名单（`MODEL_TOOL_ALLOWLIST`）」两个变量：

| 格 | 声明面 | 白名单 | 模型面 | 执行面 `web_fetch` |
|---|---|---|---|---|
| A | 极简（无 `tool-web`） | 11（不含 `web_fetch`） | **11** | 拒：`"web_fetch" is not available in this session`（**拦截**） |
| B | **加 `tool-web`** | 11（不含） | **11** | 拒：同上（**拦截**） |
| C | 极简 | **12（+`web_fetch`）** | **11** | 拒：`unknown tool "web_fetch"`（**作用域内根本没有**） |
| D | **加 `tool-web`** | **12（+`web_fetch`）** | **12** | **成功**：`Fetched https://example.com/ (HTTP 200)` |

- **A→B（只改声明面）**：模型面 11 → 11，执行面**仍拒** ⇒ **声明面单独不增能力**。
- **A→C（只改白名单）**：模型面 11 → 11，错误文本从"拦截"变成"作用域内没有" ⇒ 白名单放行了名字，**工具不在作用域里，仍不可得**。
- **C→D（两件一起）**：模型面 11 → **12**，执行面**成功** ⇒ **这才是充分条件**。

**根因（两层机制各管一半，谁也不管另一半）**：
- **白名单**挂在 `src/preset/tools.ts` 的装配期过滤（`spCtx.on('system-prompt/assemble')`，
  判据 `all.filter((t) => allow.has(t?.name) …)`）**与**执行前拦截（`gateCtx.on('tools/pre-execute')`，
  返回 `{kind:'deny'}`）—— 它**只决定"这一项发不发给模型 / 放不放行"**，
  **完全不参与"工具在不在作用域里"**；
- **声明面**决定该预设作用域里注册了什么（宿主的 `view(scope)` 只收 `chainLayers(scope)` + `global`），
  **完全不参与"发不发给模型"**。
⇒ 两者是**与门**，不是"两层保险"。**报"只差白名单"或"只差基座"都是错的**。

**两种错误的可观测形态（判据工具，值得背下来）**：
| 错误文本 | 含义 |
|---|---|
| `"X" is not available in this session; …` | 工具**在**作用域里，被白名单/拦截拒 ⇒ **缺白名单放行** |
| `unknown tool "X"` | 该预设**根本没声明**它 ⇒ **缺声明面增行** |

**正确做法**：
① 判"某项能力能不能拿到"时，**必须分两处查**，并**分别给出读数** ——
   查白名单常量的名字集合，**且**查声明面里有没有提供该工具的那一行；
② 实施时**成对落**：改声明面（指名增行）与改白名单**必须同一批**，
   否则落在两种"看起来做了一半"的状态里（一个能力一个都没多，或报 `unknown tool`）；
③ ⚠ **"该工具的宿主包已装"≠"该预设作用域里有它"** —— 本机装了不等于挂上了，
   `dsh-tool-web` 装着、极简基座下 Hob 依然没有 `web_fetch`（格 C 就是这一形态）；
④ 回归判据只能取**同一构成下的前后集合差**，不是绝对数（本机 bundle 构成会漂移）。

**出处**：批 8 只读审查实测（`.hob/archive/2026-10-07-hob-standard-review/evidence/07-2x2对照.md`，
原始日志 `03`/`04`/`13`），批 9 实施批据此落地（S1 零声明增量 + S2/S3 指名增行，
机检 `scripts/check-preset-contracts.mjs` 的 **⑤f** 组把两处一起钉住）。
与 **E-83「缺席的 PASS」**同族：**断言只覆盖一层时，另一层的改动不可见** ——
⑤/⑤b/⑤c/⑤d/⑤e 全都只管契约正文，**白名单里删掉 9 个名字照样 PASS**，
故批 9 必须新增 ⑤f。

### 🔴 E-87 · **白名单的粒度 = 工具名** —— 它**不能**用来闸"写到哪个路径 / 写什么类型"

**现象**：一个自然的需求形态是「让 Hob 能写**非代码**文件，但不能改代码」
（例如"帮我记一条待办到 `NOTES.md`"）。直觉做法是"把写工具加进白名单，
再用白名单限制它只能写某些文件"——**做不到**。

**根因（读实现可判，一行判据）**：
- 装配期过滤的判定体是 `all.filter((t) => allow.has(t?.name) || t?.name === RESERVED_TRANSPORT_TOOL)`
  （`src/preset/tools.ts:331`）；执行前拦截同理只取 `exec?.name`（`:379`）。
  ⚠ 行号是**批 9 提交 `45e2c12` 时**的实测值；该文件后续再改会移位，
  复核时按**函数名**定位（`filterModelToolList` / `enforceToolAllowlist`），别只信数字。
  ⇒ **两处判的都只是 `name`**，**没有任何一处看得到参数**（路径、文件类型、内容）。
- 更要紧的是**工具粒度本身就不够**：`@deepseek-ai/dsh-tool-fs` 在**一个 `apply` 里注册四个工具**
  （`read` / `read_image` / `write` / `edit`），其 `Config` **只有读数参数**
  （`readLimit` / `readMaxLineLength` / `readMaxBytes` / `readStreamMinSize`），
  **没有任何"只给读"的开关** ⇒ 「要 `read` 就得连 `write`/`edit` 一起进注册面」。
  真正管"写到哪"的是**另一个平面**：`dsh-fs-sandbox` 按**每次调用的 sandbox mode** 判定
  （`read-only` 拒全部写；`workspace-write` 限到工作区 + temp；`danger-full-access` 不限），
  而 mode 来自 **profile 的 `permission` 预设**，**不是**预设行、**不是**白名单。

**正确做法**：
① 想把 Hob 限成"只写非代码 / 只写某个目录"，**必须另造守卫**（在 `tools/pre-execute`
   里读 `exec.arguments` 自行判定），**不能指望白名单**；
② 决策时按**工具名集合**取舍，并**接受它的粗粒度**：批 9 的选择就是
   「宁可暂时不给 `write`/`edit`，也不用白名单假装限住了路径」——
   给了 `write` 就等于给了"改任意路径（含代码）"；
③ 若确实要"只读地拿 `read`"，可行形态只有"接受 `write`/`edit` 落到**注册面**，
   靠白名单 + 执行前拦截挡住"（批 9 的 S3 就是这个形态），并**如实标注残余风险**：
   拦截器 **fail-open**（E-86 同族注释：`enforceToolAllowlist` 的 catch 一律 `next()`）
   ⇒ **它自身失效时 `write`/`edit` 会重新可达** —— 那是**收敛措施，不是安全边界**；
④ 与 **E-86** 并读：E-86 说"能力要看两层"，本条说"**其中一层（白名单）的粒度比你想的粗**"。

**出处**：批 8 只读审查的机制判断（`.hob/archive/2026-10-07-hob-standard-review/REPORT.md`
§4（四）与 §3.4 的形态④，当时标 `[推断]`）；批 9 实施批**读实现坐实**（上述 file:line 与
`dsh-tool-fs/lib/types/index.d.ts` 的 `Config` 定义 + `dsh-fs-sandbox/lib/index.js:155-164`
的 mode 判定），并据此定下 S3 的取捨（报告第 3 段附 `write`/`edit` 被拒的**原始报错文本**）。

> ⚠ **互指（批 10 纯追加）**：本条目正文里那句"行号是该批提交时的实测值…复核时按函数名定位"
> 是**本条自身的缓解注**；把这件事**写成通用纪律**的是 **E-91**（「行号是引用的对象」），
> 两条**并读**。本条原有内容一字未改。

---

## 6o. 批 10 新增（2026-10-07 · 复核方法学四条：面别分栏 / 只读命令的副作用 / 基线口径 / 行号引用）

> 本条小节的条目来自**批 9 复核**（`.hob/archive/2026-10-07-hob-capability-verify/REPORT.md`）
> 暴露的方法学教训。取号程序（照任务书 §1，**宽正则**，标题可能带 `🔴 ` 前缀）：
> `grep -oE '^### .*E-[0-9]+' .hob/EXPERIENCE.md` ⇒ 最大号 **E-87**；
> 与 `git show HEAD:.hob/EXPERIENCE.md` 对账一致；`grep -c 'E-88\|E-89\|E-90\|E-91'` 均为 **0**
> ⇒ 本批占用 **E-88 / E-89 / E-90 / E-91**。
> ⚠ 对照：**窄**正则 `grep -oE '^### [^ ]*E-[0-9]+'` 只给到 **E-72**（少取 15 号，与批 7 踩过的是同一个坑）。
> **E-91 是「条件项」**：任务书要求先查重，本册**未覆盖**该大意（查重证据见
> `.hob/archive/2026-10-07-experience-round2/evidence/03-条件项查重证据.txt`）⇒ 新开条目，
> 并在 **E-87** 上**纯追加**一句互指（未改其原文）。

### 🔴 E-88 · 「真机实调」必须按**面别 × 工具**分栏 —— 混栏会写出**方向相反**的错报告

**现象（批 9 复核实测）**：批 9 复核任务书 §3 把**两个预设面**的行混在**同一张表**里，
其中「`write` / `edit` / `bash` **被拒**」一行**只对 `Hob` 面成立**；
而复核方（`Hob-Execute`）**自己那一面这三项恰好是正常的**（它整批都在用 `bash` 取证）。
若照表直读，就会得出与事实相反的结论。
同一批里，那张表的 **9 行只取到 1 行**（`glob`），其余 8 行**结构性取不到**。

**根因**：**"谁能取哪个面"是结构性的，不是执行力问题**。
会话之间**没有任何工具可以驱动另一个会话发起一次工具调用**——
同实例的 `interconnect_*` 只对**已配置的 peer** 有效（本机实测 `unreachable`），
且**不得**给别工作区的会话派活；跨会话的"让对方替我调一个工具"在架构上不存在。
⇒ 判据面**必须**与"取读数的人"绑定；把两张面的行并成一张表，
等于把**一个结构上不可能被满足的要求**写进了任务书。

**正确做法**：
① 任务书的「真机实调」表**按面别分栏**，并在每一栏**写明由谁取**
   （A 面的行 ⇒ 由 A 侧自测后贴回原始返回；B 面的行 ⇒ 交复核方）；
② **跨面结论必须标面别** —— 写"`web_fetch` 成功"不够，要写"**在哪个预设面上**成功"；
③ 复核方遇到"取不到"时，**不许用另一面的读数顶替**，照实写"**未取到**"并给结构性原因
   （批 9 复核报告 §4(一) 即此写法）。

**与 E-26 并读（同族，但不同层）**：E-26 说的是**一个插件的两个半边**（host / client）各需一条判据；
本条说的是**同一次复核里两个预设面**各需一条判据。二者共同的上位纪律是同一句：
**判据的分辨力必须覆盖被测对象的实际分层**，混层读出的结论不可用。

**出处**：批 9 复核报告 §3 与 §4(一)（`.hob/archive/2026-10-07-hob-capability-verify/REPORT.md`）；
F-J103④（助手裁定：今后任务书的「真机实调」表须按「面别 × 工具」分栏并写明由谁取）。

### 🔴 E-89 · 「只读命令」要按**副作用**判定，不是按语义名字 —— `--dump-config` 会重写 `<profile>/cordis.yml`

**现象（批 9 复核实测，两次复现）**：
`dsh --profile system --dump-config` 的**文档语义**是
"print the composed profile tree **and exit**"（`dsh --help` 原文），
听上去是纯读；但跑完它之后：

```
$ md5sum <profile>/cordis.yml   ⇒ da08f43320f829ed34ec07c00c4f31e5   （前）
$ md5sum <profile>/cordis.yml   ⇒ da08f43320f829ed34ec07c00c4f31e5   （后）  ← 内容**逐字节相同**
$ stat    mtime                 ⇒ 20:50:23.479752023  →  20:53:35.107758224  ← **mtime 被触碰**
```

⇒ **内容层零改动、元数据层被触碰**。在一份要求"除指定目录外零写入"的只读任务书里，
这构成**事实上的不符**（批 9 复核把它如实写进了第 4 段（三），未埋）。

**根因**：该命令在**输出前会落盘一次同内容**的 `<profile>/cordis.yml`
（该文件是 profile 根入口列表，内容恒为注释 + `[]`）。
⇒ 「**不启动实例**」**不等于**「**零写入**」——"离线"说的是**不连运行中的进程**，
不是"不碰磁盘"。
⚠ 同一条现象在本项目**已被登记过一次**：**CHG-011** 把 `cordis.yml` 记作
「**mtime 噪声源**」（当时身份不明、归因未定）——**本条补上了那个写入者的名字**。

**正确做法**：
① **复核纪律**：判定一条命令是否"只读"，要看**它碰了什么**（跑前后对目标路径做
   `find -newer` / `stat` / `md5sum` 对照），**不看它叫什么**；
   取"疑似只读"的外部命令时，**先立一道碰前碰后的元数据比对**；
② **要取装配态读数时优先用活体只读通道**（**零落盘**）：
   本机可用 `cordis_inspect_query`（host 的 `Config` provider）直接读**运行中的**装配目录，
   批 9 复核实测一次拿到 6 条 agent-preset 条目（其中本插件 2 条）；
   它读的是**内存里的活体组合**，比 `--dump-config` 的**磁盘组合**更贴判据，且**不落盘**；
③ **结论要分层写**：内容层（md5 / 字节）、元数据层（mtime / ctime / 属主）分开报，
   不要用"内容没变"去盖掉"mtime 变了"（反之亦然）；
④ 与 **E-23** 并读：E-23 说 `--dump-config` 是**离线验证**手段、**不证明运行时就绪**；
   本条补的是它的**另一半代价** —— **它自己会落盘**。

**出处**：批 9 复核报告 §4(三)（`evidence/` 内含 `md5sum`/`stat` 前后对照）；F-J103①；
与 **CHG-011** 同源（本条给出该噪声源的写入者）。

### 🔴 E-90 · 取基线必须取「与判据**同一状态**」的那一份

**现象（批 9 实测）**：批 9 一度拿批 6「机制落地**前**」的工具面读数
（`Hob-Execute` = **104**）当基线，于是对收口态 **103** 报了一个**假回归**
（差集 `['ask_user_question']` 被记成"本批少了一项能力"）；
改用批 6 **收口态（103）** 后，集合相等判为 `true`。

**根因**：同一目录下的基线文件**有多个时点**的版本，名字都很像
（本项目的实例：`BASELINE-隔离实例逐预设工具面.log` 与 `FINAL-隔离实例逐预设工具面.log`，
两者文件名相近、均在同一 `evidence/` 目录）。
取错时点 ⇒ 把**上一批已经修正过的差异**记成**本批的回归** ⇒ 结论的**符号是反的**。
（批 9 报告 §6.2 自己把这条诊断为"判据覆盖面不足，不是执行失误"。）

**正确做法**：
① 取基线**先问一句**：这份基线是**在哪个状态下**取的？与我要对照的判据**同一状态**吗？
   要对照"本批之后的收口态"，基线就必须取**上一批的收口态**，不能取上一次改动**之前**的那份；
② **把状态写进文件名与报告**（例：`FINAL-…` 标"收口态"、`BASELINE-…` 标"改动前"），
   并在报告里**显式写出基线的来源文件与它的时点**——批 9 复核报告 §3.2 即是此写法；
③ 发现"差集只差一项且那一项是**别批刚改过的**"时，**先怀疑取错基线**，
   再怀疑被测对象（与 E-85「先怀疑测量装置」同族）；
④ **同族三条互指**：本条的修法与 **E-83**（缺席的 PASS）、**E-84**（先证明观测器活着）
   **完全同一句** —— **先确认观测条件成立，再读值**：
   · E-83：断言要**覆盖**被测对象；
   · E-84：观测器要**真的读通**；
   · **E-90（本条）**：基线要**同一状态**。
   三条都是"**读之前先确认这次的读法/参照物能被信任**"。

**出处**：批 9 报告 §3.5 与 §6.2；批 9 复核报告 §6.4；
F-J99①（Hob 已登记的候补条目，本条为其落地）。

### 🔴 E-91 · **行号是「引用的对象」** —— 改了被引用的文件，就等于改了引用

**现象（批 9 实测）**：批 9 改了 `src/preset/tools.ts`（白名单从 11 名扩到 20 名），
而经验条目 **E-87** 引用的行号是**改前**的 `:294` / `:342`；
扩容后那两处实际已移到 `:331` / `:379` ⇒
**按条目给的行号去复核，落到的是别的代码**，引用的可复核性**当场失效**。
（批 9 报告 §6.2b 如实记了这次踩坑；本条把它写成通用纪律。）

**根因**：行号是**指向被引用文件里某个位置**的**引用**，**不是**被引用文件的一部分。
⇒ 它**随被引用文件一起变化**：改了被引用文件，**引用就跟着失效**，
而**改文件的人通常不会收到任何提示**（`git diff` 里只有代码改动，没有"谁引用了这几行"的信息）。
这与 **E-55**（两份载体必然漂移）**形似而不同层**：
E-55 的问题是"同一内容的两个副本"，本条的问题是"**一份内容 + 若干指向它的指针**"。

**正确做法**：
① **写进条目的行号必须当批复验一遍**（与它引用的代码在**同一批**里核）；
② 或者 **同时给一个不随行号漂移的锚** —— **函数名 / 注释原文 / 唯一字符串**，
   让它成为**主定位**、行号降级为**辅证**：
   · 例（E-87 采用的形态）：`filterModelToolList` / `enforceToolAllowlist`（**函数名**）为主，
     `src/preset/tools.ts:331` 为附注并明写"该文件后续再改会移位"；
③ **改了被引用文件时，同一批要 grep 谁引用了它**：
   `grep -rn "<被改文件名>" .hob/EXPERIENCE.md .hob/drafts/ PROJECT.md`，
   把受影响的引用**一并在同一批里复验**——否则下一批的复核会踩空；
④ **可迁移判据（本条最值钱的部分）**：
   **"引用"与"被引用物"必须成对复验** —— 改 A 之前先问"谁指向 A"（与 **E-34「拆东墙自检」**
   同一句问法，只是把"既有行为"换成了"既有引用"）；
   给不出锚、又没复验的行号，**宁可写成"某函数附近"也不写具体数字**。

**与 E-34 并读**：E-34 问"改了 A，B 还成立吗"（B = 既有行为/判据）；
本条问"改了 A，**指向 A 的那些引用**还成立吗"（引用 = 文档里的行号/路径）。
二者是同一条纪律在**两个作用面**上的实例：**改动的影响面不会自己浮现，要主动去查。**

**出处**：批 9 报告 §6.2b（`.hob/archive/2026-10-07-hob-capability/REPORT.md`）；
F-J99②（Hob 已登记的候补条目，本条为其落地）；
E-87 正文里的"按函数名定位"即本条所主张的锚形态（该条已加互指）。

---

### 🔴 E-92 · **预设里声明「提供 Service 的插件」必须成组隔离（`isolate`）** —— 漏了它，预设**挂不上**且**静默消失**

**现象（批 13 实测，2026-10-08）**：给 Hob 预设加 `/compact` 能力，按任务书"逐行指名"把两行
**就地单行**加进 `preset/dsh-hob/preset-dsh-hob.patch.yml`：
`compaction-basic`（`@deepseek-ai/dsh-compaction-basic`）+ `command-compact`。
`npm run check:presets` **PASS**、`build` **exit 0**、`--dump-config` 里**两行都在位** ——
但隔离实例里建 Hob 会话直接抛：
```
SESSION Hob: FAIL Preset services require isolate realms: compaction
```
⇒ 该预设被标 **`broken`** ⇒ **在选择器里被静默过滤掉**（E-21 的形态复现）。
**三层机检/离线检查全绿，而能力实际为零** —— 这正是本册反复强调的"看不见的失效"。

**根因**：`compaction` 是一个 **cordis `Service`**（`dsh-compaction/lib/index.js` 里
`super(ctx, "compaction")`），而 `dsh-agent-preset-registry/lib/index.js:123-137` 的
`leakedServices()` 在**预设挂载**时逐个检查：
「挂在本次挂载 fiber 内、且用的是**根 realm** 的 key 的服务」——有一个就抛。
⇒ **裸声明**（无 `isolate`）意味着它用根 key ⇒ **必然被判泄漏**。

**正确做法**：
① **提供 Service 的插件行必须与它的消费者行共享一个隔离域**。三种写法的实测结果：
   · 裸声明（两行都无 `isolate`）⇒ **挂不上**（`Preset services require isolate realms: compaction`）；
   · **只给叶子加 `isolate: {compaction: true}`** ⇒ **仍然挂不上**
     （`command-compact … waiting for compaction`）——`true` 给**每行各开一个新 realm**，
     兄弟之间**互相看不见**；
   · **共享一个 realm 标签**（`isolate: {compaction: <同一个标签串>}`，两行都写）
     ⇒ **通过**。依据：组合参考的规则「a preset plugin that provides a service isolates the
     provider **and all consumers together**」——**同一个标签串 = 同一个 realm**。
② ⚠ **别照抄宿主的「组 + `isolate`」写法**（`standard.patch.yml` 的 `compaction` 组）：
   那会引入一个**分组容器行**，撞本项目 ⑤f 的两条断言（禁 `cordis:group`、禁 `group: true`）。
   共享 realm 标签是**同时满足"能挂载"与"不放宽既有断言"**的写法（实测两者皆过）。
③ ⚠ **连在注释里写出被禁的字面串都会踩断言**：本批我第一次把 `name: cordis:group`
   写进解释性注释 ⇒ ⑤f **FAIL**（那条匹配**不剔注释**；而同组"声明行在位"那条**已剔**）。
   ⇒ 注释里谈禁项时**故意不写全字面串**，或先确认该断言是否剔注释。
④ **可迁移判据**：**"能挂载"是一个独立的验收面**，与"声明行在位 / 机检 PASS / dump 可见"
   **都不等价**。改预设插件行后，**必须在隔离实例里真建一个该预设的会话**才算验过；
   只看 `--dump-config` 会把 broken 的预设当成好的。

**出处**：批 13 报告第 3/4 段（`.hob/archive/2026-10-08-hob-capability-batch2/REPORT.md`）；
原始读数见 `evidence/02-三层读数-隔离实例.txt`；
对照实验：V1 裸声明 / V3 叶子 `true` / V2 组 / V5 共享标签（4 组，逐组一跑）。

---

### E-93 · **契约里的"如实声明"句过期了，比缺一句更危险** —— M3 落地后三处 `NO automatic delivery` 变成**失实话术**

**现象**：M3（会话总线投递）落地后，契约正文里仍写着
`There is NO automatic delivery: the user carries your directive across by hand.`
与 `never claim you sent, dispatched, assigned or delivered anything` ——
**这些话在改动生效的同一刻起就是假的**。而它们**不会自己报错**：
模型照读，于是**该投递时不投递**（以为不能），或者投了却**自我否认**（"我只是交给了你"）。
更隐蔽的是：**机检 ⑤c/⑤d/⑤e/⑤g 正拿这几句当"必须存在"的稳定短语**
⇒ 谁把契约改对，**谁的机检就 FAIL**（判据把失实句钉成了正确态）。

**根因**：这些句子的来源是 **UD-11 / UD-12**（"先做半自动、不做会话对接"），
它们是**当时的用户决策**、不是机制事实。用户一旦改主意（UD-77 要投递），
**事实翻转而断言不动** ⇒ 断言从"保护正确"变成"保护过时"。
⚠ 关键点：**机检本身没有错**，它忠实地钉住了写下它们时的目标态；
错的是**改事实的那一批没有同批改断言**（本项目 PROJECT.md §10.3「归类变更牵动多处」的同类，
只是这次牵动的是**断言**而非 gitignore）。

**正确做法**：
① **改"能力事实"时必须成对改三处**：**机制**（代码）· **契约正文**（模型读的）·
   **机检稳定短语**（判对错的）。少任何一处都会制造一个**静默的谎**：
   少改正文 ⇒ 模型行为错；少改机检 ⇒ 改对的人被拦下（**这个更糟：它保护错误态**）。
② **断言替换而非删除，且只增不减** —— 旧断言钉的事实不存在了，原样留着会永远 FAIL；
   新断言要钉**新事实里更强的那条**。本例：从「没有投递」换成「**投了也不算做完**」
   （`Delivering is not doing`），语义**更严**，条数由 10 → 11、⑤d 由 10 → 11。
   ⇒ 判定"是否放宽"看的**不是条数**，而是**新断言是否覆盖了旧断言的保护意图**：
   旧意图 = "别让 Hob 假装有本事"；新断言 = "**投递是本事，但别把它当执行**"，**意图保住且更细**。
③ **替换后必须跑负向对拍**（把新短语删掉 ⇒ 必须 FAIL），否则"替换"可能只是"删掉"。

**出处**：批 14（本次）· `scripts/check-preset-contracts.mjs` 的 ⑤c/⑤d/⑤e/⑤g 四处改写；
账本 `DECISIONS.md` **CHG-019** · `USER-DECISIONS.md` **UD-77**；
实际读取的旧句在 `preset/dsh-hob/preset-dsh-hob.patch.yml` 的三处（`## Your duties` /
`## Your side and the other side` / 编排段末）。

---

### E-94 · **"某操作成功返回"不等于"那个效果发生了"** —— 归档会话投递 `ok:true` 但执行被门禁挡死

**现象**：批 15 前，`hob_send` 投递给**已归档**的会话会返回
`{"ok":true,"delivered":true,"messageId":"…"}` —— 回执一切正常。但**那个会话永远不会跑**：
消息确实进了 inbox、`followup` 确实把它唤醒了，可执行被宿主 `agent/pre-step` 门禁挡下。
真机转写给出铁证：该会话有 **`turn/start` 计数 2**、而 **`step/start` 计数 0**
（唤醒发生了，步进一次都没有）。⇒ 调用方拿到"成功"，然后**永远在等一个不会来的结果**。

**根因**：把"投递这个动作的返回值"当成了"对方会执行"的证据。两者之间隔着**宿主的一道门禁**
（`archiveSession` 写的 durable archive set 正是那道门的判据），而**这道门对本模块不可见**
—— 除非主动去读 `workspaceRegistry.archivedSessionIds`。
⚠ 更根上的问题：**归档不 dispose agent**。所以任何"按 `agents.get(id) !== undefined` 判断
还活着"的写法，对归档会话**一律误判为活**。我原来的 `list()` 正是这么写的。

**正确做法**：
① **回执只证明"动作发出去了"，不证明"效果会发生"** —— 凡是有下游门禁的动作，回执里
   必须把"我确认到了哪一步"写清楚，或干脆**在源头拒掉不可能生效的目标**。
   本例选了后者：`deliver()` 前置拒绝归档目标（`list()` 同步不列）。
② **"看起来还活着"要用真正表达存活的服务判**，别拿"对象还在"代替。
   归档会话的对象在、agent 在、状态 idle —— 全都像好的。
③ **识别门禁要读门禁的**判据源**（这里是 `archivedSessionIds`），别自己另立一套"归档"定义。
④ **拿到一个静默失败要顺着"谁本该报错却没报"往下查**：本例里 `list()`、`deliver()`、
   宿主门禁**三处都合规**，合起来才产生"成功但没发生"。**单个组件无错 ≠ 组合无错。**

**出处**：批 15（本次）· `src/modules/bus.ts` 的 `makeArchivedLookup` / `list()` / `deliver()`；
真机证据见账本 `FACTS.md` **F-J139**（含 17 条探针里 B 组的空白对照法：
把归档集置空 ⇒ 归档会话又出现、投递又"成功"，以此证明过滤/拒绝断言**真的有牙**）。

---

### E-95 · **探针的假 ctx 必须模拟真框架语义，否则它保护的是"我以为的框架"** —— `inject` 是"全部必需"，没有"可选"这一档

**现象**：批 15 第一版给 `ctx.inject(['sessions','agents','workspaceRegistry'], cb)`
**把可选依赖写进了必需表**，并在注释里写了一大段"缺席时降级成没有归档概念"。
**那段降级逻辑根本进不去**：cordis 的 `Fiber._refresh()`（`cordis/lib/index.js:1320-1327`）
对 `inject` 里**每一个**名字检查，**缺任何一个就把 epoch 置 `INACTIVE`、整个 fiber 不激活**
⇒ `workspaceRegistry` 一缺席，**整个会话总线都不提供**，不是"降级"而是"停用"。

**为什么没被发现**：我的探针用一个**手工写的假 ctx**，它的 `inject` 是
`(deps, cb) => { cb(fakeCtx) }` —— **无条件调回调**。于是"可选服务缺席"这条分支
在我造的假世界里**永远走得通**，探针 C 组三条断言**全部 PASS**，而真机行为是反的。
⚠ 这是**探针替被测代码挡了子弹**：假 ctx 把框架的门禁语义**抹平**了，
测出来的是"我以为 cordis 会怎么做"，不是"cordis 实际怎么做"。

**根因**：**假替身的宽容度决定了探针能发现什么**。替身越宽松，探针越"绿"，但越假。
本例里 `inject` 的语义（全部必需 vs 部分必需）**正是被测逻辑的承重点**，
把它模拟错了 ⇒ 该测的分支根本没被执行。

**正确做法**：
① **替身必须按真语义实现，且只"放过"与本次改动无关的部分**。本例一旦把假 `inject`
   改成"依赖表里有缺项就不调回调"，**C 组立刻 FAIL**（我实测：改探针后对旧产物跑出
   **14/17**，C1/C2/C3 三条红；对新产物 **17/17**）⇒ 断言**当场就有了牙**。
② **"可选依赖"在 cordis 里的正确写法是根本不声明**，改用 `ctx.get(name)`
   （文档明写 *"Read a service from the store **without the inject requirement**"*）。
   ⚠ 而且**不能用属性访问**：`ctx.workspaceRegistry` 在未声明时会抛
   `cannot get property "…" without inject`（Proxy handler, `lib/index.js:676`）。
   ⇒ **`get` 读、且 try/catch**，缺席返回 `undefined` 再降级。
③ **凡是要"证明降级路径成立"的断言，都必须让该服务真的缺席**（不是"置空"）——
   置空只测了数据分支，没测**框架级缺失**。

**出处**：批 15（本次）· `src/modules/bus.ts` 的 `makeArchivedLookup` 与 `apply` 的 inject 行；
探针 `/tmp/b15-archived-probe.mjs` 的 C 组（改假 `inject` 语义后从恒 PASS 变成能咬人）；
账本 `FACTS.md` **F-J139** · `DECISIONS.md` **CHG-020**。

---

### E-96 · **闭包里快照"活数据"，会让功能只对"过去"有效** —— 归档集是原地改的数组，我却建了一次 Set

**现象**：批 15 的归档过滤**上线后看着是好的**（构建前归档的那批全被挡住了），
但**构建之后新归档的会话照旧出现在 `hob_sessions` 里**。真机实测：
`session-a15c0f5d` 明明已经在 `registry.archivedSessionIds` 里，`list()` 仍把它列出来。
⇒ 症状是"**归档功能时灵时不灵**"，而不是"归档功能坏了"。

**根因**：`makeArchivedLookup` 在**模块构建时**把 `registry.archivedSessionIds`
取出来 `new Set(...)` 并让闭包捕获。而那个集是**活数据** ——
宿主**原地改同一个数组对象**（实测：归档前后 `archivedSessionIds` 是**同一引用**，
内容增长）。我拍的是**快照**，所以判定的是"构建那一刻的归档状态"。
⚠ 关键：**"一次读取"与"持续跟随"看起来代码一样干净**，差别只在
"读到的值是快照还是引用"，而多数语言/框架**都不会替你在这一点上报错**。

**正确做法**：
① **凡是被判定为"状态"的外部数据，先问一句"它会变吗、变了之后我这个闭包还准吗"**。
   会变 ⇒ **每次现读**，或订阅变更事件；**不要**在构建期取一次就固化。
② 现读的代价要评估：本例每次 `includes` 是 O(n)，但 n = 归档会话数（个位数到几十）
   且只在列会话时调用 ⇒ **可忽略**。**别为了微优化把正确性换掉**（第一版建 Set 就是
   打着"避免线性扫"的名义做的事）。
③ **症状"时灵时不灵"是快照类缺陷的指纹**：它随时间/顺序变化，不与代码改动同步。
   看到这种形态，优先怀疑"读的是旧快照"，而不是"逻辑写错了"。

**为什么第一次没抓住**：探针里的假 registry 用 `archivedSessionIds: []`（**定值**），
构建后从不改它 ⇒ **快照与现读在探针里表现完全一致**。
⇒ 补法：加一组"H 组"断言 —— **先让服务构建，再往归档集里 push**，然后断言
"立刻不再列出 / 投递立刻被拒"。改前对旧产物跑出 **27/29**（H2/H3 红），改后 **29/29**。
⚠ 这与 E-95 同源：**替身比真环境"干净"，就会掩盖这类时序缺陷。**

**出处**：批 15/16 · `src/modules/bus.ts` 的 `makeArchivedLookup`（已改为每次现读）；
探针 `/tmp/b16-spawn-probe.mjs` 的 H 组；账本 `FACTS.md` F-J140。

---

---

### E-97 · **"由调用参数派生的字段"不能当过滤依据** —— 我给列表挑"别的会话"，选中的却是自己

**现象**：为了测"插件能否监听别的会话的状态"，探针要挑一个**不是自己**的会话，
于是写了 `.filter(r => !r.self)`。结果**选中了本会话自己** ——
一条探针消息混进了用户的对话里（用户看到一条莫名其妙的 `【事件探针】忽略即可`）。

**根因**：`self` **不是会话行的固有属性，而是 `list()` 入参的派生字段** ——
实现是 `self: selfSessionId !== undefined && id === selfSessionId`。
我调用时传了 `undefined` ⇒ **每一行的 `self` 都是 `false`** ⇒
`!r.self` 对**所有**行成立 ⇒ 过滤器等于没写，取到列表首个元素，而那正是本会话
（列表按"活 + running 优先"排序，正在 running 的只有自己）。
⚠ 这个形态特别危险：**它不报错、也不为空**，而是给出一个**合法但错误**的结果；
且缺参时的默认值（`false`）读作"不是自己"，**语义通顺、代码读起来完全正确**。

**正确做法**：
① **要排除某个已知实体时，直接拿它的身份比对**，不要依赖"框架帮我标了 self"
   —— 本例应为 `rows.find(r => r.id !== selfId && r.live)`。
② **凡"由入参派生"的字段（self / isOwner / 权限结果…），先问"缺参时它取什么值"**
   —— 若那个值会**静默地把整批行判成同一类**，就不能用它做过滤。
③ **加一层不会错的兜底**：即使过滤写错，投递也不该能投给自己
   —— 当时 `hob_send` **工具层**有这道保护，但**服务层 `bus.deliver()` 没有**，
   所以任何绕过工具的直接调用都能重犯。**"保护只在一层"等于"绕过去就没保护"**
   （批 17 已把该自检下沉到服务层，用 `agents.currentInitiator()` 取调用者身份）。
④ **探针也是真刀真枪在用户的真实环境里跑** —— 选目标这种动作要按生产代码的标准写。

**出处**：2026-10-09 事件探针；账本 `FACTS.md` **F-J141**。

---

### E-98 · **自己会转的系统，"停"必须建在【动作发生之前】，而且要能被验证咬住**

**现象**：批 17 的闭环编排是**用户明确选择"不设上限、只能手动停"**的能力 ——
它会在一轮结果回来后**自动唤醒派活方**，于是循环可以一直转下去。
这类系统的失效模式不是"报错"，而是**在没人看着的时候继续烧 token**；
而且"停住没有"从外部看**与"安静地正常着"完全一样**（静默性 + 自治性叠加）。

**根因**：把闸门放在"派发"入口是最自然的写法，但那会留下**一定会发生的空转** ——
对方已经跑完了，回传照发、派活方被叫醒，只是它下一次派发被拒。
即：**闸门位置比闸门本身更容易出错**；真正该拦的是"回传"这一步。

**正确做法**（三条，缺一不可）：
① **闸门设在"动作发生之前"，不是"下一次动作之前"**。
   最自然的写法是在"派发"入口检查 `stopped` —— 但那会留下一个**一定会发生的空转**：
   对方已经跑完了，回传照发，派活方被叫醒，只是它下一次派发被拒。
   ⇒ 真正该拦的是**回传这一步**（`if (stopped) { relaysBlocked++; return }`），
   循环**当场断在那一环**，连唤醒都不发生。
② **单次性要"先标记再发"**。同一个 `idle` 事件可能重复到达；
   若"发完再标记"，重入会把派活方刷爆。⇒ `w.reported = true` 写在投递**之前**。
③ **断言必须直接咬住"停了就不发"这个行为**，而不是"停了这个标志位变了"。
   本批探针的 D 组就是：`stop()` → 触发状态跳变 → 断言**投递列表长度为 0**
   + `relaysBlocked` 计数 +1 + `dispatch` 被拒 + `resume` 后恢复。

**为什么这类系统特别容易"看着对但停不住"**：因为它**没有失败信号** ——
停了没停、转没转，从外部看都是"安静"。⇒ **静默性和自治性叠加**时，
唯一可靠的办法是**把"停住"变成一条能被对拍的断言**，而不是一段注释里的承诺。

**顺带一条设计取舍**：`modules.orch` 的**缺省值与 `bus` 相反**（`false` vs `true`）。
判据不是"保守/激进"，而是**两个方向的误判代价谁更小**：
· `bus` 读不出时取 `true` ⇒ 错了只是"少两个工具"（可见、可改）；
· `orch` 读不出时取 `false` ⇒ 错了只是"少三个工具"；
  而取 `true` 错了则是"**一个会自己转的东西被打开了**"。⇒ **取代价更轻的那边。**

**出处**：批 17 · `src/modules/orchestrator.ts`（D 组断言见 `/tmp/b17-orch-probe.mjs`）；
账本 `FACTS.md` **F-J142**。

---

### E-99 · **"服务句柄"也是活数据** —— 在构建期取一次的服务引用，会永久停在"当时不在"

**现象**：重启后发现 `hob_spawn` **一律**失败：

```
workspace registry unavailable: cannot resolve a workspace, and creating a session without one is refused.
```

**而同一进程里 `ctx.get('workspaceRegistry')` 明明返回 `ok`** —— 服务在，是模块**记错了它不在**。
`listWorkspaces()` 也返回 `[]`（同一个错误来源）。

**根因**：`apply` 里写的是
`const registry = makeRegistryLookup(svcCtx)` —— **在模块构建那一刻读一次并存进闭包**。
但 `workspaceRegistry` / `sessionController` 由**别的插件的 fiber** 提供，
与本模块**并行激活**，**谁先就绪不保证**。本模块先到 ⇒ 取到 `undefined` ⇒ **从此永远 `undefined`**。

**⚠ 这是同一个坑的第二次**：批 15/16 的 `makeArchivedLookup` 踩过**完全同形**的缺陷
（把归档集快照成 `Set` ⇒ 构建之后新归档的会话不生效），当时记了 **E-96**
（"闭包里快照活数据，会让功能只对'过去'有效"）。
⇒ **两次的区别只在快照的是"数据"还是"服务句柄"，本质完全相同。**

**正确做法**：
① **凡由别的 fiber 提供的服务、或任何外部活状态，一律【每次现读】，绝不在构建期取一次存起来。**
   写法：不要 `const svc = lookup()`，要 `const svcOf = () => lookup()`，在**每个使用点**调用它。
② **"可选依赖"降级分支也要能对付"晚到"**：本模块的设计是"服务缺席就明确拒绝"（合理），
   但**"缺席"必须是当下的事实，不能是构建时的快照** —— 否则一次时序意外就变成**永久性失效**。
③ **症状识别**：「服务明明在，代码却说不在」+「**重启后必现、热重载不修**」
   ⇒ 优先怀疑"构建期快照了并行就绪的东西"。
④ **这类缺陷探针极难自己冒出来**：假 ctx 里服务**一开始就在**（测试的常规写法）
   ⇒ 永远测不到"晚到"。⇒ 必须**专门造"服务晚到"的场景**（本批 I 组：
   先以 `withRegistry:false` 构建，**之后**把服务放进 present）。
   对旧产物跑 **30/33**（I2/I3/I4 三条 FAIL，**报错文本与真机逐字相同**），对新产物 **33/33**。

**出处**：批 19 之后的修复轮 · `src/modules/bus.ts` 的 `registryOf` / `controllerOf`；
探针 `/tmp/b16-spawn-probe.mjs` 的 I 组；账本 `FACTS.md` **F-J144**；同族教训 **E-96**。
