import { IpcMain, BrowserWindow } from 'electron'
import { readdir, stat } from 'fs/promises'
import { join, extname } from 'path'

const PRINT_EXTENSIONS = new Set([
  '.pdf', '.ai', '.psd', '.psb', '.eps',
  '.tif', '.tiff', '.png', '.jpg', '.jpeg',
  '.svg', '.indd'
])

export interface BatchItem {
  path: string
  name: string
  status: 'pending' | 'running' | 'done' | 'error'
  result?: any
  error?: string
}

export function registerBatchHandlers(ipcMain: IpcMain): void {
  // Scan directory for print files
  ipcMain.handle('batch:scanDirectory', async (_e, dirPath: string, recursive: boolean = false): Promise<string[]> => {
    const files: string[] = []

    async function scan(dir: string) {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory() && recursive) {
          await scan(fullPath)
        } else if (!entry.isDirectory()) {
          const ext = extname(entry.name).toLowerCase()
          if (PRINT_EXTENSIONS.has(ext)) {
            files.push(fullPath)
          }
        }
      }
    }

    await scan(dirPath)
    return files.sort()
  })

  // Run batch preflight — processes files sequentially and sends progress updates
  ipcMain.handle('batch:preflight', async (event, filePaths: string[]) => {
    const results: any[] = []
    const { registerPreflightHandlers } = await import('./preflight-engine')

    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i]

      // Send progress to renderer
      event.sender.send('batch:progress', {
        current: i + 1,
        total: filePaths.length,
        file: filePath,
        phase: 'preflight'
      })

      try {
        // Invoke the preflight handler directly
        const report = await runPreflightDirect(filePath)
        results.push(report)
      } catch (err: any) {
        results.push({
          fileName: filePath.split(/[/\\]/).pop(),
          fileType: extname(filePath),
          overallStatus: 'error',
          checks: [{ id: 'error', label: 'Error', severity: 'error', value: err.message || 'Unknown error' }],
          timestamp: new Date().toISOString()
        })
      }
    }

    return results
  })

  // Export batch report as CSV
  ipcMain.handle('batch:exportCsv', async (_e, reports: any[]): Promise<string> => {
    const rows: string[] = []
    rows.push('File,Status,Check,Severity,Value,Detail')

    for (const report of reports) {
      for (const check of report.checks) {
        rows.push([
          `"${report.fileName}"`,
          report.overallStatus,
          `"${check.label}"`,
          check.severity,
          `"${check.value}"`,
          `"${check.detail || ''}"`
        ].join(','))
      }
    }

    return rows.join('\n')
  })
}

// Direct preflight execution (without IPC round-trip)
async function runPreflightDirect(filePath: string): Promise<any> {
  const { readFile, stat: statFn } = await import('fs/promises')
  const { extname: ext, basename } = await import('path')

  const extension = ext(filePath).toLowerCase()
  const name = basename(filePath)
  const fileStats = await statFn(filePath)
  const checks: any[] = []

  const sizeMB = fileStats.size / (1024 * 1024)
  checks.push({
    id: 'file-size',
    label: 'File Size',
    severity: sizeMB > 500 ? 'warning' : 'pass',
    value: sizeMB < 1 ? `${(sizeMB * 1024).toFixed(0)} KB` : `${sizeMB.toFixed(1)} MB`
  })

  // Image preflight
  if (['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.bmp'].includes(extension)) {
    try {
      const sharp = (await import('sharp')).default
      const meta = await sharp(filePath).metadata()
      const dpi = meta.density || 0

      checks.push({
        id: 'resolution',
        label: 'Resolution',
        severity: dpi === 0 ? 'warning' : dpi >= 300 ? 'pass' : 'error',
        value: dpi > 0 ? `${dpi} DPI` : 'Unknown'
      })

      checks.push({
        id: 'dimensions',
        label: 'Dimensions',
        severity: 'info',
        value: `${meta.width} x ${meta.height} px`
      })

      const colorSpace = meta.space || 'unknown'
      checks.push({
        id: 'color-space',
        label: 'Color Space',
        severity: colorSpace === 'cmyk' ? 'pass' : 'warning',
        value: colorSpace.toUpperCase()
      })

      checks.push({
        id: 'icc-profile',
        label: 'ICC Profile',
        severity: meta.icc ? 'pass' : 'warning',
        value: meta.icc ? 'Embedded' : 'None'
      })
    } catch {}
  }

  // PSD preflight
  if (['.psd', '.psb'].includes(extension)) {
    try {
      const { readPsd } = await import('ag-psd')
      const buffer = await readFile(filePath)
      const psd = readPsd(buffer, { skipLayerImageData: true, skipCompositeImageData: true })

      checks.push({ id: 'dimensions', label: 'Dimensions', severity: 'info', value: `${psd.width} x ${psd.height} px` })

      const modeNames: Record<number, string> = { 0: 'Bitmap', 1: 'Grayscale', 3: 'RGB', 4: 'CMYK' }
      checks.push({
        id: 'color-mode',
        label: 'Color Mode',
        severity: psd.colorMode === 4 ? 'pass' : 'warning',
        value: modeNames[psd.colorMode as number] || 'Unknown'
      })

      checks.push({ id: 'layers', label: 'Layers', severity: 'info', value: `${psd.children?.length || 0}` })
    } catch {}
  }

  // PDF preflight
  if (['.pdf', '.ai'].includes(extension)) {
    try {
      const buffer = await readFile(filePath)
      const content = buffer.toString('ascii')

      const versionMatch = content.match(/%PDF-(\d+\.\d+)/)
      if (versionMatch) {
        checks.push({ id: 'pdf-version', label: 'PDF Version', severity: 'info', value: versionMatch[1] })
      }

      const hasRGB = content.includes('/DeviceRGB')
      const hasCMYK = content.includes('/DeviceCMYK')
      checks.push({
        id: 'color-space',
        label: 'Color Space',
        severity: hasRGB && !hasCMYK ? 'warning' : hasCMYK ? (hasRGB ? 'warning' : 'pass') : 'info',
        value: hasRGB && hasCMYK ? 'Mixed' : hasCMYK ? 'CMYK' : hasRGB ? 'RGB' : 'Unknown'
      })

      const pageMatches = content.match(/\/Type\s*\/Page[^s]/g)
      if (pageMatches) {
        checks.push({ id: 'pages', label: 'Pages', severity: 'info', value: `${pageMatches.length}` })
      }
    } catch {}
  }

  const hasError = checks.some(c => c.severity === 'error')
  const hasWarning = checks.some(c => c.severity === 'warning')

  return {
    fileName: name,
    fileType: extension,
    overallStatus: hasError ? 'error' : hasWarning ? 'warning' : 'pass',
    checks,
    timestamp: new Date().toISOString()
  }
}
