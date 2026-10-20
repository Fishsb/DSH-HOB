#!/usr/bin/env node
/**
 * `check:profile` —— **宿主 profile 到底装没装本插件**（装配面判据）。
 *
 * ── 它解决什么（缺口有实测出处，2026-10-20）──────────────────────────────────
 *   ⚠ 实测事故：`~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 在 **06:24:24**
 *   那次写盘里丢了 `dsh-hob`（而 `dependencies` 里 `link:/home/lk/FF/dsh-hob` **仍在**）
 *   ⇒ 宿主起来了、网页开着、`curl 3080` 通，**而插件压根没装配**。
 *   ⇒ 表现：会话里 `hob_*` 全是 `unknown tool`；`dsh --profile web --dump-config`
 *     报 `patch: entry "dsh-hob" not found`。
 *
 *   ⚠ ⚠ **为什么原有判据一条都没红**：
 *     · `check:build` 面 ①② 判的是**盘上产物**（`lib/` 与 `src/`）—— 全绿；
 *     · 面 ③ 判的是"**跑着本 checkout 的**宿主进程"—— 没装配的进程**不在候选里**
 *       ⇒ 它落"判不出"（那是对的：⚠ 判不出**不等于**没出问题）。
 *   ⇒ **没有任何一条判据问过那句最直接的话：这个 profile 声明装本插件了吗？**
 *
 * ── 判据（四条，缺一条就等于漏一半）──────────────────────────────────────
 *   `A` **声明面**：被检查的 profile 的 `dsh.profile.bundles` 里**必须有**本包名。
 *   `B` **依赖面**：同一个 `package.json` 的 `dependencies` 里也**必须有**（`link:` 也算）——
 *       ⚠ 实测就是"依赖在、bundles 丢了"这一形态 ⇒ 两条**分开判**，⛔ 不许合成一条
 *       （合成之后"哪一半丢了"就说不出来了）。
 *   `C` **解析面**：从该 profile 的 `package.json` **真的能解析出**本包，且**落在本 checkout 内**
 *       —— ⚠ 防"声明了、但解析到别处的另一份 dsh-hob"。
 *   `D` **可修面**：`--fix` 能把丢掉的 bundles 行**按原位插回**，且**只动那一行**
 *       （⚠ 插入前后做**语义 diff**，除该行外必须逐字相同）。
 *
 * ── 边界（⛔ 不改的东西）────────────────────────────────────────────────────
 *   ⛔ 不碰 `cordis.patch.yml`（那条 `- id: dsh-hob` 只是**覆盖 config**，不是装配）。
 *   ⛔ 不装包、不跑 `pnpm`、不动 `node_modules`（只读解析）。
 *   ⛔ 不改别的插件的声明（`--fix` 只补**本包**这一行）。
 *
 * ── 退出码（三档，与各族同口径）────────────────────────────────────────────
 *   `0` = 四条都成立 · `1` = 有判据不成立（**真红**，附可读修法）· `2` = **未执行**
 *   （找不到任何 profile / 读不了 ⇒ ⚠ **不代表通过**）。
 *
 * ── 用法 ─────────────────────────────────────────────────────────────────
 *   `npm run check:profile`              只判（默认 profile 取 `--profile`，缺省 `web`）
 *   `npm run check:profile -- --fix`     判 + **自动补回**丢失的 bundles 行（⚠ 会写盘，先备份）
 *   `npm run check:profile -- --all`     检查 `$DSH_HOME/profiles/*` 下**所有** profile
 */
import { copyFileSync, existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
/** 本包名（⚠ 从自己的 `package.json` 读，⛔ 不写死字面量 —— 改名时不会漂）。 */
const SELF_NAME = (() => {
  try { return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name } catch { return null }
})()

const ARGV = process.argv.slice(2)
/**
 * ⚠⚠ **目标 profile**（= 退出码由谁说了算）。
 *
 * ── 为什么必须分"目标"与"顺带看的"（2026-10-20 实测）──────────────────
 *   `--all` 扫出来的 `headless` / `system` 是本机另外两个 profile，它们**本来就不装本插件**
 *   （一个是"答一个任务就退"的形态、一个是系统侧）⇒ 若把它们的"没装"也算红，
 *   这条判据就会**永远红**，而"恒红的判据等于没有判据"（本仓明令）。
 *   ⇒ 退出码**只由目标 profile 决定**；其余 profile **照实打印**，但标 `不计入退出码`。
 *   ⚠ ⛔ 这不是"放宽"：目标 profile（缺省 `web`）一掉行，本判据立刻红。
 */
const FIX = ARGV.includes('--fix')
const ALL = ARGV.includes('--all')
const pi = ARGV.indexOf('--profile')
const NAMED = pi >= 0 && typeof ARGV[pi + 1] === 'string' && !ARGV[pi + 1].startsWith('-')
  ? ARGV[pi + 1]
  : null
/** ⚠⚠ **目标 profile**：退出码**只由它**决定（见下方 `bad()` 的注释；缺省 `web`）。 */
const TARGET = NAMED ?? 'web'

function dshHome() {
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env !== '') return env
  return join(process.env.HOME ?? '', '.dsh')
}

/**
 * profile 清单（⚠ `--all` 时读目录；否则只取被点名的那一个）。
 * ⚠ 判"缺省 profile"用 `web`（与 `dsh web` 同义，见 `check-build-sync.mjs` 的 `profileOfCmdline`）。
 */
function profilesToCheck() {
  if (!ALL) return [NAMED ?? 'web']
  const dir = join(dshHome(), 'profiles')
  try {
    return readdirSync(dir)
      .filter((n) => { try { return statSync(join(dir, n)).isDirectory() } catch { return false } })
      .filter((n) => existsSync(join(dir, n, 'package.json')))
      .sort()
  } catch { return [] }
}

let okCount = 0
let badCount = 0
/** ⚠ 当前正在检查哪个 profile（`bad()` 据此判"算不算红"）。 */
let CURRENT = TARGET
const bad = (line, why) => {
  const counts = CURRENT === TARGET
  if (counts) badCount++
  console.log(`  ✗ ${line}`)
  if (why !== undefined) console.log(`      ⇒ ${why}`)
  if (!counts) console.log(`      ⚠ 这个 profile **不是目标**（目标 = ${TARGET}）⇒ ⛔ 不计入退出码`)
}
const ok = (line) => {
  okCount++
  console.log(`  ✓ ${line}`)
}

/** 解析出本包的真身（⚠ 抛错由调用方落判不出）。 */
function resolveSelf(manifestPath) {
  const req = createRequire(manifestPath)
  return realpathSync(req.resolve(SELF_NAME))
}

/** 语义 diff：两份 JSON 除「bundles 多/少本包名」之外必须逐字相同。 */
function onlyBundleLineChanged(before, after, name) {
  const strip = (o) => {
    const c = JSON.parse(JSON.stringify(o))
    const b = c?.dsh?.profile?.bundles
    if (Array.isArray(b)) c.dsh.profile.bundles = b.filter((x) => String(x) !== name)
    return JSON.stringify(c)
  }
  return strip(before) === strip(after)
}

console.log('profile 装配面自检 · ' + (SELF_NAME ?? '(读不到包名)'))
console.log('')

if (SELF_NAME === null || SELF_NAME === '') {
  console.log('判定：**未执行** —— 读不到本仓 `package.json` 的 `name` ⇒ 无法问"装没装"。')
  process.exit(2)
}

const names = profilesToCheck()
if (names.length === 0) {
  console.log('判定：**未执行** —— 一个 profile 都没找到（`$DSH_HOME/profiles/` 下无清单）'
    + '⇒ ⚠ 这不代表"装对了"，只代表**没东西可查**。')
  process.exit(2)
}

for (const profile of names) {
  CURRENT = profile
  const dir = join(dshHome(), 'profiles', profile)
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) {
    bad(`profile "${profile}"：清单不存在（${manifestPath}）`,
      '这不是"没装"—— 是**查的对象不存在**；`--all` 时属于正常（空目录），点名时请确认 profile 名')
    continue
  }
  let raw
  try { raw = readFileSync(manifestPath, 'utf8') } catch (e) {
    bad(`profile "${profile}"：清单读不了（${String(e?.message ?? e)}）`, '读不到 ⇒ 判不出，⛔ 不当作通过')
    continue
  }
  let manifest
  try { manifest = JSON.parse(raw) } catch (e) {
    bad(`profile "${profile}"：清单不是合法 JSON（${String(e?.message ?? e)}）`, '解析不了 ⇒ 判不出')
    continue
  }
  const bundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : null
  const deps = manifest?.dependencies !== null && typeof manifest?.dependencies === 'object'
    ? manifest.dependencies
    : {}

  // ── A 声明面 ───────────────────────────────────────────────────────────
  const declared = bundles !== null && bundles.some((b) => String(b) === SELF_NAME)
  if (declared) {
    ok(`A · profile "${profile}"：\`dsh.profile.bundles\` **声明**了 ${SELF_NAME}`
      + `（共 ${bundles.length} 项）`)
  } else {
    bad(`A · profile "${profile}"：\`dsh.profile.bundles\` **没有** ${SELF_NAME}`
      + `（共 ${bundles === null ? '读不到' : bundles.length} 项）⇒ **插件不会被装配**`,
      '⚠ 这就是 2026-10-20 那次事故的形态：宿主起来了、网页也开着，而 `hob_*` 全是 `unknown tool`。'
      + ' ⚠ `cordis.patch.yml` 里那条 `- id: dsh-hob` **只覆盖 config**，⛔ 挡不住这件事。')
  }

  // ── B 依赖面（⚠ 与 A 分开判：实测就是"依赖在、bundles 掉了"）──────────────
  const hasDep = Object.prototype.hasOwnProperty.call(deps, SELF_NAME)
  if (hasDep) {
    ok(`B · profile "${profile}"：\`dependencies\` 里有 ${SELF_NAME} = \`${String(deps[SELF_NAME])}\``)
  } else {
    bad(`B · profile "${profile}"：\`dependencies\` 里**没有** ${SELF_NAME}`,
      '没有依赖 ⇒ 就算补进 bundles，解析也会失败；先 `dsh plugin --profile ' + profile + ' add ' + root + '`')
  }

  // ── C 解析面（⚠ 只在 A/B 都过时才有意义；否则跳过并说明）──────────────────
  if (declared && hasDep) {
    try {
      const resolved = resolveSelf(manifestPath)
      const inside = resolved === root || resolved.startsWith(root + '/')
      if (inside) {
        ok(`C · profile "${profile}"：解析到 \`${resolved}\`（**落在本 checkout 内**）`)
      } else {
        bad(`C · profile "${profile}"：解析到 **别处**的 ${SELF_NAME}：${resolved}`,
          `它不在本 checkout（${root}）内 ⇒ 装是装了，但跑的是另一份代码`)
      }
    } catch (e) {
      bad(`C · profile "${profile}"：解析 ${SELF_NAME} 失败（${String(e?.message ?? e)}）`,
        '依赖声明了却解析不出来 ⇒ 装配会在启动时失败（⚠ 这次是**响的**，不是静默）')
    }
  } else {
    console.log(`  ⚠ C · profile "${profile}"：跳过了"解析面" —— A/B 有一条不成立 ⇒ 先补那一条`)
  }

  // ── D 可修面（⚠ 只在 `--fix` 且"该补"时动手）──────────────────────────
  if (!declared && FIX && hasDep) {
    /**
     * ⚠⚠ **按原位插回**：位置取自"上一次它还在时"的邻位。
     *   本仓没有历史清单可比 ⇒ 用一条**稳定规则**：插在 `dsh-taskboard` 之后
     *   （⚠ 实测那份"还完好"的备份 `package.json.bak-dsbot-*` 里它就在那儿），
     *   找不到该邻位 ⇒ **追加到末尾**并在输出里说明（⛔ 不猜一个位置）。
     */
    const afterIdx = bundles === null ? -1 : bundles.findIndex((b) => String(b) === 'dsh-taskboard')
    const insertAt = afterIdx >= 0 ? afterIdx + 1 : (bundles === null ? 0 : bundles.length)
    const next = JSON.parse(JSON.stringify(manifest))
    if (!Array.isArray(next?.dsh?.profile?.bundles)) {
      bad(`D · profile "${profile}"：\`dsh.profile.bundles\` 不是数组（${typeof next?.dsh?.profile?.bundles}）`,
        '⛔ 本工具**不替你造数组**（那属于改别人的结构）；请手工修 profile 清单')
      continue
    }
    next.dsh.profile.bundles.splice(insertAt, 0, SELF_NAME)
    /**
     * ⚠ **只动那一行**的证明：除 `bundles` 里本包名之外，前后必须语义相同。
     *   ⛔ 不通过就不写盘（宁可红着，也不写一份"改了别处"的清单）。
     */
    if (!onlyBundleLineChanged(manifest, next, SELF_NAME)) {
      bad(`D · profile "${profile}"：\`--fix\` 的改动**不止那一行** ⇒ **拒绝写盘**`,
        '⚠ 这是防"修一个地方、悄悄改了别处"的闸；请手工核对清单')
      continue
    }
    const backup = `${manifestPath}.bak-bundles-${new Date().toISOString().replace(/[:.]/g, '-')}`
    try {
      copyFileSync(manifestPath, backup)
      /**
       * ⚠ 保留原文件的缩进风格（实测那份是 2 空格；读不出就用 2）。
       *   ⚠ 末尾补换行 —— 与仓内其它清单一致（⛔ 不给编辑器留"没换行"的尾巴）。
       */
      writeFileSync(manifestPath, JSON.stringify(next, null, 2) + '\n', 'utf8')
      ok(`D · profile "${profile}"：**已补回** ${SELF_NAME}（插在第 ${insertAt + 1} 位`
        + `${afterIdx >= 0 ? '，紧跟 `dsh-taskboard`' : '，**追加到末尾**（没找到原位邻接项）'}）`
        + ` · 备份 \`${backup}\` · 语义 diff 只有那一行`)
      console.log('    ⇒ ⚠ **要让它生效必须重启宿主**（`dsh web` 只在启动时读这份清单）。')
    } catch (e) {
      bad(`D · profile "${profile}"：写盘失败（${String(e?.message ?? e)}）`,
        `备份在 \`${backup}\`（若已写出）；清单**未被改动或已损坏**，请手工核对`)
    }
  } else if (!declared && FIX && !hasDep) {
    bad(`D · profile "${profile}"：**没法自动修** —— \`dependencies\` 里也没有 ${SELF_NAME}`,
      '先把它加成依赖（`dsh plugin --profile ' + profile + ' add ' + root + '`），再来补 bundles')
  } else if (!declared && !hasDep) {
    /**
     * ⚠⚠ **这条必须与"有没有加 `--fix`"无关**（2026-10-20 自检 P-3 抓到）：
     *   改前只在 `FIX && !hasDep` 时才说"没法自动修" ⇒ 用户**先跑一遍判据**看到的是
     *   "可以自动修"（下面那条 else-if），可那条修法**根本跑不通**（没有依赖 ⇒ 补进 bundles 也解析不了）。
     *   ⇒ 现在"修不了"这件事**在只判的那一遍就说出来**。
     */
    console.log(`  ⚠ D · profile "${profile}"：**没法自动修** —— \`dependencies\` 里也没有 ${SELF_NAME}`
      + '（⚠ 补进 bundles 也解析不了；先 `dsh plugin --profile ' + profile + ' add ' + root + '`）')
  } else if (!declared) {
    console.log(`  ⚠ D · profile "${profile}"：可以自动修 —— 跑 \`npm run check:profile -- --fix`
      + `${NAMED === null ? '' : ` --profile ${profile}`}\`（⚠ 会写盘，先备份；⚠ 之后**必须重启宿主**）`)
  }
  console.log('')
}

// ══════════════════════════════════════════════════════════════════════
// 自检模（`--self-check`）—— 四条判据各有一条**必须能红**的构造
// ══════════════════════════════════════════════════════════════════════
//
// ⚠ 为什么要自检：这条判据守的是"装配面"，而**真实现场只可能处在一种状态**。
//   光跑一次真实现场，证不了"它掉行时会不会红"—— 见 `E-27`（永远 PASS 的检查比没有更危险）。
// ⚠ 每条都**必须能失败**；⚠ 且**不许**靠退出码判，要看**可读断言行**。
if (ARGV.includes('--self-check')) {
  const { mkdtempSync, mkdirSync, symlinkSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { spawnSync } = await import('node:child_process')
  let scBad = 0
  const say = (pass, line, why) => {
    console.log(`  ${pass ? '✓' : '✗'} ${line}${pass ? '' : `\n      ⇒ ${why}`}`)
    if (!pass) scBad++
  }
  /** 造一个假 profile 目录（⚠ 全部落在系统临时区，⛔ 不碰真 profile）。 */
  const mkProfile = (bundlesHasSelf, depsHasSelf) => {
    const base = mkdtempSync(join(tmpdir(), 'hob-prof-'))
    const dir = join(base, 'profiles', 'web')
    mkdirSync(dir, { recursive: true })
    const bundles = bundlesHasSelf ? ['a', SELF_NAME, 'b'] : ['a', 'b']
    const deps = depsHasSelf ? { [SELF_NAME]: 'link:' + root } : {}
    writeFileSync(join(dir, 'package.json'),
      JSON.stringify({ name: 'x', dependencies: deps, dsh: { profile: { bundles } } }, null, 2) + '\n', 'utf8')
    /**
     * ⚠ 造一条能解析到本 checkout 的 `node_modules`（软链到真仓）—— 只测"解析面"，⛔ 不装包。
     *   ⚠⚠ **父目录必须先建**（2026-10-20 自检 P-1/P-4 抓到：`symlinkSync` 不会替你建中间目录，
     *   于是软链**静默失败**、解析面一律红 —— 那会让自检"看起来在测，其实测的是环境缺件")。
     */
    try {
      mkdirSync(join(dir, 'node_modules'), { recursive: true })
      symlinkSync(root, join(dir, 'node_modules', SELF_NAME), 'dir')
    } catch (e) {
      throw new Error(`自检夹具造不出 node_modules：${String(e?.message ?? e)}`)
    }
    return base
  }
  const run = (home, args) => spawnSync('node', [join(root, 'scripts', 'check-profile-assembly.mjs'), ...args], {
    env: { ...process.env, DSH_HOME: home }, encoding: 'utf8',
  })
  // ① 声明在 ⇒ 绿（且退出码 0）
  {
    const h = mkProfile(true, true)
    const r = run(h, [])
    say(r.status === 0 && r.stdout.includes('声明'),
      'P-1 ✓ 正向：bundles 里有本包 ⇒ **PASS**（退出码 0）',
      `exit=${r.status} · 输出=${r.stdout.slice(0, 200)}`)
  }
  // ② **bundles 掉行 ⇒ 必须红**（这就是 2026-10-20 的事故形态）
  {
    const h = mkProfile(false, true)
    const r = run(h, [])
    say(r.status === 1 && r.stdout.includes('没有') && r.stdout.includes('插件不会被装配'),
      'P-2 ✓ 反向（**钉事故形态**）：bundles 掉行、dependencies 仍在 ⇒ **FAIL**，'
      + '且话说"插件不会被装配"（⛔ 不许静默）',
      `exit=${r.status}（应 1）· 输出=${r.stdout.slice(0, 240)}`)
  }
  // ③ 依赖也没有 ⇒ 必须红，且**不许**说"可以自动修"（⛔ 不许给一条修不了的修法）
  {
    const h = mkProfile(false, false)
    const r = run(h, [])
    const saysNoAutoFix = r.stdout.includes('没法自动修')
    say(r.status === 1 && saysNoAutoFix,
      'P-3 ✓ 反向：bundles 与 dependencies 都缺 ⇒ **FAIL**，且明说"**没法自动修**"'
      + '（⛔ 不给一条修不成的修法）',
      `exit=${r.status}（应 1）· 说"没法自动修"=${saysNoAutoFix}`)
  }
  // ④ `--fix` ⇒ 只补那一行，且修完转绿
  {
    const h = mkProfile(false, true)
    const before = readFileSync(join(h, 'profiles', 'web', 'package.json'), 'utf8')
    const r1 = run(h, ['--fix'])
    const after = readFileSync(join(h, 'profiles', 'web', 'package.json'), 'utf8')
    const r2 = run(h, [])
    const bj = JSON.parse(before); const aj = JSON.parse(after)
    const onlyOne = aj.dsh.profile.bundles.filter((x) => x === SELF_NAME).length === 1
    const sameElse = (() => {
      const strip = (o) => {
        const c = JSON.parse(JSON.stringify(o))
        c.dsh.profile.bundles = c.dsh.profile.bundles.filter((x) => x !== SELF_NAME)
        return JSON.stringify(c)
      }
      return strip(bj) === strip(aj)
    })()
    say(onlyOne && sameElse && r2.status === 0 && r1.stdout.includes('已补回'),
      'P-4 ✓ `--fix` **只补那一行**：补完 bundles 里恰好一份、其余字段逐字未变，'
      + '且再判一次转 **PASS**（⚠ 出问题就拒绝写盘，见 `onlyBundleLineChanged`）',
      `唯一一份=${onlyOne} · 其余未变=${sameElse} · 修后再判 exit=${r2.status}（应 0）`)
  }
  // ⑤ 非目标 profile 不成立 ⇒ **不许**把退出码拖红（⛔ 恒红判据等于没有判据）
  {
    const base = mkdtempSync(join(tmpdir(), 'hob-prof-all-'))
    for (const [n, ok] of [['web', true], ['headless', false]]) {
      const dir = join(base, 'profiles', n)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: 'x', dependencies: { [SELF_NAME]: 'link:' + root },
        dsh: { profile: { bundles: ok ? [SELF_NAME] : ['base'] } },
      }, null, 2) + '\n', 'utf8')
      /**
       * ⚠⚠ **两个 profile 都要能解析**（2026-10-20 自检 P-5 抓到）：
       *   只给 `web` 造 `node_modules` ⇒ `headless` 会因为**解析面**红而红
       *   ⇒ 测到的就不是"非目标掉行不拉红"这一条（那是**假靶子**）。
       */
      mkdirSync(join(dir, 'node_modules'), { recursive: true })
      symlinkSync(root, join(dir, 'node_modules', SELF_NAME), 'dir')
    }
    const r = run(base, ['--all'])
    say(r.status === 0 && r.stdout.includes('不影响'),
      'P-5 ✓ 负向对照：`--all` 里**非目标** profile 没装 ⇒ 退出码**仍 0**，'
      + '且明说"不影响本判定"（⛔ 不许做成恒红）',
      `exit=${r.status}（应 0）· 说了"不影响"=${r.stdout.includes('不影响')}`)
  }
  console.log('')
  if (scBad === 0) {
    console.log('判定：**PASS** —— 装配面判据自检 5 条全过。')
    process.exit(0)
  }
  console.log(`判定：**FAIL**（${scBad} 条）—— 装配面判据自身不成立。`)
  process.exit(1)
}

/**
 * ⚠⚠ **汇总句不许说"全部成立"**（2026-10-20 修）：`--all` 下"非目标 profile 不成立"是常态
 *   ⇒ 那句话会变成**假话**（本项目明令：⛔ 不许把两种事实说成同一句话）。
 *   ⇒ 只报**目标那一侧**的结论，另起一句**照实说**有几个 profile 不成立、为什么不计入。
 */
const skipped = names.filter((n) => n !== TARGET)
if (badCount === 0) {
  console.log(`判定：**PASS** —— 目标 profile "${TARGET}" 的装配面四条全部成立（${okCount} 条）。`)
  if (skipped.length > 0) {
    console.log(`       ⚠ 另扫了 ${skipped.length} 个**非目标** profile（${skipped.join(' / ')}）：`
      + '它们装不装本插件**不影响**本判定 —— ⚠ 逐个的读数见上面（带 ⛔ 不计入退出码 的行）。')
  }
  process.exit(0)
}
console.log(`判定：**FAIL** —— 目标 profile "${TARGET}" 有 ${badCount} 条不成立（${okCount} 条成立）。`
  + ' ⚠ 装配面出问题**不会**让 `check:build` 红（它判的是盘上产物），'
  + '⛔ 所以这条判据不能省。')
process.exit(1)
