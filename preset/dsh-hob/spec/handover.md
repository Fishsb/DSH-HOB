# 交付规约 · 行为规格

> ⚠ 机读骨架在 `workflow.toml` 的 `[[rule]]` / `[[invariant]]`；本文件是散文解释，两边用 `id` 对应。

## 六字段证据

每次交付必须带**六字段证据**（条目里点名的那六项）。缺字段 = 未交付，⛔ 不许用"我做了"顶替。

## 预算（三条，缺一不许开单）

1. **不开没写预算的派单**：预算 = 这个会话可以花多少次工具调用 + 这一件跨会话最多几轮。
   ⚠ 预算写在**指令里**，⛔ 不许让 developer session 自己猜。
2. **收尾套件要求的检查不计入预算**。
3. ⛔ **绝不许拿预算当理由去砍一项本该跑的检查** —— 一个"逼着把未验证写成已验证"的预算，
   比没有预算更糟。

## 不可派的那几类

重启 · 提交 · 别的项目 · 真实 profile —— 这几件事**不派**。

## 六条交付不变量（`CONSTITUTION.md` 里逐条有 `checked_by`）

## Pipeline v3 阶段反馈

技术验证独立于产品验收。Verify the approved requirements and risk controls against raw readings. This is not product acceptance.
产品验收由用户决定。The user decides whether the verified result meets the original goal and accepted trade-offs.
交付收口按风险启用。Release or mark the accepted result, according to risk-derived closure mode.

测试通过证明技术条件满足，用户是否接受产品行为和取舍仍然是另一件事。
**不可逆发布或高风险交付必须走加强门禁。**

Risk is derived, not declared: hard triggers and the ten dimensions (`scope`, `severity`,
`reversibility`, `detectability`, `uncertainty`, `changeSurface`, `dependencies`,
`verificationMaturity`, `recoveryTime`, `exposure`) raise the floor; a severe single
dimension cannot be averaged away. Record the derived `risk_inputs_digest`; never invent it.

Hard triggers are facts, not labels. Every declared trigger needs its own
`trigger | fact | affected | evidence | mitigation | residual` line. Missing any
field is undecidable, never a low-risk shortcut. Risk assessments bind the plan's
scope, dependency, delivery and acceptance facts through `risk_binding_digest`;
when those change, the old assessment is stale and must be repeated.

Task risk is a separate layer. Each v3 task declares `task_risk` plus its reasons,
touched surfaces and any irreversible actions. High or critical work must say whether
it needs splitting, isolation, independent review or serial execution, and carries
review evidence and a rollback plan where applicable. Two tasks writing the same path
cannot run in parallel without an explicit serial dependency.

G6 binds the accepted chain, the exact risk assessment it used, and the residual-risk
decision; a skipped closure still leaves a recorded reason and decision. A passed
technical verification for a high-risk plan also carries one risk-control reading per
hard trigger, because tests passing do not prove a control works.

- `delivering-is-not-doing` —— 投递不等于做完；
- `creating-is-not-delegating` —— 建会话不等于派活；
- `result-is-not-acceptance` —— 回传不等于验收。
- `implementation-is-not-convergence` —— 实现不等于收敛；
- `test-pass-is-not-product-acceptance` —— 测试通过不等于产品验收；
- `claim-requires-reading` —— 没有读数不能陈述为事实。

## 问用户的四个条件 / 不问的五类

⚠ 以 `workflow.toml` 与 `preset-dsh-hob.patch.yml` 正文为准；本节只记"有这回事"与去向。

## 两种对象

有限工作（六阶段）与长期能力（只记最近一次真实读数、**无终态**）**永不混表**。
