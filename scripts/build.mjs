/**
 * Build both halves of the ui-filesystem plugin:
 * - lib/index.js  — node half (ESM, for the host loader)
 * - lib/client.js — browser half (CJS closure factory handed to
 *                   window.__ModuleLoader__.load; externals resolve from the
 *                   platform module table. This plugin has no components or
 *                   runtime cross-package imports, so the bundle is pure
 *                   logic — the external list is kept for parity and safety).
 */

import { build } from 'esbuild'

// Client-modules entry id — the npm package name (client-modules keys the boot
// graph, the /plugins/<id>/client.js route and the __ModuleLoader__
// registration by the loader entry's package name). NOT the cordis plugin id,
// which stays 'ui-filesystem' (exported `name` in src/index.ts).
const PKG_ID = '@dsh-mixxed/dsh-client-ui-filesystem'

/** The browser module table the shell seeds (harness PLATFORM_MODULES). */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
]

const nodeEnv = process.env.NODE_ENV ?? 'production'

// Node half: lib/index.js (ESM). Value imports are type-only today, so the
// bundle carries no bare specifiers the profile must resolve.
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  define: { 'process.env.NODE_ENV': JSON.stringify(nodeEnv) },
})

// Browser half: lib/client.js (CJS closure factory).
await build({
  entryPoints: ['src/client/index.ts'],
  outfile: 'lib/client.js',
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: true,
  external: PLATFORM_MODULES,
  define: {
    'process.env.NODE_ENV': JSON.stringify(nodeEnv),
    'import.meta.env.MODE': JSON.stringify(nodeEnv),
    'import.meta.env': JSON.stringify({ MODE: nodeEnv }),
  },
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PKG_ID)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
  },
  footer: { js: 'return module.exports; } });' },
})

console.log('built lib/index.js and lib/client.js')
