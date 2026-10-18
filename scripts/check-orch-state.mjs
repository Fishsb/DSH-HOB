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
  if (/lostPending\s*:\s*number/.test(orchCode) && /lostPending\s*:\s*lostCount/.test(orchCode)) {
    ok('C6 OrchStatus.lostPending 存在且由 lostCount 供给')
  } else {
    bad('C6 OrchStatus 缺 lostPending 或未接到 lostCount')
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
    const iterReattach = /for\s*\(\s*const\s+\w+\s+of\s+r\.reattach\s*\)[\s\S]{0,400}?watches\.set\s*\(/.test(scope)
    // ⚠ 判据写宽一点：`r.lost` **以任何形式**出现在重挂循环头里都算违规
    //   （`for (const w of r.lost)` / `for (const w of [...r.reattach, ...r.lost])` 都抓）。
    //   ⚠ 实测踩过：只钉 `for (const w of r.lost)` 时，把两摞展开成一个数组的写法**漏网**。
    const iterLost = /for\s*\(\s*const\s+\w+\s+of\s+[^)]{0,200}?r\.lost[^)]{0,200}?\)[\s\S]{0,400}?watches\.set\s*\(/.test(scope)
    if (!hasSet) {
      bad('D2-a 【必须重挂】**接手块里没有 `watches.set(`** —— 仍在跑的目标会被一律判死'
        + '（这正是 2026-10-18 要修的缺陷；⛔ 不是"更安全"，是回到了旧病）')
    } else if (!iterReattach) {
      bad('D2-a 重挂没接在 `r.reattach` 上 —— 必须**只**重挂"仍在跑"那一摞'
        + '（`markLost` 的 `reattach` 是唯一判过状态的那一摞）')
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
  if (/\[\.\.\.watches\.values\(\)\]\.map\(\(x\)\s*=>\s*toPersisted/.test(orchCode)) {
    ok('D3 pending 由内存中活着的 watch 生成（不是读回文件）')
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
  if (/flushWatches[\s\S]{0,900}?refreshLostCount\(\)/.test(orchCode)) {
    ok('D5 flushWatches 后重算累计（成功回传后不再虚报丢失）')
  } else {
    bad('D5 flushWatches 未重算累计 —— 回传成功后仍会虚报丢失')
  }
}

// ── E. 闸门语义未动 ────────────────────────────────────────────────────
{
  // 回传前的闸门：`if (stopped) { relaysBlocked++ ... }`
  if (/if\s*\(stopped\)\s*\{\s*relaysBlocked\+\+/.test(orchCode)) {
    ok('E1 回传前闸门仍在（stopped ⇒ relaysBlocked++ 且不唤醒）')
  } else {
    bad('E1 回传前闸门被改动（任务书 §2.3 禁止）')
  }

  // 派发前的闸门
  if (/if\s*\(stopped\)\s*\{\s*return\s*\{\s*ok:\s*false,\s*reason:\s*'orchestration is stopped/.test(orchCode)) {
    ok('E2 派发前闸门仍在（stopped ⇒ hob_dispatch 拒绝）')
  } else {
    bad('E2 派发前闸门被改动（任务书 §2.3 禁止）')
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
      const d = await host.orch.dispatch(opts.target, 'do the work', { self: 'session-j-self' })
      if (d?.ok !== true) return { err: `dispatch 未成功：${JSON.stringify(d)}` }
      const s = host.orch.status({ wsRoot: opts.cwd })
      const w = Array.isArray(s.watches) ? s.watches[0] : undefined
      const tools = jOrchMod.createHobOrchTools(host.orch)
      const rendered = String(await tools.status.execute({}, {
        agent: { session: { header: { cwd: opts.cwd } } },
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
          const s = orch?.status?.({ wsRoot: wsDir })
          // ⚠ 渲染是 **async** 的（`execute` 返回 Promise）：不 await 会拿到
          //   `[object Promise]` ⇒ 渲染断言**恒假**（实测踩过：idle 行在位=false）。
          const rendered = orch === undefined ? '' : String(
            await kOrchMod.createHobOrchTools(orch).status.execute({}, {
              agent: { session: { header: { cwd: wsDir } } },
            }),
          )
          return { orch, status: s, rendered, wsDir, runtimeDir, now }
        }

        // ── K-a ⭐ **正向：仍在跑 ⇒ 必须重挂** ────────────────────────────
        //   ⚠ 这一条是**负向对拍的靶子**：把重挂那几行去掉 ⇒ 它必须变成 FAIL。
        {
          const h = await mountWith({
            home: kRoot, wsName: 'ws-a',
            pending: [{ target: 'sess-running', watcher: 'hob', at: 1792250000000, sawRunning: true, task: 'K-a' }],
            statuses: { 'sess-running': 'running' },
          })
          const ws = Array.isArray(h.status?.watches) ? h.status.watches : []
          const hit = ws.find((w) => w.target === 'sess-running')
          const lostIds = (Array.isArray(h.status?.lostByClass) ? h.status.lostByClass.running : 0)
          if (hit === undefined) {
            bad('K-a 【必须重挂】目标**仍在跑**却没有被重新挂上 —— 这一档不该判死'
              + `（实测 watches=${JSON.stringify(ws.map((w) => w.target))}，`
              + `lostByClass=${JSON.stringify(h.status?.lostByClass)}）`)
          } else if (h.status?.lostPending !== 0) {
            bad(`K-a 仍在跑的那条被**同时**记进了 lost（lostPending=${h.status?.lostPending}）`
              + ' —— 重挂与判死⛔ 不许同时发生')
          } else {
            ok('K-a ✓ 正向：目标**仍在跑** ⇒ **重新挂上**（watches 含该条、且 ⛔ 未进 lost）')
            void lostIds
          }
        }

        // ── K-b ⭐ **反向：已空闲 ⇒ 必须不重挂** ──────────────────────────
        //   ⚠ 这一条钉的是"重挂只对仍在跑的目标做"这个**前提** —— 缺它，K-a 就成了放宽。
        {
          const h = await mountWith({
            home: kRoot, wsName: 'ws-b',
            pending: [{ target: 'sess-idle', watcher: 'hob', at: 1792250100000, sawRunning: true, task: 'K-b' }],
            statuses: { 'sess-idle': 'idle' },
          })
          const ws = Array.isArray(h.status?.watches) ? h.status.watches : []
          const reattached = ws.some((w) => w.target === 'sess-idle')
          const idleCount = h.status?.lostByClass?.idle
          if (reattached) {
            bad('K-b 【必须不重挂】目标**已空闲**却被重新挂上 —— 这会留一个永不结算的 watch'
              + '（命中"同目标至多一条未结算"闸门 ⇒ 该会话永久不能再派）')
          } else if (idleCount !== 1) {
            bad(`K-b 已空闲的那条未按档位记成 lost：lostByClass.idle=${JSON.stringify(idleCount)}`
              + `（期望 1），实测 ${JSON.stringify(h.status?.lostByClass)}`)
          } else {
            ok('K-b ✓ 反向：目标**已空闲** ⇒ **不重挂**（watches 为空）+ 判 lost **且档位=idle**')
          }
        }

        // ── K-b2 **两档在状态行里必须可分辨**（用户原话：不许混成一个计数）──
        {
          const h = await mountWith({
            home: kRoot, wsName: 'ws-b2',
            pending: [
              { target: 'sess-run-2', watcher: 'hob', at: 1792250000000, sawRunning: true },
              { target: 'sess-idle-2', watcher: 'hob', at: 1792250100000, sawRunning: true },
              { target: 'sess-gone-2', watcher: 'hob', at: 1792250200000, sawRunning: true },
            ],
            statuses: { 'sess-run-2': 'running', 'sess-idle-2': 'idle' },
          })
          const c = h.status?.lostByClass ?? {}
          const okShape = c.running === 0 && c.idle === 1 && c.unknown === 1
          // 状态行原文里必须**分开出现**两档的说明（且都不是那个总数行的复述）
          const txt = String(h.rendered)
          const hasIdleLine = txt.includes('已跑完、回传没回来')
          const hasUnknownLine = txt.includes('判不出（目标状态读不到）')
          if (!okShape) {
            bad(`K-b2 档位计数不对：实测 ${JSON.stringify(c)}，期望 {running:0, idle:1, unknown:1}`
              + '（仍在跑的重挂成功 ⇒ 不进 lost；已空闲 ⇒ idle；会话没了 ⇒ unknown）')
          } else if (!hasIdleLine || !hasUnknownLine) {
            bad('K-b2 状态行**没有分开报**两档（用户要求"两类不许混成一个计数"）'
              + `：idle 行在位=${hasIdleLine} · unknown 行在位=${hasUnknownLine}`)
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
          const d = await orch.dispatch(target, 'do it', { self: 'session-k-self' })
          const tools = kOrchMod.createHobOrchTools(orch)
          const rendered = String(await tools.status.execute({}, {
            agent: { session: { header: { cwd: wsDir } } },
          }))
          const atAfter = Date.now()
          const w = (orch.status({ wsRoot: wsDir }).watches ?? []).find((x) => x.target === target)
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
      } finally {
        try { rmSync(lRoot, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
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
