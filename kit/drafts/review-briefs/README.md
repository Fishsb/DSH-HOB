# 审查简报索引

> **性质**：每个模块一页「审查简报」（四行：失败长什么样 / 该跳过的路径 / 建议上限 / 证据要求）。
> **模板**：[`_TEMPLATE.md`](./_TEMPLATE.md)。
> **为什么放在 `kit/drafts/`**：⚠ 按 `kit/README.md` §1.2，`drafts/` 是**本项目自己的**契约正文，
>   ⚠ **它确实随包分发**（`package.json` 的 `files` 里有 `kit/drafts`）——
>   分发的是本项目自己的契约，⛔ 不是给别的项目复用的模板。
>
> ⚠ **本册的读数是"某一刻"的**：模块变了要跟着改；⛔ 别照抄旧册去审新代码。

---

## 索引

| 模块 | 覆盖的路径 | 简报 | 现状 |
|---|---|---|---|
| 判据族（`scripts/`） | `scripts/check-*.mjs` | [`scripts.md`](./scripts.md) | ✅ 已写 |
| 共享纯函数（`src/shared/`） | `src/shared/*.ts` | [`shared.md`](./shared.md) | ✅ 已写 |
| 服务端（`src/server/`） | `src/server/*.ts` | [`server.md`](./server.md) | ✅ 已写 |
| 编排模块（`src/modules/`） | `src/modules/*.ts` | [`modules.md`](./modules.md) | ✅ 已写 |
| 预设契约（`preset/dsh-hob/`） | `workflow.toml` · `spec/` · `gen/` | [`preset.md`](./preset.md) | ✅ 已写 |

> ⚠ **五页全部写完（2026-11-18）**：本索引不再有「未机器化」行。
>   ⚠ 但那**不等于**「这五个模块都被判据守住了」—— 简报是**给人看的审查入口**，不是机检。
>   按 `docs/audit/business-logic-review/STATUS.md` 的同一口径：档位只在有判据时才叫「已绑定」；
>   本页的 `✅ 已写` 只表示「指过来有一页纸可看」。

---

## 与其它文档的分工（⚠ 别重复写）

| 想知道 | 看哪 |
|---|---|
| **某条规则在哪判**（函数级） | `kit/drafts/judgement-index.md`（41 个判定函数的唯一地图） |
| **某个判据族守什么**（族级） | `scripts/check-family-catalog.json`（每族一句话） |
| **审这块时该看什么**（人级） | **本目录** |
