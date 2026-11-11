/**
 * tsdown 构建配置：把 src/client/ 编译成 DSH 的浏览器模块格式。
 *
 * 产物 `lib/client.js` 必须包在 `window.__ModuleLoader__.load({ id, factory })`
 * 外壳里 —— 这是 DSH client 模块表的注册契约。
 *
 * React 与 DSH 平台模块不打包（external）：运行时由浏览器模块表按
 * `require('react')` / `require('@deepseek-ai/dsh-client-ui-slots')` 提供。
 *
 * ⚠ 必须走 `external` 而不是 `deps.neverBundle`：用 neverBundle 时 react 仍被
 *   整包打进来 ⇒ 页面里出现第二份 React ⇒ hooks 直接崩（旧项目实测）。
 *
 * ⚠ `@deepseek-ai/dsh-client-ui-primitives` 是**平台 seed**，必须 external：
 *   实测浏览器模块表的 seed 含它（`__dshSidebarModuleSystem__.seed`），
 *   loader 的 `makeRequire` 会先命中 seed，拿到宿主那一份。
 *   ⚠ 面板自身的两个纯展示原子已改到本仓 `src/client/atoms.tsx`（更轻），
 *     但设置面板仍使用宿主的 Menu / SegmentedControl / 图标，故本包继续 external。
 */
import type { UserConfig } from 'tsdown'

const PLUGIN_ID = 'dsh-hob'

const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

/**
 * 对外产物里**⛔ 不留源码正文**：把 `.map` 的 `sourcesContent` 清空。
 *
 * ── 为什么（⚠ 缺口有实测出处）────────────────────────────────────────────
 *   `sourcemap: true` 时 rolldown 会把**被引用到的 7 份源码全文**内嵌进
 *   `lib/client.js.map` 的 `sourcesContent`（实测 109051 字节）—— 本仓是**对外分发**的包，
 *   于是 `src/client/**` 的注释（内部条目号 / 轮次号 / 本机路径）会**随包发出去**，
 *   而且 `.map` 是**可全文检索**的最坏形态（任何拿到包的人 grep 即得）。
 *
 * ── 为什么是"清空正文"而不是"关掉 sourcemap"（⚠ 这条不是取舍偏好，是两条硬约束）──
 *   ① **调试能力要留住**：`mappings` 仍在 ⇒ 浏览器 devtools / 栈追踪**照旧能定位到行列**，
 *      只是点不进"原文预览"（源件不在发布物里，本来也预览不到）。
 *   ② **`sourcemap` 开关不能动**：`check:build` 那族按 `lib/**` 比对产物与源码，
 *      关掉整份 `.map` 是**另一件事**（属"降低可诊断性"），本批 ⛔ 不碰。
 *
 * ── 为什么是插件（⛔ 不是配置项）────────────────────────────────────────
 *   ⚠ 实测：tonic 侧**没有**等价开关 —— rolldown 的 `output` 只有
 *   `sourcemap: boolean | 'inline' | 'hidden'`（`node_modules/rolldown/dist/shared/define-config-*.d.mts`），
 *   **没有** `sourcemapExcludeSources` 一类的字段；tsdown 的 `sourcemap` 只是原样透传。
 *   ⇒ 只能拿 rolldown 的插件钩子 `generateBundle`：⚠ 实测该钩子能**看到 `.map` 资产**
 *   （`client.js:chunk` + `client.js.map:asset`），改完由 rolldown 自己落盘。
 *   ⚠ 本仓**零第三方依赖**纪律：本函数运行期不 import 任何包，只用内置的 `JSON` / `Buffer`。
 */
function stripMapSourcesContent(): NonNullable<UserConfig['plugins']> {
  return {
    name: 'strip-map-sources-content',
    generateBundle(_options: unknown, bundle: Record<string, unknown>) {
      for (const [fileName, asset] of Object.entries(bundle)) {
        if (!fileName.endsWith('.map')) continue
        const a = asset as { type?: string; source?: unknown }
        if (a.type !== 'asset') continue
        const raw = typeof a.source === 'string' ? a.source : Buffer.isBuffer(a.source) ? a.source.toString('utf8') : ''
        if (raw === '') continue
        let map: { sourcesContent?: unknown; sources?: unknown }
        try {
          map = JSON.parse(raw) as { sourcesContent?: unknown; sources?: unknown }
        } catch {
          continue
        }
        if (Array.isArray(map.sourcesContent) && map.sourcesContent.length > 0) {
          // ⚠ **保持与 `sources` 等长**（长度不一致的 `.map` 会被某些 devtools 判为坏图）；
          //   置 `null` 是 sourcemap 规范里"该源无内嵌正文"的写法。
          map.sourcesContent = Array.isArray(map.sources) ? map.sources.map(() => null) : []
        }
        a.source = JSON.stringify(map)
      }
    },
  } as NonNullable<UserConfig['plugins']>
}

const clientBundle: UserConfig = {
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  plugins: [stripMapSourcesContent()],
  clean: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  external: [...CLIENT_EXTERNALS],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(PLUGIN_ID) + ', factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [clientBundle] satisfies UserConfig[]
