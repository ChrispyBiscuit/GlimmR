import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // The image decoding thread is its own entry, next to index.js (see src/main/decode/index.ts).
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts'), decodeWorker: resolve(__dirname, 'src/main/decode/worker.ts') } } }
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
    plugins: [react(), tailwindcss()]
  }
})
