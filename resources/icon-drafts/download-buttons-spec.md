# PressKit Download — Branded URL & Button Placements

**Goal**: Users download PressKit from `presscal.com` (or its subdomains) without ever seeing `github.com`. Branded experience, single source of truth.

> ⚠️ **Changed in PressKit v2.2.1** — the installer asset is now **versioned**: `PressKit-Setup-<version>.exe` (e.g. `PressKit-Setup-2.2.1.exe`), not the old fixed `PressKit-Setup.exe`. That means the GitHub URL `…/releases/latest/download/PressKit-Setup.exe` **no longer resolves** (you can't reference a versioned filename through the `/latest/` path without knowing the version). So a static `vercel.json` redirect won't work anymore — Step 1 below is now a small route handler that looks up the latest release's asset at request time. (Auto-update is unaffected — Electron reads `latest.yml`.)

## Step 1 — Branded redirect via a route handler (resolves the versioned asset)

`vercel.json` static redirects can't express "find whatever `.exe` is attached to the latest release", so use a Next.js route handler instead. One handler covers both "latest" and "pin to a version".

> ✅ **This is a one-time implementation — zero per-release maintenance.** Once the handler is deployed it resolves the latest release's installer at request time via the GitHub API, regardless of the asset's filename (`PressKit-Setup-2.2.2.exe`, `-2.2.3`, …). You never touch `vercel.json`, you never re-point a URL, you never re-upload anything. New PressKit releases are picked up automatically (within the ~10-min cache window in `resolve()`). Implement it once and forget it.
>
> _(Background: PressKit currently also publishes a stable-named `PressKit-Setup.exe` copy alongside the versioned one purely so the old hardcoded URL keeps working until this handler exists. After the handler ships, that copy is no longer needed and can be dropped from future releases.)_

```ts
// app/downloads/presskit/route.ts          → /downloads/presskit  (latest)
// app/downloads/presskit/[version]/route.ts → /downloads/presskit/v2.2.1 (pinned)
import { NextResponse } from 'next/server'

const REPO = 'webtypografika/presskit'

// Find the Windows installer asset on a release payload. Matches the current
// `PressKit-Setup-<version>.exe` naming and the legacy `PressKit-Setup.exe`.
function findInstaller(release: any): string | null {
  const asset = (release?.assets ?? []).find((a: any) =>
    /^PressKit-Setup.*\.exe$/i.test(a.name) && !/\.blockmap$/i.test(a.name)
  )
  return asset?.browser_download_url ?? null
}

async function resolve(version?: string): Promise<string | null> {
  const api = version
    ? `https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(version)}`
    : `https://api.github.com/repos/${REPO}/releases/latest`
  const res = await fetch(api, {
    headers: { Accept: 'application/vnd.github+json' },
    next: { revalidate: 600 }, // 10 min cache — don't hammer the GitHub API
  })
  if (!res.ok) return null
  return findInstaller(await res.json())
}

// /downloads/presskit
export async function GET() {
  const url = await resolve()
  if (!url) return new NextResponse('PressKit download unavailable', { status: 502 })
  return NextResponse.redirect(url, 302)
}
```

```ts
// app/downloads/presskit/[version]/route.ts
import { NextResponse } from 'next/server'
// (reuse resolve()/findInstaller() — extract to a shared lib if you prefer)

export async function GET(_req: Request, { params }: { params: { version: string } }) {
  // accept both "v2.2.1" and "2.2.1"
  const tag = params.version.startsWith('v') ? params.version : `v${params.version}`
  const url = await resolve(tag)
  if (!url) return new NextResponse(`PressKit ${params.version} not found`, { status: 404 })
  return NextResponse.redirect(url, 302)
}
```

After deploy:
- `https://presscal.com/downloads/presskit` → 302 → latest `PressKit-Setup-<latest>.exe`
- `https://demo.gr.presscal.com/downloads/presskit` → same handler, also latest
- `https://presscal.com/downloads/presskit/v2.2.1` (or `/2.2.1`) → 302 → that release's installer

User sees the GitHub URL only briefly during the 302 hop. The browser download dialog shows the real filename, e.g. `PressKit-Setup-2.2.1.exe` (now version-stamped — nice for support: you can tell which build someone has).

> If you'd rather avoid a route handler, the only `vercel.json`-only alternative is to **hardcode the current version** in the redirect destination and bump it on every PressKit release:
> ```json
> { "redirects": [ { "source": "/downloads/presskit",
>   "destination": "https://github.com/webtypografika/presskit/releases/download/v2.2.1/PressKit-Setup-2.2.1.exe",
>   "permanent": false } ] }
> ```
> Not recommended — it drifts the moment a new release ships.

## Step 2 — Place download buttons across the site

### A. Marketing site `presscal.com` — hero section

```tsx
<a href="/downloads/presskit" className="btn-primary-large">
  <DownloadIcon /> Κατέβασε το PressKit
  {/* version comes from /api/presskit-version (Step 3) — don't hardcode */}
  <span className="version-tag">Windows · {version ?? '…'}</span>
</a>
```

### B. App instances (`gr.presscal.com` — the production instance PressKit defaults to since v2.2.2 — plus `demo.gr.presscal.com` and any other) — top nav or sidebar

Always-visible "Download PressKit" link in the nav, on every PressCal instance:

```tsx
<a href="/downloads/presskit" className="nav-link nav-link-icon">
  <DownloadIcon /> PressKit
</a>
```

### C. Settings → PressKit page — primary section

Two buttons stacked:

```tsx
<a href="/auth/presskit-link" className="btn-primary">
  Open PressKit  →
</a>
<a href="/downloads/presskit" className="btn-secondary">
  <DownloadIcon /> Δεν το έχω εγκαταστήσει
</a>

<details className="manual-fallback">
  <summary>Manual setup (advanced)</summary>
  <button onClick={generateKey}>Generate API Key</button>
</details>
```

Logic: if the user clicks "Open PressKit" and PressKit isn't installed, the protocol handler fails silently — they fall back to the download button below.

### D. Onboarding / first-login banner

After a brand-new user creates an Org, show a one-time banner:

```tsx
<Banner type="info" dismissable>
  <strong>Έτοιμος για το PressKit;</strong>
  <p>Διαχείριση αρχείων + preflight + sync με PressCal.</p>
  <a href="/downloads/presskit" className="btn-primary">Κατέβασέ το</a>
  <a href="/auth/presskit-link" className="btn-secondary">Έχω ήδη εγκαταστήσει</a>
</Banner>
```

### E. Footer of all pages

Tiny link in the footer alongside Privacy / Terms:

```tsx
<a href="/downloads/presskit">Download PressKit</a>
```

### F. Inside quote/file actions where PressKit is needed

Anywhere there's a deep-link button (e.g. "Open file in PressKit", "Send to PressKit"), add a tooltip / fallback:

```tsx
<button onClick={openInPressKit}>Open in PressKit</button>
<a href="/downloads/presskit" className="text-link-tiny">
  Δεν λειτουργεί; Κατέβασε το PressKit
</a>
```

## Step 3 — Dynamic version label (now also recommended, not optional)

Since the download button can't carry a hardcoded version anymore (the filename is version-stamped), surface the version from this endpoint. Reuse the same GitHub fetch as Step 1 (extract `resolve()` to a shared lib if you like):

```ts
// app/api/presskit-version/route.ts
import { NextResponse } from 'next/server'

export const revalidate = 3600 // 1h cache

export async function GET() {
  const res = await fetch('https://api.github.com/repos/webtypografika/presskit/releases/latest', {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) return NextResponse.json({ version: null })
  const data = await res.json()
  const installer = (data.assets ?? []).find((a: any) =>
    /^PressKit-Setup.*\.exe$/i.test(a.name) && !/\.blockmap$/i.test(a.name)
  )
  return NextResponse.json({
    version: data.tag_name,                    // "v2.2.1"
    name: data.name,                           // release title
    publishedAt: data.published_at,
    downloadUrl: installer?.browser_download_url ?? null,
    filename: installer?.name ?? null,         // "PressKit-Setup-2.2.1.exe"
  })
}
```

Then in the download button:

```tsx
const { data } = useSWR('/api/presskit-version', fetcher)
<span className="version-tag">{data?.version ?? '...'}</span>
```

## Step 4 — In-app side (PressKit will handle later)

Future PressKit additions (separate work, not blocking this):

- **Help → Check for updates** menu item that hits `/api/presskit-version` and prompts user if newer
- **About dialog** with "Latest version" indicator
- **Trial-expired modal** already has Buy button — can also have "Install latest version" link if user is on outdated build
- **Shareable link** in About: copy `https://presscal.com/downloads/presskit` to send to colleagues

## Why a branded redirect, not hosted file

- **Vercel limit**: 100MB max per asset on Hobby tier; PressKit installer is ~118MB
- **Single source of truth**: GitHub Releases auto-tags every build. No risk of drift between PressCal and the actual binary.
- **Free bandwidth**: GitHub serves all download traffic for free; Vercel only handles the 302 (negligible).
- **Brand-clean URL**: user shares `presscal.com/downloads/presskit`, not a long GitHub URL.

## Testing checklist

- [ ] `curl -I https://demo.gr.presscal.com/downloads/presskit` returns `302` with `Location` pointing at `…/releases/download/v<latest>/PressKit-Setup-<latest>.exe`
- [ ] Clicking the link in any browser triggers a download (filename `PressKit-Setup-<version>.exe`, ~118MB)
- [ ] `curl -I https://presscal.com/downloads/presskit/v2.2.1` → `302` to that release's `.exe`; a bogus version → `404`
- [ ] `GET /api/presskit-version` returns `{ version, downloadUrl, filename }` with the current release
- [ ] Navigation download button visible on every demo page
- [ ] Settings → PressKit shows both "Open" and "Download" CTAs
- [ ] Onboarding banner appears for fresh accounts
