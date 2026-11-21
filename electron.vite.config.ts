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
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts'), render: resolve(__dirname, 'src/preload/render.ts') } } }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
    // The app, and the hidden window that renders developed photos for previews, export and print.
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html'), render: resolve(__dirname, 'src/renderer/render.html') } } },
    plugins: [react(), tailwindcss()]
  }
})
