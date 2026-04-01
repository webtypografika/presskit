import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Window controls
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized')
  },

  // Dialogs
  dialog: {
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
    openFiles: (filters?: any[]) => ipcRenderer.invoke('dialog:openFiles', filters)
  },

  // Shell
  shell: {
    openPath: (path: string) => ipcRenderer.invoke('shell:openPath', path),
    showInFolder: (path: string) => ipcRenderer.invoke('shell:showInFolder', path),
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url)
  },

  // File System
  fs: {
    listDirectory: (path: string) => ipcRenderer.invoke('fs:listDirectory', path),
    getMetadata: (path: string) => ipcRenderer.invoke('fs:getMetadata', path),
    readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),
    exists: (path: string) => ipcRenderer.invoke('fs:exists', path),
    getDrives: () => ipcRenderer.invoke('fs:getDrives'),
    search: (rootPath: string, query: string, maxResults?: number) => ipcRenderer.invoke('fs:search', rootPath, query, maxResults),
    move: (sourcePaths: string[], targetDir: string) => ipcRenderer.invoke('fs:move', sourcePaths, targetDir),
    copy: (sourcePaths: string[], targetDir: string) => ipcRenderer.invoke('fs:copy', sourcePaths, targetDir),
    trash: (paths: string[]) => ipcRenderer.invoke('fs:trash', paths),
    watch: (dirPath: string) => ipcRenderer.invoke('fs:watch', dirPath),
    unwatch: () => ipcRenderer.invoke('fs:unwatch'),
    onChanged: (callback: (dirPath: string) => void) => {
      ipcRenderer.on('fs:changed', (_e, dirPath) => callback(dirPath))
      return () => ipcRenderer.removeAllListeners('fs:changed')
    }
  },

  // Indexed search
  search: {
    query: (q: string, limit?: number) => ipcRenderer.invoke('search:query', q, limit),
    buildIndex: () => ipcRenderer.invoke('search:buildIndex'),
    stats: () => ipcRenderer.invoke('search:stats'),
    addPath: (path: string) => ipcRenderer.invoke('search:addPath', path)
  },

  // Preview
  preview: {
    thumbnail: (path: string, size?: number) => ipcRenderer.invoke('preview:thumbnail', path, size),
    full: (path: string) => ipcRenderer.invoke('preview:full', path)
  },

  // Preflight
  preflight: {
    run: (path: string) => ipcRenderer.invoke('preflight:run', path)
  },

  // Dropbox
  dropbox: {
    status: () => ipcRenderer.invoke('dropbox:status'),
    connect: (clientId: string) => ipcRenderer.invoke('dropbox:connect', clientId),
    disconnect: () => ipcRenderer.invoke('dropbox:disconnect'),
    listFolder: (path: string) => ipcRenderer.invoke('dropbox:listFolder', path),
    download: (path: string) => ipcRenderer.invoke('dropbox:download', path),
    thumbnail: (path: string) => ipcRenderer.invoke('dropbox:thumbnail', path),
    upload: (localPath: string, remotePath: string) => ipcRenderer.invoke('dropbox:upload', localPath, remotePath),
    revisions: (path: string) => ipcRenderer.invoke('dropbox:revisions', path),
    search: (query: string, path?: string) => ipcRenderer.invoke('dropbox:search', query, path)
  },

  // PressCal
  presscal: {
    configure: (url: string, apiKey: string) => ipcRenderer.invoke('presscal:configure', url, apiKey),
    status: () => ipcRenderer.invoke('presscal:status'),
    getQuotes: (filters?: any) => ipcRenderer.invoke('presscal:getQuotes', filters),
    getQuote: (id: string) => ipcRenderer.invoke('presscal:getQuote', id),
    getCustomers: (search?: string) => ipcRenderer.invoke('presscal:getCustomers', search),
    getCustomer: (id: string) => ipcRenderer.invoke('presscal:getCustomer', id),
    getJobs: (filters?: any) => ipcRenderer.invoke('presscal:getJobs', filters),
    linkFile: (data: any) => ipcRenderer.invoke('presscal:linkFile', data),
    unlinkFile: (id: string) => ipcRenderer.invoke('presscal:unlinkFile', id),
    getFileLinks: (filters?: any) => ipcRenderer.invoke('presscal:getFileLinks', filters),
    sendEmail: (data: any) => ipcRenderer.invoke('presscal:sendEmail', data),
    linkFileToItem: (quoteId: string, itemId: string, filePath: string) => ipcRenderer.invoke('presscal:linkFileToItem', quoteId, itemId, filePath),
    sendEmailWithFiles: (data: any) => ipcRenderer.invoke('presscal:sendEmailWithFiles', data),
    getEmailThreads: (quoteId: string) => ipcRenderer.invoke('presscal:getEmailThreads', quoteId),
    saveToCustomerFolder: (sourcePath: string, targetFolder: string, filename: string) => ipcRenderer.invoke('presscal:saveToCustomerFolder', sourcePath, targetFolder, filename),
    getQuoteEmailMessages: (quoteId: string) => ipcRenderer.invoke('presscal:getQuoteEmailMessages', quoteId),
    downloadAttachment: (messageId: string, attId: string, mime: string, filename: string) => ipcRenderer.invoke('presscal:downloadAttachment', messageId, attId, mime, filename),
    uploadFileForCosting: (data: { filePath: string; fileName: string; target: 'customer' | 'quote'; targetId: string; quoteId?: string; itemId?: string }) => ipcRenderer.invoke('presscal:uploadFileForCosting', data)
  },

  // Settings
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    addRecentPath: (path: string) => ipcRenderer.invoke('settings:addRecentPath', path),
    addBookmark: (path: string) => ipcRenderer.invoke('settings:addBookmark', path),
    removeBookmark: (path: string) => ipcRenderer.invoke('settings:removeBookmark', path)
  },

  // System
  system: {
    userPaths: () => ipcRenderer.invoke('system:userPaths')
  },

  // Theme
  theme: {
    get: () => ipcRenderer.invoke('theme:get'),
    update: (theme: string) => ipcRenderer.invoke('theme:update', theme)
  },

  // Batch operations
  batch: {
    scanDirectory: (path: string, recursive?: boolean) => ipcRenderer.invoke('batch:scanDirectory', path, recursive),
    preflight: (filePaths: string[]) => ipcRenderer.invoke('batch:preflight', filePaths),
    exportCsv: (reports: any[]) => ipcRenderer.invoke('batch:exportCsv', reports),
    onProgress: (callback: (data: any) => void) => {
      ipcRenderer.on('batch:progress', (_e, data) => callback(data))
      return () => ipcRenderer.removeAllListeners('batch:progress')
    }
  },

  // Convert
  convert: {
    file: (inputPath: string, options: any) => ipcRenderer.invoke('convert:file', inputPath, options),
    batch: (filePaths: string[], options: any) => ipcRenderer.invoke('convert:batch', filePaths, options),
    saveDialog: (defaultName: string) => ipcRenderer.invoke('convert:saveDialog', defaultName),
    hasGhostscript: () => ipcRenderer.invoke('convert:hasGhostscript')
  },

  // Font management
  font: {
    install: (fontPath: string) => ipcRenderer.invoke('font:install', fontPath),
    isInstalled: (fontPath: string) => ipcRenderer.invoke('font:isInstalled', fontPath),
  },

  // Deep link events (from PressCal "Open in FileHelper")
  deepLink: {
    onOpenAttachment: (callback: (data: { tempPath: string; filename: string; mime: string; quoteId?: string }) => void) => {
      ipcRenderer.on('open-attachment', (_e, data) => callback(data))
      return () => ipcRenderer.removeAllListeners('open-attachment')
    },
    onPickFileMode: (callback: (data: { quoteId: string; itemId: string }) => void) => {
      ipcRenderer.on('pick-file-mode', (_e, data) => callback(data))
      return () => ipcRenderer.removeAllListeners('pick-file-mode')
    },
    onNavigateToFolder: (callback: (data: { path: string; email?: string }) => void) => {
      ipcRenderer.on('navigate-to-folder', (_e, data) => callback(data))
      return () => ipcRenderer.removeAllListeners('navigate-to-folder')
    }
  },

  // Open with
  apps: {
    getOpenWith: (extension: string) => ipcRenderer.invoke('apps:getOpenWith', extension),
    openWith: (appPath: string, filePath: string) => ipcRenderer.invoke('apps:openWith', appPath, filePath)
  },

  // Native drag
  drag: {
    start: (filePaths: string[]) => ipcRenderer.send('drag:start', filePaths)
  },

  // Color tools
  color: {
    extractPalette: (path: string, count?: number) => ipcRenderer.invoke('color:extractPalette', path, count),
    inkCoverage: (path: string) => ipcRenderer.invoke('color:inkCoverage', path)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
