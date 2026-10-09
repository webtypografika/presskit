/**
 * Exercise the local server's authorisation decision through every case it has.
 *
 *     node scripts/local-auth-check.mjs
 *
 * This repo has no test runner (see package.json), so behaviour that matters is demonstrated by a
 * script, the same way `scripts/skycut-dry-run.mjs` does it. CONNECTS TO NOTHING: there is no
 * socket in this file and no address anywhere in it.
 *
 * 🔴 WHY THIS DESERVES A CHECK OF ITS OWN. The server on 127.0.0.1:17824 answers every origin and
 * can write a file to any absolute path. This function is the only thing between a random web page
 * and the shop's disk — and, once PressCal's cut button exists, between a random web page and a
 * loaded blade. Every assertion below is a sentence somebody could otherwise get wrong by one
 * character.
 *
 * Exits non-zero on the first failure.
 */
import {
  localAuth,
  localPairAuth,
  isOpenRoute,
  LOCAL_KEY_MIN_LENGTH,
} from '../src/main/local-auth.ts'

let failures = 0
const KEY = 'a'.repeat(48)
const OTHER = 'b'.repeat(48)

function check(what, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) {
    failures++
    console.log('  FAIL  %s\n          got  %s\n          want %s', what, JSON.stringify(got), JSON.stringify(want))
  } else {
    console.log('  ok    %s', what)
  }
}

console.log('\nOPEN ROUTES - the only one that answers before a pairing exists')
check('health is open', isOpenRoute('/health', {}), true)
/* 🔴 THE BYPASS THAT EXISTED FOR TEN MINUTES ON 09/10/2026. `pair` was on the open list, and the
   pairing request returns long before this check — so the only way to arrive here carrying it is
   to have stapled it onto something else. `GET /?pair=1&list=C:\` then skipped the lock and ran
   the directory listing. A one-parameter bypass of the entire feature. */
check('pair alone is NOT open', isOpenRoute('/', { pair: '1' }), false)
check('pair stapled onto list is NOT open', isOpenRoute('/', { pair: '1', list: 'C:\\' }), false)
check('pair stapled onto save is NOT open', isOpenRoute('/', { pair: '1', save: 'C:\\x.pdf' }), false)
check('pair stapled onto a path read is NOT open', isOpenRoute('/', { pair: '1', path: 'C:\\x.pdf' }), false)
/* And health does not become a doorway the same way. It returns early today, so a parameter on it
   reaches nothing — but "today" is the reasoning that produced the bypass above, so the exemption
   is withdrawn whenever it carries anything actionable, whatever order the routes end up in. */
check('health with a save stapled on', isOpenRoute('/health', { save: 'C:\\x.pdf' }), false)
check('health with a list stapled on', isOpenRoute('/health', { list: 'C:\\' }), false)
check('health with a pair stapled on', isOpenRoute('/health', { pair: '1' }), false)
check('plain health is still open', isOpenRoute('/health', {}), true)
/* A harmless cache-buster must not lock the one route PressCal needs before pairing. */
check('health with a cache buster', isOpenRoute('/health', { _t: '12345' }), true)
check('save is NOT open', isOpenRoute('/', { save: 'C:\\x.pdf' }), false)
check('list is NOT open', isOpenRoute('/', { list: 'C:\\' }), false)
check('path read is NOT open', isOpenRoute('/', { path: 'C:\\x.pdf' }), false)
check('refresh is NOT open', isOpenRoute('/', { refresh: 'C:\\' }), false)
check('pickFolder is NOT open', isOpenRoute('/', { pickFolder: '1' }), false)
check('exportImposition is NOT open', isOpenRoute('/', { exportImposition: '1' }), false)
check('createFolder is NOT open', isOpenRoute('/', { createFolder: '1' }), false)
check('roots is NOT open', isOpenRoute('/roots', {}), false)

console.log('\nBEFORE ANY PAIRING - open, exactly as every build before 09/10/2026')
check('no key stored, none given', localAuth(null, undefined), { allow: true })
check('no key stored, one given anyway', localAuth(null, KEY), { allow: true })

console.log('\nAFTER PAIRING - the lock')
check('right key', localAuth(KEY, KEY), { allow: true })
check('no key at all', localAuth(KEY, undefined), { allow: false, status: 401, reason: 'not paired with this PressKit' })
check('empty key', localAuth(KEY, ''), { allow: false, status: 401, reason: 'not paired with this PressKit' })
check('somebody else key', localAuth(KEY, OTHER), { allow: false, status: 401, reason: 'not paired with this PressKit' })
check('a key off by one character', localAuth(KEY, KEY.slice(0, -1) + 'b'), { allow: false, status: 401, reason: 'not paired with this PressKit' })
/* 🔴 A PREFIX MUST NOT PASS. `startsWith` instead of `===` is the plausible mistake here, and it
   would let a one-character key open the door. */
check('a prefix of the key', localAuth(KEY, KEY.slice(0, 8)), { allow: false, status: 401, reason: 'not paired with this PressKit' })
check('the key with the key appended', localAuth(KEY, KEY + KEY), { allow: false, status: 401, reason: 'not paired with this PressKit' })
/* Types a header can actually arrive as when a client sends it twice. */
check('an array of headers', localAuth(KEY, [KEY]), { allow: false, status: 401, reason: 'not paired with this PressKit' })
check('a number', localAuth(KEY, 12345678), { allow: false, status: 401, reason: 'not paired with this PressKit' })

console.log('\nPAIRING - trust on first use, re-keyed only by whoever holds it')
check('first pairing', localPairAuth(null, KEY, undefined), { allow: true })
check('offering the same key again', localPairAuth(KEY, KEY, KEY), { allow: true })
check('a stranger offering a new key', localPairAuth(KEY, OTHER, undefined), { allow: false, status: 409, reason: 'already paired' })
check('a stranger with the wrong current key', localPairAuth(KEY, OTHER, 'nope'), { allow: false, status: 409, reason: 'already paired' })
check('the holder rotating the key', localPairAuth(KEY, OTHER, KEY), { allow: true })
check('a short key is refused', localPairAuth(null, 'x'.repeat(LOCAL_KEY_MIN_LENGTH - 1), undefined), { allow: false, status: 400, reason: 'key too short' })
check('exactly the minimum length is accepted', localPairAuth(null, 'x'.repeat(LOCAL_KEY_MIN_LENGTH), undefined), { allow: true })
check('a key of spaces is refused', localPairAuth(null, ' '.repeat(60), undefined), { allow: false, status: 400, reason: 'key too short' })
check('a non-string key is refused', localPairAuth(null, 12345, undefined), { allow: false, status: 400, reason: 'key too short' })
/* ⚠️ The dangerous one: an empty stored key must never be treated as "paired with nothing passes".
   `localKey()` in index.ts already answers null for a short or blank stored value, so this is the
   belt — a blank reaching here must still be refused as a pairing attempt, not accepted. */
check('a blank offered over an existing key', localPairAuth(KEY, '', KEY), { allow: false, status: 400, reason: 'key too short' })

console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
