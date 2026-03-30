import { app, BrowserWindow, shell, ipcMain, dialog, nativeTheme } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { registerFileSystemHandlers } from './file-system'
import { registerPreviewHandlers } from './preview-engine'
import { registerPreflightHandlers } from './preflight-engine'
import { registerDropboxHandlers } from './dropbox-client'
import { registerPresscalHandlers } from './presscal-client'
import { registerSettingsHandlers } from './settings'
import { registerBatchHandlers } from './batch-engine'
import { registerConvertHandlers } from './convert-engine'
import { registerColorHandlers } from './color-tools'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0a0e1a',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0e1a',
      symbolColor: '#94a3b8',
      height: 36
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Register all IPC handlers
function registerHandlers(): void {
  registerFileSystemHandlers(ipcMain)
  registerPreviewHandlers(ipcMain)
  registerPreflightHandlers(ipcMain)
  registerDropboxHandlers(ipcMain)
  registerPresscalHandlers(ipcMain)
  registerSettingsHandlers(ipcMain)
  registerBatchHandlers(ipcMain)
  registerConvertHandlers(ipcMain)
  registerColorHandlers(ipcMain)

  // User directories
  ipcMain.handle('system:userPaths', async () => {
    const home = process.env.USERPROFILE || process.env.HOME || 'C:\\Users'
    const { existsSync } = await import('fs')

    // Find Dropbox folder — check common locations
    const dropboxCandidates = [
      join(home, 'Dropbox'),
      join(home, 'Documents', 'Dropbox'),
      'D:\\Dropbox'
    ]
    const dropbox = dropboxCandidates.find(p => existsSync(p)) || join(home, 'Dropbox')

    return {
      desktop: join(home, 'Desktop'),
      documents: join(home, 'Documents'),
      dropbox,
      home
    }
  })

  // Window controls
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized())

  // Dialogs
  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:openFiles', async (_e, filters?: Electron.FileFilter[]) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections'],
      filters: filters || [
        { name: 'Design Files', extensions: ['pdf', 'ai', 'psd', 'eps', 'tif', 'tiff', 'png', 'jpg', 'jpeg', 'svg', 'indd'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    return result.canceled ? [] : result.filePaths
  })

  // Open in native app
  ipcMain.handle('shell:openPath', async (_e, path: string) => {
    return shell.openPath(path)
  })

  ipcMain.handle('shell:showInFolder', async (_e, path: string) => {
    shell.showItemInFolder(path)
  })

  // Theme
  ipcMain.handle('theme:get', () => nativeTheme.shouldUseDarkColors)
}

app.whenReady().then(() => {
  registerHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
