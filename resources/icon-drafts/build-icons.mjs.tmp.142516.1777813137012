import sharp from 'sharp'
import { writeFileSync } from 'fs'
import pngToIco from 'png-to-ico'

const SRC = 'C:/Users/info/Documents/Dropbox/PressCal my files/logo/new logo/1x/1024.png'
const OUT_DIR = 'C:/Users/info/documents/dropbox/presscal-filehelper/resources'

async function main() {
  // 1) Master icon.png at 1024 (electron-builder uses this for Linux + macOS fallback)
  await sharp(SRC)
    .resize(1024, 1024, { kernel: sharp.kernel.lanczos3, fit: 'contain' })
    .png({ compressionLevel: 9 })
    .toFile(`${OUT_DIR}/icon.png`)
  console.log('✓ icon.png (1024x1024)')

  // 2) Generate per-size PNG buffers for ICO bundling.
  //    Small sizes (16/32) get a center-crop zoom so the horse stays readable
  //    in the taskbar. Larger sizes keep the full circle composition.
  const sizes = [16, 32, 48, 64, 128, 256]
  const meta = await sharp(SRC).metadata()
  const cropSide = Math.round(meta.width * 0.68) // 68% center crop = drops the outer ring
  const cropOffset = Math.round((meta.width - cropSide) / 2)
  const buffers = []
  for (const size of sizes) {
    const useCrop = size <= 32
    const pipeline = useCrop
      ? sharp(SRC).extract({ left: cropOffset, top: cropOffset, width: cropSide, height: cropSide })
      : sharp(SRC)
    const buf = await pipeline
      .resize(size, size, { kernel: sharp.kernel.lanczos3, fit: 'contain' })
      .png()
      .toBuffer()
    buffers.push(buf)
    writeFileSync(`${OUT_DIR}/icon-drafts/rhino-${size}.png`, buf)
  }
  console.log(`✓ ${sizes.length} per-size PNGs (preview in icon-drafts/)`)

  // 3) Bundle into multi-resolution .ico
  const icoBuffer = await pngToIco(buffers)
  writeFileSync(`${OUT_DIR}/icon.ico`, icoBuffer)
  console.log(`✓ icon.ico (${(icoBuffer.length / 1024).toFixed(1)} KB, sizes: ${sizes.join(',')})`)
}

main().catch(e => { console.error(e); process.exit(1) })
