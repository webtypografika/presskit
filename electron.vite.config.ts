import { resolve } from 'path'
import { tmpdir } from 'os'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Keep vite dep cache outside Dropbox to avoid EBUSY lock conflicts
const viteCacheDir = resolve(tmpdir(), 'presskit-vite-cache')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['electron-store'] })],
    build: {
      rollupOptions: {
        external: ['sharp', 'better-sqlite3', 'chokidar']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    cacheDir: viteCacheDir,
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
