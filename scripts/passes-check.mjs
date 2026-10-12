/**
 * THE SECOND PASS IS THE SAME PATH AGAIN — AND NOTHING ELSE.
 *
 *     node scripts/passes-check.mjs
 *
 * 🔴 WHY THIS EXISTS. The owner asked for a second pass on 10/10/2026, for a laminated job that one
 * pass «δεν καταφέρνει να το κάνει σωστά». The whole feature is one sentence — send the same bytes
 * again — and every way of getting it wrong is silent on this machine, which never answers:
 *
 *   · a pass that also changes force or speed would overwrite settings he dialled in by hand, and
 *     nothing could read them back to restore them (SAFETY RULE 1 and his standing instruction)
 *   · a count the build will not run, quietly clamped to one, is a job he believes was cut three
 *     times and was cut once — he will not find out until the sheet tears
 *   · doubling the STORED cut length would make every two-pass job look like a geometry
 *     disagreement with PressCal (`totalsDisagree`), training him to ignore that warning
 *   · a dry run repeated three times is three times the wait for the same drawing
 *
 * It also pins the other half of that day's request: with camera marks the head must come back to
 * the mark he parked the knife on, which is NOT raw machine 0,0 — under a quarter turn that is a
 * different corner of the rectangle, i.e. the far mark.
 *
 * Measured on HIS OWN FILE, through the real parser, planner and emitter. CONNECTS TO NOTHING.
 */
import { readFileSync } from 'node:fs'
import {
  parseCutFile, planSkycutJob, emitSkycutStream, mmToMachine,
  SKYCUT_MACHINE_PRESETS, SKYCUT_EMIT_MODES, SKYCUT_DRY_RUN_MODE, SKYCUT_MAX_PASSES,
} from '../src/main/skycut-protocol.ts'

const FILE = 'C:/Users/info/Dropbox/Prints/Presscal prints/'
  + '[QT-2026-0446] Sofia Gerogianni - ΟΙΚΟΝΟΜΙΚΗ ΠΡΟΣΦΟΡΑ/JSON/'
  + 'QT-2026-0446_142x148_487x330_nup_6UP_cut_11.cut.json'

let failed = 0
const fail = (m) => { failed++; console.log('  ✗ ' + m) }
const pass = (m) => console.log('  ✓ ' + m)

const machine = SKYCUT_MACHINE_PRESETS.find((p) => p.id === 'skycut-d60')
const CUT_MODE = Object.keys(SKYCUT_EMIT_MODES).find((k) => SKYCUT_EMIT_MODES[k].headDown)

const parsed = parseCutFile(JSON.parse(readFileSync(FILE, 'utf8')))
if (!parsed.ok) {
  console.log('could not read his file:', JSON.stringify(parsed.refusals))
  process.exit(1)
}

const planFor = (opts) => planSkycutJob(parsed.file, machine, opts)
const streamFor = (opts) => {
  const p = planFor(opts)
  if (!p.ok) return { ok: false, refusals: p.refusals }
  return { ok: true, plan: p.plan, stream: emitSkycutStream(p.plan) }
}

console.log('')
console.log('one pass, two passes, and what differs between them')
const one = streamFor({ mode: CUT_MODE, bladeConfirmed: true, passes: 1 })
const two = streamFor({ mode: CUT_MODE, bladeConfirmed: true, passes: 2 })
if (!one.ok || !two.ok || !one.stream.ok || !two.stream.ok) {
  console.log('  ✗ the plans themselves were refused:', JSON.stringify(one.refusals ?? two.refusals ?? one.stream.refusals ?? two.stream.refusals))
  process.exit(1)
}
const cuts = (s) => s.stream.stream.commands.filter((c) => c.startsWith('D')).length
if (cuts(two) === cuts(one) * 2) pass(`the blade runs the path twice: ${cuts(one)} cut moves become ${cuts(two)}`)
else fail(`two passes produced ${cuts(two)} cut moves, not ${cuts(one) * 2}`)

if (two.plan.cutLengthMm === one.plan.cutLengthMm) {
  pass(`the stored cut length is the geometry's own, unchanged by passes (${one.plan.cutLengthMm} mm)`)
} else {
  fail(`the stored cut length changed with passes (${one.plan.cutLengthMm} -> ${two.plan.cutLengthMm}) — `
    + 'PressCal measured the same geometry and the two are cross-checked; every two-pass job would '
    + 'now look like a disagreement')
}

const forceIn = (s) => s.stream.stream.commands.some((c) => /^(FS|!FS|FC|BF)/.test(c))
if (!forceIn(one) && !forceIn(two)) pass('no force or pressure command in either stream')
else fail('a force command reached the stream — his pressure is his, always')

const speeds = (s) => s.stream.stream.commands.filter((c) => c.startsWith('VS')).length
if (speeds(two) === speeds(one)) pass('a pass changes no speed command')
else fail(`two passes emitted ${speeds(two)} speed commands against ${speeds(one)}`)

console.log('')
console.log('a count this build will not run is said out loud, never clamped')
for (const bad of [0, 4, 7, 1.5, -1]) {
  const r = planFor({ mode: CUT_MODE, bladeConfirmed: true, passes: bad })
  const named = !r.ok && r.refusals.some((x) => x.code === 'passesOutOfRange')
  if (named) pass(`${bad} is refused by name`)
  else fail(`${bad} was NOT refused by name (ceiling is ${SKYCUT_MAX_PASSES}) — it would run silently as something else`)
}
const absent = planFor({ mode: CUT_MODE, bladeConfirmed: true })
if (absent.ok && absent.plan.passes === 1) pass('no answer means one pass')
else fail('an absent pass count did not become exactly one')

console.log('')
console.log('a dry run is run once, and says so')
const dry = streamFor({ mode: SKYCUT_DRY_RUN_MODE, passes: 3 })
if (!dry.ok) fail('the dry run was refused: ' + JSON.stringify(dry.refusals))
else {
  if (dry.plan.passes === 1) pass('three passes head-up became one')
  else fail(`the dry run kept ${dry.plan.passes} passes — three times the wait for the same drawing`)
  if (dry.plan.notes.some((n) => n.code === 'passesIgnoredHeadUp')) pass('and he is told it was ignored')
  else fail('nothing told him his three passes were ignored')
  if (!dry.stream.stream.commands.some((c) => c.startsWith('D'))) pass('still not one blade-down move')
  else fail('the dry run emitted a cut move')
}

console.log('')
console.log('the head comes back to the mark he parked on')
const last = one.stream.stream.commands.filter((c) => c.startsWith('U')).pop()
const scan = one.plan.markScan
if (!scan) {
  fail('his file has no mark scan, so this check proves nothing — use a file with camera marks')
} else {
  const home = mmToMachine({ x: 0, y: 0 }, machine, { w: scan.widthMm, h: scan.heightMm })
  const want = `U${home.x},${home.y};`
  if (last === want) pass(`the last move goes to the scan rectangle's own corner: ${want}`)
  else fail(`the last move is ${last}, not the parked corner ${want}`)
  if (want !== 'U0,0;') pass('and that is NOT machine 0,0 on this machine — the old line sent it to the far mark')
  else console.log('  · on this convention the parked corner IS 0,0, so this file cannot tell the two apart')
}

console.log(failed === 0
  ? '\nALL CHECKS PASSED — a pass is the same bytes again, and the head comes home.\n'
  : `\n${failed} CHECK(S) FAILED.\n`)
process.exit(failed === 0 ? 0 : 1)
