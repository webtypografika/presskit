import { useEffect, useState, type ReactNode, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Lock, KeyRound, WifiOff, AlertTriangle, ShoppingCart, RefreshCw, Loader2, Globe, Users } from 'lucide-react'

const CHECKOUT_URL = 'https://presscal.com/el/checkout'
const PRESSCAL_WEBSITE = 'https://presscal.com'

// Live PressCal instances offered in the hidden "Advanced" picker. There is
// deliberately NO default instance: a fresh install must connect through the
// browser (PressCal → Settings → PressKit → Connect), whose deep link always
// carries the right server — guessing a server here used to create junk trial
// orgs on the wrong region.
const PRESSCAL_INSTANCES = [
  { label: 'PressCal Pro (pro.presscal.com)', value: 'https://pro.presscal.com' },
  { label: 'Greece (gr.presscal.com)', value: 'https://gr.presscal.com' },
  { label: 'Europe (eu.presscal.com)', value: 'https://eu.presscal.com' },
  { label: 'United States (us.presscal.com)', value: 'https://us.presscal.com' },
] as const
const CUSTOM_INSTANCE = '__custom__'
const SELECT_PLACEHOLDER = '__select__'

interface ProfileMeta {
  id: string
  name: string
  email?: string
  presscalUrl?: string
  orgName?: string
  color: string
}

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

const mutedLink: CSSProperties = {
  color: 'var(--th-text-muted, #94a3b8)',
  textDecoration: 'underline',
  cursor: 'pointer',
}

function hostOf(url?: string): string {
  return (url || '').replace(/^https?:\/\//, '').replace(/\/$/, '')
}

function openCheckout(): void {
  // Logging because users have reported the click "doing nothing" — usually
  // means the URL 404s in their browser, not that openExternal failed.
  console.log('[LicenseGate] Opening checkout:', CHECKOUT_URL)
  window.api.shell.openExternal(CHECKOUT_URL).catch(err => {
    console.error('[LicenseGate] openExternal failed:', err)
  })
}

function openWebsite(): void {
  void window.api.shell.openExternal(PRESSCAL_WEBSITE)
}

function openSettings(): void {
  // SettingsDialog listens for this event with the PressCal tab open by default.
  window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'presscal' } }))
}

async function openGoogleSignIn(base?: string): Promise<void> {
  // `base` is the effective server for this lock screen. If empty (e.g.
  // "Custom" in Advanced with nothing typed), fall back to the previously
  // configured server — so re-auth after a key revoke goes back to the same
  // instance. There is no production default on purpose: without a server we
  // simply do nothing (the UI doesn't offer this button in that case).
  let target = base?.trim()
  if (!target) {
    const stored = (await window.api.settings.get('presscal.url')) as string | undefined
    target = stored?.trim()
  }
  if (!target) return
  void window.api.shell.openExternal(`${target.replace(/\/$/, '')}/auth/presskit-link`)
}

// Server picker inside "Advanced" — pick one of the live PressCal instances or
// type a custom URL. Fully controlled — `base` is the effective URL; any value
// not matching a known instance is shown as "Custom" with a free-text field.
function InstancePicker({ base, onChange }: { base: string; onChange: (v: string) => void }) {
  const normBase = base.replace(/\/$/, '')
  const known = PRESSCAL_INSTANCES.find(i => i.value === normBase)
  const empty = normBase === ''
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
    <div style={{ marginBottom: 16, textAlign: 'left' }}>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--th-text-muted, #94a3b8)', marginBottom: 6 }}>
        PressCal server
      </label>
      <select
        value={empty ? SELECT_PLACEHOLDER : known ? known.value : CUSTOM_INSTANCE}
        onChange={e => onChange(e.target.value === CUSTOM_INSTANCE || e.target.value === SELECT_PLACEHOLDER ? '' : e.target.value)}
        style={fieldStyle}
      >
        {empty && <option value={SELECT_PLACEHOLDER}>Select server…</option>}
        {PRESSCAL_INSTANCES.map(i => (
          <option key={i.value} value={i.value}>{i.label}</option>
        ))}
        <option value={CUSTOM_INSTANCE}>Other server…</option>
      </select>
      {!known && !empty && (
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
  advanced,
  status,
  profiles,
  activeProfileId,
  onRefresh,
  refreshing,
}: {
  icon: ReactNode
  title: string
  message: ReactNode
  primary: { label: string; onClick: () => void; icon?: ReactNode }
  // If provided, renders a discreet "Advanced" link that expands into the
  // server picker + "Manual setup with API key". Normal users never need it —
  // the primary path is the single sign-in / browser-first flow above.
  advanced?: { base: string; setBase: (v: string) => void }
  status: LicenseStatus | null
  profiles: ProfileMeta[]
  activeProfileId: string | null
  onRefresh: () => void
  refreshing: boolean
}) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const otherProfiles = profiles.filter(p => p.id !== activeProfileId)

  const switchTo = async (p: ProfileMeta): Promise<void> => {
    if (!confirm(`Switch to profile "${p.name}"?\n\nPressKit will restart.`)) return
    await window.api.profiles.switch(p.id)
    // The main process calls app.relaunch() — UI freezes momentarily.
  }

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
            Check again
          </button>
        </div>
        {advanced && (
          <div style={{ marginTop: 20, fontSize: 12 }}>
            {showAdvanced ? (
              <div style={{ textAlign: 'left' }}>
                <InstancePicker base={advanced.base} onChange={advanced.setBase} />
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); openSettings() }}
                  style={mutedLink}
                >
                  Manual setup with API key
                </a>
              </div>
            ) : (
              <span style={{ color: 'var(--th-text-muted, #94a3b8)' }}>
                {advanced.base.trim() && (
                  <>Server: <strong>{hostOf(advanced.base)}</strong>{' · '}</>
                )}
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); setShowAdvanced(true) }}
                  style={mutedLink}
                >
                  Advanced
                </a>
              </span>
            )}
          </div>
        )}
        {otherProfiles.length > 0 && (
          <div style={{ marginTop: 28, paddingTop: 18, borderTop: '1px solid var(--th-border, #334155)', textAlign: 'left' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--th-text-muted, #94a3b8)', marginBottom: 10 }}>
              <Users size={13} />
              Or switch to another profile (PressKit will restart):
            </div>
            {otherProfiles.map(p => (
              <button
                key={p.id}
                onClick={() => void switchTo(p)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '8px 12px',
                  marginBottom: 6,
                  background: 'transparent',
                  border: '1px solid var(--th-border, #334155)',
                  borderRadius: 8,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--th-bg-hover, rgba(148,163,184,0.08))' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--th-text-primary, #f1f5f9)', whiteSpace: 'nowrap' }}>{p.name}</span>
                {(p.email || p.presscalUrl) && (
                  <span style={{ fontSize: 11, color: 'var(--th-text-muted, #64748b)', marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[p.email, hostOf(p.presscalUrl)].filter(Boolean).join(' · ')}
                  </span>
                )}
              </button>
            ))}
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

type LockProps = Omit<Parameters<typeof LockScreen>[0], 'profiles' | 'activeProfileId'>

function pickLockProps(
  status: LicenseStatus,
  refresh: () => void,
  refreshing: boolean,
  signIn: { base: string; setBase: (v: string) => void },
): LockProps | null {
  switch (status.state) {
    case 'not_configured': {
      // Fresh install with no stored server: browser-first. The connect deep
      // link from PressCal always carries the right server — never guess one
      // here (a wrong guess used to create junk trial orgs on other regions).
      const hasServer = signIn.base.trim() !== ''
      return {
        icon: <KeyRound size={32} color="var(--th-accent)" />,
        title: 'Connect to PressCal',
        message: hasServer ? (
          <>
            Sign in with your PressCal account to activate PressKit.
            <br />
            <br />
            <span style={{ fontSize: 12, color: 'var(--th-text-muted, #64748b)' }}>
              New users automatically get a <strong>15-day trial</strong>.
            </span>
          </>
        ) : (
          <>
            Open PressCal in your browser and go to{' '}
            <strong>Settings → PressKit → Connect</strong>.
            <br />
            PressKit will connect automatically.
            <br />
            <br />
            <span style={{ fontSize: 12, color: 'var(--th-text-muted, #64748b)' }}>
              No account yet? Sign up at presscal.com — new users get a <strong>15-day trial</strong>.
            </span>
          </>
        ),
        primary: hasServer
          ? { label: 'Sign in with Google', onClick: () => void openGoogleSignIn(signIn.base), icon: <GoogleIcon size={16} /> }
          : { label: 'Open presscal.com', onClick: openWebsite, icon: <Globe size={16} /> },
        advanced: signIn,
        status,
        onRefresh: refresh,
        refreshing,
      }
    }
    case 'unauthorized':
      return {
        icon: <Lock size={32} color="#dc2626" />,
        title: 'Connection is no longer valid',
        message: 'Your PressCal connection has expired or been revoked. Click "Sign in with Google" to reconnect automatically.',
        primary: { label: 'Sign in with Google', onClick: () => void openGoogleSignIn(signIn.base), icon: <GoogleIcon size={16} /> },
        advanced: signIn,
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
  // PressCal URL (so re-auth on `unauthorized` returns to the same instance).
  // Deliberately NO fallback default for fresh installs — they go browser-first.
  const [signInBase, setSignInBase] = useState<string>('')
  useEffect(() => {
    void window.api.settings.get('presscal.url').then((v) => {
      const stored = (v as string | undefined)?.trim()
      if (stored) setSignInBase(stored)
    })
  }, [])

  // Profiles for the lock-screen switcher. A locked user with a second healthy
  // profile must be able to reach it — the overlay covers the normal
  // ProfileSwitcher in the status bar.
  const [profiles, setProfiles] = useState<ProfileMeta[]>([])
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null)
  useEffect(() => {
    void Promise.all([window.api.profiles.list(), window.api.profiles.active()]).then(([list, active]) => {
      setProfiles((list as ProfileMeta[]) || [])
      setActiveProfileId((active as ProfileMeta | null)?.id ?? null)
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
      {lockProps && <LockScreen {...lockProps} profiles={profiles} activeProfileId={activeProfileId} />}
    </>
  )
}
