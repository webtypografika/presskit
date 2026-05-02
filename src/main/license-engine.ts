import { IpcMain, BrowserWindow } from 'electron'
import { store } from './settings'

// Polled every 6h while the app is open. Initial check fires on app ready.
const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000

// If the network is down, we keep honoring the last cached status for this
// many days so a momentary outage doesn't lock out paying users. After that
// the gate locks until we can reach the server again.
const OFFLINE_GRACE_DAYS = 3

const STORE_KEYS = {
  presscalUrl: 'presscal.url',
  presscalApiKey: 'presscal.apiKey',
  cache: 'license.cache',
  lastOk: 'license.lastSuccessfulCheck'
}

export type LicenseState =
  | 'not_configured'
  | 'unauthorized'
  | 'active'
  | 'expired'
  | 'offline_no_cache'

export interface LicenseStatus {
  state: LicenseState
  active: boolean
  plan: 'trial' | 'pro' | 'expired' | null
  expiresAt: string | null
  daysLeft: number
  isTrial: boolean
  orgName: string | null
  offline: boolean
  fetchedAt: number | null
  error?: string
}

interface ServerResponse {
  active: boolean
  plan: 'trial' | 'pro' | 'expired'
  expiresAt: string | null
  daysLeft: number
  isTrial: boolean
  orgName: string
}

let pollTimer: NodeJS.Timeout | null = null
let lastStatus: LicenseStatus | null = null

function getConfig(): { url: string; apiKey: string } | null {
  const url = store.get(STORE_KEYS.presscalUrl) as string
  const apiKey = store.get(STORE_KEYS.presscalApiKey) as string
  if (!url || !apiKey) return null
  return { url: url.replace(/\/$/, ''), apiKey }
}

function emptyStatus(state: LicenseState, error?: string): LicenseStatus {
  return {
    state,
    active: false,
    plan: null,
    expiresAt: null,
    daysLeft: 0,
    isTrial: false,
    orgName: null,
    offline: false,
    fetchedAt: null,
    error
  }
}

function broadcastStatus(status: LicenseStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('license:changed', status)
  }
}

export async function checkLicense(): Promise<LicenseStatus> {
  const config = getConfig()
  if (!config) {
    lastStatus = emptyStatus('not_configured')
    return lastStatus
  }

  try {
    const res = await fetch(`${config.url}/api/filehelper/license`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      }
    })

    if (res.status === 401 || res.status === 403) {
      lastStatus = emptyStatus('unauthorized')
      return lastStatus
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }

    const data = (await res.json()) as ServerResponse
    const status: LicenseStatus = {
      state: data.active ? 'active' : 'expired',
      active: data.active,
      plan: data.plan,
      expiresAt: data.expiresAt,
      daysLeft: data.daysLeft,
      isTrial: data.isTrial,
      orgName: data.orgName,
      offline: false,
      fetchedAt: Date.now()
    }
    store.set(STORE_KEYS.cache, status)
    store.set(STORE_KEYS.lastOk, Date.now())
    lastStatus = status
    return status
  } catch (e) {
    // Network failure — honor cache within grace window so a brief outage
    // doesn't lock out paying users.
    const cache = store.get(STORE_KEYS.cache) as LicenseStatus | undefined
    const lastOk = (store.get(STORE_KEYS.lastOk) as number) || 0
    const daysSince = (Date.now() - lastOk) / (24 * 3600 * 1000)

    if (cache && daysSince < OFFLINE_GRACE_DAYS) {
      lastStatus = { ...cache, offline: true }
      return lastStatus
    }
    lastStatus = emptyStatus('offline_no_cache', (e as Error).message)
    return lastStatus
  }
}

export function getLastStatus(): LicenseStatus | null {
  return lastStatus
}

async function pollAndBroadcast(): Promise<void> {
  const status = await checkLicense()
  broadcastStatus(status)
}

export function startLicensePoller(): void {
  if (pollTimer) return
  void pollAndBroadcast()
  pollTimer = setInterval(() => void pollAndBroadcast(), POLL_INTERVAL_MS)
}

export function stopLicensePoller(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

export function registerLicenseHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('license:get', async () => {
    return lastStatus ?? (await checkLicense())
  })

  ipcMain.handle('license:refresh', async () => {
    const status = await checkLicense()
    broadcastStatus(status)
    return status
  })
}
