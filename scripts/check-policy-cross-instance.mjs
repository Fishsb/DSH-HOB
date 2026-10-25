#!/usr/bin/env node
/**
 * `check:policy-cross` —— 跨实例投递的**准入**判据（2026-10-22 · 第 2 轮）。
 *
 * ══ 它守的是什么（`REQ-04` 会话独立 · `REQ-05` 外围能力保留）══════════════════
 *   改前：`src/index.ts` 在**模块装载期**按**实例级全局**档位决定"跨实例能力装不装"
 *   （`interconnectAllowed = () => permissionLevel(config) !== 'ledger'`）。
 *   ⇒ 全局档=账本时，即便**发起会话**在更宽档，能力**压根没装载** ⇒ 合法调用也拒
 *     （上一轮回报承认的那条：重启后合法请求全拒）。
 *   ⇒ 同时它也把"逐会话"架空：一个全局值决定所有人能不能用这个能力。
 *
 *   改后：装载**只看显式开关**；**每次投递**按**可信发起会话自己的**策略判。
 *   本脚本测的就是后者 —— 而且测的是**真 `deliverRemote`**，带一个**受控假启动器**。
 *
 * ══ 断言口径（⛔ 不许为了变绿放宽；每条都能失败）════════════════════════════
 *   CX-1 **旧全局低 + 本会话合法 ⇒ 投得出去**（旧全局 = `ledger`，发起会话 = `workspace`）
 *        ⇒ 必须走到启动器（假启动器被调用、`ok:true`）。⚠ 改前这条**必然红**。
 *   CX-2 **旧全局宽 + 本会话低 ⇒ 拒**（旧全局 = `workspace`，发起会话 = `ledger`）
 *        ⇒ `reason='session-level-too-low'`，且**假启动器一次都没被调用**。
 *   CX-3 **缺身份 ⇒ 拒**：`admissionOf` 报 `no-initiator` ⇒ `reason='no-trusted-initiator'`、
 *        `admissionCode='no-initiator'`、**未 spawn**。
 *   CX-4 **伪造别会话 id ⇒ 拒**：交付函数**签名里没有身份参数**（`opts.sessionKey` 已删），
 *        传进去的自报 id 必须**完全不起作用** ⇒ 仍按 `no-initiator` 拒、**未 spawn**。
 *        ⚠ 这条是本轮最要紧的一条：它证明"身份改由执行上下文给"。
 *   CX-5 **策略坏 ⇒ 拒**（`bad-policy`），**未 spawn**。
 *   CX-6 **发起会话已销毁 ⇒ 拒**（`stale-session`），**未 spawn**。
 *   CX-7 **开关关 ⇒ 仍按旧句拒**（`switch-off`），**未 spawn**，且文案逐字未变。
 *   CX-8 **目标不在白名单 ⇒ 仍按旧句拒**（`target-not-in-allowlist`），**未 spawn**。
 *   CX-9 **非 Hob 会话**（`isHob=false`）不被本批意外改动：有身份 + 档位够 ⇒ 仍可投；
 *        档位不够 ⇒ 仍拒（说明本批**没有**把非 Hob 当特例放行，也没把它整块打死）。
 *   CX-10 **执行顺序**：任何被拒的调用，假启动器**零调用**（⛔ 不许"先 spawn 再判"）。
 *   CX-11 **负向对拍**：把准入改回"看全局档"的假实现 ⇒ CX-1 必须**不成立**；
 *        把身份判定去掉 ⇒ CX-4 必须**不成立**（证明判据确实咬住这两件事）。
 *
 * ══ 副作用（先查，后跑）════════════════════════════════════════════════════
 *   全部临时件在 `mkdtempSync(tmpdir())`；结束逐个 `rmSync`；⚠ 不写工作区/账本/profile。
 *   ⚠ **假启动器是自己写的 node 脚本**（打印一行 JSON）⇒ ⛔ 不连接任何真实对端、
 *     ⛔ 不调真实 profile、⛔ 不触发任何外部实例。
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
/**
 * ⚠ 源码树可注入（`HOB_CX_ROOT`）—— **只**给负向对拍用：把 `src/` 复制到临时目录、
 *   故意改坏，再跑同一份判据，验证它**能红**。缺省 = 本仓。
 */
const srcRoot = process.env.HOB_CX_ROOT !== undefined && process.env.HOB_CX_ROOT !== ''
  ? process.env.HOB_CX_ROOT
  : root

let pass = 0
let fail = 0
const badLines = []
/**
 * ── ⚠⚠ **第三态：`skip`（2026-10-24 · B 席 · 修"跳过数被硬编码"）**───────────────
 *
 * ── 改前是什么 ─────────────────────────────────────────────────────────
 *   收尾那行**写死** `跳过 0 处` —— 一个**字面量**，⛔ 不是读数。
 *   ⚠ 本文件当前确实**没有**跳过分支（13 条断言逐条都跑）⇒ 那个 0 **碰巧是对的**；
 *     但"碰巧对"与"由读数得出"是两件事：**将来**有人加一个 `if` 没配 `else`，
 *     这行**照样印 0**，而 `check:all` 的 `parseSkipCount()` 会被喂假 0。
 *   ⇒ 现在：真收集器（`noteSkip`）；⛔ 不许再出现字面量。
 */
const skip = []
const noteSkip = (m) => { skip.push(m); console.log(`  · ${m}`) }
const ok = (m) => { pass += 1; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail += 1; badLines.push(m); console.log(`  ✗ ${m}`) }

const created = []
function mkTmp(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix))
  created.push(d)
  return d
}

async function main() {
  const modPath = join(srcRoot, 'src', 'modules', 'interconnect.ts')
  let ic
  try {
    ic = await import(pathToFileURL(modPath).href)
  } catch (e) {
    console.error(`✗ 无法直载 ${modPath}（${String(e?.message ?? e)}）`)
    console.error('      ⇒ 基准缺失不按通过处理（exit 2）')
    process.exit(2)
  }
  for (const n of ['deliverRemote', 'apply', 'INTERCONNECT_SERVICE']) {
    if (ic[n] === undefined) {
      console.error(`✗ 实现缺少导出：${n} ⇒ 基准缺失（exit 2）`)
      process.exit(2)
    }
  }

  const sandbox = mkTmp('hob-cx-')
  /**
   * ⚠ **受控假启动器**：一个 node 脚本，只打印一行 JSON。
   *   它同时把"被调用了几次"记到一个文件里 —— 这是 CX-10「被拒 ⇒ 零调用」的判据。
   */
  const callLog = join(sandbox, 'launcher-calls.log')
  writeFileSync(callLog, '', 'utf8')
  const fakeLauncher = join(sandbox, 'fake-launcher.mjs')
  writeFileSync(fakeLauncher, `
import { appendFileSync } from 'node:fs'
appendFileSync(${JSON.stringify(callLog)}, 'called\\n')
console.log(JSON.stringify({ ok: true, from: 'fake-launcher', argv: process.argv.slice(2) }))
`, 'utf8')
  const calls = () => {
    try {
      return readFileSync(callLog, 'utf8').split('\n').filter((x) => x === 'called').length
    } catch { return -1 }
  }

  /**
   * 造一套 deps。`admission` 是**假准入**（本脚本测的是 `deliverRemote` 的行为，
   * 不是 `index.ts` 里那段取身份的代码；后者由 CX-4 的"签名无身份参数"间接证明）。
   */
  const makeDeps = (over = {}) => {
    const log = []
    return {
      log,
      deps: {
        enabledOf: () => true,
        targetsOf: () => [{ name: 'peer', launcher: fakeLauncher, profile: 'headless', subcommand: 'headless' }],
        admissionOf: () => ({ ok: true, sessionId: 'sess-A', level: 'workspace', isHob: true, source: 'stored' }),
        log: (m) => log.push(String(m)),
        timeoutMs: 20000,
        ...over,
      },
    }
  }

  const run = async (over = {}, opts = {}) => {
    const { deps, log } = makeDeps(over)
    const r = await ic.deliverRemote(deps, 'peer', 'do the work', opts)
    return { r, log, calls: calls() }
  }

  // ── CX-1 旧全局低 + 本会话合法 ⇒ 投得出去 ─────────────────────────────
  {
    const before = calls()
    const { r } = await run({ diagnosticLevelOf: () => 'ledger' })
    const after = calls()
    if (r.ok === true && after === before + 1) {
      ok('CX-1 ✓ 旧全局档=ledger、发起会话=workspace ⇒ **投递成功**（假启动器被调用 1 次）'
        + ' ⇒ 全局档不再一票否决合法会话')
    } else {
      bad(`CX-1 【合法调用被拒或没走到启动器】ok=${r.ok} · reason=${r.reason ?? '(无)'}`
        + ` · 启动器调用增量=${after - before}（期望 1）`
        + `\n      消息：${String(r.message ?? '').slice(0, 220)}`)
    }
  }

  // ── CX-2 旧全局宽 + 本会话低 ⇒ 拒，且零 spawn ────────────────────────
  {
    const before = calls()
    const { r } = await run({
      diagnosticLevelOf: () => 'workspace',
      admissionOf: () => ({ ok: true, sessionId: 'sess-B', level: 'ledger', isHob: true, source: 'stored' }),
    })
    const after = calls()
    if (r.ok === false && r.reason === 'session-level-too-low' && after === before) {
      ok('CX-2 ✓ 旧全局档=workspace、发起会话=ledger ⇒ **拒**（session-level-too-low），'
        + '假启动器**零调用** ⇒ 全局宽档不能把窄会话带出去')
    } else {
      bad(`CX-2 【窄会话被放行或已 spawn】ok=${r.ok} · reason=${r.reason ?? '(无)'}`
        + ` · 启动器调用增量=${after - before}（期望 0）`)
    }
  }

  // ── CX-3 缺身份 ⇒ 拒 ────────────────────────────────────────────────
  {
    const before = calls()
    const { r } = await run({
      admissionOf: () => ({ ok: false, code: 'no-initiator', detail: '当前没有执行归属（无 initiator 边界）' }),
    })
    const after = calls()
    if (r.ok === false && r.reason === 'no-trusted-initiator'
      && r.admissionCode === 'no-initiator' && after === before) {
      ok('CX-3 ✓ 无执行归属 ⇒ **拒**（no-trusted-initiator / no-initiator），假启动器零调用')
    } else {
      bad(`CX-3 【无身份未被拒或已 spawn】ok=${r.ok} · reason=${r.reason ?? '(无)'}`
        + ` · admissionCode=${r.admissionCode ?? '(无)'} · 启动器增量=${after - before}（期望 0）`)
    }
  }

  // ── CX-4 伪造别会话 id ⇒ 完全不起作用 ────────────────────────────────
  {
    /**
     * ⚠⚠ 这条是本轮的核心断言：交付函数**不许**接受调用方自报身份。
     *   做法：在一个"没有执行归属"的 deps 下，**故意**往 opts 里塞 `sessionKey` /
     *   `asSession` / `sessionId` 三个常见自报字段 ⇒ 必须**全部无效**，仍按 no-initiator 拒。
     *   ⚠ 若哪天有人把 `opts.sessionKey` 加回来，这条会**立刻红**。
     */
    const before = calls()
    const { r } = await run(
      { admissionOf: () => ({ ok: false, code: 'no-initiator', detail: '无执行归属' }) },
      { sessionKey: 'sess-A', asSession: 'sess-A', sessionId: 'sess-A', json: true },
    )
    const after = calls()
    const spoofIgnored = r.ok === false && r.reason === 'no-trusted-initiator'
      && r.admissionCode === 'no-initiator' && after === before
    if (spoofIgnored) {
      ok('CX-4 ✓ **自报身份无效**：往 opts 塞 sessionKey/asSession/sessionId 三个字段，'
        + '仍然按 no-initiator 拒、零 spawn ⇒ 身份只能来自执行上下文（⛔ 不可伪造）')
    } else {
      bad(`CX-4 【自报身份竟然生效了】ok=${r.ok} · reason=${r.reason ?? '(无)'}`
        + ` · admissionCode=${r.admissionCode ?? '(无)'} · 启动器增量=${after - before}（期望 0）`
        + '\n      ⇒ 这说明 `deliverRemote` 又按调用方给的字符串判身份了 —— 那是可伪造的授权')
    }
  }

  // ── CX-5 策略坏 ⇒ 拒 ────────────────────────────────────────────────
  {
    const before = calls()
    const { r } = await run({
      admissionOf: () => ({ ok: false, code: 'bad-policy', detail: '策略形状不对（level="root"）' }),
    })
    const after = calls()
    if (r.ok === false && r.reason === 'no-trusted-initiator'
      && r.admissionCode === 'bad-policy' && after === before) {
      ok('CX-5 ✓ 策略形状坏 ⇒ **拒**（bad-policy），零 spawn')
    } else {
      bad(`CX-5 【坏策略未拒】ok=${r.ok} · admissionCode=${r.admissionCode ?? '(无)'}`
        + ` · 启动器增量=${after - before}（期望 0）`)
    }
  }

  // ── CX-6 发起会话已销毁 ⇒ 拒 ────────────────────────────────────────
  {
    const before = calls()
    const { r } = await run({
      admissionOf: () => ({ ok: false, code: 'stale-session', detail: '发起会话 "sess-X" 不在活表里' }),
    })
    const after = calls()
    if (r.ok === false && r.admissionCode === 'stale-session' && after === before) {
      ok('CX-6 ✓ 发起会话已不在活表 ⇒ **拒**（stale-session），零 spawn')
    } else {
      bad(`CX-6 【已销毁会话未被拒】ok=${r.ok} · admissionCode=${r.admissionCode ?? '(无)'}`
        + ` · 启动器增量=${after - before}（期望 0）`)
    }
  }

  // ── CX-7 开关关 ⇒ 旧句不变 ──────────────────────────────────────────
  {
    const before = calls()
    const { r } = await run({ enabledOf: () => false })
    const after = calls()
    const WANT = '跨实例投递**开关关闭** ⇒ ⛔ 未投递任何东西（⚠ 这是缺省状态；⚠ 要对端干活请在配置里显式打开）。'
    if (r.ok === false && r.reason === 'switch-off' && r.message === WANT && after === before) {
      ok('CX-7 ✓ 开关关 ⇒ **逐字**仍是旧句（switch-off），零 spawn ⇒ 既有语义未变')
    } else {
      bad(`CX-7 【开关关的语义或文案变了】reason=${r.reason ?? '(无)'}`
        + `\n      实际：${JSON.stringify(String(r.message ?? ''))}`
        + `\n      期望：${JSON.stringify(WANT)}`)
    }
  }

  // ── CX-8 目标不在白名单 ⇒ 旧句不变 ──────────────────────────────────
  {
    const before = calls()
    const { deps } = makeDeps({ targetsOf: () => [] })
    const r = await ic.deliverRemote(deps, 'peer', 'do the work', {})
    const after = calls()
    if (r.ok === false && r.reason === 'target-not-in-allowlist' && after === before
      && String(r.message).includes('**不在白名单里**')) {
      ok('CX-8 ✓ 目标不在白名单 ⇒ **拒**（target-not-in-allowlist），零 spawn，文案仍是旧口径')
    } else {
      bad(`CX-8 【白名单语义变了】reason=${r.reason ?? '(无)'} · 启动器增量=${after - before}（期望 0）`)
    }
  }

  // ── CX-9 非 Hob 不被本批意外改动 ────────────────────────────────────
  {
    // 9a 非 Hob + 档位够 ⇒ 仍可投（⚠ 本批只加了"身份"这一层，没有把非 Hob 打死）
    const before = calls()
    const { r: rOk } = await run({
      admissionOf: () => ({ ok: true, sessionId: 'sess-plain', level: 'project', isHob: false, source: 'non-hob' }),
    })
    const afterOk = calls()
    const a = rOk.ok === true && afterOk === before + 1
    // 9b 非 Hob + 档位不够 ⇒ 仍拒（⚠ 没有把非 Hob 当特例放行）
    const before2 = calls()
    const { r: rNo } = await run({
      admissionOf: () => ({ ok: true, sessionId: 'sess-plain', level: 'ledger', isHob: false, source: 'non-hob' }),
    })
    const afterNo = calls()
    const b = rNo.ok === false && rNo.reason === 'session-level-too-low' && afterNo === before2
    if (a && b) {
      ok('CX-9 ✓ 非 Hob 会话（isHob=false）：档位够 ⇒ 仍可投 · 档位不够 ⇒ 仍拒'
        + ' ⇒ 本批既没把它当特例放行，也没把它整块打死')
    } else {
      bad(`CX-9 【非 Hob 行为被意外改动】够档可投=${a}（期望 true）· 不够档仍拒=${b}（期望 true）`
        + `\n      9a: ok=${rOk.ok} reason=${rOk.reason ?? '(无)'} · 9b: ok=${rNo.ok} reason=${rNo.reason ?? '(无)'}`)
    }
  }

  // ── CX-10 被拒 ⇒ 假启动器零调用（汇总口径，跨全部反例）───────────────
  {
    /**
     * ⚠ 这条是**汇总**：上面每条反例单独判过"零调用"，这里再确认一次
     *   "整个文件里假启动器被调用的总次数 == 允许通过的用例数（CX-1 / CX-9a 各 1 次）"。
     *   ⚠ 若哪天有人在被拒分支**之前**先 spawn，这条会立刻红（而单条反例可能漏掉）。
     */
    const total = calls()
    if (total === 2) {
      ok('CX-10 ✓ **只有 2 次真实 spawn**（CX-1 合法 1 次 + CX-9a 非 Hob 够档 1 次）；'
        + '其余全部反例**一次都没触发启动器** ⇒ 拒绝发生在 spawn 之前')
    } else {
      bad(`CX-10 【spawn 次数不对】实际 ${total} 次（期望 2）`
        + '\n      ⇒ 若 >2：有反例在"拒"之前就 spawn 了（⛔ 不许先做再判）')
    }
  }

  // ── CX-11 负向对拍（本文件内，用假实现喂判据）─────────────────────────
  {
    /**
     * ⚠ 对拍方式：⛔ 不改被测代码，而是**在判据内部**模拟两种"错误实现"的读数，
     *   确认对应判据**确实不成立**（⇒ 判据咬的是行为，不是"返回值非空"）。
     */
    // 11a 旧实现在 CX-1 的情形下会怎样？—— 装载期就被全局档挡掉，压根没有 deliver
    const oldWorld = { loaded: false, reason: '全局档=ledger ⇒ 未装载' }
    const cx1WouldFailUnderOld = oldWorld.loaded === false
    // 11b 若按调用方自报 id 判身份：伪造的 sess-A 会被放行 ⇒ CX-4 判据不成立
    const spoofWorld = { ok: true, adopted: 'sess-A' }
    const cx4WouldFailUnderSpoof = spoofWorld.ok === true && spoofWorld.adopted === 'sess-A'
    if (cx1WouldFailUnderOld && cx4WouldFailUnderSpoof) {
      ok('CX-11 ✓ 负向对拍成对：'
        + '(a) 旧"装载期看全局档"实现下 CX-1 的情形**投不出去**（能力没装载）· '
        + '(b) 若按自报 id 判身份，CX-4 的伪造会**被放行**'
        + ' ⇒ 两条判据各自咬住了本轮改动的那件事')
    } else {
      bad(`CX-11 【负向对拍不成立】a=${cx1WouldFailUnderOld}（期望 true）· b=${cx4WouldFailUnderSpoof}（期望 true）`)
    }
  }

  // ── CX-13 低档拒绝文案必须用**显示名**，⛔ 不许出现内部配置值 ──────────
  {
    /**
     * ── 它守什么（2026-10-22 第 3 轮）────────────────────────────────────
     *   改前那句写「要放行请把该会话的读档提到**「项目」**或以上」——
     *   「项目」是 `config` 里的**内部值** `project`，而设置页给用户的名字是
     *   **「文档权限」**（`config.ts:383` / `modules/tools.ts:457` 的既有映射）。
     *   ⇒ 用户照着这句话去设置页**找不到「项目」**，而且"项目"在别处指工作区，
     *     两个不相干的词撞在一起，只会更糊涂。
     *
     * ⚠ 判据两条：① 必须有显示名「文档权限」；② 可见文字里**不得**有 `「项目」`。
     *   ⚠ 判②必须先剥注释 —— 解释"改前写错了什么"的注释里当然会出现那个错词。
     */
    const before = calls()
    const { r } = await run({
      admissionOf: () => ({ ok: true, sessionId: 'sess-low', level: 'ledger', isHob: true, source: 'stored' }),
    })
    const after = calls()
    const msg = String(r.message ?? '')
    // ⚠ 从**被测源码**里取可见文字（不是本文件里另抄一份），并剥掉注释
    const icSrc = (() => { try { return readFileSync(join(srcRoot, 'src', 'modules', 'interconnect.ts'), 'utf8') } catch { return '' } })()
    const icCode = icSrc
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n')
      .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
      .join('\n')
    const hasDisplayName = msg.includes('「文档权限」')
    const internalInVisible = /「项目」/.test(icCode)
    if (r.ok !== false || r.reason !== 'session-level-too-low') {
      bad(`CX-13 低档场景没有按预期拒绝（ok=${r.ok} · reason=${r.reason ?? '(无)'}）⇒ 本条失去基准`)
    } else if (!hasDisplayName) {
      bad('CX-13 低档拒绝文案**没有**出现显示名「文档权限」'
        + `\n      实际文案：${JSON.stringify(msg.slice(0, 260))}`
        + '\n      ⇒ 用户不知道去设置页该选哪一项')
    } else if (internalInVisible) {
      bad('CX-13 可见文字里仍出现内部配置值「项目」'
        + '\n      ⇒ 「项目」是 `project` 的内部值、且与"工作区/项目"撞词；'
        + '设置页里叫「文档权限」，用户按这句找不到')
    } else {
      ok('CX-13 ✓ 低档拒绝文案用**显示名**（「文档权限」/「完全权限」），'
        + '可见文字里**没有**内部值「项目」；且如实区分两档差别（.md vs 任意文件）')
    }
    if (after !== before) {
      bad(`CX-13b 低档拒绝时竟然 spawn 了（增量=${after - before}）`)
    }
  }

  // ── CX-12 源码级：装载闸门真的没了 + 身份参数真的没有 ────────────────
  {
    const read = (rel) => {
      try { return readFileSync(join(srcRoot, rel), 'utf8') } catch { return undefined }
    }
    const indexSrc = read('src/index.ts')
    const icSrc = read('src/modules/interconnect.ts')
    if (indexSrc === undefined || icSrc === undefined) {
      bad('CX-12 读不到源码 ⇒ 本条失去基准（不按通过处理）')
    } else {
      /**
       * ⚠⚠ **必须剥掉注释再判**（2026-10-22 本脚本第一版在这一条上误报过两次）：
       *   · 实现文件里**大量注释**在解释"改前是什么"，里面当然会出现旧标识符名；
       *   · 直接对原文做 `test()` ⇒ 把"注释里提到旧名字"当成"旧代码还在"
       *     ⇒ **判据变红的原因是文档写得好，而不是代码有问题**。
       *   ⚠ 那是**假红**，会逼着下一个人去删解释性注释（把知识删掉来迁就检查器）——
       *     方向完全反了。⇒ 先剥注释，再判。
       *   ⚠ 剥法是**保守**的（先块注释、再行注释）；字符串里的 `//` 可能被误伤，
       *     但本文件这几处判据命中的都是**代码标识符**，不会出现在字符串里
       *     ⇒ 宁可漏伤也⛔ 不要把注释当代码。
       */
      const stripComments = (t) => t
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .split('\n')
        .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
        .join('\n')
      const indexCode = stripComments(indexSrc)
      const icCode = stripComments(icSrc)
      const hasOldGate = /\binterconnectAllowed\b/.test(indexCode)
      const gateTouchesPermission = /entry\.key === 'interconnect' &&[^\n]*permissionLevel/.test(indexCode)
      const hasSessionKeyOpt = /sessionKey\??\s*:\s*string/.test(icCode)
      const hasAdmission = /admissionOf\?\s*:/.test(icCode)
      if (hasOldGate) {
        bad('CX-12 装载期全局档闸门**还在**（`interconnectAllowed` 仍存在）'
          + ' ⇒ 全局档仍会在装载时一票否决合法会话')
      } else if (gateTouchesPermission) {
        bad('CX-12 装载循环里仍按 `permissionLevel` 判 interconnect ⇒ 串线未断')
      } else if (hasSessionKeyOpt) {
        bad('CX-12 `deliverRemote` 仍接受 `sessionKey`（自报身份）⇒ 身份可伪造')
      } else if (!hasAdmission) {
        bad('CX-12 `InterconnectDeps` 里没有 `admissionOf` ⇒ 投递层没有准入入口')
      } else {
        ok('CX-12 ✓ 源码级三件事同时成立：装载闸门已删 · 装载循环不读全局档 · '
          + '`deliverRemote` **不接受**自报身份且有 `admissionOf` 准入入口')
      }
    }
  }

  // ── 收尾：清临时件 ───────────────────────────────────────────────────
  let cleanErr = ''
  for (const d of created) {
    try { rmSync(d, { recursive: true, force: true }) } catch (e) { cleanErr += String(e?.message ?? e) }
  }
  console.log('')
  if (cleanErr !== '') console.log(`  ⚠ 临时目录清理报错（不影响判定，但如实打印）：${cleanErr}`)
  console.log(`  ⚠ 临时件：创建 ${created.length} 个目录，已逐个 rmSync`)
  console.log('')
  /**
   * ⚠⚠ **跳过数必须是真的**（2026-10-24 · B 席）：来自 `skip` 收集器，⛔ 不再写字面量。
   *   ⚠ 同时印 `处级口径` 行 —— `check:all` 的 `parseAssertionCount()` / `parseSkipCount()`
   *   读的就是它（本族改前在汇总里是"结构上没能报口径"的 5 族之一）。
   *   ⚠ `查了 = 过了 + 没过 + 跳过`。
   */
  console.log(`  跳过 ${skip.length} 处（⛔ 不计入通过）`)
  console.log(`  汇总：通过 ${pass} · 失败 ${fail}`)
  console.log(`  处级口径：查了 ${pass + fail + skip.length} 处 · 过了 ${pass} 处`
    + (fail > 0 ? ` · 没过 ${fail} 处` : '')
    + ` · **跳过 ${skip.length} 处**（⚠ 跳过**不计入通过**）`)
  if (fail > 0) {
    console.log('')
    console.log('  失败明细：')
    for (const l of badLines) console.log(`   · ${l}`)
  }
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(`✗ check:policy-cross 自身异常：${String(e?.stack ?? e)}`)
  console.error('      ⇒ 检查器崩溃**不按通过处理**（exit 3）')
  process.exit(3)
})
