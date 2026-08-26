import { IpcMain, BrowserWindow } from 'electron'
import { readdir, stat, readFile, writeFile, rm, access, mkdir } from 'fs/promises'
import { join, extname, basename, dirname } from 'path'
import { isRawExtension, extractRawPreview } from './raw-preview'
import { existsSync } from 'fs'

const NOTES_FILE = '.presscal-notes.json'

async function readNotesFile(dirPath: string): Promise<Record<string, string>> {
  try {
    const data = await readFile(join(dirPath, NOTES_FILE), 'utf-8')
    return JSON.parse(data)
  } catch {
    return {}
  }
}

async function writeNotesFile(dirPath: string, notes: Record<string, string>): Promise<void> {
  // Remove empty entries
  const clean: Record<string, string> = {}
  for (const [k, v] of Object.entries(notes)) {
    if (v && v.trim()) clean[k] = v
  }
  if (Object.keys(clean).length === 0) {
    // Delete file if no notes left
    try { await rm(join(dirPath, NOTES_FILE)) } catch {}
    return
  }
  await writeFile(join(dirPath, NOTES_FILE), JSON.stringify(clean, null, 2), 'utf-8')
}

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modified: string
  created: string
  extension: string
  type: FileType
  cloudStatus?: 'local' | 'cloud' | 'syncing'
}

export type FileType =
  | 'pdf' | 'ai' | 'psd' | 'eps' | 'indd'
  | 'tiff' | 'png' | 'jpg' | 'svg' | 'raw'
  | 'font' | 'document' | 'spreadsheet'
  | 'archive' | 'folder' | 'unknown'

const EXTENSION_MAP: Record<string, FileType> = {
  '.pdf': 'pdf',
  '.ai': 'ai',
  '.psd': 'psd',
  '.psb': 'psd',
  '.eps': 'eps',
  '.epsf': 'eps',
  '.indd': 'indd',
  '.idml': 'indd',
  '.tif': 'tiff',
  '.tiff': 'tiff',
  '.png': 'png',
  '.jpg': 'jpg',
  '.jpeg': 'jpg',
  '.webp': 'jpg',
  '.bmp': 'jpg',
  '.gif': 'jpg',
  '.svg': 'svg',
  '.svgz': 'svg',
  '.cr2': 'raw',
  '.cr3': 'raw',
  '.nef': 'raw',
  '.arw': 'raw',
  '.dng': 'raw',
  '.raf': 'raw',
  '.orf': 'raw',
  '.rw2': 'raw',
  '.otf': 'font',
  '.ttf': 'font',
  '.woff': 'font',
  '.woff2': 'font',
  '.doc': 'document',
  '.docx': 'document',
  '.txt': 'document',
  '.rtf': 'document',
  '.xls': 'spreadsheet',
  '.xlsx': 'spreadsheet',
  '.csv': 'spreadsheet',
  '.zip': 'archive',
  '.rar': 'archive',
  '.7z': 'archive'
}

function getFileType(ext: string): FileType {
  return EXTENSION_MAP[ext.toLowerCase()] || 'unknown'
}

// Detect Dropbox cloud status on Windows
// Online-only files have FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS (0x00400000)
// or FILE_ATTRIBUTE_OFFLINE (0x1000)
function getCloudStatus(filePath: string, stats: any): 'local' | 'cloud' | undefined {
  // Check if file is inside a Dropbox folder
  const lowerPath = filePath.toLowerCase()
  const isDropboxPath = lowerPath.includes('dropbox')
  if (!isDropboxPath) return undefined

  if (process.platform === 'win32') {
    try {
      // On Windows, check the file attributes using the native mode bits
      // Placeholder/cloud-only files typically have blocks = 0 while having a size > 0
      // Also check for reparse points (bit 10 of mode on NTFS)
      const mode = (stats as any).mode || 0
      const isReparsePoint = (mode & 0o20000000000) !== 0

      // Simple heuristic: if file has size but blocks suggest no local data
      if (!stats.isDirectory() && stats.size > 0 && stats.blocks === 0) {
        return 'cloud'
      }
      if (isReparsePoint) {
        return 'cloud'
      }
    } catch {}
  }

  return 'local'
}

export function registerFileSystemHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('fs:listDirectory', async (_e, dirPath: string): Promise<FileEntry[]> => {
    if (!existsSync(dirPath)) return []

    const entries = await readdir(dirPath, { withFileTypes: true })
    const filtered = entries.filter(entry =>
      !entry.name.startsWith('.') && entry.name !== 'Thumbs.db' && entry.name !== 'desktop.ini'
    )

    // Parallel stat — much faster than sequential for large directories
    const settled = await Promise.allSettled(
      filtered.map(async (entry) => {
        const fullPath = join(dirPath, entry.name)
        const stats = await stat(fullPath)
        const ext = entry.isDirectory() ? '' : extname(entry.name)
        const cloudStatus = getCloudStatus(fullPath, stats)
        return {
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          size: stats.size,
          modified: stats.mtime.toISOString(),
          created: stats.birthtime.toISOString(),
          extension: ext.toLowerCase(),
          type: entry.isDirectory() ? 'folder' : getFileType(ext),
          cloudStatus
        } as FileEntry
      })
    )

    const results = settled
      .filter((r): r is PromiseFulfilledResult<FileEntry> => r.status === 'fulfilled')
      .map(r => r.value)

    // Sort: folders first, then by name
    results.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.name.localeCompare(b.name)
    })

    return results
  })

  // Recursive search within a path
  ipcMain.handle('fs:search', async (_e, rootPath: string, query: string, maxResults = 50): Promise<FileEntry[]> => {
    if (!existsSync(rootPath) || !query.trim()) return []

    const q = query.toLowerCase()
    const results: FileEntry[] = []
    const seen = new Set<string>()
    const maxDepth = 8
    const deadline = Date.now() + 5000 // 5s max

    async function walk(dir: string, depth: number) {
      if (depth > maxDepth || results.length >= maxResults || Date.now() > deadline) return
      try {
        const names = await readdir(dir)
        for (const name of names) {
          if (results.length >= maxResults || Date.now() > deadline) return
          if (name.startsWith('.') || name === 'node_modules' || name === 'Thumbs.db' || name === 'desktop.ini' || name === '$RECYCLE.BIN') continue

          const fullPath = join(dir, name)
          if (seen.has(fullPath)) continue
          let stats
          try {
            stats = await stat(fullPath)
          } catch { continue }

          const isDir = stats.isDirectory()

          if (name.toLowerCase().includes(q)) {
            seen.add(fullPath)
            const ext = isDir ? '' : extname(name)
            results.push({
              name,
              path: fullPath,
              isDirectory: isDir,
              size: stats.size,
              modified: stats.mtime.toISOString(),
              created: stats.birthtime.toISOString(),
              extension: ext.toLowerCase(),
              type: isDir ? 'folder' : getFileType(ext)
            })
          }

          if (isDir) {
            await walk(fullPath, depth + 1)
          }
        }
      } catch {}
    }

    // Search current directory first
    await walk(rootPath, 0)

    // If few results, also search parent directory
    if (results.length < 10 && Date.now() < deadline) {
      const parent = dirname(rootPath)
      if (parent && parent !== rootPath && existsSync(parent)) {
        await walk(parent, 0)
      }
    }

    // Sort: folders first, then by name
    results.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.name.localeCompare(b.name)
    })

    return results
  })

  ipcMain.handle('fs:getMetadata', async (_e, filePath: string) => {
    const stats = await stat(filePath)
    const ext = extname(filePath).toLowerCase()

    const metadata: Record<string, unknown> = {
      name: basename(filePath),
      path: filePath,
      directory: dirname(filePath),
      size: stats.size,
      created: stats.birthtime.toISOString(),
      modified: stats.mtime.toISOString(),
      extension: ext,
      type: getFileType(ext)
    }

    // RAW camera files — metadata from embedded JPEG preview
    if (isRawExtension(ext)) {
      try {
        const jpegBuffer = await extractRawPreview(filePath)
        if (jpegBuffer) {
          const sharp = (await import('sharp')).default
          const meta = await sharp(jpegBuffer).metadata()
          metadata.width = meta.width
          metadata.height = meta.height
          metadata.dpi = meta.density || null
          metadata.colorSpace = meta.space
          metadata.channels = meta.channels
          metadata.bitDepth = meta.depth
          metadata.hasAlpha = meta.hasAlpha
          metadata.format = 'raw'
        }
      } catch {
        // Could not extract RAW preview
      }
    }

    // Image metadata via sharp
    if (['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.bmp'].includes(ext)) {
      try {
        const sharp = (await import('sharp')).default
        const image = sharp(filePath)
        const meta = await image.metadata()

        metadata.width = meta.width
        metadata.height = meta.height
        metadata.dpi = meta.density || null
        metadata.colorSpace = meta.space // 'srgb', 'cmyk', etc.
        metadata.channels = meta.channels
        metadata.bitDepth = meta.depth
        metadata.hasAlpha = meta.hasAlpha
        metadata.format = meta.format

        if (meta.icc) {
          metadata.iccProfile = {
            size: meta.icc.length,
            description: meta.icc.toString('ascii', 0, Math.min(128, meta.icc.length)).replace(/[^\x20-\x7E]/g, '')
          }
        }
      } catch {
        // Sharp not available or unsupported format
      }
    }

    // PDF metadata — extract page boxes
    if (['.pdf'].includes(ext)) {
      try {
        const { PDFDocument } = await import('pdf-lib')
        const buffer = await readFile(filePath)
        const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true })
        const pageCount = pdf.getPageCount()
        metadata.pageCount = pageCount

        if (pageCount > 0) {
          const page = pdf.getPage(0)

          // PDF points to mm (1pt = 0.352778mm)
          const ptToMm = (pt: number) => Math.round(pt * 0.352778 * 10) / 10

          const mediaBox = page.getMediaBox()
          metadata.mediaBox = {
            width: ptToMm(mediaBox.width),
            height: ptToMm(mediaBox.height)
          }

          const trimBox = page.getTrimBox()
          // Only include if different from mediaBox
          if (trimBox.width !== mediaBox.width || trimBox.height !== mediaBox.height) {
            metadata.trimBox = {
              width: ptToMm(trimBox.width),
              height: ptToMm(trimBox.height)
            }
          }

          const bleedBox = page.getBleedBox()
          if (bleedBox.width !== mediaBox.width || bleedBox.height !== mediaBox.height) {
            metadata.bleedBox = {
              width: ptToMm(bleedBox.width),
              height: ptToMm(bleedBox.height)
            }
          }

          const cropBox = page.getCropBox()
          if (cropBox.width !== mediaBox.width || cropBox.height !== mediaBox.height) {
            metadata.cropBox = {
              width: ptToMm(cropBox.width),
              height: ptToMm(cropBox.height)
            }
          }
        }

        // PDF version from header
        const header = buffer.subarray(0, 20).toString('ascii')
        const versionMatch = header.match(/PDF-(\d\.\d)/)
        if (versionMatch) metadata.pdfVersion = versionMatch[1]
      } catch {
        // pdf-lib parse error
      }
    }

    // PSD metadata
    if (['.psd', '.psb'].includes(ext)) {
      try {
        const { readPsd } = await import('ag-psd')
        const buffer = await readFile(filePath)
        const psd = readPsd(buffer, { skipLayerImageData: true, skipCompositeImageData: true })
        metadata.width = psd.width
        metadata.height = psd.height
        metadata.colorMode = psd.colorMode // 0=Bitmap, 1=Grayscale, 3=RGB, 4=CMYK
        metadata.channels = psd.channels
        metadata.bitDepth = psd.bitsPerChannel
        metadata.layerCount = psd.children?.length || 0

        const colorModeNames: Record<number, string> = {
          0: 'Bitmap', 1: 'Grayscale', 2: 'Indexed', 3: 'RGB', 4: 'CMYK', 7: 'Multichannel', 8: 'Duotone', 9: 'Lab'
        }
        metadata.colorSpace = colorModeNames[psd.colorMode as number] || 'Unknown'
      } catch {
        // ag-psd parse error
      }
    }

    // Font metadata
    if (['.otf', '.ttf', '.woff', '.woff2'].includes(ext)) {
      try {
        const opentype = await import('opentype.js')
        const buffer = await readFile(filePath)
        const font = opentype.parse(buffer.buffer)
        metadata.fontFamily = font.names.fontFamily?.en || ''
        metadata.fontSubfamily = font.names.fontSubfamily?.en || ''
        metadata.designer = font.names.designer?.en || ''
        metadata.manufacturer = font.names.manufacturer?.en || ''
        metadata.license = font.names.license?.en || ''
        metadata.version = font.names.version?.en || ''
        metadata.glyphCount = font.numGlyphs
        metadata.unitsPerEm = font.unitsPerEm

        // OpenType features
        if (font.tables.gsub) {
          const features = new Set<string>()
          for (const feature of font.tables.gsub.features || []) {
            features.add(feature.tag)
          }
          metadata.openTypeFeatures = Array.from(features)
        }
      } catch {
        // opentype parse error
      }
    }

    return metadata
  })

  ipcMain.handle('fs:readFile', async (_e, filePath: string) => {
    return readFile(filePath)
  })

  ipcMain.handle('fs:exists', async (_e, filePath: string) => {
    return existsSync(filePath)
  })

  // Create a new directory
  ipcMain.handle('fs:createDirectory', async (_e, dirPath: string) => {
    try {
      await mkdir(dirPath, { recursive: false })
      return { ok: true, path: dirPath }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  // Move files/folders to a target directory
  ipcMain.handle('fs:move', async (_e, sourcePaths: string[], targetDir: string) => {
    const { rename, copyFile, mkdir, readdir, stat: fsStat } = await import('fs/promises')
    const { join, basename } = await import('path')
    const results: { source: string; dest: string; ok: boolean; error?: string }[] = []

    for (const src of sourcePaths) {
      const name = basename(src)
      const dest = join(targetDir, name)
      try {
        // Avoid moving to same location
        if (src === dest) continue
        // Try rename first (fast, same filesystem)
        try {
          await rename(src, dest)
        } catch {
          // Cross-device: copy then delete
          const srcStat = await fsStat(src)
          if (srcStat.isDirectory()) {
            // Recursive copy for directories
            const copyDir = async (s: string, d: string) => {
              await mkdir(d, { recursive: true })
              const entries = await readdir(s, { withFileTypes: true })
              for (const entry of entries) {
                const sp = join(s, entry.name)
                const dp = join(d, entry.name)
                if (entry.isDirectory()) await copyDir(sp, dp)
                else await copyFile(sp, dp)
              }
            }
            await copyDir(src, dest)
            const { rm } = await import('fs/promises')
            await rm(src, { recursive: true })
          } else {
            await copyFile(src, dest)
            const { unlink } = await import('fs/promises')
            await unlink(src)
          }
        }
        results.push({ source: src, dest, ok: true })

        // Move note to new location
        try {
          const srcDir = dirname(src)
          const srcName = basename(src)
          const srcNotes = await readNotesFile(srcDir)
          if (srcNotes[srcName]) {
            const destNotes = await readNotesFile(targetDir)
            destNotes[name] = srcNotes[srcName]
            delete srcNotes[srcName]
            await writeNotesFile(srcDir, srcNotes)
            await writeNotesFile(targetDir, destNotes)
          }
        } catch {}
      } catch (e: any) {
        results.push({ source: src, dest, ok: false, error: e.message })
      }
    }
    return results
  })

  // Copy files/folders to a target directory
  ipcMain.handle('fs:copy', async (_e, sourcePaths: string[], targetDir: string) => {
    const { copyFile, mkdir, readdir, stat: fsStat } = await import('fs/promises')
    const { join, basename } = await import('path')
    const results: { source: string; dest: string; ok: boolean; error?: string }[] = []

    for (const src of sourcePaths) {
      const name = basename(src)
      const dest = join(targetDir, name)
      try {
        if (src === dest) continue
        const srcStat = await fsStat(src)
        if (srcStat.isDirectory()) {
          const copyDir = async (s: string, d: string) => {
            await mkdir(d, { recursive: true })
            const entries = await readdir(s, { withFileTypes: true })
            for (const entry of entries) {
              const sp = join(s, entry.name)
              const dp = join(d, entry.name)
              if (entry.isDirectory()) await copyDir(sp, dp)
              else await copyFile(sp, dp)
            }
          }
          await copyDir(src, dest)
        } else {
          await copyFile(src, dest)
        }
        results.push({ source: src, dest, ok: true })
      } catch (e: any) {
        results.push({ source: src, dest, ok: false, error: e.message })
      }
    }
    return results
  })

  ipcMain.handle('fs:getDrives', async () => {
    if (process.platform === 'win32') {
      // List Windows drives
      const drives: string[] = []
      for (let i = 65; i <= 90; i++) {
        const drive = String.fromCharCode(i) + ':\\'
        if (existsSync(drive)) {
          drives.push(drive)
        }
      }
      return drives
    }
    return ['/']
  })

  // Delete files (move to trash)
  /**
   * Delete to the Recycle Bin.
   *
   * `permanent` is opt-in and the renderer only sets it after asking. Until
   * 2026-08-25 a failed trashItem fell straight through to `fs.rm force`, which
   * is a permanent, unrecoverable delete — so a file that happened to be locked
   * for a second was destroyed instead of binned, silently. Worse, `rm` deletes
   * depth-first: on a folder it wiped the contents and then failed on the empty
   * directory, reporting "failed" while the files were already gone.
   *
   * Locks here are usually transient — Dropbox finishing a sync, an editor
   * still holding a handle. George hit one on 2026-08-25 and the same folder
   * deleted fine minutes later, so the retry budget went from ~0.9s to ~10s,
   * which costs nothing and fixes the common case on its own.
   */
  ipcMain.handle('fs:trash', async (_e, paths: string[], opts?: { permanent?: boolean }) => {
    const { shell } = await import('electron')
    const permanent = opts?.permanent === true
    const results: { path: string; ok: boolean; locked?: boolean; error?: string }[] = []
    // Backoff, not a flat sleep: a Dropbox upload can hold a folder for several
    // seconds, and three tries at 300ms only ever caught the luckiest cases.
    const TRASH_BACKOFF_MS = [250, 500, 1000, 2000, 3000, 3000]

    // Stop watcher temporarily to avoid file locks on Windows
    if (watcher) {
      try { await watcher.close() } catch {}
      watcher = null
    }

    // Small delay after closing watcher to release file handles
    await new Promise(r => setTimeout(r, 100))

    for (const p of paths) {
      let ok = false
      let lastError = ''

      // First check if file exists
      try {
        await access(p)
      } catch {
        // File doesn't exist — consider it already deleted
        results.push({ path: p, ok: true })
        continue
      }

      // Method 1: shell.trashItem (moves to Recycle Bin)
      let locked = false
      for (let attempt = 0; attempt < TRASH_BACKOFF_MS.length && !ok; attempt++) {
        try {
          await shell.trashItem(p)
          ok = true
        } catch (err: any) {
          lastError = err.message || String(err)
          console.error(`[DELETE] trashItem attempt ${attempt + 1} failed for "${p}":`, lastError)
          if (attempt < TRASH_BACKOFF_MS.length - 1) {
            await new Promise(r => setTimeout(r, TRASH_BACKOFF_MS[attempt]))
          }
        }
      }

      // Method 2: permanent delete — ONLY when the user has been asked and said so.
      if (!ok && permanent) {
        console.log(`[DELETE] Permanent delete requested for "${p}"`)
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
          try {
            if (attempt > 0) await new Promise(r => setTimeout(r, 500 * attempt))
            const fileStat = await stat(p)
            await rm(p, { recursive: fileStat.isDirectory(), force: true, maxRetries: 3, retryDelay: 200 })
            ok = true
            lastError = ''
          } catch (err: any) {
            console.error(`[DELETE] fs.rm attempt ${attempt + 1} failed for "${p}":`, err.message || String(err))
            // Say what actually happened. `rm` works depth-first, so a failure
            // here usually means the contents ARE gone and only the directory
            // survived — reporting a bare "failed" would leave the user believing
            // their files are still there.
            let partial = ''
            try {
              const survivors = await readdir(p)
              partial = survivors.length === 0
                ? ' The contents were deleted; only the empty folder is left.'
                : ` ${survivors.length} item(s) could not be deleted.`
            } catch { /* path is gone or unreadable — leave it unqualified */ }
            lastError = `Could not delete "${basename(p)}".${partial} Something is still using it.`
          }
        }
      } else if (!ok) {
        locked = true
        lastError = `"${basename(p)}" could not be moved to the Recycle Bin — something is still using it. `
          + 'This is usually Dropbox finishing a sync, or a file still open in another app.'
      }

      results.push({ path: p, ok, locked: ok ? undefined : locked || undefined, error: ok ? undefined : lastError })
    }

    console.log(`[DELETE] Results:`, results.map(r => `${basename(r.path)}: ${r.ok ? 'OK' : r.error}`).join(', '))
    return results
  })

  // Rename a file or folder
  ipcMain.handle('fs:rename', async (_e, oldPath: string, newName: string) => {
    const { rename: fsRename } = await import('fs/promises')
    const { join, dirname } = await import('path')
    const newPath = join(dirname(oldPath), newName)
    if (oldPath === newPath) return { ok: true, newPath }
    // Check target doesn't already exist
    try {
      await access(newPath)
      return { ok: false, error: 'A file with this name already exists' }
    } catch {
      // good — target doesn't exist
    }
    try {
      await fsRename(oldPath, newPath)
      return { ok: true, newPath }
    } catch (err: any) {
      return { ok: false, error: err.message }
    }
  })

  // ─── File watcher ────────────────────────────────────────────────
  let watcher: any = null

  ipcMain.handle('fs:watch', async (_e, dirPath: string) => {
    // Stop previous watcher
    if (watcher) {
      await watcher.close()
      watcher = null
    }

    if (!dirPath || !existsSync(dirPath)) return

    const chokidar = await import('chokidar')
    let debounceTimer: any = null

    watcher = chokidar.watch(dirPath, {
      depth: 0,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      ignored: [
        /(^|[/\\])\../,           // dotfiles
        /\.tmp$/i,                // temp files
        /DumpStack\.log/i,        // Windows system
        /pagefile\.sys/i,
        /hiberfil\.sys/i,
        /swapfile\.sys/i,
        /System Volume Information/i,
        /\$Recycle\.Bin/i,
      ],
    })

    watcher.on('error', () => {}) // silently ignore permission errors

    /*
     * Tell the window at once, then hold the line for a moment.
     *
     * This used to wait 500ms before saying anything, and the window waited
     * another 800 on top — so saving a file took the better part of two
     * seconds to appear, which reads as "nothing happened, I will press
     * refresh". Explorer answers in about fifty milliseconds and that is the
     * bar we are being measured against.
     *
     * The delay was not pointless: a Dropbox sync or a bulk operation fires
     * hundreds of events and re-rendering on each one is its own kind of
     * broken. But a plain debounce pays that cost on every change, including
     * the single save that is all most people ever do.
     *
     * So the first event goes straight through and anything arriving just
     * after it is collapsed into one follow-up. Immediate when it is quiet,
     * still calm under a storm.
     */
    const COALESCE_MS = 400
    let lastEmit = 0

    const emit = () => {
      lastEmit = Date.now()
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('fs:changed', dirPath)
      }
    }

    const notify = () => {
      const since = Date.now() - lastEmit
      if (since >= COALESCE_MS) { emit(); return }
      // Something is already queued; it will cover this change too.
      if (debounceTimer) return
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        emit()
      }, COALESCE_MS - since)
    }

    watcher.on('add', notify)
    watcher.on('unlink', notify)
    watcher.on('addDir', notify)
    watcher.on('unlinkDir', notify)
    watcher.on('change', notify)
  })

  ipcMain.handle('fs:unwatch', async () => {
    if (watcher) {
      await watcher.close()
      watcher = null
    }
  })

  // ─── File notes ─────────────────────────────────────────────────────

  ipcMain.handle('notes:get', async (_e, filePath: string): Promise<string> => {
    const dir = dirname(filePath)
    const name = basename(filePath)
    const notes = await readNotesFile(dir)
    return notes[name] || ''
  })

  ipcMain.handle('notes:set', async (_e, filePath: string, note: string) => {
    const dir = dirname(filePath)
    const name = basename(filePath)
    const notes = await readNotesFile(dir)
    notes[name] = note
    await writeNotesFile(dir, notes)
  })
}
