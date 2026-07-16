import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { readdir, rename, rm, mkdir, cp } from 'fs/promises'
import { join, basename } from 'path'

const execFileP = promisify(execFile)

const SEVEN_ZIP_PATHS = [
  'C:\\Program Files\\7-Zip\\7z.exe',
  'C:\\Program Files (x86)\\7-Zip\\7z.exe',
]

const WINRAR_PATHS = [
  'C:\\Program Files\\WinRAR\\WinRAR.exe',
  'C:\\Program Files (x86)\\WinRAR\\WinRAR.exe',
]

// Explorer's built-in zip engine via Shell.Application COM.
// Extracts into a fresh temp subfolder (completion is detected by item count,
// and pre-existing files in destDir never trigger overwrite prompts),
// then Node moves the results into destDir.
async function extractViaExplorer(zipPath: string, destDir: string): Promise<void> {
  const tempDir = join(destDir, `.extracting-${Date.now()}`)
  await mkdir(tempDir, { recursive: true })
  const esc = (s: string) => s.replace(/'/g, "''")
  const script = `
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject Shell.Application
$zip = $shell.NameSpace('${esc(zipPath)}')
if (-not $zip) { throw 'Cannot open zip' }
$total = $zip.Items().Count
if ($total -eq 0) { exit 0 }
$dest = $shell.NameSpace('${esc(tempDir)}')
if (-not $dest) { throw 'Cannot open destination' }
# 4=no progress UI, 16=yes to all, 512=no confirm new dir, 1024=no error UI
$dest.CopyHere($zip.Items(), 1556)
$deadline = (Get-Date).AddMinutes(10)
while ($shell.NameSpace('${esc(tempDir)}').Items().Count -lt $total) {
  if ((Get-Date) -gt $deadline) { throw 'Timeout waiting for Explorer extraction' }
  Start-Sleep -Milliseconds 500
}
`
  // -EncodedCommand keeps Greek/Unicode paths intact regardless of console codepage
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  try {
    await execFileP('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], { timeout: 620000 })
    for (const entry of await readdir(tempDir)) {
      const from = join(tempDir, entry)
      const to = join(destDir, entry)
      try {
        await rm(to, { recursive: true, force: true })
        await rename(from, to)
      } catch {
        await cp(from, to, { recursive: true, force: true })
      }
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Silent ZIP extraction with a fallback chain:
 * 1. adm-zip (pure JS, fast) — fails on some streamed zips (e.g. WeTransfer: "CRC32 checksum failed")
 * 2. 7-Zip / WinRAR CLI if installed — robust, full Unicode support
 * 3. Windows Explorer's own zip engine (Shell COM) — always available
 * Windows tar.exe and PowerShell Expand-Archive are deliberately NOT used
 * (tar corrupts Greek filenames, Expand-Archive chokes on [brackets] in paths).
 */
export async function extractZipRobust(zipPath: string, destDir: string): Promise<{ ok: boolean; method?: string; error?: string }> {
  const errors: string[] = []

  try {
    const AdmZip = (await import('adm-zip')).default
    new AdmZip(zipPath).extractAllTo(destDir, true)
    return { ok: true, method: 'adm-zip' }
  } catch (err: any) {
    errors.push(`adm-zip: ${err.message || err}`)
  }

  const sevenZip = SEVEN_ZIP_PATHS.find(p => existsSync(p))
  if (sevenZip) {
    try {
      await execFileP(sevenZip, ['x', zipPath, `-o${destDir}`, '-y', '-aoa', '-bso0', '-bsp0'], { timeout: 600000 })
      console.warn(`[ZipExtract] adm-zip failed, extracted with 7-Zip: ${basename(zipPath)}`)
      return { ok: true, method: '7-zip' }
    } catch (err: any) {
      errors.push(`7-Zip: ${err.message || err}`)
    }
  }

  const winrar = WINRAR_PATHS.find(p => existsSync(p))
  if (winrar) {
    try {
      // -ibck = run in background (no window), -o+ = overwrite all
      await execFileP(winrar, ['x', '-ibck', '-y', '-o+', zipPath, destDir + '\\'], { timeout: 600000 })
      console.warn(`[ZipExtract] adm-zip failed, extracted with WinRAR: ${basename(zipPath)}`)
      return { ok: true, method: 'winrar' }
    } catch (err: any) {
      errors.push(`WinRAR: ${err.message || err}`)
    }
  }

  try {
    await extractViaExplorer(zipPath, destDir)
    console.warn(`[ZipExtract] adm-zip failed, extracted with Explorer shell: ${basename(zipPath)}`)
    return { ok: true, method: 'explorer' }
  } catch (err: any) {
    errors.push(`Explorer: ${err.message || err}`)
  }

  return { ok: false, error: errors.join(' | ') }
}
