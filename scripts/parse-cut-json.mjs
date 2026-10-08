/**
 * THE OTHER HALF OF THE CONTRACT TEST FOR THE PRESSCAL ↔ PRESSKIT SEAM.
 *
 * PressCal writes `<stem>.cut.json`; this reads one with the REAL parser and the
 * REAL planner this app uses, and prints what the operator would be shown.
 * CONNECTS TO NOTHING — there is no socket in this file and no address anywhere
 * in it, and the plan is asked for in `travelOnly` mode, which emits no head-down
 * command at all.
 *
 *     node scripts/parse-cut-json.mjs <path-to.cut.json> [machineId]
 *
 * WHY A SCRIPT AND NOT A TEST: the two sides of this seam live in two
 * repositories that deliberately share no code, so neither half can import the
 * other. The proof is therefore a pair of scripts — PressCal's
 * `scripts/write-446-cut-json.ts` writes the file, this reads it — and the thing
 * being proved is that the four identity fields, the loading block, the marks
 * rectangle and every contour survive the crossing untouched.
 *
 * A non-zero exit means the file this build was handed would NOT cut.
 */
import { readFileSync } from 'node:fs'
import {
  parseCutFile,
  planSkycutJob,
  describeSkycutPlan,
  SKYCUT_MACHINE_PRESETS,
} from '../src/main/skycut-protocol.ts'

const [path, machineId = 'skycut-d60'] = process.argv.slice(2)
if (!path) {
  console.error('usage: node scripts/parse-cut-json.mjs <path-to.cut.json> [machineId]')
  process.exit(2)
}

const machine = SKYCUT_MACHINE_PRESETS.find((m) => m.id === machineId)
if (!machine) {
  console.error(`unknown machine '${machineId}'. known: ${SKYCUT_MACHINE_PRESETS.map((m) => m.id).join(', ')}`)
  process.exit(2)
}

const raw = JSON.parse(readFileSync(path, 'utf8'))
const parsed = parseCutFile(raw)

if (!parsed.ok) {
  console.log('REFUSED — this file would not cut:')
  for (const r of parsed.refusals) {
    console.log('  %s%s', r.code, r.detail ? ' — ' + r.detail : '')
  }
  process.exit(1)
}

const f = parsed.file
const contours = f.groups.reduce((n, g) => n + g.contours.length, 0)
console.log('ACCEPTED')
console.log('  %s v%d · %s · %s', f.format, f.formatVersion, f.units, f.frame)
console.log('  job      %s · %s', f.job.quoteNumber ?? '(no quote)', f.job.title ?? '(no title)')
console.log('  sheet    %s × %s mm', f.sheet.w, f.sheet.h)
console.log('  loading  feed %s · side up %s · mirrored %s',
  f.loading.feedEdge, f.loading.sideUp, f.loading.mirrored)
if (f.marks) {
  console.log('  marks    %s · scan %s × %s at %s,%s · arm %s · bar %s',
    f.marks.kind, f.marks.scanRect.w, f.marks.scanRect.h,
    f.marks.scanRect.x, f.marks.scanRect.y, f.marks.armMm, f.marks.thicknessMm)
}
console.log('  geometry %d group(s), %d contours', f.groups.length, contours)
if (f.totals?.cutLengthMm != null) console.log('  declared %s mm', f.totals.cutLengthMm)

/* 🔴 `travelOnly`. The planner refuses a `cut` without `bladeConfirmed`, and this
   script must never be the thing that confirms a blade — see safety rule 2. */
const plan = planSkycutJob(f, machine, { mode: 'travelOnly' })
console.log('\nPLAN on %s (travelOnly — no head-down command is produced)', machine.label)
if (!plan.ok) {
  console.log('  REFUSED:')
  for (const r of plan.refusals) console.log('    %s%s', r.code, r.detail ? ' — ' + r.detail : '')
  process.exit(1)
}
for (const line of describeSkycutPlan(plan.plan)) console.log('  ' + line)
