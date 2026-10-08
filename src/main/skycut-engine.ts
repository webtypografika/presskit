/*
 * ─────────────────────────────────────────────────────────────────────────────
 * SKYCUT ENGINE — the machine cards, the socket, and the pacing. Nothing else.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `skycut-protocol.ts` turns millimetres into bytes and opens nothing. This file
 * is the layer underneath it: it holds the machines (name, ADDRESS, and every
 * per-machine fact the protocol needs), reads the handover file off disk, and
 * writes the finished stream down a TCP socket at the pace the manufacturer's
 * own software uses. It computes no geometry. If you find arithmetic on
 * millimetres in here, it is in the wrong file.
 *
 * ─── WHAT WAS MEASURED ON THE OWNER'S OWN D60, 06/10/2026 ───
 *
 *   • Plain TCP, port 8080. No handshake, no password, no greeting.
 *   • THE MACHINE NEVER SENDS ANYTHING BACK. Not an acknowledgement, not a
 *     status, not an error. Ever.
 *   • 1024-byte chunks with ~450 ms pauses, one TCP connection per job. An
 *     independent reverse-engineering project measured 452 ms across 13 chunks,
 *     so the pacing is corroborated, not guessed.
 *   • A connection that opens and is closed again having sent ZERO BYTES is how
 *     the live test confirmed the machine was there without moving anything.
 *     That is `probeMachine` below, and it is why it is a separate action.
 *
 * ─── 🔴 WHAT THIS LAYER MAY NEVER CLAIM ───
 *
 * The machine never answers, so NO OUTCOME HERE IS EVIDENCE THE JOB WAS CUT. A
 * completed send proves exactly one thing: the bytes left PressKit. Every string
 * in this file says "sent", never "cut", never "done", never "finished". An
 * operator who reads "Done" walks away from a knife that may never have moved.
 *
 * ─── 🔴 THE THREE SAFETY RULES, AND WHERE EACH ONE LIVES ───
 *
 *  1. NO PRESSURE COMMAND, EVER. There is no force or pressure field in the
 *     machine record — not here and not in the protocol's `SkycutMachine`. It
 *     cannot be sent by accident because there is nothing to send. The protocol
 *     re-checks the finished stream for force opcodes; this file adds no command
 *     of its own to the stream at all (see `sendStreamToMachine`: it writes the
 *     protocol's chunks verbatim and appends nothing).
 *  2. NO HEAD-DOWN JOB WITHOUT AN OPERATOR'S CONFIRMATION of what is fitted in
 *     the head. Enforced in `planSkycutJob`, which refuses `bladeNotConfirmed`
 *     for every mode whose `SKYCUT_EMIT_MODES` entry says `needsHeadAnswer`.
 *     This file never stores that answer and never carries it over from a
 *     previous send: it arrives with each IPC call or the plan is refused.
 *     WHICH mode puts the head down is the protocol's declared fact, never a
 *     comparison written here; the only mode that emits no head-down command is
 *     `SKYCUT_DRY_RUN_MODE`, which is also what an absent mode falls back to in
 *     `skycut:planJob` below.
 *  3. THE FOOTPRINT IS STATED IN MILLIMETRES BEFORE ANYTHING IS SENT. Enforced
 *     structurally, not by UI convention: `planJob` returns a `planToken` that
 *     covers the footprint, the machine, the mode and the file on disk, and
 *     `send` refuses without a matching one. A caller that has not planned —
 *     and therefore has nothing to have shown anybody — cannot send. If the
 *     file changed on disk between the plan and the send, the token no longer
 *     matches and the send is refused rather than quietly cutting new geometry
 *     against an old footprint.
 *
 * ─── 🔴 AND THE ONE FOR THIS BUILD ───
 *
 * NOTHING MAY REACH A REAL MACHINE DURING DEVELOPMENT. The owner's D60 sits on
 * the LAN with a knife in it. No address is compiled into this file, no default
 * host is filled in (`host: ''` in every preset, which `validateAddress`
 * refuses), and nothing in this file scans, discovers or broadcasts. The only
 * addresses this code has ever connected to are 127.0.0.1 ports opened by
 * `scripts/skycut-loopback-test.mjs`.
 *
 * ─── 🔴 NOT THROUGH THE LOCAL HTTP SERVER ───
 *
 * `src/main/index.ts` runs a server on 127.0.0.1:17824 with
 * `Access-Control-Allow-Origin: *` and no authentication, which any web page in
 * any browser can call. NOTHING in this file is reachable from it. Every entry
 * point below is an `ipcMain.handle`, which only PressKit's own renderer can
 * invoke; this file adds no route, no path and no listener to that server, and
 * does not import it. The exposure is a known, separate decision — this feature
 * deliberately does not widen it.
 *
 * ─── WHY THE ADDRESS IS HERE AND NOT IN PRESSCAL ───
 *
 * PressCal runs in a browser and cannot open a socket to a device at all. It
 * names WHICH machine a job is for; this app knows HOW to reach it. So the
 * handover file carries no address, and the address never travels with the job.
 */

/* Types only — erased at build, so this module pulls no Electron runtime in and
   can be bundled for the loopback test with `./settings` stubbed. */
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { createConnection, type Socket } from 'net'
import { readFile, readdir, stat } from 'fs/promises'
import { join } from 'path'
import { createHash } from 'crypto'
import { store } from './settings'
import {
  parseCutFile,
  planSkycutJob,
  emitSkycutStream,
  describeSkycutPlan,
  asciiBytes,
  SKYCUT_MACHINE_PRESETS,
  SKYCUT_DRY_RUN_MODE,
  SKYCUT_AXIS_CONVENTIONS,
  SKYCUT_MARK_ARG_ORDERS,
  isSkycutAxisConvention,
  isSkycutMarkArgOrder,
  type SkycutMachine,
  type SkycutEmitMode,
  type SkycutPlan,
  type SkycutRefusal,
  type SkycutRefusalCode,
  type SkycutNote,
  type SkycutChunk,
  type CutJobJson,
  type CutJobMachineJson,
} from './skycut-protocol'

// ─── The machine record: the protocol's facts, plus how to reach it ─────────

/* THE FIRST MACHINE RECORD IN THIS APP. PressKit has never had the concept, so
 * the shape is worth drawing deliberately rather than growing.
 *
 * It is the protocol's `SkycutMachine` — units per mm, axis convention, mark
 * scan opcode and argument order, chunk size, chunk pause, maximum material,
 * speed, measured speeds, provenance — PLUS the four facts that only matter to
 * something that opens a socket. The split is the same one as the file layout:
 * the protocol knows the machine's LANGUAGE, this layer knows its ADDRESS.
 *
 * On "maximum material and blade travel": that is `maxMaterialMm` on the
 * protocol record, and the two numbers are exactly those — `w` is how wide a
 * material the machine takes, `h` is how far the head can travel along it. One
 * field, because they are one rectangle, and `null` while nobody has measured
 * them, which makes the plan SAY the limit is unknown instead of silently
 * skipping the check.
 *
 * 🔴 NOTE WHAT IS STILL NOT HERE: no force, no pressure. «την πίεση την έχω
 * ρυθμίσει εγώ» — the pressure is set on the machine, by him, and the software
 * has no field in which to disagree. */
export interface SkycutMachineRecord extends SkycutMachine {
  /* IP address or hostname. Empty on every preset: nobody's address is a
     sensible default, and an empty host is refused by `validateAddress`, so a
     half-filled card cannot send. */
  host: string
  /* 8080 on his D60, measured. Still per-machine: it is a device setting. */
  port: number
  /* How long to wait for the TCP connection itself. A machine that is off, or
     on another subnet, otherwise leaves the operator watching a spinner. */
  connectTimeoutMs: number
  /* How long one chunk may take to reach the kernel before we give up. This is
     NOT a wait for a reply — there is never a reply. It is the guard against a
     socket that has stopped draining because the machine stopped reading. */
  writeTimeoutMs: number
}

/* Transport defaults, in one place, applied to every preset by `map`. */
const TRANSPORT_DEFAULTS = {
  host: '',
  port: 8080,
  connectTimeoutMs: 5000,
  writeTimeoutMs: 10000,
} as const

/* 🔴 PRESETS ARE DATA, NOT BRANCHES. This is a table of starting values a user
 * picks from once; after that every field belongs to him and is edited on the
 * card. There is no `if (model === 'D60')` anywhere in this file or in the
 * protocol — grep for `model` and you will find it read only for display and
 * for a refusal's detail string. That is the whole point: when his D24 turns out
 * to want a different mark opcode, it is a settings edit, not a release. */
export const SKYCUT_MACHINE_PRESETS_WITH_TRANSPORT: SkycutMachineRecord[] =
  SKYCUT_MACHINE_PRESETS.map((m) => ({ ...m, ...TRANSPORT_DEFAULTS }))

/* Flat dotted keys, no schema, already per-profile — the store this app has
   always had. Two keys, both arrays/strings of plain JSON. */
const MACHINES_KEY = 'skycut.machines'
const ACTIVE_KEY = 'skycut.activeMachineId'

/* The handover file's fixed suffix. Checked before parsing so a mis-picked PDF
   or a half-written temp file is refused by name rather than parsed hopefully. */
const CUT_FILE_SUFFIX = '.cut.json'

// ─── Refusals: the transport's own codes, next to the protocol's ────────────

/* Same discipline as the protocol module: a code the renderer can render, never
   a sentence, and never a throw. A throw up through IPC arrives at the renderer
   as a blank failure, which is the one outcome that teaches an operator
   nothing. */
export type SkycutTransportRefusalCode =
  /* ── The machine card ── */
  | 'machineNotFound'
  | 'machineRecordMalformed'
  | 'hostMissing'
  | 'hostInvalid'
  | 'portInvalid'
  | 'timeoutInvalid'
  /* ── The handover file ── */
  | 'cutFilePathInvalid'
  | 'cutFileWrongSuffix'
  | 'cutFileUnreadable'
  | 'cutFileNotJson'
  /* ── Safety rule 3, as a mechanism ── */
  /* No token: the caller never planned, so nothing was ever shown to anybody. */
  | 'planTokenMissing'
  /* The token does not match this file, this machine and this mode. Either the
     file changed on disk since the footprint was read out, or the send is for
     something other than what was planned. */
  | 'planTokenMismatch'
  /* ── The socket ── */
  | 'connectTimeout'
  | 'connectFailed'
  | 'writeTimeout'
  | 'writeFailed'
  | 'socketClosedEarly'
  /* ── The send itself ── */
  /* One stream per machine at a time. Two interleaved streams down one socket
     are not two jobs, they are garbage coordinates. */
  | 'sendAlreadyRunning'
  | 'sendNotFound'
  /* The operator pressed "Stop sending". Not an error; reported as its own
     outcome because a half-sent job is its own situation. */
  | 'stoppedByOperator'

export interface SkycutEngineRefusal {
  code: SkycutRefusalCode | SkycutTransportRefusalCode
  detail?: string
}

const refuse = (
  code: SkycutRefusalCode | SkycutTransportRefusalCode,
  detail?: string,
): SkycutEngineRefusal => (detail === undefined ? { code } : { code, detail })

// ─── Reading and validating a stored machine record ─────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const isStr = (v: unknown): v is string => typeof v === 'string'

/* `electron-store` has no schema in this app, so anything may be sitting under
   `skycut.machines` — a hand-edited config, a half-written card, a record from a
   future version. Validated on the way out of the store rather than trusted,
   and a broken record is REPORTED, not skipped: a machine that silently
   disappears from the list is a machine somebody will re-add by hand with
   different numbers. */
function coerceRecord(raw: unknown): { ok: true; record: SkycutMachineRecord } | { ok: false; refusals: SkycutEngineRefusal[] } {
  if (!isObj(raw)) return { ok: false, refusals: [refuse('machineRecordMalformed', 'not an object')] }

  const bad: string[] = []
  const need = <T,>(key: string, test: (v: unknown) => v is T): T | undefined => {
    const v = raw[key]
    if (!test(v)) {
      bad.push(key)
      return undefined
    }
    return v
  }

  const id = need('id', isStr)
  const label = need('label', isStr)
  const model = need('model', isStr)
  const unitsPerMm = need('unitsPerMm', isNum)
  const markScanOpcode = need('markScanOpcode', isStr)
  const chunkBytes = need('chunkBytes', isNum)
  const chunkPauseMs = need('chunkPauseMs', isNum)
  const host = need('host', isStr)
  const port = need('port', isNum)

  if (bad.length > 0) {
    return { ok: false, refusals: [refuse('machineRecordMalformed', bad.join(', '))] }
  }

  /* 🔴 THE TWO FIELDS THAT ARE UNIONS IN THE TYPE AND PLAIN STRINGS ON DISK,
     AND THE DEFECT THAT WAS HERE UNTIL 08/10/2026.
     Both of these used to be checked only with `isStr` and then CAST to their
     union — `axisConvention as SkycutMachine['axisConvention']`. A stored card
     carrying `axisConvention: 'banana'` therefore passed straight through
     validation, straight into the transform, and inherited the fallback
     convention in `mmToMachine`'s switch. That is a mirror image on an
     asymmetric shape, with no error anywhere and a machine that never answers.
     Reachable without any exotic scenario: this app's store is a flat JSON file
     with no schema, so a hand edit or a card written by another version of
     PressKit gets there.
     Refused by NAME now, with the offending word and the accepted words in the
     detail, because "a machine card is unreadable" is not something an operator
     can act on and "axisConvention 'banana'" is. */
  const axisConvention = raw.axisConvention
  if (!isSkycutAxisConvention(axisConvention)) {
    return {
      ok: false,
      refusals: [
        refuse(
          'axisConventionUnknown',
          `${JSON.stringify(axisConvention)} on card ${JSON.stringify(raw.label ?? raw.id ?? '')}` +
            ` - this build knows ${SKYCUT_AXIS_CONVENTIONS.join(', ')}`,
        ),
      ],
    }
  }
  const markScanArgs = raw.markScanArgs
  if (!isSkycutMarkArgOrder(markScanArgs)) {
    return {
      ok: false,
      refusals: [
        refuse(
          'markScanArgsUnknown',
          `${JSON.stringify(markScanArgs)} on card ${JSON.stringify(raw.label ?? raw.id ?? '')}` +
            ` - this build knows ${SKYCUT_MARK_ARG_ORDERS.join(', ')}`,
        ),
      ],
    }
  }

  /* The optional-by-design fields. `null` is a real, meaningful value on three
     of them — "nobody has measured this" — so it is preserved rather than
     filled in. A missing field becomes `null` for the same reason: an invented
     number here is a wrong number on screen that looks measured. */
  const maxMaterialMm =
    isObj(raw.maxMaterialMm) && isNum(raw.maxMaterialMm.w) && isNum(raw.maxMaterialMm.h)
      ? { w: raw.maxMaterialMm.w, h: raw.maxMaterialMm.h }
      : null

  return {
    ok: true,
    record: {
      id: id!,
      label: label!,
      model: model!,
      unitsPerMm: unitsPerMm!,
      /* No cast: both of these are narrowed by the guards above, so the type
         here is the type that was checked. */
      axisConvention,
      markScanOpcode: markScanOpcode!,
      markScanArgs,
      chunkBytes: chunkBytes!,
      chunkPauseMs: chunkPauseMs!,
      maxMaterialMm,
      speedVs: isNum(raw.speedVs) ? raw.speedVs : null,
      cutSpeedMmPerSec: isNum(raw.cutSpeedMmPerSec) ? raw.cutSpeedMmPerSec : null,
      travelSpeedMmPerSec: isNum(raw.travelSpeedMmPerSec) ? raw.travelSpeedMmPerSec : null,
      /* Unlike the two fields above, an unrecognised provenance is NOT refused —
         it falls back to `'thirdParty'`, which is the cautious direction: the
         screen then says this card's numbers were not measured by us, and the
         plan carries the `profileThirdParty` note. Only `'measuredHere'` claims
         anything, and only the exact word earns it. Nothing about the geometry
         depends on this field. */
      provenance: raw.provenance === 'measuredHere' ? 'measuredHere' : 'thirdParty',
      host: host!,
      port: port!,
      connectTimeoutMs: isNum(raw.connectTimeoutMs) ? raw.connectTimeoutMs : TRANSPORT_DEFAULTS.connectTimeoutMs,
      writeTimeoutMs: isNum(raw.writeTimeoutMs) ? raw.writeTimeoutMs : TRANSPORT_DEFAULTS.writeTimeoutMs,
    },
  }
}

export interface StoredMachines {
  machines: SkycutMachineRecord[]
  /* Rows that did not survive validation, with the reason, so the screen can
     say "one machine card is unreadable" instead of losing it in silence. */
  broken: { index: number; refusals: SkycutEngineRefusal[] }[]
  activeMachineId: string | null
}

function loadMachines(): StoredMachines {
  const raw = store.get(MACHINES_KEY)
  const rows = Array.isArray(raw) ? raw : []
  const machines: SkycutMachineRecord[] = []
  const broken: StoredMachines['broken'] = []
  rows.forEach((row, index) => {
    const r = coerceRecord(row)
    if (r.ok) machines.push(r.record)
    else broken.push({ index, refusals: r.refusals })
  })
  const active = store.get(ACTIVE_KEY)
  return { machines, broken, activeMachineId: isStr(active) ? active : null }
}

function findMachine(machineId: string): { ok: true; machine: SkycutMachineRecord } | { ok: false; refusals: SkycutEngineRefusal[] } {
  const { machines } = loadMachines()
  const m = machines.find((x) => x.id === machineId)
  if (!m) return { ok: false, refusals: [refuse('machineNotFound', machineId)] }
  return { ok: true, machine: m }
}

/* ─── THE MACHINE OUT OF THE HANDOVER FILE ───────────────────────────────────
 *
 * 🔴 THIS IS WHY THIS APP HAS NO MACHINE CARD ANY MORE. The owner set the
 * machine up once, in PressCal, and said so: «η μηχανή στήνεται στο presscal και
 * πάει στο presskit αθόρυβα… όλες οι ρυθμίσεις να γίνονται από το presscal». The
 * file names WHICH machine and WHERE it is; everything about HOW TO SPEAK to it
 * is resolved here, from the preset table, and never travels.
 *
 * 🔴 A TABLE, NOT A BRANCH, and the file's header rule is the reason: «PRESETS
 * ARE DATA, NOT BRANCHES… There is no `if (model === 'D60')` anywhere in this
 * file». This map is the same kind of data — two spellings of one machine — so a
 * third model is a row, not a release.
 *
 * ⚠️ THE TWO APPS SPELL THE MODEL DIFFERENTLY ON PURPOSE. PressCal's presets are
 * the owner's shorthand ('d60'); this app's are profile ids ('skycut-d60'). The
 * mapping lives on THIS side because this is the side that knows what a model
 * means. A spelling with no row is REFUSED BY NAME — never resolved to the
 * nearest machine: the camera-scan opcode differs across this family (TB25 on
 * the D60, TB26 on the D24), nothing in it ever answers back, and a wrong opcode
 * is therefore not an error but silence. */
const PRESSCAL_MODEL_PRESET: Record<string, string> = {
  d60: 'skycut-d60',
  d24: 'skycut-d24',
  /* ⚠️ NO d48 ROW, AND THAT IS THE CORRECT STATE. PressCal offers a D48 preset
     for its own geometry — the owner can quote a job on one — but nobody has
     measured a D48's command set, so there is no profile to resolve it to. It is
     refused by name until somebody does. */
}

/** The machine a cut file names, as a validated record — or the reason it is not one. */
type MachineFromFile =
  | { ok: true; machine: SkycutMachineRecord }
  /* 🔴 ABSENT IS ITS OWN ANSWER, NOT A REFUSAL. Every file written before
     08/10/2026 names no machine, and so does any job with no cutter on it. The
     caller falls back to the machine the operator picked; collapsing this into a
     refusal would turn every old file on his disk into an error. */
  | { ok: false; absent: true }
  | { ok: false; absent: false; refusals: SkycutEngineRefusal[] }

function machineFromFile(block: CutJobMachineJson | undefined): MachineFromFile {
  if (!block) return { ok: false, absent: true }
  const model = (block.model ?? '').trim()
  if (model === '') return { ok: false, absent: false, refusals: [refuse('machineModelUnknown', '(none given)')] }
  const presetId = PRESSCAL_MODEL_PRESET[model.toLowerCase()]
  const preset = presetId
    ? SKYCUT_MACHINE_PRESETS_WITH_TRANSPORT.find((p) => p.id === presetId)
    : undefined
  if (!preset) return { ok: false, absent: false, refusals: [refuse('machineModelUnknown', model)] }

  /* The limits, width-wise only. 🔴 WHICH OF HIS FOUR BINDS THIS JOB is decided
     in PressCal, which knows whether the job has camera marks; what reaches here
     is the narrowest one that applies, and the narrowest of a set is still a
     true upper bound for any job. A 0 means he left that box empty — "do not
     check" — so zeros are dropped rather than minimised into a limit of nothing.
     `h` stays null: material LENGTH is measured by nobody, by design. */
  const widths = block.limitsMm
    ? [block.limitsMm.opening, block.limitsMm.material, block.limitsMm.bladeTravel, block.limitsMm.cameraTravel]
      .filter((v) => Number.isFinite(v) && v > 0)
    : []
  const maxMaterialMm = widths.length > 0 ? { w: Math.min(...widths), h: null } : null

  /* Through `coerceRecord` like any stored card, so a file cannot reach the
     transport a route that skips the validation a typed card goes through.
     The id is synthetic and names where it came from, so a refusal about "that
     machine card" points at the file rather than at a card he never made. */
  const candidate = {
    ...preset,
    id: `file:${model}@${(block.host ?? '').trim()}:${block.port ?? preset.port}`,
    label: (block.label ?? '').trim() || preset.label,
    host: (block.host ?? '').trim(),
    port: block.port ?? preset.port,
    maxMaterialMm,
  }
  const r = coerceRecord(candidate)
  if (!r.ok) return { ok: false, absent: false, refusals: r.refusals }
  return { ok: true, machine: r.record }
}

/* An address good enough to hand to `net.createConnection`, and nothing more
   clever than that. Deliberately NOT a reachability test — that is `probe`, it
   costs a connection, and it is the operator's own separate action. */
function validateAddress(m: SkycutMachineRecord): SkycutEngineRefusal[] {
  const out: SkycutEngineRefusal[] = []
  const host = m.host.trim()
  if (host === '') {
    out.push(refuse('hostMissing', m.label))
  } else if (/[\s/\\]/.test(host) || host.includes('://')) {
    /* A pasted `http://10.0.0.1:8080/` is the obvious way to get this wrong, and
       a hostname with a scheme on it resolves to nothing. (No real machine's
       address appears anywhere in this file, not even as an example — one that
       can be copied out of a comment is one that can end up in a field.) */
    out.push(refuse('hostInvalid', host))
  }
  if (!Number.isInteger(m.port) || m.port < 1 || m.port > 65535) {
    out.push(refuse('portInvalid', String(m.port)))
  }
  if (!Number.isInteger(m.connectTimeoutMs) || m.connectTimeoutMs < 100) {
    out.push(refuse('timeoutInvalid', `connectTimeoutMs=${m.connectTimeoutMs}`))
  }
  if (!Number.isInteger(m.writeTimeoutMs) || m.writeTimeoutMs < 100) {
    out.push(refuse('timeoutInvalid', `writeTimeoutMs=${m.writeTimeoutMs}`))
  }
  return out
}

// ─── Reading the handover file ──────────────────────────────────────────────

async function readCutJobFile(filePath: unknown): Promise<
  { ok: true; raw: unknown; sig: string } | { ok: false; refusals: SkycutEngineRefusal[] }
> {
  if (!isStr(filePath) || filePath.trim() === '') {
    return { ok: false, refusals: [refuse('cutFilePathInvalid')] }
  }
  if (!filePath.toLowerCase().endsWith(CUT_FILE_SUFFIX)) {
    return { ok: false, refusals: [refuse('cutFileWrongSuffix', filePath)] }
  }
  let text: string
  let sig: string
  try {
    const st = await stat(filePath)
    /* Size and mtime go into the plan token, so a file PressCal rewrites between
       the plan and the send invalidates the token instead of being cut against a
       footprint somebody read off the old version. */
    sig = `${st.size}:${st.mtimeMs}`
    text = await readFile(filePath, 'utf-8')
  } catch (e) {
    return { ok: false, refusals: [refuse('cutFileUnreadable', String((e as Error)?.message ?? e))] }
  }
  try {
    return { ok: true, raw: JSON.parse(text), sig }
  } catch (e) {
    return { ok: false, refusals: [refuse('cutFileNotJson', String((e as Error)?.message ?? e))] }
  }
}

// ─── Safety rule 3 as a mechanism: the plan token ───────────────────────────

/* 🔴 WHY A TOKEN AND NOT A CHECKBOX.
 *
 * The rule is "always state the drawing's footprint in millimetres before
 * sending" — he once stopped a send because a 150 × 80 test was about to go to a
 * machine loaded with A4. A checkbox in the renderer would satisfy that rule
 * only as long as every future version of the renderer remembers to tick it
 * honestly.
 *
 * So the send does not accept a promise that a footprint was shown; it accepts
 * the fingerprint of the plan that produced one. The token covers the file as it
 * was on disk, the machine it was planned for, the mode, the footprint itself
 * and the length of the resulting stream. A caller that never planned has no
 * token. A caller that planned something else has the wrong token. A file that
 * changed since has a different signature. In all three cases the send is
 * refused with a code the screen can explain, and no socket is opened.
 *
 * 🔴 WHAT THE TOKEN MUST COVER, AND THE HOLE THAT WAS IN IT UNTIL 08/10/2026.
 *
 * Every machine fact that changes THE BYTES has to be in the canonical string
 * below, or the token keeps validating across a change it should have caught.
 * `markScanArgs` — the order the scan command's two arguments go in — was
 * missing. Measured: plan a job, edit the card to swap the order, send with the
 * old token, and the send went through. Height and width the wrong way round is
 * a camera scan of a rectangle nobody printed, and the machine never reports
 * back, so the first evidence is a cut in the wrong place.
 *
 * The rule for anything added to `SkycutMachineRecord` later: if it can change a
 * byte in the stream or a millimetre on screen, it belongs in this list. (Chunk
 * size and pause do not — they change the pacing, not the bytes — and the
 * stream's own `byteLength` is in the list, so a change that adds or removes a
 * command, `VS<n>;` included, invalidates the token on its own.)
 */
function planToken(args: {
  filePath: string
  fileSig: string
  machine: SkycutMachineRecord
  mode: SkycutEmitMode
  plan: SkycutPlan
  byteLength: number
  /* 🔴 THE BYTES THEMSELVES. Everything above this is a field somebody remembered to
     list, and the list was wrong twice in one day: `markScanArgs` was missing, and
     then `speedVs` — measured, a job planned at VS5 was sent with `VS7;` because the
     old token still validated and the two have the SAME byte length, so even
     `byteLength` did not notice. A field list can only ever be as complete as the
     last person's memory. The stream cannot: hash what is actually going out, and any
     machine setting that changes a single byte changes the token, including the ones
     nobody has thought of yet. The named fields stay below because they also catch a
     change that does NOT alter the bytes — a card re-pointed at a different address
     sends identical commands to a different machine, and that must not validate
     either. */
  streamText: string
}): string {
  const f = args.plan.footprintMm
  const canonical = [
    /* v3: the emitted stream itself joined the list, after a field list missed
       `speedVs`. The prefix is bumped so a token from a build with the smaller
       coverage cannot be mistaken for one of these. */
    'presskit-skycut-plan-v3',
    createHash('sha256').update(args.streamText).digest('hex'),
    args.filePath,
    args.fileSig,
    args.machine.id,
    args.machine.host,
    String(args.machine.port),
    String(args.machine.unitsPerMm),
    args.machine.axisConvention,
    args.machine.markScanOpcode,
    /* 🔴 The argument order, which decides whether the scan command goes out as
       `<height>,<width>` or `<width>,<height>`. Covered since 08/10/2026. */
    args.machine.markScanArgs,
    args.mode,
    [f.x, f.y, f.w, f.h].map((n) => (Math.round(n * 1000) / 1000).toFixed(3)).join(','),
    String(args.plan.pointCount),
    String(args.byteLength),
  ].join('|')
  return createHash('sha256').update(canonical).digest('hex')
}

// ─── Planning: everything the operator must read, with nothing connected ────

export interface SkycutPlannedJob {
  machine: SkycutMachineRecord
  mode: SkycutEmitMode
  job: CutJobJson
  /* 🔴 SAFETY RULE 3, in the form that reaches a human. These lines carry the
     footprint in millimetres and must be on screen before the send is armed. */
  description: string[]
  footprintMm: SkycutPlan['footprintMm']
  sheetMm: SkycutPlan['sheet']
  /* The three loading facts, as DATA. `description` already says them in words,
     but a screen that has to show them in a table would otherwise have to pick
     the sentence back apart — and a renderer parsing our own prose is a renderer
     that breaks the day the wording changes. The file has no defaults for these
     (`feedEdgeMissing`, `sideUpMissing`, `mirroredMissing` are refusals), so
     anything that arrives here was stated by PressCal. */
  loading: SkycutPlan['loading']
  contourCount: number
  cutLengthMm: number
  travelMm: number
  lifts: number
  pointCount: number
  estimatedSeconds: number | null
  markScan: SkycutPlan['markScan']
  /* What will actually go down the wire, so the screen can state the size and
     the pacing before anything is opened. */
  byteLength: number
  chunkCount: number
  chunkBytes: number
  chunkPauseMs: number
  /* Pure arithmetic: the pauses dominate, and this is the number that makes a
     big job's dead air visible BEFORE the operator starts waiting on it. */
  estimatedSendSeconds: number
  /* The first and last few commands, for eyeballing. Never the whole stream:
     a megabyte of coordinates through IPC helps nobody. */
  commandSample: string[]
  commandCount: number
  notes: SkycutNote[]
  planToken: string
  /* Why the send cannot go ahead, even though the job itself planned fine —
     today that means the machine card's address. Carried on the PLAN rather
     than refusing it, for two reasons: planning opens no socket, so an address
     is none of its business; and a greyed-out send button must be able to say
     WHY it is greyed out. `send` re-checks all of this itself. */
  sendBlockers: SkycutEngineRefusal[]
  canSend: boolean
}

export type SkycutPlanJobResult =
  | { ok: true; planned: SkycutPlannedJob }
  | { ok: false; refusals: SkycutEngineRefusal[]; notes: SkycutNote[] }

export interface SkycutSendOptions {
  mode: SkycutEmitMode
  /* Safety rule 2. Arrives with every call or the plan is refused; never stored,
     never remembered, never defaulted. */
  bladeConfirmed?: boolean
}

/* Shared by `planJob` and `send`, so the send cannot possibly plan differently
   from what was shown — same file, same machine, same options, same code. */
async function buildPlan(
  filePath: string,
  /* 🔴 `null` MEANS "TAKE THE MACHINE FROM THE FILE", which is the ordinary path
     since 08/10/2026 — the owner sets the machine up in PressCal and it travels
     with the job, so this app asks for nothing.

     A NON-NULL RECORD WINS OVER THE FILE, deliberately, and it is the safety
     valve: the renderer passes one when the operator picked a machine by hand,
     and — the case that matters — when it could not check that this file belongs
     to the job in front of him. A file is allowed to say which machine it is
     for; it is not allowed to aim this app at an address nobody verified. */
  machine: SkycutMachineRecord | null,
  options: SkycutSendOptions,
): Promise<
  | { ok: true; planned: SkycutPlannedJob; chunks: SkycutChunk[] }
  | { ok: false; refusals: SkycutEngineRefusal[]; notes: SkycutNote[] }
> {
  /* ⚠️ THE FILE IS READ BEFORE THE MACHINE IS KNOWN NOW, which is the opposite
     of the old order and is forced by the change: the file is what names the
     machine. Nothing is sent anywhere in between — this is a read and a parse. */
  const read = await readCutJobFile(filePath)
  if (!read.ok) return { ok: false, refusals: read.refusals, notes: [] }

  const parsed = parseCutFile(read.raw)
  if (!parsed.ok) return { ok: false, refusals: parsed.refusals, notes: [] }

  const fileNotes: SkycutNote[] = []
  let use: SkycutMachineRecord
  if (machine) {
    use = machine
  } else {
    const fromFile = machineFromFile(parsed.file.machine)
    if (!fromFile.ok) {
      /* Absent is the old-file case and is NOT an error — but with no card passed
         in there is genuinely nothing to send to, so it is reported as the note
         it is and the caller is expected to offer a machine. */
      if (fromFile.absent) {
        return { ok: false, refusals: [refuse('machineNotFound', '(the file names none)')], notes: [{ code: 'noMachineInFile' }] }
      }
      return { ok: false, refusals: fromFile.refusals, notes: [] }
    }
    use = fromFile.machine
  }

  /* NOT a reason to refuse a plan — see `sendBlockers`. Collected here so the
     one place that knows about addresses is still `validateAddress`. */
  const sendBlockers = validateAddress(use)

  const planned = planSkycutJob(parsed.file, use, {
    mode: options.mode,
    bladeConfirmed: options.bladeConfirmed,
  })
  if (!planned.ok) {
    return { ok: false, refusals: planned.refusals, notes: planned.notes }
  }

  const emitted = emitSkycutStream(planned.plan)
  if (!emitted.ok) {
    return { ok: false, refusals: emitted.refusals, notes: planned.plan.notes }
  }

  const plan = planned.plan
  const stream = emitted.stream
  const notes = [...plan.notes, ...stream.notes]
  const chunkCount = stream.chunks.length
  /* The pauses, not the bytes, are what takes the time: a 450 ms gap after every
     chunk but the last. */
  const estimatedSendSeconds = Math.round(((Math.max(0, chunkCount - 1) * use.chunkPauseMs) / 1000) * 10) / 10

  const sample =
    stream.commands.length <= 12
      ? [...stream.commands]
      : [...stream.commands.slice(0, 6), `… ${stream.commands.length - 12} more commands …`, ...stream.commands.slice(-6)]

  return {
    ok: true,
    chunks: stream.chunks,
    planned: {
      /* The machine ACTUALLY used — from the file on the ordinary path. Reporting
         the caller's `machine` here would name a card that may be null, and the
         plan token below would then hash a different machine than the one the
         stream was built for. */
      machine: use,
      mode: options.mode,
      job: plan.job,
      description: [
        ...describeSkycutPlan(plan),
        `Stream: ${stream.byteLength} bytes in ${chunkCount} chunk${chunkCount === 1 ? '' : 's'}` +
          ` of ${use.chunkBytes}, ${use.chunkPauseMs} ms apart`,
        `Sending takes about ${estimatedSendSeconds}s of pacing alone`,
        `Destination: ${use.host || '(no address)'}:${use.port}`,
      ],
      footprintMm: plan.footprintMm,
      sheetMm: plan.sheet,
      loading: plan.loading,
      contourCount: plan.contourCount,
      cutLengthMm: plan.cutLengthMm,
      travelMm: plan.travelMm,
      lifts: plan.lifts,
      pointCount: plan.pointCount,
      estimatedSeconds: plan.estimatedSeconds,
      markScan: plan.markScan,
      byteLength: stream.byteLength,
      chunkCount,
      chunkBytes: use.chunkBytes,
      chunkPauseMs: use.chunkPauseMs,
      estimatedSendSeconds,
      commandSample: sample,
      commandCount: stream.commands.length,
      notes,
      sendBlockers,
      canSend: sendBlockers.length === 0,
      planToken: planToken({
        filePath,
        fileSig: read.sig,
        machine: use,
        mode: options.mode,
        plan,
        byteLength: stream.byteLength,
        streamText: stream.text,
      }),
    },
  }
}

// ─── Reachability: a connection, zero bytes, and a close ────────────────────

export interface SkycutProbeResult {
  ok: boolean
  /* Milliseconds to the TCP handshake. Not a latency measurement worth quoting,
     just enough to tell "answered at once" from "answered eventually". */
  ms: number
  refusals: SkycutEngineRefusal[]
  /* 🔴 Says what a success here does and does not mean. Rendered as-is. */
  message: string
}

/**
 * Is anything listening at that address — asked exactly the way the live test
 * asked it: open a TCP connection, SEND ZERO BYTES, close it again.
 *
 * Nothing moves. No `IN;`, no `PA;`, nothing at all is written, which is why
 * this is safe to offer as a button and safe to press with a knife fitted and a
 * sheet loaded. It is deliberately a separate action from sending, so the tab
 * can say "reachable" before the send is armed.
 *
 * 🔴 WHAT IT CANNOT TELL YOU. A successful connection proves a TCP socket was
 * accepted on that port. It does NOT prove the thing that accepted it is a
 * cutter, or the right cutter, or that it is loaded, or that it is ready. The
 * machine never answers, so there is nothing further to ask it.
 */
export function probeMachine(machine: SkycutMachineRecord): Promise<SkycutProbeResult> {
  const addressRefusals = validateAddress(machine)
  if (addressRefusals.length > 0) {
    return Promise.resolve({
      ok: false,
      ms: 0,
      refusals: addressRefusals,
      message: 'Cannot try this machine card: its address is not usable.',
    })
  }

  return new Promise<SkycutProbeResult>((resolve) => {
    const started = Date.now()
    let settled = false
    const socket = createConnection({ host: machine.host.trim(), port: machine.port })

    const finish = (r: SkycutProbeResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.removeAllListeners()
      socket.destroy()
      resolve(r)
    }

    const timer = setTimeout(() => {
      finish({
        ok: false,
        ms: Date.now() - started,
        refusals: [refuse('connectTimeout', `${machine.host}:${machine.port} after ${machine.connectTimeoutMs} ms`)],
        message: `No answer from ${machine.host}:${machine.port}. Nothing was sent.`,
      })
    }, machine.connectTimeoutMs)

    socket.on('connect', () => {
      const ms = Date.now() - started
      /* ZERO BYTES. `end()` with no argument sends FIN and writes nothing. */
      socket.end()
      finish({
        ok: true,
        ms,
        refusals: [],
        message:
          `${machine.host}:${machine.port} accepted a connection in ${ms} ms. ` +
          'Nothing was sent and nothing moved. This machine never reports back, ' +
          'so this says the address answers - not that it is ready to cut.',
      })
    })

    socket.on('error', (e) => {
      finish({
        ok: false,
        ms: Date.now() - started,
        refusals: [refuse('connectFailed', e.message)],
        message: `Could not reach ${machine.host}:${machine.port}: ${e.message}. Nothing was sent.`,
      })
    })
  })
}

// ─── Sending: one connection per job, chunked, paced, never listened to ─────

export interface SkycutProgress {
  sendId: string
  /* Every phase name is about SENDING. There is deliberately no 'cut', no
     'finished' and no 'complete'. */
  phase: 'connecting' | 'sending' | 'closing' | 'sent' | 'stopped' | 'failed'
  chunksSent: number
  chunkTotal: number
  bytesSent: number
  byteTotal: number
  elapsedMs: number
  message: string
}

export type SkycutProgressSink = (p: SkycutProgress) => void

export interface SkycutSendResult {
  ok: boolean
  sendId: string
  chunksSent: number
  chunkTotal: number
  bytesSent: number
  byteTotal: number
  elapsedMs: number
  /* True when the operator pressed "Stop sending". The remainder never left, and
     whatever did leave is sitting in the machine. */
  stopped: boolean
  refusals: SkycutEngineRefusal[]
  /* 🔴 NEVER "cut", NEVER "done". See the header. */
  message: string
}

interface ActiveSend {
  sendId: string
  machineId: string
  socket: Socket | null
  stopped: boolean
  /* Resolves the current inter-chunk pause early, so "Stop sending" takes effect
     within milliseconds instead of waiting out a 450 ms gap. */
  wake: (() => void) | null
}

/* Keyed by sendId, with one send per machine enforced below. */
const activeSends = new Map<string, ActiveSend>()
let sendCounter = 0

/**
 * 🔴 WHAT "STOP SENDING" IS, AND WHAT IT HONESTLY IS NOT.
 *
 * It closes the socket. The chunks that have not been written yet never leave
 * PressKit — that is the whole of it, and it is real: on a long job most of the
 * stream is still here when the operator reacts.
 *
 * IT DOES NOT STOP THE MACHINE. Whatever already went down the wire is in the
 * machine's own buffer, and the machine will finish executing it — possibly
 * seconds after the socket is gone. It cannot be recalled, because the machine
 * never answers and there is no command in the proven set that says "discard".
 * A stopped send therefore leaves the machine holding PART of a stream: the head
 * will complete the contours it has and then simply stop, with no end `@;`.
 *
 * This is NOT a cancellation mechanism, and PressKit deliberately has none
 * anywhere. The owner's own words, 07/10/2026: «πάντως ούτε το SignMaster είχε
 * ακύρωση. Την ακύρωση την έκανα πάντα από το μηχάνημα.» Stopping the MACHINE is
 * done at the machine, and the screen must say so next to this button.
 */
export function stopSending(sendId: string): { ok: boolean; refusals: SkycutEngineRefusal[] } {
  const send = activeSends.get(sendId)
  if (!send) return { ok: false, refusals: [refuse('sendNotFound', sendId)] }
  send.stopped = true
  send.wake?.()
  send.socket?.destroy()
  return { ok: true, refusals: [] }
}

/* A pause that "Stop sending" can cut short. */
function pause(send: ActiveSend, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      send.wake = null
      resolve()
    }, ms)
    send.wake = () => {
      clearTimeout(timer)
      send.wake = null
      resolve()
    }
  })
}

/* One chunk to the kernel, with a deadline.
 *
 * 🔴 THIS IS NOT A WAIT FOR A REPLY. The callback fires when the bytes have been
 * flushed out of Node's buffer, which is the only acknowledgement that exists in
 * this protocol. The machine itself says nothing, and silence here is NEVER
 * treated as failure — only a write that cannot be flushed at all, or a socket
 * error, fails. */
function writeChunk(socket: Socket, bytes: Uint8Array, timeoutMs: number): Promise<SkycutEngineRefusal | null> {
  return new Promise((resolve) => {
    let settled = false
    const done = (r: SkycutEngineRefusal | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }
    const timer = setTimeout(() => done(refuse('writeTimeout', `${bytes.length} bytes after ${timeoutMs} ms`)), timeoutMs)
    socket.write(bytes, (err) => {
      if (err) done(refuse('writeFailed', err.message))
      else done(null)
    })
  })
}

/**
 * The stream out, one TCP connection for the whole job, at the machine's own
 * pace. Writes the protocol's chunks VERBATIM and appends nothing of its own —
 * which is how safety rule 1 survives this layer: there is no place in this
 * function where a command is composed.
 *
 * 🔴 NEVER WAITS FOR A REPLY, NEVER TREATS SILENCE AS FAILURE. Anything that
 * does arrive on the socket is counted and reported as a curiosity, because this
 * machine family has never been observed to send a byte and a future one that
 * does is worth knowing about — but no decision anywhere depends on it.
 *
 * 🔴 NEVER REPORTS SUCCESS AS PROOF THE JOB WAS CUT. The returned message says
 * the bytes left. That is the only fact in evidence.
 */
export async function sendStreamToMachine(args: {
  machine: SkycutMachineRecord
  chunks: SkycutChunk[]
  byteTotal: number
  footprintLine: string
  onProgress?: SkycutProgressSink
}): Promise<SkycutSendResult> {
  const { machine, chunks, byteTotal } = args
  const chunkTotal = chunks.length
  const sendId = `skycut-${Date.now()}-${++sendCounter}`
  const started = Date.now()

  const base = {
    sendId,
    chunkTotal,
    byteTotal,
    chunksSent: 0,
    bytesSent: 0,
  }

  /* One stream per machine. A second send into the same machine while the first
     is still going interleaves two coordinate streams into one buffer. */
  for (const s of activeSends.values()) {
    if (s.machineId === machine.id) {
      return {
        ...base,
        ok: false,
        elapsedMs: 0,
        stopped: false,
        refusals: [refuse('sendAlreadyRunning', s.sendId)],
        message: `${machine.label} is already receiving a job. Nothing was sent.`,
      }
    }
  }

  const addressRefusals = validateAddress(machine)
  if (addressRefusals.length > 0) {
    return {
      ...base,
      ok: false,
      elapsedMs: 0,
      stopped: false,
      refusals: addressRefusals,
      message: 'Cannot send: this machine card has no usable address. Nothing was sent.',
    }
  }

  const send: ActiveSend = { sendId, machineId: machine.id, socket: null, stopped: false, wake: null }
  activeSends.set(sendId, send)

  let chunksSent = 0
  let bytesSent = 0
  let unexpectedBytesIn = 0

  const report = (phase: SkycutProgress['phase'], message: string): void => {
    args.onProgress?.({
      sendId,
      phase,
      chunksSent,
      chunkTotal,
      bytesSent,
      byteTotal,
      elapsedMs: Date.now() - started,
      message,
    })
  }

  const outcome = (over: Partial<SkycutSendResult> & { ok: boolean; message: string }): SkycutSendResult => ({
    sendId,
    chunksSent,
    chunkTotal,
    bytesSent,
    byteTotal,
    elapsedMs: Date.now() - started,
    stopped: send.stopped,
    refusals: [],
    ...over,
  })

  try {
    report('connecting', `Opening ${machine.host}:${machine.port}. ${args.footprintLine}`)

    /* ── Connect ── */
    const opened = await new Promise<{ ok: true; socket: Socket } | { ok: false; refusal: SkycutEngineRefusal }>(
      (resolve) => {
        const s = createConnection({ host: machine.host.trim(), port: machine.port })
        let settled = false
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          s.removeAllListeners()
          s.destroy()
          resolve({
            ok: false,
            refusal: refuse('connectTimeout', `${machine.host}:${machine.port} after ${machine.connectTimeoutMs} ms`),
          })
        }, machine.connectTimeoutMs)
        s.on('connect', () => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          /* The connect-time listeners go, so the write loop's own `error`
             handler is the only one left. */
          s.removeAllListeners('error')
          resolve({ ok: true, socket: s })
        })
        s.on('error', (e) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          s.destroy()
          resolve({ ok: false, refusal: refuse('connectFailed', e.message) })
        })
      },
    )

    if (!opened.ok) {
      report('failed', `Could not reach ${machine.host}:${machine.port}. Nothing was sent.`)
      return outcome({
        ok: false,
        refusals: [opened.refusal],
        message: `Could not reach ${machine.host}:${machine.port}: ${opened.refusal.detail ?? opened.refusal.code}. Nothing was sent.`,
      })
    }

    const sock = opened.socket
    send.socket = sock

    /* 🔴 The machine never speaks. We listen only so that a future machine that
       does is noticed rather than silently discarded — and no branch below reads
       this count to decide anything. Nagle off: the chunks ARE the pacing, and
       the kernel must not re-group them. */
    sock.on('data', (buf) => {
      unexpectedBytesIn += buf.length
    })
    sock.setNoDelay(true)
    /* An error after the handshake must not become an unhandled event; the write
       loop finds out from its own write callback. */
    let socketError: string | null = null
    sock.on('error', (e) => {
      socketError = e.message
    })

    if (send.stopped) {
      sock.destroy()
      report('stopped', 'Stopped before any bytes were sent.')
      return outcome({
        ok: false,
        refusals: [refuse('stoppedByOperator')],
        message: 'Stopped before any bytes were sent. Nothing reached the machine.',
      })
    }

    /* ── The write loop ── */
    for (let i = 0; i < chunks.length; i++) {
      if (send.stopped) break

      const chunk = chunks[i]
      const bytes = asciiBytes(chunk.text)
      const failure = await writeChunk(sock, bytes, machine.writeTimeoutMs)

      /* "Stop sending" destroys the socket, which makes the write in flight fail
         — so a stop that lands mid-chunk must be reported as a stop and not as a
         write error. The operator's own action is not a fault. */
      if (failure && send.stopped) break

      if (failure) {
        sock.destroy()
        const partial = `${chunksSent} of ${chunkTotal} chunks (${bytesSent} of ${byteTotal} bytes) had already been sent.`
        report('failed', `Sending stopped on an error. ${partial}`)
        return outcome({
          ok: false,
          refusals: [failure],
          message:
            `Sending failed partway. ${partial} ` +
            'The machine keeps whatever it already received and never reports back, ' +
            'so check the machine itself before resending.',
        })
      }

      chunksSent = i + 1
      bytesSent += bytes.length
      report(
        'sending',
        `Sending chunk ${chunksSent} of ${chunkTotal} - ${bytesSent} of ${byteTotal} bytes`,
      )

      /* The pause belongs BETWEEN chunks. After the last one the socket closes,
         which the protocol module says in as many words: the final pause is the
         machine's own business, not ours. */
      if (i < chunks.length - 1 && !send.stopped) {
        await pause(send, chunk.pauseMsAfter)
      }
    }

    if (send.stopped) {
      sock.destroy()
      /* "At least", deliberately. A stop that lands mid-chunk destroys the
         socket with a write in flight, and a partial chunk that reached the
         machine is not counted here — so this number is a floor, never a
         boast. */
      const left = `At least ${chunksSent} of ${chunkTotal} chunks (${bytesSent} of ${byteTotal} bytes) had already been sent.`
      report('stopped', `Stopped sending. ${left}`)
      return outcome({
        ok: false,
        refusals: [refuse('stoppedByOperator')],
        message:
          `Stopped sending. ${left} The rest never left PressKit. ` +
          'The machine will finish what it already has - stop the machine at the machine.',
      })
    }

    /* ── Graceful close ── */
    report('closing', 'All chunks sent. Closing the connection.')
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve()
      }
      /* A machine that does not close its half promptly must not hold the UI. */
      const timer = setTimeout(() => {
        sock.destroy()
        finish()
      }, 2000)
      sock.once('close', finish)
      sock.end()
    })

    const seconds = Math.round(((Date.now() - started) / 1000) * 10) / 10
    report('sent', `Sent ${bytesSent} bytes in ${chunkTotal} chunks, ${seconds}s.`)

    return outcome({
      ok: true,
      refusals: [],
      /* 🔴 THE WORDING. "Sent", and then exactly what that does and does not
         mean. Not "Cut". Not "Done". Not "Finished". */
      message:
        `Sent: ${bytesSent} bytes in ${chunkTotal} chunks over ${seconds}s. ` +
        'This machine never reports back, so this confirms the stream left PressKit - ' +
        'not that the job was cut. Check the machine.' +
        (socketError ? ` (The socket also reported: ${socketError}.)` : '') +
        (unexpectedBytesIn > 0
          ? ` (Unexpected: the machine sent ${unexpectedBytesIn} bytes back. Nothing in PressKit acts on that.)`
          : ''),
    })
  } finally {
    activeSends.delete(sendId)
  }
}

// ─── Finding handover files next to the job ─────────────────────────────────

/* ⚠️ WHY THIS EXISTS INSTEAD OF `fs:listDirectory`. That handler hides every
   dotfile (`file-system.ts:136`) and its watcher is `depth: 0` and dotfile-blind
   (`:714`, `:718`). The handover file is deliberately NOT dot-prefixed so it is
   visible to all of that — but the tab still needs the quote root AND its
   immediate children in one answer, which `fs:listDirectory` cannot give. One
   level down, no deeper: a recursive walk of a job folder full of artwork is a
   disk thrash nobody asked for. */
async function findCutFiles(rootPath: string): Promise<{ files: { path: string; name: string; mtimeMs: number; size: number }[] }> {
  const out: { path: string; name: string; mtimeMs: number; size: number }[] = []

  const scan = async (dir: string): Promise<string[]> => {
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const e of entries) {
        if (e.isFile() && e.name.toLowerCase().endsWith(CUT_FILE_SUFFIX)) {
          const full = join(dir, e.name)
          try {
            const st = await stat(full)
            out.push({ path: full, name: e.name, mtimeMs: st.mtimeMs, size: st.size })
          } catch {
            /* Vanished between readdir and stat. Not an error worth a code. */
          }
        }
      }
      return entries.filter((e) => e.isDirectory()).map((e) => join(dir, e.name))
    } catch {
      return []
    }
  }

  const children = await scan(rootPath)
  for (const child of children) await scan(child)

  out.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return { files: out }
}

// ─── Register All Skycut Handlers ──────────────────────────────────────────

/* 🔴 EVERY ENTRY POINT TO THIS FEATURE IS HERE, AND EVERY ONE IS `ipcMain.handle`.
 * Only PressKit's own renderer can invoke these. The local HTTP server on
 * 127.0.0.1:17824 is not touched, not imported and not extended by this file —
 * no route of any kind is added to it, so no web page in any browser can reach a
 * cutter through PressKit. */
export function registerSkycutHandlers(ipcMain: IpcMain): void {
  // ─ The machine cards ─

  /* The preset table, as data. The renderer renders it as a list to pick from;
     once picked, every field is the user's to edit on the card. */
  ipcMain.handle('skycut:listPresets', async () => SKYCUT_MACHINE_PRESETS_WITH_TRANSPORT)

  ipcMain.handle('skycut:listMachines', async () => loadMachines())

  /* Upsert by id. Validated through the same `coerceRecord` the reads use, so a
     card cannot be stored in a shape the loader would later reject. */
  ipcMain.handle('skycut:saveMachine', async (_e, raw: unknown) => {
    const r = coerceRecord(raw)
    if (!r.ok) return { ok: false, refusals: r.refusals }
    const { machines } = loadMachines()
    const i = machines.findIndex((m) => m.id === r.record.id)
    if (i >= 0) machines[i] = r.record
    else machines.push(r.record)
    store.set(MACHINES_KEY, machines)
    /* First card saved becomes the active one; after that the choice is the
       user's and is never silently moved. */
    if (!isStr(store.get(ACTIVE_KEY))) store.set(ACTIVE_KEY, r.record.id)
    return { ok: true, refusals: [], machine: r.record }
  })

  ipcMain.handle('skycut:deleteMachine', async (_e, machineId: string) => {
    const { machines, activeMachineId } = loadMachines()
    const left = machines.filter((m) => m.id !== machineId)
    store.set(MACHINES_KEY, left)
    if (activeMachineId === machineId) {
      store.set(ACTIVE_KEY, left.length > 0 ? left[0].id : null)
    }
    return { ok: true, machines: left }
  })

  ipcMain.handle('skycut:setActiveMachine', async (_e, machineId: string) => {
    const found = findMachine(machineId)
    if (!found.ok) return { ok: false, refusals: found.refusals }
    store.set(ACTIVE_KEY, machineId)
    return { ok: true, refusals: [] }
  })

  // ─ The job ─

  ipcMain.handle('skycut:findCutFiles', async (_e, rootPath: string) => {
    if (!isStr(rootPath) || rootPath.trim() === '') return { files: [] }
    return findCutFiles(rootPath)
  })

  /**
   * 🔴 SAFETY RULE 3's ONLY DOOR. Plans the job with nothing connected — no
   * socket is opened anywhere in this handler — and hands back the footprint in
   * millimetres along with the token the send will demand. The operator reads
   * `description` BEFORE the send is armed. That is the whole purpose.
   */
  ipcMain.handle(
    'skycut:planJob',
    async (_e, filePath: string, machineId: string, options: SkycutSendOptions): Promise<SkycutPlanJobResult> => {
      const found = findMachine(machineId)
      if (!found.ok) return { ok: false, refusals: found.refusals, notes: [] }
      /* A caller that named no mode gets the DRY RUN, named from the protocol's
         own constant rather than spelled out here. The tab's row-filling pass
         takes this path, and the fallback for a missing mode must be the one
         mode that cannot put the head down. */
      const built = await buildPlan(filePath, found.machine, options ?? { mode: SKYCUT_DRY_RUN_MODE })
      if (!built.ok) return { ok: false, refusals: built.refusals, notes: built.notes }
      return { ok: true, planned: built.planned }
    },
  )

  // ─ Reachability, as its own action ─

  ipcMain.handle('skycut:probe', async (_e, machineId: string): Promise<SkycutProbeResult> => {
    const found = findMachine(machineId)
    if (!found.ok) {
      return { ok: false, ms: 0, refusals: found.refusals, message: 'No such machine card.' }
    }
    return probeMachine(found.machine)
  })

  // ─ The send ─

  /**
   * Re-plans from the file on disk, checks the result against the token the
   * operator was shown, and only then opens a socket.
   *
   * 🔴 Nothing here can report that a job was cut, because nothing can know. The
   * result says what left.
   */
  ipcMain.handle(
    'skycut:send',
    async (
      event: IpcMainInvokeEvent,
      filePath: string,
      machineId: string,
      options: SkycutSendOptions,
      token: string,
    ): Promise<SkycutSendResult> => {
      const empty = {
        sendId: '',
        chunksSent: 0,
        chunkTotal: 0,
        bytesSent: 0,
        byteTotal: 0,
        elapsedMs: 0,
        stopped: false,
      }

      const found = findMachine(machineId)
      if (!found.ok) {
        return { ...empty, ok: false, refusals: found.refusals, message: 'No such machine card. Nothing was sent.' }
      }

      if (!isStr(token) || token === '') {
        return {
          ...empty,
          ok: false,
          refusals: [refuse('planTokenMissing')],
          message:
            'Nothing was sent: this job was never planned, so its footprint was never shown. ' +
            'Plan it first and read the millimetres.',
        }
      }

      const built = await buildPlan(filePath, found.machine, options)
      if (!built.ok) {
        return {
          ...empty,
          ok: false,
          refusals: built.refusals,
          message: 'Nothing was sent: the job was refused. See the reasons.',
        }
      }

      /* 🔴 SAFETY RULE 3, enforced. A mismatch means the file, the machine, the
         mode or the geometry is not what produced the footprint somebody read. */
      if (built.planned.planToken !== token) {
        return {
          ...empty,
          ok: false,
          refusals: [refuse('planTokenMismatch', 'the file, machine or mode changed since it was planned')],
          message:
            'Nothing was sent: this is not the job whose footprint was shown. ' +
            'The file on disk, the machine or the mode changed. Plan it again and re-read the millimetres.',
        }
      }

      const f = built.planned.footprintMm
      const footprintLine =
        `Footprint ${(Math.round(f.w * 100) / 100).toFixed(2)} x ${(Math.round(f.h * 100) / 100).toFixed(2)} mm.`

      return sendStreamToMachine({
        machine: found.machine,
        chunks: built.chunks,
        byteTotal: built.planned.byteLength,
        footprintLine,
        onProgress: (p) => {
          /* Same pattern as `batch:progress`: straight back to the renderer that
             asked, and only while it is still there. */
          if (!event.sender.isDestroyed()) event.sender.send('skycut:progress', p)
        },
      })
    },
  )

  /* 🔴 "Stop sending", not "cancel". See `stopSending` for what it cannot do. */
  ipcMain.handle('skycut:stopSending', async (_e, sendId: string) => stopSending(sendId))

  /* So a renderer that was reloaded mid-send can find the send again rather than
     leaving a socket running with nothing watching it. */
  ipcMain.handle('skycut:activeSends', async () =>
    [...activeSends.values()].map((s) => ({ sendId: s.sendId, machineId: s.machineId, stopped: s.stopped })),
  )
}
