import { contextBridge, ipcRenderer, webUtils } from 'electron'

const api = {
  // Window controls
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    setFullscreenPreview: (open: boolean) => ipcRenderer.send('fullscreen-preview-state', open),
    onCloseFullscreenPreview: (callback: () => void) => {
      ipcRenderer.on('close-fullscreen-preview', () => callback())
      return () => ipcRenderer.removeAllListeners('close-fullscreen-preview')
    }
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
    // Electron 33+: File.path removed — use webUtils.getPathForFile instead
    getFilePath: (file: File): string => webUtils.getPathForFile(file),
    listDirectory: (path: string) => ipcRenderer.invoke('fs:listDirectory', path),
    getMetadata: (path: string) => ipcRenderer.invoke('fs:getMetadata', path),
    readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),
    exists: (path: string) => ipcRenderer.invoke('fs:exists', path),
    getDrives: () => ipcRenderer.invoke('fs:getDrives'),
    search: (rootPath: string, query: string, maxResults?: number) => ipcRenderer.invoke('fs:search', rootPath, query, maxResults),
    move: (sourcePaths: string[], targetDir: string) => ipcRenderer.invoke('fs:move', sourcePaths, targetDir),
    copy: (sourcePaths: string[], targetDir: string) => ipcRenderer.invoke('fs:copy', sourcePaths, targetDir),
    trash: (paths: string[]) => ipcRenderer.invoke('fs:trash', paths),
    rename: (oldPath: string, newName: string) => ipcRenderer.invoke('fs:rename', oldPath, newName) as Promise<{ ok: boolean; newPath?: string; error?: string }>,
    createDirectory: (dirPath: string) => ipcRenderer.invoke('fs:createDirectory', dirPath),
    extractZip: (zipPath: string) => ipcRenderer.invoke('fs:extractZip', zipPath) as Promise<{ ok: boolean; error?: string }>,
    getNotes: (filePath: string) => ipcRenderer.invoke('notes:get', filePath) as Promise<string>,
    setNotes: (filePath: string, note: string) => ipcRenderer.invoke('notes:set', filePath, note),
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
    uploadFileForCosting: (data: { filePath: string; fileName: string; target: 'customer' | 'quote'; targetId: string; quoteId?: string; itemId?: string }) => ipcRenderer.invoke('presscal:uploadFileForCosting', data),
    postToApi: (endpoint: string, data: any) => ipcRenderer.invoke('presscal:postToApi', endpoint, data)
  },

  // Profiles
  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    active: () => ipcRenderer.invoke('profiles:active'),
    switch: (id: string) => ipcRenderer.invoke('profiles:switch', id),
    create: (data: { name: string; email?: string; presscalUrl?: string }) =>
      ipcRenderer.invoke('profiles:create', data),
    update: (id: string, patch: Record<string, unknown>) =>
      ipcRenderer.invoke('profiles:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('profiles:delete', id)
  },

  // License
  license: {
    get: () => ipcRenderer.invoke('license:get'),
    refresh: () => ipcRenderer.invoke('license:refresh'),
    onChanged: (callback: (status: any) => void) => {
      ipcRenderer.on('license:changed', (_e, status) => callback(status))
      return () => ipcRenderer.removeAllListeners('license:changed')
    }
  },

  // Cloud roots (portable paths)
  cloudRoots: {
    get: () => ipcRenderer.invoke('cloudRoots:get'),
    resolve: (portablePath: string) => ipcRenderer.invoke('cloudRoots:resolve', portablePath),
    detect: () => ipcRenderer.invoke('cloudRoots:detect'),
    save: (roots: any[]) => ipcRenderer.invoke('cloudRoots:save', roots),
    migrate: () => ipcRenderer.invoke('cloudRoots:migrate'),
  },

  // Settings
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    addRecentPath: (path: string) => ipcRenderer.invoke('settings:addRecentPath', path),
    addSearchHistory: (query: string) => ipcRenderer.invoke('settings:addSearchHistory', query),
    clearSearchHistory: () => ipcRenderer.invoke('settings:clearSearchHistory'),
    addBookmark: (path: string) => ipcRenderer.invoke('settings:addBookmark', path),
    removeBookmark: (path: string) => ipcRenderer.invoke('settings:removeBookmark', path),
    reorderBookmarks: (fromIndex: number, toIndex: number) => ipcRenderer.invoke('settings:reorderBookmarks', fromIndex, toIndex),
    setBookmarkColor: (path: string, color: string | null) => ipcRenderer.invoke('settings:setBookmarkColor', path, color),
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

  // Deep link events (from PressCal "Open in PressKit")
  deepLink: {
    onOpenAttachment: (callback: (data: { tempPath: string; filename: string; mime: string; quoteId?: string }) => void) => {
      ipcRenderer.on('open-attachment', (_e, data) => callback(data))
      return () => ipcRenderer.removeAllListeners('open-attachment')
    },
    onPickFileMode: (callback: (data: { quoteId: string; itemId: string }) => void) => {
      ipcRenderer.on('pick-file-mode', (_e, data) => callback(data))
      return () => ipcRenderer.removeAllListeners('pick-file-mode')
    },
    onNavigateToFolder: (callback: (data: { path: string; email?: string; quoteId?: string }) => void) => {
      ipcRenderer.on('navigate-to-folder', (_e, data) => callback(data))
      return () => ipcRenderer.removeAllListeners('navigate-to-folder')
    },
    onProgress: (callback: (data: { step: string; current: number; total: number; done: boolean }) => void) => {
      ipcRenderer.on('deeplink-progress', (_e, data) => callback(data))
      return () => ipcRenderer.removeAllListeners('deeplink-progress')
    },
    onShowAlert: (callback: (data: { title: string; message: string }) => void) => {
      ipcRenderer.on('show-alert', (_e, data) => callback(data))
      return () => ipcRenderer.removeAllListeners('show-alert')
    },
    onShowConfirm: (callback: (data: { id: string; title: string; message: string }) => void) => {
      ipcRenderer.on('show-confirm', (_e, data) => callback(data))
      return () => ipcRenderer.removeAllListeners('show-confirm')
    },
    respondConfirm: (id: string, result: boolean) => {
      ipcRenderer.send(`dialog-result:${id}`, result)
    },
    onShowChoice: (callback: (data: { id: string; title: string; message: string; choices: string[] }) => void) => {
      ipcRenderer.on('show-choice', (_e, data) => callback(data))
      return () => ipcRenderer.removeAllListeners('show-choice')
    },
    respondChoice: (id: string, result: string) => {
      ipcRenderer.send(`dialog-result:${id}`, result)
    }
  },

  // Open with
  apps: {
    getOpenWith: (extension: string) => ipcRenderer.invoke('apps:getOpenWith', extension),
    openWith: (appPath: string, filePath: string) => ipcRenderer.invoke('apps:openWith', appPath, filePath)
  },

  // Native drag. Uses `invoke` because on Windows the main-side handler
  // blocks on `DoDragDrop` until the drag ends — the returned promise
  // resolves at that point, letting the renderer clean up drag state.
  drag: {
    start: (filePaths: string[]) => ipcRenderer.invoke('drag:start', filePaths)
  },

  archive: {
    quoteFolder: (folderPath: string) =>
      ipcRenderer.invoke('archive:quoteFolder', folderPath) as Promise<{ ok: boolean; cancelled?: boolean; error?: string }>
  },

  // Color tools
  color: {
    extractPalette: (path: string, count?: number) => ipcRenderer.invoke('color:extractPalette', path, count),
    inkCoverage: (path: string) => ipcRenderer.invoke('color:inkCoverage', path)
  },

  // Tools
  tools: {
    rgbToCmyk: (r: number, g: number, b: number) => ipcRenderer.invoke('tools:rgbToCmyk', r, g, b),
    cmykToRgb: (c: number, m: number, y: number, k: number) => ipcRenderer.invoke('tools:cmykToRgb', c, m, y, k),

    // Barcodes
    generateBarcode: (type: string, data: string) => ipcRenderer.invoke('tools:generateBarcode', type, data),
    saveBarcodeImage: (svgData: string, format: 'svg' | 'png') => ipcRenderer.invoke('tools:saveBarcodeImage', svgData, format),

    // Job folders
    getFolderTemplates: () => ipcRenderer.invoke('tools:getFolderTemplates'),
    createJobFolders: (basePath: string, templateName: string, jobName: string) => ipcRenderer.invoke('tools:createJobFolders', basePath, templateName, jobName),

    // File packaging
    collectFiles: (sourcePaths: string[], targetDir: string) => ipcRenderer.invoke('tools:collectFiles', sourcePaths, targetDir),
    collectJobFiles: (jobDir: string) => ipcRenderer.invoke('tools:collectJobFiles', jobDir),
    collectByType: (sourceDir: string, extensions: string[], targetDir: string, moveFiles: boolean) =>
      ipcRenderer.invoke('tools:collectByType', sourceDir, extensions, targetDir, moveFiles) as Promise<{ processed: number; errors: string[] }>,

    // Annotations
    loadAnnotations: (filePath: string) => ipcRenderer.invoke('tools:loadAnnotations', filePath),
    saveAnnotations: (filePath: string, annotations: any[]) => ipcRenderer.invoke('tools:saveAnnotations', filePath, annotations),

    // Version history
    getVersions: (filePath: string) => ipcRenderer.invoke('tools:getVersions', filePath),

    // ICC Profile
    getIccProfile: (filePath: string) => ipcRenderer.invoke('tools:getIccProfile', filePath),


    // Print checklist
    printChecklist: (filePath: string) => ipcRenderer.invoke('tools:printChecklist', filePath),

    // Spot colors
    extractSpotColors: (filePath: string) => ipcRenderer.invoke('tools:extractSpotColors', filePath),

    // Picks
    loadPicks: (dirPath: string) => ipcRenderer.invoke('tools:loadPicks', dirPath),
    togglePick: (dirPath: string, fileName: string) => ipcRenderer.invoke('tools:togglePick', dirPath, fileName),
    setPicks: (dirPath: string, fileNames: string[]) => ipcRenderer.invoke('tools:setPicks', dirPath, fileNames),
    clearPicks: (dirPath: string) => ipcRenderer.invoke('tools:clearPicks', dirPath),
  },

  // Auto-update
  update: {
    onStatus: (callback: (data: { status: string; version: string }) => void) => {
      ipcRenderer.on('update-status', (_e, data) => callback(data))
      return () => ipcRenderer.removeAllListeners('update-status')
    },
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.send('install-update'),
    getVersion: () => ipcRenderer.invoke('app:getVersion') as Promise<string>,
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
