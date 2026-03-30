import { IpcMain } from 'electron'
import Store from 'electron-store'

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
    return presscalFetch<any>('/email/send', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  })

  // Get email threads for a quote
  ipcMain.handle('presscal:getEmailThreads', async (_e, quoteId: string) => {
    return presscalFetch<any[]>(`/quotes/${quoteId}/emails`)
  })
}
