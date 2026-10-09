/**
 * WHO MAY TALK TO THE LOCAL SERVER — the whole decision, as one pure function.
 *
 * 🔴 WHY IT IS NOT INLINE IN THE REQUEST HANDLER. The server on 127.0.0.1:17824 answers
 * `Access-Control-Allow-Origin: *` and can write a file to any absolute path, so this decision is
 * the only thing standing between a random web page and the shop's disk — and, once PressCal gains
 * its cut button, between a random web page and a loaded blade. A decision that matters that much
 * does not belong in the middle of a 200-line `if` ladder where nobody can exercise it. Here it can
 * be run through every case it has, by `scripts/local-auth-check.mjs`, without launching the app.
 *
 * 🔴 AND THE DEFAULT IS THE DANGEROUS-SOUNDING ONE, DELIBERATELY: with no key stored, everything is
 * allowed. That is what the server does today, and the deployed PressCal depends on it for saving
 * files and refreshing folders. Demanding a key before anything had one would break every one of
 * those the moment this build installed. The door closes on the first successful pairing, which
 * PressCal performs by itself on its first page load — a window of seconds, on his own machine.
 *
 * ⚠️ NOTHING HERE READS THE DISK, THE STORE, OR THE REQUEST BODY. It is handed the stored key and
 * the offered key and answers. That is what makes it checkable.
 */

/** The header the key travels in. One spelling, shared with PressCal's `presskit-local.ts`. */
export const LOCAL_KEY_HEADER = 'x-presscal-key'

/** PressKit refuses to store anything shorter. 24 random bytes as hex is 48, comfortably over. */
export const LOCAL_KEY_MIN_LENGTH = 32

export type LocalAuthDecision =
  /** Let it through. */
  | { allow: true }
  /** Refuse with this status and reason. */
  | { allow: false; status: 401 | 409 | 400; reason: string }

/** Is this a route that must answer before any pairing can exist?
 *
 *  🔴 EXACTLY ONE: `/health`. It is how PressCal discovers PressKit at all, which has to work
 *  before a pairing can exist, and it answers nothing but "something is listening" plus whether a
 *  key is held. Everything else — saving, listing, reading a path, picking a folder, refreshing,
 *  exporting — is behind the lock. Adding a route here is giving it away to every web page on the
 *  machine, so the list is closed and this comment is the reason.
 *
 *  🔴 `?pair=1` IS DELIBERATELY *NOT* HERE, AND IT USED TO BE — FOR ABOUT TEN MINUTES, AS A HOLE.
 *  The pairing request is handled and RETURNED before this check is ever reached, so the only way
 *  to arrive here with `pair` in the query is to have attached it to something else. Treating that
 *  as an open route meant `GET /?pair=1&list=C:\` skipped the lock and then ran the directory
 *  listing: a one-parameter bypass of the whole thing. The route that answers early does not need
 *  an exemption later. */
export function isOpenRoute(pathname: string | null, query: Record<string, unknown>): boolean {
  if (pathname !== '/health') return false
  /* ⚠️ AND ONLY WHEN IT CARRIES NOTHING ELSE. `/health` returns early today, so a parameter on it
     reaches no other route — but "today" is the whole weakness of that sentence, and the bypass
     this file already had came from exactly that kind of reasoning. An exemption that is true
     regardless of the order the routes are written in costs one line. PressCal calls `/health`
     with no query at all. */
  return !ACTIONABLE.some((k) => query[k] !== undefined)
}

/** Every parameter that makes the server DO something. An exemption must not carry one of these.
 *
 *  🔴 KEEP THIS IN STEP WITH THE ROUTES IN `index.ts`. A new parameter that is not listed here is
 *  not a hole by itself — the lock applies to everything that is not `/health` — but it would
 *  become one the moment somebody adds a second open route. */
const ACTIONABLE = [
  'save', 'exportImposition', 'createFolder', 'pickFolder', 'refresh', 'list', 'path', 'pair', 'cut',
] as const

/**
 * May this request proceed?
 *
 * @param storedKey  the key this PressKit holds, or null when it has never been paired
 * @param givenKey   the key the request carried, if any
 */
export function localAuth(
  storedKey: string | null,
  givenKey: unknown,
): LocalAuthDecision {
  /* Never paired: open, exactly as every build before 09/10/2026. */
  if (storedKey === null) return { allow: true }
  if (typeof givenKey !== 'string' || givenKey !== storedKey) {
    return { allow: false, status: 401, reason: 'not paired with this PressKit' }
  }
  return { allow: true }
}

/**
 * May this pairing be accepted?
 *
 * 🔴 TRUST ON FIRST USE, AND RE-KEYING ONLY BY WHOEVER HOLDS THE KEY. A lock that anybody can
 * re-key is not a lock: if a stranger could replace the stored key, the pairing would be worth
 * nothing the moment PressCal was not the first to ask. So the second caller is refused, and the
 * app that is already paired can repair itself after a cleared config because it still holds the
 * key it is replacing.
 *
 * ⚠️ OFFERING THE SAME KEY AGAIN SUCCEEDS. PressCal pairs on page load without remembering whether
 * it already has; a build that refused an identical key would make that harmless call an error and
 * invite somebody to "fix" it by weakening the check above.
 */
export function localPairAuth(
  storedKey: string | null,
  offeredKey: unknown,
  givenKey: unknown,
): LocalAuthDecision {
  if (typeof offeredKey !== 'string' || offeredKey.trim().length < LOCAL_KEY_MIN_LENGTH) {
    return { allow: false, status: 400, reason: 'key too short' }
  }
  if (storedKey === null) return { allow: true }
  if (typeof givenKey === 'string' && givenKey === storedKey) return { allow: true }
  return { allow: false, status: 409, reason: 'already paired' }
}
