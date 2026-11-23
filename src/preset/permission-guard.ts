/**
 * **单调权限哨兵**（2026-11-23 · A·拆分，自 `preset/tools.ts` 原样搬出）。
 *
 * ⚠ 三条硬性纪律逐字保留：
 *   ① **先判名短路**（名单外立即放行，先于一切可能抛的代码）；
 *   ② 名单内判定体包 try/catch；③ 异常**收敛到拒**、⛔ 不 throw（抛会把宿主 fail-closed、连账本工具一起拒）。
 * ⛔ 名单只增不减的语义不变；本模块只负责守卫，不注册工具、不改写面。
 *
 * @module preset/permission-guard
 */
import { PERMISSION_TIERS } from './permission-tiers.ts'

/**
 * 三档里**一律不许出现**的名字（共享禁项）。
 *
 * ⚠ 这份清单的**来源是实测**（第 144 轮全机扫描，见 `REPORT-R148.md`）：
 *   全机只有这 5 个写类 / 命令类工具名，出自 5 个包
 *   （`dsh-tool-fs` → `write`/`edit`；`dsh-tool-bash`/`-persistent` → `bash`；
 *    `dsh-tool-pwsh`/`-persistent` → `pwsh`；`dsh-tool-str-replace-editor` → `str_replace_editor`）。
 *   ⛔ **不许凭记忆**增减 —— 将来新装插件带进新的写类名字时，**应当把它加进来**，
 *     这也正是 ⑤m-4 要盯的那件事。
 */

export const SHARED_FORBIDDEN_TOOLS: readonly string[] = [
  'write',
  'edit',
  'bash',
  'pwsh',
  'str_replace_editor',
]

/**
 * 哨兵**要罩**的名字（写类 / 命令类 + 两个范围可变的读工具）。
 *
 * ⚠ 罩的范围**刻意最小**：账本两件（`read_contracts` / `write_hob`）与编排七件
 *   **一律不罩** —— 哨兵自己出问题时，账本与编排**必须照常**（实测反例：
 *   裸哨兵抛异常会把 `read_contracts` 一起弄瘫，见 `REPORT-R147.md` §c-3）。
 */
export const GUARDED_TOOLS: readonly string[] = [
  ...SHARED_FORBIDDEN_TOOLS,
  'hob_read_doc',
  'hob_glob',
  'hob_grep',
  'hob_read_image',
]

/** 从 exec 里取「被请求的路径」参数（档 2 只许 .md 的哨兵用；判不出 ⇒ undefined）。 */
function readPathArg(exec: any): string | undefined {
  try {
    const args = exec?.arguments ?? exec?.args
    if (args === null || typeof args !== 'object') return undefined
    for (const key of ['path', 'file_path', 'file']) {
      const v = (args as Record<string, unknown>)[key]
      if (typeof v === 'string') return v
    }
    return undefined
  } catch {
    return undefined
  }
}

export function installPermissionGuard(
  ctx: any,
  levelOf: (sessionOrAgent?: any) => string,
  log: (m: string) => void,
  /** ⚠ 2026-10-24：同 `filterModelToolList` 的 `visibleNamesFor`（唯一收口点）。 */
  visibleNamesFor: (names: readonly string[]) => readonly string[] = (n) => n,
): void {
  const guarded = new Set<string>(GUARDED_TOOLS)
  const forbidden = new Set<string>(SHARED_FORBIDDEN_TOOLS)

  ctx.effect(() => ctx.tools.guard((exec: any): string | undefined => {
    // ── 硬性①：**先判名短路**（名单外一律放行；先于一切可能抛的代码）──────
    const name = exec?.name
    if (typeof name !== 'string' || name === '') return undefined
    if (!guarded.has(name)) return undefined

    // ── 名单内：判定体包 try/catch（硬性②），异常收敛到"拒"（硬性③：不 throw）
    try {
      // 写类 / 命令类：**任何一档**都不许执行。
      // ⚠ 它们本不该到达这里（注册面不存在 ⇒ 大概率是 `unknown tool`）——
      //   但"到达不了"这个判断**依赖声明面**（别人改 profile 就失效，见 ⑤m-6）
      //   ⇒ 本层作为**第二道**，宁拒不放。
      if (forbidden.has(name)) {
        return `"${name}" cannot change anything in this session: this preset has no write-capable tools.`
      }

      // 读工具：名字本身没问题（白名单已筛过），此处只兜住"参数越界"。
      // ⚠ 参数检查交给工具自己的 `execute`（它返回可读的拒绝文本）；
      //   本哨兵在这里**只确认"这个档位看得见它"** —— 因为 guard 是按**调用名**
      //   生效的，而档位可能在会话中途**变窄**（workspace ⇒ ledger）：
      //   变窄后**已发出的调用**不该还能落地。
      //
      // ⚠⚠ **2026-10-22 · `REQ-04`：主体改为 `exec.agent`（按会话判）。**
      //   ⚠ 没有 agent ⇒ `levelOf(undefined)` ⇒ **最低档**（fail-closed）。
      //   ⚠ 但**这一层不是唯一防线**：宿主在 `exec.agent === undefined` 时**根本不遍历
      //     scope 链**（`dsh-tools/lib/index.js:3024-3032`，`:3027` 是那句提前返回）
      //     ⇒ 那种调用路径下本哨兵**压根不会被调**。⇒ 四个读工具的 `execute`
      //     自己必须再核一次档位（见 `src/modules/tools.ts`；这是本轮 G-5 的落点）。
      const level = levelOf(exec?.agent)
      const tier = PERMISSION_TIERS[level as 'ledger' | 'project' | 'workspace'] ?? PERMISSION_TIERS.ledger
      /**
       * ⚠⚠ **2026-10-24：哨兵也过 `visibleNamesFor`**（三处口径必须同一份）。
       *   ⚠ 门禁在 ⇒ 原样返回 ⇒ 哨兵行为零变化；门禁不在 ⇒ 门禁拥有的那批名字由门禁负责的
       *     注册面本来就不存在，哨兵不该把它们算作"这一档可读"。
       */
      const names = visibleNamesFor(tier)
      if (!names.includes(name)) {
        return `"${name}" is not available at the current readable-permission level (${level}).`
      }

      // ── **类型规则：只在档2**（2026-10-14 第 145 轮 · 用户裁定「档3的都加」）──
      //   · **档2 `project`**：只许 `.md` —— 用户原话「档2不给」「不可以读代码」；
      //   · **档3 `workspace`**：**不设类型规则**（任意文件都可读可看）
      //     ⇒ 这一档只剩**包含性 + 软链**，它们由工具自己的 `execute` 守
      //       （`workspace-read.ts` 的 `resolveGuarded`，复用 `doc-read.ts` 的同一份实现）。
      //   ⚠ 哨兵**只看扩展名**（可判、不猜内容）：内容层面的"文本 / 二进制 / 图片"
      //     三态由 `hob_read_doc` 的 `execute` 决定怎么回（短提示 / 提示改用图片工具）。
      //     哨兵在这里的职责是**权限**（档2 不许读非 `.md`），不是**呈现**。
      if (level === 'project') {
        const requested = readPathArg(exec)
        if (typeof requested === 'string' && requested.trim() !== '') {
          const lower = requested.trim().toLowerCase()
          if (!lower.endsWith('.md')) {
            return `"${requested}" is not available at the document-permission level: this level reads only .md documents.`
          }
        }
      }
      return undefined
    } catch (e) {
      // 硬性②③：哨兵自身出问题 ⇒ 收敛到**拒**（安全的一侧），且**不往外抛**。
      // ⚠ 实测：抛异常会让宿主 fail-closed ⇒ **连账本工具一起拒**（Hob 瘫）。
      log('权限哨兵异常（收敛为拒）：' + String((e as Error)?.message ?? e))
      return 'the permission guard failed internally; this call was refused rather than allowed.'
    }
  }), 'dsh-hob preset: monotonic permission guard')

  log('已挂单调权限哨兵（名册 ' + GUARDED_TOOLS.length + ' 个；名单外一律放行）')
}
