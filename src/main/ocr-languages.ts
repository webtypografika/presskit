import { app, IpcMain, shell } from 'electron'
import { mkdirSync, readdirSync, statSync, existsSync, writeFileSync, unlinkSync, copyFileSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'

/**
 * The languages OCR can read, kept on disk and managed by the operator.
 *
 * The engine supports over a hundred languages. Shipping them all would add
 * hundreds of megabytes to the installer for a shop that will ever use two, and
 * hard-coding a shortlist just moves the guess from the user to us — whichever
 * seven we picked would be wrong for the eighth market.
 *
 * So: English is the default and the app works out of the box with it, and any
 * other language is something the operator adds deliberately. Each one is a
 * real file in a real folder they can open, see the size of, and delete. That
 * matters more than it sounds — a print shop machine is a working tool, and
 * software that quietly accumulates hundreds of megabytes in a hidden cache is
 * software they stop trusting.
 *
 * Data comes from the same place the OCR engine would have fetched it from
 * anyway; the difference is that it happens once, visibly, instead of silently
 * on every machine that opens a Greek flyer.
 */

/** Where the engine's own data packages live. */
const SOURCE = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data'

/**
 * Data packages to try, in order.
 *
 * The engine runs in LSTM-only mode, and those packages are roughly a third the
 * size of the full ones — 1.6MB against 6MB on average — so they are the right
 * default. But a handful of languages the engine lists have never had one
 * published: Kurdish and Tagalog both 404 there and exist only as full
 * packages. Offering a language that cannot be installed is worse than a larger
 * download, so the full package is the fallback rather than an error.
 */
const VARIANTS = ['4.0.0_best_int', '4.0.0'] as const

function dataDir(): string {
  const dir = join(app.getPath('userData'), 'tessdata')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Put the shipped English data in place the first time the app runs.
 *
 * Copied out of the installer rather than downloaded, so a machine that has
 * never had internet can still read a document on day one. Copied rather than
 * read in place because the operator is allowed to manage this folder, and a
 * file they cannot see is a file they cannot account for.
 */
export function seedDefaultLanguage(): void {
  const target = join(dataDir(), 'eng.traineddata.gz')
  if (existsSync(target)) return
  // Packaged builds put extra resources beside the app; in development the
  // repo folder is the same shape.
  const candidates = [
    join(process.resourcesPath || '', 'tessdata', 'eng.traineddata.gz'),
    join(app.getAppPath(), 'resources', 'tessdata', 'eng.traineddata.gz'),
    join(app.getAppPath(), '..', '..', 'resources', 'tessdata', 'eng.traineddata.gz'),
  ]
  for (const from of candidates) {
    try {
      if (from && existsSync(from)) {
        copyFileSync(from, target)
        return
      }
    } catch {
      // Try the next location; a failure here only means English has to be
      // downloaded like any other language.
    }
  }
}

function fileFor(code: string): string {
  return join(dataDir(), `${code}.traineddata.gz`)
}

/** Codes are pasted into a URL and a path, so they are checked, not trusted. */
function validCode(code: unknown): code is string {
  return typeof code === 'string' && /^[a-z]{3}(_[a-z]{2,8})?$/i.test(code)
}

/**
 * Every language the engine has data for, with the name a person would look for.
 *
 * Held here rather than fetched so the list works before the first download and
 * on a machine with no connection. Names are in English because that is the
 * language of the app; the script hint after a name is what tells someone
 * whether they are looking at the right one when two names look alike.
 */
export const OCR_CATALOG: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'afr', name: 'Afrikaans' }, { code: 'sqi', name: 'Albanian' },
  { code: 'amh', name: 'Amharic' }, { code: 'ara', name: 'Arabic' },
  { code: 'asm', name: 'Assamese' }, { code: 'aze', name: 'Azerbaijani' },
  { code: 'aze_cyrl', name: 'Azerbaijani (Cyrillic)' }, { code: 'eus', name: 'Basque' },
  { code: 'bel', name: 'Belarusian' }, { code: 'ben', name: 'Bengali' },
  { code: 'bos', name: 'Bosnian' }, { code: 'bul', name: 'Bulgarian' },
  { code: 'mya', name: 'Burmese' }, { code: 'cat', name: 'Catalan' },
  { code: 'ceb', name: 'Cebuano' }, { code: 'chr', name: 'Cherokee' },
  { code: 'chi_sim', name: 'Chinese (Simplified)' }, { code: 'chi_tra', name: 'Chinese (Traditional)' },
  { code: 'hrv', name: 'Croatian' }, { code: 'ces', name: 'Czech' },
  { code: 'dan', name: 'Danish' }, { code: 'nld', name: 'Dutch' },
  { code: 'dzo', name: 'Dzongkha' }, { code: 'eng', name: 'English' },
  { code: 'enm', name: 'English (Middle)' }, { code: 'epo', name: 'Esperanto' },
  { code: 'est', name: 'Estonian' }, { code: 'fin', name: 'Finnish' },
  { code: 'frk', name: 'Frankish' }, { code: 'fra', name: 'French' },
  { code: 'frm', name: 'French (Middle)' }, { code: 'glg', name: 'Galician' },
  { code: 'kat', name: 'Georgian' }, { code: 'kat_old', name: 'Georgian (Old)' },
  { code: 'deu', name: 'German' }, { code: 'ell', name: 'Greek' },
  { code: 'grc', name: 'Greek (Ancient)' }, { code: 'guj', name: 'Gujarati' },
  { code: 'hat', name: 'Haitian Creole' }, { code: 'heb', name: 'Hebrew' },
  { code: 'hin', name: 'Hindi' }, { code: 'hun', name: 'Hungarian' },
  { code: 'isl', name: 'Icelandic' }, { code: 'ind', name: 'Indonesian' },
  { code: 'iku', name: 'Inuktitut' }, { code: 'gle', name: 'Irish' },
  { code: 'ita', name: 'Italian' }, { code: 'ita_old', name: 'Italian (Old)' },
  { code: 'jpn', name: 'Japanese' }, { code: 'jav', name: 'Javanese' },
  { code: 'kan', name: 'Kannada' }, { code: 'kaz', name: 'Kazakh' },
  { code: 'khm', name: 'Khmer' }, { code: 'kor', name: 'Korean' },
  { code: 'kur', name: 'Kurdish' }, { code: 'kir', name: 'Kyrgyz' },
  { code: 'lao', name: 'Lao' }, { code: 'lat', name: 'Latin' },
  { code: 'lav', name: 'Latvian' }, { code: 'lit', name: 'Lithuanian' },
  { code: 'mkd', name: 'Macedonian' }, { code: 'msa', name: 'Malay' },
  { code: 'mal', name: 'Malayalam' }, { code: 'mlt', name: 'Maltese' },
  { code: 'mar', name: 'Marathi' }, { code: 'nep', name: 'Nepali' },
  { code: 'nor', name: 'Norwegian' }, { code: 'ori', name: 'Odia' },
  { code: 'pus', name: 'Pashto' }, { code: 'fas', name: 'Persian' },
  { code: 'pol', name: 'Polish' }, { code: 'por', name: 'Portuguese' },
  { code: 'pan', name: 'Punjabi' }, { code: 'ron', name: 'Romanian' },
  { code: 'rus', name: 'Russian' }, { code: 'san', name: 'Sanskrit' },
  { code: 'srp', name: 'Serbian' }, { code: 'srp_latn', name: 'Serbian (Latin)' },
  { code: 'sin', name: 'Sinhala' }, { code: 'slk', name: 'Slovak' },
  { code: 'slv', name: 'Slovenian' }, { code: 'spa', name: 'Spanish' },
  { code: 'spa_old', name: 'Spanish (Old)' }, { code: 'swa', name: 'Swahili' },
  { code: 'swe', name: 'Swedish' }, { code: 'syr', name: 'Syriac' },
  { code: 'tgl', name: 'Tagalog' }, { code: 'tgk', name: 'Tajik' },
  { code: 'tam', name: 'Tamil' }, { code: 'tel', name: 'Telugu' },
  { code: 'tha', name: 'Thai' }, { code: 'bod', name: 'Tibetan' },
  { code: 'tir', name: 'Tigrinya' }, { code: 'tur', name: 'Turkish' },
  { code: 'ukr', name: 'Ukrainian' }, { code: 'urd', name: 'Urdu' },
  { code: 'uig', name: 'Uyghur' }, { code: 'uzb', name: 'Uzbek' },
  { code: 'uzb_cyrl', name: 'Uzbek (Cyrillic)' }, { code: 'vie', name: 'Vietnamese' },
  { code: 'cym', name: 'Welsh' }, { code: 'yid', name: 'Yiddish' },
]

export type OcrLanguageRow = {
  code: string
  name: string
  installed: boolean
  /** Bytes on disk, 0 when not installed. */
  size: number
  /** English cannot be removed — it is what the app falls back to. */
  permanent: boolean
}

/** English ships with the app and is never deletable. */
const DEFAULT_CODE = 'eng'

function installedCodes(): Map<string, number> {
  const out = new Map<string, number>()
  const dir = dataDir()
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const m = name.match(/^(.+)\.traineddata\.gz$/)
    if (!m) continue
    try {
      out.set(m[1], statSync(join(dir, name)).size)
    } catch {
      // A file that vanished between listing and stat is simply not installed.
    }
  }
  return out
}

export function listLanguages(): OcrLanguageRow[] {
  const have = installedCodes()
  return OCR_CATALOG.map((l) => ({
    code: l.code,
    name: l.name,
    installed: have.has(l.code),
    size: have.get(l.code) ?? 0,
    permanent: l.code === DEFAULT_CODE,
  }))
}

/**
 * Read a language back for the OCR engine.
 *
 * The engine accepts language data as raw bytes, which is what lets the whole
 * download step live here instead of inside its own opaque browser cache. The
 * bytes stay gzipped — the engine checks for that itself and unpacks it.
 */
export async function readLanguage(code: string): Promise<Uint8Array | null> {
  if (!validCode(code)) return null
  const path = fileFor(code)
  if (!existsSync(path)) return null
  return new Uint8Array(await readFile(path))
}

export function registerOcrLanguageHandlers(ipcMain: IpcMain): void {
  seedDefaultLanguage()

  ipcMain.handle('ocr:languages', () => listLanguages())

  ipcMain.handle('ocr:read', async (_e, code: string) => {
    const data = await readLanguage(code)
    // Electron cannot send a Uint8Array over IPC as itself; the renderer
    // rebuilds it from the buffer.
    return data ? data.buffer : null
  })

  ipcMain.handle('ocr:install', async (_e, code: string) => {
    if (!validCode(code)) return { ok: false, error: 'Unknown language.' }
    try {
      let lastStatus = 0
      for (const variant of VARIANTS) {
        const res = await fetch(`${SOURCE}/${code}/${variant}/${code}.traineddata.gz`)
        if (!res.ok) {
          lastStatus = res.status
          // Only a missing package is worth retrying as the larger one; a server
          // error means trying again would fail the same way.
          if (res.status === 404) continue
          return { ok: false, error: `Download failed (${res.status}).` }
        }
        const bytes = new Uint8Array(await res.arrayBuffer())
        // A truncated download would fail later, deep inside the engine, as an
        // unreadable-file error that says nothing useful. Catch it here.
        if (bytes.length < 1024) return { ok: false, error: 'The downloaded file was empty.' }
        writeFileSync(fileFor(code), bytes)
        return { ok: true, size: bytes.length }
      }
      return {
        ok: false,
        error: lastStatus === 404
          ? 'This language has no data available to download.'
          : `Download failed (${lastStatus}).`,
      }
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error && /fetch failed|ENOTFOUND|ECONN/i.test(e.message)
          ? 'No connection. Languages are downloaded once, and need internet for that first time.'
          : `Download failed: ${(e as Error).message}`,
      }
    }
  })

  ipcMain.handle('ocr:uninstall', (_e, code: string) => {
    if (!validCode(code)) return { ok: false, error: 'Unknown language.' }
    if (code === DEFAULT_CODE) return { ok: false, error: 'English cannot be removed.' }
    try {
      const path = fileFor(code)
      if (existsSync(path)) unlinkSync(path)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  /** Let them see the folder for themselves — see the note at the top. */
  ipcMain.handle('ocr:reveal', () => {
    shell.openPath(dataDir())
    return true
  })
}
