import { useEffect, useState, type ReactNode, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Lock, KeyRound, WifiOff, AlertTriangle, ShoppingCart, RefreshCw, Loader2 } from 'lucide-react'

const CHECKOUT_URL = 'https://presscal.com/el/checkout'

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
  background: 'rgba(245, 130, 32, 0.12)',
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
  background: '#f58220',
  color: '#fff',
  border: 'none',
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(245,130,32,0.35)',
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
  void window.api.shell.openExternal(CHECKOUT_URL)
}

function openSettings(): void {
  // SettingsDialog listens for this event with the PressCal tab open by default.
  window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'presscal' } }))
}

function LockScreen({
  icon,
  title: t,
  message,
  primary,
  status,
  onRefresh,
  refreshing,
}: {
  icon: ReactNode
  title: string
  message: ReactNode
  primary: { label: string; onClick: () => void; icon?: ReactNode }
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
    gap: 12,
    padding: '8px 16px',
    background: urgent ? '#dc2626' : '#f58220',
    color: '#fff',
    fontSize: 13,
    fontWeight: 500,
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
  }
  const expiresText = expiresAt
    ? new Date(expiresAt).toLocaleDateString('el-GR', { day: '2-digit', month: 'short', year: 'numeric' })
    : ''
  const dayWord = daysLeft === 1 ? 'ημέρα' : 'ημέρες'
  return (
    <div style={banner}>
      <AlertTriangle size={14} />
      <span>
        Δοκιμαστική έκδοση — απομένουν <strong>{daysLeft} {dayWord}</strong>
        {expiresText && <> (έως {expiresText})</>}
      </span>
      <button
        onClick={openCheckout}
        style={{
          padding: '4px 12px',
          background: 'rgba(255,255,255,0.18)',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
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
        icon: <KeyRound size={32} color="#f58220" />,
        title: 'Σύνδεση με PressCal',
        message: (
          <>
            Για να ενεργοποιήσεις το PressKit πρέπει πρώτα να συνδεθείς με τον λογαριασμό σου στο PressCal.
            <br />
            <br />
            Πήγαινε στο <strong>Settings → API Key</strong> στο PressCal και αντίγραψε το key εδώ.
          </>
        ),
        primary: { label: 'Άνοιγμα ρυθμίσεων', onClick: openSettings, icon: <KeyRound size={16} /> },
        status,
        onRefresh: refresh,
        refreshing,
      }
    case 'unauthorized':
      return {
        icon: <Lock size={32} color="#dc2626" />,
        title: 'Μη έγκυρο API Key',
        message: 'Το API key δεν αναγνωρίζεται από το PressCal. Έλεγξε ότι το αντέγραψες σωστά ή δημιούργησε καινούριο από τις ρυθμίσεις του PressCal.',
        primary: { label: 'Άνοιγμα ρυθμίσεων', onClick: openSettings, icon: <KeyRound size={16} /> },
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
