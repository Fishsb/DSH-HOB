/**
 * **账本目录**（纯函数，零 I/O）。
 *
 * 它回答一件事：`ledgerHome` 下有哪些账本、每个有多少单元、哪个是当前会话的。
 *
 * ── 为什么要有它（2026-11-07 · `R-020`）────────────────────────────────
 *   用户要求「任务进度」面板展示**所有项目**并可切换。这里的"项目"就是
 *   `<ledgerHome>/<name>` 一个目录 —— ⛔ 不反查工作区路径，账本名即项目名。
 *
 * ── 三条硬约束 ──────────────────────────────────────────────────────────
 *   ① **只读**：只接收已读好的目录项与计数，⛔ 不碰 fs；
 *   ② **不聚合**：⛔ 不产出"全部项目合计 N 单元" —— 两本不相干的账相加没有意义；
 *   ③ **判不出就说判不出**：读不了的账本标 `readable: false`，⛔ 不当 0。
 */

/** 一个账本的目录项（⚠ 名字只允许单段目录名）。 */
/** A backup/history directory is not an active project that needs migration. */
export function isBackupLedgerName(name: string): boolean {
  return /\.(?:backup|bak)(?:-|$)|(?:^|-)backup(?:-|$)|before-ledger-contract/i.test(name)
}

export interface LedgerEntry {
  /** 账本目录名（= 项目名）。 */
  name: string
  /** 单元数；`readable: false` 时该值无意义。 */
  units: number
  /**
   * 三态：有数据 / 空骨架 / 读不了。
   * ⚠ `empty` 与 `unreadable` 不是一回事：前者是查过、确实没有单元；后者是没有读数。
   */
  state: 'data' | 'empty' | 'unreadable'
  /** 能否读到 `ledger/units/`；false ⇒ 该账本不可用（⛔ 不等于空账本）。 */
  readable: boolean
  /** 是否为本会话工作区对应的那本。 */
  current: boolean
  /**
   * Project-level freshness readout. It deliberately separates "the ledger is
   * structurally readable" from "it still needs a v3 pipeline migration".
   */
  health?: 'current' | 'outdated' | 'unreadable' | 'empty' | 'backup'
  /** Counts for the readout; 0 is a real count, undefined means undecidable. */
  v3Units?: number
  legacyUnits?: number
}

export interface LedgerCatalog {
  /** 账本父目录（回显用；⛔ 不参与任何路径拼接）。 */
  home: string
  /** 有数据的在前（按名升序），空项目在后（按名升序）。 */
  items: LedgerEntry[]
  /** 是否找到了本会话对应的账本。false ⇒ 面板要显示一行说明。 */
  currentResolved: boolean
  /** Optional project-level summary; absent means the catalog could not decide. */
  summary?: {
    current: number
    outdated: number
    empty: number
    unreadable: number
    backup: number
  }
}

/**
 * 校验一个账本名是否安全。
 *
 * ⚠ 这是**安全边界**，不是可选项：没有它，构造 `../` 就能读到账本区外。
 * ⛔ 只允许单段目录名；⛔ 拒绝空串、`.`、`..`、含 `/` `\` 或绝对路径。
 */
export function isSafeLedgerName(name: unknown): name is string {
  if (typeof name !== 'string') return false
  const n = name.trim()
  if (n === '' || n === '.' || n === '..') return false
  if (n.includes('/') || n.includes('\\') || n.includes('\0')) return false
  if (n.startsWith('.')) return false
  /**
   * ⚠ 单段目录名，允许 Unicode（中文项目名是真实需求）。
   * 拒绝控制字符与路径分隔符；其余交给目录存在性白名单兜底。
   */
  return !/[\u0000-\u001f\u007f]/.test(n)
}

/**
 * 把原始目录项整理成面板要的目录。
 *
 * @param home - 账本父目录（仅回显）
 * @param raw - 原始项：`name` + `units` + `state`（或兼容的 `readable`）
 * @param currentName - 本会话工作区对应的账本名（判不出则 `undefined`）
 */
export function buildLedgerCatalog(
  home: string,
  raw: ReadonlyArray<{
    name: string
    units: number
    state?: 'data' | 'empty' | 'unreadable'
    readable?: boolean
    health?: 'current' | 'outdated' | 'unreadable' | 'empty' | 'backup'
    v3Units?: number
    legacyUnits?: number
  }>,
  currentName: string | undefined,
): LedgerCatalog {
  const safe = raw
    .filter((x) => isSafeLedgerName(x.name))
    .map((x) => {
      const state = x.state ?? (x.readable === true ? (x.units > 0 ? 'data' : 'empty') : 'unreadable')
      const health = x.health ?? (state === 'unreadable' ? 'unreadable' : state === 'empty' ? 'empty' : undefined)
      const effectiveHealth = isBackupLedgerName(x.name) ? 'backup' as const : health
      return {
        name: x.name.trim(),
        units: Number.isFinite(x.units) && x.units >= 0 ? Math.floor(x.units) : 0,
        state,
        readable: state !== 'unreadable',
        current: false,
        ...(effectiveHealth === undefined ? {} : { health: effectiveHealth }),
        ...(x.v3Units === undefined ? {} : { v3Units: x.v3Units }),
        ...(x.legacyUnits === undefined ? {} : { legacyUnits: x.legacyUnits }),
      }
    })
  // ⚠ 同名去重（目录列举理论上不会重，但外部注入可能给重名；保留首见）。
  const seen = new Set<string>()
  const deduped = safe.filter((x) => (seen.has(x.name) ? false : (seen.add(x.name), true)))
  const cur = typeof currentName === 'string' && isSafeLedgerName(currentName) ? currentName.trim() : undefined
  const currentResolved = cur !== undefined && deduped.some((x) => x.name === cur)
  for (const x of deduped) x.current = cur !== undefined && x.name === cur
  /**
   * 排序：有数据（readable 且 units > 0）在前，其余在后；段内按名升序。
   * ⚠ 不用 mtime：同一份账在不同时刻会排出不同顺序。
   */
  const rank = (x: { state: string }): number => (x.state === 'data' ? 0 : x.state === 'empty' ? 1 : 2)
  deduped.sort((a, b) => (rank(a) - rank(b)) || a.name.localeCompare(b.name, 'en'))
  const summary = deduped.every((x) => x.health !== undefined)
    ? {
        current: deduped.filter((x) => x.health === 'current').length,
        outdated: deduped.filter((x) => x.health === 'outdated').length,
        empty: deduped.filter((x) => x.health === 'empty').length,
        unreadable: deduped.filter((x) => x.health === 'unreadable').length,
        backup: deduped.filter((x) => x.health === 'backup').length,
      }
    : undefined
  return { home, items: deduped, currentResolved, ...(summary === undefined ? {} : { summary }) }
}

/**
 * 从目录里挑出默认选中的账本。
 *
 * 规则（按顺序）：
 *   ① 本会话工作区对应的那本（若在列表里）；
 *   ② 第一个有数据的；
 *   ③ 第一个。
 * 都没有 ⇒ `undefined`（面板显示"没有任何账本"）。
 */
export function defaultLedgerOf(catalog: LedgerCatalog): string | undefined {
  const cur = catalog.items.find((x) => x.current)
  if (cur !== undefined) return cur.name
  const firstWithData = catalog.items.find((x) => x.state === 'data')
  if (firstWithData !== undefined) return firstWithData.name
  const firstEmpty = catalog.items.find((x) => x.state === 'empty')
  if (firstEmpty !== undefined) return firstEmpty.name
  return catalog.items[0]?.name
}

/**
 * 把客户端传来的 `ledger` 参数解析成**账本根**（唯一安全入口）。
 *
 * ⚠ 这是**安全边界**：⛔ 不接受路径，只接受 `ledgerHome` 下**真实存在**的单段目录名。
 * ⛔ 拒绝 `/` `\` `..` `.` 与绝对路径；⛔ 拒绝不在白名单里的名字。
 *
 * @param home - 账本父目录（`declaredLedgerHome()`）
 * @param requested - 客户端传来的账本名（可能为空）
 * @param exists - 目录存在性判定（注入，便于机检）
 * @returns 解析成功给绝对路径；判不出 / 不安全给 `undefined`
 */
export function resolveLedgerByName(
  home: string,
  requested: unknown,
  exists: (abs: string) => boolean,
): string | undefined {
  if (home.trim() === '') return undefined
  if (!isSafeLedgerName(requested)) return undefined
  const abs = joinPath(home.trim(), requested.trim())
  return exists(abs) ? abs : undefined
}

/** 平台无关的路径拼接（⚠ 不 import node:path，保持本模块可在 client 半边加载）。 */
function joinPath(a: string, b: string): string {
  const sep = a.includes('\\') && !a.includes('/') ? '\\' : '/'
  return a.endsWith(sep) ? `${a}${b}` : `${a}${sep}${b}`
}
