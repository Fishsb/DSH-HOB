# 主控独立复核（Lead 回源验证）

> 本文件不是域审计报告，而是**主控对 pipeline.md 关键结论的独立回源验证**。
> 目的是在汇总前先确认「域报告说的到底成不成立」，避免把误判带进主文档。
> 验证方式：Node 24 直跑 src/shared 纯函数（.ts 直接 import，不写盘），探针在 /tmp/lead_probe*.mjs。
> 验证日期 2026-11-10。**未修改任何源码/配置/文档**。


---

## ⚠ 本文件已拆分为两卷（原 80KB 超 64KB 读上限）

| 分卷 | 内容 |
|---|---|
| [`LEAD-VERIFICATION-VOL1.md`](./LEAD-VERIFICATION-VOL1.md) | 结论速览 + §1–§N（前段） |
| [`LEAD-VERIFICATION-VOL2.md`](./LEAD-VERIFICATION-VOL2.md) | 后段章节 |

⚠ **拆分的唯一原因是读上限**（`check:gitignore` 的 M 判据），⛔ 不是内容变了。
⚠ 本文件是**审计阶段**（2026-11-10）的复核记录，**未修改任何源码**。
