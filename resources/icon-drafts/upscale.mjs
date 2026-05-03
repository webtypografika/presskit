import sharp from 'sharp'
import { copyFileSync } from 'fs'
import { resolve } from 'path'

const SRC = 'C:/Users/info/Documents/Dropbox/PressCal my files/logo/new logo/1x/Artboard 2.png'
const OUT_DIR = 'C:/Users/info/documents/dropbox/presscal-filehelper/resources'

async function main() {
  // Backup old icon
  copyFileSync(`${OUT_DIR}/icon.png`, `${OUT_DIR}/icon-drafts/icon-original-PK.png`)
  console.log('Backed up old PK icon')

  // Upscale to 1024 with Lanczos3 (best for geometric)
  await sharp(SRC)
    .resize(1024, 1024, { kernel: sharp.kernel.lanczos3, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(`${OUT_DIR}/icon.png`)
  console.log('Wrote resources/icon.png (1024x1024)')

  // Also produce common sizes for inspection
  for (const size of [16, 32, 48, 64, 128, 256, 512]) {
    await sharp(SRC)
      .resize(size, size, { kernel: sharp.kernel.lanczos3, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toFile(`${OUT_DIR}/icon-drafts/icon-${size}.png`)
  }
  console.log('Wrote preview sizes 16/32/48/64/128/256/512 in icon-drafts/')
}

main().catch(e => { console.error(e); process.exit(1) })
