# FIX-RESULT 分卷 7

> ⚠ 本文件是 `FIX-RESULT.md` 的分卷（§87–§88：A 方案第 6~7 轮）。
> 原 `VOL6` 超 64KB 读上限 ⇒ 按 M 判据再拆。⚠ **唯一原因是读上限**。

---
## §87 A 方案 **第 6 轮** · 一次批量迁移 + 抓到**键名泄漏**的真缺陷

### 87.1 本轮批量迁了 11 处「操作指引」文案

| 词条 | 场景 |
|---|---|
| `stages.initLedger` | 「在 Hob 会话里让 Hob 先建账本…」 |
| `stages.migrateLedger` | 「需要先按现行格式迁移 `ledger/units/index.toml`…」 |
| `stages.noLedgerAtAll` / `fellBackLedger` | 账本缺失 / 回落说明 |
| `stages.presetOnlyBanner` | 非 Hob 预设的整屏说明 |
| `stages.legacyPipelineReadonly` | 旧管线只读提示 |
| `stages.gate5WaitAccept` / `acceptChoices` | G5 门禁文案 |
| `stages.needHumanAction` / `notInResponse` / `residualUnknown` | 列表与计数说明 |

词条总数：24 → **35**。

### 87.2 ⚠⚠ 抓到真缺陷：**键名直接泄漏到界面**

改完后 `check:stages-dom` 红了一条：

```
✗ S-46 · 首屏残余风险读数缺 残余风险 / 判不出
   实得 "…固有风险：critical（G2 冻结）stages.residualUnknown"
```

⚠ **界面上直接显示 `stages.residualUnknown`** —— 那正是 J-2 明令禁止的形态。

**根因**：我把渲染改成了 `stageText('stages.residualUnknown')`，
但**词典里没加这个键**（我那批词典插入用的是错误的锚点，11 个键一个都没进去）。
⇒ `t()` 取不到 ⇒ 退回键名；我的 `stageText` 兜底也取不到中文 ⇒ **漏出键名**。

⚠⚠ **当时没有任何断言会红** —— 是 S-46 那句**偶然**咬住的。
  如果这句文案不在 S-46 的断言里，这个缺陷会**直接进生产**。

### 87.3 补上断言：**键必须存在**（本轮最重要的产出）

```
④ 源码里每个 stageText('k') 的 k，必须在 ZH 与 EN 两份词典里都存在
   双向：只有 ZH ⇒ 英文界面漏；只有 EN ⇒ 中文界面漏
   反向：词典里有但没人用的键只报不拦（避免误伤刚加待用的）
```

**实测**：

```
✓ J-21 ✓ 词条完整性：源码引用的 33 个 stages.* 键在 ZH 与 EN 两份词典里都存在
删掉 EN 的 residualUnknown ⇒
  ✗ J-21 · 这些键被引用但 EN 词典里没有 ⇒ 英文界面会直接显示键名：stages.residualUnknown
```

### 87.4 写这条断言时又踩了一个坑（第 4 次同类）

第一版切片用 `indexOf('addDictionaryLayer')` 找 EN 块的结束 ——
而那个名字**第一次出现在注释里**（早于词典）⇒ 切片长度 **0** ⇒ `keysEn` 恒空
⇒ 判据报「**33 个键全部英文缺失**」的假红。

⇒ 修法：找 `addDictionaryLayer(` 的**调用**，⛔ 不是第一次出现这个名字。

⚠ 这是本会话**第四次**「扫到了自己的说明文字」：
  §70.2（扫到自己输出行）→ §73.4（D-150 扫到自己注释）→ §82.3（J-21 数到注释里的 `t(`）→ 本轮。
  **纪律（已升级为硬性）**：任何「扫源码数/切片」的判据，**一律先剥注释、再找精确的调用形态**。

### 87.5 验证

```
check:client exit=0（54/54，+键完整性）· check:stages-dom exit=0（146/146）
check:config exit=0 · check:pipeline exit=0
typecheck exit 0 · build OK
```

### 87.6 进度

| 项 | 第 5 轮末 | 本轮末 |
|---|---|---|
| 词条键 | 24 | **35** |
| 已迁渲染点 | 52 | **63** |
| 剩余内联文案（约） | 178 | **约 165** |

⚠ 本轮速度提升到 **11 处/轮**（前几轮 ~10），但**没有牺牲验证**：
  每批改完都跑 `check:client` + `check:stages-dom` + `build`，且新加了键完整性断言。

⇒ 按 11~15 处/轮，剩余 165 处约需 **11~15 轮**。


---

---

**文档结束。**
