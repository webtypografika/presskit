import { app, BrowserWindow, shell, ipcMain, dialog, nativeTheme } from 'electron'
import { join, resolve } from 'path'
import { is } from '@electron-toolkit/utils'
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
import { registerToolHandlers } from './tools-engine'

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

  // Always focus the window first
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }

  try {
    const parsed = new URL(url)
    deepLog('[DeepLink] hostname:', parsed.hostname, 'params:', parsed.searchParams.toString())
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
      let folder = parsed.searchParams.get('folder')

      if (!quoteId || !itemId) return

      mainWindow?.focus()

      // Navigate to customer folder if provided
      if (folder) {
        const { existsSync } = await import('fs')
        // Try the folder path as-is first (may contain "/" in folder names)
        if (existsSync(folder)) {
          deepLog('[DeepLink] pick-file-for-item folder (as-is):', folder)
          mainWindow?.webContents.send('navigate-to-folder', { path: folder })
        } else {
          // Fallback: try replacing / with \ (normal path separators)
          const normalized = folder.replace(/\//g, '\\')
          deepLog('[DeepLink] pick-file-for-item folder (normalized):', normalized, 'exists:', existsSync(normalized))
          if (existsSync(normalized)) {
            mainWindow?.webContents.send('navigate-to-folder', { path: normalized })
          } else {
            deepLog('[DeepLink] pick-file-for-item: folder not found, skipping nav')
          }
        }
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
        title: 'Επιλογή αρχείου για κοστολόγηση',
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
        // Refresh the PressCal quote detail tab
        const { store: s } = await import('./settings')
        const url = s.get('presscal.url') as string
        if (url) {
          const { shell } = await import('electron')
          shell.openExternal(`${url.replace(/\/$/, '')}/quotes/${quoteId}?refresh=${Date.now()}`)
        }
      } catch (e) {
        const { dialog: dlg } = await import('electron')
        dlg.showErrorBox('Σύνδεση αρχείου απέτυχε', (e as Error).message)
      }
    }

    if (parsed.hostname === 'open-folder') {
      const folderPath = parsed.searchParams.get('path')
      const email = parsed.searchParams.get('email') || ''
      let quoteId = parsed.searchParams.get('quoteId') || ''
      if (!folderPath) return

      const { existsSync, readFileSync } = await import('fs')
      const { join: pathJoin } = await import('path')
      if (!existsSync(folderPath)) {
        // Folder was deleted — recreate it via download-to-folder
        if (quoteId) {
          console.log('[DeepLink] Folder missing, falling back to download-to-folder:', folderPath)
          const target = parsed.searchParams.get('target') || 'global'
          await handleProtocolUrl(`presscal-fh://download-to-folder?quoteId=${encodeURIComponent(quoteId)}&target=${encodeURIComponent(target)}`)
          return
        }
        const { dialog } = await import('electron')
        dialog.showErrorBox('Φάκελος δεν βρέθηκε', `Ο φάκελος δεν υπάρχει:\n${folderPath}`)
        return
      }

      // Auto-detect quoteId from .presskit file if not provided in deep link
      if (!quoteId) {
        try {
          const meta = JSON.parse(readFileSync(pathJoin(folderPath, '.presskit'), 'utf-8'))
          quoteId = meta.quoteId || ''
        } catch {}
      }

      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
        mainWindow.webContents.send('navigate-to-folder', { path: folderPath, email, quoteId })
      }
    }

    if (parsed.hostname === 'download-to-folder') {
      const quoteId = parsed.searchParams.get('quoteId')
      const target = parsed.searchParams.get('target') || 'global'
      const onlyNew = parsed.searchParams.get('onlyNew') === '1'
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
      sendProgress('Λήψη λίστας αρχείων...', 0, 0)

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

      const files: Array<{ id?: string; filePath: string; fileName: string; source?: string }> = data.files || []

      // 2. Resolve target directory
      let targetDir: string = data.folderPath
      if (!targetDir) {
        let folderName = quoteId
        try {
          const qRes = await httpGet(`${presscalUrl}/api/filehelper/quotes/${encodeURIComponent(quoteId)}`)
          if (qRes.status === 200) {
            const quote = JSON.parse(qRes.body.toString('utf8'))
            const num = quote.number || quoteId
            const customer = (quote.customerName && quote.customerName !== '–') ? quote.customerName : ''
            folderName = customer ? `[${num}] ${customer}` : `[${num}]`
            folderName = folderName.replace(/[<>:"/\\|?*]/g, '_')
          }
        } catch {}
        targetDir = pathJoin(tmpdir(), 'PressCal', folderName)
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

      // 3. Filter files that already exist locally
      const filesToDownload: typeof files = []
      for (const file of files) {
        const saveName = file.fileName || basename(file.filePath)
        try {
          await fsAccess(pathJoin(targetDir, saveName))
          console.log(`[DeepLink] Exists, skipping: ${saveName}`)
        } catch {
          filesToDownload.push(file)
        }
      }

      console.log(`[DeepLink] ${filesToDownload.length} to download (${files.length - filesToDownload.length} exist)`)

      if (filesToDownload.length === 0) {
        sendProgress('Κανένα νέο αρχείο', 0, 0, true)
        mainWindow?.webContents.send('navigate-to-folder', { path: targetDir, quoteId })
        return
      }

      sendProgress('Λήψη αρχείων...', 0, filesToDownload.length)

      // 4. Download files
      let downloaded = 0
      const downloadedFileIds: string[] = []

      for (const file of filesToDownload) {
        try {
          const saveName = file.fileName || basename(file.filePath)
          sendProgress(saveName, downloaded, filesToDownload.length)

          // Build download URL
          const fileUrl = file.filePath.startsWith('http')
            ? file.filePath
            : `${presscalUrl}${file.filePath.startsWith('/') ? '' : '/'}${file.filePath}`

          console.log(`[DeepLink] Downloading: ${saveName} (source: ${file.source || 'unknown'})`)

          const dlResult = await httpGet(fileUrl)
          if (dlResult.status !== 200) {
            console.warn(`[DeepLink] Failed ${saveName}: ${dlResult.status}`)
            continue
          }

          const savePath = pathJoin(targetDir, saveName)
          await writeFile(savePath, dlResult.body)
          downloaded++
          if (file.id) downloadedFileIds.push(file.id)
          console.log(`[DeepLink] Saved: ${saveName} (${dlResult.body.length} bytes)`)

          // Auto-extract ZIP
          if (saveName.toLowerCase().endsWith('.zip')) {
            try {
              const { execFile: ef } = await import('child_process')
              const { promisify: prom } = await import('util')
              await prom(ef)('powershell', [
                '-NoProfile', '-Command',
                `Expand-Archive -Path '${savePath}' -DestinationPath '${targetDir}' -Force`
              ], { timeout: 60000 })
              const { unlink } = await import('fs/promises')
              await unlink(savePath)
            } catch (zipErr) {
              console.warn(`[DeepLink] Extract failed ${saveName}:`, zipErr)
            }
          }
        } catch (dlErr) {
          console.warn(`[DeepLink] Error ${file.fileName}:`, dlErr)
        }
      }

      console.log(`[DeepLink] Done: ${downloaded}/${filesToDownload.length} to ${targetDir}`)

      // 5. Mark files as saved
      if (downloaded > 0) {
        try {
          await fetch(`${presscalUrl}/api/filehelper/files`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ quoteId }),
          })
        } catch {}
      }

      // 6. Save quote context
      try {
        await writeFile(pathJoin(targetDir, '.presskit'), JSON.stringify({ quoteId }), 'utf-8')
      } catch {}

      // 7. Navigate to folder
      sendProgress('Ολοκληρώθηκε', downloaded, filesToDownload.length, true)
      mainWindow?.webContents.send('navigate-to-folder', { path: targetDir, quoteId })
    }
    // Archive a quote folder: presscal-fh://archive-quote?folderPath=C:\...
    // PressCal MUST use the exact folder name "_01 Archive" — it pre-writes
    // jobFolderPath = <parent>/_01 Archive/<basename> in its DB before firing
    // this deep link, and if PressKit uses a different name, DB is out of sync.
    if (parsed.hostname === 'archive-quote') {
      let folderPath = parsed.searchParams.get('folderPath')
      const { dialog: dlgArchive } = await import('electron')

      if (!folderPath) {
        deepLog('[DeepLink] archive-quote: missing folderPath')
        dlgArchive.showErrorBox('Αρχειοθέτηση', 'Δεν δόθηκε path για τον φάκελο προσφοράς.')
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
        deepLog('[DeepLink] archive-quote: folder not found:', folderPath)
        dlgArchive.showErrorBox('Αρχειοθέτηση',
          `Ο φάκελος δεν βρέθηκε:\n${folderPath}\n\nΜπορεί να έχει μετακινηθεί ή διαγραφεί.`)
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
                  dlgArchive.showErrorBox('Αρχειοθέτηση',
                    `Ο φάκελος αντιγράφηκε στο _01 Archive αλλά δεν μπόρεσε να διαγραφεί ο αρχικός.\n\n` +
                    `Αιτία (πιθανή): αρχείο κλειδωμένο από Dropbox, antivirus ή κάποια εφαρμογή.\n\n` +
                    `Κλείσε ό,τι μπορεί να έχει ανοιχτά αρχεία και διέγραψε χειροκίνητα:\n${folderPath}`)
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
        dlgArchive.showErrorBox('Αρχειοθέτηση', `Αποτυχία μετακίνησης φακέλου:\n${String(err)}`)
      }
    }

    // Restore a quote folder from archive: presscal-fh://restore-quote?folderPath=...&restorePath=...&quoteId=...
    // Moves the folder from _01 Archive back to its original location, then confirms with PressCal.
    if (parsed.hostname === 'restore-quote') {
      let folderPath = parsed.searchParams.get('folderPath')   // current archived path
      let restorePath = parsed.searchParams.get('restorePath') // target restored path
      const quoteId = parsed.searchParams.get('quoteId') || ''
      const { dialog: dlgRestore } = await import('electron')

      if (!folderPath || !restorePath) {
        deepLog('[DeepLink] restore-quote: missing folderPath or restorePath')
        dlgRestore.showErrorBox('Επαναφορά', 'Λείπουν παράμετροι (folderPath / restorePath).')
        return
      }

      const { existsSync: fsExists } = await import('fs')
      const { rename: fsRename, mkdir: fsMkdir, readdir: rdDir2, copyFile: fsCopyFile, rm: fsRm, access: fsAccess2 } = await import('fs/promises')
      const { join: pathJoin, dirname: pathDirname, basename: pathBasename } = await import('path')

      // Normalize paths
      folderPath = folderPath.replace(/\//g, '\\').split('\\').map(s => s.trim()).join('\\')
      restorePath = restorePath.replace(/\//g, '\\').split('\\').map(s => s.trim()).join('\\')

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
        dlgRestore.showErrorBox('Επαναφορά',
          `Ο αρχειοθετημένος φάκελος δεν βρέθηκε:\n${folderPath}`)
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
                  dlgRestore.showErrorBox('Επαναφορά',
                    `Ο φάκελος αντιγράφηκε αλλά δεν μπόρεσε να διαγραφεί ο αρχειοθετημένος.\n\n` +
                    `Κλείσε ό,τι μπορεί να έχει ανοιχτά αρχεία και διέγραψε χειροκίνητα:\n${folderPath}`)
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
        dlgRestore.showErrorBox('Επαναφορά', `Αποτυχία επαναφοράς φακέλου:\n${String(err)}`)
      }
    }

    if (parsed.hostname === 'connect') {
      const url = parsed.searchParams.get('url')
      const apiKey = parsed.searchParams.get('apiKey')
      if (url && apiKey) {
        store.set('presscal.url', url.replace(/\/$/, ''))
        store.set('presscal.apiKey', apiKey)
        deepLog('[DeepLink] Connected to PressCal:', url)
        const { dialog: dlgConnect } = await import('electron')
        dlgConnect.showMessageBox({ message: `Συνδέθηκε στο PressCal!\n${url}`, type: 'info' })
        mainWindow?.webContents.send('presscal-connected', { url, apiKey })
      }
    }
  } catch (e) {
    deepLog('[DeepLink] ERROR:', String(e))
  }
}

function createWindow(): void {
  const savedTheme = store.get('ui.theme', 'light') as string
  const isLight = savedTheme === 'light'
  const bgColor = isLight ? '#e4e8ee' : '#0a0e1a'
  const overlayColor = isLight ? '#e4e8ee' : '#0f1525'
  const symbolColor = isLight ? '#374151' : '#94a3b8'

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: bgColor,
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
    if (mainWindow && !mainWindow.isVisible()) {
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
        title: 'Σφάλμα εφαρμογής',
        message: 'Το παράθυρο κόλλησε απρόσμενα',
        detail: `Reason: ${details.reason}\nExit code: ${details.exitCode}`,
        buttons: ['Reload', 'Κλείσιμο'],
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

    // POST /?save=C:\path\to\file.pdf — save uploaded file to disk
    if (req.method === 'POST' && parsed.query.save) {
      const savePath = parsed.query.save as string
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', async () => {
        try {
          const dir = pathMod.dirname(savePath)
          await require('fs/promises').mkdir(dir, { recursive: true })
          await require('fs/promises').writeFile(savePath, Buffer.concat(chunks))
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, path: savePath }))
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: e.message }))
        }
      })
      return
    }

    // Pick folder dialog: GET /?pickFolder=1 → opens native folder picker,
    // returns { path: "..." } or { canceled: true }. Used by PressCal forms
    // (e.g. "Νέα εταιρεία") to set a folder without typing a path.
    if (parsed.query.pickFolder) {
      ;(async () => {
        try {
          const { dialog } = await import('electron')
          mainWindow?.focus()
          const result = await dialog.showOpenDialog(mainWindow!, {
            title: 'Επιλογή Φακέλου Πελάτη',
            properties: ['openDirectory'],
          })
          res.writeHead(200, { 'Content-Type': 'application/json' })
          if (result.canceled || result.filePaths.length === 0) {
            res.end(JSON.stringify({ canceled: true }))
          } else {
            res.end(JSON.stringify({ path: result.filePaths[0] }))
          }
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: e.message }))
        }
      })()
      return
    }

    // Directory listing: GET /?list=C:\path\to\folder → returns JSON array of PDF filenames
    const listDir = parsed.query.list as string
    if (listDir) {
      if (!fs.existsSync(listDir)) { res.writeHead(404); res.end('[]'); return }
      try {
        const entries = fs.readdirSync(listDir).filter((f: string) => /\.(pdf|jpg|jpeg|png|tif|tiff|ai|psd|eps)$/i.test(f))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(entries))
      } catch { res.writeHead(500); res.end('[]') }
      return
    }

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
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(pathMod.basename(filePath))}`,
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
  registerSearchHandlers(ipcMain)
  registerToolHandlers(ipcMain)

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

      // Find actual executables
      cachedApps = []
      for (const app of knownApps) {
        let exePath: string | null = null
        for (const basePath of app.paths) {
          if (!existsSync(basePath)) continue
          try {
            const findExe = (dir: string, target: string, depth = 0): string | null => {
              if (depth > 6) return null
              const entries = readdirSync(dir, { withFileTypes: true })
              for (const entry of entries) {
                const full = `${dir}\\${entry.name}`
                if (entry.isFile() && entry.name.toLowerCase().includes(target) && entry.name.endsWith('.exe')) {
                  return full
                }
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                  const found = findExe(full, target, depth + 1)
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

            exePath = findExe(basePath, targets[app.id] || app.id)
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
    const { dialog: dlgConfirm } = await import('electron')
    const { basename } = await import('path')

    const confirm = await dlgConfirm.showMessageBox(mainWindow!, {
      type: 'question',
      buttons: ['Αρχειοθέτηση', 'Ακύρωση'],
      defaultId: 0,
      cancelId: 1,
      title: 'Αρχειοθέτηση φακέλου',
      message: `Αρχειοθέτηση του φακέλου "${basename(folderPath)}";`,
      detail: 'Ο φάκελος θα μετακινηθεί στο _01 Archive/ του parent directory.',
    })
    if (confirm.response !== 0) return { ok: false, cancelled: true }

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

  // Cleanup on quit
  app.on('before-quit', async () => {
    try {
      const { rm } = await import('fs/promises')
      const tempDir = join(app.getPath('temp'), 'presskit')
      await rm(tempDir, { recursive: true, force: true })
    } catch {}
  })
}
