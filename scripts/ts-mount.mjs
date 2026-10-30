/**
 * **纯库** —— 把 `src/**.ts(x)` 按 `src/` 的相对结构转译进一个一次性目录，供
 * 「真 DOM」判据（`check:hob-create-dom` / `check:hob-gate`）动态 `import`。
 *
 * ⚠ 它**不是**判据族、没有自己的进程入口与退出码 ⇒ 被上面两族 `import` 调用，
 *   ⛔ 不单独进 `npm run`（因此登记在 `check-repo-rules.mjs` 的 `SCRIPT_LANDING_EXEMPT`）。
 *
 * ══ 它治的是什么（2026-10-24 · B 席 · 由 client-fixer 实测暴露、船长复核定位）══════════
 *   两族的旧做法是**单文件** `ts.transpileModule()` + 直接 `import` 产物。三层缺陷：
 *
 *   ① **`transpileModule` 是逐文件转译，不做路径重写**：产物里仍是 `../shared/x.ts`，
 *      Node 会去找一个**不存在的 `.ts`** ⇒ `ERR_MODULE_NOT_FOUND` → 检查器 `exit 3`。
 *      （`check:hob-gate` 后来补了 `rewriteRelImports`，`check:hob-create-dom` **没跟上**。）
 *   ② **产物平铺**（`out/ui.mjs`）没有复刻 `src/` 的结构 ⇒ 即使重写了扩展名，
 *      `../shared/x.mjs` 也指向一个不存在的目录。
 *   ③ ⚠ ⚠ **它现在还能通过，纯属侥幸**：`create-hob-dialog.tsx` 里那条
 *      `import { PLANNING_PRESET_ID } from '../shared/planning-preset.ts'` **从未被使用**，
 *      `isolatedModules` 把整条 import **擦除** ⇒ 产物里没有它 ⇒ 解析不到也发现不了。
 *      **谁一真的使用它（或引入 `import { t } from './i18n.ts'`），dom 脚本立刻崩**。
 *
 * ══ 现在的做法（把"侥幸"变成"判据"）══════════════════════════════════════════════
 *   · **从源码文本解析**相对 import（⛔ 不看转译产物 —— 被擦除的 import 在产物里看不见，
 *     而那正是侥幸的来源），**递归**把被引用的 `src/**` 依赖一起转译；
 *   · 产物**按 `src/` 的相对结构**落盘（`out/client/x.mjs` + `out/shared/y.mjs`）；
 *   · 相对说明符的**扩展名跟着产物走**（`.ts` / `.tsx` ⇒ `.mjs`）；
 *   · **转译完必须自证**（`verifyMounted`）：
 *       ① 产物里**不得**残留未被重写的 `.ts`/`.tsx` 相对 import；
 *       ② 每一条相对 import **必须指向本次真的产出的文件**（缺一件 ⇒ 点名报出来）；
 *       ③ 入口的每一条**源码**相对 import 都必须在"已产出"集合里
 *          （⚠ 这一条才是"被擦除的 import"的牙口——它从**源码**取证）。
 *   ⇒ 将来有人引入新的相对 import、而本库没跟（比如加了 `.css` / `.json` 之类的
 *     非 TS 说明符），会**响亮地红**并点名是哪一个文件、哪一条说明符。
 *
 * ⚠ 零第三方依赖：只用 Node 内置 + 调用方传进来的 `ts`（仓库自己的 TypeScript）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, relative, sep } from 'node:path'

/**
 * 抽源码里的 **import 说明符**（ESM 静态 import / `export … from` / 动态 `import()`）。
 *
 * ⚠ 为什么在**源码**上抽、而不是在产物的 `import` 语句上抽：
 *   `isolatedModules` 会**擦除未使用的 import**（TypeScript 的 importsNotUsedAsValues
 *   语义）⇒ 只扫产物就**看不见**那一条 ⇒ 正是本库要治的"侥幸绿"。
 * ⚠ 抽取是**保守**的：宁可多抽（例如字符串里出现 `import ... from '...'`），
 *   也⛔ 不许漏 —— 多抽的后果只是"多转译一份存在/不存在的文件"，会被下面 ② 点名。
 *
 * @param {string} code - 源码文本
 * @returns {string[]} 说明符（原样，未解析）
 */
export function extractSpecifiers(code) {
  const out = []
  const push = (s) => { if (typeof s === 'string' && s !== '') out.push(s) }
  // `import x from 'a'` / `import {x} from 'a'` / `import * as x from 'a'` / `export {x} from 'a'`
  for (const m of code.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) push(m[1])
  // 副作用 import：`import 'a'`
  for (const m of code.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) push(m[1])
  // 动态 import：`import('a')`
  for (const m of code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) push(m[1])
  return [...new Set(out)]
}

/** 是否为「相对说明符」（`./` / `../` 开头）。⚠ 裸包名（`react` / `@deepseek-ai/x`）**不是**。 */
export const isRelativeSpecifier = (s) => s.startsWith('./') || s.startsWith('../')

/** 去掉 `.ts` / `.tsx` 扩展名（⚠ 只处理这两种；别的扩展名原样留着，交给 ② 去报）。 */
export const stripTsExt = (s) => s.replace(/\.tsx?$/, '')

/**
 * 把**相对说明符**重写为指向产物（`.mjs`）。
 *
 * ⚠ 只改相对路径 + 只改 `.ts` / `.tsx` 结尾 —— 裸包名（`react`）与别家扩展名一个字不动。
 * ⚠ 覆盖四种写法：`from '…'`、`import '…'`、`import('…')`、以及 `export … from '…'`
 *   （最后一种已被 `from` 一条覆盖）。
 *
 * @param {string} code - 转译产物
 * @returns {string} 重写后的代码
 */
export function rewriteRelImports(code) {
  return code.replace(
    /((?:from|import)\s*\(?\s*)(['"])(\.{1,2}\/[^'"]+?)\.tsx?(\2)/g,
    (_m, head, q, spec, tail) => `${head}${q}${spec}.mjs${tail}`,
  )
}

/** `src/` 下的相对路径 ⇒ POSIX 形式（⛔ 不用平台分隔符拼 import 路径）。 */
const toPosix = (p) => p.split(sep).join(posix.sep)

/**
 * 转译一棵**从入口可达的源码树**到 `outDir`（按 `src/` 的相对结构）。
 *
 * @param {object} o
 * @param {string} o.root        - 仓库根（绝对路径）
 * @param {string} o.outDir      - 产物根（绝对路径；⚠ 调用方负责建/清）
 * @param {string[]} o.entries   - 入口 **相对 `root` 的路径**（如 `'src/client/create-hob-dialog.tsx'`）
 * @param {any} o.ts             - 仓库自己的 TypeScript 模块（`ts.transpileModule` 用）
 * @param {object} [o.compilerOptions] - 覆盖转译选项（缺省 = React + ESNext + ES2022 + isolatedModules）
 * @returns {{ mounted: string[], entries: Record<string, string>, problems: string[] }}
 *   `mounted`  = 相对 `root` 的源件路径（按产出顺序，⚠ 去重后）；
 *   `entries`  = 入口相对路径 → 产物**绝对路径**（⚠ 给调用方 `import`）；
 *   `problems` = 结构性问题（⚠ **非空即必须报红**，⛔ 不许当"没找到就算了"）。
 */
export function mountTsGraph({ root, outDir, entries, ts, compilerOptions }) {
  const CO = compilerOptions ?? {
    jsx: ts.JsxEmit.React,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    isolatedModules: true,
  }
  /** 已产出集合：相对 `root` 的源件路径（POSIX）。 */
  const mounted = []
  const mountedSet = new Set()
  /** 相对 `root` 的路径 → 产出绝对路径。 */
  const outOf = new Map()
  const problems = []
  /** 待转译队列（相对 `root` 的 POSIX 路径）。 */
  const queue = entries.map((e) => toPosix(e))

  /**
   * `fromRel`（相对 `root` 的源件）里的相对说明符 ⇒ 目标源件（相对 `root`，POSIX）。
   * ⚠ 目标**不带**扩展名时依次试 `.ts` / `.tsx` / `/index.ts` / `/index.tsx`（与 TS 的解析同序）。
   */
  const resolveSpec = (fromRel, spec) => {
    const fromDir = posix.dirname(toPosix(fromRel))
    const joined = posix.normalize(posix.join(fromDir, spec))
    const hasTsExt = /\.tsx?$/.test(spec)
    if (hasTsExt) return joined
    const candidates = [`${joined}.ts`, `${joined}.tsx`, `${joined}/index.ts`, `${joined}/index.tsx`]
    return candidates.find((c) => existsSync(join(root, c))) ?? `${joined}.ts`
  }

  while (queue.length > 0) {
    const rel = queue.shift()
    if (mountedSet.has(rel)) continue
    const abs = join(root, rel)
    let src = ''
    try { src = readFileSync(abs, 'utf8') } catch (e) {
      problems.push(`读不到源件 \`${rel}\`（${String(e?.message ?? e)}）`)
      continue
    }
    // ① 从**源码**抽相对说明符 ⇒ 递归排进队列（⚠ 这是"被擦除的 import 也算数"的落点）
    for (const spec of extractSpecifiers(src)) {
      if (!isRelativeSpecifier(spec)) continue
      if (!/\.tsx?$/.test(spec)) {
        /**
         * ⚠ **非 TS 的相对说明符**（`.css` / `.json` / 无扩展名指向非 TS 件）——
         *   本库**不转译**它，但⛔ 不许静默放过：点名报出去，由人决定怎么接。
         *   ⚠ 这正是"将来引入新形态的 import 而脚本没跟"的响亮出口。
         */
        problems.push(`\`${rel}\` 里有**非 TS 的相对 import**：\`${spec}\` ⇒ 本库只转译 \`.ts\` / \`.tsx\`，`
          + '这一条**不会被产出** ⇒ 运行期必然 `ERR_MODULE_NOT_FOUND`（要支持它得先扩展本库）')
        continue
      }
      const target = resolveSpec(rel, spec)
      if (!existsSync(join(root, target))) {
        problems.push(`\`${rel}\` 引用的 \`${spec}\` **在磁盘上不存在**（解析成 \`${target}\`）⇒ 判据失去基准`)
        continue
      }
      queue.push(target)
    }
    // ② 转译 + 重写扩展名 + 按 `src/` 结构落盘
    const outRel = toPosix(relative(join(root, 'src'), abs)).replace(/\.tsx?$/, '.mjs')
    const outAbs = join(outDir, outRel)
    mkdirSync(dirname(outAbs), { recursive: true })
    let code = ''
    try { code = ts.transpileModule(src, { compilerOptions: CO }).outputText } catch (e) {
      problems.push(`\`${rel}\` 转译失败：${String(e?.message ?? e)}`)
      continue
    }
    writeFileSync(outAbs, rewriteRelImports(code))
    mountedSet.add(rel)
    mounted.push(rel)
    outOf.set(rel, outAbs)
  }

  const entryMap = {}
  for (const e of entries.map((x) => toPosix(x))) {
    const abs = outOf.get(e)
    if (abs === undefined) problems.push(`入口 \`${e}\` **没有产出**（转译失败或读不到）`)
    else entryMap[e] = abs
  }
  return { mounted, entries: entryMap, problems }
}

/**
 * **自证**：把"转译产物"再验一遍（⚠ 这一步才是把"侥幸绿"变成判据的地方）。
 *
 * 三条判据（每条都能独立失败）：
 *   ① **产物里不许残留 `.ts` / `.tsx` 相对 import**（= 重写真的生效了）；
 *   ② 产物里每一条相对 import 都**必须指向本次真的产出的文件**（缺一件 ⇒ 点名）；
 *   ③ 入口**源码**里的每一条相对 import 都必须在 `mounted` 集合里
 *      （⚠ 这条从**源码**取证 ⇒ 连"被 `isolatedModules` 擦除"的那一条也算数）。
 *
 * @param {object} o
 * @param {string} o.root     - 仓库根
 * @param {string[]} o.entries - 入口（相对 `root`）
 * @param {string[]} o.mounted - `mountTsGraph` 的产出集合
 * @param {Record<string,string>} o.entryFiles - 入口 → 产物绝对路径
 * @returns {string[]} 问题清单（⚠ 非空 ⇒ **必须报红**）
 */
export function verifyMounted({ root, entries, mounted, entryFiles }) {
  const problems = []
  const mountedSet = new Set(mounted)
  for (const [entryRel, outAbs] of Object.entries(entryFiles)) {
    let code = ''
    try { code = readFileSync(outAbs, 'utf8') } catch (e) {
      problems.push(`读不到产出 \`${outAbs}\`（${String(e?.message ?? e)}）`)
      continue
    }
    // ① 残留的 `.ts` / `.tsx` 相对 import
    for (const m of code.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]*\.tsx?)['"]/g)) {
      problems.push(`产出（来自 \`${entryRel}\`）里**残留未重写的 TS 相对 import**：\`${m[1]}\``
        + ' ⇒ `rewriteRelImports` 没生效（或说明符写法超出它的正则）')
    }
    // ② 产物里的相对 import 必须指向真产出的文件
    for (const m of code.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const spec = m[1]
      const target = join(dirname(outAbs), spec)
      if (!existsSync(target)) {
        problems.push(`产出（来自 \`${entryRel}\`）里的相对 import \`${spec}\` **在产物目录里不存在**`
          + `（解析成 \`${target}\`）⇒ 运行期必然 \`ERR_MODULE_NOT_FOUND\``)
      }
    }
    // ③ 入口**源码**里的每条相对 import 都必须在 mounted 里
    let src = ''
    try { src = readFileSync(join(root, entryRel), 'utf8') } catch { src = '' }
    for (const spec of extractSpecifiers(src)) {
      if (!isRelativeSpecifier(spec)) continue
      if (!/\.tsx?$/.test(spec)) continue   // 非 TS 说明符已由 mountTsGraph 点名
      const fromDir = posix.dirname(entryRel)
      const joined = posix.normalize(posix.join(fromDir, spec))
      if (!mountedSet.has(joined)) {
        problems.push(`入口 \`${entryRel}\` 源码里的相对 import \`${spec}\` **没有被转译产出**`
          + `（应为 \`${joined}\`）`
          + ' ⇒ ⚠ 这正是"被 `isolatedModules` 擦除所以侥幸通过"那一类：'
          + '**这条判据从源码取证，所以即使产物里看不见它，也照样会红**')
      }
    }
  }
  return problems
}
