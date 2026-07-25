import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

const e2eBridge = process.env.VITE_HOMEVOX_E2E === '1' ? 'e2eBridge.ts' : 'e2eBridge.disabled.ts'
// @vitejs/plugin-react 6 still emits Refresh registrations with Vite 8 in
// this repository, but does not inject its browser preamble. Keep the dev
// server's React HMR boundary usable without adding any development runtime to
// production builds.
const reactRefreshPreamble = {
  name: 'homevox-react-refresh-preamble',
  apply: 'serve' as const,
  transformIndexHtml() {
    return [{
      tag: 'script',
      attrs: { type: 'module' },
      injectTo: 'head-prepend' as const,
      children: `import RefreshRuntime from "/@react-refresh";
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;`,
    }]
  },
}

export default defineConfig({
  plugins: [reactRefreshPreamble, react(), tailwindcss()],
  resolve: {
    alias: {
      '@homevox-e2e': resolve(__dirname, `src/${e2eBridge}`),
      '@homevox-wasm': resolve(__dirname, '../wasm/pkg/homevox_wasm.js'),
    },
  },
  server: {
    fs: {
      allow: [resolve(__dirname, '..')],
    },
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:18088',
        changeOrigin: true,
      },
    },
  },
})
