import { IpcMain, BrowserWindow } from 'electron'
import { readdir, stat, readFile } from 'fs/promises'
import { join, extname, basename, dirname } from 'path'
import { existsSync } from 'fs'

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
  '.svg': 'svg',
  '.svgz': 'svg',
  '.cr2': 'raw',
  '.nef': 'raw',
  '.arw': 'raw',
  '.dng': 'raw',
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
    const results: FileEntry[] = []

    for (const entry of entries) {
      // Skip hidden files and system files
      if (entry.name.startsWith('.') || entry.name === 'Thumbs.db' || entry.name === 'desktop.ini') {
        continue
      }

      const fullPath = join(dirPath, entry.name)
      try {
        const stats = await stat(fullPath)
        const ext = entry.isDirectory() ? '' : extname(entry.name)
        const cloudStatus = getCloudStatus(fullPath, stats)

        results.push({
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          size: stats.size,
          modified: stats.mtime.toISOString(),
          created: stats.birthtime.toISOString(),
          extension: ext.toLowerCase(),
          type: entry.isDirectory() ? 'folder' : getFileType(ext),
          cloudStatus
        })
      } catch {
        // Skip files we can't access
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

  // Recursive search within a path
  ipcMain.handle('fs:search', async (_e, rootPath: string, query: string, maxResults = 30): Promise<FileEntry[]> => {
    if (!existsSync(rootPath) || !query.trim()) return []

    const q = query.toLowerCase()
    const results: FileEntry[] = []
    const maxDepth = 4

    async function walk(dir: string, depth: number) {
      if (depth > maxDepth || results.length >= maxResults) return
      try {
        const names = await readdir(dir)
        for (const name of names) {
          if (results.length >= maxResults) return
          if (name.startsWith('.') || name === 'node_modules' || name === 'Thumbs.db' || name === 'desktop.ini') continue

          const fullPath = join(dir, name)
          let stats
          try {
            stats = await stat(fullPath)
          } catch { continue }

          const isDir = stats.isDirectory()

          if (name.toLowerCase().includes(q)) {
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

    await walk(rootPath, 0)

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
  ipcMain.handle('fs:trash', async (_e, paths: string[]) => {
    const { shell } = await import('electron')
    const results: { path: string; ok: boolean; error?: string }[] = []
    for (const p of paths) {
      try {
        await shell.trashItem(p)
        results.push({ path: p, ok: true })
      } catch (err: any) {
        results.push({ path: p, ok: false, error: err.message })
      }
    }
    return results
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

    const notify = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        const wins = BrowserWindow.getAllWindows()
        for (const win of wins) {
          win.webContents.send('fs:changed', dirPath)
        }
      }, 500)
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
}
