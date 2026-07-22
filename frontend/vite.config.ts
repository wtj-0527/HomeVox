import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
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
