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
 *
 * That distinction is the whole point in a print shop: a phone number read
 * wrong gets printed five thousand times. Never present OCR output as if it
 * were extracted text.
 */

export type TextBlock = { text: string }
export type TextPage = { page: number; blocks: TextBlock[] }
export type ExtractResult = {
  method: 'text' | 'ocr'
  pages: TextPage[]
  /** Set when the result needs a human eye before use. */
  warning?: string
}

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

async function extractPdf(filePath: string): Promise<ExtractResult> {
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

async function extractImage(filePath: string, onProgress?: (pct: number) => void): Promise<ExtractResult> {
  // Loaded on demand: the OCR engine and its language data are large, and most
  // files never need them.
  const { recognize } = await import('tesseract.js')
  const buffer = await window.api.fs.readFile(filePath)
  const blob = new Blob([new Uint8Array(buffer)])

  // Greek first: this is a Greek print shop, and most incoming artwork is
  // Greek with Latin brand names mixed in. Both languages together handles it.
  const { data } = await recognize(blob, 'ell+eng', {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text' && onProgress) onProgress(Math.round(m.progress * 100))
    },
  } as any)

  const blocks = (data.text || '')
    .split(/\n\s*\n/)
    .map(t => t.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .map(text => ({ text }))

  return {
    method: 'ocr',
    pages: [{ page: 1, blocks }],
    warning: 'Read from the image by OCR — proofread it before printing. Numbers and Greek accents are the usual mistakes.',
  }
}

const IMAGE_EXT = /\.(jpe?g|png|tiff?|bmp|webp)$/i

export async function extractText(
  filePath: string,
  onProgress?: (pct: number) => void,
): Promise<ExtractResult> {
  if (/\.pdf$/i.test(filePath)) {
    const res = await extractPdf(filePath)
    // A PDF that turned out to be a scan is exactly the OCR case — go straight
    // there instead of making the user work out what to press next.
    if (res.warning && res.pages.length === 0) return extractImage(filePath, onProgress)
    return res
  }
  if (IMAGE_EXT.test(filePath)) return extractImage(filePath, onProgress)
  throw new Error('Text can be extracted from PDF and image files.')
}

/** Everything as one plain-text document, for copying or saving. */
export function resultToPlainText(res: ExtractResult): string {
  return res.pages
    .map(p => (res.pages.length > 1 ? `--- Page ${p.page} ---\n` : '') + p.blocks.map(b => b.text).join('\n\n'))
    .join('\n\n')
}
