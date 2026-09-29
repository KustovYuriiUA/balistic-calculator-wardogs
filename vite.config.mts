import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const root = resolve(import.meta.dirname, 'src/pages')

// The renderer pages. Output names are a contract with installed copies' updater: an app bundle must contain
// dist/index.html (see src/features/updates/core), and main loads dist/layer.html and dist/area-picker.html.
export default defineConfig({
  root,
  base: './',
  publicDir: resolve(import.meta.dirname, 'public'),
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'chrome140',
    modulePreload: false,
    rollupOptions: {
      input: {
        index: resolve(root, 'index.html'),
        layer: resolve(root, 'layer.html'),
        'area-picker': resolve(root, 'area-picker.html'),
      },
    },
  },
  worker: {
    format: 'es',
  },
})
