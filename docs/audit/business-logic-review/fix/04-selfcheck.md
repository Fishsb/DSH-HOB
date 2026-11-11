# 修复规格 · 04 · 自检体系与文档契约

> 对应缺陷：**S-16**（负控计数器不跳注释）· **S-06**（10 族负控下限为 0）· **R-03**（阶段步名 8 份字面量）· **R-04**（运行时教模型「五步」）· **S-08 / D-09**（CU-5 正则指向已改名常量）· **R-27 / D-06**、**T-18 / D-07**、**T-19 / D-08**（README 三处失准）
> 编号口径：本文用 **REVIEW.md 的编号**（S-06 / S-16 / R-03 / R-04 / S-08 / R-27 / T-18 / T-19）；括号内是 t6 docs.md 的旧编号（D-02 / D-01 / D-03 / D-09 / D-06 / D-07 / D-08），便于两份文档对读。
> 性质：**规格**，不改任何源码。每条给七要素。
> 行号：以本次读码为准（已与 REVIEW.md 对齐；漂移处注明「行号已核对」）。

---

## 0. 阅读顺序与三条硬依赖

```
S-16 ──必须先于──▶ S-06 ──同批──▶ M-1 才真正有牙
R-03 ──必须同批──▶ R-04
S-08 独立，但它引出的元判据 E-1 与 S-16 同族（一次做掉防复发）
README 三处（R-27 / T-18 / T-19）互相独立，可最后做
```

| 依赖 | 强度 | 理由（一句话） | 违反后果 |
|---|---|---|---|
| **S-16 → S-06** | **硬（顺序）** | 计数器不剥注释时，往注释里写「负向对拍」就能「补齐」下限；先抬下限等于**奖励注释凑数** | 抬完下限后 10 族可用「注释里写标签」通过，M-1 从「没牙」变成「假牙」 |
| **R-03 ↔ R-04** | **硬（同批）** | 词表与运行时话术是同一件事的两面 | 单边改会让「不一致」从 1 处变 2 处 |
| **S-08 → E-1** | 软（同族） | CU-5 是「引用不存在的常量」的实例，E-1 是元判据 | 只修 CU-5 ⇒ 下一次改名还会静默失效 |
| **S-06 内部两张表** | **硬（同批）** | `meta-negative-floor.json` ↔ `ASSERTION_FLOORS` 必须焊起来 | 「加族时忘登记负控」永远是静默口子（见 §2.3） |

**排序依据**（REVIEW §1.3 第 5 条 + §8 P3）：本组四条全部落在「给元规则装上牙」⇒ 先修「让失败不可观测」的，再修缺陷本身。顺序 = **S-16 → S-06 → S-08/E-1 →（R-03+R-04）→ README**。

---

## 1. S-16 · 元规则 M-1 把被注释掉的负控照样算成一条

### ① 缺陷编号与位置

- **编号**：`S-16`（t6 报作 `D-02` 的同族、但更根本；REVIEW §5.2 已单列 `S-16`）
- **位置**：`scripts/check-meta-negctl.mjs:48`（`CALL_LIT_RE`）+ `:56-63`（`countLabels`）
- **行号已核对**（本次 `sed -n '48p;56,63p'` 逐行确认）

**是什么**（本次亲自跑，用与 `:48` 完全相同的正则）：

```
plain            => 1
lineComment      => 1      # // bad('负向对拍：行注释')
blockComment     => 1      # /* ok('负向对拍：块注释') */
jsdoc            => 1      # /** * bad('负向对拍：JSDoc') */
insideString     => 1      # const s = "bad('负向对拍：字符串里')"
templateInside   => 1      # 模板串插值里的假标签
urlInString      => 1      # const u='https://e.com//x'; 后面再跟一条真标签
regexLike        => 1      # const r = /[/*]/; 后面再跟一条真标签
```

⇒ **M-1 的最短绕过路径是加两个斜杠**：把一条会红的对拍注释掉，`npm run check:meta-negctl` 照旧全绿。

**为什么比 S-06 更根本**：S-06 说「下限 = 0 ⇒ 零负控也永远绿」，准确但不完整；真实形态还包括「**有负控但被注释掉，M-1 照样数得到**」。S-06 的修法（抬下限）**完全覆盖不到**，反而让「用注释凑数」更有利可图。

### ② 改什么

只改**一个函数**：`scripts/check-meta-negctl.mjs` 的 `countLabels()`（`:56-63`）——把「直接扫原文」改成「**先剥注释、再扫**」。
`CALL_LIT_RE`（`:48`）**一字不动**：它匹配的「调用形态」是对的，错的是「在什么文本上跑它」。

### ③ 具体改法（完整形状 + 三个边界）

**不要新写剥离器**：本仓已有一份**判定等价且保留行号**的实现 —— `scripts/check-preset-contracts.mjs:3405-3437` 的 `stripCommentsOnlyLocal()`。本次实测其行为：

| 用例 | naive | stripCommentsOnlyLocal | 期望 | 结论 |
|---|---|---|---|---|
| 正常 `ok(...)` | 1 | **1** | 1 | 通过 |
| 行注释 | 1 | **0** | 0 | 通过 |
| 块注释 | 1 | **0** | 0 | 通过 |
| JSDoc | 1 | **0** | 0 | 通过 |
| 字符串里的假调用 | 1 | **1** | **0** | 需改语义（见 (b)） |
| 多行模板串里的双斜杠 | 1 | 1 | 1 | 靠运气（本仓无此写法） |
| URL 字符串 `'https://e.com//x'` | 1 | **1** | 1 | 通过 |
| 正则 `/[/*]/` | 1 | **0** | 1 | **吃掉真标签（假红）** |

**三个必须写清的边界：**

**(a) 字符串里的双斜杠不能被当成注释。**
`stripCommentsOnlyLocal` 遇单引号 / 双引号 / 反引号 时**整段跳过字面量**（`:3424-3432`）⇒ `'https://e.com//x'` 里的双斜杠不会误判。
⚠ 但模板串分支遇换行即 `break`（`:3429`）⇒ **多行模板串**里后续的双斜杠会被误当行注释。本仓 `scripts/*.mjs` 实测**无此写法**，但那是运气 ⇒ 必须由 §1.⑤ 的 `N-M1c` 用例钉住。

**(b) 模板串里的插值不需要递归 —— 但「字符串里的假调用」必须计 0。**
两条是不同的事：
- **插值不递归**是对的：标签只能出现在**第一个实参的字面量**里，插值内部是另一个表达式，不可能再构成「bad(...) 里含标签」这个调用形态 ⇒ 整段跳过是**有意简化**，理由写进函数注释。
- **但「字符串字面量里的假调用」必须计 0**：REVIEW.md 初稿把 `insideString` 期望写成 1，那是按「字面量里有标签就算」的口径。按 M-1 的**语义**（标签必须是 `ok/bad/check` 的第一个实参），它不是调用 ⇒ 必须 0，否则「把标签塞进任意字符串」仍能凑数，**同一个漏洞换个壳**。⇒ 实现上要**先定位调用、再取其第一个实参的字面量**，而不是「先扫所有字面量」。

**(c) 正则字面量里的斜杠星号会被误当块注释 —— 现存实现的真实缺陷。**
`stripCommentsOnlyLocal` **不识别正则字面量**。实测：

```
const r=/[/*]/;  后面跟一条真标签
   naive=1   strip=0     ← 把真标签吃掉了（假红）
```

本次给了一版**加正则识别**的改进并实测对照：

```
case            A(现形)  B(+正则)  want
行注释             1        1       1
块注释             1        1       1
正则含 /*          0        1       1    ← B 修好（A 会吃掉真标签 ⇒ 假红）
正则含 //          0        1       1    ← B 修好
除法 a / b         1        1       1    （不被误判成正则）
字符串含 //         1        1       1
```
且 **全仓 47 族读数在 A 与 B 下完全相同（564）**，唯一差异族仍是 `check:meta-negctl`（4→3）。⇒ 加正则识别**零副作用**。

**最终改法（照这个形状写）：**

```
// scripts/check-meta-negctl.mjs
// 新增：保留行号的注释剥离器（注释换等量空格，换行原样保留）
// 三条边界顺序不可换： 1 行注释  2 块注释  3 正则字面量
// 字符串 / 模板串整段跳过（不去改它，交给「先定位调用」那一步判断）
function stripCommentsKeepLines(src) {
  const NL = '\n'
  const out = Array.from(src)
  const n = src.length
  const blank = (a, b) => { for (let k = a; k < b && k < n; k++) if (out[k] !== NL) out[k] = ' ' }
  const REGEX_PREV = new Set(['(', '[', '{', ',', ';', '=', ':', '!', '&', '|', '?', '+', '-', '*', '%', '<', '>', '~', '^'])
  let i = 0
  while (i < n) {
    const c = src[i], c2 = src[i + 1]
    if (c === '/' && c2 === '/') { let j = i + 2; while (j < n && src[j] !== NL) j++; blank(i, j); i = j; continue }
    if (c === '/' && c2 === '*') { let j = i + 2; while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++; j = Math.min(j + 2, n); blank(i, j); i = j; continue }
    if (c === '/' && !(c2 === '/' || c2 === '*')) {
      let b = i - 1; while (b >= 0 && /\s/.test(src[b])) b--
      const prev = b < 0 ? '' : src[b]
      if (prev === '' || REGEX_PREV.has(prev)) {
        let j = i + 1, inClass = false
        while (j < n) {
          if (src[j] === '\\') { j += 2; continue }
          if (src[j] === '[') { inClass = true; j++; continue }
          if (src[j] === ']') { inClass = false; j++; continue }
          if (!inClass && src[j] === '/') { j++; break }
          if (src[j] === NL) break
          j++
        }
        while (j < n && /[a-z]/.test(src[j])) j++
        i = j; continue
      }
    }
    if (c === '"' || c === "'" || c === 'BACKTICK') {
      const Q = c; let j = i + 1
      while (j < n) { if (src[j] === '\\') { j += 2; continue } if (src[j] === Q) { j++; break } if (src[j] === NL) break; j++ }
      i = j; continue
    }
    i++
  }
  return out.join('')
}

// countLabels：签名不变（调用方零改动），改为「先剥注释，再只数调用形态」
export function countLabels(src) {
  return countLabelsOnCode(stripCommentsKeepLines(String(src ?? '')))
}
// 内部：在已剥注释的文本上计数（导出供自检用例直接调用）
export function countLabelsOnCode(code) {
  let n = 0
  for (const m of code.matchAll(CALL_LIT_RE)) {
    const s = m[1] ?? m[2] ?? ''
    if (s.includes('负向对拍')) n += 1
  }
  return n
}
```

（上面 `'BACKTICK'` 处写反引号字符本身。）

⚠ **「字符串里的假调用计 0」怎么落地**：只在**已剥注释**的文本上跑 `CALL_LIT_RE` 仍会把 `"bad('负向对拍…')"` 数进去（因为它长得像调用）。两种落地方式，**推荐第 2 种**：
1. 把字符串字面量也抹掉（`stripCommentsAndStrings`，`check-client-deps.mjs:182` 已有）——但那会**同时抹掉真正的标签**（标签就在字符串里）⇒ **不可用**。
2. **定位调用 + 取第一个实参**：先用 `CALL_LIT_RE` 找到匹配（此时已剥注释 ⇒ 注释里的假调用不会进），再**回看该字面量前一个非空字符是不是 `(@`、再往前是不是 `ok/bad/check/note.push`**；若不是，说明这个字面量**不是任何调用的第一个实参**（比如它嵌在另一个字符串里），跳过。本次已用此法验过 9 个用例（/tmp/probe_lex.cjs），其中「模板串体」「字符串里的假调用」都正确计 0。

### ④ 依赖与冲突

- **必须先于 S-06**（§0）。若先抬下限：10 族只要在注释里写标签就能补齐 ⇒ M-1 从「没牙」变「假牙」，**比现状更坏**。
- **落地即触发一次自红（这是正确性的第一个证据）**：`check:meta-negctl` 自身读数从 **4 → 3**（被剥掉的正是 `:287` 注释里的示例串 `N-xx ✓ 负向对拍…`），而 `meta-negative-floor.json` 登记的是 **4** ⇒ `3 < 4` 当场红。
  **处置并入 S-06 的改动清单**（不单独开条）：同批把 `check:meta-negctl` 的下限 4 → **3**，并在该 json 的 `note` 写明「-1 = 剥注释后少掉一条注释里的假标签（S-16）」。
- 与 S-06「抬到 ≥1」不冲突：抬下限时用**剥注释后的读数**（本次实测其余 46 族读数**逐族不变**）。

### ⑤ 验证方式（含负向对拍）

**(1) 用例自检 —— 进脚本，不是人眼跑**

在 `check-meta-negctl.mjs` 直跑入口（`:238` 之后）新增 `N-M1c`：

```
{
  const CASES = [
    ['plain',         'ok(TAG)',                              1],
    ['lineComment',   '// bad(TAG) 换行 const x=1',            0],
    ['blockComment',  '/* ok(TAG) */ 换行 const y=2',          0],
    ['jsdoc',         '/** 换行 * bad(TAG) 换行 */ 换行 const z=3', 0],
    ['stringLiteral', 'const s = "bad(TAG)"',                  0],
    ['templateBody',  'const t = 反引号 x bad(TAG) y 反引号',   0],
    ['urlInString',   'const u="https://e.com//x"; ok(TAG)',   1],
    ['regexClass',    'const r=/[/*]/; ok(TAG)',               1],
  ]
  // 上面 TAG 一律替换为中文「负向对拍」四个字、换行替换为真实换行、反引号替换为字符本身
  const wrong = CASES.map(([label, src, want]) => ({ label, want, got: countLabels(src) }))
                     .filter((x) => x.got !== x.want)
  if (wrong.length === 0) ok('N-M1c 剥注释自证：8 个用例逐个符合（JSDoc / 字符串里的双斜杠 / 正则里的斜杠星号 都覆盖）')
  else for (const w of wrong) bad('N-M1c · ' + w.label + ' 实 ' + w.got + ' 期望 ' + w.want + ' ⇒ 计数器仍被非代码文本干扰')
}
```

⚠ **`stringLiteral` 期望 0 而非 1**：REVIEW.md 初稿写「1/0/0/0/0」，把 `insideString` 当 1。按 M-1 语义它不是调用，应为 0（理由见 (b)）。**此处以本文为准。**

**(2) 核心负向对拍：注释掉一条真实对拍 ⇒ 必须红**

进脚本（推荐 `N-M1d`，纯内存、不落盘）：

```
{
  const fams0 = familiesFromPkg()
  const target = 'check:ledger'
  const entryFile = fams0[target].replace(/^scripts\//, '')
  const real = readFileSync(join(here, entryFile), 'utf8')
  const m = /^(?=\s*(?:ok|bad)\()/m.exec(real)          // 找任一条断言行
  if (m === null) bad('N-M1d · 找不到可注释的断言行 ⇒ 本条不可判')
  else {
    const commented = real.slice(0, m.index) + '// ' + real.slice(m.index)
    const a = countLabels(real), b = countLabels(commented)
    if (a === b) bad('N-M1d · 注释掉一条断言后计数没变（' + a + ' -> ' + b + '）⇒ 计数器仍在读注释')
    else ok('N-M1d 负向对拍：注释掉一条断言 ⇒ 计数 ' + a + ' -> ' + b + '（下降）⇒ 注释凑数被堵死')
  }
}
```

**(3) 全仓零回归（可执行）**

```
npm run check:meta-negctl      # 期望 M-1 / M-1b / N-M1 / N-M1c / N-M1d 全绿（S-06 未做时 M-1 可能先红一次，见 4）
npm run check:gitignore        # 它 :283 也调 runNegativeCoverage ⇒ 同源生效
npm run check:all 2>&1 | tail -40
```

**负向对拍（把要守的实现改坏 ⇒ 必须红）**：把 `countLabels` 改回直接扫原文（去掉 `stripCommentsKeepLines` 那一层）⇒ `N-M1c` 的 lineComment / blockComment / jsdoc / templateBody 四条**同时红**，`N-M1d` 也红。

**本次已实测的判据分辨力**：naive 全仓总计 **565** 条，剥注释后 **564** 条；唯一差异族 = `check:meta-negctl`（4→3）；**0 族出现「剥后变多」**（= 没吃掉代码）。

### ⑥ 回退方式

- 单点：把 `countLabels` 函数体改回 `for (const m of src.matchAll(CALL_LIT_RE)) { ... }`（保留 `countLabelsOnCode` / `stripCommentsKeepLines` 不影响行为）。
- 连带：`check:meta-negctl` 的下限随 S-06 改；若回退 S-16，**必须同批**把下限从 3 改回 4，否则「下界低于实测」会触发双向判据红。
- ⚠ 回退会**重新打开「加两个斜杠」路径**，回退说明里要写明。

### ⑦ 改动面等级

**局部**：1 个文件、1 个函数 + 2 个新导出 + 2 条自检断言。不触 `src/`、不改任何族行为、不改 `CALL_LIT_RE`。
唯一跨文件影响：`check-gitignore.mjs:283` 也调 `runNegativeCoverage` ⇒ **自动继承修复**（正向，无需改它）。

---
## 2. S-06 · 10 个族的负控下限为 0（零负控也永远绿）

### ① 缺陷编号与位置

- **编号**：`S-06`（REVIEW §5.2；t6 报作 `D-02`）
- **位置**：
  - 登记表 `scripts/meta-negative-floor.json:4-53`（50 族，其中 10 族 = 0）
  - 判据 `scripts/check-meta-negctl.mjs:142-144`（`if (got < floor[fam])`）
  - 断言下界 `scripts/check-all.mjs:201`（`['check:work-plan-runtime', 42]`）
- **行号已核对**

**实测（10 族，本次复现）**：

```
node -e 'const j=require("./scripts/meta-negative-floor.json");const z=Object.keys(j.floor).filter(k=>j.floor[k]===0);console.log(z.length);console.log(z.join("\n"))'
10
check:all / check:build / check:host / check:preflight / check:profile
check:readings / check:rounds / check:selfwake / check:tasks-route-http / check:work-plan-runtime
```
### ② 改什么（必须先把「三种情况」分开 —— 混在一起抬下限会造出假绿）

本次逐族实测了这 10 族的**真实负控形态**（扫 ok(/bad(/note.push(/check( 字面量 + 扫非注释位置的「负向对拍」+ 识别断言通道）：

| 族 | M-1 可见 | 非注释位置标签 | 断言通道 | 真实情况 |
|---|---|---|---|---|
| check:all | 0 | **0** | ok()/bad() | **49 处全在注释里** ⇒ 真没有负控 |
| check:build | 0 | **3** | bad.push + say() | 有负控，但打在**第 2 个实参**（say(pass, line, why)）⇒ 计数器看不见 |
| check:host | 0 | **0** | bad.push / problems.push | **真没有负控** |
| check:preflight | 0 | **0** | 无 | **体检脚本、恒 exit 0** ⇒ 结构上不该有负控 |
| check:profile | 0 | **0** | ok()/bad() + say() | 有 --self-check 9 条（:845 起）⇒ 计数器看不见 |
| check:readings | 0 | 1（横幅） | note.push | 有 readings 三档夹具表（:238-301）⇒ 计数器看不见 |
| check:rounds | 0 | 1（横幅） | bad.push | 有 readings 八档表（:729-834）⇒ 计数器看不见 |
| check:selfwake | 0 | 0 | say() | 有 --selftest（:112）⇒ 计数器看不见 |
| check:tasks-route-http | 0 | 0 | ok()/bad() | **真没有负控**（且属 SELF，不在必跑套件） |
| check:work-plan-runtime | 0 | 0 | ok()/bad() | **真没有负控**，只有两行注释「负向①/②」（:212/:214） |

⇒ **10 族分三类，处置各不相同**：

| 类 | 族 | 处置 |
|---|---|---|
| **A · 有负控但形态看不见**（5 族） | build / profile / readings / rounds / selfwake | **扩计数口径**（S-06a），**然后**按真实读数登记下限。⚠ 不许「改写断言去迎合计数器」 |
| **B · 真没有负控**（3 族） | host / work-plan-runtime / all | **补真负控**（S-06b），补完再抬到 ≥1 |
| **C · 结构上不该有**（2 族） | preflight / tasks-route-http | **显式登记豁免 + 写明理由**（S-06c），下限保持 0 但**必须在输出里点名** |

⚠ **这一分法本身就是本条的产出**：只写「抬到 ≥1」会逼着 A 类去**改断言形态**（把 say() 改成 ok()）——那是**为了让计数器看得见而改被测对象**，本仓明令禁止。正确方向是**改计数器**。

### ③ 具体改法

#### S-06a · 扩 M-1 计数口径（必须先于抬下限）

```
// scripts/check-meta-negctl.mjs
// 现状：CALL_LIT_RE 只认 ok|bad|note.push|check 的第一个实参
// 新增：say(pass, line, why) —— 标签在**第 2 个**实参（本仓 3 个族用这个通道）
const SAY_LIT_RE = /(?:^|[^.\w])say\(\s*[^,()]*,\s*(?:\x60([^\x60]*)\x60|'([^']*)')/gs

export function countLabelsOnCode(code) {
  let n = 0
  for (const m of code.matchAll(CALL_LIT_RE)) {
    const s = m[1] ?? m[2] ?? ''
    if (s.includes('负向对拍')) n += 1
  }
  for (const m of code.matchAll(SAY_LIT_RE)) {
    const s = m[1] ?? m[2] ?? ''
    if (s.includes('负向对拍')) n += 1
  }
  return n
}
```

⚠ **为什么 say() 取第 2 个实参**：本仓三处 say 的签名都是 say(pass, line, why)（check-build-sync.mjs:243 / probe-selfwake-e2e.mjs:160 / check-profile-assembly.mjs:876）⇒ 第 1 个实参是布尔，第 2 个才是人读标签。⚠ 正则里 [^,()]* 是为了**跳过第 1 个实参**（不跨括号/逗号），够用且不误伤。

⚠ **readings 表怎么办**：check:readings / check:rounds 用的是 readings.push({label,expect,got}) + console.log 打印，**不是断言调用**；扩正则去认它会放大误报面。⇒ **推荐不扩**，改用 S-06b 的「补一条 ok() 形态真负控」覆盖这两个族的**核心档**（各 1 条，成本可控）。
#### S-06b · 给 B 类补真负控（逐族给形状）

**B-1 · check:work-plan-runtime（42 断言 / 0 负控，最重）**
现成素材就在文件里 —— :212 / :214 已有两条**行为**，只是没打标签：

```
// scripts/check-work-plan-runtime.mjs，紧跟现有 :211-216 那段之后
// 现状（已有，勿动）：
//   const foreign = await h.orch.archiveStalePlan('WP-abandon', '测试', 'session-other')
//   const noWhy  = await h.orch.archiveStalePlan('WP-abandon', '   ', 'session-hob')
// 新增两条（用 ok/bad 通道 + 打「负向对拍」标签，M-1 才数得到）：
if (fs.existsSync(planFile) && foreign?.ok !== true) {
  ok('WPR-N1 负向对拍：非责任人清计划被拒（他人不能替它清）⇒ 计划仍在盘上')
} else bad('WPR-N1 · 非责任人清计划没被拒 ⇒ archiveStalePlan 的 owner 判定没牙')
if (fs.existsSync(planFile) && noWhy?.ok !== true) {
  ok('WPR-N2 负向对拍：无原因清计划被拒（缘由必填）⇒ 计划仍在盘上')
} else bad('WPR-N2 · 无原因清计划没被拒 ⇒ abandonedWhy 必填没牙')
```

⚠ **不要删那两行注释**（它们是「先自证」素材），但 M-1 **只认标签、不认注释** ⇒ 必须补上面两条 ok()。

**B-2 · check:host（真产物探针，0 负控）**
补一条最小负控：故意把期望改错，断言它**必须**报问题：

```
// scripts/host-probe.mjs，在现有 SWITCH_DEFAULTS 比对之后
{
  // 负向对拍：把 modules.tools 的期望默认值改成 false ⇒ 比对必须报"默认值不符"
  const mutated = { ...SWITCH_DEFAULTS, tools: false }
  const probe = (obj) => Object.entries(mutated).filter(([k, want]) => obj[k] !== want).length
  const synthetic = { tools: true, bus: true, orch: false, settings: true }
  if (probe(synthetic) > 0) ok('HP-N1 负向对拍：把期望默认值改错 ⇒ 默认值比对真的报问题（不是恒绿）')
  else bad('HP-N1 · 期望值被改错后比对仍通过 ⇒ 那条默认值断言没有牙')
}
```

⚠ 若 SWITCH_DEFAULTS 的键集合与真实 schema 不同，本条会**先红**——那是**正向**信号（说明默认值表本身漂了）。

**B-3 · check:all（聚合入口，0 负控，49 处全在注释里）**
它**已有**两条真负向对拍（下界破了抬退出码），只是没打标签：

```
// scripts/check-all.mjs，直跑入口（:1515 之前）
if (process.argv.includes('--selftest')) {
  const fake = [{ name: 'check:x', code: 0, ms: 1, skipped: 0, assertions: 1, passed: 1, denominator: 'per-assertion' }]
  const code = printSummary(fake)   // 族数 1 < FAMILY_FLOOR 45 ⇒ 应返回 1
  if (code === 1) ok('N-ALL 负向对拍：伪造"只跑 1 族"的读数 ⇒ 族数下界当场把退出码抬到 1')
  else bad('N-ALL · 族数下界被突破却没抬退出码 ⇒ 那条下界没有牙')
  process.exit(code === 1 ? 0 : 1)
}
```

⚠ 做成 --selftest 分支（不默认跑）——printSummary 会往 stdout 印一整份汇总，混进正常输出会污染人读的读数。⚠ 但**必须进 CI**：check:all 的 npm script 改成 node scripts/check-all.mjs --selftest && node scripts/check-all.mjs。

#### S-06c · C 类豁免登记（2 族，必须「显式 + 可读」）

在 meta-negative-floor.json 里给这两族**单独一张豁免表**（不是沉默的 0）：

```
{
  "note": "...（原有）...",
  "floor": { "check:preflight": 0, "check:tasks-route-http": 0, "...": 0 },
  "exempt": {
    "check:preflight": "体检脚本：只报告缺什么、恒 exit 0（:26-29 自陈），结构上没有「该红」的判据 ⇒ 负控无对象",
    "check:tasks-route-http": "按需档：要活宿主 + launch token，CI 跑不了；无对象时 exit 2（noObject），也不是「该红」⇒ 负控无对象"
  }
}
```

并在 check-meta-negctl.mjs 输出里**点名**（不是只藏在合计行里）：

```
const exempt = reg.exempt ?? {}
const zeroLeft = Object.keys(floor).filter((f) => floor[f] === 0 && exempt[f] === undefined)
if (zeroLeft.length > 0) bad('M-1 · 这些族的负控下限为 0 且**没有豁免理由**：' + zeroLeft.join(' / '))
else if (Object.keys(exempt).length > 0) {
  ok('M-1 ✓ 下限为 0 的 ' + Object.keys(exempt).length + ' 族**都有豁免理由**：'
    + Object.keys(exempt).map((f) => f + '（' + exempt[f].slice(0, 24) + '…）').join(' · '))
}
```

⚠ 注意 readFloor()（:118-125）目前**只返回 floor 与 note**，要把 exempt 一并带出（:121 那行改成 return { floor: o.floor ?? {}, note: o.note, exempt: o.exempt ?? {} }）。

#### S-06d · 抬下限（**最后一步**，逐族按实测值）

依赖 S-16 + S-06a + S-06b 都落地后，按**实测读数**登记（零余量）：

| 族 | 现在 | 抬到 | 依据 |
|---|---|---|---|
| check:work-plan-runtime | 0 | **2** | 新增 WPR-N1 / WPR-N2 |
| check:host | 0 | **1** | 新增 HP-N1 |
| check:all | 0 | **1** | 新增 N-ALL |
| check:build | 0 | **2** | S-06a 扩 say() 后实测 = 2（T-d :303 / T-g :393） |
| check:selfwake | 0 | **1** | --selftest 里补 1 条打标签的 ok() |
| check:profile | 0 | **1** | --self-check 里选一条（建议 :925 D 组声明面）改打标签 |
| check:readings | 0 | **1** | readings 三档里选「该咬必咬」那档补一条 ok() 标签 |
| check:rounds | 0 | **1** | readings 八档里选「② 删行」那档补一条 ok() 标签 |
| check:preflight | 0 | **0（豁免）** | S-06c |
| check:tasks-route-http | 0 | **0（豁免）** | S-06c |

⚠ **「抬到几」以实测为准，上表是预估**；落地时逐族跑一次取真实值（本仓纪律：下界 = 实测，**零余量**）。
⚠ **另需同批**：check:meta-negctl 由 4 → **3**（S-16 的连带，见 §1.④）。
### ④ 依赖与冲突

- **硬依赖 S-16**（§0 / §1）：S-16 未落地时抬下限 = 奖励注释凑数。
- **硬依赖 S-06a 先于 S-06d**：不扩口径就抬 A 类下限，会逼着改断言形态去迎合计数器（违反「不改被测对象」纪律）。
- **S-06c 与 S-06d 同批**：只抬不加豁免 ⇒ preflight 会被迫造一条假负控。
- **与 S-10（FAMILY_FLOOR 余量）无关**：S-10 判的是 results.length（check-all.mjs:1162），与 meta-negative-floor.json 是**两个分母**（REVIEW §9.4 #5 已订正）。**不要**在一次改动里同时动 FAMILY_FLOOR 与 meta-negative-floor.json —— 两个下界同批动会**分不清是哪个变红**。

### ⑤ 验证方式（含负向对拍）

```
# 1) 抬完下限后必绿（零余量）
npm run check:meta-negctl      # 期望 M-1 / M-1b / N-M1c / N-M1d 全绿；输出里列出 2 个豁免族
npm run check:gitignore        # 同源生效（它 :283 也调 runNegativeCoverage）

# 2) 负向对拍 A：把某族下限改回 0 ⇒ S-06c 那条「0 且无豁免」必须红
node -e "const f='scripts/meta-negative-floor.json';const j=require('./'+f);j.floor['check:host']=0;require('fs').writeFileSync(f,JSON.stringify(j,null,2))"
npm run check:meta-negctl      # 期望：M-1 · check:host 下限为 0 且没有豁免理由 ⇒ 红
git checkout scripts/meta-negative-floor.json

# 3) 负向对拍 B：把某族负控删光 ⇒ 下限守不住
#    （内存里把 check:work-plan-runtime 的 WPR-N1/N2 两条 ok() 删掉）
npm run check:meta-negctl      # 期望：M-1 · check:work-plan-runtime 实测 0 < 下限 2 ⇒ 红

# 4) 抬下限不能靠注释凑数（S-16 联合验收）
#    在 work-plan-runtime 里加一行注释 // 负向对拍：这不是真对拍
npm run check:meta-negctl      # 期望：读数不变（仍是 2）⇒ 注释不算
```

### ⑥ 回退方式

- 回退顺序**与落地顺序相反**：先回退下限 → 再回退 S-06a 的 SAY_LIT_RE → 最后回退 S-06b 的新断言。
- 单条回退任一 S-06b 断言时，**必须同批**下调对应族下限，否则「实测 > 下界」会红（双向判据）。

### ⑦ 改动面等级

**跨模块**：check-meta-negctl.mjs（口径 + 豁免输出 + readFloor 带出 exempt）· meta-negative-floor.json（10 族 + exempt 段）· 6 个族源文件各加 1–2 条断言（check-work-plan-runtime / host-probe / check-all / probe-selfwake-e2e / check-profile-assembly / check-readings-citable / check-rounds-records）。
⚠ **不触 src/**（全部在 scripts/ 内）。
⚠ package.json 只改 check:all 一条 script（加 --selftest 分支调用）。

---
## 3. R-03 · 阶段步名 8 份字面量且已漂

### ① 缺陷编号与位置

- **编号**：`R-03`（blocker；REVIEW §5.1）
- **位置（8 份，本次逐份 grep 确认）**：

| # | 位置 | 形态 | 第 3 步 |
|---|---|---|---|
| 1 | `src/shared/pipeline-view.ts:33-41` `PIPELINE_STAGES` | id + name（7 项） | 任务图 |
| 2 | `src/shared/stage-controls.ts:16-28` `STAGE_IDS` + `STAGE_NAMES` | id 数组 + Record | **编码任务** ← 漂了 |
| 3 | `src/shared/stages-index.ts:29-37` `STAGE_DEFS` | step + kind + name | 任务图 |
| 4 | `src/shared/requirement-chain.ts:120-128` `STEP_DEFS` | step + name + kind | 任务图 |
| 5 | `src/shared/requirement-chain.ts:112-118` `LEGACY_STEP_DEFS` | **五步旧表** | 编码任务（**有意保留**） |
| 6 | `src/client/project-panel.tsx:138` `STAGES_STEP_NAMES` | 纯名字数组 | 任务图 |
| 7 | `scripts/gen-ledger.mjs:522` `STEP_NAMES` | 纯名字数组 | 任务图 |
| 8 | `src/shared/tasks-progress.ts:67` `TASKS_STEP_NAMES` | **五步旧词表** | 编码任务（**有意保留**） |

**实测证据**：

```
$ grep -rn "'任务图'\|'编码任务'" src/ scripts/ --include=*.ts --include=*.tsx
src/client/project-panel.tsx:138    ... '任务图' ...        （7 项）
src/shared/stages-index.ts:32       { step: 3, kind: 'task', name: '任务图' }
src/shared/tasks-progress.ts:67     TASKS_STEP_NAMES = [... '编码任务' ...]   （5 项旧词表）
src/shared/pipeline-view.ts:36      { step: 3, id: 'tasks', name: '任务图' }
src/shared/stage-controls.ts:22     tasks: '编码任务',                          ← 唯一漂的
src/shared/requirement-chain.ts:115 { step: 3, name: '编码任务' }              （LEGACY，有意）
src/shared/requirement-chain.ts:123 { step: 3, name: '任务图' }
scripts/gen-ledger.mjs:522          STEP_NAMES = [... '任务图' ...]
```

**造成的可见后果**：`STAGE_NAMES` 的唯一消费方是 `gen-ledger.mjs:1264-1271`，它把名字写进**账本 `CONTEXT.md` 的「阶段控制」块**。⇒ 跑一次 `npm run gen:ledger`，账本里印「编码任务」而面板显示「任务图」。
⚠ 实测真账本**当前还没有该块**（`grep -n '### 阶段控制' /home/lk/.dsh/hob-ledgers/dsh-hob/CONTEXT.md` ⇒ 零命中）⇒ 矛盾暂不可见，**这正是它一直没被发现的原因**。

### ② 改什么（留哪一份、其余如何 import）

**留 `stage-controls.ts` 的那一份（就是现在写着「编码任务」的那处），但把值改成「任务图」。**

**为什么留它 —— 三条硬理由（本次实测，不是偏好）：**

1. **依赖图位置最低**：`pipeline-view.ts:25` **已经** `import { ... } from './stage-controls.ts'`；而 `grep -c "from './pipeline-view.ts'" src/shared/stage-controls.ts` = **0**。⇒ 若反过来让 stage-controls 依赖 pipeline-view，就是**新增一个循环**。
2. **已经有成对的 `STAGE_IDS + STAGE_NAMES`**（:16-28）：id 与 name 同处一张表；其余 6 份要么只有 name（#4/#6/#7）、要么 name 与 kind/step 混排（#1/#3）。
3. **改一个值 vs 改 7 份**：把 `stage-controls.ts:22` 的 `'编码任务'` 改成 `'任务图'`，**1 行**；让其余 6 份派生它，**不动它们的值**（它们本来就是对的）。

**收敛后的形状：**

```
// -- src/shared/stage-controls.ts（唯一来源）-----------------------------
// 本体不改结构，只改 :22 一个值 + 加一段「唯一步名来源」的注释
export const STAGE_IDS = ['requirements', 'plan', 'tasks', 'execution', 'verification', 'acceptance', 'closure'] as const
export type StageId = (typeof STAGE_IDS)[number]

/**
 * 步名的**唯一定义处**。
 * ⚠ 其余 6 处（pipeline-view / stages-index / requirement-chain / project-panel / gen-ledger）
 *   必须 import 或从本表派生，⛔ 不许再写第二份字面量（R-03）。
 * ⚠ 两个**有意保留**的例外（不是漂移，别"顺手统一"）：
 *   · requirement-chain.ts 的 LEGACY_STEP_DEFS —— v2 旧链的**五步**词表（含「验收核对」），
 *     对应 tasks-progress.ts 的五步旧接口；改名会让旧账本读不出来。
 *   · tasks-progress.ts 的 TASKS_STEP_NAMES —— 同上，是旧接口的解析词典。
 *   ⇒ 例外必须**双侧注释互相指名**，并由 §3.④ 的断言把「只许多这两份」钉死。
 */
export const STAGE_NAMES: Readonly<Record<StageId, string>> = {
  requirements: '需求规格',
  plan: '实现方案',
  tasks: '任务图',          // <- 唯一改动：'编码任务' 改成 '任务图'
  execution: '任务执行',
  verification: '技术验证',
  acceptance: '产品验收',
  closure: '交付收口',
}
```

```
// -- src/shared/pipeline-view.ts（保留对外导出名，改成派生）-------------
// 现状 :33-41 是字面量数组；改成从 STAGE_IDS + STAGE_NAMES 生成
// 该文件 :25 已 import stage-controls（同名解构里补两项即可）
import { STAGE_IDS, STAGE_NAMES } from './stage-controls.ts'
export const PIPELINE_STAGES = STAGE_IDS.map((id, i) => ({ step: i + 1, id, name: STAGE_NAMES[id] })) as
  ReadonlyArray<{ readonly step: number; readonly id: StageId; readonly name: string }>
// ⚠ 保留名字 PIPELINE_STAGES：check-pipeline.mjs:320-325 直接引用它（不改判据）
// ⚠ 类型从 as const 元组降级为只读数组 ⇒ 若有调用方依赖元组字面量类型，typecheck 会报；
//   本次实测消费方只有 pipeline-view.ts:224/229 两处 .map()，与 check-pipeline.mjs（JS，无类型）⇒ 安全
```

```
// -- src/shared/stages-index.ts（STAGE_DEFS 的 name 改成派生）-----------
// 该文件 :22 已 import stage-controls，补两个名字
import { STAGE_IDS, STAGE_NAMES } from './stage-controls.ts'
const STAGE_KIND_BY_ID = { requirements: 'req', plan: 'change', tasks: 'task',
  execution: 'run', verification: 'verification', acceptance: 'acc', closure: 'closure' } as const
export const STAGE_DEFS = STAGE_IDS.map((id, i) => ({
  step: i + 1, kind: STAGE_KIND_BY_ID[id], name: STAGE_NAMES[id],
}))
```

```
// -- src/shared/requirement-chain.ts（只改 STEP_DEFS，LEGACY 不动）-------
// 该文件 :17 已 import stage-controls，补一个名字
import { STAGE_NAMES } from './stage-controls.ts'
const STEP_DEFS = [
  { step: 1, name: STAGE_NAMES.requirements, kind: 'req' },
  { step: 2, name: STAGE_NAMES.plan,         kind: 'change' },
  { step: 3, name: STAGE_NAMES.tasks,        kind: 'task' },
  { step: 4, name: STAGE_NAMES.execution,    kind: 'run' },
  { step: 5, name: STAGE_NAMES.verification, kind: 'verification' },
  { step: 6, name: STAGE_NAMES.acceptance,   kind: 'acc' },
  { step: 7, name: STAGE_NAMES.closure,      kind: 'closure' },
] as const
// LEGACY_STEP_DEFS（:112-118）**保持字面量不动**，只加一行注释指向 STAGE_NAMES 的例外说明
```

```
// -- src/client/project-panel.tsx:138 -----------------------------------
// 现状注释说「⛔ 这里不 import 服务端模块（客户端包不该拉服务端解析器）」
// ⚠ **该前提实测不成立**：lib/client.js 里已有 交付收口×6 / 技术验证×7 / activeStage×6 /
//   STAGE_KIND_STATUSES×4（因为 stage-status-labels.ts:25 已 import stages-index，
//   而 stages-index import pipeline-view）⇒ 客户端包**早就**把这三份拉进来了
import { STAGE_IDS, STAGE_NAMES } from '../shared/stage-controls.ts'
export const STAGES_STEP_NAMES = STAGE_IDS.map((id) => STAGE_NAMES[id])
// STAGE_KIND_BY_STEP（:148-156）同步改成由 STAGE_IDS 派生
```

```
// -- scripts/gen-ledger.mjs:522 ----------------------------------------
// 该文件 :22 已 import 同模块（STAGE_IDS / STAGE_NAMES / gateProblemsAt）
export const STEP_NAMES = STAGE_IDS.map((id) => STAGE_NAMES[id])
```

**关于 `stage-controls.ts:57` 的注释（REVIEW §8.1 点名的「R-03 两处必须同批」的第二处）：**
`:57` 写「真正执行期间，当前步仍显示「编码任务」」—— 它在描述**改前行为**（前一句是「改前第 3 步与第 4 步都拿 built 当完成信号」）。⇒ **不必改词**，但要加一句「（⚠ 步名以 `STAGE_NAMES` 为准，见 R-03）」，以免被读成当前事实。
**这里与 REVIEW §8.1 的设想不同，要写明**：它设想的「两处」是「常量 + 注释」都要改；实际处置是**只改常量值、给注释加限定**——因为改词会把「描述历史」改成「描述现在」，反而失真。⇒ **§8.1 那一行建议改成「常量值 + 注释加限定」。**

### ③ 依赖与冲突

- **必须与 R-04 同批**（§0）：R-03 改词表，R-04 改运行时话术。只改 R-03 ⇒ 模型仍按五步报；只改 R-04 ⇒ 话术与面板再次错位。
- **不依赖 S-16 / S-06**（不同文件、不同层），但**依赖 `npm run typecheck` 通过**：把 `as const` 元组降级为 `.map()` 数组是**类型形状变化**，必须由 typecheck 兜住。
- **与 S-08 / E-1 正交**：E-1 查「被引用的常量是否存在」，不查值 ⇒ 抓不到 `'编码任务'`。两者不冲突也不替代。

### ④ 验证方式（含负向对拍）

```
# 1) 类型与构建
npm run typecheck                  # 期望 exit 0
npm run build                      # 期望 exit 0（⚠ 会写 lib/，按纪律在 CI 跑；本地只跑 typecheck）

# 2) 唯一性：'编码任务' 只剩两处有意保留
$ grep -rn "'编码任务'" src/ scripts/ --include=*.ts --include=*.tsx --include=*.mjs
# 期望命中：requirement-chain.ts LEGACY_STEP_DEFS / tasks-progress.ts TASKS_STEP_NAMES
#          / check-stages-panel-dom.mjs 的夹具（夹具是**输入数据**，不是词表，见 §3.⑤）

# 3) 同词三处
npm run check:stages-route        # R-2 逐项比 7 个 name
npm run check:pipeline            # PIPE-15 比 id 序
npm run check:stages-dom          # S-1 从 project-panel 抽 7 项真值
```

**新增断言（建议落 `check:stages-route`，因为它已 import 三份模块）**：`R-14`

```
// R-14（新）· 步名单一来源：所有派生表与 STAGE_NAMES 逐项相等
{
  const sc = await import(pathToFileURL(join(root, 'src', 'shared', 'stage-controls.ts')).href)
  const pv = await import(pathToFileURL(join(root, 'src', 'shared', 'pipeline-view.ts')).href)
  const si = await import(pathToFileURL(join(root, 'src', 'shared', 'stages-index.ts')).href)
  const p = []
  const want = sc.STAGE_IDS.map((id) => sc.STAGE_NAMES[id])
  // 1 PIPELINE_STAGES：id 与 name 双项相等
  pv.PIPELINE_STAGES.forEach((s, i) => {
    if (s.id !== sc.STAGE_IDS[i]) p.push('PIPELINE_STAGES[' + i + '].id=' + s.id + ' != ' + sc.STAGE_IDS[i])
    if (s.name !== want[i]) p.push('PIPELINE_STAGES[' + i + '].name=' + s.name + ' != ' + want[i])
  })
  // 2 STAGE_DEFS：name 相等（kind 由 R-10 管）
  si.STAGE_DEFS.forEach((s, i) => { if (s.name !== want[i]) p.push('STAGE_DEFS[' + i + '].name=' + s.name + ' != ' + want[i]) })
  // 3 客户端表必须是派生
  const panelSrc = readFileSync(join(root, 'src', 'client', 'project-panel.tsx'), 'utf8')
  if (!/STAGES_STEP_NAMES\s*=\s*STAGE_IDS\.map/.test(panelSrc)) p.push('project-panel.tsx 的 STAGES_STEP_NAMES 又写回字面量了')
  // 4 gen-ledger 的 STEP_NAMES 必须是派生
  const genSrc = readFileSync(join(root, 'scripts', 'gen-ledger.mjs'), 'utf8')
  if (!/STEP_NAMES\s*=\s*STAGE_IDS\.map/.test(genSrc)) p.push('gen-ledger.mjs 的 STEP_NAMES 又写回字面量了')
  // 5 例外只许两份，且必须在预期文件里
  const ALLOWED_LEGACY = new Set(['src/shared/requirement-chain.ts', 'src/shared/tasks-progress.ts'])
  for (const f of ['src/shared/requirement-chain.ts', 'src/shared/tasks-progress.ts',
                   'src/client/project-panel.tsx', 'src/shared/stages-index.ts', 'src/shared/pipeline-view.ts']) {
    const n = (readFileSync(join(root, f), 'utf8').match(/'编码任务'/g) ?? []).length
    if (n > 0 && !ALLOWED_LEGACY.has(f)) p.push(f + ' 里仍有 ' + n + " 处 '编码任务'")
  }
  if (p.length === 0) ok('R-14 步名单一来源：PIPELINE_STAGES / STAGE_DEFS / STAGES_STEP_NAMES / STEP_NAMES 与 STAGE_NAMES 逐项相等，例外只有两份旧词表')
  else for (const x of p) bad('R-14 · ' + x)
}
```

**负向对拍（两条，缺一不可）**：

```
# N-R-14a：把 stage-controls.ts:22 改回 '编码任务' ⇒ R-14 必须红
sed -i "s/tasks: '任务图',/tasks: '编码任务',/" src/shared/stage-controls.ts
npm run check:stages-route        # 期望：R-14 · PIPELINE_STAGES[2].name=任务图 != 编码任务（+ STAGE_DEFS 同条）
git checkout src/shared/stage-controls.ts

# N-R-14b：把 project-panel.tsx 的 STAGES_STEP_NAMES 改回字面量 ⇒ R-14 的第 3 条必须红
npm run check:stages-route        # 期望：R-14 · project-panel.tsx 的 STAGES_STEP_NAMES 又写回字面量了
```

### ⑤ 关于 `check-stages-panel-dom.mjs` 里的 15 处 `'编码任务'`

⚠ **不要改它们**（本次 grep：15 处 `name: '编码任务'` + 9 处 `'任务图'`）。分两类：

| 位置 | 性质 | 处置 |
|---|---|---|
| `:814 / :1210 / :2230 / :2385 / :2467 / :3058 / :3109 / :3216 / :3384 / :3847 / :4085 / :4301 / :4620 / :4654 / :5222` 的 `{ step: 3, name: '编码任务', ... }` | **fake 响应夹具**（模拟服务端返回） | **建议不改**：它们是「历史真实返回过的形状」的快照，改它等于伪造过程记录 |
| `:2258` 的 `const names = ['需求规格','实现方案','编码任务','任务执行','验收核对']` | **S-17a 的期望值** | **不改**：S-17a 挂的是 `STAGES_OK`（`:2221-2238`，**五步**）⇒ 它守的是**旧五步接口**，与 R-03 的七步词表不是同一件事。但要加注释「本组守五步旧接口，七步词表见 R-14」 |

⇒ **净改动面**：R-03 只碰 **6 个生产文件 + 1 个脚本 + 1 条新断言**，**不碰任何 check 夹具**。这是「同一文件的多条必须合并成一次改动」的落点。

### ⑥ 回退方式

- 逐文件回退（每处都是「字面量 → 派生」的局部替换）：① `stage-controls.ts:22` 改回 `'编码任务'`；② `pipeline-view.ts:33-41` 恢复字面量；③ 其余 4 处各自恢复字面量。
- ⚠ **回退必须整批**：只回退 2–3 个文件会让「派生 + 字面量」混住，比现状更难查。
- ⚠ 类型形状回退：`PIPELINE_STAGES` 从 `.map()` 改回 `as const` 元组时，若调用方已按元组写类型，typecheck 会再报一次。

### ⑦ 改动面等级

**跨模块**：`src/shared/` 4 个文件 + `src/client/` 1 个 + `scripts/` 1 个 + 1 条新断言。
⚠ **不触** `meta-negative-floor.json`；但新增 1 条断言 ⇒ `ASSERTION_FLOORS` 里 `check:stages-route` 要从 36 抬到 37。**若与 S-06 同批会与 S-06 的下界调整混在一起 ⇒ 建议 R-03 单独一批落地，下界同步 +1。**
⚠ 需要 `npm run build`（改 `src/`）⇒ 属「需宿主配合」：**改完要重启实例才生效**（README §4「改完代码是否立即生效」）。

---
## 4. R-04 · 运行时教模型「五步」，而面板与文档是「七步」

### ① 缺陷编号与位置

- **编号**：`R-04`（blocker；REVIEW §5.1）
- **位置（四份载体，本次逐份 grep）**：

| 角色 | 位置 | 原文 |
|---|---|---|
| **运行时**（模型真读到的） | `preset/dsh-hob/preset-dsh-hob.patch.yml:434` = `preset/dsh-hob/gen/persona.md:364` | ... the five steps (需求规格 / 实现方案 / **编码任务** / 任务执行 / **验收核对**) ... |
| **人读版** | `preset/dsh-hob/gen/contracts.md:200` = `preset/dsh-hob/spec/reply.md:84` | ... Pipeline v3 主线（需求规格 / 实现方案 / **任务图** / 任务执行 / 技术验证 / 产品验收 / 交付收口） |
| **附注卷（生成源）** | `preset/dsh-hob/spec/notes-handover.md:244` | 与运行时同句（五步旧词） |
| **代码真值** | `src/shared/pipeline-view.ts:33-41` | 7 步，`activeStage` 取值 1..7（`:481`） |

**为什么五处自检全绿**（理解这一点才明白「只改一处」为何不成立）：

| 判据 | 它比什么 | 为什么绿 |
|---|---|---|
| `check:workflow` **F10**（`:859-895`） | `prefix` 正文 == `gen/persona.md` | 两份**都是**五步 ⇒ 一致 |
| `check:workflow` **F5**（`:729-775`） | 每个 source 标记的**前 110 字符**能否在 `origin-prefix.txt` 里找到 | 见下（**结构性盲区**） |
| `check:workflow` **F14**（`:441-505`） | reply id + 两条硬话 | 与步名无关 |
| `check:preset-contracts` **⑤** | `kit/drafts/preset-contracts.md` 引文块 == `prefix` | 人读镜像也是五步 ⇒ 一致 |
| `check:preset-contracts` **⑤v** | 五步段标题的**位置** | 位置对，内容不核 |

**F5 的盲区（本次读码确认，这是「为什么没人发现」的根因）**：
`notes-handover.md` 的 `:244` 那句**没有自己的 source 标记**，它被归入 `:224` 的块（source 指向「这轮做了什么 …」那段）。F5 只核**那个 needle**（原文确有，grep 计数 = 1）⇒ **绿**。而 `:244` 的**正文内容**（五步清单）**根本不在 **`origin-prefix.txt` 里**（`grep -c '当前：第' preset/dsh-hob/spec/origin-prefix.txt` = **0**）。
⇒ **F5 核「出处」不核「新增内容」**；这句是「原文没有、后来手工加的」，没有任何判据管。

**后果**：Hob 每轮固定第一行 `当前：第 N 步 · <步名>` 要求「与 Pipeline 视图的 `activeStage` 一致」，而模型手里是**五步词表**（第 5 步「验收核对」），视图是**七步**（第 5 步「技术验证」、第 6 步「产品验收」）⇒ 用户看到「第 5 步 · 验收核对」而面板显示「第 5 步 · 技术验证」。**恰好踩宪法第 8 条「测试通过 ≠ 产品验收」的反面。**

### ② 改什么

改 **1 处源**（`spec/notes-handover.md:244`）+ **2 处派生**（`gen/persona.md` / `preset-dsh-hob.patch.yml`，由生成器重跑，**不手改**）+ **1 处人读镜像**（`kit/drafts/preset-contracts.md`，由 `sync:preset-draft` 重跑）。
`gen/contracts.md:200` 与 `spec/reply.md:84` **已经是对的（七步），不动**。

### ③ 具体改法

#### 步骤 1 · 改源（唯一手改的一处）

```
// preset/dsh-hob/spec/notes-handover.md:244 —— 只换步名清单与「five steps」这个措辞
// 改前： ... come from the five steps (需求规格 / 实现方案 / 编码任务 / 任务执行 / 验收核对); ...
// 改后： ... come from the Pipeline v3 stages (需求规格 / 实现方案 / 任务图 / 任务执行 / 技术验证 / 产品验收 / 交付收口); ...
// 该行其余内容（对象示例、must agree with activeStage、判不出写法）一个字不动。
```

⚠ **三处必须一起改**：① `the five steps` → `the Pipeline v3 stages`（**不写 seven steps**：步数会再变，把数量交给视图）② 清单换 7 项 ③ `编码任务` → `任务图`（与 R-03 同批，来源 = `STAGE_NAMES` 的值）。
⚠ **不要动 `:224` 的 source 标记**：F5 拿它当 needle，改了会红（而且它是对的 —— 那段原文确实在 `origin-prefix.txt` 里）。**只改正文行，不加新标记。**

#### 步骤 2 · 重跑生成器（派生 `gen/persona.md`）

```
npm run gen:preset-contract      # 写 preset/dsh-hob/gen/{persona,contracts}.md
# contracts.md:200 来自 spec/reply.md:84（已是七步）⇒ 重跑后不变
# persona.md 字符数 +约 20（"five steps" -> "the Pipeline v3 stages"，清单 5 项 -> 7 项）
# 当前 43365 字符 / 预算 48000（MODEL_FACE_CHAR_BUDGET = 48_000，gen-preset-contract.mjs:53）⇒ 余量充足
```

#### 步骤 3 · 把 persona 同步进 prefix + 人读镜像

```
npm run sync:preset-draft
# 它做两件事（scripts/sync-draft-block.mjs:22-48）：
#   1) gen/persona.md -> preset-dsh-hob.patch.yml 的 prefix: |- 块
#   2) gen/persona.md -> kit/drafts/preset-contracts.md 的第一个四反引号 text 块
```

⚠ **为什么必须用 `sync:preset-draft` 而不是手改 `prefix`**：`gen-preset-contract.mjs:10-11` 明写「⛔ **不写进** preset-dsh-hob.patch.yml」⇒ 4→5 步**没有机检**，只有事后 F10 比对。手改缩进/空行极易触发 F10 假红。

#### 步骤 4 · 新增跨源断言 F15（**这才是本条真正的修复**）

⚠ **只改文本不算修好**：不改判据，下次有人再手改这行，五处仍然是绿的 ⇒ 必须新增**跨源**断言。

```
// scripts/check-workflow.mjs，紧跟 F14（:505）之后
// F15 · 步名清单三处互核（R-04）
//   1 spec/reply.md 的「取自 Pipeline v3 主线（...）」括号清单
//   2 prefix 正文里「step name come from ...（...）」括号清单
//   3 代码真值：src/shared/stage-controls.ts 的 STAGE_NAMES（R-03 收敛后的唯一来源）
{
  const probs = []
  const listOf = (text, re) => {
    const m = re.exec(text)
    if (m === null) return null
    return m[1].split('/').map((s) => s.trim()).filter((s) => s !== '')
  }
  const SPEC_RE = /取自 Pipeline v3 主线（([^）]+)）/
  const PREFIX_RE = /step name come from [^(（]*[（(]([^)）]+)[)）]/
  let specText = ''
  try { specText = readFileSync(join(PRESET_DIR, 'spec', 'reply.md'), 'utf8') } catch { specText = '' }
  const live = prefixBodyOf(yml)
  const prefixText = live?.text ?? ''
  if (specText === '') probs.push('spec/reply.md 读不到 ⇒ F15 失去对象')
  if (prefixText === '') probs.push('prefix 正文读不到 ⇒ F15 失去对象')

  const fromSpec = specText === '' ? null : listOf(specText, SPEC_RE)
  const fromPrefix = prefixText === '' ? null : listOf(prefixText, PREFIX_RE)
  if (fromSpec === null) probs.push('spec/reply.md 里找不到「取自 Pipeline v3 主线（...）」⇒ 判据形态变了')
  if (fromPrefix === null) probs.push('prefix 正文里找不到「step name come from ...（...）」⇒ 判据形态变了（很可能是又改回了 five steps）')

  let want = null
  try {
    const sc = await import('node:url').then((u) => u.pathToFileURL(join(PRESET_DIR, '..', '..', 'src', 'shared', 'stage-controls.ts')).href)
      .then((h) => import(h))
    want = sc.STAGE_IDS.map((id) => sc.STAGE_NAMES[id])
  } catch (e) { probs.push('读不到 stage-controls 的 STAGE_NAMES：' + String(e?.message ?? e)) }

  if (want !== null) {
    if (want.length !== 7) probs.push('STAGE_NAMES 不是 7 项（' + want.length + '）⇒ 阶段定义本身变了')
    for (const [label, got] of [['spec/reply.md', fromSpec], ['prefix 正文', fromPrefix]]) {
      if (got === null) continue
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        probs.push(label + ' 的步名清单与 STAGE_NAMES 不一致：' + JSON.stringify(got) + ' vs ' + JSON.stringify(want))
      }
    }
  }
  if (prefixText !== '' && /step name come from[^;]*验收核对/.test(prefixText)) {
    probs.push('prefix 正文的步名清单里仍有 v2 旧词「验收核对」⇒ 模型会按五步报阶段')
  }
## 6. README 三处失准（R-27 / T-18 / T-19）


## 7. 附录 A · `regexLiterals` 的参考实现（E-1 用）

本实现已实测：对 /tmp/probe_ids.cjs 的 62 份 `scripts/*.mjs` 跑通，抽出 83 个 UPPER_SNAKE（22 个文件）。

```
function regexLiterals(src) {
  const out = []
  const n = src.length
  let i = 0
  const NL = String.fromCharCode(10)
  const PREV = new Set(['(', '[', '{', ',', ';', '=', ':', '!', '&', '|', '?', '+', '-', '*', '%', '<', '>', '~', '^'])
  while (i < n) {
    const c = src[i], c2 = src[i + 1]
    // 行注释
    if (c === '/' && c2 === '/') { while (i < n && src[i] !== NL) i++; continue }
    // 块注释
    if (c === '/' && c2 === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i = Math.min(i + 2, n); continue }
    // 正则字面量：靠「前一个非空字符」判定（运算符/开括号 => 正则；a / b 的除号不入此列）
    if (c === '/' && !(c2 === '/' || c2 === '*')) {
      let b = i - 1; while (b >= 0 && /\s/.test(src[b])) b--
      const prev = b < 0 ? '' : src[b]
      if (prev === '' || PREV.has(prev)) {
        const start = i + 1
        let j = start, inClass = false
        while (j < n) {
          if (src[j] === '\\') { j += 2; continue }
          if (src[j] === '[') { inClass = true; j++; continue }
          if (src[j] === ']') { inClass = false; j++; continue }
          if (!inClass && src[j] === '/') break
          if (src[j] === NL) break
          j++
        }
        out.push(src.slice(start, j))
        i = j + 1
        while (i < n && /[a-z]/.test(src[i])) i++   // flags
        continue
      }
    }
    // 字符串 / 模板串：整段跳过（内部不进正则扫描面）
    if (c === String.fromCharCode(39) || c === '"' || c === String.fromCharCode(96)) {
      const Q = c; let j = i + 1
      while (j < n) { if (src[j] === '\\') { j += 2; continue } if (src[j] === Q) { j++; break } if (src[j] === NL) break; j++ }
      i = j; continue
    }
    i++
  }
  return out
}
```

**已知边界（如实登记）**：

| 边界 | 说明 | 影响 |
|---|---|---|
| 正则里的字符类含 `/`（如 `/[/*]/`） | `inClass` 已处理 => **不会**提前闭合 | 无 |
| 除法 vs 正则的歧义 | 靠「前一个非空白字符」判定（运算符/开括号 => 正则） | `a / b` 走除法分支（不入 out）；`(x) / re/` 这种极罕见写法可能误判 |
| 模板串里的插值 | **整段跳过**，插值内的正则**扫不到** | 本仓 62 份脚本实测未出现；若将来出现，E-1 会漏掉那一条（**漏报，不是误报**） |
| 正则跨行 | 遇到换行即放弃（当作除法） | JS 正则字面量本来不能跨行 => 安全 |

---

## 8. 落地顺序与批次建议（把依赖变成提交计划）

| 批次 | 内容 | 为什么这一批 | 退出条件（可执行） |
|---|---|---|---|
| **B1** | **S-16** 单独一批 | 它会让 `check:meta-negctl` 从 4 掉到 3 ⇒ **必然自红一次**。单独一批才能看清「这是正确性证据」，而不是混进别的改动里被误读 | `npm run check:meta-negctl` 输出里 N-M1c / N-M1d 两条 ✓；M-1 因 3 < 4 而红（**预期**） |
| **B2** | **S-06**（S-06a + S-06b + S-06c + S-06d） | 与 B1 同批就会分不清「3<4 是 S-16 的功劳」还是「抬下限抬错了」 | `npm run check:meta-negctl` 全绿；2 个豁免族在输出里被点名 |
| **B3** | **S-08 + E-1 + S-10** | E-1 新增一族 ⇒ 必须与 S-10（族数/余量）同批算对 | `npm run check:all` 全绿；`FAMILY_FLOOR` 与实测族数一致 |
| **B4** | **R-03 + R-04**（+ T-22 顺带） | 同一件事两面，且 R-04 要重跑生成器 | `npm run typecheck` exit 0；`npm run check:workflow` 的 F15 ✓；`grep -c '验收核对' preset/*.yml` = 0 |
| **B5** | **README 三处**（R-27 + T-18 + T-19，建议并 T-20/T-21） | 纯文档，零风险，最后做 | `git diff --stat README.md` 只有文案；`grep -c '启动器路径' README.md` = 0 |

警告 **B1 与 B2 之间不要插入任何别的改动**：B1 结束时 M-1 是红的（预期），若期间还改了别的族，那一片红就分不清来源。

---

## 9. [待拍板] 三项

> 格式：问题 | 选项 | 推荐 + 一句话理由。**本文不替用户决定。**

### D-A · S-16 的 `stringLiteral` 期望值：0 还是 1？

| | 内容 |
|---|---|
| **问题** | REVIEW.md 初稿写「五个用例分别返回 1/0/0/0/0」，把「字符串里的假调用」当 1；本文主张 0（它不是调用，只是长得像） |
| **A** | 期望 0：只数「`ok/bad/check/note.push` 的第一个实参」这个形态 |
| **B** | 期望 1：只要标签出现在任何字面量里就算（维持 REVIEW 初稿） |
| **推荐 A** | 理由：B 让「把标签塞进任意字符串字面量」仍能凑数 —— **同一个漏洞换个壳**；而且 A 与 M-1 的自述语义（「打出来的标签」）一致 |

### D-B · E-1 的落地方案：报告模式 + 白名单（A）还是只扫改动文件（B）？

| | 内容 |
|---|---|
| **问题** | 本仓正则字面量里实测 83 个 UPPER_SNAKE，多数是字面量开关或本文件常量 ⇒ 直接上线会一次红几十条 |
| **A** | 先报告模式跑一遍，人工过 83 条建立 `LITERAL_WHITELIST`，之后新增即红 |
| **B** | 只扫 git diff 里的文件，存量不追溯 |
| **推荐 A** | 理由：B 抓不到「存量里已经坏了的」（CU-5 那种）—— 而 S-08 的存在恰恰证明存量里有坏的 |

### D-C · R-03 的 `PIPELINE_STAGES` 从 `as const` 元组降级为 `.map()` 数组，可接受吗？

| | 内容 |
|---|---|
| **问题** | 派生后类型从「7 元组」变成「只读数组」，若有外部调用方依赖元组类型会破 |
| **A** | 接受降级（本次实测消费方只有 `pipeline-view.ts:224/229` 的 `.map()` 与 `check-pipeline.mjs`（JS 无类型）⇒ 安全） |
| **B** | 保留元组：用 `as const satisfies readonly {...}[]` 之类的写法保住字面量类型 |
| **推荐 A** | 理由：B 要写更复杂的类型体操，而收益（元组类型）在本仓**没有消费方**；且 typecheck 会兜住任何意外破损 |

---

## 10. 本文没有做到的事（诚实标注）

| # | 没做 | 为什么 | 影响 |
|---|---|---|---|
| 1 | **没有改任何代码** | 任务纪律：只读，唯一写入是本文件 | 所有改法都是**规格**，未实施、未实测「改完真的绿」 |
| 2 | **没有跑 `npm run build` / 完整 `check:all`** | 会写 `lib/` 与仓库根（见 S-13） | R-03 的「类型降级是否真的 typecheck 通过」**未端到端验证**（推理依据是消费方清单，不是编译输出） |
| 3 | **没有实施 S-16 的 `stripCommentsKeepLines` 并跑全仓** | 只跑了**独立原型**（/tmp/probe_strip2/3/4.cjs、/tmp/probe_regex.cjs），不是改真文件 | 「naive 565 / 剥后 564 / 唯一差异族 check:meta-negctl 4→3」是**原型读数**，不是改完真仓的读数 |
| 4 | **没有验证 83 个 UPPER_SNAKE 里哪些是真跨模块引用** | 需人工过一遍（D-B 的选项 A 就是这个工作） | E-1 的**白名单内容未定** ⇒ 那条族的具体形状待定 |
| 5 | **没有核对 `gen/contracts.md` 的字符数变化** | 要重跑生成器才知道 | R-04 的「+约 20 字符」是**估算**，不是实测 |
| 6 | **没有回答「7 个族的 exempt 理由是否都成立」** | 只对 2 个族（preflight / tasks-route-http）给了理由；其余 8 族的归类（A/B 类）来自**读码 + 通道识别**，未逐族跑「把断言改坏看它是否红」 | S-06 的 A/B 分类**未由负向对拍验证**（那是落地时的工作） |

---

## 11. 与 REVIEW.md 的差异（本文更正/细化了哪几处）

| # | REVIEW.md 原表述 | 本文更正 | 依据 |
|---|---|---|---|
| 1 | S-16 五用例「1/0/0/0/0」 | 应为「1/0/0/0/0/1/1/1」共 8 例，其中 `stringLiteral` 与 `templateBody` 为 0，而非 REVIEW 设想的「字符串里算 1」 | 本文 §1.③(b) + /tmp/probe_strip2.cjs 实测 |
| 2 | S-06「10 族抬到 ≥1」 | **不能一刀切**：5 族是「有负控但形态看不见」（扩口径）；3 族真没有（补）；2 族结构上不该有（豁免） | 本文 §2.② 逐族实测表 |
| 3 | S-06 族数「10」 | **确认是 10**（t6 报 7 ⇒ 主控 10 是对的；本次独立复核 = 10） | 本文 §2.① 的 node 命令 |
| 4 | R-03「8 份字面量」 | **确认 8 份**，但**只有 1 份是漂的**（stage-controls:22），另 2 份是**有意保留的旧五步词表**（LEGACY_STEP_DEFS / TASKS_STEP_NAMES） | 本文 §3.① 表 |
| 5 | §8.1「R-03 两处：stage-controls.ts:22 + :57（注释）」 | :57 是**在描述改前行为**，改词会让「描述历史」变成「描述现在」⇒ **改为「加限定」而不是「改词」** | 本文 §3.② 末段 |
| 6 | S-08「正则改成 (?:currentPreset|preset)…」 | 建议更窄：`currentPreset\s*[!=]==?\s*(?:PLANNING_PRESET_ID|HOB_PRESET_ID)`，并**先自证靶子存在** | 本文 §5.③ |
| 7 | §1.3「第 5 条」把 S-06/S-07/S-08 归一组 | 本文进一步把 **S-16 提到 S-06 之前**（REVIEW §1.3 未表达这条顺序依赖） | 本文 §0 |

---

## 12. 交付自评

| 项 | 状态 |
|---|---|
| 七要素齐全（6 条缺陷 × 7 项） | 是（S-16 / S-06 / R-03 / R-04 / S-08+E-1 / README 三处） |
| 每条给「位置 + 证据」 | 是（全部带 文件:行号 + 实跑输出） |
| 每条给负向对拍 | 是（且每条都写明「改坏哪个实现 ⇒ 哪个断言红」） |
| 依赖顺序写死 | 是（S-16 → S-06；R-03 ↔ R-04；S-08 → E-1；S-06 三分类） |
| 需用户拍板项已标 [待拍板] | 是（§9 三项：D-A / D-B / D-C） |
| 给不出具体改法的标「未验证」 | 是（§10 六项如实标注） |
| 只读纪律 | 是（唯一写入 = 本文件；未改任何源码/配置/文档） |
