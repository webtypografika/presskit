import { useEffect, useState, type ReactNode, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Lock, KeyRound, WifiOff, AlertTriangle, ShoppingCart, RefreshCw, Loader2 } from 'lucide-react'

const CHECKOUT_URL = 'https://presscal.com/el/checkout'
// Default sign-in target. If the user has already configured a custom PressCal
// URL (e.g. pro.presscal.com), we send them there instead — see openGoogleSignIn.
const DEFAULT_PRESSCAL_BASE = 'https://demo.gr.presscal.com'

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
  background: '#00707c',
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

async function openGoogleSignIn(): Promise<void> {
  // Honor a previously configured server (e.g. pro.presscal.com) so re-auth
  // after a key revoke goes back to the same instance. Falls back to demo for
  // first-time users who haven't configured anything yet.
  const stored = (await window.api.settings.get('presscal.url')) as string | undefined
  const base = (stored?.trim() || DEFAULT_PRESSCAL_BASE).replace(/\/$/, '')
  void window.api.shell.openExternal(`${base}/auth/presskit-link`)
}

function LockScreen({
  icon,
  title: t,
  message,
  primary,
  manualSetup,
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
  status: LicenseStatus | null
  onRefresh: () => void
  refreshing: boolean
}) {
  return createPortal(
    <div style={overlay}>
      <div style={card}>
        <div style={iconWrap}>{icon}</div>
        <div style={title}>{t}</div>
        <div style={body}>{message}</div>
        <div>
          <button style={primaryBtn} onClick={primary.onClick}>
            {primary.icon}
            {primary.label}
          </button>
          <button style={secondaryBtn} onClick={onRefresh} disabled={refreshing}>
            {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Επανέλεγχος
          </button>
        </div>
        {manualSetup && (
          <div style={{ marginTop: 20, fontSize: 12 }}>
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); openSettings() }}
              style={{ color: 'var(--th-text-muted, #94a3b8)', textDecoration: 'underline' }}
            >
              Manual setup με API key
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
    background: urgent ? '#dc2626' : '#00707c',
    color: '#fff',
    fontSize: 12,
    fontWeight: 500,
    boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
  }
  const expiresText = expiresAt
    ? new Date(expiresAt).toLocaleDateString('el-GR', { day: '2-digit', month: 'short', year: 'numeric' })
    : ''
  const dayWord = daysLeft === 1 ? 'ημέρα' : 'ημέρες'
  return (
    <div style={banner}>
      <AlertTriangle size={12} />
      <span>
        Δοκιμαστική έκδοση — απομένουν <strong>{daysLeft} {dayWord}</strong>
        {expiresText && <> (έως {expiresText})</>}
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
        Αγορά συνδρομής
      </button>
    </div>
  )
}

function pickLockProps(status: LicenseStatus, refresh: () => void, refreshing: boolean): Parameters<typeof LockScreen>[0] | null {
  switch (status.state) {
    case 'not_configured':
      return {
        icon: <KeyRound size={32} color="#6ec8c8" />,
        title: 'Σύνδεση με PressCal',
        message: (
          <>
            Συνδέσου με τον λογαριασμό σου στο PressCal για να ενεργοποιήσεις το PressKit.
            <br />
            <br />
            <span style={{ fontSize: 12, color: 'var(--th-text-muted, #64748b)' }}>
              Νέοι χρήστες παίρνουν αυτόματα <strong>15 ημέρες δοκιμή</strong>.
            </span>
          </>
        ),
        primary: { label: 'Σύνδεση με Google', onClick: openGoogleSignIn, icon: <GoogleIcon size={16} /> },
        manualSetup: true,
        status,
        onRefresh: refresh,
        refreshing,
      }
    case 'unauthorized':
      return {
        icon: <Lock size={32} color="#dc2626" />,
        title: 'Η σύνδεση δεν είναι έγκυρη',
        message: 'Το API key δεν αναγνωρίζεται πλέον από το PressCal. Συνδέσου ξανά για να γίνει αυτόματη ανανέωση.',
        primary: { label: 'Σύνδεση με Google', onClick: openGoogleSignIn, icon: <GoogleIcon size={16} /> },
        manualSetup: true,
        status,
        onRefresh: refresh,
        refreshing,
      }
    case 'offline_no_cache':
      return {
        icon: <WifiOff size={32} color="#94a3b8" />,
        title: 'Δεν υπάρχει σύνδεση',
        message: 'Το PressKit δεν μπορεί να επικοινωνήσει με το PressCal για να επαληθεύσει την άδειά σου. Έλεγξε τη σύνδεσή σου στο internet και δοκίμασε ξανά.',
        primary: { label: 'Δοκίμασε ξανά', onClick: refresh, icon: <RefreshCw size={16} /> },
        status,
        onRefresh: refresh,
        refreshing,
      }
    case 'expired':
      return {
        icon: <Lock size={32} color="#dc2626" />,
        title: status.plan === 'trial' || status.isTrial ? 'Η δοκιμαστική περίοδος έληξε' : 'Η συνδρομή σου έληξε',
        message: (
          <>
            Για να συνεχίσεις να χρησιμοποιείς το PressKit, απόκτησε συνδρομή PressCal Pro.
            <br />
            <br />
            <span style={{ fontSize: 12, color: 'var(--th-text-muted, #64748b)' }}>
              Όλα τα δεδομένα σου παραμένουν ασφαλή και θα είναι διαθέσιμα μετά την ενεργοποίηση.
            </span>
          </>
        ),
        primary: { label: 'Αγορά συνδρομής', onClick: openCheckout, icon: <ShoppingCart size={16} /> },
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

  // Initial fetch in flight — render the app as-is rather than flashing a lock.
  // The first response broadcast will show the gate within ~200ms if needed.
  if (!status) return <>{children}</>

  const lockProps = pickLockProps(status, refresh, refreshing)

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
