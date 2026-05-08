/**
 * Everything (voidtools) integration for instant file search.
 *
 * Uses the bundled Everything.exe (portable) + es.exe (CLI) to provide
 * real-time, comprehensive file search across all NTFS volumes.
 *
 * Flow:
 *   1. On app start: generate config, launch Everything.exe in background
 *   2. On search: spawn es.exe with query, parse CSV output
 *   3. On app quit: stop Everything.exe (only if we started it)
 *
 * Everything runs without admin by using folder-based indexing
 * (not NTFS MFT which requires admin or the Everything Service).
 */

import { execFile, spawn, ChildProcess } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs'
import { app } from 'electron'
import { store } from './settings'

const execFileP = promisify(execFile)
let searchSeq = 0  // unique ID for temp files

let proc: ChildProcess | null = null
let weStarted = false
let available = false

// ─── Paths ───

/** Directory containing bundled Everything binaries */
function getBinDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'Everything')
    : join(app.getAppPath(), 'vendor', 'Everything')
}

/** Directory for Everything runtime data (config, database) — NOT in Dropbox */
function getDataDir(): string {
  const dir = join(app.getPath('userData'), 'everything')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function binPath(name: string): string {
  return join(getBinDir(), name)
}

// ─── Config generation ───

/** Build an Everything.ini that indexes the user's working folders without admin. */
function generateConfig(): string {
  const home = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\info'
  const dataDir = getDataDir()

  // Collect folders to index: bookmarks + Dropbox + Desktop + Downloads
  const folders = new Set<string>()

  // Dropbox
  const dropboxCandidates = [
    join(home, 'Dropbox'),
    join(home, 'Documents', 'Dropbox'),
    'D:\\Dropbox'
  ]
  for (const p of dropboxCandidates) {
    if (existsSync(p)) { folders.add(p); break }
  }

  // Bookmarks
  const bookmarks = (store.get('paths.bookmarks') as string[]) || []
  for (const b of bookmarks) {
    if (existsSync(b)) folders.add(b)
  }

  // Desktop, Downloads
  const desktop = join(home, 'Desktop')
  const downloads = join(home, 'Downloads')
  if (existsSync(desktop)) folders.add(desktop)
  if (existsSync(downloads)) folders.add(downloads)

  const folderList = [...folders]
  const monitorFlags = folderList.map(() => '1').join(',')

  const iniPath = join(dataDir, 'Everything.ini')
  const dbPath = join(dataDir, 'Everything.db')

  const ini = [
    '[Everything]',
    // Disable NTFS volume indexing (requires admin)
    'auto_include_fixed_volumes=0',
    'auto_include_removable_volumes=0',
    'auto_include_fixed_refs_volumes=0',
    'auto_include_removable_refs_volumes=0',
    // Enable folder-based indexing (no admin needed)
    `folders=${folderList.join(',')}`,
    `folder_monitor_changes=${monitorFlags}`,
    // Database location (outside Dropbox)
    `db_location=${dataDir}`,
    // Minimize to tray, no first-run dialog
    'run_as_admin=0',
    'show_tray_icon=1',
    'minimize_to_tray=1',
    'start_minimized=1',
    'run_in_background=1',
    // Performance
    'index_file_size=1',
    'index_date_modified=1',
    'index_attributes=1',
    'index_date_created=1',
    // Disable update check (we manage our own version)
    'check_for_updates=0',
    ''
  ].join('\r\n')

  writeFileSync(iniPath, ini, 'utf-8')
  console.log('[EVERYTHING] Config written:', iniPath)
  console.log('[EVERYTHING] Indexing folders:', folderList.join(', '))

  return iniPath
}

// ─── Lifecycle ───

export function isAvailable(): boolean {
  return available
}

/** Launch Everything if not already running. */
export async function launch(): Promise<void> {
  const esExe = binPath('es.exe')
  if (!existsSync(esExe)) {
    console.log('[EVERYTHING] es.exe not found at', esExe)
    return
  }

  // Check if Everything is already running (user's own install or previous session)
  if (await checkRunning(esExe)) {
    console.log('[EVERYTHING] Already running (external instance)')
    available = true
    return
  }

  // Start our bundled Everything.exe with custom config
  const evExe = binPath('Everything.exe')
  if (!existsSync(evExe)) {
    console.log('[EVERYTHING] Everything.exe not found at', evExe)
    return
  }

  const iniPath = generateConfig()

  console.log('[EVERYTHING] Starting bundled instance...')
  try {
    proc = spawn(evExe, [
      '-startup',
      '-minimized',
      '-config', iniPath
    ], {
      detached: false,
      stdio: 'ignore',
      windowsHide: true
    })
    weStarted = true
    proc.unref()
    proc.on('error', (err) => {
      console.error('[EVERYTHING] Process error:', err.message)
    })
  } catch (err: any) {
    console.error('[EVERYTHING] Failed to start:', err.message)
    return
  }

  // Wait for Everything to be ready (up to 30 seconds)
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500))
    if (await checkRunning(esExe)) {
      console.log('[EVERYTHING] Ready')
      available = true
      return
    }
  }
  console.warn('[EVERYTHING] Started but not responding after 30s — will use SQLite fallback')
}

/** Stop Everything if we started it. */
export function stop(): void {
  if (weStarted) {
    console.log('[EVERYTHING] Stopping...')
    try {
      execFile(binPath('Everything.exe'), ['-quit'], { windowsHide: true }, () => {})
    } catch {}
    proc = null
    weStarted = false
    available = false
  }
}

// ─── Search ───

export interface EverythingResult {
  path: string
  name: string
  dir: string
  ext: string
  size: number
  modified: number
  is_dir: number
}

/**
 * Search for files/folders using Everything.
 * Uses -export-csv with -utf8-bom for correct Greek/Unicode output
 * (es.exe stdout uses OEM codepage which garbles non-ASCII characters).
 */
export async function search(query: string, limit = 50): Promise<EverythingResult[]> {
  if (!available) return []

  const q = query.trim()
  if (!q) return []

  const esExe = binPath('es.exe')
  const tmpFile = join(getDataDir(), `search_${++searchSeq & 0xFFFF}.csv`)

  const args = [
    '-n', String(limit),
    '-size',
    '-dm',
    '-attributes',
    '-sort', 'dm',
    '-sort-descending',
    '-utf8-bom',
    '-export-csv', tmpFile,
    q
  ]

  try {
    await execFileP(esExe, args, {
      timeout: 5000,
      windowsHide: true
    })
    const csv = readFileSync(tmpFile, 'utf-8')
    return parseCsv(csv)
  } catch (err: any) {
    // es.exe exit code 1 = no results
    if (err.status === 1 || err.code === 1) {
      // Try reading partial results from the file
      try {
        const csv = readFileSync(tmpFile, 'utf-8')
        if (csv.trim()) return parseCsv(csv)
      } catch {}
      return []
    }
    console.error('[EVERYTHING] Search error:', err.message)
    if (err.killed || err.signal === 'SIGTERM') {
      available = false
    }
    return []
  } finally {
    try { unlinkSync(tmpFile) } catch {}
  }
}

// ─── CSV parsing ───

function parseCsv(raw: string): EverythingResult[] {
  const results: EverythingResult[] = []
  // Strip UTF-8 BOM if present
  const clean = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw

  for (const line of clean.split(/\r?\n/)) {
    if (!line.trim()) continue

    const fields = csvFields(line)
    if (fields.length < 4) continue

    // CSV column order: Size, Date Modified, Attributes, Filename
    const sizeStr = fields[0]
    const dmStr = fields[1] || ''
    const attrs = (fields[2] || '').toUpperCase()
    const fullPath = fields[3]

    // Skip header row
    if (sizeStr === 'Size' || fullPath === 'Filename') continue

    const size = parseInt(sizeStr || '0', 10) || 0
    const isDir = attrs.includes('D')

    const sep = Math.max(fullPath.lastIndexOf('\\'), fullPath.lastIndexOf('/'))
    const name = sep >= 0 ? fullPath.substring(sep + 1) : fullPath
    const dir = sep >= 0 ? fullPath.substring(0, sep) : ''
    const dot = name.lastIndexOf('.')
    const ext = (!isDir && dot >= 0) ? name.substring(dot).toLowerCase() : ''

    results.push({
      path: fullPath,
      name,
      dir,
      ext,
      size,
      modified: dmStr ? Math.floor(new Date(dmStr).getTime()) : 0,
      is_dir: isDir ? 1 : 0
    })
  }

  // Folders first, then files — within each group keep date-modified order
  results.sort((a, b) => {
    if (a.is_dir !== b.is_dir) return b.is_dir - a.is_dir
    return (b.modified || 0) - (a.modified || 0)
  })

  return results
}

/** Parse a single CSV line, handling quoted fields. */
function csvFields(line: string): string[] {
  const fields: string[] = []
  let cur = ''
  let inQ = false

  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQ = false
        }
      } else {
        cur += c
      }
    } else {
      if (c === '"') {
        inQ = true
      } else if (c === ',') {
        fields.push(cur)
        cur = ''
      } else {
        cur += c
      }
    }
  }
  fields.push(cur)
  return fields
}

// ─── Helpers ───

async function checkRunning(esExe: string): Promise<boolean> {
  try {
    await execFileP(esExe, ['-get-result-count'], {
      timeout: 2000,
      windowsHide: true
    })
    return true
  } catch {
    return false
  }
}
