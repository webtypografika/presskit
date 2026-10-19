// One-off: write a copy of a JPEG with a JFIF density header, next to it.
//   npx tsx scripts/fix-jfif-file.ts "<file.jpg>" [dpi]
import { readFileSync, writeFileSync } from 'fs'
import { ensureJfifDensity, readJfifDensity } from '../src/main/jpeg-jfif'
const [, , file, dpiArg] = process.argv
if (!file) { console.error('usage: npx tsx scripts/fix-jfif-file.ts <file.jpg> [dpi]'); process.exit(1) }
const dpi = Number(dpiArg) || 300
const buf = readFileSync(file)
const out = file.replace(/\.jpe?g$/i, '') + `_${dpi}dpi.jpg`
writeFileSync(out, ensureJfifDensity(buf, dpi))
console.log(JSON.stringify({ in: file, before: readJfifDensity(buf), out, after: readJfifDensity(readFileSync(out)) }))
