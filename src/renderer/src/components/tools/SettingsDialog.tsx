import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '@/stores/app-store'
import {
  Settings, X, Link2, Cloud, Scan, Monitor,
  CheckCircle, XCircle, Eye, EyeOff
} from 'lucide-react'

type SettingsTab = 'presscal' | 'dropbox' | 'preflight' | 'ui'

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<SettingsTab>('presscal')

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', padding: 40 }}>
      <div style={{ width: '100%', maxWidth: 800, maxHeight: '100%', background: '#0f1525', borderRadius: 16, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-10 py-6 border-b border-border">
          <div className="flex items-center gap-3">
            <Settings size={22} className="text-accent" />
            <span className="text-lg font-semibold">Settings</span>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-bg-hover rounded-lg">
            <X size={20} className="text-text-muted" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-6">
          {([
            { id: 'presscal', label: 'PressCal', icon: <Link2 size={16} /> },
            { id: 'dropbox', label: 'Dropbox', icon: <Cloud size={16} /> },
            { id: 'preflight', label: 'Preflight', icon: <Scan size={16} /> },
            { id: 'ui', label: 'Display', icon: <Monitor size={16} /> }
          ] as const).map(t => (
            <button
              key={t.id}
              className={`flex items-center gap-2 px-5 py-4 text-sm border-b-2 transition-colors ${
                tab === t.id
                  ? 'text-accent border-accent'
                  : 'text-text-secondary border-transparent hover:text-text-primary'
              }`}
              onClick={() => setTab(t.id)}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-10 py-10">
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
        useAppStore.setState({
          presscalConnected: true,
          presscalOrgName: (status as any).orgName || ''
        })
      } else {
        setTestResult('fail')
      }
    } catch {
      setTestResult('fail')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div>
      {/* Status */}
      <div className="flex items-center gap-3 mb-8">
        <div className={`w-3 h-3 rounded-full ${presscalConnected ? 'bg-success' : 'bg-text-muted'}`} />
        <span className="text-sm text-text-secondary">
          {presscalConnected ? `Connected to ${presscalOrgName}` : 'Not connected'}
        </span>
      </div>

      {/* URL */}
      <div className="mb-8">
        <label className="text-sm text-text-muted font-medium block mb-3">PressCal URL</label>
        <input
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="http://localhost:3000"
        />
      </div>

      {/* API Key */}
      <div className="mb-8">
        <label className="text-sm text-text-muted font-medium block mb-3">API Key</label>
        <div className="flex items-center gap-3">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="fh_..."
            className="flex-1 font-mono"
          />
          <button
            onClick={() => setShowKey(!showKey)}
            className="p-3 bg-bg-primary border border-border rounded-lg hover:bg-bg-hover"
          >
            {showKey ? <EyeOff size={18} className="text-text-muted" /> : <Eye size={18} className="text-text-muted" />}
          </button>
        </div>
      </div>

      {/* Test button */}
      <div className="flex items-center gap-4">
        <button
          onClick={testConnection}
          disabled={testing || !url || !apiKey}
          className="px-8 py-3 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover disabled:opacity-50"
        >
          {testing ? 'Testing...' : 'Test Connection'}
        </button>
        {testResult === 'ok' && <span className="flex items-center gap-2 text-success"><CheckCircle size={18} /> Connected</span>}
        {testResult === 'fail' && <span className="flex items-center gap-2 text-error"><XCircle size={18} /> Failed</span>}
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
    <div>
      <div className="flex items-center gap-3 mb-8">
        <div className={`w-3 h-3 rounded-full ${dropboxConnected ? 'bg-success' : 'bg-text-muted'}`} />
        <span className="text-sm text-text-secondary">
          {dropboxConnected ? `Connected as ${dropboxName}` : 'Not connected'}
        </span>
      </div>

      <div className="mb-8">
        <label className="text-sm text-text-muted font-medium block mb-3">Dropbox App Client ID</label>
        <input type="text" value={clientId} onChange={e => setClientId(e.target.value)} placeholder="Your Dropbox App client ID" className="font-mono" />
        <p className="text-sm text-text-muted mt-3">Create an app at dropbox.com/developers/apps to get a client ID</p>
      </div>

      <div className="flex items-center gap-4">
        {!dropboxConnected ? (
          <button onClick={connect} disabled={connecting || !clientId}
            className="px-8 py-3 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover disabled:opacity-50">
            {connecting ? 'Connecting...' : 'Connect Dropbox'}
          </button>
        ) : (
          <button onClick={disconnect}
            className="px-8 py-3 bg-error/10 text-error rounded-lg text-sm font-medium hover:bg-error/20">
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
    <div>
      <div className="mb-8">
        <label className="text-sm text-text-muted font-medium block mb-3">Minimum DPI</label>
        <input type="number" value={minDpi} onChange={e => setMinDpi(Number(e.target.value))} onBlur={save} className="w-32" />
      </div>

      <div className="mb-8">
        <label className="text-sm text-text-muted font-medium block mb-3">Max Total Area Coverage (TAC %)</label>
        <input type="number" value={maxTac} onChange={e => setMaxTac(Number(e.target.value))} onBlur={save} className="w-32" />
      </div>

      <div className="mb-8">
        <label className="text-sm text-text-muted font-medium block mb-3">Bleed (mm)</label>
        <input type="number" value={bleedMm} onChange={e => setBleedMm(Number(e.target.value))} onBlur={save} className="w-32" />
      </div>

      <div className="mb-6">
        <label className="flex items-center gap-3 cursor-pointer" onClick={() => { setRequireCmyk(!requireCmyk); setTimeout(save, 0) }}>
          <input type="checkbox" checked={requireCmyk} readOnly className="w-5 h-5 accent-accent" />
          <span className="text-sm text-text-secondary">Require CMYK color space</span>
        </label>
      </div>

      <div className="mb-6">
        <label className="flex items-center gap-3 cursor-pointer" onClick={() => { setRequireBleed(!requireBleed); setTimeout(save, 0) }}>
          <input type="checkbox" checked={requireBleed} readOnly className="w-5 h-5 accent-accent" />
          <span className="text-sm text-text-secondary">Require bleed</span>
        </label>
      </div>
    </div>
  )
}

function UiSettings() {
  const { viewMode, setViewMode, thumbnailSize, setThumbnailSize } = useAppStore()

  return (
    <div>
      <div className="mb-8">
        <label className="text-sm text-text-muted font-medium block mb-3">Default View Mode</label>
        <div className="flex gap-3">
          <button className={`px-6 py-3 rounded-lg text-sm ${viewMode === 'grid' ? 'bg-accent/10 text-accent' : 'bg-bg-primary text-text-secondary hover:bg-bg-hover'}`} onClick={() => setViewMode('grid')}>Grid</button>
          <button className={`px-6 py-3 rounded-lg text-sm ${viewMode === 'list' ? 'bg-accent/10 text-accent' : 'bg-bg-primary text-text-secondary hover:bg-bg-hover'}`} onClick={() => setViewMode('list')}>List</button>
        </div>
      </div>

      <div className="mb-8">
        <label className="text-sm text-text-muted font-medium block mb-3">Thumbnail Size: {thumbnailSize}px</label>
        <input type="range" min={64} max={256} step={16} value={thumbnailSize} onChange={e => setThumbnailSize(Number(e.target.value))} className="w-full accent-accent" />
      </div>
    </div>
  )
}
