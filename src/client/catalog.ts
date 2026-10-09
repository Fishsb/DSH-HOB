/**
 * 「新建会话默认」的**候选来源**（Client 半边）—— 宿主预设清单 + 宿主模型目录。
 *
 * ── 数据从哪来（**不自造 RPC**）────────────────────────────────────────
 *   两条都是宿主既有 Remote 命名空间（`ctx.remote.*`，经 `@deepseek-ai/dsh-api-remotes`
 *   的客户端半边挂载），本插件**只读**、不新增任何路由：
 *     · 预设清单 ← `ctx.remote.agentPresets.list()`（宿主 `dsh-agent-preset-registry`）
 *     · 模型目录 ← `ctx.remote.session.modelCatalog()`（宿主 `dsh-api-session-controller`）
 *   两条的返回形状都按宿主 client 的原生用法消费（对照
 *   `dsh-client-ui-agent-preset/lib/client.js:1082` 与
 *   `dsh-client-ui-model-selection/lib/client.js:118`），**不使用**未在
 *   宿主 `dsh.client` 声明里出现的字段。
 *
 * ── 三条纪律（都是本项目实测过的形态）──────────────────────────────────
 *   ① **不许把 promise 内联进渲染回调**：本文件把加载收敛成**一次**外部存储
 *      （`useSyncExternalStore` 消费）—— 内联 promise 会被 `useEffect` 依赖捕获成
 *      自持循环（旧项目实测 8 秒 13420 次请求，见 `settings-panel.tsx` 文件头）。
 *   ② **react 被动等**：`apply` 阶段 ctx 已就绪，但 `remote` 命名空间可能稍后挂载
 *      ⇒ 首次读取失败是**正常状态**，如实记为 `error`，允许用户点重试；
 *      **不静默当成空列表**（那会让"加载失败"看起来像"宿主里一个预设都没有"）。
 *   ③ **broken 不静默过滤**：宿主自己的选择器会滤掉 `broken` 的预设
 *      （`presetOptions()` 只留 `broken === undefined`）—— 本项目**反其道而行**：
 *      如实列出并标"不可用"（E-46 的教训：静默过滤让用户以为预设不存在）。
 */
import type { ReactNode } from 'react'

/** 宿主预设清单里的一行（只取本面板用到的字段）。 */
export interface PresetRow {
  id: string
  name?: string
  description?: string
  /** 非空 = 该预设当前**不可用**（宿主给的原因）。**不隐藏**。 */
  broken?: string
  /** 宿主标记的默认预设（会话不点名时用它）。 */
  isDefault?: boolean
}

/** 模型目录里一个思考档位。 */
export interface EffortRow {
  id: string
  name: string
  description?: string
}

/** 模型目录里一个模型。 */
export interface ModelRow {
  id: string
  name: string
  description?: string
  /** 有 `efforts` 才呈现档位选择；没有就**不留空旋钮**。 */
  reasoning?: {
    efforts: EffortRow[]
    defaultEffort?: string
  }
}

/** 模型目录里一个 provider 分组。 */
export interface ProviderGroupRow {
  id: string
  name: string
  models: ModelRow[]
}

/** 模型目录的整体形状（宿主 `session.modelCatalog` 的返回子集）。 */
export interface ModelCatalogRow {
  default: { provider: string; model: string; reasoningEffort?: string }
  groups: ProviderGroupRow[]
  failures: { id: string; name: string; message: string }[]
}

/** 外部存储的快照（**稳定引用**，只在内容变化时替换）。 */
export interface CatalogSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'error'
  presets: PresetRow[]
  catalog: ModelCatalogRow | null
  /** 读取失败的原因（**如实显示**，不吞）。 */
  error: string | null
}

let ctxRef: any
let snapshot: CatalogSnapshot = { status: 'idle', presets: [], catalog: null, error: null }
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

/** 登记 client 的 cordis context（`apply` 里调一次）。 */
export function setCatalogContext(ctx: any): void {
  ctxRef = ctx
}

/** `useSyncExternalStore` 的 getSnapshot —— 返回**稳定引用**。 */
export function getCatalogSnapshot(): CatalogSnapshot {
  return snapshot
}

/** `useSyncExternalStore` 的 subscribe。 */
export function subscribeCatalog(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function update(next: Partial<CatalogSnapshot>): void {
  snapshot = { ...snapshot, ...next }
  for (const fn of listeners) fn()
}

/** 读宿主 Remote 命名空间（**免 inject**：`ctx.get` 不要求先声明依赖）。 */
function remoteOf(): any {
  if (ctxRef === undefined) return undefined
  try {
    return typeof ctxRef.get === 'function' ? ctxRef.get('remote') : ctxRef.remote
  } catch {
    return undefined
  }
}

/** 把一次 Remote 调用结果归一成"值或错误消息"（**不静默吞错**）。 */
function unwrap(response: any): { ok: true; value: any } | { ok: false; message: string } {
  if (response === undefined || response === null) return { ok: false, message: '宿主未返回结果（命名空间可能尚未挂载）' }
  if (response.ok === true) return { ok: true, value: response.value }
  const code = response.error?.code ?? 'unknown'
  const message = response.error?.message ?? String(response)
  return { ok: false, message: `${code}: ${message}` }
}

/**
 * 加载（或重试）候选。
 *
 * ⚠ **并发去重**：`inflight` 是"已有一次在飞"的闸门 —— 面板渲染 + 用户点重试
 *   同时触发时**只发一次**（与宿主 `ModelCatalogDirectory.load()` 同一手法）。
 * ⚠ **失败也必须落定**：任一读取失败 ⇒ `status='error'` + `error` 文本，
 *   **不会被当成空清单**（见文件头纪律 ②）。
 */
export function loadCatalog(): Promise<void> {
  if (inflight !== null) return inflight
  update({ status: 'loading', error: null })
  inflight = (async () => {
    const remote = remoteOf()
    if (remote === undefined) {
      update({ status: 'error', error: '宿主 remote 服务未就绪（页面加载中或服务未挂载）' })
      return
    }
    try {
      const presetResult = unwrap(await remote.agentPresets.list())
      if (!presetResult.ok) {
        update({ status: 'error', error: `预设清单读取失败 —— ${presetResult.message}` })
        return
      }
      const catalogResult = unwrap(await remote.session.modelCatalog())
      if (!catalogResult.ok) {
        update({ status: 'error', error: `模型目录读取失败 —— ${catalogResult.message}` })
        return
      }
      const rows: PresetRow[] = Array.isArray(presetResult.value?.presets) ? presetResult.value.presets : []
      // ⚠ **刻意不过滤 `broken`**（见文件头纪律 ③）：原样带出去，由面板标"不可用"。
      update({
        status: 'ready',
        error: null,
        presets: rows.map((r: any) => ({
          id: String(r?.id ?? ''),
          ...(typeof r?.name === 'string' ? { name: r.name } : {}),
          ...(typeof r?.description === 'string' ? { description: r.description } : {}),
          ...(typeof r?.broken === 'string' ? { broken: r.broken } : {}),
          ...(r?.isDefault === true ? { isDefault: true } : {}),
        })).filter((r) => r.id !== ''),
        catalog: normalizeCatalog(catalogResult.value),
      })
    } catch (e) {
      // 抛异常与"返回失败"同级处理：都如实记成 error。
      update({ status: 'error', error: `候选读取异常 —— ${String((e as Error)?.message ?? e)}` })
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** 宿主目录 → 本面板的最小形状（**逐字段**取，避免依赖未声明字段）。 */
function normalizeCatalog(value: any): ModelCatalogRow {
  const groups: ProviderGroupRow[] = Array.isArray(value?.groups)
    ? value.groups.map((g: any) => ({
        id: String(g?.id ?? ''),
        name: String(g?.name ?? g?.id ?? ''),
        models: Array.isArray(g?.models)
          ? g.models.map((m: any) => ({
              id: String(m?.id ?? ''),
              name: String(m?.name ?? m?.id ?? ''),
              ...(typeof m?.description === 'string' ? { description: m.description } : {}),
              ...(m?.reasoning !== undefined && m.reasoning !== null
                ? {
                    reasoning: {
                      efforts: Array.isArray(m.reasoning.efforts)
                        ? m.reasoning.efforts.map((e: any) => ({
                            id: String(e?.id ?? ''),
                            name: String(e?.name ?? e?.id ?? ''),
                            ...(typeof e?.description === 'string' ? { description: e.description } : {}),
                          })).filter((e: EffortRow) => e.id !== '')
                        : [],
                      ...(typeof m.reasoning.defaultEffort === 'string'
                        ? { defaultEffort: m.reasoning.defaultEffort }
                        : {}),
                    },
                  }
                : {}),
            })).filter((m: ModelRow) => m.id !== '')
          : [],
      })).filter((g: ProviderGroupRow) => g.id !== '' && g.models.length > 0)
    : []
  return {
    default: {
      provider: String(value?.default?.provider ?? ''),
      model: String(value?.default?.model ?? ''),
      ...(typeof value?.default?.reasoningEffort === 'string'
        ? { reasoningEffort: value.default.reasoningEffort }
        : {}),
    },
    groups,
    failures: Array.isArray(value?.failures)
      ? value.failures.map((f: any) => ({
          id: String(f?.id ?? ''),
          name: String(f?.name ?? f?.id ?? ''),
          message: String(f?.message ?? ''),
        }))
      : [],
  }
}

/** 在目录里找一个模型（找不到返回 `undefined` ⇒ 面板标"不可用"）。 */
export function findModel(catalog: ModelCatalogRow | null, provider: string, model: string): ModelRow | undefined {
  if (catalog === null) return undefined
  for (const g of catalog.groups) {
    if (g.id !== provider) continue
    for (const m of g.models) if (m.id === model) return m
  }
  return undefined
}

/** 预先在预设清单里找一个预设。 */
export function findPreset(presets: PresetRow[], id: string): PresetRow | undefined {
  return presets.find((p) => p.id === id)
}

/** 供面板渲染的"空"占位类型（只用于类型收窄）。 */
export type CatalogNode = ReactNode
