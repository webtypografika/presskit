import { IpcMain, BrowserWindow, shell } from 'electron'
import { Dropbox, DropboxAuth } from 'dropbox'
import Store from 'electron-store'

const store = new Store()

let dbxAuth: DropboxAuth | null = null
let dbx: Dropbox | null = null

const STORE_KEYS = {
  accessToken: 'dropbox.accessToken',
  refreshToken: 'dropbox.refreshToken',
  clientId: 'dropbox.clientId'
}

function getClient(): Dropbox | null {
  if (dbx) return dbx

  const accessToken = store.get(STORE_KEYS.accessToken) as string
  const refreshToken = store.get(STORE_KEYS.refreshToken) as string
  const clientId = store.get(STORE_KEYS.clientId) as string

  if (accessToken && clientId) {
    dbxAuth = new DropboxAuth({ clientId, accessToken, refreshToken })
    dbx = new Dropbox({ auth: dbxAuth })
    return dbx
  }

  return null
}

export function registerDropboxHandlers(ipcMain: IpcMain): void {
  // Check connection status
  ipcMain.handle('dropbox:status', async () => {
    const client = getClient()
    if (!client) return { connected: false }

    try {
      const account = await client.usersGetCurrentAccount()
      return {
        connected: true,
        name: account.result.name.display_name,
        email: account.result.email
      }
    } catch {
      return { connected: false }
    }
  })

  // Start OAuth flow
  ipcMain.handle('dropbox:connect', async (_e, clientId: string) => {
    store.set(STORE_KEYS.clientId, clientId)

    dbxAuth = new DropboxAuth({ clientId })
    const authUrl = await dbxAuth.getAuthenticationUrl(
      'http://localhost:17823/callback',
      undefined,
      'code',
      'offline',
      undefined,
      'none',
      true
    )

    // Open auth URL in external browser
    shell.openExternal(authUrl as string)

    // Start local server to capture callback
    return new Promise<boolean>((resolve) => {
      const http = require('http')
      const url = require('url')

      const server = http.createServer(async (req: any, res: any) => {
        const query = url.parse(req.url, true).query

        if (query.code) {
          try {
            const tokenResult = await dbxAuth!.getAccessTokenFromCode(
              'http://localhost:17823/callback',
              query.code as string
            )

            const result = tokenResult.result as any
            store.set(STORE_KEYS.accessToken, result.access_token)
            if (result.refresh_token) {
              store.set(STORE_KEYS.refreshToken, result.refresh_token)
            }

            dbx = new Dropbox({ auth: dbxAuth! })

            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end('<html><body style="background:#0a0e1a;color:#e2e8f0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><h1>Connected! You can close this window.</h1></body></html>')
            server.close()
            resolve(true)
          } catch {
            res.writeHead(500, { 'Content-Type': 'text/html' })
            res.end('<html><body><h1>Authentication failed</h1></body></html>')
            server.close()
            resolve(false)
          }
        }
      })

      server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          // Kill the old server and retry
          const net = require('net')
          const killer = new net.Socket()
          killer.on('error', () => {})
          killer.connect(17823, '127.0.0.1', () => { killer.destroy() })
          setTimeout(() => {
            server.listen(17823)
          }, 500)
        } else {
          resolve(false)
        }
      })

      server.listen(17823)

      // Timeout after 5 minutes
      setTimeout(() => {
        try { server.close() } catch {}
        resolve(false)
      }, 300000)
    })
  })

  // Disconnect
  ipcMain.handle('dropbox:disconnect', async () => {
    store.delete(STORE_KEYS.accessToken)
    store.delete(STORE_KEYS.refreshToken)
    dbx = null
    dbxAuth = null
    return true
  })

  // List folder
  ipcMain.handle('dropbox:listFolder', async (_e, path: string) => {
    const client = getClient()
    if (!client) throw new Error('Dropbox not connected')

    const result = await client.filesListFolder({
      path: path || '',
      include_media_info: true
    })

    return result.result.entries.map(entry => ({
      name: entry.name,
      path: entry.path_display || entry.path_lower || '',
      isDirectory: entry['.tag'] === 'folder',
      size: entry['.tag'] === 'file' ? (entry as any).size : 0,
      modified: entry['.tag'] === 'file' ? (entry as any).server_modified : null,
      type: entry['.tag']
    }))
  })

  // Download file
  ipcMain.handle('dropbox:download', async (_e, path: string) => {
    const client = getClient()
    if (!client) throw new Error('Dropbox not connected')

    const result = await client.filesDownload({ path })
    const blob = (result.result as any).fileBinary
    return Buffer.from(blob)
  })

  // Get thumbnail
  ipcMain.handle('dropbox:thumbnail', async (_e, path: string) => {
    const client = getClient()
    if (!client) throw new Error('Dropbox not connected')

    try {
      const result = await client.filesGetThumbnailV2({
        resource: { '.tag': 'path', path },
        size: { '.tag': 'w256h256' },
        format: { '.tag': 'png' }
      })
      const blob = (result.result as any).fileBinary
      return `data:image/png;base64,${Buffer.from(blob).toString('base64')}`
    } catch {
      return null
    }
  })

  // Upload file
  ipcMain.handle('dropbox:upload', async (_e, localPath: string, remotePath: string) => {
    const client = getClient()
    if (!client) throw new Error('Dropbox not connected')

    const { readFile } = await import('fs/promises')
    const content = await readFile(localPath)

    const result = await client.filesUpload({
      path: remotePath,
      contents: content,
      mode: { '.tag': 'overwrite' }
    })

    return result.result
  })

  // Get file revisions (version history)
  ipcMain.handle('dropbox:revisions', async (_e, path: string) => {
    const client = getClient()
    if (!client) throw new Error('Dropbox not connected')

    const result = await client.filesListRevisions({ path, limit: 20 })

    return result.result.entries.map(rev => ({
      id: rev.id,
      modified: rev.server_modified,
      size: rev.size
    }))
  })

  // Search files
  ipcMain.handle('dropbox:search', async (_e, query: string, path?: string) => {
    const client = getClient()
    if (!client) throw new Error('Dropbox not connected')

    const result = await client.filesSearchV2({
      query,
      options: path ? {
        path: path,
        file_extensions: ['pdf', 'ai', 'psd', 'eps', 'tif', 'tiff', 'png', 'jpg', 'jpeg', 'svg', 'indd']
      } : {
        file_extensions: ['pdf', 'ai', 'psd', 'eps', 'tif', 'tiff', 'png', 'jpg', 'jpeg', 'svg', 'indd']
      }
    })

    return result.result.matches.map(match => {
      const meta = (match.metadata as any).metadata
      return {
        name: meta.name,
        path: meta.path_display || meta.path_lower,
        isDirectory: meta['.tag'] === 'folder',
        size: meta.size || 0,
        modified: meta.server_modified || null
      }
    })
  })
}
