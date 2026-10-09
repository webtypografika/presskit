/*
 * ─────────────────────────────────────────────────────────────────────────────
 * SKYCUT PROTOCOL — millimetres in, a command stream out. Nothing else.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PressCal computes the cut geometry and writes it beside the cut PDF as
 * `<stem>.cut.json`, in millimetres, in the sheet's own bottom-left frame. This
 * module turns that file into the bytes a Skycut understands. It opens no
 * socket, reads no file and knows nothing about IPC or React — that is the next
 * layer's job (`skycut-engine.ts`). Everything here is arithmetic, and all of it
 * can be computed with no machine switched on, which is the whole point: the
 * operator has to be told what is about to happen BEFORE anything is sent.
 *
 * THE DIVISION OF LABOUR, AND WHY IT IS DRAWN HERE. PressCal deliberately stops
 * at millimetres and deliberately does not flatten its curves; its own comment
 * says flattening belongs "at the machine boundary, in the driver, at the
 * machine's own step resolution". This file IS that boundary. ×40 is a D60 fact,
 * a D24 is a different number, and the handover file outlives both — so the
 * scale lives at the point of emission, here, and as a per-machine setting
 * rather than a constant.
 *
 * ─── WHAT WAS MEASURED ON THE OWNER'S OWN D60, 06/10/2026 ───
 *
 * Not research — measured, over WiFi, from our own code:
 *
 *   • Plain TCP, port 8080. No handshake, no password, no greeting.
 *   • The machine NEVER SENDS ANYTHING BACK. Not an acknowledgement, not a
 *     status, not an error. Ever.
 *   • `IN;` init · `PA;` absolute · `U x,y;` travel head-up · `D x,y;` cut
 *     head-down · `VS<n>;` speed · `TB25,<h>,<w>;` scan the printed marks ·
 *     `CT1;` after the scan · `@;` end.
 *   • 40 machine units per millimetre — a drawn square measured with a ruler:
 *     sent 2000, got 50 mm.
 *   • Sent in 1024-byte chunks with ~450 ms pauses, one connection per job. An
 *     independent reverse-engineering project measured 452 ms over 13 chunks, so
 *     the pacing is corroborated, not invented.
 *
 * 🔴 BECAUSE THE MACHINE NEVER ANSWERS, EVERY WRONG VALUE IN HERE FAILS
 * SILENTLY. There is no error to catch and no status to poll. A wrong
 * units-per-mm cuts at double or half size; a wrong mark-scan opcode makes the
 * camera scan the wrong rectangle and the cut lands off the line. That is the
 * reason this module is built out of per-machine settings and refusals rather
 * than defaults and best guesses.
 *
 * ─── 🔴 THE THREE SAFETY RULES, AND HOW THE CODE ENFORCES THEM ───
 *
 * 1. NEVER SEND A PRESSURE COMMAND. The owner: «την πίεση την έχω ρυθμίσει
 *    εγώ». There is no force, pressure or `FS` field anywhere in this module —
 *    not a parameter, not a default, not a constant — because what does not
 *    exist cannot be sent by accident. `FORBIDDEN_OPCODES` below re-checks the
 *    finished stream, so a future edit that reintroduces one is refused instead
 *    of shipped.
 *
 * 2. NEVER SEND A CUT COMMAND TO A MACHINE WITH A BLADE FITTED WITHOUT EXPLICIT
 *    CONFIRMATION. Every mode whose `SKYCUT_EMIT_MODES` entry says
 *    `needsHeadAnswer` — `'cut'` and `'penDown'`, i.e. both modes that put the
 *    head down — refuses unless the caller passes `bladeConfirmed: true`, which
 *    the UI may only set from an operator's own answer about THIS machine.
 *    `'travelOnly'` emits no `D` at all — the head never comes down — and that
 *    is the only mode this software calls a dry run.
 *
 *    🔴 THE TRAP THAT WAS HERE, FIXED 08/10/2026. `'penDraw'` (now `'penDown'`)
 *    was described as a dry run and offered as one, while emitting a stream
 *    byte-for-byte identical to `'cut'`: 272 `D` commands on the 446 job. "Dry
 *    run with a pen" on a machine with the knife still in would have cut the
 *    job. The machine cannot tell a pen from a knife — only the operator can —
 *    so the honest split is head-down versus head-up, and the names now say
 *    which. See the table at `SKYCUT_EMIT_MODES`.
 *
 * 3. ALWAYS STATE THE DRAWING'S FOOTPRINT IN MILLIMETRES BEFORE SENDING. He
 *    stopped a send once because a 150 × 80 test was about to go to a machine
 *    loaded with A4. `planSkycutJob` computes the footprint, the cut length, the
 *    blade travel and the contour count with nothing connected, and
 *    `describeSkycutPlan` renders them as the lines the screen must show.
 *
 * ─── WHAT THE SCREEN MAY CLAIM ───
 *
 * The machine never answers, so the software CANNOT KNOW a job was cut. The only
 * honest word is "Sent". Never "Cut", never "Done", never "Finished" — the
 * operator would walk away from a knife that never moved.
 *
 * ─── CANCELLATION ───
 *
 * There is none, by the owner's own decision, 07/10: «πάντως ούτε το SignMaster
 * είχε ακύρωση. Την ακύρωση την έκανα πάντα από το μηχάνημα.» The transport
 * layer offers "stop sending", which closes the socket so the rest of the chunks
 * never leave, and says on screen that stopping the machine is done at the
 * machine. Nothing in this module models a cancel.
 */

// ─── The handover file: what PressCal writes, what this module accepts ──────

/* These four are matched EXACTLY, never coerced. A file this module does not
   recognise is refused with a reason, because the alternative — reading an
   unknown dialect as if it were this one — puts a knife somewhere nobody
   computed. The frame string is the same spelling `cut-paths.ts` stamps on its
   own output, so the two sides are tied together by a literal rather than by
   anybody's memory. */
export const CUT_FILE_FORMAT = 'presscal-cut'
export const CUT_FILE_VERSION = 1
export const CUT_FILE_UNITS = 'mm'
export const CUT_FILE_FRAME = 'sheet-bottom-left-mm'

export interface CutPointMm {
  x: number
  y: number
}

/* A cubic stays a cubic in the file, exactly as PressCal's `CutSegment` has it.
   Flattening happens below, at the machine's own step. */
export type CutSegment =
  | { kind: 'line'; to: CutPointMm }
  | { kind: 'cubic'; c1: CutPointMm; c2: CutPointMm; to: CutPointMm }

export interface CutContourJson {
  closed: boolean
  start: CutPointMm
  segments: CutSegment[]
  /* PressCal's own exact measure of the unflattened path. Compared against our
     flattened measure, never trusted in its place — see `totalsDisagree`. */
  lengthMm?: number
}

export interface CutGroupJson {
  group: string
  perforation: boolean
  contours: CutContourJson[]
}

export interface CutRectMm {
  x: number
  y: number
  w: number
  h: number
}

export interface CutMarksJson {
  kind: string
  /* The rectangle the camera scans, mark inner edge to mark inner edge.
   *
   * 🔴 WHAT EACH PART OF THIS RECTANGLE IS FOR, settled 08/10/2026.
   *
   * `w` and `h` are the only parts the MACHINE can be told: the scan command is
   * `TB25,<h>,<w>;` and it carries exactly two numbers. There is no third and
   * fourth argument in the proven command set, so the rectangle's POSITION
   * cannot be sent, and inventing a way to send it would be guessing with a
   * camera.
   *
   * `x` and `y` are not therefore useless — they are where the rectangle's
   * bottom-left mark SITS ON THE SHEET, and the machine learns that from where
   * the operator parks the head before the scan, not from the stream. So the
   * position is used for the one thing it can be used for: it is stated to the
   * operator, in millimetres, in `describeSkycutPlan`, next to the footprint he
   * is already reading. Park the head over the wrong mark and the camera hunts
   * for a rectangle that is not there, and the machine never says a word.
   *
   * It is NOT dropped and it is NOT sent. Both of those would be wrong in
   * different directions. */
  scanRect: CutRectMm
  armMm: number
  thicknessMm: number
}

/* Which edge of the sheet goes into the cutter first. The sheet must enter the
   cutter the same edge first as it entered the press, or the montage and the cut
   are two different jobs. Only `'bottom'` is expressible by the transform below;
   the other three are named so the file can say them and this module can refuse
   them by name instead of silently rotating the job. */
export type CutFeedEdge = 'bottom' | 'top' | 'left' | 'right'

/* Which printed side is face up. A duplex sheet loaded the other way up makes
   the path a mirror image — invisible on a symmetric shape, silently wrong on an
   asymmetric one. Reported to the operator; it changes no geometry here. */
export type CutSideUp = 'front' | 'back'

export interface CutLoadingJson {
  feedEdge: CutFeedEdge
  sideUp: CutSideUp
  mirrored: boolean
}

export interface CutJobJson {
  quoteNumber?: string
  quoteId?: string
  title?: string
  printedPdf?: string
  cutPdf?: string
}

export interface CutTotalsJson {
  cutLengthMm?: number
  lifts?: number
  contours?: number
}

/* WHICH MACHINE THE JOB IS FOR, AND WHERE IT IS — written by PressCal, where the
   owner set the machine up.

   🔴 THIS BLOCK IS WHY THERE IS NO MACHINE CARD IN THIS APP ANY MORE. He was
   asked to fill one in here after filling one in there, and said: «η μηχανή
   στήνεται στο presscal και πάει στο presskit αθόρυβα… όλες οι ρυθμίσεις να
   γίνονται από το presscal». So the identity and the address arrive with the
   job and nothing is typed on this side.

   🔴 WHAT IS DELIBERATELY ABSENT, AND MUST STAY ABSENT: every machine-language
   fact. No units per millimetre, no axis convention, no scan opcode, no chunk
   size, no pause, no speed — and above all NO FORCE, which has no field
   anywhere in this app by design (safety rule 1). All of those are resolved
   HERE, from `model`, out of `SKYCUT_MACHINE_PRESETS`. A file may say WHICH
   machine; it may never say how to speak to one. Keeping that line is what lets
   a second plotter arrive without changing this format — and it is also what
   stops a file on a synced folder from re-programming a machine. */
export interface CutJobMachineJson {
  /* PressCal's own preset id — 'd60' | 'd48' | 'd24' at the time of writing, and
     NOT the ids used in `SKYCUT_MACHINE_PRESETS`. Resolved here, and REFUSED BY
     NAME when it cannot be: a D24 told to scan with the D60's opcode finds
     nothing, and this family never answers back, so a near-miss is silence. */
  model?: string
  /* The model as written on the machine, for a human reading the file. */
  label?: string
  /* An IP or a hostname, exactly as typed on PressCal's card.

     ⚠️ AN ADDRESS IS A MUTABLE FACT AND A JOB FILE IS A SNAPSHOT. On the
     ordinary path this is fresh by construction — PressCal writes the file and
     triggers it in the same breath — but a file re-sent from last year names
     wherever that address pointed then, and `probeMachine` cannot tell a cutter
     from anything else answering on that port. That is why the folder list is a
     fallback and not the main road. */
  host?: string
  port?: number
  /* The four limits the owner measured with a tape, in millimetres. 0 means he
     left that box empty: do not check that one. Material LENGTH is absent on
     purpose — a roll can be fifty metres. */
  limitsMm?: {
    opening: number
    material: number
    bladeTravel: number
    cameraTravel: number
  }
  /* WHICH WAY THE MACHINE'S AXES RUN, as one of SKYCUT_AXIS_CONVENTIONS.
  
     🔴 THIS IS THE ONE PIECE OF MACHINE LANGUAGE THAT TRAVELS, AND THE RULE ABOVE
     IS REVISED RATHER THAN QUIETLY BROKEN. The block was documented as carrying
     identity and address and never language, so that a file could not reprogram a
     machine. The axis convention is the exception, for the same reason the address
     is: it is a fact about HIS machine that only he can establish, nobody has
     measured it, and the first real cut came out mirrored because the only place
     to change it was a screen he had asked to be removed. A per-machine
     declaration typed on his own card is not a file reprogramming a stranger's
     plotter — it is the owner saying which way his own one runs.
  
     ⚠️ STILL NOT TRAVELLING, AND MUST NOT: units per millimetre, the scan opcode,
     chunk sizes, pauses, speeds, and above all force. Those come from the model.
  
     Absent means the model's own default, which is the researched one — and the
     researched one mirrors, so absent is not a safe answer, merely the old one. */
  axisConvention?: string
}

export interface CutJobFile {
  format: typeof CUT_FILE_FORMAT
  formatVersion: typeof CUT_FILE_VERSION
  units: typeof CUT_FILE_UNITS
  frame: typeof CUT_FILE_FRAME
  job: CutJobJson
  sheet: { w: number; h: number }
  loading: CutLoadingJson
  /* Absent on a job with no cutter on it, and absent in every file written
     before 08/10/2026. Absent is a NOTE, never a refusal. */
  machine?: CutJobMachineJson
  marks?: CutMarksJson
  groups: CutGroupJson[]
  totals?: CutTotalsJson
  notes?: string[]
}

// ─── The machine record: every machine fact, as a setting ───────────────────

/* How the sheet's millimetres become the machine's own axes.
 *
 * 🔴 THE DEFAULT IS RESEARCHED, NOT MEASURED BY US. Two independent
 * reverse-engineering projects for this family state that the axes are swapped
 * and inverted, and one of them says so in a docstring. We have NOT confirmed it
 * on hardware ourselves — the live test drew a square, and a square is the one
 * shape that cannot tell you whether your axes are swapped. So the convention is
 * a per-machine setting: a machine that differs is corrected on its own card, in
 * seconds, without a code change and without a release. */
/* 🔴 A LIST, NOT A BARE UNION, AND THE TYPE IS DERIVED FROM IT. The conventions
 * have to be checkable at runtime: a machine card comes out of a settings file
 * that nothing enforces, and a convention this build does not recognise must be
 * REFUSED BY NAME rather than fall through to whatever the transform's `default`
 * branch happens to be. A wrong convention cuts a mirror image — invisible on a
 * symmetric shape, ruinous on an asymmetric one — and the machine never says a
 * word. Adding a fourth convention to this array is what makes it exist; the
 * type follows, so the switches below stop compiling until they handle it. */
/* 🔴 TWO OF THESE MIRROR THE JOB AND NOBODY HAD SAID SO — measured on his D60 on
 * 09/10/2026, when the first real cut of an asymmetric shape «άρχιζε να κόβει το
 * κοπτικό λες και ήταν αντικριστό».
 *
 * The arithmetic, which was there all along:
 *   swapInvertFromSheet  (x,y) → (H−y, W−x)   determinant −1  → A MIRROR
 *   swapOnly             (x,y) → (y, x)       determinant −1  → A MIRROR
 *   direct               (x,y) → (x, y)       determinant +1
 * A determinant of −1 flips handedness. So the researched default mirrors, the
 * only alternative that swapped the axes ALSO mirrored, and the only
 * handedness-preserving option left did not swap them at all — which on a
 * machine that wants its axes swapped comes out rotated instead. There was no
 * setting that was both swapped and not mirrored, and that is why no amount of
 * choosing could have fixed this.
 *
 * ⚠️ AND A SQUARE CANNOT SHOW IT. The one live test this project ever ran drew a
 * square: the single shape invariant under every one of these. It passed, and it
 * proved nothing about handedness. A heart does not.
 *
 * The two added below are the genuine quarter turns — swapped AND
 * handedness-preserving — which is what a plotter whose axes run across the
 * material actually needs. Nobody has measured which of them his machine wants;
 * that is the owner's choice on the machine's own card, made once with a PEN. */
export const SKYCUT_AXIS_CONVENTIONS = [
  /* x_machine = sheetH − y ; y_machine = sheetW − x. The researched one.
     🔴 A MIRROR (det −1). Kept because two independent projects describe it and
     a machine may genuinely want it; no longer the thing a typo inherits. */
  'swapInvertFromSheet',
  /* x_machine = y ; y_machine = x. Swapped, not inverted. 🔴 ALSO A MIRROR. */
  'swapOnly',
  /* x_machine = x ; y_machine = y. For a machine that wants the sheet frame. */
  'direct',
  /* x_machine = y ; y_machine = sheetW − x. A true quarter turn, det +1. */
  'swapTurnLeft',
  /* x_machine = sheetH − y ; y_machine = x. The other quarter turn, det +1. */
  'swapTurnRight',
] as const

export type SkycutAxisConvention = (typeof SKYCUT_AXIS_CONVENTIONS)[number]

export const isSkycutAxisConvention = (v: unknown): v is SkycutAxisConvention =>
  typeof v === 'string' && (SKYCUT_AXIS_CONVENTIONS as readonly string[]).includes(v)

/* `TB25,<h>,<w>;` on his D60, measured. The independent D24 project documents
   `TB26,<h>,<w>;`. He owns both machines, the machine never answers, and a wrong
   opcode therefore fails in silence — so this is profile data, never a constant.
   Held as a free string so a third opcode costs a settings edit, not a release. */
/* Same discipline as the axis conventions above, and for the same reason: the
   order the scan command's two arguments go in is a machine fact that arrives
   from a settings file, and height and width the wrong way round is a scan of a
   rectangle nobody printed. An unrecognised order is refused by name. */
export const SKYCUT_MARK_ARG_ORDERS = ['heightWidth', 'widthHeight'] as const

export type SkycutMarkArgOrder = (typeof SKYCUT_MARK_ARG_ORDERS)[number]

export const isSkycutMarkArgOrder = (v: unknown): v is SkycutMarkArgOrder =>
  typeof v === 'string' && (SKYCUT_MARK_ARG_ORDERS as readonly string[]).includes(v)

/* Where a profile's numbers come from, so the screen can say. A value nobody
   measured must never look measured. */
export type SkycutProvenance = 'measuredHere' | 'thirdParty'

export interface SkycutMachine {
  id: string
  label: string
  model: string
  /* 🔴 40 on his D60, measured with a ruler. 20 on the Graphtec-family machines.
     A wrong value cuts at double or half size and nothing says a word. */
  unitsPerMm: number
  axisConvention: SkycutAxisConvention
  markScanOpcode: string
  markScanArgs: SkycutMarkArgOrder
  /* 1024 bytes, ~450 ms, as the manufacturer's own software paces it. */
  chunkBytes: number
  chunkPauseMs: number
  /* The widest and longest material this machine takes, millimetres. `null`
     means nobody has measured it, and the plan SAYS so rather than quietly
     skipping the check — see `materialLimitUnknown`.

     🔴 `h` IS ITSELF NULLABLE, AND THAT IS NOT THE SAME AS 0. The length of the
     material is a quantity nobody in this system measures, deliberately: on a
     roll-fed machine «ένα υλικό μπορεί να είναι 50 μέτρα», so a length limit
     could only refuse a job for a reason the machine does not have. When the
     limits arrive from the handover file they are width-wise only, and writing
     0 into `h` would refuse every job on earth while looking like a measurement.
     `null` here means "this one is not checked"; the width still is. */
  maxMaterialMm: { w: number; h: number | null } | null
  /* `VS<n>;`. Emitted only when set. Nothing speed-related ever comes from the
     handover file: the file describes paper, the machine card describes the
     machine. */
  speedVs: number | null
  /* Measured millimetres per second, for the time estimate. `null` means no
     estimate is offered rather than a made-up one. */
  cutSpeedMmPerSec: number | null
  travelSpeedMmPerSec: number | null
  provenance: SkycutProvenance
}

/* 🔴 NOTE WHAT IS NOT IN THAT RECORD: no force, no pressure, no `FS`. Safety
   rule 1 is enforced by the shape of the type — there is no field to fill in. */

/* The published range for `VS<n>` on this family, community-reported from the
   D24 project. Used to refuse an out-of-range speed rather than let the machine
   silently ignore it. */
const VS_MIN = 1
const VS_MAX = 13

/* Starting points for a machine card, with their provenance attached. No IP
   address lives here — the address belongs to the transport layer's own copy of
   the record, and this module never needs it. */
export const SKYCUT_MACHINE_PRESETS: SkycutMachine[] = [
  {
    id: 'skycut-d60',
    label: 'Skycut D60',
    model: 'D60',
    unitsPerMm: 40,
    axisConvention: 'swapInvertFromSheet',
    markScanOpcode: 'TB25',
    markScanArgs: 'heightWidth',
    chunkBytes: 1024,
    chunkPauseMs: 450,
    maxMaterialMm: null,
    speedVs: null,
    cutSpeedMmPerSec: null,
    travelSpeedMmPerSec: null,
    provenance: 'measuredHere',
  },
  {
    id: 'skycut-d24',
    label: 'Skycut D24',
    model: 'D24',
    unitsPerMm: 40,
    axisConvention: 'swapInvertFromSheet',
    /* Third-party reading, unverified on our hardware. Check it with a pen
       before it ever meets a blade. */
    markScanOpcode: 'TB26',
    markScanArgs: 'heightWidth',
    chunkBytes: 1024,
    chunkPauseMs: 450,
    maxMaterialMm: null,
    speedVs: null,
    cutSpeedMmPerSec: null,
    travelSpeedMmPerSec: null,
    provenance: 'thirdParty',
  },
]

// ─── Refusals: a code, never a sentence, and never a throw ──────────────────

/* Same discipline as `cut-paths.ts`: the caller gets codes it can render and act
   on, and a refused job says WHY on screen. Nothing in this module throws for a
   bad input — a throw up through IPC arrives at the renderer as a blank failure,
   which is the one outcome that teaches the operator nothing. */
export type SkycutRefusalCode =
  /* ── The file itself ── */
  | 'fileNotAnObject'
  | 'unknownFormat'
  | 'unsupportedFormatVersion'
  | 'unknownUnits'
  | 'unknownFrame'
  | 'sheetMissing'
  | 'sheetNotPositive'
  | 'groupsMissing'
  | 'noContours'
  | 'contourMalformed'
  | 'marksMalformed'
  /* The machine block is PRESENT and cannot be read. Refused rather than
     ignored, because the alternative is falling back to asking — and a file
     that MEANT to name a machine, and failed, must not look like a file that
     never named one. The detail says which part. */
  | 'machineBlockMalformed'
  /* The file names a model this build has no machine profile for. REFUSED BY
     NAME and never resolved to the nearest one: the camera-scan command differs
     between models in this family (TB25 / TB26), nothing here ever answers
     back, and a wrong opcode is therefore total silence rather than an error. */
  | 'machineModelUnknown'
  /* ── The loading, which has no defaults by design ── */
  | 'loadingMissing'
  | 'feedEdgeMissing'
  | 'feedEdgeUnknown'
  /* Only `'bottom'` is expressible by the transform. Another edge is a rotation
     nobody has measured, and a guessed rotation cuts a job sideways. */
  | 'feedEdgeNotSupported'
  | 'sideUpMissing'
  | 'sideUpUnknown'
  | 'mirroredMissing'
  /* A mirrored load needs a reflection whose hinge depends on how the sheet is
     turned. Refused rather than guessed: a mirror is invisible on a symmetric
     shape and ruins an asymmetric one. One line to implement the day it is
     measured. */
  | 'mirroredNotSupported'
  /* ── The geometry against the sheet and the machine ── */
  | 'contourOffSheet'
  | 'footprintExceedsMachine'
  /* ── Things the protocol cannot express ── */
  /* A perforation group. Nothing in the proven command set says "perf", and a
     through cut where a perforation was meant ruins the job. PressCal flags the
     group; we refuse it rather than cut it. */
  | 'perforationNotSupported'
  /* ── The machine card ── */
  | 'machineUnitsInvalid'
  | 'machineChunkInvalid'
  | 'markOpcodeInvalid'
  | 'speedOutOfRange'
  /* 🔴 A machine card carrying an axis convention this build does not know. It
     reaches here from a hand-edited settings file or a card written by another
     version, and it MUST be refused by name: the alternative is inheriting the
     transform's fallback convention, which on an asymmetric shape cuts a mirror
     image and says nothing. */
  | 'axisConventionUnknown'
  /* Likewise the order the scan command's two arguments go in. Height and width
     the wrong way round scans a rectangle nobody printed. */
  | 'markScanArgsUnknown'
  /* ── The send itself ── */
  /* Safety rule 2: a head-down mode without an operator's explicit confirmation
     of what is fitted in the head. */
  | 'bladeNotConfirmed'
  /* Safety rule 1, re-checked on the finished stream. Can only fire if someone
     edits the emitter, which is exactly when a check earns its keep. */
  | 'forceCommandInStream'
  /* 🔴 A mode whose spec says the head stays up produced a `D`. Same kind of
     guard as the force check, other direction: it reads the finished bytes
     rather than anybody's intention, so an edit that broke the dry run is
     refused at the boundary instead of reaching a machine. */
  | 'headDownCommandInHeadUpStream'
  /* A mode string this build does not carry in `SKYCUT_EMIT_MODES`. Refused,
     never treated as the nearest thing: a mode nobody declared has no stated
     answer to "does the head come down". */
  | 'emitModeUnknown'

export interface SkycutRefusal {
  code: SkycutRefusalCode
  /* The one fact a human needs: which field, which contour, which number. */
  detail?: string
}

/* Worth saying, not worth stopping for. */
export type SkycutNoteCode =
  /* No marks in the file, so no camera scan: the cut is positioned from the
     machine's own origin and the operator must set it there. */
  | 'noMarkScan'
  /* `maxMaterialMm` is null on this machine card, so the footprint could not be
     checked against the machine. Safety rule 3 still holds — the footprint is
     stated — but nothing verified it fits. */
  | 'materialLimitUnknown'
  /* The file names no machine at all — every file written before 08/10/2026,
     and any job with no cutter on it. A NOTE and never a refusal: the tab asks
     which machine instead, exactly as it always did. */
  | 'noMachineInFile'
  /* Our flattened length and PressCal's exact length differ by more than the
     tolerance below. Expected to be tiny; a large gap means the two sides
     disagree about the geometry and somebody should look. */
  | 'totalsDisagree'
  /* No measured speed on the card, so no time estimate is offered. */
  | 'noMeasuredSpeed'
  /* The axis convention on this card is the researched default, not something we
     confirmed on this machine. */
  | 'axisConventionUnverified'
  /* This profile's numbers are third-party. */
  | 'profileThirdParty'
  /* A single command came out longer than the chunk size, so it travels in a
     chunk of its own. */
  | 'commandLongerThanChunk'

export interface SkycutNote {
  code: SkycutNoteCode
  detail?: string
}

// ─── Parsing and validating the handover file ───────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const isPt = (v: unknown): v is CutPointMm => isObj(v) && isNum(v.x) && isNum(v.y)

const isRect = (v: unknown): v is CutRectMm =>
  isObj(v) && isNum(v.x) && isNum(v.y) && isNum(v.w) && isNum(v.h)

export type ParseCutFileResult =
  | { ok: true; file: CutJobFile }
  | { ok: false; refusals: SkycutRefusal[] }

/**
 * The handover JSON in, a validated file or a list of reasons out.
 *
 * Every check here exists because its opposite is a knife in the wrong place.
 * There is no coercion and no defaulting anywhere in this function: an unknown
 * format is not "probably ours", a missing `feedEdge` is not "probably bottom",
 * and a file with no contours is not an empty job — it is a file that failed to
 * say what to cut.
 */
export function parseCutFile(raw: unknown): ParseCutFileResult {
  const refusals: SkycutRefusal[] = []

  if (!isObj(raw)) return { ok: false, refusals: [{ code: 'fileNotAnObject' }] }

  /* The four identity fields first. If the file is not ours, nothing further is
     worth reporting — every later complaint would be about a dialect we were
     never meant to read. */
  if (raw.format !== CUT_FILE_FORMAT) {
    return { ok: false, refusals: [{ code: 'unknownFormat', detail: String(raw.format) }] }
  }
  if (raw.formatVersion !== CUT_FILE_VERSION) {
    return {
      ok: false,
      refusals: [{ code: 'unsupportedFormatVersion', detail: String(raw.formatVersion) }],
    }
  }
  if (raw.units !== CUT_FILE_UNITS) {
    return { ok: false, refusals: [{ code: 'unknownUnits', detail: String(raw.units) }] }
  }
  if (raw.frame !== CUT_FILE_FRAME) {
    return { ok: false, refusals: [{ code: 'unknownFrame', detail: String(raw.frame) }] }
  }

  /* The sheet. Every later number is positioned against it, and the axis
     transform reflects THROUGH it, so a missing sheet is not a detail. */
  const sheetRaw = raw.sheet
  let sheet = { w: 0, h: 0 }
  if (!isObj(sheetRaw) || !isNum(sheetRaw.w) || !isNum(sheetRaw.h)) {
    refusals.push({ code: 'sheetMissing' })
  } else if (sheetRaw.w <= 0 || sheetRaw.h <= 0) {
    refusals.push({ code: 'sheetNotPositive', detail: `${sheetRaw.w} x ${sheetRaw.h}` })
  } else {
    sheet = { w: sheetRaw.w, h: sheetRaw.h }
  }

  /* 🔴 THE LOADING HAS NO DEFAULTS. A missing value is a refusal with the reason
     on screen, never a guess. `feedEdge` because the sheet must enter the cutter
     the same edge first as it entered the press; `sideUp` and `mirrored` because
     a duplex sheet loaded the other way up makes the path a mirror image. */
  const loadRaw = raw.loading
  let loading: CutLoadingJson = { feedEdge: 'bottom', sideUp: 'front', mirrored: false }
  if (!isObj(loadRaw)) {
    refusals.push({ code: 'loadingMissing' })
  } else {
    const feed = loadRaw.feedEdge
    if (feed === undefined || feed === null || feed === '') {
      refusals.push({ code: 'feedEdgeMissing' })
    } else if (feed !== 'bottom' && feed !== 'top' && feed !== 'left' && feed !== 'right') {
      refusals.push({ code: 'feedEdgeUnknown', detail: String(feed) })
    } else if (feed !== 'bottom') {
      refusals.push({ code: 'feedEdgeNotSupported', detail: String(feed) })
    }

    const side = loadRaw.sideUp
    if (side === undefined || side === null || side === '') {
      refusals.push({ code: 'sideUpMissing' })
    } else if (side !== 'front' && side !== 'back') {
      refusals.push({ code: 'sideUpUnknown', detail: String(side) })
    }

    const mir = loadRaw.mirrored
    if (typeof mir !== 'boolean') {
      refusals.push({ code: 'mirroredMissing', detail: String(mir) })
    } else if (mir) {
      refusals.push({ code: 'mirroredNotSupported' })
    }

    if (feed === 'bottom' && (side === 'front' || side === 'back') && mir === false) {
      loading = { feedEdge: 'bottom', sideUp: side, mirrored: false }
    }
  }

  /* The machine block. ABSENT IS FINE and is the normal case for every file
     written before 08/10/2026 — the tab falls back to asking. PRESENT AND
     MALFORMED IS REFUSED, same discipline as the marks: a half-read address is
     a socket opened to the wrong place, and nothing on this family of machines
     reports back.

     ⚠️ NO COERCION AND NO DEFAULTS FOR THE ADDRESS. A blank host is not
     "probably the last one"; a port of 0 is not 8080. What is missing stays
     missing and the caller decides, because this function's whole contract is
     that it never guesses (see the header of `parseCutFile`). */
  let machine: CutJobMachineJson | undefined
  if (raw.machine !== undefined && raw.machine !== null) {
    const m = raw.machine
    if (!isObj(m)) {
      refusals.push({ code: 'machineBlockMalformed', detail: 'not an object' })
    } else {
      const strOrUndef = (v: unknown, name: string): string | undefined => {
        if (v === undefined || v === null || v === '') return undefined
        if (typeof v !== 'string') {
          refusals.push({ code: 'machineBlockMalformed', detail: `${name} is not text` })
          return undefined
        }
        return v
      }
      const host = strOrUndef(m.host, 'host')
      /* A port that is present must be a usable one. Out of range is refused
         rather than clamped: 70000 silently becoming 65535 is a connection to a
         machine nobody named. */
      let port: number | undefined
      if (m.port !== undefined && m.port !== null) {
        if (!isNum(m.port) || !Number.isInteger(m.port) || m.port < 1 || m.port > 65535) {
          refusals.push({ code: 'machineBlockMalformed', detail: `port ${String(m.port)}` })
        } else {
          port = m.port
        }
      }
      /* The limits are all-or-nothing: four numbers or none. Three good ones and
         a missing fourth would leave one obstruction unchecked while the screen
         showed the machine as fully described. */
      let limitsMm: CutJobMachineJson['limitsMm']
      if (m.limitsMm !== undefined && m.limitsMm !== null) {
        const l = m.limitsMm
        if (!isObj(l) || !isNum(l.opening) || !isNum(l.material)
          || !isNum(l.bladeTravel) || !isNum(l.cameraTravel)) {
          refusals.push({ code: 'machineBlockMalformed', detail: 'limitsMm' })
        } else if (l.opening < 0 || l.material < 0 || l.bladeTravel < 0 || l.cameraTravel < 0) {
          refusals.push({ code: 'machineBlockMalformed', detail: 'a limit is negative' })
        } else {
          limitsMm = {
            opening: l.opening, material: l.material,
            bladeTravel: l.bladeTravel, cameraTravel: l.cameraTravel,
          }
        }
      }
      /* Refused BY NAME, never coerced: a convention this build does not know would
         otherwise fall through to the researched default, which MIRRORS — and a mirror
         is invisible on a symmetric shape and ruins an asymmetric one. */
      let axis: string | undefined
      const axisRaw = strOrUndef(m.axisConvention, 'axisConvention')
      if (axisRaw !== undefined) {
        if (!isSkycutAxisConvention(axisRaw)) {
          refusals.push({ code: 'machineBlockMalformed', detail: 'axisConvention ' + axisRaw })
        } else {
          axis = axisRaw
        }
      }
      machine = {
        axisConvention: axis,
        model: strOrUndef(m.model, 'model'),
        label: strOrUndef(m.label, 'label'),
        host, port, limitsMm,
      }
    }
  }

  /* Marks are optional — a job can be cut from the machine's own origin — but a
     marks block that is PRESENT and malformed is refused. `TB25` with a wrong
     rectangle scans the wrong part of the sheet and says nothing. */
  let marks: CutMarksJson | undefined
  if (raw.marks !== undefined && raw.marks !== null) {
    const m = raw.marks
    if (!isObj(m) || !isRect(m.scanRect) || !isNum(m.armMm) || !isNum(m.thicknessMm)) {
      refusals.push({ code: 'marksMalformed' })
    } else if (m.scanRect.w <= 0 || m.scanRect.h <= 0) {
      refusals.push({ code: 'marksMalformed', detail: 'scanRect is empty' })
    } else {
      marks = {
        kind: typeof m.kind === 'string' ? m.kind : 'unknown',
        scanRect: m.scanRect,
        armMm: m.armMm,
        thicknessMm: m.thicknessMm,
      }
    }
  }

  /* The groups and their contours. A malformed contour is named by its position
     so the person holding the file can find it. */
  const groups: CutGroupJson[] = []
  if (!Array.isArray(raw.groups)) {
    refusals.push({ code: 'groupsMissing' })
  } else {
    raw.groups.forEach((g, gi) => {
      if (!isObj(g) || !Array.isArray(g.contours)) {
        refusals.push({ code: 'contourMalformed', detail: `group ${gi}` })
        return
      }
      const name = typeof g.group === 'string' ? g.group : `group ${gi}`
      const perforation = g.perforation === true
      const contours: CutContourJson[] = []
      g.contours.forEach((c, ci) => {
        const where = `${name} #${ci + 1}`
        if (!isObj(c) || !isPt(c.start) || !Array.isArray(c.segments)) {
          refusals.push({ code: 'contourMalformed', detail: where })
          return
        }
        if (c.segments.length === 0) {
          refusals.push({ code: 'contourMalformed', detail: `${where}: no segments` })
          return
        }
        const segs: CutSegment[] = []
        for (const s of c.segments) {
          if (isObj(s) && s.kind === 'line' && isPt(s.to)) {
            segs.push({ kind: 'line', to: s.to })
          } else if (isObj(s) && s.kind === 'cubic' && isPt(s.c1) && isPt(s.c2) && isPt(s.to)) {
            segs.push({ kind: 'cubic', c1: s.c1, c2: s.c2, to: s.to })
          } else {
            refusals.push({ code: 'contourMalformed', detail: `${where}: bad segment` })
            return
          }
        }
        contours.push({
          closed: c.closed === true,
          start: c.start,
          segments: segs,
          lengthMm: isNum(c.lengthMm) ? c.lengthMm : undefined,
        })
      })
      /* A perforation group is refused, not dropped: dropping it would deliver a
         file that looks complete with a line missing. */
      if (perforation) refusals.push({ code: 'perforationNotSupported', detail: name })
      groups.push({ group: name, perforation, contours })
    })
    const total = groups.reduce((n, g) => n + g.contours.length, 0)
    if (total === 0) refusals.push({ code: 'noContours' })
  }

  if (refusals.length > 0) return { ok: false, refusals }

  const jobRaw = isObj(raw.job) ? raw.job : {}
  const totalsRaw = isObj(raw.totals) ? raw.totals : {}

  return {
    ok: true,
    file: {
      format: CUT_FILE_FORMAT,
      formatVersion: CUT_FILE_VERSION,
      units: CUT_FILE_UNITS,
      frame: CUT_FILE_FRAME,
      job: {
        quoteNumber: typeof jobRaw.quoteNumber === 'string' ? jobRaw.quoteNumber : undefined,
        quoteId: typeof jobRaw.quoteId === 'string' ? jobRaw.quoteId : undefined,
        title: typeof jobRaw.title === 'string' ? jobRaw.title : undefined,
        printedPdf: typeof jobRaw.printedPdf === 'string' ? jobRaw.printedPdf : undefined,
        cutPdf: typeof jobRaw.cutPdf === 'string' ? jobRaw.cutPdf : undefined,
      },
      sheet,
      loading,
      machine,
      marks,
      groups,
      totals: {
        cutLengthMm: isNum(totalsRaw.cutLengthMm) ? totalsRaw.cutLengthMm : undefined,
        lifts: isNum(totalsRaw.lifts) ? totalsRaw.lifts : undefined,
        contours: isNum(totalsRaw.contours) ? totalsRaw.contours : undefined,
      },
      notes: Array.isArray(raw.notes) ? raw.notes.filter((n): n is string => typeof n === 'string') : [],
    },
  }
}

// ─── THE TRANSFORM: millimetres on the sheet → machine units ────────────────

export interface MachinePoint {
  x: number
  y: number
}

/**
 * THE ONE PLACE MILLIMETRES BECOME MACHINE UNITS.
 *
 *   swapInvertFromSheet (default):
 *     x_machine = (sheetH − y_mm) × unitsPerMm
 *     y_machine = (sheetW − x_mm) × unitsPerMm
 *
 *   swapOnly:   x_machine = y_mm × unitsPerMm ; y_machine = x_mm × unitsPerMm
 *   direct:     x_machine = x_mm × unitsPerMm ; y_machine = y_mm × unitsPerMm
 *
 * THE CONVENTION, STATED. The input is PressCal's frame: millimetres, origin at
 * the SHEET's bottom-left corner, y UP — the frame `cut-paths.ts` stamps on its
 * own output as `'sheet-bottom-left-mm'`. The output is whole machine units, the
 * only thing the machine can be told, with the sheet's far corner as the
 * reflection reference.
 *
 * 🔴 THE SWAP AND THE INVERSION ARE RESEARCHED, NOT MEASURED BY US. Two
 * independent reverse-engineering projects for this family state
 * `x_machine = max_y − y` and `y_machine = max_x − x`, and one says so in a
 * docstring. We confirmed the SCALE on the owner's D60 with a ruler; we did not
 * confirm the axes, because the live test drew a square and a square is the one
 * shape that cannot reveal a swap. That is exactly why `axisConvention` is a
 * field on the machine record and not a constant in this function: a machine
 * that disagrees is fixed on its own card.
 *
 * ROUNDING. One unit is the smallest move the machine can make, so a fractional
 * unit is not a finer instruction, it is a number the machine will round anyway.
 * We round once, here, and everything downstream counts in whole units.
 */
export function mmToMachine(
  p: CutPointMm,
  machine: SkycutMachine,
  sheet: { w: number; h: number },
): MachinePoint {
  const k = machine.unitsPerMm
  /* 🔴 THE `default` BELOW IS NOT A FALLBACK ANY MORE. An unrecognised
     convention is refused by name before a plan exists — `checkMachine` asks
     `isSkycutAxisConvention`, and `coerceRecord` in the engine asks it again as
     the card leaves the store — so nothing unknown reaches this switch. It is
     written as `case 'swapInvertFromSheet': default:` only because the compiler
     needs a return; it is no longer the thing a typo inherits. */
  switch (machine.axisConvention) {
    case 'swapOnly':
      /* det −1 — mirrors. See the note on SKYCUT_AXIS_CONVENTIONS. */
      return { x: Math.round(p.y * k), y: Math.round(p.x * k) }
    case 'direct':
      return { x: Math.round(p.x * k), y: Math.round(p.y * k) }
    /* The two genuine quarter turns: swapped AND handedness-preserving, which is
       what the mirrored first cut of 09/10/2026 showed was missing. */
    case 'swapTurnLeft':
      return { x: Math.round(p.y * k), y: Math.round((sheet.w - p.x) * k) }
    case 'swapTurnRight':
      return { x: Math.round((sheet.h - p.y) * k), y: Math.round(p.x * k) }
    case 'swapInvertFromSheet':
    default:
      /* det −1 — mirrors. */
      return { x: Math.round((sheet.h - p.y) * k), y: Math.round((sheet.w - p.x) * k) }
  }
}

/* Distances survive the transform unchanged, which is why lengths and the
   contour ordering below are all computed in millimetres and only the POINTS are
   converted. Every convention above is a rotation, a reflection and a uniform
   scale — rigid motions, so a 10 mm move is 10 mm whichever way the axes run. If
   a future machine ever needs a non-uniform scale (different units per mm per
   axis, as `OF;` can report on other brands), this comment is where that
   assumption breaks and the lengths would have to be measured after the
   transform instead of before it. */

// ─── FLATTENING: at the machine's own step, and no finer ────────────────────

/**
 * THE TOLERANCE, AND WHY IT IS THIS NUMBER.
 *
 * One machine unit is the smallest move the machine can make: 1/40 mm = 0,025 mm
 * on his D60, 1/20 mm = 0,05 mm on a Graphtec-family machine. A chord that
 * deviates from the true curve by less than one unit cannot be distinguished
 * from the curve BY THE MACHINE — the extra points round to coordinates it has
 * already been given. So the tolerance is derived from the machine, not chosen:
 *
 *     tolerance = 1 / unitsPerMm
 *
 * Flattening finer than that buys nothing and costs bytes and time, and bytes
 * and time are real here: the stream goes out in 1024-byte chunks with a 450 ms
 * pause between them, so every 10 KB of needless points adds about four and a
 * half seconds of dead air before the head moves. Flattening coarser than that
 * shows as flats on a curve the customer paid to be round.
 *
 * PressCal deliberately leaves its curves as cubics and says in its own comment
 * that flattening belongs "at the machine boundary, in the driver, at the
 * machine's own step resolution". This is that place.
 */
export function flatteningToleranceMm(machine: SkycutMachine): number {
  return 1 / machine.unitsPerMm
}

/* A safety stop on the recursion, not a quality setting. At the tolerance above,
   an ordinary label curve needs three or four levels; ten levels is 1024 pieces
   of one segment, which no honest geometry reaches. It exists so a pathological
   curve cannot hang the main process. */
const MAX_FLATTEN_DEPTH = 10

const dist = (a: CutPointMm, b: CutPointMm): number => Math.hypot(b.x - a.x, b.y - a.y)

/* How far the two control points sit off the chord, which is the standard
   conservative stand-in for the curve's own deviation from it. */
function cubicFlatnessMm(
  p0: CutPointMm,
  c1: CutPointMm,
  c2: CutPointMm,
  p3: CutPointMm,
): number {
  const dx = p3.x - p0.x
  const dy = p3.y - p0.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) {
    /* A degenerate chord — the curve returns to where it started. Fall back to
       how far the controls reach, or a loop would read as flat and be replaced by
       a single point. */
    return Math.max(dist(p0, c1), dist(p0, c2))
  }
  const off = (c: CutPointMm): number => Math.abs((c.x - p0.x) * dy - (c.y - p0.y) * dx) / len
  return Math.max(off(c1), off(c2))
}

const mid = (a: CutPointMm, b: CutPointMm): CutPointMm => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
})

/* de Casteljau, split at the middle. The endpoint of the first half is the start
   of the second, so no point is emitted twice. */
function flattenCubicInto(
  p0: CutPointMm,
  c1: CutPointMm,
  c2: CutPointMm,
  p3: CutPointMm,
  tolMm: number,
  depth: number,
  out: CutPointMm[],
): void {
  if (depth >= MAX_FLATTEN_DEPTH || cubicFlatnessMm(p0, c1, c2, p3) <= tolMm) {
    out.push(p3)
    return
  }
  const a = mid(p0, c1)
  const b = mid(c1, c2)
  const c = mid(c2, p3)
  const ab = mid(a, b)
  const bc = mid(b, c)
  const abc = mid(ab, bc)
  flattenCubicInto(p0, a, ab, abc, tolMm, depth + 1, out)
  flattenCubicInto(abc, bc, c, p3, tolMm, depth + 1, out)
}

/**
 * One contour, in millimetres, as the polyline the machine will actually follow.
 *
 * A closed contour gets its start point appended, so the knife finishes where it
 * began. Without that the last millimetre of a label stays attached and the
 * whole sheet has to be finished by hand.
 */
export function flattenContourMm(contour: CutContourJson, tolMm: number): CutPointMm[] {
  const pts: CutPointMm[] = [contour.start]
  let cur = contour.start
  for (const seg of contour.segments) {
    if (seg.kind === 'line') {
      pts.push(seg.to)
    } else {
      flattenCubicInto(cur, seg.c1, seg.c2, seg.to, tolMm, 0, pts)
    }
    cur = seg.to
  }
  if (contour.closed) {
    const last = pts[pts.length - 1]
    if (dist(last, contour.start) > tolMm) pts.push(contour.start)
  }
  return pts
}

function polylineLengthMm(pts: CutPointMm[]): number {
  let total = 0
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i])
  return total
}

// ─── The plan: everything the operator must be told, with nothing connected ─

/* ─── 🔴 HOW THE STREAM TREATS THE HEAD, AND WHY THIS IS A TABLE ────────────
 *
 * THE FACT THE MACHINE IMPOSES ON US. A Skycut has no idea what is clamped in
 * its head. `D` means "come down and move"; whether that draws a line or cuts
 * through the sheet is decided by the tool somebody screwed in, not by the
 * bytes. So a pen pass and a cut are THE SAME STREAM, down to the byte. That is
 * not a defect in the emitter — it is the protocol — and the only safe way to
 * live with it is to stop pretending otherwise on screen.
 *
 * WHAT WAS WRONG HERE UNTIL 08/10/2026. `penDraw` was described as a dry run and
 * offered on the tab as "Dry run - pen", while emitting 272 `D` commands on the
 * 446 job — byte-for-byte identical to `cut`. On a machine with a knife still
 * fitted, the button labelled "dry run" cut the job. The word "dry run" now
 * belongs to exactly one mode, the one that emits no `D` at all, and the mode
 * that puts the head down says so in its own name.
 *
 * SO `headDown` IS DECLARED, NOT INFERRED. The emitter used to compute it as
 * `mode !== 'travelOnly'`, which means a fourth mode added later is head-down by
 * default and silently cuts. Here every mode states what it does, and a mode
 * this table does not carry is REFUSED rather than assumed. `headDown: false`
 * is the only thing in this module that makes a stream incapable of cutting, so
 * it is one flag in one table, re-checked against the finished bytes below. */
export type SkycutEmitMode = 'cut' | 'penDown' | 'travelOnly'

export interface SkycutEmitModeSpec {
  /* 🔴 THE SAFETY FLAG. True means `D` commands are emitted and whatever is in
     the head meets the material. */
  headDown: boolean
  /* Safety rule 2 applies to this mode: the operator must have looked at the
     head. True exactly when `headDown` is, and spelled out rather than derived
     so the two cannot drift apart. */
  needsHeadAnswer: boolean
  /* What the mode IS, in one line, for the plan description and the screen. No
     mode but the dry run may use the words "dry run". */
  sentence: string
}

export const SKYCUT_EMIT_MODES: Record<SkycutEmitMode, SkycutEmitModeSpec> = {
  /* The dry run, and the only one. The head never comes down, so nothing in the
     head can touch the sheet — pen, knife, or a knife somebody forgot to take
     out. This is what the live test should always start with. */
  travelOnly: {
    headDown: false,
    needsHeadAnswer: false,
    sentence: 'travel only - the head never comes down, nothing touches the sheet',
  },
  /* Head down with a pen in it. NOT a dry run: the commands are identical to a
     cut, and the only thing standing between this and a cut sheet is that the
     knife is physically out of the head. Worth having — it is how a new
     machine's axes and scale are proved on paper — but it must be chosen with
     that understood. */
  penDown: {
    headDown: true,
    needsHeadAnswer: true,
    sentence: 'pen, HEAD DOWN - the same commands as a cut; safe only because the knife is out of the head',
  },
  cut: {
    headDown: true,
    needsHeadAnswer: true,
    sentence: 'cut - the blade comes down',
  },
}

/* The one mode the screen may call a dry run, named once so no caller has to
   remember which of the three it was. */
export const SKYCUT_DRY_RUN_MODE: SkycutEmitMode = 'travelOnly'

/* Is `mode` a mode this build knows? A string off IPC is not a union. */
export function isSkycutEmitMode(mode: unknown): mode is SkycutEmitMode {
  return typeof mode === 'string' && Object.prototype.hasOwnProperty.call(SKYCUT_EMIT_MODES, mode)
}

/* 🔴 Does this mode put the head down? The single question every guard asks.
   An unknown mode answers TRUE — the dangerous answer — so a caller that skips
   the `isSkycutEmitMode` check still cannot get a head-up stream by accident out
   of a mode nobody declared. */
export function skycutModeIsHeadDown(mode: unknown): boolean {
  if (!isSkycutEmitMode(mode)) return true
  return SKYCUT_EMIT_MODES[mode].headDown
}

export interface SkycutPlanOptions {
  mode: SkycutEmitMode
  /* Safety rule 2: the operator has LOOKED AT THE HEAD and said what is fitted.
     Required by every mode whose spec says `needsHeadAnswer` — `'penDown'`
     included, because choosing "pen" in a menu is not the same as the knife
     being out, and the knife is the one that ruins the sheet. The dry run does
     not read it: nothing comes down, so there is nothing to confirm.
     Only an operator's own answer may set it — never a default, never a
     remembered preference, never a value carried over from a previous send, and
     never one carried over from a DIFFERENT MACHINE. The tab binds the answer to
     the machine it was given for; see `CuttingPlotter.tsx`. */
  bladeConfirmed?: boolean
}

export interface SkycutContourPlan {
  group: string
  /* 1-based, in the file's own order, so a refusal or a warning can name it. */
  index: number
  /* Machine units, ready to emit. */
  points: MachinePoint[]
  cutLengthMm: number
  /* Head-up distance from the previous contour's end to this one's start. */
  travelInMm: number
}

export interface SkycutPlan {
  machine: SkycutMachine
  mode: SkycutEmitMode
  job: CutJobJson
  sheet: { w: number; h: number }
  loading: CutLoadingJson
  /* 🔴 SAFETY RULE 3. The drawing's own extent in millimetres, on the sheet, so
     it can be read out loud before anything is sent. */
  footprintMm: CutRectMm
  contours: SkycutContourPlan[]
  contourCount: number
  /* Head-down distance: what the blade actually cuts. This is the number the
     owner intends to charge by. */
  cutLengthMm: number
  /* Head-up distance, including the run from the park position to the first
     contour and back at the end. Produced by the ordering below, and reported
     because the ordering is ours and therefore ours to justify. */
  travelMm: number
  /* How many times the head lifts: one per contour, by construction. */
  lifts: number
  /* Flattened point count, i.e. how many coordinates go down the wire. */
  pointCount: number
  /* `heightMm` and `widthMm` are the two numbers the scan command carries.
     `originMm` is where the rectangle's bottom-left mark sits on the sheet —
     NOT sendable (the command has no argument for it) and NOT discarded: it is
     where the operator must park the head, and `describeSkycutPlan` says so.
     See the note on `CutMarksJson.scanRect`. */
  markScan: { opcode: string; heightMm: number; widthMm: number; originMm: CutPointMm } | null
  toleranceMm: number
  estimatedSeconds: number | null
  notes: SkycutNote[]
}

export type SkycutPlanResult =
  | { ok: true; plan: SkycutPlan }
  | { ok: false; refusals: SkycutRefusal[]; notes: SkycutNote[] }

/* Float dust from millimetre arithmetic, rounded away so 45 does not read
   44.99999999999999. Same helper and same reason as PressCal's own. */
const mm3 = (v: number): number => Math.round(v * 1e3) / 1e3

/* A contour whose points fall outside the sheet is not a cut — it is the head
   driving past the edge of the paper. A hair of tolerance so a path that touches
   the sheet edge exactly is not refused for float dust. */
const OFF_SHEET_TOLERANCE_MM = 0.05

/* How far our flattened length may differ from PressCal's exact length before it
   is worth telling somebody. Flattening legitimately shortens a curve a little;
   a percent is far more than that and means the two sides disagree about the
   geometry itself. */
const TOTALS_TOLERANCE_FRACTION = 0.01

function checkMachine(machine: SkycutMachine): SkycutRefusal[] {
  const out: SkycutRefusal[] = []
  if (!isNum(machine.unitsPerMm) || machine.unitsPerMm <= 0) {
    out.push({ code: 'machineUnitsInvalid', detail: String(machine.unitsPerMm) })
  }
  if (!isNum(machine.chunkBytes) || machine.chunkBytes < 1) {
    out.push({ code: 'machineChunkInvalid', detail: `chunkBytes ${machine.chunkBytes}` })
  }
  if (!isNum(machine.chunkPauseMs) || machine.chunkPauseMs < 0) {
    out.push({ code: 'machineChunkInvalid', detail: `chunkPauseMs ${machine.chunkPauseMs}` })
  }
  /* The opcode is a free string so a third machine costs a settings edit, but it
     still has to LOOK like one: `TB` and a number. A typo here scans the wrong
     rectangle in silence. */
  if (!/^TB\d{1,3}$/.test(machine.markScanOpcode)) {
    out.push({ code: 'markOpcodeInvalid', detail: machine.markScanOpcode })
  }
  /* 🔴 THE TWO FIELDS THAT ARE TYPED AS UNIONS AND ARRIVE AS STRINGS. Both come
     off a settings file nothing enforces. The engine refuses an unrecognised
     value as it loads the card; this is the same question asked again at the
     only boundary that can see the geometry, because `planSkycutJob` is exported
     and a caller may hand it a record it assembled itself. Named here, so the
     refusal carries the offending word rather than a code the operator cannot
     act on. */
  if (!isSkycutAxisConvention(machine.axisConvention)) {
    out.push({ code: 'axisConventionUnknown', detail: String(machine.axisConvention) })
  }
  if (!isSkycutMarkArgOrder(machine.markScanArgs)) {
    out.push({ code: 'markScanArgsUnknown', detail: String(machine.markScanArgs) })
  }
  if (machine.speedVs !== null) {
    if (!Number.isInteger(machine.speedVs) || machine.speedVs < VS_MIN || machine.speedVs > VS_MAX) {
      out.push({ code: 'speedOutOfRange', detail: `${machine.speedVs} (${VS_MIN}..${VS_MAX})` })
    }
  }
  return out
}

/**
 * ORDERING THE CONTOURS, AND WHAT "SENSIBLY" MEANS.
 *
 * Greedy nearest-neighbour on the contour start points, beginning at the park
 * position (0,0 in machine units, which is the sheet's far corner under the
 * default convention) and walking to whichever unvisited contour starts closest
 * to where the head just finished. Ties break on the file's own order, so the
 * same file always produces the same stream — a stream that reshuffles between
 * sends is one nobody can compare against a previous one.
 *
 * WHY NOT SOMETHING BETTER. Nearest-neighbour is typically within a quarter of
 * the optimal tour and costs nothing to read; the optimal tour is a travelling
 * salesman problem, and on the sheets this shop runs the difference is a few
 * seconds of head movement. WHY NOT THE FILE'S ORDER: PressCal emits contours
 * grid-row by grid-row, which on a 2-up sheet is harmless and on a 40-up sheet
 * walks the head back across the sheet once per row.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not reorder the contours WITHIN a
 * group, beyond this, and it does not try to cut inner shapes before outer ones:
 * PressCal knows which contour is a hole and this module does not, so inventing
 * a nesting order here would be guessing with a knife. The order inside a
 * contour is the file's, always.
 *
 * The travel it produces is reported on the plan, because the owner intends to
 * charge by blade travel and a number used for money has to come from the thing
 * that actually ran.
 */
function orderByNearest(
  items: { start: CutPointMm; end: CutPointMm }[],
  parkMm: CutPointMm,
): number[] {
  const order: number[] = []
  const used = new Array(items.length).fill(false)
  let at = parkMm
  for (let n = 0; n < items.length; n++) {
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < items.length; i++) {
      if (used[i]) continue
      const d = dist(at, items[i].start)
      if (d < bestD - 1e-9) {
        bestD = d
        best = i
      }
    }
    used[best] = true
    order.push(best)
    at = items[best].end
  }
  return order
}

/**
 * The whole job, described, with nothing connected to anything.
 *
 * This is what satisfies safety rule 3: footprint, cut length, blade travel,
 * contour count, lifts and — only when the machine card carries a measured speed
 * — an estimated time. Every one of those numbers is arithmetic on the handover
 * file, so the operator can be shown all of it before the first byte leaves.
 */
export function planSkycutJob(
  file: CutJobFile,
  machine: SkycutMachine,
  options: SkycutPlanOptions,
): SkycutPlanResult {
  const refusals: SkycutRefusal[] = [...checkMachine(machine)]
  const notes: SkycutNote[] = []

  /* 🔴 SAFETY RULE 2, at the only place it can be enforced: before any `D` is
     produced. The live test put a pen in only after the knife came out, and the
     software must not be the thing that forgets that.
     Asked of the mode's own spec, never of `mode !== 'travelOnly'`: an
     undeclared mode is refused outright, and a declared one answers for
     itself. */
  if (!isSkycutEmitMode(options.mode)) {
    refusals.push({ code: 'emitModeUnknown', detail: String(options.mode) })
  } else if (SKYCUT_EMIT_MODES[options.mode].needsHeadAnswer && options.bladeConfirmed !== true) {
    refusals.push({ code: 'bladeNotConfirmed', detail: options.mode })
  }

  if (machine.provenance === 'thirdParty') notes.push({ code: 'profileThirdParty', detail: machine.model })
  if (machine.axisConvention === 'swapInvertFromSheet') notes.push({ code: 'axisConventionUnverified' })

  /* A broken machine card or an unconfirmed blade is answered before any
     geometry is touched. Measuring a job against a machine whose units-per-mm is
     zero would produce numbers that mean nothing, and printing them next to the
     real reason only buries it. */
  if (refusals.length > 0) return { ok: false, refusals, notes }

  const tolMm = flatteningToleranceMm(machine)
  const sheet = file.sheet

  /* Flatten first, in millimetres, then measure. The length reported is the
     length of the polyline the machine will walk — not of the ideal curve —
     because that is what the blade does and what the clock will show. */
  const flat: { group: string; index: number; pts: CutPointMm[]; lengthMm: number }[] = []
  let fileExactLengthMm = 0
  for (const g of file.groups) {
    g.contours.forEach((c, i) => {
      const pts = flattenContourMm(c, tolMm)
      flat.push({ group: g.group, index: i + 1, pts, lengthMm: polylineLengthMm(pts) })
      if (c.lengthMm !== undefined) fileExactLengthMm += c.lengthMm
    })
  }

  /* Off the sheet is refused, and counted, so the screen can say how many. */
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  let offSheet = 0
  let offSheetWhere = ''
  for (const f of flat) {
    let bad = false
    for (const p of f.pts) {
      if (p.x < x0) x0 = p.x
      if (p.y < y0) y0 = p.y
      if (p.x > x1) x1 = p.x
      if (p.y > y1) y1 = p.y
      if (
        p.x < -OFF_SHEET_TOLERANCE_MM ||
        p.y < -OFF_SHEET_TOLERANCE_MM ||
        p.x > sheet.w + OFF_SHEET_TOLERANCE_MM ||
        p.y > sheet.h + OFF_SHEET_TOLERANCE_MM
      ) {
        bad = true
      }
    }
    if (bad) {
      offSheet++
      if (offSheetWhere === '') offSheetWhere = `${f.group} #${f.index}`
    }
  }
  if (offSheet > 0) {
    refusals.push({
      code: 'contourOffSheet',
      detail: `${offSheet} contour(s), first ${offSheetWhere}, sheet ${sheet.w} x ${sheet.h} mm`,
    })
  }

  const footprintMm: CutRectMm = Number.isFinite(x0)
    ? { x: mm3(x0), y: mm3(y0), w: mm3(x1 - x0), h: mm3(y1 - y0) }
    : { x: 0, y: 0, w: 0, h: 0 }

  /* The machine's own limit, when anybody has measured it. A null limit is said
     out loud rather than skipped: the footprint is still stated, but nothing has
     checked that it fits. */
  if (machine.maxMaterialMm === null) {
    notes.push({ code: 'materialLimitUnknown', detail: machine.model })
  } else {
    /* Each dimension on its own, because the length may be unmeasured while the
       width is known — see the field. An unmeasured length checks nothing rather
       than comparing against a zero that would refuse everything. */
    const lim = machine.maxMaterialMm
    const tooWide = footprintMm.w > lim.w + 1e-6
    const tooLong = lim.h !== null && footprintMm.h > lim.h + 1e-6
    if (tooWide || tooLong) {
      const limH = lim.h === null ? 'any' : String(lim.h)
      refusals.push({
        code: 'footprintExceedsMachine',
        detail: `${footprintMm.w} x ${footprintMm.h} mm into ${lim.w} x ${limH} mm`,
      })
    }
  }

  if (refusals.length > 0) return { ok: false, refusals, notes }

  /* Order, then convert. Ordering in millimetres is safe because every axis
     convention is a rigid motion — see the note under the transform. */
  const ends = flat.map((f) => ({ start: f.pts[0], end: f.pts[f.pts.length - 1] }))
  /* The park position in millimetres: whichever sheet corner maps to machine
     (0,0) under this machine's convention. Derived from the transform rather than
     assumed, so a changed convention moves the park too. */
  /* ═══ WHERE THE MACHINE'S ZERO IS ═══
   *
   * With camera marks the operator parks over the first mark and the scan sets the origin there,
   * so every coordinate is measured from that mark and inverted against the MARK RECTANGLE.
   * Without marks there is no scan, the head is parked at the sheet's own corner, and the sheet
   * is the frame. One decision, made once, used by the park and by every point below it. */
  const markOrigin = file.marks ? file.marks.scanRect : null
  const originFrame = markOrigin ? { w: markOrigin.w, h: markOrigin.h } : sheet
  const originRelative = (p: CutPointMm): CutPointMm =>
    markOrigin ? { x: p.x - markOrigin.x, y: p.y - markOrigin.y } : p

  /* ⚠️ THE PARK IS WORKED OUT IN THE MACHINE'S FRAME AND THEN PUT BACK INTO THE SHEET'S, because
     everything below it — the ordering and every travel distance — is in sheet millimetres.
     Leaving it in the mark frame would compare a mark-relative point against sheet-absolute ones
     and order the contours by a distance that is nonsense. Distances themselves are unaffected by
     the move: a translation preserves them, which is why only the park needs converting and the
     travel sums do not. */
  const parkInFrame = parkPositionMm(machine, originFrame)
  const parkMm = markOrigin
    ? { x: parkInFrame.x + markOrigin.x, y: parkInFrame.y + markOrigin.y }
    : parkInFrame
  const order = orderByNearest(ends, parkMm)

  const contours: SkycutContourPlan[] = []
  let travelMm = 0
  let cutLengthMm = 0
  let pointCount = 0
  let at = parkMm
  for (const idx of order) {
    const f = flat[idx]
    const travelInMm = dist(at, f.pts[0])
    travelMm += travelInMm
    cutLengthMm += f.lengthMm
    pointCount += f.pts.length
    contours.push({
      group: f.group,
      index: f.index,
      /* 🔴 MEASURED FROM THE FIRST MARK WHEN THERE ARE MARKS, NOT FROM THE
         SHEET'S CORNER — and getting this wrong is what threw a sheet out of
         the machine on 09/10/2026.

         `describeSkycutPlan` has always told the operator to PARK THE HEAD OVER
         THE FIRST MARK, because the scan command carries the rectangle's size
         and never its position. So after the scan the machine's origin IS that
         mark. The points, meanwhile, were going out measured from the sheet's
         own corner — so every one of them carried the mark's offset as a lie,
         and once the axes were swapped that lie became the width of the sheet.

         ⚠️ AND THE FRAME CHANGES WITH THE ORIGIN. The inversions inside
         `mmToMachine` subtract from the frame's own width and height, so a
         mark-relative point must be inverted against the MARK RECTANGLE's
         dimensions, not the sheet's. Passing the sheet there would fix the
         origin and leave the mirror axis in the wrong place — a subtler version
         of the same bug.

         No marks means no scan, the operator parks at the sheet's own corner,
         and the sheet frame is the right one — which is why this is a swap of
         frames and not an unconditional subtraction. */
      points: f.pts.map((p) => mmToMachine(originRelative(p), machine, originFrame)),
      cutLengthMm: mm3(f.lengthMm),
      travelInMm: mm3(travelInMm),
    })
    at = f.pts[f.pts.length - 1]
  }
  /* The run home at the end, because the stream parks the head before `@;`. */
  travelMm += dist(at, parkMm)

  if (fileExactLengthMm > 0) {
    const gap = Math.abs(fileExactLengthMm - cutLengthMm)
    if (gap > fileExactLengthMm * TOTALS_TOLERANCE_FRACTION) {
      notes.push({
        code: 'totalsDisagree',
        detail: `file ${mm3(fileExactLengthMm)} mm, flattened ${mm3(cutLengthMm)} mm`,
      })
    }
  }

  /* The camera scan. `TB25,<h>,<w>;` on his D60; `TB26` on the D24 per a
     third-party reading. The arguments are the mark-to-mark spans of the printed
     rectangle, in machine units — height across the sheet's height, width across
     its width — and the order is a per-machine field because the machine never
     answers and a swapped pair scans a rectangle nobody printed.

     `CT1;` follows the scan.

     🔴 AND THE RECTANGLE'S POSITION. The command carries two numbers, so the
     position cannot go down the wire at all — the machine takes it from where
     the head is parked. It is carried on the plan as `originMm` and read out to
     the operator by `describeSkycutPlan`, because "park the head over the mark
     at 6, 32 mm" is the instruction that makes the two numbers mean anything.
     See `CutMarksJson.scanRect`. */
  let markScan: SkycutPlan['markScan'] = null
  if (file.marks) {
    markScan = {
      opcode: machine.markScanOpcode,
      heightMm: file.marks.scanRect.h,
      widthMm: file.marks.scanRect.w,
      originMm: { x: mm3(file.marks.scanRect.x), y: mm3(file.marks.scanRect.y) },
    }
  } else {
    notes.push({ code: 'noMarkScan' })
  }

  /* An estimate only when the card carries measured speeds. A number invented
     from `VS` would read exactly like a measured one on screen. */
  let estimatedSeconds: number | null = null
  if (machine.cutSpeedMmPerSec !== null && machine.travelSpeedMmPerSec !== null) {
    estimatedSeconds =
      Math.round(cutLengthMm / machine.cutSpeedMmPerSec + travelMm / machine.travelSpeedMmPerSec)
  } else {
    notes.push({ code: 'noMeasuredSpeed' })
  }

  return {
    ok: true,
    plan: {
      machine,
      mode: options.mode,
      job: file.job,
      sheet,
      loading: file.loading,
      footprintMm,
      contours,
      contourCount: contours.length,
      cutLengthMm: mm3(cutLengthMm),
      travelMm: mm3(travelMm),
      lifts: contours.length,
      pointCount,
      markScan,
      toleranceMm: tolMm,
      estimatedSeconds,
      notes,
    },
  }
}

/* Which sheet corner is machine (0,0) under this convention. Found by asking the
   transform rather than by assuming, so the two can never disagree. */
function parkPositionMm(machine: SkycutMachine, sheet: { w: number; h: number }): CutPointMm {
  switch (machine.axisConvention) {
    case 'swapInvertFromSheet':
      return { x: sheet.w, y: sheet.h }
    case 'swapOnly':
    case 'direct':
    default:
      return { x: 0, y: 0 }
  }
}

// ─── The stream ─────────────────────────────────────────────────────────────

/* 🔴 SAFETY RULE 1, AS A CHECK ON THE FINISHED BYTES. There is no force field in
   this module's types, so none of these can be produced by any input — this
   exists to catch a future edit. `FS`/`!FS` are force on this family, `FC` is
   Graphtec's cutter-offset/force group, and `BF` is blade force on others.
   Matched at a command boundary, which is where every command in our stream
   starts. */
const FORBIDDEN_OPCODES = ['FS', '!FS', 'FC', 'BF']

const isForceCommand = (cmd: string): boolean =>
  FORBIDDEN_OPCODES.some((op) => cmd.startsWith(op))

export interface SkycutChunk {
  /* The bytes of this chunk, as the ASCII text they are. */
  text: string
  /* How long to wait after writing it, milliseconds. The last chunk's pause is
     the machine's own business, not ours — the transport closes the socket. */
  pauseMsAfter: number
}

export interface SkycutStream {
  /* One command per entry, in order, ready to be read by a human. */
  commands: string[]
  /* The same commands, concatenated with no separator, which is what goes out.
     No newlines: the manufacturer's own sender concatenates, and whitespace the
     machine has never been sent is not something to try on a machine that cannot
     report an error. */
  text: string
  /* Split on command boundaries, never mid-command, at or under the machine's
     chunk size. */
  chunks: SkycutChunk[]
  byteLength: number
  notes: SkycutNote[]
}

export type SkycutStreamResult =
  | { ok: true; stream: SkycutStream }
  | { ok: false; refusals: SkycutRefusal[] }

/**
 * The plan in, the bytes out, in the order the live test proved:
 *
 *     IN;                       initialise
 *     PA;                       absolute coordinates
 *     TB25,<h>,<w>;  CT1;       scan the printed marks, when the job has marks
 *     VS<n>;                    speed, when the machine card sets one
 *     U<x>,<y>;                 travel to a contour's start, head up
 *     D<x>,<y>; …               cut along it, head down
 *     U0,0;                     park
 *     @;                        end
 *
 * 🔴 WHETHER `D` IS EMITTED AT ALL comes from the mode's own spec in
 * `SKYCUT_EMIT_MODES`, not from a comparison against one mode's name. In the dry
 * run (`headDown: false`) every point is a `U`, so the head traces the job in
 * the air with nothing touching the material — and the finished commands are
 * re-checked for a stray `D` below before any of this is handed to a transport.
 */
export function emitSkycutStream(plan: SkycutPlan): SkycutStreamResult {
  const m = plan.machine
  const notes: SkycutNote[] = []
  const commands: string[] = []

  /* An undeclared mode has no stated answer to "does the head come down", so it
     gets no stream at all. Checked here as well as in `planSkycutJob` because
     this function is exported and a future caller may emit from a plan it
     assembled itself. */
  if (!isSkycutEmitMode(plan.mode)) {
    return { ok: false, refusals: [{ code: 'emitModeUnknown', detail: String(plan.mode) }] }
  }

  const move = (p: MachinePoint): string => `U${p.x},${p.y};`
  const carve = (p: MachinePoint): string => `D${p.x},${p.y};`

  commands.push('IN;')
  commands.push('PA;')

  if (plan.markScan) {
    /* 🔴 TWO ARGUMENTS, AND ONLY TWO. `plan.markScan.originMm` is deliberately
       not emitted: the proven command set has no argument for where the
       rectangle sits, and a third number appended on a hunch would be a
       coordinate the machine reads as something else, in silence. The position
       reaches the operator through `describeSkycutPlan` instead — he parks the
       head there. */
    const h = Math.round(plan.markScan.heightMm * m.unitsPerMm)
    const w = Math.round(plan.markScan.widthMm * m.unitsPerMm)
    const args = m.markScanArgs === 'widthHeight' ? `${w},${h}` : `${h},${w}`
    commands.push(`${plan.markScan.opcode},${args};`)
    commands.push('CT1;')
  }

  if (m.speedVs !== null) commands.push(`VS${m.speedVs};`)

  const headDown = SKYCUT_EMIT_MODES[plan.mode].headDown
  for (const c of plan.contours) {
    if (c.points.length === 0) continue
    commands.push(move(c.points[0]))
    for (let i = 1; i < c.points.length; i++) {
      commands.push(headDown ? carve(c.points[i]) : move(c.points[i]))
    }
  }

  commands.push('U0,0;')
  commands.push('@;')

  /* The two guards, on the finished stream rather than on anybody's intention. */
  const offending = commands.find(isForceCommand)
  if (offending !== undefined) {
    return { ok: false, refusals: [{ code: 'forceCommandInStream', detail: offending }] }
  }
  /* 🔴 THE DRY RUN'S OWN GUARD. Asked of `skycutModeIsHeadDown` rather than of
     the local flag, so the question is answered by the same function every other
     caller uses — and an undeclared mode answers "head down", which cannot reach
     here but keeps the dangerous default dangerous everywhere. */
  if (!skycutModeIsHeadDown(plan.mode)) {
    const down = commands.find((c) => c.startsWith('D'))
    if (down !== undefined) {
      return { ok: false, refusals: [{ code: 'headDownCommandInHeadUpStream', detail: down }] }
    }
  }

  /* CHUNKING. The manufacturer's software writes 1024 bytes at a time with a
     ~450 ms pause, blindly, to keep the machine's buffer from overflowing — it
     has no flow control to lean on because the machine never speaks. We pace the
     same way but split only BETWEEN commands: half a `D1234,5678;` followed by
     450 ms of silence is a coordinate the machine may well accept as finished,
     and it cannot tell us it did. Splitting on a boundary is a strict subset of
     what the manufacturer sends, so it cannot be worse, and it removes an entire
     class of silent failure. */
  const chunks: SkycutChunk[] = []
  let buf = ''
  for (const cmd of commands) {
    if (cmd.length > m.chunkBytes) {
      /* Cannot happen with the commands above — the longest is a few dozen bytes
         — but a chunk size set absurdly low on a machine card would otherwise
         loop forever. It travels alone and the plan says so. */
      if (buf !== '') {
        chunks.push({ text: buf, pauseMsAfter: m.chunkPauseMs })
        buf = ''
      }
      chunks.push({ text: cmd, pauseMsAfter: m.chunkPauseMs })
      notes.push({ code: 'commandLongerThanChunk', detail: cmd })
      continue
    }
    if (buf.length + cmd.length > m.chunkBytes) {
      chunks.push({ text: buf, pauseMsAfter: m.chunkPauseMs })
      buf = ''
    }
    buf += cmd
  }
  if (buf !== '') chunks.push({ text: buf, pauseMsAfter: m.chunkPauseMs })

  const text = commands.join('')
  return {
    ok: true,
    stream: { commands, text, chunks, byteLength: text.length, notes },
  }
}

/* ASCII out. The whole command set is digits, commas, semicolons and a handful
   of letters, so there is nothing to encode — but the transport should write
   bytes it was handed rather than re-encode a string under whatever default it
   happens to have. */
export function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0x7f
  return out
}

// ─── Describing the job in words, for the screen ────────────────────────────

const fmtMm = (v: number): string => (Math.round(v * 100) / 100).toFixed(2)

/**
 * The lines the operator must read BEFORE anything is sent — safety rule 3 in
 * the form it reaches a human. Computed from the plan, so it is available with
 * no machine switched on and no socket opened.
 *
 * English literals, like every other label in this app.
 *
 * 🔴 NOTE WHAT IS NOT HERE: any claim about the outcome. The machine never
 * answers, so the software cannot know a job was cut. The screen's own wording
 * after a send is "Sent" — never "Cut", never "Done".
 */
export function describeSkycutPlan(plan: SkycutPlan): string[] {
  const lines: string[] = []
  const job = plan.job.quoteNumber ?? plan.job.title ?? 'untitled job'
  lines.push(`Job: ${job}`)
  lines.push(`Machine: ${plan.machine.label} (${plan.machine.unitsPerMm} units/mm)`)
  lines.push(`Sheet: ${fmtMm(plan.sheet.w)} x ${fmtMm(plan.sheet.h)} mm`)
  lines.push(
    `Footprint: ${fmtMm(plan.footprintMm.w)} x ${fmtMm(plan.footprintMm.h)} mm` +
      `, at ${fmtMm(plan.footprintMm.x)}, ${fmtMm(plan.footprintMm.y)} mm from the sheet's bottom-left corner`,
  )
  lines.push(
    `Load: ${plan.loading.feedEdge} edge first, ${plan.loading.sideUp} side up` +
      (plan.loading.mirrored ? ', mirrored' : ''),
  )
  lines.push(`Contours: ${plan.contourCount}   Lifts: ${plan.lifts}   Points: ${plan.pointCount}`)
  lines.push(`Blade down: ${fmtMm(plan.cutLengthMm)} mm   Head travel: ${fmtMm(plan.travelMm)} mm`)
  /* 🔴 THE SCAN RECTANGLE'S POSITION, STATED RATHER THAN DROPPED. The command
     carries only the two spans, so the position cannot be sent — the machine
     takes it from where the head is parked, and that is the operator's job. A
     rectangle of the right size hunted for in the wrong place finds nothing,
     and the machine never reports back. */
  lines.push(
    plan.markScan
      ? `Mark scan: ${plan.markScan.opcode} over ${fmtMm(plan.markScan.widthMm)} x ${fmtMm(plan.markScan.heightMm)} mm`
      : 'Mark scan: none - the cut is positioned from the machine origin',
  )
  if (plan.markScan) {
    lines.push(
      `Park the head over the first mark, ${fmtMm(plan.markScan.originMm.x)} mm in from the left edge and` +
        ` ${fmtMm(plan.markScan.originMm.y)} mm up from the edge that goes in first` +
        ' - the scan command carries the rectangle\'s size, never its position',
    )
  }
  lines.push(
    plan.estimatedSeconds === null
      ? 'Estimated time: unknown - no measured speed on this machine'
      : `Estimated time: ${Math.floor(plan.estimatedSeconds / 60)}m ${plan.estimatedSeconds % 60}s`,
  )
  /* One sentence, from the mode's own spec. Not a chain of comparisons here and
     another on the screen: the line the operator reads and the flag that decides
     whether `D` is emitted come out of the same table entry. */
  lines.push(
    isSkycutEmitMode(plan.mode)
      ? `Mode: ${SKYCUT_EMIT_MODES[plan.mode].sentence}`
      : `Mode: ${String(plan.mode)} - UNKNOWN TO THIS BUILD, nothing may be sent`,
  )
  return lines
}
