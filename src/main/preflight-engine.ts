import { IpcMain } from 'electron'
import { readFile, stat } from 'fs/promises'
import { extname, basename } from 'path'

export type Severity = 'pass' | 'warning' | 'error' | 'info'

export interface PreflightCheck {
  id: string
  label: string
  severity: Severity
  value: string
  detail?: string
}

export interface PreflightReport {
  fileName: string
  fileType: string
  overallStatus: 'pass' | 'warning' | 'error'
  checks: PreflightCheck[]
  timestamp: string
}

const MIN_PRINT_DPI = 300
const MAX_INK_COVERAGE = 300 // % TAC
const STANDARD_BLEED_MM = 3

export function registerPreflightHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('preflight:run', async (_e, filePath: string): Promise<PreflightReport> => {
    const ext = extname(filePath).toLowerCase()
    const name = basename(filePath)
    const fileStats = await stat(filePath)
    const checks: PreflightCheck[] = []

    // File size check
    const sizeMB = fileStats.size / (1024 * 1024)
    checks.push({
      id: 'file-size',
      label: 'File Size',
      severity: sizeMB > 500 ? 'warning' : 'pass',
      value: sizeMB < 1 ? `${(sizeMB * 1024).toFixed(0)} KB` : `${sizeMB.toFixed(1)} MB`,
      detail: sizeMB > 500 ? 'Large file may cause processing delays' : undefined
    })

    // Image preflight
    if (['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.bmp'].includes(ext)) {
      try {
        const sharp = (await import('sharp')).default
        const meta = await sharp(filePath).metadata()

        // Resolution
        const dpi = meta.density || 0
        checks.push({
          id: 'resolution',
          label: 'Resolution',
          severity: dpi === 0 ? 'warning' : dpi >= MIN_PRINT_DPI ? 'pass' : 'error',
          value: dpi > 0 ? `${dpi} DPI` : 'Unknown',
          detail: dpi > 0 && dpi < MIN_PRINT_DPI
            ? `Below ${MIN_PRINT_DPI} DPI minimum for print`
            : dpi === 0 ? 'No DPI metadata found' : undefined
        })

        // Dimensions
        checks.push({
          id: 'dimensions',
          label: 'Dimensions',
          severity: 'info',
          value: `${meta.width} x ${meta.height} px`
        })

        // Color space
        const colorSpace = meta.space || 'unknown'
        const isCmyk = colorSpace === 'cmyk'
        checks.push({
          id: 'color-space',
          label: 'Color Space',
          severity: isCmyk ? 'pass' : 'warning',
          value: colorSpace.toUpperCase(),
          detail: !isCmyk ? 'Not CMYK — may need color conversion for print' : undefined
        })

        // Bit depth
        checks.push({
          id: 'bit-depth',
          label: 'Bit Depth',
          severity: 'info',
          value: meta.depth || 'Unknown'
        })

        // Alpha channel
        if (meta.hasAlpha) {
          checks.push({
            id: 'transparency',
            label: 'Transparency',
            severity: 'warning',
            value: 'Has alpha channel',
            detail: 'Transparency may not render correctly in print'
          })
        }

        // ICC Profile
        checks.push({
          id: 'icc-profile',
          label: 'ICC Profile',
          severity: meta.icc ? 'pass' : 'warning',
          value: meta.icc ? 'Embedded' : 'None',
          detail: !meta.icc ? 'No embedded ICC profile — colors may shift' : undefined
        })
      } catch (err) {
        checks.push({
          id: 'image-error',
          label: 'Image Analysis',
          severity: 'error',
          value: 'Failed',
          detail: String(err)
        })
      }
    }

    // PSD preflight
    if (['.psd', '.psb'].includes(ext)) {
      try {
        const { readPsd } = await import('ag-psd')
        const buffer = await readFile(filePath)
        const psd = readPsd(buffer, { skipLayerImageData: true, skipCompositeImageData: true })

        checks.push({
          id: 'dimensions',
          label: 'Dimensions',
          severity: 'info',
          value: `${psd.width} x ${psd.height} px`
        })

        // Color mode
        const colorModeNames: Record<number, string> = {
          0: 'Bitmap', 1: 'Grayscale', 2: 'Indexed', 3: 'RGB', 4: 'CMYK', 7: 'Multichannel', 8: 'Duotone', 9: 'Lab'
        }
        const mode = colorModeNames[psd.colorMode as number] || 'Unknown'
        checks.push({
          id: 'color-mode',
          label: 'Color Mode',
          severity: psd.colorMode === 4 ? 'pass' : 'warning',
          value: mode,
          detail: psd.colorMode !== 4 ? 'Not CMYK — convert before print production' : undefined
        })

        // Bit depth
        checks.push({
          id: 'bit-depth',
          label: 'Bit Depth',
          severity: 'info',
          value: `${psd.bitsPerChannel} bit`
        })

        // Layer count
        const layerCount = psd.children?.length || 0
        checks.push({
          id: 'layers',
          label: 'Layers',
          severity: layerCount > 100 ? 'warning' : 'info',
          value: `${layerCount} layers`,
          detail: layerCount > 100 ? 'Very high layer count — consider flattening' : undefined
        })

        // Check for hidden layers
        const hiddenLayers = (psd.children || []).filter(l => l.hidden).length
        if (hiddenLayers > 0) {
          checks.push({
            id: 'hidden-layers',
            label: 'Hidden Layers',
            severity: 'warning',
            value: `${hiddenLayers} hidden`,
            detail: 'Hidden layers may contain outdated content'
          })
        }
      } catch (err) {
        checks.push({
          id: 'psd-error',
          label: 'PSD Analysis',
          severity: 'error',
          value: 'Failed',
          detail: String(err)
        })
      }
    }

    // PDF preflight (basic — from file header inspection)
    if (['.pdf', '.ai'].includes(ext)) {
      try {
        const buffer = await readFile(filePath)
        const header = buffer.subarray(0, 1024).toString('ascii')

        // PDF version
        const versionMatch = header.match(/%PDF-(\d+\.\d+)/)
        if (versionMatch) {
          checks.push({
            id: 'pdf-version',
            label: 'PDF Version',
            severity: 'info',
            value: versionMatch[1]
          })
        }

        // Check for PDF/X markers
        const content = buffer.toString('ascii')
        const hasPdfX = content.includes('PDF/X') || content.includes('pdfx')
        checks.push({
          id: 'pdf-standard',
          label: 'PDF/X Standard',
          severity: hasPdfX ? 'pass' : 'info',
          value: hasPdfX ? 'PDF/X compliant' : 'Not PDF/X'
        })

        // Check for RGB color spaces
        const hasRGB = content.includes('/DeviceRGB')
        const hasCMYK = content.includes('/DeviceCMYK')
        const hasSpot = content.includes('/Separation')

        if (hasRGB && !hasCMYK) {
          checks.push({
            id: 'color-space',
            label: 'Color Space',
            severity: 'warning',
            value: 'RGB detected',
            detail: 'Contains RGB objects — convert to CMYK for print'
          })
        } else if (hasCMYK) {
          checks.push({
            id: 'color-space',
            label: 'Color Space',
            severity: hasRGB ? 'warning' : 'pass',
            value: hasRGB ? 'Mixed RGB + CMYK' : 'CMYK',
            detail: hasRGB ? 'Contains both RGB and CMYK — ensure RGB is converted' : undefined
          })
        }

        if (hasSpot) {
          checks.push({
            id: 'spot-colors',
            label: 'Spot Colors',
            severity: 'info',
            value: 'Present'
          })
        }

        // Check for transparency
        const hasTransparency = content.includes('/Group') && content.includes('/Transparency')
        if (hasTransparency) {
          checks.push({
            id: 'transparency',
            label: 'Transparency',
            severity: 'warning',
            value: 'Live transparency detected',
            detail: 'May need flattening for older RIP systems'
          })
        }

        // Fonts - check for embedded
        const hasType1 = content.includes('/Type1')
        const hasTrueType = content.includes('/TrueType')
        const hasType0 = content.includes('/Type0')
        const fontTypes: string[] = []
        if (hasType1) fontTypes.push('Type1')
        if (hasTrueType) fontTypes.push('TrueType')
        if (hasType0) fontTypes.push('CID/OpenType')

        checks.push({
          id: 'fonts',
          label: 'Fonts',
          severity: fontTypes.length > 0 ? 'info' : 'pass',
          value: fontTypes.length > 0 ? fontTypes.join(', ') : 'No embedded fonts (likely outlined)'
        })

        // Overprint
        const hasOverprint = content.includes('/OP true') || content.includes('/op true')
        if (hasOverprint) {
          checks.push({
            id: 'overprint',
            label: 'Overprint',
            severity: 'info',
            value: 'Overprint settings detected'
          })
        }

        // Page count estimation (rough)
        const pageMatches = content.match(/\/Type\s*\/Page[^s]/g)
        if (pageMatches) {
          checks.push({
            id: 'pages',
            label: 'Pages',
            severity: 'info',
            value: `~${pageMatches.length} pages`
          })
        }
      } catch (err) {
        checks.push({
          id: 'pdf-error',
          label: 'PDF Analysis',
          severity: 'error',
          value: 'Failed',
          detail: String(err)
        })
      }
    }

    // Font preflight
    if (['.otf', '.ttf', '.woff', '.woff2'].includes(ext)) {
      try {
        const opentype = await import('opentype.js')
        const buffer = await readFile(filePath)
        const font = opentype.parse(buffer.buffer)

        checks.push({
          id: 'font-family',
          label: 'Font Family',
          severity: 'info',
          value: font.names.fontFamily?.en || 'Unknown'
        })

        checks.push({
          id: 'font-style',
          label: 'Style',
          severity: 'info',
          value: font.names.fontSubfamily?.en || 'Unknown'
        })

        checks.push({
          id: 'glyphs',
          label: 'Glyphs',
          severity: font.numGlyphs < 200 ? 'warning' : 'info',
          value: `${font.numGlyphs} glyphs`,
          detail: font.numGlyphs < 200 ? 'Low glyph count — may be missing characters' : undefined
        })

        // Greek support check
        const greekChars = 'ΑΒΓΔΕΖΗΘΙΚΛΜαβγδεζηθικλμ'
        let greekSupport = 0
        for (const char of greekChars) {
          const glyph = font.charToGlyph(char)
          if (glyph && glyph.index > 0) greekSupport++
        }
        const greekPct = Math.round((greekSupport / greekChars.length) * 100)
        checks.push({
          id: 'greek-support',
          label: 'Greek Support',
          severity: greekPct >= 90 ? 'pass' : greekPct > 0 ? 'warning' : 'error',
          value: `${greekPct}%`,
          detail: greekPct < 90 ? 'Limited Greek character support' : undefined
        })
      } catch (err) {
        checks.push({
          id: 'font-error',
          label: 'Font Analysis',
          severity: 'error',
          value: 'Failed',
          detail: String(err)
        })
      }
    }

    // Calculate overall status
    const hasError = checks.some(c => c.severity === 'error')
    const hasWarning = checks.some(c => c.severity === 'warning')

    return {
      fileName: name,
      fileType: ext,
      overallStatus: hasError ? 'error' : hasWarning ? 'warning' : 'pass',
      checks,
      timestamp: new Date().toISOString()
    }
  })
}
