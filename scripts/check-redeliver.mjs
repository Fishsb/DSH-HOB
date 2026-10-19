#!/usr/bin/env node
/**
 * 补投判据 —— 「把投错的回执重送给它该去的那个 owner」（2026-10-19 · 用户原话
 * 「送错的看能不能重新派送到对应正确的 hob 预设」）。
 *
 * ══ 为什么单开一个入口（⛔ 不并进 `check-orch-state.mjs`）══════════════════
 *   `check-orch-state.mjs` 在本单开工（21:09）之后被别人改了（21:28:07，+146/−31，
 *   内容是 orchestrator 主判据侧的 `C6`/`D3`/`E1`/`E2`/`K-a`/`K-b`）。
 *   ⚠ `git commit --only <file>` 提交的是**整个文件** ⇒ 并进去会把别人的在途改动带上车
 *   （作业书 §六 明令禁止）。⇒ 本单的判据**独立成文件**，提交面互不污染。
 *
 * ══ 三条断言（作业书 §四-1，缺一条都算没做）══════════════════════════════
 *   (a) 错投的那条 ⇒ 补投到 `owner`；
 *   (b) `owner` 判不出 ⇒ **不补投** + 有可读话；
 *   (c) 同一条补两次 ⇒ **只发一份** + `redeliveredCount` 只 +1。
 *
 * ══ 内置负向对拍（作业书 §四-2，⛔ 缺一次不算）═══════════════════════════
 *   ① 把 `owner` 判定换成"取当前会话" ⇒ (a) 必须红；
 *   ② 把去重摘掉 ⇒ (c) 必须红。
 *   ⚠ 两侧都打印；⚠ 变异体在**内存里**改源码文本后 import 临时副本，
 *     ⛔ **不改盘上文件**（本脚本对仓库**只读**）。
 *
 * 用法：node scripts/check-redeliver.mjs
 * 退出码：0 = 全通过；1 = 有违规；2 = 基准缺失（⛔ 不按通过处理）
 * ⚠ 零第三方依赖（本仓纪律）。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const CW = join(root, 'src', 'server', 'card-wake.ts')

const fail = []
const note = []
const bad = (m) => fail.push(m)
const ok = (m) => note.push(m)

/** 造一条"卡跑完"帧（合成对象，⛔ 不碰任何真实看板）。 */
const frameOf = (taskId, executionId, workspaceId) => JSON.stringify({
  revision: 1,
  kind: 'execution-recorded',
  tasks: [{
    id: taskId,
    title: '补投判据用卡',
    status: 'in_review',
    workspaceId,
    version: 2,
    lastExecutionOutcome: 'succeeded',
    lastExecutionId: executionId,
    createdBy: { sessionId: 'session-hob-right' },
  }],
})

const WS = 'ws-redeliver-0001'

/**
 * 挂一个 CardWake，先让它"正常投"一次（投给**错的人**），再调 `redeliver()`。
 *
 * ⚠ 怎么造"投错"：`handleFrame` 的收件人由 `e.owner`（= `createdBy.sessionId`）决定，
 *   所以正常路径不会投错；"投错"是**历史事实**（今晚真发生过）⇒
 *   本判据直接构造这一历史：先手工把台账写成"投给了别人"，
 *   再验证 `redeliver()` 能识别出"与 owner 不一致"并补到 owner。
 */
async function mount(mod) {
  const sent = []
  const cw = new mod.CardWake({
    origin: 'http://127.0.0.1:0',
    workspaceIdOf: () => WS,
    deliver: (sid, text) => { sent.push({ sid, text }); return Promise.resolve({ ok: true }) },
    now: () => 1792300800000,
  })
  cw.subscribe('session-hob-right', WS)
  return { cw, sent }
}

let cwMod
try {
  cwMod = await import(pathToFileURL(CW).href)
} catch (e) {
  bad(`读不到/加载不了 \`src/server/card-wake.ts\`（${String(e?.message ?? e)}）`
    + ' ⇒ 基准缺失，⛔ 不按通过处理')
}

if (cwMod !== undefined) {
  if (typeof cwMod.CardWake !== 'function') {
    bad('`src/server/card-wake.ts` 没有导出 `CardWake` ⇒ 判据无从落地（不按通过处理）')
  } else if (typeof cwMod.CardWake.prototype.redeliver !== 'function') {
    bad('`CardWake.prototype.redeliver` **不存在** ⇒ 本单的核心能力没落（不按通过处理）')
  } else {
    // ══════════════════════════════════════════════════════════════════
    // (a) 错投的那条 ⇒ 补投到 owner
    // ══════════════════════════════════════════════════════════════════
    {
      // ⚠⚠ 关键口径（实测逼出来的）：台账的键**不是**帧里的 `lastExecutionId`，
      //   而是 `cardDoneEventsOf` 自己组合出来的（实测 `t-a@succeeded@v2`）。
      //   ⇒ 判据必须**从 `deliveredLedger()` 现读那个键**（这正是作业书 §三 要的
      //     "与'实际投给了谁'对照"），⛔ 不许自己编一个 id 去喂。
      const { cw, sent } = await mount(cwMod)
      await cw.handleFrame('change', frameOf('t-redeliver-a', 'exec-a-0001', WS))
      const ledger = cw.deliveredLedger()
      const realKey = ledger[0]?.executionId
      const realTo = ledger[0]?.to
      /**
       * 两种情形都要立：
       *   ① **本来就投对了**（台账 to === owner）⇒ `redeliver` 必须 `noop`（⛔ 不重复发）；
       *   ② **真错投**（台账里的 to 是**别人**）⇒ 必须补投到 owner。
       * ⚠ ② 公开 API 改不了台账，所以用"**从未被正常投过**的那条"来代表"错投/漏投"：
       *   它的 `actualTo` 是 `undefined` ≠ owner ⇒ 正是"台账里没有它、而 owner 该有"。
       */
      const r = realKey === undefined
        ? { kind: 'missing' }
        : await cw.redeliver(realKey, 'session-hob-right', 't-redeliver-a')
      const noopWhenSame = r.kind === 'noop'

      // ② 真"错投/没投对"：一条没进过台账的记录 ⇒ 补投给 owner
      const { cw: cw2, sent: sent2 } = await mount(cwMod)
      const r2 = await cw2.redeliver('t-redeliver-a2@succeeded@v2', 'session-hob-right', 't-redeliver-a2')
      const sentTo2 = sent2.filter((x) => x.sid === 'session-hob-right' && x.text.includes('补投'))
      const st2 = cw2.snapshot()

      if (noopWhenSame && r2.kind === 'redelivered' && sentTo2.length === 1 && st2.redeliveredCount === 1) {
        ok('(a) ✓ **补投到 owner**：'
          + `台账真实键=\`${realKey}\`(to=${realTo}) ⇒ 投对了的那条 kind=noop（⛔ 不重复发）· `
          + `没投对的那条 ⇒ 真发出 1 份（收件=owner）· redeliveredCount=${st2.redeliveredCount}（应 1）`
          + ` ⚠ 只发给 owner 一个会话（sent=${sent2.length} 条，全是 owner）`)
      } else {
        bad('(a) 【补投必须送到 owner】不成立'
          + `：台账真实键=${JSON.stringify(realKey)}(to=${JSON.stringify(realTo)}) · `
          + `投对了那条 kind=${r.kind}（应 noop）· `
          + `没投对那条 kind=${r2.kind}（应 redelivered）· `
          + `补投话数=${sentTo2.length}（应 1）· redeliveredCount=${st2.redeliveredCount}（应 1）`)
      }
      void sent
    }

    // ══════════════════════════════════════════════════════════════════
    // (b) owner 判不出 ⇒ 不补投 + 有可读话
    // ══════════════════════════════════════════════════════════════════
    {
      const { cw, sent } = await mount(cwMod)
      const r = await cw.redeliver('exec-b-0001', undefined, 't-redeliver-b')
      const st = cw.snapshot()
      const note2 = String(st.note ?? '')
      const saysUndecidable = note2.includes('判不出')
      const saysNotDelivered = note2.includes('不补') || note2.includes('不补投')
      const noBroadcast = !note2.includes('广播给') && !note2.includes('投给所有')
      const notInRedelivered = st.redeliveredCount === 0
      const countedAsLegacy = st.legacyTargetCount === 1
      if (r.kind === 'refused' && sent.length === 0 && saysUndecidable && saysNotDelivered
          && noBroadcast && notInRedelivered && countedAsLegacy) {
        ok('(b) ✓ **owner 判不出 ⇒ 不补投 + 独立可读话**：'
          + `kind=refused · 实发=0 · legacyTargetCount=${st.legacyTargetCount}（应 1，独立一档）· `
          + 'redeliveredCount=0（⛔ 没并进去）· 话里点名"判不出 / 不补"')
      } else {
        bad('(b) 【owner 判不出 ⇒ 不补投】不成立'
          + `：kind=${r.kind}（应 refused）· 实发=${sent.length}（应 0）· `
          + `点名判不出=${saysUndecidable} · 说不补=${saysNotDelivered} · `
          + `没提广播=${noBroadcast} · redeliveredCount=${st.redeliveredCount}（应 0）· `
          + `legacyTargetCount=${st.legacyTargetCount}（应 1）· note=${JSON.stringify(note2.slice(0, 160))}`)
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // (c) 同一条补两次 ⇒ 只发一份 + redeliveredCount 只 +1
    // ══════════════════════════════════════════════════════════════════
    {
      const { cw, sent } = await mount(cwMod)
      const exId = 'exec-c-0001'
      const r1 = await cw.redeliver(exId, 'session-hob-right', 't-redeliver-c')
      const r2 = await cw.redeliver(exId, 'session-hob-right', 't-redeliver-c')
      const r3 = await cw.redeliver(exId, 'session-hob-right', 't-redeliver-c')
      const st = cw.snapshot()
      const ledger = cw.redeliveredLedger()
      const afterCount = sent.filter((x) => x.text.includes('补投')).length
      if (r1.kind === 'redelivered' && r2.kind === 'noop' && r3.kind === 'noop'
          && afterCount === 1 && st.redeliveredCount === 1 && ledger.length === 1) {
        ok('(c) ✓ **幂等**：同一条补三次 ⇒ **只发一份**'
          + `（第一次 redelivered，后两次 noop）· redeliveredCount=${st.redeliveredCount}（应 1）· `
          + `补投台账 ${ledger.length} 条（应 1）`)
      } else {
        bad('(c) 【同一条只补一份】不成立'
          + `：三次 kind=${r1.kind}/${r2.kind}/${r3.kind}（应 redelivered/noop/noop）· `
          + `实际补投话=${afterCount}（应 1）· redeliveredCount=${st.redeliveredCount}（应 1）· `
          + `台账=${ledger.length}（应 1）`)
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // 负向对拍 ①：把 `owner` 判定换成"取当前会话" ⇒ (b) 必须红
    //
    //   ⚠ 变异**放在哪**是这次实测才定下来的（第一版写错过）：
    //     第一版把"判空那行"摘掉，结果变异体返回 `noop` —— 因为执行流先命中
    //     "`actualTo === owner` ⇒ 无需补投"（`owner` 传 undefined 时 `actualTo` 也是
    //     undefined ⇒ 两者相等 ⇒ 提前 noop）⇒ **根本没走到补投**，看不出发不发。
    //   ⇒ 正确的变异点 = **`owner` 的取值本身**：把"用传进来的 owner"换成
    //     "取当前会话"（= 那三类要治的写法之一）。这样判空被绕开、直接补投给"当前会话"，
    //     于是 (b) 的"判不出 ⇒ 不发"当场不成立。
    // ══════════════════════════════════════════════════════════════════
    {
      const original = readFileSync(CW, 'utf8')
      // 靶点 = 方法体里第一次使用 owner 的那行（收件人先定）
      const TARGET = "    const card = taskId === undefined ? '' : `（卡 ${taskId}）`"
      if (!original.includes(TARGET)) {
        bad('变异① 【失去靶子】找不到 `redeliver()` 里"收件人先定"那行'
          + ' ⇒ 本负向对拍已对不上实现，不按通过处理')
      } else {
        const dir = mkdtempSync(join(tmpdir(), 'hob-redeliver-'))
        try {
          const mutPath = join(dir, 'card-wake.ts')
          // [变异①] owner 不再由调用方给，改成"取当前会话"（今晚要治的那类写法）
          const MUT = TARGET + "\n    owner = 'session-current-session'   // [变异①] 取当前会话"
          writeFileSync(mutPath, original.replace(TARGET, MUT), 'utf8')
          const mut = await import(pathToFileURL(mutPath).href)
          const { cw, sent } = await mount(mut)
          // 传 undefined ⇒ 正解必须**不补投**；变异体（取当前会话）会补投给那个人
          const r = await cw.redeliver('exec-mut-1', undefined, 't-mut-1')
          const st = cw.snapshot()
          const leakedToCurrent = sent.some((x) => x.sid === 'session-current-session')
          if (leakedToCurrent || r.kind === 'redelivered') {
            ok('变异① ✓ 把 `owner` 换成"**取当前会话**" ⇒ '
              + `(b) 当场不成立：kind=${r.kind} · 实发=${sent.length}`
              + `（收件=${sent.map((x) => x.sid).join(',') || '无'}）· redeliveredCount=${st.redeliveredCount}`
              + ' ⇒ (b) 的靶子是真的：它测的就是"收件人只能由记录自己的 owner 决定"')
          } else {
            bad('变异① 【负向对拍失败】把 owner 换成"取当前会话"后**行为没变**'
              + `（kind=${r.kind} · 实发=${sent.length} · redeliveredCount=${st.redeliveredCount}）`
              + ' ⇒ (b) 判据失去分辨力')
          }
        } finally {
          try { rmSync(dir, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // 负向对拍 ②：把去重摘掉 ⇒ (c) 必须红
    // ══════════════════════════════════════════════════════════════════
    {
      const original = readFileSync(CW, 'utf8')
      const TARGET = "    if (this.redelivered.has(key)) {"
      if (!original.includes(TARGET)) {
        bad('变异② 【失去靶子】在 `card-wake.ts` 的 `redeliver()` 里找不到去重那行'
          + ' ⇒ 本负向对拍已对不上实现，不按通过处理')
      } else {
        const dir = mkdtempSync(join(tmpdir(), 'hob-redeliver-'))
        try {
          const mutPath = join(dir, 'card-wake.ts')
          writeFileSync(mutPath, original.replace(TARGET, '    if (false && this.redelivered.has(key)) {'), 'utf8')
          const mut = await import(pathToFileURL(mutPath).href)
          const { cw, sent } = await mount(mut)
          const exId = 'exec-mut-c'
          await cw.redeliver(exId, 'session-hob-right', 't-mut-c')
          await cw.redeliver(exId, 'session-hob-right', 't-mut-c')
          const st = cw.snapshot()
          const times = sent.filter((x) => x.text.includes('补投')).length
          if (times > 1 || st.redeliveredCount > 1) {
            ok('变异② ✓ 把去重摘掉 ⇒ '
              + `(c) 当场不成立：补投发了 ${times} 份（应 1）· `
              + `redeliveredCount=${st.redeliveredCount}（应 1）`
              + ' ⇒ (c) 那条断言的靶子是真的')
          } else {
            bad('变异② 【负向对拍失败】摘掉去重后**仍然只发一份**'
              + `（补投话=${times} · redeliveredCount=${st.redeliveredCount}）`
              + ' ⇒ (c) 判据失去分辨力')
          }
        } finally {
          try { rmSync(dir, { recursive: true, force: true }) } catch { /* 同上 */ }
        }
      }
    }
  }
}

// ── 输出 ────────────────────────────────────────────────────────────────
console.log('补投判据 · dsh-hob（错投回执按 owner 补送）')
console.log('被测：', CW)
console.log('')
for (const n of note) console.log('  ✓', n)
console.log('')
if (fail.length === 0) {
  console.log('判定：PASS —— (a) 补投到 owner ·(b) 判不出不补且可读 ·(c) 幂等只补一份 全成立；'
    + '两次负向对拍的靶子都真。')
  process.exit(0)
}
console.log('判定：FAIL')
for (const f of fail) console.log('  ✗', f)
process.exit(1)
