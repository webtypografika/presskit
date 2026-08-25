import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

/**
 * Pull the text out of an incoming file so it can be rebuilt, without uploading
 * the customer's artwork anywhere.
 *
 * Two very different things share this one entry point, and the caller MUST
 * show which one produced the result:
 *
 *   'text' — the PDF carries its text as text. What comes out is byte-exact.
 *            Copy it into the new job with confidence.
 *   'ocr'  — the text was outlined, scanned or a photo, so it was recognised
 *            from pixels. It is a good draft and it WILL contain mistakes.
 *   'ai'   — a model that can see the page read it, using the shop's OWN API
 *            key. It handles designed layouts that defeat OCR (columns, type
 *            wrapped around images) because it sees the design rather than
 *            guessing from shapes. Still a draft: a model can misread, and
 *            unlike OCR it can misread *plausibly*, so it is told to mark
 *            uncertainty rather than resolve it.
 *
 * That distinction is the whole point in a print shop: a phone number read
 * wrong gets printed five thousand times. Never present OCR output as if it
 * were extracted text.
 */

export type TextBlock = {
  text: string
  /** Only from the AI path: what the model was unsure about, in its words. */
  note?: string
}
export type TextPage = { page: number; blocks: TextBlock[] }
export type ExtractResult = {
  method: 'text' | 'ocr' | 'ai'
  pages: TextPage[]
  /** Set when the result needs a human eye before use. */
  warning?: string
}

/**
 * Which languages OCR can read on this machine.
 *
 * There are over a hundred to choose from, so neither shipping them all nor
 * hard-coding a shortlist is right: whichever seven we picked would be wrong
 * for the eighth market. English is the default and comes with the app; the
 * operator adds whatever else their work actually needs, once, and it stays on
 * disk. See src/main/ocr-languages.ts.
 */
export type OcrLanguage = {
  code: string
  name: string
  installed: boolean
  size: number
  permanent: boolean
}

export const DEFAULT_LANG = 'eng'

export function listOcrLanguages(): Promise<OcrLanguage[]> {
  return window.api.ocr.languages()
}

export function installOcrLanguage(code: string): Promise<{ ok: boolean; error?: string }> {
  return window.api.ocr.install(code)
}

export function uninstallOcrLanguage(code: string): Promise<{ ok: boolean; error?: string }> {
  return window.api.ocr.uninstall(code)
}

export function revealOcrLanguages(): Promise<boolean> {
  return window.api.ocr.reveal()
}

/**
 * Which languages to start from, before the operator chooses.
 *
 * Their own language AND English, and the second one is not a nicety. Greek
 * data alone reads Greek beautifully and cannot read the Latin alphabet at all:
 * on a real flyer it returned the telephone number as "(οθ99007" with a
 * confidence of zero, and the Instagram handle as gibberish, while English data
 * read the same digits at 94. Artwork is bilingual even when the copy is not —
 * phone numbers, e-mail addresses, web addresses and brand names are Latin on
 * almost every job that comes through a Greek print shop.
 *
 * The cost is real and worth naming: two languages together let the more
 * confident one win short words, which is how "και" comes back as "Kat". A
 * mangled word is visible and gets retyped. A telephone number that never
 * appears at all is not, and gets printed missing.
 */
export function suggestedLangs(installed: OcrLanguage[]): string[] {
  const tag = (navigator.language || 'en').slice(0, 2).toLowerCase()
  const guess: Record<string, string> = {
    el: 'ell', es: 'spa', it: 'ita', de: 'deu', fr: 'fra', pt: 'por',
    nl: 'nld', pl: 'pol', tr: 'tur', ru: 'rus', bg: 'bul', ro: 'ron',
    sv: 'swe', da: 'dan', fi: 'fin', no: 'nor', cs: 'ces', hu: 'hun',
    hr: 'hrv', sr: 'srp', sk: 'slk', sl: 'slv', uk: 'ukr', ar: 'ara',
    he: 'heb', ja: 'jpn', ko: 'kor', zh: 'chi_sim', en: 'eng',
  }
  const has = (c: string) => installed.some(l => l.code === c && l.installed)
  const want = guess[tag]
  const out = want && want !== DEFAULT_LANG && has(want) ? [want, DEFAULT_LANG] : [DEFAULT_LANG]
  return out.filter(has).length ? out.filter(has) : [DEFAULT_LANG]
}

/* ------------------------------------------------------------------ *
 * PDFs that carry live text
 * ------------------------------------------------------------------ */

/** Rebuild reading order from pdf.js items, which arrive in draw order. */
function itemsToBlocks(items: Array<{ str: string; transform: number[]; height: number }>): TextBlock[] {
  const lines: Array<{ y: number; x: number; str: string }> = []
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue
    lines.push({ y: Math.round(it.transform[5]), x: it.transform[4], str: it.str })
  }
  if (lines.length === 0) return []

  // Group by baseline (y), tolerating the sub-pixel drift of justified text.
  lines.sort((a, b) => (b.y - a.y) || (a.x - b.x))
  const rows: Array<{ y: number; parts: Array<{ x: number; str: string }> }> = []
  for (const l of lines) {
    const row = rows.find(r => Math.abs(r.y - l.y) <= 2)
    if (row) row.parts.push({ x: l.x, str: l.str })
    else rows.push({ y: l.y, parts: [{ x: l.x, str: l.str }] })
  }

  const texts = rows.map(r =>
    r.parts.sort((a, b) => a.x - b.x).map(p => p.str).join('').replace(/\s+/g, ' ').trim(),
  ).filter(Boolean)

  // A blank line between rows that sit far apart separates blocks — that gap is
  // what makes an address block readable as one thing instead of four lines.
  const blocks: TextBlock[] = []
  let current: string[] = []
  for (let i = 0; i < texts.length; i++) {
    current.push(texts[i])
    const gap = i < rows.length - 1 ? rows[i].y - rows[i + 1].y : 0
    if (gap > 24 && current.length > 0) {
      blocks.push({ text: current.join('\n') })
      current = []
    }
  }
  if (current.length > 0) blocks.push({ text: current.join('\n') })
  return blocks
}

async function extractPdfText(filePath: string): Promise<ExtractResult> {
  const buffer = await window.api.fs.readFile(filePath)
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise
  const pages: TextPage[] = []
  let total = 0

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const content = await page.getTextContent()
    const blocks = itemsToBlocks(content.items as any)
    total += blocks.reduce((sum, b) => sum + b.text.length, 0)
    pages.push({ page: n, blocks })
  }

  // Outlined artwork looks like a PDF with no text at all. Say so rather than
  // returning an empty panel that reads like a failure.
  if (total < 3) {
    return {
      method: 'text',
      pages: [],
      warning: 'This PDF has no live text — the type is outlined or scanned. Run OCR to read it from the image.',
    }
  }
  return { method: 'text', pages }
}

/* ------------------------------------------------------------------ *
 * Preparing pixels for OCR
 * ------------------------------------------------------------------ */

/**
 * OCR reads letterforms, so it needs letterforms big enough to have shape.
 * Tesseract is trained around 300 dpi; artwork that arrives at screen
 * resolution has caption type only five or six pixels tall, and no amount of
 * language data recovers detail that was never in the file. Upscaling first is
 * the single biggest difference between a usable draft and the mush that comes
 * back otherwise.
 */
const OCR_TARGET_WIDTH = 2200
/** Above this the worker thrashes for no extra accuracy. */
const OCR_MAX_PIXELS = 12_000_000

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/**
 * Flatten to grey and stretch the contrast.
 *
 * Print artwork is the hard case for OCR precisely because it is designed:
 * type sits on tinted panels, over photographs, in brand colours close in
 * luminance to their background. Collapsing to grey and pushing the darkest and
 * lightest few per cent out to true black and white separates the letters from
 * the design without destroying the anti-aliasing the engine uses to judge
 * shape — which is why this stretches the range rather than thresholding it.
 */
function normalise(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  const hist = new Uint32Array(256)

  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0
    d[i] = d[i + 1] = d[i + 2] = g
    hist[g]++
  }

  const cut = (canvas.width * canvas.height) * 0.005
  let lo = 0
  let hi = 255
  let acc = 0
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > cut) { lo = v; break } }
  acc = 0
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > cut) { hi = v; break } }

  // A flat image (a solid panel, a blank scan) has nothing to stretch, and
  // stretching it anyway turns sensor noise into fake letters.
  if (hi - lo > 20) {
    const span = hi - lo
    const lut = new Uint8Array(256)
    for (let v = 0; v < 256; v++) {
      lut[v] = Math.max(0, Math.min(255, Math.round(((v - lo) / span) * 255)))
    }
    for (let i = 0; i < d.length; i += 4) {
      const g = lut[d[i]]
      d[i] = d[i + 1] = d[i + 2] = g
    }
  }

  ctx.putImageData(img, 0, 0)
}

async function imageToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob)
  let scale = bitmap.width < OCR_TARGET_WIDTH ? OCR_TARGET_WIDTH / bitmap.width : 1
  if (bitmap.width * bitmap.height * scale * scale > OCR_MAX_PIXELS) {
    scale = Math.sqrt(OCR_MAX_PIXELS / (bitmap.width * bitmap.height))
  }
  scale = Math.max(1, Math.min(scale, 4))

  const canvas = newCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // A logo saved as a transparent PNG is drawn in dark ink meant for white
  // paper. Composited onto nothing it becomes dark on dark and disappears.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()

  normalise(canvas)
  return canvas
}

/**
 * Draw a PDF page as an image so it can be OCR'd.
 *
 * Needed because a scanned PDF is not an image file: handing its bytes to the
 * OCR engine reads nothing at all. The page has to be rasterised first, at a
 * resolution chosen for recognition rather than for the screen.
 */
async function pdfPageToCanvas(page: pdfjsLib.PDFPageProxy): Promise<HTMLCanvasElement> {
  const base = page.getViewport({ scale: 1 })
  let scale = OCR_TARGET_WIDTH / base.width
  if (base.width * base.height * scale * scale > OCR_MAX_PIXELS) {
    scale = Math.sqrt(OCR_MAX_PIXELS / (base.width * base.height))
  }
  scale = Math.max(1, Math.min(scale, 4))

  const viewport = page.getViewport({ scale })
  const canvas = newCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport }).promise

  normalise(canvas)
  return canvas
}

/* ------------------------------------------------------------------ *
 * Turning OCR output into blocks
 * ------------------------------------------------------------------ */

/**
 * Anything below these is more likely to be artwork than type.
 *
 * Lowered on evidence (25/08). The first values dropped real words out of
 * otherwise perfect sentences — "Αρχαία" from a list of subjects, "μικρά" from
 * "σε πολύ μικρά τμήματα" — and a sentence missing one word is more dangerous
 * than an obviously mangled one, because it still reads as finished.
 *
 * The reasoning behind keeping them at all is unchanged: a misread word copied
 * into a job gets printed. But confidence turned out to be a blunt instrument
 * for that and the shape test below is the sharper one, so these now sit low
 * enough to keep real text and leave the judgement to shape.
 */
const MIN_WORD_CONFIDENCE = 28
const MIN_LINE_CONFIDENCE = 22

/**
 * Does this look like language, or like an icon the engine tried to read?
 *
 * Decorative marks — pictograms, rules, bullets — come back as short runs of
 * punctuation and stray capitals. Real text is mostly letters. Digits are
 * counted separately and generously, because a phone number is exactly the
 * thing worth extracting and it contains no letters at all.
 */
function looksLikeLanguage(s: string): boolean {
  const chars = s.replace(/\s/g, '')
  if (!chars) return false
  const letters = (chars.match(/\p{L}/gu) || []).length
  const digits = (chars.match(/\p{N}/gu) || []).length
  if (digits >= 3 && (letters + digits) / chars.length >= 0.6) return true
  return letters >= 2 && letters / chars.length >= 0.6
}

type OcrWord = { text: string; confidence: number }
type OcrLine = { words?: OcrWord[]; text: string; confidence: number; bbox: { x0: number; y0: number } }
type OcrParagraph = { lines?: OcrLine[] }
type OcrBlock = {
  paragraphs?: OcrParagraph[]
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

/**
 * The best reading of a single line, wherever it came from.
 *
 * Keyed by where the line sits on the page, coarsely, so the same line found by
 * two different passes lands on the same key.
 */
export type LineIndex = Map<string, { text: string; confidence: number }>

function lineKey(bbox: { x0: number; y0: number }): string {
  return `${Math.round(bbox.x0 / 12)}:${Math.round(bbox.y0 / 12)}`
}

/** One line, filtered — or empty if nothing in it survived. */
function lineText(l: OcrLine): string {
  if (l.confidence < MIN_LINE_CONFIDENCE) return ''
  const words = (l.words ?? [])
    .filter(w => w.confidence >= MIN_WORD_CONFIDENCE)
    .map(w => w.text.trim())
    // A lone symbol that survived on confidence is still a symbol.
    .filter(t => t.length > 1 || /[\p{L}\p{N}]/u.test(t))
  const line = words.join(' ').replace(/\s+/g, ' ').trim()
  return line && looksLikeLanguage(line) ? line : ''
}

/**
 * Record how well each pass read each line, so the best reading can win.
 *
 * This exists because of one stubborn failure. Greek data alone read a flyer's
 * telephone number as "(οθ99007" with a confidence of zero; English data read
 * the same digits at 94. Running both together did not fix it — the two models
 * compete per word, and on that line Greek won and destroyed it. The only way
 * to have both is to read the page once per language and keep whichever pass
 * was more sure of each line.
 */
export function indexLines(blocks: OcrBlock[] | null | undefined, into: LineIndex): void {
  for (const b of blocks ?? []) {
    for (const p of b.paragraphs ?? []) {
      for (const l of p.lines ?? []) {
        const text = lineText(l)
        if (!text) continue
        const key = lineKey(l.bbox)
        const seen = into.get(key)
        if (!seen || l.confidence > seen.confidence) {
          into.set(key, { text, confidence: l.confidence })
        }
      }
    }
  }
}

function blockToText(block: OcrBlock, best?: LineIndex): string {
  const paragraphs: string[] = []
  for (const p of block.paragraphs ?? []) {
    const lines: string[] = []
    for (const l of p.lines ?? []) {
      // A better reading of this same line, from another language's pass.
      const other = best?.get(lineKey(l.bbox))
      const mine = lineText(l)
      const text = other && other.confidence > l.confidence ? other.text : mine
      if (text) lines.push(text)
    }
    if (lines.length) paragraphs.push(lines.join('\n'))
  }
  return paragraphs.join('\n\n').trim()
}

type PlacedBlock = { text: string; x: number; y: number }

function ocrBlocks(
  blocks: OcrBlock[] | null | undefined,
  flatText: string,
  offsetX: number,
  offsetY: number,
  best?: LineIndex,
): PlacedBlock[] {
  if (!blocks || blocks.length === 0) {
    // Older engine builds, or a page the layout analyser gave up on. There is
    // nothing to place these by, so they keep the order the engine gave them.
    return flatText
      .split(/\n\s*\n/)
      .map(t => t.replace(/[ 	]+/g, ' ').trim())
      .filter(t => t && looksLikeLanguage(t))
      .map((text, i) => ({ text, x: offsetX, y: offsetY + i }))
  }

  return blocks
    .map(b => ({ text: blockToText(b, best), x: b.bbox.x0 + offsetX, y: b.bbox.y0 + offsetY }))
    .filter(b => b.text.length > 0)
}

/**
 * Put everything found on one page into the order a person reads it.
 *
 * Blocks now arrive from more than one pass over the same page — the page
 * itself, then each dark panel read separately — so they have to be ordered by
 * where they sit rather than by the order they were found.
 */
function inReadingOrder(blocks: PlacedBlock[], pageHeight: number): TextBlock[] {
  const band = Math.max(20, pageHeight * 0.02)
  return [...blocks]
    // Down the page first, then across — so side-by-side columns come out in
    // the order they are read, not the order the engine happened to find them.
    .sort((a, b) => (Math.round(a.y / band) - Math.round(b.y / band)) || (a.x - b.x))
    .map(b => ({ text: b.text }))
}

/* ------------------------------------------------------------------ *
 * OCR
 * ------------------------------------------------------------------ */

/**
 * Load the OCR engine that ships inside the app, as a Blob the worker can import.
 *
 * Left to itself, tesseract.js fetches its worker script, its WebAssembly engine
 * and its language data from a public CDN every time it runs. That made OCR
 * silently dependent on a connection and dead behind the kind of locked-down
 * network a print shop's corporate customer runs — with nothing on screen to
 * explain why.
 *
 * Pointing it at our own copies with a file:// URL does not work either: a
 * packaged app is served from file:// inside an asar archive, and the Blob
 * worker that tesseract.js spawns has an opaque origin, so Chromium refuses to
 * import from file:// — and refuses without an error, leaving the panel on
 * "Reading…" for ever. That is the bug this replaces.
 *
 * So the engine comes over IPC as source text and becomes Blob URLs, which a
 * Blob worker is allowed to import. The core is imported first so that it has
 * already defined itself by the time the engine looks for it, which sidesteps
 * the core-path handling completely.
 */
const CORE_FILE = 'tesseract-core-relaxedsimd-lstm.wasm.js'

async function bundledWorkerUrl(): Promise<string | null> {
  const parts = await window.api.ocr.engine(CORE_FILE)
  if (!parts?.worker || !parts?.engine) return null
  const url = (src: string) => URL.createObjectURL(new Blob([src], { type: 'application/javascript' }))
  const core = url(parts.engine)
  const worker = url(parts.worker)
  // One script that pulls in both, in order: tesseract.js wraps whatever we
  // give it in a single importScripts call.
  return url(`importScripts(${JSON.stringify(core)});importScripts(${JSON.stringify(worker)});`)
}

async function ocrCanvases(
  canvases: HTMLCanvasElement[],
  langs: string[],
  onProgress?: (pct: number) => void,
): Promise<ExtractResult> {
  // Loaded on demand: the OCR engine is large and most files never need it.
  const { createWorker, PSM } = await import('tesseract.js')

  // Language data is read from our own folder and handed over as bytes, rather
  // than letting the engine fetch and cache it somewhere the operator cannot
  // see. A language that is not installed is skipped instead of failing the
  // whole run, and English is the floor.
  const loaded: Array<{ code: string; data: Uint8Array }> = []
  for (const code of langs.length ? langs : [DEFAULT_LANG]) {
    const buf = await window.api.ocr.read(code)
    if (buf) loaded.push({ code, data: new Uint8Array(buf) })
  }
  if (loaded.length === 0) {
    throw new Error(
      'No language data is installed. Add a language under "Text language" and try again.',
    )
  }

  const logger = (m: { status: string; progress: number }) => {
    if (m.status === 'recognizing text' && onProgress) onProgress(Math.round(m.progress * 100))
  }

  /*
   * The engine inside the app first; the CDN only if that is not possible.
   *
   * Raced against a clock because the failure this replaces was not an error
   * but a silence — a worker that never answers. A promise that never settles
   * has to be treated as a failure like any other, or the panel waits for ever.
   */
  const ENGINE_TIMEOUT_MS = 20_000

  const withTimeout = <T,>(work: Promise<T>, label: string): Promise<T> =>
    Promise.race([
      work,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} did not start within ${ENGINE_TIMEOUT_MS / 1000}s`)),
          ENGINE_TIMEOUT_MS)),
    ])

  let worker
  const bundled = await bundledWorkerUrl().catch(() => null)
  try {
    if (!bundled) throw new Error('the engine is not bundled in this build')
    worker = await withTimeout(
      createWorker(loaded as any, undefined, {
        workerPath: bundled,
        // We own the files, so the engine's own cache would only duplicate them.
        cacheMethod: 'none',
        logger,
      } as any),
      'The engine inside the app',
    )
    console.info('[ocr] using the engine bundled in the app — works offline')
  } catch (e) {
    // Worth being loud about: it is the difference between OCR working offline
    // and OCR needing a connection, and it is invisible otherwise.
    console.warn('[ocr] bundled engine unavailable, falling back to the CDN:', e)
    worker = await withTimeout(
      createWorker(loaded as any, undefined, { cacheMethod: 'none', logger } as any),
      'The engine download',
    )
    console.info('[ocr] using the engine from the CDN — needs a connection')
  }

  // Re-applied after every reinitialize: switching language resets these.
  const applyParams = async () => worker.setParameters({
    // The page has already been upscaled to roughly this, and saying so stops
    // the engine second-guessing the letter sizes it is looking at.
    user_defined_dpi: '300',
    tessedit_pageseg_mode: PSM.AUTO,
    preserve_interword_spaces: '1',
  })

  try {
    await applyParams()

    const pages: TextPage[] = []
    for (let i = 0; i < canvases.length; i++) {
      const canvas = canvases[i]

      /*
       * Read the page once per language, then keep the best reading of each line.
       *
       * Handing the engine several languages at once is the obvious thing and
       * it is not enough: the models compete word by word, and the more
       * confident one wins even when it is wrong for that line. On a real flyer
       * that turned a telephone number into "(οθ99007" — Greek shapes imposed
       * on Latin digits — while an English-only pass read the same digits at a
       * confidence of 94. Neither language alone could read the whole page and
       * both together read it worse than either.
       *
       * So each language gets its own pass and each line goes to whichever pass
       * was surer of it. One language costs one pass, exactly as before.
       */
      const best: LineIndex = new Map()
      let structure: { blocks: OcrBlock[] | null; text: string } | null = null
      let bestOverall = -1

      for (const one of loaded) {
        if (loaded.length > 1) { await worker.reinitialize([one] as any); await applyParams() }
        const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true })
        const blocks = data.blocks as unknown as OcrBlock[] | null
        indexLines(blocks, best)
        // The pass that read the page best supplies the layout everything else
        // is placed into, so blocks and reading order stay coherent.
        if (data.confidence > bestOverall) {
          bestOverall = data.confidence
          structure = { blocks, text: data.text || '' }
        }
      }

      const found = ocrBlocks(structure?.blocks, structure?.text || '', 0, 0, best)
      pages.push({ page: i + 1, blocks: inReadingOrder(found, canvas.height) })
    }

    return {
      method: 'ocr',
      pages,
      warning: 'Read from the image by OCR — proofread it before printing. Numbers and Greek accents are the usual mistakes.',
    }
  } finally {
    await worker.terminate()
  }
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

const IMAGE_EXT = /\.(jpe?g|png|tiff?|bmp|webp)$/i

export type ExtractOptions = {
  /** Installed language codes to read with. Defaults to English. */
  langs?: string[]
  /** Skip the live-text path and read the pixels instead. */
  forceOcr?: boolean
}

/** A scan of a long document takes minutes a page and nobody waits for it. */
const OCR_PAGE_LIMIT = 10

export async function extractText(
  filePath: string,
  onProgress?: (pct: number) => void,
  opts: ExtractOptions = {},
): Promise<ExtractResult> {
  const langs = opts.langs?.length ? opts.langs : [DEFAULT_LANG]

  if (/\.pdf$/i.test(filePath)) {
    if (!opts.forceOcr) {
      const res = await extractPdfText(filePath)
      // Live text beats OCR every time, so only fall through when there is none.
      if (!(res.warning && res.pages.length === 0)) return res
    }
    const buffer = await window.api.fs.readFile(filePath)
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise
    const limit = Math.min(pdf.numPages, OCR_PAGE_LIMIT)
    const canvases: HTMLCanvasElement[] = []
    for (let n = 1; n <= limit; n++) canvases.push(await pdfPageToCanvas(await pdf.getPage(n)))
    const res = await ocrCanvases(canvases, langs, onProgress)
    if (pdf.numPages > limit) {
      res.warning += ` Only the first ${limit} of ${pdf.numPages} pages were read.`
    }
    return res
  }

  if (IMAGE_EXT.test(filePath)) {
    const buffer = await window.api.fs.readFile(filePath)
    const canvas = await imageToCanvas(new Blob([new Uint8Array(buffer)]))
    return ocrCanvases([canvas], langs, onProgress)
  }

  throw new Error('Text can be extracted from PDF and image files.')
}


/* ------------------------------------------------------------------ *
 * Reading with AI
 * ------------------------------------------------------------------ */

/**
 * Long edge the image is reduced to before it is sent.
 *
 * Deliberately much smaller than the OCR path wants. OCR needs the pixels
 * because it matches letter shapes; a model that reads the page understands
 * the layout instead, and sending more than this costs the shop tokens for
 * detail that changes nothing in the answer.
 */
const AI_MAX_EDGE = 1568

/** Prepare the page as the model should see it — the design intact. */
async function canvasForAi(source: HTMLCanvasElement | ImageBitmap): Promise<HTMLCanvasElement> {
  const w0 = source.width
  const h0 = source.height
  const scale = Math.min(1, AI_MAX_EDGE / Math.max(w0, h0))
  const canvas = newCanvas(Math.round(w0 * scale), Math.round(h0 * scale))
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // Same reason as the OCR path: a transparent PNG carries dark artwork drawn
  // for white paper, and needs the paper putting back under it.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height)
  return canvas
}

function canvasToJpegBase64(canvas: HTMLCanvasElement): string {
  // JPEG at 0.85: artwork is photographic enough that PNG would roughly triple
  // the payload, and the shop pays for those bytes.
  const url = canvas.toDataURL('image/jpeg', 0.85)
  return url.slice(url.indexOf(',') + 1)
}

type AiResponse = { blocks?: Array<{ text?: string; note?: string }>; error?: string; message?: string }

/**
 * Read the artwork with the shop's own AI key, via PressCal.
 *
 * The key never reaches this machine — PressKit posts the image to PressCal
 * over the API key it already holds, and PressCal calls the model with the
 * org's own key. That keeps one place where keys live, and means this costs
 * the shop directly rather than being billed through us.
 */
export async function extractWithAi(
  filePath: string,
  onProgress?: (pct: number) => void,
): Promise<ExtractResult> {
  onProgress?.(10)

  let canvas: HTMLCanvasElement
  if (/.pdf$/i.test(filePath)) {
    const buffer = await window.api.fs.readFile(filePath)
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise
    // One page per call, and the shop pays per call — so this reads the first
    // page rather than quietly spending on a long document.
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: 1 })
    const raster = newCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const rctx = raster.getContext('2d')!
    rctx.fillStyle = '#ffffff'
    rctx.fillRect(0, 0, raster.width, raster.height)
    await page.render({ canvasContext: rctx, viewport }).promise
    canvas = await canvasForAi(raster)
  } else {
    const buffer = await window.api.fs.readFile(filePath)
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(buffer)]))
    canvas = await canvasForAi(bitmap)
    bitmap.close?.()
  }

  onProgress?.(40)
  const image = canvasToJpegBase64(canvas)

  onProgress?.(60)
  const res = (await window.api.presscal.postToApi('/extract-text', {
    image,
    mediaType: 'image/jpeg',
    filename: filePath.split(/[\/]/).pop() || '',
  })) as AiResponse

  onProgress?.(100)

  // PressCal answers a missing key with guidance rather than a failure, and
  // that guidance is the whole point — surface it verbatim.
  if (res?.error) throw new Error(res.message || res.error)

  const blocks = (res?.blocks ?? [])
    .filter((b): b is { text: string; note?: string } => typeof b?.text === 'string' && !!b.text.trim())
    .map(b => ({ text: b.text.trim(), ...(b.note ? { note: b.note } : {}) }))

  if (blocks.length === 0) {
    return {
      method: 'ai',
      pages: [{ page: 1, blocks: [] }],
      warning: 'The model found no text on this artwork.',
    }
  }

  return {
    method: 'ai',
    pages: [{ page: 1, blocks }],
    warning: 'Read by AI, using your own key. Still proofread it — a model can misread confidently.',
  }
}

/** Everything as one plain-text document, for copying or saving. */
export function resultToPlainText(res: ExtractResult): string {
  return res.pages
    .map(p => (res.pages.length > 1 ? `--- Page ${p.page} ---\n` : '') + p.blocks.map(b => b.text).join('\n\n'))
    .join('\n\n')
}
