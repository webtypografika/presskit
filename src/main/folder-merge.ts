// PressKit — MOVE A QUOTE FOLDER, MERGING WHEN THE DESTINATION ALREADY EXISTS.
//
// Archive and restore used to stop when the destination existed: archive logged «already in
// archive», restore «already restored» — and moved nothing. A folder that had once been half-moved
// (a file held open by Dropbox, a copy whose delete failed) then stayed split for good. QT-2026-0447,
// 27/10/2026: 01–02 in the live folder, 03–05 and that morning's plates in `_01 Archive`, a restore
// that found the live folder and declared the job restored, and a quote pointing at the archive.
//
// Now the source is merged into the destination, entry by entry:
//   • a name the destination does not have is moved across (rename; copy + delete if that fails);
//   • a folder both sides have is merged the same way, recursively;
//   • a file both sides have is dropped from the source when it is the SAME file (size and bytes),
//     and otherwise kept under a free name — «name (2).ext» — never overwritten, never lost;
//   • the source folder is removed once it is empty.

import { existsSync } from 'fs'
import { rename, mkdir, readdir, copyFile, rm, stat, readFile, rmdir } from 'fs/promises'
import { join, dirname, extname, basename } from 'path'

export interface MergeReport {
  moved: number
  duplicatesDropped: number
  keptAsCopy: string[]
  /** Source entries that could not be moved (locked files); the source folder stays. */
  failed: string[]
}

async function sameFile(a: string, b: string): Promise<boolean> {
  const [sa, sb] = await Promise.all([stat(a), stat(b)])
  if (sa.size !== sb.size) return false
  if (sa.size > 64 * 1024 * 1024) return true // big twins by size; reading both is not worth it
  const [ba, bb] = await Promise.all([readFile(a), readFile(b)])
  return ba.equals(bb)
}

function freeName(dir: string, name: string, taken: (p: string) => boolean): string {
  const ext = extname(name)
  const stem = basename(name, ext)
  for (let n = 2; n < 1000; n++) {
    const candidate = join(dir, `${stem} (${n})${ext}`)
    if (!taken(candidate)) return candidate
  }
  return join(dir, `${stem} (${Date.now()})${ext}`)
}

async function copyTree(src: string, dest: string): Promise<void> {
  const s = await stat(src)
  if (!s.isDirectory()) { await copyFile(src, dest); return }
  await mkdir(dest, { recursive: true })
  for (const e of await readdir(src)) await copyTree(join(src, e), join(dest, e))
}

/** Move one entry to a destination that does not exist: rename, else copy + delete. */
async function moveEntry(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest)
  } catch {
    await copyTree(src, dest)
    await rm(src, { recursive: true, force: true })
  }
}

/** Move `src` to `dest`; when `dest` exists, merge into it (see the header). */
export async function moveFolderMerging(src: string, dest: string, report: MergeReport = { moved: 0, duplicatesDropped: 0, keptAsCopy: [], failed: [] }): Promise<MergeReport> {
  await mkdir(dirname(dest), { recursive: true })
  if (!existsSync(dest)) {
    try { await moveEntry(src, dest); report.moved++ } catch { report.failed.push(src) }
    return report
  }
  for (const name of await readdir(src)) {
    const from = join(src, name)
    const to = join(dest, name)
    try {
      const fromIsDir = (await stat(from)).isDirectory()
      if (!existsSync(to)) {
        await moveEntry(from, to); report.moved++
      } else if (fromIsDir && (await stat(to)).isDirectory()) {
        await moveFolderMerging(from, to, report)
      } else if (!fromIsDir && !(await stat(to)).isDirectory() && await sameFile(from, to)) {
        await rm(from, { force: true }); report.duplicatesDropped++
      } else {
        const target = freeName(dest, name, p => existsSync(p))
        await moveEntry(from, target); report.keptAsCopy.push(target)
      }
    } catch {
      report.failed.push(from)
    }
  }
  try { await rmdir(src) } catch { /* not empty: something was locked — said in `failed` */ }
  return report
}
