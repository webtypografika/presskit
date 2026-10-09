/**
 * WHICH AXIS CONVENTIONS MIRROR THE JOB, AND WHICH ONLY TURN IT.
 *
 *     node scripts/axis-handedness-check.mjs
 *
 * 🔴 WHY THIS EXISTS, AND IT COST A REAL CUT. On 09/10/2026 the first live cut of an asymmetric
 * shape came out reversed: «άρχιζε να κόβει το κοπτικό λες και ήταν αντικριστό». The arithmetic had
 * been in the file all along — two of the three conventions had determinant −1, which flips
 * handedness — and nothing said so on screen, in a test, or in a comment. The only live test this
 * project had ever run drew a SQUARE, the one shape invariant under every one of them. It passed
 * and proved nothing.
 *
 * So handedness is measured here, from the transform itself, by walking a shape that has a
 * direction and checking which way it turns. CONNECTS TO NOTHING.
 *
 * A convention is only usable for print-and-cut if it does NOT mirror. The mirroring ones are kept
 * because a machine may genuinely want one — but the table below is what makes that a choice
 * instead of a surprise.
 */
import { mmToMachine, SKYCUT_AXIS_CONVENTIONS } from '../src/main/skycut-protocol.ts'

const SHEET = { w: 487, h: 330 }

/* Three points that turn ANTICLOCKWISE in the sheet's own frame. A transform that preserves
   handedness leaves them anticlockwise; a mirror makes them clockwise. The signed area of the
   triangle is the measurement — positive is anticlockwise. */
const A = { x: 10, y: 10 }
const B = { x: 110, y: 10 }
const C = { x: 10, y: 60 }

const signedArea = (p, q, r) => ((q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y)) / 2

const sheetTurn = signedArea(A, B, C)
console.log('\nIn the sheet frame the three points turn %s (signed area %s)',
  sheetTurn > 0 ? 'ANTICLOCKWISE' : 'CLOCKWISE', sheetTurn.toFixed(0))

console.log('\n%s  %s  %s', 'convention'.padEnd(22), 'handedness'.padEnd(12), 'usable for print-and-cut')
console.log('%s  %s  %s', '-'.repeat(22), '-'.repeat(12), '-'.repeat(24))

let mirrors = 0
let turns = 0
for (const axisConvention of SKYCUT_AXIS_CONVENTIONS) {
  /* Only the fields the transform reads. `unitsPerMm: 1` keeps the numbers readable; handedness
     cannot depend on a positive uniform scale. */
  const machine = { axisConvention, unitsPerMm: 1 }
  const a = mmToMachine(A, machine, SHEET)
  const b = mmToMachine(B, machine, SHEET)
  const c = mmToMachine(C, machine, SHEET)
  const after = signedArea(a, b, c)
  const mirrored = Math.sign(after) !== Math.sign(sheetTurn)
  if (mirrored) mirrors++
  else turns++
  console.log('%s  %s  %s',
    axisConvention.padEnd(22),
    (mirrored ? 'MIRRORS' : 'turns only').padEnd(12),
    mirrored ? 'NO - an asymmetric shape comes out reversed' : 'yes')
}

console.log('\n%d of %d conventions mirror the job.', mirrors, SKYCUT_AXIS_CONVENTIONS.length)

/* 🔴 THE ASSERTION THAT WOULD HAVE CAUGHT 09/10/2026: at least one convention must both SWAP the
   axes and preserve handedness. Before that date none did — the two that swapped both mirrored,
   and the only one that preserved handedness did not swap — so a plotter whose axes run across the
   material had no correct setting available at all, and no amount of choosing could have helped. */
const swapped = SKYCUT_AXIS_CONVENTIONS.filter((axisConvention) => {
  const machine = { axisConvention, unitsPerMm: 1 }
  const a = mmToMachine(A, machine, SHEET)
  const b = mmToMachine(B, machine, SHEET)
  /* A→B runs along x in the sheet frame. If it runs along y afterwards, the axes were swapped. */
  return Math.abs(b.y - a.y) > Math.abs(b.x - a.x)
})
const swappedAndUpright = swapped.filter((axisConvention) => {
  const machine = { axisConvention, unitsPerMm: 1 }
  const a = mmToMachine(A, machine, SHEET)
  const b = mmToMachine(B, machine, SHEET)
  const c = mmToMachine(C, machine, SHEET)
  return Math.sign(signedArea(a, b, c)) === Math.sign(sheetTurn)
})

console.log('swap the axes          : %s', swapped.join(', ') || '(none)')
console.log('swap AND do not mirror : %s', swappedAndUpright.join(', ') || '(NONE - this is the 09/10 bug)')

if (swappedAndUpright.length === 0) {
  console.log('\nFAILED: a machine whose axes run across the material has no correct setting.\n')
  process.exit(1)
}
/* 🔴 AND WHERE THE MACHINE'S ZERO IS, FOR EACH — derived from the transform, which is exactly what
   a hand-written switch got wrong the day the two new conventions were added: both fell through to
   a default that said "bottom-left", which is true for neither. A park in the wrong corner does not
   misplace a cut — every point carries its own absolute coordinates — but it orders the contours by
   nonsense distances and misreports the travel and the time. */
console.log('\n%s  %s', 'convention'.padEnd(22), 'machine (0,0) is this corner of the frame')
console.log('%s  %s', '-'.repeat(22), '-'.repeat(42))
let parkFailures = 0
for (const axisConvention of SKYCUT_AXIS_CONVENTIONS) {
  const machine = { axisConvention, unitsPerMm: 1 }
  const corners = [{ x: 0, y: 0 }, { x: SHEET.w, y: 0 }, { x: 0, y: SHEET.h }, { x: SHEET.w, y: SHEET.h }]
  const park = corners.find((c) => {
    const m = mmToMachine(c, machine, SHEET)
    return m.x === 0 && m.y === 0
  })
  if (!park) { parkFailures++; console.log('%s  NONE — not corner to corner', axisConvention.padEnd(22)); continue }
  console.log('%s  %s-%s', axisConvention.padEnd(22), park.x === 0 ? 'left' : 'right', park.y === 0 ? 'bottom' : 'top')
}
if (parkFailures > 0) {
  console.log('\nFAILED: a convention has no corner at the machine origin.\n')
  process.exit(1)
}

console.log('\nOK: %d swapped convention(s) available that do not mirror, and every one has a park corner.\n',
  swappedAndUpright.length)
