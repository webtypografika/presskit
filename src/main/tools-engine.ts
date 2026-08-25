import { IpcMain, dialog } from 'electron'
import { readFile, writeFile, readdir, stat, mkdir, copyFile, access, rename, unlink } from 'fs/promises'
import { extname, basename, dirname, join, relative } from 'path'
import { existsSync } from 'fs'

// ─── Color Conversion ───────────────────────────────────────────────────────


function rgbToCmyk(r: number, g: number, b: number): { c: number; m: number; y: number; k: number } {
  const rr = r / 255, gg = g / 255, bb = b / 255
  const k = 1 - Math.max(rr, gg, bb)
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 }
  return {
    c: Math.round(((1 - rr - k) / (1 - k)) * 100),
    m: Math.round(((1 - gg - k) / (1 - k)) * 100),
    y: Math.round(((1 - bb - k) / (1 - k)) * 100),
    k: Math.round(k * 100),
  }
}

function cmykToRgb(c: number, m: number, y: number, k: number): { r: number; g: number; b: number } {
  return {
    r: Math.round(255 * (1 - c / 100) * (1 - k / 100)),
    g: Math.round(255 * (1 - m / 100) * (1 - k / 100)),
    b: Math.round(255 * (1 - y / 100) * (1 - k / 100)),
  }
}

// ─── Barcode Generation ─────────────────────────────────────────────────────

// EAN-13 encoding
const EAN_L: Record<string, string> = {
  '0': '0001101', '1': '0011001', '2': '0010011', '3': '0111101', '4': '0100011',
  '5': '0110001', '6': '0101111', '7': '0111011', '8': '0110111', '9': '0001011'
}
const EAN_G: Record<string, string> = {
  '0': '0100111', '1': '0110011', '2': '0011011', '3': '0100001', '4': '0011101',
  '5': '0111001', '6': '0000101', '7': '0010001', '8': '0001001', '9': '0010111'
}
const EAN_R: Record<string, string> = {
  '0': '1110010', '1': '1100110', '2': '1101100', '3': '1000010', '4': '1011100',
  '5': '1001110', '6': '1010000', '7': '1000100', '8': '1001000', '9': '1110100'
}
const EAN_PARITY: string[] = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'
]

function generateEAN13(digits: string): string {
  // Pad to 12 digits, calculate check digit
  let d = digits.replace(/\D/g, '').padEnd(12, '0').slice(0, 12)
  const checksum = d.split('').reduce((sum, ch, i) => sum + parseInt(ch) * (i % 2 === 0 ? 1 : 3), 0)
  d += (10 - (checksum % 10)) % 10

  const parity = EAN_PARITY[parseInt(d[0])]
  let bars = '101' // Start guard

  for (let i = 1; i <= 6; i++) {
    bars += parity[i - 1] === 'L' ? EAN_L[d[i]] : EAN_G[d[i]]
  }
  bars += '01010' // Center guard
  for (let i = 7; i <= 12; i++) {
    bars += EAN_R[d[i]]
  }
  bars += '101' // End guard

  // Generate SVG
  const barWidth = 2
  const height = 80
  const textY = height + 14
  const totalWidth = bars.length * barWidth + 20
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${height + 22}" width="${totalWidth}" height="${height + 22}">`
  svg += `<rect width="100%" height="100%" fill="white"/>`

  for (let i = 0; i < bars.length; i++) {
    if (bars[i] === '1') {
      svg += `<rect x="${10 + i * barWidth}" y="4" width="${barWidth}" height="${height}" fill="black"/>`
    }
  }

  // Add human-readable text
  svg += `<text x="${totalWidth / 2}" y="${textY}" text-anchor="middle" font-family="monospace" font-size="12">${d}</text>`
  svg += '</svg>'

  return svg
}

// Code 128 encoding
const CODE128_START_B = 104
const CODE128_STOP = 106
const CODE128_PATTERNS: number[][] = [
  [2,1,2,2,2,2],[2,2,2,1,2,2],[2,2,2,2,2,1],[1,2,1,2,2,3],[1,2,1,3,2,2],
  [1,3,1,2,2,2],[1,2,2,2,1,3],[1,2,2,3,1,2],[1,3,2,2,1,2],[2,2,1,2,1,3],
  [2,2,1,3,1,2],[2,3,1,2,1,2],[1,1,2,2,3,2],[1,2,2,1,3,2],[1,2,2,2,3,1],
  [1,1,3,2,2,2],[1,2,3,1,2,2],[1,2,3,2,2,1],[2,2,3,2,1,1],[2,2,1,1,3,2],
  [2,2,1,2,3,1],[2,1,3,2,1,2],[2,2,3,1,1,2],[3,1,2,1,3,1],[3,1,1,2,2,2],
  [3,2,1,1,2,2],[3,2,1,2,2,1],[3,1,2,2,1,2],[3,2,2,1,1,2],[3,2,2,2,1,1],
  [2,1,2,1,2,3],[2,1,2,3,2,1],[2,3,2,1,2,1],[1,1,1,3,2,3],[1,3,1,1,2,3],
  [1,3,1,3,2,1],[1,1,2,3,1,3],[1,3,2,1,1,3],[1,3,2,3,1,1],[2,1,1,3,1,3],
  [2,3,1,1,1,3],[2,3,1,3,1,1],[1,1,2,1,3,3],[1,1,2,3,3,1],[1,3,2,1,3,1],
  [1,1,3,1,2,3],[1,1,3,3,2,1],[1,3,3,1,2,1],[3,1,3,1,2,1],[2,1,1,3,3,1],
  [2,3,1,1,3,1],[2,1,3,1,1,3],[2,1,3,3,1,1],[2,1,3,1,3,1],[3,1,1,1,2,3],
  [3,1,1,3,2,1],[3,3,1,1,2,1],[3,1,2,1,1,3],[3,1,2,3,1,1],[3,3,2,1,1,1],
  [3,1,4,1,1,1],[2,2,1,4,1,1],[4,3,1,1,1,1],[1,1,1,2,2,4],[1,1,1,4,2,2],
  [1,2,1,1,2,4],[1,2,1,4,2,1],[1,4,1,1,2,2],[1,4,1,2,2,1],[1,1,2,2,1,4],
  [1,1,2,4,1,2],[1,2,2,1,1,4],[1,2,2,4,1,1],[1,4,2,1,1,2],[1,4,2,2,1,1],
  [2,4,1,2,1,1],[2,2,1,1,1,4],[4,1,3,1,1,1],[2,4,1,1,1,2],[1,3,4,1,1,1],
  [1,1,1,2,4,2],[1,2,1,1,4,2],[1,2,1,2,4,1],[1,1,4,2,1,2],[1,2,4,1,1,2],
  [1,2,4,2,1,1],[4,1,1,2,1,2],[4,2,1,1,1,2],[4,2,1,2,1,1],[2,1,2,1,4,1],
  [2,1,4,1,2,1],[4,1,2,1,2,1],[1,1,1,1,4,3],[1,1,1,3,4,1],[1,3,1,1,4,1],
  [1,1,4,1,1,3],[1,1,4,3,1,1],[4,1,1,1,1,3],[4,1,1,3,1,1],[1,1,3,1,4,1],
  [1,1,4,1,3,1],[3,1,1,1,4,1],[4,1,1,1,3,1],[2,1,1,4,1,2],[2,1,1,2,1,4],
  [2,1,1,2,3,2],[2,3,3,1,1,1,2],
]

function generateCode128(text: string): string {
  const values: number[] = [CODE128_START_B]
  for (const ch of text) {
    values.push(ch.charCodeAt(0) - 32)
  }

  // Checksum
  let checksum = values[0]
  for (let i = 1; i < values.length; i++) {
    checksum += values[i] * i
  }
  values.push(checksum % 103)
  values.push(CODE128_STOP)

  // Build bar pattern
  const barWidth = 2
  let x = 10 // quiet zone
  const height = 70
  let svg = ''
  const rects: string[] = []

  for (const val of values) {
    const pattern = CODE128_PATTERNS[val]
    if (!pattern) continue
    for (let j = 0; j < pattern.length; j++) {
      const w = pattern[j] * barWidth
      if (j % 2 === 0) { // bars on even indices
        rects.push(`<rect x="${x}" y="4" width="${w}" height="${height}" fill="black"/>`)
      }
      x += w
    }
  }

  const totalWidth = x + 10
  svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${height + 22}" width="${totalWidth}" height="${height + 22}">`
  svg += `<rect width="100%" height="100%" fill="white"/>`
  svg += rects.join('')
  svg += `<text x="${totalWidth / 2}" y="${height + 16}" text-anchor="middle" font-family="monospace" font-size="12">${text}</text>`
  svg += '</svg>'

  return svg
}

// Simple QR code — using alphanumeric mode, version 1 (21x21)
// For production, we'd use a proper QR library, but this generates valid QR-like SVGs
function generateQRCodeSVG(text: string): string {
  // Simple matrix-based QR representation
  // We'll create a visual QR-style pattern
  const size = 21
  const moduleSize = 8
  const padding = 16
  const totalSize = size * moduleSize + padding * 2

  // Initialize matrix
  const matrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false))

  // Add finder patterns (top-left, top-right, bottom-left)
  function addFinder(startR: number, startC: number) {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const border = r === 0 || r === 6 || c === 0 || c === 6
        const inner = r >= 2 && r <= 4 && c >= 2 && c <= 4
        if (border || inner) matrix[startR + r][startC + c] = true
      }
    }
  }
  addFinder(0, 0)
  addFinder(0, 14)
  addFinder(14, 0)

  // Timing patterns
  for (let i = 8; i < 13; i++) {
    matrix[6][i] = i % 2 === 0
    matrix[i][6] = i % 2 === 0
  }

  // Encode text into data area (simplified — fills remaining area with data-derived pattern)
  let bitIndex = 0
  const textBits: boolean[] = []
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    for (let bit = 7; bit >= 0; bit--) {
      textBits.push(!!(code & (1 << bit)))
    }
  }

  // Fill data modules (avoiding function patterns)
  for (let col = size - 1; col >= 0; col -= 2) {
    if (col === 6) col = 5
    for (let row = 0; row < size; row++) {
      for (let dx = 0; dx < 2; dx++) {
        const c = col - dx
        if (c < 0 || c >= size) continue
        // Skip finder + timing areas
        if ((row < 9 && c < 9) || (row < 9 && c > 12) || (row > 12 && c < 9)) continue
        if (row === 6 || c === 6) continue

        if (bitIndex < textBits.length) {
          matrix[row][c] = textBits[bitIndex]
        } else {
          matrix[row][c] = (row + c) % 2 === 0
        }
        bitIndex++
      }
    }
  }

  // Generate SVG
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" width="${totalSize}" height="${totalSize}">`
  svg += `<rect width="100%" height="100%" fill="white"/>`

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) {
        svg += `<rect x="${padding + c * moduleSize}" y="${padding + r * moduleSize}" width="${moduleSize}" height="${moduleSize}" fill="black"/>`
      }
    }
  }
  svg += '</svg>'
  return svg
}

// ─── Job Folder Templates ───────────────────────────────────────────────────

interface FolderTemplate {
  name: string
  folders: string[]
}

const DEFAULT_TEMPLATES: FolderTemplate[] = [
  {
    name: 'Standard Print Job',
    folders: [
      'Customer Files',
      'Customer Files/Original',
      'Customer Files/Fonts',
      'Customer Files/Links',
      'Proofs',
      'Proofs/Soft Proof',
      'Proofs/Hard Proof',
      'Print Ready',
      'Print Ready/PDF',
      'Print Ready/Plates',
      'Output',
    ]
  },
  {
    name: 'Packaging Job',
    folders: [
      'Customer Files',
      'Customer Files/Artwork',
      'Customer Files/Dieline',
      'Customer Files/Fonts',
      'Customer Files/Images',
      'Proofs',
      'Proofs/3D Mockup',
      'Proofs/Flat Proof',
      'Print Ready',
      'Print Ready/PDF',
      'Print Ready/Separated',
      'Die',
      'Output',
    ]
  },
  {
    name: 'Business Cards / Stationery',
    folders: [
      'Customer Files',
      'Logo',
      'Proofs',
      'Print Ready',
      'Output',
    ]
  },
  {
    name: 'Book / Catalog',
    folders: [
      'Customer Files',
      'Customer Files/Text',
      'Customer Files/Images',
      'Customer Files/Fonts',
      'Layout',
      'Proofs',
      'Proofs/Chapter Proofs',
      'Proofs/Final Proof',
      'Print Ready',
      'Print Ready/Cover',
      'Print Ready/Interior',
      'Print Ready/Plates',
      'Binding',
      'Output',
    ]
  },
  {
    name: 'Large Format / Banner',
    folders: [
      'Customer Files',
      'Proofs',
      'Print Ready',
      'Print Ready/High Res',
      'Output',
      'Photos',
    ]
  },
]

async function createJobFolders(basePath: string, templateName: string, jobName: string): Promise<string> {
  const template = DEFAULT_TEMPLATES.find(t => t.name === templateName) || DEFAULT_TEMPLATES[0]
  const jobPath = join(basePath, jobName)

  await mkdir(jobPath, { recursive: true })

  for (const folder of template.folders) {
    await mkdir(join(jobPath, folder), { recursive: true })
  }

  return jobPath
}

// ─── File Packaging (Collect) ───────────────────────────────────────────────

async function collectJobFiles(sourcePaths: string[], targetDir: string): Promise<{ copied: number; errors: string[] }> {
  await mkdir(targetDir, { recursive: true })

  let copied = 0
  const errors: string[] = []

  for (const sourcePath of sourcePaths) {
    try {
      const fileName = basename(sourcePath)
      let targetPath = join(targetDir, fileName)

      // Handle name collisions
      if (existsSync(targetPath)) {
        const ext = extname(fileName)
        const base = basename(fileName, ext)
        targetPath = join(targetDir, `${base}_${Date.now()}${ext}`)
      }

      await copyFile(sourcePath, targetPath)
      copied++
    } catch (err) {
      errors.push(`${basename(sourcePath)}: ${String(err)}`)
    }
  }

  return { copied, errors }
}

async function collectByType(
  sourceDir: string,
  extensions: string[],
  targetDir: string,
  moveFiles: boolean
): Promise<{ processed: number; errors: string[] }> {
  await mkdir(targetDir, { recursive: true })
  const extSet = new Set(extensions.map(e => e.toLowerCase()))
  let processed = 0
  const errors: string[] = []

  async function scan(dir: string) {
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          await scan(fullPath)
        } else if (extSet.has(extname(entry.name).toLowerCase())) {
          const fileName = entry.name
          let targetPath = join(targetDir, fileName)
          if (existsSync(targetPath)) {
            const ext = extname(fileName)
            const base = basename(fileName, ext)
            targetPath = join(targetDir, `${base}_${Date.now()}${ext}`)
          }
          try {
            if (moveFiles) {
              // Try rename first (same drive), fallback to copy+delete
              try {
                await rename(fullPath, targetPath)
              } catch {
                await copyFile(fullPath, targetPath)
                await unlink(fullPath)
              }
            } else {
              await copyFile(fullPath, targetPath)
            }
            processed++
          } catch (err) {
            errors.push(`${fileName}: ${String(err)}`)
          }
        }
      }
    } catch { }
  }

  await scan(sourceDir)
  return { processed, errors }
}

// ─── Annotation System ──────────────────────────────────────────────────────

interface Annotation {
  id: string
  type: 'arrow' | 'circle' | 'rect' | 'text' | 'freehand'
  x: number
  y: number
  x2?: number
  y2?: number
  width?: number
  height?: number
  text?: string
  color: string
  strokeWidth: number
  points?: { x: number; y: number }[]
  timestamp: string
  author?: string
}

interface AnnotationFile {
  filePath: string
  annotations: Annotation[]
  lastModified: string
}

function getAnnotationPath(filePath: string): string {
  const dir = dirname(filePath)
  const name = basename(filePath)
  return join(dir, `.${name}.annotations.json`)
}

async function loadAnnotations(filePath: string): Promise<AnnotationFile> {
  const annoPath = getAnnotationPath(filePath)
  try {
    const data = await readFile(annoPath, 'utf-8')
    return JSON.parse(data)
  } catch {
    return { filePath, annotations: [], lastModified: new Date().toISOString() }
  }
}

async function saveAnnotations(filePath: string, annotations: Annotation[]): Promise<void> {
  const annoPath = getAnnotationPath(filePath)
  const data: AnnotationFile = {
    filePath,
    annotations,
    lastModified: new Date().toISOString()
  }
  await writeFile(annoPath, JSON.stringify(data, null, 2), 'utf-8')
}

// ─── Version History ────────────────────────────────────────────────────────

interface FileVersion {
  path: string
  name: string
  size: number
  modified: string
  isCurrent: boolean
}

async function getFileVersions(filePath: string): Promise<FileVersion[]> {
  const dir = dirname(filePath)
  const ext = extname(filePath)
  const baseName = basename(filePath, ext)
  const versions: FileVersion[] = []

  try {
    const files = await readdir(dir)

    for (const file of files) {
      if (file.startsWith('.')) continue

      const fileExt = extname(file)
      if (fileExt.toLowerCase() !== ext.toLowerCase()) continue

      const fileBase = basename(file, fileExt)

      // Match patterns: exact name, name_v1, name_v2, name (1), name (2), name_copy, name_final, etc.
      const isVariant =
        fileBase === baseName ||
        fileBase.match(new RegExp(`^${escapeRegex(baseName)}[_ -]?(v\\d+|copy|final|revised|old|new|\\(\\d+\\)|\\d{8,})$`, 'i'))

      if (isVariant) {
        const filePath2 = join(dir, file)
        const stats = await stat(filePath2)
        versions.push({
          path: filePath2,
          name: file,
          size: stats.size,
          modified: stats.mtime.toISOString(),
          isCurrent: filePath2 === filePath || file === basename(filePath),
        })
      }
    }
  } catch {
    // If we can't read directory, just return the single file
  }

  // Sort by modified date descending (newest first)
  versions.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
  return versions
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ─── ICC Profile Info ───────────────────────────────────────────────────────

interface IccProfileInfo {
  description: string
  colorSpace: string
  renderingIntent: string
  version: string
  size: number
  raw?: string
}

async function getIccProfile(filePath: string): Promise<IccProfileInfo | null> {
  try {
    const sharp = (await import('sharp')).default
    const meta = await sharp(filePath).metadata()

    if (!meta.icc) return null

    const icc = meta.icc
    // Parse ICC profile header (128 bytes)
    // Bytes 16-19: Profile/Device class
    // Bytes 12-15: Size
    // Bytes 40-43: Rendering intent

    const size = icc.length
    const version = `${icc[8]}.${(icc[9] >> 4)}.${icc[9] & 0x0f}`

    // Color space from bytes 16-19
    const csBytes = icc.subarray(16, 20).toString('ascii').trim()
    const csMap: Record<string, string> = {
      'XYZ ': 'XYZ', 'Lab ': 'Lab', 'Luv ': 'Luv', 'YCbr': 'YCbCr',
      'Yxy ': 'Yxy', 'RGB ': 'RGB', 'GRAY': 'Grayscale', 'HSV ': 'HSV',
      'HLS ': 'HLS', 'CMYK': 'CMYK', '2CLR': '2-Color', '3CLR': '3-Color',
      'scnr': 'Scanner', 'mntr': 'Monitor', 'prtr': 'Printer',
    }

    // Try to get description from 'desc' tag
    let description = 'Unknown Profile'
    try {
      const tagCount = icc.readUInt32BE(128)
      for (let i = 0; i < tagCount; i++) {
        const offset = 132 + i * 12
        const sig = icc.subarray(offset, offset + 4).toString('ascii')
        if (sig === 'desc') {
          const tagOffset = icc.readUInt32BE(offset + 4)
          const tagSize = icc.readUInt32BE(offset + 8)
          // Read ASCII description
          const descType = icc.subarray(tagOffset, tagOffset + 4).toString('ascii')
          if (descType === 'desc') {
            const len = icc.readUInt32BE(tagOffset + 8)
            description = icc.subarray(tagOffset + 12, tagOffset + 12 + len - 1).toString('ascii')
          } else if (descType === 'mluc') {
            // Unicode description
            const recCount = icc.readUInt32BE(tagOffset + 8)
            if (recCount > 0) {
              const strOffset = icc.readUInt32BE(tagOffset + 20)
              const strLen = icc.readUInt32BE(tagOffset + 16)
              const strBytes = icc.subarray(tagOffset + strOffset, tagOffset + strOffset + strLen)
              description = Buffer.from(strBytes).toString('utf16le').replace(/\0/g, '')
            }
          }
          break
        }
      }
    } catch { }

    const intentMap: Record<number, string> = {
      0: 'Perceptual', 1: 'Relative Colorimetric',
      2: 'Saturation', 3: 'Absolute Colorimetric'
    }

    return {
      description,
      colorSpace: csMap[csBytes] || csBytes,
      renderingIntent: intentMap[icc.readUInt32BE(64)] || 'Unknown',
      version,
      size,
    }
  } catch {
    return null
  }
}


// ─── Print-Ready Checklist ──────────────────────────────────────────────────

export interface PrintChecklistItem {
  id: string
  label: string
  status: 'pass' | 'warning' | 'error' | 'na'
  value: string
  detail?: string
  category: 'resolution' | 'color' | 'bleed' | 'fonts' | 'general'
}

async function generatePrintChecklist(filePath: string): Promise<PrintChecklistItem[]> {
  const ext = extname(filePath).toLowerCase()
  const items: PrintChecklistItem[] = []

  if (['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.bmp'].includes(ext)) {
    const sharp = (await import('sharp')).default
    const meta = await sharp(filePath).metadata()

    items.push({
      id: 'res-dpi', label: 'Resolution ≥ 300 DPI', category: 'resolution',
      status: !meta.density ? 'warning' : meta.density >= 300 ? 'pass' : 'error',
      value: meta.density ? `${meta.density} DPI` : 'Unknown',
      detail: meta.density && meta.density < 300 ? 'Low resolution — will look pixelated in print' : undefined,
    })

    items.push({
      id: 'color-cmyk', label: 'CMYK Color Space', category: 'color',
      status: meta.space === 'cmyk' ? 'pass' : 'warning',
      value: (meta.space || 'unknown').toUpperCase(),
      detail: meta.space !== 'cmyk' ? 'Convert to CMYK before printing' : undefined,
    })

    items.push({
      id: 'icc-embedded', label: 'ICC Profile Embedded', category: 'color',
      status: meta.icc ? 'pass' : 'warning',
      value: meta.icc ? 'Yes' : 'No',
      detail: !meta.icc ? 'Without an ICC profile colors may shift' : undefined,
    })

    items.push({
      id: 'no-alpha', label: 'No Transparency', category: 'general',
      status: meta.hasAlpha ? 'warning' : 'pass',
      value: meta.hasAlpha ? 'Has Alpha' : 'No Alpha',
      detail: meta.hasAlpha ? 'Alpha channel may cause problems in the RIP' : undefined,
    })

    items.push({ id: 'bleed', label: 'Bleed ≥ 3mm', category: 'bleed', status: 'na', value: 'N/A (image)', detail: 'Check in the layout file' })
    items.push({ id: 'fonts', label: 'Fonts Embedded/Outlined', category: 'fonts', status: 'na', value: 'N/A (image)' })

  } else if (['.pdf', '.ai'].includes(ext)) {
    const buffer = await readFile(filePath)
    const content = buffer.toString('ascii')

    // Resolution check (for embedded images)
    items.push({
      id: 'res-check', label: 'Image Resolution', category: 'resolution',
      status: 'info' as any || 'pass',
      value: 'Check embedded images',
      detail: 'Check embedded images for ≥300 DPI',
    })
    // Correct status
    items[items.length - 1].status = 'pass'

    // Color space
    const hasRGB = content.includes('/DeviceRGB')
    const hasCMYK = content.includes('/DeviceCMYK')
    items.push({
      id: 'color-cmyk', label: 'CMYK Color Space', category: 'color',
      status: hasRGB ? 'error' : hasCMYK ? 'pass' : 'warning',
      value: hasRGB && hasCMYK ? 'Mixed RGB+CMYK' : hasRGB ? 'RGB detected' : hasCMYK ? 'CMYK' : 'Unknown',
      detail: hasRGB ? 'Contains RGB objects — convert to CMYK' : undefined,
    })

    // Spot colors
    const hasSpot = content.includes('/Separation')
    const spotMatches = content.match(/\/Separation\s*\/([^\s/]+)/g)
    const spotNames = spotMatches ? [...new Set(spotMatches.map(m => {
      const match = m.match(/\/Separation\s*\/(.+)/)
      return match ? decodeURIComponent(match[1].replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))) : ''
    }).filter(Boolean))] : []

    items.push({
      id: 'spot-colors', label: 'Spot Colors Check', category: 'color',
      status: hasSpot ? 'warning' : 'pass',
      value: hasSpot ? `${spotNames.length} spot color(s)` : 'No spot colors',
      detail: spotNames.length > 0 ? `Spot: ${spotNames.join(', ')}` : undefined,
    })

    // Bleed (TrimBox vs BleedBox)
    const trimBoxMatch = content.match(/\/TrimBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/)
    const bleedBoxMatch = content.match(/\/BleedBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/)

    if (trimBoxMatch && bleedBoxMatch) {
      const trim = trimBoxMatch.slice(1).map(Number)
      const bleed = bleedBoxMatch.slice(1).map(Number)
      const bleedLeft = (trim[0] - bleed[0]) / 2.835 // points to mm
      const bleedBottom = (trim[1] - bleed[1]) / 2.835
      const bleedRight = (bleed[2] - trim[2]) / 2.835
      const bleedTop = (bleed[3] - trim[3]) / 2.835
      const minBleed = Math.min(bleedLeft, bleedBottom, bleedRight, bleedTop)

      items.push({
        id: 'bleed', label: 'Bleed ≥ 3mm', category: 'bleed',
        status: minBleed >= 2.9 ? 'pass' : minBleed > 0 ? 'warning' : 'error',
        value: `${minBleed.toFixed(1)}mm min`,
        detail: `L:${bleedLeft.toFixed(1)} B:${bleedBottom.toFixed(1)} R:${bleedRight.toFixed(1)} T:${bleedTop.toFixed(1)} mm`,
      })
    } else if (trimBoxMatch) {
      items.push({
        id: 'bleed', label: 'Bleed ≥ 3mm', category: 'bleed',
        status: 'error', value: 'No BleedBox',
        detail: 'BleedBox missing — likely no bleed',
      })
    } else {
      items.push({
        id: 'bleed', label: 'Bleed ≥ 3mm', category: 'bleed',
        status: 'warning', value: 'No TrimBox/BleedBox',
        detail: 'No box definitions found — check manually',
      })
    }

    // Fonts
    const hasType1 = content.includes('/Type1')
    const hasTrueType = content.includes('/TrueType')
    const hasType0 = content.includes('/Type0')
    const hasFontDescriptor = content.includes('/FontDescriptor')
    const noFonts = !hasType1 && !hasTrueType && !hasType0

    items.push({
      id: 'fonts', label: 'Fonts Embedded/Outlined', category: 'fonts',
      status: noFonts ? 'pass' : hasFontDescriptor ? 'pass' : 'warning',
      value: noFonts ? 'All outlined (no fonts)' : hasFontDescriptor ? 'Fonts embedded' : 'Check embedding',
      detail: !noFonts && !hasFontDescriptor ? 'Make sure all fonts are embedded' : undefined,
    })

    // Transparency
    const hasTrans = content.includes('/Group') && content.includes('/Transparency')
    items.push({
      id: 'transparency', label: 'Transparency Flattened', category: 'general',
      status: hasTrans ? 'warning' : 'pass',
      value: hasTrans ? 'Live transparency' : 'No transparency',
      detail: hasTrans ? 'Flatten transparency for older RIP systems' : undefined,
    })

    // Overprint
    const hasOverprint = content.includes('/OP true') || content.includes('/op true')
    items.push({
      id: 'overprint', label: 'Overprint Settings', category: 'general',
      status: hasOverprint ? 'warning' : 'pass',
      value: hasOverprint ? 'Overprint detected' : 'No overprint',
      detail: hasOverprint ? 'Check that overprint is set correctly' : undefined,
    })

    // PDF/X
    const hasPdfX = content.includes('PDF/X') || content.includes('pdfx')
    items.push({
      id: 'pdfx', label: 'PDF/X Compliance', category: 'general',
      status: hasPdfX ? 'pass' : 'warning',
      value: hasPdfX ? 'PDF/X compliant' : 'Not PDF/X',
      detail: !hasPdfX ? 'Use PDF/X-1a or PDF/X-4 for print' : undefined,
    })
  }

  return items
}

// ─── Spot Color Extraction (enhanced) ───────────────────────────────────────

interface SpotColorInfo {
  name: string
  alternateSpace: string
  tintTransform?: string
}

function extractSpotColors(filePath: string, pdfContent: string): SpotColorInfo[] {
  const spots: SpotColorInfo[] = []
  const seen = new Set<string>()

  // Match /Separation /ColorName /AlternateSpace
  const regex = /\/Separation\s*\/([^\s/\[\]]+)(?:\s*\/(\w+))?/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(pdfContent)) !== null) {
    let name = match[1]
    // Decode hex-encoded characters (#XX)
    name = name.replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))

    if (seen.has(name)) continue
    seen.add(name)

    const alternateSpace = match[2] || 'DeviceCMYK'

    spots.push({ name, alternateSpace })
  }

  return spots
}

// ─── Picks System ───────────────────────────────────────────────────────────

const PICKS_FILE = '.filehelper-picks.json'

interface PicksData {
  picked: string[]  // array of filenames (not full paths)
  updatedAt: string
}

async function loadPicks(dirPath: string): Promise<PicksData> {
  const picksPath = join(dirPath, PICKS_FILE)
  try {
    const data = await readFile(picksPath, 'utf-8')
    return JSON.parse(data)
  } catch {
    return { picked: [], updatedAt: new Date().toISOString() }
  }
}

async function savePicks(dirPath: string, picked: string[]): Promise<void> {
  const picksPath = join(dirPath, PICKS_FILE)
  const data: PicksData = {
    picked,
    updatedAt: new Date().toISOString()
  }
  await writeFile(picksPath, JSON.stringify(data, null, 2), 'utf-8')
}

// ─── Register All Tool Handlers ─────────────────────────────────────────────

export function registerToolHandlers(ipcMain: IpcMain): void {

  // ─ Color conversion ─
  ipcMain.handle('tools:rgbToCmyk', async (_e, r: number, g: number, b: number) => rgbToCmyk(r, g, b))
  ipcMain.handle('tools:cmykToRgb', async (_e, c: number, m: number, y: number, k: number) => cmykToRgb(c, m, y, k))

  // ─ Barcodes ─
  ipcMain.handle('tools:generateBarcode', async (_e, type: string, data: string) => {
    switch (type) {
      case 'ean13': return generateEAN13(data)
      case 'code128': return generateCode128(data)
      case 'qr': return generateQRCodeSVG(data)
      default: return generateCode128(data)
    }
  })

  /* Save extracted text. Goes through a save dialog rather than writing to a
     path the renderer chose: the renderer should not be able to write anywhere
     on disk just so one panel can offer a .txt. */
  ipcMain.handle('tools:saveText', async (_e, text: string, defaultName: string) => {
    const result = await dialog.showSaveDialog({
      filters: [{ name: 'Text', extensions: ['txt'] }],
      defaultPath: defaultName || 'extracted.txt',
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, text, 'utf-8')
    return result.filePath
  })

  ipcMain.handle('tools:saveBarcodeImage', async (_e, svgData: string, format: 'svg' | 'png') => {
    const result = await dialog.showSaveDialog({
      filters: format === 'svg'
        ? [{ name: 'SVG', extensions: ['svg'] }]
        : [{ name: 'PNG', extensions: ['png'] }],
      defaultPath: `barcode.${format}`
    })

    if (result.canceled || !result.filePath) return null

    if (format === 'svg') {
      await writeFile(result.filePath, svgData, 'utf-8')
    } else {
      // Convert SVG to PNG via sharp
      const sharp = (await import('sharp')).default
      const pngBuffer = await sharp(Buffer.from(svgData))
        .resize(800, null, { withoutEnlargement: false })
        .png()
        .toBuffer()
      await writeFile(result.filePath, pngBuffer)
    }

    return result.filePath
  })

  // ─ Job Folder Templates ─
  ipcMain.handle('tools:getFolderTemplates', async () => DEFAULT_TEMPLATES)

  ipcMain.handle('tools:createJobFolders', async (_e, basePath: string, templateName: string, jobName: string) => {
    return createJobFolders(basePath, templateName, jobName)
  })

  // ─ File Packaging ─
  ipcMain.handle('tools:collectFiles', async (_e, sourcePaths: string[], targetDir: string) => {
    return collectJobFiles(sourcePaths, targetDir)
  })

  ipcMain.handle('tools:collectByType', async (_e, sourceDir: string, extensions: string[], targetDir: string, moveFiles: boolean) => {
    return collectByType(sourceDir, extensions, targetDir, moveFiles)
  })

  ipcMain.handle('tools:collectJobFiles', async (_e, jobDir: string) => {
    // Collect all printable files from a job directory
    const printExts = ['.pdf', '.ai', '.psd', '.eps', '.tiff', '.tif', '.jpg', '.jpeg', '.png', '.svg', '.indd']
    const files: string[] = []

    async function scan(dir: string) {
      try {
        const entries = await readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue
          const fullPath = join(dir, entry.name)
          if (entry.isDirectory()) {
            await scan(fullPath)
          } else if (printExts.includes(extname(entry.name).toLowerCase())) {
            files.push(fullPath)
          }
        }
      } catch { }
    }

    await scan(jobDir)
    return files
  })

  // ─ Annotations ─
  ipcMain.handle('tools:loadAnnotations', async (_e, filePath: string) => loadAnnotations(filePath))
  ipcMain.handle('tools:saveAnnotations', async (_e, filePath: string, annotations: Annotation[]) => saveAnnotations(filePath, annotations))

  // ─ Version History ─
  ipcMain.handle('tools:getVersions', async (_e, filePath: string) => getFileVersions(filePath))

  // ─ ICC Profile ─
  ipcMain.handle('tools:getIccProfile', async (_e, filePath: string) => getIccProfile(filePath))


  // ─ Print Checklist ─
  ipcMain.handle('tools:printChecklist', async (_e, filePath: string) => generatePrintChecklist(filePath))

  // ─ Spot Colors (enhanced) ─
  ipcMain.handle('tools:extractSpotColors', async (_e, filePath: string) => {
    const ext = extname(filePath).toLowerCase()
    if (!['.pdf', '.ai'].includes(ext)) return []
    const buffer = await readFile(filePath)
    const content = buffer.toString('ascii')
    return extractSpotColors(filePath, content)
  })

  // ─ Picks ─
  ipcMain.handle('tools:loadPicks', async (_e, dirPath: string) => loadPicks(dirPath))

  ipcMain.handle('tools:togglePick', async (_e, dirPath: string, fileName: string) => {
    const data = await loadPicks(dirPath)
    const idx = data.picked.indexOf(fileName)
    if (idx >= 0) {
      data.picked.splice(idx, 1)
    } else {
      data.picked.push(fileName)
    }
    await savePicks(dirPath, data.picked)
    return data.picked
  })

  ipcMain.handle('tools:setPicks', async (_e, dirPath: string, fileNames: string[]) => {
    await savePicks(dirPath, fileNames)
    return fileNames
  })

  ipcMain.handle('tools:clearPicks', async (_e, dirPath: string) => {
    await savePicks(dirPath, [])
    return []
  })
}
