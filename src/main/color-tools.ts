import { IpcMain } from 'electron'
import { readFile } from 'fs/promises'
import { extname } from 'path'

export interface ColorPalette {
  dominant: RgbColor[]
  histogram: ChannelHistogram
}

export interface RgbColor {
  r: number
  g: number
  b: number
  hex: string
  percentage: number
}

export interface ChannelHistogram {
  // For CMYK images
  cyan?: number
  magenta?: number
  yellow?: number
  black?: number
  // For RGB images
  red?: number
  green?: number
  blue?: number
  // Total ink coverage
  totalInkCoverage?: number
}

export function registerColorHandlers(ipcMain: IpcMain): void {
  // Extract dominant colors from an image
  ipcMain.handle('color:extractPalette', async (_e, filePath: string, count: number = 6): Promise<ColorPalette> => {
    const sharp = (await import('sharp')).default
    const image = sharp(filePath)
    const meta = await image.metadata()

    // Get a small sampled version for color analysis
    const { data, info } = await image
      .resize(100, 100, { fit: 'cover' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    // Simple k-means-like color clustering
    const pixels: [number, number, number][] = []
    for (let i = 0; i < data.length; i += 3) {
      pixels.push([data[i], data[i + 1], data[i + 2]])
    }

    const dominant = extractDominantColors(pixels, count)

    // Channel histogram / ink coverage
    const histogram = await calculateInkCoverage(filePath, meta.space || 'srgb')

    return { dominant, histogram }
  })

  // Calculate ink coverage for a specific region or full image
  ipcMain.handle('color:inkCoverage', async (_e, filePath: string): Promise<ChannelHistogram> => {
    const sharp = (await import('sharp')).default
    const meta = await sharp(filePath).metadata()
    return calculateInkCoverage(filePath, meta.space || 'srgb')
  })
}

function extractDominantColors(pixels: [number, number, number][], count: number): RgbColor[] {
  // Initialize centroids with evenly spaced samples
  const step = Math.floor(pixels.length / count)
  let centroids = Array.from({ length: count }, (_, i) => [...pixels[Math.min(i * step, pixels.length - 1)]] as [number, number, number])

  // K-means iterations
  for (let iter = 0; iter < 10; iter++) {
    const clusters: [number, number, number][][] = Array.from({ length: count }, () => [])

    // Assign pixels to nearest centroid
    for (const pixel of pixels) {
      let minDist = Infinity
      let closest = 0
      for (let c = 0; c < centroids.length; c++) {
        const dist = colorDistance(pixel, centroids[c])
        if (dist < minDist) {
          minDist = dist
          closest = c
        }
      }
      clusters[closest].push(pixel)
    }

    // Update centroids
    for (let c = 0; c < count; c++) {
      if (clusters[c].length === 0) continue
      centroids[c] = [
        Math.round(clusters[c].reduce((s, p) => s + p[0], 0) / clusters[c].length),
        Math.round(clusters[c].reduce((s, p) => s + p[1], 0) / clusters[c].length),
        Math.round(clusters[c].reduce((s, p) => s + p[2], 0) / clusters[c].length)
      ]
    }
  }

  // Assign pixels one final time to get percentages
  const clusterCounts = new Array(count).fill(0)
  for (const pixel of pixels) {
    let minDist = Infinity
    let closest = 0
    for (let c = 0; c < centroids.length; c++) {
      const dist = colorDistance(pixel, centroids[c])
      if (dist < minDist) {
        minDist = dist
        closest = c
      }
    }
    clusterCounts[closest]++
  }

  return centroids
    .map((c, i) => ({
      r: c[0],
      g: c[1],
      b: c[2],
      hex: `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`,
      percentage: Math.round((clusterCounts[i] / pixels.length) * 100)
    }))
    .filter(c => c.percentage > 0)
    .sort((a, b) => b.percentage - a.percentage)
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
}

async function calculateInkCoverage(filePath: string, colorSpace: string): Promise<ChannelHistogram> {
  const sharp = (await import('sharp')).default

  if (colorSpace === 'cmyk') {
    // For CMYK images, calculate coverage per channel
    const { data, info } = await sharp(filePath)
      .resize(200, 200, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true })

    const totalPixels = info.width * info.height
    let cSum = 0, mSum = 0, ySum = 0, kSum = 0

    for (let i = 0; i < data.length; i += info.channels) {
      cSum += data[i] / 255
      mSum += data[i + 1] / 255
      ySum += data[i + 2] / 255
      if (info.channels >= 4) kSum += data[i + 3] / 255
    }

    const cyan = Math.round((cSum / totalPixels) * 100)
    const magenta = Math.round((mSum / totalPixels) * 100)
    const yellow = Math.round((ySum / totalPixels) * 100)
    const black = Math.round((kSum / totalPixels) * 100)

    return {
      cyan,
      magenta,
      yellow,
      black,
      totalInkCoverage: cyan + magenta + yellow + black
    }
  } else {
    // For RGB images, approximate CMYK coverage
    const { data, info } = await sharp(filePath)
      .resize(200, 200, { fit: 'inside' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const totalPixels = info.width * info.height
    let cSum = 0, mSum = 0, ySum = 0, kSum = 0

    for (let i = 0; i < data.length; i += 3) {
      const r = data[i] / 255
      const g = data[i + 1] / 255
      const b = data[i + 2] / 255

      // RGB to CMYK approximation
      const k = 1 - Math.max(r, g, b)
      if (k >= 1) {
        cSum += 0; mSum += 0; ySum += 0; kSum += 1
      } else {
        cSum += (1 - r - k) / (1 - k)
        mSum += (1 - g - k) / (1 - k)
        ySum += (1 - b - k) / (1 - k)
        kSum += k
      }
    }

    const cyan = Math.round((cSum / totalPixels) * 100)
    const magenta = Math.round((mSum / totalPixels) * 100)
    const yellow = Math.round((ySum / totalPixels) * 100)
    const black = Math.round((kSum / totalPixels) * 100)

    return {
      cyan,
      magenta,
      yellow,
      black,
      totalInkCoverage: cyan + magenta + yellow + black,
      red: Math.round(data.filter((_, i) => i % 3 === 0).reduce((s, v) => s + v, 0) / totalPixels / 255 * 100),
      green: Math.round(data.filter((_, i) => i % 3 === 1).reduce((s, v) => s + v, 0) / totalPixels / 255 * 100),
      blue: Math.round(data.filter((_, i) => i % 3 === 2).reduce((s, v) => s + v, 0) / totalPixels / 255 * 100)
    }
  }
}
