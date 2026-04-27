import { IpcMain, app } from 'electron'
import Database from 'better-sqlite3'
import { readdir, stat } from 'fs/promises'
import { join, extname } from 'path'
import { existsSync } from 'fs'
import Store from 'electron-store'

const store = new Store()

let db: Database.Database | null = null
let indexing = false
let indexed = false

function getDbPath(): string {
  return join(app.getPath('userData'), 'search-index.db')
}

function destroyDb(): void {
  if (db) {
    try { db.close() } catch {}
    db = null
  }
  const dbPath = getDbPath()
  for (const suffix of ['', '-wal', '-shm']) {
    try { require('fs').unlinkSync(dbPath + suffix) } catch {}
  }
  console.log('[SEARCH] Destroyed database, will recreate')
}

function createDb(): Database.Database {
  const dbPath = getDbPath()
  const d = new Database(dbPath)

  d.pragma('journal_mode = WAL')
  d.pragma('synchronous = NORMAL')

  d.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_lower TEXT NOT NULL,
      dir TEXT NOT NULL,
      ext TEXT NOT NULL,
      size INTEGER DEFAULT 0,
      modified INTEGER DEFAULT 0,
      is_dir INTEGER DEFAULT 0,
      path_lower TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_name_lower ON files(name_lower);
    CREATE INDEX IF NOT EXISTS idx_name ON files(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_dir ON files(dir);
    CREATE INDEX IF NOT EXISTS idx_ext ON files(ext);
  `)

  d.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
      name,
      content='files',
      content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    );
  `)

  return d
}

function getDb(): Database.Database {
  if (db) return db

  try {
    db = createDb()
    db.pragma('integrity_check')
    return db
  } catch (err: any) {
    console.error('[SEARCH] Database corrupt:', err.message)
    destroyDb()
    db = createDb()
    return db
  }
}

// Normalize name: proper Unicode lowercase (SQLite LOWER() only handles ASCII)
function nameLower(name: string): string {
  return name.toLowerCase()
}

// Yield control to event loop periodically to avoid freezing
function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

async function scanDirectory(dirPath: string, depth = 0, maxDepth = 12): Promise<void> {
  if (depth > maxDepth) return

  try {
    const names = await readdir(dirPath)
    const d = getDb()

    const insertStmt = d.prepare(`
      INSERT OR REPLACE INTO files (path, name, name_lower, dir, ext, size, modified, is_dir, path_lower)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const batch: (() => void)[] = []
    const subdirs: string[] = []

    for (const name of names) {
      if (name.startsWith('.') || name === 'node_modules' || name === '.git' ||
          name === 'Thumbs.db' || name === 'desktop.ini' || name === '$RECYCLE.BIN' ||
          name === 'System Volume Information') continue

      const fullPath = join(dirPath, name)
      try {
        const s = await stat(fullPath)
        const isDir = s.isDirectory()
        const ext = isDir ? '' : extname(name).toLowerCase()

        batch.push(() => {
          insertStmt.run(
            fullPath, name, nameLower(name), dirPath, ext,
            s.size, Math.floor(s.mtimeMs), isDir ? 1 : 0,
            fullPath.toLowerCase()
          )
        })

        if (isDir) {
          subdirs.push(fullPath)
        }
      } catch {
        // Skip inaccessible files
      }
    }

    // Batch insert in transaction
    if (batch.length > 0) {
      const transaction = d.transaction(() => {
        for (const fn of batch) fn()
      })
      transaction()
    }

    // Yield to event loop every directory to prevent freezing
    await sleep(1)

    // Recurse into subdirectories
    for (const sub of subdirs) {
      await scanDirectory(sub, depth + 1, maxDepth)
    }
  } catch {
    // Skip inaccessible directories
  }
}

function rebuildFts(): void {
  try {
    const d = getDb()
    d.exec(`
      DELETE FROM files_fts;
      INSERT INTO files_fts(rowid, name) SELECT rowid, name FROM files;
    `)
  } catch (err: any) {
    console.error('[SEARCH] rebuildFts failed:', err.message)
    try {
      destroyDb()
      getDb()
    } catch {}
  }
}

const INDEX_VERSION = 4 // bump to force re-index (v4: FTS name-only, better ranking)

async function buildIndex(): Promise<{ count: number; ms: number }> {
  if (indexing) return { count: 0, ms: 0 }
  indexing = true

  const start = Date.now()

  try {
    // Force re-index when version changes (destroy DB to handle schema changes)
    const savedVersion = store.get('search.indexVersion', 0) as number
    if (savedVersion < INDEX_VERSION) {
      console.log(`[SEARCH] Index version ${savedVersion} → ${INDEX_VERSION}, destroying old database`)
      destroyDb()
      store.set('search.indexVersion', INDEX_VERSION)
    }

    const d = getDb()

    const bookmarks = (store.get('paths.bookmarks') as string[]) || []
    const home = process.env.USERPROFILE || process.env.HOME || ''

    const paths = new Set<string>()

    // Dropbox
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

    // Scan all paths deep enough to cover nested project folders
    for (const p of paths) {
      await scanDirectory(p, 0, 12)
    }

    // Rebuild FTS index
    rebuildFts()

    const count = (d.prepare('SELECT COUNT(*) as c FROM files').get() as any).c
    const ms = Date.now() - start

    indexed = true

    // No chokidar watcher — too heavy on Dropbox folders.
    // New files are picked up on next index rebuild or via search:addPath.

    console.log(`[SEARCH] Index built: ${count} files in ${ms}ms`)
    return { count, ms }
  } catch (err: any) {
    console.error('[SEARCH] buildIndex failed:', err.message)
    destroyDb()
    indexed = false
    return { count: 0, ms: Date.now() - start }
  } finally {
    indexing = false
  }
}


function search(query: string, limit = 50): any[] {
  const d = getDb()
  const q = query.trim().toLowerCase()
  if (!q) return []

  const words = q.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []

  const results: any[] = []
  const seen = new Set<string>()

  function add(rows: any[]) {
    for (const r of rows) {
      if (!seen.has(r.path)) { results.push(r); seen.add(r.path) }
    }
  }

  // --- Primary: LIKE on name_lower (reliable, handles Greek/Unicode) ---
  try {
    const conditions = words.map(() => 'name_lower LIKE ?').join(' AND ')
    const params = words.map(w => `%${w}%`)
    add(d.prepare(`
      SELECT path, name, dir, ext, size, modified, is_dir
      FROM files
      WHERE ${conditions}
      ORDER BY
        CASE
          WHEN name_lower = ? THEN 0
          WHEN name_lower LIKE ? THEN 1
          ELSE 2
        END,
        is_dir DESC,
        modified DESC
      LIMIT ?
    `).all(...params, q, `${q}%`, limit) as any[])
  } catch (err) {
    console.error('[SEARCH] LIKE query failed:', (err as Error).message)
  }

  // --- Fallback: FTS5 prefix match (catches word-boundary matches LIKE may miss) ---
  if (results.length < limit) {
    try {
      const ftsQuery = words.map(t => `"${t}"*`).join(' AND ')
      add(d.prepare(`
        SELECT f.path, f.name, f.dir, f.ext, f.size, f.modified, f.is_dir
        FROM files_fts ft
        JOIN files f ON f.rowid = ft.rowid
        WHERE files_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(ftsQuery, limit - results.length) as any[])
    } catch {}
  }

  // --- Sort by relevance ---
  results.sort((a, b) => {
    const aName = a.name.toLowerCase()
    const bName = b.name.toLowerCase()

    const score = (name: string): number => {
      if (name === q) return 10                    // exact
      if (name.startsWith(q)) return 8             // prefix
      // Check if all words appear at word boundaries
      const allWordsInName = words.every(w => name.includes(w))
      if (!allWordsInName) return 0
      const atBoundary = words.every(w => {
        const idx = name.indexOf(w)
        return idx === 0 || /[\s_\-.\\/()[\]{}]/.test(name[idx - 1])
      })
      if (atBoundary) return 6                     // word-boundary
      return 4                                      // substring
    }

    const diff = score(bName) - score(aName)
    if (diff !== 0) return diff

    // Same relevance: folders first, then newest
    if (a.is_dir !== b.is_dir) return b.is_dir - a.is_dir
    return (b.modified || 0) - (a.modified || 0)
  })

  return results.slice(0, limit)
}

export function registerSearchHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('search:buildIndex', async () => {
    return buildIndex()
  })

  ipcMain.handle('search:query', async (_e, query: string, limit?: number) => {
    // Don't block on index build — search whatever is available
    if (!indexed && !indexing) {
      buildIndex().catch(() => {})
    }
    const results = search(query, limit || 50)
    console.log(`[SEARCH] query="${query}" → ${results.length} results (indexed=${indexed}, indexing=${indexing})`)
    return results
  })

  ipcMain.handle('search:stats', async () => {
    try {
      const d = getDb()
      const count = (d.prepare('SELECT COUNT(*) as c FROM files').get() as any).c
      return { indexed: true, count }
    } catch {
      return { indexed: false, count: 0 }
    }
  })

  ipcMain.handle('search:addPath', async (_e, dirPath: string) => {
    if (!existsSync(dirPath)) return { ok: false }
    // Only scan 2 levels deep for visited directories (quick incremental)
    await scanDirectory(dirPath, 0, 2)
    rebuildFts()
    return { ok: true }
  })
}
