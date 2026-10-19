// The JFIF APP0 segment every JPEG we write must carry — with the file's dpi in it.
//
// WHY (19/10/2026, QT-2026-0477). A poster was converted PDF → JPG at 300 dpi, then JPG → JPG
// to 500×700 mm. Illustrator and Photoshop opened the result at 50×70 cm; Roland VersaWorks
// opened it at 208×294 mm. The second file had an EXIF resolution (300 dpi) and NO JFIF
// segment: libvips, when it writes EXIF, leaves the APP0 JFIF header out (the EXIF spec wants
// APP1 first). VersaWorks reads the dpi from JFIF only and falls back to its native 720 dpi
// when it is missing — 5906 px / 720 = 208.4 mm, exactly what the RIP showed. Photoshop writes
// both headers, which is why a re-save from Photoshop «fixed» it.
//
// The first-pass file (Ghostscript's own JPEG writer) had JFIF and no EXIF, and opened right.
// So: after sharp hands us a JPEG, make sure a JFIF APP0 sits right after SOI with the dpi we
// meant. If one is already there, its density is overwritten; EXIF, ICC (APP2) and the image
// data are untouched. A reader that prefers EXIF still gets the same 300 dpi there.

const SOI = [0xff, 0xd8]

/** Return `buf` with a JFIF APP0 segment carrying `dpi` (units = dots per inch). Non-JPEG
 *  input is returned as is. */
export function ensureJfifDensity(buf: Buffer, dpi: number): Buffer {
  if (buf.length < 4 || buf[0] !== SOI[0] || buf[1] !== SOI[1]) return buf
  const d = Math.max(1, Math.min(65535, Math.round(dpi)))

  // Walk the marker segments that follow SOI until the scan starts.
  let pos = 2
  while (pos + 4 <= buf.length && buf[pos] === 0xff) {
    const marker = buf[pos + 1]
    if (marker === 0xda || marker === 0xd9) break // SOS / EOI: no headers past here
    if (marker >= 0xd0 && marker <= 0xd7) { pos += 2; continue } // RSTn: no length
    const len = buf.readUInt16BE(pos + 2)
    if (marker === 0xe0 && len >= 16 && buf.toString('latin1', pos + 4, pos + 9) === 'JFIF\0') {
      const out = Buffer.from(buf)
      out[pos + 11] = 1 // units: dots per inch
      out.writeUInt16BE(d, pos + 12)
      out.writeUInt16BE(d, pos + 14)
      return out
    }
    pos += 2 + len
  }

  // No JFIF at all: insert one right after SOI (readers accept APP0 before APP1 — Photoshop
  // writes them in that order).
  const app0 = Buffer.alloc(18)
  app0[0] = 0xff; app0[1] = 0xe0
  app0.writeUInt16BE(16, 2)               // segment length (excluding the marker)
  app0.write('JFIF\0', 4, 'latin1')
  app0[9] = 1; app0[10] = 1                // JFIF 1.1
  app0[11] = 1                             // units: dots per inch
  app0.writeUInt16BE(d, 12)                // X density
  app0.writeUInt16BE(d, 14)                // Y density
  app0[16] = 0; app0[17] = 0               // no thumbnail
  return Buffer.concat([buf.subarray(0, 2), app0, buf.subarray(2)])
}

/** What every JPEG written by the convert engine has to pass through. */
export function readJfifDensity(buf: Buffer): { units: number; x: number; y: number } | null {
  const i = buf.indexOf(Buffer.from('JFIF\0', 'latin1'))
  if (i < 0 || i > 64) return null
  return { units: buf[i + 7], x: buf.readUInt16BE(i + 8), y: buf.readUInt16BE(i + 10) }
}
