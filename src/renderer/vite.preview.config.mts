// Dev-only config for the lock-screen preview harness (preview-lock.html).
// Plain vite doesn't know the electron-vite aliases, and the default cache dir
// inside Dropbox gets EBUSY-locked — so both are set explicitly here.
//   npx vite serve --config src/renderer/vite.preview.config.mts
import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  root: resolve(import.meta.dirname),
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  optimizeDeps: { entries: ['preview-lock.html'] },
  cacheDir: 'C:/Users/info/AppData/Local/Temp/presskit-vite-preview-cache',
  server: { port: 5199, strictPort: true },
})
