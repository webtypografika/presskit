/*
 * ─────────────────────────────────────────────────────────────────────────────
 * CUTTING PLOTTER — the tab the operator stands in front of.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `skycut-protocol.ts` turns millimetres into bytes. `skycut-engine.ts` holds
 * the machine cards and owns the socket. This file opens nothing, computes no
 * geometry and parses no handover file: every number on this screen came back
 * from `window.api.skycut.*`. If you find arithmetic on millimetres in here, it
 * is in the wrong file.
 *
 * ─── 🔴 THE WORDING, AND WHY IT IS NOT A STYLE CHOICE ───
 *
 * This machine NEVER ANSWERS. Plain TCP out, not one byte back, ever — measured
 * on the owner's own D60 on 06/10/2026. So the software cannot know a job was
 * cut, and this screen therefore says "Sent" and never "Cut", "Done",
 * "Finished" or "Complete".
 *
 * An operator who reads "Done" walks away from the machine. If the axes were
 * wrong, the sheet was loaded the other way up, or the knife never came down,
 * "Done" is the screen telling him a lie at the exact moment he stops looking.
 * "Sent" is the whole of what is in evidence: the bytes left PressKit. Every
 * success string here is the engine's own message, rendered verbatim, for the
 * same reason — one place to get it right.
 *
 * DO NOT "improve" this wording. It is not hedging, it is the only true thing
 * the software can say.
 *
 * ─── 🔴 THE THREE SAFETY RULES, AND WHERE EACH ONE IS ON THIS SCREEN ───
 *
 *  1. NO PRESSURE. There is no force or pressure field on the machine card
 *     below, because there is no such field in the engine's record and no such
 *     command in the protocol. «την πίεση την έχω ρυθμίσει εγώ» — he sets it on
 *     the machine. The card says so out loud rather than leaving a gap somebody
 *     later helpfully fills in.
 *  2. NOTHING COMES DOWN UNTIL THE OPERATOR HAS LOOKED AT THE HEAD ON THIS
 *     MACHINE. The head question has no default answer and no remembered one: it
 *     is cleared on every change of mode, of file and of machine, AND the answer
 *     carries the machine it was given for, so a stale one cannot be read back
 *     as an answer. The dry run — the one run where nothing comes down — is the
 *     first mode and the only one in accent colour; both head-down runs, the pen
 *     pass and the cut, are in danger colour. The live test only put a pen in
 *     after the knife came out, and the easy path on this screen is the one that
 *     cannot ruin a sheet.
 *
 *     🔴 TWO DEFECTS THAT WERE HERE, FIXED 08/10/2026, BOTH MEASURED FIRST:
 *
 *     • "Dry run - pen" was not a dry run. It emitted 272 head-down commands on
 *       the 446 job — byte-for-byte identical to the cut stream. Pressed on a
 *       machine with the knife still in, the button labelled "dry run" cut the
 *       job. The machine cannot tell a pen from a knife; only the operator can.
 *       So the honest split is head-down versus head-up, "dry run" belongs to
 *       the one mode that emits no head-down command, and the pen pass says HEAD
 *       COMES DOWN in its own name.
 *     • The answer about the head carried over between machines. Choosing a
 *       different cutter disarmed the plan but left the answer standing, so "a
 *       pen is fitted", looked at on the D24, was reused for the D60 with a
 *       knife in it. The comment here claimed otherwise; now it is true.
 *  3. THE FOOTPRINT IS READ IN MILLIMETRES BEFORE THE SEND ARMS. Structural
 *     here as well as in the engine: the send button does not exist in the tree
 *     until `armed` holds a plan, and it is rendered INSIDE the block that
 *     prints the footprint. There is no code path to a send that did not put
 *     those millimetres on screen first, and the engine refuses a send whose
 *     token does not match the plan that produced them.
 *
 * ─── 🔴 AND THE TWO THINGS THE SCREEN MUST SAY ABOUT *WHICH FILE* ───
 *
 * Both were defects here, both fixed 08/10/2026, and neither had anything to do
 * with the machine: they are about picking the wrong file off the disk.
 *
 *  • WHICH OF THE TWO CUT FILES IS THIS. A row that planned showed the quote
 *    number alone, and the filename only when the file was refused — so two cut
 *    files for one job drew two identical rows and the operator could pick the
 *    stale one. PressCal's export over the local HTTP server auto-increments to
 *    `name_2.ext` instead of overwriting, so a re-export after a change to the
 *    montage leaves both on disk: this is ordinary use, not an edge case. Every
 *    row now carries the file's own name with its sub-folder, the time it was
 *    written, and a label saying which is the newest of the set.
 *  • AND IS IT EVEN THIS JOB'S FILE. The tab held both halves of the comparison
 *    — the folder's `quoteId` from `.presskit` and the cut file's own
 *    `job.quoteId` — and never compared them, so a cut file that had wandered
 *    into the wrong job folder was sent as though it belonged there. This shop
 *    has been bitten three times in five weeks by one customer's files landing
 *    on another customer's job, so it is a GATE: see `quoteMismatch`.
 *
 * ─── 🔴 AND THE ONE FOR THIS BUILD ───
 *
 * NOTHING MAY REACH A REAL MACHINE DURING DEVELOPMENT. No address is compiled
 * into this file. The host field starts empty with a placeholder, nothing here
 * scans, discovers or broadcasts, and the only button that opens a socket
 * without sending bytes is "Check reachable", which the operator presses on a
 * machine he chose himself.
 *
 * ─── CANCELLATION: THERE IS NONE, DELIBERATELY ───
 *
 * «πάντως ούτε το SignMaster είχε ακύρωση. Την ακύρωση την έκανα πάντα από το
 * μηχάνημα.» (07/10/2026). So there is no cancel here. There is "Stop sending",
 * which closes the socket so the rest of the stream never leaves — and the text
 * beside it says that the MACHINE is stopped at the machine, because whatever
 * already went down the wire is in the machine's buffer and cannot be recalled.
 *
 * ─── WHY IT READS THE DISK ITSELF ───
 *
 * `fs:listDirectory` hides every dotfile (`file-system.ts:136`) and its watcher
 * is dotfile-blind and `depth: 0` (`:714`, `:718`). The handover file is
 * deliberately not dot-prefixed, but the tab needs the quote root AND its
 * immediate children in one answer, which that handler cannot give. So the scan
 * is `skycut:findCutFiles` in the main process. The `.presskit` walk-up is the
 * same idiom as `App.tsx:341-360`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import {
  Scissors, PenTool, Wifi, Ruler, TriangleAlert, LoaderCircle, Check, Plus,
  Trash2, Send, CircleStop, Info, RefreshCw, FileJson, Hand,
} from 'lucide-react'

// ═════════════════════════════════════════════════════════════════════════════
// THE CONTRACT, AS THE RENDERER SEES IT
// ═════════════════════════════════════════════════════════════════════════════
//
// `window.api` is not typed inside the renderer's own tsconfig (the preload's
// `ElectronAPI` lives outside `src/renderer/src`, which is all tsconfig.web.json
// includes). Rather than reach through an untyped global and lose every field
// name to `any`, the slice this tab uses is declared here and reached through
// one cast in `api()`. These shapes mirror `src/main/skycut-engine.ts` and
// `src/main/skycut-protocol.ts`; they are a VIEW of that contract, never a
// second definition of it — nothing here computes or defaults anything.

/* Mirrors `SkycutEmitMode` in `src/main/skycut-protocol.ts`. `penDown` is NOT a
   dry run — see `MODES` below and the header note above. */
type EmitMode = 'cut' | 'penDown' | 'travelOnly'
type AxisConvention = 'swapInvertFromSheet' | 'swapOnly' | 'direct'
type MarkArgOrder = 'heightWidth' | 'widthHeight'
type Provenance = 'measuredHere' | 'thirdParty'

interface MachineRecord {
  id: string
  label: string
  model: string
  unitsPerMm: number
  axisConvention: AxisConvention
  markScanOpcode: string
  markScanArgs: MarkArgOrder
  chunkBytes: number
  chunkPauseMs: number
  maxMaterialMm: { w: number; h: number } | null
  speedVs: number | null
  cutSpeedMmPerSec: number | null
  travelSpeedMmPerSec: number | null
  provenance: Provenance
  host: string
  port: number
  connectTimeoutMs: number
  writeTimeoutMs: number
  /* 🔴 NOTHING ABOUT FORCE OR PRESSURE. Safety rule 1 is enforced by the shape
     of the record: there is no field to fill in, so none can be sent. */
}

interface Refusal { code: string; detail?: string }
interface Note { code: string; detail?: string }

interface StoredMachines {
  machines: MachineRecord[]
  broken: { index: number; refusals: Refusal[] }[]
  activeMachineId: string | null
}

interface RectMm { x: number; y: number; w: number; h: number }

interface PlannedJob {
  machine: MachineRecord
  mode: EmitMode
  job: { quoteNumber?: string; quoteId?: string; title?: string; printedPdf?: string; cutPdf?: string }
  description: string[]
  footprintMm: RectMm
  sheetMm: { w: number; h: number }
  loading: { feedEdge: string; sideUp: string; mirrored: boolean }
  contourCount: number
  cutLengthMm: number
  travelMm: number
  lifts: number
  pointCount: number
  estimatedSeconds: number | null
  /* `originMm` is where the mark rectangle's first mark sits on the sheet. It
     is NOT sent to the machine — the scan command carries two numbers, the
     rectangle's size, and nothing else — it is where the operator parks the
     head. The engine says so in `description`, which this tab renders verbatim. */
  markScan: { opcode: string; heightMm: number; widthMm: number; originMm: { x: number; y: number } } | null
  byteLength: number
  chunkCount: number
  chunkBytes: number
  chunkPauseMs: number
  estimatedSendSeconds: number
  commandSample: string[]
  commandCount: number
  notes: Note[]
  planToken: string
  sendBlockers: Refusal[]
  canSend: boolean
}

type PlanResult =
  | { ok: true; planned: PlannedJob }
  | { ok: false; refusals: Refusal[]; notes: Note[] }

interface FoundFile { path: string; name: string; mtimeMs: number; size: number }

interface ProbeResult { ok: boolean; ms: number; refusals: Refusal[]; message: string }

interface Progress {
  sendId: string
  phase: 'connecting' | 'sending' | 'closing' | 'sent' | 'stopped' | 'failed'
  chunksSent: number
  chunkTotal: number
  bytesSent: number
  byteTotal: number
  elapsedMs: number
  message: string
}

interface SendResult {
  ok: boolean
  sendId: string
  chunksSent: number
  chunkTotal: number
  bytesSent: number
  byteTotal: number
  elapsedMs: number
  stopped: boolean
  refusals: Refusal[]
  message: string
}

interface SkycutApi {
  listPresets: () => Promise<MachineRecord[]>
  listMachines: () => Promise<StoredMachines>
  saveMachine: (m: MachineRecord) => Promise<{ ok: boolean; refusals: Refusal[]; machine?: MachineRecord }>
  deleteMachine: (id: string) => Promise<{ ok: boolean; machines: MachineRecord[] }>
  setActiveMachine: (id: string) => Promise<{ ok: boolean; refusals: Refusal[] }>
  findCutFiles: (rootPath: string) => Promise<{ files: FoundFile[] }>
  planJob: (filePath: string, machineId: string, options: { mode: EmitMode; bladeConfirmed?: boolean }) => Promise<PlanResult>
  probe: (machineId: string) => Promise<ProbeResult>
  send: (filePath: string, machineId: string, options: { mode: EmitMode; bladeConfirmed?: boolean }, planToken: string) => Promise<SendResult>
  stopSending: (sendId: string) => Promise<{ ok: boolean; refusals: Refusal[] }>
  activeSends: () => Promise<{ sendId: string; machineId: string; stopped: boolean }[]>
  onProgress: (cb: (p: Progress) => void) => () => void
}

interface FsSlice { readFile: (path: string) => Promise<Uint8Array> }

const api = (): SkycutApi =>
  (window as unknown as { api: { skycut: SkycutApi } }).api.skycut

const fsApi = (): FsSlice =>
  (window as unknown as { api: { fs: FsSlice } }).api.fs

// ═════════════════════════════════════════════════════════════════════════════
// CODES INTO SENTENCES
// ═════════════════════════════════════════════════════════════════════════════
//
// The engine returns codes, never prose, so that a refused action says WHY on
// screen. This is the one place that turns them into shop-floor English.
//
// 🔴 AN UNKNOWN CODE IS STILL SHOWN. `sentence()` falls back to printing the
// code itself, because the alternative — rendering nothing for a code this
// build has not met — is a refusal the operator never sees, which is how a
// screen comes to look like it worked. The spec calls for exactly this: a
// machine fact this build does not understand is refused with the reason
// visible.

const REFUSAL_TEXT: Record<string, string> = {
  // ── The handover file ──
  fileNotAnObject: 'That file is not a cut job at all.',
  unknownFormat: 'Not a PressCal cut file.',
  unsupportedFormatVersion: 'This cut file was written by a newer PressCal than this PressKit understands. Update PressKit.',
  unknownUnits: 'The cut file is not in millimetres.',
  unknownFrame: 'The cut file measures from somewhere this build does not know.',
  sheetMissing: 'The cut file does not say what size the sheet is.',
  sheetNotPositive: 'The sheet size in the cut file is not a real size.',
  groupsMissing: 'The cut file carries no cut groups.',
  noContours: 'The cut file carries no shapes to cut.',
  contourMalformed: 'One of the shapes in the cut file is broken.',
  marksMalformed: 'The registration marks in the cut file are broken.',
  // ── Loading: no defaults, by design ──
  loadingMissing: 'The cut file does not say how the sheet goes into the cutter. Nothing is guessed here - PressCal has to state it.',
  feedEdgeMissing: 'The cut file does not say which edge goes in first. The sheet must enter the cutter the same edge first as it entered the press, so this is never assumed.',
  feedEdgeUnknown: 'The cut file names a feed edge this build does not know.',
  feedEdgeNotSupported: 'Only a bottom-edge-first load is worked out. Any other edge is a rotation nobody has measured, and a guessed rotation cuts the job sideways.',
  sideUpMissing: 'The cut file does not say which printed side goes face up. Loaded the other way up the path is a mirror image - invisible on a symmetric shape, ruinous on an asymmetric one.',
  sideUpUnknown: 'The cut file names a side this build does not know.',
  mirroredMissing: 'The cut file does not say whether the job is mirrored.',
  mirroredNotSupported: 'A mirrored load is refused rather than guessed: the hinge of the reflection depends on how the sheet is turned, and that has not been measured.',
  // ── Geometry against the sheet and the machine ──
  contourOffSheet: 'A shape falls outside the sheet. That is not a cut - it is the head driving past the edge of the paper.',
  footprintExceedsMachine: 'The drawing is bigger than this machine takes.',
  // ── Things the protocol cannot express ──
  perforationNotSupported: 'That is a perforation group. Nothing in the proven command set says "perforate", and a through cut where a perforation was meant ruins the job.',
  // ── The machine card ──
  machineUnitsInvalid: 'The units-per-millimetre on this machine card is not usable. A wrong value cuts at double or half size and nothing says a word.',
  machineChunkInvalid: 'The chunk size or pause on this machine card is not usable.',
  markOpcodeInvalid: 'The mark-scan command on this machine card is not usable.',
  speedOutOfRange: 'The speed on this machine card is outside what this family accepts.',
  /* 🔴 Named, not swallowed. A card whose axes this build does not recognise
     used to be accepted and quietly given the researched convention, which on an
     asymmetric shape cuts a mirror image. The detail carries the offending word
     and what is accepted, so the card can be fixed rather than guessed at. */
  axisConventionUnknown: 'This machine card says its axes run a way this build does not know, so nothing is assumed about them - the wrong axis convention cuts a mirror image. Open the card and pick one of the axis settings in the list.',
  markScanArgsUnknown: 'This machine card says the mark-scan command takes its two numbers in an order this build does not know. Height and width the wrong way round scans a rectangle nobody printed. Open the card and pick one of the two orders in the list.',
  // ── The send ──
  bladeNotConfirmed: 'Nothing comes down until you have looked at the head on THIS machine and said what is fitted.',
  forceCommandInStream: 'Refused: a force or pressure command turned up in the stream. The pressure is set on the machine, never by PressKit. Report this - it means the emitter was changed.',
  headDownCommandInHeadUpStream: 'Refused: a job that must keep the head up produced a head-down command. Nothing was sent. Report this - it means the emitter was changed.',
  emitModeUnknown: 'That is not a run mode this build knows, so nothing is assumed about whether the head comes down. Nothing was sent.',
  // ── The transport ──
  machineNotFound: 'That machine card is gone.',
  machineRecordMalformed: 'A machine card is unreadable.',
  hostMissing: 'This machine card has no address, so there is nowhere to send it.',
  hostInvalid: 'That address is not usable. Just the IP or hostname - no http:// and no slashes.',
  portInvalid: 'That port is not usable.',
  timeoutInvalid: 'A timeout on this machine card is not usable.',
  cutFilePathInvalid: 'No cut file was given.',
  cutFileWrongSuffix: 'That is not a .cut.json file.',
  cutFileUnreadable: 'The cut file could not be read off the disk.',
  cutFileNotJson: 'The cut file is not valid JSON. If PressCal is still writing it, try again.',
  planTokenMissing: 'Nothing was sent: this job was never planned, so its footprint was never read out. Plan it and read the millimetres first.',
  planTokenMismatch: 'Nothing was sent: this is not the job whose footprint was shown. The file, the machine or the mode changed. Plan it again and re-read the millimetres.',
  connectTimeout: 'The machine did not answer the connection in time. Nothing was sent.',
  connectFailed: 'Could not reach the machine. Nothing was sent.',
  writeTimeout: 'The connection stopped draining partway. The machine keeps whatever it already received.',
  writeFailed: 'The connection failed partway. The machine keeps whatever it already received.',
  socketClosedEarly: 'The machine closed the connection partway. It keeps whatever it already received.',
  sendAlreadyRunning: 'This machine is already being sent to. Two streams down one socket are not two jobs - they are garbage coordinates.',
  sendNotFound: 'That send is already over.',
  stoppedByOperator: 'You stopped the send. The rest never left PressKit.',
}

const NOTE_TEXT: Record<string, string> = {
  noMarkScan: 'No registration marks in this file, so there is no camera scan. The cut is positioned from the machine\'s own origin - set it there yourself.',
  materialLimitUnknown: 'Nobody has measured what this machine takes, so nothing checked that the drawing fits. The footprint above is still exact - compare it with what is loaded.',
  totalsDisagree: 'PressCal\'s own length and ours differ by more than a rounding. Somebody should look before this is cut.',
  noMeasuredSpeed: 'No measured speed on this machine card, so no time estimate is offered rather than a made-up one.',
  axisConventionUnverified: 'The axis convention on this card is researched, not confirmed on this machine. Check it with a pen before it ever meets a blade.',
  profileThirdParty: 'This machine profile\'s numbers come from a third party, not from a machine we measured.',
  commandLongerThanChunk: 'One command was longer than the chunk size and travels in a chunk of its own.',
}

/* The code, in English, with its detail — and the code itself when this build
   has never met it. Never blank, never swallowed. */
function sentence(table: Record<string, string>, r: Refusal | Note): string {
  const text = table[r.code]
  if (text === undefined) {
    return `Unrecognised reason from the cutter engine: "${r.code}"` +
      (r.detail ? ` (${r.detail})` : '') +
      '. This build of the tab does not know that one, so nothing is assumed about it.'
  }
  return r.detail ? `${text} (${r.detail})` : text
}

// ═════════════════════════════════════════════════════════════════════════════
// SMALL HELPERS — formatting only
// ═════════════════════════════════════════════════════════════════════════════

const mm = (v: number): string => (Math.round(v * 100) / 100).toFixed(2)

/* 🔴 WHAT TELLS TWO CUT FILES FOR ONE JOB APART.
 *
 * Until 08/10/2026 a row that planned successfully showed the QUOTE NUMBER and
 * nothing else, and the filename appeared only when the file was refused. Two
 * cut files for the same quote therefore drew two identical rows. That is not an
 * edge case: PressCal's own export over the local HTTP server auto-increments to
 * `name_2.ext` rather than overwriting, so a re-export after a change to the
 * montage leaves both on disk, and the operator picking the first one picks the
 * stale geometry.
 *
 * So every row now carries the file's own name — with its sub-folder, because
 * the dated sub-folders are where the second copy usually lands — and the time
 * it was written, and the newest is labelled as such. */
function fileLabel(f: FoundFile, root: string | null): string {
  if (!root) return f.name
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const p = f.path.replace(/\\/g, '/')
  return p.toLowerCase().startsWith(`${r.toLowerCase()}/`) ? p.slice(r.length + 1) : f.name
}

/* The operator's own locale and his own clock, which is what he compares against
   when he remembers re-exporting the job after lunch. */
const whenWritten = (ms: number): string => {
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return new Date(ms).toISOString()
  }
}

/** The three loading facts in words, which is how the operator holds the sheet. */
function loadingWords(l: PlannedJob['loading']): string {
  return `${l.feedEdge} edge goes in first, ${l.sideUp} side face up` +
    (l.mirrored ? ', mirrored' : ', not mirrored')
}

/* ═══════════════════════════════════════════════════════════════════════════
   🔴 THE THREE MODES, AND THE ONE THAT MAY BE CALLED A DRY RUN
   ═══════════════════════════════════════════════════════════════════════════

   `headDown` is the SAME FACT as `SKYCUT_EMIT_MODES[id].headDown` in the
   protocol, carried here because this file may not import from the main process
   and because every colour, gate and sentence on this screen must come from one
   flag rather than from a sprinkling of `mode === ...` comparisons. The protocol
   is still the enforcer: it refuses a head-down mode without an answer, and it
   re-checks the finished bytes. If these ever disagree, the protocol wins and
   the send is refused — the screen cannot talk its way past it.

   WHAT WAS WRONG HERE UNTIL 08/10/2026. The pen mode was labelled "Dry run -
   pen" and sat second in this list, next to the real dry run, as if the two were
   a pair. It emitted 272 head-down commands on the 446 job — byte for byte the
   same stream as a cut. The machine has no idea what is in its head: `D` means
   come down, and the knife being out is a fact about the ROOM, not about the
   bytes. So "dry run" now means exactly one thing on this screen — nothing comes
   down — and the pen mode says HEAD DOWN in its own name, sits with the cut, and
   is coloured like the cut, because that is the risk it carries. */
const MODES: {
  id: EmitMode
  /* True when this mode emits head-down commands, i.e. whatever is clamped in
     the head meets the sheet. */
  headDown: boolean
  label: string
  blurb: string
  icon: React.ReactNode
}[] = [
  {
    id: 'travelOnly',
    headDown: false,
    label: 'Dry run - nothing comes down',
    blurb: 'The head traces the outline in the air with the pen or the knife held clear. Nothing touches the sheet, whatever is fitted. Start here: it is the only run on this screen that cannot mark or cut the material.',
    icon: <Hand size={15} />,
  },
  {
    id: 'penDown',
    headDown: true,
    label: 'Pen pass - THE HEAD COMES DOWN',
    blurb: 'Draws the outline with a pen. Not a dry run: the machine is sent exactly the same commands as a cut, and the only thing that keeps it from cutting is that the knife is physically out of the head. Use it to prove a machine\'s axes and scale on paper - after you have taken the knife out and checked.',
    icon: <PenTool size={15} />,
  },
  {
    id: 'cut',
    headDown: true,
    label: 'Cut - the blade comes down',
    blurb: 'The blade cuts the material. Nothing here can tell you afterwards whether it did.',
    icon: <Scissors size={15} />,
  },
]

const DRY_RUN_MODE: EmitMode = 'travelOnly'

const modeSpec = (id: EmitMode): (typeof MODES)[number] =>
  /* An id missing from the table would be a code change that forgot this list.
     The fallback is the CUT entry, not the dry run: an unknown mode must be
     treated as the dangerous one so it is gated, coloured and confirmed like a
     cut rather than waved through as safe. The protocol refuses it outright. */
  MODES.find(m => m.id === id) ?? MODES[MODES.length - 1]

type HeadState = 'unanswered' | 'pen' | 'blade' | 'nothing'

/* 🔴 SAFETY RULE 2 IS ABOUT THIS MACHINE, NOW.
 *
 * WHAT WAS WRONG HERE UNTIL 08/10/2026. The answer was a bare `HeadState`.
 * Choosing a different cutter disarmed the plan but left the answer standing, so
 * "a pen is fitted" — looked at and answered for the D24 — was silently reused
 * for the D60, which has a knife in it. The comment beside the question claimed
 * the answer resets whenever anything changes; it reset on a change of mode and
 * of file, and not on a change of machine.
 *
 * So the answer now CARRIES THE MACHINE IT IS ABOUT. It is read back through
 * `head` below, which yields `'unanswered'` the moment the active machine is not
 * the one the operator was looking at. That is structural: an edit that forgets
 * to clear the state cannot resurrect the answer, because the answer no longer
 * matches the machine. The effect that clears it as well is there so the buttons
 * on screen visibly go blank rather than showing a highlighted answer that no
 * longer counts. */
interface HeadAnswer {
  fitted: Exclude<HeadState, 'unanswered'>
  /* WHICH machine the operator was standing in front of when he answered — card
     id AND address, because a card re-pointed at another address is another
     machine, whatever the id says, and that machine's head was never looked
     at. Built by `machineKey` below; never compared field by field at the call
     sites. */
  machineKey: string
}

/* The identity of the machine an answer about the head can belong to. */
const machineKeyOf = (m: MachineRecord | null): string | null =>
  m ? `${m.id}|${m.host}:${m.port}` : null

/* ── Styles, inline with the app's own custom properties ── */
const card: React.CSSProperties = {
  padding: 14, borderRadius: 10,
  background: 'var(--th-bg-primary)', border: '1px solid var(--th-border)',
}
const heading: React.CSSProperties = {
  fontSize: 11, color: '#64748b', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.05em',
}
const inp: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 8,
  background: 'var(--th-bg-secondary)', border: '1px solid var(--th-border)',
  color: 'var(--th-text-primary)', fontSize: 13, outline: 'none',
}
const label: React.CSSProperties = {
  fontSize: 11, color: '#64748b', fontWeight: 600, display: 'block', marginBottom: 4,
}
const btn: React.CSSProperties = {
  padding: '9px 14px', borderRadius: 8, border: '1px solid var(--th-border)',
  background: 'transparent', color: 'var(--th-text-secondary)',
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
}
const DANGER = '#ef4444'
const WARN = '#f59e0b'
const GOOD = '#22c55e'

function Reasons({ title, items, table, tone }: {
  title: string
  items: (Refusal | Note)[]
  table: Record<string, string>
  tone: 'refusal' | 'note'
}): React.ReactNode {
  if (items.length === 0) return null
  const colour = tone === 'refusal' ? DANGER : WARN
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 8,
      background: tone === 'refusal' ? 'rgba(239,68,68,0.07)' : 'rgba(245,158,11,0.07)',
      border: `1px solid ${tone === 'refusal' ? 'rgba(239,68,68,0.28)' : 'rgba(245,158,11,0.28)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, color: colour, fontSize: 12, fontWeight: 700 }}>
        {tone === 'refusal' ? <TriangleAlert size={14} /> : <Info size={14} />}
        {title}
      </div>
      {items.map((r, i) => (
        <div key={i} style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--th-text-primary)', marginBottom: i === items.length - 1 ? 0 : 6 }}>
          {sentence(table, r)}
        </div>
      ))}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// THE TAB
// ═════════════════════════════════════════════════════════════════════════════

export function CuttingPlotter(): React.ReactNode {
  const currentPath = useAppStore(s => s.currentPath)

  // ── Where we are standing ──
  const [quoteRoot, setQuoteRoot] = useState<string | null>(null)
  const [quoteId, setQuoteId] = useState<string>('')
  const [lookedUp, setLookedUp] = useState(false)
  /* Set only when the operator says "look here instead", never inferred. */
  const [forcedRoot, setForcedRoot] = useState<string | null>(null)

  // ── Machines ──
  const [stored, setStored] = useState<StoredMachines>({ machines: [], broken: [], activeMachineId: null })
  const [presets, setPresets] = useState<MachineRecord[]>([])
  const [draft, setDraft] = useState<MachineRecord | null>(null)
  const [cardRefusals, setCardRefusals] = useState<Refusal[]>([])
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const [probing, setProbing] = useState(false)

  // ── The jobs on disk ──
  const [files, setFiles] = useState<FoundFile[] | null>(null)
  const [rows, setRows] = useState<Record<string, PlanResult>>({})
  const [scanning, setScanning] = useState(false)
  const [selected, setSelected] = useState<string>('')

  // ── The send ──
  /* The dry run is where every job starts, named from the one constant. */
  const [mode, setMode] = useState<EmitMode>(DRY_RUN_MODE)
  const [headAnswer, setHeadAnswer] = useState<HeadAnswer | null>(null)
  /* 🔴 THE PATH of the file whose quote clash the operator has looked into and
     accepted — never a bare boolean. An acknowledgement is about ONE file, the
     same way the head answer is about one machine, so picking a different file
     cannot inherit it: the comparison below is against `selected`. */
  const [quoteAck, setQuoteAck] = useState<string | null>(null)
  const [armed, setArmed] = useState<PlannedJob | null>(null)
  const [armRefusals, setArmRefusals] = useState<Refusal[]>([])
  const [armNotes, setArmNotes] = useState<Note[]>([])
  const [arming, setArming] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [result, setResult] = useState<SendResult | null>(null)
  const [sending, setSending] = useState(false)
  const sendIdRef = useRef<string>('')

  const activeMachine = useMemo(
    () => stored.machines.find(m => m.id === stored.activeMachineId) ?? null,
    [stored],
  )

  /* The most recently written cut file in this job, by its own timestamp rather
     than by its position in the list. Used to label the newest row and to warn
     on the older ones — see `fileLabel` for why that matters. */
  const newestMtime = useMemo(
    () => (files && files.length > 0 ? Math.max(...files.map(f => f.mtimeMs)) : null),
    [files],
  )

  /* The mode's own facts, in one place, so no gate or colour below re-derives
     "is this a head-down run" from a comparison of its own. */
  const spec = useMemo(() => modeSpec(mode), [mode])

  const activeMachineKey = useMemo(() => machineKeyOf(activeMachine), [activeMachine])

  /* 🔴 SAFETY RULE 2, READ BACK. An answer given for another machine is NOT an
     answer: it degrades to 'unanswered' here, which is what every gate below
     already refuses. He confirms the head on the machine in front of him, and
     this is what makes that confirmation stop at that machine. */
  const head = useMemo<HeadState>(() => {
    if (!headAnswer || activeMachineKey === null) return 'unanswered'
    if (headAnswer.machineKey !== activeMachineKey) return 'unanswered'
    return headAnswer.fitted
  }, [headAnswer, activeMachineKey])

  /* And cleared outright when the machine changes, so the buttons on screen go
     blank instead of leaving a highlighted answer that no longer counts. The
     binding above is the safety; this is the honesty. */
  useEffect(() => {
    setHeadAnswer(null)
  }, [activeMachineKey])

  /* 🔴 SAFETY RULE 3's DISARM. Anything that could change what goes down the
     wire throws the plan away, so the footprint on screen can never belong to a
     different job than the armed send. The engine's token would catch a changed
     FILE; this catches a changed mode, machine or selection, where the token
     would also catch it but the operator would have been staring at stale
     millimetres in the meantime. */
  const disarm = useCallback(() => {
    setArmed(null)
    setArmRefusals([])
    setArmNotes([])
    setResult(null)
  }, [])

  // ─── Walk up for .presskit, the App.tsx:341-360 idiom ──────────────────────

  useEffect(() => {
    let cancelled = false
    setLookedUp(false)
    setQuoteRoot(null)
    setQuoteId('')
    setForcedRoot(null)
    if (!currentPath) { setLookedUp(true); return }

    const run = async (): Promise<void> => {
      const components = currentPath.replace(/\\/g, '/').split('/').filter(Boolean)
      for (let i = components.length; i >= 1; i--) {
        const dir = components.slice(0, i).join('/')
        try {
          const buf = await fsApi().readFile(dir + '/.presskit')
          if (cancelled) return
          const parsed = JSON.parse(new TextDecoder().decode(buf)) as { quoteId?: string }
          if (parsed.quoteId) {
            setQuoteRoot(dir)
            setQuoteId(parsed.quoteId)
            break
          }
        } catch { /* not a job folder; keep walking up */ }
      }
      if (!cancelled) setLookedUp(true)
    }
    void run()
    return () => { cancelled = true }
  }, [currentPath])

  // ─── Machine cards ────────────────────────────────────────────────────────

  const reloadMachines = useCallback(async () => {
    const [m, p] = await Promise.all([api().listMachines(), api().listPresets()])
    setStored(m)
    setPresets(p)
  }, [])

  useEffect(() => { void reloadMachines() }, [reloadMachines])

  /* A send already running when this tab mounts — the operator hid the
     inspector, or switched sub-tab, and came back. The engine keeps the socket;
     without this the stream would run with nothing watching it. */
  useEffect(() => {
    void (async () => {
      const live = await api().activeSends()
      if (live.length > 0 && !live[0].stopped) {
        sendIdRef.current = live[0].sendId
        setSending(true)
      }
    })()
  }, [])

  useEffect(() => {
    const off = api().onProgress(p => {
      sendIdRef.current = p.sendId
      setProgress(p)
      if (p.phase === 'sent' || p.phase === 'stopped' || p.phase === 'failed') setSending(false)
    })
    return off
  }, [])

  // ─── Find the cut files ───────────────────────────────────────────────────

  const root = forcedRoot ?? quoteRoot

  const scan = useCallback(async () => {
    if (!root) return
    setScanning(true)
    setSelected('')
    disarm()
    try {
      const found = await api().findCutFiles(root)
      setFiles(found.files)
    } catch {
      setFiles([])
    }
    setScanning(false)
  }, [root, disarm])

  useEffect(() => {
    if (root) void scan()
    else { setFiles(null); setRows({}) }
  }, [root, scan])

  /* One DRY-RUN plan per file, which is what fills the rows.
   *
   * WHY A PLAN AND NOT A READ OF THE JSON. The footprint, the cut length and
   * the contour count are the flattened geometry at THIS machine's step — the
   * engine's arithmetic, not the renderer's. The dry run needs no answer about
   * the head and opens no socket, so it is free to run on every row, and a
   * file that cannot be planned shows its refusal in its own row instead of
   * looking like an ordinary job. */
  useEffect(() => {
    if (!files || !activeMachine) { setRows({}); return }
    let cancelled = false
    void (async () => {
      const out: Record<string, PlanResult> = {}
      for (const f of files) {
        try {
          out[f.path] = await api().planJob(f.path, activeMachine.id, { mode: DRY_RUN_MODE })
        } catch (e) {
          out[f.path] = { ok: false, refusals: [{ code: 'cutFileUnreadable', detail: String(e) }], notes: [] }
        }
        if (cancelled) return
      }
      if (!cancelled) setRows(out)
    })()
    return () => { cancelled = true }
  }, [files, activeMachine])

  // ─── Arming: safety rule 3's only door ────────────────────────────────────

  /* The head question, answered locally, BEFORE the engine is asked. The engine
     enforces "an operator confirmed something"; this enforces that what he
     confirmed matches what he asked for. Saying "a pen is in" and then asking
     for a cut is a contradiction, and the screen says so rather than passing a
     true boolean along. */
  const headMismatch = useMemo<string | null>(() => {
    if (!spec.headDown) return null
    if (head === 'unanswered') {
      return activeMachine
        ? `Look at the head on the ${activeMachine.label} and say what is fitted. An answer given for another machine does not count here.`
        : 'Choose a machine first.'
    }
    if (head === 'nothing') return 'You said nothing is fitted in the head. Fit a pen for a pen pass, or a blade for a cut, then answer again.'
    if (mode === 'penDown' && head === 'blade') {
      return 'You said a BLADE is fitted. A pen pass sends the machine the same commands as a cut, so with a blade in the head it CUTS THE SHEET. Take the blade out and answer again, or choose the dry run, where nothing comes down at all.'
    }
    if (mode === 'cut' && head === 'pen') {
      return 'You said a PEN is fitted, but this is a cut. Fit the blade and answer again, or choose the pen pass.'
    }
    return null
  }, [mode, spec, head, activeMachine])

  /* ═════════════════════════════════════════════════════════════════════════
     🔴 THE FILE'S OWN JOB AGAINST THE FOLDER'S JOB
     ═════════════════════════════════════════════════════════════════════════

     This tab has held both halves of this comparison since it was written and
     never made it: `quoteId`, read out of the folder's own `.presskit` by the
     walk-up above, and `job.quoteId`, which PressCal stamps inside the cut file.
     A cut file that wandered into the wrong job folder — dragged, copied,
     exported while the wrong job was open — was sent as though it belonged
     there, with the footprint of a shape nobody on this sheet ordered.

     This shop has been bitten three times in five weeks by one customer's files
     landing on another customer's job, so the comparison is a GATE and not a
     line of text: the plan cannot be worked out until the operator has been told
     the two do not agree and has said he looked into it.

     WHEN IT CANNOT BE ASKED. If the operator pointed the tab at a folder that is
     not a job folder (`forcedRoot`), there is no `.presskit` and therefore no
     folder quote to compare against; if the cut file carries no `quoteId`, there
     is nothing on its side either. Neither is a mismatch — it is a comparison
     that could not be made, and `quoteUncheckable` below says so in those words
     rather than passing silently for agreement. */
  const quoteMismatch = useMemo<{ folder: string; file: string; fileNumber?: string } | null>(() => {
    if (!selected) return null
    const r = rows[selected]
    if (!r || r.ok !== true) return null
    const fileQuote = r.planned.job.quoteId
    if (quoteRoot === null || quoteId === '' || typeof fileQuote !== 'string' || fileQuote === '') return null
    if (fileQuote === quoteId) return null
    return { folder: quoteId, file: fileQuote, fileNumber: r.planned.job.quoteNumber }
  }, [selected, rows, quoteRoot, quoteId])

  /* Said out loud rather than left to look like a pass. */
  const quoteUncheckable = useMemo<string | null>(() => {
    if (!selected) return null
    const r = rows[selected]
    if (!r || r.ok !== true) return null
    const fileQuote = r.planned.job.quoteId
    if (quoteRoot === null || quoteId === '') {
      return 'Nothing checked which job this cut file belongs to: you pointed the tab at a folder that is not a PressCal job folder, so there is no job here to compare it against.'
    }
    if (typeof fileQuote !== 'string' || fileQuote === '') {
      return 'This cut file does not say which job it belongs to, so nothing could check it against this folder. Read the quote number and the shape sizes above against the job in front of you.'
    }
    return null
  }, [selected, rows, quoteRoot, quoteId])

  /* The acknowledgement counts only for the file it was given for. */
  const quoteAcked = quoteAck !== null && quoteAck === selected

  const arm = useCallback(async () => {
    if (!selected || !activeMachine || headMismatch) return
    /* 🔴 The quote clash is a gate, not a notice. */
    if (quoteMismatch && !quoteAcked) return
    setArming(true)
    setArmed(null)
    setArmRefusals([])
    setArmNotes([])
    setResult(null)
    try {
      const r = await api().planJob(selected, activeMachine.id, {
        mode,
        /* Only the operator's own answer, for THIS machine, on this call. `head`
           is already 'unanswered' if the answer was given for another machine,
           so there is nothing here that can carry one over. */
        bladeConfirmed: spec.headDown ? head === 'pen' || head === 'blade' : undefined,
      })
      if (r.ok) setArmed(r.planned)
      else { setArmRefusals(r.refusals); setArmNotes(r.notes) }
    } catch (e) {
      setArmRefusals([{ code: 'cutFileUnreadable', detail: String(e) }])
    }
    setArming(false)
  }, [selected, activeMachine, mode, spec, head, headMismatch, quoteMismatch, quoteAcked])

  const doSend = useCallback(async () => {
    if (!armed || !activeMachine || !selected) return
    setSending(true)
    setProgress(null)
    setResult(null)
    try {
      const r = await api().send(
        selected,
        activeMachine.id,
        { mode, bladeConfirmed: spec.headDown ? head === 'pen' || head === 'blade' : undefined },
        armed.planToken,
      )
      setResult(r)
    } catch (e) {
      setResult({
        ok: false, sendId: '', chunksSent: 0, chunkTotal: 0, bytesSent: 0, byteTotal: 0,
        elapsedMs: 0, stopped: false,
        refusals: [{ code: 'writeFailed', detail: String(e) }],
        message: 'The send failed before it reported anything. Check the machine.',
      })
    }
    setSending(false)
    /* 🔴 One plan, one send. The token is spent: sending the same job again
       means reading the footprint again. */
    setArmed(null)
  }, [armed, activeMachine, selected, mode, spec, head])

  const stop = useCallback(async () => {
    if (!sendIdRef.current) return
    await api().stopSending(sendIdRef.current)
  }, [])

  const checkReachable = useCallback(async () => {
    if (!activeMachine) return
    setProbing(true)
    setProbe(null)
    try { setProbe(await api().probe(activeMachine.id)) }
    catch (e) { setProbe({ ok: false, ms: 0, refusals: [{ code: 'connectFailed', detail: String(e) }], message: 'Could not reach the machine. Nothing was sent.' }) }
    setProbing(false)
  }, [activeMachine])

  // ─── Machine card editing ─────────────────────────────────────────────────

  const startFromPreset = (p: MachineRecord): void => {
    /* 🔴 PRESETS ARE DATA. Picking one FILLS the fields; from there every value
       belongs to the operator. The address stays empty — nobody's IP is a
       sensible default and an empty host is refused — while the port comes
       prefilled, because it is a device setting we measured. */
    setDraft({ ...p, id: `skycut-${Date.now()}`, host: '', provenance: p.provenance })
    setCardRefusals([])
  }

  const saveDraft = async (): Promise<void> => {
    if (!draft) return
    const r = await api().saveMachine(draft)
    if (!r.ok) { setCardRefusals(r.refusals); return }
    setCardRefusals([])
    setDraft(null)
    await reloadMachines()
    disarm()
  }

  const removeMachine = async (id: string): Promise<void> => {
    await api().deleteMachine(id)
    await reloadMachines()
    disarm()
  }

  const pickMachine = async (id: string): Promise<void> => {
    await api().setActiveMachine(id)
    await reloadMachines()
    setProbe(null)
    /* 🔴 THE ANSWER ABOUT THE HEAD DOES NOT TRAVEL BETWEEN MACHINES. Until
       08/10/2026 this handler disarmed the plan and left the answer standing:
       "a pen is fitted", looked at on the D24, was reused for the D60 with a
       knife in it. Cleared here, and — because a handler can be forgotten —
       the answer also carries the machine it was given for, so a stale one
       cannot be read back as an answer. */
    setHeadAnswer(null)
    disarm()
  }

  const numField = (
    key: keyof MachineRecord,
    text: string,
    hint?: string,
  ): React.ReactNode => (
    <div>
      <label style={label}>{text}</label>
      <input
        type="number"
        value={String((draft as unknown as Record<string, unknown>)[key] ?? '')}
        onChange={e => setDraft(d => d ? ({ ...d, [key]: e.target.value === '' ? 0 : Number(e.target.value) }) : d)}
        style={inp}
      />
      {hint && <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>{hint}</div>}
    </div>
  )

  const optNumField = (
    key: 'speedVs' | 'cutSpeedMmPerSec' | 'travelSpeedMmPerSec',
    text: string,
    hint: string,
  ): React.ReactNode => (
    <div>
      <label style={label}>{text}</label>
      <input
        type="number"
        placeholder="not measured"
        value={draft && draft[key] !== null ? String(draft[key]) : ''}
        onChange={e => setDraft(d => d ? ({ ...d, [key]: e.target.value === '' ? null : Number(e.target.value) }) : d)}
        style={inp}
      />
      <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>{hint}</div>
    </div>
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  const selectedPlan = selected ? rows[selected] : undefined

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── What this is ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <Scissors size={18} style={{ color: 'var(--th-accent)', flexShrink: 0, marginTop: 2 }} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--th-text-primary)' }}>
            Cutting plotter
          </div>
          <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5, marginTop: 2 }}>
            Sends a PressCal cut file to the plotter over the network. The machine never
            reports back, so this screen can only ever tell you what was sent - never that
            a job was cut.
          </div>
        </div>
      </div>

      {/* ── 1. THE MACHINE ───────────────────────────────────────────────── */}
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={heading}>1 - The machine</div>

        {stored.broken.length > 0 && (
          <Reasons
            tone="refusal"
            title={`${stored.broken.length} machine card${stored.broken.length === 1 ? '' : 's'} unreadable`}
            items={stored.broken.flatMap(b => b.refusals)}
            table={REFUSAL_TEXT}
          />
        )}

        {stored.machines.length === 0 && !draft && (
          <div style={{ fontSize: 13, color: 'var(--th-text-primary)', lineHeight: 1.5 }}>
            No machine yet. Start from a model below - it fills the fields, and every one of
            them is yours to change afterwards.
          </div>
        )}

        {stored.machines.map(m => {
          const on = m.id === stored.activeMachineId
          return (
            <div
              key={m.id}
              style={{
                padding: '10px 12px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10,
                border: `1px solid ${on ? 'var(--th-accent)' : 'var(--th-border)'}`,
                background: on ? 'rgba(110,200,200,0.08)' : 'transparent',
              }}
            >
              <button
                onClick={() => void pickMachine(m.id)}
                style={{ ...btn, border: 'none', background: 'transparent', flex: 1, textAlign: 'left', padding: 0, display: 'block' }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--th-text-primary)' }}>
                  {m.label} {on && <Check size={13} style={{ color: 'var(--th-accent)', display: 'inline', verticalAlign: 'middle' }} />}
                </div>
                <div style={{ fontSize: 12, color: '#64748b', fontWeight: 400 }}>
                  {m.host ? `${m.host}:${m.port}` : 'no address yet'}
                  {'  ·  '}{m.unitsPerMm} units/mm{'  ·  '}{m.markScanOpcode}
                  {m.provenance === 'thirdParty' && '  ·  third-party numbers'}
                </div>
              </button>
              <button onClick={() => { setDraft(m); setCardRefusals([]) }} style={{ ...btn, padding: '6px 10px' }}>Edit</button>
              <button
                onClick={() => void removeMachine(m.id)}
                style={{ ...btn, padding: '6px 10px', color: DANGER, borderColor: 'rgba(239,68,68,0.3)' }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          )
        })}

        {!draft && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {presets.map(p => (
              <button key={p.id} onClick={() => startFromPreset(p)} style={btn}>
                <Plus size={13} /> {p.label}
              </button>
            ))}
          </div>
        )}

        {/* ── The machine card ── */}
        {draft && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 6 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={label}>Name</label>
                <input value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} style={inp} />
              </div>
              <div>
                <label style={label}>Model</label>
                <input value={draft.model} onChange={e => setDraft({ ...draft, model: e.target.value })} style={inp} />
              </div>
              <div>
                <label style={label}>Address</label>
                {/* 🔴 EMPTY, AND THE PLACEHOLDER IS NOT AN ADDRESS EITHER.
                    `skycut-engine.ts` keeps no address anywhere, "not even as an
                    example — one that can be copied out of a comment is one that
                    can end up in a field", and the same goes for a field's own
                    placeholder. So this asks for the address in words and offers
                    nothing to copy. An empty host is refused by the engine, so a
                    half-filled card cannot send. */}
                <input
                  value={draft.host}
                  placeholder="the cutter's address on your network"
                  onChange={e => setDraft({ ...draft, host: e.target.value })}
                  style={inp}
                />
              </div>
              {numField('port', 'Port')}
              {numField('unitsPerMm', 'Machine units per millimetre', '40 measured on the D60. Wrong here cuts at double or half size, silently.')}
              <div>
                <label style={label}>Axes</label>
                <select
                  value={draft.axisConvention}
                  onChange={e => setDraft({ ...draft, axisConvention: e.target.value as AxisConvention })}
                  style={inp}
                >
                  <option value="swapInvertFromSheet">Swapped and inverted (researched default)</option>
                  <option value="swapOnly">Swapped only</option>
                  <option value="direct">Same as the sheet</option>
                </select>
              </div>
              <div>
                <label style={label}>Mark-scan command</label>
                <input value={draft.markScanOpcode} onChange={e => setDraft({ ...draft, markScanOpcode: e.target.value })} style={inp} />
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>TB25 measured on the D60; the D24 is documented as TB26.</div>
              </div>
              <div>
                <label style={label}>Mark-scan argument order</label>
                <select
                  value={draft.markScanArgs}
                  onChange={e => setDraft({ ...draft, markScanArgs: e.target.value as MarkArgOrder })}
                  style={inp}
                >
                  <option value="heightWidth">Height, then width</option>
                  <option value="widthHeight">Width, then height</option>
                </select>
              </div>
              {numField('chunkBytes', 'Bytes per chunk', '1024, as the maker\'s own software paces it.')}
              {numField('chunkPauseMs', 'Pause between chunks (ms)', '450, measured.')}
              <div>
                <label style={label}>Widest material it takes (mm)</label>
                <input
                  type="number"
                  placeholder="not measured"
                  value={draft.maxMaterialMm ? String(draft.maxMaterialMm.w) : ''}
                  onChange={e => setDraft({
                    ...draft,
                    maxMaterialMm: e.target.value === ''
                      ? null
                      : { w: Number(e.target.value), h: draft.maxMaterialMm?.h ?? 0 },
                  })}
                  style={inp}
                />
              </div>
              <div>
                <label style={label}>How far the head travels (mm)</label>
                <input
                  type="number"
                  placeholder="not measured"
                  value={draft.maxMaterialMm ? String(draft.maxMaterialMm.h) : ''}
                  onChange={e => setDraft({
                    ...draft,
                    maxMaterialMm: e.target.value === ''
                      ? null
                      : { w: draft.maxMaterialMm?.w ?? 0, h: Number(e.target.value) },
                  })}
                  style={inp}
                />
              </div>
              {optNumField('speedVs', 'Speed setting', 'Sent only when you set it. Left blank, the machine keeps its own.')}
              {optNumField('cutSpeedMmPerSec', 'Measured cutting speed (mm/s)', 'Blank means no time estimate rather than a made-up one.')}
              {optNumField('travelSpeedMmPerSec', 'Measured travel speed (mm/s)', 'Blank means no time estimate rather than a made-up one.')}
              {numField('connectTimeoutMs', 'Connection timeout (ms)')}
              {numField('writeTimeoutMs', 'Write timeout (ms)')}
            </div>

            {/* 🔴 SAFETY RULE 1, said out loud exactly where somebody would
                otherwise go looking for the field. There is no pressure or
                force input on this card because there is none in the engine's
                record and no such command in the protocol. «την πίεση την έχω
                ρυθμίσει εγώ» — he sets it on the machine. */}
            <div style={{
              padding: '10px 12px', borderRadius: 8, fontSize: 13, lineHeight: 1.5,
              background: 'rgba(110,200,200,0.06)', border: '1px solid var(--th-border)',
              color: 'var(--th-text-primary)',
            }}>
              <strong>There is no pressure setting here, on purpose.</strong> Blade pressure is
              set on the machine, by you. PressKit has no field for it and sends no pressure
              command, so it cannot disagree with the machine by accident.
            </div>

            <Reasons tone="refusal" title="This card cannot be saved" items={cardRefusals} table={REFUSAL_TEXT} />

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => void saveDraft()}
                style={{ ...btn, background: 'var(--th-accent)', color: '#fff', border: 'none' }}
              >
                <Check size={14} /> Save machine
              </button>
              <button onClick={() => { setDraft(null); setCardRefusals([]) }} style={btn}>Cancel</button>
            </div>
          </div>
        )}

        {/* ── Check reachable: a connection, zero bytes, a close ── */}
        {activeMachine && !draft && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => void checkReachable()} disabled={probing} style={{ ...btn, opacity: probing ? 0.5 : 1 }}>
                {probing ? <LoaderCircle size={14} className="animate-spin" /> : <Wifi size={14} />}
                Check reachable
              </button>
              <span style={{ fontSize: 12, color: '#64748b' }}>
                Opens a connection, sends nothing at all, closes it. Safe with a blade in.
              </span>
            </div>
            {probe && (
              <div style={{
                padding: '10px 12px', borderRadius: 8, fontSize: 13, lineHeight: 1.5,
                color: 'var(--th-text-primary)',
                background: probe.ok ? 'rgba(34,197,94,0.07)' : 'rgba(239,68,68,0.07)',
                border: `1px solid ${probe.ok ? 'rgba(34,197,94,0.28)' : 'rgba(239,68,68,0.28)'}`,
              }}>
                {probe.message}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 2. THE JOB ───────────────────────────────────────────────────── */}
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={heading}>2 - The job</div>
          {root && (
            <button onClick={() => void scan()} disabled={scanning} style={{ ...btn, padding: '5px 9px', fontSize: 12 }}>
              {scanning ? <LoaderCircle size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Look again
            </button>
          )}
        </div>

        {/* Which quote we are standing in */}
        {!lookedUp && (
          <div style={{ fontSize: 13, color: '#64748b' }}>Looking for the job folder...</div>
        )}

        {lookedUp && !quoteRoot && !forcedRoot && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 13, color: 'var(--th-text-primary)', lineHeight: 1.5 }}>
              This folder is not inside a PressCal job folder - there is no <code>.presskit</code>{' '}
              here or in any folder above it, so the tab does not know which quote you are
              standing in.
            </div>
            {currentPath && (
              <button onClick={() => setForcedRoot(currentPath)} style={btn}>
                <FileJson size={14} /> Look for cut files in this folder anyway
              </button>
            )}
          </div>
        )}

        {root && (
          <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
            {quoteRoot
              ? <>Job folder <span style={{ fontFamily: 'monospace', color: '#94a3b8' }}>{quoteRoot}</span>, quote <span style={{ fontFamily: 'monospace', color: '#94a3b8' }}>{quoteId}</span></>
              : <>Looking in <span style={{ fontFamily: 'monospace', color: '#94a3b8' }}>{root}</span> because you asked - this is not a job folder</>}
          </div>
        )}

        {root && files !== null && files.length === 0 && !scanning && (
          <div style={{ fontSize: 13, color: 'var(--th-text-primary)', lineHeight: 1.5 }}>
            No cut files here. PressCal writes a <code>.cut.json</code> beside the cut PDF in the
            dated sub-folder; this tab looks in the job folder and one level down, no deeper.
          </div>
        )}

        {root && files !== null && files.length > 0 && !activeMachine && (
          <div style={{ fontSize: 13, color: 'var(--th-text-primary)', lineHeight: 1.5 }}>
            {files.length} cut file{files.length === 1 ? '' : 's'} found. Pick a machine above -
            the footprint and the cut length are worked out at that machine&apos;s own step, so
            there are no numbers to show until one is chosen.
          </div>
        )}

        {/* The rows */}
        {activeMachine && files?.map(f => {
          const r = rows[f.path]
          const on = selected === f.path
          /* 🔴 WHICH FILE IS THIS, AND IS IT THE LATEST ONE. The engine sorts by
             modified time, newest first, so the newest is the one with the
             greatest mtime — asked of the number rather than of the position, so
             a change to the sort order cannot quietly move the label. */
          const isNewest = f.mtimeMs === newestMtime && files.length > 1
          const isStale = !isNewest && files.length > 1
          /* The file's own identity, on EVERY row — planned, refused or still
             reading. Two cut files for one quote are told apart here. */
          const stamp = (
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'monospace' }}>{fileLabel(f, root)}</span>
              <span>written {whenWritten(f.mtimeMs)}</span>
              {isNewest && (
                <span style={{ color: GOOD, fontWeight: 700 }}>NEWEST OF {files.length}</span>
              )}
              {isStale && (
                <span style={{ color: WARN, fontWeight: 700 }}>OLDER - a newer cut file exists for this job</span>
              )}
            </div>
          )
          /* 🔴 THE FILE'S OWN QUOTE AGAINST THE FOLDER'S. See `quoteMismatch`
             below for why this is not a formality in this shop. Shown on the row
             as well as in section 3, so a wandered file is visible before it is
             even picked. */
          const rowQuoteClash =
            r?.ok === true && quoteRoot !== null && quoteId !== '' &&
            typeof r.planned.job.quoteId === 'string' && r.planned.job.quoteId !== '' &&
            r.planned.job.quoteId !== quoteId
          return (
            <button
              key={f.path}
              onClick={() => { setSelected(f.path); setMode(DRY_RUN_MODE); setHeadAnswer(null); setQuoteAck(null); disarm() }}
              style={{
                padding: '12px 14px', borderRadius: 8, textAlign: 'left', cursor: 'pointer',
                border: `1px solid ${on ? 'var(--th-accent)' : 'var(--th-border)'}`,
                background: on ? 'rgba(110,200,200,0.08)' : 'transparent',
                color: 'var(--th-text-primary)', display: 'block', width: '100%',
              }}
            >
              {r === undefined && (
                <>
                  <div style={{ fontSize: 13, color: '#64748b' }}>reading...</div>
                  {stamp}
                </>
              )}

              {r?.ok === false && (
                <>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{f.name}</div>
                  {stamp}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: DANGER, fontSize: 12, fontWeight: 700, margin: '8px 0 4px' }}>
                    <TriangleAlert size={13} /> Refused - nothing can be sent from this file
                  </div>
                  {r.refusals.map((x, i) => (
                    <div key={i} style={{ fontSize: 13, lineHeight: 1.5 }}>{sentence(REFUSAL_TEXT, x)}</div>
                  ))}
                </>
              )}

              {r?.ok === true && (
                <>
                  {/* 🔴 The quote number no longer stands alone: `stamp` under it
                      carries the filename and the time, because two cut files for
                      one quote used to draw two identical rows. */}
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {r.planned.job.quoteNumber ?? 'The file names no quote number'}
                  </div>
                  {r.planned.job.title && (
                    <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 1 }}>{r.planned.job.title}</div>
                  )}
                  {stamp}
                  {rowQuoteClash && (
                    <div style={{
                      marginTop: 8, padding: '8px 10px', borderRadius: 7,
                      background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.28)',
                      color: DANGER, fontSize: 12, fontWeight: 700, lineHeight: 1.5,
                    }}>
                      <TriangleAlert size={13} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 5 }} />
                      This file belongs to a different job than the folder it is sitting in.
                    </div>
                  )}
                  <div style={{ fontSize: 13, color: 'var(--th-text-primary)', marginTop: 6, lineHeight: 1.6 }}>
                    Sheet {mm(r.planned.sheetMm.w)} x {mm(r.planned.sheetMm.h)} mm
                    {'  ·  '}drawing {mm(r.planned.footprintMm.w)} x {mm(r.planned.footprintMm.h)} mm
                    <br />
                    {r.planned.contourCount} shape{r.planned.contourCount === 1 ? '' : 's'}
                    {'  ·  '}{mm(r.planned.cutLengthMm)} mm of cutting
                    {'  ·  '}{r.planned.lifts} lift{r.planned.lifts === 1 ? '' : 's'}
                    <br />
                    <span style={{ color: '#94a3b8' }}>Load it: {loadingWords(r.planned.loading)}</span>
                  </div>
                </>
              )}
            </button>
          )
        })}
      </div>

      {/* ── 3. HOW IT RUNS ───────────────────────────────────────────────── */}
      {selected && selectedPlan?.ok === true && (
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={heading}>3 - How it runs</div>

          {/* 🔴 THE FILE'S JOB AGAINST THE FOLDER'S JOB — FIRST, AND A GATE.
              Above the mode choice on purpose: a file that belongs to another
              customer's job is not a question of how to run it. Until
              08/10/2026 this tab held both quote ids and never compared them,
              and a cut file that had wandered into the wrong job folder was sent
              without a word. Three times in five weeks, one customer's files on
              another customer's job. */}
          {quoteMismatch && (
            <div style={{
              padding: '12px 14px', borderRadius: 8,
              background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.45)',
              display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: DANGER, fontSize: 14, fontWeight: 700 }}>
                <TriangleAlert size={15} /> This cut file belongs to a different job
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--th-text-primary)' }}>
                The folder you are standing in is job{' '}
                <span style={{ fontFamily: 'monospace', color: '#94a3b8' }}>{quoteMismatch.folder}</span>. This cut
                file says it was made for job{' '}
                <span style={{ fontFamily: 'monospace', color: '#94a3b8' }}>{quoteMismatch.file}</span>
                {quoteMismatch.fileNumber ? <> ({quoteMismatch.fileNumber})</> : null}. One of the two
                is wrong. A cut file that has wandered into another job&apos;s folder cuts another
                customer&apos;s shape out of this customer&apos;s sheet, and nothing downstream of
                here can notice: the shapes plan, the footprint is real, and the machine never
                reports back.
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--th-text-primary)' }}>
                Open the quote the file names and check which sheet this drawing is for before you
                go any further.
              </div>
              {!quoteAcked && (
                <button
                  onClick={() => { setQuoteAck(selected); disarm() }}
                  style={{ ...btn, alignSelf: 'flex-start', color: DANGER, borderColor: 'rgba(239,68,68,0.45)' }}
                >
                  <Check size={14} /> I have checked - this file is for the job in front of me
                </button>
              )}
              {quoteAcked && (
                <div style={{ fontSize: 13, fontWeight: 600, color: WARN, lineHeight: 1.5 }}>
                  You said you checked. The two job numbers still disagree - read the millimetres and
                  the shape count below against the sheet before you send.
                </div>
              )}
            </div>
          )}

          {/* A comparison that COULD NOT be made is said, not left blank. */}
          {quoteUncheckable && !quoteMismatch && (
            <div style={{
              padding: '10px 12px', borderRadius: 8, fontSize: 13, lineHeight: 1.5,
              background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.28)',
              color: 'var(--th-text-primary)',
            }}>
              {quoteUncheckable}
            </div>
          )}

          {/* 🔴 Mode. The dry run is first and is the only one in accent
              colour; BOTH head-down modes — the pen pass and the cut — are in
              danger colour and carry the head-down line, because the machine
              sends them the same commands and only the tool in the head differs.
              Until 08/10/2026 the pen pass was styled as a dry run and sat with
              the real one, which is how "dry run with a pen" could cut a job. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {MODES.map(m => {
              const on = mode === m.id
              const tone = m.headDown ? DANGER : 'var(--th-accent)'
              const wash = m.headDown ? 'rgba(239,68,68,0.07)' : 'rgba(110,200,200,0.08)'
              return (
                <button
                  key={m.id}
                  onClick={() => { setMode(m.id); setHeadAnswer(null); disarm() }}
                  style={{
                    padding: '11px 13px', borderRadius: 8, textAlign: 'left', cursor: 'pointer',
                    border: `1px solid ${on ? tone : 'var(--th-border)'}`,
                    background: on ? wash : 'transparent',
                    color: 'var(--th-text-primary)', display: 'block', width: '100%',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 14, fontWeight: 600 }}>
                    <span style={{ color: on ? tone : '#64748b', display: 'flex' }}>{m.icon}</span>
                    {m.label}
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3, lineHeight: 1.5 }}>{m.blurb}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginTop: 5, color: m.headDown ? DANGER : GOOD }}>
                    {m.headDown
                      ? 'The head comes down. Whatever is fitted in it meets the sheet.'
                      : 'The head stays up. No head-down command is sent at all.'}
                  </div>
                </button>
              )
            })}
          </div>

          {/* 🔴 SAFETY RULE 2. No default answer and no remembered one: it is
              cleared on every change of mode, of file and of MACHINE, and the
              answer itself carries which machine it was given for, so a stale
              one cannot be read back. Shown for every head-down mode — the pen
              pass as much as the cut — because the two send the same commands.
              The live test only put a pen in after the knife came out, and the
              software must not be the thing that forgets that. */}
          {spec.headDown && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--th-text-primary)' }}>
                Go and look at the head on {activeMachine ? activeMachine.label : 'this machine'} right now. What is fitted in it?
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
                This question is about this machine only. Switch machines and it is asked again -
                an answer about another cutter's head says nothing about this one's.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {([
                  ['pen', 'A pen'],
                  ['blade', 'A blade'],
                  ['nothing', 'Nothing / not sure'],
                ] as [HeadAnswer['fitted'], string][]).map(([v, text]) => (
                  <button
                    key={v}
                    onClick={() => {
                      /* No answer without a machine to pin it to. */
                      setHeadAnswer(activeMachineKey === null ? null : { fitted: v, machineKey: activeMachineKey })
                      disarm()
                    }}
                    style={{
                      ...btn,
                      borderColor: head === v ? 'var(--th-accent)' : 'var(--th-border)',
                      background: head === v ? 'rgba(110,200,200,0.08)' : 'transparent',
                      color: head === v ? 'var(--th-accent)' : 'var(--th-text-secondary)',
                    }}
                  >
                    {text}
                  </button>
                ))}
              </div>
              {headMismatch && (
                <div style={{
                  padding: '10px 12px', borderRadius: 8, fontSize: 13, lineHeight: 1.5,
                  background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.28)',
                  color: 'var(--th-text-primary)',
                }}>
                  {headMismatch}
                </div>
              )}
            </div>
          )}

          {/* The only door to a send. 🔴 A disabled button here always has its
              reason on screen: `headMismatch` prints its own sentence above, and
              the quote clash prints the block at the top of this section plus
              the line under the button. */}
          {(() => {
            const blocked = headMismatch !== null || (quoteMismatch !== null && !quoteAcked)
            return (
              <>
                <button
                  onClick={() => void arm()}
                  disabled={arming || blocked}
                  style={{
                    ...btn, border: 'none', justifyContent: 'center',
                    background: 'var(--th-accent)', color: '#fff',
                    opacity: arming || blocked ? 0.5 : 1,
                    cursor: blocked ? 'default' : 'pointer',
                  }}
                >
                  {arming ? <LoaderCircle size={14} className="animate-spin" /> : <Ruler size={14} />}
                  Work it out and show me the millimetres
                </button>
                {quoteMismatch !== null && !quoteAcked && (
                  <div style={{ fontSize: 12, color: DANGER, fontWeight: 600, lineHeight: 1.5 }}>
                    Nothing is worked out while the file&apos;s job and this folder&apos;s job
                    disagree. Check it above first.
                  </div>
                )}
              </>
            )
          })()}

          <Reasons tone="refusal" title="Refused - nothing will be sent" items={armRefusals} table={REFUSAL_TEXT} />
          <Reasons tone="note" title="Worth knowing" items={armNotes} table={NOTE_TEXT} />
        </div>
      )}

      {/* ── 4. READ THIS, THEN SEND ──────────────────────────────────────── */}
      {/* 🔴 SAFETY RULE 3, STRUCTURAL. The send button exists nowhere else in
          this file. It lives inside this block, under the footprint, and this
          block only renders when `armed` holds a plan - so there is no path to
          a send that did not put the millimetres on screen first. He once
          stopped a send because a 150 x 80 test was about to go to a machine
          loaded with A4. */}
      {armed && (
        <div style={{
          ...card,
          /* Danger-framed for EVERY head-down run, read off the armed plan's own
             mode rather than off a comparison against 'cut': a pen pass sends
             identical commands and earns the same frame. */
          border: `1px solid ${modeSpec(armed.mode).headDown ? 'rgba(239,68,68,0.45)' : 'var(--th-accent)'}`,
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <div style={heading}>4 - Read this before you send</div>

          {/* 🔴 What is about to happen to the head, in one line, above the
              millimetres. The plan's `description` says it too, in the engine's
              own words; this is the version that cannot be scrolled past. */}
          <div style={{
            fontSize: 14, fontWeight: 700, lineHeight: 1.5,
            color: modeSpec(armed.mode).headDown ? DANGER : GOOD,
          }}>
            {modeSpec(armed.mode).headDown
              ? armed.mode === 'cut'
                ? 'The blade comes down on the sheet.'
                : 'The head comes down on the sheet. This is not a dry run - the commands are the same as a cut, and only an empty blade holder keeps it from cutting.'
              : 'The head stays up for the whole run. Not one head-down command is in these bytes.'}
          </div>

          <div style={{
            padding: '12px 14px', borderRadius: 8,
            background: 'var(--th-bg-secondary)', border: '1px solid var(--th-border)',
          }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--th-text-primary)', lineHeight: 1.4 }}>
              The drawing is {mm(armed.footprintMm.w)} mm wide and {mm(armed.footprintMm.h)} mm tall.
            </div>
            <div style={{ fontSize: 14, color: 'var(--th-text-primary)', marginTop: 6, lineHeight: 1.6 }}>
              It sits {mm(armed.footprintMm.x)} mm in from the left edge and {mm(armed.footprintMm.y)} mm
              up from the edge that goes in first, on a sheet of {mm(armed.sheetMm.w)} x {mm(armed.sheetMm.h)} mm.
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: WARN, marginTop: 8, lineHeight: 1.5 }}>
              Check that against what is actually loaded in the machine before you send.
            </div>
            <div style={{ fontSize: 14, color: 'var(--th-text-primary)', marginTop: 8, lineHeight: 1.6 }}>
              Load it {loadingWords(armed.loading)}.
            </div>
          </div>

          {/* Everything the engine says about the plan, verbatim. */}
          <div style={{
            padding: '10px 12px', borderRadius: 8, fontSize: 13, lineHeight: 1.7,
            background: 'var(--th-bg-secondary)', border: '1px solid var(--th-border)',
            color: '#94a3b8', fontFamily: 'monospace', whiteSpace: 'pre-wrap',
          }}>
            {armed.description.join('\n')}
          </div>

          <Reasons tone="note" title="Worth knowing" items={armed.notes} table={NOTE_TEXT} />
          <Reasons tone="refusal" title="Cannot send" items={armed.sendBlockers} table={REFUSAL_TEXT} />

          {armed.canSend && (
            <>
              <button
                onClick={() => void doSend()}
                disabled={sending}
                style={{
                  ...btn, border: 'none', justifyContent: 'center', padding: '13px 16px', fontSize: 15,
                  background: modeSpec(armed.mode).headDown ? DANGER : 'var(--th-accent)', color: '#fff',
                  opacity: sending ? 0.5 : 1,
                }}
              >
                {sending ? <LoaderCircle size={15} className="animate-spin" /> : <Send size={15} />}
                {/* 🔴 The word "dry run" appears on exactly one of these. */}
                {sending
                  ? 'Sending...'
                  : armed.mode === 'cut'
                    ? `Send the cut to ${armed.machine.label}`
                    : armed.mode === 'penDown'
                      ? `Send the head-down pen pass to ${armed.machine.label}`
                      : `Send the dry run to ${armed.machine.label}`}
              </button>
              <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
                {armed.byteLength} bytes in {armed.chunkCount} chunk{armed.chunkCount === 1 ? '' : 's'},
                {' '}{armed.chunkPauseMs} ms apart - about {armed.estimatedSendSeconds}s of pacing before
                the last chunk leaves.
              </div>
            </>
          )}
        </div>
      )}

      {/* ── The outcome ──────────────────────────────────────────────────── */}
      {/* 🔴 "Sent", never "Cut". The engine composes this message and it is
          rendered verbatim: the machine never answers, so the only fact in
          evidence is that the bytes left PressKit. */}
      {result && (
        <div style={{
          ...card,
          background: result.ok ? 'rgba(34,197,94,0.07)' : result.stopped ? 'rgba(245,158,11,0.07)' : 'rgba(239,68,68,0.07)',
          border: `1px solid ${result.ok ? 'rgba(34,197,94,0.3)' : result.stopped ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.3)'}`,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7, fontSize: 14, fontWeight: 700,
            color: result.ok ? GOOD : result.stopped ? WARN : DANGER,
          }}>
            {result.ok ? <Check size={15} /> : result.stopped ? <CircleStop size={15} /> : <TriangleAlert size={15} />}
            {result.ok ? 'Sent' : result.stopped ? 'Stopped sending' : 'Nothing was sent'}
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--th-text-primary)' }}>
            {result.message}
          </div>
          {result.refusals.length > 0 && !result.stopped && (
            <Reasons tone="refusal" title="Why" items={result.refusals} table={REFUSAL_TEXT} />
          )}
        </div>
      )}

      {/* ── The floating progress card ───────────────────────────────────── */}
      {/* Same pattern and the same inline styling as App.tsx's download card.
          It is `position: fixed`, so it floats over the whole app from wherever
          this tab happens to be mounted - which also means a send stays visible
          while the operator scrolls this panel. On mount the tab re-attaches to
          a send already running (`skycut:activeSends`), because `toolSubTab` is
          local state and leaving the tab would otherwise leave a socket running
          with nothing watching it. */}
      {progress && (progress.phase === 'connecting' || progress.phase === 'sending' || progress.phase === 'closing') && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          background: 'var(--th-bg-tertiary, #1e293b)', border: '1px solid var(--th-border, #334155)',
          borderRadius: 12, padding: '16px 20px', minWidth: 300, maxWidth: 380,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <LoaderCircle size={16} style={{ color: 'var(--th-accent)', animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--th-text-primary, #e2e8f0)' }}>
              Sending to the cutter...
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--th-text-secondary, #94a3b8)', marginBottom: 8, lineHeight: 1.5 }}>
            {progress.message}
          </div>
          {progress.chunkTotal > 0 && (
            <>
              <div style={{ height: 4, borderRadius: 2, background: 'var(--th-bg-primary, #0f172a)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2, background: 'var(--th-accent)',
                  width: `${Math.round((progress.chunksSent / progress.chunkTotal) * 100)}%`,
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--th-text-muted, #64748b)', marginTop: 6, textAlign: 'right' }}>
                chunk {progress.chunksSent} / {progress.chunkTotal}
              </div>
            </>
          )}
          {/* 🔴 "Stop sending", NOT "cancel". PressKit has no cancellation
              anywhere and does not need one here - «την ακύρωση την έκανα πάντα
              από το μηχάνημα». This closes the socket so the rest of the
              stream never leaves; the machine keeps what it already has and is
              stopped at the machine. */}
          <button
            onClick={() => void stop()}
            style={{ ...btn, marginTop: 10, width: '100%', justifyContent: 'center', color: WARN, borderColor: 'rgba(245,158,11,0.35)' }}
          >
            <CircleStop size={14} /> Stop sending
          </button>
          <div style={{ fontSize: 11, color: 'var(--th-text-muted, #64748b)', marginTop: 6, lineHeight: 1.5 }}>
            That only stops the rest of the stream leaving PressKit. Whatever the machine
            already has, it will finish - stop the machine at the machine.
          </div>
        </div>
      )}
    </div>
  )
}
