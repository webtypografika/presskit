# PressKit ↔ PressCal — license / sign-in checklist (multi-instance)

**Context:** A real PressCal Pro subscriber (`info@typografika.gr`, subscription on `pro.presscal.com`) installed PressKit, signed in with Google, and PressKit showed the *"Δοκιμαστική έκδοση — απομένουν X ημέρες"* trial banner instead of unlocking as Pro.

Root cause was on the **PressKit** side: the "Σύνδεση με Google" button defaulted to `https://demo.gr.presscal.com/auth/presskit-link`, so the user landed on the **demo** instance, got a demo-org `psk_live_*` key, and `/api/filehelper/license` on demo correctly reported that demo org as a 15-day trial. PressKit captured `url=https://demo.gr.presscal.com` in the profile and kept asking the demo server.

**Resolved on the PressKit side (v2.2.2):**
- `DEFAULT_PRESSCAL_BASE` → `https://gr.presscal.com` (the customer-facing production instance), was `demo.gr.presscal.com`.
- Added a small **instance picker** on the lock screen (Production `gr.presscal.com` / Demo `demo.gr.presscal.com` / Custom URL), pre-selected to Production. So the "which instance" decision is now explicit, not guessed.

**Why this checklist still matters:** PressCal-next reportedly serves the filehelper routes on any instance, so nothing is blocked — but we should *verify* that the two routes are actually reachable, that the `NEXT_PUBLIC_BASE_URL` env var is right on each instance (so the deep link carries the correct `url`), and that the license logic ranks a paid plan above the trial branch. Verification only; no big build.

> Route implementation reference: `google-login-spec.md` (same folder).

**Instances in play:**
- `https://gr.presscal.com` — **production, customer-facing**. PressKit defaults here. Must serve the routes correctly.
- `https://pro.presscal.com` — where the spec author's own Pro subscription lives (used for testing the Pro path). Must also serve the routes correctly.
- `https://demo.gr.presscal.com` — sandbox; orgs there are always 15-day trials. Correct as-is, no changes.

---

## A. Must be deployed & reachable — on **`gr.presscal.com`** and **`pro.presscal.com`**

1. **`GET /api/filehelper/license`** — live on both instances.
   - Auth: `Authorization: Bearer psk_live_<32hex>` (NOT `x-api-key`).
   - Response shape PressKit expects: `{ active: boolean, plan: 'trial'|'pro'|'expired', expiresAt: string|null, daysLeft: number, isTrial: boolean, orgName: string }`.
   - Check (per instance): `curl -i https://<instance>/api/filehelper/license -H "Authorization: Bearer <a real psk_live key issued by that instance>"` → 200 + that JSON, **not** 404 / HTML.
   - This is the endpoint from PressCal commit `10b3408` (+ fix `3dd79f7`). Confirm that build is deployed on both instances.

2. **`GET /auth/presskit-link`** (App Router route, see `google-login-spec.md`) — live on both instances.
   - Check (per instance): open `https://<instance>/auth/presskit-link` in a browser while logged in → renders the "Σύνδεση με PressKit ✓" landing page and meta-refreshes to `presscal-fh://connect?url=...&apiKey=...`. Must **not** 404.

3. **Prisma schema migration applied on each instance's database** — the field `Org.presskitTrialStart: DateTime?` must exist (`npx prisma db push` / migration deployed). If it's missing, the license logic throws or falls through to a fallback branch.

---

## B. Logic / data to verify

4. **The deep link must carry the instance the user authenticated on.**
   In `app/auth/presskit-link/route.ts` the deep-link `url` param is built from `process.env.NEXT_PUBLIC_BASE_URL || 'https://demo.gr.presscal.com'` (see `google-login-spec.md` ~line 57). Each deployment must set `NEXT_PUBLIC_BASE_URL` to its own origin:
   - on `gr.presscal.com` → `NEXT_PUBLIC_BASE_URL=https://gr.presscal.com`
   - on `pro.presscal.com` → `NEXT_PUBLIC_BASE_URL=https://pro.presscal.com`
   Otherwise the route hands PressKit `url=https://demo.gr.presscal.com` and PressKit will forever query the demo server with a key issued by a different instance (→ 401 / wrong org). **Better still:** derive the base from the incoming request host instead of an env var, so it can't drift across instances.

5. **The org `info@typografika.gr` on `pro.presscal.com` is recognised as a paying org.**
   Inspect that Org record on the pro DB:
   - Does it have an active subscription signal set (`plan` / `planExpiry` / Viva Wallet status — whatever the canonical "this org is paid" field is)?
   - Does it have `apiFilehelper` (the `psk_live_*` key) set?
   - Is `presskitTrialStart` set on it? (May be, from an earlier sign-in — fine *if* the paid check wins, see #6.)
   `/api/filehelper/license` for that org's key must return `{ active: true, plan: 'pro', isTrial: false, daysLeft: <subscription days>, expiresAt: <subscription end> }`.

6. **Priority order inside `/api/filehelper/license`.** Per the design there are ~4 cases: (a) active paid plan → `pro`; (b) `presskitTrialStart` within 15 days → `trial`; (c) demo trial with `planExpiry`; (d) grace fallback. **Case (a) must be evaluated first** — if an org has *both* `presskitTrialStart` set *and* an active paid plan, the response must be `plan: 'pro', isTrial: false`. The symptom we saw suggests the trial branch is shadowing the paid branch (or the paid branch isn't reading the right subscription field). Confirm the ordering and the field it reads.

7. **`addProfile=1` propagation.** When PressKit opens `${base}/auth/presskit-link?addProfile=1`, the returned deep link must include it: `presscal-fh://connect?url=...&apiKey=...&addProfile=1`. (Was "needs verification" in `google-login-spec.md` — please confirm it's forwarded.) Optionally also forward `email=<session email>` and `orgName=<org name>` — PressKit uses them to label the profile.

---

## C. Decision — RESOLVED

8. **Canonical production URL = `https://gr.presscal.com`.** PressKit v2.2.2 defaults the "Σύνδεση με Google" target and the Settings placeholder to it, and adds a lock-screen picker (Production / Demo / Custom). No further input needed from PressCal here — just make sure `gr.presscal.com` satisfies sections A and B above.

---

## Quick end-to-end test once A + B hold

For each instance you want to support (`gr.presscal.com`, then `pro.presscal.com`):

1. In PressKit: on the lock screen pick that instance from the dropdown (or Settings → PressCal → set the URL) → "Σύνδεση με Google".
2. Browser opens `https://<instance>/auth/presskit-link` → log in → landing page → `presscal-fh://connect?url=https://<instance>&apiKey=psk_live_...`.
3. PressKit stores it, calls `GET https://<instance>/api/filehelper/license`.
4. Expect: gate unlocks; `orgName` shown. For a paid org → **no** trial banner. For a fresh demo org → trial banner with the remaining days (that's correct on demo).

## Note on the demo side (no action, just FYI)

The demo org really is a 15-day trial — correct behaviour for `demo.gr.presscal.com`. Nothing to change there. The fix was making the production path reachable + correct and stopping PressKit from sending people to demo by default.
