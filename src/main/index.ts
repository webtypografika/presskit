import { app, BrowserWindow, shell, ipcMain, dialog, nativeTheme } from 'electron'
import { join, resolve } from 'path'
import { is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { registerFileSystemHandlers } from './file-system'
import { registerPreviewHandlers } from './preview-engine'
import { registerPreflightHandlers } from './preflight-engine'
import { registerDropboxHandlers } from './dropbox-client'
import { registerPresscalHandlers } from './presscal-client'
import { registerSettingsHandlers, store } from './settings'
import { registerBatchHandlers } from './batch-engine'
import { registerConvertHandlers } from './convert-engine'
import { registerColorHandlers } from './color-tools'
import { registerSearchHandlers } from './search-engine'
import * as everything from './everything-engine'
import { registerToolHandlers } from './tools-engine'
import { registerLicenseHandlers, startLicensePoller, checkLicense } from './license-engine'
import { initializeProfiles, registerProfileHandlers, createProfile, switchProfile, getActiveProfile, getActiveProfileId, listProfiles, updateProfile } from './profile-manager'
import { registerCloudRootsHandlers, getCloudRoots, resolvePortablePath, toPortablePath, detectCloudRoots, autoMigratePaths } from './cloud-roots'

let mainWindow: BrowserWindow | null = null

// ─── Auto-updater ───
function setupAutoUpdater(): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdate] Update available:', info.version)
    mainWindow?.webContents.send('update-status', { status: 'downloading', version: info.version })
  })

  autoUpdater.on('update-not-available', () => {
    console.log('[AutoUpdate] No update available')
    mainWindow?.webContents.send('update-status', { status: 'up-to-date', version: '' })
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdate] Update downloaded:', info.version)
    mainWindow?.webContents.send('update-status', { status: 'ready', version: info.version })
  })

  autoUpdater.on('error', (err) => {
    console.log('[AutoUpdate] Error:', err.message)
    mainWindow?.webContents.send('update-status', { status: 'error', version: '' })
  })

  // Check now and every 2 hours
  autoUpdater.checkForUpdates().catch(() => {})
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 2 * 60 * 60 * 1000)
}

// IPC: renderer can trigger install
ipcMain.on('install-update', () => {
  autoUpdater.quitAndInstall(false, true)
})

// IPC: renderer can request a manual check
ipcMain.handle('update:check', async () => {
  mainWindow?.webContents.send('update-status', { status: 'checking', version: '' })
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    mainWindow?.webContents.send('update-status', { status: 'error', version: '' })
  }
})

// IPC: get app version
ipcMain.handle('app:getVersion', () => app.getVersion())

/** Show an error via in-app modal (avoids native dialog going behind windows). */
function showError(title: string, message: string) {
  const win = mainWindow || BrowserWindow.getFocusedWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('show-alert', { title, message })
    // Bring window to front so the user sees it
    if (win.isMinimized()) win.restore()
    win.focus()
  } else {
    dialog.showErrorBox(title, message)
  }
}

// Register custom protocol for deep links from PressCal
const PROTOCOL = 'presscal-fh'

// "Object has been destroyed" = a late timer/IPC callback touching a window
// that closed in the meantime. Harmless, but Electron's default handler pops a
// scary error dialog for it. Swallow just that; keep the dialog for real bugs.
process.on('uncaughtException', (err) => {
  const msg = String((err as Error)?.message || err)
  if (msg.includes('Object has been destroyed')) {
    console.warn('[main] late callback on destroyed window:', msg)
    return
  }
  const { dialog } = require('electron')
  dialog.showErrorBox('A JavaScript error occurred in the main process', String((err as Error)?.stack || err))
})
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL)
}

// Log to both main process and renderer console
function deepLog(...args: any[]) {
  console.log(...args)
  try {
    mainWindow?.webContents.executeJavaScript(
      `console.log(${args.map(a => JSON.stringify(String(a))).join(',')})`
    )
  } catch {}
}

// Handle deep link URL
async function handleProtocolUrl(url: string): Promise<void> {
  if (!url.startsWith(`${PROTOCOL}://`)) return

  deepLog('[DeepLink] Received:', url)

  // Always focus the window first — Windows needs alwaysOnTop trick
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.setAlwaysOnTop(true)
    mainWindow.moveTop()
    mainWindow.focus()
    setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(false) }, 300)
  }

  try {
    const parsed = new URL(url)
    deepLog('[DeepLink] hostname:', parsed.hostname, 'params:', parsed.searchParams.toString())

    // ── Auto-switch profile if the deep link comes from a different PressCal instance ──
    // Every deep link from PressCal carries &origin=https://pro.presscal.com (or eu, etc.).
    // If the origin doesn't match the active profile, switch to the matching profile,
    // save this deep link to a file, restart, and process it after relaunch.
    if (parsed.hostname !== 'connect') {
      const origin = parsed.searchParams.get('origin')
      if (origin) {
        const activeUrl = (store.get('presscal.url') as string)?.replace(/\/$/, '')
        const cleanOrigin = origin.replace(/\/$/, '')
        if (activeUrl && cleanOrigin && activeUrl.toLowerCase() !== cleanOrigin.toLowerCase()) {
          const profiles = listProfiles()
          const match = profiles.find(
            p => p.presscalUrl?.replace(/\/$/, '').toLowerCase() === cleanOrigin.toLowerCase()
          )
          if (match && match.id !== getActiveProfileId()) {
            deepLog('[DeepLink] Origin mismatch — active:', activeUrl, 'deep link:', cleanOrigin)
            deepLog('[DeepLink] Auto-switching to profile:', match.id, `(${match.name})`)
            // Save the deep link for processing after restart
            const { writeFileSync } = await import('fs')
            writeFileSync(join(app.getPath('userData'), 'pending-deeplink.txt'), url, 'utf-8')
            switchProfile(match.id) // triggers app.relaunch + exit
            return
          }
          if (!match) {
            deepLog('[DeepLink] No profile found for origin:', cleanOrigin, '— proceeding with active profile')
          }
        }
      }
    }

    // Resolve portable paths in deep link params (e.g. <DROPBOX>\... → C:\Users\...\Dropbox\...)
    const resolveDL = resolvePortablePath
    for (const key of ['path', 'folder', 'folderPath']) {
      const val = parsed.searchParams.get(key)
      if (val && val.startsWith('<')) {
        parsed.searchParams.set(key, resolveDL(val))
      }
    }

    if (parsed.hostname === 'attachment') {
      const messageId = parsed.searchParams.get('messageId')
      const attId = parsed.searchParams.get('attId')
      const mime = parsed.searchParams.get('mime') || 'application/octet-stream'
      const filename = parsed.searchParams.get('filename') || 'attachment'
      const quoteId = parsed.searchParams.get('quoteId') || ''

      if (!messageId || !attId) {
        deepLog('[DeepLink] Missing messageId or attId')
        return
      }

      const { app: electronApp } = await import('electron')
      const { writeFile, mkdir } = await import('fs/promises')
      const { join } = await import('path')

      const presscalUrl = (store.get('presscal.url') as string)?.replace(/\/$/, '')
      const apiKey = store.get('presscal.apiKey') as string

      if (!presscalUrl || !apiKey) {
        deepLog('[DeepLink] PressCal not configured')
        return
      }

      deepLog('[DeepLink] Downloading attachment:', filename)
      const fetchUrl = `${presscalUrl}/api/filehelper/emails/${messageId}/attachments/${attId}?mime=${encodeURIComponent(mime)}&filename=${encodeURIComponent(filename)}`
      const response = await fetch(fetchUrl, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      })

      if (!response.ok) {
        deepLog('[DeepLink] Download failed:', response.status, response.statusText)
        return
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      const tempDir = join(electronApp.getPath('temp'), 'presskit')
      await mkdir(tempDir, { recursive: true })
      const tempPath = join(tempDir, `${Date.now()}_${filename}`)
      await writeFile(tempPath, buffer)

      deepLog('[DeepLink] Saved to:', tempPath)
      mainWindow?.webContents.send('open-attachment', { tempPath, filename, mime, quoteId })
    }

    if (parsed.hostname === 'open-file') {
      const filePath = parsed.searchParams.get('path')
      const quoteId = parsed.searchParams.get('quoteId') || ''
      if (!filePath) {
        deepLog('[DeepLink] open-file: missing path')
        return
      }

      const { app: electronApp } = await import('electron')
      const { writeFile, mkdir } = await import('fs/promises')
      const { join: pathJoin, basename: pathBasename, extname: pathExtname } = await import('path')

      const rawUrl = store.get('presscal.url')
      deepLog('[DeepLink] open-file: store presscal.url =', JSON.stringify(rawUrl))
      const presscalUrl = (rawUrl as string)?.replace(/\/$/, '')

      if (!presscalUrl) {
        deepLog('[DeepLink] open-file: PressCal not configured')
        return
      }

      const fileUrl = filePath.startsWith('http') ? filePath : `${presscalUrl}${filePath}`
      const filename = pathBasename(filePath)
      const ext = pathExtname(filename).toLowerCase()

      deepLog('[DeepLink] open-file: downloading', fileUrl)

      // /storage/ paths are public, others need auth
      const needsAuth = !filePath.includes('/storage/')
      const headers: Record<string, string> = {}
      if (needsAuth) {
        const apiKey = store.get('presscal.apiKey') as string
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
      }

      const response = await fetch(fileUrl, { headers })
      if (!response.ok) {
        deepLog('[DeepLink] open-file: download failed', response.status, response.statusText)
        return
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      const tempDir = pathJoin(electronApp.getPath('temp'), 'presskit')
      await mkdir(tempDir, { recursive: true })
      const tempPath = pathJoin(tempDir, `${Date.now()}_${filename}`)
      await writeFile(tempPath, buffer)

      const mime = ext === '.pdf' ? 'application/pdf'
        : ['.jpg', '.jpeg'].includes(ext) ? 'image/jpeg'
        : ext === '.png' ? 'image/png'
        : ext === '.tif' || ext === '.tiff' ? 'image/tiff'
        : 'application/octet-stream'

      deepLog('[DeepLink] open-file: saved to', tempPath)
      mainWindow?.webContents.send('open-attachment', { tempPath, filename, mime, quoteId })
    }

    if (parsed.hostname === 'pick-folder') {
      const customerId = parsed.searchParams.get('customerId')
      // target=jobFolderRoot → pick the org-wide job folders root (Settings → PressKit)
      const target = parsed.searchParams.get('target')
      if (!customerId && target !== 'jobFolderRoot') return

      const { dialog } = await import('electron')
      if (mainWindow) { mainWindow.setAlwaysOnTop(true); mainWindow.focus(); mainWindow.setAlwaysOnTop(false); }

      const result = await dialog.showOpenDialog(mainWindow!, {
        title: customerId ? 'Select Customer Folder' : 'Select Job Folder Root',
        properties: ['openDirectory', 'createDirectory']
      })

      if (result.canceled || !result.filePaths[0]) return
      const selectedPath = result.filePaths[0]

      // Save to PressCal via API
      const presscalUrl = (store.get('presscal.url') as string)?.replace(/\/$/, '')
      const apiKey = store.get('presscal.apiKey') as string

      if (presscalUrl && apiKey) {
        if (customerId) {
          await fetch(`${presscalUrl}/api/filehelper/customers`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: customerId, folderPath: toPortablePath(selectedPath) })
          })
        } else {
          await fetch(`${presscalUrl}/api/filehelper/org`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobFolderRoot: toPortablePath(selectedPath) })
          })
        }
      }

      // Navigate file browser to the folder
      mainWindow?.webContents.send('navigate-to-folder', { path: selectedPath })
    }

    if (parsed.hostname === 'pick-file-for-item') {
      const quoteId = parsed.searchParams.get('quoteId')
      const itemId = parsed.searchParams.get('itemId')
      let folder = parsed.searchParams.get('folder')

      if (!quoteId || !itemId) return

      if (mainWindow) { mainWindow.setAlwaysOnTop(true); mainWindow.focus(); mainWindow.setAlwaysOnTop(false); }

      // Resolve folder to navigate to
      const { existsSync } = await import('fs')
      let resolvedFolder: string | null = null

      if (folder) {
        // Try the folder path as-is first (may contain "/" in folder names)
        if (existsSync(folder)) {
          resolvedFolder = folder
        } else {
          const normalized = folder.replace(/\//g, '\\')
          if (existsSync(normalized)) resolvedFolder = normalized
        }
      }

      // Fallback: resolve folder from quote API if not provided or not found
      if (!resolvedFolder) {
        const presscalUrl = (store.get('presscal.url') as string)?.replace(/\/$/, '')
        const apiKey = store.get('presscal.apiKey') as string
        if (presscalUrl && apiKey) {
          try {
            const res = await fetch(`${presscalUrl}/api/filehelper/quotes/${encodeURIComponent(quoteId)}`, {
              headers: { 'Authorization': `Bearer ${apiKey}` },
            })
            if (res.ok) {
              const quote = await res.json() as any
              // Try quote folderPath first, then customer folderPath
              for (const fp of [quote.folderPath, quote.customerFolderPath]) {
                if (!fp) continue
                const resolved = resolvePortablePath(fp).replace(/\//g, '\\')
                if (existsSync(resolved)) {
                  resolvedFolder = resolved
                  break
                }
              }
            }
          } catch {}
        }
      }

      if (resolvedFolder && mainWindow) {
        mainWindow.webContents.send('navigate-to-folder', { path: resolvedFolder, quoteId })
      }

      // Tell renderer to enter "pick file" mode
      mainWindow?.webContents.send('pick-file-mode', { quoteId, itemId })
    }

    if (parsed.hostname === 'pick-file-dialog') {
      // Native Windows file picker — bypasses PressKit's file browser entirely.
      // Useful for browsing to arbitrary locations (Downloads, Desktop, etc.)
      const quoteId = parsed.searchParams.get('quoteId')
      const itemId = parsed.searchParams.get('itemId')
      const startFolder = parsed.searchParams.get('folder') || undefined

      if (!quoteId || !itemId) return

      const { dialog } = await import('electron')
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: 'Select file for costing',
        defaultPath: startFolder,
        properties: ['openFile'],
        filters: [
          { name: 'Design files', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'tif', 'tiff', 'psd', 'ai', 'eps'] },
          { name: 'All files', extensions: ['*'] },
        ],
      })
      if (result.canceled || result.filePaths.length === 0) return

      try {
        const { linkFileToQuoteItem } = await import('./presscal-client')
        await linkFileToQuoteItem(quoteId, itemId, result.filePaths[0])
        // PressCal quote page auto-refreshes via polling + focus listener
      } catch (e) {
        const { dialog: dlg } = await import('electron')
        showError('File link failed', (e as Error).message)
      }
    }

    if (parsed.hostname === 'pick-gang-file') {
      const quoteId = parsed.searchParams.get('quoteId')
      const gangIdx = parsed.searchParams.get('gangIdx')
      const folder = parsed.searchParams.get('folder') || undefined
      if (!quoteId || gangIdx == null) return

      // Navigate to folder if provided
      if (folder) {
        const { existsSync } = await import('fs')
        if (existsSync(folder)) {
          mainWindow?.webContents.send('navigate-to-folder', { path: folder })
        }
      }

      // Enter pick-file mode for gang — renderer handles the click
      mainWindow?.webContents.send('pick-file-mode', { quoteId, itemId: `gang:${gangIdx}` })
    }

    if (parsed.hostname === 'open-folder') {
      const rawPath = parsed.searchParams.get('path')
      if (!rawPath) return
      const folderPath = resolveDL(rawPath)
      const email = parsed.searchParams.get('email') || ''
      const quoteId = parsed.searchParams.get('quoteId') || ''
      console.log('[DeepLink] open-folder: navigating in PressKit:', folderPath)
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.showInactive()
        mainWindow.setAlwaysOnTop(true)
        mainWindow.moveTop()
        mainWindow.focusOnWebView()
        mainWindow.focus()
        setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(false) }, 200)
        mainWindow.webContents.send('navigate-to-folder', { path: folderPath, email, quoteId })
      }
      return
    }

    if (parsed.hostname === 'download-to-folder') {
      const quoteId = parsed.searchParams.get('quoteId')
      const target = parsed.searchParams.get('target') || 'global'
      const onlyNew = parsed.searchParams.get('onlyNew') === '1'
      const customPath = parsed.searchParams.get('customPath')
      // Single-file mode: PressCal's per-file "save to working folder" button
      const fileLinkId = parsed.searchParams.get('fileLinkId')
      if (!quoteId) return

      const { writeFile, mkdir, access: fsAccess, readdir: rdDir } = await import('fs/promises')
      const { join: pathJoin, basename } = await import('path')
      const { tmpdir } = await import('os')

      const presscalUrl = (store.get('presscal.url') as string)?.replace(/\/$/, '')
      const apiKey = store.get('presscal.apiKey') as string

      if (!presscalUrl || !apiKey) {
        deepLog('[DeepLink] PressCal not configured')
        return
      }

      console.log('[DeepLink] download-to-folder for quote:', quoteId, 'target:', target, 'onlyNew:', onlyNew)

      const sendProgress = (step: string, current: number, total: number, done = false) => {
        mainWindow?.webContents.send('deeplink-progress', { step, current, total, done })
      }
      sendProgress('Fetching file list...', 0, 0)

      // Helper: HTTP GET that returns raw Buffer (bypasses Electron fetch UTF-8 issues)
      const httpGet = (url: string): Promise<{ status: number; body: Buffer }> => {
        return new Promise((resolve, reject) => {
          const mod = url.startsWith('https') ? require('https') : require('http')
          mod.get(url, { headers: { 'Authorization': `Bearer ${apiKey}` } }, (res: any) => {
            // Follow redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              httpGet(res.headers.location).then(resolve).catch(reject)
              return
            }
            const chunks: Buffer[] = []
            res.on('data', (c: Buffer) => chunks.push(c))
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }))
            res.on('error', reject)
          }).on('error', reject)
        })
      }

      // 1. Fetch file list using Node.js http (not Electron fetch) for correct UTF-8
      const listParams = new URLSearchParams({ quoteId, target })
      if (onlyNew) listParams.set('onlyNew', '1')

      const listResult = await httpGet(`${presscalUrl}/api/filehelper/files?${listParams}`)
      if (listResult.status !== 200) {
        console.error('[DeepLink] Failed to fetch files:', listResult.status, listResult.body.toString('utf8').slice(0, 200))
        return
      }

      const data = JSON.parse(listResult.body.toString('utf8'))
      console.log('[DeepLink] folderPath:', data.folderPath)
      console.log('[DeepLink] files:', data.files?.length, 'newCount:', data.newCount)

      let files: Array<{ id?: string; filePath: string; fileName: string; source?: string; subfolder?: string }> = data.files || []

      // Single-file mode: keep only the requested file
      if (fileLinkId) {
        files = files.filter(f => f.id === fileLinkId)
        if (files.length === 0) {
          deepLog(`[DeepLink] fileLinkId ${fileLinkId} not found in quote file list`)
          sendProgress('File not found', 0, 0, true)
          showError('Save file', 'The file was not found in the quote file list.')
          return
        }
      }

      // 2. Resolve target directory
      let quoteFolderPath: string = data.folderPath || ''
      let quoteName = quoteId
      let quoteEmail = ''  // contactEmail or senderEmail from quote

      // Fetch quote details (for folder name and email)
      try {
        const qRes = await httpGet(`${presscalUrl}/api/filehelper/quotes/${encodeURIComponent(quoteId)}`)
        if (qRes.status === 200) {
          const quote = JSON.parse(qRes.body.toString('utf8'))
          const num = quote.number || quoteId
          const customer = (quote.customerName && quote.customerName !== '–') ? quote.customerName : ''
          quoteName = customer ? `[${num}] ${customer}` : `[${num}]`
          quoteName = quoteName.replace(/[<>:"/\\|?*]/g, '_')
          quoteEmail = quote.contactEmail || quote.senderEmail || ''
        }
      } catch {}

      // Resolve portable paths from DB (e.g. <DROPBOX>\... → local absolute)
      if (quoteFolderPath) quoteFolderPath = resolveDL(quoteFolderPath)

      // If no quote folder, create a default name
      if (!quoteFolderPath) {
        quoteFolderPath = pathJoin(tmpdir(), 'PressCal', quoteName)
      }

      let targetDir = quoteFolderPath

      // customPath overrides all folder resolution
      if (customPath) {
        targetDir = resolveDL(customPath)
      }

      // Fix forward slashes on Windows, then normalize path segments (trim each)
      targetDir = targetDir.replace(/\//g, '\\')
      targetDir = targetDir.split('\\').map(s => s.trim()).join('\\')

      // Resolve each segment against disk to handle NFC/NFD and encoding mismatches
      const segments = targetDir.split('\\')
      let resolvedDir = segments[0]
      for (let i = 1; i < segments.length; i++) {
        const seg = segments[i]
        const candidate = resolvedDir + '\\' + seg
        try {
          await fsAccess(candidate)
          resolvedDir = candidate
        } catch {
          // Segment doesn't exist — try ASCII prefix match
          try {
            const children = await rdDir(resolvedDir)
            const asciiPrefix = seg.replace(/[^\x00-\x7F].*/, '').trim()
            const match = asciiPrefix.length >= 3
              ? children.find(c => c.replace(/[^\x00-\x7F].*/, '').trim() === asciiPrefix)
              : null
            if (match) {
              resolvedDir = resolvedDir + '\\' + match
              console.log(`[DeepLink] Resolved "${seg}" → "${match}"`)
            } else {
              resolvedDir = candidate
            }
          } catch {
            resolvedDir = candidate
          }
        }
      }
      targetDir = resolvedDir

      console.log('[DeepLink] Target folder:', targetDir)
      await mkdir(targetDir, { recursive: true })

      // 3. Filter files that already exist locally (skip when onlyNew — PressCal already filtered)
      let filesToDownload: typeof files
      if (onlyNew || fileLinkId) {
        // onlyNew: PressCal says these are new — download even if same filename exists (corrected files)
        // fileLinkId: explicit user action on one file — always download (overwrites corrected files)
        filesToDownload = files
      } else {
        filesToDownload = []
        for (const file of files) {
          const saveName = (file.fileName || basename(file.filePath)).replace(/[/\\:*?"<>|]/g, '_')
          const saveDir = file.subfolder ? pathJoin(targetDir, file.subfolder) : targetDir
          try {
            await fsAccess(pathJoin(saveDir, saveName))
            console.log(`[DeepLink] Exists, skipping: ${saveName}`)
          } catch {
            filesToDownload.push(file)
          }
        }
      }

      console.log(`[DeepLink] ${filesToDownload.length} to download (${files.length - filesToDownload.length} exist)`)

      if (filesToDownload.length === 0) {
        sendProgress('No new files', 0, 0, true)
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.setAlwaysOnTop(true)
          mainWindow.focus()
          setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(false) }, 200)
          mainWindow.webContents.send('navigate-to-folder', { path: targetDir, email: quoteEmail, quoteId })
        }
        return
      }

      // Ask user whether to download new files or just open folder
      // (skipped in single-file mode — the user explicitly asked to save this file)
      if (mainWindow && !fileLinkId) {
        const choice = await new Promise<string>((resolve) => {
          const id = `dl-confirm-${Date.now()}`
          ipcMain.once(`dialog-result:${id}`, (_ev, result: string) => resolve(result))
          mainWindow!.webContents.send('show-choice', {
            id,
            title: 'New files',
            message: `${filesToDownload.length} new file(s) available. Download them?`,
            choices: ['Download', 'Open folder'],
          })
        })
        if (choice === 'Open folder') {
          sendProgress('', 0, 0, true)
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.setAlwaysOnTop(true)
          mainWindow.focus()
          setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(false) }, 200)
          mainWindow.webContents.send('navigate-to-folder', { path: targetDir, email: quoteEmail, quoteId })
          return
        }
        if (choice !== 'Download') {
          sendProgress('', 0, 0, true)
          return
        }
      }

      sendProgress('Downloading files...', 0, filesToDownload.length)

      // 4. Download files
      let downloaded = 0
      const downloadedFileIds: string[] = []

      for (const file of filesToDownload) {
        try {
          const saveName = (file.fileName || basename(file.filePath)).replace(/[/\\:*?"<>|]/g, '_')
          sendProgress(saveName, downloaded, filesToDownload.length)

          // Build download URL
          const fileUrl = file.filePath.startsWith('http')
            ? file.filePath
            : `${presscalUrl}${file.filePath.startsWith('/') ? '' : '/'}${file.filePath}`

          console.log(`[DeepLink] Downloading: ${saveName} from ${fileUrl} (source: ${file.source || 'unknown'}, id: ${file.id || '-'})`)

          const dlResult = await httpGet(fileUrl)
          if (dlResult.status !== 200) {
            console.warn(`[DeepLink] Failed ${saveName}: HTTP ${dlResult.status} — ${dlResult.body.toString('utf8').slice(0, 300)}`)
            continue
          }

          if (dlResult.body.length === 0) {
            console.warn(`[DeepLink] Empty body for ${saveName}, skipping`)
            continue
          }

          const saveDir = file.subfolder ? pathJoin(targetDir, file.subfolder) : targetDir
          if (file.subfolder) await mkdir(saveDir, { recursive: true })
          const savePath = pathJoin(saveDir, saveName)
          await writeFile(savePath, dlResult.body)
          downloaded++
          if (file.id) downloadedFileIds.push(file.id)
          console.log(`[DeepLink] Saved: ${saveName} (${dlResult.body.length} bytes)`)

          // Auto-extract archives (.zip, .rar, .7z)
          const ext = saveName.toLowerCase().split('.').pop() || ''
          if (['zip', 'rar', '7z'].includes(ext)) {
            try {
              const { execFile: ef } = await import('child_process')
              const { promisify: prom } = await import('util')
              const { existsSync: exSync } = await import('fs')
              const { unlink } = await import('fs/promises')
              const execP = prom(ef)

              if (ext === 'zip') {
                const { extractZipRobust } = await import('./zip-extract')
                const zipResult = await extractZipRobust(savePath, saveDir)
                if (zipResult.ok) {
                  await unlink(savePath)
                } else {
                  console.warn(`[DeepLink] All zip extractors failed for ${saveName} — keeping archive: ${zipResult.error}`)
                }
              } else {
                // Find 7-Zip or WinRAR
                const candidates = [
                  'C:\\Program Files\\7-Zip\\7z.exe',
                  'C:\\Program Files (x86)\\7-Zip\\7z.exe',
                  'C:\\Program Files\\WinRAR\\UnRAR.exe',
                  'C:\\Program Files (x86)\\WinRAR\\UnRAR.exe',
                ]
                const tool = candidates.find(p => exSync(p))
                if (tool) {
                  const is7z = tool.toLowerCase().includes('7z')
                  const args = is7z
                    ? ['x', savePath, `-o${saveDir}`, '-y', '-bso0', '-bsp0']
                    : ['x', savePath, saveDir, '-y', '-o+']
                  await execP(tool, args, { timeout: 120000 })
                  await unlink(savePath)
                } else {
                  console.warn(`[DeepLink] No extractor found for ${saveName} — keeping archive`)
                }
              }
            } catch (extractErr) {
              console.warn(`[DeepLink] Extract failed ${saveName}:`, extractErr)
            }
          }
        } catch (dlErr) {
          console.warn(`[DeepLink] Error ${file.fileName}:`, dlErr)
        }
      }

      console.log(`[DeepLink] Done: ${downloaded}/${filesToDownload.length} to ${targetDir}`)

      // 5. Mark files as saved (only the ones actually downloaded)
      if (downloaded > 0) {
        try {
          await fetch(`${presscalUrl}/api/filehelper/files`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              quoteId,
              savedToPath: targetDir,
              ...(downloadedFileIds.length > 0 ? { fileIds: downloadedFileIds } : {}),
            }),
          })
        } catch {}
      }

      // Report failures to user
      const failed = filesToDownload.length - downloaded
      if (failed > 0) {
        console.warn(`[DeepLink] ${failed} file(s) failed to download`)
        mainWindow?.webContents.send('show-alert', {
          title: 'File download',
          message: `${failed} file${failed === 1 ? '' : 's'} failed to download. Try again.`,
        })
      }

      // 6. Save quote context
      try {
        await writeFile(pathJoin(targetDir, '.presskit'), JSON.stringify({ quoteId }), 'utf-8')
      } catch {}

      // 7. Navigate to folder in PressKit
      sendProgress('Done', downloaded, filesToDownload.length, true)
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.setAlwaysOnTop(true)
        mainWindow.focus()
        setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(false) }, 200)
        mainWindow.webContents.send('navigate-to-folder', { path: targetDir, email: quoteEmail, quoteId })
      }
    }
    // Archive a quote folder: presscal-fh://archive-quote?folderPath=C:\...
    // PressCal MUST use the exact folder name "_01 Archive" — it pre-writes
    // jobFolderPath = <parent>/_01 Archive/<basename> in its DB before firing
    // this deep link, and if PressKit uses a different name, DB is out of sync.
    if (parsed.hostname === 'archive-quote') {
      let folderPath = parsed.searchParams.get('folderPath')
      if (!folderPath) {
        deepLog('[DeepLink] archive-quote: missing folderPath')
        showError('Archive', 'No path provided for the quote folder.')
        return
      }

      const { existsSync: fsExists } = await import('fs')
      const { rename: fsRename, mkdir: fsMkdir, access: fsAccess2, readdir: rdDir2, copyFile: fsCopyFile, stat: fsStat2, rm: fsRm } = await import('fs/promises')
      const { join: pathJoin, dirname: pathDirname, basename: pathBasename } = await import('path')

      // Normalize path (same treatment as download-to-folder)
      folderPath = folderPath.replace(/\//g, '\\')
      folderPath = folderPath.split('\\').map(s => s.trim()).join('\\')

      // Segment-by-segment resolution — handles NFC/NFD mismatches and other
      // encoding quirks between PressCal's stored path and the actual disk name.
      if (!fsExists(folderPath)) {
        const segments = folderPath.split('\\')
        let resolved = segments[0]
        for (let i = 1; i < segments.length; i++) {
          const seg = segments[i]
          const candidate = resolved + '\\' + seg
          try {
            await fsAccess2(candidate)
            resolved = candidate
          } catch {
            try {
              const children = await rdDir2(resolved)
              const asciiPrefix = seg.replace(/[^\x00-\x7F].*/, '').trim()
              const match = asciiPrefix.length >= 3
                ? children.find(c => c.replace(/[^\x00-\x7F].*/, '').trim() === asciiPrefix)
                : null
              if (match) {
                resolved = resolved + '\\' + match
                console.log(`[ARCHIVE] Resolved "${seg}" → "${match}"`)
              } else {
                resolved = candidate
              }
            } catch {
              resolved = candidate
            }
          }
        }
        folderPath = resolved
      }

      if (!fsExists(folderPath)) {
        deepLog('[DeepLink] archive-quote: folder not found (already archived or in customer folder):', folderPath)
        // Don't show error — folder may already be archived, deleted, or in a customer folder.
        // Silently skip so the user isn't alarmed.
        return
      }

      const parentDir = pathDirname(folderPath)
      const folderName = pathBasename(folderPath)
      const archiveDir = pathJoin(parentDir, '_01 Archive')
      const targetPath = pathJoin(archiveDir, folderName)

      try {
        await fsMkdir(archiveDir, { recursive: true })

        // Idempotent: if already archived (e.g. retry), just navigate there.
        if (fsExists(targetPath)) {
          console.log(`[ARCHIVE] Already archived, navigating: ${targetPath}`)
          mainWindow?.webContents.send('navigate-to-folder', { path: targetPath })
          return
        }

        // Try a fast rename first. On Dropbox / synced folders this often
        // fails with EPERM/EBUSY because a file handle is held by the sync
        // client or AV. Fall back to recursive copy + delete in that case.
        let renamed = false
        try {
          await fsRename(folderPath, targetPath)
          renamed = true
        } catch (renameErr) {
          console.warn('[ARCHIVE] Rename failed, falling back to copy+delete:', renameErr)
        }

        if (!renamed) {
          const copyDir = async (s: string, d: string) => {
            await fsMkdir(d, { recursive: true })
            const entries = await rdDir2(s, { withFileTypes: true })
            for (const entry of entries) {
              const sp = pathJoin(s, entry.name)
              const dp = pathJoin(d, entry.name)
              if (entry.isDirectory()) await copyDir(sp, dp)
              else await fsCopyFile(sp, dp)
            }
          }

          const srcStat = await fsStat2(folderPath)
          if (srcStat.isDirectory()) {
            await copyDir(folderPath, targetPath)
            // Retry the delete a few times — sync clients may still hold locks
            for (let i = 0; i < 3; i++) {
              try {
                await fsRm(folderPath, { recursive: true, force: true })
                break
              } catch (rmErr) {
                if (i === 2) {
                  console.warn('[ARCHIVE] Copy succeeded but delete of original failed:', rmErr)
                  showError('Archive',
                    `The folder was copied to _01 Archive but the original could not be deleted.\n\n` +
                    `Likely cause: a file locked by Dropbox, antivirus, or another application.\n\n` +
                    `Close anything that may have files open and delete manually:\n${folderPath}`)
                  return
                }
                await new Promise(r => setTimeout(r, 500))
              }
            }
          } else {
            // Shouldn't happen for a quote folder, but handle defensively
            await fsCopyFile(folderPath, targetPath)
            await fsRm(folderPath, { force: true })
          }
        }

        console.log(`[ARCHIVE] Moved: ${folderName} → _01 Archive/${renamed ? '' : ' (via copy+delete)'}`)
        mainWindow?.webContents.send('navigate-to-folder', { path: targetPath })
      } catch (err) {
        console.error('[ARCHIVE] Failed:', err)
        showError('Archive', `Failed to move folder:\n${String(err)}`)
      }
    }

    // Restore a quote folder from archive: presscal-fh://restore-quote?folderPath=...&restorePath=...&quoteId=...
    // Moves the folder from _01 Archive back to its original location, then confirms with PressCal.
    if (parsed.hostname === 'restore-quote') {
      let folderPath = parsed.searchParams.get('folderPath')   // current archived path
      let restorePath = parsed.searchParams.get('restorePath') // target restored path
      const quoteId = parsed.searchParams.get('quoteId') || ''
      if (!folderPath || !restorePath) {
        deepLog('[DeepLink] restore-quote: missing folderPath or restorePath')
        showError('Restore', 'Missing parameters (folderPath / restorePath).')
        return
      }

      const { existsSync: fsExists } = await import('fs')
      const { rename: fsRename, mkdir: fsMkdir, readdir: rdDir2, copyFile: fsCopyFile, rm: fsRm, access: fsAccess2 } = await import('fs/promises')
      const { join: pathJoin, dirname: pathDirname, basename: pathBasename } = await import('path')

      // Resolve portable path placeholders (<DROPBOX> etc.) and normalize
      folderPath = resolveDL(folderPath).replace(/\//g, '\\').split('\\').map(s => s.trim()).join('\\')
      restorePath = resolveDL(restorePath).replace(/\//g, '\\').split('\\').map(s => s.trim()).join('\\')

      // Segment-by-segment resolution (same as archive-quote)
      if (!fsExists(folderPath)) {
        const segments = folderPath.split('\\')
        let resolved = segments[0]
        for (let i = 1; i < segments.length; i++) {
          const seg = segments[i]
          const candidate = resolved + '\\' + seg
          try {
            await fsAccess2(candidate)
            resolved = candidate
          } catch {
            try {
              const children = await rdDir2(resolved)
              const asciiPrefix = seg.replace(/[^\x00-\x7F].*/, '').trim()
              const match = asciiPrefix.length >= 3
                ? children.find(c => c.replace(/[^\x00-\x7F].*/, '').trim() === asciiPrefix)
                : null
              resolved = match ? resolved + '\\' + match : candidate
            } catch {
              resolved = candidate
            }
          }
        }
        folderPath = resolved
      }

      if (!fsExists(folderPath)) {
        deepLog('[DeepLink] restore-quote: folder not found:', folderPath)
        showError('Restore',
          `The archived folder was not found:\n${folderPath}`)
        return
      }

      try {
        // Ensure target parent exists
        await fsMkdir(pathDirname(restorePath), { recursive: true })

        // Idempotent: if already restored, just navigate
        if (fsExists(restorePath)) {
          console.log(`[RESTORE] Already at target, navigating: ${restorePath}`)
          mainWindow?.webContents.send('navigate-to-folder', { path: restorePath, quoteId })
        } else {
          // Try rename first, fallback to copy+delete
          let renamed = false
          try {
            await fsRename(folderPath, restorePath)
            renamed = true
          } catch (renameErr) {
            console.warn('[RESTORE] Rename failed, falling back to copy+delete:', renameErr)
          }

          if (!renamed) {
            const copyDir = async (s: string, d: string) => {
              await fsMkdir(d, { recursive: true })
              const entries = await rdDir2(s, { withFileTypes: true })
              for (const entry of entries) {
                const sp = pathJoin(s, entry.name)
                const dp = pathJoin(d, entry.name)
                if (entry.isDirectory()) await copyDir(sp, dp)
                else await fsCopyFile(sp, dp)
              }
            }
            await copyDir(folderPath, restorePath)

            for (let i = 0; i < 3; i++) {
              try {
                await fsRm(folderPath, { recursive: true, force: true })
                break
              } catch (rmErr) {
                if (i === 2) {
                  console.warn('[RESTORE] Copy succeeded but delete of archive failed:', rmErr)
                  showError('Restore',
                    `The folder was copied but the archived copy could not be deleted.\n\n` +
                    `Close anything that may have files open and delete manually:\n${folderPath}`)
                }
                await new Promise(r => setTimeout(r, 500))
              }
            }
          }

          console.log(`[RESTORE] Moved: ${pathBasename(folderPath)} → ${restorePath}${renamed ? '' : ' (via copy+delete)'}`)
          mainWindow?.webContents.send('navigate-to-folder', { path: restorePath, quoteId })
        }

        // Confirm restore with PressCal (non-blocking)
        if (quoteId) {
          const presscalUrl = (store.get('presscal.url') as string)?.replace(/\/$/, '')
          const apiKey = store.get('presscal.apiKey') as string
          if (presscalUrl && apiKey) {
            fetch(`${presscalUrl}/api/filehelper/quotes/${quoteId}/confirm-restore`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ restoredPath: restorePath }),
            }).catch(err => console.warn('[RESTORE] confirm-restore failed (non-critical):', err.message))
          }
        }
      } catch (err) {
        console.error('[RESTORE] Failed:', err)
        showError('Restore', `Failed to restore folder:\n${String(err)}`)
      }
    }

    if (parsed.hostname === 'connect') {
      const url = parsed.searchParams.get('url')
      const apiKey = parsed.searchParams.get('apiKey')
      // ?addProfile=1 → create a NEW profile and switch to it (cold-swap restart).
      // Without that flag → write into the active profile, like before.
      const addProfile = parsed.searchParams.get('addProfile') === '1'
      const orgName = parsed.searchParams.get('orgName') ?? undefined
      const email = parsed.searchParams.get('email') ?? undefined

      if (url && apiKey) {
        const cleanUrl = url.replace(/\/$/, '')

        // A profile name counts as "auto-derived" (safe to overwrite on
        // reconnect) when the user never typed it themselves: it's the
        // generic default or it mirrors the profile's own email / org /
        // hostname. Keeps the fix for the 02/08 «καπάρωμα»: a profile that
        // changed accounts kept its stale name next to fresh credentials.
        const isAutoName = (p: { name?: string; email?: string; orgName?: string }): boolean => {
          if (!p.name || p.name === 'Default' || p.name === 'New profile') return true
          if (p.email && p.name === p.email) return true
          if (p.orgName && p.name === p.orgName) return true
          try { if (p.name === new URL(cleanUrl).hostname.replace(/^www\./, '')) return true } catch {}
          return false
        }

        if (addProfile) {
          // Upsert by URL + account: multiple accounts (orgs) can live on the
          // SAME PressCal instance (e.g. a demo user and the owner, both on eu).
          // Matching by URL alone overwrote the first profile's credentials
          // with a different org's key — so when the deep link carries an
          // email, only a profile with that same email is an update target;
          // any other account on the same URL gets a NEW profile.
          const existingProfiles = listProfiles()
          const existing = existingProfiles.find(p =>
            p.presscalUrl === cleanUrl && (!email || !p.email || p.email === email)
          )

          // Reconnecting the profile that's already active needs no restart —
          // fall through to the in-place path below, same as a plain connect.
          if (!existing || existing.id !== getActiveProfileId()) {
            let profileId: string
            let profileName: string
            let isNew = false
            if (existing) {
              // Update existing profile's credentials & metadata
              const patch: Record<string, string> = {}
              if (email) patch.email = email
              if (orgName) patch.orgName = orgName
              if (isAutoName(existing)) {
                const synced = email || orgName
                if (synced && synced !== existing.name) patch.name = synced
              }
              const updated = updateProfile(existing.id, patch)
              profileId = existing.id
              profileName = updated?.name || existing.name
              deepLog('[DeepLink] Updated existing profile:', profileId)
            } else {
              // Create new profile
              isNew = true
              const suggestedName = email || orgName || (() => {
                try { return new URL(cleanUrl).hostname.replace(/^www\./, '') } catch { return 'New profile' }
              })()
              const profile = createProfile({ name: suggestedName, email, presscalUrl: cleanUrl })
              profileId = profile.id
              profileName = profile.name
              deepLog('[DeepLink] Created new profile:', profileId)
            }

            // Stash the credentials in the profile's store before we switch
            // (we have to write them via a temp store since `store` proxies to
            // the active profile, which is still the OLD one).
            const StoreModule = await import('electron-store')
            const path = await import('path')
            const profileStore = new StoreModule.default({
              name: 'config',
              cwd: path.join(app.getPath('userData'), 'profiles', profileId),
            })
            profileStore.set('presscal.url', cleanUrl)
            profileStore.set('presscal.apiKey', apiKey)

            // Tell the user what just happened BEFORE the cold-swap restart —
            // without this the window simply vanishes and the connect looks
            // like a crash (the 02/08 first-run test verdict).
            const parentWin = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
            const dialogOpts = {
              type: 'info' as const,
              title: 'PressKit',
              message: `Connected: ${email || orgName || cleanUrl}`,
              detail:
                `${cleanUrl}\n\n` +
                (isNew
                  ? `New profile "${profileName}" created.`
                  : `Profile "${profileName}" updated.`) +
                `\n\nPressKit will now restart to switch to this profile.`,
              buttons: ['OK'],
            }
            if (parentWin) dialog.showMessageBoxSync(parentWin, dialogOpts)
            else dialog.showMessageBoxSync(dialogOpts)

            // Switch to the profile (restarts the app)
            switchProfile(profileId)
            return
          }
          deepLog('[DeepLink] addProfile matched the active profile — updating in place, no restart')
        }

        store.set('presscal.url', cleanUrl)
        store.set('presscal.apiKey', apiKey)

        // Update active profile metadata so the ProfileSwitcher shows a
        // meaningful name instead of "Default" (or a stale auto-derived one).
        const activeProfile = getActiveProfile()
        if (activeProfile) {
          const patch: Record<string, string> = { presscalUrl: cleanUrl }
          if (email) patch.email = email
          if (orgName) patch.orgName = orgName
          if (isAutoName(activeProfile)) {
            const synced = email || orgName
            if (synced && synced !== activeProfile.name) patch.name = synced
          }
          updateProfile(activeProfile.id, patch)
        }

        deepLog('[DeepLink] Connected to PressCal:', url)
        mainWindow?.webContents.send('presscal-connected', { url, apiKey })

        // Re-check license immediately so the LicenseGate unlocks without
        // waiting for the next 6h poll. broadcastStatus inside checkLicense
        // pushes the new state to the renderer.
        const status = await checkLicense()
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('license:changed', status)
          }
        }

        const successMsg = status.active
          ? (status.isTrial
              ? `Connected! Your ${status.daysLeft}-day trial has started.`
              : 'Connected to PressCal!')
          : `Connected, but the license is not active.\n(${status.state})`
        mainWindow?.webContents.send('show-alert', { title: 'PressCal', message: successMsg })
      }
    }
  } catch (e) {
    deepLog('[DeepLink] ERROR:', String(e))
  }
}

// ─── Pending Archives Poller ──────────────────────────────────────
// Polls PressCal for quotes that were soft-deleted and need archiving.
// For each pending archive: move folder → _01 Archive, then POST confirm-archive.
// If pendingDelete=true, PressCal will hard-delete the quote record on confirm.

let pendingArchivesTimer: ReturnType<typeof setInterval> | null = null

function startPendingArchivesPoller() {
  // Initial check after 5s (let app settle), then every 5 minutes.
  // Archiving is not time-critical, and each poll wakes the PressCal DB —
  // Neon bills compute per active hour and only sleeps after 5 quiet minutes,
  // so a 30s poll from any shop PC kept the DB awake (and billed) 24/7.
  setTimeout(() => processPendingArchives(), 5000)
  pendingArchivesTimer = setInterval(() => processPendingArchives(), 5 * 60 * 1000)
}

async function processPendingArchives() {
  const presscalUrl = (store.get('presscal.url') as string)?.replace(/\/$/, '')
  const apiKey = store.get('presscal.apiKey') as string
  if (!presscalUrl || !apiKey) return

  try {
    const res = await fetch(`${presscalUrl}/api/filehelper/pending-archives`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })
    if (res.status !== 200) return

    const data = await res.json()
    const archives: Array<{
      quoteId: string
      sourcePath: string
      destPath: string
      number?: string
    }> = data.items || data || []

    if (!archives || archives.length === 0) return
    console.log(`[ARCHIVE-POLL] Found ${archives.length} pending archives`)

    const { existsSync } = await import('fs')
    const { rename, mkdir, copyFile, stat, rm, readdir, access } = await import('fs/promises')
    const { join: pJoin, dirname, basename } = await import('path')

    for (const entry of archives) {
      const quoteId = entry.quoteId
      let folderPath = entry.sourcePath
      if (!folderPath) {
        console.warn(`[ARCHIVE-POLL] No sourcePath for quote ${quoteId}, skipping`)
        continue
      }

      // Normalize path
      folderPath = folderPath.replace(/\//g, '\\').split('\\').map(s => s.trim()).join('\\')

      // Segment-by-segment resolution (NFC/NFD and encoding mismatches)
      if (!existsSync(folderPath)) {
        const segments = folderPath.split('\\')
        let resolved = segments[0]
        for (let i = 1; i < segments.length; i++) {
          const seg = segments[i]
          const candidate = resolved + '\\' + seg
          try {
            await access(candidate)
            resolved = candidate
          } catch {
            try {
              const children = await readdir(resolved)
              const asciiPrefix = seg.replace(/[^\x00-\x7F].*/, '').trim()
              const match = asciiPrefix.length >= 3
                ? children.find(c => c.replace(/[^\x00-\x7F].*/, '').trim() === asciiPrefix)
                : null
              resolved = match ? resolved + '\\' + match : candidate
            } catch { resolved = candidate }
          }
        }
        folderPath = resolved
      }

      // Compute target path from API destPath or derive from source
      let targetPath = entry.destPath
      if (targetPath) {
        targetPath = targetPath.replace(/\//g, '\\').split('\\').map(s => s.trim()).join('\\')
      } else {
        const parentDir = dirname(folderPath)
        const folderName = basename(folderPath)
        targetPath = pJoin(parentDir, '_01 Archive', folderName)
      }
      const archiveDir = dirname(targetPath)

      // If folder doesn't exist, it may have already been archived or deleted
      if (!existsSync(folderPath)) {
        console.log(`[ARCHIVE-POLL] Folder not found (already archived?): ${folderPath}`)
        // Still confirm so PressCal can clean up
        try {
          await fetch(`${presscalUrl}/api/filehelper/quotes/${encodeURIComponent(quoteId)}/confirm-archive`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ newFolderPath: targetPath }),
          })
          console.log(`[ARCHIVE-POLL] Confirmed (folder missing): ${quoteId}`)
        } catch (e) { console.warn(`[ARCHIVE-POLL] confirm-archive failed:`, e) }
        continue
      }

      try {
        await mkdir(archiveDir, { recursive: true })

        if (existsSync(targetPath)) {
          console.log(`[ARCHIVE-POLL] Already in archive: ${targetPath}`)
        } else {
          // Try rename, fallback to copy+delete
          let renamed = false
          try {
            await rename(folderPath, targetPath)
            renamed = true
          } catch {
            // Copy + delete fallback
            const copyDir = async (s: string, d: string) => {
              await mkdir(d, { recursive: true })
              const entries = await readdir(s, { withFileTypes: true })
              for (const e of entries) {
                const sp = pJoin(s, e.name), dp = pJoin(d, e.name)
                if (e.isDirectory()) await copyDir(sp, dp)
                else await copyFile(sp, dp)
              }
            }
            const srcStat = await stat(folderPath)
            if (srcStat.isDirectory()) {
              await copyDir(folderPath, targetPath)
              try { await rm(folderPath, { recursive: true, force: true }) } catch {}
            }
          }
          console.log(`[ARCHIVE-POLL] Archived: ${folderName}${renamed ? '' : ' (copy+delete)'}`)
        }

        // Confirm archive with PressCal
        await fetch(`${presscalUrl}/api/filehelper/quotes/${encodeURIComponent(quoteId)}/confirm-archive`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ newFolderPath: targetPath }),
        })
        console.log(`[ARCHIVE-POLL] Confirmed: ${quoteId}`)
      } catch (err) {
        console.error(`[ARCHIVE-POLL] Failed to archive ${folderName}:`, err)
      }
    }
  } catch (err) {
    // Silently fail — network errors, PressCal offline, etc.
    // Will retry on next poll cycle
  }
}

function createWindow(): void {
  const savedTheme = store.get('ui.theme', 'light') as string
  const isLight = savedTheme === 'light'
  // Match the new teal palette so the splash flash before React mounts isn't
  // jarringly wrong-colored.
  const bgColor = isLight ? '#f5f9f9' : '#173a49'
  const overlayColor = isLight ? '#ebf3f3' : '#12303d'
  const symbolColor = isLight ? '#173a49' : '#dcdcdc'

  // Without this, BrowserWindow falls back to the default Electron atom
  // logo for the taskbar / window icon, even though electron-builder
  // correctly stamps the rhino on the installer .exe.
  //
  // Use a real filesystem path (NOT an asar-bundled path) — Windows native
  // icon loading doesn't transparently resolve asar paths. The icon is
  // shipped as an extraResource in package.json so it lives unpacked at
  // <install>/resources/icon.ico in production. In dev it's still in the
  // source tree.
  const iconPath = is.dev
    ? join(__dirname, '../../resources/icon.ico')
    : join(process.resourcesPath, 'icon.ico')

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: bgColor,
    icon: iconPath,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: overlayColor,
      symbolColor,
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

  // Intercept window close: if fullscreen preview is open, close preview instead of app
  let fullscreenPreviewOpen = false
  ipcMain.on('fullscreen-preview-state', (_e, open: boolean) => {
    fullscreenPreviewOpen = open
  })
  mainWindow.on('close', (e) => {
    if (fullscreenPreviewOpen && mainWindow && !mainWindow.isDestroyed()) {
      e.preventDefault()
      mainWindow.webContents.send('close-fullscreen-preview')
    }
  })

  // Fallback: show window after 5s even if renderer didn't fire ready-to-show
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show()
    }
  }, 5000)

  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('Window failed to load:', code, desc)
    mainWindow?.show()
  })

  // Detect renderer process crashes (e.g. out-of-memory, native module failure).
  // This is the cause of blank/grey windows when React itself isn't running.
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[render-process-gone]', details.reason, 'exitCode:', details.exitCode)
    // Offer the user a chance to reload rather than leaving a dead window
    if (details.reason !== 'clean-exit' && mainWindow && !mainWindow.isDestroyed()) {
      const { dialog: d } = require('electron') as typeof import('electron')
      d.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Application error',
        message: 'The window stopped unexpectedly',
        detail: `Reason: ${details.reason}\nExit code: ${details.exitCode}`,
        buttons: ['Reload', 'Close'],
        defaultId: 0,
        cancelId: 1
      }).then(result => {
        if (result.response === 0) mainWindow?.webContents.reload()
        else mainWindow?.close()
      })
    }
  })

  mainWindow.webContents.on('unresponsive', () => {
    console.warn('[webContents] renderer became unresponsive')
  })

  // Enable F12 / Ctrl+Shift+I for DevTools regardless of dev/prod, so we can
  // diagnose issues in production builds.
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return
    const isF12 = input.key === 'F12'
    const isCtrlShiftI = input.control && input.shift && input.key.toLowerCase() === 'i'
    if (isF12 || isCtrlShiftI) {
      mainWindow?.webContents.toggleDevTools()
    }
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

// ─── Export imposition (server-side PDF generation) ───

const MM_PT = 72 / 25.4 // mm → PDF points

function findGsExe(): string | null {
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files'
  const gsRoot = require('path').join(programFiles, 'gs')
  const fs = require('fs')
  if (!fs.existsSync(gsRoot)) return null
  try {
    const versions = fs.readdirSync(gsRoot, { withFileTypes: true })
      .filter((d: any) => d.isDirectory() && d.name.startsWith('gs'))
      .sort((a: any, b: any) => b.name.localeCompare(a.name))
    for (const ver of versions) {
      const exe = require('path').join(gsRoot, ver.name, 'bin', 'gswin64c.exe')
      if (fs.existsSync(exe)) return exe
    }
  } catch {}
  return null
}

async function handleExportImposition(body: any): Promise<{
  success: boolean
  outputPath?: string
  error?: string
}> {
  try {
    const { PDFDocument, rgb } = await import('pdf-lib')
    const fs = await import('fs')
    const fsp = await import('fs/promises')
    const path = await import('path')
    const os = await import('os')
    const { execFile } = await import('child_process')

    // Yield to event loop so UI stays responsive
    const yieldEL = (): Promise<void> => new Promise(r => setImmediate(r))

    const {
      imposition: impo,
      gangJobFilePaths,
      gangCellAssign,
      bleed,
      gutter,
      gutterY,
      isDuplex,
      duplexOrient,
      contentScale,
      showCropMarks,
      outputPath,
    } = body

    const cols = impo.cols || 1
    const rows = impo.rows || 1
    const bleedPt = (bleed || 0) * MM_PT
    const gutterPt = (gutter || 0) * MM_PT
    const gutterYPt = (gutterY ?? gutter ?? 0) * MM_PT
    const trimWpt = impo.trimW * MM_PT
    const trimHpt = impo.trimH * MM_PT
    const paperWpt = impo.paperW * MM_PT
    const paperHpt = impo.paperH * MM_PT
    const mL = (impo.marginL ?? 0) * MM_PT
    const mB = (impo.marginB ?? 0) * MM_PT
    const printableW = paperWpt - mL - (impo.marginR ?? 0) * MM_PT
    const printableH = paperHpt - (impo.marginT ?? 0) * MM_PT - mB
    const trimGridW = cols * trimWpt + Math.max(0, cols - 1) * gutterPt
    const trimGridH = rows * trimHpt + Math.max(0, rows - 1) * gutterYPt
    const cenX = mL + (printableW - trimGridW) / 2
    const cenY = mB + (printableH - trimGridH) / 2
    const trimStepW = trimWpt + gutterPt
    const trimStepH = trimHpt + gutterYPt
    const cScale = (contentScale || 100) / 100
    const isH2F = duplexOrient === 'h2f'

    // Debug log to file
    const _logLines: string[] = []
    const _dlog = (msg: string) => { _logLines.push(msg); try { console.log(msg) } catch {} }
    _dlog(`[IMPO] bleed=${bleed}mm (${bleedPt.toFixed(1)}pt), showCropMarks=${showCropMarks}, cScale=${cScale}, trim=${impo.trimW}x${impo.trimH}mm, paper=${impo.paperW}x${impo.paperH}mm`)

    // Load source PDFs ONCE — keep parsed docs in memory for reuse across sheets
    interface TrimRect { x: number; y: number; width: number; height: number }
    interface GangSource {
      srcDoc: any          // PDFDocument — kept alive for embedding
      pageCount: number
      trims: TrimRect[]
      mediaBoxes: TrimRect[]
    }
    interface EmbedInfo { ep: any; bleedL: number; bleedB: number }
    const gangSources: GangSource[] = []
    for (const filePath of gangJobFilePaths || []) {
      if (!filePath) {
        gangSources.push({ srcDoc: null, pageCount: 0, trims: [], mediaBoxes: [] })
        continue
      }
      const resolved = resolvePortablePath(filePath)
      await yieldEL()
      let bytes: Buffer | null = await fsp.readFile(resolved)
      await yieldEL()
      const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true })
      bytes = null
      await yieldEL()
      const pages = srcDoc.getPages()
      const mediaBoxes: TrimRect[] = []
      const trims: TrimRect[] = pages.map((p: any) => {
        const tb = p.getTrimBox()
        const mb = p.getMediaBox()
        mediaBoxes.push({ x: mb.x, y: mb.y, width: mb.width, height: mb.height })
        if (tb && (tb.x !== mb.x || tb.y !== mb.y || tb.width !== mb.width || tb.height !== mb.height)) {
          return { x: tb.x, y: tb.y, width: tb.width, height: tb.height }
        }
        return { x: mb.x, y: mb.y, width: mb.width, height: mb.height }
      })
      gangSources.push({ srcDoc, pageCount: pages.length, trims, mediaBoxes })
    }

    // Calculate sheets — in gang mode each sheet side shows 1 source page per title
    // (repeated across all rows), so each sheet consumes 1 (simplex) or 2 (duplex) pages
    const pagesPerSheet = isDuplex ? 2 : 1
    const maxPages = gangSources.reduce((mx, s) => Math.max(mx, s.pageCount), 0)
    const totalSheets = Math.max(1, Math.ceil(maxPages / pagesPerSheet))
    try { console.log(`[IMPOSITION] ${totalSheets} sheets, ${isDuplex ? 'duplex' : 'simplex'}`) } catch {}

    // Create temp dir for per-sheet PDFs
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'impo-'))
    const sheetFiles: string[] = []

    // For each sheet: create a small PDF, embed only needed pages from cached source docs
    for (let sheetIdx = 0; sheetIdx < totalSheets; sheetIdx++) {
      const sheetDoc = await PDFDocument.create()

      // Determine which source pages are needed for this sheet
      const neededPages: Map<number, Set<number>> = new Map()
      const sides = isDuplex ? [false, true] : [false]
      for (const isBack of sides) {
        for (let col = 0; col < cols; col++) {
          const posIdx = col // just check first row — all rows have same page
          const jobIdx = gangCellAssign?.[posIdx] ?? 0
          const pageInBook = sheetIdx * pagesPerSheet + (isBack ? 1 : 0)
          if (jobIdx < gangSources.length && pageInBook < gangSources[jobIdx].pageCount) {
            if (!neededPages.has(jobIdx)) neededPages.set(jobIdx, new Set())
            neededPages.get(jobIdx)!.add(pageInBook)
          }
        }
      }

      // Embed needed pages from cached source docs (no file re-reads!)
      const embeddedMap: Map<string, EmbedInfo> = new Map()
      for (const [jobIdx, pageIndices] of neededPages) {
        const src = gangSources[jobIdx]
        if (!src.srcDoc) continue
        const srcPages = src.srcDoc.getPages()
        for (const pi of pageIndices) {
          const trim = src.trims[pi]
          const mb = src.mediaBoxes[pi]
          // Clip to trim + bleed, clamped to media box
          const clipL = Math.max(trim.x - bleedPt, mb.x)
          const clipB = Math.max(trim.y - bleedPt, mb.y)
          const clipR = Math.min(trim.x + trim.width + bleedPt, mb.x + mb.width)
          const clipT = Math.min(trim.y + trim.height + bleedPt, mb.y + mb.height)
          if (pi === 0) _dlog(`[IMPO] job${jobIdx} p${pi}: trim=(${trim.x.toFixed(1)},${trim.y.toFixed(1)},${trim.width.toFixed(1)},${trim.height.toFixed(1)}) mb=(${mb.x.toFixed(1)},${mb.y.toFixed(1)},${mb.width.toFixed(1)},${mb.height.toFixed(1)}) clip=(${clipL.toFixed(1)},${clipB.toFixed(1)},${clipR.toFixed(1)},${clipT.toFixed(1)}) bleedL=${(trim.x-clipL).toFixed(1)} bleedB=${(trim.y-clipB).toFixed(1)}`)
          const [ep] = await sheetDoc.embedPages([srcPages[pi]], [{
            left: clipL,
            bottom: clipB,
            right: clipR,
            top: clipT,
          }])
          embeddedMap.set(`${jobIdx}:${pi}`, {
            ep,
            bleedL: trim.x - clipL,
            bleedB: trim.y - clipB,
          })
        }
        await yieldEL()
      }

      // Compute trim position for a cell (shared by content placement + crop marks)
      const cellTrimPos = (row: number, col: number, isBack: boolean): { trimX: number; trimY: number } => {
        const frontTrimX = cenX + col * trimStepW
        const trimYpos = cenY + (rows - 1 - row) * trimStepH
        if (isBack && isH2F) return { trimX: frontTrimX, trimY: paperHpt - trimYpos - trimHpt }
        if (isBack) return { trimX: paperWpt - frontTrimX - trimWpt, trimY: trimYpos }
        return { trimX: frontTrimX, trimY: trimYpos }
      }

      // Draw sides
      const drawSide = (page: any, isBack: boolean): void => {
        // Place content — trim-box aligned, natural scale
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const posIdx = row * cols + col
            const jobIdx = gangCellAssign?.[posIdx] ?? 0
            const pageInBook = sheetIdx * pagesPerSheet + (isBack ? 1 : 0)
            const info = embeddedMap.get(`${jobIdx}:${pageInBook}`)
            if (!info) continue

            const { trimX, trimY } = cellTrimPos(row, col, isBack)

            // Place at natural size (cScale), aligning source trim to cell trim
            page.drawPage(info.ep, {
              x: trimX - info.bleedL * cScale,
              y: trimY - info.bleedB * cScale,
              xScale: cScale,
              yScale: cScale,
            })
          }
        }

        // Crop marks — PERIMETER ONLY, matching presscal-next (commit dec7c2c there).
        // The old per-cell corner marks extended into neighboring cells on interior
        // positions (markOff+markLen > gutter) — the blade lands on them and they
        // survive on the finished product. Perimeter ticks flag every cut line from
        // outside the grid, which is all a full-stroke guillotine can follow.
        if (showCropMarks) {
          const markLen = 5 * MM_PT   // 5 mm line length
          const markOff = bleedPt + 0.5 * MM_PT // start just outside bleed
          const markColor = rgb(0, 0, 0)
          const markThk = 0.5

          const uX: number[] = []
          for (let col = 0; col < cols; col++) {
            const { trimX } = cellTrimPos(0, col, isBack)
            uX.push(trimX, trimX + trimWpt)
          }
          const uY: number[] = []
          for (let row = 0; row < rows; row++) {
            const { trimY } = cellTrimPos(row, 0, isBack)
            uY.push(trimY, trimY + trimHpt)
          }
          const gL = Math.min(...uX), gR = Math.max(...uX)
          const gB = Math.min(...uY), gT = Math.max(...uY)

          for (const vx of uX) {
            page.drawLine({ start: { x: vx, y: gT + markOff }, end: { x: vx, y: gT + markOff + markLen }, thickness: markThk, color: markColor })
            page.drawLine({ start: { x: vx, y: gB - markOff }, end: { x: vx, y: gB - markOff - markLen }, thickness: markThk, color: markColor })
          }
          for (const hy of uY) {
            page.drawLine({ start: { x: gL - markOff, y: hy }, end: { x: gL - markOff - markLen, y: hy }, thickness: markThk, color: markColor })
            page.drawLine({ start: { x: gR + markOff, y: hy }, end: { x: gR + markOff + markLen, y: hy }, thickness: markThk, color: markColor })
          }
        }
      }

      const frontPage = sheetDoc.addPage([paperWpt, paperHpt])
      drawSide(frontPage, false)
      if (isDuplex) {
        const backPage = sheetDoc.addPage([paperWpt, paperHpt])
        drawSide(backPage, true)
      }

      // Save this sheet to temp file
      const sheetPath = path.join(tmpDir, `sheet_${String(sheetIdx).padStart(4, '0')}.pdf`)
      const sheetBytes = await sheetDoc.save()
      await fsp.writeFile(sheetPath, sheetBytes)
      sheetFiles.push(sheetPath)
      await yieldEL()
    }

    // Merge all sheets with Ghostscript (handles any size, streams to disk)
    const resolvedOutput = resolvePortablePath(outputPath)
    await fsp.mkdir(path.dirname(resolvedOutput), { recursive: true })

    const gs = findGsExe()
    if (gs && sheetFiles.length > 1) {
      try { console.log(`[IMPOSITION] Merging ${sheetFiles.length} sheets with Ghostscript...`) } catch {}
      await new Promise<void>((resolve, reject) => {
        execFile(gs, [
          '-dNOPAUSE', '-dBATCH', '-dQUIET',
          '-sDEVICE=pdfwrite',
          '-dCompatibilityLevel=1.5',
          `-sOutputFile=${resolvedOutput}`,
          ...sheetFiles,
        ], { timeout: 600000, windowsHide: true }, (err) => err ? reject(err) : resolve())
      })
    } else if (sheetFiles.length === 1) {
      await fsp.copyFile(sheetFiles[0], resolvedOutput)
    } else {
      // Fallback: merge with pdf-lib (smaller jobs)
      const mergedDoc = await PDFDocument.create()
      for (const sf of sheetFiles) {
        let bytes: Buffer | null = await fsp.readFile(sf)
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
        bytes = null
        const copied = await mergedDoc.copyPages(src, src.getPageIndices())
        for (const p of copied) mergedDoc.addPage(p)
        await yieldEL()
      }
      const merged = await mergedDoc.save()
      await fsp.writeFile(resolvedOutput, merged)
    }

    // Cleanup temp files
    for (const sf of sheetFiles) { try { await fsp.unlink(sf) } catch {} }
    try { await fsp.rmdir(tmpDir) } catch {}

    _dlog(`[IMPO] Done: ${resolvedOutput}`)
    // Write debug log to temp
    try { await fsp.writeFile(path.join(os.tmpdir(), 'impo-debug.log'), _logLines.join('\n')) } catch {}
    return { success: true, outputPath: resolvedOutput }
  } catch (err) {
    try { console.error('[IMPOSITION] Error:', err) } catch {}
    return { success: false, error: (err as Error).message }
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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', '*')

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return }

    const parsed = urlMod.parse(req.url, true)

    // Debug: log every request to temp file
    try { fs.appendFileSync('C:\\Users\\info\\presskit-server.log', `${new Date().toISOString()} ${req.method} ${req.url}\n`) } catch (e: any) { try { fs.writeFileSync('C:\\Users\\info\\presskit-log-error.txt', String(e)) } catch {} }

    // Health check: GET /health → { ok: true }
    if (parsed.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    // Cloud roots: GET /roots → [{ placeholder, label, localPath }]
    if (parsed.pathname === '/roots') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(getCloudRoots()))
      return
    }

    // POST /?save=C:\path\to\file.pdf — save uploaded file to disk
    if (req.method === 'POST' && parsed.query.save) {
      const savePath = resolvePortablePath(parsed.query.save as string)
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', async () => {
        try {
          const fsp = require('fs/promises')
          const dir = pathMod.dirname(savePath)
          await fsp.mkdir(dir, { recursive: true })
          // Auto-increment filename if file exists: file.pdf → file_2.pdf → file_3.pdf
          let finalPath = savePath
          const ext = pathMod.extname(savePath)
          const base = savePath.slice(0, -ext.length)
          let n = 1
          while (true) {
            try { await fsp.access(finalPath); } catch { break }
            n++
            finalPath = `${base}_${n}${ext}`
          }
          await fsp.writeFile(finalPath, Buffer.concat(chunks))
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, path: finalPath }))
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: e.message }))
        }
      })
      return
    }

    // POST /?exportImposition=1 — server-side PDF imposition export
    if (req.method === 'POST' && parsed.query.exportImposition) {
      let bodyStr = ''
      req.on('data', (chunk: string) => (bodyStr += chunk))
      req.on('end', async () => {
        try {
          const payload = JSON.parse(bodyStr)
          const result = await handleExportImposition(payload)
          res.writeHead(result.success ? 200 : 500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result))
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }))
        }
      })
      return
    }

    // Create folder: GET /?createFolder=1&parentPath=<DROPBOX>/...&name=FolderName
    if (parsed.query.createFolder) {
      ;(async () => {
        try {
          const { join: pJoin } = await import('path')
          const { mkdir } = await import('fs/promises')
          const rawParent = (parsed.query.parentPath as string) || ''
          const name = (parsed.query.name as string) || ''
          if (!name) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing name parameter' }))
            return
          }
          const parentPath = rawParent ? resolvePortablePath(rawParent) : (resolvePortablePath('<DROPBOX>'))
          const fullPath = pJoin(parentPath, name.replace(/[<>:"/\\|?*]/g, '_').trim())
          await mkdir(fullPath, { recursive: true })
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ path: toPortablePath(fullPath) }))
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: e.message }))
        }
      })()
      return
    }

    // Pick folder dialog: GET /?pickFolder=1 → opens native folder picker,
    // returns { path: "..." } or { canceled: true }. Used by PressCal forms
    // (e.g. "Νέα εταιρεία") to set a folder without typing a path.
    if (parsed.query.pickFolder) {
      ;(async () => {
        try {
          const { dialog } = await import('electron')
          // Bring PressKit window to front on Windows (focus alone is not enough)
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore()
            mainWindow.setAlwaysOnTop(true)
            mainWindow.focus()
            mainWindow.setAlwaysOnTop(false)
          }
          const rawDefault = parsed.query.defaultPath as string | undefined
          const defaultPath = rawDefault ? resolvePortablePath(rawDefault) : undefined
          const result = await dialog.showOpenDialog(mainWindow!, {
            title: 'Select Customer Folder',
            properties: ['openDirectory'],
            defaultPath,
          })
          res.writeHead(200, { 'Content-Type': 'application/json' })
          if (result.canceled || result.filePaths.length === 0) {
            res.end(JSON.stringify({ canceled: true }))
          } else {
            let chosen = result.filePaths[0]
            const createSub = parsed.query.createSub as string | undefined
            if (createSub) {
              const safeName = createSub.replace(/[<>:"/\\|?*]/g, '_').trim()
              if (safeName) {
                const { join: pJoin } = await import('path')
                const { mkdir: mkDir } = await import('fs/promises')
                chosen = pJoin(chosen, safeName)
                await mkDir(chosen, { recursive: true })
              }
            }
            res.end(JSON.stringify({ path: toPortablePath(chosen) }))
          }
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: e.message }))
        }
      })()
      return
    }

    // Refresh: GET /?refresh=C:\path\to\folder → tells renderer to navigate/refresh that folder
    if (parsed.query.refresh) {
      const refreshPath = resolvePortablePath(parsed.query.refresh as string)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('navigate-to-folder', { path: refreshPath })
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.focus()
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    // Directory listing: GET /?list=C:\path\to\folder → returns JSON array of PDF filenames
    const listDir = parsed.query.list ? resolvePortablePath(parsed.query.list as string) : null
    if (listDir) {
      ;(async () => {
        try {
          const fsp = require('fs/promises')
          await fsp.access(listDir)
          const all = await fsp.readdir(listDir)
          const entries = all.filter((f: string) => /\.(pdf|jpg|jpeg|png|tif|tiff|ai|psd|eps)$/i.test(f))
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(entries))
        } catch { res.writeHead(404); res.end('[]') }
      })()
      return
    }

    const filePath = parsed.query.path ? resolvePortablePath(parsed.query.path as string) : null

    if (!filePath) { res.writeHead(404); res.end('Not found'); return }

    ;(async () => {
      try {
        const fsp = require('fs/promises')
        const fileStat = await fsp.stat(filePath)
        const ext = pathMod.extname(filePath).toLowerCase()
        const mime = mimeTypes[ext] || 'application/octet-stream'

        res.writeHead(200, {
          'Content-Type': mime,
          'Content-Length': fileStat.size,
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(pathMod.basename(filePath))}`,
        })

        fs.createReadStream(filePath).pipe(res)
      } catch {
        res.writeHead(404); res.end('Not found')
      }
    })()
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
  registerSearchHandlers(ipcMain)
  registerToolHandlers(ipcMain)
  registerLicenseHandlers(ipcMain)
  registerProfileHandlers(ipcMain)
  registerCloudRootsHandlers(ipcMain)

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

  // "Open with" — find installed design apps
  let cachedApps: { id: string; name: string; path: string; extensions: string[] }[] | null = null
  ipcMain.handle('apps:getOpenWith', async (_e, extension: string) => {
    if (!cachedApps) {
      const { existsSync } = await import('fs')
      const { readdirSync } = await import('fs')

      const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files'
      const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'

      // Known design apps with their typical paths and supported extensions
      const knownApps: { id: string; name: string; paths: string[]; extensions: string[] }[] = [
        {
          id: 'photoshop', name: 'Adobe Photoshop',
          paths: [`${programFiles}\\Adobe`, `${programFilesX86}\\Adobe`],
          extensions: ['.psd', '.psb', '.jpg', '.jpeg', '.png', '.tif', '.tiff', '.pdf', '.eps', '.ai', '.svg', '.bmp', '.gif', '.webp']
        },
        {
          id: 'illustrator', name: 'Adobe Illustrator',
          paths: [`${programFiles}\\Adobe`, `${programFilesX86}\\Adobe`],
          extensions: ['.ai', '.eps', '.svg', '.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.psd']
        },
        {
          id: 'indesign', name: 'Adobe InDesign',
          paths: [`${programFiles}\\Adobe`, `${programFilesX86}\\Adobe`],
          extensions: ['.indd', '.pdf', '.ai', '.eps', '.psd', '.jpg', '.jpeg', '.png', '.tif', '.tiff']
        },
        {
          id: 'acrobat', name: 'Adobe Acrobat',
          paths: [`${programFiles}\\Adobe`, `${programFilesX86}\\Adobe`],
          extensions: ['.pdf']
        },
        {
          id: 'coreldraw', name: 'CorelDRAW',
          paths: [`${programFiles}\\Corel`, `${programFilesX86}\\Corel`],
          extensions: ['.cdr', '.ai', '.eps', '.svg', '.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.psd']
        },
      ]

      // Find actual executables (async to avoid blocking main process)
      const { readdir: readdirAsync } = await import('fs/promises')
      cachedApps = []
      for (const app of knownApps) {
        let exePath: string | null = null
        for (const basePath of app.paths) {
          if (!existsSync(basePath)) continue
          try {
            const findExe = async (dir: string, target: string, depth = 0): Promise<string | null> => {
              if (depth > 4) return null
              const entries = await readdirAsync(dir, { withFileTypes: true })
              for (const entry of entries) {
                const full = `${dir}\\${entry.name}`
                if (entry.isFile() && entry.name.toLowerCase().includes(target) && entry.name.endsWith('.exe')) {
                  return full
                }
              }
              // Only recurse into subdirs after checking all files at this level
              for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                  const found = await findExe(`${dir}\\${entry.name}`, target, depth + 1)
                  if (found) return found
                }
              }
              return null
            }

            const targets: Record<string, string> = {
              photoshop: 'photoshop',
              illustrator: 'illustrator',
              indesign: 'indesign',
              acrobat: 'acrobat',
              coreldraw: 'coreldraw',
            }

            exePath = await findExe(basePath, targets[app.id] || app.id)
            if (exePath) break
          } catch {}
        }

        if (exePath) {
          cachedApps.push({ id: app.id, name: app.name, path: exePath, extensions: app.extensions })
        }
      }

      // Browser is always available
      cachedApps.push({
        id: 'browser', name: 'Browser',
        path: '__browser__',
        extensions: ['.pdf', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.html', '.htm']
      })
    }

    return cachedApps
  })

  ipcMain.handle('apps:openWith', async (_e, appPath: string, filePath: string) => {
    if (appPath === '__browser__') {
      // Open in default browser via file:// URL
      const { pathToFileURL } = await import('url')
      return shell.openExternal(pathToFileURL(filePath).href)
    }
    const { spawn } = await import('child_process')
    spawn(appPath, [filePath], { detached: true, stdio: 'ignore' }).unref()
    return true
  })

  // Native file drag-out (like Windows Explorer).
  // Uses `handle` (not `on`) because on Windows `startDrag` invokes
  // `DoDragDrop` which blocks until the drag completes — returning from the
  // handler then resolves the renderer's invoke promise, which is the signal
  // used to clear the renderer's drag-state ref. A proper file icon is
  // required: Windows drag sessions get stuck with a 1x1 or empty icon.
  ipcMain.handle('drag:start', async (event, filePaths: string[]) => {
    if (!filePaths.length) return
    const { nativeImage } = require('electron')

    let icon: Electron.NativeImage
    try {
      icon = await app.getFileIcon(filePaths[0], { size: 'normal' })
      if (icon.isEmpty()) throw new Error('empty icon')
    } catch {
      // 32x32 transparent PNG fallback
      icon = nativeImage.createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAH0lEQVRYhe3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAvg0hAAABmmDh1QAAAABJRU5ErkJggg=='
      )
    }

    if (filePaths.length === 1) {
      event.sender.startDrag({ file: filePaths[0], icon })
    } else {
      event.sender.startDrag({ files: filePaths, icon })
    }
  })

  // Manual archive-quote trigger (UI button). Delegates to the same deep link
  // handler so behavior stays identical to PressCal-triggered archives.
  ipcMain.handle('archive:quoteFolder', async (_e, folderPath: string) => {
    if (!folderPath) return { ok: false, error: 'missing folderPath' }
    const { basename } = await import('path')

    // Use in-app confirm dialog via renderer round-trip
    const confirmed = await new Promise<boolean>((resolve) => {
      const id = `confirm-${Date.now()}`
      ipcMain.once(`dialog-result:${id}`, (_ev, result: boolean) => resolve(result))
      mainWindow!.webContents.send('show-confirm', {
        id,
        title: 'Archive folder',
        message: `Archive folder "${basename(folderPath)}"?\nThe folder will be moved to _01 Archive/ in the parent directory.`,
      })
    })
    if (!confirmed) return { ok: false, cancelled: true }

    await handleProtocolUrl(`presscal-fh://archive-quote?folderPath=${encodeURIComponent(folderPath)}`)
    return { ok: true }
  })

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

  ipcMain.handle('theme:update', (_e, theme: string) => {
    if (!mainWindow) return
    const isLight = theme === 'light'
    const bgColor = isLight ? '#e4e8ee' : '#0a0e1a'
    const overlayColor = isLight ? '#e4e8ee' : '#0f1525'
    const symbolColor = isLight ? '#374151' : '#94a3b8'
    mainWindow.setBackgroundColor(bgColor)
    mainWindow.setTitleBarOverlay({ color: overlayColor, symbolColor, height: 36 })
  })
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
      mainWindow.setAlwaysOnTop(true)
      mainWindow.focus()
      mainWindow.setAlwaysOnTop(false)
    }
  })

  app.whenReady().then(() => {
    // Tell Windows which app this is — without it the OS may attribute the
    // running app to a generic Electron entry in the shell, which is one
    // reason the taskbar icon could show the default atom logo even when
    // BrowserWindow.icon is set correctly.
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.presscal.presskit')
    }
    // Profiles must initialize BEFORE any handler that touches the store
    // (settings/presscal/license/etc.) — they all proxy through the active
    // profile's electron-store. Also performs the v1.x → v2.x migration.
    initializeProfiles()
    // Detect cloud-sync roots (Dropbox, OneDrive, etc.) for portable paths,
    // then silently auto-migrate PressCal paths to portable format.
    detectCloudRoots().then(() => autoMigratePaths()).catch(() => {})
    registerHandlers()
    startFileServer()
    createWindow()

    // Auto-update (production only)
    if (!is.dev) setupAutoUpdater()

    // Check if launched with protocol URL (Windows: passed as arg)
    const protocolUrl = process.argv.find(arg => arg.startsWith(`${PROTOCOL}://`))
    if (protocolUrl) handleProtocolUrl(protocolUrl)

    // Process pending deep link from a profile auto-switch restart.
    // When a deep link arrives for a different profile, we save it to a file,
    // switch profiles (restart), and now process it with the correct credentials.
    const pendingDeepLinkFile = join(app.getPath('userData'), 'pending-deeplink.txt')
    try {
      const fs = require('fs')
      if (fs.existsSync(pendingDeepLinkFile)) {
        const pendingUrl = fs.readFileSync(pendingDeepLinkFile, 'utf-8').trim()
        fs.unlinkSync(pendingDeepLinkFile)
        if (pendingUrl) {
          console.log('[DeepLink] Processing pending deep link after profile switch:', pendingUrl)
          // Small delay to let the window fully initialize before handling
          setTimeout(() => handleProtocolUrl(pendingUrl), 2000)
        }
      }
    } catch (e) {
      console.warn('[DeepLink] Failed to process pending deep link:', e)
    }

    // Launch Everything search engine (non-blocking)
    everything.launch().catch(err => console.error('[EVERYTHING] Launch failed:', err))

    // Start pending archives poller (checks every 30s)
    startPendingArchivesPoller()

    // Start license poller — initial check now, then every 6h
    startLicensePoller()

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

  // Cleanup on quit
  app.on('before-quit', async () => {
    everything.stop()
    if (pendingArchivesTimer) clearInterval(pendingArchivesTimer)
    try {
      const { rm } = await import('fs/promises')
      const tempDir = join(app.getPath('temp'), 'presskit')
      await rm(tempDir, { recursive: true, force: true })
    } catch {}
  })
}
