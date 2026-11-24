# M2 独立验收报告（副本账本 · 非实现方）

- 验收方：独立会话 `m2-independent-verifier`（与实现方不同上下文）
- 构建产物：`lib/BUILD-STAMP` commit=`1a3c521`（dirty=false）
- 结论：**PASS —— 30/30 条断言通过，无一条不成立**

## 六项要求与读数

| # | 要求 | 读数 | 判定 |
|---|---|---|---|
| 1 | 复制账本 | 164 文件 / 1,498,402 字节，源与副本一致；全量 sha256 清单前后一致 | PASS |
| 2 | 技术验证落账 | `{"ok":true,"status":"applied","applied":2}`，EVD-001(command/exit 0) + VER-001(pass, evidence_refs=[EVD-001]) | PASS |
| 3 | 验收门禁 | `{"ok":true}`（无 ACC ⇒ 首条验收分支，且已有 pass VER） | PASS |
| 4 | 产品接受 | `{"ok":true,"status":"applied","applied":1}`，ACC-001=pass | PASS |
| 5① | 无 VER 的任务 | `{"ok":false,"reason":"拒绝：TSK-12 还没有通过的技术验证（VER pass）…"}` | PASS |
| 5② | staleAcceptanceOf | true / false（rev 不一致/一致） | PASS |
| 6 | 坏档隔离 | recovered 点名隔离路径；隔离件 sha256 与原坏档逐字节一致（60 B） | PASS |

## 关键机制读数

- TSK-01 **没有 built_by**，实现者由最近 returned RUN 回退：`session-4c58…`；verifier=`session-verifier-x`（不同）⇒ 独立性成立。
- 首条验收路径：`acceptanceGateOfLedger` → `firstAcceptanceReason`（任务须 built 且已有 pass VER）。
- 反证（补充抽查）：把 verifier 设成实现者本人 ⇒ 写入层 **C-25 硬拒**，VER 不落盘，门禁继续拒绝；未发现可绕过的独立性缺口。
- 副作用：副本新增 3 份投影备份并按 keepBackups=20 裁旧；源账本未被改动（清单 sha256 一致）。

## 待跟进（不构成缺陷）

- TSK-01 缺 `built_by`：当前靠 RUN 回退，判据仍 fail-closed；建议后续把实现者写回账本字段，减少对运行态的隐含依赖。
- 可在仓库回归中固化该验收脚本（本次未改仓库）。

## 复跑方式

从源账本重新复制一份副本，重跑验收方留下的三个脚本（首次写入读数；重跑会走幂等 skipped）。
