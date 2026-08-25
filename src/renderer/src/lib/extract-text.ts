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
 * Which language data OCR loads.
 *
 * This is not a cosmetic preference. Running two languages together lets the
 * more confident one win short words, which is how the Greek word for "and"
 * comes back as the Latin "Kat" — the shapes are nearly identical. When the
 * operator knows the artwork is in one language, saying so removes a whole
 * class of mistake, so the choice belongs in front of them rather than buried
 * in a default.
 */
export const OCR_LANGUAGES = [
  { id: 'ell+eng', label: 'Greek + English' },
  { id: 'ell', label: 'Greek only' },
  { id: 'eng', label: 'English only' },
  { id: 'spa+eng', label: 'Spanish + English' },
  { id: 'ita+eng', label: 'Italian + English' },
  { id: 'deu+eng', label: 'German + English' },
  { id: 'fra+eng', label: 'French + English' },
] as const

export type OcrLang = (typeof OCR_LANGUAGES)[number]['id']

/** What the operator's own machine suggests, before they override it. */
export function defaultOcrLang(): OcrLang {
  const tag = (navigator.language || 'en').slice(0, 2).toLowerCase()
  const guess: Record<string, OcrLang> = {
    el: 'ell+eng', es: 'spa+eng', it: 'ita+eng', de: 'deu+eng', fr: 'fra+eng',
  }
  return guess[tag] ?? 'eng'
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
 * Deliberately low. The cost of dropping a real word is that the operator
 * retypes it from the artwork already in front of them; the cost of keeping a
 * misread one is that it gets copied into a job and printed. But set too high
 * they would also eat the small caption type this feature exists to recover, so
 * they sit just under where genuine text lands and leave the rest to the shape
 * test below.
 */
const MIN_WORD_CONFIDENCE = 40
const MIN_LINE_CONFIDENCE = 35

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
type OcrLine = { words?: OcrWord[]; text: string; confidence: number }
type OcrParagraph = { lines?: OcrLine[] }
type OcrBlock = {
  paragraphs?: OcrParagraph[]
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

function blockToText(block: OcrBlock): string {
  const paragraphs: string[] = []
  for (const p of block.paragraphs ?? []) {
    const lines: string[] = []
    for (const l of p.lines ?? []) {
      if (l.confidence < MIN_LINE_CONFIDENCE) continue
      const words = (l.words ?? [])
        .filter(w => w.confidence >= MIN_WORD_CONFIDENCE)
        .map(w => w.text.trim())
        // A lone symbol that survived on confidence is still a symbol.
        .filter(t => t.length > 1 || /[\p{L}\p{N}]/u.test(t))
      const line = words.join(' ').replace(/\s+/g, ' ').trim()
      if (line && looksLikeLanguage(line)) lines.push(line)
    }
    if (lines.length) paragraphs.push(lines.join('\n'))
  }
  return paragraphs.join('\n\n').trim()
}

/**
 * Keep each region of the page as its own block, in reading order.
 *
 * This is the fix for the six-column flyer. The engine reports where every
 * region sits; the previous version threw that away and split the flat text
 * dump on blank lines, so six captions sharing a row of the page came back
 * welded into a single line. Reading a column at a time is the only order a
 * person can use.
 */
function ocrBlocks(
  blocks: OcrBlock[] | null | undefined,
  flatText: string,
  pageHeight: number,
): TextBlock[] {
  if (!blocks || blocks.length === 0) {
    // Older engine builds, or a page the layout analyser gave up on.
    return flatText
      .split(/\n\s*\n/)
      .map(t => t.replace(/[ \t]+/g, ' ').trim())
      .filter(t => t && looksLikeLanguage(t))
      .map(text => ({ text }))
  }

  const band = Math.max(20, pageHeight * 0.02)
  return blocks
    .map(b => ({ bbox: b.bbox, text: blockToText(b) }))
    .filter(b => b.text.length > 0)
    // Down the page first, then across — so side-by-side columns come out in
    // the order they are read, not the order the engine happened to find them.
    .sort((a, b) =>
      (Math.round(a.bbox.y0 / band) - Math.round(b.bbox.y0 / band)) || (a.bbox.x0 - b.bbox.x0))
    .map(b => ({ text: b.text }))
}

/* ------------------------------------------------------------------ *
 * OCR
 * ------------------------------------------------------------------ */

async function ocrCanvases(
  canvases: HTMLCanvasElement[],
  lang: OcrLang,
  onProgress?: (pct: number) => void,
): Promise<ExtractResult> {
  // Loaded on demand: the OCR engine and its language data are large, and most
  // files never need them.
  const { createWorker, PSM } = await import('tesseract.js')

  const worker = await createWorker(lang, undefined, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text' && onProgress) onProgress(Math.round(m.progress * 100))
    },
  } as any)

  try {
    await worker.setParameters({
      // The page has already been upscaled to roughly this, and saying so stops
      // the engine second-guessing the letter sizes it is looking at.
      user_defined_dpi: '300',
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: '1',
    })

    const pages: TextPage[] = []
    for (let i = 0; i < canvases.length; i++) {
      const { data } = await worker.recognize(canvases[i], {}, { text: true, blocks: true })
      pages.push({
        page: i + 1,
        blocks: ocrBlocks(
          data.blocks as unknown as OcrBlock[] | null,
          data.text || '',
          canvases[i].height,
        ),
      })
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
  lang?: OcrLang
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
  const lang = opts.lang ?? defaultOcrLang()

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
    const res = await ocrCanvases(canvases, lang, onProgress)
    if (pdf.numPages > limit) {
      res.warning += ` Only the first ${limit} of ${pdf.numPages} pages were read.`
    }
    return res
  }

  if (IMAGE_EXT.test(filePath)) {
    const buffer = await window.api.fs.readFile(filePath)
    const canvas = await imageToCanvas(new Blob([new Uint8Array(buffer)]))
    return ocrCanvases([canvas], lang, onProgress)
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
  const res = (await window.api.presscal.postToApi('extract-text', {
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
