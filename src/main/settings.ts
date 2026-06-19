import { IpcMain } from 'electron'
import { getActiveStore } from './profile-manager'

// `store` is no longer a single global — every read/write goes through the
// active profile's store. The proxy exists so existing call sites keep using
// `store.get(...)` / `store.set(...)` without needing to know about profiles.
// initializeProfiles() must run before any of these are called.
export const store = new Proxy({} as ReturnType<typeof getActiveStore>, {
  get(_target, prop, receiver) {
    const real = getActiveStore() as any
    const value = real[prop]
    return typeof value === 'function' ? value.bind(real) : value
  },
  set(_target, prop, value) {
    const real = getActiveStore() as any
    real[prop] = value
    return true
  },
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

  ipcMain.handle('settings:addSearchHistory', async (_e, query: string) => {
    const history = (store.get('search.history') as { query: string; time: string }[]) || []
    const filtered = history.filter(h => h.query !== query)
    filtered.unshift({ query, time: new Date().toISOString() })
    const capped = filtered.slice(0, 30)
    store.set('search.history', capped)
    return capped
  })

  ipcMain.handle('settings:clearSearchHistory', async () => {
    store.set('search.history', [])
    return []
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

  ipcMain.handle('settings:reorderBookmarks', async (_e, fromIndex: number, toIndex: number) => {
    const bookmarks = (store.get('paths.bookmarks') as string[]) || []
    if (fromIndex < 0 || fromIndex >= bookmarks.length || toIndex < 0 || toIndex >= bookmarks.length) return bookmarks
    const [item] = bookmarks.splice(fromIndex, 1)
    bookmarks.splice(toIndex, 0, item)
    store.set('paths.bookmarks', bookmarks)
    return bookmarks
  })

  ipcMain.handle('settings:setBookmarkColor', async (_e, path: string, color: string | null) => {
    const colors = (store.get('paths.bookmarkColors') as Record<string, string>) || {}
    if (color) {
      colors[path] = color
    } else {
      delete colors[path]
    }
    store.set('paths.bookmarkColors', colors)
    return colors
  })
}
