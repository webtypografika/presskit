import { IpcMain, app } from 'electron'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { store } from './settings'
import { toPortablePath } from './cloud-roots'

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
    // Surface the server's error body — PressCal typically returns JSON
    // like { error: "..." } which is far more useful than just the status.
    let detail = ''
    try {
      const text = await response.text()
      if (text) {
        try {
          const json = JSON.parse(text)
          detail = json.error || json.message || text
        } catch {
          detail = text.length > 500 ? text.slice(0, 500) + '…' : text
        }
      }
    } catch {}
    console.error(`[PressCal] ${options?.method || 'GET'} ${endpoint} → ${response.status}`, detail)
    throw new Error(`PressCal API error: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`)
  }

  return response.json()
}

// Generic POST to PressCal API (used for gang-pick etc.)
export async function postToPressCal(endpoint: string, data: Record<string, unknown>): Promise<any> {
  return presscalFetch(endpoint, { method: 'POST', body: JSON.stringify(data) })
}

// Extract file metadata (images + PDFs) and POST to PressCal's link-file endpoint.
// Shared by the IPC handler and the pick-file-dialog deep link handler.
export async function linkFileToQuoteItem(quoteId: string, itemId: string, filePath: string): Promise<any> {
  const { stat: fsStat } = await import('fs/promises')
  const { basename, extname } = await import('path')

  const stats = await fsStat(filePath)
  const ext = extname(filePath).toLowerCase()
  const name = basename(filePath)

  const fileData: Record<string, any> = {
    path: toPortablePath(filePath),
    name,
    type: ext.replace('.', ''),
    size: stats.size,
  }

  // Extract metadata for images
  if (['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.psd', '.ai', '.eps'].includes(ext)) {
    try {
      const sharp = (await import('sharp')).default
      const meta = await sharp(filePath).metadata()
      if (meta.width && meta.height && meta.density) {
        fileData.width = Math.round((meta.width / meta.density) * 25.4)
        fileData.height = Math.round((meta.height / meta.density) * 25.4)
        fileData.dpi = meta.density
      } else if (meta.width && meta.height) {
        fileData.dpi = 300
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

      const pageMatches = text.match(/\/Type\s*\/Page[^s]/g)
      if (pageMatches) fileData.pages = pageMatches.length

      const boxRegex = (n: string) => {
        const re = new RegExp(`\\/${n}\\s*\\[\\s*([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s*\\]`, 'g')
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
        fileData.width = Math.round(w * 0.3528)
        fileData.height = Math.round(h * 0.3528)

        if (trimBox && mediaBox) {
          const mw = parseFloat(mediaBox[3]) - parseFloat(mediaBox[1])
          const tw = parseFloat(trimBox[3]) - parseFloat(trimBox[1])
          const bleed = Math.round(((mw - tw) / 2) * 0.3528)
          if (bleed > 0 && bleed <= 10) fileData.bleed = bleed
        }
      }

      if (fileData.pages === 2) {
        fileData.colors = '4/4'
      }
    } catch {}
  }

  console.log(`[LinkFile] POST /quotes/${quoteId}/items/${itemId}/link-file`, JSON.stringify(fileData, null, 2))
  try {
    const result = await presscalFetch<any>(`/quotes/${quoteId}/items/${itemId}/link-file`, {
      method: 'POST',
      body: JSON.stringify(fileData)
    })
    console.log(`[LinkFile] Success:`, result)
    return result
  } catch (err: any) {
    console.error(`[LinkFile] FAILED: quoteId=${quoteId} itemId=${itemId}`, err.message)
    throw err
  }
}

/**
 * POST a JSON body to a /api/filehelper endpoint, using the configured URL and
 * PressKit key. Exported so error reporting can reuse the one authenticated
 * channel instead of rebuilding auth of its own.
 */
export function postToPresscal(endpoint: string, body: unknown): Promise<unknown> {
  return presscalFetch(endpoint, { method: 'POST', body: JSON.stringify(body) })
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
    if (!config) return { connected: false, error: 'PressCal not configured' }

    try {
      const result = await presscalFetch<{ ok: boolean; orgName: string }>('')
      return { connected: true, url: config.url, orgName: result.orgName }
    } catch (err: any) {
      // Pass the reason up — "Failed" with no cause is undebuggable from the
      // Settings dialog (wrong key vs wrong URL vs expired license all look
      // identical without it).
      return { connected: false, url: config.url, error: String(err?.message || err) }
    }
  })

  // Quotes — paginate to fetch all results (server caps at ~20 per page)
  ipcMain.handle('presscal:getQuotes', async (_e, filters?: { status?: string; search?: string; limit?: number }) => {
    const params = new URLSearchParams()
    if (filters?.status) params.set('status', filters.status)
    if (filters?.search) params.set('search', filters.search)

    const PAGE_SIZE = 50
    params.set('limit', String(PAGE_SIZE))

    const allResults: any[] = []
    let page = 1
    while (true) {
      params.set('page', String(page))
      const batch = await presscalFetch<any[]>(`/quotes?${params.toString()}`)
      if (!Array.isArray(batch) || batch.length === 0) break
      allResults.push(...batch)
      if (batch.length < PAGE_SIZE) break  // last page
      page++
      if (page > 20) break  // safety cap
    }
    return allResults
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
      body: JSON.stringify({ ...data, filePath: toPortablePath(data.filePath) })
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
    return linkFileToQuoteItem(quoteId, itemId, filePath)
  })

  // Send email with local file attachments
  // Small payloads (<4 MB) go via PressCal Vercel API.
  // Large payloads use direct SMTP via nodemailer + OAuth2 token from PressCal.
  ipcMain.handle('presscal:sendEmailWithFiles', async (_e, data: {
    to: string; subject: string; body: string;
    filePaths: { path: string; name: string; ext: string }[];
    quoteId?: string;
  }) => {
    const { readFile: rf, stat: fsStat } = await import('fs/promises')

    const mimeTypes: Record<string, string> = {
      '.pdf': 'application/pdf', '.ai': 'application/postscript', '.psd': 'image/vnd.adobe.photoshop',
      '.eps': 'application/postscript', '.tif': 'image/tiff', '.tiff': 'image/tiff',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
      '.indd': 'application/x-indesign',
    }

    // Check total file size to decide route
    const sizes = await Promise.all(data.filePaths.map(f => fsStat(f.path).then(s => s.size)))
    const totalBytes = sizes.reduce((a, b) => a + b, 0)
    const VERCEL_LIMIT = 3 * 1024 * 1024 // 3 MB (base64 adds ~33%, Vercel body limit is 4.5 MB)

    console.log('[PressCal] sendEmailWithFiles →',
      `to=${data.to},`,
      `attachments=${data.filePaths.length},`,
      `total size=${(totalBytes / 1024 / 1024).toFixed(2)} MB,`,
      `route=${totalBytes > VERCEL_LIMIT ? 'DIRECT SMTP' : 'Vercel API'},`,
      `quoteId=${data.quoteId || '(none)'}`
    )

    if (totalBytes > VERCEL_LIMIT) {
      // --- Direct send via Gmail API (no Vercel body limit) ---
      const { readFile: readF } = await import('fs/promises')

      // Fetch Gmail OAuth credentials from PressCal
      const creds = await presscalFetch<{
        accessToken: string; email: string;
      }>('/gmail-credentials')

      // Build attachments as base64
      const parts = await Promise.all(data.filePaths.map(async (f) => {
        const buf = await readF(f.path)
        const ct = mimeTypes[f.ext] || 'application/octet-stream'
        return { filename: f.name, content: buf.toString('base64'), contentType: ct }
      }))

      // Build RFC 2822 MIME message
      const boundary = `----presskit_${Date.now()}_${Math.random().toString(36).slice(2)}`
      const mimeLines: string[] = [
        `From: ${creds.email}`,
        `To: ${data.to}`,
        `Subject: =?UTF-8?B?${Buffer.from(data.subject).toString('base64')}?=`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from(data.body || ' ').toString('base64'),
      ]
      for (const part of parts) {
        mimeLines.push(
          `--${boundary}`,
          `Content-Type: ${part.contentType}; name="${part.filename}"`,
          'Content-Transfer-Encoding: base64',
          `Content-Disposition: attachment; filename="${part.filename}"`,
          '',
          part.content,
        )
      }
      mimeLines.push(`--${boundary}--`)

      const rawMessage = mimeLines.join('\r\n')
      // Gmail API uses URL-safe base64
      const raw = Buffer.from(rawMessage)
        .toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

      // Send via Gmail API — no Vercel in the path, 25MB limit
      const gmailRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${creds.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
      })

      if (!gmailRes.ok) {
        const errBody = await gmailRes.text()
        throw new Error(`Gmail send failed (${gmailRes.status}): ${errBody}`)
      }

      // Log the send in PressCal (without attachments) so it shows in history
      await presscalFetch<any>('/email-log', {
        method: 'POST',
        body: JSON.stringify({
          to: data.to,
          subject: data.subject,
          body: data.body,
          attachmentNames: data.filePaths.map(f => f.name),
          quoteId: data.quoteId,
          sentDirect: true,
        })
      }).catch(err => console.warn('[PressCal] email-log failed (non-critical):', err.message))

      return { success: true, direct: true }
    }

    // --- Small files: send via Vercel API as before ---
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

  // Send file metadata for costing (file stays local, served via localhost:17824)
  ipcMain.handle('presscal:uploadFileForCosting', async (_e, data: {
    filePath: string
    fileName: string
    target: 'customer' | 'quote'
    targetId: string
    quoteId?: string
    itemId?: string
  }) => {
    const config = getConfig()
    if (!config) throw new Error('PressCal not configured')

    const { stat } = await import('fs/promises')
    const { basename } = await import('path')

    const fileSize = (await stat(data.filePath)).size

    const response = await fetch(`${config.url}/api/filehelper/files/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fileName: data.fileName || basename(data.filePath),
        filePath: data.filePath,
        fileSize,
        target: data.target,
        targetId: data.targetId,
        quoteId: data.quoteId || undefined,
        itemId: data.itemId || undefined
      })
    })

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status} ${response.statusText}`)
    }

    return response.json()
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
    const tempDir = join(app.getPath('temp'), 'presskit')
    await mkdir(tempDir, { recursive: true })
    const tempPath = join(tempDir, `${Date.now()}_${filename}`)
    await writeFile(tempPath, buffer)

    return tempPath
  })

  // Generic POST to PressCal API
  ipcMain.handle('presscal:postToApi', async (_e, endpoint: string, data: any) => {
    return presscalFetch(endpoint, { method: 'POST', body: JSON.stringify(data) })
  })
}
