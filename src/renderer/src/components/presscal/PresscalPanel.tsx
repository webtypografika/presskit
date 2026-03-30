import { useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import { Link2, FileText, Briefcase, Users, Mail } from 'lucide-react'
import { QuoteLinker } from './QuoteLinker'
import { JobFiles } from './JobFiles'
import { CustomerPicker } from './CustomerPicker'
import { EmailAttach } from './EmailAttach'

type SubTab = 'quotes' | 'jobs' | 'customers' | 'email'

export function PresscalPanel() {
  const { presscalConnected, presscalOrgName } = useAppStore()
  const [subTab, setSubTab] = useState<SubTab>('quotes')

  if (!presscalConnected) {
    return <PresscalSetup />
  }

  return (
    <div className="h-full flex flex-col">
      {/* Connection indicator */}
      <div className="border-b border-border flex items-center gap-2" style={{ padding: '12px 20px' }}>
        <div className="w-2 h-2 rounded-full bg-success" />
        <span className="text-sm text-text-primary font-medium">{presscalOrgName || 'PressCal'}</span>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center border-b border-border">
        {([
          { id: 'quotes', label: 'Quotes', icon: <FileText size={14} /> },
          { id: 'jobs', label: 'Jobs', icon: <Briefcase size={14} /> },
          { id: 'customers', label: 'Clients', icon: <Users size={14} /> },
          { id: 'email', label: 'Email', icon: <Mail size={14} /> }
        ] as const).map(tab => (
          <button
            key={tab.id}
            className={`flex items-center gap-1.5 text-sm whitespace-nowrap border-b-2 ${
              subTab === tab.id
                ? 'text-accent border-accent'
                : 'text-text-muted border-transparent hover:text-text-secondary'
            }`}
            style={{ padding: '12px 16px' }}
            onClick={() => setSubTab(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {subTab === 'quotes' && <QuoteLinker />}
        {subTab === 'jobs' && <JobFiles />}
        {subTab === 'customers' && <CustomerPicker />}
        {subTab === 'email' && <EmailAttach />}
      </div>
    </div>
  )
}

function PresscalSetup() {
  const [url, setUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleConnect = async () => {
    if (!url || !apiKey) return
    setLoading(true)
    setError('')

    try {
      await window.api.presscal.configure(url, apiKey)
      const status = await window.api.presscal.status()
      if (status.connected) {
        useAppStore.setState({
          presscalConnected: true,
          presscalOrgName: (status as any).orgName || ''
        })
      } else {
        setError('Could not connect. Check URL and API key.')
      }
    } catch (e: any) {
      setError(e.message || 'Connection failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="flex flex-col items-center gap-3 py-6">
        <Link2 size={36} className="text-text-muted" />
        <div className="text-base text-text-secondary font-medium">Connect to PressCal</div>
        <div className="text-sm text-text-muted text-center">
          Link files to quotes, jobs, and customers
        </div>
      </div>

      <div className="space-y-3">
        <label className="block">
          <span className="text-sm text-text-muted mb-1 block">PressCal URL</span>
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="http://localhost:3000"
            className="w-full px-3 py-2.5 bg-bg-primary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-sm text-text-muted mb-1 block">API Key</span>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="fh_..."
            className="w-full px-3 py-2.5 bg-bg-primary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none font-mono"
          />
        </label>

        {error && (
          <div className="text-sm text-error">{error}</div>
        )}

        <button
          className="w-full py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
          onClick={handleConnect}
          disabled={loading || !url || !apiKey}
        >
          {loading ? 'Connecting...' : 'Connect'}
        </button>
      </div>
    </div>
  )
}
