# dsh-hob 业务逻辑主审查（REVIEW）

> **审查对象**：dsh-hob 插件全部业务逻辑（主链 / 账本 / 编排 / 策略 / 客户端 / 文档契约六域）
> **审查方式**：六域只读审计 → 主控回源复核 → 本文档汇总（重跑关键探针）→ **t8 第二轮独立复核**（`VERIFICATION.md`）→ 本文档按复核结论订正（§9.6）
> **产出**：本文件是**唯一主审查文档**。六份域报告（`pipeline.md` / `ledger.md` / `dispatch.md` / `policy.md` / `client.md` / `docs.md`）与 `LEAD-VERIFICATION.md` 是它的**证据底稿**，不是它的章节。
> **纪律**：本次审查全程只读。**未修改任何源码 / 配置 / 文档**。唯一写入 = 本文件与各域报告。
> **日期**：2026-11-10
>
> ---
>
> ⚠ **本文件是「审计快照」，不是「修复进度」。** 修复看 **[FIX-RESULT.md](FIX-RESULT.md)**。
>

---

## ⚠ 本文件已拆分为 3 卷（原 210789 字节，超 64KB 读上限）

| 分卷 |
|---|
| [`REVIEW-VOL1.md`](./REVIEW-VOL1.md) |
| [`REVIEW-VOL2-1.md`](./REVIEW-VOL2-1.md) · [`REVIEW-VOL2-2.md`](./REVIEW-VOL2-2.md) · [`REVIEW-VOL2-3.md`](./REVIEW-VOL2-3.md) |
| [`REVIEW-VOL3.md`](./REVIEW-VOL3.md) |

⚠ **拆分的唯一原因是读上限**（`check:gitignore` 的 M 判据），⛔ 不是内容变了。
