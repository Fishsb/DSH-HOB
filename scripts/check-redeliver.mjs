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

    // ═══════════════════════════════════════════════════════════════════
    // (d) **渲染面**：`hob_orch_status` 里那块"回执投递台账"（`TASK-R3`）
    //
    // ⚠ 它守的是上一轮留的那句话：「入口通了，但**用户拿不到 `executionId`** ⇒ 按不到」。
    //   ⇒ 本组钉三件事（`TASK-R3` §二-3，缺一即红）：
    //     ① 有台账 ⇒ 按形状列出来，且 `executionId` **完整不截断**；
    //     ② 台账为空 ⇒ **明说"没有"**（⛔ 不是不显示 —— "没有"与"没显示"必须可区分）；
    //     ③ 收件人 ≠ owner ⇒ **能被认出来**；⚠ **判不出 owner ⇒ 单独一档**
    //        （⛔ 不许并进"没有错投"）。
    //
    // ⚠ 变异靶子：把"错投判定"改成恒假（`mismatch === true` → `false`）⇒ ③ 必须红。
    //   ⚠ ⛔ 不是改成恒真让检查"跳过"—— 那会让断言在变异体上照样过（上一单的教训）。
    // ═══════════════════════════════════════════════════════════════════
    {
      // ⚠ 这里**从 src 里抽真实渲染源码**来跑，⛔ 不是在本脚本里重写一份
      //   —— 否则"判据测的是判据自己的副本"，与实现脱钩（`E-128` 同族）。
      const orch = join(root, 'src', 'modules', 'orchestrator.ts')
      let src = ''
      try {
        src = readFileSync(orch, 'utf8')
      } catch (e) {
        bad(`(d) 读不到 \`src/modules/orchestrator.ts\`（${String(e?.message ?? e)}）⇒ 渲染面判据无从落地`)
      }
      if (src !== '') {
        /**
         * ⚠ 靶点 = 那三态写法本身（`mismatch === true` / `=== false` / 其余 = 判不出）。
         *   ⚠ 它必须**在盘上**且**唯一**，否则判据会静默对不上实现。
         */
        const GUARD = "const verdict = e.mismatch === true"
        if (!src.includes(GUARD)) {
          bad('(d) 【失去靶子】在 `orchestrator.ts` 里找不到错投三态判定的原文'
            + `（期望含：${GUARD}）⇒ 渲染面判据已对不上实现，不按通过处理`)
        } else {
          // ── 抽渲染块：从 `const DELIVERY_LIST_MAX = 8` 到 `deliveryLines` 的 IIFE 结束 ──
          const startMark = 'const DELIVERY_LIST_MAX = 8'
          const endMark = 'const dispatchWakeLines = '
          const i0 = src.indexOf(startMark)
          const i1 = src.indexOf(endMark)
          if (i0 < 0 || i1 < 0 || i1 <= i0) {
            bad('(d) 【抽不出渲染块】`DELIVERY_LIST_MAX` 与 `dispatchWakeLines` 两处标记之间取不到源码'
              + ' ⇒ 渲染面判据无从落地（⛔ 不按通过处理）')
          } else {
            const blockSrc = src.slice(i0, i1)
            /**
             * ⚠ 把渲染块抽成**纯函数**（⛔ 不改盘上源码，只在 `mkdtemp` 里造副本）：
             *   块的样子是
             *     `const DELIVERY_LIST_MAX = 8`
             *     `const deliveryLines = await (async (): Promise<string[]> => { … })()`
             *   ⇒ 取 `DELIVERY_LIST_MAX` 那一行 + IIFE 的**函数体**（`{` 与最后的 `})()` 之间），
             *   包成 `export const renderDeliveryLines = (led) => { <体> }`。
             *   ⚠ 函数体里唯一的自由变量就是 `led`（它来自外层 `await orch.deliveryLedger()`）
             *     ⇒ 把它作为参数注入，其余（`DELIVERY_LIST_MAX`）用同一行常量。
             *   ⚠ 若将来块里用了别的外层变量，下面的 import 会**当场失败**并判红
             *     —— 那是"判据与实现脱钩"的正确信号，⛔ 不许悄悄跳过。
             */
            const MAX_LINE = 'const DELIVERY_LIST_MAX = 8'
            const OPEN = 'const deliveryLines = await (async (): Promise<string[]> => {'
            const oi = blockSrc.indexOf(OPEN)
            if (oi < 0) {
              bad('(d) 【抽不出渲染块】找不到 IIFE 开头'
                + `（期望含：${OPEN}）⇒ 判据对不上实现，⛔ 不按通过处理`)
            } else {
              let body = blockSrc.slice(oi + OPEN.length)
              // 去掉收尾的 `})()` 以及后面的空白
              const ci = body.lastIndexOf('})()')
              if (ci < 0) {
                bad('(d) 【抽不出渲染块】找不到 IIFE 收尾 `})()` ⇒ 判据对不上实现')
              } else {
                body = body.slice(0, ci)
              }
              /**
               * ⚠ **把 `const led = await orch.deliveryLedger()` 那一行去掉**：
               *   纯渲染函数里的 `led` 由参数注入（`await` 在非 async 函数里是保留字 ⇒ 求值失败）。
               *   ⚠ 只删这一行；其余（含 `try/catch` 与全部措辞）**原样保留**
               *     ⇒ 判据测的仍是**盘上那段真源码**，⛔ 不是本脚本重写的副本。
               */
              const bodyPure = body
                .replace(/^\s*const led = await orch\.deliveryLedger\(\).*$/m, '')
                /**
                 * ⚠ 还要去掉 **TS 类型断言**（`(e as Error)`）—— 那是 TS 语法，纯 `.mjs` 里求值会
                 * 报 `Unexpected identifier 'as'`。⚠ 只做**语法降级**（`as Error` → 空），
                 * ⛔ 不改任何措辞、⛔ 不改任何判断。
                 */
                .replace(/\bas (?:Error|unknown)\b/g, '')
              if (bodyPure === body) {
                bad('(d) 【抽不出渲染块】块里找不到 `const led = await orch.deliveryLedger()` 那一行'
                  + ' ⇒ 判据对不上实现（⚠ 若实现改成别的取数写法，这里要同步）')
              }
              const wrapped = `export const renderDeliveryLines = (led) => {\n`
                + `  ${MAX_LINE}\n`
                + bodyPure
                + '\n}\n'
              const dir = mkdtempSync(join(tmpdir(), 'hob-redeliver-render-'))
              const modPath = join(dir, 'render.mjs')
              writeFileSync(modPath, wrapped, 'utf8')
              {
                let rmod
                try {
                  rmod = await import(pathToFileURL(modPath).href)
                } catch (e) {
                  bad(`(d) 【渲染块插不进去】抽出来的源码不能独立求值：${String(e?.message ?? e)}\n`
                    + '      ⇒ 多半是渲染块里用了外层变量；⚠ 这是判据与实现脱钩的信号，⛔ 不按通过处理')
                }
              if (rmod !== undefined && typeof rmod.renderDeliveryLines === 'function') {
                const render = rmod.renderDeliveryLines

                // ── ① 有台账 ⇒ 列出来，且 executionId **完整不截断** ─────────────
                const LONG_ID = 'e-0123456789abcdef-full-id-must-survive'
                const l1 = render({
                  total: 2, reachability: 'ok',
                  entries: [
                    { executionId: LONG_ID, to: 'session-wrong', taskId: 't-1', owner: 'session-right', mismatch: true },
                    { executionId: 'e-undecidable', to: 'session-x', taskId: 't-2', mismatch: undefined },
                  ],
                }).join('\n')
                const hasFullId = l1.includes(LONG_ID)
                const saysMismatch = l1.includes('可能投错')
                const saysUndecidable = l1.includes('判不出')
                /**
                 * ⚠ ⚠ **"有没有建议用户去补投 / 有没有谎称已修复"不能只测子串**（实测踩到）：
                 *   实现里那句是「⛔ 也没有"已修复"这回事」—— 它是**否定式说明**，
                 *   子串里有"已修复"却正是我们要的。⇒ 判据改为：
                 *   · 不许出现**建议式**措辞（"建议你补投" / "请补投" / "请你补"）；
                 *   · 不许出现**肯定式**的"已修复"（即"已修复"前面**不是**否定词）。
                 */
                const adviceWords = ['建议你补投', '建议补投', '请补投', '请你补']
                const hasAdvice = adviceWords.some((w) => l1.includes(w))
                // ⚠ 肯定式"已修复"：前面 8 个字符内**没有**否定词（不 / 没 / 无 / 未 / ⛔）
                const affirmFixed = (() => {
                  const key = '已修复'
                  let i = l1.indexOf(key)
                  while (i >= 0) {
                    const before = l1.slice(Math.max(0, i - 8), i)
                    if (!/[不没无未⛔]/.test(before)) return true
                    i = l1.indexOf(key, i + 1)
                  }
                  return false
                })()
                const notAdvice = !hasAdvice && !affirmFixed
                if (hasFullId && saysMismatch && saysUndecidable && notAdvice) {
                  ok('(d)① ✓ 有台账 ⇒ 列出来：**`executionId` 完整不截断**'
                    + '（长 id 原样保留）· 错投的标"可能投错"· 判不出的**单独**标"判不出"'
                    + '· ⛔ 没有"建议你补投"这类建议措辞、⛔ 也没有肯定式的"已修复"')
                } else {
                  bad('(d)【有台账必须可复制可辨认】不成立'
                    + `：executionId 完整=${hasFullId} · 标了可能投错=${saysMismatch}`
                    + ` · 标了判不出=${saysUndecidable} · 无建议措辞=${notAdvice}`
                    + `\n      ⇒ 渲染原文：${JSON.stringify(l1.slice(0, 300))}`)
                }

                // ── ② 台账为空 ⇒ **明说"没有"**（⛔ 不是不显示）──────────────────
                const emptyLines = render({ total: 0, reachability: 'no-cards', entries: [] })
                const saysEmpty = emptyLines.length > 0
                  && emptyLines.join('\n').includes('没有')
                  && emptyLines.join('\n').includes('投递记录')
                if (saysEmpty) {
                  ok('(d)② ✓ 台账为空 ⇒ **明说"没有投递记录"**'
                    + `（${emptyLines.length} 行，⛔ 不是"一行都不显示"）`
                    + ' ⇒ "没有"与"没去读"可区分')
                } else {
                  bad('(d)【空台账必须明说】不成立：空态**没有**可读的"没有"一说'
                    + `（${emptyLines.length} 行）⇒ 用户会把「没显示」读成「没有」`)
                }

                // ── ③ 判不出 owner ⇒ **单独一档**，⛔ 不许并进"没有错投" ───────────
                const l3 = render({
                  total: 1, reachability: 'ok',
                  entries: [{ executionId: 'e-nobody', to: 'session-x', taskId: 't-3', mismatch: undefined }],
                }).join('\n')
                const onlyUndecidable = l3.includes('判不出') && !l3.includes('一致')
                if (onlyUndecidable) {
                  ok('(d)③ ✓ **判不出 owner ⇒ 单独一档**：`mismatch === undefined` 写成"判不出"，'
                    + '⛔ 没有被写成"一致"（那会把"判不出"读成"没投错"）')
                } else {
                  bad('(d)【判不出必须单独一档】不成立'
                    + `：含"判不出"=${l3.includes('判不出')} · 误写成"一致"=${l3.includes('一致')}`
                    + `\n      ⇒ 渲染原文：${JSON.stringify(l3.slice(0, 240))}`)
                }

                // ── ④ 超上限 ⇒ **明说还有 N 条**（⛔ 不许静默截断）────────────────
                const many = Array.from({ length: 11 }, (_, i) => ({
                  executionId: `e-${i}`, to: 's', taskId: `t-${i}`, owner: 's', mismatch: false,
                }))
                const l4 = render({ total: 11, reachability: 'ok', entries: many }).join('\n')
                const saysRest = l4.includes('还有 3 条未列出')
                if (saysRest) {
                  ok('(d)④ ✓ 超出上限**明说"还有 3 条未列出"**（11 条只列 8 条）'
                    + ' ⇒ ⛔ 没有静默截断')
                } else {
                  bad('(d)【超出上限不许静默截断】不成立：11 条台账里没找到"还有 3 条未列出"'
                    + `\n      ⇒ 渲染原文尾部：${JSON.stringify(l4.slice(-200))}`)
                }

                // ── 变异：把错投判定改成**恒假** ⇒ ③ 那档必须红 ─────────────────
                //   ⚠ ⚠ 靶子 = `e.mismatch === true` → `false`
                //     ⇒ 错投那条会被当成"一致"，"可能投错"消失 ⇒ (d)① 当场红。
                const mutSrc = src.replace(
                  'const verdict = e.mismatch === true',
                  'const verdict = false && e.mismatch === true',
                )
                if (mutSrc === src) {
                  bad('变异(d) 【失去靶子】替换 `mismatch === true` 未生效 ⇒ 判据对不上实现')
                } else {
                  const mutBlock = mutSrc.slice(mutSrc.indexOf(startMark), mutSrc.indexOf(endMark))
                  // ⚠ 与正向侧**同一套语法降级**（去 `await` 行 + 去 TS 断言），
                  //   否则变异体根本跑不起来 ⇒ "负向对拍失败"会被误读成"判据没牙"。
                  const mutBlockOpen = 'const deliveryLines = await (async (): Promise<string[]> => {'
                  const mutOi = mutBlock.indexOf(mutBlockOpen)
                  let mutBody = mutOi < 0 ? mutBlock : mutBlock.slice(mutOi + mutBlockOpen.length)
                  const mutCi = mutBody.lastIndexOf('})()')
                  if (mutCi >= 0) mutBody = mutBody.slice(0, mutCi)
                  const mutWrap = 'export const renderDeliveryLines = (led) => {\n'
                    + '  const DELIVERY_LIST_MAX = 8\n'
                    + mutBody
                      .replace(/^\s*const led = await orch\.deliveryLedger\(\).*$/m, '')
                      .replace(/\bas (?:Error|unknown)\b/g, '')
                    + '\n}\n'
                  const mutPath = join(dir, 'render-mut.mjs')
                  writeFileSync(mutPath, mutWrap, 'utf8')
                  let mm
                  try {
                    mm = await import(pathToFileURL(mutPath).href)
                  } catch (e) {
                    bad(`变异(d) 【变异体跑不起来】${String(e?.message ?? e)}`)
                  }
                  if (mm !== undefined && typeof mm.renderDeliveryLines === 'function') {
                    const ml = mm.renderDeliveryLines({
                      total: 1, reachability: 'ok',
                      entries: [{ executionId: 'e-mut', to: 'session-wrong', taskId: 't-m', owner: 'session-right', mismatch: true }],
                    }).join('\n')
                    const lost = !ml.includes('可能投错')
                    if (lost) {
                      ok('变异(d) ✓ 把错投判定改成**恒假** ⇒ "可能投错"**当场消失**'
                        + '（错投的那条被写成"一致"）⇒ (d)①③ 的靶子是真的')
                    } else {
                      bad('变异(d) 【负向对拍失败】把 `mismatch === true` 改成恒假后，'
                        + '渲染里**仍然**说"可能投错" ⇒ (d) 测的不是这件事（它永远 PASS，没有分辨力）')
                    }
                  }
                }
              }
            }
            try { rmSync(dir, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ }
          }
        }
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
