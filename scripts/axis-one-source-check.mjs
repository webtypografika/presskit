/**
 * ONE SOURCE DECIDES WHICH WAY THE AXES RUN: THE MODEL'S ROW.
 *
 *     node scripts/axis-one-source-check.mjs
 *
 * 🔴 WHY THIS EXISTS, AND IT COST A RUN. On 09/10/2026 version 2.3.46 shipped the corrected quarter
 * turn on the D60's row. It changed nothing. A word the owner had typed into PressCal's machine card
 * while we were hunting a mirror was still on that card, PressCal wrote it into the handover file,
 * and the engine spread the file's word OVER the row. He installed, ran the test with a pen, and
 * said «δεν γύρισε 180, πάλι το ίδιο» — the fix was invisible, and nothing on any screen said that
 * his own stale setting had beaten the update. A second door was open too: a stored card in his
 * profile carries `swapInvertFromSheet`, which MIRRORS, and `buildPlan` lets a passed-in card beat
 * the file.
 *
 * So the rule is now structural — the row wins, always — and these are the checks that keep it:
 *
 *   1. no row we drive may carry a MIRRORING convention unless it is named below WITH a reason
 *   2. an exemption that no longer mirrors is a stale comment, and fails too
 *   3. the engine must not take an axis convention from a file or from a stored card
 *
 * CONNECTS TO NOTHING. Reads the table, measures it, and reads the engine's source.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mmToMachine, SKYCUT_MACHINE_PRESETS } from '../src/main/skycut-protocol.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Rows allowed to carry a mirroring convention, each with the reason it is still there. */
const MIRRORING_ALLOWED = {
  'skycut-d24': 'nobody has ever run a D24 — the researched value is kept, and its own comment in '
    + 'skycut-protocol.ts says in so many words that it mirrors. The day one is run it is measured.',
}

let failed = 0
const fail = (msg) => { failed++; console.log('  ✗ ' + msg) }
const pass = (msg) => console.log('  ✓ ' + msg)

/* ─── 1 & 2. the table, measured rather than read ───────────────────────────── */
/* Three points that turn one way on the sheet. A transform that preserves handedness leaves them
   turning the same way; a mirror reverses it. The signed area is the measurement, and the SIGN IS
   COMPARED WITH THE SHEET'S OWN — not assumed positive, which would make this depend on the order
   the three points happen to be written in. */
const A = { x: 10, y: 10 }, B = { x: 110, y: 10 }, C = { x: 10, y: 60 }
const FRAME = { w: 487, h: 330 }
const signedArea = (p, q, r) => ((q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y)) / 2
const SHEET_TURN = signedArea(A, B, C)

/** The three points after one row's transform — with every coordinate checked for being a NUMBER.
 *  ⚠️ THIS GUARD IS NOT DECORATION. The first draft of this script called `mmToMachine(x, y, …)`
 *  when it takes `({x, y}, …)`, so every coordinate came back NaN, `NaN < 0` was false, and the
 *  script cheerfully reported that nothing mirrors — including the row that does. A check that
 *  cannot fail is worse than no check. */
const turnedTriangle = (row) => {
  const pts = [A, B, C].map((p) => mmToMachine(p, { axisConvention: row.axisConvention, unitsPerMm: row.unitsPerMm }, FRAME))
  for (const q of pts) {
    if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) {
      throw new Error(`the transform returned a non-number for ${row.id} — this script is calling it wrong: ${JSON.stringify(q)}`)
    }
  }
  return signedArea(pts[0], pts[1], pts[2])
}

console.log('')
console.log('the model rows, and which of them mirror')
for (const row of SKYCUT_MACHINE_PRESETS) {
  const mirrors = Math.sign(turnedTriangle(row)) !== Math.sign(SHEET_TURN)
  const reason = MIRRORING_ALLOWED[row.id]
  if (mirrors && !reason) {
    fail(`${row.id} (${row.label}) carries ${row.axisConvention}, which MIRRORS — every cut of an `
      + 'asymmetric shape comes out reversed. Measure it, or name the row in MIRRORING_ALLOWED with '
      + 'the reason it may stay.')
  } else if (mirrors) {
    pass(`${row.id} mirrors, and is allowed to: ${reason.slice(0, 60)}…`)
  } else if (reason) {
    fail(`${row.id} is listed in MIRRORING_ALLOWED but does NOT mirror any more — the exemption is a `
      + 'stale comment. Remove the row from that list.')
  } else {
    pass(`${row.id} (${row.label}) turns without mirroring — ${row.axisConvention}`)
  }
}

/* ─── 3. the engine takes the turn from the row, from nowhere else ──────────── */
console.log('\nthe engine asks the row, not the message')
const engine = readFileSync(join(ROOT, 'src/main/skycut-engine.ts'), 'utf8')

if (engine.includes('{ axisConvention: block.axisConvention }')) {
  fail("the file's axis convention is spread over the preset again in `machineFromFile` — that is "
    + 'exactly the line that made 2.3.46 invisible.')
} else pass('no file-supplied convention is spread over the row')

if (/axisConvention\s*=\s*modelRow\.axisConvention/.test(engine)) {
  pass('`coerceRecord` takes the convention from the model row')
} else {
  fail('`coerceRecord` no longer takes the convention from the model row — a stored card can mirror '
    + 'the job again, and there is one on this disk that would.')
}

/* A disagreement must be reported, not swallowed: his own active card disagrees right now. */
if (/console\.warn\([\s\S]{0,400}axisConvention/.test(engine)) {
  pass('a card that disagrees with its row is logged')
} else {
  fail('nothing logs a card whose convention disagrees with its row — the disagreement is then '
    + 'invisible, which is the shape of the original defect.')
}

/* The old gate must survive for a model with no row: there is nothing better to trust there, and
   every default this file ever carried was one of the two that mirror. */
if (engine.includes("'axisConventionUnknown'")) {
  pass('a model with no row still refuses an unknown convention BY NAME')
} else {
  fail('the by-name refusal for an unknown convention is gone — an unreadable word would inherit a '
    + 'default, and the defaults mirror.')
}

console.log(failed === 0
  ? '\nALL CHECKS PASSED — the row decides, and no row we drive mirrors.\n'
  : `\n${failed} CHECK(S) FAILED.\n`)
process.exit(failed === 0 ? 0 : 1)
