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
 * ── ⚠⚠ **计入判定的资格：看 `dependencies`，不看"谁被点名"**（2026-10-20 本单 A 改）───────
 *
 * 改前是"**退出码只由目标 profile（缺省 `web`）决定**"，其余 profile 一律
 * 「⛔ 不计入退出码」。⚠ 那条规则的**理由只对一半**：
 *   · 成立的一半：`headless` / `system` 本来就不装本插件 ⇒ 算红会**恒红**；
 *   · ⚠ **漏掉的一半**：另一个**本来该装**的 profile 掉了行，也被一起放过了
 *     —— 而那正是 2026-10-20 事故的形态（`dependencies` 在、`bundles` 掉了）。
 *
 * ⇒ 现在改用**依赖面**当资格判据：**`dependencies` 里声明了本包 ⇒ 必须装配**；
 *   **没声明依赖的 profile 不参与判定**（照实打印 + 一句"为什么不计入"）。
 * ⚠ 依据：`dependencies` 里有没有本包，正是"**这个 profile 本来该不该装它**"的客观标记
 *   —— 也是那次事故的分界线（依赖在、bundles 掉了）。
 * ⚠ ⛔ 这条**不是放宽**：它把范围从"一个点"扩到"所有声明了依赖的 profile"，
 *   严格说是**加严**；同时它仍不把"本来就不该装"的那些算红（⛔ 恒红判据 = 没用）。
 */
const FIX = ARGV.includes('--fix')
const ALL = ARGV.includes('--all')
const pi = ARGV.indexOf('--profile')
const NAMED = pi >= 0 && typeof ARGV[pi + 1] === 'string' && !ARGV[pi + 1].startsWith('-')
  ? ARGV[pi + 1]
  : null
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
/** 被判定者（= `dependencies` 里声明了本包的 profile）。⚠ 退出码由它们全体决定。 */
const QUALIFIED = []
/** 本 profile **有没有资格计入判定**（= `dependencies` 里声明了本包）。⚠ 由主循环每轮设置。 */
let CURRENT_QUALIFIES = false
/**
 * 记一条不成立。
 * ⚠ **只有"该装却坏了"才算红**（`CURRENT_QUALIFIES`）；没声明依赖的 profile
 *   不参与判定，但也**照实打印**（⛔ 不许静默跳过 —— 那是"没读到"伪装成"没问题"）。
 */
const bad = (line, why) => {
  if (CURRENT_QUALIFIES) badCount++
  console.log(`  ✗ ${line}`)
  if (why !== undefined) console.log(`      ⇒ ${why}`)
  if (!CURRENT_QUALIFIES) {
    console.log('      ⚠ 这个 profile 的 `dependencies` 里**没有**本包 ⇒ **不参与判定**'
      + '（⛔ 不计入退出码；⚠ 也不代表"它装对了"，只代表**本来就不该由它装**）')
  }
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

/**
 * ══ ⚠⚠ **字节级的"只动那一行"**（2026-10-20 本单 B）════════════════════════════
 *
 * ── 改前那道闸为什么不够（`TASK` §0.2 的原话）────────────────────────────
 *   改前：闸是 `onlyBundleLineChanged()`（**语义级**：`JSON.stringify(parse(x))` 比），
 *   写盘却是 `JSON.stringify(next, null, 2) + '\n'`（**重排**）。
 *   ⇒ 只要真清单的缩进 / 转义 / 换行与这个 pretty-print 不同，
 *     ⚠ **闸会放行、而整份文件被重排** —— 真 profile 会漂，而读数说"只动了一行"。
 *   ⚠ 这是本项目最忌讳的那种"读数与事实不符"：**闸与写盘用的不是同一个判据**。
 *
 * ── 现在：**不再重排任何东西**，只做一次**单点文本插入** ─────────────────────
 *   ① 在原文本里定位 `"dsh.profile.bundles"` 那个数组的 `[`；
 *   ② 在锚点项（`dsh-taskboard`）**之后**插入一行；锚点不在 ⇒ 插到数组末尾；
 *   ③ 插入文本**沿用原文的缩进与换行风格**（多行数组插整行，单行数组插内联片段）；
 *   ④ 于是"写出来的文件 = 原文件 + 这一段文本"**是构造出来的事实**，⛔ 不是事后比的。
 *   ⚠ 事后仍**独立再验一次**（`verifyOnlyInsertion`）：删掉插入的那一段后必须**逐字节**等于原文，
 *     且旁证 `JSON.parse` 后语义只多一项 —— ⛔ 不许只拿"构造正确"自证。
 *
 * ── 做不到就**拒绝写盘**（⛔ 不退回重排）────────────────────────────────
 *   数组形状不认识 / 找不到 `bundles` 的 `[` / 锚点处文本有歧义
 *   ⇒ 返回 `{ ok: false, why }`，由调用方落一条可读红话 + 说明差多少。
 */
function planBundleLineInsertion(raw, name, afterName) {
  // ① `bundles` 这个 key 的位置（⛔ 不能用 lastIndexOf 之类"大概"的定位）
  const keyIdx = raw.indexOf('"bundles"')
  if (keyIdx < 0) return { ok: false, why: '原文里找不到 `"bundles"` 这个键' }
  const openIdx = raw.indexOf('[', keyIdx)
  if (openIdx < 0) return { ok: false, why: '`"bundles"` 之后找不到 `[`' }
  /**
   * ⚠ 找数组的 `]`：bundles 的元素都是**普通字符串**（没有嵌套对象），
   *   但仍按"跳过字符串字面量"扫一遍，⛔ 不假设里面没有 `]`。
   */
  let i = openIdx + 1
  let inStr = false
  let closeIdx = -1
  for (; i < raw.length; i++) {
    const ch = raw[i]
    if (inStr) {
      if (ch === '\\') { i++; continue }
      if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') { inStr = true; continue }
    if (ch === ']') { closeIdx = i; break }
  }
  if (closeIdx < 0) return { ok: false, why: '`"bundles"` 的 `[` 之后找不到匹配的 `]`' }
  const inner = raw.slice(openIdx + 1, closeIdx)
  /**
   * ⚠ **多行数组**才有"整行插入"可言；单行数组只能内联插入。
   *   判据 = `[` 与 `]` 之间**有没有换行**（⛔ 不按缩进猜）。
   */
  const multiline = inner.includes('\n')
  /** 缩进：取锚点那一行（或数组内第一行）的行首空白。 */
  const indentOfLine = (pos) => {
    const lineStart = raw.lastIndexOf('\n', pos) + 1
    return /^[ \t]*/.exec(raw.slice(lineStart))[0]
  }
  // ② 锚点：`"<afterName>"` 在数组内的位置
  let insertAt = -1
  let insertText = ''
  let how = ''
  const anchorIdx = afterName === undefined ? -1 : inner.indexOf('"' + afterName + '"')
  if (anchorIdx >= 0) {
    /**
     * ══ ⚠⚠ **这一段的写法为什么推倒重来**（2026-10-20 本单 B 自检当场抓到两次）══════
     *
     * 第一版靠"找**下一个**双引号"定位锚点项的结束引号：
     *   `const afterQuoted = raw.indexOf('"', raw.indexOf('"', abs) + 1)`
     * ⚠ 这在锚点是**末项**时会算错（`abs` 已经在开始引号上，第二个 `indexOf` 落到了
     *   结束引号，再 +1 ⇒ 变成**下一个**字符串的开始引号）⇒ 读出的 `tail` 是名字里的字符
     *   ⇒ 报「锚点之后紧跟的不是 `,` 也不是 `]`（读到 ` `）」。
     *
     * ⇒ 现在改成 **`inner` 内的偏移运算**（⛔ 不再全局找引号）：
     *   `inner` 就是 `bundles` 数组内容，锚点在 `inner` 里的偏移已知，
     *   它后面第一个非空白字符只可能是 `,` 或 `]` —— 这是**由 JSON 语法保证**的。
     */
    /** 锚点在 `inner` 内的结束引号位置（从开始引号往后扫，跳过 `\` 转义）。 */
    /**
     * ⚠ `anchorIdx` 指向**开始引号**；跳过的应是 `"` + name = `afterName.length + 1`。
     *   （第一版多写了 `+1`（照 `+ 1 + len + 1` 的形状抄），落在结束引号**之后**的那个字符上
     *    ⇒ 永远找不到结束引号 ⇒ 报「结束引号找不到」。⚠ 这种"偏移多一"是纯算术错，
     *    自检/字节闸都不该替它兜底 —— 但字节闸**确实**兜住了写盘那一侧，这里只影响"能不能修"。）
     */
    let j = anchorIdx + 1 + afterName.length
    while (j < inner.length) {
      if (inner[j] === '\\') { j += 2; continue }
      if (inner[j] === '"') break
      j++
    }
    if (j >= inner.length) return { ok: false, why: `锚点 \`${afterName}\` 的结束引号找不到` }
    /** 锚点之后第一个非空白字符（⚠ 只可能 `,` 或 `]`；`]` 由外层切掉过 ⇒ 实际只会是 `,`）。 */
    let k = j + 1
    while (k < inner.length && /\s/.test(inner[k])) k++
    const tailCh = inner[k]
    const hasNext = tailCh === ','
    if (tailCh !== undefined && tailCh !== ',' && tailCh !== ']') {
      return { ok: false, why: `锚点 \`${afterName}\` 之后紧跟的不是 \`,\` 也不是 \`]\`（读到 \`${String(tailCh)}\`）` }
    }
    if (multiline) {
      /**
       * ⚠ **统一走一条路**：把新行插在**锚点所在行的下一行行首**。
       *   · 锚点后面有兄弟项（有逗号）⇒ 直接插，逗号已经在了；
       *   · 锚点是**末项**（无逗号）⇒ 那一行是 `"dsh-taskboard"\n`，
       *     新行插在它之后 ⇒ **必须在锚点行末补一个逗号**（否则两项粘连成非法 JSON）。
       *     ⚠ 补逗号的位置（锚点行末）与新行的位置（下一行行首）**相邻**：
       *     中间只隔一个 `\n` ⇒ 可以用"一个连续插入段"精确表达：
       *       插入段 = `,` + `\n` + `<缩进>"name"`  —— 但那样会把原文那个 `\n` 变成两个。
       *     ⇒ 更干净的表达：**插入段 = `,\n<缩进>"name"`，插在锚点行末换行符的前面**。
       *     即：原文 `…"dsh-taskboard"\n]` ⇒ 变成 `…"dsh-taskboard",\n        "dsh-hob"\n]`。
       *     ⚠ 这样"删掉插入段 ⇒ 逐字节还原"仍然成立。
       */
      if (hasNext) {
        /** 有兄弟项：锚点行已经以 `,` 结尾 ⇒ 直接在其下一行行首插新行。 */
        const anchorAbs = openIdx + 1 + anchorIdx
        const nlIdx = raw.indexOf('\n', anchorAbs)
        if (nlIdx < 0) return { ok: false, why: `锚点 \`${afterName}\` 所在行找不到换行` }
        insertAt = nlIdx + 1
        insertText = indentOfLine(anchorAbs) + '"' + name + '",\n'
        how = `紧跟在 \`${afterName}\` 之后（整行插入，沿用原文缩进）`
      } else {
        /**
         * 末项：在**锚点行末的换行符之前**插入 `,` + 换行 + 新行。
         * ⚠ 插完以后，原来那个 `\n` 仍在新行之后 ⇒ 结构正确。
         */
        const anchorAbs = openIdx + 1 + anchorIdx
        const nlIdx = raw.indexOf('\n', anchorAbs)
        if (nlIdx < 0) return { ok: false, why: `锚点 \`${afterName}\` 是末项，但它所在行找不到换行` }
        insertAt = nlIdx
        insertText = ',\n' + indentOfLine(anchorAbs) + '"' + name + '"'
        how = `紧跟在 \`${afterName}\` 之后（它是末项 ⇒ 一并补上分隔逗号）`
      }
    } else {
      /**
       * 单行数组：直接在锚点之后插 `, "name"`（有兄弟项）或 `, "name"`（末项也一样）。
       * ⚠ 末项时同样是"先补逗号再加项"，合起来就是 `, "name"` 一个连续片段。
       */
      const anchorAbs = openIdx + 1 + anchorIdx
      const endQuoteAbs = anchorAbs + afterName.length + 1
      insertAt = endQuoteAbs + 1
      insertText = hasNext ? ' "' + name + '",' : ', "' + name + '"'
      how = `紧跟在 \`${afterName}\` 之后（单行数组 · 内联插入）`
    }
  } else {
    /**
     * 锚点不在 ⇒ **追加到数组末尾**（⛔ 不猜别的位置），并明说。
     *
     * ⚠⚠ **这里踩过一个错，照实记下**（2026-10-20 自检 P-4 当场抓到）：
     *   第一版把新行插在 `]` 所在行的**行首之前**（`lastNl + 1`），而**前一个元素后面没有逗号**
     *   ⇒ 写出 `"b"\n        "dsh-hob",\n` ⇒ **不再是合法 JSON**。
     *   ⇒ 正确做法：多行数组的**末项后面必须补一个逗号**，再把新行插在 `]` 之前。
     *     （末项已经有逗号时，`trimEnd` 之后能看出来 —— 这时就⛔ 不要多加。）
     */
    if (multiline) {
      /** 数组内最后一个**非空白**字符（不含 `[`/`]`）。 */
      const lastNonWs = (() => {
        for (let k = closeIdx - 1; k > openIdx; k--) {
          if (!/\s/.test(raw[k])) return k
        }
        return -1
      })()
      if (lastNonWs < 0) {
        /**
         * 数组是**空的**、但是多行（`[\n      ]` 这种）。
         * ⚠ 直接放一项进去，⛔ 不加逗号。
         */
        const openLineEnd = raw.indexOf('\n', openIdx)
        if (openLineEnd < 0 || openLineEnd > closeIdx) {
          return { ok: false, why: '多行空数组里找不到换行 ⇒ 不敢猜插入点' }
        }
        insertAt = openLineEnd + 1
        insertText = indentOfLine(openIdx) + '  "' + name + '"'
        /** ⚠ 若 `]` 与空数组同行，还得补换行；这里只处理"`]` 在下一行"的常规形态。 */
        const between = raw.slice(openLineEnd + 1, closeIdx)
        insertText += between.includes('\n') ? '\n' : ''
        how = '**数组原本是空的** ⇒ 直接放入'
        const text0 = raw.slice(0, insertAt) + insertText + raw.slice(insertAt)
        return { ok: true, text: text0, insertAt, insertText, how }
      }
      const hasTrailingComma = raw[lastNonWs] === ','
      /**
       * ⚠ 插入点 = `]` 所在行的**行首**（新行正好排在 `]` 上一行）。
       */
      const closeLineStart = raw.lastIndexOf('\n', closeIdx) + 1
      if (closeLineStart <= openIdx) {
        return { ok: false, why: '找不到 `]` 所在行的行首 ⇒ 不敢猜插入点' }
      }
      const itemIndent = indentOfLine(lastNonWs)
      if (!hasTrailingComma) {
        /**
         * ⚠⚠ **末项没有逗号 ⇒ 必须补一个**，否则 `"b"` 与 `"name"` 之间没有分隔符 ⇒ 非法 JSON。
         *
         * ── ⚠ 我第一版在这里**拒绝**了，理由是"补逗号与插新行是两处不相邻的改动" ──
         *   ⚠ **那个理由是错的**（2026-10-20 本单 B 自检 P-4 当场抓到）：
         *     把插入点选在**末项行末的换行符之前**，那么
         *       `,` + `\n` + `<缩进>"name"` 是**一整段连续文本** ——
         *     插进去正好得到 `"b",\n        "dsh-hob"\n      ]`，
         *     而"删掉这一段 ⇒ 逐字节还原"**依然成立**。
         *   ⇒ 所以这个形状**能修**，⛔ 不该拒绝（拒绝会让最常见的那份清单修不了）。
         * ⚠ 关键：插入段必须**一次成型**（逗号 + 换行 + 新行），⛔ 不许分两次写盘。
         */
        /**
         * ⚠⚠ **插入点 = 末项所在行的换行符**，方向是"**往前找**"就错了：
         *   `lastIndexOf('\n', lastNonWs)` 会落到**上一个元素行尾**的换行上
         *   （因为末项自己的换行在它**后面**）⇒ 插进去得到 `"a",,\n "dsh-hob"`（实测报错原文）。
         *   ⇒ 必须 `indexOf('\n', lastNonWs)`（**往后找**，即末项行末那个换行）。
         */
        const nlAfterItem = raw.indexOf('\n', lastNonWs)
        if (nlAfterItem < 0 || nlAfterItem > closeIdx) {
          return { ok: false, why: '末项所在行之后找不到换行 ⇒ 不敢猜插入点' }
        }
        const nlBeforeClose = nlAfterItem
        const itemIndent0 = indentOfLine(lastNonWs)
        insertAt = nlBeforeClose
        insertText = ',\n' + itemIndent0 + '"' + name + '"'
        how = '**追加到数组末尾**（没找到原位邻接项；一并补上末项的分隔逗号）'
        const text0b = raw.slice(0, insertAt) + insertText + raw.slice(insertAt)
        return { ok: true, text: text0b, insertAt, insertText, how }
      }
      insertText = itemIndent + '"' + name + '"\n'
      how = '**追加到数组末尾**（没找到原位邻接项）'
      const text3 = raw.slice(0, closeLineStart) + insertText + raw.slice(closeLineStart)
      return { ok: true, text: text3, insertAt: closeLineStart, insertText, how }
    } else {
      insertAt = closeIdx
      insertText = '"' + name + '"'
      const emptyArray = raw.slice(openIdx + 1, closeIdx).trim() === ''
      how = emptyArray ? '**数组原本是空的** ⇒ 直接放入' : '**追加到数组末尾**（没找到原位邻接项）'
      if (!emptyArray) insertText = ', ' + insertText
    }
  }
  const text = raw.slice(0, insertAt) + insertText + raw.slice(insertAt)
  return { ok: true, text, insertAt, insertText, how }
}

/**
 * **事后独立校验**：`after` 必须恰好是 `before` + 一段插入。
 *
 * ⚠ 为什么不能只靠"我是构造出来的"自证：写盘那一步可能引入编码 / 换行翻译
 *   （尤其在跨平台编辑器与 `writeFileSync` 的默认编码之间）。
 *   ⇒ 这里**从两份字节反推**：删掉插入段之后必须**逐字节**等于 before。
 * @returns `{ ok, why?, removed? }`
 */
function verifyOnlyInsertion(before, after, inserted) {
  if (typeof inserted !== 'string' || inserted === '') return { ok: false, why: '插入段为空' }
  if (after.length !== before.length + inserted.length) {
    return { ok: false, why: `字节数不符：before=${before.length} + 插入=${inserted.length} ≠ after=${after.length}` }
  }
  const at = after.indexOf(inserted)
  if (at < 0) return { ok: false, why: '在新文本里找不到插入段（写入被改写？）' }
  const restored = after.slice(0, at) + after.slice(at + inserted.length)
  if (restored !== before) {
    return { ok: false, why: '删掉插入段后**与原文不逐字节相同** ⇒ 有人在别处也改了东西' }
  }
  return { ok: true }
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
  CURRENT_QUALIFIES = false
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
  /**
   * ⚠⚠ **资格判据（本单 A 的落点）**：`dependencies` 里有本包 ⇒ 这个 profile **必须装配**。
   *   ⚠ 必须在 A/B 两段**之前**定 —— 否则 A 段那条 `bad()` 会落成"不计入"。
   */
  const hasDep = Object.prototype.hasOwnProperty.call(deps, SELF_NAME)
  CURRENT_QUALIFIES = hasDep
  if (hasDep) QUALIFIED.push(profile)

  // ── A 声明面 ───────────────────────────────────────────────────────────
  const declared = bundles !== null && bundles.some((b) => String(b) === SELF_NAME)
  if (declared) {
    ok(`A · profile "${profile}"：\`dsh.profile.bundles\` **声明**了 ${SELF_NAME}`
      + `（共 ${bundles.length} 项）`)
  } else if (!hasDep) {
    /**
     * ⚠⚠ **没声明依赖的 profile，"bundles 里没有本包"是正常态，不是缺陷**（本单 A 改判）。
     *   改前这里无条件记 `bad()` 并喊"插件不会被装配" ⇒ 对 `headless` / `system`
     *   这类**本来就不该装**的 profile，那句喊话是**误报**：它们不装是设计如此。
     *   ⇒ 现在只在**该装却没了**（`hasDep` 为真）时才红。
     */
    console.log(`  · A · profile "${profile}"：\`dsh.profile.bundles\` 里没有 ${SELF_NAME}`
      + ' ⇒ **正常**（该 profile 没声明本包依赖 = 本来就不装它）')
  } else {
    bad(`A · profile "${profile}"：\`dsh.profile.bundles\` **没有** ${SELF_NAME}`
      + `（共 ${bundles === null ? '读不到' : bundles.length} 项）⇒ **插件不会被装配**`
      + '（⚠ 它**声明了依赖**，说明本来就该装）',
      '⚠ 这就是 2026-10-20 那次事故的形态：宿主起来了、网页也开着，而 `hob_*` 全是 `unknown tool`。'
      + ' ⚠ `cordis.patch.yml` 里那条 `- id: dsh-hob` **只覆盖 config**，⛔ 挡不住这件事。')
  }

  // ── B 依赖面（⚠ 与 A 分开判：实测就是"依赖在、bundles 掉了"）──────────────
  if (hasDep) {
    ok(`B · profile "${profile}"：\`dependencies\` 里有 ${SELF_NAME} = \`${String(deps[SELF_NAME])}\``)
  } else {
    /**
     * ⚠⚠ **"没有依赖"不是缺陷，是"这个 profile 不该装它"**（本单 A 改判）。
     *   改前这里记一条 `bad()`；现在它已经升格为**资格判据**（见上面 `CURRENT_QUALIFIES`）——
     *   同一件事说两遍、还把它算进红，就是把"不归它管"读成了"它坏了"。
     *   ⚠ 仍然**照实打印**（⛔ 不许静默），并说清"为什么不计入"。
     */
    console.log(`  · B · profile "${profile}"：\`dependencies\` 里**没有** ${SELF_NAME}`
      + ' ⇒ **不参与判定**（⚠ 这不是缺陷：没声明依赖 = 这个 profile 本来就不装本插件）')
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
  } else if (!hasDep) {
    console.log(`  · C · profile "${profile}"：跳过"解析面" —— 没声明依赖 ⇒ **不参与判定**`)
  } else {
    console.log(`  ⚠ C · profile "${profile}"：跳过"解析面" —— 声明了依赖却没进 bundles ⇒ 先补那一条`)
  }

  // ── D 可修面（⚠ 只在 `--fix` 且"该补"时动手）──────────────────────────
  if (!declared && FIX && hasDep) {
    /**
     * ⚠⚠ **本单 B 的落点：走文本级单点插入，⛔ 不再 `JSON.stringify(x, null, 2)` 重排**。
     *   改前那版"闸是语义级、写盘是重排"⇒ 闸放行而整份文件被重排（`TASK` §0.2）。
     *   现在："写出来的文件 = 原文 + 一段文本"是**构造事实**，事后**再独立验一次字节**。
     */
    const plan = planBundleLineInsertion(raw, SELF_NAME, 'dsh-taskboard')
    if (!plan.ok) {
      bad(`D · profile "${profile}"：\`--fix\` **拒绝写盘** —— 做不到"只动那一行"（${plan.why}）`,
        '⚠ 这是 **字节级** 的闸：宁可红着让你手工补，也⛔ 不写一份"整份被重排过"的清单。'
        + ' 手工修法：在 `dsh.profile.bundles` 里加一行 `"' + SELF_NAME + '"`（放在 `dsh-taskboard` 之后）')
      continue
    }
    /**
     * ⚠ **旁证①（语义）**：解析后必须**只多本包这一项**（⛔ 不许悄悄改了别的字段）。
     *   ⚠ 这不是主闸 —— 主闸是下面那条**字节级**的。
     */
    let nextParsed
    try { nextParsed = JSON.parse(plan.text) } catch (e) {
      bad(`D · profile "${profile}"：\`--fix\` **拒绝写盘** —— 插入后不再是合法 JSON（${String(e?.message ?? e)}）`,
        '⚠ 插错位置会破坏结构；⛔ 不写半成品')
      continue
    }
    if (!onlyBundleLineChanged(manifest, nextParsed, SELF_NAME)) {
      bad(`D · profile "${profile}"：\`--fix\` 的改动**不止那一行**（语义层）⇒ **拒绝写盘**`,
        '⚠ 防"修一个地方、悄悄改了别处"')
      continue
    }
    const backup = `${manifestPath}.bak-bundles-${new Date().toISOString().replace(/[:.]/g, '-')}`
    try {
      copyFileSync(manifestPath, backup)
      writeFileSync(manifestPath, plan.text, 'utf8')
      /**
       * ⚠⚠ **旁证②（字节级 · 主闸）**：从**盘上读回来**再验 —— ⛔ 不拿内存里那份自证。
       *   判据：删掉插入段后必须**逐字节**等于原文。
       */
      const written = readFileSync(manifestPath, 'utf8')
      const v = verifyOnlyInsertion(raw, written, plan.insertText)
      if (!v.ok) {
        /** ⚠ 校验不过 ⇒ **当场回滚**（把备份写回去），并红着报出来。 */
        let rolledBack = false
        try { copyFileSync(backup, manifestPath); rolledBack = true } catch { /* 下面那句话会说 */ }
        bad(`D · profile "${profile}"：写盘后**字节级校验不过**（${v.why}）`
          + `⇒ ${rolledBack ? '**已回滚**' : '⚠ **回滚也失败**'}`,
          `备份 \`${backup}\`；请手工核对清单`)
        continue
      }
      ok(`D · profile "${profile}"：**已补回** ${SELF_NAME}（${plan.how}）· 备份 \`${backup}\``)
      console.log('       ⚠ 证明（**字节级**）：新文本删掉插入段后 **逐字节** 等于原文；'
        + `插入段 = ${JSON.stringify(plan.insertText)}`)
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
     * ⚠ 本单 A 改判之后：这种情况**不参与判定**（没依赖 = 不该装），但**仍然把话说出来**
     *   —— 万一是"该装却连依赖都没了"，这句话是唯一线索（⛔ 不许静默）。
     */
    console.log(`  · D · profile "${profile}"：**没法自动修** —— \`dependencies\` 里也没有 ${SELF_NAME}`
      + '（⚠ 补进 bundles 也解析不了）；⚠ 没声明依赖 ⇒ **不参与判定**，'
      + `但若它本该装，先 \`dsh plugin --profile ${profile} add ${root}\``)
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
  const { mkdtempSync, mkdirSync, symlinkSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { spawnSync } = await import('node:child_process')
  /**
   * ══ ⚠⚠ **临时件卫生**（2026-10-20 本单 C · `TASK` §0.3）════════════════════════
   *
   * 改前：本段每次跑造 **4 个 `hob-prof-*` + 1 个 `hob-prof-all-*`** 目录，**一个都不删**
   *   （文件里 `rmSync` **零命中**）。本机 `/tmp` 是 5.9 G tmpfs 且**被占满过**
   *   （`CONTEXT.md` §2.4 第 15 项）；同仓其余各族一律 `rmSync` 收尾。
   *   ⚠ 实测基线（改前）：`ls -d /tmp/hob-prof-* | wc -l` = **65**。
   *
   * ⇒ 现在：
   *   ① 所有临时根**登记进 `MADE`**，清理走**同一个函数**（⛔ 不各写一遍）；
   *   ② **失败路径也要清**：用 `try/finally` 把它包住 —— 自检哪条红都不影响清理；
   *   ③ **清理失败不静默**：清不掉就**当场说**（⛔ 不许"跑完了但脏东西留着还报全绿"）。
   */
  const MADE = []
  let cleaned = { ok: 0, fail: 0 }
  const cleanupAll = () => {
    for (const d of MADE) {
      try { rmSync(d, { recursive: true, force: true }) } catch (e) {
        cleaned.fail++
        console.log(`  ⚠ 临时目录**没清掉**：\`${d}\`（${String(e?.message ?? e)}）`
          + ' —— ⛔ 这不影响判据结论，但会在 /tmp 留垃圾')
        continue
      }
      cleaned.ok++
    }
  }
  let scBad = 0
  const say = (pass, line, why) => {
    console.log(`  ${pass ? '✓' : '✗'} ${line}${pass ? '' : `\n      ⇒ ${why}`}`)
    if (!pass) scBad++
  }
  /** 造一个假 profile 目录（⚠ 全部落在系统临时区，⛔ 不碰真 profile）。 */
  const mkProfile = (bundlesHasSelf, depsHasSelf) => {
    const base = mkdtempSync(join(tmpdir(), 'hob-prof-'))
    MADE.push(base)
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
  // ③ 依赖也没有 ⇒ **不参与判定** ⇒ 未执行（exit 2），⛔ **不是红**、⛔ 也不是 PASS
  //
  //   ⚠⚠ **本单 A 改判后这一格换了**：改前它要求 exit=1（"必须红"）；
  //     现在"没声明依赖"就是**资格判据本身**（= 这个 profile 本来就不该装它）
  //     ⇒ 它**不参与判定**，而"一个被判定者都没有"必须是 **未执行**（⛔ 不许算通过）。
  //   ⚠ 仍然要**照实把话说出来**（"没法自动修"那句必须在），⛔ 不许静默。
  {
    const h = mkProfile(false, false)
    const r = run(h, [])
    const saysNoAutoFix = r.stdout.includes('没法自动修')
    const saysNotJudged = r.stdout.includes('不参与判定')
    const saysNotRun = r.stdout.includes('未执行')
    say(r.status === 2 && saysNoAutoFix && saysNotJudged && saysNotRun,
      'P-3 ✓ 反向（本单 A 改判）：bundles 与 dependencies 都缺 ⇒ **不参与判定**'
      + '⇒ 落 **未执行（exit 2）**，⛔ 不是红、⛔ 也不是 PASS；'
      + '且仍明说"**没法自动修**"+"不参与判定"（⛔ 不给一条修不成的修法、⛔ 不静默）',
      `exit=${r.status}（应 2）· 说"没法自动修"=${saysNoAutoFix}`
      + ` · 说"不参与判定"=${saysNotJudged} · 说"未执行"=${saysNotRun}`)
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
      + '且再判一次转 **PASS**（⚠ 出问题就拒绝写盘）',
      `唯一一份=${onlyOne} · 其余未变=${sameElse} · 修后再判 exit=${r2.status}（应 0）`
      + ` · fix 输出=${String(r1.stdout).slice(0, 200)}`)
  }
  // ⑤ **没声明依赖**的 profile ⇒ 不参与判定（⛔ 不拖红、⛔ 也不静默跳过）
  {
    const base = mkdtempSync(join(tmpdir(), 'hob-prof-all-'))
    MADE.push(base)
    /**
     * ⚠⚠ **夹具形状是关键**（2026-10-20 本单 A 改判后重写）：
     *   改前这一格给 `headless` **也写了 `dependencies`**，只是想让它 `bundles` 里没有本包
     *   —— 那在**旧规则**下是"非目标 profile 掉了行 ⇒ 不该拖红"；
     *   ⚠ 而在**新规则**下，它"声明了依赖却没装"⇒ **本来就该红**（这正是新规则要抓的那一格）。
     *   ⇒ 要测"不参与判定"，夹具里那个 profile **必须连依赖都没有**（⛔ 不能只删 bundles）。
     */
    for (const [n, depsHasSelf, bundlesHasSelf] of [
      ['web', true, true],        // 被判定者 · 装好了
      ['headless', false, false], // 没声明依赖 ⇒ 不参与判定
    ]) {
      const dir = join(base, 'profiles', n)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: 'x',
        dependencies: depsHasSelf ? { [SELF_NAME]: 'link:' + root } : {},
        dsh: { profile: { bundles: bundlesHasSelf ? [SELF_NAME] : ['base'] } },
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
    /**
     * ⚠⚠ **本单 A 改判后这一格也换了**：改前测的是"**非目标** profile 没装 ⇒ 不拖红"；
     *   现在没有"目标"这一档，测的是**同一件事的正面**：
     *   `web` 声明了依赖、装好了 ⇒ 被判定；`headless` **没声明依赖** ⇒ **不参与判定**
     *   ⇒ 退出码**由 web 决定**（0）；且**必须照实说** headless 不参与（⛔ 不许静默跳过）。
     *   ⚠ 另一半（"**声明了依赖**的非目标 profile 掉行 ⇒ 必须红"）由 `P-6` 单独钉。
     */
    const saysNotJudged = r.stdout.includes('不参与判定') || r.stdout.includes('没声明依赖')
    say(r.status === 0 && saysNotJudged && r.stdout.includes('被判定'),
      'P-5 ✓ `--all`：**没声明依赖**的 profile **不参与判定**（⛔ 不拖红、⛔ 也不静默跳过）',
      `exit=${r.status}（应 0）· 说了"不参与判定"=${saysNotJudged}`
      + ` · 说了"被判定"=${r.stdout.includes('被判定')} · 输出=${String(r.stdout).slice(0, 240)}`)
  }
  // ⑥ ⭐⭐ **本单 A 的核心：声明了依赖的 profile 掉行 ⇒ 必须红**（⚠ 旧规则放过的那一格）
  //
  //   ⚠ 这一格与 P-2 的差别**只在"是不是目标 profile"**：
  //     · P-2 = `web`（旧规则的目标）掉行 ⇒ 旧规则也会红；
  //     · P-6 = **非目标** profile（这里叫 `extra`）掉行 ⇒ **旧规则放过、新规则必须红**。
  //   ⇒ 这才是本单 A"从只认目标改成按依赖面认"的**唯一可分辨**之处（⛔ 少了它，A 改没改一样）。
  {
    const base = mkdtempSync(join(tmpdir(), 'hob-prof-judge-'))
    MADE.push(base)
    for (const [n, depsHasSelf, bundlesHasSelf] of [
      ['web', true, true],        // 目标侧 · 装好了
      ['extra', true, false],     // ⚠ **非目标**、**声明了依赖**、但 bundles 掉了 ⇒ 必须红
    ]) {
      const dir = join(base, 'profiles', n)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: 'x', dependencies: depsHasSelf ? { [SELF_NAME]: 'link:' + root } : {},
        dsh: { profile: { bundles: bundlesHasSelf ? [SELF_NAME] : ['base'] } },
      }, null, 2) + '\n', 'utf8')
      mkdirSync(join(dir, 'node_modules'), { recursive: true })
      symlinkSync(root, join(dir, 'node_modules', SELF_NAME), 'dir')
    }
    const r = run(base, ['--all'])
    const namesExtra = r.stdout.includes('extra')
    const saysJudgedTwo = /被判定的 2 个 profile/.test(r.stdout) || /被判定的.*extra/.test(r.stdout)
    say(r.status === 1 && namesExtra && saysJudgedTwo,
      'P-6 ✓ **本单 A 的核心**：一个**非目标** profile 声明了依赖却没进 bundles ⇒ **必须 FAIL（exit 1）**'
      + '（⚠ 旧规则按"目标"放过它 —— 这正是 2026-10-20 事故的形态）',
      `exit=${r.status}（应 1）· 点名 extra=${namesExtra} · 说"被判定 2 个"=${saysJudgedTwo}`
      + ` · 输出=${String(r.stdout).slice(-320)}`)
  }

  console.log('')
  /** ⚠ **无论如何都清**（失败路径也清 —— `TASK` §1-C 的硬要求）。 */
  cleanupAll()
  console.log(`  ⚠ 临时件：造了 **${MADE.length}** 个、清掉 **${cleaned.ok}** 个`
    + `${cleaned.fail > 0 ? `、**⚠ ${cleaned.fail} 个没清掉**` : '（全部清净）'}`)
  console.log('')
  if (scBad === 0) {
    console.log('判定：**PASS** —— 装配面判据自检 6 条全过。')
    process.exit(0)
  }
  console.log(`判定：**FAIL**（${scBad} 条）—— 装配面判据自身不成立。`)
  process.exit(1)
}

/**
 * ── 汇总（本单 A 改判后）──────────────────────────────────────────────
 * ⚠ 口径：**退出码由所有"被判定者"决定**（= `dependencies` 里声明了本包的 profile）。
 *   · 被判定者 ≥ 1 且全过 ⇒ PASS；
 *   · 有被判定者不成立 ⇒ FAIL（⚠ 不管它是"目标"还是"顺带扫到的"）；
 *   · 一个被判定者都没有 ⇒ **未执行**（⛔ 不是 PASS：没东西可判就不是"通过"）。
 * ⚠ **不再有"目标 profile"那一档** —— 那档会把"另一个该装的 profile 掉了行"一起放过，
 *   而那正是 2026-10-20 事故的形态。
 */
const judged = QUALIFIED
const notJudged = names.filter((n) => !QUALIFIED.includes(n))
if (judged.length === 0) {
  console.log('判定：**未执行** —— 没有一个 profile 的 `dependencies` 里声明了 ' + SELF_NAME
    + ' ⇒ **没有可判定的对象**（⚠ 这不代表装对了；也不代表没装 —— 只是"没有任何 profile 声称要装它"）。')
  console.log(`       ⚠ 扫过的 profile：${names.join(' / ') || '(无)'}`)
  process.exit(2)
}
if (badCount === 0) {
  console.log(`判定：**PASS** —— **${judged.length} 个被判定 profile**（${judged.join(' / ')}）`
    + `的装配面四条全部成立（${okCount} 条）。`)
  if (notJudged.length > 0) {
    console.log(`       ⚠ 另扫了 ${notJudged.length} 个**没声明依赖**的 profile（${notJudged.join(' / ')}）：`
      + '它们**不参与判定**（⚠ 不是"通过了"，是"本来就不该由它们装"）。')
  }
  process.exit(0)
}
console.log(`判定：**FAIL** —— **被判定的 ${judged.length} 个 profile**（${judged.join(' / ')}）`
  + `里有 ${badCount} 条不成立（${okCount} 条成立）。`
  + ' ⚠ 装配面出问题**不会**让 `check:build` 红（它判的是盘上产物），'
  + '⛔ 所以这条判据不能省。')
process.exit(1)
