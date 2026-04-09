import { IpcMain } from 'electron'
import Store from 'electron-store'

export const store = new Store()

// Migrate: remove flat dot-keys that conflict with nested values
const FLAT_KEYS = [
  'ui.sidebarWidth', 'ui.inspectorWidth', 'ui.viewMode', 'ui.thumbnailSize', 'ui.showHiddenFiles',
  'paths.recent', 'paths.bookmarks',
  'preflight.minDpi', 'preflight.maxTac', 'preflight.requireCmyk', 'preflight.requireBleed', 'preflight.bleedMm',
  'presscal.url', 'presscal.apiKey', 'dropbox.clientId'
]
if (store.has('presscal.url' as any) && typeof store.store['presscal.url'] === 'string') {
  // Config has flat dot-keys — migrate nested values and delete flat ones
  const raw = store.store as Record<string, any>
  for (const key of FLAT_KEYS) {
    if (key in raw && typeof raw[key] !== 'object') {
      delete raw[key]
    }
  }
  store.store = raw
}

export function registerSettingsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('settings:get', async (_e, key: string) => {
    return store.get(key)
  })

  ipcMain.handle('settings:set', async (_e, key: string, value: unknown) => {
    store.set(key, value)
    return true
  })

  ipcMain.handle('settings:getAll', async () => {
    return store.store
  })

  ipcMain.handle('settings:addRecentPath', async (_e, path: string) => {
    const recent = (store.get('paths.recent') as string[]) || []
    const filtered = recent.filter(p => p !== path)
    filtered.unshift(path)
    store.set('paths.recent', filtered.slice(0, 20))
    return filtered.slice(0, 20)
  })

  ipcMain.handle('settings:addBookmark', async (_e, path: string) => {
    const bookmarks = (store.get('paths.bookmarks') as string[]) || []
    if (!bookmarks.includes(path)) {
      bookmarks.push(path)
      store.set('paths.bookmarks', bookmarks)
    }
    return bookmarks
  })

  ipcMain.handle('settings:removeBookmark', async (_e, path: string) => {
    const bookmarks = (store.get('paths.bookmarks') as string[]) || []
    const filtered = bookmarks.filter(p => p !== path)
    store.set('paths.bookmarks', filtered)
    return filtered
  })
}
