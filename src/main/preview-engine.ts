import { IpcMain } from 'electron'
import { readFile } from 'fs/promises'
import { extname } from 'path'
import { isRawExtension, extractRawPreview } from './raw-preview'

export interface PreviewResult {
  type: 'image' | 'pdf-page' | 'svg' | 'font-sample' | 'none'
  data: string // base64 data URL or SVG string
  width?: number
  height?: number
  pageCount?: number
  layers?: LayerInfo[]
}

export interface LayerInfo {
  name: string
  visible: boolean
  opacity: number
  blendMode?: string
}

export function registerPreviewHandlers(ipcMain: IpcMain): void {
  // Generate thumbnail for file grid
  ipcMain.handle('preview:thumbnail', async (_e, filePath: string, size: number = 256): Promise<string | null> => {
    const ext = extname(filePath).toLowerCase()

    // Image files via sharp
    if (['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.bmp'].includes(ext)) {
      try {
        const sharp = (await import('sharp')).default
        const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 10000))
        const render = sharp(filePath, { failOn: 'none', limitInputPixels: false })
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .resize(size, size, { fit: 'inside', withoutEnlargement: true })
          .png()
          .toBuffer()
          .then(buf => `data:image/png;base64,${buf.toString('base64')}`)
        return await Promise.race([render, timeout])
      } catch (err) {
        console.error(`[THUMB] Failed: ${filePath}`, (err as Error).message)
        return null
      }
    }

    // RAW camera files — extract embedded JPEG preview
    if (isRawExtension(ext)) {
      try {
        const jpegBuffer = await extractRawPreview(filePath)
        if (jpegBuffer) {
          const sharp = (await import('sharp')).default
          const buffer = await sharp(jpegBuffer)
            .resize(size, size, { fit: 'inside', withoutEnlargement: true })
            .png()
            .toBuffer()
          return `data:image/png;base64,${buffer.toString('base64')}`
        }
      } catch {
        return null
      }
    }

    // PSD composite
    if (['.psd', '.psb'].includes(ext)) {
      try {
        const { readPsd } = await import('ag-psd')
        const fileBuffer = await readFile(filePath)
        const psd = readPsd(fileBuffer, { skipLayerImageData: true })

        if (psd.canvas) {
          // ag-psd returns HTMLCanvasElement in browser, Buffer data in Node
          // In Node we need to use the imageData
          const imageData = psd.imageData
          if (imageData) {
            const sharp = (await import('sharp')).default
            const buffer = await sharp(Buffer.from(imageData.data.buffer), {
              raw: { width: psd.width, height: psd.height, channels: 4 }
            })
              .resize(size, size, { fit: 'inside', withoutEnlargement: true })
              .png()
              .toBuffer()
            return `data:image/png;base64,${buffer.toString('base64')}`
          }
        }
      } catch {
        return null
      }
    }

    // PDF thumbnails are rendered client-side via pdf.js (see renderer/lib/pdf-thumbnail.ts)
    // Return null so the renderer handles it
    if (ext === '.pdf') {
      return null
    }

    // AI/EPS — try to read embedded preview via sharp
    if (['.ai', '.eps'].includes(ext)) {
      try {
        const sharp = (await import('sharp')).default
        const buffer = await sharp(filePath, { density: 72 })
          .resize(size, size, { fit: 'inside', withoutEnlargement: true })
          .png()
          .toBuffer()
        return `data:image/png;base64,${buffer.toString('base64')}`
      } catch {
        return null
      }
    }

    // SVG — return raw SVG for browser rendering
    if (['.svg', '.svgz'].includes(ext)) {
      try {
        const content = await readFile(filePath, 'utf-8')
        return `data:image/svg+xml;base64,${Buffer.from(content).toString('base64')}`
      } catch {
        return null
      }
    }

    return null
  })

  // Full preview for the preview panel
  ipcMain.handle('preview:full', async (_e, filePath: string): Promise<PreviewResult> => {
    const ext = extname(filePath).toLowerCase()
    // Images
    if (['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.bmp'].includes(ext)) {
      try {
        const sharp = (await import('sharp')).default
        const image = sharp(filePath, { limitInputPixels: false })
        const meta = await image.metadata()

        // For large images, resize for display
        let buffer: Buffer
        const maxDim = 2048
        if ((meta.width && meta.width > maxDim) || (meta.height && meta.height > maxDim)) {
          buffer = await image.resize(maxDim, maxDim, { fit: 'inside' }).png().toBuffer()
        } else {
          buffer = await image.png().toBuffer()
        }

        return {
          type: 'image',
          data: `data:image/png;base64,${buffer.toString('base64')}`,
          width: meta.width,
          height: meta.height
        }
      } catch {
        return { type: 'none', data: '' }
      }
    }

    // RAW camera files — extract embedded JPEG preview
    if (isRawExtension(ext)) {
      try {
        const jpegBuffer = await extractRawPreview(filePath)
        if (jpegBuffer) {
          const sharp = (await import('sharp')).default
          const image = sharp(jpegBuffer)
          const meta = await image.metadata()

          let buffer: Buffer
          const maxDim = 2048
          if ((meta.width && meta.width > maxDim) || (meta.height && meta.height > maxDim)) {
            buffer = await image.resize(maxDim, maxDim, { fit: 'inside' }).png().toBuffer()
          } else {
            buffer = await image.png().toBuffer()
          }

          return {
            type: 'image',
            data: `data:image/png;base64,${buffer.toString('base64')}`,
            width: meta.width,
            height: meta.height
          }
        }
      } catch {
        return { type: 'none', data: '' }
      }
    }

    // PSD with layer info
    if (['.psd', '.psb'].includes(ext)) {
      try {
        const { readPsd } = await import('ag-psd')
        const fileBuffer = await readFile(filePath)
        const psd = readPsd(fileBuffer, { skipLayerImageData: true })

        const layers: LayerInfo[] = (psd.children || []).map(layer => ({
          name: layer.name || 'Unnamed',
          visible: !layer.hidden,
          opacity: (layer.opacity ?? 255) / 255,
          blendMode: layer.blendMode
        }))

        let data = ''
        if (psd.imageData) {
          const sharp = (await import('sharp')).default
          const buffer = await sharp(Buffer.from(psd.imageData.data.buffer), {
            raw: { width: psd.width, height: psd.height, channels: 4 }
          }).png().toBuffer()
          data = `data:image/png;base64,${buffer.toString('base64')}`
        }

        return {
          type: 'image',
          data,
          width: psd.width,
          height: psd.height,
          layers
        }
      } catch {
        return { type: 'none', data: '' }
      }
    }

    // PDF and AI — return file as base64 for PDF.js in renderer
    if (['.pdf', '.ai'].includes(ext)) {
      try {
        const fileBuffer = await readFile(filePath)
        return {
          type: 'pdf-page',
          data: `data:application/pdf;base64,${fileBuffer.toString('base64')}`,
          pageCount: 0 // Will be determined by PDF.js in renderer
        }
      } catch {
        return { type: 'none', data: '' }
      }
    }

    // SVG
    if (['.svg', '.svgz'].includes(ext)) {
      try {
        const content = await readFile(filePath, 'utf-8')
        return {
          type: 'svg',
          data: content
        }
      } catch {
        return { type: 'none', data: '' }
      }
    }

    // Font preview — generate sample text rendering
    if (['.otf', '.ttf', '.woff', '.woff2'].includes(ext)) {
      try {
        const opentype = await import('opentype.js')
        const buffer = await readFile(filePath)
        const font = opentype.parse(buffer.buffer)
        const sampleText = 'AaBbCcDdEeFfGg 0123456789'

        // Render to SVG path
        const path = font.getPath(sampleText, 0, 60, 48)
        const svgPath = path.toSVG(2)
        const bbox = path.getBoundingBox()
        const w = Math.ceil(bbox.x2 - bbox.x1) + 20
        const h = Math.ceil(bbox.y2 - bbox.y1) + 20

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bbox.x1 - 10} ${bbox.y1 - 10} ${w} ${h}" width="${w}" height="${h}">
          <rect width="100%" height="100%" fill="#1a1f2e"/>
          <path d="${svgPath}" fill="#e2e8f0"/>
        </svg>`

        return {
          type: 'font-sample',
          data: svg,
          width: w,
          height: h
        }
      } catch {
        return { type: 'none', data: '' }
      }
    }

    return { type: 'none', data: '' }
  })
}
