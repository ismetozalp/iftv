import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import compression from 'vite-plugin-compression'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

const APP_VERSION = readFileSync(new URL('./VERSION', import.meta.url), 'utf8').trim()

export default defineConfig({
  base: './',
  define: { __IFTV_VERSION__: JSON.stringify(APP_VERSION) },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      cockpit: fileURLToPath(new URL('./src/cockpit.ts', import.meta.url)),
    },
  },
  plugins: [
    vue(),
    viteStaticCopy({ targets: [{ src: 'manifest.json', dest: '.' }] }),
    compression({ deleteOriginFile: false, algorithm: 'gzip', ext: '.gz' }),
  ],
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        entryFileNames: 'index.js',
        assetFileNames: 'index[extname]',
      },
    },
  },
})
