// Mirror of quoteKeyOf() in src/renderer/src/App.tsx, checked against George's example
// (19/10/2026): a deep link into any folder of [QT-2026-0325] — live, subfolder, or under
// _01 Archive — must land in the tab already on that quote, not open a new one.
// Run: node scripts/verify-quote-folder.mjs
function quoteKeyOf(path) {
  const m = path.match(/\[(QT)[- ](\d{4})[- ](\d{4})\]/i)
  return m ? `${m[1]}-${m[2]}-${m[3]}`.toLowerCase() : null
}
const root = 'C:\\Users\\info\\Documents\\eu presscal prints\\[QT-2026-0325] Πελάτης - Προσφορά για εκτύπωση'
const sub = root + '\\02_proofs\\final\\'
const archive = 'C:\\Users\\info\\Documents\\eu presscal prints\\_01 Archive\\[QT-2026-0325] Πελάτης - Προσφορά για εκτύπωση\\01_2026-10-09'
const spaced = 'D:\\prints\\[QT 2026 0325] old style'
const other = 'C:\\Users\\info\\Documents\\eu presscal prints\\[QT-2026-0326] Άλλος'
const plain = 'C:\\Users\\info\\Documents'
const r = { root: quoteKeyOf(root), sub: quoteKeyOf(sub), archive: quoteKeyOf(archive), spaced: quoteKeyOf(spaced), other: quoteKeyOf(other), plain: quoteKeyOf(plain) }
console.log(r)
const fail = (m) => { console.error('FAIL: ' + m); process.exit(1) }
if (r.root !== 'qt-2026-0325') fail('root key')
if (r.sub !== r.root) fail('a subfolder of the quote must group with its root')
if (r.archive !== r.root) fail('the archived copy of the same quote must group with it')
if (r.spaced !== r.root) fail('the old [QT 2026 0325] spelling must group too')
if (r.root === r.other) fail('two quotes must not group')
if (r.plain !== null) fail('a path with no [QT-…] must not group')
console.log('OK')
