# 02-ledger · 分卷 1

> ⚠ 本文件是 `fix/02-ledger.md` 的**分卷**（原文件超 64KB 读上限，
> 按 `check:gitignore` 的 M 判据处置：**整块搬走 + 原位留指针**，⛔ 不是压缩）。
> 主文件：`docs/audit/business-logic-review/fix/02-ledger.md`。

---

# 修复规格 · 账本写入守卫与运行态投影

> 覆盖：**T-01**（index.toml 重复计入）/ **R-18**（removeUnitBlock 孤儿块）/ **O-33**（readToml 吞解析失败）/
> **O-34**（taskGraphOf 用全部 change）/ **T-02**（四套账本健康判据 → 单一入口）/ **L-04**（两份 TOML 解析器）
>
> **纪律声明**：本文件是**规格**，不是实施记录。审计阶段未修改任何源码；
> 本文所有「改法」都是**待执行的形状**，不代表已经落地。
> 行号以**当前工作树源码实测**为准（2026-11-10 复核），与 REVIEW.md 的差异已逐条标注。

## 怎么读这份文档

每条修复固定七要素：

| 段 | 含义 |
|---|---|
| ① 缺陷编号与位置 | 主文档编号 + `文件:行号`（以源码实测为准） |
| ② 改什么 | 文件 / 函数 / 行为，一句话 |
| ③ 具体改法 | 可落地到代码形状；引用现有函数名、参数、返回类型 |
| ④ 依赖与冲突 | 必须先做哪条 / 必须同批 / 会与哪条打架 |
| ⑤ 验证方式 | 可执行命令或断言 **+ 负向对拍**（把它守的实现改坏 ⇒ 必须红） |
| ⑥ 回退方式 | 出问题时怎么退回去 |
| ⑦ 改动面等级 | 局部 / 跨模块 / 需宿主配合 |

## 排序依据（团队纪律）

先修「让失败不可观测」的，再修缺陷本身。本文件 6 条的次序：

| 序 | 编号 | 为什么排这里 |
|---|---|---|
| **1** | `T-01` + `O-33`（**合并一次改动**） | 同一个函数体内的两处；且 `O-33` 让「账本已坏」在守卫眼里等于「账本为空」⇒ 后面所有修复都无法被验证 |
| **2** | `L-04`（解析器合并） | `O-33` 的根因之一；不合并则任何「严格解析」都会在宽松读路径上被绕过 |
| **3** | `T-02`（单一入口） | 四出口不同结论让「修好了没有」无法判定；`T-05` 的死锁挂在它上面 |
| **4** | `R-18`（孤儿块） | 投影写坏账本；与 `T-07`（事务化）同批最省事，但可独立先修 |
| **5** | `O-34`（superseded） | 纯判定口径，改动极小，但**必须在 `T-02` 之后**（否则新入口会把旧口径固化） |

---

# 1. `T-01` + `O-33` · 合并改动（同一文件、同一函数）

> ⚠ **团队要求：这两条必须合并成一次改动。** 理由：两者都在 `src/server/hob-write.ts` 的
> `checkLedgerUnitWrite` / 其内部 `readToml`（`:1041-1043`）；分两次触碰会在中间留下
> 「读得出重复、但读不出解析失败」或反之的半修状态，而这两个半修状态都会**继续放行坏账本**。

## 1.1 缺陷编号与位置

| 编号 | 位置（源码实测） | REVIEW.md 位置 | 差异 |
|---|---|---|---|
| `T-01` | `src/server/hob-write.ts:1051-1056`（`rel` + `merged`）、`:1057-1061`（重复 ID 判定） | `:1044-1056` / `:1057-1061` | 行号 +7 漂移（`shardNames` 前多了注释），**逻辑未变** |
| `O-33` | `src/server/hob-write.ts:1041-1043`（`readToml` 的 `catch { return [] }`）；同型第二处 `src/modules/tools.ts:788-790`（`parseOne`） | `:1042-1043` | 行号一致；**新增**第二处同型缺陷（`tools.ts:789`），REVIEW 未列 |

## 1.2 改什么

`src/server/hob-write.ts` 的 `checkLedgerUnitWrite`：

1. `readToml` 从「解析失败 ⇒ 空数组」改为「四态：`ok` / `missing` / `unparseable` / `unreadable`」，
   并在出现后两档时**拒绝本次写入**，同时**保留 `T-06` 想要的语义**——
   「既有行缺口只报不拦」不适用于「读不出既有行」。
2. `merged` 的组装改成「**每个物理文件最多被读一次**」，并**保持 index 在前**的原有顺序。

## 1.3 具体改法（代码形状）

### 1.3.1 `readToml` 四态化（`O-33`）

当前（`hob-write.ts:1041-1043`）：

```ts
const readToml = (name: string): Array<Record<string, unknown>> => {
  try { return parseUnitsToml(readFileSync(join(unitsDir, name), 'utf8')) as Array<Record<string, unknown>> } catch { return [] }
}
```

改成（**复用本文件既有的 `TargetRead` 三态风格**，见 `:573-576`）：

```ts
/**
 * 读一份既有账本源文件的四态。
 * ⚠ 与 TargetRead 同款纪律：「不存在」与「读不出来」不许合并成同一个值
 *   —— 前者是"首次创建"，后者可能是"账本已坏"，处置完全不同。
 */
type UnitSourceRead =
  | { kind: 'ok'; units: Array<Record<string, unknown>> }
  | { kind: 'missing' }
  | { kind: 'unparseable'; name: string; why: string }
  | { kind: 'unreadable'; name: string; code: string; why: string }

const readUnitSource = (name: string): UnitSourceRead => {
  let src: string
  try {
    src = readFileSync(join(unitsDir, name), 'utf8')
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') return { kind: 'missing' }
    return { kind: 'unreadable', name, code: code ?? 'unknown', why: String((e as Error)?.message ?? e) }
  }
  try {
    return { kind: 'ok', units: parseUnitsToml(src) as Array<Record<string, unknown>> }
  } catch (e) {
    // ⚠ 解析失败不是"这个分片没有单元"：把它当空集会让下面所有门禁一起失明。
    return { kind: 'unparseable', name, why: String((e as Error)?.message ?? e) }
  }
}
```

> **为什么必须有 `unreadable` 这一档**：`readFileSync` 的 `EACCES` / `EISDIR` 与 `ENOENT`
> 都走 `catch`；只分 `missing` 会把「权限坏了」读成「首次创建」，与本文件 `:1582-1593`
> 已明令禁止的那种形态（「读不出来必须拒写」）直接冲突。**这是本改动必须一并做的原因。**

### 1.3.2 `merged` 组装（`T-01`）

当前（`hob-write.ts:1051-1056`）：

```ts
const rel = file.slice('ledger/units/'.length)
const merged = [
  ...readToml('index.toml'),
  ...shardNames.filter((n) => n !== rel).flatMap(readToml),
  ...(mode === 'append' ? [...readToml(rel), ...incoming] : incoming),
]
```

**缺陷精确形态**：`rel === 'index.toml'` 时，第一项与第三项**读的是同一个文件**；
`shardNames` 只匹配 `^unit-[^/]+\\.toml$`（`:1047`）**不含 `index.toml`**，
所以第二项**不会**把 `index.toml` 排除掉。⇒ `index.toml` 的每条旧单元在 `merged` 里出现两次。

改成（**每文件最多读一次**的不变量）：

```ts
const rel = file.slice('ledger/units/'.length)
const relIsIndex = rel === 'index.toml'
/**
 * 不变量：**每个物理文件在 merged 里最多贡献一次**。
 *   旧实现让 index.toml 贡献两次：第一项 readToml('index.toml') + 第三项 readToml(rel)；
 *   而 shardNames 只匹配 ^unit-.*（不含 index.toml）⇒ 第二项排不掉它。
 *
 * 因此正确形状是「rel 是 index.toml 时**第一项不读**」，
 *   而不是「第三项去掉旧内容」—— 后者修得了 append、修不了 overwrite（附录 A-4 实测）。
 */
const selfRead = readUnitSource(rel)                  // 本项目要写的那一份（index 或 unit-NN）
/** 关键：rel 是 index.toml 时这里**不读**，否则它与第三项是同一份文件。 */
const indexPathRead = relIsIndex ? undefined : readUnitSource('index.toml')
const others = shardNames.filter((n) => n !== rel).map(readUnitSource)

const merged = [
  ...(indexPathRead?.kind === 'ok' ? indexPathRead.units : []),
  ...others.flatMap((r) => (r.kind === 'ok' ? r.units : [])),
  ...(mode === 'append'
    ? [...(selfRead.kind === 'ok' ? selfRead.units : []), ...incoming]
    : incoming),
]
```

> ⚠ **不能用「`rel === 'index.toml'` 时从第三项里排除旧内容」这一种写法**——实测（附录 A-4）：
> 那样能让 append 不再重复，但 **overwrite 到 index 仍会重复**。
> **正确的不变量是「每个物理文件最多被读一次」，不是「去掉某一项」。**

> ✅ **已实测**（附录 A-15）：把上述形状逐字复制进探针跑 5 个场景，
> 现状 3/3 报 DUP、修正后 **0/3 报 DUP**，两个分片回归场景无变化。

### 1.3.3 拒绝分支（`O-33` 的出口）

在 `merged` 组装之后、`unitShapeProblems` **之前**插入：

```ts
const broken = [indexPathRead, ...others, selfRead]
  .filter((r): r is Extract<UnitSourceRead, { kind: 'unparseable' | 'unreadable' }> =>
    r !== undefined && (r.kind === 'unparseable' || r.kind === 'unreadable'))
if (broken.length > 0) {
  const list = broken.map((r) => r.kind === 'unparseable'
    ? `${r.name}：不是现行 [[unit]] 格式（${r.why}）`
    : `${r.name}：读不出来（${r.code}）`).join('；')
  return refuse(
    file,
    broken.some((r) => r.kind === 'unparseable') ? 'ledger-source-unparseable' : 'read-failed',
    `拒绝：账本里有 ${broken.length} 份既有源文件读不出单元：${list}`
      + '\n  ⇒ 这不是「这些分片是空的」：它们是内容读不出来。'
      + '\n  ⇒ 先把那几份修好（或从 backups/ 恢复），再写。',
  )
}
```

⚠ **`RefuseReason` 需要新增一个值**（`hob-write.ts:352-393` 的联合类型）：
⚠ **`RefuseReason` 需要新增一个值**（`hob-write.ts:352-393` 的联合类型）：

```ts
  | 'ledger-source-unparseable'
```

（`unreadable` 档复用既有的 `read-failed`，不需要新值。）

**与 `T-06` 的关系（关键）**：`T-06` 要求「本次新增/改动的行必须合法，既有行缺口只报不拦」。
本拒绝分支**不与它冲突**——`T-06` 说的是「既有行**语义**不合法」（如 `status="settled"`，
`kind` 认识、行解析得出来），而本分支说的是「既有行**读都读不出来**」。
判据对象不同：前者是已解析的字段值，后者是解析动作本身。
⇒ **必须把这条边界写进代码注释**，否则后续实现会把两者合并成一个 `refuse`，
回到「整本不健康就一行都写不进」的死锁。

### 1.3.4 顺带修：`pipelineWriteProblems` 的 `before` 复用已读结果

当前（`:1078-1081`）在 `problems` 里**又重算了一遍**读盘：

```ts
...pipelineWriteProblems(
  [...readToml('index.toml'), ...shardNames.filter((n) => n !== rel).flatMap(readToml)],
  merged,
),
```

改成复用上面已读好的结果（**避免第三次读盘 + 避免两处口径**）：

```ts
...pipelineWriteProblems(
  [...(indexPathRead?.kind === 'ok' ? indexPathRead.units : []),
   ...others.flatMap((r) => (r.kind === 'ok' ? r.units : []))],
  merged,
),
```

> 现状这一行**也**受 `T-01` 影响：它对 `before` 只算一遍（正确），但 `merged` 里算了两遍；
> `pipelineWriteProblems` 用 `Map` 建 `beforeById`（后者覆盖前者），两份内容相同所以**碰巧**正确。
> 改成复用后这个巧合消失，行为不变——但**修掉了一个"靠巧合正确"的点**。

## 1.4 依赖与冲突

| 关系 | 说明 |
|---|---|
| **必须同批** | `T-01` 与 `O-33` **同一次提交**（同一函数体） |
| **必须先做** | 无。本改动是**第一优先** |
| **会打架** | `T-06`（既有行只报不拦）—— 见 §1.3.3 边界声明；**必须同批写进注释** |
| **会打架** | `R-19`（白名单允许 `ledger/units/` 子路径）—— 不影响本改动，但 `merged` 只合并 `^unit-` 分片，**子路径里的单元两边都看不见**；`R-19` 修好后本改动自动正确 |
| **被本改动解锁** | `T-02`、`R-18`、`T-05` 的验证都依赖「写入不再因 `index.toml` 而恒拒」 |

## 1.5 存量影响：真实账本里 `index.toml` 已有单元怎么办

> ⚠ captain 点名必须回答的存量问题。**先说实测，再给可执行步骤。**

### 1.5.1 实测：哪些账本会被冻

扫 `/home/lk/.dsh/hob-ledgers` 与 `/home/lk/FF/.hob-ledgers` 全部账本的 `index.toml` 内 `[[unit]]` 数：

| 账本 | `index.toml` 里的单元数 | 是否被冻 |
|---|---|---|
| `hob-ledgers/dsh-hob` | **0** | 否（单元全在 `unit-01..07.toml`，共 292 条） |
| `hob-ledgers/prompt-enhancer-release` | **19** | **是** |
| `...prompt-enhancer-release.backup-before-ledger-contract-20261108` | **13** | 是（备份账本，只读，不修） |
| `...prompt-enhancer-release.backup-before-ledger-contract-20261108b` | **16** | 是（备份账本，只读，不修） |

**在 `prompt-enhancer-release` 副本上实测三条写入路径**（附录 A-1）：

```
A) append index.toml            -> ok:false  reason: ledger-duplicate-id
                                   （报「R-001 重复」，真因是守卫把 index 数了两遍）
B) append 新分片 unit-new.toml  -> ok:false  reason: ledger-structure-invalid
                                   （被 R-003 status=proposed / CHG-346 status=draft 拦）
C) 同上但 validateLedgerStructure:false -> ok:true
```

⇒ **真实形态比「只有第一次写能成功」更糟**：这本账**三条正常路径全断** ——
index 被 `T-01` 冻、新分片被既存坏词拦、唯一能写的是豁免结构校验的那条路（`T-06` 要删掉它）。

### 1.5.2 修复后会自动解冻吗

**不会。** 修 `T-01` 只让「index 里已有单元时仍能写入」成立；
`prompt-enhancer-release` 还有 2 条既存坏词（`S-0`），修复后**仍然**被
`unitShapeProblems` 拦在同一条 `ledger-structure-invalid` 上（附录 A-1 B 行）。

⇒ **存量账本需要一次显式的「解冻」动作**，与 `T-01` 的修复分开执行。

### 1.5.3 三条解冻路线（含实测）

| 路线 | 做法 | 实测 | 评价 |
|---|---|---|---|
| **R1 · 手工搬迁** | 纯 fs：把 `index.toml` 的 `[[unit]]` 段整段搬进 `unit-legacy.toml`，`index.toml` 只留注释 | 搬完 index=0 单元、分片在；**随后写新单元仍被坏 status 拦**（附录 A-2） | 只解 `T-01` 的冻，**解不了坏词** |
| **R2 · 先修坏词再搬** | ① 修 `R-003.status` / `CHG-346.status` 到封闭集；② 再搬 | 见附录 A-5：`migrate` 只读 index，分片里的坏词够不到 | **推荐**，但①受 `O-37` 阻塞 |
| **R3 · 一次性专用迁移脚本** | 新增 `scripts/unfreeze-units-index.mjs`（**未做**，见 §1.5.4）：读 index → 按 `[[unit]]` 切块 → 写 `unit-NN.toml` → index 只留头注释；**同时**按内置映射修 `S-0` 旧词 | 未实现（**未验证**） | 与既有 `scripts/split-ledger-index.mjs`（`:1-105`）同款形态，可复用其切块逻辑 |

### 1.5.4 推荐的可执行步骤（R3 脚本 + R2 顺序）

⚠ **执行顺序不可换**：先解 index 的冻 → 再让 `migrate` 够得到坏词 → 最后验。

```bash
# 0) 先落不可变副本（本仓 R-17：副本必须先于重写）
cp -a "$LEDGER/ledger/units" "$LEDGER/archive/$(date +%F)-units-before-unfreeze/"

# 1) 【T-01 修复上线后】把 index 里的单元原样搬进分片（纯 fs，不经 write_hob）
node scripts/unfreeze-units-index.mjs --ledger "$LEDGER" --apply

# 2) 用 hob_ledger_migrate 修落进分片里的旧词
#    ⚠ 依赖 O-37 修复：migrate 目前只读 index.toml，够不到分片
#    ⇒ 在 O-37 修好前，第 2 步必须手工改，且改完用 write_hob 的 dryRun 验一遍

# 3) 验：就绪度必须 ready 且 gapCount===0
node -e "import('./src/modules/tools.ts').then(m=>{const r=m.ledgerReadinessOfRoot(process.argv[1]);console.log(r.state,r.gapCount)})" "$LEDGER"
```

**⚠ 路线 R1/R3 的已知坑（实测，必须写进脚本断言）**：

1. **搬迁必须「移」而不是「复制」**。若 index 与分片同时有同一条单元，
   两套读路径都会**各返回两份**（附录 A-3：`readLedgerUnits` → `["R-001","R-001"]`，
   `readProjectionUnits` 同样两份），而 **`readiness` 却报 `ready`**（`n:2, gaps:[]`）——
   因为 `ledger-readiness.ts:284` 调 `unitShapeProblems(u)` **没有传 `seenIds`**，
   重复 ID 判据根本没跑。
   ⇒ 脚本必须断言「搬迁后：index 的单元数 === 0」且「id 集合大小 === 单元总数」。
   ⚠ 这条**同时是 `T-02` 的输入**：统一入口必须把 `seenIds` 传进去（见 §4.3）。
2. **搬迁后 `writeHobFile` 的 shrinkGuard 会拒**（overwrite index 到几乎为空）。
   实测（附录 A-2 步骤 1/2）：`shrinkGuard: 0.5` 与 `0` **都**先被结构校验拒，
   说明缩水守卫在本例里不是第一道；但纯 fs 搬迁后若走 `writeHobFile` 改写 index，
   仍会撞 `shrinking`。⇒ 脚本走**纯 fs**（不经 `writeHobFile`），
   **不要**为迁移把常驻代码的 `shrinkGuard` 调低。
3. **坏词必须一起修**，否则第 3 步仍 `unhealthy`。

### 1.5.5 `hob_ledger_migrate` 够不到分片（`O-37`，本规格的硬依赖）

实测（附录 A-5）：

```
坏 status 在 index 里 → migrate 只改 index.toml ⇒ 修好了（S-0 消失）
坏 status 在分片里     → migrate 读不到 ⇒ readiness 仍 unhealthy（S-0:CHG-346 还在）
```

⇒ **`O-37` 是解冻路线的硬依赖**。`REVIEW.md §7.4 D-21` 已拍板「采 A：遍历全部分片」。
本规格登记它，**不展开设计**（属另一条修复项）。

## 1.6 验证方式

### 机检（建议加进 `scripts/check-ledger-write-policy.mjs`）

```
T01-1  index.toml 有 1 条单元时 append 一条合法单元      ⇒ ok:true        （正向）
T01-2  index.toml 有 3 条单元时 overwrite 同一批 + 新增 1 条 ⇒ ok:true     （正向，覆盖 overwrite 分支）
T01-3  分片有 1 条时 append 到该分片                    ⇒ ok:true        （对照，回归）
T01-4  拒绝原因不得再报 ledger-duplicate-id（当重复源于同一文件被读两次）  （原因不撒谎）
O33-1  任一既有分片不可解析 ⇒ 任意写入必须 ok:false                        （正向）
O33-2  该拒绝的 reason 必须是 ledger-source-unparseable（⛔ 不是 ledger-structure-invalid）
O33-3  既有分片含"语义非法但可解析"的行（status=settled）⇒ 行为保持不变（仍按 T-06 口径）
O33-4  既有分片 EACCES ⇒ reason=read-failed，文案含"读不出来"、不含"不存在"
```

### 负向对拍（缺一不可）

| 对拍 | 把实现改坏成 | 期望 |
|---|---|---|
| **N-T01-1** | `merged` 改回「每个文件读两次」 | `T01-1` / `T01-2` 必须红 |
| **N-T01-2** | 只做「`rel==='index.toml'` 时排除第三项」这一种写法 | `T01-2`（overwrite）必须红、`T01-1` 仍绿 ⇒ **证明必须用「每文件只读一次」的不变量** |
| **N-O33-1** | `readUnitSource` 的 catch 改回 `return { kind:'ok', units: [] }` | `O33-1` 必须红 |
| **N-O33-2** | 拒绝分支的 reason 改回 `ledger-structure-invalid` | `O33-2` 必须红 |

### 存量验收（一次性，人工跑一次并留读数）

```bash
for d in "$HOME"/.dsh/hob-ledgers/*/; do
  node -e "import('./src/modules/tools.ts').then(m=>{const r=m.ledgerReadinessOfRoot(process.argv[1]);console.log(process.argv[1],r.state,r.gapCount)})" "$d"
done
# 期望：非备份账本全部 ready/0
```

## 1.7 回退方式

**纯增量**：新增 `UnitSourceRead` 类型与拒绝分支，`merged` 的**内容语义不变**（顺序保持 index 在前）。
回退 = `git revert` 单次提交，无需数据修复。
⚠ **但存量解冻（§1.5.4）不可随代码一起 revert** —— 搬迁动作改了盘上数据。
⇒ 解冻脚本必须在执行前落 `archive/<日期>-units-before-unfreeze/` 副本（步骤 0）。
回退判定：解冻后若发现单元丢失，直接从该副本 `cp -a` 还原。

## 1.8 改动面等级

**局部**（`src/server/hob-write.ts` 单文件 + 一个 `RefuseReason` 联合值）。
存量解冻另算：**跨模块**（新增一个 `scripts/*.mjs`，不动 `src/`）。

---

# 2. `L-04` · 两份 TOML 解析器合并（删宽松版）

> 主文档编号 `R-06`（`REVIEW.md` 附录 A 把 t2 的 `L-04` 归并到 `R-06`）。本节沿用任务书里的 `L-04` 称谓，并标注归并关系。

## 2.1 缺陷编号与位置

| 编号 | 位置（源码实测） | 说明 |
|---|---|---|
| `L-04` / `R-06` | **严格版**：`src/shared/stages-index.ts:222-250`（`parseUnitsToml`）+ `parseStr`:252-256 + `parseArr`:258-275 | 不认识 ⇒ **抛错**，带行号 |
| | **宽松版**：`src/modules/tools.ts:159-210`（`parseLedgerUnitsText`） | 不认识 ⇒ **静默跳过**，从不抛错 |

**两份的实质差异（实测，附录 A-6）**：

| 输入 | 严格版 `parseUnitsToml` | 宽松版 `parseLedgerUnitsText` |
|---|---|---|
| `[meta]` 旧格式表头 | **THROW** `第 1 行：不支持的 TOML 表头` | `[{id:"R-001",…}]`（表头被跳过） |
| `title = 123`（非字符串值） | **THROW** `第 4 行：只支持 "字符串" 与 ["数组"]` | 该字段被**丢弃** |
| `[[unit]]` 前有杂行 | **THROW** `第 1 行：键出现在 [[unit]] 之前` | 该行被**丢弃** |
| 数组未闭合 | **THROW** `文件末尾有多行数组没有闭合` | 该字段被**丢弃** |

⇒ 宽松版**不是"更宽容"，是"更少"**：它把「账本写坏了」表现为「账本少了几条 / 几个字段」，
与 `O-33` 的 `catch { return [] }` 是**同一族错误的两级**（一个丢分片、一个丢字段）。

## 2.2 改什么

删掉宽松版 `parseLedgerUnitsText`；所有读盘路径统一走 `parseUnitsToml` + `unitShapeProblems`。
调用点共 **3 处**（`grep -rn parseLedgerUnitsText src/` 实测）：

| # | 调用点 | 现状 | 改法 |
|---|---|---|---|
| 1 | `src/modules/tools.ts:219`（`readLedgerUnits` 的 `files.flatMap`） | 宽松解析，逐文件无 try | 改用 `parseUnitsToml`；**逐文件 try，失败即抛**（带文件名） |
| 2 | `src/modules/tools.ts:789`（`ledgerLifecycleOfRoot` 的 `parseOne`） | `try { … } catch { return [] }` —— **同 `O-33` 的第二处实例** | 见 §2.3.3 |
| 3 | —（无第三处） | — | — |

> 任务书问「`/ledger-resource` 需要新增的 reason」—— 见 §2.5。

## 2.3 具体改法（代码形状）

### 2.3.1 `readLedgerUnits` 改为「严格 + 带文件名的失败」

当前（`tools.ts:213-220`）：

```ts
export function readLedgerUnits(ledgerRoot: string): LedgerUnitLike[] {
  const unitsDir = join(ledgerRoot, 'ledger', 'units')
  const shards = readdirSync(unitsDir)
    .filter((name) => /^unit-[^/]+\.toml$/.test(name))
    .sort()
  const files = ['index.toml', ...shards]
  return files.flatMap((name) => parseLedgerUnitsText(readFileSync(join(unitsDir, name), 'utf8')))
}
```

改成：

```ts
/**
 * 读整本账的单元（index + unit-*.toml）。
 *
 * ⚠ 严格解析（parseUnitsToml）：任一份源文件不是现行 [[unit]] 格式 ⇒ **抛错**，
 *   错误里带**文件名**与行号。⛔ 不静默跳过那一条 —— 那是"账本少一条"伪装成"账本正常"。
 */
export function readLedgerUnits(ledgerRoot: string): LedgerUnitLike[] {
  const unitsDir = join(ledgerRoot, 'ledger', 'units')
  const shards = readdirSync(unitsDir)
    .filter((name) => /^unit-[^/]+\.toml$/.test(name))
    .sort()
  const files = ['index.toml', ...shards]
  return files.flatMap((name) => {
    const src = readFileSync(join(unitsDir, name), 'utf8')
    try {
      return parseUnitsToml(src) as unknown as LedgerUnitLike[]
    } catch (e) {
      /** ⚠ 抛出**带文件名**的错误：只带行号的报错在"9 个分片"时无法定位。 */
      throw new Error(name + ": " + String((e as Error)?.message ?? e))
    }
  })
}
```

⚠ **这是行为变更**：`readLedgerUnits` 从此**会抛**在以前静默返回少几条的场景。⇒ 必须逐个检查调用点的 catch 行为（下表）。

### 2.3.2 九个 `readLedgerUnits` 调用点的处置

| # | 位置 | 现状 catch | 改后是否安全 | 需要做什么 |
|---|---|---|---|---|
| 1 | `tools.ts:583` `stageGateOfLedger` | `try/catch` ⇒ 「判不出…不推进」 | ✅ **安全**（fail-closed） | 无 |
| 2 | `tools.ts:621` `stageGateAtLedger` | `try/catch` ⇒ `hold` | ✅ 安全 | 无 |
| 3 | `tools.ts:859` `dispatchGateAtLedger` | `try/catch` ⇒ 「判不出 ⇒ 本次不派单」 | ✅ 安全 | 无 |
| 4 | `tools.ts:891` `dispatchGateAtLedger`（plan 分支） | `try/catch` ⇒ 同上 | ✅ 安全 | 无 |
| 5 | `tools.ts:955` `acceptanceGateOfLedger` | `try/catch`（外层） | ⚠ **需确认** catch 后返回什么 | 确认返回 `ok:false` 且带原因 |
| 6 | `tools.ts:1189` `read_contracts` 资源分支 | `try/catch` ⇒ `resource-unreadable` | ✅ 安全 | 无 |
| 7 | `tools.ts:2007` `hob_pipeline_approve` | `try/catch` ⇒ `ledger-unreadable` | ✅ 安全 | 无 |
| 8 | `ledger-resource-route.ts:101` | `try/catch` ⇒ 400 `index-unreadable` | ✅ 安全但**语义粗糙** | 见 §2.5 |
| 9 | `projection-writer.ts:100-112` `readProjectionUnits` | **无 try**（直接抛） | ✅ 已是最严 | 无（它本来就用严格版） |

> ⚠ 第 9 行是对照组：`readProjectionUnits` 用严格版且**不 catch**。实测同一份坏分片下
> `readLedgerUnits` 返回 `["R-001"]`（丢掉坏分片）、`readProjectionUnits` **抛错**（附录 A-6）。
> ⇒ **两条读路径对同一份账本给出不同结论**，这本身就是 `L-04` 的直接证据。

### 2.3.3 `ledgerLifecycleOfRoot` 的 `parseOne`（`tools.ts:788-790`）

当前：

```ts
const parseOne = (name: string): Array<Record<string, unknown>> => {
  try { return parseLedgerUnitsText(readFileSync(join(unitsDir, name), 'utf8')) as Array<Record<string, unknown>> } catch { return [] }
}
```

改成（注意它在外层已有大 `try/catch`，`:786-807`）：

```ts
const parseOne = (name: string): Array<Record<string, unknown>> => parseUnitsToml(readFileSync(join(unitsDir, name), 'utf8')) as Array<Record<string, unknown>>
```

⇒ 解析失败会落到 `:803-807` 的 catch，返回 `state:'invalid'` + `A-4` blocker。
**这是正确的**（账本坏了就不该 active），且**不需要新增分支**。

## 2.4 依赖与冲突

| 关系 | 说明 |
|---|---|
| **必须先做** | 无（可与 §1 独立） |
| **必须同批** | `O-33` 的第二处实例（`tools.ts:789`）**随本节一起改**，否则 `O-33` 只修了一半 |
| **会打架** | `O-33` §1：两边都用严格版后，`hob-write` 与 `readLedgerUnits` 终于**同口径**；但 `O-33` 的 `readUnitSource` 是**四态**、本节是**抛错** —— 不冲突（写侧需要分档、读侧只需 fail-closed） |
| **会打架** | `T-02`：统一入口的输入依赖本节的 `readLedgerUnits` 语义；**先做本节再做 §4** |
| **风险** | 存量坏账本（`prompt-enhancer-release`）会让更多读路径从"静默少条"变成"抛错" ⇒ **必须先跑存量验收**（§1.6 末段）再上线 |

## 2.5 `/ledger-resource` 需要新增的 reason

当前（`ledger-resource-route.ts:100-105`）：

```ts
try {
  const units = readLedgerUnits(root)
  return json(200, readLedgerResource(units, resource))
} catch (e) {
  return json(400, { ok: false, resource, reason: 'index-unreadable', message: String((e as Error)?.message ?? e) })
}
```

**问题**：改后 `readLedgerUnits` 的抛错有三种成因，全被压成 `index-unreadable`：

| 真实成因 | 该给的 reason | 为什么不能合并 |
|---|---|---|
| 文件不存在（还没开账） | `ledger-missing` | 下一步是「去建账」 |
| 解析失败（账本坏了） | `index-malformed` | 下一步是「去修那一行」 |
| 读不出来（EACCES/EIO） | `index-unreadable` | 下一步是「去查权限 / 磁盘」 |

⇒ **新增两个 reason 值**，与 `stages-index.ts:92-106` 的既有常量**同名复用**：

```ts
import { STAGES_REASON_LEDGER_MISSING, STAGES_REASON_INDEX_MALFORMED } from '../shared/stages-index.ts'
// …
} catch (e) {
  const code = (e as NodeJS.ErrnoException)?.code
  const msg = String((e as Error)?.message ?? e)
  if (code === 'ENOENT') {
    return json(400, { ok: false, resource, reason: STAGES_REASON_LEDGER_MISSING,
      message: "账本目录里没有 ledger/units/ ⇒ 先建账（" + msg + "）" })
  }
  /** ⚠ 解析失败的消息里带「第 N 行」或「不支持的 TOML 表头」（parseUnitsToml 的两族）。 */
  if (/第 \d+ 行|不支持的 TOML 表头|多行数组没有闭合/.test(msg)) {
    return json(400, { ok: false, resource, reason: STAGES_REASON_INDEX_MALFORMED,
      message: "账本单元不是现行格式 ⇒ 先修那一行（" + msg + "）" })
  }
  return json(400, { ok: false, resource, reason: 'index-unreadable', message: msg })
}
```

⚠ **不要新增第三族常量的另一个副本**：`STAGES_REASON_*` 已是「阶段接口 / 需求链接口」的共用词表（`stages-index.ts:92-106`）。本路由直接 import 复用，**不重命名、不复制字面量**。

### 2.5.1 `readLedgerResource` 自身也应新增一个 reason（可选，low）

`shared/ledger-resources.ts:46` 的失败 reason 封闭集是 `unknown-resource | unknown-id | not-found`。
旧格式账本（`readLedgerUnits` 返回 `[]` 的场景）会落成 **`not-found`**（"账本里没有 R-001"），
而真因是「账本读不进来」。实测（附录 A-7）：旧格式账本 ⇒ `{ok:false, reason:'not-found'}`。

⇒ 建议新增 `ledger-unreadable` 并由路由层在调用前判断（`readLedgerResource` 是纯函数，拿不到「账本是否读得进」这个事实）。
**等级 low，可延后**；但若不改，「账本坏了」与「这条单元不存在」在 `/ledger-resource` 上**继续不可分辨**。

## 2.6 验证方式

```
L04-1  grep -rn parseLedgerUnitsText src/   ⇒ 必须为 0 命中（函数已删）
L04-2  同一份坏分片下 readLedgerUnits 与 readProjectionUnits 必须同结论（都抛 / 都返回同一条数）
L04-3  readLedgerUnits 抛出的错误消息必须含文件名（如 unit-01.toml）
L04-4  read_contracts 遇到坏分片 ⇒ ok:false 且 reason 与成因匹配（ledger-missing / index-malformed / index-unreadable）
L04-5  九个调用点在坏分片下没有一个返回"成功且空"
```

### 负向对拍

| 对拍 | 把实现改坏成 | 期望 |
|---|---|---|
| **N-L04-1** | 把 `readLedgerUnits` 改回 `parseLedgerUnitsText` | `L04-2` / `L04-5` 必须红 |
| **N-L04-2** | 把 `tools.ts:789` 的 `parseOne` 改回 `catch { return [] }` | `L04-5` 必须红 |
| **N-L04-3** | 把 `/ledger-resource` 的三种 reason 合并回一个 | `L04-4` 必须红 |

## 2.7 回退方式

删函数 + 改 3 处调用点，**纯代码**，无数据影响。回退 = `git revert`。
⚠ 唯一行为面回退风险：存量坏账本会让若干只读接口从「返回少条」变成「400 抛错」。
若上线后发现某本账大面积不可读，**优先修账本**（§1.5 解冻），**不要**把宽松解析器加回来 —— 那等于把 `O-33` 一起退回。

## 2.8 改动面等级

**跨模块**（`src/modules/tools.ts` + `src/modules/ledger-resource-route.ts` + `src/shared/ledger-resources.ts` 可选）。
⚠ 影响九个调用点，**必须逐点核 catch 行为**（§2.3.2 表）。

---

# 3. `T-02` · 四套账本健康判据 → 唯一入口 `ledgerHealthOf`

> **这是 P2「建单一真源」最核心的一条。** 也是本文件改动面最大的一条，见 §3.6 的分步替换计划。

## 3.1 缺陷编号与位置

| # | 出口 | 位置（源码实测） | 实际调用链 |
|---|---|---|---|
| ① | `stageGateOfLedger` | `src/modules/tools.ts:581-591` | `stageControlProblems(units)` = `stageFieldProblems` + `stageApprovalProblems` |
| ② | `stageHealthOfLedger` | `src/modules/tools.ts:711-721` → `stageGateAtLedger(project)` → `stage-controls.ts:1097-1102` | `evaluateGate` 的 project 分支 ⇒ `blockers: stageControlProblems(units)` |
| ③ | `ledgerReadinessOfRoot` | `src/modules/tools.ts:746-761` → `src/shared/ledger-readiness.ts:262-303` | `unitShapeProblems`（**无 seenIds**）+ `stageFieldProblems` + `ledgerClosureProblems`，**无审批** |
| ④ | `/stages.stageHealth` | `src/shared/stages-index.ts:445-465` | `stageControlProblems` + `ledgerClosureProblems`，**无形状** |

### 3.1.1 四出口的分歧实测矩阵（附录 A-8）

同一批夹具、同一台机器、同一时刻：

| 夹具 | readiness | stageGateOfLedger | stageHealthOfLedger | `/stages.stageHealth` |
|---|---|---|---|---|
| **F1** 只有闭环缺口 `L-2` | `unhealthy/1[L-2]` | **PASS** | `ok:true n=0` | `ok:false count=1[L-2]` |
| **F2** 只有字段缺口 `C-5` | `unhealthy/6[C-5x4,RP-4,L-2]` | BLOCK | `ok:false n=5` | `ok:false count=6` |
| **F3** 只有形状缺口 `S-0` | `unhealthy/2[S-0,L-2]` | **PASS** | `ok:true n=0` | `ok:false count=1[L-2]`（**S-0 丢了**） |
| **F4** 只有审批缺口 `C-18` | **`ready/0`** | BLOCK | `ok:false n=1` | `ok:false count=1` |
| **F5** 无缺口 | `ready/0` | PASS | `ok:true` | `ok:true count=0` |

**读法**：

- **F1**：只有闭环缺口 ⇒ ②③ 说健康、① 放行、只有 ④ 报 ⇒ **派活放行但面板说不健康**
- **F3**：只有形状缺口 ⇒ ①②③ 全说健康、④ 报了 L-2 却**漏了 S-0** ⇒ 四个出口**没有一个**报全
- **F4**：只有审批缺口 ⇒ ③ 说 `ready`，①②④ 全 BLOCK ⇒ **`hob_ledger_init` 认为账本已就绪**
- 四份结论**两两都不相同**（除 F5），与 `REVIEW.md §4.7` 的独立复现一致

⇒ 组合差异是**实质性的**，不是写法差异：

| 判据组成 | shape（S-0） | field（C-*） | approval（C-18/19） | closure（L-*） |
|---|---|---|---|---|
| ① `stageGateOfLedger` | 无 | 有 | 有 | 无 |
| ② `stageHealthOfLedger` | 无 | 有 | 有 | 无 |
| ③ `readiness` | 有（**缺 seenIds**） | 有 | 无 | 有 |
| ④ `/stages.stageHealth` | 无 | 有 | 有 | 有 |
| **并集（应有的口径）** | 有 | 有 | 有 | 有 |

## 3.2 改什么

新增唯一入口 `ledgerHealthOf(units)`（**纯函数**，落在 `src/shared/`），四个出口**全部**改调它；
**不许任何一个出口自己组合判据**。

⚠ **为什么放 `src/shared/` 而不是 `src/modules/tools.ts`**：四出口之一的 ④ 在 `shared/stages-index.ts`，
而 `stages-index.ts` **被 client 半边 import**（`tsdown`）—— 若入口放 `modules/tools.ts`（依赖 `node:fs`），
`/stages` 侧就取不到它。**这是「唯一入口」能不能真正落地的硬约束。**

## 3.3 具体改法（代码形状）

### 3.3.1 新增文件 `src/shared/ledger-health.ts`

```ts
/**
 * **账本健康的唯一入口**（纯函数，零 I/O）。
 *
 * ⚠ 存在的理由：同一个问题「这本账健康吗」曾有 4 套互不相同的判据
 *   （字段 / +审批 / +闭环 / +形状），实测两两结论不同（附录 A-8）。
 *   ⇒ 四出口改调本函数；任何出口都不得自行组合下面四个组成部分。
 */
import { unitShapeProblems } from './ledger-validation.ts'
import {
  ledgerClosureProblems,
  stageApprovalProblems,
  stageFieldProblems,
  type StageControlUnit,
} from './stage-controls.ts'

/** 一个缺口（与 stage-controls 的 StageControlProblem 同形，便于直接复用渲染）。 */
export interface LedgerHealthProblem {
  rule: string
  unit: string
  why: string
}

/** 四个组成部分各自的可读来源（分开给，便于面板说清「这是哪一类缺口」）。 */
export interface LedgerHealthBySource {
  /** S-0：kind/status 不在封闭集、或合并后出现重复 ID。 */
  shape: LedgerHealthProblem[]
  /** C-*：逐条单元的字段契约。 */
  field: LedgerHealthProblem[]
  /** C-18 / C-19：用户对当前修订的批准。 */
  approval: LedgerHealthProblem[]
  /** L-1..L-4：引用必须指向真实存在的上游。 */
  closure: LedgerHealthProblem[]
}

/** 唯一入口的返回形状。 */
export interface LedgerHealth {
  /** 四类缺口的**并集**（顺序固定：shape -> field -> approval -> closure）。 */
  problems: LedgerHealthProblem[]
  /** 分类明细（与 problems 同源，只是分组）。 */
  bySource: LedgerHealthBySource
  /** problems.length === 0。 */
  ok: boolean
  /**
   * 能否作为当前账本**推进工作**（派活 / 写推进）。
   * ⚠ 与 ok 的区别：ok 只回答「有没有缺口」；canProceed 还要求「读得到单元」。
   *   两者不许合并 —— 「没有缺口」与「没读到」是两件事（R-4）。
   */
  canProceed: boolean
}

/**
 * **唯一入口**。
 *
 * ⚠ 四个组成部分**都必须跑**：少跑任何一个，都会让「这本账健康吗」在某个出口上变成
 *   另一个答案（附录 A-8 的 F1/F3/F4 就是各自少跑一类的结果）。
 *
 * @param units - 已合并的账本单元（index + unit-*.toml；调用方负责读盘与解析）
 * @returns 四类缺口的并集 + 分类 + 两个判定
 */
export function ledgerHealthOf(units: readonly Record<string, unknown>[]): LedgerHealth {
  const cast = units as unknown as StageControlUnit[]
  /**
   * ⚠ 形状判据**必须传 seenIds**：ledger-readiness.ts:284 当年漏传，
   *   导致同一单元同时出现在 index 与分片时 readiness 报 ready（附录 A-3）。
   */
  const seenIds = new Set<string>()
  const shape = units
    .flatMap((u) => unitShapeProblems(u as Record<string, unknown>, seenIds))
    .map((why) => {
      /** 形态：`<id>: kind=…` 或 `<id>: status=…`；取冒号前那一段当 unit。 */
      const m = /^(.+?): /.exec(why)
      return { rule: 'S-0', unit: m?.[1] ?? '(unit)', why }
    })
  const field = stageFieldProblems(cast) as unknown as LedgerHealthProblem[]
  const approval = stageApprovalProblems(cast) as unknown as LedgerHealthProblem[]
  const closure = ledgerClosureProblems(cast) as unknown as LedgerHealthProblem[]
  const problems = [...shape, ...field, ...approval, ...closure]
  return {
    problems,
    bySource: { shape, field, approval, closure },
    ok: problems.length === 0,
    canProceed: problems.length === 0,
  }
}

/** 「判不出」那一档（账本读不到 / 根判不出）。与「健康」不共用返回形状。 */
export interface LedgerHealthUndecidable {
  state: 'undecidable'
  why: string
}

/** 出口用的三态：健康 / 有缺口 / 判不出。不许压成布尔。 */
export type LedgerHealthReadout =
  | ({ state: 'ok' } & LedgerHealth)
  | ({ state: 'gaps' } & LedgerHealth)
  | LedgerHealthUndecidable

/** 三态构造（唯一构造点，防漂移）。 */
export function healthReadoutOf(units: readonly Record<string, unknown>[]): LedgerHealthReadout {
  const h = ledgerHealthOf(units)
  return { state: h.ok ? 'ok' : 'gaps', ...h }
}
```

### 3.3.2 四个出口的替换方式

#### 出口 ① `stageGateOfLedger`（`tools.ts:581-591`）

```ts
export function stageGateOfLedger(ledgerRoot: string): string | undefined {
  try {
    const units = readLedgerUnits(ledgerRoot) as unknown as Record<string, unknown>[]
    const h = ledgerHealthOf(units)                      // <- 唯一入口
    if (h.problems.length === 0) return undefined
    const first = h.problems.slice(0, 5).map((p) => p.rule + ' · ' + p.unit + ' · ' + p.why).join('；')
    return "阶段门禁未通过：" + h.problems.length + " 条缺口（" + first + "）⇒ 先回查需求 / 方案 / 任务，补齐后再推进。"
  } catch (e) {
    return "阶段门禁判不出：账本读不到（" + String((e as Error)?.message ?? e) + "）⇒ 本次不推进（不把「判不出」当成「没有缺口」）。"
  }
}
```

⚠ **行为变化**：现在会**多报** `L-1..L-4` 闭环缺口与 `S-0` 形状缺口。
⇒ 实测影响面（附录 A-9，对全部真实账本）：

| 账本 | units | S-0 | 字段 | 审批 | 闭环 | 改后 ① 是否由 PASS 变 BLOCK |
|---|---|---|---|---|---|---|
| `hob-ledgers/dsh-hob` | 292 | 0 | 0 | 0 | 0 | **否**（仍 PASS） |
| `hob-ledgers/prompt-enhancer-release` | 19 | 2 | 0 | 1 | 0 | 否（本来就 BLOCK） |
| `...backup-before-ledger-contract-20261108` | 13 | 8 | 0 | 0 | 0 | **是**（备份账本，只读，不参与派活） |
| `...backup-...-20261108b` | 16 | 2 | 0 | 0 | 0 | **是**（同上） |

⇒ **主账本 `dsh-hob` 不受影响**；变成 BLOCK 的两本都在 `backup` 命名下（`isBackupLedgerName` 已能识别，`ledger-catalog.ts:18-20`）。

#### 出口 ② `stageHealthOfLedger`（`tools.ts:711-721`）

> ⚠ 这个出口**同时是 `T-05` 死锁的成因**（`repairOf` 用它的 `blockers` 判命中）。
> **必须与 `T-05` 同批改**（`REVIEW.md §8.1` 的联动项表已列）。

```ts
export function stageHealthOfLedger(ledgerRoot: string): { ok: boolean; blockers: GateDecision['blockers']; message?: string } {
  try {
    const units = readLedgerUnits(ledgerRoot) as unknown as Record<string, unknown>[]
    const h = ledgerHealthOf(units)                      // <- 唯一入口
    return {
      ok: h.ok,
      blockers: h.problems,
      ...(h.ok ? {} : { message: "账本健康：" + h.problems.length + " 条全局缺口（不阻塞当前单；逐条见 blockers）" }),
    }
  } catch (e) {
    /** 判不出 ⇒ ok:false（不与「健康」共用 true —— 那正是 T-02 要治的病）。 */
    return { ok: false, blockers: [], message: "账本健康判不出：" + String((e as Error)?.message ?? e) }
  }
}
```

⚠ **不再走 `stageGateAtLedger(project)`**：那条路的 `evaluateGate` project 分支返回 `stageControlProblems`（无闭环、无形状）。
直接调唯一入口，绕过它。
⚠ `stageGateAtLedger({scope:{kind:'project'}})` **保留**（它是「作用域门禁」API，语义不同），
但**改一行**：project 分支改为 `blockers: ledgerHealthOf(input.units).problems`。

#### 出口 ③ `ledgerReadinessOfRoot` / `assessLedgerReadiness`（`ledger-readiness.ts:262-303`）

⚠ 这个出口**不能整个换掉** —— 它还有五档状态（`unresolved/missing/legacy/empty/unhealthy/ready`），
那是**别的信息**（「能不能建账」`canInitialize`）。只替换**第 ⑥ 步「数缺口」那一段**（`:262-317`）。

```ts
  // ⑥ 有单元 ⇒ 数缺口（与派活门禁同一个纯函数，不另判一份）
  let health: LedgerHealth
  try {
    health = ledgerHealthOf(units)
  } catch (e) {
    return { state: 'unhealthy', headline: '账本单元判不出健康度', /* … */ reason: 'health-undecidable', detail: String((e as Error)?.message ?? e) }
  }
  const { gaps, gapCount } = toGaps(health.problems)
  if (gapCount > 0) {
    return { state: 'unhealthy', headline: '账本有 ' + gapCount + ' 条缺口', /* … */ gaps, gapCount, reason: 'stage-control-gaps' }
  }
  return { state: 'ready', /* … */ canProceed: true }
```

⚠ **删掉** `:284-292` 的 `shapeProblems` 自建映射（那一份**没有 `seenIds`**、且正则取 unit 的两条 fallback 只覆盖两种形态）。
⚠ **新增** `stageApprovalProblems`（现状 readiness **没有审批判据**，所以 F4 报 `ready`）。

**行为变化（必须同批处理）**：readiness 从此会报 `C-18/C-19`（未批准）。
⇒ **`hob_ledger_init` 的 `ready` 判定会变严**：刚建好的空账本是 `empty`（不进第六步），不受影响；
   但「有单元、尚未获用户批准」的账本会从 `ready` 变 `unhealthy`。
⚠ **这正是 F4 要修的**：「账本结构健康」与「用户还没批准」是两件事，但 `canProceed` 必须两者都满足。
⇒ **详见 §3.7 D-T02-1**。

#### 出口 ④ `/stages.stageHealth`（`stages-index.ts:445-465`）

```ts
    ...(() => {
      try {
        const h = ledgerHealthOf(units)                  // <- 唯一入口
        const cap = opts.compact === true ? 40 : h.problems.length
        return {
          stageHealth: {
            ok: h.ok,
            count: h.problems.length,
            ...(h.problems.length > cap ? { truncated: true } : {}),
            problems: h.problems.slice(0, cap),
            /** 新增：四类各自的条数（面板可按类分组，不必自己再算一遍）。 */
            bySource: {
              shape: h.bySource.shape.length,
              field: h.bySource.field.length,
              approval: h.bySource.approval.length,
              closure: h.bySource.closure.length,
            },
          },
        }
      } catch { return {} }
    })(),
```

⚠ **`catch { return {} }` 保持不变**（字段缺席 = 面板不显示这一块，不兜底成「健康」）。
⚠ **`bySource` 是新增字段**，旧客户端忽略它即可（前进兼容）。

## 3.4 依赖与冲突

| 关系 | 说明 |
|---|---|
| **必须先做** | §1（`T-01`+`O-33`）：否则真实账本里 index 冻结，`readLedgerUnits` 读到的单元不完整，统一入口在**错的输入**上算 |
| **必须先做** | §2（`L-04`）：否则两个出口的输入口径不同（一个宽松一个严格），「统一入口」仍会得出两个结论 |
| **必须同批** | `T-05`（`repairOf` 判据）：`REVIEW.md §8.1` 已列为联动项；只改 `repairOf` 会让它依赖的判据继续恒空 |
| **必须同批** | `stage-controls.ts:1097-1102` 的 project 分支改一行（否则 ② 与 `stageGateAtLedger(project)` 又分叉） |
| **会打架** | `R-02`（「完成」有 5 处实现）：本节只统一**健康**，不统一**完成**。两者**不要合并** —— 健康回答「能不能推进」，完成回答「走到第几步」 |
| **会打架** | `T-09`（面板健康条数）：四出口统一会**改变条数**（F2 从 5/6 变成 6 条一致）。`T-09` 的 `count`/`truncated` 语义不受影响 |
| **风险** | 出口 ③ 的 `ready` 变严会让 `hob_ledger_init` 在「有单元未批准」时不再报 `ready` ⇒ 见 §3.7 |

## 3.5 唯一入口的签名设计说明（回答任务书「签名、返回形状」）

| 设计点 | 选择 | 理由 |
|---|---|---|
| 输入 | `readonly Record<string, unknown>[]`（**已合并的单元**），不是 `ledgerRoot` | ④ 在 client 半边，**没有 `fs`**；把读盘留给调用方是唯一能让四出口共用同一函数的方式 |
| 是否 `async` | **否** | 纯函数；四出口里三个同步、一个在 client |
| 返回 `problems` 还是 `ok` | **两者都给** | 只给 `ok` ⇒ 调用方无法逐条渲染；只给 `problems` ⇒ 每个调用方各写一次 `.length === 0`（**新的四份**） |
| 是否带 `bySource` | **带** | 面板要按类分组（S-0 / C-* / 审批 / 闭环），且**分类也只该算一次** |
| `ok` 与 `canProceed` | **分开** | `ok` = 无缺口；`canProceed` = 无缺口 ∧ 读得到。当前二者同值，但**保留两个名字**让将来的差异有落点 |
| 判不出 | **不用同一个返回类型** | `LedgerHealthUndecidable` 是另一支；不许用 `ok:false` 表示「判不出」（那正是 `T-02` 的病） |

## 3.6 分步替换计划（任务书要求）

⚠ **核心难点**：四个出口一旦不同批切换，中间态会出现「五套判据」（旧的 4 套 + 新的 1 套）。
⇒ 计划必须让**每一步之后**都满足「出口之间不新增分歧」，且**每一步都能独立上线**。

### 步骤 0 · 只新增，不改任何出口（可独立上线）

- 新增 `src/shared/ledger-health.ts`（§3.3.1 全文）
- 新增机检 `scripts/check-ledger-health.mjs`（**未做**）：对 F1..F5 五个夹具断言 `ledgerHealthOf` 的 `problems` 覆盖四类
- **四个出口一行不改** ⇒ **行为零变化**，但唯一入口已经存在并可被机检验证
- 退出条件：`npm run check:ledger-health` 绿 + **负向对拍**（把任一 `bySource` 项写成 `[]` ⇒ 红）

### 步骤 1 · 先切出口 ④ `/stages.stageHealth`（只读、无副作用）

**为什么先切它**：它是唯一**纯只读、零副作用、且已被面板消费**的出口。切错了只影响显示，不拦写入、不拦派活。

- `stages-index.ts:445-465` 改调 `ledgerHealthOf`
- **行为变化**：多报 `S-0`（F3 从 `count=1` 变 `count=2`）
- **一致性检查**：此时 ④ 变成「并集」，①②③ 仍是旧口径 ⇒ **出口间分歧短暂变大**（这是唯一允许的中间态，因为下一步立刻收敛）
- 退出条件：`/stages` 在 F3 上 `count` 从 1 变 2，且 `bySource.shape === 1`

### 步骤 2 · 切出口 ③ `readiness` 的第六步（**与 `hob_ledger_init` 同批**）

**为什么紧接步骤 1**：③ 与 ④ 的组合差异是「③ 有 shape+closure 无 approval / ④ 有 field+approval+closure 无 shape」。
两步都切完，③ 与 ④ 才**第一次**对同一夹具给出同一结论。

- `ledger-readiness.ts:262-303` 改调 `ledgerHealthOf`（保留五档状态机）
- **同时**处理 `hob_ledger_init` 的 `ready` 变严（`tools.ts:2139+`）⇒ 见 D-T02-1 拍板结果
- 退出条件：F1..F5 上 ③ 与 ④ 的 `gapCount` **逐格相等**

### 步骤 3 · 切出口 ① `stageGateOfLedger` + ② `stageHealthOfLedger`（**同一提交**）

**为什么必须同一提交**：① 与 ② 是「写前门禁」与「修复写命中判据」的一对（`T-05` 死锁的成因）。
只切一个 ⇒ 死锁换个方向继续存在。

- `tools.ts:581-591`（①）+ `tools.ts:711-721`（②）+ `stage-controls.ts:1097-1102`（project 分支一行）
- **同时**改 `tools.ts:1649-1658` 的 `repairOf` 判据（`T-05`）
- 退出条件：
  - F1..F5 上**四个出口的 `problems` 集合逐条相等**（新机检 `LH-2`）
  - **只有 L-2 缺口的账本，`repairOf=<该单元>` 必须 `ok:true`**（`T-05` 死锁解除）

### 步骤 4 · 删旧路径 + 加反向断言

- `grep -rn "stageControlProblems" src/` ⇒ 只应剩 `stage-controls.ts` 自身的定义与 `stageGateAtLedger`
- 新增机检：**四出口对同一夹具必须同结论**（步骤 3 的退出条件固化为常驻断言）
- 新增负向对拍：把任一出口改回自己的组合 ⇒ 必须红

### 中间态一致性保证（回答「中间如何保持行为一致」）

| 步骤后 | ① | ② | ③ | ④ | 出口间是否新增分歧 |
|---|---|---|---|---|---|
| 0 | 旧 | 旧 | 旧 | 旧 | 否（完全不变） |
| 1 | 旧 | 旧 | 旧 | **新（并集）** | ④ 变宽，与 ①②③ 差异变大 —— **允许，但必须在此步停不超过一个提交** |
| 2 | 旧 | 旧 | **新** | 新 | ③④ 一致；①② 仍旧 |
| 3 | **新** | **新** | 新 | 新 | **四处一致** |
| 4 | 新 | 新 | 新 | 新 | 一致 + 有断言钉住 |

⚠ **三种禁止的中间态**：

1. **只切 ① 或只切 ②** —— 死锁换方向继续存在（`T-05`）；
2. **切了 ③ 但不切 `hob_ledger_init`** —— `ready` 变严会让 init 在「有单元未批准」时误报 `nothing-to-create`（D-T02-1）；
3. **切了 ④ 但停留超过一个提交** —— 面板说 2 条、门禁说 0 条，用户会按面板去修但门禁不认。

## 3.7 待拍板

### D-T02-1 · `readiness` 的 `ready` 是否要求「已获用户批准」

**问题**：现状 ③ **没有**审批判据（`ledger-readiness.ts:294-303` 只有 shape+field+closure），
于是「有单元但未批准」的账本报 `ready`（F4 实测）。统一入口会带上 `C-18/C-19`，
`ready` 随之变严 —— 但 **`hob_ledger_init` 用 `ready` 判「无需再建」**（`tools.ts:2139+`），
账本「已建好但还没批准」时可能落进 `nothing-to-create`。

| 选项 | 内容 | 影响 |
|---|---|---|
| **A** | `ready` 要求四类缺口全空（**含审批**） | 最一致；但 `hob_ledger_init` 需要**另加一档** `built-but-unapproved` 才能正确回答「还要不要建」 |
| **B** | `readiness` 保留「结构健康」语义（**不含审批**），审批只在 `canProceed` 与 ①②④ 里 | `ready` 语义变窄 ⇒ 与出口 ①②④ **继续分歧**（F4 上 ③ 仍 `ready`） |
| **C** | 拆成两个字段：`structurallyReady`（不含审批）+ `canProceed`（含全部） | 语义最清楚，但要改 `LedgerReadiness` 的形状与所有消费方 |

**推荐：C**（最小语义损失 + 不需要 A 的额外状态）。
**理由**：`ready` 这个词同时承担了「结构可用」与「可推进」两个含义，这正是 `T-02` 的形态；拆字段比在 A/B 里选一个更能根治。
⚠ **但若不接受形状变更，退 A 也可**（需同步给 `hob_ledger_init` 加一档）。

## 3.8 验证方式

### 机检（新增 `scripts/check-ledger-health.mjs`，**未做**）

```
LH-1  F1..F5 五个夹具：ledgerHealthOf(units).problems 必须覆盖对应类别
LH-2  四出口对同一夹具：problems 集合逐条相等（顺序也相等）
LH-3  同一单元同时出现在 index 与分片 ⇒ shape 必须报「重复 ID」（seenIds 生效）
LH-4  bySource 四项之和 === problems.length（分类不丢项）
LH-5  ledgerHealthOf 空单元 ⇒ ok:true / problems:[]（空账本不算"坏"）
```

### 负向对拍

| 对拍 | 把实现改坏成 | 期望 |
|---|---|---|
| **N-T02-1** | 从 `ledgerHealthOf` 里删掉 `stageApprovalProblems` | `LH-1`（F4）与 `LH-2` 必须红 |
| **N-T02-2** | 从 `ledgerHealthOf` 里删掉 `unitShapeProblems` | `LH-1`（F3）与 `LH-3` 必须红 |
| **N-T02-3** | 从 `ledgerHealthOf` 里删掉 `ledgerClosureProblems` | `LH-1`（F1）必须红 |
| **N-T02-4** | 把任一出口（①②③④）改回自己的组合 | `LH-2` 必须红 |
| **N-T02-5** | `unitShapeProblems` 不传 `seenIds` | `LH-3` 必须红 |

## 3.9 回退方式

⚠ **本改动不可整体 revert**（步骤 1-2 之间有意保留了一个「分歧变大」的中间态）。
⇒ 回退必须**按步骤反向**：先退步骤 3（①② 恢复到 `stageControlProblems`），再退 2，再退 1。
⇒ **步骤 0 的新文件可以保留**（不影响任何出口），所以回退到步骤 0 是安全落点。
⚠ 若只回退部分步骤，**必须同时回退对应机检**，否则 `LH-2` 会一直红。

## 3.10 改动面等级

**跨模块 + 需宿主配合**：

- `src/shared/ledger-health.ts`（新）
- `src/shared/stages-index.ts`（出口 ④）
- `src/shared/ledger-readiness.ts`（出口 ③）
- `src/shared/stage-controls.ts`（project 分支 1 行）
- `src/modules/tools.ts`（出口 ①② + `repairOf` + `hob_ledger_init`）
- `scripts/check-ledger-health.mjs`（新，**未做**）

⚠ **需宿主配合的点**：④ 在 client 半边运行（`tsdown` 打包）⇒ 新文件的 import 必须是**纯 type + 纯函数**，
不许引入 `node:fs` / `node:path`。这正是把入口放 `src/shared/` 的原因（§3.2）。

---

# 4. `R-18` · `removeUnitBlock` 把非 id 字段留成孤儿块

## 4.1 缺陷编号与位置

| 项 | 位置（源码实测） | REVIEW.md | 差异 |
|---|---|---|---|
| `removeUnitBlock` | `src/server/projection-writer.ts:130-150` | `:130-150` | 一致 |
| 调用点（拼回分片） | `src/server/projection-writer.ts:265-271` | `:265-271` | 一致 |
| 豁免校验 | `src/server/projection-writer.ts:268-272`（`validateLedgerStructure: false`） | `:272` | 一致 |

## 4.2 改什么

`removeUnitBlock` 从**行级删除**改为**块级删除**。

### 4.2.1 缺陷的精确形态

当前实现（`:130-150`）的循环里有两个独立状态机混在一起：

```ts
for (const line of lines) {
  if (line.trim() === '[[unit]]') { skipping = false }   // A：见到块头就复位
  if (!skipping && line.trim().startsWith('id = ')) {     // B：只在非 skipping 时找 id
    if (匹配到目标 id) {
      while (out[len-1].trim() === '[[unit]]') out.pop()  // C：回退已 push 的块头
      skipping = true
      continue
    }
  }
  if (!skipping) out.push(line)
}
```

**三条各自成立的假设，在「`id` 不是首键」时同时失效**：

| 假设 | 何时成立 | 何时失效 |
|---|---|---|
| 目标块的 `[[unit]]` 还在 `out` 尾部（C 能弹到它） | `id` 是块的**第一行** | `id` 前面还有 `title` / `kind` 等行 ⇒ 尾部是那些行，C 弹不到块头，**块头留在 out 里** |
| 跳过范围 = 整块 | `id` 在第一行（此后 `skipping=true` 吃掉剩余行） | `id` 之前的行**已被 `out.push`**，永久留下 |
| 复位边界正确 | 每个块都以 `[[unit]]` 开头 | 仍成立；但**孤儿块没有 `id`**，下一轮 B 找不到它 ⇒ 它既不被删也不被认领 |

⇒ **结果**：孤儿块 = `[[unit]]` + 目标块 `id` 之前的全部非 `id` 行。

**实测（附录 A-10）**：分片里第二块形如

```toml
[[unit]]
title = "second block: id after kind"
kind = "task"
id = "TSK-002"
status = "todo"
```

删 `TSK-002` 后得到：

```toml
[[unit]]
title = "second block: id after kind"    <- 孤儿块（无 id、无 status）
[[unit]]
id = "TSK-003"
```

而 `parseUnitsToml` **照样把它算一条单元**（`{title:"second block…", kind:"task"}`）。

### 4.2.2 为什么 `validateLedgerStructure:false` 让它更糟

`:272` 传了豁免 ⇒ 写坏的分片**不会被自己的结构校验拦下**。
实测端到端（附录 A-10）：`applyProjection` 一次派发投影返回 `{ok:true, applied:3}`，
而分片里已经出现 **2 个孤儿块**；下一次任意写入会被「`id` 缺失」拦死。
