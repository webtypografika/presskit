import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@/stores/app-store'
import {
  Link2, FileText, Users, ExternalLink, Plus,
  Loader2, Mail, Building2, FolderOpen, Calculator, Search, X
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

const ACTIVE_STATUSES = new Set(['draft', 'sent', 'approved'])

// Extra fields from getQuote(id) that the list endpoint doesn't return
interface QuoteDetail {
  customerName?: string
  contactEmail?: string
  folderPath?: string
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
        {(detectedCustomer || detectedQuote) && <ContextualInfo />}
        <ActiveQuotesList />
      </div>
    </div>
  )
}

/* ─── Active Quotes List ─────────────────────────────────────── */

type StatusFilter = 'all' | 'draft' | 'sent' | 'approved'

const FILTER_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'Όλες' },
  { key: 'approved', label: 'Εγκρίθηκε' },
  { key: 'sent', label: 'Εστάλη' },
  { key: 'draft', label: 'Πρόχειρη' },
]

function ActiveQuotesList() {
  const navigateTo = useAppStore(s => s.navigateTo)
  const setSource = useAppStore(s => s.setSource)
  const source = useAppStore(s => s.source)
  const [quotes, setQuotes] = useState<PresscalQuote[]>([])
  const [details, setDetails] = useState<Record<string, QuoteDetail>>({})
  const [loading, setLoading] = useState(false)
  const [presscalUrl, setPresscalUrl] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [searchText, setSearchText] = useState('')

  useEffect(() => {
    window.api.settings.get('presscal.url').then((url: any) => setPresscalUrl((url || '').replace(/\/$/, ''))).catch(() => {})
  }, [])

  // Enrich details in batches of 5 to avoid overwhelming the API
  const enrichQuotes = useCallback(async (active: PresscalQuote[]) => {
    const BATCH = 5
    for (let i = 0; i < active.length; i += BATCH) {
      const batch = active.slice(i, i + BATCH)
      const results = await Promise.allSettled(
        batch.map(async q => {
          const f = await window.api.presscal.getQuote(q.id) as any
          const rawPath = f?.jobFolderPath || f?.folderPath || ''
          const folderPath = rawPath ? await window.api.cloudRoots.resolve(rawPath) : ''
          return {
            id: q.id,
            customerName: f?.customerName || f?.companyName || f?.contactName || '',
            contactEmail: f?.contactEmail || f?.senderEmail || '',
            folderPath,
          }
        })
      )
      // Update details progressively
      setDetails(prev => {
        const next = { ...prev }
        for (const r of results) {
          if (r.status === 'fulfilled') {
            next[r.value.id] = { customerName: r.value.customerName, contactEmail: r.value.contactEmail, folderPath: r.value.folderPath }
          }
        }
        return next
      })
    }
  }, [])

  const fetchQuotes = useCallback(async () => {
    setLoading(true)
    try {
      const all: PresscalQuote[] = await window.api.presscal.getQuotes({ limit: 500 })
      const active = all
        .filter(q => ACTIVE_STATUSES.has(q.status))
        .sort((a, b) => (b.number || '').localeCompare(a.number || ''))
      setQuotes(active)
      setLoading(false)

      // Enrich in background (don't block UI)
      enrichQuotes(active)
    } catch {
      setQuotes([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch on mount + every 15 minutes + on window focus.
  // 5-min polls matched Neon's 5-min sleep threshold exactly, so the DB
  // never suspended while PressKit was open (billed compute 24/7). Focus
  // refresh keeps the list fresh the moment the user actually looks at it.
  useEffect(() => {
    fetchQuotes()
    const timer = setInterval(() => {
      if (!document.hidden) fetchQuotes()
    }, 15 * 60 * 1000)
    const onFocus = () => fetchQuotes()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [fetchQuotes])

  const openFolder = async (quote: PresscalQuote) => {
    const detail = details[quote.id]
    if (detail?.folderPath) {
      const exists = await window.api.fs.exists(detail.folderPath)
      if (exists) {
        if (source !== 'local') setSource('local')
        navigateTo(detail.folderPath)
        useAppStore.setState({ attachmentQuoteId: quote.id })
        return
      }
    }
    // Folder not found — try fetching fresh + resolve portable path
    try {
      const full = await window.api.presscal.getQuote(quote.id)
      const rawFp = (full as any)?.jobFolderPath || (full as any)?.folderPath
      if (rawFp) {
        const fp = await window.api.cloudRoots.resolve(rawFp)
        const exists = await window.api.fs.exists(fp)
        if (exists) {
          if (source !== 'local') setSource('local')
          navigateTo(fp)
          useAppStore.setState({ attachmentQuoteId: quote.id })
          return
        }
      }
    } catch {}
  }

  const openInPressCal = (quoteId: string) => {
    if (presscalUrl) {
      window.api.shell.openExternal(`${presscalUrl}/quotes/${quoteId}`)
    }
  }

  // Apply filters
  const filtered = quotes.filter(q => {
    if (statusFilter !== 'all' && q.status !== statusFilter) return false
    if (searchText) {
      const s = searchText.toLowerCase()
      const name = (q.customerName || details[q.id]?.customerName || '').toLowerCase()
      const email = (details[q.id]?.contactEmail || '').toLowerCase()
      const num = (q.number || '').toLowerCase()
      const title = (q.title || '').toLowerCase()
      if (!name.includes(s) && !email.includes(s) && !num.includes(s) && !title.includes(s)) return false
    }
    return true
  })

  return (
    <div>
      {/* Header */}
      <div style={{
        padding: '12px 20px 8px', fontSize: 12, fontWeight: 600,
        color: 'var(--th-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5,
        borderTop: '1px solid var(--th-border)',
      }}>
        Ενεργές Προσφορές ({quotes.length})
      </div>

      {/* Search */}
      <div style={{ padding: '4px 20px 8px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'var(--th-bg-primary)', border: '1px solid var(--th-border)',
          borderRadius: 6, padding: '5px 10px',
        }}>
          <Search size={12} style={{ color: 'var(--th-text-muted)', flexShrink: 0 }} />
          <input
            type="text"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="Αναζήτηση..."
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              fontSize: 12, color: 'var(--th-text-primary)',
            }}
          />
          {searchText && (
            <button
              onClick={() => setSearchText('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--th-text-muted)', padding: 0, display: 'flex' }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{
        display: 'flex', gap: 0, padding: '0 20px 8px',
        borderBottom: '1px solid var(--th-border)',
      }}>
        {FILTER_TABS.map(tab => {
          const isActive = statusFilter === tab.key
          const count = tab.key === 'all' ? quotes.length : quotes.filter(q => q.status === tab.key).length
          return (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              style={{
                padding: '4px 8px', fontSize: 11, fontWeight: isActive ? 600 : 400,
                color: isActive ? 'var(--th-accent)' : 'var(--th-text-muted)',
                background: 'none', border: 'none', cursor: 'pointer',
                borderBottom: isActive ? '2px solid var(--th-accent)' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {tab.label} ({count})
            </button>
          )
        })}
      </div>

      {loading && quotes.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
          <Loader2 size={18} className="animate-spin" style={{ color: 'var(--th-text-muted)' }} />
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '12px 20px', fontSize: 12, color: 'var(--th-text-muted)' }}>
          {quotes.length === 0 ? 'Δεν υπάρχουν ενεργές προσφορές' : 'Κανένα αποτέλεσμα'}
        </div>
      ) : (
        <div>
          {filtered.map(q => {
            const detail = details[q.id]
            const email = detail?.contactEmail || ''
            const hasFolder = !!detail?.folderPath

            return (
              <div
                key={q.id}
                style={{
                  padding: '10px 20px',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                }}
              >
                {/* Row 1: Customer name + status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <FileText size={13} style={{ color: STATUS_COLORS[q.status] || 'var(--th-text-muted)', flexShrink: 0 }} />
                  <span style={{
                    fontSize: 13, fontWeight: 500, color: 'var(--th-text-primary)',
                    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {q.customerName || detail?.customerName || '—'}
                  </span>
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 3, flexShrink: 0,
                    color: STATUS_COLORS[q.status] || 'var(--th-text-muted)',
                    background: 'var(--th-bg-primary)',
                  }}>
                    {STATUS_LABELS[q.status] || q.status}
                  </span>
                </div>

                {/* Row 2: Email + quote number */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, paddingLeft: 19 }}>
                  {email ? (
                    <span style={{
                      fontSize: 11, color: 'var(--th-text-muted)', flex: 1,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {email}
                    </span>
                  ) : (
                    <span style={{ flex: 1 }} />
                  )}
                  <span style={{ fontSize: 11, color: 'var(--th-text-muted)', flexShrink: 0 }}>
                    {q.number}
                  </span>
                </div>

                {/* Row 3: Action buttons */}
                <div style={{ display: 'flex', gap: 6, marginTop: 6, paddingLeft: 19 }}>
                  <button
                    onClick={() => openFolder(q)}
                    disabled={!hasFolder}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 500,
                      background: hasFolder ? 'rgba(110,200,200,0.12)' : 'var(--th-bg-primary)',
                      color: hasFolder ? 'var(--th-accent)' : 'var(--th-text-muted)',
                      border: '1px solid ' + (hasFolder ? 'rgba(110,200,200,0.25)' : 'var(--th-border)'),
                      cursor: hasFolder ? 'pointer' : 'default',
                      opacity: hasFolder ? 1 : 0.5,
                    }}
                    title={detail?.folderPath || 'Δεν έχει δηλωμένο φάκελο'}
                  >
                    <FolderOpen size={12} />
                    Φάκελος
                  </button>
                  <button
                    onClick={() => openInPressCal(q.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 500,
                      background: 'var(--th-bg-primary)',
                      color: 'var(--th-text-secondary)',
                      border: '1px solid var(--th-border)',
                      cursor: 'pointer',
                    }}
                  >
                    <ExternalLink size={12} />
                    PressCal
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ─── Contextual Info (detected customer/quote) ──────────────── */

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
      const rawPath = full?.jobFolderPath || full?.folderPath
      if (rawPath) {
        const folderPath = await window.api.cloudRoots.resolve(rawPath)
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
