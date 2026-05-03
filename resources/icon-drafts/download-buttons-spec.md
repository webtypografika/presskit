# PressKit Download — Branded URL & Button Placements

**Goal**: Users download PressKit from `presscal.com` (or its subdomains) without ever seeing `github.com`. Branded experience, single source of truth.

## Step 1 — Add branded redirect to `vercel.json`

```json
{
  "redirects": [
    {
      "source": "/downloads/presskit",
      "destination": "https://github.com/webtypografika/presskit/releases/latest/download/PressKit-Setup.exe",
      "permanent": false
    },
    {
      "source": "/downloads/presskit/:version",
      "destination": "https://github.com/webtypografika/presskit/releases/download/:version/PressKit-Setup.exe",
      "permanent": false
    }
  ]
}
```

After deploy:
- `https://presscal.com/downloads/presskit` → always latest
- `https://demo.gr.presscal.com/downloads/presskit` → also latest (same vercel.json applies)
- `https://presscal.com/downloads/presskit/v1.1.3` → pin to specific version

User sees the GitHub URL only briefly during the 302 hop. Browser-level download dialog shows `PressKit-Setup.exe` as the filename.

## Step 2 — Place download buttons across the site

### A. Marketing site `presscal.com` — hero section

```tsx
<a href="/downloads/presskit" className="btn-primary-large">
  <DownloadIcon /> Κατέβασε το PressKit
  <span className="version-tag">Windows · v1.1.4</span>
</a>
```

### B. `demo.gr.presscal.com` — top nav or sidebar

Always-visible "Download PressKit" link in the nav:

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

## Step 3 — Optional: dynamic version label

To show "v1.1.4" without manual updates, add a small server function that fetches the latest GitHub release tag (cached 1 hour):

```ts
// app/api/presskit-version/route.ts
import { NextResponse } from 'next/server'

export const revalidate = 3600 // 1h cache

export async function GET() {
  const res = await fetch('https://api.github.com/repos/webtypografika/presskit/releases/latest')
  if (!res.ok) return NextResponse.json({ version: null })
  const data = await res.json()
  return NextResponse.json({ version: data.tag_name, name: data.name, publishedAt: data.published_at })
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

- **Vercel limit**: 100MB max per asset on Hobby tier; PressKit installer is ~110MB
- **Single source of truth**: GitHub Releases auto-tags every build. No risk of drift between PressCal and the actual binary.
- **Free bandwidth**: GitHub serves all download traffic for free; Vercel only handles the 302 (negligible).
- **Brand-clean URL**: user shares `presscal.com/downloads/presskit`, not a long GitHub URL.

## Testing checklist

- [ ] `curl -I https://demo.gr.presscal.com/downloads/presskit` returns `302` with `Location: https://github.com/.../PressKit-Setup.exe`
- [ ] Clicking the link in any browser triggers download (filename `PressKit-Setup.exe`, ~110MB)
- [ ] Navigation download button visible on every demo page
- [ ] Settings → PressKit shows both "Open" and "Download" CTAs
- [ ] Onboarding banner appears for fresh accounts
