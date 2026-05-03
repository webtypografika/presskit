# PressKit "Sign in with Google" — PressCal Spec

Goal: Replace the manual "generate key + paste in PressKit" flow with a single Google sign-in that handles everything.

## User flow (target)

1. User opens PressKit → sees lock screen with **«Σύνδεση με Google»** button
2. Click → opens browser at `https://demo.gr.presscal.com/auth/presskit-link`
3. PressCal:
   - If logged in → continue
   - If not → NextAuth Google sign-in flow → returns here
4. PressCal ensures: user has org, org has `apiFilehelper` key, `presskitTrialStart` is set
5. PressCal returns landing HTML that auto-triggers `presscal-fh://connect?url=...&apiKey=...`
6. PressKit opens, configures itself, lock unlocks

## What to implement

**New route**: `app/auth/presskit-link/route.ts` (App Router)

```ts
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { redirect } from 'next/navigation'
import { randomBytes } from 'crypto'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    redirect('/auth/signin?callbackUrl=' + encodeURIComponent('/auth/presskit-link'))
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: { org: true }
  })

  if (!user?.org) {
    return new Response('No organization found for this account.', { status: 403 })
  }

  let org = user.org

  // Ensure key + trial start
  const updates: any = {}
  if (!org.apiFilehelper) {
    updates.apiFilehelper = `psk_live_${randomBytes(32).toString('hex')}`
  }
  if (!org.presskitTrialStart) {
    updates.presskitTrialStart = new Date()
  }
  if (Object.keys(updates).length) {
    org = await prisma.org.update({ where: { id: org.id }, data: updates })
  }

  // Build deep-link params
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://demo.gr.presscal.com'
  const params = new URLSearchParams({
    url: baseUrl,
    apiKey: org.apiFilehelper!
  })
  const deepLink = `presscal-fh://connect?${params.toString()}`

  // Return landing page — meta-refresh triggers the protocol, manual button is fallback
  return new Response(
    `<!doctype html>
<html lang="el"><head>
<meta charset="utf-8"><title>Σύνδεση με PressKit</title>
<meta http-equiv="refresh" content="0;url=${deepLink}">
<style>
  body { font-family: system-ui, sans-serif; padding: 60px 40px; text-align: center; color: #0e1518; background: #f5f9f9; }
  h1 { font-size: 24px; margin-bottom: 8px; }
  p { color: #3f5856; margin-bottom: 32px; }
  .btn { display: inline-block; padding: 14px 28px; background: #00707c; color: #fff; border-radius: 10px; text-decoration: none; font-weight: 600; }
  .install { margin-top: 48px; padding-top: 32px; border-top: 1px solid #d8e6e6; font-size: 13px; color: #6b817f; }
  .install a { color: #00707c; }
</style>
</head><body>
<h1>Σύνδεση με PressKit ✓</h1>
<p>Το PressKit ανοίγει αυτόματα...</p>
<a class="btn" href="${deepLink}">Άνοιγμα PressKit</a>
<div class="install">
  Δεν έχεις PressKit; 
  <a href="https://github.com/webtypografika/presskit/releases/latest/download/PressKit-Setup.exe">
    Κατέβασέ το
  </a>
</div>
</body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}
```

## Why landing HTML and not direct redirect?

Most browsers block 30x redirects to custom protocols (`presscal-fh://`). The reliable pattern is:

- Server returns HTML
- HTML uses `meta http-equiv="refresh"` to trigger the protocol
- Manual button as fallback if browser blocks the auto-trigger

## What to keep

- The existing `POST /api/filehelper/generate-key` and `DELETE` endpoints stay as-is — useful for advanced users / integration testing
- The "copy this key" button on the existing PressKit settings page can stay as a fallback ("Manual setup")
- The existing `presscal-fh://connect` handler in PressKit doesn't change — it already does what we need

## On the PressKit Settings page in PressCal

Replace the current primary button with two stacked actions:

```tsx
<a href="/auth/presskit-link" className="btn-primary">
  Open PressKit  →
</a>

<details className="manual-fallback">
  <summary>Manual setup (advanced)</summary>
  <button onClick={generateKey}>Generate API Key</button>
  {/* show key + copy button after generation */}
</details>
```

## Edge cases

- **No PressKit installed**: meta-refresh fails silently → user sees the manual button + download link. They install, come back, click again.
- **Multiple PressKits / different machines**: each machine clicks its own link → each gets the same key (per-org). Fine for current model.
- **User signed in to multiple Google accounts**: NextAuth picks the active session. If they need to switch, they sign out first.
- **First-time user (no org)**: returns 403. PressCal should onboard them to org creation first — outside this spec.

## Testing checklist

- [ ] Logged-out user → redirects to Google sign-in → returns and triggers deep link
- [ ] Logged-in user with existing key → reuses key, doesn't regenerate
- [ ] Logged-in user with no key → generates fresh `psk_live_*`, sets `presskitTrialStart`
- [ ] Logged-in user with no org → returns 403 with helpful message
- [ ] Browser blocks meta-refresh → manual button works
- [ ] PressKit not installed → user sees download link

## What I'll do on PressKit side after this lands

- Replace the LicenseGate "Άνοιγμα ρυθμίσεων" primary button with **«Σύνδεση με Google»** that opens `${PRESSCAL_URL}/auth/presskit-link` via `shell.openExternal`
- Keep "Manual setup" as a secondary text link
- Bump to v1.1.3 + new release
