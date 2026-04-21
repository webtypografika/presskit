import { readFile } from 'fs/promises'

const RAW_EXTENSIONS = ['.cr2', '.cr3', '.nef', '.arw', '.dng', '.raf', '.orf', '.rw2']

export function isRawExtension(ext: string): boolean {
  return RAW_EXTENSIONS.includes(ext.toLowerCase())
}

/**
 * Extract the embedded JPEG preview from a RAW camera file.
 * Most RAW formats (CR2, NEF, ARW, DNG, etc.) embed a full-size or
 * near-full-size JPEG preview. We find the largest JPEG blob in the file.
 */
export async function extractRawPreview(filePath: string): Promise<Buffer | null> {
  const fileBuffer = await readFile(filePath)
  const jpegBlobs: Buffer[] = []

  // Scan for JPEG markers: SOI (FFD8) and EOI (FFD9)
  let i = 0
  while (i < fileBuffer.length - 1) {
    if (fileBuffer[i] === 0xff && fileBuffer[i + 1] === 0xd8) {
      // Found JPEG start, now find the end
      let j = i + 2
      while (j < fileBuffer.length - 1) {
        if (fileBuffer[j] === 0xff && fileBuffer[j + 1] === 0xd9) {
          const blob = fileBuffer.subarray(i, j + 2)
          // Only consider blobs > 10KB (skip tiny thumbnails, keep the large preview)
          if (blob.length > 10240) {
            jpegBlobs.push(Buffer.from(blob))
          }
          i = j + 2
          break
        }
        j++
      }
      if (j >= fileBuffer.length - 1) break
    } else {
      i++
    }
  }

  if (jpegBlobs.length === 0) return null

  // Return the largest JPEG blob (usually the full-res preview)
  jpegBlobs.sort((a, b) => b.length - a.length)
  return jpegBlobs[0]
}
