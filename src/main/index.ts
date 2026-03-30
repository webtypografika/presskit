import { app, BrowserWindow, shell, ipcMain, dialog, nativeTheme } from 'electron'
import { join, resolve } from 'path'
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

// Register custom protocol for deep links from PressCal
const PROTOCOL = 'presscal-fh'
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL)
}

// Handle deep link URL
async function handleProtocolUrl(url: string): Promise<void> {
  if (!url.startsWith(`${PROTOCOL}://`)) return

  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'attachment') {
      const messageId = parsed.searchParams.get('messageId')
      const attId = parsed.searchParams.get('attId')
      const mime = parsed.searchParams.get('mime') || 'application/octet-stream'
      const filename = parsed.searchParams.get('filename') || 'attachment'

      if (!messageId || !attId) return

      // Import dynamically to avoid circular deps
      const { app: electronApp } = await import('electron')
      const { writeFile, mkdir } = await import('fs/promises')
      const { join } = await import('path')

      const Store = (await import('electron-store')).default
      const store = new Store()
      const presscalUrl = (store.get('presscal.url') as string)?.replace(/\/$/, '')
      const apiKey = store.get('presscal.apiKey') as string

      if (!presscalUrl || !apiKey) return

      const fetchUrl = `${presscalUrl}/api/filehelper/emails/${messageId}/attachments/${attId}?mime=${encodeURIComponent(mime)}&filename=${encodeURIComponent(filename)}`
      const response = await fetch(fetchUrl, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      })

      if (!response.ok) return

      const buffer = Buffer.from(await response.arrayBuffer())
      const tempDir = join(electronApp.getPath('temp'), 'presscal-filehelper')
      await mkdir(tempDir, { recursive: true })
      const tempPath = join(tempDir, `${Date.now()}_${filename}`)
      await writeFile(tempPath, buffer)

      // Send to renderer to preview
      mainWindow?.focus()
      mainWindow?.webContents.send('open-attachment', { tempPath, filename, mime })
    }

    if (parsed.hostname === 'pick-folder') {
      const customerId = parsed.searchParams.get('customerId')
      if (!customerId) return

      const { dialog } = await import('electron')
      mainWindow?.focus()

      const result = await dialog.showOpenDialog(mainWindow!, {
        title: 'Επιλογή Φακέλου Πελάτη',
        properties: ['openDirectory']
      })

      if (result.canceled || !result.filePaths[0]) return
      const selectedPath = result.filePaths[0]

      // Save to PressCal via API
      const Store = (await import('electron-store')).default
      const store = new Store()
      const presscalUrl = (store.get('presscal.url') as string)?.replace(/\/$/, '')
      const apiKey = store.get('presscal.apiKey') as string

      if (presscalUrl && apiKey) {
        await fetch(`${presscalUrl}/api/filehelper/customers`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: customerId, folderPath: selectedPath })
        })
      }

      // Navigate file browser to the folder
      mainWindow?.webContents.send('navigate-to-folder', { path: selectedPath })
    }

    if (parsed.hostname === 'pick-file-for-item') {
      const quoteId = parsed.searchParams.get('quoteId')
      const itemId = parsed.searchParams.get('itemId')
      const folder = parsed.searchParams.get('folder')

      if (!quoteId || !itemId) return

      mainWindow?.focus()

      // Navigate to customer folder if provided
      if (folder) {
        const { existsSync } = await import('fs')
        if (existsSync(folder)) {
          mainWindow?.webContents.send('navigate-to-folder', { path: folder })
        }
      }

      // Tell renderer to enter "pick file" mode
      mainWindow?.webContents.send('pick-file-mode', { quoteId, itemId })
    }

    if (parsed.hostname === 'open-folder') {
      const folderPath = parsed.searchParams.get('path')
      const email = parsed.searchParams.get('email') || ''
      if (!folderPath) return

      const { existsSync } = await import('fs')
      if (!existsSync(folderPath)) {
        const { dialog } = await import('electron')
        dialog.showErrorBox('Φάκελος δεν βρέθηκε', `Ο φάκελος δεν υπάρχει:\n${folderPath}`)
        return
      }

      mainWindow?.focus()
      mainWindow?.webContents.send('navigate-to-folder', { path: folderPath, email })
    }
  } catch (e) {
    console.error('Protocol handler error:', e)
  }
}

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
// Local file server — serves files to the browser for Calculator/imposition
let fileServerStarted = false
function startFileServer(): void {
  if (fileServerStarted) return
  fileServerStarted = true

  const http = require('http')
  const fs = require('fs')
  const pathMod = require('path')
  const urlMod = require('url')

  const mimeTypes: Record<string, string> = {
    '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.tif': 'image/tiff', '.tiff': 'image/tiff',
    '.svg': 'image/svg+xml', '.ai': 'application/postscript',
    '.psd': 'application/octet-stream', '.eps': 'application/postscript',
  }

  const server = http.createServer((req: any, res: any) => {
    // CORS headers for browser access
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', '*')

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return }

    const parsed = urlMod.parse(req.url, true)
    const filePath = parsed.query.path as string

    if (!filePath || !fs.existsSync(filePath)) {
      res.writeHead(404); res.end('Not found'); return
    }

    const ext = pathMod.extname(filePath).toLowerCase()
    const mime = mimeTypes[ext] || 'application/octet-stream'
    const stat = fs.statSync(filePath)

    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Content-Disposition': `inline; filename="${pathMod.basename(filePath)}"`,
    })

    fs.createReadStream(filePath).pipe(res)
  })

  server.on('error', () => {}) // ignore port conflicts
  server.listen(17824, '127.0.0.1')
}

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
      downloads: join(home, 'Downloads'),
      dropbox,
      home
    }
  })

  // Font install (Windows: copy to C:\Windows\Fonts)
  ipcMain.handle('font:install', async (_e, fontPath: string) => {
    const { copyFile } = await import('fs/promises')
    const { basename } = await import('path')
    const filename = basename(fontPath)

    if (process.platform === 'win32') {
      // Windows: copy to user fonts folder
      const home = process.env.USERPROFILE || 'C:\\Users'
      const userFonts = join(home, 'AppData', 'Local', 'Microsoft', 'Windows', 'Fonts')
      const { mkdir } = await import('fs/promises')
      await mkdir(userFonts, { recursive: true })
      const dest = join(userFonts, filename)
      await copyFile(fontPath, dest)

      // Register in registry via PowerShell
      const fontName = filename.replace(/\.(ttf|otf|woff|woff2)$/i, '') + ' (TrueType)'
      const { exec } = await import('child_process')
      const cmd = `reg add "HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts" /v "${fontName}" /t REG_SZ /d "${dest}" /f`
      await new Promise<void>((resolve, reject) => {
        exec(cmd, (err) => err ? reject(err) : resolve())
      })

      return { ok: true, path: dest }
    } else {
      // macOS / Linux: copy to ~/Library/Fonts or ~/.local/share/fonts
      const home = process.env.HOME || ''
      const fontsDir = process.platform === 'darwin'
        ? join(home, 'Library', 'Fonts')
        : join(home, '.local', 'share', 'fonts')
      const { mkdir } = await import('fs/promises')
      await mkdir(fontsDir, { recursive: true })
      const dest = join(fontsDir, filename)
      await copyFile(fontPath, dest)
      return { ok: true, path: dest }
    }
  })

  // Check if font is installed
  ipcMain.handle('font:isInstalled', async (_e, fontPath: string) => {
    const { basename } = await import('path')
    const { existsSync } = await import('fs')
    const filename = basename(fontPath)

    if (process.platform === 'win32') {
      const home = process.env.USERPROFILE || 'C:\\Users'
      const userFonts = join(home, 'AppData', 'Local', 'Microsoft', 'Windows', 'Fonts')
      return existsSync(join(userFonts, filename))
    } else {
      const home = process.env.HOME || ''
      const fontsDir = process.platform === 'darwin'
        ? join(home, 'Library', 'Fonts')
        : join(home, '.local', 'share', 'fonts')
      return existsSync(join(fontsDir, filename))
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

  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    return shell.openExternal(url)
  })

  // Theme
  ipcMain.handle('theme:get', () => nativeTheme.shouldUseDarkColors)
}

// Windows: handle protocol URL when app is already running
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    // Windows passes the URL as the last argument
    const url = commandLine.find(arg => arg.startsWith(`${PROTOCOL}://`))
    if (url) handleProtocolUrl(url)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    registerHandlers()
    startFileServer()
    createWindow()

    // Check if launched with protocol URL (Windows: passed as arg)
    const protocolUrl = process.argv.find(arg => arg.startsWith(`${PROTOCOL}://`))
    if (protocolUrl) handleProtocolUrl(protocolUrl)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })

    // macOS: handle protocol URL
    app.on('open-url', (_event, url) => {
      handleProtocolUrl(url)
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // Cleanup temp files on quit
  app.on('before-quit', async () => {
    try {
      const { rm } = await import('fs/promises')
      const tempDir = join(app.getPath('temp'), 'presscal-filehelper')
      await rm(tempDir, { recursive: true, force: true })
    } catch {}
  })
}
