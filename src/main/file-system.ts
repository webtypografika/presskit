import { IpcMain } from 'electron'
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

        results.push({
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          size: stats.size,
          modified: stats.mtime.toISOString(),
          created: stats.birthtime.toISOString(),
          extension: ext.toLowerCase(),
          type: entry.isDirectory() ? 'folder' : getFileType(ext)
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
}
