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
