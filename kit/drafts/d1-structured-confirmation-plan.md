# D1 结构化确认 · 执行方案（2026-11-25）

> 决策已定：**D1 = B**（批准/验收改为工具内弹选项，用户点选即可）；PEND-001 = C（接受留档）；PEND-002 = 挑高优先级立项。
> 本方案只写怎么做与验收方式，不改任何产品内容。

## 一、目标

用户不再需要手打「批准 CHG-02 第 5 版」这类回执；工具在需要确认时直接向用户弹选项，把用户点选的结果连同可核对凭证落进账本：

- `decision.confirmation_via = "user-questions"`（与既有 `ask-user-question` 同一封闭集，新增值须显式登记）；
- `decision.confirmation_ref = <宿主返回的 answer/ask id>`（工具侧只能回填宿主给的 id，⛔ 不许自造）；
- `decision.source` 由工具生成（「用户在选择项中点选：批准 …」），⛔ 不再解析自然语言。

## 二、落点

| 层 | 改动 | 说明 |
|---|---|---|
| 契约 | `preset/dsh-hob/spec/reply.md` 的 G1/G2 gate 块 | 允许「工具内选择项确认」；固定回执降为兼容路径 |
| 契约 | `preset/dsh-hob/workflow.toml` 的「禁确认按钮」条款 | 改为「禁止替用户决定；允许由工具发起选择项确认」 |
| 工具 | `src/modules/approval-tool.ts` | 新增 `confirmationMode: 'ask'`：先经宿主提问服务取答案，再落账；失败 fail-closed |
| 依赖 | `src/preset/tools.ts` | 把 `userQuestions.ask` 包成 `askUserOf(exec, payload)` 注入 approve 工厂 |
| 工具 | control 的 accept / close-delivery / waive | 同样走 ask；答案 id 写进 ACC / closure 的 `confirmation_ref` |
| 判据 | `shared/stage-controls.ts` | 声明了 `confirmation_via` 的单元，`confirmation_ref` 必须非空（C-22 增一条） |
| 机检 | `scripts/check-stage-controls.mjs` | 无 ref 的声明 ⇒ 红；ref 存在 ⇒ 绿；ask 失败 ⇒ 不落账 |

## 三、流程（以 G2 批准为例）

1. 模型调 `hob_pipeline_approve { artifactId, revision, selectedOption, confirmationMode: 'ask' }`；
2. 工具调宿主 `userQuestions.ask`：问题「是否批准 CHG-02 第 5 版（路径 A）」；选项「批准 / 要求修改 / 暂不处理」；
3. 用户点选 ⇒ 宿主返回 `{ selected, questionId/answerId }`；
4. 工具校验点选与 decision 一致（不一致 ⇒ 拒）；
5. 落账：`decided_by=user`、`source=用户点选…`、`confirmation_via=user-questions`、`confirmation_ref=<answerId>`；
6. 无提问服务 / 用户取消 / 超时 ⇒ 返回可读原因，不落账（fail-closed）。

## 四、验收

- 真机：开关打开后，G1/G2/G5 各走一次，用户全程只点选，不输入任何回执文本；
- 机检：
  - 声明 `confirmation_via` 无 `confirmation_ref` ⇒ 红（负向）；
  - ask 抛错 / 用户取消 ⇒ 账本无新 decision（负向）；
  - 点选与 decision 不一致 ⇒ 拒；
  - 兼容路径（固定回执）仍可用（正向）。
- 回滚：`confirmationMode` 缺省即旧路径，删开关即可回到现状。

## 五、风险

| 风险 | 处置 |
|---|---|
| 提问服务缺席时把「没问成」当「用户同意」 | 直接 fail-closed，返回可读原因 |
| 模型伪造 answerId | 只接受宿主返回值；机检对「声明但无 ref」判红；⚠ 本仓无法自证「真问过」，属已知边界 |
| 契约改动影响旧会话 | 固定回执保留为兼容路径；新通道需显式参数 |
| 改契约属产品可见变化 | 本次已获「按推荐执行」授权；方案与开关一并留档 |

## 六、执行顺序

1. `approval-tool` 接 `askUserOf`（先只做 G2）；
2. 契约两处文案（`reply.md` / `workflow.toml`）；
3. 判据 `confirmation_ref` + 机检；
4. G5/G6 扩展；
5. 真机走一遍（需你配合点一次选项）。

## 七、PEND-002 立项（挑高优先级）

从五件待办里选三项高优先级：
1. **构建标识自动化**（`writeDeployLedgerEntry` + 单测）——否则 build 字段下次部署即丢；
2. **提交 5 个文档面改动**（仓库小修即 commit 纪律，当前未提交）；
3. **R-01 旧读数按新 HEAD 复核**（旧数字基于 180951055，HEAD 已 db0c4b6f4）。
其余两项（技术债三组处置、两处残留）属清理类，留档不立项。

## 八、PEND-001 处置（接受留档）

把「门禁最后一环不可达」写成**已知限制**并保留原因：缺历史事件流、且造记录等于造假；
标准表述改为「最多允许一环不可达，且必须留原因与决定者」，⛔ 不改探针链本身。
