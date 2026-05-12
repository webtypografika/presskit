# PressKit ↔ PressCal — license / sign-in checklist (multi-instance)

**Context:** A real PressCal Pro subscriber (`info@typografika.gr`, subscription on `pro.presscal.com`) installed PressKit, signed in with Google, and PressKit showed the *"Δοκιμαστική έκδοση — απομένουν X ημέρες"* trial banner instead of unlocking as Pro.

Root cause was on the **PressKit** side: the "Σύνδεση με Google" button defaulted to `https://demo.gr.presscal.com/auth/presskit-link`, so the user landed on the **demo** instance, got a demo-org `psk_live_*` key, and `/api/filehelper/license` on demo correctly reported that demo org as a 15-day trial. PressKit captured `url=https://demo.gr.presscal.com` in the profile and kept asking the demo server.

**Resolved on the PressKit side (v2.2.2):**
- `DEFAULT_PRESSCAL_BASE` → `https://gr.presscal.com` (the customer-facing production instance), was `demo.gr.presscal.com`.
- Added a small **instance picker** on the lock screen (Production `gr.presscal.com` / Demo `demo.gr.presscal.com` / Custom URL), pre-selected to Production. So the "which instance" decision is now explicit, not guessed.

**Why this checklist matters:** PressKit v2.2.2 defaults to `https://gr.presscal.com` — but as of writing **that hostname does not resolve** (`DNS_PROBE_FINISHED_NXDOMAIN`; only `demo.gr.presscal.com` has a record). So the very first thing is to *create* `gr.presscal.com` (section A0). After that, verify the filehelper routes are reachable there, that `NEXT_PUBLIC_BASE_URL` is right (so the deep link carries the correct `url`), and that the license logic ranks a paid plan above the trial branch.

> Route implementation reference: `google-login-spec.md` (same folder).

**Instances in play:**
- `https://gr.presscal.com` — **production, customer-facing**. PressKit defaults here (v2.2.2+). **Not deployed yet** — needs DNS + a PressCal deployment + auth wiring (section A0), then sections A and B.
- `https://pro.presscal.com` — where the spec author's own Pro subscription lives (used for testing the Pro path; and the interim instance PressKit users connect to via the lock-screen "Custom" option until `gr.presscal.com` is live). Must serve the routes correctly.
- `https://demo.gr.presscal.com` — sandbox; orgs there are always 15-day trials. Correct as-is, no changes.

---

## A0. Stand up `gr.presscal.com` (it doesn't exist yet)

`gr.presscal.com` currently returns NXDOMAIN — there's no DNS record for the bare hostname (only `demo.gr.presscal.com` resolves). Until this is done, PressKit's default sign-in target is a dead URL (the "Σύνδεση με Google" button / "Προσθήκη profile" lands on *"This site can't be reached"*).

1. **DNS** — add an A / CNAME record for `gr.presscal.com` pointing at wherever the PressCal Next.js app is hosted (Vercel project domain, etc.). Same for `www.` if you use it. Add it to the Vercel project's Domains list so it's served by the same app.

2. **Routes on that deployment** — the PressCal app on `gr.presscal.com` must serve everything PressKit talks to:
   - `GET /auth/presskit-link` (the Google sign-in landing — see `google-login-spec.md`)
   - `GET /api/filehelper/license` and the rest of `/api/filehelper/*` (attachments, files, customers, generate-key, …)
   - `GET /downloads/presskit` (+ `/downloads/presskit/[version]`) — the branded-download route handler from `download-buttons-spec.md`
   - `GET /api/presskit-version`
   (If `gr.presscal.com` is just another domain on the existing deployment, you get all of these for free — just confirm none are gated/host-restricted.)

3. **Env vars on that deployment:**
   - `NEXT_PUBLIC_BASE_URL=https://gr.presscal.com` — so `/auth/presskit-link` builds the deep link with `url=https://gr.presscal.com` (see B.4). Better: derive from the request host so it can't drift.
   - `NEXTAUTH_URL=https://gr.presscal.com` — otherwise the NextAuth/Google OAuth callback breaks on this host.

4. **Google OAuth** — in Google Cloud Console → the OAuth client → Authorized redirect URIs, add `https://gr.presscal.com/api/auth/callback/google` (match whatever path NextAuth actually uses). Without it, sign-in on `gr.presscal.com` errors with `redirect_uri_mismatch`.

5. **Database** — make sure the `Org.presskitTrialStart` migration (see A.3) is applied to whatever DB this instance uses.

6. **Smoke test** — `curl -I https://gr.presscal.com` → 200; open `https://gr.presscal.com/auth/presskit-link` logged in → renders the landing page (not 404, not an OAuth error).

> Interim, before this is live: PressKit users (incl. the spec author) connect via the lock-screen **"Άλλο instance…"** option → `https://pro.presscal.com` — which means `pro.presscal.com` must satisfy sections A and B in the meantime.

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

8. **Canonical production URL = `https://gr.presscal.com`.** PressKit v2.2.2 already defaults the "Σύνδεση με Google" target and the Settings placeholder to it, and adds a lock-screen picker (Production / Demo / Custom). Nothing more to change on the PressKit side. The owner will stand up `gr.presscal.com` (section A0); then it just needs to satisfy sections A and B.

---

## Quick end-to-end test once A + B hold

For each instance you want to support (`gr.presscal.com`, then `pro.presscal.com`):

1. In PressKit: on the lock screen pick that instance from the dropdown (or Settings → PressCal → set the URL) → "Σύνδεση με Google".
2. Browser opens `https://<instance>/auth/presskit-link` → log in → landing page → `presscal-fh://connect?url=https://<instance>&apiKey=psk_live_...`.
3. PressKit stores it, calls `GET https://<instance>/api/filehelper/license`.
4. Expect: gate unlocks; `orgName` shown. For a paid org → **no** trial banner. For a fresh demo org → trial banner with the remaining days (that's correct on demo).

## Note on the demo side (no action, just FYI)

The demo org really is a 15-day trial — correct behaviour for `demo.gr.presscal.com`. Nothing to change there. The fix was making the production path reachable + correct and stopping PressKit from sending people to demo by default.
