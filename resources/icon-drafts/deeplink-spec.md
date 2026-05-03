# Deep-Link Auto-Configure (`presscal-fh://connect`)

PressKit registers the `presscal-fh://` custom protocol on install. Any link with that scheme opens (and focuses) PressKit and dispatches to a handler keyed by hostname.

For one-click PressKit setup, use the `connect` hostname.

## URL format

```
presscal-fh://connect?url=<presscal_base_url>&apiKey=<psk_live_xxx>
```

**URL-encode both values.** `url` must be the absolute base (no trailing slash, no `/api/...`).

## Example

```
presscal-fh://connect?url=https%3A%2F%2Fdemo.gr.presscal.com&apiKey=psk_live_a1b2c3d4e5f6...
```

## Behavior in PressKit (v1.1.2+)

1. PressKit launches (or focuses if already running)
2. Stores `url` → `presscal.url` and `apiKey` → `presscal.apiKey` in electron-store
3. Immediately calls `GET /api/filehelper/license` with the new credentials
4. Pushes the resulting status to the renderer → LicenseGate unlocks if `active`
5. Shows in-app alert:
   - `Συνδέθηκες! Trial 15 ημερών ξεκίνησε.` (if `isTrial: true, active: true`)
   - `Συνδέθηκες στο PressCal!` (if `active: true, isTrial: false`)
   - `Συνδέθηκες, αλλά η άδεια δεν είναι ενεργή. (<state>)` (if not active)

## What to change in PressCal-next

After the user generates a PressKit API key on `demo.gr.presscal.com`, replace the current "copy this key" button with two side-by-side actions:

```tsx
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL // e.g. https://demo.gr.presscal.com
const params = new URLSearchParams({ url: baseUrl, apiKey: generatedKey })
const deepLink = `presscal-fh://connect?${params.toString()}`

<a
  href={deepLink}
  className="btn-primary"
>
  Open in PressKit
</a>

<button onClick={() => navigator.clipboard.writeText(generatedKey)}>
  Copy key (manual setup)
</button>
```

The browser will prompt the user "Open this link with PressKit?" — they click yes, PressKit launches and configures itself. Manual copy stays as a fallback for users who don't have PressKit installed yet (link to download appears next to the buttons).

## Edge cases handled

- **PressKit not installed**: browser shows "Open this link with..." dialog, no app available. Fallback to manual copy/paste.
- **PressKit already running**: window focuses + reconfigures with the new key (handles re-key flow).
- **PressKit on different machine**: deep links are local — won't cross machines. Manual copy is required for that case.
- **Multiple monitors/minimized**: handler calls `setAlwaysOnTop(true)` for 300ms to force the window to surface (Windows requires this).

## Security note

The API key is in the URL, which means it appears in:
- Browser history
- Local OS protocol-handler logs
- PressKit's deep-link debug log

This is acceptable because:
- Keys are scoped per-org (revocable from PressCal Settings → PressKit)
- Communication still happens over HTTPS
- Same security model as `mailto:` / `slack://` deep links

For higher security, a future iteration could use a one-time exchange code:
1. PressCal generates short-lived `code=xyz`
2. Deep link `presscal-fh://connect?code=xyz`
3. PressKit POSTs `code` to `/api/filehelper/exchange` → gets back the actual key

Not needed for v1.

## Implementation reference (PressKit side)

Already implemented in `src/main/index.ts:821-844` (handler) — see commit history for the v1.1.2 patch that added immediate license refresh on connect.
