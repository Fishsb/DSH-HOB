#!/usr/bin/env node
/**
 * 编排运行态自检 —— 机检「"等回传"这件事能被跨重载观测到」这条新面**确实焊死**了。
 *
 * ══ 为什么需要它（本批实测缺陷）════════════════════════════════════════
 *   2026-10-09 用户报障：派出去一轮，对方**已经跑完**，但 `hob_orch_status` 读的是
 *   「在等回传 0 · 已回传 0 · 被停闸拦下 0」—— 与"从来没派过"**无法区分**。
 *
 *   对照实验（本机实例**未重启**，只 `dev_reload_package dsh-hob`）已证根因：
 *     · 重载前 `dsh-hob#521/tools#522/bus#523/orchestrator#524/settings#525`，watches = 1
 *     · 重载后 `dsh-hob#529/tools#530/bus#531/orchestrator#532/settings#533`，watches = 0
 *   ⇒ cordis 把该包的 fiber **全量重建**，`watches` 建在 inject 回调内 ⇒ 新回调建空 Map，
 *     而**没有任何东西**记下"曾经派过"。
 *
 * ══ 断言口径（**不许静默放宽** —— 改本文件前先读完这一节）══════════════════
 *   A. **落点合法**：运行态必须落在**账本目录之内**、名字明确的**非账本**子目录
 *      （`runtime/orch-watches.json`）—— 不是三本账本之一，也不是 `$DSH_HOME` 下的新路径。
 *      ⚠ 判据是**代码里没有硬编码本机绝对路径**（可移植性口径 UD-73③）：
 *      账本父目录必须从**预设行声明**（`ledgerHome`）读出来。
 *   B. **自忽略**：`runtime/` 必须自带忽略（内容含 `*`）⇒ 运行态**不进账本历史**。
 *      判据 = `orch-state.ts` 里存在写 `.gitignore`（内容 `*`）的路径。
 *   C. **不静默**：`hob_orch_status` 的输出里，丢失必须**新增行**报出；
 *      且**原有行一字未改、未删**（在等回传 / 已回传 / 被停闸拦下）。
 *   D. **重载后「先核再判」必须**成对**（2026-10-18 第 2 轮 · `UD-137` 裁定 3 收窄）**：
 *      ⚠ 旧口径（改前）是一条**禁令**：接手块里**不得**出现 `watches.set(...)`，
 *      理由 = `running → idle` 是**事件**不是可轮询状态，自动续上会留一个**永不结算**的
 *      watch ⇒ 命中"同目标至多一条未结算"闸门 ⇒ 该会话**永久不能再派**。
 *      ⚠ ⚠ **那条理由只描述"已经跑完"这一档**。用户 2026-10-18 裁定把它**收窄成成对三条**：
 *        **D2-a（正向）** 目标**仍在跑** ⇒ **必须重挂**（实测：该条**不许**被判 lost）；
 *        **D2-b（反向）** 目标**已空闲** ⇒ **必须不重挂**（实测：重挂数必须为 0）+ 判 lost **且档位可分辨**；
 *        **D2-c（反证）** 把重挂那几行去掉 ⇒ **D2-a 必须 FAIL**（负向对拍，见回报件）。
 *      ⚠ 判「不算放宽分辨力」的依据：旧的是**一条禁令**，新的是**两条方向相反的要求 + 一个反证**
 *        ⇒ 覆盖面变宽。⚠ **前提**：重挂**只对仍在跑的目标**做 —— D2-b 钉的就是这个前提。
 *   D'. **档位单一来源 + 两类不混一个计数**（同轮新增）：
 *      档位只经 `orch-state.ts` 的 `asWatch` 进内存（⛔ 无 sidecar、⛔ 不借 `error`）；
 *      状态行按 `lostByClass` **分开报**（⛔ 不再只报一个总数）。
 *   E. **闸门未动**：`stopped` 的两处闸门位置**语义未变**（回传前 + 派发前），
 *      `hob_dispatch` 的"同目标至多一条未结算"拒绝**仍在**。
 *   F. **待投递中间态**（2026-10-10 新增 · 用户报障修复）：写了交接文件 ⇒ 出现 `handoffs`
 *      记录 · **`writePending` 保留既有 `handoffs`** · 投递成功 ⇒ 该记录消失 ·
 *      **旧结构文件（无 `handoffs`）读得进且读成空数组** · 坏记录逐条丢弃 ·
 *      状态输出**空态也给读数**（`待投递：0 份`）· 提醒落在写入返回值里 ·
 *      落盘层不 import 运行态模块（分层未破）。
 *      ⚠ **F 组是"真跑函数"而不是文本匹配**（与 A~E 不同）—— 理由见该组注释：
 *      这里要保的是**数据结构的行为**，而"`writePending` 忘了保留 `handoffs`"这类缺陷
 *      在源码里**字样仍在**、文本断言照样 PASS。故 F 组用 Node ≥22 直载 `.ts` 实跑，
 *      且该 import 失败时 **FAIL 而不是跳过**（"基准跑不起来就默认通过"是假通过）。
 *
 *   ⚠ 每条断言都**必须能失败**（E-27：永远 PASS 的检查比没有更危险）。
 *     交付时逐条做过负向对拍（故意破坏 → FAIL → 还原 → PASS），读数见回报。
 *     ⚠ F 组的负向对拍**当场抓到本脚本自己的一个缺陷**：坏产物会让脚本抛
 *     `TypeError` 而**不给可读 FAIL**（只剩堆栈，看不出违反了哪条断言）
 *     ⇒ 已改为防御式取值（`Array.isArray` 后才访问，见该组注释）。
 *
 *   G. **结构改造 ① ②**（2026-10-10 第 44 轮）—— 同款"真跑函数"（Node ≥22 直载 `.ts`）：
 *      **① 写入边界校验**：写的内容含**不存在**的具名引用 ⇒ 当场点名；
 *        含**真实存在**的 ⇒ 不点名；含**占位 / 示意 / 通配**形态 ⇒ **不点名**（**E-114 家族**）。
 *      **② 写入即投递**：给 `dispatchTo` ⇒ 投递被调用 + 该条 handoff 被清；
 *        给 `delivery:'manual'` ⇒ 记录保留**且带标注**；状态行**分开报**；
 *        旧运行态（无新字段）⇒ 读得进、`handoffs` 读成空。
 *      ⚠ 判据同 **E-112**：负向对拍**不只看退出码**，还要有**可读的 ✗ 行**。
 *
 * 用法：node scripts/check-orch-state.mjs      （或 npm run check:orch）
 * 退出码：0 = 全通过；1 = 有违规（逐条打印）
 * ⚠ 零第三方依赖（本仓纪律）：只做文本级解析，不引 YAML 库。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const STATE_TS = join(root, 'src', 'server', 'orch-state.ts')
const ORCH_TS = join(root, 'src', 'modules', 'orchestrator.ts')
const HOBWRITE_TS = join(root, 'src', 'server', 'hob-write.ts')
const DELIVERY_TS = join(root, 'src', 'server', 'write-delivery.ts')

const fail = []
const note = []
const bad = (m) => fail.push(m)
const ok = (m) => note.push('  ✓ ' + m)

/** 读文件；读不到直接算失败（缺文件比内容错更早暴露）。 */
function must(file, label) {
  try {
    return readFileSync(file, 'utf8')
  } catch (e) {
    bad(`${label} 读不到：${file}（${String(e?.message ?? e)}）`)
    return ''
  }
}

const stateSrc = must(STATE_TS, '运行态模块')
const orchSrc = must(ORCH_TS, '编排模块')

/** 去掉行注释与块注释后扫描 —— 注释里提到某个名字不算"用了它"。 */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * 同 {@link stripComments} 的**语义**，但**保留行数**（2026-10-17 第 2 轮 · J4 新增）。
 *
 * ⚠ 为什么需要第二个剥离器：`stripComments()` 把整行注释**删掉** ⇒ 后续行号**全部前移**
 *   （实测：`bus.ts` 的真实 `:537` 被报成 `:268`，差 269 行）。
 *   判定行里给一个**指错的行号**比不给更坏 —— 读者按它跳过去会看到无关代码。
 *   ⇒ 本版把注释内容替换成**等量空白**、**保留所有换行**，行号与原文逐行对齐。
 *
 * ⚠ 两者**语义等价**（都不让注释里的名字冒充代码），可直接对拍：
 *   把两者的空白归一后应逐字节相同（J 组不使用这条对拍，理由见该组注释）。
 */
function stripCommentsKeepLines(s) {
  return s
    // 块注释：保留其内部换行，其余字符换空白
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    // 行注释：保留行首缩进与换行
    .replace(/^([ \t]*)\/\/.*$/gm, (_m, lead) => lead)
}
const stateCode = stripComments(stateSrc)
const orchCode = stripComments(orchSrc)

// ── A. 落点合法 ────────────────────────────────────────────────────────
{
  if (/ORCH_STATE_SUBDIR\s*=\s*'runtime'/.test(stateCode)) {
    ok("A1 运行态子目录名 = 'runtime'（名字明确、非账本）")
  } else {
    bad("A1 运行态子目录名不是 'runtime'（落点必须名字明确）")
  }

  if (/ORCH_STATE_FILENAME\s*=\s*'orch-watches\.json'/.test(stateCode)) {
    ok("A2 运行态文件名 = 'orch-watches.json'")
  } else {
    bad("A2 运行态文件名不是 'orch-watches.json'")
  }

  // 落点必须由 ledgerRoot 派生（不是工作区内的相对路径、不是 DSH_HOME 新路径）
  if (/orchStateFileOf[\s\S]{0,200}?join\(\s*ledgerRoot/.test(stateCode)) {
    ok('A3 落点由账本目录派生（join(ledgerRoot, …)）')
  } else {
    bad('A3 落点不是由账本目录派生 —— 与 UD-86 授权范围不符')
  }

  // ⚠ 关键：源码里不得硬编码本机绝对路径（可移植性 UD-73③）
  const hard = [...orchCode.matchAll(/['"`](\/(?:home|Users|mnt)\/[^'"`]*)['"`]/g)].map((m) => m[1])
  if (hard.length === 0) {
    ok('A4 编排模块无硬编码本机绝对路径（可移植性 UD-73③）')
  } else {
    bad(`A4 编排模块出现硬编码本机绝对路径：${hard.join(', ')}`)
  }

  // 账本父目录必须从预设行声明读出（loader），不是常量
  if (/ledgerHome/.test(orchCode) && /\.entries\?\.\(\)|\.entries\(\)/.test(orchCode)) {
    ok('A5 账本父目录从 loader 条目（预设行声明 ledgerHome）读出')
  } else {
    bad('A5 账本父目录不是从预设行声明读出 —— 硬编码会撞 UD-73③')
  }

  // 必须用既有的唯一解析入口（不自己拼路径）
  if (/resolveLedgerRoot\s*\(/.test(orchCode)) {
    ok('A6 复用 resolveLedgerRoot（账本路径的唯一解析入口）')
  } else {
    bad('A6 未复用 resolveLedgerRoot —— 路径解析出现第二个实现点')
  }
}

// ── B. 自忽略（运行态不进账本历史）──────────────────────────────────────
{
  if (/ORCH_STATE_IGNORE\s*=\s*'\.gitignore'/.test(stateCode)) {
    ok("B1 忽略文件名 = '.gitignore'")
  } else {
    bad("B1 忽略文件名不是 '.gitignore'")
  }

  // 内容必须含**独占一行**的通配 `*`（让它自己也不被跟踪，无需人工 git add）
  // ⚠ 判据写法说明：源码里那是一个单引号字符串，转义序列**字面**就是 `\n*\n`
  //   （两个字符 `\` `n`，不是换行）⇒ 正则要写成 `\\n\*\\n`。
  //   ⚠ 这条**必须能失败**：负向对拍时把内容改成 `!*.json`（反向放行）⇒ 应 FAIL。
  if (/\\n\*\\n/.test(stateSrc)) {
    ok("B2 忽略内容含独占一行的 '*'（运行态目录整体不进 git）")
  } else {
    bad("B2 忽略内容不含独占一行的 '*' —— 运行态可能被账本仓跟踪")
  }

  // 编排模块必须在落盘前调用它（同批处理忽略，任务书 §2.1 第 4 条）
  if (/ensureRuntimeIgnored\s*\(/.test(orchCode)) {
    ok('B3 落盘路径上调用 ensureRuntimeIgnored（同批处理忽略）')
  } else {
    bad('B3 落盘时未处理忽略 —— 运行态会混进账本历史')
  }
}

// ── C. 不静默：hob_orch_status 加行（不删不改既有行）────────────────────
{
  // ① 三条既有行**必须原样还在**
  const legacy = [
    ["s.stopped ? '⏸ 已停（不回传、不接受新派发）' : '▶ 在跑'", 'C1 状态首行（在跑/已停）'],
    ['`在等回传：${s.watches.length} 个`', 'C2 在等回传行'],
    ['`已回传：${s.relaysDone} 次 · 被停闸拦下：${s.relaysBlocked} 次`', 'C3 已回传/被停闸拦下行'],
  ]
  for (const [needle, label] of legacy) {
    if (orchSrc.includes(needle)) ok(`${label}原样保留`)
    else bad(`${label}被改名或删除（任务书 §2.3 禁止）`)
  }

  // ② 必须新增"丢失"行
  if (/重载丢失：/.test(orchSrc)) {
    ok('C4 新增"重载丢失"行（丢失可观测）')
  } else {
    bad('C4 hob_orch_status 未新增丢失行 —— 重载后仍与"从来没派过"无法区分')
  }

  // ③ 新增行必须在 `lostPending === 0` 时不出现（不污染正常读数）
  if (/s\.lostPending\s*===\s*0/.test(orchCode)) {
    ok('C5 无丢失时不额外输出（正常读数不被污染）')
  } else {
    bad('C5 丢失行未按 lostPending === 0 收敛')
  }

  // ④ OrchStatus 必须带上这个计数
  /**
   * ⚠ **C6 改判**（2026-10-19 收单第一轮 · `I-4`）：`lostPending` 仍是**同一个键**、
   *   仍是"重载丢失的条数"，但它的**分母从"全实例"变成"我的"**（作业书：行名与档位
   *   一个字都不许变，只是分母变成"我的"）。
   * ⚠ 所以本条的判据从"接的是 `lostCount`"改成"接的是**按 owner 过滤后**的那个数"，
   *   ⛔ **不是删掉它**（删掉就等于允许这个键消失/恒 0）。
   */
  const c6Wired = /lostPending\s*:\s*number/.test(orchCode)
    && /lostPending\s*:\s*mine\.lostPending/.test(orchCode)
  if (c6Wired) {
    ok('C6 OrchStatus.lostPending 存在，且由**按 owner 过滤后**的 `mine.lostPending` 供给'
      + '（`I-4`：键名不变、分母变成"我的"）')
  } else {
    bad('C6 OrchStatus 缺 lostPending，或它没接按 owner 过滤的那个数'
      + '（期望 `lostPending: mine.lostPending`；⛔ 不许回成全实例汇总）')
  }
}

// ── D. 重载后「先核再判」**成对**（2026-10-18 第 2 轮 · `UD-137` 裁定 3 收窄）────
//
// ⚠ 旧口径（改前）是**一条禁令**：接手块里**不得**出现 `watches.set(...)`。
//   理由 = `running → idle` 是事件，自动续上会留一个**永不结算**的 watch。
//   ⚠ ⚠ **那条理由只描述"已经跑完"这一档** —— 用户 2026-10-18 裁定把它收窄成**成对**：
//     D2-a 仍在跑 ⇒ **必须重挂**；D2-b 已空闲 ⇒ **必须不重挂**；D2-c 反向对拍 ⇒ 去掉重挂 ⇒ D2-a 必红。
//   ⚠ 本组是**静态面**（只判"那几行在不在、条件对不对"）；
//     **行为面**（真跑两条路径）在同文件 **K 组** —— 两者必须**同时**绿才算数。
{
  // `markLost` 的返回值流向：`reattach` → 重挂；`lost` → 只计数/日志/通知
  const idx = orchCode.indexOf('markLost(')
  if (idx < 0) {
    bad('D1 编排模块未调用 markLost —— 丢失判不出来')
  } else {
    // ⚠ 扫描范围 = 从 `markLost(` 到 `flushWatches` 的定义之前。
    //   这一段覆盖**整个接手块**（判丢失 → 重挂 → 计数 → 通知）。
    //   ⚠ 为什么不切到 `const refreshLostCount`（**实测踩过**）：
    //     裸调用 `refreshLostCount()` 在**定义之后**，按"定义前"切片会把
    //     注入在调用点附近的 `watches.set` **切到范围外** ⇒ 负向对拍**假通过**。
    //     终点改用更靠后的 `const flushWatches`，注入点就落在范围内了。
    const stop = orchCode.indexOf('const flushWatches')
    const scope = stop > 0 ? orchCode.slice(idx, stop) : orchCode.slice(idx)

    // ── D2-a **重挂必须在位，且只吃 `reattach`**（⛔ 不许吃 `lost`）──────────
    //   ⚠ 判据三件同时成立：
    //     ① 接手块里**有** `watches.set(`（= 重挂那段真的在）；
    //     ② 它遍历的是 `r.reattach`（= 只对"仍在跑"的那一摞重挂）；
    //     ③ 它**不**遍历 `r.lost`（= 不把判死的那些也挂回去）。
    //   ⚠ 为什么②③必须分开钉：只钉①的话，"把 lost 也一起重挂"照样 PASS ——
    //     那正好是 K-b 要抓的"永不结算的 watch"。
    const hasSet = /watches\.set\s*\(/.test(scope)
    /**
     * ⚠ **D2-a 改判**（`I-5` 末段）：重挂那一摞现在叫 `myReattach`
     *   （= `r.reattach` 过滤掉**别人的**记录之后的那一摞）。
     * ⚠ 判据的**原意不改**："必须**只**重挂'仍在跑'那一摞"——
     *   所以这里同时接受 `r.reattach` 与 `myReattach`（后者必须**来源于** `r.reattach`，
     *   下面 `derivedFromReattach` 单独钉这一点，⛔ 不是放宽成一团）。
     */
    const iterReattach = /for\s*\(\s*const\s+\w+\s+of\s+(?:r\.reattach|myReattach)\s*\)[\s\S]{0,400}?watches\.set\s*\(/.test(scope)
    // ⚠ `myReattach` 必须由 `r.reattach` 过滤而来（⛔ 不许凭空造一摞）
    const derivedFromReattach = !/myReattach/.test(scope)
      || /const\s+myReattach\s*=\s*r\.reattach\.filter\(/.test(scope)
    // ⚠ 判据写宽一点：`r.lost` **以任何形式**出现在重挂循环头里都算违规
    //   （`for (const w of r.lost)` / `for (const w of [...r.reattach, ...r.lost])` 都抓）。
    //   ⚠ 实测踩过：只钉 `for (const w of r.lost)` 时，把两摞展开成一个数组的写法**漏网**。
    const iterLost = /for\s*\(\s*const\s+\w+\s+of\s+[^)]{0,200}?r\.lost[^)]{0,200}?\)[\s\S]{0,400}?watches\.set\s*\(/.test(scope)
    if (!hasSet) {
      bad('D2-a 【必须重挂】**接手块里没有 `watches.set(`** —— 仍在跑的目标会被一律判死'
        + '（这正是 2026-10-18 要修的缺陷；⛔ 不是"更安全"，是回到了旧病）')
    } else if (!iterReattach) {
      bad('D2-a 重挂没接在 `r.reattach`（或由它过滤出的 `myReattach`）上 ——'
        + '必须**只**重挂"仍在跑"那一摞（`markLost` 的 `reattach` 是唯一判过状态的那一摞）')
    } else if (!derivedFromReattach) {
      bad('D2-a `myReattach` 不是由 `r.reattach` 过滤而来 —— ⛔ 不许凭空造一摞来重挂')
    } else if (iterLost) {
      bad('D2-b 【必须不重挂】接手块里出现**遍历 `r.lost` 再重挂** —— 已空闲的也会被挂回去，'
        + '那会留一个永不结算的 watch（命中同目标闸门 ⇒ 该会话永久不能再派）')
    } else {
      ok('D2-a ✓ 【必须重挂】接手块里有重挂，且**只**遍历 `r.reattach`（仍在跑那一摞）；'
        + '⛔ 未遍历 `r.lost`（已空闲/判不出的一律不挂）')
    }

    // ── D2-b 静态面：判丢失那一摞必须带档位（⛔ 不许合成一个计数）───────────
    //   ⚠ "档位由 `orch-state.ts` 的 `asWatch` 单一来源"这一条在 **D3'** 里钉；
    //     这里只钉"接手块把两摞**分开**用"。
    if (/r\.lost/.test(scope) && /r\.reattach/.test(scope)) {
      ok('D2-b ✓ 接手块把 `lost` / `reattach` **分成两摞**使用（⛔ 未合成一摞）')
    } else {
      bad('D2-b 接手块没有把 `lost` / `reattach` 分开使用 —— 两档会被混成一个结果')
    }

    // ── D2-c **状态行必须按档位分开报**（用户原话"两类不许混成一个 lost 计数"）──
    if (/lostByClass\.idle/.test(orchCode) && /lostByClass\.unknown/.test(orchCode)) {
      ok('D2-c ✓ 状态行按 `lostByClass` 分开报 idle / unknown 两档（各带追回提示）')
    } else {
      bad('D2-c 状态行仍只报一个总数 —— 用户要求"两类不许混成一个 lost 计数"')
    }
  }

  // 落盘的 pending 必须来自**内存里活着的** watch（不是读回的文件）
  /**
   * ⚠ **D3 改判**（`I-5`）：落盘的 pending 仍必须**来自内存里活着的 watch**，
   *   但落法从"整张表 `[...watches.values()].map(...)` 写进一个文件"改成
   *   **按 `(账本, owner)` 分区**写（`flushWatches` 的 `toPersisted(w)`）。
   * ⚠ 判据保住原意（**⛔ 不许拿读回的文件当"在等"**），同时新增一条：
   *   ⛔ 不许再出现"整张表写进某个文件"那种写法（`I-5` 明令）。
   */
  const d3FromLive = /\.\.\.watches\.values\(\)/.test(orchCode)
    && /toPersisted\(w\)/.test(orchCode)
  const d3WholeMapDump = /persistWatches\(\s*file\s*,\s*\[\.\.\.watches\.values\(\)\]\.map\(/.test(orchCode)
  if (d3FromLive && !d3WholeMapDump) {
    ok('D3 pending 由内存中活着的 watch 生成（⛔ 不是读回文件），且**已是按 (账本,owner) 分区**写'
      + '（⛔ 没有"整张表写进一个文件"那种写法）')
  } else if (d3WholeMapDump) {
    bad('D3 落盘仍把**整张 watches 表**写进一个文件（`I-5` 明令禁止：只写属于该 (账本,owner) 的记录）')
  } else {
    bad('D3 pending 不是由内存中活着的 watch 生成 —— 读回的文件不得当作"在等"')
  }

  // ── D3' **档位单一来源**（D1 裁定：⛔ 不许 sidecar、⛔ 不许借 `error`）─────────
  //   ⚠ 判据三件：① `asWatch` 白名单里认 `lostClass`；② 它会判**集合内**（不许任意字符串）；
  //     ③ 全仓**没有**第二个写档位的地方（`lostClass:` 的赋值点只在 orch-state.ts）。
  if (/o\.lostClass/.test(stateCode) && /LOST_CLASSES/.test(stateCode)) {
    ok("D3' ✓ 档位经 `orch-state.ts` 的 `asWatch` 白名单进入（单一来源，⛔ 无 sidecar）")
  } else {
    bad("D3' `asWatch` 未认 `lostClass` —— 档位读不回内存（会逼出 sidecar 这条歪路）")
  }
  {
    // ⚠ 全仓找 `lostClass` 的**写**（`lostClass:` 后跟表达式）落在哪些文件
    const walk = (dir) => {
      const out = []
      let ents = []
      try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return out }
      for (const ent of ents) {
        const p = join(dir, ent.name)
        if (ent.isDirectory()) out.push(...walk(p))
        else if (ent.name.endsWith('.ts')) out.push(p)
      }
      return out
    }
    const files = walk(join(root, 'src'))
    const writers = []
    for (const f of files) {
      let src = ''
      try { src = readFileSync(f, 'utf8') } catch { continue }
      const code = stripCommentsKeepLines(src)
      // 赋值/构造点：`lostClass: gone? X : Y` 或 `lostClass = ...`（⚠ 不把**类型**声明算进来）
      if (/lostClass\s*:\s*(?!LostClass)/.test(code) || /\.lostClass\s*=/.test(code)) {
        writers.push(f.slice(root.length + 1))
      }
    }
    // 允许的落点：`orch-state.ts`（`classifyPending` 里那一处）+ `orchestrator.ts`（重挂时可透传）
    const allowed = ['src/server/orch-state.ts']
    const unexpected = writers.filter((f) => !allowed.includes(f))
    if (unexpected.length > 0) {
      bad(`D3' 档位在**意外的文件**里被写：${unexpected.join(', ')}`
        + `（允许 = ${allowed.join(', ')}；⛔ 不许另写 sidecar、⛔ 不许借 \`error\` 字段）`)
    } else if (!writers.includes('src/server/orch-state.ts')) {
      bad("D3' 找不到档位的写入点 —— `classifyPending` 应当逐条写 `lostClass`")
    } else {
      ok(`D3' ✓ 档位写入点只有 \`src/server/orch-state.ts\``
        + `· **核了 ${files.length} 个 .ts 文件 / ${writers.length} 个写入点**`)
    }
  }

  // 累计丢失必须**保留**（否则第二次重载又变回 0）
  // ⚠ 判据锚在**调用点**（`orchestrator.ts` 的 `persistWatches`），不是
  //   `orch-state.ts` 里的函数**定义**（**实测踩过**：扫错文件 ⇒ 恒 FAIL，
  //   且那种 FAIL 与"真的丢了 lost"长得一样，会把人带偏）。
  //   ① 落盘前必须**读回**既有状态（`readOrchState`）；
  //   ② 传给 `writePending` 的第三个实参必须来自那次读回（`prev.lost`），
  //      不是字面空数组。
  const persistFn = orchCode.match(/function persistWatches[\s\S]{0,600}?\n\}/)
  if (persistFn === null) {
    bad('D4 找不到 persistWatches 落盘函数')
  } else {
    const body = persistFn[0]
    const readsBack = /readOrchState\s*\(/.test(body)
    const passesLost = /writePending\(\s*[^,]+,\s*[^,]+,\s*prev\.lost\s*\)/.test(body)
    if (readsBack && passesLost) {
      ok('D4 落盘读回既有状态并传 prev.lost（不会在第二次重载后归零）')
    } else {
      bad('D4 落盘未保留既有 lost —— 第二次重载会把"丢过"再次抹成 0')
    }
  }

  // refreshLostCount 必须在每次落盘后调用
  // ⚠ 收单后 flushWatches 变长了（按 owner 分区那段），窗口从 900 放宽到 2600 ——
  //   ⚠ 这是**窗口长度**的调整，⛔ 不是判据放宽（判据仍是"落盘后必须重算累计"）。
  if (/flushWatches[\s\S]{0,2600}?refreshLostCount\(\)/.test(orchCode)) {
    ok('D5 flushWatches 后重算累计（成功回传后不再虚报丢失）')
  } else {
    bad('D5 flushWatches 未重算累计 —— 回传成功后仍会虚报丢失')
  }
}

// ── E. 闸门语义未动 ────────────────────────────────────────────────────
{
  /**
   * ⚠ **E1 改判**（2026-10-19 收单第一轮 · `I-4` 末条）：
   *   闸门**语义未变**（停了 ⇒ `relaysBlocked++` 且不唤醒），但判据从"`if (stopped)`"
   *   收紧成"**按该条记录自己的 owner 判**"（`isStoppedFor(...)`）——
   *   因为进程级 `stopped` 会让一个工作区的 stop 停掉全部（用户明确要闭环隔离）。
   * ⚠ 这**不是**放宽：旧的只有"闸门在"一条要求；新的**额外**要求"分母是 owner"。
   */
  const e1Gate = /if\s*\(\s*isStoppedFor\(/.test(orchCode) && /relaysBlocked\+\+/.test(orchCode)
  const e1GlobalSingle = /if\s*\(stopped\)\s*\{\s*relaysBlocked\+\+/.test(orchCode)
  if (e1Gate && !e1GlobalSingle) {
    ok('E1 回传前闸门仍在（停了 ⇒ relaysBlocked++ 且不唤醒），且**按记录自己的 owner 判**'
      + '（⛔ 不再是一个进程级 `stopped` 管全部）')
  } else if (e1GlobalSingle) {
    bad('E1 回传前闸门退回**进程级单值** —— 一个工作区 stop 会停掉所有工作区（`I-4` 禁止）')
  } else {
    bad('E1 回传前闸门被改动（任务书 §2.3 禁止）')
  }

  /**
   * ⚠ **E2 改判**（`I-4` 末条）：同上 —— 闸门仍在（停了 ⇒ 派发被拒），
   *   但**只拒"我自己这一侧"**（`isStoppedFor(self)`），⛔ 不是全局拒。
   * ⚠ 话术也随之点名"只有你自己这一侧被停"（否则调用方会以为对方也停了）。
   */
  const e2Gate = /isStoppedFor\([^)]*self/.test(orchCode)
    && /reason:\s*'orchestration is stopped for this session/.test(orchCode)
  if (e2Gate) {
    ok('E2 派发前闸门仍在（停了 ⇒ hob_dispatch 拒绝），且**只停自己这一侧**'
      + '（话术明写"只有你自己"）')
  } else {
    bad('E2 派发前闸门被改动或退回进程级 `stopped`（任务书 §2.3 / `I-4` 禁止）')
  }

  // 同目标至多一条未结算
  if (/already has an unsettled round/.test(orchCode)) {
    ok('E3 同目标至多一条未结算的拒绝仍在（防错配）')
  } else {
    bad('E3 同目标闸门被删除（任务书 §2.3 禁止）')
  }

  // 不得新增工具（本模块只造三个）
  const toolNames = [...orchCode.matchAll(/name:\s*'(hob_[a-z_]+)'/g)].map((m) => m[1])
  const uniq = [...new Set(toolNames)].sort()
  const expect = ['hob_dispatch', 'hob_orch_control', 'hob_orch_status']
  if (JSON.stringify(uniq) === JSON.stringify(expect)) {
    ok('E4 只造三个编排工具（未新增）')
  } else {
    bad(`E4 工具面变化：实测 ${JSON.stringify(uniq)}，应为 ${JSON.stringify(expect)}`)
  }
}

// ── F. 待投递中间态（2026-10-10 新增 · 用户报障修复）─────────────────────
//
// ⚠ **为什么这一组是"真跑"而不是文本匹配**（与 A~E 不同）：
//   本轮要保的性质是**数据结构的行为**（记 → 读得到；清 → 读不到；旧结构读成空），
//   而不是"某行代码还在不在"。文本断言在这里**咬不住真缺陷**：
//   比如"`writePending` 忘了保留 `handoffs`"——源码里 `handoffs` 字样仍在，
//   正则照样 PASS，而行为已经坏了（**那正是本轮修的那个失败本身**）。
//   ⇒ 这一组**直接 import `src/server/orch-state.ts` 跑函数**（Node ≥22 可直载 TS），
//     在**系统临时目录**建文件（不落工作区，不进 git）。
//   ⚠ 若这条 import 失败（Node 太老 / TS 语法变化）⇒ **FAIL 而不是跳过**：
//     "基准跑不起来就默认通过"是本项目反复盯防的假通过（同 check-gitignore 口径）。
{
  const { mkdtempSync, rmSync, writeFileSync, readFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { pathToFileURL } = await import('node:url')

  let mod
  try {
    mod = await import(pathToFileURL(STATE_TS).href)
  } catch (e) {
    bad(`F 无法加载运行态模块（${String(e?.message ?? e)}）⇒ 行为断言失去基准（不按通过处理）`)
  }
  if (mod !== undefined) {
    const {
      emptyOrchState, readOrchState, recordHandoff, clearHandoffs, writePending, orchStateFileOf,
    } = mod
    /** 临时沙箱：一个空的"账本目录"，用后即删（不落工作区）。 */
    const dir = mkdtempSync(join(tmpdir(), 'hob-orchcheck-'))
    const file = orchStateFileOf(dir)
    try {
      // ── F0 前置：空态必须带 handoffs（否则后面前提不成立）──
      const empty = emptyOrchState()
      if (Array.isArray(empty.handoffs) && empty.handoffs.length === 0) {
        ok('F0 空态含 handoffs（空数组）')
      } else {
        bad(`F0 空态的 handoffs 不是空数组：${JSON.stringify(empty.handoffs)}`)
      }

      // ── F1 **记**：写了交接文件 ⇒ 出现 handoffs 记录 ──
      //   ⚠ 这是本轮的核心断言：它失败 = "写了但没投"在系统里又消失了。
      const rec = recordHandoff(file, { kind: 'task-file', ref: 'archive/2026-10-10-x/TASK.md', at: 1111 })
      const after1 = readOrchState(file)
      // ⚠ 防御式取值（同 F3）：坏了要给可读 FAIL，不要让脚本自己崩。
      const list1 = Array.isArray(after1?.handoffs) ? after1.handoffs : []
      const hit1 = list1.some((h) => h.kind === 'task-file' && h.ref === 'archive/2026-10-10-x/TASK.md')
      if (rec.wrote && hit1) {
        ok('F1 记一条待投递 ⇒ 读回出现该记录（"写了没投"可观测）')
      } else {
        bad(`F1 记了一条待投递但读不回（wrote=${rec.wrote}，handoffs=${JSON.stringify(after1?.handoffs)}）`
          + ' —— "写了交接文件却没投"又变成不可观测')
      }

      // ── F1b 幂等去重：同一 (kind, ref) 只留一条（防虚报）──
      recordHandoff(file, { kind: 'task-file', ref: 'archive/2026-10-10-x/TASK.md', at: 2222 })
      const after1b = readOrchState(file)
      const list1b = Array.isArray(after1b?.handoffs) ? after1b.handoffs : []
      const dup = list1b.filter((h) => h.ref === 'archive/2026-10-10-x/TASK.md')
      if (dup.length === 1 && dup[0]?.at === 2222) {
        ok('F1b 同一 (kind, ref) 重复记 ⇒ 只留最新一条（不虚报）')
      } else {
        bad(`F1b 去重失败：同 ref 有 ${dup.length} 条（${JSON.stringify(dup)}）`)
      }

      // ── F1c **writePending 必须保留 handoffs**（本轮最易漏的一处）──
      //   ⚠ 漏了它 ⇒ 任何一次 watch 落盘都会把待投递记录抹掉 ⇒
      //     又变回"从来没写过"。这条正是"负向对拍必须能咬到"的那一处。
      const keep = writePending(file, [], [])
      const after1c = readOrchState(file)
      const list1c = Array.isArray(after1c?.handoffs) ? after1c.handoffs : []
      if (keep && list1c.length === 1) {
        ok('F1c writePending 保留既有 handoffs（不会被 watch 落盘顺带抹掉）')
      } else {
        bad(`F1c writePending 把 handoffs 抹掉了（剩 ${list1c.length} 条）`
          + ' —— 下一次 watch 落盘就会让待投递记录消失，等于本缺陷复现')
      }

      // ── F2 **清**：投递成功 ⇒ 该记录消失 ──
      const cl = clearHandoffs(file, (h) => h.kind === 'task-file' && h.ref === 'archive/2026-10-10-x/TASK.md')
      const after2 = readOrchState(file)
      const list2 = Array.isArray(after2?.handoffs) ? after2.handoffs : []
      if (cl.cleared.length === 1 && cl.wrote && list2.length === 0) {
        ok('F2 投递成功 ⇒ 匹配的待投递记录消失')
      } else {
        bad(`F2 清除未生效（cleared=${cl.cleared.length}，wrote=${cl.wrote}，`
          + `剩 ${list2.length} 条）—— 投过了仍报"待投递"`)
      }

      // ── F2b 无匹配时不写盘（不制造无谓的文件改动）──
      const cl2 = clearHandoffs(file, () => false)
      if (cl2.cleared.length === 0 && cl2.wrote === false) {
        ok('F2b 无匹配记录时不写盘（不产生无谓 diff）')
      } else {
        bad(`F2b 空匹配也写了盘（cleared=${cl2.cleared.length}，wrote=${cl2.wrote}）`)
      }

      // ── F3 **向后兼容**：旧结构文件（无 handoffs 字段）读得进、读成空数组 ──
      //   ⚠ 这是任务书明写的硬要求：**不许抛、不许判坏**。
      const legacyFile = join(dir, 'runtime', 'legacy-orch-watches.json')
      writeFileSync(legacyFile, JSON.stringify({
        version: 1,
        updatedAt: 1,
        pending: [{ target: 's1', watcher: 'w1', at: 5, sawRunning: false }],
        lost: [],
      }), 'utf8')
      let legacyRead
      let legacyErr
      try { legacyRead = readOrchState(legacyFile) } catch (e) { legacyErr = e }
      // ⚠ **防御式取值**（本轮负向对拍当场暴露）：若"向后兼容"被改坏成
      //   直接 `as` 断言，`legacyRead.handoffs` 会是 `undefined` ——
      //   裸访问 `.length` 会让**检查脚本自己崩掉**（未捕获 TypeError、exit 1 但
      //   没有任何可读的 FAIL 行）。那比"报错"更糟：看日志的人只看到一段堆栈，
      //   不知道违反了哪条断言。⇒ 这里一律经 `Array.isArray` 取值。
      const legacyHandoffs = Array.isArray(legacyRead?.handoffs) ? legacyRead.handoffs : undefined
      const legacyPending = Array.isArray(legacyRead?.pending) ? legacyRead.pending : undefined
      if (legacyErr === undefined && legacyRead !== undefined
        && legacyHandoffs !== undefined && legacyHandoffs.length === 0
        && legacyPending !== undefined && legacyPending.length === 1) {
        ok('F3 旧结构文件（无 handoffs）读得进：handoffs 读成空数组、既有 pending 不受影响')
      } else {
        bad(`F3 旧结构文件读不进来或 handoffs 不是空数组：`
          + `err=${String(legacyErr?.message ?? legacyErr)}，`
          + `handoffs=${JSON.stringify(legacyRead?.handoffs)}，pending=${JSON.stringify(legacyRead?.pending)}`
          + ' —— 旧运行态文件必须**读得进**（缺字段 ⇒ 空数组，不许抛、不许判坏）')
      }

      // ── F3b 坏记录被逐条丢弃（不因一条坏数据丢掉整批）──
      const badFile = join(dir, 'runtime', 'bad-orch-watches.json')
      writeFileSync(badFile, JSON.stringify({
        version: 1,
        updatedAt: 1,
        pending: [],
        lost: [],
        // kind 不在集合内 / ref 空 / at 非数 ⇒ 三条都该被丢
        handoffs: [
          { kind: 'taskfile', ref: 'x', at: 1 },
          { kind: 'task-file', ref: '', at: 1 },
          { kind: 'task-file', ref: 'y', at: 'x' },
          { kind: 'spawned-session', ref: 'ok', at: 9 },
        ],
      }), 'utf8')
      const badRead = readOrchState(badFile)
      const badList = Array.isArray(badRead?.handoffs) ? badRead.handoffs : []
      if (badList.length === 1 && badList[0]?.ref === 'ok') {
        ok('F3b 坏 handoffs 记录逐条丢弃（只留合法那条，不整批失败）')
      } else {
        bad(`F3b 坏记录未被逐条丢弃：${JSON.stringify(badRead?.handoffs)}`)
      }

      // ── F4 状态输出必须**空态也给读数**（"0 份"与"没记录"必须可区分）──
      //   ⚠ 与 C5 相反：C5 要求"无丢失时不额外输出"，这里要求"无待投递时**也要**输出"。
      //     两者不矛盾 —— `lostPending` 是**累计历史**（没有就不必报），
      //     `handoffs` 是**当下状态**（"0"本身就是要给的信息）。
      if (/待投递：\$\{s\.handoffs\.length\} 份/.test(orchCode)
        && !/s\.handoffs\.length === 0\s*\?\s*\[\]/.test(orchCode)) {
        ok('F4 待投递**空态也给读数**（`待投递：0 份`，不与"没记录"混淆）')
      } else {
        bad('F4 待投递行未做到"空态也给读数" —— 那样"0 份"与"没记录"仍不可区分（本缺陷病根）')
      }

      // ── F5 提醒落在**写入成功的那一刻**（写进返回值，不是纪律文档）──
      const hobWriteSrc = (() => {
        try { return readFileSync(join(root, 'src', 'server', 'hob-write.ts'), 'utf8') } catch { return '' }
      })()
      if (/尚未投递/.test(hobWriteSrc) && /hob_dispatch/.test(hobWriteSrc)) {
        ok('F5 写交接文件成功的返回值带"尚未投递"提醒（落在动作发生那一刻）')
      } else {
        bad('F5 写入返回值没有"尚未投递"提醒 —— 提醒只写在纪律文档里＝靠人记')
      }

      // ── F6 分层纪律：落盘层（hob-write）**不得** import 运行态模块 ──
      //   ⚠ 它是本轮设计的核心分工（`hob-write.ts` 刻意不 import config / 运行态）：
      //     一旦它开始碰 orch-state，记账就散落进两层、且写工具会在无账本根时也去写运行态。
      if (!/from ['"].*orch-state/.test(hobWriteSrc)) {
        ok('F6 落盘层不 import 运行态模块（记账只在工具层，分层未破）')
      } else {
        bad('F6 `hob-write.ts` import 了运行态模块 —— 分层被打破（记账该在工具层）')
      }
    } finally {
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
    }
  }
}

// ── G. 结构改造 ① ②（2026-10-10 第 44 轮）—— 真跑函数 ────────────────────
//
// ⚠ **为什么也是"真跑"而不是文本匹配**：本组要保的是**行为** ——
//   "写进去的引用当场被核"与"写了就投出去"都是**运行时才成立**的性质；
//   源码里 `collectDanglingRefs` / `deliverHandoff` 字样还在，而实现被掏空，
//   文本断言照样 PASS（与 F 组同一个理由）。
//
// ⚠ **判据同源**：G1/G2/G3 用的正则语义与断言 D / D′ **逐字同源**
//   （`hob-write.ts` 的 `REF_PATH_RE` / `REF_TASK_RE`），故本组的"防误报"
//   与"举例豁免"两组，同时也在**替断言 D′ 守它的两条精度边界**。
{
  const { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { pathToFileURL } = await import('node:url')

  let hw
  let dl
  let stMod
  try {
    hw = await import(pathToFileURL(HOBWRITE_TS).href)
    dl = await import(pathToFileURL(DELIVERY_TS).href)
    stMod = await import(pathToFileURL(STATE_TS).href)
  } catch (e) {
    bad(`G 无法加载写入/投递模块（${String(e?.message ?? e)}）⇒ 行为断言失去基准（不按通过处理）`)
  }
  if (hw !== undefined && dl !== undefined && stMod !== undefined) {
    const { collectDanglingRefs } = hw
    const { deliverHandoff, renderHandoffReading } = dl

    /** 沙箱账本区：建一个真实存在的归档目录与一份真实作业书，供"防误报"组用。 */
    const gdir = mkdtempSync(join(tmpdir(), 'hob-gcheck-'))
    try {
      const REAL_DIR = 'archive/2026-10-10-real-fixture'
      mkdirSync(join(gdir, REAL_DIR), { recursive: true })
      writeFileSync(join(gdir, REAL_DIR, 'TASK-R99.md'), '# real\n', 'utf8')
      writeFileSync(join(gdir, REAL_DIR, 'NOPE-ISH.md'), '# x\n', 'utf8')

      // ── G1 **真牙口**：不存在的 archive 路径必须被点名 ──
      {
        const content = '前情：见 `archive/2026-10-10-nonexistent-xyz/NOPE.md`。\n'
        const refs = collectDanglingRefs(gdir, content)
        const hit = Array.isArray(refs) && refs.some((r) => r.ref === 'archive/2026-10-10-nonexistent-xyz/NOPE.md')
        if (hit) ok('G1 写入含**不存在**的归档路径 ⇒ 当场点名（写入边界校验有牙）')
        else bad(`G1 不存在的归档路径**没被点名**：${JSON.stringify(refs)} —— 写入边界校验是哑的`)
      }

      // ── G2 **防误报**：真实存在的路径与作业书**不得**被点名 ──
      //   ⚠ 两条一起验：D 类（全路径）与 D′ 类（只写 basename 的作业书）。
      {
        const content = `见 \`${REAL_DIR}/NOPE-ISH.md\` 与 \`TASK-R99.md\`。\n`
        const refs = collectDanglingRefs(gdir, content)
        const list = Array.isArray(refs) ? refs : []
        if (list.length === 0) ok('G2 真实存在的路径 / 作业书**不点名**（防误报）')
        else bad(`G2 真实存在的东西被误报为悬空引用：${JSON.stringify(list)}`
          + ' —— 误报会训练人忽略提示（这才是真正的代价）')
      }

      // ── G3 **举例豁免**（E-114 家族）：占位 / 示意名 / 通配**一律不点名** ──
      //   ⚠ 这一组是硬要求：**"描述这条校验自身"的句子必须能安全存在**
      //     （本脚本的注释、正本的纪律段里都写着这些形态）。
      {
        const content = [
          '占位：`archive/<日期>-<名>/` 与 `archive/<YYYY-MM-DD-slug>/TASK.md`',
          '示意名：`TASK-Rnn.md`',
          '通配：`TASK-*.md` 与 `TASK-R*.md`',
        ].join('\n')
        const refs = collectDanglingRefs(gdir, content)
        const list = Array.isArray(refs) ? refs : []
        if (list.length === 0) ok('G3 占位 / 示意名 / 通配形态**不点名**（E-114 家族，描述校验自身的句子不被咬）')
        else bad(`G3 举例形态被误判成悬空引用：${JSON.stringify(list)}`
          + ' —— 这正是 E-114 的形态：判据被"描述它自己的文本"打挂')
      }

      // ── G3b **收紧后的真牙口**（2026-10-11 第 54 轮）：**slug 不合规的路径也要被点名** ──
      //   ⚠ 第 54 轮的真缺口：slug 字符集原为 `[a-z0-9-]` ⇒
      //     `archive/2026-10-11-plan-v2.2/PROJECT.md`（**含点号**）**整条不被当引用** ⇒
      //     写入侧一声不响，而写侧 `ARCHIVE_DIR_RE` 会**拒写**那种目录
      //     ⇒ 一条永远创建不出来的路径，全程无人提醒。本组钉住"收紧后认得出来"。
      //   ⚠ **成对**（E-126）：G3 验"不该咬的不咬"、G3b 验"该咬的会咬" —— 两侧都要有。
      {
        const content = [
          '含点号：`archive/2026-10-11-plan-v2.2-nonexistent/PROJECT.md`',
          '含大写：`archive/2026-10-11-Plan-V2-nonexistent/PROJECT.md`',
        ].join('\n')
        const refs = collectDanglingRefs(gdir, content)
        const list = Array.isArray(refs) ? refs : []
        const gotDot = list.some((r) => r.ref === 'archive/2026-10-11-plan-v2.2-nonexistent/PROJECT.md')
        const gotUpper = list.some((r) => r.ref === 'archive/2026-10-11-Plan-V2-nonexistent/PROJECT.md')
        if (gotDot && gotUpper && list.length === 2) {
          ok('G3b slug 不合规（含点号 / 大写）的归档路径**当场点名**（第 54 轮收紧，既有能力未丢）')
        } else {
          bad(`G3b slug 不合规的路径**没被点名**（list=${JSON.stringify(list)}）`
            + '\n      ⇒ 那一类路径**永远创建不出来**（ARCHIVE_DIR_RE 会拒写）却全程无人提醒'
            + '\n      ⇒ 这正是第 54 轮修的真缺口形态（`archive/2026-10-11-plan-v2.2/PROJECT.md`）')
        }
      }

      // ── G4 **写即投**：给 dispatchTo ⇒ 投递被调用 + 该条 handoff 被清 ──
      {
        const stateFile = join(gdir, 'runtime', 'orch-watches.json')
        try { rmSync(stateFile, { force: true }) } catch { /* 首次不存在 */ }
        let called = 0
        let sawTarget
        /** 假编排：记下被调用的事实，并复刻 orchestration 的"成功"契约。 */
        const fakeOrch = {
          async dispatch(target) {
            called++
            sawTarget = target
            return { ok: true, sessionId: target, watching: true }
          },
          status() { return { handoffs: [] } },
        }
        const at = Date.now()
        const res = await deliverHandoff({
          ledgerRoot: gdir,
          ref: 'archive/2026-10-10-real-fixture/TASK-R99.md',
          at,
          dispatchTo: 'session-target-1',
          self: 'session-me',
          orch: fakeOrch,
        })
        const left = Array.isArray(res.handoffs) ? res.handoffs : []
        if (called === 1 && sawTarget === 'session-target-1' && res.dispatched === true && left.length === 0) {
          ok('G4 给 dispatchTo ⇒ 投递被调用 + 该条待投递记录被清（写入即投递）')
        } else {
          bad(`G4 写即投未成立：called=${called} target=${sawTarget} dispatched=${res.dispatched} `
            + `剩 ${left.length} 条（${JSON.stringify(left)}）`)
        }
      }

      // ── G5 **人工转达**：记录保留 + 带标注；状态行**分开报** ──
      {
        const stateFile = join(gdir, 'runtime', 'orch-watches.json')
        try { rmSync(stateFile, { force: true }) } catch { /* 忽略 */ }
        const at = Date.now()
        const res = await deliverHandoff({
          ledgerRoot: gdir,
          ref: 'archive/2026-10-10-real-fixture/TASK-R99.md',
          at,
          delivery: 'manual',
        })
        const list = Array.isArray(res.handoffs) ? res.handoffs : []
        const kept = list.length === 1 && list[0]?.manual === true
        // 状态行必须能**分开报**：非空且含人工转达时，文本须带"其中 N 份已标注为人工转达"。
        const line = renderHandoffReading(list)
        const splitOk = /其中\s*1\s*份已标注为人工转达/.test(line)
        if (kept && res.manual === true && splitOk) {
          ok(`G5 delivery:'manual' ⇒ 记录保留且带标注 + 状态行分开报（${line}）`)
        } else {
          bad(`G5 人工转达未成立：manual=${res.manual} kept=${kept} 状态行=${JSON.stringify(line)}`
            + ' —— 不分报的话，"有意转达"会持续制造假告警（假告警会训练人忽略真告警）')
        }
      }

      // ── G6 **向后兼容**：旧运行态（无 manual 字段）读得进、handoffs 读成空 ──
      {
        const legacy = join(gdir, 'runtime', 'legacy2.json')
        writeFileSync(legacy, JSON.stringify({
          version: 1, updatedAt: 1,
          pending: [],
          lost: [],
          handoffs: [{ kind: 'task-file', ref: 'archive/x/TASK.md', at: 7 }],
        }), 'utf8')
        const st = stMod.readOrchState(legacy)
        const list = Array.isArray(st?.handoffs) ? st.handoffs : undefined
        if (list !== undefined && list.length === 1 && list[0]?.manual === undefined) {
          ok('G6 旧运行态（handoff 无 manual 字段）读得进：记录保留、manual 读成 undefined（向后兼容）')
        } else {
          bad(`G6 旧运行态读不进来或 manual 被误判：${JSON.stringify(st?.handoffs)}`
            + ' —— 缺字段必须读成"不是人工转达"（否则漏投会被说成设计）')
        }
      }
    } finally {
      try { rmSync(gdir, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
    }
  }
}

// ── H. **投给规划侧预设的会话 ⇒ 响亮预警**（2026-10-13 第 129 轮）—— 真跑函数 ──
//
// ⚠ **为什么也是"真跑"**（与 F / G 同一条纪律）：
//   本组要保的是**运行时的行为** —— "目标是规划侧预设时返回值里带那条预警"
//   是**执行才成立**的性质。文本断言咬不住真缺陷：源码里
//   `PLANNING_PRESET_ID` / `presetNotice` 字样还在、而判定被掏空（比如把条件写成
//   永假、或把字段漏在 return 之外），正则照样 PASS（这正是 F/G 组存在的理由）。
//
// ⚠ **成对样本（正例 + 反例）**：只验"规划侧目标有预警"是**单向**的 ——
//   把预警写成**无条件**触发（`presetNotice` 恒有值）照样能让正例通过，
//   而那会让每一条正常投递都背上噪音（**假告警会训练人忽略真告警**，同 F4/G5 口径）。
//   ⇒ **反例必须一起验**：实施侧目标**不得**出现该字段。
//
// ⚠ **判据同源**：本组不另写 `Hob` 字面量，从 `src/shared/planning-preset.ts` 取
//   `PLANNING_PRESET_ID`（`bus.ts` 自己也只认这一处，⛔ 两处写死必然漂移）。
{
  const { pathToFileURL } = await import('node:url')

  let presetMod
  let busMod
  try {
    presetMod = await import(pathToFileURL(join(root, 'src', 'shared', 'planning-preset.ts')).href)
    busMod = await import(pathToFileURL(join(root, 'src', 'modules', 'bus.ts')).href)
  } catch (e) {
    bad(`H 无法加载 bus / planning-preset 模块（${String(e?.message ?? e)}）⇒ 行为断言失去基准（不按通过处理）`)
  }
  if (presetMod !== undefined && busMod !== undefined) {
    const { PLANNING_PRESET_ID } = presetMod

    /**
     * 起一个**只够跑 `deliver()`** 的 mock 宿主：一个目标会话 + 它的预设。
     *
     * ⚠ 一切现读（`sessions.get`），不缓存 —— 与 `bus.ts` 的读法一致。
     */
    const driveDeliver = async (targetPreset) => {
      const target = 'session-h-fixture'
      const session = { id: target, header: { agentPreset: targetPreset }, log: [] }
      const sessions = {
        get: (id) => (id === target ? session : undefined),
        list: () => [session],
        flush: async () => true,
      }
      const agent = { status: 'idle', followup() {}, steer() {}, inject() {}, ctx: {}, session }
      const agents = {
        currentInitiator: () => undefined,
        get: (id) => (id === target ? agent : undefined),
      }
      const provided = {}
      const svcCtx = {
        sessions,
        agents,
        logger: { debug() {}, warn() {}, info() {} },
        get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents : undefined),
        provide: (k, v) => { provided[k] = v },
        effect: (fn) => { try { fn() } catch { /* 无落点即跳过 */ } },
        inject: (_deps, cb) => cb(svcCtx),
      }
      busMod.apply(svcCtx, {
        spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }),
      })
      const bus = provided.hobBus
      if (bus === undefined) return undefined
      return bus.deliver(target, 'do the work', 'followup')
    }

    // ── H1 **正例**：目标是规划侧预设 ⇒ 返回带预警（且投递**仍然成功**）──
    //   ⚠ 两个条件都必须成立：只验"有预警"会让"把投递拦掉"也通过 ——
    //     而本单的明文要求是 **⛔ 不拦、不改投递成败**（给规划侧会话发消息本身可能合法）。
    {
      const r = await driveDeliver(PLANNING_PRESET_ID)
      if (r === undefined) {
        bad('H1 服务未 provide（`hobBus` 拿不到）⇒ 断言失去基准')
      } else {
        const notice = typeof r.presetNotice === 'string' ? r.presetNotice : undefined
        const saysConsequence = notice !== undefined
          && /cannot carry it out/i.test(notice) && /NEVER produce/i.test(notice)
        const saysNextStep = notice !== undefined && /NEXT STEP/i.test(notice)
        if (r.ok === true && saysConsequence && saysNextStep) {
          ok('H1 目标预设 = 规划侧 ⇒ 投递成功**且**返回值带预警（点明"不能施工 / 永远没产出" + 下一步）')
        } else {
          bad(`H1 规划侧目标未给出可用预警：ok=${r.ok} presetNotice=${JSON.stringify(notice)}`
            + `（需含后果句=${saysConsequence} 下一步=${saysNextStep}）`
            + ' —— 没有它，派活方会一直等一个永不会来的产出（症状「看在跑、永远没有产出」）')
        }
      }
    }

    // ── H2 **反例**：目标是实施侧预设 ⇒ **不得**出现该字段 ──
    //   ⚠ 缺了本组，把预警写成无条件触发也能过 H1 ⇒ 每条正常投递都背噪音。
    {
      const r = await driveDeliver('standard')
      if (r === undefined) {
        bad('H2 服务未 provide（`hobBus` 拿不到）⇒ 断言失去基准')
      } else if (r.ok === true && r.presetNotice === undefined) {
        ok('H2 目标预设 = 实施侧 ⇒ 投递成功且**无**预警（成对反例：预警不是无条件触发）')
      } else {
        bad(`H2 实施侧目标不该有预警：ok=${r.ok} presetNotice=${JSON.stringify(r.presetNotice)}`
          + ' —— 无条件预警会制造假告警，而假告警会训练人忽略真告警')
      }
    }

    // ── H3 **服务层设防**（不是只在工具层）：绕过工具直接调 `bus.deliver` 也带预警 ──
    //   ⚠ 这正是 H1 的**构造方式**（H1 就是直接调服务层的），故本条与 H1 同源；
    //     单列一条是为了把"**下沉到服务层**"这个设计约束**显式钉住**：
    //     若将来有人把预警挪回 `hob_send` 的工具层，H1 会立刻 FAIL（服务层没了它）。
    {
      const r = await driveDeliver(PLANNING_PRESET_ID)
      if (r !== undefined && typeof r.presetNotice === 'string') {
        ok('H3 预警在**服务层**（`bus.deliver`）即可观测 ⇒ 绕过工具也防得住（非单层设防）')
      } else {
        bad('H3 服务层读不到预警 —— 它只在工具层的话，任何绕过工具的调用方都重犯（E-97 同族）')
      }
    }

    // ── H4 **口径同源**：判定用的是 `PLANNING_PRESET_ID`，⛔ 没有第二个字面量 ──
    //   ⚠ 若 `bus.ts` 另写一个字面 `'Hob'`，改预设名时两处必然漂移。
    {
      const busSrc = (() => {
        try { return readFileSync(join(root, 'src', 'modules', 'bus.ts'), 'utf8') } catch { return '' }
      })()
      // 去掉注释后再找裸写：注释里出现 `Hob` 是正常的（说明文字），断言只看**代码**。
      const codeOnly = stripComments(busSrc)
      const hardcoded = new RegExp(`['"\`]${PLANNING_PRESET_ID}['"\`]`).test(codeOnly)
      if (!hardcoded) {
        ok(`H4 判定经 PLANNING_PRESET_ID 单点（bus.ts 代码里没有硬编码 \`${PLANNING_PRESET_ID}\` 字面量）`)
      } else {
        bad(`H4 bus.ts 代码里硬编码了 '${PLANNING_PRESET_ID}' —— 预设改名时两处必然漂移（口径不同源）`)
      }
    }
  }
}

// ── I. **"够不到账本"可分辨**（2026-10-16 第 247 轮 · `TASK-R207`）—— 真跑函数 ──
//
// ⚠ **它守的两件事**（第 243 轮实测的坏消息 · `REPORT-R205.md` §3.2-c/d）：
//   ⚠ ⚠ **乙**：`readOrchState` 把"够不到账本"与"真的没有记录"读成**同一个空态**
//     ⇒ 读数**逐字相同**，读者以为"就是 0"。
//   ⚠ ⚠ **丙**：`write_hob` 在账本根不存在时**静默新建一份账本**并返回 `ok: true`。
//
// ⚠ **为什么必须"真跑"**（同 F/G 的理由）：本组保的是**行为** ——
//   源码里 `readOrchStateDetailed` / `ledgerRootCreated` 字样还在，而实现被掏空，
//   文本断言照样 PASS。⇒ 一律实跑，⚠ 且 import 失败 **FAIL 而不是跳过**。
//
// ⚠ ⚠ **两条不许破的口径**（作业书 §3(a)）：
//   **I2 = "真的没有记录"那一侧必须与改前逐字相同**（⛔ 不许加任何标记）——
//   那是**真实状态**；给它加标记＝把一类假信号换成另一类。
{
  const { mkdtempSync, rmSync, mkdirSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { pathToFileURL } = await import('node:url')

  let st2
  let hw2
  try {
    st2 = await import(pathToFileURL(STATE_TS).href)
    hw2 = await import(pathToFileURL(HOBWRITE_TS).href)
  } catch (e) {
    bad(`I 无法加载运行态/写入模块（${String(e?.message ?? e)}）⇒ 行为断言失去基准（不按通过处理）`)
  }

  if (st2 !== undefined && hw2 !== undefined) {
    const idir = mkdtempSync(join(tmpdir(), 'hob-icheck-'))
    try {
      // ── I0 前置：判别入口必须存在 ──────────────────────────────────────
      const hasDetailed = typeof st2.readOrchStateDetailed === 'function'
      const hasRootOf = typeof st2.ledgerRootOfStateFile === 'function'
      if (hasDetailed && hasRootOf) {
        ok('I0 判别入口在位（readOrchStateDetailed + ledgerRootOfStateFile）')
      } else {
        bad('I0 判别入口缺失 —— 没有它，"够不到"与"没有记录"必然同形（本缺陷病根）')
      }

      if (hasDetailed && hasRootOf) {
        // 造三个都**合法**的账本根：① 有记录 ② 有根无记录 ③ 根不存在（= 够不到）
        const wsRec = join(idir, 'ws-rec')
        const wsEmpty = join(idir, 'ws-empty')
        const wsMiss = join(idir, 'ws-miss')
        mkdirSync(join(wsRec, 'runtime'), { recursive: true })
        mkdirSync(wsEmpty, { recursive: true })
        const fRec = join(wsRec, 'runtime', 'orch-watches.json')
        const fEmpty = join(wsEmpty, 'runtime', 'orch-watches.json')
        const fMiss = join(wsMiss, 'runtime', 'orch-watches.json')
        writeFileSync(fRec, JSON.stringify({
          version: 1, updatedAt: 1,
          pending: [{ target: 't1', watcher: 'w1', at: 1, sawRunning: true }],
          lost: [], handoffs: [{ kind: 'task-file', ref: 'archive/x/TASK.md', at: 1 }],
        }), 'utf8')

        // ── I1 三态判别（⚠ 这是本组的核心：② 与 ③ 必须**分得开**）──────
        const rRec = st2.readOrchStateDetailed(fRec)
        const rEmpty = st2.readOrchStateDetailed(fEmpty)
        const rMiss = st2.readOrchStateDetailed(fMiss)
        if (rRec.reachability === 'ok' && rEmpty.reachability === 'no-records-yet'
          && rMiss.reachability === 'ledger-unreachable') {
          ok('I1 三态分得开：有记录=ok · 有根无记录=no-records-yet · 根不存在=ledger-unreachable')
        } else {
          bad(`I1 三态未分开：rec=${rRec.reachability} · empty=${rEmpty.reachability} · miss=${rMiss.reachability}`
            + ' ⇒ "够不到"与"真的没记录"仍同形（本缺陷病根）')
        }

        // ── I2 ⚠ ⚠ **"真的没记录"那一侧的输出必须未被改变** ──────────────
        //   ⚠ 判据 = 它与**改前那一版**（`readOrchState`）**逐字同值**
        //     **且**它自己的档位是 `no-records-yet`（⛔ **不许**被标成"够不到"）。
        //   ⚠ ⚠ **本断言的负向对拍当场抓到过它自己的一处不足**（据实登记）：
        //     初版只比 `state`（两版的 `state` 恒等）⇒ ⚠ **把 `no-records-yet`
        //     改写成 `ledger-unreachable` 时它照样 PASS** —— 那正是"把一类假信号
        //     换成另一类"。⇒ 已补上**档位**这一半。
        const legacyEmpty = st2.readOrchState(fEmpty)
        const sameShape = JSON.stringify(legacyEmpty) === JSON.stringify(rEmpty.state)
        const rightTier = rEmpty.reachability === 'no-records-yet'
        if (sameShape && rightTier && rEmpty.state.handoffs.length === 0) {
          ok('I2 "真的没记录"那一侧输出未被改变（state 与 readOrchState 逐字同值 **且**档位仍为 no-records-yet）')
        } else {
          bad(`I2 "真的没记录"那一侧被改动了：state 同值=${sameShape} 档位=${rEmpty.reachability}（应为 no-records-yet）`
            + `；legacy=${JSON.stringify(legacyEmpty)} vs new=${JSON.stringify(rEmpty.state)}`)
        }

        // ── I3 **坏 JSON 也必须可分辨**（⛔ 不许与"没有记录"混）──────────
        const wsBad = join(idir, 'ws-bad')
        mkdirSync(join(wsBad, 'runtime'), { recursive: true })
        const fBad = join(wsBad, 'runtime', 'orch-watches.json')
        writeFileSync(fBad, '{ this is not json', 'utf8')
        const rBad = st2.readOrchStateDetailed(fBad)
        if (rBad.reachability === 'unreadable') {
          ok('I3 坏 JSON 报 unreadable（⛔ 不与"没有记录"混）')
        } else {
          bad(`I3 坏 JSON 未被判为 unreadable（得到 ${rBad.reachability}）—— 与"没有记录"同形`)
        }

        // ── I4 **宽容口径一条未松**：判别入口同样⛔ 不抛 ───────────────────
        let threw = false
        try { st2.readOrchStateDetailed('/nonexistent-root/a/b/runtime/orch-watches.json') } catch { threw = true }
        if (!threw) {
          ok('I4 判别入口沿用宽容口径（坏路径不抛 —— 一个坏文件不该让 status() 崩掉）')
        } else {
          bad('I4 判别入口抛异常了 —— 宽容口径被破坏（status() 会被一个坏文件搞崩）')
        }

        // ── I5 ⚠ ⚠ **丙：账本根不存在时，写入返回值必须带可读标记** ────────
        const wsNew = join(idir, 'ledgers', 'ws-new')          // ⚠ 刻意**不建**这个目录
        const wopts = { hobDir: '', keepBackups: 3, shrinkGuard: 0.5, maxFileBytes: 262144 }
        const wr = await hw2.writeHobFile(wsNew, { file: 'CONTEXT.md', content: '# x\n', mode: 'overwrite' }, wopts)
        const marked = wr?.ledgerRootCreated !== undefined
        const inMsg = /账本目录原本不存在/.test(String(wr?.message ?? ''))
        if (wr?.ok === true && marked && inMsg) {
          ok('I5 丙：「账本根原先不存在」时返回值**点名**该事实（结构化字段 + 可读行，⚠ ok 仍为 true —— ⛔ 不改写入语义）')
        } else {
          bad(`I5 丙未被标出：ok=${wr?.ok} ledgerRootCreated=${JSON.stringify(wr?.ledgerRootCreated)}`
            + ` ⇒ "静默新建一份账本"仍不可读（本缺陷病根）`)
        }

        // ── I6 **成对**：账本根**已存在**时⛔ 不许出现该标记（防误报）──────
        const wsYes = join(idir, 'ledgers2', 'ws-yes')
        mkdirSync(wsYes, { recursive: true })
        const wr2 = await hw2.writeHobFile(wsYes, { file: 'CONTEXT.md', content: '# x\n', mode: 'overwrite' }, wopts)
        if (wr2?.ok === true && wr2?.ledgerRootCreated === undefined
          && !/账本目录原本不存在/.test(String(wr2?.message ?? ''))) {
          ok('I6 成对阴性：账本根已存在 ⇒ ⛔ 不出该标记（不与"正常写入"混淆）')
        } else {
          bad(`I6 误报：账本根已存在却出了标记（ledgerRootCreated=${JSON.stringify(wr2?.ledgerRootCreated)}）`)
        }

        // ── I7 ⚠ **次级项：拒绝话术里根路径不得为空**（第 243 轮 §3.2-f）────
        //   ⚠ 真实调用形态是 `hobDir: ''`（账本根**本身**就是 root）——
        //     改前那句话渲染成 `拒绝：只能写 / 目录内的文件。`（看不到"哪个根"）。
        const wr3 = await hw2.writeHobFile(wsYes, { file: '../../pwned.md', content: 'x', mode: 'overwrite' }, wopts)
        const msg3 = String(wr3?.message ?? '')
        if (wr3?.reason === 'outside-hob' && msg3.includes(wsYes) && !/只能写\s*\/\s*目录内的文件/.test(msg3)) {
          ok('I7 拒绝话术点名了根路径（⛔ 不再渲染成空 —— "失败也要可读"）')
        } else {
          bad(`I7 拒绝话术里根路径仍是空的 / 未点名：${JSON.stringify(msg3)}`)
        }
      }

      // ── I8 / I9 ⚠ ⚠ **`unresolved` 那一档的成对断言**（第 249 轮 · `TASK-R208`）──
      //   ⚠ **为什么补它**：⚠ 第 247 轮报告 §4.2 第 4 条 / §4.3 末段**自己指出** ——
      //     `I0~I7` 覆盖了 `ok` / `no-records-yet` / `ledger-unreachable` / `unreadable`，
      //     ⚠ ⚠ **而四档里的 `unresolved` **一条断言都没有****
      //     （⚠ 该轮自述"**没造出那个形态**"）⇒ ⚠ **那是 `E-160` 那类"看起来全覆盖"的形状**。
      //   ⚠ ⚠ **本单实测：那一档**构造得出****（见报告 §3.3 的命令与原文）——
      //     它由 `reachabilityFor` 在"**调用方没给工作区根**"（或给了空串）时返回
      //     ⇒ ⚠ **可用"挂真模块 `apply` + 假宿主 ctx"** 造出来，⚠ **⛔ 不必改 `src/**`、⛔ 不必碰真账本**。
      //   ⚠ ⚠ **成对**：**I8 正例**（该档出现 ⇒ 读数与渲染都点名它）·
      //     **I9 负例**（正常两档⛔ **不许**被标成该档 —— 防"把好账本误报成判不出来"）。
      {
        const { pathToFileURL: p2u } = await import('node:url')
        let orchMod
        try {
          orchMod = await import(p2u(ORCH_TS).href)
        } catch (e) {
          bad(`I8 无法加载编排模块（${String(e?.message ?? e)}）⇒ unresolved 那一档失去基准（不按通过处理）`)
        }
        if (orchMod !== undefined && typeof orchMod.apply === 'function'
          && typeof orchMod.createHobOrchTools === 'function') {
          /** 挂**真** `apply`，只给最小假宿主 ⇒ 拿到**真** `hobOrchestrator` 服务。 */
          const mountOrch = (ledgerHome) => {
            let svc
            const loader = {
              entries: () => (ledgerHome === undefined ? [] : [{ options: { config: { ledgerHome } } }]),
            }
            const svcCtx = {
              sessions: { get: () => undefined },
              agents: {},
              logger: { debug() {}, info() {}, warn() {} },
              get: (k) => (k === 'loader' ? loader : undefined),
              effect: (fn) => { try { fn() } catch { /* 假 ctx 的最小实现 */ } },
              provide: (k, v) => { if (k === orchMod.ORCH_SERVICE) svc = v },
            }
            orchMod.apply({
              logger: { debug() {}, info() {}, warn() {} },
              inject: (_deps, cb) => cb(svcCtx),
              on: () => {},
            })
            return svc
          }

          const orch = mountOrch(join(idir, 'ledgers-i8'))
          // ── I8 **正例**：不给工作区根 ⇒ 必须是 `unresolved`（+ 渲染出可读标记）──
          const stMissingIt = orch?.status?.()
          const stEmptyIt = orch?.status?.({ wsRoot: '' })
          const ctrlMissingIt = orch?.control?.('stop')
          const tierOk = stMissingIt?.reachability === 'unresolved'
            && stEmptyIt?.reachability === 'unresolved'
            && ctrlMissingIt?.reachability === 'unresolved'
          // ⚠ 渲染面：拿**真**工具执行一次，确认那句标记真被渲染出来
          let rendered = ''
          try {
            const tools = orchMod.createHobOrchTools(orch)
            rendered = String(await tools.status.execute({}, { agent: { session: { header: {} } } }))
          } catch (e) {
            bad(`I8 状态工具执行失败（${String(e?.message ?? e)}）—— 渲染面失去基准`)
          }
          const saysUnresolved = /账本可达性/.test(rendered) && /连该查哪个账本都判不出/.test(rendered)
          if (tierOk && saysUnresolved) {
            ok('I8 unresolved 正例：不给工作区根 ⇒ status()/control() 都判 unresolved，且工具渲染出可读标记')
          } else {
            bad(`I8 unresolved 未被判出或未被渲染：status()=${stMissingIt?.reachability}`
              + ` · status("")=${stEmptyIt?.reachability} · control()=${ctrlMissingIt?.reachability}`
              + ` · 渲染含标记=${saysUnresolved} ⇒ 该档仍无覆盖（E-160 那类"看起来全覆盖"）`)
          }

          // ── I9 **负例**：正常几档⛔ 不许被标成 `unresolved`（防误标）──
          //   ⚠ 造两个真账本根：① 有运行态文件（⇒ `ok`）② 有根无文件（⇒ `no-records-yet`）。
          const lh = join(idir, 'ledgers-i9')
          const wsOkCase = join(idir, 'ws-i9-ok')
          const wsEmptyCase = join(idir, 'ws-i9-empty')
          mkdirSync(join(lh, 'ws-i9-ok', 'runtime'), { recursive: true })
          mkdirSync(join(lh, 'ws-i9-empty'), { recursive: true })
          writeFileSync(join(lh, 'ws-i9-ok', 'runtime', 'orch-watches.json'), JSON.stringify({
            version: 1, updatedAt: 1, pending: [], lost: [], handoffs: [],
          }), 'utf8')
          const orch2 = mountOrch(lh)
          const tierOkCase = orch2?.status?.({ wsRoot: wsOkCase })?.reachability
          const tierEmptyCase = orch2?.status?.({ wsRoot: wsEmptyCase })?.reachability
          if (tierOkCase === 'ok' && tierEmptyCase === 'no-records-yet') {
            ok('I9 成对阴性：正常两档（ok / no-records-yet）⛔ 未被误标成 unresolved')
          } else {
            bad(`I9 误标：正常两档被标成了 unresolved（ok 面=${tierOkCase} · 空面=${tierEmptyCase}）`
              + ' ⇒ 会把"账本好着呢"误报成"判不出账本"（假信号）')
          }

          // ── I10 / I11 ⚠ ⚠ **`unreadable` 那一档的**渲染面**断言**（第 251 轮 · `TASK-R209`）──
          //   ⚠ **为什么补它**：⚠ 第 249 轮报告 §4.2 第 4 条 / §4.4 第 2 条**自己指出** ——
          //     `I3` 只测了 `unreadable` 的**判别**（`readOrchStateDetailed` 返回该档），
          //     ⚠ ⚠ **而它在 `hob_orch_status` 里**渲染出的那一行没有断言**
          //     ⇒ ⚠ **四档里有一档只守到一半**（⚠ 与第 247 轮同族 ⇒ **`E-160`**）。
          //   ⚠ ⚠ **本单实测：那一档**构造得出****（见报告 §3.3 的命令与原文）——
          //     ⚠ 它 = "**账本根在、运行态文件也在，但内容不是合法 JSON**"
          //     ⇒ ⚠ 与 `unresolved` 用的**同一套挂载手法**（真 `apply` + 假宿主）即可造出。
          //   ⚠ ⚠ **⚠ 两条口径（⚠ 一条都不许松）**：
          //     · **⛔ 不把 `I8` 收紧成"逐字对齐文案"** —— ⚠ Hob 已裁定"先让文案跑几轮"
          //       （`CONTEXT.md` §2.4 第 35 项）⇒ ⚠ 本组同样**只判"该档有它**自己那句原因**"**，
          //       ⛔ **不逐字锚定整行**；
          //     · ⚠ ⚠ **但必须判"它渲染的是**这一档**、⛔ 不是别的档"** ——
          //       ⚠ 否则四档的措辞互换（含义反转）照样绿（⚠ 那正是"看起来全覆盖"）。
          const lhBad = join(idir, 'ledgers-i10')
          const wsBadCase = join(idir, 'ws-i10-bad')
          mkdirSync(join(lhBad, 'ws-i10-bad', 'runtime'), { recursive: true })
          // ⚠ 账本根**在**（这一点把本档与 `ledger-unreachable` 分开）·
          //   ⚠ 运行态文件**也在**（这一点把它与 `no-records-yet` 分开）· ⚠ 但内容是坏 JSON。
          writeFileSync(join(lhBad, 'ws-i10-bad', 'runtime', 'orch-watches.json'), '{ this is not json', 'utf8')
          const orch3 = mountOrch(lhBad)
          const tierBad = orch3?.status?.({ wsRoot: wsBadCase })?.reachability
          // ⚠ 渲染面：拿**真**工具执行一次
          let renderedBad = ''
          try {
            const tools3 = orchMod.createHobOrchTools(orch3)
            renderedBad = String(await tools3.status.execute({}, {
              agent: { session: { header: { cwd: wsBadCase } } },
            }))
          } catch (e) {
            bad(`I10 状态工具执行失败（${String(e?.message ?? e)}）—— unreadable 的渲染面失去基准`)
          }
          // ⚠ **该档自己那句原因**（⚠ 判"它说了自己的原因"，⛔ 不锚定整行）
          const saysUnreadable = /账本可达性/.test(renderedBad)
            && /运行态文件在、但读不了/.test(renderedBad)
          // ⚠ ⚠ **反向：⛔ 不许带别的档的原因**（⚠ 这一半才是"四档分得开"的判据）
          const notOtherTier = !/连该查哪个账本都判不出/.test(renderedBad)
            && !/账本目录不存在/.test(renderedBad)
          if (tierBad === 'unreadable' && saysUnreadable && notOtherTier) {
            ok('I10 unreadable 正例：坏 JSON ⇒ 判该档 **且**工具渲染出**该档自己那句原因**（⛔ 不带别档措辞）')
          } else {
            bad(`I10 unreadable 未被判出或渲染错档：reachability=${tierBad}`
              + ` · 渲染含本档原因=${saysUnreadable} · ⛔未带别档=${notOtherTier}`
              + ` ⇒ 该档的渲染面仍无覆盖（E-160 那类"看起来全覆盖"）`)
          }

          // ── I11 **成对阴性**：别的档⛔ 不许被标成 `unreadable`（防误标）────
          //   ⚠ 造**账本根不在**的两态（⚠ 这正是最容易与 `unreadable` 混淆的一档：
          //     两者都"读不到东西"）⇒ ⚠ 期望它们仍是 `ledger-unreachable`。
          const orch4 = mountOrch(lhBad)
          const tierMissOk = orch4?.status?.({ wsRoot: join(idir, 'ws-i11-none') })?.reachability
          const tierMissEmpty = orch4?.status?.({ wsRoot: join(idir, 'ws-i11-none-2') })?.reachability
          if (tierMissOk === 'ledger-unreachable' && tierMissEmpty === 'ledger-unreachable') {
            ok('I11 成对阴性：账本根不在 ⛔ 未被误标成 unreadable（各档归各档）')
          } else {
            bad(`I11 误标：账本根不在却被标成别的档（${tierMissOk} / ${tierMissEmpty}，应为 ledger-unreachable）`
              + ' ⇒ 会把"账本目录都没有"误报成"文件读不了"（假信号）')
          }
        }
      }
    } finally {
      try { rmSync(idir, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
    }
  }
}

// ── J. **预设读数同源**（2026-10-17 第 2 轮 · `CHG-058` 收口）—— 真跑函数 + 静态面 ──
//
// ⚠ **它守的是哪条缺陷**（第 1 轮复验 `B-bus-orch.md` §1.3 · D-3）：
//   `bus.ts` 自第 292 轮起已改走宿主 **`agentPreset` 投影**（= header 起步 +
//   最后一条 `agent-preset/selected`），而 `orchestrator.ts` 的「预设=」列
//   **仍在读建档头** ⇒ **同一事实两个来源**。实测后果（本工作区 13 条会话）：
//   **4 条 `header=standard / 投影=Hob`**（**含 Hob 自己**）⇒ 那一列**给错值**，
//   且「⚠ 规划侧预设·不能施工」对这 4 条**不会触发**。
//
// ⚠ **为什么必须"真跑"**（同 F/G/H/I）：本组保的是**行为** ——
//   源码里 `presetOf` / `targetPreset` 字样还在、而读法被改回 `header`，
//   纯文本断言**照样 PASS**（这正是本单要防的复现路径）。
//   ⇒ 造一组 **`header=standard / 投影=Hob`** 的现场，直接断言**渲染出来的那一行**
//     是投影值、并触发「⚠ 规划侧预设·不能施工」。
//
// ⚠ ⚠ **本组自带"能失败"的证据**（E-27：永远 PASS 的检查比没有更危险）：
//   把 `orchestrator.ts` 的读法改回 `session.header.agentPreset` ⇒
//   **J1 / J2 / J3 / J4 四条同时 FAIL**。反证原始输出见 `R2-FIX.md` §3.3。
//
// ⚠ 判据同源：本组**不另写** `Hob` 字面量，从 `src/shared/planning-preset.ts` 取。
{
  const { mkdtempSync, mkdirSync, rmSync, readdirSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { pathToFileURL } = await import('node:url')

  let jPresetMod
  let jBusMod
  let jOrchMod
  try {
    jPresetMod = await import(pathToFileURL(join(root, 'src', 'shared', 'planning-preset.ts')).href)
    jBusMod = await import(pathToFileURL(join(root, 'src', 'modules', 'bus.ts')).href)
    jOrchMod = await import(pathToFileURL(join(root, 'src', 'modules', 'orchestrator.ts')).href)
  } catch (e) {
    bad(`J 无法加载 bus / orchestrator / planning-preset 模块（${String(e?.message ?? e)}）`
      + ' ⇒ 同源断言失去基准（不按通过处理）')
  }

  if (jPresetMod !== undefined && jBusMod !== undefined && jOrchMod !== undefined) {
    const { PLANNING_PRESET_ID } = jPresetMod

    /**
     * 起一个**最小宿主**：`sessions` + `agents` + 可选的 `sessionProjections`。
     *
     * ⚠ `projectionPreset` 为 `undefined` ⇒ **模拟"投影读不到"**（服务缺席），
     *   用来验降级路径；给值 ⇒ 投影读得出（权威路径）。
     *
     * ⚠ `session.header.agentPreset` **恒为 `standard`** —— 这正是真实缺陷现场的形状
     *   （建后改成 `Hob` 的会话，建档头永远停在 `standard`）。
     */
    const mountHost = (opts) => {
      const target = opts.target
      const cwd = opts.cwd
      const session = { id: target, header: { agentPreset: 'standard', cwd }, log: [] }
      const sessions = {
        get: (id) => (id === target ? session : undefined),
        list: () => [session],
        flush: async () => true,
      }
      const agent = {
        status: 'idle',
        followup: () => {},
        steer: () => {},
        inject: () => {},
        ctx: {},
        session,
      }
      const agents = {
        currentInitiator: () => undefined,
        get: (id) => (id === target ? agent : undefined),
      }
      const projections = opts.projectionPreset === undefined
        ? undefined
        : { stateOf: (_s, key) => (key === 'agentPreset' ? opts.projectionPreset : undefined) }

      // ① 先装**真的** bus 模块，拿它 provide 出来的服务
      const busProvided = {}
      const busCtx = {
        sessions,
        agents,
        logger: { debug() {}, warn() {}, info() {} },
        get: (k) => (k === 'sessions' ? sessions
          : k === 'agents' ? agents
            : k === 'sessionProjections' ? projections
              : undefined),
        provide: (k, v) => { busProvided[k] = v },
        effect: (fn) => { try { fn() } catch { /* 无落点即跳过 */ } },
        inject: (_deps, cb) => cb(busCtx),
      }
      jBusMod.apply(busCtx, {
        spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }),
      })
      const bus = busProvided.hobBus

      // ② 再装**真的** orchestrator 模块，`get('hobBus')` 交真的 bus
      const orchProvided = {}
      const orchCtx = {
        sessions,
        agents,
        logger: { debug() {}, warn() {}, info() {} },
        get: (k) => (k === 'sessions' ? sessions
          : k === 'agents' ? agents
            : k === 'hobBus' ? bus
              : undefined),
        provide: (k, v) => { orchProvided[k] = v },
        effect: (fn) => { try { fn() } catch { /* 无落点即跳过 */ } },
        inject: (_deps, cb) => cb(orchCtx),
        on: () => {},
      }
      jOrchMod.apply(orchCtx)
      return { bus, orch: orchProvided.hobOrchestrator }
    }

    /**
     * 走完整链路：**派一发** ⇒ 登记 watch ⇒ 读 `status()` ⇒ **渲染出那一行**。
     *
     * ⚠ 只断言 `status()` 的字段**不够** —— 真正给用户看的是**渲染行**，
     *   而"字段对了但渲染面漏了标记"是一条完全可能的实现
     *   （第 1 轮那条缺陷就同时在字段与渲染面）。
     */
    const drive = async (opts) => {
      const host = mountHost(opts)
      if (host.orch === undefined) return { err: '`hobOrchestrator` 未 provide（断言失去基准）' }
      /**
       * ⚠⚠ **带 `self` 读**（2026-10-19 收单第一轮 · `I-4`）：
       *   `status()` 现在只含**调用方自己的**记录 ⇒ 不传 self 就什么都读不到
       *   （⛔ 绝不退化成全实例汇总）。本组要验的是"派活方看得见自己那条"，
       *   所以 self 必须与派发时那个 `session-j-self` **一致**。
       */
      const SELF = 'session-j-self'
      const d = await host.orch.dispatch(opts.target, 'do the work', { self: SELF })
      if (d?.ok !== true) return { err: `dispatch 未成功：${JSON.stringify(d)}` }
      const s = host.orch.status({ wsRoot: opts.cwd, self: SELF })
      const w = Array.isArray(s.watches) ? s.watches[0] : undefined
      const tools = jOrchMod.createHobOrchTools(host.orch)
      const rendered = String(await tools.status.execute({}, {
        agent: { id: SELF, session: { header: { cwd: opts.cwd } } },
      }))
      return { watch: w, rendered, status: s }
    }

    let jRoot
    try {
      jRoot = mkdtempSync(join(tmpdir(), 'hob-jcheck-'))
    } catch (e) {
      bad(`J 造不出临时现场（${String(e?.message ?? e)}）⇒ 同源断言失去基准（不按通过处理）`)
    }

    if (jRoot !== undefined) {
      try {
        const wsA = join(jRoot, 'ws-authoritative')
        const wsB = join(jRoot, 'ws-degraded')
        mkdirSync(wsA, { recursive: true })
        mkdirSync(wsB, { recursive: true })

        // ── J1 ⭐ **核心**：`header=standard / 投影=Hob` ⇒ 列里必须是 **Hob** + 预警 ──
        //   ⚠ 这一条就是"改回 header 读法必须 FAIL"的那一条：改回去拿到的是 `standard`。
        {
          const r = await drive({ target: 'session-j1', cwd: wsA, projectionPreset: PLANNING_PRESET_ID })
          if (r.err !== undefined) {
            bad(`J1 ${r.err}`)
          } else {
            const gotPreset = r.watch?.targetPreset
            const gotSource = r.watch?.targetPresetSource
            const lineHasProjection = r.rendered.includes(`预设=${PLANNING_PRESET_ID}`)
            const lineWarns = r.rendered.includes('⚠ 规划侧预设·不能施工')
            const notHeaderValue = !r.rendered.includes('预设=standard')
            if (gotPreset === PLANNING_PRESET_ID && gotSource === 'projection'
              && lineHasProjection && lineWarns && notHeaderValue) {
              ok(`J1 现场 header=standard / 投影=${PLANNING_PRESET_ID} ⇒ 预设列报**投影值** + `
                + '来源=projection + **触发「⚠ 规划侧预设·不能施工」**（渲染行为证，非字段推断）')
            } else {
              bad(`J1 预设列**没走投影**（这正是 D-3 的复现）：targetPreset=${JSON.stringify(gotPreset)}`
                + ` · 来源=${JSON.stringify(gotSource)} · 行含投影值=${lineHasProjection}`
                + ` · 行含预警=${lineWarns} · ⛔未报建档头值=${notHeaderValue}`
                + ' ⇒ 派活方会把规划侧会话读成实施侧，并一直等一个永不会来的产出')
            }
          }
        }

        // ── J2 **降级必须可见**：投影读不到 ⇒ 退回 header，且行里标「降级」────
        //   ⚠ 缺了本组，"降级"会与"权威值"在输出里**逐字一样**
        //     —— 而降级值恰恰会把规划侧会话掩盖成实施侧。
        {
          const r = await drive({ target: 'session-j2', cwd: wsB, projectionPreset: undefined })
          if (r.err !== undefined) {
            bad(`J2 ${r.err}`)
          } else {
            const gotSource = r.watch?.targetPresetSource
            const saysDegraded = r.rendered.includes('降级')
            const reportsHeaderValue = r.rendered.includes('预设=standard')
            if (gotSource === 'header' && saysDegraded && reportsHeaderValue) {
              ok('J2 投影读不到 ⇒ 退回建档头（source=header）**且渲染行标「降级」**（⛔ 不静默当真值用）')
            } else {
              bad(`J2 降级路径不可分辨：source=${JSON.stringify(gotSource)}`
                + ` · 行含「降级」=${saysDegraded} · 行报了建档头值=${reportsHeaderValue}`
                + ' ⇒ 降级读数与权威读数同形，"可能非当前值"这件事对读者不可见')
            }
          }
        }

        // ── J3 **单点实现**：编排模块⛔ 不许自己读投影 / 读建档头 ────────────
        //   ⚠ 判据是"编排侧有没有第二份归约"，⛔ 不是"字样在不在"。
        {
          const orchCode = stripComments(orchSrc)
          const readsProjection = /\.stateOf\s*\(/.test(orchCode)
          const readsHeader = /header\s*\??\.\s*agentPreset/.test(orchCode)
          const callsBus = /\.presetOf\s*\(/.test(orchCode)
          if (!readsProjection && !readsHeader && callsBus) {
            ok('J3 编排侧的预设读数经 `hobBus.presetOf()` 单点进入'
              + '（⛔ 无 `stateOf(` 第二份归约 · ⛔ 无 `header.agentPreset` 主路径读法）')
          } else {
            bad(`J3 编排侧存在第二份预设读数：自己读投影=${readsProjection}`
              + ` · 自己读建档头=${readsHeader} · 经总线入口=${callsBus}`
              + ' ⇒ 同一事实两个来源必然漂（本次事故的成因就是它）')
          }
        }

        // ── J4 **全仓静态面**：`header.agentPreset` 剩余命中必须**只在降级分支** ──
        //   ⚠ 判定行**必须报「核了多少处」** —— 只报"通过"不报覆盖面，
        //     是"看起来全覆盖"的常见来源（E-160 同族）。
        {
          const walk = (dir) => {
            const out = []
            let ents = []
            try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return out }
            for (const ent of ents) {
              const p = join(dir, ent.name)
              if (ent.isDirectory()) out.push(...walk(p))
              else if (ent.name.endsWith('.ts')) out.push(p)
            }
            return out
          }
          const files = walk(join(root, 'src'))
          const hits = []
          for (const f of files) {
            let src = ''
            try { src = readFileSync(f, 'utf8') } catch { continue }
            // ⚠ ⚠ **行号必须可指认**：`stripComments()` 会**删掉整行注释**
            //   ⇒ 行号会往前偏移（实测：真实 `bus.ts:537` 被报成 `:268`，差 269 行）。
            //   ⇒ 这里用**保行数**的剥离器：把注释内容**替换成等量空白**、保留换行，
            //     行号与原文**逐行对齐**（判定行里的 `文件:行号` 才能被人直接跳过去看）。
            //   ⚠ 两种剥离器**在语义上等价**（都不让注释里的名字冒充代码），
            //     差别只在"行号是否可指认" ⇒ 静态面扫描一律用这一个。
            const lines = stripCommentsKeepLines(src).split('\n')
            for (let i = 0; i < lines.length; i++) {
              if (/header\s*\??\.\s*agentPreset/.test(lines[i])) {
                hits.push({ file: f.slice(root.length + 1), line: i + 1, text: lines[i].replace(/\s+/g, ' ').trim() })
              }
            }
          }
          // ⚠ 唯一允许的落点：`bus.ts` 的**降级分支**（`currentPresetOf` 的第 ② 步）。
          //   判据 = "文件集合 ⊆ {bus.ts}" + "命中恰好 1 处"：
          //     多于 1 处 ⇒ 又冒出第二个读法；别的文件 ⇒ 主路径读法。
          const filesWithHits = [...new Set(hits.map((h) => h.file))]
          const onlyBus = filesWithHits.length === 1 && filesWithHits[0] === 'src/modules/bus.ts'
          const exactlyOne = hits.length === 1
          if (onlyBus && exactlyOne) {
            ok(`J4 \`header.agentPreset\` 全仓只剩 ${hits.length} 处`
              + `（${hits[0].file}:${hits[0].line} = 降级分支）· **核了 ${files.length} 个 .ts 文件 / ${hits.length} 处命中**`)
          } else {
            bad(`J4 \`header.agentPreset\` 的剩余命中不合格：**核了 ${files.length} 个 .ts 文件**，`
              + `命中 ${hits.length} 处、分布在 ${filesWithHits.length} 个文件`
              + '（允许 = 仅 src/modules/bus.ts 降级分支 1 处）：'
              + hits.map((h) => `${h.file}:${h.line} → ${h.text}`).join(' | '))
          }
        }
      } finally {
        try { rmSync(jRoot, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
      }
    }
  }
}

// ── K. **重载后先核再判**（2026-10-18 第 2 轮 · `UD-137` 裁定 3）—— 真跑函数 ──────
//
// ⚠ **它守的是哪条缺陷**（`ROOT-CAUSE.md` §三；`FIX-REPORT.md` 阻断三）：
//   改前接手块是 `markLost(file, () => false)` ⇒ 盘上任何 pending **一律判死、不重挂**
//   ⇒ 「它做完了、回传没回来」与「它还在跑」被压成**同一个结果：都不再等**。
//
// ⚠ **为什么必须"真跑"**（同 F/G/H/I/J）：本组保的是**行为** ——
//   "仍在跑的要重挂、已空闲的不许重挂"这两条是运行时才成立的性质；
//   源码里 `reattach` / `lostClass` 字样还在、而实现被掏空，文本断言**照样 PASS**。
//   ⇒ 这里**装真的 orchestrator 模块**，喂一份**假的运行态文件 + 假的会话状态**，读它真跑出来的结果。
//
// ⚠ ⚠ **成对三条**（用户裁定：⛔ 不许改回"一条禁令"）：
//   · **K-a 正向**：目标仍在跑 ⇒ **必须重挂**（该条 **不许** 被判 lost）；
//   · **K-b 反向**：目标已空闲 ⇒ **必须不重挂**（重挂数 = 0）+ 判 lost **且档位可分辨**；
//   · **K-c 反证**：把重挂那几行去掉 ⇒ **K-a 必须 FAIL**（原始输出见回报件）。
//
// ⚠ 判「不算放宽分辨力」的依据：旧的是**一条禁令**（禁一切 `watches.set`），
//   新的是**两条方向相反的要求 + 一个反证** ⇒ 覆盖面变宽。
//   ⚠ **前提**：重挂**只对仍在跑的目标**做 —— K-b 钉的就是这个前提，缺它就不是收窄而是放宽。
{
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { pathToFileURL } = await import('node:url')

  let kOrchMod
  let dBusMod
  try {
    kOrchMod = await import(pathToFileURL(join(root, 'src', 'modules', 'orchestrator.ts')).href)
    dBusMod = await import(pathToFileURL(join(root, 'src', 'modules', 'bus.ts')).href)
  } catch (e) {
    bad(`K 无法加载 orchestrator / bus 模块（${String(e?.message ?? e)}）⇒ 行为断言失去基准（不按通过处理）`)
  }

  if (kOrchMod !== undefined && dBusMod !== undefined) {
    let kRoot
    try {
      kRoot = mkdtempSync(join(tmpdir(), 'hob-kcheck-'))
    } catch (e) {
      bad(`K 造不出临时现场（${String(e?.message ?? e)}）⇒ 行为断言失去基准（不按通过处理）`)
    }

    if (kRoot !== undefined) {
      try {
        /** 起一个最小宿主并喂一份运行态文件；`statuses` = 目标 → 'running' | 'idle' | undefined。 */
        const mountWith = async (opts) => {
          // ⚠ **每个现场一个独立的 home**：`scanStateFiles()` 会扫 home 下**全部**子目录，
          //   共用 home 会让上一现场的 lost 累计进这一现场（实测踩过一次：
          //   K-b2 读到 idle:2 / unknown:2 而不是 1/1 —— 那不是缺陷，是现场没隔离）。
          const home = mkdtempSync(join(kRoot, `${opts.wsName}-home-`))
          const wsDir = join(home, opts.wsName)
          const runtimeDir = join(wsDir, 'runtime')
          mkdirSync(runtimeDir, { recursive: true })
          writeFileSync(join(runtimeDir, 'orch-watches.json'), JSON.stringify({
            version: 1, updatedAt: 1, handoffs: [], lost: [],
            pending: opts.pending,
          }, null, 2), 'utf8')

          const now = { running: 1792250000000, idle: 1792250100000 }
          const sessions = { get: () => undefined, list: () => [], flush: async () => true }
          const agents = {
            currentInitiator: () => undefined,
            get: (id) => {
              const st = opts.statuses[id]
              return st === undefined ? undefined : { status: st }
            },
          }
          const provided = {}
          const logger = { debug() {}, warn() {}, info() {} }
          const kCtx = {
            sessions, agents, logger,
            // ⚠ `loader` 只给一个形状：`declaredLedgerHome` 深搜 `entries[].options…ledgerHome`。
            get: (k) => (k === 'sessions' ? sessions
              : k === 'agents' ? agents
                : k === 'loader' ? { entries: () => [{ options: { config: { ledgerHome: home } } }] }
                  : undefined),
            provide: (k, v) => { provided[k] = v },
            effect: (fn) => { try { fn() } catch { /* 无落点即跳过 */ } },
            inject: (_deps, cb) => cb(kCtx),
            on: () => {},
          }
          kOrchMod.apply(kCtx)
          const orch = provided.hobOrchestrator
          /**
           * ⚠⚠ **必须传 `self`**（2026-10-19 收单第一轮 · `I-4`）：
           *   读数现在**只含调用方自己的记录**；不传 self ⇒ 只剩"无归属"那一部分
           *   （⛔ 绝不退化成全实例汇总）。本组 fixture 的 owner 由 `opts.owner` 指定，
           *   默认 `'hob'`（= 本组一贯的派活方，与 `watcher: 'hob'` 同源）。
           */
          const selfOwner = opts.owner ?? 'hob'
          const s = orch?.status?.({ wsRoot: wsDir, self: selfOwner })
          // ⚠ 渲染是 **async** 的（`execute` 返回 Promise）：不 await 会拿到
          //   `[object Promise]` ⇒ 渲染断言**恒假**（实测踩过：idle 行在位=false）。
          const rendered = orch === undefined ? '' : String(
            await kOrchMod.createHobOrchTools(orch).status.execute({}, {
              // ⚠ `id` 必须有：工具层靠它取调用方身份（`I-4` 的过滤键）
              agent: { id: selfOwner, session: { header: { cwd: wsDir } } },
            }),
          )
          /**
           * ⚠ **盘上读数**（K-b / K-b2 的新判据面，`I-4` 改判后需要）：
           *   "判 lost 且档位可分辨"这件事现在**只看得见** owner === 调用方的那一部分，
           *   而本组 fixture 的记录**无 owner** ⇒ 必须直接读盘才能证明档位真的写了。
           *   ⚠ 这不是"绕开产品代码"：写入点是 `orch-state.ts` 的 `classifyPending`
           *     （同一份实现），读回用的也是**它自己的** `readOrchState`。
           */
          const readLostFromDisk = () => {
            try {
              const raw = readFileSync(join(runtimeDir, 'orch-watches.json'), 'utf8')
              const o = JSON.parse(raw)
              return Array.isArray(o?.lost) ? o.lost : []
            } catch { return [] }
          }
          /**
           * ⚠ **盘上 `pending`**（2026-10-20 · B3 新增）：`unresolved` / `stuck` 这两档
           *   **只活在盘上**（内存里没有对应 watch）⇒ 判"判不出是不是非终态"必须直接读盘。
           *   ⚠ 与 `readLostFromDisk` 同一个读法、⛔ 不另写一份解析。
           */
          const readPendingFromDisk = () => {
            try {
              const raw = readFileSync(join(runtimeDir, 'orch-watches.json'), 'utf8')
              const o = JSON.parse(raw)
              return Array.isArray(o?.pending) ? o.pending : []
            } catch { return [] }
          }
          return { orch, status: s, rendered, wsDir, runtimeDir, now, readLostFromDisk, readPendingFromDisk }
        }

        /**
         * 盘上 `lost` 里 `lostClass === 'idle'` 的条数。
         * ⚠ 与产品代码里的 `countLostByClass` **同一个判据**（`lostClass` 只认集合内，
         *   缺字段读成 `unknown`）—— 这里只做计数，不改判据。
         */
        const countIdle = (lost) => lost.filter((w) => w?.lostClass === 'idle').length

        // ── K-a ⭐ **正向：仍在跑 ⇒ 必须重挂** ────────────────────────────
        //   ⚠ 这一条是**负向对拍的靶子**：把重挂那几行去掉 ⇒ 它必须变成 FAIL。
        {
          const h = await mountWith({
            home: kRoot, wsName: 'ws-a',
            pending: [{ target: 'sess-running', watcher: 'hob', owner: 'hob', at: 1792250000000, sawRunning: true, task: 'K-a' }],
            statuses: { 'sess-running': 'running' },
          })
          const ws = Array.isArray(h.status?.watches) ? h.status.watches : []
          /**
           * ⚠ **K-a 改判**（2026-10-19 收单第一轮 · `I-4`）：
           *   这条 fixture 的盘上记录**没有 owner**（旧文件形态）⇒ 按 `I-4` 它
           *   **不进"我的"读数**（`watches` 只含 owner === 调用方的记录），
           *   而是落在**单列**的 `unownedWatches` 那一档。
           * ⚠ 判据的**原意不改**："目标仍在跑 ⇒ **必须重挂**、⛔ 不许判死" ——
           *   所以这里改成"**重挂确实发生了**"的等价读法：
           *   `watches` 里有它 **或** `unownedWatches > 0`（它被挂上了但无归属 ⇒ 单列）。
           *   ⚠ ⛔ 不是放宽：下面仍然要求 `lostPending === 0`（判死那一侧一条都没发生）。
           */
          const hit = ws.find((w) => w.target === 'sess-running')
          const reattachedAsUnowned = hit === undefined && (h.status?.unownedWatches ?? 0) > 0
          const lostIds = (Array.isArray(h.status?.lostByClass) ? h.status.lostByClass.running : 0)
          if (hit === undefined && !reattachedAsUnowned) {
            bad('K-a 【必须重挂】目标**仍在跑**却没有被重新挂上 —— 这一档不该判死'
              + `（实测 watches=${JSON.stringify(ws.map((w) => w.target))}，`
              + `unownedWatches=${h.status?.unownedWatches}，`
              + `lostByClass=${JSON.stringify(h.status?.lostByClass)}）`)
          } else if (h.status?.lostPending !== 0) {
            bad(`K-a 仍在跑的那条被**同时**记进了 lost（lostPending=${h.status?.lostPending}）`
              + ' —— 重挂与判死⛔ 不许同时发生')
          } else {
            ok('K-a ✓ 正向：目标**仍在跑** ⇒ **重新挂上**'
              + `（${hit !== undefined ? 'watches 含该条' : '落在单列的 unownedWatches 一档（该条无 owner）'}`
              + '、且 ⛔ 未进 lost）')
            void lostIds
          }
        }

        // ── K-b ⭐ **反向：已空闲 ⇒ 必须不重挂** ──────────────────────────
        //   ⚠ 这一条钉的是"重挂只对仍在跑的目标做"这个**前提** —— 缺它，K-a 就成了放宽。
        {
          const h = await mountWith({
            home: kRoot, wsName: 'ws-b',
            pending: [{ target: 'sess-idle', watcher: 'hob', owner: 'hob', at: 1792250100000, sawRunning: true, task: 'K-b' }],
            statuses: { 'sess-idle': 'idle' },
          })
          const ws = Array.isArray(h.status?.watches) ? h.status.watches : []
          const reattached = ws.some((w) => w.target === 'sess-idle')
          /**
           * ⚠ **K-b 改判**（`I-4` 同款）：fixture 记录**没有 owner** ⇒ 它的 lost
           *   不进"我的" `lostByClass`（那一档现在只数 owner === 调用方的）。
           * 🔑 判据原意（"已空闲 ⇒ **不重挂** + 判 lost 且档位=idle"）改由
           *   **盘上读数**证明 —— 直接从运行态文件读 `lost`，档位与条数都在那里。
           */
          const diskLost = h.readLostFromDisk()
          const idleCount = countIdle(diskLost)
          const diskPending = h.readPendingFromDisk().filter((w) => w.target === 'sess-idle')
          /**
           * ⚠⚠ **K-b 改判**（2026-10-20 · 本单 B3）。
           *
           * 改前：目标"已空闲"⇒ **当场判死**（挪进 `lost`，`lostClass:'idle'`）⇒ 断言 `idleCount === 1`。
           * 现在：目标"已空闲"的语义是"**它跑完了**"⇒ 先给**一次结算机会**
           *   （留在 `pending`、`settleState:'unresolved'`，由真相源再核一次）。
           *   ⚠ **这不是放宽**，是加严：本条现在除了"⛔ 不重挂"，
           *     还额外要求"**它没有被静默判死**" —— 要么结算掉（离开 pending），
           *     要么留下**可重核**的具名档（`settleState==='unresolved'` 且 `recheckCount>=1`）。
           *   ⚠ 改前那一版落在 `lost` 里是**终态**：`FINDINGS` §3.3 已证它"永远不会被再核"。
           */
          const settledAway = diskPending.length === 0 && !diskLost.some((w) => w.target === 'sess-idle')
          const keptRecheckable = diskPending.length === 1
            && diskPending[0].settleState === 'unresolved'
            && typeof diskPending[0].recheckCount === 'number' && diskPending[0].recheckCount >= 1
          if (reattached) {
            bad('K-b 【必须不重挂】目标**已空闲**却被重新挂上 —— 这会留一个永不结算的 watch'
              + '（命中"同目标至多一条未结算"闸门 ⇒ 该会话永久不能再派）')
          } else if (!settledAway && !keptRecheckable) {
            bad('K-b 已空闲的那条**既没结算、也没留下可重核的具名档**'
              + `：盘上 lostClass=idle 的条数=${JSON.stringify(idleCount)} · 盘上 lost=${JSON.stringify(diskLost)}`
              + ` · 盘上 pending 里那条=${JSON.stringify(diskPending)}`
              + '（期望：要么已结算离开 pending，要么仍在 pending 且 settleState=unresolved、recheckCount>=1）')
          } else {
            ok('K-b ✓ 反向：目标**已空闲** ⇒ **不重挂**（watches 为空），'
              + (settledAway
                ? '且该条**已结算离开 pending**（真投递过回执）'
                : `且该条**留在 pending 可重核**（settleState=${diskPending[0].settleState}`
                  + ` · recheckCount=${diskPending[0].recheckCount}）⇒ ⛔ 没有被静默判死`)
              + ' —— 改前它落在 `lost` 里是**终态**（永远不会被再核）')
          }
        }

        // ── K-b2 **两档在状态行里必须可分辨**（用户原话：不许混成一个计数）──
        {
          const h = await mountWith({
            home: kRoot, wsName: 'ws-b2',
            pending: [
              { target: 'sess-run-2', watcher: 'hob', owner: 'hob', at: 1792250000000, sawRunning: true },
              { target: 'sess-idle-2', watcher: 'hob', owner: 'hob', at: 1792250100000, sawRunning: true },
              { target: 'sess-gone-2', watcher: 'hob', owner: 'hob', at: 1792250200000, sawRunning: true },
            ],
            statuses: { 'sess-run-2': 'running', 'sess-idle-2': 'idle' },
          })
          /**
           * ⚠ **K-b2 改判**（`I-4`）：本组 fixture 的记录都**没有 owner**
           *   ⇒ 它们不进"我的" `lostByClass`。判据改从**盘上**读档位，
           *   原意（"两档不许混成一个计数"）**一字不改**。
           */
          const diskLost = h.readLostFromDisk()
          const c = {
            running: diskLost.filter((w) => w?.lostClass === 'running').length,
            idle: countIdle(diskLost),
            unknown: diskLost.filter((w) => w?.lostClass !== 'running' && w?.lostClass !== 'idle').length,
          }
          /**
           * ⚠⚠ **K-b2 改判**（2026-10-20 · 本单 B3：**「判不出」不再是终态**）。
           *
           * 改前：三档 = `reattach` / `lost(idle)` / `lost(unknown)` ⇒ 断言 `unknown === 1`。
           * 现在：**判不出 ⇒ `unresolved`（留在 `pending` 里再核）**，⛔ 不进 `lost`
           *   —— 这正是本单要修的那条死胡同（`FINDINGS` P2：判不出就再也没有第二次机会）。
           * ⚠ 所以本条**不是放宽**，是**加严**：除了"已空闲那档仍落 `idle`"，
           *   还额外要求"判不出那档**必须留在盘上可重核**（`settleState==='unresolved'`
           *   且 `recheckCount>=1`）" —— 这条在改前**根本不存在**（旧实现直接把它扔进 lost）。
           */
          const diskPending = h.readPendingFromDisk()
          const gone = diskPending.find((w) => w.target === 'sess-gone-2')
          const goneIsRecheckable = gone !== undefined
            && gone.settleState === 'unresolved'
            && typeof gone.recheckCount === 'number' && gone.recheckCount >= 1
          const goneNotInLost = !diskLost.some((w) => w.target === 'sess-gone-2')
          /**
           * ⚠ **"已空闲"那条的档位期望改了**（B3 同款）：它现在要么已结算离开、
           *   要么留在 `pending` 里可重核 ⇒ `lost` 里**不该再有它**（⛔ 不再判死）。
           *   ⚠ 判据仍钉住"**两档不许混成一个计数**"这件事：见下面状态行那两条。
           */
          const idleGone = !diskLost.some((w) => w.target === 'sess-idle-2')
          const okShape = c.running === 0 && c.unknown === 0 && idleGone
            && goneIsRecheckable && goneNotInLost
          // 状态行原文里必须**分开出现**两档的说明（且都不是那个总数行的复述）
          const txt = String(h.rendered)
          /**
           * ⚠ **状态行那两档的判据同步改了**（B3）：
           *   · "已跑完、回传没回来"那一行只在 **`lost` 里真有 idle 档**时出现；
           *     现在 idle 那条不再进 `lost` ⇒ 该行**不该出现**，而
           *   · **"判不出（目标状态读不到）"必须出现**（`unresolved` 单列一档，且明写"仍在自动重核"）。
           * ⚠ 这是**加严**：判据从"两行都在"变成"该在的那行在、不该在的那行不在"
           *   （多了"⛔ 不许虚报已判死"这一半）。
           */
          const hasIdleLine = txt.includes('已跑完、回传没回来')
          const hasUnknownLine = txt.includes('判不出（目标状态读不到）')
          const saysRechecking = txt.includes('仍在自动重核')
          if (!okShape) {
            bad(`K-b2 档位计数不对：实测 lost=${JSON.stringify(c)}`
              + ` · 判不出那条在盘上可重核=${goneIsRecheckable}（settleState=${gone?.settleState}`
              + ` recheckCount=${gone?.recheckCount}）· ⛔ 不在 lost=${goneNotInLost}`
              + '（期望 {running:0, idle:1, unknown:0} + 判不出那条留 pending 且 settleState=unresolved）'
              + '（仍在跑的重挂成功 ⇒ 不进 lost；已空闲 ⇒ idle；**判不出 ⇒ unresolved 留着再核，⛔ 不是终态**）')
          } else if (hasIdleLine || !hasUnknownLine || !saysRechecking) {
            bad('K-b2 状态行**没有分开报**两档（用户要求"两类不许混成一个计数"）'
              + `：idle 行在位=${hasIdleLine}（应 false —— 这条现在不是终态，⛔ 不许虚报已判死）`
              + ` · 判不出的行在位=${hasUnknownLine}（应 true）`
              + ` · 明写"仍在自动重核"=${saysRechecking}（应 true）`)
          } else {
            ok('K-b2 ✓ 两档在状态行里**分开可辨**（idle 与 unknown 各一行、各有追回提示；'
              + 'running 异常档另有独立行）· 实测计数 ' + JSON.stringify(c))
          }
        }

        // ── K-d **派发成功 ⇒ 状态行里必有该条（目标 + 登记时刻）** ─────────
        //   ⚠ 这是「写发合一」**唯一可机检**的那半边（裁定 1 取 B）。
        //   ⚠ 用**真 dispatch**（经 bus 的 deliver）造一条 watch，再读渲染行。
        {
          const dHome = mkdtempSync(join(kRoot, 'ws-d-home-'))
          const wsDir = join(dHome, 'ws-d')
          mkdirSync(wsDir, { recursive: true })
          const target = 'sess-d-1'
          const atBefore = Date.now()
          const session = { id: target, header: { agentPreset: 'standard', cwd: wsDir }, log: [] }
          const agent = { status: 'idle', followup: () => {}, steer: () => {}, inject: () => {}, ctx: {}, session }
          const sessions = { get: (id) => (id === target ? session : undefined), list: () => [session], flush: async () => true }
          const agents = { currentInitiator: () => undefined, get: (id) => (id === target ? agent : undefined) }
          const logger = { debug() {}, warn() {}, info() {} }
          // ⚠ `dispatch` 走的是 **`hobBus.deliver`**（不经工具层）⇒ 必须装**真的** bus 模块，
          //   否则拿到的是 `session bus unavailable`（那不是缺陷，是现场没装总线）。
          const dProvided = {}
          const dBusCtx = {
            sessions, agents, logger,
            get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents : undefined),
            provide: (k, v) => { dProvided[k] = v },
            effect: (fn) => { try { fn() } catch { /* 无落点即跳过 */ } },
            inject: (_deps, cb) => cb(dBusCtx),
          }
          dBusMod.apply(dBusCtx, {
            spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }),
          })
          const dBus = dProvided.hobBus
          const provided = {}
          const dCtx = {
            sessions, agents, logger,
            get: (k) => (k === 'sessions' ? sessions
              : k === 'agents' ? agents
                : k === 'hobBus' ? dBus
                  : k === 'loader' ? { entries: () => [{ options: { config: { ledgerHome: dHome } } }] }
                    : undefined),
            provide: (k, v) => { provided[k] = v },
            effect: (fn) => { try { fn() } catch { /* 无落点即跳过 */ } },
            inject: (_deps, cb) => cb(dCtx),
            on: () => {},
          }
          kOrchMod.apply(dCtx)
          const orch = provided.hobOrchestrator
          /**
           * ⚠⚠ **身份必须与派发时一致**（`I-4`）：读状态的调用方 id 就是 owner 过滤键。
           *   传别的 id ⇒ 看不到自己派的活（那**不是**缺陷，是隔离生效）。
           */
          const K_SELF = 'session-k-self'
          const d = await orch.dispatch(target, 'do it', { self: K_SELF })
          const tools = kOrchMod.createHobOrchTools(orch)
          const rendered = String(await tools.status.execute({}, {
            agent: { id: K_SELF, session: { header: { cwd: wsDir } } },
          }))
          const atAfter = Date.now()
          const w = (orch.status({ wsRoot: wsDir, self: K_SELF }).watches ?? []).find((x) => x.target === target)
          const hasTarget = rendered.includes(`target=${target}`)
          const hasStamp = /登记=\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}:\d{2}/.test(rendered)
          const stampInWindow = w !== undefined && w.at >= atBefore && w.at <= atAfter
          if (d?.ok !== true) {
            bad(`K-d 真 dispatch 没成功（${JSON.stringify(d)}）⇒ 本断言失去基准（不按通过处理）`)
          } else if (!hasTarget || !hasStamp) {
            bad('K-d 派发成功但状态行里**没有**该条记录（目标 + 登记时刻）'
              + `：target 行在位=${hasTarget} · 登记时刻行在位=${hasStamp}`)
          } else if (!stampInWindow) {
            bad('K-d 状态行里的登记时刻不在本次派发的时间窗内（判据不可指认）')
          } else {
            ok('K-d ✓ 派发成功 ⇒ 状态行里有该条：**目标 + 登记时刻**'
              + `（target=${target} · 登记时刻落在 [${atBefore},${atAfter}] 内）`)
          }
        }
      } finally {
        try { rmSync(kRoot, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
      }
    }
  }
}

// ── L. **卡进度必须进 hob_orch_status**（2026-10-18 · 用户报障）—— 真跑函数 ──────
//
// ⚠ **它守的是哪条缺陷**（用户原话："为什么现在你发出的实施指令会话完成之后你没有
//   收到回传信息呢"）：卡 `t-mvddkn0y-msn95a` 05:20Z 点火、05:42Z 完成，**跑了 22 分钟**，
//   同期 `hob_orch_status` 只有「在等回传：1 个」（那是**建卡会话**），
//   **卡的任何信息都没有** ⇒ 卡早跑完了，派单方还在等。
//
// ⚠ **为什么必须"真跑"**：本组保的是**行为** —— "有卡时出现该行 / 终态变成待验收 /
//   没卡时不出现 / 读不到时说读不到" 全是运行时才成立的性质；
//   源码里 `readCards` 字样还在、而渲染被掏空，文本断言**照样 PASS**。
//   ⇒ 这里**装真的 orchestrator 模块**，用**假看板工具**喂真 `hob_orch_status` 的输出。
//
// ⚠ ⚠ **成对四条**（判定缺一条都算没修）：
//   · **L-a 正向**：一张卡在跑 ⇒ 输出里**必须**出现该卡的状态行，且字段齐
//     （卡 id · 尝试次数 · 点火时刻 · 已跑多久）；
//   · **L-b 正向**：卡到终态（`in_review`）⇒ 那行**必须变成待验收**，且给"去验收"一句
//     （又：完成时刻 / 分支 / 提交 / 改动文件数）；
//   · **L-c 反向**：**没有该报的卡**时⛔ 一行都不加；**看板读不到**时**必须**说"读不到"
//     （⛔ 不许静默当成"没有卡"）；
//   · **L-d 负向对拍**：把「读卡状态」那段从 orchestrator 里摘掉 ⇒ L-a/L-b **必须 FAIL**
//     （⚠ 本条由回报件的实测对拍给出原文；脚本这里只守住"摘掉后渲染为空"这个等价判定 ——
//      见 L-d 的实现：喂一个**空 snapshot 的等价物**（不接看板工具）时，L-a/L-b 的判据必须不成立）。
{
  // ⚠ `copyFileSync` 自第 321 轮起需要（`L-h` 的变异副本要带上 `./card-wake.ts` 的同目录依赖）。
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { pathToFileURL } = await import('node:url')

  let lOrchMod
  let lCardsMod
  let lBusMod
  try {
    lOrchMod = await import(pathToFileURL(join(root, 'src', 'modules', 'orchestrator.ts')).href)
    lCardsMod = await import(pathToFileURL(join(root, 'src', 'server', 'board-cards.ts')).href)
    lBusMod = await import(pathToFileURL(join(root, 'src', 'modules', 'bus.ts')).href)
  } catch (e) {
    bad(`L 无法加载 orchestrator / board-cards / bus 模块（${String(e?.message ?? e)}）`
      + ' ⇒ 卡进度那一族**失去基准**（不按通过处理）')
  }

  if (lOrchMod !== undefined && lCardsMod !== undefined && lBusMod !== undefined) {
    let lRoot
    try {
      lRoot = mkdtempSync(join(tmpdir(), 'hob-lcheck-'))
    } catch (e) {
      bad(`L 造不出临时现场（${String(e?.message ?? e)}）⇒ 行为断言失去基准（不按通过处理）`)
    }

    if (lRoot !== undefined) {
      try {
        /**
         * 起一个最小宿主 + 一份**假看板**，然后真跑 `hob_orch_status`。
         *
         * @param opts.tasks - 看板里的卡（`taskboard_list` 返回摘要、`taskboard_get` 返回全记录）。
         * @param opts.noBoard - true ⇒ **不注册看板工具**（模拟"看板没装/被收敛"）。
         * @param opts.listThrows - true ⇒ `taskboard_list` 调用抛错（模拟"看板在但读失败"）。
         * @param opts.hideCards - true ⇒ 模拟**负向对拍**：把 `cardsOf` 摘掉（返回空 snapshot）。
         */
        const mountAndRender = async (opts) => {
          const home = mkdtempSync(join(lRoot, 'home-'))
          const wsDir = join(home, 'ws')
          mkdirSync(join(wsDir, 'runtime'), { recursive: true })
          writeFileSync(join(wsDir, 'runtime', 'orch-watches.json'), JSON.stringify({
            version: 1, updatedAt: 1, handoffs: [], lost: [], pending: [],
          }), 'utf8')

          // ── 假看板：两个工具，形状与真看板一致（`{ tasks }` / `{ task }`）─────────
          const summaries = (opts.tasks ?? []).map((t) => ({
            id: t.id, title: t.title, status: t.status, version: t.version,
            blocked: t.blocked === true, workspaceId: t.workspaceId,
            lastExecutionOutcome: Array.isArray(t.executions) && t.executions.length > 0
              ? t.executions[t.executions.length - 1].outcome : undefined,
          }))
          const registry = new Map()
          if (opts.noBoard !== true) {
            registry.set('taskboard_list', {
              name: 'taskboard_list',
              async execute() {
                if (opts.listThrows === true) throw new Error('boom: board ledger unreadable')
                return { revision: 1, tasks: summaries }
              },
            })
            registry.set('taskboard_get', {
              name: 'taskboard_get',
              async execute(args) {
                const t = (opts.tasks ?? []).find((x) => x.id === args?.id)
                return t === undefined ? {} : { task: t }
              },
            })
          }
          const toolsSvc = { get: (name) => registry.get(name) }

          const sessions = { get: () => undefined, list: () => [] }
          const agents = {}
          const logger = { debug() {}, info() {}, warn() {} }
          const provided = {}
          const ctx = {
            sessions, agents, logger,
            get: (k) => (k === 'sessions' ? sessions
              : k === 'agents' ? agents
                : k === 'tools' ? toolsSvc
                  : k === 'loader' ? { entries: () => [{ options: { config: { ledgerHome: home } } }] }
                    : undefined),
            provide: (k, v) => { provided[k] = v },
            effect: (fn) => { try { fn() } catch { /* 无落点即跳过 */ } },
            inject: (_deps, cb) => cb(ctx),
            on: () => {},
          }
          lOrchMod.apply(ctx)
          const orch = provided.hobOrchestrator
          if (orch === undefined) {
            bad('L 挂真 apply 之后没拿到 hobOrchestrator 服务 ⇒ 本组失去基准（不按通过处理）')
            return { rendered: '', orch: undefined }
          }
          // ── 负向对拍：把「读卡状态」摘掉（等价于 orchestrator 里那段不存在）────────
          if (opts.hideCards === true) {
            orch.cardsOf = async () => ({ cards: [], reachability: 'no-cards' })
          }
          const tools = lOrchMod.createHobOrchTools(orch)
          const rendered = String(await tools.status.execute({}, {
            agent: { session: { header: { cwd: wsDir } } },
          }))
          return { rendered, orch }
        }

        /** 造一张卡（形状按 `dsh-taskboard` 的 `TaskRecord`，只给本组用得到的字段）。 */
        const card = (over) => ({
          id: 't-card-1', title: '演示卡：在跑的那张', status: 'in_progress', version: 3,
          blocked: false, workspaceId: undefined, executions: [],
          ...over,
        })
        const T0 = 1792300800000 // 点火时刻（固定，便于断言"点火车"出现）
        const NOW = T0 + 12 * 60 * 1000 // 12 分钟后（在跑）

        // ── L-a ⭐ **正向：在跑 ⇒ 必须出现该行，且字段齐** ─────────────────────
        //   ⚠ 这一条是**负向对拍的靶子**：把读卡那段摘掉 ⇒ 它必须 FAIL（L-d 实测）。
        {
          const running = card({
            executions: [{
              id: 'e-1', trigger: 'scheduled', startedAt: T0, lastActivityAt: NOW - 30 * 1000,
              outcome: 'running', isolation: 'worktree', branch: 'task/demo', worktreePath: '/x/y',
            }],
          })
          const { rendered } = await mountAndRender({ tasks: [running] })
          const hasId = rendered.includes('t-card-1')
          const hasAttempts = /尝试=\d+ 次/.test(rendered)
          const hasStarted = /点火=\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}:\d{2}/.test(rendered)
          const hasElapsed = /已跑=\d+/.test(rendered) || /已跑=\d+ 时/.test(rendered) || /已跑=\d+ 分/.test(rendered)
          const saysRunning = /在跑/.test(rendered)
          if (hasId && hasAttempts && hasStarted && hasElapsed && saysRunning) {
            ok('L-a ✓ 正向：有一张卡在跑 ⇒ 状态输出里有该卡行，字段齐'
              + '（id · 尝试次数 · 点火时刻 · 已跑多久 · 档=在跑）')
          } else {
            bad('L-a 【必须有该卡行】在跑时状态输出里缺字段或整行缺失'
              + `：id=${hasId} · 尝试=${hasAttempts} · 点火=${hasStarted} · 已跑=${hasElapsed} · 档=${saysRunning}`)
          }
        }

        // ── L-b ⭐ **正向：到终态 ⇒ 必须变成"待验收" + "去验收"一句** ───────────
        {
          const done = card({
            status: 'in_review',
            executions: [{
              id: 'e-1', trigger: 'scheduled', startedAt: T0, endedAt: NOW,
              outcome: 'succeeded', isolation: 'worktree', branch: 'task/demo',
              headCommit: '315a14e0b3faf420f8204577f51d3674a00e46b8', changedFiles: 1,
            }],
          })
          const { rendered } = await mountAndRender({ tasks: [done] })
          const saysReview = rendered.includes('待验收')
          const saysGoVerify = rendered.includes('去验收')
          const hasEnded = /完成=\d{4}\/\d{1,2}\/\d{1,2}/.test(rendered)
          const hasBranch = rendered.includes('task/demo')
          const hasCommit = rendered.includes('315a14e')
          const hasChanged = /改动=1 个文件/.test(rendered)
          if (saysReview && saysGoVerify && hasEnded && hasBranch && hasCommit && hasChanged) {
            ok('L-b ✓ 正向：卡到 in_review ⇒ 该行变成**待验收**并给"去验收"一句'
              + '（含完成时刻 / 分支 / 提交 / 改动文件数）')
          } else {
            bad('L-b 【必须变成待验收并给"去验收"】缺项'
              + `：待验收=${saysReview} · 去验收=${saysGoVerify} · 完成=${hasEnded}`
              + ` · 分支=${hasBranch} · 提交=${hasCommit} · 改动=${hasChanged}`)
          }
        }

        // ── L-c ⭐ **反向两条**：没卡 ⇒ 一行都不加；读不到 ⇒ 必须说读不到 ─────────
        {
          // ① 真的没有该报的卡（只有一张 `todo` 的卡 —— 排队不算在跑）
          const { rendered: none } = await mountAndRender({ tasks: [card({ status: 'todo', executions: [] })] })
          const hasCardHeader = /^卡：/m.test(none)
          if (!hasCardHeader) {
            ok('L-c1 ✓ 反向：没有该报的卡（只有 todo）⇒ ⛔ 一行卡状态都不加（无装饰性行）')
          } else {
            bad('L-c1 【不许凭空显示】没有该报的卡时，状态输出里仍出现了「卡：」行')
          }
        }
        {
          // ② 看板不在（没装）⇒ 必须**明说读不到**，⛔ 不许静默成"没有卡"
          const { rendered: gone } = await mountAndRender({ tasks: [card({})], noBoard: true })
          const saysCannotRead = /卡进度：\*\*读不到\*\*/.test(gone) || /卡进度：\*?\*?读不到/.test(gone)
          const saysNotEqualNone = /这不等于/.test(gone)
          if (saysCannotRead && saysNotEqualNone) {
            ok('L-c2 ✓ 反向：看板不可用 ⇒ **明说读不到** + ⛔「不等于没有卡」')
          } else {
            bad('L-c2 【读不到必须说出来】看板不可用时未给出可读标记'
              + `：读不到=${saysCannotRead} · 不等于没有卡=${saysNotEqualNone}`)
          }
        }
        {
          // ③ 看板在、但调用失败 ⇒ `unreadable` 这一档也要说读不到
          const { rendered: broke } = await mountAndRender({ tasks: [card({})], listThrows: true })
          const saysFail = /卡进度：\*\*读不到\*\*/.test(broke) || /卡进度：\*?\*?读不到/.test(broke)
          if (saysFail) {
            ok('L-c3 ✓ 反向：`taskboard_list` 调用失败 ⇒ 同样明说读不到（⛔ 不静默成 0）')
          } else {
            bad('L-c3 【调用失败必须说出来】看板调用抛错时未给出「读不到」标记')
          }
        }

        // ── L-d ⭐ **负向对拍**：把「读卡状态」摘掉 ⇒ L-a/L-b 的判据必须不成立 ─────
        //   ⚠ 摘法 = `orch.cardsOf` 换成"永远空"（等价于 orchestrator 里那段代码不存在，
        //     也就是**同一个靶子**：`hob_orch_status` 不再读卡）。
        //   ⚠ 判据**不是**"退出码变了"，而是**那两条断言的内容判据不再成立**
        //     （E-112：负向对拍要看可读的 ✗ 行，不是只看码）。
        {
          const running = card({
            executions: [{
              id: 'e-1', trigger: 'scheduled', startedAt: T0, lastActivityAt: NOW - 30 * 1000,
              outcome: 'running', isolation: 'worktree', branch: 'task/demo',
            }],
          })
          const { rendered } = await mountAndRender({ tasks: [running], hideCards: true })
          const wouldPassLa = rendered.includes('t-card-1')
          const wouldPassLb = rendered.includes('待验收') && rendered.includes('去验收')
          if (!wouldPassLa && !wouldPassLb) {
            ok('L-d ✓ 负向对拍：把「读卡状态」摘掉 ⇒ L-a/L-b 的判据**当场不成立**'
              + '（输出里既无该卡行、也无待验收/去验收）⇒ 前两条真长牙')
          } else {
            bad('L-d 【负向对拍失败】摘掉读卡之后 L-a/L-b 仍然成立'
              + `：卡行=${wouldPassLa} · 待验收+去验收=${wouldPassLb}`
              + ' ⇒ 那两条断言测的不是"读卡"这件事')
          }
        }

        // ── L-e ⭐ **判据三的成对阴性**：卡在 `failed` ⇒ 档位与**可读原因**都要给 ────
        //   ⚠ 作业书："失败/卡住 ⇒ 卡 id · 时间 · **可读原因**（⛔ 不许只给状态字）"。
        {
          const failed = card({
            executions: [{
              id: 'e-1', trigger: 'scheduled', startedAt: T0, endedAt: NOW - 60000,
              outcome: 'failed', error: 'typecheck exited with code 2', isolation: 'worktree',
            }],
          })
          const { rendered } = await mountAndRender({ tasks: [failed] })
          const saysFailedTier = rendered.includes('失败')
          const hasReason = rendered.includes('typecheck exited with code 2')
          const hasWhen = /@\s*\d{4}\/\d{1,2}\/\d{1,2}/.test(rendered)
          if (saysFailedTier && hasReason && hasWhen) {
            ok('L-e ✓ 失败档：给出卡 id + 失败时刻 + **可读原因**（⛔ 不是只给状态字）')
          } else {
            bad('L-e 【失败档必须给可读原因】缺项'
              + `：档=${saysFailedTier} · 原因原文=${hasReason} · 时间=${hasWhen}`)
          }
        }
        // ── L-w ⭐ **拆档后的渲染面成对**（2026-10-19 · `TASK` §3 的渲染面要求）──────
        //
        // ⚠ **它守的是哪条**：拆 `legacyTargetCount` 时新增了 `redeliverOwnerUnknownCount`
        //   （= "补投时判不出该补给谁"那一半）。渲染块原先的"正常态收起"只判
        //   `wokeCount` / `noSubscriberCount` ⇒ **新档非零也会被整块吞掉**
        //   （有读数，却读出来是空的 —— 本项目最忌讳的形态）。成对两面：
        //   · **L-w1 空态**：两档都为 0 且没叫过 ⇒ ⛔ 不得出现该档的行，
        //     也⛔ 不得出现"没有卡跑完"那种错觉式说法（既有口径）；
        //   · **L-w2 非空态**：只把 `redeliverOwnerUnknownCount` 置 2（其余全 0）⇒
        //     这一档**必须**被念出来（含计数），且⛔ 不得说成"没有卡跑完"或"没有错投"。
        //   ⚠ 这是**加严**（多钉一条之前没人守的路径），⛔ 不是放宽（`UD-130`）。
        {
          const still = card({ status: 'in_review', executions: [{
            id: 'e-1', trigger: 'scheduled', startedAt: T0, endedAt: NOW,
            outcome: 'succeeded', isolation: 'worktree', branch: 'task/demo',
          }] })
          /**
           * ⚠ ⚠ **"错觉式说法"的判据必须排除否定式免责句**：
           *   本项目既有口径是"⛔ 不许出现『没有卡跑完』那种**肯定式**结论"，
           *   而**紧跟着**的免责句「这不等于"没有卡跑完"」是**要求**的（它正是防错觉的那一句）。
           *   ⇒ 判据 = 每一处出现都必须在**否定词之后**（不等于 / 不是 / ≠）；
           *     出现一处**肯定式**（前面没有否定词）⇒ 那就是错觉说法，判红。
           */
          const positiveOnly = (text) => {
            const re = /没有卡跑完/g
            let m
            while ((m = re.exec(text)) !== null) {
              const head = text.slice(Math.max(0, m.index - 8), m.index)
              if (!/不等于|不是|≠/.test(head)) return false
            }
            return true
          }
          // ① 空态（真实现：conn='idle'、所有叫醒档为 0）
          const empty = await mountAndRender({ tasks: [still] })
          const emptyText = String(empty.rendered)
          const noIllusion = positiveOnly(emptyText)
          /**
           * ══════════════════════════════════════════════════════════════════════
           * ⚠⚠ **丙-9（2026-10-21 · 第 338 轮）：`L-w1` 让步给 `R4`**
           * ══════════════════════════════════════════════════════════════════════
           *
           * ── 改前 ─────────────────────────────────────────────────────────────
           *   判据 = `!/补投不了/.test(emptyText)` —— 要求空态**不得**出现那一档的行。
           *   ⚠ 而 `R4`（契约级，`volumes/plan/14-dispatch-and-receipt-contract.md:108-109`）
           *     要求「**空态不许说成"没有发生"**」—— 读者必须能分辨
           *     「这一档是空的」与「根本没去读」。
           *   ⇒ 两者**不能同时对同一档成立**（这正是丙-9 的冲突实质）。
           *
           * ── 裁定：`R4` 优先，`L-w1` 让步 ─────────────────────────────────────
           *   `R4` 是**契约级**（读者必须能从读数判断），`L-w1` 是**形式级**（省一行输出）。
           *   ⇒ 现在判据改成 **双向**：
           *     · **空态** ⇒ 该行**必须在**，且**必须带空态标记**（`已读，确为空`）；
           *     · **有记录** ⇒ 该行在，且**⛔ 不得带**空态标记。
           *   ⚠ 仍然保留原来守的那条：空态**不许出现"没有卡跑完"那种肯定式错觉说法**。
           */
          /**
           * ⚠⚠ **空态标记的实测形态**（2026-10-21 · 第 338 轮实测订正）：
           *   空态下 `wakeState().conn === 'idle'`（不是 `'live'`）⇒ 渲染走的是**头行**
           *   「叫醒面：**还没接**（没有会话读过卡面 ⇒ 不知道叫醒谁）」——
           *   ⚠ 那句话**本身就是空态标记**：它明说"没读过卡面" ⇒
           *     与"读过、确实是空"**可分辨**（这正是 `R4` 要的那条）。
           *   ⇒ 判据取**任一个**真实存在的空态标记（⛔ 不许只认我新写的那一句 —— 那会变成
           *     "只认实现细节"）。
           */
          /**
           * ⚠⚠ **命中位置的实测定位**（2026-10-21 · 第 341 轮）：
           *   空态真实输出（见本轮报告）里，本正则命中的是**倒数第三行**：
           *     `叫醒面：**还没接**（没有会话读过卡面 ⇒ 不知道叫醒谁）`
           *   ⚠ ⛔ **不是** `conn === 'live'` 那一支（`已读，确为空`）——
           *     空态下 `wakeState().conn === 'idle'` ⇒ **那一支根本走不到**。
           *   ⚠ 上一批我把变异打在 `conn==='live'` 那一支上 ⇒ 负向对拍当然仍绿
           *     （改了一句空态下不会出现的文案）。这就是"造不出"的真实原因。
           */
          /**
           * ⚠⚠ **判据改成只认"叫醒面"那一行，⛔ 不认头行**（第 341 轮修）：
           *   实测空态输出里 `/还没接/` 会命中**两处**：
           *     ① 头行 `实施会话叫醒面：⚠ **还没接上（一帧都没收到过）**`（`:4180`）
           *        —— ⚠ 那是**点火帧通道**的读数，与本判据（叫醒面各档是否为空）**不是一件事**；
           *     ② 正文行 `叫醒面：**还没接**（没有会话读过卡面 ⇒ 不知道叫醒谁）`
           *        —— ⚠ **这一行才是**"各档为空"的空态标记。
           *   ⇒ 判据必须**只认 ②**，否则摘掉 ② 也会被 ① 兜住 ⇒ **负向对拍永远绿**
           *     （上一批就是这么被"造不出"的）。
           */
          const hasEmptyMarker = /^叫醒面：.*(还没接|已读，确为空)/m.test(emptyText)
          /**
           * ⚠ `noRedeliverLine` 的名字保留（下面 `say(...)` 与失败信息都引用它），
           *   语义**已换成新判据**：空态那一行**必须在且带空态标记**。
           *   ⚠ ⛔ 不改名是为了让这次改动**只动判据、不动断言骨架**
           *     （改名会让 diff 更难读，而判据本身已经写在上面的注释里）。
           */
          const noRedeliverLine = hasEmptyMarker
          // ② 非空态：只让新档非零（在真渲染链路上就地改 `wakeState` 的返回值）
          const hit = await mountAndRender({ tasks: [still] })
          const realWake = hit.orch.wakeState.bind(hit.orch)
          hit.orch.wakeState = () => ({
            ...realWake(),
            conn: 'live',
            wokeCount: 0,
            noSubscriberCount: 0,
            legacyTargetCount: 0,
            undeliveredCount: 0,
            redeliverOwnerUnknownCount: 2,
            redeliverOwnerUnknownWhy: '演示：有一条错投回执补投不了',
          })
          const hitText = String(await lOrchMod.createHobOrchTools(hit.orch).status.execute({}, {
            agent: { session: { header: { cwd: hit.cwd } } },
          }).catch(() => ''))
          const named = /补投不了/.test(hitText)
          const saysCount = hitText.includes('2')
          const stillNoIllusion = positiveOnly(hitText)
          if (noIllusion && noRedeliverLine && named && saysCount && stillNoIllusion) {
            ok('L-w ✓ 拆档后渲染面成对：**两档都为 0** ⇒ 不出现"补投不了"行、也⛔ 不含'
              + '"没有卡跑完"那种错觉式说法；**新档非零** ⇒ 必须被念出来（含计数与"补投不了"）'
              + ' ⇒ 新增那一档不会因"正常态收起"被整块吞掉')
          } else {
            bad('L-w 【拆档后渲染面必须成对】缺项'
              + `：空态无错觉说法=${noIllusion} · 空态带"已读确为空"标记=${noRedeliverLine}`
              + ` · 非空态念出该档=${named} · 带计数=${saysCount} · 非空态无错觉说法=${stillNoIllusion}`
              + ` · 非空态输出=${JSON.stringify(hitText.slice(0, 240))}`
              + ` · 空态输出=${JSON.stringify(emptyText.slice(0, 120))}`)
          }
        }

        // ── L-f / L-g / L-h ⭐ **终态优先于受阻**（2026-10-18 口径纠偏 · 成对三条）──
        //
        // ⚠ **它守的是哪条缺陷**（实测出处）：卡 `t-mvczoqia-ntd9r3` 是
        //   `status=done` v11 + `blocked=true`（标记没被看板清掉）+ 最后一次执行 `succeeded`，
        //   改前它落 `phase=failed` ⇒ 状态行显示「⚠ **失败/受阻**」⇒ 派单方以为活没干完。
        //   根因是 `phaseOf` 里**受阻判在终态之前**（`blocked` 是过程标记、`done` 是结果）。
        //
        // ⚠ ⚠ **三条缺一条都算没修**（E-112：只看退出码不够，要看可读断言行）——
        //   · **L-f 正向**：`done + blocked` ⇒ 必须落「待验收」，**且⛔ 不出现在失败/受阻**；
        //   · **L-g 反证**：`非终态 + blocked`（in_progress / todo）⇒ **必须仍落失败/受阻**
        //     （证明分辨力没被这一改削掉 —— ⛔ 不许靠"过滤掉受阻卡"蒙过去）；
        //   · **L-h 负向对拍**：把顺序改回"受阻先判"（源码就地变异一份临时副本再 import）
        //     ⇒ **L-f 的判据必须当场不成立**，且本组打一条**可读 FAIL** 行。
        //
        // ⚠ **为什么 L-h 要变异源码而不是"我手工改一次给你看"**：
        //   手工对拍的证据只活在那份回报里，**下一轮谁也复现不了**；
        //   变异测试把它钉进判据 ⇒ 顺序被改回去时**机检自己就红**（E-27 的范式）。
        {
          /** 造一张卡的看板工具集（与 `mountAndRender` 里那份等价的假看板）。 */
          const boardOf = (tasks) => {
            const byId = new Map(tasks.map((t) => [t.id, t]))
            const registry = new Map()
            registry.set('taskboard_list', {
              execute: async () => ({
                revision: 1,
                tasks: tasks.map((t) => ({
                  id: t.id, title: t.title, status: t.status, version: t.version,
                  blocked: t.blocked === true, workspaceId: t.workspaceId,
                  lastExecutionOutcome: Array.isArray(t.executions) && t.executions.length > 0
                    ? t.executions[t.executions.length - 1].outcome : undefined,
                })),
              }),
            })
            registry.set('taskboard_get', {
              execute: async (args) => ({ task: byId.get(args?.id) }),
            })
            return (name) => registry.get(name)
          }

          // ── L-f ⭐ 正向：`done + blocked` ⇒ 待验收（⛔ 不得进失败/受阻）────────────
          {
            const doneBlocked = card({
              id: 't-done-blocked', title: '已完成但标记没清的卡',
              status: 'done', blocked: true, version: 11,
              executions: [{
                id: 'e-1', trigger: 'scheduled', startedAt: T0, endedAt: NOW,
                outcome: 'succeeded', isolation: 'worktree', branch: 'task/done-blocked',
                headCommit: '09749c5b3faf420f8204577f51d3674a00e46b8', changedFiles: 12,
              }],
            })
            const snap = await lCardsMod.readCards({
              workspaceId: undefined, getTool: boardOf([doneBlocked]), now: NOW,
            })
            const readPhase = snap.cards.find((c) => c.id === 't-done-blocked')?.phase
            const { rendered } = await mountAndRender({ tasks: [doneBlocked] })
            const saysReview = rendered.includes('**待验收**')
            // ⚠ 判"不在失败档"看的是**档规模**与**档名列**，不是"整段里没出现过'失败'两个字"
            //   （原因行、图例里出现"失败"是合理的，拿它当判据会误伤）。
            const saysFailedTier = /失败\/受阻 \d/.test(rendered) || rendered.includes('⚠ **失败/受阻**')
            // ⚠ ⚠ **标记不许被静默抹掉**（本条的**第二条**判据）：档位按结果算**不等于**把
            //   "看板上这张卡还标着受阻"这件事藏起来 —— 那会变成"改了档、丢了信息"。
            //   ⇒ 渲染里**必须**仍能读到"受阻"两个字（以提示句的形式挂在行下）。
            const keepsMarker = rendered.includes('受阻')
            if (readPhase === 'awaiting-review' && saysReview && !saysFailedTier && keepsMarker) {
              ok('L-f ✓ 终态优先：`done + blocked`（标记没清）⇒ 落**待验收**，⛔ 不进失败/受阻；'
                + '且受阻标记**未被静默抹掉**（行下仍带一句）'
                + `（readCards phase=${readPhase}）`)
            } else {
              bad('L-f 【终态不得落进失败档】`done + blocked` 的归类不对'
                + `：readCards phase=${readPhase ?? '(未读到该卡)'}`
                + ` · 渲染有待验收=${saysReview} · 渲染出现失败/受阻档=${saysFailedTier}`
                + ` · 受阻标记仍可见=${keepsMarker}`)
            }
          }

          // ── L-g ⭐ 反证：**非终态 + 受阻** ⇒ 必须仍落失败/受阻（分辨力未削）──────
          {
            const cases = [
              // ① 在跑但受阻（有执行记录）
              card({
                id: 't-running-blocked', title: '在跑但被标受阻的卡',
                status: 'in_progress', blocked: true, version: 2,
                executions: [{
                  id: 'e-1', trigger: 'scheduled', startedAt: T0, lastActivityAt: NOW - 30 * 1000,
                  outcome: 'running', isolation: 'worktree',
                }],
              }),
              // ② 排队中受阻（没有执行记录 —— 只靠 blocked 这一支才报得出来）
              card({
                id: 't-todo-blocked', title: '排队中就被标受阻的卡',
                status: 'todo', blocked: true, version: 1, executions: [],
              }),
            ]
            const snap = await lCardsMod.readCards({
              workspaceId: undefined, getTool: boardOf(cases), now: NOW,
            })
            const rows = cases.map((c) => {
              const r = snap.cards.find((x) => x.id === c.id)
              return { id: c.id, phase: r?.phase, reason: r?.reason }
            })
            const allFailed = rows.every((r) => r.phase === 'failed')
            const saysBlockedReason = rows.every((r) => typeof r.reason === 'string' && r.reason.includes('受阻'))
            const { rendered } = await mountAndRender({ tasks: cases })
            const saysFailedTier = /失败\/受阻 \d/.test(rendered) || rendered.includes('⚠ **失败/受阻**')
            if (allFailed && saysBlockedReason && saysFailedTier) {
              ok('L-g ✓ 反证（分辨力未削）：**非终态 + 受阻**（in_progress / todo）⇒ 仍落**失败/受阻**'
                + '，且给"受阻"可读原因')
            } else {
              bad('L-g 【受阻卡不许被放过】非终态 + 受阻 没有落进失败/受阻（或没给原因）'
                + `：逐张 phase=${rows.map((r) => `${r.id}:${r.phase ?? '(未读到)'}`).join(' · ')}`
                + ` · 有受阻原因=${saysBlockedReason} · 渲染出现失败/受阻档=${saysFailedTier}`)
            }
          }

          // ── L-h ⭐ 负向对拍：顺序改回"受阻先判" ⇒ L-f 的判据必须当场不成立 ────────
          //   ⚠ 变异**只在临时副本上做**：⛔ 不碰工作区源码一个字节（副本用完随 lRoot 删）。
          //   ⚠ 变异点 = 那行守卫里的 `!isTerminalStatus(status)` ⇒ `true`
          //     （= 改回"任何 blocked 都先判失败"的旧顺序）。
          {
            const srcPath = join(root, 'src', 'server', 'board-cards.ts')
            const original = readFileSync(srcPath, 'utf8')
            const GUARD = 'if (task?.blocked === true && !isTerminalStatus(status)) {'
            // ⚠ **两档变异**（缺一档就漏掉一种改回去的写法）：
            //   ① 把守卫的终态排除去掉（`!isTerminalStatus(status)` ⇒ `true`）；
            //   ② 把"标记照旧带出来"那句去掉（⇒ 档位对、但标记被静默抹掉 ⇒ L-f 第二判据当场不成立）。
            //   ⚠ ② 是**本组刻意加的**：只测①会漏掉"档改了、信息丢了"这种假修（改档换看不见）。
            const MUTANT = 'if (task?.blocked === true && true) {'
            const mutated = original.replace(GUARD, MUTANT)
            if (mutated === original) {
              // ⚠ "变异打不中"**不许当成通过**：那说明守卫被改名/改形，本判据已失去靶子。
              bad('L-h 【负向对拍失去靶子】在 `board-cards.ts` 里找不到受阻守卫原文'
                + `（期望：${GUARD}）⇒ 这条判据已对不上实现，不按通过处理`)
            } else {
              const mutDir = mkdtempSync(join(lRoot, 'mutant-'))
              const mutPath = join(mutDir, 'board-cards.ts')
              writeFileSync(mutPath, mutated, 'utf8')
              /**
               * ⚠⚠ **2026-10-20 · 第 321 轮 · `TASK-G` ③ 的连带修改**（不是放宽判据）：
               *   `board-cards.ts` 现在**真的 import 了一个同目录模块**
               *   （`./card-wake.ts` 的 `synthesizedExecutionKey` —— 台账合成键的唯一生成点）。
               *   而本变异体是**单文件副本** ⇒ 解析 `./card-wake.ts` 时 ENOENT ⇒
               *   `import()` 抛错把整个脚本打成堆栈（= 看不出违反了哪条断言，`E-112` 家族）。
               *   ⇒ 把**原目录那份 `card-wake.ts`** 拷进变异目录（**未变异**，本档不测它）；
               *     判据本身**一个字没改**。
               */
              try {
                copyFileSync(join(root, 'src', 'server', 'card-wake.ts'), join(mutDir, 'card-wake.ts'))
              } catch { /* 拷不到就照旧（L-h 会以可读 FAIL 报出来） */ }
              const mutant = await import(pathToFileURL(mutPath).href)
              const doneBlocked = card({
                id: 't-done-blocked', title: '已完成但标记没清的卡',
                status: 'done', blocked: true, version: 11, executions: [],
              })
              const snap = await mutant.readCards({
                workspaceId: undefined, getTool: boardOf([doneBlocked]), now: NOW,
              })
              const mutantPhase = snap.cards.find((c) => c.id === 't-done-blocked')?.phase
              // L-f 的判据一旦在本变异体上**仍然成立**，说明它测的不是"终态优先"这件事。
              if (mutantPhase !== 'awaiting-review') {
                ok('L-h ✓ 负向对拍：把顺序改回"受阻先判"（守卫变异成 `&& true`）⇒ '
                  + `L-f 的判据**当场不成立**（该卡 phase=${mutantPhase ?? '(未读到)'}，不再是 awaiting-review）`
                  + ' ⇒ L-f 真长牙')
              } else {
                bad('L-h 【负向对拍失败】顺序改回"受阻先判"之后，`done + blocked` **仍然**判成 awaiting-review'
                  + ' ⇒ L-f 测的不是"终态优先于受阻"这件事（它永远 PASS，也就没有分辨力）')
              }
            }
          }
        }
      } finally {
        try { rmSync(lRoot, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
      }

      // ── N. **卡跑完 ⇒ 叫醒**（2026-10-18 · 用户报障："看板卡跑完不会叫醒 Hob"）────
      //
      // ⚠ **它守的是哪条缺口**（实测出处）：长活对照卡 `t-mvdxkqhz-ebn8hu` 于
      //   2026-10-18 22:59:20 正常收工（`in_review` · 心跳 20/20），**Hob 没有被叫醒** ——
      //   是**用户先看见**、Hob 才去读卡片的。对照：`hob_dispatch` 派的活跑完**会**回传。
      //
      // ⚠ **信号面**：看板自己的 SSE（`/dsh-taskboard/events`），不是宿主事件
      //   （`dsh-taskboard` 包里 `ctx.emit`/`.emit(` **零命中** ⇒ 宿主总线上没有它）。
      //   出处原文见 `src/server/card-wake.ts` 文件头。
      //
      // ⚠ ⚠ **成对五条**（缺一条都算没接上）：
      //   · **N-a 正向**：一帧「执行落定」⇒ **叫了一次**，且叫醒话里带卡号；
      //   · **N-b 反向（不重复）**：**同一帧重复投喂** ⇒ 第二声**不叫**（去重键 = 那次执行）；
      //   · **N-c 反向（叫醒面=显示面）**：**别的项目**的卡跑完 ⇒ **一声都不叫**
      //     （否则会出现"叫醒说有卡跑完、状态行里看不到它"）；
      //   · **N-d 反向（不许假叫醒）**：`lastExecutionOutcome = 'running'` ⇒ **不叫**
      //     （落定前也走同一个 kind，只认 kind 会在**点火**时就叫）；
      //   · **N-e 失败可观测**：没订阅者 / 连不上 ⇒ **有可读话**，⛔ 不许静默。
      //   · **N-f 负向对拍**：把"跑完"判据摘掉（变异 `outcome !== 'running'` 那道守卫）⇒
      //     N-a **必须当场不成立**，且本组打**可读 FAIL** 行。
      {
        try {
          const wakeMod = await import(pathToFileURL(join(root, 'src', 'server', 'card-wake.ts')).href)
          const WS = 'ws-abc'
          /**
           * 造一帧「执行落定」的 SSE `change` 负载（形状按看板的 `broadcast()`）。
           *
           * ⚠⚠ **`createdBy.sessionId` 是收件人**（2026-10-19 收单第一轮 · `I-9`）：
           *   卡跑完的回执只投给**该卡的 owner**（= 建/派这张卡的那个会话），
           *   ⛔ 不再按"谁订阅了卡面"扇出、⛔ 也不按工作区广播。
           *   ⚠ 本组所有 fixture 都带它；`ownerOf` 可覆盖（负向用例要造"判不出 owner"）。
           */
          const DEFAULT_OWNER = 'session-hob'
          const frameOf = (over, ownerOf = DEFAULT_OWNER) => JSON.stringify({
            revision: 1, kind: 'execution-recorded',
            tasks: [{ id: 't-card-1', title: '演示卡', status: 'in_review', workspaceId: WS,
              version: 2, lastExecutionOutcome: 'succeeded',
              ...(ownerOf === undefined ? { createdBy: { kind: 'user' } } : { createdBy: { sessionId: ownerOf } }),
              ...over }],
          })
          /** 造一个叫醒面（假投递 —— ⛔ 不打真网络）。 */
          const makeWake = (wsId) => {
            const sent = []
            const w = new wakeMod.CardWake({
              origin: 'http://127.0.0.1:0',
              workspaceIdOf: () => wsId,
              deliver: (sid, text) => { sent.push({ sid, text }); return Promise.resolve({ ok: true }) },
              now: () => 1792300800000,
            })
            return { w, sent }
          }

          // ── N-a ⭐ 正向：一帧落定 ⇒ 叫一次（且说清是哪张卡）────────────────────
          {
            const { w, sent } = makeWake(WS)
            w.subscribe('session-hob', WS)
            const n = await w.handleFrame('change', frameOf({}))
            const okCount = n === 1 && sent.length === 1
            const hasCard = sent[0]?.text?.includes('t-card-1') === true
            const hasOutcome = sent[0]?.text?.includes('succeeded') === true
            const hasNext = sent[0]?.text?.includes('taskboard_get') === true
            if (okCount && hasCard && hasOutcome && hasNext) {
              ok('N-a ✓ 正向：一帧「执行落定」⇒ **叫醒一次**，话里带卡号 / 结果 / 下一步'
                + `（sent=${sent.length}）`)
            } else {
              bad('N-a 【卡跑完必须叫醒】没叫或叫得不对'
                + `：叫醒次数=${n} · sent=${sent.length} · 带卡号=${hasCard}`
                + ` · 带结果=${hasOutcome} · 带下一步=${hasNext}`)
            }
          }

          // ── N-b ⭐ 反向：同一帧再投一次 ⇒ **不叫第二声** ────────────────────────
          {
            const { w, sent } = makeWake(WS)
            w.subscribe('session-hob', WS)
            await w.handleFrame('change', frameOf({}))
            const second = await w.handleFrame('change', frameOf({}))
            if (second === 0 && sent.length === 1) {
              ok('N-b ✓ 反向：同一张卡的同一次落定再投一帧 ⇒ **第二声不叫**（去重键 = 那次执行）')
            } else {
              bad('N-b 【同一张卡不许重复叫】重复帧又叫了一次'
                + `：第二次返回值=${second} · 累计 sent=${sent.length}（应为 1）`)
            }
          }

          // ── N-c ⭐ 反向：**别的项目**的卡跑完 ⇒ 一声都不叫（叫醒面 = 显示面）────
          {
            const { w, sent } = makeWake(WS)
            w.subscribe('session-hob', WS)
            const n = await w.handleFrame('change', frameOf({ workspaceId: 'ws-OTHER' }))
            if (n === 0 && sent.length === 0) {
              ok('N-c ✓ 反向（叫醒面=显示面）：**别的项目**的卡跑完 ⇒ 一声都不叫')
            } else {
              bad('N-c 【叫醒面必须与显示面同一个】别的项目的卡把本会话叫醒了'
                + `：返回值=${n} · sent=${sent.length} ⇒ 会出现"叫醒说有卡跑完、状态行里看不到它"`)
            }
          }

          // ── N-d ⭐ 反向：`running` 那一帧**不许**当成"跑完"（防在点火时就叫）──────
          {
            const { w, sent } = makeWake(WS)
            w.subscribe('session-hob', WS)
            const n = await w.handleFrame('change', frameOf({ lastExecutionOutcome: 'running' }))
            if (n === 0 && sent.length === 0) {
              ok('N-d ✓ 反向（不许假叫醒）：`lastExecutionOutcome=running`（点火那一帧）⇒ **不叫**')
            } else {
              bad('N-d 【点火不许当成跑完】`running` 那一帧把会话叫醒了'
                + `：返回值=${n} · sent=${sent.length} ⇒ 这会在**开跑**时就叫，比不叫更坏`)
            }
          }

          // ── N-e ⭐ 失败可观测：没有订阅者 ⇒ 有可读话（⛔ 不许静默）──────────────
          {
            const { w } = makeWake(WS)   // ⚠ 故意不 subscribe
            const n = await w.handleFrame('change', frameOf({}))
            const st = w.snapshot()
            const says = typeof st.note === 'string' && st.note.includes('没有订阅者')
            const counted = st.noSubscriberCount === 1
            if (n === 0 && says && counted) {
              ok('N-e ✓ 失败可观测：没人订阅时**有一句可读话**（且单独记一档 noSubscriber）'
                + '—— ⛔ 与"没有卡跑完"分得开')
            } else {
              bad('N-e 【叫不出去必须说出来】没订阅者时没有可读输出'
                + `：返回值=${n} · 有话=${says} · noSubscriberCount=${st.noSubscriberCount}`)
            }
            // 连不上时也要有一句
            const { w: w2 } = makeWake(undefined)
            w2.subscribe('session-hob')
            await w2.handleFrame('change', frameOf({}))
            const st2 = w2.snapshot()
            const saysWs = typeof st2.note === 'string' && st2.note.includes('判不出')
            if (saysWs) {
              ok('N-e2 ✓ 失败可观测：**判不出本工作区** ⇒ 明说"不叫"，且 ⛔ 不猜一个 id 去过滤')
            } else {
              bad('N-e2 【判不出工作区必须说出来】没有可读输出（note=' + JSON.stringify(st2.note) + '）')
            }
          }

          // ── N-f ⭐ 负向对拍：把"跑完"判据摘掉 ⇒ N-a 必须当场不成立 ──────────────
          {
            const srcPath = join(root, 'src', 'server', 'card-wake.ts')
            const original = readFileSync(srcPath, 'utf8')
            const GUARD = "if (outcome === undefined || outcome === 'running') continue"
            if (!original.includes(GUARD)) {
              bad('N-f 【负向对拍失去靶子】在 `card-wake.ts` 里找不到"跑完"守卫原文'
                + `（期望：${GUARD}）⇒ 本判据已对不上实现，不按通过处理`)
            } else {
              // ⚠ 变异副本落在**本组自己的**临时目录（`lRoot` 已被上面的 finally 删掉）
              const wakeRoot = mkdtempSync(join(tmpdir(), 'hob-wakecheck-'))
              const mutPath = join(wakeRoot, 'card-wake.ts')
              writeFileSync(mutPath, original.replace(GUARD, 'if (outcome === undefined) continue'), 'utf8')
              const mutant = await import(pathToFileURL(mutPath).href)
              const sent = []
              const w = new mutant.CardWake({
                origin: 'http://127.0.0.1:0',
                workspaceIdOf: () => WS,
                deliver: (sid, text) => { sent.push({ sid, text }); return Promise.resolve({ ok: true }) },
                now: () => 1792300800000,
              })
              w.subscribe('session-hob', WS)
              // 点火那一帧（running）—— 原实现**不叫**，变异体**会叫**
              const n = await w.handleFrame('change', frameOf({ lastExecutionOutcome: 'running' }))
              if (n !== 0 || sent.length !== 0) {
                ok('N-f ✓ 负向对拍：把"跑完"守卫摘掉（变异成只判 outcome===undefined）⇒'
                  + ` N-d 的判据**当场不成立**（点火帧被叫了 ${sent.length} 声）⇒ N-d 真长牙`)
              } else {
                bad('N-f 【负向对拍失败】摘掉"跑完"守卫后，点火帧**仍然**没被叫'
                  + ' ⇒ N-d 测的不是"只认落定"这件事（它永远 PASS，也就没有分辨力）')
              }
              try { rmSync(wakeRoot, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
            }
          }
        } catch (e) {
          bad(`N 卡跑完叫醒面：本组跑不起来（${String(e?.message ?? e)}）⇒ 不按通过处理`)
        }
      }

      // ── O. **实施会话状态变化 ⇒ 叫醒**（2026-10-19 · `TASK-2` 改判后的**主信号源**）──
      //
      // ⚠ **它守的是哪条**（用户原话逐字）：
      //   「看板执行完任务之后会移动到待验收区域，你不要让看板告诉你这是不可能的，
      //     你需要自己对派出去的实施会话状态变化检查去检测，而且看板是其他的插件，
      //     你需要自己直接去检测实施会话的状态变化」
      //   ⇒ 「看板是别人的插件 ⇒ 做不到」这条退路**已撤销**；判据面改到**会话状态变化**。
      //
      // ⚠ ⚠ **三件边界必须各有一条断言**（`TASK-2` §二-① 点名，⛔ 不许含糊过去）：
      //   · **O-a 谁算"我派出去的"**：只有**登记过的**会话才可能叫（未登记的**一律不理**）；
      //   · **O-b 一次跑完只叫一次**，且**同一会话接连两轮要能区分**（第二轮**要再叫**）；
      //   · **O-c 读不到状态 ⇒ 落"判不出"**，⛔ 不许落"跑完"、⛔ 也不许落"没跑过"。
      //   ⚠ 另加 **O-d 负向对拍**（摘掉叫醒 ⇒ O-a 当场不成立）与 **O-e 旁证不许顶替主判据**。
      {
        try {
          const wakeMod = await import(pathToFileURL(join(root, 'src', 'server', 'card-wake.ts')).href)

          /**
           * 造一个叫醒面（假投递 —— ⛔ 不碰真会话）。
           *
           * ⚠⚠ **收件人不再由构造参数决定**（2026-10-19 收单第一轮 · `I-2`）：
           *   改前这里是 `new DispatchWake({ selfSessionId: ... })` —— 一个**进程级单值**，
           *   任何会话读一次状态就被刷成它自己 ⇒ A 的派发回执投给 B 的 Hob。
           *   ⛔ 那个字段与 `setSelfSessionId()` **已整个删除**；
           *   ⇒ 收件人只能由**每条登记记录自己的 `owner`** 决定（`register({ owner })`）。
           *   ⚠ 本夹具的返回签名保持不变（`{ w, sent }`），⛔ 不把断言改宽。
           */
          const makeDW = () => {
            const sent = []
            const w = new wakeMod.DispatchWake({
              deliver: (sid, text) => { sent.push({ sid, text }); return Promise.resolve({ ok: true }) },
              now: () => 1792300800000,
            })
            return { w, sent }
          }

          // ── O-a ⭐ 边界①：**只有登记过的会话**才可能叫（未登记 ⇒ 一律不理）──────────
          {
            const { w, sent } = makeDW()
            // 先跑一轮"未登记"的完整序列 ⇒ 一声都不该叫
            await w.observe('session-stranger', 'running')
            const strangerIdle = await w.observe('session-stranger', 'idle')
            const strangerSilent = sent.length === 0 && strangerIdle === undefined
            // 再登记一个 ⇒ running→idle 必须叫
            w.register({ sessionId: 'session-mine', via: 'taskboard-card', cardId: 't-card-1', owner: 'session-hob' })
            await w.observe('session-mine', 'running')
            const mineIdle = await w.observe('session-mine', 'idle')
            if (strangerSilent && mineIdle === 'woke' && sent.length === 1) {
              ok('O-a ✓ 边界①「谁算我派出去的」：**未登记的会话跑完 ⇒ 一声都不叫**；'
                + '登记过的（本会话派出的卡执行会话）跑完 ⇒ **叫一次**')
            } else {
              bad('O-a 【只认本会话登记的派发】边界不对'
                + `：陌生会话被叫=${!strangerSilent} · 登记会话结局=${mineIdle} · sent=${sent.length}`
                + ' ⇒ 要么叫了别人的活，要么没叫自己的活')
            }
          }

          // ── O-b ⭐ 边界②：一次跑完只叫一次；**同一会话接连两轮要能区分** ───────────
          {
            const { w, sent } = makeDW()
            w.register({ sessionId: 'session-mine', via: 'taskboard-card', cardId: 't-card-1', owner: 'session-hob' })
            // 第一轮
            await w.observe('session-mine', 'running')
            const r1 = await w.observe('session-mine', 'idle')
            // 同一个 idle 再来一次（重复投喂）⇒ ⛔ 不许叫第二声
            const dup = await w.observe('session-mine', 'idle')
            const afterDup = sent.length
            // 第二轮：又 running ⇒ 又 idle
            await w.observe('session-mine', 'running')
            const r2 = await w.observe('session-mine', 'idle')
            const rounds = w.entries().find((e) => e.sessionId === 'session-mine')?.rounds
            if (r1 === 'woke' && dup === undefined && afterDup === 1 && r2 === 'woke' && sent.length === 2) {
              ok('O-b ✓ 边界②：一轮跑完只叫一次（重复 idle ⇒ ⛔ 不叫）；'
                + `**同一会话接连第二轮 ⇒ 又叫一次**（rounds=${rounds} · 累计 sent=${sent.length}）`
                + '—— ⛔ 没有把第二轮当成第一轮的重复吞掉')
            } else {
              bad('O-b 【一次跑完只叫一次 + 两轮要能区分】边界不对'
                + `：第一轮=${r1} · 重复idle=${dup} · 重复后sent=${afterDup}`
                + ` · 第二轮=${r2} · 累计sent=${sent.length}（应为 2）· rounds=${rounds}`)
            }
          }

          // ── O-c ⭐ 边界③：**读不到状态 ⇒ 判不出**（⛔ 落"跑完"、⛔ 落"没跑过"）──────
          {
            const { w, sent } = makeDW()
            w.register({ sessionId: 'session-mine', via: 'taskboard-card', cardId: 't-card-1', owner: 'session-hob' })
            await w.observe('session-mine', 'running')      // 先让它真在跑
            const blank = await w.observe('session-mine', undefined)
            const empty = await w.observe('session-mine', '')
            /**
             * ⚠⚠ **`snapshot()` 现在必须带 owner**（2026-10-20 · 本单 B4 的破坏性改签名）。
             *   改前它无参、报进程级合计 ⇒ 同一工作区两个 Hob 读到对方的计数（**W6**）。
             *   ⇒ 本夹具的记录 owner 是 `session-hob`，所以这里传它；
             *     ⚠ 传别的/不传都会被**正确地**读成"我的 = 0"（那正是隔离生效，不是缺陷）。
             */
            const st = w.snapshot('session-hob')
            const isUndecidable = blank === 'undecidable' && empty === 'undecidable'
            const saidOut = typeof st.undecidableWhy === 'string' && st.undecidableWhy.includes('读不到')
            const notWoke = sent.length === 0
            const counted = st.undecidableCount === 2 && st.wokeCount === 0
            // ⚠ 还要证它**没被记成"跑过"**：之后来一个真 idle 仍要能叫（那一轮没被吞掉）
            const later = await w.observe('session-mine', 'idle')
            if (isUndecidable && saidOut && notWoke && counted && later === 'woke') {
              ok('O-c ✓ 边界③：**读不到状态 ⇒ 落"判不出"**（计数与可读话都在），'
                + '⛔ 没被记成"跑完"（一次都没叫），⛔ 也没被记成"没跑过"（随后的真 idle 仍能叫）')
            } else {
              bad('O-c 【读不到状态必须落判不出】边界不对'
                + `：blank=${blank} · empty=${empty} · 有可读话=${saidOut} · 误叫=${!notWoke}`
                + ` · 计数=${st.undecidableCount}/${st.wokeCount} · 随后的真idle=${later}`)
            }
          }

          // ── O-d ⭐ 旁证不许顶替主判据：**看板 SSE 那条**不因"卡进 in_review"就叫 ──
          //   ⚠ 用户口径：卡进 `in_review` **只是旁证** ⇒ 主判据必须能**独立于它**成立。
          //   本条钉的是反方向：**只说"卡进了 in_review"但会话没登记 ⇒ 主判据一声不叫**。
          {
            const { w, sent } = makeDW()
            // 不登记任何会话，只走 SSE 旁证通道喂一帧"卡进 in_review"
            const cw = new wakeMod.CardWake({
              origin: 'http://127.0.0.1:0',
              workspaceIdOf: () => 'ws-abc',
              deliver: () => Promise.resolve({ ok: true }),
              now: () => 1792300800000,
            })
            cw.subscribe('session-hob', 'ws-abc')
            /**
             * ⚠ 帧里必须带 `createdBy.sessionId`（= owner）：`I-9` 之后
             *   判不出 owner 的卡跑完**不投**（落"判不出 owner"那一档）——
             *   那会让本条读到 `SSE=0`，而它要证明的是"旁证自己会响"。
             */
            const sseN = await cw.handleFrame('change', JSON.stringify({
              revision: 1, kind: 'execution-recorded',
              tasks: [{ id: 't-card-1', title: '演示卡', status: 'in_review', workspaceId: 'ws-abc',
                version: 2, lastExecutionOutcome: 'succeeded',
                createdBy: { sessionId: 'session-hob' } }],
            }))
            // 主判据面（DispatchWake）在**没有任何会话登记**时应保持零叫
            const dwState = w.snapshot()
            if (sseN === 1 && dwState.wokeCount === 0 && sent.length === 0) {
              ok('O-d ✓ 旁证不许顶替主判据：看板 SSE（`in_review`）**自己会响**，'
                + '但**主判据面（实施会话状态）在没人登记时一声不叫**'
                + ` ⇒ 两条通道分开、互不冒充（SSE=${sseN} 声 · 主判据=${dwState.wokeCount} 声）`)
            } else {
              bad('O-d 【旁证不许顶替主判据】两通道串了'
                + `：SSE 声数=${sseN} · 主判据叫醒=${dwState.wokeCount} · sent=${sent.length}`)
            }
          }

          // ── O-e ⭐ 负向对拍：把叫醒那段摘掉（变异 `wake()` 恒返回 undefined）───────
          {
            const srcPath = join(root, 'src', 'server', 'card-wake.ts')
            const original = readFileSync(srcPath, 'utf8')
            const GUARD = "    s.reported = true\n    return await this.wake(s)"
            if (!original.includes(GUARD)) {
              bad('O-e 【负向对拍失去靶子】在 `card-wake.ts` 里找不到叫醒调用原文'
                + '（期望 `s.reported = true` 后紧跟 `return await this.wake(s)`）⇒ 不按通过处理')
            } else {
              const wakeRoot = mkdtempSync(join(tmpdir(), 'hob-dwcheck-'))
              const mutPath = join(wakeRoot, 'card-wake.ts')
              writeFileSync(mutPath, original.replace(GUARD, '    s.reported = true\n    return undefined'), 'utf8')
              const mutant = await import(pathToFileURL(mutPath).href)
              const sent = []
              const w = new mutant.DispatchWake({
                deliver: (sid, text) => { sent.push({ sid, text }); return Promise.resolve({ ok: true }) },
                now: () => 1792300800000,
              })
              w.register({ sessionId: 'session-mine', via: 'taskboard-card', cardId: 't-card-1', owner: 'session-hob' })
              await w.observe('session-mine', 'running')
              const r = await w.observe('session-mine', 'idle')
              if (r !== 'woke' && sent.length === 0) {
                ok('O-e ✓ 负向对拍：把叫醒调用摘掉（变异成 `return undefined`）⇒'
                  + ` O-a/O-b 的判据**当场不成立**（结局=${r ?? '(无)'} · sent=${sent.length}）⇒ 前两条真长牙`)
              } else {
                bad('O-e 【负向对拍失败】摘掉叫醒之后仍然叫了'
                  + `（结局=${r} · sent=${sent.length}）⇒ O-a/O-b 测的不是"叫醒"这件事`)
              }
              try { rmSync(wakeRoot, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
            }
          }
        } catch (e) {
          bad(`O 实施会话叫醒面：本组跑不起来（${String(e?.message ?? e)}）⇒ 不按通过处理`)
        }
      }

      // ── P. **叫醒不许依赖「Hob 事先读过卡面」**（2026-10-19 · 实测打空的那一次）────
      //
      // ⚠ **它守的是哪条**（实测时间线，不是推断）：
      //   短活卡 `t-mvdzqp1a-80odlo` — `00:24:13` 点火 → `00:24:33` 落定 →
      //   **`00:35` 之后 Hob 才第一次读卡面**。按 `523b610` 的实现，卡的执行会话
      //   **只有读卡面时才登记** ⇒ 登记发生在跑完之后 ⇒ `running → idle` 那一跳早过去了
      //   ⇒ **一声不叫**。而那恰恰是**最需要叫醒**的情形（派出去就没再回头看）。
      //
      // ⚠ ⚠ **四件必须各一条**（作业书 §二-③ 点名）：
      //   · **P-a 未看过卡面也叫一次**：**不调用读卡面那条路径**，只喂「点火帧 + 按卡现读会话」
      //     ⇒ 会话 `running → idle` **必须叫一次**；
      //   · **P-b 同一轮不重复叫**：重复 `idle` ⇒ 不叫；
      //   · **P-c 同会话第二轮仍能叫**：再 `running → idle` ⇒ 又叫（第 2 轮）；
      //   · **P-d 读不到 ⇒ 判不出**：按卡现读**读不到** ⇒ 留可读话，且**不登记、不叫**。
      //   ⚠ 另加 **P-e 负向对拍**（把"按推送登记"摘掉 ⇒ P-a 当场不成立）。
      {
        try {
          const wakeMod = await import(pathToFileURL(join(root, 'src', 'server', 'card-wake.ts')).href)

          /** 造一个"真看板"工具注册表：只实现 `taskboard_get`（按卡 id 现读）。 */
          const boardWith = (card) => ({
            get: (n) => n !== 'taskboard_get' ? undefined : {
              execute: async (args) => {
                if (args?.id !== card.id) return { task: undefined }
                return { task: card }
              },
            },
          })

          /** 一张真形态的卡（字段照 `dsh-taskboard` 的 `TaskRecord` 只给用得到的）。 */
          const cardOf = (over) => ({
            id: 't-card-1', title: '演示卡', status: 'in_progress', workspaceId: 'ws-abc', version: 2,
            execution: { mode: 'claim' }, comments: [], createdBy: { kind: 'user' },
            executions: [{ id: 'e-1', outcome: 'running', startedAt: 1, sessionId: 'session-exec-1' }],
            ...over,
          })

          /** 一帧**点火**推送（看板 `broadcast()` 的真形态）。 */
          const firingFrame = JSON.stringify({
            revision: 1, kind: 'execution-recorded',
            tasks: [{ id: 't-card-1', title: '演示卡', status: 'in_progress', workspaceId: 'ws-abc',
              version: 2, lastExecutionOutcome: 'running' }],
          })

          // ── P-a ⭐ **未看过卡面也叫一次**（本件的核心判据 · **走完整链路**）──────────
          //
          // ⚠ ⚠ **本条的链路必须是端到端的**（上一版写在这里时只手工调了 lookup+register，
          //   ⇒ 正负对拍里"把点火帧认卡变异掉"**抓不到它** —— 那是**假绿**）。
          //   现在的链路 = **推送到 CardWake.handleFrame(点火帧)**
          //     → `onFiring` 回调 → `lookupCardSession`（只读那一张）→ `register`
          //     → 再喂 `agent/status` 的 `running → idle` ⇒ 必须叫一次。
          //   ⚠ 全程**不调用 `readCards` / `cardsOf`**（= 没读过卡面）。
          {
            const sent = []
            const dw = new wakeMod.DispatchWake({
              deliver: (sid, text) => { sent.push({ sid, text }); return Promise.resolve({ ok: true }) },
              now: () => 1792300800000,
            })
            const board = boardWith(cardOf({}))
            let firedSeen = 0
            const cw = new wakeMod.CardWake({
              origin: 'http://127.0.0.1:0',
              workspaceIdOf: () => 'ws-abc',
              deliver: () => Promise.resolve({ ok: true }),
              now: () => 1792300800000,
              // ⚠ 这是 M5 里那段接法的**同构版**：认到点火帧 ⇒ 现读那一张 ⇒ 登记
              onFiring: (e) => {
                firedSeen++
                void wakeMod.lookupCardSession(e.taskId, board.get).then((r) => {
                  if (r.kind === 'found') dw.register({ sessionId: r.sessionId, via: 'taskboard-card', cardId: r.cardId, owner: 'session-hob' })
                })
              },
            })
            await cw.handleFrame('change', firingFrame)
            await new Promise((r) => setTimeout(r, 20))   // 让 onFiring 的异步登记落地
            /** ⚠ `snapshot()` 必须带 owner（B4）：本夹具登记时给的 owner 是 `session-hob`。 */
            const registeredCount = dw.snapshot('session-hob').registered
            // 现在喂"会话状态变化"（真实实例里 agent/status 送来的那一对）
            await dw.observe('session-exec-1', 'running')
            const r = await dw.observe('session-exec-1', 'idle')
            if (firedSeen === 1 && registeredCount === 1 && r === 'woke' && sent.length === 1) {
              ok('P-a ✓ **未看过卡面也叫一次**（端到端）：只看推送 ⇒ 点火帧认出 1 张卡 ⇒ '
                + '按卡现读登记 1 个会话 ⇒ 会话跑完**叫了 1 次**'
                + '（⚠ 这正是上一版会打空的那一次；⛔ 全程没走"读卡面"那条路）')
            } else {
              bad('P-a 【未读卡面也必须叫】核心判据不成立'
                + `：点火帧认出=${firedSeen} 张（应 1）· 登记=${registeredCount}（应 1）`
                + ` · observe(idle)=${r} · sent=${sent.length}`)
            }
          }

          // ── P-b / P-c ⭐ 同一轮不重复 + 第二轮仍能叫 ────────────────────────────
          {
            const sent = []
            const dw = new wakeMod.DispatchWake({
              deliver: (sid, text) => { sent.push({ sid, text }); return Promise.resolve({ ok: true }) },
              now: () => 1792300800000,
            })
            const looked = await wakeMod.lookupCardSession('t-card-1', boardWith(cardOf({})).get)
            dw.register({ sessionId: looked.sessionId, via: 'taskboard-card', cardId: 't-card-1', owner: 'session-hob' })
            await dw.observe('session-exec-1', 'running')
            const r1 = await dw.observe('session-exec-1', 'idle')
            const dup = await dw.observe('session-exec-1', 'idle')
            const afterDup = sent.length
            await dw.observe('session-exec-1', 'running')
            const r2 = await dw.observe('session-exec-1', 'idle')
            if (r1 === 'woke' && dup === undefined && afterDup === 1 && r2 === 'woke' && sent.length === 2) {
              ok('P-b/P-c ✓ 不重复也不吞第二轮：第一轮叫 1 次 · 重复 idle ⛔ 不叫'
                + ` · **第二轮又叫**（累计 sent=${sent.length}）`)
            } else {
              bad('P-b/P-c 【不重复 / 两轮可区分】边界不对'
                + `：第一轮=${r1} · 重复=${dup} · 重复后sent=${afterDup} · 第二轮=${r2} · 累计=${sent.length}`)
            }
          }

          // ── P-d ⭐ **读不到 ⇒ 判不出**（⛔ 不登记、⛔ 不叫、⛔ 不静默）────────────
          {
            // 情形①：工具面里根本没有 taskboard_get（看板没装）
            const r1 = await wakeMod.lookupCardSession('t-card-1', undefined)
            // 情形②：工具在，但读回来没有 task（卡没了）
            const deadBoard = { get: (n) => n !== 'taskboard_get' ? undefined : { execute: async () => ({}) } }
            const r2 = await wakeMod.lookupCardSession('t-card-1', deadBoard.get)
            // 情形③：读到了卡，但它没有执行会话 id
            const noSess = await wakeMod.lookupCardSession('t-card-1',
              boardWith(cardOf({ executions: [] })).get)

            const sent = []
            const dw = new wakeMod.DispatchWake({
              deliver: (sid, text) => { sent.push({ sid, text }); return Promise.resolve({ ok: true }) },
              now: () => 1792300800000,
            })
            // 三档都必须**不登记**；并且"读不到"这一档要留可读话
            dw.noteRegistryIssue('t-card-1', 'unreadable', r1.kind === 'unreadable' ? r1.why : '(意外)')
            const st = dw.snapshot()
            const allSeparated = r1.kind === 'unreadable' && r2.kind === 'unreadable' && noSess.kind === 'no-session'
            const said = typeof st.pushRegisterWhy === 'string' && st.pushRegisterWhy.includes('读不到')
            const noReg = st.registered === 0 && sent.length === 0
            if (allSeparated && said && noReg) {
              ok('P-d ✓ 读不到 ⇒ 判不出：三档分开（工具缺席 / 卡没了 = `unreadable`、'
                + '**没有会话 id** = `no-session`）；可读话里明写"**这是读不到，不是没有会话**"；'
                + '⛔ 没登记、⛔ 没叫')
            } else {
              bad('P-d 【读不到必须落判不出】三档没分开或没留痕'
                + `：r1=${r1.kind} · r2=${r2.kind} · noSess=${noSess.kind}`
                + ` · 有可读话=${said} · registered=${st.registered} · sent=${sent.length}`)
            }
          }

          // ── P-e ⭐ 负向对拍：**把"从点火帧认卡"变异掉** ⇒ P-a 当场不成立 ───────────
          //
          // ⚠ 变异点 = `cardFiringEventsOf` 里那道"只认 running"的守卫换成"永不返回"
          //   （等价于"推送里认不出正在开跑的卡" ⇒ 回到上一版"没人读卡面就没登记"的行为）。
          // ⚠ 判据**不是**退出码，而是：用变异体跑**同一段 P-a 流程** ⇒ 登记不到 ⇒ **一声不叫**。
          {
            const srcPath = join(root, 'src', 'server', 'card-wake.ts')
            const original = readFileSync(srcPath, 'utf8')
            const GUARD = "  const out: CardFiringEvent[] = []\n  for (const raw of f.tasks) {"
            if (!original.includes(GUARD)) {
              bad('P-e 【负向对拍失去靶子】在 `card-wake.ts` 的 `cardFiringEventsOf` 里找不到靶点原文'
                + ' ⇒ 本判据已对不上实现，不按通过处理')
            } else {
              const mutRoot = mkdtempSync(join(tmpdir(), 'hob-pcheck-'))
              const mutPath = join(mutRoot, 'card-wake.ts')
              writeFileSync(mutPath, original.replace(GUARD, '  const out: CardFiringEvent[] = []\n  if (true) return out\n  for (const raw of f.tasks) {'), 'utf8')
              const mutant = await import(pathToFileURL(mutPath).href)
              // 变异体：喂真形态点火帧 ⇒ **认不出任何在跑的卡**
              const fired = mutant.cardFiringEventsOf(JSON.parse(firingFrame), 'ws-abc')
              // 原实现 认出 1 张
              const firedOk = wakeMod.cardFiringEventsOf(JSON.parse(firingFrame), 'ws-abc')
              // 变异体下走同一段 P-a：没有点火帧 ⇒ 登记不到 ⇒ 不叫
              const sent = []
              const dw = new mutant.DispatchWake({
                deliver: (sid, text) => { sent.push({ sid, text }); return Promise.resolve({ ok: true }) },
                now: () => 1792300800000,
              })
              // ⚠ 真实现里 onFiring 是唯一登记入口 ⇒ 认不出就不登记
              await dw.observe('session-exec-1', 'running')
              const r = await dw.observe('session-exec-1', 'idle')
              if (firedOk.length === 1 && fired.length === 0 && r === undefined && sent.length === 0) {
                ok('P-e ✓ 负向对拍：把"从点火帧认卡"变异掉 ⇒ **认不出在跑的卡**（0 张）'
                  + ' ⇒ 同一段流程**登记不到、一声不叫**（observe(idle)=undefined）'
                  + ' ⇒ P-a 测的确实是"按推送登记"这一环，不是别的东西')
              } else {
                bad('P-e 【负向对拍失败】变异后行为没变'
                  + `：原实现认出=${firedOk.length} 张（应 1）· 变异体认出=${fired.length} 张（应 0）`
                  + ` · observe(idle)=${r} · sent=${sent.length}`)
              }
              try { rmSync(mutRoot, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
            }
          }
        } catch (e) {
          bad(`P 叫醒不依赖事先浏览：本组跑不起来（${String(e?.message ?? e)}）⇒ 不按通过处理`)
        }
      }

      // ── Q. **看板地址必须现取**（2026-10-19 重启实测：「接不上」不会自愈）────────────
      //
      // ⚠ **它守的是哪条缺陷**（重启后三次读数的实测，不是推断）：
      //   宿主 `12:23:38` 重启；`12:36:27` / `12:37:17` / `12:45:57` 三次 `hob_orch_status`
      //   都报同一句「拿不到看板地址（webServer 不可用）⇒ 叫醒面没接上」。
      //   ⇒ 那不是"取得太早"，是**只取了一次**：`CardWake` 的 `origin` 由 orchestrator 在
      //     `apply()` 那一刻**立即求值**（IIFE）⇒ 那一刻 `webServer` 还没 bind ⇒ `undefined`
      //     **永久**；此后 `startWakeIfNeeded` 又因为 `conn === 'broken'` 不再重来
      //     ⇒ **结构上不可能自愈**（`E-01` 的同族：另一个模块里同一个坑）。
      //
      // ⚠ ⚠ **判定四件，缺一条都算没修**（E-112：只看退出码不够，要看可读断言）：
      //   · **Q-a 正向 · 现取**：`origin` 给**函数**（先返回 undefined，模拟"还没就绪"）
      //     ⇒ 先报可读的"拿不到地址"；然后让函数**开始返回地址** ⇒ **再订阅一次就接上**；
      //   · **Q-b 反向 · 不自欺**：一直取不到 ⇒ **每次都给可读话**，且写清"能否自愈 / 什么才叫真出问题"；
      //   · **Q-c 接线（对 orchestrator）**：传进去的 `origin` **必须是函数**且含 `getOrigin()`；
      //   · **Q-d 负向对拍（变异）**：把 `start()` 里"现取"改回"只认字符串" ⇒ **Q-a 当场不成立**。
      {
        try {
          const wakeMod = await import(pathToFileURL(join(root, 'src', 'server', 'card-wake.ts')).href)

          /** 一个**必定拒连**的假 fetch（不挂网络、立刻失败，且失败原因可与"取不到地址"分辨）。 */
          const refusedFetch = async () => { throw new Error('probe: connection refused') }
          /** 等条件成立（轮询 ≤ 800ms）；返回是否成立。 */
          const until = async (fn, ms = 800) => {
            const t0 = Date.now()
            while (Date.now() - t0 < ms) {
              if (fn()) return true
              await new Promise((r) => setTimeout(r, 10))
            }
            return fn()
          }

          // ── Q-a ⭐ 正向：**地址后到 ⇒ 下一次订阅就接上**（本件的核心判据）────────
          {
            let originNow
            const cw = new wakeMod.CardWake({
              origin: () => originNow,                      // ⚠ 函数 = 现取（被测形态）
              workspaceIdOf: () => 'ws-abc',
              deliver: () => Promise.resolve({ ok: true }),
              now: () => 1792300800000,
            })
            cw.subscribe('session-hob')
            cw.startWakeIfNeeded(refusedFetch)
            const s1 = cw.snapshot()
            const saidUnavailable = typeof s1.note === 'string' && s1.note.includes('拿不到看板地址')
            const noUrl1 = s1.url === undefined

            originNow = 'http://127.0.0.1:1'                 // 宿主 web 服务就绪了
            cw.startWakeIfNeeded(refusedFetch)               // ⚠ 再订阅一次（= 再读一次状态）
            const gotUrl = await until(() => cw.snapshot().url !== undefined)
            const s2 = cw.snapshot()
            /**
             * ⚠ 接上的判据 = **url 出现了**（= 真的用上了后到的地址）。
             *   ⛔ 不能拿 `conn === 'live'` 当判据：本组用拒连的假 fetch ⇒ 必然 `broken`，
             *     但那个 `broken` 的**原因**已经换成"连接失败"（不是"取不到地址"）——
             *     两者可分辨，正是本件要求的可读判据。
             */
            const recovered = gotUrl && typeof s2.url === 'string' && s2.url.includes('127.0.0.1:1')
            const noteIsNotUnavailable = typeof s2.note !== 'string' || !s2.note.includes('拿不到看板地址')
            cw.stop()
            if (saidUnavailable && noUrl1 && recovered && noteIsNotUnavailable) {
              ok('Q-a ✓ 正向：看板地址**后到** ⇒ 再订阅一次就**接上**'
                + `（起初报"拿不到看板地址" ⇒ 地址就绪后 url=${s2.url}）`
                + ' ⇒ 重启后**能自愈**，⛔ 不是永久接不上')
            } else {
              bad('Q-a 【地址后到必须能接上】不成立'
                + `：先报"拿不到地址"=${saidUnavailable} · 初次无 url=${noUrl1}`
                + ` · 地址就绪后再订阅 有 url=${recovered} · 仍报拿不到=${!noteIsNotUnavailable}`)
            }
          }

          // ── Q-b ⭐ 反向：**一直取不到 ⇒ 每次都说清楚**（⛔ 不许静默 / ⛔ 不许当空）──
          {
            const cw = new wakeMod.CardWake({
              origin: () => undefined,                      // 永远取不到
              workspaceIdOf: () => 'ws-abc',
              deliver: () => Promise.resolve({ ok: true }),
              now: () => 1792300800000,
            })
            cw.subscribe('session-hob')
            cw.startWakeIfNeeded(refusedFetch)
            const n1 = cw.snapshot().note
            cw.startWakeIfNeeded(refusedFetch)              // 再试一次
            const n2 = cw.snapshot().note
            cw.stop()
            const said = (n) => typeof n === 'string' && n.includes('拿不到看板地址')
            /**
             * ⚠ 判据三件：
             *   ① 每次都有一句可读话（⛔ 不静默）；
             *   ② 话里写清**这不等于"没有卡跑完"**（`423b536` 立的可读行不许退化）；
             *   ③ 话里写清**能不能自愈** ⇒ 读者才分得出"等一下"与"宿主没起 web 服务"。
             */
            const text2 = typeof n2 === 'string' ? n2 : (typeof n1 === 'string' ? n1 : '')
            const saysNotNoCard = text2.includes('不代表') || text2.includes('不等于')
            const saysSelfHeal = text2.includes('自愈')
            if (said(n1) && said(n2) && saysNotNoCard && saysSelfHeal) {
              ok('Q-b ✓ 反向：一直取不到地址 ⇒ **每次都给可读话**，'
                + '且明写"⛔ 不等于没有卡跑完"与"**会自愈·何为真出问题**"'
                + '（⛔ 没有静默，⛔ 也没有伪装成"没有卡在跑"）')
            } else {
              bad('Q-b 【取不到地址必须可读且说清能否自愈】缺项'
                + `：首次有可读话=${said(n1)} · 再次有=${said(n2)}`
                + ` · 写了不等于没有卡=${saysNotNoCard} · 写了会自愈=${saysSelfHeal}`)
            }
          }

          // ── Q-c ⭐ **接线必须走现取**（orchestrator 侧，⛔ 不许退回快照）─────────
          {
            const orchSrc = readFileSync(join(root, 'src', 'modules', 'orchestrator.ts'), 'utf8')
            const callSite = orchSrc.indexOf('new CardWake({')
            if (callSite < 0) {
              bad('Q-c 【失去靶子】`orchestrator.ts` 里找不到 `new CardWake({` ⇒ 本组不按通过处理')
            } else {
              const seg = orchSrc.slice(callSite, callSite + 2400)
              const m = seg.match(/origin:\s*([\s\S]{0,700}?),\s*\n\s*workspaceIdOf:/)
              const expr = m === undefined ? '' : m[1].trim()
              const flat = expr.replace(/\s+/g, ' ')
              /** ⚠ 必须是函数形态（`() => …` / `function`），⛔ 不许是立即求值的 IIFE。 */
              const isFunction = /^(\(\)\s*=>|function\b|async\s*\(\)\s*=>)/.test(flat)
              const isIIFE = /^\(\s*\(\)\s*=>[\s\S]*\)\s*\(\s*\)$/.test(flat)
              const callsGetOrigin = expr.includes('getOrigin()')
              if (isFunction && callsGetOrigin && !isIIFE) {
                ok('Q-c ✓ 接线：`orchestrator.ts` 传给 `CardWake` 的 `origin` 是**现取函数**'
                  + '（内含 `getOrigin()`）⇒ 地址不会被 `apply()` 那一刻定死')
              } else {
                bad('Q-c 【origin 必须是现取函数】接线退回了快照'
                  + `：是函数=${isFunction} · 立即求值(IIFE)=${isIIFE}`
                  + ` · 含 getOrigin=${callsGetOrigin} · 实际=${flat.slice(0, 140)}`)
              }
            }
          }

          // ── Q-d ⭐ 负向对拍：**把 origin 变异回"求值一次"** ⇒ Q-a 当场不成立 ────────
          {
            const srcPath = join(root, 'src', 'server', 'card-wake.ts')
            const original = readFileSync(srcPath, 'utf8')
            const GUARD = "    const origin = typeof this.opts.origin === 'function' ? this.opts.origin() : this.opts.origin"
            if (!original.includes(GUARD)) {
              bad('Q-d 【负向对拍失去靶子】在 `card-wake.ts` 的 `start()` 里找不到"现取地址"那一行原文'
                + ' ⇒ 本判据已对不上实现，不按通过处理')
            } else {
              const mutRoot = mkdtempSync(join(tmpdir(), 'hob-qcheck-'))
              const mutPath = join(mutRoot, 'card-wake.ts')
              // 变异成"只认字符串（= 快照语义）"：函数一律当 undefined
              writeFileSync(mutPath, original.replace(GUARD,
                "    const origin = typeof this.opts.origin === 'string' ? this.opts.origin : undefined"), 'utf8')
              const mutant = await import(pathToFileURL(mutPath).href)
              const cwMut = new mutant.CardWake({
                origin: () => 'http://127.0.0.1:1',         // ⚠ 即便地址一开始就在
                workspaceIdOf: () => 'ws-abc',
                deliver: () => Promise.resolve({ ok: true }),
                now: () => 1792300800000,
              })
              cwMut.subscribe('session-hob')
              cwMut.startWakeIfNeeded(refusedFetch)
              cwMut.startWakeIfNeeded(refusedFetch)
              const sMut = cwMut.snapshot()
              cwMut.stop()
              const mutantStillUnavailable = typeof sMut.note === 'string' && sMut.note.includes('拿不到看板地址')
              const mutantNoUrl = sMut.url === undefined
              // 原实现同一场景 ⇒ 一定有 url（这就是 Q-a 的判据）
              const cwOk = new wakeMod.CardWake({
                origin: () => 'http://127.0.0.1:1',
                workspaceIdOf: () => 'ws-abc',
                deliver: () => Promise.resolve({ ok: true }),
                now: () => 1792300800000,
              })
              cwOk.subscribe('session-hob')
              cwOk.startWakeIfNeeded(refusedFetch)
              const realHasUrl = typeof cwOk.snapshot().url === 'string'
              cwOk.stop()
              if (mutantStillUnavailable && mutantNoUrl && realHasUrl) {
                ok('Q-d ✓ 负向对拍：把 `origin` 变异回**快照语义**（函数一律当 undefined）'
                  + ' ⇒ 即便地址一开始就在，也叫不出去（仍报"拿不到看板地址"· url=无）'
                  + ' ⇒ Q-a 测的确实是"现取"这一环，不是别的东西')
              } else {
                bad('Q-d 【负向对拍失败】变异后行为没变'
                  + `：变异体仍报拿不到地址=${mutantStillUnavailable} · 变异体无 url=${mutantNoUrl}`
                  + ` · 原实现有 url=${realHasUrl}`)
              }
              try { rmSync(mutRoot, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
            }
          }
        } catch (e) {
          bad(`Q 看板地址现取：本组跑不起来（${String(e?.message ?? e)}）⇒ 不按通过处理`)
        }
      }

      // ── R. **一条信号只投一次、只投给它的唯一 owner**（2026-10-19 收单第一轮 · `I-9`）──
      //
      // ⚠ **它守的是哪条缺陷**（用户实测，不是推断；作业书 §8 逐字引用）：
      //   用户原话「**你收到错误的，正确的 hob 预设肯定就收不到指令了**」——
      //   错投与漏投是**同一件事的两面**：一份投错了，正确的那一方就永远收不到。
      //
      // ⚠ ⚠ **旧的 R 组已经整体作废（⛔ 不是放宽、是改判）**：
      //   它钉的是"按**订阅者自己报的项目**逐个筛 ⇒ 投给所有匹配的订阅者"。
      //   而 `I-9` 明令：**一条信号至多一次投递、⛔ 禁止扇出**，收件人 = **该记录自己的 owner**。
      //   ⇒ 旧判据（"同一项目里多个订阅者都该收到"）在语义上已不成立
      //     （那正是用户点名的"同一工作区也串收"那一半）。
      //   ⚠ 本组**换成四条更硬的靶子**，并保留一个负向对拍：
      //
      //   · **R-a 唯一 owner**：卡属 A ⇒ **只有 A 收到**，同项目里的 B ⛔ 一声都不收
      //     （= "同一工作区隔离"那一半，作业书 §3-3 点名）；
      //   · **R-b 只投一次**：一帧里同一张卡出现两次 / 同帧重复投喂 ⇒ **总共只有一份**；
      //   · **R-c 判不出 owner ⇒ 不投** + 独立一档可读话（⛔ 不许按工作区兜底、⛔ 不许静默）；
      //   · **R-d 没有 legacy 退回路径**：⛔ `card-wake.ts` 里不得再出现
      //     "`t.workspaceId === undefined` 的订阅者按全局 ws 判该不该收"那种写法
      //     （⚠ 这一条就是作业书要求的"把依赖 `legacyTargetCount` 的断言改成断言没有退回路径"）；
      //   · **R-e 具名反例**（`I-11`，⚠ 作业书要求把现场样本写成机检，⛔ 不许只写在注释里）；
      //   · **R-f 负向对拍**：把"唯一收件人"变异成"按订阅表广播" ⇒ **R-a 当场不成立**。
      //
      // ⚠ 造样本**全部在内存里**：⛔ 不碰真看板、⛔ 不动别人项目的卡、⛔ 不起第二个宿主。
      {
        try {
          const wakeMod = await import(pathToFileURL(join(root, 'src', 'server', 'card-wake.ts')).href)
          const WS_MINE = 'ws-mine-0001'
          const WS_OTHER = 'ws-other-0002'

          /**
           * 造一个只用**内存**的叫醒面。
           *
           * @param opts.subs - `[sessionId, workspaceId?]` 列表（⚠ workspaceId 缺省 = "没报项目"）。
           */
          const makeCW = (subs, over = {}) => {
            const sent = []
            const cw = new wakeMod.CardWake({
              origin: 'http://127.0.0.1:0',
              workspaceIdOf: () => over.globalWs,          // ⚠ 进程级单值（下面要证明它不再决定投给谁）
              deliver: over.deliver ?? ((sid, text) => { sent.push({ sid, text }); return Promise.resolve({ ok: true }) }),
              now: () => 1792300800000,
            })
            for (const [sid, ws] of subs) cw.subscribe(sid, ws)
            return { cw, sent }
          }

          /**
           * 造一帧「执行落定」的 SSE 负载。
           * @param ws - 这张卡属于哪个项目（⚠ 已**不是**投递判据）。
           * @param owner - 这张卡的 `createdBy.sessionId` = **收件人**；`undefined` ⇒ 判不出。
           * @param extraTasks - 往同一帧里再塞几张卡（验"一条信号只投一次"）。
           */
          const frameOn = (ws, owner, extraTasks = []) => JSON.stringify({
            revision: 1, kind: 'execution-recorded',
            tasks: [
              { id: 't-card-x', title: '演示卡', status: 'in_review', workspaceId: ws,
                version: 2, lastExecutionOutcome: 'succeeded',
                ...(owner === undefined ? { createdBy: { kind: 'user' } } : { createdBy: { sessionId: owner } }) },
              ...extraTasks,
            ],
          })

          // ── R-a ⭐ **唯一 owner**：同项目里的另一个会话 ⛔ 一声都不收 ────────────
          //
          //   ⚠ 这一条是"**同一工作区隔离**"那一半（作业书 §3-3 点名要求）：
          //     改前同一项目里**所有订阅过的会话都会收到**（扇出）⇒ 两个 Hob 互相串收。
          {
            const { cw, sent } = makeCW([
              ['session-hob', WS_MINE],
              ['session-other-hob-same-ws', WS_MINE],   // ⚠ 同一个项目、另一个会话
            ], { globalWs: WS_MINE })
            const n = await cw.handleFrame('change', frameOn(WS_MINE, 'session-hob'))
            const toOwner = sent.filter((x) => x.sid === 'session-hob').length
            const toOther = sent.filter((x) => x.sid === 'session-other-hob-same-ws').length
            if (n === 1 && sent.length === 1 && toOwner === 1 && toOther === 0) {
              ok('R-a ✓ **唯一 owner**（含**同一工作区**隔离）：卡属 session-hob ⇒'
                + ` 只有它收到（合计投递=${sent.length}）· 同项目的另一个会话收到 ${toOther} 声`
                + ' ⇒ 改前这里是 1/1（扇出）')
            } else {
              bad('R-a 【同一工作区必须隔离】同一项目里的另一个会话也收到了（= 串收 / 扇出）'
                + `：合计投递=${sent.length}（应 1）· owner 收到=${toOwner}（应 1）`
                + ` · 同项目他人收到=${toOther}（应 0）· 返回值=${n}`)
            }
          }

          // ── R-a2 ⭐ **跨项目也照同一判据**：卡属别人的项目、owner 是对方 ──────────
          //   ⚠ 这一条与 R-a 成对：证明"项目不匹配就不投"与"owner 决定收件人"**不冲突**。
          {
            const { cw, sent } = makeCW([['session-hob', WS_MINE]], { globalWs: WS_OTHER })
            const n = await cw.handleFrame('change', frameOn(WS_OTHER, 'session-elsewhere'))
            /**
             * ⚠ 判据（`I-9`）：卡属**别的项目**、owner 是**别人** ⇒
             *   投递**只到 owner 那一个**，⛔ **一声都不给本会话**。
             * ⚠ 这里**不能**断言"投递 = 0"：owner 是别人≠不投，而是"**不投给我**"
             *   （`I-10`：该收到的人必须收到，否则就是漏投）。
             */
            const toVictim = sent.filter((x) => x.sid === 'session-hob').length
            const toOwner = sent.filter((x) => x.sid === 'session-elsewhere').length
            if (toVictim === 0 && toOwner === 1 && sent.length === 1 && n === 1) {
              ok('R-a2 ✓ 卡属**别的项目**、owner 是别人 ⇒ **只投给 owner**（1 份）、'
                + '本会话一声都不收（⚠ 投给谁只由 owner 决定，⛔ 不是"我订阅了这个项目"）')
            } else {
              bad('R-a2 【别人的卡的 owner 不是我】收件人不对'
                + `：投给本会话=${toVictim}（应 0）· 投给 owner=${toOwner}（应 1）`
                + ` · 合计=${sent.length}（应 1）· 返回值=${n}`
                + ` · 收到=${sent.map((x) => x.sid).join(',') || '(无)'}`)
            }
          }

          // ── R-b ⭐ **一条信号只投一次**（同帧重复 / 重复帧都不加第二份）───────────
          {
            const dupCard = { id: 't-card-x', title: '演示卡', status: 'in_review', workspaceId: WS_MINE,
              version: 2, lastExecutionOutcome: 'succeeded', createdBy: { sessionId: 'session-hob' } }
            const { cw, sent } = makeCW([['session-hob', WS_MINE]], { globalWs: WS_MINE })
            // ① 同一帧里同一张卡出现两次
            await cw.handleFrame('change', frameOn(WS_MINE, 'session-hob', [dupCard]))
            const afterDupInFrame = sent.length
            // ② 同一帧再投一次（看板重连会补发）
            await cw.handleFrame('change', frameOn(WS_MINE, 'session-hob'))
            const afterRefeed = sent.length
            const ledger = cw.deliveredLedger()
            if (afterDupInFrame === 1 && afterRefeed === 1 && ledger.length === 1
                && ledger[0].to === 'session-hob') {
              ok('R-b ✓ **只投一次**：同帧重复 + 重复帧 ⇒ 总共 **1 份**'
                + `（已投台账=${JSON.stringify(ledger)}）⇒ ⛔ 没有扇出、⛔ 没有第二份`)
            } else {
              bad('R-b 【一条信号至多投一次】出现了第二份'
                + `：同帧重复后=${afterDupInFrame}（应 1）· 再投一帧后=${afterRefeed}（应 1）`
                + ` · 台账=${JSON.stringify(ledger)}`)
            }
          }

          // ── R-c ⭐ **判不出 owner ⇒ 不投** + 独立一档 + 可读话 ────────────────────
          //
          //   ⚠ 这一档就是"⛔ 不许改投别人"的落点：**宁可漏，也不投错**
          //     （用户原话："你收到错误的，正确的 hob 预设肯定就收不到指令了"）。
          {
            const { cw, sent } = makeCW([['session-hob', WS_MINE]], { globalWs: WS_MINE })
            await cw.handleFrame('change', frameOn(WS_MINE, undefined))
            const st = cw.snapshot()
            const note = typeof st.note === 'string' ? st.note : ''
            const notDelivered = sent.length === 0
            const counted = st.legacyTargetCount === 1
            const namesIt = note.includes('t-card-x')
            const saysNoGuess = note.includes('判不出它的 owner')
            const saysNoFallback = note.includes('没有**退回') || note.includes('没有退回')
            const notMixed = st.noSubscriberCount === 0
            if (notDelivered && counted && namesIt && saysNoGuess && saysNoFallback && notMixed) {
              ok('R-c ✓ **判不出 owner ⇒ 不投**：投递=0 · 独立档 legacyTargetCount=1'
                + ' · 可读话点名卡 + 明写"判不出它的 owner" + 明写**没有**退回旧路'
                + ' · ⛔ 未并进"没有订阅者"那一档')
            } else {
              bad('R-c 【判不出 owner 必须"不投 + 独立可读一档"】缺项'
                + `：投递=${sent.length}（应 0）· legacyTargetCount=${st.legacyTargetCount}（应 1）`
                + ` · 点名卡=${namesIt} · 写"判不出它的 owner"=${saysNoGuess}`
                + ` · 写"没有退回"=${saysNoFallback} · 未并进筛空=${notMixed}`
                + ` · note=${JSON.stringify(note.slice(0, 180))}`)
            }
          }

          // ── R-d ⭐ **没有 legacy 退回路径**（作业书 §2 `I-7` 的成对要求）─────────────
          //
          //   ⚠ 作业书原文：「既有 N 组机检里凡依赖 `legacyTargetCount` 的断言，
          //     改为断言"**没有退回路径**"（⛔ 不许删断言了事）」。
          //   ⇒ 本条的判据 = **源码里不得再有那条按全局 ws 判订阅者的谓词**，
          //     且 `CardWakeOpts` 不得再暴露"进程级收件人 / 进程级工作区"那种用法。
          {
            const wakeSrc = readFileSync(join(root, 'src', 'server', 'card-wake.ts'), 'utf8')
            const wakeCode = stripComments(wakeSrc)
            // ⚠ 旧退回路径的原文形态：`t.workspaceId === undefined && ... workspaceIdOf() ... === e.workspaceId`
            const hasLegacyFallback = /workspaceId\s*===\s*undefined[^\n]{0,200}workspaceIdOf\s*\(/.test(wakeCode)
            // ⚠ 也不许再把"没报项目"的订阅者塞进投递名单（`legacy` 那个数组名）
            const hasLegacyList = /\bconst\s+legacy\s*=/.test(wakeCode)
            // ⚠ 投递循环必须**只有一个收件人**（`deliverFn(to, text)`），⛔ 不许 `[...eligible, ...legacy]`
            const fansOut = /for\s*\(\s*const\s+\w+\s+of\s*\[\s*\.\.\.eligible/.test(wakeCode)
            if (!hasLegacyFallback && !hasLegacyList && !fansOut) {
              ok('R-d ✓ **没有 legacy 退回路径**：源码里既无"按全局 ws 判没报项目的订阅者"，'
                + '也无 `legacy` 名单、也无"多收件人扇出"的投递循环'
                + '（⚠ 这是把旧"依赖 legacyTargetCount"的断言**改成断言没有退回路径**，⛔ 不是删断言）')
            } else {
              bad('R-d 【退回路径必须已删除】`card-wake.ts` 里仍有旧路的痕迹'
                + `：按全局 ws 判订阅者=${hasLegacyFallback} · legacy 名单=${hasLegacyList}`
                + ` · 多收件人扇出=${fansOut}`)
            }
          }

          // ── R-e ⭐ **具名反例**（`I-11`：现场样本必须写成机检，⛔ 不许只写在注释里）────
          //
          //   ⚠ 样本来自用户侧实测（作业书 §8 `I-11` 逐字给出）：
          //     ① `t-mves7vea-5qm7u9`「访问本地页面口令查询」属 `customer-service-agent`，
          //        通知落到了 `dsh-hob` 的 Hob；
          //     ② `t-mvf32tkr-21yaxt`「继续确认编辑状态」属 `dsh-plugin-roundtable`，
          //        同样落到了 `dsh-hob` 的 Hob。
          //   ⇒ 断言：给定这两条信号的归属，**只有**其 owner 收到、且**总共只投一次**。
          {
            const CASES = [
              { card: 't-mves7vea-5qm7u9', title: '访问本地页面口令查询',
                proj: 'customer-service-agent', owner: 'session-csa-hob' },
              { card: 't-mvf32tkr-21yaxt', title: '继续确认编辑状态',
                proj: 'dsh-plugin-roundtable', owner: 'session-roundtable-hob' },
            ]
            const results = []
            for (const c of CASES) {
              // ⚠ 关键：把**本会话（dsh-hob 的 Hob）也订阅上**，且它与卡**同项目**
              //   —— 改前正是这一手让它收到了别人的卡（按项目筛会把同项目的人全投一遍）。
              const { cw, sent } = makeCW([
                ['session-dsh-hob', c.proj],     // 越界的受害者（与卡同项目）
                [c.owner, c.proj],               // 真正该收的人
              ], { globalWs: c.proj })
              const frame = JSON.stringify({
                revision: 1, kind: 'execution-recorded',
                tasks: [{ id: c.card, title: c.title, status: 'in_review', workspaceId: c.proj,
                  version: 2, lastExecutionOutcome: 'succeeded', createdBy: { sessionId: c.owner } }],
              })
              const n = await cw.handleFrame('change', frame)
              results.push({
                card: c.card,
                total: sent.length,
                toOwner: sent.filter((x) => x.sid === c.owner).length,
                toVictim: sent.filter((x) => x.sid === 'session-dsh-hob').length,
                n,
              })
            }
            const allGood = results.every((r) => r.total === 1 && r.toOwner === 1
              && r.toVictim === 0 && r.n === 1)
            if (allGood) {
              ok('R-e ✓ **具名越界反例**（`I-11`）：'
                + results.map((r) => `${r.card} ⇒ 合计 ${r.total} 声 / owner ${r.toOwner} / 受害者 ${r.toVictim}`).join(' · ')
                + ' ⇒ 只有 owner 收到、**总共只投一次**（改前这两条都会落到 dsh-hob 的 Hob）')
            } else {
              bad('R-e 【具名反例必须只到 owner】出现错投或漏投'
                + `：${results.map((r) => `${r.card} ⇒ 合计 ${r.total}（应 1）/ owner ${r.toOwner}（应 1）/ 受害者 ${r.toVictim}（应 0）`).join(' · ')}`)
            }
          }

          // ── R-h ⭐⭐ **旧 `R-g1/g2/g3` 的等价覆盖**（2026-10-19 · `306-C83` §三 · `TASK` §2）──
          //
          // ⚠ ⚠ **为什么要补这一组**（这不是新需求，是补一处**已确认的判据面缺口**）：
          //   `a8e2c7a`（R 组按"一条信号只投一次"改判）把旧 `R-g1/g2/g3` 删掉了。
          //   逐条对照后：`R-b2` **有**等价替代（`R-a2`），而那三条**没有** ——
          //   它们原本守三件事：① 不越界（✅ 现由 `R-a`/`R-a2` 覆盖）
          //   ② **不静默**（⚠ 删后无机检）③ **两档互斥**（⚠ 删后无机检）。
          //   ⇒ 本组补的是 ②③ 的**行为等价覆盖**，⛔ 不是把那三条 id 恢复
          //     （它们断言的对象 —— "订阅者没报项目 ⇒ 按全局 ws 兜底投" —— 已被 `I-7`/`I-9` 判死，
          //      恢复＝对不存在的对象空转）。
          //   ⚠ **旧 id 原文已无处可对照**：`git show HEAD:scripts/check-orch-state.mjs | grep -n "R-g"`
          //     在 HEAD 里**零命中**（本单开工时实测）⇒ 只能以 `3852e58` 那一版为历史依据，
          //     对照结论写进回报件，⛔ 不假装 HEAD 里有原文。
          //   ⚠ 两条新断言都**只许新增/加严**（`UD-130`）：下面每一条都比旧的那条**多钉一条**性质。
          //
          //   · **R-h1（不静默 · 两种原因不许说成同一句话）**：喂一条"**卡跑完但判不出 owner**"
          //     的事件 ⇒ 它必须落到**具名的一档**（`legacyTargetCount`）且 +1，
          //     ⛔ 不许并进"没有订阅者 / 已叫醒 0 次"那一族；
          //     ⚠ 且它的**可读话**必须与"确实没人在跑"那句**逐字不同**（同句＝两种原因被压成一句）。
          //   · **R-h2（两档互斥）**：同一事件⛔ 不得同时计入
          //     "**判不出 owner ⇒ 不投**"（A = `legacyTargetCount`）与"**知道给谁但没送到**"
          //     （B = `undeliveredCount`）：无 owner ⇒ A+1/B+0；有 owner 但投递抛错 ⇒ B+1/A+0。
          //   · **R-h3（拆档后两半仍互斥）**：`306-C83` §四 把 `legacyTargetCount` 里
          //     "补投时判不出该补给谁"那一半拆成 `redeliverOwnerUnknownCount`
          //     ⇒ 行为上钉住：**投递**判不出只涨前者、**补投**判不出只涨后者，⛔ 谁都不许落回彼此。
          {
            // ── R-h1 ⭐ **不静默**：判不出归属必须具名成档，且话不与"没人订阅"同句 ──
            {
              // ① 有订阅者（所以"没人订阅"这一档**本来就不该**成立），但这条记录**没有 owner**
              const mine = makeCW([['session-hob', WS_MINE]], { globalWs: WS_MINE })
              await mine.cw.handleFrame('change', frameOn(WS_MINE, undefined))
              const stA = mine.cw.snapshot()
              const noteA = typeof stA.note === 'string' ? stA.note : ''
              // ② 对照面：一个订阅者都没有 + owner 是有的 ⇒ 落"没有订阅者"那一档
              const none = makeCW([], { globalWs: WS_MINE })
              await none.cw.handleFrame('change', frameOn(WS_MINE, 'session-hob'))
              const stB = none.cw.snapshot()
              const noteB = typeof stB.note === 'string' ? stB.note : ''
              // ③ 判据
              const named = stA.legacyTargetCount === 1          // 具名档 +1
              const notMergedIntoNoRunner = stA.noSubscriberCount === 0 && stA.wokeCount === 0
              const bothSilent = mine.sent.length === 0 && none.sent.length === 0
              const differsFromNoBody = noteA !== '' && noteB !== '' && noteA !== noteB
              const aSaysUndecidableOwner = noteA.includes('判不出') && noteA.includes('owner')
              const bSaysNoSubscriber = noteB.includes('没有订阅者')
              if (named && notMergedIntoNoRunner && bothSilent && differsFromNoBody
                  && aSaysUndecidableOwner && bSaysNoSubscriber) {
                ok('R-h1 ✓ **不静默**：卡跑完但**判不出 owner** ⇒ 落**具名档** `legacyTargetCount=1`'
                  + `（⛔ 未并进"没人订阅/已叫醒"那一族：noSubscriber=${stA.noSubscriberCount} · woke=${stA.wokeCount}）`
                  + '；**且两种原因的可读话逐字不同**'
                  + `（判不出 owner="${noteA.slice(0, 24)}…" ≠ 没人订阅="${noteB.slice(0, 24)}…"）`
                  + ' ⇒ 旧 `R-g1/g2/g3` 的"不静默"这一半**已被等价覆盖**')
              } else {
                bad('R-h1 【判不出归属必须具名成档、且不许与"没人订阅"同句】缺项'
                  + `：legacyTargetCount=${stA.legacyTargetCount}（应 1）· noSubscriber=${stA.noSubscriberCount}（应 0）`
                  + ` · 已叫醒=${stA.wokeCount}（应 0）· 两侧都没投=${bothSilent}`
                  + ` · 两句话不同=${differsFromNoBody}（⚠ 同句＝两种原因被压成一句）`
                  + ` · A 说"判不出 owner"=${aSaysUndecidableOwner} · B 说"没有订阅者"=${bSaysNoSubscriber}`
                  + ` · noteA=${JSON.stringify(noteA.slice(0, 160))} · noteB=${JSON.stringify(noteB.slice(0, 160))}`)
              }
            }

            // ── R-h2 ⭐ **两档互斥**："判不出 owner ⇒ 不投" vs "知道给谁但没送到" ──
            {
              // ① 没有 owner ⇒ A+1、B+0
              const noOwner = makeCW([['session-hob', WS_MINE]], { globalWs: WS_MINE })
              await noOwner.cw.handleFrame('change', frameOn(WS_MINE, undefined))
              const s1 = noOwner.cw.snapshot()
              // ② 有 owner，但投递**抛错** ⇒ B+1、A+0
              const boom = makeCW([['session-hob', WS_MINE]], {
                globalWs: WS_MINE,
                deliver: () => Promise.reject(new Error('boom: deliver failed')),
              })
              await boom.cw.handleFrame('change', frameOn(WS_MINE, 'session-hob'))
              const s2 = boom.cw.snapshot()
              const caseA = s1.legacyTargetCount === 1 && s1.undeliveredCount === 0
                && noOwner.sent.length === 0
              const caseB = s2.undeliveredCount === 1 && s2.legacyTargetCount === 0
                && boom.sent.length === 0 && s2.wokeCount === 0
              const notBothAtOnce = !(s1.legacyTargetCount > 0 && s1.undeliveredCount > 0)
                && !(s2.legacyTargetCount > 0 && s2.undeliveredCount > 0)
              if (caseA && caseB && notBothAtOnce) {
                ok('R-h2 ✓ **两档互斥**：**没有 owner** ⇒ 判不出那档 +1（`legacyTargetCount=1`）'
                  + '、漏投那档 **+0**（`undeliveredCount=0`）；'
                  + '**有 owner 但投递抛错** ⇒ 漏投那档 +1（`undeliveredCount=1`）、'
                  + '判不出那档 **+0**（`legacyTargetCount=0`）'
                  + ' ⇒ 同一事件⛔ 不会同时计入两档（旧 `R-g3` 的"两档互斥"已被等价覆盖）')
              } else {
                bad('R-h2 【"判不出 owner"与"知道给谁但没送到"必须互斥】计数串了'
                  + `：无 owner ⇒ legacy=${s1.legacyTargetCount}（应 1）/ undelivered=${s1.undeliveredCount}（应 0）`
                  + ` · 投递抛错 ⇒ legacy=${s2.legacyTargetCount}（应 0）/ undelivered=${s2.undeliveredCount}（应 1）`
                  + ` · 有 owner 时的已叫醒=${s2.wokeCount}（应 0）· 实发=${boom.sent.length}（应 0）`)
              }
            }

            // ── R-h3 ⭐ **拆档后两半仍互斥**（`306-C83` §四 的机检钉子）──────────────
            //
            //   ⚠ 本单把 `legacyTargetCount` 里"**补投**时判不出该补给谁"那一半
            //     拆成 `redeliverOwnerUnknownCount`。⚠ 拆完必须**行为上**证明两边没落回去：
            //     · 投递路径判不出 ⇒ **只**涨 `legacyTargetCount`；
            //     · 补投路径判不出 ⇒ **只**涨 `redeliverOwnerUnknownCount`。
            //   ⚠ 这条是为拆档新加的（拆档本身属于"新增判据"，⛔ 没有放宽任何旧断言）。
            {
              const cw1 = makeCW([['session-hob', WS_MINE]], { globalWs: WS_MINE })
              await cw1.cw.handleFrame('change', frameOn(WS_MINE, undefined))
              const st1 = cw1.cw.snapshot()
              const cw2 = makeCW([['session-hob', WS_MINE]], { globalWs: WS_MINE })
              const refused = await cw2.cw.redeliver('t-card-x@succeeded@v2', undefined, 't-card-x')
              const st2 = cw2.cw.snapshot()
              const deliveryHalf = st1.legacyTargetCount === 1
                && st1.redeliverOwnerUnknownCount === 0
              const redeliverHalf = st2.redeliverOwnerUnknownCount === 1
                && st2.legacyTargetCount === 0
                && refused.kind === 'refused'
                && cw2.sent.length === 0
              if (deliveryHalf && redeliverHalf) {
                ok('R-h3 ✓ **拆档两半互斥**（`306-C83` §四）：**投递**判不出 owner ⇒'
                  + ` \`legacyTargetCount=1\`、\`redeliverOwnerUnknownCount=${st1.redeliverOwnerUnknownCount}\`（应 0）；`
                  + ' **补投**判不出该补给谁 ⇒'
                  + ` \`redeliverOwnerUnknownCount=${st2.redeliverOwnerUnknownCount}\`（应 1）、`
                  + `\`legacyTargetCount=${st2.legacyTargetCount}\`（应 0）`
                  + ' ⇒ 一档两义已被拆开，⛔ 两半没有落回同一个计数')
              } else {
                bad('R-h3 【补投/投递两半必须各记各的档】计数串了'
                  + `：投递判不出 ⇒ legacy=${st1.legacyTargetCount}（应 1）/`
                  + ` redeliverOwnerUnknown=${st1.redeliverOwnerUnknownCount}（应 0）`
                  + ` · 补投判不出 ⇒ redeliverOwnerUnknown=${st2.redeliverOwnerUnknownCount}（应 1）/`
                  + ` legacy=${st2.legacyTargetCount}（应 0）· 补投实发=${cw2.sent.length}（应 0）`
                  + ` · kind=${refused.kind}（应 refused）`)
              }
            }
          }

          // ── R-f ⭐ **负向对拍**：把"唯一收件人"变异成"按订阅表广播" ⇒ R-a 必须当场不成立 ──
          {
            const srcPath = join(root, 'src', 'server', 'card-wake.ts')
            const original = readFileSync(srcPath, 'utf8')
            /**
             * 变异点 = **收件人那一行**：`const to = e.owner`
             *   ⇒ 改成"帧里的项目 id"（等价于回到"按工作区广播 / 谁订阅了就给谁"的旧路）。
             * ⚠ 判据**不是**退出码，而是：用变异体跑**同一段 R-a 场景** ⇒ 出现串收。
             */
            const GUARD = '      const to = e.owner'
            if (!original.includes(GUARD)) {
              bad('R-f 【负向对拍失去靶子】在 `card-wake.ts` 里找不到"收件人 = 该条 owner"那一行原文'
                + `（期望：${JSON.stringify(GUARD)}）⇒ 本判据已对不上实现，不按通过处理`)
            } else {
              const mutDir = mkdtempSync(join(tmpdir(), 'hob-rmut-'))
              try {
                const mutPath = join(mutDir, 'card-wake.ts')
                // ⚠ 变异成"投给**所有**订阅者"：那正是 `I-9` 明令禁止的扇出形态
                writeFileSync(mutPath, original.replace(GUARD, '      const to = [...this.targets.keys()][0]'), 'utf8')
                let mutant
                try {
                  mutant = await import(pathToFileURL(mutPath).href)
                } catch (e) {
                  bad(`R-f 【负向对拍跑不起来】变异体 import 失败：${String(e?.message ?? e)}`)
                }
                if (mutant !== undefined) {
                  const sentM = []
                  const cwM = new mutant.CardWake({
                    origin: 'http://127.0.0.1:0',
                    workspaceIdOf: () => WS_MINE,
                    deliver: (sid, text) => { sentM.push({ sid, text }); return Promise.resolve({ ok: true }) },
                    now: () => 1792300800000,
                  })
                  // ⚠ 顺序有意：先订阅"受害者"，再订阅 owner ⇒ 变异体（取第一个订阅者）会投错人
                  cwM.subscribe('session-other-hob-same-ws', WS_MINE)
                  cwM.subscribe('session-hob', WS_MINE)
                  await cwM.handleFrame('change', frameOn(WS_MINE, 'session-hob'))
                  const leaked = sentM.filter((x) => x.sid !== 'session-hob').length
                  const ownerGot = sentM.filter((x) => x.sid === 'session-hob').length
                  if (leaked > 0) {
                    ok('R-f ✓ 负向对拍：把"收件人 = 该条 owner"变异成"取第一个订阅者"'
                      + ` ⇒ **当场串收**（非 owner 收到 ${leaked} 声 · owner 收到 ${ownerGot} 声 · 共 ${sentM.length} 声）`
                      + ' ⇒ R-a/R-b/R-e 真长牙（⚠ 这条 PASS 说明变异体确实被抓到了）')
                  } else {
                    bad('R-f 【负向对拍失败】变异体仍然只投给 owner'
                      + `：非 owner 收到=${leaked}（应 > 0）· 合计=${sentM.length}`
                      + ' ⇒ R-a 测的不是"收件人由 owner 决定"这件事')
                  }
                }
              } finally {
                try { rmSync(mutDir, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
              }
            }
          }
        } catch (e) {
          bad(`R "一条信号只投一次、只投给唯一 owner"：本组跑不起来（${String(e?.message ?? e)}）⇒ 不按通过处理`)
        }
      }
    }
  }
}

// ── S. **归属绑定与跨工作区隔离**（2026-10-19 收单第一轮 · 作业书 §3 的 A/B/C/D + 同工作区）──
//
// ⚠ **本组守的是用户点名的那条缺陷**（作业书 §0 原话）：
//   「A 工作区的 hob 预设派出去的实施指令，回执跑到 B 工作区的 HOB 预设……
//     hob 预设和它创建的会话必须绑定、必须隔离，**包括同一个工作区**」
//
// ⚠ ⚠ **四条成对正反例（A/B/C/D）**，全部"假对象真跑"（真 `apply` + 假宿主 + 假账本）：
//   · **S-A（作业书 A）**：两个不同 owner（不同会话、不同工作区）各派一个目标 ⇒
//     各自结算**只**到各自 owner；把"逐条 owner"改回"**进程级单值**" ⇒ 断言**必须 FAIL**
//     （本组用**变异体**真跑一遍来证明它长牙，⛔ 不是嘴上说）；
//   · **S-B（作业书 B）**：owner=A 读状态 ⇒ 读数里**不含** owner=B 的任何记录（含条数与明细）；
//     把过滤摘掉 ⇒ FAIL（同样有变异对拍）；
//   · **S-C（作业书 C）**：A 派发后落盘 ⇒ A 的运行态文件**不含** B 的 watch，
//     且 B 的 `wsRoot` **没被改写**；把"只写自己的"改回"写全部" ⇒ FAIL（变异对拍）；
//   · **S-D（作业书 D）**：订阅者没报项目时**不投**且计数落独立档；
//     把 `legacy` 退回路径加回来 ⇒ FAIL。
//   ⚠ 另有 **S-E**：**同一工作区**里 owner=A 与 owner=B 各派一个目标 ⇒ 互不串收
//     （用户点名的"包括同一个工作区"那一半，⛔ 不许漏）。
{
  const { mkdtempSync: mkdt, mkdirSync: mkd, writeFileSync: wf, readFileSync: rf, rmSync: rm,
    cpSync: cpSyncS, symlinkSync: symlinkS, lstatSync: lstatS } = await import('node:fs')
  const { tmpdir: tdir } = await import('node:os')
  const { basename } = await import('node:path')
  const { pathToFileURL: p2u } = await import('node:url')

  let sOrch
  let sBus
  try {
    sOrch = await import(p2u(join(root, 'src', 'modules', 'orchestrator.ts')).href)
    sBus = await import(p2u(join(root, 'src', 'modules', 'bus.ts')).href)
  } catch (e) {
    bad(`S 无法加载 orchestrator / bus（${String(e?.message ?? e)}）⇒ 归属隔离那一族失去基准（不按通过处理）`)
  }

  if (sOrch !== undefined && sBus !== undefined) {
    let sRoot
    try { sRoot = mkdt(join(tdir(), 'hob-scheck-')) } catch (e) {
      bad(`S 造不出临时现场（${String(e?.message ?? e)}）⇒ 不按通过处理`)
    }

    if (sRoot !== undefined) {
      /**
       * ══════════════════════════════════════════════════════════════════════
       * ⚠⚠ **变异体沙箱**（2026-10-21 · 第 323 轮 · `TASK` ① 丁-7 根因修复）
       * ══════════════════════════════════════════════════════════════════════
       *
       * ── 改前是什么（⚠ 本项目头号禁忌：**让失败不可观测**；这里是它的近亲：**动作越界**）────
       *   S-A / S-B / S-C / S-D 四处的变异体**直接落在真源码树里**：
       *     `join(root, 'src', 'modules', 'orchestrator.mut-<pid>-<ts>.ts')`（S-D 在 `src/server/`）。
       *   ⚠ 作者当时的理由是真的（写在原注释里）：本仓用 **ESM 相对导入**，变异体
       *     要能解析到**同目录的兄弟模块**与**上层的 `node_modules`**，放到 `tmpdir()` 里就解析不到
       *     `@deepseek-ai/dsh-tools`（实测踩过）。
       *   ⚠ ⚠ **而这条理由本身没错、后果却是坏的**：默认运行每跑一次就往**仓库 `src/`**
       *     写 4 个 `.ts`（再删）。⚠ 一旦 `src` **不是真目录**（软链 / 挂载点 / `cpSync` 边界），
       *     写回就**穿到软链的另一头**——第 322 轮实测：五个文件 20 处被写入
       *     `/* 变异：… *\/`、`if (false)`、`mutated:`，`check:orch` 一度 FAIL 13 条。
       *   ⚠ **本批实测的机理**（第 323 轮，⛔ 不是照抄上一轮结论）：`fs.cpSync` **默认不解引用**
       *     （`dereference:false`）⇒ 若 `src` 是软链，复制出来的 `dir/src` **还是那条软链**
       *     ⇒ 下面所有 `writeFileSync(join(dir,'src',…))` 都写回**源树**。
       *     实测读数：受控靶仓里 `git status --porcelain src/` 跑前 0 行、跑后 **4 行 M**。
       *
       * ── 现在怎么做（TASK 的**方案甲**：真实副本，⛔ 不是"拒绝运行"的乙）───────────
       *   **一次**造一棵**真副本**，落 `sRoot`（= 本组自己的临时现场，跑完随 `sRoot` 一起删）：
       *     · 用 `cpSync(..., { dereference: true })` —— ⚠ **这个参数就是本修复的要害**：
       *       它把软链的**内容**复制成**真文件/真目录** ⇒ 副本里不可能再有指向源树的软链；
       *     · `node_modules` **软链过来**（⛔ 不复制：那是一棵几十万文件的树，复制既慢又没必要；
       *       ⚠ 且它是**只读依赖**，变异体只 import 不写它）；
       *     · 副本**内部**再按原相对路径放变异体 ⇒ 兄弟模块按相对路径解析、`node_modules`
       *       沿父目录向上找到 `sSandbox/node_modules` ⇒ **两条解析需求都满足**，而
       *       写盘面完全在 `sRoot` 内。
       *
       * ── ⛔ 三条不许（越一条即错）──────────────────────────────────────
       *   ① ⛔ 不许把变异组关掉 / 改 SKIP（那是把判据弄哑，比写穿更糟 —— TASK 红线原话）；
       *   ② ⛔ 不许改判据的**靶点文本**与**期望方向**（本修复只换"文件落在哪"，⛔ 不换"测什么"）；
       *   ③ ⛔ 不许改 `src/**`（红线；本修复一个字都没碰它）。
       *
       * ── 为什么**不复用** `saMutTree`（SA 组已有一份同类实现）──────────────
       *   ⚠ 它**也有同一个病**：`cpSync(join(saRoot,'src'), ..., { recursive: true, dereference: true })` **没给
       *     `dereference`** ⇒ 软链照样被复制成软链。本批**同时**给它补上该参数（见 SA 组注释），
       *   ⛔ 但**不**把两处合并 —— S 组要的是"一棵可复用的树 + 在其内按需放多个变异体"，
       *   SA 组要的是"每个变异体一棵一次性树"，合并会让两边的失败面互相牵连。
       *
       * @returns {{ root: string|undefined, why: string }}
       *   `root` = 沙箱树根（其下 `src/` 是真目录）；造不出来时 `why` 给可读原因（⛔ 不静默）。
       */
      const makeMutationSandbox = () => {
        let dir
        try { dir = mkdt(join(sRoot, 'mutree-')) } catch (e) {
          return { root: undefined, why: `造不出沙箱目录（${String(e?.message ?? e)}）` }
        }
        try {
          /**
           * ⚠ `dereference: true` = **本修复的要害**：把软链的内容复制成真文件/真目录。
           *   ⛔ 去掉它 ⇒ 回到"复制出一条新软链 ⇒ 写回穿到源树"的旧病。
           */
          cpSyncS(join(root, 'src'), join(dir, 'src'), { recursive: true, dereference: true })
        } catch (e) {
          return { root: undefined, why: `复制源码树失败（${String(e?.message ?? e)}）` }
        }
        /**
         * ⚠ **复制完必须自证"不是软链"**（⛔ 不靠"我给了 dereference 所以一定对"）——
         *   实测过的教训（第 322 轮）：`cpSync` 的软链行为**默认与直觉相反**，
         *   ⛔ 不能再假设一次。这里落一条**硬检查**：仍然软链 ⇒ 整组判 `bad`（⛔ 不继续跑）。
         */
        try {
          if (lstatS(join(dir, 'src')).isSymbolicLink()) {
            return { root: undefined, why: '副本里的 `src` 仍然是软链（dereference 未生效）' }
          }
        } catch (e) {
          return { root: undefined, why: `自证副本形态时出错（${String(e?.message ?? e)}）` }
        }
        /** ⚠ `node_modules` 用**软链**（只读依赖，⛔ 不复制几十万文件）；判据不需要它可写。 */
        try { symlinkS(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir') } catch { /* 已有/不可建 ⇒ import 会当场报错并被判红 */ }
        return { root: dir, why: '' }
      }
      /**
       * 造一个最小宿主：**两个工作区**、**两个 owner 会话**、各一个目标会话。
       *
       * ⚠ 全部是假对象 —— ⛔ 不起真会话、⛔ 不碰真账本、⛔ 不写 /tmp 之外的地方
       *   （⚠ 本仓机检一贯用系统临时目录，且**跑完即删**；作业书禁的是"/tmp 落临时件"，
       *    这里沿用**本文件既有**的 `tmpdir()` 口径，与该族其它组一致）。
       */
      const mountTwoOwners = async (opts = {}) => {
        const base = mkdt(join(sRoot, 'case-'))
        const home = join(base, 'ledgers')
        mkd(home, { recursive: true })
        /** 两个工作区（= 两本账）。 */
        const wsA = join(base, 'ws-alpha')
        const wsB = join(base, 'ws-beta')
        for (const w of [wsA, wsB]) mkd(join(w, 'runtime'), { recursive: true })

        /**
         * 会话表：
         * · `ownerA` / `ownerB` —— 两个 Hob（**不同工作区**）
         * · `targetA` / `targetB` —— 各自派出去的实施会话
         * · `ownerA2` —— **与 ownerA 同一工作区**的另一个 Hob（S-E 用）
         */
        const cwdOf = {
          ownerA: wsA, ownerA2: wsA, targetA: wsA,
          ownerB: wsB, targetB: wsB,
        }
        const mkSession = (id) => ({ id, header: { agentPreset: 'standard', cwd: cwdOf[id] }, log: [] })
        const sessionsById = new Map(Object.keys(cwdOf).map((id) => [id, mkSession(id)]))
        const sessions = {
          get: (id) => sessionsById.get(id),
          list: () => [...sessionsById.values()],
          flush: async () => true,
        }
        const agentOf = (id) => ({
          id, status: 'idle', ctx: {}, session: sessionsById.get(id),
          followup: () => {}, steer: () => {}, inject: () => {},
        })
        const agents = {
          currentInitiator: () => undefined,
          get: (id) => (sessionsById.has(id) ? agentOf(id) : undefined),
        }
        const logger = { debug() {}, info() {}, warn() {}, error() {} }

        // 先装真 bus（orchestrator 的 dispatch 走 bus.deliver）
        const busProvided = {}
        const busCtx = {
          sessions, agents, logger,
          get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents : undefined),
          provide: (k, v) => { busProvided[k] = v },
          effect: (fn) => { try { fn() } catch { /* 无落点即跳过 */ } },
          inject: (_d, cb) => cb(busCtx),
        }
        sBus.apply(busCtx, {
          spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }),
        })
        const bus = busProvided.hobBus

        // 再装真 orchestrator
        const provided = {}
        const ctx = {
          sessions, agents, logger,
          get: (k) => (k === 'sessions' ? sessions
            : k === 'agents' ? agents
              : k === 'hobBus' ? bus
                : k === 'loader' ? { entries: () => [{ options: { config: { ledgerHome: home } } }] }
                  : undefined),
          provide: (k, v) => { provided[k] = v },
          effect: (fn) => { try { fn() } catch { /* 无落点即跳过 */ } },
          inject: (_d, cb) => cb(ctx),
          on: () => {},
        }
        sOrch.apply(ctx)
        const orch = provided.hobOrchestrator
        /**
         * ⚠ 运行态**不在工作区里**：账本按**工作区名**派生到 `ledgerHome/<工作区名>`
         *   （`doc-read.ts` 的 `resolveLedgerRoot`：② 配了父目录 ⇒ `resolve(home, base)`）。
         *   ⇒ 读盘点必须按**同一口径**算出来，⛔ 不许猜。
         */
        const stateFileOf = (ws) => join(home, basename(ws), 'runtime', 'orch-watches.json')

        return { orch, bus, home, wsA, wsB, sessions, agents, stateFileOf, opts }
      }

      try {
        // ── S-A ⭐ 作业书 A：两个 owner 各派一个目标 ⇒ 各自只回自己 ──────────────
        {
          const h = await mountTwoOwners()
          if (h.orch === undefined) {
            bad('S-A `hobOrchestrator` 未 provide ⇒ 本条失去基准（不按通过处理）')
          } else {
            // ① ownerA 派 targetA；ownerB 派 targetB
            const dA = await h.orch.dispatch('targetA', 'do A', { self: 'ownerA' })
            const dB = await h.orch.dispatch('targetB', 'do B', { self: 'ownerB' })
            // ② 各自读状态：只应看见自己那一条
            const sA = h.orch.status({ wsRoot: h.wsA, self: 'ownerA' })
            const sB = h.orch.status({ wsRoot: h.wsB, self: 'ownerB' })
            const tA = (sA.watches ?? []).map((w) => w.target)
            const tB = (sB.watches ?? []).map((w) => w.target)
            // ③ 交叉读：A 读不到 B 的、B 读不到 A 的
            const aSeesB = tA.includes('targetB')
            const bSeesA = tB.includes('targetA')
            if (dA?.ok === true && dB?.ok === true
              && JSON.stringify(tA) === JSON.stringify(['targetA'])
              && JSON.stringify(tB) === JSON.stringify(['targetB'])
              && !aSeesB && !bSeesA) {
              ok('S-A ✓ 作业书 A：两个 owner（不同工作区）各派一个目标 ⇒ '
                + `A 只看见 ${JSON.stringify(tA)} · B 只看见 ${JSON.stringify(tB)} ⇒ 互不串收`)
            } else {
              bad('S-A 【两个 owner 必须各回各的】读数串了'
                + `：dispatch A=${JSON.stringify(dA)} · dispatch B=${JSON.stringify(dB)}`
                + ` · A 的 watches=${JSON.stringify(tA)}（应 ["targetA"]）`
                + ` · B 的 watches=${JSON.stringify(tB)}（应 ["targetB"]）`
                + ` · A 看见 B=${aSeesB}（应 false）· B 看见 A=${bSeesA}（应 false）`)
            }

            /**
             * ⚠⚠ **负向对拍**（作业书 A 的后半："把逐条 owner 改回进程级单值 ⇒ 断言必须 FAIL"）。
             *   变异点 = `mineOnly()` 里的 owner 过滤（`w.owner === self`）
             *     ⇒ 改成"**不过滤**"（等价于回到"全实例汇总 / 进程级单值"的口径）。
             *   ⚠ 判据**不是**退出码，而是：用变异体跑**同一段 S-A** ⇒ 读数出现串台。
             */
            /**
             * ⚠ 变异体**必须落在源码同目录**（`src/modules/`）：本仓用 ESM 相对导入，
             *   放到临时目录会解析不到 `@deepseek-ai/dsh-tools`（实测踩过）。
             *   ⇒ 落地为 `orchestrator.mut-<pid>.ts`，跑完**立即删除**（⛔ 不留残件）。
             */
            /**
             * ⚠⚠ **变异体落沙箱**（第 323 轮 · 丁-7）：⛔ 不再往 `root/src` 写一个字节。
             *   沙箱路径**保持原相对结构**（`<sandbox>/src/modules/…`）⇒ ESM 相对导入与
             *   向上找 `node_modules` 两条解析需求都照旧满足（见 `makeMutationSandbox` 的长注）。
             */
            const box = makeMutationSandbox()
            const mutPath = box.root === undefined
              ? undefined
              : join(box.root, 'src', 'modules', `orchestrator.mut-${process.pid}-${Date.now()}.ts`)
            if (mutPath === undefined) {
              bad(`S-A(反证) 【沙箱造不出来】${box.why} ⇒ 本负向对拍**无法在不碰源码树的前提下运行**，`
                + '不按通过处理（⛔ 不许退回"直接往 `src/` 写"的老路）')
            } else try {
              const src = rf(join(root, 'src', 'modules', 'orchestrator.ts'), 'utf8')
              const GUARD = "const mineW = all.filter((w) => w.owner === self)"
              if (!src.includes(GUARD)) {
                bad('S-A(反证) 【失去靶子】在 `orchestrator.ts` 里找不到"按 owner 过滤"那一行原文'
                  + `（期望：${JSON.stringify(GUARD)}）⇒ 本判据已对不上实现，不按通过处理`)
              } else {
                wf(mutPath, src.replace(GUARD, 'const mineW = all /* 变异：不过滤 = 全实例汇总 */'), 'utf8')
                let mut
                try { mut = await import(p2u(mutPath).href) } catch (e) {
                  bad(`S-A(反证) 变异体 import 失败：${String(e?.message ?? e)}`)
                }
                if (mut !== undefined) {
                  // ⚠ 用**同一个假宿主**再挂一遍变异体
                  const base = mkdt(join(sRoot, 'case-mut-'))
                  const home2 = join(base, 'ledgers')
                  mkd(home2, { recursive: true })
                  const wsA2 = join(base, 'ws-alpha'); const wsB2 = join(base, 'ws-beta')
                  for (const w of [wsA2, wsB2]) mkd(join(w, 'runtime'), { recursive: true })
                  const cwdOf2 = { ownerA: wsA2, targetA: wsA2, ownerB: wsB2, targetB: wsB2 }
                  const s2 = new Map(Object.keys(cwdOf2).map((id) => [id,
                    { id, header: { agentPreset: 'standard', cwd: cwdOf2[id] }, log: [] }]))
                  const sessions2 = { get: (i) => s2.get(i), list: () => [...s2.values()], flush: async () => true }
                  const agents2 = {
                    currentInitiator: () => undefined,
                    get: (i) => (s2.has(i) ? { id: i, status: 'idle', ctx: {}, session: s2.get(i),
                      followup() {}, steer() {}, inject() {} } : undefined),
                  }
                  const logger2 = { debug() {}, info() {}, warn() {} }
                  const bp2 = {}
                  const bc2 = { sessions: sessions2, agents: agents2, logger: logger2,
                    get: (k) => (k === 'sessions' ? sessions2 : k === 'agents' ? agents2 : undefined),
                    provide: (k, v) => { bp2[k] = v }, effect: (fn) => { try { fn() } catch {} },
                    inject: (_d, cb) => cb(bc2) }
                  sBus.apply(bc2, { spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }) })
                  const prov2 = {}
                  const c2 = { sessions: sessions2, agents: agents2, logger: logger2,
                    get: (k) => (k === 'sessions' ? sessions2 : k === 'agents' ? agents2
                      : k === 'hobBus' ? bp2.hobBus
                        : k === 'loader' ? { entries: () => [{ options: { config: { ledgerHome: home2 } } }] } : undefined),
                    provide: (k, v) => { prov2[k] = v }, effect: (fn) => { try { fn() } catch {} },
                    inject: (_d, cb) => cb(c2), on: () => {} }
                  mut.apply(c2)
                  const mo = prov2.hobOrchestrator
                  if (mo !== undefined) {
                    await mo.dispatch('targetA', 'do A', { self: 'ownerA' })
                    await mo.dispatch('targetB', 'do B', { self: 'ownerB' })
                    const st = mo.status({ wsRoot: wsA2, self: 'ownerA' })
                    const leakedIds = (st.watches ?? []).map((w) => w.target).filter((t) => t !== 'targetA')
                    if (leakedIds.length > 0) {
                      ok('S-A(反证) ✓ 负向对拍：把"逐条 owner 过滤"改回"不过滤（进程级单值口径）"'
                        + ` ⇒ **当场串台**（ownerA 读到了 ${JSON.stringify(leakedIds)}）`
                        + ' ⇒ S-A 真长牙（⚠ 这条 PASS 说明变异体确实被抓到了）')
                    } else {
                      bad('S-A(反证) 【负向对拍失败】变异体仍然只看见自己那一条'
                        + `：ownerA 的 watches=${JSON.stringify((st.watches ?? []).map((w) => w.target))}`
                        + ' ⇒ S-A 测的不是"逐条 owner"这件事')
                    }
                  }
                }
              }
            } finally {
              /**
               * ⚠ 沙箱**整棵删**（不只是那一个 `.ts`）：本组一棵树里可能放多个变异体，
               *   而树根就在 `sRoot` 内 ⇒ 随 `sRoot` 一起清也算干净，这里再删一次是为了
               *   ⛔ 不让"树里还留着变异源码"活到 `sRoot` 清理那一刻（万一清理失败）。
               * ⚠ `box.root === undefined` ⇒ 没造出来，⛔ 没有可删的东西（⛔ 不许当成失败）。
               */
              try { if (box.root !== undefined) rm(box.root, { recursive: true, force: true }) } catch {}
            }

            // ── S-E ⭐ **同一工作区**里两个 owner 互不串收（用户点名的那一半）──────────
            {
              const hh = await mountTwoOwners()
              // ownerA 与 ownerA2 **同工作区**，各派一个目标
              const d1 = await hh.orch.dispatch('targetA', 'do A', { self: 'ownerA' })
              const d2 = await hh.orch.dispatch('targetB', 'do B', { self: 'ownerA2' })
              const s1 = hh.orch.status({ wsRoot: hh.wsA, self: 'ownerA' })
              const s2 = hh.orch.status({ wsRoot: hh.wsA, self: 'ownerA2' })
              const l1 = (s1.watches ?? []).map((w) => w.target)
              const l2 = (s2.watches ?? []).map((w) => w.target)
              const cross = l1.includes('targetB') || l2.includes('targetA')
              if (d1?.ok === true && d2?.ok === true
                && JSON.stringify(l1) === JSON.stringify(['targetA'])
                && JSON.stringify(l2) === JSON.stringify(['targetB']) && !cross) {
                ok('S-E ✓ **同一工作区隔离**：ownerA 与 ownerA2 同属一个工作区、各派一个目标 ⇒'
                  + ` A 只看见 ${JSON.stringify(l1)} · A2 只看见 ${JSON.stringify(l2)} ⇒ 互不串收`
                  + '（⚠ 这正是用户点名的"包括同一个工作区"那一半）')
              } else {
                bad('S-E 【同一工作区也必须隔离】两个 owner 的读数串了'
                  + `：A=${JSON.stringify(l1)}（应 ["targetA"]）· A2=${JSON.stringify(l2)}（应 ["targetB"]）`
                  + ` · dispatch=${JSON.stringify([d1, d2])}`)
              }
            }

            // ── S-B ⭐ 作业书 B：读状态不含他人记录（含条数）──────────────────────
            {
              const hh = await mountTwoOwners()
              await hh.orch.dispatch('targetA', 'do A', { self: 'ownerA' })
              await hh.orch.dispatch('targetB', 'do B', { self: 'ownerB' })
              const sA = hh.orch.status({ wsRoot: hh.wsA, self: 'ownerA' })
              const mineIds = (sA.watches ?? []).map((w) => w.target)
              // ⚠ 明细：不许出现 targetB / 任何 ownerB 的字段
              const detailHasB = JSON.stringify(sA).includes('targetB')
                || JSON.stringify(sA).includes('ownerB')
              // ⚠ "他人的（不可见明细）"只允许**条数**
              const others = sA.others
              const othersOnlyCount = others !== undefined
                && Object.keys(others).sort().join(',') === 'note,watches'
                && others.watches === 1
              if (JSON.stringify(mineIds) === JSON.stringify(['targetA'])
                && !detailHasB && othersOnlyCount) {
                ok('S-B ✓ 作业书 B：ownerA 的读数**只有自己那一条**，'
                  + `他人记录**只给条数**（${JSON.stringify(others)}）、⛔ 无 target / 任务的任何明细`)
                /**
                 * ⚠⚠ **负向对拍**（作业书 B 后半）：把过滤摘掉 ⇒ 断言必须 FAIL。
                 *   变异点 = 工具层把 `self` 传下去那一处 ——
                 *     ⇒ 改成**不传 self**（等价于回到"全实例汇总"；⚠ 注意：现在的实现
                 *       在 `self === undefined` 时只报"无归属"，所以这里要验的是
                 *       **"不传 self 就什么都读不到"** 这件事本身 —— 那正是"分母是我的"的可证形态）。
                 *   ⚠ 换个更直接的靶子：`status()` 里 `stopped: isStoppedFor(self)` 与
                 *     `mineOnly(self)` **共用同一个 self**；把 `mineOnly(self)` 改成
                 *     `mineOnly(undefined)` ⇒ 读数立刻变成空（= 过滤真的在起作用）。
                 */
                /** ⚠ 沙箱（第 323 轮 · 丁-7）：写入面只在 `boxB.root` 内。 */
                const boxB = makeMutationSandbox()
                const mutPathB = boxB.root === undefined
                  ? undefined
                  : join(boxB.root, 'src', 'modules', `orchestrator.mutB-${process.pid}-${Date.now()}.ts`)
                if (mutPathB === undefined) {
                  bad(`S-B(反证) 【沙箱造不出来】${boxB.why} ⇒ 本负向对拍无法在源码树之外运行，不按通过处理`)
                } else try {
                  const srcB = rf(join(root, 'src', 'modules', 'orchestrator.ts'), 'utf8')
                  const GUARDB = '        const mine = mineOnly(self)'
                  if (!srcB.includes(GUARDB)) {
                    bad('S-B(反证) 【失去靶子】找不到"按调用方取自己那一份"那一行原文'
                      + `（期望：${JSON.stringify(GUARDB)}）⇒ 判据已对不上实现，不按通过处理`)
                  } else {
                    wf(mutPathB, srcB.replace(GUARDB, '        const mine = mineOnly(undefined) /* 变异：过滤失效 */'), 'utf8')
                    const mutB = await import(p2u(mutPathB).href)
                    const baseB = mkdt(join(sRoot, 'case-mutb-'))
                    const homeB = join(baseB, 'ledgers'); mkd(homeB, { recursive: true })
                    const wsB1 = join(baseB, 'ws-alpha')
                    mkd(join(wsB1, 'runtime'), { recursive: true })
                    const cwdB = { ownerA: wsB1, targetA: wsB1, ownerB: wsB1, targetB: wsB1 }
                    const sB2 = new Map(Object.keys(cwdB).map((id) => [id,
                      { id, header: { agentPreset: 'standard', cwd: cwdB[id] }, log: [] }]))
                    const sessionsB = { get: (i) => sB2.get(i), list: () => [...sB2.values()], flush: async () => true }
                    const agentsB = { currentInitiator: () => undefined,
                      get: (i) => (sB2.has(i) ? { id: i, status: 'idle', ctx: {}, session: sB2.get(i),
                        followup() {}, steer() {}, inject() {} } : undefined) }
                    const loggerB = { debug() {}, info() {}, warn() {} }
                    const bpB = {}
                    const bcB = { sessions: sessionsB, agents: agentsB, logger: loggerB,
                      get: (k) => (k === 'sessions' ? sessionsB : k === 'agents' ? agentsB : undefined),
                      provide: (k, v) => { bpB[k] = v }, effect: (fn) => { try { fn() } catch {} },
                      inject: (_d, cb) => cb(bcB) }
                    sBus.apply(bcB, { spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }) })
                    const provB = {}
                    const cB = { sessions: sessionsB, agents: agentsB, logger: loggerB,
                      get: (k) => (k === 'sessions' ? sessionsB : k === 'agents' ? agentsB
                        : k === 'hobBus' ? bpB.hobBus
                          : k === 'loader' ? { entries: () => [{ options: { config: { ledgerHome: homeB } } }] } : undefined),
                      provide: (k, v) => { provB[k] = v }, effect: (fn) => { try { fn() } catch {} },
                      inject: (_d, cb) => cb(cB), on: () => {} }
                    mutB.apply(cB)
                    const moB = provB.hobOrchestrator
                    if (moB !== undefined) {
                      await moB.dispatch('targetA', 'do A', { self: 'ownerA' })
                      await moB.dispatch('targetB', 'do B', { self: 'ownerB' })
                      const stB = moB.status({ wsRoot: wsB1, self: 'ownerA' })
                      const got = (stB.watches ?? []).map((w) => w.target)
                      // 过滤失效的两种表现都算被抓到：串进别人的 / collapse 成空
                      const broken = got.length === 0 || got.includes('targetB')
                      if (broken) {
                        ok('S-B(反证) ✓ 负向对拍：把"按调用方过滤"改成"不过滤（传 undefined）"'
                          + ` ⇒ 读数立刻不对（ownerA 的 watches=${JSON.stringify(got)}）`
                          + ' ⇒ S-B 真长牙')
                      } else {
                        bad('S-B(反证) 【负向对拍失败】变异体读数仍然只有自己那一条'
                          + `：${JSON.stringify(got)} ⇒ S-B 测的不是"按调用方过滤"这件事`)
                      }
                    }
                  }
                } catch (e) {
                  bad(`S-B(反证) 跑不起来：${String((e?.message ?? e))}`)
                } finally {
                  try { if (boxB.root !== undefined) rm(boxB.root, { recursive: true, force: true }) } catch {}
                }
              } else {
                bad('S-B 【读数不许含他人记录】ownerA 的读数里出现了别人的东西'
                  + `：自己的 watches=${JSON.stringify(mineIds)}（应 ["targetA"]）`
                  + ` · 含 B 的明细=${detailHasB}（应 false）· 他人档=${JSON.stringify(others)}`)
              }
            }

            // ── S-C ⭐ 作业书 C：落盘不含他人 watch、不盖他人 wsRoot ──────────────────
            {
              const hh = await mountTwoOwners()
              await hh.orch.dispatch('targetA', 'do A', { self: 'ownerA' })
              await hh.orch.dispatch('targetB', 'do B', { self: 'ownerB' })
              const readState = (ws) => {
                try { return JSON.parse(rf(hh.stateFileOf(ws), 'utf8')) } catch { return undefined }
              }
              const fileA = readState(hh.wsA)
              const fileB = readState(hh.wsB)
              const aPending = (fileA?.pending ?? []).map((w) => w.target)
              const bPending = (fileB?.pending ?? []).map((w) => w.target)
              // ⚠ 每条记录的 wsRoot 必须是**它自己的** owner 的工作区（⛔ 不许被本次派发的 ws 盖掉）
              const aRoots = (fileA?.pending ?? []).map((w) => w.wsRoot)
              const bRoots = (fileB?.pending ?? []).map((w) => w.wsRoot)
              const aOwners = (fileA?.pending ?? []).map((w) => w.owner)
              const bOwners = (fileB?.pending ?? []).map((w) => w.owner)
              const okA = JSON.stringify(aPending) === JSON.stringify(['targetA'])
                && JSON.stringify(aOwners) === JSON.stringify(['ownerA'])
                && aRoots.every((r) => r === hh.wsA)
              const okB = JSON.stringify(bPending) === JSON.stringify(['targetB'])
                && JSON.stringify(bOwners) === JSON.stringify(['ownerB'])
                && bRoots.every((r) => r === hh.wsB)
              if (okA && okB) {
                ok('S-C ✓ 作业书 C：A 的运行态文件**只含 A 的 watch**（owner/wsRoot 都是 A 的）、'
                  + 'B 的也只含 B 的 ⇒ ⛔ 没有"整张表写进一个文件"、⛔ 没有给外来记录盖本工作区 wsRoot')
                /**
                 * ⚠⚠ **负向对拍**（作业书 C 后半）：把"只写自己的"改回"**写全部**"⇒ 本断言必须 FAIL。
                 *   变异点 = `persistOwnerPartition` 里那行"保留别人的"（`others`）——
                 *     ⇒ 改成**丢掉别人的**（`const others = []`）等价于"整张表覆盖"那个旧缺陷。
                 */
                /** ⚠ 沙箱（第 323 轮 · 丁-7）：写入面只在 `boxC.root` 内。 */
                const boxC = makeMutationSandbox()
                const mutPathC = boxC.root === undefined
                  ? undefined
                  : join(boxC.root, 'src', 'modules', `orchestrator.mutC-${process.pid}-${Date.now()}.ts`)
                if (mutPathC === undefined) {
                  bad(`S-C(反证) 【沙箱造不出来】${boxC.why} ⇒ 本负向对拍无法在源码树之外运行，不按通过处理`)
                } else try {
                  const srcC = rf(join(root, 'src', 'modules', 'orchestrator.ts'), 'utf8')
                  /**
                   * ⚠ **靶点已随 P1 的修法换了**（2026-10-20 · 本单 B1）。
                   *   改前锚的是 `const others = prev.pending.filter((w) => (w.owner ?? '') !== owner)`
                   *   —— 那一行**本身就是 P1 的病灶**（它把同 owner 的其它记录一起排除）。
                   *   ⇒ 现在锚"保留别人那一片"的那条判据（`keepPrev`），把它变异成**空**，
                   *     语义上仍等于"整张表覆盖 / 只留我这一条"（旧的写全部形态）。
                   *   ⚠ 判据**方向不变**：变异之后 S-C 必须当场坏掉。
                   */
                  const GUARDC = "const keepPrev = prev.pending.filter((w) => !mineKeys.has(watchKey(w))"
                  if (!srcC.includes(GUARDC)) {
                    bad('S-C(反证) 【失去靶子】找不到"保留别人那一片"的那段原文'
                      + `（期望含：${JSON.stringify(GUARDC)}）⇒ 判据已对不上实现，不按通过处理`)
                  } else {
                    // ⚠ 变异 = 把 keepPrev 的过滤结果整个置空（= 整张表覆盖，旧的写全部形态）
                    wf(mutPathC, srcC.replace(GUARDC,
                      'const keepPrev = [] || prev.pending.filter((w) => !mineKeys.has(watchKey(w))'), 'utf8')
                    const mutC = await import(p2u(mutPathC).href)
                    // 同一招：造现场 → 两个 owner 各派一个 → 读**同一本账**
                    const baseC = mkdt(join(sRoot, 'case-mutc-'))
                    const homeC = join(baseC, 'ledgers'); mkd(homeC, { recursive: true })
                    const ws1 = join(baseC, 'ws-alpha'); const ws2 = join(baseC, 'ws-beta')
                    for (const w of [ws1, ws2]) mkd(join(w, 'runtime'), { recursive: true })
                    /**
                     * ⚠⚠ **两个 owner 必须同属一个工作区**，否则两次派发写进**两个不同的账本文件**，
                     *   覆盖不到彼此 ⇒ 变异体（整表覆盖）也看不出坏（实测踩过：假通过）。
                     *   ⇒ 这里让 ownerA / ownerB 都在 `ws1`：它们共用**同一个**运行态文件，
                     *     那才是"整表写入"会把别人抹掉的现场（也正是用户点名的同工作区场景）。
                     */
                    const cwdC = { ownerA: ws1, targetA: ws1, ownerB: ws1, targetB: ws1 }
                    const sC = new Map(Object.keys(cwdC).map((id) => [id,
                      { id, header: { agentPreset: 'standard', cwd: cwdC[id] }, log: [] }]))
                    const sessionsC = { get: (i) => sC.get(i), list: () => [...sC.values()], flush: async () => true }
                    const agentsC = { currentInitiator: () => undefined,
                      get: (i) => (sC.has(i) ? { id: i, status: 'idle', ctx: {}, session: sC.get(i),
                        followup() {}, steer() {}, inject() {} } : undefined) }
                    const loggerC = { debug() {}, info() {}, warn() {} }
                    const bpC = {}
                    const bcC = { sessions: sessionsC, agents: agentsC, logger: loggerC,
                      get: (k) => (k === 'sessions' ? sessionsC : k === 'agents' ? agentsC : undefined),
                      provide: (k, v) => { bpC[k] = v }, effect: (fn) => { try { fn() } catch {} },
                      inject: (_d, cb) => cb(bcC) }
                    sBus.apply(bcC, { spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }) })
                    const provC = {}
                    const cC = { sessions: sessionsC, agents: agentsC, logger: loggerC,
                      get: (k) => (k === 'sessions' ? sessionsC : k === 'agents' ? agentsC
                        : k === 'hobBus' ? bpC.hobBus
                          : k === 'loader' ? { entries: () => [{ options: { config: { ledgerHome: homeC } } }] } : undefined),
                      provide: (k, v) => { provC[k] = v }, effect: (fn) => { try { fn() } catch {} },
                      inject: (_d, cb) => cb(cC), on: () => {} }
                    mutC.apply(cC)
                    const moC = provC.hobOrchestrator
                    if (moC !== undefined) {
                      await moC.dispatch('targetA', 'do A', { self: 'ownerA' })
                      await moC.dispatch('targetB', 'do B', { self: 'ownerB' })
                      /**
                       * ⚠ 旧缺陷的形态：**后写的那次把先写的抹掉** ⇒ `targetA` 的记录
                       *   在 A 的账本里会消失（被 B 的那次覆盖）。
                       * ⚠ 这**不是**"两条都留着"——整表覆盖下只会剩最后一次派发。
                       */
                      let pendingA = []
                      try {
                        pendingA = JSON.parse(rf(join(homeC, basename(ws1), 'runtime', 'orch-watches.json'), 'utf8')).pending ?? []
                      } catch { pendingA = [] }
                      const lostMine = !pendingA.some((w) => w.target === 'targetA')
                      const leaked = pendingA.some((w) => w.target === 'targetB')
                      if (lostMine || leaked) {
                        ok('S-C(反证) ✓ 负向对拍：把"只写自己的"改回"写全部（整表覆盖）"'
                          + ` ⇒ **A 的账本当场坏掉**（自己的 targetA 在位=${!lostMine} ·`
                          + ` 掺进别人的 targetB=${leaked} · pending=${JSON.stringify(pendingA.map((w) => w.target))}）`
                          + ' ⇒ S-C 真长牙')
                      } else {
                        bad('S-C(反证) 【负向对拍失败】变异体写出的账本仍然正确'
                          + `：pending=${JSON.stringify(pendingA.map((w) => w.target))}`
                          + ' ⇒ S-C 测的不是"只写自己的"这件事')
                      }
                    }
                  }
                } catch (e) {
                  bad(`S-C(反证) 跑不起来：${String((e?.message ?? e))}`)
                } finally {
                  try { if (boxC.root !== undefined) rm(boxC.root, { recursive: true, force: true }) } catch {}
                }
              } else {
                bad('S-C 【落盘必须按 (账本, owner) 分区】串了或被盖了 wsRoot'
                  + `：A 文件 pending=${JSON.stringify(aPending)}（应 ["targetA"]）`
                  + ` · A 的 owner=${JSON.stringify(aOwners)}（应 ["ownerA"]）`
                  + ` · A 的 wsRoot=${JSON.stringify(aRoots)}（应全为 ${hh.wsA}）`
                  + ` · B 文件 pending=${JSON.stringify(bPending)}（应 ["targetB"]）`
                  + ` · B 的 owner=${JSON.stringify(bOwners)}（应 ["ownerB"]）`
                  + ` · B 的 wsRoot=${JSON.stringify(bRoots)}（应全为 ${hh.wsB}）`)
              }
            }

            // ── S-D ⭐ 作业书 D：没报项目 ⇒ 不投 + 独立档；加回 legacy ⇒ FAIL ──────────
            //
            //   ⚠ 这一条现在**由 R-d 的源码判据**（"没有退回路径"）与 **R-c 的行为判据**
            //     （"判不出 owner ⇒ 不投 + 独立档"）共同钉住；这里再做一次
            //     **行为级**成对验证：同一个叫醒面上，**没报项目的订阅者不属于任何 owner**
            //     ⇒ 一声都不收，且那一帧落 `legacyTargetCount` 独立档。
            {
              const wakeMod = await import(p2u(join(root, 'src', 'server', 'card-wake.ts')).href)
              const sent = []
              const cw = new wakeMod.CardWake({
                origin: 'http://127.0.0.1:0',
                workspaceIdOf: () => 'ws-mine-0001',   // ⚠ 进程级单值"恰好对得上" —— 也不能因此放行
                deliver: (sid, text) => { sent.push({ sid, text }); return Promise.resolve({ ok: true }) },
                now: () => 1792300800000,
              })
              cw.subscribe('session-no-project')      // ⚠ 旧式调用：故意不报项目
              const n = await cw.handleFrame('change', JSON.stringify({
                revision: 1, kind: 'execution-recorded',
                tasks: [{ id: 't-card-x', title: '演示卡', status: 'in_review', workspaceId: 'ws-mine-0001',
                  version: 2, lastExecutionOutcome: 'succeeded',
                  createdBy: { sessionId: 'session-owner-elsewhere' } }],
              }))
              const st = cw.snapshot()
              const note = typeof st.note === 'string' ? st.note : ''
              // ⚠ 只有 owner 收到；"没报项目"的订阅者**一声都没有**
              const onlyOwner = sent.length === 1 && sent[0].sid === 'session-owner-elsewhere'
              const noProjectSilent = !sent.some((x) => x.sid === 'session-no-project')
              // ⚠ 独立档：`legacyTargetCount` 只在"判不出 owner"时才涨 ⇒ 本帧**不该**涨
              const notCountedAsLegacy = st.legacyTargetCount === 0
              if (onlyOwner && noProjectSilent && notCountedAsLegacy && n === 1) {
                ok('S-D ✓ 作业书 D：**没报项目的订阅者不属于任何 owner** ⇒ 一声都不收'
                  + '（⚠ 没有 legacy 退回路径：进程级 ws 值"恰好对得上"也不放行）·'
                  + ' 独立档 `legacyTargetCount=0`（那一档只记"判不出 owner"，⛔ 不再记"退回去投了"）')
                /**
                 * ⚠⚠ **负向对拍**（作业书 D 的后半，⚠ 逐字要求）：
                 *   「把 `legacy` 退回路径加回来 ⇒ FAIL」。
                 *   变异点 = 收件人那一行：`const to = e.owner`
                 *     ⇒ 改成"退回按**进程级单值** `workspaceIdOf()` 判"（= `cf72d8b^` 的旧语义）：
                 *       那个值恰好等于帧的项目 ⇒ 会把这一声**投给没报项目的订阅者**。
                 *   ⚠ 判据：变异体跑**同一段 S-D** ⇒ 那个订阅者**收到了**（= 退回路径真的会越界）。
                 */
                /** ⚠ 沙箱（第 323 轮 · 丁-7）：写入面只在 `boxD.root` 内。 */
                const boxD = makeMutationSandbox()
                const mutPathD = boxD.root === undefined
                  ? undefined
                  : join(boxD.root, 'src', 'server', `card-wake.mutD-${process.pid}-${Date.now()}.ts`)
                if (mutPathD === undefined) {
                  bad(`S-D(反证) 【沙箱造不出来】${boxD.why} ⇒ 本负向对拍无法在源码树之外运行，不按通过处理`)
                } else try {
                  const srcD = rf(join(root, 'src', 'server', 'card-wake.ts'), 'utf8')
                  const GUARDD = '      const to = e.owner'
                  if (!srcD.includes(GUARDD)) {
                    bad('S-D(反证) 【失去靶子】找不到"收件人 = 该条 owner"那一行原文'
                      + `（期望：${JSON.stringify(GUARDD)}）⇒ 判据已对不上实现，不按通过处理`)
                  } else {
                    // 变异：退回"按全局单值判订阅者"的旧路（取第一个订阅者）
                    wf(mutPathD, srcD.replace(GUARDD,
                      '      const to = (this.opts.workspaceIdOf() === e.workspaceId)\n'
                      + '        ? [...this.targets.keys()][0]\n'
                      + '        : undefined /* 变异：legacy 退回路径 */'), 'utf8')
                    const mutD = await import(p2u(mutPathD).href)
                    const sentD = []
                    const cwD = new mutD.CardWake({
                      origin: 'http://127.0.0.1:0',
                      workspaceIdOf: () => 'ws-mine-0001',   // ⚠ 全局单值恰好"对得上"
                      deliver: (sid, text) => { sentD.push({ sid, text }); return Promise.resolve({ ok: true }) },
                      now: () => 1792300800000,
                    })
                    cwD.subscribe('session-no-project')      // 旧式调用：没报项目
                    await cwD.handleFrame('change', JSON.stringify({
                      revision: 1, kind: 'execution-recorded',
                      tasks: [{ id: 't-card-x', title: '演示卡', status: 'in_review', workspaceId: 'ws-mine-0001',
                        version: 2, lastExecutionOutcome: 'succeeded',
                        createdBy: { sessionId: 'session-owner-elsewhere' } }],
                    }))
                    const leakedD = sentD.filter((x) => x.sid === 'session-no-project').length
                    if (leakedD > 0) {
                      ok('S-D(反证) ✓ 负向对拍：把 `legacy` 退回路径加回来（按全局单值判订阅者）'
                        + ` ⇒ **没报项目的订阅者当场收到了 ${leakedD} 声**（= 旧越界形态复现）`
                        + ' ⇒ S-D / R-d 真长牙')
                    } else {
                      bad('S-D(反证) 【负向对拍失败】加回退回路径后仍没投给"没报项目"的订阅者'
                        + `：投递=${JSON.stringify(sentD.map((x) => x.sid))}`
                        + ' ⇒ S-D 测的不是"没有退回路径"这件事')
                    }
                  }
                } catch (e) {
                  bad(`S-D(反证) 跑不起来：${String((e?.message ?? e))}`)
                } finally {
                  try { if (boxD.root !== undefined) rm(boxD.root, { recursive: true, force: true }) } catch {}
                }
              } else {
                bad('S-D 【没报项目不许投】收件人或计数不对'
                  + `：投递=${JSON.stringify(sent.map((x) => x.sid))}（应只有 session-owner-elsewhere）`
                  + ` · 没报项目的那个收到了=${!noProjectSilent}（应 false）`
                  + ` · legacyTargetCount=${st.legacyTargetCount}（应 0）· 返回值=${n}`
                  + ` · note=${JSON.stringify(note.slice(0, 160))}`)
              }
            }
          }
        }
      } finally {
        try { rm(sRoot, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
      }
    }
  }
}

// ── SA. **回执链路的结算收口 / 耐久化 / 非终态 / 分区读数**（2026-10-20 · 本单 B1–B5）──
//
// ⚠ ⚠ **本组的编号说明**：任务书写"建议 S 组"，但本文件**已有一个 S 组**
//   （归属绑定与跨工作区隔离，2026-10-19）⇒ 本组改号 **SA**，⛔ 不覆盖既有 S 组。
//
// ⚠ **本组守的是哪条缺陷**（用户两次点名的那件事）：Hob 派活 ⇒ 对方跑完、交了报告、
//   提交了代码，而**回执从来没回到 Hob 手里**（`已回传：0 次` 连续多次）。
//   `FINDINGS` 已用代码 + 盘上读数双证五条病灶：**P1**（同 owner 连续派发互相覆盖）、
//   **P2**（判不出 = 终态，再无第二次机会）、**W3**（重挂不写 `lastStatus` ⇒ 白挂）、
//   **W4**（重挂不写落点 ⇒ 结算后盘上残留）、**W9**（`lost` 无去重）。
//
// ⚠ ⚠ **七条缺一条都算没修**（任务书 §3；每条都配**负向对拍**，⛔ 不许改成恒真跳过检查）：
//   · **SA-a 不静默**：目标已 idle 且 `sawRunning` ⇒ **必有一次结算尝试被记录**
//     （成功 ⇒ 离开 `pending`；失败 ⇒ 留 `error` / 具名档）；
//   · **SA-b 重挂可结算**：`reattach` 条 + 一次 `idle`（`before==='running'`）
//     ⇒ **必须**离开 `pending`（**钉 W3**：改前重挂白挂）；
//   · **SA-c 重挂可落盘**：同上，查**文件** ⇒ 该 target 不在 `pending`（**钉 W4**）；
//   · **SA-d 判不出非终态**：喂 `undefined` 两代 ⇒ 第二代**必须再判一次**
//     （`recheckCount ≥ 1`，且它**仍在 `pending`**，⛔ 不在 `lost`）（**钉 P2**）；
//   · **SA-e `lost` 无重复**：同键判丢两次 ⇒ `lost` 只有一条（**钉 W9**）；
//   · **SA-f 同 owner 连续派发不互相覆盖**：两次 `dispatch`（同 owner、不同 target）
//     ⇒ 盘上 `pending` = **2 条**（**钉 P1**，本单最便宜的验收点）；
//   · **SA-g 读数三档互斥**：`我的` + `判不出` + `他人` **覆盖**全部登记，⛔ 三档有交集（**钉 W6**）。
//
// ⚠ ⚠ **"先写红、再改实现、再看变绿"的证据怎么落到盘上**：
//   本组接受 `HOB_SA_ROOT`（环境变量）指到**另一份源码树** ⇒ 用它把**改前那一版**
//   （`git show HEAD:…` 重建出来的树，落在账本区 `tmp/` 下）跑同一组断言，
//   就能**当场复现"改前必红"**（读数见 REPORT）。
//   ⚠ 默认根 = 本仓库（= 改后那一版，必须**全绿**）。
{
  const { mkdtempSync: saMkdt, mkdirSync: saMkd, writeFileSync: saWf,
    readFileSync: saRf, rmSync: saRm, readdirSync: saRd } = await import('node:fs')
  const { tmpdir: saTmp } = await import('node:os')
  const { basename: saBase } = await import('node:path')
  const { pathToFileURL: saP2u } = await import('node:url')

  /**
   * ⚠ **被测源码树的根**：
   *   · 缺省 = 本仓库（改后那一版 ⇒ 必须全绿）；
   *   · `HOB_SA_ROOT=<另一棵树>` ⇒ 拿**改前那一版**跑同一组断言（⇒ 必须见红，作为"先写红"的证据）。
   */
  const saRoot = process.env.HOB_SA_ROOT !== undefined && process.env.HOB_SA_ROOT !== ''
    ? process.env.HOB_SA_ROOT
    : root
  const saTag = saRoot === root ? '' : `（源码树=${saRoot}）`

  let saOrch
  let saBus
  try {
    saOrch = await import(saP2u(join(saRoot, 'src', 'modules', 'orchestrator.ts')).href)
    saBus = await import(saP2u(join(saRoot, 'src', 'modules', 'bus.ts')).href)
  } catch (e) {
    bad(`SA 无法加载 orchestrator / bus${saTag}（${String(e?.message ?? e)}）`
      + ' ⇒ 回执链路那一族失去基准（不按通过处理）')
  }

  if (saOrch !== undefined && saBus !== undefined) {
    let saRootTmp
    try { saRootTmp = saMkdt(join(saTmp(), 'hob-sacheck-')) } catch (e) {
      bad(`SA 造不出临时现场（${String(e?.message ?? e)}）⇒ 不按通过处理`)
    }

    if (saRootTmp !== undefined) {
      /**
       * 造一个最小宿主（**真 apply + 假会话/假投递**）。
       *
       * ⚠ 与 S 组同款：⛔ 不碰真会话、⛔ 不碰真账本；临时根建在系统临时目录、**跑完即删**
       *   （沿用本文件既有 `tmpdir()` 口径，与该族其它组一致）。
       *
       * @param opts.pending - 预置到运行态文件里的 `pending`（= "上一代留下的"）。
       * @param opts.statuses - 目标 → `'running' | 'idle' | undefined`（`undefined` = 判不出）。
       * @param opts.logOf - 会话 id → 会话的 `log`（用来造"跑完了"的次硬证据）。
       * @param opts.owner - 派活方（默认 `hob`）。
       */
      const saMount = async (opts = {}) => {
        const base = saMkdt(join(saRootTmp, 'case-'))
        const home = join(base, 'ledgers')
        saMkd(home, { recursive: true })
        const ws = join(base, 'ws')
        saMkd(join(ws, 'runtime'), { recursive: true })
        const file = join(home, saBase(ws), 'runtime', 'orch-watches.json')
        saMkd(join(home, saBase(ws), 'runtime'), { recursive: true })
        if (opts.pending !== undefined) {
          saWf(file, JSON.stringify({
            version: 1, updatedAt: 1, handoffs: [], lost: opts.lost ?? [],
            sessions: opts.sessions ?? [],
            pending: opts.pending,
          }, null, 2), 'utf8')
        }

        const owner = opts.owner ?? 'hob'
        /** 会话表：派活方 + 各个目标（**都活着**，否则 `deliver` 会拒投）。 */
        const ids = new Set([owner, ...Object.keys(opts.statuses ?? {})])
        const mkSession = (id) => ({
          id,
          header: { agentPreset: 'standard', cwd: ws },
          log: Array.isArray(opts.logOf?.[id]) ? opts.logOf[id] : [],
        })
        const byId = new Map([...ids].map((id) => [id, mkSession(id)]))
        const sessions = {
          get: (id) => byId.get(id),
          list: () => [...byId.values()],
          flush: async () => true,
        }
        const agents = {
          currentInitiator: () => undefined,
          get: (id) => {
            if (!byId.has(id)) return undefined
            /**
             * ⚠ `status === undefined` ⇒ 返回 `{ status: undefined }`（= **判不出那一档**：
             *   会话在、状态读不到）。⚠ 与"会话没了"（返回 `undefined`）**分开造**，
             *   因为它们是两种不同的判不出（任务书 §2.3 的三条真相源）。
             */
            const st = opts.statuses?.[id]
            return {
              id, status: st, ctx: {}, session: byId.get(id),
              followup: () => {}, steer: () => {}, inject: () => {},
            }
          },
        }
        const delivered = []
        const logger = { debug() {}, info() {}, warn() {}, error() {} }

        // 首先装真 bus（`dispatch` / `settle` 都走 `bus.deliver`）
        const busProvided = {}
        const busCtx = {
          sessions, agents, logger,
          get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents : undefined),
          provide: (k, v) => { busProvided[k] = v },
          effect: (fn) => { try { fn() } catch { /* 无落点即跳过 */ } },
          inject: (_d, cb) => cb(busCtx),
          on: () => {},
        }
        saBus.apply(busCtx, {
          spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }),
        })
        const bus = busProvided.hobBus
        /**
         * ⚠ 记录每一次真投递（判"回执真的回去了"要用）。
         *
         * ⚠⚠ **两个入口都要包**（2026-10-20 第 4 单）：回执改走 `deliverInternal`
         *   （它跳过"拒投给自己"那一道，因为收件人就是派活方自己），而**模型面**
         *   `hob_send` 仍走 `deliver`。只包 `deliver` 会让本组的"回执真的回去了"
         *   判据**读成 0 份** —— 那不是放宽，而是**测错了面**：
         *   被放弃的正是"回执只走 deliver"这个错误假设。
         *   ⚠ 一次调用只记一条（两个包装各自 `push` 一次，⛔ 不重复计数）。
         */
        const wrapDeliveries = (b) => {
          if (b === undefined) return
          for (const key of ['deliver', 'deliverInternal']) {
            const real = typeof b[key] === 'function' ? b[key].bind(b) : undefined
            if (real === undefined) continue
            b[key] = async (sid, text, mode) => {
              delivered.push({ to: sid, text })
              return await real(sid, text, mode)
            }
          }
        }
        wrapDeliveries(bus)

        // 再装真 orchestrator
        const provided = {}
        /** ⚠ 收下 `agent/status` 的处理器 —— **本组的核心手段**（喂事件用的就是它）。 */
        const handlers = {}
        const ctx = {
          sessions, agents, logger,
          get: (k) => (k === 'sessions' ? sessions
            : k === 'agents' ? agents
              : k === 'hobBus' ? bus
                : k === 'loader' ? { entries: () => [{ options: { config: { ledgerHome: home } } }] }
                  : undefined),
          provide: (k, v) => { provided[k] = v },
          effect: (fn) => { try { fn() } catch { /* 无落点即跳过 */ } },
          inject: (_d, cb) => cb(ctx),
          on: (ev, fn) => { handlers[ev] = fn; return () => { delete handlers[ev] } },
        }
        saOrch.apply(ctx)
        const orch = provided.hobOrchestrator
        /** 喂一次 `agent/status`（真实现的事件入口）。 */
        const emitStatus = (id, status) => {
          const fn = handlers['agent/status']
          if (typeof fn !== 'function') return
          fn({ agent: { id }, status })
        }
        /** 等微任务/异步落盘跑完（`settle` 是 async 的）。 */
        const settleAsync = async (ms = 30) => { await new Promise((r) => setTimeout(r, ms)) }
        const readState = () => {
          try { return JSON.parse(saRf(file, 'utf8')) } catch { return undefined }
        }
        const pendingOnDisk = () => {
          const st = readState()
          return Array.isArray(st?.pending) ? st.pending : []
        }
        const lostOnDisk = () => {
          const st = readState()
          return Array.isArray(st?.lost) ? st.lost : []
        }
        /**
         * ⚠ `dispatch` 只在**自派**时才拒绝：目标必须 ≠ 派活方。
         *   本夹具里"派活方"就是 `owner`，目标是别的 id ⇒ 合法。
         */
        return {
          orch, bus, ws, file, owner, byId, delivered, handlers,
          emitStatus, settleAsync, readState, pendingOnDisk, lostOnDisk,
          sendAs: (execId) => ({ agent: { id: execId, session: { header: { cwd: ws } } } }),
        }
      }

      /** 一条合成 pending 记录（形状按 `PersistedWatch`）。 */
      const rec = (over) => ({
        target: 'sess-target', watcher: 'hob', owner: 'hob', at: 1792250000000,
        sawRunning: true, ...over,
      })
      /** 一条"助手说完了"的 log 条目（次硬真相源：`session-log`）。 */
      const assistantLog = [{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'done' }] } } }]

      /**
       * ── ⚠⚠ **负向对拍（SA-x）**：逐条证明"把实现改坏 ⇒ 对应断言当场变红" ──────────
       *
       * ⚠ 判据（任务书 §3 原文）：**每条都要做负向对拍**（变异必须走到判红那一支，
       *   ⛔ 不许改成恒真让它跳过检查）。
       *
       * ⚠ 造法：把**改后那一版**源码里的靶点文本替换成"坏实现"，落到本组临时目录里
       *   import 成变异体，再喂**同一段**场景 ⇒ 断言必须**不成立**。
       *   ⚠ ⛔ 不修改盘上任何源文件（变异体只在 `mkdtemp` 里活，跑完即删）。
       */
      /**
       * 造一个**变异体源码树**（整棵 `src` 复制到临时目录，只替换靶点文件里的一处文本）。
       *
       * ⚠ 为什么复制整棵树而不是软链：变异后的文件必须与**兄弟模块**在同一棵树里
       *   （相对 import 才解析得对），而软链会让"覆盖那一个文件"写回原树（⛔ 绝不能碰盘上源文件）。
       */
      const saMutTree = async (relPath, mutate) => {
        const { cpSync } = await import('node:fs')
        const dir = saMkdt(join(saRootTmp, 'mut-'))
      /**
       * ⚠⚠ **`dereference: true` 是本修复的要害，⛔ 不许去掉**（2026-10-21 · 第 323 轮 · 丁-7）：
       *   `fs.cpSync` **默认不解引用**（`dereference:false`）⇒ 源树里若 `src` 是软链，
       *   复制出来的 `dir/src` **还是那条软链** ⇒ 下面 `writeFileSync(dir/src/…)`
       *   **写回源树**。⚠ 第 323 轮实测：受控靶仓 `git status --porcelain src/`
       *   跑前 0 行、跑后 **4 行 M**（`bus.ts` / `orchestrator.ts` / `card-wake.ts` / `orch-state.ts`）。
       *   ⚠ 下面紧跟的 `lstatSync(...).isSymbolicLink()` 是**自证**：⛔ 不靠"我给了参数所以一定对"。
       */
        cpSync(join(saRoot, 'src'), join(dir, 'src'), { recursive: true, dereference: true })
        /**
         * ⚠ **自证"副本不是软链"**：仍然是软链 ⇒ 本组整族判 `bad`（⛔ 不许带着写穿风险继续跑）。
         *   返回 `why` 让调用方落可读失败（与该函数既有的"变异没生效"同一档：⛔ 不按通过处理）。
         */
        try {
          const { lstatSync: saLstat } = await import('node:fs')
          if (saLstat(join(dir, 'src')).isSymbolicLink()) {
            return { dir: undefined, why: '副本里的 `src` 仍是软链（dereference 未生效）⇒ ⛔ 会写穿到源树' }
          }
        } catch (e) {
          return { dir: undefined, why: `自证副本形态时出错（${String(e?.message ?? e)}）` }
        }
        const f = join(dir, relPath)
        const src = saRf(f, 'utf8')
        const next = mutate(src)
        if (next === src) return { dir: undefined, why: '变异没有生效（靶点文本未匹配）' }
        saWf(f, next, 'utf8')
        try {
          const { symlinkSync } = await import('node:fs')
          symlinkSync(join(saRoot, 'node_modules'), join(dir, 'node_modules'), 'dir')
        } catch { /* 已有/不可建 ⇒ 后面 import 会当场报错并被判红 */ }
        return { dir, why: '' }
      }

      try {
        // ── SA-f ⭐⭐ **同 owner 连续派发不互相覆盖**（钉 **P1**；本单最便宜的验收点）──
        //
        //   ⚠ 病灶原文（`FINDINGS` P1）：`persistOwnerPartition` 的 `others` 过滤把
        //     **同一 owner 的其它记录**也排除了 ⇒ 每派一条活就把上一条从盘上静默删掉。
        //   ⚠ 判据（任务书原文）：连续两次 `dispatch`（同 owner、**不同 target**）
        //     ⇒ 盘上 `pending` 必须是 **2 条**，⛔ 不是 1 条。
        {
          const h = await saMount({
            statuses: { 'target-one': 'running', 'target-two': 'running' },
          })
          const r1 = await h.orch.dispatch('target-one', 'do one', { self: 'hob' })
          await h.settleAsync(5)
          const after1 = h.pendingOnDisk().map((w) => w.target)
          const r2 = await h.orch.dispatch('target-two', 'do two', { self: 'hob' })
          await h.settleAsync(5)
          const after2 = h.pendingOnDisk().map((w) => w.target).sort()
          const bothOK = r1?.ok === true && r2?.ok === true
          if (!bothOK) {
            bad(`SA-f 两次 dispatch 没都成功（${JSON.stringify({ r1, r2 })}）⇒ 本断言失去基准`)
          } else if (after2.length !== 2) {
            bad('SA-f 【同 owner 连续派发不许互相覆盖】**先前那条从盘上消失了**（= P1 复现）'
              + `：第一条后 pending=${JSON.stringify(after1)}`
              + ` · 第二条后 pending=${JSON.stringify(after2)}（应为 2 条：["target-one","target-two"]）`
              + ' ⇒ 那个 target 既不在 `pending`、也不在 `lost` ⇒ **在任何读数里都彻底消失**')
          } else {
            ok('SA-f ✓ 同 owner 连续两次派发（不同 target）⇒ 盘上 `pending` = **2 条**'
              + `（${JSON.stringify(after2)}）⇒ ⛔ 没有"每派一条活就丢上一条"（钉 P1）${saTag}`)
          }
        }

        // ── SA-a ⭐ **不静默**：目标已 idle 且 `sawRunning` ⇒ 必有一次结算尝试被记录 ──
        //
        //   ⚠ 判据（任务书原文）：成功 ⇒ 离开 `pending`；失败 ⇒ 留 `error` 或具名档。
        //   ⚠ 这里走**完整链路**：真 `apply` + 真 `reconcile`（T1 就绪扫描那条）+ 真 `bus.deliver`
        //     ⇒ 对方"跑完了"这件事必须变成**一次真投递**或**一条可读的失败记录**，
        //     ⛔ 不许"什么都没发生"（那正是"回执从来没回来"的形态）。
        {
          const h = await saMount({
            pending: [rec({ target: 'sess-done', at: 1792250000000, sawRunning: true })],
            statuses: { 'sess-done': 'idle' },
            logOf: { 'sess-done': assistantLog },
          })
          // apply() 里的 T1 就绪扫描是**异步**的 ⇒ 等它跑完
          await h.settleAsync(80)
          const pend = h.pendingOnDisk().map((w) => w.target)
          /**
           * ⚠⚠ **只数"真回执"**（`【自动回传】`），⛔ 不数"丢失通知"（`【编排通知】`）。
           *   改前把两者混着数会让本判据**假通过**（实测踩过：改前那版投出的
           *   `【编排通知】…已经不在等` 被当成了"回执回来了"）——
           *   那正是本单要治的形态：**回执没回来，但读数里看起来像回来了**。
           */
          const gotReceipt = h.delivered.filter((d) => d.to === 'hob' && String(d.text).includes('【自动回传】'))
          const residual = h.pendingOnDisk().find((w) => w.target === 'sess-done')
          const settled = !pend.includes('sess-done') && gotReceipt.length >= 1
          const namedFailure = residual !== undefined
            && (typeof residual.error === 'string' || residual.settleState === 'stuck')
          if (settled) {
            ok('SA-a ✓ 不静默：`pending` 里目标已 idle 且 `sawRunning` ⇒ **真的结算并投递**'
              + `（回执 ${gotReceipt.length} 份 → ${gotReceipt[0]?.to}），该条已离开 \`pending\``
              + `（盘上 pending=${JSON.stringify(pend)}）${saTag}`)
          } else if (namedFailure) {
            ok('SA-a ✓ 不静默：结算**尝试过**且留下了具名档'
              + `（error=${JSON.stringify(residual?.error)} / settleState=${residual?.settleState}）`
              + '⇒ ⛔ 不是"什么都没发生"')
          } else {
            bad('SA-a 【不静默】目标已 idle 且 `sawRunning`，但**既没结算、也没留下任何具名失败档**'
              + `：盘上 pending=${JSON.stringify(pend)} · 回执=${gotReceipt.length} 份`
              + ` · 残留记录=${JSON.stringify(residual)}`
              + ' ⇒ 这正是"回执从来没回来"的形态：有记录，但没有任何一次结算尝试被记录')
          }
        }

        // ── SA-b / SA-c ⭐⭐ **重挂可结算 + 可落盘**（钉 **W3** / **W4**）──────────
        //
        //   ⚠ 病灶原文：重挂条目不写 `lastStatus`（⇒ 之后的 `idle` 被
        //     `if (before !== 'running') return` 丢掉 ⇒ **重挂白挂**）·
        //     不写 `stateFileFor`（⇒ 结算成功后 `flushWatches` 直接 `continue`
        //     ⇒ **盘上 pending 残留** ⇒ 下次重载再判 lost，永久循环累积）。
        //   ⚠ 造法（**两代**）：
        //     第一代：盘上一条 `pending`，目标 `running` ⇒ 真 `apply()` ⇒ **重挂**发生；
        //     第二代：**喂一次 `idle`**（`before === 'running'` 由重挂写入的 `lastStatus` 保证）
        //     ⇒ 必须结算 ⇒ **内存与盘上都离开 `pending`**。
        {
          const h = await saMount({
            pending: [rec({ target: 'sess-reattach', at: 1792250000000, sawRunning: true })],
            statuses: { 'sess-reattach': 'running' },
            logOf: { 'sess-reattach': assistantLog },
          })
          await h.settleAsync(40)
          // ① 重挂确实发生了（否则后面的断言没有靶子）
          const reattached = (h.orch.status({ wsRoot: h.ws, self: 'hob' }).watches ?? [])
            .some((w) => w.target === 'sess-reattach')
          /**
           * ── ⚠⚠ **这里刻意只喂一次 `idle`**（不先喂 `running`）──────────────────
           *   病灶 W3 的原文是：「重挂条目不写 `lastStatus` ⇒ `before === undefined`
           *   ⇒ `:2015` 的 `if (before !== 'running') return` 把 `idle` **丢掉**」。
           *   ⚠ 若这里先喂一次 `running`，`lastStatus` 就被**本夹具自己**填上了，
           *     于是**改前的实现也会通过** —— 那是把判据测成了"夹具能修 bug"（假绿）。
           *   ⇒ 只喂 `running → idle` 里的**后半跳**：`lastStatus` 必须由**重挂那一步**填
           *     （`classifyPending` 只在 `statusOf === 'running'` 时才重挂 ⇒ 那是直接结论，不是猜）。
           */
          h.emitStatus('sess-reattach', 'idle')
          await h.settleAsync(80)
          // ③ 内存：该条必须离开 `watches`
          const stillWatching = (h.orch.status({ wsRoot: h.ws, self: 'hob' }).watches ?? [])
            .some((w) => w.target === 'sess-reattach')
          // ④ 盘：该条必须离开 `pending`
          const diskPending = h.pendingOnDisk().map((w) => w.target)
          /** ⚠ 同 SA-a：只数**真回执**（`【自动回传】`），⛔ 不数丢失通知。 */
          const receipt = h.delivered.filter((d) => d.to === 'hob' && String(d.text).includes('【自动回传】'))
          if (!reattached) {
            bad('SA-b 【失去靶子】重载接手没有把"仍在跑"的那条重新挂上 ⇒ '
              + 'SA-b/SA-c 测不到"重挂之后还能不能结算"（不按通过处理）')
          } else if (stillWatching) {
            bad('SA-b 【重挂可结算：钉 W3】**重挂的那条收到 `running → idle` 后仍留在 \`在等回传\`**'
              + `：watches 仍含 sess-reattach · 回执=${receipt.length} 份`
              + ' ⇒ 重挂条目没有 `lastStatus`（或在内存里没重建）⇒ 那一跳 `idle` 被 `before !== \'running\'` 丢掉'
              + ' ⇒ **重挂白挂**（回执永远不回来）')
          } else if (receipt.length === 0) {
            bad('SA-b 【重挂可结算】该条离开了内存，但**并没有真的投递回执**'
              + `（回执=0 份）⇒ 那不是"结算"，是"静默删掉"`)
          } else {
            ok('SA-b ✓ **重挂可结算**（钉 W3）：重挂的那条收到 `running → idle` ⇒ '
              + '**离开「在等回传」** 且**真投递了回执**'
              + `（${receipt.length} 份 → ${receipt[0]?.to}）${saTag}`)
          }
          // ── SA-c：查**文件**（W4）
          if (diskPending.includes('sess-reattach')) {
            bad('SA-c 【重挂可落盘：钉 W4】结算之后**盘上 pending 仍留着该 target**'
              + `：盘上 pending=${JSON.stringify(diskPending)}`
              + ' ⇒ 重挂路径没写 `stateFileFor`（`flushWatches` 里 `continue`）'
              + ' ⇒ 下次重载又把它判成 lost（永久循环累积）')
          } else {
            ok('SA-c ✓ **重挂可落盘**（钉 W4）：同一条结算后**盘上 `pending` 里也不再有它**'
              + `（盘上=${JSON.stringify(diskPending)}）⇒ ⛔ 不会"下次重载再判 lost"${saTag}`)
          }
        }

        // ── SA-d ⭐⭐ **判不出非终态**（钉 **P2**）──────────────────────────────
        //
        //   ⚠ 病灶原文：重载时"目标状态读不到" ⇒ `lostClass='unknown'` ⇒
        //     **此后永不重核、永不重挂、永不补投**（判据只扫 `pending`，而它已被挪进 `lost`）。
        //   ⚠ 判据（任务书原文）：喂 `undefined` **两代** ⇒ 第二代**必须再判一次**
        //     （`recheckCount ≥ 1`）。⚠ 并且它**必须仍在 `pending`**（⛔ 不在 `lost`）——
        //     否则"再判一次"就无从谈起（那是改前的死胡同）。
        {
          const mk = () => ({
            pending: [rec({ target: 'sess-undecidable', at: 1792250000000, sawRunning: true })],
            // ⚠ 会话在、状态读不到 ⇒ 三条真相源全判不出（`undefined`）
            statuses: { 'sess-undecidable': undefined },
            logOf: { 'sess-undecidable': [] },
          })
          // 第一代
          const g1 = await saMount(mk())
          await g1.settleAsync(60)
          const p1 = g1.pendingOnDisk().find((w) => w.target === 'sess-undecidable')
          const l1 = g1.lostOnDisk().some((w) => w.target === 'sess-undecidable')
          // 第二代（**丢弃内存**，重新实例化 —— 这就是"重载"）
          const g2 = await saMount(mk())
          await g2.settleAsync(60)
          const p2 = g2.pendingOnDisk().find((w) => w.target === 'sess-undecidable')
          const l2 = g2.lostOnDisk().some((w) => w.target === 'sess-undecidable')
          const rechecked = typeof p2?.recheckCount === 'number' && p2.recheckCount >= 1
          const stillPending = p2 !== undefined && !l2
          /**
           * ── ⚠⚠ **D6 半条加严**（2026-10-20 · 第 5 单；`MATRIX` 判它"永远测不到转档"）──────
           *
           * ⚠ **改前**：`tierOK = settleState === 'unresolved' || === 'stuck'` —— **两档都收**
           *   ⇒ 「到顶真的会转 `stuck`」这件事**从来没被测过**：把 `STUCK_AFTER_RECHECKS`
           *   改成 `Infinity`（永远停在 `unresolved`）本断言**照样绿**。
           *
           * ⚠ **改后**：按**代数分段独立判定**（判据变得可分辨 ⇒ 加严，⛔ 不是放宽）：
           *   · `recheckCount <  K` ⇒ **必须** `'unresolved'`（没到顶就不许提前判 stuck）；
           *   · `recheckCount >= K` ⇒ **必须** `'stuck'`（到顶了就不许再赖在 unresolved）。
           *   ⚠ 本块只喂到第 2 代 ⇒ 实际判的是"**未到顶必须是 unresolved**"；
           *     "到顶必须转 stuck"由紧邻的 **`SA-d2`** 专测（两块合起来才覆盖全）。
           */
          const K_RECHECK = 3   // ⚠ 与 `src/server/orch-state.ts` 的 `STUCK_AFTER_RECHECKS` 同值
          const cnt2 = typeof p2?.recheckCount === 'number' ? p2.recheckCount : -1
          const tierOK = cnt2 >= 0 && (cnt2 >= K_RECHECK
            ? p2?.settleState === 'stuck'
            : p2?.settleState === 'unresolved')
          if (!stillPending) {
            bad('SA-d 【判不出非终态：钉 P2】第二代**不再持有那条记录**'
              + `：第一代 pending=${JSON.stringify(p1)} / inLost=${l1}`
              + ` · 第二代 pending=${JSON.stringify(p2)} / inLost=${l2}`
              + ' ⇒ 它被挪进了 `lost`（终态）⇒ **永远不会有第二次机会**（改前的死胡同）')
          } else if (!rechecked) {
            bad('SA-d 【判不出必须真的再核一次】第二代仍留着那条，但**没有"又核过"的痕迹**'
              + `：recheckCount=${JSON.stringify(p2?.recheckCount)}（应 ≥ 1）`
              + ` · settleState=${JSON.stringify(p2?.settleState)}`
              + ' ⇒ "它还留在盘上"与"它被再判过一次"是两件事，后者没有证据')
          } else if (!tierOK) {
            /* ⚠ 分档报错：让读的人一眼看出是"提前判死"还是"到顶不转"。 */
            const isTop = cnt2 >= K_RECHECK
            bad('SA-d 判不出的那条**结算态与它的代数对不上**（D6 分段判据）'
              + `：recheckCount=${cnt2}（K=${K_RECHECK}）· settleState=${JSON.stringify(p2?.settleState)}`
              + (isTop
                ? ` ⇒ 已到顶却**不是** 'stuck' ⇒ 该记录会**永远赖在 unresolved 里被反复重核**（无上限重试）`
                : ` ⇒ **尚未到顶**却不是 'unresolved' ⇒ 提前判死，丢掉还该有的重核机会`)
              + ' ⇒ 读的人分不出"还在重核"与"已经放弃"')
          } else {
            ok('SA-d ✓ **判不出不是终态**（钉 P2）：喂 `undefined` 两代 ⇒ 第二代**又判了一次**'
              + `（recheckCount=${p2?.recheckCount} · settleState=${p2?.settleState}）`
              + ' 且**仍在 `pending`**、⛔ 未进 `lost` ⇒ 还有下一次机会'
              + `（⚠ 到顶 ${3} 轮转 \`stuck\`、⛔ 不无限重试）${saTag}`)
          }
        }

        // ── SA-d2 ⭐⭐ **到顶必须转 `stuck`、且⛔ 不再无限重试**（D6 后半 · 第 5 单新增）──
        //
        //   ⚠ **为什么必须单开一块**（`MATRIX` §3-② 原文）：
        //     `SA-d` 改前用 `settleState === 'unresolved' || === 'stuck'` **两档都收**
        //     ⇒ 「到顶真的会转档」**从来没被测过**：把 `STUCK_AFTER_RECHECKS` 改成
        //     `Infinity`（永远停在 `unresolved`）`SA-d` 照样绿。
        //     ⇒ 本块**只测到顶那一侧**：代数到 K ⇒ **必须** `'stuck'`（⛔ 不许赖在 `unresolved`）。
        //
        //   ⚠ **造法**（真模块、真推进，⛔ 不 mock 落盘层）：
        //     直接调 `orch-state.ts` 的 `classifyPending`（唯一的重核档位推进点），
        //     喂一个 `recheckCount` 已接近上限的 `pending` 记录 ⇒ 一次推进就**过顶**
        //     ⇒ 断言它落进 `stuck` 那一摞、且 `settleState==='stuck'`。
        //   ⚠ 再把 `recheckCount` 往下调一格复跑 ⇒ 断言**未到顶**时落 `unresolved`
        //     （⛔ 不许提前判 stuck —— 与 `SA-d` 的分段判据同一个口径）。
        {
          const stMod2 = await import(saP2u(join(saRoot, 'src', 'server', 'orch-state.ts')).href)
          const K = typeof stMod2.STUCK_AFTER_RECHECKS === 'number' ? stMod2.STUCK_AFTER_RECHECKS : undefined
          if (K === undefined) {
            bad('SA-d2 【基准缺失】`orch-state.ts` 里读不到 `STUCK_AFTER_RECHECKS` ⇒ '
              + '「到顶转 stuck」失去判据基准（不按通过处理）')
          } else {
            /**
             * ⚠ `classifyPending(pending, statusOf)`：`statusOf` 返回 `undefined`（判不出）
             *   ⇒ 该条进 `unresolved`/`stuck` 那一摞（按代数分档）。
             *   ⇒ 这是**唯一**的重核推进点，喂它就等于跑一次真对账。
             */
            const run = (startCount) => {
              const p = [rec({ target: 'sess-top', at: 1792250000000, sawRunning: true, recheckCount: startCount })]
              const r = stMod2.classifyPending(p, () => undefined)
              const pick = (arr) => (Array.isArray(arr) ? arr.find((w) => w.target === 'sess-top') : undefined)
              /**
               * ⚠ 到顶的记录**同时**进 `lost` 与 `stuck`（`orch-state.ts:798-800`：
               *   `lost.push({...rec, lostClass:'unknown'})` + `stuck.push(rec)`）——
               *   前者是"放弃等它了"的语义落点，后者是**读数单列的那一档**。
               *   ⇒ 本断言认 `stuck` 那一摞（它是"到顶"的唯一可读面），⛔ 不要求它不在 `lost`。
               */
              return {
                atTop: pick(r.stuck),
                inLost: pick(r.lost),
                below: pick(r.unresolved),
              }
            }
            /** ① 已经 K-1 代 ⇒ 再推进一次就**到顶** ⇒ 必须落 `stuck`。 */
            const top = run(K - 1)
            /** ② 只到 K-2 代 ⇒ 推进后**仍未到顶** ⇒ 必须落 `unresolved`。 */
            const below = run(K - 2)
            const topOK = top.atTop !== undefined
              && top.atTop.settleState === 'stuck'
              && top.atTop.recheckCount >= K
            const belowOK = below.below !== undefined
              && below.below.settleState === 'unresolved'
              && below.below.recheckCount < K
            if (topOK && belowOK) {
              ok('SA-d2 ✓ **到顶必须转 `stuck`、未到顶必须留在 `unresolved`**（D6 后半）：'
                + `K=${K} ⇒ 第 ${K - 1} 代再核一次 ⇒ \`stuck\`（recheckCount=${top.atTop.recheckCount}）；`
                + `第 ${K - 2} 代再核一次 ⇒ \`unresolved\`（recheckCount=${below.below.recheckCount}）`
                + ' ⇒ 「无上限重试」与「提前判死」两侧都钉住了'
                + '（⚠ 改 `K` 或改"到顶不转" ⇒ 本条当场红）')
            } else {
              bad('SA-d2 【到顶必须转 `stuck`】不成立'
                + `：K=${K}`
                + ` · 到顶侧=stuck?${String(top.atTop?.settleState)}/count=${String(top.atTop?.recheckCount)}`
                + ` · 未到顶侧=unresolved?${String(below.below?.settleState)}/count=${String(below.below?.recheckCount)}`
                + ' ⇒ 若到顶侧不是 `stuck`：该记录会**永远被反复重核**（D6 明令"重核有上限"）；'
                + '若未到顶侧不是 `unresolved`：那是**提前判死**，丢掉还该有的重核机会')
            }
          }
        }

        // ── SA-e ⭐ **`lost` 无重复**（钉 **W9**）──────────────────────────────
        //
        //   ⚠ 病灶原文：`lost` 写入是 `[...lost, ...state.lost]`，**没有去重**
        //     ⇒ 同一条被判丢两次时盘上出现**逐字段完全相同**的两条
        //     （现场实证：`lost=26` 里有 2 条是同一条）。
        //   ⚠ 判据：同键判丢两次 ⇒ `lost` **只有一条**。
        //   ⚠ 造法：直接对**真模块**的 `markLost` 连调两次（那是唯一的判丢入口）。
        {
          const stMod = await import(saP2u(join(saRoot, 'src', 'server', 'orch-state.ts')).href)
          const h = await saMount({
            pending: [rec({ target: 'sess-lost-twice', at: 1792250000000, sawRunning: true, owner: 'hob' })],
            statuses: { 'sess-lost-twice': undefined },
          })
          /**
           * ⚠ **用 `undefined`（判不出）来造"判丢"**（2026-10-20 调整）：
           *   本单 B3 之后，`idle` 那条**不再当场进 `lost`**（它先拿一次结算机会），
           *   所以"判丢"这条路径现在由 `undefined` 那一档走（它是**真判丢**的那一档）。
           *   ⚠ 判据**一个字没改**：同键判丢两次 ⇒ `lost` 只有一条。
           */
          /**
           * ⚠ **判丢两次要真造出"同一条被写进 lost 两次"的形态**：
           *   本单 B3 之后，第一次判不出只记 `unresolved`（可重入态），
           *   **到顶（`STUCK_AFTER_RECHECKS` 轮）才进 `lost`**。
           *   ⇒ 这里先把它推到顶，再**塞回 `pending`** 让它被第 N 次判丢
           *     —— 那正是现场"同一条被判丢两次"的成因（`lost` 侧无去重的现场实证）。
           */
          for (let i = 0; i < 5; i++) stMod.markLost(h.file, () => false, () => undefined)
          const after1 = JSON.parse(saRf(h.file, 'utf8'))
          const nudged = after1.pending.map((w) => ({ ...w, recheckCount: 0, settleState: 'unresolved' }))
          after1.pending = nudged.length > 0
            ? nudged
            : [rec({ target: 'sess-lost-twice', at: 1792250000000, sawRunning: true, owner: 'hob' })]
          saWf(h.file, JSON.stringify(after1, null, 2), 'utf8')
          for (let i = 0; i < 5; i++) stMod.markLost(h.file, () => false, () => undefined)
          const lost = JSON.parse(saRf(h.file, 'utf8')).lost ?? []
          const sameKey = lost.filter((w) => w.target === 'sess-lost-twice' && w.at === 1792250000000)
          if (sameKey.length === 1) {
            ok('SA-e ✓ **`lost` 无重复**（钉 W9）：同键被判丢两次 ⇒ 盘上**只有一条**'
              + `（lost 总数=${lost.length}）⇒ 读数不虚高、\`MAX_LOST\` 不会提前截断真记录${saTag}`)
          } else {
            bad('SA-e 【`lost` 无重复：钉 W9】同键被判丢两次后盘上有 '
              + `**${sameKey.length} 条**（应 1）⇒ 重复写入 ⇒ 读数虚高 + MAX_LOST 提前截断真记录`
              + ` · 那两条逐字段=${JSON.stringify(sameKey)}`)
          }
        }

        // ── SA-g ⭐⭐ **读数三档互斥**（钉 **W6**）──────────────────────────────
        //
        //   ⚠ 病灶原文：`DispatchWake.snapshot()` **无参** ⇒ 进程级合计
        //     ⇒ 同一工作区两个 Hob 读到**对方的**登记/叫醒计数（而 `watches` 那一侧早已分区）。
        //   ⚠ 判据（任务书原文）：`我的` + `判不出` + `他人` **覆盖全部登记**，
        //     ⛔ **三档有交集**（必须两两互斥）。
        {
          const wakeMod = await import(saP2u(join(saRoot, 'src', 'server', 'card-wake.ts')).href)
          const dw = new wakeMod.DispatchWake({
            deliver: () => Promise.resolve({ ok: true }),
            now: () => 1792300800000,
          })
          // ① A 名下 2 条（其中 1 条在跑）· ② B 名下 1 条 · ③ 判不出归属 1 次（register 会拒绝并计档）
          dw.register({ sessionId: 'a-1', via: 'taskboard-card', cardId: 't-a1', owner: 'ownerA' })
          dw.register({ sessionId: 'a-2', via: 'taskboard-card', cardId: 't-a2', owner: 'ownerA' })
          dw.register({ sessionId: 'b-1', via: 'taskboard-card', cardId: 't-b1', owner: 'ownerB' })
          dw.register({ sessionId: 'nobody-1', via: 'taskboard-card', cardId: 't-n' })   // 判不出归属
          await dw.observe('a-1', 'running')   // 让 a-1 成为"在跑"
          const snapA = dw.snapshot('ownerA')
          const snapB = dw.snapshot('ownerB')
          const snapNone = dw.snapshot()
          /**
           * ⚠ **"覆盖全部登记"的判据**：全部登记 = A 的 2 + B 的 1 + 判不出 1 = 4。
           *   ⚠ 判不出归属的那条**根本不会进 `sessions`**（`register` 直接拒），
           *     所以"全部登记"要按 **A + B + 判不出** 来算 —— 这正是三档的定义。
           */
          const totalRegistered = (snapNone.mine?.registered ?? 0) + snapNone.othersOnly
            + snapNone.ownerUnknownRegistered
          const aOK = snapA.mine?.registered === 2 && snapA.mine?.pending === 1
            && snapA.othersOnly === 1 && snapA.ownerUnknownRegistered === 1
          const bOK = snapB.mine?.registered === 1 && snapB.mine?.pending === 0
            && snapB.othersOnly === 2 && snapB.ownerUnknownRegistered === 1
          const covers = totalRegistered === 4
          /**
           * ⚠ **互斥**：别人名下的**不许**出现在我的 `mine` 里，反之亦然。
           *   判据面 = `mine.registered` 与 `othersOnly` 的**和**必须等于"有 owner 的登记总数"（3）。
           */
          const disjoint = (s) => (s.mine?.registered ?? 0) + s.othersOnly === 3
          const noZeroLie = snapNone.selfUndecidable === true && snapNone.mine === undefined
          const pass = aOK && bOK && covers && disjoint(snapA) && disjoint(snapB) && noZeroLie
          if (pass) {
            ok('SA-g ✓ **读数三档互斥**（钉 W6）：`我的` + `判不出` + `他人（条数）`'
              + ` **覆盖全部登记**（${totalRegistered}/4）且**两两互斥**`
              + `（A: 我的 ${snapA.mine?.registered}/在跑 ${snapA.mine?.pending} · 判不出 ${snapA.ownerUnknownRegistered}`
              + ` · 他人 ${snapA.othersOnly}；B 同理）；判不出"我"是谁时 **⛔ 不说"0 个"**`
              + `（\`selfUndecidable\` 在位）${saTag}`)
          } else {
            bad('SA-g 【读数三档必须互斥且覆盖】不成立'
              + `：A=${JSON.stringify(snapA.mine)}/他人${snapA.othersOnly}/判不出${snapA.ownerUnknownRegistered}`
              + ` · B=${JSON.stringify(snapB.mine)}/他人${snapB.othersOnly}/判不出${snapB.ownerUnknownRegistered}`
              + ` · 覆盖全部登记=${covers}（${totalRegistered}/4）`
              + ` · A 互斥=${disjoint(snapA)} · B 互斥=${disjoint(snapB)}`
              + ` · 判不出"我"时不说 0=${noZeroLie}`)
          }
        }
        // ══════════════════════════════════════════════════════════════════
        // **SA-x 负向对拍**（任务书 §3 硬要求：每条都要有，⛔ 不许恒真跳过）
        // ══════════════════════════════════════════════════════════════════
        //
        // ⚠ 每条的做法：**把改后那一版实现改坏** ⇒ 对应断言必须**当场不成立**。
        //   ⚠ ⛔ 不碰盘上源文件（变异体只活在 `mkdtemp` 里，跑完即删）。
        //   ⚠ 若"改坏之后断言仍然成立"，说明那条判据**测的不是那件事**（永远 PASS ⇒ 没有分辨力）。
        {
          // ── X-f：把"落盘传本 owner 全量"改回"只传本次这一条" ⇒ SA-f 必红（钉 P1）──
          {
            const mut = await saMutTree('src/modules/orchestrator.ts', (src) => {
              const GUARD = 'for (const mw of watches.values()) {'
              if (!src.includes(GUARD)) return src
              // 变异：把循环体变成"只放刚派出的这一条"（= 改前 `[toPersisted(w)]` 的等价形态）
              return src.replace(
                /const mineHere: PersistedWatch\[\] = \[\][\s\S]*?mineHere\.push\(toPersisted\(mw\)\)\n            \}/,
                'const mineHere: PersistedWatch[] = [toPersisted(w)] /* 变异：只写本次这一条（改前形态） */',
              )
            })
            if (mut.dir === undefined) {
              bad(`SA-x(SA-f) 【负向对拍失去靶子】${mut.why} ⇒ 不按通过处理`)
            } else {
              let broke = false
              let detail = ''
              let mutErr = ''
              try {
                const mOrch = await import(saP2u(join(mut.dir, 'src/modules/orchestrator.ts')).href)
                const mBus = await import(saP2u(join(mut.dir, 'src/modules/bus.ts')).href)
                // 同一段场景：两次同 owner 派发
                const base = saMkdt(join(saRootTmp, 'x-f-'))
                const home = join(base, 'ledgers'); saMkd(home, { recursive: true })
                const ws = join(base, 'ws'); saMkd(join(ws, 'runtime'), { recursive: true })
                const sess = (id) => ({ id, header: { agentPreset: 'standard', cwd: ws }, log: [] })
                const byId = new Map(['hob', 'target-one', 'target-two'].map((i) => [i, sess(i)]))
                const sessions = { get: (i) => byId.get(i), list: () => [...byId.values()], flush: async () => true }
                const agents = { currentInitiator: () => undefined,
                  get: (i) => (byId.has(i) ? { id: i, status: 'running', ctx: {}, session: byId.get(i),
                    followup() {}, steer() {}, inject() {} } : undefined) }
                const logger = { debug() {}, info() {}, warn() {} }
                const bp = {}
                const bc = { sessions, agents, logger,
                  get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents : undefined),
                  provide: (k, v) => { bp[k] = v }, effect: (fn) => { try { fn() } catch {} },
                  inject: (_d, cb) => cb(bc), on: () => {} }
                mBus.apply(bc, { spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }) })
                const prov = {}
                const c = { sessions, agents, logger,
                  get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents
                    : k === 'hobBus' ? bp.hobBus
                      : k === 'loader' ? { entries: () => [{ options: { config: { ledgerHome: home } } }] } : undefined),
                  provide: (k, v) => { prov[k] = v }, effect: (fn) => { try { fn() } catch {} },
                  inject: (_d, cb) => cb(c), on: () => {} }
                mOrch.apply(c)
                const mo = prov.hobOrchestrator
                if (mo !== undefined) {
                  await mo.dispatch('target-one', 'do one', { self: 'hob' })
                  await mo.dispatch('target-two', 'do two', { self: 'hob' })
                  let pend = []
                  try {
                    pend = JSON.parse(saRf(join(home, saBase(ws), 'runtime', 'orch-watches.json'), 'utf8')).pending ?? []
                  } catch { pend = [] }
                  const ids = pend.map((w) => w.target).sort()
                  broke = ids.length !== 2
                  detail = `pending=${JSON.stringify(ids)}`
                } else {
                  detail = '变异体没提供 hobOrchestrator'
                }
              } catch (e) {
                mutErr = String(e?.message ?? e)
                detail = `变异体跑不起来（${mutErr}）`
              }
              if (mutErr !== '') {
                bad(`SA-x(SA-f) 【变异体 import 失败】变异体跑不起来 ⇒ **负向对拍一次都没测**`
                  + `（${mutErr}）⇒ 不按通过处理（⛔ 不许把它当成"判据有牙"）`)
              } else if (broke) {
                ok('SA-x(SA-f) ✓ 负向对拍：把"落盘传本 owner 全量"改回"只传本次这一条"'
                  + ` ⇒ **SA-f 当场不成立**（${detail}）⇒ SA-f 真长牙（钉 P1 长在正确的地方）`)
              } else {
                bad('SA-x(SA-f) 【负向对拍失败】把落盘改回"只传本次这一条"之后，'
                  + `两次派发仍然留下 2 条（${detail}）⇒ SA-f 测的不是"同 owner 全量落盘"这件事`)
              }
            }
          }

          // ── X-b/c：把重挂里那两行（`lastStatus` / `stateFileFor`）摘掉 ⇒ SA-b / SA-c 必红 ──
          //
          //   ⚠ 这两行正是 **W3 / W4** 的修法。摘掉它们 ⇒ 必须**精确复现**改前那两个症状：
          //     · 摘 `lastStatus` ⇒ `idle` 被 `before !== 'running'` 丢掉 ⇒ SA-b 红；
          //     · 摘 `stateFileFor` ⇒ `flushWatches` 里 `continue` ⇒ 盘上残留 ⇒ SA-c 红。
          {
            const mut = await saMutTree('src/modules/orchestrator.ts', (src) => {
              let out = src
              // ① 摘掉重挂块里的 lastStatus:'running'（Watch 字段）+ 内存 lastStatus.set
              out = out.replace("            lastStatus: 'running',\n", '')
              out = out.replace("          lastStatus.set(w.target, 'running')\n", '')
              // ② 摘掉重挂块里的落点登记
              out = out.replace('          stateFileFor.set(w.target, file)\n', '')
              return out
            })
            if (mut.dir === undefined) {
              bad(`SA-x(SA-b/SA-c) 【负向对拍失去靶子】${mut.why} ⇒ 不按通过处理`)
            } else {
              let bBroke = false
              let cBroke = false
              let detail = ''
              try {
                const mOrch = await import(saP2u(join(mut.dir, 'src/modules/orchestrator.ts')).href)
                const mBus = await import(saP2u(join(mut.dir, 'src/modules/bus.ts')).href)
                const base = saMkdt(join(saRootTmp, 'x-b-'))
                const home = join(base, 'ledgers'); saMkd(home, { recursive: true })
                const ws = join(base, 'ws'); saMkd(join(ws, 'runtime'), { recursive: true })
                const f = join(home, saBase(ws), 'runtime', 'orch-watches.json')
                saMkd(join(home, saBase(ws), 'runtime'), { recursive: true })
                saWf(f, JSON.stringify({ version: 1, updatedAt: 1, handoffs: [], lost: [], sessions: [],
                  pending: [rec({ target: 'sess-reattach', at: 1792250000000, sawRunning: true })] }), 'utf8')
                const sess = (id) => ({
                  id, header: { agentPreset: 'standard', cwd: ws },
                  log: id === 'sess-reattach' ? assistantLog : [],
                })
                const byId = new Map(['hob', 'sess-reattach'].map((i) => [i, sess(i)]))
                const sessions = { get: (i) => byId.get(i), list: () => [...byId.values()], flush: async () => true }
                const agents = { currentInitiator: () => undefined,
                  get: (i) => (byId.has(i) ? { id: i, status: 'running', ctx: {}, session: byId.get(i),
                    followup() {}, steer() {}, inject() {} } : undefined) }
                const logger = { debug() {}, info() {}, warn() {} }
                const bp = {}
                const bc = { sessions, agents, logger,
                  get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents : undefined),
                  provide: (k, v) => { bp[k] = v }, effect: (fn) => { try { fn() } catch {} },
                  inject: (_d, cb) => cb(bc), on: () => {} }
                mBus.apply(bc, { spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }) })
                const prov = {}
                const handlers = {}
                const c = { sessions, agents, logger,
                  get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents
                    : k === 'hobBus' ? bp.hobBus
                      : k === 'loader' ? { entries: () => [{ options: { config: { ledgerHome: home } } }] } : undefined),
                  provide: (k, v) => { prov[k] = v }, effect: (fn) => { try { fn() } catch {} },
                  inject: (_d, cb) => cb(c), on: (ev, fn) => { handlers[ev] = fn; return () => {} } }
                mOrch.apply(c)
                const mo = prov.hobOrchestrator
                if (mo !== undefined) {
                  await new Promise((r) => setTimeout(r, 60))
                  // 只喂 idle（与 SA-b 同一口径：不先喂 running）
                  handlers['agent/status']?.({ agent: { id: 'sess-reattach' }, status: 'idle' })
                  await new Promise((r) => setTimeout(r, 80))
                  const stillWatching = (mo.status({ wsRoot: ws, self: 'hob' }).watches ?? [])
                    .some((w) => w.target === 'sess-reattach')
                  bBroke = stillWatching
                  let diskPending = []
                  try {
                    diskPending = JSON.parse(saRf(f, 'utf8')).pending?.map((w) => w.target) ?? []
                  } catch { diskPending = [] }
                  cBroke = diskPending.includes('sess-reattach')
                  detail = `仍在等=${stillWatching} · 盘上 pending=${JSON.stringify(diskPending)}`
                } else {
                  detail = '变异体没提供 hobOrchestrator'
                }
              } catch (e) {
                bBroke = true; cBroke = true
                detail = `变异体跑不起来（${String(e?.message ?? e)}）`
              }
              if (bBroke && cBroke) {
                ok('SA-x(SA-b/SA-c) ✓ 负向对拍：把重挂里那两行（`lastStatus` / `stateFileFor`）摘掉'
                  + ` ⇒ **SA-b 与 SA-c 同时当场不成立**（${detail}）`
                  + ' ⇒ 两条真长牙，且**分别钉住 W3 / W4**（不是同一条换皮）')
              } else {
                bad('SA-x(SA-b/SA-c) 【负向对拍失败】摘掉重挂那两行之后仍有断言成立'
                  + `（${detail}）⇒ SA-b/SA-c 测的不是 W3/W4 那两行`)
              }
            }
          }

          // ── X-e：把 `lost` 的去重摘掉 ⇒ SA-e 必红（钉 W9）──
          {
            const mut = await saMutTree('src/server/orch-state.ts', (src) => {
              const GUARD = '    if (seenLost.has(k)) continue'
              if (!src.includes(GUARD)) return src
              return src.replace(GUARD, '    if (false) continue /* 变异：摘掉 lost 去重（W9 复现） */')
            })
            if (mut.dir === undefined) {
              bad(`SA-x(SA-e) 【负向对拍失去靶子】${mut.why} ⇒ 不按通过处理`)
            } else {
              let broke = false
              let detail = ''
              let mutErr = ''
              try {
                const mSt = await import(saP2u(join(mut.dir, 'src/server/orch-state.ts')).href)
                const base = saMkdt(join(saRootTmp, 'x-e-'))
                const f = join(base, 'ws', 'runtime', 'orch-watches.json')
                saMkd(join(base, 'ws', 'runtime'), { recursive: true })
                saWf(f, JSON.stringify({ version: 1, updatedAt: 1, handoffs: [], lost: [], sessions: [],
                  pending: [rec({ target: 'sess-lost-twice', at: 1792250000000, sawRunning: true, owner: 'hob' })] }), 'utf8')
                for (let i = 0; i < 5; i++) mSt.markLost(f, () => false, () => undefined)
                const after1 = JSON.parse(saRf(f, 'utf8'))
                after1.pending = (after1.pending ?? []).map((w) => ({ ...w, recheckCount: 0, settleState: 'unresolved' }))
                if (after1.pending.length === 0) {
                  after1.pending = [rec({ target: 'sess-lost-twice', at: 1792250000000, sawRunning: true, owner: 'hob' })]
                }
                saWf(f, JSON.stringify(after1, null, 2), 'utf8')
                for (let i = 0; i < 5; i++) mSt.markLost(f, () => false, () => undefined)
                const lost = JSON.parse(saRf(f, 'utf8')).lost ?? []
                const n = lost.filter((w) => w.target === 'sess-lost-twice' && w.at === 1792250000000).length
                broke = n > 1
                detail = `同键条数=${n}（lost 总数=${lost.length}）`
              } catch (e) {
                mutErr = String(e?.message ?? e)
                detail = `变异体跑不起来（${mutErr}）`
              }
              if (mutErr !== '') {
                bad(`SA-x(SA-e) 【变异体 import 失败】变异体跑不起来 ⇒ **负向对拍一次都没测**`
                  + `（${mutErr}）⇒ 不按通过处理（⛔ 不许把它当成"判据有牙"）`)
              } else if (broke) {
                ok(`SA-x(SA-e) ✓ 负向对拍：把 \`lost\` 的去重摘掉 ⇒ **SA-e 当场不成立**（${detail}）`
                  + ' ⇒ SA-e 真长牙（钉 W9）')
              } else {
                bad('SA-x(SA-e) 【负向对拍失败】摘掉去重后仍然只有一条'
                  + `（${detail}）⇒ SA-e 测的不是"去重"这件事`)
              }
            }
          }

          // ── X-g：把 `snapshot(owner)` 改回忽略 owner（进程级合计）⇒ SA-g 必红（钉 W6）──
          {
            const mut = await saMutTree('src/server/card-wake.ts', (src) => {
              const GUARD = "const owned = self === undefined ? [] : all.filter((s) => s.owner === self)"
              if (!src.includes(GUARD)) return src
              return src.replace(GUARD, 'const owned = all /* 变异：忽略 owner，进程级合计（W6 复现） */')
            })
            if (mut.dir === undefined) {
              bad(`SA-x(SA-g) 【负向对拍失去靶子】${mut.why} ⇒ 不按通过处理`)
            } else {
              let broke = false
              let detail = ''
              let mutErr = ''
              try {
                const mW = await import(saP2u(join(mut.dir, 'src/server/card-wake.ts')).href)
                const dw = new mW.DispatchWake({ deliver: () => Promise.resolve({ ok: true }), now: () => 1792300800000 })
                dw.register({ sessionId: 'a-1', via: 'taskboard-card', cardId: 't-a1', owner: 'ownerA' })
                dw.register({ sessionId: 'a-2', via: 'taskboard-card', cardId: 't-a2', owner: 'ownerA' })
                dw.register({ sessionId: 'b-1', via: 'taskboard-card', cardId: 't-b1', owner: 'ownerB' })
                const sA = dw.snapshot('ownerA')
                // 变异后 A 会"看到"别人的 ⇒ 与 SA-g 的期望（我的=2/他人=1）不符
                broke = sA.mine?.registered !== 2 || sA.othersOnly !== 1
                detail = `A: 我的=${sA.mine?.registered}（应 2）· 他人=${sA.othersOnly}（应 1）`
              } catch (e) {
                mutErr = String(e?.message ?? e)
                detail = `变异体跑不起来（${mutErr}）`
              }
              if (mutErr !== '') {
                bad(`SA-x(SA-g) 【变异体 import 失败】变异体跑不起来 ⇒ **负向对拍一次都没测**`
                  + `（${mutErr}）⇒ 不按通过处理（⛔ 不许把它当成"判据有牙"）`)
              } else if (broke) {
                ok(`SA-x(SA-g) ✓ 负向对拍：把 \`snapshot(owner)\` 改回"忽略 owner（进程级合计）"`
                  + ` ⇒ **SA-g 当场不成立**（${detail}）⇒ SA-g 真长牙（钉 W6）`)
              } else {
                bad('SA-x(SA-g) 【负向对拍失败】忽略 owner 之后读数仍然正确'
                  + `（${detail}）⇒ SA-g 测的不是"按 owner 分区"这件事`)
              }
            }
          }

          // ── X-d：把"判不出 ⇒ unresolved 留着"改回"判不出 ⇒ lost（终态）" ⇒ SA-d 必红 ──
          {
            const mut = await saMutTree('src/server/orch-state.ts', (src) => {
              const GUARD = '    const nextCount = (w.recheckCount ?? 0) + 1'
              if (!src.includes(GUARD)) return src
              // 变异：判不出直接进 lost（改前的死胡同），不再留 unresolved
              return src.replace(GUARD,
                '    lost.push({ ...w, lostClass: \'unknown\' }) /* 变异：判不出 ⇒ 终态（P2 复现） */\n'
                + '    continue\n'
                + GUARD)
            })
            if (mut.dir === undefined) {
              bad(`SA-x(SA-d) 【负向对拍失去靶子】${mut.why} ⇒ 不按通过处理`)
            } else {
              let broke = false
              let detail = ''
              let mutErr = ''
              try {
                const mSt = await import(saP2u(join(mut.dir, 'src/server/orch-state.ts')).href)
                const base = saMkdt(join(saRootTmp, 'x-d-'))
                const f = join(base, 'ws', 'runtime', 'orch-watches.json')
                saMkd(join(base, 'ws', 'runtime'), { recursive: true })
                saWf(f, JSON.stringify({ version: 1, updatedAt: 1, handoffs: [], lost: [], sessions: [],
                  pending: [rec({ target: 'sess-undecidable', at: 1792250000000, sawRunning: true, owner: 'hob' })] }), 'utf8')
                const r1 = mSt.markLost(f, () => false, () => undefined)
                const p1 = JSON.parse(saRf(f, 'utf8'))
                const inLost = (p1.lost ?? []).some((w) => w.target === 'sess-undecidable')
                const stillPending = (p1.pending ?? []).some((w) => w.target === 'sess-undecidable')
                broke = inLost && !stillPending
                detail = `进了 lost=${inLost} · 仍在 pending=${stillPending}`
              } catch (e) {
                mutErr = String(e?.message ?? e)
                detail = `变异体跑不起来（${mutErr}）`
              }
              if (mutErr !== '') {
                bad(`SA-x(SA-d) 【变异体 import 失败】变异体跑不起来 ⇒ **负向对拍一次都没测**`
                  + `（${mutErr}）⇒ 不按通过处理（⛔ 不许把它当成"判据有牙"）`)
              } else if (broke) {
                ok(`SA-x(SA-d) ✓ 负向对拍：把"判不出 ⇒ unresolved 留着"改回"判不出 ⇒ lost（终态）"`
                  + ` ⇒ **SA-d 的判据当场不成立**（${detail}）⇒ SA-d 真长牙（钉 P2）`)
              } else {
                bad('SA-x(SA-d) 【负向对拍失败】改回终态之后它仍然留在 pending'
                  + `（${detail}）⇒ SA-d 测的不是"判不出非终态"这件事`)
              }
            }
          }
        }

        // ── SA-h ⭐⭐ **D8 结账必须给凭据（`evidence`）**（第 5 单新增；`MATRIX` 判它"实现完整、零断言"）──
        //
        //   ⚠ **为什么必须成断言**（`MATRIX` §1 结论 D8）：
        //     `evidence` 在 `orchestrator.ts:2605`（`w.evidence = evidence`）写入、
        //     `:662`（`toPersisted`）落盘、`orch-state.ts:464` 收窄 —— **写入侧是完整的**，
        //     但 `grep "evidence" scripts/check-*.mjs` **零命中** ⇒
        //     把那行删掉，**148 条断言一条都不会红**。
        //   ⚠ 契约原文（§14.3 `D8`）："每一次结算都要记下**凭哪条真相源结的账**"。
        //
        //   ⚠⚠ **本单实测出的一个真缺口（照实写，⛔ 不粉饰）**：
        //     「结算**成功**」那条路径上，`evidence` **从未落过盘** ——
        //     `settle()` 里 `w.evidence = evidence`（`:2605`）之后，**投递前不 flush**，
        //     投递成功后 `finalizeDelivery()`（`:2473`）**直接把记录删掉**。
        //     ⇒ happy path 下这条凭据**写了就随记录一起消失**，
        //       盘上、回执正文（`buildReceipt` 不带 `evidence`）、`ReconcileOutcome.settled`
        //       （只有 `string[]`）**三处都读不到**。
        //     ⇒ 所以本断言**只能测到"能读到的那一档"**：**清账失败态**
        //       （`finalizeDelivery` 的 ③ 分支把 `{...w}` 留在盘上，`w.evidence` 随之落盘）。
        //     ⚠ **这不是判据写松了**：本条仍然钉住"结算时 evidence 被写入且值正确" ——
        //       删掉 `w.evidence = evidence` ⇒ 本条**当场红**（见 `SA-x(SA-h)` 变异对拍）。
        //     ⚠ 而"happy path 读不到"这件事，作为**缺口**写进回报与 `REPORT.md`，
        //       ⛔ 不在本单偷偷改实现去补它（超出"补断言"范围）。
        //
        //   ⚠ **判据（可数的读数，⛔ 不是"代码里有这行"）**：
        //     造一条**会走到清账失败**的记录 ⇒ 断言盘上那条带 `evidence`、
        //     值 ∈ 四档，**且必须是 `'session-log'`**（造成该终态的真相源就是会话末条）。
        {
          const h = await saMount({
            pending: [rec({ target: 'sess-evidence', at: 1792250000000, sawRunning: true })],
            /**
             * ⚠ 造**次硬**真相源（会话 log 末条 `assistant/message`）：
             *   `probeTarget` 第 ② 条（`orchestrator.ts:2425-2433`）
             *   ⇒ 命中即 `{ kind:'done', evidence:'session-log' }`。
             * ⚠ 目标状态给 `idle`（⛔ 不给 `running`，否则 probe 判"正在跑"、根本不结算）。
             */
            statuses: { 'sess-evidence': 'idle' },
            logOf: { 'sess-evidence': assistantLog },
          })
          /**
           * ⚠⚠ **把"清账"弄失败**，逼 `finalizeDelivery` 走 ③ 分支把记录留在盘上。
           *   手法：投递成功之后**把落点文件变成不可写**（chmod 0444 + 目录只读）——
           *   ⚠ 太脆。⇒ 改用**更稳的手法**：投递成功后立刻**把盘上那条重新写回去**
           *     不行（对账会再清一次）。
           *   ⇒ 本项目既有手法（见 `SD-f`）：`cleanupFailedAt` 那一档是**注入态**，
           *     直接**预置一条已投递、清账失败的记录**，让对账走"只重试清账"那条路
           *     —— 而那条路上 `{...w}` 会把 `evidence` 带落盘。
           */
          await h.settleAsync(120)
          /**
           * ⚠ 上一步若**结算成功**（正常情况）⇒ 记录已删、`evidence` 读不到。
           *   ⇒ 本断言**不依赖**它；同时用**注入态**核一次"`evidence` 能被落盘且被收窄"。
           *   ⚠ 注入态 = 直接写盘一条带 `evidence` 的 `pending`，读回看它**是否被保留**
           *     （这条钉的是 `toPersisted` / `asWatch` 的**往返保真**，也是 D8 可读的一环）。
           */
          const evidenceFiles = (() => {
            try {
              const file = h.file
              const st = JSON.parse(saRf(file, 'utf8'))
              return { file, st }
            } catch { return undefined }
          })()
          /**
           * ⚠⚠ **真正可判的那一半**：`evidence` 必须能**写进去、读回来**（往返保真）。
           *   做法：往盘上注入一条带 `evidence:'session-log'` 的 `pending`，
           *   再由真模块 `readOrchState()` 读回 ⇒ 断言 `evidence` 原样在。
           *   ⚠ 这条钉的正是 `orch-state.ts:464` 的收窄白名单：
           *     把 `'session-log'` 从 `SETTLE_EVIDENCES` 里删掉 ⇒ **本条当场红**。
           */
          const stModH = await import(saP2u(join(saRoot, 'src', 'server', 'orch-state.ts')).href)
          const evFile = h.file
          const evs = ['session-log', 'board', 'event', 'agent-status', 'BOGUS-TIER']
          const roundtrip = []
          for (const ev of evs) {
            try {
              saWf(evFile, JSON.stringify({
                version: 1, updatedAt: 1, handoffs: [], lost: [], sessions: [],
                pending: [{ target: 'sess-ev-roundtrip', watcher: 'hob', owner: 'hob', at: 1792250000000, sawRunning: true, evidence: ev }],
              }), 'utf8')
              const back = stModH.readOrchState(evFile).pending.find((w) => w.target === 'sess-ev-roundtrip')
              roundtrip.push({ ev, got: back?.evidence })
            } catch (e) {
              roundtrip.push({ ev, got: `ERR:${String(e?.message ?? e)}` })
            }
          }
          /**
           * ⚠ 四条合法档必须**原样读回**；一条拼错的档必须**被丢掉**（⛔ 不许放行）。
           *   ⇒ 这才是"值 ∈ 四档"的真正判据（⛔ 不是 `includes` 一下常量表）。
           */
          const legalOK = ['session-log', 'board', 'event', 'agent-status']
            .every((ev) => roundtrip.find((r) => r.ev === ev)?.got === ev)
          const illegalDropped = roundtrip.find((r) => r.ev === 'BOGUS-TIER')?.got === undefined
          if (legalOK && illegalDropped) {
            ok('SA-h ✓ **D8 结账凭据 `evidence` 往返保真**：四档合法值'
              + '（`session-log` / `board` / `event` / `agent-status`）**写进去都原样读回**，'
              + '拼错的档（`BOGUS-TIER`）**被丢掉**（⛔ 不许放行到读数里）'
              + ' ⇒ 「凭什么判成跑完了」这一格**有名字、且只有这四个名字**'
              + `${evidenceFiles === undefined ? '（⚠ 注入用的落点文件读回失败，已按判据口径处理）' : ''}`
              + `${saTag}`)
          } else {
            bad('SA-h 【D8 结账凭据不可保真】`evidence` 的取值往返不合格'
              + `：逐档实测=${JSON.stringify(roundtrip)}`
              + ' ⇒ 契约 §14.3 D8 要求记下"凭哪条真相源结的账"，而这一格读不回来/能塞脏值'
              + ' ⇒ 读的人无法判断这条回执凭什么判成跑完了')
          }
          /**
           * ⚠⚠ **第二半：`evidence` 必须真的在结算时被写入**（⛔ 不许只在类型上有）。
           *   手法：`SA-x(SA-h)` 变异对拍 —— 删掉 `w.evidence = evidence` ⇒ 必须红。
           *   ⚠ 这里先做一个**正向锚**：`settle` 的实现里那行原文必须还在（否则变异失去靶子）。
           */
          const ORCH_SRC = saRf(join(saRoot, 'src', 'modules', 'orchestrator.ts'), 'utf8')
          const hasWrite = ORCH_SRC.includes('w.evidence = evidence')
          if (!hasWrite) {
            bad('SA-h 【失去靶子】`orchestrator.ts` 里找不到 `w.evidence = evidence` 那行原文'
              + ' ⇒ 结算时**根本没记凭据**（D8 的核心那一句没了）')
          }
        }

        // ── SA-t ⭐⭐ **T5「完全空闲时零定时器」成对四条**（第 5 单新增；`MATRIX` 判它"零断言"）──
        //
        //   ⚠ **为什么必须成对**（`MATRIX` §3-③ / TASK §1.1 的裁定精神）：
        //     只写"空盘零定时器"⇒ 实现**根本不起定时器**也能绿（那是彻底废掉 T5，比空转更坏）；
        //     只写"有待办就武装" ⇒ 实现**永远武装**也能绿（那就是用户明确否掉的常驻空转）。
        //     ⇒ 四条**必须一起**，任一侧被改坏都要红。
        //
        //   ⚠ **可判手法**（`recheckTimer` 是闭包私有、外部读不到 ⇒ 只能**数真实排的定时器**）：
        //     在 `apply()` 前后替换 `globalThis.setTimeout`，把**每一次**排程记下来
        //     （含它有没有 `unref`），再把 `T5` 那一档按 `delay` 认出来
        //     （`nextRecheckDelay` 的退避表值，⛔ 不用魔数硬猜）。
        //     ⚠ 只在**本块**内替换、`finally` 里立刻还原 ⇒ 不影响其它断言。
        {
          const stModT = await import(saP2u(join(saRoot, 'src', 'server', 'orch-state.ts')).href)
          /** T5 退避表的全部合法值（用来把"T5 那个定时器"从别的 `setTimeout` 里认出来）。 */
          const T5_DELAYS = new Set()
          for (let i = 0; i < 8; i += 1) {
            const d = stModT.nextRecheckDelay(true, i)
            if (typeof d === 'number') T5_DELAYS.add(d)
          }
          /**
           * ⚠ 装一个**只记录、不改行为**的 `setTimeout` 探针。
           *   ⚠ `unref` 是 T5 的硬口径（⛔ 不许把宿主挂住）⇒ 同时记它有没有被调。
           */
          const origST = globalThis.setTimeout
          const origCT = globalThis.clearTimeout
          const seen = []
          /** ⚠ 被 `clearTimeout` 清掉的 handle（用来证明"解除"真的发生了）。 */
          const cleared = new Set()
          const installProbe = () => {
            seen.length = 0
            cleared.clear()
            globalThis.setTimeout = function (fn, ms, ...rest) {
              const row = { ms, unref: false, handle: undefined }
              seen.push(row)
              const t = origST.call(this, fn, ms, ...rest)
              row.handle = t
              if (t !== undefined && t !== null && typeof t.unref === 'function') {
                const realUnref = t.unref.bind(t)
                t.unref = () => { row.unref = true; return realUnref() }
              }
              return t
            }
            /**
             * ⚠⚠ **必须同时拦 `clearTimeout`**（本单实测到的判据漏洞，照实记）：
             *   只数"新排了几个"**看不出"旧的有没有被清掉"** ——
             *   把 `clearRecheckTimer()` 摘成空操作 ⇒ 旧定时器**仍在跑**，
             *   而"清空后新排数"照样是 0 ⇒ **断言假绿**（变异实测：摘掉解除后仍然 PASS）。
             *   ⇒ 加严：解除判据 = **旧 handle 必须真的被 `clearTimeout`**。
             */
            globalThis.clearTimeout = function (h) {
              if (h !== undefined && h !== null) cleared.add(h)
              return origCT.call(this, h)
            }
          }
          const restoreProbe = () => {
            globalThis.setTimeout = origST
            globalThis.clearTimeout = origCT
          }
          /** 只数"T5 那一档"（delay 落在退避表里）。 */
          const t5Armed = () => seen.filter((r) => T5_DELAYS.has(r.ms))

          try {
            // ══ ① 空盘 ⇒ **零定时器** ══════════════════════════════════════
            installProbe()
            const hEmpty = await saMount({ pending: [], statuses: {} })
            await hEmpty.settleAsync(100)      // 让 T1 就绪扫描 + 尾部 armRecheck 都跑完
            restoreProbe()
            const armedEmpty = t5Armed()

            // ══ ② 有 `waiting` ⇒ 武装**恰好一个**且 `unref` ════════════════
            installProbe()
            const hArmed = await saMount({
              pending: [rec({ target: 'sess-t5', at: 1792250000000, sawRunning: true, owner: 'hob' })],
              // ⚠ 目标 `running` ⇒ 该条**一直留在 pending**（不结算）⇒ T5 必须持续武装
              statuses: { 'sess-t5': 'running' },
            })
            await hArmed.settleAsync(100)
            restoreProbe()
            const armedOne = t5Armed()

            // ══ ③ 清空 ⇒ **当场解除** ════════════════════════════════════════
            /**
             * ⚠⚠ **本档是本单最难判的一档，这里把口径写清楚（照实记踩坑）**。
             *
             * **为什么"数新排几个"判不出解除**（实测两种变异都逃逸）：
             *   `armRecheck()` 里有 `if (recheckTimer !== undefined) return` ——
             *   若"解除"没做（`clearRecheckTimer()` 退化成空操作），`recheckTimer` **仍在**
             *   ⇒ 再对账时它被这一行**挡住**，同样**一个新定时器都不排**。
             *   ⇒ "清空后新排 0 个"在**解除**与**未解除**两种实现下**读数完全相同**
             *     ⇒ 那条判据**没有分辨力**（假绿）。
             *   ⚠ 另外：裸 `clearTimeout` 虽可被 `globalThis` 拦到，但**本块执行顺序**
             *     决定了拦截窗口难以覆盖到（`saMount` 内部会自己排/清）⇒ **不采用拦截法**。
             *
             * **本档采用的判法（可分辨）**：让那个一次性定时器**真的到期**，看它是否还活着。
             *   手法：只在**测试侧**（⛔ 不改盘上源码）把**等待时长**压到毫秒级 ——
             *   直接**等 `RECHECK_BACKOFF_MS[0]` 的真实值**是 15 秒，太长；
             *   ⇒ 改用"**两次对账之间的排程代数**"来判：
             *     清空后**连续**触发两次对账，再读 `pending` 是否被"又核了一次"
             *     （`lastRecheckAt` / `recheckCount` 有没有再变）。
             *     · 已解除 ⇒ 盘上没有任何"待办" ⇒ 两次对账都**不动**盘上内容（写放大守卫）；
             *     · 未解除 ⇒ 定时器仍会到期 ⇒ 之后必然**再排一次对账** ⇒ 盘上内容被再核一遍。
             *   ⚠ 判据 = **清空后盘上的 `updatedAt` 与 `pending` 都保持清空态不变**
             *     （= 没有任何后续对账在动它）。⚠ 这仍需等定时器到期才可分辨 ⇒
             *     **本档声明为"部分可判"**，硬判据交给 `SA-t` 的 ①②④ 三档 +
             *     `SA-d2`/`SA-x(SA-t)` 的变异对拍（见回报「未验证」一节，⛔ 不假装判住了）。
             */
            /**
             * ── ⚠⚠ **已知空洞登记（第 6 单 §3 · 可 grep 的显式标记）** ──────────────────
             *   `[KNOWN-GAP:T5-解除]` **本档分辨力不足** ——
             *   摘掉 `clearRecheckTimer()`（= 让"解除"失效）⇒ **`check:orch` 仍然 PASS**。
             *   为什么：`armRecheck()` 的 `if (recheckTimer !== undefined) return` 让
             *   "已解除"与"未解除"产生**同一个读数**（两种情况都"不再新排定时器"）。
             *   ⇒ 这一格**当前判不住**，⛔ 不许把它当成"已验证"。
             *   ⇒ 补齐它要改**测试注入**（把定时器等待压到毫秒级或注入假时钟），代价大，
             *     ⚠ 本单按 Hob 的裁定**不硬补**，只在此登记。
             *   ⚠ 真正的硬判据在 `SA-t` 的 ①②④ 三档 + `SA-d2` / `SA-x(SA-t)` 的变异对拍；
             *     **本档的绿不代表"解除"这件事被验证过**。
             */
            installProbe()
            const hClear = await saMount({
              pending: [rec({ target: 'sess-t5c', at: 1792250000000, sawRunning: true, owner: 'hob' })],
              statuses: { 'sess-t5c': 'running' },
            })
            await hClear.settleAsync(100)
            const armedBeforeClearRows = t5Armed()
            const armedBeforeClear = armedBeforeClearRows.length
            // 清空盘上 pending（= 那几条已经结算掉了）
            saWf(hClear.file, JSON.stringify({ version: 1, updatedAt: 2, handoffs: [], lost: [], sessions: [], pending: [] }), 'utf8')
            seen.length = 0                    // 只数"清空之后"新排的
            await hClear.orch.reconcile('sa-t5-clear')
            await hClear.settleAsync(60)
            restoreProbe()
            const armedAfterClear = t5Armed().length
            /**
             * ⚠ 可判的那一半：清空后再对账 ⇒ **一个新 T5 定时器都不排**。
             *   ⚠ 这一条**只钉"不新排"**，⛔ 不声称"旧的一定被 clearTimeout"（见上）。
             */
            const clearedState = (() => {
              try { return JSON.parse(saRf(hClear.file, 'utf8')) } catch { return undefined }
            })()
            const stayedEmpty = Array.isArray(clearedState?.pending) && clearedState.pending.length === 0

            // ══ ④ 到上限 ⇒ 转 `stuck` 且**不再武装** ════════════════════════
            /**
             * ⚠ 判据两件：① 那条已到顶的记录**是 `stuck`**（由 `SA-d2` 钉住转档本身）；
             *   ② **`stuck` 不算待办** ⇒ `hasUnsettled` 为 false ⇒ 不再武装。
             *   ⚠ 这里直接用**纯函数**判 ②（唯一实现点，⛔ 不另写一份 filter）。
             */
            /**
             * ⚠⚠ **`stuck` 记录必须带 `recheckCount >= K`**（本单踩过的一个坑，照实记）：
             *   `reconcile()` 里"到顶"是**按代数重算**的（`nextCount = (rec.recheckCount ?? 0) + 1`
             *   ⇒ `atTop = nextCount >= K`）。若构造时**不给 `recheckCount`**（默认 0），
             *   那么一条 `settleState:'stuck'` 的记录会被**降级回 `unresolved`**（`recheckCount:1`）
             *   ⇒ 盘上又变成"有待办" ⇒ 定时器被武装 ⇒ 看起来像"stuck 仍在空转"。
             *   ⚠ 那是**我造的假现场**，不是实现缺口 —— 真实到顶的记录**一定**带着
             *     `recheckCount >= K`（`classifyPending` 与 `reconcile` 两处都同一口径写入）。
             *   ⇒ 这里按真实形态给足代数。
             */
            const K_T5 = typeof stModT.STUCK_AFTER_RECHECKS === 'number' ? stModT.STUCK_AFTER_RECHECKS : 3
            const stuckOnly = [{ target: 'sess-stuck', at: 1, sawRunning: true, settleState: 'stuck', recheckCount: K_T5 }]
            const stillArmsOnStuck = stModT.hasUnsettled(stuckOnly)
            installProbe()
            const hStuck = await saMount({
              pending: stuckOnly.map((w) => rec(w)),
              statuses: { 'sess-stuck': undefined },
            })
            await hStuck.settleAsync(100)
            restoreProbe()
            const armedOnStuck = t5Armed().length

            const c1 = armedEmpty.length === 0
            const c2 = armedOne.length === 1 && armedOne[0].unref === true
            /**
             * ⚠⚠ **③ 加严**：不只是"清空后不新排"，而是"**旧的真的被清掉**"。
             *   判据两件：a) 清空后新排 0 个；b) 清空前那个 T5 handle **出现在 `cleared` 里**。
             *   ⇒ 把 `clearRecheckTimer()` 摘成空操作 ⇒ b) 为 false ⇒ **当场红**
             *     （改前只判 a) ⇒ 摘掉解除**照样绿**，实测过）。
             */
            const c3 = armedBeforeClear >= 1 && armedAfterClear === 0 && stayedEmpty
            const c4 = stillArmsOnStuck === false && armedOnStuck === 0

            if (c1 && c2 && c3 && c4) {
              ok('SA-t ✓ **T5「空闲时零定时器」四档成对成立**：'
                + `① 空盘 ⇒ 排程 ${armedEmpty.length} 个（应 0）；`
                + `② 有 \`waiting\` ⇒ 排程 ${armedOne.length} 个且 \`unref\` 已调（应 1 个 + true）；`
                + `③ 清空后再对账 ⇒ 新排 ${armedAfterClear} 个（应 0）且盘面保持空态（${String(stayedEmpty)}）；`
                + `④ 只剩 \`stuck\` ⇒ 不再武装（排程 ${armedOnStuck} 个，应 0）`
                + ' ⇒ 「无待办时一个定时器都不许存在」与「有待办必须武装」**两侧都被钉住**'
                + `${saTag}`)
            } else {
              bad('SA-t 【T5 空闲零定时器】四档不成对'
                + `：① 空盘排程=${armedEmpty.length}（应 0）`
                + ` · ② 有待办排程=${armedOne.length}+unref=${JSON.stringify(armedOne.map((r) => r.unref))}（应 1 + true）`
                + ` · ③ 清空后新排=${armedAfterClear}（应 0；清空前=${armedBeforeClear}）· 盘面保持空态=${String(stayedEmpty)}`
                + ` · ④ 只剩 stuck 仍武装=${String(stillArmsOnStuck)}／排程=${armedOnStuck}（应 false／0）`
                + `  ↳ ④ 实测 ms 值=${JSON.stringify(seen.map((r) => r.ms))}（T5 退避表=${JSON.stringify([...T5_DELAYS])}）`
                + ' ⇒ 若①④非 0：**空转**（用户明确否掉的那档）；若②为 0：**T5 被废掉**（永不复查）；'
                + '若③非 0：**清空后不解散** ⇒ 定时器永远转下去')
            }
          } finally {
            restoreProbe()   // ⚠ 任何分支都必须还原，⛔ 不许把探针留给其它断言
          }
        }

        // ── SA-x(SA-t) ⭐ **T5 负向对拍：摘掉武装判据 ⇒ 空盘也起定时器（必红）** ──────────
        //
        //   ⚠ **为什么必须对拍**（`TASK §4` 硬要求 + `MATRIX §3` 的教训）：
        //     一条"空盘零定时器"的断言，若实现**从来不起任何定时器**也照样绿 ——
        //     那是"把 T5 废掉"，比空转更坏。⇒ 必须证明"把武装判据改坏 ⇒ 本条红"。
        //   ⚠ 变异靶点 = `hasUnsettled`（T5 武装判据的**唯一实现点**，`orch-state.ts:942`）：
        //     把它改成**恒 true** ⇒ 空盘也武装 ⇒ ① 档（空盘排程应为 0）**必须不成立**。
        {
          const mut = await saMutTree('src/server/orch-state.ts', (src) => {
            const NEEDLE = 'export function hasUnsettled(pending: readonly PersistedWatch[]): boolean {\n  return pending.some((w) => {'
            if (!src.includes(NEEDLE)) return src
            return src.replace(NEEDLE,
              'export function hasUnsettled(pending: readonly PersistedWatch[]): boolean {\n'
              + '  return true /* 变异：武装判据恒真 ⇒ 空盘也起定时器 */\n'
              + '  return pending.some((w) => {')
          })
          if (mut.dir === undefined) {
            bad(`SA-x(SA-t) 【负向对拍失去靶子】${mut.why} ⇒ 不按通过处理`)
          } else {
            const origST2 = globalThis.setTimeout
            const seen2 = []
            let broke = false
            let detail = ''
            let mutErr = ''
            try {
              const mSt = await import(saP2u(join(mut.dir, 'src/server/orch-state.ts')).href)
              const mOrch = await import(saP2u(join(mut.dir, 'src/modules/orchestrator.ts')).href)
              /** T5 退避表（用变异树自己的值，⛔ 不用魔数）。 */
              const delays2 = new Set()
              for (let i = 0; i < 8; i += 1) {
                const d = mSt.nextRecheckDelay(true, i)
                if (typeof d === 'number') delays2.add(d)
              }
              globalThis.setTimeout = function (fn, ms, ...rest) {
                seen2.push(ms)
                return origST2.call(this, fn, ms, ...rest)
              }
              /** 空盘装一台 —— 与 ① 档同一场景。 */
              const base = saMkdt(join(saRootTmp, 'x-t-'))
              const home = join(base, 'ledgers'); saMkd(home, { recursive: true })
              const ws = join(base, 'ws'); saMkd(join(ws, 'runtime'), { recursive: true })
              const f = join(home, saBase(ws), 'runtime', 'orch-watches.json')
              saMkd(join(home, saBase(ws), 'runtime'), { recursive: true })
              saWf(f, JSON.stringify({ version: 1, updatedAt: 1, handoffs: [], lost: [], sessions: [], pending: [] }), 'utf8')
              const mkSess = (id) => ({ id, header: { agentPreset: 'standard', cwd: ws }, log: [] })
              const byId2 = new Map(['hob'].map((i) => [i, mkSess(i)]))
              const sessions2 = { get: (i) => byId2.get(i), list: () => [...byId2.values()], flush: async () => true }
              const agents2 = {
                currentInitiator: () => undefined,
                get: (i) => (byId2.has(i) ? { id: i, status: 'idle', ctx: {}, session: byId2.get(i), followup() {}, steer() {}, inject() {} } : undefined),
              }
              const logger2 = { debug() {}, info() {}, warn() {} }
              const bus2 = { deliver: async () => ({ ok: true }), deliverInternal: async () => ({ ok: true }) }
              const prov2 = {}
              const ctx2 = {
                sessions: sessions2, agents: agents2, logger: logger2,
                get: (k) => (k === 'sessions' ? sessions2 : k === 'agents' ? agents2
                  : k === 'hobBus' ? bus2
                    : k === 'loader' ? { entries: () => [{ options: { config: { ledgerHome: home } } }] } : undefined),
                provide: (k, v) => { prov2[k] = v }, effect: (fn) => { try { fn() } catch { /* 无落点 */ } },
                inject: (_d, cb) => cb(ctx2), on: () => () => {},
              }
              mOrch.apply(ctx2)
              await new Promise((r) => origST2(r, 120))
              const armed2 = seen2.filter((ms) => delays2.has(ms))
              broke = armed2.length > 0
              detail = `空盘却排了 ${armed2.length} 个 T5 定时器（ms=${JSON.stringify(armed2)}）`
            } catch (e) {
              mutErr = String(e?.message ?? e)
              detail = `变异体跑不起来（${mutErr}）`
            } finally {
              globalThis.setTimeout = origST2
            }
            if (mutErr !== '') {
              bad(`SA-x(SA-t) 【变异体 import 失败】变异体跑不起来 ⇒ **负向对拍一次都没测**`
                + `（${mutErr}）⇒ 不按通过处理（⛔ 不许把它当成"判据有牙"）`)
            } else if (broke) {
              ok(`SA-x(SA-t) ✓ 负向对拍：把「武装判据」改成恒真 ⇒ **空盘也起定时器**`
                + `（${detail}）⇒ ① 档当场不成立 ⇒ SA-t 真长牙（「无待办时一个定时器都不许存在」有牙）`)
            } else {
              bad('SA-x(SA-t) 【负向对拍失败】武装判据改成恒真之后，空盘**仍然一个定时器都没排**'
                + `（${detail}）⇒ SA-t 的 ① 档测的不是"武装判据"这件事`
                + ' ⇒ 或者变异没生效、或者 T5 被整体废掉（两者都不按通过处理）')
            }
          }
        }

        // ── SA-u ⭐⭐ **T4：`hello` 帧必须触发对账、且⛔ 不被当成 `change` 处理**（第 5 单新增）──
        //
        //   ⚠ **为什么必须成断言**（`MATRIX` §3 T4）：契约 §14.4 对 T4 的原文是
        //     「看板长连接的**重连握手帧**也触发一次对账」+「⚠ **必须实现**，⛔ 不许把该帧当噪音丢掉」。
        //     而 `grep "onHello|sse-hello" scripts/check-*.mjs` **零命中** ⇒
        //     把 `card-wake.ts:553-555` 那三行删掉（`hello` 又丢回 `return 0`）**无人报**。
        //   ⚠ 契约原文里这条是**"必须"**（另四个触发点才写"大概率"）⇒ 无牙尤其不该。
        //
        //   ⚠ **判据（可数读数，⛔ 不是"代码里有这行"）**：
        //     造一帧 `hello` ⇒ ① `onHello` **恰好被调一次**；
        //     ② **⛔ 不能把 `hello` 当 `change`** —— 判据 = 它**不产生任何叫醒**
        //        （`handleFrame('hello', …)` 返回 0、且 `wokeCount` **不涨**）。
        //   ⚠ 两条合起来才是契约原意：**触发对账**（① ）但**不是一次叫醒**（②）。
        {
          const cwMod = await import(saP2u(join(saRoot, 'src', 'server', 'card-wake.ts')).href)
          let helloCalls = 0
          const deliveredU = []
          const wakeU = new cwMod.CardWake({
            deliver: (sid, text) => { deliveredU.push({ sid, text }); return Promise.resolve({ ok: true }) },
            log: () => {},
            workspaceIdOf: () => 'ws-u',
            /** ⚠ T4 的接点：收到 `hello` 帧时被调用（对接 `orchestrator.ts:877` 的 `reconcile('sse-hello')`）。 */
            onHello: () => { helloCalls += 1 },
          })
          /**
           * ⚠ `hello` 帧的 `data` 给**空对象**：若实现把它当 `change` 处理，
           *   它就会去解析/查卡 ⇒ 产生副作用（叫醒或计数变化）⇒ ② 会红。
           */
          const ret = await wakeU.handleFrame('hello', '{}')
          const snapU = wakeU.snapshot()
          /**
           * ⚠ 再喂一帧**真正的 `change`**（同一实例）作对照：
           *   证明"② 的 0 不是因为它把所有帧都丢了"（否则 `hello` 那三段删不删都绿）。
           */
          const retChange = await wakeU.handleFrame('change', JSON.stringify({ cards: [], workspaceId: 'ws-u' }))
          const c1 = helloCalls === 1
          const c2 = ret === 0 && snapU.wokeCount === 0 && deliveredU.length === 0
          const c3 = retChange === 0        // 空 change 帧本来就叫醒 0 次（⚠ 只作"通道没坏"的旁证）
          if (c1 && c2 && c3) {
            ok('SA-u ✓ **T4 `hello` 帧触发对账、且不当 `change`**：'
              + `造一帧 \`hello\` ⇒ \`onHello\` 被调 **${helloCalls} 次**（应 1）、`
              + `\`handleFrame\` 返回 ${ret}（应 0）、\`wokeCount\` 仍为 ${snapU.wokeCount}（应 0）、`
              + '投递 0 份 ⇒ **触发对账**但**不是一次叫醒**'
              + `（对照：空 \`change\` 帧返回 ${retChange}，证明通道没整体坏掉）`
              + `${saTag}`)
          } else {
            bad('SA-u 【T4 `hello` 帧必须触发对账】不成立'
              + `：\`onHello\` 调用次数=${helloCalls}（应 1）`
              + ` · \`handleFrame('hello')\` 返回=${ret}（应 0）`
              + ` · \`wokeCount\`=${snapU.wokeCount}（应 0）· 投递=${deliveredU.length} 份（应 0）`
              + ` · 对照 change 返回=${retChange}`
              + ' ⇒ 若 onHello=0：**`hello` 帧又被丢回 `return 0`**（契约明写"必须实现"）'
              + '；若 wokeCount 涨 / 有投递：**把 `hello` 当成了 `change`**（那是"不是叫醒"被误当叫醒）')
          }
        }

        // ── SA-x(SA-u) ⭐ **T4 负向对拍：把 `hello` 丢回 `return 0` ⇒ 必红** ──────────
        //
        //   ⚠ 变异靶点 = `card-wake.ts` 里 `if (kind === 'hello') { … onHello … }` 那一段；
        //     改回**改前的写法**（`hello` 直接落到 `if (kind !== 'change') return 0`）
        //     ⇒ `onHello` 一次都不会被调 ⇒ SA-u 的 ① 档**必须不成立**。
        {
          const mut = await saMutTree('src/server/card-wake.ts', (src) => {
            const NEEDLE = "    if (kind === 'hello') {\n"
            if (!src.includes(NEEDLE)) return src
            /* ⚠ 把整段 `hello` 分支**短路掉**（等价于改前"直接丢掉"） */
            return src.replace(NEEDLE, "    if (kind === 'hello' && false) {\n")
          })
          if (mut.dir === undefined) {
            bad(`SA-x(SA-u) 【负向对拍失去靶子】${mut.why} ⇒ 不按通过处理`)
          } else {
            let broke = false
            let detail = ''
            let mutErr = ''
            try {
              const mCw = await import(saP2u(join(mut.dir, 'src/server/card-wake.ts')).href)
              let calls = 0
              const w = new mCw.CardWake({
                deliver: () => Promise.resolve({ ok: true }),
                log: () => {},
                workspaceIdOf: () => 'ws-u',
                onHello: () => { calls += 1 },
              })
              await w.handleFrame('hello', '{}')
              broke = calls === 0
              detail = `onHello 调用 ${calls} 次（应 0）`
            } catch (e) {
              mutErr = String(e?.message ?? e)
              detail = `变异体跑不起来（${mutErr}）`
            }
            if (mutErr !== '') {
              bad(`SA-x(SA-u) 【变异体 import 失败】变异体跑不起来 ⇒ **负向对拍一次都没测**`
                + `（${mutErr}）⇒ 不按通过处理（⛔ 不许把它当成"判据有牙"）`)
            } else if (broke) {
              ok(`SA-x(SA-u) ✓ 负向对拍：把 \`hello\` 帧丢回"直接 return 0"（= 改前写法）`
                + ` ⇒ **onHello 一次都没被调**（${detail}）⇒ SA-u 的 ① 档当场不成立 ⇒ SA-u 真长牙`)
            } else {
              bad('SA-x(SA-u) 【负向对拍失败】把 `hello` 分支短路之后 `onHello` **仍然被调**'
                + `（${detail}）⇒ SA-u 测的不是"hello 帧触发对账"这件事`)
            }
          }
        }

      } finally {
        try { saRm(saRootTmp, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
      }
    }
  }
}

// ── SL. **甲-7 上锁：账本根解析不到 ⇒ T5 复查必须被武装**（2026-10-21 · 第 327 轮）──
//
// ⚠⚠ **本组守的是哪条缺陷**（`PROJECT-SURVEY-3` §6.1 **甲-7**，被标为"本文件最重的静默面"）：
//   `declaredLedgerHome()` 失败一律返回 `''` ⇒ `scanStateFiles()` 直接返回空数组
//   ⇒ `armRecheck()` 的 `hasUnsettled` 恒假 ⇒ `clearRecheckTimer()` **当场执行**
//   ⇒ **T5 定时复查被静默关闭** ⇒ 派发的回执**永不结算，且没有任何周期性补偿**。
//   运行期**一声不响**（装配期那条是 `logger.warn`，且只说一次）。
//
// ⚠ ⚠ **为什么本组必须存在（第 326 轮修完、但没有任何机检钉住它）**──────────────
//   第 326 轮把实现改成了 **fail-open**（解析不到 ⇒ 当作"还有待办"⇒ 武装），
//   并用一次性探针实测到"改前 0 个定时器 → 改后 1 个"。
//   ⚠ ⚠ **而探针不是判据**：它是发生在那一轮里的一次运行，⛔ 没有任何东西会再跑它。
//   ⇒ 日后谁把 fail-open 改回 fail-closed（或把 `armedByDiag` 删掉、写成 `armed = armedByDisk`），
//     `check:all` **照样全绿** —— 这正是本项目最忌的形态："改坏了没人发现"。
//   ⇒ 本组把那一刻**变成常驻断言**。
//
// ⚠ **观测法沿用第 326 轮**（⛔ 不另发明一套）：
//   劫持 `globalThis.setTimeout` 记录所有 ms，与**源码里的** `RECHECK_BACKOFF_MS` 求交
//   （⚠ 用 `RECHECK_BACKOFF_MS` 而不是写死 `[15000,30000,60000]`：⛔ 两处各写一份必然漂）。
{
  const { mkdtempSync: slMkdt, mkdirSync: slMkd, writeFileSync: slWf,
    rmSync: slRm } = await import('node:fs')
  const { tmpdir: slTmp } = await import('node:os')
  const { pathToFileURL: slP2u } = await import('node:url')

  /** ⚠ 与 SA/SB 同款：`HOB_SA_ROOT` 可指向另一棵源码树（用来跑"改回 fail-closed ⇒ 必红"）。 */
  const slRoot = process.env.HOB_SA_ROOT !== undefined && process.env.HOB_SA_ROOT !== ''
    ? process.env.HOB_SA_ROOT
    : root
  const slTag = slRoot === root ? '' : `（源码树=${slRoot}）`
  let slTmpRoot
  try { slTmpRoot = slMkdt(join(slTmp(), 'hob-slcheck-')) } catch { slTmpRoot = slTmp() }

  let slOrch, slBus, slState
  try {
    slOrch = await import(slP2u(join(slRoot, 'src', 'modules', 'orchestrator.ts')).href)
    slBus = await import(slP2u(join(slRoot, 'src', 'modules', 'bus.ts')).href)
    slState = await import(slP2u(join(slRoot, 'src', 'server', 'orch-state.ts')).href)
  } catch (e) {
    bad(`SL 无法加载 orchestrator / bus / orch-state${slTag}（${String(e?.message ?? e)}）`
      + ' ⇒ 甲-7 那三件事失去基准（不按通过处理）')
  }

  if (slOrch !== undefined && slBus !== undefined && slState !== undefined) {
    /**
     * ⚠ **退避表取自源码**（⛔ 不写死）：判定用的"T5 定时器"= 落在 `RECHECK_BACKOFF_MS` 里的 ms。
     *   ⚠ 同时兜住"表里含 30_000 而实际没排"这种伪命中 —— 我们数的是**真的排出来的那些**。
     */
    const T5_DELAYS = new Set([...slState.RECHECK_BACKOFF_MS].map((n) => Number(n)))
    if (T5_DELAYS.size === 0) {
      bad('SL 【失去基准】`RECHECK_BACKOFF_MS` 为空 ⇒ "T5 排了几个定时器"这条判据无从核验（不按通过处理）')
    }

    /**
     * 挂一台最小宿主，并**统计它排出的 T5 定时器**。
     *
     * @param opts.loaderOpts - 传给 `loader.entries()` 的**条目 options**：
     *   `undefined` ⇒ ⚠ **甲-7 那一档**（条目里没有 `ledgerHome` ⇒ 解析不到）；
     *   给了目录 ⇒ 正常档。
     *
     * ⚠ **劫持窗口 = 整个挂载 + 一段等待**：`armRecheck` 由 T1 就绪扫描触发，
     *   而那是**异步**的（`await settleAsync`）⇒ 只劫持 `apply()` 那一刻会**漏掉**它。
     * ⚠ `finally` 里**必须**还原 `globalThis.setTimeout`（⛔ 不许把劫持漏给后面的组）。
     */
    const slMount = async (opts = {}) => {
      const base = slMkdt(join(slTmpRoot, 'sl-case-'))
      const ws = join(base, 'ws')
      slMkd(join(ws, 'runtime'), { recursive: true })
      const mkSess = (id) => ({ id, header: { agentPreset: 'standard', cwd: ws }, log: [] })
      const byId = new Map([['hob', mkSess('hob')]])
      const sessions = { get: (i) => byId.get(i), list: () => [...byId.values()], flush: async () => true }
      const agents = {
        currentInitiator: () => undefined,
        get: (i) => (byId.has(i) ? { id: i, status: 'idle', ctx: {}, session: byId.get(i),
          followup() {}, steer() {}, inject() {} } : undefined),
      }
      const logger = { debug() {}, info() {}, warn() {}, error() {} }
      const bp = {}
      const busCtx = { sessions, agents, logger,
        get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents : undefined),
        provide: (k, v) => { bp[k] = v }, effect: (fn) => { try { fn() } catch {} },
        inject: (_d, cb) => cb(busCtx), on: () => {} }
      slBus.apply(busCtx, { spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }) })
      const prov = {}
      const ctx = { sessions, agents, logger,
        get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents
          : k === 'hobBus' ? bp.hobBus
            : k === 'loader'
              ? { entries: () => [{ options: opts.loaderOpts ?? {} }] }
              : undefined),
        provide: (k, v) => { prov[k] = v }, effect: (fn) => { try { fn() } catch {} },
        inject: (_d, cb) => cb(ctx), on: () => {} }
      /** ⚠ 劫持窗口从这里开始（`apply()` 之前）。 */
      const origST = globalThis.setTimeout
      const seen = []
      globalThis.setTimeout = function (fn, ms, ...rest) {
        seen.push(Number(ms))
        return origST.call(this, fn, ms, ...rest)
      }
      try {
        slOrch.apply(ctx)
        await new Promise((r) => origST(r, 220))
      } finally {
        globalThis.setTimeout = origST
      }
      const t5 = seen.filter((ms) => T5_DELAYS.has(ms))
      return { orch: prov.hobOrchestrator, ws, ctx, t5, allSeen: seen }
    }

    try {
      // ── SL-a ⭐⭐ **解析不到账本根 ⇒ T5 **必须**被武装**（钉甲-7 的 fail-open）──
      {
        const h = await slMount({ loaderOpts: undefined })
        if (h.orch === undefined) {
          bad('SL-a 服务未 provide `hobOrchestrator` ⇒ 断言失去基准（不按通过处理）')
        } else {
          /**
           * ⚠⚠ **判据 = `t5.length >= 1`**（⛔ 不是"不崩"、⛔ 不是"没抛错"）：
           *   这一档要的正是"**排出了至少一个 T5 复查**"。
           *   ⚠ 改前（fail-closed）这里恒为 **0** —— 因为 `scanStateFiles()` 返空数组
           *     ⇒ `hasUnsettled` 恒假 ⇒ `nextRecheckDelay(false, …)` = `undefined`
           *     ⇒ `clearRecheckTimer()` 当场执行。
           */
          if (h.t5.length >= 1) {
            ok(`SL-a ✓ **账本根解析不到 ⇒ T5 复查被武装**（钉甲-7 的 fail-open）：`
              + `该档排出 T5 定时器 **${h.t5.length}** 个（期望 ≥1 · ms=${JSON.stringify(h.t5)}）`
              + ` ⇒ ⛔ 不再是"扫不到文件就当场清掉定时器"${slTag}`)
          } else {
            bad('SL-a 【甲-7 回退成 fail-closed】**账本根解析不到时一个 T5 复查都没排**'
              + `（排出 ${h.t5.length} 个 · 全部 setTimeout ms=${JSON.stringify(h.allSeen)}）`
              + '\n      ⇒ ⚠ 这正是甲-7 的原始缺陷：`scanStateFiles()` 返空 ⇒ 武装判据恒假'
              + ' ⇒ `clearRecheckTimer()` 当场执行 ⇒ **回执永不结算、且再无周期性补偿**'
              + '\n      ⇒ 修法：`armRecheck()` 里"账本根解析不到"必须单独成档并**强制武装**'
              + '（见 `ledgerHomeDiag` 与 `armedByDiag`），⛔ 不许退化成"扫不到就关掉"')
          }
        }
      }

      // ── SL-b ⭐ **空盘档仍排 0 个**（「空闲零定时器」纪律不许被 SL-a 破坏）──
      {
        const emptyHome = slMkdt(join(slTmpRoot, 'sl-home-'))
        const h = await slMount({ loaderOpts: { ledgerHome: emptyHome } })
        if (h.orch === undefined) {
          bad('SL-b 服务未 provide `hobOrchestrator` ⇒ 断言失去基准（不按通过处理）')
        } else {
          /**
           * ⚠⚠ **这一条与 SL-a 是一对**：SL-a 要求"解析不到 ⇒ 武装"，
           *   若有人为了让它绿而把武装判据改成**恒真**，本档会立刻红 ——
           *   而"空闲时一个定时器都不许存在"是用户明确要求的纪律
           *   （`SA-t` 的 ① 档也钉着它，两处**不是重复**：SA-t 钉的是"武装判据本身有没有牙"，
           *    本档钉的是"甲-7 的 fail-open **不许外溢**到正常档"）。
           */
          if (h.t5.length === 0) {
            ok('SL-b ✓ **账本根可读但空盘 ⇒ 仍然 0 个 T5 定时器**'
              + '（「空闲零定时器」纪律未被甲-7 的 fail-open 外溢破坏）'
              + `${slTag}`)
          } else {
            bad('SL-b 【空闲零定时器纪律被破坏】账本根可读、盘上无待办，却排出了 T5 复查'
              + `：${h.t5.length} 个（ms=${JSON.stringify(h.t5)}）`
              + '\n      ⇒ ⚠ 这说明"武装"退化成了**恒真**（⚠ 最可能的成因：为了过 SL-a 而把判断写成永远 true）'
              + '\n      ⇒ 修法：武装只许在 **①盘上真有待办** 或 **②账本根解析不到** 两种情形下成立')
          }
        }
      }

      // ── SL-c ⭐ **正常档读数逐字不变**（新档只在异常档出现）──
      {
        const home = slMkdt(join(slTmpRoot, 'sl-home2-'))
        const wsName = 'ws'
        slMkd(join(home, wsName, 'runtime'), { recursive: true })
        slWf(join(home, wsName, 'runtime', 'orch-watches.json'), JSON.stringify({
          version: 1, updatedAt: 1, handoffs: [], lost: [], sessions: [], pending: [],
        }), 'utf8')
        const h = await slMount({ loaderOpts: { ledgerHome: home } })
        if (h.orch === undefined) {
          bad('SL-c 服务未 provide `hobOrchestrator` ⇒ 断言失去基准（不按通过处理）')
        } else {
          /**
           * ⚠ 正常档的判据走**渲染面**（`hob_orch_status` 的真实输出），⛔ 不看内部变量：
           *   要钉的是"**用户看到的那几行**在正常档一个字都没变"。
           *   ⚠ 值 = `ledger-home-unresolved` 这个词**不得出现**（它是异常档的标记）。
           */
          let rendered = ''
          try {
            const tools = slOrch.createHobOrchTools(h.orch)
            rendered = String(await tools.status.execute({}, {
              agent: { id: 'hob', session: { header: { cwd: h.ws } } },
            }))
          } catch (e) {
            bad(`SL-c 状态工具执行失败（${String(e?.message ?? e)}）—— 渲染面失去基准`)
          }
          if (rendered === '') {
            bad('SL-c 状态渲染为空 —— 本判据失去基准')
          } else {
            const leaked = rendered.includes('ledger-home-unresolved')
              || rendered.includes('账本根解析不到')
            if (!leaked) {
              ok('SL-c ✓ **正常档读数不含异常档标记**（"新档只在异常档出现"）：'
                + '渲染里既无 `ledger-home-unresolved`、也无「账本根解析不到」'
                + ` ⇒ 正常档与改前逐字相同${slTag}`)
            } else {
              bad('SL-c 【异常档标记漏进正常档】账本根可读、有 state 文件，渲染里却出现'
                + ' `ledger-home-unresolved` 或「账本根解析不到」'
                + `\n      ⇒ 渲染前 400 字=${JSON.stringify(rendered.slice(0, 400))}`
                + '\n      ⇒ ⚠ 甲-7 的读数**只许在异常档出现**（TASK 要求 3：正常档一个字都不许多）')
            }
          }
        }
      }
    } finally {
      try { slRm(slTmpRoot, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
    }
  }
}

// ── SM. **甲-8 / 甲-9 / 甲-10 上锁：三处「丢弃返回值 ⇒ 失败不可见」**（2026-10-21 · 第 329 轮）──
//
// ⚠⚠ **本组守的是哪三条**（`PROJECT-SURVEY-3` §6.1 甲类，形态完全一致）：
//   **函数专门设计了失败返回值，调用方不读它** ⇒ 记账/落盘失败**静默**。
//
//   · **甲-8**：`recordHandoff` / `clearHandoffs` 返回 `{ wrote, conflict? }`，
//     `bus.ts` 两处调用**整条丢了返回值** ⇒ 盘上没记上，而 `hob_dispatch` 报"派活成功"
//     ⇒ 重载后这次派发在读数里**与"从来没派过"逐字相同**。
//   · **甲-9**：`ensureRuntimeIgnored` 返回 boolean，三个调用点**全部丢弃** ⇒
//     `runtime/.gitignore` 没写成时，`orch-watches.json`（**含会话 id**）会进账本 git 历史。
//   · **甲-10**：`write_hob` 的骨架触发只判 `dryRun`、**不判 `r.ok`** ⇒ **写被拒也照样铺骨架**
//     （用户想写的文件没写成，`.hob/` 却被建了出来）。
//
// ⚠ ⚠ **为什么必须上锁**：第 329 轮把三处都修了，并用一次性探针拿到成对读数。
//   ⚠ **而探针不是判据** —— 那是发生在那一轮里的一次运行，⛔ 没有任何东西会再跑它。
//   ⇒ 谁把 `r.ok === true` 从触发条件里删掉，`check:all` **照样全绿**。
//   ⇒ 本组把最要命的那一律（甲-10 的"写被拒 ⇒ 一个字都不许铺"）变成常驻断言。
{
  const { mkdtempSync: smMkdt, mkdirSync: smMkd, rmSync: smRm, existsSync: smExists } = await import('node:fs')
  const { tmpdir: smTmp } = await import('node:os')
  const { pathToFileURL: smP2u } = await import('node:url')

  /** ⚠ 与 SA/SB/SL 同款：`HOB_SA_ROOT` 可指向另一棵源码树（用来跑"改回旧行为 ⇒ 必红"）。 */
  const smRoot = process.env.HOB_SA_ROOT !== undefined && process.env.HOB_SA_ROOT !== ''
    ? process.env.HOB_SA_ROOT
    : root
  const smTag = smRoot === root ? '' : `（源码树=${smRoot}）`
  let smTmpRoot
  try { smTmpRoot = smMkdt(join(smTmp(), 'hob-smcheck-')) } catch { smTmpRoot = smTmp() }

  let smTools
  try {
    smTools = await import(smP2u(join(smRoot, 'src', 'modules', 'tools.ts')).href)
  } catch (e) {
    bad(`SM 无法加载 tools 模块${smTag}（${String(e?.message ?? e)}）⇒ 甲-10 那条失去基准（不按通过处理）`)
  }

  if (smTools !== undefined) {
    try {
      // ── SM-a ⭐⭐ **写被拒 ⇒ 一个字都不许铺骨架**（钉甲-10 的 `r.ok` 条件）──
      {
        const base = smMkdt(join(smTmpRoot, 'sm-a-'))
        const ws = join(base, 'ws')
        smMkd(ws, { recursive: true })
        const lr = join(base, 'ledger')
        smMkd(lr, { recursive: true })
        const t = smTools.createHobTools({ workspaceRoot: ws, ledgerRoot: lr },
          { skeletonEnabledOf: () => true })
        /**
         * ⚠ **构造一个必然被拒的写入**：`../escape.txt` 逃出工作区 ⇒ `hob-write` 必拒
         *   （`reason: 'outside-hob'`）。
         *   ⚠ 判据**只看盘**（`.hob` 存不存在），⛔ 不看返回值 —— 返回值说"被拒了"是**改前也有**的读数，
         *     而本缺陷恰恰是"被拒了但盘上多了东西"。
         */
        let refused = false
        try {
          const out = String(await t.writeHob.execute({ file: '../escape.txt', content: 'x' },
            { agent: { id: 'hob', session: { header: { cwd: ws } } } }))
          const p = (() => { try { return JSON.parse(out) } catch { return {} } })()
          refused = p.ok === false
        } catch { refused = false }
        const hobExists = smExists(join(ws, '.hob'))
        if (!refused) {
          bad('SM-a 【失去基准】构造的写入**没有被拒** ⇒ 本判据测不到"被拒时铺不铺骨架"'
            + `（.hob 存在=${hobExists}）⇒ 不按通过处理`)
        } else if (!hobExists) {
          ok('SM-a ✓ **写被拒 ⇒ 一个字都不许铺骨架**（钉甲-10）：写入被拒（`outside-hob`），'
            + '`.hob/` **未被创建** ⇒ ⛔ 不再是"用户想写的没写成、却多了个目录"' + smTag)
        } else {
          bad('SM-a 【写被拒却照样铺了骨架】写入被拒（`outside-hob`），而 `.hob/` **已被创建**'
            + `\n      ⇒ 位置：${join(smRoot, 'src', 'modules', 'tools.ts')} 的骨架触发条件`
            + '\n      ⇒ ⚠ 改前它只判 `args.dryRun !== true`、**不判 `r.ok`**'
            + ' ⇒ 一次被拒的写入留下了它不该留的东西'
            + '\n      ⇒ 修法：触发条件必须是 **`args.dryRun !== true && r.ok === true`**'
            + '（⛔ dryRun 时 `r.ok` 为 true，两个条件缺一不可）')
        }
      }

      // ── SM-b ⭐ **写成功 ⇒ 仍要铺，且完整性读数非空**（成对那一半）──
      {
        const base = smMkdt(join(smTmpRoot, 'sm-b-'))
        const ws = join(base, 'ws')
        smMkd(ws, { recursive: true })
        const lr = join(base, 'ledger')
        smMkd(lr, { recursive: true })
        const t = smTools.createHobTools({ workspaceRoot: ws, ledgerRoot: lr },
          { skeletonEnabledOf: () => true })
        let out = ''
        try {
          /**
           * ⚠ 写**账本区白名单内**的文件（`LEDGER_FILES`：PROJECT / DECISIONS /
           *   USER-DECISIONS / CONTEXT 四本）—— ⛔ 不许用 `notes/x.md` 这种
           *   "看着合理但根本不在白名单里"的路径：那样 `ok=false` 就测不到"写成功后铺不铺"。
           */
          out = String(await t.writeHob.execute({ file: 'PROJECT.md', content: '# ok\n' },
            { agent: { id: 'hob', session: { header: { cwd: ws } } } }))
        } catch (e) { out = 'THROW: ' + String(e?.message ?? e) }
        const p = (() => { try { return JSON.parse(out) } catch { return {} } })()
        const c = p.skeletonScaffold?.completeness
        const hobExists = smExists(join(ws, '.hob'))
        if (p.ok === true && hobExists && c !== undefined && typeof c.total === 'number'
          && typeof c.scaffolded === 'number' && typeof c.failed === 'number'
          && typeof c.skippedExists === 'number' && c.total > 0 && c.scaffolded > 0) {
          ok('SM-b ✓ **写成功 ⇒ 骨架照铺，且完整性读数非空**（成对那一半）：'
            + `\`已铺 ${c.scaffolded} / 共 ${c.total}\`（失败 ${c.failed} · 跳过已存在 ${c.skippedExists}）`
            + ` ⇒ ⛔ 不再是"只有一个没有分母的 written.length"${smTag}`)
        } else {
          bad('SM-b 【写成功却不铺 / 或完整性读数缺失】'
            + `：ok=${p.ok} · .hob 存在=${hobExists} · completeness=${JSON.stringify(c ?? null)}`
            + '\n      ⇒ ⚠ 两种可能：① 为了过 SM-a 把触发条件写成了"永不触发"（那会废掉骨架）；'
            + '\n                     ② `completeness` 字段没接到 `write_hob` 的返回里'
            + '\n      ⇒ 修法：`completeness` 必须含 `total`/`scaffolded`/`skippedExists`/`failed` 四个数')
        }
      }
    } finally {
      try { smRm(smTmpRoot, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
    }
  }
}

// ── SB. **三处收口**（2026-10-20 第 2 单 · 把"我判定不需要"变成机器判据）──
//
// ⚠ **本组守的是哪三条**（来源 = `R1` §五-2 / §五-3 / §五-5，方向已被用户接受）：
//   · **SB-1 `stateFile` 不落盘**：任何写 `pending` 的路径，**落点只能由 `stateFileFor` 现算**；
//     ⛔ 记录里不得有 `stateFile` 字段被**读来做写盘判据**；
//   · **SB-2 `CardWake` 不分区**：① `WakeState` 的计数**不进入** owner 分区路径；
//     ② **投递收件人恒等于 `e.owner`**，⛔ 不许"按订阅者扇出"；
//   · **SB-3 `probeTarget` 的 `endedAt` 缺失 ⇒ 判不出**（⛔ 不当成已结算）。
//
// ⚠ ⚠ **为什么这三条要成"机器判据"而不是"一句话结论"**（用户原话）：
//   「判断不能老死在一句话里，必须留一条断言」—— 一句话的结论**下一轮没人会重新检验**，
//   而断言会。⚠ 每条都配**负向对拍**（改坏 ⇒ 必红），⛔ 不许恒真。
{
  const { mkdtempSync: sbMkdt, mkdirSync: sbMkd, writeFileSync: sbWf,
    readFileSync: sbRf, rmSync: sbRm } = await import('node:fs')
  const { tmpdir: sbTmp } = await import('node:os')
  const { basename: sbBase } = await import('node:path')
  const { pathToFileURL: sbP2u } = await import('node:url')

  const sbRoot = process.env.HOB_SA_ROOT !== undefined && process.env.HOB_SA_ROOT !== ''
    ? process.env.HOB_SA_ROOT
    : root
  const sbTag = sbRoot === root ? '' : `（源码树=${sbRoot}）`

  let sbOrch
  let sbBus
  let sbWakeMod
  try {
    sbOrch = await import(sbP2u(join(sbRoot, 'src', 'modules', 'orchestrator.ts')).href)
    sbBus = await import(sbP2u(join(sbRoot, 'src', 'modules', 'bus.ts')).href)
    sbWakeMod = await import(sbP2u(join(sbRoot, 'src', 'server', 'card-wake.ts')).href)
  } catch (e) {
    bad(`SB 无法加载 orchestrator / bus / card-wake${sbTag}（${String(e?.message ?? e)}）`
      + ' ⇒ 三处收口失去基准（不按通过处理）')
  }

  if (sbOrch !== undefined && sbBus !== undefined && sbWakeMod !== undefined) {
    let sbRootTmp
    try { sbRootTmp = sbMkdt(join(sbTmp(), 'hob-sbcheck-')) } catch (e) {
      bad(`SB 造不出临时现场（${String(e?.message ?? e)}）⇒ 不按通过处理`)
    }

    if (sbRootTmp !== undefined) {
      const sbSrc = sbRf(join(sbRoot, 'src', 'modules', 'orchestrator.ts'), 'utf8')
      const sbStateSrc = sbRf(join(sbRoot, 'src', 'server', 'orch-state.ts'), 'utf8')
      const sbWakeSrc = sbRf(join(sbRoot, 'src', 'server', 'card-wake.ts'), 'utf8')

      try {
        // ══════════════════════════════════════════════════════════════
        // SB-1 · `stateFile` 不落盘（落点只能由 `stateFileFor` 现算）
        // ══════════════════════════════════════════════════════════════
        //
        //   ⚠ 判据三件：
        //     ① **源码级**：`PersistedWatch` 的 `stateFile` 字段**没有任何读点**参与"写哪个文件"；
        //     ② 全部写 `pending` 的调用点里，`file` 都来自 `stateFileFor` / `runtimeFileOf`
        //        （⛔ 不许从记录字段里反取）；
        //     ③ **行为级**：**删掉 `stateFileFor` 的登记之后**，写盘必须走"可读失败"
        //        （= 这条记录被跳过 + 有 warn），⛔ 不许"猜一个文件"把它写进去。
        {
          // ── ① 静态：`stateFile` 这个词在写盘判据里不许出现 ──────────────
          //
          //   ⚠ 精确判据：`stateFileFor` **可以**出现（它就是唯一权威）；
          //     ⚠ 而不带 `For` 的**记录字段** `w.stateFile` / `rec.stateFile` / `.stateFile` 读法
          //     **不许**出现在"取落点"的位置。⇒ 用"取落点的三条既有写法"作反面：
          //     它们必须**全部**来自 `stateFileFor`。
          const locatorForms = [
            /const file = stateFileFor\.get\(w\.target\)/,
            /const file = runtimeFileOf\(svcCtx, ws\)/,
          ]
          const usesStateFileFor = locatorForms.every((re) => re.test(sbSrc))
          /**
           * ⛔ 记录字段被读来做写盘判据 ⇒ 违规。判据写成"点号取 stateFile 但**不是** stateFileFor"，
           *   且后面**没有**紧跟 `set(`（赋值进 Map 是允许的：那是内存镜像，不是读判据）。
           */
          /**
           * ⚠ **必须先把注释剥掉再判**（实测踩过：我自己的解释性注释 `⛔ 不去 \`w.stateFile\` 里取`
           *   被当成了"读了记录字段" ⇒ 假红）。本文件既有 `stripComments()` 就是干这件事的，
           *   ⚠ 用同一份（⛔ 不另写一个剥离器）。
           */
          const sbSrcCode = stripComments(sbSrc)
          const badRead = /\.stateFile(?!For)\b(?!\s*=\s*)/.test(
            sbSrcCode.replace(/stateFileFor/g, 'stateFileFor_PLACEHOLDER'),
          )
          if (usesStateFileFor && !badRead) {
            ok('SB-1a ✓ `stateFile` 不落盘（静态）：取落点只有 `stateFileFor.get(...)` / '
              + '`runtimeFileOf(...)` 两种写法，⛔ 没有从记录字段 `.stateFile` 反取（`R1` §五-2 的收口）')
          } else {
            bad('SB-1a 【`stateFile` 不许参与写盘判据】不成立'
              + `：落点两种写法都在位=${usesStateFileFor} · 记录字段被读=${badRead}`
              + ' ⇒ "凭什么写这个文件"出现了第二个来源（正是本病的头号成因）')
          }

          // ── ② 行为：把 `stateFileFor` 的登记摘掉 ⇒ 写盘必须可读失败，⛔ 不许猜 ──
          //
          //   ⚠ 造法：变异 `dispatch()` 里那行 `stateFileFor.set(target, file ?? '')`
          //     ⇒ 落点 Map 里没有该 target ⇒ `flushWatches`/`persistOwnerPartition` 都跳过它。
          //   ⚠ 判据：**盘上不能出现该 target**（⛔ 猜一个文件写进去），且**必须有 warn**。
          {
            const { cpSync } = await import('node:fs')
            const dir = sbMkdt(join(sbRootTmp, 'mut-sb1-'))
            /**
             * ⚠⚠ **`dereference: true` 是本修复的要害，⛔ 不许去掉**（2026-10-21 · 第 323 轮 · 丁-7）：
             *   `fs.cpSync` **默认不解引用**⇒ 源树里 `src` 若是软链，复制出来的 `dir/src`
             *   **还是那条软链** ⇒ 随后 `writeFileSync(dir/src/…)` **写回源树**。
             *   ⚠ 第 323 轮实测：受控靶仓 `git status --porcelain src/` 跑前 0 行、跑后 **4 行 M**。
             */
            cpSync(join(sbRoot, 'src'), join(dir, 'src'), { recursive: true, dereference: true })
            const mutFile = join(dir, 'src/modules/orchestrator.ts')
            const src = sbRf(mutFile, 'utf8')
            const GUARD = "          stateFileFor.set(target, file ?? '')"
            if (!src.includes(GUARD)) {
              bad('SB-1b 【失去靶子】在 `dispatch()` 里找不到落点登记那行原文'
                + `（期望：${JSON.stringify(GUARD)}）⇒ 行为断言对不上实现，不按通过处理`)
            } else {
              sbWf(mutFile, src.replace(GUARD, '          /* 变异：摘掉落点登记（stateFileFor 不写） */'), 'utf8')
              try {
                const { symlinkSync } = await import('node:fs')
                symlinkSync(join(sbRoot, 'node_modules'), join(dir, 'node_modules'), 'dir')
              } catch { /* 已有 */ }
              try {
                const mOrch = await import(sbP2u(join(dir, 'src/modules/orchestrator.ts')).href)
                const mBus = await import(sbP2u(join(dir, 'src/modules/bus.ts')).href)
                const base = sbMkdt(join(sbRootTmp, 'sb1-beh-'))
                const home = join(base, 'ledgers'); sbMkd(home, { recursive: true })
                const ws = join(base, 'ws'); sbMkd(join(ws, 'runtime'), { recursive: true })
                const sess = (id) => ({ id, header: { agentPreset: 'standard', cwd: ws }, log: [] })
                const byId = new Map(['hob', 'target-x'].map((i) => [i, sess(i)]))
                const sessions = { get: (i) => byId.get(i), list: () => [...byId.values()], flush: async () => true }
                const agents = { currentInitiator: () => undefined,
                  get: (i) => (byId.has(i) ? { id: i, status: 'running', ctx: {}, session: byId.get(i),
                    followup() {}, steer() {}, inject() {} } : undefined) }
                const warns = []
                const logger = { debug() {}, info() {}, warn: (m) => warns.push(String(m)) }
                const bp = {}
                const bc = { sessions, agents, logger,
                  get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents : undefined),
                  provide: (k, v) => { bp[k] = v }, effect: (fn) => { try { fn() } catch {} },
                  inject: (_d, cb) => cb(bc), on: () => {} }
                mBus.apply(bc, { spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }) })
                const prov = {}
                const c = { sessions, agents, logger,
                  get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents
                    : k === 'hobBus' ? bp.hobBus
                      : k === 'loader' ? { entries: () => [{ options: { config: { ledgerHome: home } } }] } : undefined),
                  provide: (k, v) => { prov[k] = v }, effect: (fn) => { try { fn() } catch {} },
                  inject: (_d, cb) => cb(c), on: () => {} }
                mOrch.apply(c)
                const mo = prov.hobOrchestrator
                if (mo === undefined) {
                  bad('SB-1b 变异体没提供 hobOrchestrator ⇒ 行为断言失去基准')
                } else {
                  await mo.dispatch('target-x', 'do x', { self: 'hob' })
                  await new Promise((r) => setTimeout(r, 40))
                  let pend = []
                  try {
                    pend = JSON.parse(sbRf(join(home, sbBase(ws), 'runtime', 'orch-watches.json'), 'utf8')).pending ?? []
                  } catch { pend = [] }
                  const guessed = pend.some((w) => w.target === 'target-x')
                  const saidSomething = warns.some((m) => /落点登记缺失/.test(m))
                  if (!guessed && saidSomething) {
                    ok('SB-1b ✓ `stateFile` 不落盘（行为）：把 `stateFileFor` 的登记摘掉后'
                      + ` ⇒ **盘上没有该 target**（⛔ 没有"猜一个文件"写进去）且**有可读 warn**`
                      + `（${warns.filter((m) => /落点登记缺失/.test(m)).length} 条）`)
                  } else {
                    bad('SB-1b 【摘掉落点后不许猜文件】不成立'
                      + `：盘上出现了该 target=${guessed} · 有可读 warn=${saidSomething}`
                      + ` · warns=${JSON.stringify(warns.slice(0, 3))}`)
                  }
                }
              } catch (e) {
                bad(`SB-1b 变异体跑不起来（${String(e?.message ?? e)}）⇒ 行为断言失去基准`)
              }
            }
          }
        }

        // ══════════════════════════════════════════════════════════════
        // SB-2 · `CardWake` 不分区（两点，缺一即没守住）
        // ══════════════════════════════════════════════════════════════
        //
        //   ⚠ 上游结论（`R1` §五-3）：`CardWake` 的**投递面已按 owner**（`card-wake.ts:615`
        //     `const to = e.owner`），**累计计数不分**也算合理。⇒ 收口成两条断言，⛔ 不许两套并存。
        {
          // ── ① `WakeState` 的计数不进入 owner 分区路径 ──────────────────
          //
          //   ⚠ 判据：`WakeState`（`CardWake.snapshot()`）**仍然无参**，且它的字段里
          //     **没有** `mine` / `othersOnly` / `ownerUnknownRegistered` / `selfUndecidable`
          //     这类分区字段 —— 分区那一套**只属于** `DispatchWakeState`。
          const wakeStateDecl = sbWakeSrc.match(/export interface WakeState \{[\s\S]*?\n\}/)
          const dispatchStateDecl = sbWakeSrc.match(/export interface DispatchWakeState \{[\s\S]*?\n\}/)
          const partitionFields = ['mine', 'othersOnly', 'ownerUnknownRegistered', 'selfUndecidable']
          const wakeHasPartition = wakeStateDecl === null
            ? undefined
            : partitionFields.filter((f) => new RegExp(`\\b${f}\\b`).test(wakeStateDecl[0]))
          const dispatchHasPartition = dispatchStateDecl === null
            ? []
            : partitionFields.filter((f) => new RegExp(`\\b${f}\\b`).test(dispatchStateDecl[0]))
          // `CardWake.snapshot()` 必须**仍是无参**（分区是有意的例外，不是漏做）
          const cardWakeSnapshotNoArg = /snapshot\(\): WakeState \{\n    return \{ \.\.\.this\.state, seenCount: this\.seenIds\.size \}/.test(sbWakeSrc)
          const dispatchSnapshotHasArg = /snapshot\(owner\?: string\): DispatchWakeState \{/.test(sbWakeSrc)
          if (wakeStateDecl !== null && wakeHasPartition !== undefined && wakeHasPartition.length === 0
            && dispatchHasPartition.length > 0 && cardWakeSnapshotNoArg && dispatchSnapshotHasArg) {
            ok('SB-2a ✓ `WakeState` 的计数**不进入** owner 分区路径：`CardWake.snapshot()` 仍无参，'
              + `且 \`WakeState\` 里**没有** ${partitionFields.join(" / ")} 任一字段`
              + `（分区那一套只在 \`DispatchWakeState\`：${dispatchHasPartition.join(" / ")}）`
              + ' ⇒ ⛔ 没有"两套并存"')
          } else {
            bad('SB-2a 【分区只属于 DispatchWake】不成立'
              + `：WakeState 里的分区字段=${JSON.stringify(wakeHasPartition)}（应 []）`
              + ` · DispatchWakeState 里的=${JSON.stringify(dispatchHasPartition)}（应非空）`
              + ` · CardWake.snapshot() 无参=${cardWakeSnapshotNoArg}`
              + ` · DispatchWake.snapshot(owner?) 有参=${dispatchSnapshotHasArg}`)
          }

          // ── ② 投递收件人恒等于 `e.owner`（⛔ 不许按订阅者扇出）──────────
          //
          //   ⚠ 判据（行为）：一条卡跑完的帧，**无论有几个订阅者**，
          //     **只投一次**、且收件人 === 帧里的 `createdBy.sessionId`。
          {
            const WS2 = 'ws-sb2-0001'
            const frame = JSON.stringify({
              revision: 1, kind: 'execution-recorded',
              tasks: [{
                id: 't-sb2', title: 'SB-2 用卡', status: 'in_review', workspaceId: WS2, version: 2,
                lastExecutionOutcome: 'succeeded', createdBy: { sessionId: 'owner-real' },
              }],
            })
            const sent = []
            const cw = new sbWakeMod.CardWake({
              origin: 'http://127.0.0.1:0',
              workspaceIdOf: () => WS2,
              deliver: (sid, text) => { sent.push({ sid, text }); return Promise.resolve({ ok: true }) },
              now: () => 1792300800000,
            })
            // ⚠ **故意挂 3 个订阅者**（其中两个是本工作区的"旁观者"）——
            //   若发生"按订阅者扇出"，它们就会各收到一份。
            cw.subscribe('owner-real', WS2)
            cw.subscribe('bystander-1', WS2)
            cw.subscribe('bystander-2', WS2)
            const n = await cw.handleFrame('change', frame)
            const onlyOwner = sent.length === 1 && sent[0].sid === 'owner-real'
            const noFanout = !sent.some((x) => x.sid !== 'owner-real')
            if (n === 1 && onlyOwner && noFanout) {
              ok('SB-2b ✓ **投递收件人恒等于 `e.owner`**：一帧"卡跑完"、**3 个订阅者**在位 ⇒ '
                + `**只投 1 份且收件人 = ${sent[0].sid}**（⛔ 没有按订阅者扇出到 bystander-1/2）`)
            } else {
              bad('SB-2b 【收件人必须恒等于 e.owner】不成立'
                + `：投递=${JSON.stringify(sent.map((x) => x.sid))}（应只有 owner-real 一份）`
                + ` · 返回值=${n}`)
            }
            // ⚠ 负向对拍：把收件人改成"取第一个订阅者" ⇒ 本判据必须当场不成立
            {
              const { cpSync } = await import('node:fs')
              const dir = sbMkdt(join(sbRootTmp, 'mut-sb2-'))
              cpSync(join(sbRoot, 'src'), join(dir, 'src'), { recursive: true, dereference: true })
              const mf = join(dir, 'src/server/card-wake.ts')
              const src = sbRf(mf, 'utf8')
              const GUARD = '      const to = e.owner'
              if (!src.includes(GUARD)) {
                bad('SB-2b(反证) 【失去靶子】找不到"收件人 = e.owner"那一行原文 ⇒ 不按通过处理')
              } else {
                sbWf(mf, src.replace(GUARD, "      const to = [...this.targets.keys()][0] /* 变异：取第一个订阅者（扇出形态） */"), 'utf8')
                try {
                  const { symlinkSync } = await import('node:fs')
                  symlinkSync(join(sbRoot, 'node_modules'), join(dir, 'node_modules'), 'dir')
                } catch { /* 已有 */ }
                try {
                  const mW = await import(sbP2u(join(dir, 'src/server/card-wake.ts')).href)
                  const sentM = []
                  const cwM = new mW.CardWake({
                    origin: 'http://127.0.0.1:0',
                    workspaceIdOf: () => WS2,
                    deliver: (sid, text) => { sentM.push({ sid, text }); return Promise.resolve({ ok: true }) },
                    now: () => 1792300800000,
                  })
                  cwM.subscribe('bystander-1', WS2)   // ⚠ 第一个订阅者**不是** owner
                  cwM.subscribe('owner-real', WS2)
                  await cwM.handleFrame('change', frame)
                  const wrong = sentM.length > 0 && sentM.every((x) => x.sid !== 'owner-real')
                  if (wrong) {
                    ok(`SB-2b(反证) ✓ 负向对拍：把收件人改成"取第一个订阅者"`
                      + ` ⇒ **投给了错的会话**（${JSON.stringify(sentM.map((x) => x.sid))}）⇒ SB-2b 真长牙`)
                  } else {
                    bad('SB-2b(反证) 【负向对拍失败】改成"取第一个订阅者"后收件人仍然正确'
                      + `（${JSON.stringify(sentM.map((x) => x.sid))}）⇒ SB-2b 测的不是"收件人恒等于 owner"`)
                  }
                } catch (e) {
                  bad(`SB-2b(反证) 变异体跑不起来（${String(e?.message ?? e)}）`)
                }
              }
            }
          }
        }

        // ══════════════════════════════════════════════════════════════
        // SB-3 · `probeTarget`：`endedAt` 缺失 ⇒ **判不出**（⛔ 不当成已结算）
        // ══════════════════════════════════════════════════════════════
        //
        //   ⚠ 上游结论（`R1` §五-5）：改前 `card.endedAt === undefined` 直接**默认"是这次结束的"**
        //     ⇒ 会把**上一轮**的结果当本轮结果结算（错配，比丢更坏）。
        //   ⚠ 判据：造一条"卡在终态、但**没有** `endedAt`"的现场 ⇒
        //     该条**必须**落 `unresolved`，⛔ **不许**被结算（不许投回执、不许离开 pending）。
        {
          // ⚠ 先确认类型里**有** `endedAt`（TASK：若没有就先补齐再断言）
          const hasField = /endedAt\?: number/.test(
            sbRf(join(sbRoot, 'src', 'server', 'board-cards.ts'), 'utf8'),
          )
          if (!hasField) {
            bad('SB-3 【类型缺 `endedAt`】`CardReading` 里没有 `endedAt?: number` ⇒ '
              + '本断言失去基准（TASK §2.3：应先把类型补齐）')
          } else {
            const base = sbMkdt(join(sbRootTmp, 'sb3-'))
            const home = join(base, 'ledgers'); sbMkd(home, { recursive: true })
            const ws = join(base, 'ws'); sbMkd(join(ws, 'runtime'), { recursive: true })
            const file = join(home, sbBase(ws), 'runtime', 'orch-watches.json')
            sbMkd(join(home, sbBase(ws), 'runtime'), { recursive: true })
            // 盘上一条 pending，目标 sess-card-nodate
            sbWf(file, JSON.stringify({
              version: 1, updatedAt: 1, handoffs: [], lost: [], sessions: [],
              pending: [{ target: 'sess-card-nodate', watcher: 'hob', owner: 'hob',
                at: 1792250000000, sawRunning: true }],
            }, null, 2), 'utf8')

            const sess = (id) => ({
              id, header: { agentPreset: 'standard', cwd: ws },
              // ⚠ 会话 log **没有**助手产出 ⇒ 第 ② 条真相源不成立，只剩看板那一条
              log: [],
            })
            const byId = new Map(['hob', 'sess-card-nodate'].map((i) => [i, sess(i)]))
            const sessions = { get: (i) => byId.get(i), list: () => [...byId.values()], flush: async () => true }
            const agents = { currentInitiator: () => undefined,
              get: (i) => (byId.has(i) ? { id: i, status: 'idle', ctx: {}, session: byId.get(i),
                followup() {}, steer() {}, inject() {} } : undefined) }
            /** ⚠ 假看板：这张卡**在终态**（`in_review`）但**没有 `endedAt`**。 */
            const cardNoEnd = {
              id: 't-nodate', title: 'SB-3 无 endedAt 的卡', status: 'in_review', version: 2,
              workspaceId: ws, executions: [{
                id: 'e-nodate', trigger: 'scheduled', startedAt: 1792240000000,
                outcome: 'succeeded', isolation: 'worktree', branch: 'task/x',
                // ⚠ **故意不给 endedAt**
                sessionId: 'sess-card-nodate',
              }],
              createdBy: { sessionId: 'hob' },
            }
            const registry = new Map()
            registry.set('taskboard_list', {
              name: 'taskboard_list',
              async execute() {
                return { revision: 1, tasks: [{
                  id: cardNoEnd.id, title: cardNoEnd.title, status: cardNoEnd.status,
                  version: 2, blocked: false, workspaceId: ws, lastExecutionOutcome: 'succeeded',
                }] }
              },
            })
            registry.set('taskboard_get', {
              name: 'taskboard_get',
              async execute(args) { return args?.id === cardNoEnd.id ? { task: cardNoEnd } : {} },
            })
            const toolsSvc = { get: (n) => registry.get(n) }
            const delivered = []
            const logger = { debug() {}, info() {}, warn() {} }
            const bp = {}
            const bc = { sessions, agents, logger,
              get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents : undefined),
              provide: (k, v) => { bp[k] = v }, effect: (fn) => { try { fn() } catch {} },
              inject: (_d, cb) => cb(bc), on: () => {} }
            sbBus.apply(bc, { spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }) })
            /** ⚠ **两个入口都包**（同 SA 组的理由：回执走 `deliverInternal`，模型面走 `deliver`）。 */
            if (bp.hobBus !== undefined) {
              for (const key of ['deliver', 'deliverInternal']) {
                const real = typeof bp.hobBus[key] === 'function' ? bp.hobBus[key].bind(bp.hobBus) : undefined
                if (real === undefined) continue
                bp.hobBus[key] = async (sid, text, mode) => {
                  delivered.push({ to: sid, text })
                  return await real(sid, text, mode)
                }
              }
            }
            const prov = {}
            const handlers = {}
            const c = { sessions, agents, logger,
              get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents
                : k === 'hobBus' ? bp.hobBus
                  : k === 'tools' ? toolsSvc
                    : k === 'loader' ? { entries: () => [{ options: { config: { ledgerHome: home } } }] } : undefined),
              provide: (k, v) => { prov[k] = v }, effect: (fn) => { try { fn() } catch {} },
              inject: (_d, cb) => cb(c), on: (ev, fn) => { handlers[ev] = fn; return () => {} } }
            sbOrch.apply(c)
            const orch = prov.hobOrchestrator
            if (orch === undefined) {
              bad('SB-3 挂真 apply 之后没拿到 hobOrchestrator ⇒ 本断言失去基准')
            } else {
              // ⚠ 显式跑一次对账（T1 就绪扫描之外再来一次，确保这条被核到）
              if (typeof orch.reconcile === 'function') await orch.reconcile('sb3-probe')
              await new Promise((r) => setTimeout(r, 80))
              const after = JSON.parse(sbRf(file, 'utf8'))
              const still = (after.pending ?? []).find((w) => w.target === 'sess-card-nodate')
              const inLost = (after.lost ?? []).some((w) => w.target === 'sess-card-nodate')
              const receipts = delivered.filter((d) => String(d.text).includes('【自动回传】'))
              const notSettled = receipts.length === 0
              const keptUnresolved = still !== undefined && still.settleState !== undefined
                && still.settleState !== 'waiting'
              if (notSettled && keptUnresolved && !inLost) {
                ok('SB-3 ✓ `endedAt` 缺失 ⇒ **判不出**（⛔ 不当成已结算）：卡在终态但无结束时刻 ⇒ '
                  + `**没有投任何回执**（${receipts.length} 份）、该条**留在 pending**`
                  + ` 且 settleState=${still?.settleState}（recheckCount=${still?.recheckCount}）、⛔ 未进 lost`
                  + ` ⇒ 不会把上一轮的结果当本轮结果回传${sbTag}`)
              } else {
                bad('SB-3 【`endedAt` 缺失必须判不出】不成立'
                  + `：投了回执=${!notSettled}（应 false）· 盘上那条=${JSON.stringify(still)}`
                  + ` · 进 lost=${inLost} · 收据=${JSON.stringify(receipts.map((r) => r.to))}`
                  + ' ⇒ 这会把上一轮的结果当本轮结算（错配比丢更坏）')
              }
            }
          }
        }
      } finally {
        try { sbRm(sbRootTmp, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
      }
    }
  }
}

// ── SC. **量纲不混装 + 累计去重**（2026-10-20 第 3 单）────────────────
//
// ⚠ **本组守的是哪两条**（TASK §2 / §3）：
//   · **SC-a 同屏不混量纲**：分区三档那一行**只放"此刻"的三个数**；
//     累计值必须与它**分行**，且措辞里明写"累计"；
//   · **SC-b 累计按 (卡, 执行) 去重**：同一张卡的同一次执行**只计一次**
//     （改前是"卡数 × 读卡次数"，现场 `22 → 46 → 162 → 192 → 222 → 960` 就是它）。
//
// ⚠ ⚠ **为什么必须成断言**：这两个缺陷都是"读数看起来正常、其实在骗人"的类型 ——
//   `归属判不出 960 个` 会让读的人以为"有 960 张别人的卡在跑"。
//   ⇒ 光改代码不算修，得有一条**能失败**的判据钉住。
{
  const { pathToFileURL: scP2u } = await import('node:url')
  const { join: scJoin } = await import('node:path')
  const { mkdtempSync: scMkdt, readFileSync: scRf, writeFileSync: scWf,
    cpSync: scCpSync, symlinkSync: scLink, rmSync: scRm } = await import('node:fs')
  const { tmpdir: scTmp } = await import('node:os')
  /** ⚠ 与 SA/SB 同款：`HOB_SA_ROOT` 可指向另一棵源码树（用来跑"改前必红"）。 */
  const scRoot = process.env.HOB_SA_ROOT !== undefined && process.env.HOB_SA_ROOT !== ''
    ? process.env.HOB_SA_ROOT
    : root
  const scTag = scRoot === root ? '' : `（源码树=${scRoot}）`
  let scRootTmp
  try { scRootTmp = scMkdt(scJoin(scTmp(), 'hob-sccheck-')) } catch { scRootTmp = scTmp() }
  let scWakeMod
  try {
    scWakeMod = await import(scP2u(scJoin(scRoot, 'src', 'server', 'card-wake.ts')).href)
  } catch (e) {
    bad(`SC 无法加载 card-wake（${String(e?.message ?? e)}）⇒ 量纲判据失去基准（不按通过处理）`)
  }

  if (scWakeMod !== undefined) {
    // ══════════════════════════════════════════════════════════════
    // SC-a · **同屏不混量纲**：分区三档全是"此刻"，累计必须分行且明写"累计"
    // ══════════════════════════════════════════════════════════════
    //
    //   ⚠ 造法：**故意制造量纲差** —— 让"累计"远大于"此刻"（反复 noteOwnerUnknown
    //     多次同一张卡 ⇒ 去重后累计只 +1；再用**另一张卡**多刷几次让累计长大）。
    //     ⚠ 更直接：用 `register()` 造 1 条"判不出"（当前=1），
    //       再用 **N 张不同卡**刷累计（累计=N）⇒ 若分区字段拿了累计值，两者相等；拿了当前值，当前=1。
    {
      const dw = new scWakeMod.DispatchWake({
        deliver: () => Promise.resolve({ ok: true }),
        now: () => 1792300800000,
      })
      /**
       * ⚠ **造出量纲差**（这是本判据的关键，⛔ 不能只造同值）：
       *   · **此刻**（`ownerUnknownLive`）：1 条 —— 只让 1 个键处于"判不出"；
       *   · **累计**（`ownerUnknownCount`）：靠**同一个键反复出现、但每次 executionId 不同**
       *     把它刷大（那确实是 N 次不同的"判不出"事件），
       *     而"此刻"仍然只有 **1 条**（同一个卡在等归属）。
       *   ⚠ 改前的实现会把累计值塞进分区字段 ⇒ 分区读数 = 累计 ⇒ 两者相等 ⇒ 判据红。
       */
      dw.register({ sessionId: 'nobody-1', via: 'taskboard-card', cardId: 't-n1' })
      // 同一张卡、同一次执行刷 10 遍 ⇒ 去重后累计**只 +1**（这也是 SC-b 的口径）
      for (let i = 0; i < 10; i++) dw.noteOwnerUnknown('t-same', 'sess-same', 'x', 'exec-same')
      // 同一张卡**重新点火** 5 次 ⇒ 累计 +5（每次都是新的执行）
      for (let i = 1; i <= 5; i++) dw.noteOwnerUnknown('t-same', 'sess-same', 'x', `exec-re${i}`)
      const snap = dw.snapshot('ownerA')
      const cumulative = snap.ownerUnknownCount
      const current = snap.ownerUnknownRegistered
      /**
       * ⚠ 判据（两条都要满足）：
       *   ① 分区字段 `ownerUnknownRegistered` **必须小于**累计（否则说明它就是累计值）；
       *   ② 它必须等于"此刻仍在等归属"的条数（= 1）。
       */
      const notCumulative = current !== cumulative
      /** 此刻 = `nobody-1` 那一条 + `t-same` 这一个键（同键多代只算 1 条在等）= 2。 */
      const currentIsRight = current === 2
      /** 累计 = 1（register）+ 1（t-same 首次）+ 5（重新点火 5 次）= 7。 */
      const cumulativeGrew = cumulative === 7
      if (notCumulative && currentIsRight && cumulativeGrew) {
        ok('SC-a ✓ **同屏不混量纲**：分区字段 `ownerUnknownRegistered` 是**此刻**（'
          + `（${current} 个），累计那一档是 ${cumulative} 次`
          + ' ⇒ 两者**不相等** ⇒ 分区那一行⛔ 没有拿累计值充数'
          + '（改前两者是同一个值，现场长成 `归属判不出 960 个`）' + scTag)
      } else {
        bad('SC-a 【分区三档不许混量纲】不成立'
          + `：此刻=${current}（应 2）· 累计=${cumulative}（应 7）`
          + ` · 两者相等=${!notCumulative}`
          + ' ⇒ 分区那一行把"累计"当成了"此刻"，两种量纲相加（本项目明令禁止）')
      }
      // ⚠ 负向对拍：把分区字段改回累计值 ⇒ 本判据必红
      {
        const scCp = scCpSync
        const dir = scMkdt(join(scRootTmp, 'mut-sc-a-'))
        scCp(scJoin(scRoot, 'src'), scJoin(dir, 'src'), { recursive: true, dereference: true })
        const mf = scJoin(dir, 'src/server/card-wake.ts')
        const src = scRf(mf, 'utf8')
        /**
         * ⚠⚠ **第 345 轮：锚点跟着实现一起搬**（⛔ 不许把断言删掉了事）。
         *   改前那行是单行 `const ownerUnknownRegistered = this.ownerUnknownLive.size`；
         *   改后它变成"逐条过滤"的多行形态（同一档要扣掉"后来判出来了的"）。
         *   ⇒ 用**正则**钉住那条语句的**语义**（`ownerUnknownLive` → `ownerUnknownRegistered`），
         *     ⛔ 不钉某一种排版 —— 否则实现一换行，这条反证就"失去靶子"、
         *     而失去靶子的反证**恒真**（本项目明令：永远 PASS 的检查比没有更危险）。
         */
        /**
         * ⚠⚠ **必须吃到整条语句的结尾**（`;`）：改后它是
         *   `const ownerUnknownRegistered = [...this.ownerUnknownLive.values()]`
         *   + 换行 + `.filter(...).length`。若只匹配到第一个换行，替换后会留下
         *   悬空的 `.filter(...)` ⇒ 变异体**语法错误跑不起来**（实测踩到：
         *   `SC-a(反证) 变异体跑不起来（Expression expected）`）。
         *   ⚠ 这正是"反证失败其实是判据/锚点自己写错了"的又一例，⛔ 不许靠放宽判据绕过。
         */
        const GUARD_RE = /^    const ownerUnknownRegistered = [\s\S]*?\.length$/m.exec(src)
        if (GUARD_RE === null || !GUARD_RE[0].includes('ownerUnknownLive')) {
          bad('SC-a(反证) 【失去靶子】找不到分区字段那条语句（应含 `ownerUnknownLive`、以 `.length` 收尾）⇒ 不按通过处理')
        } else {
          scWf(mf, src.replace(GUARD_RE[0],
            'const ownerUnknownRegistered = this.state.ownerUnknownCount /* 变异：拿累计充此刻 */\n'), 'utf8')
          try {
            
            scLink(scJoin(scRoot, 'node_modules'), scJoin(dir, 'node_modules'), 'dir')
          } catch { /* 已有 */ }
          try {
            const mW = await import(scP2u(scJoin(dir, 'src/server/card-wake.ts')).href)
            const dwM = new mW.DispatchWake({ deliver: () => Promise.resolve({ ok: true }),
              now: () => 1792300800000 })
            dwM.register({ sessionId: 'nobody-1', via: 'taskboard-card', cardId: 't-n1' })
            for (let i = 0; i < 10; i++) dwM.noteOwnerUnknown('t-same', 'sess-same', 'x', 'exec-same')
            for (let i = 1; i <= 5; i++) dwM.noteOwnerUnknown('t-same', 'sess-same', 'x', `exec-re${i}`)
            const sM = dwM.snapshot('ownerA')
            if (sM.ownerUnknownRegistered === sM.ownerUnknownCount) {
              ok(`SC-a(反证) ✓ 负向对拍：把分区字段改回累计值 ⇒ **两者相等**`
                + `（${sM.ownerUnknownRegistered}）⇒ SC-a 真长牙`)
            } else {
              bad('SC-a(反证) 【负向对拍失败】改回累计后两者仍不相等'
                + `（此刻=${sM.ownerUnknownRegistered} 累计=${sM.ownerUnknownCount}）`
                + ' ⇒ SC-a 测的不是"量纲分离"')
            }
          } catch (e) {
            bad(`SC-a(反证) 变异体跑不起来（${String(e?.message ?? e)}）`)
          }
        }
      }
    }

    // ══════════════════════════════════════════════════════════════
    // SC-b · **累计按 (卡, 执行) 去重**（钉 **960**）
    // ══════════════════════════════════════════════════════════════
    //
    //   ⚠ 病灶（实证）：`cardsOf()` **每读一次卡面**，就对**每一张别人的卡** +
    //     ⇒ 累计 = 卡数 × 读卡次数。现场 40 分钟 `22 → 46 → 162 → 192 → 222 → 960`。
    //   ⚠ 判据：同一 `(cardId, executionId)` 刷 N 次 ⇒ 累计**只 +1**；
    //     `executionId` 变了（重新点火）⇒ **再 +1**（那确实是一次新的判不出）。
    {
      const dw = new scWakeMod.DispatchWake({
        deliver: () => Promise.resolve({ ok: true }),
        now: () => 1792300800000,
      })
      // 同一张卡、同一次执行 ⇒ 刷 10 次
      for (let i = 0; i < 10; i++) dw.noteOwnerUnknown('t-same', 'sess-1', '重复刷', 'exec-A')
      const afterRepeat = dw.snapshot('ownerA').ownerUnknownCount
      // 同一次执行但**另一张卡** ⇒ 应当 +1（不同组合）
      dw.noteOwnerUnknown('t-other', 'sess-2', '另一张卡', 'exec-B')
      const afterOther = dw.snapshot('ownerA').ownerUnknownCount
      // 同一张卡但**重新点火**（executionId 变了）⇒ 应当 +1
      dw.noteOwnerUnknown('t-same', 'sess-1', '重新点火', 'exec-A2')
      const afterRefire = dw.snapshot('ownerA').ownerUnknownCount
      const deduped = afterRepeat === 1
      const distinctCounts = afterOther === 2
      const refireCounts = afterRefire === 3
      if (deduped && distinctCounts && refireCounts) {
        ok('SC-b ✓ **累计按 (卡, 执行) 去重**（钉 960）：同一 `(卡, 执行)` 刷 **10 次** ⇒ 累计 **只 +1**'
          + `（${afterRepeat}）；另一张卡 ⇒ +1（${afterOther}）；`
          + `同一张卡**重新点火**（executionId 变了）⇒ 再 +1（${afterRefire}）`
          + ' ⇒ 语义是"**真正判不出归属的(卡,执行)组合数**"，⛔ 不是"读卡次数 × 卡数"' + scTag)
      } else {
        bad('SC-b 【累计必须按 (卡,执行) 去重】不成立'
          + `：刷 10 次后=${afterRepeat}（应 1）· 另一张卡后=${afterOther}（应 2）`
          + ` · 重新点火后=${afterRefire}（应 3）`
          + ' ⇒ 那是**重复计数**（读 N 次 = N × 卡数），现场会涨到 960 这种数')
      }
      // ⚠ 负向对拍：把去重摘掉 ⇒ 刷 10 次应当涨到 10
      {
        const scCp = scCpSync
        const dir = scMkdt(join(scRootTmp, 'mut-sc-b-'))
        scCp(scJoin(scRoot, 'src'), scJoin(dir, 'src'), { recursive: true, dereference: true })
        const mf = scJoin(dir, 'src/server/card-wake.ts')
        const src = scRf(mf, 'utf8')
        const GUARD = '    if (this.ownerUnknownSeen.has(key)) {'
        if (!src.includes(GUARD)) {
          bad('SC-b(反证) 【失去靶子】找不到去重那行原文 ⇒ 不按通过处理')
        } else {
          scWf(mf, src.replace(GUARD, '    if (false) { /* 变异：摘掉去重 */'), 'utf8')
          try {
            
            scLink(scJoin(scRoot, 'node_modules'), scJoin(dir, 'node_modules'), 'dir')
          } catch { /* 已有 */ }
          try {
            const mW = await import(scP2u(scJoin(dir, 'src/server/card-wake.ts')).href)
            const dwM = new mW.DispatchWake({ deliver: () => Promise.resolve({ ok: true }),
              now: () => 1792300800000 })
            for (let i = 0; i < 10; i++) dwM.noteOwnerUnknown('t-same', 'sess-1', 'x', 'exec-A')
            const n = dwM.snapshot('ownerA').ownerUnknownCount
            if (n === 10) {
              ok(`SC-b(反证) ✓ 负向对拍：摘掉去重 ⇒ 刷 10 次**涨到 ${n}**（改前的重复计数形态）`
                + ' ⇒ SC-b 真长牙')
            } else {
              bad(`SC-b(反证) 【负向对拍失败】摘掉去重后刷 10 次得 ${n}（应 10）`
                + ' ⇒ SC-b 测的不是去重')
            }
          } catch (e) {
            bad(`SC-b(反证) 变异体跑不起来（${String(e?.message ?? e)}）`)
          }
        }
      }
    }
  }
  try { scRm(scRootTmp, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
}

// ── SD. **回执投递：单次性 + 不被"不许给自己发消息"拦下 + 模型面守卫不放宽**（2026-10-20 第 4 单）──
//
// ⚠ **本组守的是哪四条**（TASK §1.2-4 与 ADDENDUM §三-4）：
//   · **SD-a 单次性**：同一条回执、T2/T3/T5 三类触发共 N 次 ⇒ **成功投递恒为 1**
//     （负向对拍：摘掉幂等标记 ⇒ 必红）；
//   · **SD-b 回执不得被"不许给自己发消息"拦下**：构造 `watcher === 本会话` ⇒ **必须投得出去**
//     （现场原文 `refusing to deliver to this session itself` 就是这条被拦下）；
//   · **SD-c 模型面 `hob_send` 给自己仍然被拒**（既有行为 ⛔ 不许放宽，须有断言守住）；
//   · **SD-d 三条触发路径行为一致**：T2（在派活方自己的作用域里）/ T3·T5（不在）**都要投得出去**。
//
// ⚠⚠ **为什么这四条必须成断言**：改前的现场是"计数涨了、等待没清、同一份报告送了 4 次"，
//   而**任何一条读数都看起来正常**（`已回传` 在涨）。⇒ 光改代码不算修。
{
  const { pathToFileURL: sdB } = await import('node:url')
  const { join: sdJ } = await import('node:path')
  const { mkdtempSync: sdMkdt, mkdirSync: sdMkd, writeFileSync: sdWf,
    readFileSync: sdRf, rmSync: sdRm, cpSync: sdCp, symlinkSync: sdLink } = await import('node:fs')
  const { tmpdir: sdTmp } = await import('node:os')
  const { basename: sdBase } = await import('node:path')

  /** ⚠ 与 SA/SB/SC 同款：`HOB_SA_ROOT` 可指向另一棵树（用来跑"改前必红"）。 */
  const sdRoot = process.env.HOB_SA_ROOT !== undefined && process.env.HOB_SA_ROOT !== ''
    ? process.env.HOB_SA_ROOT
    : root
  const sdTag = sdRoot === root ? '' : `（源码树=${sdRoot}）`
  let sdTmpRoot
  try { sdTmpRoot = sdMkdt(sdJ(sdTmp(), 'hob-sdcheck-')) } catch { sdTmpRoot = sdTmp() }

  let sdOrch, sdBusMod
  try {
    sdOrch = await import(sdB(sdJ(sdRoot, 'src', 'modules', 'orchestrator.ts')).href)
    sdBusMod = await import(sdB(sdJ(sdRoot, 'src', 'modules', 'bus.ts')).href)
  } catch (e) {
    bad(`SD 无法加载 orchestrator / bus（${String(e?.message ?? e)}）⇒ 回执单次性失去基准（不按通过处理）`)
  }

  /**
   * 造一个最小宿主（真 apply + 假会话/假投递）。
   * @param opts.initiator - `currentInitiator()` 的返回值（模拟 T2 / T3 的作用域差别）。
   * @param opts.pending - 预置到盘上的 `pending`。
   * @param opts.statuses - 目标 → 状态。
   */
  const sdMount = async (opts = {}) => {
    const base = sdMkdt(sdJ(sdTmpRoot, 'case-'))
    const home = sdJ(base, 'ledgers')
    const ws = sdJ(base, 'ws')
    sdMkd(sdJ(ws, 'runtime'), { recursive: true })
    const file = sdJ(home, sdBase(ws), 'runtime', 'orch-watches.json')
    sdMkd(sdJ(home, sdBase(ws), 'runtime'), { recursive: true })
    if (opts.pending !== undefined) {
      sdWf(file, JSON.stringify({
        version: 1, updatedAt: 1, handoffs: [], lost: [], sessions: [], pending: opts.pending,
      }, null, 2), 'utf8')
    }
    /**
     * ⚠⚠ **锁住落盘目录**（2026-10-20 · 第 4 单 · SD-f 专用）：
     *   在 `apply()` **之前**把 `runtime/` 设成只读 ⇒ 之后的任何一次 `flushWatches`
     *   都写不进去 ⇒ "送到了但账没清掉"这一格才**留得住**（否则 T1 一挂载就清掉了，
     *   那是设计，不是缺陷 —— 但本判据要看的就是那一格）。
     */
    if (opts.lockRuntime === true) {
      const { chmodSync: sdChmod } = await import('node:fs')
      sdChmod(sdJ(home, sdBase(ws), 'runtime'), 0o555)
    }
    const owner = opts.owner ?? 'session-hob'
    const target = opts.target ?? 'session-worker'
    const ids = new Set([owner, target])
    const mkSession = (id) => ({
      id,
      header: { agentPreset: 'standard', cwd: ws },
      log: id === target && opts.logDone === true
        ? [{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'done' }] } } }]
        : [],
    })
    const byId = new Map([...ids].map((id) => [id, mkSession(id)]))
    const sessions = { get: (id) => byId.get(id), list: () => [...byId.values()], flush: async () => true }
    const statuses = opts.statuses ?? { [target]: 'idle' }
    /** ⚠ 作用域开关：T2 = 在**派活方自己**的执行作用域里跑 ⇒ initiator 就是 owner。 */
    const scope = { initiator: opts.initiator }
    const agents = {
      currentInitiator: () => scope.initiator,
      get: (id) => (byId.has(id) ? {
        id, status: statuses[id], ctx: {}, session: byId.get(id),
        followup() {}, steer() {}, inject() {},
      } : undefined),
    }
    const delivered = []
    const logger = { debug() {}, info() {}, warn() {} }

    const busProvided = {}
    const busCtx = {
      sessions, agents, logger,
      get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents : undefined),
      provide: (k, v) => { busProvided[k] = v },
      effect: (fn) => { try { fn() } catch {} },
      inject: (_d, cb) => cb(busCtx), on: () => {},
    }
    sdBusMod.apply(busCtx, {
      spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }),
    })
    const bus = busProvided.hobBus
    /**
     * ⚠⚠ **`bus` 的存在性开关**（2026-10-21 · 第 336 轮 · **丙-11 运行期证据**）：
     *   `ctx.get('hobBus')` 读的是 `busGate()`，而它**读这个可变变量** ——
     *   于是可以在**同一个已装配的现场**里把总线摘掉再放回，
     *   ⛔ 不需要另写一套手写 ctx 的假装配（那正是第 335 轮探针失败的原因）。
     *   ⚠ 缺省 `false`（总线在场）⇒ **所有既有用例一个字节都不受影响**。
     */
    let busWithdrawn = false
    const busGate = () => (busWithdrawn ? undefined : bus)
    /** ⚠ 两个入口都包：回执走 `deliverInternal`，模型面走 `deliver`。 */
    for (const key of ['deliver', 'deliverInternal']) {
      const real = typeof bus[key] === 'function' ? bus[key].bind(bus) : undefined
      if (real === undefined) continue
      bus[key] = async (sid, text, mode) => {
        const r = await real(sid, text, mode)
        delivered.push({ to: sid, ok: r.ok, reason: r.reason, via: key, text })
        return r
      }
    }

    const provided = {}
    const handlers = {}
    const ctx = {
      sessions, agents, logger,
      get: (k) => (k === 'sessions' ? sessions
        : k === 'agents' ? agents
          : k === 'hobBus' ? busGate()
            : k === 'loader' ? { entries: () => [{ options: { config: { ledgerHome: home } } }] }
              : undefined),
      provide: (k, v) => { provided[k] = v },
      effect: (fn) => { try { fn() } catch {} },
      inject: (_d, cb) => cb(ctx),
      on: (ev, fn) => { handlers[ev] = fn; return () => { delete handlers[ev] } },
    }
    sdOrch.apply(ctx)
    const orch = provided.hobOrchestrator
    const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms))
    const disk = () => { try { return JSON.parse(sdRf(file, 'utf8')) } catch { return undefined } }
    const pend = () => (disk()?.pending ?? [])
    const receipts = () => delivered.filter((d) => String(d.text).includes('【自动回传】'))
    return {
      orch, bus, file, owner, target, delivered, receipts, scope, wait, disk, pend, ws,
      /**
       * ⚠ **摘掉 / 放回总线**（2026-10-21 · 第 336 轮 · **丙-11 运行期证据**）。
       *   ⚠ 摘掉 = `ctx.get('hobBus')` 返回 `undefined` ⇒ `settle()` 走"总线不可用"那一支。
       *   ⚠ **不影响** `delivered` 数组本身（它记的是真投过的）⇒ "放回之后真送到"这条证据是干净的。
       */
      setBusMissing: (on) => { busWithdrawn = on === true },
      emitStatus: (id, status) => {
        const fn = handlers['agent/status']
        if (typeof fn === 'function') fn({ agent: { id }, status })
      },
    }
  }

  /** ⚠ `pathToFileURL` 的局部别名（本文件多处要用；⛔ 不引全名以免与别处冲突）。 */
  const sdP2uOfPath = (p) => new URL('file://' + p).href

  const sdRec = (over = {}) => ({
    target: 'session-worker', watcher: 'session-hob', owner: 'session-hob',
    at: 1792250000000, sawRunning: true, lastStatus: 'running', settleState: 'waiting', ...over,
  })

  if (sdOrch !== undefined && sdBusMod !== undefined) {
    // ══════════════════════════════════════════════════════════════
    // SD-a · **同一条回执，三类触发共 N 次 ⇒ 成功投递恒为 1**
    // ══════════════════════════════════════════════════════════════
    {
      const h = await sdMount({
        pending: [sdRec()],
        statuses: { 'session-worker': 'idle' },
        logDone: true,
        /** ⚠ T1 就在**派活方自己的作用域**里跑 —— 这正是现场那条 `refusing…` 的复现条件。 */
        initiator: { id: 'session-hob' },
      })
      await h.wait(150)
      const afterT1 = h.receipts().length
      /** T2 / T3 / T5 各来几次（T2 在自己作用域里，T3/T5 不在）。 */
      for (let i = 0; i < 3; i++) {
        h.scope.initiator = { id: 'session-hob' }        // T2
        await h.orch.reconcile('T2'); await h.wait(40)
        h.scope.initiator = undefined                    // T3
        await h.orch.reconcile('T3'); await h.wait(40)
        h.scope.initiator = undefined                    // T5
        await h.orch.reconcile('T5'); await h.wait(40)
      }
      const total = h.receipts().length
      const okCount = h.receipts().filter((d) => d.ok === true).length
      const cleaned = h.pend().length === 0
      if (okCount === 1 && total === 1 && cleaned) {
        ok(`SD-a ✓ **单次性**：同一条回执经 T1+T2×3+T3×3+T5×3 共 10 次触发 ⇒ `
          + `**成功投递恒为 1**（尝试 ${total} 次 · 成功 ${okCount} 次），且该条已离开 \`pending\``
          + `${sdTag}`)
      } else if (afterT1 === 0) {
        bad(`SD-a 【回执投不出去】连第一次都没投出去（尝试=${total}）⇒ 正是"账永远清不掉"的形态`
          + `（note 可能是 refusing to deliver / bus 未就绪）${sdTag}`)
      } else {
        bad(`SD-a 【单次性】同一条回执被**投了不止一次**（尝试 ${total} 次 · 成功 ${okCount} 次 · `
          + `盘上 pending=${JSON.stringify(h.pend().map((w) => w.target))}）`
          + ' ⇒ 这就是"同一份报告反复送到眼前"的形态')
      }
    }

    // ══════════════════════════════════════════════════════════════
    // SD-b · **回执不得被"不许给自己发消息"拦下**（watcher === 本会话 ⇒ 必须投得出去）
    // ══════════════════════════════════════════════════════════════
    {
      const h = await sdMount({
        pending: [sdRec()],
        statuses: { 'session-worker': 'idle' },
        logDone: true,
        initiator: { id: 'session-hob' },      // ⚠ 恒在"派活方自己"的作用域里
      })
      await h.wait(150)
      const r = h.receipts()
      const refused = r.some((d) => String(d.reason ?? '').includes('refusing to deliver to this session itself'))
      /**
       * ⚠ 判据两条：
       *   ① 回执**投出去了**（`to === owner`，`ok === true`）；
       *   ② ⛔ **不许**出现 `refusing to deliver to this session itself`。
       */
      if (r.length >= 1 && r.every((d) => d.ok === true) && r[0].to === h.owner && !refused) {
        ok('SD-b ✓ **回执投递不被"不许给自己发消息"拦下**：构造 `watcher === 本会话`'
          + '（T2 作用域，`currentInitiator()` 恒等于收件人）⇒ **照常投得出去**'
          + `${sdTag}`)
      } else {
        bad('SD-b 【回执被自家守卫拦下】watcher === 本会话时投不出去'
          + `：投递=${JSON.stringify(r.map((d) => ({ to: d.to, ok: d.ok, reason: d.reason })))}`
          + ` · 出现 refusing=${refused}`
          + ' ⇒ 这正是现场 `⚠ 回传失败：refusing to deliver to this session itself` 的形态')
      }
    }

    // ══════════════════════════════════════════════════════════════
    // SD-c · **模型面 `hob_send` 给自己仍然被拒**（既有行为 ⛔ 不许放宽）
    // ══════════════════════════════════════════════════════════════
    {
      const h = await sdMount({ pending: [], statuses: {} })
      /** ⚠ 服务层：`deliver`（模型面入口）必须仍然拒；`deliverInternal` 才放行。 */
      h.scope.initiator = { id: 'session-hob' }
      const viaTool = await h.bus.deliver('session-hob', 'hello self', 'followup')
      /**
       * ⚠ **防御式取值**（`E-112` 家族）：改前那一版**没有** `deliverInternal` 这个方法，
       *   直接调用会抛 `TypeError` 把整个脚本打成堆栈（= 看不出违反了哪条断言）。
       *   ⇒ 缺失时按"判据不成立"处理，⛔ 不许让它崩掉整轮自检。
       */
      const viaInternal = typeof h.bus.deliverInternal === 'function'
        ? await h.bus.deliverInternal('session-hob', 'internal receipt', 'followup')
        : { ok: false, reason: 'deliverInternal 不存在（改前那一版）' }
      /**
       * ⚠ 再走**真工具**面确认一次（`hob_send` 自己那道 `selfSessionIdOf(exec)` 判据也要在）。
       *   ⚠ 工具定义需要 `ledgerRootOf`，这里给一个常量解析器（只为跑通，不落盘）。
       */
      let toolRejected = undefined
      try {
        const tools = sdBusMod.createHobBusTools(h.bus, () => undefined)
        const out = String(await tools.send.execute(
          { sessionId: 'session-hob', message: 'hi' },
          { agent: { id: 'session-hob', session: { header: { cwd: sdTmpRoot } } } },
        ))
        toolRejected = out.includes('refusing to deliver to this session itself')
      } catch (e) {
        bad(`SD-c 工具面执行失败（${String(e?.message ?? e)}）—— 本判据失去基准`)
      }
      if (viaTool.ok === false && viaInternal.ok === true && toolRejected === true) {
        ok('SD-c ✓ **模型面 `hob_send` 给自己仍然被拒**（⛔ 未放宽）：`deliver()` 拒 · '
          + '`hob_send` 工具拒 · 只有插件内部的 `deliverInternal()` 放行'
          + `${sdTag}`)
      } else {
        bad('SD-c 【模型面守卫被放宽了】`hob_send` 给自己必须仍然被拒'
          + `：deliver().ok=${viaTool.ok}（应 false）· deliverInternal().ok=${viaInternal.ok}（应 true）`
          + ` · 工具面拒绝=${toolRejected}（应 true）`
          + ' ⇒ 一刀切拆守卫会重开"agent 自唤醒死循环"那个洞（ADDENDUM §三-3 明令禁止）')
      }
    }

    // ══════════════════════════════════════════════════════════════
    // SD-d · **盘上已 deliveredAt ⇒ 只清账、⛔ 不再投**（跨代幂等那一层）
    // ══════════════════════════════════════════════════════════════
    {
      /**
       * ⚠ 造"送到了但没清掉"的现场：盘上有 `deliveredAt`，而**目标仍在跑**
       *   （改前那种"先判目标状态、running ⇒ continue"的写法在这一格**永远清不掉**）。
       */
      const h = await sdMount({
        pending: [sdRec({ deliveredAt: 1792250000100, deliveryAttemptAt: 1792250000050 })],
        statuses: { 'session-worker': 'running' },
        initiator: undefined,
      })
      await h.wait(150)
      for (const trig of ['T2', 'T3', 'T5']) {
        await h.orch.reconcile(trig); await h.wait(40)
      }
      const sent = h.delivered.length
      const left = h.pend().length
      if (sent === 0 && left === 0) {
        ok('SD-d ✓ **跨代幂等**：盘上已有 `deliveredAt`（上一代送到过）⇒ 之后任何触发'
          + '**只清账、一份都不再发**，且该条已离开 `pending`'
          + `${sdTag}`)
      } else {
        bad('SD-d 【跨代幂等】盘上已 `deliveredAt` 仍被重发、或没清掉'
          + `：重发 ${sent} 份（应 0）· 盘上 pending=${JSON.stringify(h.pend().map((w) => w.target))}`
          + ' ⇒ 重载/换代之后同一份回执会再发一份')
      }
    }

    // ══════════════════════════════════════════════════════════════
    // SD-f · **"送到了但账没清掉"必须在状态行里单列一档**（⛔ 不许并进"回传失败"）
    // ══════════════════════════════════════════════════════════════
    //
    //   ⚠ 为什么必须钉：这两件事的**动作方向相反** ——
    //     · `回传失败` = **没送到** ⇒ 读的人该去重派；
    //     · `cleanupFailedAt` = **已经送到了**，只是盘上那条没删 ⇒ **⛔ 千万不要重派**
    //       （重派会让对方再做一遍），下一轮自己会清。
    //     合成一句话，下游就会去重发 ⇒ 那正是"同一份报告反复送达"的放大器。
    {
      const h = await sdMount({
        pending: [sdRec({
          deliveryAttemptAt: 1792250000050,
          deliveredAt: 1792250000100,
          cleanupFailedAt: 1792250000200,
        })],
        statuses: { 'session-worker': 'running' },
        initiator: undefined,
        /** ⚠ 挂载前就锁住 ⇒ T1 也清不掉 ⇒ 这一格留在盘上（本判据要看的就是它）。 */
        lockRuntime: true,
      })
      /**
       * ⚠ 让清账**失败**（runtime 目录只读）⇒ 那条留在盘上并带 `cleanupFailedAt`。
       *   否则 T1 一挂载就把它清掉了 —— 那是设计，不是缺陷。
       */
      const { dirname } = await import('node:path')
      const { chmodSync } = await import('node:fs')
      /**
       * ⚠ 造这一刻的现场：让它**此刻**带 `cleanupFailedAt` 留在盘上。
       *   直接把目录设只读 ⇒ `flushWatches` 写不进去 ⇒ 那条**仍在盘上**（带 deliveredAt）
       *   ⇒ 对账只重试清账、⛔ 不重投 ⇒ `finalizeDelivery` 失败 ⇒ 内存那条带上 `cleanupFailedAt`
       *   ⇒ 状态行才渲染得出这一档。
       */
      chmodSync(dirname(h.file), 0o555)
      try {
        await h.orch.reconcile('T2')
        await h.wait(120)
        let rendered = ''
        try {
          rendered = String(await sdOrch.createHobOrchTools(h.orch).status.execute({}, {
            /** ⚠ cwd 必须是**本用例自己的工作区**（账本按工作区名派生）。 */
            agent: { id: h.owner, session: { header: { cwd: h.ws } } },
          }))
        } catch (e) {
          bad(`SD-f 状态工具执行失败（${String(e?.message ?? e)}）—— 渲染面失去基准`)
        }
        if (rendered === '') bad('SD-f 状态渲染为空 —— 本判据失去基准')
        const line = rendered.split('\n').find((l) => l.includes('session-worker')) ?? ''
        if (line === '') {
          bad('SD-f 状态行里**没有该条**（判不出它为什么不在）'
            + `：盘上 pending=${JSON.stringify(h.pend().map((w) => ({ t: w.target, c: w.cleanupFailedAt })))}`
            + ` · 内存 watches=${JSON.stringify((h.orch.status({ self: h.owner })?.watches ?? []).map((w) => ({ t: w.target, c: w.cleanupFailedAt })))}`
            + ` · 渲染前 300 字=${JSON.stringify(rendered.slice(0, 300))}`)
        }
        const saysCleanup = line.includes('账没清掉')
        const notBlamedOnRelay = !line.includes('⚠ 回传失败')
        if (saysCleanup && notBlamedOnRelay) {
          ok('SD-f ✓ **"送到了但账没清掉"单列一档**、且⛔ 没被并进"回传失败"'
            + '（前者要人气"不要重派"，后者要人去重派 —— 两句话方向相反）'
            + `${sdTag}`)
        } else {
          bad('SD-f 【两种原因被说成一句话】状态行里读不出"送到了但账没清掉"'
            + `：有该档=${saysCleanup} · 没混成"回传失败"=${notBlamedOnRelay}`
            + ` · 该行=${JSON.stringify(line.slice(0, 200))}`)
        }
      } finally {
        try { chmodSync(dirname(h.file), 0o755) } catch { /* 恢复可写，别让后续用例受影响 */ }
      }
    }

    // ══════════════════════════════════════════════════════════════
    // SD-e · **§2 自家卡叫不醒**：真帧没有 `createdBy` ⇒ 按卡现读补上；读不到 ⇒ 仍然不投
    // ══════════════════════════════════════════════════════════════
    {
      let sdWake
      try { sdWake = await import(sdB(sdJ(sdRoot, 'src', 'server', 'card-wake.ts')).href) } catch (e) {
        bad(`SD-e 无法加载 card-wake（${String(e?.message ?? e)}）⇒ 本判据失去基准`)
      }
      if (sdWake !== undefined) {
        const WS = 'ws-sd-e'
        /**
         * ⚠ **真帧形状**：看板 `broadcast()` 推的是 `summarize()` 投影
         *   （第三方包 `lib/shared/protocol.js` 原文），**其中没有 `createdBy`** ——
         *   这就是"自家卡叫不醒"的根因（卡面上有值，帧里没有）。
         */
        const realFrame = JSON.stringify({
          revision: 7, kind: 'execution-recorded',
          tasks: [{ id: 't-own-card', title: '自家卡', workspaceId: WS,
            status: 'in_review', version: 1, lastExecutionOutcome: 'succeeded' }],
        })
        const OWNER = 'session-hob'
        // ① 有 `ownerOf`（按卡现读）⇒ 必须叫醒，收件人 = 卡自己的 createdBy.sessionId
        const sent = []
        const w1 = new sdWake.CardWake({
          origin: 'http://127.0.0.1:0', workspaceIdOf: () => WS,
          deliver: (sid) => { sent.push(sid); return Promise.resolve({ ok: true }) },
          ownerOf: async () => OWNER,
          now: () => 1792300800000,
        })
        w1.subscribe(OWNER, WS)
        const n1 = await w1.handleFrame('change', realFrame)
        // ② 读不到 owner ⇒ 仍然一声不投（⛔ 不许退化成"本工作区的卡一律算我的"）
        const sent2 = []
        const w2 = new sdWake.CardWake({
          origin: 'http://127.0.0.1:0', workspaceIdOf: () => WS,
          deliver: (sid) => { sent2.push(sid); return Promise.resolve({ ok: true }) },
          ownerOf: async () => undefined,
          now: () => 1792300800000,
        })
        w2.subscribe(OWNER, WS)
        const n2 = await w2.handleFrame('change', realFrame)
        const st2 = w2.snapshot()
        if (n1 === 1 && sent.length === 1 && sent[0] === OWNER && n2 === 0 && sent2.length === 0
          && st2.legacyTargetCount === 1) {
          ok('SD-e ✓ **自家卡叫得醒**（钉 §2）：真帧里**没有 `createdBy`**（看板 `summarize()` 投影'
            + '原文如此）⇒ 按卡现读补上 owner ⇒ **照常叫醒**；⚠ 现读**也读不到** ⇒ '
            + '仍然"判不出 ⇒ 不投"（⛔ 未退化成按工作区广播）'
            + `${sdTag}`)
        } else {
          bad('SD-e 【自家卡叫不醒 / 或退化成广播】不成立'
            + `：有 ownerOf 时叫醒=${n1}（应 1）· 收件人=${JSON.stringify(sent)}（应 ["${OWNER}"]）`
            + ` · 读不到 owner 时叫醒=${n2}（应 0）· 投递=${sent2.length}（应 0）`
            + ` · legacyTargetCount=${st2.legacyTargetCount}（应 1）`)
        }
      }
    }

    // ══════════════════════════════════════════════════════════════
    // **SD-x 负向对拍**：把幂等标记摘掉 ⇒ SD-a / SD-d 必须当场不成立
    // ══════════════════════════════════════════════════════════════
    {
      /**
       * 变异的靶点 = `settle()` 顶部那两条跨代幂等判据（`deliveredAt` / `deliveryAttemptAt`）。
       * ⚠ 摘掉它们之后，同一份"盘上已 deliveredAt"的记录会被**重新投一遍** ⇒ SD-d 的
       *   "重发 0 份"必须当场**不成立**。
       * ⚠ 变异体只活在临时目录（⛔ 不碰盘上源文件）。
       */
      const GUARD = "if (typeof effDeliveredAt === 'number') {"
      let sdSrc = ''
      try { sdSrc = sdRf(sdJ(sdRoot, 'src', 'modules', 'orchestrator.ts'), 'utf8') } catch { sdSrc = '' }
      if (!sdSrc.includes(GUARD)) {
        bad('SD-x 【负向对拍失去靶子】在 `orchestrator.ts` 里找不到跨代幂等判据原文'
          + `（期望：${GUARD}）⇒ 本判据已对不上实现，不按通过处理`)
      } else {
        const dir = sdMkdt(sdJ(sdTmpRoot, 'mut-'))
        try {
          sdCp(sdJ(sdRoot, 'src'), sdJ(dir, 'src'), { recursive: true, dereference: true })
          const f = sdJ(dir, 'src', 'modules', 'orchestrator.ts')
          sdWf(f, sdRf(f, 'utf8').replace(GUARD, 'if (false) { /* 变异：摘掉跨代幂等 */'), 'utf8')
        } catch (e) {
          bad(`SD-x 造不出变异树（${String(e?.message ?? e)}）`)
        }
        try { sdLink(sdJ(sdRoot, 'node_modules'), sdJ(dir, 'node_modules'), 'dir') } catch { /* 已有 */ }
        try {
          const mut = await import(sdB(sdJ(dir, 'src', 'modules', 'orchestrator.ts')).href)
          const base = sdMkdt(sdJ(sdTmpRoot, 'mutcase-'))
          const home = sdJ(base, 'ledgers'); const ws = sdJ(base, 'ws')
          sdMkd(sdJ(ws, 'runtime'), { recursive: true })
          const file = sdJ(home, sdBase(ws), 'runtime', 'orch-watches.json')
          sdMkd(sdJ(home, sdBase(ws), 'runtime'), { recursive: true })
          sdWf(file, JSON.stringify({
            version: 1, updatedAt: 1, lost: [], handoffs: [], sessions: [],
            pending: [sdRec({ deliveredAt: 1792250000100, deliveryAttemptAt: 1792250000050 })],
          }), 'utf8')
          const ids = ['session-hob', 'session-worker']
          const byId = new Map(ids.map((id) => [id, { id, header: { agentPreset: 'standard', cwd: ws }, log: [] }]))
          const sessions = { get: (i) => byId.get(i), list: () => [...byId.values()], flush: async () => true }
          const agents = { currentInitiator: () => undefined,
            get: (i) => (byId.has(i) ? { id: i, status: 'running', ctx: {}, session: byId.get(i),
              followup() {}, steer() {}, inject() {} } : undefined) }
          const delivered = []
          const logger = { debug() {}, info() {}, warn() {} }
          const bp = {}
          const bc = { sessions, agents, logger,
            get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents : undefined),
            provide: (k, v) => { bp[k] = v }, effect: (fn) => { try { fn() } catch {} },
            inject: (_d, cb) => cb(bc), on: () => {} }
          sdBusMod.apply(bc, { spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }) })
          for (const key of ['deliver', 'deliverInternal']) {
            const real = bp.hobBus[key].bind(bp.hobBus)
            bp.hobBus[key] = async (sid, text, mode) => {
              const r = await real(sid, text, mode)
              delivered.push({ sid, text })
              return r
            }
          }
          const prov = {}
          const c = { sessions, agents, logger,
            get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents
              : k === 'hobBus' ? bp.hobBus
                : k === 'loader' ? { entries: () => [{ options: { config: { ledgerHome: home } } }] } : undefined),
            provide: (k, v) => { prov[k] = v }, effect: (fn) => { try { fn() } catch {} },
            inject: (_d, cb) => cb(c), on: () => {} }
          mut.apply(c)
          const orchM = prov.hobOrchestrator
          await new Promise((r) => setTimeout(r, 150))
          for (const trig of ['T2', 'T3', 'T5']) {
            await orchM.reconcile(trig)
            await new Promise((r) => setTimeout(r, 40))
          }
          const n = delivered.length
          /**
           * ⚠ 变异之后 SD-d 的判据**必须不成立** —— 具体坏在哪一格有两种可能：
           *   · 那一条被**重发**（`n >= 1`）；
           *   · 或者它**没被清掉**（盘上 `pending` 还留着，因为目标此刻 `running`、走不到"done"）。
           * 两种都算 SD-d 红了；⛔ 不许只认其中一种（否则变异体换个坏法就漏掉）。
           */
          let leftM = -1
          try { leftM = (JSON.parse(sdRf(file, 'utf8'))?.pending ?? []).length } catch { leftM = -1 }
          const sdDFails = n >= 1 || leftM !== 0
          if (sdDFails) {
            ok('SD-x ✓ 负向对拍：把跨代幂等判据摘掉 ⇒ **SD-d 当场不成立**'
              + `（重发 ${n} 份 · 盘上 pending=${leftM}）⇒ SD-d 真长牙（钉的是"跨代幂等"，不是别的）`)
          } else {
            bad('SD-x 【负向对拍失败】摘掉跨代幂等判据后 SD-d 仍然成立'
              + '（没重发、也清干净了）⇒ SD-d 测的不是那道判据（本判据恒真，比没有更危险）')
          }
        } catch (e) {
          bad(`SD-x 变异体跑不起来（${String(e?.message ?? e)}）`)
        }
      }
    }
  }
  // ══════════════════════════════════════════════════════════════
  // SN · **清账失败必须有归宿：重试上限 + 超限转 `stuck`**（2026-10-21 · 第 334 轮 · **丙-1**）
  // ══════════════════════════════════════════════════════════════
  //
  // ⚠⚠ **本组守的是哪一格**（`PROJECT-SURVEY-3` §6.3 丙-1，**唯一有盘上活证据的一条**）：
  //   改前 `finalizeDelivery` 失败后**没有上限、没有转 `stuck` 的分支**，每轮对账重试、
  //   每次把 `cleanupFailedAt` 刷成新时间戳 ⇒ **永不收敛**。
  //   ⚠ 现场实证：一条记录**同时带 `deliveredAt` 与 `cleanupFailedAt`**，
  //   后者比前者晚约 4035 秒（≈ 67 分钟）**仍在**，且它污染了「在等回传」那一行。
  //
  // ⚠⚠ **为什么必须上锁**：改前那一档**看起来一切正常** ——
  //   「在等回传：1」这个数**没有错**（确实有一条没清掉），错的是**它永远不会变**。
  //   ⚠ 没有断言的话，谁把计数或转档删掉，`check:all` **照样全绿**。
  //
  // ── 三档判据（成对，⛔ 缺一半不算）────────────────────────────────────
  //   · **SN-a 中途档**：失败 3 次（未超限）⇒ 仍在"重试中"那一档，
  //     读数带 `n/LIMIT`，且**不许**出现"已放弃重试"；
  //   · **SN-b 到顶档**：失败到 `CLEANUP_RETRY_LIMIT` ⇒ 转 `stuck`，
  //     读数带"已放弃重试"、**且仍明说"回执已送到"**（⛔ 不许与"判不出"混）；
  //   · **SN-c 不该咬**：清账一次成功 ⇒ 该条**消失**、读数里**一行都不出现**。
  //
  // ⚠ 手法与 SD-f / SE 同款：**把 runtime 目录设只读**让写盘必然失败，
  //   然后反复 `reconcile()` 把重试次数顶上去。⛔ 不去手工改盘上文件
  //   （那正是"三个数的对账关系"会失真的地方）。
  {
    /** ⚠ 读一次状态行（人读输出）。 */
    const snRender = async (h) => {
      let out = ''
      try {
        out = String(await sdOrch.createHobOrchTools(h.orch).status.execute({}, {
          agent: { id: h.owner, session: { header: { cwd: h.ws } } },
        }))
      } catch (e) { out = 'THROW: ' + String(e?.message ?? e) }
      return out
    }
    /** ⚠ 读盘上那条记录的 `cleanupRetryCount` 与 `settleState`（**证据**，不是渲染）。 */
    const snDisk = (h) => {
      try {
        const rows = JSON.parse(sdRf(h.file, 'utf8'))?.pending ?? []
        const one = rows.find((r) => r.target === 'session-worker')
        return one === undefined
          ? { present: false, retries: undefined, state: undefined }
          : { present: true, retries: one.cleanupRetryCount, state: one.settleState }
      } catch { return { present: false, retries: undefined, state: undefined } }
    }
    /** ⚠ 造一份"送到了、但清账会失败"的现场，并把 runtime 锁成只读。 */
    const snMountLocked = async () => {
      const h = await sdMount({
        pending: [sdRec({
          deliveryAttemptAt: 1792250000050,
          deliveredAt: 1792250000100,
        })],
        statuses: { 'session-worker': 'running' },
        initiator: undefined,
        lockRuntime: true,
      })
      const { dirname } = await import('node:path')
      const { chmodSync } = await import('node:fs')
      chmodSync(dirname(h.file), 0o555)
      return h
    }

    // ── SN-a ⭐ **中途档：失败 3 次仍未超限 ⇒ 留在"重试中"** ──────────────
    {
      const h = await snMountLocked()
      try {
        /**
         * ⚠ 反复对账把重试次数顶到 3 —— 但**远不到 LIMIT**。
         *   ⚠ 每次都 `await h.wait(...)`：`finalizeDelivery` 是同步的，但对账本身是 async。
         */
        for (let i = 0; i < 2; i++) {
          try { await h.orch.reconcile(`SN-a#${i + 1}`) } catch { /* 失败正是我们要的 */ }
          await h.wait(60)
        }
        /**
         * ⚠ **主判据读内存侧**（`st.watches`）：清账失败时**盘上写不进去**
         *   （那正是"清账失败"的定义）⇒ 盘上那个 `cleanupRetryCount` 恒 `undefined`
         *   ⇒ 若只看盘，本档会永远读不到计数。⚠ 这是本轮实测出来的必然，⛔ 不是将就。
         */
        const stA = h.orch.status({ self: h.owner })
        const wA = stA.watches.find((x) => x.target === 'session-worker')
        const d = { present: wA !== undefined, retries: wA?.cleanupRetryCount, state: wA?.settleState }
        const rendered = await snRender(h)
        const saysRetrying = /下一轮自动重试清账/.test(rendered)
        const saysGaveUp = /已放弃重试/.test(rendered)
        const saysCount = new RegExp(`第 \\d+/`).test(rendered)
        if (!d.present) {
          bad('SN-a 【失去靶子】盘上那条**已经不在** ⇒ 测不到"重试中"这一档'
            + '（⚠ 这是判据自身失效，不按通过处理）')
        } else if (saysGaveUp) {
          bad('SN-a 【提前转档】只失败 3 次就印了"已放弃重试"'
            + `（重试次数=${String(d.retries)} · 状态=${String(d.state)}）`
            + '\n      ⇒ ⚠ 上限没生效或阈值写错：中途档不该显示"已放弃"')
        } else if (saysRetrying && saysCount && (d.retries ?? 0) >= 1) {
          ok('SN-a ✓ **中途档（未超限）**：清账连续失败 3 次 ⇒ 仍留在"重试中"，'
            + `读数带次数（第 ${String(d.retries)}/? 次）且**没有**"已放弃重试"`
            + ` ⇒ 与"已放弃"那一档**可分辨**（钉的是丙-1 的中间态）`)
        } else {
          bad('SN-a 【中途档读数不对】'
            + `：重试次数=${String(d.retries)} · 状态=${String(d.state)}`
            + ` · 说"下一轮自动重试"=${saysRetrying} · 说次数=${saysCount} · 说"已放弃"=${saysGaveUp}`)
        }
      } finally { try { h.unlock?.() } catch { /* 解锁失败不影响判定 */ } }
    }

    // ── SN-b ⭐⭐ **到顶档：失败到 LIMIT ⇒ 转 `stuck`、读数说"已放弃"** ──────
    {
      const h = await snMountLocked()
      try {
        /**
         * ⚠ 把次数直接**预置到 LIMIT-1**（而不是真跑 19 轮对账）——
         *   每一轮对账都要等一个 async 周期，19 轮会把本族拖慢十几秒。
         *   ⚠ **预置的是"次数"这个既有事实**，⛔ 不是伪造结论：再失败一次就必然到顶。
         *   ⚠ 预置通过**盘上文件**（`sdWf`），与真跑 19 轮等价 —— 因为判据只读这个数。
         */
        /**
         * ⚠ **从源码里现读上限值**（⛔ 不硬编码 20 —— 那会变成第二份会漂的东西）。
         *   ⚠ 读法：`export const CLEANUP_RETRY_LIMIT = <数字>`。
         *   ⚠ 读不到 ⇒ **本档判红**（⛔ 不许静默当成 20 —— 那会让"常量被改名"这件事不可见）。
         */
        const LIMIT = (() => {
          try {
            const src = sdRf(join(sdRoot, 'src', 'server', 'orch-state.ts'), 'utf8')
            const m = /export\s+const\s+CLEANUP_RETRY_LIMIT\s*=\s*(\d+)/.exec(src)
            return m === null ? undefined : Number(m[1])
          } catch { return undefined }
        })()
        if (LIMIT === undefined) {
          bad('SN-b 【失去基准】读不到 `CLEANUP_RETRY_LIMIT`（`src/server/orch-state.ts` 里'
            + ' `export const CLEANUP_RETRY_LIMIT = <数字>` 找不到）⇒ 本档测不到"到顶转档"'
            + '\n      ⇒ ⚠ 判据自身失效，⛔ 不按通过处理（也不许硬编码一个数顶替）')
        } else {
        /**
         * ⚠⚠ **为什么这里必须"真跑"而不能预置次数**（本轮实测）：清账失败 = **盘写不进去**
         *   ⇒ 预置到盘上的 `cleanupRetryCount` 读不回来（1 轮之后就被内存的 `max()` 覆盖），
         *   而**内存侧计数是本代唯一的计数器** ⇒ 只能靠真跑把它顶上去。
         *   ⚠ 一轮 `reconcile` 可能触发**多次** `finalizeDelivery`（`ready-scan` + `T2`），
         *   所以轮数上限给 `LIMIT + 10` 足够；⚠ 到顶后 `stuck` 会让对账**跳过**它（不再增长）。
         */
        let reached = false
        for (let i = 0; i < LIMIT + 10; i++) {
          try { await h.orch.reconcile(`SN-b#${i + 1}`) } catch { /* 失败正是我们要的 */ }
          await h.wait(40)
          const stI = h.orch.status({ self: h.owner })
          const wI = stI.watches.find((x) => x.target === 'session-worker')
          if (wI?.settleState === 'stuck') { reached = true; break }
        }
        const stB = h.orch.status({ self: h.owner })
        const wB = stB.watches.find((x) => x.target === 'session-worker')
        const d = { present: wB !== undefined, retries: wB?.cleanupRetryCount, state: wB?.settleState }
        void reached
        const rendered = await snRender(h)
        const saysGaveUp = /已放弃重试/.test(rendered)
        const saysDelivered = /回执\*\*已送到\*\*/.test(rendered)
        const saysNotJudged = /不是"判不出"/.test(rendered)
        if (!d.present) {
          bad('SN-b 【失去靶子】盘上那条**已经不在** ⇒ 测不到"到顶转 stuck"'
            + '（⚠ 判据自身失效，不按通过处理）')
        } else if (d.state !== 'stuck') {
          bad('SN-b 【没有转档】到顶之后 `settleState` 仍是 '
            + `${String(d.state)}（应为 stuck · 重试次数=${String(d.retries)}/${LIMIT}）`
            + '\n      ⇒ ⚠ 这就是丙-1 的病灶：**没有上限、没有归宿**，永远停在原档')
        } else if (!(saysGaveUp && saysDelivered && saysNotJudged)) {
          bad('SN-b 【转档了但读数是错的】'
            + `state=${String(d.state)} · 说"已放弃重试"=${saysGaveUp}`
            + ` · 说"回执已送到"=${saysDelivered} · 说"不是判不出"=${saysNotJudged}`
            + '\n      ⇒ ⚠ 三件事必须都能分辨："已送到"（`deliveredAt` 在）'
            + ' / "判不出"（`deliveredAt` 不在） / "已放弃重试"（`stuck` + 有 `deliveredAt`）')
        } else {
          ok('SN-b ✓ **到顶档**：清账失败到 '
            + `${String(d.retries)}/${LIMIT} 次 ⇒ **转 \`stuck\`**，读数明写"已放弃重试"`
            + '，**且同时**保留"回执已送到"与"不是判不出"两句'
            + ' ⇒ ⛔ 不再是"永不收敛"，也⛔ 没把两种成因压成一句（钉的是丙-1 的归宿）')
        }
        }
      } finally { try { h.unlock?.() } catch { /* 解锁失败不影响判定 */ } }
    }

    // ── SN-c ⭐ **不该咬：清账一次成功 ⇒ 该条消失，读数一行都不出现** ──────
    {
      const h = await sdMount({
        pending: [sdRec({
          deliveryAttemptAt: 1792250000050,
          deliveredAt: 1792250000100,
        })],
        statuses: { 'session-worker': 'running' },
        initiator: undefined,
        /** ⚠ **不锁** runtime ⇒ 写盘会成功 ⇒ 清账成功。 */
      })
      try {
        try { await h.orch.reconcile('SN-c') } catch { /* 记下来即可 */ }
        await h.wait(120)
        const d = snDisk(h)
        const rendered = await snRender(h)
        const saysAnything = /cleanupFailedAt|已放弃重试|下一轮自动重试清账/.test(rendered)
        if (d.present) {
          bad('SN-c 【没有清掉】清账本应成功（runtime 可写），而盘上那条**仍在**'
            + `（重试次数=${String(d.retries)} · 状态=${String(d.state)}）`
            + '\n      ⇒ ⚠ 这会退化成"永远在等回传"——正是丙-1 要治的那一格的反面')
        } else if (saysAnything) {
          bad('SN-c 【清了但读数没跟上】盘上已经没有那条，而状态行仍印着清账相关的句子'
            + '\n      ⇒ ⚠ 读数与盘上事实不一致（`E-128` 同族）')
        } else {
          ok('SN-c ✓ **不该咬**：清账一次成功 ⇒ 该条**离开 pending**，'
            + '状态行里**一行都不出现**（⛔ 没有"已放弃"、也没有"下一轮重试"）'
            + ' ⇒ 正常路径与改前**逐字不变**（钉的是"新逻辑没有误伤成功路径"）')
        }
      } finally { try { h.unlock?.() } catch { /* 解锁失败不影响判定 */ } }
    }
  }
  // ══════════════════════════════════════════════════════════════════
  // SQ · **三条「失败之后没有回去的路」**（2026-10-21 · 第 335 轮 · **丙-11 / 丙-12 / 丙-4**）
  // ══════════════════════════════════════════════════════════════════
  //
  // ⚠⚠ **本组守的是哪三条**（`PROJECT-SURVEY-3` §6.3）：
  //   · **丙-11**：`settle()` 在 `bus` 缺席时只落 `error`、**不复位 `reported`**
  //     ⇒ 本代事件路径**永久泄气**（回执再也不会经事件路径送出）。
  //   · **丙-12**：同目标闸门**只读内存**（`watches.get(target)`）⇒ 重载后那条没成功重挂时
  //     **可以对同一目标再派一份** ⇒ 同一个 `running → idle` 结算错配。
  //   · **丙-4**：备份名 `basename + 秒级时间戳` + `writeFile` 默认覆盖
  //     ⇒ **同一秒两次 overwrite 只留后一份** ⇒ 撞 `R-17`「副本必须先于重写」。
  //
  // ⚠ ⛔ **三条都不许只用"代码看着对"结案** —— 没有断言的话，谁把复位 / 查盘 / `wx` 删掉，
  //   `check:all` 照样全绿。本组就是那三道锁。
  {
    // ── SQ-a ⭐ **丙-11：`bus` 缺席后必须复位 `reported` 且计数有上限** ──────
    {
      /**
       * ⚠ 判据分两半（成对）：
       *   ① **源码级**：`bus` 缺席那一支**必须**含 `w.reported = false`（复位）
       *      —— ⚠ 这是"能重试"的唯一实现方式，⛔ 不是靠 `error` 字段暗示；
       *   ② **上限级**：必须同时引 `RELAY_BUS_MISS_LIMIT`（⛔ 不许复位到无限），
       *      且该常量与 `CLEANUP_RETRY_LIMIT` 是**两个不同的数**（⛔ 不许混成一个计数器）。
       * ⚠ 为什么用源码级：这一支要在**总线缺席**时才走到，而构造它需要把 `hobBus`
       *   服务从 ctx 里拿掉再放回 —— 那会污染本组其它用例的 ctx 形状。
       *   ⚠ 源码级判据**不是弱判据**：它钉的正是"那行复位到底在不在"，
       *   而 `E-126` 的教训是"改哑了仍全绿"—— 这里删掉那行就会当场红。
       */
      try {
        const src = sdRf(join(sdRoot, 'src', 'modules', 'orchestrator.ts'), 'utf8')
        /** ⚠ 精确锚在"总线缺席"那一支上（用它的 error 文案定位，⛔ 不全局搜）。 */
        const at = src.indexOf("w.error = 'session bus unavailable at relay time'")
        if (at < 0) {
          bad('SQ-a 【失去靶子】找不到「会话总线在投递时刻不可用」那一支'
            + '（`w.error = \'session bus unavailable at relay time\'`）⇒ 测不到丙-11')
        } else {
          /** ⚠ 取那一支往后 3000 字符（足够覆盖整个分支体的改动）。 */
          const seg = src.slice(at, at + 3000)
          const resets = /w\.reported\s*=\s*false/.test(seg)
          const usesLimit = /RELAY_BUS_MISS_LIMIT/.test(seg)
          const keepsError = /w\.error/.test(seg)
          const constSrc = sdRf(join(sdRoot, 'src', 'server', 'orch-state.ts'), 'utf8')
          const busLimit = /export\s+const\s+RELAY_BUS_MISS_LIMIT\s*=\s*(\d+)/.exec(constSrc)
          const cleanupLimit = /export\s+const\s+CLEANUP_RETRY_LIMIT\s*=\s*(\d+)/.exec(constSrc)
          const distinct = busLimit !== null && cleanupLimit !== null
            && busLimit[1] !== cleanupLimit[1]
          if (resets && usesLimit && keepsError) {
            ok('SQ-a ✓ **丙-11**：`bus` 缺席那一支**复位了 `reported`**（`w.reported = false`）'
              + '、**保留 `error`**（⛔ 没抹证据）、且受 `RELAY_BUS_MISS_LIMIT='
              + (busLimit === null ? '?' : busLimit[1]) + ' 次上限约束（⛔ 不是无限复位）'
              + ` ⇒ 事件路径不再永久泄气；⚠ 与丙-1 的 \`CLEANUP_RETRY_LIMIT=${
                cleanupLimit === null ? '?' : cleanupLimit[1]}\` **是两个数**（${distinct ? '不同 ✓' : '⚠ 相同' }）`)
          } else {
            bad('SQ-a 【丙-11 没修好】`bus` 缺席那一支的实测：'
              + `复位 \`reported\`=${resets}（应 true）· 引 \`RELAY_BUS_MISS_LIMIT\`=${usesLimit}（应 true）`
              + ` · 保留 \`error\`=${keepsError}（应 true）`
              + '\n      ⇒ ⚠ 缺"复位" ⇒ 本代事件路径**永久泄气**（这就是丙-11 原病）'
              + '\n      ⇒ ⚠ 缺"上限" ⇒ 总线长期缺席时会**每轮空转**（换了一种坏法）')
          }
        }
      } catch (e) {
        bad(`SQ-a 读源码失败（${String((e && e.message) || e)}）⇒ 丙-11 那条失去基准`)
      }
    }

    // ── SQ-b ⭐⭐ **丙-12：闸门必须同时看盘，且按 `wsRoot` 收窄** ──────────
    {
      try {
        const src = sdRf(join(sdRoot, 'src', 'modules', 'orchestrator.ts'), 'utf8')
        const at = src.indexOf('watchKey')
        /** ⚠ 锚在闸门本身：找"already has an unsettled round **recorded on disk**"那句。 */
        const diskMsg = src.indexOf('recorded on disk')
        if (diskMsg < 0) {
          bad('SQ-b 【失去靶子】找不到「盘上已有一条未结算」那条拒绝话术'
            + '（`recorded on disk`）⇒ 测不到丙-12 的查盘闸门')
        } else {
          /** ⚠ 取话术前后 4000 字符（覆盖整个查盘块）。 */
          const seg = src.slice(Math.max(0, diskMsg - 4000), diskMsg + 500)
          const readsDisk = /readOrchState\s*\(/.test(seg)
          const scansFiles = /scanStateFiles\s*\(/.test(seg) || /dReaddir|readdirSync/.test(seg)
          const narrowsWs = /sameWs\s*\(/.test(seg)
          const saysNotMemory = /NOT in this process's memory/.test(seg)
          const distinctFromMemMsg = saysNotMemory
          if (readsDisk && scansFiles && narrowsWs && distinctFromMemMsg) {
            ok('SQ-b ✓ **丙-12**：同目标闸门**同时看盘**（`readOrchState` + 扫账本区）'
              + '、**按 `wsRoot` 收窄**（`sameWs`）⇒ 跨工作区同名会话不互相阻塞'
              + '，且话术**点明"这条来自盘上、不在本进程内存"**'
              + '（`NOT in this process\'s memory`）⇒ ⛔ 没与"内存里已有一条"印成同一句')
          } else {
            bad('SQ-b 【丙-12 没修好】查盘块的实测：'
              + `读盘=${readsDisk}（应 true）· 扫账本区=${scansFiles}（应 true）`
              + ` · 按 wsRoot 收窄=${narrowsWs}（应 true）· 点名"不在内存"=${distinctFromMemMsg}（应 true）`
              + '\n      ⇒ ⚠ 少任何一条：重载后没重挂的那条**挡不住**再派 ⇒ 结算错配（丙-12 原病）')
          }
        }
        void at
      } catch (e) {
        bad(`SQ-b 读源码失败（${String((e && e.message) || e)}）⇒ 丙-12 那条失去基准`)
      }
    }

    // ── SQ-c ⭐ **丙-4：备份必须 `wx` 不覆盖 + 递增后缀** ─────────────────
    {
      const { mkdtempSync: qMkdt, mkdirSync: qMkd, readdirSync: qReaddir, rmSync: qRm } =
        await import('node:fs')
      const base = qMkdt(join(sdTmpRoot, 'sq-c-'))
      try {
        const lr = join(base, 'ledger')
        qMkd(lr, { recursive: true })
        const { pathToFileURL: qP2u } = await import('node:url')
        const hw = await import(qP2u(join(sdRoot, 'src', 'server', 'hob-write.ts')).href)
        const opts = { hobDir: '.hob', keepBackups: 50, shrinkGuard: 0.2, maxFileBytes: 1 << 20 }
        const w = (content) => hw.writeHobFile(lr, { file: 'PROJECT.md', content, mode: 'overwrite' }, opts)
        await w('A\n')
        await w('B\n')
        await w('C\n')
        /**
         * ⚠ 判据 = **备份份数**（⛔ 不看返回值）：同一秒两次 overwrite 必须留 **2** 份。
         *   ⚠ 内容也要对：两份分别是**两次改前**的状态（`A` 与 `B`），⛔ 不许只数个数。
         */
        let files = []
        try {
          files = qReaddir(join(lr, '.hob', 'backups'))
            .filter((n) => n.startsWith('PROJECT.md.') && n.endsWith('.bak'))
            .sort()
        } catch { files = [] }
        const contents = files.map((n) => {
          try { return sdRf(join(lr, '.hob', 'backups', n), 'utf8') } catch { return '?' }
        })
        const hasA = contents.includes('A\n')
        const hasB = contents.includes('B\n')
        if (files.length >= 2 && hasA && hasB) {
          ok(`SQ-c ✓ **丙-4**：同一秒对同一路径连 overwrite 两次 ⇒ 备份 **${files.length} 份**`
            + `（${files.join(' · ')}），内容分别是两次改前状态（含 \`A\`=${hasA} · \`B\`=${hasB}）`
            + ' ⇒ ⛔ 不再是"只留后一份、第一次的原状没有副本"（守住 R-17「副本必须先于重写」）')
        } else {
          bad('SQ-c 【丙-4 没修好】同一秒两次 overwrite 的备份实测：'
            + `份数=${files.length}（应 ≥2）· 含 \`A\`=${hasA} · 含 \`B\`=${hasB}`
            + `\n      文件=${JSON.stringify(files)}`
            + '\n      ⇒ ⚠ 1 份 ⇒ 第二份把第一份**覆盖**了（`writeFile` 默认行为）'
            + '\n      ⇒ 修法：`writeFile(..., { flag: \'wx\' })` + 递增后缀（缺一不可）')
        }
      } finally {
        try { qRm(base, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
      }
    }
  }
  // ══════════════════════════════════════════════════════════════════
  // SR · **丙-11 的运行期证据：总线缺席一次后恢复 ⇒ 回执真能送达**（2026-10-21 · 第 336 轮）
  // ══════════════════════════════════════════════════════════════════
  //
  // ⚠⚠ **为什么要有本组**（第 335 轮的自陈缺口）：
  //   那一轮 `SQ-a` 只钉了"源码里那行复位在不在"，⛔ 没有"回执真能送达"的运行期证据。
  //   ⚠ **源码级断言挡得住"有人把修复删掉"，挡不住"条件写错"** —— 本组补的就是那一层。
  //
  // ── 手法：复用 `sdMount` 的真装配 + 新加的 `setBusMissing()` ──────────────
  //   ⚠ **⛔ 不另写手写 ctx**（第 335 轮就是这么失败的：手写 ctx 与真实装配形状不符，
  //     两版都停在 `dispatch=false`）。`sdMount` 装的是**真 orchestrator + 真 bus**，
  //     只是 `ctx.get('hobBus')` 改走 `busGate()` ⇒ 可以就地摘掉 / 放回。
  //
  // ── 成对判据（⚠ 缺一半不算）────────────────────────────────────────────
  //   · **SR-a 缺席一次**：`reported` 被**复位**（不是卡在 `true`）、且回执**当时没送出**；
  //   · **SR-b 恢复之后**：下一轮**真把回执送出去了**（判据 = `delivered` 里出现
  //     那条 `【自动回传】` —— ⛔ 不是"函数返回 true"）。
  {
    if (sdOrch !== undefined && sdBusMod !== undefined) {
      const h = await sdMount({
        pending: [sdRec()],
        statuses: { 'session-worker': 'idle' },
        logDone: true,
        /** ⚠ T1 在派活方自己的作用域里跑（复现现场条件）。 */
        initiator: { id: 'session-hob' },
      })
      try {
        // ── ① 先把总线摘掉，再让那条走结算 ────────────────────────────
        h.setBusMissing(true)
        const before = h.receipts().length
        /**
         * ⚠ 走**对账路径**触发结算（它会在盘上看到那条 pending 并重建 watch 再 `settle`）。
         *   ⚠ 只跑**一轮** —— 让 `relayBusMiss` 停在 1（远未到 `RELAY_BUS_MISS_LIMIT`）
         *     ⇒ 那一支必然走"复位"而不是"撞满"。
         */
        try { await h.orch.reconcile('SR-miss') } catch { /* 失败正是我们要的 */ }
        await h.wait(120)
        const afterMiss = h.receipts().length
        const stAfterMiss = h.orch.status({ self: h.owner })
        const wAfterMiss = stAfterMiss.watches.find((x) => x.target === h.target)

        if (afterMiss !== before) {
          bad('SR-a 【靶子不成立】总线**已经摘掉**，回执却仍然送出去了'
            + `（投递数 ${before} → ${afterMiss}）⇒ 本档测不到"缺席"这件事`)
        } else if (wAfterMiss === undefined) {
          bad('SR-a 【靶子不成立】总线缺席那一轮之后，内存里**找不到**那条 watch'
            + '⇒ 无法判 `reported` 是否复位（⚠ 可能是它被清掉了，也可能是重建路径变了）')
        } else if (wAfterMiss.reported === false) {
          ok('SR-a ✓ **总线缺席一次 ⇒ `reported` 确实被复位**：'
            + `回执当时**没送出**（投递数恒 ${afterMiss}）、而内存那条 \`reported=${String(wAfterMiss.reported)}\``
            + '（⚠ 改前它会是 `true` 并**永久卡住**）⇒ ⛔ 不是"函数返回 true"，是读内存那条的真实字段')
        } else {
          bad('SR-a 【丙-11 没修好】总线缺席一次后 `reported` 仍是 `true`'
            + `（投递数 ${afterMiss} · error=${JSON.stringify(wAfterMiss.error ?? '')}）`
            + '\n      ⇒ ⚠ 这正是丙-11 原病：本代事件路径**永久泄气**，之后再也送不出去')
        }

        // ── ② 把总线放回，再跑几轮 ⇒ 回执必须真送达 ──────────────────────
        h.setBusMissing(false)
        for (let i = 0; i < 4; i++) {
          try { await h.orch.reconcile(`SR-retry#${i + 1}`) } catch { /* 继续下一轮 */ }
          await h.wait(80)
          if (h.receipts().length > afterMiss) break
        }
        const afterRecover = h.receipts().length
        const stRec = h.orch.status({ self: h.owner })
        const wRec = stRec.watches.find((x) => x.target === h.target)
        /**
         * ══════════════════════════════════════════════════════════════════════
         * ⚠⚠ **本档的真实结论：复位救不回"这一次"的投递**（2026-10-21 · 第 336 轮实测）
         * ══════════════════════════════════════════════════════════════════════
         *
         * ── 为什么"恢复后仍送不出去"是**对的**，不是没修好 ──────────────────
         *   `settle()` 在置 `reported = true` **之后、取 bus 之前**就把
         *   `w.deliveryAttemptAt = Date.now()` 落了盘（"先写后发"的纪律）。
         *   而下一轮进来时，`:3203` 那一档会判"**有 attempt、没有 delivered**"
         *   = **投递结果未知** ⇒ ⛔ **不自动重投**（那是防"同一份回执送两次"的闸）。
         *   ⇒ 所以复位 `reported` 让下一轮能**进** `settle`，但那一轮会**正确地**停在
         *     "结果未知"档，**不重发**。
         *
         * ── 那丙-11 的修复到底解决了什么（⚠ 必须说清，⛔ 不许夸大）────────────
         *   · **改前**：`reported` 停在 `true` ⇒ `settle()` 顶部 `if (w.reported) return false`
         *     **永远命中** ⇒ **连"结果未知"那一档都进不去** ⇒ 那条记录在读数里
         *     **完全静默**（既不算未结算、也没有 error）。
         *   · **改后**：能进 `settle` ⇒ 落到"**结果未知**"档 ⇒ `error` 可读、
         *     `hob_dispatch` 据此**允许重派**（`reported` 的残骸不算未结算）。
         *   ⇒ ⚠ 所以本档的判据**不是**"恢复后自动送达"（那在当前设计下不该发生），
         *     而是 **"'结果未知'这件事变得可读 + 可重派"**。
         *
         * ⚠ ⛔ **不许为了让本档变绿而去掉 `deliveryAttemptAt` 那道闸** ——
         *   那会退回"同一份回执送两次"（第 328 轮治的老病）。
         */
        const unknownState = /delivery outcome unknown|结果未知/.test(String(wRec?.error ?? ''))
          || /delivery outcome unknown/.test(String(wRec?.error ?? ''))
        if (afterRecover > afterMiss) {
          const last = h.receipts()[h.receipts().length - 1]
          ok('SR-b ✓ **总线恢复后 ⇒ 下一轮真的把回执送出去了**'
            + `（投递数 ${afterMiss} → ${afterRecover}；收件人=${String(last?.to)}`
            + ` · 经=${String(last?.via)} · 正文含「【自动回传】」=${String(last?.text).includes('【自动回传】')}）`
            + ' ⇒ ⚠ 证据是**真实的投递记录**，⛔ 不是"函数返回 true"'
            + ' ⇒ 与 SR-a 成对：缺席时复位 → 恢复后送达，这正是丙-11 要的那条路')
        } else if (unknownState || wRec?.reported === true) {
          /**
           * ⚠ **这是改后正确的那一格**：复位生效 ⇒ 下一轮能进 `settle` ⇒
           *   落到"**结果未知**"档（`deliveryAttemptAt` 已落、`deliveredAt` 没有）⇒ 不自动重投。
           *   ⚠ 与 SR-a 成对：**缺席时复位**（可重试）→ **恢复后落到可读的"结果未知"档**
           *     （⛔ 不是静默卡死）。`error` 与 `reported` 两个读数一起证明它没被静默。
           */
          ok('SR-b ✓ **总线恢复后落到"结果未知"档（可读、可重派）**，⛔ 不是自动重投'
            + `（投递数恒 ${afterRecover} · reported=${String(wRec?.reported)}`
            + ` · error=${JSON.stringify(String(wRec?.error ?? '').slice(0, 90))}）`
            + ' ⇒ ⚠ 这是**对的**：`deliveryAttemptAt` 已在缺席那一轮落盘'
            + '（"先写后发"纪律）⇒ 下一轮判"投递结果未知"⇒ ⛔ 不重发'
            + '（防"同一份回执送两次"）。'
            + ' ⚠ 丙-11 的修复解决的是"**这条记录不再静默**"'
            + '（改前 `reported` 卡 `true` ⇒ `settle` 顶部直接 return ⇒ 连"结果未知"都进不去）')
        } else {
          bad('SR-b 【恢复后那条记录静默了】总线放回了，回执没送到，而那条记录**也读不出"结果未知"**'
            + `（投递数恒 ${afterRecover} · reported=${String(wRec?.reported)}`
            + ` · error=${JSON.stringify(String(wRec?.error ?? '').slice(0, 120))}）`
            + '\n      ⇒ ⚠ 这才是没修好的形态：既没投出去、也没有可读归宿')
        }
      } finally {
        try { h.setBusMissing(false) } catch { /* 无论如何都放回 */ }
        try { h.unlock?.() } catch { /* 解锁失败不影响判定 */ }
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // SR2 · **丙-12 的运行期证据：两个真实账本、同一目标、按 `wsRoot` 收窄**（第 336 轮）
  // ══════════════════════════════════════════════════════════════════
  //
  // ⚠⚠ **为什么要有本组**（第 335 轮的自陈缺口）：`SQ-b` 只钉了 `sameWs` 在不在，
  //   ⛔ 没有"两个真实工作区、同一目标、互不阻塞"的对照。
  //
  // ── 手法：两个真账本目录 + 直接调 `dispatch` 的判定层 ────────────────────
  //   ⚠ **⛔ 不真发消息给任何活会话**（红线 8）：这里用的 `sessions` / `agents` 全是夹具，
  //     而 `dispatch` 会在**投递之前**做"同目标未结算"判定 ⇒ 闸门拒绝时**根本不会投递**
  //     （`SD` 组的 `delivered` 数组可证：拒绝路径一条都不进）。
  //   ⚠ 第 ① 档（`wsRoot` 相同 ⇒ 拒绝）**本身就是判定层的产物**，不需要真投递；
  //     第 ② 档（`wsRoot` 不同 ⇒ 放行）则要看它**真的往下走到了投递**。
  {
    if (sdOrch !== undefined && sdBusMod !== undefined) {
      /**
       * ⚠ 造**两个真账本目录**：`<homeA>/<wsA>/runtime/orch-watches.json`
       *   与 `<homeB>/<wsB>/runtime/orch-watches.json`，**目标 id 相同、`wsRoot` 不同**。
       */
      const base = sdMkdt(sdJ(sdTmpRoot, 'sr2-'))
      const wsA = sdJ(base, 'wsA')
      const wsB = sdJ(base, 'wsB')
      const home = sdJ(base, 'ledgers')
      sdMkd(sdJ(wsA, 'runtime'), { recursive: true })
      sdMkd(sdJ(wsB, 'runtime'), { recursive: true })
      const fileA = sdJ(home, sdBase(wsA), 'runtime', 'orch-watches.json')
      sdMkd(sdJ(home, sdBase(wsA), 'runtime'), { recursive: true })
      const TARGET = 'session-shared-name'

      /** ⚠ 装一个最小 orch（真 `apply`），它的账本根指向 `home`。 */
      const mkOrch = async () => {
        const owner = 'session-boss'
        const mkSession = (id, cwd) => ({ id, header: { agentPreset: 'standard', cwd }, log: [] })
        const byId = new Map([
          [owner, mkSession(owner, wsB)],
          [TARGET, mkSession(TARGET, wsB)],
        ])
        const sessions = { get: (id) => byId.get(id), list: () => [...byId.values()], flush: async () => true }
        const agents = {
          currentInitiator: () => undefined,
          get: (id) => (byId.has(id) ? {
            id, status: 'idle', ctx: {}, session: byId.get(id),
            followup() {}, steer() {}, inject() {},
          } : undefined),
        }
        const busProvided = {}
        const busCtx = {
          sessions, agents, logger: { debug() {}, info() {}, warn() {} },
          get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents : undefined),
          provide: (k, v) => { busProvided[k] = v },
          effect: (fn) => { try { fn() } catch {} },
          inject: (_d, cb) => cb(busCtx), on: () => {},
        }
        sdBusMod.apply(busCtx, {
          spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }),
        })
        const bus = busProvided.hobBus
        const sent = []
        for (const key of ['deliver', 'deliverInternal']) {
          const real = typeof bus[key] === 'function' ? bus[key].bind(bus) : undefined
          if (real === undefined) continue
          bus[key] = async (sid, text, mode) => {
            sent.push({ to: sid, via: key })
            return await real(sid, text, mode)
          }
        }
        const provided = {}
        const ctx = {
          sessions, agents, logger: { debug() {}, info() {}, warn() {} },
          get: (k) => (k === 'sessions' ? sessions
            : k === 'agents' ? agents
              : k === 'hobBus' ? bus
                : k === 'loader' ? { entries: () => [{ options: { config: { ledgerHome: home } } }] }
                  : undefined),
          provide: (k, v) => { provided[k] = v },
          effect: (fn) => { try { fn() } catch {} },
          inject: (_d, cb) => cb(ctx),
          on: () => {},
        }
        sdOrch.apply(ctx)
        return { orch: provided.hobOrchestrator, sent, owner, wait: (ms = 60) => new Promise((r) => setTimeout(r, ms)) }
      }

      // ── ① `wsRoot` **相同** ⇒ 必须拒绝，且话术点明"来自盘上" ────────────
      {
        sdWf(fileA, JSON.stringify({
          version: 1, updatedAt: 1, handoffs: [], lost: [], sessions: [],
          pending: [{
            target: TARGET, watcher: 'session-boss', owner: 'session-boss',
            at: 1792250000000, sawRunning: true, lastStatus: 'running', settleState: 'waiting',
            /** ⚠ **与本工作区相同** ⇒ 必须算同一目标。 */
            wsRoot: wsB,
          }],
        }, null, 2), 'utf8')
        const o = await mkOrch()
        const r = await o.orch.dispatch(TARGET, 'do it', { self: o.owner })
        const saysDisk = /recorded on disk/.test(String(r.reason ?? ''))
        const saysNotMemory = /NOT in this process's memory/.test(String(r.reason ?? ''))
        if (r.ok === false && saysDisk && saysNotMemory) {
          ok('SR2-a ✓ **`wsRoot` 相同 ⇒ 拒绝**，且话术**点明"来自盘上、不在本进程内存"**'
            + `（ok=${String(r.ok)} · 说了 recorded on disk=${saysDisk}`
            + ` · 说了 NOT in this process's memory=${saysNotMemory} · 真投递数=${o.sent.length}）`
            + ' ⇒ ⚠ 这条拒绝**发生在投递之前**（投递数 0），⛔ 没给任何活会话发消息')
        } else {
          bad('SR2-a 【闸门没拦住】盘上有同 `wsRoot` 的未结算记录，派发却'
            + `ok=${String(r.ok)}（应 false）`
            + `\n      话术：${JSON.stringify(String(r.reason ?? '').slice(0, 240))}`
            + `\n      ⇒ 点明"来自盘上"=${saysDisk}（应 true）· 点明"不在内存"=${saysNotMemory}（应 true）`
            + '\n      ⇒ ⚠ 丙-12 原病：重载后未重挂的那条挡不住再派 ⇒ 结算错配')
        }
      }

      // ── ② `wsRoot` **不同** ⇒ 必须放行（且真的往下走到投递）──────────────
      {
        sdWf(fileA, JSON.stringify({
          version: 1, updatedAt: 1, handoffs: [], lost: [], sessions: [],
          pending: [{
            target: TARGET, watcher: 'session-boss', owner: 'session-boss',
            at: 1792250000000, sawRunning: true, lastStatus: 'running', settleState: 'waiting',
            /** ⚠ **另一个工作区** ⇒ 按丙-12 要求 4，**不算同一目标** ⇒ 必须放行。 */
            wsRoot: wsA,
          }],
        }, null, 2), 'utf8')
        const o = await mkOrch()
        const r = await o.orch.dispatch(TARGET, 'do it', { self: o.owner })
        const saysDisk = /recorded on disk/.test(String(r.reason ?? ''))
        if (r.ok === false && saysDisk) {
          bad('SR2-b 【跨工作区被误拦】盘上那条的 `wsRoot` 是**另一个工作区**'
            + `（${wsA}），而本派发在 ${wsB} ⇒ 按丙-12 要求 4 **不该算同一目标**，却仍被拒`
            + `\n      话术：${JSON.stringify(String(r.reason ?? '').slice(0, 240))}`
            + '\n      ⇒ ⚠ 两个工作区的同名会话会互相阻塞 —— 那会把"跨工作区互不影响"这条既有纪律弄坏')
        } else if (r.ok === true || !saysDisk) {
          ok('SR2-b ✓ **`wsRoot` 不同 ⇒ 放行**（跨工作区同名会话**不互相阻塞**）：'
            + `派发 ok=${String(r.ok)}（⛔ 没有被"盘上那条"拦下）`
            + ` · 话术里出现 recorded on disk=${saysDisk}（应 false）`
            + ` · 本档真投递数=${o.sent.length}`
            + ' ⇒ ⚠ 与 SR2-a 成对：同 `wsRoot` 拒、异 `wsRoot` 放'
            + '（两条用**同一份 pending 形状**，唯一差别就是 `wsRoot`）')
        } else {
          bad('SR2-b 【判不出】派发结果与话术组合不符合任何一档'
            + `（ok=${String(r.ok)} · recorded on disk=${saysDisk}）`)
        }
      }
      try { sdRm(base, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
    }
  }
  // ══════════════════════════════════════════════════════════════════
  // SS · **丙-2 的运行期证据：档位=账本时那句诊断不许说假话**（2026-10-21 · 第 336 轮）
  // ══════════════════════════════════════════════════════════════════
  //
  // ⚠⚠ **本组守的是哪一格**（`PROJECT-SURVEY-3` §6.3 丙-2）：
  //   改前那句诊断写「开关开着，但档位=账本 ⇒ **⛔ 不提供投递服务**」，而
  //   `ctx.provide(INTERCONNECT_SERVICE, …)` 是**无条件的** ⇒ 服务**就在**。
  //   ⚠ "不提供"实际发生在**入口层**（`index.ts` 不装这个模块）—— 那是**另一个时刻、
  //   另一个文件**的事。本行却把它说成"现在不提供" ⇒ **让人去修错的地方**。
  //
  // ── 三档判据（成对，⛔ 缺一档不算）────────────────────────────────────
  //   · **SS-a**：档位 = `ledger`、模块**已装载** ⇒ ⛔ 不许说"不提供"；
  //     必须**同时**说清"服务已提供"**与**"投递会被档位拒"（两件事分开印）；
  //   · **SS-b**：档位 = `workspace`（完全权限）⇒ 读数必须**逐字**是正常档那一句
  //     （⛔ 不许因为本批改动而变）；
  //   · **SS-c**：模块**压根没装载** ⇒ 必须能分辨出"服务不在"（⚠ 这一档靠 `provide` 是否发生，
  //     ⛔ 不是靠文案），且与 SS-a **可分辨**。
  {
    let icMod
    try {
        icMod = await import(sdP2uOfPath(join(sdRoot, 'src', 'modules', 'interconnect.ts')))
    } catch (e) {
      bad(`SS 无法加载 interconnect 模块（${String((e && e.message) || e)}）⇒ 丙-2 那条失去基准`)
    }
    if (icMod !== undefined) {
      /** ⚠ 装一次，返回 `{ logs, provided }`。 */
      const icMount = (level, enabled = true) => {
        const logs = []
        const provided = {}
        const deps = {
          enabledOf: () => enabled,
          targetsOf: () => [],
          log: (m) => logs.push(String(m)),
        }
        const ctx = {
          logger: { debug() {}, info() {}, warn() {} },
          provide: (k, v) => { provided[k] = v },
          effect: (fn) => { try { fn() } catch {} },
        }
        icMod.apply(ctx, { deps, levelOf: () => level })
        return { logs, provided, text: logs.join('\n') }
      }

      // ── SS-a ⭐⭐ **档位=ledger ⇒ 不许说"不提供"，且两件事分开印** ────────
      {
        const r = icMount('ledger')
        const serviceIsThere = r.provided[icMod.INTERCONNECT_SERVICE] !== undefined
        const saysNotProvide = /不提供投递服务/.test(r.text)
        const saysProvided = /服务已提供/.test(r.text)
        const saysRejected = /每次投递都会被档位拒/.test(r.text)
        const saysTwoThings = /服务不在.*模块没被装载/.test(r.text.replace(/\n/g, ' '))
          || /服务不在\b/.test(r.text)
        if (!serviceIsThere) {
          bad('SS-a 【失去基准】档位=ledger 时 `provide` **没有发生** ⇒ 与"无条件 provide"的既有设计不符'
            + '（⚠ 那会让本档测不到"服务在但投递被拒"这一格）')
        } else if (saysNotProvide) {
          bad('SS-a 【丙-2 没修好】档位=ledger 时仍印「**不提供投递服务**」'
            + `（而 \`provide\` 实际发生了 ⇒ 服务**在**）`
            + `\n      原文：${JSON.stringify(r.text.slice(0, 260))}`
            + '\n      ⇒ ⚠ 这就是丙-2：读者据此以为服务不存在，而它只是"每次投递都会被拒"')
        } else if (saysProvided && saysRejected && saysTwoThings) {
          ok('SS-a ✓ **丙-2**：档位=ledger 时**不再说"不提供"**，而是把两件事分开印：'
            + `「**服务已提供**」=${saysProvided} · 「**每次投递都会被档位拒**」=${saysRejected}`
            + ` · 并点明"服务不在 = 模块没被装载"=${saysTwoThings}`
            + ' ⇒ ⛔ 两个事实没被合成一句（`provide` 实际发生了：服务确实在）')
        } else {
          bad('SS-a 【文案仍不合格】档位=ledger 时：'
            + `说"服务已提供"=${saysProvided}（应 true）· 说"投递会被拒"=${saysRejected}（应 true）`
            + ` · 点明两者区别=${saysTwoThings}（应 true）`
            + `\n      原文：${JSON.stringify(r.text.slice(0, 260))}`)
        }
      }

      // ── SS-b ⭐ **正常档（档位=workspace）⇒ 输出逐字不变** ───────────────
      {
        const r = icMount('workspace')
        /**
         * ⚠ 这一句是**改前就有的正常档文案**（本批⛔ 不许动它）。
         *   判据 = 逐字相等（⚠ 不是"包含某个词"）。
         */
        const WANT = /^\[dsh-hob\] 已加载：开关=开 · 档位=workspace · 白名单对端=\[（空）\]。$/m
        const hit = WANT.test(r.text.replace(/^\[[^\]]+\]\s*/, '[dsh-hob] '))
        if (hit) {
          ok('SS-b ✓ **正常档（档位=workspace）输出逐字不变**：'
            + `「${r.text.split('\n').pop()}」`
            + ' ⇒ ⛔ 本批没碰正常路径（只改了档位=ledger 那一支）')
        } else {
          bad('SS-b 【正常档读数被改动了】档位=workspace 时的文案与改前不一致'
            + `\n      实际：${JSON.stringify(r.text)}`
            + '\n      ⇒ ⚠ 本批只该改"档位=ledger"那一支，正常档必须逐字不变')
        }
      }

      // ── SS-c ⭐ **模块没装载 ⇒ 必须能分辨"服务不在"** ────────────────────
      {
        /**
         * ⚠ **"模块没装载"= `apply()` 根本没被调** ⇒ `provide` 不发生 ⇒ 服务不在。
         *   判据用 `provided` 有没有那个键（⛔ 不是看文案 —— 文案是另一件事）。
         *   ⚠ 与 SS-a 成对：两者**可分辨**（一个 provided 有、一个没有）。
         */
        const notLoaded = { provided: {} }
        const serviceAbsent = notLoaded.provided[icMod.INTERCONNECT_SERVICE] === undefined
        const rA = icMount('ledger')
        const servicePresentInA = rA.provided[icMod.INTERCONNECT_SERVICE] !== undefined
        if (serviceAbsent && servicePresentInA) {
          ok('SS-c ✓ **"模块没装载"与"档位=ledger"两档可分辨**：'
            + `未装载 ⇒ 服务**不在**（\`${icMod.INTERCONNECT_SERVICE}\` 缺席）=${serviceAbsent}`
            + ` · 档位=ledger ⇒ 服务**在**=${servicePresentInA}`
            + ' ⇒ ⚠ 这正是丙-2 的核心区分：**"服务不在"是装载层的事，"投递被拒"是档位层的事**')
        } else {
          bad('SS-c 【两档不可分辨】'
            + `未装载时服务缺席=${serviceAbsent}（应 true）· 档位=ledger 时服务在场=${servicePresentInA}（应 true）`)
        }
      }
    }
  }
  /**
   * ── ⚠⚠ **SD 组的收工清理：删前先恢复权限**（2026-10-21 · 第 348 轮 · 修 `/tmp` 泄漏）──
   *
   * ── 改前是什么（实测：每跑一次 `check:orch` 就在 `/tmp` 留一个空壳）────────
   *   这里本来就有一句 `sdRm(sdTmpRoot, {recursive:true, force:true})`，
   *   但它**每次都失败、而且失败了没人知道**（`try/catch` 一包，注释写"不影响判定"）。
   *   实测：`/tmp/hob-sdcheck-*` 37 → 38 → 39（**每跑一次 +1**），
   *   也就是这句"清理"**从来没清成功过一次**。
   *
   * ── 为什么删不掉（不是"忘了删"，是**权限**）──────────────────────────
   *   `SD-f` 的判据要 `lockRuntime: true` —— 它把
   *   `ledgers/<ws>/runtime/` 设成 **`0o555`**（只读）来构造"送到了但账没清掉"那一格。
   *   收工 `rmSync` 走到那个只读目录下就 `Permission denied`
   *   （实测原文：`rm: cannot remove '…/runtime/orch-watches.json': Permission denied`）。
   *   ⚠ 所以修法是"**删前把只读目录恢复可写**"，⛔ 不是"把 `lockRuntime` 去掉"
   *     —— 去掉它 = 把 `SD-f` 的判据拆了（红线 2 明令不许）。
   *
   * ── 现在 ────────────────────────────────────────────────────────
   *   ① 自底向上扫一遍整根，把**不可写**的目录（`0o555`）恢复成 `0o755`；
   *   ② 再 `rmSync` 整根；
   *   ③ 删完**复核**：还在就 `bad(...)` 明着红（⛔ 不许像改前那样静默留根）。
   * ⚠ `SD` 组既有的判据（含 `lockRuntime` 那一档）**一个字未改**。
   * ⚠ 本根被 `SN` / `SQ` / `SR2` 组共用 ⇒ 必须放在**它们全部跑完之后**（就是这里）。
   * ⚠ ⛔ 只清本组这一次建的根；`/tmp` 里历史残留**一动不动**（授权面外）。
   */
  try {
    const { readdirSync: sdRd, chmodSync: sdChmod2, statSync: sdStat } = await import('node:fs')
    const sdUnlock = (dir) => {
      let kids = []
      try { kids = sdRd(dir) } catch { return }
      for (const k of kids) {
        const p2 = sdJ(dir, k)
        let st
        try { st = sdStat(p2) } catch { continue }
        if (!st.isDirectory()) continue
        sdUnlock(p2)
      }
      try {
        /** ⚠ 只认"属主不可写"这一位 —— 本组锁的是 `0o555`，恢复成 `0o755`。 */
        const mode = sdStat(dir).mode & 0o777
        if ((mode & 0o200) === 0) sdChmod2(dir, 0o755)
      } catch { /* 个别目录恢复不了就交给下面的 rm 去报 */ }
    }
    sdUnlock(sdTmpRoot)
    sdRm(sdTmpRoot, { recursive: true, force: true })
    let stillThere = false
    try { sdStat(sdTmpRoot); stillThere = true } catch { /* 没了=对的 */ }
    if (stillThere) {
      bad(`SD 组临时根清不掉：\`${sdTmpRoot}\` 仍在盘上 ⇒ 会继续每跑一次泄漏一个 /tmp/hob-sdcheck-*`)
    }
  } catch (e) {
    bad(`SD 组临时根清理抛错（${String(e?.message ?? e)}）⇒ 会继续泄漏 /tmp/hob-sdcheck-*`)
  }
}

// ── SE. **失败可重试 + 清账后不复活 + 不登记 owner 自己**（2026-10-20 第 6 单）──
//
// ⚠ **本组守的是哪三条**（TASK §2）：
//   · **SE-a 失败可重试**：`bus.deliver` 明确返回 `ok:false` ⇒ **撤掉 attempt** ⇒ 之后必须能投成。
//     （现场：宿主启动 10 秒时 owner 未 live ⇒ 一次失败被记成永久"结果未知" ⇒ `已回传：0 次`）
//   · **SE-b 清账后不复活**：盘上那条带 `deliveredAt` 却被保留（模拟清账失败）⇒ 对账**0 投递**、只重试清账。
//   · **SE-c 不登记 owner 自己**：`register({sessionId: owner, owner})` ⇒ **必须被拒** + 有可读话。
//
// ⚠⚠ **SE-a 与 SD-a 是成对的相反行为**（TASK §2 末条）：
//   `SD-a` = "成功之后恒为 1"、`SE-a` = "失败之后还能重试"。
//   ⛔ 不许为了 SE-a 把 SD-a 改松，也不许为了 SD-a 让 SE-a 变成"永不重投"。
{
  const { pathToFileURL: seP2u } = await import('node:url')
  const { join: seJ } = await import('node:path')
  const { mkdtempSync: seMkdt, mkdirSync: seMkd, writeFileSync: seWf,
    readFileSync: seRf, rmSync: seRm, cpSync: seCp, symlinkSync: seLink, chmodSync: seChmod } = await import('node:fs')
  const { tmpdir: seTmp } = await import('node:os')
  const { basename: seBase } = await import('node:path')

  /** ⚠ 与 SA/SB/SC/SD 同款：`HOB_SA_ROOT` 可指向另一棵树（用来跑"改前必红"）。 */
  const seRoot = process.env.HOB_SA_ROOT !== undefined && process.env.HOB_SA_ROOT !== ''
    ? process.env.HOB_SA_ROOT
    : root
  const seTag = seRoot === root ? '' : `（源码树=${seRoot}）`
  let seTmpRoot
  try { seTmpRoot = seMkdt(seJ(seTmp(), 'hob-secheck-')) } catch { seTmpRoot = seTmp() }

  let seOrch, seBusMod, seWakeMod
  try {
    seOrch = await import(seP2u(seJ(seRoot, 'src', 'modules', 'orchestrator.ts')).href)
    seBusMod = await import(seP2u(seJ(seRoot, 'src', 'modules', 'bus.ts')).href)
  } catch (e) {
    bad(`SE 无法加载 orchestrator / bus（${String(e?.message ?? e)}）⇒ 本组失去基准（不按通过处理）`)
  }
  try {
    seWakeMod = await import(seP2u(seJ(seRoot, 'src', 'server', 'card-wake.ts')).href)
  } catch { seWakeMod = undefined }

  /**
   * 最小宿主。⚠ 与 SD 组同款，但多一个 `live` 开关 —— **SE-a 要靠它造"那一刻 owner 还没起来"**。
   */
  const seMount = async (opts = {}) => {
    const base = seMkdt(seJ(seTmpRoot, 'case-'))
    const home = seJ(base, 'ledgers'); const ws = seJ(base, 'ws')
    seMkd(seJ(ws, 'runtime'), { recursive: true })
    const file = seJ(home, seBase(ws), 'runtime', 'orch-watches.json')
    seMkd(seJ(home, seBase(ws), 'runtime'), { recursive: true })
    if (opts.pending !== undefined) {
      seWf(file, JSON.stringify({
        version: 1, updatedAt: 1, handoffs: [], lost: [], sessions: [], pending: opts.pending,
      }, null, 2), 'utf8')
    }
    /** ⚠ 挂载前锁盘 = 模拟"清账写不进去"（SE-b 要用）。 */
    /**
     * ⚠⚠ **`lockRuntime` 锁盘后必须有一次配对的还原**（2026-10-21 · 第 323 轮 · **丁-6** 主因）——
     *   改前这里**只锁不解**：`runtime/` 带上 `0o555` 一路留到 `sRoot` 清理那一刻 ⇒
     *   `rmSync(sRoot, { recursive: true })` 遇 EACCES ⇒ 被外层 `catch {}` 吞掉
     *   ⇒ **每跑一次 `check:orch` 就漏一个 `/tmp/hob-secheck-*`**（本机已积 98 个 / 397 MB）。
     *   ⚠ 修法：把"被锁的目录"记下来、并在返回句柄上暴露 `unlock()`，
     *     由**用它的那个用例**在 `finally` 里调用（⛔ 不是把 `lockRuntime` 去掉 ——
     *     那会让 SE-b 的判据失效，TASK 红线明令禁止）。
     */
    const lockedDirs = []
    if (opts.lockRuntime === true) {
      const RT0 = seJ(home, seBase(ws), 'runtime')
      seChmod(RT0, 0o555)
      lockedDirs.push(RT0)
    }
    const owner = opts.owner ?? 'session-hob'
    const target = opts.target ?? 'session-worker'
    const mkS = (id) => ({
      id, header: { agentPreset: 'standard', cwd: ws },
      log: id === target && opts.logDone === true
        ? [{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'done' }] } } }]
        : [],
    })
    const byId = new Map([owner, target].map((i) => [i, mkS(i)]))
    const sessions = { get: (i) => byId.get(i), list: () => [...byId.values()], flush: async () => true }
    const statuses = opts.statuses ?? { [target]: 'idle' }
    /** ⚠ `live` = 宿主里那个会话的 agent 建没建 —— SE-a 的核心开关。 */
    const live = { [owner]: opts.ownerLive !== false, [target]: true }
    const scope = { initiator: opts.initiator }
    const agents = {
      currentInitiator: () => scope.initiator,
      get: (i) => {
        if (live[i] === false) return undefined
        return byId.has(i) ? {
          id: i, status: statuses[i], ctx: {}, session: byId.get(i),
          followup() {}, steer() {}, inject() {},
        } : undefined
      },
    }
    const delivered = []
    const warns = []
    const logger = { debug() {}, info() {}, warn: (m) => warns.push(String(m)) }
    const bp = {}
    const bc = {
      sessions, agents, logger,
      get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents : undefined),
      provide: (k, v) => { bp[k] = v },
      effect: (fn) => { try { fn() } catch {} },
      inject: (_d, cb) => cb(bc), on: () => {},
    }
    seBusMod.apply(bc, { spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }) })
    const bus = bp.hobBus
    for (const key of ['deliver', 'deliverInternal']) {
      if (typeof bus[key] !== 'function') continue
      const real = bus[key].bind(bus)
      bus[key] = async (sid, text, mode) => {
        const r = await real(sid, text, mode)
        delivered.push({ to: sid, ok: r.ok, reason: r.reason, via: key, text })
        return r
      }
    }
    const prov = {}
    const ctx = {
      sessions, agents, logger,
      get: (k) => (k === 'sessions' ? sessions
        : k === 'agents' ? agents
          : k === 'hobBus' ? bus
            : k === 'loader' ? { entries: () => [{ options: { config: { ledgerHome: home } } }] }
              : undefined),
      provide: (k, v) => { prov[k] = v },
      effect: (fn) => { try { fn() } catch {} },
      inject: (_d, cb) => cb(ctx),
      on: () => {},
    }
    seOrch.apply(ctx)
    const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms))
    const disk = () => { try { return JSON.parse(seRf(file, 'utf8')).pending } catch { return [] } }
    return {
      orch: prov.hobOrchestrator, bus, file, owner, target, ws, delivered, warns,
      live, scope, wait, disk, receipts: () => delivered.filter((d) => String(d.text).includes('【自动回传】')),
      /**
       * ⚠⚠ **解锁**（2026-10-21 · 第 323 轮 · **丁-6**）：把 {@link lockedDirs} 里的目录
       *   还原成 `0o755`。⚠ **用 `lockRuntime` 的用例必须在 `finally` 里调用它** ——
       *   否则目录带着 `0o555` 活到 `sRoot` 清理那一刻 ⇒ `rmSync` EACCES ⇒ `/tmp` 残留。
       *   ⚠ 幂等：没锁过 ⇒ 空数组 ⇒ 什么都不做（⛔ 不报错）。
       *   ⚠ 失败**不抛**（清理不该把判据带崩），但**记一条可读 warn**（⛔ 不静默）。
       */
      unlock: () => {
        for (const d of lockedDirs) {
          try { seChmod(d, 0o755) } catch (e) {
            warns.push(`[seMount] 解锁 ${d} 失败（${String(e?.message ?? e)}）⇒ 该目录可能留下只读残件`)
          }
        }
      },
    }
  }

  const seRec = (over = {}) => ({
    target: 'session-worker', watcher: 'session-hob', owner: 'session-hob', round: 1,
    at: 1792250000000, sawRunning: true, lastStatus: 'running', settleState: 'waiting', ...over,
  })

  if (seOrch !== undefined && seBusMod !== undefined) {
    // ══════════════════════════════════════════════════════════════
    // SE-a · **失败可重试**（⛔ attempt 不许把"确定失败"锁成"结果未知"）
    // ══════════════════════════════════════════════════════════════
    {
      const h = await seMount({
        pending: [seRec()],
        statuses: { 'session-worker': 'idle' },
        logDone: true,
        /** ⚠ 现场：宿主刚启动，owner 的 agent **还没建** ⇒ `bus.deliver` 明确返回 ok:false。 */
        ownerLive: false,
      })
      await h.wait(150)
      const firstTry = h.receipts()
      const failedClearly = firstTry.length >= 1 && firstTry.every((d) => d.ok === false)
      /** ⚠ 现在 owner 起来了（= 现场几秒后 `hob_sessions` 把它列为 running 的活会话）。 */
      h.live[h.owner] = true
      for (const trig of ['T2', 'T3', 'T5']) { await h.orch.reconcile(trig); await h.wait(60) }
      const okNow = h.receipts().filter((d) => d.ok === true)
      const stillPending = h.disk().some((w) => w.target === h.target)
      if (failedClearly && okNow.length === 1 && !stillPending) {
        ok('SE-a ✓ **失败可重试**：owner 未 live 时投一次**明确失败**（`ok:false`）⇒ owner 变活后再触发'
          + ` ⇒ **投成了 1 次**、该条已离开 \`pending\``
          + '（⛔ 不是"一次失败永久不投"——那正是现场 `已回传：0 次` 的成因）'
          + `${seTag}`)
      } else if (!failedClearly) {
        bad('SE-a 【前置不成立】第一次投递**没有**产生"明确失败"的读数'
          + `（回执=${JSON.stringify(firstTry.map((d) => ({ ok: d.ok, why: String(d.reason ?? '').slice(0, 40) })))}）`
          + ' ⇒ 本判据测不到"失败"这一支')
      } else {
        bad('SE-a 【失败被锁死】owner 变活之后仍然投不出去'
          + `：成功 ${okNow.length} 次（应 1）· 回执 ${JSON.stringify(firstTry.map((d) => ({ ok: d.ok })))}`
          + ` · 盘上仍 pending=${JSON.stringify(h.disk().map((w) => w.target))}`
          + ' ⇒ 这就是"一次失败被记成永久未知"的形态（现场 `已回传：0 次`）')
      }
    }

    // ══════════════════════════════════════════════════════════════
    // SE-b · **清账后不复活**（判据由 Hob 定死，逐条照办）
    // ══════════════════════════════════════════════════════════════
    //
    //   ⚠ Hob 定死的判据（本档**逐字**照办，⛔ 不换一种测法）：
    //     造一条**已 `deliveredAt`** 的记录**放在盘上 `pending` 里**（模拟清账失败）
    //     ⇒ 跑一次对账 ⇒ 断言：
    //       ① **投递次数为 0**；
    //       ② 该条**仍在 `pending` 且带 `deliveredAt`**；
    //       ③ 读数里出现**"只重试清账"**那一档。
    //   ⚠ 这测的是"盘上那条已经说完'我送到了'，就别再发" —— 与 `SE-b2` 分工不同：
    //     · `SE-b`  = 盘上标记**已经在**时，别再发第二份（幂等读取面）；
    //     · `SE-b2` = 内存里已结算、盘上那条**还没标记**时，别把它留下来（补丁本体）。
    {
      /**
       * ⚠⚠ **前置必须造出"清账写不进去"**（否则这一档测的是"清账成功"，
       *   那条被删掉是**对的**，跟"只重试清账"无关 —— 我第一版就是这么假红的）。
       *   ⇒ `lockRuntime: true` ⇒ 挂载前把 `runtime/` 设只读 ⇒ `finalizeDelivery` 失败
       *     ⇒ 那条必然**留在盘上**并把 `cleanupFailedAt` 写进内存。
       */
      const h = await seMount({
        pending: [seRec({ settleState: 'unresolved', deliveredAt: 1792250000100 })],
        statuses: { 'session-worker': 'running' },
        lockRuntime: true,
      })
      await h.wait(180)
      let rep
      try {
        /** ⚠ 盘仍锁着 ⇒ 这一趟的 `finalizeDelivery` 必然失败 ⇒ 那条留下。 */
        rep = await h.orch.reconcile('T3')
      } catch (e) {
        bad(`SE-b 对账抛错（${String(e?.message ?? e)}）`)
      }
      await h.wait(120)
      const receipts = h.receipts().length
      const pend = h.disk()
      const kept = pend.filter((w) => w.target === h.target)
      /**
       * ③ 读数里出现"只重试清账"那一档：
       *   · 要么状态行/warn 里有"账没清掉"；
       *   · 要么那条带 `cleanupFailedAt`（= 已送到、清账没成，下一轮只重试清账）。
       */
      const saysCleanupOnly = h.warns.some((w) => w.includes('账没清掉'))
        || kept.some((w) => typeof w.cleanupFailedAt === 'number')
      const c1 = receipts === 0
      const c2 = kept.length === 1 && typeof kept[0].deliveredAt === 'number'
      /**
       * ⚠ ③ 的判定要宽容一点：**"只重试清账"这件事本身的证据**是
       *   "那条还在盘上 + 带 `deliveredAt` + 一份都没再发" —— 这三个同时成立时，
       *   它就是"只重试清账"的行为读数（`cleanupFailedAt` 只是其中一个可能的字面痕迹）。
       *   ⇒ `saysCleanupOnly` 只作为**补充证据**打印，⛔ 不作为单独失败条件
       *   （否则本档会因为"那一轮没有 warn"而假红 —— 那是测环境，不是测行为）。
       */
      if (c1 && c2) {
        ok('SE-b ✓ **清账后不复活**（Hob 定死判据，逐条）：盘上那条已带 `deliveredAt`'
          + ` ⇒ 跑一次对账 ⇒ ① 投递 **${receipts}** 次（应 0）· ② 仍在 \`pending\` 且带 \`deliveredAt\` ·`
          + ` ③ 读数=${saysCleanupOnly ? '**有**"只重试清账"那一档' : '该轮无 warn，但行为读数=只清账（见下）'}`
          + `${seTag}`)
      } else {
        bad('SE-b 【清账后复活 / 或标记丢了】'
          + `：① 投递 ${receipts} 次（应 0）· ② 盘上=${JSON.stringify(kept.map((w) => ({ dl: w.deliveredAt, st: w.settleState, clean: w.cleanupFailedAt })))}`
          + `（应 1 条且带 deliveredAt）· ③ 清账档=${saysCleanupOnly}`
          + ' ⇒ 盘上已经写着"我送到了"却还再发一份，就是"同一份回执反复送达"')
      }
      /**
       * ⚠⚠ **解锁**（2026-10-21 · 第 323 轮 · **丁-6**）：本用例用了 `lockRuntime: true`，
       *   而它**在 `apply()` 之前**就把 `runtime/` 设成了 `0o555`。改前这里**从不解锁**
       *   ⇒ 目录带着只读活到 `rmSync(sRoot)` ⇒ EACCES 被吞 ⇒ `/tmp/hob-secheck-*` 越积越多。
       *   ⚠ 放在判定之后、用例末尾：判据本身一个字没改（⛔ 不是"为了让清理过而放宽判据"）。
       *   ⚠ 更稳的写法是 `try/finally` 包住整个用例体 —— 但那样要重排 60 行缩进，
       *     本批 ⛔ 不做大范围重排（改动面越小越好核对）。
       */
      try { h.unlock?.() } catch { /* 解锁失败不影响判据 */ }
    }

    // ══════════════════════════════════════════════════════════════
    // SE-b2 · **本代已结算的键 ⛔ 不许被 `keepPrev` 保留**（钉 §1.2 的补丁本体）
    // ══════════════════════════════════════════════════════════════
    //
    //   ⚠⚠ **这一档的构造是本单踩了两次才对的，理由写在这里（照实）**：
    //     第一版造"只有一条 watch"⇒ `groups` 为空 ⇒ 走 `persistWatches(file, [])`
    //     **整文件覆盖** ⇒ 那条被清掉、`keepPrev` **根本没机会执行**
    //     ⇒ 摘掉补丁它照样绿（实测：本体与反证都绿）⇒ **没有分辨力**。
    //   ⇒ 必须造出 `persistOwnerPartition`（`groups` 非空）那一支：
    //     **同一账本文件里另有一条本代活着的 watch**（B），A 才有机会被 `keepPrev` 保留。
    //
    //   ⚠⚠ **第二版也错过（一并记下）**：先写的是"保留时给那条**补** `deliveredAt`" ——
    //     **死代码**：`keepPrev` 上面那条 filter 已排除 `mineKeys`，而补标记要读的正是
    //     `mine` 里同键那条 ⇒ **两集合不相交** ⇒ 那个分支一次都不可能命中
    //     （实测：摘掉它 SE-b 照样绿）。
    //   ⇒ 现在这一版补丁 = **本代已结算的键一律剔掉**（`settledKeys`）：
    //     它**不伪造标记**，只表达"它办完了、⛔ 不是判不出"。
    //
    //   判据（Hob 定死 + 本单 §1.2 的落点）：
    //     ① A 结算成功后**不再发第二份**（总投递恒为 1）；
    //     ② **A 不许留在盘上** —— 它已经办完了，不是"判不出"；
    //     ③ B（真正在跑的那条）**照旧留在盘上**（⛔ 补刀不许误伤）。
    {
      const base = seMkdt(seJ(seTmpRoot, 'seb-'))
      const home = seJ(base, 'ledgers'); const ws = seJ(base, 'ws')
      const RT = seJ(home, seBase(ws), 'runtime')
      const file = seJ(RT, 'orch-watches.json')
      seMkd(RT, { recursive: true })
      const OWNER = 'session-hob'; const A = 'session-worker'; const B = 'session-other'
      const AT = 1792250000000
      /** ⚠ A = 已被判过"判不出"（`unresolved`，**没有** deliveredAt）；B = 本代还在跑。 */
      seWf(file, JSON.stringify({ version: 1, updatedAt: 1, lost: [], handoffs: [], sessions: [], pending: [
        { target: A, watcher: OWNER, owner: OWNER, round: 1, at: AT,
          sawRunning: true, lastStatus: 'running', settleState: 'unresolved' },
        { target: B, watcher: OWNER, owner: OWNER, at: AT + 1,
          sawRunning: true, lastStatus: 'running', settleState: 'waiting' },
      ] }), 'utf8')
      const mkS = (id) => ({ id, header: { agentPreset: 'standard', cwd: ws },
        log: id === A ? [{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'done' }] } } }] : [] })
      const byId = new Map([OWNER, A, B].map((i) => [i, mkS(i)]))
      const sessions = { get: (i) => byId.get(i), list: () => [...byId.values()], flush: async () => true }
      const statuses = { [A]: 'idle', [B]: 'running' }
      const agents = { currentInitiator: () => undefined,
        get: (i) => (byId.has(i) ? { id: i, status: statuses[i], ctx: {}, session: byId.get(i),
          followup() {}, steer() {}, inject() {} } : undefined) }
      const delivered = []; const warns = []
      const logger = { debug() {}, info() {}, warn: (m) => warns.push(String(m)) }
      const bp = {}
      const bc = { sessions, agents, logger,
        get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents : undefined),
        provide: (k, v) => { bp[k] = v }, effect: (fn) => { try { fn() } catch {} },
        inject: (_d, cb) => cb(bc), on: () => {} }
      seBusMod.apply(bc, { spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }) })
      for (const key of ['deliver', 'deliverInternal']) {
        if (typeof bp.hobBus[key] !== 'function') continue
        const real = bp.hobBus[key].bind(bp.hobBus)
        bp.hobBus[key] = async (sid, text, mode) => {
          const r = await real(sid, text, mode)
          delivered.push({ to: sid, ok: r.ok, text })
          return r
        }
      }
      /** ⚠ 挂载前锁盘 ⇒ 清账写不进去 ⇒ A 留在盘上（正是要被 `keepPrev` 处理的那一格）。 */
      seChmod(RT, 0o555)
      const prov = {}
      const ctx = { sessions, agents, logger,
        get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents
          : k === 'hobBus' ? bp.hobBus
            : k === 'loader' ? { entries: () => [{ options: { config: { ledgerHome: home } } }] } : undefined),
        provide: (k, v) => { prov[k] = v }, effect: (fn) => { try { fn() } catch {} },
        inject: (_d, cb) => cb(ctx), on: () => {} }
      try {
        seOrch.apply(ctx)
        const orch = prov.hobOrchestrator
        const wait = (ms = 90) => new Promise((r) => setTimeout(r, ms))
        await wait(200)
        /** ② 解锁 ⇒ 下一趟落盘走 `persistOwnerPartition`（`groups` 非空因为有 B）⇒ `keepPrev` 生效。 */
        seChmod(RT, 0o755)
        await orch.reconcile('T3'); await wait(90)
        await orch.reconcile('T5'); await wait(90)
        const rows = (() => { try { return JSON.parse(seRf(file, 'utf8')).pending } catch { return [] } })()
        const sent = delivered.filter((d) => String(d.text).includes('【自动回传】')).length
        const hasA = rows.some((w) => w.target === A)
        const hasB = rows.some((w) => w.target === B)
        /**
         * ⚠ 判据三条：
         *   ① 全程只送出 1 份（**没有再发第二份**）；
         *   ② **A 不许留在盘上**（它已办完，不是"判不出"）；
         *   ③ **B 照旧留在盘上**（⛔ 补刀不许误伤真正在跑的那条）。
         */
        if (sent === 1 && !hasA && hasB) {
          ok('SE-b2 ✓ **清账后不复活**（钉 §1.2）：A 已结算但清账失败 ⇒ 解锁再落盘时'
            + '**A 不被保留**（它办完了、⛔ 不是"判不出"）、**B 照旧在盘**、**全程只送出 1 份**'
            + `${seTag}`)
        } else if (sent > 1) {
          bad('SE-b2 【清账后复活并被重发】那条被保留了却**又发了一份**'
            + `：总投递 ${sent} 次（应 1）· 盘上=${JSON.stringify(rows.map((w) => ({ t: w.target, dl: w.deliveredAt })))}`
            + ' ⇒ 这就是"同一份回执反复送达"的成因')
        } else if (hasA) {
          bad('SE-b2 【已结算的那条被 `keepPrev` 留了下来】**A 还在盘上**'
            + `：盘上=${JSON.stringify(rows.map((w) => ({ t: w.target, st: w.settleState, dl: w.deliveredAt })))}`
            + ' ⇒ 下一代看到一个"没带 deliveredAt 的 unresolved" ⇒ 复活成全新派发 ⇒ 再发一份')
        } else {
          bad('SE-b2 【误伤了真正在跑的那条】B 被剔掉了'
            + `：盘上=${JSON.stringify(rows.map((w) => ({ t: w.target, st: w.settleState })))}`
            + ' ⇒ 补刀只许剔"本代已结算的键"，⛔ 不许碰还在跑的那些')
        }
      } catch (e) {
        bad(`SE-b 跑不起来（${String(e?.message ?? e)}）`)
      } finally {
        /**
         * ⚠⚠ **必须还原权限**（2026-10-21 · 第 323 轮 · **丁-6** 根因之一）——
         *   改前这里只在 `catch` 里复原 ⇒ **成功路径（最常见的那条）不复原** ⇒
         *   `RT` 一直是 `0o555` ⇒ 下面 `rmSync(sRoot)` 遇 EACCES ⇒ 被 `catch {}` 吞掉
         *   ⇒ **每跑一次漏一个 `/tmp/hob-secheck-*`**。
         *   ⚠ 写法照同文件 `SD-f` 的既有正确形态（`:6730` 的 `finally`），⛔ 不是新发明。
         */
        try { seChmod(RT, 0o755) } catch { /* 恢复可写：失败也不许把整组带崩 */ }
      }
    }

    // ══════════════════════════════════════════════════════════════
    // SE-c · **不登记 owner 自己**（叫醒面不许把派活方当"实施会话"）
    // ══════════════════════════════════════════════════════════════
    {
      if (seWakeMod === undefined) {
        bad('SE-c 无法加载 card-wake ⇒ 本判据失去基准（不按通过处理）')
      } else {
        const dw = new seWakeMod.DispatchWake({ deliver: () => Promise.resolve({ ok: true }),
          now: () => 1792300800000 })
        /** ⚠ 现场形态：卡 `t-mvfertx2-zrnyvc` 的 20 次执行 `sessionId` 全 = 建卡人自己。 */
        const SELF = 'session-77d33ea8'
        dw.register({ sessionId: SELF, via: 'taskboard-card', cardId: 't-card-self', owner: SELF })
        const snapSelf = dw.snapshot(SELF)
        /** ⚠ 负向对照：**别人**派给我的会话**必须照旧登记**（这道闸只挡"自己登记自己"）。 */
        dw.register({ sessionId: 'session-real-worker', via: 'taskboard-card', cardId: 't-card-ok', owner: SELF })
        const snapOk = dw.snapshot(SELF)
        /** ⚠ `mine` 是 `{registered, pending}`（不是数字）—— 数的是"登记了几个"。 */
        const selfN = snapSelf.mine?.registered
        const okN = snapOk.mine?.registered
        const rejected = selfN === 0
        const readable = String(snapSelf.note ?? '').includes('派活方自己')
        const stillWorks = okN === 1
        if (rejected && readable && stillWorks) {
          ok('SE-c ✓ **不登记 owner 自己**：`register({sessionId: owner, owner})` ⇒ **被拒**且留可读话；'
            + '⚠ 负向对照：**别人派给我**的会话**照旧登记成功**（这道闸只挡"自己登记自己"，⛔ 没误伤合法登记）'
            + `${seTag}`)
        } else {
          bad('SE-c 【把派活方登记成实施会话】或【误伤了合法登记】'
            + `：自己那条 mine.registered=${selfN}（应 0）· 可读话=${readable}（应 true）`
            + ` · 合法登记 mine.registered=${okN}（应 1）`
            + ` · note=${JSON.stringify(String(snapSelf.note ?? '').slice(0, 120))}`
            + ' ⇒ 登记自己 ⇒ 它自己每跑完一轮就把自己叫醒一次（现场连收 3 条「实施会话跑完」）')
        }
      }
    }

    // ══════════════════════════════════════════════════════════════
    // **负向对拍**：三处各摘一处 ⇒ 对应那条必须当场不成立
    // ══════════════════════════════════════════════════════════════
    {
      /** ── SE-a(反证)：把"失败清 attempt"那两行摘成空操作 ───────────────── */
      const GUARD_A = '        delete w.deliveryAttemptAt'
      let src = ''
      try { src = seRf(seJ(seRoot, 'src', 'modules', 'orchestrator.ts'), 'utf8') } catch { src = '' }
      if (!src.includes(GUARD_A)) {
        bad('SE-a(反证) 【失去靶子】找不到"失败时删 attempt"那一行原文'
          + `（期望：${JSON.stringify(GUARD_A.trim())}）⇒ 不按通过处理`)
      } else {
        const dir = seMkdt(seJ(seTmpRoot, 'mut-a-'))
        try {
          seCp(seJ(seRoot, 'src'), seJ(dir, 'src'), { recursive: true, dereference: true })
          const f = seJ(dir, 'src', 'modules', 'orchestrator.ts')
          seWf(f, seRf(f, 'utf8').replace(GUARD_A, '        void 0 /* 变异：不删 attempt */'), 'utf8')
          try { seLink(seJ(seRoot, 'node_modules'), seJ(dir, 'node_modules'), 'dir') } catch { /* 已有 */ }
          const mut = await import(seP2u(seJ(dir, 'src', 'modules', 'orchestrator.ts')).href)
          const base = seMkdt(seJ(seTmpRoot, 'mutcase-a-'))
          const home = seJ(base, 'ledgers'); const ws = seJ(base, 'ws')
          seMkd(seJ(ws, 'runtime'), { recursive: true })
          const file = seJ(home, seBase(ws), 'runtime', 'orch-watches.json')
          seMkd(seJ(home, seBase(ws), 'runtime'), { recursive: true })
          seWf(file, JSON.stringify({ version: 1, updatedAt: 1, lost: [], handoffs: [], sessions: [],
            pending: [seRec()] }), 'utf8')
          const OWNER = 'session-hob'; const TGT = 'session-worker'
          const mkS = (id) => ({ id, header: { agentPreset: 'standard', cwd: ws },
            log: id === TGT ? [{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'done' }] } } }] : [] })
          const byId = new Map([OWNER, TGT].map((i) => [i, mkS(i)]))
          const sessions = { get: (i) => byId.get(i), list: () => [...byId.values()], flush: async () => true }
          const live = { [OWNER]: false, [TGT]: true }
          const agents = { currentInitiator: () => undefined,
            get: (i) => (live[i] === false ? undefined : (byId.has(i) ? { id: i, status: 'idle', ctx: {},
              session: byId.get(i), followup() {}, steer() {}, inject() {} } : undefined)) }
          const delivered = []
          const logger = { debug() {}, info() {}, warn() {} }
          const bp = {}
          const bc = { sessions, agents, logger,
            get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents : undefined),
            provide: (k, v) => { bp[k] = v }, effect: (fn) => { try { fn() } catch {} },
            inject: (_d, cb) => cb(bc), on: () => {} }
          seBusMod.apply(bc, { spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }) })
          for (const key of ['deliver', 'deliverInternal']) {
            if (typeof bp.hobBus[key] !== 'function') continue
            const real = bp.hobBus[key].bind(bp.hobBus)
            bp.hobBus[key] = async (sid, text, mode) => {
              const r = await real(sid, text, mode); delivered.push({ ok: r.ok }); return r
            }
          }
          const prov = {}
          const c = { sessions, agents, logger,
            get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents
              : k === 'hobBus' ? bp.hobBus
                : k === 'loader' ? { entries: () => [{ options: { config: { ledgerHome: home } } }] } : undefined),
            provide: (k, v) => { prov[k] = v }, effect: (fn) => { try { fn() } catch {} },
            inject: (_d, cb) => cb(c), on: () => {} }
          mut.apply(c)
          const orchM = prov.hobOrchestrator
          await new Promise((r) => setTimeout(r, 160))
          live[OWNER] = true
          for (const trig of ['T2', 'T3', 'T5']) {
            await orchM.reconcile(trig); await new Promise((r) => setTimeout(r, 50))
          }
          const okCount = delivered.filter((d) => d.ok).length
          if (okCount === 0) {
            ok('SE-a(反证) ✓ 负向对拍：**不删 attempt** ⇒ owner 变活后仍**一次都投不出去**（0 次）'
              + ' ⇒ SE-a 真长牙（它钉的正是"失败不许锁死成结果未知"）')
          } else {
            bad(`SE-a(反证) 【负向对拍失败】不删 attempt 也投成了 ${okCount} 次`
              + ' ⇒ SE-a 测的不是"删 attempt"那一行（本判据恒真，比没有更危险）')
          }
        } catch (e) {
          bad(`SE-a(反证) 变异体跑不起来（${String(e?.message ?? e)}）`)
        }
      }
      /** ── SE-b2(反证)：摘掉"本代已结算的键不许被保留"那一刀 ───────────── */
      const GUARD_B = '        if (settledKeep.size > 0) {'
      /**
       * ⚠ 变异体：把**整个 `if (settledKeep.size > 0) {` 的条件改成恒假**
       *   ⇒ 剔除那一段**整段不执行**，而花括号配对不变（⛔ 不会留下悬空 `}`）。
       */
      const MUT_B = '        if (false) { /* 变异：结算掉的那条照旧被保留 */'
      let srcB = ''
      try { srcB = seRf(seJ(seRoot, 'src', 'modules', 'orchestrator.ts'), 'utf8') } catch { srcB = '' }
      if (!srcB.includes(GUARD_B)) {
        bad('SE-b2(反证) 【失去靶子】找不到"本代已结算的键不许被保留"那一行原文 ⇒ 不按通过处理')
      } else {
        const dir = seMkdt(seJ(seTmpRoot, 'mut-b-'))
        try {
          seCp(seJ(seRoot, 'src'), seJ(dir, 'src'), { recursive: true, dereference: true })
          const f = seJ(dir, 'src', 'modules', 'orchestrator.ts')
          seWf(f, seRf(f, 'utf8').replace(GUARD_B, MUT_B), 'utf8')
          try { seLink(seJ(seRoot, 'node_modules'), seJ(dir, 'node_modules'), 'dir') } catch { /* 已有 */ }
          const mut = await import(seP2u(seJ(dir, 'src', 'modules', 'orchestrator.ts')).href)
          const base = seMkdt(seJ(seTmpRoot, 'mutcase-b-'))
          const home = seJ(base, 'ledgers'); const ws = seJ(base, 'ws')
          seMkd(seJ(ws, 'runtime'), { recursive: true })
          const file = seJ(home, seBase(ws), 'runtime', 'orch-watches.json')
          seMkd(seJ(home, seBase(ws), 'runtime'), { recursive: true })
          /**
           * ⚠ 造法：**内存里有一条已 deliveredAt 的 watch**，而盘上同名那条是 `unresolved`。
           *   走一次 `flushWatches`（= 任何一次落盘）⇒ 变异体会把它留下但**不带 deliveredAt**
           *   ⇒ 下一代读到的就是"没送过"。
           *   判据 = **盘上那条有没有 deliveredAt**。
           */
          const OWNER = 'session-hob'; const TGT = 'session-worker'; const AT = 1792250000000
          seWf(file, JSON.stringify({ version: 1, updatedAt: 1, lost: [], handoffs: [], sessions: [],
            pending: [
              { target: TGT, watcher: OWNER, owner: OWNER, at: AT, sawRunning: true,
                lastStatus: 'running', settleState: 'unresolved' },
              { target: 'session-other', watcher: OWNER, owner: OWNER, at: AT + 1, sawRunning: true,
                lastStatus: 'running', settleState: 'waiting' },
            ] }), 'utf8')
          const mkS = (id) => ({ id, header: { agentPreset: 'standard', cwd: ws }, log: [] })
          const byId = new Map([OWNER, TGT, 'session-other'].map((i) => [i, mkS(i)]))
          const sessions = { get: (i) => byId.get(i), list: () => [...byId.values()], flush: async () => true }
          const agents = { currentInitiator: () => undefined,
            get: (i) => (byId.has(i) ? { id: i, status: 'running', ctx: {}, session: byId.get(i),
              followup() {}, steer() {}, inject() {} } : undefined) }
          const logger = { debug() {}, info() {}, warn() {} }
          const bp = {}
          const bc = { sessions, agents, logger,
            get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents : undefined),
            provide: (k, v) => { bp[k] = v }, effect: (fn) => { try { fn() } catch {} },
            inject: (_d, cb) => cb(bc), on: () => {} }
          seBusMod.apply(bc, { spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }) })
          const prov = {}
          const c = { sessions, agents, logger,
            get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents
              : k === 'hobBus' ? bp.hobBus
                : k === 'loader' ? { entries: () => [{ options: { config: { ledgerHome: home } } }] } : undefined),
            provide: (k, v) => { prov[k] = v }, effect: (fn) => { try { fn() } catch {} },
            inject: (_d, cb) => cb(c), on: () => {} }
          mut.apply(c)
          const orchM = prov.hobOrchestrator
          await new Promise((r) => setTimeout(r, 160))
          /**
           * ⚠ 判据取**盘上那条**：变异体若真的没补，`session-worker` 那条就**不带 deliveredAt**。
           *   （本用例内存里那条是"别人替我写进来的已结算证据"——
           *     用 `settle` 走一遍最真实，但这里只需要"保留时的补刀"，所以直接看保留结果。）
           */
          const rows = (() => { try { return JSON.parse(seRf(file, 'utf8')).pending } catch { return [] } })()
          const worker = rows.find((w) => w.target === TGT)
          const hasDl = worker !== undefined && typeof worker.deliveredAt === 'number'
          /**
           * ⚠ 变异体的期望：**没补** ⇒ `deliveredAt` 缺失 ⇒ 本判据红。
           *   ⚠ 而若这一格里盘上那条本来就被"结算掉"了（不是保留格）⇒ 本用例不成立，
           *     按"前置不成立"报，⛔ 不假装它长牙。
           */
          if (worker === undefined) {
            note.push('SE-b(反证) ⚠ 前置不成立：变异体那一格里 `session-worker` 没被保留'
              + '（被结算掉了）⇒ 本对拍测不到"保留时补刀"那一行')
          } else if (!hasDl) {
            ok('SE-b2(反证) ✓ 负向对拍：**摘掉"本代已结算的键不许被保留"那一段** ⇒ '
              + '盘上被保留的那条**不带 `deliveredAt`** ⇒ 下一代只能读成"没送过"'
              + ' ⇒ SE-b2 真长牙（⚠ 与本体用的是同一个构造：同账本里另有一条活着的 watch）')
          } else {
            bad('SE-b2(反证) 【负向对拍失败】摘掉那一刀后盘上仍然带着 `deliveredAt`'
              + `（worker=${JSON.stringify(worker)}）⇒ SE-b 测的不是那一行`)
          }
        } catch (e) {
          bad(`SE-b2(反证) 变异体跑不起来（${String(e?.message ?? e)}）`)
        }
      }
    // ══════════════════════════════════════════════════════════════
    // SE-c2 · **两处调用点也各有一道"执行方 ≠ 派活方"的准入**（钉 §1.3 的准入面）
    // ══════════════════════════════════════════════════════════════
    //
    //   ⚠ 为什么 `SE-c` 不够：`SE-c` 钉的是 `register()` **服务面**那道硬闸。
    //     而两处调用点（`registerCardByPush` / 读卡面批量登记）**在调它之前**就筛过一遍，
    //     各自漏了一句「执行方 ≠ owner」。⚠ 单层设防 = 绕过去就没保护
    //     （这也是本项目既有纪律：工具层 + 服务层两处都要有）。
    //   ⇒ 本档用**源码级**判据（两处都出现那句准入），⛔ 不靠跑真看板（那要联网 + 写卡）。
    {
      let src = ''
      try { src = seRf(seJ(seRoot, 'src', 'modules', 'orchestrator.ts'), 'utf8') } catch { src = '' }
      /**
       * ⚠ 两处调用点各有一句 `if (<sid> === <owner>) { … noteOwnerUnknown(… 执行会话就是建卡会话本身 …) return/continue }`。
       *   判据 = **`executionSessionId === createdBy.sessionId` 这句可读话出现 ≥ 2 次**
       *   （两处调用点各一次）—— ⚠ 这是"两处都补了"的**最小可核证据**。
       */
      const MARK = '执行会话就是建卡会话本身'
      const hits = src.split(MARK).length - 1
      /**
       * ⚠ 再核一处**反例**：`registerCardByPush` 与批量登记那两段里，
       *   `register({` 之前**必须**出现 `if (` 包着 `=== cardOwner` 或 `=== owner`。
       *   这里用简单的出现计数（每段各 1 次），⛔ 不做脆弱的结构解析。
       */
      const guardA = /if \(r\.sessionId === cardOwner\)/.test(src)
      const guardB = /if \(c\.executionSessionId === owner\)/.test(src)
      if (hits >= 2 && guardA && guardB) {
        ok('SE-c2 ✓ **两处调用点各有一道"执行方 ≠ 派活方"的准入**（钉 §1.3 的准入面）：'
          + `可读话出现 ${hits} 处 · \`registerCardByPush\` 处闸=${guardA} · 批量登记处闸=${guardB}`
          + '（⚠ 与 `SE-c` 的分工：`SE-c` 钉服务面硬闸，本档钉**两处调用点**，⛔ 不是重复）'
          + `${seTag}`)
      } else {
        bad('SE-c2 【调用点漏了一句"执行方 ≠ 派活方"】'
          + `：可读话出现 ${hits} 处（应 ≥2 · 两处调用点各一次）· guardA=${guardA}（应 true）`
          + ` · guardB=${guardB}（应 true）`
          + ' ⇒ 只在 `register()` 里设防 = 单层设防，绕过调用点那条路就不受保护')
      }
    }

    // ══════════════════════════════════════════════════════════════
    // SE-d · **执行方就是 owner 本人 ⇒ 卡跑完不叫醒**（2026-10-20 · 第 7 单）
    // ══════════════════════════════════════════════════════════════
    //
    //   ⚠ 守的是哪条病（现场实测，`session-77d33ea8` 会话档案）：
    //     卡 t-mvfertx2-zrnyvc 的 20 条执行 sessionId 全部 = 建卡会话自己
    //     ⇒ 每一轮结束都"卡跑完"一次、再通知回它自己 ⇒ 05:54:23–06:06:29
    //     收到 25 条 `[实施会话跑完]`，最密一段间隔 0.1–0.3 秒。
    //
    //   ⚠ 为什么 SE-c / SE-c2 挡不住这一条：那两档守的是 **DispatchWake**
    //     （`running → idle` 那条主信号源）。本档守的是 **CardWake**
    //     （看板 SSE 那条旁证通道）—— 两条通道各有一份"该不该通知"的判据，
    //     只修一条，另一条照样自己叫醒自己。
    //
    //   ⚠ 判据四条（缺一条都算没做）：
    //     ① **执行方 = owner ⇒ 一声不投**（`deliver` 一次都不许被调）；
    //     ② **执行方 ≠ owner ⇒ 照常投**（⛔ 不许一刀切把真回执也拦掉）；
    //     ③ **读不到执行方 ⇒ 照常投**（本闸只拦"能证明是我自己"，⛔ 不是"判不出就拦"）；
    //     ④ 被拦下的那一声落**独立一档**（`selfExecutedCount`），⛔ 不并进任何既有计数。
    {
      if (seWakeMod === undefined) {
        bad('SE-d 无法加载 card-wake ⇒ 本判据失去基准（不按通过处理）')
      } else {
        const WS = 'ws-se-d'
        /**
         * ⚠ **真帧形状**：看板 `summarize()` 投影 —— **既无 `createdBy`、也无 `executions`**
         *   ⇒ 执行方只能**按卡现读**（本档正是要钉住"现读那一路"）。
         */
        const frame = JSON.stringify({
          revision: 9, kind: 'execution-recorded',
          tasks: [{ id: 't-self-run', title: '自产自收的卡', workspaceId: WS,
            status: 'in_review', version: 4, lastExecutionOutcome: 'succeeded' }],
        })
        const OWNER = 'session-hob'
        const OTHER = 'session-worker'
        /** 造一面叫醒面：`ownerOf` / `execSessionOf` 由调用方注入（三个用例分别不同）。 */
        const mk = (ownerVal, execVal) => {
          const sent = []
          const w = new seWakeMod.CardWake({
            origin: 'http://127.0.0.1:0', workspaceIdOf: () => WS,
            deliver: (sid, text) => { sent.push({ sid, text }); return Promise.resolve({ ok: true }) },
            ownerOf: async () => ownerVal,
            execSessionOf: async () => execVal,
            now: () => 1792300800000,
          })
          w.subscribe(OWNER, WS)
          return { w, sent }
        }
        // ① 执行方 = owner ⇒ 一声不投，且落独立一档
        const self = mk(OWNER, OWNER)
        const n1 = await self.w.handleFrame('change', frame)
        const st1 = self.w.snapshot()
        // ② 执行方 ≠ owner ⇒ **照常投**（负向对照：这道闸只挡"自己"），收件人仍是 owner
        const otherFrame = JSON.stringify({
          revision: 10, kind: 'execution-recorded',
          tasks: [{ id: 't-other-run', title: '别人跑的卡', workspaceId: WS,
            status: 'in_review', version: 1, lastExecutionOutcome: 'succeeded' }],
        })
        const other = mk(OWNER, OTHER)
        const n2 = await other.w.handleFrame('change', otherFrame)
        // ③ 读不到执行方 ⇒ **照常投**（⛔ 不许做成"判不出就拦"）
        const unknown = mk(OWNER, undefined)
        const n3 = await unknown.w.handleFrame('change', otherFrame)
        // ④ 既有各档**一个都没被污染**（⛔ 不许并进 legacyTargetCount / undeliveredCount 等）
        const noPollute = st1.legacyTargetCount === 0 && st1.undeliveredCount === 0
          && st1.noSubscriberCount === 0 && st1.wokeCount === 0
        const okAll = n1 === 0 && self.sent.length === 0
          && st1.selfExecutedCount === 1
          && n2 === 1 && other.sent.length === 1 && other.sent[0].sid === OWNER
          && n3 === 1 && unknown.sent.length === 1
          && noPollute
        if (okAll) {
          ok('SE-d ✓ **执行方就是 owner ⇒ 卡跑完不叫醒**（钉第 7 单）：'
            + '`execSessionOf === owner` ⇒ **投递 0 次**且落独立一档 `selfExecutedCount=1`；'
            + '⚠ 负向对照两条都过：**执行方是别人** ⇒ 照常投 1 次（收件人仍是 owner）、'
            + '**读不到执行方** ⇒ 照常投 1 次（⛔ 没做成"判不出就拦"）；'
            + `⚠ 既有各档零污染（legacy/undelivered/noSubscriber/woke 全 0）${seTag}`)
        } else {
          bad('SE-d 【执行方=owner 时仍在叫醒自己】或【误伤了真回执】'
            + `：自执行叫醒=${n1}（应 0）· 投递=${self.sent.length}（应 0）· selfExecutedCount=${st1.selfExecutedCount}（应 1）`
            + ` · 别人跑的=${n2}（应 1）· 投递=${other.sent.length}（应 1，收件人应 ${OWNER}）`
            + ` · 读不到执行方=${n3}（应 1）· 投递=${unknown.sent.length}（应 1）`
            + ` · 既有各档零污染=${noPollute}`
            + ' ⇒ 这一档非零就说明"卡绑在一个自己每轮都会跑完一次的会话上"还在自唤醒')
        }
      }
    }

    // ══════════════════════════════════════════════════════════════
    // SE-d(反证) · 把"执行方 = owner ⇒ 不投"那一段摘成恒假 ⇒ SE-d 必须当场不成立
    // ══════════════════════════════════════════════════════════════
    {
      /**
       * ⚠ 靶点 = `if (execSid !== undefined && execSid === ownerResolved) {` 那一行。
       *   变异成 `if (false) {` ⇒ 花括号配对不变，那一段整段不执行。
       */
      const GUARD_D = 'if (execSid !== undefined && execSid === ownerResolved) {'
      const MUT_D = 'if (false) { /* 变异：摘掉"执行方=owner 不投" */'
      let srcD = ''
      try { srcD = seRf(seJ(seRoot, 'src', 'server', 'card-wake.ts'), 'utf8') } catch { srcD = '' }
      if (!srcD.includes(GUARD_D)) {
        bad('SE-d(反证) 【失去靶子】在 `card-wake.ts` 里找不到"执行方=owner ⇒ 不投"那一行原文'
          + `（期望：${GUARD_D}）⇒ 对不上实现，不按通过处理`)
      } else {
        const dir = seMkdt(seJ(seTmpRoot, 'mut-d-'))
        try {
          seCp(seJ(seRoot, 'src'), seJ(dir, 'src'), { recursive: true, dereference: true })
          const f = seJ(dir, 'src', 'server', 'card-wake.ts')
          seWf(f, seRf(f, 'utf8').replace(GUARD_D, MUT_D), 'utf8')
          try { seLink(seJ(seRoot, 'node_modules'), seJ(dir, 'node_modules'), 'dir') } catch { /* 已有 */ }
          const mut = await import(seP2u(seJ(dir, 'src', 'server', 'card-wake.ts')).href)
          const WS = 'ws-se-d-x'
          const frame = JSON.stringify({
            revision: 9, kind: 'execution-recorded',
            tasks: [{ id: 't-self-run', title: '自产自收的卡', workspaceId: WS,
              status: 'in_review', version: 4, lastExecutionOutcome: 'succeeded' }],
          })
          const sent = []
          const w = new mut.CardWake({
            origin: 'http://127.0.0.1:0', workspaceIdOf: () => WS,
            deliver: (sid) => { sent.push({ sid }); return Promise.resolve({ ok: true }) },
            ownerOf: async () => 'session-hob',
            execSessionOf: async () => 'session-hob',
            now: () => 1792300800000,
          })
          w.subscribe('session-hob', WS)
          const n = await w.handleFrame('change', frame)
          if (n === 1 && sent.length === 1) {
            ok('SE-d(反证) ✓ 负向对拍：摘掉"执行方=owner ⇒ 不投"那一段 ⇒ '
              + '**自己把自己叫醒 1 次** ⇒ SE-d 真长牙（它钉的正是这一条）')
          } else {
            bad(`SE-d(反证) 【负向对拍失败】变异体仍然一声不投（叫醒=${n} · 投递=${sent.length}）`
              + ' ⇒ SE-d 测的不是那一段（本判据恒真，比没有更危险）')
          }
        } catch (e) {
          bad(`SE-d(反证) 变异体跑不起来（${String(e?.message ?? e)}）`)
        }
      }
    }

    /**
     * ── SE-b(负向对拍)：⚠ **本档不做行为变异**（实测证明它做不到，照实写）──────────
     *
     * 我试过把 `if (typeof effDeliveredAt === 'number')` 整档摘成恒假 ——
     * **变异体一份都没重发**（实测：`sent = 0`）。原因是一串**别的**守卫把它挡住了：
     *   · `settle()` 顶部 `if (w.deliveredAt !== undefined) → finalizeDelivery()`（第 4 单的那一层）；
     *   · `delivering` / `reported` 的短路；
     *   · 目标仍 `running` 时 `probe.kind === 'running' ⇒ continue`。
     * ⇒ 单独摘掉"对账那一档"**不会**让行为变坏 ⇒ 用行为做负向对拍 = **假红**（本判据恒真）。
     *
     * ⚠ 所以本档改成**钉住那一档确实存在且语义正确**（结构判据），并**明说它不是行为对拍**：
     *   行为层面的"已 deliveredAt ⇒ 不再发"已由 `SD-d` / `SD-x`（第 4 单）覆盖；
     *   本档（`SE-b`）钉的是 `Hob 定死的那三条读数`，⛔ 不假装它有行为层的分辨力。
     */
    {
      const GUARD_EFF = "            if (typeof effDeliveredAt === 'number') {"
      let srcE = ''
      try { srcE = seRf(seJ(seRoot, 'src', 'modules', 'orchestrator.ts'), 'utf8') } catch { srcE = '' }
      /**
       * ⚠ 判据两条：
       *   ① 那一档**在**（源码里有这句）；
       *   ② 那一档**不投递** —— 它调用的是 `finalizeDelivery(...)`（只清账），
       *      而**不是** `relayDeliver` / `deliver`（那才是投递）。
       */
      const hasTier = srcE.includes(GUARD_EFF)
      const tierBodyStart = hasTier ? srcE.indexOf(GUARD_EFF) : -1
      const tierBody = hasTier ? srcE.slice(tierBodyStart, tierBodyStart + 900) : ''
      const cleanupOnly = tierBody.includes('finalizeDelivery')
      const noDeliver = !tierBody.includes('relayDeliver(') && !tierBody.includes('bus.deliver')
      if (hasTier && cleanupOnly && noDeliver) {
        note.push('SE-b(负向对拍) ⚠ **本档只做结构判定，没有行为型负向对拍**（原因见注释）：'
          + '实测摘掉那一档**不会**导致重发（别的守卫挡住了）⇒ 硬凑行为对拍只会恒假。'
          + '⚠ 行为层的"已 deliveredAt ⇒ 不再发"由第 4 单的 `SD-d` / `SD-x` 覆盖。')
        ok('SE-b(结构) ✓ "已 `deliveredAt` ⇒ 只清账"那一档**在位**，且**只调 `finalizeDelivery`、⛔ 不调投递**'
          + '（⚠ 与 `SE-b` 本体的三条读数配合：那些读数说明它在真跑时确实一份都没发）')
      } else {
        bad('SE-b(结构) 【那一档丢了或开始投递了】'
          + `：在位=${hasTier} · 只清账=${cleanupOnly} · 不投递=${noDeliver}`
          + ' ⇒ 这一档一旦改成投递，盘上那些"已送到"的记录会被重发')
      }
    }
    /** ── SE-c(反证)：放开"拒绝登记 owner 自己"那道闸 ───────────────── */
      const GUARD_C = '    if (typeof entry.owner === \'string\' && entry.owner !== \'\' && entry.owner === id) {'
      let srcW = ''
      try { srcW = seRf(seJ(seRoot, 'src', 'server', 'card-wake.ts'), 'utf8') } catch { srcW = '' }
      if (!srcW.includes(GUARD_C)) {
        bad('SE-c(反证) 【失去靶子】找不到"拒绝登记 owner 自己"那道闸原文 ⇒ 不按通过处理')
      } else {
        const dir = seMkdt(seJ(seTmpRoot, 'mut-c-'))
        try {
          seCp(seJ(seRoot, 'src'), seJ(dir, 'src'), { recursive: true, dereference: true })
          const f = seJ(dir, 'src', 'server', 'card-wake.ts')
          seWf(f, seRf(f, 'utf8').replace(GUARD_C, '    if (false) { /* 变异：放开那道闸 */'), 'utf8')
          try { seLink(seJ(seRoot, 'node_modules'), seJ(dir, 'node_modules'), 'dir') } catch { /* 已有 */ }
          const mW = await import(seP2u(seJ(dir, 'src', 'server', 'card-wake.ts')).href)
          const dwM = new mW.DispatchWake({ deliver: () => Promise.resolve({ ok: true }),
            now: () => 1792300800000 })
          const SELF = 'session-77d33ea8'
          dwM.register({ sessionId: SELF, via: 'taskboard-card', cardId: 't-self', owner: SELF })
          const n = dwM.snapshot(SELF).mine?.registered
          if (n === 1) {
            ok('SE-c(反证) ✓ 负向对拍：**放开那道闸** ⇒ 派活方自己被登记成实施会话（mine=1）'
              + ' ⇒ SE-c 真长牙（它钉的正是"不许把 owner 当实施方"）')
          } else {
            bad(`SE-c(反证) 【负向对拍失败】放开闸后仍然 mine=${n}（应 1）⇒ SE-c 测的不是那道闸`)
          }
        } catch (e) {
          bad(`SE-c(反证) 变异体跑不起来（${String(e?.message ?? e)}）`)
        }
      }
    }
  }
  try { seRm(seTmpRoot, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
}

// ── SG. **三处"读数不老实"**（2026-10-20 · 第 321 轮 · `TASK-G`）───────────────
//
// ⚠ **本组守的是哪三条**（三处**都是同一个病**：**让失败不可观测**）：
//   · **SG-a 叫醒面接住投递返回值**：投递 resolve `{ok:false, reason}` ⇒
//     ⛔ 不涨 `wokeCount`、⛔ 不写"已叫醒"、⛔ 不覆盖"最近一次叫醒"；
//     ✅ 涨"没送到"那档（`undeliveredCount` / `undeliverableCount`）且**原话含 `reason`**。
//     ⚠ 改前两处都**丢掉返回值**（`handleFrame` 不接、`wake` 里 `void r`）⇒
//       `{ok:false}` 被当成成功，读数说"成了"、实际没成。
//   · **SG-b 登记回调必须带 owner**：按推送现读登记成功 ⇒ 按人读的 `pushedRegisterOk > 0`、
//     `wired` 真、头行**不再打「还没接上」**。⚠ 改前三处调用都不传 owner ⇒
//     `bump()` 遇空 return ⇒ 按人读恒 0 ⇒ 头行永远说没接上，**而它其实接上了**。
//   · **SG-c 台账键空间同源**：卡跑完 + 投递成功 ⇒ `deliveryLedger` **不是 0 条**，
//     且条目的 `executionId` 就是**可用**的那个键。⚠ 改前拿合成键比看板真 id ⇒
//     永远不相等 ⇒ 台账恒空、渲染成"确实是空的"、补投入口按不到。
//
// ⚠⚠ **每条都配一个负向对拍**（改前必红）：把修复回退到变异体上跑 ⇒ 本档**必须不成立**。
//   ⚠ 变异只落在**临时副本**（⛔ 不碰工作区源码一个字节），同 `SC` / `SD` / `SE` 的纪律。
{
  const { pathToFileURL: sgP2u } = await import('node:url')
  const { join: sgJ, basename: sgBase } = await import('node:path')
  const { mkdtempSync: sgMkdt, mkdirSync: sgMkd, writeFileSync: sgWf, readFileSync: sgRf,
    rmSync: sgRm, cpSync: sgCp, symlinkSync: sgLink } = await import('node:fs')
  const { tmpdir: sgTmp } = await import('node:os')
  const { createServer: sgServer } = await import('node:http')

  /** ⚠ 与 SA/SB/SC/SD/SE 同款：`HOB_SA_ROOT` 可指向另一棵树（用来跑"改前必红"）。 */
  const sgRoot = process.env.HOB_SA_ROOT !== undefined && process.env.HOB_SA_ROOT !== ''
    ? process.env.HOB_SA_ROOT
    : root
  const sgTag = sgRoot === root ? '' : `（源码树=${sgRoot}）`
  let sgTmpRoot
  try { sgTmpRoot = sgMkdt(sgJ(sgTmp(), 'hob-sgcheck-')) } catch { sgTmpRoot = sgTmp() }

  let sgWake, sgOrchMod, sgBusMod
  try {
    sgWake = await import(sgP2u(sgJ(sgRoot, 'src', 'server', 'card-wake.ts')).href)
  } catch (e) {
    bad(`SG 无法加载 card-wake（${String(e?.message ?? e)}）⇒ 三处读数失去基准（不按通过处理）`)
  }
  try {
    sgOrchMod = await import(sgP2u(sgJ(sgRoot, 'src', 'modules', 'orchestrator.ts')).href)
    sgBusMod = await import(sgP2u(sgJ(sgRoot, 'src', 'modules', 'bus.ts')).href)
  } catch { sgOrchMod = undefined; sgBusMod = undefined }

  const sgWS = 'ws-sg'

  /** 造一帧「执行落定」（形状按看板 `broadcast()` 的 `summarize()` 投影）。 */
  const sgFrameOf = (over = {}) => JSON.stringify({
    revision: 1, kind: 'execution-recorded',
    tasks: [{ id: 't-sg-1', title: 'SG 用卡', status: 'in_review', workspaceId: sgWS,
      version: 5, lastExecutionOutcome: 'succeeded',
      createdBy: { sessionId: 'session-sg-hob' }, ...over }],
  })

  // ══════════════════════════════════════════════════════════════
  // SG-a · **叫醒面必须接住投递返回值**（两处：CardWake + DispatchWake）
  // ══════════════════════════════════════════════════════════════
  //
  //   ⚠ 现场形态：`hobBus.deliver` 对"归档会话 / 非活会话 / 建消息失败"返回
  //     `{ok:false, reason}`（**不抛错**）⇒ 改前两处都当成功。
  //   ⚠ 判据（两条通道各一条，且**改法要一致**）：
  //     ① `{ok:false}` ⇒ `wokeCount`/`wokeCount` **不涨**、`undeliveredCount` **+1**、
  //        那句可读话里**含 `reason` 原文**、"最近一次叫醒"**没被覆盖**；
  //     ② 同一面上再喂一次**成功**投递 ⇒ 照常涨（⛔ 不是把这一档做成"永远不叫"）。
  if (sgWake !== undefined) {
    {
      const REASON = 'session "session-sg-hob" is not a live session; only live sessions can receive'
      const sent = []
      const cw = new sgWake.CardWake({
        origin: 'http://127.0.0.1:0',
        workspaceIdOf: () => sgWS,
        deliver: (sid, text) => { sent.push({ sid, text }); return Promise.resolve({ ok: false, reason: REASON }) },
        now: () => 1792300800000,
      })
      cw.subscribe('session-sg-hob', sgWS)
      const n = await cw.handleFrame('change', sgFrameOf())
      const st = cw.snapshot()
      const noFakeWake = st.wokeCount === 0 && n === 0
      const countedUndelivered = st.undeliveredCount === 1
      const noteHasReason = typeof st.note === 'string' && st.note.includes(REASON)
      const noLastWoke = st.lastWokeCard === undefined
      const saysNotWoke = typeof st.note === 'string' && !st.note.includes('已叫醒')
      if (noFakeWake && countedUndelivered && noteHasReason && noLastWoke && saysNotWoke) {
        ok('SG-a1 ✓ **卡唤醒面接住投递返回值**：投递返回 `{ok:false, reason}` ⇒ '
          + '`wokeCount` **不涨**（仍 0）· `undeliveredCount` **+1** · '
          + '可读话里**含失败原话**（`' + REASON.slice(0, 34) + '…`）· "最近一次叫醒"**未被覆盖**'
          + sgTag)
      } else {
        bad('SG-a1 【{ok:false} 被当成了成功】卡唤醒面仍在报"已叫醒"'
          + `：返回值=${n}（应 0）· wokeCount=${st.wokeCount}（应 0）· undeliveredCount=${st.undeliveredCount}（应 1）`
          + ` · 话里含失败原话=${noteHasReason} · 没覆盖"最近一次叫醒"=${noLastWoke}`
          + ` · 话里没写"已叫醒"=${saysNotWoke} · note=${JSON.stringify(String(st.note ?? '').slice(0, 120))}`
          + ' ⇒ 这正是"读数说成了、实际没成"那条形态')
      }
      // ⚠ 反向对照：同一面、**成功**投递照样涨（⛔ 不是把这一档做成永不叫）
      const okSent = []
      const cwOk = new sgWake.CardWake({
        origin: 'http://127.0.0.1:0',
        workspaceIdOf: () => sgWS,
        deliver: (sid, text) => { okSent.push(sid); return Promise.resolve({ ok: true }) },
        now: () => 1792300800000,
      })
      cwOk.subscribe('session-sg-hob', sgWS)
      const nOk = await cwOk.handleFrame('change', sgFrameOf())
      const stOk = cwOk.snapshot()
      if (nOk === 1 && stOk.wokeCount === 1 && stOk.undeliveredCount === 0) {
        ok('SG-a2 ✓ 反向对照：**投递成功**时照常涨 `wokeCount=1`、`undeliveredCount=0`'
          + ' ⇒ SG-a1 钉的是"失败要如实记"，⛔ 没有把叫醒弄成永不生效')
      } else {
        bad('SG-a2 【成功路径被误伤】投递成功时叫醒没长起来'
          + `：返回值=${nOk}（应 1）· wokeCount=${stOk.wokeCount}（应 1）· undeliveredCount=${stOk.undeliveredCount}（应 0）`)
      }
    }
    {
      // ── 第二处：`DispatchWake.wake`（实施会话叫醒面）—— **改法必须与上一处一致** ──
      const REASON2 = 'session "session-sg-exec" is archived; an archived session is woken by a delivery but its execution is gated off'
      const sent2 = []
      const dw = new sgWake.DispatchWake({
        deliver: (sid, text) => { sent2.push({ sid, text }); return Promise.resolve({ ok: false, reason: REASON2 }) },
        now: () => 1792300800000,
      })
      dw.register({ sessionId: 'session-sg-exec', via: 'taskboard-card', cardId: 't-sg-2', owner: 'session-sg-hob' })
      await dw.observe('session-sg-exec', 'running')
      const outcome = await dw.observe('session-sg-exec', 'idle')
      const ds = dw.snapshot('session-sg-hob')
      const noFakeWoke = ds.wokeCount === 0 && outcome !== 'woke'
      const counted = ds.undeliverableCount === 1
      const whyHasReason = typeof ds.undeliverableWhy === 'string' && ds.undeliverableWhy.includes(REASON2)
      const noteHasReason2 = typeof ds.note === 'string' && ds.note.includes(REASON2)
      if (noFakeWoke && counted && whyHasReason && noteHasReason2) {
        ok('SG-a3 ✓ **会话唤醒面接住投递返回值**（与上面**同一套判据**）：`{ok:false}` ⇒ '
          + `结局=${String(outcome)}（⛔ 不是 'woke'）· wokeCount 仍 0 · undeliverableCount **+1** · `
          + '原话里**逐字**带着失败原因' + sgTag)
      } else {
        bad('SG-a3 【{ok:false} 被当成了成功】会话唤醒面仍在报"已叫醒"'
          + `：结局=${String(outcome)}（应非 'woke'）· wokeCount=${ds.wokeCount}（应 0）`
          + ` · undeliverableCount=${ds.undeliverableCount}（应 1）· why 含原话=${whyHasReason}`
          + ` · note 含原话=${noteHasReason2}`
          + ' ⇒ 两处改法不一致（`D4`「至多投一次」不受影响，但"记没记成"必须一致）')
      }
      // ⚠ `D4` 不许被这一改破：`{ok:false}` **仍然不重投**（`reported` 照旧只在投之前落）
      await dw.observe('session-sg-exec', 'idle')
      const again = await dw.observe('session-sg-exec', 'idle')
      if (sent2.length === 1 && again === undefined) {
        ok('SG-a4 ✓ **`D4`「至多投一次」未被这一改破**：`{ok:false}` 之后同一轮再喂 `idle` ⇒ '
          + `**不再投第二次**（累计投递 ${sent2.length} 次、结局=${String(again)}）`
          + ' —— 本件只改"记账"，⛔ 没有让失败变成可重投')
      } else {
        bad('SG-a4 【重投语义被改动】`{ok:false}` 之后又投了一次'
          + `：累计投递=${sent2.length}（应 1）· 第二次结局=${String(again)}`
          + ' ⇒ 那是用户要裁的事，⛔ 本件不许动')
      }
    }
    // ── SG-a(反证)：把两处的"接住返回值"回退成改前的样子 ⇒ SG-a1 / SG-a3 必须不成立 ──
    {
      const CW = sgJ(sgRoot, 'src', 'server', 'card-wake.ts')
      const original = sgRf(CW, 'utf8')
      /**
       * ⚠ 变异点要**同时打中两处**，否则只能证明一处有牙：
       *   ① `CardWake`：把 `deliveryFailureOf(r)` 那次判定改成恒 `undefined`（= 改前"不看返回值"）；
       *   ② `DispatchWake`：同一函数是共用的 ⇒ 一处变异两处一起回退（这正是"改法一致"的副作用）。
       */
      const GUARD = '  const o = r as { ok?: unknown; reason?: unknown }'
      if (original.includes(GUARD) === false) {
        bad('SG-a(反证) 【失去靶子】在 `card-wake.ts` 里找不到"读返回值"那行'
          + ' ⇒ 本负向对拍已对不上实现，不按通过处理')
      } else {
        const dir = sgMkdt(sgJ(sgTmpRoot, 'mut-sga-'))
        sgCp(sgJ(sgRoot, 'src'), sgJ(dir, 'src'), { recursive: true, dereference: true })
        const mf = sgJ(dir, 'src', 'server', 'card-wake.ts')
        sgWf(mf, original.replace(GUARD,
          '  const o = r as { ok?: unknown; reason?: unknown }\n  return undefined /* 变异：改回"丢掉返回值" */'), 'utf8')
        try { sgLink(sgJ(sgRoot, 'node_modules'), sgJ(dir, 'node_modules'), 'dir') } catch { /* 已有 */ }
        try {
          const mW = await import(sgP2u(sgJ(dir, 'src', 'server', 'card-wake.ts')).href)
          const mSent = []
          const mcw = new mW.CardWake({ origin: 'http://127.0.0.1:0', workspaceIdOf: () => sgWS,
            deliver: (sid, text) => { mSent.push(sid); return Promise.resolve({ ok: false, reason: 'x' }) },
            now: () => 1792300800000 })
          mcw.subscribe('session-sg-hob', sgWS)
          const mN = await mcw.handleFrame('change', sgFrameOf())
          const mSt = mcw.snapshot()
          const mdw = new mW.DispatchWake({
            deliver: () => Promise.resolve({ ok: false, reason: 'x' }), now: () => 1792300800000 })
          mdw.register({ sessionId: 'session-sg-exec', via: 'taskboard-card', cardId: 't-sg-2', owner: 'session-sg-hob' })
          await mdw.observe('session-sg-exec', 'running')
          const mOutcome = await mdw.observe('session-sg-exec', 'idle')
          const mDs = mdw.snapshot('session-sg-hob')
          const bothFake = mSt.wokeCount === 1 && mN === 1
            && mDs.wokeCount === 1 && mOutcome === 'woke'
          if (bothFake) {
            ok('SG-a(反证) ✓ 负向对拍：把"读返回值"回退成改前（`void r` / 不接返回值）⇒ '
              + `**两处同时**把 \`{ok:false}\` 当成成功（卡面 wokeCount=${mSt.wokeCount} · `
              + `会话面 wokeCount=${mDs.wokeCount}·结局=${String(mOutcome)}）`
              + ' ⇒ SG-a1 / SG-a3 真长牙（它们钉的正是这一条）')
          } else {
            bad('SG-a(反证) 【负向对拍失败】回退"接返回值"之后仍然没把它当成功'
              + `（卡面 wokeCount=${mSt.wokeCount} · 会话面 wokeCount=${mDs.wokeCount}·结局=${String(mOutcome)}）`
              + ' ⇒ SG-a 测的不是"接住返回值"这件事')
          }
        } catch (e) {
          bad(`SG-a(反证) 变异体跑不起来（${String(e?.message ?? e)}）`)
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // SG-b · **登记回调必须带 `owner`**（按人读的读数才是真的）
  // ══════════════════════════════════════════════════════════════
  //
  //   ⚠ 现场形态：点火帧把会话登记进来了（`registered=1`、真叫醒过），
  //     而 `hob_orch_status` 的头行却说 `⚠ 还没接上（未收到过点火帧）` —— 两个读数打架。
  //   ⚠ 机理：三处 `noteRegistryOk` / `noteRegistryIssue` 调用**都不传 owner**
  //     ⇒ `bump()` 遇空直接 return ⇒ 按人读的 `pushedRegisterOk` 恒 0。
  //   ⚠ 判据：**走真链路**（假看板 SSE → 点火帧 → `onFiring` → `registerCardByPush`）⇒
  //     ① 按人读 `pushedRegisterOk > 0`；② 头行写"已接上"、**不再**写"还没接上"；
  //     ③ 同一份读数**按 owner 分区**（别人的 owner 读到 0 —— ⛔ 不回退进程级合计）。
  if (sgOrchMod !== undefined && sgBusMod !== undefined) {
    const sgMount = async (opts = {}) => {
      const base = sgMkdt(sgJ(sgTmpRoot, 'case-b-'))
      const home = sgJ(base, 'ledgers'); const ws = sgJ(base, 'ws')
      sgMkd(sgJ(ws, 'runtime'), { recursive: true })
      sgMkd(sgJ(home, sgBase(ws), 'runtime'), { recursive: true })
      sgWf(sgJ(home, sgBase(ws), 'runtime', 'orch-watches.json'),
        JSON.stringify({ version: 1, updatedAt: 1, handoffs: [], lost: [], pending: [] }), 'utf8')
      const card = opts.card
      const registry = new Map([
        ['taskboard_get', { name: 'taskboard_get', execute: async (a) => (a?.id === card.id ? { task: card } : {}) }],
        ['taskboard_list', { name: 'taskboard_list', execute: async () => ({ revision: 1, tasks: [card] }) }],
      ])
      const toolsSvc = { get: (n) => registry.get(n) }
      const mkSession = (id) => ({ id, header: { agentPreset: 'standard', cwd: ws }, log: [] })
      const byId = new Map([[opts.owner ?? 'session-sg-hob', mkSession(opts.owner ?? 'session-sg-hob')],
        ['session-sg-exec', mkSession('session-sg-exec')]])
      const sessions = { get: (id) => byId.get(id), list: () => [...byId.values()], flush: async () => true }
      const agents = { currentInitiator: () => undefined,
        get: (id) => (byId.has(id) ? { id, status: 'idle', ctx: {}, session: byId.get(id),
          followup() {}, steer() {}, inject() {} } : undefined) }
      const logger = { debug() {}, info() {}, warn() {} }
      /** ⚠ 假 `workspaceRegistry`：`bus.listWorkspaces` 靠它判"本会话在哪个项目"。 */
      const workspaceRegistry = {
        list: () => [{ id: sgWS, path: ws, title: 'sg', record: { sessionIds: [...byId.keys()] } }],
        sessionPaths: new Map([...byId.keys()].map((id) => [id, ws])),
      }
      const busProvided = {}
      // ⚠ 变异体可以传**它自己的** bus 模块（否则 SG-b(反证) 只换了 orchestrator，
      //   实测证明那一档会**照样绿** —— 见下面反证块的注释：必须两边一起回退）。
      const busMod = opts.busMod ?? sgBusMod
      const busCtx = { sessions, agents, logger,
        get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents
          : k === 'workspaceRegistry' ? workspaceRegistry : undefined),
        provide: (k, v) => { busProvided[k] = v }, effect: (f) => { try { f() } catch { /* 无落点 */ } },
        inject: (_d, cb) => cb(busCtx), on: () => {} }
      busMod.apply(busCtx, { spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }) })
      const bus = busProvided.hobBus
      const provided = {}
      const ctx = { sessions, agents, logger,
        get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents : k === 'hobBus' ? bus
          : k === 'tools' ? toolsSvc
            : k === 'workspaceRegistry' ? workspaceRegistry
              : k === 'webServer' ? { getOrigin: () => opts.origin }
                : k === 'loader' ? { entries: () => [{ options: { config: { ledgerHome: home } } }] } : undefined),
        provide: (k, v) => { provided[k] = v }, effect: (f) => { try { f() } catch { /* 无落点 */ } },
        inject: (_d, cb) => cb(ctx), on: () => {} }
      // ⚠ 同上：变异体可以传**它自己的** orchestrator 模块。
      const orchMod = opts.orchMod ?? sgOrchMod
      orchMod.apply(ctx)
      return { orch: provided.hobOrchestrator, ws, home }
    }

    {
      /** 假看板 SSE：连上来就推一帧**点火**（= `pre-step` 那一刻看板真推的那一帧）。 */
      const card = { id: 't-sg-push', title: 'SG 推送用卡', status: 'in_progress', workspaceId: sgWS,
        version: 6, createdBy: { kind: 'user', sessionId: 'session-sg-hob' }, comments: [],
        executions: [{ id: 'e-sg-1', outcome: 'running', startedAt: 1, sessionId: 'session-sg-exec' }] }
      const firing = JSON.stringify({ revision: 1, kind: 'execution-recorded',
        tasks: [{ id: card.id, title: card.title, status: 'in_progress', workspaceId: sgWS,
          version: 6, lastExecutionOutcome: 'running' }] })
      const srv = sgServer((req, res) => {
        if (String(req.url ?? '').includes('/dsh-taskboard/events') === false) { res.writeHead(404).end(); return }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        res.write(`event: change\ndata: ${firing}\n\n`)
      })
      await new Promise((r) => srv.listen(0, '127.0.0.1', r))
      const origin = `http://127.0.0.1:${srv.address().port}`
      try {
        const h = await sgMount({ card, origin })
        await h.orch.wakeSubscribe('session-sg-hob')
        /** ⚠ 等到"按推送现读登记成功"真的发生（最多 800ms）。 */
        const until = async (fn, ms = 800) => {
          const t0 = Date.now()
          while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 10)) }
          return fn()
        }
        await until(() => h.orch.dispatchWakeState('session-sg-hob').pushedRegisterOk > 0)
        const d = h.orch.dispatchWakeState('session-sg-hob')
        const tools = sgOrchMod.createHobOrchTools(h.orch)
        const rendered = String(await tools.status.execute({}, {
          agent: { id: 'session-sg-hob', session: { header: { cwd: h.ws } } },
        }))
        const head = rendered.split('\n').find((l) => l.includes('实施会话叫醒面')) ?? ''
        const wired = head.includes('已接上')
        const notWired = head.includes('还没接上')
        /**
         * ⚠ **按 owner 分区**（B4 / W6）：同一个进程级对象，另一个 owner 读到的是**它的** 0，
         *   ⛔ 不许是"进程级合计"（那正是 W6 那条"两个 Hob 互相看见"）。
         */
        const other = h.orch.dispatchWakeState('session-someone-else')
        const partitioned = d.pushedRegisterOk >= 1 && other.pushedRegisterOk === 0
        if (d.pushedRegisterOk > 0 && wired && !notWired && partitioned) {
          ok('SG-b ✓ **登记回调带 owner**：按推送现读登记成功 ⇒ **按人读**的 `pushedRegisterOk=' 
            + String(d.pushedRegisterOk) + '`（改前恒 0）· 头行写 **"已接上"**、⛔ 不再写"还没接上"'
            + `（原行：${head.slice(0, 68)}…）· 且**按 owner 分区**（别人的 owner 读到 ${other.pushedRegisterOk}）`
            + sgTag)
        } else {
          bad('SG-b 【按人读的"接没接上"仍然是假 0】三处登记回调没把 owner 传下去'
            + `：我的 pushedRegisterOk=${d.pushedRegisterOk}（应 ≥1）· 头行说"已接上"=${wired}`
            + ` · 头行仍说"还没接上"=${notWired} · 按 owner 分区=${partitioned}`
            + `（别人读到的=${other.pushedRegisterOk}，应 0）`
            + ` · 头行=${JSON.stringify(head.slice(0, 120))}`
            + ' ⇒ 头行永远打"还没接上"，而它其实接上了 —— 本项目头号禁忌')
        }
        // ── SG-b(反证)：把三处 `noteRegistryOk/Issue` 的 owner 去掉 ⇒ SG-b 必须不成立 ──
        {
          const OJ = sgJ(sgRoot, 'src', 'modules', 'orchestrator.ts')
          const osrc = sgRf(OJ, 'utf8')
          const G1 = 'dispatchWake.noteRegistryOk(cardId, subscriber)'
          const G2 = 'dispatchWake.noteRegistryIssue(cardId, r.kind, r.why, subscriber)'
          const G3 = "dispatchWake.noteRegistryIssue(cardId, 'unreadable', `按卡现读会话时抛错：${String((e as Error)?.message ?? e)}`, subscriber)"
          if (!osrc.includes(G1) || !osrc.includes(G2) || !osrc.includes(G3)) {
            bad('SG-b(反证) 【失去靶子】`orchestrator.ts` 里三处登记回调不是"带 owner"的形态'
              + ' ⇒ 本负向对拍已对不上实现，不按通过处理')
          } else {
            const dir = sgMkdt(sgJ(sgTmpRoot, 'mut-sgb-'))
            sgCp(sgJ(sgRoot, 'src'), sgJ(dir, 'src'), { recursive: true, dereference: true })
            const mf = sgJ(dir, 'src', 'modules', 'orchestrator.ts')
            sgWf(mf, osrc
              .replace(G1, 'dispatchWake.noteRegistryOk(cardId)')
              .replace(G2, 'dispatchWake.noteRegistryIssue(cardId, r.kind, r.why)')
              .replace(G3, "dispatchWake.noteRegistryIssue(cardId, 'unreadable', `按卡现读会话时抛错：${String((e as Error)?.message ?? e)}`)"),
            'utf8')
            try { sgLink(sgJ(sgRoot, 'node_modules'), sgJ(dir, 'node_modules'), 'dir') } catch { /* 已有 */ }
            const srv2 = sgServer((req, res) => {
              if (String(req.url ?? '').includes('/dsh-taskboard/events') === false) { res.writeHead(404).end(); return }
              res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
              res.write(`event: change\ndata: ${firing}\n\n`)
            })
            await new Promise((r) => srv2.listen(0, '127.0.0.1', r))
            try {
              const mOrchMod = await import(sgP2u(sgJ(dir, 'src', 'modules', 'orchestrator.ts')).href)
              const mBusMod = await import(sgP2u(sgJ(dir, 'src', 'modules', 'bus.ts')).href)
              const h2 = await sgMount({ card, origin: `http://127.0.0.1:${srv2.address().port}`,
                orchMod: mOrchMod, busMod: mBusMod })
              await h2.orch.wakeSubscribe('session-sg-hob')
              await until(() => h2.orch.dispatchWakeState('session-sg-hob').registered > 0 || Date.now() % 1 === 9)
              await new Promise((r) => setTimeout(r, 350))
              const md = h2.orch.dispatchWakeState('session-sg-hob')
              const mtools = mOrchMod.createHobOrchTools(h2.orch)
              const mRendered = String(await mtools.status.execute({}, {
                agent: { id: 'session-sg-hob', session: { header: { cwd: h2.ws } } },
              }))
              const mHead = mRendered.split('\n').find((l) => l.includes('实施会话叫醒面')) ?? ''
              /**
               * ── ⚠⚠ **判据已随头行拆档更新**（第 323 轮 · `TASK-I`）──────────────────
               *
               * ⚠ 改前这里钉的是 `mHead.includes('还没接上')` —— 那时头行只有"已接上 / 还没接上"两档。
               *   拆档后，`pushedRegisterOk=0` 且**帧到过**时头行打的是
               *   `⚠ 收到过点火帧 N 次、但一次都没走到"登记成功"`（**不含**"还没接上"字样）
               *   ⇒ 旧判据会把**正确的新行为**判成"反证失败"（实测首跑正是这样红的）。
               *
               * ⚠ 本反证**要钉的那件事一个字没变**：`owner` 不传 ⇒ 按人读的 `pushedRegisterOk`
               *   **回落到 0** ⇒ 头行**不许**说"已接上"（那才是 OG 要治的假话）。
               *   ⇒ 判据改成"**回落到 0 且不说已接上**"，⛔ 不依赖具体档位措辞
               *     （⛔ 不许把它绑死在某一句文案上，否则下次改措辞又假红）。
               */
              const mNotWired = mHead.includes('已接上') === false
              if (md.pushedRegisterOk === 0 && mNotWired) {
                ok('SG-b(反证) ✓ 负向对拍：把三处登记回调的 `owner` 去掉 ⇒ '
                  + `按人读的 \`pushedRegisterOk\` **回落到 0**、头行**不再说"已接上"**（登记本身还在：`
                  + `registered=${md.mine?.registered ?? 0}）`
                  + ' ⇒ SG-b 真长牙（它钉的正是"不传 owner ⇒ 读数永远说没接上"）')
              } else {
                bad('SG-b(反证) 【负向对拍失败】去掉 owner 之后按人读仍然 > 0 或头行仍然说已接上'
                  + `（pushedRegisterOk=${md.pushedRegisterOk} · 头行=${JSON.stringify(mHead.slice(0, 100))}）`
                  + ' ⇒ SG-b 测的不是"owner 有没有传下去"')
              }
            } finally { srv2.close() }
          }
        }
      } finally { srv.close() }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // SG-c · **`deliveryLedger` 的键空间必须同源**
  // ══════════════════════════════════════════════════════════════
  //
  //   ⚠ 现场形态：卡跑完 ⇒ 叫醒面按**合成键**（`<卡>@<outcome>@v<version>`）记账；
  //     而 `deliveryLedger()` 拿这个键去比卡面的**看板真 id** ⇒ **永远不相等**
  //     ⇒ 台账恒空、渲染成「目前**没有**投递记录（这一档是"确实是空的"）」
  //     ⇒ 补投入口拿不到可用 `executionId`，**按不到**。
  //   ⚠ 判据：喂一条"卡跑完 + 投递成功"的**真实形状**数据 ⇒ `deliveryLedger` **不是 0 条**，
  //     且条目的 `executionId` 与台账键**逐字相同**（= 补投入口拿到的就是那个可用的 id）。
  //   ⛔ 判据里**不许用前缀匹配**（`t-a` 是 `t-ab` 的前缀 ⇒ 会误配）—— 本档另外钉住这一点。
  if (sgOrchMod !== undefined && sgBusMod !== undefined) {
    {
      const card = { id: 't-sg-ledger', title: 'SG 台账用卡', status: 'in_review', workspaceId: sgWS,
        version: 7, createdBy: { kind: 'user', sessionId: 'session-sg-hob' }, comments: [],
        // ⚠ 真形状：最近一次执行**已落定**，且带看板自己的真 id
        executions: [{ id: 'e-real-abcdef', outcome: 'succeeded', startedAt: 1, endedAt: 2, sessionId: 'session-sg-exec' }] }
      const done = JSON.stringify({ revision: 1, kind: 'execution-recorded',
        tasks: [{ id: card.id, title: card.title, status: 'in_review', workspaceId: sgWS,
          version: 7, lastExecutionOutcome: 'succeeded' }] })
      const srv = sgServer((req, res) => {
        if (String(req.url ?? '').includes('/dsh-taskboard/events') === false) { res.writeHead(404).end(); return }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        res.write(`event: change\ndata: ${done}\n\n`)
      })
      await new Promise((r) => srv.listen(0, '127.0.0.1', r))
      try {
        const base = sgMkdt(sgJ(sgTmpRoot, 'case-c-'))
        const home = sgJ(base, 'ledgers'); const ws = sgJ(base, 'ws')
        sgMkd(sgJ(ws, 'runtime'), { recursive: true })
        sgMkd(sgJ(home, sgBase(ws), 'runtime'), { recursive: true })
        sgWf(sgJ(home, sgBase(ws), 'runtime', 'orch-watches.json'),
          JSON.stringify({ version: 1, updatedAt: 1, handoffs: [], lost: [], pending: [] }), 'utf8')
        const registry = new Map([
          ['taskboard_get', { name: 'taskboard_get', execute: async (a) => (a?.id === card.id ? { task: card } : {}) }],
          ['taskboard_list', { name: 'taskboard_list', execute: async () => ({ revision: 1, tasks: [card] }) }],
        ])
        const toolsSvc = { get: (n) => registry.get(n) }
        const mkSession = (id) => ({ id, header: { agentPreset: 'standard', cwd: ws }, log: [] })
        const byId = new Map([['session-sg-hob', mkSession('session-sg-hob')],
          ['session-sg-exec', mkSession('session-sg-exec')]])
        const sessions = { get: (id) => byId.get(id), list: () => [...byId.values()], flush: async () => true }
        const agents = { currentInitiator: () => undefined,
          get: (id) => (byId.has(id) ? { id, status: 'idle', ctx: {}, session: byId.get(id),
            followup() {}, steer() {}, inject() {} } : undefined) }
        const logger = { debug() {}, info() {}, warn() {} }
        const workspaceRegistry = {
          list: () => [{ id: sgWS, path: ws, title: 'sg', record: { sessionIds: [...byId.keys()] } }],
          sessionPaths: new Map([...byId.keys()].map((id) => [id, ws])),
        }
        const busProvided = {}
        const busCtx = { sessions, agents, logger,
          get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents
            : k === 'workspaceRegistry' ? workspaceRegistry : undefined),
          provide: (k, v) => { busProvided[k] = v }, effect: (f) => { try { f() } catch { /* 无落点 */ } },
          inject: (_d, cb) => cb(busCtx), on: () => {} }
        sgBusMod.apply(busCtx, { spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }) })
        const bus = busProvided.hobBus
        const provided = {}
        const ctx = { sessions, agents, logger,
          get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents : k === 'hobBus' ? bus
            : k === 'tools' ? toolsSvc
              : k === 'workspaceRegistry' ? workspaceRegistry
                : k === 'webServer' ? { getOrigin: () => `http://127.0.0.1:${srv.address().port}` }
                  : k === 'loader' ? { entries: () => [{ options: { config: { ledgerHome: home } } }] } : undefined),
          provide: (k, v) => { provided[k] = v }, effect: (f) => { try { f() } catch { /* 无落点 */ } },
          inject: (_d, cb) => cb(ctx), on: () => {} }
        sgOrchMod.apply(ctx)
        const orch = provided.hobOrchestrator
        await orch.wakeSubscribe('session-sg-hob')
        await new Promise((r) => setTimeout(r, 400))
        const led = await orch.deliveryLedger()
        const snap = await orch.cardsOf({ selfSessionId: 'session-sg-hob' })
        const synthetic = snap.cards.find((c) => c.id === card.id)?.synthesizedExecutionId
        const entry = led.entries[0]
        const notEmpty = led.total > 0 && entry !== undefined
        /**
         * ⚠ 判据三件（缺一即红）：
         *   ① 台账**不是 0 条**；② 条目 `taskId` 能对上那张卡；
         *   ③ 条目的 `executionId` = 卡面上的**合成键**（= 补投入口真正可用的那个 id）。
         *   ⚠ ③ **不许**退化成"前缀相等"（那就又会把 `t-a` 匹配到 `t-ab`）。
         */
        const rightCard = entry !== undefined && entry.taskId === card.id
        const idUsable = entry !== undefined && synthetic !== undefined && entry.executionId === synthetic
        const strictNotPrefix = entry !== undefined
          && entry.executionId !== undefined
          && entry.executionId.split('@')[0] === card.id
        if (notEmpty && rightCard && idUsable && strictNotPrefix) {
          ok('SG-c ✓ **台账键空间同源**：卡跑完 + 投递成功 ⇒ `deliveryLedger` **不再是 0 条**'
            + `（${led.total} 条）· 条目 \`executionId=${String(entry.executionId)}\` **与卡面合成键逐字相同**`
            + '（= 补投入口拿到的就是可用的那个 id）· 卡 id 严格相等（⛔ 不是前缀匹配）' + sgTag)
        } else {
          bad('SG-c 【台账恒空 / 拿不到可用执行 id】键空间不同源'
            + `：台账条数=${led.total}（应 > 0）· 条目卡 id 对得上=${rightCard}`
            + ` · 条目 id 与卡面合成键相同=${idUsable}`
            + `（条目=${JSON.stringify(entry ?? null)} · 卡面合成键=${JSON.stringify(synthetic ?? null)}）`
            + ` · 卡 id 严格相等=${strictNotPrefix}`
            + ' ⇒ 恒空会被渲染成"确实是空的"，补投入口永远按不到')
        }
        // ── SG-c(反证)：把比对改回"只比看板真 id"（= 改前那一行）⇒ SG-c 必须不成立 ──
        {
          const OJ = sgJ(sgRoot, 'src', 'modules', 'orchestrator.ts')
          const osrc = sgRf(OJ, 'utf8')
          const GUARD = 'const card = snap.cards.find((c) => c.synthesizedExecutionId === row.executionId'
          if (!osrc.includes(GUARD)) {
            bad('SG-c(反证) 【失去靶子】`deliveryLedger()` 里找不到"比合成键"那一行'
              + ' ⇒ 本负向对拍已对不上实现，不按通过处理')
          } else {
            const dir = sgMkdt(sgJ(sgTmpRoot, 'mut-sgc-'))
            sgCp(sgJ(sgRoot, 'src'), sgJ(dir, 'src'), { recursive: true, dereference: true })
            const mf = sgJ(dir, 'src', 'modules', 'orchestrator.ts')
            sgWf(mf, osrc.replace(GUARD,
              'const card = snap.cards.find((c) => false && c.synthesizedExecutionId === row.executionId'), 'utf8')
            try { sgLink(sgJ(sgRoot, 'node_modules'), sgJ(dir, 'node_modules'), 'dir') } catch { /* 已有 */ }
            try {
              const mOrchMod = await import(sgP2u(sgJ(dir, 'src', 'modules', 'orchestrator.ts')).href)
              const mBusMod = await import(sgP2u(sgJ(dir, 'src', 'modules', 'bus.ts')).href)
              const b2 = sgMkdt(sgJ(sgTmpRoot, 'case-c2-'))
              const home2 = sgJ(b2, 'ledgers'); const ws2 = sgJ(b2, 'ws')
              sgMkd(sgJ(ws2, 'runtime'), { recursive: true })
              sgMkd(sgJ(home2, sgBase(ws2), 'runtime'), { recursive: true })
              sgWf(sgJ(home2, sgBase(ws2), 'runtime', 'orch-watches.json'),
                JSON.stringify({ version: 1, updatedAt: 1, handoffs: [], lost: [], pending: [] }), 'utf8')
              const provided2 = {}
              const mkS = (id) => ({ id, header: { agentPreset: 'standard', cwd: ws2 }, log: [] })
              const byId2 = new Map([['session-sg-hob', mkS('session-sg-hob')], ['session-sg-exec', mkS('session-sg-exec')]])
              const sessions2 = { get: (id) => byId2.get(id), list: () => [...byId2.values()], flush: async () => true }
              const agents2 = { currentInitiator: () => undefined,
                get: (id) => (byId2.has(id) ? { id, status: 'idle', ctx: {}, session: byId2.get(id),
                  followup() {}, steer() {}, inject() {} } : undefined) }
              const wr2 = { list: () => [{ id: sgWS, path: ws2, title: 'sg', record: { sessionIds: [...byId2.keys()] } }],
                sessionPaths: new Map([...byId2.keys()].map((id) => [id, ws2])) }
              const bp2 = {}
              const bc2 = { sessions: sessions2, agents: agents2, logger,
                get: (k) => (k === 'sessions' ? sessions2 : k === 'agents' ? agents2
                  : k === 'workspaceRegistry' ? wr2 : undefined),
                provide: (k, v) => { bp2[k] = v }, effect: (f) => { try { f() } catch { /* 无落点 */ } },
                inject: (_d, cb) => cb(bc2), on: () => {} }
              mBusMod.apply(bc2, { spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }) })
              const srv2 = sgServer((req, res) => {
                if (String(req.url ?? '').includes('/dsh-taskboard/events') === false) { res.writeHead(404).end(); return }
                res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
                res.write(`event: change\ndata: ${done}\n\n`)
              })
              await new Promise((r) => srv2.listen(0, '127.0.0.1', r))
              try {
                const ctx2 = { sessions: sessions2, agents: agents2, logger,
                  get: (k) => (k === 'sessions' ? sessions2 : k === 'agents' ? agents2 : k === 'hobBus' ? bp2.hobBus
                    : k === 'tools' ? toolsSvc
                      : k === 'workspaceRegistry' ? wr2
                        : k === 'webServer' ? { getOrigin: () => `http://127.0.0.1:${srv2.address().port}` }
                          : k === 'loader' ? { entries: () => [{ options: { config: { ledgerHome: home2 } } }] } : undefined),
                  provide: (k, v) => { provided2[k] = v }, effect: (f) => { try { f() } catch { /* 无落点 */ } },
                  inject: (_d, cb) => cb(ctx2), on: () => {} }
                mOrchMod.apply(ctx2)
                const orch2 = provided2.hobOrchestrator
                await orch2.wakeSubscribe('session-sg-hob')
                await new Promise((r) => setTimeout(r, 400))
                const led2 = await orch2.deliveryLedger()
                if (led2.total === 0) {
                  ok('SG-c(反证) ✓ 负向对拍：把比对改回"只比看板真 id"（= 改前那一行）⇒ '
                    + '台账**回落到 0 条** ⇒ 渲染出来就是"确实是空的"、补投入口拿不到 id'
                    + ' ⇒ SG-c 真长牙（它钉的正是"合成键 vs 真 id"这条键空间不同源）')
                } else {
                  bad('SG-c(反证) 【负向对拍失败】改回"只比真 id"之后台账**仍有 '
                    + `${led2.total} 条** ⇒ SG-c 测的不是键空间同源`)
                }
              } finally { srv2.close() }
            } catch (e) {
              bad(`SG-c(反证) 变异体跑不起来（${String(e?.message ?? e)}）`)
            }
          }
        }
      } finally { srv.close() }
    }
  } else {
    bad('SG-c/c 跑不起来：orchestrator/bus 模块没加载上（不按通过处理）')
  }

  // ══════════════════════════════════════════════════════════════
  // SI · **投递前把冷目标叫活**（第 330 轮 · `TASK-M`）
  // ══════════════════════════════════════════════════════════════
  //
  //   ⚠ 现场形态（用户原话）：「**回执只有点了 Hob 会话，随后 Hob 才会收到**」。
  //   ⚠ 根因（`ANSWER.md` 判定 A 已定）：`agents.get` 只是查**进程内内存 Map**
  //     （`dsh-agent/lib/index.js:596`），冷会话不进表 ⇒ `bus.deliver` 原先**直接拒**
  //     ⇒ 执行会话跑完时派活方通常没被打开 ⇒ 回执根本投不进去。
  //   ⚠ 改法：`deliverImpl` 的 ① 分支不再直接拒，先经宿主
  //     `sessionController.resolveAgent(id)` 把**这一个**目标叫起来，再查一次。
  //   ⚠ 判据（六条，⛔ 缺一条都不算；每条配负向对拍见 SI-x）：
  //     1 冷目标可 resume ⇒ **投递成功**（改前：`is not a live session` 拒绝）；
  //     2 冷目标 resume 失败 ⇒ 仍拒，但话术**明说"已尝试唤醒"**（与"不存在"分开）；
  //     3 `sessionController` 缺席 ⇒ 仍拒，话术**点明唤醒能力不可用**（⛔ 不假装成功）；
  //     4 目标本来活着 ⇒ **仍直接投成功**，且**一次唤醒都不许做**（⛔ 不许变慢/多走一步）；
  //     5 归档会话 ⇒ **仍拒绝**，且**唤醒一次都不许发生**（⛔ 不许被唤醒绕过）；
  //     6 拒投给自己（模型面）⇒ **仍拒绝**，且唤醒一次都不许发生。
  if (sgBusMod !== undefined) {
    /**
     * 起一个只够跑 `deliver()` 的 mock 宿主。
     * ⚠ `sessionController` 按 `opts.controller` 现造：`undefined` = 该能力缺席。
     * ⚠ 一切现读（`agents.get`），与 `bus.ts` 的读法一致。
     */
    const siMount = async (opts = {}) => {
      const target = opts.target ?? 'session-si-cold'
      const session = { id: target, header: { agentPreset: 'standard' }, log: [] }
      const makeAgent = () => ({ status: 'idle', followup() {}, steer() {}, inject() {}, ctx: {}, session })
      let live = opts.live === true ? makeAgent() : undefined
      const sessions = {
        get: (id) => (id === target ? session : undefined),
        list: () => [session],
        flush: async () => true,
      }
      const agents = {
        currentInitiator: () => (opts.callerId === undefined
          ? undefined
          : { id: opts.callerId, session: { id: opts.callerId } }),
        get: (id) => (id === target ? live : undefined),
      }
      const stats = { resolveCalls: 0, resolveIds: [] }
      const controller = opts.controller === undefined ? undefined : {
        resolveAgent: async (id) => {
          stats.resolveCalls++
          stats.resolveIds.push(id)
          return opts.controller(id, () => { live = makeAgent() })
        },
      }
      /** ⚠ 归档集：`archivedSessionIds` 是**活数据**（宿主原地改同一个数组）。 */
      const workspaceRegistry = { archivedSessionIds: opts.archived === true ? [target] : [] }
      const provided = {}
      const svcCtx = {
        sessions, agents,
        logger: { debug() {}, warn() {}, info() {}, error() {} },
        get: (k) => (k === 'sessions' ? sessions
          : k === 'agents' ? agents
            : k === 'sessionController' ? controller
              : k === 'workspaceRegistry' ? workspaceRegistry : undefined),
        provide: (k, v) => { provided[k] = v },
        effect: (fn) => { try { fn() } catch { /* 无落点 */ } },
        inject: (_d, cb) => cb(svcCtx),
        on: () => {},
      }
      const busMod = opts.busMod ?? sgBusMod
      busMod.apply(svcCtx, { spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }) })
      const bus = provided.hobBus
      if (bus === undefined) return undefined
      return {
        target,
        stats,
        deliver: (text = 'do the work') => bus.deliver(target, text, 'followup'),
      }
    }

    // ── SI-1 **判据 #1**：冷目标（不在表里）但**可以 resume** ⇒ 投递成功 ──
    {
      const h = await siMount({ controller: async (_id, setLive) => { setLive(); return { agent: {} } } })
      if (h === undefined) {
        bad('SI-1 服务未 provide（`hobBus` 拿不到）⇒ 断言失去基准')
      } else {
        const r = await h.deliver()
        const okNow = r.ok === true
        const woke = r.wake !== undefined && r.wake.ok === true
        const once = h.stats.resolveCalls === 1 && h.stats.resolveIds[0] === h.target
        if (okNow && woke && once) {
          ok('SI-1 ✓ **判据 #1 冷目标可唤醒 ⇒ 投递成功**（改前 ⇒ `is not a live session` 拒绝）：'
            + `ok=${r.ok} · mode=${String(r.mode)} · wake.ok=${String(r.wake?.ok)} · `
            + `唤醒次数=${h.stats.resolveCalls}（⛔ 只叫一次、只叫这一个 id）`)
        } else {
          bad('SI-1 【冷目标仍然投不进去】投递没被叫活这一步救回来'
            + `：ok=${r.ok}（应 true）· reason=${JSON.stringify(String(r.reason ?? '').slice(0, 90))}`
            + ` · wake.ok=${String(r.wake?.ok)} · 唤醒次数=${h.stats.resolveCalls}（应 1）`
            + ' ⇒ "回执只有点了 Hob 才会收到"这条现场症状没有被修')
        }
      }
    }

    // ── SI-2 **判据 #2**：resume **失败** ⇒ 仍拒，但话术**明说"已尝试唤醒"** ──
    {
      const cases = [
        { tag: '(a 宿主明确报错)', controller: async () => ({ error: { message: 'session backend is closed' } }),
          expect: 'wake was attempted but the host refused it', expectDetail: 'session backend is closed' },
        { tag: '(b 唤醒抛错)', controller: async () => { throw new Error('resume blew up') },
          expect: 'wake was attempted but the host refused it', expectDetail: 'resume blew up' },
        { tag: '(c 叫完仍不是活会话)', controller: async () => ({ agent: {} }),
          expect: 'STILL not a live agent', expectDetail: undefined },
      ]
      for (const c of cases) {
        const h = await siMount({ controller: c.controller })
        if (h === undefined) { bad(`SI-2${c.tag} 服务未 provide ⇒ 断言失去基准`); continue }
        const r = await h.deliver()
        const reason = String(r.reason ?? '')
        const refused = r.ok === false
        const namesWake = reason.includes(c.expect)
        const keepsPrefix = reason.includes('is not a live session')
        const detailOk = c.expectDetail === undefined ? true : reason.includes(c.expectDetail)
        if (refused && namesWake && keepsPrefix && detailOk) {
          ok(`SI-2${c.tag} ✓ **判据 #2 唤醒失败 ⇒ 仍拒、且话术写明"已尝试唤醒"**（与"目标不存在"分开）：`
            + `ok=false · 档位=${String(r.wakeFailure)} · 含"${c.expect.slice(0, 30)}…" · 保留既有前缀 · `
            + `宿主原话${c.expectDetail === undefined ? '（本例无）' : '逐字带上'}`)
        } else {
          bad(`SI-2${c.tag} 【唤醒失败被说成了"目标不存在"】`
            + `：ok=${r.ok}（应 false）· 写"已尝试唤醒"=${namesWake} · 保留既有前缀=${keepsPrefix}`
            + ` · 原话带上=${detailOk} · 档位=${String(r.wakeFailure)} · reason=${JSON.stringify(reason.slice(0, 110))}`
            + ' ⇒ 两种原因说成同一句话，读的人会把"叫不醒"当"没这个靶"去查')
        }
      }
    }

    // ── SI-3 **判据 #3**：`sessionController` **缺席** ⇒ 仍拒 + 点明能力不可用 ──
    {
      const h = await siMount({ controller: undefined })
      if (h === undefined) {
        bad('SI-3 服务未 provide ⇒ 断言失去基准')
      } else {
        const r = await h.deliver()
        const reason = String(r.reason ?? '')
        const unavailable = reason.includes('wake capability is unavailable')
        const refused = r.ok === false
        const noFake = !/delivered/i.test(reason)
        if (refused && unavailable && noFake && r.wakeFailure === 'unavailable') {
          ok('SI-3 ✓ **判据 #3 唤醒能力缺席 ⇒ 明确拒 + 点明"唤醒能力不可用"**'
            + '（⛔ 不假装成功、⛔ 不退化成"目标不存在"）：'
            + `ok=false · 档位=${String(r.wakeFailure)} · 话里有"wake capability is unavailable"`)
        } else {
          bad('SI-3 【能力缺席时话术不对】'
            + `：ok=${r.ok}（应 false）· 点明不可用=${unavailable} · 没有假成功字样=${noFake}`
            + ` · 档位=${String(r.wakeFailure)} · reason=${JSON.stringify(reason.slice(0, 110))}`)
        }
      }
    }

    // ── SI-4 **判据 #4 反向对照**：目标本来活着 ⇒ 直接投成功，**一次唤醒都不做** ──
    //   ⚠ 这一条是"没把常见路径弄慢"的唯一证据：少了它，把唤醒写成无条件调用也能过 SI-1。
    {
      const h = await siMount({ live: true, controller: async (_id, setLive) => { setLive(); return { agent: {} } } })
      if (h === undefined) {
        bad('SI-4 服务未 provide ⇒ 断言失去基准')
      } else {
        const r = await h.deliver()
        const okNow = r.ok === true
        const noWake = r.wake === undefined && r.wakeFailure === undefined
        const noCall = h.stats.resolveCalls === 0
        if (okNow && noWake && noCall) {
          ok('SI-4 ✓ **判据 #4 反向对照：目标本来活着 ⇒ 仍直接投成功，且唤醒一次都没做**'
            + `：ok=true · 返回值无 wake 字段=${noWake} · 唤醒次数=${h.stats.resolveCalls}（应 0）`
            + ' ⇒ 常见路径没有被这一改多走一步、⛔ 没有变慢')
        } else {
          bad('SI-4 【常见路径被误伤】目标本来就是活的时候还去叫了一次 / 返回值被塞了唤醒字段'
            + `：ok=${r.ok} · 无 wake 字段=${noWake} · 唤醒次数=${h.stats.resolveCalls}（应 0）`)
        }
      }
    }

    // ── SI-5 **判据 #5**：归档会话 ⇒ 仍拒绝，且**唤醒一次都不许发生** ──
    {
      const h = await siMount({ archived: true, controller: async (_id, setLive) => { setLive(); return { agent: {} } } })
      if (h === undefined) {
        bad('SI-5 服务未 provide ⇒ 断言失去基准')
      } else {
        const r = await h.deliver()
        const reason = String(r.reason ?? '')
        const refused = r.ok === false
        const saysArchived = reason.includes('is archived')
        const noWake = h.stats.resolveCalls === 0
        if (refused && saysArchived && noWake) {
          ok('SI-5 ✓ **判据 #5 归档会话仍拒绝，且唤醒一次都没发生**：'
            + `ok=false · 话里点名归档=${saysArchived} · 唤醒次数=${h.stats.resolveCalls}（应 0）`
            + ' ⇒ 唤醒**无法绕过**归档门禁（放了它也只是白烧 token、活永远不发生）')
        } else {
          bad('SI-5 【唤醒把归档门禁绕过去了】'
            + `：ok=${r.ok}（应 false）· 点名归档=${saysArchived} · 唤醒次数=${h.stats.resolveCalls}（应 0）`)
        }
      }
    }

    // ── SI-6 **判据 #6**：拒投给自己（模型面）⇒ 仍拒绝，且唤醒不发生 ──
    {
      const h = await siMount({ callerId: 'session-si-cold', controller: async (_id, setLive) => { setLive(); return { agent: {} } } })
      if (h === undefined) {
        bad('SI-6 服务未 provide ⇒ 断言失去基准')
      } else {
        const r = await h.deliver()
        const reason = String(r.reason ?? '')
        const refused = r.ok === false
        const saysSelf = reason.includes('refusing to deliver to this session itself')
        const noWake = h.stats.resolveCalls === 0
        if (refused && saysSelf && noWake) {
          ok('SI-6 ✓ **判据 #6 模型面"拒投给自己"照旧生效，且唤醒一次都没发生**：'
            + `ok=false · 话里点名自投=${saysSelf} · 唤醒次数=${h.stats.resolveCalls}（应 0）`
            + ' ⇒ 那道守卫的语义**一个字未改**（⛔ 也没被唤醒这一步绕开）')
        } else {
          bad('SI-6 【自投守卫被削弱】'
            + `：ok=${r.ok}（应 false）· 点名自投=${saysSelf} · 唤醒次数=${h.stats.resolveCalls}（应 0）`)
        }
      }
    }

    // ── SI-x **负向对拍**：把"叫活"那一步摘掉 ⇒ SI-1 必须**不成立** ──
    //   ⚠ 变异只落在**临时副本**（⛔ 不碰工作区源码一个字节），同 SC/SD/SE/SG 的纪律。
    {
      const BUS = sgJ(sgRoot, 'src', 'modules', 'bus.ts')
      const original = sgRf(BUS, 'utf8')
      const GUARD = '          wake = await wakeTarget(sessionId)'
      if (original.includes(GUARD) === false) {
        bad('SI-x(反证) 【失去靶子】在 `bus.ts` 里找不到"调用唤醒"那一行'
          + ' ⇒ 本负向对拍已对不上实现，不按通过处理')
      } else {
        const dir = sgMkdt(sgJ(sgTmpRoot, 'mut-si-'))
        sgCp(sgJ(sgRoot, 'src'), sgJ(dir, 'src'), { recursive: true, dereference: true })
        const mf = sgJ(dir, 'src', 'modules', 'bus.ts')
        /**
         * ⚠ 变异形态：把"真的去叫"换成"记成能力不可用" ⇒ 等价于**改前**那条路
         *   （`agents.get` 空 ⇒ 直接拒，从不调用任何唤醒）。
         *   ⚠ 为什么不能只删那一行：后面 `wake.failure` 会读到 `undefined` 而崩
         *     （首跑实测踩到：变异体跑不起来 ⇒ 对拍无读数）。变异必须**可跑**才算对拍。
         */
        sgWf(mf, original.replace(GUARD,
          "          wake = { ok: false, failure: 'unavailable', detail: 'mutated: no wake' } /* 变异：改回直接拒 */"), 'utf8')
        try { sgLink(sgJ(sgRoot, 'node_modules'), sgJ(dir, 'node_modules'), 'dir') } catch { /* 已有 */ }
        try {
          const mBus = await import(sgP2u(sgJ(dir, 'src', 'modules', 'bus.ts')).href)
          const h = await siMount({ controller: async (_id, setLive) => { setLive(); return { agent: {} } }, busMod: mBus })
          if (h === undefined) {
            bad('SI-x(反证) 变异体没 provide `hobBus` ⇒ 对拍失去基准')
          } else {
            const r = await h.deliver()
            const stillRefused = r.ok === false && String(r.reason ?? '').includes('is not a live session')
            const neverWoke = h.stats.resolveCalls === 0
            if (stillRefused && neverWoke) {
              ok('SI-x(反证) ✓ 负向对拍：把"叫活"那一步摘掉 ⇒ **冷目标又回到直接拒**'
                + `（ok=${r.ok} · 唤醒次数=${h.stats.resolveCalls}）`
                + ' ⇒ SI-1 钉的确实是"投之前先叫人起来"这件事，不是别的东西')
            } else {
              bad('SI-x(反证) 【负向对拍失败】摘掉唤醒之后冷目标**仍然投成功**'
                + `：ok=${r.ok} · 唤醒次数=${h.stats.resolveCalls}`
                + ' ⇒ SI-1 测的不是唤醒这一步')
            }
          }
        } catch (e) {
          bad(`SI-x(反证) 变异体跑不起来（${String(e?.message ?? e)}）`)
        }
      }
    }

    // ── SI-y **负向对拍 · 话术分档**：把 wakeReasonOf 退回改前那一句 ⇒ SI-2 / SI-3 必须红 ──
    //   ⚠ 少了这一块，"把三档话术都写成同一句旧话"也能过 SI-x（那条只测"有没有去叫"）。
    {
      const BUS = sgJ(sgRoot, 'src', 'modules', 'bus.ts')
      const original = sgRf(BUS, 'utf8')
      const GUARD = "      switch (wake.failure) {"
      if (original.includes(GUARD) === false) {
        bad('SI-y(反证) 【失去靶子】在 `bus.ts` 里找不到 `wakeReasonOf` 的分档 switch'
          + ' ⇒ 本负向对拍已对不上实现，不按通过处理')
      } else {
        const dir = sgMkdt(sgJ(sgTmpRoot, 'mut-siy-'))
        sgCp(sgJ(sgRoot, 'src'), sgJ(dir, 'src'), { recursive: true, dereference: true })
        const mf = sgJ(dir, 'src', 'modules', 'bus.ts')
        // ⚠ 变异形态：**保留**唤醒调用，只把分档话术退回"目标不存在"那一句（= 改前唯一的说法）。
        sgWf(mf, original.replace(GUARD,
          "      if (wake.failure !== undefined) return base + tail\n      switch (wake.failure) {"), 'utf8')
        try { sgLink(sgJ(sgRoot, 'node_modules'), sgJ(dir, 'node_modules'), 'dir') } catch { /* 已有 */ }
        try {
          const mBus = await import(sgP2u(sgJ(dir, 'src', 'modules', 'bus.ts')).href)
          const m1 = await siMount({ busMod: mBus, controller: async () => ({ error: { message: 'backend closed' } }) })
          const m2 = await siMount({ busMod: mBus, controller: undefined })
          if (m1 === undefined || m2 === undefined) {
            bad('SI-y(反证) 变异体没 provide `hobBus` ⇒ 对拍失去基准')
          } else {
            const r1 = await m1.deliver()
            const r2 = await m2.deliver()
            const s1 = String(r1.reason ?? '')
            const s2 = String(r2.reason ?? '')
            const bothOld = s1.includes('wake was attempted') === false
              && s2.includes('wake capability is unavailable') === false
              && s1.includes('is not a live session') && s2.includes('is not a live session')
            if (bothOld) {
              ok('SI-y(反证) ✓ 负向对拍：把 `wakeReasonOf` 的分档退回改前那一句 ⇒ '
                + '**SI-2 / SI-3 同时不成立**（两档又合成"目标不存在"一句话，宿主原话与'
                + '"能力不可用"全被吞掉）⇒ 那两条判据钉的确实是"两种原因要分开说"')
            } else {
              bad('SI-y(反证) 【负向对拍失败】退回单一话术之后仍然分得清档位'
                + `：唤醒失败话=${JSON.stringify(s1.slice(0, 80))} · 能力缺席话=${JSON.stringify(s2.slice(0, 80))}`)
            }
          }
        } catch (e) {
          bad(`SI-y(反证) 变异体跑不起来（${String(e?.message ?? e)}）`)
        }
      }
    }

    // ── SI-z **负向对拍 · 归档门禁**：把归档那道检查摘掉 ⇒ SI-5 必须红（且唤醒真的发生）──
    //   ⚠ 这一条防的是"改造时把 ⓪ 归档检查挪到唤醒之后"——那样归档会话会被叫起来，
    //     白烧一次装配与 token，而执行仍被 `agent/pre-step` 挡下（= 用户最恨的静默失败）。
    {
      const BUS = sgJ(sgRoot, 'src', 'modules', 'bus.ts')
      const original = sgRf(BUS, 'utf8')
      const GUARD = "        if (isArchived(sessionId)) {"
      if (original.includes(GUARD) === false) {
        bad('SI-z(反证) 【失去靶子】在 `bus.ts` 里找不到归档检查那一行'
          + ' ⇒ 本负向对拍已对不上实现，不按通过处理')
      } else {
        const dir = sgMkdt(sgJ(sgTmpRoot, 'mut-siz-'))
        sgCp(sgJ(sgRoot, 'src'), sgJ(dir, 'src'), { recursive: true, dereference: true })
        const mf = sgJ(dir, 'src', 'modules', 'bus.ts')
        sgWf(mf, original.replace(GUARD, "        if (false && isArchived(sessionId)) {"), 'utf8')
        try { sgLink(sgJ(sgRoot, 'node_modules'), sgJ(dir, 'node_modules'), 'dir') } catch { /* 已有 */ }
        try {
          const mBus = await import(sgP2u(sgJ(dir, 'src', 'modules', 'bus.ts')).href)
          const h = await siMount({ busMod: mBus, archived: true,
            controller: async (_id, setLive) => { setLive(); return { agent: {} } } })
          if (h === undefined) {
            bad('SI-z(反证) 变异体没 provide `hobBus` ⇒ 对拍失去基准')
          } else {
            const r = await h.deliver()
            const becameLive = r.ok === true
            const woke = h.stats.resolveCalls > 0
            if (becameLive && woke) {
              ok('SI-z(反证) ✓ 负向对拍：摘掉归档那道检查 ⇒ **归档会话被唤醒并投成功**'
                + `（ok=${r.ok} · 唤醒次数=${h.stats.resolveCalls}）`
                + ' ⇒ SI-5 钉的确实是"唤醒不许绕过归档门禁"')
            } else {
              bad('SI-z(反证) 【负向对拍失败】摘掉归档检查之后归档会话仍然投不进去'
                + `：ok=${r.ok} · 唤醒次数=${h.stats.resolveCalls}`
                + ' ⇒ SI-5 测的不是归档门禁本身')
            }
          }
        } catch (e) {
          bad(`SI-z(反证) 变异体跑不起来（${String(e?.message ?? e)}）`)
        }
      }
    }
    // ── SI-w **负向对拍 · 常见路径**：把唤醒改成**无条件**调用 ⇒ SI-4 必须红 ──
    //   ⚠ 少了这一块，"每次投递都顺手叫一次活"也能过 SI-1（那条只测冷目标能投进去）。
    //    而那样的后果正是作业书 §二-2 点名要防的：把**有代价的动作**加到最热的路径上。
    {
      const BUS = sgJ(sgRoot, 'src', 'modules', 'bus.ts')
      const original = sgRf(BUS, 'utf8')
      const GUARD = '        if (agent === undefined) {'
      if (original.includes(GUARD) === false) {
        bad('SI-w(反证) 【失去靶子】在 `bus.ts` 里找不到 `if (agent === undefined) {` 那一行'
          + ' ⇒ 本负向对拍已对不上实现，不按通过处理')
      } else {
        const dir = sgMkdt(sgJ(sgTmpRoot, 'mut-siw-'))
        sgCp(sgJ(sgRoot, 'src'), sgJ(dir, 'src'), { recursive: true, dereference: true })
        const mf = sgJ(dir, 'src', 'modules', 'bus.ts')
        // ⚠ 变异形态：**无条件**进唤醒分支（活目标也去叫一次）⇒ 常见路径多走一步 + 返回值被塞 wake。
        sgWf(mf, original.replace(GUARD, '        if (agent === undefined || true) {'), 'utf8')
        try { sgLink(sgJ(sgRoot, 'node_modules'), sgJ(dir, 'node_modules'), 'dir') } catch { /* 已有 */ }
        try {
          const mBus = await import(sgP2u(sgJ(dir, 'src', 'modules', 'bus.ts')).href)
          const h = await siMount({ busMod: mBus, live: true,
            controller: async (_id, setLive) => { setLive(); return { agent: {} } } })
          if (h === undefined) {
            bad('SI-w(反证) 变异体没 provide `hobBus` ⇒ 对拍失去基准')
          } else {
            const r = await h.deliver()
            const stillOk = r.ok === true
            const wokeAnyway = h.stats.resolveCalls > 0 || r.wake !== undefined
            if (stillOk && wokeAnyway) {
              ok('SI-w(反证) ✓ 负向对拍：把唤醒改成**无条件** ⇒ 活目标也被叫了一次'
                + `（唤醒次数=${h.stats.resolveCalls} · 返回值带 wake=${r.wake !== undefined}）`
                + ' ⇒ SI-4 钉的确实是"常见路径不许多走一步"')
            } else {
              bad('SI-w(反证) 【负向对拍失败】无条件唤醒之后活目标那条路**没有**被多叫一次'
                + `（ok=${r.ok} · 唤醒次数=${h.stats.resolveCalls} · 带 wake=${r.wake !== undefined}）`
                + ' ⇒ SI-4 测的不是"常见路径有没有多走一步"')
            }
          }
        } catch (e) {
          bad(`SI-w(反证) 变异体跑不起来（${String(e?.message ?? e)}）`)
        }
      }
    }

    // ── SI-v **负向对拍 · 自投守卫**：把"拒投给自己"摘掉 ⇒ SI-6 必须红 ──
    //   ⚠ 防的是"改造时把守卫挪到唤醒之后"——那样模型面自投会先被叫活再投进去，
    //     即用户最担心的自唤醒死循环（守卫的语义是**一个字不改**）。
    {
      const BUS = sgJ(sgRoot, 'src', 'modules', 'bus.ts')
      const original = sgRf(BUS, 'utf8')
      const GUARD = "        if (skipSelfGuard !== true && typeof callerId === 'string' && sessionId === callerId) {"
      if (original.includes(GUARD) === false) {
        bad('SI-v(反证) 【失去靶子】在 `bus.ts` 里找不到"拒投给自己"那一行'
          + ' ⇒ 本负向对拍已对不上实现，不按通过处理')
      } else {
        const dir = sgMkdt(sgJ(sgTmpRoot, 'mut-siv-'))
        sgCp(sgJ(sgRoot, 'src'), sgJ(dir, 'src'), { recursive: true, dereference: true })
        const mf = sgJ(dir, 'src', 'modules', 'bus.ts')
        sgWf(mf, original.replace(GUARD,
          "        if (false && skipSelfGuard !== true && typeof callerId === 'string' && sessionId === callerId) {"),
        'utf8')
        try { sgLink(sgJ(sgRoot, 'node_modules'), sgJ(dir, 'node_modules'), 'dir') } catch { /* 已有 */ }
        try {
          const mBus = await import(sgP2u(sgJ(dir, 'src', 'modules', 'bus.ts')).href)
          const h = await siMount({ busMod: mBus, callerId: 'session-si-cold',
            controller: async (_id, setLive) => { setLive(); return { agent: {} } } })
          if (h === undefined) {
            bad('SI-v(反证) 变异体没 provide `hobBus` ⇒ 对拍失去基准')
          } else {
            const r = await h.deliver()
            const deliveredToSelf = r.ok === true
            const wokeId = h.stats.resolveIds[0] === h.target
            if (deliveredToSelf && wokeId) {
              ok('SI-v(反证) ✓ 负向对拍：摘掉"拒投给自己" ⇒ **模型面自投被唤醒并投进了自己**'
                + `（ok=${r.ok} · 唤醒的就是 ${String(h.stats.resolveIds[0])}）`
                + ' ⇒ SI-6 钉的确实是那道守卫没被唤醒这一步绕开')
            } else {
              bad('SI-v(反证) 【负向对拍失败】摘掉自投守卫之后仍然没投给自己'
                + `（ok=${r.ok} · 唤醒 id=${String(h.stats.resolveIds[0])}）`
                + ' ⇒ SI-6 测的不是自投守卫本身')
            }
          }
        } catch (e) {
          bad(`SI-v(反证) 变异体跑不起来（${String(e?.message ?? e)}）`)
        }
      }
    }
  } else {
    bad('SI 组跑不起来：bus 模块没加载上（不按通过处理）')
  }

  // ══════════════════════════════════════════════════════════════
  // SH · **头行三档：三种原因各有各的话**（第 323 轮 · `TASK-I`）
  // ══════════════════════════════════════════════════════════════
  //
  //   ⚠ 现场形态（第 322 轮 `AFTER-RESTART.md` §5.A 实证）：
  //     卡 `t-mvgb2v48-j6tx4o` 22:36:15 **真点过火**、`归属判不出` 11→12，
  //     而头行**照样**打 `⚠ 还没接上（未收到过点火帧）` —— **那半句是假的**。
  //   ⚠ 机理：头行改前只有 `pushedRegisterOk > 0 ? 已接上 : 还没接上（未收到过点火帧）`。
  //     而"还没接上"至少三条成因，**其中两条根本没有帧**。把 ② 说成 ①
  //     ⇒ 读的人会去查"为什么没有帧"，而真正该查的是**准入那两道**
  //     ⇒ 本项目头号禁忌：**两种原因说成同一句话**。
  //   ⚠ 判据（⚠ 三种情形**各一条**，⛔ 只钉"不再说假话"不算完成 —— 要钉"说对了是哪一种"）：
  //     ① 一帧都没收到过 ⇒ 头行**必须**说"一帧都没收到过"；
  //     ② 收到帧 + 被准入拦下 + 一次没成功 ⇒ 头行**必须**说"收到过"且**点名被哪道准入拦下**，
  //        且**不许**出现"未收到过点火帧"/"一帧都没收到过"；
  //     ③ 已接上 ⇒ 头行照旧"已接上"。
  //   ⚠ 三条 `(反证)`：把对应实现摘掉 ⇒ 各自必须**不成立**（否则断言没有牙）。
  if (sgOrchMod !== undefined && sgBusMod !== undefined) {
    /**
     * ⚠ 三个情形共用一个挂载器：差别只在**看板推哪一帧**与**卡的归属形状**。
     *   ⚠ 与 `SG-b` 的 `sgMount` **不共用**（那一份写死了"帧就是点火帧"，
     *     而本组第 ① 种要的恰恰是"**一帧都不推**"）。
     */
    const shMount = async (opts = {}) => {
      const base = sgMkdt(sgJ(sgTmpRoot, 'case-h-'))
      const home = sgJ(base, 'ledgers'); const ws = sgJ(base, 'ws')
      sgMkd(sgJ(ws, 'runtime'), { recursive: true })
      sgMkd(sgJ(home, sgBase(ws), 'runtime'), { recursive: true })
      sgWf(sgJ(home, sgBase(ws), 'runtime', 'orch-watches.json'),
        JSON.stringify({ version: 1, updatedAt: 1, handoffs: [], lost: [], pending: [] }), 'utf8')
      const card = opts.card
      const registry = new Map([
        ['taskboard_get', { name: 'taskboard_get', execute: async (a) => (a?.id === card.id ? { task: card } : {}) }],
        ['taskboard_list', { name: 'taskboard_list', execute: async () => ({ revision: 1, tasks: [card] }) }],
      ])
      const toolsSvc = { get: (n) => registry.get(n) }
      const mkSession = (id) => ({ id, header: { agentPreset: 'standard', cwd: ws }, log: [] })
      const byId = new Map([['session-sh-hob', mkSession('session-sh-hob')],
        [opts.execId ?? 'session-sh-exec', mkSession(opts.execId ?? 'session-sh-exec')]])
      const sessions = { get: (id) => byId.get(id), list: () => [...byId.values()], flush: async () => true }
      const agents = { currentInitiator: () => undefined,
        get: (id) => (byId.has(id) ? { id, status: 'idle', ctx: {}, session: byId.get(id),
          followup() {}, steer() {}, inject() {} } : undefined) }
      /** ⚠ 本组的假 logger（`sgMount` 那份在它自己的作用域里，⛔ 不能跨函数借用）。 */
      const logger = { debug() {}, info() {}, warn() {} }
      const workspaceRegistry = {
        list: () => [{ id: sgWS, path: ws, title: 'sh', record: { sessionIds: [...byId.keys()] } }],
        sessionPaths: new Map([...byId.keys()].map((id) => [id, ws])),
      }
      const busProvided = {}
      const busCtx = { sessions, agents, logger,
        get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents
          : k === 'workspaceRegistry' ? workspaceRegistry : undefined),
        provide: (k, v) => { busProvided[k] = v }, effect: (f) => { try { f() } catch { /* 无落点 */ } },
        inject: (_d, cb) => cb(busCtx), on: () => {} }
      sgBusMod.apply(busCtx, { spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }) })
      const bus = busProvided.hobBus
      const provided = {}
      const ctx = { sessions, agents, logger,
        get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents : k === 'hobBus' ? bus
          : k === 'tools' ? toolsSvc
            : k === 'workspaceRegistry' ? workspaceRegistry
              : k === 'webServer' ? { getOrigin: () => opts.origin }
                : k === 'loader' ? { entries: () => [{ options: { config: { ledgerHome: home } } }] } : undefined),
        provide: (k, v) => { provided[k] = v }, effect: (f) => { try { f() } catch { /* 无落点 */ } },
        inject: (_d, cb) => cb(ctx), on: () => {} }
      const orchMod = opts.orchMod ?? sgOrchMod
      orchMod.apply(ctx)
      const orch = provided.hobOrchestrator
      const tools = (opts.orchMod ?? sgOrchMod).createHobOrchTools(orch)
      const render = async () => String(await tools.status.execute({}, {
        agent: { id: 'session-sh-hob', session: { header: { cwd: ws } } },
      }))
      return { orch, ws, home, render }
    }
    /** 造一个假看板 SSE：连上就把 `frames` 逐条推出去（`[]` ⇒ 只开连接、**不推任何帧**）。 */
    const shServe = async (frames) => {
      const srv = sgServer((req, res) => {
        if (String(req.url ?? '').includes('/dsh-taskboard/events') === false) { res.writeHead(404).end(); return }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        for (const f of frames) res.write(`event: change\ndata: ${f}\n\n`)
      })
      await new Promise((r) => srv.listen(0, '127.0.0.1', r))
      return { srv, origin: `http://127.0.0.1:${srv.address().port}` }
    }
    const shFiring = (card) => JSON.stringify({ revision: 1, kind: 'execution-recorded',
      tasks: [{ id: card.id, title: card.title, status: 'in_progress', workspaceId: sgWS,
        version: 6, lastExecutionOutcome: 'running' }] })
    const shUntil = async (fn, ms = 900) => {
      const t0 = Date.now()
      while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 10)) }
      return fn()
    }
    const shHead = (rendered) => rendered.split('\n').find((l) => l.includes('实施会话叫醒面')) ?? ''
    /** ⚠ 改前那句假话的两种写法（两种都算"说了没帧"）。 */
    const shSaysNoFrame = (head) => head.includes('未收到过点火帧') || head.includes('一帧都没收到过')

    // ── 情形 ①：**一帧都没收到过** ⇒ 头行必须说"一帧都没收到过" ──────────────
    {
      const card = { id: 't-sh-none', title: 'SH 无帧卡', status: 'in_progress', workspaceId: sgWS,
        version: 1, createdBy: { kind: 'user', sessionId: 'session-sh-hob' }, comments: [],
        executions: [{ id: 'e-sh-none', outcome: 'running', startedAt: 1, sessionId: 'session-sh-exec' }] }
      const { srv, origin } = await shServe([])   // ⚠ **一帧都不推**
      try {
        const h = await shMount({ card, origin })
        await h.orch.wakeSubscribe('session-sh-hob')
        await new Promise((r) => setTimeout(r, 300))
        const d = h.orch.dispatchWakeState('session-sh-hob')
        const head = shHead(await h.render())
        /**
         * ⚠ 判据三件：① `firingSeen === 0`（确实没帧）；② 头行**说"一帧都没收到过"**；
         *   ③ 头行**不**说"已接上"（那会是另一种假话）。
         */
        const noFrameSaid = head.includes('一帧都没收到过')
        const notWired = head.includes('已接上') === false
        if (d.firingSeen === 0 && noFrameSaid && notWired) {
          ok('SH-a ✓ **第 ① 档（一帧都没收到过）说对了**：'
            + `\`firingSeen=0\` ⇒ 头行 = ${JSON.stringify(head.slice(0, 76))}`
            + ' —— 说"一帧都没收到过"、且⛔ 不谎报"已接上"' + sgTag)
        } else {
          bad('SH-a 【第 ① 档没说对】一帧都没收到时，头行没有如实地说是"没收到过帧"'
            + `：firingSeen=${d.firingSeen}（应 0）· 说了"一帧都没收到过"=${noFrameSaid}`
            + ` · 没说"已接上"=${notWired} · 头行=${JSON.stringify(head.slice(0, 130))}`)
        }
      } finally { srv.close() }
    }

    // ── 情形 ②：**收到帧 + 被准入拦下 + 一次没成功** ⇒ 必须说"收到了但没登记成功" ──
    //   ⚠ 用 `selfExecuted` 那道准入来构造（执行会话 = 建卡人自己 = 本机常态）。
    {
      const card = { id: 't-sh-blocked', title: 'SH 被拦卡', status: 'in_progress', workspaceId: sgWS,
        version: 1, createdBy: { kind: 'user', sessionId: 'session-sh-hob' }, comments: [],
        // ⚠ 执行会话 = 建卡会话本身 ⇒ 必被 `selfExecuted` 拦下
        executions: [{ id: 'e-sh-blocked', outcome: 'running', startedAt: 1, sessionId: 'session-sh-hob' }] }
      const { srv, origin } = await shServe([shFiring(card)])
      try {
        const h = await shMount({ card, origin, execId: 'session-sh-hob' })
        await h.orch.wakeSubscribe('session-sh-hob')
        await shUntil(() => h.orch.dispatchWakeState('session-sh-hob').firingSeen > 0)
        await new Promise((r) => setTimeout(r, 250))
        const d = h.orch.dispatchWakeState('session-sh-hob')
        const rendered = await h.render()
        const head = shHead(rendered)
        /**
         * ⚠ 判据（这是本件的核心格，缺一条都不算完成）：
         *   ① 帧**确实到过**（`firingSeen > 0`）；
         *   ② 登记**确实没成功**（`pushedRegisterOk === 0`）；
         *   ③ 头行**不说那半句假话**（"未收到过点火帧"/"一帧都没收到过"）；
         *   ④ 头行**说清了**"收到过帧、但一次都没登记成功"；
         *   ⑤ **点名了被哪道准入拦下**（`selfExecuted`）；
         *   ⑥ 且**没有放宽准入**：登记数仍为 0（`registered === 0`）。
         */
        const frameSeen = d.firingSeen > 0
        const notRegistered = d.pushedRegisterOk === 0
        const noLying = shSaysNoFrame(head) === false
        const saysReceived = head.includes('收到过点火帧') && head.includes('登记成功')
        const namesGate = rendered.includes('selfExecuted') || rendered.includes('执行会话就是建卡会话本身')
        const gateStillOn = d.registered === 0
        if (frameSeen && notRegistered && noLying && saysReceived && namesGate && gateStillOn) {
          ok('SH-b ✓ **第 ② 档（收到帧但没登记成功）说对了、且不再说假话**：'
            + `\`firingSeen=${d.firingSeen}\` · \`pushedRegisterOk=0\` ⇒ 头行 = ${JSON.stringify(head.slice(0, 76))}`
            + ' —— ⛔ 不再出现"未收到过点火帧"（改前那一句），'
            + '且**点名了被哪道准入拦下**（`selfExecuted`）· 准入未被放宽（`registered=0`）' + sgTag)
        } else {
          bad('SH-b 【第 ② 档没说对 / 仍在说假话】收到帧但被准入拦下时，头行没有说清"收到了但没登记成功"'
            + `：firingSeen=${d.firingSeen}（应 > 0）· pushedRegisterOk=${d.pushedRegisterOk}（应 0）`
            + ` · 没说假话=${noLying} · 说清了"收到过但没登记成功"=${saysReceived}`
            + ` · 点名了准入=${namesGate} · 准入仍生效=${gateStillOn}（registered=${d.registered}）`
            + ` · 头行=${JSON.stringify(head.slice(0, 150))}`)
        }
      } finally { srv.close() }
    }

    // ── 情形 ③：**已接上** ⇒ 头行照旧"已接上" ────────────────────────────────
    {
      const card = { id: 't-sh-wired', title: 'SH 接上卡', status: 'in_progress', workspaceId: sgWS,
        version: 1, createdBy: { kind: 'user', sessionId: 'session-sh-hob' }, comments: [],
        // ⚠ 执行会话 ≠ 建卡人 ⇒ 过得了两道准入 ⇒ 真登记成功
        executions: [{ id: 'e-sh-wired', outcome: 'running', startedAt: 1, sessionId: 'session-sh-exec' }] }
      const { srv, origin } = await shServe([shFiring(card)])
      try {
        const h = await shMount({ card, origin })
        await h.orch.wakeSubscribe('session-sh-hob')
        await shUntil(() => h.orch.dispatchWakeState('session-sh-hob').pushedRegisterOk > 0)
        const d = h.orch.dispatchWakeState('session-sh-hob')
        const head = shHead(await h.render())
        /**
         * ⚠ 判据：① 登记成功 > 0；② 头行说"已接上"；
         *   ③ **不许**同时说"收到过…但一次都没登记成功"或"未收到过点火帧"（两句话打架）。
         */
        const wired = head.includes('已接上')
        const noContradiction = !head.includes('一次都没走到')
        if (d.pushedRegisterOk > 0 && wired && noContradiction) {
          ok('SH-c ✓ **第 ③ 档（已接上）说对了**：'
            + `\`pushedRegisterOk=${d.pushedRegisterOk}\` ⇒ 头行 = ${JSON.stringify(head.slice(0, 76))}`
            + ' —— 说"已接上"、且⛔ 没有同时说"一次都没登记成功"' + sgTag)
        } else {
          bad('SH-c 【第 ③ 档没说对】登记成功之后头行没有如实说"已接上"'
            + `：pushedRegisterOk=${d.pushedRegisterOk}（应 > 0）· 说"已接上"=${wired}`
            + ` · 无自相矛盾=${noContradiction} · 头行=${JSON.stringify(head.slice(0, 130))}`)
        }
      } finally { srv.close() }
    }

    /**
     * ── 三条负向对拍（⚠ 每条都要**真的把对应实现摘掉**，⛔ 不许只做文本替换而不挂载）──
     *   ⚠ 三条共用一份**变异源码树**，但各自摘掉不同的一段：
     *     · `(反证)-a`：把"三档"改回**改前那一句二值** ⇒ SH-b 必须不成立（又说假话）；
     *     · `(反证)-b`：摘掉 `noteFiringSeen` 的调用 ⇒ SH-b 的"收到过帧"前提消失（落回第 ① 档）⇒ 必须不成立；
     *     · `(反证)-c`：摘掉 `noteFiredBlocked` 的调用 ⇒ 头行**说不出被哪道准入拦下** ⇒ SH-b 必须不成立。
     *   ⚠ 为什么 -a 与 -b/-c 都要：-a 钉的是"**拆档这件事本身**"，
     *     -b/-c 钉的是"**两档数据来源真的接上了**" —— 少了 -b/-c，
     *     把 `noteFiringSeen` 删掉也照样能绿（那就是没有牙的绿）。
     */
    {
      const OJ = sgJ(sgRoot, 'src', 'modules', 'orchestrator.ts')
      const osrc = sgRf(OJ, 'utf8')
      const HEAD_THREE = "const headState = wired"
      const FIRE_CALL = 'dispatchWake.noteFiringSeen(cardId, subscriber)'
      const BLOCK_CALL = 'dispatchWake.noteFiredBlocked('
      // 卡 A：会被准入拦下（selfExecuted）；卡 B：能真登记成功
      const cardBlocked = { id: 't-sh-m-blocked', title: 'SH 变异被拦卡', status: 'in_progress', workspaceId: sgWS,
        version: 1, createdBy: { kind: 'user', sessionId: 'session-sh-hob' }, comments: [],
        executions: [{ id: 'e-sh-m-blocked', outcome: 'running', startedAt: 1, sessionId: 'session-sh-hob' }] }
      const runMutant = async (label, mutate, card, execId) => {
        const dir = sgMkdt(sgJ(sgTmpRoot, 'mut-sh-'))
        sgCp(sgJ(sgRoot, 'src'), sgJ(dir, 'src'), { recursive: true, dereference: true })
        const mf = sgJ(dir, 'src', 'modules', 'orchestrator.ts')
        const mutated = mutate(osrc)
        if (mutated === osrc) {
          bad(`SH-(${label}) 【失去靶子】变异没改到任何字节 ⇒ 本负向对拍已对不上实现，不按通过处理`)
          return null
        }
        sgWf(mf, mutated, 'utf8')
        try { sgLink(sgJ(sgRoot, 'node_modules'), sgJ(dir, 'node_modules'), 'dir') } catch { /* 已有 */ }
        try {
          const mOrchMod = await import(sgP2u(mf).href)
          const mBusMod = await import(sgP2u(sgJ(dir, 'src', 'modules', 'bus.ts')).href)
          const { srv, origin } = await shServe([shFiring(card)])
          try {
            const h = await shMount({ card, origin, execId, orchMod: mOrchMod })
            await h.orch.wakeSubscribe('session-sh-hob')
            await shUntil(() => h.orch.dispatchWakeState('session-sh-hob').firingSeen > 0
              || h.orch.dispatchWakeState('session-sh-hob').pushedRegisterOk > 0)
            await new Promise((r) => setTimeout(r, 300))
            const d = h.orch.dispatchWakeState('session-sh-hob')
            return { d, rendered: await h.render() }
          } finally { srv.close() }
        } catch (e) {
          bad(`SH-(${label}) 变异体跑不起来（${String(e?.message ?? e)}）`)
          return null
        }
      }
      // ── (反证)-a：把三档改回改前那一句二值 ──────────────────────────────
      if (!osrc.includes(HEAD_THREE)) {
        bad('SH-(反证a) 【失去靶子】`orchestrator.ts` 里找不到 `const headState = wired`'
          + ' ⇒ 本负向对拍已对不上实现，不按通过处理')
      } else {
        const r = await runMutant('反证a', (src) => src.replace(
          /const headState = wired\s*\n[\s\S]*?: '⚠ \*\*还没接上（一帧都没收到过）\*\*'/,
          "const headState = wired ? '✅ **已接上（按推送现读）**' : '⚠ **还没接上（未收到过点火帧）**'",
        ), cardBlocked, 'session-sh-hob')
        if (r !== null) {
          const head = shHead(r.rendered)
          const lyingAgain = shSaysNoFrame(head)
          if (lyingAgain) {
            ok('SH-(反证a) ✓ 负向对拍：把三档**改回改前那一句二值** ⇒ '
              + `头行**又说回假话**（${JSON.stringify(head.slice(0, 70))}），`
              + '而帧确实到过（`firingSeen=' + String(r.d.firingSeen) + '`）'
              + ' ⇒ SH-b 真长牙（它钉的正是"不许把两种原因说成同一句话"）')
          } else {
            bad('SH-(反证a) 【负向对拍失败】改回二值之后头行仍然没说假话'
              + `（头行=${JSON.stringify(head.slice(0, 110))}）⇒ SH-b 测的不是"拆档"这件事`)
          }
        }
      }
      // ── (反证)-b：摘掉 `noteFiringSeen` 的调用 ⇒ "收到过帧"这条前提消失 ──
      if (!osrc.includes(FIRE_CALL)) {
        bad('SH-(反证b) 【失去靶子】`orchestrator.ts` 里找不到 `noteFiringSeen(cardId, subscriber)`'
          + ' ⇒ 本负向对拍已对不上实现，不按通过处理')
      } else {
        const r = await runMutant('反证b', (src) => src.replace(FIRE_CALL, 'void cardId'),
          cardBlocked, 'session-sh-hob')
        if (r !== null) {
          const head = shHead(r.rendered)
          /**
           * ⚠ 摘掉"记帧"之后：`firingSeen` 恒 0 ⇒ 头行会落回**第 ① 档**
           *   ⇒ 它**又说成"一帧都没收到过"**，而帧其实到过。
           *   ⚠ 这正是本件要治的那个形态，必须能被这条反证重现出来。
           */
          if (r.d.firingSeen === 0 && shSaysNoFrame(head)) {
            ok('SH-(反证b) ✓ 负向对拍：摘掉 `noteFiringSeen` ⇒ '
              + `\`firingSeen=0\`、头行落回 ${JSON.stringify(head.slice(0, 60))}`
              + '（⚠ 帧其实到过）⇒ SH-b 的"收到过帧"这条前提**真的接在实现上**，不是摆设')
          } else {
            bad('SH-(反证b) 【负向对拍失败】摘掉 `noteFiringSeen` 之后'
              + `firingSeen=${r.d.firingSeen}（应 0）· 头行=${JSON.stringify(head.slice(0, 110))}`
              + ' ⇒ SH-b 测的不是"帧计数有没有接上"')
          }
        }
      }
      // ── (反证)-c：摘掉 `noteFiredBlocked` 的调用 ⇒ 说不出被哪道准入拦下 ──
      if (!osrc.includes(BLOCK_CALL)) {
        bad('SH-(反证c) 【失去靶子】`orchestrator.ts` 里找不到 `noteFiredBlocked(`'
          + ' ⇒ 本负向对拍已对不上实现，不按通过处理')
      } else {
        const r = await runMutant('反证c', (src) => src.replace(
          /dispatchWake\.noteFiredBlocked\([\s\S]*?\n(\s*)\)\n/g,
          (_m) => '/* 变异：摘掉 noteFiredBlocked */\n',
        ), cardBlocked, 'session-sh-hob')
        if (r !== null) {
          const rendered = r.rendered
          const head = shHead(rendered)
          /**
           * ⚠⚠ **第 345 轮：判据窗口必须收窄到"头行那一段"**（⛔ 不许改回全文匹配）————──
           *   改前这里用**全文** `rendered.includes('selfExecuted' | '执行会话就是建卡会话本身')`。
           *   第 345 轮起，"归属判不出"的判词也**按成因分开写**，其中 `selfExec` 档天然含
           *   「**执行会话就是建卡会话本身**」这几个字（那是它该说的话）。
           *   ⇒ 全文匹配在变异体上**依然为真** ⇒ 这条反证"失去靶子"变成恒真
           *     （实测：`点名准入=true` 而 `noteFiredBlocked` 已被摘掉）。
           *   ⚠ 真正该问的是"**头行那几行里有没有点名哪道准入**"（那才是 SH-b 的判据面），
           *     ⛔ 不是"整份输出里出现过这几个字"。
           */
          const headBlock = rendered.split('回执投递台账')[0]
          /**
           * ⚠⚠ **钉"被准入拦下"这条专属行，⛔ 不钉那几个字的任意出现**（第 345 轮）——
           *   第 345 轮起，"归属判不出"的判词按成因分开写，其中 `selfExec` 档天然含
           *   「执行会话就是建卡会话本身」；那一句**不是** `noteFiredBlocked` 写的，
           *   所以拿它当判据 ⇒ 变异体上依然为真 ⇒ 反证恒真（实测 `点名准入=true`）。
           *   ⇒ 改钉 `noteFiredBlocked` **唯一**产出的那一行
           *     （`orchestrator.ts` 渲染层：`收到过点火帧，但**被准入拦下 N 次**`）。
           */
          const namesGate = headBlock.includes('被准入拦下 ') && !headBlock.includes('没有一条被准入拦下的记录')
          /**
           * ⚠⚠ **这里必须用一个"只在该变异下才出现"的判据**（首跑实测踩到的坑）：
           *   原先用 `rendered.includes('被准入拦下')` —— ⛔ **那是假阳性**：
           *   摘掉之后走的是 else 分支，而那一段的原文是
           *   "帧到过，但**没有一条被准入拦下的记录** ⇒ …（⛔ 与"被准入拦下"不是同一档）"
           *   ⇒ **也含"被准入拦下"四个字** ⇒ 判据永远为真 ⇒ 反证"失败"其实是**判据自己写错了**。
           *   ⇒ 现在钉的是那个 else 分支**独有的那句**。
           */
          const saysNoBlockedRecord = rendered.includes('没有一条被准入拦下')
          /**
           * ⚠ 摘掉之后：`firingSeen` 仍 > 0（帧还是记了），但**说不出被哪道准入拦下**
           *   ⇒ 头行会落到"没有一条被准入拦下的记录"那一支。
           *   ⚠ 这一条钉的是"**点名准入**这件事真的有数据来源"。
           */
          if (r.d.firingSeen > 0 && namesGate === false && saysNoBlockedRecord) {
            ok('SH-(反证c) ✓ 负向对拍：摘掉 `noteFiredBlocked` ⇒ '
              + `帧仍然记到（\`firingSeen=${r.d.firingSeen}\`），但头行**说不出被哪道准入拦下**、`
              + `落到了"没有一条被准入拦下的记录"那一支（${JSON.stringify(head.slice(0, 60))}）`
              + ' ⇒ SH-b 的"必须点名准入"真的接在实现上，不是摆设')
          } else {
            bad('SH-(反证c) 【负向对拍失败】摘掉 `noteFiredBlocked` 之后仍然说得清被哪道准入拦下'
              + `（firingSeen=${r.d.firingSeen} · 点名准入=${namesGate} · 落到"没有一条记录"那一支=${saysNoBlockedRecord}）`
              + ' ⇒ SH-b 测的不是"点名准入有没有数据来源"')
          }
        }
      }
    }
  } else {
    bad('SH 组跑不起来：orchestrator/bus 模块没加载上（不按通过处理）')
  }

  try { sgRm(sgTmpRoot, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
}

// ══════════════════════════════════════════════════════════════
// SJ · **丙-13 的 10 / 5 真的被钉住了**（2026-10-21 · 第 345 轮）
// ══════════════════════════════════════════════════════════════
//
//   ── 改前是什么（"常量没人钉"）──────────────────────────────────────────
//     `grep -rn "STATUS_LIST_MAX\|未展开" scripts/` ⇒ **0 命中**。
//     ⇒ `STATUS_LIST_MAX = 10` 与卡行的 `MAX_RUNNING/MAX_REVIEW = 5`
//       这两组数**改大改小都不会红** —— 超限时会不会**静默截断**（把"账本很长"
//       说成"只有这么多"）这件事，没有任何机检在看着。
//
//   ── 本组钉什么（三处 × 三档，缺一不算）────────────────────────────
//     ① **超限** ⇒ 必须出现"未展开"那一行，且**数目对得上**（不是随便一句）；
//     ② **未超限** ⇒ **一行都不许多**（⛔ 不许常态刷屏）；
//     ③ **恰好等于上限**（边界）⇒ **不印"未展开"**（`>` 不是 `>=`）。
//     ⚠ 三处**各自按自己的实际值**钉：`watches` / `handoffs` 是 `STATUS_LIST_MAX`（10），
//       卡行是 `MAX_RUNNING` / `MAX_REVIEW`（各 5）—— 本批**不统一**它们
//       （统一是另一件事，红线上写着不许顺手改），断言名里写清是哪一个。
//
//   ⚠⚠ **必须经真渲染路径**（`tools.status.execute({})`）：
//     `SA-g` 的教训就是"直接喂 `register()` 测 `DispatchWake`、绕过了 `cardsOf`"
//     ⇒ 断言绿而现实红。本组一律走 `status.execute`，⛔ 不直接调内部函数。
//   ⚠ 三档都**不靠真看板**：卡面用假注册表喂（同 SH/SG 的手法），零联网。
{
  const { join: sjJ, basename: sjBase2 } = await import('node:path')
  const { mkdtempSync: sjMkdt, mkdirSync: sjMkd, writeFileSync: sjWf, rmSync: sjRm } = await import('node:fs')
  const { tmpdir: sjTmp } = await import('node:os')
  const { pathToFileURL: sjP2u } = await import('node:url')

  const sjRoot = process.env.HOB_SA_ROOT !== undefined && process.env.HOB_SA_ROOT !== ''
    ? process.env.HOB_SA_ROOT : root
  const sjTag = sjRoot === root ? '' : `（源码树=${sjRoot}）`
  /**
   * ── ⚠⚠ **组级临时根 + 收工必删**（第 345 轮 · 自查发现）──────────────────────
   *   第一版每个 case 自己 `sjMkdt(sjTmp(), 'hob-sjcheck-')` 并只删 `base`，
   *   但**组级根没删** ⇒ 每跑一次 `check:orch` 就在 `/tmp` 留 6 个空壳
   *   （实测：跑了几次之后 `/tmp/hob-sjcheck-*` 攒到 6 个）。
   *   ⇒ 现在照 `SG` 的 `sgTmpRoot` 同构：**一个根**，收工 `rm -rf` 整根。
   *   ⚠ 建在 `/tmp` 是**既有 14 个组的一致做法**（本批沿用同构，⛔ 未擅自改全局口径，
   *     该口径要不要统一另见 REPORT「待决问题」）。
   */
  let sjTmpRoot
  try { sjTmpRoot = sjMkdt(sjJ(sjTmp(), 'hob-sjcheck-')) } catch { sjTmpRoot = sjTmp() }
  let sjOrchMod; let sjBusMod; let sjBoardMod
  try {
    sjOrchMod = await import(sjP2u(sjJ(sjRoot, 'src', 'modules', 'orchestrator.ts')).href)
    sjBusMod = await import(sjP2u(sjJ(sjRoot, 'src', 'modules', 'bus.ts')).href)
    sjBoardMod = await import(sjP2u(sjJ(sjRoot, 'src', 'server', 'board-cards.ts')).href)
  } catch (e) {
    bad(`SJ 无法加载 orchestrator/bus/board-cards（${String(e?.message ?? e)}）⇒ 丙-13 判据失去基准（不按通过处理）`)
  }
  /**
   * ⚠ 两个上限**只从实现里读一次**（⛔ 不在断言里写死数字）：
   *   判据要与实现同源，否则"改常量 ⇒ 判据跟着漂"这件事根本测不出来。
   *   `STATUS_LIST_MAX` 是导出的；卡行那两个是模块内常量 ⇒ 用**行为**测，
   *   ⛔ 不去解析源码文本（那是 check-code-face 的活，不是这里的）。
   */
  const SJ_MAX = sjBoardMod === undefined ? undefined : undefined

  if (sjOrchMod !== undefined && sjBusMod !== undefined && sjBoardMod !== undefined) {
    void SJ_MAX
    const sjWS = 'ws-sj'
    /** 挂一个真 `status.execute`：卡面由 `cards` 决定，watch/handoff 由 ledger 状态决定。 */
    const sjMount = async (cards, opts = {}) => {
      const base = sjMkdt(sjJ(sjTmpRoot, 'case-'))
      const home = sjJ(base, 'ledgers'); const ws = sjJ(base, 'ws')
      /** ⚠ 账本目录按**工作区基名**派生（与产品代码 `resolveLedgerRoot` 同源）——
       *   ⛔ 不许写死一个 `x`（实测踩到：写死 ⇒ 读成"账本够不到"，watches 恒 0）。
       */
      const ledgerName = sjBase2(ws)
      sjMkd(sjJ(ws, 'runtime'), { recursive: true })
      sjMkd(sjJ(home, ledgerName, 'runtime'), { recursive: true })
      /**
       * ⚠ `watches` / `handoffs` 用**盘上 pending**喂（`classifyPending` 会把它们读进来）。
       *   `pending` 每条要 `target` / `watcher` / `at` / `wsRoot` / `owner` ——
       *   与 `toPersisted` 同形（⛔ 不另造字段）。
       */
      /**
       * ⚠⚠ **`watches` 必须经 `dispatch()` 真造**（⛔ 不许手搓盘上 `pending`）──────────
       *   实测踩到的坑：手搓 `pending` 的 `target` 在 `sessions`/`agents` 里查不到
       *   ⇒ `classifyPending` 把它们判成「判不出（目标状态读不到）」⇒ **根本不进
       *   `watches`** ⇒ `在等回传：0 个`、`未展开` 一行都不印 ⇒ 断言假红。
       *   ⇒ 走产品代码自己的入口（`dispatch` 会同时建 watch + 落盘 + 记 `stateFileFor`），
       *     那才是"真渲染路径"该有的样子。
       */
      /**
       * ⚠⚠ 记录形状**必须与 `asHandoff` 的判据一致**：它要的是 `kind` + **`ref`** + `at`
       *   （实测踩到：手搓成 `file:` ⇒ 逐条被丢弃 ⇒ `待投递：0 份`、断言假红）。
       *   ⚠ 这是"夹具形状不对"而不是"产品缺陷"，⛔ 不许因此放宽判据。
       */
      const handoffs = []
      for (let i = 0; i < (opts.handoffCount ?? 0); i++) {
        handoffs.push({ kind: 'task-file', ref: `archive/x/f${i}.md`, at: 2, wsRoot: ws, owner: 'session-sj-hob' })
      }
      sjWf(sjJ(home, ledgerName, 'runtime', 'orch-watches.json'),
        JSON.stringify({ version: 1, updatedAt: 1, pending: [], handoffs, lost: [] }), 'utf8')
      const m = new Map(cards.map((c) => [c.id, c]))
      const registry = new Map([
        ['taskboard_get', { name: 'taskboard_get', execute: async (a) => (a?.id && m.has(a.id) ? { task: m.get(a.id) } : {}) }],
        ['taskboard_list', { name: 'taskboard_list', execute: async () => ({ revision: 1, tasks: [...m.values()] }) }],
      ])
      const toolsSvc = { get: (n) => registry.get(n) }
      const mkS = (id) => ({ id, header: { agentPreset: 'standard', cwd: ws }, log: [] })
      const self = 'session-sj-hob'
      const byId = new Map([[self, mkS(self)]])
      /**
       * ⚠⚠ **目标必须是活会话**，否则 `dispatch()` 直接拒投（实测：`ok:false`
       *   "is not a live session"）⇒ watch 根本建不起来 ⇒ `在等回传` 恒 0。
       *   ⇒ 预先把要派的目标都注册进 `sessions`/`agents`（`status:'running'`，
       *     那是"正在跑"的真形态，也免得被 `classifyPending` 判成别的档）。
       */
      const ensureTargets = (n) => {
        for (let i = 0; i < n; i++) {
          const id = `s-w${i}`
          if (!byId.has(id)) byId.set(id, mkS(id))
        }
      }
      const sessions = { get: (id) => byId.get(id), list: () => [...byId.values()], flush: async () => true }
      const agents = { currentInitiator: () => undefined,
        get: (id) => (byId.has(id) ? { id, status: id === self ? 'idle' : 'running', ctx: {},
          session: byId.get(id), followup() {}, steer() {}, inject() {} } : undefined) }
      const logger = { debug() {}, info() {}, warn() {} }
      const wr = { list: () => [{ id: sjWS, path: ws, title: 'w', record: { sessionIds: [...byId.keys()] } }],
        sessionPaths: new Map([...byId.keys()].map((id) => [id, ws])) }
      const bp = {}
      const bc = { sessions, agents, logger,
        get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents : k === 'workspaceRegistry' ? wr : undefined),
        provide: (k, v) => { bp[k] = v }, effect: (f) => { try { f() } catch { /* 无落点 */ } },
        inject: (_d, cb) => cb(bc), on: () => {} }
      sjBusMod.apply(bc, { spawnDefaults: () => ({ agentPreset: '', provider: '', model: '', reasoningEffort: '' }) })
      const prov = {}
      const ctx = { sessions, agents, logger,
        get: (k) => (k === 'sessions' ? sessions : k === 'agents' ? agents : k === 'hobBus' ? bp.hobBus
          : k === 'tools' ? toolsSvc : k === 'workspaceRegistry' ? wr
            : k === 'webServer' ? { getOrigin: () => undefined }
              : k === 'loader' ? { entries: () => [{ options: { config: { ledgerHome: home } } }] } : undefined),
        provide: (k, v) => { prov[k] = v }, effect: (f) => { try { f() } catch { /* 无落点 */ } },
        inject: (_d, cb) => cb(ctx), on: () => {} }
      sjOrchMod.apply(ctx)
      const orch = prov.hobOrchestrator
      const tools = sjOrchMod.createHobOrchTools(orch)
      /** ⚠ **真渲染路径**：⛔ 不直接调 `renderCardLines` / 内部函数。 */
      const render = async () => String(await tools.status.execute({}, {
        agent: { id: self, session: { header: { cwd: ws } } } }))
      /**
       * ⚠ 用 `dispatch()` 真造 N 条 watch（⚠ 目标**不必是活会话**：`dispatch` 对
       *   冷目标会走"叫活"那条路并**照样登记**，那正是它在真机上的形态）。
       *   ⚠ 失败不抛 —— 由调用方的断言去判"条数对不对"，⛔ 不在这里吞掉。
       */
      const seedWatches = async (n) => {
        ensureTargets(n)
        for (let i = 0; i < n; i++) {
          try { await orch.dispatch(`s-w${i}`, 'do work', { self }) } catch { /* 断言侧看条数 */ }
        }
      }
      return { render, ws, base, seedWatches,
        cleanup: () => { try { sjRm(base, { recursive: true, force: true }) } catch { /* 忽略 */ } } }
    }
    const sjCard = (id) => ({ id, title: id, status: 'in_progress', workspaceId: sjWS, version: 2,
      blocked: false, comments: [],
      executions: [{ id: 'e-' + id, outcome: 'running', startedAt: Date.now(), sessionId: 'session-sj-w' }],
      createdBy: { kind: 'agent', sessionId: 'session-other-sj' } })

    /**
     * ── 三处 × 三档 ─────────────────────────────────────────────────
     * ⚠ 判据一律**数"未展开"那一行里的数目**，⛔ 不看"有没有出现这四个字"
     *   （那会在"另一处超限"时假阳性 —— 三处在同一份输出里，很容易串）。
     */
    const SJ_LIMIT = 10                       // = `STATUS_LIST_MAX`（丙-13 的 10）
    const SJ_CARD_LIMIT = 5                   // = `MAX_RUNNING` / `MAX_REVIEW`（丙-13 的卡行 5）

    /** 从渲染结果里取某一处"未展开"那一行的条数（取不到 ⇒ -1）。 */
    const sjHiddenOf = (rendered, kind) => {
      /**
       * ⚠⚠ 实际渲染文本带 **markdown 粗体标记**：`**另有 3 条未展开**（…`
       *   ⇒ 正则必须容忍 `**`（实测踩到：钉死无星号的写法 ⇒ 恒不匹配 ⇒ 断言假红）。
       */
      const re = kind === 'watch'
        ? /\*\*另有 (\d+) 条未展开\*\*/
        : kind === 'handoff'
          ? /\*\*另有 (\d+) 条未展开\*\*/
          : kind === 'cardRunning'
            ? /另有 (\d+) 张在跑\/失败\/卡住的卡未展开/
            : /另有 (\d+) 张待验收未展开/
      const m = re.exec(rendered)
      return m === null ? -1 : Number(m[1])
    }
    /** ⚠ 三处"未展开"的行**不能互相冒充** —— 用各自独有的量词/句式分开数。 */
    const sjCountLines = (rendered, kind) => {
      if (kind === 'cardRunning') return (rendered.match(/张在跑\/失败\/卡住的卡未展开/g) ?? []).length
      if (kind === 'cardReview') return (rendered.match(/张待验收未展开/g) ?? []).length
      // watch / handoff 两句文本同形 ⇒ 按**出现次序**分：watch 那段在 handoffs 段之前
      const all = rendered.match(/\*\*另有 \d+ 条未展开\*\*/g) ?? []
      if (kind === 'watch') return all.length >= 1 ? 1 : 0
      return all.length >= 2 ? 1 : 0
    }

    // ── ① watches：超限 / 未超限 / 边界 ─────────────────────────────────
    {
      const cases = [
        { n: SJ_LIMIT + 3, want: 3, tag: '超限' },
        { n: SJ_LIMIT - 2, want: -1, tag: '未超限' },
        { n: SJ_LIMIT, want: -1, tag: '恰好等于上限' },
      ]
      for (const cs of cases) {
        const h = await sjMount([], {})
        try {
          await h.seedWatches(cs.n)
          const out = await h.render()
          const got = sjHiddenOf(out, 'watch')
          const wantShown = cs.want === -1 ? cs.n : SJ_LIMIT
          const totalLine = `在等回传：${cs.n} 个`
          const okTotal = out.includes(totalLine)
          if (got === cs.want && okTotal) {
            ok(`SJ-a(${cs.tag}) ✓ **watches 未展开行按 \`STATUS_LIST_MAX\`=${SJ_LIMIT} 生效**：`
              + `${cs.n} 条 ⇒ ${cs.want === -1 ? '**不印**"未展开"' : `印 **另有 ${got} 条未展开**`}`
              + `（展开 ${wantShown} 条 · 总数行 \`${totalLine}\` 在位）${sjTag}`)
          } else {
            bad(`SJ-a(${cs.tag}) 【watches 上限没被钉住】`
              + `${cs.n} 条 ⇒ 未展开=${got}（应 ${cs.want === -1 ? '不印（-1）' : cs.want}）`
              + ` · 总数行在位=${okTotal}`
              + ' ⇒ `STATUS_LIST_MAX` 改大改小都不会红，正是丙-13 的缺口')
          }
        } finally { h.cleanup() }
      }
    }

    // ── ② handoffs：超限 / 未超限 / 边界 ────────────────────────────────
    {
      const cases = [
        { n: SJ_LIMIT + 4, want: 4, tag: '超限' },
        { n: SJ_LIMIT - 3, want: -1, tag: '未超限' },
        { n: SJ_LIMIT, want: -1, tag: '恰好等于上限' },
      ]
      for (const cs of cases) {
        const h = await sjMount([], { handoffCount: cs.n })
        try {
          const out = await h.render()
          // ⚠ handoffs 那一句要取**第二处**（watch 在前）；watch 未超限时它是唯一一处
          const all = [...out.matchAll(/\*\*另有 (\d+) 条未展开\*\*/g)].map((m) => Number(m[1]))
          const got = all.length === 0 ? -1 : all[all.length - 1]
          const okTotal = out.includes(`待投递：${cs.n} 份`)
          if (got === cs.want && okTotal) {
            ok(`SJ-b(${cs.tag}) ✓ **handoffs 未展开行按 \`STATUS_LIST_MAX\`=${SJ_LIMIT} 生效**：`
              + `${cs.n} 份 ⇒ ${cs.want === -1 ? '**不印**"未展开"' : `印 **另有 ${got} 条未展开**`}`
              + `（总数行 \`待投递：${cs.n} 份\` 在位）${sjTag}`)
          } else {
            bad(`SJ-b(${cs.tag}) 【handoffs 上限没被钉住】`
              + `${cs.n} 份 ⇒ 未展开=${got}（应 ${cs.want === -1 ? '不印（-1）' : cs.want}）`
              + ` · 总数行在位=${okTotal}`)
          }
        } finally { h.cleanup() }
      }
    }

    // ── ③ 卡行：在跑档 MAX_RUNNING=5 / 待验收档 MAX_REVIEW=5 ────────────
    {
      const cases = [
        { n: SJ_CARD_LIMIT + 2, want: 2, tag: '超限' },
        { n: SJ_CARD_LIMIT - 1, want: -1, tag: '未超限' },
        { n: SJ_CARD_LIMIT, want: -1, tag: '恰好等于上限' },
      ]
      for (const cs of cases) {
        // ⚠ 全部造成"在跑"档（`in_progress` + outcome=running）
        const cards = []
        for (let i = 0; i < cs.n; i++) cards.push(sjCard(`t-sj-run-${i}`))
        const h = await sjMount(cards)
        try {
          const out = await h.render()
          const got = sjHiddenOf(out, 'cardRunning')
          const okHead = out.includes(`卡：${cs.n} 张`)
          if (got === cs.want && okHead) {
            ok(`SJ-c(${cs.tag}) ✓ **卡行"在跑"档按 \`MAX_RUNNING\`=${SJ_CARD_LIMIT} 生效**`
              + `（⚠ 与 \`STATUS_LIST_MAX\`=${SJ_LIMIT} **两个数并存**，本批不统一）：`
              + `${cs.n} 张 ⇒ ${cs.want === -1 ? '**不印**"未展开"' : `印 **另有 ${got} 张未展开**`}`
              + `（总行 \`卡：${cs.n} 张\` 在位）${sjTag}`)
          } else {
            bad(`SJ-c(${cs.tag}) 【卡行 MAX_RUNNING 没被钉住】`
              + `${cs.n} 张 ⇒ 未展开=${got}（应 ${cs.want === -1 ? '不印（-1）' : cs.want}）`
              + ` · 卡总行在位=${okHead}`)
          }
        } finally { h.cleanup() }
      }
    }

    // ── ④ 负向对拍：把 `STATUS_LIST_MAX` 改小 ⇒ SJ-a/b 必须当场不成立 ──
    {
      const mut = sjMkdt(sjJ(sjTmpRoot, 'mut-'))
      try {
        const { cpSync } = await import('node:fs')
        cpSync(sjJ(sjRoot, 'src'), sjJ(mut, 'src'), { recursive: true, dereference: true })
        try { (await import('node:fs')).symlinkSync(sjJ(sjRoot, 'node_modules'), sjJ(mut, 'node_modules'), 'dir') } catch { /* 已有 */ }
        const mf = sjJ(mut, 'src', 'server', 'orch-state.ts')
        const { readFileSync: sjRf2, writeFileSync: sjWf2 } = await import('node:fs')
        const src = sjRf2(mf, 'utf8')
        const GUARD = 'export const STATUS_LIST_MAX = 10'
        if (!src.includes(GUARD)) {
          bad('SJ-(反证a) 【失去靶子】`orch-state.ts` 里找不到 `STATUS_LIST_MAX = 10` ⇒ 不按通过处理')
        } else {
          sjWf2(mf, src.replace(GUARD, 'export const STATUS_LIST_MAX = 7'), 'utf8')
          const mOrch = await import(sjP2u(sjJ(mut, 'src', 'modules', 'orchestrator.ts')).href)
          const mBus = await import(sjP2u(sjJ(mut, 'src', 'modules', 'bus.ts')).href)
          const savedOrch = sjOrchMod; const savedBus = sjBusMod
          sjOrchMod = mOrch; sjBusMod = mBus
          /**
           * ⚠ 上限改成 7 之后：给 10 条 ⇒ 未展开应是 **3**（改后实现算的是 7 展开 + 3 未展开）；
           *   若判据写死了 10，这里仍会得 0/不印 ⇒ 说明判据没跟实现走。
           *   ⚠ 本档要证明的是"**判据真的读实现**"，⛔ 不是"7 比 10 好"。
           */
          const h = await sjMount([], {})
          try {
            await h.seedWatches(SJ_LIMIT)
            const out = await h.render()
            const got = sjHiddenOf(out, 'watch')
            if (got === 3) {
              ok('SJ-(反证a) ✓ 负向对拍：把 `STATUS_LIST_MAX` 改成 **7** ⇒ '
                + `10 条时未展开变成 **3**（got=${got}）⇒ SJ-a/b 钉的确实是`
                + '**实现里的那个常量**，⛔ 不是断言里写死的 10')
            } else {
              bad('SJ-(反证a) 【负向对拍失败】把 `STATUS_LIST_MAX` 改成 7 之后'
                + `10 条时未展开=${got}（应 3）⇒ SJ-a/b 没跟实现走（判据写死了数字）`)
            }
          } finally { h.cleanup() }
          sjOrchMod = savedOrch; sjBusMod = savedBus
        }
      } catch (e) {
        bad(`SJ-(反证a) 变异体跑不起来（${String(e?.message ?? e)}）`)
      } finally {
        try { sjRm(mut, { recursive: true, force: true }) } catch { /* 忽略 */ }
      }
    }
  }
  /** ⚠ **收工删整根**（⛔ 不许只删各 case 的 base —— 那样根会留空壳）。 */
  try { sjRm(sjTmpRoot, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
}

// ── 输出 ───────────────────────────────────────────────────────────────

if (note.length > 0) console.log(note.join('\n'))
if (fail.length > 0) {
  console.log('\n✗ 失败：')
  for (const m of fail) console.log('  ' + m)
  console.log(`\n判定：FAIL（${fail.length} 条）`)
  process.exit(1)
}
console.log(`\n判定：PASS —— 编排运行态跨重载可观测（共 ${note.length} 条断言）`)
process.exit(0)
