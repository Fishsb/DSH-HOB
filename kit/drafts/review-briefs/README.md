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
| 共享纯函数（`src/shared/`） | `src/shared/*.ts` | 待写 | ⚠ 未机器化 |
| 服务端（`src/server/`） | `src/server/*.ts` | 待写 | ⚠ 未机器化 |
| 编排模块（`src/modules/`） | `src/modules/*.ts` | 待写 | ⚠ 未机器化 |
| 预设契约（`preset/dsh-hob/`） | `workflow.toml` · `spec/` · `gen/` | 待写 | ⚠ 未机器化 |

> ⚠ **「未机器化」这一列不是在说「不用写」** —— 它说的是「这一页还没有，所以审这块时
>   没有一张一页纸可看」。⚠ 按 `docs/audit/business-logic-review/STATUS.md` 的同一口径：
>   **缺就标出来，⛔ 不许留空让人以为"不需要"**。

---

## 与其它文档的分工（⚠ 别重复写）

| 想知道 | 看哪 |
|---|---|
| **某条规则在哪判**（函数级） | `kit/drafts/judgement-index.md`（41 个判定函数的唯一地图） |
| **某个判据族守什么**（族级） | `scripts/check-family-catalog.json`（每族一句话） |
| **审这块时该看什么**（人级） | **本目录** |
