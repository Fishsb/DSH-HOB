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
 * ⚠ `@deepseek-ai/dsh-client-ui-primitives` 是**平台 seed**，也必须 external：
 *   它在 `window.__DSH_BOOT__` 的静态模块表里（前端产物 `platform.ts` 的
 *   `staticModules`，实测 8 项含它），loader 的 `makeRequire` 里
 *   `if (this.seed.has(spec)) return this.seed.get(spec)` **最先命中** ⇒
 *   运行时拿的是宿主那一份，插件**不需要**在自己的 `dsh.client.inject` 里列它
 *   （`dshmarket` / `dsh-better-sidebar` 等既有插件同样只 require 不 inject）。
 *
 *   不 external 的后果（**实测**，不是推断）：tsdown 会试图把整包打进来
 *   —— 实测产物 **245357 字节**，并报一堆
 *   `Module not found, treating it as an external dependency`（它的 shiki /
 *   katex / simple-icons 等在开发机上并不齐备）⇒ 产物里会出现一份**私有副本**，
 *   与宿主那份并存：既浪费体积，又可能出现两份相同的 React 组件实例。
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
  // ⚠ 本轮新增：面板复用宿主的 StateDot / Tag 两个 primitives 组件。
  //   它是平台 seed（理由见上方注释），必须 external 才能拿到宿主那一份。
  '@deepseek-ai/dsh-client-ui-primitives',
]

const clientBundle: UserConfig = {
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
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
