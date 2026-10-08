/**
 * Exercise src/main/skycut-protocol.ts and print what it produces, for
 * inspection by eye. CONNECTS TO NOTHING — there is no socket in this file and
 * no address anywhere in it. Run it with:
 *
 *     node scripts/skycut-dry-run.mjs
 *
 * Node 24 strips the types out of the imported .ts file by itself, so there is
 * nothing to build and no test framework to install. It prints one harmless
 * notice about the package having no `"type": "module"`; silence it with
 * `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON` if it gets in the way. Do NOT
 * add `"type": "module"` to package.json to quiet it — that is the Electron
 * build's business, not this script's.
 *
 * This repo has no test runner (see package.json: no vitest, no jest), and one
 * was not added for this. So the module's behaviour is demonstrated here
 * instead: the good case, the scale and transform checks with numbers that can
 * be verified with a calculator, and every refusal path, each printed with the
 * code it returns.
 *
 * THE FIXTURE IS QUOTE 446, BY HAND. PressCal does not write `.cut.json` yet —
 * that side comes next — so the handover file below was written against the
 * agreed shape using the real numbers of that job: a 330 × 487 sheet, two
 * 150 × 155 mm pieces with 3 mm bleed, and a heart contour measuring
 * 139,01 × 143,38 mm with a cut length of 439,42 mm. The heart is six cubics,
 * fitted so its bounding box and its length are exactly those measurements,
 * which is what makes the flattening numbers below meaningful rather than
 * decorative.
 */
import {
  parseCutFile,
  planSkycutJob,
  emitSkycutStream,
  describeSkycutPlan,
  mmToMachine,
  flatteningToleranceMm,
  flattenContourMm,
  SKYCUT_MACHINE_PRESETS,
  SKYCUT_EMIT_MODES,
  SKYCUT_DRY_RUN_MODE,
} from '../src/main/skycut-protocol.ts'

const D60 = SKYCUT_MACHINE_PRESETS.find((m) => m.id === 'skycut-d60')
const D24 = SKYCUT_MACHINE_PRESETS.find((m) => m.id === 'skycut-d24')

/* The heart on the left-hand piece: trim 15..165 mm across, 166..321 mm up the
   sheet, shape centred in it. Numbers in millimetres, sheet bottom-left frame,
   exactly as PressCal's own cut geometry is held. */
const HEART_LEFT = {
  closed: true,
  start: { x: 90, y: 171.81 },
  segments: [
    { kind: 'cubic', c1: { x: 62.307, y: 202.232 }, c2: { x: 39.139, y: 236.021 }, to: { x: 20.495, y: 273.176 } },
    { kind: 'cubic', c1: { x: 20.495, y: 298.517 }, c2: { x: 39.956, y: 315.17 }, to: { x: 58.723, y: 315.17 } },
    { kind: 'cubic', c1: { x: 76.099, y: 315.17 }, c2: { x: 86.525, y: 315.888 }, to: { x: 90, y: 308.647 } },
    { kind: 'cubic', c1: { x: 93.475, y: 315.888 }, c2: { x: 103.901, y: 315.17 }, to: { x: 121.277, y: 315.17 } },
    { kind: 'cubic', c1: { x: 140.044, y: 315.17 }, c2: { x: 159.505, y: 298.517 }, to: { x: 159.505, y: 273.176 } },
    { kind: 'cubic', c1: { x: 140.861, y: 236.021 }, c2: { x: 117.693, y: 202.232 }, to: { x: 90, y: 171.81 } },
  ],
  lengthMm: 439.42,
}

/* The same heart on the right-hand piece, 150 mm across. */
const HEART_RIGHT = {
  closed: true,
  start: { x: 240, y: 171.81 },
  segments: HEART_LEFT.segments.map((s) => ({
    kind: 'cubic',
    c1: { x: s.c1.x + 150, y: s.c1.y },
    c2: { x: s.c2.x + 150, y: s.c2.y },
    to: { x: s.to.x + 150, y: s.to.y },
  })),
  lengthMm: 439.42,
}

const FIXTURE_446 = {
  format: 'presscal-cut',
  formatVersion: 1,
  units: 'mm',
  frame: 'sheet-bottom-left-mm',
  job: {
    quoteNumber: 'QT-2026-0446',
    quoteId: 'fixture-446',
    title: 'Amita Antetokounmpo Sendout - Heart',
    printedPdf: 'Amita_Antetokounmpo Sendout_Heart Print.pdf',
    cutPdf: 'Amita_Antetokounmpo Sendout_Heart Print.cut.pdf',
  },
  sheet: { w: 330, h: 487 },
  loading: { feedEdge: 'bottom', sideUp: 'front', mirrored: false },
  marks: {
    kind: 'L-corners',
    scanRect: { x: 6, y: 32, w: 318, h: 450 },
    armMm: 20,
    thicknessMm: 0.5,
  },
  groups: [
    { group: 'CutContour', perforation: false, contours: [HEART_LEFT, HEART_RIGHT] },
  ],
  totals: { cutLengthMm: 878.84, lifts: 2, contours: 2 },
  notes: ['hand-written fixture, quote 446 numbers'],
}

const clone = (v) => JSON.parse(JSON.stringify(v))
const rule = (t) => console.log('\n' + '─'.repeat(78) + '\n' + t + '\n' + '─'.repeat(78))

// ─── 1. The scale and the transform, in numbers anybody can check ───────────

rule('1. SCALE AND TRANSFORM')

/* The measured fact: 2000 machine units came out as 50 mm on his D60. */
const fifty = mmToMachine({ x: 0, y: 50 }, { ...D60, axisConvention: 'direct' }, { w: 330, h: 487 })
console.log(`50 mm at 40 units/mm        -> ${fifty.y} units   (measured on the D60: 2000 = 50 mm)`)

const sheet = { w: 330, h: 487 }
const corner = mmToMachine({ x: 0, y: 0 }, D60, sheet)
const far = mmToMachine({ x: 330, y: 487 }, D60, sheet)
const pt = mmToMachine({ x: 90, y: 171.81 }, D60, sheet)
console.log(`sheet bottom-left (0,0)     -> U${corner.x},${corner.y}      x = (487-0)*40, y = (330-0)*40`)
console.log(`sheet top-right (330,487)   -> U${far.x},${far.y}            the machine's own origin`)
console.log(`heart tip (90, 171.81)      -> U${pt.x},${pt.y}      x = (487-171.81)*40, y = (330-90)*40`)
console.log(`same point, 20 units/mm     -> ` + JSON.stringify(mmToMachine({ x: 90, y: 171.81 }, { ...D60, unitsPerMm: 20 }, sheet)))

// ─── 2. Flattening at the machine's own step ────────────────────────────────

rule('2. FLATTENING')

for (const upm of [40, 20, 10]) {
  const m = { ...D60, unitsPerMm: upm }
  const tol = flatteningToleranceMm(m)
  const pts = flattenContourMm(HEART_LEFT, tol)
  let len = 0
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  console.log(
    `${String(upm).padStart(2)} units/mm  tolerance ${tol.toFixed(4)} mm  ->  ${String(pts.length).padStart(4)} points` +
      `   flattened length ${len.toFixed(3)} mm   (exact ${HEART_LEFT.lengthMm} mm, short by ${(HEART_LEFT.lengthMm - len).toFixed(3)} mm)`,
  )
}

// ─── 3. The 446 fixture, end to end ────────────────────────────────────────

rule('3. QUOTE 446, CUT MODE, D60')

const parsed = parseCutFile(FIXTURE_446)
if (!parsed.ok) {
  console.log('REFUSED:', parsed.refusals)
  process.exit(1)
}

const planned = planSkycutJob(parsed.file, { ...D60, speedVs: 6 }, { mode: 'cut', bladeConfirmed: true })
if (!planned.ok) {
  console.log('REFUSED:', planned.refusals)
  process.exit(1)
}
const plan = planned.plan
console.log(describeSkycutPlan(plan).join('\n'))
console.log('\nnotes: ' + (plan.notes.map((n) => n.code + (n.detail ? ` (${n.detail})` : '')).join(', ') || 'none'))
console.log(`tolerance: ${plan.toleranceMm} mm    points on the wire: ${plan.pointCount}`)
console.log('per contour: ' + plan.contours.map((c) => `${c.group} #${c.index} ${c.cutLengthMm} mm, travel in ${c.travelInMm} mm`).join(' | '))

const emitted = emitSkycutStream(plan)
if (!emitted.ok) {
  console.log('REFUSED:', emitted.refusals)
  process.exit(1)
}
const stream = emitted.stream
console.log(`\nstream: ${stream.commands.length} commands, ${stream.byteLength} bytes, ${stream.chunks.length} chunks of <= ${plan.machine.chunkBytes}`)
console.log(`pacing: ${plan.machine.chunkPauseMs} ms between chunks -> ${((stream.chunks.length - 1) * plan.machine.chunkPauseMs / 1000).toFixed(1)} s of pauses`)
console.log('\nfirst 40 commands:')
stream.commands.slice(0, 40).forEach((c, i) => console.log(`  ${String(i + 1).padStart(3)}  ${c}`))
console.log('\nlast 4 commands:')
stream.commands.slice(-4).forEach((c) => console.log(`       ${c}`))
console.log('\nchunk boundaries (no command is ever split):')
stream.chunks.forEach((c, i) =>
  console.log(`  chunk ${i + 1}: ${String(c.text.length).padStart(4)} bytes, ends "${c.text.slice(-12)}", pause ${c.pauseMsAfter} ms`),
)

// ─── 4. Travel-only: the knife never comes down ────────────────────────────

rule('4. THE DRY RUN (nothing comes down, whatever is in the head)')

const dry = planSkycutJob(parsed.file, D60, { mode: SKYCUT_DRY_RUN_MODE })
const dryStream = dry.ok ? emitSkycutStream(dry.plan) : null
if (dryStream && dryStream.ok) {
  const ds = dryStream.stream
  console.log(`commands: ${ds.commands.length}`)
  console.log(`D commands in the stream: ${ds.commands.filter((c) => c.startsWith('D')).length}   <- must be 0`)
  console.log(`U commands in the stream: ${ds.commands.filter((c) => c.startsWith('U')).length}`)
  console.log('first 6: ' + ds.commands.slice(0, 6).join(' '))
  console.log('mode line: ' + describeSkycutPlan(dry.plan).slice(-1)[0])
}

// ─── 5. The D24 profile: a different mark opcode, same geometry ─────────────

rule('5. THE SAME JOB ON THE D24 PROFILE')

const d24 = planSkycutJob(parsed.file, D24, { mode: 'travelOnly' })
if (d24.ok) {
  const s = emitSkycutStream(d24.plan)
  console.log('mark scan: ' + JSON.stringify(d24.plan.markScan))
  console.log('first 4 commands: ' + (s.ok ? s.stream.commands.slice(0, 4).join(' ') : ''))
  console.log('notes: ' + d24.plan.notes.map((n) => n.code).join(', '))
}

// ─── 6. Every refusal path ─────────────────────────────────────────────────

rule('6. REFUSALS')

const show = (label, res) => {
  const codes = res.ok ? 'ACCEPTED' : res.refusals.map((r) => r.code + (r.detail ? ` (${r.detail})` : '')).join(', ')
  console.log(`  ${label.padEnd(42)} ${codes}`)
}

show('unknown format', parseCutFile({ ...clone(FIXTURE_446), format: 'acme-cut' }))
show('future formatVersion', parseCutFile({ ...clone(FIXTURE_446), formatVersion: 2 }))
show('inches', parseCutFile({ ...clone(FIXTURE_446), units: 'in' }))
show('wrong frame', parseCutFile({ ...clone(FIXTURE_446), frame: 'page-top-left-mm' }))
show('not an object', parseCutFile('a string'))
show('no sheet', parseCutFile({ ...clone(FIXTURE_446), sheet: undefined }))
show('no loading block', parseCutFile({ ...clone(FIXTURE_446), loading: undefined }))

const noFeed = clone(FIXTURE_446)
delete noFeed.loading.feedEdge
show('loading without feedEdge', parseCutFile(noFeed))

const noSide = clone(FIXTURE_446)
delete noSide.loading.sideUp
show('loading without sideUp', parseCutFile(noSide))

const noMir = clone(FIXTURE_446)
delete noMir.loading.mirrored
show('loading without mirrored', parseCutFile(noMir))

const mirrored = clone(FIXTURE_446)
mirrored.loading.mirrored = true
show('mirrored load', parseCutFile(mirrored))

const topFeed = clone(FIXTURE_446)
topFeed.loading.feedEdge = 'top'
show('fed from the top edge', parseCutFile(topFeed))

const sideways = clone(FIXTURE_446)
sideways.loading.feedEdge = 'sideways'
show('feedEdge nobody recognises', parseCutFile(sideways))

const empty = clone(FIXTURE_446)
empty.groups = [{ group: 'CutContour', perforation: false, contours: [] }]
show('no contours', parseCutFile(empty))

const perf = clone(FIXTURE_446)
perf.groups.push({ group: 'PerfCutContour', perforation: true, contours: [clone(HEART_LEFT)] })
show('a perforation group', parseCutFile(perf))

const badSeg = clone(FIXTURE_446)
badSeg.groups[0].contours[0].segments[2] = { kind: 'arc', to: { x: 1, y: 1 } }
show('a segment we do not know', parseCutFile(badSeg))

const badMarks = clone(FIXTURE_446)
badMarks.marks.scanRect = { x: 0, y: 0, w: 0, h: 0 }
show('marks with an empty scanRect', parseCutFile(badMarks))

const noMarks = clone(FIXTURE_446)
delete noMarks.marks
const noMarksPlan = planSkycutJob(parseCutFile(noMarks).file, D60, { mode: 'travelOnly' })
console.log(`  ${'no marks at all (allowed, noted)'.padEnd(42)} ${noMarksPlan.ok ? noMarksPlan.plan.notes.map((n) => n.code).join(', ') : ''}`)

const off = clone(FIXTURE_446)
off.sheet = { w: 150, h: 200 }
show('geometry off the sheet', planSkycutJob(parseCutFile(off).file, D60, { mode: 'travelOnly' }))

show('cut mode, blade not confirmed', planSkycutJob(parsed.file, D60, { mode: 'cut' }))
show('cut mode, blade confirmed', planSkycutJob(parsed.file, D60, { mode: 'cut', bladeConfirmed: true }))

show('machine with 0 units/mm', planSkycutJob(parsed.file, { ...D60, unitsPerMm: 0 }, { mode: 'travelOnly' }))
show('machine with a typo opcode', planSkycutJob(parsed.file, { ...D60, markScanOpcode: 'TB2S' }, { mode: 'travelOnly' }))
show('speed out of range', planSkycutJob(parsed.file, { ...D60, speedVs: 40 }, { mode: 'travelOnly' }))
show(
  'footprint past the machine limit',
  planSkycutJob(parsed.file, { ...D60, maxMaterialMm: { w: 200, h: 200 } }, { mode: 'travelOnly' }),
)
show(
  'footprint inside the machine limit',
  planSkycutJob(parsed.file, { ...D60, maxMaterialMm: { w: 600, h: 600 } }, { mode: 'travelOnly' }),
)

// ─── 7. Safety rule 1, as a property of the emitted bytes ──────────────────

rule('7. NO FORCE OR PRESSURE COMMAND, ANYWHERE')

const forceish = /(^|[^A-Z])(FS|!FS|FC|BF)/
console.log(`force-like command in the 446 stream: ${forceish.test(stream.text) ? 'FOUND - STOP' : 'none'}`)
console.log(`the word "pressure"/"force" as a field: none - the SkycutMachine type has no such field`)
console.log(`opcodes used: ${[...new Set(stream.commands.map((c) => c.replace(/[-0-9,;].*$/, '') || c[0]))].join(' ')}`)

rule('8. THE PEN PASS IS A HEAD-DOWN RUN AND IS GATED LIKE ONE')

show('pen pass, nothing confirmed', planSkycutJob(parsed.file, D60, { mode: 'penDown' }))
show('pen pass, head confirmed', planSkycutJob(parsed.file, D60, { mode: 'penDown', bladeConfirmed: true }))
show('dry run, nothing confirmed', planSkycutJob(parsed.file, D60, { mode: SKYCUT_DRY_RUN_MODE }))
show('a mode nobody declared', planSkycutJob(parsed.file, D60, { mode: 'penDraw', bladeConfirmed: true }))

// ─── 9. 🔴 THE PIN: the dry run emits no head-down command ──────────────────

/*
 * WHY THIS IS AN ASSERTION AND NOT A PRINTOUT. Until 08/10/2026 `penDraw` was
 * offered on the tab as "Dry run - pen" and emitted a stream BYTE-FOR-BYTE
 * IDENTICAL to `cut`: 272 `D` commands on this very fixture. Nothing in this
 * script failed, because nothing in this script asserted. So the one property
 * that makes a dry run a dry run — not one head-down command in the bytes — is
 * checked here, for every mode, against the mode's own declared `headDown`, and
 * this script EXITS NON-ZERO if it does not hold.
 *
 * It also asserts the other half: that the word "dry run" is attached to a mode
 * whose spec says the head stays up. A rename that made a head-down mode the dry
 * run again would fail here rather than on a sheet.
 */
rule('9. EVERY MODE, MEASURED — AND THE DRY RUN PINNED')

let failures = 0
const check = (ok, text, detail) => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}   ${text}${detail ? `   ${detail}` : ''}`)
  if (!ok) failures++
}

const streamsByMode = {}
for (const mode of Object.keys(SKYCUT_EMIT_MODES)) {
  /* `bladeConfirmed` is passed for every mode so the COUNTS are comparable;
     whether a mode needs it is asserted separately above. */
  const p = planSkycutJob(parsed.file, D60, { mode, bladeConfirmed: true })
  if (!p.ok) {
    check(false, `${mode}: planned`, p.refusals.map((r) => r.code).join(', '))
    continue
  }
  const s = emitSkycutStream(p.plan)
  if (!s.ok) {
    check(false, `${mode}: emitted`, s.refusals.map((r) => r.code).join(', '))
    continue
  }
  const down = s.stream.commands.filter((c) => c.startsWith('D')).length
  const up = s.stream.commands.filter((c) => c.startsWith('U')).length
  const spec = SKYCUT_EMIT_MODES[mode]
  streamsByMode[mode] = s.stream.text
  console.log(
    `  mode ${mode.padEnd(11)} headDown ${String(spec.headDown).padEnd(5)}` +
      ` -> ${String(down).padStart(4)} head-down (D) + ${String(up).padStart(4)} head-up (U)   ${s.stream.byteLength} bytes`,
  )
  if (spec.headDown) {
    check(down > 0, `${mode} declares headDown and emits head-down commands`, `${down} D`)
  } else {
    /* 🔴 THE ONE THAT MATTERS. */
    check(down === 0, `🔴 ${mode} declares headDown false and emits NOT ONE head-down command`, `${down} D`)
    check(up > 0, `${mode} still traces the job head-up`, `${up} U`)
  }
}

/* The dry run against the cut, which is the comparison the defect hid in. */
const dryText = streamsByMode[SKYCUT_DRY_RUN_MODE]
const cutText = streamsByMode['cut']
check(
  SKYCUT_EMIT_MODES[SKYCUT_DRY_RUN_MODE].headDown === false,
  `🔴 the mode called the dry run (${SKYCUT_DRY_RUN_MODE}) is declared head-up`,
)
check(!/(^|;)D/.test(dryText ?? 'D'), '🔴 the dry run bytes contain no D command at all')
check(dryText !== cutText, '🔴 the dry run is NOT byte-identical to the cut')
check(
  streamsByMode['penDown'] === cutText,
  'the pen pass IS byte-identical to the cut - stated, not hidden: the machine cannot tell a pen from a knife',
)

/* And the guard itself: a plan whose mode says head-up, handed contours that
   were emitted head-down, must be refused rather than shipped. Reached by
   emitting from a plan with the mode swapped after the fact, which is exactly
   what a future edit to the emitter would look like. */
const cutPlan = planSkycutJob(parsed.file, D60, { mode: 'cut', bladeConfirmed: true })
const bogus = emitSkycutStream({ ...cutPlan.plan, mode: 'penDraw' })
check(
  !bogus.ok && bogus.refusals[0]?.code === 'emitModeUnknown',
  'an undeclared mode gets no stream at all',
  bogus.ok ? 'IT EMITTED' : bogus.refusals[0].code,
)

// ─── 10. The mark rectangle: its size is sent, its position is SAID ────────

/*
 * 🔴 THE GAP THIS SECTION EXISTS FOR, FIXED 08/10/2026. `marks.scanRect.x` and
 * `.y` were validated by the parser, stored on the file, and then never read by
 * anything: the emitter used only `.w` and `.h`. The handover file says where
 * the rectangle sits on the sheet — 6, 32 mm in this fixture — and that was
 * thrown away.
 *
 * The resolution, and why it is not "use it in the command": the scan command
 * carries TWO numbers. There is no argument for the position in the proven
 * command set, so it cannot be sent, and appending a third number on a hunch
 * would be a coordinate the machine reads as something else, in silence. The
 * machine learns the position from where the OPERATOR parks the head. So the
 * position is now stated to him, in millimetres, in the lines he reads before
 * the send — which is the one use it has — and the bytes are unchanged.
 */
rule('10. THE MARK RECTANGLE — SIZE IN THE BYTES, POSITION IN THE WORDS')

const markPlan = planSkycutJob(parsed.file, D60, { mode: SKYCUT_DRY_RUN_MODE })
const markLines = markPlan.ok ? describeSkycutPlan(markPlan.plan) : []
const markStream = markPlan.ok ? emitSkycutStream(markPlan.plan) : null
const scanCmd = markStream && markStream.ok
  ? markStream.stream.commands.find((c) => c.startsWith('TB'))
  : undefined

console.log(`  fixture scanRect          x ${FIXTURE_446.marks.scanRect.x}, y ${FIXTURE_446.marks.scanRect.y},` +
  ` w ${FIXTURE_446.marks.scanRect.w}, h ${FIXTURE_446.marks.scanRect.h} mm`)
console.log(`  plan.markScan             ${JSON.stringify(markPlan.ok ? markPlan.plan.markScan : null)}`)
console.log(`  the scan command emitted  ${scanCmd}`)
console.log(`  the line the operator reads:`)
console.log(`    ${markLines.find((l) => l.startsWith('Park the head'))}`)

check(
  markPlan.ok && markPlan.plan.markScan?.originMm?.x === FIXTURE_446.marks.scanRect.x &&
    markPlan.plan.markScan?.originMm?.y === FIXTURE_446.marks.scanRect.y,
  "🔴 the rectangle's position reaches the plan instead of being dropped",
  JSON.stringify(markPlan.ok ? markPlan.plan.markScan?.originMm : null),
)
check(
  markLines.some((l) => l.includes('Park the head') && l.includes('6.00') && l.includes('32.00')),
  '🔴 and is read out to the operator in millimetres before anything is sent',
)
/* `TB25,18000,12720;` = h 450 mm and w 318 mm at 40 units/mm, and nothing else.
   Two arguments, so neither 6 nor 32 may appear in it. */
check(
  scanCmd === 'TB25,18000,12720;',
  'the scan command carries exactly the two spans, in the order the card says',
  scanCmd,
)
check(
  (scanCmd ?? '').split(',').length === 3,
  '🔴 and exactly two arguments - the position is NOT smuggled into the bytes',
  scanCmd,
)

// ─── 11. An unknown machine setting is refused by name ─────────────────────

/*
 * 🔴 THE SILENT INHERITANCE, FIXED 08/10/2026. `axisConvention` and
 * `markScanArgs` are unions in the type and plain strings on disk. The engine
 * used to validate them with `typeof === 'string'` and then CAST, so a stored
 * card carrying `axisConvention: 'banana'` passed straight through and inherited
 * the fallback branch of the transform — a mirror image on an asymmetric shape,
 * with nothing said anywhere.
 *
 * `scripts/skycut-loopback-test.mjs` section 12 covers the store side. This is
 * the protocol's own boundary, which is exported and can be handed a record a
 * caller assembled itself.
 */
rule('11. A MACHINE SETTING THIS BUILD DOES NOT KNOW IS REFUSED BY NAME')

const bananaAxes = planSkycutJob(parsed.file, { ...D60, axisConvention: 'banana' }, { mode: SKYCUT_DRY_RUN_MODE })
const bananaArgs = planSkycutJob(parsed.file, { ...D60, markScanArgs: 'sideways' }, { mode: SKYCUT_DRY_RUN_MODE })
show('axisConvention nobody declared', bananaAxes)
show('markScanArgs nobody declared', bananaArgs)
check(
  !bananaAxes.ok && bananaAxes.refusals.some((r) => r.code === 'axisConventionUnknown' && r.detail === 'banana'),
  '🔴 an unknown axis convention is refused, with the offending word in the reason',
)
check(
  !bananaArgs.ok && bananaArgs.refusals.some((r) => r.code === 'markScanArgsUnknown' && r.detail === 'sideways'),
  '🔴 so is an unknown mark-scan argument order',
)
check(
  !bananaAxes.ok && bananaAxes.plan === undefined,
  'and no plan comes out of either - nothing to emit from, nothing to send',
)

rule(failures === 0 ? 'ALL ASSERTIONS PASSED' : `${failures} ASSERTION(S) FAILED`)
if (failures > 0) process.exit(1)
