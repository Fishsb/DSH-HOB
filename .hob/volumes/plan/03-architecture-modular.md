### 3. 架构：模块化插件

### 3.1 总览

```
┌─────────────────────────────────────────────────────────┐
│  宿主 profile（用户已有的，不新建）                        │
│  └─ dsh-hob（本插件）                                     │
│       ├── Host 半边（Node 侧，模块化）                     │
│       │    M1 工具 · M3 会话总线 ★ · M4 设置 · M5 编排     │
│       ├── Client 半边（浏览器侧，模块化）                   │
│       │    C1 设置面板                                     │
│       └── Agent 预设（本插件自带，基于 DSH minimal）★       │
└─────────────────────────────────────────────────────────┘
```

### 3.2 模块清单

#### Host 半边

| # | 模块 | 职责 | inject 依赖 |
|---|---|---|---|
| **M1** | 工具模块 | 提供本插件的工具（**定义**在其中，**注册**在预设作用域） | `tools` |
| **M3** | 会话总线模块 | **同实例内：列可投递的活会话 + 投递指令 + 列工作区 + 建会话（强制带工作区）**；**归档会话不列、也不可投** | `sessions` `agents`（**反应式**）+ `workspaceRegistry` / `sessionController`（**可选**，`ctx.get` 读，缺席则相关能力明确拒绝） |
| **M4** | 设置模块 | 配置面收口（schema 导出 + 与宿主 `settings` 服务的连接点） | `settings` |
| **M5** | 编排模块 | **闭环派活**：投递 → 等对方跑完 → 回传结果（结论 + 改动文件）→ 唤醒派活方；并记「**待投递**」中间态 | `sessions` `agents`（必需）+ `hobBus`（**可选**，缺席则派发明确拒绝） |
| **M7** | **新建 Hob 会话通道**（`session-create-channel.ts`，2026-10-22 UI 源码阶段） | **建空白 Hob 会话 + 写两轴策略 + 回读确认**的受信链；一次性票据（伪造/重放/过期/跨会话皆拒）；写失败**回滚**、回收不了如实报 orphan | `connection`（自有 `/api` 路由，鉴权与跨站由宿主栅栏）+ `sessions` + `sessionController` + `workspaceRegistry` + `hobSessionPolicy`（**全部可选**，`ctx.get` 读；缺席则明确拒） |
| **M8** | **会话策略读写路由**（`session-policy-route.ts`，2026-10-22 第 4 轮 · 自动弹窗打通） | 给**已存在的** Hob 会话补两条动作：`read` 回答「选过档位没有」（四态：已选 / 未选 / 不适用 / **判不出**，⚠ 判不出与"未选"**必须可区分**）· `write` 把两项落到该会话（走 `hobSessionPolicy.set`，⛔ 不建会话、⛔ 不造第二套写入）。⚠ 线格式**只回 `state` 一个语义字段**，⛔ 不回带档位值 | `connection`（自有 `/api` 路由，鉴权/跨站由宿主栅栏）+ `hobSessionPolicy` + `sessions`（**全部可选**，`ctx.get` 读；缺席 ⇒ `unknown` / 明确拒） |

> ⚠ **模块清单以 `src/modules/` 实际文件与入口 `MODULE_REGISTRY` 为准**：
> 现为 `tools` / `bus` / `orchestrator` / `settings` / `session-create-channel` / `session-policy-route` **六个**。
> ⚠ 后两个是**独立通道模块**，⛔ **不进 `MODULE_REGISTRY`**（那张表管"可开关的业务能力"，
> 而这两条是"建会话+写策略"与"读/写已存在会话策略"的**原子入口**，没有独立开关语义）。
> ⛔ **本方案不再列"预设装配挂点"这个模块** —— 它**从未存在**（全仓 `agent-presets` 零命中；
> 预设本体住在 `preset/<预设 id>/*.patch.yml`、由 profile 的 bundles 装配）。
> ⚠ 历史文档里的 `M2` 是**设计阶段的编号**，⛔ 不要据此去找代码（见 `CONTEXT.md` §0.6）。
> ⚠ **工具的定义与注册分离**：定义在 `src/modules/*.ts`（各一份），注册在 `src/preset/tools.ts`（**预设作用域**）。

#### Client 半边

| # | 模块 | 职责 | 依赖 |
|---|---|---|---|
| **C1** | 设置面板模块 | 设置 UI（原生 configForms）+「新建会话默认」卡片 | `settings` · `slots` · `locale`（可选，反应式） |

⚠ **`C2`（UI 模块，"按需再加"）不复列**：它是**规划位**、⛔ 无代码；⚠ 若将来真加，按 §3.3 第 4 条登记并同批改本表（机检 **W 组**只管 Host 半边，⛔ 不覆盖 client 表）。

**实现状态一律不在本节记**：M1 / M3 / M4 / M5 / C1 的落地与真机验证读数见 `CONTEXT.md` §2.1b。
⚠ **跨系统（M6b）暂缓**（见 §9）。
⚠ **逐会话档位后端与创建弹窗**（需求 REQ-04）：加载与现状见 `CONTEXT.md` §2.1b，⛔ 本节不记进度状态。
⚠ **新建会话的可读范围只开放最低档**（账本权限）：另两档**照常呈现但不可选**（灰显 + 标「暂未开放」），
**待宿主持久清理能力具备后再开放**（条件是「创建失败后重载，该会话既不能执行、也不能按更宽档位读出工作区文件」这对读数）；
推进方式三档不受此限。
⚠ 判据是 `check:hob-create` / `check:hob-create-dom` / `check:hob-gate` **三族**（策略面另有 `check:policy`）。
⛔ **仍然不宣称已上线**：真机渲染、真实宿主归档、真机 dispose **均未验**。需求口径见 `volumes/requirements/REQ-04.md`；实现与验证状态、剩余工作见 `CONTEXT.md` §2.1b。

### 3.3 「灵活扩展」的四条硬纪律

**必须保持的性质**（写进代码注释与入口文件）：

1. **一个模块一个文件**，各自 `apply(ctx, config)`
2. **依赖靠 `inject` 声明**，**两种写法语义不同、后果不同**：
   - **模块级 `export const inject`** = **加载门禁**：依赖不在 ⇒ 该模块 fiber 停在 `PENDING`（**不激活**）；
   - **`ctx.inject([...], cb)`** = **反应式订阅**：依赖不在 ⇒ 模块**照常 ACTIVE**，只有**回调不跑**。

   ⚠ **可选依赖必须用反应式**：把可选依赖写进模块级 `inject` 会让预设被标 `broken`，
   而 `broken` 预设在选择器里**被静默过滤**（用户看不到、也无提示）。
   ⚠ **client 半边尤其危险**：把命名空间写进模块级 `inject`，缺席会让**整个 client 插件不激活 ⇒ 设置分区整体消失**。
3. **资源靠 `ctx.effect` 挂** ⇒ 卸载自动清理，无残留
4. **加模块 = 加文件 + 登记**（不动其他模块）：入口的 `import` · 入口的 `MODULE_REGISTRY` ·
   `src/config.ts` 的 `ModulesConfig` 接口字段 · 同文件的 schema 字段（默认值 / 描述 / `.volatile()`）·
   同文件的 `moduleSwitches()` 里 `pick('x', default)` 一行。
   ⚠ **现实是 4–5 处**（后三项属同一文件但不同位置）；**"是否要改造成真正的一行"另作决定**。

**验证方式**（可机检）：造一个**依赖缺失**的场景 ⇒ 证明该模块不激活，**但插件整体照常加载、其他模块照常工作**。

**模块可独立启停**：入口有模块登记表，每项带开关；开关是配置字段（§7），关掉只影响该模块自己。

### 3.4 目录结构

```
dsh-hob/
├── package.json               # name: dsh-hob；dsh.bundle.patch 列入 patch
├── cordis.patch.yml           # 插件自身的 bundle patch
├── scripts/                   # 收尾检查脚本（见 §10.2）
│   ├── check-gitignore.mjs    # ★ 薄调度入口（对外的名字与出口）
│   ├── check-repo-rules.mjs   #   族① 入库/排除/骨架覆盖/脚本落点双向自检
│   ├── check-doc-shape.mjs    #   族② 正本形态
│   ├── check-code-face.mjs    #   族③ 源码与骨架静态面
│   └── （其余各 check 的脚本 + 两个辅助：`write-build-stamp` · `next-experience-id`）
├── preset/
│   └── dsh-hob/
│       ├── package.json
│       └── preset-dsh-hob.patch.yml        # Hob 预设声明（id `Hob`）
├── src/
│   ├── index.ts               # 入口：模块登记表 + 逐模块装载
│   ├── config.ts              # 配置 schema（在入口层统一声明）
│   ├── shared/                # 两个半边共用的常量（单一来源）
│   ├── modules/               # ★ Host 半边
│   │   ├── tools.ts           # 工具**定义**（唯一一份）
│   │   └── bus.ts · orchestrator.ts · settings.ts · session-create-channel.ts
│   ├── preset/
│   │   └── tools.ts           # 工具**注册**（预设作用域）+ 白名单
│   ├── server/                # 守卫实现（读 / 写各一份）+ 编排运行态落盘 + 读数渲染 + 写入即投递
│   └── client/                # ★ Client 半边
│       ├── index.ts · settings-panel.tsx · settings.ts
│       ├── catalog.ts         # 宿主 RPC 取候选
│       ├── i18n.ts            # 中英词典 + 跟随宿主语言
│       └── panel-styles.ts    # 样式（字符串注入）
└── .hob/                      # 骨架（账本在**工作区之外**）
```

⚠ 目录可调整，但**必须保持"模块可独立启停"这个性质**。

#### 四条实测结论（**过程与读数见经验库**，此处只留结论）

1. **工具的「定义」与「注册」必须分开** —— 插件作用域注册的工具**会漏进每一个预设**，
   直接违反 §5.2「只有规划预设挂本插件的工具」。⇒ 定义放 `src/modules/*.ts`，**注册放 `src/preset/tools.ts`**。
2. **缺依赖的模块不要用静态 `inject`** —— 静态声明缺依赖会把预设标 `broken`，
   而 `broken` 预设**在选择器里被静默过滤**。⇒ 门禁用**反应式** `ctx.inject(...)`。
3. **可选服务必须"每次现读"，不许构建期取一次** —— fiber **并行激活**，谁先到不确定；
   构建期取一次会永久停在"当时不在"。⇒ **凡"别的 fiber 提供的服务"或"活状态"，一律现读**（判据是**机制**）。
4. **取用宿主服务用免 inject 的读法** —— `ctx.get('<逐字名>')` **免 inject**；
   `ctx.<服务名>` 或 `xxx.<成员>`（**属性访问**）**不免** ⇒ **全程零属性访问**。
   另：`ctx.inject(...)` 返回的是 **Fiber，不是函数** ⇒ 清理用 `.dispose()`。

---
