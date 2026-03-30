import { IpcMain, app } from 'electron'
import Database from 'better-sqlite3'
import { readdir, stat } from 'fs/promises'
import { join, extname, basename } from 'path'
import { existsSync } from 'fs'
import Store from 'electron-store'

const store = new Store()

let db: Database.Database | null = null
let watcher: any = null
let indexing = false
let indexed = false

function getDb(): Database.Database {
  if (db) return db

  const dbPath = join(app.getPath('userData'), 'search-index.db')
  db = new Database(dbPath)

  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL')

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_lower TEXT NOT NULL,
      dir TEXT NOT NULL,
      ext TEXT NOT NULL,
      size INTEGER DEFAULT 0,
      modified INTEGER DEFAULT 0,
      is_dir INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_name_lower ON files(name_lower);
    CREATE INDEX IF NOT EXISTS idx_dir ON files(dir);
    CREATE INDEX IF NOT EXISTS idx_ext ON files(ext);
  `)

  // FTS5 virtual table for fuzzy search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
      name, path,
      content='files',
      content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    );
  `)

  return db
}

// Normalize name for better matching: split on _ - . spaces, camelCase
function tokenize(name: string): string {
  return name
    .replace(/\.[^.]+$/, '') // remove extension
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase split
    .replace(/[_\-.\s]+/g, ' ') // separators to spaces
    .toLowerCase()
    .trim()
}

async function scanDirectory(dirPath: string, depth = 0, maxDepth = 6): Promise<void> {
  if (depth > maxDepth) return

  try {
    const names = await readdir(dirPath)
    const d = getDb()

    const insertStmt = d.prepare(`
      INSERT OR REPLACE INTO files (path, name, name_lower, dir, ext, size, modified, is_dir)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const batch: (() => void)[] = []

    for (const name of names) {
      if (name.startsWith('.') || name === 'node_modules' || name === '.git' ||
          name === 'Thumbs.db' || name === 'desktop.ini' || name === '$RECYCLE.BIN') continue

      const fullPath = join(dirPath, name)
      try {
        const s = await stat(fullPath)
        const isDir = s.isDirectory()
        const ext = isDir ? '' : extname(name).toLowerCase()

        batch.push(() => {
          insertStmt.run(
            fullPath, name, tokenize(name), dirPath, ext,
            s.size, Math.floor(s.mtimeMs), isDir ? 1 : 0
          )
        })

        if (isDir) {
          await scanDirectory(fullPath, depth + 1, maxDepth)
        }
      } catch {
        // Skip inaccessible files
      }
    }

    // Batch insert in transaction
    const transaction = d.transaction(() => {
      for (const fn of batch) fn()
    })
    transaction()
  } catch {
    // Skip inaccessible directories
  }
}

function rebuildFts(): void {
  const d = getDb()
  d.exec(`
    DELETE FROM files_fts;
    INSERT INTO files_fts(rowid, name, path) SELECT rowid, name, path FROM files;
  `)
}

async function buildIndex(): Promise<{ count: number; ms: number }> {
  if (indexing) return { count: 0, ms: 0 }
  indexing = true

  const start = Date.now()
  const d = getDb()

  // Get watched paths: bookmarks + Dropbox + customer folders
  const bookmarks = (store.get('paths.bookmarks') as string[]) || []
  const home = process.env.USERPROFILE || process.env.HOME || ''

  const paths = new Set<string>()

  // Always index Dropbox
  const dropboxCandidates = [
    join(home, 'Dropbox'),
    join(home, 'Documents', 'Dropbox'),
    'D:\\Dropbox'
  ]
  for (const p of dropboxCandidates) {
    if (existsSync(p)) { paths.add(p); break }
  }

  // Bookmarks
  for (const b of bookmarks) {
    if (existsSync(b)) paths.add(b)
  }

  // Desktop, Downloads
  const desktop = join(home, 'Desktop')
  const downloads = join(home, 'Downloads')
  if (existsSync(desktop)) paths.add(desktop)
  if (existsSync(downloads)) paths.add(downloads)

  // Scan all paths
  for (const p of paths) {
    await scanDirectory(p)
  }

  // Rebuild FTS index
  rebuildFts()

  const count = (d.prepare('SELECT COUNT(*) as c FROM files').get() as any).c
  const ms = Date.now() - start

  indexing = false
  indexed = true

  // Start file watcher
  startWatcher([...paths])

  return { count, ms }
}

async function startWatcher(paths: string[]): Promise<void> {
  if (watcher) watcher.close()

  const { watch } = await import('chokidar')
  watcher = watch(paths, {
    ignored: /(^|[\/\\])(\.|node_modules|\.git|Thumbs\.db|desktop\.ini|\$RECYCLE\.BIN)/,
    persistent: true,
    ignoreInitial: true,
    depth: 6,
    awaitWriteFinish: { stabilityThreshold: 500 }
  })

  const d = getDb()
  const insertStmt = d.prepare(`
    INSERT OR REPLACE INTO files (path, name, name_lower, dir, ext, size, modified, is_dir)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const deleteStmt = d.prepare('DELETE FROM files WHERE path = ?')

  const updateFts = (path: string, name: string, remove = false) => {
    try {
      if (remove) {
        d.exec(`DELETE FROM files_fts WHERE path = '${path.replace(/'/g, "''")}'`)
      } else {
        // Remove then re-insert
        d.exec(`DELETE FROM files_fts WHERE path = '${path.replace(/'/g, "''")}'`)
        d.exec(`INSERT INTO files_fts(name, path) VALUES ('${name.replace(/'/g, "''")}', '${path.replace(/'/g, "''")}')`)
      }
    } catch {}
  }

  watcher.on('add', (filePath: string) => {
    try {
      const s = require('fs').statSync(filePath)
      const name = basename(filePath)
      const dir = join(filePath, '..')
      const ext = extname(name).toLowerCase()
      insertStmt.run(filePath, name, tokenize(name), dir, ext, s.size, Math.floor(s.mtimeMs), 0)
      updateFts(filePath, name)
    } catch {}
  })

  watcher.on('addDir', (dirPath: string) => {
    try {
      const name = basename(dirPath)
      const dir = join(dirPath, '..')
      insertStmt.run(dirPath, name, tokenize(name), dir, '', 0, Date.now(), 1)
      updateFts(dirPath, name)
    } catch {}
  })

  watcher.on('unlink', (filePath: string) => {
    try {
      deleteStmt.run(filePath)
      updateFts(filePath, '', true)
    } catch {}
  })

  watcher.on('unlinkDir', (dirPath: string) => {
    try {
      // Delete dir and all children
      d.prepare("DELETE FROM files WHERE path LIKE ? || '%'").run(dirPath)
      deleteStmt.run(dirPath)
      updateFts(dirPath, '', true)
    } catch {}
  })
}

function search(query: string, limit = 30): any[] {
  const d = getDb()
  const q = query.trim().toLowerCase()
  if (!q) return []

  // Strategy 1: FTS5 match (fast, tokenized)
  try {
    const ftsQuery = q.split(/\s+/).map(t => `"${t}"*`).join(' AND ')
    const ftsResults = d.prepare(`
      SELECT f.path, f.name, f.dir, f.ext, f.size, f.modified, f.is_dir
      FROM files_fts ft
      JOIN files f ON f.rowid = ft.rowid
      WHERE files_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit) as any[]

    if (ftsResults.length > 0) return ftsResults
  } catch {}

  // Strategy 2: LIKE fallback (slower but catches everything)
  const words = q.split(/\s+/).filter(Boolean)
  const conditions = words.map(() => 'name_lower LIKE ?').join(' AND ')
  const params = words.map(w => `%${w}%`)

  return d.prepare(`
    SELECT path, name, dir, ext, size, modified, is_dir
    FROM files
    WHERE ${conditions}
    ORDER BY is_dir DESC, name ASC
    LIMIT ?
  `).all(...params, limit) as any[]
}

export function registerSearchHandlers(ipcMain: IpcMain): void {
  // Build/rebuild index
  ipcMain.handle('search:buildIndex', async () => {
    return buildIndex()
  })

  // Search
  ipcMain.handle('search:query', async (_e, query: string, limit?: number) => {
    if (!indexed) {
      // First time — build index, then search
      await buildIndex()
    }
    return search(query, limit || 30)
  })

  // Get index stats
  ipcMain.handle('search:stats', async () => {
    try {
      const d = getDb()
      const count = (d.prepare('SELECT COUNT(*) as c FROM files').get() as any).c
      return { indexed: true, count }
    } catch {
      return { indexed: false, count: 0 }
    }
  })

  // Add path to index (e.g. when customer folder is set)
  ipcMain.handle('search:addPath', async (_e, dirPath: string) => {
    if (!existsSync(dirPath)) return { ok: false }
    await scanDirectory(dirPath)
    rebuildFts()
    if (watcher) watcher.add(dirPath)
    return { ok: true }
  })
}
