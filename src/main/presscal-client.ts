import { IpcMain, app } from 'electron'
import Store from 'electron-store'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'

const store = new Store()

const STORE_KEYS = {
  presscalUrl: 'presscal.url',
  presscalApiKey: 'presscal.apiKey'
}

interface PresscalConfig {
  url: string
  apiKey: string
}

function getConfig(): PresscalConfig | null {
  const url = store.get(STORE_KEYS.presscalUrl) as string
  const apiKey = store.get(STORE_KEYS.presscalApiKey) as string
  if (!url || !apiKey) return null
  return { url: url.replace(/\/$/, ''), apiKey }
}

async function presscalFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const config = getConfig()
  if (!config) throw new Error('PressCal not configured')

  const response = await fetch(`${config.url}/api/filehelper${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      ...(options?.headers || {})
    }
  })

  if (!response.ok) {
    throw new Error(`PressCal API error: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

export function registerPresscalHandlers(ipcMain: IpcMain): void {
  // Connection management
  ipcMain.handle('presscal:configure', async (_e, url: string, apiKey: string) => {
    store.set(STORE_KEYS.presscalUrl, url)
    store.set(STORE_KEYS.presscalApiKey, apiKey)
    return true
  })

  ipcMain.handle('presscal:status', async () => {
    const config = getConfig()
    if (!config) return { connected: false }

    try {
      const result = await presscalFetch<{ ok: boolean; orgName: string }>('')
      return { connected: true, url: config.url, orgName: result.orgName }
    } catch {
      return { connected: false, url: config.url }
    }
  })

  // Quotes
  ipcMain.handle('presscal:getQuotes', async (_e, filters?: { status?: string; search?: string }) => {
    const params = new URLSearchParams()
    if (filters?.status) params.set('status', filters.status)
    if (filters?.search) params.set('search', filters.search)
    const query = params.toString()

    return presscalFetch<any[]>(`/quotes${query ? `?${query}` : ''}`)
  })

  ipcMain.handle('presscal:getQuote', async (_e, quoteId: string) => {
    return presscalFetch<any>(`/quotes/${quoteId}`)
  })

  // Customers
  ipcMain.handle('presscal:getCustomers', async (_e, search?: string) => {
    const params = search ? `?search=${encodeURIComponent(search)}` : ''
    return presscalFetch<any[]>(`/customers${params}`)
  })

  ipcMain.handle('presscal:getCustomer', async (_e, customerId: string) => {
    return presscalFetch<any>(`/customers/${customerId}`)
  })

  // Jobs
  ipcMain.handle('presscal:getJobs', async (_e, filters?: { stage?: string }) => {
    const params = new URLSearchParams()
    if (filters?.stage) params.set('stage', filters.stage)
    const query = params.toString()

    return presscalFetch<any[]>(`/jobs${query ? `?${query}` : ''}`)
  })

  // File links
  ipcMain.handle('presscal:linkFile', async (_e, data: {
    fileName: string
    filePath: string
    fileType: string
    fileSize: number
    source: 'local' | 'dropbox'
    quoteId?: string
    customerId?: string
    notes?: string
    preflightStatus?: string
    thumbnail?: string
  }) => {
    return presscalFetch<any>('/files/link', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  })

  ipcMain.handle('presscal:unlinkFile', async (_e, fileLinkId: string) => {
    return presscalFetch<any>(`/files/${fileLinkId}`, { method: 'DELETE' })
  })

  ipcMain.handle('presscal:getFileLinks', async (_e, filters?: {
    quoteId?: string
    customerId?: string
  }) => {
    const params = new URLSearchParams()
    if (filters?.quoteId) params.set('quoteId', filters.quoteId)
    if (filters?.customerId) params.set('customerId', filters.customerId)
    const query = params.toString()

    return presscalFetch<any[]>(`/files${query ? `?${query}` : ''}`)
  })

  // Email
  ipcMain.handle('presscal:sendEmail', async (_e, data: {
    to: string
    subject: string
    body: string
    attachments?: Array<{
      filename: string
      content: string // base64
      contentType: string
    }>
    quoteId?: string
    customerId?: string
  }) => {
    return presscalFetch<any>('/email', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  })

  // Get email threads for a quote
  ipcMain.handle('presscal:getEmailThreads', async (_e, quoteId: string) => {
    return presscalFetch<any[]>(`/quotes/${quoteId}/emails`)
  })

  // Save file to customer folder
  ipcMain.handle('presscal:saveToCustomerFolder', async (_e, sourcePath: string, targetFolder: string, filename: string) => {
    const { copyFile } = await import('fs/promises')
    await mkdir(targetFolder, { recursive: true })
    const dest = join(targetFolder, filename)
    await copyFile(sourcePath, dest)
    return { ok: true, path: dest }
  })

  // Link file to a quote item (with metadata extraction)
  ipcMain.handle('presscal:linkFileToItem', async (_e, quoteId: string, itemId: string, filePath: string) => {
    const { stat: fsStat } = await import('fs/promises')
    const { basename, extname } = await import('path')

    const stats = await fsStat(filePath)
    const ext = extname(filePath).toLowerCase()
    const name = basename(filePath)

    const fileData: Record<string, any> = {
      path: filePath,
      name,
      type: ext.replace('.', ''),
      size: stats.size,
    }

    // Extract metadata for images/PDFs
    if (['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.psd', '.ai', '.eps'].includes(ext)) {
      try {
        const sharp = (await import('sharp')).default
        const meta = await sharp(filePath).metadata()
        if (meta.width && meta.height && meta.density) {
          fileData.width = Math.round((meta.width / meta.density) * 25.4)
          fileData.height = Math.round((meta.height / meta.density) * 25.4)
          fileData.dpi = meta.density
        } else if (meta.width && meta.height) {
          fileData.dpi = 300 // assume
          fileData.width = Math.round((meta.width / 300) * 25.4)
          fileData.height = Math.round((meta.height / 300) * 25.4)
        }
        if (meta.space) {
          fileData.colors = meta.space.toUpperCase() === 'CMYK' ? 'CMYK' : meta.space.toUpperCase()
        }
      } catch {}
    }

    if (ext === '.pdf') {
      try {
        const { readFile: rf } = await import('fs/promises')
        const pdfData = await rf(filePath)
        const text = pdfData.toString('latin1')

        // Page count: count /Type /Page (not /Pages) occurrences
        const pageMatches = text.match(/\/Type\s*\/Page[^s]/g)
        if (pageMatches) fileData.pages = pageMatches.length

        // Dimensions: prefer TrimBox > CropBox > MediaBox
        // TrimBox = final trimmed size (what we want for print)
        // CropBox = visible area
        // MediaBox = full page including bleed
        const boxRegex = (name: string) => {
          const re = new RegExp(`\\/${name}\\s*\\[\\s*([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s*\\]`, 'g')
          const matches = [...text.matchAll(re)]
          return matches.length > 0 ? matches[0] : null
        }

        const trimBox = boxRegex('TrimBox')
        const cropBox = boxRegex('CropBox')
        const mediaBox = boxRegex('MediaBox')
        const box = trimBox || cropBox || mediaBox

        if (box) {
          const w = parseFloat(box[3]) - parseFloat(box[1])
          const h = parseFloat(box[4]) - parseFloat(box[2])
          // PDF points to mm (1 point = 0.3528mm)
          fileData.width = Math.round(w * 0.3528)
          fileData.height = Math.round(h * 0.3528)

          // If we have both TrimBox and MediaBox, calculate bleed
          if (trimBox && mediaBox) {
            const mw = parseFloat(mediaBox[3]) - parseFloat(mediaBox[1])
            const tw = parseFloat(trimBox[3]) - parseFloat(trimBox[1])
            const bleed = Math.round(((mw - tw) / 2) * 0.3528)
            if (bleed > 0 && bleed <= 10) fileData.bleed = bleed
          }
        }

        // 2 pages in a business card = front/back = 2 sides
        if (fileData.pages === 2) {
          fileData.colors = '4/4' // assume full color both sides
        }
      } catch {}
    }

    // Send to PressCal API
    return presscalFetch<any>(`/quotes/${quoteId}/items/${itemId}/link-file`, {
      method: 'POST',
      body: JSON.stringify(fileData)
    })
  })

  // Send email with local file attachments (reads files + base64 in main process)
  ipcMain.handle('presscal:sendEmailWithFiles', async (_e, data: {
    to: string; subject: string; body: string;
    filePaths: { path: string; name: string; ext: string }[];
    quoteId?: string;
  }) => {
    const { readFile: rf } = await import('fs/promises')

    const mimeTypes: Record<string, string> = {
      '.pdf': 'application/pdf', '.ai': 'application/postscript', '.psd': 'image/vnd.adobe.photoshop',
      '.eps': 'application/postscript', '.tif': 'image/tiff', '.tiff': 'image/tiff',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
      '.indd': 'application/x-indesign',
    }

    const attachments = await Promise.all(
      data.filePaths.map(async (f) => {
        const buffer = await rf(f.path)
        return {
          filename: f.name,
          content: buffer.toString('base64'),
          contentType: mimeTypes[f.ext] || 'application/octet-stream'
        }
      })
    )

    return presscalFetch<any>('/email', {
      method: 'POST',
      body: JSON.stringify({
        to: data.to,
        subject: data.subject,
        body: data.body,
        attachments,
        quoteId: data.quoteId
      })
    })
  })

  // Get full email messages with attachments for a quote
  ipcMain.handle('presscal:getQuoteEmailMessages', async (_e, quoteId: string) => {
    return presscalFetch<{ messages: any[] }>(`/quotes/${quoteId}/emails/messages`)
  })

  // Download email attachment to temp file, return local path
  ipcMain.handle('presscal:downloadAttachment', async (_e, messageId: string, attId: string, mime: string, filename: string) => {
    const config = getConfig()
    if (!config) throw new Error('PressCal not configured')

    const url = `${config.url}/api/filehelper/emails/${messageId}/attachments/${attId}?mime=${encodeURIComponent(mime)}&filename=${encodeURIComponent(filename)}`
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${config.apiKey}` }
    })

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())

    // Save to temp directory
    const tempDir = join(app.getPath('temp'), 'presscal-filehelper')
    await mkdir(tempDir, { recursive: true })
    const tempPath = join(tempDir, `${Date.now()}_${filename}`)
    await writeFile(tempPath, buffer)

    return tempPath
  })
}
