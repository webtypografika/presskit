// Reproduces QT-2026-0477 (19/10/2026) and proves the fix, on the real first-pass file:
//   1. sharp resize + withMetadata({density}) + jpeg  → JPEG with EXIF and NO JFIF (the bug)
//   2. ensureJfifDensity(...)                          → JFIF 300 dpi present, image intact
// Run from the PressKit repo:  npx tsx scripts/verify-jfif.ts
import sharp from 'sharp'
import { readFileSync, writeFileSync } from 'fs'
import { ensureJfifDensity, readJfifDensity } from '../src/main/jpeg-jfif'

const src = 'C:/Users/info/Dropbox/Prints/Presscal prints/[QT-2026-0477] Artemis Alexopoulou - 401_Afisa_GR_0930.pdf/401_Afisa_GR_0930_converted.jpg'
const dpi = 300
const mmAt = (px: number, d: number) => +(px / d * 25.4).toFixed(1)

async function main() {
  const raw = await sharp(readFileSync(src)).resize(5906, 8345, { fit: 'inside' }).withMetadata({ density: dpi }).jpeg({ quality: 95 }).toBuffer()
  const before = readJfifDensity(raw)
  const fixed = ensureJfifDensity(raw, dpi)
  const after = readJfifDensity(fixed)
  const m = await sharp(fixed).metadata()
  const out = process.env.TEMP + '/verify-jfif.jpg'
  writeFileSync(out, fixed)
  console.log(JSON.stringify({
    beforeJfif: before, afterJfif: after,
    decodes: { w: m.width, h: m.height, density: m.density, space: m.space, hasProfile: m.hasProfile, exif: !!m.exif },
    sizeIfJfifMissing_720dpi: `${mmAt(m.width!, 720)}×${mmAt(m.height!, 720)} mm`,
    sizeWithJfif_300dpi: `${mmAt(m.width!, after!.x)}×${mmAt(m.height!, after!.y)} mm`,
    bytesAdded: fixed.length - raw.length, out,
  }, null, 2))
  if (before !== null) throw new Error('expected the bug: no JFIF before the fix')
  if (!after || after.units !== 1 || after.x !== dpi || after.y !== dpi) throw new Error('JFIF not written')
  if (m.width !== 5906 || m.density !== dpi || !m.hasProfile) throw new Error('image changed')
  // Idempotent: a second pass only rewrites the density
  if (ensureJfifDensity(fixed, dpi).length !== fixed.length) throw new Error('not idempotent')
  console.log('OK')
}
main().catch(e => { console.error(e); process.exit(1) })
