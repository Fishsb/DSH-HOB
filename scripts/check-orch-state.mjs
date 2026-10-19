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
          /** 造一帧「执行落定」的 SSE `change` 负载（形状按看板的 `broadcast()`）。 */
          const frameOf = (over) => JSON.stringify({
            revision: 1, kind: 'execution-recorded',
            tasks: [{ id: 't-card-1', title: '演示卡', status: 'in_review', workspaceId: WS,
              version: 2, lastExecutionOutcome: 'succeeded', ...over }],
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

          /** 造一个叫醒面（假投递 —— ⛔ 不碰真会话）。 */
          const makeDW = (selfId) => {
            const sent = []
            const w = new wakeMod.DispatchWake({
              selfSessionId: selfId,
              deliver: (sid, text) => { sent.push({ sid, text }); return Promise.resolve({ ok: true }) },
              now: () => 1792300800000,
            })
            return { w, sent }
          }

          // ── O-a ⭐ 边界①：**只有登记过的会话**才可能叫（未登记 ⇒ 一律不理）──────────
          {
            const { w, sent } = makeDW('session-hob')
            // 先跑一轮"未登记"的完整序列 ⇒ 一声都不该叫
            await w.observe('session-stranger', 'running')
            const strangerIdle = await w.observe('session-stranger', 'idle')
            const strangerSilent = sent.length === 0 && strangerIdle === undefined
            // 再登记一个 ⇒ running→idle 必须叫
            w.register({ sessionId: 'session-mine', via: 'taskboard-card', cardId: 't-card-1' })
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
            const { w, sent } = makeDW('session-hob')
            w.register({ sessionId: 'session-mine', via: 'taskboard-card', cardId: 't-card-1' })
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
            const { w, sent } = makeDW('session-hob')
            w.register({ sessionId: 'session-mine', via: 'taskboard-card', cardId: 't-card-1' })
            await w.observe('session-mine', 'running')      // 先让它真在跑
            const blank = await w.observe('session-mine', undefined)
            const empty = await w.observe('session-mine', '')
            const st = w.snapshot()
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
            const { w, sent } = makeDW('session-hob')
            // 不登记任何会话，只走 SSE 旁证通道喂一帧"卡进 in_review"
            const cw = new wakeMod.CardWake({
              origin: 'http://127.0.0.1:0',
              workspaceIdOf: () => 'ws-abc',
              deliver: () => Promise.resolve({ ok: true }),
              now: () => 1792300800000,
            })
            cw.subscribe('session-hob', 'ws-abc')
            const sseN = await cw.handleFrame('change', JSON.stringify({
              revision: 1, kind: 'execution-recorded',
              tasks: [{ id: 't-card-1', title: '演示卡', status: 'in_review', workspaceId: 'ws-abc',
                version: 2, lastExecutionOutcome: 'succeeded' }],
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
                selfSessionId: 'session-hob',
                deliver: (sid, text) => { sent.push({ sid, text }); return Promise.resolve({ ok: true }) },
                now: () => 1792300800000,
              })
              w.register({ sessionId: 'session-mine', via: 'taskboard-card', cardId: 't-card-1' })
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
              selfSessionId: 'session-hob',
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
                  if (r.kind === 'found') dw.register({ sessionId: r.sessionId, via: 'taskboard-card', cardId: r.cardId })
                })
              },
            })
            await cw.handleFrame('change', firingFrame)
            await new Promise((r) => setTimeout(r, 20))   // 让 onFiring 的异步登记落地
            const registeredCount = dw.snapshot().registered
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
              selfSessionId: 'session-hob',
              deliver: (sid, text) => { sent.push({ sid, text }); return Promise.resolve({ ok: true }) },
              now: () => 1792300800000,
            })
            const looked = await wakeMod.lookupCardSession('t-card-1', boardWith(cardOf({})).get)
            dw.register({ sessionId: looked.sessionId, via: 'taskboard-card', cardId: 't-card-1' })
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
              selfSessionId: 'session-hob',
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
                selfSessionId: 'session-hob',
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

      // ── R. **叫醒面 = 显示面**：旁证通道（`CardWake`）**按项目**投递（2026-10-19）────
      //
      // ⚠ **它守的是哪条缺陷**（用户实测两次，不是推断）：
      //   本会话被**别的项目**的卡跑完叫醒过 —— 通知原文形态
      //   `[看板卡跑完] t-mvdy37bb-paev0o「…」…`（卡属 `e9742e44…` video-transcribe）、
      //   `t-mvers6x3-nkonel`（`c4bb5014…`）、`t-mveu5dzx-3zx7t2`（`cca0a688…` Mana）。
      //   根因：`CardWake` 在进程里**被所有会话共用**，而"本工作区"原先只存在于
      //   `opts.workspaceIdOf()`（**进程级单值**）⇒ 后订阅者覆盖 ⇒ 先前那个会话收到别人的卡。
      //   ⇒ 修法：归**跟着每个订阅者走**（`WakeTarget.workspaceId`），投递前按归属筛。
      //
      // ⚠ ⚠ **判定要成对**（E-112：只测一边等于没测）：
      //   · **R-a 不匹配** ⇒ 投 0（别的项目的卡 **一声都不叫**）；
      //   · **R-b 匹配**   ⇒ 投 1（自己项目的卡 **仍然叫一次**，⛔ 不许把通路关掉）；
      //   · **R-c 未报项目** ⇒ 投 0（⛔ 不许退化成"全投"）；
      //   · **R-d 筛空** ⇒ `noSubscriberCount + 1` **且**有可读话（⛔ 不许静默）。
      //   · **R-e 三档不合并**：`deliverFn` 缺 / 投递抛错 / 一个订阅者都没有 —— 三句可读话各自还在。
      //   · **R-f 负向对拍**：把 `filter` 那步摘掉（改回全量遍历）⇒ **R-a 当场 FAIL 且有可读断言行**；
      //     还原 ⇒ PASS。
      //
      // ⚠ 造样本**全部在内存里**（直接把 target 塞进 `targets`、直接喂 `CardDoneEvent`）：
      //   ⛔ 不碰真看板、⛔ 不动别人项目的卡、⛔ 不起第二个宿主。
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
              workspaceIdOf: () => over.globalWs,          // ⚠ 进程级单值（R-c 要证明它不再决定投给谁）
              deliver: over.deliver ?? ((sid, text) => { sent.push({ sid, text }); return Promise.resolve({ ok: true }) }),
              now: () => 1792300800000,
            })
            for (const [sid, ws] of subs) cw.subscribe(sid, ws)
            return { cw, sent }
          }

          /** 造一帧「执行落定」的 SSE 负载；`ws` = 这张卡属于哪个项目。 */
          const frameOn = (ws, over = {}) => JSON.stringify({
            revision: 1, kind: 'execution-recorded',
            tasks: [{ id: 't-card-x', title: '演示卡', status: 'in_review', workspaceId: ws,
              version: 2, lastExecutionOutcome: 'succeeded', ...over }],
          })

          // ── R-a ⭐ **(a) 第一条腿：别的项目的卡跑完 ⇒ 一声都不叫** ─────────────
          //   ⚠ 订阅者报的是**自己的**项目（WS_MINE），帧里的卡属于**别人的**项目（WS_OTHER）。
          //   ⚠ 同时把 `workspaceIdOf()` 设成 WS_OTHER（= 全局单值正好"对得上这张卡"）——
          //     这一手是用来证明**投给谁不再由全局单值决定**（改前正是它导致越界）。
          {
            const { cw, sent } = makeCW([['session-hob', WS_MINE]], { globalWs: WS_OTHER })
            // ⚠ 认卡阶段仍受 `workspaceIdOf()` 约束（B7 §一 只收了投递侧）⇒ 为让事件真的被认出来，
            //   本条的全局 ws 设成**帧的项目**；"该不该投给这个订阅者"由 R-a 自己判。
            const n = await cw.handleFrame('change', frameOn(WS_OTHER))
            const st = cw.snapshot()
            if (sent.length === 0) {
              ok('R-a ✓ (a) 旁证通道：**别的项目**的卡跑完 ⇒ **一声都不叫**'
                + `（订阅者属 ${WS_MINE} · 卡属 ${WS_OTHER} · 投递=${sent.length} · 返回值=${n}`
                + ` · 落"没有订阅者属于这个项目"=${st.noSubscriberCount}）`)
            } else {
              bad('R-a 【叫醒面必须与显示面同一个】旁证通道把**别的项目**的卡叫给了本会话'
                + `：投递=${sent.length}（应为 0）· 收到的会话=${sent.map((x) => x.sid).join(',')}`
                + ' ⇒ 这正是「叫醒说有卡跑完、状态行里看不到它」的越界')
            }
          }

          // ── R-b ⭐ **(b) 第二条腿：本工作区的卡跑完 ⇒ 仍然叫一次** ─────────────
          //   ⚠ 与 R-a 成对：只做 (a) 的最省事做法是"把整条通路关掉"—— 这条防的就是那个。
          {
            const { cw, sent } = makeCW([['session-hob', WS_MINE]], { globalWs: WS_MINE })
            const n = await cw.handleFrame('change', frameOn(WS_MINE))
            const hit = sent.length === 1 && sent[0].sid === 'session-hob'
            if (n === 1 && hit && sent[0].text.includes('t-card-x')) {
              ok('R-b ✓ (b) 旁证通道：**本项目的卡**跑完 ⇒ **仍然叫一次**'
                + `（投递=${sent.length} · 收件=${sent[0].sid} · 话里带卡号=是）`)
            } else {
              bad('R-b 【本工作区的卡必须仍然叫】判据 (b) 不成立'
                + `：返回值=${n}（应 1）· 投递=${sent.length}（应 1）· 收件=${sent.map((x) => x.sid).join(',') || '(无)'}`
                + ' ⇒ 为了做到 (a) 把通路关掉了')
            }
          }

          // ── R-b2 ⭐ **多订阅者同桌：各收各的**（越界的真实现场就是"不止一个订阅者"）──
          //   ⚠ 这一条是本组最有分辨力的一条：改前两个订阅者会**都**收到同一张卡。
          {
            const { cw, sent } = makeCW([
              ['session-hob', WS_MINE],
              ['session-other-hob', WS_OTHER],
            ], { globalWs: WS_MINE })
            // 先推本项目的一张卡（全局 ws 与帧一致 ⇒ 认得出）
            await cw.handleFrame('change', frameOn(WS_MINE))
            const mineGot = sent.filter((x) => x.sid === 'session-hob').length
            const otherGot = sent.filter((x) => x.sid === 'session-other-hob').length
            sent.length = 0
            // 再把全局 ws 换成"别人的项目"，推别人的卡
            //   ⚠ 认卡用的是现读的 `workspaceIdOf()` ⇒ 这里要让它现读成 WS_OTHER
            const cw2 = new wakeMod.CardWake({
              origin: 'http://127.0.0.1:0',
              workspaceIdOf: () => WS_OTHER,
              deliver: (sid, text) => { sent.push({ sid, text }); return Promise.resolve({ ok: true }) },
              now: () => 1792300800000,
            })
            cw2.subscribe('session-hob', WS_MINE)
            cw2.subscribe('session-other-hob', WS_OTHER)
            await cw2.handleFrame('change', frameOn(WS_OTHER))
            const mineGot2 = sent.filter((x) => x.sid === 'session-hob').length
            const otherGot2 = sent.filter((x) => x.sid === 'session-other-hob').length
            if (mineGot === 1 && otherGot === 0 && mineGot2 === 0 && otherGot2 === 1) {
              ok('R-b2 ✓ 两个会话同桌：**各收各的项目的卡**'
                + `（本项目卡 ⇒ 我 ${mineGot} / 他 ${otherGot}；他的项目卡 ⇒ 我 ${mineGot2} / 他 ${otherGot2}）`
                + ' ⇒ 改前这两个数会是 1/1 与 1/1（全量广播）')
            } else {
              bad('R-b2 【多订阅者必须各收各的】出现串台'
                + `：本项目卡 ⇒ 我 ${mineGot}（应 1）/ 他 ${otherGot}（应 0）`
                + ` · 他的项目卡 ⇒ 我 ${mineGot2}（应 0）/ 他 ${otherGot2}（应 1）`)
            }
          }

          // ── R-c ⭐ 订阅者**没报项目** ⇒ **按旧语义投**，但必须留下独立可读话 ──────────
          //
          //   ⚠ 2026-10-19 · `TASK-B8` **甲路改判**（⚠ 这是"改判"，不是"放宽"）：
          //     原判据钉的是"没报项目 ⇒ **投 0**"（= 乙路）。派单方复核了 `cf72d8b^` 的实际行为
          //     （`git show cf72d8b^:src/server/card-wake.ts` 的 `:365`
          //      `for (const t of this.targets.values())` = **全量广播**，项目过滤只在 `:347`
          //      `cardDoneEventsOf(parsed, wsId)` 的**认卡**阶段用全局 `wsId`）⇒ 旧语义**是投的**。
          //     ⚠ 走甲路后"投 0"在语义上不成立 ⇒ 判据随之改判。
          //   ⚠ ⚠ **分辨力没有削，反而换了个更硬的靶子**：
          //     新的那条钉的是「**不许静默**」——"投了"必须可数（`legacyTargetCount`）且可读，
          //     并且话里必须写清它**不是**"没有卡跑完"、**不是**"已确认投给本项目的人"
          //     （因为退回全局单值 = **可能越界**，这个缺陷要一直看得见）。
          //   ⇒ 成对判四件（缺一即红）：
          //     ① 投了（`sent.length === 1`；⛔ 不是 0 —— 0 就等于退回乙路静默丢）；
          //     ② 单独计数（`legacyTargetCount === 1`，⛔ 不许并进 `noSubscriberCount`）；
          //     ③ 有话，且点名卡 id 与该帧的项目 id；
          //     ④ 话里明确写"可能越界"+"既不是没有卡跑完/也不是已确认投给本项目的人"。
          {
            const { cw, sent } = makeCW([['session-legacy']], { globalWs: WS_MINE })
            await cw.handleFrame('change', frameOn(WS_MINE))
            const st = cw.snapshot()
            const delivered = sent.length === 1
            const counted = st.legacyTargetCount === 1
            const notMerged = st.noSubscriberCount === 0
            const note = typeof st.note === 'string' ? st.note : ''
            const namesIt = note.includes('t-card-x') && note.includes(WS_MINE)
            const saysRisk = note.includes('可能越界')
            const saysNotNoCard = note.includes('不是"没有卡跑完"')
            const saysNotConfirmed = note.includes('已确认投给了本项目')
            if (delivered && counted && notMerged && namesIt && saysRisk && saysNotNoCard && saysNotConfirmed) {
              ok('R-c ✓ 订阅者**没有报项目** ⇒ **按旧语义投**（`legacyTargetCount + 1`），'
                + '**且留下独立可读话**：点名卡与项目、明写"可能越界"、'
                + '并说清它不是"没有卡跑完"也不是"已确认投给本项目的人"'
                + ' —— ⚠ 退回旧语义 = 恢复"可能越界"，但 ⛔ 不是静默')
            } else if (!delivered) {
              bad('R-c 【没报项目必须按旧语义投】这一档被静默丢弃了（投 0）'
                + `：投递=${sent.length}（应为 1）· note=${JSON.stringify(note.slice(0, 120))}`
                + '\n      ⇒ ⚠ 静默丢 = 今天的原缺陷；要"不投"就必须先改派单口径')
            } else {
              bad('R-c 【没报项目必须留下独立可读话】投是投了，但这一档**不可观测**'
                + `：legacyTargetCount=${st.legacyTargetCount}（应 1）`
                + ` · 与"没有订阅者"分开=${notMerged}（noSubscriberCount 应 0，实测 ${st.noSubscriberCount}）`
                + ` · 点名卡与项目=${namesIt} · 写了"可能越界"=${saysRisk}`
                + ` · 写了不是没卡跑完=${saysNotNoCard} · 写了不是"已确认投给本项目"=${saysNotConfirmed}`
                + ` · note=${JSON.stringify(note.slice(0, 160))}`
                + '\n      ⇒ ⚠ 这正是本项目最忌讳的形态："可能越界、而且没人报"')
            }
          }

          // ── R-d ⭐ **筛空** ⇒ `noSubscriberCount + 1` + 可读话（⛔ 不许静默）──────
          {
            const { cw } = makeCW([['session-hob', WS_MINE]], { globalWs: WS_OTHER })
            await cw.handleFrame('change', frameOn(WS_OTHER))
            const st = cw.snapshot()
            const says = typeof st.note === 'string'
              && st.note.includes('没有订阅者属于这个项目')
              && st.note.includes('t-card-x')
            if (st.noSubscriberCount === 1 && says) {
              ok('R-d ✓ "筛空"是**独立一档**：`noSubscriberCount + 1` **且**有可读话'
                + '（点名卡 id 与项目 id；⛔ 不静默丢弃）')
            } else {
              bad('R-d 【筛空必须可数可读】没有一档独立读数'
                + `：noSubscriberCount=${st.noSubscriberCount}（应 1）· 有话=${says}`
                + ` · note=${JSON.stringify(st.note)}`)
            }
          }

          // ── R-e ⭐ **既有三档一条都不许被合并 / 降级** ─────────────────────────
          {
            // ① 一个订阅者都没有（`targets.size === 0`）—— 与"筛空"是**两句不同**的话
            const noOne = new wakeMod.CardWake({
              origin: 'http://127.0.0.1:0',
              workspaceIdOf: () => WS_MINE,
              deliver: () => Promise.resolve({ ok: true }),
              now: () => 1792300800000,
            })
            await noOne.handleFrame('change', frameOn(WS_MINE))
            const stNoOne = noOne.snapshot()
            const saysNoOne = typeof stNoOne.note === 'string' && stNoOne.note.includes('没有订阅者')

            // ② 投递通道没就绪（`deliverFn === undefined`）
            const noChannel = new wakeMod.CardWake({
              origin: 'http://127.0.0.1:0',
              workspaceIdOf: () => WS_MINE,
              now: () => 1792300800000,
            })
            noChannel.subscribe('session-hob', WS_MINE)
            await noChannel.handleFrame('change', frameOn(WS_MINE))
            const stNoChannel = noChannel.snapshot()
            const saysNoChannel = typeof stNoChannel.note === 'string' && stNoChannel.note.includes('投递通道没就绪')

            // ③ 投递抛错（`catch` 那一档）
            const boom = new wakeMod.CardWake({
              origin: 'http://127.0.0.1:0',
              workspaceIdOf: () => WS_MINE,
              deliver: () => Promise.reject(new Error('probe: deliver exploded')),
              now: () => 1792300800000,
            })
            boom.subscribe('session-hob', WS_MINE)
            await boom.handleFrame('change', frameOn(WS_MINE))
            const stBoom = boom.snapshot()
            const saysBoom = typeof stBoom.note === 'string' && stBoom.note.includes('失败')

            // ④ 三句必须是**三种不同**的话（⛔ 不许合并成一句）
            const notes = [stNoOne.note, stNoChannel.note, stBoom.note].map((x) => String(x ?? ''))
            const distinct = new Set(notes).size === 3
            if (saysNoOne && saysNoChannel && saysBoom && distinct) {
              ok('R-e ✓ 既有三档**一条都没被合并**：'
                + '"没有订阅者" / "投递通道没就绪" / "投递失败" 三句各自还在且互不相同'
                + '（⚠ 与 R-d 的"筛空"是**第四句**，不共用措辞）')
            } else {
              bad('R-e 【三档被合并或丢了】'
                + `：没有订阅者=${saysNoOne} · 通道没就绪=${saysNoChannel} · 投递失败=${saysBoom}`
                + ` · 三句互不相同=${distinct}`)
            }
          }

          // ── R-f ⭐ **负向对拍**：把 `filter` 那一步摘掉 ⇒ R-a 必须当场 FAIL ──────
          //   ⚠ 判据**不是**退出码，而是：变异体跑**同一段 R-a/R-b** ⇒ 出现串台，
          //     且本组打出**可读断言行**（这正是 R-a/R-b/R-b2 存在的意义）。
          {
            const srcPath = join(root, 'src', 'server', 'card-wake.ts')
            const original = readFileSync(srcPath, 'utf8')
            /**
             * 靶点 = **按归属筛的谓词本身**。
             *
             * ⚠ ⚠ 为什么不能拿 `for (const t of eligible)` 当靶子（第一版写错过，实测教训）：
             *   把它换回全量遍历后，`eligible.length === 0` 那道 `continue` **仍然先拦住**了
             *   "筛空"的情形 ⇒ 变异体在单订阅者的 R-a 场景里**行为照旧**（投 0），
             *   只有多订阅者的 R-b2 才露馅 ⇒ 对拍的靶子**偏了**。
             *   ⇒ 正确的靶子是把谓词改成**恒真**（= 谁都不排除 = 改前的全量广播）。
             */
            const GUARD = 'const eligible = rows.filter((t) => t.workspaceId !== undefined && t.workspaceId === e.workspaceId)'
            if (!original.includes(GUARD)) {
              bad('R-f 【负向对拍失去靶子】在 `card-wake.ts` 里找不到"按归属筛"的谓词原文'
                + `（期望：${GUARD}）⇒ 本判据已对不上实现，不按通过处理`)
            } else {
              // ⚠ 变异 = 谓词改成恒真（= 谁都收 = 改前的全量广播）
              const mutDir = mkdtempSync(join(tmpdir(), 'hob-scopecheck-'))
              const mutPath = join(mutDir, 'card-wake.ts')
              writeFileSync(mutPath, original.replace(GUARD, 'const eligible = rows.filter((t) => true || t.workspaceId === e.workspaceId)'), 'utf8')
              let mutant
              try {
                mutant = await import(pathToFileURL(mutPath).href)
              } catch (e) {
                bad(`R-f 【负向对拍跑不起来】变异体 import 失败：${String(e?.message ?? e)}`)
              }
              if (mutant !== undefined) {
                const sent = []
                const mw = new mutant.CardWake({
                  origin: 'http://127.0.0.1:0',
                  workspaceIdOf: () => WS_OTHER,
                  deliver: (sid, text) => { sent.push({ sid, text }); return Promise.resolve({ ok: true }) },
                  now: () => 1792300800000,
                })
                mw.subscribe('session-hob', WS_MINE)          // 我：本项目
                mw.subscribe('session-other-hob', WS_OTHER)   // 他：别的项目
                await mw.handleFrame('change', frameOn(WS_OTHER))
                const leaked = sent.filter((x) => x.sid === 'session-hob').length
                if (leaked > 0) {
                  ok('R-f ✓ 负向对拍：把"按归属筛"的谓词摘掉（改成恒真 = 全量广播）⇒'
                    + ` **R-a/R-b2 当场不成立**（别的项目的卡投给了我 ${leaked} 声 · 共 ${sent.length} 声）`
                    + ' ⇒ R-a/R-b/R-b2 真长牙（⚠ 这条 PASS 说明变异体确实被抓到了）')
                } else {
                  bad('R-f 【负向对拍失败】谓词恒真之后**仍然**没投给别的项目的订阅者'
                    + `（投递=${sent.length}）⇒ R-a/R-b2 测的不是"按项目过滤"这件事（永远 PASS = 没有分辨力）`)
                }
              }
              try { rmSync(mutDir, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
            }
          }
        } catch (e) {
          bad(`R 叫醒面按项目投递：本组跑不起来（${String(e?.message ?? e)}）⇒ 不按通过处理`)
        }
      }

      // ── R-g. **"没报项目"必须独立成档**（2026-10-19 · `TASK-B8` · 回归的收口)──────
      //
      // ⚠ **它守的是哪条回归**（我自己在 S4 报上来的那条，实测）：
      //   `cf72d8b` 把订阅谓词写成 `t.workspaceId !== undefined && t.workspaceId === e.workspaceId`
      //   ⇒ **没报项目**的旧式订阅（`subscribe(sid)`）被判成"不属于本项目" ⇒ 筛空 ⇒ **不投**，
      //   而且**一声可读话都没有**（那句"没有订阅者属于这个项目"读起来像"确实没人在看"，
      //   把"有人在看、但没说自己是哪个项目"**掩盖**了）。
      //   行为对照读数：`cf72d8b^` ⇒ `woke=1 sent=1`；`cf72d8b` ⇒ `woke=0 sent=0`
      //   （`tmp/probe-before-after.mjs`）。⇒ 连带 N-a / N-b / N-f / O-d 四条红。
      //
      // ⚠ ⚠ **本组钉两件事**（缺一不算）：
      //   · **R-g1 不越界**：没报项目 ⇒ **仍然不投**（⛔ 不许退回全量广播）；
      //   · **R-g2 不静默**：必须落一条**独立**可读话（`noProjectCount + 1`），
      //     且 ⛔ 不许与"没有订阅者" / "筛空" / "投递失败" 三句混同；
      //     话里必须写清它**既不是**"没有卡跑完"、**也不是**"已投递"。
      {
        try {
          const wakeMod = await import(pathToFileURL(join(root, 'src', 'server', 'card-wake.ts')).href)
          const WSX = 'ws-g-0001'
          const frameG = JSON.stringify({
            revision: 1, kind: 'execution-recorded',
            tasks: [{ id: 't-card-g', title: '演示卡', status: 'in_review', workspaceId: WSX,
              version: 2, lastExecutionOutcome: 'succeeded' }],
          })

          // ── R-g1 / R-g2 ⭐ 没报项目 ⇒ 不投 **且** 独立可读一档 ──────────────
          {
            const sent = []
            const cw = new wakeMod.CardWake({
              origin: 'http://127.0.0.1:0',
              workspaceIdOf: () => WSX,          // ⚠ 全局单值"恰好对得上" —— 也不能因此放行
              deliver: (sid, text) => { sent.push({ sid, text }); return Promise.resolve({ ok: true }) },
              now: () => 1792300800000,
            })
            cw.subscribe('session-no-project')   // ⚠ 故意不传项目（旧式调用）
            const n = await cw.handleFrame('change', frameG)
            const st = cw.snapshot()
            const note = String(st.note ?? '')
            const saysNoProject = note.includes('没有报告自己属于哪个项目')
            const saysNotDelivered = note.includes('不是"已投递"')
            const saysNotNoCard = note.includes('不是"没有卡跑完"')
            const notMixedWithNoSub = !note.includes('没有订阅者属于这个项目')
            const counted = st.noProjectCount === 1
            const zeroSubUntouched = st.noSubscriberCount === 0
            if (n === 0 && sent.length === 0 && saysNoProject && saysNotDelivered
                && saysNotNoCard && notMixedWithNoSub && counted && zeroSubUntouched) {
              ok('R-g1/R-g2 ✓ "没报项目"既不越界也不静默：'
                + `投递=${sent.length}（应 0）· 独立档 noProjectCount=${st.noProjectCount}（应 1）`
                + ` · 没并进"筛空"=${notMixedWithNoSub} · 明写"不是已投递 / 不是没有卡跑完"=${saysNotDelivered && saysNotNoCard}`)
            } else {
              bad('R-g 【没报项目必须"不越界 + 不静默"】缺项'
                + `：投递=${sent.length}（应 0）· 有"没报项目"那句=${saysNoProject}`
                + ` · 明写不是已投递=${saysNotDelivered} · 明写不是没卡跑完=${saysNotNoCard}`
                + ` · 未混进筛空=${notMixedWithNoSub} · noProjectCount=${st.noProjectCount}`
                + ` · noSubscriberCount=${st.noSubscriberCount}（应 0）`
                + ` · note=${JSON.stringify(note.slice(0, 160))}`)
            }
          }

          // ── R-g3 ⭐ 三档**互斥**：同一个订阅面上，"没报项目"与"筛空"不会同时成立 ──
          //   ⚠ 这条防的是"两档合并成一档"那种省事写法（合并之后计数就没法区分原因了）。
          {
            // ① 只有"没报项目"的订阅者
            const a = new wakeMod.CardWake({
              origin: 'http://127.0.0.1:0', workspaceIdOf: () => WSX,
              deliver: () => Promise.resolve({ ok: true }), now: () => 1792300800000,
            })
            a.subscribe('session-no-project')
            await a.handleFrame('change', frameG)
            const sa = a.snapshot()

            // ② 有一个订阅者、但它属于**别的项目**（= 真"筛空"）
            const b = new wakeMod.CardWake({
              origin: 'http://127.0.0.1:0', workspaceIdOf: () => WSX,
              deliver: () => Promise.resolve({ ok: true }), now: () => 1792300800000,
            })
            b.subscribe('session-other-project', 'ws-elsewhere')
            await b.handleFrame('change', frameG)
            const sb = b.snapshot()

            if (sa.noProjectCount === 1 && sa.noSubscriberCount === 0
                && sb.noProjectCount === 0 && sb.noSubscriberCount === 1) {
              ok('R-g3 ✓ 两档**互斥**且各自计数正确：'
                + `"没报项目" ⇒ noProject=${sa.noProjectCount}/筛空=${sa.noSubscriberCount} · `
                + `"别的项目" ⇒ noProject=${sb.noProjectCount}/筛空=${sb.noSubscriberCount}`
                + ' ⇒ 两种原因**没有**被记成同一档')
            } else {
              bad('R-g3 【两档必须互斥】计数串了'
                + `：没报项目 ⇒ noProject=${sa.noProjectCount}（应 1）/ 筛空=${sa.noSubscriberCount}（应 0）`
                + ` · 别的项目 ⇒ noProject=${sb.noProjectCount}（应 0）/ 筛空=${sb.noSubscriberCount}（应 1）`)
            }
          }
        } catch (e) {
          bad(`R-g "没报项目"独立成档：本组跑不起来（${String(e?.message ?? e)}）⇒ 不按通过处理`)
        }
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
