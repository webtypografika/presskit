// Cloud-sync root detection, path normalization, and resolution
// Enables portable paths (<DROPBOX>\...) that work across PCs

import { app, IpcMain } from 'electron'
import { readFile, access } from 'fs/promises'
import { join } from 'path'
import { store } from './settings'

export interface CloudRoot {
  placeholder: string  // e.g. '<DROPBOX>'
  label: string        // e.g. 'Dropbox'
  localPath: string    // e.g. 'C:\Users\info\Documents\Dropbox'
  autoDetected: boolean
}

const SETTINGS_KEY = 'cloudRoots'

let cachedRoots: CloudRoot[] | null = null

// ─── Auto-detection ───

async function detectDropbox(): Promise<string | null> {
  try {
    const infoPath = join(process.env.LOCALAPPDATA || '', 'Dropbox', 'info.json')
    const raw = await readFile(infoPath, 'utf-8')
    const info = JSON.parse(raw)
    return info.personal?.path || info.business?.path || null
  } catch {
    return null
  }
}

function detectOneDrive(): string | null {
  return process.env.OneDrive || process.env.OneDriveCommercial || null
}

function detectGoogleDrive(): string | null {
  const home = app.getPath('home')
  const candidates = [
    join(home, 'Google Drive'),
    join(home, 'My Drive'),
    'G:\\My Drive',
  ]
  // Sync check — only at startup
  const { existsSync } = require('fs')
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

/** Detect all available cloud-sync roots. Call once at startup. */
export async function detectCloudRoots(): Promise<CloudRoot[]> {
  const roots: CloudRoot[] = []

  const dropbox = await detectDropbox()
  if (dropbox) roots.push({ placeholder: '<DROPBOX>', label: 'Dropbox', localPath: dropbox, autoDetected: true })

  const onedrive = detectOneDrive()
  if (onedrive) roots.push({ placeholder: '<ONEDRIVE>', label: 'OneDrive', localPath: onedrive, autoDetected: true })

  const gdrive = detectGoogleDrive()
  if (gdrive) roots.push({ placeholder: '<GDRIVE>', label: 'Google Drive', localPath: gdrive, autoDetected: true })

  const home = app.getPath('home')
  if (home) roots.push({ placeholder: '<HOME>', label: 'Home', localPath: home, autoDetected: true })

  // Merge with user overrides from settings
  const saved = (store.get(SETTINGS_KEY) as CloudRoot[] | undefined) || []
  for (const s of saved) {
    const idx = roots.findIndex(r => r.placeholder === s.placeholder)
    if (idx >= 0) {
      // User override of auto-detected root
      if (!s.autoDetected) roots[idx].localPath = s.localPath
    } else {
      // User-added custom root (e.g. <SERVER:NAME>)
      roots.push(s)
    }
  }

  cachedRoots = roots
  return roots
}

/** Get cached roots (call detectCloudRoots first at startup). */
export function getCloudRoots(): CloudRoot[] {
  return cachedRoots || []
}

/** Save user-modified roots to settings. */
export function saveCloudRoots(roots: CloudRoot[]): void {
  store.set(SETTINGS_KEY, roots)
  cachedRoots = roots
}

// ─── Path normalization (absolute → portable) ───

/**
 * Convert an absolute local path to a portable path.
 * Uses longest-match to pick the right root.
 * Returns the original path if no root matches.
 */
export function toPortablePath(absolutePath: string): string {
  const roots = getCloudRoots()
  if (!roots.length) return absolutePath

  // Normalize for comparison
  const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  const normAbs = norm(absolutePath)

  let bestMatch: CloudRoot | null = null
  let bestLen = 0

  for (const root of roots) {
    const normRoot = norm(root.localPath)
    // Must be a prefix followed by a separator or end of string
    if (normAbs.startsWith(normRoot) && (normAbs.length === normRoot.length || normAbs[normRoot.length] === '\\')) {
      if (normRoot.length > bestLen) {
        bestMatch = root
        bestLen = normRoot.length
      }
    }
  }

  if (!bestMatch) return absolutePath

  const rest = absolutePath.slice(bestMatch.localPath.length)
  return bestMatch.placeholder + rest
}

// ─── Path resolution (portable → absolute) ───

/**
 * Convert a portable path to an absolute local path.
 * Returns the original path if it doesn't start with a placeholder.
 */
export function resolvePortablePath(portablePath: string): string {
  const roots = getCloudRoots()

  for (const root of roots) {
    if (portablePath.startsWith(root.placeholder)) {
      const rest = portablePath.slice(root.placeholder.length)
      return root.localPath + rest
    }
  }

  // Not a portable path — return as-is (back-compatible)
  return portablePath
}

/**
 * Check if a path is portable (starts with a known placeholder).
 */
export function isPortablePath(path: string): boolean {
  return /^<[A-Z]+(?::[A-Z0-9]+)?>/.test(path)
}

// ─── Auto-migration (runs silently at startup) ───

/** Silently migrate PressCal paths to portable format. Safe to run every startup. */
export async function autoMigratePaths(): Promise<void> {
  const presscalUrl = (store.get('presscal.url') as string)?.replace(/\/$/, '')
  const apiKey = store.get('presscal.apiKey') as string
  if (!presscalUrl || !apiKey) return // not configured — skip silently

  const roots = getCloudRoots().filter(r => r.placeholder !== '<HOME>')
  if (!roots.length) return // no cloud roots — skip silently

  try {
    await fetch(`${presscalUrl}/api/filehelper/migrate-paths`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ roots: roots.map(r => ({ placeholder: r.placeholder, localPath: r.localPath })) }),
    })
  } catch {
    // Network error, server down, etc. — ignore silently
  }
}

// ─── IPC handlers ───

export function registerCloudRootsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('cloudRoots:get', async () => {
    return getCloudRoots()
  })

  ipcMain.handle('cloudRoots:resolve', async (_e, portablePath: string) => {
    return resolvePortablePath(portablePath)
  })

  ipcMain.handle('cloudRoots:detect', async () => {
    return detectCloudRoots()
  })

  ipcMain.handle('cloudRoots:save', async (_e, roots: CloudRoot[]) => {
    saveCloudRoots(roots)
    return true
  })

  ipcMain.handle('cloudRoots:migrate', async () => {
    // Call PressCal API to migrate all paths in the DB
    const presscalUrl = (store.get('presscal.url') as string)?.replace(/\/$/, '')
    const apiKey = store.get('presscal.apiKey') as string
    if (!presscalUrl || !apiKey) throw new Error('PressCal not configured')

    const roots = getCloudRoots().filter(r => r.placeholder !== '<HOME>')
    if (!roots.length) throw new Error('No cloud roots detected')

    const res = await fetch(`${presscalUrl}/api/filehelper/migrate-paths`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ roots: roots.map(r => ({ placeholder: r.placeholder, localPath: r.localPath })) }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Migration failed: ${res.status} ${text}`)
    }

    return res.json()
  })
}
