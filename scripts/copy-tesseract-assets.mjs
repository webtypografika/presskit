/**
 * Put the OCR engine inside the app instead of fetching it from a CDN.
 *
 * tesseract.js defaults to loading three separate things from jsdelivr at run
 * time: the worker script, the WebAssembly engine, and the language data. That
 * means OCR does not work on a machine with no internet, and it fails outright
 * behind the kind of locked-down network a print shop's corporate customer
 * runs. None of that is visible until someone is standing in front of a file
 * they cannot read.
 *
 * The engine files are copied here rather than committed, so they can never
 * drift from the installed package version, and rather than imported through
 * Vite, because Vite would hash the filenames and the loader resolves its
 * siblings by name.
 *
 * Language data is deliberately NOT copied — see src/main/ocr-languages.ts.
 * English ships with the app; anything else the operator adds is downloaded
 * once, on purpose, and kept on disk where they can see and remove it.
 */
import { mkdirSync, copyFileSync, existsSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, 'src', 'renderer', 'public', 'tesseract')

/**
 * The engine picks one of these at run time by probing for SIMD support, so all
 * three have to be present — a missing fallback is a 404 on a machine we never
 * tested. Each one carries its WebAssembly inline, so there are no siblings to
 * copy alongside them.
 *
 * Only the `-lstm` builds are here. They are the ones used when the OCR engine
 * runs in its default mode, and the legacy builds would add another 11MB to the
 * installer for a mode we never select.
 */
const FILES = [
  ['tesseract.js', 'dist/worker.min.js'],
  ['tesseract.js-core', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['tesseract.js-core', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core', 'tesseract-core-lstm.wasm.js'],
]

mkdirSync(dest, { recursive: true })

let copied = 0
let bytes = 0
for (const [pkg, rel] of FILES) {
  const from = join(root, 'node_modules', pkg, rel)
  if (!existsSync(from)) {
    console.error(`[tesseract] MISSING ${pkg}/${rel} — run npm install`)
    process.exit(1)
  }
  const to = join(dest, rel.split('/').pop())
  // Skip an unchanged file so a rebuild does not rewrite 11MB every time.
  if (existsSync(to) && statSync(to).size === statSync(from).size) continue
  copyFileSync(from, to)
  copied++
  bytes += statSync(from).size
}

console.log(
  copied === 0
    ? '[tesseract] engine already in place'
    : `[tesseract] copied ${copied} file(s), ${(bytes / 1048576).toFixed(1)} MB → src/renderer/public/tesseract`,
)

/**
 * English is the exception to "languages are downloaded on demand".
 *
 * It is the default the app falls back to, so a machine that has never been
 * online must still be able to read a document. It is fetched once here, at
 * build time, cached outside git, and shipped inside the installer; the app
 * seeds it into the user's data folder on first run.
 */
const engDir = join(root, 'resources', 'tessdata')
const engFile = join(engDir, 'eng.traineddata.gz')

if (!existsSync(engFile)) {
  mkdirSync(engDir, { recursive: true })
  const url = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'
  console.log('[tesseract] fetching English data (once) …')
  const res = await fetch(url)
  if (!res.ok) {
    console.error(`[tesseract] could not fetch English data: ${res.status}`)
    process.exit(1)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 1024) {
    console.error('[tesseract] English data came back empty')
    process.exit(1)
  }
  const { writeFileSync } = await import('fs')
  writeFileSync(engFile, buf)
  console.log(`[tesseract] English data ready (${(buf.length / 1048576).toFixed(1)} MB)`)
} else {
  console.log('[tesseract] English data already present')
}
