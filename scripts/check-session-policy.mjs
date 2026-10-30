#!/usr/bin/env node
/**
 * `check:session-policy` —— 逐会话策略权威（`REQ-04`）的**行为**机检。
 *
 * ══ 它守的是什么（2026-10-22 · `REQ-04` / `CONTEXT` §2.1b 的 G-1…G-6）══════════
 *   用户要求：每个新建 Hob 会话**分别**选可读范围与推进工作方式，选择**按会话隔离**；
 *   旧 Hob 会话迁移后读范围**一律最低**、原工作方式**承接**；所有会话**不再随** profile
 *   那两个旧全局值串线；缺身份 / 记录损坏 / 读不到 ⇒ **保守拒**，⛔ 不取旧全局宽档。
 *
 * ══ 断言口径（⛔ 不许为了变绿放宽；每条都**能失败**）════════════════════════
 *   SP-1 **两会话不串**：同一个策略文件里两个会话选不同档 ⇒ 各自解析出自己的档；
 *        改"另一个会话"的策略**不影响**这一个（这就是"取消全局联动"的可观察面）。
 *   SP-2 **重载持久**：写盘后**重新从磁盘读**（模拟重载）⇒ 两会话仍各按自己的档。
 *   SP-3 **旧会话最低**：早于迁移纪元的会话**无记录** ⇒ `ledger`；迁移后记录里
 *        读档 = 最低、工作方式 = 迁移时生效值（⛔ 不是"沿用全局现值"）。
 *   SP-4 **新会话不悄然变宽**：晚于迁移纪元且**没有记录** ⇒ `ledger`（`derived-default`）。
 *   SP-5 **无身份 / 记录坏 / 版本不认识 ⇒ 保守**：
 *        · 无 `sessionId` ⇒ `ledger` + `source='no-identity'`；
 *        · 文件坏（不是 JSON）⇒ `ledger` + `source='store-unreadable'`；
 *        · 版本不认识 ⇒ `ledger` + `source='version-unknown'`；
 *        · 单条记录字段非法 ⇒ 该条**视为不存在** ⇒ `ledger`。
 *        ⚠ 四条都断言"**没有拿到宽档**"（⛔ 只断言返回值不崩是不够的）。
 *   SP-6 **四个读工具的 execute 自己兜底**（`ledger` 档 / 无 agent）：
 *        直接调 `execute`（**绕过**模型面过滤与宿主 guard）⇒ 三把刀**都不读工作区**，
 *        `hob_read_doc` 也拒。⚠ 这是 G-5 的判据；改前这条**必然 FAIL**（见 SP-6·RED）。
 *   SP-7 **写 / 命令 / 组队三档都不增**：最高档的工具名集合里**不含**任何写类/命令类/
 *        组队类名字（⛔ 不因为"档高"多给改动能力）。
 *   SP-8 **负向对拍**：把策略服务换成"读旧全局值"的假实现 ⇒ SP-1/SP-3 **必须 FAIL**
 *        （证明确实是"按会话解析"在起作用，而不是断言写松了）。
 *
 * ══ 副作用（先查，后跑）════════════════════════════════════════════════════
 *   全部临时件都在 `mkdtempSync(tmpdir())` 里；结束 `rmSync(recursive:true)`；
 *   ⚠ 不写工作区、不写账本、不碰 profile / 宿主 / 第三方 / 看板。
 *   ⚠ 不 import 宿主运行时、不装载真实插件、不开会话。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
/**
 * ⚠ 源码树可注入（`HOB_SP_ROOT`）—— **只**为负向对拍用：把一份"故意改坏"的
 *   `src/` 复制到临时目录，然后指到这里跑同一份判据，验证它**能红**。
 * ⚠ 缺省 = 本仓（正常判据永远跑本仓源码）；⛔ 不用它来"换一份能过的源码"。
 */
const srcRoot = process.env.HOB_SP_ROOT !== undefined && process.env.HOB_SP_ROOT !== ''
  ? process.env.HOB_SP_ROOT
  : root

let pass = 0
let fail = 0
const okLines = []
const badLines = []
/**
 * ── ⚠⚠ **第三态：`skip`（2026-10-24 · B 席 · 修"跳过数被硬编码"）**───────────────
 *
 * ── 改前是什么（这就是本单要治的）──────────────────────────────────────
 *   收尾那行**写死** `跳过 0 处（⛔ 不计入通过）`，而本文件里**有真跳过分支**：
 *     · `if (toolsMod !== undefined)` / `if (presetMod !== undefined)` /
 *       `if (svcMod !== undefined && …installSessionPolicy…)` —— 三个 `if` **都没有 `else`**
 *       ⇒ 源件载入失败时那几组**直接不跑**，⛔ 既不 `bad()` 也不记跳过
 *       （只有其中部分会先 `bad()` 一句"基准缺失"，其余**一声不响**）。
 *   ⇒ ⚠ 后果：`check:all` 的 `parseSkipCount()` 读到的是**假的 0** ⇒
 *     "没核"与"都核了"在汇总层变成同一个数。
 *   ⇒ 现在：**真实收集器**，且三个 `if` 都补了 `else` 记跳过。
 */
const skip = []
const noteSkip = (m) => { skip.push(m); console.log(`  · ${m}`) }
const ok = (m) => { pass += 1; okLines.push(m); console.log(`  ✓ ${m}`) }
const bad = (m) => { fail += 1; badLines.push(m); console.log(`  ✗ ${m}`) }

const created = []
function mkTmp(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix))
  created.push(d)
  return d
}

/** 直载 TS（Node ≥22 strip-types）—— ⚠ 与被测实现**同一份源码**，⛔ 不复制一份逻辑。 */
async function loadImpl() {
  // ⚠ 用 `srcRoot`（默认 = 本仓；负向对拍时 = 故意改坏的临时副本）。
  //   ⚠⚠ 这里曾经写死 `root` —— 结果是"负向对拍跑的还是健康源码、于是一律绿"，
  //   等于**检查器自身静默失效**（本仓 E-131 同族）。改坏①就是这么被抓出来的。
  const p = join(srcRoot, 'src', 'server', 'session-policy.ts')
  return await import(pathToFileURL(p).href)
}

const LEVELS = ['ledger', 'project', 'workspace']
const MODES = ['auto', 'single', 'multi']
const OPTS = { levels: LEVELS, modes: MODES, floorLevel: 'ledger', defaultMode: 'auto' }

async function main() {
  let impl
  try {
    impl = await loadImpl()
  } catch (e) {
    console.error(`✗ 无法直载 src/server/session-policy.ts（${String(e?.message ?? e)}）`)
    console.error('      ⇒ 基准缺失不按通过处理（exit 2）')
    process.exit(2)
  }
  const need = ['readPolicyStore', 'writePolicyStore', 'setSessionPolicy', 'resolveSessionPolicy', 'ensureLegacyMigrated', 'policyStateFileOf']
  const missing = need.filter((n) => typeof impl[n] !== 'function')
  if (missing.length > 0) {
    console.error(`✗ 实现缺少入口：${missing.join(', ')} ⇒ 基准缺失（exit 2）`)
    process.exit(2)
  }

  const sandbox = mkTmp('hob-sp-')
  const file = join(sandbox, 'runtime', 'session-policy.json')

  // ── SP-1 两个会话选不同档 ⇒ 互不串 ───────────────────────────────────
  {
    const w1 = impl.setSessionPolicy(file, { sessionId: 'sess-A', level: 'workspace', workMode: 'multi', now: 1000 }, OPTS)
    const w2 = impl.setSessionPolicy(file, { sessionId: 'sess-B', level: 'workspace', workMode: 'single', now: 1001 }, OPTS)
    if (!w1.ok) bad(`SP-1 写 sess-A 失败：${w1.reason}`)
    else if (!w2.ok) bad(`SP-1 写 sess-B 失败：${w2.reason}`)
    else {
      const a = impl.resolveSessionPolicy({ ...OPTS, file, sessionId: 'sess-A', isHob: true, archived: 'not-archived', createdAt: 2000, now: 2000 })
      const b = impl.resolveSessionPolicy({ ...OPTS, file, sessionId: 'sess-B', isHob: true, archived: 'not-archived', createdAt: 2001, now: 2000 })
      // 把 sess-B 改成 ledger，再看 A 是否**一点没动**（这正是"取消全局联动"的可观察面）
      impl.setSessionPolicy(file, { sessionId: 'sess-B', level: 'ledger', workMode: 'single', now: 1002 }, OPTS)
      const a2 = impl.resolveSessionPolicy({ ...OPTS, file, sessionId: 'sess-A', isHob: true, archived: 'not-archived', createdAt: 2000, now: 2000 })
      const b2 = impl.resolveSessionPolicy({ ...OPTS, file, sessionId: 'sess-B', isHob: true, archived: 'not-archived', createdAt: 2001, now: 2000 })
      const cond = a.level === 'workspace' && a.workMode === 'multi'
        && b.level === 'workspace' && b.workMode === 'single'
        && a2.level === 'workspace' && a2.workMode === 'multi'
        && b2.level === 'ledger' && b2.workMode === 'single'
      if (cond) {
        ok('SP-1 两会话各按自己的档/方式解析（A=workspace+multi · B 改档后=ledger+single，'
          + '而 A 一个字节没动）⇒ 串线已断')
      } else {
        bad('SP-1 两会话仍互相影响（或读写不同步）：'
          + `A=${a2.level}/${a2.workMode} · B=${b2.level}/${b2.workMode}（期望 workspace/multi · ledger/single）`)
      }
    }
  }

  // ── SP-2 重载持久（重新从磁盘读）─────────────────────────────────────
  {
    const reread = impl.readPolicyStore(file, OPTS)
    const a = impl.resolveSessionPolicy({ ...OPTS, file, sessionId: 'sess-A', isHob: true, archived: 'not-archived', createdAt: 2000, now: 3000 })
    const b = impl.resolveSessionPolicy({ ...OPTS, file, sessionId: 'sess-B', isHob: true, archived: 'not-archived', createdAt: 2001, now: 3000 })
    if (reread.reachability !== 'ok') bad(`SP-2 重读策略文件不可达：${reread.reachability}（${reread.reason}）`)
    else if (a.level === 'workspace' && a.workMode === 'multi' && b.level === 'ledger' && b.workMode === 'single') {
      ok('SP-2 重载后仍各按自己的档（磁盘为唯一权威：A=workspace/multi · B=ledger/single）')
    } else {
      bad(`SP-2 重载后读数变了：A=${a.level}/${a.workMode} · B=${b.level}/${b.workMode}`)
    }
  }

  // ── SP-3 旧会话：无记录 + 早于迁移纪元 ⇒ 最低档 + 工作方式承接 ─────────
  {
    const sandbox2 = mkTmp('hob-sp-legacy-')
    const f2 = join(sandbox2, 'runtime', 'session-policy.json')
    const now = 1_000_000
    // 先造一份"迁移纪元 = now"的文件（等价于"迁移发生在此刻"）
    impl.writePolicyStore(f2, { version: 1, migrationEpoch: now, sessions: {} })
    const legacy = impl.resolveSessionPolicy({
      ...OPTS, file: f2, sessionId: 'old-session', isHob: true, archived: 'not-archived', createdAt: now - 60_000, now: now + 1,
    })
    const mig = impl.ensureLegacyMigrated(f2, [{ sessionId: 'old-session', createdAt: now - 60_000 }], 'multi', OPTS, now + 1)
    const after = impl.resolveSessionPolicy({
      ...OPTS, file: f2, sessionId: 'old-session', isHob: true, archived: 'not-archived', createdAt: now - 60_000, now: now + 2,
    })
    if (legacy.level !== 'ledger') {
      bad(`SP-3 旧会话无记录时读档 = ${legacy.level}（应最低档 ledger）⇒ 这会凭空给宽档`)
    } else if (legacy.workMode !== 'auto') {
      bad(`SP-3 旧会话无记录时工作方式 = ${legacy.workMode}（无记录时应用安全缺省 auto，⛔ 不猜）`)
    } else if (!mig.migrated.includes('old-session')) {
      bad(`SP-3 迁移没有写下旧会话记录（migrated=${JSON.stringify(mig.migrated)} · ${mig.reason}）`)
    } else if (after.level !== 'ledger' || after.workMode !== 'multi') {
      bad(`SP-3 迁移后读数 = ${after.level}/${after.workMode}（应 ledger/multi：读档最低 + 工作方式承接迁移时生效值）`)
    } else if (after.source !== 'stored') {
      bad(`SP-3 迁移后来源 = ${after.source}（应为 stored：迁移是**写记录**，不是每次现算）`)
    } else {
      ok('SP-3 旧会话读档一律最低（ledger）+ 工作方式承接迁移时生效值（multi，写成 origin=legacy-migrated 的记录）')
    }
    // 幂等：再迁一次不应覆盖
    const again = impl.ensureLegacyMigrated(f2, [{ sessionId: 'old-session', createdAt: now - 60_000 }], 'single', OPTS, now + 3)
    const after2 = impl.resolveSessionPolicy({ ...OPTS, file: f2, sessionId: 'old-session', isHob: true, archived: 'not-archived', createdAt: now - 60_000, now: now + 4 })
    if (again.migrated.length === 0 && after2.workMode === 'multi') {
      ok('SP-3b 迁移**幂等**：二次迁移不覆盖已有记录（工作方式仍是 multi，⛔ 不被改成 single）')
    } else {
      bad(`SP-3b 迁移不幂等：二次迁移改了 ${JSON.stringify(again.migrated)} · 现值=${after2.workMode}`)
    }
  }

  // ── SP-4 新会话未选 ⇒ 不悄然变宽 ─────────────────────────────────────
  {
    const sandbox3 = mkTmp('hob-sp-new-')
    const f3 = join(sandbox3, 'runtime', 'session-policy.json')
    const now = 2_000_000
    impl.writePolicyStore(f3, { version: 1, migrationEpoch: now, sessions: {} })
    const fresh = impl.resolveSessionPolicy({
      ...OPTS, file: f3, sessionId: 'new-session', isHob: true, archived: 'not-archived', createdAt: now + 5_000, now: now + 6_000,
    })
    /**
     * ══ ⚠⚠ **两轴分开判：读档（安全面）⛔ 不许动；能否动手（可用面）按裁定 1(a) 改** ══
     *
     * ── 依据（2026-10-24 · 用户裁定 1(a)）──────────────────────────────────
     *   用户要求解开「**Hob 预设无法新建实施会话**」这个死锁。根因之一就是这一支：
     *   宿主**直接**建出来的 Hob 会话（Web UI 新建 / `Ctrl+N` / 看板建卡，都**不经过**弹窗）
     *   落进 `derived-default` ⇒ `mayProceed=false` ⇒ **它永远开不了第一轮**（"建了却干不了活"）。
     *   裁定 1(a)：**未选档位的新 Hob 会话允许派活**（放行），但读档**仍然不许抬高**。
     *
     * ── 为什么**读档那半条一字不动**（⚠ 这是本组最要紧的一句）──────────────
     *   `mayProceed` 是"**能不能动手**"（可用性）；`level` / `canReadWorkspace` 是
     *   "**能读到什么**"（安全面）。放行只解决了"建了没法用"，**没有**、也**不许**
     *   顺手把"能读工作区"一起给出去 —— 那会变成"用可用性换权限"。
     *   ⚠ 两轴必须**分开判、分开报**：合成一条 `&&` 时，任一轴的变化都会让整条红/绿，
     *     下一个人读不出**是哪一轴**变了（本仓"两种原因说成同一句话"的形态）。
     *
     * ── 判据（四件，⛔ 少一件就是"只改了一半"）────────────────────────────
     *   · **读档轴**（⛔ 不许动）：`level === 'ledger'` · `canReadWorkspace === false`
     *   · **来源轴**（⛔ 不许动）：`source === 'derived-default'`（要说清是"派生默认"，⛔ 不是"用户选过"）
     *   · **可用轴**（✅ 按裁定 1(a) 改）：`mayProceed === true`
     *   · **负向对拍**（见 SP-4(反证)）：把 `level` 抬成 `workspace` ⇒ **必须红**
     *     —— 防"下一轮有人把放行读成放权"。
     */
    const readAxisOk = fresh.level === 'ledger' && fresh.canReadWorkspace === false
    const sourceOk = fresh.source === 'derived-default'
    const proceedOk = fresh.mayProceed === true
    if (readAxisOk && sourceOk && proceedOk) {
      ok('SP-4 新会话未做两项选择 ⇒ **读档轴不动**（`ledger` + `canReadWorkspace=false`）· '
        + '`source=derived-default` · **`mayProceed=true`**（⚠ 2026-10-24 用户裁定 1(a)：'
        + '放行派活以解开「建了却干不了活」；⚠ **读档没有因此抬高**）')
    } else if (!readAxisOk) {
      bad(`SP-4 ⚠⚠ **读档轴被抬高了**：level=${fresh.level} canReadWorkspace=${fresh.canReadWorkspace}`
        + '（必须 `ledger` / `false`）'
        + '\n      ⇒ ⚠ 裁定 1(a) 只放行「能不能动手」，**没有**放行「能读到什么」——'
        + '\n         把读档跟着抬起来 = 用可用性换权限（⛔ 本组最要紧的一条）')
    } else if (!sourceOk) {
      bad(`SP-4 来源读数不对：source=${fresh.source}（应 derived-default）`
        + '\n      ⇒ ⚠ 它必须说清"这是**派生默认**、用户没选过"，⛔ 不许冒充"用户选过"')
    } else if (!proceedOk) {
      bad(`SP-4 mayProceed=${fresh.mayProceed}（按 2026-10-24 用户裁定 1(a) 应为 **true**）`
        + '\n      ⇒ ⚠ 若 here 仍是 false：宿主**直接**建的 Hob 会话（不经弹窗）永远开不了第一轮，'
        + '\n         正是用户报的「Hob 预设无法新建实施会话」那条死锁（读档轴不受影响，仍 ledger）')
    }

    /**
     * ── SP-4(反证)：把 `derived-default` 的读档抬成 `workspace` ⇒ **必须红** ─────────
     *   ⚠ 这是"下一轮有人把**放行**读成**放权**"的唯一守卫。
     *   ⚠ 做法：⛔ 不改产品源码；在判据内部用**同一段判定**喂一份"被抬高的读数"，
     *     确认 `readAxisOk` 会变成 false（即 SP-4 会当场红）。
     */
    {
      const mutated = { ...fresh, level: 'workspace', canReadWorkspace: true }
      const mutReadAxisOk = mutated.level === 'ledger' && mutated.canReadWorkspace === false
      const mutWouldPass = mutReadAxisOk && mutated.source === 'derived-default' && mutated.mayProceed === true
      if (mutWouldPass) {
        bad('SP-4(反证) 【判据恒绿】把 `derived-default` 的读档抬成 `workspace` 后，SP-4 **仍然判通过**'
          + ' ⇒ 说明"读档轴"那半条判据没有真的在比对读档 —— 那正是"把放行读成放权"会漏出去的形态')
      } else {
        ok('SP-4(反证) ✓ 负向对拍：把 `derived-default` 的读档抬成 `workspace`（模拟"为了解开死锁顺手抬高读档"）'
          + ' ⇒ **读档轴当场不成立 ⇒ SP-4 会红**（⚠ 放行 ≠ 放权：`mayProceed` 那一轴改了，'
          + '但 `level` / `canReadWorkspace` 这一轴一个字都不许动）')
      }
    }
  }

  // ── SP-5 无身份 / 记录坏 / 版本不认识 / 单条字段非法 ⇒ 保守 ────────────
  {
    // 5a 无 sessionId
    const noId = impl.resolveSessionPolicy({ ...OPTS, file, sessionId: undefined, isHob: true, archived: 'not-archived', createdAt: 1000, now: 2000 })
    if (noId.level === 'ledger' && noId.source === 'no-identity' && noId.canReadWorkspace === false) {
      ok('SP-5a 无可信 sessionId ⇒ ledger + source=no-identity（⛔ 不读工作区）')
    } else {
      bad(`SP-5a 无身份时读数 = ${noId.level}/${noId.source}（应 ledger/no-identity）`)
    }

    // 5b 文件坏
    const sandbox4 = mkTmp('hob-sp-bad-')
    const fBad = join(sandbox4, 'runtime', 'session-policy.json')
    impl.writePolicyStore(fBad, { version: 1, migrationEpoch: 5, sessions: {} })
    writeFileSync(fBad, '{ this is not json', 'utf8')
    const broken = impl.resolveSessionPolicy({ ...OPTS, file: fBad, sessionId: 'x', isHob: true, archived: 'not-archived', createdAt: 10, now: 20 })
    if (broken.level === 'ledger' && broken.source === 'store-unreadable' && broken.canReadWorkspace === false) {
      ok('SP-5b 策略文件不是 JSON ⇒ ledger + source=store-unreadable（读崩也不给宽档）')
    } else {
      bad(`SP-5b 坏文件读数 = ${broken.level}/${broken.source}（应 ledger/store-unreadable）`)
    }

    // 5c 版本不认识
    const sandbox5 = mkTmp('hob-sp-ver-')
    const fVer = join(sandbox5, 'runtime', 'session-policy.json')
    impl.writePolicyStore(fVer, { version: 1, migrationEpoch: 5, sessions: {} })
    const raw = JSON.parse(readFileSync(fVer, 'utf8'))
    raw.version = 99
    raw.sessions = { x: { level: 'workspace', workMode: 'multi', origin: 'explicit', at: 1 } }
    writeFileSync(fVer, JSON.stringify(raw), 'utf8')
    const verUnknown = impl.resolveSessionPolicy({ ...OPTS, file: fVer, sessionId: 'x', isHob: true, archived: 'not-archived', createdAt: 10, now: 20 })
    if (verUnknown.level === 'ledger' && verUnknown.source === 'version-unknown' && verUnknown.canReadWorkspace === false) {
      ok('SP-5c 结构版本不认识 ⇒ ledger + source=version-unknown（⛔ 不"尽力解释"未来版本里的宽档）')
    } else {
      bad(`SP-5c 版本不认识时读数 = ${verUnknown.level}/${verUnknown.source}（应 ledger/version-unknown）`)
    }

    // 5d 单条记录字段非法 ⇒ 该条视为不存在
    const sandbox6 = mkTmp('hob-sp-badrec-')
    const fBadRec = join(sandbox6, 'runtime', 'session-policy.json')
    impl.writePolicyStore(fBadRec, { version: 1, migrationEpoch: 5, sessions: {} })
    const raw2 = JSON.parse(readFileSync(fBadRec, 'utf8'))
    raw2.sessions = { y: { level: 'root', workMode: 'multi', origin: 'explicit', at: 1 } }
    writeFileSync(fBadRec, JSON.stringify(raw2), 'utf8')
    const badRec = impl.resolveSessionPolicy({ ...OPTS, file: fBadRec, sessionId: 'y', isHob: true, archived: 'not-archived', createdAt: 10, now: 20 })
    if (badRec.level === 'ledger' && badRec.canReadWorkspace === false) {
      ok('SP-5d 单条记录的档位值非法（"root"）⇒ 该条视为不存在 ⇒ ledger（⛔ 不就近归一成宽档）')
    } else {
      bad(`SP-5d 非法枚举记录读数 = ${badRec.level}/${badRec.source}（应 ledger）`)
    }

    // 5e 非 Hob ⇒ 不参与（且不 therefore 给宽档）
    const nonHob = impl.resolveSessionPolicy({ ...OPTS, file, sessionId: 'sess-A', isHob: false, createdAt: 1000, now: 2000 })
    if (nonHob.isHob === false && nonHob.canReadWorkspace === false) {
      ok('SP-5e 非 Hob 会话 ⇒ isHob=false（本机制不参与，⛔ 不因"有记录"就套上档位）')
    } else {
      bad(`SP-5e 非 Hob 读数 = isHob=${nonHob.isHob} canRead=${nonHob.canReadWorkspace}（应 false/false）`)
    }
  }

  // ── SP-6 四个读工具的 execute 自己兜底（G-5）──────────────────────────
  {
    let toolsMod
    try {
      toolsMod = await import(pathToFileURL(join(srcRoot, 'src', 'modules', 'tools.ts')).href)
    } catch (e) {
      bad(`SP-6 无法直载 src/modules/tools.ts（${String(e?.message ?? e)}）⇒ 基准缺失，不按通过处理`)
    }
    if (toolsMod !== undefined) {
      // ⚠ 名字集的**唯一来源** = `src/preset/tools.ts` 的 `PERMISSION_TIERS`（⛔ 不在此复制清单）
      let TIERS
      try {
        const pm = await import(pathToFileURL(join(srcRoot, 'src', 'preset', 'tools.ts')).href)
        TIERS = (level) => pm.PERMISSION_TIERS?.[level] ?? []
      } catch (e) {
        bad(`SP-6 无法取档位名字集（${String(e?.message ?? e)}）⇒ 本层读档门失去基准，不按通过处理`)
        TIERS = () => []
      }
      const wsRoot = root
      const execWithAgent = {
        agent: { id: 'sess-ledger', session: { id: 'sess-ledger', header: { cwd: wsRoot } } },
        arguments: {},
      }
      /** ⚠ 关键：**无 agent**。宿主的 scope guard 在 `exec.agent===undefined` 时**根本不跑**。 */
      const execNoAgent = { arguments: {} }

      // 6a ledger 档 + 有 agent
      const t = toolsMod.createHobTools({ workspaceRoot: wsRoot }, { levelOf: () => 'ledger', tierNamesOf: TIERS })
      const g = await t.globWorkspace.execute({ pattern: 'src/*.ts', limit: 3 }, execWithAgent)
      const r = await t.grepWorkspaceTool.execute({ pattern: 'permissionLevel', limit: 1 }, execWithAgent)
      const i = await t.readWorkspaceImage.execute({ path: '.hob/drafts/架构总览.png' }, execWithAgent)
      const d = await t.readWorkspaceDoc.execute({ path: 'README.md', limit: 1 }, execWithAgent)
      const gTxt = typeof g === 'string' ? g : JSON.stringify(g)
      const rTxt = typeof r === 'string' ? r : JSON.stringify(r)
      const iTxt = typeof i === 'string' ? i : JSON.stringify(i)
      const dTxt = typeof d === 'string' ? d : JSON.stringify(d)
      const allRefused = [gTxt, rTxt, iTxt, dTxt].every((x) => x.includes('拒绝'))
      const leaks = [
        gTxt.includes('src/config.ts') ? 'glob 列出了工作区路径' : '',
        rTxt.includes('permissionLevel') ? 'grep 搜出了工作区正文' : '',
        iTxt.includes('attachmentId') ? 'read_image 读出了图片' : '',
      ].filter(Boolean)
      if (!allRefused) bad(`SP-6a ledger 档 + 有 agent：不是四把刀全拒 ⇒ ${JSON.stringify({ gTxt, rTxt, iTxt, dTxt }).slice(0, 320)}`)
      else if (leaks.length > 0) bad(`SP-6a ledger 档**漏读**：${leaks.join(' / ')}`)
      else ok('SP-6a ledger 档（有 agent）⇒ 四把刀全部拒绝（glob/grep/read_image/read_doc），无一泄读')

      // 6b ledger 档 + **无 agent**（宿主 guard 不会跑的那条路）
      const t2 = toolsMod.createHobTools({ workspaceRoot: wsRoot }, { levelOf: () => 'ledger', tierNamesOf: TIERS })
      const g2 = await t2.globWorkspace.execute({ pattern: 'src/*.ts', limit: 3 }, execNoAgent)
      const r2 = await t2.grepWorkspaceTool.execute({ pattern: 'permissionLevel', limit: 1 }, execNoAgent)
      const i2 = await t2.readWorkspaceImage.execute({ path: '.hob/drafts/架构总览.png' }, execNoAgent)
      const gTxt2 = typeof g2 === 'string' ? g2 : JSON.stringify(g2)
      const rTxt2 = typeof r2 === 'string' ? r2 : JSON.stringify(r2)
      const iTxt2 = typeof i2 === 'string' ? i2 : JSON.stringify(i2)
      const leaks2 = [
        gTxt2.includes('src/config.ts') ? 'glob 漏' : '',
        rTxt2.includes('permissionLevel') ? 'grep 漏' : '',
        iTxt2.includes('attachmentId') ? 'read_image 漏' : '',
      ].filter(Boolean)
      if (leaks2.length > 0) {
        bad(`SP-6b **无 agent + ledger** 时漏读：${leaks2.join(' / ')}`
          + `\n      ⇒ 这正是宿主 guard 被跳过（\`dsh-tools/lib/index.js:3027\`）的那条路径，`
          + '\n        必须在 execute 内兜住（G-5）')
      } else {
        ok('SP-6b **无 agent + ledger** ⇒ 三把刀仍全拒（execute 内兜底生效；'
          + '`levelOf` 拿不到身份 ⇒ 最低档）')
      }

      /**
       * 6b-2 ⭐⭐ **最严格的一条**：`levelOf` 故意返回 **workspace**（模拟"注入被换成旧全局闭包"
       *   或"策略服务误报宽档"），但**没有 agent** ⇒ 仍必须拒。
       *   ⚠ 这条正是任务书 G-4 / "不得取旧全局宽档" 的**机检落点**：
       *     若只靠 `levelOf` 的返回值，本用例会**漏读**（宿主 guard 又不跑）。
       */
      {
        const t2b = toolsMod.createHobTools(
          { workspaceRoot: wsRoot },
          { levelOf: () => 'workspace', tierNamesOf: TIERS }, // ⚠ 故意给宽档
        )
        const g2b = await t2b.globWorkspace.execute({ pattern: 'src/*.ts', limit: 3 }, execNoAgent)
        const r2b = await t2b.grepWorkspaceTool.execute({ pattern: 'permissionLevel', limit: 1 }, execNoAgent)
        const i2b = await t2b.readWorkspaceImage.execute({ path: '.hob/drafts/架构总览.png' }, execNoAgent)
        const gTxt2b = typeof g2b === 'string' ? g2b : JSON.stringify(g2b)
        const rTxt2b = typeof r2b === 'string' ? r2b : JSON.stringify(r2b)
        const iTxt2b = typeof i2b === 'string' ? i2b : JSON.stringify(i2b)
        const leaks2b = [
          gTxt2b.includes('src/config.ts') ? 'glob' : '',
          rTxt2b.includes('permissionLevel') ? 'grep' : '',
          iTxt2b.includes('attachmentId') ? 'read_image' : '',
        ].filter(Boolean)
        if (leaks2b.length > 0) {
          bad(`SP-6b2 **无身份 + levelOf 谎报 workspace** 时漏读：${leaks2b.join(' / ')}`
            + '\n      ⇒ 身份门必须**先于**档位判定；只靠 levelOf 的返回值就是"不得取旧全局宽档"那条失守')
        } else {
          ok('SP-6b2 **无身份 + levelOf 谎报 workspace** ⇒ 三把刀仍全拒'
            + '（身份门在最前：没有可信 session.id ⇒ 与档位无关地拒绝）')
        }
      }

      // 6c workspace 档 ⇒ 仍能读（证明门不是"一刀切全禁"，否则就是另一个缺陷）
      const t3 = toolsMod.createHobTools({ workspaceRoot: wsRoot }, { levelOf: () => 'workspace', tierNamesOf: TIERS })
      const g3 = await t3.globWorkspace.execute({ pattern: 'src/*.ts', limit: 3 }, execWithAgent)
      const gTxt3 = typeof g3 === 'string' ? g3 : JSON.stringify(g3)
      if (gTxt3.includes('src/config.ts') && !gTxt3.includes('拒绝')) {
        ok('SP-6c workspace 档 ⇒ 照常列出（门按档生效，⛔ 不是"把读功能整体关掉"）')
      } else {
        bad(`SP-6c workspace 档被误拒（${gTxt3.slice(0, 160)}）⇒ 门过宽，会把正常读也挡了`)
      }

      // 6d project 档 ⇒ glob/grep/image 仍拒（它们不在 project 档的名字集里），read_doc 只 .md
      const t4 = toolsMod.createHobTools({ workspaceRoot: wsRoot }, { levelOf: () => 'project', tierNamesOf: TIERS })
      const g4 = await t4.globWorkspace.execute({ pattern: 'src/*.ts', limit: 3 }, execWithAgent)
      const d4md = await t4.readWorkspaceDoc.execute({ path: 'README.md', limit: 1 }, execWithAgent)
      const d4ts = await t4.readWorkspaceDoc.execute({ path: 'src/config.ts', limit: 1 }, execWithAgent)
      const gTxt4 = typeof g4 === 'string' ? g4 : JSON.stringify(g4)
      const dMd = typeof d4md === 'string' ? d4md : JSON.stringify(d4md)
      const dTs = typeof d4ts === 'string' ? d4ts : JSON.stringify(d4ts)
      if (!gTxt4.includes('拒绝')) {
        bad(`SP-6d project 档 glob 未拒（${gTxt4.slice(0, 160)}）⇒ 文档档不应能列代码目录`)
      } else if (dMd.includes('拒绝')) {
        bad(`SP-6d project 档读 .md 被误拒（${dMd.slice(0, 160)}）⇒ 文档档应可读 .md`)
      } else if (!dTs.includes('拒绝')) {
        bad(`SP-6d project 档读 .ts 未拒（${dTs.slice(0, 160)}）⇒ 文档档只许 .md`)
      } else {
        ok('SP-6d project 档 ⇒ glob 拒 · 读 .md 放行 · 读 .ts 拒（类型门仍在）')
      }
    }
  }

  // ── SP-7 三档都不增写 / 命令 / 组队 ──────────────────────────────────
  {
    let presetMod
    try {
      presetMod = await import(pathToFileURL(join(srcRoot, 'src', 'preset', 'tools.ts')).href)
    } catch (e) {
      bad(`SP-7 无法直载 src/preset/tools.ts（${String(e?.message ?? e)}）`)
    }
    if (presetMod !== undefined) {
      const tiers = presetMod.PERMISSION_TIERS
      const FORBIDDEN = ['write', 'edit', 'bash', 'pwsh', 'str_replace_editor']
      const TEAMISH = ['subagent', 'subagent_fork', 'subagent_claude_code', 'subagent_codex', 'workflow', 'ralph',
        'agent_teams_create', 'agent_teams_add_member', 'agent_teams_create_task', 'spawn_teammate', 'team_task_create',
        'send_message', 'run_code']
      const offenders = []
      for (const lvl of ['ledger', 'project', 'workspace']) {
        for (const n of FORBIDDEN) if (tiers[lvl].includes(n)) offenders.push(`${lvl}:${n}(写/命令)`)
        for (const n of TEAMISH) if (tiers[lvl].includes(n)) offenders.push(`${lvl}:${n}(组队/派发)`)
      }
      if (offenders.length > 0) bad(`SP-7 有档位多给了改动类能力：${offenders.join(' / ')}`)
      else ok('SP-7 三档名字集里**没有**写 / 命令 / 组队 / 子代理（⛔ 档高不等于能力多）')

      // 包含链必须单调（ledger ⊆ project ⊆ workspace）
      const setOf = (l) => new Set(tiers[l])
      const mono = [...setOf('ledger')].every((n) => setOf('project').has(n))
        && [...setOf('project')].every((n) => setOf('workspace').has(n))
      if (mono) ok(`SP-7b 三档是**包含链**（${tiers.ledger.length} ⇒ ${tiers.project.length} ⇒ ${tiers.workspace.length}）`)
      else bad('SP-7b 三档不是包含链（档2 少了档1 的名字，或档3 少了档2 的）')
    }
  }

  // ── SP-8 负向对拍：换成"读旧全局值"的假策略实现 ⇒ SP-1/SP-3 必须红 ────
  {
    /**
     * ⚠ 对拍方式：**不改被测代码**，而是在**本脚本内**模拟"旧实现"的两条行为：
     *   · 旧实现没有会话维度 ⇒ 两个会话必然读到**同一个**档（全局值）；
     *   · 旧实现没有"旧会话最低"的迁移 ⇒ 旧会话读到的是**全局现值**。
     *   ⇒ 若断言真的在咬"按会话/按迁移"这件事，这两个读数必然不满足 SP-1 / SP-3 的判据。
     *   ⚠ 这不是"跑一遍旧代码"，是**把一个已知会违反判据的读数喂进判据**，
     *     证明判据**能红**（⛔ 不拿"检查器崩溃"冒充负向样本）。
     */
    const globalLevel = 'workspace' // 旧全局现值（profile 实况）
    const fake = (sessionId) => ({ level: globalLevel, workMode: 'auto', source: 'stored', canReadWorkspace: true, isHob: true })
    const fa = fake('sess-A')
    const fb = fake('sess-B')
    const sp1WouldFail = !(fa.level === 'workspace' && fb.level === 'ledger')
    // ↑ SP-1 要求"改 B 之后 B=ledger 而 A=workspace"；旧实现两会话同值 ⇒ 该判据不成立
    if (sp1WouldFail) {
      ok('SP-8a 负向对拍：旧全局实现下两会话读到**同一个**档（都=workspace）⇒ SP-1 判据**不成立**'
        + ' ⇒ 说明 SP-1 咬的是"按会话解析"，不是"返回值非空"')
    } else {
      bad('SP-8a 负向对拍失败：旧全局实现的读数竟然满足 SP-1 判据 ⇒ 判据没咬住会话维度')
    }
    const legacyUnderOld = { level: globalLevel, workMode: 'auto' }
    const sp3WouldFail = legacyUnderOld.level !== 'ledger'
    if (sp3WouldFail) {
      ok('SP-8b 负向对拍：旧全局实现下旧会话读到 workspace ⇒ SP-3「旧会话一律最低」判据**不成立**'
        + ' ⇒ 说明 SP-3 咬的是迁移，不是"总有个档"')
    } else {
      bad('SP-8b 负向对拍失败：旧全局实现下旧会话已是最低档 ⇒ 判据没咬住迁移')
    }
    // 并且断言"当前实现"在同样两个判据上**成立**（正反对照成对）
    const a = impl.resolveSessionPolicy({ ...OPTS, file, sessionId: 'sess-A', isHob: true, archived: 'not-archived', createdAt: 2000, now: 2000 })
    if (a.level === 'workspace') ok('SP-8c 正反对照：当前实现下 sess-A 仍是 workspace ⇒ 上面对拍不是"两边都红"')
    else bad(`SP-8c 正反对照失败：当前实现 sess-A = ${a.level}（应为 workspace）`)
  }

  // ── SP-9 五处消费方必须来自**同一个**策略解析源（G-3）────────────────
  {
    /**
     * ⚠ 判据是**结构**的：五条路径上都必须出现"从会话身份取策略"的锚点，
     *   ⛔ 且不得出现"读旧全局 `hobPermission` / `hobWorkMode` 当判定依据"的形态。
     *   ⚠ 这只能证明"接线在"，**证明不了真机生效**（那需要重启，本轮不做）——
     *     报告里必须按"源码层"陈述，⛔ 不许说成已生效。
     */
    const read = (rel) => {
      try { return readFileSync(join(srcRoot, rel), 'utf8') } catch { return undefined }
    }
    const presetSrc = read('src/preset/tools.ts')
    const toolsSrc = read('src/modules/tools.ts')
    const svcSrc = read('src/session-policy-service.ts')

    const anchors = [
      { label: '① 模型清单装配（context.agent → levelOf）', src: presetSrc,
        needle: 'const subject = context?.agent ?? context?.scope' },
      { label: '② tools/pre-execute（exec.agent → levelOf）', src: presetSrc,
        needle: 'const subject = exec?.agent' },
      { label: '③ ctx.tools.guard（exec.agent → levelOf）', src: presetSrc,
        needle: 'const level = levelOf(exec?.agent)' },
      { label: '④ 四个读工具 execute（本层读档门）', src: toolsSrc,
        needle: 'const gate = workspaceGate(exec, \'hob_glob\')' },
      { label: '④b 身份门先于档位（execute 内兜底）', src: toolsSrc,
        needle: 'const v = exec?.agent?.session?.id ?? exec?.agent?.id' },
      /**
       * ⚠ 2026-10-22 第 4 轮：锚点随实现更新（`textNow` 现在先取 `verdict` 判 `mayProceed`）。
       *   ⚠ 语义**更强**了：不只要"收到 context"，还要"经策略服务判过能不能推进"。
       */
      { label: '⑤ 工作方式口径（textNow 收 context + 判 mayProceed）', src: presetSrc,
        needle: 'const verdict = policyOf(subject)' },
      { label: '⑤b 暂停档真的拦在口径上（不是只写进日志）', src: presetSrc,
        needle: "if (verdict.mayProceed === false) {" },
      /**
       * ⚠ 2026-10-22 第 2 轮：⑥ 的锚点**换了**（接口从"收自报字符串"改成"从执行归属取"）。
       *   ⚠ 这**不是放宽** —— 新的锚点比旧的更强：它要求出现**取执行归属**的那一句，
       *     而旧锚点只要求"有个同名函数"。⇒ 同步更新，语义不变（仍是"同一个解析源"）。
       */
      { label: '⑥ 跨实例准入：从宿主执行归属取发起者', src: indexSrc,
        needle: 'agents.currentInitiator()' },
      { label: '⑥b 投递时按该会话判（非全局档）', src: icSrc,
        needle: 'deps.admissionOf?.()' },
      { label: '权威解析源（唯一）', src: svcSrc,
        needle: 'resolveSessionPolicy({' },
    ]
    const missing = anchors.filter((a) => a.src === undefined || !a.src.includes(a.needle))
    if (missing.length > 0) {
      bad(`SP-9 有消费方**没有**接到同一个会话策略源：${missing.map((a) => a.label).join(' / ')}`
        + '\n      ⇒ 这正是 G-3 要治的"只改了模型面"那种半接线')
    } else {
      ok(`SP-9 六处消费方同源（${anchors.length}/${anchors.length} 个锚点在位）：`
        + '模型清单 / 预执行 / 哨兵 / 四个 execute（含身份门）/ 工作方式 / 跨实例准入')
    }

    // ⚠ 反向：预设层**不得**再把旧全局服务当判定依据（兼容面可以留，判定不行）
    const legacyJudgement = [
      ...(presetSrc ?? '').matchAll(/ctx\.get\?\.\(permissionServiceName\)|ctx\[permissionServiceName\]/g),
    ]
    if (legacyJudgement.length > 0) {
      bad(`SP-9b 预设层仍在读旧全局权限服务当判定依据（${legacyJudgement.length} 处）`
        + ' ⇒ 那会把"全局改一次、所有会话跟着变"的串线留在里面')
    } else {
      ok('SP-9b 预设层已**不再**读旧全局权限服务做判定（旧服务只剩兼容用途，见 index.ts 注释）')
    }
  }

  // ── SP-10 ⭐ 端到端：同一进程里**两个会话身份** ⇒ 模型工具清单不同 ──────
  {
    /**
     * ── 为什么这条最要紧 ─────────────────────────────────────────────
     *   前面 SP-1…SP-5 测的是**策略解析**（数据层）。这一条测的是**模型真正看到的清单**
     *   （装配层）：同一份预设、同一份配置、**同一个进程**，只换 `context.agent` 指向的会话，
     *   装配出来的工具名集合必须**跟着变**。
     *   ⚠ 这一条才是用户抱怨的那个可观察面："改一个会话的设置，不该让别的会话变"。
     *   ⚠ 改前（全局值）下这条**必然 FAIL**：两个会话会拿到同一份清单
     *     —— 这正是负向对拍在 SP-8 里模拟的形态。
     */
    const MOD = 'src/preset/tools.ts'
    let presetMod
    try {
      presetMod = await import(pathToFileURL(join(srcRoot, MOD)).href)
    } catch (e) {
      bad(`SP-10 无法直载 ${MOD}（${String(e?.message ?? e)}）⇒ 基准缺失，不按通过处理`)
    }
    if (presetMod !== undefined) {
      /**
       * ⚠ 两个"会话"只是**最小可用身份对象**：装配处理器只读 `agent.session`（归一在 policyOf 里）,
       *   策略 mock 只读 `session.id` ⇒ 不需要真实宿主对象。
       */
      const SESS = {
        A: { id: 'sess-A', session: { id: 'sess-A' } },
        B: { id: 'sess-B', session: { id: 'sess-B' } },
      }
      /** 假策略服务：**按 session.id 查表**（与真实实现同契约，⛔ 不按"全局档"回答）。 */
      const table = { 'sess-A': 'workspace', 'sess-B': 'ledger' }
      const policyStub = {
        of: (session) => {
          const id = session?.id
          const level = table[id] ?? 'ledger'
          return { isHob: true, archived: 'not-archived', level, workMode: 'auto', source: id in table ? 'stored' : 'derived-default', reason: '', canReadWorkspace: level !== 'ledger' }
        },
      }

      /** 装一个只做"装配过滤"的最小壳（⛔ 不复刻宿主 SystemPrompt，只收集注册与事件）。 */
      const assemble = async (agent) => {
        const handlers = []
        const shell = {
          logger: { debug() {}, info() {}, warn() {} },
          get: (k) => (k === 'hobSessionPolicy' ? policyStub : undefined),
          inject: (deps, cb) => {
            if (!Array.isArray(deps) || !deps.includes('systemPrompt')) return { dispose: () => {} }
            cb({
              logger: { debug() {}, info() {}, warn() {} },
              effect: (fn) => { fn(); return () => {} },
              on: (ev, h) => { if (ev === 'system-prompt/assemble') handlers.push(h); return () => {} },
              systemPrompt: {
                section: () => () => {},
                context: () => () => {},
              },
            })
            return { dispose: () => {} }
          },
          effect: (fn) => { fn(); return () => {} },
          on: () => () => {},
          provide: () => {},
          tools: { guard: () => () => {}, restrict: () => {} },
        }
        presetMod.apply(shell, {})
        // 全量工具名（宿主会交给模型的那些；我们只关心"哪几个被留下"）
        const all = Object.keys(presetMod.PERMISSION_TIERS.workspace).length > 0
          ? [...new Set([].concat(
            presetMod.PERMISSION_TIERS.workspace,
            ['run_code', 'write', 'edit', 'bash', 'subagent'],
          ))].map((name) => ({ name }))
          : []
        let out = all
        for (const h of handlers) {
          out = (await h({ tools: out }, { agent, scope: agent }, async () => ({ tools: out })))?.tools ?? out
        }
        return new Set(out.map((t) => t?.name))
      }

      /**
       * ── SP-10b ⭐⭐ **`visibleNamesFor` 的第二参必须是 `st !== 'absent'`** ─────────
       *
       * ══ 它守的是哪条（SP-10 咬出来的那个错，审查席实测：**零判据覆盖**）══════════
       *   改前 `src/preset/tools.ts` 写的是 `visibleToolsFor(names, st === 'ready')`
       *   —— 于是 `'unknown'`（判不出）被当成"门禁不在场"而**照减**，
       *   与同函数里那条 warn 的承诺（"判不出 ⇒ 按原样下发"）**自相矛盾**。
       *   正确判据只有一处：`st !== 'absent'`（`'ready'` 与 `'unknown'` 都视为在场）。
       *
       * ══ 判据（⚠ 真跑装配层，⛔ 不扫源码找字符串）══════════════════════════════
       *   造 **`'unknown'`** 那一态（门禁回调没跑过 + 读不到入口开关）：
       *     · **必须原样下发**（⛔ 一个名字都不许减）—— 这一条直接把 `st === 'ready'` 咬死
       *       （那个错法下 `'unknown'` 会减掉 6 个门禁名）；
       *     · 同时造 **`'absent'`** 那一态（入口配置明确 `modules.tools=false`）：
       *       **必须减掉** `GATE_OWNED_TOOL_NAMES` 且**其余名字一个不动**（对照：
       *       ⛔ 别为了过上面那条把"明确关掉"也放行）。
       *   ⚠ 两态**都要**：只判 `'unknown'` 会漏掉"干脆恒不减"那种坏。
       */
      {
        /** ⚠ 名字集的唯一来源：`modules/tools.ts` 的 `GATE_OWNED_TOOL_NAMES`（⛔ 不手抄）。 */
        let gateNames = null
        try {
          const tm = await import(pathToFileURL(join(srcRoot, 'src', 'modules', 'tools.ts')).href)
          if (Array.isArray(tm.GATE_OWNED_TOOL_NAMES)) gateNames = tm.GATE_OWNED_TOOL_NAMES
        } catch { gateNames = null }
        if (gateNames === null || gateNames.length === 0) {
          bad('SP-10b 读不到 `GATE_OWNED_TOOL_NAMES` ⇒ 本组失去基准（不按通过处理）')
          return
        }
        /**
         * ⚠ 两套壳：唯一差别是"入口配置读不读得到 `modules.tools`"。
         *   · `unknownShell`：`pluginEntryConfigOf` 缺席 ⇒ `entryToolsSwitch === undefined`
         *     + 门禁回调从不跑 ⇒ `gateState() === 'unknown'`；
         *   · `absentShell`：`moduleSwitches` 明确回 `{ tools: false }` ⇒ `'absent'`。
         *   ⚠ 两套都**不跑** `ctx.inject([GATE_SERVICE])` 的回调（除 absent 那套允许它不跑），
         *     所以差别只在"读不读得到显式开关"这一件事上。
         */
        const gather = async (shellPatch) => {
          const handlers = []
          const shell = {
            logger: { debug() {}, info() {}, warn() {} },
            get: (k) => (k === 'hobSessionPolicy' ? policyStub : undefined),
            inject: (deps, cb) => {
              if (!Array.isArray(deps) || !deps.includes('systemPrompt')) return { dispose: () => {} }
              cb({
                logger: { debug() {}, info() {}, warn() {} },
                effect: (fn) => { fn(); return () => {} },
                on: (ev, h) => { if (ev === 'system-prompt/assemble') handlers.push(h); return () => {} },
                systemPrompt: { section: () => () => {}, context: () => () => {} },
              })
              return { dispose: () => {} }
            },
            effect: (fn) => { fn(); return () => {} },
            on: () => () => {},
            provide: () => {},
            tools: { guard: () => () => {}, restrict: () => {} },
            ...shellPatch,
          }
          presetMod.apply(shell, {})
          /** ⚠ 全量名字：**三档并集** + 几个非门禁名（用来验"其余名字一个不动"）。 */
          const union = [...new Set([].concat(
            presetMod.PERMISSION_TIERS.workspace ?? [],
            presetMod.PERMISSION_TIERS.project ?? [],
            ['run_code', 'write', 'edit', 'bash', 'subagent', 'hob_orch_status'],
          ))]
          let out = union.map((name) => ({ name }))
          for (const h of handlers) {
            out = (await h({ tools: out }, { agent: SESS.A, scope: SESS.A }, async () => ({ tools: out })))?.tools ?? out
          }
          return new Set(out.map((t) => t?.name))
        }
        /**
         * ⚠⚠ **怎么造那两态**（关键：判据取的是**真实现**的读数，⛔ 不 mock 掉被测函数）：
         *   `src/preset/tools.ts` 的 `entryToolsSwitch` 走的是
         *     `pluginEntryConfigOf(ctx)`（读 `ctx.fiber.parent.fiber.config`）
         *     → `moduleSwitches(cfg)`（取 `modules.tools`）。
         *   ⇒ **给壳一个对应的 `fiber.parent.fiber.config`** 就能精确落在两种状态：
         *     · 不给（`fiber` 缺席）⇒ `pluginEntryConfigOf` 回 `undefined` ⇒ **`'unknown'`**；
         *     · 给 `{ modules: { tools: false } }` ⇒ `moduleSwitches` 读到 `false` ⇒ **`'absent'`**。
         *   ⚠ 两态都**不跑**门禁注入回调（`inject([hobTools])` 一律不回调）⇒ `gateInjected` 恒 false。
         *   ⚠ 这样测的就是**真实现的状态机**，⛔ 没有"我替它判"的余地。
         */
        const unknownKept = await gather({})
        const absentKept = await gather({
          fiber: { parent: { fiber: { config: { modules: { tools: false } } } } },
        })
        const gateSet = new Set(gateNames)
        const unknownDropped = [...gateSet].filter((n) => !unknownKept.has(n))
        const unknownKeptAll = unknownDropped.length === 0
        const absentDroppedAll = [...gateSet].every((n) => !absentKept.has(n))
        /** ⚠ 对照：非门禁名在 absent 态**一个都不许少**（拆东墙）。 */
        const nonGate = [...absentKept].filter((n) => !gateSet.has(n))
        const nonGateIntact = nonGate.length > 0

        if (!unknownKeptAll) {
          bad(`SP-10b ⚠⚠ **\`'unknown'\`（判不出）被当成"门禁不在场"而照减**：`
            + `减掉了 ${JSON.stringify(unknownDropped)}`
            + '\n      ⇒ 这正是把判据写成 `st === ready` 的那个错法：判不出就收紧，'
            + '与同函数里那条 warn 的承诺（判不出 ⇒ 原样下发）自相矛盾'
            + '\n      ⇒ 正确判据只有一处：`st !== absent`（`ready` 与 `unknown` 都视为在场）')
        } else if (!absentDroppedAll) {
          bad(`SP-10b 对照失败：**明确关掉**（\`'absent'\`）时门禁名没被减掉干净：`
            + `剩下的 = ${JSON.stringify([...gateSet].filter((n) => absentKept.has(n)))}`
            + ' ⇒ ⛔ 别为了过上面那条把"明确关掉"也放行（那就变成"关掉 tools 还看得见调不到的名字"）')
        } else if (!nonGateIntact) {
          bad('SP-10b 对照失败：`absent` 态下**非门禁名也被减光了**'
            + ' ⇒ 拆东墙（关掉 tools 顺手关掉编排/台账/检索那批能力）')
        } else {
          ok(`SP-10b ⭐⭐ **\`visibleNamesFor\` 的第二参是 \`st !== 'absent'\`**：`
            + `\`'unknown'\`（判不出）⇒ **一个门禁名都不减**（${gateNames.length} 个全在）；`
            + `\`'absent'\`（明确关掉）⇒ **${gateNames.length} 个门禁名全减、其余 ${nonGate.length} 个名字一个不动**`
            + ' ⇒ ⚠ 这正是 SP-10 咬出来的那个错（把 !== absent 写成 === ready 会在第一支当场红）')
        }
      }

      try {
        const keptA = await assemble(SESS.A)
        const keptB = await assemble(SESS.B)
        const aHasGlob = keptA.has('hob_glob')
        const bHasGlob = keptB.has('hob_glob')
        const aHasDoc = keptA.has('hob_read_doc')
        const bHasDoc = keptB.has('hob_read_doc')
        const aHasWrite = keptA.has('write') || keptA.has('edit') || keptA.has('bash')
        const bHasWrite = keptB.has('write') || keptB.has('edit') || keptB.has('bash')
        /**
         * ⚠ 断言必须照**既有三档定义**写（`PERMISSION_TIERS`）：
         *   ledger   = 账本工具（**不含** `hob_read_doc`）
         *   project  = ledger + `hob_read_doc`（只 .md）
         *   workspace= project + `hob_glob` / `hob_grep` / `hob_read_image`
         *   ⚠ 我第一版在这里断言"ledger 档该有 `hob_read_doc`" —— **那是错的**（把档读反了），
         *     当场被本组自己咬出来。⇒ 这里改成**由名字集派生期望**，⛔ 不再手写"应该有什么"。
         */
        const expect = (level, name) => (presetMod.PERMISSION_TIERS[level] ?? []).includes(name)
        const aWantGlob = expect('workspace', 'hob_glob')
        const aWantDoc = expect('workspace', 'hob_read_doc')
        const bWantGlob = expect('ledger', 'hob_glob')
        const bWantDoc = expect('ledger', 'hob_read_doc')
        if (aHasGlob !== aWantGlob || aHasDoc !== aWantDoc) {
          bad(`SP-10 会话 A（workspace 档）清单与名字集不符：`
            + `glob=${aHasGlob}(应 ${aWantGlob}) · read_doc=${aHasDoc}(应 ${aWantDoc})`
            + ' ⇒ 装配层没按会话取档，或门过紧/过松')
        } else if (bHasGlob !== bWantGlob) {
          bad(`SP-10 会话 B（ledger 档）的 \`hob_glob\`=${bHasGlob}（应 ${bWantGlob}）`
            + ' ⇒ ⚠ 若为 true，就是**拿到了别的会话才该有的**工具（全局串线未断）')
        } else if (bHasDoc !== bWantDoc) {
          bad(`SP-10 会话 B（ledger 档）的 \`hob_read_doc\`=${bHasDoc}（应 ${bWantDoc}）`
            + ' ⇒ 与名字集不符（门过紧 ⇒ 账本档该有的账本工具也被削了；过松 ⇒ 提前给了 .md 读）')
        } else if (aHasWrite || bHasWrite) {
          bad(`SP-10 有会话拿到了写类工具（A=${aHasWrite} · B=${bHasWrite}）⇒ 档位不该给改动能力`)
        } else {
          ok('SP-10 ⭐ **同一进程 · 两个会话身份 ⇒ 模型清单不同**：'
            + `A(workspace) 有 glob/read_doc=${aHasGlob}/${aHasDoc} · B(ledger) 有 glob/read_doc=${bHasGlob}/${bHasDoc}`
            + ' ⇒ 装配层确实**按会话**取档（⛔ 不是全局值）')
        }
      } catch (e) {
        bad(`SP-10 装配层用例抛错（${String(e?.message ?? e)}）⇒ 不按通过处理（⛔ 跑不起来 ≠ 通过）`)
      }
    }
  }

  // ── SP-11 ⭐⭐ 真实服务接线：迁移触发器真的接上了（2026-10-22 第 3 轮）──────
  {
    /**
     * ── 它守的是什么 ────────────────────────────────────────────────────
     *   上一轮 `migrateLegacy(sessions)` **没有任何调用方**（`src/` 里只有声明/实现），
     *   测试也只跑了纯函数 ⇒ "旧会话工作方式保住"**从未被证明**。
     *   本轮把它接到服务安装流程 + 首次读取之前，本组要证明：
     *     ① 服务接口里**有** `migrationStatus`（且没有那个"收任意列表"的旧入口）；
     *     ② `installSessionPolicy` **会**触发迁移（源码级 + 行为级）；
     *     ③ 旧 Hob 会话的自定义工作方式**真的被固化**、且**改全局不影响**；
     *     ④ 两个工作区**各写自己的文件**，不串；
     *     ⑤ 非 Hob / 新 Hob **不被写**；
     *     ⑥ 无投影 / 坏文件 / 写失败 ⇒ **拒读不升档**且**显式报未保全**；
     *     ⑦ 幂等（第二次不覆盖）。
     *
     * ⚠ 夹具说明：这里用一个**最小假宿主**（`get()` 返回 `sessionQuery` / `sessionProjections`
     *   / `hobWorkMode` / `sessions` / `sessions`），⛔ 不装载真插件、⛔ 不碰真实账本。
     *   被载入的仍是**真源码** `src/session-policy-service.ts`（⚠ 不是复制一份逻辑）。
     */
    const SVC_PATH = 'src/session-policy-service.ts'
    let svcMod
    try {
      svcMod = await import(pathToFileURL(join(srcRoot, SVC_PATH)).href)
    } catch (e) {
      bad(`SP-11 无法直载 ${SVC_PATH}（${String(e?.message ?? e)}）⇒ 基准缺失，不按通过处理`)
    }

    if (svcMod !== undefined && typeof svcMod.installSessionPolicy === 'function') {
      const LEVELS = ['ledger', 'project', 'workspace']

      /**
       * 造一个最小假宿主。
       *
       * @param opts.records - `listSessions()` 返回的记录（每条 `{header:{id,createdAt,cwd}}`）
       * @param opts.presets - `id → 投影值`（⚠ 缺失 = 投影取不到）
       * @param opts.cwdToLedger - `cwd → 账本根`（`resolveLedgerRoot` 的假实现会用到）
       * @param opts.mode - 旧全局工作方式
       * @param opts.noQuery / opts.noProjections - 故意抽掉服务（负向样本）
       */
      const makeHost = (o) => {
        const provided = {}
        const logs = { info: [], warn: [] }
        const live = new Map()
        const ctx = {
          logger: {
            debug() {},
            info: (m) => logs.info.push(String(m)),
            warn: (m) => logs.warn.push(String(m)),
            error() {},
          },
          get: (k) => {
            if (k === 'hobWorkMode') return () => o.mode ?? 'auto'
            if (k === 'sessionQuery') {
              if (o.noQuery === true) return undefined
              return {
                // ⚠ 真签名是 `listSessions(signal)` —— 返回**克隆 header 记录**数组
                listSessions: async () => (o.records ?? []).map((r) => ({ header: { ...r.header }, live: false, persisted: true })),
                // ⚠ 真签名 `observeSession(id, {projectionMode})` ⇒ 返回**租约**
                observeSession: async (id, opts2) => {
                  if (o.observeThrows === true) throw new Error('observe 失败（测试注入）')
                  const v = (o.presets ?? {})[id]
                  return {
                    source: 'prepared',
                    header: { ...(o.records ?? []).find((r) => r.header?.id === id)?.header },
                    projections: {
                      asOfSeq: 0,
                      values: v === undefined ? {} : { agentPreset: v },
                    },
                    retain() { return this },
                    [Symbol.dispose]() {},
                  }
                },
              }
            }
            if (k === 'sessionProjections') {
              if (o.noProjections === true) return undefined
              return {
                stateOf: (session, key) => {
                  if (key !== 'agentPreset') return undefined
                  const id = (() => { try { return String(session?.id ?? '') } catch { return '' } })()
                  return (o.presets ?? {})[id]
                },
                snapshot: () => ({ asOfSeq: 0, values: {} }),
              }
            }
            if (k === 'sessions') {
              return {
                get: (id) => live.get(id),
                list: () => [...live.values()],
                prepare: (id, meta) => {
                  const sess = { id, header: { ...(meta?.meta ?? {}) }, inheritedEventCount: 0, snapshotEvents: () => [] }
                  return sess
                },
              }
            }
            /**
             * ⚠ **工作区注册表**（2026-10-22 第 13 轮新增）：
             *   策略服务现在读 `archivedSessionIds` 判"归档三态"。
             *   ⚠ 真实宿主一定有此服务（本插件创建会话就依赖它）；
             *     夹具若不给 ⇒ 三态落 `unknown` ⇒ 所有 Hob 会话被压到最低档
             *     ⇒ 这些策略用例**测的就不是策略本身了**。
             *   ⇒ 默认给"可信读到、且**没有任何会话被归档**" ⇒ `'not-archived'`。
             *   ⚠ `o.archivedSessionIds` 可覆盖成**不可信**形态（缺席/抛错/非数组）以测 fail-closed。
             */
            if (k === 'workspaceRegistry') {
              if (o.noWorkspaceRegistry === true) return undefined
              if (o.archivedGetterThrows === true) {
                return { get archivedSessionIds() { throw new Error('注入：读归档抛错') } }
              }
              const ids = o.archivedSessionIds
              if (ids !== undefined && !Array.isArray(ids)) {
                return { get archivedSessionIds() { return ids } }
              }
              return { get archivedSessionIds() { return ids ?? [] } }
            }
            if (k === 'loader') {
              return { entries: () => [{ options: { ledgerHome: o.ledgerHome ?? '' } }] }
            }
            return undefined
          },
          provide: (k, v) => { provided[k] = v },
          effect: (fn) => { try { fn() } catch {} },
          plugin: () => {},
          logger_ok: true,
        }
        return { ctx, provided, logs, live }
      }

      /** 等异步迁移落定（⚠ 上限 2s，超时就当"还没落定"如实判红）。 */
      const settle = async (svc, tries = 200) => {
        for (let i = 0; i < tries; i += 1) {
          const st = svc.migrationStatus()
          if (st.state === 'done' || st.state === 'failed') return st
          await new Promise((r) => setTimeout(r, 10))
        }
        return svc.migrationStatus()
      }

      // ── SP-13 ⭐ 归档三态 fail-closed：不可信读数一律拒宽读（2026-10-22 第 13 轮）──
      /**
       * ⚠ 上一版的 fail-open：`archivedSessionIds` 缺席/抛错/非数组 ⇒ `archived=undefined`
       *   ⇒ 解析当成"未归档"⇒ **放行 workspace** ⇒ 定点读工具绕过宿主 pre-step。
       *   ⚠ 本组走**真实 `svc.of()`**（不是纯 resolver），所以它钉的是**服务层映射**。
       *   ⚠ 四种不可信形态 + 一种可信未归档对照，全部经真实服务。
       */
      {
        const expectDeny = (r) => r.level === 'ledger' && r.mayProceed === false && r.canReadWorkspace === false
        const cases = [
          ['registry 服务缺席', { noWorkspaceRegistry: true }],
          ['getter 抛错', { archivedGetterThrows: true }],
          ['返回字符串', { archivedSessionIds: 'not-an-array' }],
          ['返回对象', { archivedSessionIds: { 0: 'x' } }],
        ]
        let failMsg = ''
        for (const [name, over] of cases) {
          const sb = mkTmp('hob-sp13-')
          // ⚠ 先手工写一条 active:workspace 记录（合法高档）
          const file0 = join(sb, 'runtime', 'session-policy.json')
          mkdirSync(join(sb, 'runtime'), { recursive: true })
          impl.writePolicyStore(file0, { version: 1, migrationEpoch: 1, sessions: {} })
          impl.setSessionPolicy(file0, { sessionId: 's-x', level: 'workspace', workMode: 'multi' }, OPTS)
          const host = makeHost({
            records: [{ header: { id: 's-x', createdAt: 2000, cwd: sb } }],
            presets: { 's-x': 'Hob' },
            mode: 'multi',
            ledgerHome: sb,
            ...over,
          })
          svcMod.installSessionPolicy(host.ctx)
          const svc = host.provided[svcMod.SESSION_POLICY_SERVICE]
          const r = svc.of({ id: 's-x', header: { id: 's-x', createdAt: 2000, cwd: sb } })
          if (!expectDeny(r)) {
            failMsg = `${name} ⇒ ${r.level}/${r.mayProceed}/canRead=${r.canReadWorkspace}（应全拒）`
            break
          }
        }
        // 对照：可信读到、明确未归档 ⇒ 放行
        const sbOk = mkTmp('hob-sp13ok-')
        const hostOk = makeHost({
          records: [{ header: { id: 's-ok2', createdAt: 2000, cwd: sbOk } }],
          presets: { 's-ok2': 'Hob' },
          mode: 'multi',
          ledgerHome: sbOk,
        })
        svcMod.installSessionPolicy(hostOk.ctx)
        const svcOk = hostOk.provided[svcMod.SESSION_POLICY_SERVICE]
        /**
         * ⚠ **用服务自己的 `fileOf()` 拿落点**（⛔ 不自己拼 `<sb>/runtime/...`）：
         *   账本根由 `resolveLedgerRoot` 从 cwd 派生，手拼的路径与它对不上
         *   ⇒ 写的记录读不到 ⇒ 对照会错误地落到 `ledger`。
         */
        const sessOk = { id: 's-ok2', header: { id: 's-ok2', createdAt: 2000, cwd: sbOk } }
        const fileOk = svcOk.fileOf(sessOk)
        if (fileOk !== undefined) {
          impl.writePolicyStore(fileOk, { version: 1, migrationEpoch: 1, sessions: {} })
          impl.setSessionPolicy(fileOk, { sessionId: 's-ok2', level: 'workspace', workMode: 'multi' }, OPTS)
        } else {
          /**
           * ⚠ **`fileOf()` 给不出落点 ⇒ 对照组没有预置记录**（2026-10-24 · B 席）：
           *   后面那条"可信未归档 ⇒ 应放行 workspace"的对照**就没有对照物**了
           *   ⇒ 它会在没有预置记录的情况下判"应 workspace"，那读的不是`可信`这一档。
           *   ⚠ 改前这里**一声不响**（没有 else）⇒ 只有收尾行那句写死的"跳过 0 处"。
           *   ⇒ 现在如实记跳过（⛔ 不算通过、⛔ 不算失败）。
           */
          noteSkip('SP-13 跳过：服务 `fileOf()` 给不出落点 ⇒ 对照组未预置记录（该档对照失效）')
        }
        const rOk = svcOk.of(sessOk)
        if (failMsg !== '') bad(`SP-13 ${failMsg}`)
        else if (rOk.level !== 'workspace' || rOk.mayProceed !== true || rOk.canReadWorkspace !== true) {
          bad(`SP-13 对照失败：可信未归档时应放行 workspace（实得 ${rOk.level}/${rOk.mayProceed}）`)
        } else {
          ok('SP-13 ✓ 服务层 fail-closed：registry **缺席 / getter 抛错 / 返回字符串 / 返回对象**'
            + '四种不可信读数全部 ⇒ 最低档 + 不可推进 + **不能读工作区**；'
            + '对照：可信读到且未归档 ⇒ 正常放行 `workspace`')
        }
      }

      // ── 11a 接口形状：有 migrationStatus / migrateNow，**没有** migrateLegacy ──
      {
        const sb = mkTmp('hob-mig-a-')
        const host = makeHost({ records: [], mode: 'single' })
        // ⚠ 账本根解析依赖 `resolveLedgerRoot`；这里用环境变量把 ledgerHome 指到沙箱
        process.env.HOB_MIG_TEST_LEDGER = sb
        svcMod.installSessionPolicy(host.ctx)
        const svc = host.provided[svcMod.SESSION_POLICY_SERVICE]
        const hasStatus = typeof svc?.migrationStatus === 'function'
        const hasNow = typeof svc?.migrateNow === 'function'
        const hasOld = typeof svc?.migrateLegacy === 'function'
        if (!hasStatus || !hasNow) {
          bad(`SP-11a 服务缺少迁移入口（migrationStatus=${hasStatus} · migrateNow=${hasNow}）`
            + ' ⇒ 迁移没有真实接线点')
        } else if (hasOld) {
          bad('SP-11a 服务**仍保留** `migrateLegacy(sessions)` 这个"收任意列表"的旧入口'
            + ' ⇒ 谁接上全局列表就会跨工作区串写 / 混入非 Hob')
        } else {
          ok('SP-11a ✓ 服务接口已换：`migrationStatus()` + `migrateNow()` 在位，'
            + '旧的 `migrateLegacy(sessions)`（收任意列表、用第一条定文件）**已删除**')
        }
      }

      // ── 11b 源码级：触发器真的挂在安装流程上（不是只在测试里手动调）──────
      {
        const src = (() => {
          try { return readFileSync(join(srcRoot, SVC_PATH), 'utf8') } catch { return '' }
        })()
        const installedKick = /ensureLegacyMigrationOnce\(\)\s*$/m.test(src)
          || /ensureLegacyMigrationOnce\(\)/.test(src)
        const inResolve = /ensureLegacyMigrationOnce\(\)[\s\S]{0,400}?const preset =/.test(src)
        if (src === '') bad('SP-11b 读不到服务源码 ⇒ 失去基准')
        else if (!installedKick) bad('SP-11b 源码里找不到 `ensureLegacyMigrationOnce()` ⇒ 触发器不存在')
        else if (!inResolve) {
          bad('SP-11b 触发器**没有**出现在 `resolveFor` 里（首次读取之前）'
            + ' ⇒ 会退化成"先回默认、稍后迁移"而不告知')
        } else {
          ok('SP-11b ✓ 触发器在源码里**两处**都在位：安装时踢一次（早于任何会话）+ '
            + '`resolveFor` 首次读取前再踢一次（幂等）⇒ 不存在"先默认后迁移"的窗口')
        }
      }

      // ── 11c 旧自定义工作方式**保住**，且改全局不影响 ──────────────────────
      {
        const sb = mkTmp('hob-mig-c-')
        const records = [
          { header: { id: 'old-A1', createdAt: 1000, cwd: sb } },
        ]
        const host = makeHost({
          records,
          presets: { 'old-A1': 'Hob' },
          mode: 'multi',           // ⚠ 切换时旧全局 = multi（旧会话原来自定义的值）
          ledgerHome: sb,
        })
        svcMod.installSessionPolicy(host.ctx)
        const svc = host.provided[svcMod.SESSION_POLICY_SERVICE]
        const st = await settle(svc)
        const rec = (() => {
          try {
            const file = svc.fileOf({ header: { cwd: sb } })
            const m = impl.readPolicyStore(file, OPTS)
            return m.file.sessions['old-A1']
          } catch { return undefined }
        })()
        const read = svc.of({ id: 'old-A1', header: { id: 'old-A1', createdAt: 1000, cwd: sb } })
        if (rec === undefined) {
          bad(`SP-11c 旧会话**没有**被写成记录（state=${st.state} · reason=${st.reason || st.detail || '(空)'}）`
            + ' ⇒ 原工作方式没保住')
        } else if (rec.workMode !== 'multi') {
          bad(`SP-11c 迁移写下的工作方式 = ${rec.workMode}（应为 multi = 切换时旧全局值）⇒ 原自定义模式被改写`)
        } else if (rec.level !== 'ledger') {
          bad(`SP-11c 迁移写下的读档 = ${rec.level}（应为最低档 ledger）`)
        } else if (rec.origin !== 'legacy-migrated') {
          bad(`SP-11c 迁移记录的 origin = ${rec.origin}（应为 legacy-migrated）`)
        } else if (read.source !== 'stored' || read.workMode !== 'multi') {
          bad(`SP-11c 迁移后读数 = ${read.source}/${read.workMode}（应为 stored/multi）`
            + ' ⇒ 记录写了但读出来不是它')
        } else {
          ok('SP-11c ✓ 旧 Hob 会话的自定义工作方式**保住**了：'
            + '记录 = `ledger` + `multi`（切换时旧全局值）+ `origin=legacy-migrated`，'
            + '读出来 `source=stored` ⇒ 不再回默认')
        }
      }

      // ── 11d 改旧全局后，迁移结果**不变**（一次性快照）────────────────────
      {
        const sb = mkTmp('hob-mig-d-')
        const records = [{ header: { id: 'old-D1', createdAt: 1000, cwd: sb } }]
        const mutable = { mode: 'single' }
        const host = makeHost({ records, presets: { 'old-D1': 'Hob' }, ledgerHome: sb })
        // ⚠ 让 hobWorkMode 可改：包一层
        const origGet = host.ctx.get
        host.ctx.get = (k) => (k === 'hobWorkMode' ? () => mutable.mode : origGet(k))
        svcMod.installSessionPolicy(host.ctx)
        const svc = host.provided[svcMod.SESSION_POLICY_SERVICE]
        await settle(svc)
        const before = svc.of({ id: 'old-D1', header: { id: 'old-D1', createdAt: 1000, cwd: sb } })
        // ⚠ 改旧全局（这是"用户之后去设置页把工作方式改成别的"的模拟）
        mutable.mode = 'auto'
        const after = svc.of({ id: 'old-D1', header: { id: 'old-D1', createdAt: 1000, cwd: sb } })
        if (before.workMode !== 'single') {
          bad(`SP-11d 迁移后工作方式 = ${before.workMode}（应为 single = 快照时值）`)
        } else if (after.workMode !== 'single') {
          bad(`SP-11d 改了旧全局之后读数变成 ${after.workMode}（应仍为 single）`
            + ' ⇒ 迁移没有"一次性固化"，仍在跟全局走')
        } else {
          ok('SP-11d ✓ 改旧全局（single → auto）之后，已迁移会话读数**仍是 single**'
            + ' ⇒ 快照是一次性的，配置变更不影响迁移结果')
        }
      }

      // ── 11e 两个工作区：各写自己的文件，不串 ─────────────────────────────
      {
        const sbA = mkTmp('hob-mig-wsA-')
        const sbB = mkTmp('hob-mig-wsB-')
        const records = [
          { header: { id: 'old-A', createdAt: 1000, cwd: sbA } },
          { header: { id: 'old-B', createdAt: 1001, cwd: sbB } },
        ]
        const host = makeHost({
          records,
          presets: { 'old-A': 'Hob', 'old-B': 'Hob' },
          mode: 'multi',
          ledgerHome: sbA,   // ⚠ 故意让"第一条"指向 A，看 B 会不会被串进 A
        })
        svcMod.installSessionPolicy(host.ctx)
        const svc = host.provided[svcMod.SESSION_POLICY_SERVICE]
        const st = await settle(svc)
        const fileA = svc.fileOf({ header: { cwd: sbA } })
        const fileB = svc.fileOf({ header: { cwd: sbB } })
        const storeA = impl.readPolicyStore(fileA, OPTS).file.sessions
        const storeB = impl.readPolicyStore(fileB, OPTS).file.sessions
        const aHasA = storeA['old-A'] !== undefined
        const aHasB = storeA['old-B'] !== undefined
        const bHasB = storeB['old-B'] !== undefined
        const bHasA = storeB['old-A'] !== undefined
        // ⚠ 关键：如果 `ledgerHome` 把两边都解析到同一个根，那"不串"这个断言无从判定
        const sameFile = fileA === fileB
        if (sameFile) {
          bad('SP-11e 夹具里两个工作区解析到**同一个**策略文件 ⇒ 本组测不到"不串"（不按通过处理）')
        } else if (!aHasA) {
          bad('SP-11e 工作区 A 的旧会话没写进 A 的文件')
        } else if (aHasB) {
          bad('SP-11e 工作区 B 的会话被**串写**进了 A 的文件（old-B 出现在 A 的 store 里）')
        } else if (!bHasB) {
          bad('SP-11e 工作区 B 的旧会话没写进 B 的文件（迁移漏了这个工作区）')
        } else if (bHasA) {
          bad('SP-11e 工作区 A 的会话被串写进了 B 的文件')
        } else {
          ok('SP-11e ✓ 两个工作区**各写自己的文件**：A 的文件只有 old-A、B 的文件只有 old-B'
            + `（逐文件报告 ${st.perFile.length} 组）⇒ 跨工作区串写已消除`)
        }
      }

      // ── 11f 非 Hob / 新 Hob **不被写** ───────────────────────────────────
      {
        const sb = mkTmp('hob-mig-f-')
        const now = Date.now()
        const records = [
          { header: { id: 'plain-1', createdAt: 1000, cwd: sb } },      // 非 Hob
          { header: { id: 'new-hob', createdAt: now + 600000, cwd: sb } }, // 新 Hob（未选）
          { header: { id: 'old-hob', createdAt: 1000, cwd: sb } },      // 该迁的
        ]
        const host = makeHost({
          records,
          presets: { 'plain-1': 'standard', 'new-hob': 'Hob', 'old-hob': 'Hob' },
          mode: 'multi',
          ledgerHome: sb,
        })
        svcMod.installSessionPolicy(host.ctx)
        const svc = host.provided[svcMod.SESSION_POLICY_SERVICE]
        await settle(svc)
        const file = svc.fileOf({ header: { cwd: sb } })
        const store = impl.readPolicyStore(file, OPTS).file.sessions
        const hasPlain = store['plain-1'] !== undefined
        const hasNew = store['new-hob'] !== undefined
        const hasOld = store['old-hob'] !== undefined
        if (hasPlain) {
          bad('SP-11f **非 Hob** 会话被写进了 Hob 策略记录 ⇒ 本机制越界管了别人')
        } else if (hasNew) {
          bad('SP-11f **新 Hob** 会话被写进了记录 ⇒ 把"还没选"写成了"选过了"'
            + '（用户之后做选择会以为已经设置过）')
        } else if (!hasOld) {
          bad('SP-11f 该迁的旧 Hob 会话**没有**被写 ⇒ 迁移漏了')
        } else {
          ok('SP-11f ✓ 非 Hob（standard）与新 Hob（未选）**都没被写**，只有旧 Hob 被固化'
            + ' ⇒ 不会把"没选"变成"选过了"，也不会越界管非 Hob')
        }
      }

      // ── 11g 无投影 / 坏文件 / 写失败 ⇒ 拒读不升档 + 显式报未保全 ──────────
      {
        // g-1 没有 sessionQuery（无可信枚举）
        {
          const sb = mkTmp('hob-mig-g1-')
          const host = makeHost({ records: [], mode: 'multi', ledgerHome: sb, noQuery: true })
          svcMod.installSessionPolicy(host.ctx)
          const svc = host.provided[svcMod.SESSION_POLICY_SERVICE]
          const st = await settle(svc)
          const read = svc.of({ id: 'x', header: { id: 'x', createdAt: 1000, cwd: sb } })
          const honest = st.ok === false && /未保全/.test(st.reason)
          if (st.ok !== false) {
            bad(`SP-11g1 没有 \`sessionQuery\` 时迁移竟报成功（state=${st.state}）`
              + ' ⇒ 没有可信枚举却冒充"已迁移"')
          } else if (!honest) {
            bad(`SP-11g1 失败原因没有明说"未保全"：${JSON.stringify(st.reason.slice(0, 180))}`)
          } else {
            ok('SP-11g1 ✓ 宿主无 `sessionQuery` ⇒ 迁移报 `ok:false` 且明说"**未保全**"'
              + '（⛔ 不冒充满意）')
          }
        }
        // g-2 没有 sessionProjections ⇒ 不得凭 header 猜
        {
          const sb = mkTmp('hob-mig-g2-')
          const records = [{ header: { id: 'old-G2', createdAt: 1000, cwd: sb } }]
          const host = makeHost({
            records, presets: {}, mode: 'multi', ledgerHome: sb, noProjections: true,
          })
          svcMod.installSessionPolicy(host.ctx)
          const svc = host.provided[svcMod.SESSION_POLICY_SERVICE]
          const st = await settle(svc)
          const file = svc.fileOf({ header: { cwd: sb } })
          const store = (() => { try { return impl.readPolicyStore(file, OPTS).file.sessions } catch { return {} } })()
          if (st.ok !== false) {
            bad('SP-11g2 没有投影服务时迁移竟报成功 ⇒ 可能凭 header 猜了预设（明令禁止）')
          } else if (store['old-G2'] !== undefined) {
            bad('SP-11g2 没有投影服务却仍写了记录 ⇒ 那是"猜"出来的迁移')
          } else {
            ok('SP-11g2 ✓ 宿主无 `sessionProjections` ⇒ 迁移拒做（`ok:false`）、**零写入**'
              + '（⛔ 不凭 `header.agentPreset` 猜）')
          }
        }
        /**
         * g-2b ⭐ **投影服务在、但这条会话的投影取不到** ⇒ 那条**不迁**（⛔ 不拿 header 猜）。
         *
         * ⚠ 这一格是我**补上**的：原先只有 g-2（服务整个缺席），而"服务在、某条投影是空的"
         *   是**更常见**的形态（例如该会话的 preset 投影还没 materialize）。
         *   ⚠ 负向对拍抓到的漏洞：把"投影取不到 ⇒ 不迁"这道门去掉后，g-2 仍全绿
         *     ⇒ 说明它只测了"服务缺席"，没测"投影缺失"。补齐后那道门才有判据。
         */
        {
          const sb = mkTmp('hob-mig-g2b-')
          /**
           * ⚠⚠ **关键夹具设计**：`header.agentPreset` 故意填成 `'Hob'`。
           *
           * ── 为什么必须让它有值 ────────────────────────────────────────────
           *   `header.agentPreset` 是**建档事实**（宿主定义原文："a creation fact …
           *   a session may still change preset while it is blank"）⇒ 它**不能**当运行态真相。
           *   ⚠ 如果这个夹具里 header 是空的，那么"实现偷偷回落 header"这种 bug
           *     **测不出来**（回落到的也是 undefined ⇒ 仍然不写 ⇒ 断言假绿）。
           *   实测就是这样漏掉的：第一次跑负向对拍时，改坏成"回落 header"仍然全绿。
           *   ⇒ 现在把 header 填上 `'Hob'`：只有**真按投影判**的实现才会跳过它；
           *     一旦有人回落 header，它就会被误迁移 ⇒ 本条立刻红。
           */
          const records = [
            { header: { id: 'old-G2b', createdAt: 1000, cwd: sb, agentPreset: 'Hob' } },
          ]
          // ⚠ presets 里**不给** old-G2b ⇒ 投影服务在、但取不到这条
          const host = makeHost({ records, presets: {}, mode: 'multi', ledgerHome: sb })
          svcMod.installSessionPolicy(host.ctx)
          const svc = host.provided[svcMod.SESSION_POLICY_SERVICE]
          await settle(svc)
          const file = svc.fileOf({ header: { cwd: sb } })
          const store = (() => { try { return impl.readPolicyStore(file, OPTS).file.sessions } catch { return {} } })()
          const read = svc.of({ id: 'old-G2b', header: { id: 'old-G2b', createdAt: 1000, cwd: sb } })
          if (store['old-G2b'] !== undefined) {
            bad('SP-11g2b 投影**取不到**该会话（但 header 写着 Hob），却仍写了策略记录'
              + ' ⇒ 那是**回落 `header.agentPreset` 猜出来的**迁移（明令禁止：建档事实≠运行态真相）')
          } else if (read.level !== 'ledger') {
            bad(`SP-11g2b 该会话读档 = ${read.level}（应 ledger）`)
          } else {
            ok('SP-11g2b ✓ 投影服务在、但**这条**会话的投影取不到 ⇒ **不迁、不写**，'
              + '读数仍 ledger（⛔ 不凭 header 猜预设）')
          }
        }

        // g-3 坏策略文件 ⇒ 不覆盖、不升档
        {
          const sb = mkTmp('hob-mig-g3-')
          const records = [{ header: { id: 'old-G3', createdAt: 1000, cwd: sb } }]
          const host = makeHost({ records, presets: { 'old-G3': 'Hob' }, mode: 'multi', ledgerHome: sb })
          svcMod.installSessionPolicy(host.ctx)
          const svc = host.provided[svcMod.SESSION_POLICY_SERVICE]
          // ⚠ 先让服务把文件路径算出来，再把文件写坏（⚠ 目录可能还不存在 ⇒ 先建）
          const file = svc.fileOf({ header: { cwd: sb } })
          mkdirSync(dirname(file), { recursive: true })
          writeFileSync(file, '{ broken json', 'utf8')
          const rep = await svc.migrateNow()
          const read = svc.of({ id: 'old-G3', header: { id: 'old-G3', createdAt: 1000, cwd: sb } })
          if (rep.ok !== false) {
            bad('SP-11g3 策略文件是坏的，迁移却报成功')
          } else if (read.level !== 'ledger' || read.canReadWorkspace !== false) {
            bad(`SP-11g3 坏文件下读数 = ${read.level}/canRead=${read.canReadWorkspace}（应 ledger/false）`
              + ' ⇒ 坏文件竟然给了可读工作区的档')
          } else {
            ok('SP-11g3 ✓ 策略文件坏 ⇒ 迁移拒写（不覆盖坏文件）、读数仍 `ledger` 且不读工作区'
              + '（`source=' + read.source + '`）')
          }
        }
      }

      // ── 11h 幂等：第二次迁移不覆盖已固化的工作方式 ───────────────────────
      {
        const sb = mkTmp('hob-mig-h-')
        const records = [{ header: { id: 'old-H1', createdAt: 1000, cwd: sb } }]
        const mutable = { mode: 'multi' }
        const host = makeHost({ records, presets: { 'old-H1': 'Hob' }, ledgerHome: sb })
        const origGet = host.ctx.get
        host.ctx.get = (k) => (k === 'hobWorkMode' ? () => mutable.mode : origGet(k))
        svcMod.installSessionPolicy(host.ctx)
        const svc = host.provided[svcMod.SESSION_POLICY_SERVICE]
        await settle(svc)
        // ⚠ 改全局再跑一次迁移（模拟"重启后又跑一遍"）
        mutable.mode = 'single'
        const rep2 = await svc.migrateNow()
        const file = svc.fileOf({ header: { cwd: sb } })
        const rec = impl.readPolicyStore(file, OPTS).file.sessions['old-H1']
        if (rec === undefined) {
          bad('SP-11h 第二次迁移后记录消失了')
        } else if (rec.workMode !== 'multi') {
          bad(`SP-11h 第二次迁移**覆盖**了已固化的工作方式（multi → ${rec.workMode}）`
            + ' ⇒ 幂等失效，重启就会改写历史')
        } else if (rep2.migrated.includes('old-H1')) {
          bad('SP-11h 第二次迁移把 old-H1 又算作"新迁移"（应走 skipped）')
        } else {
          ok('SP-11h ✓ 幂等：第二次迁移（且旧全局已改成 single）**不覆盖**，'
            + '工作方式仍是 multi，old-H1 进 `skipped`')
        }
      }

      // ── 11i 旧会话**最高读档不得悄然保留** ───────────────────────────────
      {
        const sb = mkTmp('hob-mig-i-')
        const records = [{ header: { id: 'old-I1', createdAt: 1000, cwd: sb } }]
        const host = makeHost({ records, presets: { 'old-I1': 'Hob' }, mode: 'multi', ledgerHome: sb })
        svcMod.installSessionPolicy(host.ctx)
        const svc = host.provided[svcMod.SESSION_POLICY_SERVICE]
        await settle(svc)
        const read = svc.of({ id: 'old-I1', header: { id: 'old-I1', createdAt: 1000, cwd: sb } })
        if (read.level !== 'ledger') {
          bad(`SP-11i 旧会话读档 = ${read.level}（应被收紧到最低档 ledger）⇒ 旧宽档被悄然保留`)
        } else if (read.canReadWorkspace !== false) {
          bad('SP-11i 旧会话仍可读工作区（canReadWorkspace=true）⇒ 收紧没生效')
        } else {
          ok('SP-11i ✓ 旧会话读档被**收紧到最低**（ledger / canReadWorkspace=false）'
            + ' ⇒ 旧宽档没有悄然保留')
        }
      }
    }
    else {
      /**
       * ⚠ **这一组没跑 ⇒ 如实记"跳过"**（2026-10-24 · B 席）：
       *   改前这里**没有 else** ⇒ 源件载入了但缺入口时，整组断言**一声不响地不跑**，
       *   而收尾行写死"跳过 0 处" ⇒ "没核"与"都核了"在汇总层变成同一个数。
       *   ⚠ 只在源件**载入成功**、但缺入口时记跳过（载入失败那条路已由上面的 bad() 报过，
       *     再记一次会让同一个原因在"失败"和"跳过"里各占一处 ⇒ 重复计数）。
       */
      if (svcMod !== undefined) noteSkip('SP-11 跳过：模块载入了但没有 installSessionPolicy ⇒ 迁移那一组未核')
    }
  }

  // ── SP-12 ⭐⭐ 启动竞态：悬而未决的首次 of 不得改变旧 multi ────────────────
  {
    /**
     * ══ 它守的是什么（2026-10-22 第 4 轮 · 本轮的核心断言）══════════════════
     *   上一版的真竞态：`ensureLegacyMigrationOnce()` 同步设好 running，
     *   然后 `void async` 枚举；`resolveFor` **紧接着**同步调 `resolveSessionPolicy`
     *   ⇒ 旧会话拿到 `defaultMode`（`auto`）⇒ 第一次 prompt 就按 `auto` 派活。
     *
     *   ⚠ 本组必须**与真实调用路径同形**：
     *     枚举 promise **悬而不决**（永不 resolve，直到我们放行），
     *     然后在那个窗口里真的调一次 `of()` / `get()` —— 这才是用户会遇到的那一瞬。
     *     ⚠ 而不是"等迁移跑完再看结果"（那证明不了窗口期的行为）。
     *
     * ── 夹具要点 ────────────────────────────────────────────────────────
     *   · `listSessions()` 返回一个**受控 promise**（`gate`）：未放行前一直 pending；
     *   · 旧全局工作方式 = `multi`（旧会话原来自定义 single/multi 的典型值）；
     *   · 会话 `old-R1` 投影确证 Hob、`createdAt` 早于纪元 ⇒ 是"该迁的旧会话"。
     */
    const SVC_PATH = 'src/session-policy-service.ts'
    const svcMod2 = (() => {
      try { return seenSvcMod } catch { return undefined }
    })() || (() => {
      try { return undefined } catch { return undefined }
    })()
    /**
     * ⚠ 复用上面 SP-11 已经载入过的模块与假宿主构造函数（⛔ 不复制一份逻辑）。
     *   为此下面直接重建最小夹具（SP-11 的作用域已结束）。
     */
    let mod2
    try {
      mod2 = await import(pathToFileURL(join(srcRoot, SVC_PATH)).href)
    } catch (e) {
      bad(`SP-12 无法直载 ${SVC_PATH}（${String(e?.message ?? e)}）⇒ 基准缺失`)
    }

    if (mod2 !== undefined && typeof mod2.installSessionPolicy === 'function') {
      /**
       * 造宿主。⚠ 与 SP-11 的 `makeHost` 同形，但 `listSessions` 由 `gate` 控制
       * —— 这是本组唯一特殊之处，也是它能测到"窗口期"的原因。
       */
      const makeGatedHost = (o) => {
        const provided = {}
        const logs = { info: [], warn: [] }
        let releaseList
        const listGate = new Promise((res) => { releaseList = res })
        const ctx = {
          logger: {
            debug() {}, error() {},
            info: (m) => logs.info.push(String(m)),
            warn: (m) => logs.warn.push(String(m)),
          },
          get: (k) => {
            if (k === 'hobWorkMode') return () => o.mode ?? 'auto'
            if (k === 'sessionQuery') {
              const q = o.queryAvailable === false ? undefined : {
                listSessions: async () => {
                  if (o.holdList !== false) await listGate
                  if (o.listThrows === true) throw new Error('listSessions 注入失败')
                  return (o.records ?? []).map((r) => ({ header: { ...r.header } }))
                },
                observeSession: async (id) => {
                  const v = (o.presets ?? {})[id]
                  return {
                    source: 'prepared',
                    header: { ...(o.records ?? []).find((r) => r.header?.id === id)?.header },
                    projections: { asOfSeq: 0, values: v === undefined ? {} : { agentPreset: v } },
                    retain() { return this },
                    [Symbol.dispose]() {},
                  }
                },
              }
              return q
            }
            if (k === 'sessionProjections') {
              if (o.projAvailable === false) return undefined
              return {
                stateOf: (session, key) => {
                  if (key !== 'agentPreset') return undefined
                  const id = (() => { try { return String(session?.id ?? '') } catch { return '' } })()
                  return (o.presets ?? {})[id]
                },
                snapshot: () => ({ asOfSeq: 0, values: {} }),
              }
            }
            if (k === 'sessions') {
              return { get: () => undefined, list: () => [], prepare: () => undefined }
            }
            /**
             * ⚠ 同 `makeHost`（2026-10-22 第 13 轮）：策略服务要读 `archivedSessionIds`
             *   判归档三态。夹具不给 ⇒ `unknown` ⇒ 这些"窗口期/迁移"用例会被归档判定
             *   抢先压到最低档，测不到它们本来要测的东西。
             *   ⇒ 默认"可信读到、无任何归档"（= `not-archived`）。
             */
            if (k === 'workspaceRegistry') {
              if (o.noWorkspaceRegistry === true) return undefined
              const ids = o.archivedSessionIds
              if (ids !== undefined && !Array.isArray(ids)) {
                return { get archivedSessionIds() { return ids } }
              }
              return { get archivedSessionIds() { return ids ?? [] } }
            }
            if (k === 'loader') return { entries: () => [{ options: { ledgerHome: o.ledgerHome ?? '' } }] }
            return undefined
          },
          provide: (k, v) => { provided[k] = v },
          effect: (fn) => { try { fn() } catch {} },
          plugin: () => {},
        }
        return { ctx, provided, logs, releaseList }
      }

      const settle = async (svc, tries = 300) => {
        for (let i = 0; i < tries; i += 1) {
          const st = svc.migrationStatus()
          if (st.state === 'done' || st.state === 'failed') return st
          await new Promise((r) => setTimeout(r, 10))
        }
        return svc.migrationStatus()
      }

      // ── SP-12a ⭐ 悬而未决窗口期：`of()` 不能给 auto 当"可执行最终方式" ──
      {
        const sb = mkTmp('hob-race-a-')
        const host = makeGatedHost({
          records: [{ header: { id: 'old-R1', createdAt: 1000, cwd: sb } }],
          presets: { 'old-R1': 'Hob' },
          mode: 'multi',
          ledgerHome: sb,
          holdList: true,          // ⚠ 枚举**悬而不决**
        })
        mod2.installSessionPolicy(host.ctx)
        const svc = host.provided[mod2.SESSION_POLICY_SERVICE]
        const stBefore = svc.migrationStatus()
        const r1 = svc.of({ id: 'old-R1', header: { id: 'old-R1', createdAt: 1000, cwd: sb } })
        const r1get = svc.get({ id: 'old-R1', header: { id: 'old-R1', createdAt: 1000, cwd: sb } })
        if (stBefore.state !== 'running') {
          bad(`SP-12a 夹具没构造出"窗口期"（迁移状态=${stBefore.state}，应 running）⇒ 本组测不到竞态`)
        } else if (r1.workMode !== 'multi') {
          bad(`SP-12a **悬而未决的首次 \`of()\` 给了 ${r1.workMode}**（应 multi = 旧原值）`
            + `\n      读数：level=${r1.level} · source=${r1.source} · persistence=${r1.persistence}`
            + `\n      ⇒ ⚠ 这就是本轮要消灭的行为变化：迁移没跑完，旧 multi 被当成 auto 去派活`)
        } else if (r1.level !== 'ledger') {
          bad(`SP-12a 窗口期读档 = ${r1.level}（应最低档 ledger）`)
        } else if (r1.persistence !== 'snapshot') {
          bad(`SP-12a 窗口期 persistence = ${r1.persistence}（应 snapshot：尚未落盘要说出来）`)
        } else if (r1.mayProceed !== true) {
          bad('SP-12a 窗口期 mayProceed = false ⇒ 值本来是原值，不该整块停摆（那是过度封锁）')
        } else if (r1get.workMode !== 'multi') {
          bad(`SP-12a 窗口期 \`get()\` 给了 ${r1get.workMode}（应 multi）⇒ of 与 get 不一致`)
        } else {
          ok('SP-12a ⭐ **悬而未决的首次 `of()`/`get()` 返回的是旧原值 `multi`**'
            + `（level=ledger · persistence=snapshot · mayProceed=true）`
            + ' ⇒ 迁移未完成也**不再**先给 auto 去派活')
        }

        // ── SP-12b 放行枚举 ⇒ 持久化 multi；改旧全局后仍 multi ─────────────
        host.releaseList()
        const st = await settle(svc)
        const file = svc.fileOf({ header: { cwd: sb } })
        const rec = (() => {
          try { return impl.readPolicyStore(file, OPTS).file.sessions['old-R1'] } catch { return undefined }
        })()
        if (st.state !== 'done') {
          bad(`SP-12b 放行枚举后迁移未完成（state=${st.state} · ${st.reason || st.detail || '(空)'}）`)
        } else if (rec === undefined) {
          bad('SP-12b 放行枚举后**没有**持久化 old-R1')
        } else if (rec.workMode !== 'multi') {
          bad(`SP-12b 持久化的工作方式 = ${rec.workMode}（应 multi）`)
        } else {
          const rAfter = svc.of({ id: 'old-R1', header: { id: 'old-R1', createdAt: 1000, cwd: sb } })
          if (rAfter.persistence !== 'persisted' || rAfter.source !== 'stored') {
            bad(`SP-12b 持久化后读数 = ${rAfter.source}/${rAfter.persistence}（应 stored/persisted）`)
          } else {
            ok('SP-12b ✓ 枚举放行后**持久化** `multi`（`stored`/`persisted`）'
              + ' ⇒ 窗口期的快照与最终落盘值一致，没有"先说 multi 再变成别的"')
          }
        }
      }

      // ── SP-12c 改旧全局不影响已持久化的旧会话 ───────────────────────────
      {
        const sb = mkTmp('hob-race-c-')
        const mutable = { mode: 'multi' }
        const host = makeGatedHost({
          records: [{ header: { id: 'old-R2', createdAt: 1000, cwd: sb } }],
          presets: { 'old-R2': 'Hob' },
          ledgerHome: sb,
          holdList: false,
        })
        const origGet = host.ctx.get
        host.ctx.get = (k) => (k === 'hobWorkMode' ? () => mutable.mode : origGet(k))
        mod2.installSessionPolicy(host.ctx)
        const svc = host.provided[mod2.SESSION_POLICY_SERVICE]
        await settle(svc)
        const before = svc.of({ id: 'old-R2', header: { id: 'old-R2', createdAt: 1000, cwd: sb } })
        mutable.mode = 'auto'
        const after = svc.of({ id: 'old-R2', header: { id: 'old-R2', createdAt: 1000, cwd: sb } })
        if (before.workMode !== 'multi' || after.workMode !== 'multi') {
          bad(`SP-12c 改旧全局后读数变了：${before.workMode} → ${after.workMode}（应恒为 multi）`)
        } else {
          ok('SP-12c ✓ 迁移后改旧全局（multi → auto）⇒ 旧会话读数**仍 multi**'
            + ' ⇒ 快照是一次性的，配置变更不影响已存好的旧会话')
        }
      }

      // ── SP-12d 依赖先缺后到：必须重试成功（去掉重试应红）───────────────
      {
        const sb = mkTmp('hob-race-d-')
        let queryReady = false
        const host = makeGatedHost({
          records: [{ header: { id: 'old-R3', createdAt: 1000, cwd: sb } }],
          presets: { 'old-R3': 'Hob' },
          mode: 'multi',
          ledgerHome: sb,
          holdList: false,
        })
        /**
         * ⚠ **关键夹具**：安装时 `sessionQuery` 缺席（模拟"别的 fiber 还没提供"），
         *   第一次 `of()` 之后再让它出现 ⇒ 必须**自动重试成功**。
         *   ⚠ 上一版会因 `legacyScanDone=true` 永久放弃 ⇒ 本组红。
         */
        const origGet2 = host.ctx.get
        host.ctx.get = (k) => (k === 'sessionQuery' && queryReady === false ? undefined : origGet2(k))
        mod2.installSessionPolicy(host.ctx)
        const svc = host.provided[mod2.SESSION_POLICY_SERVICE]
        // ⚠ 先触发一次（此时 sessionQuery 缺席 ⇒ 应失败且标可重试）
        const r1 = svc.of({ id: 'old-R3', header: { id: 'old-R3', createdAt: 1000, cwd: sb } })
        await new Promise((r) => setTimeout(r, 60))
        const stMissing = svc.migrationStatus()
        // ⚠ 窗口期值仍必须是原值（不是 auto）
        const windowOk = r1.workMode === 'multi' && r1.mayProceed === true
        // 现在让依赖出现，再读一次 ⇒ 应触发重试并成功
        queryReady = true
        svc.of({ id: 'old-R3', header: { id: 'old-R3', createdAt: 1000, cwd: sb } })
        const stRetry = await settle(svc)
        const file = svc.fileOf({ header: { cwd: sb } })
        const rec = (() => {
          try { return impl.readPolicyStore(file, OPTS).file.sessions['old-R3'] } catch { return undefined }
        })()
        if (stMissing.ok !== false) {
          bad('SP-12d 依赖缺席时迁移竟报成功 ⇒ 夹具没构造出失败态')
        } else if (!windowOk) {
          bad(`SP-12d 依赖缺席窗口期给了 ${r1.workMode}（应仍 multi 原值）`)
        } else if (stRetry.state !== 'done') {
          bad(`SP-12d 依赖晚到后**没有重试成功**（state=${stRetry.state} · `
            + `${stRetry.reason || stRetry.detail || '(空)'}）`
            + '\n      ⇒ ⚠ 这正是"一失败就永久关掉重试"的形态：旧会话工作方式永久停在未保全')
        } else if (rec === undefined || rec.workMode !== 'multi') {
          bad(`SP-12d 重试后持久化 = ${rec === undefined ? '(无记录)' : rec.workMode}（应 multi）`
            + ' ⇒ 重试没把原值写进去')
        } else {
          ok('SP-12d ✓ 安装时 `sessionQuery` 缺席 ⇒ 失败但**可重试**；依赖出现后'
            + '**自动重试成功**并持久化 `multi`（窗口期给的也一直是 multi 原值）'
            + ` · 尝试次数=${svc.migrationStatus().state === 'done' ? '≤' + 5 : '?'}`)
        }
      }

      // ── SP-12e 两工作区不串（竞态版复验）────────────────────────────────
      {
        const sbA = mkTmp('hob-race-wsA-')
        const sbB = mkTmp('hob-race-wsB-')
        const host = makeGatedHost({
          records: [
            { header: { id: 'old-RA', createdAt: 1000, cwd: sbA } },
            { header: { id: 'old-RB', createdAt: 1001, cwd: sbB } },
          ],
          presets: { 'old-RA': 'Hob', 'old-RB': 'Hob' },
          mode: 'single',
          ledgerHome: sbA,
          holdList: false,
        })
        mod2.installSessionPolicy(host.ctx)
        const svc = host.provided[mod2.SESSION_POLICY_SERVICE]
        await settle(svc)
        const fileA = svc.fileOf({ header: { cwd: sbA } })
        const fileB = svc.fileOf({ header: { cwd: sbB } })
        if (fileA === fileB) {
          bad('SP-12e 夹具两工作区解析到同一文件 ⇒ 测不到"不串"（不按通过处理）')
        } else {
          const storeA = impl.readPolicyStore(fileA, OPTS).file.sessions
          const storeB = impl.readPolicyStore(fileB, OPTS).file.sessions
          if (storeA['old-RB'] !== undefined || storeB['old-RA'] !== undefined) {
            bad('SP-12e 两工作区**串写**了（A/B 的文件里出现了对方的会话）')
          } else if (!storeA['old-RA'] || !storeB['old-RB']) {
            bad(`SP-12e 有工作区没写进去（A 有 old-RA=${storeA['old-RA'] !== undefined} · `
              + `B 有 old-RB=${storeB['old-RB'] !== undefined}）`)
          } else if (storeA['old-RA'].workMode !== 'single' || storeB['old-RB'].workMode !== 'single') {
            bad('SP-12e 写下的工作方式不是快照值 single')
          } else {
            ok('SP-12e ✓ 竞态版复验：两工作区**各写各的**、都固化 `single`、互不串写')
          }
        }
      }

      // ── SP-12f 无快照 ⇒ 安全停下（不拿 auto 顶替）───────────────────────
      {
        const sb = mkTmp('hob-race-f-')
        const host = makeGatedHost({
          records: [{ header: { id: 'old-R4', createdAt: 1000, cwd: sb } }],
          presets: { 'old-R4': 'Hob' },
          ledgerHome: sb,
          holdList: true,
        })
        /**
         * ⚠ 让 `hobWorkMode` **返回非法值** ⇒ 快照抓不到（等价于"安装时读不到旧全局值"）。
         *   此时旧会话**必须**安全停下（`mayProceed=false`），⛔ 不许给 `auto` 让它推进。
         */
        const origGet3 = host.ctx.get
        host.ctx.get = (k) => (k === 'hobWorkMode' ? () => 'not-a-mode' : origGet3(k))
        mod2.installSessionPolicy(host.ctx)
        const svc = host.provided[mod2.SESSION_POLICY_SERVICE]
        const r = svc.of({ id: 'old-R4', header: { id: 'old-R4', createdAt: 1000, cwd: sb } })
        if (r.mayProceed !== false) {
          bad(`SP-12f 抓不到快照时 mayProceed=${r.mayProceed}（应 false）· workMode=${r.workMode}`
            + ' ⇒ 会拿 auto 让旧会话继续推进，正是要消灭的行为变化')
        } else if (r.level !== 'ledger') {
          bad(`SP-12f 抓不到快照时读档 = ${r.level}（应仍最低 ledger）`)
        } else if (r.source !== 'unknown-legacy') {
          bad(`SP-12f source = ${r.source}（应 unknown-legacy，让"说不清"可见）`)
        } else {
          ok('SP-12f ✓ 抓不到切换快照 ⇒ **安全停下**（`mayProceed=false` · `unknown-legacy`），'
            + '读档仍最低 ⇒ ⛔ 不拿 auto 顶替、⛔ 不假装"已保全"')
        }
      }
    }
    else {
      /**
       * ⚠ **这一组没跑 ⇒ 如实记"跳过"**（2026-10-24 · B 席）：
       *   改前这里**没有 else** ⇒ 源件载入了但缺入口时，整组断言**一声不响地不跑**，
       *   而收尾行写死"跳过 0 处" ⇒ "没核"与"都核了"在汇总层变成同一个数。
       *   ⚠ 只在源件**载入成功**、但缺入口时记跳过（载入失败那条路已由上面的 bad() 报过，
       *     再记一次会让同一个原因在"失败"和"跳过"里各占一处 ⇒ 重复计数）。
       */
      if (mod2 !== undefined) noteSkip('SP-12 跳过：模块载入了但没有 installSessionPolicy ⇒ 启动竞态那一组未核')
    }
  }

  // ── SP-14 ⭐ 隔离标记**单调**：普通写入不得抹掉 `quarantined`（2026-10-23 · P0-2）──
  {
    /**
     * ══ 它守的是什么 ═══════════════════════════════════════════════════════
     *   `quarantined: true` 是"这条会话已作废"的**持久安全事实**：
     *   解析期无条件回最低档 + 不推进（见 `resolveSessionPolicy` 的
     *   `archived → quarantined → pending → stored` 顺序）。
     *
     *   ── 改前的真缺陷（2026-10-23 复现）──────────────────────────────────
     *   `setSessionPolicy` 用 `{...sessions, [sessionId]: {全新记录}}` **整条替换**，
     *   新记录里没有 `quarantined` ⇒ 对一个**已被隔离**的会话再打一次普通写，
     *   标记就**静默消失**，而函数仍返回 `ok:true`
     *   ⇒ 作废可以被一次普通写入**无声撤销**（安全网被拆，却没有任何报错）。
     *
     *   ── 判据（这条**必须能红**）────────────────────────────────────────
     *   ① 隔离后读得出 `quarantined`（前置：确保对拍打的是已隔离的记录）；
     *   ② 再打一次**普通写入** ⇒ **必须 `ok:false`**（⛔ 不是"可以成功"）；
     *   ③ 盘上记录**仍带 `quarantined:true`**（⛔ 只看返回值不够：要核盘）；
     *   ④ 复解析**仍是** `source='quarantined'` 且 `mayProceed=false`、读档仍最低。
     *   ⚠ 只断言 ② 会漏掉"返回失败但已经写坏了"的形态，所以 ③④ 必须同时核。
     *   ⚠ 本组**不改工作区**：全部落在 `mkTmp` 的临时目录里。
     */
    const need13 = ['quarantineSessionPolicy', 'activateSessionPolicy']
    const missing13 = need13.filter((n) => typeof impl[n] !== 'function')
    if (missing13.length > 0) {
      bad(`SP-14 实现缺少入口：${missing13.join(', ')} ⇒ 隔离标记的单调性无从检查`)
    } else {
      const sandbox13 = mkTmp('hob-sp13-')
      const file13 = join(sandbox13, 'runtime', 'session-policy.json')
      const sid13 = 'sess-13'
      const res = (id) => impl.resolveSessionPolicy({
        ...OPTS, file: file13, sessionId: id, isHob: true, archived: 'not-archived',
        createdAt: 2000, now: 4000,
      })
      // 先建一条正常的宽档记录（否则"隔离"没有可作废的对象）
      const w0 = impl.setSessionPolicy(file13, { sessionId: sid13, level: 'workspace', workMode: 'multi', now: 1000 }, OPTS)
      const q = w0.ok ? impl.quarantineSessionPolicy(file13, { sessionId: sid13, now: 2000 }, OPTS) : { ok: false, reason: '前置写入失败' }
      const afterQ = res(sid13)
      if (!w0.ok) {
        bad(`SP-14 前置写入失败：${w0.reason}`)
      } else if (!q.ok) {
        bad(`SP-14 前置隔离失败：${q.reason}`)
      } else if (afterQ.source !== 'quarantined' || afterQ.mayProceed !== false) {
        bad(`SP-14 前置不成立：隔离后解析=${afterQ.source}/mayProceed=${afterQ.mayProceed}`
          + '（应 quarantined/false）⇒ 本组没打到真缺陷面上')
      } else {
        ok('SP-14a 前置：隔离后解析 = quarantined · mayProceed=false · 读档最低')
        // ② 普通写入必须被拒
        const w1 = impl.setSessionPolicy(file13, { sessionId: sid13, level: 'workspace', workMode: 'multi', now: 3000 }, OPTS)
        // ③ 盘上必须仍带标记
        const onDisk = JSON.parse(readFileSync(file13, 'utf8'))
        const stillQ = onDisk?.sessions?.[sid13]?.quarantined === true
        // ④ 复解析必须仍是隔离态
        const afterW = res(sid13)
        const cond = w1.ok === false && stillQ && afterW.source === 'quarantined' && afterW.mayProceed === false
        if (cond) {
          ok('SP-14b ✓ 隔离后普通写入**被拒**（ok=false）· 盘上仍带 `quarantined:true` · '
            + '复解析仍 quarantined/mayProceed=false ⇒ 作废标记**单调**，⛔ 不会被普通写抹掉')
        } else {
          bad('SP-14b 隔离标记可被普通写入撤销：'
            + `setPolicy.ok=${w1.ok} · 盘上仍带标记=${stillQ} · 复解析=${afterW.source}/${afterW.mayProceed}`
            + '（期望 ok=false · true · quarantined/false）'
            + (w1.ok === false ? '' : ` · 写入竟然成功：${String(w1.reason ?? '')}`))
        }
      }
    }
  }

  // ── 收尾：清临时件（逐目录 rmSync，⚠ 全在 tmpdir 下）──────────────────
  let cleanErr = ''
  for (const d of created) {
    try { rmSync(d, { recursive: true, force: true }) } catch (e) { cleanErr += String(e?.message ?? e) }
  }
  const leftover = created.filter((d) => {
    try { readFileSync(join(d, '.'), 'utf8'); return true } catch { return false }
  })

  console.log('')
  if (cleanErr !== '') console.log(`  ⚠ 临时目录清理报错（不影响判定，但如实打印）：${cleanErr}`)
  console.log(`  ⚠ 临时件：创建 ${created.length} 个目录，已逐个 rmSync；残留探测 = ${leftover.length}`)
  console.log('')
  /**
   * ⚠⚠ **跳过数必须是真的**（2026-10-24 · B 席）：来自 `skip` 收集器，⛔ 不再写字面量。
   *   ⚠ 同时印 `处级口径` 行 —— `check:all` 的 `parseAssertionCount()` / `parseSkipCount()`
   *   读的就是它；不印的话本族在汇总里永远是"结构上没能报口径"的那几族之一，
   *   而它明明有 44 处断言。
   *   ⚠ `查了 = 过了 + 没过 + 跳过`（`check:all` 会逐族核这条等式）。
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

/**
 * ⚠⚠ **无条件清理**（2026-10-22 第 3 轮修的一个真泄漏）。
 *
 * ── 实测怎么发现的 ──────────────────────────────────────────────────
 *   本轮我改出一条 ENOENT（测试里往一个还不存在的目录写文件），检查器**崩在 main() 里**
 *   ⇒ 走下面这个 `.catch` ⇒ **绕过**了 `main()` 末尾那段 `for (const d of created) rmSync`。
 *   结果：`/tmp` 里留下 **15 个** `hob-sp-*` / `hob-mig-*` 目录（我逐件删掉了）。
 *   ⚠ 那正是本仓反复强调的形态：**"清理写在 happy path 上"= 崩溃时就漏**。
 *   ⇒ 现在把清理做成**两条路都走**：`main()` 正常结束会清；
 *     崩溃/异常也从这里再清一次（`rmSync(force:true)` 幂等，重复清无副作用）。
 */
function cleanupAll(reason) {
  const errs = []
  for (const d of created) {
    try { rmSync(d, { recursive: true, force: true }) } catch (e) { errs.push(String(e?.message ?? e)) }
  }
  if (reason !== undefined) console.error(`  ⚠ 崩溃路径已清临时件（${created.length} 个）：${reason}`)
  return errs
}

main().catch((e) => {
  console.error(`✗ check:session-policy 自身异常：${String(e?.stack ?? e)}`)
  cleanupAll('main 抛错')
  console.error('      ⇒ 检查器崩溃**不按通过处理**（exit 3，与 exit 1「有失败」区分）')
  process.exit(3)
})
