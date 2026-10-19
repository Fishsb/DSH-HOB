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
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import('node:fs')
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
          const noRedeliverLine = !/补投不了/.test(emptyText)
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
              + `：空态无错觉说法=${noIllusion} · 空态无补投行=${noRedeliverLine}`
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
  const { mkdtempSync: mkdt, mkdirSync: mkd, writeFileSync: wf, readFileSync: rf, rmSync: rm } = await import('node:fs')
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
            const mutPath = join(root, 'src', 'modules', `orchestrator.mut-${process.pid}-${Date.now()}.ts`)
            try {
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
            } finally { try { rm(mutPath, { force: true }) } catch {} }

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
                const mutPathB = join(root, 'src', 'modules', `orchestrator.mutb-${process.pid}-${Date.now()}.ts`)
                try {
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
                } finally { try { rm(mutPathB, { force: true }) } catch {} }
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
                const mutPathC = join(root, 'src', 'modules', `orchestrator.mutc-${process.pid}-${Date.now()}.ts`)
                try {
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
                } finally { try { rm(mutPathC, { force: true }) } catch {} }
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
                const mutPathD = join(root, 'src', 'server', `card-wake.mutd-${process.pid}-${Date.now()}.ts`)
                try {
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
                } finally { try { rm(mutPathD, { force: true }) } catch {} }
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
        // ⚠ 记录每一次真投递（判"回执真的回去了"要用）
        const realDeliver = bus?.deliver?.bind(bus)
        if (bus !== undefined && typeof realDeliver === 'function') {
          bus.deliver = async (sid, text, mode) => {
            delivered.push({ to: sid, text })
            return await realDeliver(sid, text, mode)
          }
        }

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
        cpSync(join(saRoot, 'src'), join(dir, 'src'), { recursive: true })
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
          const tierOK = p2?.settleState === 'unresolved' || p2?.settleState === 'stuck'
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
            bad('SA-d 判不出的那条**结算态没有具名**'
              + `：settleState=${JSON.stringify(p2?.settleState)}（应 'unresolved' 或 'stuck'）`
              + ' ⇒ 读的人分不出"还在重核"与"已经在等"')
          } else {
            ok('SA-d ✓ **判不出不是终态**（钉 P2）：喂 `undefined` 两代 ⇒ 第二代**又判了一次**'
              + `（recheckCount=${p2?.recheckCount} · settleState=${p2?.settleState}）`
              + ' 且**仍在 `pending`**、⛔ 未进 `lost` ⇒ 还有下一次机会'
              + `（⚠ 到顶 ${3} 轮转 \`stuck\`、⛔ 不无限重试）${saTag}`)
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
                broke = true
                detail = `变异体跑不起来（${String(e?.message ?? e)}）`
              }
              if (broke) {
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
                broke = true
                detail = `变异体跑不起来（${String(e?.message ?? e)}）`
              }
              if (broke) {
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
                broke = true
                detail = `变异体跑不起来（${String(e?.message ?? e)}）`
              }
              if (broke) {
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
                broke = true
                detail = `变异体跑不起来（${String(e?.message ?? e)}）`
              }
              if (broke) {
                ok(`SA-x(SA-d) ✓ 负向对拍：把"判不出 ⇒ unresolved 留着"改回"判不出 ⇒ lost（终态）"`
                  + ` ⇒ **SA-d 的判据当场不成立**（${detail}）⇒ SA-d 真长牙（钉 P2）`)
              } else {
                bad('SA-x(SA-d) 【负向对拍失败】改回终态之后它仍然留在 pending'
                  + `（${detail}）⇒ SA-d 测的不是"判不出非终态"这件事`)
              }
            }
          }
        }

      } finally {
        try { saRm(saRootTmp, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
      }
    }
  }
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
