/**
 * Deleting files, in one place.
 *
 * Both callers — the Delete key and the right-click menu — used to inline this,
 * which is how they drifted into showing the same misleading message twice.
 *
 * The flow: try the Recycle Bin, and if something holds the file, ASK before
 * destroying it. Until 2026-08-25 a locked file was permanently deleted without
 * a word, because the main process fell through to `rm force` on its own. Locks
 * are usually transient (Dropbox mid-sync, a file open in an editor), so the
 * honest answer is to offer the choice rather than to decide for the user.
 */

export type DeleteTarget = { path: string; name: string }

type DeleteResult = { path: string; ok: boolean; locked?: boolean; error?: string }

type Dialogs = {
  showConfirm: (message: string, title?: string) => Promise<boolean>
  showAlert: (message: string, title?: string) => void
}

function nameList(files: DeleteTarget[]): string {
  return files.length === 1 ? `"${files[0].name}"` : `${files.length} items`
}

/**
 * Confirms, deletes, and reports. Returns once everything has settled so the
 * caller can refresh; it never throws.
 */
export async function deleteFiles(files: DeleteTarget[], dialogs: Dialogs): Promise<void> {
  if (files.length === 0) return

  const ok = await dialogs.showConfirm(`Delete ${nameList(files)}?`)
  if (!ok) return

  const paths = files.map(f => f.path)
  const results: DeleteResult[] = await window.api.fs.trash(paths)

  const locked = results.filter(r => !r.ok && r.locked)
  const failed = results.filter(r => !r.ok && !r.locked)

  if (failed.length > 0) {
    dialogs.showAlert(failed.map(f => f.error).join('\n\n'))
  }

  if (locked.length > 0) {
    const stillThere = locked.map(r => r.path)
    const proceed = await dialogs.showConfirm(
      `${locked.map(r => r.error).join('\n\n')}\n\n`
      + 'Close the app that is using it and try again — or delete it PERMANENTLY now.\n'
      + 'A permanent delete does not go to the Recycle Bin and cannot be undone.',
      'Could not move to Recycle Bin',
    )
    if (proceed) {
      const forced: DeleteResult[] = await window.api.fs.trash(stillThere, { permanent: true })
      const stillFailed = forced.filter(r => !r.ok)
      if (stillFailed.length > 0) {
        dialogs.showAlert(stillFailed.map(f => f.error).join('\n\n'))
      }
    }
  }
}
