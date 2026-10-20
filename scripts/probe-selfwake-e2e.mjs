#!/usr/bin/env node
/**
 * `probe-selfwake-e2e` —— **端到端行为探针**：拿**真看板卡的真记录**，喂**已出货产物**，
 * 验证「执行方 = owner ⇒ 不叫醒」在真数据形状上也成立。
 *
 * ── 它补的是哪一格（⚠ 与 `check:orch` 的 `SE-d` 不重复）────────────────────
 *   `SE-d` 用的是 **手写 fixture**（字段是我们自己挑的）⇒ 它证明"判据逻辑对"，
 *   ⛔ 不证明"**看板真推过来的那种形状**也判得对"。
 *   ⚠ 2026-10-20 那场事故里，正是"真帧里没有 `createdBy`、也没有 `executions`"
 *   这一点把上一版判据打空的 —— 手写 fixture 当时**看不出来**。
 *   ⇒ 本探针读**盘上真卡**（`~/.dsh/dsh-taskboard.json`），按看板 `broadcast()` 的真实投影
 *     （`summarize()`：**只有** id/title/workspaceId/status/version/lastExecutionOutcome…）
 *     造帧，再把 `ownerOf` / `execSessionOf` 接到**真卡的那两个字段**上。
 *
 * ── ⚠ 它**不**做的事（⛔ 不许把它的绿当成"端到端验收"）──────────────────
 *   ⛔ 不连真看板、⛔ 不写卡、⛔ 不动宿主；⚠ 它证明的是"**产物 + 真数据形状**"，
 *      ⛔ 不证明"宿主里那个实例在你这条真事件上没叫醒你"（那要等一次真的 `turn/end`）。
 *   ⚠ 输出必须把这条边界**写在读数旁边**（⛔ 不许让人读成"已端到端验收"）。
 *
 * ── 退出码 ─────────────────────────────────────────────────────────────
 *   `0` = 三档都按预期 · `1` = 现场与预期不符 · `2` = **未执行**（读不到卡库 / 产物加载不了）
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const HOME = process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh')
const BOARD = process.env.HOB_BOARD_FILE ?? join(HOME, 'dsh-taskboard.json')
const ROOT = new URL('..', import.meta.url).pathname
const WAKE = process.env.HOB_WAKE_ARTIFACT !== undefined && process.env.HOB_WAKE_ARTIFACT !== ''
  ? process.env.HOB_WAKE_ARTIFACT
  : join(ROOT, 'lib', 'server', 'card-wake.js')

/**
 * 退出码 2 的统一下场（⚠ "未执行"⛔ 不等于"通过"）。
 *
 * ⚠⚠ **本族在"没有看板卡库"的机器上 exit 2 是预期行为**（`TASK-2` §1-B 裁定①：**保持**）：
 *   这一族验的是"**真卡数据形状**"，没有真卡库就没有可验的对象
 *   ⇒ ⛔ **不造 fixture 兜底**（那会把这一族存在的理由打折）。
 *   ⇒ 这句话必须**直接读到**，⛔ 不许只写在注释里（所以放进了函数体，会被打印）。
 * ⚠ 连带后果（⚠ 读 `check:all` 的人要知道）：这种机器上 `check:all` 会因本族
 *   记"未执行"而**整体 exit 2**（⛔ 不是 0）—— 那是诚实的"没验过"，⛔ 不是"有问题"。
 */
const notRun = (why) => {
  console.log('判定：**未执行** —— ' + why)
  console.log('       ⚠ 这不代表"没出问题"，只代表**没东西可验**。')
  console.log('       ⚠ ⚠ **本族缺看板卡库 ⇒ 未执行是预期行为**（`TASK-2` §1-B 裁定①：保持 exit 2，⛔ 不改 0）；'
    + '⛔ 本族**不造 fixture 兜底** —— 那会把"真卡数据形状"这个存在理由打折。')
  console.log('       ⚠ 连带：这种机器上 `npm run check:all` 会因此**整体 exit 2**（⚠ 是"没验过"，⛔ 不是"坏了"）。')
  process.exit(2)
}

if (!existsSync(WAKE)) notRun(`找不到产物 \`${WAKE}\`（先 \`npm run build\`）`)
if (!existsSync(BOARD)) {
  /**
   * ══ ⚠⚠ **"缺看板卡库 ⇒ 未执行（预期）"必须能直接读到**（`TASK-2` §1-B 裁定①）═══
   *
   * 判据（裁定原文）：**保持 exit 2**（⛔ 不改 0 —— 那是放宽），
   *   并且把这句话写成**输出里的一行**（⛔ 不许只躺在代码注释里）。
   * ⚠ 另一条同款裁定：⛔ **不许造 fixture 兜底** —— 那会把这一族存在的理由
   *   （"拿**真**卡数据 + 已出货产物"）打折，等于把判据换成一段自说自话。
   * ⇒ 所以这里**只加一句可读话**，行为一个字没改（仍然 exit 2）。
   */
  notRun(`读不到看板卡库 \`${BOARD}\``)
}

let board
try { board = JSON.parse(readFileSync(BOARD, 'utf8')) } catch (e) {
  notRun(`卡库解析不了（${String(e?.message ?? e)}）`)
}
const tasks = Array.isArray(board?.tasks) ? board.tasks : []

/**
 * 挑一张**真·自产自收**的卡：它最近一次执行的 `sessionId` 与它自己的 `createdBy.sessionId` 相同。
 * ⚠ 这正是那场事故的形态（卡被绑在"自己每轮都会跑完一次"的会话上）。
 */
const selfBound = tasks.find((t) => {
  const ex = Array.isArray(t?.executions) ? t.executions : []
  const last = ex[ex.length - 1]
  const owner = t?.createdBy?.sessionId
  return typeof last?.sessionId === 'string' && last.sessionId !== '' && last.sessionId === owner
})
if (selfBound === undefined) notRun('卡库里没有"执行方 == 建卡会话"的真卡 ⇒ 本探针无对象可验')

const OWNER = selfBound.createdBy.sessionId
const otherTask = tasks.find((t) => {
  const ex = Array.isArray(t?.executions) ? t.executions : []
  const last = ex[ex.length - 1]
  return typeof last?.sessionId === 'string' && last.sessionId !== '' && last.sessionId !== t?.createdBy?.sessionId
})

/** 按看板 `broadcast()` 的真实投影造帧（⚠ 与真帧同形：**没有** createdBy / executions）。 */
const frameOf = (t) => JSON.stringify({
  revision: 1, kind: 'execution-recorded',
  tasks: [{
    id: t.id, title: t.title, workspaceId: t.workspaceId, urgency: t.urgency,
    status: t.status, blocked: t.blocked === true, version: t.version,
    commentCount: Array.isArray(t.comments) ? t.comments.length : 0,
    lastExecutionOutcome: (t.executions.at(-1) ?? {}).outcome,
    trashed: false,
  }],
})

/**
 * ⚠⚠ **`--selftest`：证明本探针真的会红**（`E-27`：永远绿的自检比没有更危险）。
 *
 * 做法（⛔ 全程只碰临时区，不碰真卡库 / 真产物）：
 *   ① 造一份**最小真形**卡库（一张自产自收、一张别人跑的）；
 *   ② 用**当前产物**跑 ⇒ 必须 **PASS**；
 *   ③ 把产物复制到临时区、**摘掉那道闸**再跑 ⇒ 必须 **FAIL**（否则说明本探针测的不是那道闸）。
 * ⚠ 退出码：0 = 两种情况都对；1 = 本探针失去分辨力。
 */
if (process.argv.includes('--selftest')) {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { spawnSync } = await import('node:child_process')
  /**
   * ══ ⚠⚠ **临时件卫生**（2026-10-20 本单 C · `TASK` §0.3）═══════════════════════
   *
   * 改前：本段每次跑造 **1 个 `hob-e2e-*`** 目录（里面有一份 `card-wake.js` 拷贝），
   *   ⚠ **跑完一个字节都不删**（本文件里 `rmSync` **零命中**）。
   *   本机 `/tmp` 是 5.9 G tmpfs 且**被占满过**（`CONTEXT.md` §2.4 第 15 项）。
   *   ⚠ 实测基线（改前）：`ls -d /tmp/hob-e2e-* | wc -l` = **4**。
   *
   * ⇒ 现在：整段包进 `try/finally`（**失败路径也清**），清理失败**当场说**（⛔ 不许静默）。
   *   ⚠ 清理写在 `finally` 里，`process.exit()` 之前 —— ⚠ 不行：`process.exit` 在 `finally` 之后
   *     仍会跳过？⇒ **不会**：`finally` 在 `exit` 调用之前就已执行完（本段的 `exit` 在末尾）。
   *     为稳妥，退出码统一在 `finally` **之后**用变量决定（见末尾）。
   */
  const base = mkdtempSync(join(tmpdir(), 'hob-e2e-'))
  let cleanupNote = '未清理'
  let bad = 0
  try {
  const board = join(base, 'board.json')
  const OWNER = 'session-owner-1'
  writeFileSync(board, JSON.stringify({ tasks: [
    { id: 't-self', title: '自产自收', workspaceId: 'ws-x', status: 'in_review', version: 2,
      createdBy: { kind: 'agent', sessionId: OWNER },
      executions: [{ id: 'e1', sessionId: OWNER, outcome: 'succeeded' }] },
    { id: 't-other', title: '别人跑的', workspaceId: 'ws-x', status: 'in_review', version: 3,
      createdBy: { kind: 'agent', sessionId: OWNER },
      executions: [{ id: 'e2', sessionId: 'session-worker', outcome: 'succeeded' }] },
  ] }), 'utf8')
  /** ② 真产物 ⇒ 应 PASS */
  const r1 = spawnSync('node', [process.argv[1]], { env: { ...process.env, HOB_BOARD_FILE: board }, encoding: 'utf8' })
  /** ③ 摘闸产物 ⇒ 应 FAIL */
  const mutDir = join(base, 'lib', 'server')
  mkdirSync(mutDir, { recursive: true })
  const raw = readFileSync(WAKE, 'utf8')
  const GUARD = 'if (execSid !== undefined && execSid === ownerResolved) {'
  const hasGuard = raw.includes(GUARD)
  let r2 = { status: -1, stdout: '' }
  if (hasGuard) {
    const mut = join(mutDir, 'card-wake.js')
    writeFileSync(mut, raw.replace(GUARD, 'if (false) {'), 'utf8')
    /** ⚠ 用环境变量把探针指向变异产物（⛔ 不去覆盖真产物） */
    r2 = spawnSync('node', [process.argv[1]], {
      env: { ...process.env, HOB_BOARD_FILE: board, HOB_WAKE_ARTIFACT: mut }, encoding: 'utf8',
    })
  }
  const say = (pass, line, why) => {
    console.log(`  ${pass ? '✓' : '✗'} ${line}${pass ? '' : `\n      ⇒ ${why}`}`)
    if (!pass) bad++
  }
  say(r1.status === 0, 'S-1 ✓ 真产物 + 最小真形卡库 ⇒ **PASS**', `exit=${r1.status}（应 0）`)
  say(hasGuard, 'S-2 ✓ 产物里找得到那道闸（⛔ 找不到就没法做反证）', '在产物里找不到该行原文')
  say(r2.status === 1, 'S-3 ✓ **摘掉那道闸 ⇒ 探针当场 FAIL**（⇒ 它测的确实是那道闸）',
    `exit=${r2.status}（应 1）· 输出=${String(r2.stdout).slice(0, 200)}`)
  console.log('')
  if (bad === 0) {
    console.log('判定：**PASS** —— 端到端探针自检 3 条全过（含"摘闸必红"）。')
  } else {
    console.log(`判定：**FAIL**（${bad} 条）—— 本探针失去分辨力。`)
  }
  } finally {
    /**
     * ⚠⚠ **无论如何都清**（`TASK` §1-C：失败路径也要清）。
     *   ⚠ 清不掉**当场说**：⛔ 不许"跑完了但脏东西留着、还报全绿"。
     */
    try {
      rmSync(base, { recursive: true, force: true })
      cleanupNote = '已清净'
    } catch (e) {
      cleanupNote = `**没清掉**（${String(e?.message ?? e)}）`
    }
    console.log(`  ⚠ 临时件：\`${base}\` ⇒ ${cleanupNote}`)
  }
  /** ⚠ 退出码在清理**之后**才定 —— 保证 `finally` 一定跑到。 */
  process.exit(bad === 0 ? 0 : 1)
}

const { CardWake } = await import('file://' + WAKE)

let bad = 0
/**
 * ⚠⚠ **乙-3**：E2E-3 无对象时置 `true` ⇒ 文件末尾走 `exit 2`。
 *   ⚠ 独立变量而不是"把 `bad` 加 1"：`bad` 的语义是"**查到不符**"（`exit 1`），
 *     而这里是"**没有对象可查**"（`exit 2`）—— 两种档位，⛔ 不许混成一个计数。
 */
let NO_OBJECT_E2E3 = false
const say = (pass, line, why) => {
  console.log(`  ${pass ? '✓' : '✗'} ${line}${pass ? '' : `\n      ⇒ ${why}`}`)
  if (!pass) bad++
}

/**
 * 造一面叫醒面：`ownerOf` / `execSessionOf` 直接读**真卡的那两个字段**
 * （= 真环境里 `orchestrator` 接的正是 `lookupCardSession` 的这两个值）。
 */
const mk = (task, execOverride) => {
  const sent = []
  const w = new CardWake({
    origin: 'http://127.0.0.1:0',
    workspaceIdOf: () => task.workspaceId,
    deliver: (sid, text) => { sent.push({ sid, text }); return Promise.resolve({ ok: true }) },
    ownerOf: async () => task.createdBy?.sessionId,
    execSessionOf: async () => (execOverride === undefined ? task.executions.at(-1)?.sessionId : execOverride),
  })
  w.subscribe(task.createdBy?.sessionId ?? 'x', task.workspaceId)
  return { w, sent }
}

console.log('端到端行为探针 · 真卡数据 + 已出货产物')
console.log('')
console.log(`  卡库：\`${BOARD}\`（${tasks.length} 张卡）`)
console.log(`  自产自收的真卡：\`${selfBound.id}\`「${String(selfBound.title).slice(0, 28)}」`
  + ` · 执行 ${selfBound.executions.length} 条 · owner 与执行方都是 \`${OWNER}\``)
console.log('')

// ① 真·自产自收 ⇒ 必须不叫醒
{
  const { w, sent } = mk(selfBound)
  const n = await w.handleFrame('change', frameOf(selfBound))
  const st = w.snapshot()
  say(n === 0 && sent.length === 0 && st.selfExecutedCount === 1,
    'E2E-1 ✓ **真卡（执行方 = owner）⇒ 一声不叫**：真帧形状（无 createdBy / 无 executions）下，'
    + '按卡现读补上执行方 ⇒ 投递 0 次、落 `selfExecutedCount=1`',
    `叫醒=${n}（应 0）· 投递=${sent.length}（应 0）· selfExecutedCount=${st.selfExecutedCount}（应 1）`
    + ` · 既有各档=${JSON.stringify({ legacy: st.legacyTargetCount, undelivered: st.undeliveredCount })}`)
}

// ② 同一张卡、把执行方改成别人 ⇒ **必须照常叫醒**（⛔ 不许把闸做成"这张卡永远不叫"）
{
  const { w, sent } = mk(selfBound, 'session-someone-else')
  const n = await w.handleFrame('change', frameOf(selfBound))
  say(n === 1 && sent.length === 1 && sent[0].sid === OWNER,
    'E2E-2 ✓ 同一张卡、执行方换成别人 ⇒ **照常叫醒一次**（收件人仍是真 owner）'
    + ' ⇒ 这道闸只挡"自己跑完的"，⛔ 没把整张卡静音',
    `叫醒=${n}（应 1）· 投递=${JSON.stringify(sent.map((s) => s.sid))}（应 ["${OWNER}"]）`)
}

// ③ 真卡库里的"别人跑的"卡（如果有）⇒ 也必须照常叫醒
if (otherTask !== undefined) {
  const { w, sent } = mk(otherTask)
  const n = await w.handleFrame('change', frameOf(otherTask))
  say(n === 1 && sent.length === 1,
    `E2E-3 ✓ 真卡库里另一张**别人跑的**卡（\`${otherTask.id}\`）⇒ 照常叫醒一次`,
    `叫醒=${n}（应 1）· 投递=${sent.length}（应 1）`)
} else {
  /**
   * ══════════════════════════════════════════════════════════════════════
   * ⚠⚠ **乙-3（2026-10-21 · 第 330 轮）：这一档原先只"说"不"做"**
   * ══════════════════════════════════════════════════════════════════════
   *
   * ── 改前的病灶（`PROJECT-SURVEY-3` §6.2 乙-3）────────────────────────
   *   这里只 `console.log('⛔ 不按通过计')`，而 **`bad` 一个都不加**
   *   ⇒ 走到文件末尾 `if (bad === 0) process.exit(0)` ⇒ ⚠ **仍然 PASS**。
   *   ⇒ 于是这句话**只是印刷品**：读的人看到"不按通过计"，机器却记成"通过"。
   *
   * ── 现在：让它与本族**自己已经声明的裁定**一致（`:46-48` 的原文）──────
   *   那条裁定写的是「缺整库 ⇒ **保持 exit 2**，⛔ 不改 0」。
   *   ⚠ 本档的口径与之**同族**：**扫到 0 个对象** ⇒ 这一档**没有东西可验**
   *     ⇒ 落在 `2` = "没有对象 / 没执行"，⛔ 不是 `0`（通过）、也⛔ 不是 `1`（查了不过）。
   *   ⚠ **本批要的不是"新增一种说法"，而是让退出码真的跟上那句裁定** ——
   *     所以这里**置一个显式的档位标记**，由文件末尾统一 `exit 2`。
   */
  console.log('  ⚠ E2E-3 【未执行】卡库里没有"执行方 ≠ 建卡会话"的卡 ⇒ 这一档**无对象**')
  console.log('       ⚠ 退出码 **2**（没有对象 / 没执行）—— ⛔ 不是 0（通过）、也⛔ 不是 1（查了不过）。')
  console.log('       ⚠ 这与本族 `:46-48` 已声明的裁定同族：缺对象 ⇒ 保持 exit 2，⛔ 不改 0。')
  NO_OBJECT_E2E3 = true
}

console.log('')
console.log('       ⚠ ⚠ **这不是端到端验收**：它证明"**产物 + 真数据形状**"这一层，'
  + '⛔ 不证明"宿主里那个实例在你这条真事件上没叫醒你"。')
console.log('        后者要等**一次真的 `turn/end`**（⚠ 本档不主动制造看板事件）。')

/**
 * ⚠⚠ **乙-3**：E2E-3 扫到 0 个对象 ⇒ 这一档"没执行" ⇒ 全族落 `exit 2`。
 *   ⚠ 位置在 `bad === 0` **之前**：两者可以同时成立（前两档都过、第三档没对象）
 *     —— ⛔ 那种情形**不许**判成 `0`（那正是改前的假绿）。
 *   ⚠ `bad > 0` 时仍优先 `exit 1`：**真的查到不符**比"某档没对象"更该先被看见。
 */
if (bad === 0 && NO_OBJECT_E2E3) {
  console.log('')
  console.log('判定：**未执行** —— E2E-3 那一档**无对象**（卡库里没有"执行方 ≠ 建卡会话"的卡）')
  console.log('       ⇒ 退出码 **2**（没有对象 / 没执行），⛔ 不是 0、也⛔ 不是 1。')
  console.log('       ⚠ 改前这一档只印一句"⛔ 不按通过计"、**退出码仍是 0** —— 印刷与机器读数打架。')
  process.exit(2)
}
if (bad === 0) {
  console.log('判定：**PASS** —— 三档全部按预期（真数据形状）。')
  process.exit(0)
}
console.log(`判定：**FAIL**（${bad} 条）—— 真数据形状下与预期不符。`)
process.exit(1)
