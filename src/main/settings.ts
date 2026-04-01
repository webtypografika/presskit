import { IpcMain } from 'electron'
import Store from 'electron-store'

export const store = new Store({
  defaults: {
    'ui.sidebarWidth': 280,
    'ui.inspectorWidth': 320,
    'ui.viewMode': 'grid',
    'ui.thumbnailSize': 128,
    'ui.showHiddenFiles': false,
    'paths.recent': [] as string[],
    'paths.bookmarks': [] as string[],
    'preflight.minDpi': 300,
    'preflight.maxTac': 300,
    'preflight.requireCmyk': true,
    'preflight.requireBleed': true,
    'preflight.bleedMm': 3,
    'presscal.url': '',
    'presscal.apiKey': '',
    'dropbox.clientId': ''
  }
})

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
