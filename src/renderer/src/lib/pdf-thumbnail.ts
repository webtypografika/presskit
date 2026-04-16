import * as pdfjsLib from 'pdfjs-dist'

// Reuse worker config from PdfPreview
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

// Cache to avoid re-rendering the same file.
// Key includes mtime so edits to the PDF invalidate the cached thumbnail.
const cache = new Map<string, string>()

export async function renderPdfThumbnail(filePath: string, size: number, mtime?: string | number): Promise<string | null> {
  const cacheKey = `${filePath}:${size}:${mtime ?? ''}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)!

  // Evict any stale entries for the same path (different mtime/size) so the
  // cache doesn't retain old renderings forever after a file edit.
  const prefix = `${filePath}:`
  for (const key of cache.keys()) {
    if (key.startsWith(prefix) && key !== cacheKey) cache.delete(key)
  }

  try {
    // Read file via IPC and convert to base64 data URL
    const buffer = await window.api.fs.readFile(filePath)
    const data = new Uint8Array(buffer)

    const pdf = await pdfjsLib.getDocument({ data }).promise
    const page = await pdf.getPage(1)
    const vp = page.getViewport({ scale: 1 })

    // Scale to fit target size at 2x for sharpness
    const renderScale = 2
    const scale = Math.min(size / vp.width, size / vp.height) * renderScale
    const viewport = page.getViewport({ scale })

    // Create offscreen canvas
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')!

    // White background
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Render PDF page
    await page.render({ canvasContext: ctx, viewport }).promise

    const dataUrl = canvas.toDataURL('image/png')

    // Cache the result
    cache.set(cacheKey, dataUrl)
    // Limit cache size
    if (cache.size > 200) {
      const firstKey = cache.keys().next().value
      if (firstKey) cache.delete(firstKey)
    }

    return dataUrl
  } catch {
    return null
  }
}
