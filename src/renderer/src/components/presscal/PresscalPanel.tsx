import { useState, useEffect } from 'react'
import { useAppStore } from '@/stores/app-store'
import {
  Link2, FileText, Users, ExternalLink, Plus,
  Loader2, Mail, Building2, FolderOpen, Calculator
} from 'lucide-react'
import type { PresscalQuote } from '@/lib/ipc'
import { CostingDialog } from './CostingDialog'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Πρόχειρη',
  sent: 'Εστάλη',
  approved: 'Εγκρίθηκε',
  completed: 'Ολοκληρώθηκε',
  rejected: 'Απορρίφθηκε',
  cancelled: 'Ακυρώθηκε',
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'var(--th-text-muted)',
  sent: 'var(--th-info)',
  approved: 'var(--th-success)',
  completed: 'var(--th-text-muted)',
  rejected: 'var(--th-error)',
}

export function PresscalPanel() {
  const presscalConnected = useAppStore(s => s.presscalConnected)
  const presscalOrgName = useAppStore(s => s.presscalOrgName)
  const detectedCustomer = useAppStore(s => s.detectedCustomer)
  const detectedQuote = useAppStore(s => s.detectedQuote)

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

      <div className="flex-1 overflow-y-auto">
        {detectedCustomer || detectedQuote ? (
          <ContextualInfo />
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div style={{ padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <FolderOpen size={32} style={{ color: 'var(--th-text-muted)' }} />
      <div style={{ fontSize: 13, color: 'var(--th-text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
        Πλοηγηθείτε σε φάκελο πελάτη για να δείτε στοιχεία και ιστορικό προσφορών
      </div>
    </div>
  )
}

function ContextualInfo() {
  const detectedCustomer = useAppStore(s => s.detectedCustomer)
  const detectedQuote = useAppStore(s => s.detectedQuote)
  const selectedFile = useAppStore(s => s.selectedFile)
  const [customerQuotes, setCustomerQuotes] = useState<PresscalQuote[]>([])
  const [loading, setLoading] = useState(false)
  const [presscalUrl, setPresscalUrl] = useState('')
  const [showCosting, setShowCosting] = useState(false)
  const navigateTo = useAppStore(s => s.navigateTo)

  // Get PressCal URL for links
  useEffect(() => {
    window.api.settings.get('presscal.url').then((url: any) => setPresscalUrl((url || '').replace(/\/$/, ''))).catch(() => {})
  }, [])

  // Fetch customer quotes when customer is detected
  useEffect(() => {
    if (!detectedCustomer) {
      setCustomerQuotes([])
      return
    }
    setLoading(true)
    window.api.presscal.getQuotes({})
      .then((quotes: PresscalQuote[]) => {
        // Filter quotes for this customer
        const matching = quotes.filter(q => {
          if (q.customerId === detectedCustomer.id) return true
          // Also match by customer name
          const name = detectedCustomer.name?.toLowerCase().trim()
          const company = detectedCustomer.company?.toLowerCase().trim()
          const qName = q.customerName?.toLowerCase().trim()
          return qName && (qName === name || qName === company)
        })
        // Sort: newest first (by date or number)
        matching.sort((a, b) => (b.number || '').localeCompare(a.number || ''))
        setCustomerQuotes(matching)
      })
      .catch(() => setCustomerQuotes([]))
      .finally(() => setLoading(false))
  }, [detectedCustomer?.id])

  const openInPressCal = (path: string) => {
    if (presscalUrl) {
      window.api.shell.openExternal(`${presscalUrl}${path}`)
    }
  }

  const openQuoteFolder = async (quote: PresscalQuote) => {
    try {
      const full = await window.api.presscal.getQuote(quote.id)
      const folderPath = full?.jobFolderPath || full?.folderPath
      if (folderPath) {
        const exists = await window.api.fs.exists(folderPath)
        if (exists) {
          navigateTo(folderPath)
          useAppStore.setState({ attachmentQuoteId: quote.id })
          return
        }
      }
    } catch {}
    openInPressCal(`/quotes/${quote.id}`)
  }

  const newQuote = () => {
    if (!presscalUrl) return
    const params = detectedCustomer ? `?customerId=${detectedCustomer.id}` : ''
    window.api.shell.openExternal(`${presscalUrl}/quotes/new${params}`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Customer card */}
      {detectedCustomer && (
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--th-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Users size={16} style={{ color: 'var(--th-accent)', flexShrink: 0 }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--th-text-primary)', flex: 1 }}>
              {detectedCustomer.name}
            </span>
            {presscalUrl && (
              <button
                onClick={() => openInPressCal(`/customers/${detectedCustomer.id}`)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--th-text-muted)', padding: 2 }}
                title="Άνοιγμα στο PressCal"
              >
                <ExternalLink size={14} />
              </button>
            )}
          </div>
          {detectedCustomer.company && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--th-text-secondary)', marginBottom: 4 }}>
              <Building2 size={12} style={{ flexShrink: 0, color: 'var(--th-text-muted)' }} />
              {detectedCustomer.company}
            </div>
          )}
          {detectedCustomer.email && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--th-text-secondary)', marginBottom: 4 }}>
              <Mail size={12} style={{ flexShrink: 0, color: 'var(--th-text-muted)' }} />
              {detectedCustomer.email}
            </div>
          )}
        </div>
      )}

      {/* Current quote badge */}
      {detectedQuote && (
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--th-border)', background: 'var(--th-bg-primary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={14} style={{ color: 'var(--th-accent)', flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--th-accent)' }}>{detectedQuote.number}</span>
            <span style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 4,
              background: 'rgba(110,200,200,0.1)',
              color: STATUS_COLORS[detectedQuote.status] || 'var(--th-text-muted)',
            }}>
              {STATUS_LABELS[detectedQuote.status] || detectedQuote.status}
            </span>
            {presscalUrl && (
              <button
                onClick={() => openInPressCal(`/quotes/${detectedQuote.id}`)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--th-text-muted)', padding: 2, marginLeft: 'auto' }}
                title="Άνοιγμα στο PressCal"
              >
                <ExternalLink size={14} />
              </button>
            )}
          </div>
          {detectedQuote.title && (
            <div style={{ fontSize: 12, color: 'var(--th-text-secondary)', marginTop: 4 }}>
              {detectedQuote.title}
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--th-border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {presscalUrl && (
          <button
            onClick={newQuote}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              width: '100%', padding: '8px 12px', borderRadius: 8,
              background: 'var(--th-accent)', color: '#fff',
              border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500,
            }}
          >
            <Plus size={14} />
            Νέα Προσφορά
          </button>
        )}
        {selectedFile && !selectedFile.isDirectory && (
          <button
            onClick={() => setShowCosting(true)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              width: '100%', padding: '8px 12px', borderRadius: 8,
              background: 'var(--th-bg-primary)', color: 'var(--th-text-primary)',
              border: '1px solid var(--th-border)', cursor: 'pointer', fontSize: 13, fontWeight: 500,
            }}
          >
            <Calculator size={14} />
            Κοστολόγηση: {selectedFile.name.length > 25 ? selectedFile.name.slice(0, 25) + '...' : selectedFile.name}
          </button>
        )}
      </div>

      {/* Costing dialog */}
      {showCosting && selectedFile && (
        <CostingDialog filePath={selectedFile.path} fileName={selectedFile.name} onClose={() => setShowCosting(false)} />
      )}

      {/* Customer quote history */}
      {detectedCustomer && (
        <div>
          <div style={{ padding: '12px 20px 8px', fontSize: 12, fontWeight: 600, color: 'var(--th-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Ιστορικό Προσφορών ({customerQuotes.length})
          </div>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
              <Loader2 size={18} className="animate-spin" style={{ color: 'var(--th-text-muted)' }} />
            </div>
          ) : customerQuotes.length === 0 ? (
            <div style={{ padding: '12px 20px', fontSize: 12, color: 'var(--th-text-muted)' }}>
              Δεν βρέθηκαν προσφορές
            </div>
          ) : (
            <div>
              {customerQuotes.map(q => (
                <div
                  key={q.id}
                  onClick={() => openQuoteFolder(q)}
                  style={{
                    padding: '10px 20px', cursor: 'pointer',
                    borderBottom: '1px solid rgba(255,255,255,0.03)',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <FileText size={14} style={{ color: STATUS_COLORS[q.status] || 'var(--th-text-muted)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--th-text-primary)' }}>{q.number}</span>
                      <span style={{
                        fontSize: 10, padding: '1px 6px', borderRadius: 3,
                        color: STATUS_COLORS[q.status] || 'var(--th-text-muted)',
                        background: 'var(--th-bg-primary)',
                      }}>
                        {STATUS_LABELS[q.status] || q.status}
                      </span>
                    </div>
                    {q.title && (
                      <div style={{ fontSize: 11, color: 'var(--th-text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {q.title}
                      </div>
                    )}
                  </div>
                  {q.grandTotal > 0 && (
                    <span style={{ fontSize: 11, color: 'var(--th-text-muted)', flexShrink: 0 }}>
                      {q.grandTotal.toFixed(0)}&euro;
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
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
