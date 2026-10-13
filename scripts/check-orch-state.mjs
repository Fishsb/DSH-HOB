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
 *   D. **不自动续上**：源码里**不得**把读回的丢失项 `watches.set(...)` 回去。
 *      理由写在 `orchestrator.ts` 修复段：`running → idle` 是**事件**不是可轮询状态，
 *      自动续上会留一个**永不结算**的 watch ⇒ 命中"同目标至多一条未结算"闸门
 *      ⇒ 该会话**永久不能再派**（比丢失更坏）。
 *      判据 = `markLost` 的返回值**只**流向计数/日志/通知，**不**流向 `watches`。
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
import { readFileSync } from 'node:fs'
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

// ── D. 不自动续上（关键的反向保护）──────────────────────────────────────
{
  // `markLost` 的返回值只能流向计数/日志/通知，**不得**流向 watches.set
  const idx = orchCode.indexOf('markLost(')
  if (idx < 0) {
    bad('D1 编排模块未调用 markLost —— 丢失判不出来')
  } else {
    // ⚠ 扫描范围 = 从 `markLost(` 到 `flushWatches` 的定义之前。
    //   这一段覆盖**整个接手块**（判丢失 → 计数 → 通知）。
    //   ⚠ 为什么不切到 `const refreshLostCount`（**实测踩过**）：
    //     裸调用 `refreshLostCount()` 在**定义之后**，按"定义前"切片会把
    //     注入在调用点附近的 `watches.set` **切到范围外** ⇒ 负向对拍**假通过**。
    //     终点改用更靠后的 `const flushWatches`，注入点就落在范围内了。
    const stop = orchCode.indexOf('const flushWatches')
    const scope = stop > 0 ? orchCode.slice(idx, stop) : orchCode.slice(idx)
    if (/watches\.set\s*\(/.test(scope)) {
      bad('D2 接手逻辑里出现 watches.set —— 不许自动续上（会留永不结算的 watch ⇒ 该会话永久不能再派）')
    } else {
      ok('D2 接手逻辑不写 watches（只记账/报告/通知）')
    }
  }

  // 落盘的 pending 必须来自**内存里活着的** watch（不是读回的文件）
  if (/\[\.\.\.watches\.values\(\)\]\.map\(\(x\)\s*=>\s*toPersisted/.test(orchCode)) {
    ok('D3 pending 由内存中活着的 watch 生成（不是读回文件）')
  } else {
    bad('D3 pending 不是由内存中活着的 watch 生成 —— 读回的文件不得当作"在等"')
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
