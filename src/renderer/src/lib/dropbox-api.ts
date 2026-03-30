// Dropbox helper utilities for the renderer

export async function connectDropbox(clientId: string): Promise<boolean> {
  return window.api.dropbox.connect(clientId)
}

export async function getDropboxStatus() {
  return window.api.dropbox.status()
}

export async function browseDropbox(path: string) {
  return window.api.dropbox.listFolder(path)
}

export async function searchDropbox(query: string, path?: string) {
  return window.api.dropbox.search(query, path)
}

export async function downloadFromDropbox(remotePath: string): Promise<Buffer> {
  return window.api.dropbox.download(remotePath)
}

export async function uploadToDropbox(localPath: string, remotePath: string) {
  return window.api.dropbox.upload(localPath, remotePath)
}

export async function getDropboxRevisions(path: string) {
  return window.api.dropbox.revisions(path)
}
