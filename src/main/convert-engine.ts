import { IpcMain, dialog, BrowserWindow } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { extname, basename, dirname, join } from 'path'

export interface ConvertOptions {
  // Target format
  format: 'tiff' | 'png' | 'jpg' | 'pdf'
  // Color space conversion
  colorSpace?: 'cmyk' | 'srgb' | 'keep'
  // Resolution
  dpi?: number
  // Quality (for jpg)
  quality?: number
  // Flatten transparency
  flatten?: boolean
  // Resize
  maxWidth?: number
  maxHeight?: number
}

export interface ConvertResult {
  success: boolean
  inputPath: string
  outputPath: string
  inputSize: number
  outputSize: number
  error?: string
}

export function registerConvertHandlers(ipcMain: IpcMain): void {
  // Convert a single file
  ipcMain.handle('convert:file', async (_e, inputPath: string, options: ConvertOptions): Promise<ConvertResult> => {
    try {
      const ext = extname(inputPath).toLowerCase()
      const name = basename(inputPath, ext)
      const dir = dirname(inputPath)
      const outputExt = '.' + options.format
      const outputPath = join(dir, `${name}_converted${outputExt}`)

      const inputStats = await (await import('fs/promises')).stat(inputPath)

      // PSD → Image conversion
      if (['.psd', '.psb'].includes(ext)) {
        const result = await convertPsd(inputPath, outputPath, options)
        return { ...result, inputSize: inputStats.size }
      }

      // Image → Image conversion (using sharp)
      if (['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.bmp'].includes(ext)) {
        const result = await convertImage(inputPath, outputPath, options)
        return { ...result, inputSize: inputStats.size }
      }

      return {
        success: false,
        inputPath,
        outputPath: '',
        inputSize: inputStats.size,
        outputSize: 0,
        error: `Unsupported input format: ${ext}`
      }
    } catch (err: any) {
      return {
        success: false,
        inputPath,
        outputPath: '',
        inputSize: 0,
        outputSize: 0,
        error: err.message || 'Conversion failed'
      }
    }
  })

  // Batch convert
  ipcMain.handle('convert:batch', async (event, filePaths: string[], options: ConvertOptions) => {
    const results: ConvertResult[] = []

    for (let i = 0; i < filePaths.length; i++) {
      event.sender.send('batch:progress', {
        current: i + 1,
        total: filePaths.length,
        file: filePaths[i],
        phase: 'convert'
      })

      try {
        const ext = extname(filePaths[i]).toLowerCase()
        const name = basename(filePaths[i], ext)
        const dir = dirname(filePaths[i])
        const outputPath = join(dir, `${name}_converted.${options.format}`)
        const inputStats = await (await import('fs/promises')).stat(filePaths[i])

        let result: ConvertResult

        if (['.psd', '.psb'].includes(ext)) {
          result = await convertPsd(filePaths[i], outputPath, options)
        } else {
          result = await convertImage(filePaths[i], outputPath, options)
        }

        results.push({ ...result, inputSize: inputStats.size })
      } catch (err: any) {
        results.push({
          success: false,
          inputPath: filePaths[i],
          outputPath: '',
          inputSize: 0,
          outputSize: 0,
          error: err.message
        })
      }
    }

    return results
  })

  // Save dialog for output
  ipcMain.handle('convert:saveDialog', async (_e, defaultName: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [
        { name: 'TIFF', extensions: ['tif', 'tiff'] },
        { name: 'PNG', extensions: ['png'] },
        { name: 'JPEG', extensions: ['jpg', 'jpeg'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    return result.canceled ? null : result.filePath
  })
}

async function convertImage(inputPath: string, outputPath: string, options: ConvertOptions): Promise<ConvertResult> {
  const sharp = (await import('sharp')).default
  let pipeline = sharp(inputPath)

  // Flatten transparency (add white background)
  if (options.flatten) {
    pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } })
  }

  // Resize
  if (options.maxWidth || options.maxHeight) {
    pipeline = pipeline.resize(options.maxWidth || undefined, options.maxHeight || undefined, {
      fit: 'inside',
      withoutEnlargement: true
    })
  }

  // Color space conversion
  if (options.colorSpace === 'cmyk') {
    pipeline = pipeline.toColorspace('cmyk')
  } else if (options.colorSpace === 'srgb') {
    pipeline = pipeline.toColorspace('srgb')
  }

  // Output format
  switch (options.format) {
    case 'tiff':
      pipeline = pipeline.tiff({
        compression: 'lzw',
        xres: options.dpi || 300,
        yres: options.dpi || 300
      })
      break
    case 'png':
      pipeline = pipeline.png({ compressionLevel: 6 })
      break
    case 'jpg':
      pipeline = pipeline.jpeg({ quality: options.quality || 95 })
      break
  }

  // DPI metadata
  if (options.dpi) {
    pipeline = pipeline.withMetadata({ density: options.dpi })
  }

  const outputBuffer = await pipeline.toBuffer()
  await writeFile(outputPath, outputBuffer)

  return {
    success: true,
    inputPath,
    outputPath,
    inputSize: 0,
    outputSize: outputBuffer.length
  }
}

async function convertPsd(inputPath: string, outputPath: string, options: ConvertOptions): Promise<ConvertResult> {
  const { readPsd } = await import('ag-psd')
  const sharp = (await import('sharp')).default

  const buffer = await readFile(inputPath)
  const psd = readPsd(buffer, { skipLayerImageData: true })

  if (!psd.imageData) {
    return {
      success: false,
      inputPath,
      outputPath,
      inputSize: 0,
      outputSize: 0,
      error: 'PSD has no composite image data'
    }
  }

  // Convert PSD composite to desired format via sharp
  let pipeline = sharp(Buffer.from(psd.imageData.data.buffer), {
    raw: { width: psd.width, height: psd.height, channels: 4 }
  })

  if (options.flatten) {
    pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } })
  }

  if (options.maxWidth || options.maxHeight) {
    pipeline = pipeline.resize(options.maxWidth, options.maxHeight, {
      fit: 'inside',
      withoutEnlargement: true
    })
  }

  if (options.colorSpace === 'cmyk') {
    pipeline = pipeline.toColorspace('cmyk')
  }

  switch (options.format) {
    case 'tiff':
      pipeline = pipeline.tiff({ compression: 'lzw', xres: options.dpi || 300, yres: options.dpi || 300 })
      break
    case 'png':
      pipeline = pipeline.png({ compressionLevel: 6 })
      break
    case 'jpg':
      pipeline = pipeline.jpeg({ quality: options.quality || 95 })
      break
  }

  if (options.dpi) {
    pipeline = pipeline.withMetadata({ density: options.dpi })
  }

  const outputBuffer = await pipeline.toBuffer()
  await writeFile(outputPath, outputBuffer)

  return {
    success: true,
    inputPath,
    outputPath,
    inputSize: 0,
    outputSize: outputBuffer.length
  }
}
