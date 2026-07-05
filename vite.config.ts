import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import compression from 'vite-plugin-compression'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  base: './',
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
