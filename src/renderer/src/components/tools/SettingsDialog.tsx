import { useState, useEffect, CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '@/stores/app-store'
import {
  Settings, X, Link2, Cloud, Scan, Monitor,
  CheckCircle, XCircle, Eye, EyeOff
} from 'lucide-react'

type SettingsTab = 'presscal' | 'dropbox' | 'preflight' | 'ui'

/* Reusable field wrapper — gives each setting a card-like row */
function Field({ label, description, children, noPad }: { label?: string; description?: string; children: ReactNode; noPad?: boolean }) {
  const row: CSSProperties = {
    padding: noPad ? '16px 0' : '20px 24px',
    borderBottom: '1px solid var(--th-border)',
    background: noPad ? 'transparent' : 'var(--th-bg-primary)',
    borderRadius: noPad ? 0 : 10,
    marginBottom: 4,
  }
  return (
    <div style={row}>
      {label && <div style={{ fontSize: 13, color: 'var(--th-text-muted)', fontWeight: 500, marginBottom: 10 }}>{label}</div>}
      {children}
      {description && <div style={{ fontSize: 12, color: 'var(--th-text-muted)', marginTop: 8, opacity: 0.7 }}>{description}</div>}
    </div>
  )
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: 8,
  background: 'var(--th-bg-primary)',
  border: '1px solid var(--th-border)',
  color: 'var(--th-text-primary)',
  fontSize: 14,
  outline: 'none',
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<SettingsTab>('presscal')

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', padding: 40 }}>
      <div style={{ width: '100%', maxWidth: 800, maxHeight: '100%', background: 'var(--th-bg-secondary)', borderRadius: 16, border: '1px solid var(--th-border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div className="flex items-center justify-between" style={{ padding: '24px 40px', borderBottom: '1px solid var(--th-border)' }}>
          <div className="flex items-center gap-3">
            <Settings size={22} style={{ color: 'var(--th-accent)' }} />
            <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--th-text-primary)' }}>Settings</span>
          </div>
          <button onClick={onClose} style={{ padding: 8, background: 'none', border: 'none', cursor: 'pointer', borderRadius: 8 }}>
            <X size={20} style={{ color: 'var(--th-text-muted)' }} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex" style={{ padding: '0 24px', borderBottom: '1px solid var(--th-border)' }}>
          {([
            { id: 'presscal', label: 'PressCal', icon: <Link2 size={16} /> },
            { id: 'dropbox', label: 'Dropbox', icon: <Cloud size={16} /> },
            { id: 'preflight', label: 'Preflight', icon: <Scan size={16} /> },
            { id: 'ui', label: 'Display', icon: <Monitor size={16} /> }
          ] as const).map(t => (
            <button
              key={t.id}
              className="flex items-center gap-2"
              style={{
                padding: '16px 20px', fontSize: 14, background: 'none', border: 'none', cursor: 'pointer',
                color: tab === t.id ? 'var(--th-accent)' : 'var(--th-text-muted)',
                borderBottom: tab === t.id ? '2px solid var(--th-accent)' : '2px solid transparent',
              }}
              onClick={() => setTab(t.id)}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto" style={{ padding: '28px 32px' }}>
          {tab === 'presscal' && <PresscalSettings />}
          {tab === 'dropbox' && <DropboxSettings />}
          {tab === 'preflight' && <PreflightSettings />}
          {tab === 'ui' && <UiSettings />}
        </div>
      </div>
    </div>,
    document.body
  )
}

function PresscalSettings() {
  const { presscalConnected, presscalOrgName } = useAppStore()
  const [url, setUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null)

  useEffect(() => {
    window.api.settings.get('presscal.url').then((v: any) => setUrl(v || ''))
    window.api.settings.get('presscal.apiKey').then((v: any) => setApiKey(v || ''))
  }, [])

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      await window.api.presscal.configure(url, apiKey)
      const status = await window.api.presscal.status()
      if (status.connected) {
        setTestResult('ok')
        useAppStore.setState({ presscalConnected: true, presscalOrgName: (status as any).orgName || '' })
      } else {
        setTestResult('fail')
      }
    } catch {
      setTestResult('fail')
    } finally {
      setTesting(false)
    }
  }

  const disconnect = async () => {
    if (!confirm('Αποσύνδεση από PressCal;\n\nΘα διαγραφούν URL και API key. Θα χρειαστεί να συνδεθείς ξανά για να χρησιμοποιήσεις το PressKit.')) return
    await window.api.presscal.configure('', '')
    setUrl('')
    setApiKey('')
    setTestResult(null)
    useAppStore.setState({ presscalConnected: false, presscalOrgName: '' })
    // Push a fresh license check so the LicenseGate immediately re-locks the app.
    await window.api.license.refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Status */}
      <Field>
        <div className="flex items-center" style={{ gap: 12 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: presscalConnected ? '#22c55e' : 'var(--th-text-muted)' }} />
          <span style={{ fontSize: 14, color: 'var(--th-text-primary)', fontWeight: 500 }}>
            {presscalConnected ? `Connected to ${presscalOrgName}` : 'Not connected'}
          </span>
        </div>
      </Field>

      {/* URL */}
      <Field label="PressCal URL">
        <input
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="http://localhost:3000"
          style={inputStyle}
        />
      </Field>

      {/* API Key */}
      <Field label="API Key">
        <div className="flex items-center" style={{ gap: 12 }}>
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="psk_live_..."
            style={{ ...inputStyle, fontFamily: 'monospace' }}
          />
          <button
            onClick={() => setShowKey(!showKey)}
            style={{ padding: 12, background: 'var(--th-bg-primary)', border: '1px solid var(--th-border)', borderRadius: 8, cursor: 'pointer' }}
          >
            {showKey ? <EyeOff size={18} style={{ color: 'var(--th-text-muted)' }} /> : <Eye size={18} style={{ color: 'var(--th-text-muted)' }} />}
          </button>
        </div>
      </Field>

      {/* Test button */}
      <div style={{ paddingTop: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
        <button
          onClick={testConnection}
          disabled={testing || !url || !apiKey}
          style={{
            padding: '12px 32px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: '#6ec8c8', color: '#fff', fontSize: 14, fontWeight: 600,
            opacity: (testing || !url || !apiKey) ? 0.5 : 1,
          }}
        >
          {testing ? 'Testing...' : 'Test Connection'}
        </button>
        {testResult === 'ok' && <span className="flex items-center gap-2" style={{ color: '#22c55e', fontSize: 14 }}><CheckCircle size={18} /> Connected</span>}
        {testResult === 'fail' && <span className="flex items-center gap-2" style={{ color: '#ef4444', fontSize: 14 }}><XCircle size={18} /> Failed</span>}

        {(url || apiKey) && (
          <button
            onClick={disconnect}
            style={{
              marginLeft: 'auto',
              padding: '10px 20px', borderRadius: 8, cursor: 'pointer',
              background: 'transparent', color: '#ef4444',
              border: '1px solid #ef4444', fontSize: 13, fontWeight: 500,
            }}
          >
            Αποσύνδεση
          </button>
        )}
      </div>
    </div>
  )
}

function DropboxSettings() {
  const { dropboxConnected, dropboxName } = useAppStore()
  const [clientId, setClientId] = useState('')
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    window.api.settings.get('dropbox.clientId').then((v: any) => setClientId(v || ''))
  }, [])

  const connect = async () => {
    if (!clientId) return
    setConnecting(true)
    try {
      const ok = await window.api.dropbox.connect(clientId)
      if (ok) {
        const status = await window.api.dropbox.status()
        useAppStore.setState({ dropboxConnected: true, dropboxName: (status as any).name || '' })
      }
    } catch {} finally { setConnecting(false) }
  }

  const disconnect = async () => {
    await window.api.dropbox.disconnect()
    useAppStore.setState({ dropboxConnected: false, dropboxName: '' })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Field>
        <div className="flex items-center" style={{ gap: 12 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: dropboxConnected ? '#22c55e' : 'var(--th-text-muted)' }} />
          <span style={{ fontSize: 14, color: 'var(--th-text-primary)', fontWeight: 500 }}>
            {dropboxConnected ? `Connected as ${dropboxName}` : 'Not connected'}
          </span>
        </div>
      </Field>

      <Field label="Dropbox App Client ID" description="Create an app at dropbox.com/developers/apps to get a client ID">
        <input type="text" value={clientId} onChange={e => setClientId(e.target.value)} placeholder="Your Dropbox App client ID" style={{ ...inputStyle, fontFamily: 'monospace' }} />
      </Field>

      <div style={{ paddingTop: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
        {!dropboxConnected ? (
          <button onClick={connect} disabled={connecting || !clientId}
            style={{
              padding: '12px 32px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: '#6ec8c8', color: '#fff', fontSize: 14, fontWeight: 600,
              opacity: (connecting || !clientId) ? 0.5 : 1,
            }}>
            {connecting ? 'Connecting...' : 'Connect Dropbox'}
          </button>
        ) : (
          <button onClick={disconnect}
            style={{
              padding: '12px 32px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: 14, fontWeight: 600,
            }}>
            Disconnect
          </button>
        )}
      </div>
    </div>
  )
}

function PreflightSettings() {
  const [minDpi, setMinDpi] = useState(300)
  const [maxTac, setMaxTac] = useState(300)
  const [requireCmyk, setRequireCmyk] = useState(true)
  const [requireBleed, setRequireBleed] = useState(true)
  const [bleedMm, setBleedMm] = useState(3)

  useEffect(() => {
    Promise.all([
      window.api.settings.get('preflight.minDpi'),
      window.api.settings.get('preflight.maxTac'),
      window.api.settings.get('preflight.requireCmyk'),
      window.api.settings.get('preflight.requireBleed'),
      window.api.settings.get('preflight.bleedMm')
    ]).then(([dpi, tac, cmyk, bleed, mm]) => {
      if (dpi) setMinDpi(dpi as number)
      if (tac) setMaxTac(tac as number)
      if (cmyk !== undefined) setRequireCmyk(cmyk as boolean)
      if (bleed !== undefined) setRequireBleed(bleed as boolean)
      if (mm) setBleedMm(mm as number)
    })
  }, [])

  const save = () => {
    window.api.settings.set('preflight.minDpi', minDpi)
    window.api.settings.set('preflight.maxTac', maxTac)
    window.api.settings.set('preflight.requireCmyk', requireCmyk)
    window.api.settings.set('preflight.requireBleed', requireBleed)
    window.api.settings.set('preflight.bleedMm', bleedMm)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Field label="Minimum DPI">
        <input type="number" value={minDpi} onChange={e => setMinDpi(Number(e.target.value))} onBlur={save} style={{ ...inputStyle, width: 120 }} />
      </Field>

      <Field label="Max Total Area Coverage (TAC %)">
        <input type="number" value={maxTac} onChange={e => setMaxTac(Number(e.target.value))} onBlur={save} style={{ ...inputStyle, width: 120 }} />
      </Field>

      <Field label="Bleed (mm)">
        <input type="number" value={bleedMm} onChange={e => setBleedMm(Number(e.target.value))} onBlur={save} style={{ ...inputStyle, width: 120 }} />
      </Field>

      <Field>
        <label className="flex items-center cursor-pointer" style={{ gap: 12 }} onClick={() => { setRequireCmyk(!requireCmyk); setTimeout(save, 0) }}>
          <input type="checkbox" checked={requireCmyk} readOnly style={{ width: 18, height: 18, accentColor: '#6ec8c8' }} />
          <span style={{ fontSize: 14, color: 'var(--th-text-primary)' }}>Require CMYK color space</span>
        </label>
      </Field>

      <Field>
        <label className="flex items-center cursor-pointer" style={{ gap: 12 }} onClick={() => { setRequireBleed(!requireBleed); setTimeout(save, 0) }}>
          <input type="checkbox" checked={requireBleed} readOnly style={{ width: 18, height: 18, accentColor: '#6ec8c8' }} />
          <span style={{ fontSize: 14, color: 'var(--th-text-primary)' }}>Require bleed</span>
        </label>
      </Field>
    </div>
  )
}

function UiSettings() {
  const { viewMode, setViewMode, thumbnailSize, setThumbnailSize } = useAppStore()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Field label="Default View Mode">
        <div className="flex" style={{ gap: 10 }}>
          <button
            style={{
              padding: '10px 24px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 14,
              background: viewMode === 'grid' ? 'rgba(110,200,200,0.1)' : 'var(--th-bg-primary)',
              color: viewMode === 'grid' ? '#6ec8c8' : 'var(--th-text-muted)',
            }}
            onClick={() => setViewMode('grid')}
          >Grid</button>
          <button
            style={{
              padding: '10px 24px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 14,
              background: viewMode === 'list' ? 'rgba(110,200,200,0.1)' : 'var(--th-bg-primary)',
              color: viewMode === 'list' ? '#6ec8c8' : 'var(--th-text-muted)',
            }}
            onClick={() => setViewMode('list')}
          >List</button>
        </div>
      </Field>

      <Field label={`Thumbnail Size: ${thumbnailSize}px`}>
        <input type="range" min={64} max={256} step={16} value={thumbnailSize} onChange={e => setThumbnailSize(Number(e.target.value))} style={{ width: '100%', accentColor: '#6ec8c8' }} />
      </Field>
    </div>
  )
}
