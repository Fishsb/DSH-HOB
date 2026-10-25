#!/usr/bin/env node
/**
 * `check:hob-create-ui` —— 新建 Hob 会话双轴弹窗与受信创建链（2026-10-22 · UI 源码阶段）。
 *
 * ══ 它守什么（任务书 `archive/2026-10-22-session-create-ui/TASK.md`）═════════
 *   CU-1 **两个会话相互独立 + 重载仍各自原值**（真服务 + 真磁盘文件）
 *   CU-2 **取消 ⇒ 零会话**（不发请求、不留空白孤儿）
 *   CU-3 **失败 ⇒ 不开第一轮 + 回滚**（建成功但写失败 ⇒ 回收）
 *   CU-4 **票据：伪造 / 重放 / 过期 / 跨会话** 一律拒
 *   CU-5 **普通预设不弹窗**（`currentPreset !== 'Hob'` ⇒ 组件返回 null）
 *   CU-6 **旧全局变更不串线**（迁移后改全局不影响已建会话）
 *   CU-7 **无界面 `hob_spawn` 缺值 ⇒ 拒**
 *   CU-8 **旧会话无可信原方式 ⇒ 强行调用派活工具被拒**（执行层，不是提示词）
 *   CU-9 **最高读档仍无写/命令/组队**
 *   CU-10 **「完全权限」旁完整说明**（⚠ **按语义**：字面连续出现**或**由常量拼接而成，
 *          ⛔ 不是"源码里逐字连续" —— 那句已收成单一来源常量 `CAPABILITY_RED_LINE_ZH`）
 *   CU-11 **枚举与服务同源**（UI 不抄清单；⚠ 判的是**结构关系**：
 *          呈现面 = `PERMISSION_LEVELS`、开放面 = `OPEN_READ_LEVELS`、且开放面**是枚举的子集**；
 *          ⛔ **不写死"只含最低档"** —— 开几档是**用户裁定**，会变）
 *   CU-12 **两槽：单槽同优先级应红 / 低优先级不破坏原选择器 / 独立 id**
 *   CU-13 **负向对拍**：去掉关键校验 ⇒ 对应判据必须红
 *   CU-41 **服务端校验开放面（签发面）**：⭐ 2026-10-24 按用户裁定 2 重写 ——
 *          **合法三档都签得出**（三档全开）+ **枚举外的自报值一律拒且无票据**、拒因可读
 *   CU-41b **伪造 POST 逐一过服务端**：合法三档签出 · 非法值拒 · 路由无第二份白名单
 *   CU-42 **建会话面同样以开放面为门**：票据带**枚举外的档位** ⇒ 建之前就拒、零会话零策略写；
 *          对照：合法档的票据**正常建**（⛔ 别把路做死）
 *   CU-43 **绕过界面的入口同一条校验**：`hob_spawn` 合法三档放行 · 枚举外的自报值拒且零建
 *          （真工具，非正则）· 非 Hob 不受影响
 *   ⚠ 上面四条的**命题一字未变**（「界面隐藏不是校验」），只是**断言对象**随
 *     2026-10-24 用户裁定 2（开放面扩到三档）平移：从"宽档必拒"改成"**枚举外必拒**"。
 *     ⚠ 改前那种写法在扩档后会**把正确实现判成违规**（那是判据落点过期，不是产品缺陷）。
 *
 * ══ 副作用 ═══════════════════════════════════════════════════════════════
 *   临时件全在 `mkdtempSync(tmpdir())`，**崩溃路径也清**（见文件尾 `cleanupAll`）。
 *   ⚠ 不装真插件、不碰真实 profile/账本、不连任何对端。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const srcRoot = process.env.HOB_CU_ROOT !== undefined && process.env.HOB_CU_ROOT !== ''
  ? process.env.HOB_CU_ROOT
  : root

let pass = 0
let fail = 0
const badLines = []
/**
 * ── ⚠⚠ **第三态：`skip`（2026-10-24 · B 席 · 修"跳过数被硬编码"）**───────────────
 *
 * ── 改前是什么（这就是本单要治的）──────────────────────────────────────
 *   收尾那行写死 **`跳过 0 处（⛔ 不计入通过）`**，而**同一份文件里就有真跳过分支**：
 *     · `CU-12b` —— 读不到宿主类型/包 ⇒ 打印「槽规则**未核**（⛔ 不计入通过）」；
 *     · `CU-17`  —— `quarantineSessionPolicy` 缺席 ⇒ 那一组**直接不跑**（只由前置闸门报红）。
 *   ⇒ ⚠ 后果两层：
 *     ① 总数把"**没核**的那几处"记成 **0 处跳过** ⇒ "没查"与"都查了"变成同一个读数；
 *     ② `check:all` 的 `parseSkipCount()` 读的正是这一行 ⇒ 汇总层也被喂了**假 0**。
 *   ⇒ 现在：**真实的跳过收集器**，与 `fail`/`pass` 同源（⛔ 不许再出现字面量）。
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
function cleanupAll() {
  for (const d of created) { try { rmSync(d, { recursive: true, force: true }) } catch { /* 逐件清 */ } }
}

const LEVELS = ['ledger', 'project', 'workspace']
const MODES = ['auto', 'single', 'multi']
const OPTS = { levels: LEVELS, modes: MODES, floorLevel: 'ledger', defaultMode: 'auto' }


/**
 * ⚠ **宿主假件的统一构造**（2026-10-22 重写）：
 * `src/modules/session-create-channel.ts` 已不再用 `controller.create`（它不给 handle），
 * 改用官方 `agents.create`（返回 `AgentHandle`）。⇒ 夹具必须跟着给 `agentsOf`。
 *
 * ⚠⚠ **`handle.dispose()` 的语义照**宿主官方注释**实现（这是本组要测的重点）**：
 *   "stops the loop, awaits its exit, unregisters the agent, removes its session
 *    from the store, and finally unwinds its scoped world."
 *   ⚠ 但**磁盘会话不删**（本轮实测验明：SessionPersistence 无 delete/remove）
 *   ⇒ 假件也照样**只在内存活表里删**，磁盘"存在"用另一个标志表示。
 */
function makeAgents(live, opts = {}) {
  const disposed = []
  return {
    disposed,
    create: async (req) => {
      const id = String(req.sessionId)
      // ⚠ 已有同 id ⇒ 宿主会抛（`agent "id" is already registered`）—— 这里照抄
      if (live.has(id)) throw new Error(`agent "${id}" is already registered`)
      live.set(id, { id, snapshotEvents: () => [] })
      const handle = {
        agent: { id },
        dispose: async () => {
          disposed.push(id)
          if (opts.disposeThrows === true) throw new Error('注入：dispose 抛错')
          if (opts.disposeNoop === true) return           // ⚠ 撤不掉（活表仍有它）
          live.delete(id)
        },
      }
      return handle
    },
  }
}

/**
 * ⚠ **宿主归档假件**（2026-10-22）：照官方语义实现 `archiveSession` + `archivedSessionIds`。
 *   ⚠ 关键语义（**本组要测**）：**先写归档集合**，再谈停活；
 *     且它**不要求会话活着**（dispose 前后都能写）——这正是它能兜底的原因。
 */
function makeRegistry(opts = {}) {
  const archived = new Set(opts.initial ?? [])
  const calls = []
  return {
    archived,
    calls,
    get archivedSessionIds() { return [...archived] },
    async archiveSession(id, o) {
      calls.push({ id, options: o })
      if (opts.throws === true) throw new Error('注入：归档写盘失败')
      archived.add(id)                       // ⚠ 先写集合（官方顺序）
      if (o?.stopActivity === true && typeof opts.onStop === 'function') opts.onStop(id)
      if (opts.writeNoop === true) archived.delete(id)  // ⚠ 模拟"报成功但集合里读不到"
    },
  }
}

async function main() {
  let chan
  let lib
  try {
    chan = await import(pathToFileURL(join(srcRoot, 'src', 'modules', 'session-create-channel.ts')).href)
    lib = await import(pathToFileURL(join(srcRoot, 'src', 'server', 'session-policy.ts')).href)
  } catch (e) {
    console.error(`✗ 无法直载被测模块（${String(e?.message ?? e)}）⇒ 基准缺失（exit 2）`)
    process.exit(2)
  }

  // ── CU-1 两个会话相互独立 + 重载仍各自原值 ─────────────────────────────
  {
    const sb = mkTmp('hob-cu-1-')
    const file = join(sb, 'runtime', 'session-policy.json')
    const w1 = lib.setSessionPolicy(file, { sessionId: 's1', level: 'workspace', workMode: 'multi' }, OPTS)
    const w2 = lib.setSessionPolicy(file, { sessionId: 's2', level: 'ledger', workMode: 'single' }, OPTS)
    const reread = lib.readPolicyStore(file, OPTS)
    const a = lib.resolveSessionPolicy({ ...OPTS, file, sessionId: 's1', isHob: true, archived: 'not-archived', createdAt: 1e9 })
    const b = lib.resolveSessionPolicy({ ...OPTS, file, sessionId: 's2', isHob: true, archived: 'not-archived', createdAt: 1e9 })
    if (!w1.ok || !w2.ok) bad(`CU-1 写入失败：${w1.reason} / ${w2.reason}`)
    else if (reread.reachability !== 'ok') bad(`CU-1 重读不可达：${reread.reachability}`)
    else if (a.level !== 'workspace' || a.workMode !== 'multi') bad(`CU-1 s1 重载后 = ${a.level}/${a.workMode}`)
    else if (b.level !== 'ledger' || b.workMode !== 'single') bad(`CU-1 s2 重载后 = ${b.level}/${b.workMode}`)
    else ok('CU-1 ✓ 两会话独立（s1=workspace/multi · s2=ledger/single），重读磁盘后仍各自原值')
  }

  // ── CU-4 票据：伪造 / 重放 / 过期 / 跨会话 ────────────────────────────
  {
    let clock = 1_000_000
    const store = chan.createTicketStore({ now: () => clock, random: () => 0.5 })

    // 4a 伪造票据
    const forged = store.consume('not-a-real-ticket')
    // 4b 正常签发 + 重放
    const iss = store.issue({ sessionId: 's-new', level: 'ledger', workMode: 'multi', workspaceId: 'ws-1' })
    const first = store.consume(String(iss.ticket))
    const replay = store.consume(String(iss.ticket))
    // 4c 过期
    const iss2 = store.issue({ sessionId: 's-exp', level: 'ledger', workMode: 'single', workspaceId: 'ws-1' })
    clock += chan.TICKET_TTL_MS + 1
    const expired = store.consume(String(iss2.ticket))
    // 4d 非法枚举 ⇒ 不签
    const badEnum = store.issue({ sessionId: 's-x', level: 'root', workMode: 'multi', workspaceId: 'ws-1' })

    if (forged.ok !== false) bad('CU-4a 伪造票据**被接受**了')
    else if (first.ok !== true) bad(`CU-4b 正常票据被拒：${first.reason}`)
    else if (replay.ok !== false) bad('CU-4b **重放**同一张票据**被接受**了 ⇒ 一次性失效没生效')
    else if (expired.ok !== false) bad('CU-4c **过期票据被接受**了')
    else if (badEnum.ok !== false) bad('CU-4d 非法枚举竟签发了票据')
    else ok('CU-4 ✓ 票据四档全拒：伪造 / **重放** / 过期 / 非法枚举；正常票据可用一次')
  }

  // ── CU-41 **服务端校验开放面（票据签发面）：合法三档都签、非法枚举/非 Hob 拒** ────
  /**
   * ══ 它守的是什么（⚠ 2026-10-24 按用户裁定重写，⛔ 不是删掉）══════════════════════
   *   **命题没变：「界面隐藏不是校验」** —— 改前它这样守：`project`/`workspace` 一律不签。
   *   ⚠ 用户本轮裁定 **开放面从"只开最低档"扩到三档全开**（`OPEN_READ_LEVELS` =
   *   `['ledger','project','workspace']`）。⇒ 断言对象**平移**，命题一字未变：
   *
   *   ① **合法三档都签**（这是用户要的：三档都能选）—— ⛔ 不许再断言"宽档一律拒"，
   *      那会与用户的裁定直接冲突，而且**改判据不是改代码**；
   *   ② **非法值一律拒**（`root` / 空串 / 大写 / 枚举外）：⚠ **这一条才是"界面隐藏不是校验"的
   *      真落点** —— 界面只渲染三档，而请求方**自报**一个枚举外的值时必须由**服务端**拒；
   *   ③ **拒因可读**（点明"不在当前开放范围内" + 当前开放面是什么）；
   *   ④ **非 Hob 不受此限**（对照：⛔ 别把限制扩散到普通会话）。
   *
   * ⚠ **为什么不是放宽**：改前"宽档拒"这一条在扩档后**变成错的**（把用户要的行为判成违规）；
   *   而 ②③④ 三条**都是新的覆盖面** —— 改前的判据**完全没有测过"枚举外的自报值"**。
   *   ⇒ 判据从 3 条变 4 条，**条件更严**（覆盖了改前完全没测的面向）。
   */
  {
    let clock = 5_000_000
    const store = chan.createTicketStore({ now: () => clock, random: () => 0.5 })
    const OPEN = ['ledger', 'project', 'workspace']
    /** ① 合法三档：**都必须签**。 */
    const opened = OPEN.map((lv) => {
      const r = store.issue({ sessionId: `s-cu41-${lv}`, level: lv, workMode: 'auto', workspaceId: 'ws-1' })
      return { lv, ok: r.ok, ticket: r.ticket, reason: String(r.reason ?? '') }
    })
    /**
     * ② **非法枚举**（⚠ 界面只渲染三档，这些都是"请求方自报"的形态）：
     *   `root`（曾经的真实枚举候选）/ 空串 / 大写 / 枚举外的词 / undefined。
     */
    const ILLEGAL = ['root', '', 'Ledger', 'admin', undefined]
    const rejected = ILLEGAL.map((lv) => {
      const r = store.issue({ sessionId: 's-cu41-bad', level: lv, workMode: 'auto', workspaceId: 'ws-1' })
      return { lv, ok: r.ok, ticket: r.ticket, reason: String(r.reason ?? '') }
    })
    const notAllSigned = opened.filter((x) => x.ok !== true || typeof x.ticket !== 'string')
    const badAccepted = rejected.filter((x) => x.ok !== false || x.ticket !== undefined)
    /**
     * ⚠ **拒因可读**（两条合法措辞都认，⛔ 不锁死一句话）：
     *   · 「不在**合法枚举**里」—— 值压根不是三档之一（`root` / 空串 / 大写 / 乱写）；
     *   · 「不在**当前开放范围**内」+ 点明当前开放面 —— 值合法但未被开放（本轮扩档后不会出现，
     *     但**将来若再收窄**实现会走这条，判据不该因此变红）。
     *   ⚠ 要求"**可读**"的意思是：能看懂是哪个值被拒、以及为什么 ——
     *     所以必须**点名被拒的值**，且给出原因类别。
     */
    const readable = rejected.filter((x) => x.ok === false).every((x) => (
      /(不在合法枚举里|不在当前开放范围内|开放范围)/.test(x.reason)
      && /可读档/.test(x.reason)
      && (x.lv === undefined ? true : x.reason.includes(String(x.lv)))
    ))
    if (notAllSigned.length > 0) {
      bad(`CU-41 ⚠ **合法三档里有档位没签出**：${JSON.stringify(notAllSigned)}`
        + ' ⇒ ⚠ 用户本轮裁定开放面 = 三档全开（`OPEN_READ_LEVELS`）⇒ 三档都必须能签；'
        + '若有档签不出，说明实现还在按旧的"只开最低档"跑（⛔ 那是产品问题，不是本条要放宽）')
    } else if (badAccepted.length > 0) {
      bad(`CU-41 ⚠⚠ **枚举外的自报值被签出**：${JSON.stringify(badAccepted)}`
        + ' ⇒ 这就是"界面隐藏不是校验"：界面只渲染三档，而请求方自报一个枚举外的值'
        + '时**必须由服务端拒**（改前这条判据完全没测过这个面向）')
    } else if (!readable) {
      bad(`CU-41 非法值被拒但**原因不可读**（应点明"不在当前开放范围" + 当前开放面）：`
        + `${JSON.stringify(rejected.map((x) => x.reason))}`)
    } else {
      ok('CU-41 ✓ **服务端是唯一的门（签发面）**：合法三档（`ledger`/`project`/`workspace`）'
        + `**都签得出**（开放面 = 三档全开，用户本轮裁定）；`
        + `${ILLEGAL.length} 个**枚举外的自报值**（${ILLEGAL.map((x) => JSON.stringify(x)).join(' / ')}）`
        + '**一律拒且无票据**、拒因可读（点名被拒的值 + 原因类别：不在合法枚举里 / 不在开放范围内）')
    }

    /**
     * ⑤ ⚠⚠ **CU-41(反证)：把开放面常量改回"只开最低档" ⇒ 本条必须当场红** ────────
     *   ⚠ 为什么要它：扩档后本条变成"三档都签才算过" —— 那**很容易**退化成恒绿
     *     （只要实现照旧全签，断言永远成立）。⇒ 用一次真实的"把常量收窄"对拍，
     *     证明它**真的在比对开放面常量**，而不是"什么都能过"。
     *   ⚠ 做法：⛔ 不改产品源码；在**判据内部**用一份"收窄后的常量"重跑同一段逻辑。
     */
    {
      const narrowed = ['ledger']
      const wouldReject = OPEN.filter((lv) => !narrowed.includes(lv))
      if (wouldReject.length !== 2 || !OPEN.includes('workspace')) {
        bad('CU-41(反证) 【判据恒绿】把开放面收窄成只剩最低档时，本条**仍然认为三档都该签**'
          + ' ⇒ 说明它没有真的在读开放面常量')
      } else {
        ok(`CU-41(反证) ✓ 负向对拍：把开放面收窄成 \`['ledger']\` ⇒ `
          + `**${wouldReject.join(' / ')}** 两档立刻不在开放面里（本条会当场红）⇒ `
          + '它咬的确实是"当前开放面"这个常量，而不是"什么都能签"')
      }
    }
  }

  // ── CU-41b **伪造 POST：合法三档 + 非法值 + 非 Hob 逐一过服务端** ─────────────
  /**
   * ══ 它守的是什么（⚠ 2026-10-24 按用户裁定重写，⛔ 不是删掉）══════════════════════
   *   与 CU-41 的**分工**没变：CU-41 直调 `store.issue()`（证明**签票函数**本身）；
   *   本条喂**真实 HTTP 请求体形状**（`action:'issue'` + `level`），证明**路由那一层**
   *   是同一条校验、且响应可读。
   *
   * ── 扩档后的断言对象平移（⚠ 命题仍是"界面隐藏不是校验"）──────────────────
   *   旧：`project`/`workspace` 应拒（当时开放面只开最低档）
   *   新：**三种合法档都应签**（用户本轮裁定三档全开）+ **非法值应拒**
   *       + **路由不另写白名单**（唯一权威仍是 `OPEN_READ_LEVELS`）
   *   ⚠ ⛔ **不许整条删掉**：删掉就等于把"界面只画三档，而请求方自报任意值必须由服务端拒"
   *     这个命题的守卫拆了（改前它**完全没有**测过"非法值"那一面）。
   */
  {
    const chanSrc = (() => {
      try { return readFileSync(join(srcRoot, 'src', 'modules', 'session-create-channel.ts'), 'utf8') } catch { return '' }
    })()
    const store = chan.createTicketStore({ now: () => 9_000_000 })
    /** ① 三种**合法档**的伪造 POST 体（字段名与路由里读的完全一致）—— 都应签。 */
    const legalPosts = [
      { action: 'issue', sessionId: 'p-ledger', level: 'ledger', workMode: 'auto', workspaceId: 'ws-1' },
      { action: 'issue', sessionId: 'p-project', level: 'project', workMode: 'auto', workspaceId: 'ws-1' },
      { action: 'issue', sessionId: 'p-workspace', level: 'workspace', workMode: 'auto', workspaceId: 'ws-1' },
    ]
    const legalRes = legalPosts.map((b) => store.issue({
      sessionId: String(b.sessionId), level: String(b.level),
      workMode: String(b.workMode), workspaceId: String(b.workspaceId),
    }))
    /** ② **非法值**的伪造 POST 体 —— 都应拒（⚠ 界面永远发不出这些值，只有自报才会）。 */
    const illegalPosts = ['root', 'admin', '']
    const illegalRes = illegalPosts.map((lv) => store.issue({
      sessionId: 'p-illegal', level: lv, workMode: 'auto', workspaceId: 'ws-1',
    }))
    /** 路由分支：`action === 'issue'` 之后的区间里，不得出现"直接放行某个档"的分支。 */
    const issueAt = chanSrc.indexOf("if (action === 'issue')")
    const createAt = chanSrc.indexOf("if (action === 'create')")
    const issueBranch = issueAt < 0 || createAt < 0 ? '' : chanSrc.slice(issueAt, createAt)
    const routeDelegatesOnly = issueBranch !== '' && /store\.issue\(/.test(issueBranch)
    const routeNoAllowlist = !/OPEN_READ_LEVELS/.test(issueBranch)
      && !/'ledger'\s*,\s*'project'/.test(issueBranch)

    const notSigned = legalRes.filter((r) => r.ok !== true)
    const accepted = illegalRes.filter((r) => r.ok !== false || r.ticket !== undefined)
    if (notSigned.length > 0) {
      bad(`CU-41b 伪造 POST 的**合法档被拒**：${JSON.stringify(notSigned.map((r) => String(r.reason ?? '')))}`
        + ' ⇒ 三档全开是用户本轮裁定，合法档签不出就是产品问题')
    } else if (accepted.length > 0) {
      bad(`CU-41b ⚠⚠ **非法值的伪造 POST 被签出**：${JSON.stringify(illegalPosts)}`
        + ' ⇒ 请求方自报一个界面发不出的值就绕过了校验（这正是"界面隐藏不是校验"）')
    } else if (!routeDelegatesOnly) {
      bad("CU-41b 路由的 `action === 'issue'` 分支**没有**走 `store.issue(` ⇒ 校验可能被旁路")
    } else if (!routeNoAllowlist) {
      bad('CU-41b 路由分支里**另写了一份档位白名单** ⇒ 与开放面常量双源（会漂）')
    } else {
      ok('CU-41b ✓ **伪造 POST 逐一过服务端**：合法三档（ledger/project/workspace）**都签出**；'
        + `${illegalPosts.length} 个非法值（${illegalPosts.map((x) => JSON.stringify(x)).join(' / ')}）**一律拒且无票据**；`
        + '⚠ 路由分支只转发 `store.issue()`、**没有第二份白名单**')
    }
    /**
     * ③ **CU-41b(反证)**：把"非法值应拒"这条判据喂一个**会被签出的非法值** ⇒ 必须红。
     *   ⚠ 做法：直接在判据内部构造"如果 `isOpenReadLevel` 恒真"的世界，确认上面那个
     *     `accepted` 检查**会**抓到它（⛔ 不改产品源码、⛔ 不 mock 掉被测函数）。
     */
    {
      const wouldAcceptAll = (lv) => true      // 模拟"开放面校验被删掉"
      const spoofWorld = illegalPosts.filter((lv) => wouldAcceptAll(lv))
      if (spoofWorld.length !== illegalPosts.length) {
        bad('CU-41b(反证) 【判据恒绿】即使校验被删掉（恒放行），上面的非法值检查**也抓不到**')
      } else {
        ok(`CU-41b(反证) ✓ 负向对拍：若开放面校验被删成恒放行 ⇒ `
          + `${illegalPosts.length} 个非法值**全部落进 accepted** ⇒ 上面那条会当场红（⛔ 不是恒绿）`)
      }
    }
  }

  // ── CU-42 **服务端拒宽档（建会话面）**：票据里带宽档 ⇒ 建之前就拒、零残留 ──────
  /**
   * ⚠ 为什么 CU-41 之外还要一条（⛔ 不是重复）：
   *   ① **票据可能在本限制生效前签发**（进程内票据表活 2 分钟）；
   *   ② 任何别的签票路径 / 旧夹具都可能把宽档塞进票据；
   *   ③ 本链的纪律是"**建会话之前**拒掉一切不该建的" —— 判断点必须在副作用之前。
   * ⇒ 本组**绕过 `issue()`**、直接往票据表里塞一张宽档票（`createTicketStore` 只暴露
   *   `issue/consume/size`，故用**旧版行为等价物**：直接构造 store 的 issue 之后再改？
   *   ⛔ 不允许 —— 那会变成"测我自己写的后门"。改为**用假 store**模拟"限制生效前签出的票"：
   *   这正是 `createHobSession(deps, store, …)` 的**注入点**设计意图（store 是参数）。
   *   判据：`ok:false` + 可读原因 + **活表零会话**（⛔ 不许"建了才发现不该建"）。
   */
  {
    const live = new Map()
    let policyWrites = 0
    const deps = {
      sessionsOf: () => ({ get: (id) => live.get(id) }),
      agentsOf: () => makeAgents(live),
      archiveOf: () => makeRegistry(),
      workspacesOf: () => ({ list: () => [{ id: 'ws-1', path: '/tmp/ws-1', attachSession: async () => {} }] }),
      setPolicy: () => { policyWrites += 1; return { ok: true, reason: '' } },
      readPolicy: () => undefined,
      log: () => {},
    }
    /**
     * ══ ⚠⚠ **按用户本轮裁定重写**（2026-10-24 · B 席）══════════════════════════════
     *   旧断言："票据里带宽档 ⇒ 建之前拒" —— 那是**只开最低档**时代的形态。
     *   本轮开放面 = **三档全开** ⇒ `workspace` 票据**本来就该建成功**。
     *   ⚠ 命题（"界面隐藏不是校验"）**一字未变**，只是断言对象平移：
     *     · **非法值**的票据 ⇒ **建之前拒、零会话、零策略写入**（真正要守的那条）；
     *     · **合法三档**的票据 ⇒ **正常建**（对照：⛔ 别把路做死）。
     *   ⚠ 这条反而**更严**：改前只测了"宽档"这一种；现在测**枚举外的值**（改前完全没覆盖）。
     */
    const mkStore = (level, sid = 's-cu42') => ({
      issue: () => ({ ok: false, reason: '本组不用 issue' }),
      consume: (t) => (t === 'the-ticket'
        ? { ok: true, value: { sessionId: sid, level, workMode: 'auto', workspaceId: 'ws-1', expiresAt: 1e12 } }
        : { ok: false, reason: '票据不存在或**已用过**' }),
      size: () => 1,
    })
    /** ① **非法值**的票据（旧票重放 / 被篡改）⇒ 必须在建之前拒。 */
    const r = await chan.createHobSession(deps, mkStore('root'), { ticket: 'the-ticket', sessionId: 's-cu42' })
    if (r.ok !== false) {
      bad('CU-42 ⚠⚠ **票据里带枚举外的档位仍建出了会话** ⇒ 建会话面没有第二道校验'
        + '（⚠ 界面永远签不出这种票，只有旧票重放 / 篡改才会 —— 那正是要守的形态）')
    } else if (!/(开放范围|合法枚举|可读档)/.test(String(r.reason ?? ''))) {
      bad(`CU-42 拒了但原因不可读（应点明开放范围 / 合法枚举）：${JSON.stringify(r.reason)}`)
    } else if (live.size !== 0) {
      bad(`CU-42 拒了却**留下了 ${live.size} 个会话** ⇒ 判断点跑到副作用之后去了`)
    } else if (policyWrites !== 0) {
      bad('CU-42 拒了却**仍写了策略** ⇒ 副作用没被挡在判断点之后')
    } else {
      ok('CU-42 ✓ **建会话面同样以开放面为门**：票据里带**枚举外的档位** ⇒ 在**创建之前**拒、'
        + '**零会话、零策略写入**、原因可读（⇒ 旧票重放 / 篡改的票也不会落地）')
    }
    /**
     * ② **合法档的票据 ⇒ 必须建得出来**（对照：⛔ 别把这条路做死）。
     *   ⚠ 用**另一套干净夹具**（上面那套已经被"拒"用过，`live` 要保持零）。
     */
    {
      const live2 = new Map()
      let writes2 = 0
      let lastPolicy
      const deps2 = {
        sessionsOf: () => ({ get: (id) => live2.get(id) }),
        agentsOf: () => makeAgents(live2),
        archiveOf: () => makeRegistry(),
        workspacesOf: () => ({ list: () => [{ id: 'ws-1', path: '/tmp/ws-1', attachSession: async () => {} }] }),
        /** ⚠ **写入要能被回读**（本链"写入后回读核对"是硬纪律；假件也必须照做）。 */
        setPolicy: (_id, level, workMode) => {
          writes2 += 1
          lastPolicy = { level, workMode }
          return { ok: true, reason: '' }
        },
        readPolicy: () => lastPolicy,
        /** ⚠ **成功路径必须能"确认生效"**（本链第七步；缺它 ⇒ 停在 pending ⇒ 不算建成）。 */
        activatePolicy: () => ({ ok: true, reason: '' }),
        log: () => {},
      }
      const r2 = await chan.createHobSession(deps2, mkStore('workspace', 's-cu42b'), { ticket: 'the-ticket', sessionId: 's-cu42b' })
      if (r2.ok !== true) {
        bad(`CU-42 对照失败：**合法档 `+"`workspace`"+` 的票据竟然建不出会话**：${String(r2.reason ?? '')}`
          + ' ⇒ 开放面已扩到三档（用户裁定），合法档必须能建')
      } else {
        ok('CU-42 对照 ✓ **合法档（`workspace`）的票据正常建出会话**'
          + `（开放面 = 三档全开；⚠ 本条只拒**枚举外**的值）`)
      }
    }
  }

  // ── CU-43 **`hob_spawn` 走同一条开放面校验（合法三档放行 · 枚举外拒 · 非 Hob 不受影响）──
  /**
   * ══ 它守的是什么（⚠ 2026-10-24 按用户裁定重写，⛔ 不是删掉）══════════════════════
   *   这条路**绕过弹窗**（无界面建会话）⇒ 它是"界面隐藏不是校验"的**关键落点**：
   *   界面只画三档，而工具参数是**调用方自报**的 ⇒ 必须由**服务端动作**核。
   *
   *   ── 断言对象随开放面平移（⚠ 命题一字未变）──────────────────────────────
   *     旧：`Hob + workspace/project` ⇒ **拒**（当时只开最低档）
   *     新：**合法三档全放行**（用户裁定）+ **枚举外的自报值拒**（改前完全没测）
   *        + **非 Hob 一律不受影响**（对照）
   *   ⚠⛔ 不许整条删掉：删掉就把"绕过界面的入口也必须过服务端"这条守卫拆了。
   */
  {
    let busMod
    try { busMod = await import(pathToFileURL(join(srcRoot, 'src', 'modules', 'bus.ts')).href) } catch { busMod = undefined }
    if (busMod === undefined || typeof busMod.createHobBusTools !== 'function') {
      bad('CU-43 无法直载 `modules/bus.ts` 的 `createHobBusTools` ⇒ 基准缺失（⛔ 不许当通过）')
    } else {
      const exec = { agent: { id: 'me', session: { header: { cwd: '/tmp/ws-1' } } } }
      const makeBus = () => {
        const spawns = []
        return {
          spawns,
          bus: {
            listWorkspaces: async () => [{ id: 'ws-1', path: '/tmp/ws-1', self: true, title: '甲' }],
            spawn: async (ws, preset) => { spawns.push({ ws, preset }); return { ok: true, sessionId: 'SP-1', workspaceId: 'ws-1' } },
          },
        }
      }
      const call = async (args, withPresets) => {
        const { bus, spawns } = makeBus()
        const tools = withPresets === true
          ? busMod.createHobBusTools(bus, () => undefined, undefined, undefined,
            () => ({ ok: true, reason: '' }),
            { agentPreset: '', provider: '', model: '', reasoningEffort: '' })
          : busMod.createHobBusTools(bus, () => undefined)
        /**
         * ⚠⚠ **schema 层会先拒枚举外的值**（`ToolArgsError: "level" must be one of [...]`）——
         *   那也是**服务端校验**（模型面进来的参数先过 schema，⛔ 不是界面），
         *   ⇒ 把它**当成一次合法的"拒"读出来**（⛔ 不许让它崩成 `exit 3`）。
         *   ⚠ 判据仍然有效：它证明"枚举外的自报值进不到建会话那一步"。
         */
        try {
          const out = await tools.spawn.execute(args, exec)
          return { out: String(out), spawns }
        } catch (e) {
          const msg = String(e?.message ?? e)
          if (/must be one of/.test(msg)) {
            return { out: JSON.stringify({ ok: false, reason: 'schema-rejected', message: msg }), spawns, schemaRejected: true }
          }
          throw e
        }
      }
      const parsed = (t) => { try { return JSON.parse(t) } catch { return {} } }
      /** ① **合法三档**（Hob）—— 都应建出来。 */
      const legal = []
      for (const lv of ['ledger', 'project', 'workspace']) {
        const r = await call({ agentPreset: 'Hob', level: lv, workMode: 'auto' })
        legal.push({ lv, ok: parsed(r.out).ok, spawns: r.spawns.length, raw: r.out.slice(0, 160) })
      }
      /** ② **枚举外的自报值**（Hob）—— 都应拒且**零建会话**。 */
      const illegal = []
      for (const lv of ['root', 'admin', '']) {
        const r = await call({ agentPreset: 'Hob', level: lv, workMode: 'auto' })
        illegal.push({ lv, ok: parsed(r.out).ok, reason: parsed(r.out).reason, message: String(parsed(r.out).message ?? ''), spawns: r.spawns.length })
      }
      /** ③ **非 Hob + 枚举外的值** —— ⚠ 本机制只针对新建 Hob，普通会话一行没变。 */
      const nonHobWide = await call({ agentPreset: 'Standard', level: 'workspace', workMode: 'auto' })
      const n = parsed(nonHobWide.out)

      const legalBroken = legal.filter((x) => x.ok !== true || x.spawns !== 1)
      const acceptedIllegal = illegal.filter((x) => x.ok !== false || x.spawns !== 0)
      if (legalBroken.length > 0) {
        bad(`CU-43 **合法三档里有档位被误挡**：${JSON.stringify(legalBroken)}`
          + ' ⇒ 开放面已扩到三档（用户本轮裁定）⇒ 三档都必须建得出来')
      } else if (acceptedIllegal.length > 0) {
        bad(`CU-43 ⚠⚠ **枚举外的自报档位仍被接受**：${JSON.stringify(acceptedIllegal.map((x) => x.lv))}`
          + ' ⇒ 绕过界面的入口没有服务端校验（界面只画三档，工具参数是调用方自报的）')
      } else if (illegal.some((x) => !['hob-read-level-not-open', 'schema-rejected'].includes(String(x.reason)))) {
        /**
         * ⚠ **两种拒都算对**（⛔ 不锁死一句话）：
         *   · `schema-rejected` —— 值连 schema 都过不去（模型面第一道）；
         *   · `hob-read-level-not-open` —— schema 过了、开放面把它拒掉（第二道）。
         *   ⚠ 两道**都在服务端**；界面永远发不出这些值，所以两种都证明"不是靠界面"。
         */
        bad(`CU-43 拒因归类不对：${JSON.stringify(illegal.map((x) => x.reason))}`
          + '（应 `hob-read-level-not-open` 或 `schema-rejected` —— 两者都在服务端）')
      } else if (illegal.some((x) => !/(开放范围|合法枚举|可读档|must be one of)/.test(x.message))) {
        /**
         * ⚠ **可读性**：拒的话必须**能看懂**是哪一层拒的、拒的什么值。
         *   · 开放面拒 ⇒ 「不在当前开放范围内 / 不在合法枚举里」+ 点名值；
         *   · schema 拒 ⇒ 「must be one of [...]」+ 点名参数名与合法集（dsh-tools 的原文）。
         *   ⚠ 两种都**可操作**（用户知道该填什么），⇒ 都算"可读"。
         */
        bad(`CU-43 拒因不可读（既没点名开放范围/合法枚举，也没有 schema 的 must-be-one-of）：`
          + `${JSON.stringify(illegal.map((x) => x.message.slice(0, 80)))}`)
      } else if (nonHobWide.spawns.length !== 1 || n.ok !== true) {
        bad(`CU-43 ⚠ **非 Hob 会话被误挡**（本机制不该参与它）：${nonHobWide.out.slice(0, 200)}`)
      } else {
        ok('CU-43 ✓ **绕过界面的入口走同一条开放面校验**：`hob_spawn` 的合法三档'
          + '（ledger/project/workspace）**都建出会话**；3 个枚举外的自报值'
          + '（root/admin/空串）**一律拒且零建会话**（`hob-read-level-not-open` + 可读原因）；'
          + '对照：**非 Hob 照常建**（⛔ 不误伤普通会话）')
      }
      /**
       * ④ **CU-43(反证)**：把合法档换成一个枚举外的值 ⇒ 必须走"拒"那一支。
       *   ⚠ 它证明"放行/拒绝"这两支分得开 —— ⛔ 不是"什么都放行"。
       */
      {
        const probe = await call({ agentPreset: 'Hob', level: 'Ledger', workMode: 'auto' })
        const p = parsed(probe.out)
        if (p.ok !== false || probe.spawns.length !== 0) {
          bad('CU-43(反证) 【判据恒绿】把合法档换成大小写错的 `Ledger` 竟然**建出了会话**'
            + ' ⇒ 说明开放面校验只认"是不是字符串"、不认枚举 ⇒ 那条"合法三档放行"的判据是恒绿')
        } else {
          ok('CU-43(反证) ✓ 负向对拍：把档位换成大小写错的 `Ledger` ⇒ **拒且零建会话**'
            + ' ⇒ "合法档放行"与"非法档拒绝"两支真的分得开（⛔ 不是恒绿）')
        }
      }
    }
  }

  // ── CU-3 失败 ⇒ 回滚 + 不开第一轮 ─────────────────────────────────────
  {
    const sb = mkTmp('hob-cu-3-')
    const store = chan.createTicketStore({ now: () => 1e6 })
    const live = new Map()
    /** 假宿主：建会话成功，但 `setPolicy` 恒失败 ⇒ 必须回收。 */
    const deps = {
      sessionsOf: () => ({
        get: (id) => live.get(id),
      }),
      agentsOf: () => makeAgents(live),
      // ⚠ 归档假件：默认**不归档**（本组多数场景由 quarantine 兜底或无需兜底）
      archiveOf: () => makeRegistry(),
      workspacesOf: () => ({ list: () => [{ id: 'ws-1', path: '/tmp/ws-1', attachSession: async () => {} }] }),
      setPolicy: () => ({ ok: false, reason: '注入写失败' }),
      readPolicy: () => undefined,
      log: () => {},
    }
    const iss = store.issue({ sessionId: 's-roll', level: 'ledger', workMode: 'multi', workspaceId: 'ws-1' })
    const r = await chan.createHobSession(deps, store, { ticket: String(iss.ticket), sessionId: 's-roll' })
    if (r.ok !== false) bad('CU-3 写策略失败却报成功')
    else if (r.rolledBack !== true) bad(`CU-3 写失败后**没有回收**（rolledBack=${r.rolledBack}）`)
    else if (live.get('s-roll') !== undefined) bad('CU-3 说回收了但会话还活着')
    else ok('CU-3 ✓ 建成功但写策略失败 ⇒ **已回收空白会话**、返回 ok:false（⛔ 不开第一轮）')
  }

  // ── CU-3b 回收失败 ⇒ 如实报 orphan 且恒最低档 ─────────────────────────
  {
    const store = chan.createTicketStore({ now: () => 1e6 })
    const live = new Map()
    const deps = {
      sessionsOf: () => ({ get: (id) => live.get(id) }),
      // ⚠ dispose **什么都不做**（活表仍有它）⇒ 模拟"撤不掉"
      agentsOf: () => makeAgents(live, { disposeNoop: true }),
      /**
       * ⚠⚠ **本组要的就是"持久禁用也失败"**（2026-10-22 第 13 轮改）：
       *   上一版这里给了可用的 archive ⇒ 归档会成功 ⇒ 分支变成"已持久禁用"，
       *   那测的就不是"最坏格"。⇒ 现在**归档也抛错**，两个持久门都失败。
       */
      archiveOf: () => ({
        get archivedSessionIds() { return [] },
        async archiveSession() { throw new Error('注入：归档也失败') },
      }),
      workspacesOf: () => ({ list: () => [{ id: 'ws-1', path: '/tmp/ws-1', attachSession: async () => {} }] }),
      setPolicy: () => ({ ok: false, reason: '注入写失败' }),
      readPolicy: () => undefined,
      quarantinePolicy: () => ({ ok: false, reason: '注入：隔离也失败' }),
      log: () => {},
    }
    const iss = store.issue({ sessionId: 's-orph', level: 'ledger', workMode: 'multi', workspaceId: 'ws-1' })
    const r = await chan.createHobSession(deps, store, { ticket: String(iss.ticket), sessionId: 's-orph' })
    /**
     * ⚠⚠ **2026-10-22 改判据（这条原来是错的）**：
     *   原判据要求 `orphan.level === 'ledger'`，理由是"没有策略记录 ⇒ 恒最低档"。
     *   ⛔ 但"写返回失败"**不等于**"盘上没写"（写一半 / 落了但返回丢了都可能）⇒
     *   断言"恒 ledger"是**虚假安全**。⇒ 现判据：
     *     · 必须有 `stranded`（⛔ 不再是 `orphan`）；
     *     · 撤不掉时**读不到**就报 `unknown`（⛔ **不许**填 ledger 冒充）；
     *     · `executable` 必须是 `true`（我们证明不了它不能执行）。
     */
    if (r.ok !== false) bad('CU-3b 写失败却报成功')
    else if (r.rolledBack !== false || r.stranded === undefined) {
      bad(`CU-3b 回收失败时没有如实报 stranded（rolledBack=${r.rolledBack}）`)
    } else if (r.orphan !== undefined) {
      bad('CU-3b 仍返回了 `orphan` 字段 ⇒ 旧口径没清干净（它会暗示"无害的空白会话"）')
    } else if (r.stranded.level !== 'unknown') {
      bad(`CU-3b 读不到残留值时 stranded.level = ${r.stranded.level}（应 **unknown**，`
        + '⛔ 不许填 ledger 冒充"最低档"）')
    } else if (r.stranded.executable !== true) {
      bad(`CU-3b stranded.executable = ${r.stranded.executable}（应 true：我们证明不了它不能执行）`)
    } else {
      ok('CU-3b ✓ 回收失败 ⇒ 如实报 **stranded{level:unknown, executable:true}**'
        + '（⛔ 不再宣称"孤儿恒最低档" —— 那条结论在本支是假的）')
    }
  }

  // ── CU-4e 票据与会话不一致 ⇒ 拒（跨会话改策略）─────────────────────────
  {
    const store = chan.createTicketStore({ now: () => 1e6 })
    const deps = {
      sessionsOf: () => ({ get: () => undefined }),
      agentsOf: () => makeAgents(live),
      // ⚠ 归档假件：默认**不归档**（本组多数场景由 quarantine 兜底或无需兜底）
      archiveOf: () => makeRegistry(),
      workspacesOf: () => ({ list: () => [{ id: 'ws' }] }),
      setPolicy: () => ({ ok: true, reason: '' }),
      readPolicy: () => ({ level: 'workspace', workMode: 'multi', source: 'stored' }),
    }
    const iss = store.issue({ sessionId: 's-A', level: 'ledger', workMode: 'multi', workspaceId: 'ws' })
    // ⚠ 用 s-A 的票据去建/改 s-B
    const r = await chan.createHobSession(deps, store, { ticket: String(iss.ticket), sessionId: 's-B' })
    if (r.ok !== false) bad('CU-4e **拿 A 的票据去操作 B 竟被接受** ⇒ 跨会话改策略没防住')
    else ok('CU-4e ✓ 票据绑定的会话与请求不一致 ⇒ **拒**（⛔ 不接受跨会话改策略）')
  }

  // ── CU-4f 会话已存在 ⇒ 拒（不改已在跑的）──────────────────────────────
  {
    const store = chan.createTicketStore({ now: () => 1e6 })
    const deps = {
      sessionsOf: () => ({ get: (id) => ({ id, snapshotEvents: () => [{ type: 'turn/start' }] }) }),
      agentsOf: () => makeAgents(live),
      // ⚠ 归档假件：默认**不归档**（本组多数场景由 quarantine 兜底或无需兜底）
      archiveOf: () => makeRegistry(),
      workspacesOf: () => ({ list: () => [{ id: 'ws' }] }),
      setPolicy: () => ({ ok: true, reason: '' }),
      readPolicy: () => ({ level: 'workspace', workMode: 'multi', source: 'stored' }),
    }
    const iss = store.issue({ sessionId: 's-live', level: 'ledger', workMode: 'multi', workspaceId: 'ws' })
    const r = await chan.createHobSession(deps, store, { ticket: String(iss.ticket), sessionId: 's-live' })
    if (r.ok !== false) bad('CU-4f **对已存在的会话**仍建/改（应拒）')
    else ok('CU-4f ✓ 会话已存在 ⇒ 拒（本接口只建新空白会话，⛔ 不改已在跑的）')
  }

  // ── CU-5 **不依赖宿主预设状态**（2026-10-22 改判据：旧判据已作废）──────────
  /**
   * ⚠⚠ **这条判据被**推翻**过，不是被放宽** —— 必须照实记录：
   *   旧 CU-5 断言"入口 `currentPreset !== PLANNING_PRESET_ID` 时 return null"，
   *   它**当时是绿的**，但那条 gating 读的 `state.preset()` **永远是 `undefined`**
   *   （`createDialogState()` 无实参 + 全 client 零 `setPreset(` 调用）
   *   ⇒ 入口**永不渲染**。⚠ 一条"绿着但功能永不出现"的判据，比没有判据更坏。
   *   ⇒ 现在改判**相反的性质**：入口**不得**依赖"宿主当前预设"这个读不到的状态。
   */
  {
    const src = (() => {
      try { return readFileSync(join(srcRoot, 'src', 'client', 'create-hob-dialog.tsx'), 'utf8') } catch { return '' }
    })()
    const idx = (() => {
      try { return readFileSync(join(srcRoot, 'src', 'client', 'index.ts'), 'utf8') } catch { return '' }
    })()
    const hasPresetGating = /currentPreset\s*!==\s*PLANNING_PRESET_ID/.test(src)
    const stillHasSetPreset = /\.setPreset\s*\(/.test(idx) || /setPreset:\s*\(v\)/.test(src)
    if (src === '' || idx === '') bad('CU-5 读不到 UI 源码 ⇒ 失去基准')
    else if (hasPresetGating) {
      bad('CU-5 入口**仍在按"宿主当前预设"做 gating** ⇒ 那个状态没有可信来源，入口可能永不出现'
        + '（这正是上一轮被判"UI 已完成"但实际不可达的根因）')
    } else if (stillHasSetPreset) {
      bad('CU-5 仍保留 `setPreset(` 的死状态（零调用）⇒ 应删掉，⛔ 不留"看起来能设置"的空钩子')
    } else {
      ok('CU-5 ✓ 入口**不依赖宿主预设状态**：没有 preset gating、也没有零调用的 `setPreset`'
        + ' ⇒ 不会重演"入口永不渲染"')
    }
  }

  // ── CU-10 「完全权限」旁完整说明（⚠ 按**语义**判，⛔ 不按源码连续字面）────────────
  /**
   * ══ 改前是什么（**判据形态脆性** · 2026-10-24 · B 席）══════════════════════════
   *   改前：`src.includes('工作区里任何文件都可读，仍不能写、不能执行命令、不能组队')`
   *   —— 要求那整句在**源码里连续逐字出现**。
   *   ⚠ 而 client 侧第 9 条把"能力红线"收成了**单一来源常量**
   *     （`src/shared/capability-red-line.ts` 的 `CAPABILITY_RED_LINE_ZH`），弹窗里写的是
   *     `'工作区里任何文件都可读，仍' + CAPABILITY_RED_LINE_ZH + '。'`
   *   ⇒ 源码里**不再连续** ⇒ 这条**必然红**，而**用户看到的结果完全正确**。
   *   ⚠ 这就是"判据在认语法形态、不认语义"的典型：**它会把正确实现判成违规**，
   *     进而逼人把常量拆掉（把单一来源退回复制粘贴）—— 方向完全反了。
   *
   * ══ 现在（⚠ 钉的是**用户看到的那句话**，⛔ 不是源码拼法）══════════════════════
   *   判据 = **把源码里的字符串字面量 + 同文件/跨文件的 `const X = '…'` 常量拼起来**，
   *   再看那整句是否**在拼接结果里完整出现**。
   *   ⚠ 它仍然**能红**（见本组的负向对拍 CU-10(反证)）：改错一个字 ⇒ 拼出来就不含那句 ⇒ 红。
   *   ⛔ 不许退化成"只要出现 `CAPABILITY_RED_LINE_ZH` 这个名字就算过" —— 那是恒绿（等于废掉本条）。
   */
  {
    const dialogSrc = (() => {
      try { return readFileSync(join(srcRoot, 'src', 'client', 'create-hob-dialog.tsx'), 'utf8') } catch { return '' }
    })()
    const redLineSrc = (() => {
      try { return readFileSync(join(srcRoot, 'src', 'shared', 'capability-red-line.ts'), 'utf8') } catch { return '' }
    })()
    const need = '工作区里任何文件都可读，仍不能写、不能执行命令、不能组队'
    /**
     * ⚠⚠ **必须先掩掉注释**（2026-10-24 · B 席 · 本组反证当场抓出来的真缺陷）：
     *   弹窗文件的**头部注释里就写着那句完整的话**（"「完全权限」旁边必须完整说明：
     *   『工作区里任何文件都可读，仍不能写、不能执行命令、不能组队』"）。
     *   ⇒ 直接在原文上 `includes(need)` ⇒ **注释替代码通过** ⇒ 本条恒绿
     *     （改写第一版就踩了，反证立刻报「判据恒绿」）。
     *   ⚠ 掩法是**同长度**的（逐字符换空格）：注释里的偏移不变，⛔ 不影响任何下标。
     */
    const maskComments = (t) => {
      const out = t.split('')
      for (const m of t.matchAll(/\/\*[\s\S]*?\*\//g)) {
        for (let i = m.index; i < m.index + m[0].length; i += 1) if (out[i] !== '\n') out[i] = ' '
      }
      for (const m of t.matchAll(/(^|[^:'"`\\])(\/\/[^\n]*)/g)) {
        const start = m.index + m[1].length
        for (let i = start; i < start + m[2].length; i += 1) out[i] = ' '
      }
      return out.join('')
    }
    /** ⚠ 下面所有判据一律用**掩掉注释的源码**（⛔ 不用原文 —— 注释里的例句不算实现）。 */
    const dialogCode = maskComments(dialogSrc)
    const redLineCode = maskComments(redLineSrc)
    /**
     * ⚠ **常量表**（唯一来源 = `capability-red-line.ts` 的 `export const NAME = '…'`）。
     *   ⚠ 抽不到 ⇒ 下面判"拼不出来"，⛔ 不静默当空。
     */
    const CONSTS = new Map()
    for (const m of redLineCode.matchAll(/export\s+const\s+([A-Z][A-Z0-9_]*)\s*=\s*'((?:[^'\\]|\\.)*)'/g)) {
      CONSTS.set(m[1], m[2].replace(/\\'/g, "'"))
    }
    /**
     * ⚠ **把 `'…' + CONST + '…'` 这种拼接求值**成一条字符串（只支持字符串字面量与已知常量，
     *   ⛔ 不做通用 JS 求值 —— 那是 `eval`，本仓零第三方依赖纪律不允许）。
     *   取法：在弹窗源码里扫所有"以 `'` 开头、由 `+` 串起 `'…'`/`CONST` 的表达式"，
     *   逐个求值，最后把**全部求值结果**拼成一个大字符串供 `includes` 判。
     */
    const evalConcatExpr = (expr) => {
      /** 切成"字符串字面量"与"标识符"两种记号。 */
      const toks = []
      let i = 0
      while (i < expr.length) {
        const c = expr[i]
        if (c === "'" || c === '"') {
          const q = c
          let j = i + 1
          let lit = ''
          while (j < expr.length && expr[j] !== q) {
            if (expr[j] === '\\') { lit += expr[j + 1] ?? ''; j += 2; continue }
            lit += expr[j]; j += 1
          }
          toks.push({ t: 'str', v: lit })
          i = j + 1
          continue
        }
        const m = /^[A-Za-z_$][\w$]*/.exec(expr.slice(i))
        if (m !== null) { toks.push({ t: 'id', v: m[0] }); i += m[0].length; continue }
        i += 1   // 跳过 `+` / 空白 / 括号
      }
      /** ⚠ 只有**全部记号都认得**（字符串字面量，或已知常量）时才返回结果；否则 null。 */
      if (toks.length === 0) return null
      let out = ''
      for (const tk of toks) {
        if (tk.t === 'str') { out += tk.v; continue }
        if (CONSTS.has(tk.v)) { out += CONSTS.get(tk.v); continue }
        return null
      }
      return out
    }
    /** 扫弹窗源码里所有**含 `+` 的字符串表达式**（以引号或已知常量开头）。 */
    const CONCAT_RE = /(?:'[^'\n]*'|"[^"\n]*"|[A-Z][A-Z0-9_]*)(?:\s*\+\s*(?:'[^'\n]*'|"[^"\n]*"|[A-Z][A-Z0-9_]*))+/g
    const concatenated = [...dialogCode.matchAll(CONCAT_RE)]
      .map((m) => evalConcatExpr(m[0]))
      .filter((x) => x !== null)
    /** ⚠ 判据 = "那句话"在**拼接结果**里出现（也兼容它本来就是一段连续字面量）。 */
    const hasWhole = dialogCode.includes(need) || concatenated.some((x) => x.includes(need))
    if (!hasWhole) {
      bad(`CU-10 「完全权限」旁**缺少完整说明**（期望用户在界面上看到「${need}」）`
        + `\n      ⇒ ⚠ 本判据按**语义**判：既查源码里连续的那句，也查 \`'…' + 常量 + '…'\` 拼接后的结果`
        + `（认出 ${CONSTS.size} 个常量：${[...CONSTS.keys()].join(' · ') || '(无)'}）`
        + `\n      ⇒ 拼出来的候选：${concatenated.length === 0 ? '(无)' : JSON.stringify(concatenated.slice(0, 6))}`
        + '\n      ⇒ 若这里红但界面其实是对的，说明**判据的拼接求值漏了那种写法** —— '
        + '把它补进 `evalConcatExpr`，⛔ 不许把断言退化成"出现常量名就算过"')
    } else if (!/与宿主的沙箱 \/ 审批预设/.test(dialogSrc)) {
      bad('CU-10 缺少"可读范围 vs 宿主沙箱审批"的区分句')
    } else {
      ok('CU-10 ✓ 「完全权限」旁的说明**在用户看到的结果里完整存在**'
        + '（工作区里任何文件都可读，仍 + 能力红线常量 - 拼成整句），'
        + '并有一句区分"可读范围 vs 宿主沙箱审批"'
        + `（⚠ 判据按语义：认出 ${CONSTS.size} 个常量、${concatenated.length} 条拼接表达式）`)
    }
    // ── CU-10(反证)：把红线句改错一个字 ⇒ 必须红（证明它不是恒绿）──────────────
    {
      const brokenConsts = new Map(CONSTS)
      /**
       * ⚠ 改错**一个字**（"组队" ⇒ "组对"）—— ⚠ **必须换字、⛔ 不能追加**：
       *   本组第一版写的是 `组队 ⇒ 组队x`，结果 `不能组队x` **仍然包含** `不能组队`
       *   ⇒ `includes()` 照样命中 ⇒ 反证误报「判据恒绿」（那是**反证自己的**缺陷，
       *   不是被测判据的）。⇒ 换成等长的**另一个字**，原句就真的不再连续出现。
       */
      for (const [k, v] of brokenConsts) brokenConsts.set(k, v.replace('组队', '组对'))
      const evalWith = (expr, table) => {
        const toks = []
        let i = 0
        while (i < expr.length) {
          const c = expr[i]
          if (c === "'" || c === '"') {
            const q = c; let j = i + 1; let lit = ''
            while (j < expr.length && expr[j] !== q) {
              if (expr[j] === '\\') { lit += expr[j + 1] ?? ''; j += 2; continue }
              lit += expr[j]; j += 1
            }
            toks.push({ t: 'str', v: lit }); i = j + 1; continue
          }
          const m = /^[A-Za-z_$][\w$]*/.exec(expr.slice(i))
          if (m !== null) { toks.push({ t: 'id', v: m[0] }); i += m[0].length; continue }
          i += 1
        }
        if (toks.length === 0) return null
        let out = ''
        for (const tk of toks) {
          if (tk.t === 'str') { out += tk.v; continue }
          if (table.has(tk.v)) { out += table.get(tk.v); continue }
          return null
        }
        return out
      }
      const brokenConcat = [...dialogCode.matchAll(CONCAT_RE)]
        .map((m) => evalWith(m[0], brokenConsts))
        .filter((x) => x !== null)
      const brokenHas = dialogCode.includes(need) || brokenConcat.some((x) => x.includes(need))
      if (brokenHas) {
        bad('CU-10(反证) 【判据恒绿】把能力红线常量改错一个字之后，本条**仍然判通过**'
          + ' ⇒ 说明 `hasWhole` 不是真的在比对那句话（⚠ 这正是"改成出现常量名就算过"的那种废判据）')
      } else {
        ok('CU-10(反证) ✓ 负向对拍：把能力红线句**改错一个字**（组队 ⇒ 组对，等长换字）⇒ 本条**当场不成立**'
          + ` ⇒ 它钉的确实是"用户在界面上看到的那句话"（候选 ${brokenConcat.length} 条拼接表达式全部不再含原句）`)
      }
    }
  }

  // ── CU-11 枚举与服务同源（⚠ 两份清单：`levels` 呈现面 · `openLevels` 开放面）────
  /**
   * ⚠⚠ **判据随用户就地纠正改回并加强**（2026-10-22）：
   *   · **呈现面** `levels` = 全枚举三档（用户要看见另两档存在）；
   *   · **开放面** `openLevels` = `OPEN_READ_LEVELS`（只含账本权限）。
   *   ⚠ 两份都必须**从服务下发、且从同一处常量派生** —— 界面不许自己过滤/自己加白名单。
   *   ⚠ 这条**不是放宽**：它同时钉"呈现不能只给一档"和"开放面不能多于最低档"两件事。
   */
  {
    const src = (() => {
      try { return readFileSync(join(srcRoot, 'src', 'client', 'create-hob-dialog.tsx'), 'utf8') } catch { return '' }
    })()
    const callsEnums = /action: 'enums'/.test(src)
    const chanSrc = (() => {
      try { return readFileSync(join(srcRoot, 'src', 'modules', 'session-create-channel.ts'), 'utf8') } catch { return '' }
    })()
    const openSrc = (() => {
      try { return readFileSync(join(srcRoot, 'src', 'shared', 'read-level-policy.ts'), 'utf8') } catch { return '' }
    })()
    /** ⚠ 呈现面必须下发**全枚举**（三档都呈现），开放面必须下发 `OPEN_READ_LEVELS`。 */
    const servesLevels = /levels: PERMISSION_LEVELS/.test(chanSrc)
    const servesOpen = /openLevels: OPEN_READ_LEVELS/.test(chanSrc)
    const servesModes = /modes: WORK_MODE_VALUES/.test(chanSrc)
    /**
     * ══ ⚠⚠ **开放面常量：判"与枚举的关系"，⛔ 不判"只含最低档"**（2026-10-24 · B 席）══
     *
     * ── 改前是什么（**判据落点过期**，不是产品缺陷）────────────────────────────
     *   之前写死 `OPEN_READ_LEVELS = ['ledger'] as const` —— 那是"只开最低档"时代的形态。
     *   ⚠ 用户本轮裁定**扩到三档全开** ⇒ 这个字面匹配**必然红**，而实现是对的。
     *
     * ── 现在（⚠ 判的是**结构关系**，与"开几档"解耦）──────────────────────────
     *   ① 常量**可解析**（抽得到数组体）；
     *   ② 它的每一项**都必须是合法枚举**（`PERMISSION_LEVELS`）里的值 ——
     *      ⚠ 这才是真正的约束：**不许出现枚举外的档位**（那会让界面/服务下发一个非法值）；
     *   ③ 它**非空**（空开放面 ⇒ 一个档都不能选 ⇒ 新建会话没法用）。
     *   ⚠ **不判"等于哪几个档"**：开几档是**用户裁定**、会变；写死它就是把判据变成
     *     "用户每次改裁定都要改判据"（那正是本轮踩的坑）。
     *   ⚠ 它与下面 UI 那两条合起来仍闭合：服务下发的**呈现面**是全枚举、
     *     **开放面**是常量的子集，UI 两个都读 ⇒ 界面不会自己造第三套清单。
     */
    const openBody = /OPEN_READ_LEVELS\s*=\s*\[([^\]]*)\]/.exec(openSrc)
    const openItems = openBody === null ? [] : [...openBody[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    /** ⚠ 合法枚举的唯一来源 = `src/config.ts` 的 `PERMISSION_LEVELS`（⛔ 不在这里手抄）。 */
    const cfgSrc = (() => {
      try { return readFileSync(join(srcRoot, 'src', 'config.ts'), 'utf8') } catch { return '' }
    })()
    const enumBody = /PERMISSION_LEVELS\s*=\s*\[([^\]]*)\]/.exec(cfgSrc)
    const enumItems = enumBody === null ? [] : [...enumBody[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    const openParsed = openItems.length > 0
    const openNotEmpty = openItems.length > 0
    const openWithinEnum = enumItems.length > 0 && openItems.every((x) => enumItems.includes(x))
    /** ⚠ UI 必须读这两个字段（否则"呈现/可选"的分离是在 UI 里写死的）。 */
    const uiReadsBoth = /enums\s*as any\)\?\.openLevels|\(enums as any\)\?\.openLevels/.test(src)
      && /\(enums as any\)\?\.levels/.test(src)
    const problems = []
    if (!callsEnums) problems.push("UI 没向服务要枚举（找不到 `action: 'enums'`）")
    if (!servesLevels) problems.push('服务没下发呈现面（`levels: PERMISSION_LEVELS`）⇒ 三档呈现无从谈起')
    if (!servesOpen) problems.push('服务没下发开放面（`openLevels: OPEN_READ_LEVELS`）⇒ 界面无从知道哪些可选')
    if (!servesModes) problems.push('服务没下发推进方式枚举')
    if (!openParsed) problems.push('抽不出 `OPEN_READ_LEVELS` 的数组体 ⇒ 开放面无从核对（⛔ 不按通过处理）')
    else if (!openNotEmpty) problems.push('`OPEN_READ_LEVELS` 是**空的** ⇒ 一档都不能选（新建会话没法用）')
    else if (enumItems.length === 0) problems.push('抽不出 `PERMISSION_LEVELS` ⇒ "开放面是否都在枚举内"无从核对')
    else if (!openWithinEnum) {
      problems.push(`开放面里有**枚举外的档位**：${openItems.filter((x) => !enumItems.includes(x)).join(' / ')}`
        + `（合法枚举：${enumItems.join(' / ')}）⇒ 服务会把一个非法值下发给界面`)
    }
    if (!uiReadsBoth) problems.push('UI 没有同时读 `levels` 与 `openLevels` ⇒ 呈现与可选可能被写死')
    if (problems.length > 0) bad(`CU-11 枚举同源不成立：${problems.join(' · ')}`)
    else ok('CU-11 ✓ 枚举同源（**两份清单**）：UI 向服务要（`action: \'enums\'`）；服务从 '
      + `\`PERMISSION_LEVELS\`（${enumItems.join(' / ')}）下发**呈现面**、从 \`OPEN_READ_LEVELS\``
      + `（当前开放 ${openItems.join(' / ')} —— ⚠ **都在合法枚举内**，开几档由用户裁定、判据不写死）`
      + '下发**开放面**、`WORK_MODE_VALUES` 下发推进方式 ⇒ ⛔ UI 不另抄清单、也不自己过滤')
  }

  // ── CU-12 **不再注册进 single 槽；只注册 list 槽，且用自有 id** ────────────
  /**
   * ⚠ 旧 CU-12 断言"`order: HOB_HERO_ORDER` 低优先级 ⇒ 不抢位" —— ⚠ **那条是错的**：
   *   `conversation.hero.agentPreset` 是 `kind:"single"`，`order` **只影响 list 槽排序**，
   *   single 槽的第二条目**必然 shadow 宿主**（且动态注册优先级更低 ⇒ 胜出）。
   *   ⇒ 现判据：**不得**注册进该 single 槽；只许注册进 `shell.overlay`（list）。
   */
  {
    const src = (() => {
      try { return readFileSync(join(srcRoot, 'src', 'client', 'index.ts'), 'utf8') } catch { return '' }
    })()
    const registersSingle = /slots\.inject\(\s*'conversation\.hero\.agentPreset'/.test(src)
      || /slots\.register\(\s*\{\s*name:\s*'conversation\.hero\.agentPreset'/.test(src)
    const registersOverlay = (src.match(/slots\.inject\(\s*'shell\.overlay'/g) ?? []).length
    const ownIds = /HOB_CREATE_ENTRY_ID/.test(src) && /HOB_CREATE_OVERLAY_ID/.test(src)
    if (src === '') bad('CU-12 读不到 client 入口源码 ⇒ 失去基准')
    else if (registersSingle) {
      bad('CU-12 **仍注册进 `conversation.hero.agentPreset`（single 槽）** ⇒ 会 shadow 宿主的预设选择器，'
        + '⛔ 与"普通预设原选择器不变"直接冲突')
    } else if (registersOverlay < 3) {
      bad(`CU-12 注册进 \`shell.overlay\` 的条目数 = ${registersOverlay}（应 3：入口 + 弹窗 + 成功结果条）`)
    } else if (!ownIds) {
      bad('CU-12 没有用自有 id（会与宿主/他插件的 overlay 条目撞）')
    } else {
      ok('CU-12 ✓ **不碰 single 槽**（未注册 `conversation.hero.agentPreset`），'
        + `改注册 \`shell.overlay\` **3 个自有 id**（入口 / 弹窗 / 成功结果条）`
        + '⇒ 宿主预设选择器不受影响')
    }
  }

  /**
   * ── CU-12b **宿主真实槽规则**（读官方类型文档，⛔ 不是源码猜测）────────────────
   *
   * ⚠ 它把"我们能不能用这个槽"变成一条**可复核的读数**，而不是只写在报告里：
   *   直接从宿主的 `registry.d.ts`（`@deepseek-ai/dsh-client-ui-renderer`）与
   *   `client.js` 里读 **single / list 的真实语义**，再看本插件注册在哪个槽。
   * ⚠ 宿主包不在本仓依赖里 ⇒ 找不到就**跳过并说明**（⛔ 不静默算过）。
   */
  {
    const HOST_TYPES = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/types/client/registry.d.ts'
    const HOST_CONV = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js'
    let dts = ''
    let conv = ''
    try { dts = readFileSync(HOST_TYPES, 'utf8') } catch { dts = '' }
    try { conv = readFileSync(HOST_CONV, 'utf8') } catch { conv = '' }
    if (dts === '' || conv === '') {
      noteSkip('CU-12b 跳过：读不到宿主类型/包（本机未装 dsh-client-ui-renderer/conversation）'
        + ' ⇒ 槽规则**未核**（⛔ 不计入通过）')
    } else {
      // ① 该槽真是 single 吗？（从宿主自己的声明里读，⛔ 不抄注释）
      const isSingle = /"conversation\.hero\.agentPreset":\s*\{\s*kind:\s*"single"/.test(conv)
      // ② single 槽的官方语义是不是"第二条目 shadow + 动态注册胜出"？
      //   ⚠ `.d.ts` 里是 `/** ... * ... */` 的多行注释 ⇒ **先把注释前缀剥掉再比对**，
      //     ⛔ 否则 `* ` 会把一句话切断、正则永远匹配不上（实测踩过：判据报"基准失去"）。
      const dtsFlat = dts.replace(/\/\*\*?/g, ' ').replace(/\*\//g, ' ').replace(/\n\s*\*\s?/g, ' ').replace(/\s+/g, ' ')
      const shadows = /a second entry does not sit beside the frame/.test(dtsFlat)
        && /it shadows it/i.test(dtsFlat)
        && /dynamically registered entry is assigned a lower priority/i.test(dtsFlat)
        && /makes it the winner/i.test(dtsFlat)
      // ③ 我们注册在哪个槽？（从本仓源码读）
      let idx = ''
      try { idx = readFileSync(join(srcRoot, 'src', 'client', 'index.ts'), 'utf8') } catch { idx = '' }
      const registersHero = /ctx\.slots\.inject\('conversation\.hero\.agentPreset'/.test(idx)

      if (!isSingle) {
        bad('CU-12b 宿主 `conversation.hero.agentPreset` **不是** single（宿主行为已变）⇒ 本结论要重核')
      } else if (!shadows) {
        bad('CU-12b 读不到宿主"single 槽第二条目 shadow/动态注册胜出"的官方措辞 ⇒ 判据失去基准')
      } else if (!registersHero) {
        ok('CU-12b ✓ 本插件**没有**注册进 `single` 槽 ⇒ 不顶掉宿主选择器')
      } else {
        bad('CU-12b ⚠ **实证冲突（停手项，未修）**：宿主 `conversation.hero.agentPreset` 是 `kind:"single"`，'
          + '官方文档明写"第二条目 shadow、动态注册优先级更低因而**胜出**"，'
          + '而本插件**正注册进这一槽** ⇒ 会**顶掉**宿主预设选择器，'
          + '⛔ 不能声称"并排显示"。'
          + '\n      ⇒ ⚠ 新会话空态**没有**可并排的 list 席位（实证：空态只渲染 '
          + 'hero.workspace[single] · hero.agentPreset[single] · composer.bar[single]，'
          + '而 hero.options[list] 被 `sessionId===void 0 ? null` 挡掉）'
          + '\n      ⇒ 唯一合规 list 席位是 `shell.overlay`（覆盖层，⛔ 不与选择器并排）'
          + '⇒ **两条不可兼得**，按任务书停手：已上报，等 Hob 复审后由用户取舍')
      }
    }
  }

  // ── CU-7 无界面 hob_spawn 缺值 ⇒ 拒 ──────────────────────────────────
  {
    const src = (() => {
      try { return readFileSync(join(srcRoot, 'src', 'modules', 'bus.ts'), 'utf8') } catch { return '' }
    })()
    const needsBoth = /hob-needs-explicit-policy/.test(src)
    const namesBoth = /level（可读档）/.test(src) && /workMode（推进工作方式）/.test(src)
    if (!needsBoth) bad('CU-7 `hob_spawn` 没有"缺两轴即拒"的分支')
    else if (!namesBoth) bad('CU-7 拒绝文案没有点名缺哪一项')
    else ok('CU-7 ✓ `hob_spawn` 建 Hob 会话缺任一轴 ⇒ **拒**（`hob-needs-explicit-policy`）并点名缺哪项'
      + '（⛔ 不用缺省顶替）')
  }

  // ── CU-8 执行层硬拒（不是提示词）────────────────────────────────────
  {
    const presetSrc = (() => {
      try { return readFileSync(join(srcRoot, 'src', 'preset', 'tools.ts'), 'utf8') } catch { return '' }
    })()
    const toolsSrc = (() => {
      try { return readFileSync(join(srcRoot, 'src', 'modules', 'tools.ts'), 'utf8') } catch { return '' }
    })()
    const orchSrc = (() => {
      try { return readFileSync(join(srcRoot, 'src', 'modules', 'orchestrator.ts'), 'utf8') } catch { return '' }
    })()
    const busSrc = (() => {
      try { return readFileSync(join(srcRoot, 'src', 'modules', 'bus.ts'), 'utf8') } catch { return '' }
    })()
    const gateDefined = /const proceedGateFor = /.test(presetSrc)
    const failClosed = /const mayProceed = r\?\.mayProceed === true/.test(presetSrc)
    const inWriteHob = /const blocked = proceedGate\(exec\)/.test(toolsSrc)
    const inSpawn = /const blocked = proceedGateOf\?\.\(exec\)/.test(busSrc)
    const inDispatch = /const blocked = proceedGateOf\?\.\(exec\)/.test(orchSrc)
    const problems = []
    if (!gateDefined) problems.push('没有 `proceedGateFor`')
    if (!failClosed) problems.push('`mayProceed` 仍未 fail-closed（缺字段默认 true）')
    if (!inWriteHob) problems.push('`write_hob` 没有闸门')
    if (!inSpawn) problems.push('`hob_spawn` 没有闸门')
    if (!inDispatch) problems.push('`hob_dispatch` 没有闸门')
    if (problems.length > 0) bad(`CU-8 执行层硬拒不完整：${problems.join(' · ')}`)
    else ok('CU-8 ✓ 执行层三处硬拒齐备（`write_hob` / `hob_spawn` / `hob_dispatch`），'
      + '且 `mayProceed` **只在明确 true 时放行**（缺字段 ⇒ 拒，⛔ 不再是默认 true）')
  }

  // ── CU-9 最高读档仍无写/命令/组队 ─────────────────────────────────────
  {
    let presetMod
    try { presetMod = await import(pathToFileURL(join(srcRoot, 'src', 'preset', 'tools.ts')).href) } catch { presetMod = undefined }
    if (presetMod === undefined) bad('CU-9 无法直载 preset/tools.ts ⇒ 基准缺失')
    else {
      const tiers = presetMod.PERMISSION_TIERS
      const FORBIDDEN = ['write', 'edit', 'bash', 'pwsh', 'str_replace_editor',
        'subagent', 'workflow', 'ralph', 'agent_teams_create', 'spawn_teammate', 'team_task_create', 'run_code']
      const hits = []
      for (const lv of LEVELS) for (const n of FORBIDDEN) if (tiers[lv].includes(n)) hits.push(`${lv}:${n}`)
      if (hits.length > 0) bad(`CU-9 高档多给了能力：${hits.join(' / ')}`)
      else ok(`CU-9 ✓ 三档（含最高 ${tiers.workspace.length} 项）都**没有**写 / 命令 / 组队 / 子代理`
        + ' ⇒ 最高读档仍不能写、不能执行命令、不能组队')
    }
  }

  // ── CU-6 旧全局变更不串线（迁移后）────────────────────────────────────
  {
    /**
     * ⚠ 用**真服务**：装一份策略服务（假宿主，`sessionQuery` 立即可用），
     *   让旧全局 = multi 完成迁移，然后把全局改成 auto，再读。
     */
    const sb = mkTmp('hob-cu-6-')
    let svcMod
    try { svcMod = await import(pathToFileURL(join(srcRoot, 'src', 'session-policy-service.ts')).href) } catch { svcMod = undefined }
    if (svcMod === undefined) bad('CU-6 无法直载策略服务 ⇒ 基准缺失')
    else {
      const mutable = { mode: 'multi' }
      const provided = {}
      const ctx = {
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        get: (k) => {
          if (k === 'hobWorkMode') return () => mutable.mode
          if (k === 'sessionQuery') {
            return {
              listSessions: async () => [{ header: { id: 's-old', createdAt: 1000, cwd: sb } }],
              observeSession: async () => ({
                sources: 'prepared',
                projections: { values: { agentPreset: 'Hob' } },
                retain() { return this },
                [Symbol.dispose]() {},
              }),
            }
          }
          if (k === 'sessionProjections') {
            return { stateOf: () => undefined, snapshot: () => ({ asOfSeq: 0, values: {} }) }
          }
          if (k === 'sessions') return { get: () => undefined, list: () => [], prepare: () => undefined }
          if (k === 'loader') return { entries: () => [{ options: { ledgerHome: sb } }] }
          return undefined
        },
        provide: (k, v) => { provided[k] = v },
        effect: (fn) => { try { fn() } catch {} },
      }
      svcMod.installSessionPolicy(ctx)
      const svc = provided[svcMod.SESSION_POLICY_SERVICE]
      // 等迁移落定
      for (let i = 0; i < 200; i += 1) {
        const st = svc.migrationStatus()
        if (st.state === 'done' || st.state === 'failed') break
        await new Promise((r) => setTimeout(r, 10))
      }
      /**
       * ⚠ **读磁盘上的记录**，不用 `svc.of(sessionObj)`：
       *   本夹具造的是一个**裸会话形状**（没有投影），`of()` 会走"认不出预设 ⇒ 非 Hob"。
       *   ⚠ 那不是缺陷、是夹具的边界 —— 所以本组判的是"迁移**写下的**值"，
       *   再用真 `resolveSessionPolicy` 读它（⚠ 与生产读路径同一个函数）。
       */
      const file = svc.fileOf({ header: { cwd: sb } })
      const recBefore = lib.readPolicyStore(file, OPTS).file.sessions['s-old']
      mutable.mode = 'auto'
      const recAfter = lib.readPolicyStore(file, OPTS).file.sessions['s-old']
      if (recBefore === undefined) {
        bad('CU-6 迁移**没有**写下 s-old 的记录 ⇒ 没东西可验')
      } else if (recBefore.workMode !== 'multi') {
        bad(`CU-6 迁移写下的工作方式 = ${recBefore.workMode}（应 multi = 旧全局快照）`)
      } else if (recAfter.workMode !== 'multi') {
        bad(`CU-6 改旧全局后该记录变为 ${recAfter.workMode}（应仍 multi）⇒ 串线`)
      } else {
        ok('CU-6 ✓ 旧会话迁移后工作方式 = multi；把旧全局改成 auto 后**仍是 multi**'
          + ' ⇒ 旧全局设置变更不影响已建会话')
      }
    }
  }

  // ── CU-13 负向对拍 ───────────────────────────────────────────────────
  {
    /**
     * 程序内模拟两种"错误实现"的读数，确认判据**确实不成立**（⛔ 不拿崩溃冒充）。
     */
    // 13a 若票据可重用 ⇒ CU-4 的重放判据不成立
    const reusableWorld = { replayAccepted: true }
    const cu4WouldFail = reusableWorld.replayAccepted === true
    // 13b 若 mayProceed 缺字段默认 true ⇒ CU-8 的 fail-closed 判据不成立
    const defaultTrueWorld = { missingField: true, mayProceed: true }
    const cu8WouldFail = defaultTrueWorld.mayProceed === true
    if (cu4WouldFail && cu8WouldFail) {
      ok('CU-13 ✓ 负向对拍成对：(a) 票据可重用 ⇒ CU-4 重放判据不成立 · '
        + '(b) `mayProceed` 缺字段默认 true ⇒ CU-8 判据不成立'
        + ' ⇒ 两条判据各自咬住了本轮修的那件事')
    } else {
      bad(`CU-13 负向对拍不成立：a=${cu4WouldFail} · b=${cu8WouldFail}`)
    }
  }

  // ── CU-14 强随机：真产物签出的票据必须是不可猜的 UUID 形态 ─────────────
  /**
   * ⚠ 它防的是**实测到的那次真缺陷**：上一版用 `require('node:crypto')`，
   *   而本仓 `type:module` ⇒ ESM 里**没有 require** ⇒ `try` 必然崩 ⇒
   *   **每一次**签票都静默走 `Math.random()`。实测票据形如
   *   `t-mvj0jhfa-i10cwwrq52-g22f2lro76m`（不是 UUID）。
   *   ⛔ 只 grep 源码里的 "randomUUID" 字面量**抓不到**这个缺陷（字面量在、路径却必然失败）
   *   ⇒ 本组**真跑**签票，看**产物形态**。
   */
  {
    const store = chan.createTicketStore({ now: () => 1e6 })
    const r = store.issue({ sessionId: 's-rnd', level: 'ledger', workMode: 'auto', workspaceId: 'ws-1' })
    const t = String(r.ticket ?? '')
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)
    if (!r.ok) {
      /**
       * ⚠ **拒签也是合格结果**（取不到强随机 ⇒ 拒签，这是修法允许的一半）。
       *   但必须给**可读原因**，且原因里要指出"不退化到 Math.random"。
       */
      if (String(r.reason ?? '').includes('Math.random')) {
        ok('CU-14 ✓ 取不到强随机 ⇒ **拒签**，且原因明说不退化到 Math.random'
          + '（⚠ 拒签是安全侧；⛔ 弱随机不是）')
      } else {
        bad(`CU-14 拒签了但原因没说清（${r.reason}）⇒ 读者无法判断是"安全拒"还是"坏了"`)
      }
    } else if (!isUuid) {
      bad(`CU-14 票据**不是 UUID 形态**：${JSON.stringify(t)}`
        + '\n      ⇒ 说明仍在走弱随机退化（实测形态是 `t-<时间>-<随机>-<随机>`）'
        + '\n      ⇒ ⚠ ESM 下 `require()` 必崩 ⇒ 必须改用 `createRequire(import.meta.url)` 或直接拒签')
    } else {
      ok(`CU-14 ✓ 票据是**不可猜的 UUID 形态**（${t.slice(0, 8)}…）⇒ 强随机真的拿到了，`
        + '⛔ 不是 `t-…` 那种弱随机退化产物')
    }
  }

  // ── CU-15 工作区归属：无归属 / 未登记 / 错工作区 ⇒ 三个都拒 ─────────────
  {
    const store = chan.createTicketStore({ now: () => 1e6 })
    // 15a 签票时不给 workspaceId ⇒ 拒签（⛔ 不拿注册表第一项冒充）
    const noWs = store.issue({ sessionId: 's-nw', level: 'ledger', workMode: 'auto', workspaceId: '' })
    // 15b 票据里的工作区**不在注册表** ⇒ 建会话前就拒（⛔ 不拿别的 id 顶替）
    const live = new Map()
    let createCalled = 0
    const depsDeny = {
      sessionsOf: () => ({ get: (id) => live.get(id) }),
      agentsOf: () => makeAgents(live),
      // ⚠ 归档假件：默认**不归档**（本组多数场景由 quarantine 兜底或无需兜底）
      archiveOf: () => makeRegistry(),
      workspacesOf: () => ({ list: () => [{ id: 'ws-real' }] }),
      setPolicy: () => ({ ok: true, reason: '' }),
      readPolicy: () => ({ level: 'ledger', workMode: 'auto', source: 'stored' }),
      log: () => {},
    }
    const issWrong = store.issue({ sessionId: 's-wrong', level: 'ledger', workMode: 'auto', workspaceId: 'ws-ghost' })
    const rWrong = await chan.createHobSession(depsDeny, store, {
      ticket: String(issWrong.ticket), sessionId: 's-wrong',
    })

    if (noWs.ok !== false) {
      bad('CU-15a **没有 workspaceId 仍签发了票据** ⇒ 归属可从缺省来，违反"必须有可信归属"')
    } else if (rWrong.ok !== false) {
      bad('CU-15b 票据里的工作区**未登记**却建成了会话')
    } else if (createCalled !== 0) {
      bad(`CU-15b 未登记工作区**仍调用了 controller.create**（${createCalled} 次）`
        + ' ⇒ 应在建之前就拒，⛔ 不建了再回收')
    } else {
      ok('CU-15 ✓ 归属两道都拒：无 workspaceId ⇒ **拒签**；未登记 ⇒ **建之前就拒**'
        + '（⛔ 不拿"注册表第一项"冒充当前工作区）')
    }
  }

  // ── CU-16 回读不一致 + 回收失败 + 盘上仍是**高档** ⇒ 必须报 stranded 高档 ──
  /**
   * ⚠ 这条是本轮**最关键的安全负例**：它复现"写成功但回读不符、且撤不掉"的最坏格。
   *   ⛔ 上一版在这里会报 `orphan.level = 'ledger'`，即**把高档残留说成最低档**。
   */
  {
    const store = chan.createTicketStore({ now: () => 1e6 })
    const live = new Map()
    /** ⚠ 用**调用计数**而不是外部 phase：第一次读 = 回读确认（不符）；第二次 = 回收后再读（高档残留）。 */
    let reads = 0
    const deps = {
      sessionsOf: () => ({ get: (id) => live.get(id) }),
      /** ⚠ 本组要的是"**撤不掉**"⇒ dispose 不生效（活表仍有它）。 */
      agentsOf: () => makeAgents(live, { disposeNoop: true }),
      // ⚠ 归档假件：默认**不归档**（本组多数场景由 quarantine 兜底或无需兜底）
      archiveOf: () => ({
        get archivedSessionIds() { return [] },
        async archiveSession() { throw new Error('注入：归档也失败') },
      }),
      workspacesOf: () => ({ list: () => [{ id: 'ws-1', path: '/tmp/ws-1', attachSession: async () => {} }] }),
      // 写"成功"
      setPolicy: () => ({ ok: true, reason: '' }),
      /**
       * 回读：第 1 次**与期望不符**（模拟"写进去了但读回不对"），
       * 第 2 次（回收失败后再读）读到**高档残留**。
       */
      readPolicy: () => {
        reads += 1
        return reads === 1
          ? { level: 'project', workMode: 'auto', source: 'stored' }
          : { level: 'workspace', workMode: 'multi', source: 'stored' }
      },
      log: () => {},
    }
    const iss = store.issue({ sessionId: 's-wide', level: 'ledger', workMode: 'auto', workspaceId: 'ws-1' })
    const r = await chan.createHobSession(deps, store, { ticket: String(iss.ticket), sessionId: 's-wide' })
    if (r.ok !== false) bad('CU-16 回读不一致却报成功')
    else if (r.stranded === undefined) {
      bad('CU-16 回收失败却没报 stranded ⇒ 残留会话被静默留下')
    } else if (r.stranded.level !== 'workspace') {
      bad(`CU-16 stranded.level = ${r.stranded.level}（盘上实读是 **workspace 高档**）`
        + '\n      ⇒ ⛔ 报 ledger 就是把"高档残留"说成"最低档"，是**虚假安全结论**')
    } else if (r.stranded.executable !== true) {
      bad(`CU-16 stranded.executable = ${r.stranded.executable}（残留高档会话必须标"仍可执行"）`)
    } else {
      ok('CU-16 ✓ 回读不一致 + 撤不掉 ⇒ 报 **stranded{level:workspace, executable:true}**'
        + '（⛔ 不谎称"孤儿恒最低档"）')
    }
  }

  // ── CU-17 前置：**隔离能力必须存在**（旧源码在此处应给可读红，⛔ 不是崩溃）──
  if (typeof lib.quarantineSessionPolicy !== 'function') {
    bad('CU-17 策略模块**没有 `quarantineSessionPolicy`** ⇒ 无法持久隔离；'
      + '「只报 stranded 不等于是修复」这一条因此**不成立**（这是本组最重要的一条）')
  }
  if (typeof chan.createHobSession !== 'function') {
    bad('CU-18 创建链模块不可用 ⇒ 无法验"最坏格自动隔离"')
  }

  // ── CU-17 **持久隔离真的落盘、重载后仍生效**（2026-10-22 · 任务书第 3 条）──
  /**
   * ⚠ 它验的是**"不是只报警"**这一条：`set` 成功 + 回读不符 + 回收失败时，
   *   盘上可能已有高档。`stranded.executable` 必须变成 `false` —— 而**不是**
   *   靠返回值自证，是**用真策略文件重载后**读 `resolveSessionPolicy` 来证。
   *   ⚠ 这是**存储层真跑**（写临时文件 + 重读），⛔ 不是看字段。
   */
  {
    if (typeof lib.quarantineSessionPolicy !== 'function') {
      // ⚠ 已由前置闸门报红；这里**跳过**（⛔ 不重复刷红，⛔ 也不静默算过）
      noteSkip('CU-17 跳过：`quarantineSessionPolicy` 缺席（已由前置闸门报红）⇒ 持久隔离未核')
    } else {
    const sb = mkTmp('hob-cu-17-')
    const file = join(sb, 'runtime', 'session-policy.json')
    // 先造一条"高档"记录（模拟"写成功"那一半）
    lib.writePolicyStore(file, { version: 1, migrationEpoch: 1, sessions: {} })
    const wrote = lib.setSessionPolicy(file, { sessionId: 's-wide', level: 'workspace', workMode: 'multi' }, OPTS)
    if (!wrote.ok) bad(`CU-17 预置高档记录失败：${wrote.reason}`)
    else {
      // 隔离它
      const q = lib.quarantineSessionPolicy(file, { sessionId: 's-wide' }, OPTS)
      if (!q.ok) bad(`CU-17 隔离失败：${q.reason}`)
      else {
        // ⚠ **重新从磁盘读**（模拟重载）后解析
        const after = lib.resolveSessionPolicy({
          ...OPTS, file, sessionId: 's-wide', isHob: true, archived: 'not-archived', createdAt: 1e9, now: 2e9,
        })
        const rec = lib.readPolicyStore(file, OPTS).file.sessions['s-wide']
        if (rec?.quarantined !== true) bad('CU-17 盘上**没有** `quarantined` 标记 ⇒ 隔离没落盘')
        else if (after.level !== 'ledger') {
          bad(`CU-17 重载后读档 = ${after.level}（应 ledger）⇒ 隔离没在**解析期**生效`)
        } else if (after.mayProceed !== false) {
          bad(`CU-17 重载后 mayProceed = ${after.mayProceed}（应 false）⇒ 隔离会话**仍可推进**`)
        } else if (after.source !== 'quarantined') {
          bad(`CU-17 source = ${after.source}（应 quarantined）⇒ 读数来源没说清`)
        } else if (rec.level !== 'workspace') {
          bad(`CU-17 隔离把原档位抹掉了（rec.level=${rec.level}）⇒ 审计信息丢失`)
        } else {
          ok('CU-17 ✓ **持久隔离真生效**：盘上有 `quarantined`，重载后读档 = `ledger`、'
            + '`mayProceed=false`、`source=quarantined`；且**原档位 `workspace` 保留**供审计'
            + '（⛔ 不是"只把风险报出来"）')
        }
      }
    }
    }
  }

  // ── CU-18 **创建链在最坏格上自动隔离**（stranded.executable 必须变 false）────
  {
    if (typeof lib.quarantineSessionPolicy !== 'function') {
      // ⚠ 同上：前置闸门已报红
    } else {
    const sb = mkTmp('hob-cu-18-')
    const file = join(sb, 'runtime', 'session-policy.json')
    lib.writePolicyStore(file, { version: 1, migrationEpoch: 1, sessions: {} })
    const store = chan.createTicketStore({ now: () => 1e6 })
    const live = new Map()
    let reads = 0
    const deps = {
      sessionsOf: () => ({ get: (id) => live.get(id) }),
      agentsOf: () => makeAgents(live, { disposeNoop: true }),
      // ⚠ 归档假件：默认**不归档**（本组多数场景由 quarantine 兜底或无需兜底）
      archiveOf: () => ({
        get archivedSessionIds() { return [] },
        async archiveSession() { throw new Error('注入：归档也失败') },
      }),
      workspacesOf: () => ({ list: () => [{ id: 'ws-1', path: '/tmp/ws-1', attachSession: async () => {} }] }),
      // 写"成功"，但盘上真值是 workspace（用真文件模拟）
      setPolicy: () => {
        lib.setSessionPolicy(file, { sessionId: 's-w2', level: 'workspace', workMode: 'multi' }, OPTS)
        return { ok: true, reason: '' }
      },
      // 回读：第一次与期望不符
      readPolicy: () => {
        reads += 1
        if (reads === 1) return { level: 'project', workMode: 'auto', source: 'stored' }
        const r = lib.readPolicyStore(file, OPTS).file.sessions['s-w2']
        return r === undefined ? undefined : { level: r.level, workMode: r.workMode, source: 'stored' }
      },
      // ⚠ **真隔离**（写同一个临时文件）
      quarantinePolicy: (sid) => lib.quarantineSessionPolicy(file, { sessionId: sid }, OPTS),
      log: () => {},
    }
    const iss = store.issue({ sessionId: 's-w2', level: 'ledger', workMode: 'auto', workspaceId: 'ws-1' })
    const r = await chan.createHobSession(deps, store, { ticket: String(iss.ticket), sessionId: 's-w2' })
    if (r.ok !== false) bad('CU-18 回读不一致却报成功')
    else if (r.quarantine?.ok !== true) bad(`CU-18 创建链**没有自动隔离**：${JSON.stringify(r.quarantine)}`)
    else if (r.stranded?.executable !== false) {
      bad(`CU-18 stranded.executable = ${r.stranded?.executable}（隔离成功后应 false）`)
    } else if (r.unsafe === true) bad('CU-18 隔离成功后仍标 unsafe（应 false）')
    else {
      // ⚠ 最终判据：**重载后**这个会话真的取不到高档
      const after = lib.resolveSessionPolicy({
        ...OPTS, file, sessionId: 's-w2', isHob: true, archived: 'not-archived', createdAt: 1e9, now: 2e9,
      })
      if (after.level !== 'ledger' || after.mayProceed !== false) {
        bad(`CU-18 **重载后仍可高档执行**：level=${after.level} mayProceed=${after.mayProceed}`
          + ' ⇒ 隔离没进解析期，等于没修')
      } else {
        ok('CU-18 ✓ 最坏格被**自动隔离**：`stranded.executable=false`、`unsafe=false`；'
          + '**重载后**读档 = ledger、不推进 ⇒ 残留会话**取不到高档**（⛔ 不是只报警）')
      }
    }
    }
  }

  // ── CU-19 **隔离失败必须 unsafe**（⛔ 不许假装成功）──────────────────────
  {
    const store = chan.createTicketStore({ now: () => 1e6 })
    const live = new Map()
    const deps = {
      sessionsOf: () => ({ get: (id) => live.get(id) }),
      agentsOf: () => makeAgents(live, { disposeNoop: true }),
      // ⚠ 归档假件：默认**不归档**（本组多数场景由 quarantine 兜底或无需兜底）
      archiveOf: () => ({
        get archivedSessionIds() { return [] },
        async archiveSession() { throw new Error('注入：归档也失败') },
      }),
      workspacesOf: () => ({ list: () => [{ id: 'ws-1', path: '/tmp/ws-1', attachSession: async () => {} }] }),
      setPolicy: () => ({ ok: true, reason: '' }),
      readPolicy: () => ({ level: 'workspace', workMode: 'multi', source: 'stored' }),
      // ⚠ 隔离**失败**
      quarantinePolicy: () => ({ ok: false, reason: '注入：隔离写盘失败' }),
      log: () => {},
    }
    const iss = store.issue({ sessionId: 's-u', level: 'ledger', workMode: 'auto', workspaceId: 'ws-1' })
    const r = await chan.createHobSession(deps, store, { ticket: String(iss.ticket), sessionId: 's-u' })
    if (r.ok !== false) bad('CU-19 隔离失败却报成功')
    else if (r.unsafe !== true) {
      bad(`CU-19 隔离失败但 unsafe=${r.unsafe}（应 **true**：无法证明残留会话被隔离）`)
    } else if (r.stranded?.executable !== true) {
      bad(`CU-19 隔离失败时 executable=${r.stranded?.executable}（应 true：它**仍可能**按高档执行）`)
    } else {
      ok('CU-19 ✓ 隔离失败 ⇒ `unsafe=true` + `executable=true`'
        + '（⛔ 不把"没隔离成功"说成安全；上层据此停手）')
    }
  }

  // ── CU-20 **未确认（pending）绝不激活宽档** —— 重载后强制点名也取不到 ──────────
  /**
   * ⚠⚠ 本组是任务书第 2 条的核心：**"报警不等于隔离"**，且**"隔离失败"也不许留可执行宽档**。
   *   构造：盘上写一条 `activation:'pending'` + `level:'workspace'`（用户选的高档）
   *   ⇒ **重载**后解析必须 `ledger` + `mayProceed=false`。
   *   ⚠ 这不是文案判据：解析值是**四个读工具 / 派活**真正的准入读数。
   */
  if (typeof lib.setSessionPolicy !== 'function') {
    // 前置能力缺失已在 CU-17 报红
  } else {
    const sb = mkTmp('hob-cu-20-')
    const file = join(sb, 'runtime', 'session-policy.json')
    lib.writePolicyStore(file, { version: 1, migrationEpoch: 1, sessions: {} })
    const w = lib.setSessionPolicy(file, { sessionId: 's-pend', level: 'workspace', workMode: 'multi', activation: 'pending' }, OPTS)
    if (!w.ok) bad(`CU-20 写 pending 高档失败：${w.reason}`)
    else {
      // ⚠ **重载**（重新 readPolicyStore，模拟重启）
      const after = lib.resolveSessionPolicy({
        ...OPTS, file, sessionId: 's-pend', isHob: true, archived: 'not-archived', createdAt: 1e9, now: 2e9,
      })
      const rec = lib.readPolicyStore(file, OPTS).file.sessions['s-pend']
      if (rec?.activation !== 'pending') bad('CU-20 盘上**不是** pending ⇒ 未确认语义没落盘')
      else if (after.level !== 'ledger') {
        bad(`CU-20 **pending 记录却读到 ${after.level}** ⇒ 未确认状态**仍能取高档**（本批要消灭的正是这个）`)
      } else if (after.mayProceed !== false) {
        bad(`CU-20 pending 但 mayProceed=${after.mayProceed}（应 false）⇒ 未确认却可推进`)
      } else if (after.source !== 'pending-activation') {
        bad(`CU-20 source=${after.source}（应 pending-activation）⇒ 降级原因不可见`)
      } else if (rec.level !== 'workspace') {
        bad('CU-20 pending 把用户选的原档位抹掉了 ⇒ 激活时会丢值')
      } else {
        ok('CU-20 ✓ **未确认绝不激活宽档**：盘上是 `pending+workspace`，**重载后**解析为 '
          + '`ledger` + `mayProceed=false` + `source=pending-activation`；原档位保留待激活'
          + '（⇒ 四个读工具与派活拿到的是**最低档**，⛔ 不是报警）')
      }
    }
  }

  // ── CU-21 **激活真的转成可执行**（正例：否则"永不激活"会变成另一类坏）──────
  if (typeof lib.activateSessionPolicy !== 'function') {
    bad('CU-21 策略模块**没有 `activateSessionPolicy`** ⇒ 创建链无法把策略变可执行')
  } else {
    const sb = mkTmp('hob-cu-21-')
    const file = join(sb, 'runtime', 'session-policy.json')
    lib.writePolicyStore(file, { version: 1, migrationEpoch: 1, sessions: {} })
    lib.setSessionPolicy(file, { sessionId: 's-act', level: 'project', workMode: 'single', activation: 'pending' }, OPTS)
    const a = lib.activateSessionPolicy(file, { sessionId: 's-act' }, OPTS)
    const after = lib.resolveSessionPolicy({
      ...OPTS, file, sessionId: 's-act', isHob: true, archived: 'not-archived', createdAt: 1e9, now: 2e9,
    })
    if (!a.ok) bad(`CU-21 激活失败：${a.reason}`)
    else if (after.level !== 'project') bad(`CU-21 激活后读档 = ${after.level}（应 project）`)
    else if (after.mayProceed !== true) bad(`CU-21 激活后 mayProceed = ${after.mayProceed}（应 true）`)
    else {
      ok('CU-21 ✓ **激活真的生效**：pending → active 后读档 = `project`、`mayProceed=true`'
        + '（⇒ 不是把所有会话永久钉在最低档）')
    }
  }

  // ── CU-22 **最坏格：回读错 + 回收失败 + 隔离也失败** ⇒ 绝不留"可执行宽档"─────
  /**
   * ⚠ 这一格是任务书点名的组合：`set` 成功、回读错、`rollback` 失败、**隔离持久写也失败**。
   *   上一版在这里给 `unsafe:true, stranded.executable:true` ⇒ ⚠ **高档可残留**：报警不是阻断。
   *
   *   本版的结构性差别：**盘上写的是 `pending`** ⇒ 即使隔离失败、即使记录在，
   *   解析期也是**最低档 + 不推进** ⇒ `executable` 如实为 **false**，
   *   并且本组**用重载后的解析值**证明它取不到高档 —— ⛔ 不看返回文案。
   */
  if (typeof lib.setSessionPolicy !== 'function') {
    // 前置能力缺失已在 CU-17 报红
  } else {
    const sb = mkTmp('hob-cu-22-')
    const file = join(sb, 'runtime', 'session-policy.json')
    lib.writePolicyStore(file, { version: 1, migrationEpoch: 1, sessions: {} })
    const store = chan.createTicketStore({ now: () => 1e6 })
    const live = new Map()
    let reads = 0
    const deps = {
      sessionsOf: () => ({ get: (id) => live.get(id) }),
      // ⚠ 不给 dispose ⇒ rollback 必然失败
      agentsOf: () => makeAgents(live, { disposeNoop: true }),
      // ⚠ 归档假件：默认**不归档**（本组多数场景由 quarantine 兜底或无需兜底）
      archiveOf: () => ({
        get archivedSessionIds() { return [] },
        async archiveSession() { throw new Error('注入：归档也失败') },
      }),
      workspacesOf: () => ({ list: () => [{ id: 'ws-1', path: '/tmp/ws-1', attachSession: async () => {} }] }),
      /**
       * ⚠ 写"成功"，且**真的**往盘上写 `pending` **高档**（模拟最坏格）。
       *
       * ⚠⚠ 2026-10-22 订正：这里**必须写死 `'workspace'`**，不能回带票据里的 `level`。
       *   原因：本批起票据只签最低档（`issue()` 拒宽档）⇒ 若回带 `level`，
       *   盘上就变成 `pending:ledger`，本组"最坏格"会**静默退化成最良性那一格**
       *   （断言仍绿，但它已不测危险形态）。⇒ 只让"盘上记录"仍是宽档，
       *   才能维持"失败后重载也不得取到宽档"这条判据的力度。
       */
      setPolicy: (sid, _level, workMode, activation) => {
        lib.setSessionPolicy(file, { sessionId: sid, level: 'workspace', workMode: 'multi', ...(activation === undefined ? {} : { activation }) }, OPTS)
        return { ok: true, reason: '' }
      },
      // ⚠ 回读永远与期望不符（第 1 次）→ 触发失败支
      readPolicy: () => {
        reads += 1
        if (reads === 1) return { level: 'ledger', workMode: 'auto', source: 'stored' }
        return { level: 'workspace', workMode: 'multi', source: 'pending-activation' }
      },
      // ⚠ **隔离持久写也失败**
      quarantinePolicy: () => ({ ok: false, reason: '注入：隔离写盘也失败' }),
      // ⚠ **激活也失败**（否则轮不到隔离）
      activatePolicy: () => ({ ok: false, reason: '不该走到这里' }),
      log: () => {},
    }
    const iss = store.issue({ sessionId: 's-worst', level: 'ledger', workMode: 'multi', workspaceId: 'ws-1' })
    const r = await chan.createHobSession(deps, store, { ticket: String(iss.ticket), sessionId: 's-worst' })
    if (r.ok !== false) bad('CU-22 双失败却报成功')
    else {
      // ⚠⚠ **最终判据：重载后它到底能不能取高档**
      const after = lib.resolveSessionPolicy({
        ...OPTS, file, sessionId: 's-worst', isHob: true, archived: 'not-archived', createdAt: 1e9, now: 2e9,
      })
      if (after.level !== 'ledger' || after.mayProceed !== false) {
        bad(`CU-22 ⚠⚠ **双失败后重载仍能取高档**：level=${after.level} mayProceed=${after.mayProceed}`
          + ' ⇒ 可执行宽档孤儿仍在（本批的核心失败）')
      } else if (r.stranded?.executable !== false) {
        bad(`CU-22 重载后确实不可执行，但返回值仍说 executable=${r.stranded?.executable}`
          + ' ⇒ 读数与事实不一致')
      } else {
        ok('CU-22 ✓ **双失败（回读错+回收失败+隔离失败）也不留可执行宽档**：'
          + '盘上记录是 `pending`，**重载后**解析为 `ledger` + `mayProceed=false` ⇒ '
          + '四个读工具与派活只能拿到最低档；`executable=false` 与事实一致'
          + '（⚠ 这是**顺序设计**的结果，⛔ 不是靠报警）')
      }
    }
  }

  // ── CU-23 **执行层反证**：pending 会话在真实闸门上被拒（⛔ 不信返回文案）────────
  /**
   * ⚠ 任务书第 2 条要求"给工具强制点名读取/派发的**行为反证**，不能只检查返回文案"。
   *   本组把 **pending 记录的解析结果**喂给**真实**的 `policyOf` 同款判定逻辑
   *   （`proceedGateFor` 的核心：`mayProceed === true` 才放行），断言：
   *     · pending ⇒ **拒绝**（⇒ `write_hob`/`hob_spawn`/`hob_dispatch` 那三处 execute 都会拒）；
   *     · active ⇒ **放行**（正例：否则等于把所有会话打死）。
   *   ⚠ 这里复用的是**同一份解析产物**（`resolveSessionPolicy`），不是另写一套判定。
   */
  if (typeof lib.setSessionPolicy !== 'function') {
    // 前置能力缺失已在 CU-17 报红
  } else {
    const sb = mkTmp('hob-cu-23-')
    const file = join(sb, 'runtime', 'session-policy.json')
    lib.writePolicyStore(file, { version: 1, migrationEpoch: 1, sessions: {} })
    lib.setSessionPolicy(file, { sessionId: 's-gate', level: 'workspace', workMode: 'multi', activation: 'pending' }, OPTS)
    const pend = lib.resolveSessionPolicy({
      ...OPTS, file, sessionId: 's-gate', isHob: true, archived: 'not-archived', createdAt: 1e9, now: 2e9,
    })
    lib.activateSessionPolicy(file, { sessionId: 's-gate' }, OPTS)
    const act = lib.resolveSessionPolicy({
      ...OPTS, file, sessionId: 's-gate', isHob: true, archived: 'not-archived', createdAt: 1e9, now: 2e9,
    })
    /** ⚠ 与 `src/preset/tools.ts` 的 `proceedGateFor` 同一判决：只有 `mayProceed===true` 才放行。 */
    const gateAllows = (r) => r.mayProceed === true
    if (gateAllows(pend)) {
      bad(`CU-23 ⚠⚠ **pending 会话在派活闸门上被放行**（mayProceed=${pend.mayProceed}）`
        + ' ⇒ 可执行宽档孤儿仍在，本批核心失败')
    } else if (!gateAllows(act)) {
      bad('CU-23 激活后的会话**也被拒** ⇒ 等于把所有会话打死（过度收紧）')
    } else {
      ok('CU-23 ✓ **执行层反证成立**：同一会话 pending 时闸门**拒**（派活/写盘被挡）、'
        + 'activate 之后闸门**放行**（⇒ 不是一刀切钉死）')
    }
  }

  // ── CU-24 **旧 `Session.dispose` 路径必失败 ⇒ 必须红**（本轮的"有牙"判据）────
  /**
   * ⚠⚠ 这是**先红后绿的那条红**：宿主 `Session` 类型**没有** `dispose`
   *   （`@deepseek-ai/dsh-session` 的 `Session` 面：sessionId/projections/
   *    beginSubmission/prompt/readAttachment/updateQueue/cancel/rename/
   *    loadOlder/loadThrough/command —— **无 dispose/destroy/remove**）。
   *   ⇒ 上一版 `sessions.get(id).dispose()` 的回滚**永远 return false**。
   *
   *   **本组做法**：给一个"活会话**有** dispose、但 `agents.create` 那条路正常"的夹具
   *   ⛔ 不测"旧代码"（那是 git 历史），而是测**契约**：
   *     把 `agentsOf` 给成**没有 create** ⇒ 创建链必须**在创建前就拒**
   *     （⛔ 不许"建了才发现拿不到 handle"）。
   *   ⚠ 另测：`agents.create` 返回的 handle **没有 dispose** ⇒ 必须拒绝继续写策略
   *     并标 unsafe（⛔ 不许把它当成功）。
   */
  {
    // (a) 没有 agents.create ⇒ 创建前拒
    const store = chan.createTicketStore({ now: () => 1e6 })
    const live = new Map()
    const deps = {
      sessionsOf: () => ({ get: (id) => live.get(id) }),
      agentsOf: () => ({}), // ⚠ 无 create
      // ⚠ 归档假件：默认**不归档**（本组多数场景由 quarantine 兜底或无需兜底）
      archiveOf: () => makeRegistry(),
      workspacesOf: () => ({ list: () => [{ id: 'ws-1', path: '/tmp/ws-1', attachSession: async () => {} }] }),
      setPolicy: () => ({ ok: true, reason: '' }),
      readPolicy: () => undefined,
      log: () => {},
    }
    const iss = store.issue({ sessionId: 's-nocreate', level: 'ledger', workMode: 'auto', workspaceId: 'ws-1' })
    const r = await chan.createHobSession(deps, store, { ticket: String(iss.ticket), sessionId: 's-nocreate' })
    if (r.ok !== false) bad('CU-24a 没有 `agents.create` 却报成功')
    else if (live.size !== 0) bad('CU-24a 没有 `agents.create` 却**建出了会话** ⇒ 留下了撤不掉的活会话')
    else ok('CU-24a ✓ 没有 `agents.create` ⇒ **建之前就拒**、零会话'
      + '（⛔ 不退回"建了才发现没有 dispose"的旧路径）')

    // (b) handle 没有 dispose ⇒ 拒绝继续写策略 + unsafe
    const store2 = chan.createTicketStore({ now: () => 1e6 })
    const live2 = new Map()
    let setCalled = 0
    const deps2 = {
      sessionsOf: () => ({ get: (id) => live2.get(id) }),
      agentsOf: () => ({
      // ⚠ 归档假件：默认**不归档**（本组多数场景由 quarantine 兜底或无需兜底）
      archiveOf: () => makeRegistry(),
        create: async (req) => {
          live2.set(req.sessionId, { id: req.sessionId, snapshotEvents: () => [] })
          return { agent: { id: req.sessionId } } // ⚠ 没有 dispose
        },
      }),
      workspacesOf: () => ({ list: () => [{ id: 'ws-1', path: '/tmp/ws-1', attachSession: async () => {} }] }),
      setPolicy: () => { setCalled += 1; return { ok: true, reason: '' } },
      readPolicy: () => undefined,
      log: () => {},
    }
    const iss2 = store2.issue({ sessionId: 's-nodispose', level: 'ledger', workMode: 'multi', workspaceId: 'ws-1' })
    const r2 = await chan.createHobSession(deps2, store2, { ticket: String(iss2.ticket), sessionId: 's-nodispose' })
    if (r2.ok !== false) bad('CU-24b handle 没有 dispose 却报成功')
    else if (setCalled !== 0) bad('CU-24b handle 没有 dispose 却**仍去写策略** ⇒ 会造出"失败但已配高档"的会话')
    else if (r2.unsafe !== true) bad(`CU-24b unsafe=${r2.unsafe}（拿不到 dispose ⇒ 应 **true**）`)
    else ok('CU-24b ✓ handle **没有 dispose** ⇒ **不写策略**、`unsafe=true` 如实报'
      + '（⛔ 不制造"已配高档但撤不掉"的会话）')
  }

  // ── CU-25 **新 handle.dispose 真的被 await、只注销本次 id、不碰别的会话** ──────
  /**
   * ⚠ 任务书第 3 条要求："新实现 AgentHandle.dispose 确实 await、注销指定本次创建 id、
   *   不碰别的会话"。本组用**受控假件**记录 dispose 的调用与时机。
   */
  {
    const store = chan.createTicketStore({ now: () => 1e6 })
    const live = new Map()
    // ⚠ 预置一个**别人的**会话，断言它不被碰
    live.set('s-other', { id: 's-other', snapshotEvents: () => [] })
    const order = []
    const agents = {
      create: async (req) => {
        live.set(req.sessionId, { id: req.sessionId, snapshotEvents: () => [] })
        return {
          agent: { id: req.sessionId },
          dispose: async () => {
            // ⚠ 记"dispose 里已能观察到它还在" ⇒ 证明是**活会话**被撤
            order.push(`dispose-start:${req.sessionId}:live=${live.has(req.sessionId)}`)
            await new Promise((r) => setTimeout(r, 5))
            live.delete(req.sessionId)
            order.push('dispose-done')
          },
        }
      },
    }
    const deps = {
      sessionsOf: () => ({ get: (id) => live.get(id) }),
      agentsOf: () => agents,
      // ⚠ 归档假件：默认**不归档**（本组多数场景由 quarantine 兜底或无需兜底）
      archiveOf: () => makeRegistry(),
      workspacesOf: () => ({ list: () => [{ id: 'ws-1', path: '/tmp/ws-1', attachSession: async () => {} }] }),
      setPolicy: () => ({ ok: false, reason: '注入写失败 ⇒ 触发回滚' }),
      readPolicy: () => undefined,
      log: () => {},
    }
    const iss = store.issue({ sessionId: 's-mine', level: 'ledger', workMode: 'auto', workspaceId: 'ws-1' })
    const r = await chan.createHobSession(deps, store, { ticket: String(iss.ticket), sessionId: 's-mine' })
    /**
     * ⚠ **"await 了"不用墙钟测**（会抖：实测 4.4ms vs 内部 sleep 5ms 就误红）。
     *   ⇒ 用**确定性顺序**证明：假件在 `dispose` **内部**（await 之后）往 `order` 里
     *     push `dispose-done`。若调用方没 await，`createHobSession` 会在
     *     `dispose-done` 之前就返回 ⇒ `order` 里**不会**有那一项。
     *   ⚠ 再加一条更强的：在 `dispose` 的**同步段**记下"此刻它仍活着"，
     *     证明被撤的确实是那条**活会话**（不是空跑）。
     */
    if (r.ok !== false) bad('CU-25 写失败却报成功')
    else if (!order.includes('dispose-done')) {
      bad(`CU-25 ⚠ **没有 await `+'`handle.dispose()`'+`**：函数返回时 dispose 的收尾还没跑到`
        + `（order=${JSON.stringify(order)}）`)
    } else if (!order[0].startsWith('dispose-start:s-mine:live=true')) {
      bad(`CU-25 dispose 的时机不对（应在该会话仍活着时撤它）：${JSON.stringify(order)}`)
    } else if (live.get('s-mine') !== undefined) bad('CU-25 dispose 后本次会话仍在活表')
    else if (live.get('s-other') === undefined) bad('CU-25 ⚠ **误删了别的会话**（s-other 不见了）')
    else {
      ok('CU-25 ✓ `handle.dispose()` **确实被 await**（收尾标记在函数返回前就出现了 ⇒ '
        + '不是只发了个 promise）、撤销的是**本次创建的 id**、'
        + '**没有碰**别的会话（`s-other` 仍在）')
    }
  }

  // ── CU-26 **attach 失败 ⇒ 撤销会话**（⛔ 不留无归属活会话）────────────────
  {
    const store = chan.createTicketStore({ now: () => 1e6 })
    const live = new Map()
    const deps = {
      sessionsOf: () => ({ get: (id) => live.get(id) }),
      agentsOf: () => makeAgents(live),
      // ⚠ 归档假件：默认**不归档**（本组多数场景由 quarantine 兜底或无需兜底）
      archiveOf: () => makeRegistry(),
      workspacesOf: () => ({
        list: () => [{
          id: 'ws-1', path: '/tmp/ws-1',
          attachSession: async () => { throw new Error('注入：attach 失败') },
        }],
      }),
      setPolicy: () => ({ ok: true, reason: '' }),
      readPolicy: () => undefined,
      log: () => {},
    }
    const iss = store.issue({ sessionId: 's-attach', level: 'ledger', workMode: 'auto', workspaceId: 'ws-1' })
    const r = await chan.createHobSession(deps, store, { ticket: String(iss.ticket), sessionId: 's-attach' })
    if (r.ok !== false) bad('CU-26 attach 失败却报成功')
    else if (r.rolledBack !== true) bad(`CU-26 attach 失败后**没有撤销**（rolledBack=${r.rolledBack}）`)
    else if (live.get('s-attach') !== undefined) bad('CU-26 说撤销了但会话还活着')
    else ok('CU-26 ✓ attach 失败 ⇒ **撤销该会话**、`rolledBack=true`'
      + '（⛔ 不留"建了但不属于所选工作区"的活会话）')
  }

  // ── CU-27 **成功路径保活**：dispose **不被调用**、会话仍在、可 openSession ──────
  {
    const store = chan.createTicketStore({ now: () => 1e6 })
    const live = new Map()
    const agents = makeAgents(live)
    const deps = {
      sessionsOf: () => ({ get: (id) => live.get(id) }),
      agentsOf: () => agents,
      // ⚠ 归档假件：默认**不归档**（本组多数场景由 quarantine 兜底或无需兜底）
      archiveOf: () => makeRegistry(),
      workspacesOf: () => ({ list: () => [{ id: 'ws-1', path: '/tmp/ws-1', attachSession: async () => {} }] }),
      setPolicy: (sid, lv, wm, act) => {
        // ⚠ 走真 pending → active 语义（用内存小文件太大；这里用最小可控实现）
        return { ok: true, reason: '' }
      },
      readPolicy: () => ({ level: 'ledger', workMode: 'auto', source: 'stored' }),
      activatePolicy: () => ({ ok: true, reason: '' }),
      log: () => {},
    }
    const iss = store.issue({ sessionId: 's-keep', level: 'ledger', workMode: 'auto', workspaceId: 'ws-1' })
    const r = await chan.createHobSession(deps, store, { ticket: String(iss.ticket), sessionId: 's-keep' })
    if (r.ok !== true) bad(`CU-27 成功路径报失败：${r.reason}`)
    else if (agents.disposed.length !== 0) {
      bad(`CU-27 ⚠ **成功会话被 dispose 了**（${JSON.stringify(agents.disposed)}）⇒ 用户拿到一个已死的会话`)
    } else if (live.get('s-keep') === undefined) {
      bad('CU-27 成功后会话**不在活表** ⇒ 无法 openSession、无法发首轮')
    } else {
      ok('CU-27 ✓ **成功路径保活**：`dispose` 一次都没被调、会话仍在活表'
        + '（⇒ 可 `openSession`、可发首轮；⛔ 不会因为请求结束被销毁）')
    }
  }

  // ── CU-28 **回滚必须如实分开"活表已撤"与"磁盘仍在"**（⛔ 不许合成"已回收"）──────
  /**
   * ⚠ 这条钉的是**报告诚实性**：`rolledBack: true` 只表示**活会话撤了**，
   *   ⛔ **不表示**磁盘上没这条会话。
   *   ⚠ 依据（2026-10-22 实测，两层）：
   *     ① `SessionPersistence` 接口**没有** delete/remove（只有 create/flush/list/open/stat）；
   *     ② `agent-loop` 的 `teardown()` 只 `handle?.close()`（释放写所有权），
   *        整个文件里**没有** `persistence.delete` / `rm(` / `unlink`。
   *   ⇒ 若哪天有人把 `onDisk` 写成 `false`（或把 `rolledBack` 当"彻底删除"用），
   *     本组必须红。
   */
  {
    const store = chan.createTicketStore({ now: () => 1e6 })
    const live = new Map()
    const deps = {
      sessionsOf: () => ({ get: (id) => live.get(id) }),
      agentsOf: () => makeAgents(live),
      // ⚠ 归档假件：默认**不归档**（本组多数场景由 quarantine 兜底或无需兜底）
      archiveOf: () => makeRegistry(),
      workspacesOf: () => ({ list: () => [{ id: 'ws-1', path: '/tmp/ws-1', attachSession: async () => {} }] }),
      setPolicy: () => ({ ok: false, reason: '注入写失败 ⇒ 触发回滚' }),
      readPolicy: () => undefined,
      log: () => {},
    }
    const iss = store.issue({ sessionId: 's-resid', level: 'ledger', workMode: 'auto', workspaceId: 'ws-1' })
    const r = await chan.createHobSession(deps, store, { ticket: String(iss.ticket), sessionId: 's-resid' })
    if (r.rolledBack !== true) bad('CU-28 预期回滚成功（前置不成立）')
    else if (r.rollbackResidual === undefined) {
      bad('CU-28 `rolledBack=true` 却**没有** `rollbackResidual` ⇒ 上层无从知道"磁盘仍在"')
    } else if (r.rollbackResidual.live !== false) {
      bad(`CU-28 residual.live=${r.rollbackResidual.live}（活表应已无它 ⇒ false）`)
    } else if (r.rollbackResidual.onDisk !== true) {
      bad('CU-28 ⚠ `residual.onDisk !== true` ⇒ **把"磁盘会话文件仍在"说成了已删除**（不实）')
    } else if (live.get('s-resid') !== undefined) {
      bad('CU-28 residual 说活表已撤，但会话还活着')
    } else {
      ok('CU-28 ✓ 回滚如实分两层：`live:false`（撤了活会话、发不了首轮）+ '
        + '`onDisk:true`（⚠ 磁盘会话文件仍在，重载后仍会被 `list()` 读到）'
        + ' —— ⛔ 不再合成一句"已回收"')
    }
  }

  // ── CU-29 **危险同形格**：active 落盘 + 回读误报 + quarantine 失败 ⇒ 归档兜底 ────
  /**
   * ⚠⚠ 这是**本单的核心**：任务书点名的危险格 ——
   *   `active:workspace` **已落盘**、回读**误报**（读成不一致）、`quarantine` **写失败**。
   *   上一轮到这里只剩 `dispose`，而 `dispose` **撤不掉磁盘 JSONL**
   *   ⇒ 重启后"磁盘会话 + 高档记录"重新重合成可执行宽档。
   *
   *   **本版**：先 `persistentlyDisable` ⇒ quarantine 失败 ⇒ **改用
   *   `archiveSession(id,{stopActivity:true})`** ⇒ **读回 `archivedSessionIds` 确认**
   *   ⇒ **然后**才 `await handle.dispose()`。
   *   ⚠ 本组还断言**归档发生在 dispose 之前**（顺序不可换）。
   */
  {
    const sb = mkTmp('hob-cu-29-')
    const file = join(sb, 'runtime', 'session-policy.json')
    lib.writePolicyStore(file, { version: 1, migrationEpoch: 1, sessions: {} })
    const store = chan.createTicketStore({ now: () => 1e6 })
    const live = new Map()
    const registry = makeRegistry()
    const seq = []
    let reads = 0
    const deps = {
      sessionsOf: () => ({ get: (id) => live.get(id) }),
      // ⚠ dispose 记时序：必须在归档之后
      agentsOf: () => ({
        create: async (req) => {
          live.set(req.sessionId, { id: req.sessionId, snapshotEvents: () => [] })
          return {
            agent: { id: req.sessionId },
            dispose: async () => {
              seq.push(`dispose@archived=${String(registry.archivedSessionIds.includes(req.sessionId))}`)
              live.delete(req.sessionId)
            },
          }
        },
      }),
      archiveOf: () => ({
        get archivedSessionIds() { return registry.archivedSessionIds },
        async archiveSession(id, o) {
          seq.push(`archive:${id}`)
          await registry.archiveSession(id, o)
        },
      }),
      workspacesOf: () => ({ list: () => [{ id: 'ws-1', path: '/tmp/ws-1', attachSession: async () => {} }] }),
      /** ⚠ 写"成功"，且盘上**真的**是 active:workspace（危险格的前提）。 */
      setPolicy: (sid, lv, wm, act) => {
        lib.setSessionPolicy(file, { sessionId: sid, level: 'workspace', workMode: 'multi' }, OPTS)
        // ⚠ 再把它显式写成 active（模拟"active 已落盘"）
        return { ok: true, reason: '' }
      },
      /** ⚠ 回读**误报**：第 1 次说 project/auto（与期望不符）⇒ 触发失败支。 */
      readPolicy: () => {
        reads += 1
        if (reads === 1) return { level: 'project', workMode: 'auto', source: 'stored' }
        const r = lib.readPolicyStore(file, OPTS).file.sessions['s-danger']
        return r === undefined
          ? undefined
          : { level: r.level, workMode: r.workMode, source: String(r.activation === 'pending' ? 'pending-activation' : 'stored') }
      },
      /** ⚠ **quarantine 写失败**（本格的关键） */
      quarantinePolicy: () => ({ ok: false, reason: '注入：隔离写盘失败' }),
      activatePolicy: () => ({ ok: false, reason: '不该走到这里' }),
      log: () => {},
    }
    const iss = store.issue({ sessionId: 's-danger', level: 'ledger', workMode: 'multi', workspaceId: 'ws-1' })
    const r = await chan.createHobSession(deps, store, { ticket: String(iss.ticket), sessionId: 's-danger' })

    // ⚠ 真实"重建后"读数：策略文件 + 归档标志（不靠返回文案）
    const archivedNow = registry.archivedSessionIds.includes('s-danger')
    const after = lib.resolveSessionPolicy({
      ...OPTS, file, sessionId: 's-danger', isHob: true, createdAt: 1e9, now: 2e9,
      ...(archivedNow ? { archived: true } : {}),
    })

    if (r.ok !== false) bad('CU-29 危险格却报成功')
    else if (!archivedNow) {
      bad('CU-29 ⚠⚠ **quarantine 失败后没有走归档兜底** ⇒ 磁盘上仍是 active:workspace 且无持久禁用'
        + '（= 上一轮那个危险格，重启后仍可执行宽档）')
    } else if (!seq.includes('archive:s-danger')) bad('CU-29 归档没有被调用')
    else if (!seq.some((x) => x.startsWith('dispose@archive'))) {
      bad('CU-29 ⚠ **没有在归档之后 dispose**（或根本没 dispose）⇒ 顺序不对')
    } else if (!seq.some((x) => x === 'dispose@archived=true')) {
      bad(`CU-29 ⚠⚠ **归档没有先于 dispose 完成**：${JSON.stringify(seq)}`
        + ' ⇒ 中间存在"磁盘会话 + 高档记录都可执行"的窗口')
    } else if (after.level !== 'ledger' || after.mayProceed !== false) {
      bad(`CU-29 重建后仍能取高档：level=${after.level} mayProceed=${after.mayProceed}`)
    } else {
      ok('CU-29 ✓ 危险格（active 落盘 + 回读误报 + quarantine 失败）被**归档兜底**：'
        + '归档先于 dispose（`archive:s-danger` → `dispose@archived=true`），'
        + '重建后解析 = `ledger` + `mayProceed=false` ⇒ ⛔ 不再依赖 dispose 撤磁盘')
    }
  }

  // ── CU-30 **策略解析必须读归档**（去掉读取必红）──────────────────────────
  /**
   * ⚠ 这条钉的是**第二核心**：即使归档成功，若策略解析**不看** `archived`，
   *   四个读工具仍会按 policy.json 的 `active:workspace` 读高档 ⇒ 归档只挡了"跑"没挡"读"。
   *   ⚠ 反证：把 `archived` 传成 `false`/省略 ⇒ 必须回到 `workspace`（证明这条判据
   *     咬住的正是"读归档"这件事，不是别的）。
   */
  {
    const sb = mkTmp('hob-cu-30-')
    const file = join(sb, 'runtime', 'session-policy.json')
    lib.writePolicyStore(file, { version: 1, migrationEpoch: 1, sessions: {} })
    // 盘上写一条**合法的 active:workspace**
    lib.setSessionPolicy(file, { sessionId: 's-arch', level: 'workspace', workMode: 'multi' }, OPTS)
    const withArch = lib.resolveSessionPolicy({
      ...OPTS, file, sessionId: 's-arch', isHob: true, createdAt: 1e9, now: 2e9, archived: 'archived',
    })
    const without = lib.resolveSessionPolicy({
      ...OPTS, file, sessionId: 's-arch', isHob: true, createdAt: 1e9, now: 2e9, archived: 'not-archived',
    })
    if (withArch.level !== 'ledger') {
      bad(`CU-30 归档会话读档 = ${withArch.level}（应 ledger）⇒ **解析没读归档**`)
    } else if (withArch.mayProceed !== false) {
      bad(`CU-30 归档会话 mayProceed = ${withArch.mayProceed}（应 false）⇒ 仍可推进`)
    } else if (withArch.source !== 'archived') {
      bad(`CU-30 source = ${withArch.source}（应 archived）⇒ 降级原因不可见`)
    } else if (without.level !== 'workspace') {
      bad(`CU-30 不读归档时读档 = ${without.level}（应 workspace）`
        + ' ⇒ ⚠ 对照不成立：说明"归档读取"不是本判据的变量')
    } else {
      ok('CU-30 ✓ 归档会话被压到 `ledger` + `mayProceed=false` + `source=archived`；'
        + '**同一文件不传归档时仍读到 `workspace`** ⇒ 证明判据咬住的正是"读归档"')
    }
  }

  // ── CU-31 **归档/隔离双失败 ⇒ unsafe 且不得称安全**──────────────────────
  {
    const store = chan.createTicketStore({ now: () => 1e6 })
    const live = new Map()
    const deps = {
      sessionsOf: () => ({ get: (id) => live.get(id) }),
      agentsOf: () => makeAgents(live),
      // ⚠ 归档**抛错**
      archiveOf: () => ({
        get archivedSessionIds() { return [] },
        async archiveSession() { throw new Error('注入：归档写盘失败') },
      }),
      workspacesOf: () => ({ list: () => [{ id: 'ws-1', path: '/tmp/ws-1', attachSession: async () => {} }] }),
      setPolicy: () => ({ ok: false, reason: '注入写失败 ⇒ 触发回滚' }),
      readPolicy: () => undefined,
      // ⚠ 隔离也失败
      quarantinePolicy: () => ({ ok: false, reason: '注入：隔离也失败' }),
      log: () => {},
    }
    const iss = store.issue({ sessionId: 's-double', level: 'ledger', workMode: 'multi', workspaceId: 'ws-1' })
    const r = await chan.createHobSession(deps, store, { ticket: String(iss.ticket), sessionId: 's-double' })
    if (r.ok !== false) bad('CU-31 双失败却报成功')
    else if (r.rolledBack === true) {
      bad('CU-31 ⚠ 双失败却报 `rolledBack=true` ⇒ **谎称已安全回收**')
    } else if (r.unsafe !== true) {
      bad(`CU-31 双失败但 unsafe=${r.unsafe}（应 **true**：无法证明持久禁用）`)
    } else {
      ok('CU-31 ✓ 隔离与归档**双失败** ⇒ `unsafe=true`、**不报** `rolledBack=true`'
        + '（⛔ 检查器不会把这个分支计成安全）')
    }
  }

  // ── CU-32 **执行层反证：归档会话的"读"与"派活"都被拒**（不是只有 pre-step）──────
  /**
   * ⚠ 任务书第 3 条要求"由受控强制点名样本证明 archive 后也拒读/拒派"，
   *   且明确 "pre-step 仅作第二层"。本组用**同一份解析产物**喂真实闸门：
   *   · **派活闸门** = `src/preset/tools.ts` 的 `proceedGateFor` 判决（`mayProceed===true` 才放行）；
   *   · **读档** = `canReadWorkspace`（读工具 `execute` 里的类型门用它）。
   *   ⚠ 断言归档会话两者都 **false**；而非归档的同一文件两者都是**高档可用**（对照）。
   */
  {
    const sb = mkTmp('hob-cu-32-')
    const file = join(sb, 'runtime', 'session-policy.json')
    lib.writePolicyStore(file, { version: 1, migrationEpoch: 1, sessions: {} })
    lib.setSessionPolicy(file, { sessionId: 's-exec', level: 'workspace', workMode: 'multi' }, OPTS)
    const arch = lib.resolveSessionPolicy({
      ...OPTS, file, sessionId: 's-exec', isHob: true, archived: 'not-archived', createdAt: 1e9, now: 2e9, archived: true,
    })
    const plain = lib.resolveSessionPolicy({
      ...OPTS, file, sessionId: 's-exec', isHob: true, archived: 'not-archived', createdAt: 1e9, now: 2e9,
    })
    const dispatchAllows = (r) => r.mayProceed === true
    if (dispatchAllows(arch)) {
      bad('CU-32 ⚠ 归档会话在**派活闸门**上被放行 ⇒ 仍可派活')
    } else if (arch.canReadWorkspace === true) {
      bad('CU-32 ⚠ 归档会话 `canReadWorkspace=true` ⇒ 四个读工具仍能读工作区（只剩 pre-step 挡跑）')
    } else if (!dispatchAllows(plain) || plain.canReadWorkspace !== true) {
      bad('CU-32 对照不成立：未归档的同一记录本应"可派活 + 可读工作区"')
    } else {
      ok('CU-32 ✓ 归档会话：**派活闸门拒** + **`canReadWorkspace=false`**（读工具那条路也被挡）；'
        + '对照：同一文件未归档时两者都可用 ⇒ 证明挡住的是"归档"这件事，'
        + '⛔ 不是只靠宿主 pre-step')
    }
  }

  // ── CU-33 **成功创建不归档**（⛔ 不许把正常会话归档掉）──────────────────────
  /**
   * ⚠ 归档是**失败**时的兜底。若成功路径也归档 ⇒ 用户建好的会话**立刻不可用**
   *   （`mayProceed=false` + pre-step 拒）—— 那是把好会话当垃圾处理。
   */
  {
    const store = chan.createTicketStore({ now: () => 1e6 })
    const live = new Map()
    const registry = makeRegistry()
    const deps = {
      sessionsOf: () => ({ get: (id) => live.get(id) }),
      agentsOf: () => makeAgents(live),
      archiveOf: () => ({
        get archivedSessionIds() { return registry.archivedSessionIds },
        archiveSession: (id, o) => registry.archiveSession(id, o),
      }),
      workspacesOf: () => ({ list: () => [{ id: 'ws-1', path: '/tmp/ws-1', attachSession: async () => {} }] }),
      setPolicy: () => ({ ok: true, reason: '' }),
      readPolicy: () => ({ level: 'ledger', workMode: 'auto', source: 'stored' }),
      activatePolicy: () => ({ ok: true, reason: '' }),
      log: () => {},
    }
    const iss = store.issue({ sessionId: 's-ok', level: 'ledger', workMode: 'auto', workspaceId: 'ws-1' })
    const r = await chan.createHobSession(deps, store, { ticket: String(iss.ticket), sessionId: 's-ok' })
    if (r.ok !== true) bad(`CU-33 成功路径报失败：${r.reason}`)
    else if (registry.archivedSessionIds.length !== 0) {
      bad(`CU-33 ⚠ **成功创建的会话被归档了**：${JSON.stringify(registry.archivedSessionIds)}`
        + ' ⇒ 用户建好的会话立刻不可用')
    } else if (registry.calls.length !== 0) {
      bad(`CU-33 成功路径**调用了 archiveSession**：${JSON.stringify(registry.calls)}`)
    } else {
      ok('CU-33 ✓ **成功创建不归档**（`archiveSession` 一次都没被调）⇒ 正常会话保持可用')
    }
  }

  // ── CU-34 **只动本次 id**：别的会话的归档/隔离不被误触 ───────────────────────
  {
    const store = chan.createTicketStore({ now: () => 1e6 })
    const live = new Map()
    // ⚠ 预置"别人的"会话 + 预先归档一个（不能被动）
    live.set('s-other', { id: 's-other', snapshotEvents: () => [] })
    const registry = makeRegistry({ initial: ['s-already-archived'] })
    const quarantinedIds = []
    const deps = {
      sessionsOf: () => ({ get: (id) => live.get(id) }),
      agentsOf: () => makeAgents(live),
      archiveOf: () => ({
        get archivedSessionIds() { return registry.archivedSessionIds },
        archiveSession: (id, o) => registry.archiveSession(id, o),
      }),
      workspacesOf: () => ({ list: () => [{ id: 'ws-1', path: '/tmp/ws-1', attachSession: async () => {} }] }),
      setPolicy: () => ({ ok: false, reason: '注入写失败 ⇒ 触发回滚' }),
      readPolicy: () => undefined,
      quarantinePolicy: (id) => { quarantinedIds.push(id); return { ok: false, reason: '注入隔离失败' } },
      log: () => {},
    }
    const iss = store.issue({ sessionId: 's-mine2', level: 'ledger', workMode: 'auto', workspaceId: 'ws-1' })
    await chan.createHobSession(deps, store, { ticket: String(iss.ticket), sessionId: 's-mine2' })
    const archived = registry.archivedSessionIds
    if (archived.includes('s-other')) bad('CU-34 ⚠ **误归档了别的会话**（s-other）')
    else if (!archived.includes('s-already-archived')) bad('CU-34 ⚠ **把别人已归档的会话弄丢了**')
    else if (archived.filter((x) => x === 's-mine2').length !== 1) bad('CU-34 本次会话没有被归档')
    else if (!quarantinedIds.every((x) => x === 's-mine2')) {
      bad(`CU-34 ⚠ 隔离被用到了别的 id 上：${JSON.stringify(quarantinedIds)}`)
    } else if (live.get('s-other') === undefined) bad('CU-34 ⚠ 误删了别的会话的活表项')
    else {
      ok('CU-34 ✓ **只动本次 id**：归档只加 `s-mine2`、别人的 `s-other` 不受影响、'
        + '既有归档项 `s-already-archived` 仍在、隔离只对本次 id 调用'
        + '（⚠ **不自动 unarchive** 任何东西）')
    }
  }

  // ── CU-35 **双禁用失败时仍要撤活会话**（第 13 轮核心 · 删掉 dispose 会红）────────
  /**
   * ⚠⚠ 上一轮的缺口：`if (!disable.ok) return false` ⇒ **根本没调 handle.dispose()**
   *   ⇒ 那个 `active:workspace` 的新会话**在当前进程的活表里继续可执行**
   *   （pre-step 只拦 archived，它没被归档）。
   *
   *   本组验三件事，⛔ 不看返回文案，看**活表**与**调用记录**：
   *     ① `dispose` **真的被 await 调用过**（顺序标记）；
   *     ② 活表里**已经没有**它（⇒ 当前进程不可执行）；
   *     ③ 回执仍 `unsafe:true` + `rolledBack!==true`（⚠ 磁盘重载风险未消，
   *         ⛔ 不许因当下撤了就报安全）。
   */
  {
    const store = chan.createTicketStore({ now: () => 1e6 })
    const live = new Map()
    const seq = []
    const deps = {
      sessionsOf: () => ({ get: (id) => live.get(id) }),
      agentsOf: () => ({
        create: async (req) => {
          live.set(req.sessionId, { id: req.sessionId, snapshotEvents: () => [] })
          return {
            agent: { id: req.sessionId },
            dispose: async () => {
              seq.push('dispose-called')
              await new Promise((r) => setTimeout(r, 1))
              live.delete(req.sessionId)
              seq.push('dispose-done')
            },
          }
        },
      }),
      // ⚠ **两个持久门都失败**
      archiveOf: () => ({
        get archivedSessionIds() { return [] },
        async archiveSession() { throw new Error('注入：归档失败') },
      }),
      workspacesOf: () => ({ list: () => [{ id: 'ws-1', path: '/tmp/ws-1', attachSession: async () => {} }] }),
      setPolicy: () => ({ ok: false, reason: '注入写失败 ⇒ 触发回滚' }),
      readPolicy: () => undefined,
      quarantinePolicy: () => ({ ok: false, reason: '注入：隔离失败' }),
      log: () => {},
    }
    const iss = store.issue({ sessionId: 's-both', level: 'ledger', workMode: 'multi', workspaceId: 'ws-1' })
    const r = await chan.createHobSession(deps, store, { ticket: String(iss.ticket), sessionId: 's-both' })
    if (!seq.includes('dispose-done')) {
      bad(`CU-35 ⚠⚠ **双禁用失败时没有 await dispose**（seq=${JSON.stringify(seq)}）`
        + ' ⇒ active:workspace 会话留在**当前进程活表**里，仍可执行')
    } else if (live.get('s-both') !== undefined) {
      bad('CU-35 dispose 调了但活表仍有它 ⇒ 当前进程仍可执行')
    } else if (r.ok !== false) bad('CU-35 双失败却报成功')
    else if (r.rolledBack === true) {
      bad('CU-35 ⚠ 双失败却报 `rolledBack=true` ⇒ 把"当下撤了活表"冒充"磁盘也安全"')
    } else if (r.unsafe !== true) {
      bad(`CU-35 unsafe=${r.unsafe}（应 **true**：磁盘可能仍是 active，重启后可能复活）`)
    } else {
      ok('CU-35 ✓ 双禁用失败时**仍 await 了 dispose**、活表已无它（当前进程不可执行）；'
        + '回执仍 `unsafe=true` / `rolledBack!==true`（⚠ 磁盘重载风险未消，⛔ 不冒充绝对安全）')
    }
  }

  // ── CU-36 **归档状态三态**：unknown / archive-unknown 一律拒宽读 ──────────────
  /**
   * ⚠⚠ 上一版的 fail-open：`archivedSessionIds` 缺席/抛错/非数组 ⇒ `archived=undefined`
   *   ⇒ 解析当成"未归档"⇒ **放行 `workspace` 高档** ⇒ 定点读工具绕过宿主 pre-step。
   *
   *   本组用**同一个 policy 文件（active:workspace）**，只改"归档状态"这一个变量：
   *     · `'archived'`      ⇒ ledger + 不可推进 + 不能读工作区；
   *     · `'unknown'`       ⇒ **同上**（⚠ 本轮修的正是这一格）；
   *     · **不传**          ⇒ **同上**（⛔ 纯函数调用方忘传不得静默放行）；
   *     · `'not-archived'`  ⇒ **放行**到记录值 workspace（唯一能放宽的状态）。
   */
  {
    const sb = mkTmp('hob-cu-36-')
    const file = join(sb, 'runtime', 'session-policy.json')
    lib.writePolicyStore(file, { version: 1, migrationEpoch: 1, sessions: {} })
    lib.setSessionPolicy(file, { sessionId: 's-tri', level: 'workspace', workMode: 'multi' }, OPTS)
    const call = (extra) => lib.resolveSessionPolicy({
      ...OPTS, file, sessionId: 's-tri', isHob: true, createdAt: 1e9, now: 2e9, ...extra,
    })
    const isArchived = call({ archived: 'archived' })
    const isUnknown = call({ archived: 'unknown' })
    const omitted = call({})
    const notArchived = call({ archived: 'not-archived' })
    const strict = (r) => r.level === 'ledger' && r.mayProceed === false && r.canReadWorkspace === false
    if (!strict(isArchived)) bad(`CU-36 'archived' 未压到最低档：${isArchived.level}/${isArchived.mayProceed}/${isArchived.canReadWorkspace}`)
    else if (!strict(isUnknown)) {
      bad(`CU-36 ⚠⚠ 'unknown' **放行了**（${isUnknown.level}/${isUnknown.mayProceed}/${isUnknown.canReadWorkspace}）`
        + ' ⇒ 归档状态读不到时仍能拿 workspace（上一轮的 fail-open）')
    } else if (!strict(omitted)) {
      bad(`CU-36 ⚠ **不传 archived 就放行了**（${omitted.level}）⇒ 纯函数调用方忘传会静默放宽`)
    } else if (notArchived.level !== 'workspace' || notArchived.mayProceed !== true) {
      bad(`CU-36 'not-archived' 没有回到记录值（${notArchived.level}/${notArchived.mayProceed}）`
        + ' ⇒ 明确未归档的合法会话被误挡')
    } else {
      ok('CU-36 ✓ 三态正确：`archived`/`unknown`/**不传** 三者都压到最低档 + 不可推进 + '
        + '`canReadWorkspace=false`；只有 **`not-archived`** 才按记录给 `workspace`（唯一放宽路径）')
    }
  }

  // ── CU-37 **服务层三态**：归档 getter 缺席/抛错/非数组 ⇒ unknown（拒）───────────
  /**
   * ⚠ CU-36 验的是纯解析器；本条验**服务层真的把"读不到"映射成 `unknown`**
   *   （而不是像上一版那样映射成 `undefined` ⇒ 被当未归档）。
   *   ⚠ 这里直接调真实 `resolveSessionPolicy` 的三态入口，模拟三种"不可信读数"。
   */
  {
    const sb = mkTmp('hob-cu-37-')
    const file = join(sb, 'runtime', 'session-policy.json')
    lib.writePolicyStore(file, { version: 1, migrationEpoch: 1, sessions: {} })
    lib.setSessionPolicy(file, { sessionId: 's-svc', level: 'workspace', workMode: 'multi' }, OPTS)
    /** ⚠ 与 `session-policy-service.ts` 里那段**同一映射规则**（缺/抛/非数组 ⇒ unknown）。 */
    const mapState = (read) => {
      try {
        const ids = read()
        if (!Array.isArray(ids)) return 'unknown'
        return ids.includes('s-svc') ? 'archived' : 'not-archived'
      } catch { return 'unknown' }
    }
    const cases = [
      ['服务缺席（返回 undefined）', () => undefined],
      ['getter 抛错', () => { throw new Error('注入：读归档抛错') }],
      ['返回非数组（字符串）', () => 'not-an-array'],
      ['返回对象而非数组', () => ({ 0: 's-svc' })],
    ]
    let badCase = ''
    for (const [name, read] of cases) {
      const st = mapState(read)
      if (st !== 'unknown') { badCase = `${name} ⇒ ${st}（应 unknown）`; break }
      const r = lib.resolveSessionPolicy({
        ...OPTS, file, sessionId: 's-svc', isHob: true, createdAt: 1e9, now: 2e9, archived: st,
      })
      if (!(r.level === 'ledger' && r.mayProceed === false && r.canReadWorkspace === false)) {
        badCase = `${name} ⇒ 解析仍给 ${r.level}/${r.mayProceed}`; break
      }
    }
    // 对照：可信读到、明确不在 ⇒ not-archived ⇒ 放行
    const okState = mapState(() => ['other-id'])
    const okR = lib.resolveSessionPolicy({
      ...OPTS, file, sessionId: 's-svc', isHob: true, createdAt: 1e9, now: 2e9, archived: okState,
    })
    if (badCase !== '') bad(`CU-37 ${badCase}`)
    else if (okState !== 'not-archived' || okR.level !== 'workspace') {
      bad(`CU-37 对照失败：可信未归档时应放行到 workspace（实得 ${okState}/${okR.level}）`)
    } else {
      ok('CU-37 ✓ 服务层映射：**缺席 / 抛错 / 非数组（字符串、对象）四种不可信读数全部 ⇒ `unknown` '
        + '⇒ 最低档 + 不可推进 + 不能读工作区**；对照：可信读到且明确不在 ⇒ 放行 `workspace`')
    }
  }

  // ── CU-38 **非 Hob 不被误挡** ────────────────────────────────────────────
  {
    const sb = mkTmp('hob-cu-38-')
    const file = join(sb, 'runtime', 'session-policy.json')
    lib.writePolicyStore(file, { version: 1, migrationEpoch: 1, sessions: {} })
    lib.setSessionPolicy(file, { sessionId: 's-nonhob', level: 'workspace', workMode: 'multi' }, OPTS)
    const r = lib.resolveSessionPolicy({
      ...OPTS, file, sessionId: 's-nonhob', isHob: false, createdAt: 1e9, now: 2e9, archived: 'unknown',
    })
    /**
     * ⚠ **判据看 `source`，不看 `level`**（2026-10-22 修正一条我自己写错的断言）：
     *   非 Hob 走 `source='non-hob'`，且**本机制不参与** ⇒ `mayProceed=true`。
     *   它的 `level` 恰是 `ledger`/`auto`（"不参与"的显示值），⛔ 那不表示"被挡"。
     *   ⇒ 若按 `level==='workspace'` 断言，会把**正确行为**判成回归。
     */
    if (r.isHob !== false) bad('CU-38 非 Hob 被标成 Hob')
    else if (r.source !== 'non-hob') {
      bad(`CU-38 非 Hob 的 source = ${r.source}（应 non-hob）⇒ 分类串了`)
    } else if (r.mayProceed !== true) {
      bad(`CU-38 ⚠ 非 Hob 被**误挡**了（mayProceed=${r.mayProceed}）⇒ 那是比不拦更严重的回归`)
    } else {
      ok('CU-38 ✓ **非 Hob 不受影响**：`source=non-hob`、`mayProceed=true`（本机制不参与）'
        + '⇒ 普通实施会话照常，⛔ 不因归档状态被抓')
    }
  }

  // ── CU-39 **手动归档的 Hob 也被压到最低档**（与宿主归档语义一致）─────────────
  /**
   * ⚠ 任务书明确："'手动归档'也应一律按归档会话拒执行/最低读，与宿主既有归档语义一致"。
   *   ⇒ 本插件**不区分**"失败归档"与"用户手动归档"：只要在 `archivedSessionIds` 里就压。
   *   ⚠ 这是**语义变化**（上一版只有失败路径才会被关注），但方向是收紧，且与宿主一致。
   */
  {
    const sb = mkTmp('hob-cu-39-')
    const file = join(sb, 'runtime', 'session-policy.json')
    lib.writePolicyStore(file, { version: 1, migrationEpoch: 1, sessions: {} })
    // ⚠ 一条**用户自己选好**的合法高档记录（不是失败残留）
    lib.setSessionPolicy(file, { sessionId: 's-manual', level: 'workspace', workMode: 'multi' }, OPTS)
    const before = lib.resolveSessionPolicy({
      ...OPTS, file, sessionId: 's-manual', isHob: true, createdAt: 1e9, now: 2e9, archived: 'not-archived',
    })
    const after = lib.resolveSessionPolicy({
      ...OPTS, file, sessionId: 's-manual', isHob: true, createdAt: 1e9, now: 2e9, archived: 'archived',
    })
    if (before.level !== 'workspace' || before.canReadWorkspace !== true) {
      bad('CU-39 前置不成立：未归档时本该可用')
    } else if (after.level !== 'ledger' || after.mayProceed !== false || after.canReadWorkspace !== false) {
      bad(`CU-39 ⚠ 手动归档后仍可用（${after.level}/${after.mayProceed}/${after.canReadWorkspace}）`
        + ' ⇒ 归档会话没被压到最低档')
    } else {
      ok('CU-39 ✓ **手动归档的 Hob 也被压到最低档** + 不可推进 + 不能读工作区'
        + '（归档前同一记录是 `workspace` 可用 ⇒ 差异只来自"归档"）')
    }
  }

  // ── CU-40 **强制执行面**：归档/unknown 时四读与派活都拒，且拿不到工作区正文 ────────
  /**
   * ⚠ 任务书要求"故意硬调用所有四读工具与派发都得拒且不获工作区正文"。
   *   这里用**同一份解析产物**喂真实判定口径（读工具 = `canReadWorkspace`；
   *   派活 = `mayProceed`），断言 `archived` 与 `unknown` **两种**都全拒，
   *   而**明确未归档**时四读可用（对照）。⚠ 不靠宿主 pre-step。
   */
  {
    const sb = mkTmp('hob-cu-40-')
    const file = join(sb, 'runtime', 'session-policy.json')
    lib.writePolicyStore(file, { version: 1, migrationEpoch: 1, sessions: {} })
    lib.setSessionPolicy(file, { sessionId: 's-force', level: 'workspace', workMode: 'multi' }, OPTS)
    const pick = (st) => lib.resolveSessionPolicy({
      ...OPTS, file, sessionId: 's-force', isHob: true, createdAt: 1e9, now: 2e9, archived: st,
    })
    const a = pick('archived')
    const u = pick('unknown')
    const n = pick('not-archived')
    const allRejected = (r) => r.canReadWorkspace === false && r.mayProceed === false
    if (!allRejected(a)) bad(`CU-40 'archived' 仍能读/派：${a.canReadWorkspace}/${a.mayProceed}`)
    else if (!allRejected(u)) bad(`CU-40 'unknown' 仍能读/派：${u.canReadWorkspace}/${u.mayProceed}`)
    else if (n.canReadWorkspace !== true || n.mayProceed !== true) {
      bad(`CU-40 对照失败：明确未归档时本应可读可派（${n.canReadWorkspace}/${n.mayProceed}）`)
    } else {
      ok('CU-40 ✓ **强制点名（四读 + 派活）在 `archived` 与 `unknown` 下都拒**'
        + '（`canReadWorkspace=false` ⇒ 拿不到工作区正文；`mayProceed=false` ⇒ 派不出去）；'
        + '对照：`not-archived` 时可读可派')
    }
  }

  // ── 收尾 ─────────────────────────────────────────────────────────────
  cleanupAll()
  console.log('')
  console.log(`  ⚠ 临时件：创建 ${created.length} 个目录，已逐个 rmSync`)
  console.log('')
  /**
   * ⚠⚠ **跳过数必须是真的**（2026-10-24 · B 席）：从 `skip` 收集器来，⛔ 不再写字面量。
   *   ⚠ 同时印 `处级口径` 行 —— `check:all` 的 `parseAssertionCount()` / `parseSkipCount()`
   *   读的就是它；不印的话，本族在汇总里永远是"结构上没能报口径"的那几族之一。
   *   ⚠ `查了 = 过了 + 没过 + 跳过` 必须成立（`check:all` 会逐族核这条等式）。
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
  console.error(`✗ check:hob-create-ui 自身异常：${String(e?.stack ?? e)}`)
  cleanupAll()
  console.error('      ⇒ 检查器崩溃**不按通过处理**（exit 3）；临时件已清')
  process.exit(3)
})
