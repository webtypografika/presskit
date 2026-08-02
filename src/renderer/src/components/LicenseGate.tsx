import { useEffect, useState, type ReactNode, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Lock, KeyRound, WifiOff, AlertTriangle, ShoppingCart, RefreshCw, Loader2 } from 'lucide-react'

const CHECKOUT_URL = 'https://presscal.com/el/checkout'

// PressCal instances offered in the lock-screen picker. The first entry is the
// default for brand-new installs. "Custom" (typed URL) is handled separately.
const PRESSCAL_INSTANCES = [
  { label: 'PressCal (gr.presscal.com)', value: 'https://gr.presscal.com' },
  { label: 'Demo (demo.gr.presscal.com)', value: 'https://demo.gr.presscal.com' },
] as const
const DEFAULT_PRESSCAL_BASE = PRESSCAL_INSTANCES[0].value
const CUSTOM_INSTANCE = '__custom__'

// Google "G" logo, official colors. lucide-react has no brand icons.
function GoogleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A10.99 10.99 0 0 0 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.93l3.66-2.83z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z"/>
    </svg>
  )
}

type LicenseState =
  | 'not_configured'
  | 'unauthorized'
  | 'active'
  | 'expired'
  | 'offline_no_cache'

interface LicenseStatus {
  state: LicenseState
  active: boolean
  plan: 'trial' | 'pro' | 'expired' | null
  expiresAt: string | null
  daysLeft: number
  isTrial: boolean
  orgName: string | null
  offline: boolean
  fetchedAt: number | null
  error?: string
}

function useLicense(): { status: LicenseStatus | null; refresh: () => Promise<void>; refreshing: boolean } {
  const [status, setStatus] = useState<LicenseStatus | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    void window.api.license.get().then(setStatus)
    const cleanup = window.api.license.onChanged((s: LicenseStatus) => setStatus(s))
    return cleanup
  }, [])

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      const next = await window.api.license.refresh()
      setStatus(next)
    } finally {
      setRefreshing(false)
    }
  }

  return { status, refresh, refreshing }
}

// 9500 sits above the trial banner (9000) but below SettingsDialog (9999),
// so the user can open settings on top of the lock to enter a new API key.
const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9500,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(8, 12, 24, 0.92)',
  backdropFilter: 'blur(8px)',
  padding: 32,
}

const card: CSSProperties = {
  width: '100%',
  maxWidth: 520,
  background: 'var(--th-bg-secondary, #1e293b)',
  border: '1px solid var(--th-border, #334155)',
  borderRadius: 16,
  padding: 40,
  textAlign: 'center',
  boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
}

const iconWrap: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 72,
  height: 72,
  borderRadius: '50%',
  background: 'rgba(110, 200, 200, 0.14)',
  marginBottom: 24,
}

const title: CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: 'var(--th-text-primary, #f1f5f9)',
  marginBottom: 12,
}

const body: CSSProperties = {
  fontSize: 14,
  lineHeight: 1.6,
  color: 'var(--th-text-secondary, #cbd5e1)',
  marginBottom: 28,
}

const primaryBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '12px 24px',
  background: 'var(--th-accent)',
  color: '#fff',
  border: 'none',
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(0,112,124,0.35)',
}

const secondaryBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 20px',
  background: 'transparent',
  color: 'var(--th-text-primary, #f1f5f9)',
  border: '1px solid var(--th-border, #334155)',
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  marginLeft: 12,
}

function openCheckout(): void {
  // Logging because users have reported the click "doing nothing" — usually
  // means the URL 404s in their browser, not that openExternal failed.
  console.log('[LicenseGate] Opening checkout:', CHECKOUT_URL)
  window.api.shell.openExternal(CHECKOUT_URL).catch(err => {
    console.error('[LicenseGate] openExternal failed:', err)
  })
}

function openSettings(): void {
  // SettingsDialog listens for this event with the PressCal tab open by default.
  window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'presscal' } }))
}

async function openGoogleSignIn(base?: string): Promise<void> {
  // `base` is the instance the user picked on the lock screen. If it's empty
  // (e.g. "Custom" with nothing typed), fall back to a previously configured
  // server — so re-auth after a key revoke goes back to the same instance —
  // then to the production default for first-time users.
  let target = base?.trim()
  if (!target) {
    const stored = (await window.api.settings.get('presscal.url')) as string | undefined
    target = stored?.trim() || DEFAULT_PRESSCAL_BASE
  }
  void window.api.shell.openExternal(`${target.replace(/\/$/, '')}/auth/presskit-link`)
}

// Lock-screen dropdown to pick which PressCal instance the Google sign-in
// should target. Fully controlled — `base` is the effective URL, and any value
// not matching a known instance is shown as "Custom" with a free-text field.
function InstancePicker({ base, onChange }: { base: string; onChange: (v: string) => void }) {
  const normBase = base.replace(/\/$/, '')
  const known = PRESSCAL_INSTANCES.find(i => i.value === normBase)
  const fieldStyle: CSSProperties = {
    width: '100%',
    padding: '9px 12px',
    borderRadius: 8,
    background: 'var(--th-bg-primary, #0f172a)',
    color: 'var(--th-text-primary, #f1f5f9)',
    border: '1px solid var(--th-border, #334155)',
    fontSize: 13,
  }
  return (
    <div style={{ marginBottom: 20, textAlign: 'left' }}>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--th-text-muted, #94a3b8)', marginBottom: 6 }}>
        PressCal server
      </label>
      <select
        value={known ? known.value : CUSTOM_INSTANCE}
        onChange={e => onChange(e.target.value === CUSTOM_INSTANCE ? '' : e.target.value)}
        style={fieldStyle}
      >
        {PRESSCAL_INSTANCES.map(i => (
          <option key={i.value} value={i.value}>{i.label}</option>
        ))}
        <option value={CUSTOM_INSTANCE}>Other server…</option>
      </select>
      {!known && (
        <input
          type="url"
          value={base}
          onChange={e => onChange(e.target.value)}
          placeholder="https://…"
          style={{ ...fieldStyle, marginTop: 8, fontFamily: 'monospace' }}
        />
      )}
    </div>
  )
}

function LockScreen({
  icon,
  title: t,
  message,
  primary,
  manualSetup,
  signInPicker,
  status,
  onRefresh,
  refreshing,
}: {
  icon: ReactNode
  title: string
  message: ReactNode
  primary: { label: string; onClick: () => void; icon?: ReactNode }
  // If provided, renders a small text link beneath the buttons for users who
  // want the old API-key flow. Only used in not_configured / unauthorized.
  manualSetup?: boolean
  // If provided, renders the PressCal-instance picker above the buttons.
  // Only used in not_configured / unauthorized.
  signInPicker?: { base: string; setBase: (v: string) => void }
  status: LicenseStatus | null
  onRefresh: () => void
  refreshing: boolean
}) {
  const [showPicker, setShowPicker] = useState(false)
  return createPortal(
    <div style={overlay}>
      <div style={card}>
        <div style={iconWrap}>{icon}</div>
        <div style={title}>{t}</div>
        <div style={body}>{message}</div>
        {signInPicker && (
          showPicker ? (
            <InstancePicker base={signInPicker.base} onChange={signInPicker.setBase} />
          ) : (
            <div style={{ marginBottom: 20, fontSize: 12, color: 'var(--th-text-muted, #94a3b8)' }}>
              Server: <strong>{signInPicker.base.replace(/^https?:\/\//, '').replace(/\/$/, '') || 'gr.presscal.com'}</strong>
              {' · '}
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); setShowPicker(true) }}
                style={{ color: 'var(--th-text-muted, #94a3b8)', textDecoration: 'underline' }}
              >
                Change
              </a>
            </div>
          )
        )}
        <div>
          <button style={primaryBtn} onClick={primary.onClick}>
            {primary.icon}
            {primary.label}
          </button>
          <button style={secondaryBtn} onClick={onRefresh} disabled={refreshing}>
            {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Check again
          </button>
        </div>
        {manualSetup && (
          <div style={{ marginTop: 20, fontSize: 12 }}>
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); openSettings() }}
              style={{ color: 'var(--th-text-muted, #94a3b8)', textDecoration: 'underline' }}
            >
              Manual setup with API key
            </a>
          </div>
        )}
        {status?.orgName && (
          <div style={{ marginTop: 24, fontSize: 12, color: 'var(--th-text-muted, #64748b)' }}>
            {status.orgName}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

function TrialBanner({ daysLeft, expiresAt }: { daysLeft: number; expiresAt: string | null }) {
  const urgent = daysLeft <= 3
  const banner: CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: '3px 14px',
    minHeight: 22,
    background: urgent ? '#dc2626' : 'var(--th-accent)',
    color: '#fff',
    fontSize: 12,
    fontWeight: 500,
    boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
    WebkitAppRegion: 'no-drag' as any,
  }
  const expiresText = expiresAt
    ? new Date(expiresAt).toLocaleDateString('el-GR', { day: '2-digit', month: 'short', year: 'numeric' })
    : ''
  const dayWord = daysLeft === 1 ? 'day' : 'days'
  return (
    <div style={banner}>
      <AlertTriangle size={12} />
      <span>
        Trial version — <strong>{daysLeft} {dayWord}</strong> left
        {expiresText && <> (until {expiresText})</>}
      </span>
      <button
        onClick={openCheckout}
        style={{
          padding: '2px 10px',
          minHeight: 18,
          background: 'rgba(255,255,255,0.18)',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          lineHeight: 1.3,
        }}
      >
        Buy subscription
      </button>
    </div>
  )
}

function pickLockProps(
  status: LicenseStatus,
  refresh: () => void,
  refreshing: boolean,
  signIn: { base: string; setBase: (v: string) => void },
): Parameters<typeof LockScreen>[0] | null {
  switch (status.state) {
    case 'not_configured':
      return {
        icon: <KeyRound size={32} color="var(--th-accent)" />,
        title: 'Connect to PressCal',
        message: (
          <>
            Sign in with your PressCal account to activate PressKit.
            <br />
            <br />
            <span style={{ fontSize: 12, color: 'var(--th-text-muted, #64748b)' }}>
              New users automatically get a <strong>15-day trial</strong>.
            </span>
          </>
        ),
        primary: { label: 'Sign in with Google', onClick: () => void openGoogleSignIn(signIn.base), icon: <GoogleIcon size={16} /> },
        manualSetup: true,
        signInPicker: signIn,
        status,
        onRefresh: refresh,
        refreshing,
      }
    case 'unauthorized':
      return {
        icon: <Lock size={32} color="#dc2626" />,
        title: 'Connection is no longer valid',
        message: 'Your PressCal connection has expired or been revoked. Click "Sign in with Google" to reconnect automatically.',
        primary: { label: 'Sign in with Google', onClick: () => void openGoogleSignIn(signIn.base), icon: <GoogleIcon size={16} /> },
        manualSetup: true,
        signInPicker: signIn,
        status,
        onRefresh: refresh,
        refreshing,
      }
    case 'offline_no_cache':
      return {
        icon: <WifiOff size={32} color="#94a3b8" />,
        title: 'No connection',
        message: 'PressKit cannot reach PressCal to verify your license. Check your internet connection and try again.',
        primary: { label: 'Try again', onClick: refresh, icon: <RefreshCw size={16} /> },
        status,
        onRefresh: refresh,
        refreshing,
      }
    case 'expired':
      return {
        icon: <Lock size={32} color="#dc2626" />,
        title: status.plan === 'trial' || status.isTrial ? 'Your trial has expired' : 'Your subscription has expired',
        message: (
          <>
            To keep using PressKit, get a PressCal Pro subscription.
            <br />
            <br />
            <span style={{ fontSize: 12, color: 'var(--th-text-muted, #64748b)' }}>
              All your data remains safe and will be available again after activation.
            </span>
          </>
        ),
        primary: { label: 'Buy subscription', onClick: openCheckout, icon: <ShoppingCart size={16} /> },
        status,
        onRefresh: refresh,
        refreshing,
      }
    default:
      return null
  }
}

export function LicenseGate({ children }: { children: ReactNode }) {
  const { status, refresh, refreshing } = useLicense()

  // Which PressCal instance the Google sign-in targets. Seeded from the stored
  // PressCal URL (so re-auth on `unauthorized` returns to the same instance),
  // falling back to the production default for fresh installs.
  const [signInBase, setSignInBase] = useState<string>(DEFAULT_PRESSCAL_BASE)
  useEffect(() => {
    void window.api.settings.get('presscal.url').then((v) => {
      const stored = (v as string | undefined)?.trim()
      if (stored) setSignInBase(stored)
    })
  }, [])

  // Initial fetch in flight — render the app as-is rather than flashing a lock.
  // The first response broadcast will show the gate within ~200ms if needed.
  if (!status) return <>{children}</>

  const lockProps = pickLockProps(status, refresh, refreshing, { base: signInBase, setBase: setSignInBase })

  // Children are always mounted, even when locked. This keeps the SettingsDialog
  // (and other portals) reachable so the user can paste a fresh API key without
  // restarting the app. The overlay sits above them and absorbs all input.
  return (
    <>
      {status.isTrial && status.state === 'active' && (
        <TrialBanner daysLeft={status.daysLeft} expiresAt={status.expiresAt} />
      )}
      {children}
      {lockProps && <LockScreen {...lockProps} />}
    </>
  )
}
