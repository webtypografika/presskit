# PressKit ↔ PressCal — `pro.presscal.com` license / sign-in checklist

**Context:** A real PressCal Pro subscriber (`info@typografika.gr`, subscription on `pro.presscal.com`) installed PressKit, signed in with Google, and PressKit shows the *"Δοκιμαστική έκδοση — απομένουν X ημέρες"* trial banner instead of unlocking as Pro.

Root cause on the PressKit side (already being fixed there): the **"Σύνδεση με Google"** button defaults to `https://demo.gr.presscal.com/auth/presskit-link`, so the user landed on the **demo** instance, got a demo-org `psk_live_*` key, and `/api/filehelper/license` on demo correctly reports that demo org as a 15-day trial. PressKit captured `url=https://demo.gr.presscal.com` in the profile, so it keeps asking the demo server.

So the PressKit fix is "default to / let the user pick the production instance." But before that lands, PressCal needs to make sure the production instance (`pro.presscal.com`) actually serves the PressKit endpoints and that the license logic does the right thing for a paying org. That's this checklist.

> Reference for the route implementation: `google-login-spec.md` (same folder). This doc is the *verification* layer on top of it, specific to the production instance.

---

## A. Must be deployed & reachable on `pro.presscal.com`

1. **`GET /api/filehelper/license`** — live on `pro.presscal.com`, not just demo/staging.
   - Auth: `Authorization: Bearer psk_live_<32hex>` (NOT `x-api-key`).
   - Response shape PressKit expects: `{ active: boolean, plan: 'trial'|'pro'|'expired', expiresAt: string|null, daysLeft: number, isTrial: boolean, orgName: string }`.
   - Check: `curl -i https://pro.presscal.com/api/filehelper/license -H "Authorization: Bearer <a real psk_live key issued by pro>"` → 200 + that JSON, **not** 404 / HTML.
   - This is the endpoint from PressCal commit `10b3408` (+ fix `3dd79f7`). Confirm that build is actually deployed on `pro.presscal.com`.

2. **`GET /auth/presskit-link`** (App Router route, see `google-login-spec.md`) — live on `pro.presscal.com`.
   - Check: open `https://pro.presscal.com/auth/presskit-link` in a browser while logged in → should render the "Σύνδεση με PressKit ✓" landing page and meta-refresh to `presscal-fh://connect?url=...&apiKey=...`. Must **not** 404.

3. **Prisma schema migration applied on the `pro.presscal.com` database** — the field `Org.presskitTrialStart: DateTime?` must exist there (`npx prisma db push` / migration deployed against the prod DB). If it's missing, the license logic throws or falls through to a fallback branch.

---

## B. Logic / data to verify

4. **The deep link must carry the instance the user authenticated on.**
   In `app/auth/presskit-link/route.ts` the deep-link `url` param is built from `process.env.NEXT_PUBLIC_BASE_URL || 'https://demo.gr.presscal.com'` (see `google-login-spec.md` line ~57). On `pro.presscal.com` the env var **`NEXT_PUBLIC_BASE_URL` must be set to `https://pro.presscal.com`** — otherwise the route running on pro still hands PressKit `url=https://demo.gr.presscal.com`, and PressKit will forever query the demo server with a pro-issued key (→ 401 or wrong org). Verify the env var on the pro deployment, and consider deriving the base from the incoming request host instead of an env var so this can't drift.

5. **The org `info@typografika.gr` on `pro.presscal.com` is recognised as a paying org.**
   Inspect that Org record on the pro DB:
   - Does it have an active subscription field set (`plan` / `planExpiry` / Viva Wallet status — whatever the canonical "this org is paid" signal is)?
   - Does it have `apiFilehelper` (the `psk_live_*` key) set?
   - Is `presskitTrialStart` set on it? (It may be, from an earlier sign-in — that's fine *if* the paid check wins, see #6.)
   `/api/filehelper/license` for that org's key must return `{ active: true, plan: 'pro', isTrial: false, daysLeft: <subscription days>, expiresAt: <subscription end> }`.

6. **Priority order inside `/api/filehelper/license`.** Per the design there are ~4 cases: (a) active paid plan → `pro`; (b) `presskitTrialStart` within 15 days → `trial`; (c) demo trial with `planExpiry`; (d) grace fallback. **Case (a) must be evaluated first** — if an org has *both* `presskitTrialStart` set *and* an active paid plan, the response must be `plan: 'pro', isTrial: false`. Right now the symptom suggests the trial branch is shadowing the paid branch (or the paid branch isn't reading the right subscription field). Confirm the ordering and the field it reads.

7. **`addProfile=1` propagation.** When PressKit opens `${base}/auth/presskit-link?addProfile=1`, the returned deep link must include it: `presscal-fh://connect?url=...&apiKey=...&addProfile=1`. (Was marked "needs verification" in `google-login-spec.md` — please confirm it's forwarded.) Optionally also forward `email=<session email>` and `orgName=<org name>` as query params — PressKit uses them to label the profile.

---

## C. One decision PressCal needs to make (blocks the PressKit fix)

8. **What is the canonical *production* PressCal URL that PressKit should default to?**
   `https://pro.presscal.com`? `https://app.presscal.com`? `https://presscal.com`? PressKit currently defaults the "Σύνδεση με Google" target and the manual-setup URL to `https://demo.gr.presscal.com`, which is wrong for real customers. Once you confirm the production URL, PressKit will:
   - change `DEFAULT_PRESSCAL_BASE` to it, and/or
   - add a small instance selector on the lock screen (Production / Demo / custom) so nobody lands on demo by accident.

---

## Quick end-to-end test once A + B are done

1. In PressKit: Settings → PressCal → set URL = `https://pro.presscal.com` → "Σύνδεση με Google".
2. Browser opens `https://pro.presscal.com/auth/presskit-link` → log in as the paying account → landing page → `presscal-fh://connect?url=https://pro.presscal.com&apiKey=psk_live_...`.
3. PressKit stores it, calls `GET https://pro.presscal.com/api/filehelper/license`.
4. Expect: gate unlocks, **no** trial banner, `orgName` shown in About/footer.

## Note on the demo side (no action, just FYI)

The demo org for this user really is a 15-day trial — that's correct behaviour for demo. Nothing to change there. The fix is making the production path reachable + correct, and stopping PressKit from sending people to demo by default.
