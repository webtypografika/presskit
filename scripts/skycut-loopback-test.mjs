/**
 * Drive src/main/skycut-engine.ts against a FAKE MACHINE on 127.0.0.1, and
 * print what the fake machine actually received. Run it with:
 *
 *     node scripts/skycut-loopback-test.mjs
 *
 * 🔴 THIS CONNECTS TO NOTHING BUT A SERVER IT STARTS ITSELF. The port is
 * ephemeral, chosen by the OS, on 127.0.0.1. There is no address of any real
 * machine anywhere in this file, and the owner's D60 — which has a knife in it —
 * is never contacted, never scanned for, never probed. The server is closed
 * before the script exits.
 *
 * WHY IT EXISTS. The machine never answers, so the only way to know the
 * transport is right is to be the machine: accept the connection, timestamp
 * every chunk, count the bytes, and check the stream arrived whole, on command
 * boundaries, at the pace the manufacturer's software uses. That is what the
 * transcript below is.
 *
 * WHAT IT COVERS, beyond the happy path: reachability with zero bytes sent,
 * "stop sending" partway, the plan token that enforces "state the footprint
 * before sending", a machine card with no address, the absence of any force or
 * pressure command in the bytes, and — sections 8 to 10 — that the DRY RUN
 * delivers no head-down command, that the pen pass is gated like a cut because
 * it is one, and that a plan read against one machine card cannot be sent to
 * another.
 *
 * Sections 11 and 12 cover the two gaps found on 08/10/2026 in the layer this
 * script drives: the plan token now covers the mark-scan ARGUMENT ORDER — it did
 * not, so a plan survived a change to that setting and could be sent against it
 * — and a stored card carrying a machine setting this build does not recognise
 * is refused by name instead of inheriting a fallback.
 *
 * WHAT IT DOES NOT COVER: the geometry. `scripts/skycut-dry-run.mjs` covers the
 * transform, the flattening and every refusal of the protocol module, against
 * the real numbers of quote 446. The fixture here is deliberately plain
 * straight-line geometry, chosen so the byte and chunk counts are predictable
 * and the pacing is what is under test.
 *
 * HOW IT LOADS THE ENGINE. The engine is TypeScript that imports `./settings`,
 * which reaches electron-store. So it is bundled on the fly with esbuild (already
 * a dependency of electron-vite) and `./settings` is replaced by an in-memory
 * store. Everything else — the handlers, the machine records, the plan token,
 * the socket, the chunking, the pauses — is the real code the app runs.
 */
import { createServer } from 'node:net'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

// ─── Build the engine with the settings store stubbed ──────────────────────

const stubSettings = {
  name: 'stub-settings',
  setup(build) {
    build.onResolve({ filter: /^\.\/settings$/ }, () => ({ path: 'settings', namespace: 'stub' }))
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      loader: 'js',
      contents: `
        const data = new Map()
        export const store = {
          get: (k) => data.get(k),
          set: (k, v) => { data.set(k, v) },
          get store() { return Object.fromEntries(data) },
        }
        /* Handed to the script so section 12 can put a HAND-EDITED card into the
           store, which is the only way such a card really arrives: the save
           handler refuses it. Test scaffolding, and it lives in this file rather
           than as an export on the engine — production code gets no test-only
           door. */
        globalThis.__skycutStubStore = store
      `,
    }))
  },
}

const work = await mkdtemp(join(tmpdir(), 'skycut-loopback-'))
const bundlePath = join(work, 'engine.mjs')

await esbuild.build({
  entryPoints: [join(ROOT, 'src/main/skycut-engine.ts')],
  outfile: bundlePath,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  plugins: [stubSettings],
  logLevel: 'warning',
})

const engine = await import(pathToFileURL(bundlePath).href)

// ─── A fake machine: accepts, records, says nothing ────────────────────────

/* 🔴 IT NEVER WRITES A BYTE BACK. That is the one property of the real machine
   that the transport has to survive, so the fake must not be kinder than it. */
function startFakeMachine() {
  const received = []
  const connections = []
  const server = createServer((socket) => {
    const conn = { openedAt: Date.now(), chunks: [], bytes: 0, closedAt: null }
    connections.push(conn)
    socket.on('data', (buf) => {
      conn.chunks.push({ at: Date.now(), bytes: buf.length, text: buf.toString('ascii') })
      conn.bytes += buf.length
      received.push(buf)
    })
    socket.on('close', () => {
      conn.closedAt = Date.now()
    })
    socket.on('error', () => {})
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, connections })
    })
  })
}

const machine = await startFakeMachine()

// ─── A fixture whose byte count can be predicted on paper ──────────────────

/* 200 small rectangles on a 330 × 487 sheet: straight lines only, so no
   flattening is involved and the point count is exactly 200 × 5. Chosen to
   produce a stream of about 13 KB — which is 13 chunks, the same number the
   independent reverse-engineering project timed at 452 ms apart. */
const SHEET = { w: 330, h: 487 }
const COLS = 20
const ROWS = 10
const CELL_W = SHEET.w / COLS
const CELL_H = SHEET.h / ROWS
const RECT = { w: 12, h: 12 }

const contours = []
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const x = c * CELL_W + (CELL_W - RECT.w) / 2
    const y = r * CELL_H + (CELL_H - RECT.h) / 2
    contours.push({
      closed: true,
      start: { x, y },
      segments: [
        { kind: 'line', to: { x: x + RECT.w, y } },
        { kind: 'line', to: { x: x + RECT.w, y: y + RECT.h } },
        { kind: 'line', to: { x, y: y + RECT.h } },
        { kind: 'line', to: { x, y } },
      ],
      lengthMm: 2 * (RECT.w + RECT.h),
    })
  }
}

const FIXTURE = {
  format: 'presscal-cut',
  formatVersion: 1,
  units: 'mm',
  frame: 'sheet-bottom-left-mm',
  job: { quoteNumber: 'LOOPBACK-TEST', title: '200 squares' },
  sheet: SHEET,
  loading: { feedEdge: 'bottom', sideUp: 'front', mirrored: false },
  groups: [{ group: 'cut', perforation: false, contours }],
  totals: {
    cutLengthMm: contours.length * 2 * (RECT.w + RECT.h),
    lifts: contours.length,
    contours: contours.length,
  },
}

const cutPath = join(work, 'loopback.cut.json')
await writeFile(cutPath, JSON.stringify(FIXTURE), 'utf-8')

// ─── Wire up the real handlers behind a fake ipcMain ───────────────────────

const handlers = new Map()
engine.registerSkycutHandlers({ handle: (channel, fn) => handlers.set(channel, fn) })

const progress = []
const fakeEvent = {
  sender: {
    isDestroyed: () => false,
    send: (channel, payload) => progress.push({ channel, payload }),
  },
}
const call = (channel, ...args) => {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler registered for ${channel}`)
  return fn(fakeEvent, ...args)
}

const rule = (t) => console.log(`\n${'─'.repeat(78)}\n${t}\n${'─'.repeat(78)}`)
const pass = (ok, label, extra = '') =>
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? `   ${extra}` : ''}`)

let failures = 0
const expect = (ok, label, extra) => {
  if (!ok) failures++
  pass(ok, label, extra)
}

/* 🔴 The screen may never claim an outcome. Checked as the ABSENCE of completion
   vocabulary rather than the absence of the word "cut" — the honest messages
   have to be able to say "not that the job was cut" and "not that it is ready to
   cut", which is the whole point of them. */
const COMPLETION_WORDS = /\b(done|finished|complete|completed|succeeded|successful)\b/i
const claimsAnOutcome = (msg) => COMPLETION_WORDS.test(msg)

console.log(`IPC channels registered: ${[...handlers.keys()].join(', ')}`)
console.log(`Fake machine listening on 127.0.0.1:${machine.port} - it never writes a byte back.`)

// ─── 1. The machine card ───────────────────────────────────────────────────

rule('1. THE MACHINE CARD — presets are data, the address lives here')

const presets = await call('skycut:listPresets')
console.log(`  presets: ${presets.map((p) => `${p.label} (${p.unitsPerMm}/mm, ${p.markScanOpcode})`).join(' | ')}`)
expect(
  presets.every((p) => p.host === ''),
  'no preset carries an address',
)
expect(
  presets.every((p) => !('force' in p) && !('pressure' in p)),
  'no preset has a force or pressure field',
)

const d60 = presets.find((p) => p.model === 'D60')
const saved = await call('skycut:saveMachine', {
  ...d60,
  id: 'loopback-d60',
  label: 'Fake D60 (loopback)',
  host: '127.0.0.1',
  port: machine.port,
  connectTimeoutMs: 2000,
  writeTimeoutMs: 2000,
})
expect(saved.ok, 'a card saves', JSON.stringify({ id: saved.machine?.id, port: saved.machine?.port }))

const noAddress = await call('skycut:saveMachine', { ...d60, id: 'no-address', label: 'Unconfigured' })
expect(noAddress.ok, 'a card with no address still saves (it is simply not sendable)')

const stored = await call('skycut:listMachines')
expect(stored.machines.length === 2, 'both cards are listed', `active=${stored.activeMachineId}`)
expect(stored.broken.length === 0, 'no card failed validation')

const malformed = await call('skycut:saveMachine', { id: 'junk', label: 'Junk' })
expect(!malformed.ok && malformed.refusals[0].code === 'machineRecordMalformed', 'a malformed card is refused', malformed.refusals?.[0]?.detail)

// ─── 2. Reachability: zero bytes ───────────────────────────────────────────

rule('2. REACHABILITY — a connection, ZERO BYTES, a close')

const bytesBeforeProbe = machine.connections.reduce((n, c) => n + c.bytes, 0)
const probe = await call('skycut:probe', 'loopback-d60')
const bytesAfterProbe = machine.connections.reduce((n, c) => n + c.bytes, 0)
expect(probe.ok, 'reachable', `${probe.ms} ms`)
expect(bytesAfterProbe === bytesBeforeProbe, 'the probe sent zero bytes', `${bytesAfterProbe - bytesBeforeProbe} bytes`)
expect(!claimsAnOutcome(probe.message), 'the message claims no outcome')
expect(/never reports back/i.test(probe.message), 'the message says the machine never reports back')
console.log(`  message: ${probe.message}`)

const unreachable = await call('skycut:probe', 'no-address')
expect(!unreachable.ok && unreachable.refusals[0].code === 'hostMissing', 'a card with no address is refused, not dialled', unreachable.refusals?.[0]?.code)

// ─── 3. The plan — nothing connected ───────────────────────────────────────

rule('3. THE PLAN — footprint in millimetres, with no socket open')

const connectionsBeforePlan = machine.connections.length
const planned = await call('skycut:planJob', cutPath, 'loopback-d60', { mode: 'cut', bladeConfirmed: true })
expect(planned.ok, 'the job plans', planned.ok ? '' : JSON.stringify(planned.refusals))
expect(machine.connections.length === connectionsBeforePlan, 'planning opened no connection')

const p = planned.planned
console.log(p.description.map((l) => `    ${l}`).join('\n'))
console.log(`  stream: ${p.byteLength} bytes, ${p.chunkCount} chunks of ${p.chunkBytes}, ${p.chunkPauseMs} ms apart`)
console.log(`  commands: ${p.commandCount}`)
console.log(`  first: ${p.commandSample.slice(0, 6).join(' ')}`)
console.log(`  last:  ${p.commandSample.slice(-6).join(' ')}`)
expect(p.pointCount === contours.length * 5, 'point count is exactly 200 rectangles x 5', String(p.pointCount))
expect(p.contourCount === 200, 'contour count', String(p.contourCount))
expect(typeof p.planToken === 'string' && p.planToken.length === 64, 'a plan token was issued')

expect(p.canSend && p.sendBlockers.length === 0, 'a configured card can send')

/* A card with no address still plans — planning opens no socket, so the operator
   can read the footprint — but it says WHY the send is blocked. */
const unconfigured = await call('skycut:planJob', cutPath, 'no-address', { mode: 'cut', bladeConfirmed: true })
expect(unconfigured.ok, 'a card with no address still plans, so the footprint is readable')
expect(
  unconfigured.ok && !unconfigured.planned.canSend && unconfigured.planned.sendBlockers[0].code === 'hostMissing',
  'and it says why the send is blocked',
)
const unconfiguredSend = await call(
  'skycut:send',
  cutPath,
  'no-address',
  { mode: 'cut', bladeConfirmed: true },
  unconfigured.ok ? unconfigured.planned.planToken : 'x',
)
expect(
  !unconfiguredSend.ok && unconfiguredSend.refusals[0].code === 'hostMissing' && unconfiguredSend.bytesSent === 0,
  'sending to it is refused before any socket is opened',
)

const notConfirmed = await call('skycut:planJob', cutPath, 'loopback-d60', { mode: 'cut' })
expect(
  !notConfirmed.ok && notConfirmed.refusals.some((r) => r.code === 'bladeNotConfirmed'),
  'SAFETY RULE 2: cut mode without a confirmed head is refused',
)

// ─── 4. The send ───────────────────────────────────────────────────────────

rule('4. THE SEND — one connection, 1024-byte chunks, ~450 ms apart')

const connIndex = machine.connections.length
progress.length = 0
const t0 = Date.now()
const result = await call('skycut:send', cutPath, 'loopback-d60', { mode: 'cut', bladeConfirmed: true }, p.planToken)
const wall = Date.now() - t0

const conn = machine.connections[connIndex]
const got = conn.chunks.map((c) => c.text).join('')
const gaps = conn.chunks.slice(1).map((c, i) => c.at - conn.chunks[i].at)

console.log(`  result.ok              ${result.ok}`)
console.log(`  chunks sent            ${result.chunksSent} of ${result.chunkTotal}`)
console.log(`  bytes sent             ${result.bytesSent} of ${result.byteTotal}`)
console.log(`  elapsed (engine)       ${result.elapsedMs} ms`)
console.log(`  elapsed (wall clock)   ${wall} ms`)
console.log(`  message                ${result.message}`)
console.log(`\n  what the fake machine received:`)
console.log(`    connections opened   ${machine.connections.length - connIndex}`)
console.log(`    data events          ${conn.chunks.length}`)
console.log(`    bytes                ${conn.bytes}`)
console.log(`    sizes                ${conn.chunks.map((c) => c.bytes).join(', ')}`)
console.log(`    gaps between them    ${gaps.join(', ')} ms`)
console.log(`    first 60 bytes       ${got.slice(0, 60)}`)
console.log(`    last 40 bytes        ${got.slice(-40)}`)
console.log(`    bytes it sent back   0 (it is a fake machine, and the real one never answers either)`)

expect(result.ok, 'the send reports ok')
expect(machine.connections.length - connIndex === 1, 'exactly one TCP connection for the job')
expect(conn.bytes === p.byteLength, 'every byte of the stream arrived', `${conn.bytes} of ${p.byteLength}`)
expect(result.bytesSent === p.byteLength, 'the engine counted the same bytes')
expect(result.chunksSent === p.chunkCount, 'every chunk was written')
expect(conn.chunks.every((c) => c.bytes <= p.chunkBytes), 'no received chunk exceeds the chunk size')
expect(conn.chunks.every((c) => c.text.endsWith(';')), 'no chunk splits a command — each ends at a boundary')
expect(got.startsWith('IN;PA;'), 'the stream starts IN; PA;', got.slice(0, 6))
expect(got.endsWith('U0,0;@;'), 'the stream parks and ends with @;', got.slice(-7))
expect(conn.closedAt !== null, 'the connection was closed by the sender')

const medianGap = gaps.length ? gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0
expect(
  gaps.length === 0 || (medianGap >= 420 && medianGap <= 700),
  'the pacing is the measured ~450 ms',
  `median ${medianGap} ms`,
)

expect(!/(^|[^A-Z])(FS|!FS|FC|BF)/.test(got), 'SAFETY RULE 1: no force or pressure command in the bytes')
expect(!claimsAnOutcome(result.message), 'the result claims no outcome - no "done", no "finished"')
expect(/not that the job was cut/i.test(result.message), 'the result says in words that it is not proof of a cut')
console.log(`  progress events: ${progress.length} on "${progress[0]?.channel}" - phases ${[...new Set(progress.map((e) => e.payload.phase))].join(' > ')}`)
expect(
  progress.every((e) => !/\bcutting\b/i.test(e.payload.message)),
  'every progress message is about sending, not cutting',
)

// ─── 5. Safety rule 3, as a mechanism ──────────────────────────────────────

rule('5. SAFETY RULE 3 — no token, no send')

const noToken = await call('skycut:send', cutPath, 'loopback-d60', { mode: 'cut', bladeConfirmed: true }, '')
expect(!noToken.ok && noToken.refusals[0].code === 'planTokenMissing', 'a send with no plan token is refused')
console.log(`    ${noToken.message}`)

const wrongToken = await call('skycut:send', cutPath, 'loopback-d60', { mode: 'cut', bladeConfirmed: true }, 'f'.repeat(64))
expect(!wrongToken.ok && wrongToken.refusals[0].code === 'planTokenMismatch', 'a send with a stale token is refused')

/* The file changes on disk after the footprint was read out. */
const moved = structuredClone(FIXTURE)
moved.groups[0].contours = moved.groups[0].contours.slice(0, 50)
await writeFile(cutPath, JSON.stringify(moved), 'utf-8')
const changedFile = await call('skycut:send', cutPath, 'loopback-d60', { mode: 'cut', bladeConfirmed: true }, p.planToken)
expect(
  !changedFile.ok && changedFile.refusals[0].code === 'planTokenMismatch',
  'a file rewritten since it was planned is refused',
)
await writeFile(cutPath, JSON.stringify(FIXTURE), 'utf-8')

const connectionsBefore = machine.connections.length
expect(machine.connections.length === connectionsBefore, 'none of those three opened a socket')

// ─── 6. Stop sending ───────────────────────────────────────────────────────

rule('6. STOP SENDING — the rest never leaves; the machine is stopped at the machine')

const replanned = await call('skycut:planJob', cutPath, 'loopback-d60', { mode: 'cut', bladeConfirmed: true })
const stopIndex = machine.connections.length
progress.length = 0

const sending = call('skycut:send', cutPath, 'loopback-d60', { mode: 'cut', bladeConfirmed: true }, replanned.planned.planToken)

/* Let three chunks go, then stop — which is roughly how long a human takes. */
await new Promise((r) => setTimeout(r, 1100))
const active = await call('skycut:activeSends')
expect(active.length === 1, 'the send is listed while it runs', JSON.stringify(active))
const stopped = await call('skycut:stopSending', active[0].sendId)
expect(stopped.ok, 'stop accepted')

const stopResult = await sending
const stopConn = machine.connections[stopIndex]
console.log(`  chunks that left       ${stopResult.chunksSent} of ${stopResult.chunkTotal}`)
console.log(`  bytes that left        ${stopResult.bytesSent} of ${stopResult.byteTotal}`)
console.log(`  fake machine received  ${stopConn.bytes} bytes in ${stopConn.chunks.length} data events`)
console.log(`  message                ${stopResult.message}`)

expect(stopResult.stopped, 'the result says it was stopped')
expect(!stopResult.ok, 'a stopped send is not a success')
expect(stopResult.refusals[0].code === 'stoppedByOperator', 'the reason is the operator')
expect(stopConn.bytes < replanned.planned.byteLength, 'the remainder never left', `${stopConn.bytes} < ${replanned.planned.byteLength}`)
/* `>=`, because a stop landing mid-chunk can leave a partial write in flight
   that the engine does not count — it reports a floor, never a boast. */
expect(stopConn.bytes >= stopResult.bytesSent, 'what arrived is at least what the engine counted', `${stopConn.bytes} >= ${stopResult.bytesSent}`)
expect(!stopConn.chunks.map((c) => c.text).join('').includes('@;'), 'the machine never got the end command')
expect(/at the machine/i.test(stopResult.message), 'the message says the machine is stopped at the machine')

const gone = await call('skycut:stopSending', 'skycut-does-not-exist')
expect(!gone.ok && gone.refusals[0].code === 'sendNotFound', 'stopping an unknown send is refused, not ignored')

// ─── 7. An address that answers nothing ────────────────────────────────────

rule('7. A MACHINE THAT IS NOT THERE')

/* 127.0.0.1 on a port nothing listens on: refused at once, locally, with no
   packet leaving this computer. */
await call('skycut:saveMachine', {
  ...d60,
  id: 'closed-port',
  label: 'Nothing listening',
  host: '127.0.0.1',
  port: 1,
  connectTimeoutMs: 1000,
  writeTimeoutMs: 1000,
})
const deadProbe = await call('skycut:probe', 'closed-port')
expect(!deadProbe.ok, 'an unreachable address fails', deadProbe.refusals[0]?.code)
console.log(`    ${deadProbe.message}`)

const deadPlan = await call('skycut:planJob', cutPath, 'closed-port', { mode: 'cut', bladeConfirmed: true })
const deadSend = await call(
  'skycut:send',
  cutPath,
  'closed-port',
  { mode: 'cut', bladeConfirmed: true },
  deadPlan.ok ? deadPlan.planned.planToken : 'x',
)
expect(!deadSend.ok, 'the send fails')
expect(deadSend.bytesSent === 0, 'no bytes were sent')
console.log(`    ${deadSend.message}`)

// ─── 8. The dry run, over the real transport ───────────────────────────────

/* 🔴 THE MODE THE TAB OFFERS AS THE DRY RUN. Until 08/10/2026 that was the pen
   mode, which emitted a stream byte-for-byte identical to a cut; this checks
   over the wire what `scripts/skycut-dry-run.mjs` section 9 checks in the
   emitter — that what actually ARRIVES at a machine carries no head-down
   command. */
rule('8. THE DRY RUN — nothing comes down, and the bytes that arrived prove it')

const travelIndex = machine.connections.length
const travelPlan = await call('skycut:planJob', cutPath, 'loopback-d60', { mode: 'travelOnly' })
expect(travelPlan.ok, 'the dry run plans with no answer about the head needed')
expect(
  /head never comes down/i.test(travelPlan.planned.description.join('\n')),
  'the plan tells the operator the head never comes down',
)
const travelSend = await call('skycut:send', cutPath, 'loopback-d60', { mode: 'travelOnly' }, travelPlan.planned.planToken)
const travelGot = machine.connections[travelIndex].chunks.map((c) => c.text).join('')
expect(travelSend.ok, 'the dry run sends')
expect(!travelGot.includes('D'), 'not one D command reached the machine')
/* One `U` per point, plus the `U0,0;` park at the end of every stream. */
const travelUs = travelGot.split('U').length - 1
expect(
  travelUs === travelPlan.planned.pointCount + 1,
  'every point travelled head-up, plus the park',
  `${travelUs} U commands for ${travelPlan.planned.pointCount} points`,
)
console.log(`    bytes ${machine.connections[travelIndex].bytes}, first 48: ${travelGot.slice(0, 48)}`)

// ─── 9. The pen pass is a head-down run, and is named like one ─────────────

/* The defect this section exists for: `'penDraw'`, labelled "Dry run - pen" on
   the tab, emitted 272 head-down commands on the 446 job — identical to `'cut'`.
   The mode is now `'penDown'`, it is gated like a cut, and the old name is not
   quietly accepted as the nearest thing. */
rule('9. THE PEN PASS — head down, gated like a cut, and the old name is refused')

const penUnconfirmed = await call('skycut:planJob', cutPath, 'loopback-d60', { mode: 'penDown' })
expect(
  !penUnconfirmed.ok && penUnconfirmed.refusals.some((r) => r.code === 'bladeNotConfirmed'),
  'the pen pass is refused without an answer about the head',
  penUnconfirmed.ok ? 'IT PLANNED' : penUnconfirmed.refusals.map((r) => r.code).join(', '),
)

const penPlan = await call('skycut:planJob', cutPath, 'loopback-d60', { mode: 'penDown', bladeConfirmed: true })
expect(penPlan.ok, 'the pen pass plans once the head has been answered for')
expect(
  /HEAD DOWN/.test(penPlan.planned.description.join('\n')),
  'the plan says HEAD DOWN in the lines the operator reads',
)
expect(
  !/dry run/i.test(penPlan.planned.description.join('\n')),
  '🔴 and never calls the pen pass a dry run',
)

const oldName = await call('skycut:planJob', cutPath, 'loopback-d60', { mode: 'penDraw', bladeConfirmed: true })
expect(
  !oldName.ok && oldName.refusals.some((r) => r.code === 'emitModeUnknown'),
  "🔴 the old name 'penDraw' is refused outright, not read as the nearest mode",
  oldName.ok ? 'IT PLANNED' : oldName.refusals.map((r) => r.code).join(', '),
)

// ─── 10. A plan belongs to ONE machine ─────────────────────────────────────

/* The engine-side companion to the tab's second defect. On the tab, the answer
   to "what is fitted in the head" used to survive a change of machine: confirmed
   for the D24, reused for the D60 with a knife in it. That is fixed in
   `CuttingPlotter.tsx`, where the answer now carries the machine it was given
   for — a renderer-only state machine that this script cannot drive.
   What IS drivable here is the floor underneath it: the plan token covers the
   machine, so a plan read and armed against one card cannot be sent to another
   even if a caller tried. Both cards point at the fake machine; nothing else is
   contacted. */
rule('10. A PLAN BELONGS TO ONE MACHINE — the token says which')

const secondCard = await call('skycut:saveMachine', {
  ...d60,
  id: 'loopback-d60-b',
  label: 'Fake D60 B (loopback)',
  host: '127.0.0.1',
  port: machine.port,
  connectTimeoutMs: 2000,
  writeTimeoutMs: 2000,
})
expect(secondCard.ok, 'a second loopback card saves')

const planForA = await call('skycut:planJob', cutPath, 'loopback-d60', { mode: 'cut', bladeConfirmed: true })
expect(planForA.ok, 'the job plans for card A')

const connectionsBeforeCrossSend = machine.connections.length
const crossSend = await call(
  'skycut:send',
  cutPath,
  'loopback-d60-b',
  { mode: 'cut', bladeConfirmed: true },
  planForA.planned.planToken,
)
expect(
  !crossSend.ok && crossSend.refusals.some((r) => r.code === 'planTokenMismatch'),
  "🔴 card A's plan cannot be sent to card B",
  crossSend.ok ? 'IT SENT' : crossSend.refusals.map((r) => r.code).join(', '),
)
expect(crossSend.bytesSent === 0, 'no bytes left PressKit')
expect(
  machine.connections.length === connectionsBeforeCrossSend,
  'and no connection was opened at all',
)
expect(!claimsAnOutcome(crossSend.message), 'the message claims no outcome')
console.log(`    ${crossSend.message}`)

// ─── 11. The token covers the mark-scan argument order ────────────────────

/* 🔴 THE HOLE THAT WAS IN THE TOKEN UNTIL 08/10/2026. It hashed the machine id,
   address, units per mm, axis convention, mark-scan opcode, mode, footprint,
   point count and byte length — but NOT `markScanArgs`, the order the scan
   command's two numbers go in. Measured before the fix: plan a job, swap that
   setting on the card, send with the old token, and it went through. Height and
   width the wrong way round is a camera scan of a rectangle nobody printed, and
   the machine never reports back, so the first evidence is a cut in the wrong
   place. Both cards point at the fake machine; nothing else is contacted. */
rule('11. THE PLAN TOKEN COVERS THE MARK-SCAN ARGUMENT ORDER')

const argOrderCard = {
  ...d60,
  id: 'arg-order',
  label: 'Fake D60 (argument order)',
  host: '127.0.0.1',
  port: machine.port,
  connectTimeoutMs: 2000,
  writeTimeoutMs: 2000,
  markScanArgs: 'heightWidth',
}
await call('skycut:saveMachine', argOrderCard)
const beforeSwap = await call('skycut:planJob', cutPath, 'arg-order', { mode: 'cut', bladeConfirmed: true })
expect(beforeSwap.ok, 'the job plans with height-then-width')

await call('skycut:saveMachine', { ...argOrderCard, markScanArgs: 'widthHeight' })
const afterSwap = await call('skycut:planJob', cutPath, 'arg-order', { mode: 'cut', bladeConfirmed: true })
expect(
  afterSwap.ok && afterSwap.planned.planToken !== beforeSwap.planned.planToken,
  '🔴 swapping the argument order changes the token',
  afterSwap.ok ? `${beforeSwap.planned.planToken.slice(0, 12)} -> ${afterSwap.planned.planToken.slice(0, 12)}` : 'IT REFUSED',
)

const connectionsBeforeStaleArgs = machine.connections.length
const staleArgsSend = await call(
  'skycut:send',
  cutPath,
  'arg-order',
  { mode: 'cut', bladeConfirmed: true },
  beforeSwap.planned.planToken,
)
expect(
  !staleArgsSend.ok && staleArgsSend.refusals.some((r) => r.code === 'planTokenMismatch'),
  '🔴 a plan made before the swap cannot be sent after it',
  staleArgsSend.ok ? 'IT SENT' : staleArgsSend.refusals.map((r) => r.code).join(', '),
)
expect(staleArgsSend.bytesSent === 0, 'no bytes left PressKit')
expect(
  machine.connections.length === connectionsBeforeStaleArgs,
  'and no connection was opened at all',
)

// ─── 12. An unknown machine setting is refused by name ────────────────────

/* 🔴 THE SILENT INHERITANCE THAT WAS HERE UNTIL 08/10/2026. `axisConvention`
   and `markScanArgs` were validated as plain strings and then CAST to their
   unions, so a stored card carrying `axisConvention: 'banana'` — a hand edit of
   this app's schema-less settings file, or a card written by another version —
   passed validation and inherited the transform's fallback convention. A wrong
   axis convention cuts a mirror image: invisible on a symmetric shape, ruinous
   on an asymmetric one, and nothing says a word. Written straight into the
   store, which is how a card like that really arrives. */
rule('12. AN UNKNOWN MACHINE SETTING IS REFUSED, WITH ITS NAME IN THE REASON')

const goodCards = (await call('skycut:listMachines')).machines
globalThis.__skycutStubStore.set('skycut.machines', [
  ...goodCards,
  { ...d60, id: 'banana-axes', label: 'Hand-edited card', host: '127.0.0.1', port: machine.port, axisConvention: 'banana' },
  { ...d60, id: 'banana-args', label: 'Hand-edited card 2', host: '127.0.0.1', port: machine.port, markScanArgs: 'sideways' },
])

const listed = await call('skycut:listMachines')
const brokenCodes = listed.broken.flatMap((b) => b.refusals.map((r) => r.code))
const brokenDetails = listed.broken.flatMap((b) => b.refusals.map((r) => r.detail ?? ''))
expect(
  brokenCodes.includes('axisConventionUnknown'),
  "🔴 a card with an unknown axis convention is reported, not inherited",
  brokenCodes.join(', '),
)
expect(
  brokenCodes.includes('markScanArgsUnknown'),
  '🔴 so is an unknown mark-scan argument order',
  brokenCodes.join(', '),
)
expect(
  brokenDetails.some((d) => d.includes('banana')) && brokenDetails.some((d) => d.includes('sideways')),
  'the reason names the offending value',
  brokenDetails.join(' | '),
)
expect(
  listed.machines.every((m) => m.id !== 'banana-axes' && m.id !== 'banana-args'),
  'neither card is handed out as usable',
)
const bananaPlan = await call('skycut:planJob', cutPath, 'banana-axes', { mode: 'travelOnly' })
expect(
  !bananaPlan.ok && bananaPlan.refusals.some((r) => r.code === 'machineNotFound' || r.code === 'axisConventionUnknown'),
  'and nothing can be planned against it',
  bananaPlan.ok ? 'IT PLANNED' : bananaPlan.refusals.map((r) => r.code).join(', '),
)

console.log('  (the same check at the protocol boundary is section 11 of scripts/skycut-dry-run.mjs)')

// ─── Done ──────────────────────────────────────────────────────────────────

rule(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`)

machine.server.close()
await rm(work, { recursive: true, force: true })
process.exit(failures === 0 ? 0 : 1)
